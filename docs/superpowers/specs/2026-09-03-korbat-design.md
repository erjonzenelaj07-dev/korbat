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
| 2 | **Posting & feed** | Split into 2a text posting and feed (posts, replies, quotes, likes, reposts, bookmarks, follows, blocks/mutes, Following and Latest timelines, threads, profile pages, write limits, web screens; spec `2026-09-17-posting-feed-2a-design.md`), 2b images (upload, worker re-encode, EXIF strip, blurhash, alt text, media in composer and lists; spec `2026-09-18-images-2b-design.md`), 2c explore (ranked view, refresh job, tab), and 2d engagement, which has its own row below because it is built after 3 and 3b. | 1a |
| 3 | **Trust & safety** | Split into 3a the staff console foundation (staff keys, staff sessions, per-action step-up, the audit log as a hash chain, the console app; spec `2026-09-28-staff-console-3a-design.md`), 3c moderation cases (report flow and notices, case queue, decisions with public reasons, strikes, suspensions, appeals, author-facing case screens), and 3d transparency and automation (transparency log + page, rules page, brigading detection, CSAM scanning hookup, NSFW image scoring with automatic withholding for R1, moved here from 2b on 2026-09-18 so that no post is withheld before a human can review it). See section 9, 2026-10-01. | 2 |
| 3b | **Import from other platforms** | Archive upload for X, Mastodon, Bluesky; quarantine bucket; sandboxed streaming parser; preview and select; imported posts on profile only; same image pipeline and CSAM scan as native posts; one-click undo. See section 6a. | 2, 3 |
| 2d | **Engagement** (added 2026-09-30) | In-app notifications (replies, mentions, quotes, follows), mentions stored as data, avatars through the 2b pipeline, share cards for public posts and profiles (per-page titles and Open Graph/Twitter meta served by korbat itself), and help on a new account's first visit. A proposed scope that its brainstorm confirms; see section 9, 2026-09-30. | 2, 3 |
| 4 | **Hardening & launch** | Cloudflare WAF/rate rules tuned, ZAP scan clean, dependency audit clean, log scrubbing verified, IP-hash purge job, alerting, backup/restore drill, privacy policy + terms, external pen-test checklist walked | 3, 3b, 2d |
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

### 2026-09-30, the engagement slice (roadmap)

- **Why (section 6, row 2d).** A review of the repository at `21e0ef9` found that the build order led to a launch with nothing that brings a person back or brings new people in. There are no notifications, mentions are links made in the client only (2a design, section 1), avatars were deferred by 1b, a link preview of a public post or profile shows the bare web shell under one title, and a new account gets no help on its first visit. Sub-project 4 hardens and launches what exists, so a slice for these comes before it.
- **Proposed scope, confirmed in its brainstorm.**
  - In-app notifications for replies, mentions, quotes and follows. Whether likes and reposts notify, and how they are grouped, is for the brainstorm. Web push is weighed there too; native push stays in sub-project 5.
  - Mentions as data: a handle in a post links to the account it named when the post was written, and blocks hold both ways, as in every 2a read and write.
  - Avatars through the 2b pipeline and sub-project 3's image scanning. This reverses 1b's deferral; the brainstorm decides how the text-first layouts of section 5 change.
  - Share cards: per-page titles and Open Graph and Twitter meta for public posts and profiles, generated by korbat's own server. Two routes exist: a Hono route behind Caddy that fills the web shell, or expo-router's server output once Expo SDK 58 is stable and past the release-age floor. A card never shows more than a signed-out reader sees, so withheld, removed and deleted posts get none. Whether pseudonymous profiles are indexed and unfurled by default is decided there. Titles for these pages move here from the web polish parked for sub-project 5 (2c amendment); the rest of that list stays in 5.
  - Help on a new account's first visit. If it suggests accounts, it does so by a published rule, never by reputation (section 3c).
- **Why after 3 and 3b.** Avatars and card images must pass sub-project 3's scanning like every other image, and cards must follow its moderation states. Imported posts (section 6a) exist by then; their @mentions stay plain text and never notify.
- **Unchanged.** Keyword search and hashtags stay out: the 2a and 2c designs keep them out because keyword search is a ready tool for finding a target's posts, and exact handle lookup remains. The feed stays chronological, and Explore's formula is untouched.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, the screen-reader fix, the audit batch. Next, in order: 3 trust and safety, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-01, sub-project 3a (`2026-09-28-staff-console-3a-design.md`)

- **Delivered (section 3d and section 6, row 3).** The staff console foundation, meaning staff keys, staff sessions, per-action step-up, the audit log as a hash chain and the console app. Staff keys are WebAuthn credentials on the console's own relying party whose authenticator reported user verification and no backup eligibility, enrolled only through one-time links that `staff.js enroll` issues as the migrator, which the database enforces, and revoked from the command line, by a demotion, by an account's deletion or by a counter that goes backwards. Staff sessions last 12 hours at most and 15 minutes without an action by their person, are read from the database at every request and live only on the console's origin, behind a staff gate. The step-up confirms each action that changes something with the session's own key, bound to the action, its target and its parameters, and the record stores the assertion. The audit log is chained in an order and at times the database alone sets, every auth-side fact written in the same transaction as its change, and `staff.js audit-verify` recomputes it in its own code against heads kept off the server.
- **The console (sections 1 and 3d).** Wherever this document says the admin console is a container, deploy or hostname of its own with TOTP (lines 48, 63 and 154), read: `apps/admin`, a plain React page built into Caddy's image and served by a second Caddy site on its own hostname, which proxies only `/api/staff/*`. Staff powers need a staff key; TOTP, passwords, email codes and passkeys never give them. Cloudflare Access in front of the console stays an optional extra. This replaces the 1c amendment's staff sign-in with a passkey as the required second factor.
- **Sub-project 3 is split (section 6, row 3)** into three parts, each dry-run, reviewed and replayed on its own. 3a, the staff console foundation, is the part above. 3c, moderation cases: notices and reports, Article 16 notices of the Digital Services Act included, which anyone may send, signed in or not, about content they consider illegal under EU or national law; cases and their events, decisions with statements of reasons, evidence, strikes, suspensions, appeals, the author's case screens and mails, Explore's formula version 2, the export and the terms; and a path of its own for authorities' orders, among them removal orders for terrorist content under Regulation (EU) 2021/784. 3d, transparency and automation: the public transparency and rules pages, R1 scoring in a no-network worker, the R2 quarantine and the Cloudflare runbook, PDQ and SHA-256 hashes of every upload kept with the image, the purge of Cloudflare's cache when a post is withheld or removed, brigading signals, and the publication of the audit head. Import keeps its name, 3b, and needs 3d's R2 hookup.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, the screen-reader fix, the audit batch. Next, in order: 3c moderation cases, 3d transparency and automation, 3b import, 2d engagement, 4 hardening, 5 native builds.
