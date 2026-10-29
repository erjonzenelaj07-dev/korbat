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
import type {
  ActivityPlace,
  AppealsPage,
  CaseView,
  ContactCloseRequest,
  ContactPage,
  ContactQuery,
  FindingRequest,
  FindingResponse,
  HeldUpload,
  MediaSize,
  OrderCorrectFacts,
  OrderItemsRequest,
  OrderOpenRequest,
  OrderView,
  OrdersPage,
  PostModeration,
  QueuePage,
  RestoreView,
  StaffOverview,
  StaffSnapshotTaken,
  StaffTextSaveRequest,
  StaffTextSaved,
  StaffTextsResponse,
  StandingLists,
  UploadsPage,
} from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../auth";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import type { ImportsForModeration } from "../imports";
import type { JobLock } from "../lib/jobs";
import type { MediaForCases, StoredFile } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";
import { createAlertMailJob, createAlertTick, staffAlert } from "./alerts";
import { appealsList, review, reviewedCase } from "./appeals";
import { authorActivity, authorFacts, type ModerationActivityEntry } from "./author";
import { avatarSet, createAutomatedSweepJob, imagesPublished } from "./automated";
import { caseImage, openFinding, overview, queue, readCase, readDecidedCase, takeSnapshot } from "./cases";
import { createBackground, type ModerationDeps } from "./context";
import { decide, type DecideContext, type DecideOutcome } from "./decide";
import { closeGapNotNeeded, restoreView } from "./gaps";
import { createDispatchJob } from "./dispatch";
import { exportFor, type ModerationExport } from "./export";
import { addItems, closeContact, contactPage, correctOrderRecord, giveEffect, openOrder, orderView, ordersPage, recordEvent, type OrderOutcome } from "./orders";
import { releaseSeal, type ReleaseOutcome } from "./release";
import { endHold, heldUploads, matchedHandler, releaseUpload } from "./uploads";
import { forgetReporter, importEndBasis } from "./repo";
import { RETENTION_OFF_WARNING, createRetentionJob } from "./retention";
import { standingFor, standingLists, takeDownDue, type TakeDown } from "./standing";
import { reveal, type RevealOutcome } from "./reveal";
import { moderationRoutes, noSession } from "./routes";
import { ownTexts, saveText } from "./texts";

export { ACCESS_WORDS, accessDraftForAccount, accessDraftForContacts, uuidBefore } from "./access";
export type { AccountAccessDraft, ContactsAccessDraft } from "./access";
export { ModerationError } from "./context";
export type { ModerationDeps, ModerationErrorKind } from "./context";
export type { DecideContext, DecideOutcome } from "./decide";
export type { ModerationExport } from "./export";
export type { ModerationActivityEntry } from "./author";
export type { RevealOutcome } from "./reveal";
export type { ReleaseOutcome } from "./release";
// 3f (design, sections 5 and 8.11): plain functions for the command line, each taking the caller's connection or
// transaction and no dependency of the module, since a command does not hold the API's whole configuration: how a link
// is read, the items an order's links resolve to, and the rows of opening an order, which the console's route, order-open
// and the import all write.
export { orderLinkTarget, parseLink, postLink } from "./links";
export type { OrderLinkTarget } from "./links";
export { orderItemsFor } from "./orders";
export type { OrderOutcome } from "./orders";
export { insertOrder } from "./orders-repo";
export type { InsertedOrder, NewOrder, NewOrderItem, WrittenItem } from "./orders-repo";

/** What the staff module needs from this one: the console's operations on cases, which its routes run behind the staff gate. */
export interface ModerationForStaff {
  /**
   * Records the decision a step-up confirmed, in one transaction with its audit row. "ended" when the confirming account
   * or key no longer opens anything, "late" when the challenge's time ran out; neither writes anything. 3f Task 6: with
   * `ctx.gap`, the decision takes a lost one again and closes that restore gap in its transaction (gap_mismatch otherwise).
   */
  decide(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: DecideContext): Promise<DecideOutcome>;
  /** The case as the answer to a decision that has just committed on it: logged like every read, and never refused for the day's limit. */
  decidedCase(session: ActiveStaffSession, caseId: string): Promise<CaseView>;
  /**
   * Records the review a step-up confirmed: the answer to the one appeal of the decision the confirmation names, in one
   * transaction with its audit row. "ended" and "late" as for a decision.
   */
  review(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: DecideContext): Promise<DecideOutcome>;
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
  /** 3f: a page of the messages at the authorities' contact point, newest first, with no sender and no subject. */
  contact(query: ContactQuery): Promise<ContactPage>;
  /**
   * 3f: closes a message as what it turned out to be, in one transaction with its audit row; message_handled when it
   * has a disposition already, not_found for an unknown id. No key: closing restricts nothing and tells nobody.
   */
  closeContact(session: ActiveStaffSession, messageId: string, request: ContactCloseRequest, ctx: { requestId: string }): Promise<void>;
  /** 3f: the orders that are not closed, the nearest deadline first, and those closed in the last 30 days. */
  orders(): Promise<OrdersPage>;
  /** 3f: one order with its clock, items, events, what the command line owes and the hold, as this person may act on it; null when unknown. */
  order(session: ActiveStaffSession, orderId: string): Promise<OrderView | null>;
  /** 3f: opens an order record, with or without a message, in one transaction with its audit row; every staff account is alerted. No key. */
  openOrder(session: ActiveStaffSession, request: OrderOpenRequest, ctx: { requestId: string }): Promise<OrderView>;
  /** 3f: adds links to an order that is not closed, with its audit row. No key. */
  addOrderItems(session: ActiveStaffSession, orderId: string, request: OrderItemsRequest, ctx: { requestId: string }): Promise<OrderView>;
  /** 3f: records a console event a step-up confirmed, through order_event_record, with its confirmed audit row. */
  recordOrderEvent(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<OrderOutcome>;
  /**
   * 3f: corrects what a person entered, through order_correct, with its audit row: a plain one under the rules entry and
   * caution, a confirmed one under admin, which "step_up_required" answers when no key confirmed it.
   */
  correctOrder(session: ActiveStaffSession, orderId: string, facts: OrderCorrectFacts, confirmed: StaffStepUpConfirmed | null, ctx: { requestId: string }): Promise<OrderOutcome | "step_up_required">;
  /** 3f Task 3: "Disable for an order" on the items a step-up confirmed, one decision a post, with the confirmed audit row order_effected. */
  giveOrderEffect(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<OrderOutcome>;
  /** 3f Task 6: what an import after a restore found lost, in the order to take it again, with the held notices (GET /api/staff/restore). */
  restore(): Promise<RestoreView>;
  /**
   * 3f Task 6: an admin's "Not needed" on a gap a step-up confirmed, through gap_close with no decision and the confirmed
   * audit row gap_closed, which restore_gaps_confirmed holds it to at commit. "ended" and "late" as for a decision.
   */
  closeGap(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<RestoreView | "ended" | "late">;
  /**
   * 3f Task 6 (7.16 step 3): after a download of the audit log's tail by an account that did not take the last copy,
   * every staff account is alerted, by push and mail, with the time and the number of rows. Never throws: an alert fails
   * open, and a failure is logged.
   */
  copyTaken(facts: { at: string; rows: number }): Promise<void>;
  /**
   * 3d Task 2 (sections 6.2 and 7.2): an admin's release of a seal for good a step-up confirmed, through seal_release and
   * the confirmed audit row seal_released, which releases_confirmed holds it to at commit; the seal's case and the
   * release's id once it committed. "ended" and "late" as for a decision. After the commit every staff account is
   * alerted and the author's notice goes out unless it was born held.
   */
  release(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<ReleaseOutcome>;
  /**
   * 3d Task 7 (sections 7.12 and 8.6): a page of Held uploads, never an image, a hash or a handle. 3d review M1: for a
   * session that is not an admin's, without the authority's reference and assessment, the leave and the uploader's count.
   */
  uploads(session: ActiveStaffSession, cursor?: string): Promise<UploadsPage>;
  /**
   * 3d Task 7: an admin's end of a held upload's hold a step-up confirmed, through upload_hold_end and the confirmed audit
   * row upload_hold_ended; the refusal as Held uploads now shows it. "ended" and "late" as for a decision. After an end as
   * no_report every staff account is alerted (hold_ended_unreported).
   */
  endHold(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<HeldUpload | "ended" | "late">;
  /** 3d Task 7: an admin's release of a held upload ended as report, as a seal's release; the refusal as it now shows. */
  releaseUpload(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<HeldUpload | "ended" | "late">;
  /**
   * 3b Task 6 (design, section 8.7; the orchestrator's ruling): what an admin's end of a whole import rests on: the case's
   * post, when the decision is one of the case's, final and restricting, under the rule the end names, and the case is
   * about a post; null otherwise. The staff module holds the post to the import in the end's transaction.
   */
  importEndBasis(caseId: string, decisionId: string, ruleId: string): Promise<{ postId: string } | null>;
}

/**
 * What the social module needs from this one (3c design, section 5): the facts behind the chip on the author's own post.
 * For each of these posts that the viewer wrote and that is withheld or removed, the decision of the strongest post
 * measure in force, or the decision whose erasure removed it. Asked once a page, and only about the viewer's own posts.
 */
export interface ModerationForSocial {
  authorFacts(viewer: string, postIds: readonly string[]): Promise<Map<string, PostModeration>>;
  /**
   * 3d Task 6 (design, sections 5 and 7.9): createPost calls this after its commit when the post has images. It starts the
   * automated step of each image whose score is at or over the threshold on the module's background and returns at once,
   * so a post never waits for a deciding transaction; with the scorer off it starts nothing.
   */
  imagesPublished(postId: string): void;
  /**
   * 2d Task 4 (design, section 7.6): setAvatar calls this after its commit with the account's new picture. It starts the
   * program's step of the picture's score or match record on the module's background and returns at once; the step opens
   * a finding on the account's case and never a measure, and while AUTOMATION_R1_ACTS is on puts an R1 score under review.
   */
  avatarSet(accountId: string, mediaId: string): void;
}

/**
 * What the imports module needs from this one (3b design, section 8.1; Task 5): the staff alert for imported images whose
 * match does not act, which an import leaves out and never publishes; and (Task 6, 4.5 step 3) the automated step of a
 * published imported post's images, as for a native post.
 */
export interface ModerationForImports {
  /**
   * After the commit of a batch that wrote this post with images: the automated step of each image whose score is at or
   * over the threshold starts on the module's background, unwaited for, as createPost's does (ModerationForSocial).
   */
  imagesPublished(postId: string): void;
  /**
   * After the commit that left `count` images of import `importId` out as flagged: the alert import_image_flagged to every
   * staff account, its facts the time and the count alone, at most once an hour an import (IMPORT_FLAGGED_WINDOW_MS); a
   * later occasion within the hour is throttled, as automation_capped's are. Never throws.
   */
  imagesFlagged(input: { importId: string; count: number; at: Date }): Promise<"sent" | "throttled" | "unsent">;
}

/**
 * What the activity module needs from this one (2d design, section 5.5.2): the moderation entries of an account's
 * Activity, read only from the author's own reads (the decisions its Cases screen lists, the releases and refused uploads
 * of its Notices, and the lost images 3d's dispatch told it of), newest first by (at, key), before the place given, at
 * most `limit`, none told more than ACTIVITY_KEEP_DAYS ago. The activity module never reads a moderation table itself.
 */
export interface ModerationForActivity {
  authorActivity(viewer: string, before: ActivityPlace | null, limit: number): Promise<ModerationActivityEntry[]>;
}

/** The throttle of import_image_flagged: one alert an hour an import. */
export const IMPORT_FLAGGED_WINDOW_MS = 60 * 60_000;

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
  /**
   * 3b Task 6: the imports module's interface for cases, importsForModeration(apiDb), through which a case reads an
   * import's size. Without it a case shows no import.
   */
  imports?: ImportsForModeration;
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
    imports: options.imports,
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
    contact: (query) => contactPage(deps, query),
    closeContact: (session, messageId, request, ctx) => closeContact(deps, session, messageId, request, ctx),
    orders: () => ordersPage(deps),
    order: (session, orderId) => orderView(deps, orderId, session),
    openOrder: (session, request, ctx) => openOrder(deps, session, request, ctx),
    addOrderItems: (session, orderId, request, ctx) => addItems(deps, session, orderId, request, ctx),
    recordOrderEvent: (session, confirmed, ctx) => recordEvent(deps, session, confirmed, ctx),
    correctOrder: (session, orderId, facts, confirmed, ctx) => correctOrderRecord(deps, session, orderId, facts, confirmed, ctx),
    giveOrderEffect: (session, confirmed, ctx) => giveEffect(deps, session, confirmed, ctx),
    restore: () => restoreView(deps),
    closeGap: (session, confirmed, ctx) => closeGapNotNeeded(deps, session, confirmed, ctx),
    release: (session, confirmed, ctx) => releaseSeal(deps, session, confirmed, ctx),
    uploads: (session, cursor) => heldUploads(deps, session, cursor),
    endHold: (session, confirmed, ctx) => endHold(deps, session, confirmed, ctx),
    releaseUpload: (session, confirmed, ctx) => releaseUpload(deps, session, confirmed, ctx),
    importEndBasis: (caseId, decisionId, ruleId) => importEndBasis(deps.apiDb, caseId, decisionId, ruleId),
    copyTaken: async (facts) => {
      // Started and not waited for, as what follows a decision is: the download's answer never waits for a mail relay.
      deps.background.start(async () => {
        try {
          await staffAlert(deps, null, 0, { template: "copy_taken", facts });
        } catch (err) {
          deps.log.error({ err }, "moderation: the staff accounts were not alerted to a download of the audit log's tail");
        }
      });
    },
  };
  const forSocial: ModerationForSocial = {
    authorFacts: (viewer, postIds) => authorFacts(deps, viewer, postIds),
    imagesPublished: (postId) => imagesPublished(deps, postId),
    avatarSet: (accountId, mediaId) => avatarSet(deps, accountId, mediaId),
  };
  const forImports: ModerationForImports = {
    imagesPublished: (postId) => imagesPublished(deps, postId),
    async imagesFlagged({ importId, count, at }) {
      try {
        return await staffAlert(deps, `import-image-flagged:${importId}`, IMPORT_FLAGGED_WINDOW_MS, { template: "import_image_flagged", facts: { at: at.toISOString(), count } });
      } catch (err) {
        deps.log.error({ err, count }, "moderation: the staff accounts were not alerted to imported images left out as flagged");
        return "unsent";
      }
    },
  };
  const forActivity: ModerationForActivity = {
    authorActivity: (viewer, before, limit) => authorActivity(deps, viewer, before, limit),
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
    /** 3b Task 5: the interface the imports module uses. */
    forImports,
    /** 2d: the interface the activity module uses. */
    forActivity,
    /**
     * 3d Task 7 (design, section 5): the handler the wiring hands the media module (media.onMatch), which it calls after
     * the commit of a refusal, of a match on a posted image, and of an upload over the limit on refusals.
     */
    matched: matchedHandler(deps),
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
     * and 3f's alert tick and its mail leg (two jobs since 3f's review, so a slow relay never holds the tick) always, (3d
     * Task 6) the automated sweep always, whose reads of signals each run only while their tool is on, and the retention
     * job always. The dispatch and retention jobs' first rounds come ten minutes after the start, the tick's 30 seconds
     * after it. While MODERATION_RETENTION is off the retention job's rounds run one step alone (3d Task 8, design section
     * 7.14): tools_off, which forgets the hashes and the ratings of a tool that is off and is held by nothing but that
     * tool's setting; nothing else is erased, released or deleted, and the warning is logged at every start, so a switch
     * left off after a restore is seen. The tick runs all the same, since an alert is never about retention. Answers the
     * function that stops them all; a round in flight finishes.
     */
    startJobs: (lock: JobLock): (() => void) => {
      const stopDispatch = createDispatchJob(deps, lock).start();
      const stopTick = createAlertTick(deps, lock).start();
      const stopMail = createAlertMailJob(deps, lock).start();
      const stopSweep = createAutomatedSweepJob(deps, lock).start();
      if (deps.config.MODERATION_RETENTION !== "on") deps.log.warn(RETENTION_OFF_WARNING);
      const stopRetention = createRetentionJob(deps, lock).start();
      return () => {
        stopDispatch();
        stopTick();
        stopMail();
        stopSweep();
        stopRetention();
      };
    },
  };
}

export type Moderation = ReturnType<typeof createModeration>;
