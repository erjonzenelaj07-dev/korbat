import type { ImportErrorCode, ImportSource } from "@korbat/contracts";
import type { Logger } from "pino";
import type { AuthForImports, ProfileStore } from "../auth";
import type { MediaForImports } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { ModerationForImports } from "../moderation";
import { limitsFor, type ImportAction, type SocialForImports } from "../social";
import type { ImportFiles } from "./files";
import type { ImportPlan } from "./plan";
import type { ImportRepo } from "./repo";

/**
 * The imports module (3b design, section 9.1): an archive's upload in chunks, its scan by the importer service, the
 * preview and the person's picks, and the job import-drive that moves every import along the states of section 4.1.
 * It names the three import tables in its repository alone, reaches posts only through the social module's index and
 * an account's email only through the auth module's, and reads everything the importer wrote through openWorkFile. 3b
 * Task 5: images reach the media pipeline only through the media module's index, a non-acting match's alert goes through
 * the moderation module's, and whether an account is suspended is the profile store's plain read.
 */

/** The import codes plus the shared invalid_request, which a malformed header or parameter gets. */
export type ImportErrorKind = ImportErrorCode | "invalid_request";
export type ImportErrorStatus = 400 | 403 | 404 | 409 | 413 | 429 | 503;

/** 9.4's statuses. */
const STATUS: Record<ImportErrorKind, ImportErrorStatus> = {
  imports_unavailable: 503,
  import_active: 409,
  rate_limited: 429,
  import_weekly_limit: 429,
  archive_too_large: 413,
  wrong_state: 409,
  wrong_offset: 409,
  chunk_too_large: 413,
  chunk_mismatch: 400,
  not_an_archive: 400,
  statement_required: 400,
  nothing_chosen: 400,
  import_too_soon: 403,
  account_suspended: 403,
  not_found: 404,
  invalid_request: 400,
};

/** 9.4's and 10.9's sentences; the app shows its own words module's, and these are what a log or a curl reads. */
const MESSAGES: Record<ImportErrorKind, string> = {
  imports_unavailable: "Imports are paused for now. Try again later.",
  import_active: "You already have an import in progress.",
  rate_limited: "Many imports were started from your network today. Try again tomorrow.",
  import_weekly_limit: "You have published three imports this week. Try again later.",
  archive_too_large: "Archives can be at most 2 GB.",
  wrong_state: "This import has moved on. Reload to see where it is.",
  wrong_offset: "That part of the archive is not the next one.",
  chunk_too_large: "That part of the archive is too large.",
  chunk_mismatch: "That part of the archive arrived damaged. Send it again.",
  not_an_archive: "This file is not an archive of that source.",
  statement_required: "Confirm that these are your own posts.",
  nothing_chosen: "Your choice leaves no posts to publish.",
  import_too_soon: "You can import posts once your account is 7 days old.",
  account_suspended: "Your account is suspended, so you cannot do this now.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and its status. */
export class ImportError extends Error {
  readonly status: ImportErrorStatus;
  readonly retryAfterSeconds: number | undefined;
  readonly details: unknown;
  constructor(
    readonly code: ImportErrorKind,
    options: {
      /** For rate_limited and import_weekly_limit: the response carries Retry-After. */
      retryAfterSeconds?: number;
      /** For wrong_offset: `{ receivedBytes }`, so a retry learns where to go on (7.3). */
      details?: unknown;
      message?: string;
    } = {},
  ) {
    super(options.message ?? MESSAGES[code]);
    this.name = "ImportError";
    this.status = STATUS[code];
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}

/** The owner's settings of section 7.7, as config.ts has read and checked them. */
export interface ImportSettings {
  /** IMPORTS: off refuses every new import; running imports finish. */
  imports: boolean;
  /** IMPORT_IMAGES: whether a new import brings images; the configuration refuses it on while no matcher is (decision 15). */
  images: boolean;
  /** IMPORT_SOURCES: the sources a new import may name (decision 16). */
  sources: readonly ImportSource[];
  /** IMPORT_MAX_ACTIVE: imports in uploading or scanning on the site at once. */
  maxActive: number;
  /** IMPORT_IMAGES_PER_HOUR: the feeder's pace, counted in the limit store under import-images-site (7.4). */
  imagesPerHour: number;
  /** IMPORT_MIN_FREE_BYTES: kept free on import-archives beyond a new import's size and the most a scan may write. */
  minFreeBytes: number;
}

export interface ImportDeps {
  repo: ImportRepo;
  files: ImportFiles;
  auth: AuthForImports;
  social: SocialForImports;
  /** 3b Task 5: the media module's interface: the feeder's conditions, an image's way in, its rows, their deletion (7.4, 8.2). */
  media: MediaForImports;
  /** 3b Task 5: the moderation module's interface: the alert for images left out as flagged (8.1). */
  moderation: ModerationForImports;
  /** 3b Task 5: the profile store's read of whether an account's suspension runs, which refuses a confirmation (8.5). */
  profiles: Pick<ProfileStore, "suspended">;
  limits: RateLimitStore;
  settings: ImportSettings;
  log: Logger;
  now: () => Date;
  /** IMPORT_RULES.chunkBytes; tests only give a smaller one, so a chunk's rules are tried on a few bytes. */
  chunkBytes: number;
  /**
   * The uploads that have a chunk on its way into archive.part in this process: a second chunk of the same import waits
   * for nothing and is answered wrong_offset, so two writers never append to one file. The API runs as one instance.
   */
  inFlight: Set<string>;
  /**
   * 3b Task 5: the feeder's plans (7.4), one for each import that prepares, built once a process from posts.jsonl and kept
   * until the import leaves preparing: the preview's pages are gone once it is confirmed, and the plan finds image N of the
   * cursor without reading the work file again.
   */
  plans: Map<string, ImportPlan>;
}

/**
 * Counts one action of the account in every window social/tiers.ts gives it (7.6: import-chunk, import-act,
 * import-pick, at any age) and refuses it once one is full, with Retry-After. A store that cannot count refuses the
 * action as imports_unavailable (9.4: the limit store), as every limit of korbat fails closed.
 */
export async function enforceImportLimit(deps: Pick<ImportDeps, "limits">, action: ImportAction, userId: string): Promise<void> {
  for (const limit of limitsFor(action, 0)) {
    let hit: { count: number; resetMs: number };
    try {
      hit = await deps.limits.hit(`imports:${limit.bucket}:${userId}`, limit.windowMs);
    } catch {
      throw new ImportError("imports_unavailable");
    }
    if (hit.count > limit.max) throw new ImportError("rate_limited", { retryAfterSeconds: Math.max(1, Math.ceil(hit.resetMs / 1000)), message: "Too many requests. Wait a moment and try again." });
  }
}
