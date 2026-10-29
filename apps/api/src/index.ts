import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createAccount } from "./account";
import { createActivity } from "./activity";
import { createApp } from "./app";
import { createAuth, verificationProviderFrom } from "./auth";
import { createCards } from "./cards";
import { loadConfig } from "./config";
import { createImports, importSettingsFrom, importsForModeration } from "./imports";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { R1_TEST_MODEL } from "@korbat/media-protocol";
import { createMedia, edgeAdapterFrom, matchAdapterFrom } from "./media";
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

// The profile store on the API's pool: the auth module writes profiles through it, and (3b Task 5) the imports module reads
// whether an account's suspension runs from it.
const profiles = createProfileStore(apiDb);
const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles,
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
  // 3d Task 6: the scorer's model whose scores finalize keeps: the test scorer's under R1_CLASSIFIER=test (refused on an open
  // site), none while it is off; no classifier is built in, and onnx stopped the configuration.
  r1Model: config.R1_CLASSIFIER === "test" ? R1_TEST_MODEL : null,
  // 3d Task 7: the comparison with known material (MEDIA_MATCH, off by default); the configuration refused a test adapter
  // on an open site, and every source's name, since no source's adapter is built in.
  match: matchAdapterFrom(config),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
// 3d Task 3: the edge's outbox, drained every fifteen seconds: closed as off while the adapter is off, else one purge a round.
const stopEdge = media.startEdge(jobLock);
// 3d Task 7: match-retry, a round a minute: asks again for checks that were not answered or met the limit on refusals.
const stopMatch = media.startMatchRetry(jobLock);
const stopJanitor = auth.startJanitor(jobLock);
// 3d Task 4: the public figures. The module is built once auth exists, and auth is handed its count afterwards, as the
// wiring hands the media module its handler: resolveSession then counts the month's signed-in accounts and, while
// RECIPIENTS_SIGNED_OUT is on, each day's signed-out readers. Its job closes a month's count and, once a day after the
// dispatch hour, publishes what edition is due. 3d Task 5: and the audit head's daily value, witnessed while HEAD_WITNESS
// is on and mailed to the keeper through the auth module's one sender to HEAD_KEEPER_MAIL.
// 3d review H3: the recipients' count (the day's salt and the sketches) lives in a Valkey of its own, Compose's `counts`,
// which writes nothing to disk; the shared Valkey keeps an append-only file of every write, so the count never reaches it.
// A lost store loses the running month, which then reads as not recorded; counting never fails a request.
const counts = new Redis(config.COUNTS_URL, { maxRetriesPerRequest: 2 });
counts.on("error", (err) => logger.error({ err }, "counts store error"));
const transparency = createTransparency({ apiDb, counts, auth: auth.forTransparency, config, logger });
auth.onSeen(transparency.forAuth);
const stopTransparency = transparency.startJobs(jobLock);

// Moderation cases: the module owns its tables on the API's role and reaches the social module through an interface of
// that module's own, built over the same pool, the image rows through the media module's interface for cases, and a
// notifier's contact and every mail through the auth module's. Its limits count in the store the per-IP limit uses, and
// the routes of an account's own decisions and reports stand behind the auth module's session guard.
// 3b Task 6: a case reads an import's size through the imports module's own factory over the same pool, since this
// module is built before that one (which sends this one its alerts).
const moderation = createModeration({
  apiDb,
  auth: auth.forModeration,
  social: socialForModeration(apiDb),
  media: media.forCases,
  imports: importsForModeration(apiDb),
  requireSession: auth.requireSession,
  rateLimitStore,
  config,
  logger,
});
// The dispatch job: the staff alerts that are still due, the daily release of outcomes, and the mails that waited. And the
// retention job: what is due is erased, and kept image rows nothing retains go; while MODERATION_RETENTION is off it only
// forgets the hashes and ratings of a tool that is off (3d Task 8).
const stopModeration = moderation.startJobs(jobLock);
// 3d Task 7 (design, section 5): the media module is built before the moderation module, so it is handed that module's
// handler of a stored refusal or match afterwards (media.onMatch(moderation.matched)).
media.onMatch(moderation.matched);

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

// 2d Task 6: the share cards. They read a post or a profile as a signed-out reader gets it through the social module's
// interface for cards, and build every address on APP_ORIGIN; no table, no session and no job of their own.
const cards = createCards({ social: social.forCards, appOrigin: config.APP_ORIGIN });

// 2d: Activity. Built after the social and moderation modules, whose interfaces give it the posts' views, the follow
// groups' accounts and the moderation entries (authorActivity), and before the account module, whose export lists the
// account's entries through it. Its limits count in the store the per-IP limit uses, through the social module's table.
// Its job, activity-retention, deletes the entries older than 90 days, a round every hour.
const activity = createActivity({
  apiDb,
  social: social.forActivity,
  moderation: moderation.forActivity,
  rateLimitStore,
  requireSession: auth.requireSession,
  logger,
});
const stopActivity = activity.startRetention(jobLock);

// 3b: import from other platforms. The module owns the three import tables, writes import-archives and reads import-work
// (the importer's output) only through openWorkFile; it asks the auth module whether an address is verified and the
// social module which posts an account already imported. Its job, import-drive, reads finished scans, runs the intake,
// applies the time limits and clears what a crash left, a round every five seconds. 3b Task 5: it feeds imported images
// to the media module's pipeline through that module's interface, alerts staff to a non-acting match through the
// moderation module's, and reads whether an account is suspended, for a confirmation, from the profile store. 3b Task 6:
// built before the account module, whose purge deletes an account's imports and whose export lists them through
// imports.forAccount; it publishes and removes posts through the social module's batch writers.
const imports = createImports({
  apiDb,
  archivesDir: config.IMPORT_ARCHIVES_DIR,
  workDir: config.IMPORT_WORK_DIR,
  settings: importSettingsFrom(config),
  auth: auth.forImports,
  social: social.forImports,
  media: media.forImports,
  moderation: moderation.forImports,
  profiles,
  rateLimitStore,
  requireSession: auth.requireSession,
  logger,
});
await imports.prepare();
const stopImports = imports.startJobs(jobLock);

// The account module owns no table: it reaches the three modules above only through the interfaces their index files export.
const account = createAccount({
  auth: auth.forAccount,
  social: social.forAccount,
  media: media.forAccount,
  // The purge forgets that the deleted account sent its reports, which the moderation module's tables hold.
  moderation: moderation.forAccount,
  // 3b Task 6: the purge deletes the account's imports and import key in its transaction; the export lists the imports.
  imports: imports.forAccount,
  // 2d: the export's member `activity`; the social purge already deletes the account's entries, marker and mentions.
  activity: activity.forAccount,
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
// 3b Task 6: and an admin's end of a whole import, the imports module's.
const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff, imports: imports.forStaff });

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
  imports,
  activity,
  cards,
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
  stopMatch();
  stopJanitor();
  stopTransparency();
  stopExplore();
  stopPurge();
  stopImports();
  stopActivity();
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
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit(), counts.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
