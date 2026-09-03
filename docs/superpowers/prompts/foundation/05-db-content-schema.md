# korbat Foundation — Task 5 of 16: `@korbat/db` identity and content tables

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform with a self-owned backend: a TypeScript API (Hono + Drizzle ORM) is the only client of our own Postgres 16. PII lives in a separate `auth` schema (Task 4) that the public API role cannot read. The public schema holds profiles and content, accessed by the `korbat_api` role. Row Level Security is on for every table with a per-role policy (full access in the Foundation, tightened per table in later sub-projects).

Content rules that shape this schema: posts are text up to 1000 characters with up to four images; every post has a `state` (`visible`, `withheld` while under review, `removed` by a human decision, `deleted_by_author`) so nothing ever silently disappears; the feed is chronological and keyset-paginated on `(created_at, id)`; blocks must be enforceable in every read query, so they are a first-class table. `profiles.id` equals `auth.users.id` but has no foreign key across schemas, on purpose: the API role never needs to touch `auth`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed.
- Pinned: drizzle-orm 0.45.2, vitest 4.1.11, typescript 5.9.3.
- Drizzle notes: self-referencing foreign keys need the `(): AnyPgColumn => posts.id` annotation; `check(name, sql)` from `drizzle-orm/pg-core` adds a CHECK constraint; `primaryKey({ columns: [...] })` builds a composite key; `getTableConfig(t).checks` is an array of objects with `.name`, `.primaryKeys[0].columns` is the column list.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 5).

## Preconditions

`git log --oneline -1` must show `feat(db): auth schema tables with RLS`. `packages/db/src/schema/helpers.ts` and `auth.ts` must exist. If `packages/db/src/schema/content.ts` already exists, verify it matches this prompt, fix drift, run tests, and skip to the report.

## Rules

1. Test first: append the new tests, run, see them fail on the missing tables, implement, run, see them pass.
2. Exact file contents below. Keep snake_case column names exactly.
3. Do not add tables beyond `profiles`, `posts`, `post_media`, `follows`, `blocks`, `mutes`, `likes`, `reposts`, `bookmarks`.
4. Do not modify `helpers.ts` or `auth.ts`.
5. LF line endings, 2-space indentation.
6. Verify before claiming; paste real output.
7. Commit exactly once with the given message and trailer.

## Files

### Append to `packages/db/test/schema.test.ts` (FIRST)
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

### Replace `packages/db/src/schema/index.ts` with
```ts
export * from "./auth";
export * from "./identity";
export * from "./content";
```

## Steps

1. Append the tests.
2. Run `pnpm --filter @korbat/db test`. Expected: FAIL on `byName.get("posts")` being undefined (2 new tests fail, 3 old pass).
3. Create `identity.ts`, `content.ts`; update `index.ts`.
4. Run `pnpm --filter @korbat/db test`. Expected: `Tests  5 passed`.
5. Run `pnpm --filter @korbat/db typecheck`. Expected: exits 0. If TypeScript reports an implicit-any or circular inference error on `replyToId`/`quoteOfId`, the `(): AnyPgColumn =>` annotation is missing; do not remove the self-references.
6. Commit:
```bash
git add -A && git commit -m "feat(db): identity and content tables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Report format

- Files created/modified
- Output of the failing run (step 2), passing run (step 4), typecheck (step 5)
- Deviations and why
- Anything blocked or uncertain
