import type { Logger } from "pino";
import { EDGE_RULES } from "@korbat/contracts";
import { createJob, type JobLock } from "../lib/jobs";
import type { EdgeAdapter } from "./edge-adapter";
import type { MediaRepo } from "./repo";

/**
 * The outbox's job, edge-purge (3d design, sections 7.4 and 7.14; Task 3). Every image that stops being public has its
 * row in edge_purges, written by the database's triggers in the transaction that hid it; this job drains the rows after
 * the commit, one round at a time under the jobs' shared lock, a round EDGE_RULES.roundSeconds after the last one ended:
 *
 *   1. With the adapter off (EDGE_PURGE=off, the default) every row without an outcome closes as off. Nothing is sent.
 *   2. With it on, the oldest due rows of up to EDGE_RULES.prefixes images: one prefix an image, one request a round, so
 *      at most four requests a minute. Accepted, every row the round read closes as accepted; a row written while the
 *      request was out was not read and stays open, since it may stand for a hiding the purge did not cover. Failed, each
 *      row the round read backs off, from EDGE_RULES.backoffSeconds doubled a failure to EDGE_RULES.backoffMaxSeconds,
 *      and a row written EDGE_RULES.giveUpHours ago is given up as failed, with the alert edge_purge_failed, its own row,
 *      at most once in 24 hours.
 *   3. A round that throws leaves its rows as they were.
 *
 * A purge never delays, blocks or undoes a measure, which committed before its row could be read; an accepted purge is no
 * proof that every edge node dropped its copy, so the header stays the bound (EDGE_CACHE). The token is the adapter's
 * alone: no log line here names more than counts.
 */

/** The job's name: its lock is `job:edge-purge`, and its log lines carry it. */
export const EDGE_JOB = "edge-purge";
/** The time between the end of one round and the start of the next. */
export const EDGE_ROUND_MS = EDGE_RULES.roundSeconds * 1000;

export interface EdgeDeps {
  repo: Pick<MediaRepo, "edgeOff" | "edgeDue" | "edgeAccepted" | "edgeFailed" | "edgeAlert">;
  adapter: EdgeAdapter;
  log: Logger;
}

/** What one round did: the rows closed as off, the request it sent (0 or 1) with its prefixes, and its end. */
export interface EdgeRoundReport {
  off: number;
  sent: number;
  prefixes: number;
  outcome: "accepted" | "failed" | null;
  /** Rows closed as accepted. */
  closed: number;
  /** Rows given up as failed. */
  gaveUp: number;
  /** Whether the round wrote edge_purge_failed. */
  alerted: boolean;
}

export async function edgeRound(deps: EdgeDeps): Promise<EdgeRoundReport> {
  const report: EdgeRoundReport = { off: 0, sent: 0, prefixes: 0, outcome: null, closed: 0, gaveUp: 0, alerted: false };
  if (deps.adapter.mode === "off") {
    report.off = await deps.repo.edgeOff();
    return report;
  }
  const rows = await deps.repo.edgeDue(EDGE_RULES.prefixes);
  if (rows.length === 0) return report;
  // One prefix an image, in the order the rows came: an image's two rows (its post's state, then its own delete) are one.
  const images = [...new Set(rows.map((row) => row.mediaId))];
  const ids = rows.map((row) => row.id);
  report.sent = 1;
  report.prefixes = images.length;
  report.outcome = await deps.adapter.purge(images.map((id) => deps.adapter.prefix(id)));
  if (report.outcome === "accepted") {
    report.closed = await deps.repo.edgeAccepted(ids);
    deps.log.info({ job: EDGE_JOB, images: images.length, rows: report.closed }, "edge-purge: the provider took the purge");
    return report;
  }
  const failed = await deps.repo.edgeFailed(ids);
  report.gaveUp = failed.gaveUp;
  deps.log.warn({ job: EDGE_JOB, images: images.length, rows: ids.length, gaveUp: failed.gaveUp }, "edge-purge: the purge was not taken; its rows wait and are sent again");
  if (failed.gaveUp > 0 && failed.oldestAt !== null) {
    report.alerted = await deps.repo.edgeAlert({ count: failed.gaveUp, oldestAt: failed.oldestAt });
    deps.log.error({ job: EDGE_JOB, gaveUp: failed.gaveUp, alerted: report.alerted }, "edge-purge: purges failed for a day and were given up; the header bounds every copy, and staff are alerted");
  }
  return report;
}

/** The job under the shared lock: a round EDGE_ROUND_MS after the last one ended, on one instance at a time. */
export function createEdgeJob(deps: EdgeDeps, lock: JobLock) {
  return createJob({ name: EDGE_JOB, intervalMs: EDGE_ROUND_MS, lockTtlMs: EDGE_ROUND_MS * 2, lock, log: deps.log, run: () => edgeRound(deps) });
}
