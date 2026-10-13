import { sql, type SQL } from "drizzle-orm";
import type { DbTx } from "@korbat/db";
import { iso, markCounts, rows, type Runner, type SaltedText } from "./repo";

/**
 * The queries of account sanctions (3e design, sections 6.2 and 7.12): an account's standing as the views of the standing
 * ledger give it, the strike rule's answer for a post case, and the period of each standing measure. Every number comes
 * from the database's own standing_rules(), and every "now" is the database's clock, so the case answer reads what the
 * ledger's triggers would read at the same moment. Nothing here is stored: each answer is computed at the request.
 */

/** What may rest on a decision: a suspension or a termination, or (Task 5) a restriction of reporting on its warning. */
export type StandingOnKind = "suspend" | "terminate" | "restrict_reporting";

/** A UTC day of a timestamptz expression. The expression is written here, never input. */
const day = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD')`);

/** An instant as JavaScript writes it, or null for an infinite one (a termination's end). */
const finite = (expression: string) => sql`case when isfinite(${sql.raw(expression)}) then ${iso(expression)} end`;

/**
 * What strike_due answers for a final restriction of this case on a korbat rule other than R2 that rests on no suspect
 * item (the rule passed is R1: strike_due asks only that it is not R2), and whether the case's post already carries a
 * strike that stands, which is the first of the two reasons it can answer false.
 */
export async function strikeDueOf(q: Runner, caseId: string): Promise<{ due: boolean; struck: boolean }> {
  const [row] = await rows<{ due: boolean; struck: boolean }>(
    q,
    sql`select public.strike_due(${caseId}::uuid, 'incompatible', 'R1', false, null) as due,
               exists (select 1 from cases c
                         join cases x on x.target_type = 'post' and x.target_id = c.target_id
                         join decisions d on d.case_id = x.id
                         join decision_actions a on a.decision_id = d.id and a.kind = 'strike'
                        where c.id = ${caseId}::uuid
                          and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)) as struck`,
  );
  return { due: row?.due ?? false, struck: row?.struck ?? false };
}

/** An active strike of an account, as the case answer lists it. */
export interface StrikeRow {
  decisionId: string;
  caseId: string;
  ruleId: string;
  decidedAt: string;
  countsUntil: string;
}

/** The facts an account's standing is built from, each read from the ledger's views at the database's clock. */
export interface StandingFacts {
  /** The active strikes, oldest first. */
  strikes: StrikeRow[];
  /** The rule of the newest active strike. */
  ladderRule: string | null;
  /** Whether a strike is newer than the newest measure of the ladder that stands, or there is none. */
  newStrikeSinceLadder: boolean;
  /** The suspensions of the ladder that stand, whose basis holds, decided in the last ladder_memory_days, and the day of the newest. */
  suspensionsInYear: number;
  lastSuspendedOn: string | null;
  /** The live standing measure (standing_live), with its kind and its period's state now; null when none. */
  live: { kind: "suspend" | "terminate"; running: boolean } | null;
  /** The account's posts of the last flood_minutes, and the interval they were counted in. */
  flood: { posts: number; from: string; to: string };
  /** The grounds of a measure at once whose facts hold now, by the rows of decision_actions_check's table. */
  threat: boolean;
  terrorist: boolean;
  threatRepeat: boolean;
  /** The day of the newest seal for good of the account's images that a protective suspension may rest on now. */
  sealOn: string | null;
  /** The time of the decision each ground of a suspension at once would rest on now, or null (Task 3); and (Task 4) the two of a termination at once. */
  basisDecidedAt: { threat: string | null; terrorist: string | null; protective: string | null; threatRepeat: { earlier: string; newer: string } | null };
}

/**
 * An account's standing: its active strikes, its ladder, its live measure, and the facts of the grounds of a measure at
 * once, read as the rows of decision_actions_check's table read them. An aid to the console: the database decides at the
 * commit, and a fact that moves between this read and the key is refused there.
 */
export async function standingFacts(q: Runner, accountId: string): Promise<StandingFacts> {
  const account = sql`${accountId}::uuid`;
  const strikes = await rows<{ decision_id: string; case_id: string; rule_id: string; decided_at: string; counts_until: string }>(
    q,
    sql`select s.decision_id, d.case_id, d.rule_id, ${iso("d.decided_at")} as decided_at, ${iso("s.ends_at")} as counts_until
          from active_strikes s join decisions d on d.id = s.decision_id
         where s.account_id = ${account} order by s.created_at, s.action_id`,
  );
  const [ladder] = await rows<{ new_strike: boolean; in_year: number; last_on: string | null }>(
    q,
    sql`select coalesce((select max(s.created_at) from active_strikes s where s.account_id = ${account})
                          > (select max(a.created_at) from decision_actions a
                              where a.subject_account_id = ${account} and a.kind in ('suspend', 'terminate') and a.basis in ('strikes', 'ladder_end')
                                and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)), true) as new_strike,
               count(y.id)::int as in_year, max(${day("y.decided_at")}) as last_on
          from (select 1) one
          left join (select a.id, d.decided_at from decision_actions a join decisions d on d.id = a.decision_id cross join standing_rules() k
                      where a.subject_account_id = ${account} and a.kind = 'suspend' and a.basis = 'strikes'
                        and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)
                        and public.standing_basis_broken_at(a.id) is null
                        and d.decided_at >= now() - make_interval(days => k.ladder_memory_days)) y on true`,
  );
  const [live] = await rows<{ kind: "suspend" | "terminate"; running: boolean }>(
    q,
    sql`select a.kind, coalesce(p.starts_at <= clock_timestamp(), false) as running
          from standing_live s join decision_actions a on a.id = s.action_id left join suspension_periods p on p.action_id = s.action_id
         where s.account_id = ${account} limit 1`,
  );
  const [grounds] = await rows<{
    posts: number;
    from_at: string;
    to_at: string;
    threat_at: string | null;
    terrorist_at: string | null;
    threat_repeat: boolean;
    seal_on: string | null;
    seal_at: string | null;
    repeat_earlier: string | null;
    repeat_newer: string | null;
  }>(
    q,
    sql`select (select count(*)::int from posts p where p.author_id = ${account} and p.created_at > now() - make_interval(mins => k.flood_minutes)) as posts,
               ${iso("(now() - make_interval(mins => k.flood_minutes))")} as from_at, ${iso("now()")} as to_at,
               (select ${iso("x.decided_at")} from decisions x join cases xc on xc.id = x.case_id and xc.target_type = 'post' join posts xp on xp.id = xc.target_id and xp.author_id = ${account}
                 where x.kind = 'final' and x.outcome = 'restricted' and x.rule_id = 'R5' and x.decided_at >= now() - make_interval(days => k.basis_age_days)
                   and exists (select 1 from measures_in_force f where f.decision_id = x.id)
                 order by x.decided_at desc, x.id desc limit 1) as threat_at,
               (select ${iso("x.decided_at")} from decisions x join cases xc on xc.id = x.case_id and xc.target_type = 'post' join posts xp on xp.id = xc.target_id and xp.author_id = ${account}
                 where x.kind = 'final' and x.outcome = 'restricted' and x.ground = 'illegal' and x.category_keyword = 'KEYWORD_TERRORIST_CONTENT'
                   and x.decided_at >= now() - make_interval(days => k.basis_age_days)
                   and exists (select 1 from measures_in_force f where f.decision_id = x.id)
                 order by x.decided_at desc, x.id desc limit 1) as terrorist_at,
               exists (select 1 from decision_actions a join decisions ad on ad.id = a.decision_id
                         join posts xp on xp.author_id = ${account} and xp.created_at > ad.informed_at
                         join cases xc on xc.target_type = 'post' and xc.target_id = xp.id
                         join decisions x on x.case_id = xc.id
                        where a.subject_account_id = ${account} and a.kind = 'suspend' and a.basis = 'threat'
                          and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)
                          and public.standing_basis_broken_at(a.id) is null
                          and ad.decided_at >= now() - make_interval(days => k.ladder_memory_days)
                          and x.kind = 'final' and x.outcome = 'restricted' and x.rule_id = 'R5' and x.decided_at >= now() - make_interval(days => k.basis_age_days)
                          and exists (select 1 from measures_in_force f where f.decision_id = x.id)) as threat_repeat,
               -- Task 4: the two decisions a termination at once would rest on now, for the console's preview.
               t.earlier as repeat_earlier, t.newer as repeat_newer,
               (select ${day("x.decided_at")} from measures_in_force m join decisions x on x.id = m.decision_id
                 where m.kind = 'seal_media' and m.decision_kind = 'final' and m.subject_account_id = ${account}
                   and x.decided_at >= now() - make_interval(days => k.basis_age_days)
                   and not exists (select 1 from decision_actions p where p.kind = 'suspend' and p.basis = 'protective' and m.decision_id = any(p.rests_on))
                 order by x.decided_at desc, x.id desc limit 1) as seal_on,
               (select ${iso("x.decided_at")} from measures_in_force m join decisions x on x.id = m.decision_id
                 where m.kind = 'seal_media' and m.decision_kind = 'final' and m.subject_account_id = ${account}
                   and x.decided_at >= now() - make_interval(days => k.basis_age_days)
                   and not exists (select 1 from decision_actions p where p.kind = 'suspend' and p.basis = 'protective' and m.decision_id = any(p.rests_on))
                 order by x.decided_at desc, x.id desc limit 1) as seal_at
          from standing_rules() k
          left join lateral (
            select ${iso("rd.decided_at")} as earlier, ${iso("x.decided_at")} as newer
              from decision_actions a join decisions ad on ad.id = a.decision_id
              join decisions rd on rd.id = a.rests_on[1]
              join posts xp on xp.author_id = ${account} and xp.created_at > ad.informed_at
              join cases xc on xc.target_type = 'post' and xc.target_id = xp.id
              join decisions x on x.case_id = xc.id
             where a.subject_account_id = ${account} and a.kind = 'suspend' and a.basis = 'threat'
               and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)
               and public.standing_basis_broken_at(a.id) is null
               and ad.decided_at >= now() - make_interval(days => k.ladder_memory_days)
               and x.kind = 'final' and x.outcome = 'restricted' and x.rule_id = 'R5' and x.decided_at >= now() - make_interval(days => k.basis_age_days)
               and exists (select 1 from measures_in_force f where f.decision_id = x.id)
             order by x.decided_at desc, x.id desc limit 1
          ) t on true`
  );
  return {
    strikes: strikes.map((row) => ({ decisionId: row.decision_id, caseId: row.case_id, ruleId: row.rule_id, decidedAt: row.decided_at, countsUntil: row.counts_until })),
    ladderRule: strikes.at(-1)?.rule_id ?? null,
    newStrikeSinceLadder: ladder!.new_strike,
    suspensionsInYear: ladder!.in_year,
    lastSuspendedOn: ladder!.last_on,
    live: live ? { kind: live.kind, running: live.running } : null,
    flood: { posts: grounds!.posts, from: grounds!.from_at, to: grounds!.to_at },
    threat: grounds!.threat_at !== null,
    terrorist: grounds!.terrorist_at !== null,
    threatRepeat: grounds!.threat_repeat,
    sealOn: grounds!.seal_on,
    basisDecidedAt: {
      threat: grounds!.threat_at,
      terrorist: grounds!.terrorist_at,
      protective: grounds!.seal_at,
      threatRepeat: grounds!.repeat_earlier !== null && grounds!.repeat_newer !== null ? { earlier: grounds!.repeat_earlier, newer: grounds!.repeat_newer } : null,
    },
  };
}

/** Whether the case holds an unanswered item of a user's report: such a case holds the ladder's, the protective and the reporting measures back. */
export async function openReportsIn(q: Runner, caseId: string): Promise<boolean> {
  const [row] = await rows<{ open: boolean }>(
    q,
    sql`select exists (select 1 from intake_items i join intakes n on n.id = i.intake_id where i.case_id = ${caseId}::uuid and i.answered_by is null and n.kind = 'user') as open`,
  );
  return row?.open ?? false;
}

/**
 * Whether the handle of the case's newest snapshot (the one a decision made now names) is retired: a retirement now would
 * change nothing (decision_actions_check step 10, no_effect `already`), which the composer says beside its control.
 */
export async function snapshotHandleRetired(q: Runner, caseId: string): Promise<boolean> {
  const [row] = await rows<{ retired: boolean }>(
    q,
    sql`select exists (select 1 from handle_history h
                         where h.retired_at is not null
                           and h.handle_lower = (select lower(s.handle) from evidence_snapshots s where s.case_id = ${caseId}::uuid order by s.taken_at desc, s.id desc limit 1)) as retired`,
  );
  return row?.retired ?? false;
}

/** A ledger row's columns of 3e, and for a standing measure where its period stands now. */
export interface StandingColumns {
  days: number | null;
  announced: boolean | null;
  basis: string | null;
  restsOn: string[] | null;
  earliestStart: string | null;
  countsUntil: string | null;
  period: { startsAt: string | null; endsAt: string | null; state: string } | null;
  /** On a strike: the kinds of the standing measures that rest on its decision and stand (not lifted, basis whole). */
  restedOnBy: string[] | null;
  /** On a retirement: the handle it retired, from its decision's snapshot in lower case (Task 2); null on every other kind. */
  handle: string | null;
}

/**
 * The columns of 3e of a case's ledger rows, by id: what the key signed (days, announced), what the trigger forced (the
 * basis, what it rests on, the earliest start, a strike's or a warning's end of counting) and, for a suspension or a
 * termination, its period as suspension_periods gives it with its state at the database's clock: lifted (before its
 * start: never), its basis broken, ended, running, announced (a start fixed and ahead), held by a reply filed on time,
 * or unfixed.
 */
export async function standingColumns(q: Runner, caseId: string): Promise<Map<string, StandingColumns>> {
  const found = await rows<{
    id: string;
    days: number | null;
    announced: boolean | null;
    basis: string | null;
    rests_on: string[] | null;
    earliest_start: string | null;
    counts_until: string | null;
    rested_on_by: string[] | null;
    handle: string | null;
    standing: boolean;
    starts_at: string | null;
    ends_at: string | null;
    state: string | null;
  }>(
    q,
    sql`select a.id, a.days, a.announced, a.basis, a.rests_on::text[] as rests_on,
               case when a.kind in ('suspend', 'terminate') then ${iso("a.starts_at")} end as earliest_start,
               case when a.kind in ('strike', 'warn_reporting') then ${iso("a.ends_at")} end as counts_until,
               case when a.kind = 'strike' then coalesce((
                 select array_agg(distinct m.kind::text order by m.kind::text) from decision_actions m
                  where m.kind in ('suspend', 'terminate') and a.decision_id = any(m.rests_on)
                    and not exists (select 1 from decision_actions x where x.reverses_action_id = m.id)
                    and public.standing_basis_broken_at(m.id) is null), '{}') end as rested_on_by,
               case when a.kind = 'retire_handle' then (select lower(s.handle) from evidence_snapshots s where s.id = d.snapshot_id) end as handle,
               a.kind in ('suspend', 'terminate') as standing,
               ${iso("p.starts_at")} as starts_at, ${finite("p.ends_at")} as ends_at,
               case
                 when l.id is not null then case when p.starts_at is null then 'never' else 'lifted' end
                 when public.standing_basis_broken_at(a.id) is not null then 'basis_ended'
                 when p.starts_at is not null and p.ends_at <= clock_timestamp() then 'ended'
                 when p.starts_at is not null and p.starts_at <= clock_timestamp() then 'running'
                 when p.starts_at is not null then 'announced'
                 when r.on_time and r.answered_by is null then 'held'
                 else 'unfixed'
               end as state
          from decision_actions a join decisions d on d.id = a.decision_id
          left join suspension_periods p on p.action_id = a.id
          left join decision_actions l on l.reverses_action_id = a.id
          left join suspension_replies r on r.action_id = a.id
         where d.case_id = ${caseId}::uuid`,
  );
  return new Map(
    found.map((row) => [
      row.id,
      {
        days: row.days,
        announced: row.announced,
        basis: row.basis,
        restsOn: row.rests_on,
        earliestStart: row.earliest_start,
        countsUntil: row.counts_until,
        restedOnBy: row.rested_on_by,
        handle: row.handle,
        period: row.standing ? { startsAt: row.starts_at, endsAt: row.ends_at, state: row.state ?? "unfixed" } : null,
      },
    ]),
  );
}

/** How many strikes of the account count now (active_strikes): what the app's block "Your standing" prints. */
export async function activeStrikesOf(q: Runner, accountId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from active_strikes s where s.account_id = ${accountId}::uuid`);
  return row?.n ?? 0;
}

/** A strike as the account's export lists it (3e design, section 18, W.8). */
export interface ExportedStrikeRow {
  decisionId: string;
  postId: string;
  ruleId: string;
  givenAt: string;
  countsUntil: string;
  overruledAt: string | null;
}

/**
 * Every strike the account was given, newest first: the decision that gave it, the post it was given for, the rule, when
 * it was given, until when it counts, and when it was overruled. A strike is the account's own data and names nobody else.
 */
export async function exportedStrikes(q: Runner, accountId: string): Promise<ExportedStrikeRow[]> {
  const found = await rows<{ decision_id: string; post_id: string; rule_id: string; given_at: string; counts_until: string; overruled_at: string | null }>(
    q,
    sql`select a.decision_id, c.target_id as post_id, d.rule_id, ${iso("a.created_at")} as given_at, ${iso("a.ends_at")} as counts_until,
               (select ${iso("r.created_at")} from decision_actions r where r.reverses_action_id = a.id) as overruled_at
          from decision_actions a join decisions d on d.id = a.decision_id join cases c on c.id = d.case_id
         where a.subject_account_id = ${accountId}::uuid and a.kind = 'strike'
         order by a.created_at desc, a.id desc`,
  );
  return found.map((row) => ({ decisionId: row.decision_id, postId: row.post_id, ruleId: row.rule_id, givenAt: row.given_at, countsUntil: row.counts_until, overruledAt: row.overruled_at }));
}

/** The facts of /api/me's standing (3e design, sections 7.12 and 10.2), as one statement reads them; null without a live profile. */
export interface AccountStandingRow {
  handle: string;
  activeStrikes: number;
  measure: {
    decisionId: string;
    kind: "suspend" | "terminate";
    days: number | null;
    earliestStart: string;
    startsAt: string | null;
    endsAt: string | null;
    running: boolean;
    reply: { filedAt: string; onTime: boolean; answeredAt: string | null } | null;
    replyAnswered: boolean;
    appealed: boolean;
    appealPending: boolean;
    appealDeadline: string;
    appealOpen: boolean;
  } | null;
}

/**
 * An account's standing as /api/me answers it, read at the request from the ledger's views: its active strikes, and its
 * one standing measure that stands and has not ended (standing_live), with the period suspension_periods gives it, its
 * reply and its appeal. The appeal's deadline is the database's own, from appeal_informed_at, as every appealUntil reads
 * it. Nothing here is stored a second time.
 */
export async function accountStandingRow(q: Runner, accountId: string): Promise<AccountStandingRow | null> {
  const [row] = await rows<{
    handle: string;
    active_strikes: number;
    decision_id: string | null;
    kind: "suspend" | "terminate" | null;
    days: number | null;
    earliest_start: string | null;
    starts_at: string | null;
    ends_at: string | null;
    running: boolean;
    reply_filed_at: string | null;
    reply_on_time: boolean | null;
    reply_answered_at: string | null;
    reply_answered: boolean;
    appealed: boolean;
    appeal_pending: boolean;
    appeal_deadline: string | null;
    appeal_open: boolean;
  }>(
    q,
    sql`select p.handle, (select count(*)::int from active_strikes s where s.account_id = p.id) as active_strikes,
               m.decision_id, m.kind, m.days, ${iso("m.starts_at")} as earliest_start,
               ${iso("sp.starts_at")} as starts_at, ${finite("sp.ends_at")} as ends_at,
               coalesce(sp.starts_at <= clock_timestamp(), false) as running,
               ${iso("r.filed_at")} as reply_filed_at, r.on_time as reply_on_time, ${iso("r.answered_at")} as reply_answered_at,
               coalesce(r.answered_by is not null, false) as reply_answered,
               exists (select 1 from appeals x where x.decision_id = m.decision_id) as appealed,
               exists (select 1 from appeals x where x.decision_id = m.decision_id and x.answered_at is null) as appeal_pending,
               ${iso("public.appeal_deadline(public.appeal_informed_at(m.decision_id))")} as appeal_deadline,
               coalesce(clock_timestamp() < public.appeal_deadline(public.appeal_informed_at(m.decision_id)), false) as appeal_open
          from profiles p
          left join lateral (select a.id, a.decision_id, a.kind::text as kind, a.days, a.starts_at
                               from standing_live l join decision_actions a on a.id = l.action_id
                              where l.account_id = p.id order by a.created_at desc limit 1) m on true
          left join suspension_periods sp on sp.action_id = m.id
          left join suspension_replies r on r.action_id = m.id
         where p.id = ${accountId}::uuid and p.deleted_at is null`,
  );
  if (!row) return null;
  const measure =
    row.decision_id === null || row.kind === null || row.earliest_start === null || row.appeal_deadline === null
      ? null
      : {
          decisionId: row.decision_id,
          kind: row.kind,
          days: row.days,
          earliestStart: row.earliest_start,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          running: row.running,
          reply: row.reply_filed_at === null ? null : { filedAt: row.reply_filed_at, onTime: row.reply_on_time === true, answeredAt: row.reply_answered_at },
          replyAnswered: row.reply_answered,
          appealed: row.appealed,
          appealPending: row.appeal_pending,
          appealDeadline: row.appeal_deadline,
          appealOpen: row.appeal_open,
        };
  return { handle: row.handle, activeStrikes: row.active_strikes, measure };
}

/**
 * The standing measures that rest on each decision of a case (3e Task 3): for every decision of the case, the suspensions
 * and terminations that stand (no reversal), whose basis holds and that name it in rests_on, with their bases; and (Task
 * 5) the restrictions of reporting that rest on its warning in the same way. A review or a correction of such a decision
 * ends them, which the console says before the key is asked ([review.rests], [review.basis], [review.warning]).
 */
export async function standingOnDecisions(q: Runner, caseId: string): Promise<Map<string, { kind: StandingOnKind; basis: string }[]>> {
  const found = await rows<{ decision_id: string; kind: StandingOnKind; basis: string }>(
    q,
    sql`select x.id as decision_id, m.kind::text as kind, m.basis
          from decisions x join decision_actions m on m.kind in ('suspend', 'terminate', 'restrict_reporting') and x.id = any(m.rests_on)
         where x.case_id = ${caseId}::uuid
           and not exists (select 1 from decision_actions r where r.reverses_action_id = m.id)
           and public.standing_basis_broken_at(m.id) is null
         order by m.created_at, m.id`,
  );
  const byDecision = new Map<string, { kind: StandingOnKind; basis: string }[]>();
  for (const row of found) byDecision.set(row.decision_id, [...(byDecision.get(row.decision_id) ?? []), { kind: row.kind, basis: row.basis }]);
  return byDecision;
}

// ---------------------------------------------------------------- 3e Task 4: the reply, the lists and the take-down

/** A standing measure a reply is filed against: the suspension or termination of the decision, when the account is its subject. */
export async function replyMeasureOf(q: Runner, accountId: string, decisionId: string): Promise<string | null> {
  const [row] = await rows<{ id: string }>(
    q,
    sql`select a.id from decision_actions a join decisions d on d.id = a.decision_id
         where a.decision_id = ${decisionId}::uuid and a.kind::text in ('suspend', 'terminate') and a.subject_account_id = ${accountId}::uuid
           and d.kind = 'final' and d.author_mail <> 'none'`,
  );
  return row?.id ?? null;
}

/**
 * The reply's row (3e design, section 7.6 step 9). Its trigger refuses a reply that is not open (reply_not_open: the
 * measure is not this account's, was lifted, its basis broke, it has ended, or it has a reply already), takes the profile
 * again, and forces the time of filing by the clock and whether it came before the start; the statement, when there is
 * one, comes with the salt and the digest the server made. Answers what the trigger forced.
 */
export async function insertReply(tx: DbTx, row: { actionId: string; accountId: string; statement: SaltedText | null }): Promise<{ filedAt: string; onTime: boolean }> {
  const [inserted] = await rows<{ filed_at: string; on_time: boolean }>(
    tx,
    sql`insert into suspension_replies (action_id, account_id, statement, statement_salt, statement_digest)
        values (${row.actionId}::uuid, ${row.accountId}::uuid, ${row.statement?.text ?? null}, ${row.statement?.salt ?? null}, ${row.statement?.digest ?? null})
        returning ${iso("filed_at")} as filed_at, on_time`,
  );
  return { filedAt: inserted!.filed_at, onTime: inserted!.on_time };
}

/** The reply to a standing measure as the case page reads it, with its text while korbat keeps it; by the measure's id. */
export interface ReplyColumns {
  filedAt: string;
  onTime: boolean;
  text: string | null;
  erasedAt: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
}

/** The replies to the case's standing measures, by the measure's id. The text is read here only, on the case page, whose read is logged. */
export async function caseReplies(q: Runner, caseId: string): Promise<Map<string, ReplyColumns>> {
  const found = await rows<{ action_id: string; filed_at: string; on_time: boolean; statement: string | null; erased_at: string | null; answered_at: string | null; answered_by: string | null }>(
    q,
    sql`select r.action_id, ${iso("r.filed_at")} as filed_at, r.on_time, r.statement, ${iso("r.erased_at")} as erased_at, ${iso("r.answered_at")} as answered_at, r.answered_by
          from suspension_replies r join decision_actions a on a.id = r.action_id join decisions d on d.id = a.decision_id
         where d.case_id = ${caseId}::uuid`,
  );
  return new Map(
    found.map((row) => [row.action_id, { filedAt: row.filed_at, onTime: row.on_time, text: row.statement, erasedAt: row.erased_at, answeredAt: row.answered_at, answeredBy: row.answered_by }]),
  );
}

/** An unanswered reply as the queue lists it: never its text. */
export interface QueueReplyRow {
  caseId: string;
  decisionId: string;
  kind: "suspend" | "terminate";
  days: number | null;
  filedAt: string;
  onTime: boolean;
  endsAt: string | null;
}

/** The replies no decision has answered, oldest first, at most `limit`, each with its measure's end as the period gives it now. */
export async function unansweredReplies(q: Runner, limit: number): Promise<QueueReplyRow[]> {
  const found = await rows<{ case_id: string; decision_id: string; kind: "suspend" | "terminate"; days: number | null; filed_at: string; on_time: boolean; ends_at: string | null }>(
    q,
    sql`select d.case_id, a.decision_id, a.kind::text as kind, a.days, ${iso("r.filed_at")} as filed_at, r.on_time, ${finite("p.ends_at")} as ends_at
          from suspension_replies r join decision_actions a on a.id = r.action_id join decisions d on d.id = a.decision_id
          left join suspension_periods p on p.action_id = a.id
         where r.answered_by is null
         order by r.filed_at, r.action_id limit ${limit}::int`,
  );
  return found.map((row) => ({ caseId: row.case_id, decisionId: row.decision_id, kind: row.kind, days: row.kind === "terminate" ? null : row.days, filedAt: row.filed_at, onTime: row.on_time, endsAt: row.ends_at }));
}

/** How many replies no decision has answered, and since when the oldest waits: the home screen's line. */
export async function repliesWaiting(q: Runner): Promise<{ count: number; oldestAt: string | null }> {
  const [row] = await rows<{ n: number; oldest: string | null }>(q, sql`select count(*)::int as n, ${iso("min(r.filed_at)")} as oldest from suspension_replies r where r.answered_by is null`);
  return { count: row?.n ?? 0, oldestAt: row?.oldest ?? null };
}

/**
 * The accounts at the ladder's number of strikes (3e design, section 7.5 step 1): at least ladder_strikes active strikes,
 * one of them newer than the account's newest measure of the ladder that stands (or it has none), and nothing in
 * standing_live, read as decision_actions_check reads the ladder. For each: its handle, its open case on the account if
 * one is open, its active strikes, the rule and the day of the newest, and the rung of an announced suspension (the
 * suspensions of the ladder that stand with their basis, decided in ladder_memory_days), newest strike first.
 */
export async function strikeAccounts(q: Runner, limit: number): Promise<{ total: number; items: { handle: string; caseId: string | null; activeStrikes: number; ruleId: string; newestOn: string; inYear: number }[] }> {
  const found = await rows<{ total: number; handle: string; case_id: string | null; active: number; rule_id: string; newest_on: string; in_year: number }>(
    q,
    sql`with strikes as (
          select s.account_id, count(*)::int as active, max(s.created_at) as newest
            from active_strikes s group by s.account_id
        ), listed as (
          select s.*, k.ladder_strikes, k.ladder_memory_days from strikes s cross join standing_rules() k
           where s.active >= k.ladder_strikes
             and not exists (select 1 from standing_live l where l.account_id = s.account_id)
             and s.newest > coalesce((select max(a.created_at) from decision_actions a
                                       where a.subject_account_id = s.account_id and a.kind::text in ('suspend', 'terminate') and a.basis in ('strikes', 'ladder_end')
                                         and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)), '-infinity'::timestamptz)
        )
        select count(*) over ()::int as total, p.handle,
               (select c.id from cases c where c.target_type = 'account' and c.target_id = l.account_id and c.closed_at is null) as case_id,
               l.active,
               (select d.rule_id from active_strikes s join decisions d on d.id = s.decision_id where s.account_id = l.account_id order by s.created_at desc, s.action_id desc limit 1) as rule_id,
               ${day("l.newest")} as newest_on,
               (select count(*)::int from decision_actions a join decisions d on d.id = a.decision_id
                 where a.subject_account_id = l.account_id and a.kind = 'suspend' and a.basis = 'strikes'
                   and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)
                   and public.standing_basis_broken_at(a.id) is null
                   and d.decided_at >= now() - make_interval(days => l.ladder_memory_days)) as in_year
          from listed l join profiles p on p.id = l.account_id and p.deleted_at is null
         order by l.newest desc, l.account_id limit ${limit}::int`,
  );
  return {
    total: found[0]?.total ?? 0,
    items: found.map((row) => ({ handle: row.handle, caseId: row.case_id, activeStrikes: row.active, ruleId: row.rule_id, newestOn: row.newest_on, inYear: row.in_year })),
  };
}

/**
 * The announced measures of live accounts whose notice mail was recorded `failed` (3e design, section 7.12), with the
 * start that follows, newest decision first. A `no_address` belongs to a deleted account, for which nothing starts: not
 * listed. A measure that was lifted, whose basis broke or whose period has ended is not listed either.
 */
export async function noticesUndelivered(q: Runner, limit: number): Promise<{ total: number; items: { handle: string; caseId: string; decidedOn: string; startsAt: string }[] }> {
  const found = await rows<{ total: number; handle: string; case_id: string; decided_on: string; starts_at: string }>(
    q,
    sql`select count(*) over ()::int as total, pr.handle, d.case_id, ${day("d.decided_at")} as decided_on, ${iso("sp.starts_at")} as starts_at
          from decision_actions a join decisions d on d.id = a.decision_id
          join profiles pr on pr.id = a.subject_account_id and pr.deleted_at is null
          join standing_live l on l.action_id = a.id
          join suspension_periods sp on sp.action_id = a.id
         where a.kind::text in ('suspend', 'terminate') and a.announced and d.author_mail = 'failed'
         order by d.decided_at desc, a.id limit ${limit}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ handle: row.handle, caseId: row.case_id, decidedOn: row.decided_on, startsAt: row.starts_at })) };
}

/**
 * The terminations that stand and wait for their take-down (3e design, sections 7.8 and 7.12), newest decision first: the
 * account's handle, the case, the day it was decided, and either the day it becomes final (decision_final_at, read
 * fresh: after a kept answer to a reply before the start, six months after that answer) or what holds it: an appeal
 * that waits, or a reply nobody answered (`replyOnTime` true when it came before the start, which has then not come).
 */
export async function terminationsWaiting(
  q: Runner,
  limit: number,
): Promise<{ total: number; items: { handle: string; caseId: string; decidedOn: string; finalOn: string | null; heldBy: "appeal" | "reply" | null; replyOnTime: boolean | null }[] }> {
  const found = await rows<{ total: number; handle: string; case_id: string; decided_on: string; final_on: string | null; appeal: boolean; reply_on_time: boolean | null }>(
    q,
    sql`select count(*) over ()::int as total, pr.handle, d.case_id, ${day("d.decided_at")} as decided_on,
               ${day("public.decision_final_at(d.id)")} as final_on,
               exists (select 1 from appeals ap where ap.decision_id = d.id and ap.answered_by is null) as appeal,
               (select r.on_time from suspension_replies r where r.action_id = a.id and r.answered_by is null) as reply_on_time
          from decision_actions a join decisions d on d.id = a.decision_id
          join profiles pr on pr.id = a.subject_account_id and pr.deleted_at is null
          join standing_live l on l.action_id = a.id
         where a.kind::text = 'terminate'
         order by d.decided_at desc, a.id limit ${limit}::int`,
  );
  return {
    total: found[0]?.total ?? 0,
    items: found.map((row) => ({
      handle: row.handle,
      caseId: row.case_id,
      decidedOn: row.decided_on,
      // A reply holds it before an appeal does: an unanswered reply before the start keeps it from starting at all.
      heldBy: row.reply_on_time !== null ? "reply" : row.appeal ? "appeal" : null,
      replyOnTime: row.reply_on_time,
      finalOn: row.reply_on_time !== null || row.appeal ? null : row.final_on,
    })),
  };
}

/** The accounts whose termination is due for its take-down (public.terminations_due()), with the terminating decision's case and time. */
export async function terminationsDue(q: Runner, accountId: string | null = null): Promise<{ accountId: string; caseId: string; decidedAt: string }[]> {
  const found = await rows<{ account_id: string; case_id: string; decided_at: string }>(
    q,
    sql`select t.account_id, t.case_id, ${iso("t.decided_at")} as decided_at from public.terminations_due() t
         ${accountId === null ? sql`` : sql`where t.account_id = ${accountId}::uuid`}`,
  );
  return found.map((row) => ({ accountId: row.account_id, caseId: row.case_id, decidedAt: row.decided_at }));
}

/**
 * Takes the terminating decision's row FOR UPDATE, after the account's profile, and answers its id (null when the case
 * holds no termination of the account). The design takes the decision's case here, which korbat_api may not lock: it
 * holds no UPDATE privilege on cases, and a row lock needs one. It may lock a decision's row (it updates the mail's
 * columns), and an appeal being filed takes exactly that row FOR KEY SHARE, through its foreign key, before it commits:
 * so an appeal either committed before this lock and is read below, or waits here until the take-down has committed.
 */
export async function lockTerminatingDecision(tx: DbTx, accountId: string, caseId: string): Promise<string | null> {
  const [row] = await rows<{ id: string }>(
    tx,
    sql`select d.id from decisions d
         where d.case_id = ${caseId}::uuid and d.kind = 'final'
           and exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind::text = 'terminate' and a.subject_account_id = ${accountId}::uuid)
         order by d.decided_at desc, d.id desc limit 1 for update`,
  );
  return row?.id ?? null;
}

/**
 * Whether the decision became final for its author at least `settleMs` before the database's clock: an appeal whose own
 * deadline check passed an instant before the deadline has by then committed and is read, or has failed. An appeal's
 * transaction waits at most 10 seconds for a lock and is run at most three times, so a minute is far beyond it.
 */
export async function finalSettled(q: Runner, decisionId: string, settleMs: number): Promise<boolean> {
  const [row] = await rows<{ settled: boolean }>(
    q,
    sql`select coalesce(public.decision_final_at(${decisionId}::uuid) <= clock_timestamp() - make_interval(secs => ${settleMs / 1000}::float8), false) as settled`,
  );
  return row?.settled ?? false;
}

/**
 * Whether a seal of the account's images is in force (3e design, section 7.8 step 3): a seal_media in force, of a case
 * about the account or about one of its posts, whose images stay with korbat for the authorities after the purge, as
 * termination_final then says.
 */
export async function imagesSealed(q: Runner, accountId: string): Promise<boolean> {
  const [row] = await rows<{ sealed: boolean }>(
    q,
    sql`select exists (select 1 from measures_in_force m where m.kind = 'seal_media' and m.subject_account_id = ${accountId}::uuid) as sealed`,
  );
  return row?.sealed ?? false;
}

/** A standing measure of a decision as its author's screen shows it now (DecisionView.standing). */
export interface DecisionStandingRow {
  state: string;
  earliestStart: string;
  startsAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  replaced: boolean;
  restsOn: { decisionId: string; ruleId: string | null; decidedAt: string; countsUntil: string | null; state: "counts" | "expired" | "overruled" | null; overruledAt: string | null }[];
  reply: ReplyColumns | null;
}

/**
 * Where the decision's suspension or termination stands now (3e design, section 10.2), read fresh: its state as the case
 * page's period has it, its earliest start, its start and end as the database has them, when and by which decision it
 * stopped early (a lift, a withdrawal signed `replaced`, or the reversal that broke its basis), the decisions it rests on
 * (a strike's with where that strike stands now), and the reply. Null for a decision without one.
 */
export async function decisionStanding(q: Runner, decisionId: string): Promise<DecisionStandingRow | null> {
  const [row] = await rows<{
    id: string;
    basis: string | null;
    earliest_start: string;
    starts_at: string | null;
    ends_at: string | null;
    lifted_at: string | null;
    lifted_by: string | null;
    replaced: boolean | null;
    broken_at: string | null;
    broken_by: string | null;
    state: string;
    rests_on: DecisionStandingRow["restsOn"] | null;
  }>(
    q,
    sql`select a.id, a.basis, ${iso("a.starts_at")} as earliest_start, ${iso("p.starts_at")} as starts_at, ${finite("p.ends_at")} as ends_at,
               ${iso("l.created_at")} as lifted_at, l.decision_id as lifted_by, l.replaced,
               ${iso("public.standing_basis_broken_at(a.id)")} as broken_at,
               (select x.decision_id from decision_actions x where x.created_at = public.standing_basis_broken_at(a.id) and x.reverses_action_id is not null
                  and exists (select 1 from decision_actions y where y.id = x.reverses_action_id and y.decision_id = any(a.rests_on)) order by x.id limit 1) as broken_by,
               case
                 when l.id is not null then case when p.starts_at is null then 'never' else 'lifted' end
                 when public.standing_basis_broken_at(a.id) is not null then 'basis_ended'
                 when p.starts_at is not null and p.ends_at <= clock_timestamp() then 'ended'
                 when p.starts_at is not null and p.starts_at <= clock_timestamp() then 'running'
                 when p.starts_at is not null then 'announced'
                 when r.on_time and r.answered_by is null then 'held'
                 else 'unfixed'
               end as state,
               (select json_agg(json_build_object(
                         'decisionId', x.id, 'ruleId', case when a.basis = 'protective' then null else x.rule_id end, 'decidedAt', ${iso("x.decided_at")},
                         'countsUntil', ${iso("s.ends_at")},
                         'state', case when s.id is null then null when exists (select 1 from decision_actions o where o.reverses_action_id = s.id) then 'overruled'
                                       when s.ends_at <= clock_timestamp() then 'expired' else 'counts' end,
                         'overruledAt', (select ${iso("o.created_at")} from decision_actions o where o.reverses_action_id = s.id)) order by u.ord)
                  from unnest(a.rests_on) with ordinality as u(id, ord)
                  join decisions x on x.id = u.id
                  left join decision_actions s on s.decision_id = x.id and s.kind = 'strike') as rests_on
          from decision_actions a
          left join suspension_periods p on p.action_id = a.id
          left join decision_actions l on l.reverses_action_id = a.id
          left join suspension_replies r on r.action_id = a.id
         where a.decision_id = ${decisionId}::uuid and a.kind::text in ('suspend', 'terminate')`,
  );
  if (!row) return null;
  const replies = await rows<{ filed_at: string; on_time: boolean; statement: string | null; erased_at: string | null; answered_at: string | null; answered_by: string | null }>(
    q,
    sql`select ${iso("r.filed_at")} as filed_at, r.on_time, r.statement, ${iso("r.erased_at")} as erased_at, ${iso("r.answered_at")} as answered_at, r.answered_by
          from suspension_replies r where r.action_id = ${row.id}::uuid`,
  );
  const reply = replies[0];
  // A lift ends it at the lift's time, a broken basis at the break's: the period's end is cut to either, or it never ran.
  const endedAt = row.lifted_at ?? row.broken_at;
  return {
    state: row.state,
    earliestStart: row.earliest_start,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    endedAt,
    endedBy: row.lifted_by ?? row.broken_by,
    replaced: row.replaced === true,
    restsOn: row.rests_on ?? [],
    reply: reply ? { filedAt: reply.filed_at, onTime: reply.on_time, text: reply.statement, erasedAt: reply.erased_at, answeredAt: reply.answered_at, answeredBy: reply.answered_by } : null,
  };
}

/**
 * Bounds every lock wait of the transaction it runs in: the reply's and the take-down's, as an appeal's is bounded. Each
 * statement is bounded too, by a statement_timeout of the same length (3e's review, database2): the profile these take FOR
 * UPDATE can be kept out of reach by others' key-share locks, which lock_timeout alone, armed again at each wait, never
 * ends (lib/lock-bounds.ts, isBoundReached).
 */
export async function boundWaits(tx: DbTx, ms: number): Promise<void> {
  await tx.execute(sql`select set_config('lock_timeout', ${`${ms}ms`}::text, true), set_config('statement_timeout', ${`${ms}ms`}::text, true)`);
}

// ---------------------------------------------------------------- 3e Task 5: the restriction of reporting

/** Whether a mark counts: repo.ts's markCounts, the one statement of the rule the API reads. */
const counting = markCounts;

/**
 * The account's warning about reporting that still counts, as decision_actions_check reads it: a warning of the account
 * that no reversal lifted, whose end of counting is ahead, the newest first. One row or none.
 */
const warningOf = (account: SQL) =>
  sql`select w.decision_id, wd.decided_at, wd.informed_at, w.ends_at from decision_actions w join decisions wd on wd.id = w.decision_id
       where w.subject_account_id = ${account} and w.kind = 'warn_reporting' and w.ends_at > now()
         and not exists (select 1 from decision_actions r where r.reverses_action_id = w.id)
       order by w.created_at desc, w.id desc limit 1`;

/**
 * The marked reports, counted once each, that the account sent after korbat told it of its warning (`told`): what a
 * restriction needs (report_restrict_marks). Both expressions are written here, never input.
 */
const marksSince = (account: SQL, told: SQL) =>
  sql`(select count(distinct m.intake_id)::int from unfounded_marks m where m.account_id = ${account} and m.reported_at > ${told} and ${counting("m")})`;

/** An account's record of reporting (3e design, sections 7.9, 7.12 and 10.3), in reports, by the day each was sent. */
export interface ReportingFacts {
  reports: number;
  unfounded: number;
  /** The warning that still counts: its decision, the decision's time, and its end of counting. */
  warning: { decisionId: string; decidedAt: string; countsUntil: string } | null;
  /** The marked reports sent after korbat told the account of that warning; null without one. */
  marksSince: number | null;
  /** The restriction that runs (it stands, its warning stands, its days are not over): its decision and its end. */
  restriction: { decisionId: string; until: string } | null;
  /** One row a mark that counts, oldest report first, when asked for (the console's drafts read them). */
  marked: { ref: string; position: number; sentOn: string; markedOn: string; sinceWarning: boolean }[];
}

/** How many marks the case answer lists at most, for the drafts of W.5. */
const MARKED_MAX = 100;

/**
 * What the account's record of reporting is now, read as the ledger's check reads it: the counts of reporting_record,
 * the warning that still counts with the marked reports sent since korbat told the account of it, the restriction that
 * runs, and, with `marked`, the marks that count by their report's reference and the item's position. People are never
 * named: a report is its reference.
 */
export async function reportingFacts(q: Runner, accountId: string, options: { marked: boolean }): Promise<ReportingFacts> {
  const account = sql`${accountId}::uuid`;
  const [row] = await rows<{
    reports: number;
    unfounded: number;
    warning_id: string | null;
    warned_at: string | null;
    counts_until: string | null;
    marks_since: number | null;
    restriction_id: string | null;
    restricted_until: string | null;
  }>(
    q,
    sql`select coalesce((select r.reports from reporting_record r where r.account_id = ${account}), 0)::int as reports,
               coalesce((select r.unfounded from reporting_record r where r.account_id = ${account}), 0)::int as unfounded,
               w.decision_id as warning_id, ${iso("w.decided_at")} as warned_at, ${iso("w.ends_at")} as counts_until,
               case when w.decision_id is null then null else ${marksSince(account, sql.raw("w.informed_at"))} end as marks_since,
               x.decision_id as restriction_id, ${iso("x.until")} as restricted_until
          from (select 1) one
          left join lateral (${warningOf(account)}) w on true
          left join lateral (select a.decision_id, a.starts_at + make_interval(days => a.days) as until from decision_actions a
                              where a.subject_account_id = ${account} and a.kind = 'restrict_reporting'
                                and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)
                                and public.standing_basis_broken_at(a.id) is null and a.starts_at + make_interval(days => a.days) > now()
                              order by until desc, a.id limit 1) x on true`,
  );
  const marked = options.marked
    ? await rows<{ ref: string; position: number; sent_on: string; marked_on: string; since: boolean }>(
        q,
        sql`select n.ref, i.position, ${day("m.reported_at")} as sent_on, ${day("m.marked_at")} as marked_on, coalesce(m.reported_at > w.informed_at, false) as since
              from unfounded_marks m join intakes n on n.id = m.intake_id join intake_items i on i.id = m.item_id
              left join lateral (${warningOf(account)}) w on true
             where m.account_id = ${account} and ${counting("m")}
             order by m.reported_at, n.ref, i.position limit ${MARKED_MAX}::int`,
      )
    : [];
  return {
    reports: row!.reports,
    unfounded: row!.unfounded,
    warning: row!.warning_id === null ? null : { decisionId: row!.warning_id, decidedAt: row!.warned_at!, countsUntil: row!.counts_until! },
    marksSince: row!.marks_since,
    restriction: row!.restriction_id === null ? null : { decisionId: row!.restriction_id, until: row!.restricted_until! },
    marked: marked.map((mark) => ({ ref: mark.ref, position: mark.position, sentOn: mark.sent_on, markedOn: mark.marked_on, sinceWarning: mark.since })),
  };
}

/**
 * The Standing screen's reporting records (3e design, sections 7.9 step 4 and 8.6): the accounts at the warning's
 * threshold (at least report_warn_marks marked reports, at least report_warn_share of their rule reports, in the frame)
 * and the accounts whose warning still counts, each with its handle, its open account case if one is open, its counts in
 * reports, the day of its warning and the marked reports sent since; the account with the newest mark first. No row
 * names a reporter of anything: the people listed are the senders themselves, by handle.
 */
export async function reportingRecords(
  q: Runner,
  limit: number,
): Promise<{ total: number; items: { handle: string; caseId: string | null; reports: number; unfounded: number; warnedOn: string | null; marksSince: number | null }[] }> {
  const found = await rows<{ total: number; handle: string; case_id: string | null; reports: number; unfounded: number; warned_on: string | null; marks_since: number | null }>(
    q,
    sql`with listed as (
          select r.account_id, r.reports, r.unfounded, w.decided_at as warned_at, w.informed_at,
                 (select max(m.marked_at) from unfounded_marks m where m.account_id = r.account_id and ${counting("m")}) as newest
            from reporting_record r cross join standing_rules() k
            left join lateral (${warningOf(sql.raw("r.account_id"))}) w on true
           where (r.unfounded >= k.report_warn_marks and r.unfounded >= k.report_warn_share * r.reports) or w.decision_id is not null
        )
        select count(*) over ()::int as total, p.handle,
               (select c.id from cases c where c.target_type = 'account' and c.target_id = l.account_id and c.closed_at is null) as case_id,
               l.reports, l.unfounded, ${day("l.warned_at")} as warned_on,
               case when l.informed_at is null then null else ${marksSince(sql.raw("l.account_id"), sql.raw("l.informed_at"))} end as marks_since
          from listed l join profiles p on p.id = l.account_id and p.deleted_at is null
         order by l.newest desc nulls last, l.account_id limit ${limit}::int`,
  );
  return {
    total: found[0]?.total ?? 0,
    items: found.map((row) => ({ handle: row.handle, caseId: row.case_id, reports: row.reports, unfounded: row.unfounded, warnedOn: row.warned_on, marksSince: row.marks_since })),
  };
}

/** Where a decision's restriction of reporting stands now (3e design, sections 9.2 and 10.2). */
export interface ReportingStandingRow {
  state: "running" | "ended" | "lifted" | "basis_ended";
  until: string;
  endedAt: string | null;
  endedBy: string | null;
}

/**
 * The decision's restriction of reporting as its author's screen shows it, read fresh: lifted by a reversal of its own;
 * ended with the warning it rested on, when korbat lifted that warning before the restriction's days ran out; ended by
 * its days; or running. `until` is its end as decided; `endedAt` and `endedBy` the lift's, or the warning's lift's. Null
 * for a decision without one.
 */
export async function reportingStanding(q: Runner, decisionId: string): Promise<ReportingStandingRow | null> {
  const [row] = await rows<{ until: string; lifted_at: string | null; lifted_by: string | null; broken_at: string | null; broken_by: string | null; state: ReportingStandingRow["state"] }>(
    q,
    sql`select ${iso("(a.starts_at + make_interval(days => a.days))")} as until,
               ${iso("l.created_at")} as lifted_at, l.decision_id as lifted_by,
               ${iso("b.at")} as broken_at,
               (select x.decision_id from decision_actions x join decision_actions y on y.id = x.reverses_action_id
                 where y.decision_id = any(a.rests_on) and y.kind = 'warn_reporting' and x.created_at = b.at order by x.id limit 1) as broken_by,
               case
                 when l.id is not null then 'lifted'
                 when b.at is not null and b.at < a.starts_at + make_interval(days => a.days) then 'basis_ended'
                 when a.starts_at + make_interval(days => a.days) <= clock_timestamp() then 'ended'
                 else 'running'
               end as state
          from decision_actions a
          left join decision_actions l on l.reverses_action_id = a.id
          cross join lateral (select public.standing_basis_broken_at(a.id) as at) b
         where a.decision_id = ${decisionId}::uuid and a.kind = 'restrict_reporting'`,
  );
  if (!row) return null;
  if (row.state === "lifted") return { state: row.state, until: row.until, endedAt: row.lifted_at, endedBy: row.lifted_by };
  if (row.state === "basis_ended") return { state: row.state, until: row.until, endedAt: row.broken_at, endedBy: row.broken_by };
  return { state: row.state, until: row.until, endedAt: null, endedBy: null };
}

// ---------------------------------------------------------------- 3e Task 7: the export (W.8)

/** A suspension, a termination or a reporting measure as the account's export lists it (3e design, section 18, W.8). */
export interface ExportedStandingRow {
  decisionId: string;
  kind: "suspend" | "terminate" | "warn_reporting" | "restrict_reporting";
  basis: string;
  days: number | null;
  announced: boolean | null;
  decidedAt: string;
  earliestStart: string | null;
  startsAt: string | null;
  endsAt: string | null;
  liftedAt: string | null;
  liftedBy: string | null;
  replaced: boolean;
  basisEndedAt: string | null;
  basisEndedBy: string | null;
}

/**
 * Every suspension, termination, warning about reporting and restriction of reporting the account was given, newest
 * first, as the ledger gives each now: its decision, kind, basis, days and whether it was announced; the earliest start
 * of a standing measure; its period, which for a suspension or a termination is suspension_periods' (no start while an
 * announcement waits or when it was lifted before its start, no end for a termination), for a warning its counting from
 * the decision, and for a restriction its days from the decision, each cut to a lift and to a broken basis; the lift and
 * whether it was a withdrawal for another measure; and the reversal that broke what it rested on. Every row is the
 * account's own and names no staff member: a decision is its id.
 */
export async function exportedStanding(q: Runner, accountId: string): Promise<ExportedStandingRow[]> {
  const found = await rows<{
    decision_id: string;
    kind: ExportedStandingRow["kind"];
    basis: string;
    days: number | null;
    announced: boolean | null;
    decided_at: string;
    earliest_start: string | null;
    starts_at: string | null;
    ends_at: string | null;
    lifted_at: string | null;
    lifted_by: string | null;
    replaced: boolean;
    basis_ended_at: string | null;
    basis_ended_by: string | null;
  }>(
    q,
    sql`select a.decision_id, a.kind::text as kind, a.basis, a.days, a.announced, ${iso("d.decided_at")} as decided_at,
               case when a.kind::text in ('suspend', 'terminate') then ${iso("a.starts_at")} end as earliest_start,
               case when a.kind::text in ('suspend', 'terminate') then ${iso("p.starts_at")}
                    when a.kind::text = 'warn_reporting' then ${iso("a.created_at")}
                    else ${iso("a.starts_at")} end as starts_at,
               case when a.kind::text in ('suspend', 'terminate') then ${finite("p.ends_at")}
                    when a.kind::text = 'warn_reporting' then ${iso("least(a.ends_at, l.created_at)")}
                    else ${iso("least(a.starts_at + make_interval(days => a.days), l.created_at, b.at)")} end as ends_at,
               ${iso("l.created_at")} as lifted_at, l.decision_id as lifted_by, coalesce(l.replaced, false) as replaced,
               ${iso("b.at")} as basis_ended_at,
               (select x.decision_id from decision_actions x join decision_actions y on y.id = x.reverses_action_id
                 where y.decision_id = any(a.rests_on) and x.created_at = b.at order by x.id limit 1) as basis_ended_by
          from decision_actions a
          join decisions d on d.id = a.decision_id
          left join suspension_periods p on p.action_id = a.id
          left join decision_actions l on l.reverses_action_id = a.id
          cross join lateral (select public.standing_basis_broken_at(a.id) as at) b
         where a.subject_account_id = ${accountId}::uuid and a.kind::text in ('suspend', 'terminate', 'warn_reporting', 'restrict_reporting')
         order by a.created_at desc, a.id desc`,
  );
  return found.map((row) => ({
    decisionId: row.decision_id,
    kind: row.kind,
    basis: row.basis,
    days: row.days,
    announced: row.announced,
    decidedAt: row.decided_at,
    earliestStart: row.earliest_start,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    liftedAt: row.lifted_at,
    liftedBy: row.lifted_by,
    replaced: row.replaced,
    basisEndedAt: row.basis_ended_at,
    basisEndedBy: row.basis_ended_by,
  }));
}

/** A reply as the account's export lists it (W.8): its text while korbat holds it, and when that was erased. */
export interface ExportedReplyRow {
  decisionId: string;
  filedAt: string;
  onTime: boolean;
  text: string | null;
  erasedAt: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
}

/** Every reply the account sent to a suspension or a termination, newest first: the measure's decision, and the decision that answered it. */
export async function exportedReplies(q: Runner, accountId: string): Promise<ExportedReplyRow[]> {
  const found = await rows<{ decision_id: string; filed_at: string; on_time: boolean; statement: string | null; erased_at: string | null; answered_at: string | null; answered_by: string | null }>(
    q,
    sql`select a.decision_id, ${iso("r.filed_at")} as filed_at, r.on_time, r.statement, ${iso("r.erased_at")} as erased_at, ${iso("r.answered_at")} as answered_at, r.answered_by
          from suspension_replies r join decision_actions a on a.id = r.action_id
         where r.account_id = ${accountId}::uuid
         order by r.filed_at desc, r.action_id desc`,
  );
  return found.map((row) => ({ decisionId: row.decision_id, filedAt: row.filed_at, onTime: row.on_time, text: row.statement, erasedAt: row.erased_at, answeredAt: row.answered_at, answeredBy: row.answered_by }));
}

/** The account's reporting counts as its export lists them (W.8). */
export interface ExportedReportingRow {
  frameDays: number;
  days: { day: string; reports: number }[];
  marks: { ref: string; position: number; sentOn: string; markedAt: string; withdrawnAt: string | null; counts: boolean }[];
  markedReports: number;
}

/**
 * The account's own reporting counts: the frame of standing_rules(), every tally korbat holds for it (the newest day
 * first), every mark on its own reports by the report's reference and the item's position, the newest report first,
 * with whether the mark counts now (markCounts), and the marked reports in the frame as reporting_record counts them,
 * which is what a threshold reads. A mark names the account's own report and nothing else: not the item's target, not
 * the decision, not who decided. A mark is listed only once its item's outcome is released, as 3c's export tells nothing
 * of an item before the daily release (3e's review, access2), so a mark withdrawn before it never shows either.
 */
export async function exportedReporting(q: Runner, accountId: string): Promise<ExportedReportingRow> {
  const account = sql`${accountId}::uuid`;
  const [head] = await rows<{ frame_days: number; marked: number }>(
    q,
    sql`select k.report_frame_days as frame_days, coalesce((select r.unfounded from reporting_record r where r.account_id = ${account}), 0)::int as marked from standing_rules() k`,
  );
  const days = await rows<{ day: string; reports: number }>(q, sql`select to_char(t.day, 'YYYY-MM-DD') as day, t.reports from report_tallies t where t.account_id = ${account} order by t.day desc`);
  const marks = await rows<{ ref: string; position: number; sent_on: string; marked_at: string; withdrawn_at: string | null; counts: boolean }>(
    q,
    sql`select n.ref, i.position, ${day("m.reported_at")} as sent_on, ${iso("m.marked_at")} as marked_at, ${iso("m.withdrawn_at")} as withdrawn_at, ${counting("m")} as counts
          from unfounded_marks m join intakes n on n.id = m.intake_id join intake_items i on i.id = m.item_id
         where m.account_id = ${account} and i.outcome_sent_at is not null
         order by m.reported_at desc, n.ref, i.position`,
  );
  return {
    frameDays: head!.frame_days,
    days: days.map((row) => ({ day: row.day, reports: row.reports })),
    marks: marks.map((row) => ({ ref: row.ref, position: row.position, sentOn: row.sent_on, markedAt: row.marked_at, withdrawnAt: row.withdrawn_at, counts: row.counts })),
    markedReports: head!.marked,
  };
}
