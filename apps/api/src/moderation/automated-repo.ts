import { sql } from "drizzle-orm";
import { ALERT_KINDS, statementMatchKind, type AutomatedDecidedParams, type CaseFlag, type MatchHashType, type MatchKind, type SignalHandled, type SignalKind, type StatementSignal } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { iso, rows, type Runner } from "./repo";

/**
 * The automated decision's statements (3d design, sections 6.6, 7.9 and 7.10; Task 6): the signals, a decision without a
 * decider, the requests for a person, and what the case page, the queue, the home screen and the statement read of them.
 * Every write is the API's role's, through the grants and triggers of the migration automated_decisions: a signal's last
 * four columns are set once each, an objection is inserted once and refused unless its decision's measure is in force,
 * and a decision without a decider stands only when decision_holds passes at commit.
 */

/** A signal as the step reads it. */
export interface SignalRow {
  id: string;
  kind: SignalKind;
  mediaId: string;
  score: number | null;
  thresholdVersion: number | null;
  /** 3d Task 7: a known_match's record; null for a score. */
  matchId: string | null;
  createdAt: string;
  intakeItemId: string | null;
  decisionId: string | null;
  handledAt: string | null;
  handled: SignalHandled | null;
}

type RawSignal = {
  id: string;
  kind: SignalKind;
  media_id: string;
  score: number | null;
  threshold_version: number | null;
  match_id: string | null;
  created_at: string;
  intake_item_id: string | null;
  decision_id: string | null;
  handled_at: string | null;
  handled: SignalHandled | null;
};

const SIGNAL_COLUMNS = sql`s.id, s.kind, s.media_id, s.score, s.threshold_version, s.match_id, ${iso("s.created_at")} as created_at, s.intake_item_id, s.decision_id, ${iso("s.handled_at")} as handled_at, s.handled`;

const signalOfRow = (row: RawSignal): SignalRow => ({
  id: row.id,
  kind: row.kind,
  mediaId: row.media_id,
  score: row.score === null ? null : Number(row.score),
  thresholdVersion: row.threshold_version,
  matchId: row.match_id,
  createdAt: row.created_at,
  intakeItemId: row.intake_item_id,
  decisionId: row.decision_id,
  handledAt: row.handled_at,
  handled: row.handled,
});

/**
 * Step 1 of the automated step (7.9): the signal of a score, one statement that does nothing when the image has a
 * signal of the kind already, handled or not (automated_signals_one is over all rows), so a handled one is never written
 * again beside it. Answers the new signal's id, or null when there was one.
 */
export async function insertScoreSignal(q: Runner, signal: { mediaId: string; score: number; thresholdVersion: number }): Promise<string | null> {
  const [row] = await rows<{ id: string }>(
    q,
    sql`insert into public.automated_signals (kind, media_id, score, threshold_version)
        values ('r1_score', ${signal.mediaId}::uuid, ${signal.score}::real, ${signal.thresholdVersion}::smallint)
        on conflict (media_id, kind) do nothing
        returning id`,
  );
  return row?.id ?? null;
}

/**
 * 3d Task 7 (7.9 step 1): the signal of a match record of an image on a post, one statement that does nothing when the
 * image has a match's signal already, handled or not. Answers the new signal's id, or null when there was one.
 */
export async function insertMatchSignal(q: Runner, signal: { mediaId: string; matchId: string }): Promise<string | null> {
  const [row] = await rows<{ id: string }>(
    q,
    sql`insert into public.automated_signals (kind, media_id, match_id)
        values ('known_match', ${signal.mediaId}::uuid, ${signal.matchId}::uuid)
        on conflict (media_id, kind) do nothing
        returning id`,
  );
  return row?.id ?? null;
}

/** A signal by its id, or null. Inside the step it is a statement of its own after the profile's lock. */
export async function signalOf(q: Runner, signalId: string): Promise<SignalRow | null> {
  const [row] = await rows<RawSignal>(q, sql`select ${SIGNAL_COLUMNS} from public.automated_signals s where s.id = ${signalId}::uuid`);
  return row ? signalOfRow(row) : null;
}

/** The image's signal of a kind, or null. */
export async function signalFor(q: Runner, mediaId: string, kind: SignalKind): Promise<SignalRow | null> {
  const [row] = await rows<RawSignal>(q, sql`select ${SIGNAL_COLUMNS} from public.automated_signals s where s.media_id = ${mediaId}::uuid and s.kind = ${kind}`);
  return row ? signalOfRow(row) : null;
}

/** Step 2.2's last write: the finding's item on its signal, once (the guard refuses a second). */
export async function joinSignal(tx: DbTx, signalId: string, itemId: string): Promise<void> {
  await tx.execute(sql`update public.automated_signals set intake_item_id = ${itemId}::uuid where id = ${signalId}::uuid`);
}

/**
 * What the step did with the signal, once, with the decision of a measure: `measure` names its decision, every other end
 * names none. The guard forces handled_at to the database's now().
 */
export async function signalHandled(tx: DbTx, signalId: string, handled: SignalHandled, decisionId: string | null = null): Promise<void> {
  await tx.execute(sql`update public.automated_signals set handled = ${handled}, handled_at = now(), decision_id = ${decisionId}::uuid where id = ${signalId}::uuid`);
}

/**
 * A decision without a decider (7.9 step 2.4), from the params the system's audit row will carry: no decider and no text;
 * everything else the row holds is the triggers'. The id is the API's, so the audit row and the signal can name it.
 */
export async function insertSystemDecision(tx: DbTx, row: { id: string; caseId: string; params: AutomatedDecidedParams }): Promise<void> {
  const p = row.params;
  await tx.execute(
    sql`insert into public.decisions (id, case_id, kind, reviews_decision_id, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, category_keyword,
                                      snapshot_id, snapshot_digest, facts_digest, reason_digest, legal_reference_digest, decided_by)
        values (${row.id}::uuid, ${row.caseId}::uuid, ${p.kind}::decision_kind, null, ${p.stateVersion}::int, ${p.throughSeq}::int, ${p.outcome}::decision_outcome,
                ${p.ground}::decision_ground, ${p.ruleId}, ${p.rulesVersion}::smallint, ${p.redressVersion}::smallint, ${p.category}, null,
                ${p.snapshotId}::uuid, ${p.snapshotDigest}, null, null, null, null)`,
  );
}

/**
 * The sweep's own read (7.9, "What starts it"): the signals of these kinds that no step handled, between one minute and
 * `hours` hours old, the oldest first: what a crash or a failed step left. The minute leaves a step started by an entry
 * its time to commit.
 */
export async function unhandledSignals(q: Runner, kinds: readonly SignalKind[], hours: number, limit: number): Promise<string[]> {
  if (kinds.length === 0 || limit <= 0) return [];
  const found = await rows<{ id: string }>(
    q,
    sql`select s.id from public.automated_signals s
         where s.handled_at is null and s.kind = any(${`{${kinds.join(",")}}`}::text[])
           and s.created_at < now() - make_interval(mins => 1) and s.created_at > now() - make_interval(hours => ${hours}::int)
         order by s.created_at, s.id limit ${limit}::int`,
  );
  return found.map((row) => row.id);
}

/**
 * The fact `count` of the alert automation_capped: the findings that stand without a measure since the cap was met, that
 * is the signals handled `capped` since the newest one a program took a measure on.
 */
export async function cappedSinceLastMeasure(q: Runner): Promise<number> {
  const [row] = await rows<{ n: number }>(
    q,
    sql`select count(*)::int as n from public.automated_signals s
         where s.handled = 'capped'
           and s.handled_at >= coalesce((select max(m.handled_at) from public.automated_signals m where m.handled = 'measure'), '-infinity'::timestamptz)`,
  );
  return row!.n;
}

// ---------------------------------------------------------------- "Ask for a person"

/** The one statement that writes an objection; its trigger refuses objection_not_open, and a second one meets the key. */
export async function insertObjection(q: Runner, decisionId: string, text: string): Promise<void> {
  await q.execute(sql`insert into public.automated_objections (decision_id, text) values (${decisionId}::uuid, ${text})`);
}

/** The requests for a person whose measure is in force: unanswered, since nothing stores an answer. With the oldest's time. */
export async function objectionsWaiting(q: Runner): Promise<{ count: number; oldestAt: string | null }> {
  const [row] = await rows<{ n: number; oldest: string | null }>(
    q,
    sql`select count(*)::int as n, ${iso("min(o.created_at)")} as oldest from public.automated_objections o
         where exists (select 1 from public.measures_in_force m where m.decision_id = o.decision_id)`,
  );
  return { count: row!.n, oldestAt: row!.oldest };
}

/**
 * The sweep's daily alert automated_waiting (7.14, "Alerts a job writes"): when requests for a person have waited longer
 * than the published target with their measures in force, one row of the outbox with their count and the oldest one's
 * time, under F's daily rule: none while a row of the kind was written in the last 24 hours. Answers whether it wrote one.
 */
export async function automatedWaitingAlert(q: Runner, targetHours: number): Promise<boolean> {
  const entry = ALERT_KINDS.automated_waiting;
  const written = await rows<{ id: string }>(
    q,
    sql`insert into public.alert_outbox (kind, priority, scope, facts)
        select 'automated_waiting', ${entry.priority}, ${entry.scope},
               jsonb_build_object('count', w.n, 'oldestAt', to_char(w.oldest at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          from (select count(*)::int as n, min(o.created_at) as oldest from public.automated_objections o
                 where o.created_at < now() - make_interval(hours => ${targetHours}::int)
                   and exists (select 1 from public.measures_in_force m where m.decision_id = o.decision_id)) w
         where w.n > 0
           and not exists (select 1 from public.alert_outbox x where x.kind = 'automated_waiting' and x.created_at > now() - make_interval(hours => 24))
        returning id`,
  );
  return written.length > 0;
}

// ---------------------------------------------------------------- what staff read

/** Home's two counts of a program's measures (8.2): those in force waiting for a person, and those whose author asked for one. */
export async function automatedOverview(q: Runner, max: number): Promise<{ waiting: number; oldestAt: string | null; objected: number; oldestObjectionAt: string | null; cases: string[]; objectedCases: string[] }> {
  const [waiting] = await rows<{ n: number; oldest: string | null; cases: string[] | null }>(
    q,
    sql`select count(*)::int as n, ${iso("min(w.decided_at)")} as oldest,
               (select array_agg(c.case_id order by c.at, c.case_id) from (select x.case_id, min(x.decided_at) as at from (
                  select d.case_id, d.decided_at from public.measures_in_force m join public.decisions d on d.id = m.decision_id where d.decided_by is null) x
                 group by x.case_id order by min(x.decided_at), x.case_id limit ${max}::int) c) as cases
          from (select d.case_id, d.decided_at from public.measures_in_force m join public.decisions d on d.id = m.decision_id where d.decided_by is null) w`,
  );
  const [objected] = await rows<{ n: number; oldest: string | null; cases: string[] | null }>(
    q,
    sql`select count(*)::int as n, ${iso("min(w.created_at)")} as oldest,
               (select array_agg(c.case_id order by c.at, c.case_id) from (select x.case_id, min(x.created_at) as at from (
                  select d.case_id, o.created_at from public.automated_objections o join public.decisions d on d.id = o.decision_id
                   where exists (select 1 from public.measures_in_force m where m.decision_id = o.decision_id)) x
                 group by x.case_id order by min(x.created_at), x.case_id limit ${max}::int) c) as cases
          from (select d.case_id, o.created_at from public.automated_objections o join public.decisions d on d.id = o.decision_id
                 where exists (select 1 from public.measures_in_force m where m.decision_id = o.decision_id)) w`,
  );
  return {
    waiting: waiting!.n,
    oldestAt: waiting!.oldest,
    objected: objected!.n,
    oldestObjectionAt: objected!.oldest,
    cases: waiting!.cases ?? [],
    objectedCases: objected!.cases ?? [],
  };
}

/**
 * The case page's items a program opened (CaseView.signals): each item with its signal's kind and threshold's version,
 * and (3d Task 7) a match's record id, which the media module reads the record by.
 */
export async function caseSignals(q: Runner, caseId: string): Promise<{ itemId: string; kind: SignalKind; thresholdVersion: number | null; matchId: string | null }[]> {
  const found = await rows<{ item_id: string; kind: SignalKind; threshold_version: number | null; match_id: string | null }>(
    q,
    sql`select s.intake_item_id as item_id, s.kind, s.threshold_version, s.match_id from public.automated_signals s join public.intake_items i on i.id = s.intake_item_id
         where i.case_id = ${caseId}::uuid order by i.seq, s.id`,
  );
  return found.map((row) => ({ itemId: row.item_id, kind: row.kind, thresholdVersion: row.threshold_version, matchId: row.match_id }));
}

/**
 * 3d Task 7 (QueueRow.matchFlag, StaffOverview.automated.flags): for each of these cases, whether it holds an unanswered
 * item of a program's finding that cites no rule (a match of another class); and the count of open cases that do.
 */
export async function matchFlagCases(q: Runner, caseIds: readonly string[]): Promise<Set<string>> {
  if (caseIds.length === 0) return new Set();
  const found = await rows<{ case_id: string }>(
    q,
    sql`select distinct i.case_id from public.intake_items i join public.intakes k on k.id = i.intake_id
         where i.case_id = any(${`{${caseIds.join(",")}}`}::uuid[]) and i.answered_by is null and k.kind::text = 'automated' and k.rule_id is null`,
  );
  return new Set(found.map((row) => row.case_id));
}
export async function matchFlagCount(q: Runner): Promise<number> {
  const [row] = await rows<{ n: number }>(
    q,
    sql`select count(distinct i.case_id)::int as n from public.intake_items i join public.intakes k on k.id = i.intake_id join public.cases c on c.id = i.case_id
         where c.closed_at is null and i.answered_by is null and k.kind::text = 'automated' and k.rule_id is null`,
  );
  return row!.n;
}

// ---------------------------------------------------------------- the flag "possible coordinated reporting" (Task 8)

/**
 * 3d Task 8 (design, sections 2 rows 47 and 48, 6.8 and 7.13): the flag of each of the queue page's cases, in one
 * statement over the database's case_flag, keyed by case; a case appears only while the function answers true. These two
 * reads are case_flag's only callers (a source test holds that): the queue's, after its page is read, so the flag is no
 * key of the order, and the case answer's below. Nothing stores the answer, and no decision reads it.
 */
export async function queueFlags(q: Runner, caseIds: readonly string[]): Promise<Map<string, CaseFlag>> {
  if (caseIds.length === 0) return new Map();
  const found = await rows<{ case_id: string; items: number; reporters: number }>(
    q,
    sql`select c.id as case_id, f.items, f.reporters
          from unnest(${`{${caseIds.join(",")}}`}::uuid[]) as c(id) cross join lateral public.case_flag(c.id) f
         where f.coordinated`,
  );
  return new Map(found.map((row) => [row.case_id, { items: row.items, reporters: row.reporters }]));
}

/** The case answer's read of its own case's flag ([case.flag]): the two counts while case_flag answers true, else null. */
export async function caseFlag(q: Runner, caseId: string): Promise<CaseFlag | null> {
  const [row] = await rows<{ coordinated: boolean; items: number; reporters: number }>(q, sql`select f.coordinated, f.items, f.reporters from public.case_flag(${caseId}::uuid) f`);
  return row !== undefined && row.coordinated ? { items: row.items, reporters: row.reporters } : null;
}

/**
 * 3d Task 8 (design, sections 6.8 and 7.14): the retention job's step automation_records, one call of the database's
 * erase_automation_records in the step's transaction. The function decides every rule itself, against the database's
 * clock and automation_rules(), so the job names nothing and the API learns only how many rows it changed.
 */
export async function eraseAutomationRecords(tx: DbTx): Promise<number> {
  const [row] = await rows<{ n: number }>(tx, sql`select public.erase_automation_records() as n`);
  return row!.n;
}

/**
 * 3d Task 8 (W.10): the text the decision's subject sent with "Ask for a person", with its time, while korbat keeps it
 * (erase_automation_records takes the text with its decision's texts), for the export's entry of that decision; null for a
 * decision without one.
 */
export async function objectionOf(q: Runner, decisionId: string): Promise<{ text: string; createdAt: string } | null> {
  const [row] = await rows<{ text: string; created_at: string }>(
    q,
    sql`select o.text, ${iso("o.created_at")} as created_at from public.automated_objections o where o.decision_id = ${decisionId}::uuid and o.text is not null`,
  );
  return row ? { text: row.text, createdAt: row.created_at } : null;
}

/** The request for a person about a program's measure in force on the case (CaseView.objection), or null; the oldest when several stand. */
export async function caseObjection(q: Runner, caseId: string): Promise<{ text: string; createdAt: string } | null> {
  const [row] = await rows<{ text: string; created_at: string }>(
    q,
    sql`select o.text, ${iso("o.created_at")} as created_at from public.automated_objections o join public.decisions d on d.id = o.decision_id
         where d.case_id = ${caseId}::uuid and o.text is not null and exists (select 1 from public.measures_in_force m where m.decision_id = o.decision_id)
         order by o.created_at limit 1`,
  );
  return row ? { text: row.text, createdAt: row.created_at } : null;
}

/**
 * 3d Task 7 (design, sections 7.11 step 6 and W.8): whether the decision's case holds a program's finding on a match, of
 * either kind: moderation_csam_lifted then goes in its variant that leaves out "staff may open them".
 */
export async function decisionCaseHasMatch(q: Runner, decisionId: string): Promise<boolean> {
  const [row] = await rows<{ matched: boolean }>(
    q,
    sql`select exists (select 1 from public.decisions d join public.intake_items i on i.case_id = d.case_id join public.automated_signals s on s.intake_item_id = i.id
                        where d.id = ${decisionId}::uuid and s.kind = 'known_match') as matched`,
  );
  return row!.matched;
}

// ---------------------------------------------------------------- what the statement reads

/**
 * The automated finding a statement speaks of (DecisionStatement.signal; 7.10, 10.2), read from the decision's own
 * columns and its signal, never from a later event. A decision without a decider: its own signal. A person's decision:
 * the first program's item it considered (a final decision the items it answered; one taken while deciding the items
 * unanswered at its time), and a correction or a review the decision it is about's. For a score, `viewed` is true on a
 * person's decision when the case's access log holds that person's view of the signal's image on this case before the
 * decision and the decision is not stored as unseen; null on a program's. Null when the decision considered no program's
 * finding. It reads the program's items and nothing of a report: no sender, no word and no count.
 */
export async function statementSignal(q: Runner, decisionId: string, matchOf?: (matchId: string) => Promise<{ source: string; hashType: MatchHashType; matchKind: MatchKind; listed: boolean } | null>): Promise<StatementSignal | null> {
  const [row] = await rows<{ kind: SignalKind; viewed: boolean | null; match_id: string | null }>(
    q,
    sql`with d as (select x.id, x.case_id, x.kind, x.decided_by, x.decided_at, x.unseen, x.reviews_decision_id from public.decisions x where x.id = ${decisionId}::uuid),
             -- The decision whose considered items count: the reviewed one for a review or a correction, else itself.
             c as (select coalesce(r.id, d.id) as id, coalesce(r.decided_by, d.decided_by) as decided_by, coalesce(r.kind, d.kind) as kind,
                          coalesce(r.decided_at, d.decided_at) as decided_at, d.case_id
                     from d left join public.decisions r on r.id = d.reviews_decision_id and d.kind::text in ('review', 'correction'))
        select s.kind, s.match_id,
               case when d.decided_by is null then null
                    else not d.unseen and exists (select 1 from public.case_access_log l
                                                    where l.case_id = d.case_id and l.staff_id = d.decided_by and l.kind = 'image_viewed'
                                                      and l.media_id = s.media_id and l.at < d.decided_at) end as viewed
          from d, c, public.automated_signals s
         where (c.decided_by is null and s.decision_id = c.id)
            or (c.decided_by is not null and s.intake_item_id in (
                  select i.id from public.intake_items i
                   where i.case_id = c.case_id
                     and case when c.kind::text = 'final' then i.answered_by = c.id
                              else i.created_at <= c.decided_at
                                   and (i.answered_by is null or (select a.decided_at from public.decisions a where a.id = i.answered_by) > c.decided_at) end))
         order by s.created_at, s.id limit 1`,
  );
  if (!row) return null;
  if (row.kind === "known_match") {
    // 3d Task 7 (10.2, W.3): the source's name, the kind of match derived from the hash type (exact only for a
    // cryptographic hash's exact match) and whether the source lists the class; never the hash type, the list version or
    // the classification string. viewed is null for a match: nobody at korbat opens such an image.
    const record = row.match_id === null || matchOf === undefined ? null : await matchOf(row.match_id);
    if (record === null) return { kind: row.kind, source: null, matchKind: null, listedAs: null, viewed: null };
    return { kind: row.kind, source: record.source, matchKind: statementMatchKind(record.hashType, record.matchKind), listedAs: record.listed ? "csam" : "other", viewed: null };
  }
  return { kind: row.kind, source: null, matchKind: null, listedAs: null, viewed: row.viewed };
}
