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
import type { CaseView, FindingRequest, FindingResponse, MediaSize, QueuePage, StaffOverview, StaffSnapshotTaken, StaffTextSaveRequest, StaffTextSaved, StaffTextsResponse } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../auth";
import type { Config } from "../config";
import type { JobLock } from "../lib/jobs";
import type { MediaForCases, StoredFile } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";
import { caseImage, openFinding, overview, queue, readCase, readDecidedCase, takeSnapshot } from "./cases";
import { createBackground, type ModerationDeps } from "./context";
import { decide, type DecideOutcome } from "./decide";
import { createDispatchJob } from "./dispatch";
import { reveal, type RevealOutcome } from "./reveal";
import { moderationRoutes } from "./routes";
import { ownTexts, saveText } from "./texts";

export { ModerationError } from "./context";
export type { ModerationDeps, ModerationErrorKind } from "./context";
export type { DecideOutcome } from "./decide";
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
  /** What every staff member's home screen shows: counts, times, staff handles and cases. */
  overview(): Promise<StaffOverview>;
  /** A page of the queue: open cases by lane and age, after the cursor when one is given. */
  queue(cursor?: string): Promise<QueuePage>;
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

export interface CreateModerationOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's interface for moderation: auth.forModeration. */
  auth: AuthForModeration;
  /** The social module's interface for cases: socialForModeration(apiDb). */
  social: SocialForModeration;
  /** The media module's interface for cases: media.forCases. */
  media: MediaForCases;
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
    overview: () => overview(deps),
    queue: (cursor) => queue(deps, cursor),
    caseView: (session, caseId) => readCase(deps, session, caseId),
    caseImage: (session, caseId, mediaId, size) => caseImage(deps, session, caseId, mediaId, size),
    takeSnapshot: (session, caseId) => takeSnapshot(deps, session, caseId),
    openFinding: (session, request) => openFinding(deps, session, request),
    saveText: (session, caseId, request) => saveText(deps, session, caseId, request),
    texts: (session, caseId) => ownTexts(deps, session, caseId),
    reveal: (session, confirmed, ctx) => reveal(deps, session, confirmed, ctx),
  };
  return {
    deps,
    /** The app's routes, mounted at /api: reports and notices, their status page and its contact buttons. */
    routes: moderationRoutes(deps),
    /** The interface the staff module uses. */
    forStaff,
    /**
     * Resolves once every task a request started and did not wait for has ended: the mails after a report, a notice, a
     * finding, a reveal or a refused case read. The tests await it; the server lets the tasks run.
     */
    settle: () => deps.background.settle(),
    /**
     * Starts the module's background work under the jobs' shared lock, on one API instance at a time: the dispatch job,
     * whose first round comes ten minutes after the start. Answers the function that stops it; a round in flight finishes.
     */
    startJobs: (lock: JobLock): (() => void) => createDispatchJob(deps, lock).start(),
  };
}

export type Moderation = ReturnType<typeof createModeration>;
