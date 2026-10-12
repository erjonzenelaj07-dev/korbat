import { sql } from "drizzle-orm";
import type { ActionKind, PostModeration, RuleId } from "@korbat/contracts";
import { iso, rows, type Runner } from "./repo";

/**
 * The queries the author's surfaces are built from (3c design, sections 5, 7.6 and 11): the list of decisions about an
 * account, one decision's gate with the content it was made on, and the chip's facts on the author's own posts. They read
 * decisions, their ledger, cases, snapshots and the author's own posts and nothing else: no query here can reach who
 * reported, what a report said or how many there were, and a test refuses the names of those tables in this file.
 */

/** A UTC day of a timestamptz expression. The expression is written here, never input. */
const day = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD')`);

const MEASURES = sql`('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio')`;

/**
 * The end of the appeal's window of decision `d`, while an appeal can still be filed: a final decision that restricts,
 * with at least one of its measures in force, no appeal filed, and its deadline not yet reached on the database's clock.
 * Null otherwise: for a decision taken while deciding, one that restricts nothing, a review, a correction, a restriction
 * reversed in full, and once the author appealed or the window closed.
 */
const appealUntil = sql`case when d.kind = 'final' and d.outcome = 'restricted'
                  and exists (select 1 from measures_in_force m where m.decision_id = d.id)
                  and not exists (select 1 from appeals ap where ap.decision_id = d.id)
                  and clock_timestamp() < public.appeal_deadline(d.informed_at)
             then ${iso("public.appeal_deadline(d.informed_at)")} end`;

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
 * The cases about an account: the account's own, and those about the posts it wrote. A post keeps its author through its
 * deletion and the account's purge, so a decision stays with the account it was about.
 */
const casesAbout = (accountId: string) => sql`(
    select c.id, c.target_type, c.target_id from cases c where c.target_type = 'account' and c.target_id = ${accountId}::uuid
    union all
    select c.id, c.target_type, c.target_id from cases c join posts p on p.id = c.target_id where c.target_type = 'post' and p.author_id = ${accountId}::uuid
  )`;

/** One decision as the author's list shows it. */
export interface AuthorDecisionRow {
  id: string;
  kind: "interim" | "final" | "review" | "correction";
  outcome: string;
  decidedOn: string;
  /** The decision's time to the microsecond, as text: what the next page starts after. */
  sortAt: string;
  post: { id: string; createdAt: string } | null;
  actions: ActionKind[];
  endedInterim: boolean;
  ruleId: string | null;
  legal: boolean;
  appealUntil: string | null;
  reversedOn: string | null;
}

/**
 * The decisions about this account that its author was told of (`author_mail` is not `none`), newest first, after the
 * cursor when one is given. A decision the author was not told of is in no page.
 */
export async function authorDecisions(q: Runner, accountId: string, after: { at: string; id: string } | null, limit: number): Promise<AuthorDecisionRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.kind, d.outcome, ${day("d.decided_at")} as decided_on,
               to_char(d.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_at,
               c.target_type, c.target_id,
               (select ${iso("p.created_at")} from posts p where c.target_type = 'post' and p.id = c.target_id) as post_created_at,
               coalesce((select array_agg(a.kind::text order by a.kind, a.media_id) from decision_actions a where a.decision_id = d.id), '{}') as actions,
               d.ended_interim, d.rule_id, d.ground is not distinct from 'illegal' as legal,
               ${appealUntil} as appeal_until, ${reversedOn} as reversed_on
          from ${casesAbout(accountId)} c join decisions d on d.case_id = c.id
         where d.author_mail <> 'none'
           ${after === null ? sql`` : sql`and (d.decided_at, d.id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
         order by d.decided_at desc, d.id desc limit ${limit}::int`,
  );
  return found.map((row) => ({
    id: row.id as string,
    kind: row.kind as AuthorDecisionRow["kind"],
    outcome: row.outcome as string,
    decidedOn: row.decided_on as string,
    sortAt: row.sort_at as string,
    post: row.target_type === "post" && row.post_created_at !== null ? { id: row.target_id as string, createdAt: row.post_created_at as string } : null,
    actions: row.actions as ActionKind[],
    endedInterim: row.ended_interim as boolean,
    ruleId: row.rule_id as string | null,
    legal: row.legal as boolean,
    appealUntil: row.appeal_until as string | null,
    reversedOn: row.reversed_on as string | null,
  }));
}

/** What the author's view of one decision adds to its statement: where its appeal stands, and its snapshot with what decides whether and how it is shown. */
export interface AuthorDecisionFacts {
  targetType: "post" | "account";
  targetId: string;
  appealUntil: string | null;
  reversedOn: string | null;
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
               public.snapshot_withheld(d.snapshot_id) as withheld, s.erased_at is not null as erased, ${day("s.erased_at")} as erased_on,
               exists (select 1 from decisions r join cases rc on rc.id = r.case_id
                        where rc.target_type = c.target_type and rc.target_id = c.target_id and r.redacted_at is not null) as redacted,
               s.body, s.media::text as media, coalesce(s.handle, s.author_handle) as handle, s.display_name, s.bio,
               coalesce(p.state = 'deleted_by_author', false) as post_deleted, coalesce(p.erased_at is not null, false) as post_erased,
               (c.target_type = 'post' and exists (select 1 from seal_posts sp join measures_in_force m on m.id = sp.action_id where sp.post_id = c.target_id)) as sealed
          from decisions d
          join cases c on c.id = d.case_id
          join evidence_snapshots s on s.id = d.snapshot_id
          left join posts p on c.target_type = 'post' and p.id = c.target_id
         where d.id = ${decisionId}::uuid and d.author_mail <> 'none'
           and case when c.target_type = 'post' then p.author_id = ${accountId}::uuid else c.target_id = ${accountId}::uuid end`,
  );
  if (!row) return null;
  return {
    targetType: row.target_type as "post" | "account",
    targetId: row.target_id as string,
    appealUntil: row.appeal_until as string | null,
    reversedOn: row.reversed_on as string | null,
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
  };
}

/**
 * The decision behind the state of each of these posts that the account wrote and that is withheld or removed (3c design,
 * section 5): the decision of the strongest post measure in force, a removal before a withhold and the newest first; or,
 * for a post that is removed only because its content was erased, with no post measure in force, the newest decision
 * whose R4 redaction it was. A post of someone else, and one that is visible, is not in the answer.
 */
export async function chipFacts(q: Runner, accountId: string, postIds: readonly string[]): Promise<Map<string, PostModeration>> {
  const facts = new Map<string, PostModeration>();
  if (postIds.length === 0) return facts;
  const found = await rows<{ post_id: string; decision_id: string; rule_id: string | null; legal: boolean; interim: boolean }>(
    q,
    sql`select p.id as post_id, f.decision_id, f.rule_id, f.legal, f.interim
          from posts p
          cross join lateral (
            (select d.id as decision_id, d.rule_id, d.ground is not distinct from 'illegal' as legal, d.kind = 'interim' as interim, 0 as source,
                    (m.kind = 'remove') as removes, d.decided_at
               from measures_in_force m join decisions d on d.id = m.decision_id
              where m.post_id = p.id and m.kind in ('withhold', 'remove'))
            union all
            (select d.id, d.rule_id, d.ground is not distinct from 'illegal', false, 1, true, d.redacted_at
               from cases c join decisions d on d.case_id = c.id
              where c.target_type = 'post' and c.target_id = p.id and p.erased_at is not null and d.redacted_at is not null
                and exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'remove'))
            order by source, removes desc, decided_at desc, decision_id desc
            limit 1
          ) f
         where p.id = any(${`{${postIds.join(",")}}`}::uuid[]) and p.author_id = ${accountId}::uuid and p.moderation_level in ('withheld', 'removed')`,
  );
  for (const row of found) facts.set(row.post_id, { decisionId: row.decision_id, ruleId: row.rule_id as RuleId | null, legal: row.legal, interim: row.interim });
  return facts;
}
