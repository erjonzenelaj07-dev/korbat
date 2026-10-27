/**
 * The only file outside `src/imports/` may import. Everything else in the module is private and the architecture test
 * fails the build if another file reaches into it (3b design, section 9.1).
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { IMPORT_RULES, type ImportSource } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { AuthForImports, ProfileStore } from "../auth";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForImports } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { ModerationForImports } from "../moderation";
import type { SocialForImports } from "../social";
import type { ImportDeps, ImportSettings } from "./context";
import { createDriveJob, driveRound, type DriveOptions } from "./drive";
import { createImportFiles } from "./files";
import { createImportRepo } from "./repo";
import { importRoutes } from "./routes";

export { ImportError } from "./context";
export type { ImportDeps, ImportErrorKind, ImportSettings } from "./context";
export type { DriveReport } from "./drive";
export type { FeedReport } from "./feeder";
export type { ImportList } from "./routes";

/** The owner's settings of section 7.7, as config.ts read and checked them. */
export function importSettingsFrom(config: Pick<Config, "IMPORTS" | "IMPORT_IMAGES" | "IMPORT_SOURCES" | "IMPORT_MAX_ACTIVE" | "IMPORT_IMAGES_PER_HOUR" | "IMPORT_MIN_FREE_BYTES">): ImportSettings {
  return {
    imports: config.IMPORTS === "on",
    images: config.IMPORT_IMAGES === "on",
    sources: config.IMPORT_SOURCES as readonly ImportSource[],
    maxActive: config.IMPORT_MAX_ACTIVE,
    imagesPerHour: config.IMPORT_IMAGES_PER_HOUR,
    minFreeBytes: config.IMPORT_MIN_FREE_BYTES,
  };
}

export interface CreateImportsOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** import-archives, which the API writes and the importer only reads, and import-work, which the API only reads. */
  archivesDir: string;
  workDir: string;
  settings: ImportSettings;
  /** The auth module's interface: whether an account's address is verified (4.2 step 3). */
  auth: AuthForImports;
  /** The social module's interface: which lines the account already imported (7.5 step 2). */
  social: SocialForImports;
  /** 3b Task 5: the media module's interface, through which imported images enter its pipeline (7.4, 8.2). */
  media: MediaForImports;
  /** 3b Task 5: the moderation module's interface, which alerts staff to images left out as flagged (8.1). */
  moderation: ModerationForImports;
  /** 3b Task 5: the profile store, whose read of a running suspension refuses a confirmation (8.5). */
  profiles: Pick<ProfileStore, "suspended">;
  /** The store every limit counts in. */
  rateLimitStore: RateLimitStore;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  logger: Logger;
  now?: () => Date;
  /** Tests only: the free space of import-archives, openWorkFile's device, and a smaller chunk. */
  freeBytes?: () => Promise<number>;
  workDevice?: number;
  chunkBytes?: number;
}

export function createImports(options: CreateImportsOptions) {
  const deps: ImportDeps = {
    repo: createImportRepo(options.apiDb),
    files: createImportFiles({ archivesDir: options.archivesDir, workDir: options.workDir, log: options.logger, freeBytes: options.freeBytes, workDevice: options.workDevice }),
    auth: options.auth,
    social: options.social,
    media: options.media,
    moderation: options.moderation,
    profiles: options.profiles,
    limits: options.rateLimitStore,
    settings: options.settings,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    chunkBytes: options.chunkBytes ?? IMPORT_RULES.chunkBytes,
    inFlight: new Set(),
    plans: new Map(),
  };
  return {
    deps,
    /** Mounted at /api/imports after the session's resolution. */
    routes: importRoutes(deps, options.requireSession),
    /** Creates import-archives' folders. Call once before serving. */
    prepare: () => deps.files.prepare(),
    /** One round of import-drive at the given time. The server runs it on a timer; tests call it directly. */
    drive: (now: Date, driveOptions: DriveOptions) => driveRound(deps, now, driveOptions),
    /** Starts import-drive under the shared job lock, a round every five seconds, and returns the function that stops it. */
    startJobs: (lock: JobLock) => createDriveJob(deps, lock).start(),
  };
}

export type Imports = ReturnType<typeof createImports>;
