import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { RULE_DEFAULT_CATEGORY, type OrderView } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { matchForTest } from "./automation-fixtures";
import { hex64, imagePost, newImageRow, newRef, openCase, type TestStaff } from "./moderation-fixtures";
import { ageOrderForTest, effectParams, effectWith, orderForTest } from "./orders-fixtures";

/**
 * yearForTest (3d design, section 12; Task 4, grown in Task 6 for decisions without a decider and in Task 7 for refused
 * uploads): a past year of decisions, intakes, appeals, account measures and orders, written cell by cell as the migrator
 * inside the caller's transaction, which the caller rolls back. LAB E wrote its synthetic decisions with the triggers off
 * (`e-counts.sql`); so does this fixture, for the rows of the tables it fills by the hundred: the migrator owns them, and
 * `alter table ... disable trigger user` holds only until the transaction ends, so nothing it writes outlives the test.
 * It does that first, while the transaction has queued no trigger event on those tables, and switches the triggers on
 * again before the orders, which go through 3f's real flows (as cli-counts.test.ts writes its fixture year) and are then
 * moved back into the year by ageOrderForTest.
 *
 * Each row of a cell gets a time in the year (in UTC) spread over its months, as the lab spread them: the row's number
 * modulo 12 picks the month and modulo 28 the day, at noon. A row counted by its later fate (an appeal's answer) has
 * that fate in the year too.
 */

/** A rule's id, or the law: what a restriction cites. */
export type GroundLabel = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "law";

/** One order of the year, given effect through 3f's real flows and moved back into the year. */
export interface OrderCell {
  /** How many posts the order names; it disables the first `effectOn` of them (all by default). */
  posts: number;
  effectOn?: number;
  memberState?: "DE" | "FR";
  /** The instant of its last disabling, in the year or after it; noon on 15 June of the year by default. */
  disabledAt?: Date;
  /** Its receipt this many minutes before its last disabling; none recorded when absent. */
  receivedBefore?: number;
  /**
   * A notice held under Section C: its order decisions stay untold, and its hold runs to this instant (written as the
   * hold's recorded end, the one way a past removal order's hold can still run; the test ends it the same way).
   */
  heldUntil?: Date;
}

/** The cells of a year. Every number is how many rows the cell holds. */
export interface YearCells {
  /** Final decisions that restrict, by what they cite, each with one ledger row of `measure` (remove by default). */
  restrictions?: Partial<Record<GroundLabel, number>>;
  measure?: "remove" | "withhold" | "remove_media" | "reset_bio";
  /** Interim decisions that restrict, each citing R4 with one withhold. */
  interim?: number;
  /** Final decisions that found no breach (no_violation). */
  noBreach?: number;
  /** Intakes by kind: a report under a rule, a notice of illegality, a moderator's finding. */
  intakes?: Partial<Record<"rules" | "illegal" | "finding", number>>;
  /** Appeals answered in the year, by their result; each appeals a decision of the year before, so no restriction of the year is added. */
  appeals?: Partial<Record<"kept" | "partly_reversed" | "reversed", number>>;
  /** 3e's account measures, each on a final decision of the year that restricts under R6 (which therefore counts as a restriction too). */
  accountMeasures?: Partial<Record<"strike" | "suspend" | "terminate" | "retire_handle" | "warn_reporting" | "restrict_reporting", number>>;
  orders?: OrderCell[];
  /** Restrictions under R3 dated in the year before, which a test may move into the year later: what a correction counts again. */
  spare?: number;
  /**
   * 3d Task 6: a program's rows. `findings`: intakes of the kind automated on the channel system, by the rule each cites;
   * of the R1 ones, `restrictedR1` have an item on the year's case, so a person's final restriction of the year
   * (`restrictions`, which the test sets) restricted them. `measures`: decisions without a decider, interim, restricting and
   * fully automated, by rule, each with its one ledger row: a withhold of the year's post's image under R1, a seal of its
   * images under R2.
   */
  automated?: { findings?: Partial<Record<"R1" | "R2", number>>; restrictedR1?: number; measures?: Partial<Record<"R1" | "R2", number>> };
  /**
   * 3d Task 7: refused uploads of the year, by how their hold had ended by the edition's due day: ended as report, ended as
   * no_report, or not at all (open). Each is an image row on no post with its acting match record and its refusal, written
   * with the refusal's triggers off; an end is in the year, before the due day.
   */
  uploads?: Partial<Record<"report" | "no_report" | "open", number>>;
}

/** What the fixture made that a test reads again. */
export interface YearMade {
  caseId: string;
  orders: OrderView[];
  /** The decisions of `spare`. */
  spareIds: string[];
}

/** The tables the fixture fills with its triggers off; 3d Task 6 adds the items of a program's findings. */
const BULK_TABLES = ["decisions", "decision_actions", "intakes", "intake_items", "appeals"] as const;

/** A row's time in the year: its number picks the month and the day, at noon UTC. */
const spread = (year: number) => sql`make_timestamptz(${year}::int, 1 + (g::int % 12), 1 + (g::int % 28), 12, 0, 0, 'UTC')`;

export async function yearForTest(tx: DbTx, year: number, cells: YearCells, staff: TestStaff): Promise<YearMade> {
  // One post and its case, which every bulk decision names: the ledger needs a case, a snapshot and a decider.
  // 3d Task 6: with an image when a program's measures withhold one.
  const { authorId, postId, mediaIds } = await imagePost(tx, cells.automated?.measures ? 1 : 0);
  const caseId = await openCase(tx, "post", postId);
  const [snapshot] = await tx.execute<{ id: string }>(sql`
    insert into public.evidence_snapshots (case_id, target_type, target_id, author_handle, digest)
    values (${caseId}::uuid, 'post', ${postId}::uuid, 'author', ${hex64()}) returning id`);
  const spareIds: string[] = [];

  for (const table of BULK_TABLES) await tx.execute(sql.raw(`alter table public.${table} disable trigger user`));
  {
    /** Inserts `n` decisions with the columns given, each with one ledger row of `measure` when it restricts. */
    const decisions = async (n: number, d: { kind: "final" | "interim" | "review"; outcome: string; ground: "incompatible" | "illegal" | null; ruleId: string | null; at: ReturnType<typeof spread>; measure: string | null }) => {
      if (n <= 0) return [] as string[];
      const legal = d.ground === "illegal" ? hex64() : null;
      const restricted = d.outcome === "restricted";
      const rows = await tx.execute<{ id: string }>(sql`
        insert into public.decisions (case_id, kind, seen_state_version, outcome, ground, rule_id, rules_version, redress_version, category, source,
                                      snapshot_id, snapshot_digest, facts_digest, reason_digest, legal_reference_digest, decided_by, decided_at, xact, puid,
                                      informed_at, suspect, needs_admin, ended_interim)
        select ${caseId}::uuid, ${d.kind}::public.decision_kind, 0, ${d.outcome}::public.decision_outcome, ${d.ground}::public.decision_ground, ${d.ruleId},
               3, 3, 'STATEMENT_CATEGORY_VIOLENCE', 'report', ${snapshot!.id}::uuid, ${hex64()}, ${restricted ? hex64() : null}, ${restricted ? hex64() : null}, ${legal},
               ${staff.id}::uuid, ${d.at}, '1'::xid8, md5(random()::text || g::text), ${d.at}, false, false, false
          from generate_series(1, ${n}::int) g
        returning id`);
      const ids = rows.map((row) => row.id);
      if (d.measure !== null) {
        await tx.execute(sql`
          insert into public.decision_actions (decision_id, kind, subject_account_id, post_id, created_at)
          select d.id, ${d.measure}::public.action_kind, ${authorId}::uuid, ${postId}::uuid, d.decided_at from public.decisions d where d.id = any(${`{${ids.join(",")}}`}::uuid[])`);
      }
      return ids;
    };

    const measure = cells.measure ?? "remove";
    for (const [label, n] of Object.entries(cells.restrictions ?? {}) as [GroundLabel, number][]) {
      await decisions(n, { kind: "final", outcome: "restricted", ground: label === "law" ? "illegal" : "incompatible", ruleId: label === "law" ? null : label, at: spread(year), measure });
    }
    await decisions(cells.interim ?? 0, { kind: "interim", outcome: "restricted", ground: "incompatible", ruleId: "R4", at: spread(year), measure: "withhold" });
    await decisions(cells.noBreach ?? 0, { kind: "final", outcome: "no_violation", ground: null, ruleId: null, at: spread(year), measure: null });
    spareIds.push(...(await decisions(cells.spare ?? 0, { kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R3", at: spread(year - 1), measure })));
    for (const [kind, n] of Object.entries(cells.accountMeasures ?? {}) as [string, number][]) {
      await decisions(n, { kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R6", at: spread(year), measure: kind });
    }

    for (const [label, n] of Object.entries(cells.intakes ?? {}) as ["rules" | "illegal" | "finding", number][]) {
      const finding = label === "finding";
      const illegal = label === "illegal";
      await tx.execute(sql`
        insert into public.intakes (kind, ref, channel, finding_by, rule_id, alleges_illegal, category, explanation, bona_fide, received_at)
        select ${finding ? "finding" : "user"}::public.intake_kind, r.ref,
               ${finding ? "staff" : "signed_in"}::public.intake_channel, ${finding ? staff.id : null}::uuid, ${illegal ? null : finding ? "R3" : "R1"},
               ${illegal}, ${illegal ? "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH" : "STATEMENT_CATEGORY_OTHER_VIOLATION_TC"}, ${illegal ? "it is illegal" : null}, ${illegal},
               ${spread(year)}
          from unnest(${`{${Array.from({ length: n }, () => newRef()).join(",")}}`}::text[]) with ordinality as r(ref, g)`);
    }

    // 3d Task 6: a program's findings and measures. The new label and channel are cast at run time, on a database that has
    // them; the figures function compares them as text.
    for (const [rule, n] of Object.entries(cells.automated?.findings ?? {}) as ["R1" | "R2", number][]) {
      const restricted = rule === "R1" ? Math.min(n, cells.automated?.restrictedR1 ?? 0) : 0;
      const made = await tx.execute<{ id: string; g: number }>(sql`
        insert into public.intakes (kind, ref, channel, rule_id, alleges_illegal, category, bona_fide, automated_processing, received_at)
        select ${"automated"}::public.intake_kind, r.ref, ${"system"}::public.intake_channel, ${rule}, false, ${RULE_DEFAULT_CATEGORY[rule]}, false, true, ${spread(year)}
          from unnest(${`{${Array.from({ length: n }, () => newRef()).join(",")}}`}::text[]) with ordinality as r(ref, g)
        returning id`);
      // An item on a case has its number in the case; these come after any the year's case holds.
      for (const [at, intake] of made.slice(0, restricted).entries()) {
        await tx.execute(sql`insert into public.intake_items (intake_id, position, target_type, target_id, case_id, seq, lane, created_at)
                             values (${intake.id}::uuid, 1, 'post', ${postId}::uuid, ${caseId}::uuid, ${100_000 + at}, 2, make_timestamptz(${year}::int, 1, 1, 12, 0, 0, 'UTC'))`);
      }
    }
    for (const [rule, n] of Object.entries(cells.automated?.measures ?? {}) as ["R1" | "R2", number][]) {
      const rows = await tx.execute<{ id: string }>(sql`
        insert into public.decisions (case_id, kind, seen_state_version, outcome, ground, rule_id, rules_version, redress_version, category, source,
                                      snapshot_id, snapshot_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim,
                                      automated_detection, automated_decision)
        select ${caseId}::uuid, 'interim', 0, 'restricted', 'incompatible', ${rule}, 3, 4, ${RULE_DEFAULT_CATEGORY[rule]}, 'own_initiative',
               ${snapshot!.id}::uuid, ${hex64()}, null, ${spread(year)}, '1'::xid8, md5(random()::text || g::text), ${spread(year)}, false, false, false, true, 'fully'
          from generate_series(1, ${n}::int) g
        returning id`);
      await tx.execute(sql`
        insert into public.decision_actions (decision_id, kind, media_id, subject_account_id, post_id, created_at)
        select d.id, ${rule === "R1" ? "withhold_media" : "seal_media"}::public.action_kind, ${rule === "R1" ? mediaIds[0]! : null}::uuid, ${authorId}::uuid, ${postId}::uuid, d.decided_at
          from public.decisions d where d.id = any(${`{${rows.map((row) => row.id).join(",")}}`}::uuid[])`);
    }

    // An appeal answered in the year: the decision it appeals is of the year before (so no restriction of the year is
    // added), and the review that answers it is of the year, with the result the cell names.
    for (const [result, n] of Object.entries(cells.appeals ?? {}) as ["kept" | "partly_reversed" | "reversed", number][]) {
      const appealed = await decisions(n, { kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R1", at: spread(year - 1), measure });
      for (const decisionId of appealed) {
        const [appeal] = await tx.execute<{ id: string }>(sql`
          insert into public.appeals (decision_id, appellant_account_id, filed_at) values (${decisionId}::uuid, ${authorId}::uuid, make_timestamptz(${year}::int, 1, 2, 0, 0, 0, 'UTC')) returning id`);
        const [review] = await tx.execute<{ id: string }>(sql`
          insert into public.decisions (case_id, kind, reviews_decision_id, appeal_id, seen_state_version, outcome, rules_version, redress_version, category, source,
                                        snapshot_id, snapshot_digest, reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
          values (${caseId}::uuid, 'review', ${decisionId}::uuid, ${appeal!.id}::uuid, 0, ${result}::public.decision_outcome, 3, 3, 'STATEMENT_CATEGORY_VIOLENCE', 'report',
                  ${snapshot!.id}::uuid, ${hex64()}, ${hex64()}, ${staff.id}::uuid, make_timestamptz(${year}::int, 3, 3, 12, 0, 0, 'UTC'), '1'::xid8, ${randomUUID().replaceAll("-", "")},
                  make_timestamptz(${year}::int, 3, 3, 12, 0, 0, 'UTC'), false, false, false)
          returning id`);
        await tx.execute(sql`update public.appeals set answered_by = ${review!.id}::uuid, result = ${result}::public.appeal_result, answered_at = make_timestamptz(${year}::int, 3, 3, 12, 0, 0, 'UTC')
                              where id = ${appeal!.id}::uuid`);
      }
    }
  }
  // On again for what follows: a failure above aborted the transaction, which the caller rolls back with the switch.
  for (const table of BULK_TABLES) await tx.execute(sql.raw(`alter table public.${table} enable trigger user`));

  // 3d Task 7: refused uploads. The image row and its match record go through their own triggers; the refusal, written by
  // the hundred in a year as no flow writes it, with its triggers off, so its time and its end are the year's.
  if (cells.uploads) {
    await tx.execute(sql`alter table public.upload_refusals disable trigger user`);
    for (const [label, n] of Object.entries(cells.uploads) as ["report" | "no_report" | "open", number][]) {
      for (let g = 0; g < n; g++) {
        const mediaId = await newImageRow(tx, authorId, null);
        const matchId = await matchForTest(tx, mediaId, "acting");
        const refusedAt = sql`make_timestamptz(${year}::int, ${1 + (g % 11)}::int, ${1 + (g % 28)}::int, 12, 0, 0, 'UTC')`;
        const endedAt = label === "open" ? sql`null::timestamptz` : sql`make_timestamptz(${year}::int, ${2 + (g % 11)}::int, ${1 + (g % 28)}::int, 12, 0, 0, 'UTC')`;
        await tx.execute(sql`
          insert into public.upload_refusals (media_id, owner_id, match_id, refused_at, end_as, end_reason, ended_at, ended_by)
          values (${mediaId}::uuid, ${authorId}::uuid, ${matchId}::uuid, ${refusedAt}, ${label === "open" ? null : label}, ${label === "no_report" ? "other" : null},
                  ${endedAt}, ${label === "open" ? null : staff.id}::uuid)`);
      }
    }
    await tx.execute(sql`alter table public.upload_refusals enable trigger user`);
  }

  const orders: OrderView[] = [];
  for (const cell of cells.orders ?? []) orders.push(await orderOfYear(tx, year, cell, staff));
  return { caseId, orders, spareIds };
}

/**
 * One order of a year, as cli-counts.test.ts's fixture writes one: opened on new posts, its first `effectOn` items given
 * effect, its receipt recorded so many minutes before its last disabling, then every time of it moved back by whole
 * minutes so that its last disabling falls on `disabledAt`. A held one has Section C, so its order decisions are untold,
 * and its hold's recorded end at `heldUntil`.
 */
async function orderOfYear(tx: DbTx, year: number, cell: OrderCell, staff: TestStaff): Promise<OrderView> {
  const posts: string[] = [];
  for (let n = 0; n < cell.posts; n++) posts.push((await imagePost(tx, 1)).postId);
  const order = await orderForTest(tx, staff, { posts, memberState: cell.memberState ?? "DE", sectionC: cell.heldUntil !== undefined });
  const chosen = order.items.slice(0, cell.effectOn ?? order.items.length).map((item) => item.id);
  const view = chosen.length === 0 ? order : await effectWith(tx, staff, order.id, effectParams(order, { itemIds: chosen }));
  if (cell.receivedBefore !== undefined) {
    await tx.execute(sql`update public.legal_orders set received_at = coalesce((select max(disabled_at) from public.legal_order_items where order_id = ${order.id}::uuid), opened_at)
                                                                     - make_interval(mins => ${cell.receivedBefore}::int)
                          where id = ${order.id}::uuid`);
  }
  const target = cell.disabledAt ?? new Date(Date.UTC(year, 5, 15, 12));
  const [last] = await tx.execute<{ at: string }>(sql`select coalesce(max(disabled_at), (select opened_at from public.legal_orders where id = ${order.id}::uuid))::text as at
                                                       from public.legal_order_items where order_id = ${order.id}::uuid`);
  await ageOrderForTest(tx, order.id, Math.round((new Date(last!.at).getTime() - target.getTime()) / 60_000));
  if (cell.heldUntil !== undefined) {
    await tx.execute(sql`update public.legal_orders set hold_ended_at = ${cell.heldUntil.toISOString()}::timestamptz, hold_end_reason = 'released_by_authority'
                          where id = ${order.id}::uuid`);
  }
  return view;
}
