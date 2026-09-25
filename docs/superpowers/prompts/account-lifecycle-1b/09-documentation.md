# korbat account lifecycle (1b) — Task 9 of 9: The README's account section, 1b recorded in the 1a and 2b specs and the main design, the 1b spec's dry-run amendments, one contract comment corrected

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend. Sub-project 1b (profile and handle changes, email change, the verified badge, data export, account deletion) is implemented and reviewed; this last task writes it down: the README's account section, the 1b design's amendments from the dry run and the review, the 1a and 2b designs' notes on what 1b changed, the main design's status and order, and one contract comment. The design is `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `fix(account): what the review of 1b upheld, fixed: badge attempts are counted atomically and badge starts are limited per IP and instance-wide; a one-shot link lets the old address undo an email change; the deletion's first step is one transaction that the purge repeats, the purge requests its file deletions (pending uploads too) before committing, and every social write takes a key-share lock so none lands on a purged account; the export writes a ZIP64-capable archive, streams export.json in pages, opens images through the media checks, gives the day back on an early failure and breaks the download on a late one; plus the web and contract fixes listed in the 1b design's amendments`.

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
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/09-documentation.md 1
```

Expected: 6 lines starting with `wrote`, one for each file below.

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

## Staff roles
No API endpoint changes roles. Run this on the server:
```bash
docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
```
Every session of the account is revoked and the change is written to the audit log. Staff tools refuse moderators and admins until they turn on two-factor authentication.

## Profile and account
Signed-in accounts manage themselves under Settings; every route below needs the session and, where it says fresh, a re-authentication within five minutes (the app opens its panel when the API answers `reauth_required`).
- **Profile.** `PATCH /api/me/profile` sets the display name (up to 50 characters) and the bio (one line, up to 160). `POST /api/me/handle` (fresh) changes the handle once every 30 days; every handle an account ever had stays reserved for it in `handle_history`, so nobody else can take an old handle and the account can go back to it. There is no redirect from an old handle.
- **Email.** `POST /api/auth/email/change/start` (fresh) sends a code to the new address; `POST /api/auth/email/change/verify` moves the account there and tells the old address, whose notice carries a link (`/email-revert/<token>`, `POST /api/auth/email/revert`, valid 24 hours, once) that moves the account back, signs out every session and drops any password or two-factor secret set since the change. Sessions stay signed in after a change.
- **Verified badge.** Proof of holding a phone number, kept only as a keyed hash; one number per account. `VERIFY_PROVIDER` picks who sends the text: `off` (default; the badge is hidden), `dev` (the code is always `000000`; refused in production) or `vonage` (Vonage Verify v2 with `VONAGE_API_KEY`, `VONAGE_API_SECRET` and `VERIFY_BRAND`; the runbook is section 13 of `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, and `node scripts/verify-badge.mjs +4479xxxxxxxx` checks live credentials without touching an account). Routes: `POST /api/auth/badge/start`, `POST /api/auth/badge/verify`, `DELETE /api/auth/badge` (all fresh); starts are limited per account, per number, per IP and instance-wide (200 texts a day), and a flow takes at most five codes. The web build shows the badge section only with `WEB_BADGE=on` in `infra/.env` (the default is off, matching `API_VERIFY_PROVIDER=off`); set both together.
- **Data export.** `POST /api/account/export` (fresh, once a day) streams a ZIP with `export.json` (the account, profile, posts, likes, reposts, bookmarks, following, blocks, mutes, sessions, devices and security events) and every image the account uploaded under `media/`. Nothing is kept on the server: the archive is written entry by entry (ZIP64 when it passes 4 GiB or 65,535 entries), `export.json` is read in pages and streamed last, image files go through the media module's checked open, a request that fails before the first byte gives the day's export back, and one that fails midway breaks the download instead of saving a truncated archive.
- **Deletion.** `POST /api/account/delete/start` (fresh) mails a code; `POST /api/account/delete/confirm` with the code and the handle typed by the owner deletes the account at once: every session is revoked, posts become tombstones with their images and any pending uploads deleted from disk, likes, reposts, bookmarks, follows, blocks and mutes go with their counters, the profile is anonymised and keeps its handle, and the auth row is anonymised. The `account-purge` job (every five minutes) finishes any deletion the process did not. Nothing can be undone.
## Before going public
Set these in `infra/.env`:
- `API_APP_ORIGIN` to the public origin, for example `https://korbat.example`; the API refuses a plain-http origin in production.
- `API_TURNSTILE_SECRET_KEY` and `WEB_TURNSTILE_SITE_KEY` to the keys of one Turnstile widget; the API and the web build refuse Cloudflare's test keys in production.
- `API_SMTP_URL` and `API_MAIL_FROM` to the EU mail relay; a plain `smtp://` relay must offer STARTTLS, which the API requires in production.
- `KORBAT_ENV=production` before building the images; it is the API's `NODE_ENV` too, so the guards above are on.
- `TUNNEL=on` and `API_TRUST_PROXY=cloudflare` when cloudflared is the only way in (the tunnel's hostname points at `http://caddy:8080`); `TUNNEL=off` and `API_TRUST_PROXY=caddy` when Caddy's port is reachable directly. With `on`, Caddy keeps `CF-Connecting-IP` for the API; with `off` it drops it, so nobody can claim an address.
- In Cloudflare, set Browser Cache TTL to "Respect Existing Headers", or browsers keep images for four hours whatever the server says.

Keep `API_AUTH_HMAC_KEY`, `API_IP_HASH_KEY` and `API_TOTP_ENC_KEY` secret and backed up. Losing `API_TOTP_ENC_KEY` breaks every enrolled authenticator. To rotate it, put the old key in `API_TOTP_ENC_KEYS_PREVIOUS` and a new `v2:` key in `API_TOTP_ENC_KEY`; each secret is re-encrypted with the new key when it is next used.

## Dependency audit

`pnpm audit --audit-level high` runs in CI. Two lower advisories are accepted, both in build-time tools that never see untrusted input here: `esbuild` 0.18 under drizzle-kit's config loader (its development server, which nothing starts) and `uuid` 7 under Expo's Xcode config plugin. Renovate moves them with their parents.
````

### Replace `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md` (whole file)

````markdown
# korbat — Sub-project 1a: Core accounts and sessions — Design Spec

Parent design: `docs/superpowers/specs/2026-09-03-korbat-design.md` (section 3a, build-order row 1). Foundation (sub-project 0) is built; this sub-project replaces the session stub in `apps/api/src/middleware/session.ts`.

## Context

korbat's users post unpopular opinions under pseudonyms, which makes their accounts targets. Account takeover is the first threat in the parent design. 1a delivers everything a person needs to create an account, sign in safely, protect it with a second factor, see and revoke their sessions, and recover from a lost device, with no third-party auth vendor.

Sub-project 1 is split in three so each plan stays reliable:

| Part | Delivers | Depends on |
|---|---|---|
| **1a** (this spec) | Sign-up, sign-in, sessions, devices, MFA, re-authentication, recovery, staff MFA enforcement, mailer, auth screens | Foundation |
| **1b** | Profile editing and handle-change rules, verified badge, data export, account deletion | 1a, and 2 for export and deletion of content |
| **1c** | Passkeys (WebAuthn) as the promoted sign-in | 1a |

## Decisions

| Decision | Choice |
|---|---|
| Sign-in | Email code by default; a password is optional |
| Minimum age | 16. Date of birth is checked at sign-up and never stored |
| Registration | Open, with bot friction (Turnstile, disposable-email block, rate limits) |
| MFA | TOTP, optional and strongly prompted for users; required for moderators and admins |
| Lost email + MFA device + recovery codes | Not recoverable. No manual or support-desk recovery |
| Outbound email | Transactional relay behind a `Mailer` interface; EU-based provider (Brevo or Mailjet) in production; Mailpit in development |
| Auth code isolation | Module inside the API, boundary enforced by an architecture test |
| Password hashing | argon2id via `@node-rs/argon2` (native) |
| TOTP | RFC 4226/6238 implemented on `node:crypto` HMAC-SHA1 and proven against the published RFC test vectors. `@oslojs/otp` was chosen first, but on 2026-09-14 npm marked almost the whole `@oslojs` scope "no longer supported", so no third-party OTP or encoding library is used |

## 1. Scope

**In 1a**
- One email entry point for sign-up and sign-in, with email codes.
- Age check (16+), terms acceptance, handle and display name at onboarding.
- Optional password: set, change, sign in with it; breached-password check.
- TOTP MFA: setup with QR code, challenge, disable, 10 recovery codes, regenerate codes.
- Sessions: web cookie with CSRF protection, native bearer token, list, revoke one, sign out, sign out everywhere.
- Devices and new-device alert email with a "This wasn't me" link.
- Re-authentication for sensitive actions.
- Lockout and rate limits on every auth endpoint.
- Staff role granted by a server-side CLI; staff endpoints require MFA.
- Mailer interface, SMTP adapter, Mailpit in development.
- Web screens for all of the above, functional and in the current dark style.

**Not in 1a**
- Profile editing, handle changes after onboarding, verified badge, data export, account deletion (1b).
- Passkeys (1c).
- SMS for anything, ever.
- OAuth / social login.
- The 30-day IP-hash purge job (sub-project 4, with the column grant it needs).
- Final legal terms text (sub-project 4). 1a ships a draft terms page, clearly labelled as a draft, that summarises the public rulebook. Terms carry a version (`TERMS_VERSION`), recorded at sign-up; the re-acceptance flow for a new version is built with the final terms in sub-project 4.

## 2. Architecture

### 2.1 Auth module

All auth code lives in `apps/api/src/auth/`. Only `apps/api/src/auth/index.ts` may be imported from outside the folder. It exports:

- `createAuth(deps)` returning:
  - `routes`: a Hono sub-app mounted at `/api/auth`.
  - `resolveSession`: middleware that sets `c.var.session` from the bearer header or the session cookie, or `null`.
  - `requireSession`: 401 unless a session exists and the account is onboarded.
  - `requireOnboarding`: allows a session whose account is not yet onboarded (used only by onboarding routes).
  - `requireFreshAuth(maxAgeSeconds)`: 403 `reauth_required` unless `reauthAt` is within the window.
  - `requireStaffMfa`: 403 unless role is moderator or admin and MFA is enabled.
- `grantRole(deps, email, role)`: used only by the staff-role CLI (5.7).
- `type Session`, `type ProfileStore`.

Internal files, one responsibility each:

| File | Responsibility |
|---|---|
| `crypto.ts` | Random tokens, SHA-256, HMAC-SHA256, constant-time compare, AES-256-GCM encrypt/decrypt with versioned keys |
| `passwords.ts` | argon2id hash/verify, dummy-hash verify for unknown accounts, breached-password check |
| `codes.ts` | Generate, store (keyed hash), verify email codes bound to a flow |
| `base32.ts` | RFC 4648 base32 for TOTP secrets and recovery codes |
| `totp.ts` | HOTP/TOTP on `node:crypto`, secret generation, `otpauth` URI, QR code, verification with ±1 step and replay protection |
| `recovery-codes.ts` | Generate 10 codes, hash, consume |
| `sessions.ts` | Issue, resolve (with Redis cache), slide, rotate, revoke, list |
| `devices.ts` | Device hash, label from User-Agent, new-device detection |
| `lockout.ts` | Failure counting and account lock |
| `turnstile.ts` | Server-side Turnstile verification |
| `disposable.ts` + `data/disposable-domains.txt` | Disposable-domain check |
| `handles.ts` | Handle validation and reserved list |
| `csrf.ts` | CSRF cookie issue and double-submit + Origin check |
| `events.ts` | Append auth events |
| `repo.ts` | Every SQL statement against the `korbat_auth` pool |
| `flows/email.ts`, `flows/signup.ts`, `flows/password.ts`, `flows/mfa.ts`, `flows/reauth.ts`, `flows/sessions.ts`, `flows/not-me.ts` | One flow each |
| `routes.ts` | HTTP layer: validation with contracts, calls flows, sets cookies |

The API process wires `createAuth` in `apps/api/src/index.ts` with the auth pool, Redis, the mailer, config, the logger, and a `ProfileStore`. The auth module never receives the API pool: onboarding calls `profiles.create({ id, handle, displayName })` on the `ProfileStore` interface, implemented in `apps/api/src/profiles/store.ts` with the `korbat_api` pool, which returns `handle_taken` on a unique-index conflict. `sessionStub` is deleted. `apps/api/src/env.ts` imports the `Session` type from the auth module.

### 2.2 Boundary enforcement

`apps/api/test/architecture.test.ts` walks every `.ts` file under `apps/api/src` and fails when:
- a file outside `src/auth/` imports any path inside `src/auth/` other than `src/auth/index.ts`;
- a file references `DATABASE_URL_AUTH` or the identifier `authDb`, unless it is `src/config.ts` (declares the variable), `src/index.ts` or `src/cli/grant-role.ts` (create the pool and pass it to the module), or inside `src/auth/`;
- a file references `TOTP_ENC_KEY`, `AUTH_HMAC_KEY` or `IP_HASH_KEY`, unless it is `src/config.ts` or inside `src/auth/`;
- a file inside `src/auth/` imports public-schema tables from `@korbat/db` (the module works only with the `auth` schema).

No new dependency; it parses import statements with a regular expression and reads files with `node:fs`.

### 2.3 Mailer

`apps/api/src/mail/`:
- `mailer.ts`: `interface Mailer { send(message: { to: string; template: TemplateName; data: Record<string, string> }): Promise<void> }`.
- `smtp.ts`: `nodemailer` SMTP adapter configured from `SMTP_URL`.
- `templates.ts`: plain-text plus minimal HTML for `sign_in_code`, `sign_up_code`, `reauth_code`, `new_device`, `account_locked`. No images, no tracking pixels, no link tracking. Messages contain codes and korbat links only, never post content.
- `memory.ts`: in-memory mailer for unit tests.

Development: a `mailpit` service (`axllent/mailpit:v1.31.1`) is added to `infra/compose.dev.yml`, SMTP on `127.0.0.1:51025`, web UI on `127.0.0.1:58025`. Production: `SMTP_URL` points at the chosen EU relay; switching provider is a config change.

### 2.4 Contracts

`packages/contracts/src/auth.ts` holds every request and response schema for `/api/auth/*` and `/api/me`, plus the `AuthErrorCode` enum. `email` appears only in the `/api/me` response.

## 3. Data model changes

One migration, `0002_auth_core`, generated from the Drizzle schema plus a custom grants migration. All changes are additive.

**`auth.users`** gains:

| Column | Type | Purpose |
|---|---|---|
| `role` | enum `auth.user_role` (`user`, `moderator`, `admin`), default `user` | Staff authorisation |
| `age_confirmed_at` | timestamptz | When the 16+ check passed |
| `terms_version` | text | Accepted terms version |
| `terms_accepted_at` | timestamptz | When accepted |
| `onboarded_at` | timestamptz | Set when the profile row exists |
| `password_changed_at` | timestamptz | For alerts and session rotation |
| `totp_last_step` | bigint | Last accepted TOTP time step (replay protection) |

**`auth.email_codes`** gains `flow_id` (text, not null, unique) and `ip_hash` (text). The enum `auth.email_code_purpose` gains the value `reauth`.

**New `auth.auth_events`** (append-only):

| Column | Type |
|---|---|
| `id` | bigserial primary key |
| `user_id` | uuid, references `auth.users`, on delete set null |
| `type` | enum `auth.auth_event_type`: `signup`, `signin_success`, `signin_failure`, `mfa_enabled`, `mfa_disabled`, `recovery_code_used`, `recovery_codes_regenerated`, `password_set`, `password_changed`, `session_revoked`, `sessions_revoked_all`, `account_locked`, `new_device`, `not_me` |
| `device_id` | uuid, nullable |
| `ip_hash` | text, nullable |
| `metadata` | jsonb, default `{}` |
| `created_at` | timestamptz, default now |

RLS enabled with insert and select policies for `korbat_auth`. Grants: `korbat_auth` gets INSERT and SELECT only; UPDATE, DELETE and TRUNCATE are revoked. The column-level UPDATE on `ip_hash` needed by the purge job is granted in sub-project 4 together with that job. `korbat_api` has no access.

**Not stored anywhere:** date of birth, raw IP addresses, raw device ids, raw session tokens, raw email codes, raw recovery codes, unencrypted TOTP secrets.

**Redis keys** (all with TTL):

| Key | TTL | Content |
|---|---|---|
| `sess:<sessionHash>` | 60 s | Resolved session |
| `mfa-ticket:<hash>` | 5 min | Pending MFA sign-in (user, device, attempts) |
| `totp-pending:<userId>` | 10 min | Encrypted unconfirmed TOTP secret |
| `age-block:<emailHmac>` | 24 h | Sign-up blocked after an under-16 date of birth |
| `not-me:<tokenHash>` | 24 h | Single-use "This wasn't me" token |
| `pw-fail:<userId>` | 15 min from first failure | Password failure count for the lockout window |
| `rl:*` | window | Rate-limit counters (existing store) |

**Handles** are written to `public.profiles` through the `korbat_api` pool at onboarding. Rules: 3 to 20 characters from `a-z`, `0-9`, `_`; compared case-insensitively (existing unique index on `lower(handle)`); reserved list includes `admin`, `administrator`, `korbat`, `support`, `help`, `moderator`, `mod`, `staff`, `security`, `root`, `system`, `official`, `api`, `www`, `about`, `rules`, `transparency`, `settings`. Display name: 1 to 50 characters, trimmed, no control characters.

## 4. Sessions and transport

- **Token**: `kb1_` + base64url of 32 random bytes. `auth.sessions.id` stores its SHA-256 hex. The raw token exists only in the client.
- **Web**: cookie `__Host-korbat_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`. Chrome, Edge and Firefox accept `Secure` cookies on `http://localhost`, so development uses the same cookie; Safari does not and is not supported for local development.
- **CSRF**: cookie `__Host-korbat_csrf` (32 random bytes, not HttpOnly) issued with every session. Every non-GET request authenticated by cookie must send header `X-CSRF-Token` equal to the cookie (constant-time compare) and an `Origin` header equal to `APP_ORIGIN` or listed in `TRUSTED_ORIGINS`. Otherwise 403 `csrf_failed`.
- **Native**: `Authorization: Bearer kb1_...`. When this header is present, cookies are ignored and CSRF does not apply.
- **Lifetime**: `expires_at` is 30 days after last use, extended at most once per hour. `absolute_expires_at` is 12 months after creation and never extended.
- **Cache**: resolved sessions are cached in Redis for 60 seconds. Revocation deletes the cache key in the same operation.
- **Rotation**: a new session is issued, and the previous one revoked, on sign-in, MFA completion, MFA enable, password set or change, and recovery-code use.
- **Pending MFA**: when MFA is enabled, a successful first factor returns an MFA ticket (5 minutes, 5 attempts), never a session.
- **Onboarding scope**: an account without `onboarded_at` gets a session that only `requireOnboarding` routes accept.
- **Re-authentication**: `reauth_at` on the session. Password set or change, MFA disable, recovery-code regeneration and sign-out-everywhere require it within 5 minutes. Re-authenticate with the password, a TOTP code, or an email code.
- **Devices**: the client creates a random device id once (localStorage on web, SecureStore on native) and sends it with sign-in requests together with `platform` (`web`, `ios` or `android`). The server stores `HMAC(AUTH_HMAC_KEY, deviceId)`. The label is derived from the User-Agent at coarse granularity, for example "Chrome on Windows".
- **IP addresses**: stored only as `HMAC(IP_HASH_KEY, ip)`. The 30-day purge job arrives in sub-project 4.
- **Fresh sign-in counts as re-authentication**: every newly issued session starts with `reauth_at = now`.

`Session` type returned by `resolveSession`:

```ts
interface Session {
  sessionId: string;   // sha256 of the token
  userId: string;
  deviceId: string;
  role: "user" | "moderator" | "admin";
  onboarded: boolean;
  mfaEnabled: boolean;
  reauthAt: Date;
}
```

## 5. Flows and endpoints

All request and response bodies are defined in `packages/contracts/src/auth.ts`.

### 5.1 Email entry (sign-up and sign-in)

1. `POST /api/auth/email/start` `{ email, turnstileToken, deviceId, platform }` → `{ flowId }`
   - Verifies Turnstile (`turnstile_failed`), rejects disposable domains (`disposable_email`), and returns 403 `age_requirement` if the `age-block` key for this email exists.
   - Always responds the same way whether or not the email has an account, after a minimum of 400 ms.
   - Sends `sign_in_code` to an existing account or `sign_up_code` to a new email.
2. `POST /api/auth/email/verify` `{ flowId, code }` →
   - existing account, no MFA: `{ result: "session" }` and a session;
   - existing account, MFA on: `{ result: "mfa_required", mfaTicket }`;
   - new email: `{ result: "signup_required" }` (the flow stays valid 10 minutes).
3. `POST /api/auth/signup/complete` `{ flowId, dateOfBirth, termsVersion }` → (`dateOfBirth` is `YYYY-MM-DD`; age is computed against today's date in UTC; `termsVersion` must equal `TERMS_VERSION`, otherwise 400 `terms_required`)
   - age under 16: 403 `age_requirement`, flow deleted, `age-block` set, nothing written to Postgres;
   - otherwise creates the user and device, records `signup`, returns an onboarding-scope session.
4. `POST /api/auth/onboarding/handle` `{ handle, displayName }` (requires onboarding session) → `{ profile }`; writes `public.profiles`, sets `onboarded_at`, rotates the session to full scope.

### 5.2 Password

- `POST /api/auth/password/signin` `{ email, password, turnstileToken, deviceId, platform }` → session or `{ result: "mfa_required", mfaTicket }`.
  - Unknown email or account without password: verify against a dummy argon2id hash, return `invalid_credentials`.
  - Each failure increments `pw-fail:<userId>` in Redis (15-minute window) and mirrors the count to `failed_logins`. The fifth failure in the window sets `locked_until` to now + 15 minutes, records `account_locked` and sends `account_locked`. A locked account returns `invalid_credentials` too, so the response reveals nothing.
  - The lock applies to password sign-in only. Email-code sign-in keeps working, so someone guessing passwords cannot lock the owner out.
  - Success resets the failure counter.
- `POST /api/auth/password/set` `{ password }` (fresh auth) → 204. 12 to 128 characters; breached-password check; records `password_set` or `password_changed`; rotates the session.
- argon2id parameters: memory 65536 KiB, iterations 3, parallelism 1, output 32 bytes. Parameters are read from the stored hash, so they can be raised later with rehash-on-login.
- Breached-password check: `GET https://api.pwnedpasswords.com/range/<first 5 SHA-1 hex>` with `Add-Padding: true`, 3-second timeout. Any network failure returns 503 `password_check_unavailable`; the password is not saved.

### 5.3 MFA

- `POST /api/auth/mfa/totp/setup` (session; fresh auth when MFA is already enabled, because confirming replaces the secret and the recovery codes) → `{ otpauthUri, qrSvg }`. 20-byte secret, SHA-1, 6 digits, 30-second period, issuer `korbat`, label is the handle. Secret stored encrypted in `totp-pending` for 10 minutes. QR rendered server-side as SVG with `uqr`.
- `POST /api/auth/mfa/totp/confirm` `{ code }` → `{ recoveryCodes }` shown once. Stores `totp_secret_enc` as `v1:<base64 iv|ciphertext|tag>`, sets `totp_enabled_at`, stores 10 recovery-code hashes, records `mfa_enabled`, rotates the session.
- `POST /api/auth/mfa/verify` `{ mfaTicket, code }` or `{ mfaTicket, recoveryCode }` → session.
  - TOTP accepted for steps −1, 0, +1; the accepted step must be greater than `totp_last_step`, which is then updated.
  - A recovery code is consumed on use and records `recovery_code_used`. MFA stays enabled and the remaining codes stay valid. The response is `{ result: "session", mustReenrollMfa: true }` (otherwise `false`); the web app opens MFA setup, where confirming a new secret replaces the old one and issues 10 new codes. The new session's `reauth_at` covers the setup step.
- `POST /api/auth/mfa/totp/disable` `{ code }` (fresh auth) → 204. Clears secret and recovery codes, records `mfa_disabled`. Refused for moderators and admins (`staff_mfa_required`).
- `POST /api/auth/mfa/recovery-codes/regenerate` (fresh auth, MFA on) → `{ recoveryCodes }`.
- Recovery codes: 10 codes, each 12 base32 characters shown as `xxxx-xxxx-xxxx`, stored as `HMAC(AUTH_HMAC_KEY, code)`.

### 5.4 Re-authentication

- `POST /api/auth/reauth` with one of `{ method: "password", password }`, `{ method: "totp", code }`, `{ method: "email", flowId, code }` → 204, sets `reauth_at`.
- `POST /api/auth/reauth/email/start` (session) → `{ flowId }`, sends `reauth_code`.

### 5.5 Sessions and devices

- `GET /api/auth/sessions` → list with device label, platform, created, last used, current flag.
- `DELETE /api/auth/sessions/:id` → 204, records `session_revoked`.
- `POST /api/auth/sessions/revoke-all` (fresh auth) → 204, revokes every session including the current one, records `sessions_revoked_all`.
- `POST /api/auth/signout` → 204, revokes the current session and clears cookies.
- `GET /api/me` (any session, including onboarding scope) → `{ user: { id, email, role, onboarded, mfaEnabled, hasPassword }, profile | null }`.

### 5.6 New device and "This wasn't me"

- The first successful sign-in from a device hash not seen for that user records `new_device` and sends `new_device` with a link to `/not-me/<token>` (32 random bytes, single use, 24 hours).
- `POST /api/auth/not-me` `{ token }` → 204. Revokes all sessions, clears `password_hash`, records `not_me`. The next sign-in must use an email code (and MFA if enabled).

### 5.7 Staff roles

- `apps/api/src/cli/grant-role.ts`, bundled to `dist/grant-role.js`, run on the server: `docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>`.
- The CLI creates both pools. It calls `grantRole` from the auth module (auth pool), then writes an entry to `public.audit_log` (actor `00000000-0000-0000-0000-000000000000`, action `role_granted`) through the API pool.
- There is no API endpoint that changes roles.
- `requireStaffMfa` guards every moderator and admin route from sub-project 3 onward; 1a ships it with tests.

## 6. Abuse controls

| Endpoint | Limits |
|---|---|
| `email/start` | Turnstile; 3 per email per hour; 10 per IP per hour; 60 s resend cooldown per email; 400 ms minimum response time |
| `email/verify` | 5 attempts per flow; 30 per IP per hour |
| `signup/complete` | 10 per IP per hour |
| `onboarding/handle` | 10 per session per hour |
| `password/signin` | Turnstile; account lock after 5 failures in 15 min; 20 per IP per 15 min |
| `mfa/verify` | 5 attempts per ticket, then the ticket is void; 20 per IP per 15 min |
| `reauth` | 5 per session per 15 min |
| Other auth endpoints | Existing global limit |

- Rate-limit keys use `HMAC(IP_HASH_KEY, ip)` and `HMAC(AUTH_HMAC_KEY, lower(email))`, never raw values.
- Turnstile: server-side `siteverify` with the secret key and the token only; the user's IP is not sent. Development and CI use Cloudflare's documented test keys.
- Email codes: 6 digits, 10 minutes, stored as `HMAC(AUTH_HMAC_KEY, flowId + code)`.
- Disposable domains: vendored from the public-domain `disposable-email-domains` list with an `update:disposable` script.

## 7. Errors

- Every failure uses the existing `ErrorEnvelope`.
- `AuthErrorCode`: `invalid_code`, `code_expired`, `too_many_attempts`, `invalid_credentials`, `mfa_required`, `invalid_mfa_code`, `reauth_required`, `csrf_failed`, `turnstile_failed`, `disposable_email`, `age_requirement`, `terms_required`, `handle_taken`, `handle_invalid`, `handle_reserved`, `password_too_short`, `password_too_long`, `password_breached`, `password_check_unavailable`, `staff_mfa_required`, `onboarding_required`, `mail_unavailable`, `rate_limited`.
- Mail relay failure: 503 `mail_unavailable`, the flow stays valid for retry.
- Logs never contain emails, codes, tokens, passwords or TOTP secrets (existing scrubbing plus key-based redaction for `code`, `token`, `password`, `session`).

## 8. Configuration and secrets

New variables, validated at startup by `apps/api/src/config.ts` (the API refuses to start if any is missing or malformed):

| Variable | Format |
|---|---|
| `APP_ORIGIN` | URL, e.g. `http://localhost:8081` in dev |
| `AUTH_HMAC_KEY` | 32+ bytes, base64 |
| `IP_HASH_KEY` | 32+ bytes, base64 |
| `TOTP_ENC_KEY` | `v1:` + 32 bytes base64 |
| `TURNSTILE_SECRET_KEY` | string |
| `SMTP_URL` | `smtp://` or `smtps://` URL |
| `MAIL_FROM` | `korbat <no-reply@...>` |
| `TERMS_VERSION` | string, e.g. `draft-2026-09` |

The web app reads `EXPO_PUBLIC_TURNSTILE_SITE_KEY`. `infra/.env.example` gains the keys with placeholder values; local `.env` files are generated with random values, as in Foundation.

## 9. Web screens

Expo routes under `apps/app/src/app/`:

| Route | Purpose |
|---|---|
| `(auth)/index.tsx` | Email entry with Turnstile |
| `(auth)/code.tsx` | Code entry, resend with cooldown |
| `(auth)/age.tsx` | Date of birth and terms acceptance |
| `(auth)/handle.tsx` | Handle and display name |
| `(auth)/password.tsx` | Password sign-in |
| `(auth)/mfa.tsx` | TOTP or recovery-code challenge |
| `settings/security.tsx` | Sessions and devices, MFA setup with QR, recovery codes, set or change password, sign out everywhere, re-auth prompt |
| `terms.tsx` | Draft terms page |
| `not-me/[token].tsx` | Confirm "This wasn't me" |

The web client never reads the session token; it sends `credentials: "include"` and echoes the CSRF cookie in `X-CSRF-Token`. A shared API client in `apps/app/src/lib/api.ts` handles this, and maps `ErrorEnvelope` codes to messages.

## 10. Testing

- **Unit** (`apps/api/test/auth/`): token hashing, AES-GCM round trip and tamper detection, email-code expiry and attempt limit, TOTP window and replay, recovery-code consumption, lockout timing, handle rules and reserved list, CSRF and Origin checks, cookie attributes, age calculation at the 16th birthday boundary, disposable-domain matching, config validation of the new variables.
- **Architecture**: the boundary test in 2.2.
- **Integration** against Compose (Postgres, Redis, Mailpit), reading codes from Mailpit's HTTP API:
  - sign-up through onboarding; sign-in by code; sign-in by password; lockout, unlock after 15 minutes, and email-code sign-in still working while locked;
  - MFA setup, challenge, replay rejected, recovery code, re-enrolment, disable;
  - re-authentication gates; session list, revoke, revoke all, sign out;
  - new-device email and "This wasn't me";
  - staff role grant via CLI and `requireStaffMfa`;
  - under-16 rejection writes nothing to Postgres;
  - `korbat_api` cannot read `auth.auth_events`; `korbat_auth` cannot delete from it;
  - timing: `email/start` and `password/signin` for unknown versus known emails differ by less than 50 ms on the median of 20 requests.
- **Web**: a scripted browser check of every screen in the plan. Automated browser end-to-end tests start in sub-project 2.

## 11. Dependencies to add

Pinned to the newest version that is at least 7 days old at planning time (the workspace enforces a 7-day minimum release age):

| Package | Version found 2026-09-14 | Used in |
|---|---|---|
| `@node-rs/argon2` | 2.2.0 | API, kept outside the tsup bundle (native module) |
| `nodemailer` | 10.0.0 | API |
| `uqr` | 0.1.3 | API (QR code as SVG; MIT, no dependencies) |
| `@types/nodemailer` | 6.4.24 | API, development only (nodemailer 10 ships no types) |
| `@marsidev/react-turnstile` | 1.6.1 | Web app (MIT, no dependencies) |

The API Docker image changes to ship `@node-rs/argon2` and its musl binary as a real dependency next to the bundle.

## 12. Success criteria

1a is done when:
1. A new person can sign up on the web, pass the age check, choose a handle, enable MFA, sign out, and sign back in with a code and TOTP.
2. Every integration test in section 10 passes against the Compose stack.
3. The architecture test passes and fails when a deliberate boundary violation is introduced.
4. Semgrep and the dependency audit stay clean.
5. `korbat_api` still cannot read anything in the `auth` schema.

## 13. Amendments from the dry run (2026-09-14)

The plan was dry-run task by task in a scratch clone before the execution prompts were written. Where the built system differs from sections 1 to 12, this section is the verified version.

Each item is a place where the verified build differs from `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`. The spec gets these edits when the plan and prompts are written into the real repo.

### Guards and responses (section 2.1, section 5)

- **requireSession.** 401 `unauthenticated` without a session, and 403 `onboarding_required` for a session whose account has no handle yet. The spec said 401 for both.
- **Rotated sessions.** Routes that rotate the session return JSON with an optional `token`, present only for bearer (native) clients. Web clients get fresh cookies instead.
  - `POST /api/auth/onboarding/handle` returns `{ profile, token? }`.
  - `POST /api/auth/password/set` returns 200 `{ token? }`. The spec said 204, which cannot carry the native token.
  - `POST /api/auth/mfa/totp/confirm` returns `{ recoveryCodes, token? }`.
- **Contracts additions.** `RotatedToken`, `PasswordSetResponse` and `TotpConfirmResponse`.
- **Cookie refresh.** When a cookie session's idle expiry slides, both cookies are re-sent with the same CSRF value, so requests already in flight stay valid.

### Encryption at rest (section 2.1, `crypto.ts`)

- **GCM tag length.** AES-256-GCM pins the 16-byte authentication tag with `authTagLength` for both encryption and decryption. Payloads too short to hold the IV, the full tag and one byte of ciphertext are rejected. Semgrep flagged the unpinned version as allowing forged ciphertexts with shorter tags.

### Internal file layout (section 2.1 table)

| Spec | Built |
|---|---|
| `codes.ts` | code generation and checks live in `flows/email.ts` |
| `csrf.ts` | `cookies.ts` (cookies, CSRF double submit, Origin check, bearer parsing) |
| `events.ts` | `repo.appendEvent` |
| `flows/sessions.ts` | `flows/account.ts` (me, list, revoke, revoke all, sign out) |
| `data/disposable-domains.txt` | `data/disposable-domains.ts`, generated by `scripts/update-disposable-domains.mjs` |
| not listed | `context.ts`, `kv.ts`, `limits.ts`, `identifiers.ts`, `age.ts`, `middleware.ts`, `admin.ts`, `flows/signin.ts`, `index.ts` |

### Staff CLI (section 5.7)

- **Audit entry.** `grant-role` writes `targetType: "user"`, `targetId: <user id>` and `metadata: { from, to, via: "cli" }`. No email address is written.
- **Exit codes.** 2 for a usage error, 1 for a failure such as an unknown email.

### Boundary test (section 2.2)

- **Rules.** All four rules are implemented as plain functions with synthetic tests for each.
- **Violation gate.** The task also proves the suite fails when a real file imports `./auth/passwords`.

### Docker and configuration (section 8, section 11)

- **argon2 packaging.** argon2 stays outside the tsup bundle. The API image copies `node_modules/@node-rs` from the Alpine build stage, which holds exactly the musl binary for the image's architecture.
- **Bundle chunks.** Three entry points (`index`, `migrate`, `grant-role`) make tsup emit shared chunks, and the whole `dist/` directory is copied.
- **Docker auth settings.** They live in `infra/.env` as `API_<NAME>`. `compose.yml` refuses to start while any is missing.
- **Shared keys.** `scripts/gen-dev-env.mjs` shares `AUTH_HMAC_KEY`, `IP_HASH_KEY` and `TOTP_ENC_KEY` between `infra/.env` and `apps/api/.env`. Without that, a TOTP secret enrolled through one API could not be decrypted by the other.
- **Turnstile in the CSP.** The Caddy CSP adds `https://challenges.cloudflare.com` to `script-src` and `frame-src`.
- **Smoke test.** `scripts/smoke-auth-stack.mjs` checks the stack end to end through Caddy.

### Web (section 9)

- **Root route.** The Foundation home screen at `src/app/index.tsx` is deleted, because `(auth)/index.tsx` owns `/`. A finished account is redirected to `/settings/security`.
- **Flow state.** Email address, flow id and MFA ticket are kept in memory (`src/lib/flow.ts`), never in the URL. A reload restarts the flow.
- **Terms version.** `TERMS_VERSION` is a constant next to the terms text in `src/lib/terms.ts` and must equal the API's `TERMS_VERSION`.
- **QR code.** The TOTP QR code renders through `QrCode.web.tsx` as a plain `<img>` on web, because React Native Web's `Image` did not draw the SVG data address. Native uses `QrCode.tsx` with React Native's `Image`.
- **Error messages.** The API client shows the server's error message, which is written for people, and falls back to local wording only for `invalid_request`, `internal` and unparseable responses.
- **Dependencies.** The web app gains `zod` 4.5.4 (already locked for contracts) next to `@marsidev/react-turnstile` 1.6.1.

### Tests (section 10)

- **Shared HTTP client.** `test/integration/http-client.ts` provides a cookie browser and a native client, each with its own client address so per-IP limits never collide.
- **Mailpit inbox.** The Mailpit helper gains an inbox that hands out each new message once.
- **Moving clock.** The end-to-end suite moves a clock through `createAuth({ now })` for lockout expiry, the re-auth window and new TOTP steps.
- **Redis prefix.** Redis-backed suites use a fresh key prefix per run, so rate-limit counters from earlier runs never interfere.

### Task split

- **T16 to T18.** T16 is the HTTP layer. T17 is the boundary test and grant-role CLI. T18 is the end-to-end and timing tests.
- **T19 to T21.** T19 is Docker. T20 is the web screens. T21 is the site key in the web image, the browser check, CI and docs.

## 14. Amendments from the audit (2026-09-23)

Applied by `docs/superpowers/specs/2026-09-23-audit-fixes-design.md` (Tasks 3, 4 and 5 of its prompts). Where this document and the audit design differ, the audit design is current.

- **Fresh authentication for enrolment (section 5.3).** `POST /api/auth/mfa/totp/setup`, `POST /api/auth/mfa/totp/confirm` and `DELETE /api/auth/sessions/:id` require a re-authentication within five minutes, whether or not two-factor is already on. A sign-in counts as fresh.
- **Owners hear about security changes (section 5).** Templates `mfa_enabled`, `mfa_disabled`, `password_changed`, `recovery_codes_regenerated` and `sessions_revoked_all` are sent best effort. A "this wasn't me" link also revokes the device its alert was about.
- **Pending sign-ups are keyed by the hash of the flow id (section 2.1).** `flow:` and `signup:` keys hold `sha256(flowId)`, like sessions and tickets.
- **The two limits section 6 named exist:** `signup/complete` 10 per address an hour, `onboarding/handle` 10 per session an hour. Every `rate_limited` answer carries `Retry-After`.
- **A browser is a web client (section 4).** A request carrying `Sec-Fetch-Mode` or `Origin` is treated as `platform: web`, whatever the body says, so no script on the app origin can obtain a bearer token.
- **Revocation outlives the cache (section 4).** Revoking writes a tombstone under the session cache key; a cache fill never overwrites one.
- **Passwords are re-hashed at sign-in** when their parameters are older than the current ones, and **previous TOTP keys** (`TOTP_ENC_KEYS_PREVIOUS`) decrypt a secret that is then re-encrypted with the current key.
- **Malformed JSON is `invalid_request` with status 400**, not an internal error.
- **The client address (section 6).** `TRUST_PROXY` (`cloudflare`, `caddy`, `none`) decides which header names the client; every per-address limit and audit row uses the keyed hash of that address, never the address. Production refuses Cloudflare's Turnstile test secrets, plain-http origins and a mail relay without TLS.
- **The retention job is in scope (section 1, previously out of scope).** Every ten minutes the API deletes email codes consumed or expired a day ago and sessions revoked or expired a month ago, nulls device address hashes not seen for 30 days (the design's IP-hash purge), and removes security events older than 90 days through `auth.purge_events`, a function the migrator owns so the table stays append-only for the API role.

## 15. Delivered by 1b (2026-09-24)

`docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md` delivers the 1b row of section 1's table (profile editing, handle-change rules, the verified badge, data export, account deletion) and adds the email change this table left out. Where this document and the 1b design differ, the 1b design is current: handles may change once every 30 days at any age (section 2 of the 1b design; this document's onboarding handle is the first entry of `handle_history`), the badge is a phone proof through a provider interface, and deletion needs fresh authentication, an emailed code and the typed handle.
````

### Replace `docs/superpowers/specs/2026-09-18-images-2b-design.md` (whole file)

````markdown
# korbat sub-project 2b: Images — Design

Date: 2026-09-18. Status: approved in brainstorm. The technical assumptions were then checked by experiment and source research (section "Research"), which changed a few numbers (section "Changes since the brainstorm"). Awaiting written review.

## Context

Sub-project 2 of the korbat design (`2026-09-03-korbat-design.md`, build-order row 2) was split into 2a text posting and feed (executed 2026-09-17), 2b images, and 2c explore. This is 2b: images on posts, end to end.

What exists today:

- `post_media` was created by Foundation and has never been written by any code.
- `apps/worker` is the Foundation skeleton: a Redis list consumer with one `noop` job.
- The Compose stack runs MinIO and a bucket-init job that no code uses.
- 2a's `social` module creates, deletes and hydrates posts. Its composer and post card are text only.
- The API applies `Cache-Control: no-store`, a 300-per-minute per-IP limit and session resolution to every request, and `/api/health` answers 503 when any check fails. Sections 5.5 and 9 adjust these for images.
- The 2a integration tests write fixture accounts and posts into the development database and leave them there. Some are future-dated by the tests' clock, so they sit on top of the public Latest timeline in development.

One fact changed under the main design. MinIO's community edition stopped publishing images in October 2025, entered maintenance mode in December 2025, was archived in April 2026, and its Docker Hub repositories were removed on 2026-09-11. The image korbat pins is the last one, from September 2025, and will get no security fixes.

## Decisions

| Topic | Decision |
|---|---|
| Storage | Two Docker volumes behind a small file protocol. MinIO leaves the stack. An S3 adapter can be added behind the same interface if it is ever wanted |
| Pipeline | The worker has no network and no credentials. Work is handed over through files. The API owns the database and finalizes rows |
| NSFW score (rule R1) | Moves to sub-project 3, to arrive with the review queue, CSAM matching and appeals. `nsfw_score` stays empty; the pipeline keeps a slot for it |
| Alt text | Required on every image, 1 to 1000 characters |
| Images per post | Up to 4, on posts, replies and quotes. A post needs text or at least one image |
| Formats | JPEG, PNG, WebP, AVIF and single-frame GIF in. WebP out, in two sizes. Animated images and HEIC are refused with a clear message |
| Serving | The API serves image files after a visibility check. Images of visible posts are public and cacheable for 5 minutes; everything else is for the author only and never cached |
| Originals | Never kept. The uploaded file is deleted as soon as processing ends |
| Test isolation | Integration tests run against a separate `korbat_test` database and Redis database 15. A script clears what 2a left in the development database |

## Research

Done on 2026-09-18 with sharp 0.35.4 (libvips 8.18.6) on Windows x64, Docker Desktop on WSL2, and primary sources. "Measured" means run in a scratch folder or a throwaway Compose project.

| Finding | Consequence |
|---|---|
| Measured: the prebuilt sharp binary contains SVG and TIFF loaders next to JPEG, PNG, WebP, GIF and AVIF. HEIC cannot be decoded | The decoder allowlist is necessary, not decoration |
| Measured: `sharp.block({operation: ["VipsForeignLoad"]})` refuses every format; unblocking the parent classes `VipsForeignLoadJpeg`, `VipsForeignLoadPng`, `VipsForeignLoadWebp`, `VipsForeignLoadNsgif` and `VipsForeignLoadHeif` admits exactly JPEG, PNG, WebP, GIF and AVIF. An unknown class name is ignored without an error | A typo would silently leave a format blocked or the allowlist incomplete. Tests must prove that each allowed format decodes and that SVG and TIFF do not |
| Measured: Ultra HDR and Apple gain-map JPEGs decode through the plain JPEG loader when the Ultra HDR loader is blocked, with byte-identical output | Phone photos are not refused, and the embedded gain-map image is dropped |
| Measured: `metadata().pages` is 2 or more for animated GIF and WebP without decoding frames. Source: libvips 8.18 has no APNG support and reads only the first frame | Animation is detected from `pages`; APNG from its `acTL` chunk; AVIF sequences from their brand |
| Measured: default output has no EXIF, GPS, ICC, XMP or IPTC, `autoOrient()` applies the EXIF rotation first, a ZIP appended to a JPEG does not reach the output, and a truncated JPEG is refused at `failOn: "error"` | The pipeline is a fresh encode. Nothing of the original file survives |
| Measured: the pixel limit is enforced from the header in about 3 ms | Decompression bombs are refused before any pixel is decoded |
| Measured: decode memory follows pixel count, not file size. At 48 MP: WebP 96 MB, 8-bit PNG 107 MB, progressive JPEG 255 MB, GIF 325 MB, 16-bit interlaced PNG 400 MB, AVIF 948 MB. AVIF at 20 MP: 423 MB, from a 932-byte file. AVIF at 12 MP: 281 MB. A 12 MP photo of pure noise takes 0.7 s for both sizes at about 107 MB | Pixel caps are per format: 16 MP for AVIF, 50 MP for the rest. The worker gets 768 MB. One image at a time |
| Source: sharp's `timeout()` is cooperative and may not interrupt a single blocking decoder call | The worker has its own watchdog that exits the process |
| Source: libvips honours `VIPS_BLOCK_UNTRUSTED` only if it is set before it loads. In this build it blocks SVG and two others, not TIFF | It is set as well, but the allowlist is the control that matters |
| Source: a critical libheif advisory was published on 2026-08-25 and fixed in sharp 0.35.4 the next day; the workaround was to block the HEIF loader. sharp fixes only its latest release | Formats can be switched off by configuration without a deploy. sharp is kept current, and the worst-case check is rerun after each upgrade |
| Source: many camera JPEGs, Samsung phones among them, raise libjpeg warnings such as "Invalid SOS parameters". sharp's default `failOn: "warning"` refuses them | `failOn: "error"`. The decoder has already run when a warning is raised, so this does not widen the attack surface; it only stops refusing ordinary photos |
| Source: sharp 0.35 has no install scripts; the platform binary is an optional dependency selected by operating system, CPU and libc | pnpm has nothing to block. The worker image must install inside Alpine, as the API image already does for argon2 |
| Source: sharp is Apache-2.0; the prebuilt libvips packages are LGPL-3.0-or-later, as a separate dynamically loaded library | No obligations for running it. If korbat images are ever distributed, ship the notices; the library is already replaceable |
| Measured: a named volume takes the image directory's owner even when its first mount is read-only, as long as the path exists in the image. Source: while a volume is empty, every container creation re-applies that image's owner | Both images create both mount paths owned by `node`. No init container is needed |
| Measured: a container with `network_mode: none` has only a loopback interface, still reports a file-based health check, gates `depends_on`, and accepts `docker compose exec`. The other side's volume gives `EROFS` | The isolation model works as designed |
| Source: a read-only mount cannot be remounted without `CAP_SYS_ADMIN`, which a non-root process with all capabilities dropped and `no-new-privileges` cannot get. Files written by the other container must still be treated as untrusted | The API checks every file it opens in the store (section 7.3). Without that, a compromised worker could plant a symlink to `/proc/self/environ` and have the API serve its own secrets |
| Source: `rename(2)` is atomic inside one mount and fails across mounts. A rename to a new name is not made durable by ext4 on its own | Temporary files live in the volume they are renamed in, and are `fsync`ed first |
| Source: Hono 4.13.5's `bodyLimit` reads a chunked body fully into memory before the handler runs | The upload route counts bytes itself while streaming to disk |
| Source: Cloudflare caches by file extension, `.webp` included, honours `public, max-age`, never caches `private` or `no-store`, and ignores request cookies in the cache key. Its default Browser Cache TTL of 4 hours overrides a shorter `max-age` | Image URLs end in `.webp`. Anything that depends on the viewer is `private, no-store`. The zone must be set to "Respect Existing Headers" |
| Source: Cloudflare's CSAM Scanning Tool is free on every plan and scans only content served from its cache | Public images must be cacheable, which they are. Sub-project 3 turns the tool on |
| Source: `expo-image` supports web; blurhash placeholders are decoded in JavaScript and need only `img-src blob:`, which the CSP already allows. On web the `<img alt>` comes from `accessibilityLabel`, not from `alt` | The post card passes `accessibilityLabel` |

Sources:

- MinIO: https://blog.vonng.com/en/db/minio-resurrect/ and https://stormdevelopments.ca/blog/minio-s-community-edition-is-archived-what-still-runs-in-2026/
- sharp: https://sharp.pixelplumbing.com/security/ , https://sharp.pixelplumbing.com/api-utility/ , https://sharp.pixelplumbing.com/api-constructor/ , https://sharp.pixelplumbing.com/changelog/v0.35.0/ , https://github.com/lovell/sharp/security/advisories
- libvips: https://github.com/libvips/libvips/blob/8.18/libvips/iofuncs/operation.c , https://github.com/libvips/libvips/blob/8.18/libvips/iofuncs/init.c , https://github.com/libvips/libvips/discussions/3705
- Docker: https://docs.docker.com/engine/storage/volumes/ , https://github.com/moby/moby/issues/45714 , https://docs.docker.com/engine/network/drivers/none/ , https://docs.docker.com/engine/containers/resource_constraints/ , https://man7.org/linux/man-pages/man2/rename.2.html
- Hono: https://github.com/honojs/hono/blob/v4.13.5/src/middleware/body-limit/index.ts , https://github.com/honojs/hono/security/advisories/GHSA-9vqf-7f2p-gf9v
- Cloudflare: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ , https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/ , https://developers.cloudflare.com/cache/reference/csam-scanning/
- Caddy: https://caddyserver.com/docs/caddyfile/directives/request_body
- expo-image: https://docs.expo.dev/versions/v57.0.0/sdk/image/ , https://github.com/expo/expo/blob/sdk-57/packages/expo-image/src/ExpoImage.web.tsx

## Changes since the brainstorm

The brainstorm fixed the decisions above. Research changed these details:

- The side limit rises from 10,000 to 16,383 pixels, so phone panoramas pass. Memory is governed by the pixel caps, not the side.
- AVIF gets its own cap of 16 MP.
- The worker's memory limit is 768 MB, not 512 MB.
- New: a free-space floor for uploads, a configuration switch per format, a watchdog in the worker, checks on every file the API opens in the store, an own rate-limit bucket and no session lookup for public image requests, an advisory health check for the worker, and a Cloudflare setting that deployment must apply.
- The test environment file is derived from the development one, and the integration test configuration loads it by itself. Tests no longer depend on the shell having sourced a file.

## 1. Scope

In scope:

- Uploading, processing, storing, serving and deleting images on posts, replies and quotes.
- Required alt text.
- The composer: picking images in the browser, previews, a description per image, processing state.
- The post card: an image grid with blurhash placeholders, an ALT control, a full-screen viewer, thumbnails in quoted posts.
- Compose: MinIO removed, two volumes added, the worker isolated and limited.
- Test isolation and the cleanup of 2a's fixtures.

Out of scope, with its owner:

- NSFW scoring, the composer warning and automatic withholding (sub-project 3).
- Turning on CSAM scanning and purging the CDN on removal (sub-project 3). 2b only shapes the URLs for it.
- Avatars and banners (1b). They will reuse this pipeline.
- Animation and video (v2 in the main design).
- A native image picker (sub-project 5). On native the add-image button is hidden.
- Cropping, editing, reordering, paste and drag-and-drop, and an upload percentage.
- Imports from other platforms (3b). See section 14.
- Backups of the store volume (sub-project 4).

## 2. Architecture

### 2.1 Pieces

- **`packages/media-protocol`** (new, depends only on zod): the contract between the API and the worker. Limits, directory layout and path helpers, the result file schema, failure reasons, and the byte sniffers (format by magic bytes, APNG by its `acTL` chunk, AVIF sequences and HEIC by brand).
- **`apps/worker`** (rewritten): the image processor. It loses `ioredis`, `@korbat/db` and the Foundation job registry, and gains `sharp` and `blurhash`. Files: `config.ts`, `pipeline.ts` (everything that touches sharp), `loop.ts` (one tick: heartbeat, deletions, processing, cleanup), `index.ts`.
- **`apps/api/src/media/`** (new module, shaped like `auth` and `social`): `context.ts` (`MediaError`, dependencies), `files.ts` (the API's side of the protocol and the safe open), `repo.ts` (every SQL statement on `post_media`), `flows/upload.ts`, `flows/status.ts`, `flows/remove.ts`, `flows/serve.ts`, `sweeper.ts`, `routes.ts`, `index.ts`.
- **`apps/api/src/social/`**: creating a post attaches images, deleting one detaches them, and views carry them. It reaches `post_media` only through the media module's interface.
- **Compose**: `minio` and `minio-init` leave. `media-uploads` and `media-store` arrive. The worker is cut off from the network.

### 2.2 The file protocol

```
media-uploads   API read-write, worker read-only   /media/uploads
  tmp/<id>.part          a body being received
  incoming/<id>          a complete upload waiting for the worker
  delete/<id>            a request to delete image <id>

media-store     worker read-write, API read-only   /media/store
  files/<aa>/<id>/small.webp, large.webp           <aa> = first two characters of the id
  results/<id>.json      the outcome, written last
  attempts/<id>          how often processing started
  tmp/                   files being written
  heartbeat              rewritten every 10 seconds
```

A result is `{ "v": 1, "id", "status": "ready", "width", "height", "blurhash" }` or `{ "v": 1, "id", "status": "failed", "reason" }`. Width and height are those of `large.webp`, after rotation.

Rules:

1. Each side writes only its own volume. A file is written under that volume's `tmp/`, `fsync`ed, and renamed into place, so the other side never sees half a file.
2. Ids are UUIDs that the API makes with `randomUUID`. Both sides ignore every entry whose name is not a lowercase UUID (plus `.json` or `.part` where that applies) or that is not a regular file. No name or path from a user ever reaches the file system.
3. The result file is the commit point. An upload without a result is unprocessed and is simply processed again.
4. The upload is deleted by the API once the row is final. A result whose upload is gone has been consumed, and the worker removes it.
5. A delete request is removed by the API once the image folder and result are gone.

### 2.3 The worker

One loop, one image at a time. Each tick (every 500 ms, without overlap):

1. Rewrite `heartbeat` if 10 seconds have passed.
2. For every `delete/<id>`: remove `files/<aa>/<id>/`, `results/<id>.json` and `attempts/<id>`.
3. For every `incoming/<id>` without a result, oldest first: process it.
4. Remove every result whose upload is gone.

Processing one upload:

1. Read `attempts/<id>`. At 3, write a `processing_failed` result and stop. Otherwise write the count plus one. This happens before any decoding, so a file that kills the process is retried at most three times.
2. Sniff the first bytes. Refuse anything that is not an enabled format, and refuse HEIC, APNG and AVIF sequences. No decoder has run yet.
3. Read metadata. Refuse more than one page (`animated_not_supported`), a format that does not match the sniff, an AVIF whose compression is not AV1, more than 16,383 pixels on a side, and more than the format's pixel cap (`image_too_large`). The pixel cap is also passed to sharp as `limitInputPixels`, which enforces it from the header.
4. For each size: `sharp(path, { limitInputPixels, failOn: "error", sequentialRead: true }).autoOrient().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).webp({ quality, effort: 4 }).timeout({ seconds: 30 })`. Sizes are `large` (long edge 2048, quality 82) and `small` (1024, quality 80). Transparency is kept. Output is sRGB without any metadata, which is sharp's default.
5. Blurhash: `small.webp` reduced to fit 32 by 32 pixels, encoded with 4 by 3 components.
6. Write both files, then the result.

A decode error becomes `corrupt_image`. Any other error becomes `processing_failed`. A watchdog ends the process if one upload takes longer than 120 seconds; Docker restarts the container and the attempt counter does the rest.

At start the worker sets `VIPS_BLOCK_UNTRUSTED` before sharp loads, blocks `VipsForeignLoad`, unblocks the enabled formats' classes, and sets `sharp.cache(false)` and `sharp.concurrency(1)`. It logs ids and reasons, never bytes or user data.

### 2.4 The media module

`createMedia(options)` takes the API pool, the uploads and store directories, the enabled formats, the free-space floor, the rate-limit store, the Redis client (for the sweeper's lock), the logger, the auth module's `requireSession` and `resolveSession`, an `enforceUploadLimit` function, and an optional clock. It returns:

- `routes`: upload, status and removal, mounted under `/api/media`.
- `fileRoutes`: the image file route, mounted before session resolution (section 5.5).
- `forPosts`: the interface the social module uses (section 2.5).
- `sweep(now)` and `startSweeper()`: section 4.7.
- `healthCheck`: fails when the heartbeat is older than 60 seconds or free space is under the floor.

`enforceUploadLimit` is built in `src/index.ts` from the social module's write-limit function, so all per-account write limits stay in one table and the two modules do not import each other's internals.

### 2.5 The social module

`createSocial` takes an optional `media` with four functions. Without it, posts carry no images and attaching any is `media_unavailable`, so the 2a tests keep working unchanged.

- `attach(tx, { postId, ownerId, items })`: inside the post's transaction. One statement sets `post_id`, `position` and `alt_text` on rows that belong to the author, are `ready` and are not attached. Fewer updated rows than items rolls the post back with `media_unavailable`.
- `detachAll(tx, postId)`: inside the delete transaction. Deletes the rows and returns their ids.
- `requestDeletion(ids)`: after the commit. Writes the delete requests.
- `forPosts(postIds)`: one query for a page of posts, quoted posts included.

### 2.6 Boundary enforcement

The architecture test gains these rules, each proven by a deliberate violation:

- Code outside `apps/api/src/media/` imports only `media/index.ts`.
- Only the media module mentions `postMedia` or `post_media`.
- The media module does not import from `auth/` or `social/` internals.
- `apps/worker` does not depend on or import `@korbat/db`, `ioredis`, `postgres` or any network client.
- Only `apps/worker/src/pipeline.ts` imports `sharp`.

### 2.7 Contracts

New in `packages/contracts/src/media.ts`: `MEDIA_MAX_BYTES` (20 MiB), `MEDIA_MAX_PER_POST` (4), `MEDIA_ACCEPTED_TYPES`, `ALT_MAX_LENGTH` (1000), `normalizeAltText` (NFC, runs of whitespace to one space, trim), `AltText` (no control characters, 1 to 1000 code points after normalization), `MediaErrorCode`, `MediaFailure`, `UploadResponse`, `MediaStatusResponse` and `MediaView`:

```
MediaView = { id, width, height, blurhash, alt, small, large }
```

`small` and `large` are paths such as `/api/media/<id>/small.webp`, so the server can move images later without a client change.

Changed in `social.ts`: `CreatePostRequest` gains `media: [{ id, alt }]` (at most 4, distinct ids, default empty). `body` may be empty, and a refinement requires text or at least one image. `PostView` and `QuotedPost` gain `media: MediaView[]`, always present. Tombstones carry none.

## 3. Data model changes

`post_media` is reworked in place. It has no rows in any environment, so required columns are added without a backfill.

| Column | Change |
|---|---|
| `owner_id` | new, required, references `profiles` with cascade |
| `status` | new enum `media_status`: `processing`, `ready`, `failed`; default `processing` |
| `error` | new, the failure reason |
| `created_at` | new, required |
| `post_id`, `position` | become optional; set when the image is attached |
| `width`, `height`, `blurhash` | become optional; set when the image is ready |
| `path` | dropped. The location follows from the id |
| `alt_text`, `nsfw_score` | unchanged. `nsfw_score` stays empty until sub-project 3 |

Checks: a `ready` row has width, height and blurhash; an attached row is `ready` and has a position from 0 to 3 and alt text; alt text has at most 1000 characters. Indexes: the existing unique `(post_id, position)`, plus `(owner_id, created_at)` for the pending count and `(status, created_at)` for the sweeper. Row-level security stays as it is.

`posts.body` already allows an empty string. A post without text and without images is refused by the API.

## 4. Lifecycle

### 4.1 Upload

`POST /api/media` with the file as the raw body. The API checks the session, the upload limit, the pending count and free space, then the declared type. It reads the first bytes and sniffs them, streams the body to `tmp/<id>.part` while counting bytes, stops at 20 MiB, inserts a `processing` row, renames the file into `incoming/`, and answers `202 { id, status: "processing" }`. The row comes before the rename, so the worker never processes an upload nobody owns. A disconnect or an error deletes the partial file.

### 4.2 Process

Section 2.3.

### 4.3 Finalize

Whoever looks first finalizes: `GET /api/media/:id` from the composer, or the sweeper. It reads the result through the safe open, updates the row only if it is still `processing`, and deletes the upload. It is safe to repeat.

### 4.4 Attach

`POST /api/posts` with `media`. Section 2.5.

### 4.5 Serve

Section 5.5.

### 4.6 Delete

- Deleting a post detaches its images in the same transaction and requests their deletion after the commit. Serving stops with the commit, because the rows are gone.
- `DELETE /api/media/:id` removes an upload that is not attached.
- The sweeper removes what nobody attached.

### 4.7 The sweeper

Every 30 seconds in the API, under a Redis lock so that one instance runs it. `sweep(now)` is a plain function, which tests call with a moved clock.

1. Finalize `processing` rows that have a result.
2. Fail `processing` rows older than 5 minutes (`processing_failed`), delete their upload and request deletion.
3. Remove rows that were never attached and are older than 24 hours, with their files.
4. Remove delete requests whose image folder and result are gone.
5. Every 10 minutes, reconcile: request deletion of image folders older than an hour that have no row, and delete uploads and partial files older than an hour that have no row. This cleans up after a crash between a commit and a file operation, and after account deletion, where rows go by cascade.

## 5. Endpoints

### 5.1 `POST /api/media`

Session required. Body: the file. `Content-Type` must be one of the accepted types; it is checked and then forgotten. Answers `202 { id, status }`. Errors: section 8.

### 5.2 `GET /api/media/:id`

Session required, owner only, otherwise `not_found`. Answers `{ id, status, error?, width?, height?, blurhash? }` and finalizes first if a result is waiting.

### 5.3 `DELETE /api/media/:id`

Session required, owner only, only while not attached. Answers 204.

### 5.4 `POST /api/posts`

Accepts `media`. Every other rule of 2a applies unchanged: reply and quote targets, blocks, tiers, limits.

### 5.5 `GET /api/media/:id/small.webp` and `/large.webp`

- The post is visible: the file, with `Cache-Control: public, max-age=300` and an `ETag`. No session is looked up.
- The post is withheld or removed: the route resolves the session itself, and serves the author with `Cache-Control: private, no-store`. Everyone else gets 404.
- No row, not ready, not attached, or post deleted: 404.

A block is not checked here. 2a already states that posts are public to anyone who signs out, and its block screens say so; an image follows its post.

`If-None-Match` answers 304 after the same checks. The response always has `Content-Type: image/webp`, and the API's existing headers apply: `nosniff`, a CSP of `default-src 'none'`, and `Cross-Origin-Resource-Policy: same-origin`, which also stops other sites from embedding the images.

Three changes in `app.ts` make this work:

- `fileRoutes` is mounted before `auth.resolveSession`, so public image requests cost one query.
- These requests are exempt from the 300-per-minute global limit and have their own bucket of 1200 per minute per IP. A timeline page can hold 80 images.
- `noStore` sets its header only when the handler set none.

## 6. Limits and abuse controls

| Limit | Value |
|---|---|
| File size | 20 MiB |
| Images per post | 4 |
| Alt text | 1 to 1000 characters, required |
| Pixels | 50 MP for JPEG, PNG, WebP and GIF; 16 MP for AVIF |
| Side | 16,383 pixels |
| Uploads, account younger than 24 hours | 20 per hour |
| Uploads, established account | 120 per hour |
| Uploads waiting to be attached | 20 per account |
| Processing | fails after 5 minutes |
| Unattached uploads | deleted after 24 hours |
| Free space | uploads are refused under 2 GiB free on either volume |
| Image requests | 1200 per minute per IP |

Upload limits are a new row in 2a's tier table and use its mechanism, so sub-project 3 replaces account age with reputation in one place. The free-space floor exists because the volumes share a disk with Postgres: filling the disk with images would stop the database.

## 7. Hardening

### 7.1 The container

`network_mode: none`, read-only root file system, user `node`, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit` and `memswap_limit` of 768 MB, one CPU, 64 processes, a 64 MB tmpfs at `/tmp` for libvips. It mounts the uploads read-only and the store read-write, and nothing else. It has no database URL, no Redis URL, no keys. Its health check reads the heartbeat file.

The image decoder is the most exploitable code korbat runs. If it is compromised, the attacker holds two directories, cannot call out, and cannot reach Postgres, Redis or the API.

### 7.2 The decoder

Section 2.3: magic bytes before any decoder, an allowlist of five loader classes, `VIPS_BLOCK_UNTRUSTED`, pixel caps from the header, one image at a time, a timeout per encode, a watchdog per upload, and at most three attempts per file.

`MEDIA_FORMATS` (default `jpeg,png,webp,gif,avif`) is read by the API and the worker. Removing a format refuses it at upload and leaves its loader blocked. When an advisory names a decoder, the operator edits one line and restarts two containers.

### 7.3 The store is untrusted

The API treats every file in the store as written by an attacker. It opens a file, and then checks the open handle: it must be a regular file, on the same device as the store directory, and within a size bound (16 KiB for a result, 32 MiB for an image). A symlink to anything outside the volume lands on another device and fails the check, and checking the handle leaves no window between check and use. Results are parsed with the protocol schema. A file that fails is answered with 404 and logged as a security event.

Image bytes are always sent as `image/webp` with `nosniff` and the API's `default-src 'none'` CSP, so bytes a compromised worker wrote cannot become active content.

### 7.4 Privacy

EXIF, GPS, ICC, XMP, IPTC, embedded thumbnails and gain maps do not survive. The original is deleted after processing and is never backed up. Nothing of the upload request is stored: not the file name (there is none in a raw body), not the declared type.

## 8. Errors

New codes in `MediaErrorCode`, in the standard envelope:

| Code | Status | When |
|---|---|---|
| `unsupported_media_type` | 415 | The declared type or the first bytes are not an enabled format. HEIC gets its own message: export as JPEG |
| `file_too_large` | 413 | More than 20 MiB |
| `too_many_pending_uploads` | 409 | 20 uploads wait to be attached |
| `uploads_unavailable` | 503 | Free space is under the floor |
| `media_unavailable` | 400 | Attaching an image that does not exist, is not yours, is not ready, or is already attached |

Reused: `invalid_request` (more than 4 images, a repeated id, missing or long alt text, a post without text and images), `rate_limited`, `not_found`, `unauthenticated`, `onboarding_required`, `csrf_failed`.

Failure reasons on a status response, not HTTP errors: `unsupported_format`, `animated_not_supported`, `image_too_large`, `corrupt_image`, `processing_failed`. The web app has a sentence for each.

## 9. Configuration and infrastructure

- **API**: `MEDIA_UPLOADS_DIR`, `MEDIA_STORE_DIR` (defaults under `.data/media/` at the repository root, for development on the host), `MEDIA_FORMATS`, `MEDIA_MIN_FREE_BYTES`.
- **Worker**: `MEDIA_UPLOADS_DIR`, `MEDIA_STORE_DIR`, `MEDIA_FORMATS`, `LOG_LEVEL`. `apps/worker/.env.example` is added and `gen-dev-env.mjs` handles it.
- **Compose**: `minio`, `minio-init`, their variables and the development ports 59000 and 59001 are removed. The `miniodata` volume is no longer declared; the volume on disk is left for its owner to delete, and the README says how. The API mounts the uploads read-write and the store read-only. The worker is set up as in 7.1 and no longer depends on Redis.
- **Images**: both Dockerfiles create `/media/uploads` and `/media/store` owned by `node`. The worker image installs inside Alpine and copies `sharp`, `@img`, `detect-libc` and `semver` next to the bundle, as the API image does for argon2.
- **Caddy**: `request_body` with `max_size 25MB` on `/api/media`, as a second line behind the API's own count.
- **Health**: `healthRoutes` takes advisory checks next to the critical ones. A failing advisory check reports `degraded` with status 200, so a stopped worker does not mark the API unhealthy and keep Caddy from starting. The worker is an advisory check.
- **Cloudflare**, recorded for Foundation Task 16 and sub-project 4: Browser Cache TTL "Respect Existing Headers". Without it browsers keep images for 4 hours whatever the origin says.
- **`.gitignore`**: `.data/`.

## 10. Web screens

Dependency: `expo-image`.

**Composer**

- "Add image" opens the browser's file picker, limited to the accepted types, several files at once, at most 4 in total. It is not shown on native.
- A file that is too large or of another type is refused before upload, with the reason.
- Each image shows a local preview at once (`URL.createObjectURL`, released on removal), its state (uploading, processing, ready, or the failure sentence), a description field with a counter, and Remove. Remove also calls `DELETE /api/media/:id`.
- The status is polled once a second until it is final.
- Post is enabled when there is text or an image, the text is within its limit, every image is ready, and every image has a description. The button says what is missing.

**Post card**

- One image: full width, its own ratio held between 3:4 and 2:1. Two to four images fill one 16:9 frame and crop to fill their cell: two side by side; three as one tall cell on the left and two stacked on the right; four as a two-by-two grid.
- Blurhash placeholders, lazy loading, the `small` size in lists.
- An ALT control shows the descriptions. `accessibilityLabel` carries each description to the `<img>`.
- A quoted post shows its images as one row of thumbnails.

**Viewer**

- Pressing an image opens it full screen: the `large` size fitted inside the screen, the description under it, previous and next, arrow keys, Escape. Focus returns to the image that opened it.

`lib/social.ts` gains `uploadMedia`, `mediaStatus` and `removeMedia`. Uploads send the CSRF header like every other write.

## 11. Test isolation

- `scripts/test-db.mjs` creates `korbat_test` in the Compose Postgres if it is missing, applies the per-database grants of `infra/postgres/init/01-roles.sh`, and runs the migrations with the migrate role. It can be run again at any time. Secrets are read from `infra/.env` and never printed.
- `gen-dev-env.mjs` writes `apps/api/.env.test` from `apps/api/.env` on every run: the same values, with the three database URLs pointing at `korbat_test` and the Redis URL at database 15. No second example file is kept.
- `vitest.integration.config.ts` loads `.env.test` itself and stops with instructions when the file is missing. Running `pnpm --filter @korbat/api test:integration` is enough; no file has to be sourced first.
- A global setup refuses to run unless both database names end in `_test` and the Redis database is 15. It then flushes that Redis database and truncates every table of the `public` and `auth` schemas.
- Media tests use temporary directories.
- `scripts/clean-dev-fixtures.mjs` lists what the tests left in the development database: profiles without an account behind them, and accounts whose email matches the tests' patterns. It deletes them only with `--yes`, and refuses to run unless `API_APP_ORIGIN` in `infra/.env` is a localhost origin.
- The smoke test deletes the post it made, which also exercises file deletion end to end.

## 12. Testing

- **`media-protocol`**: every accepted format by its bytes; HEIC brands, AVIF sequences and APNG detected; SVG, TIFF, PDF and ZIP refused; short buffers; path helpers refuse anything that is not a UUID; the result schema.
- **Worker**, with real sharp and fixtures made at test time:
  - each enabled format is processed, and SVG and TIFF are refused, which guards the allowlist against a silent typo;
  - a format removed from `MEDIA_FORMATS` is refused;
  - animated GIF, animated WebP and APNG are refused; 17 MP AVIF and 51 MP PNG are refused from the header; a truncated file is `corrupt_image`;
  - outputs are WebP of the right sizes, never enlarged, rotated by EXIF, without EXIF, GPS, ICC or the strings planted in the input, and without a ZIP appended to it;
  - Ultra HDR input is processed;
  - the third attempt fails the file without decoding; delete requests remove folder, result and counter; a result without an upload is removed; the heartbeat is written; names that are not UUIDs and entries that are not regular files are ignored.
- **API unit**: the byte counter stops a chunked body without a length at the limit; the sniff runs before anything is written; the safe open refuses a directory, an oversized file and a file on another device; `noStore` keeps a handler's header; advisory health checks.
- **API integration** against `korbat_test`, with a fake worker that writes results by the protocol: upload, status and finalize; every limit; attach rules (not yours, not ready, already attached, five images, no alt text, repeated id); a post with images and no text; a post with neither refused; images in timelines, threads, profiles and quotes; deleting a post removes rows and requests deletion; serving for visible, withheld, removed, deleted and unattached; `ETag` and 304; the sweeper's five jobs with a moved clock.
- **Architecture**: the rules in 2.6, each with a violation proven to fail.
- **Web**: typecheck and export; a scripted browser check of upload, description, post, grid, viewer and delete.
- **Docker**: the smoke test uploads a JPEG carrying GPS data through Caddy, waits for ready, posts it, and fetches `large.webp`: WebP bytes, the public cache header, no GPS. It then replaces that file with a symlink to `/proc/self/environ` from inside the worker container and expects 404 without any secret in the body. It deletes the post, expects 404, and checks that the folder is gone. It checks that the worker has only a loopback interface, that its memory limit is set, and that it never restarted.
- **Worst case**, in the dry run and after every sharp upgrade: the smoke test's `--worst-case` mode uploads flat-colour files at the caps (48 MP 16-bit interlaced PNG, 48 MP progressive JPEG, 48 MP GIF, 16 MP AVIF) and expects all ready, with `OOMKilled` false and no restart.

## 13. Dependencies

| Package | Where | Licence | Notes |
|---|---|---|---|
| `sharp` 0.35.4 | worker | Apache-2.0; prebuilt libvips LGPL-3.0-or-later | no install scripts; published 2026-08-26 |
| `blurhash` 2.0.5 | worker | MIT | no dependencies |
| `expo-image` 57.0.5 | app | MIT | the version Expo 57 expects; published 2026-09-11 |

Removed from the worker: `ioredis`, `@korbat/db`. All additions follow 1a's method: an exact version, the release-age override on that one command, and `check-lockfile-age.mjs` proving every new lockfile entry is at least 7 days old.

## 14. Effects on other documents and later work

- **Main design**: dated amendments record that volumes replace MinIO, that uploads stream through the API instead of signed URLs, that `post_media` has the shape of section 3, that NSFW scoring moves to row 3, and that the worker only processes images. Scheduled database jobs named there (the IP-hash purge of sub-project 4, the explore refresh of 2c) run in the API under a Redis lock, like the sweeper.
- **3b imports**: the quarantine bucket becomes a quarantine volume. Archives of up to 2 GB cannot pass Cloudflare's 100 MB request limit in one request, with or without MinIO, so 3b needs chunked uploads. Imported images enter this pipeline as uploads.
- **Sub-project 3**: scoring fills `nsfw_score` in the worker's slot; withholding already hides images from everyone but the author; CSAM scanning needs the cacheable URLs this slice provides; removal should purge the CDN.
- **Sub-project 4**: back up `media-store` with the database; tune Cloudflare as in section 9; check whether the Node binary in the image is position independent, as sharp's security page advises.
- **README**: new commands, the test database, and how to delete the old MinIO volume.

## 15. Success criteria

2b is done when:

1. A signed-in person can add up to four described images to a post, reply or quote on the web, and everyone who may see the post sees them in timelines, threads, profiles and quotes.
2. Stored images are fresh WebP encodes without metadata, and the original is gone, proven by the worker tests and the smoke test.
3. The worker runs without network, credentials or capabilities, refuses every format outside the allowlist, and survives the worst-case files within its memory limit without a restart.
4. A symlink planted in the store cannot make the API serve a file from outside the volume, proven on the built stack.
5. Images of withheld and removed posts reach only their author, and images of deleted posts are gone from disk.
6. Integration tests run only against `korbat_test`, and the development database gets no new fixtures.
7. The architecture test passes and fails on each deliberate violation.
8. Semgrep and the dependency audit stay clean, and the smoke test and the browser check pass on the built stack.

## 16. Amendments from the dry run (2026-09-19)

The plan was dry-run task by task in a scratch clone before the execution prompts were written, with every gate run by a script that required its expected output. Where the built system differs from sections 1 to 15, this section is the verified version.

### Schema and packages (sections 3 and 4)

| Spec | Built |
|---|---|
| One migration reshapes `post_media` | Two: `0005` drops `path` and makes post, position, width, height and blurhash optional; `0006` adds owner, status, failure reason, creation time, checks and indexes. drizzle-kit asks interactively when one migration both drops and adds columns, which a scripted run cannot answer |
| `@korbat/media-protocol` has no dependencies | It depends on `@korbat/contracts` for the size names and the failure reasons, so the worker's results and the API's responses share one list |
| The social repository owns its transactions | `createPost` and `deletePost` take a `within(tx)` callback, and `@korbat/db` exports the `DbTx` type; the media module attaches and detaches through the `MediaForPosts` interface, and the social module runs without images (`WITHOUT_MEDIA`) when none is wired |

### Worker (section 5)

- The small size and the blurhash come from one resize to raw pixels: the small WebP and the 32-pixel blurhash input are both made from that buffer, so the image is decoded twice (large, then small) rather than three times.
- In production the worker refuses to start without `VIPS_BLOCK_UNTRUSTED`; the image sets it, and a missing value means the image was changed.
- Ultra HDR has no fixture test. sharp 0.35.4 reports a gain map in its metadata but cannot write one, and the suites make every fixture at run time instead of committing binaries. The primary image of such a JPEG decodes like any JPEG, and every output is a fresh encode, so a gain map cannot survive.

### API (sections 6 to 8)

- Media ids are made lowercase by the contract (`MediaId`), and the file route checks the canonical form before it touches the disk. An id in capitals passed the UUID check and then made the volume layout throw, which answered 500.
- The social routes have their own error handler; it now maps `MediaError` like the app's. Without it, posting an image that was not ready answered 500.
- A deletion request stays for ten minutes after it is written (`DELETION_GRACE_MS`), so a slow worker cannot write files for an image whose request was already withdrawn.
- `noStore` sets `Cache-Control` only when the handler set none, so the file route's `public, max-age=300` survives.
- Caddy's upload limit applies to `/api/media` only, through an `@upload` path matcher inside `handle /api/*`.

### Development and stack (sections 9 and 11)

- The API and worker dev scripts run `tsx watch --env-file=.env`, so no shell has to source a file.
- The worst case on the built stack: the four files at the caps all became ready, and the worker's memory peaked at 383 and 385 MiB of its 768 MiB in two runs, without a restart or an OOM kill. The limit keeps about half in reserve.
- On Docker Desktop on this Windows machine, containers' outbound HTTPS is intermittently degraded: Turnstile verifications timed out at 5000 ms right after a heavy image build and, less often, at other times, and an image build's `pnpm install` failed with `ECONNRESET` while single requests got through. The API failed closed, as designed, and nothing in korbat changes for it. The smoke test tries a Turnstile refusal again every five seconds for up to a minute, where a wrong secret still fails, and the stack steps of the prompts say how to surface a build error their redirect hides.
- The smoke test makes its images with the sharp the worker depends on, resolved through `apps/worker/package.json`, and runs every container command with its standard input closed.

### Web (section 10)

- A HEIC photo is recognized by its name too, because browsers on Windows often give such a file no type; it gets the HEIC advice instead of the generic refusal.
- A quoted post's thumbnails are pictures, not buttons: the quote is one link to the quoted post, and a control inside a control is one that assistive technology cannot reach.
- The blurhash fades into the image in 150 ms, or at once when the system asks for reduced motion.
- The ALT control reports its state with `aria-expanded` and the Post button with `aria-busy`: react-native-web 0.21 ignores the `accessibilityState` prop, which the browser check caught on the ALT control. The older uses of `accessibilityState` in the app were fixed afterwards, in commit `1f5580a` (spec `2026-09-21-screen-reader-states-design.md`).
- The browser check covered sign-up, three uploads with their states, descriptions, the button naming what is missing, posting, the three-image grid, ALT, the viewer with arrow keys, Escape and focus return, an image-only post, and deletion down to the files on disk.
- A task step checks, in the installed source, the four library behaviours the grid and viewer rely on: expo-image puts `accessibilityLabel` into `<img alt>` and loads lazily by default; react-native-web's Modal closes on Escape and gives focus back when it closes.

### Test isolation (section 11)

- `scripts/clean-dev-fixtures.mjs` matches only emails of the tests' shape, `<word>-<uuid>@korbat.local`, and profiles without an account. Deleting profiles cascades to their rows, so the counters of kept profiles and posts those rows touched are recomputed from the rows in the same transaction. It prints the counts and up to 25 of each kind. The prompts run it without `--yes`; deletion was verified on seeded data in the scratch clone, where it also removed 117 accounts and 53 profiles that earlier test runs had left.

## 17. Amendments from the audit (2026-09-23)

Applied by `docs/superpowers/specs/2026-09-23-audit-fixes-design.md` (Tasks 5 and 6 of its prompts). Where this document and the audit design differ, the audit design is current.

- **Reconcile refuses large deletions (section 4.7).** The orphan pass refuses when the images without a row exceed 50 and 2% of the store, unless `MEDIA_RECONCILE=force`; `off` skips the pass for a restore window. A database restored from an older snapshot would otherwise lose every image posted since.
- **The store is never opened blocking (section 7.3).** Entries are inspected with `lstat` before they are opened, and opens are non-blocking, so a FIFO planted in the store cannot hold an API thread.
- **The sweeper is a job (section 4.7).** It runs on the API's job runner: one instance at a time, rounds never overlapping, the lock refreshed while a long reconcile runs.
- **Daily upload caps (section 6).** Besides 20 or 120 an hour, an account may upload 60 images a day in its first day and 500 a day afterwards.

- **Avatars stay deferred (section 12, 1b).** The 1b design leaves `profiles.avatar_path` unused; the pipeline is unchanged. The data export reads each ready image's `large.webp` from the store.
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
````

### Replace `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md` (whole file)

````markdown
# korbat — Account lifecycle (sub-project 1b) design

Date: 2026-09-24. Builds on the 1a identity design (`2026-09-14-identity-auth-1a-design.md`), the 2a posting design (`2026-09-17-posting-feed-2a-design.md`), the 2b images design (`2026-09-18-images-2b-design.md`) and the audit batch (`2026-09-23-audit-fixes-design.md`). Repository state at the start: `95e6e2b`.

## 1. Context

1a gave korbat accounts, sessions, two-factor and the onboarding handle; 2a and 2b gave posts, the social graph and images. What an account owner still cannot do: change the name, bio or handle chosen at onboarding, move the account to a new email address, earn the verified badge the main design promised, take their data with them, or leave. The main design (section 3b) puts self-service data export and account deletion in v1, and section 3a lists handle change, email change and account deletion among the actions that need fresh authentication.

This design was written under the user's standing instruction of 2026-09-23 to keep going without pausing for approvals, leaving only the steps that need their own accounts. Every choice that a brainstorm would normally have put to the user is listed in section 2 with the alternatives considered, so the user can overrule any of them; the account-dependent step (an SMS verification provider) is written up as a runbook in section 13 and the code runs without it.

## 2. Decisions taken without the user

| Decision | Chosen | Alternatives considered | Why |
|---|---|---|---|
| Handle changes | Allowed at any time, at most once every 30 days, with fresh authentication. Every handle an account ever had stays reserved for that account for ever (a `handle_history` table); nobody else can take it, and the account can go back to it. No redirect from an old handle. | Main design: "immutable after 30 days". Or: a cooldown with the old handle released after 90 days. | Being able to rename is a safety tool on a platform for unpopular opinions (escaping a harassment campaign or a doxxing attempt). Reserving old handles for ever prevents impersonation of a renamed account; a redirect would let a harasser follow the rename, so there is none. |
| Email change | In scope (was not in the 1a table's 1b row). Code sent to the new address; fresh authentication; the old address is told. | Leave for later. | Losing a mailbox otherwise means losing the account, since there is no manual recovery. Small: it reuses the email-code machinery. |
| Verified badge | Proof of holding a phone number, through a `VerificationProvider` interface with a development provider (fixed code) and one production adapter, Vonage Verify v2 (Ericsson-owned, EU data centres, plain REST). One phone per account, stored only as a keyed hash; the badge can be removed by its owner. | Twilio Verify (US); MessageBird/Bird; no badge. | The main design chose a phone-verified badge; the user prefers EU providers (mail relay decision, 1a). The adapter is written from Vonage's published API reference and unit-tested against recorded shapes; the runbook has the user verify it with real credentials. |
| Data export | One streamed ZIP: `export.json` plus every image the account uploaded (the large variant). Fresh authentication, once a day. Nothing is stored on the server. | JSON only, images by link; or an asynchronous job with a download later. | A user leaving wants their pictures, and links stop working once the account is deleted. Streaming needs no temporary storage and no queue; fflate 0.8.3 (MIT, no dependencies) writes the archive chunk by chunk (measured, section 3). |
| Account deletion | Immediate and irreversible, guarded three times: fresh authentication, a code sent to the account's email, and the handle typed by the user. Posts become tombstones (body blank, images deleted from disk), the graph and engagement rows go with their counters, the profile row stays anonymised and keeps its handle, the auth row is anonymised. A resumable purge job finishes any deletion the process did not. | A 7- or 30-day grace period with reactivation. | The main design says hard delete. A grace period would need every social query to hide an account "pending deletion" and a way back in; the emailed code already stops an attacker holding only a session from deleting the account, which is what the grace period mostly protects against. |
| Avatars | Deferred again; `profiles.avatar_path` stays unused. | Reuse the 2b pipeline now. | The UI direction (main design, section 5) is text-first with no avatar in its layouts; adding a variant size, a second upload purpose and an image in every card is a design of its own. 2b's note "Avatars and banners (1b)" is amended. |
| Bio | Up to 160 characters, the same character rules as a post body (no control characters, no direction or zero-width characters), plain text. | Longer, or with links. | Enough for a line about the account; RichText would turn it into a place for links that the feed's rules do not cover. |
| Phone number format | E.164 checked with one expression (`^\+[1-9][0-9]{6,14}$`), no phone library. | libphonenumber-js (MIT, 1.13.13, no dependencies, but large). | The provider validates real numbers; korbat only needs a canonical string to hash and to send. |

## 3. Research

| Question | Finding | Consequence |
|---|---|---|
| Can the API stream a ZIP without buffering or temporary files? | Measured (`korbat-scratch/lab/zip`): fflate 0.8.3's `Zip` class emits chunks through a callback while entries are pushed; a 220 KB deflated JSON entry plus a 3 MiB stored entry produced a 3,149,085-byte archive that Python's `zipfile` opened and verified (`testzip` clean). fflate is MIT, has no dependencies, and 0.8.3 was released on 2026-05-16. | Export streams `export.json` (deflated) and image files (stored, they are WebP already) through Hono's `stream()` helper (`hono/streaming`, present in 4.13.8), awaiting each write for back-pressure. |
| Vonage Verify v2 shapes | From the API reference (developer.vonage.com/en/api/verify.v2): `POST https://api.nexmo.com/v2/verify` with `{ brand, workflow: [{ channel: "sms", to }], code_length }` answers 201 `{ request_id }`; `POST /v2/verify/:request_id` with `{ code }` answers 200 `{ status: "completed" }`, 400 `invalid-code`, 410 `expired` (also after the third wrong code), 404 `request-not-found`. Basic authentication with the API key and secret. `brand` is 1 to 18 characters. Not exercised against the live API (no account). | The adapter maps 201 to a request id, 200 to verified, 400 to `invalid_code`, 410 to `code_expired`, anything else to `verify_unavailable` (503). The unit tests use these recorded shapes; the runbook's first step is a live check. |
| Adding a value to a PostgreSQL enum inside drizzle's migration transaction | PostgreSQL 12 and later allow `ALTER TYPE ... ADD VALUE` inside a transaction as long as the value is not used in the same transaction; drizzle-kit generates exactly that statement. | Migration 0009 adds `delete_account` to `email_code_purpose` and nothing in 0009 uses it. |
| One phone per account | A partial unique index on `auth.users (phone_hash) where phone_hash is not null` makes the rule a database fact; the insert races resolve to one winner. | The conflict is reported only after the code was verified (section 10), so nobody can learn whether a number is registered without holding the phone. |
| Deleting an account's images | 2b's `MediaForPosts.detachAll` returns the ids of a post's images inside the social transaction and `requestDeletion` removes their files after the commit; the reconcile pass refuses to delete more than 50 orphans on its own (audit, section 5). | Deletion collects every image id of the owner (attached and pending) in the purge transaction and requests their deletion explicitly, so no run leaves orphans for the sweeper to refuse. |

## 4. Scope

In: profile editing (display name, bio), handle change with its rules, email change, the verified badge (provider interface, development provider, Vonage adapter, removal), data export, account deletion with its purge job, the web app screens for all of it, privacy text and README updates, the verification-provider runbook.

Out: avatars and banners (deferred, section 2), account deactivation or grace periods, a second badge provider, changing the date of birth or the terms acceptance, staff tooling for deletions (sub-project 3), exporting other people's data about the account (their follows of it, their replies).

## 5. Architecture

Three existing modules gain features that touch only their own tables; one new module orchestrates the two features that span all of them.

- **auth** (`apps/api/src/auth`): email change (`flows/email-change.ts`), the badge (`flows/badge.ts`, `verify/provider.ts`, `verify/dev.ts`, `verify/vonage.ts`), the auth side of deletion (`flows/deletion.ts`: the code, the confirmation, marking the user deleted, the final anonymisation). The mailer gains templates `email_changed`, `badge_verified`, `badge_removed`, `delete_account_code`, `account_deleted`.
- **social** (`apps/api/src/social`): profile editing and handle change (`flows/profile-edit.ts`), and `purgeProfile` for deletion (tombstones every post, removes engagement and graph rows with their counters, anonymises the profile row).
- **media** (`apps/api/src/media`): `purgeOwner` (every image row of the owner, attached or not, detached and returned for file deletion) and `exportImages` (the ready images of an owner with a readable path to their large variant).
- **account** (`apps/api/src/account`, new; `MODULES` in `test/architecture.test.ts` gains it): export (`flows/export.ts`, `zip.ts`), deletion orchestration (`flows/deletion.ts`) and the purge job (`purge.ts`). It depends on the three modules only through their index files, on interfaces they export:

```ts
// auth/index.ts
export interface AuthForAccount {
  startDeletion(session: Session, ctx: RequestContext): Promise<{ flowId: string }>;
  confirmDeletion(session: Session, input: { flowId: string; code: string; handle: string }): Promise<void>; // marks deleted, revokes every session
  pendingPurges(): Promise<string[]>;           // user ids with deleted_at set and purged_at null
  finishPurge(userId: string): Promise<void>;   // anonymises the auth row, sets purged_at
  exportAccount(userId: string): Promise<AccountExport>; // email, dates, role, mfa, badge, sessions, devices, own events
  appendEvent(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}
// social/index.ts
export interface SocialForAccount {
  purgeProfile(userId: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void>;
  exportProfile(userId: string): Promise<ProfileExport>; // profile, posts with their media rows, likes, reposts, bookmarks, following, blocks, mutes
}
// media/index.ts
export interface MediaForAccount {
  purgeOwner(tx: DbTx, ownerId: string): Promise<string[]>;   // image ids, attached or pending
  requestDeletion(ids: readonly string[]): Promise<void>;
  exportImages(ownerId: string): Promise<{ id: string; path: string }[]>; // ready images, absolute path of large.webp
}
```

`apps/api/src/index.ts` wires `createAccount({ auth: auth.forAccount, social: social.forAccount, media: media.forAccount, requireSession, requireFreshAuth, rateLimitStore, logger })` and mounts its routes at `/api/account`. The purge job starts next to the janitor and the sweeper on the job runner (audit, section 5) with the lock name `job:account-purge`, every 5 minutes.

Why a fourth module and not more auth: the auth module must never receive the API pool (1a, section 2.2), and deletion must write to both schemas. The account module holds no table access of its own; it sequences calls on the three interfaces and owns nothing but the ZIP writer and the purge loop.

## 6. Data model and migration 0009

- `public.handle_history (handle_lower text primary key, profile_id uuid not null references profiles(id), changed_at timestamptz not null default now())`, RLS with the same full-access policy for `korbat_api` as `profiles`. A row is written for the handle chosen at onboarding and for every handle later left behind. `checkHandle` stays as it is; the repository refuses a handle whose lowercase form is in `handle_history` for another profile, in the same transaction as the write (`handle_taken`).
- `profiles.handle_changed_at timestamptz` (null until the first change).
- `auth.users.purged_at timestamptz` (null until the purge job or the request finished the anonymisation). `deleted_at` already exists and now means "the owner confirmed deletion; the account is gone for every purpose, whether or not the purge finished".
- `auth.users`: unique partial index `users_phone_hash_idx on (phone_hash) where phone_hash is not null`.
- `email_code_purpose` gains `delete_account`.

Migration 0009 is generated by drizzle-kit from the schema; the enum value and the partial index come out as `ALTER TYPE ... ADD VALUE` and `CREATE UNIQUE INDEX ... WHERE`. No data migration: onboarding-time handles of existing accounts are backfilled into `handle_history` by a statement appended to the generated SQL (`insert into handle_history (handle_lower, profile_id, changed_at) select lower(handle), id, created_at from profiles on conflict do nothing`).

## 7. Flows

Every write below requires an onboarded session; where it says fresh, `requireFreshAuth` (5 minutes since a credential was proven) guards the route, and the web app runs it through `useReauth` so the re-authentication panel opens when the API answers `reauth_required`. Every limit is a sliding window in the limit store keyed as shown; every `rate_limited` answer carries `Retry-After`. Security events go to `auth.auth_events` through the auth module.

### 7.1 Profile editing

`PATCH /api/me/profile` `{ displayName?, bio? }` → `{ profile }`. `DisplayName` as at onboarding; `Bio` as section 2 says. Limit `profile-edit:<user>` 10 an hour. Event `profile_updated` (no content in the metadata).

### 7.2 Handle change

`POST /api/me/handle` `{ handle }` (fresh) → `{ profile }`. Checks, in order: format and reserved list (`handle_invalid`, `handle_reserved`); the cooldown (`handle_cooldown` 429 with `Retry-After` = seconds until 30 days after `handle_changed_at`); then in one transaction: the handle is free in `profiles` (case-insensitive) and either absent from `handle_history` or belongs to this profile (`handle_taken` 409), the old handle is inserted into `handle_history` (on conflict do nothing: it may be there from an earlier stint), `profiles.handle` and `handle_changed_at` are updated. Choosing the current handle again is `invalid_request`. Event `handle_changed` with `{ from, to }`; the `/me` response and the app's session refresh so the navigation's Profile link follows. Existing posts show the new handle at once (they join on the profile).

### 7.3 Email change

`POST /api/auth/email/change/start` `{ email }` (fresh) → `{ flowId }`: the address passes the sign-up rules (format, not disposable, not the current one: `invalid_request`), limits `email-change:user` 3 an hour and `email-start:email:<hash>` as for sign-in; a code (purpose `change_email`, the new address, 10 minutes, 5 attempts) is mailed to the new address with the `email_change_code` template; the pending change (`{ userId, email }`) sits in the store under the hashed flow id for 10 minutes. If the new address already belongs to an account, the code is sent anyway and the change fails only at verification (`email_in_use` 409), so the start step is not an oracle.
`POST /api/auth/email/change/verify` `{ flowId, code }` → `{ email }`: `checkEmailCode` as elsewhere; the user's email is replaced (unique index; `email_in_use` on conflict), `email_verified_at` is set to now, the `email_changed` template goes to the old address ("if this wasn't you, sign in and change it back; every session stays signed in"), event `email_changed` with the hashes of both addresses. Sessions are not revoked: the owner just proved a credential.

### 7.4 Verified badge

`POST /api/auth/badge/start` `{ phone }` (fresh) → `{ flowId }`: `Phone` is E.164; the provider is `off` → `badge_unavailable` 404; limits `badge-start:user` 3 an hour and `badge-start:phone:<hash>` 3 an hour; the provider's `start(phone)` returns a reference; the store holds `{ userId, phoneHash, reference, attempts: 0 }` under the hashed flow id for 10 minutes. The phone number itself is never stored, logged or put in an event.
`POST /api/auth/badge/verify` `{ flowId, code }` → `{ verified: true }`: attempts are counted in the store (5 at most, `too_many_attempts`); the provider's `check(reference, code)` answers `verified`, `invalid_code`, `code_expired` or throws `verify_unavailable` (503, the provider was unreachable); on `verified` the hash is written to `auth.users.phone_hash` and `profiles.verified_at` to now, in that order; a unique-index conflict is `phone_in_use` 409 (the requester holds the phone, so the answer reveals nothing they could not learn by signing up). Template `badge_verified`, event `badge_verified`.
`DELETE /api/auth/badge` (fresh) → 204: clears both columns; template `badge_removed`; event `badge_removed`.

The `VerificationProvider` interface: `start(phone: string): Promise<{ reference: string }>` and `check(reference: string, code: string): Promise<"verified" | "invalid_code" | "code_expired">`. `dev` accepts exactly `000000`, answers `invalid_code` to anything else, never expires, and is refused when `NODE_ENV` is production (config guard, like the Turnstile test secret). `vonage` calls the two endpoints of section 3 with `code_length: 6`, a 10-second timeout and Basic authentication; a non-2xx status other than 400 and 410, a network error or a malformed body is `verify_unavailable`. `off` makes the badge routes answer `badge_unavailable` and the app hide the section. Configuration: `VERIFY_PROVIDER` (`off` | `dev` | `vonage`, default `off`; `dev` in the development `.env`), `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VERIFY_BRAND` (1 to 18 characters, default `korbat`); production refuses `vonage` without the key and secret.

### 7.5 Data export

`POST /api/account/export` (fresh) → `200 application/zip`, `Content-Disposition: attachment; filename="korbat-export-<handle>-<YYYY-MM-DD>.zip"`, `Cache-Control: no-store`. Limit `export:user` 1 a day (the limit is taken before the stream starts; a stream that fails midway still counts). The archive holds:

- `export.json`: `{ format: "korbat-export-1", exportedAt, account: { id, email, createdAt, role, mfaEnabled, hasPassword, verified, termsVersion, termsAcceptedAt }, profile: { handle, displayName, bio, createdAt, handleHistory: [...] }, posts: [{ id, body, createdAt, replyToId, quoteOfId, state, deletedAt, media: [{ id, file, altText, width, height }] }], likes: [{ postId, at }], reposts: [...], bookmarks: [...], following: [{ handle, since }], blocks: [{ handle, since }], mutes: [{ handle, since }], sessions: [{ id, createdAt, lastUsedAt, current }], devices: [{ label, platform, firstSeenAt, lastSeenAt }], events: [{ type, at }] }`. Deleted posts appear with their empty body and `deletedAt`; handles in the graph lists are those of the other accounts at export time (a blocked account's handle is the user's own knowledge). Nothing about other people beyond their handle.
- `media/<id>.webp` for every ready image the account uploaded, `file` in the JSON naming it. Missing files (the sweeper may be between the row and the file) are skipped and listed under `missingMedia`.

The stream: the JSON is built in memory (bounded by the account's own rows), the images are read file by file with `createReadStream` and pushed through a stored (uncompressed) entry; every chunk is awaited. Event `export_created`.

### 7.6 Account deletion

`POST /api/account/delete/start` (fresh) → `{ flowId }`: limit `delete-start:user` 3 an hour; a code (purpose `delete_account`) is mailed to the account's address with the `delete_account_code` template ("someone asked to delete your account; if it was not you, sign in and revoke your other sessions").
`POST /api/account/delete/confirm` `{ flowId, code, handle }` (fresh) → 204 and the session cookies cleared: `handle` must equal the account's current handle, case-insensitively (`invalid_request` with `handle_mismatch` as the message); then `checkEmailCode`; then, in order:

1. auth: `deleted_at` = now, every session revoked with tombstones (so the cache cannot revive one), devices and pending codes deleted; the `account_deleted` template is sent to the address first, best effort. From here the account is gone: sign-in flows see `deleted_at` and answer as for an unknown account.
2. social + media, one transaction on the API pool: every post of the author → `deleted_by_author`, body blank, `deleted_at`, with the reply, quote and profile counters of the affected rows adjusted; `purgeOwner` detaches every image row (attached, pending or failed) and returns its ids; the author's likes, reposts and bookmarks are deleted with the counters of their posts adjusted; follows in both directions with both counters; blocks and mutes in both directions; the profile row is anonymised: `display_name` "Deleted account", `bio` "", `avatar_path` null, `verified_at` null, counters 0, `deleted_at` now; the handle stays (and stays in `handle_history`), so it is never reused.
3. media: `requestDeletion` for every id from step 2 (files, whatever variant exists; pending uploads too).
4. auth: `finishPurge`: email replaced by `deleted:<user id>`, password hash, TOTP secret, recovery codes, phone hash, terms and age fields cleared, `purged_at` set. The user row and its events remain (the events hold no content; retention removes them after 90 days).

Steps 2 to 4 are also what the purge job does for any user `pendingPurges()` returns, so a process that died after step 1 leaves nothing behind for longer than five minutes; every step is idempotent (posts already tombstoned are skipped, `finishPurge` on a purged row is a no-op). The response does not wait for the job; it runs steps 2 to 4 itself and answers when they are done (seconds for a large account), or answers 204 anyway if step 2 fails after logging, leaving the job to finish. Event `account_deleted` is appended before step 4.

What a deleted account looks like from outside: `GET /api/profiles/:handle` is `not_found`; its posts are tombstones in threads (`{ id, deleted: true }`, no author) and absent from every list; its handle cannot be taken by anyone.

## 8. Contracts (`packages/contracts`)

`Bio` (`text.ts` rules, max 160), `Phone`, `ProfileEditRequest { displayName?, bio? }`, `HandleChangeRequest { handle }`, `EmailChangeStartRequest { email }`, `EmailChangeVerifyRequest { flowId, code }`, `EmailChangeResponse { email }`, `BadgeStartRequest { phone }`, `BadgeVerifyRequest { flowId, code }`, `DeleteStartResponse { flowId }`, `DeleteConfirmRequest { flowId, code, handle }`, `ExportFormat` (the JSON schema above, used by the export test). New error codes: `handle_cooldown` (429), `handle_taken` (409, already exists for onboarding), `email_in_use` (409), `phone_in_use` (409), `badge_unavailable` (404), `verify_unavailable` (503), `too_many_attempts` (exists). `MeResponse.profile` gains `handleChangedAt` and `verified` (the badge is a fact of the profile, so the account screen reads it there).

## 9. Web app

- `settings/profile.tsx`: display name and bio fields with counters, Save; a Handle section with the current handle, the rule text ("once every 30 days; your old handles stay yours"), the date the next change is allowed when in cooldown, a field and a Change button (through `useReauth`).
- `settings/account.tsx`: Email section (current address, a field for the new one, the code step in place, through `useReauth`); Verified badge section (shown unless the provider is off: explanation of what the badge means and that the number is handed to the verification provider and kept only as a hash; phone field; code step; Remove badge when held); Data export section (a button that fetches the ZIP through a same-origin link; on web the response is a download); Delete account section (explanation, "Send me a code", then the code field and "Type your handle to confirm", Delete; on success sign out and go to `/`).
- The settings navigation: `settings/security.tsx` and `settings/privacy.tsx` link to the new screens the way security links to privacy today; a small `SettingsNav` component with the four links (current one `aria-current`) replaces the single link so every settings screen shows the same row.
- `PostCard` and the profile screen show the badge (a blue "Verified" chip after the display name, `accessibilityLabel` "verified account") when `author.verified` / `profile.verified` is true; `Author` in the contracts already carries `verified`, so post cards need no new field.
- `terms.tsx` privacy text gains the sentence about the verification provider and the export/deletion rights.

## 10. Security

- Fresh authentication for handle change, email change, badge start and removal, export, deletion start and confirm. Profile editing needs a session only.
- Oracles: email change and badge verification report `in_use` only after a code proved possession; the start steps answer identically whether or not the address or number is known.
- Limits (sliding, per account unless said): profile edits 10/h; handle change 1 per 30 days (the cooldown, not the limit store); email change start 3/h plus the per-address sign-in limits; badge start 3/h per account and 3/h per phone hash; export 1/24h; delete start 3/h; every verify step is bounded by the code's 5 attempts.
- The phone number never reaches logs or events (the logger scrubs `phone` fields like emails); the provider sees it, which the privacy text says.
- Deletion's step 1 comes first so that no request can succeed against an account whose owner has confirmed deletion, even while the purge runs.
- Export contains the account's own email; it is served with `no-store` and only to a fresh session.

## 11. Jobs

`account-purge` on the job runner: every 5 minutes, `pendingPurges()` (users with `deleted_at` and no `purged_at`), each run through steps 2 to 4 of section 7.6 under the job's lock; a report `{ purged, failed }` is logged. The auth janitor is unchanged (it never touches deleted users' rows beyond what retention says).

## 12. Testing

- Unit (`apps/api/test`): contracts (bio and phone rules); handle change (cooldown, history reservation for another profile, own old handle allowed, same handle refused); email change (start is not an oracle, verify replaces and mails the old address, in-use conflict); badge (dev provider paths, attempts, in-use after verification, removal); Vonage adapter against a fake `fetch` returning the recorded shapes (201, 200 completed, 400 invalid-code, 410 expired, 503 → `verify_unavailable`, timeout); export (the JSON matches `ExportFormat`; the ZIP produced from an in-memory owner with two images opens with fflate's `unzipSync` and holds `export.json` and `media/<id>.webp`); deletion orchestration with memory stores (step order, idempotency, the job finishing a half-done deletion); config guards (`dev` refused in production, `vonage` needs credentials).
- Integration (Postgres, Redis, Mailpit): handle history end to end; email change end to end with the mailbox; badge with the dev provider and the unique index race (two accounts, one number); export of an account with real uploaded images (files present in the archive); deletion end to end: counters on other accounts' posts and profiles, tombstones in threads, files gone from the store, profile `not_found`, sign-in refused, `handle_history` intact, the purge job finishing a deletion whose step 2 was skipped on purpose.
- HTTP: every route's session and freshness requirements; typed-handle mismatch; `Content-Disposition` and `no-store` on the export; cookies cleared after deletion.
- Smoke test (`scripts/smoke-auth-stack.mjs`): after the existing sign-up, edit the profile, change the handle, export (the ZIP opens), delete, confirm the profile is `not_found`.
- Browser (dry run only): the four settings screens, the re-authentication panel opening for a handle change, the export download, the deletion flow with the code read from Mailpit by the operator, the badge chip.

## 13. Runbook: the verification provider (needs the user's account)

1. Create a Vonage account (dashboard.nexmo.com), add credit, and note the API key and API secret from the dashboard; register the sending brand if the destination countries require it.
2. In `infra/.env`: `API_VERIFY_PROVIDER=vonage`, `API_VONAGE_API_KEY=...`, `API_VONAGE_API_SECRET=...`, `API_VERIFY_BRAND=korbat` (1 to 18 characters, no `/`, `{`, `}`, `:` or `$`). Restart the API (`docker compose up -d api`).
3. Live check: `node scripts/verify-badge.mjs +4479xxxxxxx` (added by this sub-project) starts a verification against the configured provider, prompts for the code from the SMS and prints the provider's answer, without touching any account. The first run proves the credentials, the brand and the country route.
4. Privacy text: the phone number is handed to Vonage for the SMS and kept by korbat only as a keyed hash; say so where the terms name Turnstile (`terms.tsx` already does, section 9).
5. Until then `VERIFY_PROVIDER=off` hides the badge section; `dev` is for development only and production refuses it.

## 14. Tasks (the dry run's order)

1. Contracts, schema and migration 0009 (with the handle backfill), the boundary test's `account` entry, config keys and guards, mail templates.
2. Profile editing and handle change (social flows, repository, routes, tests).
3. Email change (auth flows, templates, routes, tests).
4. Verified badge: provider interface, dev and Vonage adapters, flows, routes, tests, `scripts/verify-badge.mjs`.
5. Export: media and social export methods, the account module with the ZIP writer, route, tests.
6. Deletion: auth, social and media purge methods, the account flows, the purge job, routes, tests, smoke test steps.
7. Web app: settings navigation, profile and account screens, the badge chip, privacy text, accessibility tests.
8. Documentation: README (export, deletion, badge, the runbook pointer), the 1a and 2b amendments, this spec's dry-run amendments, the main design's status.

## 15. Success criteria

1. An account can change its name, bio and handle within the rules, move to a new email address and hold or drop the badge, each proven by tests and each guarded as section 10 says.
2. An export downloaded from the running stack is a valid ZIP whose `export.json` matches the contract and whose images open.
3. After deletion, nothing about the account is reachable through the API, its images are gone from disk, its handle is reserved, other accounts' counters are right, and a half-finished deletion is completed by the job within five minutes.
4. The badge works end to end with the development provider; the Vonage adapter is unit-tested against the recorded shapes and ready for the runbook.
5. Every task passes the runner's gates in the scratch clone and replays into the repository byte for byte.

## 16. Amendments from the dry run (2026-09-24)

Found while the tasks were dry-run in the scratch clone; each is applied in the prompts.

- **Profile edits and handle changes answer `{ profile: ProfileView }` (section 7.1, 7.2).** The `MeProfile` contract's comment, written in Task 1, said the profile-editing routes return `MeProfile`; they return the public `ProfileView` like `GET /api/profiles/:handle`, and the app refreshes `/me` for `handleChangedAt`. The comment is corrected in the documentation task.
- **The badge section's switch is a build value (section 9).** A web build cannot ask the API whether the provider is on, so `WEB_BADGE` in `infra/.env` (build argument `EXPO_PUBLIC_BADGE`, default `on`) decides whether the Account screen holds the badge section; with it on and the provider off, the section shows the API's `badge_unavailable` message. Task 7 adds the build argument to `infra/caddy/Dockerfile`, the `caddy` service and `infra/.env.example`.
- **`export.json` is the archive's last entry (section 7.5).** The images stream first, so `missingMedia` can name every file that was gone when its turn came; the JSON is still built in memory before the first byte. The pending badge state carries its expiry (section 7.4), so counting an attempt never extends the flow; `verifyBadge` answers `badge_unavailable` with the provider off and `removeBadge` works without a provider.
- **The purge reserves the current handle itself (section 7.6).** `purgeProfile` inserts the handle into `handle_history` (on conflict do nothing) before anonymising the profile, and locks the profile row `for update` so the request's purge and the job's cannot interleave.
- **The built bundle is checked (section 12).** Task 5's build step is followed by `node --check apps/api/dist/index.js`: the esbuild banner's `createRequire` clashed with fflate's own import and only the container start showed it, so the banner's import is aliased and the check is part of the task; Task 7 rebuilds the whole stack and runs the smoke test, which now walks the account lifecycle.
- **The terms text lives in `apps/app/src/lib/terms.ts` (section 9)** and its version stays `draft-2026-09`, as the audit's terms change did; the settings navigation takes the current page as a prop because expo-router cannot load under vitest.
- **Review fixes (Task 8, sections 7.3 to 7.6, 9, 10).** These are the 19 findings an adversarial review upheld, plus one from the browser walk-through. Badge attempts are counted atomically, and badge starts are limited per IP (10 an hour) and instance-wide (200 a day). The old address's `email_changed` notice carries a one-shot link, valid 24 hours, one per account per window (`POST /api/auth/email/revert`, page `/email-revert/<token>`). It moves the account back, signs out every session, revokes every device, and drops a password or two-factor secret set since the change. The deletion's first step is one transaction that the purge's last step repeats idempotently. The purge requests the image files' deletion, pending uploads included, before its transaction commits. Every social write takes `for key share` on the accounts it touches, so none lands on a purged account. The export writes its own ZIP64-capable container, streams `export.json` in pages, opens image files through the media module's checks, gives the day back when it fails before the first byte, and breaks the download when it fails midway. `Bio` refuses U+2028 and U+2029. On the web, Enter follows each button's rule, the account's own address is refused in plain words, focus follows the steps, the export limit names the wait, the Verified chip is announced, and the badge section needs `WEB_BADGE=on`.
````

### Replace `packages/contracts/src/auth.ts` (whole file)

```ts
import { z } from "zod";
import { FORBIDDEN_FORMAT } from "./text";

/** Every code the auth endpoints can put in ErrorEnvelope.error.code. */
export const AuthErrorCode = z.enum([
  "invalid_code",
  "code_expired",
  "too_many_attempts",
  "invalid_credentials",
  "mfa_required",
  "invalid_mfa_code",
  "reauth_required",
  "csrf_failed",
  "turnstile_failed",
  "disposable_email",
  "age_requirement",
  "terms_required",
  "handle_taken",
  "handle_invalid",
  "handle_reserved",
  "password_too_short",
  "password_too_long",
  "password_breached",
  "password_check_unavailable",
  "staff_mfa_required",
  "onboarding_required",
  "mail_unavailable",
  "rate_limited",
  "handle_cooldown",
  "email_in_use",
  "phone_in_use",
  "badge_unavailable",
  "verify_unavailable",
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCode>;

export const Platform = z.enum(["web", "ios", "android"]);
export type Platform = z.infer<typeof Platform>;

export const Role = z.enum(["user", "moderator", "admin"]);
export type Role = z.infer<typeof Role>;

/** Random id created once per app install. The server stores only a keyed hash of it. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
/** 32 random bytes as base64url without padding: flow ids, MFA tickets, single-use link tokens. */
export const OpaqueId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const EmailCode = z.string().regex(/^\d{6}$/);
export const TotpCode = z.string().regex(/^\d{6}$/);
/**
 * A phone number in E.164 once the spaces, hyphens and parentheses people type are dropped: a plus and
 * 7 to 15 digits, the first not zero. Whether the number exists is the verification provider's call.
 */
export const Phone = z
  .string()
  .trim()
  .max(64)
  .transform((raw) => raw.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9][0-9]{6,14}$/, "phone numbers are written like +447911123456"));
/** The six-digit code the verification provider texts to a phone; the development provider's is 000000. */
export const PhoneCode = z.string().regex(/^\d{6}$/);
export const RecoveryCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
/** Handle rules (3-20 of a-z, 0-9, _; reserved names) are enforced by the flow so it can return a specific error code. */
export const HandleInput = z.string().trim().toLowerCase().min(1).max(64);
export const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[^\p{Cc}]+$/u)
  .refine((name) => !FORBIDDEN_FORMAT.test(name), { message: "invisible direction and spacing characters are not allowed" });
export const TurnstileToken = z.string().min(1).max(2048);
/** Length rules (12-128) are enforced by the flow so it can return password_too_short or password_too_long. */
export const PasswordInput = z.string().min(1).max(1024);

/**
 * A new bearer token after the server rotated the session. Present only for native clients; web
 * clients receive fresh cookies instead.
 */
export const RotatedToken = z.string().optional();

// ---------------------------------------------------------------- email entry and sign-up

export const EmailStartRequest = z.object({
  email: Email,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type EmailStartRequest = z.infer<typeof EmailStartRequest>;

export const FlowResponse = z.object({ flowId: OpaqueId });
export type FlowResponse = z.infer<typeof FlowResponse>;

export const EmailVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailVerifyRequest = z.infer<typeof EmailVerifyRequest>;

/** A session was issued. Native clients get the bearer token in the body; web clients only get cookies. */
export const SessionResult = z.object({
  result: z.literal("session"),
  mustReenrollMfa: z.boolean(),
  token: z.string().optional(),
});
export const MfaRequiredResult = z.object({ result: z.literal("mfa_required"), mfaTicket: OpaqueId });
export const SignupRequiredResult = z.object({ result: z.literal("signup_required") });

export const EmailVerifyResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult, SignupRequiredResult]);
export type EmailVerifyResponse = z.infer<typeof EmailVerifyResponse>;

export const SignInResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult]);
export type SignInResponse = z.infer<typeof SignInResponse>;

export const SignupCompleteRequest = z.object({
  flowId: OpaqueId,
  dateOfBirth: z.iso.date(),
  termsVersion: z.string().min(1).max(64),
});
export type SignupCompleteRequest = z.infer<typeof SignupCompleteRequest>;

export const Profile = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string() });
export type Profile = z.infer<typeof Profile>;

export const OnboardingHandleRequest = z.object({ handle: HandleInput, displayName: DisplayName });
export type OnboardingHandleRequest = z.infer<typeof OnboardingHandleRequest>;

export const OnboardingHandleResponse = z.object({ profile: Profile, token: RotatedToken });
export type OnboardingHandleResponse = z.infer<typeof OnboardingHandleResponse>;

// ---------------------------------------------------------------- password

export const PasswordSigninRequest = z.object({
  email: Email,
  password: PasswordInput,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type PasswordSigninRequest = z.infer<typeof PasswordSigninRequest>;

export const PasswordSetRequest = z.object({ password: PasswordInput });
export type PasswordSetRequest = z.infer<typeof PasswordSetRequest>;

export const PasswordSetResponse = z.object({ token: RotatedToken });
export type PasswordSetResponse = z.infer<typeof PasswordSetResponse>;

// ---------------------------------------------------------------- MFA

export const TotpSetupResponse = z.object({
  otpauthUri: z.string().startsWith("otpauth://totp/"),
  qrSvg: z.string().startsWith("<svg"),
});
export type TotpSetupResponse = z.infer<typeof TotpSetupResponse>;

export const TotpCodeRequest = z.object({ code: TotpCode });
export type TotpCodeRequest = z.infer<typeof TotpCodeRequest>;

export const RecoveryCodesResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10) });
export type RecoveryCodesResponse = z.infer<typeof RecoveryCodesResponse>;

export const TotpConfirmResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10), token: RotatedToken });
export type TotpConfirmResponse = z.infer<typeof TotpConfirmResponse>;

/** Exactly one of `code` or `recoveryCode`. */
export const MfaVerifyRequest = z.union([
  z.strictObject({ mfaTicket: OpaqueId, code: TotpCode }),
  z.strictObject({ mfaTicket: OpaqueId, recoveryCode: RecoveryCode }),
]);
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>;

// ---------------------------------------------------------------- re-authentication

export const ReauthRequest = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: PasswordInput }),
  z.object({ method: z.literal("totp"), code: TotpCode }),
  z.object({ method: z.literal("email"), flowId: OpaqueId, code: EmailCode }),
]);
export type ReauthRequest = z.infer<typeof ReauthRequest>;

// ---------------------------------------------------------------- sessions and account

export const SessionInfo = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  deviceLabel: z.string(),
  platform: Platform,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const SessionsResponse = z.object({ sessions: z.array(SessionInfo) });
export type SessionsResponse = z.infer<typeof SessionsResponse>;

export const NotMeRequest = z.object({ token: OpaqueId });
export type NotMeRequest = z.infer<typeof NotMeRequest>;

/**
 * The signed-in account's own profile as /me returns it (the profile-editing routes answer the public ProfileView): the public facts
 * plus when the handle last changed (the app shows when the next change is allowed) and whether the
 * verified badge is held.
 */
export const MeProfile = Profile.extend({ handleChangedAt: z.iso.datetime().nullable(), verified: z.boolean() });
export type MeProfile = z.infer<typeof MeProfile>;

export const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    role: Role,
    onboarded: z.boolean(),
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
  }),
  profile: MeProfile.nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;

// ---------------------------------------------------------------- email change

/** The new address, under the sign-up rules. The flow refuses the current address and disposable ones. */
export const EmailChangeStartRequest = z.object({ email: Email });
export type EmailChangeStartRequest = z.infer<typeof EmailChangeStartRequest>;

export const EmailChangeVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailChangeVerifyRequest = z.infer<typeof EmailChangeVerifyRequest>;

/** The address the account now has. */
export const EmailChangeResponse = z.object({ email: z.email() });
export type EmailChangeResponse = z.infer<typeof EmailChangeResponse>;

/**
 * The token from the link the email_changed notice sends to the old address. It is the only credential
 * the undo needs, since a passwordless account cannot sign in at the old address any more.
 */
export const EmailRevertRequest = z.object({ token: OpaqueId });
export type EmailRevertRequest = z.infer<typeof EmailRevertRequest>;

// ---------------------------------------------------------------- verified badge

export const BadgeStartRequest = z.object({ phone: Phone });
export type BadgeStartRequest = z.infer<typeof BadgeStartRequest>;

export const BadgeVerifyRequest = z.object({ flowId: OpaqueId, code: PhoneCode });
export type BadgeVerifyRequest = z.infer<typeof BadgeVerifyRequest>;

export const BadgeVerifyResponse = z.object({ verified: z.literal(true) });
export type BadgeVerifyResponse = z.infer<typeof BadgeVerifyResponse>;

// ---------------------------------------------------------------- account deletion

export const DeleteStartResponse = z.object({ flowId: OpaqueId });
export type DeleteStartResponse = z.infer<typeof DeleteStartResponse>;

/** The emailed code and the account's handle typed by the owner; the flow compares the handle case-insensitively. */
export const DeleteConfirmRequest = z.object({ flowId: OpaqueId, code: EmailCode, handle: HandleInput });
export type DeleteConfirmRequest = z.infer<typeof DeleteConfirmRequest>;
```

## Step 2: verify: sections

```bash
grep -c '^## Profile and account' README.md && grep -c 'Delivered by 1b' docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md && grep -c 'Avatars stay deferred' docs/superpowers/specs/2026-09-18-images-2b-design.md && grep -c 'sub-project 1b' docs/superpowers/specs/2026-09-03-korbat-design.md && grep -c 'Amendments from the dry run' docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md
```

Expected output contains:

- `1`

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
python -c "import sys; bad=[f for f in sys.argv[1:] if b'\r' in open(f,'rb').read()]; print('crlf-files', bad)" README.md docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md docs/superpowers/specs/2026-09-18-images-2b-design.md docs/superpowers/specs/2026-09-03-korbat-design.md docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md packages/contracts/src/auth.ts
```

Expected output contains:

- `crlf-files []`

Observed on the dry run:

```text
crlf-files []
```

## Step 4: verify: contracts

```bash
pnpm --filter @korbat/contracts test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  64 passed (64)
```

## Step 5: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `README.md`
- `docs/superpowers/specs/2026-09-03-korbat-design.md`
- `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- `docs/superpowers/specs/2026-09-18-images-2b-design.md`
- `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`
- `packages/contracts/src/auth.ts`

## Step 6: commit

```bash
git add -A
git commit -q -m "docs: the README explains profile, email, badge, export and deletion; the 1a and 2b specs and the main design record what 1b delivered; the 1b spec gains its dry-run amendments; the MeProfile comment names what the profile-editing routes return" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `docs: the README explains profile, email, badge, export and deletion; the 1a and 2b specs and the main design record what 1b delivered; the 1b spec gains its dry-run amendments; the MeProfile comment names what the profile-editing routes return`.

## Report format (mandatory)

```text
TASK 9 REPORT
Files written: <count, expected 6>
Verify "sections": <paste the expected lines as printed>
Verify "line-endings": <paste the expected lines as printed>
Verify "contracts": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
