/**
 * The only file outside `src/moderation/` may import. Everything else in the module is private and the architecture test
 * fails the build if another file reaches into it.
 *
 * The moderation module (3c design, section 5) runs on the API's role and owns the moderation tables: intakes and their
 * items, cases, decisions and their ledger of measures, evidence snapshots and staff texts. It inserts rows; the database
 * checks them, derives every restriction from them and refuses at commit what cannot stand. It reaches the other modules
 * only through the interfaces they export, never names an image row (the media module locks and holds a case's images for
 * it), and never sees the auth schema: a notifier's name and address, and every mail, are the auth module's.
 */
import type { AppealsPage, CaseView, FindingRequest, FindingResponse, MediaSize, PostModeration, QueuePage, StaffOverview, StaffSnapshotTaken, StaffTextSaveRequest, StaffTextSaved, StaffTextsResponse, StandingLists } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../auth";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForCases, StoredFile } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";
import { appealsList, review, reviewedCase } from "./appeals";
import { authorFacts } from "./author";
import { caseImage, openFinding, overview, queue, readCase, readDecidedCase, takeSnapshot } from "./cases";
import { createBackground, type ModerationDeps } from "./context";
import { decide, type DecideOutcome } from "./decide";
import { createDispatchJob } from "./dispatch";
import { exportFor, type ModerationExport } from "./export";
import { forgetReporter } from "./repo";
import { RETENTION_OFF_WARNING, createRetentionJob } from "./retention";
import { standingFor, standingLists, takeDownDue, type TakeDown } from "./standing";
import { reveal, type RevealOutcome } from "./reveal";
import { moderationRoutes, noSession } from "./routes";
import { ownTexts, saveText } from "./texts";

export { ACCESS_WORDS, accessDraftForAccount, accessDraftForContacts, uuidBefore } from "./access";
export type { AccountAccessDraft, ContactsAccessDraft } from "./access";
export { ModerationError } from "./context";
export type { ModerationDeps, ModerationErrorKind } from "./context";
export type { DecideOutcome } from "./decide";
export type { ModerationExport } from "./export";
export type { RevealOutcome } from "./reveal";

/** What the staff module needs from this one: the console's operations on cases, which its routes run behind the staff gate. */
export interface ModerationForStaff {
  /**
   * Records the decision a step-up confirmed, in one transaction with its audit row. "ended" when the confirming account
   * or key no longer opens anything, "late" when the challenge's time ran out; neither writes anything.
   */
  decide(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<DecideOutcome>;
  /** The case as the answer to a decision that has just committed on it: logged like every read, and never refused for the day's limit. */
  decidedCase(session: ActiveStaffSession, caseId: string): Promise<CaseView>;
  /**
   * Records the review a step-up confirmed: the answer to the one appeal of the decision the confirmation names, in one
   * transaction with its audit row. "ended" and "late" as for a decision.
   */
  review(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<DecideOutcome>;
  /** The case of a reviewed decision as the answer to a review that has just committed on it, read as decidedCase reads. */
  reviewedCase(session: ActiveStaffSession, decisionId: string): Promise<CaseView>;
  /** A page of the pending appeals, newest first, each marked whether this person may review it; never a statement. */
  appeals(session: ActiveStaffSession, cursor?: string): Promise<AppealsPage>;
  /** What every staff member's home screen shows: counts, times, staff handles and cases, and how many appeals this person may review. */
  overview(session: ActiveStaffSession): Promise<StaffOverview>;
  /** A page of the queue: open cases by lane and age, after the cursor when one is given; the first page leads with the replies no decision answered. */
  queue(cursor?: string): Promise<QueuePage>;
  /** 3e: the Standing screen's four lists (accounts at the ladder's strikes, reporting records, notices not sent, terminations waiting). */
  standing(): Promise<StandingLists>;
  /** The case as staff read it. The read is logged, and held to the day's limit on different cases; a recused person is refused. */
  caseView(session: ActiveStaffSession, caseId: string): Promise<CaseView>;
  /** An image of the case's own post, opened for staff and logged, or image_refused. The caller streams the file and closes it. */
  caseImage(session: ActiveStaffSession, caseId: string, mediaId: string, size: MediaSize): Promise<StoredFile>;
  /**
   * A fresh snapshot of the case's target when it differs from the newest; its id and digest, never content. Run again
   * when it gives way to a decision on the case, and refused as case_closed when it keeps having to.
   */
  takeSnapshot(session: ActiveStaffSession, caseId: string): Promise<StaffSnapshotTaken>;
  /** Opens a case, or joins the open one, on the moderator's own finding under a rule (its target resolved first), within the day's limit. */
  openFinding(session: ActiveStaffSession, request: FindingRequest): Promise<FindingResponse>;
  /** Saves a text on the case, as written or not at all. */
  saveText(session: ActiveStaffSession, caseId: string, request: StaffTextSaveRequest): Promise<StaffTextSaved>;
  /** The person's own drafts on the case, with their salts. */
  texts(session: ActiveStaffSession, caseId: string): Promise<StaffTextsResponse>;
  /**
   * Reveals who sent an item, once a step-up confirmed it: the access row and the audit row in one transaction, the
   * identity read only after the commit. "ended" and "late" as for a decision.
   */
  reveal(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<RevealOutcome>;
}

/**
 * What the social module needs from this one (3c design, section 5): the facts behind the chip on the author's own post.
 * For each of these posts that the viewer wrote and that is withheld or removed, the decision of the strongest post
 * measure in force, or the decision whose erasure removed it. Asked once a page, and only about the viewer's own posts.
 */
export interface ModerationForSocial {
  authorFacts(viewer: string, postIds: readonly string[]): Promise<Map<string, PostModeration>>;
}

/** What the account module needs from this one (3c design, sections 5, 7.10 and 7.11): the purge's forgetting, and the export's member; 3e adds the take-down of terminated accounts. */
export interface ModerationForAccount {
  /**
   * Forgets that a deleted account sent its reports: the account's id goes from its intakes and their items, which go on
   * being processed. The database acts only on an account whose auth row the take-down marked deleted, and changes
   * nothing when run again.
   */
  forgetAccount(userId: string): Promise<void>;
  /**
   * The moderation member of the account's data export: the decisions about the account that its Cases screen lists and
   * its own reports and notices while their records are kept, each as the account's own screens show it. Never another
   * person's report, a reporter, a notifier or a staff member.
   */
  exportFor(userId: string): Promise<ModerationExport>;
  /**
   * 3e (design, sections 5 and 7.8): takes down every account whose termination is final for its author. For each, in a
   * transaction of its own, the profile and then the terminating decision's case FOR UPDATE, terminations_due() again for
   * that account, and only then `takeDown` (the auth module's takeDownTerminated), awaited while the transaction is open.
   * Answers how many it took down and how many failed; one failure never stops the next account.
   */
  takeDownDue(takeDown: TakeDown): Promise<{ terminated: number; failed: number }>;
}

export interface CreateModerationOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's interface for moderation: auth.forModeration. */
  auth: AuthForModeration;
  /** The social module's interface for cases: socialForModeration(apiDb). */
  social: SocialForModeration;
  /** The media module's interface for cases: media.forCases. */
  media: MediaForCases;
  /**
   * The auth module's requireSession: an onboarded account with CSRF and Origin checked. The author's and the reporter's
   * routes stand behind it. Without it they refuse every request, so a module built for the staff side alone opens none.
   */
  requireSession?: MiddlewareHandler<AppEnv>;
  /** What one sender may send, and the throttles of the staff alerts, count in the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  config: Config;
  logger: Logger;
  now?: () => Date;
}

export function createModeration(options: CreateModerationOptions) {
  const deps: ModerationDeps = {
    apiDb: options.apiDb,
    auth: options.auth,
    social: options.social,
    media: options.media,
    limits: options.rateLimitStore,
    background: createBackground(options.logger),
    config: options.config,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forStaff: ModerationForStaff = {
    decide: (session, confirmed, ctx) => decide(deps, session, confirmed, ctx),
    decidedCase: (session, caseId) => readDecidedCase(deps, session, caseId),
    review: (session, confirmed, ctx) => review(deps, session, confirmed, ctx),
    reviewedCase: async (session, decisionId) => readDecidedCase(deps, session, await reviewedCase(deps, decisionId)),
    appeals: (session, cursor) => appealsList(deps, session, cursor),
    overview: (session) => overview(deps, session),
    queue: (cursor) => queue(deps, cursor),
    standing: () => standingLists(deps.apiDb),
    caseView: (session, caseId) => readCase(deps, session, caseId),
    caseImage: (session, caseId, mediaId, size) => caseImage(deps, session, caseId, mediaId, size),
    takeSnapshot: (session, caseId) => takeSnapshot(deps, session, caseId),
    openFinding: (session, request) => openFinding(deps, session, request),
    saveText: (session, caseId, request) => saveText(deps, session, caseId, request),
    texts: (session, caseId) => ownTexts(deps, session, caseId),
    reveal: (session, confirmed, ctx) => reveal(deps, session, confirmed, ctx),
  };
  const forSocial: ModerationForSocial = {
    authorFacts: (viewer, postIds) => authorFacts(deps, viewer, postIds),
  };
  const forAccount: ModerationForAccount = {
    forgetAccount: async (userId) => {
      await forgetReporter(deps.apiDb, userId);
    },
    exportFor: (userId) => exportFor(deps, userId),
    takeDownDue: (takeDown) => takeDownDue(deps, takeDown),
  };
  return {
    deps,
    /**
     * The app's routes, mounted at /api: reports and notices, their status page with its contact buttons and its
     * re-examinations, and behind the session guard the account's own decisions, appeals, reports and re-examinations.
     */
    routes: moderationRoutes(deps, options.requireSession ?? noSession),
    /** The interface the staff module uses. */
    forStaff,
    /** The interface the social module's views use. */
    forSocial,
    /** The interface the account module's purge and export use. */
    forAccount,
    /**
     * 3e (design, section 7.12): /api/me's standing, read fresh from the ledger: null for an account without a live
     * profile. The app composes the route from this and the auth module's meFor.
     */
    standingFor: (userId: string) => standingFor(deps.apiDb, userId),
    /**
     * Resolves once every task a request started and did not wait for has ended: the mails after a report, a notice, a
     * finding, a reveal or a refused case read. The tests await it; the server lets the tasks run.
     */
    settle: () => deps.background.settle(),
    /**
     * Starts the module's background work under the jobs' shared lock, on one API instance at a time: the dispatch job
     * always, and the retention job only while MODERATION_RETENTION is on. Each one's first round comes ten minutes after
     * the start. While the switch is off nothing is erased, released or deleted, and the warning is logged at every start,
     * so a switch left off after a restore is seen. Answers the function that stops both; a round in flight finishes.
     */
    startJobs: (lock: JobLock): (() => void) => {
      const stopDispatch = createDispatchJob(deps, lock).start();
      if (deps.config.MODERATION_RETENTION !== "on") {
        deps.log.warn(RETENTION_OFF_WARNING);
        return stopDispatch;
      }
      const stopRetention = createRetentionJob(deps, lock).start();
      return () => {
        stopDispatch();
        stopRetention();
      };
    },
  };
}

export type Moderation = ReturnType<typeof createModeration>;
