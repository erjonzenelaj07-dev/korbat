import { sql } from "drizzle-orm";
import { iso, rows, type Runner } from "./repo";

/**
 * The queries of account sanctions (3e design, sections 6.2 and 7.12): an account's standing as the views of the standing
 * ledger give it, the strike rule's answer for a post case, and the period of each standing measure. Every number comes
 * from the database's own standing_rules(), and every "now" is the database's clock, so the case answer reads what the
 * ledger's triggers would read at the same moment. Nothing here is stored: each answer is computed at the request.
 */

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
  const [grounds] = await rows<{ posts: number; from_at: string; to_at: string; threat: boolean; terrorist: boolean; threat_repeat: boolean; seal_on: string | null }>(
    q,
    sql`select (select count(*)::int from posts p where p.author_id = ${account} and p.created_at > now() - make_interval(mins => k.flood_minutes)) as posts,
               ${iso("(now() - make_interval(mins => k.flood_minutes))")} as from_at, ${iso("now()")} as to_at,
               exists (select 1 from decisions x join cases xc on xc.id = x.case_id and xc.target_type = 'post' join posts xp on xp.id = xc.target_id and xp.author_id = ${account}
                        where x.kind = 'final' and x.outcome = 'restricted' and x.rule_id = 'R5' and x.decided_at >= now() - make_interval(days => k.basis_age_days)
                          and exists (select 1 from measures_in_force f where f.decision_id = x.id)) as threat,
               exists (select 1 from decisions x join cases xc on xc.id = x.case_id and xc.target_type = 'post' join posts xp on xp.id = xc.target_id and xp.author_id = ${account}
                        where x.kind = 'final' and x.outcome = 'restricted' and x.ground = 'illegal' and x.category_keyword = 'KEYWORD_TERRORIST_CONTENT'
                          and x.decided_at >= now() - make_interval(days => k.basis_age_days)
                          and exists (select 1 from measures_in_force f where f.decision_id = x.id)) as terrorist,
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
               (select ${day("x.decided_at")} from measures_in_force m join decisions x on x.id = m.decision_id
                 where m.kind = 'seal_media' and m.decision_kind = 'final' and m.subject_account_id = ${account}
                   and x.decided_at >= now() - make_interval(days => k.basis_age_days)
                   and not exists (select 1 from decision_actions p where p.kind = 'suspend' and p.basis = 'protective' and m.decision_id = any(p.rests_on))
                 order by x.decided_at desc, x.id desc limit 1) as seal_on
          from standing_rules() k`,
  );
  return {
    strikes: strikes.map((row) => ({ decisionId: row.decision_id, caseId: row.case_id, ruleId: row.rule_id, decidedAt: row.decided_at, countsUntil: row.counts_until })),
    ladderRule: strikes.at(-1)?.rule_id ?? null,
    newStrikeSinceLadder: ladder!.new_strike,
    suspensionsInYear: ladder!.in_year,
    lastSuspendedOn: ladder!.last_on,
    live: live ? { kind: live.kind, running: live.running } : null,
    flood: { posts: grounds!.posts, from: grounds!.from_at, to: grounds!.to_at },
    threat: grounds!.threat,
    terrorist: grounds!.terrorist,
    threatRepeat: grounds!.threat_repeat,
    sealOn: grounds!.seal_on,
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
