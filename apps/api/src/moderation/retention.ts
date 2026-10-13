import { sql } from "drizzle-orm";
import { RETENTION } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../auth";
import { createJob, type JobLock } from "../lib/jobs";
import { DISPOSAL_BATCH } from "../media";
import { appendAuditRow } from "../staff";
import type { ModerationDeps } from "./context";
import { deleteAccessLog, dueCases, dueIntakes, dueRedactions, dueStatements, eraseCaseEvidence, eraseIntake, eraseReplyStatements, eraseStatementTexts, forgetReportCounts, redactR4, sweepStaffTexts } from "./repo";

/**
 * The retention job (3c design, sections 6.4, 6.6 and 7.9): every ten minutes it deletes the drafts nobody confirmed,
 * erases the evidence of the cases and the records of the intakes that are due, makes R4 redactions final, erases the
 * statements of accounts deleted for 12 months, erases the texts of replies to suspensions that are answered and final
 * and forgets the reporting counts of the days before their frame (3e design, section 7.14), deletes the old access rows,
 * and deletes the image rows that a case or a freeze kept and nothing retains any more.
 *
 * The job only names what it believes is due. Each erase function of migration 0018 checks its own rule again, against
 * values the API role cannot set, and the two gates of the freeze decide for every snapshot and every image row: so a
 * wrong candidate, or an API that asks early, erases nothing.
 *
 * Every step, and within a step every row, runs in a transaction of its own, which ends with one audit row when it
 * changed something and writes nothing when it did not. A row that raises is rolled back alone, logged with the step and
 * the row's id, and tried again at the next round: a case that keeps failing never stops another case's erasure. No log
 * line carries an address, a handle or an account id.
 */

const MINUTE_MS = 60_000;

/** The job's name: its lock is `job:moderation-retention`, and its log lines carry it. */
export const RETENTION_JOB = "moderation-retention";
/** The time between the end of one round and the start of the next. */
export const RETENTION_INTERVAL_MS = 10 * MINUTE_MS;
/** The audit action of every step that changed something. It is written by the server itself, never under a step-up. */
export const RETENTION_ACTION = "moderation_retention";
/** What the API logs at every start while the job is switched off, which the README's restore steps do for a restore window. */
export const RETENTION_OFF_WARNING = "moderation-retention: off (MODERATION_RETENTION)";

/** The steps, by the name their audit rows and log lines carry. */
export type RetentionStep = "drafts" | "case_evidence" | "intake_record" | "redaction" | "statements" | "reply_statements" | "report_counts" | "access_log" | "images";

/** What one round did, for its log line and for the tests: counts only. */
export interface RetentionReport {
  /** The drafts deleted. */
  drafts: number;
  /** The cases whose evidence was erased, the intakes whose record was, the R4 decisions redacted and the decisions whose statements were erased. */
  cases: number;
  intakes: number;
  redactions: number;
  statements: number;
  /** 3e: the replies whose text was erased, and the marks and daily tallies of reporting deleted with their frame. */
  replies: number;
  reportCounts: number;
  /** The access rows deleted, with the reveal reasons erased before them. */
  accessLog: number;
  /** The size of each batch of image rows the disposal deleted, in order; the last one is smaller than a full batch. */
  batches: number[];
  /** The steps and rows that raised and were left for the next round. */
  failed: number;
}

/** The ids a step's audit row names; each is null where the step has none. */
interface StepIds {
  caseId?: string;
  intakeId?: string;
  decisionId?: string;
}

/**
 * One step, or one row of a step, in a transaction of its own: the change, then its audit row as the transaction's last
 * statement, since the insert holds the chain's head until the commit. A change of nothing writes nothing. A lock is
 * waited on for at most ten seconds, so a transaction left open elsewhere costs this row a round, never the job.
 */
async function inStep(deps: Pick<ModerationDeps, "apiDb">, step: RetentionStep, ids: StepIds, change: (tx: DbTx) => Promise<number>): Promise<number> {
  return deps.apiDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const count = await change(tx);
    if (count > 0) {
      await appendAuditRow(tx, {
        actorId: SYSTEM_ACTOR_ID,
        action: RETENTION_ACTION,
        targetType: null,
        targetId: null,
        requestId: null,
        // Ids and counts only, never a text.
        metadata: { step, caseId: ids.caseId ?? null, intakeId: ids.intakeId ?? null, decisionId: ids.decisionId ?? null, count },
      });
    }
    return count;
  });
}

/**
 * The disposal: the one deleter of image rows that a case or a freeze kept, in batches. Each batch is a transaction of
 * its own with its audit row, and its files are requested right after its commit and before the next batch. They are
 * never requested before the commit: a disposable row is not disposable for good (a report may freeze a deleted post's
 * images at any moment), so a batch rolled back after its request would lose the files of rows a freeze then keeps.
 *
 * No row goes unless its files can be found again. The media module notes inside the batch's transaction that the files
 * are owed (a batch whose note cannot be written does not commit), and the request is written from that note when this
 * process stops between the commit and the request, or when the request fails. A failed request ends the step for the
 * round, and every round begins by asking again for what is still owed, by this job or by the account's purge: while
 * that cannot be written no batch is taken, so a volume that takes no requests costs one batch's wait and never a second
 * batch's rows. The failure is logged with the step; what is owed is counted among the overview's late erasures.
 */
async function dispose(deps: Pick<ModerationDeps, "apiDb" | "media" | "log">, report: RetentionReport): Promise<void> {
  const owed = await deps.media.requestOwed();
  if (owed > 0) {
    report.failed++;
    deps.log.error({ job: RETENTION_JOB, step: "images", owed }, "moderation-retention: files of image rows that are gone are still owed a request; no batch is taken until they can be asked for");
    return;
  }
  for (;;) {
    let ids: string[] = [];
    await inStep(deps, "images", {}, async (tx) => {
      ids = await deps.media.dropDisposable(tx);
      return ids.length;
    });
    report.batches.push(ids.length);
    if (ids.length > 0) {
      try {
        await deps.media.requestDeletion(ids);
      } catch (err) {
        report.failed++;
        deps.log.error({ err, job: RETENTION_JOB, step: "images", count: ids.length }, "moderation-retention: the files of a deleted batch could not be requested; they stay owed, and the disposal takes no further batch until they are asked for");
        return;
      }
    }
    if (ids.length < DISPOSAL_BATCH) return;
  }
}

/** One round. A plain function, so the tests call it directly. */
export async function retentionRound(deps: Pick<ModerationDeps, "apiDb" | "media" | "log">): Promise<RetentionReport> {
  const report: RetentionReport = { drafts: 0, cases: 0, intakes: 0, redactions: 0, statements: 0, replies: 0, reportCounts: 0, accessLog: 0, batches: [], failed: 0 };
  /** A step in a try of its own: what it raises is logged with the step, and the round goes on. */
  const step = async (name: RetentionStep, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      report.failed++;
      deps.log.error({ err, job: RETENTION_JOB, step: name }, "moderation-retention: a step failed; the round goes on");
    }
  };
  /** Each row of a step in a try of its own, under the row's id. */
  const each = async (name: RetentionStep, key: keyof StepIds, ids: readonly string[], change: (tx: DbTx, id: string) => Promise<number>): Promise<number> => {
    let done = 0;
    for (const id of ids) {
      try {
        if ((await inStep(deps, name, { [key]: id }, (tx) => change(tx, id))) > 0) done++;
      } catch (err) {
        report.failed++;
        deps.log.error({ err, job: RETENTION_JOB, step: name, [key]: id }, "moderation-retention: a row failed and was left as it was; the round goes on");
      }
    }
    return done;
  };

  await step("drafts", async () => {
    report.drafts = await inStep(deps, "drafts", {}, (tx) => sweepStaffTexts(tx, RETENTION.draftHours));
  });
  await step("case_evidence", async () => {
    report.cases = await each("case_evidence", "caseId", await dueCases(deps.apiDb), eraseCaseEvidence);
  });
  await step("intake_record", async () => {
    report.intakes = await each("intake_record", "intakeId", await dueIntakes(deps.apiDb, RETENTION.intakeDays), eraseIntake);
  });
  // The redaction answers false, and nothing is written, while its post is frozen: the next round asks again.
  await step("redaction", async () => {
    report.redactions = await each("redaction", "decisionId", await dueRedactions(deps.apiDb), async (tx, id) => ((await redactR4(tx, id)) ? 1 : 0));
  });
  await step("statements", async () => {
    report.statements = await each("statements", "decisionId", await dueStatements(deps.apiDb, RETENTION.statementMonths), eraseStatementTexts);
  });
  // 3e: each of the two is one call of its function, which checks its own rule against values the API role cannot set
  // (the reply's answer, the decision's finality, the frame of standing_rules()), so its audit row names no id.
  await step("reply_statements", async () => {
    report.replies = await inStep(deps, "reply_statements", {}, (tx) => eraseReplyStatements(tx));
  });
  await step("report_counts", async () => {
    report.reportCounts = await inStep(deps, "report_counts", {}, (tx) => forgetReportCounts(tx));
  });
  await step("access_log", async () => {
    report.accessLog = await inStep(deps, "access_log", {}, (tx) => deleteAccessLog(tx, RETENTION.accessLogMonths));
  });
  await step("images", () => dispose(deps, report));

  // One line for a round that did something or failed somewhere: counts only.
  const images = report.batches.reduce((sum, size) => sum + size, 0);
  if (report.drafts + report.cases + report.intakes + report.redactions + report.statements + report.replies + report.reportCounts + report.accessLog + images + report.failed > 0) {
    deps.log.info({ job: RETENTION_JOB, ...report, images }, "moderation-retention: round");
  }
  return report;
}

/** The job: a round every ten minutes, counted from the end of the one before, on one API instance at a time. */
export function createRetentionJob(deps: Pick<ModerationDeps, "apiDb" | "media" | "log">, lock: JobLock) {
  return createJob({ name: RETENTION_JOB, intervalMs: RETENTION_INTERVAL_MS, lockTtlMs: RETENTION_INTERVAL_MS, lock, log: deps.log, run: () => retentionRound(deps) });
}
