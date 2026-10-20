import { sql } from "drizzle-orm";
import type { ActionKind, AskPerson, DecisionStrike, PostModeration, RuleId } from "@korbat/contracts";
import { iso, rows, type Runner } from "./repo";

/**
 * The queries the author's surfaces are built from (3c design, sections 5, 7.6 and 11): the list of decisions about an
 * account, one decision's gate with the content it was made on and where its appeal stands, and the chip's facts on the
 * author's own posts. They read decisions, their ledger, cases, snapshots, the author's own appeals and posts, and the
 * database's two answers about who may review an appeal, and nothing else: no query here can reach who
 * reported, what a report said or how many there were, and a test refuses the names of those tables in this file.
 */

/** A UTC day of a timestamptz expression. The expression is written here, never input. */
const day = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD')`);

/**
 * The one fragment by which every read on the author's side takes the decisions its author was told of (3f design,
 * section 5): the chip, the Cases screen, a decision's screen and the export's cases. Both halves are needed. 3c sets
 * informed_at on every decision, also on those whose author is told nothing (a report answered with "no breach"), which
 * `author_mail <> 'none'` keeps out; since 3f a decision held with an order's notice has informed_at null (and no mail),
 * which the second half keeps out, so no later change of the mail's column can show a held decision. `alias` is the
 * query's own alias of decisions, written here, never input.
 */
export const toldToAuthor = (alias: string) => sql.raw(`(${alias}.author_mail <> 'none' and ${alias}.informed_at is not null)`);

const MEASURES = sql`('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio')`;

/**
 * The end of the appeal's window of decision `d`, while an appeal can still be filed: a final decision that restricts,
 * with at least one of its measures in force, no appeal filed, and its deadline not yet reached on the database's clock.
 * Null otherwise: for a decision taken while deciding, one that restricts nothing, a review, a correction, a restriction
 * reversed in full, and once the author appealed or the window closed. 3e Task 4: the six months run from
 * appeal_informed_at, the database's one statement of that moment, which after a kept answer to a reply sent before the
 * start is that answer's time.
 */
const appealUntil = sql`case when d.kind = 'final' and d.outcome = 'restricted'
                  and exists (select 1 from measures_in_force m where m.decision_id = d.id)
                  and not exists (select 1 from appeals ap where ap.decision_id = d.id)
                  and clock_timestamp() < public.appeal_deadline(public.appeal_informed_at(d.id))
             then ${iso("public.appeal_deadline(public.appeal_informed_at(d.id))")} end`;

/**
 * The UTC day on which the last measure of decision `d` was lifted, for a final decision that restricted and of which
 * nothing is in force any more. Null while any of its measures stands, and for every other decision: a decision taken
 * while deciding ends with its case, without a reversal.
 */
const reversedOn = sql`case when d.kind = 'final' and d.outcome = 'restricted'
                  and exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind in ${MEASURES})
                  and not exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind in ${MEASURES}
                                   and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id))
             then (select ${day("max(r.created_at)")} from decision_actions a join decision_actions r on r.reverses_action_id = a.id where a.decision_id = d.id) end`;

/**
 * The strike decision `d` gave (3e design, section 10.2), read fresh: its end of counting, when it was overruled, and
 * whether it counts now, ran out or was overruled; all null for a decision without one.
 */
const strikeColumns = sql`(select ${iso("a.ends_at")} from decision_actions a where a.decision_id = d.id and a.kind = 'strike') as strike_until,
               (select ${iso("r.created_at")} from decision_actions a join decision_actions r on r.reverses_action_id = a.id
                 where a.decision_id = d.id and a.kind = 'strike') as strike_overruled_at,
               (select case when exists (select 1 from decision_actions r where r.reverses_action_id = a.id) then 'overruled'
                            when a.ends_at <= clock_timestamp() then 'expired' else 'counts' end
                  from decision_actions a where a.decision_id = d.id and a.kind = 'strike') as strike_state`;

/**
 * The cases about an account: the account's own, and those about the posts it wrote. A post keeps its author through its
 * deletion and the account's purge, so a decision stays with the account it was about.
 */
const casesAbout = (accountId: string) => sql`(
    select c.id, c.target_type, c.target_id from cases c where c.target_type = 'account' and c.target_id = ${accountId}::uuid
    union all
    select c.id, c.target_type, c.target_id from cases c join posts p on p.id = c.target_id where c.target_type = 'post' and p.author_id = ${accountId}::uuid
  )`;

/**
 * The time by which the author's list places decision `d` (3f's review, people9; section 9.3): an order decision's row
 * shows, and sorts by, when its author was told, which for a notice released after a hold is weeks after the disabling;
 * every other decision by its own time. The list reads only told decisions, so informed_at is set.
 */
const listedAt = sql.raw(`case when d.kind::text = 'order' then d.informed_at else d.decided_at end`);

/** One decision as the author's list shows it. */
export interface AuthorDecisionRow {
  id: string;
  kind: "interim" | "final" | "order" | "review" | "correction";
  outcome: string;
  decidedOn: string;
  /** 3f's review (people9): for an order decision, the UTC day its author was told, which its row shows; null otherwise. */
  toldOn: string | null;
  /** The time the list places the decision by (listedAt) to the microsecond, as text: what the next page starts after. */
  sortAt: string;
  post: { id: string; createdAt: string } | null;
  actions: ActionKind[];
  endedInterim: boolean;
  ruleId: string | null;
  legal: boolean;
  appealUntil: string | null;
  reversedOn: string | null;
  /** Where the author's appeal of the decision stands: pending, or its result; null when they filed none. */
  appeal: "pending" | "kept" | "partly_reversed" | "reversed" | null;
  /** The strike the decision gave: until when it counts and when it was overruled; null for a decision without one. */
  strike: { countsUntil: string; overruledAt: string | null } | null;
  /** 3e Task 5: the days of the decision's restriction of reporting; null for a decision without one. */
  reportingDays: number | null;
  /** 3e Task 5: the kinds of the measures whose basis a reversal of this decision broke, as its statement's endedStanding lists them. */
  endedStanding: ("suspend" | "terminate" | "restrict_reporting")[];
  /** 3e's review (people7): the decision's suspension or termination, which its row names with its days and kind; null for none. */
  standingMeasure: { kind: "suspend" | "terminate"; days: number | null; announced: boolean } | null;
  /** 3e's review (people7): what the decision's lift lifted, and whether it was a withdrawal for another measure; null for none. */
  liftedStanding: { kind: "suspend" | "terminate"; replaced: boolean } | null;
  /** 3f: an order decision, disabled or removed by its measure, or the correction that reinstates after one (lifted): its row names no rule; null otherwise. */
  order: "disabled" | "removed" | "lifted" | null;
  /** 3d Task 6: the decision has no decider, a program took it ([auto.chip]). */
  byProgram: boolean;
}

/**
 * The decisions about this account that its author was told of (toldToAuthor), newest first, after the cursor when one
 * is given. A decision the author was not told of is in no page.
 */
export async function authorDecisions(q: Runner, accountId: string, after: { at: string; id: string } | null, limit: number): Promise<AuthorDecisionRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.kind, d.outcome, ${day("d.decided_at")} as decided_on,
               case when d.kind::text = 'order' then ${day("d.informed_at")} end as told_on,
               to_char(${listedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_at,
               c.target_type, c.target_id,
               (select ${iso("p.created_at")} from posts p where c.target_type = 'post' and p.id = c.target_id) as post_created_at,
               coalesce((select array_agg(a.kind::text order by a.kind, a.media_id) from decision_actions a where a.decision_id = d.id), '{}') as actions,
               d.ended_interim, d.rule_id, d.ground is not distinct from 'illegal' as legal,
               ${appealUntil} as appeal_until, ${reversedOn} as reversed_on,
               (select coalesce(ap.result::text, 'pending') from appeals ap where ap.decision_id = d.id) as appeal,
               ${strikeColumns},
               (select a.days from decision_actions a where a.decision_id = d.id and a.kind = 'restrict_reporting') as reporting_days,
               (select json_build_object('kind', a.kind::text, 'days', a.days, 'announced', a.announced) from decision_actions a
                 where a.decision_id = d.id and a.kind in ('suspend', 'terminate')) as standing_measure,
               (select json_build_object('kind', l.kind::text, 'replaced', coalesce(x.replaced, false)) from decision_actions x join decision_actions l on l.id = x.reverses_action_id
                 where x.decision_id = d.id and x.kind = 'lift_suspension') as lifted_standing,
               -- The measures whose basis this review or correction broke, as the statement's endedStanding reads them.
               coalesce((select array_agg(m.kind::text order by m.created_at, m.id) from decision_actions m
                          where d.kind in ('review', 'correction') and m.kind in ('suspend', 'terminate', 'restrict_reporting') and d.reviews_decision_id = any(m.rests_on)
                            and public.standing_basis_broken_at(m.id) = d.decided_at
                            and not exists (select 1 from decision_actions x where x.reverses_action_id = m.id and x.created_at < d.decided_at)), '{}') as ended_standing,
               case when d.kind::text = 'order'
                    then case when coalesce((select a.withhold_author from decision_actions a where a.decision_id = d.id and a.kind::text = 'disable_by_order' limit 1), true) then 'disabled' else 'removed' end
                    when exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind::text = 'reinstate_by_order') then 'lifted' end as about_order,
               d.decided_by is null as by_program
          from ${casesAbout(accountId)} c join decisions d on d.case_id = c.id
         where ${toldToAuthor("d")}
           ${after === null ? sql`` : sql`and (${listedAt}, d.id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
         order by ${listedAt} desc, d.id desc limit ${limit}::int`,
  );
  return found.map((row) => ({
    id: row.id as string,
    kind: row.kind as AuthorDecisionRow["kind"],
    outcome: row.outcome as string,
    decidedOn: row.decided_on as string,
    toldOn: row.told_on as string | null,
    sortAt: row.sort_at as string,
    post: row.target_type === "post" && row.post_created_at !== null ? { id: row.target_id as string, createdAt: row.post_created_at as string } : null,
    actions: row.actions as ActionKind[],
    endedInterim: row.ended_interim as boolean,
    ruleId: row.rule_id as string | null,
    legal: row.legal as boolean,
    appealUntil: row.appeal_until as string | null,
    reversedOn: row.reversed_on as string | null,
    appeal: row.appeal as AuthorDecisionRow["appeal"],
    strike: row.strike_until === null ? null : { countsUntil: row.strike_until as string, overruledAt: row.strike_overruled_at as string | null },
    reportingDays: row.reporting_days as number | null,
    endedStanding: row.ended_standing as AuthorDecisionRow["endedStanding"],
    standingMeasure: row.standing_measure as AuthorDecisionRow["standingMeasure"],
    liftedStanding: row.lifted_standing as AuthorDecisionRow["liftedStanding"],
    order: (row.about_order as AuthorDecisionRow["order"]) ?? null,
    byProgram: row.by_program as boolean,
  }));
}

/**
 * 3d Task 6 (design, sections 7.10 and 10.2): where "Ask for a person" stands on a decision, read fresh: null for a decision
 * with a decider; for a program's, `open` while a measure of it is in force and no request exists, `asked` with the text
 * and its time while the measure stays in force, and `decided` once no measure of it is in force, naming the person's
 * decision that ended it: the correction or review whose row lifted its measure, else the case's first final decision
 * after it, which ended it by 3c's derivation. Only decisions the author was told of are named. Nothing stores "answered".
 */
export async function askPersonOf(q: Runner, decisionId: string): Promise<AskPerson | null> {
  const [row] = await rows<{ program: boolean; in_force: boolean; text: string | null; created_at: string | null; ender_id: string | null; ender_at: string | null }>(
    q,
    sql`select d.decided_by is null as program,
               exists (select 1 from measures_in_force m where m.decision_id = d.id) as in_force,
               o.text, ${iso("o.created_at")} as created_at, e.id as ender_id, ${iso("e.decided_at")} as ender_at
          from decisions d
          left join automated_objections o on o.decision_id = d.id
          left join lateral (
            select x.id, x.decided_at from decisions x
             where ${toldToAuthor("x")}
               and (x.id in (select r.decision_id from decision_actions a join decision_actions r on r.reverses_action_id = a.id where a.decision_id = d.id)
                    or (x.case_id = d.case_id and x.kind = 'final' and x.decided_at >= d.decided_at))
             order by x.decided_at, x.id limit 1) e on true
         where d.id = ${decisionId}::uuid`,
  );
  if (!row || !row.program) return null;
  if (row.in_force) return row.created_at === null ? { state: "open" } : { state: "asked", text: row.text ?? "", createdAt: row.created_at };
  if (row.ender_id === null || row.ender_at === null) return null;
  return { state: "decided", decisionId: row.ender_id, decidedAt: row.ender_at };
}

/**
 * The author's appeal of a decision. While it is pending: whether anyone at korbat may review it now, as the database
 * answers it in one word that names nobody, and whether its review is an admin's. Once answered: its result, the UTC day
 * and the decision that answered it.
 */
export interface AuthorAppealFacts {
  filedAt: string;
  reviewer: "available" | "none_single_staff" | "none_eligible" | null;
  needsAdmin: boolean;
  result: "kept" | "partly_reversed" | "reversed" | null;
  answeredOn: string | null;
  answeredBy: string | null;
}

/** What the author's view of one decision adds to its statement: where its appeal stands, and its snapshot with what decides whether and how it is shown. */
export interface AuthorDecisionFacts {
  targetType: "post" | "account";
  targetId: string;
  appealUntil: string | null;
  reversedOn: string | null;
  /** Null when the author filed no appeal of this decision. */
  appeal: AuthorAppealFacts | null;
  /** The database's one predicate by which a snapshot's content is withheld wherever it would be shown. */
  withheld: boolean;
  erased: boolean;
  /** The UTC day the snapshot was erased; null while it is kept. */
  erasedOn: string | null;
  /** A decision about the same post or account carries an R4 redaction. */
  redacted: boolean;
  body: string | null;
  images: { id: string; alt: string | null; width: number; height: number }[];
  handle: string;
  displayName: string | null;
  bio: string | null;
  /** For a decision about a post: whether its author deleted it, whether its content was erased, and whether a seal in force lists it. */
  postDeleted: boolean;
  postErased: boolean;
  sealed: boolean;
  /** The strike the decision gave, read fresh: until when it counts, whether it still does, and when it was overruled. */
  strike: DecisionStrike | null;
  /** 3f: an order decision whose measure is in force, whose post the notice's screen never shows (section 10.4). */
  orderInForce: boolean;
  /**
   * 3f's review (access4): a decision about a post that is disabled for an order now, told after the post was first
   * disabled (a decision held with the notice and released with it): its screen shows the post no more than the
   * notice's does. A decision told before the order keeps its content, as row 47 of the design says.
   */
  toldWhileDisabled: boolean;
}

/**
 * One decision for the account it is about, or null: when no decision has the id, when it is about someone else, and when
 * its author was not told of it, so that no such decision opens by its id. A post's images are sealed exactly while a
 * seal in force lists the post, which is how the database derives their state too; this module never reads an image row.
 */
export async function authorDecision(q: Runner, accountId: string, decisionId: string): Promise<AuthorDecisionFacts | null> {
  const [row] = await rows<Record<string, unknown>>(
    q,
    sql`select c.target_type, c.target_id, ${appealUntil} as appeal_until, ${reversedOn} as reversed_on,
               ap.id as appeal_id, ${iso("ap.filed_at")} as appeal_filed_at, public.appeal_reviewer_state(ap.id) as appeal_reviewer,
               public.review_needs_admin(d.id) as appeal_needs_admin, ap.result as appeal_result, ${day("ap.answered_at")} as appeal_answered_on,
               ap.answered_by as appeal_answered_by,
               public.snapshot_withheld(d.snapshot_id) as withheld, s.erased_at is not null as erased, ${day("s.erased_at")} as erased_on,
               exists (select 1 from decisions r join cases rc on rc.id = r.case_id
                        where rc.target_type = c.target_type and rc.target_id = c.target_id and r.redacted_at is not null) as redacted,
               s.body, s.media::text as media, coalesce(s.handle, s.author_handle) as handle, s.display_name, s.bio,
               coalesce(p.state = 'deleted_by_author', false) as post_deleted, coalesce(p.erased_at is not null, false) as post_erased,
               (c.target_type = 'post' and exists (select 1 from seal_posts sp join measures_in_force m on m.id = sp.action_id where sp.post_id = c.target_id)) as sealed,
               ${strikeColumns},
               (d.kind::text = 'order' and exists (select 1 from measures_in_force m where m.decision_id = d.id)) as order_in_force,
               coalesce(p.state::text = 'disabled'
                        and d.informed_at > (select min(i.disabled_at) from legal_order_items i where i.post_id = p.id), false) as told_while_disabled
          from decisions d
          join cases c on c.id = d.case_id
          join evidence_snapshots s on s.id = d.snapshot_id
          left join posts p on c.target_type = 'post' and p.id = c.target_id
          left join appeals ap on ap.decision_id = d.id
         where d.id = ${decisionId}::uuid and ${toldToAuthor("d")}
           and case when c.target_type = 'post' then p.author_id = ${accountId}::uuid else c.target_id = ${accountId}::uuid end`,
  );
  if (!row) return null;
  return {
    targetType: row.target_type as "post" | "account",
    targetId: row.target_id as string,
    appealUntil: row.appeal_until as string | null,
    reversedOn: row.reversed_on as string | null,
    appeal:
      row.appeal_id === null
        ? null
        : {
            filedAt: row.appeal_filed_at as string,
            reviewer: row.appeal_reviewer as AuthorAppealFacts["reviewer"],
            needsAdmin: row.appeal_needs_admin as boolean,
            result: row.appeal_result as AuthorAppealFacts["result"],
            answeredOn: row.appeal_answered_on as string | null,
            answeredBy: row.appeal_answered_by as string | null,
          },
    withheld: row.withheld as boolean,
    erased: row.erased as boolean,
    erasedOn: row.erased_on as string | null,
    redacted: row.redacted as boolean,
    body: row.body as string | null,
    images: row.media === null ? [] : (JSON.parse(row.media as string) as AuthorDecisionFacts["images"]),
    handle: row.handle as string,
    displayName: row.display_name as string | null,
    bio: row.bio as string | null,
    postDeleted: row.post_deleted as boolean,
    postErased: row.post_erased as boolean,
    sealed: row.sealed as boolean,
    strike:
      row.strike_until === null
        ? null
        : { countsUntil: row.strike_until as string, state: row.strike_state as DecisionStrike["state"], overruledAt: row.strike_overruled_at as string | null },
    orderInForce: row.order_in_force as boolean,
    toldWhileDisabled: row.told_while_disabled as boolean,
  };
}

/**
 * The decision behind the state of each of these posts that the account wrote and that is withheld or removed (3c design,
 * section 5): the decision of the strongest post measure in force, a removal (3f: or a disabling for an order, which
 * reaches this read only as the level removed, a DSA order that does not withhold) before a withhold and the newest
 * first; or,
 * for a post that is removed only because its content was erased, with no post measure in force, the newest decision
 * whose R4 redaction it was. A post of someone else, and one that is visible, is not in the answer.
 */
export async function chipFacts(q: Runner, accountId: string, postIds: readonly string[]): Promise<Map<string, PostModeration>> {
  const facts = new Map<string, PostModeration>();
  if (postIds.length === 0) return facts;
  const found = await rows<{ post_id: string; decision_id: string; rule_id: string | null; legal: boolean; interim: boolean; strike_until: string | null; is_order: boolean }>(
    q,
    sql`select p.id as post_id, f.decision_id, f.rule_id, f.legal, f.interim,
               exists (select 1 from decisions o where o.id = f.decision_id and o.kind::text = 'order') as is_order,
               -- 3e: the strike of the chip's decision while it stands and still counts.
               (select ${iso("a.ends_at")} from decision_actions a where a.decision_id = f.decision_id and a.kind = 'strike' and a.ends_at > clock_timestamp()
                   and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)) as strike_until
          from posts p
          cross join lateral (
            (select d.id as decision_id, d.rule_id, d.ground is not distinct from 'illegal' as legal, d.kind = 'interim' as interim, 0 as source,
                    (m.kind::text in ('remove', 'disable_by_order')) as removes, d.decided_at
               from measures_in_force m join decisions d on d.id = m.decision_id
              where m.post_id = p.id and m.kind::text in ('withhold', 'remove', 'disable_by_order') and ${toldToAuthor("d")})
            union all
            (select d.id, d.rule_id, d.ground is not distinct from 'illegal', false, 1, true, d.redacted_at
               from cases c join decisions d on d.case_id = c.id
              where c.target_type = 'post' and c.target_id = p.id and p.erased_at is not null and d.redacted_at is not null and ${toldToAuthor("d")}
                and exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'remove'))
            order by source, removes desc, decided_at desc, decision_id desc
            limit 1
          ) f
         where p.id = any(${`{${postIds.join(",")}}`}::uuid[]) and p.author_id = ${accountId}::uuid and p.moderation_level in ('withheld', 'removed')`,
  );
  for (const row of found) {
    facts.set(row.post_id, { decisionId: row.decision_id, ruleId: row.rule_id as RuleId | null, legal: row.legal, interim: row.interim, strikeUntil: row.strike_until, ...(row.is_order ? { order: true } : {}) });
  }
  return facts;
}
