# korbat 2b — Task 4 of 17: post_media, step 1: drop the unused path column and make the attachment and dimension columns optional

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Foundation created `post_media` for a different design (a path into object storage). The table changes in two migrations because drizzle-kit asks questions interactively when one migration both drops and adds columns. This first step drops the unused path column and makes the attachment and dimension columns optional, since a row now exists from the upload on, before any post or processed size.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(media-protocol): limits per format, UUID-only volume layout, strict result files, and sniffers for formats, HEIC, animation and APNG`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/04-post-media-relax.md 1
```

Expected: 1 line starting with `wrote`, one for each file below.

### Replace `packages/db/test/schema.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/schema/index";

const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
const byName = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));

describe("auth schema", () => {
  test("auth tables live in the auth schema", () => {
    for (const name of ["users", "devices", "sessions", "email_codes", "passkeys", "auth_events"]) {
      expect(byName.get(name)?.schema, name).toBe("auth");
    }
  });
  test("sessions store only a hash id and carry both expiries", () => {
    const cols = byName.get("sessions")!.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "user_id", "device_id", "expires_at", "absolute_expires_at", "reauth_at", "revoked_at"]));
  });
});

describe("row level security", () => {
  test("every table has RLS enabled and at least one policy", () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      expect(cfg.enableRLS, cfg.name).toBe(true);
      expect(cfg.policies.length, cfg.name).toBeGreaterThan(0);
    }
  });
});

describe("content schema", () => {
  test("posts carry a state enum and a body length check", () => {
    const cfg = byName.get("posts")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(cfg.columns.find((c) => c.name === "state")?.notNull).toBe(true);
    expect(cfg.checks.map((c) => c.name)).toContain("posts_body_len");
  });
  test("join tables have composite primary keys", () => {
    for (const name of ["follows", "likes", "reposts", "bookmarks", "blocks", "mutes"]) {
      expect(byName.get(name)!.primaryKeys.length, name).toBe(1);
      expect(byName.get(name)!.primaryKeys[0]!.columns.length, name).toBe(2);
    }
  });
});

describe("trust and safety schema", () => {
  test("there are 21 tables in total", () => {
    expect(tables.length).toBe(21);
  });
  test("transparency_log carries no user identifiers", () => {
    const cols = byName.get("transparency_log")!.columns.map((c) => c.name);
    for (const c of cols) expect(c, c).not.toMatch(/user|author|moderator|reporter/);
  });
  test("audit_log policies allow only insert and select", () => {
    const kinds = byName.get("audit_log")!.policies.map((p) => p.for).sort();
    expect(kinds).toEqual(["insert", "select"]);
  });
  test("one appeal per case", () => {
    const idx = byName.get("appeals")!.indexes.find((i) => i.config.name === "appeals_case_idx");
    expect(idx?.config.unique).toBe(true);
  });
});

describe("identity and auth 1a", () => {
  test("users carry role, age, terms, onboarding and TOTP replay columns", () => {
    const cols = byName.get("users")!.columns;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["role", "age_confirmed_at", "terms_version", "terms_accepted_at", "onboarded_at", "password_changed_at", "totp_last_step"]),
    );
    expect(cols.find((c) => c.name === "role")?.notNull).toBe(true);
  });
  test("email codes are bound to a unique flow id", () => {
    const cfg = byName.get("email_codes")!;
    expect(cfg.columns.find((c) => c.name === "flow_id")?.notNull).toBe(true);
    expect(cfg.indexes.find((i) => i.config.name === "email_codes_flow_idx")?.config.unique).toBe(true);
  });
  test("auth_events policies allow only insert and select", () => {
    expect(byName.get("auth_events")?.policies.map((p) => p.for).sort()).toEqual(["insert", "select"]);
  });
  test("email code purposes include reauth", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("reauth");
  });
});

describe("posting and feed 2a", () => {
  test("posts and profiles carry non-negative counters, and posts a deletion time", () => {
    const posts = byName.get("posts")!;
    const postCols = posts.columns.map((c) => c.name);
    expect(postCols).toEqual(expect.arrayContaining(["like_count", "repost_count", "reply_count", "quote_count", "deleted_at"]));
    for (const name of ["like_count", "repost_count", "reply_count", "quote_count"]) {
      expect(posts.columns.find((c) => c.name === name)?.notNull, name).toBe(true);
    }
    expect(posts.checks.map((c) => c.name)).toContain("posts_counts_nonnegative");
    const profiles = byName.get("profiles")!;
    expect(profiles.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["follower_count", "following_count", "post_count"]));
    expect(profiles.checks.map((c) => c.name)).toContain("profiles_counts_nonnegative");
  });
  test("per-account engagement lists and quote lookups have indexes", () => {
    for (const name of ["likes", "reposts", "bookmarks"]) {
      const idx = byName.get(name)!.indexes.find((i) => i.config.name === `${name}_user_created_idx`);
      expect(idx?.config.columns.length, name).toBe(2);
    }
    expect(byName.get("posts")!.indexes.map((i) => i.config.name)).toContain("posts_quote_of_idx");
  });
});

describe("images 2b", () => {
  test("post_media has no path column, and its attachment and dimension columns are optional", () => {
    const cols = byName.get("post_media")!.columns;
    expect(cols.map((c) => c.name)).not.toContain("path");
    for (const name of ["post_id", "position", "width", "height", "blurhash"]) {
      expect(cols.find((c) => c.name === name)?.notNull, name).toBe(false);
    }
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/db test
```

Expected: the command exits with an error, and the output contains:

- `Tests  1 failed | 15 passed (16)`

Observed on the dry run:

```text
Tests  1 failed | 15 passed (16)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/04-post-media-relax.md 3
```

Expected: 1 line starting with `wrote`, one for each file below.

### Replace `packages/db/src/schema/content.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, real, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const postState = pgEnum("post_state", ["visible", "withheld", "removed", "deleted_by_author"]);

/** A counter kept exact by the application: updated in the same transaction as the action it counts. */
const counter = (name: string) => integer(name).notNull().default(0);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    quoteOfId: uuid("quote_of_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    state: postState("state").notNull().default("visible"),
    likeCount: counter("like_count"),
    repostCount: counter("repost_count"),
    /** Replies that are not deleted. */
    replyCount: counter("reply_count"),
    /** Quotes that are not deleted. */
    quoteCount: counter("quote_count"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Set together with state = 'deleted_by_author'; the body is blanked at the same time. */
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    index("posts_created_id_idx").on(t.createdAt, t.id),
    index("posts_reply_to_idx").on(t.replyToId),
    index("posts_quote_of_idx").on(t.quoteOfId),
    check("posts_body_len", sql`char_length(${t.body}) <= 1000`),
    check("posts_counts_nonnegative", sql`${t.likeCount} >= 0 and ${t.repostCount} >= 0 and ${t.replyCount} >= 0 and ${t.quoteCount} >= 0`),
    fullAccess("posts_api_all", apiRole),
  ],
).enableRLS();

export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Set, together with the position, when the image is attached to a post. */
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    position: integer("position"),
    /** Of the large size, after rotation. Set, together with the blurhash, when processing succeeds. */
    width: integer("width"),
    height: integer("height"),
    blurhash: text("blurhash"),
    altText: text("alt_text"),
    nsfwScore: real("nsfw_score"),
  },
  (t) => [uniqueIndex("post_media_post_position_idx").on(t.postId, t.position), fullAccess("post_media_api_all", apiRole)],
).enableRLS();

/** user -> user relation table (follows, blocks, mutes). */
function userPairTable(name: string, from: string, to: string) {
  return pgTable(
    name,
    {
      fromId: uuid(from).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      toId: uuid(to).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.fromId, t.toId] }),
      index(`${name}_to_idx`).on(t.toId),
      check(`${name}_not_self`, sql`${t.fromId} <> ${t.toId}`),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

/** user -> post relation table (likes, reposts, bookmarks). */
function userPostTable(name: string) {
  return pgTable(
    name,
    {
      userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
      postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.postId] }),
      index(`${name}_post_idx`).on(t.postId),
      /** Per-account lists (your likes, your bookmarks) and the reposts half of the Following timeline. */
      index(`${name}_user_created_idx`).on(t.userId, t.createdAt),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

export const follows = userPairTable("follows", "follower_id", "followee_id");
export const blocks = userPairTable("blocks", "blocker_id", "blocked_id");
export const mutes = userPairTable("mutes", "muter_id", "muted_id");
export const likes = userPostTable("likes");
export const reposts = userPostTable("reposts");
export const bookmarks = userPostTable("bookmarks");
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/db test
```

Expected output contains:

- `Tests  16 passed (16)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  16 passed (16)
```

## Step 5: verify: typecheck

```bash
pnpm --filter @korbat/db typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 6: verify: post-media-empty

```bash
echo "post_media rows: $(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from post_media')"
```

Expected output contains:

- `post_media rows: 0`

Observed on the dry run:

```text
post_media rows: 0
```

## Step 7: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `Your SQL migration file`

Must not contain:

- `renamed`

Allowed difference: drizzle-kit names the migration file with two random words, so the file name differs from the dry run. Any name of that shape is correct; do not rename it.

Observed on the dry run:

```text
[✓] Your SQL migration file ➜ migrations\0005_opposite_puma.sql 🚀
```

## Step 8: verify: migration-counts

```bash
f=$(ls packages/db/migrations/0005_*.sql); echo "file: $f"; echo "dropped columns: $(grep -c 'DROP COLUMN "path"' "$f")"; echo "made optional: $(grep -c 'DROP NOT NULL' "$f")"; echo "added columns: $(grep -c 'ADD COLUMN' "$f")"; echo "statements: $(grep -c 'ALTER TABLE "post_media"' "$f")"
```

Expected output contains:

- `dropped columns: 1`
- `made optional: 5`
- `added columns: 0`
- `statements: 6`

Observed on the dry run:

```text
dropped columns: 1
made optional: 5
added columns: 0
statements: 6
```

## Step 9: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations'
```

Expected output contains:

- `migrations applied`
- `6`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
6
```

## Step 10: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Must not contain:

- `failed`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 11: verify: columns-live

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat_test -tAc "select string_agg(column_name || ':' || is_nullable, ' ' order by column_name) from information_schema.columns where table_schema='public' and table_name='post_media'"
```

Expected output contains:

- `alt_text:YES blurhash:YES height:YES id:NO nsfw_score:YES position:YES post_id:YES width:YES`

Observed on the dry run:

```text
alt_text:YES blurhash:YES height:YES id:NO nsfw_score:YES position:YES post_id:YES width:YES
```

## Step 12: verify: api-typecheck

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 13: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `packages/db/migrations/0005_<two random words>.sql`
- `packages/db/migrations/meta/0005_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/content.ts`
- `packages/db/test/schema.test.ts`

Allowed difference: drizzle-kit names each generated migration with its number and two random words, so that file's name differs from the dry run. Any name of that shape is correct; do not rename it.

## Step 14: commit

```bash
git add -A
git commit -q -m "feat(db): post_media drops its unused path column; post, position, width, height and blurhash become optional" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(db): post_media drops its unused path column; post, position, width, height and blurhash become optional`.

## Report format (mandatory)

```text
TASK 4 REPORT
Files written: <count, expected 2>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "post-media-empty": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "migration-counts": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "columns-live": <paste the expected lines as printed>
Verify "api-typecheck": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
