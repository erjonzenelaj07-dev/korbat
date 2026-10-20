import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createAccount } from "./account";
import { createApp } from "./app";
import { createAuth, verificationProviderFrom } from "./auth";
import { loadConfig } from "./config";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia, edgeAdapterFrom } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createModeration } from "./moderation";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit, socialForModeration } from "./social";
import { createStaff } from "./staff";
import { createTransparency } from "./transparency";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles: createProfileStore(apiDb),
  // Null when VERIFY_PROVIDER is off: the badge routes then answer badge_unavailable and the app hides the section.
  verify: verificationProviderFrom(config),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  reconcile: config.MEDIA_RECONCILE,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
  // 3d Task 3: the edge's purge adapter (EDGE_PURGE, off by default); the configuration refused a test adapter on an open site.
  edge: edgeAdapterFrom(config),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
// 3d Task 3: the edge's outbox, drained every fifteen seconds: closed as off while the adapter is off, else one purge a round.
const stopEdge = media.startEdge(jobLock);
const stopJanitor = auth.startJanitor(jobLock);
// 3d Task 4: the public figures. The module is built once auth exists, and auth is handed its count afterwards, as the
// wiring hands the media module its handler: resolveSession then counts the month's signed-in accounts and, while
// RECIPIENTS_SIGNED_OUT is on, each day's signed-out readers. Its job closes a month's count and, once a day after the
// dispatch hour, publishes what edition is due. 3d Task 5: and the audit head's daily value, witnessed while HEAD_WITNESS
// is on and mailed to the keeper through the auth module's one sender to HEAD_KEEPER_MAIL.
const transparency = createTransparency({ apiDb, redis, auth: auth.forTransparency, config, logger });
auth.onSeen(transparency.forAuth);
const stopTransparency = transparency.startJobs(jobLock);

// Moderation cases: the module owns its tables on the API's role and reaches the social module through an interface of
// that module's own, built over the same pool, the image rows through the media module's interface for cases, and a
// notifier's contact and every mail through the auth module's. Its limits count in the store the per-IP limit uses, and
// the routes of an account's own decisions and reports stand behind the auth module's session guard.
const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: media.forCases, requireSession: auth.requireSession, rateLimitStore, config, logger });
// The dispatch job: the staff alerts that are still due, the daily release of outcomes, and the mails that waited. And the
// retention job, unless MODERATION_RETENTION switched it off: what is due is erased, and kept image rows nothing retains go.
const stopModeration = moderation.startJobs(jobLock);

const social = createSocial({
  apiDb,
  rateLimitStore,
  logger,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  media: media.forPosts,
  // The chip on the author's own withheld or removed post names its decision, which the moderation module reads.
  moderation: moderation.forSocial,
  // Profile and handle changes are security events; the social module hands them to the auth module, which owns the table.
  events: { append: auth.appendEvent },
});
// Explore's ranking: a round at once, so Explore is filled on a new database or after downtime, then one every five minutes.
const stopExplore = social.startExplore(jobLock);

// The account module owns no table: it reaches the three modules above only through the interfaces their index files export.
const account = createAccount({
  auth: auth.forAccount,
  social: social.forAccount,
  media: media.forAccount,
  // The purge forgets that the deleted account sent its reports, which the moderation module's tables hold.
  moderation: moderation.forAccount,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  requireStrongFreshAuth: auth.requireStrongFreshAuth(),
  rateLimitStore,
  logger,
});
// Deletions the process did not finish (a crash after the auth step, a failed purge) are completed within five minutes.
const stopPurge = account.startPurge(jobLock);

// The staff console's API; createApp mounts it only while CONSOLE_ORIGIN is set. Its credential work is the auth module's,
// its case work the moderation module's.
const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
  account,
  staff,
  moderation,
  transparency,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

/** How long the shutdown waits for the moderation module's tasks that a request started and did not wait for. */
const SETTLE_MS = 5_000;

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopEdge();
  stopJanitor();
  stopTransparency();
  stopExplore();
  stopPurge();
  stopModeration();
  server.close();
  // A statement, a receipt or a staff alert may be on its way to the relay: it gets five seconds to finish before the
  // pools close under it. What is still unsent then stays pending, and the dispatch job of the next start sends it.
  let waited: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    moderation.settle().then(() => true),
    new Promise<boolean>((resolve) => {
      waited = setTimeout(() => resolve(false), SETTLE_MS);
    }),
  ]);
  clearTimeout(waited);
  if (!settled) logger.warn({ signal }, "shutting down with moderation mails still in flight; what is pending is sent after the next start");
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
