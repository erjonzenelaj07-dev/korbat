/**
 * The canaries of the 3b design's section 12: strings planted where korbat must never read (direct messages, the IP
 * log, likes, private and deleted posts) and the person's own names elsewhere (the handle, the display name, a DID),
 * so that a test can prove none reached posts.jsonl, summary.json, the media folder, the scratch file or a log line.
 */
export const CANARY = {
  dm: "CANARY-DM",
  ip: "CANARY-IP",
  like: "CANARY-LIKE",
  private: "CANARY-PRIVATE",
  deleted: "CANARY-DELETED",
  handle: "CANARY-HANDLE",
  name: "CANARY-NAME",
} as const;

/** The fixture account's DID on Bluesky; a plc DID is 24 base32 characters. */
export const FIXTURE_DID = "did:plc:canarydidfixture2345abcd";

/** Every string none of the importer's outputs may hold. */
export const FORBIDDEN_STRINGS: readonly string[] = [...Object.values(CANARY), FIXTURE_DID, "canarydidfixture"];

/** The fixtures' Mastodon server, whose name is the person's own instance. */
export const FIXTURE_HOST = "social.example";

/** The account key of the fixtures' person (64 lowercase hex), and a second account's. */
export const ACCOUNT_KEY = "a1".repeat(32);
export const OTHER_ACCOUNT_KEY = "b2".repeat(32);

/** The creation time of the fixtures' imports: dates up to one day later are in range. */
export const CREATED_AT = "2026-10-20T12:00:00.000Z";
