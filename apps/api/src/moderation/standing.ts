import {
  OVERVIEW_LIST_MAX,
  STANDING_RULES,
  isRetiredPlaceholder,
  type AccountStanding,
  type AtOnceGround,
  type AuthorStanding,
  type CaseStanding,
  type DecisionStanding,
  type ReplyRequest,
  type ReportingStanding,
  type ReplyResponse,
  type StandingLists,
  type StrikeDue,
} from "@korbat/contracts";
import { isBoundReached, isDeadlock } from "../lib/lock-bounds";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { saltedStatement } from "./intake";
import {
  accountStandingRow,
  boundWaits,
  decisionStanding,
  imagesSealed,
  insertReply,
  finalSettled,
  lockTerminatingDecision,
  noticesUndelivered,
  openReportsIn,
  replyMeasureOf,
  reportingFacts,
  reportingRecords,
  reportingStanding,
  snapshotHandleRetired,
  standingFacts,
  strikeAccounts,
  strikeDueOf,
  terminationsDue,
  terminationsWaiting,
  type StandingFacts,
} from "./standing-repo";
import { raisedMessage, violatedUniqueConstraint, type Runner } from "./repo";

/**
 * Account sanctions as the console reads them on a case (3e design, sections 7.4 and 10.3): on a post case whether a
 * final restriction gives a strike and the author's standing in bands, on an account case the account's standing with
 * what the database would accept now. Every member is an aid that lets a control say why it is greyed before the key is
 * asked; the database decides at the commit.
 */

/**
 * strikeDue of a post case: the database's strike_due for a final restriction on a korbat rule other than R2 that rests
 * on no suspect item, and why it answers false: the post already carries a strike that stands, or it was made before its
 * author was told of their newest strike (strike_due's third and fourth rules).
 */
export async function strikeDue(q: Runner, caseId: string): Promise<StrikeDue> {
  const answer = await strikeDueOf(q, caseId);
  if (answer.due) return { due: true, why: "due" };
  return { due: false, why: answer.struck ? "already_struck" : "before_last_strike" };
}

/** A count as the bands of the author's standing print it. */
const strikesBand = (n: number): AuthorStanding["activeStrikes"] => (n <= 0 ? "0" : n === 1 ? "1" : n === 2 ? "2" : "3_or_more");
const suspensionsBand = (n: number): AuthorStanding["suspensionsInYear"] => (n <= 0 ? "0" : n === 1 ? "1" : "2_or_more");

/** What the live standing measure of an account is now, in the words of the bands. */
function nowOf(facts: StandingFacts): AuthorStanding["now"] {
  if (facts.live === null) return "none";
  if (!facts.live.running) return "announced";
  return facts.live.kind === "terminate" ? "terminated" : "suspended";
}

/** authorStanding of a post case: the author's standing in bands, so that the moderator knows what a strike here leads to. */
export async function authorStanding(q: Runner, authorId: string): Promise<AuthorStanding> {
  const facts = await standingFacts(q, authorId);
  return { activeStrikes: strikesBand(facts.strikes.length), suspensionsInYear: suspensionsBand(facts.suspensionsInYear), now: nowOf(facts) };
}

/**
 * standing of an account case, read as decision_actions_check reads it. The ladder holds with at least ladderStrikes
 * active strikes of which one is newer than the account's newest measure of the ladder that stands; an announced
 * suspension then takes the rung of the suspensions of the ladder decided in the year, and a termination can be announced
 * after as many of them as there are rungs. While a standing measure is live nothing more can be taken (standing_conflict).
 */
export async function caseStanding(q: Runner, caseId: string, accountId: string): Promise<CaseStanding> {
  const facts = await standingFacts(q, accountId);
  const live = facts.live !== null;
  const rungs = STANDING_RULES.ladderDays;
  const ladder = !live && facts.strikes.length >= STANDING_RULES.ladderStrikes && facts.newStrikeSinceLadder;
  const atOnce: AtOnceGround[] = [];
  if (!live) {
    if (facts.threat) atOnce.push("threat");
    if (facts.terrorist) atOnce.push("terrorist");
    if (facts.flood.posts >= STANDING_RULES.floodPosts) atOnce.push("flood");
    if (facts.sealOn !== null) atOnce.push("protective");
    if (facts.threatRepeat) atOnce.push("threat_repeat");
  }
  return {
    activeStrikes: facts.strikes.length,
    strikes: facts.strikes.map((strike) => ({ ...strike, ruleId: strike.ruleId as CaseStanding["strikes"][number]["ruleId"] })),
    ladderRule: facts.ladderRule as CaseStanding["ladderRule"],
    suspensionsInYear: facts.suspensionsInYear,
    lastSuspendedOn: facts.lastSuspendedOn,
    maxDays: ladder ? rungs[Math.min(facts.suspensionsInYear, rungs.length - 1)]! : null,
    mayTerminate: ladder && facts.suspensionsInYear >= rungs.length,
    live,
    openReports: await openReportsIn(q, caseId),
    atOnce,
    flood: facts.flood,
    seal: facts.sealOn === null ? null : { decidedOn: facts.sealOn },
    // Task 2: whether a retirement now would change nothing, the newest snapshot's handle being retired already.
    snapshotHandleRetired: await snapshotHandleRetired(q, caseId),
    // Task 3: the decisions a suspension at once would rest on now, by their times, for the preview's basis sentence.
    basisDecidedAt: facts.basisDecidedAt,
    // Task 5: the account's record of reporting, read as decision_actions_check reads it.
    reporting: await caseReporting(q, accountId),
  };
}

/**
 * standing.reporting of an account case (3e design, sections 7.9, 8.1 and 10.3): the account's counts in reports, its
 * warning that still counts with the marked reports sent since, whether the database would accept a warning or a
 * restriction now, the restriction that runs, and the marks that count for the drafts of W.5. A warning needs at least
 * reportWarnMarks marked reports that are at least reportWarnShare of the reports, and no warning that still counts; a
 * restriction needs that warning, at least reportRestrictMarks marked reports sent since korbat told the account of it,
 * and no restriction running. The case's own open reports, which refuse both (open_reports), are `openReports`.
 */
async function caseReporting(q: Runner, accountId: string): Promise<CaseStanding["reporting"]> {
  const facts = await reportingFacts(q, accountId, { marked: true });
  const atThreshold = facts.unfounded >= STANDING_RULES.reportWarnMarks && facts.unfounded >= STANDING_RULES.reportWarnShare * facts.reports;
  return {
    reports: facts.reports,
    unfounded: facts.unfounded,
    warnedOn: facts.warning === null ? null : facts.warning.decidedAt.slice(0, 10),
    warnedAt: facts.warning?.decidedAt ?? null,
    marksSince: facts.marksSince,
    mayWarn: atThreshold && facts.warning === null,
    mayRestrict: facts.warning !== null && (facts.marksSince ?? 0) >= STANDING_RULES.reportRestrictMarks && facts.restriction === null,
    restrictedUntil: facts.restriction?.until ?? null,
    marked: facts.marked,
  };
}

/**
 * /api/me's standing (3e design, sections 7.12 and 10.2), read fresh at the request and never kept in a session or a
 * cache, so the banner and a refusal's sentence are true of the row: the active strikes; the account's one standing
 * measure with its state now (running from its start; announced once a start is fixed and ahead; held while a reply sent
 * in time waits for its answer; unfixed while the notice mail's outcome is unknown), its times, its reply and its appeal;
 * the reporting measures (Task 5: the warning that still counts and the restriction that runs, null when neither
 * stands); whether the profile holds a retired handle's placeholder. Null for an account without a live profile. Not
 * auth.account_standing, the boolean grant-role asks.
 */
export async function standingFor(q: Runner, accountId: string): Promise<AccountStanding | null> {
  const row = await accountStandingRow(q, accountId);
  if (row === null) return null;
  const m = row.measure;
  return {
    activeStrikes: row.activeStrikes,
    measure:
      m === null
        ? null
        : {
            decisionId: m.decisionId,
            kind: m.kind,
            days: m.kind === "terminate" ? null : m.days,
            state: m.running ? "running" : m.startsAt !== null ? "announced" : m.reply?.onTime && !m.replyAnswered ? "held" : "unfixed",
            earliestStart: m.earliestStart,
            startsAt: m.startsAt,
            endsAt: m.kind === "terminate" ? null : m.endsAt,
            reply: m.reply,
            // One reply a measure (POST /api/moderation/decisions/:id/reply); a measure in standing_live takes one.
            replyOpen: m.reply === null,
            // Open while no appeal was filed and its six months run; one filed (pending or answered) closes it.
            appealUntil: !m.appealed && m.appealOpen ? m.appealDeadline : null,
            appealPending: m.appealPending,
          },
    reporting: await accountReporting(q, accountId),
    handleRetired: isRetiredPlaceholder(row.handle.toLowerCase()),
  };
}

/** /api/me's reporting member: the warning that still counts and the restriction that runs, or null when neither stands. */
async function accountReporting(q: Runner, accountId: string): Promise<AccountStanding["reporting"]> {
  const facts = await reportingFacts(q, accountId, { marked: false });
  if (facts.warning === null && facts.restriction === null) return null;
  return {
    warning: facts.warning === null ? null : { decisionId: facts.warning.decisionId, countsUntil: facts.warning.countsUntil },
    restriction: facts.restriction,
  };
}

// ---------------------------------------------------------------- 3e Task 4: the reply, the lists and the take-down

/** The longest the reply's transaction waits for a lock: its own profile row, which a decision about the account may hold. */
const REPLY_LOCK_TIMEOUT_MS = 10_000;
/** How often the reply's transaction is run again after a deadlock or a lock timeout: in each nothing was written. */
const REPLY_RETRIES = 2;

/**
 * POST /api/moderation/decisions/:id/reply (3e design, section 7.6 step 9): the person's one reply to the suspension or
 * termination the decision holds, announced or taken at once. Not found unless the viewer is the measure's subject and
 * was told of the decision, as for the decision's read. One transaction: the account's own profile row FOR UPDATE, its
 * first lock (every writer of a start holds that row, so from there only the clock can bring the start), then the reply's
 * row, whose trigger refuses a reply that is not open and forces the time of filing by the clock, read last, and whether
 * it came before the start, which it then holds until a decision answers it. A second reply is reply_not_open, whether
 * the trigger or the primary key finds it. A deadlock or a lock timeout runs the transaction again; when the last run
 * fails the same way the answer is service_unavailable. No mail goes for the reply itself.
 */
export async function fileReply(deps: Pick<ModerationDeps, "apiDb" | "social">, viewer: string, decisionId: string, request: ReplyRequest): Promise<ReplyResponse> {
  const actionId = await replyMeasureOf(deps.apiDb, viewer, decisionId);
  if (actionId === null) throw new ModerationError("not_found");
  const statement = await saltedStatement(request.statement);
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.apiDb.transaction(async (tx) => {
        await boundWaits(tx, REPLY_LOCK_TIMEOUT_MS);
        await deps.social.lockAccounts(tx, [viewer], "update");
        return insertReply(tx, { actionId, accountId: viewer, statement });
      });
    } catch (err) {
      const refusal = raisedMessage(err);
      if (refusal !== null && isModerationErrorCode(refusal)) throw new ModerationError(refusal);
      if (violatedUniqueConstraint(err) !== null) throw new ModerationError("reply_not_open");
      // A bound reached on either limit (lock_timeout, or the statement_timeout beside it) changed nothing either.
      if (!isDeadlock(err) && !isBoundReached(err)) throw err;
      if (attempt >= REPLY_RETRIES) throw new ModerationError("service_unavailable", 503, undefined, 30);
    }
  }
}

/** The states in which a standing measure takes a reply: it stands, its basis holds, and it has not ended. */
const OPEN_STATES: ReadonlySet<string> = new Set(["unfixed", "announced", "held", "running"]);

/**
 * DecisionView.standing (3e design, sections 9.2 and 10.2): where the decision's suspension or termination stands now,
 * read fresh; null for a decision without one. A reply can still be sent while none was and the measure takes one.
 */
export async function decisionStandingView(q: Runner, decisionId: string): Promise<DecisionStanding | null> {
  const row = await decisionStanding(q, decisionId);
  if (row === null) return null;
  return {
    state: row.state as DecisionStanding["state"],
    earliestStart: row.earliestStart,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    endedAt: row.endedAt,
    endedBy: row.endedBy,
    replaced: row.replaced,
    restsOn: row.restsOn.map((entry) => ({ ...entry, ruleId: entry.ruleId as DecisionStanding["restsOn"][number]["ruleId"] })),
    reply: row.reply,
    replyOpen: row.reply === null && OPEN_STATES.has(row.state),
  };
}

/**
 * GET /api/staff/standing (3e design, sections 7.5, 7.12 and 8.6): the Standing screen's four lists. The accounts at the
 * ladder's number of strikes, each with the rung an announced suspension would take now (the ladder's suspensions of the
 * year, read as decision_actions_check reads them) and whether a termination could be announced; the reporting records
 * (Task 5: the accounts at the warning's threshold and the warned ones, in reports); the notices korbat could not send;
 * and the terminations that wait. People are handles; no row names a reporter.
 */
export async function standingLists(q: Runner): Promise<StandingLists> {
  const rungs = STANDING_RULES.ladderDays;
  const atThree = await strikeAccounts(q, OVERVIEW_LIST_MAX);
  return {
    atThreeStrikes: {
      total: atThree.total,
      items: atThree.items.map((row) => ({
        handle: row.handle,
        caseId: row.caseId,
        activeStrikes: row.activeStrikes,
        ruleId: row.ruleId as StandingLists["atThreeStrikes"]["items"][number]["ruleId"],
        newestOn: row.newestOn,
        maxDays: rungs[Math.min(row.inYear, rungs.length - 1)]!,
        mayTerminate: row.inYear >= rungs.length,
      })),
    },
    reportingRecords: await reportingRecords(q, OVERVIEW_LIST_MAX),
    noticesUndelivered: await noticesUndelivered(q, OVERVIEW_LIST_MAX),
    terminationsWaiting: await terminationsWaiting(q, OVERVIEW_LIST_MAX),
  };
}

/**
 * DecisionView.reportingStanding (3e design, sections 9.2 and 10.2): where the decision's restriction of reporting stands
 * now, read fresh; null for a decision without one.
 */
export async function reportingStandingView(q: Runner, decisionId: string): Promise<ReportingStanding | null> {
  return reportingStanding(q, decisionId);
}

/** The longest the take-down's transaction waits for a lock: the account's profile, then its terminating decision. */
const TAKE_DOWN_LOCK_TIMEOUT_MS = 10_000;

/** How long a decision must have been final before its account is taken down: an appeal in flight at the deadline has settled by then. */
export const TAKE_DOWN_SETTLE_MS = 60_000;

/** The take-down the account module hands over: the auth module's system take-down, true only for one it made. */
export type TakeDown = (account: string, facts: { decidedAt: Date; imagesSealed: boolean }) => Promise<boolean>;

/**
 * ModerationForAccount.takeDownDue (3e design, section 5, the lock order, item 5, and section 7.8 step 3): the take-down of
 * every account whose termination is final for its author. It reads terminations_due() once, unlocked, for the candidates.
 * Then for each, in a transaction of its own on the API's pool and in a try of its own: the account's profile FOR UPDATE
 * (lockAccounts); then the terminating decision's row FOR UPDATE (lockTerminatingDecision says why the decision's row and
 * not its case: an appeal being filed takes no profile, and meets this lock through its foreign key, so it commits first
 * and is read below, or waits until the take-down has committed); terminations_due() again for that account, in a
 * statement of its own, and that its decision became final at least TAKE_DOWN_SETTLE_MS ago, so that an appeal whose
 * deadline check passed an instant before the deadline has settled; and only when it is still due, whether a seal of its
 * images is in force, and then the callback, awaited while the transaction is open, so the profile is held until the
 * take-down has committed on the auth pool. A lift, a reply or a kept answer waits at the profile, or committed first and
 * took the account out of the list.
 *
 * A failure for one account (a lock wait past its bound, the auth pool down) is caught, logged with the terminating
 * decision's case and never the account, and counted in `failed`; it never stops the next account. `terminated` counts
 * the take-downs the callback made: one already made (a round whose purge failed after it) answers false.
 */
export async function takeDownDue(deps: Pick<ModerationDeps, "apiDb" | "social" | "log">, takeDown: TakeDown): Promise<{ terminated: number; failed: number }> {
  const report = { terminated: 0, failed: 0 };
  for (const candidate of await terminationsDue(deps.apiDb)) {
    try {
      const made = await deps.apiDb.transaction(async (tx) => {
        await boundWaits(tx, TAKE_DOWN_LOCK_TIMEOUT_MS);
        await deps.social.lockAccounts(tx, [candidate.accountId], "update");
        const decisionId = await lockTerminatingDecision(tx, candidate.accountId, candidate.caseId);
        if (decisionId === null) return false;
        const [still] = await terminationsDue(tx, candidate.accountId);
        if (!still || !(await finalSettled(tx, decisionId, TAKE_DOWN_SETTLE_MS))) return false;
        const sealed = await imagesSealed(tx, candidate.accountId);
        return takeDown(candidate.accountId, { decidedAt: new Date(still.decidedAt), imagesSealed: sealed });
      });
      if (made) report.terminated++;
    } catch (err) {
      report.failed++;
      deps.log.error({ err, caseId: candidate.caseId }, "moderation: a terminated account could not be taken down; it is tried again next round");
    }
  }
  return report;
}
