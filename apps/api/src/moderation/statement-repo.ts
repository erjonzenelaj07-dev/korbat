import { sql } from "drizzle-orm";
import type { ActionKind, OrderNoticeFacts, OrderTexts } from "@korbat/contracts";
import { iso, rows, type Runner, type TargetType } from "./repo";

/** An instant as JavaScript writes it, or null for an infinite one (a termination's end). The expression is written here, never input. */
const finite = (expression: string) => sql`case when isfinite(${sql.raw(expression)}) then ${iso(expression)} end`;

/**
 * The queries a statement of reasons is read from (3c design, sections 7.5 and 10): the decision with its texts and the
 * decision it is about, its ledger rows, and the measures taken while deciding that ended with it. Every surface an
 * author reads a statement on (the decision's screen, the mail, the export, the answer to an appeal) is rendered from
 * these, so they are kept apart from the module's other queries: a test refuses the names of the tables of reports and
 * notices in this file, but for one pinned read in endedMeasures, which answers true or false of the case's own items.
 */

/** A decision as its statement is rendered from it, with what the mail and the staff alerts need beside it. */
export interface StatementDecisionRow {
  id: string;
  caseId: string;
  kind: "interim" | "final" | "order" | "review" | "correction";
  outcome: string;
  ground: string | null;
  ruleId: string | null;
  rulesVersion: number;
  redressVersion: number;
  source: string;
  decidedAt: string;
  suspect: boolean;
  authorMail: string;
  /** 3f: when the statement's first mail was recorded; an order's notice mailed again after the authority's words is a mail of its own. */
  authorMailAt: string | null;
  decidedBy: string;
  facts: string | null;
  reason: string | null;
  legalReference: string | null;
  targetType: TargetType;
  targetId: string;
  /** The post's creation time, which survives its deletion; null for an account case. */
  postCreatedAt: string | null;
  /** The account the decision is about: the post's author, or the account itself. */
  subjectId: string | null;
  /** The decision a review or a correction is about; (3e's review) with the basis of its suspension or termination, null for none. */
  reviewed: { kind: "interim" | "final" | "order"; ground: string | null; ruleId: string | null; rulesVersion: number; legalReference: string | null; decidedAt: string; basis: string | null } | null;
}

export async function statementDecision(q: Runner, decisionId: string): Promise<StatementDecisionRow | null> {
  const [row] = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.case_id, d.kind, d.outcome, d.ground, d.rule_id, d.rules_version, d.redress_version, d.source, ${iso("d.decided_at")} as decided_at, d.suspect, d.author_mail, ${iso("d.author_mail_at")} as author_mail_at, d.decided_by,
               (select t.text from staff_texts t where t.digest = d.facts_digest) as facts,
               (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
               (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal_reference,
               c.target_type, c.target_id,
               (select ${iso("p.created_at")} from posts p where c.target_type = 'post' and p.id = c.target_id) as post_created_at,
               case when c.target_type = 'post' then (select p.author_id from posts p where p.id = c.target_id) else c.target_id end as subject_id,
               r.kind as reviewed_kind, r.ground as reviewed_ground, r.rule_id as reviewed_rule, r.rules_version as reviewed_rules_version, ${iso("r.decided_at")} as reviewed_at,
               (select t.text from staff_texts t where t.digest = r.legal_reference_digest) as reviewed_legal,
               (select a.basis::text from decision_actions a where a.decision_id = r.id and a.kind::text in ('suspend', 'terminate')) as reviewed_basis
          from decisions d join cases c on c.id = d.case_id left join decisions r on r.id = d.reviews_decision_id
         where d.id = ${decisionId}::uuid`,
  );
  if (!row) return null;
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    kind: row.kind as StatementDecisionRow["kind"],
    outcome: row.outcome as string,
    ground: row.ground as string | null,
    ruleId: row.rule_id as string | null,
    rulesVersion: row.rules_version as number,
    redressVersion: row.redress_version as number,
    source: row.source as string,
    decidedAt: row.decided_at as string,
    suspect: row.suspect as boolean,
    authorMail: row.author_mail as string,
    authorMailAt: row.author_mail_at as string | null,
    decidedBy: row.decided_by as string,
    facts: row.facts as string | null,
    reason: row.reason as string | null,
    legalReference: row.legal_reference as string | null,
    targetType: row.target_type as TargetType,
    targetId: row.target_id as string,
    postCreatedAt: row.post_created_at as string | null,
    subjectId: row.subject_id as string | null,
    reviewed:
      row.reviewed_kind === null
        ? null
        : {
            kind: row.reviewed_kind as "interim" | "final" | "order",
            ground: row.reviewed_ground as string | null,
            ruleId: row.reviewed_rule as string | null,
            rulesVersion: row.reviewed_rules_version as number,
            legalReference: row.reviewed_legal as string | null,
            decidedAt: row.reviewed_at as string,
            basis: row.reviewed_basis as string | null,
          },
  };
}

/** One ledger row of a decision as its statement tells of it: for a reversal the measure it lifts, for a seal what its list held. */
export interface StatementActionRow {
  kind: ActionKind;
  mediaId: string | null;
  noEffect: "already" | "deleted" | null;
  /** For a reversal: the decision that holds the lifted measure, its rule, whether that measure changed anything, and whether korbat still kept that decision's snapshot when this one was made. */
  lifted: { decisionId: string; ruleId: string | null; noEffect: string | null; snapshotKept: boolean } | null;
  sealedPosts: number;
  sealedImages: number;
  /** The seal's images on posts their author had deleted by the time it was recorded: nothing later is read. */
  sealedDeletedImages: number;
  /** A strike's end of counting, and the strikes of its account that stood and counted at its decision's time, this one included. */
  endsAt: string | null;
  activeThen: number | null;
  /** On a suspension or a termination: whether it was announced; null on every other kind. */
  announced: boolean | null;
  /**
   * On a retirement, the handle of its decision's snapshot in lower case, as the database retires it; on a reversal of one,
   * the same of the lifted decision. A snapshot keeps its handle through an erasure (3e design, section 6.7). Null otherwise.
   */
  handle: string | null;
  /** On a retirement that changed the profile, the placeholder it gave, made from the measure's id as the database makes it. */
  placeholder: string | null;
  /**
   * 3e (design, section 10.2), on a standing measure: its days, its basis, its earliest start (the row's starts_at), and
   * one entry for each decision it rests on (its time, its rule and the time of its post; for a protective suspension
   * the sealing decision's time alone). A measure taken at once also ends: `endsAt` is its created_at plus its days.
   */
  days: number | null;
  basis: string | null;
  earliestStart: string | null;
  restsOn: { decidedAt: string; ruleId: string | null; postCreatedAt: string | null }[] | null;
  /**
   * 3e, on the lift of a suspension or a termination: the lifted measure's kind and decision's time, where its period
   * stood at this decision's time (by suspension_periods, whose end a lift cuts to the lift's time), and whether the lift
   * was signed `replaced`.
   */
  liftedKind: "suspend" | "terminate" | "warn_reporting" | "restrict_reporting" | null;
  liftedDecidedAt: string | null;
  periodThen: { state: "not_started" | "running" | "ended"; startedAt: string | null; endedAt: string | null } | null;
  replaced: boolean | null;
  /** 3e Task 4, on such a lift: when the person had replied to the lifted measure, or null when they had not. */
  replyFiledAt: string | null;
  /** 3e Task 5, on a restriction of reporting: the time of the warning it follows (its decision's). */
  warnedAt: string | null;
}

/** A decision's measures and reversals, in the ledger's order of kinds. */
export async function statementActions(q: Runner, decisionId: string): Promise<StatementActionRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select a.kind, a.media_id, a.no_effect, l.decision_id as lifted_decision, ld.rule_id as lifted_rule, l.no_effect as lifted_no_effect,
               (ls.erased_at is null or ls.erased_at > d.decided_at) as lifted_snapshot_kept,
               (select count(*)::int from seal_posts s where s.action_id = a.id) as sealed_posts,
               (select coalesce(sum(s.images), 0)::int from seal_posts s where s.action_id = a.id) as sealed_images,
               (select coalesce(sum(s.images), 0)::int from seal_posts s join posts p on p.id = s.post_id
                 where s.action_id = a.id and p.state = 'deleted_by_author' and p.deleted_at <= a.created_at) as sealed_deleted,
               case when a.kind in ('strike', 'warn_reporting') then ${iso("a.ends_at")}
                    when a.kind = 'suspend' and a.announced is false then ${iso("(a.created_at + make_interval(days => a.days))")}
                    when a.kind = 'restrict_reporting' then ${iso("(a.starts_at + make_interval(days => a.days))")} end as ends_at,
               case when a.kind in ('suspend', 'terminate', 'restrict_reporting') then a.days end as days,
               case when a.kind in ('suspend', 'terminate', 'warn_reporting', 'restrict_reporting') then a.basis end as basis,
               -- 3e Task 5: the warning a restriction of reporting follows, by its decision's time (the one entry of rests_on).
               case when a.kind = 'restrict_reporting' then (select ${iso("x.decided_at")} from decisions x where x.id = a.rests_on[1]) end as warned_at,
               case when a.kind in ('suspend', 'terminate') then ${iso("a.starts_at")} end as earliest_start,
               -- The decisions a standing measure rests on, in the ledger's order: what korbat fixed for good about each.
               case when a.kind in ('suspend', 'terminate') and a.rests_on is not null then (
                 select json_agg(json_build_object('decidedAt', ${iso("x.decided_at")},
                                                   'ruleId', case when a.basis = 'protective' then null else x.rule_id end,
                                                   'postCreatedAt', case when a.basis = 'protective' then null else ${iso("xp.created_at")} end) order by u.ord)
                   from unnest(a.rests_on) with ordinality as u(id, ord)
                   join decisions x on x.id = u.id
                   join cases xc on xc.id = x.case_id
                   left join posts xp on xc.target_type = 'post' and xp.id = xc.target_id) end as rests_on,
               case when a.kind in ('lift_suspension', 'lift_reporting') then l.kind::text end as lifted_kind,
               case when a.kind in ('lift_suspension', 'lift_reporting') then ${iso("ld.decided_at")} end as lifted_decided_at,
               case when a.kind = 'lift_suspension' then a.replaced end as replaced,
               -- Whether the person had replied to the lifted measure before this lift: a withdrawal then says it is no answer to it.
               case when a.kind = 'lift_suspension' then (select ${iso("r.filed_at")} from suspension_replies r where r.action_id = l.id and r.filed_at <= a.created_at) end as reply_filed_at,
               -- Where the lifted measure's period stood at this lift's time: the lift cuts its end to that time, so a period
               -- that ends before it had already ended, and one with no start, or a start not before it, never started.
               ${iso("lp.starts_at")} as lifted_started_at, ${finite("lp.ends_at")} as lifted_ended_at,
               case when a.kind = 'lift_reporting' and l.kind = 'restrict_reporting'
                      then case when l.starts_at + make_interval(days => l.days) <= a.created_at then 'ended' else 'running' end
                    when a.kind <> 'lift_suspension' then null
                    when lp.starts_at is null or lp.starts_at >= a.created_at then 'not_started'
                    when lp.ends_at < a.created_at then 'ended' else 'running' end as lifted_state,
               -- 3e Task 5: a lifted restriction of reporting started with its decision and ran its days, unless lifted first.
               ${iso("l.starts_at")} as lifted_restriction_started_at, ${iso("(l.starts_at + make_interval(days => l.days))")} as lifted_restriction_ends_at,
               -- What the ledger held at the decision's time, never later: a strike that counted then, and was not overruled by then.
               case when a.kind = 'strike' then (select count(*)::int from decision_actions s
                     where s.subject_account_id = a.subject_account_id and s.kind = 'strike' and s.created_at <= a.created_at and s.ends_at > a.created_at
                       and not exists (select 1 from decision_actions r where r.reverses_action_id = s.id and r.created_at <= a.created_at)) end as active_then,
               case when a.kind in ('suspend', 'terminate') then a.announced end as announced,
               case when a.kind = 'retire_handle' then (select lower(s.handle) from evidence_snapshots s where s.id = d.snapshot_id)
                    when a.kind = 'unretire_handle' then lower(ls.handle) end as handle,
               -- The placeholder exactly as decision_actions_apply computes it, for a retirement that wrote it.
               case when a.kind = 'retire_handle' and a.no_effect is null
                    then 'retired_' || substr(encode(sha256(convert_to(a.id::text, 'UTF8')), 'hex'), 1, 12) end as placeholder
          from decision_actions a join decisions d on d.id = a.decision_id
          left join decision_actions l on l.id = a.reverses_action_id
          left join decisions ld on ld.id = l.decision_id
          left join evidence_snapshots ls on ls.id = ld.snapshot_id
          left join suspension_periods lp on a.kind = 'lift_suspension' and lp.action_id = l.id
         where a.decision_id = ${decisionId}::uuid order by a.kind, a.media_id`,
  );
  return found.map((row) => ({
    kind: row.kind as ActionKind,
    mediaId: row.media_id as string | null,
    noEffect: row.no_effect as StatementActionRow["noEffect"],
    lifted: row.lifted_decision === null ? null : { decisionId: row.lifted_decision as string, ruleId: row.lifted_rule as string | null, noEffect: row.lifted_no_effect as string | null, snapshotKept: row.lifted_snapshot_kept as boolean },
    sealedPosts: row.sealed_posts as number,
    sealedImages: row.sealed_images as number,
    sealedDeletedImages: row.sealed_deleted as number,
    endsAt: row.ends_at as string | null,
    activeThen: row.active_then as number | null,
    announced: row.announced as boolean | null,
    handle: row.handle as string | null,
    placeholder: row.placeholder as string | null,
    days: row.days as number | null,
    basis: row.basis as string | null,
    earliestStart: row.earliest_start as string | null,
    restsOn: row.rests_on as StatementActionRow["restsOn"],
    liftedKind: row.lifted_kind as StatementActionRow["liftedKind"],
    liftedDecidedAt: row.lifted_decided_at as string | null,
    periodThen:
      row.lifted_state === null
        ? null
        : row.kind === "lift_reporting"
          ? {
              // A restriction of reporting starts with its decision: it ran, or had run its days, when it was lifted.
              state: row.lifted_state as "running" | "ended",
              startedAt: row.lifted_restriction_started_at as string | null,
              endedAt: row.lifted_state === "ended" ? (row.lifted_restriction_ends_at as string | null) : null,
            }
          : {
              state: row.lifted_state as "not_started" | "running" | "ended",
              startedAt: row.lifted_state === "not_started" ? null : (row.lifted_started_at as string | null),
              endedAt: row.lifted_state === "ended" ? (row.lifted_ended_at as string | null) : null,
            },
    replaced: row.replaced as boolean | null,
    replyFiledAt: row.reply_filed_at as string | null,
    warnedAt: row.warned_at as string | null,
  }));
}

/** A measure taken while deciding that ended with a final decision, without a reversal. */
export interface EndedMeasureRow {
  kind: ActionKind;
  mediaId: string | null;
  decisionId: string;
  ruleId: string | null;
  noEffect: string | null;
  snapshotKept: boolean;
}

/**
 * The measures taken while deciding that ended with this final decision, of those their author was told of: every one
 * that was still in force when the decision closed its case, and a seal taken while deciding whose suspect items the
 * decision answered, unless the decision itself seals (the images then stay sealed). It reads only what stood when the
 * decision was made: a reversal recorded later, or an item that arrived later, changes nothing here.
 */
export async function endedMeasures(q: Runner, decisionId: string): Promise<EndedMeasureRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select a.kind, a.media_id, i.id as decision_id, i.rule_id, a.no_effect, (s.erased_at is null or s.erased_at > d.decided_at) as snapshot_kept
          from decisions d
          join cases c on c.id = d.case_id
          join decisions i on i.case_id = d.case_id and i.kind = 'interim' and i.decided_at < d.decided_at and i.author_mail <> 'none'
          join decision_actions a on a.decision_id = i.id
          join evidence_snapshots s on s.id = i.snapshot_id
         where d.id = ${decisionId}::uuid and d.kind = 'final'
           and a.kind in ('withhold', 'seal_media', 'withhold_media', 'reset_display_name', 'reset_bio')
           and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id and r.created_at <= d.decided_at)
           and case when a.kind = 'seal_media'
                 then exists (select 1 from intake_items x where x.case_id = d.case_id and x.suspect and x.answered_by = d.id and x.created_at <= i.decided_at)
                      and not exists (select 1 from decision_actions own where own.decision_id = d.id and own.kind = 'seal_media')
                 else c.closed_at = d.decided_at end
         order by i.decided_at, a.kind, a.media_id`,
  );
  return found.map((row) => ({ kind: row.kind as ActionKind, mediaId: row.media_id as string | null, decisionId: row.decision_id as string, ruleId: row.rule_id as string | null, noEffect: row.no_effect as string | null, snapshotKept: row.snapshot_kept as boolean }));
}

/** A standing measure, or a restriction of reporting, whose basis a reversal of a decision broke (3e design, sections 6.2 and 10.2). */
export interface EndedStandingRow {
  kind: "suspend" | "terminate" | "restrict_reporting";
  decidedAt: string;
  periodThen: { state: "not_started" | "running" | "ended"; startedAt: string | null; endedAt: string | null };
  seal: boolean;
  replyFiledAt: string | null;
}

/**
 * The suspensions and terminations whose basis this review or correction broke: those that name the reviewed decision in
 * rests_on and whose basis broke at this decision's time (standing_basis_broken_at answers the time of the reversal that
 * broke it, which is this decision's own). For each, where its period stood at this decision's time (the break cut its
 * end to that time), whether the basis was a seal, and the time of its reply when this decision answered it. Task 5:
 * the restrictions of reporting whose warning this decision lifted, unless a lift of their own came first; a restriction
 * starts with its decision, so it was running, or had run its days (ended), at this decision's time.
 */
export async function endedStanding(q: Runner, decisionId: string): Promise<EndedStandingRow[]> {
  const found = await rows<{ kind: EndedStandingRow["kind"]; decided_at: string; state: "not_started" | "running" | "ended"; started_at: string | null; ended_at: string | null; seal: boolean; reply_filed_at: string | null }>(
    q,
    sql`select m.kind::text as kind, ${iso("md.decided_at")} as decided_at, t.state,
               ${iso("t.started_at")} as started_at, ${finite("t.ended_at")} as ended_at,
               m.basis = 'protective' as seal,
               (select ${iso("r.filed_at")} from suspension_replies r where r.action_id = m.id and r.answered_by = d.id) as reply_filed_at
          from decisions d
          join decision_actions m on m.kind in ('suspend', 'terminate', 'restrict_reporting') and d.reviews_decision_id = any(m.rests_on)
          join decisions md on md.id = m.decision_id
          left join suspension_periods p on p.action_id = m.id
          cross join lateral (
            select case when m.kind = 'restrict_reporting'
                        then case when m.starts_at + make_interval(days => m.days) <= d.decided_at then 'ended' else 'running' end
                        when p.starts_at is null or p.starts_at >= d.decided_at then 'not_started'
                        when p.ends_at < d.decided_at then 'ended' else 'running' end as state,
                   case when m.kind = 'restrict_reporting' then m.starts_at else p.starts_at end as started_at,
                   case when m.kind = 'restrict_reporting' then m.starts_at + make_interval(days => m.days) else p.ends_at end as ended_at
          ) t
         where d.id = ${decisionId}::uuid and d.kind in ('review', 'correction')
           and public.standing_basis_broken_at(m.id) = d.decided_at
           and (m.kind <> 'restrict_reporting' or not exists (select 1 from decision_actions x where x.reverses_action_id = m.id and x.created_at < d.decided_at))
         order by md.decided_at, m.id`,
  );
  return found.map((row) => ({
    kind: row.kind,
    decidedAt: row.decided_at,
    periodThen: { state: row.state, startedAt: row.state === "not_started" ? null : row.started_at, endedAt: row.state === "ended" ? row.ended_at : null },
    seal: row.seal,
    replyFiledAt: row.reply_filed_at,
  }));
}

/** The reply a correction or a review answered by keeping or reversing its measure (3e design, section 10.2). */
export interface RepliedToRow {
  filedAt: string;
  onTime: boolean;
  kind: "suspend" | "terminate";
  days: number | null;
  periodThen: { state: "not_started" | "running" | "ended"; startedAt: string | null; endedAt: string | null };
  startsAt: string | null;
  endsAt: string | null;
  appealUntil: string;
}

/**
 * The reply this correction or review answered by keeping or reversing the measure of the decision it is about: a reply
 * to a suspension or a termination of that decision whose answering decision is this one. Never a withdrawal signed
 * `replaced` (it is no answer on the reply's merits), and never the end of a broken basis (that measure is not the
 * reviewed decision's: its reply is the reversal's endedStanding). Null when there is none.
 *
 * Each member is what the ledger fixed by this answer's time, so the statement reads as it was sent. The start: after a
 * kept answer to a reply before the start, the later of the answer and the earliest start, which nothing later moves; for
 * any other answer the period's own start, already fixed before the reply (a late reply) or never (a reversed one before
 * the start, which has no row). The end: a kept suspension's start plus its days; a reversed one's period end, which this
 * lift cut; null for a termination and for a measure that never starts. Where the period stood at this answer's time, by
 * those two. And the last moment of the announcing decision's appeal after this answer (appeal_informed_at).
 */
export async function repliedTo(q: Runner, decisionId: string): Promise<RepliedToRow | null> {
  const [row] = await rows<{
    filed_at: string;
    on_time: boolean;
    kind: "suspend" | "terminate";
    days: number | null;
    kept: boolean;
    starts_at: string | null;
    ends_at: string | null;
    started: boolean;
    ended: boolean;
    appeal_until: string;
  }>(
    q,
    sql`select ${iso("r.filed_at")} as filed_at, r.on_time, m.kind::text as kind, m.days, t.kept,
               ${iso("t.starts_at")} as starts_at, ${finite("t.ends_at")} as ends_at,
               coalesce(t.starts_at <= d.decided_at, false) as started, coalesce(t.ends_at <= d.decided_at, false) as ended,
               ${iso("public.appeal_deadline(public.appeal_informed_at(m.decision_id))")} as appeal_until
          from decisions d
          join decision_actions m on m.decision_id = d.reviews_decision_id and m.kind::text in ('suspend', 'terminate')
          join suspension_replies r on r.action_id = m.id and r.answered_by = d.id
          left join suspension_periods p on p.action_id = m.id
          cross join lateral (
            select x.kept,
                   case when x.kept and r.on_time then greatest(m.starts_at, r.answered_at) else p.starts_at end as starts_at,
                   case when m.kind::text = 'terminate' then null
                        when x.kept and r.on_time then greatest(m.starts_at, r.answered_at) + make_interval(days => m.days)
                        when x.kept then p.starts_at + make_interval(days => m.days)
                        else p.ends_at end as ends_at
              from (select not exists (select 1 from decision_actions l where l.decision_id = d.id and l.reverses_action_id = m.id) as kept) x
          ) t
         where d.id = ${decisionId}::uuid and d.kind in ('review', 'correction')
           and not exists (select 1 from decision_actions w where w.decision_id = d.id and w.kind = 'lift_suspension' and w.replaced)`,
  );
  if (!row) return null;
  const state: RepliedToRow["periodThen"]["state"] = !row.started ? "not_started" : row.ended ? "ended" : "running";
  return {
    filedAt: row.filed_at,
    onTime: row.on_time,
    kind: row.kind,
    days: row.kind === "terminate" ? null : row.days,
    periodThen: { state, startedAt: state === "not_started" ? null : row.starts_at, endedAt: state === "ended" ? row.ends_at : null },
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    appealUntil: row.appeal_until,
  };
}

/**
 * 3f (design, sections 7.10 and 10.4): what the notice of an order decision, or of the correction that reinstates after
 * one, is rendered from, read at every read from the order decision's row, its item's and its order's as they stand, so
 * the notice grows without a new decision; and the authority's words with the time from which the author holds them
 * (the newest texts_recorded event, or the decision's informed_at when that is later). Null for any other decision.
 * The home state is the API's setting, which the caller passes.
 */
export async function orderNoticeOf(
  q: Runner,
  decisionId: string,
  homeState: string | null,
): Promise<{ facts: OrderNoticeFacts; texts: OrderTexts; authorMailAt: string | null; erasedOn: string | null } | null> {
  const [row] = await rows<Record<string, unknown>>(
    q,
    sql`select o.kind, o.member_state, o.authority, o.reference, o.verified_at is not null as verified,
               to_char(coalesce(o.issued_at, o.received_at) at time zone 'UTC', 'YYYY-MM-DD') as ordered_on,
               case when o.issued_at is not null then 'issued' when o.received_at is not null then 'received' end as ordered_from,
               o.cross_border, a.withhold_author, ${iso("od.decided_at")} as disabled_at,
               coalesce(od.informed_at > od.decided_at, false) as held, ${iso("od.informed_at")} as informed_at, o.hold_end_reason,
               ${iso("i.preserve_until")} as preserve_until,
               exists (select 1 from legal_order_events e where e.item_id = i.id and e.kind = 'preservation_extended') as preserve_extended,
               to_char(i.preserve_ended_at at time zone 'UTC', 'YYYY-MM-DD') as preserve_ended_on,
               -- Task 4: the day the preservation's end erased the post, which sets the post's erased_at and the item's
               -- preserve_ended_at to the same instant; null for an end without an erasure.
               case when p.erased_at = i.preserve_ended_at then to_char(i.preserve_ended_at at time zone 'UTC', 'YYYY-MM-DD') end as erased_on,
               (select x.order_ground from decision_actions x where x.decision_id = d.id and x.kind::text = 'reinstate_by_order') as order_ground,
               o.reasons, o.redress, o.scope,
               ${iso("(select max(e.at) from legal_order_events e where e.order_id = o.id and e.kind = 'texts_recorded')")} as texts_recorded_at,
               ${iso("d.author_mail_at")} as author_mail_at
          from decisions d
          join decisions od on od.id = case when d.kind::text = 'order' then d.id else d.reviews_decision_id end and od.kind::text = 'order'
          join legal_order_items i on i.id = od.order_item_id
          join legal_orders o on o.id = i.order_id
          join decision_actions a on a.decision_id = od.id and a.kind::text = 'disable_by_order'
          left join posts p on p.id = i.post_id
         where d.id = ${decisionId}::uuid and d.kind::text in ('order', 'correction')`,
  );
  if (!row) return null;
  const informedAt = row.informed_at as string | null;
  const recordedAt = row.texts_recorded_at as string | null;
  const anyText = row.reasons !== null || row.redress !== null || row.scope !== null;
  // The author holds a text from the later of its record and the telling: a notice released after the record holds it from the release.
  const textsAt = !anyText || recordedAt === null ? null : informedAt !== null && Date.parse(informedAt) > Date.parse(recordedAt) ? informedAt : recordedAt;
  return {
    facts: {
      kind: row.kind as OrderNoticeFacts["kind"],
      memberState: row.member_state as OrderNoticeFacts["memberState"],
      authority: row.authority as string,
      reference: row.reference as string,
      verified: row.verified as boolean,
      orderedOn: row.ordered_on as string | null,
      orderedFrom: row.ordered_from as OrderNoticeFacts["orderedFrom"],
      crossBorder: row.cross_border as boolean,
      homeState: homeState as OrderNoticeFacts["homeState"],
      withholdAuthor: row.withhold_author as boolean,
      disabledAt: row.disabled_at as string,
      held: row.held as boolean,
      informedAt,
      holdEndReason: row.hold_end_reason as OrderNoticeFacts["holdEndReason"],
      preserveUntil: row.preserve_until as string | null,
      preserveExtended: row.preserve_extended as boolean,
      preserveEndedOn: row.preserve_ended_on as string | null,
      orderGround: row.order_ground as OrderNoticeFacts["orderGround"],
    },
    texts: { reasons: row.reasons as string | null, redress: row.redress as string | null, scope: row.scope as string | null, textsAt },
    authorMailAt: row.author_mail_at as string | null,
    erasedOn: row.erased_on as string | null,
  };
}
