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
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../auth";
import type { Config } from "../config";
import type { MediaForCases } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";
import { createBackground, type ModerationDeps } from "./context";
import { decide, type DecideOutcome } from "./decide";
import { moderationRoutes } from "./routes";

export { ModerationError } from "./context";
export type { ModerationDeps, ModerationErrorKind } from "./context";
export type { DecideOutcome } from "./decide";

/** What the staff module needs from this one: the console's operations on cases, which its routes run behind the staff gate. */
export interface ModerationForStaff {
  /**
   * Records the decision a step-up confirmed, in one transaction with its audit row. "ended" when the confirming account
   * or key no longer opens anything, "late" when the challenge's time ran out; neither writes anything.
   */
  decide(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<DecideOutcome>;
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
  };
  return {
    deps,
    /** The app's routes, mounted at /api: reports and notices, their status page and its contact buttons. */
    routes: moderationRoutes(deps),
    /** The interface the staff module uses. */
    forStaff,
    /**
     * Resolves once every task a request started and did not wait for has ended: the mails after a report or a notice.
     * The tests await it; the server lets the tasks run.
     */
    settle: () => deps.background.settle(),
  };
}

export type Moderation = ReturnType<typeof createModeration>;
