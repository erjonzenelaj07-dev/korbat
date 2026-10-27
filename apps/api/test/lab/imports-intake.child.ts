import pino from "pino";
import { createImportFiles } from "../../src/imports/files";
import { runIntake, type ScannedSummary } from "../../src/imports/intake";

/**
 * The intake lab's measured process (imports-intake.lab.ts): runs the API's intake once over the posts.jsonl the lab
 * wrote, in a process of its own so that its peak memory is the intake's alone, and prints one line of JSON. The social
 * module's read of keys already imported is a set that knows none: the database is not what this lab measures.
 */
const [workDir, id, lines] = process.argv.slice(2);
if (!workDir || !id || !lines) {
  console.error("usage: node --expose-gc --import tsx imports-intake.child.ts <work dir> <import id> <lines>");
  process.exit(2);
}

const summary: ScannedSummary = { v: 1, id, status: "scanned", posts: Number(lines), images: 0, skipped: {}, imagesSkipped: {}, cleaned: 0, warnings: 0, sourceLinks: 0, protectedPosts: 0, readInPart: false };
const files = createImportFiles({ archivesDir: workDir, workDir, log: pino({ level: "silent" }) });
(globalThis as { gc?: () => void }).gc?.();
const rssBefore = process.memoryUsage().rss;
let asked = 0;
const started = performance.now();
const result = await runIntake({
  id,
  summary,
  images: false,
  createdAt: new Date(),
  young: false,
  known: async (keys) => {
    asked += keys.length;
    return new Set();
  },
  files,
  log: pino({ level: "silent" }),
});
const ms = Math.round(performance.now() - started);
// maxRSS is in kilobytes: the process's peak resident memory, the intake's and the runtime's together.
const maxRss = process.resourceUsage().maxRSS * 1024;
console.log(
  JSON.stringify({
    ok: result.ok,
    code: result.ok ? null : result.code,
    posts: result.ok ? result.scan.posts : null,
    months: result.ok ? result.scan.months.length : null,
    pages: result.ok ? result.scan.pages.length : null,
    scanBytes: result.ok ? JSON.stringify(result.scan).length : null,
    asked,
    ms,
    rssBefore,
    maxRss,
  }),
);
