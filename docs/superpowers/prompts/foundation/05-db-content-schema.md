# korbat Foundation — Task 5 of 16: `@korbat/db` identity and content tables

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a self-owned backend: a TypeScript API (Hono + Drizzle ORM) is the only client of our own Postgres 16. PII lives in a separate `auth` schema (Task 4) that the public API role cannot read. The public schema holds profiles and content, accessed by the `korbat_api` role. RLS is on for every table with a per-role policy.

Content rules that shape this schema: posts are text up to 1000 characters with up to four images; every post has a `state` (`visible`, `withheld` while under review, `removed` by a human decision, `deleted_by_author`) so nothing ever silently disappears; the feed is chronological and keyset-paginated on `(created_at, id)`; blocks must be enforceable in every read query, so they are a first-class table. `profiles.id` equals `auth.users.id` but has no foreign key across schemas, on purpose.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed.
- Pinned: drizzle-orm 0.45.2, vitest 4.1.11, typescript 5.9.3.

## Preconditions

`git log --oneline -1` must show `feat(db): auth schema tables with RLS`. `pnpm --filter @korbat/db test` passes 3 tests. If `packages/db/src/schema/content.ts` exists, compare with this prompt, fix drift, run steps 4 and 5, and report.

## Rules (read twice)

1. Copy every file below byte for byte. Keep the `(): AnyPgColumn =>` annotations; they are required for self-referencing columns.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. Cosmetic differences are fine: timings, colours, git's CRLF warnings. A different test count, any unexpected `error TS` or `FAIL` line, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it.
6. Do not modify `helpers.ts`, `auth.ts`, or the existing tests.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Files

### Append to the END of `packages/db/test/schema.test.ts` (keep everything already there)
```ts

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
```

### Create `packages/db/src/schema/identity.ts`
```ts
import { sql } from "drizzle-orm";
import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";

export const profiles = pgTable(
  "profiles",
  {
    /** Equals auth.users.id. Deliberately no cross-schema FK so korbat_api never needs auth access. */
    id: uuid("id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarPath: text("avatar_path"),
    verifiedAt: ts("verified_at"),
    reputation: integer("reputation").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [uniqueIndex("profiles_handle_lower_idx").on(sql`lower(${t.handle})`), fullAccess("profiles_api_all", apiRole)],
).enableRLS();
```

### Create `packages/db/src/schema/content.ts`
```ts
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, real, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const postState = pgEnum("post_state", ["visible", "withheld", "removed", "deleted_by_author"]);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    quoteOfId: uuid("quote_of_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    state: postState("state").notNull().default("visible"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    index("posts_created_id_idx").on(t.createdAt, t.id),
    index("posts_reply_to_idx").on(t.replyToId),
    check("posts_body_len", sql`char_length(${t.body}) <= 1000`),
    fullAccess("posts_api_all", apiRole),
  ],
).enableRLS();

export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** Random object key in the media bucket; never the original filename. */
    path: text("path").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    blurhash: text("blurhash").notNull(),
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
    (t) => [primaryKey({ columns: [t.userId, t.postId] }), index(`${name}_post_idx`).on(t.postId), fullAccess(`${name}_api_all`, apiRole)],
  ).enableRLS();
}

export const follows = userPairTable("follows", "follower_id", "followee_id");
export const blocks = userPairTable("blocks", "blocker_id", "blocked_id");
export const mutes = userPairTable("mutes", "muter_id", "muted_id");
export const likes = userPostTable("likes");
export const reposts = userPostTable("reposts");
export const bookmarks = userPostTable("bookmarks");
```

### Replace the whole content of `packages/db/src/schema/index.ts` with
```ts
export * from "./auth";
export * from "./identity";
export * from "./content";
```

## Steps

1. Append the tests to `packages/db/test/schema.test.ts`.
2. Run:
   ```bash
   pnpm --filter @korbat/db test
   ```
   Expected: `Tests  2 failed | 3 passed (5)`; the failures mention `Cannot read properties of undefined` for `posts`/`follows`. If all 5 pass, STOP.
3. Create `identity.ts` and `content.ts`; replace `index.ts`.
4. Run:
   ```bash
   pnpm --filter @korbat/db test
   ```
   Expected: `Tests  5 passed (5)`.
5. Run:
   ```bash
   pnpm --filter @korbat/db typecheck
   ```
   Expected: no `error TS` lines.
6. Commit:
   ```bash
   git add -A && git commit -m "feat(db): identity and content tables

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
7. Run `git log --oneline -1`. Expected subject: `feat(db): identity and content tables`.

## Report format (mandatory)

```
TASK 5 REPORT
Files created/modified: <list>
Step 2 output (Tests line): <paste>
Step 4 output (Tests line): <paste>
Step 5 output: <paste or "clean">
Step 7 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
