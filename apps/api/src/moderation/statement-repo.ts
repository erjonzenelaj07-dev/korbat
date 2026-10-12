import { sql } from "drizzle-orm";
import type { ActionKind } from "@korbat/contracts";
import { iso, rows, type Runner, type TargetType } from "./repo";

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
  kind: "interim" | "final" | "review" | "correction";
  outcome: string;
  ground: string | null;
  ruleId: string | null;
  rulesVersion: number;
  redressVersion: number;
  source: string;
  decidedAt: string;
  suspect: boolean;
  authorMail: string;
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
  /** The decision a review or a correction is about. */
  reviewed: { kind: "interim" | "final"; ground: string | null; ruleId: string | null; rulesVersion: number; legalReference: string | null; decidedAt: string } | null;
}

export async function statementDecision(q: Runner, decisionId: string): Promise<StatementDecisionRow | null> {
  const [row] = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.case_id, d.kind, d.outcome, d.ground, d.rule_id, d.rules_version, d.redress_version, d.source, ${iso("d.decided_at")} as decided_at, d.suspect, d.author_mail, d.decided_by,
               (select t.text from staff_texts t where t.digest = d.facts_digest) as facts,
               (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
               (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal_reference,
               c.target_type, c.target_id,
               (select ${iso("p.created_at")} from posts p where c.target_type = 'post' and p.id = c.target_id) as post_created_at,
               case when c.target_type = 'post' then (select p.author_id from posts p where p.id = c.target_id) else c.target_id end as subject_id,
               r.kind as reviewed_kind, r.ground as reviewed_ground, r.rule_id as reviewed_rule, r.rules_version as reviewed_rules_version, ${iso("r.decided_at")} as reviewed_at,
               (select t.text from staff_texts t where t.digest = r.legal_reference_digest) as reviewed_legal
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
        : { kind: row.reviewed_kind as "interim" | "final", ground: row.reviewed_ground as string | null, ruleId: row.reviewed_rule as string | null, rulesVersion: row.reviewed_rules_version as number, legalReference: row.reviewed_legal as string | null, decidedAt: row.reviewed_at as string },
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
                 where s.action_id = a.id and p.state = 'deleted_by_author' and p.deleted_at <= a.created_at) as sealed_deleted
          from decision_actions a join decisions d on d.id = a.decision_id
          left join decision_actions l on l.id = a.reverses_action_id
          left join decisions ld on ld.id = l.decision_id
          left join evidence_snapshots ls on ls.id = ld.snapshot_id
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
