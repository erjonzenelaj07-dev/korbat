# korbat 2b — Task 5 of 17: post_media, step 2: owner, status, failure reason and creation time, with checks and indexes

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The second step gives `post_media` its lifecycle: the owner who uploaded it, a status (processing, ready, failed) with the failure reason, and the creation time. Checks keep a ready row complete and an attached row ready, and indexes serve the pending-upload count and the sweeper's queries.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(db): post_media drops its unused path column; post, position, width, height and blurhash become optional`.

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
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/05-post-media-lifecycle.md 1
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
  test("every upload has an owner, a status and a creation time; a failure has a reason", () => {
    const cols = byName.get("post_media")!.columns;
    for (const name of ["owner_id", "status", "created_at"]) expect(cols.find((c) => c.name === name)?.notNull, name).toBe(true);
    expect(cols.find((c) => c.name === "error")?.notNull).toBe(false);
    expect(cols.find((c) => c.name === "status")?.default).toBe("processing");
    expect(schema.mediaStatus.enumValues).toEqual(["processing", "ready", "failed"]);
  });
  test("the database itself refuses a ready image without dimensions and an attached image that is incomplete", () => {
    const cfg = byName.get("post_media")!;
    expect(cfg.checks.map((c) => c.name).sort()).toEqual(["post_media_alt_len", "post_media_attached_is_complete", "post_media_ready_has_dims"]);
    expect(cfg.indexes.map((i) => i.config.name).sort()).toEqual(["post_media_owner_created_idx", "post_media_post_position_idx", "post_media_status_created_idx"]);
    expect(cfg.indexes.find((i) => i.config.name === "post_media_post_position_idx")?.config.unique).toBe(true);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/db test
```

Expected: the command exits with an error, and the output contains:

- `Tests  2 failed | 16 passed (18)`

Observed on the dry run:

```text
Tests  2 failed | 16 passed (18)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/05-post-media-lifecycle.md 3
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

/** An upload is processing until the worker's result is in, then ready or failed for good. */
export const mediaStatus = pgEnum("media_status", ["processing", "ready", "failed"]);

/**
 * One uploaded image. The files live on the media-store volume under the row's id; no path is
 * stored. Only the API's media module reads or writes this table.
 */
export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who uploaded it. Only this account may attach it to a post. */
    ownerId: uuid("owner_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    status: mediaStatus("status").notNull().default("processing"),
    /** Why processing failed: one of the contracts' MediaFailure values. */
    error: text("error"),
    /** Set, together with the position, when the image is attached to a post. */
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    position: integer("position"),
    /** Of the large size, after rotation. Set, together with the blurhash, when processing succeeds. */
    width: integer("width"),
    height: integer("height"),
    blurhash: text("blurhash"),
    altText: text("alt_text"),
    /** Filled by sub-project 3. Empty until then. */
    nsfwScore: real("nsfw_score"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("post_media_post_position_idx").on(t.postId, t.position),
    index("post_media_owner_created_idx").on(t.ownerId, t.createdAt),
    index("post_media_status_created_idx").on(t.status, t.createdAt),
    check("post_media_ready_has_dims", sql`${t.status} <> 'ready' or (${t.width} is not null and ${t.height} is not null and ${t.blurhash} is not null)`),
    check("post_media_attached_is_complete", sql`${t.postId} is null or (${t.status} = 'ready' and ${t.position} between 0 and 3 and ${t.altText} is not null)`),
    check("post_media_alt_len", sql`char_length(${t.altText}) <= 1000`),
    fullAccess("post_media_api_all", apiRole),
  ],
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

- `Tests  18 passed (18)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  18 passed (18)
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

## Step 6: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `Your SQL migration file`

Must not contain:

- `renamed`

Allowed difference: drizzle-kit names the migration file with a random adjective and a hero name, and a hero name can contain an underscore (the run in this repository got `0006_nifty_blue_shield.sql`), so the file name differs from the dry run. Any name of that shape is correct; do not rename it.

Observed on the dry run:

```text
[✓] Your SQL migration file ➜ migrations\0006_abandoned_sleeper.sql 🚀
```

## Step 7: verify: migration-counts

```bash
f=$(ls packages/db/migrations/0006_*.sql); echo "file: $f"; echo "enum types: $(grep -c 'CREATE TYPE "public"."media_status"' "$f")"; echo "added columns: $(grep -c 'ADD COLUMN' "$f")"; echo "foreign keys: $(grep -c 'FOREIGN KEY ("owner_id")' "$f")"; echo "indexes: $(grep -c 'CREATE INDEX' "$f")"; echo "checks: $(grep -c 'ADD CONSTRAINT .* CHECK' "$f")"; echo "drops: $(grep -ci 'DROP' "$f")"
```

Expected output contains:

- `enum types: 1`
- `added columns: 4`
- `foreign keys: 1`
- `indexes: 2`
- `checks: 3`
- `drops: 0`

Observed on the dry run:

```text
enum types: 1
added columns: 4
foreign keys: 1
indexes: 2
checks: 3
drops: 0
```

## Step 8: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations'
```

Expected output contains:

- `migrations applied`
- `7`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
7
```

## Step 9: verify: test-database

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

## Step 10: verify: checks-live

```bash
q() { docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat_test -tAc "$1" 2>&1; }; q "insert into profiles (id, handle, display_name) values ('00000000-0000-4000-8000-000000000001', 'schema_check', 'Schema check')" >/dev/null; echo "ready without dimensions: $(q "insert into post_media (owner_id, status) values ('00000000-0000-4000-8000-000000000001', 'ready')" | grep -o 'post_media_ready_has_dims' | head -1)"; echo "processing row: $(q "insert into post_media (owner_id) values ('00000000-0000-4000-8000-000000000001') returning status" | head -1)"; echo "long alt text: $(q "insert into post_media (owner_id, alt_text) values ('00000000-0000-4000-8000-000000000001', repeat('a', 1001))" | grep -o 'post_media_alt_len' | head -1)"; q "delete from profiles where id = '00000000-0000-4000-8000-000000000001'" >/dev/null; echo "rows left: $(q 'select count(*) from post_media')"
```

Expected output contains:

- `ready without dimensions: post_media_ready_has_dims`
- `processing row: processing`
- `long alt text: post_media_alt_len`
- `rows left: 0`

Observed on the dry run:

```text
ready without dimensions: post_media_ready_has_dims
processing row: processing
long alt text: post_media_alt_len
rows left: 0
```

## Step 11: verify: api-typecheck

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

## Step 12: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `packages/db/migrations/0006_<adjective>_<hero>.sql`
- `packages/db/migrations/meta/0006_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/content.ts`
- `packages/db/test/schema.test.ts`

Allowed difference: drizzle-kit names each generated migration with its number, a random adjective and a hero name, so that file's name differs from the dry run. Any name of that shape is correct; do not rename it.

## Step 13: commit

```bash
git add -A
git commit -q -m "feat(db): post_media gains owner, status, failure reason and creation time; checks for ready and attached rows; indexes for pending counts and the sweeper" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(db): post_media gains owner, status, failure reason and creation time; checks for ready and attached rows; indexes for pending counts and the sweeper`.

## Report format (mandatory)

```text
TASK 5 REPORT
Files written: <count, expected 2>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "migration-counts": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "checks-live": <paste the expected lines as printed>
Verify "api-typecheck": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
