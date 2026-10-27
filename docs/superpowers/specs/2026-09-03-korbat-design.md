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
Delivered by the UI sub-project (`docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`): see section 9, 2026-10-21.

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
| UI | **Interface and experience** (added 2026-10-12) | korbat's look and feel raised to the level of the best social apps while it keeps its values: section 5 made real (dark-first with a light theme, editorial type, three columns on desktop, purposeful motion that respects reduced motion, WCAG AA), a design system of owned components on proven open-source libraries (each checked in its brainstorm for version, licence, upkeep and fit on Expo web and native, under the 7-day release-age floor and with no AGPL), delight without dark patterns (the reader's place kept, a feed that ends, moderation status shown on the post, haptics by intent with an off switch), and the console restyled within its strict content security policy. Its brainstorm starts from a study of Bluesky's open-source app. Delivered by the UI sub-project (`docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`): see section 9, 2026-10-21. | 2, 3 |
| 3b | **Import from other platforms** | Archive upload for X, Mastodon, Bluesky; quarantine bucket; sandboxed streaming parser; preview and select; imported posts on profile only; same image pipeline and CSAM scan as native posts; one-click undo. See section 6a. Delivered by sub-project 3b (`docs/superpowers/specs/2026-10-22-import-3b-design.md`): see section 9, 2026-10-27. | 2, 3 |
| 2d | **Engagement** (added 2026-09-30) | In-app notifications (replies, mentions, quotes, follows), mentions stored as data, avatars through the 2b pipeline, share cards for public posts and profiles (per-page titles and Open Graph/Twitter meta served by korbat itself), and help on a new account's first visit. A proposed scope that its brainstorm confirms; see section 9, 2026-09-30. | 2, 3 |
| 4 | **Hardening & launch** | Cloudflare WAF/rate rules tuned, ZAP scan clean, dependency audit clean, log scrubbing verified, IP-hash purge job, alerting, backup/restore drill, privacy policy + terms, external pen-test checklist walked | 3, 3b, 2d |
| 5 | **Native builds** | EAS builds for iOS/Android, SecureStore sessions, push notifications, store listings | 4 |

Sub-project 0 is small and will be planned immediately after this design is approved. Each later one starts with a short brainstorm to confirm details that this document leaves at the level of intent.

---

## 6a. Importing posts from other platforms (added 2026-09-14)
Delivered by sub-project 3b (`docs/superpowers/specs/2026-10-22-import-3b-design.md`): see section 9, 2026-10-27.

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

### 2026-10-09, sub-project 3c (`2026-10-02-moderation-cases-3c-design.md`)

- **Delivered (sections 2 and 4, and section 6, row 3).** Moderation cases: reports and Article 16 notices that anyone can send, signed in or not, on a rule or on the law, each named target in exactly one open case; decisions that are the statement of reasons, with several measures in a ledger from which the database, by one writer, derives every restriction of a post, an image or a profile field, each decision confirmed by the deciding person's staff key in the same transaction; evidence copied as text and images held by reference; the author's appeal and the reporter's re-examination; the console's queue, case page, composer with its preview, and appeals; the app's report form, status page and case screens; the export's `moderation` member, the terms' moderation sections and rulebook version 2; retention by consumer; migrations 0014 to 0018. A report or finding of child sexual abuse material freezes what its case reaches, nobody at korbat opens the images, a person seals them for everyone while an admin decides, and the release of sealed images waits for 3d.
- **Context (line 5, "Everything else stays up") and the rulebook as the complete list of reasons (section 4).** Read: everything else stays up unless it is illegal under EU or national law and korbat is told so in a notice (an authority's order joins with 3f). Article 16 notices on a legal ground bind korbat, and keeping evidently illegal content up after a notice costs the hosting exemption. Removals for law name the law, never a rule, and are counted apart.
- **Context, line 10 ("Every removal cites a public rule, shows the author exactly what happened, and can be appealed to a different human").** A removal on a legal ground cites the law. Images reported as child sexual abuse material can be sealed without anyone at korbat having opened them, and are then shown to nobody, their author included, while the post's text stays; an R4 body is blanked once the removal is final. What korbat does while it decides cannot be appealed and ends with the case's final decision, which can be (a seal taken while deciding ends with the admin's answer to the case's reports of that kind). People who reported get a re-examination of "no action" instead of an appeal.
- **The trust and safety tables (section 2).** `reports`, `cases` with one `action`, `appeals` one per case, `strikes` and `transparency_log` are replaced by intakes, items, cases, decisions with several measures in a ledger, the author's appeals per decision, re-examination items, and evidence (3c design, section 6). Strikes are 3e's; `transparency_log` becomes 3d's to define in the shape of the Commission's Transparency Database. None of the old tables could hold a notice from someone without an account, a decision with several measures, or a statement's elements, and nothing had ever written them: migration 0014 drops them.
- **Reputation, report weighting and automation raising priority (section 3c, and section 4's automation list and case lifecycle step 1).** Reports are not weighted, reputation is not computed and its column is dropped, and the queue orders by severity (three lanes) and age; automation in 3d may flag, never weight. Weighting slows the legal path for strangers by design, rewards aged brigades, and turns strikes into hidden penalties. Write limits stay on account age, as 2a and 2b built them.
- **The senior queue (section 4, case lifecycle step 2).** A team of one or two has no separate senior moderators. Every final decision that answers a report or finding of child sexual abuse material or an R5 item, or that cites R2 or R5, whatever its outcome, every lifting of a seal, and every correction of such a decision, is an admin's, and so is the review of a decision that cites R2 or sealed images; a review of an R5 restriction is any eligible moderator's. Any moderator may withhold such content, or seal reported images, while deciding, and such cases sit in lane 0. Brigading-flagged cases are 3d's.
- **Decision (step 3).** A decision takes several measures, carries a statement of reasons whose every element is data, and names a snapshot of what it was made on. The promise about strikes and suspension moves wholly to 3e. "The author sees the exact content that was actioned" holds while korbat keeps the case's copies (until every restriction of the case is final for its author, about six months after they were told when they do not appeal), except for sealed images (the author sees the decision and the post's text, and each sealed image as a placeholder) and R4 once final (the body blanked, the chip and reason kept). Afterwards the decision screen says on which day korbat's copy was erased, and a removed post or image itself stays in its author's own view while they keep it.
- **Appeal (step 4).** One appeal per final restriction, by its author, for six months, while any of it is in force; the database enforces the different reviewer, who also opened no finding in the case; with one moderator, appeals wait. Measures taken while deciding are not appealable. While a report of child sexual abuse material about a post is unanswered or its images are sealed, a review or a correction that turns on one of its images is decided on text alone or waits for the admin's answer. Notifiers and reporters may ask once for a re-examination of "no action", and an answer given while nobody could open the post's images does not spend that request.
- **What the author experiences: a withheld post (line 190).** It shows the rule of the decision taken while deciding that withheld it, not "usually within 24h": the README publishes response-time targets per lane (24 hours in lanes 0 and 1, seven days in lane 2), every staff account is alerted when a case passes them, and they are targets, not promises. Its content stays visible to its author, except images sealed while deciding on a report or finding of child sexual abuse material, which nobody is shown, their author included, from the first seal: serving a file reported as such material back to its uploader is making it available (Directive 2011/93/EU Art. 5(5)). Flagged for the owner in the 3c design's section 2.
- **What the author experiences: a removed post (line 191).** Holds, except R4 (redacted when final). A post whose images are sealed stays in its author's views and export with its text; only the sealed images are shown to nobody, the author included, since the seal is a state of images and text is never sealed.
- **Suspension (line 192, and step 3's "suspension requires 3 active strikes or an R2/R5 case").** 3e's.
- **R4 (section 4, "Withhold first when the report is credible").** A moderator's decision taken while deciding, never report volume.
- **R2 (section 4, "Cloudflare CSAM hash match -> auto-remove, account suspended, NCMEC report").** Until 3d, whoever is on duty seals reported images by hand without opening them, an admin seals them for good or answers without a seal, and the operator reports every seal for good to the national police or the authority its Member State names (never a hotline), not NCMEC. Suspension is 3e's; the record of each report to an authority and the hand-over of sealed files are 3f's; the hash match, the automatic seal, the quarantine and the release are 3d's.
- **R6 (section 4, "Reputation signals help triage").** Reputation no longer exists; R6 cases are ordered like every other case, by lane and age. Rulebook version 2 names coordinated manipulation in R6 ("No spam, scams, impersonation or coordinated manipulation"), which the 2c amendment left to sub-project 3.
- **The audit log (section 3d, "Every action lands in the append-only audit_log").** Holds: decisions, reviews and reveals are step-up rows naming their decision, and the chain holds only ids, enums, times and salted digests, never a text anyone typed.
- **Sub-project 3 as it now stands (section 6, row 3, and the 2026-10-01 amendment).** Five parts, each dry-run and replayed on its own. 3a, the staff console foundation, and 3c, moderation cases, are delivered. What the 2026-10-01 amendment listed under 3c beyond them (strikes, suspensions, Explore's formula version 2, the path for authorities' orders) left 3c when its design was written, and that second half has since been split into two designs, both committed. **3e, account sanctions** (`2026-10-09-account-sanctions-3e-design.md`): strikes that count for 90 days and a ladder at three active strikes, suspensions as measures of the ledger, termination, the restriction of reporting, handle retirement, and Explore's formula version 2. **3f, authorities' orders, the alert channel, records to authorities and recovery** (`2026-10-09-authorities-orders-3f-design.md`): the contact point and its watcher, alerts to the on-call phones, order records with the one-hour clock of a removal order under Regulation (EU) 2021/784, the one confirmed action that disables content under an order, preservation, the record of every notification to an authority and every production with the hand-over of sealed image files, the off-server copy of decisions and the restore that takes each lost measure again. **3d, transparency and automation**, as the 2026-10-01 amendment has it, with the handling of sealed images: the automatic seal on a hash match, the quarantine and the release. Import keeps its name, 3b.
- **The gate (section 6).** korbat is not opened to the public, nor sign-up to people the operator does not know, before 3f's order path and 3d's handling of sealed images have both shipped, and no authorities' contact point is published before 3f's order path ships. The README states it first under Before going public. Any reordering that puts sub-project 4 before 3f or before 3d reopens it.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, the screen-reader fix, the audit batch. Next, in order: 3e account sanctions, 3f authorities' orders, 3d transparency and automation, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-12, sub-project 3e (`2026-10-09-account-sanctions-3e-design.md`)

- **Delivered (sections 2 and 4, and section 6, row 3).** Account sanctions, on 3c's ledger and nothing beside it: strikes that the database, not a moderator, finds due for a final decision that a post breaks a korbat rule, counting 90 days; a ladder at three active strikes that lets a moderator announce a suspension of at most 3, 7 and 30 days, and an admin a termination after three; suspensions at once, an admin's only, on a closed list (a threat, terrorist content, a flood, and a protective suspension on a seal for good); a reply that holds an announced start; termination, purged only once final for the person; the restriction of reporting after a warning, on marks "manifestly unfounded" that persons set and sign; handle retirement with a placeholder; Explore's formula version 2. Every number is a constant of `standing_rules()` in SQL, mirrored in `STANDING_RULES`; every restriction is derived by one writer from the ledger; one predicate judges every write of the acting account. Migrations `0020` to `0024` (the design's 0019 to 0023, one higher since 3c's review added `0019_redaction_scope.sql`).
- **R2 (section 4, line 172, "account suspended").** A report of child sexual abuse material alone supports no measure on the account. An admin's seal for good of images of the account (3c) supports at most one protective suspension, which an admin takes for up to 14 days in a decision of its own, which is no finding, and which is appealed and reviewed at once. No suspension is automatic: 3d's hash match may ask for one, and a person confirms it. Reason: korbat's staff do not open images reported this way, so korbat has assessed nothing.
- **Automation (section 4, line 180, "May not ... suspend an account (except R2)").** The exception is dropped. Reason: GDPR Art. 22 and the bullet above.
- **Decision (step 3, line 185: the action `strike`; "suspension requires 3 active strikes or an R2/R5 case").** A strike is not a choice of the moderator but the database's consequence of a final rule decision on a post, for 90 days. Three active strikes let a moderator announce a suspension of at most 3, 7 and 30 days, with 168 hours to reply; after a suspension one further strike opens the next step while three still count, and after three such suspensions decided in 365 days, whatever their length, an admin may announce a termination. A suspension at once is an admin's, on the closed list of 3e's section 2; no announced suspension takes one of its grounds. Reason: equal treatment that an auditor can recompute, and recital 64's prior warning.
- **Appeal (step 4, line 186, "Upheld appeals reverse the action and remove the strike").** Holds, and goes further: a suspension that rested on the strike loses its basis in the same transaction when fewer than three of its strikes still stand. One that has not started does not start, one that runs ends, and one that had already ended no longer counts toward a later suspension.
- **What the author experiences: suspension (line 192, "Suspension shows the case list and a link to appeal each one").** The banner on every screen, and the suspension's own decision screen with the strikes it rests on, each linking to its decision and that decision's appeal.
- **The trust and safety tables (section 2, line 109, `strikes`).** A strike is a ledger measure, not a table; so are suspensions, terminations, retirements and the reporting measures, with their times and basis in seven columns of `decision_actions`. The tables `suspension_replies`, `unfounded_marks` and `report_tallies` hold the replies and the reporting counts.
- **Sub-project 3 as it now stands (section 6, row 3).** 3a, 3c and 3e are delivered. Next, in order: 3f authorities' orders (the order path, the alert channel, the records of reports to authorities and the recovery after a restore), then 3d transparency and automation. korbat is not opened to the public before 3f's order path and 3d's handling of sealed images have both shipped.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, the screen-reader fix, the audit batch. Next, in order: 3f authorities' orders, 3d transparency and automation, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-17, sub-project 3f (`2026-10-09-authorities-orders-3f-design.md`)

- **Delivered (sections 2 and 4, and section 6, row 3).** Authorities' orders, the alert channel, records to authorities and recovery, on 3c's ledger and 3e's and nothing beside them: a contact point for authorities watched by `notify`, which reads two numbers a message and nothing else; a self-hosted ntfy that rings the on-call phone, with the staff mails as the second leg; order records with the one-hour clock of a removal order; "Disable for an order", the post level `disabled` and its reversal; the author's notice, held while a non-disclosure decision runs and released by the database; six months and a day of preservation; a record of every report to an authority and of everything handed to one, with the address of a deleted account held while a report is owed; the keeper's daily copy of the audit log's tail and the import that names what a restore lost; the yearly counts (`staff.js tco-counts`). Migrations 0026 to 0031.
- **Line 10** ("Every removal cites a public rule, shows the author exactly what happened, and can be appealed to a different human"): an authority's order is the exception to all three, and the terms say so beforehand. It cites the order, not a rule; its author is told at once unless the order forbids it, and then when the law, or for an order without a period of the law's the issuing authority, allows; korbat's appeal does not apply, and the notice names the authority's remedies. Reason: TCO Art. 3, 9 and 11; DSA Art. 9 and 17(5).
- **Line 191** ("A removed post stays in the author's view ... never silently gone"): holds for every decision of korbat's own. A post disabled under a removal order, or under any order that says its author must not be told, is shown to nobody while it is disabled. It is silently gone only while a non-disclosure decision runs: under a removal order for six weeks, for twelve at most, and up to a day and a few hours more, because korbat counts the end so that it is never early; under another order for as long as its issuing authority states. Then the author is told what happened and since when. During that time a decision of korbat's own about the same post, and the answer to an appeal about it, are told late too, with the notice. Reason: TCO Art. 6(3) and 11(3); DSA Art. 9(5). Flagged for the owner and counsel (3f's section 2, rows 16, 24, 26, 46 and 47).
- **Line 293** (images of withheld and removed posts reach only their author): images of a disabled post reach nobody.
- **Lines 23 and 38 to 42** (the stack and the tunnel): the stack gains the services `notify` and `ntfy`, under a Compose profile that `COMPOSE_PROFILES` in `infra/.env` switches on, and, on demand, `handover`; Caddy gains a third site for the push hostname and the tunnel a third public hostname; the network `push` has no route to the internet and Caddy's two other sites refuse a client from it; PostgreSQL and `notify` meet on a network of their own, `watch`, so the stack's rule that the API alone reaches the data services gains exactly one named exception. The app's site answers 404 with the shell for a post's page that is not public, and 503 to everything while `APP_SITE=closed`.
- **Line 156** (backups): beside the backups, the keeper downloads the audit log's tail each day, under a staff key, and holds it off the server; after a restore it names what was lost, and a person takes each measure again.
- **Line 160** (alerts on moderation queue age): staff alerts reach phones through korbat's own ntfy and stay mails as well; a push carries counts and times only, and so does every mail of 3f's own.
- **Context and section 6, row 3:** korbat is offered in its home state only (3f's section 2, row 6). The order of sub-project 3 is 3c, 3e, 3f, 3d; korbat is not opened to the public before 3f's order path and 3d's handling of sealed images have shipped and the owner's list of the README's Before going public (3f's W.10) is done.
- **Sub-project 3 as it now stands (section 6, row 3).** 3a, 3c, 3e and 3f are delivered. Next: 3d transparency and automation. korbat is not opened to the public before 3d's handling of sealed images has shipped and the owner's list is done.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, the screen-reader fix, the audit batch. Next, in order: 3d transparency and automation, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-19, sub-project 3d (`2026-10-09-transparency-automation-3d-design.md`)

- **Delivered (sections 2 and 4, and section 6, row 3).** Transparency and automation, on 3c's ledger, 3e's and 3f's, with every adapter off by default: the quarantine of sealed image files and its one-shot mover; the release of sealed images on a recorded leave or instruction to destroy, with its proof and its replay after a restore; an outbox row for every image that stops being public, drained to an edge adapter, and cache headers that bound a copy without it; the public pages `/rules` and `/transparency` with yearly banded editions, the recipients' figure and the audit head's daily value; the automated decision, always interim and open to "Ask for a person"; the mechanisms of the R1 check and of the comparison with known material behind their test adapters; and the flag "possible coordinated reporting". Migrations 0033 to 0040.
- **Lines 110 and 187** (a public copy of every case; monthly counts, appeal and reversal rates): withdrawn. No table `transparency_log` and no public row of a decision exist. `/transparency` shows yearly editions of banded counts, by ground and by kind of measure and never their cross, published on or after 1 March and never changed; a rate appears only as two counts on a base of ten or more. Reason: on a service of some hundreds of accounts a dated row, or a small cell, is a statement about a known person (section 2, rows 1 to 3). Flagged for the owner.
- **Line 147** (reports weighted by reputation; brigading sends the case to a senior queue): one flag on a case, shown to staff, which orders nothing and protects by saying "this is not a finding". Reports are never weighted, as 3c decided.
- **Line 148** (ban-evasion signals): not built.
- **Line 167:** `/rules` exists, with a change log and the section "Automation".
- **Line 171** (R1: a score withholds): a score opens a finding for a moderator. It withholds that one image, never the post, only where the owner has set `AUTOMATION_R1_ACTS=on`; the default is off.
- **Line 172** (R2: Cloudflare's match removes, suspends, reports to NCMEC; the only automated removal): a match is korbat's own comparison of hashes with a source the owner has an agreement with. Only a match that the source reports as exact, with an entry it classifies as child sexual abuse material, lets a program act: on an upload it refuses and holds, and on a post, where the owner has switched that on, it seals the post's images until an admin answers. A match with such an entry, exact or not, on a post opens a finding under R2, which freezes the post and alerts an admin, as a moderator's own finding would. A match with an entry of another class is a flag for a person: it cites no rule, freezes nothing and alerts nobody. Nobody at korbat opens an image that a match names, whatever is answered. Nothing is removed by a program, no account is suspended by one, korbat makes no report to NCMEC, and no sealed image is destroyed without an authority's or a court's leave. There is no automated removal in korbat; there are two automated interim measures.
- **Lines 179, 180 and 184** (what automation may do): it may open a finding; where set, withhold one image under R1 or seal one post's images under R2, until a person decides; and flag. It may not raise a priority, remove anything, hide text, reduce reach, or suspend, restrict or end an account, R2 included. (A program's seal starts 3f's record of a report and its hold of the account's address, as every seal does; the texts say so.) A flagged case stays in its lane.
- **Line 190** ("usually within 24h"): 24 hours is the published target for a person's answer after the author asked for one.
- **Lines 201 and 204:** the pages exist as section 9 has them; no panel shows live transparency figures.
- **Line 203 and line 291** (the composer's warning near the threshold): not built. A score before posting would tell a poster how to get past the check.
- **Line 156** (backups): the volume `media-quarantine` is in no backup, and the price is stated.
- **Line 293** (media serving): public images carry `public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0`. Cloudflare's scanning tool is not switched on (section 2, row 31).
- **Lines 23 and 38 to 42** (the stack): one more volume and one more one-shot service behind a profile; the API's outbound hosts grow only while an adapter is on.
- **Line 342 and section 6, row 3:** sub-project 3 is complete with 3d, and the gate is section 14's. Of line 342's list: hashes are computed only while a matcher is on and are deleted with their image; the Cloudflare runbook says what its tool would do and leaves it off; the brigading signal is one flag.
- **Sub-project 3 as it now stands (section 6, row 3).** 3a, 3c, 3e, 3f and 3d are delivered: sub-project 3 is complete. korbat is not opened to the public before the owner's lists of the README's Before going public are done, 3d's parts A and B among them.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, 3d, the screen-reader fix, the audit batch. Next, in order: 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-20, the UI sub-project (approved by the owner on 2026-10-12)

- **Added (section 6).** A sub-project for the interface and the experience, after sub-project 3 and before 3b. The owner asked for an interface that rivals Instagram in polish and delight while staying intuitive, built on proven open-source work. It keeps korbat's values: a chronological feed, no silent reach reduction, visible moderation, pseudonymity and no engagement dark patterns.
- **Section 5** stays the UI sub-project's brief; its brainstorm confirms the libraries and the screens.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, 3d, the screen-reader fix, the audit batch. Next, in order: the UI sub-project, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-21, the UI sub-project (`2026-10-21-interface-experience-ui-design.md`)

- **Delivered (section 5, and section 6, row UI).** The interface and the experience, in ten tasks, with no new route and no migration: the design language as code (colour tokens in Light, Dim and Dark, ink and paper with one violet accent for actions and every text pair at WCAG AA; Fraunces, Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono bundled under the OFL 1.1; Lucide's icons) and korbat's own components, each with a required accessible name; the shell (a phone's tab bar, a tablet's rail, the full nav from 1280 px and the context column from 1024 px), a skip link, toasts, a title on every screen, a missing page and an error boundary; the post as an article whose actions answer at once and roll back with a sentence when refused, with menus holding Who sees this, Copy link, Delete and Report, and a lightbox; feeds that keep the reader's place on the device, count new posts in a pill and end with "You're all caught up"; the composer as a sheet on phones and a card on wider screens, with required descriptions, a progress ring and drafts kept on the device; moderation status on the author's own post, whose chip opens a sheet with the decision's rule, measure, scope, who decided in role terms, statement and appeal; a Settings index with Appearance and accessibility first, and the sign-in flow and the token pages in a public frame; motion with a reduced form for each, and haptics by intent with an off switch; the staff console restyled within its policy; and an automated check of the app in Chromium at 360, 768 and 1280 px in the three themes. Every visible sentence lives in a words module, so a later translation changes no screen. The README's The interface says what the browser keeps and when it is cleared, and its Third-party notices names the fonts' and libraries' licences.
- **Line 202** ("context panel with explore and transparency stats"): the context column holds the handle box and How korbat works (a chronological feed, no silent reach reduction, the rules and the transparency page). Popular now left it, since suggestions appear only where the reader goes looking, and Explore stays Home's third tab (decision 14); this amends the 2c design's section 11 too, in its section 20. No panel shows live transparency figures, as 2026-10-19 decided.
- **Line 203** ("one display face for handles and headings"): headings are in the display face, Fraunces; handles are in a mono face of their own, Atkinson Hyperlegible Mono, so look-alike handles differ at a glance (decision 4).
- **Line 203** ("dark-first with a light theme"): three themes, Light, Dim and Dark, and the default is System, which follows the operating system: Light, or Dark (Dim if the reader chooses it) when the system is dark (decision 5).
- **Line 204** ("Character counter"): the counter is a progress ring, which shows the number of characters left near the end.
- **Line 205** ("recent sign-ins"): Settings, Security lists the devices and sessions, two-factor authentication and "sign out everywhere"; a list of recent sign-ins needs an account-side route and is left for later (UI design, section 14).
- **Line 207** ("timeline insert of new posts"): nothing is inserted above the reader while they read. Following and Latest ask for new posts while they are on screen, and new posts wait behind the "N new posts above" pill, which brings the reader to them (decision 7).
- **The owner's decisions (UI design, section 2).** Twenty-two decisions are built as written and flagged for the owner, each with what its alternative costs: English only, with every sentence in a words module and a scan against bare strings (1); the console's system fonts (2); the violet accent (3); the faces, with handles in the mono face (4); the themes, System by default (5); Load more by default (6); new posts shown by the pill alone (7); the reading place kept on the device (8); feeds that open where the reader left off (9); no reader-side cover over a restricted post (10); the chip's words, with the deadline in the sheet (11); the post's controls, Report under More (12); a like in the accent, with no red heart (13); Popular now gone from the context column (14); hiding like, repost and follower counts (15); a title on every screen that never names an account (16); no autoplay setting (17); drafts kept on the device until sent, discarded or the session ends (18); the desktop composer as a one-line card (19); the app's browser check (20); the console's theme by the system alone (21); and monogram avatars until 2d (22). The UI design's section 15 holds the amendments of its dry run.
- **Left for later (UI design, section 14).** Sub-project 5: the keyboard controller and form sheets on iOS and Android, the fonts embedded natively, storage on native for the appearance, the reading place and drafts (a defect to fix, not polish), haptics, the lightbox's pinch and zoom and the toasts' reduced motion checked on devices, state across an Android configuration change, icons and the splash screen, and keyboard shortcuts on the web with their off switch. Sub-project 2d: notifications, uploaded avatars in the monogram's place, mentions as data, share cards with titles and meta served by korbat, help on a first visit, and the author's per-post "hide counts". Elsewhere: a "Restored after appeal" chip and the deadline on the chip (PostModeration grows), reply order and a threaded view, the list of recent sign-ins, a web manifest with a service worker and an offline page (sub-project 4), and translations, before korbat is offered in a home state whose language is not English.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, 3d, UI, the screen-reader fix, the audit batch. Next, in order: 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-27, sub-project 3b (`2026-10-22-import-3b-design.md`)

- **Delivered (section 6a, and section 6, row 3b).** Import from other platforms, in eight tasks: a person brings their own public posts from an X or a Mastodon archive, and from a Bluesky repository only when the owner switches Bluesky on, text only. The archive goes from Settings, Import posts, in resumable chunks of 8 MiB through Caddy and the API into the volume `import-archives`, which no backup reads and which loses the archive once its scan is read, within 24 hours at the latest. A new service, `importer`, with no network, no capabilities, a read-only root and no credentials but each job's per-account key, opens only each source's allowlisted files with korbat's own zip reader and streaming JSON and CAR readers, keeps only the person's own public posts, converted to korbat's plain text, and writes them into a second volume, `import-work`, kept at most 72 hours after the scan. The preview counts what was found and what is left out and why; the person chooses months, replies, long posts and post by post, states that the posts are their own and were public, and confirms. The posts are published in batches through the social module's writers under 3e's predicate, on the profile's Imported tab with a provenance label, never in a feed, and one action removes them again through the author's own deletion path. The account's deletion, purge and export cover imports, the terms gain "Importing posts" and one licence for every post, and staff see the label and the import's size on a case, where an admin can end a whole import with the staff key. Imported images pass 2b's pipeline and 3d's checks behind the owner's switch `IMPORT_IMAGES`, which the API refuses while no matcher is on, so no build imports images today. Migrations 0043 to 0048. The README's Importing posts holds the settings, the volumes, what the import key still allows and the labs.
- **Line 239** ("korbat parses the archive in the worker"): the archive is parsed in a service of its own, `importer`, with the image worker's profile and its own memory, CPU and time limits, so archive work never enters the one queue every upload waits in and no zip, JSON or CBOR parser runs in the process that decodes images (decision 1). Line 243's bucket is the volume `import-archives`, and its signed URL korbat's own chunked upload, as 2026-09-18 foresaw.
- **Line 246** ("Same rules as native posts"): as 3d amended it (2026-10-19, lines 171 and 172: an R1 score opens a finding and withholds one image only where the owner sets it; an R2 match refuses and holds the one upload, and no program removes, suspends or reports), with the stop of decision 18 for imports: the first imported image the matcher refuses stops the whole import before any of its posts is published; the refused upload is held and told as 3d holds and tells any, the other prepared images and the work output are deleted unopened, and no measure touches the account. An imported image whose match does not act is not published at all, one whose check is not answered within 24 hours is left out (decision 19), and images are imported only while a real matcher is on (decision 15). Text is never removed by a program.
- **Line 248** (the "verified import" mark): not built (decision 7). Checking a code in the other profile's bio is a fetch by handle, an outbound request to any instance or host, and a public, verified link between a pseudonymous account and a named one. Imports of someone else's archive are met by the person's statement, reports under R6, the label's plain words and an admin's end of a whole import. The label reads "Imported from X, dated 3 Mar 2019", and the paragraph it opens says that korbat did not check who wrote the post or when (decision 6).
- **Line 251** ("Imported posts appear on the author's profile in original date order"): on the profile in a tab of their own, Imported, after Posts and Replies, newest first by the archive's date, and never in Following, Latest, Explore or the Posts and Replies tabs (decision 8). A post's `created_at` stays korbat's time of publication, and the archive's date is a column of its own (decision 9). Anyone may repost or quote an imported post, one deliberate act at a time (decision 23).
- **Line 257** (`original_url` among the new columns of `posts`): not stored (decision 5). On each imported post korbat keeps its source, the archive's date, whether it was shortened, the import it came from and, for finding repeats, a hash of the source post's id keyed by a random key of the account's own, erased with the account; never a handle, account id, instance, DID, link or source post id. The hash is still a pseudonymous id to whoever holds the database or a backup of it, which the README says.
- **The owner's decisions (3b design, section 2).** Thirty decisions are built as written and flagged for the owner, each with what its alternative costs, and seven of them for counsel too, which the README's Counsel's list holds: the importer as a service of its own (1); korbat's own zip reader (2) and chunked upload (3); the two volumes in no backup and how long anything lives (4, counsel); what korbat keeps of the source (5); the provenance label (6); no verified import mark (7); the Imported tab (8); `created_at` as the time of publication (9); which posts can be imported (10); the images of sensitive posts left out (11); posts with a content warning left out unless chosen (12); long posts left out or shortened (13); the person's statement (14, counsel); images only behind a real matcher (15, counsel); a switch for each source, Bluesky off (16, counsel); the worker unchanged and fed two imported images at a time (17); a refused image stops the import (18, counsel); unanswered checks wait 24 hours (19); images only with a description (20); the limits of an import (21); undo through the author's deletion path (22); counts and reposts (23); repeats skipped by a per-account key (24); the import's record (25, counsel); the archives refused today (26); the parsing libraries (27); what the import screen says first (28, counsel); no new public figure (29); and an admin's end of a whole import (30).
- **The dry run's flags for the owner.** Migration `0048_import_staff_end.sql`, which the design did not name: `import_jobs.staff_case_id` and `staff_decision_id`, and `import_ended_by_staff` among the actions `append_confirmed_audit` confirms, with `gap_close` closing a lost end's gap after a restore; the app's JavaScript cap raised from the 1222b87 baseline plus 80 KB to plus 120 KB (832,257 bytes gzip) for the import screens; and `scannedAt` on the import's view, left open, so the preview prints a lower bound of the time it is kept until. The 3b design's section 15 holds the amendments of its dry run.
- **Left for later (3b design, section 14).** More sources (Threads, Instagram, Facebook and Reddit) as adapters; Bluesky's images from a second archive of blobs, each checked against a kept post's CID; Mastodon's `.tar.gz` archives and X archives in parts; the allowlisted zip built in the browser, so that X's messages never leave the device; an edit of image descriptions after posting; self-quotes as korbat quotes; the native file picker and background upload (sub-project 5); a second worker or lane for imported images if the host's measurements ask for it; 2d's mention parser skipping imported posts and its share cards showing the label; and sub-project 4's section on imports in the privacy policy, the impact assessment, per-address limits tuned with Cloudflare's rules, and the restore drill confirming that the two import volumes are absent from backups.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, 3d, UI, 3b, the screen-reader fix, the audit batch. Next, in order: 2d engagement, 4 hardening, 5 native builds.
