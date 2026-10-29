# korbat hardening and launch (sub-project 4): design

Status: approved for the dry run under the owner's standing instruction to finish the app (2026-10-20); decisions marked (owner) in section 2 were made by the orchestrator and can be changed by the owner, and those marked (counsel) need a lawyer's confirmation before korbat is opened to the public. Sub-project 4 has two halves: 4a, what korbat builds, tests and replays; 4b, the kit the owner applies, tracked in docs/launch/checklist.md, where a step is "prepared" when its file and test exist and "applied" only when the owner writes its date. Inputs: the main design's row 4, every item the earlier designs leave to 4, the 2026-09-30 assessment's open defects re-checked, the code at the time of writing, and official sources for the tools and the law. One review round (build fit and security; the owner's kit, privacy and law) shaped this text.

Inputs, as cited: korbat-scratch/research-4/inputs.md ("inputs N"), the main design
docs/superpowers/specs/2026-09-03-korbat-design.md ("main design"), and the designs of 1a, 2b, 2c, 3c, 3d, 3e, 3f, the
audit, the UI sub-project, 3b and 2d in the same folder (2d's is 2026-10-22-engagement-2d-design.md, "the 2d
design"), both built before 4. Paths are relative to the repository root C:/Users/Lenovo/Desktop/cool/korbat unless
they start with korbat-scratch. Written against main at 0bc2dcc and checked against 3b's and 2d's code
(main at fc7c730); committed before Task 1 as
docs/superpowers/specs/2026-10-26-hardening-launch-4-design.md (section 13).

## 1. Context and scope

### 1.1 What the owner asked

The main design's row 4 reads: "Cloudflare WAF/rate rules tuned, ZAP scan clean, dependency audit clean, log
scrubbing verified, IP-hash purge job, alerting, backup/restore drill, privacy policy + terms, external pen-test
checklist walked". It depends on 3, 3b and 2d. Earlier designs added 27 items to it (inputs 0.2, L1 to L27), and the
assessment of 2026-09-30 left ten defects, of which seven are still open and one is partly fixed at 0bc2dcc (inputs
0.3, D1 to D8). On
2026-10-20 the owner said "finish the app". The owner is not asked questions: this design decides, and lists in section
2 every decision the owner might want to change.

### 1.2 The idea in one paragraph

korbat cannot launch itself. It needs the owner's domain, Cloudflare account, phones, a second machine, a pen tester
and a lawyer. What korbat can do is make every one of those steps small, precise and checkable, and do everything else
itself with evidence: fix the open defects with tests, put the supply chain under gates that fail loudly, scan the
scratch stack with ZAP, prove that no secret and no raw address reaches a log or a table, take and restore an
encrypted backup in a recorded drill, raise alerts for the failures nobody watched, and write the edge rules, the
privacy texts and the pen-test scope as files with tests. The one launch checklist names each step left to the owner
with the file it uses, the check that shows it was done and what to do when the check fails. Nothing is described as
done that korbat did not do and verify.

### 1.3 Two halves: 4a and 4b

- **4a, korbat alone.** Every task of section 13. It is dry-run in the scratch clone, reviewed once and replayed into
  the repository like every earlier sub-project. It includes the files of the owner's kit, each with a test that runs
  in CI or on the scratch stack: a file of the kit is "prepared" once its test passes.
- **4b, the owner's kit applied.** No task of korbat. The owner applies the kit on their own schedule, following
  docs/launch/checklist.md, and writes the date in its "Applied" column. korbat never writes "applied" itself
  (decision 2).

The split keeps 4a finishable and replayable, while 4b's steps cannot be done by korbat at all (inputs 4, Q1).

### 1.4 In scope (4a)

- **The open defects** (section 4): the second-factor cap (D1), auth limits per network (D2), the email-code lever
  (D3), the tunnel's guard and runbook (D4), the reconcile's page size (D5), the errno in logs (D6), and per-network
  limits on new accounts' likes, reposts and follows (L9).
- **The supply chain** (section 5): pnpm 10.34.7 (D7), the upgrades, an audit gate with an expiring acceptance file,
  osv-scanner, gitleaks over the history, Grype and Syft on every image, the worker's PIE check (L5), and the
  integration suite in CI (D8).
- **The scans** (section 6): ZAP's baselines on the scratch stack's three sites, an authenticated one, an active scan by
  hand, a rules file with a verdict and reason for every alert, and the leak check.
- **Logs and addresses** (section 6.5): one scrubber, request lines that name the route's pattern, PostgreSQL's log
  settings, logs kept 14 days, and an IP-hash key that lives only in memory and changes every 30 days (L1's open half).
- **Backups and restore** (section 7): an encrypted daily backup of the database, `media-store` and the settings,
  pruned after 30 days; the erasure journal replayed after a restore; the drill (L3, L7, L14, L23).
- **Alerting** (section 8): four new alert kinds on the outbox and an outside heartbeat for the second machine.
- **The edge** (section 9): the Cloudflare rules and zone settings as JSON, an apply script, and a from-outside check
  (L4, L15's checklist, L22, L26).
- **Owner-scoped rows, phase one** (section 4.8): `bookmarks`, `mutes`, and 2d's two tables (L6, L24).
- **Privacy** (section 10): a data map tested against the schema, `/privacy`, the record of processing, the impact
  assessment drafts, the breach and requests runbooks, the storage statement, and a new terms version's notice (L2,
  L11, L12, L13, L21, L25), all "draft for counsel".
- **The pen-test kit and the launch checklist** (section 11): the scope, the ASVS 5.0.0 mapping walked against the
  code, the tester's seed, one counsel list and one launch checklist.
- **Migrations** after 2d's last, 0053_avatar_moderation (0054 to 0058): two enum values, the backup record, the alert
  kinds and an index, the owner-scoped policies, and the terms' acceptances and notices.

### 1.5 The owner's kit (4b)

What korbat prepares in 4a and the owner applies, each a line of docs/launch/checklist.md:

- the Cloudflare zone: the tunnel and its three hostnames, the rules (infra/cloudflare/), the zone settings, the edge
  lab of README "The edge", and the from-outside check;
- the backup target: the second machine, the age key pair, the pull of the backups, the restore drill once on the real
  server with the keeper's copy (`restore-drill.mjs --server`; README item 11 and 3d's A3);
- the heartbeat on the second machine, always on and on another network and power supply, and its weekly mail;
- the pen test: hiring, a separate staging stack, the tester's accounts, accepting the scope and deciding on the
  findings;
- counsel: the review of the terms, the privacy page, the record, the impact assessments and every question of
  docs/launch/counsel.md;
- the processors' contracts (Cloudflare, the server's host, the mail relay, the IMAP host, Vonage if the badge is on);
- the facts only the owner has: the establishment, the legal form, staff and turnover, the supervisory authority.

### 1.6 Out of scope, and where it goes

- **Nonce-based CSP for the app's styles** (L8). Not built: React Native Web writes inline style attributes, which no
  nonce covers; scripts stay `'self'` only (decision 29).
- **Later tasks** (section 14): owner-scoped rows beyond phase one, pnpm 11, a linter (decision 17), container
  restarts as alerts (8.3), the web manifest and offline page (L20, to sub-project 5, decision 42), and what waits for
  the owner's choice or counsel's answer (L16 to L19), whose questions the counsel list carries.
- **Anything on a live site.** korbat's agents never scan, probe or load-test the owner's hostnames. The owner runs the
  from-outside check, and the pen tester tests staging.

### 1.7 Rules this design keeps

- **Evidence first.** Every check this design adds runs on the scratch machine or stack, and in CI, with an expected
  result; korbat claims no CI run it cannot see (5.7). "Clean" is defined for each gate (sections 5.3, 6.3, 6.6).
- **Self-owned.** No third-party service in korbat's runtime. Every tool runs locally or in CI from an image pinned by
  digest, with its update checks and telemetry switched off. No AGPL tool is used, even outside the runtime (decision
  16).
- **Supply chain.** Every npm version is an exact pin at least 7 days old on the day it is resolved
  (scripts/check-lockfile-age.mjs); every image is pinned by digest; no GitHub Action is used by tag.
- **Privacy.** Nothing this design adds stores a raw address, a code, a token or a password. The new alert kinds carry
  counts and times only, as the outbox's check requires. The data map is the single source of every privacy sentence.
- **Migrations.** Hand-written SQL where needed, row-level security and grants as every earlier sub-project; no
  existing migration is edited; 3b's and 2d's migrations come first.
- **The hard gate stays.** README "Before going public" keeps its gate, which gains one line: every owner line of
  docs/launch/checklist.md has a date.

## 2. Decisions flagged for the owner

Each decision is made and built as written. The owner can change any of them; the alternative says what changing it
costs. All are marked (owner); those a lawyer should confirm are marked (counsel) as well.

### 2.1 Scope and words

1. **Two halves (owner).** Chosen: 4a, everything korbat builds and verifies (section 13's tasks, the kit's files with
   their tests), dry-run, reviewed once and replayed; 4b, the owner applying the kit, with no task of korbat's and
   tracked only by docs/launch/checklist.md. Alternative: one sub-project that ends when the owner has applied
   everything; it could never be replayed or closed by korbat, and its open lines would hide 4a's finished work.
2. **"Prepared" and "applied" (owner).** Chosen: a step of the owner's is "prepared" when korbat's file for it exists
   and its test passes, and "applied" only when the owner writes the date in the checklist's "Applied" column. korbat
   never writes that column, in the checklist, the README or a commit message. The hard gate of README "Before going
   public" gains the line "every owner line of docs/launch/checklist.md has a date". Alternative: "done" for both,
   which would let a prepared file read as a configured zone.

### 2.2 The defects and the limits

3. **The second-factor cap (owner).** Chosen: wrong second-factor codes (TOTP or recovery code) from devices the
   account does not know count per account in a window of 24 hours that starts at the first failure, spent atomically
   before the code is checked; at 10, new devices' second-factor step is refused with `too_many_attempts` until the
   window ends; at the 5th failure the account is mailed once per window (`mfa_failures`, section 4.1), and
   `mfa_capped` is recorded at the 10th. A known device (a live device of the account, or a live session
   re-authenticating) counts only its own failures (10 a day) and is never stopped by the cap, recovery codes included;
   a password change, a passkey sign-in or a known device's correct code clears it. The ticket's 5 attempts stay; a
   user-verified passkey still signs in. Over a year an attacker who holds the password but no device of the account
   makes at most 3,650 guesses, about 1 % odds against a 6-digit code accepted in three time steps, and the owner is
   told on the first day. Residual risk: whoever holds the password can pause new devices' codes a day at a time, and a
   person with no known device and no passkey then waits out the window; the mail says until when and what still
   works. Alternative: reuse the password lockout (5 failures, 15 minutes), which allows 480 guesses a day; a cap of 5,
   which typing mistakes would reach; or a cap for every device, which hands a known password a renewable lock-out.
4. **Auth limits per network (owner).** Chosen: every per-address limit of the auth module (13 keys, inputs 0.3 D2),
   the global limit and the image files' bucket count per network: an IPv4 address, or the first 64 bits of an IPv6
   address, as 3c's notice limits already do (apps/api/src/auth/client-ip.ts, `clientNetwork`), at ten times today's
   per-address numbers (section 4.2), since such a network is a carrier's NAT or a campus LAN shared by strangers; the
   secrets stay bounded per account and by Turnstile. A device the account already knows is looked up first and never
   spends its network's budget. Stored hashes (`devices.ip_hash`, `auth_events.ip_hash`) stay per address.
   Alternative: two buckets per limit, one per address at today's number and a higher one per network, a second
   Valkey call per limit and a second number to publish for each; or today's numbers per network, which lets anyone on
   a shared network stop everyone's sign-in.
5. **The email-code lever (owner).** Chosen: the hourly count of codes sent to one address (3, `email-start:email`)
   counts per address and network; across networks an address gets at most 10 codes an hour; a request from a device
   the account already knows (its `deviceId` matches a live device of the account) is looked up before any network
   limit and counts only in its own bucket (address and device, 3 an hour), never in the network's or the ceiling. The
   email change counts in the same address-and-network bucket and ceiling for the new address, never as a known
   device. So one network cannot stop an address's code sign-in, ten networks can stop only unknown devices, and a
   known device gets its three codes an hour whatever anyone else does. Alternative: keep 3 an hour per address:
   anyone who knows an address stops its code sign-in for an hour at a time, for ever.
6. **The tunnel's guard (owner).** Chosen: Compose passes `TUNNEL` to the API as `EDGE_TUNNEL`, and in production the
   API refuses to start with `API_TRUST_PROXY=none`, with `TUNNEL=on` and anything but `cloudflare`, and with
   `TUNNEL=off` and anything but `caddy`. Since Compose does not rebuild Caddy when `TUNNEL` changes, Caddy also
   stamps every request with the `TUNNEL` it was built with, and `/api/health` answers `degraded` when that differs from
   the API's (section 4.4). The stale Foundation Task 16 prompt is superseded by a new README section, The tunnel.
   Alternative: the start-up refusal alone, which a Caddy image left unrebuilt passes while every person shares one
   network.
7. **Per-network engagement limits (owner).** Chosen: likes, reposts and follows of accounts younger than 48 hours
   (the line 2c's tiers draw) also count per network, at three times one established account's numbers: 300 likes, 90
   reposts and 150 follows an hour, and 1,200 follows a day. Established accounts keep their per-account limits only,
   so people behind one carrier's NAT address or campus /64 do not share a bucket. Undo actions stay unlimited. A crowd
   of fresh accounts on one network then cannot like a post into Explore faster than three real accounts; an attacker
   with many networks is bounded by account age and Turnstile, not by this limit, as README "Posting and feed" says.
   Cost: new people on a shared network still share the bucket in their first two days. Alternative: every account per
   network, which caps whole carriers and campuses; or per account only, as 2c left it.
8. **Like counts after a block (owner).** Chosen: unchanged. A block deletes both accounts' likes of each other's
   posts (2a), so a person who blocks someone may see the like counts of their own posts drop and learn which of them
   the other had liked, although likes are private. The privacy page's likes line says so to the person who likes ("an
   author who blocks you can see their counts change"), and the block's confirmation adds one
   sentence ("A block removes each account's likes of the other's posts, so like counts can change"). Alternative: keep
   the likes and count around them; every count and Explore's approvals would then depend on block state, a larger
   change than the leak it closes (L10).
9. **Owner-scoped rows, phase one (owner).** Chosen: row-level security by owner on `bookmarks` and `mutes`, whose
   every access is their owner's own request, a job or a security-definer function (such as `staff_case_conflict`,
   which the migrator owns and which still sees every row), and on 2d's `activity_items` and `activity_state` under
   section 4.8's rule: each of their statements that acts for another account than the viewer runs as a job (the
   fan-out's read of a recipient's mutes among them), and a
   table that would need more than five such statements waits for a later phase. A statement counts once however many
   flows call it, so `activity_items` (five such statements) and `activity_state` (two) take the policies now, the
   retention and the purge running as the jobs they already are. The API sets
   `korbat.viewer` with `set_config(..., true)` in a transaction for those reads and writes, jobs set `korbat.job`, and
   a forgotten wrapper reads no row instead of another person's. Every other table keeps `USING (true)` for now, each
   listed with its reason in the ASVS mapping (V8). This guards against a route that forgets its owner clause, not
   against SQL injection, which could set the same setting. Alternative: all tables at once, which touches every
   repository and every job in one task; or none, which leaves the main design's promise (line 138) unmet for the
   lists that are private by nature.

### 2.3 The supply chain and CI

10. **pnpm 10.34.7 now, pnpm 11 later (owner).** Chosen: `packageManager` and CI's `pnpm/action-setup` move to
    10.34.7 (2026-10-12), the newest 10.x past the floor, which carries every fix of pnpm's 19 advisories published
    since 10.30.0, among them the hoisted install's (fr4h; korbat installs hoisted). pnpm 11 (`pnpm sbom`, renamed audit
    settings) is a task of its own after 4. Alternative: 11 now; it changes the audit configuration this design builds
    on, in the same task.
11. **What "dependency audit clean" means (owner).** Chosen: `node scripts/audit-gate.mjs` passes only when every
    advisory either source reports (`pnpm audit --json`, osv-scanner on pnpm-lock.yaml), of any severity, is named by a
    complete, unexpired entry of security/accepted-advisories.json (why it is unreachable at runtime, a reviewer, an
    expiry at most 90 days on), no entry is stale, and no accepted high or critical advisory has a fix (section 5.3).
    Today node-forge and braces have no fix, so "zero advisories" is impossible (inputs 1.3). Alternative:
    `--audit-level high` as today, which already fails and hides every moderate advisory; or zero at any level, which
    cannot pass.
12. **Transitive fixes by override (owner).** Chosen: where a fixed version exists and the parent has not moved, an
    exact pnpm override lifts it (shell-quote 1.11.x, brace-expansion 5.0.12 or later, source-map-js 1.2.2 or later),
    each past the floor and each named in README "Dependency audit"; postcss-selector-parser 7 under tailwindcss, a
    major step, is overridden only if the web export and the app's browser check pass with it in the dry run, and is
    otherwise accepted with its reason (build time only). Alternative: wait for each parent's release; the critical
    shell-quote advisory would stay open for an unknown time.
13. **The scanners (owner).** Chosen: osv-scanner (Apache-2.0) on the lockfile at every push; Grype (Apache-2.0) on
    every image Compose names and Syft (Apache-2.0) for the SBOM each week; each an image by digest, the newest release
    at least 7 days old when Task 1 resolves it. Trivy is not used: after its compromise of March 2026 one tool family
    fewer is one trust decision fewer. Alternative: Trivy for all three, one tool where korbat would use three.
14. **CI cadence (owner).** Chosen: at every push and pull request, the jobs `checks` (with the audit gate and
    osv-scanner), `integration`, `semgrep`, `secrets` (gitleaks) and `docker` (with the worker's PIE check); each
    Monday at 04:00 UTC and on demand, a workflow `assurance` that builds the stack in the job and runs the image scan,
    the SBOM, ZAP's baselines, the leak check and the restore drill. korbat cannot see a run of the private
    repository, so it runs each job's commands on the scratch machine and claims no CI result; the owner confirms the
    first green runs and their minutes, which the monthly allowance bounds (section 5.7). Alternative: everything
    nightly, about seven times the minutes; or everything per push, which makes each push wait for a stack.
15. **The integration suite in CI (owner).** Chosen: a job that starts PostgreSQL 18.6, the two Valkeys and Mailpit
    with the development Compose files and pinned digests, then `node scripts/test-db.mjs` and the suite with the
    scratch runner's retry and timeout, the three sign-in timing tests in a retried step of their own (section 5.7).
    Alternative: keep it on the developer's machine only, as today (D8), where it never runs on a push.
16. **Secret scanning without AGPL (owner).** Chosen: gitleaks 8.30.1 (MIT) by digest over the whole git history at
    every push, with .gitleaks.toml extending the defaults and allowing only the repository's named test fixtures.
    TruffleHog is AGPL-3.0 and verifies keys by calling live services; korbat's rule against AGPL is read as covering
    tools too. gitleaks is in security-fixes-only mode, so Betterleaks (MIT) is looked at once it leaves release
    candidates (section 14). Alternative: TruffleHog in its own container, which is not linking, but asks the owner to
    read the rule more narrowly.
17. **No linter in 4 (owner).** Chosen: none. The static gates stay the strict TypeScript typecheck of every package
    and semgrep's three rule sets. A linter added now would raise findings across the 998 source files of
    main at fc7c730 (856 at 0bc2dcc),
    whose triage is a sub-project of its own. Alternative: Biome (MIT/Apache-2.0, one binary) with only its
    recommended correctness rules; a task of its own after 4 (section 14).

### 2.4 The scans, logs and addresses

18. **What ZAP scans (owner).** Chosen: the scratch stack only, in development mode and throttled under the API's
    limits: the passive baselines of the three sites (Caddy's 8080, 8090 and 8091 on the stack's network) and an
    authenticated one of the app's site, at Tasks 8 and 13 and weekly in CI; and an active scan over every route and
    method, run by hand on a scratch stack before each release candidate and for the pen tester. What only production
    adds (the guards of apps/api/src/config.ts, HSTS over real TLS, the edge) is listed in section 6.4 and is the pen
    tester's. Alternative: a production-mode stack with a self-signed certificate; it changes Caddy's TLS model only
    for a test (inputs Q15).
19. **What a clean scan is (owner).** Chosen: infra/zap/rules.tsv gives every alert id ZAP has raised on korbat a
    verdict, FAIL or IGNORE, and every IGNORE a reason; an alert with no verdict is a warning, and the script treats
    ZAP's warning exit (2) as a failure, so a new kind of finding always stops the gate until a person has judged it. A
    scan is clean when every site's run exits 0, at most 1 % of its answers were korbat's 429 (ZAP runs throttled under
    the API's limits), and the authenticated run still reads the account at its end.
    Alternative: ZAP's defaults, where every new alert is a warning that passes.
20. **The leak check (owner).** Chosen: after the smoke test on a scratch stack, scripts/leak-check.mjs searches every
    container's log and a plain dump of the database for what the run used: its emails, handles, codes, passwords,
    session and CSRF tokens, post texts and the addresses it sent. A log may hold none of them; the database may hold
    its emails, handles and texts where they belong, and no code, token, password or client address. It runs at every
    stack task from Task 4 on, and weekly. Alternative: the logger's unit tests alone, which prove the function and
    not the stack (inputs 1.4).
21. **Request lines name the route, not the path (owner).** Chosen: the request line logs the matched route's pattern
    (`GET /api/profiles/:handle`) instead of the path, so no handle, post id or token in a path reaches a log. The
    request id and `cf-ray` still tie a line to a report. Alternative: the path, as today and as 2d's 11.1 expects;
    every handle that was looked at would then sit in the logs for as long as Docker keeps them.
22. **The IP-hash key lives in memory (owner, counsel).** Chosen: the key that turns an address into a hash is
    random, made by the API for each period of 30 days, held in the API's memory and in `counts`, the Valkey that writes
    nothing to disk, and never written to a disk, a backup or a log by korbat; `API_IP_HASH_KEY` is retired, and a
    backup refuses to run while infra/.env still holds it. Once its period has ended, a hash means nothing to anyone who
    later holds the database, a backup or `infra/.env`: nobody can test a candidate address against it, and hashes of
    two periods cannot be linked. During the period, whoever controls the running server (root, the server's host,
    which can read a rented machine's memory, or someone who seizes it running) can read the key and test that period's
    hashes; the privacy page says so. Rate limits restart at a change of period or a restart of `counts`, and since the
    periods' boundaries can be computed, a sender can double a day's per-network budget once a period. Nothing reads a
    stored hash today but the purge (inputs 1.5), so nothing is lost. Alternative: keep one static key, documented:
    whoever holds the database and the key can test all 4.3 billion IPv4 addresses in minutes.
23. **Valkey keeps its append-only file (owner).** Chosen: `redis` keeps `--appendonly yes`, since the email change's
    revert and the export's state must survive a restart; its limit keys are named by hashes that the key of decision 22
    makes meaningless once its period ends. An expired key leaves the file only at a rewrite, so the auth janitor
    rewrites it daily, and the privacy page says that what `redis` holds stays on disk for at most its window plus one
    day. Alternative: move the limits to a second store without a disk, one more service for little gain (inputs Q18).
24. **PostgreSQL's server log (owner).** Chosen: `log_error_verbosity=terse` and `log_min_error_statement=panic`, set
    on the server's command line in infra/compose.yml, so an error's DETAIL ("Key (email)=(...) already exists") and
    the failing statement never reach the database's log; the API already logs each failed query by its statement and
    SQLSTATE, scrubbed. Alternative: the defaults, and a check of every path that can raise a unique or check violation.

### 2.5 Backups

25. **The backup (owner).** Chosen: a one-shot service `backup` under the Compose profile `backup`, built from
    infra/backup/Dockerfile on the database's own image (postgres:18.6-alpine by the digest infra/compose.yml pins, so
    `pg_dump` matches the server) with a tagged age release's static binary added by checksum. It runs `pg_dump -Fc`,
    then a tar of `media-store`, then copies infra/.env, encrypts each part with age to the owner's public keys
    (`BACKUP_RECIPIENTS`), writes a manifest and records the run in the database; under `set -o pipefail`, a backup is
    good only when `pg_restore --list` and `tar -t` read its streams. A systemd timer on the server starts it at 03:15
    UTC each day. The server holds no key that can read a backup. Alternative: restic, which does encryption,
    deduplication and pruning in one tool but adds a repository format and a key the server must hold to prune.
26. **The off-box copy (owner).** Chosen: the owner's second machine pulls new backups over SSH each day, with a key
    that can only read the backup folder (rrsync), never overwrites or deletes a copy it holds because the server lost
    it, and prunes by the same 30-day rule on its own. The server holds no credential for the second machine or any
    store, so whoever takes the server can neither read nor delete the copies.
    Alternative: an EU object store; a processor of its own, and credentials on the server that a thief would hold.
27. **A backup kept for an authority (owner, counsel).** Chosen: the owner marks it with a file `KEEP` in its folder,
    holding the order's `legal_orders` id (never a person's name) and an end date no later than the authority's
    period; the pruning skips it on both machines until that date, or a later one written on renewal, and the heartbeat's
    weekly mail names every `KEEP` within 14 days of its end. Counsel is asked whether 3f's per-item preservation
    suffices, so that a whole backup is kept only when an authority asks in writing for a point-in-time copy.
    Alternative: a table of kept backups in the database, which a restore from an older backup would forget; or an
    open-ended mark deleted by hand, which keeps everyone's data for one question and is forgotten.
28. **Dump first, files second, erasures replayed (owner).** Chosen: the dump is taken first and the tar of
    `media-store` right after. A file added in between has no row after a restore and is swept as an orphan; a file
    deleted in between leaves a row without a file, which the restore's check lists by id and count. Every erasure is
    also written, ids only, to a journal beside the backups and outside them, and after a restore the lines newer than
    the backup are replayed before the site opens, so no erased account, post (an undone import's among them) or
    profile picture comes back (section 7.1). The drill
    measures both on the scratch stack. Alternative: close the site for each backup, a nightly outage; or tar first,
    which loses every upload made during the dump.
29. **The app's styles keep `'unsafe-inline'` (owner).** Chosen: the app's policy keeps `style-src 'self'
    'unsafe-inline'`, since React Native Web writes inline style attributes, which neither a nonce nor a hash covers;
    `script-src` stays `'self'` and Turnstile's origin, which is what stops script injection. The ASVS mapping records
    it as a deviation with this reason. The console's policy has neither and keeps Trusted Types. Alternative: rewrite
    the app's styling to class names only, a sub-project of its own (L8).

### 2.6 Alerts

30. **Four new alert kinds (owner).** Chosen, each on the existing outbox with counts and times only, to every staff
    phone and mail (thresholds and repeats in section 8.1): `auth_failures` (100 sign-in failures in 15 minutes),
    `server_errors` (20 answers with a 5xx in 10 minutes), `disk_low` (the disk the images and the database share under
    twice the upload floor or 10 % free) and `backup_missed` (no good backup for 26 hours, on by default in production
    only). Alternative: an outside monitoring service, a third party korbat's runtime does not use.
31. **The outside heartbeat (owner).** Chosen: scripts/heartbeat.mjs, run every 5 minutes by cron on the owner's
    second machine (the one that pulls the backups), reads the app's `/api/health` and the console's page and staff API
    through the public hostnames, and the age of the newest pulled backup, prints a line only when something fails or
    recovers, and once a week a "still watching" line, and cron mails those lines through the machine's own mail setup
    to the staff's addresses, whose app rings for that sender (3f's check M). A missing weekly mail is the alarm that
    the watcher itself has stopped; the checklist asks for a machine that is always on, on another network and power
    supply than the server. It needs no service and no account beyond the owner's mail. Alternative: Uptime Kuma
    (MIT) or Healthchecks (BSD-3) as a service on that machine, more to update for the same two checks.

### 2.7 The edge

32. **Cloudflare's Free plan, rules as files (owner).** Chosen: Free, with korbat's own limits as the real ones and
    the edge as a coarse first layer: three custom rules on (scanner paths, the staff API on the app's hostname, methods
    korbat never answers), one prepared and off (decision 33), one left free; the one rate rule on `/api/auth/` and
    `/api/notices`, well above korbat's own limits; Bot Fight Mode off, since it may challenge the API and the native
    apps of sub-project 5 and cannot be scoped. The rules are JSON bodies of the Rulesets API under infra/cloudflare/,
    and infra/cloudflare/apply.mjs validates them offline, shows the difference with a read-only token and applies them
    only with `--apply`. Alternative: a paid plan; the files are written so that it only adds rules.
33. **Serving the home state at the edge (owner, counsel).** Chosen: a country rule is prepared and off: it would
    answer a managed challenge to every request from outside `API_HOME_STATE`. A challenge needs a browser, so for the
    apps of sub-project 5 and the web app's API calls it is a block for everyone abroad, the home state's residents
    included; it costs one of Free's five rules and any VPN passes it, pushing people abroad toward VPNs. The privacy
    page's device and processor sentences follow a build argument, `WEB_EDGE_CHALLENGE`, which the checklist line that
    turns the rule on sets with it. Only the owner with counsel can weigh this against 3f's row 6, and counsel is asked
    whether serving the home state can rest on the terms alone. Alternative: on by default.
34. **Secrets (owner).** Chosen: the keys and passwords stay in infra/.env, owned by root with mode 0600, as the main
    design's line 155 allows; the encrypted backup carries a copy, so a restore needs the owner's age key and nothing
    else. Compose secrets files are not used: whoever can run Docker on the host reads either. Alternative: Compose
    secrets with `*_FILE` settings read by apps/api/src/config.ts, which keeps the values out of `docker inspect`.

### 2.8 Privacy and the terms

35. **One data map, one privacy page (owner, counsel).** Chosen: packages/contracts/src/data-map.ts lists every
    place korbat keeps personal data (tables, Valkey, volumes, logs, the browser, the copies off the server), each with
    its columns or keys, purpose, proposed basis, retention printed from the constants (or an open-ended period with
    its reason) and recipients; a database test fails when a table or a column with personal data is missing from it,
    and an architecture test when a Valkey key prefix or a volume is. `/privacy` is a page of its own, printed from
    the map; the terms' "Your data" shrinks to a pointer and the sentences that belong to the terms' rules. Both stay
    drafts.
    Alternative: hand-written documents, which drift as soon as 3b's and 2d's tables ship (inputs Q11, Q12).
36. **The legal bases (owner, counsel).** Chosen as proposals for counsel, printed on `/privacy` under the draft label:
    the contract (Art. 6(1)(b)) for the account and the service; legitimate interests (Art. 6(1)(f)) for security and
    abuse prevention, the automated tools and the reader count, each with the objection of Art. 21 offered at the
    contact address; legal obligation (Art. 6(1)(c)) for the duties of the DSA and the TCO Regulation and the records to
    authorities (inputs 3.4); for special-category data, Art. 9(2)(e) for what a person published themselves, and a
    stated position for what others post about them and for the automated tools. `/privacy` also says what korbat holds
    about a person from others (Art. 14). Alternative: none printed until counsel answers, which leaves Art. 13 unmet in
    the draft the owner tests with.
37. **A new terms version (owner, counsel).** Chosen: each version is an entry of `TERMS_CHANGES` with its kind, the
    day it is announced and the day it applies, at least 30 days later. Meanwhile every screen announces it, a
    significant change is mailed to every account, and the old terms apply; from that day the new ones do. No write is
    ever refused because of terms: export, deletion, blocking, muting, reporting and appealing never, nor anything
    else. Acceptances, and the notices shown or mailed as such (not as consent), are kept in `auth.terms_acceptances`
    and exported. The first non-draft version ships only after counsel's review; korbat prepares the change as a
    one-line constant. Alternative: refuse writes until a person accepts, which conditions people's rights and their
    safety tools on new terms; or a notice and continued use at once, without the period a consumer needs to leave.
38. **No consent banner (owner, counsel).** Chosen: korbat stores on a device only what the person's own use needs:
    the session cookie, for the browser's session unless the person chooses "Keep me signed in on this device",
    `korbat.deviceId` (security), and the choices and drafts the person made (`korbat.appearance`, `korbat.place.*`,
    `korbat.drafts.*`, the passkey card's dismissal); the privacy page lists each with its reason under ePrivacy Art.
    5(3)'s exemption, and Turnstile's check as read by Cloudflare at sign-up, sign-in and reports, for security.
    Cloudflare's `__cf_bm` and `cf_clearance` are described by a build argument that follows decision 33's rule.
    Alternative: a banner asking for consent to things that do not need it, which trains people to click it.
39. **Impact assessments (owner, counsel).** Chosen: one DPIA for the service as a whole (posted opinions are
    special-category data, people from 16 use it, and it may grow), with annexes for 3d's automated tools, 3b's imports
    and 2d's avatars and cards, drafted by korbat from the data map in the EDPB template's order and signed by the owner
    after counsel. Its risks include those korbat's own architecture creates: Cloudflare's view of all traffic, the
    server's host, one owner with every key, and an account lost for good. The `API_AUTOMATION_DPIA_*` dates name the
    annex's day. Alternative: one per tool only, as README B1 asks, which leaves the service-wide risks unassessed.
40. **Breaches and requests (owner, counsel).** Chosen: docs/launch/privacy/breach.md, the runbook (contain, assess,
    notify the supervisory authority within 72 hours unless the breach is unlikely to result in a risk, in phases if
    facts are missing, tell people where Art. 34 asks, write it down), a register template, the address where
    processors' notices arrive, and three worked cases, with the owner as the person who decides; and
    docs/launch/privacy/requests.md for the rights that arrive at the contact address. Alternative: none until a
    breach, when nobody has time to write one.
41. **Processors (owner, counsel).** Chosen: the privacy page names Cloudflare (the tunnel, the cache, Turnstile, the
    optional purge; it can read what passes, and for Turnstile's own improvement it is a controller of its own), the
    server's host, the EU mail relay, the contact point's IMAP host, Vonage only while the badge is on, and the off-box
    target if it is hosted; the owner signs each one's data processing terms on the checklist line that opens its
    account. Cloudflare's transfers rest on its DPA's clauses, which counsel confirms covers a Free account.
    Alternative: name them later, which leaves Art. 13(1)(e) and (f) unmet.

### 2.9 Launch

42. **The web manifest moves to sub-project 5 (owner).** Chosen: the manifest, the service worker and the offline
    page (L20) move to 5, which brings the app's icons and splash screen: a manifest without icons installs nothing, and
    a service worker meets the `no-store` answers, `index.html`'s revalidation, the edge purge and the policy at once.
    Alternative: a manifest now with a placeholder icon.
43. **The pen test (owner).** Chosen: korbat walks ASVS 5.0.0 level 2 against the code with evidence and fixes what it
    finds in 4a; the owner hires a tester for a staging stack on its own machine, keys and hostnames, built from test
    seed data and never from a production backup, scoped by docs/launch/pentest/scope.md, which keeps the path for child
    sexual abuse material, authorities' mail and other people's data out of every test; korbat fixes the findings in a
    later task and the tester retests. Alternative: the external test first, which pays a tester to find what the
    self-walk finds for free.
44. **One launch checklist (owner).** Chosen: docs/launch/checklist.md is the one ordered list of every step from
    every design that someone must do before korbat opens, each with who does it (owner, counsel, korbat), the file or
    README section it uses, how to check it, what to do if the check fails, and the "Applied" date; the main design's
    row 4 says "4a delivered" and stays open until every owner line has a date. README "Before going public" keeps its
    detailed items, which other texts cite by number, and the checklist points to them; a test fails when a numbered
    item of 3f's and 3d's owner's lists in README has no checklist line (2d's counsel questions are counsel.md's).
    Alternative: move every item into the checklist, which breaks the citations of
    five designs.
45. **The JavaScript cap (owner).** Chosen: 4 adds at most 20 KB (20,480 bytes) of gzipped JavaScript to the web
    export (`/privacy` printed from the data map, `DEVICE_STORAGE`, Keep me signed in and the terms banner). After 2d
    it measures 824,905 bytes, 7,352 under the cap of 832,257 bytes, the baseline of 1222b87 plus 120 KB
    (apps/app/test/browser/app.browser.ts:634-635 and README:462). Tasks 10 and 11 measure the export by the method
    apps/app/test/browser/baseline.json records, and record it (sections 10.2 and 10.6). That method sums every chunk
    of the export, so a lazy chunk saves nothing; past the cap, the task first takes out what it can (its words and
    data are already constants), then raises the cap once to 852,737 bytes, the baseline plus 140 KB, as 2d's decision 27 allowed, by editing those
    two lines and README:462, as an amendment of section 15 flagged (owner), and never above. Alternative: raise the
    cap at once, which spends before anything is measured the margin the next sub-project may need.

## 3. What exists

A summary of inputs.md at 0bc2dcc, with the paths each later section changes. 3b and 2d were built before
4, and what they add is named as their code has it at fc7c730.

- **The edge and the tunnel.** cloudflared 2026.9.1 by digest under the profile `tunnel`, token mode, on the network
  `edge` only; routing lives in Cloudflare's dashboard, and the tunnel was never set up: Foundation Task 16 is open and
  its prompt (docs/superpowers/prompts/foundation/16-cloudflare-tunnel.md) still names `caddy:80` and MinIO (D4). Caddy
  keeps `CF-Connecting-IP` only in an image built with `TUNNEL=on` (infra/caddy/Dockerfile writes cf-header.caddy) and
  matches its sites by port: 8080 the app, 8090 the console, 8091 the push site. The API believes a header only by
  `TRUST_PROXY` (apps/api/src/config.ts, default `none`; apps/api/src/auth/client-ip.ts), with no production guard.
  korbat's own limits are the real ones: the global 300 a minute (apps/api/src/app.ts), the auth flows' per-address and
  per-account limits, the lockout after five wrong passwords, the signed-out notices per /64
  (apps/api/src/moderation/intake.ts), the social writes per account by age (apps/api/src/social/tiers.ts), and
  Turnstile on sign-up, password sign-in and signed-out notices. No edge rule exists as a file.
- **Scans and audits.** CI (.github/workflows/ci.yml) runs the frozen install, the lockfile age check, typecheck, unit
  tests, `pnpm audit --audit-level high`, the builds, the console's browser check, the web export, `docker compose
  config`, semgrep 1.177.0 and the images' build; not the integration suite (D8, 177 files at 0bc2dcc,
  197 with 168 tests at fc7c730). pnpm 10.30.0 is pinned
  (D7); the audit of 2026-10-22 found 1 critical, 7 high, 11 moderate and 1 low advisories, so CI's audit step fails
  today; node-forge and braces have no fix. No ZAP file, image scan, SBOM or history secret scan; the smoke test
  (scripts/smoke-auth-stack.mjs) checks both sites' headers.
- **Logs.** apps/api/src/lib/logger.ts masks emails and addresses and redacts eleven keys, and loses a Node errno (D6;
  apps/api/test/logger.test.ts holds seven cases). The worker, the contact point's watcher and 3b's importer
  (apps/importer/src/index.ts:15) log through plain pino, unscrubbed. One request line per request names the path
  (apps/api/src/middleware/observability.ts). Docker keeps 20
  MB times 5 a container (`x-logging`), by size, not time. PostgreSQL logs with its defaults.
- **Addresses.** The auth janitor (apps/api/src/auth/janitor.ts) nulls `devices.ip_hash` 30 days after last seen,
  deletes `auth_events` after 90 days and `email_codes` 24 hours after use (L1's job exists). One static key,
  `IP_HASH_KEY`, hashes every address (apps/api/src/auth/identifiers.ts); nothing reads a stored hash but the purge.
  `redis` writes its append-only file; `counts` writes nothing.
- **Alerts.** `alert_outbox` with 36 kinds (packages/contracts/src/orders.ts;
  3b added `import_image_flagged`), counts and times only, pushed by
  `notify` through ntfy and mailed by the alert tick (apps/api/src/moderation/alerts.ts); `/api/health`
  (apps/api/src/routes/health.ts). No alert for sign-in failures, 5xx answers, disk space or backups; nothing outside
  watches the host.
- **Backups and restore.** README "Backups" and "Restoring" set rules without code (30 days, `media-quarantine` never
  backed up, the keeper's copy, the releases' replay); `staff.js restore-import`, `release-replay` and
  `head-restore-mark` (apps/api/src/cli/restore.ts) exist; scripts/pg-major-upgrade.mjs is a model for dump and
  restore. No backup script, encryption, off-box copy or drill (L3, L7, L14, L23).
- **Privacy and terms.** Draft terms in apps/app/src/lib/terms.ts (`TERMS_VERSION = "draft-2026-09"`), held by
  apps/app/test/terms.test.tsx, whose "Your data" is most of a privacy notice; the version is recorded at sign-up and
  never asked again (L2); the export (apps/api/src/account/flows/export.ts) answers Art. 15 and 20. No privacy policy,
  record, impact assessment, breach procedure, storage statement or processors list (inputs 1.8); counsel's questions
  are spread over README "Before going public", which since 3b and 2d also holds 3b's decision 28 (its counsel
  paragraph) and the 2d design's six questions of 11.3 (Counsel's review of engagement, numbered 1 to 6).
- **Authorization and the pen test.** Row-level security is on for every table and 80 policies (71 at 0bc2dcc)
  are `USING (true)`
  (packages/db/src/schema/helpers.ts, `fullAccess`); roles and grants do the real work. Much of ASVS level 2 is built
  and tested piece by piece; no mapping, scope or tester's seed. Open: the app's `style-src 'unsafe-inline'` (L8), the
  second-factor cap (D1), auth limits by full IPv6 address (D2), the email-code lever (D3), and the reconcile's single
  `inArray` (apps/api/src/media/repo.ts `existing`; D5).

## 4. The defects fixed

Each fix names the files it changes and the tests that hold it. Unit tests live beside their package's existing
ones; integration tests in apps/api/test/integration/ run against the runner's PostgreSQL and Valkey.

### 4.1 The second-factor cap (D1, decision 3)

- **Where.** apps/api/src/auth/flows/mfa.ts (`verifyMfa`) and apps/api/src/auth/flows/reauth.ts (the TOTP and
  recovery-code branches), through a new apps/api/src/auth/mfa-budget.ts (`spendAttempt`, `refundAttempt`,
  `clearCap`), and `kv.spendUnder` in apps/api/src/auth/kv.ts.
- **Constants.** `MFA_ACCOUNT_MAX_FAILURES = 10`, `MFA_ACCOUNT_WINDOW_MS = 24 * HOUR`, `MFA_ACCOUNT_MAIL_AT = 5`,
  exported from mfa-budget.ts and printed by the privacy page's security paragraph (section 10.2).
- **Known and unknown devices.** A sign-in's device is known when its `deviceId` matches a live device of the account
  (`repo.liveDeviceOf`, 4.3); a re-authentication comes from a live session, so its device is known. Only unknown
  devices meet the account's cap. A known device's wrong codes count in its own bucket, `mfa-fail:dev:<user id>:<device
  hash>` (10 per 24 hours), so nobody else's failures stop it, and its recovery codes stay usable during a cap.
- **The counter.** `mfa-fail:acct:<user id>`, spent before the code is checked by one Lua script, `kv.spendUnder(key,
  max, ttl)`: it answers "refused" when the value is at 10, and otherwise increments it, setting the expiry only when it
  creates the key. So a parallel burst cannot pass the cap, and the window starts at the first attempt and is not
  extended. A correct code refunds its attempt (`DECR`), so only failures stay counted.
- **Order in `verifyMfa`.** The ticket's and the device's lookup; the spend (the account's bucket for an unknown
  device, the device's for a known one): refused, it answers `too_many_attempts` (429; 4.2 adds `retryAt`) and the
  ticket stays as it was; then the code check, beside the ticket's own count. At the 5th failure of a window the
  account is mailed once, with the auth module's new template `mfa_failures` ("Someone who knows your password, or can
  read your email, tried two-factor codes on your korbat account from a device it does not know. After ten, codes from
  new devices pause until {time}; a passkey or a device already signed in still works. If it was not you, change your
  password and check Settings, Security."). At the 10th the event `mfa_capped` is appended with the address hash, once
  per window.
- **What clears it, and what stays open.** A password change, a passkey sign-in and a correct second factor from a
  known device delete `mfa-fail:acct`. A user-verified passkey counts as two factors and never reaches the step (README,
  Passkeys). Re-authentication by password or email code never meets the cap.
- **The new enum value.** `mfa_capped` is added to `auth.auth_event_type` by the first migration of section 4.9, and
  the export's security events carry it by that name, as they carry every other type.
- **Tests.**
  - apps/api/test/auth/mfa-budget.test.ts (unit, the fake key-value store and clock the auth tests use, and a store
    that delays its replies): nine failures over three tickets from unknown devices, a tenth, then a correct code
    refused; accepted 24 hours after the first failure; one mail at the fifth; one `mfa_capped`; a refused request
    leaves the ticket's count unchanged; 50 concurrent wrong codes over 10 tickets: at most 10 reach the code check;
    during a cap a known device passes with a correct TOTP and with a recovery code, and its failures never touch the
    account's count; a password change, a passkey sign-in and a known device's success each clear the cap;
    re-authentication by password and by email code succeeds during a cap.
  - apps/api/test/integration/mfa-cap.test.ts: through HTTP against the runner's Valkey, a correct password mints a
    new ticket each time, and still the eleventh attempt of the day from new devices answers 429; Mailpit holds one
    `mfa_failures` mail; during the cap a known device of the account on another network passes the step with a correct
    code, and a soft-authenticator passkey sign-in with user verification succeeds and clears the cap.

### 4.2 Auth limits per network (D2, decision 4)

- **Where.** apps/api/src/auth/context.ts: `RequestContext` gains `netHash`, required, beside `ipHash`. The four
  places that build a context (apps/api/src/auth/routes.ts:55, account/routes.ts:24, staff/routes.ts:63,
  auth/staff/step-up.ts:174) set it from `c.get("clientNetHash")`, which `clientIdentity` already sets on every
  request (apps/api/src/auth/client-ip.ts).
- **The keys and their ceilings.** Each of the 13 per-address keys of inputs 0.3 (`password-signin`, `mfa-verify`,
  `email-start`, `email-verify`, `signup-complete`, `reauth`, `not-me`, `email-revert`, `badge-start`,
  `passkey-signin-options`, `passkey-signin`, `passkey-remove-link`, `staff-signin`) changes from
  `<name>:ip:${ctx.ipHash}` to `<name>:net:${ctx.netHash}`, with the same window and ten times today's number (the
  `*_PER_IP` constants become `*_PER_NET`): `password-signin` and `mfa-verify` 200 per 15 minutes, `email-start` and
  `signup-complete` 100 an hour, `passkey-signin-options` 300 per 15 minutes. Why ten times: a network is one IPv4
  address, which a carrier's NAT shares among hundreds of customers, or one IPv6 /64, a whole campus or office LAN. A
  session slides for 30 days, so a person signs in about once a month: a thousand korbat users behind one address make
  about 1.4 sign-ins an hour, and a class of 30 signing up together uses 30 of 100. The secrets stay bounded where they
  are guessed (the lockout per account, 4.1's cap, a code's own tries, Turnstile on sign-up and password sign-in), so
  a network's ceiling only sheds bulk.
- **Known devices first.** In `startEmail` (4.3), the password sign-in and `verifyMfa` (4.1), the device is looked up
  before any network limit; a known device counts in `<name>:dev:<device hash>` at today's per-address number and never
  spends its network's budget, so nobody else on the network can stop it.
- **The global limit and the image bucket.** apps/api/src/middleware/rate-limit.ts's `clientIpKey` becomes
  `clientNetKey`, which reads `clientNetHash` (still cut to 24 characters); app.ts:89 (the global limit, 3,000 a minute)
  and media/routes.ts:57 (the image files, 12,000 a minute) use it, and so does 3b's imports route
  (POST /api/imports, apps/api/src/imports/routes.ts:51, whose bucket `imports:import-address-day:` in
  imports/flows/create.ts:33 counts `IMPORT_RULES.importsPerAddressDay`, 5 a day), ten times as well: the bucket
  becomes `imports:import-network-day:` and counts `IMPORT_RULES.importsPerNetworkDay: 50`, which replaces
  `importsPerAddressDay`, since after this section no limit reads an address. A reader makes about 30 API
  requests a minute, so these serve about 100 busy readers at once on one network; the old numbers were one person's.
- **The refusals' words** (4.1 to 4.3 and 4.7). The error body of `rate_limited` and `too_many_attempts` gains
  `retryAt` and `scope` (`network`, `account`, `device`); the app's words module gives each scope a sentence: "Too many
  attempts from your network, perhaps by other people on it. Try again after {time}." and "Two-factor codes from new
  devices are paused on this account until {time}. A passkey or a device already signed in still works.";
  apps/app/test/limit-words.test.ts holds one case per sentence.
- **What stays per address.** `devices.ip_hash` and `auth_events.ip_hash` keep the address's hash: they are records,
  not limits.
- **Published numbers.** 1a's table (docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md lines 266-271) and
  README:441 ("per IP"; :411 at 0bc2dcc) are amended: per network, ten times, known devices first, and email/start's
  buckets of 4.3; the amendment goes into the 1a design's amendments section in this task. README:471's
  sentence (3b's "5 imports started from one address in a day") becomes "50 imports started from one network in a
  day", and its pin at apps/admin/test/readme.test.ts:831 reads `importsPerNetworkDay`.
- **At deploy.** The old keys expire on their own within their windows (at most 24 hours); nothing migrates them.
- **Tests.**
  - apps/api/test/middleware.test.ts (which builds `clientIdentity`): `2001:db8::1` and `2001:db8::2` share a net
    hash, `2001:db8:0:1::1` has another, IPv4 unchanged. apps/api/test/auth/network-limits.test.ts (new, the flow
    harness): 200 password sign-ins from one /64, the 201st refused, one from another /64 accepted; a known device on
    the exhausted /64 still signs in and still receives an email code.
  - The tests that gave a request a fresh bucket with a new `ipHash` set `netHash` too (`{ ...h.ctx, ipHash: X,
    netHash: Y }`): apps/api/test/auth/passkey-signin.test.ts:116 (its case becomes "another network has its own
    allowance"), badge.test.ts:176 and :188, passkey-management.test.ts:570,
    test/integration/auth-flows-account.test.ts:152, auth-flows-mfa.test.ts:99, auth-flows-signup.test.ts:164,
    staff-signin.test.ts:370 and :384; the harnesses that build a `RequestContext` set a random `netHash` as they set
    `ipHash`: test/auth/flow-harness.ts and
    test/integration/flow-harness.ts, recovery-harness.ts, staff-sign-in.ts, auth-fixtures.ts and 3b's
    imports-harness.ts (:276). Every test that
    spends one of the 13 limits to its number (a grep of apps/api/test for the keys) reads the renamed constant.
  - apps/api/test/architecture.test.ts gains a rule: no source file under apps/api/src builds a limit key with `:ip:`,
    and none reads `clientIpHash` but auth/client-ip.ts and the four context builders.
  - apps/api/test/integration/rate-limit-redis.test.ts gains the global limit shared by two addresses of one /64.
  - packages/contracts/test/imports.test.ts (its pin of `IMPORT_RULES`, :168) and integration/http-imports.test.ts
    (:112) change only where they read the import's day limit.

### 4.3 The email-code lever (D3, decision 5)

- **Where.** apps/api/src/auth/flows/email.ts (`startEmail`) and apps/api/src/auth/flows/email-change.ts (the start
  of a change).
- **The buckets, in `startEmail`, after Turnstile and the disposable check:**
  - the device's hash is computed as sign-in does (`deviceHash(authHmacKey, input.deviceId)`), and the account's live
    devices are read once, before any network limit (`repo.liveDeviceOf(userId, deviceHash)`, a new read of the auth
    role: a device row of that account, not revoked); for an address without an account there is none;
  - a known device: `email-start:email-device:<email hash>:<device hash>`, 3 an hour, and no network or other
    per-address bucket;
  - any other device: the network's `email-start:net` (100 an hour, 4.2), then `email-start:email-net:<email
    hash>:<net hash>`, 3 an hour, then the ceiling `email-start:email:<email hash>`, 10 an hour.
  The one-minute cooldown per address and the age block stay where they are. `MIN_START_RESPONSE_MS` still pads every
  answer, so the device lookup adds no timing difference between an address with an account and one without.
- **The email change** counts in `email-start:email-net` and the ceiling for the new address, never as a known
  device, since the device belongs to the account that asks, not to the address it names.
- **Tests.**
  - apps/api/test/auth/email-limits.test.ts (unit): three codes from network A, then A refused; network B still gets
    three; ten networks exhaust the ceiling; then a known device of the account gets three more and an unknown device
    none; a known device on a network whose `email-start:net` is spent still gets its codes; a device known to another
    account counts as unknown; an email change from a known device counts in the
    ceiling; the answers of the refused and the accepted unknown address take at least `MIN_START_RESPONSE_MS` and have
    the same body.
  - apps/api/test/integration/email-start-limits.test.ts: the same three cases through HTTP with Turnstile's test key,
    the device known by a real sign-in first.

### 4.4 The tunnel's guard and its runbook (D4, decision 6)

- **Config.** apps/api/src/config.ts gains `EDGE_TUNNEL: z.enum(["on", "off"]).default("off")`. In production
  `superRefine` refuses `TRUST_PROXY=none` ("production runs behind Caddy: set API_TRUST_PROXY to caddy, or to
  cloudflare behind the tunnel"), `EDGE_TUNNEL=on` with anything but `cloudflare`, and `EDGE_TUNNEL=off` with anything
  but `caddy`.
- **Compose.** infra/compose.yml passes `EDGE_TUNNEL: ${TUNNEL:-off}` to `api`, the same variable that builds Caddy's
  image. Compose does not rebuild Caddy when it changes, so Caddy states what it was built with: infra/caddy/Dockerfile
  adds `header_up X-Korbat-Edge <on|off>` to cf-header.caddy, the file it already writes from `TUNNEL`, which replaces
  any client's value. The API's `/api/health` answers `degraded` (logged once) when a request's `X-Korbat-Edge`
  differs from `EDGE_TUNNEL`, or when, with `EDGE_TUNNEL=on`, every request of a minute came from one network; the
  smoke test and outside-check.mjs read it.
- **The runbook.** README gains "The tunnel", in place of Foundation Task 16: create the tunnel in the dashboard (token
  mode); put `TUNNEL_TOKEN` in infra/.env; add `tunnel` to `COMPOSE_PROFILES`; three public hostnames, the app's to
  `http://caddy:8080`, the console's to `http://caddy:8090` and the push site's to `http://caddy:8091`, each with its
  HTTP Host Header left empty; set `TUNNEL=on` and `API_TRUST_PROXY=cloudflare`, rebuild Caddy and recreate the API;
  check from outside with infra/cloudflare/outside-check.mjs (section 9.5). There is no MinIO and nothing listens on
  port 80. docs/superpowers/prompts/foundation/16-cloudflare-tunnel.md gains one first line: "Superseded by README, The
  tunnel (sub-project 4); do not run this prompt."
- **The smoke test** (scripts/smoke-auth-stack.mjs) gains a last step: up to 201 password sign-ins for an address
  with no account, each with a different `CF-Connecting-IP`, through Caddy built with `TUNNEL=off`; it stops at the
  first 429, which must come at or before the 201st, since Caddy dropped the header and every attempt counted in one
  network. Its earlier sign-in for an unknown address (:993-994) accepts `rate_limited` with a `Retry-After` of at most
  900 seconds as "spent by an earlier run", printed. README "Full stack" says that a run spends its network's password
  sign-ins for 15 minutes.
- **Tests.** apps/api/test/config.test.ts: production with `none` refused; `on` with `caddy` refused; `off` with
  `cloudflare` refused; `on` with `cloudflare` and `off` with `caddy` accepted; development accepts all.
  apps/api/test/integration/health.test.ts: a differing `X-Korbat-Edge`, and a minute from one network under `on`,
  each answer `degraded`.

### 4.5 The reconcile in pages (D5)

- **Where.** apps/api/src/media/repo.ts, `existing`: the ids are read in pages of `EXISTING_PAGE = 10_000`, one
  `inArray` a page, and the sets are joined. PostgreSQL's limit of 65,535 bind parameters is then never near.
  apps/api/src/media/sweeper.ts is unchanged.
- **Tests.** apps/api/test/integration/media-existing-pages.test.ts: 70,000 random ids with three ids of real rows
  among them answer exactly those three, in one call; an empty list answers an empty set without a query.

### 4.6 The errno in logs (D6)

- **Where.** The scrubber, which moves to packages/log (section 6.5): for an `Error`, `scrub` keeps `code` when it is
  a string of a Node system error (`^E[A-Z0-9_]{2,}$`, such as `ENOSPC`) or a SQLSTATE (`^[0-9A-Z]{5}$`), and keeps
  `errno` (a number) and `syscall` (a string). A plain object's key `code` stays `[redacted]`, since sign-in codes
  travel under that name.
- **Tests.** packages/log/test/scrub.test.ts holds the seven cases of apps/api/test/logger.test.ts, moved, and adds:
  an `ENOSPC` error from `fs` keeps `code`, `errno` and `syscall`; `ECONNREFUSED` likewise; `{ code: "123456" }`
  stays redacted; an `Error` whose `code` is `"123456"` loses it, since six digits are neither shape; a drizzle failed
  query keeps its SQLSTATE as before.

### 4.7 Per-network engagement limits and the block's sentence (L9, L10; decisions 7 and 8)

- **Where.** apps/api/src/social/tiers.ts gains `networkLimitsFor(action, accountAge)`: for an account younger than 48
  hours, `like` 300 an hour, `repost` 90 an hour, `follow` 150 an hour and 1,200 a day; for an older account, and for
  every other action, none. The social module's write path, which already checks `limitsFor` per account, checks these
  under `net:<net hash>:<bucket>` with the request's `clientNetHash`, after the account's own and before the write.
  Undo actions are never limited, as before.
- **The words.** README "Posting and feed" names the per-network numbers, that they bind only accounts under 48 hours,
  and that an attacker with many networks is bounded by account age and Turnstile instead; a refusal carries 4.2's
  `network` sentence; the block's confirmation in the app (`profile.blockBody` in apps/app/src/lib/ui-words.ts) gains
  decision 8's sentence.
- **Tests.** apps/api/test/social/limits.test.ts: the three actions and their numbers for a young account; none for
  an established one or another action. apps/api/test/integration/http-social.test.ts: four accounts younger than 48
  hours on one network give 300 likes in an hour, and the 301st, from any of them, answers `rate_limited`; an
  established account on that network and an account on another network still like. apps/app/test/block-words.test.ts
  (new): `profile.blockBody` holds the sentence.

### 4.8 Owner-scoped rows, phase one (L6, L24; decision 9)

- **The settings.** Two transaction-local settings: `korbat.viewer`, the account a request acts for, and `korbat.job`,
  `on` while a job, a purge or a cross-account statement runs. Two functions in the migration read them:
  `public.viewer_id()` (`nullif(current_setting('korbat.viewer', true), '')::uuid`) and `public.job_mode()`
  (`coalesce(current_setting('korbat.job', true), '') = 'on'`), both `STABLE`, owned by the migrator, `EXECUTE`
  granted to `korbat_api` and taken from `PUBLIC`.
- **The wrappers.** A new apps/api/src/lib/scope.ts: `asViewer(db, accountId, fn)` opens a transaction (or a savepoint
  in one the caller holds), runs `select set_config('korbat.viewer', $1, true)` and then `fn(tx)`; `asJob(db, fn)` does
  the same with `korbat.job`. `set_config(..., true)` ends with the transaction, so a pooled connection never carries a
  viewer into the next request. A setting made in a savepoint outlives its release, so in a savepoint the wrapper first
  reads the old value (`current_setting(..., true)`) and sets it back in a `finally`: a nested `asJob` or `asViewer`
  never widens the rest of the outer transaction.
- **The policies.** The migration drops `bookmarks_api_all` and `mutes_api_all` and creates, for `korbat_api`:
  - `bookmarks_owner`, for all commands: `USING (user_id = public.viewer_id() OR public.job_mode())` and the same
    `WITH CHECK`;
  - `mutes_owner`, for all commands: `USING (muter_id = public.viewer_id() OR public.job_mode())` and the same
    `WITH CHECK`.
  A security-definer function owned by the migrator, which owns the tables, is not subject to them: `staff_case_conflict`
  and `staff_party_conflict` (migration 0016), which read another account's mutes for a recusal, keep working
  unchanged. Foreign-key cascades are not subject to them either.
- **The statements that change** (apps/api/src/social/repo.ts, at fc7c730's line numbers): the bookmark's insert and
  delete (788, 794) and the viewer's flags (805) run in `asViewer` for the acting account; the Bookmarks list (1045) and
  the export's pages (`exportPostRefs`, `exportHandleRefs` for `mutes`) in `asViewer` for the account; the mute's insert
  and delete (883, 888), the relation flags (898) and the Muted list (932) in `asViewer`; every timeline and profile
  read that applies the viewer's mutes (`itemNotMuted` at 451-452 and `otherWelcome` at 484-485, inside the
  Following, Latest, thread, profile and Explore reads; unwrapped, they fail open and show muted accounts) in
  `asViewer` for the reader, and with no setting for a signed-out reader, who has no mutes; the purge's deletes
  (1831, 1840), which remove other accounts' mutes of the deleted account, in `asJob`.
- **2d's tables.** The dry run lists every statement of 2d's built code that names `activity_items` or
  `activity_state` (a grep over apps/api/src and the migrations). Each one that acts for its owner runs in `asViewer`;
  each that acts for another account (the fan-out's insert for a recipient, `writeEntries` at social/repo.ts:2006, which
  reads the recipient's settings and mutes in the same statement; the deletes of a post's entries at :700, the block's
  at :869, the purge's at :1846-1847 and activity-retention's at activity/repo.ts:194) runs in `asJob`, and so does
  every 2d statement that reads `mutes` for a recipient (`writeEntries` alone, which `createPost` calls at :660 and
  `follow` at :836), counted toward the five once: a statement counts once however many flows call it. So
  `activity_items` has five (`writeEntries` and the four deletes) and `activity_state` two (`writeEntries` and the
  purge's delete), and both take the owner policies in this phase, the retention and the purge running in `asJob` as
  the jobs they already are. The owner's own are the activity module's reads and writes
  (activity/repo.ts:91-153, whose `notMuted` at :51 reads the viewer's mutes). Their policies (`activity_items_api_all`
  and `activity_state_api_all`, packages/db/src/schema/activity.ts:67 and :89) then follow the same shape,
  keyed on `recipient_id` and `account_id`. If more than five statements of one table need `asJob`, that table stays at
  `USING (true)` in this phase, and section 15 records which statements and why. `post_mentions` holds what any reader
  of a public post sees, so it stays `USING (true)`, with that reason in the ASVS mapping.
- **The lab.** apps/api/test/lab/rls/README.md and cost.sql measure, on the scratch database with 100,000 bookmarks
  and 10,000 mutes, the Following timeline's read with and without the setting (`EXPLAIN (ANALYZE, BUFFERS)`, ten runs,
  median), and the added round trip of `set_config`. The design expects the plan unchanged, since the policy's
  predicate equals the query's own; the dry run records the numbers in section 15.
- **Tests.**
  - apps/api/test/integration/rls-owner.test.ts, as `korbat_api`: with no setting, `select` from `bookmarks`,
    `mutes`, `activity_items` and `activity_state` answers no row and an insert is refused (42501); as viewer A, only
    A's rows; an insert of B's bookmark as
    viewer A refused; in job mode every row; after the transaction, a new one on the same connection sees no viewer;
    after a nested `asJob` returns, the outer transaction sees only the viewer's rows, and the same after a nested
    `asViewer(B)` inside `asViewer(A)`; `staff_case_conflict` still finds a staff account's mute of the subject; for
    each mute-filtered read (Following, Latest, Explore, the relation flags at 898) a muted author's post or flag is
    absent for the muter; a muted actor's reply leaves no `activity_items` row (counted through migrateDb).
  - Three existing test files change, since the policies bind `korbat_api`: moderation-decisions.test.ts (:486, :492
    insert their mutes in `asJob`), social-repo.test.ts (:437-441 counts mutes through migrateDb, so :461's 0 is
    real), and test/lab/standing.lab.ts (:119, :127 delete in `asJob`). Since 2d's tables take the
    policies, three of 2d's test files that read or write them as `korbat_api` change too: activity-schema.test.ts (its
    `asApi` blocks), account-deletion.test.ts (:263, :270, :293) and account-export.test.ts (:407). The other suites of
    mutes, bookmarks, timelines, the export and the purge pass.
  - packages/db/test/schema.test.ts: the four tables' policies (`bookmarks`, `mutes` and 2d's two) are the owner
    policies, and every other table's are as before.

### 4.9 The migrations

Hand-written SQL beside drizzle's generated part, as 0016 to 2d's last are written: every function owned by the
migrator with `SET search_path = public, pg_temp`, every object schema-qualified, `EXECUTE` taken from `PUBLIC`.
Numbered by the dry run with the next free numbers after 2d's last, 0053_avatar_moderation (0054 to 0058:
0054_hardening_kinds, 0055_backups, 0056_alerts, 0057_owner_rows, 0058_terms), in the order the tasks create them. No
existing migration is edited. The dry run's database runs them both `--fresh` and `--upgrade-from 53`, and records
each one's time on the upgrade for README "Upgrading" (Task 13).

- **`hardening_kinds`** (Task 2). `ALTER TYPE auth.auth_event_type ADD VALUE 'mfa_capped'` and `'terms_accepted'`,
  alone in their migration. drizzle's migrator runs every pending migration in one transaction (scripts/test-db.mjs
  says so), in which a new value cannot be used; that is harmless only because no later migration of 4 uses either.
- **`backups`** (Task 5). `public.backup_runs` (sections 7.2 and 8.2): `id` bigint identity, `taken_at` timestamptz
  not null, `finished_at` timestamptz not null, `parts` smallint not null, `bytes` bigint not null, `manifest_sha256`
  text not null (CHECK 64 lowercase hex characters). RLS on, with a policy for `korbat_api` that allows SELECT only; the
  backup service inserts as the database's superuser, which RLS does not bind; the API's retention job deletes rows
  older than 400 days through a security-definer function `public.prune_backup_runs()`. It holds no personal data.
- **`alerts`** (Task 6). The check `alert_outbox_kind` replaced with the 36 kinds (0047_import_images's list)
  and `auth_failures`,
  `server_errors`, `disk_low` and `backup_missed` (section 8.1); `auth_events_created_brin`, a BRIN index on
  `auth.auth_events (created_at)`, for the count of section 8.2.
- **`owner_rows`** (Task 7). The two functions and the policies of 4.8 for `bookmarks`, `mutes` and 2d's two
  tables.
- **`terms`** (Task 11). `auth.terms_acceptances` (section 10.6): `user_id` uuid not null references `auth.users`,
  `version` text not null, `accepted_at` timestamptz not null default now(), `how` text not null (CHECK `signup`,
  `accepted`, `seen`, `mailed`; a `seen` or `mailed` row records a notice, not consent), primary key (`user_id`,
  `version`, `how`). RLS on; `korbat_auth` may SELECT, INSERT and DELETE, and has no UPDATE. The user row is never
  deleted, so no cascade empties the table: the account's purge (`finishPurge`, apps/api/src/auth/repo.ts) deletes
  the account's rows in the transaction that clears `terms_version`. The existing accounts whose `terms_version` is
  not null (a purged account's is) get one row each from `users.terms_version` and `users.terms_accepted_at`, with
  `how = 'signup'`.

Each migration's drizzle snapshot is regenerated in packages/db/migrations/meta. packages/db/test/schema.test.ts's
table count grows by two (`backup_runs`, `terms_acceptances`), its policy list follows 4.8, and
packages/db/test/enum-literals.test.ts gains the two values.

## 5. Supply chain

### 5.1 pnpm 10.34.7 (D7, decision 10)

- package.json's `packageManager` becomes `pnpm@10.34.7+sha512.<the registry's integrity of that tarball>`, read with
  `npm view pnpm@10.34.7 dist.integrity` on the day; .github/workflows/ci.yml's `pnpm/action-setup` step gets
  `version: 10.34.7`. corepack installs it from that hash, as today.
- The release is 2026-10-12, past the floor since 2026-10-19, and is the newest 10.x; it carries every fix of the 19
  advisories of inputs 1.3 (10.33.4 to 10.34.5).
- The dry run installs with the frozen lockfile under 10.34.7 before any other change and checks that pnpm-lock.yaml is
  unchanged (`git diff --exit-code pnpm-lock.yaml`), so the pnpm move and the package upgrades are two separate,
  readable steps.

### 5.2 The upgrades

Each at the newest version past the floor on the day Task 1 runs, as an exact pin, checked by
scripts/check-lockfile-age.mjs:

- sharp in apps/worker to 0.35.5 or later (GHSA-wq5f-xc86-pv6w, librsvg). korbat's pipeline blocks every
  `VipsForeignLoad` but the allowed formats (apps/worker/src/pipeline.ts), so SVG never loads, but sharp patches only its
  newest release. The worker image is rebuilt and the smoke test runs with `--worst-case`, as README "Full stack" asks
  after every sharp upgrade.
- hono in apps/api to 4.13.11 or later (GHSA-5r4p-p66f-jhc7; `serveStatic` is used nowhere, but the fix is in the
  newest line).
- vitest and every `@vitest/*` package in every workspace package to 4.1.12 or later, which brings vite 8.3.3 or later
  (the high advisory and five lower ones on vite, and `@vitest/mocker`'s two).
- The overrides of decision 12 in package.json's `pnpm.overrides`, beside `decode-uri-component`: `shell-quote`,
  `brace-expansion` and `source-map-js` at exact fixed versions; `postcss-selector-parser` only as decision 12 says.
- After the upgrades, `pnpm audit --json` and osv-scanner run again and what remains goes into the acceptance file
  (5.3). On 2026-10-22 that would be node-forge (no fix, under @expo/cli), braces (no fix, under tailwindcss's
  chokidar), esbuild 0.18 under drizzle-kit and uuid 7 under Expo's xcode plugin, all at build time.

### 5.3 The audit gate and what "clean" means (decision 11)

- **scripts/audit-gate.mjs**, Node with no dependency. It runs `pnpm audit --json` itself, never with
  `--ignore-registry-errors`, and reads osv-scanner's JSON report (`--osv <file>`) and, in the weekly workflow, Grype's
  reports (`--grype <file>`, once per image). An answer that is not the expected JSON is a failure, so a retired or
  unreachable endpoint never reads as clean.
- **security/accepted-advisories.json**, a list of entries, each with: `id` (the GHSA id, or the CVE for an image
  finding with no GHSA), `aliases`, `scope` (`npm`, or `image:<name>`), `package`, `version`, `paths` (for npm, the
  dependency paths pnpm prints), `severity`, `reachable` (false, with `why`: the sentence that says why korbat never runs
  this code on untrusted input), `reviewer`, `added` and `expires` (dates, at most 90 days apart).
- **The rules the gate applies, in this order:**
  1. a field missing, or `expires` more than 90 days after `added`: failure;
  2. an entry whose `expires` has passed: failure ("expired: upgrade, or review and renew");
  3. an entry that no source of its scope reports any more: failure ("stale: remove it"); an image's entries are
     judged only in a run that was given that image's report, so the per-push gate, which has none, passes over them;
  4. for npm, any advisory of any severity, from either source, that no entry names (matched by id or alias and
     package): failure;
  5. for images, any finding of high or critical severity that no entry names: failure; lower ones are printed and
     pass, since base images carry many that korbat cannot fix;
  6. an accepted advisory of high or critical severity for which a source reports a fixed version: failure ("a fix
     exists: upgrade or override");
  7. an accepted advisory with `reachable` true: failure.
- **Clean** is the gate's exit 0. It prints one line per advisory: id, package, severity, source, and "accepted until
  <date>" or the rule that failed.
- **Tests.** scripts/test/audit-gate.test.mjs, run by Node's own test runner (`node --test scripts/test/`, which CI's
  `checks` job runs), with fixtures of pnpm's and osv-scanner's JSON as captured in the dry run: each of the seven rules
  fails on its own fixture; a fully accepted fixture passes; a non-JSON answer fails.
- README "Dependency audit" is rewritten: the gate, the file, who reviews an entry, the overrides and why each exists.

### 5.4 osv-scanner, the second source (decision 13)

- `ghcr.io/google/osv-scanner:v2.7.0` by digest (2026-10-12, past the floor; the dry run reads the digest on the day).
- In CI: `docker run --rm -v "$PWD:/src:ro" -v "$RUNNER_TEMP:/out" <image> scan source --lockfile
  /src/pnpm-lock.yaml --format json --output /out/osv.json`, whose exit 1 (findings) is expected and passed on to the
  gate, and any status other than 0 and 1 fails the step.
- Neither osv-scanner (api.osv.dev) nor Grype (its database download) runs offline: a push fails while either is
  unreachable, as the gate's non-JSON rule implies, and the lockfile's package list is sent to osv.dev.
- Locally the same command, and README "Dependency audit" gives it. Its own ignore file is not used: acceptance lives in
  one place, the gate's file.

### 5.5 Secrets in the history (decision 16)

- `zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` in a job
  `secrets` with the whole history checked out (`fetch-depth: 0`): `gitleaks git /repo --config /repo/.gitleaks.toml
  --redact --exit-code 1`. The checkout is mounted read-only and owned by another user than the container's, so the
  command passes `-c safe.directory=/repo` through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0` and `GIT_CONFIG_VALUE_0`.
- .gitleaks.toml: `[extend] useDefault = true`, and an allowlist of paths that hold only public test values: Cloudflare
  Turnstile's published test keys where the tests and the browser check use them, infra/.env.example, and the auth
  tests' software authenticator (apps/api/test/auth/soft-authenticator.ts). Each allowlisted path carries a comment
  with its reason.
- The dry run runs it once over the whole history and records every finding in section 15. A finding that is a real
  secret becomes an owner's line of the checklist (rotate it), and its fingerprint goes into .gitleaksignore with the
  date it was rotated; a false finding gets its path or rule allowlisted with a reason.

### 5.6 Images, the SBOM and the worker's PIE check (decision 13, L5)

- **Grype** (`anchore/grype` by digest, the newest release past the floor on the day; v0.120.1 on 2026-10-22) in the
  weekly workflow: every image of `docker compose config --images` over every profile (`backup` included, Mailpit
  excluded), so the built ones (`korbat-api`, `korbat-worker`, `korbat-caddy`, 3b's `korbat-importer` from
  apps/importer/Dockerfile, the backup image) and
  the pinned upstream ones, is written with `docker save` and scanned as `docker-archive:`, with
  `GRYPE_CHECK_FOR_APP_UPDATE=false`, its JSON going to the gate (5.3, rule 5). The Docker socket is never mounted into
  a scanner. scripts/test/scan-images.test.mjs fails when a Compose service with `build:` is not in the scanned list.
- **Syft** (`anchore/syft` by digest; v1.54.1 on 2026-10-22) writes one CycloneDX JSON for the source tree (from
  pnpm-lock.yaml, runtime and development dependencies) and one per built image, with `SYFT_CHECK_FOR_APP_UPDATE=false`.
  They are kept as the workflow's artefacts for 90 days; nothing is published.
- **The PIE check.** sharp's security page asks that the Node binary loading libvips be position independent. The
  `docker` job, after the build, reads two bytes of the worker image's Node binary at offset 16:
  `docker run --rm --entrypoint od korbat-worker -An -t x1 -j 16 -N 2 /usr/local/bin/node`, and expects ` 03 00`
  (`ET_DYN`). Busybox's `od` is in the image, so nothing is installed for it. The same line is a gate of every stack
  task.

### 5.7 The CI jobs (decisions 14 and 15)

.github/workflows/ci.yml, at every push to main and every pull request, every action by commit as today:

- **`checks`**: as today, with pnpm 10.34.7; `pnpm audit --audit-level high` is replaced by the osv-scanner step and
  `node scripts/audit-gate.mjs --osv "$RUNNER_TEMP/osv.json"`; `node --test scripts/test/` runs the scripts' own tests.
- **`integration`** (new): `node scripts/gen-dev-env.mjs`, which writes the development settings with random values;
  `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis counts mailpit`, the services and
  images by digest the developer uses; `node scripts/test-db.mjs`; then `pnpm --filter @korbat/api test:integration`
  with `--retry=2 --testTimeout=20000` and the three sign-in timing tests excluded by name, printing the name of every
  retried test in the job's log; then those three alone in a step that is run again once if it fails. The job's time
  is measured on the scratch machine and printed in README "Tests" as such.
- **`semgrep`**: unchanged.
- **`secrets`** (new): gitleaks (5.5).
- **`docker`**: as today, then the PIE check (5.6) and, from Task 5, the backup units' check (7.3).

.github/workflows/assurance.yml (new), each Monday at 04:00 UTC and on `workflow_dispatch`, with `permissions:
contents: read` and no secret: it builds and starts the stack in development mode as README "Full stack" does, then
runs the smoke test with `--record`, the leak check (6.6), ZAP's baselines (6.2), the images' scan and the SBOM (5.6),
the gate over Grype's reports, and the restore drill (7.6). Its reports (ZAP's HTML and JSON, the SBOMs, the drill's
output) are the workflow's artefacts for 90 days. Task 1 creates it with the images' scan, the SBOM and the gate; Task
5 adds the stack and the drill, and Task 8 the smoke test with `--record`, the leak check and ZAP's baselines.

**What korbat can and cannot see.** korbat cannot read a GitHub Actions run of the private repository (inputs.md:276),
so this design claims no CI result. The task that adds a job runs the job's commands on the scratch machine;
scripts/test/workflows.test.mjs parses both workflow files (the jobs, `permissions`, every `uses:` pinned by commit);
and docs/launch/checklist.md asks the owner to confirm the first green run of ci.yml after Tasks 1 and 13 and of
assurance.yml (`workflow_dispatch`), with its minutes.

## 6. The scans

Every scan in this section runs against a scratch stack or local files. None runs against the owner's hostnames.

### 6.1 ZAP and how it reaches the stack

- **The image.** `zaproxy/zap-stable` (ZAP 2.17.0, Apache-2.0) by digest: the newest weekly build at least 7 days old
  on the day Task 8 runs (on 2026-10-22, build 20261016, `sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6`,
  past the floor from 2026-10-23). The 2.17.0 tag is rebuilt monthly, so only the digest names an image.
- **Offline.** Every run passes `-z "-silent"`, which stops the add-on update, the version check, the news and the
  telemetry.
- **The network.** The container joins the stack's own network `<project>_edge`, on which Caddy listens, and targets
  Caddy's sites by service name: `http://caddy:8080` (the app), `http://caddy:8090` (the console), and
  `http://caddy:8091` (the push site) when the stack runs the profile `notify`. Caddy matches sites by port, so the
  Host `caddy:8080` is served. `--network host` and `host.docker.internal` are not used.
- **The script.** scripts/zap-scan.mjs, Node with no dependency, with `--project <Compose project>`, `--sites
  app,console,push`, `--auth`, `--active` and `--out <folder>` (a new temporary folder, printed, when absent). It shares
  the smoke test's helpers for a throwaway account, which move from scripts/smoke-auth-stack.mjs into
  scripts/lib/stack-client.mjs (sign-up through Caddy with Turnstile's test key, the code read from Mailpit, the
  session cookie and the CSRF token). It refuses a project whose `api` runs with `NODE_ENV=production` (read with
  `docker compose exec api printenv NODE_ENV`).
- **Under the limits.** Every scan comes from one address, so ZAP runs throttled (`-config scanner.threadPerHost=1
  -config scanner.delayInMs=250` and the spiders' equivalents); the script counts the 429 answers in ZAP's message
  history, prints the count beside each report, and fails the run when they exceed 1 %, so a throttled scan never
  reads as clean.

### 6.2 The baselines

- **Passive, each site.** `zap-baseline.py -t http://caddy:<port>/ -c rules.tsv -J <site>.json -r <site>.html -m 2
  -z "-silent"`, and `-j` (the AJAX spider) for the app's site, whose links are drawn by JavaScript. Passive rules
  only; the spiders may send the app's own requests, on a throwaway account.
- **Authenticated, the app's site.** The script signs up a throwaway account, then runs the app's baseline with
  `ZAP_AUTH_HEADER=Cookie`, `ZAP_AUTH_HEADER_VALUE` set to that account's session cookie and `ZAP_AUTH_HEADER_SITE=caddy`.
  A context file, `-n infra/zap/korbat.context`, excludes the sign-out, "sign out everywhere", the sessions, the
  lockdown and the deletion routes by regular expression, and the AJAX spider's excluded elements name their buttons by
  test id; `OUTOFSCOPE` lines of rules.tsv only filter alerts. The verification: before the scan and after it the
  script reads `/api/me` with the cookie and expects the account's handle both times; a signed-out answer at the end
  fails the run ("the session ended during the scan"), so a lost session never reads as a clean scan.
- **When.** At Tasks 8 and 13, and in the weekly workflow `assurance`. The reports of the last scratch scan go to the
  pen tester with the scope (section 11.1).

### 6.3 What clean means, and how a finding is handled (decision 19)

- **infra/zap/rules.tsv**, in ZAP's configuration format: one line per alert id, its verdict (`FAIL` or `IGNORE`) and,
  for an `IGNORE`, the reason in the third column, naming the evidence (a test, a decision, a README section). It starts
  from `zap-baseline.py -g` in the dry run, and every alert the scratch stack raises gets a verdict there before the
  task ends. Two are known before the run: the CSP alert family (10055) is `IGNORE`, since the smoke test asserts both
  sites' policies word for word and the browser check fails on any report, and its one deviation is decision 29; a
  cookie without the Secure flag (10011) is `IGNORE`, since the scratch stack runs over plain http, production refuses a
  plain-http origin, and the pen tester checks the flag on staging. The dry run records every other verdict in section
  15.
- **Exit codes.** ZAP's baseline exits 0 (pass), 1 (a `FAIL`), 2 (warnings only) or 3 (another failure). An alert
  without a verdict is a warning, and scripts/zap-scan.mjs treats 2 like 1, so no new kind of finding passes unread.
- **Clean** is: every site's run exits 0 with at most 1 % of its answers 429, and the authenticated run's
  verification holds.
- **A finding** is reproduced on the scratch stack, then either fixed with a test, or given `IGNORE` with its reason in
  the same commit; a change of rules.tsv is read in review like code. A verdict is never changed to make a run pass
  without a reason that names its evidence.
- **Tests.** scripts/test/zap-rules.test.mjs: every line of rules.tsv has an id, a verdict among `FAIL`, `IGNORE`,
  `OUTOFSCOPE`, and an `IGNORE` has a reason of at least 20 characters; the script's exit-code mapping (0 passes; 1, 2
  and 3 fail); the 429 count's 1 % rule; the refusal of a production project; the HAR's route count against
  routes.txt.

### 6.4 The active scan, and what only production adds

- **The active scan** runs by hand only (`--active`), on a scratch stack that is thrown away afterwards, before each
  release candidate and for the pen tester. It uses ZAP's Automation Framework (`zap.sh -cmd -autorun
  /zap/wrk/active.yaml`) with infra/zap/active.yaml: a `replacer` job that adds the throwaway account's cookie, its
  CSRF header and the stack's own `Origin` to every request, so state-changing routes reach their handlers; an `import`
  job of type `har` over the file the script writes (a `url` import would send GETs only); an `activeScan` job with
  ZAP's default policy without its denial of service rules; and an `exitStatus` job that fails on High and warns on
  Medium.
- **The routes.** infra/zap/routes.txt lists every method and path the API serves, one a line. A vitest test,
  apps/api/test/zap-routes.test.ts, builds the app as the HTTP tests do, with every optional module and a
  `CONSOLE_ORIGIN` (app.ts:123 mounts the staff routes only then), reads Hono's route list (`app.routes`, the handlers
  only) and fails when the file differs, so a new route cannot miss the scan. The script writes a HAR: each route's
  method, its path filled with the throwaway account's own values (its handle, its post, its upload) or a random id,
  and a minimal valid JSON body from the contracts' schemas; the scan fails when the HAR holds fewer routes than
  routes.txt.
- **What only production adds**, which a development stack cannot show and the pen tester checks on staging: the
  production refusals of apps/api/src/config.ts (https origins, Turnstile's real keys, the relay's STARTTLS, the
  relying parties, the console's origin, the tunnel's guard of 4.4), each held by apps/api/test/config.test.ts; HSTS
  and Secure cookies over real TLS; the tunnel, the WAF rules, the cache and Cloudflare's headers; the real Turnstile
  widget; the mail relay with the sender domain's SPF, DKIM and DMARC; passkeys on the real relying party.

### 6.5 Logs and addresses (D6, decisions 21 to 24)

- **One scrubber.** A new package packages/log (`@korbat/log`) holds `scrub`, the logger's options and
  `createLogger(level, options)`, with pino 10.3.1, the version the API and the worker pin. apps/api/src/lib/logger.ts
  re-exports it and keeps the in-process pino-pretty stream for development. apps/worker/src/index.ts,
  apps/api/src/notify/main.ts and 3b's apps/importer/src/index.ts (its plain pino logger at :15) use `createLogger`,
  so the worker, the contact point's watcher and the importer scrub as the API does; apps/importer/package.json gains
  `@korbat/log`, which replaces its direct use of pino as the worker's change does. The worker's, the API's and the
  importer's Dockerfiles already copy the whole packages folder into their build stage (apps/importer/Dockerfile:8)
  and esbuild bundles the package, so no Dockerfile changes. The errno rule of 4.6 lives here.
- **Route patterns.** apps/api/src/middleware/observability.ts logs `route` (the matched handler's pattern, read with
  `matchedRoutes(c)` from `hono/route`, since `c.req.matchedRoutes` is deprecated in the pinned Hono; the last entry
  that is not a middleware, or `unmatched`) in place of `path`. The query string
  was never logged and still is not. Tests: apps/api/test/observability.test.ts: a request to `/api/profiles/alice`
  logs `"route":"/api/profiles/:handle"` and no `alice` anywhere in the line; a request to no route logs `unmatched`;
  the request id and `cf-ray` are kept. A grep of apps/api/src for other log calls that pass `c.req.path` or
  `c.req.url` is part of the task, and each one found logs the pattern instead.
- **PostgreSQL.** infra/compose.yml's `postgres` gains `command: ["postgres", "-c", "log_error_verbosity=terse", "-c",
  "log_min_error_statement=panic"]`. The leak check (6.6) provokes a unique violation with a marker value as the
  superuser and expects the marker in no log.
- **The IP-hash key** (decision 22). A new apps/api/src/auth/ip-key.ts holds the key ring:
  - the period is the number of whole 30-day spans since 1970-01-01 UTC;
  - at start and at each period's change the API reads `ip-key:<period>` from `counts`; when it is absent it writes 32
    random bytes there with `SET NX` and an expiry of 31 days, and reads the key back, so a race ends on one key;
  - when `counts` cannot be reached, the API makes a key of its own in memory, keeps serving, and tries the write every
    minute; when it later finds another key there, it switches to it once (limits restart once);
  - `clientIdentity` takes the key from the ring for every request; `ipHash` and `netHash` are unchanged functions of a
    key and a text;
  - `IP_HASH_KEY` leaves apps/api/src/config.ts, infra/compose.yml, infra/.env.example and apps/api/.env.example;
    scripts/gen-dev-env.mjs fills the examples' placeholders by pattern, so it changes only if its test names the key.
    README "Upgrading" says the line `API_IP_HASH_KEY` must be deleted from infra/.env and
    its off-server copies destroyed, and backup.sh refuses to run while infra/.env holds it (7.2): with the old key, the
    90 days of `auth_events.ip_hash` and the `email_codes.ip_hash` it made are reversible. The API's container has
    `memswap_limit` equal to `mem_limit`, so its memory, the key among it, is never swapped to disk.
  - The files that name the key change with it: apps/api/test/app.test.ts, config.test.ts, auth/verify-config.test.ts,
    staff/app-mount.test.ts and staff/route-table.test.ts (their config objects), auth/flow-harness.ts and
    integration/flow-harness.ts (`ipHashKey` in `AuthConfig`), middleware.test.ts (:124-125, :172-173: `clientIdentity`
    takes a ring), and architecture.test.ts's rule at :114 with its fixtures at :918 and :997; every test that builds
    the app in process gets a ring over a fake store.
  Tests: apps/api/test/auth/ip-key.test.ts (unit, a fake store and clock): one key within a period, a new one in the
  next, the hashes of one address different across them, the fallback and the switch; apps/api/test/integration/
  ip-key.test.ts with the runner's `counts`: two rings share one key, its expiry is at most 31 days, and nothing is
  written to the limits store `redis`; apps/api/test/architecture.test.ts: no `IP_HASH_KEY` in apps/api/src.
- **Valkey's append-only file** stays (decision 23). An expired key leaves the file only at a rewrite, so the auth
  janitor runs `BGREWRITEAOF` on `redis` once a day, and the privacy page prints "on disk for at most its window plus
  one day". The leak check forces a rewrite and then expects in `redis`'s data folder no recorded email but those of
  keys still alive at that moment (read with `SCAN`).
- **How long logs live.** `LOG_KEEP_DAYS = 14` in packages/contracts, printed by the data map's `log` entries.
  infra/compose.yml's `x-logging` takes its driver from `LOG_DRIVER` (default `json-file`, which development and Docker
  Desktop need); the server's infra/.env sets `journald`, and README "The server" (checklist part C) sets journald's
  `MaxRetentionSec` to 14 days, checked with `journalctl --disk-usage` and the oldest entry's date. cloudflared cannot
  run on the scratch stack without a token, so the map says the leak check does not cover its log.

### 6.6 The leak check (decision 20)

- **The record.** scripts/smoke-auth-stack.mjs gains `--record <file>`: a JSON file of what the run used, written as
  it goes: every email, handle, password, email code, recovery code, session cookie value, CSRF token, post and bio
  text it wrote, and every `CF-Connecting-IP` value it sent (4.4).
- **scripts/leak-check.mjs**, Node with no dependency, with `--record <file>` and the Compose command after `--`:
  - **the logs:** `docker compose logs --no-color` of every service but Mailpit, which is a development mailbox; a log
    may hold none of the recorded values, nor the gateway addresses of the stack's networks
    (`docker network inspect`), nor the IP-hash key read from `counts`;
  - **the database:** `pg_dump --data-only` through the postgres service; it may hold the recorded emails, handles and
    texts where they belong and must hold no recorded code, password, cookie, token or sent address, no gateway
    address, no IP-hash key, and no IPv4 or IPv6 literal in any text column (candidate tokens confirmed with
    `net.isIP`; a version inside a user agent such as `Chrome/120.0.0.0` and a time such as `04:00:00` are kept apart,
    with a fixture for each);
  - **the limits store:** the IP-hash key in no file of `redis`'s data folder, and after a forced rewrite no recorded
    email but those of live keys (6.5);
  - **PostgreSQL's own log:** the marker of 6.5's provoked violation in no line.
  It prints one line per finding with where and which kind, never the value, and exits 1 on any.
- **Clean** is its exit 0.
- **When.** After the smoke test at each stack task from Task 4 on, where it is built, and in the weekly workflow.
- **Tests.** scripts/test/leak-check.test.mjs: the matcher over fixture logs and a fixture dump finds each kind once,
  ignores the allowed values in their tables and the near misses (versions, times), and never prints a value.

## 7. Backups and restore

### 7.1 What a backup holds, and what it never holds

- **Held:** the whole database (`pg_dump -Fc`, both schemas, the migrations' journal included), the `media-store`
  volume (the WebP files korbat serves), and a copy of infra/.env, whose keys a restored database needs (README,
  Before going public: losing `API_TOTP_ENC_KEY` breaks every authenticator, losing `API_NOTIFIER_ENC_KEY` every signed
  out notifier's contact).
- **Never held, by design:** `media-uploads` (originals waiting minutes for the worker), `media-quarantine` (3d: sealed
  files, never backed up, so a restore never brings a destroyed file back), 3b's `import-archives` and `import-work`
  (archives in transit, other people's messages among them), `valkeydata` (limits, flow state, the moderation
  dispatch's daily markers, which README "Restoring" deletes after a restore anyway), `counts` (no disk at all, the
  IP-hash key among it), `caddy-data` and `caddy-config` (nothing Caddy needs to keep, since TLS ends at Cloudflare),
  `ntfy-data` (a 12-hour message cache and an auth database rebuilt from infra/ntfy/server.yml at every start), and the
  containers' logs.
- **Retention:** 30 days from the day taken (`RETENTION.backupDays`, which the terms publish), except a backup marked
  for an authority (decision 27).
- **Erasures, kept beside the backups** (decision 28). A restore would bring back what people erased after the backup,
  so every erasure (an account's purge, a post's deletion, a retention job's erasure; each post 3b's undo of an
  import deletes, through `removeImportedBatch` in apps/api/src/social/flows/imports.ts, as kind `post`; a profile
  picture's row that `removeAvatar` removes or a new picture replaces, through the media module's `dropFormerAvatar`,
  as kind `avatar`) is appended, ids only (`at`, `kind`, `id`), by a new apps/api/src/lib/erasure-journal.ts to
  `/erasures/<UTC day>.jsonl` in the API's container: a
  mount of `ERASURE_DIR`, on the server `<BACKUP_DIR>/erasures` (owned by uid 1000 and the group `korbat-pull`), never
  in a database backup. The API's retention job deletes a day's file after 31 days, the second machine's prune its
  copies. After a restore the lines newer than the backup are
  replayed before the site opens (7.5). apps/api/test/integration/erasure-journal.test.ts: a purge, a post deletion
  and a retention erasure each append one line of ids, an import's undo a `post` line for each post it removes and a
  picture's removal or replacement an `avatar` line; the replay erases them all again and skips older lines. 3b's
  integration/imports-undo.test.ts and 2d's integration/http-avatar.test.ts check the lines their flows write.

### 7.2 The service and its image (decision 25)

- **infra/backup/Dockerfile:** `FROM postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`,
  the database's own image, so `pg_dump` and `pg_restore` match the server; `age` and `age-keygen` (BSD-3-Clause, by
  Filippo Valsorda) copied from a build stage that fetches the static linux-amd64 archive of a tagged release at least
  7 days old with `ADD --checksum=sha256:<its sum>` (Alpine's live index drops an exact `apk` pin; the dry run records
  version, sum and licence file, and Grype's scan covers the binary); `COPY infra/backup/backup.sh
  infra/backup/restore.sh infra/backup/prune.sh /usr/local/bin/`; no other package. tar, sha256sum and date are
  busybox's.
- **infra/compose.yml** gains the service `backup` under the profile `backup`, built from that file: `restart: "no"`,
  `user: "0:0"` with `cap_drop: [ALL]` and `cap_add: [DAC_READ_SEARCH]` (it reads `media-store`, owned by uid 1000,
  and infra/.env, owned by root with mode 0600, and can change neither), `read_only: true`, `security_opt:
  ["no-new-privileges:true"]`, `tmpfs: ["/tmp"]`, the network `data` only (to reach `postgres`), `media-store` mounted
  read-only at `/media-store`, `${BACKUP_DIR}` from infra/.env mounted at `/out`, infra/.env mounted read-only at
  `/run/korbat/env`, and `${BACKUP_RECIPIENTS}` (a file of the owner's age public keys, one a line, beside infra/.env
  and not in git) at `/run/korbat/recipients`. Its environment: `PGHOST=postgres`, `PGUSER=${POSTGRES_USER}`,
  `PGPASSWORD=${POSTGRES_PASSWORD}`, `PGDATABASE=${POSTGRES_DB}`, `KORBAT_VERSION`. Its entrypoint is backup.sh; `restore`
  and `check` are its other commands (7.5).
- **infra/backup/backup.sh** (sh, `set -euo pipefail`, which busybox ash supports), in this order:
  1. sets `umask 027`; refuses to start when `/run/korbat/recipients` holds no line that starts with `age1`, `/out`
     is not writable, or `/run/korbat/env` still holds `API_IP_HASH_KEY` (decision 22);
  2. makes `/out/<UTC stamp>.partial/` (`YYYYMMDDTHHMMSSZ`);
  3. reads the audit log's newest place (`<chain_seq>:<hash>`, as `staff.js audit-head` prints it, by the same query)
     and the number of rows in the migrations' journal;
  4. `pg_dump -Fc` piped into `age -R /run/korbat/recipients -o db.dump.age`: no plain dump ever touches a disk;
  5. `tar -C /media-store -cf - .` piped into `age ... -o media-store.tar.age`;
  6. `age ... -o env.age /run/korbat/env`;
  7. writes manifest.json: the stamp, the time each part finished, `KORBAT_VERSION`, the server's version, the
     migrations' count, the audit place, and each part's size and SHA-256 (of the encrypted file);
  8. renames the folder to `/out/<stamp>/`, so a folder without `.partial` is always complete;
  9. inserts the run into `public.backup_runs` with psql (taken, finished, parts, bytes, the manifest's SHA-256);
  10. runs prune.sh on `/out`;
  11. prints one line: the stamp, the parts' sizes and the seconds taken, never a value from the database.
  Steps 4 and 5 also `tee` each stream into a FIFO in `/tmp` read by a checker (`pg_restore --list` for the dump,
  `tar -t` for the archive, each draining what it does not read): a backup is good only when the pipelines and both
  checkers exit 0. Any failing step stops it with exit 1, leaves the `.partial` folder, which the next prune removes
  after a day, and writes no row, so `backup_missed` (8.1) is raised once the last good backup is 26 hours old.
- **infra/backup/prune.sh** (POSIX sh) takes a folder: it deletes every `<stamp>/` older than 30 days by its stamp that
  holds no file `KEEP`, or whose `KEEP` names an end date that has passed (7.4), every `<stamp>.partial/` older than a
  day, and, given `--erasures`, the journal's days older than 31, and prints what it deleted. It computes ages from
  `date -u +%s` and shell arithmetic on the stamps' digits, never `date -d`, so busybox, GNU and BSD agree. The owner's
  second machine runs the same file (7.4).
- **Settings** in infra/.env.example: `BACKUP_DIR` (an absolute host path on the server's encrypted disk, owned by
  root and the group `korbat-pull` with mode 2750, so every folder and file the backup writes belongs to the group the
  pull of 7.4 reads with) and `BACKUP_RECIPIENTS` (the path of the recipients file). Neither is needed for the stack to
  start; the profile is off until the owner sets them.
- **Why the server cannot read its own backups:** only the owner's public keys are on it; the identity stays on the
  owner's devices (docs/launch/keys.md, 7.7).

### 7.3 When it runs

- infra/backup/korbat-backup.service and korbat-backup.timer, systemd units for the owner's server only (the
  checklist says so): the service, `Type=oneshot` as root with `WorkingDirectory=` the repository's folder, runs
  `docker compose -f infra/compose.yml --profile backup run --rm backup`, the drill's own command; the timer fires at
  03:15 UTC each day with `Persistent=true`, so a host that was off runs the missed backup at boot. The owner installs
  them (checklist); README "Backups" gives the two commands.
- Their checks: scripts/test/backup-units.test.mjs parses both files (`OnCalendar=*-*-* 03:15:00 UTC`,
  `Persistent=true`, `Type=oneshot`, `WorkingDirectory=`, `ExecStart` equal to the drill's command), and
  `systemd-analyze verify infra/backup/korbat-backup.*` runs in a Linux container (an image by digest that carries
  systemd, with a stub `docker` on its path) in CI and locally in the task. On the Windows scratch machine the drill
  covers the service, and only that container covers the units; `backup_missed` (8.1) is the guard that the timer fires.
- 03:15 UTC is a quiet hour for a European audience; the owner may move it.
- A run takes, on the scratch stack, the seconds the drill records (7.6), and the database stays online throughout:
  `pg_dump` reads one snapshot.

### 7.4 The off-box copy (decision 26)

- **On the server:** a user `korbat-pull` in the group `korbat-pull`, with no shell and one line in its
  authorized_keys:
  `command="rrsync -ro <BACKUP_DIR>",restrict ssh-ed25519 <the second machine's public key>`. rrsync ships with rsync
  3.2 and later.
- **On the second machine:** a daily cron line at 05:00 UTC:
  `rsync -a --ignore-existing --exclude '*.partial' --exclude erasures korbat-pull@<server>:/ /backups/korbat/`, then
  `rsync -a korbat-pull@<server>:/erasures/ /backups/korbat/erasures/` (a growing day's file is brought up to date),
  then `sh /opt/korbat/prune.sh --erasures /backups/korbat`. `--ignore-existing` never overwrites a backup, and without
  `--delete` a backup the server lost or a thief deleted stays; the 30-day rule is applied there by its own prune.
  docs/launch/checklist.md names the second machine's supported OS.
- **A backup kept for an authority:** the owner writes `KEEP` in its folder on the server, which the next pull copies:
  one line, `order <the legal_orders id> until <YYYY-MM-DD>`, no later than the end of the authority's period (never a
  person's name). The prune on both machines deletes the backup after that date unless the file was renewed on both,
  and the heartbeat's weekly line names every `KEEP` within 14 days of its end (8.4).
- The server reaches the second machine never; the second machine reaches the server over SSH, which the main design
  keeps on Tailscale or the LAN (line 157).

### 7.5 Restoring (decision 28)

- **The order on a new host,** which docs/launch/restore.md lists as a checklist with a blank column for the time each
  step took:
  1. clone the repository at the backup's `KORBAT_VERSION`; decrypt env.age with the owner's identity on the owner's
     own machine (`age -d -i <identity> -o infra/.env env.age`) and copy it over;
  2. `docker compose -f infra/compose.yml up -d postgres` on a new volume: the init script makes the roles with the
     passwords in that file;
  3. `docker compose -f infra/compose.yml --profile backup run --rm --cap-add CHOWN --cap-add FOWNER -v
     /dev/shm/korbat-identity:/run/korbat/identity:ro -v <backup folder>:/in:ro -v
     korbat_media-store:/restore/media-store backup restore`: the third mount gives this one command `media-store` to
     write into, which the service's own read-only mount never allows, and `CHOWN` and `FOWNER`, granted to this
     command alone, let `tar -x` give the files back to uid 1000. The identity is copied from removable media to
     `/dev/shm` for the command and deleted after it (docs/launch/restore.md);
  4. the staff steps, the keeper's copy, the releases and the public figures of README "Restoring", with
     `MEDIA_RECONCILE=off`, `API_MODERATION_RETENTION=off` and `APP_SITE=closed` first, as it says, and the passkey
     counters' reset of README "Passkeys and fresh authentication";
  5. `staff.js erasure-replay --since <the manifest's stamp>` (apps/api/src/cli/restore.ts) erases again every
     journal line newer than the backup, from the server's journal or, if it was lost, the second machine's copy, and
     with `--count` prints how many remain;
  6. open the site only when After a restore shows no gap; README's list gains the class "erasures to replay".
- **infra/backup/restore.sh** checks manifest.json against each part's SHA-256 and refuses on any difference; refuses
  when the database already holds a table in `public` or a schema `auth`, or `/restore/media-store` holds a file;
  decrypts `db.dump.age` into `pg_restore --exit-on-error --no-password` (every owner kept, as
  scripts/pg-major-upgrade.mjs does) and `media-store.tar.age` into `tar -x` under `/restore/media-store`; and then runs
  `check`.
- **`check`** prints, without changing anything: the owner of `/restore/media-store`, failing unless it is uid 1000;
  the migrations' count against the manifest; the audit log's newest
  place against the manifest's (the restored place may be later, never earlier); the number of rows of every table;
  the images whose row says they are stored and whose files are missing (`rows without file`, by count and the first
  20 ids); and the files no row names (`files without row`, by count). A row without a file is an image deleted
  between the dump and the tar; README "Restoring" gains the line that says what to do with each (nothing for the
  files, which the sweeper removes once `MEDIA_RECONCILE` is back on; for the rows, `staff.js` has no repair, so their
  posts show the image as unavailable, and the count is noted in the operator's notes).

### 7.6 The drill on the scratch stack

scripts/restore-drill.mjs (Node, no dependency) runs it with the Compose command after `--`, on a scratch stack only,
and is part of Task 5's gates and of the weekly workflow:

1. On project A, already seeded by a smoke test run, it publishes one import as the smoke test's step 21 does, without
   its undo, makes a throwaway age identity with the backup image's `age-keygen` and writes the public key as the
   recipients file, in a temporary folder.
2. It writes a marker file into `media-quarantine`, and into `import-archives` and `import-work` where 3b made them,
   through a throwaway container.
3. With A's `api` and `notify` stopped (the worker never writes the database), so the counts are exact, it counts
   every table's rows, then runs the backup.
4. It starts them again, writes a post, deletes another post, removes the smoke test's profile picture, undoes step
   1's import and deletes an account through the API (running its purge at once), so A moves past the backup and its
   journal holds those erasures.
5. It checks the backup folder: exactly `db.dump.age`, `media-store.tar.age`, `env.age` and `manifest.json`; it
   decrypts the tar's listing and the dump's table of contents with the throwaway identity and finds no marker, and no
   path outside `media-store`.
6. It restores into project B (`korbatdrill`, its own volumes, host ports moved through its own env file), runs
   `check`, starts B with `APP_SITE=closed`, `MEDIA_RECONCILE=off` and `API_MODERATION_RETENTION=off`, reads 503
   from B's app site, runs `erasure-replay` with A's journal, opens it, and runs the smoke test against B, whose image
   upload shows the restored volume is the worker's.
7. It compares B with step 3's counts, and finds step 4's new post absent and its deleted post, removed picture,
   undone import's posts and account not back.
8. It takes a second backup of A while a smoke test writes and deletes images, restores it into a project C, and
   records C's `rows without file` and `files without row`, the measured price of decision 28.
9. It stops `postgres` during a third backup and expects exit 1, a `.partial` folder and no new `backup_runs` row; a
   backup with `API_IP_HASH_KEY` in its env file is refused; prune.sh runs inside the backup image over prune.test's
   folders and gives their answers.
10. It removes B, C and the temporary folder, and prints its result.

With `--server`, the owner's drill (checklist part D): on the real server it restores the keeper's copy into project
`korbatdrill` with its own ports and volumes, runs `check`, the keeper's import, the erasure replay and the closed
site's 503, and removes the project; it reads the identity from `/dev/shm` and deletes it at exit.

The expected output, whose numbers the dry run fills in section 15:

```
drill: parts db.dump.age env.age manifest.json media-store.tar.age
drill: markers of media-quarantine import-archives import-work in no part
drill: restore check migrations <n>/<n>, audit place equal, media-store owner 1000
drill: tables equal <t>, differ 0; rows without file 0; files without row 0
drill: closed site 503, open site 200; smoke test with an upload on the restored stack passed
drill: post written after the backup absent; post, picture, import's posts and account erased after it not back
drill: busy backup: rows without file <r>, files without row <f>
drill: dump stopped part-way: exit 1, partial kept, no row; old IP-hash key refused; prune agrees
drill: backup <s> s, restore <s> s, size <bytes>
```

Its test is the run itself: any line that differs from the expected shape exits 1.

### 7.7 Keys to keep off the server

docs/launch/keys.md lists every secret and credential, each with where it lives, who keeps the copy off the server,
and what losing it costs: the age identity and its paper copy (the only way to read a backup); infra/.env, which each
backup carries encrypted (the database passwords, `API_AUTH_HMAC_KEY`, `API_TOTP_ENC_KEY` and its previous keys,
`API_NOTIFIER_ENC_KEY` and its previous keys, the Turnstile secret, the relay's and the IMAP host's passwords, ntfy's
publisher token, `TUNNEL_TOKEN`, the edge purge's token); the staff security keys (two a person); the keeper's head
mails and audit copies; the Cloudflare account's own second factor. `API_IP_HASH_KEY` is gone (decision 22).

## 8. Alerting gaps

### 8.1 Four new kinds (decision 30)

Each is an entry of `ALERT_KINDS` (packages/contracts/src/orders.ts) written as `sentenceKind(3, "all", facts)`, so it
goes to every staff phone through `notify` and to every staff mail through the alert tick, like 3f's kinds; each joins
`ALERT_KIND_LIST`, `ALERT_TEXTS` (its title, sentence and first step, which the push, the mail and the console print),
the outbox's check (section 4.9, `alerts`), the mailer's templates (apps/api/src/mail/templates.ts) and
`TICK_MAILED_KINDS` (apps/api/src/moderation/alerts.ts). Facts are counts and instants only, as the outbox's check
enforces; an instant's name ends in `At`.

| Kind | Facts | Raised when | Repeats at most |
|---|---|---|---|
| `auth_failures` | `count`, `fromAt` | 100 or more `signin_failure`, `account_locked` and `mfa_capped` events in the last 15 minutes | once an hour |
| `server_errors` | `count`, `fromAt` | 20 or more answers with a status from 500 to 599 in the last 10 minutes | once an hour |
| `disk_low` | `freeMb`, `percent` | free space under `media-store` below twice `MEDIA_MIN_FREE_BYTES` or below 10 % | every 6 hours while it lasts |
| `backup_missed` | `lastAt` (absent when none), `hours` | the newest `backup_runs` row older than 26 hours, or none and the database older than 26 hours | once a day |

Their `ALERT_TEXTS` entries (sentence, then first step):

- `auth_failures`: "{count} failed sign-ins in 15 minutes, from {fromAt}." First step: "korbat's own limits hold.
  Whoever has the server reads the API's log for one route or one burst, and checks the edge's rate rule."
- `server_errors`: "{count} server errors in 10 minutes, from {fromAt}." First step: "Whoever has the server reads the
  API's log by the request ids and `docker compose ps`."
- `disk_low`: "The disk of the images and the database has {freeMb} MB free ({percent} %)." First step: "Uploads stop
  at the floor and the database stops when the disk is full: free space or grow the disk today."
- `backup_missed`: "No backup for {hours} hours, the last of {lastAt}." (with no backup ever: "No backup has been taken
  on this server.") First step: "Whoever has the server runs the backup by hand (README, Backups) and reads why the
  timer's run failed (`journalctl -u korbat-backup`)."

The numbers are constants of `ALERT_RULES` (packages/contracts/src/orders.ts), beside the tick's own.

### 8.2 Where each is raised

- **`auth_failures`.** The alert tick asks the auth module, each round, for `failureCount(sinceMs)`, a new read of the
  auth role that counts `auth.auth_events` of the three types since then, through a new BRIN index on `created_at`
  (`auth_events_created_brin`, which the `alerts` migration adds; the table's one index today leads with the user);
  at the threshold it calls `staffAlert` with the key `auth-failures` and a window of one hour. The facts
  never name an account, a network or an address.
- **`server_errors`.** apps/api/src/middleware/observability.ts calls an `onServerError` hook of `AppDeps` for each
  answer with a status from 500 to 599. The moderation module implements it: it counts in the shared limit store under
  `server-errors` (10 minutes) and, when the count reaches 20, calls `staffAlert` with the key `server-errors` and a
  window of one hour. When the database itself is down, neither the row nor the staff's addresses can be read, and
  `staffAlert` fails open as it already does; the outside heartbeat (8.4) is the alert that still arrives.
- **`disk_low`.** The alert tick reads the free space the media module already measures for its upload floor
  (apps/api/src/media/files.ts, the statfs of the volumes). The media volumes share the disk with the database
  (apps/api/src/config.ts, `MEDIA_MIN_FREE_BYTES`'s comment), so one reading covers both; README "Backups" and the
  checklist say the database's volume must stay on that disk, or this alert covers only the images.
- **`backup_missed`.** The alert tick, at most once a day, while `BACKUP_ALERT=on`: a new setting of
  apps/api/src/config.ts whose default is `on` in production and `off` elsewhere, as `NOTIFY`'s is; infra/compose.yml
  passes `API_BACKUP_ALERT`. A server without backups set up thus reminds its staff every day until the owner sets them
  up or switches it off in writing.
- **Tests.**
  - apps/api/test/integration/alerts-hardening.test.ts: each kind's row is written at its threshold and not one below,
    with exactly its facts; each is throttled by its window; `backup_missed` with no row, with an old row, and silent
    with a new row or with the setting off; `server_errors` through a route that throws.
  - packages/contracts/test/orders.test.ts: the four kinds' entries, and `ALERT_KIND_LIST` equal to the outbox's check
    (the existing test that holds them together).
  - apps/api/test/mail/moderation-templates.test.ts, which holds `TICK_MAILED_KINDS` to `SENTENCE_MAIL_KINDS`: the
    four join both lists, each with its template.
  - packages/db/test/schema.test.ts: the check's list.

### 8.3 What nothing inside the stack can see

- The host, Docker, the tunnel (seen only through the public hostnames) or the database being down: the outside
  heartbeat (8.4).
- Containers restarting or unhealthy: not alerted; `restart: unless-stopped` brings them back, the heartbeat sees a
  lasting effect, and a Docker events watcher on the host is left for later (section 14).

### 8.4 The outside heartbeat (decision 31)

- **scripts/heartbeat.mjs**, Node with no dependency, run by cron every 5 minutes on the owner's second machine:
  `node heartbeat.mjs --app https://<app host> --console https://<console host> --backups /backups/korbat --state
  /var/lib/korbat-heartbeat.json`, and `--console-access` when the console sits behind Cloudflare Access (main design
  line 344), which then accepts Access's redirect.
- **What it checks:** `GET /api/health` on the app's hostname, expecting 200 and `"status":"ok"` (`degraded` is
  reported as such); on the console's, `GET /` expecting 200 and `GET /api/staff/me` expecting 401, since that site
  proxies only the staff API (README, Full stack); the newest complete backup folder under `--backups`, expecting it at
  most 26 hours old.
- **When it speaks:** it keeps each check's last state in the state file and prints a line only when a check has
  failed twice in a row (10 minutes) or has recovered, each failure with its first step in one sentence ("the API is
  down or the tunnel is: run `docker compose ps` on the server"). Once a week, on Monday's first run after 08:00 UTC,
  it prints a "still watching" line with the newest backup's age, each check's state and every `KEEP` within 14 days
  of its end. A missing Monday mail is itself the alarm: the watcher, its cron, its Node or its mail has stopped
  (checklist part D). It always exits 0, so cron mails exactly the lines it prints.
- **The mail:** the cron table's `MAILTO` names the staff's addresses, and the machine sends mail through its own mail
  setup (msmtp to the EU relay with a credential of its own, which the owner creates). The staff's mail app rings for
  that sender as for the contact point's (3f's check M).
- **Tests.** scripts/test/heartbeat.test.mjs with a local HTTP server: healthy prints nothing; one failure prints
  nothing; two print one line with its first step; a third prints nothing more; recovery prints one line; a backup
  folder 27 hours old prints one line; a `.partial` folder is not a backup; Monday's first run prints the weekly line
  once, with a `KEEP` that ends within 14 days; `--console-access` accepts Access's redirect.
- **On the scratch stack** (Task 6's gates): against the development stack's ports and the drill's backup folder it
  prints nothing; with `api` stopped, its second run prints the failure line; with `api` started again, the recovery.

### 8.5 One page of alerts

docs/launch/alerts.md gives each of the 40 kinds its title, sentence and first step, printed from `ALERT_TEXTS` by
`renderAlertPage` (packages/contracts/src/docs.ts, a pure function). packages/contracts/test/generated-docs.test.ts
compares the committed page with it and fails on any difference; `pnpm --filter @korbat/contracts gen:docs` (`vitest
run test/generated-docs.test.ts --mode write`) writes the page instead, and the record of processing with it (10.4).
The page thus never drifts from what the phones say, and no new tool is needed to write it.

## 9. The edge

korbat's own limits are the real ones; the edge is a coarse first layer that sheds noise before it reaches the
tunnel. Everything in this section is a file korbat tests; applying it is the owner's (decision 32).

### 9.1 The files (infra/cloudflare/)

- **custom-rules.json:** the body of `PUT /zones/{zone_id}/rulesets/phases/http_request_firewall_custom/entrypoint`,
  `{ "rules": [...] }`, each rule with `ref`, `description`, `expression`, `action` and `enabled`.
- **ratelimit-rules.json:** the body of the same call for the phase `http_ratelimit`.
- **zone-settings.json:** each zone setting's id and the value korbat expects, as `GET /zones/{zone_id}/settings`
  answers it, and Bot Fight Mode's expected `fight_mode: false` as `GET /zones/{zone_id}/bot_management` answers it.
- The files name hostnames as `{{APP_HOST}}`, `{{CONSOLE_HOST}}` and `{{PUSH_HOST}}`, and the home country as
  `{{HOME_COUNTRY}}`; apply.mjs fills them from its arguments and refuses a placeholder it does not know. A disabled
  rule's body is still sent, so an unset country (`WEB_HOME_STATE` defaults to empty) is filled with `XX`, which matches
  no request.

### 9.2 The rules and why each

Free allows five custom rules without regular expressions and one rate rule counted by address, over the URI path and
the verified-bot field, with a period and a mitigation of 10 seconds (inputs 1.1).

| Ref | Action | Expression (in words) | Why |
|---|---|---|---|
| `korbat-scanner-paths` | block | the path starts with `/.env`, `/.git` or `/wp-`, ends with `.php`, or is `/xmlrpc.php`, `/server-status` or `/phpmyadmin` | korbat serves none of them; scanner noise never reaches the tunnel |
| `korbat-staff-on-app-host` | block | the host is the app's and the path starts with `/api/staff` | Caddy already answers 404 there (README, Full stack); this is defence in depth |
| `korbat-methods` | block | the method is not GET, HEAD, POST, PUT, PATCH, DELETE or OPTIONS | korbat answers no other method; TRACE and the like stop at the edge |
| `korbat-home-state` | managed challenge, **off** | the host is the app's, the country is not `{{HOME_COUNTRY}}`, and the client is not a verified bot | decision 33; a challenge needs a browser, so for the apps and the API abroad it is a block; verified bots stay out of it so 2d's link previews still work |
| (free) | | | left for the owner |
| `korbat-auth-burst` (rate) | block for 10 s | the path starts with `/api/auth/` or `/api/notices`: more than 30 requests in 10 seconds from one address | 180 a minute, nine times the fastest pace korbat's own per-network ceilings allow (300 per 15 minutes); it sheds floods, never a person |

Functions used: `starts_with`, `ends_with`, `http.request.uri.path`, `http.host`, `http.request.method`,
`ip.src.country`, `cf.client.bot`, all on Free as Cloudflare's field and function lists give them; the first
`--apply` on the owner's zone is the check, since the API refuses a rule the plan does not allow and the script prints
its answer.
Whether Cloudflare groups IPv6 by /64 when it counts is not documented; it does not matter here, since korbat counts by
network itself (4.2).

### 9.3 The zone settings

zone-settings.json expects: Browser Cache TTL 0 ("Respect Existing Headers"; 2b and README "The edge"); Always Online
off; Rocket Loader off; Email Obfuscation off and Server-side Excludes off (both rewrite the page, and Email
Obfuscation adds a script the app's policy refuses); Automatic HTTPS Rewrites off; 0-RTT off; Always Use HTTPS on;
minimum TLS 1.2; WebSockets on (the push site's subscriptions); Bot Fight Mode off.

What the API cannot read on Free, and the checklist therefore names as a dashboard check with its path: no Edge Cache
TTL rule on `/api/media`; the configuration rule that keeps Rocket Loader, Zaraz and Web Analytics off on the console's
hostname (README, Before going public); Zaraz and Web Analytics off on the app's; the CSAM Scanning Tool off (3d,
section 2, row 31); the tunnel's three public hostnames with an empty HTTP Host Header.

### 9.4 The apply script

infra/cloudflare/apply.mjs, Node with no dependency:

- `--check` (no network): parses the three files; at most 5 custom rules and 1 rate rule; only the fields and functions
  of 9.2's list; no `matches` and no regular expression; the rate rule's period and mitigation 10 seconds and its
  characteristics `ip.src` and `cf.colo.id`; every placeholder known; every rule with a `ref` and a `description`.
- `--diff --zone <zone id>`: reads the two phases' entrypoints, the settings and Bot Fight Mode with the token in the
  environment variable `CLOUDFLARE_API_TOKEN` (never a flag, so it stays out of shell history), and prints each
  difference with the expected and the found value; exit 1 when any differs.
- `--apply --zone <zone id>`: `--check`, then `PUT` of the two entrypoints and a `PATCH` of each setting that differs,
  then `--diff`, which must find none. It needs a token with Zone WAF Edit, Zone Settings Edit and Zone Bot Management
  Edit (Bot Fight Mode lives at `/zones/{id}/bot_management`) on that zone only, with an expiry, which the checklist
  has the owner delete once the final `--diff` passes; `--diff` needs the same scopes' read permissions alone.
- It prints the token never, and Cloudflare's error bodies only as their codes and messages.
- **Tests.** scripts/test/cloudflare.test.mjs (Node's test runner, `fetch` replaced by a fake): `--check` passes the
  committed files; a sixth custom rule, a `matches`, a 60-second period and an unknown placeholder each fail; `--diff`
  reports a changed setting; `--apply` sends exactly the two bodies and the differing settings; the token appears in no
  output. apps/api/test/edge-rules.test.ts reads the rules and checks that every path prefix they name is a mount of
  the API (`/api/auth` and `/api/staff` among apps/api/src/app.ts's `app.route` calls, `/api/notices` among the
  moderation routes).

### 9.5 The from-outside check

infra/cloudflare/outside-check.mjs, Node with no dependency, which the owner runs from any machine with Node:
`node infra/cloudflare/outside-check.mjs --app https://<app host> --console https://<console host> [--push
https://<push host>] [--burst]`. One line per check, PASS, FAIL or SKIP, a FAIL followed by its likely cause and
first step in one sentence (README section or setting), and exit 1 on any FAIL:

1. the app's `/` answers 200 with `cf-ray` and the app's policy word for word as infra/caddy/Caddyfile states it;
2. the console's `/` answers 200 with the console's policy word for word;
3. `/api/health` answers 200 with `"status":"ok"` on the app's hostname (`degraded` names 4.4's edge mismatch), and
   `/api/staff/me` answers 401 on the console's;
4. `/api/staff/me` on the app's hostname answers 403 from the edge (a 404 from Caddy prints "edge rule missing;
   Caddy's refusal holds");
5. `/.env` answers 403 from the edge;
6. a `TRACE` request, sent with `node:https` (`fetch` refuses the method), answers 403 from the edge;
7. plain `http://`, fetched with `redirect: "manual"`, redirects to `https://`;
8. on the push hostname, every path but the two topics' subscriptions answers 404;
9. with `--burst`, run from a network only the owner uses (it spends that network's passkey sign-in options for 15
   minutes): up to 301 `POST /api/auth/passkey/signin/options`, which no Turnstile precedes, each with another
   `CF-Connecting-IP`, sent at two a second to stay under the edge's rate rule; korbat's own 429 must arrive by the
   301st, which shows the edge overwrote the header and korbat counted one network.

`--no-edge` turns it on the scratch stack: no `cf-ray` is expected, the edge-only lines 4 to 7 expect Caddy's and the
API's own answers or are skipped, and line 9 runs as the smoke test's step of 4.4 does. Task 9 runs it that way against
the scratch stack, which is how korbat verifies the script; scripts/test/outside-check.test.mjs covers its parsing of
answers with a local server, and that every FAIL prints its hint.

### 9.6 What stays as the other designs set it

- **The edge lab** (L15): README "The edge" keeps it, the owner's, before `API_EDGE_PURGE` is switched on.
- **Import and card routes** (L22, L26): their own limits stay as 3b and 2d built them (3b's day limit counted per
  network, 4.2; the card routes have none of their own, only the global limit, counted per network by 4.2); the one
  rate rule goes to
  sign-in and notices, which an attacker gains most from flooding. The checklist asks the owner, after the first
  month, to count the API log's 429 answers by route (the request lines name the route, 6.5) and the `server_errors`
  alerts; a change is a later task (section 14).
- **WebP cards on Meta and LinkedIn** (L27): the owner's check with each platform's debugger on the live domain.

## 10. Privacy

Everything in this section is a draft for counsel. Each text carries the label "Draft: to be reviewed by counsel before
korbat opens", and docs/launch/counsel.md lists every sentence counsel must confirm.

### 10.1 The data map (decision 35)

- **packages/contracts/src/data-map.ts** exports:
  - `DATA_MAP`: one entry per place korbat keeps personal data, with `store` (`table`, `valkey`, `volume`, `log`,
    `browser`, `offsite`), `name` (`auth.users`, `rl:*`, `media-store`, ...), `holds` (the columns or keys the page
    names), `plain` (the columns that only key, date or count a row), `purpose`, `basis`, `kept` (a function that
    prints the period from the constants: `RETENTION`, `ORDER_RULES`, `IMPORT_RULES`, 2d's `ACTIVITY_KEEP_DAYS`,
    `LOG_KEEP_DAYS`, the auth janitor's constants, which move to contracts for this, so apps/api/src/auth/janitor.ts and
    integration/auth-janitor.test.ts follow; or `{ forGood: reason, article }` for an open-ended period), `recipients`
    and `source` (the design and section). `offsite` entries name the erasure journal, the second machine's and the
    keeper's copies, the mail relay's logs and ntfy's cache;
  - `NOT_PERSONAL`: tables, keys and volumes with no personal data, each with the reason (`explore_runs`,
    `backup_runs`, ...);
  - `PURPOSES`, `BASES` (decision 36's proposals: an Art. 6 basis per purpose and, where a purpose touches
    special-category data, an Art. 9(2) condition) and `RECIPIENTS` (decision 41's list, each with its role, country
    and contract): the server's host as a processor, named by the build argument `WEB_SERVER_HOST`; Cloudflare, whose
    entry says it "can read everything sent to korbat while it passes"; and Turnstile's provider also as a controller
    of its own for improving its detection.
  The entries are inputs 3.1 to 3.3, read again against the schema on the day, with 3b's and 2d's tables as built.
- **apps/api/test/data-map.test.ts** (the API depends on both packages) reads every table of the drizzle schema
  (`getTableConfig` over packages/db's exports) and fails when a
  table is in neither `DATA_MAP` nor `NOT_PERSONAL`, when a mapped table has a column in neither `holds` nor `plain`,
  when the map names a column or a table that does not exist, or when an open-ended `kept` has no reason. A migration
  that adds a table or a column therefore fails the suite until the map says what it holds, so the policy grows with
  the schema. apps/api/test/architecture.test.ts collects every key prefix passed to `kv.*` and `enforceLimit` and
  every named volume of infra/compose.yml, and fails when one is in neither list. `staff_personal_accounts`, an
  unanswered suspension reply and `handle_history` after a purge carry a `forGood` reason and a counsel question.
- **What never stored means.** A list `NEVER_STORED` (the raw address, the date of birth, the original image file
  after processing, other people's reports in an export, any tracker) is printed on the page; 6.6's leak check is its
  evidence.

### 10.2 The page `/privacy`

- apps/app/src/app/privacy.tsx renders apps/app/src/lib/privacy.ts, which builds every sentence from the map and the
  constants. A five-line summary in plain words opens it (what is kept, who sees it, how to leave); then, in the order
  GDPR Art. 13 asks: who is responsible; what korbat keeps, why, on what basis (with the Art. 9 condition where one
  applies) and for how long (by purpose); who receives what, and the transfers (Cloudflare, a US company that can read
  what passes, under its data processing terms' clauses; the server's host); data about you from others (reports,
  notices, imported archives, mentions, authorities' requests: their sources and categories, and the Art. 14(5)
  reasons); what korbat never keeps; how it protects data (the address key, which makes a stored hash untraceable once
  its 30-day period has ended while the running server holds it during the period; the limits, the second-factor cap,
  the encrypted TOTP secrets, the encrypted backups and their 30 days, and that a restore erases again what was erased
  after the backup); what it stores on the device (10.5); the rights (access through the export and the contact
  address, rectification in Settings, erasure by deletion and what outlives it and why, restriction and objection at
  the contact address, portability, no decision based solely on automated means but as the terms' Automated tools
  describe, the complaint to a supervisory authority); the age of 16; likes (private, though an author who blocks you
  can see their counts change); changes to the policy.
- **The operator's facts** come from three new web build arguments, `WEB_OPERATOR` (the name and postal address in one
  line), `WEB_SUPERVISORY_AUTHORITY` (its name and address) and `WEB_SERVER_HOST` (the host's name and country),
  passed by infra/compose.yml like `WEB_CONTACT_POINT`. Empty, the page says each "will be stated here before korbat
  opens"; the checklist's part I sets them before the opening, as README "Before going public" does for
  `WEB_CONTACT_POINT`.
- **Links.** The terms, the sign-up screen, the Settings index, the export's screen and the context column's links
  open `/privacy`.
- **The JavaScript cap** (decision 45). The page, `DEVICE_STORAGE` and Keep me signed in add to the web export,
  which this task measures by baseline.json's method and records; the method sums every chunk, so a lazy route saves
  nothing. Past the cap of 832,257 bytes, the cap is raised
  once to 852,737 bytes at app.browser.ts:634-635 and README:462, an amendment of section 15, and never above.
- **Tests.** apps/app/test/privacy.test.tsx: the summary; every `DATA_MAP` entry appears; a changed constant changes
  the sentence (as terms.test.tsx does); the draft label; the three facts' empty and filled forms; both forms of
  `WEB_EDGE_CHALLENGE` (10.5); the links. The app's browser check gains the page in its steps at 360 and 1280 px,
  and its first step holds the export to decision 45's cap.

### 10.3 The terms' changes

- apps/app/src/lib/terms.ts: "Your data" shrinks to a paragraph that points to `/privacy`, plus the sentences that are
  rules rather than facts (what a report reveals to the person reported, what an access request's answer holds and
  when korbat may withhold it). The paragraphs `AUTOMATION_DATA` and `AUTHORITIES_DATA` move unchanged into the
  privacy page's sections, and terms.test.tsx's assertions on them move to privacy.test.tsx.
- Explore's sentence stays (L11); counsel answers whether DSA Art. 27 binds korbat (counsel list).
- `TERMS_VERSION` does not change for these drafts, as 3d's drafts did not. The sentences 3b and 2d added to "Your data"
  (3b's import record and 2d's `ENGAGEMENT_DATA`) move to the privacy page the same way, each with its constants.

### 10.4 The record of processing and the impact assessment (decision 39)

- **docs/launch/privacy/record.md** is printed by `renderRecord` (packages/contracts/src/docs.ts) from the map and
  written by `pnpm --filter @korbat/contracts gen:docs` (8.5):
  for each purpose the categories of people (account holders, signed-out readers, people who report without an
  account, staff, authorities' staff, people named in imported archives), the categories of data, the recipients, the
  transfers, the periods and the security measures (Art. 30(1)). The controller's own lines come from
  docs/launch/privacy/controller.json, which the owner fills (name, address, representative if any, DPO if any) and
  which ships with each value "(the owner's)". packages/contracts/test/generated-docs.test.ts fails when the
  committed file differs from the generated text.
- **docs/launch/privacy/dpia.md**, written by korbat from the map in the order of the EDPB's DPIA template: Part 1, the
  service as a whole (WP248's nine criteria answered one by one; the systematic description; necessity and
  proportionality; the risks to people: unmasking a pseudonymous author, exposure of posted opinions, the 16 and 17 year
  olds (whom korbat cannot tell apart, so every protective default applies to everyone), harassment, an authority's
  demand, a breach of the server or a backup, Cloudflare's view of all traffic in clear (Free plan, no logs product,
  its DPA's clauses, a plain sentence on `/privacy`), the server's host, one owner holding every key, and an account
  lost for good with no manual recovery; the measures, each with its file or test; the residual risk). Annex A, 3d's
  automated tools (the R1 check and the comparison, with the four `API_AUTOMATION_DPIA_*` dates and B2's Art. 22
  question). Annex B, 3b's imports (other people's data in archives,
  the transit through the server and Cloudflare). Annex C, 2d's avatars and cards (faces and their hashes, previews kept
  by other platforms, the default). Each part ends with blank lines for the owner's signature and counsel's view.

### 10.5 Storage on the device (decision 38)

- **Keep me signed in.** Every sign-in screen gains the choice "Keep me signed in on this device" (off by default): off,
  the session and CSRF cookies last for the browser's session; on, today's 30 days sliding and 365 at most. The long
  cookie is then the person's own request, which is also safer on shared computers. The sign-in flows take a
  `remember` flag (apps/api/src/auth/flows/password.ts, email.ts, passkeys/flows.ts and the session's cookie writer);
  apps/api/test/integration/http-auth.test.ts holds both cookies' attributes.
- apps/app/src/lib/privacy.ts holds `DEVICE_STORAGE`: the session cookie and the CSRF cookie (names, lifetime: the
  browser's session, or with Keep me signed in 30 days sliding and 365 at most), `korbat.deviceId`,
  `korbat.passkeySuggestion.dismissedAt`, `korbat.appearance`, `korbat.place.<account id>` and `korbat.drafts.<account
  id>`, each with the module that writes it, why, how long it stays and its ePrivacy reason (strictly necessary for
  the service asked for, or the person's own explicit choice); and Turnstile's check, "read by Cloudflare when you sign
  up, sign in or report, for security". Cloudflare's `__cf_bm` and `cf_clearance` are listed by a new build argument,
  `WEB_EDGE_CHALLENGE`: `off`, "only while a challenge is on, which korbat keeps off"; `on`, set by the checklist line
  that turns on decision 33's rule, as stored for every visitor from abroad.
- apps/app/test/explore.test.tsx, which already holds the app's stores to a list, reads `DEVICE_STORAGE` instead, so the
  page and the code cannot differ.

### 10.6 A new terms version (L2, decision 37)

- **The constants.** `TERMS_VERSION` moves to packages/contracts/src/terms.ts with `TERMS_CHANGES`, a list of `{
  version, date, effective, kind: "minor" | "significant", summary }`, newest last, `effective` at least 30 days after
  `date`; terms.ts also states what makes a change significant (the use of data, the licence to content, the age, the
  moderation rules, disputes, fees), with a counsel question. The API no longer reads the version from the
  environment: `config.TERMS_VERSION` stays, set from the constant, so its 30 callers in apps/api/test do not change
  and only the config fixtures (app.test.ts, config.test.ts, auth/verify-config.test.ts, staff/app-mount.test.ts,
  staff/route-table.test.ts) drop the key. `API_TERMS_VERSION` leaves infra/compose.yml, infra/.env.example,
  apps/api/.env.example and the test environment file (scripts/gen-dev-env.mjs fills the examples' placeholders by
  pattern, so it changes only if its test names the key); README "Upgrading" says the line can
  be deleted from infra/.env. The smoke test's `--terms` becomes optional and defaults to the constant. Today the list
  holds `draft-2026-09` alone.
- **No write is ever refused.** From `date` to `effective` every screen of a signed-in person shows a banner, and a
  significant change is also mailed once to every account at `date` (template `terms_changed`, sent by the alert tick
  in batches within the relay's limits; a `mailed` row prevents a second mail). Until `effective` the old terms apply,
  from it the new ones. Nothing is gated by terms: export, deletion, blocking, muting, reporting and appealing never,
  and no other write either.
- **The API.** `GET /api/me` gains `terms: { current, accepted, pending, effective, summary }`. `POST
  /api/auth/terms/accept` (session, CSRF, the version as its body) records `accepted`, updates `users.terms_version`
  and `terms_accepted_at`, and appends `terms_accepted`; `POST /api/auth/terms/seen` records `seen` once (the notice
  was shown, not consent). Sign-up records the newest version with `how = 'signup'`.
- **The app.** The shell's banner (apps/app/src/app/terms-changed.tsx holds it and the full notice): the summary, a
  link to the new terms, the date it applies, Accept now, Download your data and Delete your account. Every sentence
  lives in a words module. Task 11 measures the web export again, under decision 45 (10.2).
- **The export** gains `account.termsAccepted`, every version with its time and how.
- **Shipping the first reviewed version** is a later one-line change of `TERMS_CHANGES`, made when the owner records
  counsel's review (checklist).
- **Tests.** packages/contracts/test/terms.test.ts: the list is ordered, versions are unique, the newest is
  `TERMS_VERSION`, every `effective` is at least 30 days after its `date`.
  apps/api/test/integration/terms-accept.test.ts (with a list injected through `AppDeps`): before and after
  `effective`, a post, a block, a mute, a report, a notice, an appeal, an export and a deletion's start are all
  accepted; `pending` holds until accepted, which is recorded and
  exported; `seen` is recorded as such; a significant change mails each account once; sign-up writes one row.
  apps/app/test/terms-changed.test.tsx: the banner, its words and controls.

### 10.7 Breaches and people's requests (decision 40)

docs/launch/privacy/breach.md: the runbook (contain: close the site, revoke sessions, rotate what docs/launch/keys.md
names; assess from the data map which data and how many people; notify the supervisory authority within 72 hours of
becoming aware unless the breach is unlikely to result in a risk, sending what is known and completing it later (Art.
33(1) and (4)), and tell people where Art. 34 asks, with the EDPB's notification template's fields) and a register
template (found, what happened, data and people, likely consequences, measures, who was told and when, or why not),
which Art. 33(5) asks for every breach. Processors notify the owner (Art. 33(2)): the page names the address where
their notices arrive, checked daily, and the checklist checks that each signed contract names it. Three worked cases
with the decision each usually leads to: the second machine or the keeper's copies stolen (encrypted, identity not
taken: Art. 34(3)(a), registered), the age identity or its paper copy lost, a processor's breach. The owner is the
person who decides; the page has blank lines for the deputies and the authority's form address.

docs/launch/privacy/requests.md, written with it: one section per right (access beyond the export, rectification,
erasure, restriction, objection, including to the address hashing and the reader count), each with the
identification step for a pseudonymous requester (a confirmation from a signed-in session, Art. 11 and 12(6)), the
one-month clock (Art. 12(3)), the command or setting that carries it out (`staff.js access-request` among them), the
reply's words, the register line, and what Art. 19 asks of the relay and the edge.

## 11. The pen-test kit and the launch checklist

### 11.1 The scope and the rules of engagement (decision 43)

docs/launch/pentest/scope.md, which the owner gives the tester and both accept in writing:

- **Targets.** The staging hostnames on the owner's domain (app, console, push), behind edge rules like production's,
  running the release candidate with `KORBAT_ENV=production`; the API under `/api`; the console. Staging, as README
  "Staging" sets it up, is a separate machine or VM with its own Compose project, infra/.env, keys, age recipients,
  tunnel token and hostnames, built from the seed data korbat's tests use and never from a production backup, and torn
  down after the retest: staging holds no production data or keys.
- **Accounts.** Those of 11.2's seed; the tester enrols their own security keys for the two staff accounts.
- **In scope.** OWASP WSTG 4.2's categories and the API Security Top 10 (2023) against those targets: authentication,
  sessions, CSRF, authorization between accounts and between roles, the console's step-up, input handling, uploads
  with harmless files, the security headers and the policies, the edge's rules, the limits.
- **Out of scope, always.** The path for child sexual abuse material: nothing is uploaded or described to test it, and
  its code (the seal, the quarantine, the release) is reviewed by reading only, as are the order intake and 3f's
  verification steps, the path that can hand over a pseudonymous person's identity. The contact point's mailbox and
  any authority's mail. Real people's data and accounts. Denial of service and load tests. Cloudflare's own systems.
  Social engineering of staff and physical access.
- **Rules.** Testing hours agreed beforehand; at most 5 requests a second unless agreed; a test that reaches any
  personal data stops and is reported at once; findings go to the owner encrypted with age to the owner's public key
  (the backups' tool); the tester deletes every copy of data from staging when the report is accepted. The written
  authorisation to test, the tester's confidentiality and liability are a counsel line beside the scope's acceptance.
- **Deliverables.** Each finding with its CVSS 4.0 score, the steps to reproduce it and the evidence; a retest of every
  fixed finding.
- **What korbat hands over.** The last ZAP reports of the scratch stack (6.2, 6.4), the ASVS mapping (11.3),
  infra/zap/routes.txt, the main design's section 3 and this design's section 6.4.

### 11.2 The tester's seed

scripts/pentest-seed.mjs (Node, no dependency, the smoke test's helpers of scripts/lib/stack-client.mjs) creates on a
staging stack: two ordinary accounts (one with two-factor authentication), one account with posts, images and a
report, a moderator and an admin (roles granted with `staff.js grant-role`, staff enrolment links issued with
`staff.js enroll` for the tester's keys). It writes the accounts' details to a file with mode 0600 and prints only its
path. It refuses to run unless `API_APP_ORIGIN` in infra/.env names `localhost` or a hostname that starts with
`staging.`, as scripts/clean-dev-fixtures.mjs refuses anything but localhost; and it refuses when the database holds
an account it did not create, or when the SHA-256 of `API_AUTH_HMAC_KEY` equals production's, which the checklist has
the owner pass as `--not-key <sha256>`. scripts/test/pentest-seed.test.mjs holds the three refusals.

### 11.3 The ASVS 5.0.0 level 2 mapping and the walk

- **docs/launch/pentest/asvs-5.0.0.json:** the requirements of OWASP ASVS 5.0.0 (CC BY-SA 4.0), copied from the
  project's release on GitHub with its SHA-256 recorded in the file's header, its licence and its attribution, used as
  data.
- **docs/launch/pentest/asvs-l2.md:** one row per requirement of levels 1 and 2: its id, korbat's status (`met`,
  `partly`, `gap`, `N/A`), the evidence (files and tests, or the decision that answers it) and a note. Every `partly`
  and `gap` names a section 14 item, a checklist line or a fix of Task 12. Rows known before the walk: authorization
  between owners (owner-scoped rows, phase one, partly; the other tables' reasons); the app's `style-src
  'unsafe-inline'` (a deviation, decision 29); the second-factor cap, the auth limits per network and the email-code
  lever (met by 4.1 to 4.3); the dependency gate and the secret scan (met by section 5); log contents (met by 6.5 and
  6.6); backups and their encryption (met by section 7; tested by the drill); OAuth and OIDC, self-contained tokens and
  WebRTC (N/A: korbat uses none).
- **The walk** (Task 12): korbat reads each requirement against the code and fills the row with evidence. A gap it
  finds is fixed in Task 12 with a test only when the fix changes at most 60 lines, and all its fixes together at most
  400; anything else becomes a section 14 item and its row says so, so the task's size is known before its dry run.
- **Test.** scripts/test/asvs.test.mjs: every level 1 and 2 id of the JSON has exactly one row with a status; every
  `partly` or `gap` row names a follow-up; the JSON's SHA-256 matches its header.

### 11.4 One counsel list

docs/launch/counsel.md merges, without repeats, every question for a lawyer in the repository and this design: README
"Before going public" item 13 (3f), A4 and B1, B2, B6, B7 (3d), and its counsel paragraph (3c, 3e, 3f, 3d, and 3b's
decision 28: its decisions 4, 14, 15, 16, 18, 25 and 28, and the licence of its 11.3); the 2d design's six questions of
11.3, which the same section lists as Counsel's review of engagement;
L11 (DSA Art. 27), L16 (`silence_days`), L17 (destruction on anything but a recorded leave); this design's
decisions marked (counsel): 22, 27, 33, 35 to 41; and the review's: a restore that brings back erased data as a
breach; the e-Evidence Regulation (EU) 2023/1543 and Directive (EU) 2023/1544, and whether 3f's per-item
preservation suffices; the home state on the terms alone; the server's host and its sub-processors; "Keep me signed
in" against WP194 and Turnstile's provider as a controller; periods for the open-ended entries of 10.1; Art. 9 for
hosted posts and the tools, and Art. 14; what an Art. 18 restriction must stop; DSA Art. 28 if the Art. 19 facts
change; what makes a terms change significant; the pen test's authorisation, confidentiality and liability; likes
revealed by counts after a block (decision 8); the second machine's location and contract (decision 26). Each
question has an id (`C1` onwards), its words, its sources, the
sentence or setting it would change, and what korbat ships until it is answered. They are ordered by what blocks the
opening first: the hard gate's questions (3f's and 3d's A4), then the privacy page and the terms, then each tool's
switch. scripts/test/counsel.test.mjs fails when a decision of this design's section 2 marked (counsel) has no question
naming it, or when one of 2d's six questions (README's counsel paragraph of sub-project 2d) is missing from
counsel.md.

### 11.5 One launch checklist (decision 44)

- **docs/launch/checklist.md** is one table in launch order: `#`, the step, who does it (`owner`, `counsel`,
  `korbat`), what it uses (a file, a script or a README section), how to check it, "If it fails" (the likely cause and
  the first step, or the README section), and `Applied`, which only the owner fills with a date (decision 2).
- **Its parts, in order:** A, the operator's facts (Member State, legal form, staff and turnover; README B3); B, the
  accounts and the domain (Cloudflare, the tunnel and its three hostnames, Turnstile, the EU mail relay with the sender
  domain's SPF, DKIM and DMARC, the IMAP host, each processor's terms signed on the line that opens its account; the
  first green runs of ci.yml and assurance.yml, with their minutes); C, the server (the host's data processing terms
  accepted and its data centre in the EU, the encrypted disk, infra/.env as root 0600, `KORBAT_ENV=production` and the
  settings of README "Before going public", `LOG_DRIVER=journald` and journald's retention of README "The server");
  D, backups (the recipients file, `BACKUP_DIR`, the timer on the server only, the second machine, always on, on
  another network and power supply, with its supported OS, its pull, prune, heartbeat and mail, the first Monday mail
  received, and the first restore drill with `--server` and the keeper's copy); E, the edge (apply.mjs `--apply` with
  a zone-scoped token that expires and is deleted after the final `--diff`, the dashboard checks of 9.3,
  outside-check.mjs with `--burst` from a network only the owner uses, the edge lab, the first month's review of 9.6,
  and, only if decision 33's rule is turned on, `WEB_EDGE_CHALLENGE=on` with it); F, staff (README 3f items 1 to 13
  by number); G, 3d's A1 to A8 and B1 to B7 by number; H, 3b's and 2d's owner steps (their switches and defaults,
  L27's debuggers); I, privacy and the terms (the controller's file, the
  operator's three build arguments, counsel's review and every question of docs/launch/counsel.md answered, the
  impact assessments signed, the first reviewed `TERMS_VERSION`, the breach contacts and the processors' notice
  address named in each contract, docs/launch/privacy/requests.md read); J, the pen test (hired, staging set up as
  README "Staging" says, seeded with `--not-key`, scope accepted, findings decided, retest done, staging torn down);
  K, open (the hard gate's last line, then sign-up opened).
- **README "Before going public"** keeps its detailed items, which other designs cite by number; its hard gate gains
  the line of decision 2, and a pointer to the checklist opens the section.
- **Test.** scripts/test/checklist.test.mjs: every numbered item under README "Before going public"'s heading "The
  owner's list (sub-project 3f)" (1 to 13) and 3d's A1 to A8 and B1 to B7, and those only (the section's other
  numbered list, 2d's counsel questions 1 to 6, is counsel.md's, 11.4), has a line that cites it; every `Applied`
  cell is empty or a date (`YYYY-MM-DD`); no "If it
  fails" cell is empty; every file a line names exists; and the main design's row 4 holds "delivered" or "drilled"
  only beside "4a" or "scratch".

## 12. Testing

### 12.1 Unit and integration tests

Each section's "Tests" names its unit tests (beside each package's existing ones) and its integration tests (in
apps/api/test/integration/, against the runner's PostgreSQL and Valkey), and section 13 lists them per task. Existing
suites that a change binds are named where it binds them (4.2's limits, 4.8's mutes, 6.5's key, 10.6's fixtures);
every other suite passes unchanged.

### 12.2 The scripts' own tests (scripts/test/, `node --test scripts/test/`)

audit-gate.test.mjs (5.3), workflows.test.mjs (5.7), scan-images.test.mjs (5.6), zap-rules.test.mjs (6.3),
leak-check.test.mjs (6.6), backup-units.test.mjs (7.3), heartbeat.test.mjs (8.4), prune.test.mjs (infra/backup/prune.sh
over a temporary folder: a 31-day-old backup deleted, a kept one and a 29-day-old one left, a `KEEP` past its end date
deleted, a day-old `.partial` deleted; it runs where a POSIX `sh` exists, which CI's runner and the scratch machine's
Git Bash give, and the drill runs it inside the backup image's busybox), cloudflare.test.mjs and outside-check.test.mjs
(9.4, 9.5), pentest-seed.test.mjs (11.2), asvs.test.mjs (11.3), counsel.test.mjs (11.4), checklist.test.mjs (11.5).
Fixtures live in scripts/test/fixtures/, built by code or captured in the dry run, never a real person's data.

### 12.3 On the stack

- scripts/smoke-auth-stack.mjs gains the spoofed-header step (4.4) and `--record` (6.6), and runs with `--worst-case`
  after Task 1's sharp upgrade.
- scripts/leak-check.mjs after every smoke run of a stack task from Task 4 on (6.6).
- scripts/restore-drill.mjs at Tasks 5 and 13 (7.6); `systemd-analyze verify` in its container at Task 5 (7.3).
- scripts/heartbeat.mjs against the scratch stack at Task 6 (8.4).
- scripts/zap-scan.mjs: the three baselines and the authenticated one at Tasks 8 and 13 (6.2).
- infra/cloudflare/outside-check.mjs with `--no-edge` at Tasks 9 and 13 (9.5).
- The worker's PIE check at every stack task (5.6).

### 12.4 The lab

apps/api/test/lab/rls/ (4.8): the timeline's plan and time with and without the owner policies, and `set_config`'s
round trip, recorded in section 15.

### 12.5 Gates

- **Every task:** typecheck and unit tests of each package it changes (`pnpm --filter <package> typecheck` and
  `test`), the integration files it creates or changes (not the whole suite), `node --test scripts/test/` when it
  changes a script or its test, scripts/check-lockfile-age.mjs when it changes pnpm-lock.yaml, and the commands of any
  CI job it adds or changes.
- **Batch ends:** the runner's whole integration suite (with the retry and timeout of 5.7); from Task 10 on, also
  `pnpm --filter @korbat/app test:browser`, whose first step holds decision 45's cap; at Task 1 and Task 13, the
  console's browser check too.
- **Stack tasks** (1, 3, 4, 5, 6, 8, 9 and 13): the stack rebuilt, the smoke test, and the PIE check, each exiting 0;
  from Task 4 on the smoke test runs with `--record` and the leak check follows it; and the task's own stack checks of
  12.3.

## 13. Tasks

Thirteen tasks in build order, in nine batches: Task 1 alone; Tasks 2 and 3; Task 4 alone; Tasks 5 and 6; Tasks 7 and
8; Task 9 alone; Tasks 10 and 11; Task 12 alone; Task 13 alone, the record, last. Each runs the gates of 12.5. Before
Task 1 this design is committed as docs/superpowers/specs/2026-10-26-hardening-launch-4-design.md, and the names it
takes from 3b and 2d (2d's last migration number, `activity_items` and `activity_state` and their writers, 3b's
volumes and imports route, `profile.blockBody`) are checked against their replays; any difference is an amendment of
section 15 before Task 1.

**Task 1. The supply chain and CI.** Goal: section 5 (D7, D8, L5). Creates scripts/audit-gate.mjs,
scripts/test/audit-gate.test.mjs and its fixtures, scripts/test/workflows.test.mjs, scripts/test/scan-images.test.mjs,
security/accepted-advisories.json, .gitleaks.toml (and .gitleaksignore if the history scan finds a rotated secret),
.github/workflows/assurance.yml with the images' scan and the SBOM. Changes package.json (`packageManager`,
`pnpm.overrides`), the `vitest` and `@vitest/*` pins of every workspace package, apps/worker/package.json (sharp),
apps/api/package.json (hono), pnpm-lock.yaml, .github/workflows/ci.yml (pnpm 10.34.7; in `checks` the osv-scanner
step, the gate and `node --test scripts/test/` in place of `pnpm audit --audit-level high`; the jobs `integration` and
`secrets`; the PIE check in `docker`), README "Dependency audit". Checks: the frozen install under 10.34.7 leaves the
lockfile unchanged; scripts/check-lockfile-age.mjs; `pnpm audit`, osv-scanner and the gate exit 0; gitleaks over the
whole history, its findings recorded; the `integration` and `secrets` jobs' commands run on the scratch machine, their
time recorded as the scratch machine's; the web export and both browser checks (decision 12's override kept or
dropped by their result). Batch end; stack task: the stack rebuilt, the smoke test with `--worst-case`, the PIE check
` 03 00`.

**Task 2. The second factor and the email lever.** Goal: 4.1 and 4.3 (D1, D3). Creates apps/api/src/auth/mfa-budget.ts,
the migration `hardening_kinds` with its snapshot, apps/api/test/auth/mfa-budget.test.ts, auth/email-limits.test.ts,
integration/mfa-cap.test.ts and integration/email-start-limits.test.ts. Changes apps/api/src/auth/kv.ts
(`spendUnder`) and the auth tests' fake store, auth/flows/mfa.ts, reauth.ts, email.ts, email-change.ts, password.ts
(`setPassword` clears the cap), auth/passkeys/flows.ts (a sign-in clears it), auth/repo.ts (`liveDeviceOf`),
apps/api/src/mail/templates.ts (`mfa_failures`), packages/db/src/schema/auth.ts (the two values),
packages/db/test/enum-literals.test.ts. Not a batch end; no stack rebuild.

**Task 3. Limits per network, the tunnel's guard and the reconcile.** Goal: 4.2, 4.4, 4.5 and 4.7 (D2, D4, D5, L9,
L10). Creates apps/api/test/auth/network-limits.test.ts, integration/media-existing-pages.test.ts,
apps/app/test/limit-words.test.ts and block-words.test.ts. Changes the 13 keys' files (apps/api/src/auth/flows/
password.ts, mfa.ts, email.ts, email-change.ts, signup.ts, reauth.ts, not-me.ts, badge.ts, auth/passkeys/flows.ts,
auth/staff/signin.ts), auth/context.ts (`netHash`, the error body's `retryAt` and `scope`), auth/routes.ts,
auth/staff/step-up.ts, account/routes.ts, staff/routes.ts, middleware/rate-limit.ts (`clientNetKey`), app.ts,
media/routes.ts, 3b's imports route (imports/routes.ts and imports/flows/create.ts; `importsPerNetworkDay` in
packages/contracts/src/imports.ts in place of `importsPerAddressDay`, README:471's sentence and its pin at
apps/admin/test/readme.test.ts:831, and packages/contracts/test/imports.test.ts:168 and
integration/http-imports.test.ts:112 only where they read the import's day limit),
config.ts (`EDGE_TUNNEL`), routes/health.ts, media/repo.ts, social/tiers.ts and
the social write path (social/flows/engagement.ts and the follow's flow), infra/compose.yml (`EDGE_TUNNEL`),
infra/caddy/Dockerfile (`X-Korbat-Edge`), scripts/smoke-auth-stack.mjs (the spoofed-header step, :993-994),
apps/app/src/lib/ui-words.ts (`profile.blockBody`, the limits' sentences),
docs/superpowers/prompts/foundation/16-cloudflare-tunnel.md (its first line), and the 1a design's amendments section
(4.2). Tests: those created, and middleware.test.ts, architecture.test.ts, config.test.ts,
integration/health.test.ts, social/limits.test.ts, integration/rate-limit-redis.test.ts,
integration/http-social.test.ts, the nine sites and six harnesses of 4.2, every inline `RequestContext` of the HTTP
staff tests and of apps/api/test/account/deletion.test.ts, which a required `netHash` changes too (the typecheck
finds them), and every test that spends one of the 13 limits. Batch end (Tasks 2 and 3); stack task: the smoke
test with its new last step.

**Task 4. Logs and addresses.** Goal: 4.6 and 6.5 to 6.6 (D6, decisions 20 to 24). Creates packages/log/
(package.json, tsconfig.json, vitest.config.ts, src/index.ts, src/scrub.ts, test/scrub.test.ts),
apps/api/src/auth/ip-key.ts, scripts/lib/stack-client.mjs, scripts/leak-check.mjs, scripts/test/leak-check.test.mjs and
its fixtures, apps/api/test/auth/ip-key.test.ts, integration/ip-key.test.ts, observability.test.ts. Changes
apps/api/src/lib/logger.ts, apps/api/test/logger.test.ts (its cases moved), apps/api/package.json,
apps/worker/package.json and 3b's apps/importer/package.json (`@korbat/log`), apps/worker/src/index.ts,
apps/importer/src/index.ts, apps/api/src/notify/main.ts,
apps/api/src/middleware/observability.ts, apps/api/src/auth/client-ip.ts, auth/index.ts and auth/context.ts (the ring),
auth/janitor.ts (the daily `BGREWRITEAOF`), apps/api/src/config.ts (`IP_HASH_KEY` removed), packages/contracts
(`LOG_KEEP_DAYS`), infra/compose.yml (PostgreSQL's two settings, `IP_HASH_KEY` removed, `LOG_DRIVER`),
infra/.env.example, apps/api/.env.example (scripts/gen-dev-env.mjs only if its test names the key),
scripts/smoke-auth-stack.mjs (`--record`, its
helpers moved), the test files of 6.5 that name the key, apps/api/test/architecture.test.ts, pnpm-lock.yaml. Batch
end; stack task: the stack rebuilt, the smoke test with `--record`, the leak check exits 0.

**Task 5. Backups and restore.** Goal: section 7 (L3, L7, L14, L23; decisions 25 to 28). Creates the migration
`backups` with its snapshot, packages/db/src/schema/operations.ts (`backup_runs`), infra/backup/Dockerfile,
backup.sh, restore.sh, prune.sh, korbat-backup.service, korbat-backup.timer, apps/api/src/lib/erasure-journal.ts,
apps/api/test/integration/erasure-journal.test.ts, scripts/restore-drill.mjs, scripts/test/prune.test.mjs,
scripts/test/backup-units.test.mjs, docs/launch/restore.md, docs/launch/keys.md. Changes
packages/db/src/schema/index.ts, the account's purge (apps/api/src/account/flows/deletion.ts), the post's deletion
(apps/api/src/social/flows/posts.ts), 3b's undo of an import (`removeImportedBatch`,
apps/api/src/social/flows/imports.ts) and 2d's picture removal (the media module's `dropFormerAvatar`,
apps/api/src/media/index.ts, which `removeAvatar` and a new picture reach) with integration/imports-undo.test.ts and
integration/http-avatar.test.ts, and the retention job (the journal, its days, `prune_backup_runs`),
apps/api/src/cli/restore.ts (`erasure-replay`), infra/compose.yml (the service `backup`, the `ERASURE_DIR` mount),
infra/.env.example (`BACKUP_DIR`,
`BACKUP_RECIPIENTS`, `ERASURE_DIR`), scripts/gen-dev-env.mjs, .github/workflows/ci.yml (`systemd-analyze verify`) and
assurance.yml (the stack and the drill), packages/db/test/schema.test.ts. Checks: the drill's output (7.6) with its
numbers recorded; the units verified in their container. Not a batch end; stack task: the stack rebuilt with the
backup image, the smoke test, the leak check, the drill.

**Task 6. Alerts and the heartbeat.** Goal: section 8 (decisions 30 and 31). Creates the migration `alerts` with its
snapshot, scripts/heartbeat.mjs, scripts/test/heartbeat.test.mjs, packages/contracts/src/docs.ts
(`renderAlertPage`), packages/contracts/test/generated-docs.test.ts, docs/launch/alerts.md,
apps/api/test/integration/alerts-hardening.test.ts. Changes packages/contracts/src/orders.ts (the four kinds in
`ALERT_KIND_LIST`, `ALERT_KINDS`, `ALERT_TEXTS`, `ALERT_RULES`), packages/contracts/package.json (`gen:docs`),
packages/db/src/schema/safety.ts (the check), packages/db/src/schema/auth.ts (the BRIN index),
apps/api/src/moderation/alerts.ts (the tick's three checks, `TICK_MAILED_KINDS`, the `onServerError` counter),
apps/api/src/mail/templates.ts, the auth module's `failureCount` (apps/api/src/auth/repo.ts and auth/index.ts),
apps/api/src/media (the free-space reading the tick asks for), apps/api/src/middleware/observability.ts and
apps/api/src/app.ts (`AppDeps.onServerError`), apps/api/src/config.ts (`BACKUP_ALERT`), infra/compose.yml
(`API_BACKUP_ALERT`), infra/.env.example, packages/contracts/test/orders.test.ts, packages/db/test/schema.test.ts,
apps/api/test/mail/moderation-templates.test.ts. Checks: the heartbeat against the scratch stack (8.4). Batch end
(Tasks 5 and 6); stack task: the stack rebuilt, the smoke test, the leak check.

**Task 7. Owner-scoped rows, phase one.** Goal: 4.8 (L6, L24; decision 9). Creates the migration `owner_rows` with its
snapshot, apps/api/src/lib/scope.ts, apps/api/test/integration/rls-owner.test.ts, apps/api/test/lab/rls/README.md and
cost.sql. Changes packages/db/src/schema/helpers.ts (an `ownerAccess` policy helper), packages/db/src/schema/content.ts
(the two tables' policies), apps/api/src/social/repo.ts (each statement 4.8 names), the social flows that call them,
2d's activity module (apps/api/src/activity/repo.ts), its statements in social/repo.ts and its tables' policies
(packages/db/src/schema/activity.ts), packages/db/test/schema.test.ts, and the test files of 4.8
(moderation-decisions.test.ts, social-repo.test.ts, test/lab/standing.lab.ts, and 2d's three that its tables' policies
bind: integration/activity-schema.test.ts, account-deletion.test.ts and account-export.test.ts). Checks: the lab run
on the scratch database, its numbers recorded; the list of 2d's statements recorded, five for `activity_items` and
two for `activity_state` (decision 9's count). Not a batch end; no stack
rebuild.

**Task 8. The scans.** Goal: 6.1 to 6.4 (decisions 18 and 19). Creates scripts/zap-scan.mjs, infra/zap/rules.tsv,
infra/zap/korbat.context, infra/zap/active.yaml, infra/zap/routes.txt, apps/api/test/zap-routes.test.ts,
scripts/test/zap-rules.test.mjs. Changes .github/workflows/assurance.yml (the smoke test with `--record`, the leak
check, ZAP's baselines). Checks: every baseline and the authenticated one clean (6.3), every verdict recorded; the
active scan run once by hand, its report kept for the pen tester and its findings recorded. Batch end (Tasks 7 and 8);
stack task: the stack rebuilt, the smoke test, the leak check, the scans.

**Task 9. The edge.** Goal: section 9 (decisions 32 and 33). Creates infra/cloudflare/custom-rules.json,
ratelimit-rules.json, zone-settings.json, apply.mjs, outside-check.mjs, scripts/test/cloudflare.test.mjs,
scripts/test/outside-check.test.mjs, apps/api/test/edge-rules.test.ts. Checks: apply.mjs `--check` passes;
outside-check.mjs `--no-edge` passes against the scratch stack. Batch end; stack task: the stack rebuilt, the smoke
test, the leak check, the outside check.

**Task 10. Privacy.** Goal: 10.1 to 10.5 and 10.7 (L11 to L13, L21, L25; decisions 35, 36, 38 to 41 and 45). Creates
packages/contracts/src/data-map.ts, apps/api/test/data-map.test.ts, apps/app/src/app/privacy.tsx,
apps/app/src/lib/privacy.ts, apps/app/test/privacy.test.tsx, docs/launch/privacy/record.md, controller.json, dpia.md,
breach.md and requests.md. Changes packages/contracts/src/docs.ts (`renderRecord`), packages/contracts/src/index.ts,
apps/api/src/auth/janitor.ts and integration/auth-janitor.test.ts (the constants moved),
apps/api/test/architecture.test.ts (key prefixes and volumes), the sign-in flows and the session's cookie writer
(`remember`) with integration/http-auth.test.ts, the sign-in and sign-up screens, apps/app/src/lib/terms.ts ("Your data"),
apps/app/test/terms.test.tsx and explore.test.tsx, the Settings index, the export's screen and the context column's
links, apps/app/test/browser/app.browser.ts and fixture-api.ts, infra/compose.yml and infra/caddy/Dockerfile
(`WEB_OPERATOR`, `WEB_SUPERVISORY_AUTHORITY`, `WEB_SERVER_HOST`, `WEB_EDGE_CHALLENGE`),
packages/contracts/test/generated-docs.test.ts, and, only under decision 45, app.browser.ts:634-635 and README:462.
Checks: the web export measured by baseline.json's method and recorded, and decision 45's steps taken if it is past
the cap. Not a batch end; no stack rebuild.

**Task 11. The terms.** Goal: 10.6 (L2; decisions 37 and 45). Creates packages/contracts/src/terms.ts,
packages/contracts/test/terms.test.ts, the migration `terms` with its snapshot, apps/api/src/auth/flows/terms.ts (the
acceptance, `seen`, the mail's batches), apps/api/test/integration/terms-accept.test.ts,
apps/app/src/app/terms-changed.tsx, apps/app/test/terms-changed.test.tsx. Changes packages/db/src/schema/auth.ts
(`terms_acceptances`), apps/api/src/config.ts (`TERMS_VERSION` from the constant) and the five config fixtures of 10.6,
apps/api/src/auth/flows/signup.ts, auth/repo.ts (the acceptance, `finishPurge`), auth/routes.ts and `/api/me`,
apps/api/src/mail/templates.ts (`terms_changed`), apps/api/src/moderation/alerts.ts (the tick sends the mail),
apps/api/src/account/flows/export.ts, apps/api/src/app.ts, the app's shell and the words modules, infra/compose.yml
(`API_TERMS_VERSION` removed), infra/.env.example, apps/api/.env.example, the test environment file
(scripts/gen-dev-env.mjs only if its test names the key), scripts/smoke-auth-stack.mjs (`--terms`' default), and,
only under decision 45, app.browser.ts:634-635 and README:462. Checks: the web export measured again by
baseline.json's method and recorded, and decision 45's steps taken if it is past the cap. Batch end (Tasks 10 and
11), with the
app's browser check; no stack rebuild.

**Task 12. The walk, the pen-test kit, counsel and the checklist.** Goal: section 11 (decisions 2, 43 and 44).
Creates docs/launch/pentest/scope.md, asvs-5.0.0.json (fetched once from the OWASP ASVS release, its SHA-256
recorded), asvs-l2.md, scripts/pentest-seed.mjs, docs/launch/counsel.md, docs/launch/checklist.md,
scripts/test/pentest-seed.test.mjs, asvs.test.mjs, counsel.test.mjs and checklist.test.mjs. Changes what the walk
fixes within 11.3's bound (at most 60 lines a fix, 400 in all), each with its test, and section 14's list for the
rest. Batch end; no stack rebuild.

**Task 13. Documentation and the stack.** Goal: the record. README.md: new sections The tunnel (4.4), Privacy (the
data map, `/privacy`, docs/launch/privacy/), The server (`LOG_DRIVER`, journald's retention) and Staging (11.1);
Backups and Restoring rewritten (section 7: the service, the timer, the pull, `KEEP`, what is never backed up, the
erasure journal, the restore and its check); Upgrading (4's paragraph, placed as 2d's was,
above 3b's and 3f's lines, since 3f's part may hold only 3f's numbers: 4's migrations 0054_hardening_kinds to
0058_terms by name and which is slow, if any, as the dry run measures it (4.9); `API_IP_HASH_KEY` must be deleted,
`API_TERMS_VERSION` can be); Dependency audit (5.3); Tests (the CI jobs' commands and times on the scratch machine,
the scripts' tests); Full
stack (`--record`, the leak check, the scans, the drill); The edge (infra/cloudflare/, 9.3's list); Posting and feed
(4.7); Profile and account (the second-factor cap, the limits per network at :441, the email-code buckets, Keep me
signed in, a new terms version); Before going public (the checklist's pointer and the gate's new line). The main
design: row 4 reads "4a delivered (files and tests); open until every owner line of docs/launch/checklist.md has a
date"; section 9 gains, after 2d's entry of 2026-10-29, "<the day 4a is delivered>, sub-project 4" (line 129's edge
rules as files; line 136's salted hash as a key in memory; line 138's row-level security, phase one; lines 139 and
156's backups, built and drilled on the scratch stack, the server's drill being checklist part D; line 141's nonces,
scripts only (decision 29); lines 158 and 268's ZAP and audit, weekly and per push; line 160's alerts; line 269's
ASVS walk, done as a mapping; the decisions of section 2; status and order: next 5 native builds, and the opening by
the owner's checklist). This design's section 15 from the dry run. Batch end (the whole suite, both browser checks);
stack task: the stack rebuilt from clean, the smoke test, the leak check, the scans, the drill and outside-check.mjs
`--no-edge`.

## 14. What is left for later

- **Owner-scoped rows beyond phase one.** The other tables in groups, starting with the private relations (likes as
  lists, follows' private views, devices and sessions through the auth role), each group with the lab's numbers and
  its own tests.
- **pnpm 11** (`pnpm sbom`, the renamed audit settings), a task of its own; urgent the day pnpm 10's audit endpoint
  stops answering, since the gate then fails by design.
- **A linter** (Biome, correctness rules only), a task of its own (decision 17).
- **Betterleaks** in place of gitleaks once it leaves release candidates (decision 16).
- **Container restarts as alerts**, through a watcher of Docker's events on the host (8.3).
- **The app's styles without `'unsafe-inline'`**, if the styling ever moves to class names only (decision 29).
- **The edge with traffic data:** the rate rule's numbers, per-address limits for imports and cards (L22, L26), a
  paid plan if needed.
- **The external pen test's findings** and their retest, a task after the owner's test (decision 43).
- **The walk's larger gaps**, each a row of asvs-l2.md beyond Task 12's bound (11.3).
- **Waiting for the owner or counsel:** the R1 classifier's and a real matcher's adapters (L18), `silence_days` (L16),
  destruction on anything but a recorded leave (L17), the first reviewed `TERMS_VERSION`, and the periods of the
  open-ended entries of 10.1.
- **If korbat outgrows DSA Art. 19(1):** the Transparency Database submitter and the yearly report in the Commission's
  template (L19).
- **Sub-project 5:** the web manifest, service worker and offline page with the icons (L20, decision 42); the terms
  banner, `DEVICE_STORAGE`, Keep me signed in and the second-factor cap's mail on native; whether Bot Fight Mode stays
  off for the native apps' traffic.

## 15. Amendments from the dry run
