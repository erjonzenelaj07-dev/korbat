/**
 * automation-status (3d design, section 8.10; Task 6), in the api service, on the API's own role, read-only:
 *
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js automation-status
 *
 * A line each: the edge's purge adapter and its outbox; the R1 check, whether it acts, its model and threshold version,
 * and the two days of its impact assessment; known material; the head's witness, its last value and the keeper's mail;
 * whether signed-out readers are counted; what a program found today and what its sweep gave up on; and the use of every
 * limit of a program, by rule. It runs in the api service because what it reports are the API's settings, which it reads
 * with loadConfig as the server does, and the database is read in one REPEATABLE READ READ ONLY transaction as the API's
 * role: it writes nothing, and prints no token, no address, no score and no text.
 *
 * The caps count what decisions_record counts: a program's decisions under one rule in the hour and the 24 hours before
 * now, rolling, so the lines say so. "Today" is the UTC day, as the transparency figures count days.
 *
 * 3d Task 7: the comparison with known material, whether its match seals, its two impact assessments' days, the uploads
 * whose check is unanswered and the refusals of the last hour against the limit, read through the media module.
 *
 * This file has no entry point of its own, so both bundles can include it (build.mjs says why that matters).
 */
import { sql } from "drizzle-orm";
import { AUTOMATION_RULES, R1_TEST_THRESHOLD, SWEEP_HOURS } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { R1_TEST_MODEL } from "@korbat/media-protocol";
import type { Config } from "../config";
import { matchStatus, unscoredCount } from "../media";

export const AUTOMATION_USAGE = [
  `${"  automation-status".padEnd(41)}print each adapter of 3d, its settings and impact assessments, a program's findings today and`,
  `${"".padEnd(41)}the use of each of its limits; read-only; run it in the api service`,
];

/** The settings automation-status reports, each read as the server reads it. */
export type AutomationSettings = Pick<
  Config,
  | "EDGE_PURGE"
  | "R1_CLASSIFIER"
  | "AUTOMATION_R1_ACTS"
  | "AUTOMATION_DPIA_R1"
  | "AUTOMATION_DPIA_R1_ACTS"
  | "HEAD_WITNESS"
  | "HEAD_KEEPER_MAIL"
  | "RECIPIENTS_SIGNED_OUT"
  // 3d Task 7.
  | "MEDIA_MATCH"
  | "AUTOMATION_R2_ACTS"
  | "AUTOMATION_DPIA_MATCH"
  | "AUTOMATION_DPIA_MATCH_ACTS"
>;

/** What the database holds that automation-status reports, read in one statement. */
interface StatusRow {
  purges_waiting: number;
  purges_failed: number;
  head_day: string | null;
  head_witnessed: boolean | null;
  /** 3d review M13: when the relay accepted the last value's keeper's mail, or null. */
  head_mailed: string | null;
  found_r1: number;
  found_r2: number;
  found_none: number;
  given_up: number;
  r1_hour: number;
  r1_day: number;
  r2_hour: number;
  r2_day: number;
  r1_waiting: number;
  r2_waiting: number;
  oldest_request: string | null;
}

/** The R1 check's model, as the API names it: the test scorer's marker model, none while off, and the build's onnx model. */
function r1Model(settings: AutomationSettings): { name: string; thresholdVersion: number } {
  if (settings.R1_CLASSIFIER === "test") return { name: R1_TEST_MODEL, thresholdVersion: R1_TEST_THRESHOLD.thresholdVersion };
  // The onnx adapter is refused by this build's configuration (section 5), so off is the one other value that reaches here.
  return { name: "none", thresholdVersion: AUTOMATION_RULES.r1ThresholdVersion };
}

/** The lines of automation-status, from the settings and one read of the database. */
export async function automationStatus(q: Pick<Db, "execute"> | Pick<DbTx, "execute">, settings: AutomationSettings): Promise<string[]> {
  const c = "automation-status";
  const [row] = (await q.execute(sql`
    select (select count(*)::int from public.edge_purges p where p.outcome is null) as purges_waiting,
           (select count(*)::int from public.edge_purges p where p.outcome = 'failed' and p.done_at > now() - interval '24 hours') as purges_failed,
           h.day::text as head_day, h.token is not null as head_witnessed,
           to_char(h.keeper_mailed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as head_mailed,
           -- A program's findings since the start of the UTC day, by the rule each cites; the kind is compared as text (0038).
           (select count(*)::int from public.intakes i where i.kind::text = 'automated' and i.rule_id = 'R1' and i.received_at >= t.start) as found_r1,
           (select count(*)::int from public.intakes i where i.kind::text = 'automated' and i.rule_id = 'R2' and i.received_at >= t.start) as found_r2,
           (select count(*)::int from public.intakes i where i.kind::text = 'automated' and i.rule_id is null and i.received_at >= t.start) as found_none,
           -- The sweep reads the signals of the last SWEEP_HOURS hours; an older one left unhandled is one it gave up on.
           (select count(*)::int from public.automated_signals s where s.handled_at is null and s.created_at < now() - make_interval(hours => ${SWEEP_HOURS}::int)) as given_up,
           (select count(*)::int from public.decisions d where d.decided_by is null and d.rule_id = 'R1' and d.decided_at > now() - interval '1 hour') as r1_hour,
           (select count(*)::int from public.decisions d where d.decided_by is null and d.rule_id = 'R1' and d.decided_at > now() - interval '1 day') as r1_day,
           (select count(*)::int from public.decisions d where d.decided_by is null and d.rule_id = 'R2' and d.decided_at > now() - interval '1 hour') as r2_hour,
           (select count(*)::int from public.decisions d where d.decided_by is null and d.rule_id = 'R2' and d.decided_at > now() - interval '1 day') as r2_day,
           -- The measures of a program in force, by rule, as decisions_record counts them for its limit unanswered.
           (select count(*)::int from public.measures_in_force m join public.decisions d on d.id = m.decision_id where d.decided_by is null and d.rule_id = 'R1') as r1_waiting,
           (select count(*)::int from public.measures_in_force m join public.decisions d on d.id = m.decision_id where d.decided_by is null and d.rule_id = 'R2') as r2_waiting,
           (select to_char(min(o.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.automated_objections o
             where exists (select 1 from public.measures_in_force m where m.decision_id = o.decision_id)) as oldest_request
      from (select date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' as start) t
      left join lateral (select x.day, x.token, x.keeper_mailed_at from public.head_publications x
                          where x.kind = 'head' and x.published_at is not null and x.retired_at is null
                          order by x.day desc limit 1) h on true`)) as unknown as StatusRow[];
  const r = row!;
  const match = await matchStatus(q as Db);
  // 3d review L3: while the check is on, the ready uploads of the last 24 hours that carry no score.
  const unscored = settings.R1_CLASSIFIER === "off" ? null : await unscoredCount(q as Db);
  // 3d review M13: the last value's keeper's mail, as its row records it.
  const keeperLine =
    settings.HEAD_KEEPER_MAIL === undefined
      ? "not set: no daily mail is sent"
      : `set; the last value's mail ${r.head_day === null ? "none yet" : r.head_mailed === null ? "was not sent" : `was accepted ${r.head_mailed}`}`;
  const model = r1Model(settings);
  const day = (value: string | undefined) => value ?? "not set";
  const rules = AUTOMATION_RULES;
  return [
    `${c}: edge purge: ${settings.EDGE_PURGE}; ${r.purges_waiting} purges waiting, ${r.purges_failed} failed in 24 hours.`,
    `${c}: R1 check: ${settings.R1_CLASSIFIER}, acts ${settings.AUTOMATION_R1_ACTS}; model ${model.name}, threshold version ${model.thresholdVersion}; impact assessment ${day(settings.AUTOMATION_DPIA_R1)}, for its measure ${day(settings.AUTOMATION_DPIA_R1_ACTS)}${unscored === null ? "" : `; ${unscored} ready uploads of the last 24 hours have no score`}.`,
    // 3d Task 7 (8.10): the comparison, its measure, its two days, its unanswered checks and the hour's refusals.
    `${c}: known material: ${settings.MEDIA_MATCH}, acts ${settings.AUTOMATION_R2_ACTS}; impact assessment ${day(settings.AUTOMATION_DPIA_MATCH)}, for its measure ${day(settings.AUTOMATION_DPIA_MATCH_ACTS)}; ${match.unchecked} uploads unchecked, the oldest since ${match.oldestUnchecked ?? "none"}; refusals ${match.refusalsHour} of ${rules.refusalsPerHour} this hour.`,
    `${c}: head witness: ${settings.HEAD_WITNESS}; last value ${r.head_day ?? "none"}, witnessed ${r.head_day === null ? "no" : r.head_witnessed ? "yes" : "no"}; keeper's mail ${keeperLine}.`,
    `${c}: signed-out readers: ${settings.RECIPIENTS_SIGNED_OUT === "on" ? "counted" : "not counted"}.`,
    `${c}: a program's findings today: ${r.found_r1} under R1, ${r.found_r2} under R2, ${r.found_none} without a rule; signals the sweep left unhandled after ${SWEEP_HOURS} hours: ${r.given_up}.`,
    `${c}: a program's decisions under R1: ${r.r1_hour} of ${rules.decisionsPerHour} in the last hour, ${r.r1_day} of ${rules.decisionsPerDay} in the last 24 hours; under R2: ${r.r2_hour} of ${rules.r2DecisionsPerHour}, ${r.r2_day} of ${rules.r2DecisionsPerDay}.`,
    `${c}: a program's measures waiting for a person: under R1 ${r.r1_waiting} of ${rules.unansweredMax}, under R2 ${r.r2_waiting} of ${rules.unansweredMax}; the oldest unanswered request for a person: ${r.oldest_request ?? "none"} (no new measure under either rule once one is older than ${rules.unansweredHours} hours).`,
  ];
}

/** automation-status on a pool: the read in one REPEATABLE READ READ ONLY transaction, so every line is of one moment. */
export async function automationStatusOn(apiDb: Db, settings: AutomationSettings): Promise<string[]> {
  return apiDb.transaction((tx) => automationStatus(tx, settings), { isolationLevel: "repeatable read", accessMode: "read only" });
}
