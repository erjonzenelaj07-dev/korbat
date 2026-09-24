# korbat audit fixes — Task 10 of 11: The query-string override goes: 7.1.3 stays (expo-router imports it as a namespace), its decoder is overridden to decode-uri-component 0.5.0 and a repository patch lets the CommonJS module call the ES module

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform whose web app is built with Expo and expo-router. Task 1 overrode `query-string` to 9.5.1 to clear a `pnpm audit` advisory in its decoder, on the condition that the exported web bundle still parsed and printed query strings. The dry run's browser check after Task 8 showed it did not: expo-router imports query-string as a namespace, query-string 9 has only a default export, so `stringify` was undefined and no navigation updated the address bar. This task keeps query-string 7.1.3, the major expo-router asks for, overrides its decoder to decode-uri-component 0.5.0 (the version without the exponential-time defect) and adds a one-line repository patch so the CommonJS module can call the ES module's default export; the app test imports the module the way expo-router does, and the web image is rebuilt. The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, section 1 and its amendment in section 13.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `docs: audit amendments in the 1a, 2a and 2b specs; the main design records the audit, the technology and method changes and the roadmap; the audit spec gains its dry-run amendments`.

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
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/10-query-string.md 1
```

Expected: 5 lines starting with `wrote`, one for each file below.

### Replace `apps/app/test/query-string.test.ts` (whole file)

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import * as queryString from "query-string";
import { describe, expect, test } from "vitest";

// expo-router parses and prints URL query strings through query-string 7, imported as a namespace
// (`import * as queryString`), so the module must expose `parse` and `stringify` by name: a version with only
// a default export left every navigation's address bar unchanged in the exported web bundle. The workspace
// keeps 7.1.3 and overrides its decoder to decode-uri-component 0.5.0, which is not exponential on malformed
// input (GHSA for < 0.5.0); a repository patch lets the CommonJS module call that ES module's default export.
describe("query strings", () => {
  test("parse and stringify are named exports and decode percent-encoded values", () => {
    expect(typeof queryString.parse).toBe("function");
    expect(typeof queryString.stringify).toBe("function");
    expect(queryString.parse("a=%2F&b=1&c=x%20y&d=%C3%A5")).toEqual({ a: "/", b: "1", c: "x y", d: "\u00e5" });
    expect(queryString.stringify({ b: "1", a: "/" }, { sort: false })).toBe("b=1&a=%2F");
    expect(queryString.parse("")).toEqual({});
  });

  test("the lockfile holds query-string 7.1.3, patched, and no decode-uri-component below 0.5.0", () => {
    const lock = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "pnpm-lock.yaml"), "utf8");
    expect(new Set([...lock.matchAll(/^ {2}query-string@([0-9.]+)/gm)].map((m) => m[1]))).toEqual(new Set(["7.1.3"]));
    expect(lock).toMatch(/^ {2}query-string@7[.]1[.]3:\n {4}hash: /m);
    const versions = [...lock.matchAll(/^ {2}decode-uri-component@([0-9]+)[.]([0-9]+)[.]([0-9]+)/gm)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(versions.length).toBeGreaterThan(0);
    for (const [major, minor] of versions) expect(major > 0 || minor >= 5).toBe(true);
  });
});
```

### Replace `docs/superpowers/specs/2026-09-23-audit-fixes-design.md` (whole file)

```markdown
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
- **The `query-string` override is replaced by a decoder override and a repository patch (section 1, Task 10).** Section 1 kept the override to 9.5.1 only if the exported web bundle still parsed and printed query strings; the browser check after Task 8 showed it did not: expo-router imports query-string as a namespace (`import * as queryString`), query-string 9 has only a default export, so `stringify` was undefined and no navigation updated the address bar (`TypeError: o.stringify is not a function` in the bundle). The workspace keeps query-string 7.1.3, the major expo-router asks for, overrides `decode-uri-component` to 0.5.0, which clears the advisory, and carries `patches/query-string@7.1.3.patch`, one line that lets the CommonJS module call the ES module's default export. The app test imports the module the way expo-router does.
```

### Replace `infra/caddy/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
# The public Turnstile site key is inlined into the web bundle at export time. It is not a secret.
ARG EXPO_PUBLIC_TURNSTILE_SITE_KEY
ARG KORBAT_ENV=development
RUN test -n "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" || { echo "the EXPO_PUBLIC_TURNSTILE_SITE_KEY build argument is required" >&2; exit 1; }
# Cloudflare's test keys pass every check, so a production build refuses them.
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" in [123]x0*AA) echo "EXPO_PUBLIC_TURNSTILE_SITE_KEY is a Turnstile test key; a production build needs the site key of your own widget" >&2; exit 1;; esac; fi
RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" npx expo export --platform web

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
ARG TUNNEL=off
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a client could set it.
RUN if [ "$TUNNEL" = "on" ]; then : > /etc/caddy/cf-header.caddy; else echo "header_up -CF-Connecting-IP" > /etc/caddy/cf-header.caddy; fi
COPY --from=web /repo/apps/app/dist /srv
# The image's binary carries cap_net_bind_service as a file capability; with every capability dropped, the
# kernel refuses to run it ("operation not permitted"). Port 8080 needs no capability, so it is removed.
RUN setcap -r /usr/bin/caddy
# Caddy runs as its own user on a port it may bind without privileges; its state directories are its own.
RUN adduser -D -u 10001 caddy && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
EXPOSE 8080
```

### Replace `apps/api/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @korbat/api...
RUN pnpm --filter @korbat/api build

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ENV NODE_ENV=production
ARG KORBAT_VERSION=0.0.0
ENV KORBAT_VERSION=$KORBAT_VERSION
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
# argon2 is not bundled (native module). The install above ran on Alpine, so @node-rs holds the
# package and exactly the musl binary for this image's CPU architecture.
COPY --from=build /repo/node_modules/@node-rs ./node_modules/@node-rs
# The media volumes mount here. A new volume takes the owner of the path in the image, so both paths
# exist and belong to the user the process runs as, in this image and in the worker's.
RUN mkdir -p /media/uploads /media/store && chown node:node /media/uploads /media/store
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Replace `apps/worker/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @korbat/worker...
RUN pnpm --filter @korbat/worker build

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ENV NODE_ENV=production
# libvips reads this when it loads, so it has to be in the environment before the process starts.
ENV VIPS_BLOCK_UNTRUSTED=1
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./dist
# sharp is not bundled (native module). The install above ran on Alpine, so @img holds exactly the
# musl binaries for this image's CPU architecture. detect-libc and semver are what sharp itself needs.
COPY --from=build /repo/node_modules/sharp ./node_modules/sharp
COPY --from=build /repo/node_modules/@img ./node_modules/@img
COPY --from=build /repo/node_modules/detect-libc ./node_modules/detect-libc
COPY --from=build /repo/node_modules/semver ./node_modules/semver
# The volumes mount here. A new volume takes the owner of the path in the image, so both paths
# exist and belong to the user the process runs as, in this image and in the API's.
RUN mkdir -p /media/uploads /media/store && chown node:node /media/uploads /media/store
USER node
CMD ["node", "dist/index.js"]
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/app test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/query-string.test.ts (2 tests | 1 failed) 11ms
Test Files  1 failed | 1 passed (2)
Tests  1 failed | 15 passed (16)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/10-query-string.md 3
```

Expected: 2 lines starting with `wrote`, one for each file below.

### Create `patches/query-string@7.1.3.patch`

```text
diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1,6 +1,9 @@
 'use strict';
 const strictUriEncode = require('strict-uri-encode');
-const decodeComponent = require('decode-uri-component');
+// decode-uri-component 0.5.0, the decoder without the exponential-time defect, is an ES module whose function
+// is its default export; a CommonJS require sees the module object, in Node and in Metro alike.
+const decodeComponentModule = require('decode-uri-component');
+const decodeComponent = decodeComponentModule.default ?? decodeComponentModule;
 const splitOnFirst = require('split-on-first');
 const filterObject = require('filter-obj');
 
```

### Replace `package.json` (whole file)

```json
{
  "name": "korbat",
  "private": true,
  "packageManager": "pnpm@10.30.0+sha512.2b5753de015d480eeb88f5b5b61e0051f05b4301808a82ec8b840c9d2adf7748eb352c83f5c1593ca703ff1017295bc3fdd3119abb9686efc96b9fcb18200937",
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "pnpm -r --if-present run typecheck",
    "test": "pnpm -r --if-present run test",
    "build": "pnpm -r --if-present run build"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"],
    "overrides": {
      "decode-uri-component": "0.5.0"
    },
    "patchedDependencies": {
      "query-string@7.1.3": "patches/query-string@7.1.3.patch"
    }
  }
}
```

## Step 4: verify: install

```bash
pnpm install --config.minimum-release-age=0
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.2s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
4 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: lockfile

```bash
node -e "const l=require('fs').readFileSync('pnpm-lock.yaml','utf8');console.log('query-string-7.1.3', /^ {2}query-string@7[.]1[.]3:/m.test(l), 'query-string-9', /query-string@9[.]/.test(l), 'decode-uri-component-0.5.0', /^ {2}decode-uri-component@0[.]5[.]0:/m.test(l), 'below-0.5', /decode-uri-component@0[.][0-4][.]/.test(l), 'patched', /patchedDependencies:/.test(l))"
```

Expected output contains:

- `query-string-7.1.3 true query-string-9 false decode-uri-component-0.5.0 true below-0.5 false patched true`

Observed on the dry run:

```text
query-string-7.1.3 true query-string-9 false decode-uri-component-0.5.0 true below-0.5 false patched true
```

## Step 7: verify: typecheck

```bash
pnpm --filter @korbat/app typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 8: verify: test

```bash
pnpm --filter @korbat/app test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  16 passed (16)
```

## Step 9: verify: audit

```bash
pnpm audit --audit-level high; echo audit-exit=$?
```

Expected output contains:

- `audit-exit=0`

Must not contain:

- `decode-uri-component`

Observed on the dry run:

```text
audit-exit=0
```

## Step 10: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Allowed difference: The web export runs a full Metro bundle and can take a few minutes.

Observed on the dry run:

```text
Exported: dist
```

## Step 11: verify: images

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log; docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait caddy && echo up-ok
```

Expected output contains:

- `build-exit=0`
- `up-ok`

Allowed difference: The three images build for several minutes; the step hides the build's output in `.data/stack-build.log`. If `build-exit=0` is missing, read that file: `ECONNRESET` warnings from pnpm inside the build mean Docker's network is failing, which is a STOP condition to report, not to work around.

Observed on the dry run:

```text
build-exit=0
up-ok
```

## Step 12: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.3s using pnpm v10.30.0
```

## Step 13: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/Dockerfile`
- `apps/app/test/query-string.test.ts`
- `apps/worker/Dockerfile`
- `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`
- `infra/caddy/Dockerfile`
- `package.json`
- `patches/query-string@7.1.3.patch`
- `pnpm-lock.yaml`

## Step 14: commit

```bash
git add -A
git commit -q -m "fix(deps): query-string stays at 7.1.3 with its decoder overridden to decode-uri-component 0.5.0 and a one-line repository patch for the ES module's default export; the 9.5.1 override had left expo-router's namespace import without stringify, so no navigation updated the address bar" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `fix(deps): query-string stays at 7.1.3 with its decoder overridden to decode-uri-component 0.5.0 and a one-line repository patch for the ES module's default export; the 9.5.1 override had left expo-router's namespace import without stringify, so no navigation updated the address bar`.

## Report format (mandatory)

```text
TASK 10 REPORT
Files written: <count, expected 7>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "lockfile": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "audit": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "images": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
