# korbat sub-project 2a: Posting and Feed (text) — Design

Date: 2026-09-17. Status: approved in brainstorm, awaiting written review.

## Context

Sub-project 2 of the korbat design (`2026-09-03-korbat-design.md`, build-order row 2) covers posting and the feed. It is split into three slices so that each ships something usable and each plan stays reviewable:

- **2a (this spec):** text posts, replies, quotes, likes, reposts, bookmarks, follows, blocks, mutes, the Following and Latest timelines, thread and profile pages, handle lookup, write limits, and the web screens.
- **2b:** images end to end: upload, the worker pipeline (re-encode, EXIF strip, blurhash, NSFW score), alt text, media in the composer and in lists.
- **2c:** explore: the ranked view, its refresh job and tab.

Foundation created every table this slice needs (`posts`, `post_media`, `follows`, `blocks`, `mutes`, `likes`, `reposts`, `bookmarks`, `profiles`) with row-level security and the main indexes. 1a provides sessions, the `requireSession` and `requireOnboarding` guards, cookie and bearer transport, and the profile store. Nothing in 2a touches the `auth` schema.

## Decisions

| Topic | Decision |
|---|---|
| Slicing | 2a text, 2b images, 2c explore |
| Feed contents | Top-level posts, quotes and reposts from followed accounts plus your own; replies only in threads and a profile tab |
| Blocks | Full block enforced server-side in every read and write; the interface states that public posts stay readable signed out |
| Mutes | One-way and silent; hide the muted account's posts and reposts from your timelines only |
| Deletion | Sets `deleted_by_author`, blanks the body in the database, leaves a tombstone for ancestors and quotes |
| Editing | None; delete and repost |
| Visibility | Counts public; liker lists never exposed to anyone; follower and following lists for signed-in accounts; likes and bookmarks private to their owner |
| Write limits | Spec numbers tiered by account age; reputation tiers arrive in sub-project 3 |
| Discovery | Public Latest timeline and exact handle lookup until 2c |
| Reading signed out | Latest, threads and profiles are public; everything personal needs a session |
| Architecture | Timelines served straight from Postgres; counters as columns on posts and profiles; a `social` module in the API shaped like the auth module |

## 1. Scope

In scope:
- Posts of 1 to 1000 characters, replies, quotes.
- Likes, reposts, bookmarks and their undos.
- Follows, blocks, mutes and their undos, with lists of who you block and mute.
- Following timeline, Latest timeline, thread view, profile pages with Posts and Replies tabs, private Likes and Bookmarks lists, follower and following lists.
- Exact handle lookup.
- Per-account write limits tiered by account age.
- Rendering of the moderation states `withheld` and `removed` that sub-project 3 will set: visible with a chip to the author, hidden from everyone else.
- Web screens for all of the above, and the route change that makes the timeline the home page.

Out of scope, with the slice or sub-project that owns it:
- Images and any media (2b).
- Ranking, explore, search, hashtags (2c).
- Notifications of any kind (native builds, sub-project 5, or a later slice).
- Mentions as data: `@handle` and links are made clickable in the client only; no mention table or index.
- Profile editing, display name and bio changes (1b).
- Reporting and moderation actions (3).
- Reputation (3). 2a keys tiers off account age only.

## 2. Architecture

### 2.1 The social module

All code for this slice lives in `apps/api/src/social/`. Like the auth module, only `apps/api/src/social/index.ts` may be imported from outside the folder. It exports `createSocial(deps)`, which returns `routes`, a Hono sub-app the app mounts at `/api`, plus the types the app and tests need.

| File | Responsibility |
|---|---|
| `repo.ts` | Every SQL statement, through the `korbat_api` pool: posts, engagement, graph, timelines, profiles, counters |
| `cursor.ts` | Keyset cursor encode and decode |
| `text.ts` | Body normalization and validation |
| `tiers.ts` | Account-age tiers and the limit numbers |
| `limits.ts` | Per-account write limits on top of the rate-limit store |
| `visibility.ts` | The rules for what a viewer may see: state, blocks, mutes, ownership |
| `flows/posts.ts` | Create, get, delete, thread |
| `flows/engagement.ts` | Like, repost, bookmark and their undos |
| `flows/graph.ts` | Follow, block, mute and their undos; blocked and muted lists |
| `flows/timelines.ts` | Following, Latest, profile Posts and Replies, private Likes and Bookmarks |
| `flows/profiles.ts` | Profile view with viewer relation; follower and following lists |
| `routes.ts` | HTTP layer: validation with contracts, calls flows, shapes responses |
| `context.ts` | `SocialDeps`, `SocialError`, error messages |

Dependencies are injected: the API database pool, the rate-limit store, a clock, the logger. No Redis client beyond the rate-limit store; no mailer.

The app mounts `social.routes` at `/api` next to the auth routes. Every write route runs behind the auth module's `requireSession`, which already enforces onboarding, CSRF and Origin checks.

### 2.2 Boundary enforcement

`apps/api/test/architecture.test.ts` gains two rules:
- a file outside `src/social/` imports nothing inside `src/social/` other than `src/social/index.ts`;
- a file inside `src/social/` imports no `auth`-schema table from `@korbat/db` (the module works only with the public schema).

The existing rules stay: the social module reaches the auth module only through `src/auth/index.ts`, and never references the auth pool or auth keys.

### 2.3 Profiles

`apps/api/src/profiles/store.ts` (the 1a `ProfileStore`) keeps its two functions for onboarding. Profile reads that 2a needs (by handle, with counts and viewer relation) live in the social repository, because they join the graph tables.

### 2.4 Contracts

`packages/contracts/src/social.ts` holds every request and response schema for the endpoints in section 5 and the `SocialErrorCode` enum. `packages/contracts/src/index.ts` re-exports it. The shared `Pagination` schema (cursor, limit 1 to 50, default 20) is reused by every list.

## 3. Data model changes

One drizzle migration (`0004_*`), generated from the schema, plus nothing hand-written. Empty tables need no backfill.

`posts` gains:

| Column | Type | Purpose |
|---|---|---|
| `like_count` | integer not null default 0, check ≥ 0 | Shown on the post; never decremented below zero |
| `repost_count` | integer not null default 0, check ≥ 0 | |
| `reply_count` | integer not null default 0, check ≥ 0 | Counts replies that are not deleted |
| `quote_count` | integer not null default 0, check ≥ 0 | Counts quotes that are not deleted |
| `deleted_at` | timestamptz null | Set with `state = 'deleted_by_author'` |

`profiles` gains `follower_count`, `following_count` and `post_count` (integer not null default 0, check ≥ 0). `post_count` counts the account's non-deleted top-level posts and quotes; reposts and replies are not counted, even though the profile's Posts tab shows reposts.

New indexes:
- `posts (quote_of_id)` for quote lookups.
- `reposts (user_id, created_at)`, `likes (user_id, created_at)`, `bookmarks (user_id, created_at)` for per-account lists and the Following union.

Counters are updated in the same transaction as the action that changes them, using the number of rows the action actually inserted or deleted, so repeating an action never double-counts. Deleting a post decrements its parent's `reply_count` or its quoted post's `quote_count` and the author's `post_count` where applicable. Moderation states do not change counters.

Deletion blanks `body` to the empty string. The 1000-character check constraint allows it; the application never returns an empty body except as a tombstone.

## 4. Visibility rules

One function decides what a viewer may see, and every read uses it.

- **State.** Others see only `visible` posts. The author also sees their own `withheld` and `removed` posts, with the state in the response, and their own `deleted_by_author` posts nowhere except as tombstones.
- **Blocks.** If a block exists in either direction between the viewer and an author, the viewer sees none of that author's posts, replies or profile. Direct fetches answer `not_found`. Lists simply omit them. Writes are directional: when the target blocked the viewer, the write fails exactly like a read, with `not_found` or `post_unavailable`, so nothing is revealed; when the viewer blocked the target, the write fails with `blocked`, so the interface can say that unblocking comes first. The viewer's own blocks are listed on the privacy settings page, which is where unblocking happens.
- **Mutes.** The viewer's mutes remove the muted account's posts and reposts from the Following and Latest timelines. Threads and profiles are unaffected.
- **Tombstones.** A post appears as a tombstone only where its absence would break structure: as an ancestor in a thread, or as a quoted embed. A deleted post is a tombstone with `deleted: true`; a post the viewer may not see is a tombstone with `unavailable: true`. Tombstones carry no author, no body and no counts. Deleted and hidden posts are omitted from reply lists and timelines.
- **Signed out.** Latest, threads and profiles are readable without a session and carry no viewer fields. Following, likes, bookmarks, follower and following lists, and the blocked and muted lists need a session.

## 5. Flows and endpoints

All request and response bodies are defined in `packages/contracts/src/social.ts`. Every write needs a session (onboarded account) and is rate limited per section 6. `PostView` is the post shape used everywhere:

```ts
interface PostView {
  id: string;
  author: { id: string; handle: string; displayName: string; verified: boolean };
  body: string;
  createdAt: string;
  state: "visible" | "withheld" | "removed";   // never "deleted_by_author": deleted posts are tombstones
  replyTo: { id: string; authorHandle: string } | null;
  quoteOf: PostView | Tombstone | null;        // one level deep: the embedded post carries quoteOf: null; opening it shows its own quote
  counts: { likes: number; reposts: number; replies: number; quotes: number };
  viewer?: { liked: boolean; reposted: boolean; bookmarked: boolean };   // signed in only
}
interface Tombstone { id: string; deleted?: true; unavailable?: true }
interface Page<T> { items: T[]; nextCursor: string | null }
```

### 5.1 Posts

- `POST /api/posts` `{ body, replyToId?, quoteOfId? }` → 201 `PostView`. At most one of `replyToId` and `quoteOfId`. The body is normalized (section 6) and must be 1 to 1000 characters after normalization. The target of a reply or quote must be visible to the author, otherwise `post_unavailable`; if the author has blocked the target's author, `blocked`. Replying to or quoting your own post is allowed.
- `GET /api/posts/:id` → `PostView`, or `not_found` when the viewer may not see it.
- `DELETE /api/posts/:id` → 204. Author only, otherwise `not_author`. Idempotent.
- `GET /api/posts/:id/thread?cursor&limit` → `{ ancestors: (PostView | Tombstone)[], post: PostView, replies: Page<PostView> }`. Ancestors are the chain from the root down to the parent, at most 50 deep (a longer chain is cut at 50 and the client links to the oldest ancestor returned); replies are direct replies, oldest first. Deeper branches open through each reply's own thread page.

### 5.2 Engagement

- `POST /api/posts/:id/like`, `DELETE /api/posts/:id/like` → `{ counts, viewer }` with the post's updated counts and viewer flags.
- `POST /api/posts/:id/repost`, `DELETE /api/posts/:id/repost` → same shape. Reposting a reply is allowed; the repost appears in timelines like any other.
- `POST /api/posts/:id/bookmark`, `DELETE /api/posts/:id/bookmark` → same shape. Bookmarks change no counts.
- Doing an action twice, or undoing one that was not done, is a no-op that returns the current state.
- The target must be visible to the viewer, otherwise `not_found`; when the viewer has blocked the target's author, `blocked`. Someone who is blocked therefore cannot like, repost or bookmark the blocker's posts, and learns nothing from the refusal.

### 5.3 Graph

- `POST /api/profiles/:handle/follow`, `DELETE …/follow` → `{ following: boolean, followerCount: number }`. Following yourself is `self_target`. Following an account you block is `blocked`; following an account that blocks you is `not_found`, like every other read or write towards it.
- `POST /api/profiles/:handle/block`, `DELETE …/block` → `{ blocked: boolean }`. Blocking is one transaction: insert the block, delete follows in both directions, adjust follower and following counts. Unblocking restores nothing.
- `POST /api/profiles/:handle/mute`, `DELETE …/mute` → `{ muted: boolean }`.
- `GET /api/me/blocks`, `GET /api/me/mutes` → `Page<ProfileListItem>`, newest first.

### 5.4 Timelines and lists

`TimelineItem` is `{ kind: "post", post }` or `{ kind: "repost", post, repostedBy: author, repostedAt }`.

- `GET /api/timeline/following?cursor&limit` (session) → `Page<TimelineItem>`: top-level posts and quotes by followed accounts and by the viewer, plus reposts by followed accounts and by the viewer, ordered by post time or repost time, newest first. Blocks and mutes apply to both the author and the reposter.
- `GET /api/timeline/latest?cursor&limit` (public) → `Page<TimelineItem>` of every visible top-level post and quote, newest first, no reposts. A signed-in viewer's blocks and mutes apply.
- `GET /api/profiles/:handle/posts` (public) → `Page<TimelineItem>`: the account's top-level posts, quotes and reposts.
- `GET /api/profiles/:handle/replies` (public) → `Page<PostView>`: the account's replies, newest first.
- `GET /api/me/likes`, `GET /api/me/bookmarks` (session) → `Page<PostView>`, newest first by when the like or bookmark was made. Posts the viewer may no longer see are omitted.

The cursor encodes the sort time, the post id and, for repost items, the reposter id, as base64url JSON. It is opaque to clients and validated on decode; a malformed cursor is `invalid_request`.

### 5.5 Profiles

- `GET /api/profiles/:handle` (public) → `ProfileView`: `id`, `handle`, `displayName`, `bio`, `verified`, `createdAt`, `counts { posts, followers, following }`, and for a signed-in viewer `viewer { following, followedBy, blocked, muted }`. Handles match case-insensitively. A profile the viewer may not see (a block in either direction) is `not_found`.
- `GET /api/profiles/:handle/followers`, `GET /api/profiles/:handle/following` (session) → `Page<ProfileListItem>` where `ProfileListItem` is the author shape plus `bio` and `followedByViewer`.

There is no liker list endpoint and no search.

## 6. Abuse controls

**Body normalization** (`text.ts`): Unicode NFC, trim, CR LF to LF, at most two consecutive line breaks, and rejection of control characters other than tab and line feed. Length is counted in code points after normalization, which matches Postgres `char_length`. Bodies are stored and returned as plain text; the client renders text and turns `@handle` and `https://` links into links with `rel="noopener noreferrer nofollow"`. There are no link previews in 2a.

**Write limits** (`limits.ts`, `tiers.ts`): counted per account in the existing rate-limit store, on top of the per-IP global limit. The tier comes from `profiles.created_at`, the onboarding time, because auth-schema timestamps are out of the module's reach.

| Action | Account younger than 24 h | Established |
|---|---|---|
| Top-level posts and quotes | 5 per hour | 30 per hour |
| Replies | 20 per hour | 60 per hour |
| Reposts and quotes | refused for the first 48 hours (`account_too_new`) | 30 reposts per hour; quotes count as posts |
| Likes | 100 per hour | 100 per hour |
| Bookmarks | 100 per hour | 100 per hour |
| Follows | 50 per hour and 400 per day | 50 per hour and 400 per day |
| Blocks and mutes | 30 per hour | 30 per hour |

Exceeding a limit is `rate_limited` with `Retry-After`, as in the existing middleware. Undo actions are not limited. Sub-project 3 replaces the age check with reputation without changing the mechanism.

**Other refusals:** `self_target` for following, blocking or muting yourself; `blocked` for interacting with an account you have blocked; `not_found` or `post_unavailable` for anything towards an account that blocked you; `post_unavailable` for replying to or quoting a post the author may not see; `not_author` for deleting someone else's post.

## 7. Errors

New codes in `SocialErrorCode`, returned in the standard error envelope:

| Code | Status | When |
|---|---|---|
| `post_unavailable` | 400 | The reply or quote target is deleted, hidden, or not visible to the author |
| `not_author` | 403 | Deleting a post you did not write |
| `blocked` | 403 | Following, replying to, quoting, liking, reposting or bookmarking an account you have blocked (the other direction is `not_found` or `post_unavailable`) |
| `self_target` | 400 | Following, blocking or muting yourself |
| `account_too_new` | 403 | Reposting or quoting within 48 hours of onboarding |

Existing codes reused: `invalid_request`, `unauthenticated`, `onboarding_required`, `rate_limited`, `not_found`, `csrf_failed`.

## 8. Configuration

No new environment variables. The limit numbers are constants in `tiers.ts`; making them configurable is not needed until reputation tiers exist.

## 9. Web screens

Routes under `apps/app/src/app/`. The sign-in group's index moves from `/` to `/signin`; the auth screens' redirects to `/` now mean the home timeline, and the settings layout sends a signed-out visitor to `/signin`. A finished account lands on its feed, not on the security page.

| Route | Purpose |
|---|---|
| `index.tsx` | Home: Following and Latest tabs when signed in; Latest with a sign-in prompt when signed out |
| `post/[id].tsx` | Thread: ancestors, the post, replies; composer for a reply |
| `u/[handle]/index.tsx` | Profile with Posts and Replies tabs, follow, block and mute actions; a private Likes tab on your own |
| `u/[handle]/followers.tsx`, `u/[handle]/following.tsx` | Lists for signed-in viewers |
| `bookmarks.tsx` | Your bookmarks |
| `settings/privacy.tsx` | Blocked and muted accounts with one-tap undo |
| `(auth)/signin.tsx` | The former `(auth)/index.tsx` |

Shared pieces in `apps/app/src/components/`:
- `AppShell`: the spec's layout. Wide screens: navigation column, timeline column, context column holding the handle box (2c fills it). Narrow screens: single column, bottom tab bar (Home, Bookmarks, Profile) and a floating compose button. Same components at both widths.
- `PostCard`: author line, body with clickable handles and links, quoted embed or tombstone, action row with counts and the viewer's state, chip for the author's own withheld (amber) or removed (red) posts, repost header when shown as a repost.
- `Composer`: inline card at the top of the home timeline on wide screens; on narrow screens the floating button opens it as a sheet. Reply and quote reuse it with the target shown above. Character counter to 1000, disabled while sending, errors from the API shown inline.
- `Timeline`: cursor pagination with a load-more control at the end, pull to refresh on touch, a "new posts" insert at the top on refresh.
- `HandleBox`: opens `/u/:handle` for `@name` or `name`.

`apps/app/src/lib/api.ts` gains no new mechanism; the social contracts are parsed with the same `api()` helper. A small `social.ts` in `lib/` wraps the endpoints. 1a's `ui.tsx` primitives grow as needed.

Accessibility as in the design brief: keyboard navigation on web, reduced motion respected, WCAG AA contrast. The block confirmation dialog states that public posts stay readable to someone who signs out.

## 10. Testing

- **Unit** (`apps/api/test/social/`): contracts, cursor round trip and rejection of malformed cursors, tiers at the 24-hour and 48-hour boundaries, body normalization (NFC, line breaks, control characters, code-point length), the visibility function with every combination of state, ownership, block and mute.
- **Architecture:** the boundary rules in 2.2, with a deliberate violation proven to fail.
- **Integration** against Compose Postgres (`apps/api/test/integration/social-*.test.ts`):
  - counters stay exact when actions repeat and undo;
  - blocking removes follows in both directions in one transaction and adjusts counts;
  - Following pages stably across mixed posts and reposts, and a post reposted by two followed accounts appears twice with distinct cursors;
  - blocks filter both directions in every list; mutes filter timelines only;
  - deletion blanks the body, omits the post from lists, and yields a tombstone as an ancestor and as a quote;
  - withheld and removed posts are visible only to their author;
  - the API role still cannot read the `auth` schema (unchanged check, run again).
- **HTTP** (`http-social.test.ts`): two accounts created through the 1a flows; post, reply, quote, like, repost, bookmark, follow, block, unblock; `not_found` across a block; tier limits with a moved clock; signed-out reads of Latest, threads and profiles; every private list refused without a session.
- **Web:** typecheck and export in CI; a scripted browser check of every screen, as in 1a.
- **Docker:** the smoke test posts as the throwaway account and reads it back from Latest through Caddy.

## 11. Dependencies

None. Everything in this slice runs on packages already locked: Hono, Drizzle, zod, Expo, expo-router, NativeWind.

## 12. Success criteria

2a is done when:
1. A signed-in person can post, reply, quote, like, repost, bookmark, follow, block and mute on the web, and see a chronological Following timeline and a public Latest timeline.
2. Every integration and HTTP test in section 10 passes against the Compose stack.
3. The architecture test passes and fails on a deliberate violation of the social module boundary.
4. A blocked account gets `not_found` for the blocker's posts and profile and `blocked` for every interaction, proven by tests.
5. Semgrep and the dependency audit stay clean.
6. The Docker smoke test and the browser check pass on the built stack.

## 13. Amendments from the dry run (2026-09-17)

The plan was dry-run task by task in a scratch clone before the execution prompts were written. Where the built system differs from sections 1 to 12, this section is the verified version.

Each item is a place where the verified build differs from `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`. The spec gets these edits when the plan and prompts are written into the real repo.

### Module layout (section 2.1)

| Spec | Built |
|---|---|
| `text.ts` (body normalization) | `normalizePostBody`, `postLength` and the `PostBody` schema live in `packages/contracts/src/social.ts`, so the composer's counter applies exactly the server's rule; the module has no `text.ts` |
| `context.ts` | Also holds `SocialDeps` (repository, the rate-limit store for per-account limits, logger, clock) and `ViewerId` |
| not listed | `views.ts`: builds `PostView`s for one viewer (one-level quotes, tombstones, viewer state) and timeline items; `index.ts`: the module entry point |
| `flows/timelines.ts` | Also serves the profile Posts and Replies tabs and the private likes and bookmarks pages |

`createSocial(options)` takes the API pool, the rate-limit store, the logger, the auth module's `requireSession` middleware and an optional clock, and returns `deps` and `routes`.

### App wiring (section 2.1)

- **Optional in the app factory.** `AppDeps.social` is optional so the 1a HTTP tests keep building the app without a social module; the server always wires it. `app.ts` maps `SocialError` to the error envelope and sets `Retry-After` on `rate_limited`.

### Repository (section 2.1, section 3)

- **Raw SQL reads.** Reads use raw SQL through `db.execute`. That driver path returns timestamps as text and expands JavaScript arrays into parameter lists, so the repository formats timestamps as ISO text in SQL, parses them once in row mappers, passes cursor times as ISO strings, and sends id lists as one comma-joined parameter split with `string_to_array(...)::uuid[]`.
- **Millisecond timestamps.** Every row the repository writes gets its time from the clock rather than the database default, so keyset cursors (epoch milliseconds) round-trip exactly.
- **Repost cursor.** Timeline cursors carry the reposter id; a post reposted by two followed accounts is two items with distinct cursors.
- **Ancestor cap.** `MAX_ANCESTORS` is 50; the recursive query stops there and the client links to the oldest ancestor returned.

### Visibility and errors (sections 4, 5, 7)

- **Order of the rule.** A block in either direction wins over everything, even over a deleted post's tombstone reason, so a blocked viewer sees `unavailable`, never `deleted`.
- **Handles.** Flows tolerate a leading `@` in a handle; the route layer strips it anyway.
- **Profile viewer state.** Because a block in either direction makes a profile `not_found`, `viewer.blocked` on a visible profile is always false; the field stays for later slices.
- **Deleting someone else's post.** `not_author` only when the viewer could see the post; otherwise `not_found`.

### Web (section 9)

- **Post card actions.** Reply, Repost, Quote, Like, Save (bookmark) and, for the author, Delete. Quote opens the thread page with the compose sheet prefilled.
- **Composer placement.** Inline at the top of the home timeline from 768 px up; a floating button and a sheet below that. After posting, the timeline reloads.
- **Lists.** One `PagedList` (load more, pull to refresh) with `TimelineList`, `PostList` and `ProfileList` on top.
- **Blocking from a profile.** After confirming a block the app goes to the privacy settings page, because the blocked profile is no longer visible to the blocker.
- **Security page.** Now rendered inside the app shell, with a link to the privacy page.

### Tests (section 10)

- **Fixtures.** Social integration tests create `profiles` rows directly (no auth user behind them) and drive a clock that advances on every read, so list order never depends on the id tie-breaker.
- **HTTP tests.** Use the in-memory mailer for sign-up codes and a strictly increasing clock with an offset that ages accounts past the new-account tier.

## 14. Amendments from the audit (2026-09-23)

Applied by `docs/superpowers/specs/2026-09-23-audit-fixes-design.md` (Task 6 of its prompts). Where this document and the audit design differ, the audit design is current.

- **A block retracts engagement (section 5.3).** Blocking also deletes, both ways, the pair's reposts and likes of each other's posts, adjusting the counters in the same transaction. Unblocking restores nothing.
- **Undo never consults the block relation (section 5.2).** Unlike, unrepost and unbookmark remove the viewer's own row whatever stands between the accounts.
- **A pair lock (section 3).** Follow, block, like, repost, reply and quote take `pg_advisory_xact_lock` on the unordered pair of accounts and check for a block inside the transaction, so none of them can land across a concurrent block.
- **Hidden posts answer first (section 4).** A post's state is judged before the block direction, so a blocker probing ids learns nothing about hidden or deleted posts. Block and mute towards an account that blocks the viewer are `not_found`; the viewer's own block or mute can always be undone.
- **A reply's parent (section 5.1).** `replyTo.authorHandle` is null when the viewer could not open the parent: its author is blocked either way, or the parent is hidden or deleted.
- **Disguising characters (section 6).** Bodies, alt text and display names refuse bidirectional overrides and isolates, the zero-width space, the word joiner and the byte order mark; a body must have some visible text.
- **Follower and following pages** leave out accounts with a block in either direction before the page is cut, so pages stay full.
- **A failing limit store is `service_unavailable` (503) with `Retry-After: 30`**, for writes and for the global limiter alike; the write is not made.
- **Cursors and ids.** A cursor's time is bounded by what a date can hold (anything else is `invalid_request`), and post ids are lowercased on input.
- **Indexes (section 3).** `posts (reply_to_id, created_at, id)`, a partial `posts (created_at, id) where reply_to_id is null and state = 'visible'` for Latest, and `(to, created_at, from)` plus `(from, created_at, to)` on follows, blocks and mutes. The Following timeline applies the cursor, the filters and the limit inside each branch of its union.

## 15. Changed by 2c (2026-09-28)

`docs/superpowers/specs/2026-09-28-explore-2c-design.md` delivers the explore this document left to 2c (section 1): the ranked list, its refresh job and its tab. Search and hashtags, listed beside it, did not go into 2c: each is a sub-project of its own if wanted, and keyword search is a ready tool for finding a target's posts. Home's tabs now have addresses (`/?tab=following`, `latest` or `explore`), signed-out readers get Latest and Explore, Following's empty text points to both, and the context column of section 9's `AppShell` shows Explore's Popular now above the handle box.

## 16. Changed by 3c (2026-10-09)

`docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` delivers the moderation that this document only rendered (section 1: "the moderation states `withheld` and `removed` that sub-project 3 will set").

- **Write limits stay on account age (the decision row Write limits, section 6 and section 8).** The reputation tiers this document expected from sub-project 3 do not arrive: reports are not weighted, reputation is not computed, and migration 0014 drops `profiles.reputation`. The limits, their numbers and `tiers.ts` are unchanged.
- **The states are set, and only by the database (sections 3 and 4).** A post gains `moderation_level` (`visible`, `withheld`, `removed`), which the database derives from the ledger of measures that confirmed decisions record and which only its own writer sets; `posts.state` mirrors the level unless the author deleted the post, which stays terminal, and `PostState` keeps its three values. `korbat_api` loses table-level UPDATE on `posts` and keeps UPDATE of `body`, `state`, `deleted_at` and the four counters, the only columns the API writes; it loses DELETE on `posts` and on `profiles`, so "posts and profiles are never deleted" is a grant. A reported post that its author then deletes is still a tombstone to everyone, and its case goes on, decided on the case's own copy.
- **The author's chip (section 9, `PostCard`).** The view of the viewer's own withheld or removed post carries `moderation` (`PostModeration`: the decision behind the state, the rule it cites or that it rests on the law, and whether korbat is still deciding), which the social module asks of `ModerationForSocial.authorFacts`, one query a page and only for posts the viewer wrote. The chip reads "Under review: R4" or "Removed: illegal content" and links to the decision's statement under Settings, Cases; nobody else's view carries the member, nor does a quoted embed. Posts, images and profiles gain "Report", which opens the report form at `/report`.
- **`postAccess` fails closed (section 4).** It is an exhaustive switch over the stored state with a `never` check: a block hides everything, `deleted_by_author` is deleted, `visible` is shown, `withheld` and `removed` are shown to the author and hidden from everyone else, and a state added later does not compile until this reader decides it. No reader of posts learns a new state in 3c: a seal is a state of images, and the images of a post now carry a state of their own (the 2b design, its section Changed by 3c).
- **Locks (sections 3 and 5).** `deletePost` takes the author's profile row `FOR NO KEY UPDATE` before the post, the one lock order of every transaction that touches moderation, and the moderation module reads posts and accounts only through `socialForModeration` (`SocialForModeration`), which the social module exports.
