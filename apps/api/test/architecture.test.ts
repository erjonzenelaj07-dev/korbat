import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Module boundaries (1a spec section 2.2, 2a spec section 2.2, 3a design section 5, 3c design section 5). Paths are relative to apps/api/src
 * with forward slashes. The rules are plain functions so the tests below can prove each one catches
 * a deliberate violation.
 */
interface SourceFile {
  path: string;
  source: string;
}

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA_ROOT = fileURLToPath(new URL("../../../packages/db/src/schema", import.meta.url));

/** Schema files that define auth-schema objects or shared helpers; every other schema file is public. */
const NON_PUBLIC_SCHEMA_FILES = new Set(["auth.ts", "helpers.ts", "index.ts"]);
const AUTH_SCHEMA_FILE = "auth.ts";
// The command lines open both pools: grant-role changes a role on the auth pool, and staff.js reads there the staff keys
// that audit-verify checks the record against.
const AUTH_POOL_ALLOWED = new Set(["config.ts", "index.ts", "cli/grant-role.ts", "cli/staff.ts"]);
const AUTH_KEYS_ALLOWED = new Set(["config.ts"]);

/** Modules that may only be entered through their index file. 3d Task 4 adds the seventh, transparency; 3b Task 4 the eighth, imports. */
const MODULES = ["auth", "social", "media", "account", "staff", "moderation", "transparency", "imports"] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function loadSources(): SourceFile[] {
  return walk(SRC_ROOT).map((full) => ({ path: relative(SRC_ROOT, full).split(sep).join("/"), source: readFileSync(full, "utf8") }));
}

function exportedNames(file: string): string[] {
  const source = readFileSync(join(SCHEMA_ROOT, file), "utf8");
  return [...source.matchAll(/^export (?:const|function|type|interface|enum) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
}

/** Names exported by the public-schema files of @korbat/db (tables and enums the auth module must not touch). */
function publicSchemaNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SCHEMA_ROOT)) {
    if (!file.endsWith(".ts") || NON_PUBLIC_SCHEMA_FILES.has(file)) continue;
    for (const name of exportedNames(file)) names.add(name);
  }
  return names;
}

/** Names exported by the auth-schema file of @korbat/db (tables and enums the social module must not touch). */
function authSchemaNames(): Set<string> {
  return new Set(exportedNames(AUTH_SCHEMA_FILE));
}

/** Every module specifier in static imports, re-exports, side-effect imports and dynamic imports. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]!);
}

/** Named bindings of every `import { ... } from "@korbat/db"`; a namespace import yields the marker "*". */
function dbImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/\bimport\s+(type\s+)?(\*\s+as\s+\w+|\{[^}]*\})\s+from\s+["'](@korbat\/db(?:\/[^"']*)?)["']/g)) {
    const bindings = match[2]!;
    if (bindings.startsWith("*")) {
      names.push("*");
      continue;
    }
    for (const part of bindings.slice(1, -1).split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

const insideAuth = (path: string) => path.startsWith("auth/");
const insideSocial = (path: string) => path.startsWith("social/");
const insideMedia = (path: string) => path.startsWith("media/");
const insideAccount = (path: string) => path.startsWith("account/");
const insideStaff = (path: string) => path.startsWith("staff/");
const insideModeration = (path: string) => path.startsWith("moderation/");
const insideImports = (path: string) => path.startsWith("imports/");

function findViolations(files: SourceFile[], publicNames: Set<string>, authNames: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/\.ts$/, "");
      for (const module of MODULES) {
        if (path.startsWith(`${module}/`)) continue;
        if (target.startsWith(`${module}/`) && target !== `${module}/index`) {
          violations.push(`${path}: imports ${spec}, which is inside the ${module} module (use ./${module})`);
        }
      }
    }
    if (!insideAuth(path) && !AUTH_POOL_ALLOWED.has(path) && /\b(DATABASE_URL_AUTH|authDb)\b/.test(source)) {
      violations.push(`${path}: references the auth database pool`);
    }
    // Each encryption key with the list of the keys it replaced: after a rotation those still open what was stored before it.
    if (!insideAuth(path) && !AUTH_KEYS_ALLOWED.has(path) && /\b(TOTP_ENC_KEY|TOTP_ENC_KEYS_PREVIOUS|NOTIFIER_ENC_KEY|NOTIFIER_ENC_KEYS_PREVIOUS|AUTH_HMAC_KEY|IP_HASH_KEY)\b/.test(source)) {
      violations.push(`${path}: references an auth key`);
    }
    if (insideAuth(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import auth-schema names explicitly)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db`);
      }
    }
    if (!insideMedia(path) && /\b(postMedia|post_media)\b/.test(source)) {
      violations.push(`${path}: references post_media, which only the media module may touch`);
    }
    // 3d Task 7 (design, section 5): the three tables of the migration known_material are the media module's too.
    if (!insideMedia(path)) {
      for (const name of new Set([...source.matchAll(/(?<![A-Za-z0-9_])(mediaHashes|media_hashes|mediaMatches|media_matches|uploadRefusals|upload_refusals)(?![A-Za-z0-9_])/g)].map((m) => m[1]!))) {
        violations.push(`${path}: references ${name}, which only the media module may touch`);
      }
    }
    // The staff module (role korbat_api) reads and writes the public audit log; staff keys, staff sessions and enrolments
    // are credentials, the auth module's alone (3a design, section 5). The moderation module owns the moderation tables on
    // the same role: a notifier's contact and the staff links live in the auth schema, out of its reach (3c design, section 5).
    // 3b: the imports module too, which asks the auth module whether an address is verified (design, section 4.2).
    if (insideSocial(path) || insideMedia(path) || insideStaff(path) || insideModeration(path) || insideImports(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import public-schema names explicitly)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db`);
      }
    }
    // The account module sequences the other three through their index files and holds no table access of its own
    // (1b spec, section 5): no table or enum of either schema may be named in it. Db and DbTx, which are not schema
    // names, stay allowed, since a transaction is passed through it.
    if (insideAccount(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (the account module holds no table access)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db (the account module holds no table access)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db (the account module holds no table access)`);
      }
    }
    // The staff module uses the auth module's interface as the other modules do, never its repository or its session
    // store, which would hand it the auth tables; the moderation module likewise. Any mention counts, so a renamed,
    // namespace or dynamic import is caught as surely as a named one.
    if (insideStaff(path) || insideModeration(path)) {
      const module = insideStaff(path) ? "staff" : "moderation";
      for (const name of new Set([...source.matchAll(/\b(createAuthRepo|createSessions)\b/g)].map((m) => m[1]!))) {
        violations.push(`${path}: uses the auth module's ${name} (the ${module} module goes through the auth module's interface)`);
      }
    }
  }
  return violations;
}

/**
 * The source pins of the freeze (3c design, sections 6.1 and 6.5). The freeze of the path for suspected child sexual abuse
 * material holds only while every path of a kind passes one gate, so who may name what is pinned here, beside the
 * database's own pins of who names the predicate there:
 *   - `post_frozen` is named only in the media repository and the moderation repository, and `frozen_for` nowhere in the
 *     API: no other file decides by itself what is frozen;
 *   - a delete of `post_media` is written only in the media repository, whose every delete the keep trigger judges and
 *     whose every answer names only rows that are gone;
 *   - `requestDeletion` (asking the worker to delete an image's files) and `openImage` (opening an image file of the
 *     store) are named in a pinned list of files, each a pinned number of times, comments included: a new caller of
 *     either fails the test until whoever adds it has checked it against the gates and listed it.
 */
const POST_FROZEN_ALLOWED = new Set(["media/repo.ts", "moderation/repo.ts"]);
const POST_MEDIA_DELETE_ALLOWED = new Set(["media/repo.ts"]);
const POST_MEDIA_DELETE = /\bdelete\s+from\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?post_media\b|\btruncate\b[^;`]*\bpost_media\b|\.delete\(\s*postMedia\b/i;

function findFreezeViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (/\bfrozen_for\b/.test(source)) violations.push(`${path}: names frozen_for, which only the database's own functions name`);
    if (/\bpost_frozen\b/.test(source) && !POST_FROZEN_ALLOWED.has(path)) violations.push(`${path}: names post_frozen, which only the media and moderation repositories may`);
    if (POST_MEDIA_DELETE.test(source) && !POST_MEDIA_DELETE_ALLOWED.has(path)) violations.push(`${path}: deletes from post_media, which only the media repository may`);
  }
  return violations;
}

/** Every file that names `name` as a whole word, with how often, comments included. */
function mentions(files: SourceFile[], name: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const { path, source } of files) {
    // Cut at every word boundary: a whole word is then a piece of its own.
    const count = source.split(/\b/).filter((piece) => piece === name).length;
    if (count > 0) found[path] = count;
  }
  return found;
}

/**
 * Where `requestDeletion` is named. A deletion request names an id that a delete of post_media answered, an upload that
 * failed before it could be put on a post, or a file that has no row: the files module writes the request; the upload's
 * removal, the sweeper, the author's deletion (after its commit), the account's purge (after its commit) and the
 * disposal's caller (after its commit) ask for it through the module's interfaces; and the one retry of what the purge
 * and the disposal owe asks for it only for a row that is gone. 3b Task 5: the imports module's interface asks for the
 * files of an import's rows on no post after the commit that deleted them (media.forImports.releaseFiles), and the
 * imports module itself names it nowhere. 3b Task 6: the undo's batches, the author's deletion path, ask for the files of
 * the rows they detached after each commit (social/flows/imports.ts).
 */
const REQUEST_DELETION = {
  "account/flows/deletion.ts": 1,
  "media/cases.ts": 4,
  "media/context.ts": 2,
  "media/files.ts": 1,
  "media/flows/remove.ts": 1,
  // 3b Task 5: one more, mediaForImports' releaseFiles.
  "media/index.ts": 6,
  // The retry of owed deletions, which asks only for ids whose row it found gone.
  "media/owed.ts": 1,
  "media/sweeper.ts": 2,
  // The retention job, which asks for a batch's files after the commit of the transaction that deleted their rows.
  "moderation/retention.ts": 1,
  "social/context.ts": 1,
  // 3b Task 6: the undo's batches ask for the files of the image rows they detached, after each commit (6.5).
  "social/flows/imports.ts": 1,
  "social/flows/posts.ts": 1,
};

/**
 * Where `openImage` is named: the files module, which opens a file of the store under its checks, and its three callers,
 * each behind its own reader's rule: serve (gate S), the export's open (which reads the row again) and the staff's image
 * (gate V).
 */
const OPEN_IMAGE = {
  "media/cases.ts": 1,
  "media/files.ts": 1,
  "media/flows/serve.ts": 1,
  "media/index.ts": 1,
};

describe("the freeze's source pins", () => {
  test("apps/api/src names post_frozen only in the two repositories, frozen_for nowhere, and deletes from post_media only in the media repository", () => {
    expect(findFreezeViolations(loadSources())).toEqual([]);
    // The media repository does name the predicate and does delete: the pins are about a file that exists.
    const repo = loadSources().find((file) => file.path === "media/repo.ts")!;
    expect(repo.source).toMatch(/\bpost_frozen\b/);
    expect(POST_MEDIA_DELETE.test(repo.source)).toBe(true);
  });

  test("catches the predicate named outside the two repositories, and its core named anywhere", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "sql`select public.post_frozen(m.post_id) as frozen from post_media m`" },
      { path: "moderation/repo.ts", source: "sql`select not public.post_frozen(${postId}::uuid) as images_allowed`" },
      { path: "moderation/cases.ts", source: "const [row] = await tx.execute(sql`select public.post_frozen(${postId}::uuid) as frozen`);" },
      { path: "media/flows/serve.ts", source: "const frozen = await db.execute(sql`select post_frozen(${postId})`);" },
      { path: "staff/cases.ts", source: "await db.execute(sql`select public.frozen_for(${postId}::uuid, ${authorId}::uuid)`);" },
      { path: "media/repo.ts", source: "sql`select public.frozen_for(m.post_id, m.owner_id) from post_media m`" },
      // Another word that only contains the name is not the name.
      { path: "social/views.ts", source: "const post_frozen_label = 1; const unfrozen_for_now = 2;" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "moderation/cases.ts: names post_frozen, which only the media and moderation repositories may",
      "media/flows/serve.ts: names post_frozen, which only the media and moderation repositories may",
      "staff/cases.ts: names frozen_for, which only the database's own functions name",
      "media/repo.ts: names frozen_for, which only the database's own functions name",
    ]);
  });

  test("catches a delete of post_media outside the media repository, in SQL and through the query builder", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "await tx.execute(sql`delete from post_media where id in (select id from post_media where post_id = ${postId}::uuid order by id for update) returning id`);\nawait db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/sweeper.ts", source: "await db.execute(sql`delete from post_media where post_id is null and created_at < ${before}`);" },
      { path: "media/flows/remove.ts", source: "await deps.db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/cases.ts", source: 'await tx.execute(sql`DELETE FROM "public"."post_media" WHERE "id" = ${id}`);' },
      { path: "media/index.ts", source: "await tx.execute(sql`truncate table post_media cascade`);" },
      // Reading and updating image rows, and deleting something else, is not a delete of image rows.
      { path: "media/flows/status.ts", source: "await db.update(postMedia).set({ status }).where(eq(postMedia.id, id));\nawait db.delete(posts).where(eq(posts.id, id));\nconst rows = await db.execute(sql`select id from post_media`);" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "media/sweeper.ts: deletes from post_media, which only the media repository may",
      "media/flows/remove.ts: deletes from post_media, which only the media repository may",
      "media/cases.ts: deletes from post_media, which only the media repository may",
      "media/index.ts: deletes from post_media, which only the media repository may",
    ]);
  });

  test("requestDeletion and openImage are named in exactly the pinned files, each the pinned number of times", () => {
    expect(mentions(loadSources(), "requestDeletion")).toEqual(REQUEST_DELETION);
    expect(mentions(loadSources(), "openImage")).toEqual(OPEN_IMAGE);
  });

  test("catches a new caller of either, in a file of the list and in one outside it", () => {
    const real = loadSources();
    // A second request in the purge's flow, and a first one in a file that had none.
    const withCallers = real
      .map((file) => (file.path === "account/flows/deletion.ts" ? { ...file, source: `${file.source}\nawait deps.media.requestDeletion(kept);` } : file))
      .concat([{ path: "moderation/decide.ts", source: "await deps.media.requestDeletion(ids);" }]);
    expect(mentions(withCallers, "requestDeletion")).not.toEqual(REQUEST_DELETION);
    expect(mentions(withCallers, "requestDeletion")).toMatchObject({ "account/flows/deletion.ts": 2, "moderation/decide.ts": 1 });
    // A fourth opener of the store's files.
    const withOpener = real.concat([{ path: "staff/cases.ts", source: 'const file = await files.openImage(id, "large");' }]);
    expect(mentions(withOpener, "openImage")).not.toEqual(OPEN_IMAGE);
    // A name that only contains the word is not counted.
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "requestDeletion")).toEqual({});
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "openImage")).toEqual({});
  });
});

/**
 * The source pins of account sanctions (3e design, sections 11 and 12.2; invariant 23): no write of an account is added
 * without the one predicate.
 *   - The predicate's three fragments, exported by lib/standing.ts (`liveNotSuspended`, and the two halves that a locking
 *     statement answers separately, `suspendedAt` and `reportsRestrictedAt`), are named in a pinned list of files, each a
 *     pinned number of times, comments included, as REQUEST_DELETION is: whoever adds a write on behalf of an account adds
 *     its site to the list, and the auth module never names one. So is the closing judgment (`closingJudgment`, 3e's
 *     review), the last statement of a write's transaction, which reads both halves.
 *   - The profile's three derived columns are named in apps/api/src only in lib/standing.ts, social/repo.ts's
 *     lockAccounts and the moderation module's standing-repo.ts, in SQL or by drizzle's names: no other file decides by
 *     itself whether an account is suspended. Their one writer is the database's standing_apply (the function pin of 6.6).
 */
const STANDING_PREDICATE = {
  // social/repo.ts, 3e Task 6: Explore's round applies the predicate to the candidates' authors and to the engagers at the
  // round's time, and the page and the chip to the authors at the read's (explorePage, listedInExplore).
  // imports/repo.ts, 3b Task 4 (design, section 8.5): the one statement that creates an import, as media/repo.ts's upload
  // row names it (its import and its use).
  liveNotSuspended: { "imports/repo.ts": 2, "lib/standing.ts": 1, "media/repo.ts": 2, "profiles/store.ts": 3, "social/repo.ts": 6 },
  // social/repo.ts, 3e Task 6: the author's Explore status reads whether the author is suspended (exploreFacts). lib/standing.ts,
  // 3e's review: the closing judgment reads both halves.
  suspendedAt: { "lib/standing.ts": 3, "social/repo.ts": 7 },
  reportsRestrictedAt: { "lib/standing.ts": 2, "social/repo.ts": 2 },
  // 3e's review (database1): the writes that end with the closing judgment: the social repository's (judgeActing), the
  // upload's row, and the intake of a report under a rule. The profile store's badge and the profile's edit end with
  // their UPDATE, made once the row is held.
  // 3b Task 4: and the creation of an import (imports/repo.ts, its import and its use).
  closingJudgment: { "imports/repo.ts": 2, "lib/standing.ts": 1, "media/repo.ts": 2, "moderation/intake.ts": 2, "social/repo.ts": 2 },
};
const STANDING_COLUMNS_ALLOWED = new Set(["lib/standing.ts", "social/repo.ts", "moderation/standing-repo.ts"]);
const STANDING_COLUMNS = ["suspended_from", "suspended_until", "reports_restricted_until", "suspendedFrom", "suspendedUntil", "reportsRestrictedUntil"];
/** Whether a file names one of the derived columns as a whole word, by the same cut as `mentions`. */
const namesStandingColumn = (file: SourceFile): boolean => STANDING_COLUMNS.some((name) => mentions([file], name)[file.path] !== undefined);

function findStandingViolations(files: SourceFile[]): string[] {
  return files.filter((file) => namesStandingColumn(file) && !STANDING_COLUMNS_ALLOWED.has(file.path)).map(({ path }) => `${path}: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may`);
}

describe("the source pins of account sanctions (3e)", () => {
  test("the predicate's fragments are named in exactly the pinned files, each the pinned number of times; the auth module names none", () => {
    for (const [name, pinned] of Object.entries(STANDING_PREDICATE)) expect(mentions(loadSources(), name), name).toEqual(pinned);
    // The auth module names none: no file of it is in any of the pinned lists.
    for (const pinned of Object.values(STANDING_PREDICATE)) expect(Object.keys(pinned).filter((path) => path.startsWith("auth/"))).toEqual([]);
  });

  test("catches a new write that names the predicate, in a pinned file and in one outside the list", () => {
    const real = loadSources();
    const withWrites = real
      .map((file) => (file.path === "media/repo.ts" ? { ...file, source: file.source + String.fromCharCode(10) + 'sql`update post_media set alt = null where ${liveNotSuspended("p", WRITE_CLOCK)}`;' } : file))
      .concat([{ path: "moderation/texts.ts", source: 'await tx.execute(sql`select 1 from profiles p where ${suspendedAt("p", WRITE_CLOCK)}`);' }]);
    expect(mentions(withWrites, "liveNotSuspended")).not.toEqual(STANDING_PREDICATE.liveNotSuspended);
    expect(mentions(withWrites, "liveNotSuspended")).toMatchObject({ "media/repo.ts": 3 });
    expect(mentions(withWrites, "suspendedAt")).toMatchObject({ "moderation/texts.ts": 1 });
    expect(mentions(withWrites, "suspendedAt")).not.toEqual(STANDING_PREDICATE.suspendedAt);
  });

  test("the three derived columns are named only in lib/standing.ts, social/repo.ts and moderation/standing-repo.ts, and lib/standing.ts does name them", () => {
    expect(findStandingViolations(loadSources())).toEqual([]);
    expect(namesStandingColumn(loadSources().find((file) => file.path === "lib/standing.ts")!)).toBe(true);
  });

  test("catches a derived column named elsewhere, in SQL and by drizzle's name", () => {
    const files: SourceFile[] = [
      { path: "lib/standing.ts", source: "sql`(${p}.suspended_from is not null and ${p}.suspended_from <= ${at} and ${at} < ${p}.suspended_until)`" },
      { path: "moderation/standing-repo.ts", source: "sql`select reports_restricted_until from profiles`" },
      { path: "social/flows/posts.ts", source: "const [row] = await db.execute(sql`select suspended_until from profiles where id = ${viewer}::uuid`);" },
      { path: "media/repo.ts", source: "await db.select({ until: profiles.suspendedUntil }).from(profiles);" },
      { path: "auth/flows/badge.ts", source: "if (profile.reportsRestrictedUntil) return;" },
      // A word that only contains the name is not the name.
      { path: "social/views.ts", source: "const unsuspended_from_now = 1;" },
    ];
    expect(findStandingViolations(files)).toEqual([
      "social/flows/posts.ts: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may",
      "media/repo.ts: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may",
      "auth/flows/badge.ts: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may",
    ]);
  });
});

/**
 * The watcher's boundary (3f design, section 5): notify, an entry point of its own (dist/notify.js), imports the contracts,
 * the database package and Node's and its packages' modules, and nothing of the API's: no relative import leaves
 * src/notify. Nothing outside it imports it either: the API holds no mailbox credential, no ntfy token and no route to the
 * push network, and the watcher shares no code with the API that could carry one in.
 */
function findNotifyViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    const inside = path.startsWith("notify/");
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec));
      if (inside && !target.startsWith("notify/")) violations.push(`${path}: imports ${spec}, outside the watcher`);
      if (!inside && target.startsWith("notify/")) violations.push(`${path}: imports ${spec}, inside the watcher`);
    }
  }
  return violations;
}

describe("the watcher's boundary (3f)", () => {
  test("src/notify imports nothing of the API's modules, and nothing imports src/notify", () => {
    const files = loadSources();
    expect(files.filter((file) => file.path.startsWith("notify/")).map((file) => file.path).sort()).toEqual(["notify/imap.ts", "notify/main.ts", "notify/push.ts"]);
    expect(findNotifyViolations(files)).toEqual([]);
  });

  test("catches an import of an API module from the watcher, and an import of the watcher from the API", () => {
    expect(
      findNotifyViolations([
        { path: "notify/main.ts", source: 'import { loadConfig } from "../config"; import { publish } from "./push";' },
        { path: "notify/push.ts", source: 'import { staffAlert } from "../moderation";' },
        { path: "moderation/alerts.ts", source: 'import { TOPICS } from "../notify/push";' },
        { path: "index.ts", source: 'import { ALERT_KINDS } from "@korbat/contracts";' },
      ]),
    ).toEqual(["notify/main.ts: imports ../config, outside the watcher", "notify/push.ts: imports ../moderation, outside the watcher", "moderation/alerts.ts: imports ../notify/push, inside the watcher"]);
  });
});

/**
 * The hand-over's boundary (3f design, section 5 and invariant 16): handover.ts, an entry point of its own
 * (dist/handover.js), imports nothing under ./ (no module of the API, so no database, no configuration and no copy of
 * anything that could reach either) and only Node's own modules, none of which opens a socket or a process; nothing
 * imports it. And no file outside media/ but config.ts and index.ts names the store's directory setting, MEDIA_STORE_DIR:
 * the store is read through the media module, or by the hand-over's program under its fixed mount.
 */
const SOCKET_MODULES = new Set(["node:net", "node:http", "node:https", "node:http2", "node:dgram", "node:tls", "node:child_process", "node:worker_threads", "node:cluster"]);
function findHandoverViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (path === "handover.ts") {
        if (spec.startsWith(".")) violations.push(`${path}: imports ${spec}, a module of the API`);
        else if (!spec.startsWith("node:")) violations.push(`${path}: imports ${spec}, which is not one of Node's own modules`);
        else if (SOCKET_MODULES.has(spec)) violations.push(`${path}: imports ${spec}, which can open a socket or a process`);
      } else if (spec.startsWith(".") && posix.normalize(posix.join(posix.dirname(path), spec)).replace(/[.]ts$/, "") === "handover") {
        violations.push(`${path}: imports ${spec}, the hand-over's program`);
      }
    }
    if (/MEDIA_STORE_DIR/.test(source) && !path.startsWith("media/") && path !== "config.ts" && path !== "index.ts") {
      violations.push(`${path}: names MEDIA_STORE_DIR, which only the media module, config.ts and index.ts may`);
    }
  }
  return violations;
}

describe("the hand-over's boundary (3f Task 5)", () => {
  test("handover.ts imports only Node's own modules and none that opens a socket, nothing imports it, and no file outside media/ but config.ts and index.ts names the store's directory setting", () => {
    const files = loadSources();
    expect(files.map((file) => file.path)).toContain("handover.ts");
    expect(findHandoverViolations(files)).toEqual([]);
  });

  test("catches an import of an API module or a package from the hand-over, a socket's module, an import of the hand-over, and the store's setting named elsewhere", () => {
    expect(
      findHandoverViolations([
        { path: "handover.ts", source: 'import { storedImageName } from "./media"; import { sql } from "drizzle-orm"; import { connect } from "node:net"; import { crc32 } from "node:zlib";' },
        { path: "cli/records.ts", source: 'import { zipStored } from "../handover";' },
        { path: "cli/staff.ts", source: "const dir = env.MEDIA_STORE_DIR;" },
        { path: "media/files.ts", source: "const dir = config.MEDIA_STORE_DIR;" },
      ]),
    ).toEqual([
      "handover.ts: imports ./media, a module of the API",
      "handover.ts: imports drizzle-orm, which is not one of Node's own modules",
      "handover.ts: imports node:net, which can open a socket or a process",
      "cli/records.ts: imports ../handover, the hand-over's program",
      "cli/staff.ts: names MEDIA_STORE_DIR, which only the media module, config.ts and index.ts may",
    ]);
  });
});

/**
 * The quarantine's mover (3d design, section 5 "The services"; 12.1 rows 13 and 14): quarantine.ts, an entry point of its
 * own (dist/quarantine.js), is as bare as the hand-over: it imports nothing under ./ and only Node's own modules, none
 * that opens a socket or a process, and nothing imports it.
 */
function findQuarantineViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (path === "quarantine.ts") {
        if (spec.startsWith(".")) violations.push(`${path}: imports ${spec}, a module of the API`);
        else if (!spec.startsWith("node:")) violations.push(`${path}: imports ${spec}, which is not one of Node's own modules`);
        else if (SOCKET_MODULES.has(spec)) violations.push(`${path}: imports ${spec}, which can open a socket or a process`);
      } else if (spec.startsWith(".") && posix.normalize(posix.join(posix.dirname(path), spec)).replace(/[.]ts$/, "") === "quarantine") {
        violations.push(`${path}: imports ${spec}, the quarantine's mover`);
      }
    }
  }
  return violations;
}

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LF = String.fromCharCode(10);

/** The service blocks of a Compose file's services section, by name, as text: from a service's name to the next one's. */
function composeServices(text: string): Map<string, string> {
  const head = `${LF}services:${LF}`;
  const section = text.slice(text.indexOf(head) + head.length - 1);
  // The section ends at the next top-level key.
  const end = section.slice(1).search(new RegExp(`${LF}[a-z][a-z0-9_-]*:`));
  const body = end === -1 ? section : section.slice(0, end + 1);
  const blocks = new Map<string, string>();
  const names = [...body.matchAll(new RegExp(`${LF} {2}([a-z][a-z0-9_-]*):${LF}`, "g"))];
  names.forEach((match, i) => blocks.set(match[1]!, body.slice(match.index!, names[i + 1]?.index ?? body.length)));
  return blocks;
}

/**
 * Who mounts the quarantine (3d design, section 5; 12.1 row 14): in compose.yml only `quarantine`, read-write, and
 * `handover`, read-only, name the volume media-quarantine, and compose.dev.yml names it nowhere, so neither the api, the
 * migrate nor the worker service mounts it. The mover has no network, no environment, every capability dropped, a
 * read-only root and the two volumes alone; the worker keeps network_mode: none.
 */
function findComposeViolations(compose: string, dev: string): string[] {
  const violations: string[] = [];
  const services = composeServices(compose);
  for (const [name, block] of services) {
    const mounts = block.split(LF).filter((line) => line.includes("media-quarantine"));
    if (mounts.length === 0) continue;
    const expected = name === "quarantine" ? "- media-quarantine:/media/quarantine" : name === "handover" ? "- media-quarantine:/media/quarantine:ro" : null;
    if (expected === null) violations.push(`compose.yml: ${name} names media-quarantine`);
    else if (mounts.map((line) => line.trim()).join("|") !== expected) violations.push(`compose.yml: ${name} mounts media-quarantine otherwise than ${expected}`);
  }
  for (const [name, block] of composeServices(dev)) {
    if (block.includes("media-quarantine")) violations.push(`compose.dev.yml: ${name} names media-quarantine`);
  }
  const mover = services.get("quarantine");
  if (!mover) violations.push("compose.yml: no service quarantine");
  else {
    for (const line of ["network_mode: none", "read_only: true", "cap_drop: [ALL]", '"no-new-privileges:true"', 'profiles: ["quarantine"]', 'entrypoint: ["node", "dist/quarantine.js", "/media/store", "/media/quarantine"]']) {
      if (!mover.includes(line)) violations.push(`compose.yml: quarantine lacks ${line}`);
    }
    for (const key of ["environment:", "env_file:", "networks:", "ports:", "secrets:"]) {
      if (mover.includes(key)) violations.push(`compose.yml: quarantine has ${key}`);
    }
    const volumes = mover
      .split(LF)
      .filter((line) => /^ {6}- /.test(line))
      .map((line) => line.trim());
    if (volumes.join("|") !== "- media-store:/media/store|- media-quarantine:/media/quarantine") violations.push(`compose.yml: quarantine mounts ${volumes.join(", ")}`);
  }
  if (!services.get("worker")?.includes("network_mode: none")) violations.push("compose.yml: worker has a network");
  violations.push(...findImporterViolations(services, composeServices(dev)));
  return violations;
}

/** A service's lines that are not comments: what Compose reads of it. */
const serviceLines = (block: string): string[] => block.split(LF).filter((line) => !line.trim().startsWith("#"));
/** The lines of a service that name one of the two import volumes. */
const importMounts = (block: string): string[] => serviceLines(block).filter((line) => line.includes("import-archives") || line.includes("import-work")).map((line) => line.trim());

/**
 * 3b (design, section 7.1; decision 1): the importer parses archives people upload, hostile input. Like the worker it has
 * no network and no capability; it reads import-archives read-only and writes import-work, and the API mounts the two
 * the other way round. No other service names either volume, and the development file names neither.
 */
function findImporterViolations(services: Map<string, string>, dev: Map<string, string>): string[] {
  const violations: string[] = [];
  const expected: Record<string, string> = {
    importer: "- import-archives:/import/archives:ro|- import-work:/import/work",
    api: "- import-archives:/import/archives|- import-work:/import/work:ro",
  };
  for (const [name, block] of services) {
    const mounts = importMounts(block);
    if (mounts.length === 0 && expected[name] === undefined) continue;
    if (expected[name] === undefined) violations.push(`compose.yml: ${name} names an import volume`);
    else if (mounts.join("|") !== expected[name]) violations.push(`compose.yml: ${name} mounts the import volumes otherwise than ${expected[name]}`);
  }
  for (const [name, block] of dev) {
    if (importMounts(block).length > 0) violations.push(`compose.dev.yml: ${name} names an import volume`);
  }
  const importer = services.get("importer");
  if (!importer) return [...violations, "compose.yml: no service importer"];
  const lines = serviceLines(importer).map((line) => line.trim());
  for (const line of ["network_mode: none", "cap_drop: [ALL]"]) if (!lines.includes(line)) violations.push(`compose.yml: importer lacks ${line}`);
  for (const key of ["networks:", "ports:", "env_file:", "secrets:"]) if (lines.some((line) => line.startsWith(key))) violations.push(`compose.yml: importer has ${key}`);
  return violations;
}

describe("the quarantine's boundary (3d Task 1)", () => {
  test("quarantine.ts imports only Node's own modules and none that opens a socket, and nothing imports it", () => {
    const files = loadSources();
    expect(files.map((file) => file.path)).toContain("quarantine.ts");
    expect(findQuarantineViolations(files)).toEqual([]);
  });

  test("catches an import of an API module or a package from the mover, a socket's module, and an import of the mover", () => {
    expect(
      findQuarantineViolations([
        { path: "quarantine.ts", source: 'import { storedImageName } from "./media"; import { z } from "zod"; import { request } from "node:https"; import { open } from "node:fs/promises";' },
        { path: "cli/custody.ts", source: 'import { runQuarantine } from "../quarantine";' },
      ]),
    ).toEqual([
      "quarantine.ts: imports ./media, a module of the API",
      "quarantine.ts: imports zod, which is not one of Node's own modules",
      "quarantine.ts: imports node:https, which can open a socket or a process",
      "cli/custody.ts: imports ../quarantine, the quarantine's mover",
    ]);
  });

  test("only quarantine (read-write) and handover (read-only) mount media-quarantine; the mover is bare and the worker keeps no network", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    const dev = readFileSync(join(REPO_ROOT, "infra", "compose.dev.yml"), "utf8");
    expect([...composeServices(compose).keys()]).toEqual(expect.arrayContaining(["api", "migrate", "worker", "importer", "handover", "quarantine"]));
    expect(findComposeViolations(compose, dev)).toEqual([]);
  });

  test("catches the volume in the api or the development file, a writable hand-over and a mover with an environment", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    const dev = readFileSync(join(REPO_ROOT, "infra", "compose.dev.yml"), "utf8");
    const broken = compose
      .replace(`      - media-store:/media/store:ro${LF}      - media-quarantine:/media/quarantine:ro`, `      - media-store:/media/store:ro${LF}      - media-quarantine:/media/quarantine`)
      .replace(`      - media-uploads:/media/uploads${LF}`, `      - media-uploads:/media/uploads${LF}      - media-quarantine:/media/quarantine:ro${LF}`)
      .replace(`    profiles: ["quarantine"]${LF}`, `    profiles: ["quarantine"]${LF}    environment:${LF}      X: "1"${LF}`);
    const devBroken = dev.replace(`  api:${LF}`, `  api:${LF}    volumes: [media-quarantine:/media/quarantine]${LF}`);
    expect(findComposeViolations(broken, devBroken)).toEqual([
      "compose.yml: api names media-quarantine",
      "compose.yml: handover mounts media-quarantine otherwise than - media-quarantine:/media/quarantine:ro",
      "compose.dev.yml: api names media-quarantine",
      "compose.yml: quarantine has environment:",
    ]);
  });

  test("3b: catches an importer with a network or a writable archive volume, an import volume in another service or in the development file", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    const dev = readFileSync(join(REPO_ROOT, "infra", "compose.dev.yml"), "utf8");
    const broken = compose
      .replace(`      - import-archives:/import/archives:ro${LF}`, `      - import-archives:/import/archives${LF}`)
      .replace(`      dockerfile: apps/importer/Dockerfile${LF}    network_mode: none${LF}`, `      dockerfile: apps/importer/Dockerfile${LF}    networks: [app]${LF}`)
      .replace(`      - media-uploads:/media/uploads:ro${LF}      - media-store:/media/store${LF}`, `      - media-uploads:/media/uploads:ro${LF}      - media-store:/media/store${LF}      - import-work:/import/work:ro${LF}`);
    const devBroken = dev.replace(`  api:${LF}`, `  api:${LF}    volumes: [import-archives:/import/archives]${LF}`);
    expect(findComposeViolations(broken, devBroken)).toEqual([
      "compose.yml: worker names an import volume",
      "compose.yml: importer mounts the import volumes otherwise than - import-archives:/import/archives:ro|- import-work:/import/work",
      "compose.dev.yml: api names an import volume",
      "compose.yml: importer lacks network_mode: none",
      "compose.yml: importer has networks:",
    ]);
    expect(findComposeViolations(compose.replace(`${LF}  importer:${LF}`, `${LF}  importer2:${LF}`), dev)).toEqual(["compose.yml: importer2 names an import volume", "compose.yml: no service importer"]);
  });
});

/**
 * The adapters' files (3d design, section 5 "The adapters"): each adapter is a file of its own that imports nothing of its
 * module, so it is given what its interface names and nothing more: no media file, no repository and no database. Task
 * 3 builds the first, the edge's purge (media/edge-adapter.ts), and Task 5 the head's witness (transparency/witness.ts);
 * the matcher's (media/match-adapter.ts) joins this list with the task that builds it. A package import that is no
 * database stays allowed: the adapter reads its numbers from the contracts.
 */
const ADAPTER_FILES = ["media/edge-adapter.ts", "transparency/witness.ts", "media/match-adapter.ts"];
function findAdapterViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!ADAPTER_FILES.includes(path)) continue;
    for (const spec of specifiers(source)) {
      if (spec.startsWith(".")) violations.push(`${path}: imports ${spec}, a file of the API`);
      else if (spec.startsWith("@korbat/db")) violations.push(`${path}: imports ${spec}, the database`);
    }
  }
  return violations;
}

describe("the adapters' files (3d Task 3)", () => {
  test("each adapter's file exists and imports nothing of its module, no repository and no database", () => {
    const files = loadSources();
    for (const path of ADAPTER_FILES) expect(files.map((file) => file.path), path).toContain(path);
    expect(findAdapterViolations(files)).toEqual([]);
  });

  test("catches an adapter that imports the media repository, a module's file, its index or the database", () => {
    expect(
      findAdapterViolations([
        { path: "media/edge-adapter.ts", source: 'import { createMediaRepo } from "./repo"; import type { MediaDeps } from "./context"; import { postMedia } from "@korbat/db"; import { EDGE_RULES } from "@korbat/contracts";' },
        { path: "media/edge.ts", source: 'import { createMediaRepo } from "./repo";' },
      ]),
    ).toEqual(["media/edge-adapter.ts: imports ./repo, a file of the API", "media/edge-adapter.ts: imports ./context, a file of the API", "media/edge-adapter.ts: imports @korbat/db, the database"]);
    expect(findAdapterViolations([{ path: "media/edge-adapter.ts", source: 'import { media } from "../media";' }])).toEqual(["media/edge-adapter.ts: imports ../media, a file of the API"]);
    // Task 5: the witness's file imports nothing of the transparency module, no repository and no database.
    expect(
      findAdapterViolations([
        { path: "transparency/witness.ts", source: 'import { createTransparencyRepo } from "./repo"; import { headPublications } from "@korbat/db"; import { HEAD_RULES } from "@korbat/contracts";' },
        { path: "transparency/head.ts", source: 'import { createTransparencyRepo } from "./repo";' },
      ]),
    ).toEqual(["transparency/witness.ts: imports ./repo, a file of the API", "transparency/witness.ts: imports @korbat/db, the database"]);
    // Task 7: the matcher's file imports nothing of the media module, no repository and no database: it is given hashes.
    expect(
      findAdapterViolations([
        { path: "media/match-adapter.ts", source: 'import { createMatchRepo } from "./match-repo"; import { mediaHashes } from "@korbat/db"; import { MATCH_FIXTURES } from "@korbat/media-protocol";' },
        { path: "media/match.ts", source: 'import { createMatchRepo } from "./match-repo";' },
      ]),
    ).toEqual(["media/match-adapter.ts: imports ./match-repo, a file of the API", "media/match-adapter.ts: imports @korbat/db, the database"]);
  });
});

describe("the known material's tables (3d Task 7)", () => {
  test("only the media module names media_hashes, media_matches or upload_refusals, by table or by schema name", () => {
    const files: SourceFile[] = [
      { path: "moderation/uploads.ts", source: "await tx.execute(sql`select 1 from public.upload_refusals`);" },
      { path: "moderation/automated-repo.ts", source: 'import { mediaMatches } from "@korbat/db"; const q = "media_matches";' },
      { path: "cli/automation.ts", source: "sql`select count(*) from public.media_hashes`" },
      { path: "media/match-repo.ts", source: "sql`select 1 from public.media_hashes join public.media_matches on true join public.upload_refusals on true`" },
      // A column of releases and a step-up's target type are no table's name.
      { path: "moderation/release.ts", source: "sql`select r.upload_refusal_id from public.releases r`; const target = 'upload_refusal';" },
    ];
    expect(findViolations(files, new Set(["mediaMatches"]), new Set())).toEqual([
      "moderation/uploads.ts: references upload_refusals, which only the media module may touch",
      "moderation/automated-repo.ts: references mediaMatches, which only the media module may touch",
      "moderation/automated-repo.ts: references media_matches, which only the media module may touch",
      "cli/automation.ts: references media_hashes, which only the media module may touch",
    ]);
  });
});

/**
 * The transparency module (3d design, section 5, "The architecture test"; Task 4): it reads no session and no table of a
 * person, so a file under transparency/ imports from @korbat/db no schema name but those of schema/transparency.ts (Task 5
 * adds head_publications there) and the audit head, and no namespace of it. Db and DbTx, which are no schema names, stay
 * allowed.
 */
const TRANSPARENCY_SCHEMA_FILE = "transparency.ts";
const TRANSPARENCY_EXTRA_NAMES = new Set(["auditHead"]);

function findTransparencyViolations(files: SourceFile[], schemaNames: Set<string>, allowed: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!path.startsWith("transparency/")) continue;
    for (const name of dbImports(source)) {
      if (name === "*") violations.push(`${path}: namespace import of @korbat/db (the transparency module names its own tables only)`);
      else if (schemaNames.has(name) && !allowed.has(name)) violations.push(`${path}: imports ${name} from @korbat/db, which is no table of the public figures`);
    }
  }
  return violations;
}

describe("the transparency module's tables (3d Task 4)", () => {
  const schemaNames = () => new Set([...publicSchemaNames(), ...authSchemaNames()]);
  const allowed = () => new Set([...exportedNames(TRANSPARENCY_SCHEMA_FILE), ...TRANSPARENCY_EXTRA_NAMES]);

  test("the module exists, and its files name no table of @korbat/db but the public figures' three and the audit head", () => {
    const files = loadSources();
    expect(files.map((file) => file.path)).toContain("transparency/index.ts");
    expect([...allowed()].sort()).toEqual(["auditHead", "headPublications", "recipientMonths", "transparencyEditions"]);
    expect(findTransparencyViolations(files, schemaNames(), allowed())).toEqual([]);
  });

  test("catches a table of a person, an auth table and a namespace import, and allows its own tables, the head and the pool's types", () => {
    const files: SourceFile[] = [
      { path: "transparency/repo.ts", source: `import { transparencyEditions, recipientMonths, auditHead, decisions, type Db, type DbTx } from "@korbat/db";` },
      { path: "transparency/editions.ts", source: `import type { sessions } from "@korbat/db";` },
      { path: "transparency/recipients.ts", source: `import * as db from "@korbat/db";` },
      { path: "transparency/routes.ts", source: `import { profiles as p } from "@korbat/db";` },
      { path: "moderation/repo.ts", source: `import { decisions } from "@korbat/db";` },
    ];
    expect(findTransparencyViolations(files, new Set(["transparencyEditions", "recipientMonths", "auditHead", "decisions", "sessions", "profiles"]), new Set(["transparencyEditions", "recipientMonths", "auditHead"]))).toEqual([
      "transparency/repo.ts: imports decisions from @korbat/db, which is no table of the public figures",
      "transparency/editions.ts: imports sessions from @korbat/db, which is no table of the public figures",
      "transparency/recipients.ts: namespace import of @korbat/db (the transparency module names its own tables only)",
      "transparency/routes.ts: imports profiles from @korbat/db, which is no table of the public figures",
    ]);
  });

  test("catches a deep import into the transparency module, from the app, the auth module and the command line", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import type { Transparency } from "./transparency";
import { transparencyRoutes } from "./transparency/routes";` },
      { path: "auth/middleware.ts", source: `import type { TransparencyForAuth } from "../transparency";
import { createRecipientCounter } from "../transparency/recipients";` },
      { path: "cli/figures.ts", source: `import { createTransparencyRepo } from "../transparency/repo";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./transparency/routes, which is inside the transparency module (use ./transparency)",
      "auth/middleware.ts: imports ../transparency/recipients, which is inside the transparency module (use ./transparency)",
      "cli/figures.ts: imports ../transparency/repo, which is inside the transparency module (use ./transparency)",
    ]);
  });
});

describe("module boundaries", () => {
  test("walks the real source tree", () => {
    const paths = loadSources().map((f) => f.path);
    expect(paths).toContain("auth/index.ts");
    expect(paths).toContain("social/index.ts");
    expect(paths).toContain("media/index.ts");
    expect(paths).toContain("account/index.ts");
    expect(paths).toContain("staff/index.ts");
    expect(paths).toContain("moderation/index.ts");
    expect(paths).toContain("transparency/index.ts");
    expect(paths).toContain("cli/staff.ts");
    expect(paths).toContain("app.ts");
    expect(publicSchemaNames()).toContain("profiles");
    expect(publicSchemaNames()).not.toContain("users");
    expect(authSchemaNames()).toContain("users");
    expect(authSchemaNames()).not.toContain("posts");
  });

  test("apps/api/src has no boundary violations", () => {
    expect(findViolations(loadSources(), publicSchemaNames(), authSchemaNames())).toEqual([]);
  });

  test("allows the module indexes, the permitted pool owners and each module's own schema", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createAuth } from "./auth";\nimport type { Auth } from "./auth/index";\nimport { createSocial } from "./social";` },
      { path: "profiles/store.ts", source: `import { isUniqueViolation } from "../auth";` },
      { path: "cli/grant-role.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "index.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "config.ts", source: `AUTH_HMAC_KEY: base64Key, IP_HASH_KEY: base64Key, TOTP_ENC_KEY: versionedKey, DATABASE_URL_AUTH: url` },
      { path: "auth/repo.ts", source: `import { users, sessions, type Db } from "@korbat/db";\nconst k = config.TOTP_ENC_KEY;` },
      { path: "social/repo.ts", source: `import { posts, profiles, type Db } from "@korbat/db";\nimport { SocialError } from "./context";` },
      { path: "social/routes.ts", source: `import type { Auth } from "../auth";` },
      { path: "index.ts", source: `import { createAccount } from "./account";\nimport { createMedia } from "./media";` },
      { path: "account/routes.ts", source: `import type { AuthForAccount } from "../auth";\nimport type { SocialForAccount } from "../social";\nimport { buildExport } from "./flows/export";` },
      { path: "account/flows/deletion.ts", source: `import type { DbTx } from "@korbat/db";\nimport type { MediaForAccount } from "../../media";` },
      { path: "cli/staff.ts", source: `import { createStaff } from "../staff";\nconst authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `import { auditHead, auditLog, profiles, type Db, type DbTx } from "@korbat/db";` },
      { path: "staff/routes.ts", source: `import { AuthError, type Auth } from "../auth";\nimport { staffGate } from "./gate";` },
      { path: "staff/cases.ts", source: `import { ModerationError, type ModerationForStaff } from "../moderation";` },
      { path: "index.ts", source: `import { createModeration } from "./moderation";\nimport { socialForModeration } from "./social";` },
      { path: "moderation/repo.ts", source: `import { cases, decisions, evidenceSnapshots, intakes, type Db, type DbTx } from "@korbat/db";\nimport { ModerationError } from "./context";` },
      { path: "moderation/decide.ts", source: `import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";\nimport { boundLockWaits } from "../lib/lock-bounds";\nimport type { SocialForModeration } from "../social";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts", "auditLog", "auditHead", "cases", "decisions", "evidenceSnapshots", "intakes"]), new Set(["users", "sessions"]))).toEqual([]);
  });

  test("catches a deep import into the auth module", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `import { hashPassword } from "../auth/passwords";` },
      { path: "app.ts", source: `export { createSessions } from "./auth/sessions.ts";\nconst m = await import("./auth/repo");` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: imports ../auth/passwords, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/sessions.ts, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/repo, which is inside the auth module (use ./auth)",
    ]);
  });

  test("catches a deep import into the social module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createSocialRepo } from "./social/repo";` },
      { path: "auth/flows/signup.ts", source: `import { createPost } from "../../social/flows/posts";` },
      { path: "social/flows/graph.ts", source: `import { ownProfile } from "./posts";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./social/repo, which is inside the social module (use ./social)",
      "auth/flows/signup.ts: imports ../../social/flows/posts, which is inside the social module (use ./social)",
    ]);
  });

  test("catches a deep import into the media module, post_media outside it, and the auth schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createMediaRepo } from "./media/repo";\nimport { createMedia } from "./media";` },
      { path: "social/repo.ts", source: `import { postMedia, posts } from "@korbat/db";` },
      { path: "social/views.ts", source: "const rows = await db.execute(sql`select * from post_media`);" },
      { path: "media/repo.ts", source: `import { postMedia, posts, users, type Db } from "@korbat/db";` },
      { path: "media/flows/serve.ts", source: `import type { MediaDeps } from "../context";` },
    ];
    expect(findViolations(files, new Set(["posts", "postMedia"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./media/repo, which is inside the media module (use ./media)",
      "social/repo.ts: references post_media, which only the media module may touch",
      "social/views.ts: references post_media, which only the media module may touch",
      "media/repo.ts: imports auth-schema users from @korbat/db",
    ]);
  });

  test("catches a deep import into the account module, and a table or enum of either schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createZipWriter } from "./account/zip";\nimport { createAccount } from "./account";` },
      { path: "social/flows/graph.ts", source: `import { buildExport } from "../../account/flows/export";` },
      { path: "account/flows/export.ts", source: `import { posts, users, type DbTx } from "@korbat/db";` },
      { path: "account/purge.ts", source: `import * as db from "@korbat/db";` },
      { path: "account/zip.ts", source: `import type { Db } from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./account/zip, which is inside the account module (use ./account)",
      "social/flows/graph.ts: imports ../../account/flows/export, which is inside the account module (use ./account)",
      "account/flows/export.ts: imports public-schema posts from @korbat/db (the account module holds no table access)",
      "account/flows/export.ts: imports auth-schema users from @korbat/db (the account module holds no table access)",
      "account/purge.ts: namespace import of @korbat/db (the account module holds no table access)",
    ]);
  });

  test("catches auth pool and auth key references outside their owners", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `const url = config.DATABASE_URL_AUTH;` },
      { path: "profiles/store.ts", source: `export function f(authDb: Db) {}` },
      { path: "lib/hash.ts", source: `const key = config.IP_HASH_KEY;` },
      { path: "index.ts", source: `const k = config.AUTH_HMAC_KEY;` },
      // The key a notifier's name and address are encrypted under is the auth module's too: the moderation module, which
      // names contacts by their ids, never sees it.
      { path: "moderation/intake.ts", source: `const key = deps.config.NOTIFIER_ENC_KEY;` },
      // The keys a key replaced are guarded as the key is: a contact is never encrypted again, so after a rotation they are
      // the only keys of every contact stored before it. The TOTP key's earlier keys likewise.
      { path: "moderation/context.ts", source: `const older = config.NOTIFIER_ENC_KEYS_PREVIOUS;` },
      { path: "staff/routes.ts", source: `const older = config.TOTP_ENC_KEYS_PREVIOUS;` },
      // A longer name that only contains a key's name is not the key; config.ts and the auth module may name every key.
      { path: "lib/names.ts", source: `const MY_NOTIFIER_ENC_KEY_NAME = 1; const NOTIFIER_ENC_KEYS = 2; const TOTP_ENC_KEYS_PREVIOUSLY = 3;` },
      { path: "config.ts", source: `NOTIFIER_ENC_KEY: versionedKey, NOTIFIER_ENC_KEYS_PREVIOUS: z.string(), TOTP_ENC_KEYS_PREVIOUS: z.string(),` },
      { path: "auth/context.ts", source: `notifierKey: parseVersionedKey(config.NOTIFIER_ENC_KEY), notifierPreviousKeys: config.NOTIFIER_ENC_KEYS_PREVIOUS.map(parseVersionedKey),` },
      // The staff command line may open the auth pool; another command line, or the staff module itself, may not.
      { path: "cli/other.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `export function readKeys(authDb: Db) {}` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: references the auth database pool",
      "profiles/store.ts: references the auth database pool",
      "lib/hash.ts: references an auth key",
      "index.ts: references an auth key",
      "moderation/intake.ts: references an auth key",
      "moderation/context.ts: references an auth key",
      "staff/routes.ts: references an auth key",
      "cli/other.ts: references the auth database pool",
      "staff/audit.ts: references the auth database pool",
    ]);
  });

  test("catches a deep import into the staff module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { staffGate } from "./staff/gate";\nimport { createStaff } from "./staff";` },
      { path: "cli/staff.ts", source: `import { canonicalText } from "../staff/chain";` },
      { path: "auth/staff/flows.ts", source: `import { appendAuditRow } from "../../staff/audit";` },
      { path: "staff/routes.ts", source: `import { staffGate } from "./gate";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./staff/gate, which is inside the staff module (use ./staff)",
      "cli/staff.ts: imports ../staff/chain, which is inside the staff module (use ./staff)",
      "auth/staff/flows.ts: imports ../../staff/audit, which is inside the staff module (use ./staff)",
    ]);
  });

  test("catches auth-schema imports inside the staff module", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { auditLog, staffKeys, type Db } from "@korbat/db";` },
      { path: "staff/reader.ts", source: `import type { staffSessions as s } from "@korbat/db";` },
      { path: "staff/writer.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["auditLog"]), new Set(["staffKeys", "staffSessions"]))).toEqual([
      "staff/audit.ts: imports auth-schema staffKeys from @korbat/db",
      "staff/reader.ts: imports auth-schema staffSessions from @korbat/db",
      "staff/writer.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });

  test("catches the auth module's repository or session store inside the staff module, however it is imported", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { AuthError, createAuthRepo } from "../auth";` },
      { path: "staff/routes.ts", source: `import { createSessions as sessionsOf } from "../auth";` },
      { path: "staff/flows/x.ts", source: `import * as auth from "../../auth";\nconst repo = auth.createAuthRepo(db);\nconst s = auth.createSessions(deps);` },
      { path: "staff/flows/y.ts", source: `const { createSessions } = await import("../../auth");` },
      // Outside the staff module the rule does not apply: the command lines build the auth module's parts themselves.
      { path: "cli/grant-role.ts", source: `import { createAuthRepo, createSessions } from "../auth";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "staff/audit.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/routes.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/y.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
    ]);
  });

  test("catches a deep import into the moderation module, from outside it and from another module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { decide } from "./moderation/decide";\nimport { createModeration } from "./moderation";` },
      { path: "staff/cases.ts", source: `import { ModerationError } from "../moderation/context";` },
      { path: "social/views.ts", source: `import { authorFacts } from "../moderation/repo";` },
      { path: "cli/staff.ts", source: `const { recordIntake } = await import("../moderation/intake");` },
      { path: "moderation/decide.ts", source: `import { ModerationError } from "./context";\nimport { insertDecision } from "./repo";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./moderation/decide, which is inside the moderation module (use ./moderation)",
      "staff/cases.ts: imports ../moderation/context, which is inside the moderation module (use ./moderation)",
      "social/views.ts: imports ../moderation/repo, which is inside the moderation module (use ./moderation)",
      "cli/staff.ts: imports ../moderation/intake, which is inside the moderation module (use ./moderation)",
    ]);
  });

  test("catches the moderation module reaching into another module, naming post_media, or opening the auth pool", () => {
    const files: SourceFile[] = [
      { path: "moderation/intake.ts", source: `import { createSocialRepo } from "../social/repo";` },
      { path: "moderation/decide.ts", source: `import { verifyStepUp } from "../auth/staff/step-up";` },
      { path: "moderation/repo.ts", source: `import { cases, postMedia, type Db } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: "const rows = await tx.execute(sql`select id from post_media where post_id = ${postId}`);" },
      { path: "moderation/context.ts", source: `export interface ModerationDeps { authDb: Db }` },
    ];
    expect(findViolations(files, new Set(["cases", "postMedia"]), new Set())).toEqual([
      "moderation/intake.ts: imports ../social/repo, which is inside the social module (use ./social)",
      "moderation/decide.ts: imports ../auth/staff/step-up, which is inside the auth module (use ./auth)",
      "moderation/repo.ts: references post_media, which only the media module may touch",
      "moderation/cases.ts: references post_media, which only the media module may touch",
      "moderation/context.ts: references the auth database pool",
    ]);
  });

  test("catches auth-schema imports inside the moderation module, and the auth module's repository or session store", () => {
    const files: SourceFile[] = [
      { path: "moderation/repo.ts", source: `import { decisions, notifierContacts, type Db } from "@korbat/db";` },
      { path: "moderation/decide.ts", source: `import type { staffPersonalAccounts as links, users } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: `import * as db from "@korbat/db";` },
      { path: "moderation/intake.ts", source: `import { createAuthRepo } from "../auth";` },
      { path: "moderation/reveal.ts", source: `const { createSessions } = await import("../auth");` },
    ];
    expect(findViolations(files, new Set(["decisions"]), new Set(["notifierContacts", "staffPersonalAccounts", "users"]))).toEqual([
      "moderation/repo.ts: imports auth-schema notifierContacts from @korbat/db",
      "moderation/decide.ts: imports auth-schema staffPersonalAccounts from @korbat/db",
      "moderation/decide.ts: imports auth-schema users from @korbat/db",
      "moderation/cases.ts: namespace import of @korbat/db (import public-schema names explicitly)",
      "moderation/intake.ts: uses the auth module's createAuthRepo (the moderation module goes through the auth module's interface)",
      "moderation/reveal.ts: uses the auth module's createSessions (the moderation module goes through the auth module's interface)",
    ]);
  });

  test("catches public-schema imports inside the auth module", () => {
    const files: SourceFile[] = [
      { path: "auth/repo.ts", source: `import { users, profiles as p, type Db } from "@korbat/db";` },
      { path: "auth/flows/x.ts", source: `import type { posts } from "@korbat/db";` },
      { path: "auth/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]), new Set())).toEqual([
      "auth/repo.ts: imports public-schema profiles from @korbat/db",
      "auth/flows/x.ts: imports public-schema posts from @korbat/db",
      "auth/flows/y.ts: namespace import of @korbat/db (import auth-schema names explicitly)",
    ]);
  });

  test("catches auth-schema imports inside the social module", () => {
    const files: SourceFile[] = [
      { path: "social/repo.ts", source: `import { posts, users as u, type Db } from "@korbat/db";` },
      { path: "social/flows/x.ts", source: `import type { sessions } from "@korbat/db";` },
      { path: "social/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users", "sessions"]))).toEqual([
      "social/repo.ts: imports auth-schema users from @korbat/db",
      "social/flows/x.ts: imports auth-schema sessions from @korbat/db",
      "social/flows/y.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });
});

/**
 * 3d review H3: the recipients' count (the day's salt and the sketches of accounts and readers) lives in a Valkey of its
 * own that writes nothing to disk, never in the shared one, whose append-only file keeps every write. In the API the
 * transparency module is given one store, `counts`, which index.ts builds from COUNTS_URL alone, and no file of the
 * module names the shared client or REDIS_URL. In compose.yml the service `counts` runs the redis service's own pinned
 * image with persistence off, on the data network alone, with no volume and no published port, and the API's COUNTS_URL
 * names it.
 */
function findCountsViolations(files: SourceFile[], compose: string): string[] {
  const violations: string[] = [];
  const index = files.find((file) => file.path === "index.ts")?.source ?? "";
  if (!/const counts = new Redis[(]config[.]COUNTS_URL,/.test(index)) violations.push("index.ts: builds no counts client from COUNTS_URL");
  const call = /createTransparency[(][{]([^}]*)[}][)]/.exec(index)?.[1] ?? "";
  if (!/(^|[ ,])counts([ ,]|$)/.test(call) || /(^|[ ,])redis([ ,:]|$)/.test(call)) violations.push(`index.ts: createTransparency is given ${call.trim()}`);
  for (const { path, source } of files) {
    if (!path.startsWith("transparency/")) continue;
    if (/REDIS_URL|[^a-zA-Z]redis[^a-zA-Z]/.test(source.replace(/import type Redis from "ioredis";/, ""))) violations.push(`${path}: names the shared Valkey`);
  }
  const services = composeServices(compose);
  const counts = services.get("counts");
  const image = (block: string | undefined) => /^ {4}image: (.+)$/m.exec(block ?? "")?.[1];
  if (!counts) violations.push("compose.yml: no service counts");
  else {
    if (image(counts) === undefined || image(counts) !== image(services.get("redis"))) violations.push("compose.yml: counts runs another image than redis");
    for (const flag of ["--appendonly no", "--save ''", "--requirepass $$REDIS_PASSWORD"]) if (!counts.includes(flag)) violations.push(`compose.yml: counts lacks ${flag}`);
    for (const key of ["volumes:", "ports:", "env_file:"]) if (counts.includes(key)) violations.push(`compose.yml: counts has ${key}`);
    if (!counts.includes("networks: [data]")) violations.push("compose.yml: counts is not on the data network alone");
  }
  if (!services.get("api")?.includes("COUNTS_URL: redis://:${REDIS_PASSWORD}@counts:6379")) violations.push("compose.yml: the api's COUNTS_URL does not name counts");
  return violations;
}

describe("the recipients' count keeps nothing on disk (3d review H3)", () => {
  test("the transparency module is given the counts store alone, built from COUNTS_URL; compose's counts writes nothing to disk", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    expect(findCountsViolations(loadSources(), compose)).toEqual([]);
  });

  test("catches the shared client handed to the module, a volume, persistence and another image", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    const files = loadSources().map((file) => (file.path === "index.ts" ? { ...file, source: file.source.replace(/createTransparency[(][{]([^}]*)[}][)]/, "createTransparency({ apiDb, redis, auth: auth.forTransparency, config, logger })") } : file));
    const counts = composeServices(compose).get("counts") ?? "";
    // A function as the replacement, so the dollar signs of the block stay as they are.
    const broken = compose.replace(counts, () => counts.replace("--appendonly no", "--appendonly yes").replace("    networks: [data]", `    volumes:${LF}      - valkeydata:/data${LF}    networks: [data]`));
    expect(findCountsViolations(files, broken)).toEqual([
      "index.ts: createTransparency is given apiDb, redis, auth: auth.forTransparency, config, logger",
      "compose.yml: counts lacks --appendonly no",
      "compose.yml: counts has volumes:",
    ]);
  });
});
