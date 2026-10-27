import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { runScan, workspace } from "./fixtures/harness";
import { MASTODON_NOTES, buildMastodonArchive, outboxJson, type NoteSpec } from "./fixtures/mastodon";

/**
 * What the importer logs (3b design, 7.1): the job id, the phase, timings, the failure code, the counts by reason once
 * at the end, and a line per item only for unreadable and item_too_large (its reason and its index in the stream).
 * Never a text, a description, an entry name, a source id, a handle or a DID, and never an error's message, which a
 * parser or zlib may build from the input. This source scan refuses any log call that could carry one.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const LEVELS = "fatal|error|warn|info|debug|trace";
/** The only field names a log call may use. */
export const ALLOWED_FIELDS = [
  "id",
  "phase",
  "ms",
  "failure",
  "code",
  "error",
  "reason",
  "index",
  "attempts",
  "posts",
  "images",
  "skipped",
  "imagesSkipped",
  "cleaned",
  "warnings",
  "sourceLinks",
  "protectedPosts",
  "readInPart",
  "refusedNames",
  "signal",
];
/** Words a value may not name: what the archive holds, and an error's own text. */
const FORBIDDEN_WORDS = /(?<![A-Za-z0-9_])(message|stack|text|entry|entries|name|names|sourceId|parentId|did|handle|alt|href|uri|url|file|path|key|content|record|err)(?![A-Za-z0-9_])/;

export interface SourceFile {
  path: string;
  source: string;
}

/** The text of a call's arguments, from just after its opening parenthesis to the matching one. */
function argumentsAt(source: string, open: number): string {
  let depth = 1;
  let at = open + 1;
  let quote: string | null = null;
  for (; at < source.length && depth > 0; at++) {
    const c = source[at]!;
    if (quote) {
      if (c === String.fromCharCode(92)) at++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
  }
  return source.slice(open + 1, at - 1);
}

/** Splits `a, b: c(d, e), f` at its top-level commas. */
function topLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

export function violations(files: readonly SourceFile[]): string[] {
  const found: string[] = [];
  const call = new RegExp(`(?<![A-Za-z0-9_])log[ ]*[.][ ]*(${LEVELS})[ ]*[(]`, "g");
  for (const file of files) {
    for (const match of file.source.matchAll(call)) {
      const args = topLevel(argumentsAt(file.source, match.index + match[0].length - 1));
      const where = `${file.path}: log.${match[1]}`;
      const message = args.at(-1) ?? "";
      if (!/^"[^"`$]*"$/.test(message)) found.push(`${where}: the message is not a plain string`);
      if (args.length > 2) found.push(`${where}: too many arguments`);
      if (args.length === 2) {
        const fields = args[0]!;
        if (!fields.startsWith("{") || !fields.endsWith("}")) {
          found.push(`${where}: the fields are not an object literal`);
          continue;
        }
        for (const property of topLevel(fields.slice(1, -1))) {
          const [name, ...rest] = property.split(":");
          const field = name!.trim();
          const value = rest.join(":").trim() || field;
          if (!ALLOWED_FIELDS.includes(field)) found.push(`${where}: the field ${field} is not allowed`);
          // A plain word in quotes (a phase's name) is fine; any other quote, or a forbidden word, is not.
          const literal = /^"[A-Za-z0-9_ -]*"$/.test(value);
          if (!literal && (/["'`]/.test(value) || FORBIDDEN_WORDS.test(value))) found.push(`${where}: the field ${field} may carry the archive's words`);
        }
      }
    }
  }
  return found;
}

function sourceFiles(dir: string, prefix = ""): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sourceFiles(path.join(dir, entry.name), rel);
    return entry.name.endsWith(".ts") ? [{ path: rel, source: readFileSync(path.join(dir, entry.name), "utf8") }] : [];
  });
}

describe("the source scan", () => {
  test("the importer's source has no log call that could carry the archive's words", () => {
    const files = sourceFiles(path.join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(10);
    expect(violations(files)).toEqual([]);
    // The scan sees the calls it is meant to see.
    expect(files.some((file) => /(?<![A-Za-z0-9_])log[.](info|warn|error)[(]/.test(file.source))).toBe(true);
  });

  test("it refuses fields outside the list, an error object, an archive's words and a built message", () => {
    const files: SourceFile[] = [
      { path: "a.ts", source: 'deps.log.info({ id, text: draft.text }, "kept");' },
      { path: "b.ts", source: 'log.error({ id, err }, "failed");' },
      { path: "c.ts", source: 'log.warn({ id, reason: item.entry }, "skipped");' },
      { path: "d.ts", source: "log.info({ id }, `scanned ${name}`);" },
      { path: "e.ts", source: 'this.log.debug({ id, error: err.message }, "x");' },
      { path: "f.ts", source: 'log.info(draft, "kept");' },
      { path: "ok.ts", source: 'log.info({ id, phase: "read", ms: now() - started, skipped: counts.skipped }, "scan ended"); log.warn({ id, reason, index }, "item skipped");' },
    ];
    expect(violations(files)).toEqual([
      "a.ts: log.info: the field text is not allowed",
      "a.ts: log.info: the field text may carry the archive's words",
      "b.ts: log.error: the field err is not allowed",
      "b.ts: log.error: the field err may carry the archive's words",
      "c.ts: log.warn: the field reason may carry the archive's words",
      "d.ts: log.info: the message is not a plain string",
      "e.ts: log.debug: the field error may carry the archive's words",
      "f.ts: log.info: the fields are not an object literal",
    ]);
  });
});

describe("no log line for a skipped item", async () => {
  const ws = workspace();
  afterAll(() => ws.remove());
  const linesFor = async (notes: NoteSpec[]) => (await runScan(ws.dir, { source: "mastodon", archive: buildMastodonArchive({ outbox: outboxJson(notes, false) }) })).logs;
  const kept = MASTODON_NOTES.public;
  const privates = Array.from({ length: 50 }, (_, i) => ({ ...MASTODON_NOTES.private, n: 60 + i }));
  const baseline = await linesFor([kept]);
  const many = await linesFor([kept, ...privates, MASTODON_NOTES.question, MASTODON_NOTES.tooOld]);

  test("fifty private posts, a poll and an old post add no line", () => {
    expect(many.length).toBe(baseline.length);
    const parsed = many.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.filter((line) => "index" in line)).toEqual([]);
    expect(parsed.at(-1)).toMatchObject({ skipped: { not_public: 50, poll: 1, date_out_of_range: 1 } });
  });

  test("every line names only allowed fields", () => {
    for (const line of many) {
      const fields = Object.keys(JSON.parse(line) as object).filter((field) => !["level", "time", "msg"].includes(field));
      for (const field of fields) expect(ALLOWED_FIELDS).toContain(field);
    }
  });
});
