import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Every list of the measures (2d design, section 6.5, "Every list of the measures"; Task 4). The field resets are listed
 * by hand in many places besides the contracts' MEASURES: SQL fragments of the API, the app's and the console's switches
 * and words, and the database's functions and view. A measure added to the ledger that one of them misses is a silent
 * gap (a reset not counted as a measure, an outcome read wrong, a reporter told that nothing changed). So, as 3e's enum
 * test reads its files, this test reads the source trees and the newest body of every migration function and view, and
 * expects 2d's reset_avatar wherever reset_display_name appears, and restore_avatar wherever restore_display_name does.
 */

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS = join(REPO, "packages", "db", "migrations");
const NEWLINE = String.fromCharCode(10);
const BREAKPOINT = "--> statement-breakpoint";

/** The source trees the design names, and the two packages that hold the ledger's own lists. */
const TREES = ["apps/api/src", "apps/app/src", "apps/admin/src", "packages/rules/src", "packages/contracts/src", "packages/db/src"];

/** Each pair: where the first name appears, the second must too. */
const PAIRS = [
  ["reset_display_name", "reset_avatar"],
  ["restore_display_name", "restore_avatar"],
] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /[.]tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Where a line comment starts: the first marker that does not follow a colon (a URL's `//` is no comment), or -1. */
function commentAt(line: string, marker: "//" | "--"): number {
  for (let at = line.indexOf(marker); at >= 0; at = line.indexOf(marker, at + 1)) {
    if (marker === "--" || at === 0 || line[at - 1] !== ":") return at;
  }
  return -1;
}

/** A file's text with its line comments dropped (`//` in TypeScript, `--` in SQL): a comment may name a kind as it likes. */
function withoutComments(text: string, marker: "//" | "--"): string {
  return text
    .split(NEWLINE)
    .map((line) => {
      const at = commentAt(line, marker);
      return at < 0 ? line : line.slice(0, at);
    })
    .join(NEWLINE);
}

/** Every run of white space (a code point up to the space) as one space, as the database tests read SQL. */
function flat(text: string): string {
  return [...text]
    .map((char) => (char.charCodeAt(0) <= 32 ? " " : char))
    .join("")
    .split(" ")
    .filter((word) => word !== "")
    .join(" ");
}

/** A kind's name as a word: not a part of a longer name. */
const names = (text: string, kind: string) => new RegExp(`(?<![A-Za-z0-9_])${kind}(?![A-Za-z0-9_])`).test(text);

/** Every source file of the trees, by its path from the repository's root, with its comments dropped; read once for the file's tests. */
let cachedSources: { path: string; text: string }[] | null = null;
function sources(): { path: string; text: string }[] {
  cachedSources ??= TREES.flatMap((tree) =>
    walk(join(REPO, tree)).map((full) => ({ path: relative(REPO, full).split(sep).join("/"), text: withoutComments(readFileSync(full, "utf8"), "//") })),
  );
  return cachedSources;
}

/**
 * The newest text of every function and view the migrations create, by name, in the journal's order: a later CREATE OR
 * REPLACE of a name takes its place. Each is the one statement that creates it, its comments dropped.
 */
function newestObjects(): Map<string, { tag: string; text: string }> {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const found = new Map<string, { tag: string; text: string }>();
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    for (const statement of readFileSync(join(MIGRATIONS, `${entry.tag}.sql`), "utf8").split(BREAKPOINT)) {
      const text = flat(withoutComments(statement, "--"));
      const created = /CREATE (?:OR REPLACE )?(FUNCTION|VIEW) "?([a-z0-9_]+)"?[.]"?([a-z0-9_]+)"?/i.exec(text);
      if (created) found.set(`${created[2]}.${created[3]}`, { tag: entry.tag, text });
    }
  }
  return found;
}

describe("every list of the measures names the profile picture's reset where it names the display name's", () => {
  test("each source file that names a display name's reset or its reversal names the avatar's too", () => {
    const missing: string[] = [];
    let read = 0;
    for (const file of sources()) {
      for (const [old, added] of PAIRS) {
        if (!names(file.text, old)) continue;
        read++;
        if (!names(file.text, added)) missing.push(`${file.path}: names ${old} but not ${added}`);
      }
    }
    expect(missing).toEqual([]);
    // The trees hold the lists 6.5 enumerates: the API's four files, the app's two, the console's two and the contracts'.
    expect(read).toBeGreaterThanOrEqual(10);
  });

  test("the files 6.5 names are among those read", () => {
    const read = new Set(sources().filter((file) => names(file.text, "reset_display_name")).map((file) => file.path));
    for (const path of [
      "apps/api/src/moderation/repo.ts",
      "apps/api/src/moderation/statement-repo.ts",
      "apps/api/src/moderation/author-repo.ts",
      "apps/app/src/components/moderation/StatusSheet.tsx",
      "apps/app/src/lib/terms.ts",
      "apps/admin/src/compose.ts",
      "apps/admin/src/screens/Case.tsx",
      "packages/contracts/src/moderation.ts",
      "packages/db/src/schema/moderation.ts",
    ]) {
      expect(read.has(path), path).toBe(true);
    }
  });

  test("the newest body of each migration function and view that names a display name's reset or its reversal names the avatar's too", () => {
    const objects = newestObjects();
    const missing: string[] = [];
    const naming: string[] = [];
    for (const [name, { tag, text }] of objects) {
      for (const [old, added] of PAIRS) {
        if (!names(text, old)) continue;
        if (old === "reset_display_name") naming.push(name);
        if (!names(text, added)) missing.push(`${name} (newest in ${tag}): names ${old} but not ${added}`);
      }
    }
    expect(missing).toEqual([]);
    // The seven of 6.5 and 6.8: the view, the two SQL functions, the redaction, the signed form's counts, and the two
    // functions of the ledger's measures.
    expect(naming.sort()).toEqual(
      [
        "public.case_evidence_due_at",
        "public.decision_actions_apply",
        "public.decision_actions_check",
        "public.decision_holds",
        "public.item_current_outcome",
        "public.measures_in_force",
        "public.redact_r4_body",
      ].sort(),
    );
    // Each of them is newest in avatar_moderation, the migration that replaced it.
    for (const name of naming) expect(objects.get(name)!.tag, name).toBe("0053_avatar_moderation");
  });

  test("a list that misses the avatar's reset is caught, and a comment that names one is not a list", () => {
    const file = { text: withoutComments(["const LIST = ['reset_display_name', 'reset_bio'];", "// reset_avatar is in a comment only"].join(NEWLINE), "//") };
    expect(names(file.text, "reset_display_name")).toBe(true);
    expect(names(file.text, "reset_avatar")).toBe(false);
    const sqlText = withoutComments(["a.kind IN ('reset_display_name', 'reset_bio') -- 'reset_avatar'", "AND true"].join(NEWLINE), "--");
    expect(names(sqlText, "reset_avatar")).toBe(false);
    // A longer name is not the kind.
    expect(names("'reset_display_name_x'", "reset_display_name")).toBe(false);
  });
});
