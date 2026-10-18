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

## 17. Changed by 1c (2026-09-27)

The email change's undo (section 7.3, and the review fixes of section 16) now runs the lockdown of `docs/superpowers/specs/2026-09-25-passkeys-1c-design.md`, anchored at the change: it clears the password whenever it runs (a password set before the change survived the 1b undo), removes passkeys and two-factor authentication set up since the day before the change, and signs out every device as well as every session. The link is checked before it is spent. The account's deletion removes its passkeys; the export lists their names and dates, and names each session by its handle instead of the token's hash. Email change, deletion and their confirmations need level 2 on an account with two-factor authentication.

## 18. Changed by 3c (2026-10-09)

`docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` (moderation cases) changes the export, the deletion and what an old handle names. The account module reaches moderation through `ModerationForAccount`, an optional member of `createAccount` that `apps/api/src/index.ts` passes.

- **The export's member (section 7.5).** `export.json` gains a last member, `moderation`, from `ModerationForAccount.exportFor(userId)`, read before the archive's first byte: `decisions` (each decision about the account that its Cases screen lists, with its id, day, kind, outcome, ground, rule and version, its measures and reversals, and its facts, reason and legal reference while korbat holds them, and the appeal's state and result) and `reports` (the account's own reports while their record is kept: reference, time, ground, rule, category, the explanation while held, and for each item its position, its link and, once released, its outcome in the words the list shows, and whether a re-examination is open). Never another person's report, a reporter, a notifier or a staff handle; nothing a screen does not show is exported. The format stays `korbat-export-1`: the member is additive, as 2c's was. An account module built without the moderation module writes the member with two empty lists.
- **No sealed image in the export (section 7.5).** A post whose images are sealed is exported with its text and without those images, in `posts[].media` and in the files; a post an R4 redaction erased has its blanked body and no media; images of posts the account deleted, which a case or a freeze may still keep, are in neither. The export reads each image's row again when it opens the file, so an image sealed while an archive streams is listed under `missingMedia`, the same answer as for a row deleted meanwhile.
- **The purge takes its posts in id order and its images last (section 7.6, step 2).** Right after the profile's lock, `purgeProfile` locks every post of the account in id order, deleted ones included, then adjusts the reply and quote counters, then writes the tombstones. An intake locks the posts it names in id order too, and the counters write the posts that the account's posts reply to or quote, which for a self-reply or a self-quote are its own, deleted ones included: with the counters first, or with only live posts locked, the purge deadlocked in the lab with a notice of child sexual abuse material that named the account (PostgreSQL ended the purge each time, and the purge job finished it within five minutes). `purgeOwner` runs as the last act of the transaction and takes the owner's image rows in id order with no filter of its own.
- **Deletion leaves held evidence (section 7.6, steps 2 and 3).** The trigger `post_media_keep` skips every image row that a case holds or that a freeze keeps, so `purgeOwner` returns no id for it and no deletion is requested for its files; kept images are served, listed and exported to nobody, and the retention job deletes them once nothing retains them. The author's own deletion of a post behaves the same. Open cases about the account or its posts go on and are decided on their snapshots: their measures are recorded and change nothing anyone sees, and the statement's mail finds no address. Statements are erased 12 months after the deletion.
- **Reporters forgotten (section 7.6).** Between `purgeProfile` and `finishPurge` the purge calls `ModerationForAccount.forgetAccount(userId)`, which runs `forget_reporter`: the account's reports and notices keep being handled, with nothing left that says who sent them. It acts only on an account whose auth row the take-down marked deleted and changes nothing when run again.
- **The take-down's mark is the database's time (section 7.6, step 1).** Migration 0018's trigger `users_deleted_mark` makes a `deleted_at` that `korbat_auth` sets from null the transaction's `now()`, whatever value was supplied, and refuses to clear or change one that is set, so code running as the API cannot back-date a live account's mark to erase its statements or forget its reports.
- **An old handle (section 7.2).** "No redirect from an old handle" holds everywhere but one place: on the path for child sexual abuse material a report or a finding that names a handle the account has left resolves to that account, through `handle_history`, which reserves the handle for it, so no such report about anything that exists is answered automatically. On every other ground an old handle names nothing.
- **A report shows back the handle as it was named (section 7.2).** An account item stores the handle as the report named it (`named_handle`), and the receipt, the status page, the mails, the reporter's list and the export build the item's link from it, never from the handle the profile holds now: a report never tells its sender where an account went.

## 19. Changed by 3e (2026-10-12)

`docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md` (account sanctions) changes the profile edits, the handle change, the badge, the export, the deletion and `grant-role`.

- **A suspended account edits nothing of its own (sections 7.1, 7.2 and 7.4).** Profile edits, the handle change and the badge's start and verify refuse a suspended account with `account_suspended` (403). The refusal of a profile edit is whole: a suspended account must not rename itself, so it also cannot blank its own bio, and its ways to erase are deleting posts and deleting the account (flagged for the owner in 3e's section 2).
- **Retired handles (section 7.2).** The handle change and onboarding refuse a retired handle to everyone, its former holder included (`handle_retired`, 409), and a handle that begins with the reserved prefix `retired_` (`handle_reserved`, 400). A retirement clears `handle_changed_at`, so the holder may choose a new handle without the 30-day wait (at once, or when a running suspension ends). "Handles you used before stay yours" holds except for a retired one.
- **The export (section 7.5).** The member `moderation` gains, after `strikes`, `standing` (the account's suspensions, terminations and reporting measures with their basis, days, times, lift and broken basis), `replies` (its replies to them, the text while korbat holds it) and `reporting` (its own reporting counts: the frame, the rule reports of each day, each mark by its own report's reference and position, the marked reports in the frame). The profile gains `retiredHandles`, each of the account's own handles that korbat retired and that are still retired, with when: `handleHistory` stays a list of plain strings, so the time is told beside it rather than on its entries.
- **Deletion and termination (section 7.6).** Deletion is never refused or delayed by a suspension, a termination or a seal (flagged in 3e's section 2). A termination runs this design's take-down once it is final for the person and no appeal and no reply is unanswered: the purge round first calls the moderation module's `takeDownDue`, which holds the account's profile and the terminating decision while the auth module's `takeDownTerminated` takes the account down as `confirmDeletion` does and then mails `termination_final` in place of `account_deleted`. That step has a try of its own, and its failure never stops the round's ordinary deletions; `PurgeReport` gains `terminated`. `purgeProfile` locks the profiles whose counters it writes before any post (3e's section 5). The purge's `forgetAccount` also deletes the account's reporting counts (marks and daily tallies).
- **`grant-role`.** It refuses to promote an account that holds a suspension, a termination or a restriction of reporting that stands and has not ended: `changeRole` answers `"standing"`, and the command prints why, changes nothing and exits 1.

## 20. Changed by 3f (2026-10-17)

`docs/superpowers/specs/2026-10-09-authorities-orders-3f-design.md` (authorities' orders, the alert channel, records to authorities and recovery) changes the purge, the deletion mail, the export and the deletion screen.

- **7.6 and success criterion 3** (`finishPurge` overwrites the address; a half-finished deletion is completed within five minutes): holds, except while a report to the authorities is owed for the account. `finishPurge` becomes two statements, in one transaction: the first, unchanged in its time, clears the password hash, the TOTP secret and the phone hash at once; the second, which overwrites the address and sets `purged_at`, waits until the report is recorded as sent or declined, at most seven days. Everything else runs as before. `REPORT_HOLD=off` (`API_REPORT_HOLD` in `infra/.env`) restores 1b's behaviour.
- **7.6 and the mail `account_deleted`:** its sentence "Your posts, images and profile are gone" becomes, for every account, "Your posts, images and profile are gone, except what the law obliges korbat to keep for a time (Terms, Your data)": a post preserved under an order outlives the account, and a wording for that account alone would tell what a non-disclosure decision forbids. When the address is held the mail gains one paragraph, before "This cannot be undone.", in one of two variants by the seal that holds the record.
- **7.5** (the export): a disabled post and its images are left out, with no line that says so; an order's notice is in `moderation` once its author was told, and so is every decision that was held with it, never before.
- **7.6** (posts become tombstones): a post preserved under an order keeps its row, its text and its images through its author's deletion and the account's purge, until its preservation ends.
- **9** (the deletion screen): gains [delete.hold], which names both things the law can make korbat keep.
