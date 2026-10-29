import { IMPORT_RULES } from "@korbat/contracts";

/**
 * Write limits by account age (2a spec, section 6). Sub-project 3 replaces the age check with
 * reputation without changing the buckets or the enforcement.
 */
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Accounts younger than this get the low tier. */
export const NEW_ACCOUNT_MS = 24 * HOUR_MS;
/** Reposting and quoting need an account at least this old. */
export const REPOST_MIN_AGE_MS = 48 * HOUR_MS;

/** 3b (design, section 7.6): an import's chunks, its acts (cancel; confirm, stop and undo in later tasks) and its picks. */
export type ImportAction = "import-chunk" | "import-act" | "import-pick";
/**
 * 2d (design, section 9.5): the seen marker and the settings of Activity (the activity module counts them through this
 * module's index), the avatar's set and remove together (Task 3's routes), the link-preview switch and a post's hidden
 * counts.
 */
export type EngagementAction = "activity-seen" | "activity-settings" | "avatar" | "share-previews" | "hide-counts";
export type WriteAction = "post" | "reply" | "quote" | "repost" | "like" | "bookmark" | "follow" | "block" | "mute" | "upload" | ImportAction | EngagementAction;

export interface WriteLimit {
  /** Counter name; several actions may share one (quotes count as posts). */
  bucket: string;
  max: number;
  windowMs: number;
}

export const isNewAccount = (accountAgeMs: number): boolean => accountAgeMs < NEW_ACCOUNT_MS;
export const mayRepostOrQuote = (accountAgeMs: number): boolean => accountAgeMs >= REPOST_MIN_AGE_MS;

/** Every window an action must stay within. Follows have an hourly and a daily one. */
export function limitsFor(action: WriteAction, accountAgeMs: number): WriteLimit[] {
  const fresh = isNewAccount(accountAgeMs);
  switch (action) {
    case "post":
    case "quote":
      return [{ bucket: "post", max: fresh ? 5 : 30, windowMs: HOUR_MS }];
    case "reply":
      return [{ bucket: "reply", max: fresh ? 20 : 60, windowMs: HOUR_MS }];
    case "repost":
      return [{ bucket: "repost", max: 30, windowMs: HOUR_MS }];
    case "like":
      return [{ bucket: "like", max: 100, windowMs: HOUR_MS }];
    case "bookmark":
      return [{ bucket: "bookmark", max: 100, windowMs: HOUR_MS }];
    case "follow":
      return [
        { bucket: "follow-hour", max: 50, windowMs: HOUR_MS },
        { bucket: "follow-day", max: 400, windowMs: DAY_MS },
      ];
    case "block":
      return [{ bucket: "block", max: 30, windowMs: HOUR_MS }];
    case "mute":
      return [{ bucket: "mute", max: 30, windowMs: HOUR_MS }];
    // Image uploads (2b). The media module counts them through this table, so every per-account limit lives here.
    case "upload":
      return [
        { bucket: "upload", max: fresh ? 20 : 120, windowMs: HOUR_MS },
        { bucket: "upload-day", max: fresh ? 60 : 500, windowMs: DAY_MS },
      ];
    // 3b (design, section 7.6): the imports module counts these through this table too, at any age (an import needs an
    // account of seven days anyway). A 2 GiB archive is 256 chunks; 600 an hour leave room for retries.
    case "import-chunk":
      return [{ bucket: "import-chunk", max: IMPORT_RULES.chunksPerHour, windowMs: HOUR_MS }];
    case "import-act":
      return [{ bucket: "import-act", max: IMPORT_RULES.actsPerHour, windowMs: HOUR_MS }];
    case "import-pick":
      return [{ bucket: "import-pick", max: IMPORT_RULES.picksPerHour, windowMs: HOUR_MS }];
    // 2d (design, section 9.5): at any age. The marker moves once a visit, and the app saves a settled choice only (10.8).
    case "activity-seen":
      return [{ bucket: "activity-seen", max: 240, windowMs: HOUR_MS }];
    case "activity-settings":
      return [{ bucket: "activity-settings", max: 120, windowMs: HOUR_MS }];
    case "avatar":
      return [
        { bucket: "avatar-hour", max: 10, windowMs: HOUR_MS },
        { bucket: "avatar-day", max: 30, windowMs: DAY_MS },
      ];
    case "share-previews":
      return [{ bucket: "share-previews", max: 30, windowMs: HOUR_MS }];
    case "hide-counts":
      return [{ bucket: "hide-counts", max: 60, windowMs: HOUR_MS }];
  }
}
