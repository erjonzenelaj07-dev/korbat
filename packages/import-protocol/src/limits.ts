import { IMPORT_RULES } from "@korbat/contracts";

/**
 * The file protocol's caps (3b design, sections 7.1, 7.5 and 9.2), each read from the contracts' IMPORT_RULES, so every
 * number lives in one place. The API reads everything the importer wrote as hostile input, under these caps.
 */

/** job.json, which the API writes and the importer reads. */
export const JOB_FILE_MAX_BYTES = IMPORT_RULES.jobFileMaxBytes;
/** summary.json, the importer's commit point. */
export const SUMMARY_MAX_BYTES = IMPORT_RULES.summaryMaxBytes;
/** One line of posts.jsonl: 30,000 code points of four bytes, plus the JSON and the media (5.3 step 7). */
export const LINE_MAX_BYTES = IMPORT_RULES.lineMaxBytes;
/** posts.jsonl: one line for each kept post at most, and its bytes. */
export const POSTS_MAX_LINES = IMPORT_RULES.maxPosts;
export const POSTS_MAX_BYTES = IMPORT_RULES.postsFileMaxBytes;
/** One of the preview's samples, read from its offset (9.2). */
export const SAMPLE_MAX_BYTES = IMPORT_RULES.sampleMaxBytes;
/** How often the importer rewrites its heartbeat, and the age at which the API stops taking new imports (4.2 step 3). */
export const IMPORTER_HEARTBEAT_INTERVAL_MS = IMPORT_RULES.heartbeatMs;
export const IMPORTER_HEARTBEAT_STALE_MS = IMPORT_RULES.heartbeatStaleMs;
/** How often a scan of one archive may start: the third start fails it as interrupted, so a file that kills the importer cannot loop. */
export const SCAN_MAX_ATTEMPTS = IMPORT_RULES.maxAttempts;
