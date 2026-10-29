/**
 * The only file outside `src/activity/` may import. Everything else in the module is private and the architecture test
 * fails the build if another file reaches into it.
 *
 * The activity module (2d design, sections 5 and 9.1): the one screen that tells a person what others did with them and
 * what korbat told them about their own content. It reads activity_items and activity_state (the social module writes
 * the entries, in the act's transaction), the posts' views and the follow groups' accounts through the social module's
 * interface, and the moderation entries through the moderation module's (`authorActivity`); it writes nothing but the
 * seen marker, the rules and the retention's deletes. No route of it counts unread entries for anything but the open
 * screen (decision 4), and no staff route reads it: the staff and moderation modules never import it.
 */
import { ActivityNewerQuery, ActivityQuery, ActivitySettings, SeenRequest } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import { validate } from "../lib/validate";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { ModerationForActivity } from "../moderation";
import type { SocialForActivity } from "../social";
import { DEFAULT_PAGE_SIZE, activityPage, exportEntries, markSeen, newerCount, readSettings, saveSettings, type ActivityDeps, type ActivityExport } from "./flows";
import { createActivityRepo } from "./repo";
import { createRetentionJob } from "./retention";

export { ActivityError } from "./flows";
export type { ActivityErrorKind, ActivityExport, ReceivedEntry } from "./flows";

/** What the account module needs from this one (11.2): the export's member, its received entries read in pages of `pageSize`. */
export interface ActivityForAccount {
  exportEntries(userId: string, pageSize?: number): Promise<ActivityExport>;
}

export interface CreateActivityOptions {
  /** The korbat_api pool. */
  apiDb: Db;
  /** The social module's interface for this one: social.forActivity. */
  social: SocialForActivity;
  /** The moderation module's interface for this one: moderation.forActivity. Without it the list holds no moderation entry. */
  moderation?: ModerationForActivity;
  /** The store every per-account limit counts in, as the social module's. */
  rateLimitStore: RateLimitStore;
  /** The auth module's requireSession: an onboarded account, with CSRF and Origin checked for its writes. */
  requireSession: MiddlewareHandler<AppEnv>;
  logger: Logger;
  now?: () => Date;
  /** Entries a page holds; ACTIVITY_PAGE_SIZE unless a test lowers it to page through few entries. */
  pageSize?: number;
}

/** Rows a page of the export reads at a time unless a test says otherwise, as the social module's lists. */
const EXPORT_PAGE_SIZE = 1_000;

/** The routes of 9.2, mounted at /api/activity, every one behind the session; the app's error handler renders their refusals. */
function activityRoutes(deps: ActivityDeps, guard: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;
  r.get("/", guard, validate("query", ActivityQuery), async (c) => c.json(await activityPage(deps, me(c), c.req.valid("query"))));
  r.get("/newer", guard, validate("query", ActivityNewerQuery), async (c) => c.json(await newerCount(deps, me(c), c.req.valid("query"))));
  // Only what the account reads: open to a suspended account (9.4).
  r.post("/seen", guard, validate("json", SeenRequest), async (c) => {
    await markSeen(deps, me(c), c.req.valid("json").at);
    return c.body(null, 204);
  });
  r.get("/settings", guard, async (c) => c.json(await readSettings(deps, me(c))));
  r.put("/settings", guard, validate("json", ActivitySettings), async (c) => c.json(await saveSettings(deps, me(c), c.req.valid("json"))));
  return r;
}

export function createActivity(options: CreateActivityOptions) {
  const deps: ActivityDeps = {
    repo: createActivityRepo(options.apiDb),
    social: options.social,
    moderation: options.moderation,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
  };
  const forAccount: ActivityForAccount = {
    exportEntries: (userId, pageSize = EXPORT_PAGE_SIZE) => exportEntries(deps, userId, pageSize),
  };
  return {
    deps,
    /** GET /, GET /newer, POST /seen, GET and PUT /settings, which app.ts mounts at /api/activity. */
    routes: activityRoutes(deps, options.requireSession),
    /** The interface the account module's export uses. */
    forAccount,
    /**
     * Starts activity-retention under the jobs' shared lock: a round every hour, the first an hour after the start. Returns
     * the function that stops it; a round in flight finishes.
     */
    startRetention: (lock: JobLock) => createRetentionJob(deps, lock).start(),
  };
}

export type Activity = ReturnType<typeof createActivity>;
