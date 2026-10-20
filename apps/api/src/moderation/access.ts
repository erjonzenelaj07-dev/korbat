import { sql } from "drizzle-orm";
import type { Db } from "@korbat/db";
import { imageModerationStates } from "../media";
import { accountLink, postLink } from "./links";
import { iso, noticeRecords, rows, type Runner } from "./repo";

/**
 * The moderation part of an answer to a GDPR access request, drafted for the operator by `staff.js access-request` (3c
 * design, section 7.13). It is a draft: a person weighs it before anything is sent. It prints what korbat holds about
 * the requester's own content and conduct, and it never prints who reported them: every reporter's and notifier's
 * identity is withheld, by name of the rule, and each text another person wrote (a report's explanation and cited law,
 * a re-examination's statement) is printed apart, marked for the weighing the law asks for.
 *
 * The reads are this module's own tables on the API role. An image is named by its id and its stored state, read
 * through the media module, never opened; a sealed one is named and nothing more.
 */

export const ACCESS_WORDS = {
  /** Why no reporter's or notifier's identity is in the draft. */
  identities: "rights of others: GDPR Art. 15(4), recital 63",
  /** What stands beside every text another person wrote. */
  weigh: "send only after a person has weighed the writer's rights (C-203/22)",
  /** What stands on every case that holds an item of the urgent lane, open or closed. */
  authorities:
    "check the R2, Art. 18 and order records before sending: an authority may need the person not to be told yet, or national law may restrict access (GDPR Art. 23(1)(d))",
  /**
   * 3f (design, W.8): printed in the place of a case's part when an order's notice about its post is held; the operator
   * reads the draft, the person never does. `until` is the hold's end, or null while none is recorded.
   */
  noticeHeld: (until: string | null) =>
    `${until === null ? "An order's notice about this post is held, with no end recorded." : `An order's notice about this post is held until ${until}.`} Leave the order, the post and every decision marked below out of the answer, and note the reason in the operator's records, not in the answer.`,
  /**
   * 3f Task 5 (design, W.8): printed in place of a case's mark for the authorities' check when a notification record of
   * the case carries an authority's demand that the person is not told, whose end is ahead or open. `day` is that end as
   * a UTC day, or null while it is open.
   */
  authorityHold: (day: string | null) =>
    `${day === null ? "An authority asked that this person is not told of its request (no end given yet)." : `An authority asked that this person is not told of its request (until ${day}).`} Do not send this case's part of the draft, and do not say that an authority is the reason, before counsel has read it.`,
  /** The source of an item, as a category: never a count, a name or a report's words. */
  // 3d Task 6: a program's finding is "found by an automated check of korbat's own", as the statement says (W.3).
  sources: { report: "a report by another user", notice: "a notice under Article 16", finding: "found by a moderator", automated: "found by an automated check of korbat's own" },
} as const;

/** A part of the draft, printed as JSON for the operator: nothing reads it back. */
type Json = unknown;

/** Ids as one uuid[] parameter. */
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The greatest uuid below this one, or null for the lowest: PostgreSQL orders uuids as 128-bit numbers, so a page of one
 * row after it starts at the id itself when a row has it. That reads one image row by its id through the one function
 * this module may read image rows with.
 */
export function uuidBefore(id: string): string | null {
  if (!UUID.test(id)) throw new TypeError("not a lower-case uuid");
  const value = BigInt(`0x${id.replaceAll("-", "")}`);
  if (value === 0n) return null;
  const hex = (value - 1n).toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The stored state of each of these images, "gone" for one whose row no longer exists. */
async function imageStates(q: Runner, ids: readonly string[]): Promise<Map<string, string>> {
  const states = new Map<string, string>();
  for (const id of new Set(ids)) {
    if (!UUID.test(id)) continue;
    const [row] = await imageModerationStates(q as Db, uuidBefore(id), 1);
    states.set(id, row?.id === id ? row.moderationState : "gone");
  }
  return states;
}

/** What an intake alleged, in one word. */
const groundOf = (row: { csam: boolean; alleges_illegal: boolean }) => (row.csam ? "child sexual abuse material" : row.alleges_illegal ? "illegal content" : "a korbat rule");

/** The notices and reports these intakes are, each with its items as their sender is shown them: for the requester's own reports, and for a notifier's. */
async function noticesWhere(q: Runner, appOrigin: string, where: ReturnType<typeof sql>): Promise<Json[]> {
  // The same read the sender's own export takes its reports' records from.
  const intakes = await noticeRecords(q, where);
  if (intakes.length === 0) return [];
  const items = await rows<{ intake_id: string; position: number; target_type: "post" | "account"; target_id: string; named_handle: string | null; shown: string | null; reexamination: boolean; statement: string | null }>(
    q,
    sql`select i.intake_id, i.position, i.target_type, i.target_id, i.named_handle, i.shown_outcome::text as shown, i.reexamines_item_id is not null as reexamination, i.statement
          from intake_items i where i.intake_id = any(${uuids(intakes.map((row) => row.id))}) order by i.intake_id, i.position, i.created_at, i.id`,
  );
  return intakes.map((n) => ({
    ref: n.ref,
    receivedAt: n.receivedAt,
    ground: groundOf({ csam: n.csam, alleges_illegal: n.allegesIllegal }),
    rule: n.ruleId,
    category: n.category,
    // The sender's own words, while korbat still holds them.
    explanation: n.explanation,
    citedLaw: n.citedLaw,
    recordErased: n.erased,
    items: items
      .filter((item) => item.intake_id === n.id)
      .map((item) => ({
        item: item.position,
        // The address as the report named it: an account's under the handle it was named by, never a later one.
        link: item.target_type === "post" ? postLink(appOrigin, item.target_id) : accountLink(appOrigin, item.named_handle ?? ""),
        // Only what was released to the sender; an outcome that waits for the daily release is not shown here either.
        shownOutcome: item.shown,
        reexamination: item.reexamination,
        statement: item.statement,
      })),
  }));
}

export interface AccountAccessDraft {
  subject: { handle: string };
  cases: Json[];
  ownReports: Json[];
  withheld: { identities: { count: number; reason: string }; texts: Json[] };
}

/**
 * The draft for an account: every case about the account or one of its posts, whatever its outcome, with each item's
 * source category, ground, rule and category; its snapshots with their content unless it is withheld; every decision
 * with its statement's data and its texts while they are held; and the account's own appeals with their statements.
 * Then the account's own reports and notices. A case that holds an item of the urgent lane, open or closed, is marked
 * for the check of the authorities' records; 3f Task 5: a case whose notification record carries an authority's demand
 * that the person is not told, still running, is marked with access.authorityHold in that mark's place, from
 * `authorityHolds`, which the command line reads as the migrator (the API's role holds no grant on the records).
 */
export async function accessDraftForAccount(
  q: Runner,
  appOrigin: string,
  account: { id: string; handle: string },
  authorityHolds?: (caseIds: readonly string[]) => Promise<Map<string, string | null>>,
): Promise<AccountAccessDraft> {
  const cases = await rows<{
    id: string;
    target_type: "post" | "account";
    target_id: string;
    opened_at: string;
    closed_at: string | null;
    urgent: boolean;
    order_held: boolean;
    hold_until: string | null;
    held_decisions: string[];
  }>(
    q,
    // 3f: whether an order's notice about the case's post is held (an untold order decision about it), with the earliest
    // end of such a hold ('infinity' as null), and the case's decisions held with it (informed_at null).
    sql`select c.id, c.target_type, c.target_id, ${iso("c.opened_at")} as opened_at, ${iso("c.closed_at")} as closed_at,
               exists (select 1 from intake_items i where i.case_id = c.id and i.lane = 0) as urgent,
               (c.target_type = 'post' and exists (select 1 from decisions od join cases oc on oc.id = od.case_id
                                                    where od.kind::text = 'order' and od.informed_at is null and oc.target_type = 'post' and oc.target_id = c.target_id)) as order_held,
               (select ${iso("min(public.order_hold_until(oi.order_id)) filter (where public.order_hold_until(oi.order_id) < 'infinity'::timestamptz)")}
                  from decisions od join cases oc on oc.id = od.case_id join legal_order_items oi on oi.id = od.order_item_id
                 where od.kind::text = 'order' and od.informed_at is null and oc.target_type = 'post' and oc.target_id = c.target_id
                having bool_and(public.order_hold_until(oi.order_id) < 'infinity'::timestamptz)) as hold_until,
               coalesce((select array_agg(d.id order by d.decided_at, d.id) from decisions d where d.case_id = c.id and d.informed_at is null), '{}') as held_decisions
          from cases c
         where (c.target_type = 'account' and c.target_id = ${account.id}::uuid)
            or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = ${account.id}::uuid))
         order by c.opened_at, c.id`,
  );
  const ids = uuids(cases.map((row) => row.id));
  const items = await rows<{ case_id: string; kind: string; csam: boolean; alleges_illegal: boolean; rule_id: string | null; category: string; arrived_at: string; identified: boolean; explanation: string | null; cited_law: string | null; statement: string | null; intake_id: string }>(
    q,
    sql`select i.case_id, n.kind::text as kind, n.csam, n.alleges_illegal, n.rule_id, n.category, ${iso("i.created_at")} as arrived_at,
               (i.reporter_account_id is not null or n.contact_id is not null) as identified, n.explanation, n.cited_law, i.statement, n.id as intake_id
          from intake_items i join intakes n on n.id = i.intake_id where i.case_id = any(${ids}) order by i.case_id, i.seq`,
  );
  const snapshots = await rows<{ id: string; case_id: string; taken_at: string; erased_on: string | null; withheld: boolean; author_handle: string; post_state: string | null; body: string | null; media: { id: string; alt: string | null; width: number; height: number }[] | null; display_name: string | null; bio: string | null; handle: string | null }>(
    q,
    sql`select s.id, s.case_id, ${iso("s.taken_at")} as taken_at, to_char(s.erased_at at time zone 'UTC', 'YYYY-MM-DD') as erased_on, public.snapshot_withheld(s.id) as withheld,
               s.author_handle, s.post_state::text as post_state, s.body, s.media, s.display_name, s.bio, s.handle
          from evidence_snapshots s where s.case_id = any(${ids}) order by s.case_id, s.taken_at, s.id`,
  );
  const decisions = await rows<{ id: string; case_id: string; kind: string; outcome: string; ground: string | null; rule_id: string | null; rules_version: number; category: string; source: string; decided_at: string; redacted_on: string | null; facts: string | null; reason: string | null; legal_reference: string | null; has_facts: boolean; has_reason: boolean; has_legal: boolean }>(
    q,
    sql`select d.id, d.case_id, d.kind::text as kind, d.outcome::text as outcome, d.ground::text as ground, d.rule_id, d.rules_version, d.category, d.source::text as source,
               ${iso("d.decided_at")} as decided_at, to_char(d.redacted_at at time zone 'UTC', 'YYYY-MM-DD') as redacted_on,
               (select t.text from staff_texts t where t.digest = d.facts_digest) as facts,
               (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
               (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal_reference,
               d.facts_digest is not null as has_facts, d.reason_digest is not null as has_reason, d.legal_reference_digest is not null as has_legal
          from decisions d where d.case_id = any(${ids}) order by d.case_id, d.decided_at, d.id`,
  );
  const actions = await rows<{ decision_id: string; kind: string; media_id: string | null; no_effect: string | null }>(
    q,
    sql`select a.decision_id, a.kind::text as kind, a.media_id, a.no_effect from decision_actions a
         where a.decision_id = any(${uuids(decisions.map((row) => row.id))}) order by a.decision_id, a.kind::text, a.media_id`,
  );
  const appeals = await rows<{ decision_id: string; case_id: string; filed_at: string; statement: string | null; erased: boolean; result: string | null; answered_at: string | null }>(
    q,
    sql`select a.decision_id, d.case_id, ${iso("a.filed_at")} as filed_at, a.statement, a.erased_at is not null as erased, a.result::text as result, ${iso("a.answered_at")} as answered_at
          from appeals a join decisions d on d.id = a.decision_id
         where d.case_id = any(${ids}) and a.appellant_account_id = ${account.id}::uuid order by a.filed_at, a.id`,
  );
  // Each image a shown snapshot lists, by its stored state now.
  const states = await imageStates(q, snapshots.filter((s) => !s.withheld).flatMap((s) => (s.media ?? []).map((image) => image.id)));

  /** A statement text: the text while korbat holds it, and whether one was ever given. */
  const text = (given: boolean, held: string | null): Json => (given ? (held === null ? { erased: true } : held) : null);
  const withheldTexts: Json[] = [];
  const seenIntakes = new Set<string>();
  for (const item of items) {
    // A report's own words stand once for its intake, a re-examination's statement for its item.
    if (!seenIntakes.has(`${item.case_id}:${item.intake_id}`)) {
      seenIntakes.add(`${item.case_id}:${item.intake_id}`);
      if (item.explanation !== null) withheldTexts.push({ caseId: item.case_id, kind: "explanation", text: item.explanation, note: ACCESS_WORDS.weigh });
      if (item.cited_law !== null) withheldTexts.push({ caseId: item.case_id, kind: "cited_law", text: item.cited_law, note: ACCESS_WORDS.weigh });
    }
    if (item.statement !== null) withheldTexts.push({ caseId: item.case_id, kind: "reexamination_statement", text: item.statement, note: ACCESS_WORDS.weigh });
  }

  const holds = authorityHolds === undefined ? new Map<string, string | null>() : await authorityHolds(cases.map((c) => c.id));
  /** The authority's mark of a case, when one runs. */
  const authorityHold = (caseId: string) => (holds.has(caseId) ? ACCESS_WORDS.authorityHold(holds.get(caseId)!) : null);
  return {
    subject: { handle: account.handle },
    cases: cases.map((c) =>
      // 3f (section 7.10): a case about a post whose order's notice is held is marked for the operator in the place of its
      // part, and nothing of the order, the post or a decision held with it is in what the draft offers to send.
      c.order_held || c.held_decisions.length > 0
        ? { id: c.id, noticeHeld: ACCESS_WORDS.noticeHeld(c.hold_until), heldDecisions: c.held_decisions, authorityHold: authorityHold(c.id) }
        : {
      id: c.id,
      target: c.target_type === "post" ? { type: "post", link: postLink(appOrigin, c.target_id) } : { type: "account", link: accountLink(appOrigin, account.handle) },
      openedAt: c.opened_at,
      closedAt: c.closed_at,
      // 3f Task 5 (W.8): an authority's demand that the person is not told stands in place of the mark for the check.
      authoritiesCheck: holds.has(c.id) ? null : c.urgent ? ACCESS_WORDS.authorities : null,
      authorityHold: authorityHold(c.id),
      items: items
        .filter((item) => item.case_id === c.id)
        .map((item) => ({
          source:
            item.kind === "finding"
              ? ACCESS_WORDS.sources.finding
              : item.kind === "automated"
                ? ACCESS_WORDS.sources.automated
                : item.alleges_illegal
                  ? ACCESS_WORDS.sources.notice
                  : ACCESS_WORDS.sources.report,
          ground: groundOf(item),
          rule: item.rule_id,
          category: item.category,
          arrivedAt: item.arrived_at,
        })),
      snapshots: snapshots
        .filter((s) => s.case_id === c.id)
        .map((s) =>
          s.withheld
            ? // An erased copy with the day it went and no content; a copy of content erased since is withheld the same way.
              { id: s.id, takenAt: s.taken_at, erasedOn: s.erased_on, withheld: true, content: null }
            : {
                id: s.id,
                takenAt: s.taken_at,
                erasedOn: null,
                withheld: false,
                content: {
                  authorHandle: s.author_handle,
                  postState: s.post_state,
                  body: s.body,
                  displayName: s.display_name,
                  bio: s.bio,
                  handle: s.handle,
                  // A sealed image is named by its id and its state and nothing more.
                  media: (s.media ?? []).map((image) => (states.get(image.id) === "sealed" ? { id: image.id, state: "sealed" } : { id: image.id, state: states.get(image.id) ?? "gone", alt: image.alt, width: image.width, height: image.height })),
                },
              },
        ),
      decisions: decisions
        .filter((d) => d.case_id === c.id)
        .map((d) => ({
          id: d.id,
          kind: d.kind,
          outcome: d.outcome,
          ground: d.ground,
          rule: d.rule_id,
          rulesVersion: d.rules_version,
          category: d.category,
          source: d.source,
          decidedAt: d.decided_at,
          contentErasedOn: d.redacted_on,
          measures: actions.filter((a) => a.decision_id === d.id).map((a) => ({ kind: a.kind, image: a.media_id, noEffect: a.no_effect })),
          facts: text(d.has_facts, d.facts),
          reason: text(d.has_reason, d.reason),
          legalReference: text(d.has_legal, d.legal_reference),
        })),
      appeals: appeals
        .filter((a) => a.case_id === c.id)
        .map((a) => ({ decisionId: a.decision_id, filedAt: a.filed_at, statement: a.erased ? { erased: true } : a.statement, result: a.result, answeredAt: a.answered_at })),
          },
    ),
    ownReports: await noticesWhere(q, appOrigin, sql`n.reporter_id = ${account.id}::uuid`),
    withheld: { identities: { count: items.filter((item) => item.identified).length, reason: ACCESS_WORDS.identities }, texts: withheldTexts },
  };
}

export interface ContactsAccessDraft {
  contacts: { name: string | null; notices: Json[] }[];
}

/** The draft for a signed-out notifier, by the contacts the auth module found for their address: the name each gave and the notices filed under it. */
export async function accessDraftForContacts(q: Runner, appOrigin: string, contacts: readonly { id: string; name: string | null }[]): Promise<ContactsAccessDraft> {
  const drafted: ContactsAccessDraft["contacts"] = [];
  for (const contact of contacts) drafted.push({ name: contact.name, notices: await noticesWhere(q, appOrigin, sql`n.contact_id = ${contact.id}::uuid`) });
  return { contacts: drafted };
}
