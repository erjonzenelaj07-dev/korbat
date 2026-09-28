# korbat explore (2c) — Task 6 of 6: The README's Explore section and its paragraph under Before going public, 2c recorded in the 2a design and the main design, and the 2c design's dry-run amendments

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-28 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend: a Hono API on Node 24, an Expo web app, PostgreSQL 18 and Valkey in Docker Compose. Sub-project 2c added Explore in five commits (the ground, the ranking and its job, the reads, the web app, and what an adversarial review upheld). This task documents it: the README's Explore section and a paragraph under Before going public, 2c recorded in the 2a design and in the main design's amendments (what was delivered, changed and left to sub-projects 3, 3b, 4 and 5), and the 2c design's amendments from the dry run. The design is `docs/superpowers/specs/2026-09-28-explore-2c-design.md`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `fix(api,app): what the review of 2c upheld, fixed: a cursor sent before any ranking exists is 400, as for any generation not yet written; the signed-out Explore prompt promises nothing the list may not hold; the ranking's age is judged when it is read, against the answer's Date header, so a page left open or a fast device clock never shows the stale warning, and a Refresh button reads the newest ranking once the one on screen is five minutes old; Home's lists are keyed by their reader, so a sign-in reads them again; the author's post screen reads its Explore status and post again whenever it gains focus; the Explore switch keeps its saving state and its error across the Blocked and Muted tabs; the list's reads live in a reader object tested directly; a test pins the one-way mute`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

```bash
python docs/superpowers/prompts/explore-2c/write_blocks.py docs/superpowers/prompts/explore-2c/06-documentation.md 1
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Replace `README.md` (whole file)

````markdown
# korbat

Pseudonymous social platform with a narrow public rulebook and transparent moderation. Self-hosted.

- Design spec: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Accounts and sessions (sub-project 1a): `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- Posting and feed (sub-project 2a): `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- Plans: `docs/superpowers/plans/`

## Dev quick start
```bash
pnpm install
node scripts/gen-dev-env.mjs                # creates or completes infra/.env, apps/api/.env, apps/app/.env and apps/worker/.env, and derives apps/api/.env.test; values are random and never printed
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit   # dev host ports 55432, 56379, 51025, 58025 (movable: DEV_*_PORT in infra/.env)
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health; reads apps/api/.env
pnpm --filter @korbat/worker dev            # the image worker; reads apps/worker/.env and works on .data/media
pnpm --filter @korbat/app web               # http://localhost:8081
```

Emails sent in development (sign-in codes, new-device alerts, lockout notices) land in Mailpit at http://localhost:58025. Locally the web app uses Cloudflare's always-pass Turnstile test key, so the human check never blocks you.

The data services are PostgreSQL 18 and Valkey (the BSD-licensed fork of Redis, still under the service name `redis`, on its own volume `valkeydata`: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into the old `redisdata` volume, which held only transient state and can be removed with `docker volume rm`). Valkey needs the password from `infra/.env`; `gen-dev-env` writes it into the API's `REDIS_URL` too, so an older `.env` is fixed by running it again.

korbat once ran MinIO and never used it. Images live on two Docker volumes instead, `media-uploads` and `media-store`. If an old stack left a `korbat_miniodata` volume behind, `docker volume rm korbat_miniodata` removes it.

## Tests
```bash
pnpm test                                     # unit tests of every package
node scripts/test-db.mjs                      # creates or migrates the korbat_test database; run it again after adding a migration
pnpm --filter @korbat/api test:integration    # needs postgres, redis and mailpit up
```

Integration tests have their own database, `korbat_test`, and their own Redis database, 15. Both are named in `apps/api/.env.test`, which `node scripts/gen-dev-env.mjs` derives from `apps/api/.env`. Every run starts by emptying them, and refuses to start if a URL points anywhere else, so tests never touch development data.

Before they had their own database, the integration suites left accounts, profiles and posts in the development database, and the smoke test still leaves one account per run. To see and remove them:

```bash
node scripts/clean-dev-fixtures.mjs          # lists test accounts and profiles without an account; deletes nothing
node scripts/clean-dev-fixtures.mjs --yes    # deletes them with everything they made
```

It only matches emails of the tests' shape, `<word>-<uuid>@korbat.local`, recomputes the counters of kept profiles and posts they touched, and refuses to run unless `API_APP_ORIGIN` in `infra/.env` is a localhost origin.

## Full stack
```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build   # http://localhost:8080
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

The smoke test signs up a throwaway account through Caddy, reads its code from Mailpit, posts and reads the post back from the public Latest timeline. It uploads a JPEG carrying a GPS position, posts it, and checks that the served file is a fresh WebP without metadata, that a symlink planted in the store from inside the worker gets a 404, and that deleting the post removes the image from disk. It checks the worker's isolation, then grants the account a staff role with the CLI and checks that its session was revoked.

After every sharp upgrade, add `--worst-case`: it also uploads flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP progressive JPEG, 48 MP GIF, 16 MP AVIF), expects each to be ready without the worker being OOM-killed or restarted, and prints the worker's memory peak.

Caddy listens on 8080 inside its container as its own user, proxies `/api` to the API and serves the web app with the page's security headers; `index.html` is revalidated on every load and the hashed bundles are cached for a year. The compose file keeps cloudflared, Caddy, the API and the data services on separate networks, so cloudflared reaches only Caddy and Caddy only the API.

## Upgrading PostgreSQL

The stack runs PostgreSQL 18 on the `pgdata18` volume. A database from the earlier PostgreSQL 16 volume (`pgdata`) is moved by:

```bash
node scripts/pg-major-upgrade.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

It dumps the old cluster with the old image in a throwaway container, starts the new server, restores the dump with every owner kept, and compares the row counts. The old volume stays until you remove it; the test database is created again by `node scripts/test-db.mjs`.

## Restoring

Restore the database and the `media-store` volume from the same moment. The API's sweeper deletes images that have no row: after a database restored from an older snapshot it would delete every image posted since. It refuses when there are many such images, but for a restore window set `MEDIA_RECONCILE=off` in `infra/.env` before starting the API, and put it back to `on` once the store matches the database. `force` makes one pass delete them anyway, for when they really are orphans.

## Posting and feed
Text posts up to 1000 characters, replies, quotes, likes, reposts and bookmarks; follows, blocks and mutes; a chronological Following timeline and a public Latest timeline; threads and profile pages. The web app's home is the timeline; sign-in lives at `/signin`.

- **Reading signed out:** Latest, threads and profiles are public. Following, bookmarks, likes, follower lists and privacy settings need a session.
- **Blocks** are enforced in every query, not just the interface: neither account sees the other while signed in, follows are removed both ways, and the blocked side gets `not_found` so nothing is revealed. Posts are public, so a block does not hide them from someone who signs out; the interface says so.
- **Mutes** are one-way and silent, and hide an account from your timelines only.
- **Liker lists are never exposed.** Counts are public; likes and bookmarks are private to their owner.
- **Write limits** per account, tiered by account age: in the first 24 hours 5 posts and 20 replies an hour and no reposts or quotes for 48 hours; afterwards 30 posts and 60 replies an hour. Everyone: 100 likes an hour, 50 follows an hour and 400 a day, 30 blocks or mutes an hour. Undo actions are never limited.
- **Deleting** blanks the text in the database and leaves a tombstone only where a thread or a quote needs it. There is no editing.

## Images
Posts, replies and quotes can carry up to four images, and every image needs a description of up to 1000 characters. The web composer takes JPEG, PNG, WebP, AVIF and still GIF files up to 20 MB, and refuses HEIC with advice to export a JPEG.

- **Nothing of the original is kept.** The upload goes to the `media-uploads` volume, a separate worker container decodes it and writes fresh WebP files in two sizes (1024 and 2048 pixels on the long side) without any metadata to `media-store`, and the original is deleted once the image is ready.
- **The worker is boxed in.** It has no network, no credentials and no capabilities, runs as a non-root user on a read-only file system within 768 MiB, one CPU and 64 processes, and only reads `media-uploads`. Decoders outside the allowlist are blocked, and the pixel count is checked from the header before decoding: 50 MP, 16 MP for AVIF, 16383 pixels on a side.
- **Formats can be switched off** without a deploy, for example while a codec advisory is open: remove it from `MEDIA_FORMATS` in `infra/.env` and restart `api` and `worker`.
- **Who sees an image** follows its post: anyone for a visible post, with a public five-minute cache; only the author for a withheld or removed post, never cached; nobody once the post is deleted, and its files leave the disk.
- **Behind Cloudflare**, set Browser Cache TTL to "Respect Existing Headers", or browsers keep images for four hours whatever the server says.

## Explore
A ranked list of recent original posts, the third tab of Home (`/?tab=explore`). Its whole formula is published at `/explore/about`, printed from `EXPLORE_V1` in `packages/contracts/src/explore.ts`, the constant the ranking itself uses; changing any number means a new formula version with a dated entry in its change log.
- **What is ranked.** Visible top-level posts that are not quotes, from the last 48 hours, by live accounts that have not switched Explore off. Replies belong to their threads, and quotes stay out so that a mocking quote cannot put its target's post on a public page.
- **What counts.** Approving accounts: the distinct accounts other than the author that liked or reposted the post, each at least 48 hours old when it did, still live, the like or repost at least 10 minutes old. The score is approving accounts / (hours since posting + 2)^1.8; a post needs at least 3; one account has at most 2 posts in a ranking of 300. Replies, quotes, followers, the badge and reports are never read.
- **The refresh.** The API's `explore-refresh` job ranks at start and every five minutes under the shared job lock, and a round within 4.5 minutes of the last writes nothing, however many instances run. Each ranking is a numbered generation in `explore_runs` and `explore_items`; the two newest are kept so a reader can finish paging, and a round logs only its generation, its counts and its milliseconds.
- **Reading.** `GET /api/timeline/explore` shows only the order, never a score, count or position. Its cursor names the ranking and the last post read; a pruned ranking answers 409 `explore_refreshed`, and the app goes on from the newest ranking without repeating a post. Moderation states, the author's switch or deletion, blocks in both directions and mutes apply at every read. Signed out: the first 20 posts and no cursor. Every answer is `no-store`.
- **Authors.** Settings > Privacy has "Show my posts in Explore" (`POST` and `DELETE /api/me/explore`, on by default): off takes the posts out at the next read, on brings them back at the next refresh. `GET /api/posts/:id/explore` tells the author alone whether a post is in Explore and which rule keeps it out, never with a count, and the author's listed posts show "In Explore".
- **Tests.** A ranking is a function of the time it is computed at, so the integration suites rank in past epochs of their own (2020 to 2023), each test in its own span after emptying `explore_runs`.

## Staff roles
No API endpoint changes roles. Run this on the server:
```bash
docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
```
Every session of the account is revoked and the change is written to the audit log. Staff tools refuse moderators and admins until they turn on two-factor authentication.

## Profile and account
Signed-in accounts manage themselves under Settings; every route below needs the session and, where it says fresh, a re-authentication within five minutes (the app opens its panel when the API answers `reauth_required`).
- **Profile.** `PATCH /api/me/profile` sets the display name (up to 50 characters) and the bio (one line, up to 160). `POST /api/me/handle` (fresh) changes the handle once every 30 days; every handle an account ever had stays reserved for it in `handle_history`, so nobody else can take an old handle and the account can go back to it. There is no redirect from an old handle.
- **Email.** `POST /api/auth/email/change/start` (fresh) sends a code to the new address; `POST /api/auth/email/change/verify` moves the account there and tells the old address, whose notice carries a link (`/email-revert/<token>`, `POST /api/auth/email/revert`, valid 24 hours, once) that moves the account back and runs the lockdown described under Passkeys and fresh authentication (every session and device signed out, the password removed, passkeys and two-factor authentication set up since the day before the change removed). Sessions stay signed in after a change.
- **Verified badge.** Proof of holding a phone number, kept only as a keyed hash; one number per account. `VERIFY_PROVIDER` picks who sends the text: `off` (default; the badge is hidden), `dev` (the code is always `000000`; refused in production) or `vonage` (Vonage Verify v2 with `VONAGE_API_KEY`, `VONAGE_API_SECRET` and `VERIFY_BRAND`; the runbook is section 13 of `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, and `node scripts/verify-badge.mjs +4479xxxxxxxx` checks live credentials without touching an account). Routes: `POST /api/auth/badge/start`, `POST /api/auth/badge/verify`, `DELETE /api/auth/badge` (all fresh); starts are limited per account, per number, per IP and instance-wide (200 texts a day), and a flow takes at most five codes. The web build shows the badge section only with `WEB_BADGE=on` in `infra/.env` (the default is off, matching `API_VERIFY_PROVIDER=off`); set both together.
- **Data export.** `POST /api/account/export` (fresh, once a day) streams a ZIP with `export.json` (the account with its passkeys' names and dates, profile, posts, likes, reposts, bookmarks, following, blocks, mutes, sessions, devices and security events) and every image the account uploaded under `media/`. Nothing is kept on the server: the archive is written entry by entry (ZIP64 when it passes 4 GiB or 65,535 entries), `export.json` is read in pages and streamed last, image files go through the media module's checked open, a request that fails before the first byte gives the day's export back, and one that fails midway breaks the download instead of saving a truncated archive.
- **Deletion.** `POST /api/account/delete/start` (fresh) mails a code; `POST /api/account/delete/confirm` with the code and the handle typed by the owner deletes the account at once: every session is revoked, posts become tombstones with their images and any pending uploads deleted from disk, likes, reposts, bookmarks, follows, blocks and mutes go with their counters, the profile is anonymised and keeps its handle, and the auth row is anonymised. The `account-purge` job (every five minutes) finishes any deletion the process did not. Nothing can be undone.
## Passkeys and fresh authentication
An account can sign in and confirm sensitive changes with a passkey (WebAuthn), beside the emailed code, the password and two-factor codes. The API verifies through `@simplewebauthn/server`, which only `apps/api/src/auth/passkeys/webauthn.ts` imports; that module pins korbat's settings and adds its own checks.
- **Settings.** `API_WEBAUTHN_RP_ID` is the domain passkeys are bound to (default: the host of `API_APP_ORIGIN`) and `API_WEBAUTHN_RP_NAME` the name a browser shows (default `korbat`). Production refuses `localhost`, an IP address and anything that is not the origin's host or a parent domain of it. Browsers offer passkeys only on `https` or on `http://localhost`, never on an IP address.
- **Adding.** `POST /api/auth/passkeys/register/options` and `/verify`. Up to 10 passkeys, 5 added a day. User verification (fingerprint, face or PIN) is asked for and never required; only the attestation formats `none` and self-attested `packed` are accepted, so nothing is fetched from an authenticator's maker. The owner is mailed a link (`/passkey-remove/<token>`, valid 7 days, once) that removes the passkey and locks the account down.
- **Managing.** `GET /api/auth/passkeys` lists them (name, dates, synced, the device that added it, new, suspended); `PATCH /api/auth/passkeys/:id` renames and `DELETE` removes, the last one too. "This wasn't me" on a passkey of the last 7 days (`POST /api/auth/passkeys/:id/not-mine`) runs the lockdown.
- **Signing in.** `POST /api/auth/passkey/signin/options` and `/verify` need no email: the browser offers the passkeys it holds for the domain, from the button or from the email field's autofill. A sign-in whose passkey verified the user counts as two factors; one that did not is followed by the two-factor code on an account that has two-factor authentication, and staff always give the code. A signature counter that goes backwards switches the passkey off, mails the owner and refuses the sign-in.
- **Fresh authentication has two levels.** A session records what it proved and when. Level 1 is any factor in the last five minutes; level 2 is a user-verified passkey, or a two-factor or recovery code beside an email code, a password or a passkey. An account with two-factor authentication needs level 2 to add or remove a passkey, change its password or email, set up, turn off or re-issue two-factor codes, and delete itself; every other account needs level 1. A refusal is `reauth_required` with `details: { level, have }`, and `POST /api/auth/reauth` (password, emailed code, two-factor code, recovery code or passkey) answers the level reached and rotates the session's token in place, so a copy of the old token stops working. Sessions are listed and revoked by an id that survives the rotation.
- **Lockdown.** Every "this wasn't me" runs one routine: the new-device alert's link, the passkey mail's remove link, the button on a new passkey, and the email change's undo. It signs out every session and device, removes the password, and removes the passkeys and two-factor authentication set up since the day before the event, in one transaction; the owner gets back in with a code sent to their email. A mailed link is tied to the address it went to: it does nothing while the account is at another address and works again once the address is restored.
- **What is kept.** The public key, the credential's id, its counter, whether it is synced and was registered with user verification, its name, and the device that added it; nothing about a fingerprint or a face ever leaves the person's device. The export lists names and dates only, and deleting the account deletes the passkeys.
- **After restoring a backup** the counters in the database are older than the authenticators': run `update auth.passkeys set counter = 0, suspect_at = null where suspect_at is null or suspect_at > '<restore time>';` so no passkey is refused as a copy (section 11 of `docs/superpowers/specs/2026-09-25-passkeys-1c-design.md`).
- **Tests.** A software authenticator (`apps/api/test/auth/soft-authenticator.ts`) runs whole ceremonies in the unit and integration suites. The API prints two `ExperimentalWarning`s at start, from the library's probe of Node 24's ML-DSA support; they are expected.
## Before going public
Set these in `infra/.env`:
- `API_APP_ORIGIN` to the public origin, for example `https://korbat.example`; the API refuses a plain-http origin in production.
- `API_TURNSTILE_SECRET_KEY` and `WEB_TURNSTILE_SITE_KEY` to the keys of one Turnstile widget; the API and the web build refuse Cloudflare's test keys in production.
- `API_SMTP_URL` and `API_MAIL_FROM` to the EU mail relay; a plain `smtp://` relay must offer STARTTLS, which the API requires in production.
- `API_WEBAUTHN_RP_ID` before the first passkey is registered, when it should differ from the host of `API_APP_ORIGIN`: the apex domain lets a later subdomain (an admin console) share passkeys, and changing it afterwards strands every passkey.
- `KORBAT_ENV=production` before building the images; it is the API's `NODE_ENV` too, so the guards above are on.
- `TUNNEL=on` and `API_TRUST_PROXY=cloudflare` when cloudflared is the only way in (the tunnel's hostname points at `http://caddy:8080`); `TUNNEL=off` and `API_TRUST_PROXY=caddy` when Caddy's port is reachable directly. With `on`, Caddy keeps `CF-Connecting-IP` for the API; with `off` it drops it, so nobody can claim an address.
- In Cloudflare, set Browser Cache TTL to "Respect Existing Headers", or browsers keep images for four hours whatever the server says.

Keep `API_AUTH_HMAC_KEY`, `API_IP_HASH_KEY` and `API_TOTP_ENC_KEY` secret and backed up. Losing `API_TOTP_ENC_KEY` breaks every enrolled authenticator. To rotate it, put the old key in `API_TOTP_ENC_KEYS_PREVIOUS` and a new `v2:` key in `API_TOTP_ENC_KEY`; each secret is re-encrypted with the new key when it is next used.

Explore relies on sub-project 3's moderation states: until moderators can withhold or remove a post, only its author takes a rule-breaking post out of Explore, by deleting it or switching Explore off. Its cold start lasts about two days: only accounts at least 48 hours old count, so on a new instance Explore stays empty until the first accounts are that old.

## Dependency audit

`pnpm audit --audit-level high` runs in CI. Two lower advisories are accepted, both in build-time tools that never see untrusted input here: `esbuild` 0.18 under drizzle-kit's config loader (its development server, which nothing starts) and `uuid` 7 under Expo's Xcode config plugin. Renovate moves them with their parents.
````

### Replace `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md` (whole file)

````markdown
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
````

### Replace `docs/superpowers/specs/2026-09-03-korbat-design.md` (whole file)

````markdown
# korbat — Design Spec

## Context

A pseudonymous social network where people can post opinions without a platform quietly removing them. Content limits are narrow and public: no sexual content (+18), no CSAM, no targeted racial hatred or harassment, no doxxing, no direct threats, no spam. Everything else stays up. Opinions are never a removal reason.

The credibility of the product rests on two things, which is why they get half the effort each:

- **Security.** Users who post unpopular opinions are targets. Account takeover, deanonymization, brigading, and admin compromise all have to be designed against from day one.
- **Transparent moderation.** Every removal cites a public rule, shows the author exactly what happened, and can be appealed to a different human. There is no silent reach reduction and the feed is chronological, so "shadowban" is not something the system can do.

Decisions made during brainstorming:

| Decision | Choice |
|---|---|
| Platform | Expo (React Native) codebase, web target first, iOS/Android via EAS later |
| Identity | Pseudonymous handles, email required at sign-up, optional verified badge |
| Content v1 | Text + images (video is v2) |
| Moderation | Public rulebook, human review with written reasons, appeals; automation only for +18 and CSAM detection |
| Scale | Solo/small team, first few thousand users |
| Backend | Fully self-owned: custom TypeScript API, own Postgres, own auth, own object storage. No managed backend vendor. Client never touches the database. |
| Auth | Hand-rolled flows and sessions in the API, built on audited primitives (argon2id, SimpleWebAuthn, otplib). No auth SaaS or auth framework. |
| Hosting | Docker Compose stack, runs on a cloud VPS now and moves to the user's local server later. Cloudflare Tunnel in front, so no inbound ports are ever opened. |
| Feed | Chronological following feed + explore tab |
| Threat priorities | All four: account takeover, deanonymization/leaks, bots/brigading/ban evasion, platform integrity |

The app is called **korbat**. The folder `C:\Users\Lenovo\Desktop\cool` currently holds two unrelated OSINT projects; korbat gets its own folder, `C:\Users\Lenovo\Desktop\cool\korbat`, as a fresh git repo.

---

## 1. Architecture

```
Browser / Expo app
        │  HTTPS (cookie session on web, bearer token on native)
        ▼
Cloudflare (DNS, WAF, DDoS, edge rate limits, CSAM scanning, Turnstile)
        │  Cloudflare Tunnel (outbound-only connection from the server; no open inbound ports)
        ▼
┌─ Docker Compose host (VPS now, local server later) ───────────────────────┐
│  cloudflared  ── tunnel client                                            │
│  caddy        ── internal reverse proxy, TLS termination inside the box   │
│  api          ── Hono on Node 22, TypeScript, Drizzle ORM                 │
│     ├── owns auth: sign-up, OTP, passwords, TOTP, passkeys, sessions      │
│     ├── enforces authz + rate limits, all reads/writes to Postgres        │
│     └── serves media by signed path from object storage                   │
│  worker       ── image pipeline: re-encode, strip EXIF, blurhash, NSFW   │
│  admin        ── moderation console, separate container + hostname       │
│  postgres 16  ── single source of truth, RLS on as defense in depth       │
│  redis        ── rate-limit counters, OTP/challenge state, job queue      │
│  minio        ── S3-compatible object storage for images (private bucket)│
│  mailer       ── outbound only (SMTP relay: Postmark/SES/self-hosted)     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Monorepo** (pnpm workspaces):

```
apps/
  app/        Expo + expo-router, NativeWind, Reanimated. Web first.
  api/        Hono API, auth module, Drizzle schema + migrations, tests
  worker/     Image pipeline + scheduled jobs (IP-hash purge, explore refresh), consumes Redis queue
  admin/      Moderation console (Expo web or plain React). Separate deploy + hostname.
packages/
  contracts/  Zod schemas shared by app, admin, and api. Single source of truth for every request/response.
  rules/      The public rulebook as data (id, title, text, examples). Rendered in app and cited by moderation.
  db/         Drizzle schema + migrations, shared by api and worker.
infra/
  compose.yml, compose.prod.yml, Caddyfile, cloudflared config, backup script
```

**Why these pieces**

- **Hono**: tiny, TypeScript-native, middleware model makes security headers, auth, and rate limits composable. Runs anywhere Node runs, which is all a home server needs.
- **Drizzle**: typed schema and SQL migrations checked into git. No query builder magic that hides SQL, which matters for security review.
- **Own auth module** (section 3a): the user wants to own the backend end to end. We write the flows and session logic; cryptographic primitives come from audited libraries (`@node-rs/argon2` for argon2id, `@simplewebauthn/server` for passkeys, `otplib` for TOTP, Node `crypto` for random tokens and constant-time compares). Nothing else touches credentials.
- **Web sessions are httpOnly cookies set by the API**, never tokens in localStorage. This removes the most common XSS-to-account-takeover path on web. Native clients use bearer tokens in SecureStore.
- **MinIO** gives an S3-compatible API so image code is identical on a VPS, on a home server, and on real S3 if that's ever wanted. Bucket is private; the API issues short-lived signed GET URLs.
- **Cloudflare Tunnel** means the server makes an outbound connection and Cloudflare routes traffic in. No router port-forwarding, the home IP is never public, and WAF, DDoS absorption, Turnstile, and the free CSAM scanning tool still apply. Cloudflare Access can additionally gate the admin hostname behind its own login.
- **Same compose file everywhere**: develop on a laptop, run on a cheap VPS at launch, then `docker compose up` on the local server with a restored Postgres backup. Migration is a data move, not a re-architecture.

---

## 2. Data model (Postgres, Drizzle)

Only tables that v1 needs. PII (email, phone) lives in a separate `auth` schema that the public API role can only reach through a few security-definer functions, and is never joined into public responses.

**Auth schema (`auth.*`, owned by the auth module only)**
- `auth.users` — `id`, `email` (unique, citext), `email_verified_at`, `phone_hash` (for the verified badge; raw phone discarded after OTP), `password_hash` (argon2id, nullable when passkey-only), `totp_secret_enc` (encrypted at rest with a server key), `totp_enabled_at`, `recovery_codes_hash[]`, `failed_logins`, `locked_until`, `created_at`, `deleted_at`
- `auth.sessions` — `id` (random 256-bit, stored hashed), `user_id`, `device_id`, `created_at`, `expires_at` (30 days sliding, 12 months absolute), `last_used_at`, `revoked_at`, `reauth_at` (last fresh authentication, for sensitive actions)
- `auth.devices` — `user_id`, `device_hash`, `label`, `platform`, `first_seen_at`, `last_seen_at`, `ip_hash` (salted, 30-day purge), `revoked_at`
- `auth.email_codes` — `user_id` / `email`, `code_hash`, `purpose` (`signup`, `login`, `change_email`, `recovery`), `expires_at` (10 min), `attempts`, `consumed_at`
- `auth.passkeys` (auth phase 2) — `user_id`, `credential_id`, `public_key`, `counter`, `transports`, `backed_up`, `name`, `created_at`, `last_used_at`
- `auth.webauthn_challenges` — short-lived, in Redis rather than Postgres

**Identity (public schema)**
- `profiles` — `id` (= auth.users.id), `handle` (unique, immutable after 30 days), `display_name`, `bio`, `avatar_path`, `verified_at`, `reputation` (int), `created_at`, `deleted_at`

**Content**
- `posts` — `id`, `author_id`, `body` (≤ 1000 chars), `reply_to_id`, `quote_of_id`, `state` enum (`visible`, `withheld`, `removed`, `deleted_by_author`), `created_at`
- `post_media` — `post_id`, `path`, `width`, `height`, `blurhash`, `alt_text`, `nsfw_score`
- `follows`, `likes`, `reposts`, `bookmarks` — join tables with composite PKs
- `blocks`, `mutes` — user-level. Blocks are enforced in every read query, not just the UI.

**Trust & safety**
- `reports` — `reporter_id`, `target_type`, `target_id`, `rule_id` (from `packages/rules`), `details`, `weight` (from reporter reputation), `status`
- `cases` — one per moderation decision: `target`, `rule_id`, `action` enum (`none`, `withhold`, `remove`, `strike`, `suspend`), `public_reason` (shown to author), `moderator_id`, `created_at`
- `appeals` — `case_id`, `statement`, `status`, `reviewer_id` (must differ from original moderator), `decision_reason`
- `strikes` — `user_id`, `case_id`, `expires_at`
- `transparency_log` — anonymized public copy of every case: rule, action, date, whether appealed and outcome. Powers a public /transparency page.
- `audit_log` — append-only (no UPDATE/DELETE grants) record of every admin and moderator action.

**Feed queries**: following feed is `posts WHERE author_id IN (my follows) AND state = 'visible' AND author NOT IN (my blocks / blockers)`, keyset-paginated on `(created_at, id)`. Explore is a materialized view refreshed every few minutes ranking recent posts by engagement, same block filtering at read time.

---

## 3. Security design (threat by threat)

### 3a. Account takeover (own auth module, `apps/api/src/auth`)

The auth module is the single most reviewed code in the repo. It is one folder with one public interface, has no dependencies on the rest of the API, and every function in it has tests.

- **Sign-up**: email + 6-digit code (`auth.email_codes`, 10-minute expiry, 5 attempts, hashed at rest). Turnstile token verified server-side. Password optional at sign-up; if set, ≥ 12 chars and checked against the Have I Been Pwned range API (k-anonymity, only a 5-char SHA-1 prefix leaves the server). Hashed with argon2id (memory 64 MiB, iterations 3, parallelism 1; parameters stored alongside the hash for future upgrades).
- **Sign-in**: email code, or password. Constant-time comparison; identical response timing and message whether the email exists or not. After 5 failures the account locks for 15 minutes and the user gets an email.
- **MFA**: TOTP in v1 (`otplib`, secret encrypted with a server-side key from the secret store, 10 one-time recovery codes hashed). Passkeys in auth phase 2 with `@simplewebauthn/server`, then promoted as the default sign-in with password as fallback.
- **Sessions**: opaque 256-bit random ID; only its SHA-256 lives in `auth.sessions`. Web: httpOnly, Secure, SameSite=Lax cookie scoped to the API host, with a CSRF double-submit token for state-changing requests. Native: bearer token in SecureStore. Sliding 30-day expiry, 12-month absolute cap. Session ID is rotated on privilege changes (login, MFA enrol, password change).
- **Devices**: every session belongs to an `auth.devices` row. Users see their devices with platform, first/last seen, and can revoke one or all. First login from a new device sends an email alert with a one-click "this wasn't me" link that revokes it and forces a password reset.
- **Re-authentication**: handle change, email change, MFA removal, passkey removal, and account deletion require `reauth_at` within the last 5 minutes.
- **Rate limits**: per account, per email, and per IP/ASN sliding windows in Redis, with Cloudflare edge rules as the first layer on `/auth/*`.
- **Recovery**: email code to the verified address; if MFA is enabled, a recovery code is also required. No security questions, no SMS recovery (SIM-swap risk).
- **Explicit non-goals for v1**: OAuth social login (adds third-party trust and account-linking bugs), SMS login.

### 3b. Deanonymization and data leaks
- **PII minimization**: email and hashed phone exist only in `auth.users`. No API response type includes them except `/me`. Contracts in `packages/contracts` make this a compile-time property. The public API Postgres role has no SELECT on `auth.*`; the auth module uses its own role.
- **Images**: every upload is re-encoded with `sharp` (strips EXIF/GPS, defeats polyglot files), capped in pixel dimensions before decode (decompression-bomb guard), stored under a random ID, never the original filename. Uploads go through API-issued signed URLs with content-type and size constraints.
- **IP handling**: raw IPs never stored. Salted hash in `devices.ip_hash` for abuse correlation, purged by a 30-day job. Logs scrub tokens, emails, and IPs at the logger level.
- **No third-party trackers** in the client. Self-hosted, cookie-less analytics at most.
- **Defense in depth**: RLS enabled on every table even though only the API connects, so a SQL-injection or logic bug in one route cannot read another user's private rows. Three Postgres roles: `korbat_auth` (auth schema only), `korbat_api` (public schema, no DDL), `korbat_migrate` (DDL, used only by the migration job). MinIO bucket is private; media served through Cloudflare's CDN via short-lived signed URLs.
- **Encryption at rest**: Postgres and MinIO volumes on an encrypted disk (LUKS on the local server, provider-encrypted volume on the VPS). TOTP secrets additionally encrypted at the application layer. Backups encrypted with `age` before leaving the box.
- **User rights**: self-service data export (JSON) and account deletion (hard delete of profile/content, auth row anonymized) from v1.
- **Web hardening**: strict CSP with nonces, HSTS, `frame-ancestors 'none'`, CORS allowlist, `Referrer-Policy: no-referrer`.

### 3c. Bots, spam, brigading, ban evasion
- Sign-up friction: email verification, Cloudflare Turnstile, disposable-email domain blocklist, per-IP/ASN sign-up limits.
- New accounts: for the first 24 hours, max 5 posts/hour and 20 replies/hour; no reposts or quotes for 48 hours. Limits relax as `reputation` grows (established accounts: 30 posts/hour).
- Reputation: a simple score (account age, verified badge, upheld reports, strikes). Used to weight reports and to size rate limits. Never used to rank or hide content.
- Report weighting: reports from low-reputation or brand-new accounts count less. A spike of reports on one target from accounts that follow each other is flagged as **brigading** and protects the target (case goes to a senior queue) rather than triggering action.
- Ban evasion: hashed device fingerprint + email-domain heuristics at sign-up; matches surface to moderators as a signal, not an auto-ban.
- Every write endpoint has a per-user and per-IP rate limit declared next to the route.

### 3d. Platform integrity
- Cloudflare WAF managed rules, DDoS protection, and edge rate limits before traffic reaches the API.
- Every request body validated with the shared Zod contract before any handler runs. Drizzle parameterizes all SQL.
- Admin console on its own hostname and deploy. Admin/moderator accounts require TOTP (passkey once available). Every action lands in the append-only `audit_log`.
- Secrets in Docker secrets / a root-only `.env` on the host, never in the repo. `.env.example` only. Containers run as non-root with read-only root filesystems where possible; only Postgres, MinIO, and Redis get writable volumes.
- **Backups**: nightly `pg_dump` + MinIO mirror, encrypted with `age`, pushed off-box (cheap object storage or a second machine). Restore is rehearsed in sub-project 4 and is also the migration path from VPS to the local server.
- **Home-server specifics**: Cloudflare Tunnel is the only ingress; SSH only over Tailscale or the LAN; automatic OS security updates; UPS or at least a clean-shutdown script so Postgres never sees power loss mid-write.
- CI: typecheck, vitest, semgrep (OWASP ruleset), `pnpm audit`, Renovate for dependency updates, OWASP ZAP baseline scan against a preview deploy.
- Image processing runs in a separate worker process with memory and time limits so a malicious file can't take down the API.
- Structured logging with request IDs; alerts on auth-failure spikes, 5xx rate, and moderation queue age.

---

## 4. Content rules and moderation flow

### The rulebook (`packages/rules`)
Six rules, each with an ID, one-paragraph text, and two or three examples of what is and is not covered. Rendered in-app at `/rules` and cited by ID in every case.

| ID | Rule | Enforcement |
|---|---|---|
| R1 | No sexual or pornographic content | Automated image score → **withheld** pending human review. Human decides. |
| R2 | No child sexual abuse material | Cloudflare CSAM hash match → auto-remove, account suspended, NCMEC report. Only fully automated removal in the system. |
| R3 | No targeted hatred or harassment based on race, ethnicity, religion, or similar protected traits | Report-driven, human decision. Criticism of ideas, policies, groups' actions, or public figures is explicitly allowed. |
| R4 | No doxxing (publishing private info) | Report-driven, human. Withhold first when the report is credible, decide within SLA. |
| R5 | No direct threats of violence | Report-driven, human, senior queue. |
| R6 | No spam, scams, or impersonation | Report-driven, human. Reputation signals help triage. |

### What automation may and may not do
- **May**: score images for R1 and mark them `withheld`; hash-match for R2; raise priority on reports (e.g. many high-reputation reporters); flag brigading patterns.
- **May not**: remove text for any rule, reduce reach, hide from explore, or suspend an account (except R2).

### Case lifecycle
1. **Report** — reporter picks a rule, optionally adds context. Duplicate reports on the same target merge into one open case. Weight accumulates from reporter reputation.
2. **Queue** — moderators see cases sorted by weight and age. R2/R5 go to a senior queue. Brigading-flagged cases go to the senior queue with the target protected (no withholding on report volume alone).
3. **Decision** — moderator picks an action (`none`, `withhold`, `remove`, `strike`, `suspend`) and must write a `public_reason` citing the rule. The author sees the exact content that was actioned, the rule, the reason, and an **Appeal** button. Strikes expire after 90 days; suspension requires 3 active strikes or an R2/R5 case.
4. **Appeal** — one appeal per case, free-text statement. Reviewed by a different moderator. Outcome and reason are shown to the author. Upheld appeals reverse the action and remove the strike.
5. **Transparency** — every closed case is copied to `transparency_log` without user identifiers. Public `/transparency` page shows monthly counts per rule, per action, appeal rate, and reversal rate.

### What the author experiences
- A withheld post shows to the author as "Under review for R1, usually within 24h" with the content still visible to them. Nobody else sees it.
- A removed post stays in the author's view with a red status chip and the reason. It is never silently gone.
- Suspension shows the case list and a link to appeal each one.

---

## 5. UI direction

The security and transparency story must be *visible* in the UI, not buried in settings. The frontend-design skill will be used at implementation time; this is the brief it gets.

- **Stack**: Expo + expo-router (file routes work on web and native), NativeWind for styling, Reanimated for motion, `expo-image` with blurhash placeholders.
- **Layout**: desktop web is three columns (nav / timeline / context panel with explore and transparency stats). Tablet collapses the context panel. Phone is a single column with a bottom tab bar and a floating compose button. Same components across breakpoints.
- **Look**: dark-first with a light theme, high-contrast editorial type (one display face for handles and headings, one text face), generous line height, restrained color. One accent for actions, and a fixed semantic set for status chips: under review (amber), removed (red), verified (blue). Avoid generic AI-looking gradients and glassmorphism.
- **Composer**: bottom sheet on phone, inline card on desktop. Character counter, image picker with alt-text prompt, live warning if the image scores near the R1 threshold *before* posting.
- **Transparency surfaces**: status chips on posts; "Your cases" screen; public `/rules` and `/transparency`; security screen listing devices, MFA state, and recent sign-ins with a one-tap "revoke all".
- **Accessibility**: WCAG AA contrast, reduced-motion respected, all images require or auto-suggest alt text, full keyboard navigation on web.
- **Motion**: small and purposeful. Sheet spring, like/repost micro-feedback, timeline insert of new posts. Nothing decorative.

---

## 6. Decomposition and build order

Each sub-project gets its own spec → plan → implementation cycle. Order chosen so every step ships something testable and the security floor exists before user content does.

| # | Sub-project | Delivers | Depends on |
|---|---|---|---|
| 0 | **Foundation** | Monorepo scaffold, `packages/contracts`, `packages/rules`, `packages/db` with Drizzle schema + migrations + the three Postgres roles, `infra/` Docker Compose (postgres, redis, minio, caddy, api, worker, cloudflared), Hono skeleton with security headers, CI (typecheck, vitest, semgrep, audit), hello-world reachable through a Cloudflare Tunnel | — |
| 1 | **Identity & auth** | Split into 1a core accounts and sessions (sign-up with email code and 16+ age check, optional password + HIBP, argon2id, lockout, TOTP MFA + recovery codes, cookie + CSRF / bearer sessions, devices, "wasn't me" link, re-auth, staff MFA; spec `2026-09-14-identity-auth-1a-design.md`), 1b account lifecycle (profile + handle changes, verified badge, data export, account deletion), 1c passkeys. | 0 |
| 2 | **Posting & feed** | Split into 2a text posting and feed (posts, replies, quotes, likes, reposts, bookmarks, follows, blocks/mutes, Following and Latest timelines, threads, profile pages, write limits, web screens; spec `2026-09-17-posting-feed-2a-design.md`), 2b images (upload, worker re-encode, EXIF strip, blurhash, alt text, media in composer and lists; spec `2026-09-18-images-2b-design.md`), 2c explore (ranked view, refresh job, tab). | 1a |
| 3 | **Trust & safety** | Report flow, case queue, decisions with public reasons, strikes, appeals, transparency log + page, brigading detection, author-facing case screens, admin console with MFA + audit log, CSAM scanning hookup, NSFW image scoring with automatic withholding for R1 (moved here from 2b on 2026-09-18, so that no post is withheld before a human can review it) | 2 |
| 3b | **Import from other platforms** | Archive upload for X, Mastodon, Bluesky; quarantine bucket; sandboxed streaming parser; preview and select; imported posts on profile only; same image pipeline and CSAM scan as native posts; one-click undo. See section 6a. | 2, 3 |
| 4 | **Hardening & launch** | Cloudflare WAF/rate rules tuned, ZAP scan clean, dependency audit clean, log scrubbing verified, IP-hash purge job, alerting, backup/restore drill, privacy policy + terms, external pen-test checklist walked | 3, 3b |
| 5 | **Native builds** | EAS builds for iOS/Android, SecureStore sessions, push notifications, store listings | 4 |

Sub-project 0 is small and will be planned immediately after this design is approved. Each later one starts with a short brainstorm to confirm details that this document leaves at the level of intent.

---

## 6a. Importing posts from other platforms (added 2026-09-14)

Users can bring their post history with them. The feature is opt-in, owner-driven, and treated as untrusted bulk input.

**How a user imports**
1. The user downloads their own official data export from the other platform: X "Download an archive of your data", a Mastodon account archive, or a Bluesky repository export (`.car`). Meta (Threads/Instagram/Facebook) and Reddit exports come later as extra adapters.
2. They upload that file on korbat's import screen. korbat never asks for another platform's password, never scrapes, and does not fetch posts by handle. Fetching by handle would let anyone import someone else's posts, which is impersonation.
3. korbat parses the archive in the worker and shows a preview: post count, date range, image count, and what will be skipped. The user picks everything, a date range, and whether to include replies.
4. Nothing is published until the user confirms. The import can be undone later in one action, which deletes every post from that import.

**Security controls**
- **Quarantine**: archives upload through a short-lived signed URL into a separate private `korbat-imports` bucket, never the media bucket. Size cap 2 GB. The archive is deleted as soon as parsing finishes, or after 24 hours if the user abandons the preview.
- **Sandboxed parsing** in the worker with its own memory and time limits: streaming unzip, reject path traversal, absolute paths and symlinks, cap entry count and total uncompressed size (zip-bomb guard), and read only an allowlist of known file paths per source. X's `tweets.js` is stripped of its `window.YTD...=` prefix and parsed as JSON, never evaluated.
- **Data minimisation**: archives contain DMs, IP logs, phone numbers, contacts and ad data. Only the allowlisted post and media files are opened. Nothing else is read, stored or logged.
- **Same rules as native posts**: every imported image goes through the normal pipeline (re-encode, EXIF strip, NSFW score, CSAM hash). An R1 score withholds that post for human review. A CSAM match aborts the whole import and follows the R2 process. Text is never auto-removed; it can be reported like any post.
- **Anti-abuse**: email-verified accounts only, one active import per user, at most 50,000 posts per import, worker concurrency capped so imports cannot starve normal traffic.
- **Provenance label**: every imported post shows "Imported from X · original date". An optional ownership check (put a one-time korbat code in the source profile's bio) adds a "verified import" mark, which helps against people importing archives that are not theirs.

**Product behaviour**
- Imported posts appear on the author's profile in original date order. They do not enter followers' chronological feeds or explore, so a 10,000-post import cannot flood anyone's timeline.
- @mentions and links stay as plain text. korbat does not map other platforms' users to korbat accounts, so it never implies someone is on korbat.
- Reposts of other people's content are skipped. Threads of the user's own posts are kept as threads.

**Designed for expansion**
- Each source is an adapter with two functions: `detect(entries)` recognises the archive, and `readPosts(stream)` yields a normalised `ImportedPost` defined in `packages/contracts`. Adding Threads or Reddit is a new adapter; the pipeline, preview and moderation path do not change.
- Schema is added by migration in this sub-project: an `import_jobs` table (owner, source, status, stats, timestamps) and nullable columns on `posts` (`import_job_id`, `source`, `original_created_at`, `original_url`). These are additive, so the Foundation schema does not need to anticipate them.

---

## 7. Testing and verification

- **Unit** (vitest, `apps/api`): contracts, rate-limit logic, reputation and report weighting, feed query builders, image pipeline (assert EXIF gone, dimensions capped, output is a fresh encode).
- **Auth module tests** (highest coverage bar in the repo): every flow in section 3a, including negative cases: expired codes, attempt exhaustion, lockout timing, session hash never equals the raw ID, CSRF token rejection, re-auth window expiry, recovery with and without MFA, constant-time behavior for unknown vs. known emails (timing assertion with tolerance).
- **Integration**: API against the Docker Compose stack (`docker compose -f infra/compose.yml up -d postgres redis minio`). Covers session cookie behavior, block enforcement in feed queries, case lifecycle including appeal-by-different-moderator rule, audit-log immutability (UPDATE/DELETE must fail), signed media URL expiry.
- **RLS and role tests**: run each table's policies as `korbat_api` and confirm it cannot SELECT from `auth.*`, cannot run DDL, and cannot bypass block filtering.
- **E2E** (Playwright on the Expo web build): sign-up → MFA → post with image → report → moderator decision → author sees reason → appeal → reversal.
- **Security checks in CI**: semgrep OWASP ruleset, `pnpm audit` at high severity, ZAP baseline scan against the preview URL, CSP header assertion test, rate-limit smoke test (burst must 429).
- **Manual pre-launch**: OWASP ASVS level 2 checklist walk-through, sensitive-action re-auth spot checks, "revoke all devices" actually invalidates sessions, deleted account leaves no public trace.

Every sub-project's plan will include its own slice of this list as acceptance criteria.

---

## 8. Immediate next steps on approval

1. Save this design as the spec at `C:\Users\Lenovo\Desktop\cool\korbat\docs\superpowers\specs\2026-09-03-korbat-design.md` in the new repo and commit it.
2. Run the writing-plans skill to produce the detailed implementation plan for **sub-project 0 (Foundation)**. Its scope:
   - `pnpm` monorepo at `C:\Users\Lenovo\Desktop\cool\korbat` with `apps/app` (Expo, expo-router, NativeWind, web target), `apps/api` (Hono, vitest), `apps/worker` (queue consumer skeleton), `apps/admin` (placeholder), `packages/contracts` (Zod), `packages/rules` (the six rules as data), `packages/db` (Drizzle schema + migrations).
   - `infra/compose.yml`: postgres 16, redis, minio, caddy, api, worker, cloudflared, all non-root; `infra/compose.dev.yml` override that skips cloudflared and exposes localhost ports. Init SQL that creates the `auth` schema and the three roles (`korbat_auth`, `korbat_api`, `korbat_migrate`).
   - Drizzle schema for every table in section 2, initial migration run by a one-shot `migrate` service using `korbat_migrate`, RLS enabled on all public tables.
   - Hono skeleton: security-headers middleware (CSP, HSTS, frame-ancestors, referrer policy), request-ID logging with PII scrubbing, Zod validation middleware, Redis rate-limit middleware, health endpoint, and a stub session middleware that sub-project 1 replaces with the real auth module.
   - CI (GitHub Actions): typecheck, vitest, semgrep OWASP ruleset, `pnpm audit --audit-level high`, `docker compose config` validation, Renovate config.
   - `.env.example` for every app and for `infra/`; secrets never committed.
   - Done when `docker compose up` on a laptop serves the health endpoint and the Expo web shell, and the same stack is reachable through a Cloudflare Tunnel on a throwaway subdomain.
3. Sub-projects 1 to 5 each get a short brainstorm to confirm details, then their own plan, in the order in section 6.

## 9. Amendments

### 2026-09-18, from the 2b images design (`2026-09-18-images-2b-design.md`)

- **Object storage.** MinIO's community edition was archived upstream in 2026 and gets no security fixes. korbat keeps images in two Docker volumes behind a small file protocol between the API and the worker. Wherever this document says MinIO, bucket or signed URL, read: volumes, and uploads and downloads streamed through the API. The storage interface leaves room for an S3 adapter.
- **The worker** only processes images. It has no network, no database or Redis credentials and no capabilities. Scheduled database jobs named in this document (the IP-hash purge, the explore refresh) run in the API under a Redis lock.
- **NSFW scoring** and the automatic withholding for R1 move from row 2 to row 3 of the build order, together with the composer warning in section 5.
- **`post_media`** has the shape of section 3 of the 2b design: an owner, a status, optional post and position until the image is attached, and no `path` column.
- **Media serving.** Images of visible posts are public and cacheable for five minutes at URLs ending in `.webp`, which is what Cloudflare's cache and its CSAM scanning tool need. Images of withheld and removed posts reach only their author and are never cached. The Cloudflare zone must use Browser Cache TTL "Respect Existing Headers".
- **Backups** (section 3d) cover the `media-store` volume instead of a MinIO mirror.
- **Imports (section 6a).** The quarantine bucket becomes a quarantine volume. Archives of up to 2 GB cannot pass Cloudflare's 100 MB request limit in one request, so imports need chunked uploads.

### 2026-09-23, from the audit (`2026-09-23-audit-fixes-design.md`)

Four read-only reviews (auth, image pipeline and deployment, social module, web client) and a dependency check were run on the repository at `f0c9799` before work continued. The audit design records every finding and its fix. What changes in this document's terms:

- **Technologies (section 1).** TypeScript 7 (the native compiler) for the API, worker and packages, TypeScript 6.0 for the Expo app; esbuild called directly instead of tsup; ioredis 6; **Valkey 9.1 (BSD-3) instead of Redis** (the service keeps the name `redis`, on a new volume `valkeydata`, because Valkey 9 cannot read Redis 7.4's RDB format 12 and the old volume held only transient state); **PostgreSQL 18** on a new volume, with `scripts/pg-major-upgrade.mjs` moving a database from the 16 volume; Caddy as its own user on port 8080; cloudflared, Caddy, the API and the data services on separate networks; every image pinned by digest, pnpm installed through corepack from its hash.
- **Retention (section 3b).** The IP-hash purge and the retention of codes, sessions and security events run in the API every ten minutes (audit design, section 5).
- **Method (section 6).** Sub-projects are still dry-run task by task in a scratch clone with a gated runner and turned into verified prompts; from this batch on the prompts are replayed into the repository by a deterministic script (`replay.py` in the scratch tooling) instead of a fresh model session per prompt. The proof is unchanged: every gate passes in the repository, every written file is byte-identical to the dry run, and `verify_prompts.py` reproduces the repository. The scratch clone lives at `C:/Users/Lenovo/Desktop/cool/korbat-scratch/` (throwaway), outside the temp folder Windows Storage Sense prunes.
- **Status and order (section 6).** Done: 0 (except Task 16, the tunnel), 1a, 2a, 2b, the screen-reader fix, this audit batch. Next, in order: 1b account lifecycle (profile and handle changes, verified badge behind a provider interface, data export, account deletion), 1c passkeys, 2c explore, 3 trust and safety (with NSFW scoring), 3b import, 4 hardening (owner-scoped RLS, backups and alerting, ZAP, policy texts), 5 native builds. The steps that need the user's own accounts come last and are written up as runbooks: the Cloudflare Tunnel, WAF and CSAM tool (Foundation Task 16 and sub-project 4), the EU mail relay, a verification provider for the badge, and the Expo, Apple and Google accounts for sub-project 5.

### 2026-09-24, sub-project 1b (`2026-09-24-account-lifecycle-1b-design.md`)

- **Delivered (section 6, row 1).** Profile editing, handle changes (once every 30 days, old handles reserved for ever: a change from section 2's "immutable after 30 days"), email change, the verified badge as a phone proof behind a `VerificationProvider` (development provider and a Vonage Verify adapter; the production credentials are the user's, runbook in the 1b design's section 13), a streamed ZIP export, and account deletion (fresh authentication, emailed code, typed handle; tombstoned posts, anonymised rows, a resumable purge job). Avatars stay deferred.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 2a, 2b, the screen-reader fix, the audit batch. Next, in order: 1c passkeys, 2c explore, 3 trust and safety, 3b import, 4 hardening, 5 native builds; the account-dependent steps stay runbooks (the tunnel and WAF, the mail relay, the verification provider, the store accounts).

### 2026-09-27, sub-project 1c (`2026-09-25-passkeys-1c-design.md`)

- **Delivered (section 3a and section 6, row 1, phase 2).** Passkeys for sign-in and re-authentication through `@simplewebauthn/server` 14 behind one wrapper with korbat's own checks; WebAuthn challenges are stateless and sealed rather than kept in Redis (a change from section 2's `auth.webauthn_challenges` note), so unauthenticated requests store nothing. Session factors with two levels of fresh authentication, in-place token rotation, and one lockdown routine behind every "this wasn't me". Passkeys are not yet promoted to the default sign-in: the email code stays the recovery root.
- **Left to later sub-projects.** Staff sign-in with a passkey as the required second factor (sub-project 3, with the admin console), bearer sessions and native passkeys in the apps (sub-project 5), and the production domain that fixes the relying party (Foundation Task 16, the user's).
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, the screen-reader fix, the audit batch. Next, in order: 2c explore, 3 trust and safety, 3b import, 4 hardening, 5 native builds.

### 2026-09-28, sub-project 2c (`2026-09-28-explore-2c-design.md`)

- **Delivered (section 2's feed queries and section 6, row 2).** Explore: a ranked list of recent original posts, refreshed every five minutes by a job in the API into numbered rankings (`explore_runs`, `explore_items`) rather than a materialized view. On PostgreSQL 18 a materialized view has no row level security, is not listed in `pg_tables`, and `korbat_api` could refresh it only with a new `GRANT MAINTAIN`; a table also takes the time as a parameter and keeps the previous ranking for readers paging through it. One input, the number of distinct eligible approving accounts; the whole formula published at `/explore/about` with a version and a change log; an author switch and an author-only status. Search and hashtags, which the 2a design placed in 2c, are not part of it: each is a sub-project of its own if wanted.
- **Reputation (section 3c).** Explore reads account age as a rule about which engagement is valid (the engaging account must have been at least 48 hours old), never as a weight. Reputation still never ranks or hides content, and no ranking reads the badge, followers or reports.
- **Automation (section 4).** No lever acts on Explore alone. A post leaves it only through its moderation state, which applies to every list at once, its author's switch or deletion, and the reader's blocks and mutes; that is the only form an Explore exclusion may take, for moderators as for automation.
- **Left to later sub-projects.** Sub-project 3: a restored time for posts restored after review, which restarts the window and the age; whether a suspended account's likes and reposts count and whether its posts are candidates, each a formula change with a new version; rule R6 naming coordinated engagement. Sub-project 3b: the import marker in the one candidate predicate (`exploreRules` in `apps/api/src/social/repo.ts`). Sub-project 4: per-IP engagement limits; the like counts a blocker can compare after a block, since 2a's block deletes the pair's likes; the reviewed terms with the Explore sentence, and whether Article 27 of the Digital Services Act applies. Sub-project 5: the web polish the audit parked at "2c or 5" (the light theme, per-screen titles, a branded error boundary, reanimated on the web), and rows a list appends that a headless Chromium draws only at the next scroll.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, the screen-reader fix, the audit batch. Next, in order: 3 trust and safety, 3b import, 4 hardening, 5 native builds.
````

### Replace `docs/superpowers/specs/2026-09-28-explore-2c-design.md` (whole file)

```markdown
# korbat sub-project 2c: Explore

Date: 2026-09-28. Status: written without the user under the standing instruction of 2026-09-23 (keep going; leave only account-dependent steps). The decisions in section 2 were taken here and are flagged for review. Research: `korbat-scratch/research-2c/{repo,practice,threats,pg-facts}.md` (a repository map, a survey of published rankings with lab measurements on PostgreSQL 18.6 at 300,000 posts and 2.7 million likes, a threat model of 21 threats, and privilege checks run on the scratch stack), every fact with its source. The draft went through an adversarial review by four critics (fit to the code, security and privacy, the product's promises, the SQL and the task plan); their 57 findings and what was done with each are in `korbat-scratch/research-2c/spec-review/`, followed by a second round that checked the revision (19 findings, all applied).

## 1. Context

korbat has a chronological Following timeline, a public Latest timeline of every visible top-level post and quote, threads, and profiles (2a, `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`). Discovery beyond them is the handle box. The main design (`2026-09-03-korbat-design.md`) asks for an Explore tab: "a materialized view refreshed every few minutes ranking recent posts by engagement, same block filtering at read time" (line 113). It also binds any ranking with three promises: there is no silent reach reduction (line 10), reputation (account age, the verified badge, upheld reports, strikes) is "never used to rank or hide content" (line 146), and automation "may not ... hide from explore" (line 180).

A ranked page is also an amplifier, and korbat's users post unpopular opinions and are targets. The research found that the public counters are unsafe inputs (they count the author's own engagement, a single account's many replies and quotes, and likes from accounts created minutes ago), that quote "dunks" would put a target's post under mockery on a public page, and that a published per-post score leaks private facts (whether the author liked their own post, whom they blocked). Explore v1 therefore ranks by one input, the number of distinct eligible accounts that approved of a post, shows only the order, publishes its whole formula, and lets every author keep their posts out.

## 2. Decisions taken without the user

| Topic | Decision | Alternatives rejected |
|---|---|---|
| Scope | Explore only: a ranked list of recent original posts, its refresh job, a Home tab, a public page explaining the formula, an author setting, an author-only status and an "In Explore" chip on the author's own posts. Search and hashtags are not in 2c: the main design's build order gives 2c "explore (ranked view, refresh job, tab)" (line 218, amended), each is a project of its own, and keyword search is a ready tool for finding a target's posts. Flagged: a later sub-project if wanted. | Search and hashtags in 2c, as the 2a design listed them (line 45). |
| Storage | An ordinary table of numbered rankings ("generations") written by a job, not a materialized view. Checked on PostgreSQL 18.6 (`research-2c/pg-facts.md`): a materialized view cannot have row level security, is not listed in `pg_tables` (so the test reset would not empty it), and the API role could refresh it only after a new `GRANT MAINTAIN`; its query is fixed, so tests could not move its clock, and it holds one ranking at a time, so a reader paging across a refresh would see repeats or gaps. A table has RLS like every korbat table, needs no new privilege, takes `now` as a parameter, and keeps the previous ranking for readers mid-page. | The main design's materialized view refreshed concurrently. |
| What is ranked | Original posts only: visible top-level posts that are not quotes, by live authors who have not switched Explore off, created in the last 48 hours. Replies never enter (they belong to threads); quotes do not enter in v1, because a quote that mocks its target would put the target's post under the mockery on a public page, and the target cannot remove a quote. | Quotes admitted when the quoted post is visible and its author allows Explore (a later version may). |
| The one input | Approving accounts: the number of distinct accounts, other than the author, that liked or reposted the post, counted at the refresh. An account that both liked and reposted counts once. Replies and quotes are not counted: in the lab a pile-on of repliers reached any threshold set on all engagement, and hostile conversation would otherwise lift a target's post. | The public counters (they include the author's own engagement and one account's many replies); replies and quotes at a discount. |
| Which engagement counts | A like or repost counts when its account is live (not deleted), is not the post's author, was at least 48 hours old when it engaged, and the engagement has stood for at least 10 minutes. Each is a yes-or-no rule about the engagement, the same for every post; none looks at the post's author. The 48 hours match the 2a gate that already refuses reposts and quotes from accounts under 48 hours; the 10 minutes stop likes that are made just before a refresh and undone after it. Flagged: account age is also an input of the reputation score, which may never rank (main line 146); this design reads it as a rule about which engagement is valid, never a weight, and the main design is amended to say so. Flagged too, the cold start: on a new instance every account is younger than 48 hours, so Explore stays empty for about two days after launch, and a like made in an account's first two days never counts, even after the account ages. | Counting every like; weighting likes by the liker's age, badge or followers (each would publish facts about the liker and reward handing over a phone number). |
| Score | `approvers / (hours + 2)^1.8`, hours since the post was created at the refresh time (never negative): the gravity formula of Hacker News, Lemmy and Bluesky's 2023 What's Hot. A post needs at least 3 approving accounts. | Mastodon's squared engagement halving each hour; Reddit and Lobsters' absolute-time score; newest first after a threshold. |
| Page rules | At most 2 posts per author in one ranking; the list holds the first 300 by score, ties broken by the post id. | Unlimited per author. |
| Rings | No per-account "influence budget" and no "once per author" rule in v1. Both dilute a genuinely active account as much as a ring, both are hard to state on the public page, and a ring that approves only its targets escapes them. Rings are bounded by the engager age, distinct accounts, the threshold, the per-author cap and the existing limit of 100 likes an hour per account. Flagged, with the two steps that follow: per-IP engagement limits (sub-project 4) and rule R6 naming coordinated engagement (sub-project 3). | An influence budget (each account's approvals shared across the posts it approved); an account counted once per author per window; a sublinear count. |
| Refresh | Every 5 minutes by a job in the social module under the existing Redis lock. A round writes nothing while the newest ranking is younger than 4.5 minutes, so at most one ranking lands per interval whatever the number of API instances or restarts; a round runs at start, which fills Explore after downtime or on a new database. Each ranking is one statement with the refresh time passed in. 2 rankings are kept (the current one and the one before), so a reader has at least 4.5 minutes to page through one. | Refresh on read; keeping more rankings (an engagement history the data model deliberately does not have). |
| What a reader sees | Only the order. Items are ordinary post views with their public counts; no score, rank number or breakdown in answers, cursors or logs; the cursor names the last post read, not a position. The answer carries the time the ranking was computed. What the order still tells, accepted as the cost of counting distinct eligible accounts: for a post at the threshold, being listed or not shows whether one of its likes is its author's own, a reposter's, or from an account under 48 hours old. | A per-item "why is this here" breakdown (it would publish, for instance, whether the author liked their own post). |
| Transparency | A public page, "How Explore works", states every rule and constant with a version number and a dated change log; the numbers come from the same constants the refresh uses, and tests hold both to them. An author can ask of any of their own posts whether it is in the current Explore and, if not, which rule kept it out, without any count (a live count would let an author work out which accounts liked the post). The status judges "now" as well as the ranking, so it gives its author, per request, the same threshold bit that being listed gives everyone; that is part of the accepted cost. The author's own posts carry an "In Explore" chip while they are listed; it leads to the post, whose status line leads to the switch and to How Explore works. | A secret formula (it cannot answer "why is my post not in Explore", and at korbat's size it would be worked out within days anyway); telling authors their count of approving accounts. |
| Author choice | "Show my posts in Explore", a per-account switch in Settings > Privacy, on by default, saved through its own routes (`POST` to turn it on, `DELETE` to turn it off, as the app's other switches are); turning it off takes effect at the next read, not the next refresh, and turning it back on at the next refresh. It is the target's way out of an amplified pile-on, and it is not reach reduction because the author chooses it. The status line leads to it. Flagged: the default (Mastodon's equivalent is off by default) and whether a per-post switch is wanted later. | Off by default (Explore would stay empty on a small network); a per-post switch in v1; the switch on the profile edit route (it would share the profile's edit limit and its public answer). |
| Moderation | Only a post's state moves it: withheld, removed and deleted posts leave Explore at the next read, for everyone, their author included (unlike Latest, where an author sees their own withheld post). Moderators and the automatic R1 and R2 checks set that state for every list at once; no lever acts on Explore alone, for moderators or for automation, and every exclusion is a uniform, published rule. The main design's line 180 is amended to say this is the only form an Explore exclusion may take. Flagged for sub-project 3: 2c ranks by creation time, so a post withheld and restored after review could re-enter only within its first 48 hours; sub-project 3, which adds restoring, adds a restored time and restarts the window and the age at restoration. Sub-project 3 also decides, as uniform rules in the same two predicates, whether a suspended account's likes and reposts count and whether its posts are candidates; any such effect on Explore, as engager or as author, is a formula change with a new version and a change-log entry. Until sub-project 3 nothing in the code sets withheld or removed, so Explore, like every list, relies on it before the instance is public. | A "do not promote" flag; demoting posts a detector suspects. |
| Blocks and mutes | Applied at every read to the live rows, in both directions for blocks, before the page limit, then the view builder re-checks as for every list. A block already deletes the pair's likes and reposts of each other's posts, so a blocked account's approval never counts. That deletion is 2a's and has a cost 2c does not add but builds on: a blocker who compares their posts' like counts before and after learns which of them the blocked account liked. Flagged for sub-project 4. | Filtering at refresh time only. |
| Signed out | Signed-out readers get the first page of Explore, at most 20 posts whatever limit they ask for, and no cursor; further pages need an account. It is a sign-in prompt, not a control against scraping (Latest stays fully public, and an account is free); the author's switch is that control. Flagged. | The whole list signed out; Explore for signed-in readers only. |
| Caching | Every answer stays `no-store`, as every korbat answer is today. A signed-in answer carries the viewer's own like, repost and bookmark flags and is filtered by their blocks, so a shared cache must never store it; a page costs 1 to 9 ms to read (measured). | `public, max-age` for signed-out answers. |
| Where it lives | A third tab on Home, "Explore", beside Following and Latest; signed-out visitors get the Latest and Explore tabs (Latest first, as today). The tabs get addresses (`/?tab=explore`), so other pages can link to one. On wide screens the context column shows the first three posts of Explore above the handle box, as the main design's layout has it. | A route of its own in the navigation. |
| Languages | None in v1. | Author-declared post languages. |
| Terms | One sentence joins the terms: public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps one's posts out. The draft terms' version stays (as in 1b and 1c, before any public sign-up); sub-project 4's reviewed terms carry the sentence and decide whether Article 27 of the Digital Services Act applies. Flagged. | Changing the terms version now (the app, the API's setting, the test configuration and the smoke command change together). |

## 3. Research (facts the design depends on)

- **PostgreSQL 18.6, checked on the scratch stack** (`pg-facts.md`): `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on a materialized view fails ("not supported for materialized views"); a materialized view is not in `pg_tables`; `korbat_api` gets "permission denied" refreshing one it does not own and succeeds only after `GRANT MAINTAIN`.
- **Cost** (lab, PostgreSQL 18.6 from the image korbat pins, synthetic data of 5,000 accounts, 300,000 posts, 2.7 million likes, 400,000 reposts; `practice.md` section 4.5 and `lab/out/`): the refresh reads about 10,000 candidate posts through `posts_latest_idx`; with an index on the engagement's `created_at` it takes 170 to 200 ms, a BRIN index (24 kB) as fast as a btree one (52 MB) while rows stay in insertion order; without any such index the planner scans every like, 734 ms. Reading one page with block and mute filters takes 1 to 9 ms.
- **Thresholds and caps elsewhere** (`practice.md` sections 1 and 2): Mastodon trends need 5 distinct accounts and keep one post per account; Bluesky's What's Hot needed more than 10 likes (later at least 12); Hacker News subtracts the author's vote and "sock" votes. In the lab 3,883 posts had at least one counted account in 48 hours and 2,921 had at least 3; a cap of 2 per author cut 5,795 qualifying posts to 2,921.
- **Transparency elsewhere** (`practice.md` section 3): Lobsters publishes its whole ranking and promises no shadow banning; Hacker News, Reddit and X keep parts private to limit gaming. At korbat's size the formula is inferable from the public counts within days (`threats.md` T19), so secrecy buys little and the protection has to come from what is counted.
- **The repository** (`repo.md`): timeline cursors are strict millisecond `{ t, id, r? }` objects that cannot carry a ranking; jobs run in the API through `createJob` (`apps/api/src/lib/jobs.ts`) under a Valkey lock, the timer's first round one interval after start, and only the timer's rounds are caught and logged; `korbat_api` owns nothing and has no DDL; every table has RLS and a `korbat_api` policy, enforced by `packages/db/test/schema.test.ts`, which also pins the table count (22); every API answer is `no-store`; mutes are filtered only in SQL, while the view builder re-checks state and blocks on live rows; the integration suites share one database emptied at the start of the run, and the reset truncates what `pg_tables` lists; `db.execute` returns `bigint` as text.

## 4. Scope

In: migration 0011 (a profile column, two tables, two BRIN indexes), the ranking and its job, `GET /api/timeline/explore`, `GET /api/posts/:id/explore` (the author's status), `POST` and `DELETE /api/me/explore` (the switch), the switch in `/api/me` and the export, the author's `inExplore` flag on their own post views, the web app's tab, list, formula page, switch, status line, chip, context column and terms sentence, and the tests, including the smoke test.

Out: search, hashtags, languages, personalised ranking, quotes and replies as Explore items, a per-post switch, per-IP engagement limits (sub-project 4), the R6 amendment, suspension and restoration rules (sub-project 3), and the web polish items the audit parked at "2c or 5" (the light theme, per-screen titles, a branded error boundary, reanimated on the web), which move to sub-project 5.

## 5. Architecture

Explore belongs to the social module (`apps/api/src/social/`), which owns posts, engagement, blocks and mutes. The repository (`repo.ts`) gains the refresh statement, the page read, the status read and the switch's write, all in raw SQL like its other reads. A new flow file `flows/explore.ts` holds the page, status and switch flows; `explore.ts` in the module builds the job. `createSocial` returns `startExplore(lock)` beside its routes, as the auth, media and account modules return their jobs, and `apps/api/src/index.ts` starts and stops it with the others. Two places outside the module change with the switch: `/api/me`'s profile comes from the auth module's `ProfileStore` (`apps/api/src/profiles/store.ts` `find()`, and the in-memory store of the integration harness), and the export's profile section is written by the account module (`apps/api/src/account/flows/export.ts`) from the social module's `ProfileExport` (`exportHead` in `repo.ts`).

Every number of the formula lives in one constant, `EXPLORE_V1` in `packages/contracts/src/explore.ts`: the window (48 hours), the engaging account's minimum age (48 hours), the engagement's minimum standing (10 minutes), the threshold (3), the gravity (1.8) and offset (2 hours), the per-author cap (2), the list length (300), the refresh interval (5 minutes) and the minimum gap between rankings (4.5 minutes), the rankings kept (2), the signed-out page (20), the formula version (1), and the change log (version 1, 2026-09-28, first version). The refresh takes the formula as an argument that defaults to `EXPLORE_V1` and passes its numbers into the SQL as parameters; the web app's formula page and texts print them.

## 6. Data model (migration 0011)

- `profiles.show_in_explore boolean not null default true`. It is never added to `ProfileView` (the public profile): an author's choice is theirs.
- `explore_runs`: `generation integer generated always as identity primary key` (one ranking every 5 minutes lasts 20,000 years in an integer), `as_of timestamptz not null` (the refresh time passed in), `formula smallint not null`, `candidates integer not null` (posts that passed the candidate predicate at `as_of`), `items integer not null`, `took_ms integer not null`. RLS on, policy `explore_runs_api_all` for `korbat_api`.
- `explore_items`: `generation integer not null references explore_runs(generation) on delete cascade`, `position integer not null` (1 to `items`), `post_id uuid not null references posts(id) on delete cascade`, `author_id uuid not null references profiles(id) on delete cascade`; primary key `(generation, position)`, unique `(generation, post_id)`. RLS on, policy `explore_items_api_all`. No score or count is stored: nothing reads them after the insert, and the order is the position.
- `likes_created_brin` and `reposts_created_brin`: BRIN indexes on `created_at`. `likes`, `reposts` and `bookmarks` come from one table factory (`userPostTable` in `packages/db/src/schema/content.ts`); it gains an option for the BRIN index, set for likes and reposts only. They keep the refresh bounded while rows stay roughly in insertion order; unlikes, blocks and purges let later rows fill old pages and erode that, but the refresh stays under a second at the lab's scale even with none.
- Privileges come from the default privileges of `0001_grants.sql` (select, insert, update, delete on new tables; usage on the identity sequence). The schema test's table count becomes 24.

## 7. The ranking (Explore v1)

A round is `refreshExplore(asOf, formula = EXPLORE_V1)`, `asOf` = `deps.now()`:

1. `begin`; `set local statement_timeout = '30s'`; `set local lock_timeout = '5s'`.
2. If the newest `explore_runs.as_of` is later than `asOf - 4.5 minutes`, commit and return `{ skipped: true }`: the ranking is fresh.
3. `insert into explore_runs (as_of, formula, candidates, items, took_ms) values (asOf, formula.version, 0, 0, 0) returning generation`.
4. One statement, whose CTEs yield both counts:
   - **Candidates** `c`: `posts p join profiles a on a.id = p.author_id` where `p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible' and p.created_at > asOf - window and p.created_at <= asOf and a.deleted_at is null and a.show_in_explore`. This is the one candidate predicate: sub-project 3b adds its import marker here (the main design's line 247 keeps imported posts out of Explore), and sub-project 3 its suspension and restoration rules.
   - **Engagement** `e`: the likes and the reposts (`union all`) with `created_at > asOf - window and created_at <= asOf - standing`, joined to `c` by `post_id` and to the engaging account's profile `u`, kept when `e.user_id <> c.author_id`, `u.deleted_at is null` and `u.created_at <= e.created_at - engager age`.
   - **Approvers** `ap`: `count(distinct e.user_id)::int` per post; posts with fewer than the threshold leave.
   - **Scored** `s`: `score = approvers / power(greatest(0, extract(epoch from (asOf - c.created_at)) / 3600) + offset, gravity)`.
   - **Author rank** `r`: over `s`, `row_number() over (partition by author_id order by score desc, post_id desc)` as `author_rank` (a level of its own: a window cannot order by an alias of its own select).
   - **Kept** `k`: the rows of `r` with `author_rank <= cap`, numbered `row_number() over (order by score desc, post_id desc)` as `position`, the first `list length`.
   - `ins`: `insert into explore_items (generation, position, post_id, author_id) select ... from k returning 1`; the statement selects `(select count(*) from c)::int` and `(select count(*) from ins)::int`.
5. `update explore_runs set candidates = ..., items = ..., took_ms = ...` for this generation.
6. `delete from explore_runs where generation < (select min(generation) from (select generation from explore_runs order by generation desc limit kept) g)`, which cascades to its items.
7. `commit`; one `info` log line with exactly the generation, candidates, items and milliseconds (no post ids, no scores).

The current ranking is the highest generation. If a lapsed lock ever let two rounds overlap, the later one either skips (step 2 sees the other's run once it commits) or, if both passed step 2, the higher generation wins whichever commits first and the other is simply the previous ranking.

## 8. Reads

- **`GET /api/timeline/explore`** (`Pagination` query; no session needed). The cursor is Explore's own: base64url of the strict JSON `{ g, id }`, `g` an integer from 1 to 2,147,483,647 and `id` a uuid (the last post of the previous page), nothing else. Without a cursor the read uses the current generation. With one: `g` above the current generation is 400 `invalid_request`; `g` not kept is 409 `explore_refreshed` ("Explore was refreshed."); `id` not in `g` is 400 `invalid_request`; otherwise the read continues after that post's position. These checks and the page are one statement, which yields the current generation, whether `g` is kept, `id`'s position in `g` and the rows after it, so a round that prunes `g` in between cannot turn a 409 into a 400 or an empty page; the flow answers 400 or 409 from that statement's result. A signed-out request's `limit` is capped at 20, its `nextCursor` is always null, and a signed-out request with a cursor is answered 401 `unauthenticated` ("Sign in to see more of Explore.") by the route itself, before the flow. The repository reads the generation's items after the position, joined to the live post and author, kept when `p.state = 'visible'` (for every viewer, the author too; not `visibleTo`), the author's `deleted_at is null` and `show_in_explore`, and, for a signed-in viewer, no block in either direction between the viewer and the author and no mute of the author; filters before the limit; ordered by position. It answers `{ postId, position }` rows; the flow gives the view builder `{ postId, sortAt: the generation's as_of, reposterId: null }` rows (post items only) and forms `nextCursor` from the repository rows, not the items: null when fewer rows came back than the limit, otherwise `{ g, id: the last row's postId }`. The answer is `{ items, nextCursor, computedAt, signInForMore }`: `computedAt` the generation's `as_of`; `signInForMore` true only for a signed-out reader when a post exists past the page: the flow reads one row more than the limit through the same filters, answers the limit, and sets it when the extra row came back. Before the first round it is `{ items: [], nextCursor: null, computedAt: null, signInForMore: false }`.
- **`GET /api/posts/:id/explore`** (session). Only the post's author gets an answer; anyone else, and an unknown post, gets 404 `not_found`. The answer is `{ status, computedAt }` with no count. `status` is the first that applies: `reply`, `quote` (neither ever enters), `not_visible` (the post is withheld, removed or deleted), `hidden_by_author` (the switch is off), `listed` (in the current generation; a listed post stays listed until the next round, even past its window), `outside_window` (older than the window now), `no_ranking` (no generation yet), `new_since_ranking` (created after the ranking's `as_of`), and then, from one bounded query about this post alone, never a ranking, which applies every rule of section 7 with `asOf` equal to the request time (the 10-minute standing included) and again with the ranking's `as_of`: `below_threshold` (under the threshold now); `pending` (met now but not at the ranking's `as_of`: the next refresh considers it); `author_cap` (met at `as_of`, and the current generation holds `cap` items of this author: the cap keeps an author's best posts, so no score is needed); `below_cutoff` (met at `as_of`, the author holds fewer than `cap` places, and the generation holds `list length` items); otherwise `pending` (met at `as_of` but left out then for a cause that has since gone, such as the switch turned back on).
- **`POST /api/me/explore`** turns the switch on and **`DELETE /api/me/explore`** turns it off (session, onboarding; no body, as the app's other switches); both answer `{ showInExplore }`. Only the global request limit applies; they record no event. `MeProfile.showInExplore` carries the state in `/api/me`, and the export's profile section carries it too (additive; the format stays `korbat-export-1`).
- **The author's chip**: `PostView` gains `inExplore?: true`, set by the view builder exactly when the status would answer `listed` (the viewer's own visible post, in the current generation, with the viewer's switch on; one batched query per page, only for posts the viewer wrote); nobody else's view carries it. It sits on the post view, not in `ViewerPostState`, because the like, repost and bookmark answers replace a card's viewer state.

## 9. The job

`explore-refresh`, built with `createJob` (`apps/api/src/lib/jobs.ts`): interval 5 minutes, lock time 5 minutes (refreshed at half while a round runs). `startExplore(lock)` runs one round at once and catches its failure itself (`job.round().catch(...)` logging `job: round failed`, as the timer does), so a failing start round never crashes the process, then starts the timer. The round is a plain function of `now` and the formula, so tests call it directly and move the clock; the job is also tested under `MemoryJobLock`. A failed round leaves the previous ranking in place, and the answer's `computedAt` shows its age.

## 10. Contracts

`packages/contracts/src/explore.ts`: `EXPLORE_V1` (section 5), `ExplorePage` (`items: TimelineItem[]` of kind `post`, `nextCursor: string | null`, `computedAt: string | null`, `signInForMore: boolean`), `ExploreStatus` (`status` from section 8, `computedAt`) and `ExploreSettingResponse` (`{ showInExplore: boolean }`). The social error codes gain `explore_refreshed` (409), with its message in the module's messages. `MeProfile.showInExplore`, `PostView.inExplore` (optional) and the export's profile field come in Task 3 with the code that fills them.

## 11. Web app

- **Home** (`apps/app/src/app/index.tsx`): a third tab, Explore; the tab is read from `/?tab=` so pages can link to it. Signed out, Home shows two tabs, Latest and Explore, with Latest first as today, and the prompt under them fits the tab. Following's empty text points to both Latest and Explore.
- **The Explore list** (a component of its own on the pattern of `PagedList`, one request at a time): under the tabs, "Updated N minutes ago" and a "How Explore works" link; when `computedAt` is older than 15 minutes, "Explore has not been updated since <time>". On `explore_refreshed` the list keeps the posts on screen, fetches the current ranking from its first page on, appends only posts not already shown until a page adds some or the ranking ends, keeps the focus at the list's footer, and says in a polite status line "Explore was refreshed; the posts below come from the new ranking." A signed-out reader's list ends with "Sign in to see more of Explore" when `signInForMore` is true. The empty state is an element, worded from `EXPLORE_V1`: "Nothing to show in Explore right now. A post appears here when at least 3 other accounts, each at least 2 days old, like or repost it in its first 48 hours. Explore is refreshed every 5 minutes." with the How Explore works link and a "Show Latest" button that switches the tab.
- **How Explore works** (`/explore/about`, public): what is ranked, what counts, the score, the page rules, the refresh, the cold start, and what takes a post out besides the formula: "its moderation state, set by a moderator or by the automatic R1 and R2 checks for every list at once; its author's switch or deletion; a block between you and the author in either direction; your mute. No moderator or automatic lever acts on Explore alone." Then the version and the change log. Every number comes from `EXPLORE_V1`.
- **Settings > Privacy**: the switch, react-native-web's `Switch` with the accessible name "Show my posts in Explore", disabled while saving, put back with an error message when the save fails; one sentence says what it does. Its state comes from `/api/me`; it saves with `POST` or `DELETE`, which the app's client already sends.
- **The author's post screen** (`apps/app/src/app/post/[id].tsx`): for the author, one line under the post from `GET /api/posts/:id/explore`, in the formula's words and from `EXPLORE_V1` ("In Explore"; "Not in Explore: fewer than 3 approving accounts. Your own likes, accounts under 2 days old and likes from the last 10 minutes do not count."; "Not in Explore yet: the next refresh will consider it."; "Not in Explore: two of your posts rank above it."; ...), linking to How Explore works and to the switch. Replies and quotes show no line. The switch's text says that turning it back on takes effect at the next refresh.
- **The chip**: the author's own post cards show "In Explore" while `post.inExplore` is set, linking to the post, whose status line leads on.
- **Context column** (1024 px and wider, `AppShell`): "Popular now", the first three posts of Explore as links to their threads, above the handle box.
- **Terms** (`apps/app/src/lib/terms.ts`): the sentence of section 2, without changing the version.

## 12. Security and privacy

The threats of `research-2c/threats.md` map to controls:

- Rings, sockpuppets and accounts made to boost (T1, T2): distinct accounts only, the 48-hour engager rule, the threshold, the per-author cap, the existing like limit (100 an hour per account) and the 48-hour gate on reposts. Per-IP limits are sub-project 4's; the decision against an influence budget is in section 2.
- Self-engagement (T3): the author's own likes and reposts never count. Across one owner's several accounts: bounded by the engager rule and the cap; the ranking reads no IP or device signal and never reads the auth schema.
- Brigades, pile-ons, dunks (T4, T5, T17): replies and quotes neither enter nor count; the author's switch takes a post out at the next read.
- Blocks and mutes (T6, T7): live, in SQL before the limit, both directions for blocks; a block already deletes the pair's approvals.
- Moderation and deletion (T8, T9): only `visible` posts of live authors are read, at every read and for every viewer; the view builder re-checks.
- What leaks (T10): only the order, with the threshold bit of section 2, which the author's status also gives its author per request; approvers are counted from yes-or-no rules; the author's status carries no count; the cursor names a post, not a position; no bookmark, view, click, IP or device signal; no per-post score in logs; two rankings kept.
- Scraping and caching (T11, T12): the author's switch keeps a target out; the signed-out page (at most 20 posts, no cursor) is a sign-in prompt, not a control; every answer is `no-store`, a test holds it for a signed-in Explore answer.
- Denial of service (T13, T14): one bounded statement per refresh with statement and lock timeouts, at most one ranking per 4.5 minutes, the window read through the partial and BRIN indexes, at most 300 items, keyset reads on `(generation, position)`, the status as one bounded query about one post, no ranking at read time, and no read ever triggers a refresh; cursor fields are bounded, so a forged value is a 400, never a 500.
- Cursors (T15): Explore's own strict `{ g, id }`; a pruned generation is 409, a future one or a post outside it 400.
- Imports (T16): the one candidate predicate is where 3b adds its marker.
- Links (T18): no link previews; the existing `noopener noreferrer` and `no-referrer`.
- Snapshot timing (T20): engagement counts after 10 minutes.
- Account takeover (T21): no ranking bonus for old or verified authors, so a taken-over old account ranks like any other.

## 13. Testing

- **The clock and the rankings in tests**: the integration suites share one database and run one file at a time, so every test that runs a round starts by deleting `explore_runs` (the cascade empties `explore_items`) and asserts on the generation its round returns; the ranking suites run their clock in an epoch of their own in the past (for example from 2020-01-01), with their accounts dated from it, so every other suite's rows lie after `asOf` and never enter, and each ranking and read test uses a window of its own; the job tests run the real refresh with a formula whose minimum gap is zero, or move the clock past it.
- **Unit**: the Explore cursor (round trip, strictness, bounds: `g` 0, above 2,147,483,647, a non-integer, a missing or extra field); `EXPLORE_V1`'s shape; the formula page's and the empty state's numbers equal `EXPLORE_V1`.
- **Integration (the ranking)**, the round as a function of `asOf`: the window's edges; replies, quotes, withheld, removed and deleted posts, deleted authors and authors with the switch off never enter; a future-dated post never enters; the author's own likes and reposts, likes and reposts from accounts under 48 hours old at the time (a repost written through the repository, which does not apply the tier), from deleted accounts, and younger than 10 minutes do not count; an account that liked and reposted counts once; three eligible repliers, three eligible quoters and two approvers keep a post out; the threshold; the order by score across a post older than 24 hours and the tie-break; an author with three qualifying posts keeps two; the list length; positions run from 1 without gaps; a round within 4.5 minutes of the last writes nothing; only two generations are kept, with the older one's items gone; a round with a changed threshold, cap and list length follows them; the round's log line holds exactly its generation, candidates, items and milliseconds.
- **Integration (the reads)**: blocks both ways and mutes filter before the limit; a listed post withheld, removed or deleted after the refresh is absent from the next read, its author's own read included; an author who switches Explore off or is deleted leaves at the next read; paging through one generation while a new one lands; a pruned generation is 409, a future one or a post outside it 400; a page cut exactly at the limit carries a cursor whose next page is empty with `nextCursor` null; before the first round the answer is empty with `computedAt` null; the status route's every reason, for the author only, with no count; a post listed at `as_of` whose 48 hours pass before the next round still answers `listed`; a post whose author switches Explore back on after a round answers `pending`; the chip (`inExplore`) on the author's own listed posts only, and gone at once when the post is withheld or the switch is turned off, before any further round.
- **HTTP**: the route answers signed out (at most 20 posts, `?limit=50` included, no cursor, `signInForMore`), refuses a signed-out cursor with 401, is `no-store` signed in, and carries `computedAt`; the status route is 404 for anyone but the author; `POST` and `DELETE /api/me/explore` and `/api/me`'s state; the export carries the switch.
- **Job**: one round at start, whose failure is logged and leaves the timer running, and one per interval under `MemoryJobLock`; a failed round keeps the previous ranking.
- **Web**: the Home tabs and their addresses, the empty state, the formula page's numbers, the switch's markup (role `switch`, its name, its checked state), the chip and the status line's wording (server-rendered checks and source scans, as the app's tests do).
- **Smoke**: after the stack is up, `GET /api/timeline/explore` answers a valid page; `computedAt` is set within a minute and, measured against the answer's `Date` header rather than the host's clock, is never older than 11 minutes (the round at start, or the interval since the last round).

## 14. Tasks

1. The ground: `EXPLORE_V1`, `ExplorePage`, `ExploreStatus` and `ExploreSettingResponse`, `explore_refreshed` and its message (and the contracts test that pins the social error codes, `packages/contracts/test/social.test.ts`), migration 0011 (the column, the two tables, the BRIN indexes through the table factory's option), the schema test's count.
2. The ranking and the job: the refresh statement with the formula argument, the skip rule and the retention, the job and `startExplore`, its start and stop in `apps/api/src/index.ts`, the integration tests of section 13's ranking list reading the two tables directly, and section 13's job tests.
3. The reads: the page and status routes, the switch's routes, `MeProfile.showInExplore` through the profile store (`apps/api/src/profiles/store.ts` and the stores of both test harnesses, `apps/api/test/integration/flow-harness.ts` and `apps/api/test/auth/flow-harness.ts`), the export's field (`ProfileExport`, `exportHead`, `apps/api/src/account/flows/export.ts`), the author's `inExplore` flag, the read and HTTP tests, and the tests that pin the profile's and the export's shapes (`apps/api/test/integration/social-flows-profile-edit.test.ts`, `packages/contracts/test/auth.test.ts`, `packages/contracts/test/account.test.ts`).
4. The web app: the tabs, the Explore list, the formula page, the switch, the status line, the chip, the context column, the terms sentence, the app's tests, the web export; the whole stack rebuilt and the smoke test extended.
5. What an adversarial review of Tasks 1 to 4 upholds.
6. Documentation: the README (Explore, and under Before going public that Explore relies on sub-project 3's moderation states and that its cold start lasts two days), the main design's amendments (the materialized view, lines 146 and 180, search and hashtags, the per-IP limits), the 2a design's note, the notes sub-projects 3, 3b and 4 must carry, and this design's amendments.

## 15. Success criteria

1. A post with 3 approving accounts in its first 48 hours appears in Explore within one refresh, and its author can tell which rule keeps one of their posts out through the status line.
2. None of these ever lifts a post: the author's own engagement, an account under 48 hours old, a deleted account, replies and quotes, engagement younger than 10 minutes.
3. A withheld, removed or deleted post, a deleted author, an author with the switch off, a blocked or blocking author and a muted author are absent from the next read after the change, without a refresh, for every reader including the author.
4. A reader paging through Explore while it refreshes sees no repeats and no gaps, and is told when the ranking they paged is gone.
5. The formula page's numbers are the refresh's numbers, and apart from the formula only a post's moderation state, its author's switch or deletion, a block in either direction and the reader's own mute take it out of Explore.

## 16. Amendments from the dry run (2026-09-28)

Found while the tasks were dry-run in the scratch clone, by the adversarial review of the range and by a walk-through in a real browser; each is applied in the prompts. Where an amendment and a section above differ, the amendment is current.

- **One set of rules for the ranking and the status (sections 7 and 8).** `exploreRules(asOf, formula)` in the social repository builds the candidate predicate, the engagement that counts and the approvers as SQL fragments; the refresh builds its `c`, `e` and `ap` from them, and the status wraps the same three in `exists (...)` once as of the request time and once as of the ranking's. Later rules about imports, suspension and restoration go into these fragments.
- **The job's start (section 9).** The round at start runs while the timer starts; the timer's first round comes one interval later, and rounds never overlap, in one process (the job answers `busy`) or across instances (the lock).
- **A failed round uses up a generation number (section 6).** The identity sequence is not rolled back, so generations can skip; nothing may assume they are consecutive.
- **A cursor before any ranking (section 8).** With no ranking at all, every generation is one not yet written: a cursor then answers 400 `invalid_request`, like any future generation, and never 409 (found by the review).
- **The page's rows (section 8).** The flow hands the view builder post rows directly (`ExplorePage` admits post items only). The query is validated before the signed-out 401, so a malformed cursor or limit is 400 for every reader. `explorePage` and `exploreStatus` take an optional formula, as the refresh does, so tests can change a number.
- **Turning the switch back on (sections 2, 8 and 11).** The page and the chip read the live switch, so the posts still in the current ranking are listed again at the next read; the posts a round left out while the switch was off come back at the next refresh, and their status answers `pending`. The switch's sentence says off takes effect at once and on at the next refresh.
- **The ranking's age in the web app (section 11).** The stale notice is judged when a page is read, from the ranking's age measured against the answer's `Date` header (the device clock only when the header is missing), not against a device clock ticking on screen: a page left open goes on saying "Updated N minutes ago" and a fast device clock shows no warning. Its 15 minutes are a screen constant, not a number of the formula. A Refresh button reads the newest ranking once the one on screen is at least `refreshMinutes` old, since pull to refresh does nothing on the web (found by the review).
- **The signed-out prompt (section 11).** It promises nothing the list may not hold: "Explore lists recent posts that other accounts like and repost. Sign in to follow people and post." The list's own footer, shown only when `signInForMore` is true, is the one place that offers more (found by the review).
- **Screens kept mounted on the web (section 11).** The web stack keeps earlier screens mounted and Back shows them again, so Home keys its lists by their reader (a sign-in reads them again), the author's post screen reads its status and its post again whenever it gains focus, and the switch's state lives in the Privacy screen rather than in the list header its Blocked and Muted tabs remount (found by the review).
- **The list's reads (section 11).** The in-flight flag, the posts on screen and the cursor live in a reader object (`exploreReader` in `apps/app/src/lib/explore.ts`) whose `load` answers what the list shows; its tests prove one read at a time, no repeats after `explore_refreshed`, and a failed read letting the next one run (found by the review).
- **Beyond the text of section 11.** How Explore works gains a "Your posts" section; Popular now links "More in Explore" and hides itself when Explore is empty or cannot be read; the status line shows nothing when its read fails; Following's empty text names Latest and Explore in plain text.
- **Tests (section 13).** The integration suites rank in epochs of their own: 2020 the ranking, 2021 the job, 2022 the reads, 2023 the HTTP suite, each test in a ten-day span after emptying `explore_runs`. The reads test pins the one-way mute with a muter who has a ranked post (found by the review). The smoke test's Explore step runs second, signed out.
- **Left to sub-project 5.** A headless Chromium draws rows a list appends only at the next scroll (react-native-web defers them to the browser's idle callback), in Latest as in Explore; real browsers were not seen to do it.
```

## Step 2: verify: sections

```bash
grep -c '^## Explore' README.md && grep -c 'Explore relies on sub-project 3' README.md && grep -c 'Changed by 2c' docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md && grep -c 'sub-project 2c' docs/superpowers/specs/2026-09-03-korbat-design.md && grep -c 'Amendments from the dry run' docs/superpowers/specs/2026-09-28-explore-2c-design.md
```

Expected output contains:

- `1`

Must not contain:

- `0`

Observed on the dry run:

```text
1
1
1
1
1
```

## Step 3: verify: line-endings

```bash
python -c "import sys; bad=[f for f in sys.argv[1:] if b'\r' in open(f,'rb').read()]; print('crlf-files', bad)" README.md docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md docs/superpowers/specs/2026-09-03-korbat-design.md docs/superpowers/specs/2026-09-28-explore-2c-design.md
```

Expected output contains:

- `crlf-files []`

Observed on the dry run:

```text
crlf-files []
```

## Step 4: verify: ascii

```bash
python -c "import sys; bad=[f for f in sys.argv[1:] if any(b > 126 for b in open(f,'rb').read())]; print('non-ascii-files', bad)" README.md docs/superpowers/specs/2026-09-28-explore-2c-design.md
```

Expected output contains:

- `non-ascii-files []`

Observed on the dry run:

```text
non-ascii-files []
```

## Step 5: verify: contracts

```bash
pnpm --filter @korbat/contracts test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  106 passed (106)
```

## Step 6: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `README.md`
- `docs/superpowers/specs/2026-09-03-korbat-design.md`
- `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- `docs/superpowers/specs/2026-09-28-explore-2c-design.md`

## Step 7: commit

```bash
git add -A
git commit -q -m "docs: the README explains Explore, its formula, refresh, reads and the author's controls, and says under Before going public that Explore relies on sub-project 3's moderation states and starts empty for two days; the 2a design and the main design record what 2c delivered, changed and left to later sub-projects; the 2c design gains its dry-run amendments" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `docs: the README explains Explore, its formula, refresh, reads and the author's controls, and says under Before going public that Explore relies on sub-project 3's moderation states and starts empty for two days; the 2a design and the main design record what 2c delivered, changed and left to later sub-projects; the 2c design gains its dry-run amendments`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 4>
Verify "sections": <paste the expected lines as printed>
Verify "line-endings": <paste the expected lines as printed>
Verify "ascii": <paste the expected lines as printed>
Verify "contracts": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
