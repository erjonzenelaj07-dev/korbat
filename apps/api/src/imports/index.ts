/**
 * The only file outside `src/imports/` may import. Everything else in the module is private and the architecture test
 * fails the build if another file reaches into it (3b design, section 9.1).
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { IMPORT_RULES, ImportChoice, type ImportSource, type ImportStatus } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
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
import { endFiles } from "./flows/end";
import { endByStaff, endedByStaff, type StaffEndInput } from "./flows/staff-end";
import { createImportRepo, type StaffEnd } from "./repo";
import { importRoutes } from "./routes";

export { ImportError } from "./context";
export type { ImportDeps, ImportErrorKind, ImportSettings } from "./context";
export type { DriveReport } from "./drive";
export type { FeedReport } from "./feeder";
export type { StaffEndInput } from "./flows/staff-end";
export type { StaffEnd } from "./repo";
export type { ImportList } from "./routes";

/**
 * 3b Task 6 (design, section 8.7; the orchestrator's ruling): what the moderation module needs from this one: how many
 * posts an import published, its size on a case. The moderation module never names import_jobs.
 */
export interface ImportsForModeration {
  /** The import's posts_published, or null when there is no such import. */
  importSize(importId: string): Promise<number | null>;
}

/**
 * The moderation module's interface over this module's repository on the pool it is given: a factory of its own, as
 * socialForModeration is, since the moderation module is built before this one (this one sends that one its alerts).
 */
export function importsForModeration(apiDb: Db): ImportsForModeration {
  const repo = createImportRepo(apiDb);
  return { importSize: (importId) => repo.importSize(importId) };
}

/** 3b Task 6 (design, section 11.2): one of the account's imports as the data export lists it; times are Dates here. */
export interface ImportRecord {
  id: string;
  source: ImportSource;
  status: ImportStatus;
  createdAt: Date;
  endedAt: Date | null;
  statedAt: Date | null;
  choice: ImportChoice | null;
  counts: { postsPublished: number; postsRemoved: number; imagesKept: number; imagesLeftOut: number };
}

/** 3b Task 6 (design, sections 4.7 and 11.2): what the account module needs from this one: the purge's step and the export's member. */
export interface ImportsForAccount {
  /**
   * In the social module's purge transaction, after the profile is marked deleted and every post tombstoned with its
   * import columns cleared: every import row of the account and its import key. The ids, whose files `removeFiles` asks
   * for after the commit.
   */
  purgeOwner(tx: DbTx, ownerId: string): Promise<string[]>;
  /** After that commit: each import's archive folder and marker go, and the importer is asked to delete its work folder. */
  removeFiles(ids: readonly string[]): Promise<void>;
  /** The account's imports, newest first, for the export. */
  exportFor(ownerId: string): Promise<ImportRecord[]>;
}

/** 3b Task 6 (design, section 8.7): what the staff module needs from this one for an admin's end of a whole import. */
export interface ImportsForStaff {
  /** In the staff module's transaction, before its audit row: the moves of 8.7; throws ImportError (not_found, invalid_request, wrong_state). */
  endByStaff(tx: DbTx, input: StaffEndInput): Promise<StaffEnd>;
  /** After its commit: the files and plans of a running import, and the person's mail. */
  endedByStaff(end: StaffEnd, basis: { ruleId: string; decisionId: string }): Promise<void>;
}

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
    offsets: new Map(),
  };
  const forAccount: ImportsForAccount = {
    purgeOwner: (tx, ownerId) => deps.repo.purgeOwner(tx, ownerId),
    async removeFiles(ids) {
      for (const id of ids) {
        deps.plans.delete(id);
        deps.offsets.delete(id);
        await endFiles(deps, id);
      }
    },
    async exportFor(ownerId) {
      return (await deps.repo.exportRows(ownerId)).map((row) => {
        const choice = ImportChoice.safeParse(row.choice);
        return {
          id: row.id,
          source: row.source,
          status: row.status,
          createdAt: row.createdAt,
          endedAt: row.endedAt,
          statedAt: row.statedAt,
          choice: choice.success ? choice.data : null,
          counts: { postsPublished: row.postsPublished, postsRemoved: row.postsRemoved, imagesKept: row.imagesKept, imagesLeftOut: row.imagesLeftOut },
        };
      });
    },
  };
  const forStaff: ImportsForStaff = {
    endByStaff: (tx, input) => endByStaff(deps, tx, input),
    endedByStaff: (end, basis) => endedByStaff(deps, end, basis),
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
    /** 3b Task 6: the interface the account module uses (the purge's step, the export's member). */
    forAccount,
    /** 3b Task 6: the interface the staff module uses (an admin's end of a whole import). */
    forStaff,
  };
}

export type Imports = ReturnType<typeof createImports>;
