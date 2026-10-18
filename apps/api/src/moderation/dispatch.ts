import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { RETENTION, appealDeadline, outcomeWords, type ItemOutcome, type OutcomeWordsInput } from "@korbat/contracts";
import { getRule } from "@korbat/rules";
import { SYSTEM_ACTOR_ID, type AccountMailResult, type NoticeUpdateLine, type NotifierUpdatePart, type NotifierUpdateResult } from "../auth";
import { createJob, type JobLock } from "../lib/jobs";
import { MailUnavailable } from "../mail/mailer";
import { alertUrgentLane, staffAlert } from "./alerts";
import type { ModerationDeps } from "./context";
import { itemLink, receiptMessage, sendReceipt } from "./intake";
import {
  beginMailRecord,
  contactsOwed,
  foldedReceipts,
  giveUpOutcomeMails,
  giveUpReceiptsAndAuthorMails,
  announcedMailsDue,
  giveUpAnnouncedMail,
  lockPendingAuthorMail,
  lockPendingOutcomeLines,
  lockPendingReceipt,
  pendingAuthorMails,
  pendingOutcomeLines,
  pendingReceipts,
  recordCarriedReceipt,
  recordOutcomeMails,
  releaseOutcomes,
  urgentItems,
  waitingCases,
  type MailState,
  type NoticeRow,
  type OutcomeLineRow,
  type UrgentItemRow,
} from "./repo";
import { sendStatement } from "./statement";
import { releaseHeldNotices } from "./orders-repo";
import { appendAuditRow } from "../staff";

/**
 * The dispatch job (3c design, sections 7.8 and 7.12): every ten minutes it repeats the staff alerts that are still due,
 * runs the daily release once its hour has come, sends the receipts and statements a relay failure left pending, mails
 * each address and account one update of the outcomes released to it, and gives up what stayed unsent for five days.
 *
 * A round runs its steps in the order 5, 3, 1, 2, 4, 6 of the design's list: the alerts first, and the daily release,
 * which writes only to the databases, before any mail, so it never waits behind a relay. Every step runs in a try of its
 * own, and so does every mail: a failure is logged with the step and the row's id, never an address, and leaves the row
 * as it was, so a row that keeps failing never stops the alerts, the release or another row's mail. It stays pending
 * until the last step gives it up.
 *
 * Every time the job compares is its own clock's (`deps.now()`), handed to the database as a parameter, so one clock
 * decides what is fifteen minutes or five days old, and a test can move it.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The job's name: its lock is `job:moderation-dispatch`, and its log lines carry it. */
export const DISPATCH_JOB = "moderation-dispatch";
/** The time between the end of one round and the start of the next. */
export const DISPATCH_INTERVAL_MS = 10 * MINUTE_MS;
/** A receipt, a statement and an urgent item are the job's once they are this old: until then the request that made them is still at work on them. */
const DUE_AFTER_MS = 15 * MINUTE_MS;
/** How many pending receipts one round sends. */
const RECEIPTS_PER_ROUND = 100;
/**
 * How many suspect cases one round asks the media module what they reach: one query a case, and a report of child sexual
 * abuse material needs no account, so a flood of them could hold the round's first step for minutes. The oldest cases
 * are read first; any beyond this count as calling, unread, which only repeats an alert that a case read later may ask for
 * anyway.
 */
export const URGENT_REACH_PER_ROUND = 200;
/** How long a cut-off's marker is kept: two days, so a marker is still there for every round of its own day. */
const MARKER_TTL_MS = 2 * DAY_MS;
/** How long the question "is the marker set?" holds the key when the process dies between asking and letting go. */
const MARKER_PROBE_MS = 30_000;

/** The key and the window of the queue-age alert. */
export const WAITING_ALERT_KEY = "moderation-waiting";
export const WAITING_ALERT_WINDOW_MS = DAY_MS;

/** A round's cut-off: the latest dispatch hour (UTC) at or before the round's start. */
export function cutoffOf(start: Date, hour: number): Date {
  const today = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), hour);
  return new Date(today <= start.getTime() ? today : today - DAY_MS);
}

/**
 * The marker of a cut-off's release, by the cut-off's day and hour. Because the key holds the hour, a changed dispatch
 * hour gives a cut-off whose release has not run. It lives beside the jobs' locks, which a restore of the database does
 * not bring back: the README's restore steps delete the markers.
 */
export const dispatchMarkerKey = (cutoff: Date) => `moderation-dispatched:${cutoff.toISOString().slice(0, 13)}`;

/** What one round did, for its log line and for the tests. */
export interface DispatchReport {
  /** The urgent lane's repeat: what became of the alert, or "none" when no item still calls for someone. */
  urgent: "sent" | "throttled" | "unsent" | "nothing_waiting" | "none";
  /** The queue-age alert: what became of it, or "none" when no case is past its time. */
  waiting: "sent" | "throttled" | "unsent" | "none";
  /** How many items the daily release changed, or null when it did not run in this round. */
  released: number | null;
  /** Whether the cut-off's release, both halves, has finished: before this round or in it. */
  marked: boolean;
  /** Whether this round ran the release to its end and wrote the cut-off's marker itself: the daily round. */
  daily: boolean;
  /** The receipts and the statements whose result this round recorded. */
  receipts: number;
  statements: number;
  /** The addresses' contacts and the accounts whose update the relay took. */
  outcomeMails: number;
  givenUp: { receipts: number; authorMails: number; outcomes: number };
  /** 3f: the decisions the release of held notices told in this round. */
  noticesReleased: number;
}

/** What a mail's result is recorded as; nothing is recorded where the relay could not take the mail, so the next round sends it again. */
const RECORDED: Record<NotifierUpdateResult | AccountMailResult, MailState | null> = {
  sent: "sent",
  suppressed: "suppressed",
  no_address: "no_address",
  // A contact the janitor has forgotten has no address any more.
  forgotten: "no_address",
  // The relay refused the address for good: no later try changes that.
  refused: "failed",
  unavailable: null,
};

// ---------------------------------------------------------------- step 5: the alerts

/**
 * Whether an unanswered item of the urgent lane still calls for someone (3c design, section 7.12), in its three cases.
 *   1. A suspect item whose case reaches an image that is still served: until a choice not to seal is recorded on the
 *      case after the item arrived, and then only while no post with a served image was created after the newest such
 *      choice. Nothing else ends it short of the item's answer: after a note, a withhold or a field reset some reader, the
 *      uploader included, is still served the images. A seal ends it by leaving no served image.
 *   2. A suspect item whose case reaches no served image: until a decision taken while deciding, a note or a recorded
 *      choice not to seal comes after the item arrived.
 *   3. Any other item: while no decision taken while deciding came after it and, when the case is about an account or its
 *      post is not visible, no note did either. On a visible post a note never ends it: the post is withheld or decided.
 * The two times of case 1 are compared to the millisecond, and a post created in the same millisecond as the recorded
 * choice counts as created after it: the alert errs on the side of repeating.
 */
export function stillCalls(item: UrgentItemRow, reach: { served: number; newestServedAt: Date | null } | null): boolean {
  if (item.suspect) {
    if (reach === null) throw new Error("a suspect item is judged by what its case reaches");
    if (reach.served > 0) {
      if (!item.declinedAfter || item.newestDeclinedMs === null) return true;
      return reach.newestServedAt !== null && reach.newestServedAt.getTime() >= item.newestDeclinedMs;
    }
    return !(item.interimAfter || item.noteAfter || item.declinedAfter);
  }
  const noteCounts = item.targetType === "account" || item.postHidden;
  return !item.interimAfter && !(noteCounts && item.noteAfter);
}

/**
 * The open cases that hold an unanswered item of the urgent lane which is older than 15 minutes and still calls for
 * someone. What a case reaches is read once for a case, and only for a case that holds a suspect item, for at most
 * `limit` cases, the oldest first. An alert fails open: a case whose reach cannot be read counts as calling, and the
 * failure is logged with the case's id, so one case that keeps failing never silences the lane; so does a suspect case
 * beyond the limit, unread.
 */
export async function casesCalling(deps: Pick<ModerationDeps, "apiDb" | "media" | "log">, now: Date, limit = URGENT_REACH_PER_ROUND): Promise<string[]> {
  const items = await urgentItems(deps.apiDb, new Date(now.getTime() - DUE_AFTER_MS));
  const reaches = new Map<string, { served: number; newestServedAt: Date | null }>();
  const calling = new Set<string>();
  // Every read counts toward the limit, one that fails too.
  let reads = 0;
  for (const item of items) {
    if (calling.has(item.caseId)) continue;
    let reach = reaches.get(item.caseId) ?? null;
    if (item.suspect && reach === null) {
      if (reads >= limit) {
        calling.add(item.caseId);
        continue;
      }
      reads++;
      try {
        reach = await deps.media.reach({ type: item.targetType, id: item.targetId });
      } catch (err) {
        deps.log.error({ err, job: DISPATCH_JOB, step: "urgent", caseId: item.caseId }, "moderation-dispatch: what a case reaches could not be read; the case counts as calling");
        calling.add(item.caseId);
        continue;
      }
      reaches.set(item.caseId, reach);
    }
    if (stillCalls(item, reach)) calling.add(item.caseId);
  }
  return [...calling];
}

/** The urgent lane's repeat: while a case still calls, the alert is sent again under the key and window of the first one. */
async function repeatUrgent(deps: ModerationDeps, now: Date): Promise<DispatchReport["urgent"]> {
  if ((await casesCalling(deps, now)).length === 0) return "none";
  return alertUrgentLane(deps);
}

/**
 * The queue-age alert, at most once a day: per lane the cases past its response time with the oldest one's time, the
 * open cases that have held a measure taken while deciding for more than a day, whose author cannot appeal it, and (3e,
 * section 7.14) the replies to a suspension or a termination unanswered for longer than REPLY_AIM_HOURS, under the same
 * key and window: a reply before the start holds the suspension until someone answers it.
 */
async function alertWaiting(deps: ModerationDeps, now: Date): Promise<DispatchReport["waiting"]> {
  const waiting = await waitingCases(deps.apiDb, now);
  if (waiting.lanes.length === 0 && waiting.interim === 0 && waiting.replies === null) return "none";
  // 3f's review (people4): the mail says whether the staff phones got the push, or that it is the only reminder.
  return staffAlert(deps, WAITING_ALERT_KEY, WAITING_ALERT_WINDOW_MS, { template: "moderation_waiting", lanes: waiting.lanes, interim: waiting.interim, replies: waiting.replies, phones: deps.config.NOTIFY !== "off" });
}

/**
 * 3e (design, sections 5 and 7.14 item 3): gives up the statement mails of decisions that hold an announced suspension
 * or termination, each alone, in a transaction that takes the decision's row while its mail is owed, then the subject's
 * profile FOR NO KEY UPDATE, then records the give-up: the mail's outcome fixes the measure's start, which the database
 * derives into the profile's columns, so the profile is held when it is recorded, and an on-time reply that holds the
 * profile is read before the start is derived. The order is sendStatement's (3e's review, database3), so the two never
 * take the same rows in opposite orders. Answers the ids given up; a failure for one is logged with the decision's id and
 * leaves it for the next round.
 */
export async function giveUpAnnounced(deps: Pick<ModerationDeps, "apiDb" | "social" | "log">, now: Date): Promise<string[]> {
  const gone: string[] = [];
  for (const due of await announcedMailsDue(deps.apiDb, now, RETENTION.mailGiveUpDays)) {
    try {
      const given = await deps.apiDb.transaction(async (tx) => {
        await beginMailRecord(tx);
        if (!(await lockPendingAuthorMail(tx, due.decisionId))) return false;
        await deps.social.lockAccounts(tx, [due.subjectId], "no key update");
        return giveUpAnnouncedMail(tx, due.decisionId);
      });
      if (given) gone.push(due.decisionId);
    } catch (err) {
      deps.log.error({ err, job: DISPATCH_JOB, step: "give-up", decisionId: due.decisionId }, "moderation-dispatch: an announced measure's mail could not be given up; it is tried again next round");
    }
  }
  return gone;
}

// ---------------------------------------------------------------- step 3: the daily release

/**
 * Whether the marker is set. The lock a job runs under is also the store of its markers, and it can only take a key or
 * let it go: the question takes the key for a moment, which fails when the marker is there, and lets it go again. A
 * process that dies in between leaves the key for half a minute, not for the marker's two days.
 */
async function markerSet(lock: JobLock, key: string): Promise<boolean> {
  const probe = randomBytes(16).toString("hex");
  if (!(await lock.acquire(key, probe, MARKER_PROBE_MS))) return true;
  await lock.release(key, probe);
  return false;
}

/**
 * The daily release, until the cut-off's marker is set. (a) The database releases every item answered before the cut-off
 * and every changed outcome. (b) Every contact whose notice is still owed something is kept for another six months. The
 * marker is set once both have finished, so a round that fails in between runs the step again: the release then releases
 * nothing new, and no outcome mail goes before (b) has moved each contact's day.
 *
 * When the marker cannot be asked for, the step runs: it only repeats what a finished release leaves as it is. The round
 * is the daily one only when its own write of the marker was accepted. A marker that could not be written is logged, and
 * the next round that can write it is the daily one: a receipt that rides alone goes out once a day, never once a round.
 */
async function dailyRelease(deps: ModerationDeps, lock: JobLock, now: Date, report: DispatchReport): Promise<void> {
  const cutoff = cutoffOf(now, deps.config.MODERATION_DISPATCH_HOUR);
  const key = dispatchMarkerKey(cutoff);
  try {
    if (await markerSet(lock, key)) {
      report.marked = true;
      return;
    }
  } catch (err) {
    deps.log.warn({ err, job: DISPATCH_JOB, step: "release" }, "moderation-dispatch: the release's marker could not be read; the release runs again");
  }
  report.released = await releaseOutcomes(deps.apiDb, cutoff);
  const owed = await contactsOwed(deps.apiDb);
  if (owed.length > 0) await deps.auth.forgetNotifierAfter(owed, appealDeadline(now));
  report.marked = true;
  try {
    report.daily = await lock.acquire(key, "done", MARKER_TTL_MS);
    if (!report.daily) deps.log.warn({ job: DISPATCH_JOB, step: "release" }, "moderation-dispatch: the release's marker was not taken; the next round runs the release again");
  } catch (err) {
    deps.log.warn({ err, job: DISPATCH_JOB, step: "release" }, "moderation-dispatch: the release's marker could not be set; the next round runs the release again");
  }
}

// ---------------------------------------------------------------- step 4: the outcome mails

/**
 * One line of the daily update, from a released item (3c design, section 7.8, step 4, and section 5). The outcome's words
 * are the contracts' one composition, with the scope the status page gives the same item; the other fields say which of
 * the mail's sentences go with the line.
 */
export function updateLine(deps: Pick<ModerationDeps, "config">, row: OutcomeLineRow): NoticeUpdateLine {
  const outcome = row.shownOutcome as ItemOutcome;
  const noAction = outcome === "no_violation" || outcome === "not_evident";
  let scope: OutcomeWordsInput["scope"] = null;
  // 3e (7.11 item 7): an item whose decision retired the handle reads that in place of the display name and bio, and one
  // whose decision suspended or terminated the account at once reads ACCOUNT_MEASURE_SCOPE.measure, which names nothing
  // of what the measure is or how long it lasts.
  if (row.targetType === "account") scope = row.suspect || row.sealed ? "account_suspect" : row.retired ? "account_retired" : row.measure ? "account_measure" : "account";
  else if (row.hasCase && !row.suspect && row.quotes) scope = "quote";
  // "No action for now": decided while nobody could open the post's images, on an item about a post that is not itself suspect.
  const unseen = noAction && row.decisionUnseen && row.targetType === "post" && !row.suspect;
  let rule: OutcomeWordsInput["rule"] = null;
  if (outcome === "restricted_rule") {
    // The rule in the wording of the rulebook the decision was made under.
    const found = row.ruleId === null || row.rulesVersion === null ? undefined : getRule(row.ruleId, row.rulesVersion);
    if (!found) throw new Error("the item's restriction names no rule of a rulebook korbat holds");
    rule = { id: found.id, title: found.title };
  }
  return {
    ref: row.ref,
    item: row.position,
    link: itemLink(deps, row),
    outcome: outcomeWords({ outcome, rule, suspect: row.suspect, sealed: row.sealed, unseen, noEffect: row.noEffect, scope }),
    reexamination: row.reexamines,
    changed: row.changed,
    // Only a moderator's decision to take no action can be examined again, once; an answer given with the images out of
    // sight does not spend that, also when it answered a re-examination.
    reexaminable: row.byDecision && noAction && !row.reexamined && (!row.reexamines || unseen),
    unseen,
    automatic: !row.hasCase,
  };
}

/** The log line of a mail that did not go: a relay that could not take it is expected and tried again; anything else is a fault to read. */
function logUnsent(deps: Pick<ModerationDeps, "log">, err: unknown, step: string, row: Record<string, string | string[]>): void {
  if (err instanceof MailUnavailable) deps.log.warn({ err, job: DISPATCH_JOB, step, ...row }, "moderation-dispatch: a mail was not sent; it stays pending for the next round");
  else deps.log.error({ err, job: DISPATCH_JOB, step, ...row }, "moderation-dispatch: a row failed and was left as it was; the round goes on");
}

/**
 * The outcome mails: every released item whose mail is pending, whichever round released it.
 *   - Signed out, the lines go by contact to the auth module, which alone knows which contacts share an address and sends
 *     each address one update. A receipt the 24-hour cap folded rides with its contact's lines; in the daily round a
 *     contact with a folded receipt and nothing else is passed too, so its address gets an update of receipts alone. In
 *     later rounds a folded receipt goes only with its own contact's retried lines, so an address gets one update a day.
 *   - Signed in, they go as one update per account. An item whose reporter was forgotten has nobody to mail.
 * Each line and each carried receipt records its result only while it is still pending. Where the relay could not take a
 * mail nothing is recorded, and the next round sends it again. The rows a mail's result is recorded on are taken before
 * it is sent, in the transaction that records it (beginMailRecord): a database that cannot write refuses that, and
 * nothing is sent, so a line is never mailed round after round for want of a record. The signed-out updates are one call
 * to the auth module, which groups the contacts by address, so their rows are taken and recorded in one transaction,
 * each part's record in a savepoint of its own; each account's update has a transaction of its own.
 */
async function outcomeMails(deps: ModerationDeps, report: DispatchReport): Promise<void> {
  const q = deps.apiDb;
  const rows = await pendingOutcomeLines(q);
  const folded = new Map<string, NoticeRow>((await foldedReceipts(q)).map((notice) => [notice.contactId!, notice]));

  // One part for each contact, which is one notice; one list for each account.
  const byContact = new Map<string, { ref: string; items: string[]; lines: NoticeUpdateLine[] }>();
  const byAccount = new Map<string, { items: string[]; lines: NoticeUpdateLine[] }>();
  const nobody: string[] = [];
  for (const row of rows) {
    let line: NoticeUpdateLine;
    try {
      line = updateLine(deps, row);
    } catch (err) {
      logUnsent(deps, err, "outcomes", { itemId: row.id });
      continue;
    }
    if (row.contactId !== null) {
      const part = byContact.get(row.contactId) ?? { ref: row.ref, items: [], lines: [] };
      part.items.push(row.id);
      part.lines.push(line);
      byContact.set(row.contactId, part);
    } else if (row.reporterId !== null) {
      const update = byAccount.get(row.reporterId) ?? { items: [], lines: [] };
      update.items.push(row.id);
      update.lines.push(line);
      byAccount.set(row.reporterId, update);
    } else {
      nobody.push(row.id);
    }
  }

  // Signed out. The parts keep the order of their notices, so an address's update lists them as they were sent.
  const parts: NotifierUpdatePart[] = [];
  const carried = new Map<string, NoticeRow>();
  const withReceipt = async (contactId: string, part: { ref: string; lines: NoticeUpdateLine[] }): Promise<void> => {
    const notice = folded.get(contactId);
    if (!notice) {
      parts.push({ contactId, ref: part.ref, lines: part.lines });
      return;
    }
    try {
      const receipt = await receiptMessage(deps, notice);
      carried.set(contactId, notice);
      parts.push({ contactId, ref: part.ref, lines: part.lines, receipt: { ref: receipt.ref, receivedAt: receipt.receivedAt, items: receipt.items } });
    } catch (err) {
      // The receipt could not be built: the lines go without it, and it waits for the next daily round.
      logUnsent(deps, err, "outcomes", { intakeId: notice.id });
      if (part.lines.length > 0) parts.push({ contactId, ref: part.ref, lines: part.lines });
    }
  };
  for (const [contactId, part] of byContact) await withReceipt(contactId, part);
  if (report.daily) {
    for (const [contactId, notice] of folded) if (!byContact.has(contactId)) await withReceipt(contactId, { ref: notice.ref, lines: [] });
  }
  if (parts.length > 0) {
    // A transaction that fails before its mail (its rows could not be taken) has sent nothing; the round goes on.
    await q.transaction(async (tx) => {
      await beginMailRecord(tx);
      // Every line's row and every carried receipt's notice, before anything is sent; what another sender recorded
      // meanwhile is left out of the mail.
      const locked = await lockPendingOutcomeLines(tx, [...byContact.values()].flatMap((part) => part.items));
      const sending: NotifierUpdatePart[] = [];
      for (const part of parts) {
        const notice = carried.get(part.contactId);
        if (notice && !(await lockPendingReceipt(tx, notice.id, true))) carried.delete(part.contactId);
        const items = byContact.get(part.contactId)?.items ?? [];
        const lines = part.lines.filter((_, index) => locked.has(items[index]!));
        const receipt = carried.has(part.contactId) ? part.receipt : undefined;
        if (lines.length > 0 || receipt) sending.push({ contactId: part.contactId, ref: part.ref, lines, ...(receipt ? { receipt } : {}) });
      }
      if (sending.length === 0) return;
      let results = new Map<string, NotifierUpdateResult>();
      try {
        results = await deps.auth.mailNotifierUpdates(sending);
      } catch (err) {
        logUnsent(deps, err, "outcomes", { contacts: String(sending.length) });
      }
      for (const part of sending) {
        const state = RECORDED[results.get(part.contactId) ?? "unavailable"];
        if (state === null) continue;
        try {
          await tx.transaction(async (sp) => {
            await recordOutcomeMails(sp, (byContact.get(part.contactId)?.items ?? []).filter((id) => locked.has(id)), state);
            const notice = carried.get(part.contactId);
            if (notice) await recordCarriedReceipt(sp, notice.id, state);
          });
          if (state === "sent") report.outcomeMails++;
        } catch (err) {
          logUnsent(deps, err, "outcomes", { contactId: part.contactId });
        }
      }
    }).catch((err: unknown) => logUnsent(deps, err, "outcomes", { contacts: String(parts.length) }));
  }

  // Signed in: one update per account, through the account's own address, each in a transaction of its own.
  for (const [accountId, update] of byAccount) {
    try {
      await q.transaction(async (tx) => {
        await beginMailRecord(tx);
        const locked = await lockPendingOutcomeLines(tx, update.items);
        const lines = update.lines.filter((_, index) => locked.has(update.items[index]!));
        if (lines.length === 0) return;
        const state = RECORDED[await deps.auth.mailAccount(accountId, { template: "notice_update", lines })];
        if (state === null) return;
        await recordOutcomeMails(tx, update.items.filter((id) => locked.has(id)), state);
        if (state === "sent") report.outcomeMails++;
      });
    } catch (err) {
      // The rows are the items: the account is the reporter, whom no log line names.
      logUnsent(deps, err, "outcomes", { itemIds: update.items });
    }
  }

  // The reporter's link was forgotten with their account: there is nobody to mail.
  if (nobody.length > 0) await recordOutcomeMails(q, nobody, "no_address");
}

// ---------------------------------------------------------------- the round

/**
 * One round. `lock` is the store the job's own lock lives in, where the daily release keeps its markers.
 */
export async function dispatchRound(deps: ModerationDeps, lock: JobLock): Promise<DispatchReport> {
  const now = deps.now();
  const report: DispatchReport = {
    urgent: "none",
    waiting: "none",
    released: null,
    marked: false,
    daily: false,
    receipts: 0,
    statements: 0,
    outcomeMails: 0,
    givenUp: { receipts: 0, authorMails: 0, outcomes: 0 },
    noticesReleased: 0,
  };
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      deps.log.error({ err, job: DISPATCH_JOB, step: name }, "moderation-dispatch: a step failed; the round goes on");
    }
  };
  const due = new Date(now.getTime() - DUE_AFTER_MS);

  // 5. The alerts, each in a try of its own: a case whose reach cannot be read never holds the queue-age alert back.
  await step("urgent", async () => {
    report.urgent = await repeatUrgent(deps, now);
  });
  await step("waiting", async () => {
    report.waiting = await alertWaiting(deps, now);
  });

  // 3. The daily release.
  await step("release", () => dailyRelease(deps, lock, now, report));

  // 1. The receipts a relay failure left pending. sendReceipt records every result but a relay failure, which it logs
  // and leaves pending; any other fault it throws, and the row is logged here with the step and left as it was.
  await step("receipts", async () => {
    for (const intakeId of await pendingReceipts(deps.apiDb, due, RECEIPTS_PER_ROUND)) {
      try {
        const state = await sendReceipt(deps, intakeId);
        if (state !== "pending" && state !== "none") report.receipts++;
      } catch (err) {
        logUnsent(deps, err, "receipts", { intakeId });
      }
    }
  });

  // 3f (section 7.10): the release of held notices, before the statements, so that a notice told now is mailed in this
  // round. One transaction: the database's function, which tells what its hold no longer keeps and every decision held
  // with it, then, when it told anything, the audit row order_notices_released by the system, as its last statement.
  await step("order-notices", async () => {
    report.noticesReleased = await deps.apiDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      const count = await releaseHeldNotices(tx);
      if (count > 0) {
        await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "order_notices_released", targetType: null, targetId: null, requestId: null, metadata: { count } });
      }
      return count;
    });
  });

  // 2. The statements that were not mailed after their decision's commit, as they are mailed there.
  await step("statements", async () => {
    for (const decisionId of await pendingAuthorMails(deps.apiDb, due)) {
      try {
        if ((await sendStatement(deps, decisionId)) !== "none") report.statements++;
      } catch (err) {
        logUnsent(deps, err, "statements", { decisionId });
      }
    }
  });

  // 4. The outcome mails, only once the cut-off's release has finished, so each contact's day was moved before its lines go.
  let outcomesTried = false;
  if (report.marked) {
    await step("outcomes", async () => {
      await outcomeMails(deps, report);
      outcomesTried = true;
    });
  }

  // 6. What stayed unsent for five days is given up, without another attempt. Outcome lines only in a round that tried
  // them, after it, so each is tried at least once even when the daily release kept failing for longer than that.
  await step("give-up", async () => {
    const gone = await giveUpReceiptsAndAuthorMails(deps.apiDb, now, RETENTION.mailGiveUpDays);
    // 3e: the announced measures' statement mails, which the bulk statement leaves out, one by one under the profile's lock.
    const announced = await giveUpAnnounced(deps, now);
    report.givenUp.receipts = gone.receipts.length;
    report.givenUp.authorMails = gone.authorMails.length + announced.length;
    for (const id of gone.receipts) deps.log.warn({ job: DISPATCH_JOB, kind: "receipt", id }, "moderation: mail given up");
    for (const id of [...gone.authorMails, ...announced]) deps.log.warn({ job: DISPATCH_JOB, kind: "statement", id }, "moderation: mail given up");
    if (!outcomesTried) return;
    const lines = await giveUpOutcomeMails(deps.apiDb, now, RETENTION.mailGiveUpDays);
    report.givenUp.outcomes = lines.length;
    for (const id of lines) deps.log.warn({ job: DISPATCH_JOB, kind: "outcome", id }, "moderation: mail given up");
  });

  // One line for a round that did something, so the day's release and its mails can be found in the log: counts only.
  const gaveUp = report.givenUp.receipts + report.givenUp.authorMails + report.givenUp.outcomes;
  if (report.daily || report.receipts + report.statements + report.outcomeMails + gaveUp + report.noticesReleased > 0 || report.urgent === "sent" || report.waiting === "sent") {
    deps.log.info({ job: DISPATCH_JOB, ...report }, "moderation-dispatch: round");
  }
  return report;
}

/** The job: a round every ten minutes, counted from the end of the one before, on one API instance at a time. */
export function createDispatchJob(deps: ModerationDeps, lock: JobLock) {
  return createJob({ name: DISPATCH_JOB, intervalMs: DISPATCH_INTERVAL_MS, lockTtlMs: DISPATCH_INTERVAL_MS, lock, log: deps.log, run: () => dispatchRound(deps, lock) });
}
