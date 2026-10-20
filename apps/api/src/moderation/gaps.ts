import { ACTION_KINDS, GAP_CLASSES, GAP_MEASURE_CLASSES, GAP_SITE_CLASSES, OVERVIEW_LIST_MAX, ORDER_RULES, RESTORE_GAPS_MAX, type ActionKind, type GapClass, type GapDisposition, type RestoreGap, type RestoreView, type StaffOverview } from "@korbat/contracts";
import { sql } from "drizzle-orm";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { boundLockWaits, isBoundReached, isDeadlock } from "../lib/lock-bounds";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { RETRY_MARGIN_MS } from "./decide";
import { appendConfirmedAudit, closeGap, raisedMessage, rows, type Runner } from "./repo";

/**
 * After a restore (3f design, sections 6.6, 7.17, 8.8 and 10.2): the gaps an import found in the keeper's files, as the
 * console's After a restore screen and the home screen read them, and their closing. A gap is a list entry: closing one
 * restricts nothing, and nothing here writes the ledger. The database's gap_close is the one writer of a closing from the
 * API: the decide, review and effect routes call it in their transaction with the decision that took the measure again,
 * and an admin's "Not needed" calls it with none, bound at commit to its confirmed audit row (restore_gaps_confirmed).
 */

/** A timestamptz expression as ISO text in UTC, to the millisecond. The expression is written here, never input. */
const isoOf = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
/** The classes as a SQL array, in their order, for ordering and for the counts. */
const classList = (classes: readonly GapClass[]) => sql.raw(`array[${classes.map((c) => `'${c}'`).join(", ")}]::text[]`);

/**
 * The open gaps of the class order_effect that name one of these items (7.6 step 5): "Disable for an order" closes them
 * in its own transaction, with each item's decision, and the request carries nothing for them. Read before the
 * transaction; gap_close takes each gap's row again and refuses one that a concurrent decision closed meanwhile.
 */
export async function openEffectGaps(q: Runner, itemIds: readonly string[]): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();
  const found = await rows<{ id: string; target_id: string }>(
    q,
    sql`select g.id, g.target_id from public.restore_gaps g
         where g.closed_at is null and g.class = 'order_effect' and g.target_type = 'order_item' and g.target_id = any(${`{${itemIds.join(",")}}`}::text[])
         order by g.place, g.id`,
  );
  // One gap an item: an item's disabling was lost once, in one effect; should two imports name it, the first is closed.
  const byItem = new Map<string, string>();
  for (const row of found) if (!byItem.has(row.target_id)) byItem.set(row.target_id, row.id);
  return byItem;
}

/** The items of an order that an open gap names, for OrderView's `gap`. */
export async function itemsWithOpenGaps(q: Runner, orderId: string): Promise<Set<string>> {
  const found = await rows<{ target_id: string }>(
    q,
    sql`select g.target_id from public.restore_gaps g
         where g.closed_at is null and g.target_type = 'order_item'
           and g.target_id in (select i.id::text from public.legal_order_items i where i.order_id = ${orderId}::uuid)`,
  );
  return new Set(found.map((row) => row.target_id));
}

/** The lost decision's action kinds, read from its signed params; an order's effect holds one disable_by_order an item. */
function kindsOf(action: string, metadata: unknown): ActionKind[] {
  if (action === "order_effected") return ["disable_by_order"];
  const actions = (metadata as { params?: { actions?: unknown } } | null)?.params?.actions;
  if (!Array.isArray(actions)) return [];
  const known = ACTION_KINDS as readonly string[];
  return [...new Set(actions.map((entry) => (entry as { kind?: unknown }).kind).filter((kind): kind is ActionKind => typeof kind === "string" && known.includes(kind)))];
}

interface GapRow {
  id: string;
  class: GapClass;
  acted_at: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: unknown;
  closed_at: string | null;
  disposition: GapDisposition | null;
  closed_by: string | null;
  case_id: string | null;
  order_id: string | null;
  released: boolean;
}

/**
 * GET /api/staff/restore (7.17 step 5, 8.8): every open gap, and the newest import's closed ones, in the order of the
 * classes and then of the lost rows' time; the newest import's time; whether the app's site may open (no gap of the
 * classes 1 to 3 is open) and retention go back on (none of 1 to 5); and the orders whose notice is held, with each one's
 * end as the restored database holds it, which [restore.holds] tells whoever has the server to compare with the mailbox.
 * A gap names its case or its order only where the restored database holds it. No metadata leaves this function.
 */
export async function restoreView(deps: Pick<ModerationDeps, "apiDb">): Promise<RestoreView> {
  const q = deps.apiDb;
  const [newest] = await rows<{ import_id: string | null; imported_at: string | null }>(
    q,
    sql`select g.import_id, ${isoOf("g.imported_at")} as imported_at from public.restore_gaps g order by g.imported_at desc, g.id limit 1`,
  );
  const found = await rows<GapRow>(
    q,
    sql`select g.id, g.class, ${isoOf("g.acted_at")} as acted_at, g.action, g.target_type, g.target_id, g.metadata,
               ${isoOf("g.closed_at")} as closed_at, g.disposition, g.closed_by,
               case when g.target_type = 'case' then (select c.id from public.cases c where c.id::text = g.target_id)
                    when g.target_type = 'decision' then (select d.case_id from public.decisions d where d.id::text = g.target_id)
                    -- 3d Task 2: a lost release of a seal names the seal's ledger row; the console links its case.
                    when g.target_type = 'seal' then (select d.case_id from public.decision_actions a join public.decisions d on d.id = a.decision_id where a.id::text = g.target_id)
               end as case_id,
               case when g.target_type = 'order_item' then (select i.order_id from public.legal_order_items i where i.id::text = g.target_id)
                    when g.target_type = 'order' then (select o.id from public.legal_orders o where o.id::text = g.target_id)
               end as order_id,
               -- 3d Task 2: a lost seal for good of a post that a release (or its replay) has marked: [restore.sealAgain].
               g.class = 'seal_final' and exists (select 1 from public.release_posts r
                                                   where (g.metadata -> 'target' ->> 'type') = 'post' and r.post_id::text = (g.metadata -> 'target' ->> 'id')) as released
          from public.restore_gaps g
         where g.closed_at is null or g.import_id = ${newest?.import_id ?? null}::uuid
         order by array_position(${classList(GAP_CLASSES)}, g.class), g.acted_at, g.place, g.id
         limit ${RESTORE_GAPS_MAX}`,
  );
  const gaps: RestoreGap[] = found.map((row) => ({
    id: row.id,
    class: row.class,
    actedAt: row.acted_at,
    action: row.action,
    caseId: row.case_id,
    orderId: row.order_id,
    itemId: row.target_type === "order_item" ? row.target_id : null,
    kinds: kindsOf(row.action, row.metadata),
    closedAt: row.closed_at,
    disposition: row.disposition,
    closedByDecisionId: row.closed_by,
    ...(row.released ? { released: true } : {}),
  }));
  const open = gaps.filter((gap) => gap.closedAt === null);
  // A held notice: an order with Section C whose hold has not ended and runs past now, about which an untold decision
  // stands or an open gap names an item: the decision taken again for it is told at that end.
  const holds = await rows<{ order_id: string; hold_until: string | null }>(
    q,
    sql`select o.id as order_id, case when public.order_hold_until(o.id) = 'infinity'::timestamptz then null else ${isoOf("public.order_hold_until(o.id)")} end as hold_until
          from public.legal_orders o
         where o.section_c and o.closed_at is null and o.hold_ended_at is null and public.order_hold_until(o.id) > now()
           and (exists (select 1 from public.legal_order_items i join public.decisions d on d.order_item_id = i.id where i.order_id = o.id and d.informed_at is null)
                or exists (select 1 from public.legal_order_items i join public.restore_gaps g on g.target_type = 'order_item' and g.target_id = i.id::text and g.closed_at is null
                            where i.order_id = o.id))
         order by public.order_hold_until(o.id), o.id
         limit ${OVERVIEW_LIST_MAX}`,
  );
  return {
    importedAt: newest?.imported_at ?? null,
    mayOpen: !open.some((gap) => GAP_SITE_CLASSES.includes(gap.class)),
    retentionMay: !open.some((gap) => GAP_MEASURE_CLASSES.includes(gap.class)),
    gaps,
    holds: holds.map((row) => ({ orderId: row.order_id, holdUntil: row.hold_until })),
  };
}

/** The home screen's [home.restore] (10.2): the open gaps, those of the classes 1 to 5, and the newest import's time. */
export async function restoreOverview(q: Runner): Promise<StaffOverview["restore"]> {
  const [row] = await rows<{ open: number; measures: number; imported_at: string | null }>(
    q,
    sql`select (select count(*)::int from public.restore_gaps g where g.closed_at is null) as open,
               (select count(*)::int from public.restore_gaps g where g.closed_at is null and g.class = any(${classList(GAP_MEASURE_CLASSES)})) as measures,
               (select ${isoOf("max(g.imported_at)")} from public.restore_gaps g) as imported_at`,
  );
  return { open: row!.open, measures: row!.measures, importedAt: row!.imported_at };
}

/**
 * The home screen's [home.copy] (10.2): the newest copy mark's time, and whether the copy is overdue by the rule
 * alert_steps() writes copy_overdue by: the newest mark older than copyOverdueHours, or none and the audit log's first row
 * that old. Two reads by index: the marks' newest and the chain's first place.
 */
export async function copyOverview(q: Runner): Promise<StaffOverview["copy"]> {
  const [row] = await rows<{ newest_at: string | null; overdue: boolean }>(
    q,
    sql`select ${isoOf("m.at")} as newest_at,
               coalesce(m.at, (select l.created_at from public.audit_log l order by l.chain_seq limit 1)) < now() - make_interval(hours => ${ORDER_RULES.copyOverdueHours}::int) as overdue
          from (select null::int) one
          left join lateral (select x.at from public.copy_marks x order by x.at desc, x.id desc limit 1) m on true`,
  );
  return { newestAt: row!.newest_at, overdue: row!.overdue === true };
}

/** The locks "Not needed" may wait for: the gap, the acting account's row, the key and the audit head. */
const GAP_WAITS = 4;

/**
 * POST /api/staff/restore/gaps/:gap/close, once its step-up verified (7.17 step 6, 8.8): an admin's "Not needed", in one
 * transaction: gap_close with no decision, which takes the gap's row and refuses a closed one (gap_mismatch) and anyone
 * but an admin (admin_required), then the confirmed audit row gap_closed on the gap, which restore_gaps_confirmed holds the
 * closing to at commit. "ended" and "late" as for a decision; once more after a deadlock while the challenge has time.
 */
export async function closeGapNotNeeded(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<RestoreView | "ended" | "late"> {
  // A confirmation of anything else never closes a gap: a wiring fault, not a refusal.
  if (confirmed.action !== "gap_closed" || confirmed.target.type !== "restore_gap" || confirmed.keyId !== session.keyId) throw new Error("a gap is closed as not needed only with the step-up that confirmed it");
  const gapId = confirmed.target.id;
  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await deps.apiDb.transaction(async (tx): Promise<"done" | "late"> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, GAP_WAITS))) return "late";
        await closeGap(tx, gapId, null, session.userId);
        await appendConfirmedAudit(tx, {
          actorId: session.userId,
          keyId: confirmed.keyId,
          action: "gap_closed",
          targetType: "restore_gap",
          targetId: gapId,
          metadata: { params: confirmed.params },
          staffSession: session.handle,
          actionHash: confirmed.actionHash,
          stepUp: confirmed.assertion,
          requestId: ctx.requestId,
          expiresAt: confirmed.expiresAt,
        });
        return "done";
      });
      if (outcome === "late") return "late";
      return restoreView(deps);
    } catch (err) {
      const refusal = raisedMessage(err);
      if (refusal === "staff_confirmation_ended") return "ended";
      if (refusal === "staff_confirmation_late") return "late";
      if (refusal === "not_found") throw new ModerationError("not_found");
      if (refusal !== null && isModerationErrorCode(refusal)) throw new ModerationError(refusal);
      if (!isDeadlock(err) && !isBoundReached(err)) throw err;
      if (attempt > 1 || confirmed.expiresAt.getTime() - deps.now().getTime() <= RETRY_MARGIN_MS) return "late";
    }
  }
}
