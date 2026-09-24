# korbat audit fixes (2026-09-23) — design

## Context

On 2026-09-23 the repository at `f0c9799` was audited before work continued past sub-project 2b: four independent read-only reviews (auth module; image pipeline and deployment; social module; web client), a dependency-currency check against the npm registry and Docker Hub, and `pnpm audit`. This document records what the audit found, which technologies change, and how each defect is fixed. It is the spec for one batch of tasks that precedes sub-projects 1b, 1c, 2c, 3, 3b, 4 and 5.

The user asked for the audit, for better technologies or libraries where they exist, for logic and security fixes where needed, and for the work to continue without pauses for approval. Decisions below are therefore taken here and recorded; nothing in this batch changes a product decision from an earlier spec.

## Decisions

- **Method.** Every task is still dry-run in a scratch clone with the gated runner, and the prompts under `docs/superpowers/prompts/audit-fixes/` are still generated from the verified commits. What changes: the prompts are replayed into the real repository by a deterministic script (`replay.py`: `write_blocks.py` for every writing step, every verification gate, the commit) instead of a fresh model session per prompt. The proof is the same as before (every gate passes in the real repository, every written file is byte-identical to the dry run, `verify_prompts.py` reproduces the repository); only the transcription step no longer costs a model session. The scratch clone moved from `%TEMP%`, which Windows Storage Sense prunes, to `C:/Users/Lenovo/Desktop/cool/korbat-scratch/repo` (tooling in `../tools`); it is throwaway.
- **TypeScript 7.0.2** for the API, worker and packages (the native compiler; every package type-checks unchanged, tested 2026-09-23). **TypeScript 6.0.3** for the Expo app, the version Expo SDK 57 expects; TypeScript 7 rejects the app (`types` defaults to `[]` and `noUncheckedSideEffectImports` fails the `global.css` import).
- **esbuild 0.28.2, called directly**, replaces tsup 8.5.1 (in maintenance mode; pins esbuild 0.27.7 with an open advisory and the only `chokidar@4.0.3` in the lockfile, one of the three trust-policy exclusions). A 20-line build script per app reproduces tsup's configuration. tsdown (0.23) stays out until it is 1.x.
- **ioredis 6.0.0** (RESP3 by default; Node 20+). korbat's Redis surface is `GET`, `SET PX [NX]`, `GETDEL`, `DEL`, `PING` and two Lua scripts returning integers, all identical under RESP3.
- **Valkey 9.1 (BSD-3)** replaces `redis:7-alpine` (7.4 is RSALv2/SSPLv1; Redis 8 is AGPL, which the project keeps out). Drop-in for ioredis. A password is required from now on.
- **PostgreSQL 18** replaces 16 while the data is small: supported until 2030, checksums on by default, and the major-version move is a rehearsed dump-and-restore script instead of a task for launch day. The official image mounts the volume at `/var/lib/postgresql` from 18 on, so the volume is new (`pgdata18`); the old `pgdata` volume is left untouched.
- **Images pinned**: Postgres, Valkey, Caddy, Mailpit, cloudflared (`2026.9.1`, never `latest`) and semgrep (`1.177.0`) by version, with Renovate's `docker:pinDigests` preset so Renovate adds and bumps digests. pnpm is installed in the Docker images through corepack from the hashed `packageManager` field, not `npm install -g`.
- **Small version refresh** (all at least 7 days old today): hono 4.13.8, zod 4.6.5, `@node-rs/argon2` 2.2.1, nodemailer 10.0.10 (ships its own types; `@types/nodemailer`, a 6.x definition against a 10.x library, goes), `@types/node` 24.13.5, expo 57.0.23, nativewind 4.2.7. Not bumped: React 19.3, react-native 0.87, gesture-handler 3, reanimated 4.7 and expo-router/expo-constants patches (Expo SDK 57 pins or too young), Tailwind 4 with NativeWind 5 (release candidate), vitest 5 (nothing needed), drizzle 0.45.3 / drizzle-kit 0.31.11 (two days old).
- **`query-string` overridden to 9.5.1** (which pulls `decode-uri-component` 0.5.0) if, and only if, the dry run proves expo-router's exported web bundle still parses and prints query strings; this clears the one `pnpm audit` advisory that reaches shipped client code (exponential-time decoding of a malformed link). The two build-time advisories (`esbuild` 0.18 under drizzle-kit's loader, `uuid` 7 under Expo's Xcode plugin) are recorded, not overridden.
- **Defects are fixed by module**, each with a failing test first, in the task order of section 1. No product decision from 1a, 2a or 2b changes; where a fix touches behaviour a spec described (blocks retracting reposts, fresh authentication for enrolling two-factor), the earlier spec is amended by this one.

## Research (verified 2026-09-23)

| Finding | Consequence |
|---|---|
| `npx tsc` from `typescript@7.0.2` exits 0 on `apps/api`, `apps/worker` and every package with the current tsconfigs; on `apps/app` it reports missing Node types and the CSS side-effect import | TS 7 for the server side, TS 6.0.3 for the app |
| `typescript@6.0.3` is what `expo install --check` expects for SDK 57 | as above |
| `chokidar@4.0.3` is required only by `tsup@8.5.1` (`pnpm-lock.yaml`); `tsx` depends on esbuild alone | dropping tsup removes the exclusion |
| ioredis 6.0.0 release notes: Node 20+, RESP3 default, `protocol: 2` opt-out | upgrade; integration tests are the proof |
| Caddy `reverse_proxy` ignores incoming `X-Forwarded-*` from untrusted peers (docs) | behind Caddy, the first `X-Forwarded-For` entry is Caddy's view of the client |
| `node:24-alpine` is Node 24.21 with corepack 0.36 | corepack installs pnpm from the hashed field |
| Postgres image docs: from 18 `PGDATA` is `/var/lib/postgresql/18/docker`, the volume mount is `/var/lib/postgresql`, chosen for `pg_upgrade --link` | new volume, upgrade script |
| Valkey releases: 9.1.2 (2026-09-01) stable, 9.2 is a release candidate | `valkey/valkey:9.1-alpine` |
| `pnpm audit`: 4 advisories (1 low, 3 moderate), none in server runtime code; one (`decode-uri-component` 0.2.2 via expo-router → `query-string` 7.1.3) is in the web bundle; `query-string@9.5.1` (ESM) depends on `decode-uri-component ^0.5.0`; expo-router calls only `parse` and `stringify` | override attempted in Task 1 |
| `.npmrc` `min-release-age=7` is not a pnpm option (`pnpm config` lists it beside the real `minimum-release-age=10080` from the workspace file) | the dead line is removed |

## 1. Scope

Nine tasks, one commit each:

1. Dependencies: the versions above, TypeScript 7/6, ioredis 6, the `query-string` override (kept only if proven), `expo-status-bar` removed (unused).
2. Build: esbuild scripts replace tsup in `apps/api` and `apps/worker`; the chokidar exclusion leaves `pnpm-workspace.yaml`; the dead `.npmrc` line goes.
3. Auth hardening (findings A2, A3, A5, A7, A8, A9, A10, A11).
4. Request identity, configuration guards, body limits, logging (A1/M4, A4, A6/M6, M3).
5. Background jobs, retention and media safety (M1, M2, M10, A11 retention, the design's IP-hash purge).
6. Social fixes and indexes (S1–S10, M8, index observations).
7. Web client (W1–W13, W15, W16, the Settings highlight).
8. Infrastructure (M5, M7, M9, M11, M12, M14, W2, W14; Postgres 18, Valkey, pinned images, corepack, networks, limits, log rotation, CI).
9. Documentation: README, spec amendments, the roadmap note in the main design.

Out of scope, deferred with reasons in section 10: owner-scoped RLS, backups and alerting, a nonce CSP, NativeWind 5, Expo SDK 58, dropping reanimated from the web bundle, the light theme.

## 2. Dependencies and build (Tasks 1 and 2)

**Task 1** edits every `package.json` and runs one non-frozen install (`--config.minimum-release-age=0` for that command, then `scripts/check-lockfile-age.mjs --base HEAD` proves nothing younger than 7 days was locked). `@types/nodemailer` is removed; `apps/api/src/mail/smtp.ts` compiles against nodemailer's own types or gets the smallest type annotation that makes it. The root `package.json` gains `pnpm.overrides` `{ "query-string": "9.5.1" }` and a vitest in `apps/app/test/query-string.test.ts` asserting that `query-string` (as expo-router requires it: `parse`, `stringify` with `{ sort: false }`) round-trips `a=%2F&b=1` and that the lockfile holds no `decode-uri-component` below 0.5.0. The web export must succeed with the override, and the scratch browser check opens a route with a query string. If any of that fails, the override and the test are dropped from the task and the README records the advisory as accepted.

**Task 2** adds `apps/api/build.mjs` and `apps/worker/build.mjs`: `esbuild.build` with the same entry points, `format: "esm"`, `platform: "node"`, `target: "node24"`, `bundle: true`, `sourcemap: true`, the `createRequire` banner, `external: ["@node-rs/argon2"]` (API) and `["sharp", "@img/*"]` (worker), `packages: "bundle"` for everything else, and `outdir: "dist"` emptied first. The `build` scripts call them; tsup leaves both `devDependencies`, `esbuild` 0.28.2 enters. Gates: both builds, the built API answers `/api/health` from `node dist/index.js`, `node dist/migrate.js` reports nothing to apply, the worker's built bundle starts and writes a heartbeat. `pnpm-workspace.yaml` loses the `chokidar@4.0.3` line and its comment mentions two exclusions; `.npmrc` keeps only `node-linker=hoisted`.

## 3. Auth hardening (Task 3)

- **A2, fresh authentication for two-factor enrolment.** `POST /api/auth/mfa/totp/setup`, `/confirm` and `DELETE /api/auth/sessions/:id` require `fresh` (a re-authentication within 5 minutes) whether or not two-factor is already on. Signing in counts as fresh, so the usual enrol-right-after-sign-up path costs nothing. Amends 1a section 5.3.
- **A9, owners hear about security changes.** New mail templates `mfa_enabled`, `mfa_disabled`, `password_changed`, `recovery_codes_regenerated`, `sessions_revoked_all`, sent best-effort like the new-device alert. The "this wasn't me" token carries the device id; acting on it also sets `devices.revoked_at` for that device, so its next sign-in is a new device again.
- **A5, malformed JSON is a 400.** Hono's `HTTPException` maps to `invalid_request` with the exception's status in both error handlers (auth router and app).
- **A7, flow ids hashed.** `signup:` and `flow:` keys use `sha256Hex(id)` like sessions and tickets.
- **A8, the two spec'd limits.** `signup/complete` 10 per IP per hour, `onboarding/handle` 10 per session per hour, through `enforceLimit`. Every `enforceLimit` refusal carries `Retry-After`.
- **A10, platform is not self-declared on the web.** A request that carries `Sec-Fetch-Mode` or `Origin` is treated as `platform: "web"` regardless of the body, so a script on the app origin can never obtain a bearer token.
- **A3, revocation beats the cache.** `revoke` writes a `revoked` tombstone under the session cache key for the cache TTL instead of deleting it; `resolve` fills the cache with `setIfAbsent` and treats the tombstone as no session. `disableTotp` and `confirmTotp` delete the cache entry so `mfaEnabled` is never stale.
- **A11 pieces.** Rehash-on-login: `verifyPassword` reports `needsRehash` and `password/signin` re-hashes with the current parameters. `TOTP_ENC_KEYS_PREVIOUS` (comma-separated, optional) is accepted for decryption; a secret decrypted with a previous key is re-encrypted with the current one on read. The age check answers after the rate limits, not before. Dead helpers (`consumeRecoveryCode`, `recentEvents`) go.

## 4. Request identity, configuration guards, body limits, logging (Task 4)

- **A1/M4, explicit proxy trust.** New config `TRUST_PROXY: cloudflare | caddy | none`, required in production (`API_TRUST_PROXY` in `infra/.env`, no default in compose). `cloudflare`: `cf-connecting-ip`, falling back to the first `X-Forwarded-For` entry, then the socket address. `caddy`: the first `X-Forwarded-For` entry (Caddy replaces client-sent values), then the socket. `none`: the socket address only. `clientIp` takes the config; a unit test proves a spoofed `cf-connecting-ip` opens no bucket in `caddy` and `none` modes. Development and the integration tests use `cloudflare` (the test client identifies itself with that header). The Caddyfile deletes `CF-Connecting-IP` from requests when it is not behind the tunnel (Task 8 owns the file; the API change lands here).
- **Rate-limit keys never hold a raw address.** The global limiter and every per-IP auth limit key an HMAC of the address (`IP_HASH_KEY`, the existing `hashIp`), truncated to 24 hex characters.
- **A6/M6, production refuses development values.** With `NODE_ENV=production`: Cloudflare's documented Turnstile test secrets (`1x…`, `2x…`, `3x…`) are refused, `APP_ORIGIN` must be `https:`, every `TRUSTED_ORIGINS` entry must be `https:`, and `SMTP_URL` must be `smtps:` or the SMTP adapter is built with `requireTLS: true`. The web image build refuses the always-pass site key when `KORBAT_ENV=production` is passed.
- **M3, JSON bodies capped.** Hono's `bodyLimit` at 64 KiB on every route except `POST /api/media`; the Caddyfile mirrors it (Task 8). A too-large body is `413 payload_too_large`.
- **A4, error stacks scrubbed.** The logger scrubs `stack` with the same function as `message`; a logger test passes an `Error` whose message holds an email and an IP.

## 5. Background jobs, retention and media safety (Task 5)

- **A small job runner** (`apps/api/src/lib/jobs.ts`): `startJob({ name, intervalMs, lockTtlMs, run })` chains `setTimeout` after each round (never overlapping), takes the Redis lock `job:<name>` with a random token, refreshes it every `lockTtlMs / 2` while `run` is in flight, and releases it with a compare-and-delete script. Both existing lock uses move onto it: the media sweeper (fixes M10) and the new auth janitor. The in-memory lock stays for unit tests.
- **Auth janitor** every 10 minutes: deletes `email_codes` consumed or expired more than 24 hours ago; deletes `sessions` revoked or expired more than 30 days ago; nulls `devices.ip_hash` where `last_seen_at` is older than 30 days (the design's IP-hash purge, section 3b); deletes `auth_events` older than 90 days through a security-definer function `auth.purge_events(older_than interval)` added by migration, owned by `korbat_migrate` and executable by `korbat_auth`, so the table stays append-only for the API role. Amends 1a section 1 (the purge job was out of scope there).
- **M1, reconcile refuses to delete a lot.** The sweeper's orphan pass logs and skips deletion when the orphans exceed 50 and 2% of stored images, unless `MEDIA_RECONCILE=force`; `MEDIA_RECONCILE=off` skips the pass. The README's restore section says: restore the database and `media-store` from the same snapshot with the sweeper off, then turn it on.
- **M2, no blocking opens.** `READ_FLAGS` gains `O_NONBLOCK` and the read path `lstat`s the entry and refuses anything but a regular file before opening it; a test plants a FIFO (where the platform allows) and expects a refusal within the timeout.

## 6. Social fixes and indexes (Task 6)

- **S1.** Post rows carry the parent's author id and state; `replyTo.authorHandle` is null when the viewer may not see that author (block either way) or the parent is not shown. Contract: `replyTo.authorHandle` becomes nullable. The web shows "Replying to a post you can't see" then.
- **S2 and S10.** `block()` also deletes, both ways, the pair's reposts and likes of each other's posts, adjusting counters by affected rows in the same transaction (amends 2a section 5.3: unblocking restores nothing). Undo actions (`on: false`) never consult the block relation.
- **S3.** Pair-scoped advisory locks: `pg_advisory_xact_lock(hashtext(least(a, b)), hashtext(greatest(a, b)))` taken inside the transaction of `follow`, `block`, `like`, `repost`, reply and quote creation, and the block check for those writes moves inside the same transaction, so a write cannot land across a concurrent block.
- **S4.** Cursor `t` is capped at `8640000000000000`; any other malformed cursor is `invalid_request`, never 500.
- **S5.** `block` and `mute` resolve the target through the visibility rule (`not_found` when the target blocked the viewer). `targetPost` evaluates the post's state before the block direction, so a blocker probing ids learns nothing about hidden posts.
- **S6.** Bodies, alt text, display names and bios reject bidirectional overrides and isolates (U+202A–U+202E, U+2066–U+2069), U+200B, U+2060 and U+FEFF; length counts exclude format characters; a body that is empty after removing them is rejected.
- **S7.** Follower and following queries filter blocks before `LIMIT`.
- **S8.** When the rate-limit store fails, writes and the global limiter answer `503 service_unavailable` with `Retry-After: 30`, logged once per outage.
- **S9.** `PostId` and other id schemas lowercase their input.
- **M8.** Uploads gain a daily cap per account: 60 in the first 24 hours, 500 afterwards.
- **Indexes** by migration: `posts (reply_to_id, created_at, id)`; `follows (followee_id, created_at, follower_id)` and `(follower_id, created_at, followee_id)`; a partial `posts (created_at, id) where reply_to_id is null and state = 'visible'` for Latest. The Following timeline applies the cursor and limit inside each `UNION ALL` branch.

## 7. Web client (Task 7)

- **W1, keyboard.** Every navigation control becomes a real anchor: expo-router `Link` (`asChild` where a Pressable's styling is kept) for the app shell, author lines, quote embeds, profile rows, stats, list headers and back links; `Text href` with `hrefAttrs={{ target: "_blank", rel: "noopener noreferrer" }}` for URLs in `RichText`; mentions through `Link`. The a11y test scans `src` and fails on any `accessibilityRole="link"` or `role="link"` outside a `Link` or without `href`, and renders `Text href` to prove the anchor attributes.
- **W3.** Delete asks "Delete this post?" inline with Delete and Keep; actions carry a busy flag while a request is in flight.
- **W4, W13.** `PagedList` keeps an in-flight ref and a request sequence; only the latest response commits; a failed first page shows a Try again button.
- **W5.** Session state gains `error` with a retry; `api()` reports any 401 outside the auth flow to the session provider, which flips to signed out.
- **W6, W7.** Post ids are validated with `PostId` and encoded before use; profile updates use functional `setProfile`.
- **W8.** Metadata text moves from zinc-500 to zinc-400; input borders to zinc-500; placeholders to zinc-400.
- **W9–W12.** Image cells are buttons; the compose sheet's backdrop is not a tab stop, its content is a plain view, its slide honours reduced motion, and the draft survives closing the sheet; re-authentication and block confirmation panels are `role="dialog"` with a labelled heading and initial focus; section headings get `aria-level={2}`; `accessibilityViewIsModal` goes; the clipboard call catches rejection.
- **W16.** `src/app/+html.tsx` adds `<meta name="color-scheme" content="dark">`, a dark body background and an inline SVG favicon; `/favicon.ico` no longer falls through to the app.
- **W15.** The terms' "Your data" section names Cloudflare Turnstile at sign-in and the per-browser device id.
- **Settings highlight.** The Settings link is current on every `/settings/*` page.

## 8. Infrastructure (Task 8)

- `postgres:18-alpine` (digest-pinned), volume `pgdata18:/var/lib/postgresql`. `scripts/pg-major-upgrade.mjs <compose project>`: runs `pg_dump -Fc` from a temporary `postgres:16-alpine` container on the old `pgdata` volume, starts the new service, restores with `pg_restore` as the superuser (roles exist from init), and prints the row counts of `profiles`, `posts` and `drizzle.__drizzle_migrations` before and after. The dry run upgrades the scratch stack with it; the replay upgrades the development stack. The old volume is not removed by the script.
- `valkey/valkey:9.1-alpine` with `--requirepass` from `REDIS_PASSWORD` (generated by `gen-dev-env`), `REDIS_URL` carries it, the health check uses `VALKEYCLI_AUTH`. AOF and `noeviction` stay.
- Caddy: image pinned, runs as a dedicated non-root user on port 8080 with `cap_drop: [ALL]`, read-only root; `admin off`; the security `header` block moves inside the SPA handle so `/api/*` keeps the API's own headers (M5/W14); `encode gzip` only for the SPA; `Cache-Control: no-cache` for `index.html` and `public, max-age=31536000, immutable` for `/_expo/*` and `/assets/*` (W2); `request_body max_size 64KB` for `/api/*` and 25MB for `POST /api/media`; `header_up -CF-Connecting-IP` under a `TUNNEL=off` build argument default, so a LAN deployment cannot be spoofed and the tunnel deployment keeps the header.
- Networks: `edge` (cloudflared, caddy), `app` (caddy, api), `data` (api, migrate, postgres, redis; mailpit in dev). The worker keeps `network_mode: none`.
- Limits: `mem_limit`/`memswap_limit` and `pids_limit` on api (512m, 256), caddy (128m, 64), postgres (1g, 256), redis (384m, 64); `logging: json-file, max-size 20m, max-file 5` on every service.
- cloudflared `2026.9.1`, Mailpit `v1.31.2`, semgrep `1.177.0`; Renovate extends `docker:pinDigests`; digests recorded for every image.
- Dockerfiles: `corepack enable && corepack install` from `packageManager: "pnpm@10.30.0+sha512.<hex>"` in the root `package.json`; CI keeps the pinned action with the same version.
- CI: `permissions: contents: read` on both jobs; a `docker` job runs `docker compose build` for the three images.
- Script guards: `smoke-auth-stack.mjs` and `clean-dev-fixtures.mjs` refuse a non-default `docker context`; `gen-dev-env.mjs` refuses when `API_APP_ORIGIN` in `infra/.env` is not a localhost origin.
- `.env.example` documents `API_TRUST_PROXY`, `REDIS_PASSWORD`, `MEDIA_RECONCILE`, `API_TOTP_ENC_KEYS_PREVIOUS`.

## 9. Documentation (Task 9)

README: dev quick start (Valkey, the password), tests, upgrading Postgres, restore rule for the sweeper, "Before going public" (proxy trust, tunnel build argument, Cloudflare cache header), the audit's accepted advisories. Main design section 9: this audit, the method change, the sub-project status and the order of what follows (1b, 1c, 2c, 3, 3b, 4, 5; Foundation Task 16 and the account-dependent steps at the end). 1a section 13 and 2a section 13 gain the amendments named above.

## 10. Deferred

- **Owner-scoped RLS** (M13, S11): every policy is `USING (true)`; scoping needs a per-transaction identity (`SET LOCAL`) in every repository, a cross-cutting change planned for sub-project 4 with the pen-test checklist.
- **Backups, alerting, disk-full handling, secrets files**: sub-project 4 (the restore rule and the upgrade script from this batch are its first pieces).
- **A nonce-based CSP** (W14): `style-src 'unsafe-inline'` is required by the export's reset style; revisit with the nonce support of the Turnstile component in sub-project 4.
- **NativeWind 5 / Tailwind 4, Expo SDK 58, vitest 5**: when stable and 7 days old (Renovate proposes them).
- **Removing reanimated from the web bundle, the light theme, per-screen document titles, a branded error boundary**: sub-project 2c (web polish) or 5.
- **Timing differences on known vs unknown emails** (A11): below the tested 50 ms threshold behind Turnstile and limits.
- **`uuid` 7 under Expo's Xcode plugin and `esbuild` 0.18 under drizzle-kit's loader**: build-time only; overriding could break those tools; Renovate will move them with their parents.

## 11. Testing

Unit tests first for every defect (auth flows with the memory store, logger, config guards, cursor schema, contracts' character rules, social visibility with the in-memory fixtures, the job runner with an injectable clock, the file layer with a FIFO, the web a11y and query-string tests). Integration tests for the social changes (blocks retracting reposts and likes, pair locks under `Promise.all`, follower pages, index migration applied), the janitor (rows purged, events purged through the function, `korbat_auth` still cannot delete directly), proxy trust through the HTTP client, ioredis 6 against Valkey. The full stack: `smoke-auth-stack.mjs` through Caddy on the upgraded Postgres 18 and Valkey, the worker isolation checks, the worst-case image mode after the sharp-unchanged build. The browser check on the scratch stack: keyboard-only navigation (Tab, Enter) through the shell, a post, a profile and a mention; the delete confirmation; a route with a query string; the favicon and dark background before the bundle loads.

## 12. Success criteria

- `pnpm typecheck`, `pnpm test`, the integration suite and both builds pass on TypeScript 7/6, esbuild, ioredis 6, hono 4.13.8 and zod 4.6.5; `pnpm audit --audit-level high` passes and the web-bundle advisory is gone (or recorded as accepted).
- The scratch stack runs on Postgres 18 and Valkey 9.1 after the upgrade script, with the smoke test green through Caddy on port 8080.
- Every finding rated High or Medium by the reviews (A1, A2, M1, M2, M3, M4, S1, S2, W1, W2, W3, W4, W5) has a test that failed before its fix and passes after.
- `docs/superpowers/prompts/audit-fixes/verify_prompts.py` reproduces the repository, and the replay's commits match the dry run's blob for blob outside migration names and lockfile variant noise.

## 13. Amendments from the dry run (2026-09-23 and 2026-09-24)

Found while the tasks were dry-run in the scratch clone; each is applied in the prompts.

- **The age check sits after the per-address limit and before the per-email cooldown (section 3, A11).** Section 3 said "after the rate limits"; behind the 60-second resend cooldown a second attempt with a blocked address would answer 429 for a minute instead of `age_requirement`, which the end-to-end test caught. The per-address limit (10 an hour) is what bounds probing.
- **Mutual blocks cannot arise (section 6, S5).** Since a block towards an account that blocks the viewer is `not_found`, two accounts can never both block each other one after the other, and the pair lock keeps a concurrent pair from landing both; the graph test therefore proves the undo rule with a mute placed before the other side's block, and with a plain block.
- **Valkey starts on a new volume `valkeydata` (section 8).** The rehearsal found that Valkey 9.1 refuses the append-only file Redis 7.4 left in `redisdata` (`Can't handle RDB format version 12`), so the stack would never come up on the old volume. Its contents were transient (rate-limit counters, sign-in codes in flight, cached sessions with Postgres as the source of truth, queued image jobs), so the service moves to a fresh volume and the old one can be removed by hand, like the PostgreSQL 16 volume.
- **The API's `NODE_ENV` in Compose follows `KORBAT_ENV` (section 8).** With Task 4's production guards, an API fixed at `NODE_ENV: production` refused the development stack's Turnstile test secret and plain-http origins, so it never became healthy. `KORBAT_ENV` (development or production, required, no default) is now both the web image's build argument and the API's `NODE_ENV`; the worker keeps running as production, since its only guard is the libvips block list every stack sets.
- **The browser rule counts Origin, Sec-Fetch-Site or Sec-Fetch-Dest, not Sec-Fetch-Mode (section 3, applied in Task 8).** Node's fetch always sends `Sec-Fetch-Mode: cors` and cannot drop it, so the stack's smoke test, a native-style client, was answered with cookies and no token. Browsers send Origin on every state change and the fetch metadata headers together, so those decide; a test proves a bare Sec-Fetch-Mode keeps its claimed platform.
