# korbat engagement (2d) — Task 7 of 7: The record of engagement: the README's Activity, Share cards and search engines, Profile pictures, budget, upgrade notes and counsel's six questions, the lines 2d made false corrected, the main design's row 2d and dated section 9 entry, and the UI design's 2d line marked delivered.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-28 to 2026-10-29 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 7 is the last task of sub-project 2d (engagement) and a batch end of its own with no stack rebuild: it writes the record of Tasks 1 to 6 and changes no code, test or migration. It follows docs/superpowers/specs/2026-10-22-engagement-2d-design.md section 13's Task 7, with sections 2 (the thirty decisions, counsel's 11, 20, 21 and 28), 5, 6.8, 7, 8.2, 8.6, 8.7, 10.9, 11.1, 11.3 (counsel's six questions) and 14; section 15 is filled from the tasks' amendments by the orchestrator.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,app,admin,infra,scripts): share cards, indexing and the terms: the cards module answers GET /api/cards/post/:id and /api/cards/profile/:handle beside the status route, after the global limit and before the session, 204 with the head block in Korbat-Card or 404 with no body, from the signed-out reads and the owner's link-preview switch (the social module's forCards and sharePreviewsOf); cardBlock writes 8.3's tags in order, every value escaped with the template delimiters as character references, a generic card while previews are off, the image's description cut last to keep 4,096 bytes; X-Robots-Tag noindex on every API answer; Caddy's /post/* and new /u/* ask the card route without Range and serve card.html through templates for 204, the plain shell with 404 or 200 otherwise, noindex on every page that can name an account, /card.html 404; the image writes card.html and copies robots.txt; the card lab and crawlers.json; the Caddyfile's readers learn /u/*; the terms' four drafts by ACTIVITY_KEEP_DAYS; smoke step 23`.

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
python docs/superpowers/prompts/engagement-2d/write_blocks.py docs/superpowers/prompts/engagement-2d/07-engagement-record.md 1
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
node scripts/gen-dev-env.mjs                # creates or completes infra/.env, apps/api/.env, apps/app/.env, apps/worker/.env and apps/importer/.env, and derives apps/api/.env.test; values are random and never printed
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis counts mailpit   # dev host ports 55432, 56379, 56380, 51025, 58025 (movable: DEV_*_PORT in infra/.env)
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health; reads apps/api/.env
pnpm --filter @korbat/worker dev            # the image worker; reads apps/worker/.env and works on .data/media
pnpm --filter @korbat/importer dev          # the importer of archives (3b); reads apps/importer/.env and works on .data/import, which the API's IMPORT_*_DIR name too
pnpm --filter @korbat/app web               # http://localhost:8081
pnpm --filter @korbat/admin dev             # the staff console at http://localhost:8090 (never 127.0.0.1); forwards /api/staff/* to the API above
```

Emails sent in development (sign-in codes, new-device alerts, lockout notices) land in Mailpit at http://localhost:58025. Locally the web app uses Cloudflare's always-pass Turnstile test key, so the human check never blocks you.

The data services are PostgreSQL 18 and Valkey (the BSD-licensed fork of Redis, still under the service name `redis`, on its own volume `valkeydata`: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into the old `redisdata` volume, which held only transient state and can be removed with `docker volume rm`). Valkey needs the password from `infra/.env`; `gen-dev-env` writes it into the API's `REDIS_URL` too, so an older `.env` is fixed by running it again. The recipients' count (the day's key and the counting sketches of the transparency page) lives in a Valkey of its own, the service `counts`, which writes nothing to disk: no append-only file, no snapshot, no volume. A restart of `counts` loses the running month's count, which then reads "not recorded"; nothing else is kept there. It takes the same password, and the API reads it as `COUNTS_URL`, which Compose sets.

korbat once ran MinIO and never used it. Images live on two Docker volumes instead, `media-uploads` and `media-store`. If an old stack left a `korbat_miniodata` volume behind, `docker volume rm korbat_miniodata` removes it.

## Tests
```bash
pnpm test                                     # unit tests of every package
node scripts/test-db.mjs                      # creates or migrates the korbat_test database; run it again after adding a migration
pnpm --filter @korbat/api test:integration    # needs postgres, redis and mailpit up
```

Integration tests have their own database, `korbat_test`, and their own Redis database, 15. Both are named in `apps/api/.env.test`, which `node scripts/gen-dev-env.mjs` derives from `apps/api/.env`. Every run starts by emptying them, and refuses to start if a URL points anywhere else, so tests never touch development data.

Before they had their own database, the integration suites left accounts, profiles and posts in the development database, and the smoke test still leaves its first account per run, by then a moderator, with one open moderation case on that account's post. To see and remove them:

```bash
node scripts/clean-dev-fixtures.mjs          # lists test accounts and profiles without an account; deletes nothing
node scripts/clean-dev-fixtures.mjs --yes    # deletes them with everything they made
```

It only matches emails of the tests' shape, `<word>-<uuid>@korbat.local`, recomputes the counters of kept profiles and posts they touched, and refuses to run unless `API_APP_ORIGIN` in `infra/.env` is a localhost origin. It keeps an account that holds a staff key or that the moderation record names (one that decided anything, one on either side of a staff link, the subject of a case that a decision or a reveal names), and counts it as kept; every other case about a deleted account or one of its posts is deleted with it, the smoke test's open case included.

## Full stack
```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build   # http://localhost:8080, and the staff console at http://localhost:8090
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:8090 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

The smoke test first checks the staff console's site: its page carries the console's own policy and is never stored, and the staff API answers there (401 without a session) and nowhere else (Caddy's own 404 on the app's site); the console's case routes (the overview, the queue, a case, the appeals) answer the same two ways, and the console's site refuses the app's own moderation routes with a 404 of its own. It then signs up a throwaway account through Caddy, reads its code from Mailpit, posts and reads the post back from the public Latest timeline. It uploads a JPEG carrying a GPS position, posts it, and checks that the served file is a fresh WebP without metadata, that a symlink planted in the store from inside the worker gets a 404, and that deleting the post removes the image from disk. It checks the worker's isolation. It gives the account a profile picture, a JPEG sent with `kind=avatar&crop=centre` and cut square by the real worker, which the account's post then carries, and reads the post's and the profile's pages as Twitterbot asks for them: the generic card while link previews are off, and once they are on the full card, with a display name made of template delimiters printed as text (Share cards and search engines). Then it imports a Mastodon archive the script builds: sent in chunks through Caddy, read by the real importer in its isolation, confirmed, its four posts read on the profile's Imported tab and in no feed, and removed again with Remove imported posts. Then it grants the account a staff role with the CLI and checks that its session was revoked. A second throwaway account edits its bio, changes its handle, reports the first account's post under a rule, finds that report undecided in its own list and in its export's member `moderation`, followed by its imports (none) and its Activity, and deletes itself. Last, signed out, a notice that the same post is illegal is taken with the human check: it answers a reference and a token, the status page opens with that token, the receipt arrives in Mailpit, and the token in the receipt's link opens the same page. Nothing in it decides the case, since a decision needs a staff key: every run leaves one open case in lane 2 on the first account's post. One network can run it five times an hour and five times a day, since its two sign-ups count against the hourly sign-up limit, its signed-out notice against the limits of reports sent without an account, and its import against the imports started from one address in a day.

After every sharp upgrade, add `--worst-case`: it also uploads flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP progressive JPEG, 48 MP GIF, 16 MP AVIF), expects each to be ready without the worker being OOM-killed or restarted, and prints the worker's memory peak.

Caddy listens on 8080 inside its container as its own user, proxies `/api` to the API and serves the web app with the page's security headers; `index.html` is revalidated on every load and the hashed bundles are cached for a year. On 8090 it serves the staff console under the console's own policy and proxies only `/api/staff/*`, which the app's site refuses. On 8091 it serves the phones' push site: only the two alert topics' subscriptions reach ntfy, and every other path is Caddy's own 404. The compose file keeps cloudflared, Caddy, the API and the data services on separate networks, so cloudflared reaches only Caddy and Caddy only the API and ntfy. Under the Compose profile `notify`, the contact point's watcher (`notify`) and the push server (ntfy) join two networks of their own: `push`, which has no route out and whose clients the app's and the console's sites refuse with 403, and `watch`, which holds the watcher and PostgreSQL and nothing else. With the profile on, add `--push http://localhost:8091` to the smoke test: it checks that the push site answers ntfy's own API with 404 and hands a subscription to ntfy, and that from the push network the app's and the console's sites answer 403.

## Upgrading PostgreSQL

The stack runs PostgreSQL 18 on the `pgdata18` volume. A database from the earlier PostgreSQL 16 volume (`pgdata`) is moved by:

```bash
node scripts/pg-major-upgrade.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

It dumps the old cluster with the old image in a throwaway container, starts the new server, restores the dump with every owner kept, and compares the row counts. The old volume stays until you remove it; the test database is created again by `node scripts/test-db.mjs`. Run `staff.js audit-verify` with every kept place before and after a major upgrade; Before going public says why.

## Upgrading

Engagement (sub-project 2d) adds the migrations `0049_activity`, `0050_post_options`, `0051_avatars`, `0052_avatar_kinds` (two values of `action_kind` and nothing else) and `0053_avatar_moderation`, which the migrate service runs in one transaction on a database at `0048_import_staff_end`. `0051_avatars` is the one that reads every row of `post_media`: it validates its three new CHECKs (`post_media_kind_place`, `post_media_avatar_owner` and `post_media_avatar_sha256`) and builds two partial indexes (`post_media_avatar_idx` and `post_media_owner_avatar_idx`), so on a large image table the migrate service runs for a while and the API, which starts only once it has finished, starts late; it also drops `profiles.avatar_path`, which nothing ever wrote. Rebuild the API, the image worker and Caddy together, as the next `up --build` does: the worker writes every result as version 3, which an API from before 2d refuses, and reads an avatar's job file, `incoming/<id>.avatar`, which only the 2d API writes; Caddy's image carries `card.html` and `robots.txt` and asks the API's card routes for every `/post/*` and `/u/*` page, which an API from before 2d answers with 404, so every such page would be the plain shell with 404. No service, volume or setting is added (Activity; Share cards and search engines).

Import from other platforms (sub-project 3b) adds the migrations 0043 to 0048, the service `importer` and its two volumes, `import-archives` and `import-work`, which the next `up` builds and creates; neither volume is backed up (Backups). No setting is needed: imports start on, for X and Mastodon, text only (Importing posts). `0045_import_readers` is the slow one: on `posts` it drops `posts_latest_idx` and builds it again with a new predicate, and builds `posts_imported_idx` and `posts_author_native_idx`, so on a large `posts` table the migrate service runs for a while and the API, which starts only once it has finished, starts late; leave the upgrade's window room for it.

Authorities' orders and the alert channel (sub-project 3f) add a database role for the contact point's watcher, two services under a Compose profile, the hand-over's service under another, the report hold, and two arguments of the web build.

- On a database that exists, give the role its password and create it, with its USAGE on the schema `public`, once, as the superuser and against korbat's own database, before the first 3f migration: set `KORBAT_NOTIFY_DB_PASSWORD` in `infra/.env` (`node scripts/gen-dev-env.mjs` does in development), run `docker compose -f infra/compose.yml up -d postgres`, which passes it to the database's container, then the command below. Run twice, it changes nothing. The grant cannot be made by the migration: the migrator does not own the schema, and its grant would be a warning and nothing more. The migration checks both and stops with "create the role korbat_notify first" when either is missing, so a half-done upgrade stops there and not at a watcher that cannot read a row. A new data directory gets both from `infra/postgres/init/01-roles.sh`.

```bash
docker compose -f infra/compose.yml exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v pw="$KORBAT_NOTIFY_DB_PASSWORD"' <<'SQL'
SET korbat.notify_pw = :'pw';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'korbat_notify') THEN
  IF current_setting('korbat.notify_pw') = '' THEN RAISE EXCEPTION 'KORBAT_NOTIFY_DB_PASSWORD is empty in the postgres container: set it in infra/.env, then up -d postgres'; END IF;
  EXECUTE format('CREATE ROLE korbat_notify LOGIN PASSWORD %L', current_setting('korbat.notify_pw'));
END IF; END $$;
GRANT USAGE ON SCHEMA public TO korbat_notify;
SQL
```

- `notify` and ntfy run under the Compose profile `notify`. Switch it on in one place, `COMPOSE_PROFILES=notify` in `infra/.env`, which Compose reads for every command: the README's commands stay as they are, and an upgrade then recreates the two services with the rest. Without that line they are never started, or keep running an old image against a migrated database.
- Until the contact-point mailbox exists, leave the profile off and set `API_NOTIFY=off`: korbat then says on the console's home screen that phone alerts are switched off on this server, and mails no "Phone alerts are down". No setting of `notify`, ntfy or the hand-over is needed for the stack to start.
- The quarantine's service (`quarantine`, sub-project 3d) runs under the Compose profile `quarantine`, which stays off: the operator starts it by hand with the steps under Quarantine. Its volume `media-quarantine` is created by its first run, owned by the API image's user; the hand-over's service now mounts it too, read-only. It needs no setting, and nothing of it is backed up.
- The hand-over's service (`handover`) runs under the Compose profile `handover`, which stays off: the operator starts it by hand for one hand-over, with the directory on its command line (Authorities' orders, Notifications and hand-overs). It needs no setting.
- The report hold is on from the upgrade: while a report of sealed images to the authorities is owed, the deletion of the account keeps its address, and nothing else, for at most 7 days. `API_REPORT_HOLD=off` in `infra/.env` ends the practice for everyone and deletes as before; set it only on counsel's advice.
- The web build takes `WEB_CONTACT_POINT` and `WEB_HOME_STATE` from `infra/.env` for the terms (the contact point for authorities and korbat's Member State). Neither is required, and both stay empty, or the state alone set, until the last step of Before going public; `node scripts/gen-dev-env.mjs` adds the two lines to an existing file without changing a value. Rebuild the caddy image after a change of either.

## Backups

The backup of `media-store` is deleted 30 days after it was taken (`RETENTION.backupDays`, which the terms publish), without exception but an authority's written demand. `media-quarantine` is never backed up (Quarantine, step 4). `import-archives` and `import-work` are never backed up either, by design: an archive holds the person's messages and other people's data, and lives at most 24 hours, and the importer's output at most 72 hours after its scan (Importing posts).

## Restoring

Restore the database and the `media-store` volume from the same moment. Keep the `media-store` volume as it was before the restore (copy it aside) until the Quarantine steps of Restoring the releases below have run: a file that a lifted seal returned from the quarantine after the backup is in that copy and in neither restored place. `counts` holds nothing to restore: its running month reads "not recorded". The API's sweeper deletes images that have no row: after a database restored from an older snapshot it would delete every image posted since. It refuses when there are many such images, but for a restore window set `MEDIA_RECONCILE=off` in `infra/.env` before starting the API, and put it back to `on` once the store matches the database. `force` makes one pass delete them anyway, for when they really are orphans.

Keep no backup of the database or of `media-store` more than 30 days after it was taken (`RETENTION.backupDays`, which the terms publish), and delete older ones, except a backup that korbat must keep for the authorities (step 5), which you keep until they have answered. A backup holds what korbat erased after it was taken, among it content erased under rule R4.

The staff steps run with the api service stopped (`docker compose -f infra/compose.yml stop api`), before it starts again, with the commands under Staff console and Moderation; step 5 says which of its parts wait until the API runs again:

1. Run `staff.js audit-head` on the restored database. Its place and hash go to the keeper with the restore's date: new rows will take the places lost with the backup's later rows, with other hashes, so every place kept after the backup would fail as a rewrite does. The keeper retires those places with that note, `audit-verify` runs from then on with the places at or before the restored one, and a failing place that no announced restore explains is a rewrite.
2. Run `staff.js revoke <email> all` for every account `staff.js keys` lists, since the restore brings back every staff key, staff session and enrolment link revoked or cancelled after the backup, and the auth events and audit rows that recorded those revocations are gone with it.
3. Run grant-role for every staff account with the role on your own list, and `user` for any other account `staff.js keys` lists, as after an API incident: it sets back any role changed after the backup and ends every session and staff session of the account, app sessions revoked after the backup included. Then compare the accounts `staff.js keys` lists with that list.
4. Each person enrols again, two keys each.
5. Moderation. Every decision, review and seal confirmed after the backup is gone with its audit rows, and what it restricted is back: sealed images are served again, and a removed post is public again. Reports, notices and re-examinations received after the backup are gone too, and so is everything `staff.js` wrote since: links and unlinks and limits. So are the stops that people pressed on a report's page after the backup, and the report mail that accounts resumed in Settings since; korbat may mail such an address about reports again, though its holder asked it to stop, until they press stop again, and an account that resumed its report mail gets none until it resumes again. Nothing on the server or in your records names them, so none can be applied again. Nothing on the restored server names the lost decisions either: the keeper's daily copy names them, and the orders and records to authorities, up to the keeper's last download, and Restoring with the keeper's copy below takes each lost measure again from it. So before the api service starts again after step 3, set `APP_SITE=closed` in `infra/.env` and recreate Caddy alone with `docker compose -f infra/compose.yml up -d --no-deps caddy` (Caddy reads the setting only when it is created, and without `--no-deps` Compose would start the API with it), which closes the app's site and leaves the console's open, as that block's first step says; check from outside that the app's hostname answers 503. Before it starts, also delete the moderation dispatch's daily markers, which live in Valkey and are not restored with the database: `docker compose -f infra/compose.yml exec -T redis sh -c 'export VALKEYCLI_AUTH="$REDIS_PASSWORD"; valkey-cli --scan --pattern "*moderation-dispatched:*" | while read -r k; do valkey-cli del "$k"; done'`. The dispatch's first round then releases again every outcome and changed outcome that was answered before the day's dispatch hour and not yet released at the backup, so the status pages, the re-examination windows and the mails agree again; a person whose outcome mail or statement went out after the backup's time gets it a second time. Before it starts, also set `API_MODERATION_RETENTION=off` in `infra/.env`, which the API reads when `docker compose -f infra/compose.yml up -d api` starts it. The restored database no longer holds the cases, freezes and seals made after the backup. From its first round, 10 minutes after the start, the retention job would make R4 redactions final, erase case evidence and delete the images that these cases, freezes and seals no longer protect. That includes images sealed and reported to the police since the backup, long before an admin has enrolled and sealed them again. While the switch is off nothing is erased or deleted but the fingerprints and ratings of an automated tool that is off (Automated tools), and the console's count of late erasures rises. Before anyone decides anything, run `staff.js link` and `staff.js unlink` until the links match your records, and check that the count `staff.js keys` prints for each staff account equals your records'; then run `staff.js limits` with the numbers you last set. Once the staff have enrolled again, an admin first opens a finding citing R2 on every post or account that your R2 records show was sealed after the backup's time, unless its case is open in the restored database, and seals its images again. Only then, once every such seal has been applied again, set `API_MODERATION_RETENTION=on` in `infra/.env` and run `docker compose -f infra/compose.yml up -d api`, which recreates the API with it, and open the app's site again when the console's After a restore screen says so (`APP_SITE=open`, then `docker compose -f infra/compose.yml up -d --no-deps caddy api worker`: the API and the worker read the setting only when they start, and refuse a `test` adapter on an open site). Its next rounds make up the erasures that fell due meanwhile. Then tell the authority each of these was reported to what was lost and when it was sealed again, and keep the backup you restored from until that authority has answered, also past the 30 days. Sub-project 3d adds the release of sealed images and its replay after a restore. Then the cases that were open at the backup are open again in the queue: decide them again at once, lane 0 first. Each moderator also opens a finding on any other target they remember restricting since the backup's time.

**Restoring with the keeper's copy** (sub-project 3f). The keeper's daily copy of the audit log's tail (Staff console, the audit log's "Download since my last copy") names the orders, the records to authorities and the decisions the backup lacks, up to the keeper's last download. These steps come after the staff steps above; where they and step 5 differ, these hold.

1. Before the API starts: `API_MODERATION_RETENTION=off`, `MEDIA_RECONCILE=off` and `APP_SITE=closed` in `infra/.env`, which the API reads when `docker compose -f infra/compose.yml up -d api` starts it in step 5; then recreate Caddy alone with `docker compose -f infra/compose.yml up -d --no-deps caddy`, since Caddy reads `APP_SITE` only when it is created, and check from outside that the app's hostname answers 503 to every path (`curl -s -o /dev/null -w '%{http_code}' https://<app hostname>/`); the console's site is unchanged.
2. Feed the import every keeper's file from the one that holds the restored head's place onward, oldest first, concatenated on standard input: `cat <files> | docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js restore-import <kept places>` (`-T`: without it Compose attaches a terminal and the redirect fails). The files need not start at the head: the import checks the earlier lines and skips them. A changed file is refused whole and nothing is written; a hole between two files is printed, and what lies behind it is not imported. Read what it prints, a hole among it.
3. Compare the contact-point mailbox since the keeper's last download with the orders it lists; open what is missing with `order-open --received`. An imported item whose link named no post shows `sha256:` and a digest in place of the link, since the copy holds no link's text: read the address from the order in the mailbox. Enter the records of class "record" again from the authority's letters, each with its command and `--gap <gap>`, which closes that gap. Until the last of them is entered, answer no data request: `access-request` cannot print an authority's "not to the person" mark for a record that is still lost.
4. Still before the API starts, record the restore of the audit log's daily value: `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js head-restore-mark <day>:<value> ...`, with the values of the keeper's mails for the days after the backup, each a day and its value as the mail gives them. Each is shown on `/transparency` as retired, every published value that the restored log no longer gives is retired too, none is deleted, and today's row says that korbat restored its database from a backup and which value is the last that still fits. Run it before the API starts: the API's first round after the dispatch hour would otherwise alert that the day before has no value and publish today's from the restored chain, which the keeper's mail of today no longer matches. Before any order's disabling is taken again: compare each held notice the import lists with the mailbox since the keeper's last download. An extension or a later time that was recorded after that download is lost with the restore; record it again first (`order-hold-extend`, `order-hold-until`), or the disabling taken again would tell the author at the old end.
5. Start the API with `docker compose -f infra/compose.yml up -d api`; everyone enrols new keys.
6. On the console's After a restore screen, take every measure again, from the top. An order's disabling first: its hour, its preservation and its hold are the old ones. A gap that needs nothing is closed by an admin as "Not needed", with the key.
7. When the screen says so, set `APP_SITE=open` and recreate Caddy, the API and the worker with `docker compose -f infra/compose.yml up -d --no-deps caddy api worker` (the API and the worker read it only when they start, and refuse a `test` adapter on an open site), then check from outside that the app's hostname no longer answers 503; when it says so, switch retention and the sweep back on (`API_MODERATION_RETENTION=on`, `MEDIA_RECONCILE=on`) and run `docker compose -f infra/compose.yml up -d api`, since the API reads both only when it starts.

The keeper's file holds no post and no statement, but it names authorities and references, held orders' among them, and a reference may itself name a person: keep it like the head, not like a log.

**Restoring the releases** (sub-project 3d). While the app's site stays closed (step 1 above), after `restore-import` (step 2 above), which writes a gap of the class "Releases and held uploads to replay" for every release, every leave recorded and every leave withdrawn that the backup lacks:

1. `cat <the keeper's files> | docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js release-replay`. Every release recorded after the backup is marked again, for sealed posts and for held uploads: its posts are released and their image rows erased, a seal for good taken again afterwards freezes nothing, and a held upload whose refusal the backup does not hold is kept from every post. A replay whose author must not be told yet, or whose leave the restore lost, waits until it may be told. It passes over every line the restored database holds, takes the lines above it in their order, and prints a note and exits 1 only for what is still owed: a line no gap names, or a lost end of a hold whose refusal is there and whose gap is open, which an admin ends again (step 3). Each replay is a release of its own id: `release-show` takes the replay's own id, which `release-replay` prints, and answers no release for the original's.
2. Run the Quarantine steps 1 to 3 (list, move, record), then step 6 (the inventory), then steps 1 to 3 again. The first run moves into the quarantine what the restored store holds again of images sealed for good; the inventory gives a file the quarantine holds without a record its row, and its record reports each file recorded in the quarantine that it did not list: look for that file in the `media-store` kept from before the restore and put it back in the quarantine under its name before anything else, and record it lost (step 5) only when it is in neither. When the inventory's receipt is empty, skip its step 3: `quarantine-record` refuses an empty receipt. The second run's destroy lines name every released file that the restored store or the quarantine holds again. An `operator` line is a file the quarantine holds for an image the restored database does not know: never destroy it on that line alone; find the row of the keeper's files that names the image (`upload_hold_ended`, `upload_released`, `seal_released`). If it is held for a report, it stays where it is, and the operator's R2 records say so. If it was released, no list will ever print a `destroy` line for it, since the database cannot tie the file to its release: write that one line by hand (the `operator` line with `destroy` as its direction), run steps 2 and 3 with it, and note it.
3. On After a restore, a person closes what no command can: a lost end of a hold whose refusal is there is ended again by an admin, the same way (do not run `upload-report` a second time before the keeper's files have been checked for the record of the report); a measure a program had taken is taken again by a person, as 3f's classes say. A lost leave is recorded again from what korbat holds in writing, with `release-leave <seal> ... --gap <gap>`, which records it under the id the gap names and closes the gap. A lost withdrawal of a leave comes before anything else on its case: the restored database shows the mistaken leave as standing, so withdraw it again with `release-leave --withdraw <leave> --operator <name> --gap <gap>` before an admin reads the case.
The site opens only when After a restore shows no gap, the class "Releases and held uploads to replay" included, and `head-restore-mark` has run (step 4 of Restoring with the keeper's copy).

**The public figures after a restore** (sub-project 3d). A backup holds the yearly editions published and the months of the readers' count closed until it was taken, and nothing after. `restore-import` prints one line for each published version of an edition that the restored database lacks ("edition <year> version <n>, published <time>, is not in the restored database"), and writes nothing for it: `/transparency` no longer shows that version. The job publishes a year's first version again in its next daily round, computed from the restored database as of the same 1 March, which lacks what the backup lacked, and a version for an order whose hold ended again when it finds that order; a lost correction comes back only with `staff.js edition <year> --correct`. Note in the operator's notes each lost version, its day and, if you kept the page, how the new one differs, and say so to anyone who asks about it. A month closed after the backup is lost the same way, its two numbers with it (`recipient_months`), and no line or audit row records that it was: it reads "not recorded" in `staff.js recipients` and in the recipients' line of the next edition. Note the months between the backup and the restore.

A suspect or revoked staff key is never cleared or revived.

## Posting and feed
Text posts up to 1000 characters, replies, quotes, likes, reposts and bookmarks; follows, blocks and mutes; a chronological Following timeline and a public Latest timeline; threads and profile pages. The web app's home is the timeline; sign-in lives at `/signin`.

- **Reading signed out:** Latest, threads and profiles are public. Following, bookmarks, likes, follower lists and privacy settings need a session.
- **Blocks** are enforced in every query, not just the interface: neither account sees the other while signed in, follows are removed both ways, and the blocked side gets `not_found` so nothing is revealed. Posts are public, so a block does not hide them from someone who signs out; the interface says so.
- **Mutes** are one-way and silent, and hide an account from your timelines and, since sub-project 2d, from your Activity: while the mute stands its acts write no entry for you and its earlier entries are hidden, and an unmute shows those again (Activity).
- **Liker lists are never exposed.** Counts are public, unless the post's author hides them: since sub-project 2d the author may hide a post's like and repost counts, in the composer before posting or from the post's More menu at any time (`PATCH /api/posts/:id/counts`), and everyone else then receives no number for them in any answer, the answer to their own like or repost included, while the author still sees them and reply and quote counts stay; a suspended account may hide them but not show them again. Likes and bookmarks are private to their owner.
- **Write limits** per account, tiered by account age: in the first 24 hours 5 posts and 20 replies an hour and no reposts or quotes for 48 hours; afterwards 30 posts and 60 replies an hour. Everyone: 100 likes an hour, 50 follows an hour and 400 a day, 30 blocks or mutes an hour. Undo actions are never limited.
- **Deleting** blanks the text in the database and leaves a tombstone only where a thread or a quote needs it. There is no editing. A post that a report or a moderator's finding named before it was deleted keeps a copy with its case, read by staff only, for as long as the case needs it (Moderation, Evidence and retention).
- **Moderation states.** A post is `visible`, `withheld` (while a case about it is being decided) or `removed`, as the database derives it from the measures that moderators' decisions recorded; nothing else writes the state, and the API's role cannot. A withheld or removed post is shown to its author alone, with a chip ("Under review" in amber, "Removed" in red) that names the rule or says "illegal content" and links to the decision's statement under Settings, Cases; everyone else finds it in no list and gets `not_found` for it.

## Images
Posts, replies and quotes can carry up to four images, and every image needs a description of up to 1000 characters. The web composer takes JPEG, PNG, WebP, AVIF and still GIF files up to 20 MB, and refuses HEIC with advice to export a JPEG.

- **Nothing of the original is kept**, but, while the known material check is switched on, three hashes of the file as received, deleted with the image or when the check is switched off; a match record keeps one of them for 180 days (Automated tools). The upload goes to the `media-uploads` volume, a separate worker container decodes it and writes fresh WebP files in two sizes (1024 and 2048 pixels on the long side) without any metadata to `media-store`, and the original is deleted once the image is ready.
- **The worker is boxed in**, and while the R1 check is switched on it also rates the decoded pixels, still without a network; this build computes no perceptual fingerprint. It has no network, no credentials and no capabilities, runs as a non-root user on a read-only file system within 768 MiB, one CPU and 64 processes, and only reads `media-uploads`. Decoders outside the allowlist are blocked, and the pixel count is checked from the header before decoding: 50 MP, 16 MP for AVIF, 16383 pixels on a side.
- **Formats can be switched off** without a deploy, for example while a codec advisory is open: remove it from `MEDIA_FORMATS` in `infra/.env` and restart `api` and `worker`.
- **Who sees an image** follows its post and, since moderation cases, its own state: anyone when the post and the image are both visible, cached publicly for at most a minute in a browser and five minutes at the edge (The edge); only the author when either is withheld or removed, never cached, while everyone else reads "Image hidden by korbat moderation" in its place on a visible post; nobody when the image is sealed (reported as child sexual abuse material, Moderation), its author included, who reads "Sealed: not shown to anyone, you included" in its place; nobody once its content or its post's was erased or the post is deleted. A deleted post's files leave the disk at once, except images that a moderation case holds as evidence or that an unanswered report of child sexual abuse material or a seal freezes: their rows and files are kept, served and listed to nobody and exported to nobody, and the retention job deletes them once nothing retains them.
- **Behind Cloudflare**, set the zone as The edge says, or browsers keep images for four hours whatever the server says.

## The edge

A public image is served with `Cache-Control: public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0`, on the 200 and on the 304: a browser keeps a copy for at most 60 seconds and an edge for at most 300, and neither serves a stale one. Every other answer of the API is `no-store`, the 404 of an image included, and an author's own hidden image is `private, no-store`. When an image stops being public (a measure, an authority's order, the author's deletion, the account's purge, an erasure, a release), the database writes a row of `edge_purges` in the same transaction, whoever wrote the change, and the API's job `edge-purge` drains the rows after the commit. With `API_EDGE_PURGE=off`, the default, each row closes as off and the header is the only bound. With `API_EDGE_PURGE=cloudflare` the job asks the provider to drop the image's copies by prefix (`<host>/api/media/<id>/`, both sizes and every query string), up to 30 images a request and one request a round, 15 seconds after the last round ended; a purge that is not taken is sent again later, the wait doubling up to an hour, and after 24 hours it is recorded as failed and every staff account is alerted ("A cached copy could not be dropped"). A purge never delays or undoes a measure, and an accepted one is no proof that every edge node dropped its copy: the header stays the bound. A case prints the outcome beside each of its images, and an order's screen beside each disabled item.

Before it is switched on, the owner runs the lab on the zone and notes what it shows: what the edge does with `max-age=0` beside `s-maxage`, and a purge sent while the edge answers `MISS`. Switching it on: set `API_EDGE_PURGE=cloudflare`, `API_EDGE_ZONE_ID` (the zone's id), `API_EDGE_API_TOKEN` (a token with the one permission Zone, Cache Purge: a secret, which no log line, audit row or answer holds) and `API_EDGE_HOST` (the public hostname of the images, without a scheme) in `infra/.env`, then `docker compose -f infra/compose.yml up -d api`. The API refuses to start with `cloudflare` and one of the three missing, and with `test` while `APP_SITE` is open.

In the zone: Browser Cache TTL "Respect Existing Headers"; no Edge Cache TTL rule on `/api/media`; Always Online off; a token with the one permission Zone, Cache Purge. The check, once, with a test post: read the image through the public hostname until its header shows a cache hit; hide the image in the console; read the case's line "Edge copy: purge accepted"; read the image again and see that the copy is gone. Note the seconds.

## Explore
A ranked list of recent original posts, the third tab of Home (`/?tab=explore`). Its whole formula is published at `/explore/about`, printed from `EXPLORE_V2` in `packages/contracts/src/explore.ts`, the constant the ranking itself uses (formula version 2, since account sanctions); changing any number means a new formula version with a dated entry in its change log.
- **What is ranked.** Visible top-level posts that are not quotes, from the last 48 hours, by live accounts that are not suspended at the round's time and have not switched Explore off. A post that a decision hid and a later decision restored gets back the hours it was hidden: its window and its age count from `explore_from`, its creation time moved on by those hours, which only the database's writer of a post's level sets. Replies belong to their threads, and quotes stay out so that a mocking quote cannot put its target's post on a public page.
- **What counts.** Approving accounts: the distinct accounts other than the author that liked or reposted the post, each at least 48 hours old when it did, still live and not suspended at the round's time, the like or repost at least 10 minutes old. The score is approving accounts / (hours since posting + 2)^1.8; a post needs at least 3; one account has at most 2 posts in a ranking of 300. Replies, quotes, followers, the badge and reports are never read.
- **The refresh.** The API's `explore-refresh` job ranks at start and every five minutes under the shared job lock, and a round within 4.5 minutes of the last writes nothing, however many instances run. Each ranking is a numbered generation in `explore_runs` and `explore_items`; the two newest are kept so a reader can finish paging, and a round logs only its generation, its counts and its milliseconds.
- **Reading.** `GET /api/timeline/explore` shows only the order, never a score, count or position. Its cursor names the ranking and the last post read; a pruned ranking answers 409 `explore_refreshed`, and the app goes on from the newest ranking without repeating a post. Moderation states, the author's switch or deletion, blocks in both directions and mutes apply at every read. Signed out: the first 20 posts and no cursor. Every answer is `no-store`.
- **Authors.** Settings > Privacy has "Show my posts in Explore" (`POST` and `DELETE /api/me/explore`, on by default): off takes the posts out at the next read, on brings them back at the next refresh. `GET /api/posts/:id/explore` tells the author alone whether a post is in Explore and which rule keeps it out, never with a count, and the author's listed posts show "In Explore".
- **Tests.** A ranking is a function of the time it is computed at, so the integration suites rank in past epochs of their own (2020 to 2023), each test in its own span after emptying `explore_runs`.

## Activity
One screen, Activity (`/activity`), tells a person what other people did with them and the decisions korbat told them about their own content, and only when they open it (sub-project 2d, `docs/superpowers/specs/2026-10-22-engagement-2d-design.md`). It is second in the nav, after Home; on a phone the tab bar keeps four items, Home, Activity, Bookmarks and Profile, and Settings opens from the profile's Settings button. The API's module is `apps/api/src/activity/`, with `GET /api/activity`, `GET /api/activity/newer`, `POST /api/activity/seen` and `GET` and `PUT /api/activity/settings`.
- **What is written.** A reply writes an entry for the author of the post it answers, never for the thread's other authors; a quote for the quoted post's author; a mention for each of the first 10 accounts a post's stored mentions name, its author and a reply's parent author not counted; a follow for the account followed. An entry is one row (the recipient, the actor, the kind, the post's id and the time, never a text), written in the act's own transaction, so an act that is refused writes none, and a recipient gets at most one entry a post: a reply that also quotes or mentions its parent's author is one reply entry. A follow, an unfollow and a follow again within 90 days are one entry, with the time of the first. Moderation entries are never written: the decisions korbat told the person about their own posts, profile or account (a moderator's or an automated tool's), the releases of their sealed images, their refused uploads and their lost images are read, on the tab All only, from the reads the person's own Settings, Cases already makes, so a held notice, a decision told to nobody or anything staff-side never appears; the list goes back 90 days, and Cases keeps the rest.
- **Who may reach a person.** Settings, Activity (`/settings/activity`) has, for replies, mentions and quotes each, "Everyone", "Accounts older than 2 days" (an account made at least 48 hours before the act, the age the write limits and Explore already use, a rule and never a reputation), "Accounts you follow" or "Off", and for follows "On" or "Off"; the defaults are Everyone and On. An act writes an entry only when the recipient's setting lets it through, the recipient is not the actor, no block stands between the two in either direction and the recipient does not mute the actor. An act that is left out writes nothing, so a change applies to new acts only and brings nothing back. A suspended account cannot reply, quote or follow, so it causes no entry; a suspended recipient still receives entries and reads them.
- **Reading.** `GET /api/activity` answers 30 entries a page, newest first, on the tab All or Conversations (replies, mentions and quotes alone). An entry is shown only while its post is visible to the person, through the rule every read of a post uses, its actor is not deleted, neither account blocks the other, the person does not mute the actor and, for a follow, the follow still stands; a hidden entry is shown again when its post is restored or the mute ends. Follows are grouped by the UTC day they arrived in ("Ada and 4 others followed you"), each group with its count and its three newest followers, each a link on their picture; replies, mentions, quotes and moderation entries are never grouped.
- **New since you last looked.** The seen marker lives on the server (`activity_state.seen_at`), one per account, so an entry is new once on every device. Every page answers the marker; the screen draws "New since you last looked" above the first entry newer than it and "Earlier" above the first older one, then, when something was new, sends `POST /api/activity/seen` with the newest time it showed. The server moves the marker forward only and never past its own clock. While the screen is open and the page visible, it asks `GET /api/activity/newer` 30 seconds after it opened and every 60 seconds after that, as the feeds' pill does, and a pill counts what arrived, from "1 new" to "20+ new"; pressing it, or pulling to refresh on a phone, loads the first page again at the top.
- **What is never shown.** Nothing outside the Activity screen counts, badges or marks new activity: no dot, number or word on the nav item, nothing in the page title, no request for Activity from any other screen, no route that answers a count of unread entries, and no mail and no push about it. A like, a repost or a bookmark writes no entry, and neither does an act across a block in either direction, an act by an account the recipient mutes, an act the recipient's setting leaves out, or a post's author naming, answering or quoting themselves. No entry shows a post the reader may not see. No staff route and no console screen reads anyone's Activity.
- **Mentions.** A handle written in a post (`@` and 3 to 20 letters, digits or `_`, with none of those right before the `@` or right after the handle) is stored with the account that holds it when the post is written: the first 20 distinct handles that name a live account, in text order, whatever blocks exist (`post_mentions`). It links to the profile only while that account still holds the handle and neither it nor the reader blocks the other: after a rename or a retired handle it is plain text, so a person who renames is not found through old posts, and the entry already sent stays. The first 10 stored write entries, the post's author and a reply's parent author not counted. A handle that named no account, one beyond the first 20, and every handle of an imported post are plain text and tell no one: imported posts are never read for mentions. The composer suggests no account while typing; once its text holds a handle, a line under the field says that up to 10 accounts named are told, if their settings allow it.
- **After the fact.** A post that its author deletes takes its mentions and entries with it, in the deletion's transaction; a post whose content is erased keeps no list of the handles it named. A block deletes the two accounts' entries both ways in its transaction. A withheld, removed or disabled post's entries are hidden while it is not visible. An actor's suspension or termination changes nothing, with no label. An account's deletion hides what it caused or received, and its purge deletes every entry it caused or received, its mentions, its seen marker and its settings.
- **Retention.** An entry is deleted 90 days after it was written, by the API's job `activity-retention`, every hour under the shared job lock, in batches of 5,000, logging only how many went (`ACTIVITY_KEEP_DAYS` in `packages/contracts/src/activity.ts`, which the terms print too). The seen marker and the settings live as long as the account, mentions as long as their post.
- **The export.** `export.json` ends with the member `activity`: the seen marker, the settings and every entry the account received that korbat still holds, newest first and ungrouped, each with its kind, its time, the post's id, the actor's handle at the time of the export and `shown`, which is `true` or says why the list does not show it: `muted`, `post_not_visible`, `unfollowed` or `actor_deleted` (a block reads as the second for a post and the third for a follow). An entry whose post the person may not see carries no post id. Moderation entries are not repeated: the member `moderation` holds them.
- **Limits.** One post writes at most 12 entries (a reply, a quote and 10 mentions) and one follow one, so the write limits of Posting and feed bound what an account can cause. Moving the seen marker is limited to 240 requests an hour, saving the settings to 120 (`apps/api/src/social/tiers.ts`).

## Share cards and search engines
A link to a public post or profile shared on another site unfurls into a card that korbat builds itself (sub-project 2d, section 8 of `docs/superpowers/specs/2026-10-22-engagement-2d-design.md`), and search engines are asked to index none of it.
- **The pages and the routes.** For every view of `/post/<id>` and `/u/<handle>`, Caddy asks the API's `GET /api/cards/post/:id` or `GET /api/cards/profile/:handle` (`apps/api/src/cards/`), which read no cookie and answer the same for everyone: 204 with the card's head block, base64 in the header `Korbat-Card`, or 404 with no body. On 204 Caddy serves `card.html`, the web shell with the block decoded into its head by Caddy's `templates`, with 200; on 404 (a post a signed-out reader is not shown, a deleted author, a handle that no live profile holds now, an old handle included) the plain shell with 404; on any other answer, a 429 of the API's global limit among them, and when the API cannot be asked, the plain shell with 200, which loses only the card. `templates` runs in that one place, the API escapes every value it writes, `{` and `}` included, and `/card.html` asked by its own path is 404, so nothing a person wrote is ever evaluated as a template. Caddy drops the request's `Range`, so every page is a whole 200 or 404. The `<title>` the server sends stays "korbat" on every page, cards included: the app puts its own title, which never names an account, once the bundle runs, so a browser's history never holds a handle.
- **What a card shows.** Link previews are off by default for every account, and while they are off a card names only korbat: "A post on korbat" or "A profile on korbat" and the address, with no name, text, image or date. Once the author turns on Settings, Privacy, "Show a preview when someone shares a link to my posts or profile" (`POST` and `DELETE /api/me/share-previews`), a card shows what a signed-out reader sees and no more: for a post, the author's display name and handle as the title, its text cut to 200 characters (an imported post's label first), its first image shown to everyone with its description, else the author's picture, else none, and the time it was posted; for a profile, the display name and handle, the bio cut to 200 characters and the picture. Never a count, the verified badge, a moderation state or a standing. A reply's card holds nothing of its parent, a quote's nothing of the quoted post. A withheld, removed, disabled, deleted or erased post has no card; a suspended account's visible post and profile have theirs, with no label; a picture held for review is on no card. A suspended account may turn previews off but not on. Nothing asks a person to turn them on.
- **`robots.txt`** (`infra/caddy/robots.txt`, served at `/robots.txt`) allows `/post/`, `/u/` and `/api/media/`, and nothing else, to five agents named by their robots.txt tokens: `Twitterbot` (X), `facebookexternalhit` (Meta), `Slackbot-LinkExpanding` (Slack), `Discordbot` (Discord) and `LinkedInBot` (LinkedIn). Each is a link-preview fetcher that honours robots.txt and makes a card only from what it may read, so links to korbat still unfurl there. Every other agent is disallowed everything: search engines, archives, data brokers and crawlers that collect text and images for model training, since a search engine's index of korbat would rebuild the keyword search korbat keeps out. robots.txt binds only an agent that reads it: one that ignores it is out of korbat's reach, and Mastodon's link-card fetcher reads none, so an instance makes its card from the page as korbat serves it, the generic card while previews are off (`infra/caddy/lab/crawlers.json` holds each fetcher's request).
- **`X-Robots-Tag: noindex`.** Caddy sends it on every page of the app's site but `/`, `/rules`, `/transparency`, `/explore/about` and `/terms`, the five that can name no account, on every answer of `/post/*` and `/u/*` and when the API cannot be asked for one; the API sends it on every answer, an image's, a 404's and an error's included; and every card's block begins with a robots meta tag that says `noindex`. A search engine may or may not honour it.
- **What other platforms keep.** A card is built at each request and never stored by korbat, and a page that carries one is `no-cache`, so a post withheld or deleted after it was shared loses its card on korbat's side at the next fetch; the images it names keep the public header and the purge of The edge. The platforms that showed a card keep their own copy beyond korbat's reach: X for about 7 days, Meta until it fetches the page again, Slack about 30 minutes and each Mastodon instance two weeks (the design's section 8.6). Settings, Privacy says beside the switch that such a site may keep its copy after the post is deleted.
- **Limits and the log.** Caddy asks the card route with the visitor's address, so a card's question counts against that address under the API's global limit of 300 requests a minute, as the post's status did before 2d, and a 429 gives the plain shell with 200; a burst of shares that one platform's fetchers bring through few addresses can therefore lose cards, a cost the design chose over a limit of its own (decision 30). The card routes are not counted among the recipients of the transparency page, since the page's own read is what a person makes. They are logged as every request is, by method, path, status and duration, so a profile card's line names the handle and a post card's the post's id, as `GET /api/profiles/:handle` and `GET /api/posts/:id` already do; no text is logged.
- **The card lab.** `node infra/caddy/lab/card-lab.mjs --prefix korbat-cardlab` checks the cards in Caddy itself, beside a stub API and with each fetcher's request of `crawlers.json`, without the rest of the stack and without fetching any real site; add `--image <image>` to check an image already built instead of building one. It is in no gate: run it after a change of the Caddyfile, Caddy's Dockerfile or `robots.txt`, and after every Caddy upgrade (`infra/caddy/lab/README.md` lists its checks).

## Staff roles
No API endpoint changes roles. Run this on the server:
```bash
docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
```
Every session of the account, staff sessions included, is revoked and the change is written to the audit log. Since account sanctions, grant-role refuses to make staff an account that holds a suspension, a termination or a restriction of reporting that stands and has not ended: it says so, changes nothing and exits 1, and an admin lifts a wrong measure with a correction first. Moderators and admins act only on the staff console, with a staff key; two-factor authentication in the app opens nothing there, though a staff account cannot turn it off once it is on.

## Staff console
The staff console (`apps/admin`; design `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`) is a page on an origin of its own, `API_CONSOLE_ORIGIN` in `infra/.env`, served by Caddy's second site (port 8090 in its container), which proxies only `/api/staff/*` to the API. Empty, the console is off: every `/api/staff` path answers 404, and the page says that the console is not available at this address. Only a staff key opens it. It holds sign-in, enrolment, a home screen (every staff account's sign-ins of the last 7 days, your staff sessions, your keys), the audit log and, since sub-project 3c, the moderation cases: the queue, the case page with its decision composer, and the appeals (Moderation, below, with the commands 3c added). Keys are enrolled, listed and revoked, and the record is checked, on the server:
```bash
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>        # a one-time link that registers one staff key
docker compose -f infra/compose.yml run --rm api node dist/staff.js keys [<email>]             # an account's staff keys, or every staff account with its keys
docker compose -f infra/compose.yml run --rm api node dist/staff.js revoke <email> <key id>    # that key and every staff session it opened
docker compose -f infra/compose.yml run --rm api node dist/staff.js revoke <email> all         # every key, staff session and unused enrolment link of the account
docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-head                 # the audit log's newest place, hash and time
docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-verify [<chain_seq>:<hash> ...]   # the whole chain, against the places kept
```
Each command waits at most 10 seconds for a lock. One that gives up has changed nothing and says so: an open transaction holds the audit head or the account's row, so stop the api service (`docker compose -f infra/compose.yml stop api`) before running it again.

- **Staff keys.** A staff key is a WebAuthn credential registered on the console's relying party ID (`API_CONSOLE_RP_ID`; empty means the console's hostname) whose authenticator reported user verification and no backup eligibility when it was registered, and reports user verification without the backup flags at every use. A personal passkey never opens the console and a staff key never signs in to the app; passwords, email codes, two-factor and recovery codes never give staff powers. Keys are added only through enrolment links the command line issues as the migrator, which the database enforces, and an account holds at most 5 live keys. No console route adds or revokes one: `staff.js revoke` revokes keys, grant-role revokes them on a change to `user`, an account's deletion revokes them, and a key whose signature counter goes backwards is switched off together with every staff session it opened. A key's row is never deleted, because `audit-verify` checks old confirmations against its public key; a deleted account's keys keep no name, AAGUID or transports.
- **Enrolment.** `staff.js enroll` runs in the migrate service, as the migrator, the one role the running API never holds. It prints a link to `<API_CONSOLE_ORIGIN>/enroll/<token>`, valid 30 minutes and once, for a live account that is staff, has a handle and holds fewer than 5 live keys, and refuses while the console is off. Whoever holds the link can register a key for that account, so hand it over by a channel you trust. The person opens it on the device that holds the key, names the key (the key and the console show the name, so not an email address or a real name), and chooses "Register a security key" or "Use Windows Hello on this computer"; a refused key leaves the link working until it expires. The owner is mailed every key added. A link issued before a `revoke ... all`, a role change, a deletion or a move of the console enrols nothing.
- **Sessions and confirmations.** A staff session lasts at most 12 hours and ends after 15 minutes without an action by its person (a click, a submitted form, a screen opened); the console warns two minutes before the idle end with "Stay signed in", and nothing moves the 12-hour end. It is read from the database at every request, so a revocation, a demotion, a deletion or a switched-off key ends it at its next request. Every new staff session is mailed to its owner, and every staff member's home screen lists every staff account's sign-ins of the last 7 days: a sign-in nobody recognises means someone else holds a staff key. An action that changes something asks for the session's own key again, for that action, its target and its parameters only ("Sign out that session", every decision on a case, every review of an appeal and every reveal of who sent a report), and its row in the audit log keeps the key's signature. Three things a moderator does on a case ask for no key, since none of them restricts or releases anything: saving a text (it enters the record only when a confirmed decision or reveal names its digest), taking a fresh snapshot, and opening a case on their own finding (limited per day, and counted on the home screen).
- **The audit log and its head.** The audit log is the record of every staff action: enrolment links issued and cancelled, keys added and revoked, sign-ins, sign-outs, session revocations and role changes, each written in the same transaction as its change, and since 3c every decision, every review of an appeal and every reveal, each link, unlink and change of the limits the command line makes, each read of an account's facts and each drafted access request, and each erasure of the retention job. A moderation row holds ids, kinds, times and salted digests only, never a text anyone typed. It is a hash chain: the database gives every row its place (`chain_seq`) and a hash over the previous row's hash and the row's content, so a row changed later changes every hash after it. The console's audit page lists the rows newest first with their place and hash, with "Load older" and "Go to place". `audit-head` prints the newest row's place, hash and time (`<chain_seq>:<hash> <time>`); a kept place is its first word. `audit-verify` recomputes every hash in its own code, never asking the database for one, checks every stored confirmation against the public key, origin and relying party ID of the key it names, and checks every kept place given to it; it exits 1 naming the first rows at fault, and says how many rows follow the newest kept place. It needs no secret and runs the same with the console off or moved.
- **Making staff.** The person creates a korbat account of its own for staff work, at an address of its own (an alias of their mailbox will do, so the staff mails reach them), and chooses a handle unrelated to their posting handle; that account is used only for the console. It has a public profile under that handle, empty but visible in the app. The operator runs grant-role with `moderator` or `admin`, then `staff.js enroll` once per key, for two keys. The first admin is the operator, made the same way on an account apart from their posting account.
- **Offboarding.** `docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> user` revokes the account's staff keys, staff sessions and unused enrolment links, and mails it the keys' names; a person made staff again enrols new keys. A change between `moderator` and `admin` ends the staff sessions and unused links and keeps the keys. A lost key is revoked with `staff.js revoke <email> <key id>` and replaced through a new enrolment; there is no self-service recovery.
- **Which keys work.** Out of the box only Windows offers a device-bound platform key (Windows Hello). On macOS, iOS, iPadOS, Android, ChromeOS and Linux the platform's own passkeys are synced, so a staff key there must be a FIDO2 security key with a PIN. On Windows a browser's password manager may offer itself before Windows Hello, and its passkeys are refused. A phone's own passkeys cannot serve, though a phone's browser can use a security key. The approved authenticators are a FIDO2 security key with a PIN and Windows Hello on a computer with a TPM, and each person holds two: two security keys, or Windows Hello on one computer and a security key. A new security key needs a PIN; when the browser does not offer to set one, set it in Chrome or Edge under Settings, Privacy and security, Security, Manage security keys, on Windows under Settings, Accounts, Sign-in options, Security key, or with the app of the key's maker.
- **Reading `staff.js keys`.** With an address it lists that account's keys; without one, every live account whose role is not `user`. Each account's line gives its role, address, handle and id; each key's line gives its id (what `revoke` takes), its name as a quoted string, its AAGUID, when it was created and last used, and whether it is live, revoked, or revoked and suspect (its counter went backwards). After an account's keys comes the line `linked personal accounts: <n>`: how many personal accounts `staff.js link` recorded for it, never which (Moderation, The limits on staff). The AAGUID is the make and model the authenticator reported about itself, unsigned, since no attestation is asked: all zeros when the browser or the authenticator withheld it, `none` once the account's deletion blanked it. It shows what kind of authenticator registered the key without proving it, and a key whose AAGUID names a password manager is revoked.
- **A refused passkey.** When enrolment refuses a synced passkey or one that asked for no PIN, the password manager has already saved it. Where the browser can (Chrome and Edge 132 and later, Safari 26) and the console's relying party ID is not the app's, the page asks the browser to drop it. Otherwise the page says so, and the person deletes the entry for the console's hostname from the password manager's list of passkeys by hand. In development both relying party IDs are `localhost`: pick the entry by the key's name, so the app's own passkeys stay.
- **Staff mails.** None carries a link, and each ends with the sentence "korbat never puts a link in a staff email", so a staff mail with a link is a fake. "A staff key was added to your korbat staff account" is expected after your own enrolment; otherwise tell the operator at once, who revokes that key. "A staff session started on the korbat console" is expected after your own sign-in; otherwise someone holds that key: tell the operator at once, who revokes it with `staff.js revoke <email> <key id>`, which ends every session it opened. "A staff key on your korbat staff account was switched off" means a use of the key looked like a copy of it: ask the operator for a new enrolment link, and say whether you used the key just then, since if you did not, someone else holds a copy. "Staff keys revoked on your korbat staff account" follows an offboarding, a demotion, a revocation by the operator or a restore; if you did not expect it, ask the operator why. Signing out, or signing out one of your own sessions, sends no mail.

The runbook:

- **After each enrolment** the person presses "Sign in with this key" on the enrolment page, which signs in with the new key and no other. A key that does not open the console is revoked (`staff.js revoke <email> <key id>`) and the operator told: an API under someone else's control could have stored a key of its own in its place, under the person's name, and `staff.js keys` would not show the difference.
- **After any API incident** (the API's code, image or host was, or may have been, under someone else's control), stop the api service first: `docker compose -f infra/compose.yml stop api`. Run grant-role for every staff account with the role on your own list of staff: it sets back any role the API changed and ends every session and staff session, keeping the keys. Compare the accounts and addresses `staff.js keys` lists with that list; an account or an address that is not on it is made `user` with grant-role until it is explained. Once the API runs again from a clean image, run `audit-verify` with every kept place, and read the record's key and enrolment rows (`staff_enrollment_issued`, `staff_key_added`, `staff_key_revoked`, `staff_enrollments_cancelled`) on the console's audit page. Then each person signs in once with every key listed for them, and any key that does not open the console is revoked: `staff.js keys <email>` shows which listed key no sign-in used.
- **The kept head.** Each day after the dispatch hour the API publishes the head's daily value on `/transparency` and mails it, with its place and hash, to the keeper at `API_HEAD_KEEPER_MAIL` (sub-project 3d; The yearly edition). The keeper's daily visit stays, since only the keeper holds the place: each day the keeper, the staff member who does not run the server, copies the newest place and hash from the console's audit page and, on the same visit, opens the place kept on the previous visit with "Go to place" and checks that it still shows the kept hash. A change that recomputes the chain changes the hash at every later place, so the newest kept place covers every row before it. After each deploy and each week the operator runs `audit-verify` with every place the keeper has kept. Since sub-project 3f the keeper also presses "Download since my last copy" on the same visit (Authorities' orders, The daily copy).
- **Moving the console** means enrolling every staff key again. Keys are bound to the console's hostname, and each records the origin and relying party ID it was enrolled for, which the API holds it to. After the move (a new `API_CONSOLE_ORIGIN`, the tunnel's console hostname, then `docker compose -f infra/compose.yml up -d api`, which recreates the API with it), run `staff.js revoke <email> all` for every staff account, since the old keys open nothing but still count towards the five, then `staff.js enroll` for each key again; links issued before the move are refused. `audit-verify` goes on checking old confirmations against the values recorded on each key.

## Moderation
Moderation cases (sub-project 3c; design `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`) take reports and notices from anyone, signed in or not, put each named target into exactly one open case, and let staff decide the case on the console. A decision is its own statement of reasons. Every restriction of a post, an image or a profile field is derived by the database from the measures that decisions recorded, each decision confirmed with the deciding person's staff key in the same transaction; the API's role can write no moderation state. Six commands of `staff.js` belong to it:
```bash
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js link <staff email> <personal handle>      # record that the personal account is this staff member's own, for the recusal check
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js unlink <staff email> <personal handle>    # take that record back
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js limits <decisions per hour> <decisions per day> <case opens per day> <findings per day> <reveals per day>   # set the limits on staff
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js notification-facts <record>                # the handle, address and creation time of the account a report to the authorities concerns
docker compose -f infra/compose.yml run --rm api node dist/staff.js text-verify                                   # what the record names against what korbat holds
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js access-request <@handle>                   # the moderation part of an answer to a GDPR access request, as JSON
docker compose -f infra/compose.yml run --rm api node dist/staff.js access-request <email>                        # the same for a notifier's address
```
`link`, `unlink`, `limits`, `notification-facts` and `access-request` for a handle run in the migrate service, as the migrator, as `enroll` does: only the migrator reads whether an authority asked that a person is not told; `text-verify` and `access-request` for an address run in the api service, whose keys open a notifier's contact. Each waits at most 10 seconds for a lock, each but `text-verify`, which only reads, writes its audit row in the transaction of what it did, and each exits 1 with a message when it changed nothing it was asked to.

- **Reports and notices.** Anyone can report a post, one image of a post or a profile, from "Report" on it or with its link on the app's `/report` page, signed in or not (`POST /api/notices`). The form has three grounds of equal weight: "It breaks a korbat rule" (R1 and R3 to R6), "It is illegal" (a notice under Article 16 of the Digital Services Act, with a category, an explanation, an optional law or country and the good-faith statement), and a third for the sexual abuse or exploitation of a child, child sexual abuse material or grooming, which is anonymous: korbat records neither the account nor a contact for it. A signed-out sender passes the human check and, with a notice of illegality, may leave a name and an email, which the auth module keeps encrypted under `API_NOTIFIER_ENC_KEY`; no staff screen shows the address, and the name only after a reveal. One report names up to 10 links (on the third ground at most one profile); one network may send 5 an hour and 20 a day without an account, one account 10 an hour and 50 a day, and a request counts also when korbat then refuses it (a link that is none of korbat's, a target the account already reported). Every report gets a reference (`N-` and ten characters). An account follows its reports under Settings, Cases, Your reports; a signed-out sender gets a link to the status page, `/notice/<reference>`, whose token stands after the `#`, where no server log sees it: one link on the success screen, shown only then, and, when an email was given, another in the receipt (`notice_received`). Each named target becomes an item in the one open case of its post or account; a link that names nothing live is answered automatically. Outcomes are released once a day, at `API_MODERATION_DISPATCH_HOUR` (UTC), so that nobody can tell from a mail's minute when a decision was made, and each address or account gets at most one update a day (`notice_update`). A moderator who finds something themselves opens the case with "Open a case" on the queue screen: a finding cites a rule, never the law, and sends no receipt.
- **The queue and its lanes.** Open cases are ordered by lane and then by the age of their oldest unanswered item, and by nothing else: no count of reports and no standing of a reporter weighs. Lane 0, "Urgent": the third ground, rules R2 and R5, and notices of illegality in the categories violence, risk for public security and self-harm. Lane 1: rules R3 and R4, and notices in the categories data protection and privacy violations, cyber violence, cyber violence against women, illegal or harmful speech, protection of minors, and "I am not sure". Lane 2: everything else. A case takes the most severe lane of its unanswered items; on a rule report or a finding the rule alone decides the lane. The response times are 24 hours in lanes 0 and 1 and seven days in lane 2, counted from the case's oldest unanswered item. They are targets for a team of one or two, not promises. Every staff account gets the queue-age mail (`moderation_waiting`), at most once in 24 hours, when a case passes them or when a measure taken while deciding is older than 24 hours, whatever its lane, since its author cannot appeal it until the case is decided. A row of the queue is marked "notice under Art. 16", "CSAM: no images", "re-examination" or "deferred" where that applies, and the page reads the queue again every 60 seconds without keeping the staff session alive.
- **Possible coordinated reporting.** A case whose unanswered reports include at least 5 from 5 signed-in accounts within 60 minutes, at least half of them following or followed by another of them, shows the chip "Possible coordinated reporting" in the queue and a line under its header with the two counts, never who reported. It is a hint and nothing more: it is computed at each read and stored nowhere, it orders nothing, no decision reads it, and it goes dark once retention forgets the reporters. An item also says how many other open items its signed-in reporter has elsewhere, as a count. Decide the content as always; 3e's mark "manifestly unfounded" answers one reporter's many reports.
- **Deciding and the preview.** The case page shows the case's copy of the target (a snapshot: text by copy, images by reference, each image drawn only after "Show image"), its items with what each sender wrote in a frame, a summary of each source in bands (never a name, an address or a count), the earlier decisions and the notes. Every read of a case, every image viewed and every reveal is written to an access log that the home screen sums up for all staff. The composer lists the outcomes the person may choose, "Restrict", "No breach" or "Illegality not evident"; a restriction is taken "While deciding" (a measure that lasts until the case's final decision, cannot be appealed and is told to its author at once) or with "Decide the case". The measures are "Withhold the post", "Withhold one image", "Seal the images this case reaches", "Reset display name", "Reset bio" and, since sub-project 2d, "Reset profile picture" while deciding, and "Remove", "Remove one image", the seal and the three resets when the case is decided; a decision under a rule names the rule, one on the law the legal reference. The facts, the reason and the legal reference are saved as drafts when their field loses focus and enter the record only when the key confirms a decision that names their digests; they never hold personal data of anyone but the author. Under them stands "Preview: the statement as its author will receive it", rendered by the code that renders the mail and the author's screen, from the rulebook version the decision records. "Confirm with your staff key" records the decision with its audit row or not at all; a case that changed behind the page (`case_changed`) is read again and confirmed again. The author gets the statement by mail at once (`moderation_decision`) and reads it under Settings, Cases, About you. A final decision on a case that holds a report or finding of child sexual abuse material or an item citing R5, or that cites R2 or R5, whatever its outcome, is an admin's, and so are every lifting of a seal and every correction of such a decision; any moderator may withhold such content, or seal reported images, while deciding. A final restriction of a staff account is refused (`staff_target`), and a person is refused a case (`staff_recused`) when their own account or one linked to them takes part in it or is close to someone who does; the runbook has a bullet for each.
- **Measures on content that is already not shown.** A decision can restrict what nobody sees any more: a post another case already removed, or one its author deleted. The composer says so ("This changes nothing anyone sees now"). The measure is recorded as a measure of its own, its author is told (not for a measure taken while deciding on a deleted post), and it is in force should the other restriction be reversed; the statement says that it changed nothing anyone sees.
- **The limits on staff.** One staff account confirms at most 60 decisions an hour and 300 a day, which the database counts and refuses beyond (`decision_cap`), opens at most 400 different cases a day, opens at most 50 findings a day and makes at most 10 reveals a day; a day is the UTC day, and those are the numbers of a new database. All five are set with `staff.js limits`, in that order, each a whole number from 1: `staff.js limits 60 300 600 50 10` prints `limits: set to 60 decisions an hour, 300 decisions a day, 600 case opens a day, 50 findings a day, 10 reveals a day. Keep these numbers in your own records: a restore brings back the ones of its backup.`, and exits 1 with `the limits already are ...; nothing changed` when all five were already set. Every staff account is mailed when one account confirms 20 decisions within 15 minutes (`moderation_burst`, at most once an hour for one account) and when one reaches the day's limit on cases (`moderation_reads`). Every reveal (`moderation_reveal`), and every decision that lifts the protection of reported images (`moderation_csam_lifted`: a lifted seal, or an admin's answer to a report or finding of child sexual abuse material without a seal), is mailed to every staff account, without a throttle, and listed on every staff member's home screen for 30 days. A staff account's own personal accounts are recorded with `staff.js link <staff email> <personal handle>` and taken back with `unlink`; the database then refuses that person every case in which a linked account takes part or is close to someone who does. Only the count of an account's links is ever printed (`staff.js keys`), and the audit row of a link names the staff account and nothing of the link.
- **Reveals.** Staff see a source as a summary, never as a person. "Reveal who sent this" on an item shows the reporter's handle or the name a signed-out notifier gave, never an address, after the person chose why ("A claim of impersonation", "Abuse of reporting", "A legal requirement" or another reason), wrote the reason in their own words and confirmed with their staff key. A reveal cannot be undone. Nobody can be revealed for a report on the path for child sexual abuse material, which records no sender, for a finding, or for a sender whose name is no longer kept (`reveal_refused`).
- **Appeals and the one-moderator rule.** The person a final restriction is about can appeal it once, under Settings, Cases, for six months after being told and while any of it is in force; what korbat did while deciding cannot be appealed and ends with the case's final decision. The console's Appeals screen lists the appeals that wait. A reviewer made none of the case's decisions, opened no finding in it and is not close to anyone in it, which the database enforces (`reviewer_conflict`); the review of a decision that cites R2 or sealed images is an admin's. The review answers "Keep", "Reverse in part" or "Reverse", with a reason, and its statement goes to the author. With one staff account that could review it, an appeal waits, without a time limit: the home screen counts the appeals that have no possible reviewer now, the appellant reads "korbat has one moderator at the moment", and the operator makes another person staff. With one admin and one moderator, every R2 or R5 case that the moderator withheld or sealed while deciding, or opened as a finding, and the admin then decided leaves its appeal without a reviewer in the same way.
- **Re-examination.** Whoever reported can ask once for each item, within six months of being told, for a re-examination of a decision to take no action ("no breach found" or "illegality not evident"): on the status page their receipt links to, or under Settings, Cases, Your reports. It is decided again as a new report: a new item in the queue, marked "re-examination". The database does not keep the person who decided the first time from deciding again, so when the item re-examines your own decision (the case page says "You decided the item this re-examines. Leave it to another staff member when there is one.") and another staff member exists, leave it to them. An answer given while nobody could open the post's images does not spend the request. A decision given on re-examination is final within korbat.
- **Evidence and retention.** A case keeps its own copy of what was reported: the text by copy and the images by a hold on their rows, so that neither the author's deletion, the account's deletion nor the sweeper takes them while the case needs them. Each kind of data is then erased on its own schedule, by the `moderation-retention` job (every 10 minutes while `API_MODERATION_RETENTION` is `on`) and, for notifiers' contacts, by the auth janitor; the periods are the contracts' `RETENTION`, which the terms publish. A case's copies (snapshots, notes, the appellant's statements, the holds) go once the case is closed and every restriction of it is final for its author (the appeal answered, or six months passed), and not before 24 hours after the case's newest copy or draft; the old value of a reset field stays readable 30 days after the reset stopped being in force. The record of a report (its explanation, the cited law, who sent it) goes 30 days after everything korbat owed it was done, and who sent it also when the reporter's account is deleted. Content restricted under R4 is erased once the restriction is final, the chip and the reason kept. Statements stay while the account exists and 12 months after its deletion. A draft that no decision confirmed is deleted after 24 hours; the access log and the reasons of reveals after 12 months. A notifier's name and address go six months after the last day korbat owed the notice a decision, a mail or a changed outcome, 13 months after the notice at most when nothing moved it; a confirmation of an address after 30 days. A mail still unsent five days after it was due is given up. Decisions, measures, items and appeals stay as rows for good, like the audit log, with ids, handles, kinds, times and salted digests only. While a report or finding of child sexual abuse material about a post or its author's account is unanswered, and for as long as a seal stands, no image and no snapshot of that post is deleted or erased by anything; sealed images are released only by sub-project 3d.
- **The emergency switch.** When a flood of reports from unproven sources fills the queue, set `API_MODERATION_DEFER_UNPROVEN=on` in `infra/.env`, then run `docker compose -f infra/compose.yml up -d api`, which recreates the API with it, since the API reads it at start; `off` and the same command end it. While it is on, a case whose unanswered items all come from unproven sources is listed after the others of its lane, never below a less severe lane: in lanes 1 and 2 a report sent without an account or by an account under 48 hours old, in lane 0 only one sent without an account. The terms publish the switch, the home screen says whether it is on, and the queue marks such a case "deferred".
- **The mails.** People who report get `notice_received` ("korbat received your report <reference>") and at most one `notice_update` a day ("Decisions on your reports to korbat"); authors get `moderation_decision`, the statement itself, under a subject of its kind ("A post of yours is under review on korbat", "korbat restricted a post of yours", "korbat sealed images of yours while it decides", "korbat answered your appeal" and five more). Each ends with "korbat staff never ask for your password or a code, and korbat does not read replies to this email.", and no mail to an author carries a reporter, a report's words or a count. The staff mails go to every staff account, carry no link and no content, and end like 3a's. The urgent-lane alert (`moderation_urgent`, "korbat: a case is waiting in the urgent lane") goes when an item enters lane 0 and repeats about every 20 minutes until a decision answers the item or withholds the post in the interim; on a post already withheld, removed or deleted by its author, and on an account case, it stops once someone saves a note on the case after the item arrived, normally the Art. 18 check, and the case then waits for its final decision, an admin's for a report or finding of child sexual abuse material and for an item citing R5, under the queue-age mail. On a report or finding of child sexual abuse material whose case reaches an image that is still served it repeats until the images are sealed, someone records that they do not seal, or an admin answers, and starts again when an image is posted afterwards that the case reaches; where its case reaches no served image, a note or a decision taken while deciding ends it too. `moderation_waiting` ("korbat: cases are waiting longer than their response time") is the queue-age mail. Since sub-project 3f each also goes to the phones as a push that names nobody, the urgent lane's to the phone on call and the queue-age reminder to every staff phone, and their own last sentence says so; a mail by itself wakes nobody. The other four staff mails are those of The limits on staff.
- **`staff.js text-verify`** proves that what the record names is what korbat holds, as `audit-verify` proves that the record was not rewritten. It reads only, in one transaction: every digest in a confirmed row (a decision, a review, a reveal) must name a text or a snapshot that korbat still holds and that recomputes to it, or an erased one; every decision must be named by exactly one such row, with the same actor, target, params and measures; and every post's level and every image's state must be what the ledger of measures gives, with every post a seal in force lists still holding the image rows the seal recorded. It prints `text-verify: what the record names is what korbat holds: <n> confirmed rows, <n> decisions, <n> posts, <n> images and <n> seals in force`, or `text-verify: FAILED` with the number of problems and the first 20, and then exits 1. A failure means a change made around the triggers, by the migrator or by hand, or rows lost in a restore. It is run with `audit-verify` after each deploy and each week (the runbook's last bullet).
- **`staff.js notification-facts <record>`** (since sub-project 3f, in place of `account-facts`) prints `handle:`, `email:` and `created_at:` for the account a record of a report to the authorities concerns, and the ids and times of the record's posts, then the sentence of what korbat does not hold, and records the reading as a production. It takes only a record that is owed, which `staff.js records` lists: one a seal for good opened, or one `notification-open` opened for an Art. 18 check. No console screen shows an address: this command is how the operator reads one, while the report hold keeps it (Authorities' orders, Notifications and hand-overs).
- **`staff.js access-request <@handle | email>`** drafts the moderation part of an answer to a GDPR access request and prints it as JSON, for the operator alone; its audit row (`access_request_drafted`) carries counts only. For a handle: every case about the account or its posts, with its items' source kinds, grounds, rules and categories, the snapshots while held, every decision with its statement, the account's appeals, and the account's own reports as in its export. For an email: the notices filed with that address as contact. It never prints who reported: each reporter's and notifier's identity is listed as withheld, each report's explanation is marked to be sent only after a person has weighed the writer's rights, and every case that holds an urgent-lane item is marked for a check of the R2, Art. 18 and order records first. The runbook says how the answer is made.

Account sanctions (sub-project 3e; design `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md`) act on an account, and never by themselves: each is a measure of a final decision that a staff key confirmed, and the database decides whether it can stand, when it starts and ends, and what it means; no job and no clock adds one. Their numbers are `STANDING_RULES` in `packages/contracts/src/moderation.ts`, equal to the database's `standing_rules()` (a test compares them), and the terms publish them in the sections Strikes, Suspension and termination, Reporting in bad faith and Handles.

- **Strikes.** A final decision that a post breaks a korbat rule gives its author the strike the database computes, which counts for 90 days from the decision: none for a decision on the law alone, under R2, about a profile field or taken while deciding, at most one a post, and none for a post made before its author was told of their newest strike. The composer signs it, and the database refuses a decision whose strike is missing or not due (`strike_mismatch`). It falls only with its whole finding: a review or a correction that reverses the decision overrules it.
- **The ladder.** With 3 active strikes, at least one of them newer than the account's last suspension under the ladder, a moderator may announce a suspension of at most 3 days, then 7, then 30, by the number of the ladder suspensions decided in the last 365 days; after the third, an admin may announce a termination. After a suspension one further strike opens the next step. The moderator opens a finding on the account and decides on its case. A ladder suspension ends at once when an overruling leaves fewer than three of its strikes standing.
- **Announced suspensions and the reply.** A suspension or a termination of the ladder is announced: its statement is the notice, shown in the app at once and mailed. The suspension starts 168 hours after korbat's relay accepted the notice mail, or 336 hours after the decision when the relay refused the address or the mail was given up, and never earlier; while the mail's outcome is unknown it has no start. The person may reply once, from the decision's screen (`POST /api/moderation/decisions/:id/reply`). A reply sent before the start holds it until staff answer: "Keep" (a correction that keeps the decision) starts it at the later of the answer and the announced start, and the six months to appeal then count from that answer; "Reverse" lifts it. A reply sent later is answered the same way and holds nothing. One suspension or termination stands at a time (`standing_conflict`).
- **Suspensions at once.** Only an admin takes one, on an account case, and only on four grounds the database checks: a final R5 decision restricting a post of the account, at most 30 days old (up to 30 days), terrorist content likewise (up to 30 days), a flood under R6 that the admin finds, its floor at least 20 posts in the last 60 minutes (up to 7 days), and a protective suspension on a seal for good of the account's images at most 30 days old, once for that seal (up to 14 days), which is no finding and gives no strike. A termination at once is open only for a second threat, posted after the person was told of a suspension for the first. korbat aims to answer a reply to one within 24 hours, and the queue-age mail counts the replies that wait longer.
- **While suspended.** Every write of the account as an author or an engager is refused with `account_suspended`: posts, replies, quotes, likes, reposts, bookmarks, follows, profile edits, the handle change, uploads, the badge and reports under the rules. Signing in, reading, its cases, the reply, appeals, re-examinations, the export, deleting its posts or the account, undoing likes, reposts, bookmarks and follows, blocks, mutes and notices of illegal content stay open. Its profile and posts stay visible without any mark, others may still engage with them, and Explore leaves its posts and approvals out. The app shows a banner on every screen, and `/api/me` carries the account's standing.
- **Termination.** Until the decision is final for the person (the six months to appeal unused, or the appeal answered and the decision kept), and while any reply to it is unanswered, a terminated account is suspended and nothing else. Then the `account-purge` job takes it down as a deletion and mails `termination_final` in place of `account_deleted`. A take-down that fails is logged and counted, and never holds an ordinary deletion. A person's own deletion is never refused or delayed by a suspension, a termination or a seal.
- **The restriction of reporting.** Deciding "No breach", a moderator may mark a signed-in person's report under a rule "manifestly unfounded", and the key signs the marks. At least 5 marked reports in 90 days, being at least half of the person's rule reports then, open a warning (R6, on a finding about the account, never as the answer to a report); 3 marked reports sent after it, while it counts (90 days), open a restriction of at most 30 days, which refuses rule reports only and ends with its warning. Both sides count reports, never items, so no single report reaches a number. A mark counts, and the console lists it, only once its outcome has gone to the person in the daily release, when they can read it and ask for a re-examination: a warning or a restriction on a mark set today waits for the next release.
- **Handle retirement.** "Retire the handle", in a final decision on an account case, takes the handle from everyone, its holder included: the profile gets a placeholder that begins with `retired_`, which nobody can choose, and the holder may pick a new handle without the usual wait. "Give the handle back" lifts it.
- **What is kept of them.** The ledger's rows of strikes, suspensions, terminations, warnings and retirements stay as rows for good; their use ends with the numbers above. The `moderation-retention` job erases a reply's text once the reply is answered and its decision is final for the person (its step `reply_statements`), never an unanswered one, and deletes the marks and the daily tallies 90 days after their report's UTC day (its step `report_counts`); both go at once with an account's deletion. The export lists the account's strikes, standing measures, replies and reporting counts.
- **The Standing screen.** `/standing` on the console (`GET /api/staff/standing`) lists the accounts at 3 strikes, the reporting records, the notices korbat's mail service could not send and the terminations waiting for their take-down; the replies to answer stand first on the queue screen.

The runbook:

- **Linking.** Each staff member's personal accounts are linked with `staff.js link` at onboarding and whenever they say they opened another.
- **Reports and findings of child sexual abuse material (R2).** Nobody opens the images such a report concerns, in the console or in the app, before or after a seal, until an admin has answered without one. An image that a match of the known material check names is opened by nobody at korbat at any time, also after an answer without a seal: the console refuses it (Automated tools). After a seal for good, whoever has the server runs `staff.js records` and `staff.js notification-facts` for the record the seal opened, and reports and records it as Authorities' orders, Notifications and hand-overs says; while that report is owed, a deletion of the account keeps its address and nothing else, and the seal never waits for the report. Whoever is on duty opens the case and seals what it reaches with "Seal the images this case reaches", under rule R2, with the composer's drafts, and never writes that the images are such material. They seal unless the report is plainly unfounded, and then record why with "Do not seal now": an earlier answer without a seal was as unseen as this one will be, so it is a reason not to seal only when the report's words add nothing and the case reaches no image posted since that answer (the day of the last earlier answer against the day of the newest post the case reaches, both on the case page) and staff have opened the images since the last answer (the case page shows the day for a post; for an account, a note or the colleague says so); a case that reaches no image cannot be sealed. A report about a post that quotes another has a second case, on the quoted post, linked from the first and sealed the same way. Nobody opens a post's page in the app while a report of this kind about the post is unanswered or its images are sealed: it shows the post it replies to and its replies with their images, which the case does not reach. Nobody opens an account's profile in the app while a report of this kind about the account is unanswered or its images are sealed: it shows posts of other accounts that it reposted or quoted, which the case does not reach, and images posted since the seal; when the page shows images that are not sealed, whoever is on duty seals again. When the post's text links to or offers such material, the post is withheld as well. When the words of a report on another ground describe such images, whoever reads it opens a finding citing R2 on the post before opening any image. While such a report is unanswered, every other procedure about the same images (a report on another ground, a correction, the review of an appeal) is decided on text alone or waits for the admin's answer. A report about a post that is answered without action meanwhile, or while the post's images are sealed, is answered unseen, as the composer says there: its sender is told so and may ask again. An admin answers every such case, all its reports and findings of this kind at once, without seeing the images: seal for good, and report, when the report's words, the post's text or alt texts, or the account's conduct give a concrete reason to believe the report; answer without a seal when they give none; say which it was in the decision's facts; in doubt, ask the operator before answering; never open the images to settle it. On a post's case the admin's answer also answers the reports on other grounds that arrived before the newest report of this kind, unseen; their senders are told so and may ask again (on an account's case such reports concern the display name and bio, which the admin reads). After an answer without a seal the case's images may be opened: whoever is on duty opens the case's target the same day (a post's images in the console, on its case; an account's in the app, which is then the only place they are shown) and, where an image breaks a rule or the law, opens a finding on the post and decides it (if it is what the report said, a finding citing R2, which freezes again). For an account, and whenever a look found nothing, whoever looked writes a note on the case ("Images opened on <date> after the answer of <date>: nothing that breaks a rule"): the case page shows only the day a post's image was last opened in the console, nothing else on the server records a look at an account's images in the app, and the note goes with its case's evidence. When a new report of this kind arrives before that decision is made, the admin's next answer carries the measure for what staff saw, and its facts say when the images were seen. An admin's answer never restricts under another rule on a report's words alone about an image nobody at korbat has opened: that report is answered unseen, and its sender may ask again. An admin who can tell from an account report's words which post is meant opens a finding citing R2 on that post, seals there, and answers the account's item without a seal. An admin seals for good only what korbat then reports: on every seal for good the operator reports at once to the national police or the authority the Member State names, never to a hotline, with, for a post, its address, its times, the author's handle, the account facts and the text and alt texts of its snapshot, and, for an account, the handle, the account facts and the address, time and number of images of each post whose images are sealed, as the case page lists them (never an image). The operator records their reference with the address, the case and the seal's time, off the server, and tells them that korbat keeps the images sealed and destroys them only on their or a court's leave or instruction to destroy, recorded with its reference (Quarantine, A release). A copy for an authority is a hand-over (Authorities' orders, Notifications and hand-overs); a leave or an instruction to destroy is recorded and the images released as Quarantine, A release says, and nothing in the database is changed by hand. An admin lifts a seal for good only on the authority's answer that the images are not child sexual abuse material, and says in the reason that the authority has answered and the date of its answer, never its reference or anything that names a person (the reference stays in the operator's R2 records, off the server); a seal taken while deciding ends with the admin's answer, and before it an admin lifts it, by a correction, only when it was taken in error (on the wrong case, or on a report that the standard above gives no reason to believe). Every staff account is mailed `moderation_csam_lifted` after a lifted seal and after an admin's answer without a seal; the operator checks each against their R2 records and, when one was not expected, follows the mail's steps. A post already removed or deleted has its images sealed all the same (a seal of its own).
- **A seal that lists more posts than the case page shows.** The case page lists at most 500 posts of a seal and then says "use the runbook's query for a seal's posts". The read-only query `select s.post_id, p.created_at, s.images from seal_posts s join posts p on p.id = s.post_id where s.action_id = '<the seal's action id>' order by p.created_at, s.post_id` gives every post the seal lists, with its creation time and its number of images, for the report.
- **A post already removed or deleted.** A notice of illegality or any report about a post that another decision already removed, or that its author deleted after it was reported, is decided on its merits: a finding of a breach is recorded as a measure of its own. A report that arrives after the author's deletion names nothing live and is answered automatically, except a report of child sexual abuse material, which waits for an admin whatever is left of its target.
- **Account sanctions each working day.** Read the lists in this order: the replies to answer first (on the queue screen), then on the Standing screen the accounts at 3 strikes, the notices not sent, the reporting records and the terminations waiting.
- **Answering a reply.** Read the reply on its case and answer within 24 hours, with "Keep" or "Reverse" in a correction of the decision, writing in the reason what was weighed. A reply sent before the start holds the suspension until it is answered, a kept one never starts before its announced time, and a terminated account is not deleted while any reply to its termination is unanswered.
- **A protective suspension.** Only after an admin has sealed images of the account for good, in the case the report is in; then on the account's case, in a decision of its own, only by an admin, once for that seal, for at most 14 days, never worded as a finding and with no promise of a later look. Its appeal is reviewed at once, by an admin who took no part, and does not wait for the authorities; only the seal's own appeal waits. The report to the authorities follows the seal for good with `staff.js notification-facts`, and while it is owed a deletion of the account keeps its address and nothing else (Authorities' orders, Notifications and hand-overs).
- **A breach that lies only in a handle** (impersonation, a doxxed name, a threat) is decided with "Retire the handle" and no longer left open; the display name is still reset when it carries the content. Its Art. 18 note ends the urgent-lane mails.
- **A notice a person did not get by mail.** A person who writes to the contact address about a notice they did not get by mail is pointed to the app, where the notice is always shown and the reply is open; korbat cannot see whether a mail it sent arrived.
- **A measure at once while an announced suspension waits.** To take a measure at once on an account whose announced suspension has not started, use "Withdraw it for another measure" on the announcing decision, then take the measure at once; never "Reverse", which would tell the person that their reply succeeded.
- **A mark that was wrong.** A mark "manifestly unfounded" that was wrong is withdrawn with "Correct this decision" on the decision that set it, which withdraws all of that decision's marks together. Lifting a warning withdraws no mark, so whoever lifts one because its marks were wrong corrects those decisions as well.
- **Reports before an account measure.** Before a suspension or a termination of the ladder, a protective suspension, a warning or a restriction of reporting, decide the reports in the account's open case first: none of these measures ever answers a report.
- **Art. 18 and TCO Art. 14(5).** Whoever on staff first reads a lane-0 case, or any case whose content suggests a threat to someone's life or safety, decides at once whether it gives rise to a suspicion of a criminal offence involving a threat to the life or safety of a person (DSA Art. 18(1); a suicide threat is not such an offence). If yes, or unsure, and they are not the operator, they wake the operator at once, at any hour. They record the check in a note on the case ("Art. 18 check: no suspicion" or "Art. 18 check: operator told at <time>"), and nobody gives such a case its final decision before that note exists; the case page of every urgent-lane case says so above its evidence. If yes, the operator informs promptly, at any hour, (i) the police of the Member State concerned (where the offence is suspected, or where the suspect or the victim lives or is), (ii) when that state cannot be identified with reasonable certainty, the police of korbat's own state, Europol, or both, through the channel obtained beforehand from the national police or the Digital Services Coordinator, and (iii) for terrorist content with an imminent threat to life, the authorities of the states concerned, or else the home state's TCO Art. 12(2) contact point and Europol (TCO Art. 14(5)). The operator sends the content as the case page shows it, its publication time with the time zone, why it is suspected, the account's handle and what `staff.js notification-facts` prints for the case's record (opened with `staff.js notification-open --case <id> --duty <duty>`), and says what korbat does not keep (raw IP addresses, location). Images reported as child sexual abuse material are never sent this way, and are reported as the R2 bullet says. The operator records the authority, the channel, the basis for the state, the time, what was sent and the reference received on the server, with `staff.js notification-sent` and later `notification-answer` (Authorities' orders, Notifications and hand-overs); a check that ends in no is recorded with `notification-declined`.
- **Authorities' orders.** Since sub-project 3f an order reaches korbat at the contact point for authorities, wakes the person on call and is recorded, given effect and reinstated on the console, and every report to an authority and everything handed to one is recorded on the server. The section Authorities' orders is their runbook. An order handled by hand before 3f is entered with `staff.js order-open --received`, as one whose receipt the console cannot take.
- **The yearly count.** korbat publishes its yearly figures itself, on `/transparency`, on or after 1 March (The yearly edition), the orders' figures among them as numbers; `staff.js tco-counts <last year>` still prints, from rows, the figures of the calendar year before, korbat's own decisions on terrorist content and the orders alike, for an authority that asks.
- **The users' contact mailbox** (`WEB_CONTACT_EMAIL`). The operator reads it at least each working day, in a mail client set to load no remote content and to show no inline image or attachment preview. Attachments are never opened, previewed, downloaded or forwarded, and no link in a mail is followed: a korbat link is copied into the report form, never opened. Every report or notice found there is entered through the report form, signed out in a private window, from the mail's text alone, with the sender's links, ground, rule or category, explanation and cited law, and, for a notice that is not on the path for child sexual abuse material, the sender's name and email; the good-faith box is ticked only when the mail states the sender's good-faith belief that it is accurate and complete. It is stored as any report sent without an account, so the sender gets `notice_received` with the status link, the daily `notice_update` and re-examination. A mail that says it concerns the sexual abuse or exploitation of a child, child sexual abuse material or the grooming of a child is entered on the third ground of the form, with the choice its words name ("Sexual images or videos of a child" when they name none) and without the sender's name or email. When the entered report carries no contact (a rule-only report, for which the form asks no name or email, or the third ground), the sender gets the fixed reply with the reference and the status page's link from the success screen. The mail is then deleted with its attachments and removed from the trash the same day; the fixed reply that carries a reference of the third ground is deleted from the sent folder, and from the trash, once sent. A finding is never used for a mailed report or notice: it would say "found by a moderator" and send no receipt or decision. A mail from an authority is handled as the bullet on authorities' orders says, its attachment opened only after step 1 has verified the sender. No report or notice is answered by hand except with the three fixed replies below; the only other mails sent from this address are the GDPR answers (below) and the answers to an authority's order; at most 20 reports can be entered a day from one network (5 an hour), and while Turnstile is down they wait. The fixed replies:
  - asking for the good-faith sentence, or for the form: "korbat received your email. To handle it as a notice that something on korbat is illegal, korbat needs your statement that you believe in good faith that the information in it is accurate and complete. Reply with that sentence, or send your report through the form at <the app's address>/report, which asks for it. korbat's emails never discuss a case."
  - giving the reference and the status link: "korbat entered your report. Its reference is <reference>. To see where it stands, or to ask for a re-examination of a decision, open this page: <the link from the success screen>. Keep the link: korbat cannot show it again. korbat has deleted your email, and deletes this reply."
  - to a mail about a decision: "korbat answers a decision only through its own procedures: the person a decision restricts can appeal it in korbat under Settings, Cases, and a person who reported can ask for a re-examination of a decision to take no action on the page their receipt links to, or under Settings, Cases, Your reports, within six months of being told. korbat's emails never discuss a case."
- **"Illegal on the face of it" and "not evident".** A notice gives korbat knowledge only if it lets a diligent host see the illegality without a detailed legal examination (DSA Art. 16(3), recital 22), and each restriction must be diligent, objective and proportionate, with due regard to freedom of expression (Art. 14(4)). So a notice of illegality has three answers. Illegal on the face of it: restrict without delay on the legal ground, and the statement cites the law. Not illegal: "No breach". Not evident without a detailed legal examination: "Illegality not evident", a lawful answer that leaves the content up until a court or an authority orders otherwise; its sender is told, and can ask once for a re-examination, go to court or complain to the Digital Services Coordinator. It is a liability decision made case by case: should a court later find the content illegal and find that korbat knew, the hosting exemption of Art. 6 is gone for that item, so a moderator in doubt asks the operator before answering. A removal on the law names the law, never a rule, and is counted apart from removals under the rules.
- **The statement's texts** (facts, reason, legal reference, review reason) never hold personal data of anyone but the author: describe it ("the home address of another person"), never copy it, since they are mailed, exported and kept while the account exists, also after an R4 redaction has erased the content. A saved draft that copies it is not confirmed: save a corrected one. The API refuses a text that quotes what a reporter or notifier wrote on the case (`text_quotes_user`).
- **Tools.** Machine translation stays local. The console runs in a browser profile of its own with no extensions, and nothing from it is pasted into third-party tools. The daily limits on cases and reveals are raised with `staff.js limits` when honest work reaches them, and the new numbers go into the operator's records.
- **A `staff_recused` refusal** may mean one of the case's reporters is close to your own account: do not try to learn which, and leave the case to another staff member. When no other staff member can take it (with one staff member, always), the case waits in the queue and its lane-0 and queue-age mails keep coming, and the operator makes another person staff (grant-role and enrolment) to decide it. Nobody unlinks an account, or unfollows, unmutes or unblocks one, to get round a refusal.
- **A case about a staff account's content or profile fields.** Every final restrictive measure on a staff account is refused (`staff_target`): staff are disciplined by demotion. Whoever is on duty withholds the post or image, seals reported images, or resets the field, while deciding, as for any account, and tells the operator, who makes the account a user with `docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> user` (which ends its staff keys and sessions), after which a moderator who is not a party decides the case.
- **Mails that wait or were given up.** A count of waiting mails that stays above zero means the relay cannot take mail: check the API log for `MailUnavailable`; if it shows none, the dispatch fails before the send (its daily step, or a contact it cannot read): read the API log for `moderation-dispatch` and fix it the same day. A count of mails given up means the relay answered that an address does not exist (RFC 3463 5.1.1, 5.1.2, 5.1.3, 5.1.6 or 5.1.10), or a mail stayed unsent for five days; korbat does not try it again, the person still sees the outcome on the status page or in the app, and the API log names each one (`moderation: mail given up`). A relay that refuses korbat itself (relaying denied, missing credentials, a sender it refuses, a quota) raises the count of waiting mails instead, with `MailUnavailable` in the log: fix `API_SMTP_URL` or the relay within five days and nothing is lost.
- **Decisions not released, and late erasures.** The home screen shows either count only when it is above zero, with the sentence that stands here. A count of decisions not released means the daily release keeps failing: notifiers are not told and re-examination windows do not open, so read the API log for `moderation-dispatch` and fix it the same day. A count of late erasures names the due rule whose step keeps failing, so evidence, an intake record or a notifier's name and address outlives its published period: read the API log for `moderation-retention` and for `auth janitor: purge failed`, and check that `API_MODERATION_RETENTION` was not left `off` after a restore (the API logs it at every start).
- **A GDPR access request at the contact address.** Confirm that the requester holds the account (a mail from its address) or the email (the answer goes only to that address); run `staff.js access-request`; for every case it marks for the authorities' check, look in your R2, Art. 18 and order records. A case still open with a lane-0 item first goes through its R2 or Art. 18 step. For a case reported to an authority, or one an order concerns, ask that authority whether telling the person now would harm its work, and hold that case's part of the answer until it answers or counsel advises (GDPR Art. 23(1)(d) and the national law that applies; DSA Art. 9(5), 10(5)), within the periods of Art. 12(3); a person decides each item marked for weighing and records why; reply within one month (GDPR Art. 12(3)), saying what was withheld and why; keep the draft with the reply for the period counsel sets, since a withheld item may have to go before the supervisory authority or a court (C-203/22). Any other request under GDPR Articles 16 to 22 at the contact address: confirm the requester as for an access request; answer within one month (Art. 12(3)), saying what korbat did or, when it does nothing, why, and that the person may complain to a supervisory authority or go to court (Art. 12(4)); evidence that a case still needs is kept (GDPR Art. 17(3)(b) and (e), 21(1)). No answer names a reporter or notifier, quotes a report or a notice, or says whether a given person reported.
- **After each deploy and each week** the operator runs `staff.js text-verify` with `audit-verify`.

Records the operator keeps off the server, beside 3a's list of staff: each staff member's linked personal handles, updated at every `staff.js link` and `unlink`; every R2 report with the post's or the account's address, the case, the seal's time and the authority's reference; every act done by hand on sealed files on an authority's written instruction (what, when, on which instruction) that `handover-list` and `handover-record` did not record; and the numbers last set with `staff.js limits`. Since sub-project 3f the reports to authorities with their references, the notifications under Art. 18 and TCO Art. 14(5), the orders received, their verification, the answers sent and what was done are recorded on the server, with the commands of Authorities' orders, and the keeper's daily copy holds them off the server as well.

## Authorities' orders
Authorities' orders, the alert channel, records to authorities and recovery (sub-project 3f; design `docs/superpowers/specs/2026-10-09-authorities-orders-3f-design.md`) give korbat a contact point for authorities that wakes the person on call, a record of every order with the one-hour clock of a removal order, the measure "Disable for an order" with the author's notice and its hold, the preservation of what was disabled, a record of every report to an authority and of everything handed to one, the keeper's daily copy with which a restore names what it lost, and the yearly counts. The console's screens are Contact point, Orders, an order's page, a case that holds an order's measure and After a restore; what the console cannot do is the server's, with `staff.js` in the migrate service, as the migrator:
```bash
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js order-open --kind <kind> --state <CC> --authority <text> --reference <text> --channel <portal|post|other|mailbox> --link <url> ...   # an order whose receipt the console cannot take
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js order-verify <order> --how <text>       # the check against the register
docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js order-texts <order> --reasons < reasons.txt   # the authority's words (also --redress and --scope)
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js records                                 # the notifications owed and the archives not destroyed
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js notification-facts <record>             # what korbat holds of the account, for the report
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js tco-counts <year>                       # the yearly counts
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js                                         # every command, with its first line
```
Every command waits at most 10 seconds for a lock and says "nothing changed" when it changed nothing; every line it prints starts with its name, but for the JSON that `audit-export` and `access-request` print; an instant is written with its offset (`2026-10-10T01:00:12Z`). A command that reads standard input (`order-texts`, `order-document`, `address-check`, `handover-record`, `restore-import`) needs `-T` after `--rm`, or Compose attaches a terminal and the redirected file fails. `order-open` needs `API_HOME_STATE` and `API_APP_ORIGIN` in `infra/.env`, which the migrate service reads. No command opens an image or sends anything to an authority: the operator sends, the command records. After a restore, every command that writes a record takes `--gap <gap>`, the gap the After a restore screen lists.

**The contact point.**

- The contact point for authorities is a mailbox at an EU mail host, set as `API_CONTACT_POINT`. korbat watches it and reads nothing of a message but that it arrived and when; a person reads every message in the mail host's own app. Remote content is switched off in that app, and no attachment is opened on a device that holds a staff key before the sender is checked against the register.
- The watcher (`notify`) reads the inbox and the junk folder every 20 seconds. A new message rings the on-call phone; when nobody has signed in to the console, or acted in it, since the message arrived, it rings every staff phone 15 minutes after its arrival.
- Every message there may be a removal order until someone has read it. Junk is watched too: look into the junk folder whenever an alert came and the inbox shows nothing new. The mail host must file nothing anywhere else: no rule, filter or quarantine of the host may move or delete mail before it reaches one of the two folders, and whoever is on call looks through every folder of the mailbox once a day, because a folder korbat does not watch is an order nobody sees.
- Never move a message between the inbox and the junk folder, by "Not spam", "Move" or a drag: the mail host gives the moved copy a new number, and korbat counts it as a second message, which rings again and runs its own hour. If it happened, close the second row on Contact point with the first row's word.
- Two credentials open the mailbox and they are not the same. `notify` has an application password that can only read. Each person on call has the mailbox's own sign-in, with its second factor, in the mail host's app on the on-call phone: it is the one credential that can answer an authority in korbat's name. The operator keeps a list of who holds it and on which devices, and changes the password the day a person leaves.
- Never answer an authority from another address, and never from korbat.
- korbat never deletes the record of a message that nobody handled. After an outage, a restore or a change at the mail host, Contact point may therefore list old messages as stale: look at them in the mail host's app, then close them together on that screen, so that the home screen's count is true again.
- The address is published (the terms, the app's Contact section) only once `API_CONTACT_POINT` and `API_HOME_STATE` are set and the web build has its two arguments, `WEB_CONTACT_POINT` and `WEB_HOME_STATE`, which is the last step of Before going public.

**On call.**

- Who is on call is whoever's phone is subscribed to the topic `korbat-oncall`; every staff phone is subscribed to `korbat-all`. Handing over means: the next person subscribes, the operator publishes a test to the phone on call with `docker compose -f infra/compose.yml run --rm migrate node dist/staff.js alert-test --on-call` (nobody on call can publish: the phones only subscribe), the next person hears it ring, and only then the last person unsubscribes. Both note the time.
- The phone is an Android phone with ntfy from F-Droid. Before a phone goes on call, and after every system update, its owner runs the checks P1 to P8 and notes each result: the build and its version; a message through the public hostname on mobile data; battery optimisation off for ntfy; exact alarms allowed; the highest-priority channel overriding every Do Not Disturb mode the person uses at night, ringing until dismissed; a ring after two hours unplugged and still; a ring after ntfy, Caddy and the tunnel were each restarted; "Connection lost" within ten minutes of ntfy stopping. (The research's ninth check is an iPhone's and does not apply: korbat's phones are Android.)
- **The second leg, check M.** korbat's own alarm has one blind spot: when the watcher or the database itself stops at night, nothing reads the mailbox, so nothing rings; korbat only mails "Phone alerts are down", and a mail wakes nobody. For that night the on-call phone has the mail host's own app, signed in to the contact-point mailbox, with its notification channel set to ring through every Do Not Disturb mode the person uses at night. It is checked like P1 to P8, before a phone goes on call and after every system update, and noted: the operator stops `notify`, sends a test mail to the contact point, and the phone rings from the mail app alone. Its push runs through Google, which is why it is the second leg and not the first.
- The on-call phone carries a staff key the person has used on that phone, over NFC or USB, for a sign-in and two confirmations in a row. A computer with the second key is the fallback. No weaker way in exists for the night.
- Each morning the person on call looks for the daily test. A day without it is a fault: check the console's home screen and tell the operator.
- Once a quarter, at night and unannounced to the person on call, the operator sends a mail to the contact point and times the push, the sign-in and an order opened and closed without effect on a test post. The times go into the operator's notes.
- A phone's ntfy user is a line of `infra/ntfy/server.yml`, which ntfy reads as a mounted file; the operator makes its password hash and token with `docker compose --profile notify run --rm ntfy user hash` and `ntfy token generate`. The publisher's token stands in two places, that file and `NTFY_PUBLISH_TOKEN` for `notify`. A lost or replaced phone: the operator removes its line and restarts ntfy; the other phones reconnect by themselves, and an alert that arrives during the restart is published once ntfy is back, for as long as its hour runs. The same file exempts the watcher's own address on the push network from ntfy's request limit (`visitor-request-limit-exempt-hosts`; Compose gives `notify` that fixed address, as `infra/.env.example` says), so that a flood of alerts is published at once and not a few a minute; with another `PUSH_SUBNET`, change the address in both places, and restart ntfy after any change to the file.
- Upgrading ntfy: once a month, and at once on a security release, move the pin in `infra/compose.yml` to the newest release that is at least 7 days old, restart ntfy, publish a test to every staff phone with `staff.js alert-test` in the migrate service and hear it ring. Its maintainer supports only the newest release.
- What each alert means and what to do is its own second line. An alert never says who or what: open the console. What ends a message's alarms is handling it on Contact point, not the sign-in alone.

**A removal order, step by step** (the hour runs from the mail host's delivery time, not from when you woke).

1. Read the mail in the mail host's app. Note the authority, the reference, the addresses named, whether Section C is ticked, whether it says emergency.
2. Sign in to the console with your key. Contact point: "Open an order from this message". If Contact point does not list the message (the watcher was down, or the mail host filed it in another folder), open it all the same: Orders, "Open an order", "The message is not listed". The deadline then shows as unknown: act at once, and tell the operator, who records the time of receipt afterwards (`order-received`). Never pick another message in its place. Fill the form exactly as the order reads; if you cannot tell whether Section C is ticked, choose "I cannot tell", which holds the notice.
3. Read the record against the order once. A mistake is corrected on the order's screen, under "Correct what the order shows", before you disable anything; a missed Section C can be set by anyone at any time, also afterwards. Never open the order a second time under a changed reference.
4. Check the authority against your offline copy of the Commission's register. If you cannot finish the check and the hour is running, go on: the measure is reversible and keeps everything.
5. If the order has a manifest error or lacks what you need to find the content, send Annex III from the mailbox to the address in the order's Section F, with a copy to the address the console shows, and record "Annex III sent". The clock stops. When the clarification arrives, record it: a fresh hour starts at its delivery time. A link that names an account, or an image, is not unclear: an image's address is taken as its post; for an account, add the address of each post the order means, call the operator for the rest, and then close that link's item without effect ("The link names nothing korbat can disable for an order"). Annex III is no way to stop an alarm.
6. "Disable for an order", one key touch for up to 10 posts, and again for the rest: the order is given effect in full only when every post it names is disabled and every other link is closed with its reason, and its reminders run until then (before the first disabling anyone closes a link; afterwards an admin). Check each address from outside, in a private window: it must say that the post does not exist.
7. Send Annex II from the mailbox with the values the console shows, a line for each address; record "Annex II sent". If a member of korbat's staff wrote a post the order names, say so to the authority in the form: that person reads the contact-point mailbox like everyone on call.
8. By the next working day, on the server: `order-verify`, `order-issued`, `order-texts` (the reasons, then the remedies: each author who was already told gets an email that the notice has grown), `order-document`. For an order from another Member State decide with counsel, inside 48 hours of receipt, whether to ask for scrutiny, and record it with `order-scrutiny`. A link added to the order later makes it unverified again until `order-verify` is run once more.
9. Never tell the author anything yourself: not of the order, and, while its notice is held, not of any decision of korbat's own about the same post. korbat tells them, at once or when the non-disclosure period ends.

**Other messages and orders.**

- **An order to act against content under another law (DSA Article 9).** No hour runs for it, so nothing is done in doubt, and the console gives no effect to it before it is verified. In this order: open it; counsel reads it; whoever has the server verifies it and records `order-verify` (no register lists who may issue such an order: ask korbat's Digital Services Coordinator whether it holds a copy, which it does of a genuine one, or call the authority on a number you looked up yourself); then records the authority's reasons, its remedies and the order's territorial scope with `order-texts`, three times, because the author is owed all three with the notice; and, when the order says the author must not be told, the time until which, with `order-hold-until` (`none` when it names no time: the notice is then released at no time until one is recorded, and every staff account is reminded daily). Then "Disable for an order". Choose "must not be told" as the order says; the post is then kept from its author too. Tick "withheld from the author" otherwise only if the order's text says so. Afterwards tell the authority from the mailbox what was done and when, and record "Authority informed". Only when the order itself sets a time that cannot wait for all this does an admin give effect first, marking it urgent; the check and the texts then follow the same day, and each author gets an email when the texts arrive.
- **An order to provide information (DSA Article 10).** Open it; counsel reads it. Whoever has the server records with `order-tell-rule` whether and when the person may be told, and on which provision or sentence of the order that rests; the home state's default is in `STATE_FACTS`, and the cautious choice for an order nobody has classified is "never" until counsel has read it. Then `production-account`, with `--asked` for what the order asked for: it prints the handle, the address and the creation day and records the production; the operator sends that from the mailbox and records "Authority informed". When the rule is "at effect", or its time has come, the operator tells the person from the contact address, to the account's address and to no other, with the authority's reasons and the ways to challenge the order, and records it with `order-told`. korbat produces nothing else without counsel: it also holds the times and device types of an account's sign-ins, and whether an order reaches those is counsel's to say, order by order.
- **An order that names an account, not a post.** korbat cannot disable an account for an order from the console. Add the address of each post the order means and disable those, and close the account's link without effect ("The link names nothing korbat can disable for an order"). For the display name or the bio, and when the order means the whole account, call the operator at once: the hour for such an order depends on the operator, who decides with counsel what korbat does (a suspension is korbat's own measure and tells its subject, so it is no way to carry out an order that forbids telling). Do not answer such an order with Annex III: it is not unclear.
- A European Production or Preservation Order (e-Evidence): korbat has designated no establishment, since it serves its home state only. Do not act on it; send it to counsel the same day.
- A referral, a first-order notice, a request to preserve longer, a scrutiny decision: close the message with its word; the screen says what follows. A request to preserve longer is recorded with `order-preserve-extend`, which never shortens a preservation.
- A withdrawal or an annulment: check it as you check an order; an admin reinstates each item on its case and, once no measure of the order stands, closes the order ("Close without effect", with the ground), which also ends the reminders for an item that was not disabled yet. When the authority withdraws one item that korbat has not disabled and other items of the order stand, that item alone is closed on the order's screen ("Close this item without effect", "The authority withdrew this item"): by whoever is on call before the order's first effect, by an admin with the key after it. A reinstatement while the order's notice is still held tells nobody and leaves the hold as it is: whether the author may now be told is the authority's to say, and the operator ends the hold with `order-hold-end` (`annulled` or `released_by_authority`) when it says so. A forged order found later: `order-hold-end` with `not_authentic` first, then the reinstatement with the same ground, so that the author is told at once. An order that a court restores after it was lifted: an admin reopens it if it was closed, and the post is disabled again; its preservation counts from the new disabling.
- **An extension of a non-disclosure period, or a later time.** The database releases a held notice by itself at its end, and nobody is asked. So: every staff account is alerted daily in the last 7 days before any release, and whoever has the server then looks through the contact-point mailbox for an extension. When an extension of a removal order's period arrives, an admin records it on the order at once ("Extension received"), also at night and before the operator has read it; the operator checks it afterwards and confirms it with `order-hold-extend`, or, if it was not the authority's, ends the hold once the first period is over. A later time that the authority gives for a DSA order is recorded with `order-hold-until`, which only the operator can do: the person who reads such a mail calls the operator the same day.
- **A record entered wrongly.** Correct it on the order's screen; never close a true order or open it twice. Before any post is disabled anyone corrects anything. Afterwards anyone can still set "the author must not be told", and an admin corrects the rest, the closing of a link among it. Setting it after a notice went out withdraws that notice until the hold ends; what the author already read cannot be taken back, so tell the operator at once. Every correction alerts every staff account. If korbat's record said that the author must not be told and the order did not, an admin unsets it (or the operator ends the hold with `order-hold-end --reason not_ordered`): the author is told at once, and the notice says that the delay was korbat's mistake.
- **Reading a preserved post.** `order-access <item> --purpose <review|complaint|authority>` prints its text between two marker lines and its images' facts, never an image, and records the access; for an authority it also takes `--authority` and `--reference` and records a production.

**When nobody can act within the hour.** Act the moment someone can. Never record a time other than the true one, and send Annex II with the true times. "Nobody woke up" is not force majeure: Annex III is for its three grounds only. If korbat's watcher is down or cannot read the mailbox, the console still works: the order is opened with "The message is not listed" and given effect, and the hour does not wait for anyone with the server; its time of receipt is recorded afterwards. If the console itself cannot be reached, the operator takes the app's site off the network (`APP_SITE=closed` in `infra/.env`, then `docker compose -f infra/compose.yml up -d --no-deps caddy`, and a check from outside that the app's hostname answers 503, as Restoring says) until the order is given effect, and writes down when; then opens it again (`APP_SITE=open`, then `docker compose -f infra/compose.yml up -d --no-deps caddy api worker`). Tell counsel the same day; the quarterly drill exists so that this does not happen twice.

**Notifications and hand-overs.**

- When images of an account are sealed, the home screen says that a report is owed. The admin answers the case. After a seal for good, whoever has the server runs `records`, then `notification-facts`, reports through the home state's intake for notifications (its entry of `STATE_FACTS` names it), and records it with `notification-sent`; later `notification-answer` with the authority's reference and answer. A check that ends in "no" is recorded with `notification-declined` and its reason. A seal that a correction or a review lifts closes its record by itself, and the address is no longer held. A notification under DSA Art. 18 or TCO Art. 14(5) that no seal opened is opened with `notification-open --case <id> --duty <duty>` and then recorded the same way.
- Whether the sealed files go with the report: "only on the authority's demand" until counsel has answered the first question of Before going public; then this line reads what counsel said.
- A hand-over goes to an authority, never to a hotline, a lawyer or a company, by the channel the authority names in writing: `handover-list`, then the `handover` service with the directory given on its command line (`docker compose --profile handover run --rm -T -v <directory>:/handover handover < list > digests`), `handover-record`, and after the authority's receipt delete every copy and run `handover-destroyed`. The directory is on an encrypted volume and owned by uid 1000, the user the service runs as; no setting names it, so a stack on which no hand-over was ever made needs none. Nobody opens the archive. With a seizure, record what was taken (`handover-record --taken`).
- A person who deletes their account while a report is owed is told in the deletion's mail that the address is kept for at most 7 days, in words that say no more than the seal's own statement told them. `API_REPORT_HOLD=off` ends the practice for everyone once `docker compose -f infra/compose.yml up -d api` has started the API with it; set it only on counsel's advice.
- `records --verify` recomputes each record's digest against its audit row; run it with `text-verify` after each deploy and each week.

**A person asks about a missing post.** Whoever answers the contact address gives every such question the same answer, whatever the reason the post is gone: "korbat can tell you about your posts only what the app shows you: your posts are on your profile, and every decision about them that korbat can tell you of is under Settings, Cases. If something is not there, korbat has nothing it can add by email." Never look the post up first: an answer that differs by what you found would tell. This stays the answer to every mail that does not meet the next entry's test.

**An author writes about an order's notice.** The notice sends its author to the contact address for three things: a copy of the order, korbat's own mistake ("the order does not name this post"), and the preserved text for their challenge. A person reads that mailbox every working day and answers within two working days.

- Look the order up only when the mail names a notice the app has shown: it quotes the reference, or the day, that the notice prints. A held notice shows neither, so nobody can pass this test for one, and the fixed answer above stays for everything else.
- Check that the writer is the author before anything is sent: `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js address-check --handle <handle> < address`, with the mail's sender on standard input. It answers yes or no, prints no address and writes one audit row. On "no", answer with the fixed sentence above and ask the person to write from the address of their korbat account.
- A copy of the order, or the preserved text of `order-access --purpose complaint`, goes to that address and to no other. The copy is the document in the authorities' mailbox; korbat holds no other.
- "The order does not name this post": an admin compares the item's link with the order in the authorities' mailbox and, within two working days of the mail, reinstates with `wrong_item` or answers why not.

**The daily copy.** On the daily visit the keeper notes the head as before and then presses "Download since my last copy", confirms it with the staff key, waits for the line "The copy is recorded", and keeps the file with the head, off the server, on an encrypted device. A download that broke off records nothing: press again. The file holds no post and no statement, but it names authorities and references, held orders' among them, and a reference may itself name a person (a court's file can carry a party's name): it is kept like the head, not like a log. Every staff account is told when someone who did not take the last copy takes one, and is alerted once the newest copy is more than 48 hours old. On the server, `staff.js audit-export` in the api service writes the same lines and records its own copy.

**A key in someone else's hands.** Revoke it (`staff.js revoke`). On the Audit log, "What one key confirmed" lists what it did in the period. An admin corrects each decision on its case, under the caps; there is no batch. An order's disabling confirmed with a stolen key is checked against the mailbox: a true order stays in force.

**The yearly counts.** korbat publishes them itself (sub-project 3d): the yearly edition on `/transparency`, which appears on or after 1 March (The yearly edition), carries in a year with a removal order the figures of TCO Art. 7(3) and Art. 21(1) as numbers, under the report's headings and without the issuing state, and an order whose disclosure an authority's decision forbids is added by a marked second version once that decision ends. `staff.js tco-counts <last year>` in the migrate service stays for an authority that asks: it prints, from rows and for the calendar year in UTC, a line a figure: removal orders received by issuing state and from another Member State; items disabled; the minutes from each order's clock to its last disabling, how many outside the hour and how many with an item still open; Annex III by ground; scrutiny; reinstatements by ground; authorities' accesses to preserved content; what korbat itself restricted as terrorist content; referrals closed. It reads only and writes no audit row. A figure it can no longer give, because the retention job erased the rows it rests on or nobody recorded a receipt, prints "not recorded", never a zero, and the edition prints it the same way. The one heading of the report the server cannot count, complaints and court proceedings, stays the operator's, from their own notes, for the authority that asks. Then the state's own filing, where `STATE_FACTS` names one.

## Quarantine

The files of images sealed for good leave the image store: the one-shot service `quarantine` moves them into the volume `media-quarantine`, which neither the API nor the image worker mounts, and back when a seal for good is lifted (sub-project 3d). A seal taken while deciding leaves its files in the store. Nothing moves a file by itself: the home screen's line "Files to move or return" and the daily alert "Sealed files are waiting to be moved" say when the steps below are due, after every seal for good, after every lifted seal for good, and after every release.

1. `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-list > list`. Read the line it prints beside it: how many files move in, return, are destroyed, are for the operator. A post it leaves out is named there; the other posts' lines stand.
2. `docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine < list > receipt`. It copies, compares digests, renames and only then removes; a `destroy` line takes the digest first and removes the file in the quarantine and, where the store holds one of the same name, there too. One bad line never stops it: it prints the line, goes on, and exits 1 at the end. If it is cut short, run steps 1 and 2 again: a file is never in neither place.
3. `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-record < receipt`, then delete `list` and `receipt`: they name files. The record takes each line by itself and never refuses the others. A line that no longer fits the plan (a seal was lifted, or taken again, between the list and the move) is recorded where the file now is and printed, and the next list moves it back: run steps 1 to 3 again.
4. Nobody opens a file of the quarantine, on the server or off it. The volume is on the encrypted disk and is in no backup: a lost disk loses the sealed files, and no backup can bring a destroyed file back. Its owner and mode (uid 1000, mode 0700) come from the path `/media/quarantine` that the API's image creates; check them once after the first run, from inside the service: `docker compose -f infra/compose.yml --profile quarantine run --rm --entrypoint stat quarantine -c '%u %a' /media/quarantine` prints `1000 700`.
5. **A file in neither place** (`missing` on the receipt). Nothing is recorded for it yet, and the daily alert goes on. Look for it first: the disk, a run that was cut short, another volume. Only if it is gone, run step 2 again with `--lost` appended, then step 3: the file is recorded as lost and every staff account is alerted. An image whose seal was lifted then reads "korbat lost this image" for its author, who is mailed once. If the file was kept for an authority, tell the authority, and note it.
6. **A file without a record** (a receipt that was lost before step 3, or a restore). `docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine --inventory > have`, then step 3 with `have`: every file the quarantine holds has its record again, and the next list returns it, destroys it, or prints it for the operator.

### A release

An authority's assessment is not leave to destroy. Record it as Authorities' orders says (`notification-answer --answer illegal`): it releases nothing, and it is a reason the authority may want the files kept. If the authority asks for the files, hand them over (Notifications and hand-overs) and wait for its word. A release is possible only after the report is recorded (`notification-sent`), the files are in the quarantine, and an authority or a court has given korbat leave or an instruction to destroy them, in writing, with a reference. Record that as a fact of its own, with the day the leave bears and your name: `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js release-leave <seal> --by <authority|court> --reference <text> --day <yyyy-mm-dd> --operator <name>`, where `<seal>` is the seal's ledger row as its case shows it. If the authority asked that the person is not told, record that before any release: with the leave (`--untold`, with `--until <instant>` or without an end; `release-leave --end-untold <leave>` ends an open one later), or, when the request came apart from the leave, on the report's record as Authorities' orders says (`notification-event`, with its end or without one). The author's notice then waits for the end of every such mark. A recorded leave is never rewritten or deleted: check the seal and the reference before you record it. A leave that you recorded by mistake all the same is withdrawn, `release-leave --withdraw <leave> --operator <name>`: it then supports no release, and the right leave, if there is one, is recorded as a new one. Withdraw it at once: a leave that a release already rests on cannot be withdrawn, and nothing takes a release back.

Then an admin confirms the release on the case ("Release and destroy", with the key), and every staff account is mailed that it happened. Then run the Quarantine steps above, whose list prints the released files as `destroy` lines, and `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js release-show <release>`: it prints each destroyed file's digest and the day after which no backup that is deleted on time holds the files. On an instruction to destroy at once, destroy the backups of the image store taken before the move too, and note it; a backup kept for an authority is destroyed by hand when that authority releases it. An answer "not illegal" is no release: an admin lifts the seal and the Quarantine steps return the files. Silence ends nothing, and korbat promises nobody a destruction.

Since sub-project 2d a seal on an account's case also lists the account's profile pictures: nobody is shown them from the seal on, the Quarantine steps move their two files in and out as they move a post's, a release destroys them with the seal's posts' images, and `staff.js handover-list` hands them over after the posts' files. Three points stay open, and nothing is built for them yet: the case page's line of where a seal's files are (`seal_custody`) counts the seal's posts' images and not its pictures; a seal that lists pictures alone, with no post, is released from no console screen, since the console offers a release only for a seal that lists posts; and `staff.js notification-facts` names a seal's posts only, never its pictures, since 3f's list has no kind for an image's id.

## Automated tools

Two programs may help moderators (sub-project 3d; design `docs/superpowers/specs/2026-10-09-transparency-automation-3d-design.md`), each off until the owner switches it on after section 17 of that design: the R1 check (`R1_CLASSIFIER`) rates an uploaded image and puts one rated over the threshold before a moderator, and withholds it until then only with `API_AUTOMATION_R1_ACTS=on`; the known material check (`MEDIA_MATCH`) compares an upload's hashes with a source's list, refuses and holds an upload that the source reports as an exact match of its class for child sexual abuse material, and on a post opens a finding under R2 that an admin answers for a match of that class, exact or not, sealing the post's images until then only for an exact one and only with `API_AUTOMATION_R2_ACTS=on`. A match of another class is a flag for a person. `/rules` says what is on today. While a tool is off the retention job deletes what it stored: every hash, and every rating but one a waiting signal names; it does so also while `API_MODERATION_RETENTION=off`. A match record keeps its hash for 180 days after its case closed, its hold ended or its images were released, and then names nobody.

**A measure a program took, and a request for a person.** The home screen lists both. A moderator lifts the measure or decides the case, within 24 hours of a request; the statement says that the moderator looked at the image only if they opened it on the case first. Sealed images are an admin's and are opened by nobody, and an image that a match names is opened by nobody at korbat at any time, also after an answer without a seal: the console refuses it. A program stops taking measures by itself under a rule while 20 of its measures under that rule wait for a person, and under either rule while a request is older than 72 hours; if the only person who can answer will be away longer than the published target, switch the measures off before leaving (`API_AUTOMATION_R1_ACTS=off`, `API_AUTOMATION_R2_ACTS=off`, then `docker compose -f infra/compose.yml up -d api`): a program then only reports. "A program stopped taking measures" with nothing to explain it means the check or the API is faulty or in someone else's hands: set the same two settings, restart the API with `docker compose -f infra/compose.yml up -d api`, and read `docker compose -f infra/compose.yml run --rm api node dist/staff.js automation-status`.

**A held upload.** An admin ends the hold on Held uploads, unseen. The console does not say which way, and it preselects neither: what counsel has advised korbat is written here, by the owner, in the place of this line: "Counsel's advice of <day> on whether a match obliges korbat to report an upload that was never posted: <not yet given>." While it reads "not yet given", no admin ends a hold alone: decide with whoever has the server, and write the ground into the operator's notes the same day. "Report": the Quarantine steps, then `staff.js upload-report <refusal> --duty <duty>`, the report itself through the intake of the runbook of Authorities' orders, `notification-sent`, later `notification-answer`; the end is a release on a recorded leave to destroy (A release), never on an assessment. "No report" needs one of its three reasons; "another reason" is written into the operator's notes the same day. The upload is deleted 24 hours after "No report"; every staff account is mailed at once, and until the upload is deleted another admin can end the hold as "Report" instead. When the uploader's account is gone, `upload-report` says so: the report then carries the file's facts and times, and the address only while 3f still holds it (7 days from the refusal).

**Switching a tool on.** Each needs the lines of Before going public done first, the 3d owner's part B before the tool's own: the tool's own impact assessment and its date (`API_AUTOMATION_DPIA_R1` for the R1 check, `API_AUTOMATION_DPIA_MATCH` for the comparison), and, before a tool's measure is switched on, the date of the assessment that covers the measure (`API_AUTOMATION_DPIA_R1_ACTS`, `API_AUTOMATION_DPIA_MATCH_ACTS`) and, for the automatic seal, counsel's word on GDPR Art. 22. The API refuses to start with a tool or a measure on and its date unset. Then set the tool's settings in `infra/.env` (`R1_CLASSIFIER` and `MEDIA_MATCH` without a prefix, since the worker reads them too; the others with the API's prefix), run `docker compose -f infra/compose.yml up -d api worker`, and read `/rules`, which asks the server afresh: it must print the tool as on, with its own date, and `staff.js automation-status` must agree. Switching off is the same in reverse. The retention job then deletes, within its next rounds, every stored fingerprint but the one a match record holds and every stored rating; what a program found before is still put before a person; nothing else already recorded is deleted.

**Cloudflare's scanning tool** stays off. Switching it on makes Cloudflare file its own reports with NCMEC about content on korbat, which korbat itself does not make; a match would arrive as a path in a daily mail, which a person would turn into a finding citing R2 by hand. Decide it only with counsel.

## The yearly edition

The public figures (sub-project 3d; design `docs/superpowers/specs/2026-10-09-transparency-automation-3d-design.md`): `/rules` prints every rule, what korbat can do and when, what each automated tool does today as the running server reports it, and the rulebook's change log; `/transparency` prints one edition a calendar year, in counts that point at nobody: 0, "1 to 9", or rounded to ten, and a line under ten folded into "other", but for the authorities' orders, which the law asks for as numbers.

**The yearly edition, the monthly count and the daily value.** The edition publishes itself on or after 1 March: once a day after `API_MODERATION_DISPATCH_HOUR`, the API's job `transparency` asks for the last closed year's edition, and for every earlier year that has one, which gains a marked version only when an order whose hold has ended can now be counted; no figure of the running year exists anywhere. `staff.js edition <year>` prints the newest stored version, and `--correct` computes every table again and stores the result as a corrected version beside it, which its line on the page says; no version is ever changed or deleted. Each month the job stores two numbers of the month before, the accounts seen signed in and the sum of each day's readers without an account, and the counting sketches in Valkey go; `staff.js recipients` prints the exact figure, the average of the six full months before today, for an authority that asks (DSA Art. 24(3)); `tco-counts` stays for the authority too. Whether readers without an account are counted is `API_RECIPIENTS_SIGNED_OUT` in `infra/.env` (on unless set to off; then the pages say "at least"), which the API reads at its start: set it, then `docker compose -f infra/compose.yml up -d api`. Once a day after the same hour the job also publishes the audit log's daily value: the SHA-256 of `korbat.head.v2`, the day, the head's place and its hash, each on a line of its own, which shows neither the place nor the hash and differs every day; `/transparency` shows the last 30 days, a day without a value as such, and writes no audit row for it. The keeper's mail goes once a day to `API_HEAD_KEEPER_MAIL` alone, with the day, the value, the place and the hash; while it is empty no mail is sent. The keeper keeps each day's mail with the value, the place and the hash; "No daily value was published" is noted by the keeper, and every staff account gets that alert too. With `API_HEAD_WITNESS` set to `rfc3161` and a timestamp authority's https address in `API_HEAD_WITNESS_URL`, each day's value is first sent to that authority, the value and nothing else, and its proof is stored and offered on the page as `<day>.tsr`, which anyone checks with the authority's own certificates: `openssl ts -verify -digest <value> -in <day>.tsr -CAfile <certificates>`. An authority that does not answer leaves the day's value published without a proof; it is asked again in the day's later rounds, and every staff account is alerted ("A daily value has no outside timestamp"). The API reads these three settings at its start as well.

```bash
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js edition <year>             # the newest stored version, a line a figure
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js edition <year> --correct   # every table counted again, as a new version
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js recipients                 # the six full months before today, exactly
```

## Profile and account
Signed-in accounts manage themselves under Settings; every route below needs the session and, where it says fresh, a re-authentication within five minutes (the app opens its panel when the API answers `reauth_required`).
- **Profile.** `PATCH /api/me/profile` sets the display name (up to 50 characters) and the bio (one line, up to 160). `POST /api/me/handle` (fresh) changes the handle once every 30 days; every handle an account ever had stays reserved for it in `handle_history`, so nobody else can take an old handle and the account can go back to it, except a handle korbat retired, which is nobody's, its former holder's included; a retirement lifts the 30-day wait (Moderation, Handle retirement). There is no redirect from an old handle.
- **Email.** `POST /api/auth/email/change/start` (fresh) sends a code to the new address; `POST /api/auth/email/change/verify` moves the account there and tells the old address, whose notice carries a link (`/email-revert/<token>`, `POST /api/auth/email/revert`, valid 24 hours, once) that moves the account back and runs the lockdown described under Passkeys and fresh authentication (every session and device signed out, the password removed, passkeys and two-factor authentication set up since the day before the change removed). Sessions stay signed in after a change.
- **Verified badge.** Proof of holding a phone number, kept only as a keyed hash; one number per account. `VERIFY_PROVIDER` picks who sends the text: `off` (default; the badge is hidden), `dev` (the code is always `000000`; refused in production) or `vonage` (Vonage Verify v2 with `VONAGE_API_KEY`, `VONAGE_API_SECRET` and `VERIFY_BRAND`; the runbook is section 13 of `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, and `node scripts/verify-badge.mjs +4479xxxxxxxx` checks live credentials without touching an account). Routes: `POST /api/auth/badge/start`, `POST /api/auth/badge/verify`, `DELETE /api/auth/badge` (all fresh); starts are limited per account, per number, per IP and instance-wide (200 texts a day), and a flow takes at most five codes. The web build shows the badge section only with `WEB_BADGE=on` in `infra/.env` (the default is off, matching `API_VERIFY_PROVIDER=off`); set both together.
- **Data export.** `POST /api/account/export` (fresh, once a day) streams a ZIP with `export.json` (the account with its passkeys' names and dates, profile, posts, likes, reposts, bookmarks, following, blocks, mutes, sessions, devices and security events, then the member `moderation`: the decisions about the account as its Cases screen lists them, with their statements while korbat holds them, and the reports the account sent, with their outcomes once released; since account sanctions also its strikes, suspensions, terminations and reporting measures, its replies to them and its own reporting counts, and in the profile the handles korbat retired; then, since sub-project 3b, the member `imports`, the account's imports newest first with their source, state, times, choice and counts, while each post imported carries its source and the archive's date; and last, since sub-project 2d, the member `activity`, the seen marker, the settings and every entry received that korbat holds, each shown or with why not (Activity), while the profile carries `avatar` (the current profile picture's id, file and size, or null) and `sharePreviews`, and each post its `mentions`, the handles as written, and `countsHidden`) and every image the account uploaded under `media/`, the current profile picture's larger square among them, except sealed images, images of posts it deleted, profile pictures that are not the current one and images whose content was erased, which are in neither the list nor the files. It never holds another person's report, a reporter, a notifier or a staff handle. Nothing is kept on the server: the archive is written entry by entry (ZIP64 when it passes 4 GiB or 65,535 entries), `export.json` is read in pages and streamed last, image files go through the media module's checked open, a request that fails before the first byte gives the day's export back, and one that fails midway breaks the download instead of saving a truncated archive.
- **Deletion.** `POST /api/account/delete/start` (fresh) mails a code; `POST /api/account/delete/confirm` with the code and the handle typed by the owner deletes the account at once: every session is revoked, posts become tombstones with their images and any pending uploads deleted from disk, likes, reposts, bookmarks, follows, blocks and mutes go with their counters, the profile is anonymised and keeps its handle, and the auth row is anonymised. The `account-purge` job (every five minutes) finishes any deletion the process did not, and takes down a terminated account once its decision is final for the person (Moderation, Termination). Nothing can be undone. A suspension, a termination or a seal never refuses or delays a person's own deletion. Moderation outlives a deletion: images that a case holds as evidence, or that an unanswered report of child sexual abuse material or a seal freezes, keep their rows and files, served to nobody, until nothing retains them; open cases about the account or its posts go on and are decided on their snapshots; the reports the account sent are still decided, with nothing left that says who sent them; and the statements of decisions about the account are erased 12 months after the deletion (Moderation, Evidence and retention).
## Passkeys and fresh authentication
An account can sign in and confirm sensitive changes with a passkey (WebAuthn), beside the emailed code, the password and two-factor codes. The API verifies through `@simplewebauthn/server`, which only `apps/api/src/auth/passkeys/webauthn.ts` imports; that module pins korbat's settings and adds its own checks.
- **Settings.** `API_WEBAUTHN_RP_ID` is the domain passkeys are bound to (default: the host of `API_APP_ORIGIN`) and `API_WEBAUTHN_RP_NAME` the name a browser shows (default `korbat`). Production refuses `localhost`, an IP address and anything that is not the origin's host or a parent domain of it. Browsers offer passkeys only on `https` or on `http://localhost`, never on an IP address.
- **Adding.** `POST /api/auth/passkeys/register/options` and `/verify`. Up to 10 passkeys, 5 added a day. User verification (fingerprint, face or PIN) is asked for and never required; only the attestation formats `none` and self-attested `packed` are accepted, so nothing is fetched from an authenticator's maker. The owner is mailed a link (`/passkey-remove/<token>`, valid 7 days, once) that removes the passkey and locks the account down.
- **Managing.** `GET /api/auth/passkeys` lists them (name, dates, synced, the device that added it, new, suspended); `PATCH /api/auth/passkeys/:id` renames and `DELETE` removes, the last one too. "This wasn't me" on a passkey of the last 7 days (`POST /api/auth/passkeys/:id/not-mine`) runs the lockdown.
- **Signing in.** `POST /api/auth/passkey/signin/options` and `/verify` need no email: the browser offers the passkeys it holds for the domain, from the button or from the email field's autofill. A sign-in whose passkey verified the user counts as two factors; one that did not is followed by the two-factor code on an account that has two-factor authentication, and staff who have it always give the code. A signature counter that goes backwards switches the passkey off, mails the owner and refuses the sign-in.
- **Fresh authentication has two levels.** A session records what it proved and when. Level 1 is any factor in the last five minutes; level 2 is a user-verified passkey, or a two-factor or recovery code beside an email code, a password or a passkey. An account with two-factor authentication needs level 2 to add or remove a passkey, change its password or email, set up, turn off or re-issue two-factor codes, and delete itself; every other account needs level 1. A refusal is `reauth_required` with `details: { level, have }`, and `POST /api/auth/reauth` (password, emailed code, two-factor code, recovery code or passkey) answers the level reached and rotates the session's token in place, so a copy of the old token stops working. Sessions are listed and revoked by an id that survives the rotation.
- **Lockdown.** Every "this wasn't me" runs one routine: the new-device alert's link, the passkey mail's remove link, the button on a new passkey, and the email change's undo. It signs out every session and device, removes the password, and removes the passkeys and two-factor authentication set up since the day before the event, in one transaction; the owner gets back in with a code sent to their email. A mailed link is tied to the address it went to: it does nothing while the account is at another address and works again once the address is restored.
- **What is kept.** The public key, the credential's id, its counter, whether it is synced and was registered with user verification, its name, and the device that added it; nothing about a fingerprint or a face ever leaves the person's device. The export lists names and dates only, and deleting the account deletes the passkeys.
- **After restoring a backup** the counters in the database are older than the authenticators': run `update auth.passkeys set counter = 0, suspect_at = null where suspect_at is null or suspect_at > '<restore time>';` so no passkey is refused as a copy (section 11 of `docs/superpowers/specs/2026-09-25-passkeys-1c-design.md`).
- **Tests.** A software authenticator (`apps/api/test/auth/soft-authenticator.ts`) runs whole ceremonies in the unit and integration suites. The API prints two `ExperimentalWarning`s at start, from the library's probe of Node 24's ML-DSA support; they are expected.
## The interface
The app's look and feel come from the UI sub-project (`docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`): one design system of colour tokens, bundled fonts, Lucide icons and korbat's own components (`apps/app/src/components/kit`), with every visible sentence in a words module (`apps/app/src/lib/ui-words.ts` and its area's), so a later translation changes no screen.
- **Themes.** Light, Dim and Dark: ink and paper with one violet accent for actions, every pair of text and ground at WCAG AA in each (`apps/app/src/theme/tokens.ts`, which `apps/app/test/contrast.test.ts` checks). The default is System, which follows the operating system: Light, or the reader's dark style (Dark unless they choose Dim) when the system is dark. Settings, Appearance and accessibility (`/settings/appearance`, the one settings page a signed-out reader can open) also holds the dark style, the text size (Smaller, Default, Larger and Largest, which multiply every size and line height and on the web follow the browser's own text size too), the font (korbat fonts or System font), Reduce motion (Follow the system, or Always) and three Reading switches (Load older posts automatically, Open feeds at the newest post, Hide like, repost and follower counts). Each choice applies at once, with no Save button; a change of theme cross-fades the colours over 200 ms (150 ms with motion reduced), never on the first paint. The page's policy allows no inline script, so `apps/app/public/theme-boot.js`, served as `/theme-boot.js` without caching like the page itself and loaded first in its head, reads the stored choices and paints the page in the reader's theme before the bundle arrives.
- **What the browser keeps.** Three kinds of key in the browser's `localStorage`, each written by one module only (`apps/app/test/explore.test.tsx` holds the app's stores to that list): `korbat.appearance` (`apps/app/src/lib/appearance.ts`), the Appearance choices, written when one changes; `korbat.place.<account id>` (`lib/reading-place.ts`), where the account stopped reading in Following and Latest, written a second after scrolling stops and when the page is hidden; and `korbat.drafts.<account id>` (`lib/drafts.ts`), the text, never the images, of a post, reply or quote not yet sent, written half a second after typing stops and when the composer leaves the screen, and removed when it is sent or discarded. All three are cleared, whatever the account, when the session ends as `apps/app/src/lib/session-end.ts` decides it: when the app moves from signed in to signed out (a sign-out here or everywhere, a lockdown page, any 401 the API answers), and when its first `/api/me` answers signed out while a reading place or a draft is still stored (a session revoked, expired or signed out elsewhere while the app was closed). Appearance's "Clear what this device keeps" clears the same three at once and says "Cleared"; the theme returns to System. The feeds Home keeps in memory for the session (`lib/feed-cache.ts`) go with them each time. Two keys stay, because they belong to the browser and not to an account: `korbat.deviceId`, a random id that tells a new device from a known one at sign-in, and `korbat.passkeySuggestion.dismissedAt`, the passkey card's Not now. On iOS and Android the appearance and drafts are kept in memory only, and the reading place not at all, until sub-project 5 brings storage there.
- **Haptics.** On iOS and Android only, through expo-haptics 57.0.3, by seven intents (`HAPTIC_INTENTS` in `apps/app/src/lib/haptics.ts`): a toggle turned on, a toggle turned off, a selection, a drag crossing its close threshold, a success, a warning and an error, each fired with the visual change it goes with. Ordinary taps, scrolling and navigation have none, and the web has none. Appearance's Haptics switch, shown on iOS and Android only, turns them all off; reduced motion does not.
- **Fonts.** Fraunces for display, Atkinson Hyperlegible Next for text and Atkinson Hyperlegible Mono for handles, codes and ids, so look-alike handles differ at a glance, from the `@fontsource-variable` packages at 5.3.0. The web export bundles their woff2 files under `/assets/`, which Caddy serves as immutable and the page's policy allows as `font-src 'self'`; no font comes from a CDN, and a latin-ext file loads only when a page needs one of its characters. All three are under the SIL Open Font License 1.1, their licence files in `apps/app/assets/fonts/LICENSES/` (Third-party notices, below). iOS and Android draw the system's font until sub-project 5 embeds the files.
- **Profile pictures** (since sub-project 2d). Settings, Profile has a card Profile picture: the person picks one image, chooses which part to keep (Top, Middle or Bottom of a tall picture, Left, Middle or Right of a wide one; a square needs no choice), sees the square it will be, and uses it. The file goes up through `POST /api/media?kind=avatar&crop=` with `start`, `centre` or `end`, as any upload does, and the image worker cuts the square and writes two WebP squares, 400 and 128 px on a side and never enlarged; the original is never kept, only the file's SHA-256. `PUT /api/me/avatar` sets it and `DELETE /api/me/avatar` removes it ("Remove picture", asked once); setting and removing together are limited to 10 an hour and 30 a day. A picture passes every check an image passes: the declared type and the first bytes, the size and pixel caps, the worker's isolation, and, while sub-project 3d's tools are on, the known material check, whose acting match refuses and holds it as any upload, and the R1 rating, taken from the 400 px square. A rating at or over the threshold, or a match that only flags, opens a program's finding on the account's case, a finding and never a measure, however the switches are set; with `API_AUTOMATION_R1_ACTS=on` an R1 picture is also held for review: shown to its owner only, everyone else seeing the monogram, until a person decides. A moderator answers a picture with "Reset profile picture", which removes it and shows the monogram; the same picture (the same file by its SHA-256) is then refused as that account's picture for 30 days, with words that say why (`avatar_reset`), while any other picture may be set at once. A report about an account holds its current picture with the case, and the case page shows it, or a placeholder while the case is frozen. A suspended account may remove its picture but not set one. A picture is public, served to anyone under the public header of The edge and drawn in the monogram's place in posts, lists, the profile and the cards; an upload of a picture that is never set goes after a day, a replaced or removed picture at once, and the current one with the account's deletion, unless a case holds it or a seal keeps it, which is then served to nobody.
- **Budgets.** The app's browser check holds every web export to the design's section 11.3: JavaScript at most 832,257 bytes gzip, which is the export of 1222b87 (709,377 bytes, recorded in `apps/app/test/browser/baseline.json`) plus 120 KB, since that baseline is above 400 KB (plus 80 KB until sub-project 3b's import screens, for which the owner raised it); CSS at most 40 KB gzip; the latin font files at most 320 KB; at most 3 API requests before the first content of Home, a post, a profile and `/rules`; and Home's first post drawn within 2.5 s at 1280 px. At the sub-project's end the export measured 789,381 bytes of JavaScript and 5,464 of CSS gzip, and 210,408 bytes of latin fonts in four files; after sub-project 3b's screens, 812,307 bytes of JavaScript gzip; after sub-project 2d's, 824,905 bytes, measured by the method `baseline.json` records, which is 12,598 more than after 3b and within the 20,480 bytes the 2d design allowed it (its decision 27), so the cap was not raised.
- **The app's browser check.** `pnpm --filter @korbat/app test:browser` (57 steps, about fourteen minutes) builds the web export with `EXPO_NO_DOTENV=1` and an environment of its own (an empty API base, so every call goes to the check's server, and Cloudflare's Turnstile test key), so `apps/app/.env` is never read; serves it from a small Node server with the headers of the Caddyfile's app site and a fixture API beside it; and walks it in Chromium through playwright-core 1.63.0: the layout at 360, 768 and 1280 px, the keyboard, contrast as drawn in Light, Dim and Dark, the largest text at 320 px, motion with and without reduced motion, and the screens of the design, since sub-project 3b the import screens, the provenance label and the Imported tab among them, and since sub-project 2d Activity, Settings, Activity, the profile picture's picker, mentions, the Getting started panel of a new account's empty Following and hidden counts. It needs no stack and no internet, answers Turnstile's script with a stub, and never downloads a browser: it drives the Chromium build playwright-core names, which must already be installed (never `playwright install`), or the installed Chrome with `KORBAT_BROWSER_CHANNEL` set to `chrome`. With `KORBAT_SHOTS` set to a folder it keeps its screenshots there (otherwise in a new temporary folder, which it prints), and with `KORBAT_APP_EXPORT` set to a folder it reuses an export built with the same environment instead of building one. Any policy report, console error or warning, page error, dialog or request the fixtures do not answer fails it.
- **The staff console** keeps a look of its own within its strict policy (`apps/admin/README.md`, The look): the app's colour roles at their Light and Dark values, chosen by the operating system's setting alone, with no switch and no dim style (the UI design's decision 21); red as its mark beside a blue focus ring; and the system's fonts, since its policy loads no font file (decision 2).
## Importing posts
A person brings their own public posts from an X or a Mastodon archive, and from a Bluesky repository once the owner turns Bluesky on (sub-project 3b; design `docs/superpowers/specs/2026-10-22-import-3b-design.md`). korbat accepts only the official export file the person downloaded themselves, never a password or a handle, and fetches nothing from the other platform. Imported posts are korbat posts, under the rules like any other, on their author's profile only.
- **Import posts in Settings** (`/settings/import`, on the website; iOS and Android wait for sub-project 5). The person picks a source the site has on and reads how to get its archive, what korbat reads and never reads from it, and that the whole archive passes through korbat's server and its network provider; the app checks the file's size (at most 2 GiB) and first bytes before anything is sent. The upload runs in the tab, in chunks of 8 MiB, each sent with its SHA-256, and must finish within 24 hours of its start; after a lost connection or a reload the person chooses the same file again, and the upload resumes from the bytes the server holds. The importer reads the archive, and the person sees the preview: what was found, and what will be left out and why. They choose a range of months; whether to bring replies to other people, posts with a content warning and X posts from protected periods (each off by default); whether to leave out or shorten posts over 1,000 characters; they may leave any post out one by one, tick the statement "These are my own posts, and they were public where I posted them.", and confirm. Nothing is published before that, and a preview not confirmed within 24 hours of the reading expires.
- **The profile's Imported tab.** Published posts go on the author's profile under Imported, newest first by the archive's date, each under the label "Imported from X, dated 3 Mar 2019", which opens Who sees this at its paragraph on imported posts. They never enter Following, Latest, Explore or the Posts and Replies tabs; anyone may still like, reply to, repost or quote one, one deliberate act at a time. The import's screen shows its progress. Stop import ends an import that is still preparing or publishing, and Remove imported posts deletes every post of an import in one action, through the author's own deletion path, so freezes, holds and evidence stay as every deletion leaves them. A later import skips every post an earlier import of the account published that still exists.
- **What an import reads, and what it never reads.** Only its source's allowlisted files: X's `data/manifest.js`, its tweets files, `note-tweet.js`, `twitter-circle-tweet.js` and the timestamps of `protected-history.js`; Mastodon's `outbox.json`; a Bluesky repository's commit, its tree and its post records; and, only while images are imported, the image files of the posts kept. Every other file, X's messages, IP logs, contacts, ad data, likes, follows and deleted posts among them, is skipped by its name and never opened. Mastodon's direct and followers-only posts share `outbox.json` with the public ones: each is skipped by its addressing before any other field of it is read, and is never kept or logged. Of what it reads the importer keeps only the person's own public posts and their threads; reposts, polls, Circle tweets and posts labelled as adult content are left out and counted by reason in the preview. korbat stores, shows and logs no handle, display name, account id, instance, DID, link to the original or source post id of the other platform, and never links an imported mention to a korbat account. On each imported post it keeps the source, the date the archive gives it (readers see the day only), whether it was shortened, and a keyed hash (below).
- **The two volumes, in no backup.** The API writes each archive into the volume `import-archives`; the importer, a service with no network, no capabilities, a read-only root and no credentials, reads it from there and writes the person's kept posts and their images into `import-work`, which the API only reads. The archive is deleted as soon as its scan is read, and at the latest 24 hours after the import was created; the work output when the import ends, and at the latest 72 hours after the scan. Neither volume is in any backup, by design: an archive holds the person's messages and other people's data, and nothing in either is meant to outlive its import. The API takes no new import while the importer's heartbeat is more than 60 seconds old; `docker compose ps` shows the service's health. The import's record (its source, state, times, choice, the time of the statement and counts, never a file name or a handle) stays in the database while any post of it exists and at least 30 days after its end, and goes with the account.
- **Limits.** An account imports once it is at least 7 days old, and an account younger than 30 days publishes at most 1,000 posts an import. One active import an account; 3 published imports an account in seven days (a failed, cancelled, expired or refused one costs nothing) and 5 imports started from one address in a day; at most 50,000 posts and 5,000 images kept an import. Imports never count against the post, reply or upload limits.
- **The per-account import key.** So that a later import can skip what an earlier one published, each imported post keeps a hash of its source post's id, keyed by a random key of the account's own (`import_keys`), never the id itself. The hash is still a pseudonymous id: source post ids of public accounts are public, so whoever holds the database or a backup of it, with the account's key beside it there, can test whether this korbat account imported a named account's public posts. No key of the server's alone does this, since the keys are per account; the account's purge erases its key, and a backup keeps it until that backup is deleted (Backups).
- **The console.** Staff see an imported post's label wherever the console shows the post, and on its case the import's size. An admin can end a whole import: End this import, under the label on a case about one of its posts once the case holds a final decision restricting it, confirmed with the staff key (a step-up, the audit action `import_ended_by_staff`), stops the import if it still runs, removes every post it published through the person's own undo path, and mails the person the rule and the decision, which they can appeal as any. Moderators are not offered it. After a restore, a lost end is an open gap of the class `restriction` on After a restore, naming the import: the API closes it when the import is ended again with the gap named (`POST /api/staff/imports/<import>/end?gap=<gap>`). The console's End this import names no gap yet, and the gap links no case, so for now an admin finds a case about one of the import's posts, ends the import again from it, and then closes the gap as Not needed with the key.

**Settings**, in `infra/.env`. Compose passes each to the API without its prefix (the names of the design's section 7.7), and the API reads them only at its start: run `docker compose -f infra/compose.yml up -d api` after a change. A blank value is the default.

- `API_IMPORTS` (default `on`): `off` refuses every new import with "Imports are paused for now. Try again later."; imports already running finish.
- `API_IMPORT_SOURCES` (default `x,mastodon`): the sources a new import may name, comma-separated, of `x`, `mastodon` and `bluesky`. A repeat is dropped; a list that names no source, or an unknown one, stops the API at its start.
- `API_IMPORT_IMAGES` (default `off`): `on` imports images, and is refused while `MEDIA_MATCH` is `off` (below).
- `API_IMPORT_MAX_ACTIVE` (default `2`, from 1 to 100): imports being uploaded or scanned on the site at once; past it a new import is refused as paused. The importer scans one archive at a time.
- `API_IMPORT_IMAGES_PER_HOUR` (default `600`, from 0 to 600, so it can only be lowered): imported images the API hands the image worker an hour on the whole site, at most 2 at a time and only while no person's own upload waits for the worker.
- `API_IMPORT_MIN_FREE_BYTES` (default `2147483648`, 2 GiB): free space kept on `import-archives` beyond a new archive's declared size and the 4 GiB its scan may write; short of it a new import is refused as paused.
- `MEDIA_MATCH` keeps its own name, since the worker reads it too (Automated tools).

**Images stay off.** `API_IMPORT_IMAGES` set to `on` stops the API at its start while `MEDIA_MATCH` is `off`, in every environment (decision 15): an imported image is published only once the comparison with known material has answered for it, since a bulk path for thousands of foreign images is not where korbat accepts what no tool has looked at. This build has no adapter for a real source, and 3d refuses the stand-in, `test`, while `APP_SITE` is open, so no build imports images today: imports are text only until the owner connects a real matcher source (Automated tools, Switching a tool on), and the preview counts the images left behind with the reason. With images on, the person still chooses Bring images (off by default), an image comes only with a description, its source's or one the person writes, and the first image the matcher refuses stops the whole import before anything is published.

**Bluesky.** Add `bluesky` to `API_IMPORT_SOURCES` only by your own choice, after reading this (decision 16). Anyone can download anyone's Bluesky repository without signing in, so a Bluesky archive proves nothing about who uploads it. Turning it on accepts that a person can publish someone else's public Bluesky history on their korbat profile, met only by the statement, reports under R6, the label's plain words and an admin's end of a whole import, and that the person copied may never learn of it, since imported posts reach no feed. Bluesky imports are text only: the export holds no image files, and korbat never fetches them from a PDS.

**The labs** (design, section 12.5) measure the importer against archives they build themselves, and run in no gate: the zip bombs, the JSON bombs, path traversal and large archives (`apps/importer/test/lab/README.md`), and the API's intake of a large archive (`apps/api/test/lab/README.md`, The intake of a large archive). Run the importer's in its Dockerfile's build stage with its own limits, about 25 minutes at half a processor (in Git Bash on Windows, put `MSYS_NO_PATHCONV=1` before `docker run`), and the API's from `apps/api`, about a minute, writing 1 GB to `.data` while it runs:

```bash
docker build -f apps/importer/Dockerfile --target build -t korbat2b-importer-build .
docker run --rm --network none --memory 512m --memory-swap 512m --cpus 0.5 --read-only --tmpfs /tmp:size=16m -v korbat2b-importer-lab:/lab -e LAB_DIR=/lab korbat2b-importer-build pnpm --filter @korbat/importer test:lab
docker volume rm korbat2b-importer-lab
cd apps/api && node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/imports-intake.lab.ts
```

On 2026-10-26 all sixteen of the importer's cases passed in 22.7 minutes (every bomb refused within 5 seconds and under 64 MB, every large archive scanned within the 30-minute watchdog with its peak under 400 MB), and the intake of 50,000 lines took 52.1 s with a peak of 252 MiB, within the API's 512m; each README holds its table.

## Before going public
**The hard gate.** korbat is not opened to the public and sign-up is not opened to people the operator does not know until sub-project 3f's order path and sub-project 3d's quarantine and release have shipped and the lists below are done, and no authorities' contact point is published before then. The TCO Regulation (Regulation (EU) 2021/784) applies to a host insofar as it disseminates information to the public (Art. 1(2)) and its removal orders must be executed within one hour (Art. 3); DSA Art. 9 and 10 orders presuppose a service offered in the Union. Sub-project 3f receives both, carries them out from a phone at night, records every report to an authority and everything handed to one, and takes what korbat did again after a restore. 3c can seal images reported as child sexual abuse material, 3f hands them over to an authority, and 3d moves them out of the image store and releases them, only on an authority's or a court's leave or instruction to destroy (Quarantine, A release). Moving sub-project 4 before 3f or before 3d reopens this. The designs are `docs/superpowers/specs/2026-10-09-authorities-orders-3f-design.md` (the order path, the alert channel, the records of reports to authorities and the recovery after a restore) and `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md` (strikes, suspensions and handle retirement); the order of work is 3c, 3e, 3f, 3d.

**The owner's list (sub-project 3f).** korbat is not opened, and `API_CONTACT_POINT` stays empty, until every line is done. It holds everything the 3f design assumes the owner has done: a line that is missing here is a thing nobody does.

1. **The Member State.** Set `API_HOME_STATE` and the web build's `WEB_HOME_STATE`; fill the state's entry of `STATE_FACTS` (`packages/contracts/src/orders.ts`: the authorities and their register entries, the address for the copies of Annex II and III, the intake for notifications, the contact point's languages, the yearly filing, and the state's rule for telling a person of an order to provide information). Germany's entry is the worked example; any member the console prints as "not filled in" is yours.
2. **The mailbox.** A mailbox at an EU mail host that offers IMAP over TLS with an application password that can only read mail, tells you the junk folder's name, stores mail in the EU and forces no other sign-in for IMAP. Two more requirements, each checked with the host and with a test mail: no rule, filter or quarantine of the host moves or deletes mail before it reaches the inbox or the junk folder (a folder korbat does not watch is an order nobody sees), and the date the host stamps on a message is the time of its final delivery. Switch off remote content. Put the four `NOTIFY_IMAP_*` values, `KORBAT_NOTIFY_DB_PASSWORD` and `NTFY_PUBLISH_TOKEN` in `infra/.env`, switch the services on with `COMPOSE_PROFILES=notify`, and set `API_NOTIFY=on`.
3. **The people's own access to the mailbox.** Every person on call reads orders in the mail host's own app and sends Annex II and III from the mailbox, so each needs the mailbox's own sign-in, which is not `notify`'s read-only password: decide who holds it, with which second factor, on which devices; write the list down; and change the password the day a person leaves. It is the one credential that can answer an authority in korbat's name.
4. **Registering.** Register the contact point with the competent authority and ask the eight questions of the research (OL E9.4): the channel and sender, whether other states use the same address, which time counts as receipt, how Annex II and III go back, whether a small host needs a portal account, how removal is checked and whether a "not found" page is read correctly, a test transmission, and whether referrals come to the same address. Register with the national intake for notifications and ask how files are delivered.
5. **The push hostname and ntfy's users.** The tunnel itself, which is still the Foundation's open task. A third public hostname on it for the push site, set as `API_PUSH_ORIGIN`. `infra/ntfy/server.yml`, made from its example: the publisher's token (the same value as `NTFY_PUBLISH_TOKEN`) and one user a phone, each with a password hash and a token made with ntfy's own commands; no example value left in it.
6. **The phones.** One Android phone a person on call, ntfy from F-Droid, the checks P1 to P8 each noted, and check M: the mail host's app signed in to the contact-point mailbox, ringing through Do Not Disturb, tried with a test mail while `notify` is stopped. The hand-over between people on call practised; the daily test looked at for a week; one night drill.
7. **The keys.** A security key with a PIN that works on each on-call phone, over NFC and over USB: sign in and confirm twice at night speed, and note the phone models that work.
8. **The papers, and counsel.** An offline copy of the Commission's register of competent authorities, refreshed each month; the texts of Annex II and III; this runbook, printed. Counsel who has agreed to answer inside two days, and the same day for a removal order from another Member State (the 48 hours for scrutiny), who reads every DSA Article 9 and Article 10 order before korbat acts on it; counsel's number, and a second one for the nights the first does not answer.
9. **The contact address.** The notice, the terms and the deletion mail send people to the address under Contact for a copy of an order, for korbat's own mistake and about a held address. Decide who reads that mailbox every working day and answers within two working days, from the runbook's two entries ("A person asks about a missing post", "An author writes about an order's notice").
10. **The page for the yearly report.** Nothing to create: since sub-project 3d the yearly report is the edition on `/transparency`, which korbat publishes itself on or after 1 March and the terms page links. Read it once after the first 1 March after korbat opened, and decide `API_RECIPIENTS_SIGNED_OUT` (The yearly edition) before then.
11. **The keeper, and the two places files rest.** The daily copy kept off the server with the head, on an encrypted device, since it names every order, held ones included; one restore drill with it, from `restore-import` to the app's site open again. And the directory a hand-over's archive is written into: on an encrypted volume of the server, owned by uid 1000, emptied after every hand-over.
12. **Decide**, each with its cost in section 2 of the 3f design: korbat serves its home state only (row 6); a page that is not public answers "not found" (row 17); Android only, no voice call (rows 19 and 20); every message at the public contact address rings the on-call phone, so anyone who knows the address can cost a night, bounded only by the quiet period of 15 minutes, which is one constant and can be zero (row 20); a watcher or a database that stops at night wakes nobody, and the hour then depends on the mail host's app (row 22); a console tick holds the notice with no shorter cap (row 25); a DSA order's silence lasts as long as its authority states, with no end while it names none (rows 24 and 46); the author's view during a hold, and that korbat's own decisions and appeal answers about the post wait with it (rows 26 and 47); account data is not held for an order (row 30); an order against an account as such is not built, and its hour depends on the operator (row 43); the hand-over's way and the address hold (rows 34 and 35); when the yearly report is published (row 40); the periods, and that a message nobody handled is never deleted (row 42); the known limits (row 45).
13. **Counsel**, with the questions as the research words them: OL E9.4 (receipt under national law; an order in a language not declared), OL E12.4 questions 1 to 7, OL E15.4, OL E20.4 and OL E21.4; AU E16.4 questions 1 to 7, AU E17.4 and AU E22.4 questions 1 to 6. The first to answer: whether sealed files go with a notification. And six that the design's review added: a DSA Article 9 order whose silence has no end ("until further notice"); whether a statement of korbat's own about the same post, sent during a hold, would itself be "information on the removal"; whether an earlier decision's copy of a post's text may still be shown to its author while Article 6 preserves the post; when and how a person is told of an order to provide information (DSA Art. 10(5)) and what the home state's law says instead; whether sign-in times are produced for such an order; and the words of the deletion mail while nobody has judged the report, with whether GDPR Art. 21 gives a right to object there.

Set these in `infra/.env`:
- `API_APP_ORIGIN` to the public origin, for example `https://korbat.example`; the API refuses a plain-http origin in production.
- `API_TURNSTILE_SECRET_KEY` and `WEB_TURNSTILE_SITE_KEY` to the keys of one Turnstile widget; the API and the web build refuse Cloudflare's test keys in production.
- `API_SMTP_URL` and `API_MAIL_FROM` to the EU mail relay; a plain `smtp://` relay must offer STARTTLS, which the API requires in production.
- `API_WEBAUTHN_RP_ID` before the first passkey is registered, when it should differ from the host of `API_APP_ORIGIN`; changing it afterwards strands every passkey. The staff console does not use it: staff keys are bound to the console's own relying party ID.
- `API_CONSOLE_ORIGIN` to the staff console's public origin, for example `https://korbat-staff.example`, preferably on a registrable domain of its own so browsers treat the app and the console as different sites (a subdomain of the app's domain works too), and `API_CONSOLE_RP_ID` left empty, so staff keys are bound to that hostname. Production refuses a plain-http console, an IP address or `localhost`, the app's hostname on any port, a console on a parent domain of the app's hostname, and a relying party ID other than the console's hostname or equal to the app's; no environment accepts the console's origin in `API_TRUSTED_ORIGINS`. Empty, the console is off. From sub-project 3c only the console decides reports and notices; with it off they are taken and wait, and staff are alerted to them.
- `WEB_CONTACT_EMAIL` to the users' contact address, which the report form names when the human check fails or the limits are reached and which the terms page shows; the web image refuses to build without one, and a production build refuses a placeholder (a domain ending in `.local`, `.localhost`, `.test`, `.invalid` or `.example`, or `example.com`, `example.org` or `example.net`). Its mailbox is set to load no remote content, and to keep deleted mail no longer than its host's shortest setting; a person reads it every working day (Moderation, the runbook's bullet on the users' contact mailbox). Since sub-project 3f the authorities' contact address is published as well, as `API_CONTACT_POINT` for the API and `WEB_CONTACT_POINT` for the web build, with korbat's state as `API_HOME_STATE` and `WEB_HOME_STATE`, the last step of the owner's list below: with the languages it may be addressed in, among them an official language of korbat's home state (DSA Art. 11(3), TCO Art. 15(2)), and notified to the national authorities where the home state requires it.
- `API_MODERATION_DISPATCH_HOUR` to the hour of the UTC day, 0 to 23, at which the day's decisions on reports and notices are released to those who sent them, in one batch, so that nobody can tell from a mail's minute when a decision was made; empty means 7.
- `API_NOTIFIER_ENC_KEY` generated (`node scripts/gen-dev-env.mjs` fills a placeholder), backed up off the server and rotated as the paragraph below says; `API_MODERATION_DEFER_UNPROVEN=off` and `API_MODERATION_RETENTION=on`, their defaults (Moderation says when each is changed).
- `KORBAT_ENV=production` before building the images; it is the API's `NODE_ENV` too, so the guards above are on.
- `TUNNEL=on` and `API_TRUST_PROXY=cloudflare` when cloudflared is the only way in (the app's public hostname points at `http://caddy:8080`, and the console's at `http://caddy:8090`, below); `TUNNEL=off` and `API_TRUST_PROXY=caddy` when Caddy's port is reachable directly. With `on`, Caddy keeps `CF-Connecting-IP` for the API; with `off` it drops it, so nobody can claim an address.
- In Cloudflare, set Browser Cache TTL to "Respect Existing Headers", or browsers keep images for four hours whatever the server says.

Keep `API_AUTH_HMAC_KEY`, `API_IP_HASH_KEY`, `API_TOTP_ENC_KEY` and `API_NOTIFIER_ENC_KEY` secret and backed up. Losing `API_TOTP_ENC_KEY` breaks every enrolled authenticator. To rotate it, put the old key in `API_TOTP_ENC_KEYS_PREVIOUS` and a new `v2:` key in `API_TOTP_ENC_KEY`; each secret is re-encrypted with the new key when it is next used. Without `API_NOTIFIER_ENC_KEY` korbat can neither mail a signed-out notifier nor say who sent a notice. To rotate `API_NOTIFIER_ENC_KEY`, put the old key in `API_NOTIFIER_ENC_KEYS_PREVIOUS` and a new `v2:` key in `API_NOTIFIER_ENC_KEY`. Contacts are never re-encrypted, so the old key stays listed until no contact made under it remains, that is until `select count(*) from auth.notifier_contacts where name_enc like 'v1:%' or email_enc like 'v1:%'` answers 0. A contact can outlive 13 months while its notice is still owed a decision or a mail. Keep the old key off the server for as long as any backup holds such a contact.

Before the first report can concern a threat to someone's life or safety, obtain and record the channels for a notification under DSA Art. 18: the national police's, and Europol's for when the Member State concerned cannot be identified, each asked for beforehand from the national police or the Digital Services Coordinator (Moderation, the runbook's bullet on Art. 18).

A post that a decision withholds or removes leaves Explore at the next read, as it leaves every list; nothing acts on Explore alone. Since formula version 2 (account sanctions) a post that a later decision restores gets back the hours it was hidden, and a suspended account's posts and approvals leave the round while the suspension runs. Explore's cold start lasts about two days: only accounts at least 48 hours old count, so on a new instance Explore stays empty until the first accounts are that old.

The staff console's final hostname is chosen before the first enrolment. Staff keys are bound to it, since `API_CONSOLE_RP_ID` equals it, so moving the console later strands every staff key and means a new enrolment for every person; this includes a move to a domain of its own or behind a gate at another hostname. The tunnel gets a second public hostname, the console's, pointing at `http://caddy:8090`, with its HTTP Host Header setting left empty, so the API sees the console's hostname. Cloudflare Access in front keeps the hostname and the keys. A WireGuard or Tailscale gate keeps them only if it serves the same hostname over https with a certificate of its own, because Caddy runs with `auto_https off` while TLS ends at Cloudflare. Rocket Loader, Zaraz and Web Analytics stay off for the console's hostname, through a configuration rule for that hostname: the console's policy would block every script they add. Each staff member enrols two keys.

**The owner's list (sub-project 3d).** Section 17 of `docs/superpowers/specs/2026-10-09-transparency-automation-3d-design.md` is the one list of what the 3d design assumes the owner has done; its parts A and B stand here. With every line of its part C undone korbat runs as it ships: nothing is scored, hashed, matched, purged or witnessed, and the public pages say so.

Part A, before going public (none needs an adapter):

- **A1. The quarantine's disk.** The volume `media-quarantine` on the server's encrypted disk and in no backup. Its owner and mode (uid 1000, mode 0700) come from the API's image; read them once from inside the service (Quarantine, step 4). Accept the price in writing: a lost disk loses the sealed files, and an image lost that way is told to its author as lost.
- **A2. How backups are made.** Name the backup of `media-store` and its lifetime, which must equal the 30 days of Backups, since a release prints the day after which no backup that is deleted on time holds a released file. Decide who destroys backups at once when an authority instructs it, and how a backup that is kept for an authority is marked and later destroyed by hand.
- **A3. One drill**, with harmless files: a seal for good on a test post, the move, the report and an assessment `illegal` recorded, the release refused for want of a leave, a leave recorded with `release-leave` under a test reference, the release, the destruction, `release-show`; then a restore from a backup taken before the release, `restore-import`, `release-replay`, the inventory, the files destroyed again, the site opened only then.
- **A4. Counsel, first question:** the period and the legal basis for keeping sealed images, who may destroy them and on whose word, and whether backups must be destroyed at a release. Whatever the answer, nothing is released on an assessment: only on a recorded leave or instruction to destroy, from an authority or a court, with its reference. Until counsel answers, the release by time stays unset, nothing is released by time, and the terms promise no destruction and no period.
- **A5. The national intake, when korbat registers with it.** Ask the authority korbat will report to, and note the answers in the R2 records: does it answer a report with an assessment; does it say when it has the evidence it needs; does it instruct hosts to delete, in what form and under what reference; does it ask hosts not to tell the person, and for how long. Name who records a leave: the command writes down what that person holds in writing and cannot check it, so a wrong leave and an admin's key together destroy. A recorded leave is never rewritten or deleted, so the target and the reference are checked before it is recorded; a leave recorded by mistake all the same is withdrawn (`release-leave --withdraw`) before any release rests on it; and when the authority asks that the person is not told, that is recorded with the leave (`--untold`) or on the report's record before any release.
- **A6. A second person at a destruction.** Decide whether a second person witnesses each release and each destruction. Every staff account is mailed at a release and at a hold ended without a report, and Home lists both for 30 days; with one person these are one, and the keeper is then the only other reader.
- **A7. The pages.** Read `/rules` and `/transparency` as they will be public: yearly banded counts and no rows, the recipients' method, the head's place, and the main design's amended promises. Each is yours to overturn before the first edition; after it, an edition is never changed.
- **A8. The keeper** receives the head's daily mail at an address the operator does not control (`API_HEAD_KEEPER_MAIL`), and keeps it.

Part B, before any tool is switched on:

- **B1. The impact assessment** (GDPR Art. 35), for each tool by itself and again before its measure is switched on, with the balancing test for the legitimate interest and the terms' section Automated tools read against it. Four dates, four settings: `API_AUTOMATION_DPIA_R1` and `API_AUTOMATION_DPIA_MATCH` for the two tools, `API_AUTOMATION_DPIA_R1_ACTS` and `API_AUTOMATION_DPIA_MATCH_ACTS` for the withhold and for the automatic seal. The API refuses to start with a tool or a measure on and its own date unset, and `/rules` prints each date in its own tool's block.
- **B2. The automatic seal needs more than a date.** It is read as a decision based solely on automated processing with a significant effect on the person, so GDPR Art. 22(1) applies and an exception of Art. 22(2) is needed. `API_AUTOMATION_R2_ACTS` is on only with the owner's impact assessment that covers the seal and with counsel's word. Its other value is the fallback: a match only raises an urgent item for an admin, and needs neither.
- **B3. The Member State and the operator's facts**: the legal form, staff and turnover. Every "does not bind" of the 3d design rests on a micro or small enterprise (DSA Art. 19(1)).
- **B4.** `APP_SITE` open means no `test` adapter: the API refuses the combination.
- **B5. Who answers within the published 24 hours.** From the day a measure is switched on, 24 hours is a public commitment, and only an admin answers a seal. Name who answers a request for a person when the one admin is away. If nobody can, the measures stay off. A program also stops by itself under a rule while 20 of its measures under that rule wait for a person or a request is 72 hours old, which is a floor and not a plan.
- **B6. Who answers an objection to the processing** (GDPR Art. 21), which the terms offer at the address under Contact: name the person and what they do with one.
- **B7. Counsel's advice on a held upload**, written by the owner into the line under A held upload (Automated tools) before `MEDIA_MATCH` is on. The console tells an admin neither to report nor not to; that line is the only place where korbat's rule for it stands.

Who can rewrite the audit log: the PostgreSQL superuser, the owner `korbat_migrate` (its password is in `infra/.env`, and the migrate service uses it at every start), and anyone with Docker access on the host (psql inside the postgres container is the superuser without a password). Any of them can change a row, recompute every later hash and move the head, and a plain `audit-verify` then passes; only a place kept before the change, by someone other than the person who made it, shows the change. That is the kept-head practice of the runbook under Staff console: each day the keeper, the staff member who does not run the server, copies the newest place and hash from the console's audit page and opens the place kept on the previous visit with "Go to place" to check its hash, and after each deploy and each week the operator runs `audit-verify` with every place the keeper has kept. In 3a the keeper's check is the only one independent of the operator, and it still reads through the operator's API, so it detects a change made in the database, not one that also changes the API's code to show the kept hashes. Since sub-project 3d a change is also held against the values published before it: each day's value is in the keeper's mail and, with `API_HEAD_WITNESS` on, in a timestamp authority's proof, neither of which the operator can change after that day (korbat's own page the operator could change too); with one person, they are all that the operator's own changes are held against. Run `audit-verify` before and after every PostgreSQL major upgrade: the chain's text embeds PostgreSQL's print of the stored JSON, and a version that printed it differently would fail every row with metadata, never pass a forged one. The head's daily value is public and goes to the keeper each day; the keeper's daily visit stays.

Counsel's list, to be answered before the gate above opens. From moderation cases: the period for which the draft of an access request's answer is kept; whether a removal of terrorist content on a notice makes korbat a provider that has taken action under TCO Art. 7(2); whether a final decision on content its author already deleted is mailed; whether, and under which national law, an access request may be restricted or deferred for a case korbat reported to an authority under DSA Art. 18 or for images it sealed for good, or that an authority's order concerns (GDPR Art. 23(1)(d)), what the answer and any extension under Art. 12(3) then say, and whether it names those authorities as recipients (Art. 15(1)(c)); whether 30 days suits the content backups hold; and every question that section 2 of `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` flags for counsel on the path for child sexual abuse material (its rows Suspected child sexual abuse material, Evidence, What the author sees of removed content, and Case targets and measures). From account sanctions: every question that section 2 of `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md` flags for counsel, among them the reply window and what counts as sent, the protective suspension on images nobody assessed, termination, the restriction of reporting and its counts, how long the ledger's rows are kept, the handle retired under R4, and that korbat holds no account against its deletion. From authorities' orders: item 13 of the owner's list above, and every question that section 2 of `docs/superpowers/specs/2026-10-09-authorities-orders-3f-design.md` flags for counsel, among them what the author is told and when, the address kept while a report is owed, and the yearly report. From transparency and automation: A4 of the 3d owner's list above, and the questions of part E of section 17 of `docs/superpowers/specs/2026-10-09-transparency-automation-3d-design.md`, in its order. From importing posts: every question that section 2 of `docs/superpowers/specs/2026-10-22-import-3b-design.md` flags for counsel, in decision 28's list: holding an archive that carries other people's messages for up to 24 hours, and its transit through korbat's network provider (decision 4); the person's statement as the only proof that the posts are their own and were public, above all for Bluesky, whose repositories anyone can download (decisions 14 and 16); images imported only behind a real matcher (decision 15); not publishing an imported image whose match does not act, and holding the refused image and the address (decision 18); third parties' personal data in imported posts, their handles, replies and photos, for the impact assessment; the import's record kept 30 days after its end (decision 25); what the import screen says first and again beside the statement (decision 28); and the licence the terms take in imported posts and images, the same as for native ones, which the person must be able to grant (section 11.3 of that design). From engagement: the review of its drafts and its six questions, in the paragraph below.

**Counsel's review of engagement (sub-project 2d).** The terms' four drafts of section 11.3 of `docs/superpowers/specs/2026-10-22-engagement-2d-design.md` are the last four paragraphs of Your data in `apps/app/src/lib/terms.ts` (`ENGAGEMENT_DATA`): what Activity keeps and for how long, printed from `ACTIVITY_KEEP_DAYS`, and that nothing is mailed or pushed about it; what a mention stores and whom it tells; that a profile picture is public, checked like every image, reset by a moderator under the rules and deleted with the account; and what a shared link shows on another site, that the site keeps its copy, that robots.txt turns away every crawler but the named link-preview fetchers, and that korbat asks search engines not to index posts and profiles. They joined the draft without a new `TERMS_VERSION`, as sub-project 3d's drafts did. Counsel reviews them before the gate above opens and answers these six questions, which the design answers without a lawyer, word for word as its section 11.3 asks them (the section numbers are the design's):

1. Export scope (decision 28): must the rows korbat holds but does not show be given, as 11.2 gives them, and is the actor's handle in `received` (a third party's data, GDPR Art. 15(4) and 20(4)) fine, as the export's likes and follows already are?
2. Link previews (decision 21): would "on" by default be compatible with Art. 25(2) GDPR's privacy by default, given that cards put a person's name, text and picture into other platforms' stores that korbat cannot erase? korbat admits people from 16 and cannot tell who is under 18: do Art. 28 DSA and, for UK users, the Children's Code require the default to stay off for everyone, or would a stored "adult from" date (never the date of birth) let it differ?
3. Crawlers (decision 20): may the terms forbid automated collection and the use of korbat's content for model training, and does robots.txt's wording matter for the text and data mining reservation of Art. 4(3) of Directive 2019/790 (a machine-readable reservation)?
4. Avatars and hashing: are the matcher's perceptual hash of a face picture and the SHA-256 kept after a reset outside processing "for the purpose of uniquely identifying a natural person" (Art. 9 GDPR)? The terms will describe the checks, so counsel says so in writing.
5. `reset_avatar` as a restriction under Art. 17 DSA: its statement of reasons (7.7's sentences) and its place in the transparency report's measures table (11.4).
6. Retention (decision 11): 90 days for entries, the seen marker and the settings for the account's life, and a reset picture's hash for 30 days of use.

## Dependency audit

`pnpm audit --audit-level high` runs in CI. Two lower advisories are accepted, both in build-time tools that never see untrusted input here: `esbuild` 0.18 under drizzle-kit's config loader (its development server, which nothing starts) and `uuid` 7 under Expo's Xcode config plugin. Renovate moves them with their parents.

## Third-party notices

The app ships these files and libraries of others, each at the exact version `apps/app/package.json` pins, under the licence its own licence file states; that file is in the package under `node_modules` once installed.

- **Fraunces, Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono**, from `@fontsource-variable/fraunces`, `@fontsource-variable/atkinson-hyperlegible-next` and `@fontsource-variable/atkinson-hyperlegible-mono` 5.3.0: the SIL Open Font License, Version 1.1. Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces); Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (github.com/googlefonts/atkinson-hyperlegible-next); Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors (github.com/googlefonts/atkinson-hyperlegible-next-mono). Each package's licence is copied, whole, into `apps/app/assets/fonts/LICENSES/` (`fraunces-OFL.txt`, `atkinson-hyperlegible-next-OFL.txt`, `atkinson-hyperlegible-mono-OFL.txt`). korbat serves the packages' files as they are and neither subsets nor renames one, so no Reserved Font Name is touched.
- **Lucide**, from `lucide-react` (the web) and `lucide-react-native` (iOS and Android) 1.55.0: the ISC License, Copyright (c) 2026 Lucide Icons and Contributors. The icons Lucide derived from the Feather project, among them several korbat draws (x, info, link, clock, compass, lock, log-in, external-link and trash-2), are under the MIT License, Copyright (c) 2013-present Cole Bemis. Both notices stand in each package's `LICENSE`.
- **class-variance-authority** 0.7.1: the Apache License, Version 2.0, Copyright 2022 Joe Bell (its `LICENSE`; the package carries no NOTICE file), used unmodified. Its one dependency, **clsx** 2.1.1, is under the MIT License, Copyright (c) Luke Edwards (its `license`).
- **sonner** 2.0.8, the toasts on the web: the MIT License, Copyright (c) 2023 Emil Kowalski (its `LICENSE.md`).
- **sonner-native** 0.27.0, the toasts on iOS and Android: the MIT License, Copyright (c) 2025 Gunnar Torfi Steinarsson (its `LICENSE`).
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
| 2d | **Engagement** (added 2026-09-30) | In-app notifications (replies, mentions, quotes, follows), mentions stored as data, avatars through the 2b pipeline, share cards for public posts and profiles (per-page titles and Open Graph/Twitter meta served by korbat itself), and help on a new account's first visit. A proposed scope that its brainstorm confirms; see section 9, 2026-09-30. Delivered by sub-project 2d (`docs/superpowers/specs/2026-10-22-engagement-2d-design.md`): see section 9, 2026-10-29. | 2, 3 |
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

### 2026-10-29, sub-project 2d (`2026-10-22-engagement-2d-design.md`)

- **Delivered (section 6, row 2d).** Engagement, in seven tasks. Activity, one screen second in the nav, tells a person about replies to their posts, mentions of them, quotes of their posts and new followers, each a row written in the act's own transaction under the recipient's rules (Everyone, Accounts older than 2 days, Accounts you follow or Off for each kind of conversation, On or Off for follows), never across a block or from a muted account, and read through the visibility rules every read of a post uses, with follows grouped by UTC day; the decisions korbat told the person about their own content, the releases, refused uploads and lost images appear in the same list, read only from the reads the person's Cases screen already makes. The seen marker lives on the server, a pill counts what arrives while the screen is open, nothing outside the screen counts or badges anything, no mail or push is sent, and an entry lives 90 days. Mentions are stored with the account a handle named when the post was written, the first 20 of a post, of which the first 10 notify; one links only while its account keeps the handle and no block stands between it and the reader, and an imported post's handles are never read. A profile picture is an upload of kind `avatar` that the image worker cuts square at one of three positions into 400 and 128 px squares, checked like every image, held for review while the owner's R1 switch acts, reset by a moderator with `reset_avatar`, sealed with an account's case, and deleted with the account. A shared link to a public post or profile unfurls into a card the API builds and Caddy stitches into the web shell, naming only korbat until the author turns link previews on; robots.txt admits only five link-preview fetchers, and every page that can name an account, every API answer and every card say `noindex`. An author may hide a post's like and repost counts, and a new account's empty Following feed shows a Getting started panel. Migrations 0049 to 0053. The README's Activity, Share cards and search engines and The interface's Profile pictures hold the rules, and its Before going public counsel's six questions.
- **Line 97** (`avatar_path` among the columns of `profiles`): dropped by `0051_avatars`, since nothing ever wrote it; a profile's picture is the `post_media` row of kind `avatar` whose `profile_id` names the profile, so the owner, files, hashes, R1 score, matcher, holds, purge outbox, quarantine and erasure of 2b and 3d apply to it (decisions 14 and 18).
- **Line 103** (blocks and mutes): a block also deletes the two accounts' Activity entries both ways in the transaction that makes it, and no entry, mention link or card crosses one; a mention is stored whatever blocks exist and links per reader, so no third reader learns of a block (decisions 10 and 12). A mute is no longer timelines-only: it silences Activity too, writing no entry from the muted account and hiding its earlier ones until an unmute, still one-way and silent (decision 8).
- **Line 113** (feed queries): Activity is no feed and no ranking: one list per account, newest first, read through the visibility rules every read of a post uses (`postAccess`), with follows grouped by UTC day and conversations never grouped (decisions 4 and 6). The chronological feeds and Explore are unchanged.
- **Line 225** (row 5, "push notifications"): sub-project 5's native push keeps decision 4, under which nothing outside the Activity screen says that something is new and the app icon carries no count, or reverses it explicitly with the owner; 2d builds no web push and no mail (decision 9).
- **The 2026-09-30 amendment, point by point.**
  - *Notifications.* In-app only, on the Activity screen, for replies, mentions, quotes and follows; likes and reposts do not notify (decision 3), and only follows are grouped, by UTC day (decision 6). Web push was weighed and is not built, nor is mail (decision 9); native push stays in sub-project 5.
  - *Mentions as data.* A handle links to the account it named when the post was written, and only while that account keeps the handle: after a rename or a retirement it is plain text (decision 12). Blocks hold both ways at every read and write: a mention across a block is stored, writes no entry and links for neither side. The composer suggests no account from a typed prefix, since that is a handle search (decision 13).
  - *Avatars.* Through 2b's pipeline as a `post_media` row of kind `avatar`, cropped square by the worker at one of three positions (decision 14); under sub-project 3's checks, where a flag opens a finding and never a measure, and an R1 rating holds the picture for review only while the owner's R1 switch acts (decision 15); reset by a moderator with `reset_avatar`, the very picture refused for 30 days (decision 16); removable but not settable while suspended (decision 17); `profiles.avatar_path` dropped (decision 18). Section 5's text-first layouts keep their places: the picture is drawn where the UI sub-project drew the monogram, which stays for an account without one.
  - *Share cards.* The first of the two routes: a Hono route behind Caddy, which answers the card's head block in a header that Caddy's `templates` stitches into a copy of the shell, not expo-router's server output on Expo SDK 58, which is not adopted (decision 19). Pseudonymous profiles and posts are not indexed: robots.txt turns away every agent but five link-preview fetchers, and pages, API answers and cards say `noindex` (decision 20, counsel). They are not unfurled by default: link previews are off for every account until it turns them on, and a card names only korbat until then (decision 21, counsel). A card never shows more than a signed-out reader sees, so a withheld, removed or deleted post has none (decision 22). Per-page titles: the served `<title>` stays "korbat" and the app's own title, which never names an account, replaces it once the bundle runs, so names are in the Open Graph tags alone (decision 23).
  - *Help on a first visit.* A Getting started panel in place of a new account's empty Following, pointing to Latest, Explore and how it picks, the handle box, the profile's settings and the rules; it suggests no account by name (decision 25).
  - *Why after 3 and 3b.* Held: pictures and card images pass sub-project 3's checks, cards follow its states, an imported post's handles stay plain text and never notify, and its card carries its provenance label.
  - *Unchanged.* Keyword search and hashtags stay out, exact handle lookup remains, the feeds stay chronological and Explore's formula is untouched; robots.txt and `noindex` keep a search engine's index from rebuilding keyword search through a third party (decision 20).
- **The owner's decisions (2d design, section 2).** Thirty decisions are built as written and flagged for the owner, each with what its alternative costs, and four of them for counsel too, whose review of the terms' drafts and six questions the README's Before going public holds: the name Activity (1); the kinds of entry, moderation entries among them (2); no entry for a like or a repost (3); a person learns of new entries only by opening Activity (4); the seen marker on the server (5); follows grouped by UTC day (6); who may reach a person, with the age choice (7); a mute silences Activity (8); no web push and no mail (9); entries after the fact (10); entries kept 90 days (11, counsel); which mentions count and what they link to (12); no mention suggestions (13); the avatar's storage and crop (14); what the checks do to an avatar (15); its moderation by `reset_avatar` (16); what a suspended account may still change (17); `profiles.avatar_path` dropped (18); cards built by the API and stitched in by Caddy (19); no indexing and no collection (20, counsel); link previews off by default, per account (21, counsel); what a card shows (22); the served page title (23); Activity second in the nav and four items on a phone (24); the Getting started panel (25); hide counts per post (26); the JavaScript budget (27); the export's `activity` and the rest (28, counsel); a deleted account's picture removed at once (29); and cards under the API's global limit (30).
- **The dry run's flags for the owner.** The five migrations took the numbers 0049 to 0053, after 3b's 0048, and an upgrade from 0048 runs them in one transaction, `0051_avatars` reading every row of `post_media`. The app's JavaScript cap was not raised: the export measured 824,905 bytes gzip after 2d, 12,598 over 3b's 812,307 and within decision 27's 20,480, under the cap of 832,257. The terms' drafts are in apps/app/src/lib/terms.ts, the terms' source, rather than in packages/rules, which holds the rulebook. crawlers.json's Slack range and LinkedIn User-Agent are the card lab's own, not from official pages, and LinkedIn and Meta are not yet shown to unfurl a WebP card. The README's runbook bullet on reports of child sexual abuse material still says that on an account's case the reports on other grounds concern the display name and the bio, which the admin reads; since 2d they may concern the picture too, which a freeze shows staff only as a placeholder, and how such a report is answered is not yet written there. The 2d design's section 15 holds the amendments of its dry run.
- **Left for later (2d design, section 14).** Sub-project 4: owner-scoped row-level security for `activity_items`, `activity_state` and `post_mentions`; counsel's review of the terms' drafts and its six questions before korbat opens; per-address limits for the card routes if the global limit proves too tight for crawlers (decision 30); a check with Meta's Sharing Debugger and LinkedIn that WebP cards unfurl (decision 22). Sub-project 5: the Activity screen, the picker with the platform's own photo picker, and native push under decision 4, the app icon carrying no count unless the owner reverses it. Possible later changes, each the owner's: reposts as entries (3), an opt-in word on the nav item (4), an age choice for follows (7), an exact-handle check in the composer (13), a free crop (14), a JPEG card (22), a per-post switch for previews, mentions in bios and quoted embeds, named suggestions by a published rule (25), a header image, the picture's own description; Expo SDK 58's server output stays out. And three points of the seal of an account's pictures that no task built: the case page's line of where a seal's files are (`seal_custody`) counts its posts' images and not its pictures; a seal that lists pictures alone is released from no console screen; and `staff.js notification-facts` names a seal's posts only, never its pictures, since 3f's list has no kind for an image's id.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, 3d, UI, 3b, 2d, the screen-reader fix, the audit batch. Next, in order: 4 hardening, 5 native builds.
````

### Replace `docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md` (whole file)

```markdown
# korbat interface and experience (UI sub-project): design

Status: approved for the dry run on 2026-10-21 under the owner's standing instruction to finish the app (2026-10-20); decisions marked (owner) in section 2 were made by the orchestrator and can be changed by the owner. Inputs: the main design's section 5 (2026-09-03-korbat-design.md), a study of Bluesky's open-source app, an audit of the app and the console at 1222b87, and a check of every library against the 7-day release-age floor. One review round (build fit; people and values) shaped this text.

Written 2026-10-21 against the repository at main 1222b87 (clean tree). Inputs: korbat-scratch/research-ui/audit.md (the audit, cited "audit N"), korbat-scratch/research-ui/libraries.md (cited "libraries N"), korbat-scratch/research-ui/bluesky-study.md (cited "study N"), the main design docs/superpowers/specs/2026-09-03-korbat-design.md (cited "main design"), and the guidance of the frontend-design, emil-design-eng and apple-design skills. Paths are relative to the repository root unless they start with korbat-scratch. The design's six parts are joined in order into one file, docs/superpowers/specs/2026-10-21-interface-and-experience-ui-design.md, committed before Task 1 (section 13).

## 1. Context and scope

### 1.1 What the owner asked

On 2026-10-12 the owner approved this sub-project with these words: "I need such an impressive yet intuitive enough UI/UX that would release endorphin from humans brains when they use it. Something that would rival Instagram. Let's stand on the shoulders of giants here". The same day they added: "study bluesky-social, learn from it, point out its strong points and let's differ from Instagram in a good way". On 2026-10-20 they said: "finish the app".

The main design's section 5 is this sub-project's brief, and its roadmap row "UI" (main design, section 6) names what it delivers. The row sits after sub-project 3, which is complete, and before 3b import.

### 1.2 The idea in one paragraph

korbat is read the way a good newspaper is read: calmly, in order, to the end. Instagram keeps people by never letting a feed end, by ranking, and by counting. korbat delights by the opposite means. It keeps the reader's place to the post, says plainly when they are caught up, answers every touch at once with physical motion, and shows on the post itself what moderation did and who can see it. The look comes from korbat's own world. korbat reads as "the ravens" in Albanian, and a raven's black is not flat: it carries a violet sheen. So the themes are ink and paper with one violet accent, the display face is a soft, slightly wonky serif (Fraunces), and the text face is a sans drawn for low-vision legibility, which also keeps look-alike handles apart (Atkinson Hyperlegible). Boldness is spent in one place, the typography; everything else is quiet.

### 1.3 In scope

- Every route of apps/app (33 route files, audit 1.1), redrawn on one design system: tokens, fonts, icons, motion, owned components.
- Three themes (light, dim, dark) that follow the system by default, with a switch, a text-size step, a font choice and the motion and haptics switches.
- The feed that keeps the reader's place: a "N new posts above" pill, a "You were here" marker persisted per feed on the device, "You're all caught up" when it is true, typed feed rows, optional automatic loading, virtualised lists on web and native.
- The post as an article with one explicit open target, icon actions with optimistic updates and rollback, a menu with "Who sees this", "Copy link", "Delete" and "Report".
- The moderation surfaces on the author's own post: a status chip that opens a details sheet (rule, measure, scope, who in role terms, statement, appeal and its deadline), and, for readers, the one-line reason on a hidden image with a link to how korbat moderates. A lift-able cover over a restricted post is not built, because readers never receive one (decision 10).
- The composer as a sheet on phones and an inline card on wider screens, with required alt text, a progress ring, the draft kept on the device, a discard question only when there is content, and a "Your post was sent" toast with "View".
- A new settings page, Appearance and accessibility, and a Settings index, which the nav's Settings item opens, with Appearance first.
- Toasts, haptics by intent with an off switch, skeleton rows, empty and error states with one action each, an offline state, a branded error boundary, per-screen document titles.
- An automated browser check of the app in Chromium at 360, 768 and 1280 px, in three themes, with reduced motion on and off.
- The staff console restyled within its content security policy, in apps/admin/src/app.css, keeping every class name its tests find.
- The documentation: the README, the main design's section 5 marked delivered with a dated amendment, and a walk-through at three widths.

### 1.4 Out of scope, and where it goes

- Native-only polish waits for sub-project 5 (native builds): react-native-keyboard-controller (a native module Expo Go lacks), react-native-screens form sheets for the composer and menus, pinch-to-zoom and drag-to-dismiss tuned per platform in the lightbox, the expo-font config plugin with static TTF files, preferences that persist on native devices, haptics checked on real devices, state kept across an Android configuration change, app icons and the splash screen. Everything this sub-project builds runs on native through the same components, and section 14 lists what 5 finishes.
- Engagement surfaces wait for 2d: notifications, uploaded avatars, mentions as data, share cards with per-page Open Graph meta served by korbat, help on a new account's first visit, and the author's per-post "hide counts". The generated monogram of section 6.5 holds the place an uploaded avatar will take (decision 22).
- Search and hashtags stay out, as the 2a, 2c and 2026-09-30 decisions keep them out; exact handle lookup remains.
- Video, animated images and their autoplay setting stay out: 2b refuses animated images (2026-09-18-images-2b-design.md, line 29), so there is nothing to autoplay.
- A web manifest and a service worker (study 3.12) go to sub-project 4, with the offline page they would serve.
- Keyboard shortcuts on web (single-key shortcuts need an off switch under WCAG 2.1.4) go to sub-project 5's web polish list.

### 1.5 Internationalisation: out, with the strings kept ready

Decided: this sub-project ships English only and does not add Lingui. libraries.md (A.11) recommends adopting @lingui/core 6.9.1 now, English only, because the UI is rewritten anyway. That argument is weaker for korbat than for Bluesky. korbat already keeps its sentences in words modules (lib/moderation-words.ts, lib/standing.ts, lib/orders.ts, lib/explore.ts, lib/public-pages.ts, lib/terms.ts; audit 1.2), and about 830 test assertions compare rendered text with those constants (audit 4.1). Turning each constant into a Lingui descriptor would change every one of those assertions in a sub-project whose rule is that pinned sentences stay word for word. The macros also need a compiler plugin in two toolchains: babel-preset-expo for the app and esbuild for vitest, which runs no Babel (apps/app/vitest.config.mts). libraries.md says the Expo set-up was not tried (section 5), and the vitest side is not covered by any package it marks ADOPT.

What this sub-project does instead keeps a later switch mechanical:

- Every new visible sentence lives in a words module. The new module for this sub-project's words is apps/app/src/lib/ui-words.ts; screen-specific words join the module of their area.
- A source scan in apps/app/test/a11y.test.tsx refuses a JSX text child that is a bare string literal in src/app and src/components (the idea of Bluesky's avoid-unwrapped-text rule, study 2.11). Single punctuation characters are allowed. It starts with a list, `LEGACY_TEXT_FILES`, of the 34 files that hold bare sentences today (for example (auth)/age.tsx, ComposeSheet.tsx and PostCard.tsx's "Delete this post?"); each task that rewrites one of them moves its sentences into a words module, changes in the same commit any pin that reads the sentence from the screen's source (such as explore.test.tsx:239 on index.tsx), and takes the file off the list, as section 4.2 does for colours. Task 10 checks that no file the sub-project rewrote is still listed and records the rest.
- Layouts never truncate a label to fit: buttons, chips and tab labels wrap or grow, never clip, and the app's browser check fails on any label whose scrollWidth exceeds its clientWidth at 360 px (section 12.3), which is where a longer language would break first.
- Dates and times keep going through Intl in one place (lib/social.ts timeAgo and lib/time.ts, section 8.1).

A later i18n sub-project converts each words module into a catalogue. It is flagged for the owner in section 2 (decision 1), because the home state that korbat is offered in (3f, row 41) may not be English-speaking.

### 1.6 No new API route and no migration

Every screen of this design is built from data the client already receives (audit 5). The places where a richer contract would help are listed with the choice made:

- The details sheet of a status chip reads GET /api/moderation/decisions/:id when it opens. PostModeration does not grow (decision 11).
- "Who sees this" is built from the post, the session's /me and, for the author's own top-level post only, GET /api/posts/:id/explore when the sheet opens (audit 5.4).
- The "N new posts above" pill polls the existing timeline routes with `limit=50` (Pagination allows 1 to 50; packages/contracts/src/index.ts:24-27).
- The reading place is kept on the device, not on the server (decision 8).
- The context column carries no live transparency figures, as the 3d amendment of the main design decided ("no panel shows live transparency figures").

### 1.7 Rules this design keeps

- korbat's values: a chronological feed; no silent reach reduction; moderation visible on the post; pseudonymity (no contact upload, no phone number asked for in any flow of this design); no engagement dark patterns (no streaks, no infinite nudges, no re-engagement prompts, no badge counts on navigation, suggestions only where the reader goes looking).
- WCAG 2.2 AA everywhere, reduced motion respected everywhere, full keyboard use on web.
- The stack stays: Expo SDK 57.0.22, expo-router 57.0.21, NativeWind 4.2.7 on Tailwind 3.4.19, Reanimated 4.5.1 with worklets 0.10.1, gesture-handler 2.32.0, expo-image 57.0.5, react-native-web 0.21.2. The console stays React 19.2.3 with esbuild 0.28.2 and plain CSS under its policy.
- Supply chain: only libraries that libraries.md marks ADOPT, at its pins, with exact versions in package.json; no AGPL; fonts and icons bundled; no third-party analytics, crash reporting or session replay.
- Every visible sentence that a test pins today stays word for word, unless section 8 names the test that changes and why. Every accessible name and role that tests use stays.

### 1.8 Libraries this design adds

Every pin below is the one libraries.md gives (section 1.1), each published on or before 2026-10-13 and so past the 7-day floor of pnpm-workspace.yaml. Each is written as an exact version in apps/app/package.json. A read of the npm registry on 2026-10-21 found no pin a downgrade under the workspace's `trustPolicy: no-downgrade`: lucide-react, lucide-react-native and playwright-core come from a trusted publisher as their earlier versions do, the three @fontsource-variable packages carry provenance as theirs do, react-native-svg, sonner, sonner-native, class-variance-authority and clsx have no attestation on any version, and expo-haptics 57.0.3 has the pattern of expo 57.0.22 and the other expo-* modules the lockfile already holds. A task whose install is refused by the trust policy stops and reports; it never adds a trustPolicyExclude entry on its own.

| Package | Pin | Where it runs | What it does here |
|---|---|---|---|
| lucide-react | 1.55.0 | web (Icon.web.tsx) | The icon set as plain DOM svg |
| lucide-react-native | 1.55.0 | iOS, Android (Icon.tsx) | The same icons, same names, same version |
| react-native-svg | 15.15.4 | iOS, Android | Needed by lucide-react-native and sonner-native; Expo's tested version for SDK 57 |
| sonner | 2.0.8 | web (toast.web.tsx) | Toasts with a polite live region |
| sonner-native | 0.27.0 | iOS, Android (toast.tsx) | The same toast API on native |
| expo-haptics | 57.0.3 | iOS, Android | Haptics behind useHaptics(); nothing on web |
| class-variance-authority | 0.7.1 | everywhere | Variants of NativeWind classes (Button, IconButton, StatusChip, ListRow) |
| clsx | 2.1.1 | everywhere | cva's one dependency; the cn() helper |
| @fontsource-variable/fraunces | 5.3.0 | web | The display face's woff2 files |
| @fontsource-variable/atkinson-hyperlegible-next | 5.3.0 | web | The text face's woff2 files |
| @fontsource-variable/atkinson-hyperlegible-mono | 5.3.0 | web | The handle and code face's woff2 files |
| playwright-core (devDependency) | 1.63.0 | the app's browser check | Already locked for apps/admin; never `playwright install` |

Not added, with the reason from libraries.md: react-native-keyboard-controller (native module, sub-project 5), expo-font as a direct dependency (needed only for its config plugin, sub-project 5; on web the fonts are declared by korbat's own @font-face rules, section 4.3), @legendapp/list and @shopify/flash-list (FlatList stays, section 11.1), tailwind-merge and tailwind-variants (variants are written so they never conflict), expo-blur and expo-glass-effect (flat design), @gorhom/bottom-sheet, lottie-react-native and Rive (Reanimated covers the motion), @lingui/* (section 1.5), radix-ui, @base-ui/react and motion (the console needs none of them: native dialog, details and select elements and CSS transitions do its work).

The font packages carry the SIL Open Font License 1.1; Task 1 copies each package's licence file (the OFL text) into apps/app/assets/fonts/LICENSES/, and a new README section, "Third-party notices" (Task 10), names them. No font file is subset or renamed, so no Reserved Font Name question arises (libraries 2).

## 2. Decisions flagged for the owner

Each decision is made and built as written. The owner can change any of them; the alternative says what changing it costs. All are marked (owner).

1. **Internationalisation (owner).** Chosen: English only in this sub-project; no Lingui; every new sentence in a words module and a source scan against bare strings (section 1.5). Alternative: adopt @lingui/core, @lingui/react, @lingui/babel-plugin-lingui-macro and @lingui/cli 6.9.1 now, as libraries.md (A.11) recommends, with an English catalogue. It costs a Babel plugin in apps/app/babel.config.js that nobody has tried under Expo SDK 57, a macro transform in vitest (which runs esbuild, not Babel), and a rewrite of about 830 test assertions that compare rendered text with words constants. It becomes the cheaper path only if a second language is needed before sub-project 4.
2. **The console's font (owner).** Chosen: the console keeps its system font stack and its policy keeps no font-src, so default-src 'none' still blocks every font file. Handles and ids in the console use the system monospace stack (ui-monospace, "Cascadia Mono", Consolas), which already tells l from 1 and O from 0. Alternative: add `font-src 'self'` to CONSOLE_CSP in apps/admin/site-headers.mjs and to infra/caddy/Caddyfile line 204, change the literal pinned in apps/admin/test/dev-server.test.ts (line 56) and the browser check's rule that /assets/ holds only .css and .js (apps/admin/test/browser/console.browser.ts, first step), measure the zero-report policy again as console-lab.md did, and bundle the two Atkinson Hyperlegible woff2 files through esbuild's file loader. That gives staff the app's anti-impersonation face; it loosens a policy that has been measured clean, for a look.
3. **The accent (owner).** Chosen: one violet accent, the raven's sheen, for every action and only for actions: #5A33D6 in light, #B9A6FF in dim, #B4A0FF in dark (section 4.2). Alternative: no hue at all, keeping today's white-on-dark primary button and sky links; or a teal accent. Neither violet nor teal is told apart from verified blue by every reader (under protanopia the Dark accent and verified blue are almost one colour), so the verified chip keeps its icon and word in every case.
4. **The faces, and handles in a mono face (owner).** Chosen: Fraunces for display (screen titles, profile names, empty-state titles), Atkinson Hyperlegible Next for text, and Atkinson Hyperlegible Mono for handles, so `@korbat_1` and `@korbat_l` differ at a glance (libraries 2). This amends the main design's section 5, which put handles in the display face. Alternative: handles in Fraunces as section 5 wrote; or Instrument Serif as the display face (libraries 2) if Fraunces reads too warm.
5. **Themes and the default (owner).** Chosen: Light, Dim and Dark; the default is "System", which picks Light, or the reader's dark style (Dark unless they pick Dim) when the system is dark. Alternative: Dark by default whatever the system says, the strictest reading of "dark-first".
6. **Paging (owner).** Chosen: "Load more" stays the default at the end of each page, as korbat has it today; a setting, "Load older posts automatically", turns on loading as the reader nears the end; below the "You were here" marker older posts load only by the button, whatever the setting. Alternative: automatic loading by default, as Instagram and Bluesky do.
7. **New posts (owner).** Chosen: Following and Latest ask for new posts 30 seconds after they open and then every 60 seconds, only while the feed is on screen and the page is visible; the only sign is the pill inside the feed. No dot on the Home tab, no count in the page title, nothing while korbat is in the background. Alternative: Bluesky's dot on the Home tab.
8. **Where the reading place lives (owner).** Chosen: on the device only (localStorage on web, keyed by account and feed), cleared at sign-out and whenever the app finds its session gone, and listed with a "Clear what this device keeps" button on the Appearance page (section 8.8); it is not synced between devices and needs no new route. Alternative: a server-side marker per account and feed, which syncs devices and costs a migration and a route.
9. **Where a feed opens (owner).** Chosen: Following and Latest open where the reader left off, when that post is among the newest 100, with "N new posts above"; otherwise at the newest post. A setting, "Open feeds at the newest post", changes it. Alternative: always open at the newest post, as most apps do.
10. **Covers for readers (owner).** Chosen: no reader-side cover for a restricted post, because readers never receive one (apps/api/src/social/visibility.ts:20-38, the 3c access rule). The one place a reader meets moderation, the placeholder of a hidden image, keeps its one-line reason ("Image hidden by korbat moderation"), and the row under the post's images gains a link, "Why are images hidden?", to /rules; there is nothing to lift, since the image never reaches the reader. Alternative: deliver withheld posts to readers behind a cover they can lift (study 4.3); that reverses 3c's access rule and would show the R1 and R4 content that a withhold exists to stop.
11. **What the chip says (owner).** Chosen: the chip keeps today's words (chipText, for example "Removed: R3, strike until 4 Dec"); the appeal deadline, the measure and who decided appear in the details sheet, which reads the decision when it opens. Alternative: grow PostModeration with `appealUntil` and the appeal's state so the chip itself reads "appeal open until 12 Nov" (study 4.3); that is a contract change and a wider chipFacts query, with no migration.
12. **The post's controls (owner).** Chosen: the visible row is Reply, Repost and Like as icons with counts, and Save; Repost opens a menu with Repost and Quote; a More menu holds Who sees this, Copy link, Delete (own posts) and Report (others' posts). Report leaves the visible row. Alternative: keep Report visible in the row, as today.
13. **The colour of a like (owner).** Chosen: every action the reader has turned on (liked, reposted, saved) shows in the accent violet with a filled icon (reposted: a ringed disc, since its icon has no closed shape, section 4.7); there is no red heart. Alternative: a rose heart, Instagram's convention, which also sits near the red of "Removed".
14. **Popular now (owner).** Chosen: Popular now leaves the context column, which keeps the handle box and gains a "How korbat works" card (chronological feed, no silent reach reduction, the rules and the transparency page). Explore stays one tap away as Home's third tab, whose list starts with the same posts. Reason: this design's rule that suggestions appear only where the reader goes looking (study 4.11). Alternative: keep Popular now on every screen at 1024 px and wider, as the 2c design's section 11 built it.
15. **Hiding counts (owner).** Chosen: the reader's setting "Hide like, repost and follower counts" hides like and repost counts on every post and the follower and following numbers on every profile (the links stay, as "Followers" and "Following"), their own included; reply and quote counts stay, because they lead to conversation. Alternative: hide like and repost counts only, or all four post counts.
16. **Document titles (owner).** Chosen: each screen sets its browser tab title on the client now ("Home - korbat", "Profile - korbat", "Post - korbat"), because WCAG 2.4.2 asks for it; a title names the kind of screen and never an account, so a synced browser history holds no handles (the h1 inside the page names the account); the server-rendered titles and Open Graph meta of share cards stay in 2d. Alternative: leave every title to 2d, as the 2026-09-30 amendment of the main design moved "per-page titles" there.
17. **Autoplay (owner).** Chosen: no autoplay setting, because korbat has no moving media (2b refuses animated images). Alternative: show the setting greyed out with that sentence.
18. **Drafts on the device (owner).** Chosen: the composer keeps its text (not its images) in localStorage per context (new post, reply to a post, quote of a post) until it is posted or discarded; sign-out, or the app finding its session gone (revoked, expired or signed out elsewhere), clears every draft (section 8.8). Alternative: keep no draft, since anyone holding the unlocked device could read it.
19. **The desktop composer (owner).** Chosen: at 768 px and wider, Home shows the composer as a one-line card ("What's on your mind?") that opens in place on focus or click and closes back when it is empty and loses focus. Alternative: the composer always open, as today.
20. **The app's browser check (owner).** Chosen: the app gains a Chromium walk like the console's (section 12.3); each run builds the web export, which adds a few minutes to a batch end. Alternative: keep the server-rendered checks only, which cannot see layout, focus, motion or contrast as drawn.
21. **The console's theme (owner).** Chosen: the console follows the operating system's light or dark setting only, with no switch and no dim style, and keeps red as the mark that tells it apart from the app. Alternative: a switch in the masthead, kept in the console's local storage.
22. **Monogram avatars now (owner).** Chosen: every account gets a generated monogram (the first letter of its display name on a neutral disc) beside its posts, in lists and in the profile header, so the feed has its rhythm before 2d brings uploaded avatars into the same place (section 6.5). Alternative: stay text-first until 2d, as the 2026-09-30 amendment of the main design left the layout question to 2d's brainstorm.

## 3. What exists

A short summary of korbat-scratch/research-ui/audit.md; its sections hold the line numbers.

### 3.1 The app (apps/app)

- Routes: 33 files under apps/app/src/app (3 layouts, 30 screens; audit 1.1). The auth flow ((auth)/signin, code, password, mfa, age, handle) and the three token pages (email-revert/[token], not-me/[token], passkey-remove/[token]) sit in a centred column outside the shell. Home (index.tsx) has the tabs Following, Latest and Explore; the rest are bookmarks, explore/about, post/[id], u/[handle] with followers and following, report, notice/[ref], rules, transparency, terms, and settings (security, privacy, profile, account, cases with four detail screens).
- Shell: apps/app/src/components/AppShell.tsx already lays out three columns at 1024 px, two at 768 px and a bottom tab bar below 768 px, with the floating compose button on phones (audit 3.1). Its nav and tab bar are words only; its context column holds PopularNow and HandleBox.
- Design system: apps/app/src/components/ui.tsx (138 lines, 12 exports: Screen, Title, Body, Section, VerifiedChip, Field, Button, TextLink, TextButton, ErrorText, Notice, Loading). There are no tokens (tailwind.config.js has `theme: { extend: {} }`), no fonts, no icons, no light theme (bg-zinc-950 is painted per screen), about 590 raw colour classes, hex literals in five files, and no pressed, hover or focus styles of korbat's own (audit 2.1).
- Motion: Reanimated 4.5.1 is used only for useReducedMotion() in ComposeSheet.tsx, MediaGrid.tsx and MediaViewer.tsx (a 150 ms blurhash fade and the RN Modal slide). There are no haptics and no toasts.
- Lists: components/social/PagedList.tsx (FlatList, "Load more", pull to refresh, one empty or error text with "Try again"). A tab change or a new post remounts Home's list (index.tsx, homeListKey), so the place is kept only while the web stack keeps Home mounted.
- Posts: components/social/PostCard.tsx is a View, not an article; the body is a link to the post; the actions are the words Reply, Repost, Quote, Like, Save, Delete and Report; every action waits for the server, one at a time. StateChip and ExploreChip show on the author's own posts (amber while korbat decides, red once removed, emerald In Explore).
- Media: MediaGrid.tsx (own ratio 3:4 to 2:1 for one image, a 16:9 grid for two to four, an ALT toggle under the grid), MediaViewer.tsx (a Modal with Previous, Next, arrow keys and Escape, no animation), HiddenImage.tsx (the placeholders), ImageFault.tsx.
- Composer: Composer.tsx (counter "n/1000", required descriptions per image in ComposerImages.tsx, the Post button names what is missing), ComposeSheet.tsx (RN Modal, discard question), and the inline composer always open on Home at 768 px and wider.
- Words: kept outside components in apps/app/src/lib/moderation-words.ts, standing.ts, orders.ts, explore.ts, public-pages.ts and terms.ts, so markup can move while sentences stay.
- Storage on the device: localStorage holds only the device id (lib/api.ts:184-187) and the passkey suggestion's dismissal (lib/passkeys.ts:221-231). Native has no storage library.
- Web export: `expo export --platform web` with web.output "single" (app.json); public/index.html paints #09090b before the bundle and declares `color-scheme: dark`. The app's policy (infra/caddy/Caddyfile line 25) allows inline styles, fonts from self and data:, images from self, data: and blob:, scripts from self and challenges.cloudflare.com only.

### 3.2 The tests that guard the app

- apps/app/test: 19 files, 6,522 lines. They render with react-dom/server through react-native-web (vitest.config.mts aliases react-native to react-native-web) and match HTML as strings; there is no DOM, no testing-library and no snapshot (audit 4.1).
- 76 source reads in 9 files pin exact lines, some with class strings: announced.test.tsx:175 (StandingBanner's tone line), cases.test.tsx:598-599 (StateChip's amber line and surface classes), report.test.tsx:237-257 (MediaGrid and PostCard lines, the profile's Report link), explore.test.tsx:707-834 (privacy's Explore switch line, ExploreStatusLine, AppShell's `<PopularNow />` before `<HandleBox />`), lifecycle.test.tsx:73, 89, 188-241 (SettingsNav in every settings screen, the verified chip line, Field's `<TextInput\n ref={ref}`, Button's `<Pressable ref={ref}`), a11y.test.tsx:139 (`<Action ref={keepRef} label="Keep"`), passkeys.test.tsx:329, 380, 458, hidden-media.test.tsx:175-176. Each task below that rewrites a pinned file changes the pin in the same commit and keeps what it protects.
- a11y.test.tsx scans every source file: no accessibilityState, no hand-made link role, no imagebutton, no accessibilityViewIsModal, every Switch labelled.
- There is no browser check of the app (audit 6.1).

### 3.3 The console (apps/admin)

- React 19 without a router library: router.ts, App.tsx, Layout.tsx (masthead, nav "Console", the who line, IdleNotice), nav.tsx, ui.tsx, frames.tsx, media.tsx and 15 screen files (6,987 lines; Case.tsx and Composer.tsx are the largest).
- One stylesheet, apps/admin/src/app.css (627 lines): custom properties on :root for light and dark by prefers-color-scheme, stone neutrals, a red accent, the system font stack, a 4 px red top border on the masthead, one phone media query at 599 px with 44 px targets and tables collapsed to blocks. No motion, icons or web fonts.
- Its policy (apps/admin/site-headers.mjs and infra/caddy/Caddyfile line 204) has default-src 'none' and no font-src, style-src 'self' without 'unsafe-inline', and Trusted Types with no policy. apps/admin/test/source.test.ts forbids style props, any CSS file but app.css, and every HTML sink in src.
- Its tests pin 56 class attributes in the unit tests and about 35 CSS selectors in the browser walk (apps/admin/test/browser/console.browser.ts, 79 steps, 23 of them at 360 by 740 px with `cleanOnPhone()`: no horizontal scroll and every control at least 44 by 44 px). The walk fails on any policy report, console error, dialog, and any img or svg element in #root other than a case's evidence image.

### 3.4 Data the moderation surfaces can use (audit 5)

- On a post (PostView): `state`, `moderation` (decisionId, ruleId, legal, interim, strikeUntil, order) on the viewer's own withheld or removed post only, `inExplore` on the viewer's own listed post, media with `moderation` on the author's own restricted image, or `{ id, hidden: true, sealed? }`.
- On the account (/me): `standing` (strikes, measure, reporting restriction, retired handle) and `profile.showInExplore`.
- On request: GET /api/moderation/decisions/:id (DecisionView: rule, rules version, measures, source, decidedAt, appealUntil, appeal, strike, standing, askPerson), GET /api/posts/:id/explore (the author's Explore status).
- Readers never receive another account's restricted post (apps/api/src/social/visibility.ts:20-38): the UI must not invent a signal for one.

## 4. The design language

### 4.1 Principles

- **Calm, in order, to the end.** Nothing moves unless the reader moved it or asked for it. The feed has a place, a boundary and an end, and says so in words.
- **One bold thing: the type.** Fraunces sets screen titles, profile names and the few sentences that mark a moment ("You're all caught up"). Everything else is Atkinson Hyperlegible on flat surfaces, one violet accent, and lines instead of shadows.
- **Colour means something or nothing.** The accent marks what the reader can do and what they have done. Amber, red, blue and green mark status and nothing else. Neutrals carry everything else. No gradient, glass or blur anywhere (main design section 5).
- **Status is never colour alone.** Every status carries a word and an icon of its own, so it reads in greyscale, to a screen reader and to a colour-blind reader alike (section 4.8).
- **Answer every touch at once.** Feedback starts on press, not on release; actions update at once and roll back with a sentence if the server refuses; every motion can be interrupted and starts from where the element is.
- **Words do one job each.** Sentence case, plain verbs, the same name for an action from button to toast ("Post" makes "Your post was sent"); errors say what happened and what to do; empty screens offer the next step. No all-caps labels (the established "ALT" badge excepted, which tests pin), no middle-dot meta strings.

### 4.2 Colour tokens

The tokens live in code in one file, apps/app/src/theme/tokens.ts, which exports `THEMES: Record<"light" | "dim" | "dark", Record<ColorToken, string>>` with the hex values below, and `TEXT_PAIRS`, the list of foreground and background pairs the app draws text or controls with, each with its minimum ratio. The names are contrast-graded, after Bluesky's ALF (study 2.1): a name says what a colour is for and how much contrast it carries, never its hue.

- Surfaces: `surface` (the page), `surface-1` (raised: cards that float, sheets, menus, inputs, the composer card), `surface-2` (pressed and selected rows, skeletons, the wash under media).
- Lines: `line-low` (dividers between posts and sections; decorative, no contrast duty), `line-high` (the boundary of a control: inputs, secondary buttons, checkboxes; at least 3:1 under WCAG 1.4.11).
- Ink: `ink-high` (primary text, icons of the active nav item), `ink-medium` (secondary text: body of notices, post meta that matters), `ink-low` (tertiary text: times, counts, placeholders, captions, inactive icons; the floor, at least 4.5:1 on every surface).
- Accent: `accent` (filled primary buttons, the new-posts pill, the active tab's underline, the progress ring), `on-accent` (text and icons on `accent`), `accent-ink` (links, toggled-on actions, the active nav label), `accent-wash` (the background of the selected nav item and of a selected setting row), `focus` (the focus ring).
- Danger: `danger` (the fill of a destructive button: Delete, Discard), `on-danger`, `danger-ink` (error sentences).
- Status, each as a triple `-ink` (text and icon on a surface), `-wash` (the chip's background), `-on-wash` (text and icon on the wash): `review` (amber: under review, interim), `restricted` (red: removed, restricted, an authority's order), `verified` (blue: the verified chip), `explore` (green: In Explore).
- Fixed: `scrim` is rgba(0, 0, 0, 0.6) behind sheets and dialogs, and `media-badge` is rgba(0, 0, 0, 0.72) under the white text of the ALT and count badges on images (white on that badge over a white image is 9.29:1, the worst case).

The three themes:

- **Light** ("Day"): a cool feather-white page (#F6F5F9, deliberately not a cream), white raised surfaces, ink near black with a violet cast.
- **Dim** ("Dusk"): a slate-violet page for readers who find black too hard; every surface a step lighter than Dark.
- **Dark** ("Night", dark-first): the raven's ink (#100F16), with raised surfaces a step up and the sheen violet as the accent.

The values (`THEMES` in tokens.ts):

| Token | Light | Dim | Dark |
|---|---|---|---|
| surface | #F6F5F9 | #1B1A24 | #100F16 |
| surface-1 | #FFFFFF | #24232F | #18171F |
| surface-2 | #ECEAF1 | #2F2D3B | #22202B |
| line-low | #DDDAE4 | #3A3848 | #2B2935 |
| line-high | #827C90 | #807B93 | #726D82 |
| ink-high | #15131B | #F1EFF6 | #F3F1F7 |
| ink-medium | #45404F | #CCC8D8 | #C7C2D3 |
| ink-low | #625D6E | #A8A3B8 | #9C97AB |
| accent | #5A33D6 | #B9A6FF | #B4A0FF |
| on-accent | #FFFFFF | #170E33 | #170E33 |
| accent-ink | #5A33D6 | #B9A6FF | #B4A0FF |
| accent-wash | #ECE6FF | #332C55 | #251E42 |
| focus | #5A33D6 | #B9A6FF | #B4A0FF |
| danger | #C2261B | #D13438 | #D13438 |
| on-danger | #FFFFFF | #FFFFFF | #FFFFFF |
| danger-ink | #B42318 | #FF8A80 | #FF7B72 |
| review-ink | #8A4B00 | #F5B83D | #F5B83D |
| review-wash | #FCEFD2 | #3A2D17 | #2E2310 |
| review-on-wash | #6B3A00 | #FAD27A | #FAD27A |
| restricted-ink | #B42318 | #FF8A80 | #FF7B72 |
| restricted-wash | #FDE4E1 | #3D1A1F | #331418 |
| restricted-on-wash | #8A1C12 | #FFB4AC | #FFADA6 |
| verified-ink | #1F55C7 | #78B0FF | #6AA8FF |
| verified-wash | #E0EAFD | #1A2A45 | #12213A |
| verified-on-wash | #173F94 | #B0CEFF | #A5C8FF |
| explore-ink | #0B7350 | #4BD9A2 | #3DD39A |
| explore-wash | #DAF3E8 | #123328 | #0C2A20 |
| explore-on-wash | #075A3E | #93EDC9 | #86EBC3 |

The contrast of every pair in `TEXT_PAIRS`, computed with the WCAG 2.2 relative-luminance formula; text pairs need 4.5:1, control boundaries, the focus ring and filled controls against the page need 3:1:

| Foreground | Background | Minimum | Light | Dim | Dark |
|---|---|---|---|---|---|
| ink-high | surface | 4.5:1 | 16.96 | 15.10 | 17.00 |
| ink-high | surface-1 | 4.5:1 | 18.41 | 13.58 | 15.86 |
| ink-high | surface-2 | 4.5:1 | 15.43 | 11.81 | 14.31 |
| ink-medium | surface | 4.5:1 | 9.22 | 10.51 | 10.97 |
| ink-medium | surface-1 | 4.5:1 | 10.00 | 9.45 | 10.23 |
| ink-medium | surface-2 | 4.5:1 | 8.39 | 8.22 | 9.23 |
| ink-low | surface | 4.5:1 | 5.84 | 7.05 | 6.74 |
| ink-low | surface-1 | 4.5:1 | 6.34 | 6.34 | 6.29 |
| ink-low | surface-2 | 4.5:1 | 5.32 | 5.51 | 5.67 |
| accent-ink | surface | 4.5:1 | 6.72 | 8.17 | 8.54 |
| accent-ink | surface-1 | 4.5:1 | 7.29 | 7.34 | 7.97 |
| accent-ink | surface-2 | 4.5:1 | 6.11 | 6.39 | 7.19 |
| danger-ink | surface | 4.5:1 | 6.06 | 7.54 | 7.56 |
| danger-ink | surface-1 | 4.5:1 | 6.57 | 6.78 | 7.05 |
| danger-ink | surface-2 | 4.5:1 | 5.51 | 5.90 | 6.36 |
| review-ink | surface | 4.5:1 | 6.27 | 9.68 | 10.71 |
| review-ink | surface-1 | 4.5:1 | 6.80 | 8.70 | 10.00 |
| review-ink | surface-2 | 4.5:1 | 5.70 | 7.57 | 9.02 |
| restricted-ink | surface | 4.5:1 | 6.06 | 7.54 | 7.56 |
| restricted-ink | surface-1 | 4.5:1 | 6.57 | 6.78 | 7.05 |
| restricted-ink | surface-2 | 4.5:1 | 5.51 | 5.90 | 6.36 |
| verified-ink | surface | 4.5:1 | 6.08 | 7.75 | 7.86 |
| verified-ink | surface-1 | 4.5:1 | 6.60 | 6.97 | 7.33 |
| verified-ink | surface-2 | 4.5:1 | 5.53 | 6.06 | 6.61 |
| explore-ink | surface | 4.5:1 | 5.40 | 9.63 | 9.97 |
| explore-ink | surface-1 | 4.5:1 | 5.86 | 8.66 | 9.30 |
| explore-ink | surface-2 | 4.5:1 | 4.91 | 7.53 | 8.39 |
| ink-high | accent-wash | 4.5:1 | 15.19 | 11.28 | 13.95 |
| accent-ink | accent-wash | 4.5:1 | 6.02 | 6.10 | 7.01 |
| on-accent | accent | 4.5:1 | 7.29 | 8.68 | 8.21 |
| on-danger | danger | 4.5:1 | 5.85 | 4.93 | 4.93 |
| review-on-wash | review-wash | 4.5:1 | 8.26 | 9.29 | 10.68 |
| restricted-on-wash | restricted-wash | 4.5:1 | 7.70 | 9.06 | 9.39 |
| verified-on-wash | verified-wash | 4.5:1 | 7.98 | 8.98 | 9.43 |
| explore-on-wash | explore-wash | 4.5:1 | 7.07 | 9.93 | 10.74 |
| line-high | surface | 3:1 | 3.70 | 4.24 | 3.83 |
| line-high | surface-1 | 3:1 | 4.01 | 3.81 | 3.58 |
| focus | surface | 3:1 | 6.72 | 8.17 | 8.54 |
| focus | surface-1 | 3:1 | 7.29 | 7.34 | 7.97 |
| focus (Dark, forced) | lightbox stage over the page | 3:1 | 8.59 | 9.30 | 9.36 |
| accent | surface | 3:1 | 6.72 | 8.17 | 8.54 |
| accent | surface-1 | 3:1 | 7.29 | 7.34 | 7.97 |
| danger | surface | 3:1 | 5.39 | 3.49 | 3.87 |
| danger | surface-1 | 3:1 | 5.85 | 3.14 | 3.61 |

Every pair passes; the tightest are on-danger on danger in Dim and Dark (4.93:1), explore-ink on surface-2 in Light (4.91:1), and the danger fill against surface-1 in Dim (3.14:1). The fixes the audit asked for (audit 3.1) fall out of the tokens: a placeholder is ink-low on surface-1 (at least 6.29:1, where #71717a on zinc-900 gave 3.7:1), and a disabled button that carries its reason ("Describe every image") is ink-low on surface-2 (at least 5.32:1, where zinc-500 on zinc-800 gave 3.1:1).

How the tokens reach the screens:

- apps/app/global.css keeps its three @tailwind directives and gains one block of custom properties per theme: `:root` holds Light, `:root.dim` Dim and `:root.dark, .dark` Dark (the lightbox stage takes the class too, section 6.7), each token as an `R G B` triplet named `--k-<token>` (for example `--k-surface: 16 15 22;` in Dark).
- apps/app/tailwind.config.js maps each token to `rgb(var(--k-<token>) / <alpha-value>)` under `theme.extend.colors` (classes such as `bg-surface-1`, `text-ink-low`, `border-line-high`, `bg-review-wash`). It keeps `darkMode: "class"` and its comment; no screen uses a `dark:` variant, because the variables switch instead.
- On native, apps/app/src/theme/ThemeProvider.tsx wraps the app in a View whose style is NativeWind's `vars()` of the resolved theme, built from THEMES, so the same classes resolve on every platform.
- On web, the provider sets the class `light`, `dim` or `dark` on `<html>`, the `color-scheme` property, and the `theme-color` meta; the reader's appearance is kept in localStorage under `korbat.appearance` by apps/app/src/lib/appearance.ts, the only module in src that touches that key (ThemeProvider reads and writes through it), so the storage pin of explore.test.tsx:864-866 gains exactly that file in Task 1.
- The first paint before the bundle runs: the app's policy allows no inline script (script-src 'self' and Turnstile only; Caddyfile line 25), so a new file, apps/app/public/theme-boot.js (about 40 lines, served as /theme-boot.js with Cache-Control no-cache like the page), is loaded synchronously at the top of public/index.html's head. It reads `korbat.appearance`, resolves "System" with matchMedia, and sets the html class, `data-text-step`, `data-font`, the theme-color meta and color-scheme. The bundle's stylesheet, which holds the variables, has not arrived yet at that moment, so theme-boot.js also carries the three themes' surface and ink-high values and sets them as the html element's background and colour; contrast.test.ts checks they equal THEMES. public/index.html declares `color-scheme: light dark` instead of `dark`, and its reset keeps the Dark values for a browser without scripts; a reader with nothing stored and a light system sees Light from the first frame.
- The Turnstile widget ((auth)/signin.tsx:162, (auth)/password.tsx:59 and components/moderation/ReportForm.tsx:257, each `theme: "dark"` today) takes `theme: "light"` in Light and `"dark"` in Dim and Dark from useTheme().

The tests: apps/app/test/contrast.test.ts computes the ratio of every TEXT_PAIRS entry in every theme with the WCAG formula and fails below its minimum; it also parses global.css and fails when a variable differs from THEMES, so the two cannot drift. A source scan in the same file refuses Tailwind palette classes (a prefix such as text-, bg- or border- followed by zinc, sky, amber, red, emerald, rose or stone and a shade, as in `text-zinc-400`) and hex colour literals anywhere in apps/app/src except src/theme/tokens.ts; while the screens move over, a list `LEGACY_COLOUR_FILES` in the test names the files not yet converted, each task removes its own, and Task 8 empties it.

### 4.3 Type

Three families, bundled (libraries 2), and a scale applied by one Text component (section 6.2), never by per-screen size classes.

| Variant | Family and weight | Size / line height at Default | Tracking | Used for |
|---|---|---|---|---|
| display-1 | Fraunces 600, SOFT 50, WONK 1, optical size automatic | 34 / 40 | -0.02em | The profile's display name at 768 px and wider; the wordmark |
| display-2 | Fraunces 600 | 28 / 34 | -0.015em | Screen titles (Home, Bookmarks, Settings pages, auth titles); the profile's name on phones |
| display-3 | Fraunces 600 | 22 / 28 | -0.01em | Public pages' section headings, empty-state and marker titles ("You were here", "You're all caught up") |
| title | Atkinson Hyperlegible Next 700 | 18 / 24 | 0 | Section, sheet, dialog and card titles |
| post | Atkinson Hyperlegible Next 400 | 17 / 26 | 0 | Post bodies and quoted bodies (quoted at 15 / 22) |
| body | Atkinson Hyperlegible Next 400 | 15 / 22 | 0 | Everything else that is prose |
| body-strong | Atkinson Hyperlegible Next 700 | 15 / 22 | 0 | Display names in the author line, button labels, list row titles |
| meta | Atkinson Hyperlegible Next 400 | 13 / 18 | 0.005em | Times, counts, captions, helper text |
| chip | Atkinson Hyperlegible Next 700 | 12 / 16 | 0.01em | Chips and badges |
| mono | Atkinson Hyperlegible Mono 400 (700 in the profile header) | 14 / 20 | 0 | Handles everywhere, codes, references, ids |

- Fraunces is used at 22 px and up only (at the Default step), where its optical size reads as intended; below that, emphasis comes from weight.
- Tracking tightens as size grows and opens slightly below 14 px, after the apple-design guidance; leading is generous on prose (1.53 for posts) and tight on display (1.18 to 1.27).
- Italic exists for the text face only (Atkinson Hyperlegible Next Italic), used for tombstones ("This post was deleted by its author.").
- The text-size step multiplies size and line height together: Smaller 0.875, Default 1, Larger 1.125, Largest 1.25, rounded to whole pixels. On web the Text component writes sizes in rem, so the browser's own text-size setting scales them too, through one typed helper in kit/Text.tsx that holds the only cast (React Native types fontSize and lineHeight as numbers, and tsc gates every task); on native `allowFontScaling` stays on, so the operating system's text size multiplies the step, with `maxFontSizeMultiplier` 1.5 on chrome (tab labels, chips), 2 on other text and none on post bodies. Every box that holds text (the tab bar, Button, ListRow) sets its height as a minimum, never a fixed height.
- The font choice: "korbat fonts" (default) or "System font". With the system font, the text and display variants use `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (display at 700 instead of Fraunces) and mono uses `ui-monospace, "Cascadia Mono", Consolas, monospace`.
- Loading on web: apps/app/src/theme/fonts.web.ts adds one style element with the @font-face rules for "Fraunces Variable" (the package's `full` files, which carry the opsz, SOFT and WONK axes), "Atkinson Hyperlegible Next Variable" (normal and italic `wght` files) and "Atkinson Hyperlegible Mono Variable" (normal `wght` file). Each family has a latin and a latin-ext rule whose unicode-range is copied from the package's own CSS, so latin-ext downloads only when a post needs it. The files are `require()`d from the three @fontsource-variable packages (their "./files/*" exports; woff2 joins Metro's asset extensions in metro.config.js), and on web such a require yields the file's URL string, which the @font-face src takes as it is; Metro hashes them into /assets/ (immutable in Caddy) and the policy's `font-src 'self'` serves them. `font-display: swap`; the fallback stack is the system font, so text never waits.
- Loading on native: apps/app/src/theme/fonts.ts resolves every family to the platform's system font until sub-project 5 embeds the static files with expo-font's config plugin (section 14). An unknown family name on iOS logs an error, so native never names a family it has not loaded.
- A unit test (apps/app/test/theme.test.ts) checks that every file fonts.web.ts names exists in node_modules, that each unicode-range equals the package CSS's, and that each family's licence file sits in apps/app/assets/fonts/LICENSES/.

### 4.4 Spacing

Tailwind's 4 px scale stays as it is. apps/app/src/theme/layout.ts names the few layout constants that screens share:

- Gutter: 16 px on phones, 20 px at 768 px and wider.
- Post padding: 16 px across, 12 px down; 12 px between the author line and the body; 8 px between body and media; 4 px above the action row.
- Between sections of a screen: 24 px; between a heading and its content: 8 px.
- Stacks use `gap` rather than a `mt-*` on every child, so a removed child leaves no stray margin.
- Touch targets: at least 44 by 44 px on every platform for every standalone control (a link inside running text needs 24 by 24 px, WCAG 2.5.8's inline exception; section 12.3), by padding and a minimum size on the element itself (so the browser check can measure it), with `hitSlop` added on native, larger than WCAG 2.5.8's 24 px and equal to the console's phone rule.
- Line length: prose blocks (post bodies, notices, public pages) stay under 70 characters per line at Default by the timeline's 600 px column.

### 4.5 Radii

A hierarchy of five, added under `theme.extend.borderRadius` in tailwind.config.js, so radius says what kind of thing a shape is:

| Name | Radius | Used for |
|---|---|---|
| control | 10 px | Buttons, inputs, menu items, segmented controls |
| media | 12 px | Images in posts, the quoted post's frame, image previews in the composer |
| card | 16 px | The composer card, notices, settings groups, the details sheet's blocks |
| sheet | 24 px | The top corners of sheets on phones and every corner of dialogs at 768 px and wider |
| full | 9999 px | Chips, the new-posts pill, the compose button, toggles |

### 4.6 Elevation

Flat. There is no shadow token and no shadow anywhere. Layers are told apart by a surface step and a line: a floating element (menu, sheet, dialog, toast, the new-posts pill) uses surface-1 with a 1 px line-high border in every theme (3.58 to 4.24:1 against surface and surface-1, the line-high rows of TEXT_PAIRS, which also stand for the floating boundary; a line-low edge would be 1.34:1 in Dark), and a modal layer adds the scrim behind it. The compose button is the accent with a 2 px ring in the page's surface colour, which separates it from whatever scrolls under it. Under `forced-colors: active` on web every floating element keeps a 1 px border in CanvasText, so it stays visible when the browser removes backgrounds.

### 4.7 Iconography

- One set: Lucide 1.55.0 (ISC), drawn by lucide-react on web and lucide-react-native on iOS and Android, same names and version on both (libraries A.4). Never Bluesky's icons.
- One component, Icon (section 6.3), takes a name from a closed list in apps/app/src/components/icons.ts that maps korbat's names to Lucide's export names as strings (`as const`), importing neither package. Icon.web.tsx imports the named components from lucide-react and Icon.tsx from lucide-react-native, each as a `Record<IconName, ...>`, so tsc refuses a missing icon on either side, only listed icons are bundled, and the web export and the unit tests never load lucide-react-native or react-native-svg.
- Stroke 1.75 at 24 px, scaled with the icon. Sizes: 24 in the nav and tab bar, 20 in post actions, buttons and rows, 16 inline with meta text, 14 in chips.
- On and off: Heart and Bookmark fill with currentColor when on; Repeat2 has no closed shape, so "reposted" draws it in accent-ink at stroke 2.25 inside a 28 px accent-wash disc with a 1.5 px accent ring (radius full, within the 44 px target; the ring carries 6.11 to 8.54:1 against the surfaces), and its count turns body-strong: a shape cue like the fill, never colour alone. The browser check compares a reposted and an idle button in a greyscale screenshot region.
- An icon is decoration (`aria-hidden`) unless it is the only content of a control, and then the control carries the name (Button requires `label`, section 6.1). No icon ever stands alone without a name.
- Icons with their names in icons.ts: home (House), bookmarks (Bookmark), profile (CircleUser), settings (Settings), compose (SquarePen), reply (MessageCircle), repost (Repeat2), quote (Quote), like (Heart), more (Ellipsis), who-sees (Eye), copy-link (Link), delete (Trash2), report (Flag), close (X), back (ArrowLeft), newer (ArrowUp), previous (ChevronLeft), next (ChevronRight), add-image (ImagePlus), error (CircleAlert), offline (WifiOff), done (CircleCheck), review (Clock), restricted (EyeOff: not shown to others, as on a hidden image; Lucide's Ban, a prohibition sign, is not used), verified (BadgeCheck), explore (Compass), hidden (EyeOff), security (Shield), privacy (Lock), edit-profile (UserPen), account (UserCog), cases (Scale), appearance (Palette), sign-in (LogIn), passkey (KeyRound), external (ExternalLink), info (Info), retry (RotateCw).
- The wordmark is "korbat" set in Fraunces 600, lowercase, at display-1; the favicon keeps its "k" monogram (public/index.html), drawn in the Dark theme's surface and ink-high.

### 4.8 Status colours, and never colour alone

| Status | Tokens | Icon | Words (existing constant) | Where |
|---|---|---|---|---|
| Under review (korbat decides; an interim measure) | review-ink, review-wash, review-on-wash | review (Clock) | CHIP_WORDS.underReview and chipText(), lib/moderation-words.ts and lib/moderation.ts | The author's own withheld post and image; an announced suspension's banner |
| Removed or restricted (a final measure, an authority's order) | restricted-ink, restricted-wash, restricted-on-wash | restricted (EyeOff) | CHIP_WORDS.removed, chipText(), lib/orders.ts:12 | The author's own removed post and image; a running suspension's banner |
| Verified | verified-ink, verified-wash, verified-on-wash | verified (BadgeCheck) | "Verified", label "verified account" (ui.tsx:44) | After a display name, in posts, lists and the profile |
| In Explore | explore-ink, explore-wash, explore-on-wash | explore (Compass) | "In Explore" | The author's own post while it is in the ranking |
| Hidden or sealed image | surface-2, ink-medium (neutral, not a status colour) | hidden (EyeOff) | HIDDEN_IMAGE, SEALED_IMAGE (HiddenImage.tsx) | In place of the image |
| Error | danger-ink | error (CircleAlert) | the error's sentence | ErrorText, failed rows, rolled-back actions |

Rules:

- Every status shows its icon and its words; the colour only repeats what they say. A chip is never a coloured dot.
- A chip's wash carries a 1 px border in its `-ink` colour at 40 percent opacity, and under forced colours a solid CanvasText border, so the chip keeps its shape when backgrounds are removed.
- The standing banner (StandingBanner.tsx) keeps its region "Your account's standing" and its level-2 first sentence (3e design 9.8); its amber or red becomes review or restricted wash with the icon at the start of the heading.
- Green is used for In Explore only, never as "success": a successful action shows the done icon in ink-high.
- Red is never used to decorate: the destructive buttons (Delete, Discard, the account's Delete) use `danger`, and nothing else is red but restrictions and errors.

## 5. Motion and feedback

### 5.1 Rules

- Motion answers the reader. Nothing animates on mount, on a count changing in data, or to draw the eye, with two exceptions: skeleton rows pulse and the centred spinner turns while something loads, because they show work in progress, and the check of "You're all caught up" draws itself once per session (5.2, caught-up).
- Feedback starts on press. Controls show their pressed state on pointer-down; surfaces that a scroll starts on (a post card's open area, a ListRow) show theirs after 80 ms and cancel it on 10 px of movement, so a scroll never flashes a row; actions change their state at once and roll back if the server refuses (section 6.6).
- Everything a finger can move is a Reanimated spring driven by a gesture-handler gesture, started from the element's current value, with the release velocity handed to the spring. Nothing waits for an animation to end before taking input.
- Enter and leave along one path: a sheet comes up from the bottom and leaves downwards; a menu grows from its trigger and shrinks back into it; the lightbox grows from its thumbnail and returns into it.
- Keyboard actions do not animate their content: arrow keys in the lightbox and in tabs switch at once, and a sheet or dialog opened from the keyboard uses its reduced form (a 150 ms fade).
- Only transform and opacity move on screen, with three exceptions that change layout once: the inline composer opening, a deleted post collapsing, and the rows making room for the reader's own new post, all through Reanimated layout transitions.
- Reduced motion has two sources: the operating system (useReducedMotion() on native, prefers-reduced-motion on web) and korbat's own setting "Reduce motion" (Follow the system, or Always). Either one switches every animation below to its reduced form. Reduced means no movement, not no feedback: colour and opacity changes stay, at 150 ms or less.

The values live in apps/app/src/theme/motion.ts:

| Name | Value | Use |
|---|---|---|
| ease-out | cubic-bezier(0.23, 1, 0.32, 1) | Entering, pressing, menus, the pill |
| ease-in-out | cubic-bezier(0.77, 0, 0.175, 1) | On-screen movement without a gesture (tab underline, scroll to the oldest unread new post) |
| spring-snap | damping ratio 1, duration 300 ms | Default spring: sheets opening, the lightbox growing, the tab underline |
| spring-release | damping ratio 0.85, duration 350 ms, with the gesture's velocity | After a drag or flick is released (sheets, lightbox) |
| press-in / press-out | 100 ms / 160 ms, ease-out | Pressed scale |
| fade | 150 ms ease-out | Reduced forms, the blurhash cross-fade |

A hook, useMotion() in apps/app/src/lib/motion.ts, returns `{ reduced, spring(name), timing(name) }`, so no component reads either source on its own and the browser check can flip both.

### 5.2 Every animation

| Name | Trigger | Property and value | Duration or spring | Interruption | Reduced form |
|---|---|---|---|---|---|
| press | Pointer or touch down on a button or icon button (scale); on a row or card (background, after 80 ms, cancelled by 10 px of movement) | buttons scale 0.97, icon buttons 0.92; rows and cards never scale, their background goes to surface-2 | press-in, press-out | Release or a second press retargets from the current scale | No scale; the background change only |
| hover | Web, `(hover: hover) and (pointer: fine)` only | Background surface-2 on rows, icon buttons and nav items | 120 ms ease | Retargets | Same (a colour change) |
| like | The reader turns Like on | One underdamped spring on release from the pressed scale (0.92) to 1, with an initial velocity of 10 scale units per second, so it peaks at 1.15; the fill lands with the release; one ring in accent at 40 percent opacity behind the heart, scale 0.6 to 1.4 and opacity to 0; the count rolls up on an increase and down on a decrease (6 px and out, the new number in from the other side) | Spring damping ratio 0.5, response 0.22 s (settles in about 370 ms); ring 300 ms ease-out; count 180 ms ease-out | A tap mid-pop retargets the one spring from its current value; off never pops (colour fades 120 ms) | Fill and number change at once with a 120 ms cross-fade |
| repost, save | The reader turns Repost or Save on | The same single spring from 0.92, initial velocity 8 (peak 1.12), no ring; the count rolls as above | Damping ratio 0.6, response 0.25 s (about 325 ms) | As like | As like |
| pending | An action's request is still out after 400 ms | The control's icon at 60 percent opacity; aria-busy true | 150 ms fade | Ends when the answer lands | Same |
| rollback | The server refuses an optimistic action | The control returns to its old state; one horizontal nudge of 4 px | 200 ms ease-out | n/a | No nudge; the toast says it |
| sheet-open | A sheet opens on phones (composer, menus, details, who sees this) | translateY 100 percent to 0; scrim opacity 0 to 1 | spring-snap; scrim 200 ms | Grabbing the sheet mid-flight takes it from where it is | Opacity 0 to 1 in 150 ms, no movement |
| sheet-drag | Drag on the handle or the sheet's header | translateY follows the finger 1:1 down; upwards it rubber-bands (overshoot x height x 0.55 / (height + 0.55 x overshoot)) | Live | Always live | The sheet still follows the finger; release closes or stays with a fade |
| sheet-close | Release whose projected end (current + v/1000 x 0.998/0.002) passes half the height, or a downward velocity over 200 px/s (the lightbox's rule too), the close button, Escape, the scrim | translateY to 100 percent; scrim to 0 | spring-release with the release velocity; scrim 150 ms | Grabbing again catches it | Fade out 150 ms |
| dialog | At 768 px and wider, the same surfaces open as centred dialogs | scale 0.96 to 1 and opacity, origin centre | 200 ms ease-out in, 150 ms out | Retargets | Opacity only |
| menu | A popover menu opens at 768 px and wider (More, Repost) | scale 0.97 to 1 and opacity, origin at the trigger's corner | 160 ms ease-out in, 120 ms out | Retargets | Opacity only |
| pill-show | New posts arrive above the viewport | The pill's translateY -8 px to 0 and opacity | 200 ms ease-out in, 150 ms out | Retargets | Opacity only |
| pill-jump | The reader presses the pill | The list scrolls until the oldest unread new post (the first above the reader's place) is at the top of the viewport | Native animated scroll; web `scrollTo` smooth | A touch on the list stops it | Jumps at once |
| new-own-post | The reader's own post enters the top of a feed they are at the top of | The new row fades in and the rows below slide down to make room (Reanimated FadeIn and LinearTransition) | 220 ms ease-out | n/a | Appears at once |
| others-posts | Polled posts are inserted above the viewport | Nothing moves: the list keeps the reader's post where it was (section 7.5) | n/a | n/a | Same |
| lightbox-open | An image cell is pressed | The image grows from the thumbnail's measured rectangle to its fitted size (translate and scale); backdrop fades in | spring-snap; backdrop 200 ms | Closing mid-growth reverses from where it is | Fade 150 ms |
| lightbox-drag | A vertical drag on the image (touch, or a mouse drag on web) | The image follows 1:1, scaling to 0.85 at half a screen; the chrome (close, counter, description) fades out and the backdrop's opacity follows the drag from 0.94 to 0.4 at half a screen | Live | Live | Follows the finger, the backdrop unchanged; settles with a fade |
| lightbox-close | Release whose projected end passes 100 px, or a downward velocity over 200 px/s; Close, Escape | Back into the thumbnail if it is still on screen, else fade | spring-release; fade 150 ms | Catchable | Fade 150 ms |
| lightbox-page | A horizontal swipe on touch | The images follow the finger, then snap to the projected neighbour | spring-release | Live | Changes at once |
| image-in | An image finishes loading | Cross-fade from its blurhash | 150 ms (2b design :487) | n/a | At once (as today) |
| tab-underline | A Home or profile tab is chosen by pointer | The accent underline moves and resizes to the new tab | spring-snap | Retargets | Jumps; arrow keys always jump |
| composer-open | The desktop composer card gets focus or a click | The card grows to the full composer (LinearTransition) | 200 ms ease-out | Blur when empty shrinks it from where it is | At once |
| post-removed | The reader's post is deleted | Opacity to 0, then the rows below close the gap | 150 ms, then 200 ms ease-out | n/a | Removed at once |
| caught-up | "You're all caught up" first becomes true in a session (the marker reached from above, or the pill's count at zero) | Its done icon's stroke draws (dash offset 1 to 0) | 450 ms ease-out, once | n/a | Drawn at once |
| skeleton | A list's first page is loading | Skeleton rows pulse between opacity 0.6 and 1 | 1.6 s per cycle, ease-in-out; stops when content arrives | n/a | Static at 0.8 |
| ring | The composer's character count changes | The ring's dash offset follows the count; colour turns review-ink at 900 and danger-ink above 1000 | 120 ms ease-out | Retargets | Changes at once |
| theme | The reader changes theme | Background and text colours cross-fade on web (a class on html with a colour transition, removed after) | 200 ms ease | n/a | A 150 ms cross-fade: a soft brightness change is gentler than a jump |
| soft-reset | The current Home item is pressed again (section 7.1) | The feed scrolls to the newest post | Smooth scroll | A touch on the list stops it | Jumps at once |
| spinner | The centred Loading of auth screens and guard layouts | Rotation | 800 ms per turn, linear | n/a | A 1.6 s opacity pulse, as the skeleton |
| pull-to-refresh | Native, a pull at the top of a list | The platform's own control | The platform's | The platform's | The platform's; the threshold haptic stays |
| header-hide | Phones: the list scrolls down past the header's height, or back up | The header's translateY to minus its height, or back to 0 | 200 ms ease-out | Reverses from where it is on the next change of direction | The header stays |
| toast | A toast shows or leaves | sonner's (web) and sonner-native's own: up from the bottom with opacity | The libraries' defaults | Swipe away | Opacity only (section 5.4) |

The compose button and the tab bar never hide on scroll: they stay where the reader last saw them. Only the phone header does (header-hide).

### 5.3 Haptics

apps/app/src/lib/haptics.ts exports useHaptics(), after Bluesky's intent API (study 2.3), over expo-haptics 57.0.3. Each intent fires in the same handler as the visual change, before the state update, so sight and touch land on the same frame.

| Intent | When | iOS | Android (performAndroidHapticsAsync) |
|---|---|---|---|
| toggleOn | Like, Repost, Save or Follow turned on | impactAsync(Light) | AndroidHaptics.Toggle_On |
| toggleOff | Turned off | nothing | AndroidHaptics.Toggle_Off |
| selection | A tab, a segment or a theme chosen | selectionAsync() | AndroidHaptics.Segment_Tick |
| threshold | A sheet or the lightbox crosses its close threshold while dragging; pull to refresh arms | impactAsync(Medium), once per crossing | AndroidHaptics.Gesture_Threshold_Activate |
| success | A post, reply, quote, report or appeal is sent | notificationAsync(Success) | AndroidHaptics.Confirm |
| warning | The discard question appears | notificationAsync(Warning) | AndroidHaptics.Reject |
| error | An optimistic action is rolled back | notificationAsync(Error) | AndroidHaptics.Reject |

- Ordinary taps, scrolling and navigation have no haptic.
- On web useHaptics() returns no-ops (the Vibration API is coarse and missing in Safari; libraries A.1).
- The off switch: Settings, Appearance and accessibility, "Haptics" (shown on iOS and Android only). Reduced motion does not turn haptics off; the switch does.
- The Android constant names are checked by tsc against expo-haptics 57.0.3's AndroidHaptics; on devices they are checked in sub-project 5.

### 5.4 Toasts

apps/app/src/components/toast.web.tsx (sonner 2.0.8) and toast.tsx (sonner-native 0.27.0) export one API, `toast.show({ message, action?, tone? })`, and one `<Toaster />` mounted once in the root layout.

- Words: the sentence names the action as its button did. "Your post was sent. It is at the top of Home.", "Your reply was sent", "Your quote was sent", each with the action "View"; "Saved to Bookmarks" with "View"; "Link copied"; a rollback's sentence ("Couldn't like this post. Try again.", one per action, in ui-words.ts).
- Durations: 4 seconds plain, 8 seconds with an action, 6 seconds for a rollback. Timers pause while the toast is hovered, while focus is inside the toaster, and while the page is hidden (sonner's own behaviour; sonner-native pauses on touch).
- At most three on screen; newer ones stack above older ones; each can be swiped away.
- Place: bottom centre, above the tab bar and the safe area on phones (offset 72 px plus the bottom inset; 140 px plus the inset on screens with the compose button, so the toast and its "View" sit above the button, never over it), bottom centre of the window wider up.
- Announcement: on web sonner's region is a polite live region, and its hotkey Alt+T moves focus into it, so the action button can be reached from the keyboard. On native toast.tsx also calls AccessibilityInfo.announceForAccessibility with the message and "View" when there is an action.
- A toast confirms; it never carries the only copy of something the reader must act on. Form errors stay in place as ErrorText (role alert); a failed list page stays as a row.
- Reduced motion: both libraries already drop their movement under the system's setting (sonner by prefers-reduced-motion; for sonner-native the dry run checks it and, if it does not, toast.tsx passes no animation). Under korbat's own "Reduce motion: Always", toast.web.tsx gives each toast the class `k-still`, and the style element of theme/fonts.web.ts carries the rule `.k-still { transform: none !important; transition: opacity 150ms ease !important; }`.

## 6. Components

### 6.1 Where they live, and the rules every one keeps

- apps/app/src/components/ui.tsx keeps its twelve exports and their names (Screen, Title, Body, Section, VerifiedChip, Field, Button, TextLink, TextButton, ErrorText, Notice, Loading), rewritten on the tokens, because tests import them and pin lines of them (audit 4.1). Field keeps `<TextInput` followed by `ref={ref}` on the next line, with the indentation the pin has (eight spaces), and Button keeps `<Pressable ref={ref}`, the two lines lifecycle.test.tsx:240-241 pins.
- New primitives go in apps/app/src/components/kit/, one file each (Text.tsx, Icon.tsx with Icon.web.tsx, IconButton.tsx, Avatar.tsx, Sheet.tsx, Menu.tsx, Tabs.tsx, ListRow.tsx, Skeleton.tsx, EmptyState.tsx, ErrorState.tsx, StatusChip.tsx, VisuallyHidden.tsx, PublicFrame.tsx), plus apps/app/src/components/toast.tsx and toast.web.tsx. ui.tsx builds on them.
- Variants are written with class-variance-authority 0.7.1 and a `cn()` helper over clsx 2.1.1 in apps/app/src/theme/cn.ts; variants never set the same property twice, so no merge step is needed.
- Every control has a name. Button, IconButton, ListRow, Menu items and Tabs take a required `label: string`; for an icon-only control the label is its accessible name, and for a control with visible text the label is that text (WCAG 2.5.3, label in name).
- Every pressable shows the press state of section 5.2, a hover state on web pointers, and a visible focus ring: 2 px `focus` colour, 2 px offset, rounded with the control, drawn as an outline (`focus-visible:outline-2 focus-visible:outline-offset-2` on web, never Tailwind's box-shadow `ring`, which forced-colours mode removes; on native the system focus for keyboards). The ring is never removed.
- States reach assistive technology through aria-* props, never accessibilityState, which react-native-web 0.21 drops (a11y.test.tsx:32-34).
- Links are real anchors: expo-router's Link with `asChild`, or a Text with href; never a hand-made link role (a11y.test.tsx:36-40).
- Touch targets are at least 44 by 44 px (section 4.4).

### 6.2 Text

- Props: `variant` (the ten names of section 4.3), `tone` (`high`, `medium`, `low`, `accent`, `danger`, or a status `-ink`), `as` (`p`, `h1` to `h4` through accessibilityRole "header" with aria-level, `span`), `numberOfLines`, `selectable`, and the usual Text props.
- It reads the appearance (text step and font choice) from useAppearance() and writes fontFamily, fontSize and lineHeight as a style: rem on web, px times the step on native. Screens never write size or font classes again; a source scan (apps/app/test/theme.test.ts) refuses `text-xs` to `text-3xl`, `font-bold`, `font-semibold` and `font-medium` classes in src outside kit/Text.tsx once Task 8 ends (the same allowlist as the colour scan).
- Accessibility: a heading is `accessibilityRole="header"` with `aria-level`, which renders `<h2>` and up on web (a11y.test.tsx:104-106). Each screen has exactly one level-1 heading, its title.

### 6.3 Icon and IconButton

- Icon props: `name` (IconName from icons.ts, which holds export names as strings; each Icon file imports its own package's components, section 4.7), `size` (14, 16, 20, 24), `tone` (as Text), `filled`. Icon.web.tsx renders the lucide-react component with `aria-hidden="true"` and `focusable="false"`; Icon.tsx renders lucide-react-native over react-native-svg with `accessible={false}`.
- vitest resolves `.web.tsx` before `.tsx` (apps/app/vitest.config.mts gains `resolve.extensions` with the web extensions first), so the render tests see what the browser gets.
- IconButton props: `icon`, `label` (required, the accessible name), `onPress`, `pressed` (renders aria-pressed for toggles whose name stays the same), `busy` (aria-busy), `count` (a visible number beside the icon, inside the button, hidden from the name because the label already says it), `tone`, `hasPopup` (`menu` or `dialog`, rendered as aria-haspopup with aria-expanded while open).
- On web, under `(hover: hover) and (pointer: fine)` only, an icon-only IconButton shows its label as a tooltip after 500 ms of hover, then at once for its neighbours while one is open; it grows from the trigger (opacity and scale 0.97 to 1, 125 ms; reduced: opacity only), never shows on touch and adds no aria, since it repeats the name.
- The visible count is formatted by `compactCount()` in a new apps/app/src/lib/format.ts, created with IconButton in Task 2 (1, 999, 1.2K, 12K, 1.2M), and hidden when the reader hides counts (decision 15); the label then drops the number too.

### 6.4 Button, TextLink, TextButton

- Button props: `label` (required), `onPress`, `busy`, `disabled`, `tone` (`primary`, `secondary`, `danger`; the existing names), `size` (`md` 44 px, `lg` 52 px), `icon`, `full` (full width; the default inside forms, as today), `ref`. Primary is the accent fill with on-accent text; secondary is surface-1 with a line-high border and ink-high text; danger is the danger fill with on-danger text.
- States: rest, hover, pressed, focus, busy (label "Please wait..." with the U+2026 ellipsis as today, aria-busy, aria-disabled), disabled (surface-2, ink-low, still readable because it may carry the reason).
- TextLink and TextButton keep their props and become accent-ink, underlined, at body size, with a 44 px tall hit area.

### 6.5 Avatar

- No uploaded avatars exist before 2d. Avatar draws a generated monogram now and takes an image source later: props `account` (`{ id, displayName }`), `size` (32, 40, 64, 96), `src` (unused until 2d).
- The monogram is the first grapheme of the display name in the text face at 700 at 32 and 40 px, and in Fraunces 600 with SOFT 100 at 64 and 96 px, where the letter is above 22 px, so the profile header's name and disc share the display face, ink-medium on surface-2 inside a 1 px line-low ring (at least 8.22:1 in every theme, a pair already in TEXT_PAIRS). It takes no hue: colour in korbat means action or status, and a coloured disc per account would mean neither.
- It is decoration: `aria-hidden`, because the author link beside it carries the name; in a post card it is wrapped in a profile link out of the tab order (section 6.6). It is shown at 40 px in post cards and list rows and at 64 px (phones) or 96 px (768 px and wider) in the profile header. This gives the feed its rhythm now; 2d swaps the source without moving anything (decision 22).

### 6.6 PostCard

The post is an article with one explicit open target (study 3.3).

- Element: `role="article"` with `aria-labelledby` naming its author line, so a screen reader announces "Ada, @ada, 3 hours ago, article".
- Layout: the repost line ("Ben reposted", with the repost icon, Ben's name a link to his profile) above; then the avatar column and the content column. The content holds the author line (display name in body-strong as a link to the profile, VerifiedChip, the handle in mono ink-low, and the time), the reader's own status chips, the reply context ("Replying to @ada", a link), the body (RichText in the post variant, its links and mentions in accent-ink; links, not mentions, also underlined, 1 px at a 2 px offset, since accent-ink against the body's ink is under 3:1, while a mention keeps its "@"), MediaGrid, QuoteEmbed, and the action row. Below 768 px MediaGrid and QuoteEmbed span the card's full inner width, from the avatar's left edge to the right gutter (328 px at 360 instead of 276), keeping radius media; at 768 px and wider they keep the indent.
- The avatar and the name open the profile: the name is the profile link; the avatar sits in a second link to the same profile with `tabIndex={-1}` and aria-hidden, so the name stays the one keyboard and screen-reader target; its box is 44 by 44 px around the 40 px disc, and it is outside the card's open area.
- The open target: the time is the post's link (`/post/<id>`). Its visible text is the short time ("3h") and its name adds visually hidden words from postedWhen (section 8.1: "3h ago, open the post", "posted just now, open the post", "on 12/10/2026, open the post"), so the name contains the visible label. It is the only link to the post in the card, so the keyboard and screen readers meet one target, and padding and a minimum height make it at least 24 by 24 px (WCAG 2.5.8).
- For pointers and touch, the whole card body is the open-post target: a press anywhere on it that is not a link, a button or the avatar opens the post. On web the article's onClick ignores presses whose target is inside a link, a button or an input, and presses that end a text selection; on native the body sits in a Pressable with `accessible={false}`. This is a convenience the explicit link duplicates, so nothing is reachable only by it.
- The body is no longer a link (today it is, PostCard.tsx:197-204), which also ends the link-inside-link of mentions in a linked body.
- Actions (section 2, decision 12): IconButton Reply (count of replies; opens the thread with the reply composer focused), IconButton Repost (count of reposts; `hasPopup="menu"`; the menu offers "Repost" or "Undo repost", and "Quote"), IconButton Like (count; `pressed`), IconButton Save (label "Save" or "Saved", no count, no aria-pressed: the label says it, as today; turning it on shows the toast "Saved to Bookmarks" with "View", which opens /bookmarks and is announced politely, so a screen reader hears that the press worked; turning it off shows none), then a spacer and IconButton More (label "More options for this post"; the menu holds "Who sees this", "Copy link" on web, "Delete" for the author, "Report" for everyone else, signed in or out, as a link to `/report?post=<id>`).
- Optimistic actions: like, repost, save and undoing them (and Follow, section 8.4) change the card at once (state, icon, count), haptic toggleOn or toggleOff fires, and the request goes out. Each kind has its own request lane, so a like and a save can be in flight together while a second tap on the same kind waits for the first answer (so a double tap cannot undo itself, as today's comment in PostCard.tsx wants). The server's answer replaces the counts, so they never drift. A refusal restores the earlier state, plays the rollback nudge, fires the error haptic and shows the rollback toast; `account_suspended` still shows RefusedNotice under the card (3e, 9.4).
- Signed out, an action sends the reader to /signin as today.
- Delete: "Delete" in the More menu replaces the action row with the inline question "Delete this post?" and its two controls, "Delete" (danger) and "Keep", which still use the internal Action component, so the pin `<Action ref={keepRef} label="Keep"` (a11y.test.tsx:139) holds. Keep takes the focus when the question shows; withdrawing it returns the focus to the More button. A deleted post leaves the list with the post-removed motion.
- QuoteEmbed: a bordered region (radius media, line-low) with the quoted author line (name a link to the profile) and the quoted time as the link to the quoted post, so the quote has one open target too; its body is plain text, and its images open nothing (they belong to the quoted post). A tombstone keeps its two sentences.
- The thread's focused post uses the same card in a large variant: post text at 19 / 28 in the text face, the full date and time instead of the short time, and a stats line ("12 reposts, 4 quotes, 30 likes", words from ui-words.ts, hidden counts respected) above the action row.

### 6.7 MediaGrid and the Lightbox

- MediaGrid keeps its geometry (one image at its own ratio between 3:4 and 2:1, two to four in a 16:9 frame; MediaGrid.tsx:12-19, 85-104), its buttons "Open image: <description>", its ALT toggle with aria-expanded named "Show image descriptions" or "Hide image descriptions" (hidden-media.test.tsx:82), its blurhash placeholders and the author's own labels "Under review" and "Removed" on their images, now drawn as StatusChips in the image's corner.
- Each image is clipped to radius media with a 1 px line-low hairline inside, so white images keep an edge on the Light theme.
- Every korbat image has a description (2b requires it), so a per-image ALT badge would say nothing; the one ALT toggle stays.
- The Lightbox is MediaViewer.tsx and MediaViewerContent, kept with their props and words ("Close the image viewer", "Previous image", "Next image", "Report this image", "N of M"), on a stage that stays near-black in every theme (rgba(0, 0, 0, 0.94)) with white text, so images are seen as they are. The stage is a forced Dark token scope (ThemeProvider's vars() of Dark on native; on web the class `dark` on the stage, which global.css's Dark block also matches), so its focus ring, ink and buttons always take the Dark values: the Light focus colour on the stage would be 2.63:1, the Dark one is at least 8.59:1 (TEXT_PAIRS, section 4.2). It gains the motion of section 5.2 (growing from the thumbnail, drag to dismiss, swipe between images on touch). Arrow keys, Escape and the focus returning to the opening image stay (2b design :388).

### 6.8 Sheet and Dialog

- One component, Sheet (kit/Sheet.tsx), with props `open`, `onClose`, `title` (required; it names the dialog), `description`, `dismissible` (default true), `size` (`auto` or `tall`) and children. Below 768 px it is a bottom sheet with a grab handle; at 768 px and wider the same content is a centred dialog 560 px wide (composer 640 px).
- Built on React Native's Modal (transparent, no built-in animation), with Reanimated for the motion and gesture-handler's Pan for the drag (section 5.2). react-native-web's Modal already traps focus and closes on Escape; the sheet adds the scrim (a press on it closes, and it is no tab stop, as the compose sheet's is today) and safe-area padding. GestureDetector throws on iOS and Android without a GestureHandlerRootView above it, so the root layout is wrapped in one (Task 3) and the Sheet wraps its Modal content in its own (Android needs one inside a Modal).
- Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title (a11y.test.tsx:93-102); focus moves to the first field, else the title; focus returns to the control that opened it; the rest of the page is inert while it is open.
- A sheet with unsaved content asks before closing (the composer's DiscardDialog, section 6.15); others close at once.

### 6.9 Menu

- A disclosure, not an ARIA menu: the trigger is an IconButton with `hasPopup="menu"` and aria-expanded; the content is a list of buttons and real links, so links stay anchors and Tab moves through them. Arrow keys also move between items on web; Escape and a press outside close it and return focus to the trigger.
- Below 768 px the content is a Sheet titled by the trigger's label; at 768 px and wider it is a popover of surface-1 anchored to the trigger, flipped to stay inside the window.
- Item props: `label`, `icon`, `onSelect` or `href`, `tone` (`danger` for Delete), `description` (one line under the label, used by "Who sees this").

### 6.10 Tabs

- Props: `label` (names the tablist), `tabs` (`{ key, label }[]`), `selected`, `onSelect`, `panelId`. Used by Home (Following, Latest, Explore), the profile (Posts, Replies, Likes), Settings, Cases (About you, Reports) and Settings, Privacy (Blocked, Muted).
- Roles stay as tests pin them: `accessibilityRole="tablist"` on the row and `accessibilityRole="tab"` with aria-selected on each (a11y.test.tsx:50; cases.test.tsx:296); the content below is `role="tabpanel"` labelled by the selected tab.
- Keyboard on web: one tab stop (roving tabindex); Left and Right move and select at once, Home and End jump; no animation for keyboard moves.
- Look: label in body-strong, ink-low when not selected, ink-high when selected, with a 2 px accent underline that moves with the tab-underline spring; the row scrolls sideways when the labels are wider than the column, never wrapping into two rows.

### 6.11 ListRow

- One row for settings, lists of accounts, menus on phones and the details sheet: props `title`, `description`, `icon`, `href` or `onPress` or `control` (a Switch or a radio), `value` (a short trailing text, such as "Dark"), `tone`.
- As a link it is an anchor (Link asChild) with a chevron; as a button it is a button; with a Switch the switch carries `accessibilityLabel` equal to the title, written on the `<Switch` line itself because the scan reads one line at a time (a11y.test.tsx:130-133), and the whole row toggles it; in a radio group each row is `role="radio"` with aria-checked inside a `role="radiogroup"` named by the group's heading.
- Minimum height 52 px (44 px target plus padding); dividers line-low; hover and pressed surface-2.
- ProfileRow (components/social/ProfileList.tsx) becomes a ListRow with the Avatar, the display name, the VerifiedChip (replacing the separate check mark at ProfileList.tsx:16, so there is one verified look), the handle in mono and FollowButton as its control.

### 6.12 Skeleton, EmptyState, ErrorState

- Skeleton (kit/Skeleton.tsx): parts `Skeleton.Text` (a bar of one line's height and a given width), `Skeleton.Circle`, `Skeleton.Block`, and two composed rows, `Skeleton.Post` (avatar, two text lines, a media block on every third row, an action bar) and `Skeleton.Row` (for account and settings lists). Surface-2 shapes with the skeleton pulse; `aria-hidden`; the list that shows them carries one visually hidden `role="status"` text from ui-words.ts ("Loading posts", "Loading accounts").
- Loading never leaves the shell: a screen inside AppShell shows skeleton rows in its column while it loads, so the nav never disappears (today it does on five screens, audit 1.1). The centred spinner (`Loading`) stays for the auth screens and the guard layouts, now in accent on the page's surface. SessionFailure (lib/session.tsx:32-43, the full-screen "Try again" when /me fails) is redrawn on ErrorState in Task 3, which takes the file off LEGACY_COLOUR_FILES.
- EmptyState: props `icon`, `title`, `body`, `action` (`{ label, href }` or `{ label, onPress }`). Title in display-3, body in ink-medium, one action at most; it says what the screen will hold and what to do next. The existing empty sentences stay word for word as the body (audit 1.1: "Nothing here yet. Follow someone, or switch to Latest or Explore.", "No posts yet.", "Nothing saved yet. Use Save on a post to keep it here." and the rest), with a short title above each from ui-words.ts.
- ErrorState: props `message` (from errorMessage()), `onRetry`, `offline`. The message is `accessibilityRole="alert"`; the action is "Try again" (the pinned word). Offline (the request failed without a response, or navigator.onLine is false on web): icon offline, title "You're offline", body "korbat will load this when your connection is back.", and the same "Try again"; when the browser reports online again, the list retries once by itself.

### 6.13 StatusChip

- Props: `tone` (`review`, `restricted`, `verified`, `explore`), `label`, `onPress`, `href`. It draws the tone's wash, its icon and its label (section 4.8).
- Three forms, by what the chip does:
  - Information only: a View with `role="img"` and an accessibilityLabel. VerifiedChip is this form and keeps its exact contract: visible "Verified", `role="img"`, label "verified account" (lifecycle.test.tsx, "the verified badge chip").
  - A link: an anchor (In Explore keeps its link to `/post/<id>`, explore.test.tsx:811-812).
  - A button that opens a sheet: the author's moderation chip, `aria-haspopup="dialog"`, its name the chip's words (chipText()), so "Removed: R3, strike until 4 Dec" is read as a button that opens a dialog; it ends with a 14 px chevron (the `next` icon, aria-hidden), so it looks like something to press.
- Chips wrap their text and never truncate it.

### 6.14 WhoSeesThis

- A sheet (title "Who sees this") opened from a post's More menu, for every post. Its sentences come from a new pure function, `reach(post, me, explore?)` in apps/app/src/lib/reach.ts, built from the data of audit 5.4, with every sentence in ui-words.ts:
  - Another account's post: "Public. Anyone can read it, including people who are not signed in."
  - The reader's own visible top-level post: "Public. Anyone can read it, including people who are not signed in.", then what a block does and does not do, "Accounts you blocked do not see it in their feeds, but anyone signed out can still read it.", and "It shows in Latest and in your followers' Following, in time order." and one Explore line: "Also in Explore." when `inExplore`; "Not in Explore: you turned Explore off." when `me.profile.showInExplore` is false; "Not in Explore while your account is suspended." while a suspension runs; otherwise the sentence of its Explore status, read from GET /api/posts/:id/explore when the sheet opens, in the words lib/explore.ts already has for ExploreStatusLine.
  - The reader's own reply: "Public. Shown in the thread and on your Replies tab." Replies never enter Explore, and the sheet says so.
  - The reader's own withheld or removed post: "Only you and korbat's moderators can see it." followed by chipText() and, with an order, "Removed for everyone else by an authority's order." and a link "Read the decision" to `/settings/cases/<decisionId>` when the decision is known.
  - Always last: "korbat never lowers a post's reach in secret. Following and Latest are in time order." with a link to /explore/about, "How Explore works".
- A unit test, apps/app/test/reach.test.ts, covers every branch and that no sentence claims more than the data says: a reader's view of someone else's post never mentions moderation, no sentence says a blocked account cannot read a public post, and the withheld or removed sentence names korbat's moderators.

### 6.15 Composer parts

The Composer (components/social/Composer.tsx) is split into parts that a reducer drives, after Bluesky's composerReducer (study 2.7): apps/app/src/components/social/composer/state.ts (a pure reducer: text, images, the image states, busy, error, the draft's key) with apps/app/test/composer-state.test.ts.

- ComposerField: the TextInput with its existing accessible names ("What's on your mind?", "Your reply", "Your comment on the quoted post") and placeholders, post variant type, growing with its content up to half the screen and then scrolling.
- ProgressRing: a 20 px ring drawn with react-native-svg (DOM svg on web) in accent, review-ink from 900 characters, danger-ink above 1000; a number appears beside it when 100 or fewer remain ("12", then "-3" over the limit). The visible "n/1000" counter is replaced by the ring and number; a visually hidden text "{n} of 1000 characters" is the field's description (aria-describedby), announced politely only when the count crosses 900 and 1000.
- ImageTray: ComposerImages.tsx as today (previews, per-image status, the required description with its counter, Remove), now 88 px previews in radius media, and one new line under "Add image" in ink-low: "korbat removes location and camera details from images." (study 4.9; true by 2b's EXIF strip).
- SendBar: IconButton "Add image" (icon add-image), the ring, "Cancel" when the composer is a sheet, and the Post button, which keeps today's behaviour: it names what is missing ("Remove the failed image", "Describe every image", "Waiting for images...") and shows "Posting..." while it sends (Composer.tsx:41, :110).
- DiscardDialog: the existing question "Discard this draft?" with "Discard" (danger) and "Keep writing", asked only when the draft has content (ComposeSheet.tsx today), with the warning haptic.
- Drafts (decision 18): apps/app/src/lib/drafts.ts keeps the text per context key (`post`, `reply:<id>`, `quote:<id>`) in localStorage under `korbat.drafts.<accountId>`, written 500 ms after typing stops, removed when the post is sent or the draft discarded, all removed when the session ends (section 8.8, On this device); drafts.ts is the only module that touches the key (the storage pin, explore.test.tsx:864-866, gains it in Task 6); on native it is kept in memory until sub-project 5.
- After sending: the sheet closes at once, the success haptic fires, and the toast "Your post was sent" (or reply, or quote) offers "View", which opens `/post/<id>`. In a feed the reader is at the top of, the new post enters with new-own-post; elsewhere it is inserted at the top without moving the reader.

### 6.16 Toast and VisuallyHidden

- Toast: the API and rules of section 5.4; `<Toaster />` is mounted once in apps/app/src/app/_layout.tsx inside the theme provider, so toasts take the theme's surface-1, line and ink tokens and the text face.
- VisuallyHidden (kit/VisuallyHidden.tsx): text kept for assistive technology and off screen (1 px, clipped, absolute), used for the time link's words, the composer's count, list loading statuses and the skip link before it takes focus.

## 7. Layout

### 7.1 Breakpoints

apps/app/src/theme/layout.ts exports `useLayout()`, which reads useWindowDimensions() and returns one of four kinds. The 768 and 1024 px edges are today's (AppShell.tsx:16-17, `WIDE = 1024`, `MEDIUM = 768`); 1280 px is new.

| Kind | Width | Navigation | Timeline column | Context column |
|---|---|---|---|---|
| phone | below 768 px | bottom tab bar with icons and labels; floating compose button | the whole width, gutter 16 px | none |
| tablet | 768 to 1023 px | a rail 80 px wide: the "k" monogram, icons with 12 px labels under them, the New post button | 600 px, centred in the rest | none |
| desktop | 1024 to 1279 px | the 80 px rail | 600 px | 320 px |
| wide | 1280 px and wider | a full nav 240 px wide: the wordmark, icons with labels beside them, a full-width New post button | 600 px | 320 px |

- The three columns sit together, centred, 24 px apart, with line-low rules between them; at wide they take 1,208 px.
- The same components render at every width; only the shell changes. Sheets become dialogs at 768 px (section 6.8) and menus become popovers (section 6.9).
- The nav: Home, Bookmarks, Profile and Settings for an account, and Home and Sign in signed out, as today (AppShell.tsx:35-46, the same items and hrefs); signed out it gains a third item, Appearance (section 8.8), added by Task 8 with the route. The current item has `aria-current="page"` (pinned), an ink-high label in body-strong, its icon at stroke 2.25 (filled where the shape is closed, as Bookmark), an accent-wash pill and a shape mark that carries contrast: a 3 by 20 px accent bar above the icon in the tab bar, a 3 px accent bar at the item's start in the rail and full nav (6.72 to 8.54:1, the Tabs underline's language); the others are ink-low.
- Pressing the current Home item again scrolls Home's feed to the newest post (the soft reset of study 2.2 without a reload); the reader's marker and pill are kept.
- The tab bar and the compose button stay put while the list scrolls.

### 7.2 Phone

- A header bar at the top of each screen (surface, line-low bottom rule): the back button (IconButton "Back") on screens below the tabs, the screen's title in display-2 as its level-1 heading, and the screen's own controls (Home's tabs under the title). So the reading surface is not a quarter chrome, the header slides up out of view as the list scrolls down and returns on any scroll up or when focus enters it (header-hide, section 5.2); under reduced motion it stays.
- The compose button (signed in, on Home, a profile and Bookmarks) is a 56 px accent circle with the compose icon and the label "New post" (pinned), 16 px from the right and 16 px above the tab bar plus the bottom safe area.
- The tab bar is 56 px plus the bottom safe area, surface with a line-low top rule, its items (four for an account, three signed out) each an icon over a 12 px label.

### 7.3 Tablet, desktop and wide

- The rail or full nav is sticky at the left; its New post button opens the composer as a dialog everywhere but on Home, where it focuses the inline composer card.
- The timeline column holds the screen's header (title and tabs) at its top, which stays while the list scrolls under it, with a line-low rule appearing under it once the list has scrolled (no blur).
- The context column (desktop and wide), labelled "About korbat" as a complementary landmark: HandleBox with today's words, the label "Go to a profile" (HandleBox.tsx:26) and the field "Handle" (:29), then the card "How korbat works" with three short lines from ui-words.ts ("Following and Latest are in time order.", "korbat never lowers a post's reach in secret.", "The rules are public, and so is how they are enforced.") and links to /rules, /transparency and /explore/about. Popular now leaves it (decision 14).
- Auth screens, the three token pages and /terms get one shared public frame (PublicFrame in kit/): the wordmark at the top linking to /, the content column 440 px wide (terms 640 px), and a footer with links to /rules, /transparency and /terms. They stay outside AppShell, as their flows need, but no longer look like another app.

### 7.4 Safe areas and the keyboard

- react-native-safe-area-context 5.7.0, installed and unused today, gets its SafeAreaProvider in the root layout. The tab bar, the compose button, sheets and toasts pad by the bottom inset; headers by the top inset on native; public/index.html's viewport meta gains `viewport-fit=cover` so iOS Safari reports the insets.
- On web the browser moves content above the on-screen keyboard; sheets size with the visual viewport (the `dvh` unit through a style on web). Native keyboard tracking waits for react-native-keyboard-controller in sub-project 5; until then sheets use React Native's KeyboardAvoidingView.

### 7.5 Scrolling and the reader's place on web

- The web page keeps its fixed body (public/index.html: `body { overflow: hidden }`) and each list scrolls inside its column, as react-native-web's FlatList does today. The browser's own scroll restoration therefore does not apply, and korbat keeps the place itself.
- Prepending without a jump: every list scrolls through one wrapper, List (apps/app/src/components/list/List.tsx), which owns the FlatList props. Before it commits rows above the viewport it records the key of the first row in view and that row's distance from the viewport's top; after layout it moves the scroll position by the change, so the row stays exactly where it was. On web this runs in apps/app/src/components/list/anchor.web.ts on the scroll node (with `overflow-anchor: none`, so Chrome's own anchoring does not correct twice); on native FlatList's `maintainVisibleContentPosition` with `minIndexForVisible: 1` does it (anchor.ts).
- Within a session each feed keeps its rows, its cursor and its anchor in memory (apps/app/src/lib/feed-cache.ts), so switching Home's tabs, opening a post and coming Back return to the same row. Today a tab change remounts the list and reads page one again (index.tsx, homeListKey); the key now changes only with the reader (an account or signed out), never with the tab or a new post. Explore is not kept there: its answers stay in ExploreList's component state, as 2c's rule and explore.test.tsx:853-862 require, so returning to Explore reads it again.
- Focus order on web: a "Skip to the main content" link appears on the first Tab, then the nav, then the main column (screen title first), then the context column. Landmarks: navigation named "Main", main, complementary named "About korbat".

## 8. Screens

### 8.1 What every screen gets

- The shell of section 7 (AppShell, or PublicFrame for the auth flow, the token pages and /terms), its loading state inside the shell (skeletons, never the nav disappearing), its empty state with one action, its error state with "Try again", and the offline state.
- A document title on web through expo-router's Head (`expo-router/head`), "<what> - korbat", from `TITLE_WORDS` in ui-words.ts (decision 16), naming the kind of screen and never an account.
- One level-1 heading, its title.
- Times through one helper, apps/app/src/lib/time.ts, over Intl: `timeAgo` moves there from lib/social.ts (re-exported from social.ts so its callers and tests keep working), with `dayTime` ("Tue 18:40"), `fullDate` ("21 Oct 2026, 18:40") and `postedWhen`, the spoken form of timeAgo's short time, which always contains it: "posted just now", "3h ago", "on 12/10/2026".
- New words in apps/app/src/lib/ui-words.ts unless the area has a words module; the word tables below give each key and sentence. Words not listed keep their text; a file on `LEGACY_TEXT_FILES` (section 1.5) moves its bare sentences, word for word, into its area's words module in the task that rewrites it.

Words of the shell and the post card, used on every screen:

| Key | Sentence |
|---|---|
| shell.skip | Skip to the main content |
| shell.about | About korbat |
| shell.howTitle | How korbat works |
| shell.how1 | Following and Latest are in time order. |
| shell.how2 | korbat never lowers a post's reach in secret. |
| shell.how3 | The rules are public, and so is how they are enforced. |
| shell.back | Back |
| post.open | {when}, open the post (`when` from postedWhen) |
| post.reposted | {displayName} reposted |
| post.more | More options for this post |
| post.repost / post.unrepost | Repost / Undo repost |
| post.whoSees | Who sees this |
| post.copyLink | Copy link |
| post.reply / post.like / post.reposts | Reply, {n} replies / Like, {n} likes / Repost, {n} reposts (the number left out when zero or hidden) |
| post.reply.one / post.like.one / post.reposts.one | Reply, 1 reply / Like, 1 like / Repost, 1 repost |

### 8.2 Home (/), the feed

What changes:

- The list is built from typed rows (study 2.2) by a pure function, `feedRows()` in apps/app/src/lib/feed-rows.ts: `post` (a TimelineItem), `marker` (the boundary of what the reader has seen), `gap` (new posts not yet loaded between two loaded ones), `loadMore`, `loadMoreError`, `end`, and `skeleton`. Empty and error states are rows of the same list, so the header and tabs never move.
- Reading place (decisions 8 and 9): apps/app/src/lib/reading-place.ts keeps, per account and per feed (Following, Latest), `{ newest: { key, time }, top: { key, time }, savedAt }` in localStorage under `korbat.place.<accountId>`. `newest` is the newest row that has been at least half in view for half a second (FlatList viewability, which react-native-web implements too); `top` is the row at the top of the viewport. Both are written one second after scrolling stops and when the page is hidden. reading-place.ts is the only module that touches the key (the storage pin, explore.test.tsx:864-866, gains it in Task 5), and the key is cleared when the session ends (section 8.8, On this device).
- Opening a feed: the first page is read with `limit=50` (lib/social.ts's following and latest gain an optional limit; today they send a cursor alone, social.ts:33, :56-57). If the stored `top` row is in it, or in a second page of 50, the list opens with that row at the top, and the pill counts the rows above it that are newer than `newest`. Otherwise, or with "Open feeds at the newest post" on, it opens at the newest post. The marker row sits above the first row whose time is not newer than `newest`.
- The marker row: "You were here" in display-3, the time of the place in meta (dayTime within six days, fullDate after), and "Newer posts are above. Below are posts you have already seen." It says "You're all caught up", with the done icon drawing its check once per session (section 5.2, caught-up), only when that is true: when the reader reaches it scrolling down from above it, or when the pill's count reaches zero, where the pill leaves showing "You're all caught up" for 2 s (opacity only).
- New posts (decision 7): apps/app/src/lib/new-posts.ts asks the feed's first page (`limit=50`) 30 seconds after the feed opens and every 60 seconds after, only while Home is focused, the feed is the selected tab and the page is visible (AppState on native, document.visibilityState on web). Rows newer than the list's first row are inserted above it with the anchor of section 7.5, so nothing moves. When all 50 are new, a `gap` row follows them ("Show more new posts"), which reads pages from the 50th until it meets the old first row.
- The pill: floating 12 px under the header, centred, accent fill, the newer icon and "{n} new posts" (or "1 new post", or "50+ new posts"); its name adds "above, go to the first one". Pressing it scrolls to the oldest unread new post, the first post above the reader's place, not to the marker, until that post is at the top of the viewport (pill-jump), so the reader reads on upwards in time order; the count falls as rows come into view, and the pill leaves at zero. Pressing Home in the nav goes to the newest post instead.
- Paging (decision 6): "Load more" stays as the row at the end of each page. With "Load older posts automatically" on, the next page loads when the reader is within two screens of the end, until the marker row; below the marker, only the button loads. When the cursor runs out, the `end` row says "That's everything in Following." or "That's everything in Latest."
- The list keeps its key across tabs and new posts (section 7.5): Home's homeListKey takes the reader only; switching tabs swaps the list's source and restores Following's or Latest's rows and anchor from feed-cache (Explore is read again, section 7.5), and the reader's own new post is inserted at the top of Following and Latest.
- The inline composer at 768 px and wider is the collapsed card of decision 19; below 768 px the compose button opens the sheet.
- PasskeySuggestion becomes a card (surface-1, radius card) with its words unchanged, "Add a passkey" as a primary Button and "Not now" as a secondary one.
- Explore keeps its list, its header ("Updated N minutes ago", "How Explore works") and its footer, restyled; it has no marker and no pill, because it is ranked, and its header links to how it ranks, as today.

What stays: the tabs and their order, `?tab=` in the address, SIGNED_OUT_PROMPTS, the empty sentences, "Load more", "Try again".

States: loading, five Skeleton.Post rows; empty, EmptyState with the pinned sentence and an action ("Open Latest" on an empty Following, a button that calls Home's own `select`, not a `/?tab=` link, so explore.test.tsx:241-242's list of tab links stays); error, ErrorState in the list; signed out, Latest and Explore only, the sign-in prompt card, no marker, no pill and no stored place.

| Key | Sentence |
|---|---|
| feed.marker.title | You were here |
| feed.marker.body | Newer posts are above. Below are posts you have already seen. |
| feed.caughtUp | You're all caught up |
| feed.pill | {n} new posts |
| feed.pill.one | 1 new post |
| feed.pill.many | 50+ new posts |
| feed.pill.label | {visible} above, go to the first one |
| feed.gap | Show more new posts |
| feed.end.following | That's everything in Following. |
| feed.end.latest | That's everything in Latest. |
| feed.loading | Loading posts |
| feed.empty.following.title | Your Following feed is empty |
| feed.empty.following.action | Open Latest |
| feed.empty.latest.title | Nothing posted yet |
| title.home | Home - korbat |

Tests that change: explore.test.tsx:231 and :238 (the index.tsx lines they read: homeListKey keeps only the reader, and the list is a FeedList) and :239 (the empty sentence, read from its words module, section 1.5); the homeListKey cases in the same file (one argument, the reader). New: apps/app/test/feed-rows.test.ts (every row kind, the marker's place, the gap, automatic loading stopping at the marker), reading-place.test.ts (read, write, the 100-post window, cleared when the session ends), new-posts.test.ts (the schedule, visibility, the 50-row gap).

### 8.3 A post and its thread (/post/[id])

- Ancestors above the focused post as compact cards joined by a 2 px line-low thread line through their avatars; the page opens with the focused post at the top of the viewport and the ancestors above it, kept by the anchor of section 7.5 while they load (study 2.5).
- The focused post in the large variant of PostCard (section 6.6), with the stats line; the author's ExploreStatusLine stays under it, with its condition, its two links and its focus effect unchanged (explore.test.tsx:772-790).
- The reply composer stays inline under the focused post at every width, as a collapsed card ("Write your reply") that opens on focus; `?quote=1` still opens the composer sheet for a quote, and "Quote this post" stays as a secondary Button.
- Replies follow, oldest first, as today: the API orders them, and a sort control would need the replies route to sort (section 14).
- Tombstones keep their two sentences, in the italic text face on a surface-2 block.

States: loading, the focused post's skeleton; error, h1 "This post is not available" with "Back to the timeline" (both pinned); no replies, "No replies yet." (pinned); signed out, no composer and a line with a link.

| Key | Sentence |
|---|---|
| thread.signIn | Sign in to reply. |
| thread.stats | {reposts} reposts, {quotes} quotes, {likes} likes (each part left out when zero or hidden; a part of 1 reads "1 repost", "1 quote", "1 like") |
| title.post | Post - korbat |
| title.postMissing | Post not available - korbat |

Tests that change: report.test.tsx:244 (QuoteEmbed's links: the profile link, then the post link, the order the new author line gives).

### 8.4 A profile (/u/[handle]), its followers and following

- Header: Avatar (64 px on phones, 96 px wider), display name (display-2 on phones, display-1 wider), VerifiedChip, the handle in mono 700, the bio in the post variant, the follower and following counts as links (as today; with the hide-counts setting on, the links read "Followers" and "Following" without numbers, decision 15), and "Follows you" as a neutral chip.
- Controls: FollowButton, with its words and states unchanged, drawn as a primary Button while the reader does not follow and a secondary one while they do; it is optimistic like the post's actions (section 6.6): the state changes at once with the toggleOn haptic and a 160 ms cross-fade of the label (reduced: at once), and a refusal rolls back with the error haptic and the toast "Couldn't follow @{handle}. Try again." (or "Couldn't unfollow"); and IconButton More ("More options for @{handle}") with Mute or Unmute, Block or Unblock, and Report as a link to `/report?account=<handle>`, for anyone but the profile's owner, signed in or out (decision 12). The block question keeps its words and becomes a Sheet.
- Tabs: Posts, Replies and Likes (own profile only), on the Tabs component; the empty sentences stay.
- RefusedNotice stays where it is.
- Followers and following: ProfileList with ListRows (section 6.11), skeleton rows while loading, the pinned empty sentences.

States: loading, a header skeleton and three post skeletons; error, h1 "This account is not available" (pinned); signed out, "Sign in to follow this account." (pinned) under the header.

| Key | Sentence |
|---|---|
| profile.more | More options for @{handle} |
| title.profile | Profile - korbat |
| title.followers | Followers - korbat |
| title.following | Following - korbat |

Tests that change: report.test.tsx:248-256 (the profile's Report is in the More menu: the test renders the profile's menu open and finds the same link, still offered signed out and never to the owner); lifecycle.test.tsx:89 keeps its pattern `verified ? <VerifiedChip /> : null` in both files.

### 8.5 Bookmarks (/bookmarks)

- The header "Bookmarks" with "Private to you." (both pinned) under it beside the privacy icon; a PostList; the empty sentence pinned; skeletons inside the shell (today Loading sits outside it, bookmarks.tsx:15).

| Key | Sentence |
|---|---|
| bookmarks.empty.title | No saved posts |
| title.bookmarks | Bookmarks - korbat |

### 8.6 The composer (sheet, card and dialog)

- ComposeSheet becomes the Sheet of section 6.8 around the Composer parts of section 6.15: a bottom sheet with a handle below 768 px, a 640 px dialog wider up. Its title stays "New post", "Reply" or "Quote"; the compose button's label stays "New post"; the scrim's label stays "Close the composer" and it stays no tab stop; a running suspension still replaces the fields with the refusal (3e, 9.4).
- The discard question appears only when the draft has content, with its pinned words; closing an empty composer closes at once.
- Sending closes the sheet at once and shows the toast with "View" (section 5.4).

| Key | Sentence |
|---|---|
| composer.exif | korbat removes location and camera details from images. |
| composer.count | {n} of 1000 characters |
| composer.collapsed | What's on your mind? |
| composer.collapsedReply | Write your reply |
| toast.sent.post | Your post was sent. It is at the top of Home. |
| toast.sent.reply | Your reply was sent |
| toast.sent.quote | Your quote was sent |
| toast.view | View |
| toast.linkCopied | Link copied |
| toast.saved | Saved to Bookmarks |
| toast.failed.like | Couldn't like this post. Try again. |
| toast.failed.unlike | Couldn't remove your like. Try again. |
| toast.failed.repost | Couldn't repost this post. Try again. |
| toast.failed.unrepost | Couldn't undo the repost. Try again. |
| toast.failed.save | Couldn't save this post. Try again. |
| toast.failed.unsave | Couldn't remove this post from Bookmarks. Try again. |
| toast.failed.follow / toast.failed.unfollow | Couldn't follow @{handle}. Try again. / Couldn't unfollow @{handle}. Try again. |

Tests that change: none pin the "n/1000" text; the counter's words move to composer.count, tested in composer-state.test.ts.

### 8.7 The moderation surfaces

The author's chip and its details sheet:

- On the author's own withheld or removed post the StatusChip (review or restricted, section 4.8) keeps chipText()'s words and, when the decision is known, opens StatusSheet (apps/app/src/components/moderation/StatusSheet.tsx). A chip without a decision (audit 5.5, item 2) stays information only, as today.
- StatusSheet reads GET /api/moderation/decisions/:id when it opens (decision 11) and shows, in this order (but with the Appeal block first while an appeal is open), each as a labelled block: "Rule" (the rule's id and title at the decision's rules version from @korbat/rules, or "Illegal content" with the legal reference); "What it does" (the measures in the words DecisionDetail already uses); "Applies to" (this post, this image or this account: the scope said out loud, study 3.10); "Who can see it now" (from reach(), section 6.14); "Decided by" in role terms: "korbat's automated check" only for a decision without a decider, which DecisionView marks as `automatedDecision === "fully"` (packages/contracts/src/moderation.ts:2190-2197, the test DecisionDetail.tsx:398 uses for its "Taken by a program" chip; the case rows' `byProgram`, :1711 and :2265, is not on DecisionView), never from the field merely being set; "An authority's order" when `source === "order"`; otherwise "A korbat moderator" (a "partially" decision is an admin's); "When" (fullDate of decidedAt); "Statement" (the reason's first paragraph and a link "Read the full decision" to /settings/cases/<id>); "Appeal" (open: "You can appeal until {date}." with the primary Button "Appeal", which opens /settings/cases/<id>?appeal=1 with the appeal form focused; interim: the interim redress sentence DecisionDetail shows today; pending or answered: the existing appeal words; a program's decision: "Ask for a person" as DecisionDetail offers it).
- Loading shows skeleton blocks; an error shows ErrorState with "Try again".
- "Who sees this" in the More menu of every post (section 6.14).

What a reader meets:

- A hidden or sealed image stays the placeholder of HiddenImage.tsx with its words; it stays no button, as hidden-media.test.tsx:175-176 requires. When a post has a hidden image, the row under its grid (where the ALT toggle sits) gains one link, "Why are images hidden?", to the rules page (`/rules`), which explains moderation and its tools. Readers get no cover over a restricted post, because they never receive one (decision 10).

The case screens (/settings/cases and its four detail routes), the report form (/report), the report's status page (/notice/[ref]) and the standing banner:

- Restyled on the primitives: DecisionDetail's parts become cards with labelled blocks, the case's events a dated vertical list, NoticeStatusView's items ListRows, ReportForm's steps a stack of cards with one question each. Every sentence stays, from the words modules.
- /report and /notice/[ref] render inside AppShell with skeletons (today their Loading sits outside it).
- StandingBanner keeps its region, its level-2 first sentence and its words, on review or restricted wash with its icon.

| Key | Sentence |
|---|---|
| status.rule | Rule |
| status.does | What it does |
| status.appliesTo | Applies to |
| status.appliesPost | This post |
| status.appliesImage | This image |
| status.appliesAccount | Your account |
| status.whoSees | Who can see it now |
| status.decidedBy | Decided by |
| status.byPerson | A korbat moderator |
| status.byProgram | korbat's automated check |
| status.byOrder | An authority's order |
| status.when | When |
| status.statement | Statement |
| status.readAll | Read the full decision |
| status.appeal | Appeal |
| status.appealUntil | You can appeal until {date}. |
| media.whyHidden | Why are images hidden? |
| reach.public | Public. Anyone can read it, including people who are not signed in. |
| reach.blocks | Accounts you blocked do not see it in their feeds, but anyone signed out can still read it. |
| reach.ownLists | It shows in Latest and in your followers' Following, in time order. |
| reach.inExplore | Also in Explore. |
| reach.exploreOff | Not in Explore: you turned Explore off. |
| reach.suspended | Not in Explore while your account is suspended. |
| reach.ownReply | Public. Shown in the thread and on your Replies tab. Replies never enter Explore. |
| reach.onlyYou | Only you and korbat's moderators can see it. |
| reach.order | Removed for everyone else by an authority's order. |
| reach.never | korbat never lowers a post's reach in secret. Following and Latest are in time order. |

These words go to lib/moderation-words.ts (status.*) and ui-words.ts (reach.*, media.*).

Tests that change: cases.test.tsx:590-599 (the chip is a button that opens the sheet: the test renders StatusSheet with a DecisionView and finds `/settings/cases/<id>` there; the amber and surface lines it reads become `const tone = decision ? (decision.interim ? "review" : "restricted") : post.state === "withheld" ? "review" : "restricted";` and the StatusChip line, which the test reads instead); announced.test.tsx:175 (StandingBanner's tone line becomes the wash line) is Task 3's, which rewrites StandingBanner.tsx; new: status-sheet.test.tsx (each block for an interim, a final open, a pending, an answered, a program's and an order's decision; "Decided by" for `automatedDecision` fully, partially, not_automated and absent), reach.test.ts.

### 8.8 Settings

A new page, Appearance and accessibility (/settings/appearance, apps/app/src/app/settings/appearance.tsx):

- It is the one settings page a signed-out reader can open: settings/_layout.tsx lets this route through signed out, and the signed-out nav gains it after Sign in. Signed in, it shows `<SettingsNav current="appearance" />` like every settings screen but the index.
- The choices, each applied at once with no Save button, kept in localStorage under `korbat.appearance` on this device (theme-boot.js reads the same key) and in memory on native until sub-project 5:
  - Theme: a radio group, System, Light, Dim, Dark (default System); under System, "Dark style": Dim or Dark (default Dark).
  - Text size: Smaller, Default, Larger, Largest, with a sample post that follows the choice.
  - Font: korbat fonts, or System font.
  - Reduce motion: Follow the system, or Always.
  - Haptics: a switch, on by default, shown on iOS and Android only.
  - Reading: three switches, off by default: "Load older posts automatically", "Open feeds at the newest post", "Hide like, repost and follower counts".
  - No autoplay choice: korbat has no moving media (decision 17).
- On this device: the page ends with a block that lists what korbat keeps in this browser (device.body) and a secondary Button "Clear what this device keeps", which removes the appearance, the reading places and the drafts at once (the theme returns to System) and confirms with the toast "Cleared". The same three are cleared whenever the session ends: SessionProvider (apps/app/src/lib/session.tsx), where every end arrives, clears `korbat.appearance` and every `korbat.place.*` and `korbat.drafts.*` key, whatever the account, through the three modules' own clear functions, when its state moves from signed-in to signed-out and when its first /api/me answers 401 while a reading place or a draft is stored (a session revoked, expired or signed out elsewhere while the app was closed). That covers the app's real sign-outs, `signOut()` in app/settings/security.tsx:23-27 and `signOutEverywhere()` in components/security/SessionsSection.tsx:37-45, which both call the provider's refresh() and get 401 from /api/me, the lockdown pages, and any other 401, which reaches the provider's unauthenticated handler (session.tsx:62-65, fed by lib/api.ts:233). The device id (lib/api.ts) and the passkey card's "Not now" (lib/passkeys.ts) stay: they belong to the browser, not to an account. The terms' "Your data" gains the same list, joining the draft without a new TERMS_VERSION as 2c's to 3f's sentences did; terms.test.tsx holds it to the stores (Task 8).
- SettingsNav gains "Appearance" as its first entry. The nav's Settings item (AppShell.tsx:39, `/settings/security` today) opens a new Settings index, /settings (apps/app/src/app/settings/index.tsx): ListRows for Appearance (first), Security, Privacy, Profile, Account and Cases, each with its icon, so the page a newcomer looks for is the first thing Settings shows. It is the one settings screen without SettingsNav, since it is the list; signed out the layout still sends it to /signin, and the nav's own Appearance item is the way in.

The other settings pages (security, privacy, profile, account) keep their sections, words and flows, restyled: each Section becomes a card group of ListRows and fields; SessionsSection lists devices as ListRows with "this device" as a neutral chip; the Explore switch keeps its exact line in privacy.tsx (explore.test.tsx:718), passed to a ListRow as its control, with its track colours from the theme instead of hex literals; the Blocked and Muted tabs use Tabs.

| Key | Sentence |
|---|---|
| appearance.title | Appearance and accessibility |
| appearance.nav | Appearance |
| appearance.theme | Theme |
| appearance.system | System |
| appearance.light | Light |
| appearance.dim | Dim |
| appearance.dark | Dark |
| appearance.darkStyle | Dark style |
| appearance.textSize | Text size |
| appearance.smaller | Smaller |
| appearance.default | Default |
| appearance.larger | Larger |
| appearance.largest | Largest |
| appearance.sample | This is how posts will read. |
| appearance.font | Font |
| appearance.korbatFonts | korbat fonts |
| appearance.systemFont | System font |
| appearance.motion | Reduce motion |
| appearance.followSystem | Follow the system |
| appearance.always | Always |
| appearance.haptics | Haptics |
| appearance.reading | Reading |
| appearance.autoLoad | Load older posts automatically |
| appearance.openNewest | Open feeds at the newest post |
| appearance.hideCounts | Hide like, repost and follower counts |
| device.title | On this device |
| device.body | korbat keeps your appearance choices, where you stopped reading in Following and Latest, and drafts you have not sent in this browser until you sign out. A random device id, which tells a new device from a known one at sign-in, and your Not now on the passkey card stay. |
| device.clear | Clear what this device keeps |
| toast.cleared | Cleared |
| title.settings | {page} - Settings - korbat |
| title.settingsIndex | Settings - korbat |

Tests that change: lifecycle.test.tsx:41-73 (PAGES gains "appearance", as SettingsNav.tsx:5's SettingsPage type does; the row's anchors gain /settings/appearance first); cases.test.tsx:278-279 (SettingsNav's hrefs gain /settings/appearance first); lifecycle.test.tsx:58-73 (every settings screen shows the row, except settings/index.tsx, the index that lists them); explore.test.tsx:707-718 keep their lines; a11y.test.tsx:130-133 still finds every Switch labelled. New: appearance-page.test.tsx (each choice on the page written to the store, the sample post following the text size, the page signed out without SettingsNav's links); the store itself and theme-boot.js are Task 1's appearance.test.ts.

### 8.9 Public pages (/rules, /transparency, /explore/about, /terms)

- An editorial reading layout: a 640 px column, Fraunces for the page title (display-2) and section headings (display-3), the text face at the post size for prose, tables read as label and value rows below 768 px (3d design :2745), the change logs as dated lists.
- /rules, /transparency and /explore/about stay inside AppShell; /terms moves into PublicFrame. Their states ("loading", "down") and every sentence stay; their h1 and h2 elements stay (explore.test.tsx:656).

| Key | Sentence |
|---|---|
| title.rules | Rules - korbat |
| title.transparency | Transparency - korbat |
| title.exploreAbout | How Explore works - korbat |
| title.terms | Terms - korbat |

### 8.10 Sign-in, sign-up and the token pages

- (auth)/signin, code, password, mfa, age and handle, and email-revert/[token], not-me/[token] and passkey-remove/[token], move into PublicFrame (section 7.3). Their fields, buttons, links, words and flows stay; "Sign in with a passkey" stays under the email field as a secondary Button with the passkey icon (KeyRound, added to icons.ts as `passkey`). The Turnstile widget follows the theme (section 4.2).
- The six-digit code field (code.tsx) and the TOTP field (mfa.tsx) use the mono face with one-time-code autofill as today.
- The handle step keeps one step; it gains a live preview of the handle in the mono face, so the reader sees how it will look.

| Key | Sentence |
|---|---|
| title.signin | Sign in - korbat |
| title.code | Check your email - korbat |
| title.password | Sign in with a password - korbat |
| title.mfa | Two-factor authentication - korbat |
| title.age | Almost there - korbat |
| title.handle | Choose your handle - korbat |
| title.token | korbat |

Tests that change: passkeys.test.tsx:458 keeps `<Field label="Email" autoComplete={EMAIL_AUTOFILL}` in signin.tsx.

### 8.11 Errors, not found, offline

- Not found: a new apps/app/src/app/+not-found.tsx inside AppShell: EmptyState "This page doesn't exist" with "Go to Home". Caddy still answers every path with the shell (try_files), so this is what a mistyped address shows.
- A branded error boundary: apps/app/src/app/_layout.tsx exports expo-router's ErrorBoundary, which renders inside PublicFrame "Something went wrong on this screen", "Try again, or go back to Home." (it promises nothing it cannot check: the boundary does not know what a broken screen had sent), "Try again" (the boundary's retry) and "Go to Home". Nothing about the error leaves the device.
- Offline: lists and screens show ErrorState's offline form (section 6.12); on web a polite status banner "You're offline" sits at the top of the main column while navigator.onLine is false and leaves when it returns.
- Notifications do not exist today and stay out of scope until 2d.

| Key | Sentence |
|---|---|
| notFound.title | This page doesn't exist |
| notFound.action | Go to Home |
| crash.title | Something went wrong on this screen |
| crash.body | Try again, or go back to Home. |
| crash.retry | Try again |
| offline.title | You're offline |
| offline.body | korbat will load this when your connection is back. |
| title.notFound | Page not found - korbat |

## 9. The staff console

The console is restyled in apps/admin/src/app.css, within its policy (section 3.3), with the app's colour roles so the two read as one family, and red kept as the console's own mark.

- Tokens: the :root block and its `@media (prefers-color-scheme: dark)` twin gain the app's role names, `--surface`, `--surface-1`, `--surface-2`, `--line-low`, `--line-high`, `--ink-high`, `--ink-medium`, `--ink-low`, `--accent` (a fill), `--on-accent`, `--accent-ink` (text), `--focus`, and the `--review-*`, `--restricted-*` and `--ok-*` triples. The neutrals are the app's Light and Dark values (section 4.2). The accent stays red: #991B1B in light (white on it 8.31:1, and 7.66:1 as text on the Light surface) and #D13438 in dark (white on it 4.93:1), with `--accent-ink` #FF7B72 in dark; the focus ring stays blue (#2563EB light, #60A5FA dark), distinct from the red. The old names (`--bg`, `--fg`, `--muted`, `--line`, `--panel`, `--accent-fg` (app.css:13, :126), `--error-*`, `--notice-*`) stay as aliases in the same blocks, so rules move over one by one; the existing `--ok-bg` and `--ok-fg` (app.css:18-19) become two of the `--ok-*` triple, keeping their names.
- Type, on the system stack (decision 2): body 0.9375rem with line height 1.5; h2 1.5rem 700 with -0.01em tracking; h3 1.125rem 700; meta 0.8125rem in `--ink-low`; ids, handles, digests and clocks in `ui-monospace, "Cascadia Mono", Consolas, monospace` with `font-variant-numeric: tabular-nums`.
- Dense tables: 40 px rows at 600 px and wider, `--line-low` rules, no zebra, `thead` sticky only where the table's block does not scroll vertically (so it never covers a row the walk clicks), numbers right-aligned in tabular figures, a `--surface-2` row hover under `(hover: hover) and (pointer: fine)` only. Below 600 px the existing rule turns tables into blocks, as the browser walk expects.
- Keyboard first: the focus rule (app.css:138-143) extends from a, button and input to select, textarea, summary and `[tabindex]`, 2 px `--focus` with a 2 px offset; nothing removes an outline without that replacement.
- Status: banners (`.banner.suspect`, the standing and order banners) take the review or restricted wash with a 4 px rule at the start and their words first; nothing in the console says a state by colour alone.
- Motion: only `background-color` and `border-color` transitions of 120 ms on hover and focus, inside `@media (prefers-reduced-motion: no-preference)`; nothing moves.
- What does not change: every class name and the order of elements that the unit tests pin (56 class attributes) and the browser walk finds (about 35 selectors), no img or svg in the page but the evidence image, no style attribute, no other CSS file (source.test.ts), the masthead's h1 "korbat staff console" and the nav named "Console". No library is added. No skip link is added either: the walk's inspect() accepts only the console's own paths as links, and the nav is nine links long.

Screen by screen:

- Masthead and nav (Layout.tsx): surface-1, the 4 px red top rule kept, nav links as quiet tabs, the current one styled through `a[aria-current="page"]` in `--accent-ink` with an underline (no class on nav.tsx's links); the who line and IdleNotice in meta.
- Sign-in and Enroll: one 440 px card centred, the key's state as a labelled block.
- Home: the overview lines as a stack of panels, each a title, a count in tabular figures and its link; alerts first.
- Queue and Appeals: dense tables by lane, each lane's heading with its count; the phone blocks as today.
- Case and its Composer: from 1200 px two columns, the snapshot, frames and evidence on the left and the composer in a sticky column on the right with `max-height: 100vh; overflow-y: auto`, so its lower controls can always be scrolled into the 1280 by 900 viewport the walk uses; frames keep their quoted text with a 3 px `--line-high` rule at the start; the preview sits on `--surface-1`.
- Uploads, Standing, Contact, Restore: lists of blocks with a label above each value.
- Orders and Order: the one-hour clock large in the mono stack, `--restricted-ink` with the word "overdue" when it has passed.
- Audit: the chain in the mono stack, one row per entry, digests wrapping by character.
- Unavailable: one centred sentence.

Tests: a new apps/admin/test/contrast.test.ts parses app.css's two :root blocks and checks every text and control pair it declares at 4.5:1 and 3:1, as the app's test does. No existing test changes; any class a screen needs in addition is added with its unit test in the same commit.

## 10. Accessibility

The bar is WCAG 2.2 AA, checked three ways.

- Unit scans (apps/app/test/a11y.test.tsx, extended): the existing scans; no bare string literal as a JSX text child (section 1.5); no raw palette class or hex colour outside tokens.ts (contrast.test.ts); Button, IconButton, ListRow, Menu items and Tabs take `label: string` as a required prop, so tsc refuses a nameless control; no `outline-none` class without a `focus-visible:outline` beside it, and no `focus-visible:ring` anywhere in src (a box-shadow ring vanishes in forced colours).
- Render checks (react-dom/server): PostCard is `role="article"` labelled by its author line; its one link to the post has a name that contains its visible time; every Sheet is a dialog named by its title; StatusChip has its three forms (image, link, button with aria-haspopup), and section 4.8's never-colour-alone rule is tested (kit.test.tsx, Task 2): the four tones map to four different icon names, every chip renders its icon and a non-empty label, and chipText() is never empty; Tabs keep tablist, tab and aria-selected; IconButton's count is not part of its name; the Lightbox keeps its button names.
- The browser check (section 12.3): keyboard only, visible focus, focus return, contrast as drawn, 360 px reflow, 44 px targets for controls and 24 px for inline links.

Focus order and focus moves:

- Web: the skip link, the nav, the main column (its h1 first), the context column. Within a post: author, chips, reply context, body links, media, quote, actions, More. A feed's list follows the WAI-ARIA feed pattern: `role="feed"` (aria-busy while a page loads), each article with aria-posinset and aria-setsize (-1 while more can load), and Page Down and Page Up move focus to the next and previous article's open link; these are not single-character shortcuts, so they need no off switch.
- Opening a Sheet or Menu moves focus into it; closing returns it to the opener; after a delete the focus goes to the next post's open link, or to the screen's title when none is left; after sending, the focus returns to the composer's opener and the toast, announced politely, says where the post is ("Your post was sent. It is at the top of Home."), so its "View", reachable with Alt+T, is a convenience and not the only route.

Names a screen reader hears (the main ones; all words from the words modules):

| Control | Name |
|---|---|
| Post (article) | "{displayName}, @{handle}, {time ago}" |
| The post's link | "{when}, open the post" ("3h ago", "posted just now", "on 12/10/2026") |
| Reply, Repost, Like | "Reply, {n} replies", "Repost, {n} reposts", "Like, {n} likes", with singulars ("Like, 1 like"); no number when zero or hidden; Like and Repost also aria-pressed |
| Save | "Save" or "Saved" |
| More | "More options for this post" |
| New-posts pill | "{n} new posts above, go to the first one" |
| Author's chip | chipText(), a button that opens a dialog |
| Compose button | "New post" |
| Lightbox | "Close the image viewer", "Previous image", "Next image" |

Live regions: toasts (polite, section 5.4); the pill announces "{n} new posts above" politely when it first appears, never on later count changes; list loading statuses (polite); the composer's count at 900 and 1000 (polite); the offline banner (polite); ErrorText and form errors (role alert), as today.

Contrast: the token tests of sections 4.2 and 9, and the browser check's sampling of text as drawn. Text size: Largest with the root font-size at 200 percent must lose no content or control (1.4.4), checked at 320 px (1.4.10's width); 360 px must not scroll sideways either. Motion: section 5's reduced forms. Forced colours: floating layers and chips keep borders.

## 11. Performance

### 11.1 Lists

- FlatList stays on every platform (react-native-web renders it through the same VirtualizedList, which windows rows on web too); no list library is added (libraries A.5). The List wrapper (section 7.5) owns the tuning in one place, after Bluesky's PostFeed (study 2.2): `initialNumToRender` = window height / 120 rounded up, plus 1; `windowSize` 9 on native and 7 on web; `maxToRenderPerBatch` 5; `updateCellsBatchingPeriod` 40; `removeClippedSubviews` on Android only; `onEndReachedThreshold` 2 when automatic loading is on.
- Rows are memoised by key and by a version the post's own updates bump, so a like re-renders one card.
- A feed keeps at most 300 rows in memory; past that, rows farthest from the viewport on the older side are dropped and come back through "Load more". Long sessions therefore keep a bounded DOM (study 3.4).
- If profiling in a later sub-project shows FlatList cannot hold 60 frames per second on a mid-range phone, @legendapp/list 3.6.0 is evaluated in a spike with a prepend test (libraries A.5); this design does not need it.

### 11.2 Images

- The grid draws each image's small size and the lightbox its large size, the two sizes 2b produces; expo-image keeps its blurhash placeholder, `recyclingKey` set to the media id inside lists, and `priority` high for the first two rows only.
- Every image box has its size before the image loads (the ratio from the media view), so nothing shifts.

### 11.3 Budgets

With `web.output: "single"` every route loads the same entry bundle, so the per-route bundle budget is the entry budget; what differs per route is its first requests.

| Budget | Number | Measured on |
|---|---|---|
| JavaScript, all files under _expo/static/js/web | at most 480 KB gzip; if the export of main 1222b87, measured by Task 1's first step and written to apps/app/test/browser/baseline.json, where the budget test reads it, is already above 400 KB, the cap is that baseline plus 80 KB and the README records it | `expo export` output |
| CSS | at most 40 KB gzip | the same output |
| Fonts loaded on a latin page | at most 320 KB (the latin files of the three families; if Fraunces' `full` file alone breaks it, Task 1 takes its `wght` file and drops the SOFT and WONK settings) | the woff2 files fonts.web.ts names |
| API requests before a route's first content | at most 3 (for example /api/me, the timeline page, and nothing else) | the browser check's request log |
| Time to the first post on the fixture API | under 2.5 s at 1280 px on the check's machine | the browser check |

The budget test lives in the app's browser check (section 12.3): after the export it sums the gzip sizes and fails over a cap; the request count and the time are asserted on Home, a post, a profile and /rules.

## 12. Testing

### 12.1 What stays

The app's unit tests keep rendering through react-dom/server with react-native-web (apps/app/vitest.config.mts), now resolving `.web.tsx` first, with apps/app/test/setup.ts (Task 2) mocking once for every file the native modules that never load in Node (Reanimated, gesture-handler, safe-area-context, expo-haptics, expo-router/head, lucide-react-native); every source pin that a task rewrites changes in that task's commit and keeps what it protects (sections 3.2 and 8). The console's unit tests and its browser walk keep running unchanged except for section 9's new contrast test.

### 12.2 What each task proves

- Tokens and theme (Task 1): contrast.test.ts (every pair, every theme; global.css equals THEMES), theme.test.ts (fonts present, unicode-ranges, licences, the text-step maths), appearance.test.ts (the store, theme-boot.js's resolution of each stored value run in a vm context).
- Primitives (Task 2): every existing test file passing on setup.ts's shared mocks; render tests of its kit components' roles, names and states, useHaptics() mapping and its off switch, useMotion() with each reduce source, compactCount().
- Shell (Task 3): the toast API (a fake toaster), nav items and aria-current at each layout kind, the context column's contents, PublicFrame, the not-found screen, the error boundary, titles.
- Posts and media (Task 4): Sheet's and Menu's roles, names, focus and Escape; PostCard's article, link, actions, optimistic update and rollback (a fake social client that answers or refuses), menus, delete hand-off; reach.test.ts; MediaGrid and Lightbox names.
- Feeds (Task 5): Tabs' roles and roving focus; feed-rows.test.ts, reading-place.test.ts, new-posts.test.ts (fake timers), feed-cache.test.ts, the anchor maths of anchor.web.ts as a pure function.
- Composer (Task 6): composer-state.test.ts (every transition), drafts.test.ts, the sheet's discard question only with content, the sent toast.
- Moderation and public pages (Task 7): status-sheet.test.tsx, the hidden-image link, the restyled case screens' words.
- Settings and auth (Task 8): the appearance page, the Settings index, the settings row with Appearance, the auth screens in PublicFrame, the Turnstile theme (Task 1's) kept, the emptied colour and Text allowlists, the terms' list of what the device keeps.
- Console (Task 9): its contrast test and its full browser walk.

### 12.3 The app's browser check

Decided: the app gains one (decision 20).

- Files: apps/app/vitest.browser.config.mts (Node environment, TZ UTC, a 600 s hook timeout for the export), apps/app/test/browser/app.browser.ts (the walk), fixture-api.ts (the API answers the walk needs: /api/me signed in and out, the timelines with cursors and a "new posts" switch, a post and its thread, a profile and its lists, Explore, a decision, the public facts, and one 2 by 2 WebP image), server.ts (serves the export with the headers of the Caddyfile's app_page_headers, read from infra/caddy/Caddyfile by a helper, apps/app/test/browser/caddyfile.ts, as apps/admin/test/caddyfile.ts does for the console), watch.ts (fails on any policy report, console error or warning, page error, dialog or unexpected failed request, after apps/admin/test/browser/watch.ts).
- The build: `expo export --platform web --output-dir <temp>`, once per run, with `EXPO_NO_DOTENV=1` and every EXPO_PUBLIC_* variable set in the child's environment for the check (EXPO_PUBLIC_API_URL the empty string, which lib/api.ts:8 keeps, so calls go to the fixture server's own origin; Cloudflare's published Turnstile test site key), so the developer's apps/app/.env is never read.
- No internet: the walk answers https://challenges.cloudflare.com/* through `context.route` with a small stub of the Turnstile script that calls the widget's callback with a test token, and watch.ts counts that origin as expected; the check needs no network and no stack.
- The browser: playwright-core 1.63.0 as a devDependency of apps/app (already in the lockfile), driving the Chromium build it names or `KORBAT_BROWSER_CHANNEL`; it never runs `playwright install`. The script is `pnpm --filter @korbat/app test:browser`, which runs `vitest run --config vitest.browser.config.mts` (.mts like the unit config, since apps/app/package.json has no "type": "module").
- The matrix, grown by each task with its own screens (section 13: Task 3 the shell and the routes that exist, Task 4 lightbox, like and follow, Task 5 pill and place, Task 6 composer, Task 7 status sheet, Task 8 Appearance and the theme steps), without running every step everywhere: the full walk (every route of section 8, signed out and signed in) at 1280 by 900 in Dark; the layout steps (shell, Home, a post, a profile, the composer, a sheet, Appearance, /rules) at 360 by 740, 768 by 1024 and 1280 by 900; the theme steps (contrast sampling on Home, a post, the status sheet, Appearance and /rules) in Light, Dim and Dark; one text-size step at 320 by 640 with Largest and the root font-size at 200 percent on Home, a post, the composer and Appearance (no horizontal scroll, no label clipped in width or height); the motion steps (sheet, lightbox, like, follow, pill) once with `reducedMotion: "reduce"`, once without, and once with korbat's own "Reduce motion: Always".
- What it asserts: no policy report and no error on any step; at 360 px no horizontal scroll, no clipped label (scrollWidth against clientWidth) and the app's own target rule, phoneProblems in apps/app/test/browser/watch.ts after the console's: every control at least 44 by 44 px, except an `a` laid out inline inside a text block (computed display inline, in a parent that is not a flex row of controls: a link in a post body, a mention, "Replying to", the author line, a link in a notice), which needs 24 by 24 px under WCAG 2.5.8, and an element clipped to 1 px by VisuallyHidden, which is skipped until it takes focus and then measured; keyboard only, Tab reaches the skip link, the nav, the title and the first post's open link in that order, every focused element shows an outline (outline-style not none) of at least 2 px, Escape closes every sheet and focus returns to its opener; every text element in the main column, sampled against its nearest opaque background, meets 4.5:1 (3:1 at 24 px and up, or 18.66 px bold); under reduced motion a sheet and the lightbox show no transform between frames, and without it they do; the first paint (the bundle held back by the fixture server for 2 s) already has the stored theme's html class and background; at 360 px a toast's action and the compose button do not intersect; the "N new posts above" pill appears after the fixture adds posts, and the post at the top of the viewport has not moved; the budgets of section 11.3.
- Screenshots of each layout step are written to the temporary folder for the walk-through and never compared pixel by pixel.

### 12.4 Gates

- Every task: `pnpm --filter @korbat/app typecheck`, `pnpm --filter @korbat/app test`, and for Task 9 `pnpm --filter @korbat/admin typecheck` and `test`.
- From Task 3 on, the tasks that end a batch also run `pnpm --filter @korbat/app test:browser`; Task 9 runs `pnpm --filter @korbat/admin test:browser`.
- Batch ends run the runner's whole integration suite, as every sub-project's batches do.

## 13. Tasks

Ten tasks in build order, in four batches: Tasks 1 to 3, 4 to 6, 7 and 8, and 9 and 10. Each task adds its packages at the pins of section 1.8, updates in its own commit the source pins of the files it rewrites, removes its files from the legacy allowlists of sections 1.5 and 4.2, and runs the gates of section 12.4.

**Task 1. Tokens, fonts, Text, Icon and the theme switch.** Goal: the design language in code, and the theme from the first frame. Its first step measures the web export of 1222b87 and writes apps/app/test/browser/baseline.json (section 11.3). Creates apps/app/src/theme/tokens.ts, cn.ts, layout.ts, motion.ts, fonts.ts, fonts.web.ts, ThemeProvider.tsx, apps/app/src/lib/appearance.ts (the store of section 8.8), apps/app/src/components/kit/Text.tsx (rem on web through one typed helper, section 4.3), Icon.tsx (lucide-react-native), Icon.web.tsx (lucide-react), apps/app/src/components/icons.ts (names as strings), apps/app/public/theme-boot.js, apps/app/assets/fonts/LICENSES/ (the three licence files). Changes apps/app/package.json (lucide-react, lucide-react-native, react-native-svg, class-variance-authority, clsx, the three @fontsource-variable packages), pnpm-lock.yaml, tailwind.config.js, global.css, metro.config.js (adds woff2 to `resolver.assetExts` before withNativeWind; neither Metro's nor Expo's default list has it), vitest.config.mts (web extensions first), public/index.html (theme-boot.js, color-scheme, viewport-fit), src/app/_layout.tsx (ThemeProvider, fonts), (auth)/signin.tsx, password.tsx and components/moderation/ReportForm.tsx:257 (Turnstile theme). Tests: contrast.test.ts, theme.test.ts, appearance.test.ts. Tests that change: explore.test.tsx:864-866 (the storage list gains lib/appearance.ts). Not a batch end; no stack rebuild.

**Task 2. Primitives, haptics, motion and the test mocks.** Goal: the owned components of section 6 that screens build on; Sheet and Menu come with their first users in Task 4, Tabs in Task 5 and the toasts in Task 3, so this task is not twice the size of those after it. Creates kit/IconButton.tsx, Avatar.tsx, ListRow.tsx, Skeleton.tsx, EmptyState.tsx, ErrorState.tsx, StatusChip.tsx, VisuallyHidden.tsx, PublicFrame.tsx, lib/haptics.ts, lib/motion.ts, lib/time.ts, lib/format.ts (compactCount), lib/ui-words.ts, and apps/app/test/setup.ts, named in vitest.config.mts's `test.setupFiles`: one set of mocks for what never loads in Node (react-native-reanimated with useReducedMotion, Animated.View and Text, useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS and the layout animations used; react-native-gesture-handler with GestureDetector and GestureHandlerRootView as pass-throughs and a chainable Gesture.Pan; react-native-safe-area-context with a pass-through provider and zero insets; expo-haptics; expo-router/head; lucide-react-native). Changes components/ui.tsx (on the kit, export names and the lines lifecycle.test.tsx:240-241 pins kept), package.json (expo-haptics), and the twelve test files whose one-export Reanimated mock (`useReducedMotion` only) moves onto setup.ts: announced, appeals, automated, cases, explore, hidden-media, image-fault, orders, public-pages, report, reporting and standing (.test.tsx). expo-router stays mocked per file; a task that makes a screen import a new expo-router name adds it to the mocks of the files that render that screen. Tests: kit.test.tsx (roles, names, states of each component), a11y.test.tsx (the bare-string scan with `LEGACY_TEXT_FILES`, the outline rule), haptics.test.ts, motion.test.ts, format.test.ts. Not a batch end; no stack rebuild.

**Task 3. The shell, navigation and the app's browser check.** Goal: the layout of section 7 on every screen, and the check that guards everything after it. Creates components/toast.tsx, toast.web.tsx, components/AboutCard.tsx (How korbat works), lib/page-title.tsx (usePageTitle over expo-router/head; each later task gives its screens their titles), app/+not-found.tsx, apps/app/vitest.browser.config.mts, test/browser/app.browser.ts, fixture-api.ts, server.ts, watch.ts, caddyfile.ts. Changes components/AppShell.tsx (rail, full nav, tab bar with icons, context column, safe areas, skip link, offline banner), SettingsNav.tsx, StandingBanner.tsx, HandleBox.tsx, app/_layout.tsx (GestureHandlerRootView, SafeAreaProvider, Toaster, ErrorBoundary), bookmarks.tsx, report.tsx, notice/[ref].tsx, followers.tsx, following.tsx (loading inside the shell), lib/session.tsx (SessionFailure on ErrorState, off LEGACY_COLOUR_FILES), package.json (sonner, sonner-native, playwright-core dev, the test:browser script), lib/social.ts (the `popular` call, left without a caller); deletes components/PopularNow.tsx (decision 14). Tests that change: explore.test.tsx:823-839 and hidden-media.test.tsx's "Popular now" block (removed with the component; the case they share, an image-only post named by its image's description, moves onto ExploreList's rendering in the same files), explore.test.tsx:241-242 (the `/?tab=` links are app/explore/about.tsx's only) and :853-862 (Explore's callers lose PopularNow.tsx; the files read become four), announced.test.tsx:175; standing.test.tsx:120 (AppShell's StandingBanner line) kept. New: shell.test.tsx (nav at each layout kind, the context column, PublicFrame, not-found, the error boundary, titles, the toast API with a fake toaster). Batch end (Tasks 1 to 3); stack task: the Caddy image is rebuilt with the new export, and the smoke test, scripts/smoke-auth-stack.mjs (changed in this task), loads /, /theme-boot.js (no-cache), a font under /assets/ (immutable; its hashed URL is the first `/assets/...woff2` string in the entry bundle that index.html names) and /post/<id> with its 200 and 404.

**Task 4. The post, its media and the lightbox.** Goal: section 6.6, 6.7 and 6.14. Changes components/social/PostCard.tsx, RichText.tsx, MediaGrid.tsx, MediaViewer.tsx, HiddenImage.tsx, ImageFault.tsx, ProfileList.tsx (FollowButton optimistic, section 8.4), lib/social.ts (per-kind request lanes; compactCount is Task 2's); creates kit/Sheet.tsx, kit/Menu.tsx (with their kit.test.tsx cases), lib/reach.ts, components/social/PostMenu.tsx, WhoSeesThis.tsx; adds the lightbox, like and follow steps to test/browser/app.browser.ts and their answers to fixture-api.ts. The author's chip moves onto StatusChip in its link form, still opening /settings/cases/<id>; Task 7 turns it into the button that opens the details sheet. Tests that change: report.test.tsx:209-219 (Report in the More menu, rendered open), :237-246 (MediaGrid and QuoteEmbed lines and link order), cases.test.tsx:598-599 (the chip's tone and StatusChip lines), a11y.test.tsx:135-140 (the focus returns to More), explore.test.tsx:855 (Explore's callers gain WhoSeesThis.tsx, which keeps the status in component state under the same no-storage check; the files read are five again), hidden-media.test.tsx:144 (Reply is an icon now, so the quote's sentence is ordered before the Reply button's tag, the index of `aria-label="Reply`, in the markup rather than the stripped text), hidden-media.test.tsx:175-176 kept. New: post-card.test.tsx (article, the link's name in each postedWhen form, names at 0, 1 and many, optimistic update and rollback of the actions and of FollowButton, menus), reach.test.ts. Not a batch end; no stack rebuild.

**Task 5. Feeds, threads and profiles.** Goal: section 8.2 to 8.5. Creates kit/Tabs.tsx (with its kit.test.tsx cases), components/list/List.tsx, anchor.ts, anchor.web.ts (section 7.5), lib/feed-rows.ts, reading-place.ts, new-posts.ts, feed-cache.ts, components/social/FeedList.tsx, NewPostsPill.tsx, FeedRows.tsx. Changes components/social/PagedList.tsx (on List and typed rows), ExploreList.tsx, app/index.tsx, post/[id].tsx, u/[handle]/index.tsx, followers.tsx, following.tsx, bookmarks.tsx, lib/social.ts (an optional `limit` on following and latest, the query helper building both parameters; the lines explore.test.tsx:716, :778 and :866-867 read from it are kept), lib/session.tsx (the session's end clears the appearance and the reading places, section 8.8), test/browser/app.browser.ts and fixture-api.ts (the pill and reading-place steps, the "new posts" switch). Tests that change: explore.test.tsx:864-866 (the storage list gains lib/reading-place.ts), explore.test.tsx:231, :238, :239 (the empty sentence, from its words module), :400-406, :518-542 and the homeListKey cases; passkeys.test.tsx:329 kept; report.test.tsx:248-256 (the profile's menu); explore.test.tsx:771-803 kept (post/[id].tsx's expo-router import line, :785, gains no name: titles come through lib/page-title.tsx, and the anchoring sits beside the focus effect of :791-803). New: feed-rows.test.ts, reading-place.test.ts, new-posts.test.ts, feed-cache.test.ts, anchor.test.ts (the anchor's arithmetic as a pure function). Not a batch end; no stack rebuild.

**Task 6. The composer.** Goal: section 6.15 and 8.6. Creates components/social/composer/state.ts, ComposerField.tsx, ProgressRing.tsx, SendBar.tsx, DiscardDialog.tsx, lib/drafts.ts. Changes Composer.tsx, ComposerImages.tsx, ComposeSheet.tsx (on Sheet), useImageUploads.ts, app/index.tsx (the collapsed card), app/post/[id].tsx (the reply card), lib/session.tsx (the session's end clears drafts too), test/browser/app.browser.ts and fixture-api.ts (the composer steps). Tests: composer-state.test.ts, drafts.test.ts (written, sent, discarded, cleared when the session ends), the sheet's discard and sent-toast cases. Tests that change: explore.test.tsx:864-866 (the storage list gains lib/drafts.ts); standing.test.tsx:126 (ComposeSheet's `{refusalSentence(standing)}`) and explore.test.tsx:771-803 kept. Batch end (Tasks 4 to 6), with the browser check's full walk; no stack rebuild.

**Task 7. Moderation surfaces and the public pages.** Goal: section 8.7 and 8.9. Creates components/moderation/StatusSheet.tsx. Changes components/moderation/CasesLists.tsx, DecisionDetail.tsx (the `?appeal=1` focus), ItemLines.tsx, NoticeStatusView.tsx, RefusedNotice.tsx, ReleaseNotice.tsx, ReportForm.tsx, UploadNotice.tsx, app/settings/cases/ (five files), report.tsx, notice/[ref].tsx, rules.tsx, transparency.tsx, explore/about.tsx, terms.tsx (into PublicFrame), lib/moderation-words.ts (the status words). Also changes components/social/PostCard.tsx (the author's chip becomes the button that opens StatusSheet) and MediaGrid.tsx (the "Why are images hidden?" link), and test/browser/app.browser.ts and fixture-api.ts (the status sheet's steps and a decision). Tests that change: cases.test.tsx:590-597 (the decision's link is found in the open sheet); kept: cases.test.tsx:247-249, 260-264, 288-296, 546-548, 666-668 and 871, appeals.test.tsx:126-127, :202-204, :270-273 and :283, automated.test.tsx:103 (`maxLength={OBJECTION_TEXT_MAX}`) and :135 (`onAsk={ask}`), report.test.tsx:486-489, announced.test.tsx:306. New: status-sheet.test.tsx. Not a batch end; no stack rebuild.

**Task 8. Settings, security, auth and Appearance.** Goal: section 8.8 and 8.10. Creates app/settings/appearance.tsx and app/settings/index.tsx (the Settings index, which the nav's Settings item now opens). Changes app/settings/_layout.tsx (Appearance signed out), security.tsx, privacy.tsx, profile.tsx, account.tsx, components/security/ (seven files), app/(auth)/ (six screens and the layout), email-revert/[token].tsx, not-me/[token].tsx, passkey-remove/[token].tsx, SettingsNav.tsx (Appearance first), AppShell.tsx (the signed-out nav's Appearance item, with its route; the Settings item opens /settings), test/browser/app.browser.ts and fixture-api.ts (the Appearance steps and the theme matrix), lib/terms.ts ("Your data" lists what the device keeps, no new TERMS_VERSION) and terms.test.tsx (that sentence names every store). Empties `LEGACY_COLOUR_FILES` and the Text scan's allowlist. Tests that change: lifecycle.test.tsx:41-73 (PAGES gains appearance; :58-73 leaves out settings/index.tsx, the list itself), 188, 200, 229, cases.test.tsx:278-279 (SettingsNav's hrefs gain /settings/appearance first), passkeys.test.tsx:380 and :458 kept, explore.test.tsx:707-718 kept; also kept: announced.test.tsx:270-272 (account.tsx's terminate line), standing.test.tsx:162, lifecycle.test.tsx:134-136 and the account.tsx blocks of :145-245, passkeys.test.tsx:322-337, :356-448 (ReauthPanel and its three `{reauth.pending ? <ReauthPanel` lines), :454-458 (with `label="Sign in with a passkey"`) and :506-508; passkeys.test.tsx:520-536 changes: `sentences()` reads the lockdown sentences from the words module they move to (section 1.5) instead of the three token pages and PasskeysSection.tsx. New: appearance-page.test.tsx. Batch end (Tasks 7 and 8), with the browser check's full matrix; no stack rebuild.

**Task 9. The console within its policy.** Goal: section 9. Changes apps/admin/src/app.css, and Layout.tsx only where a state needs a class; nav.tsx is not changed (the current link is styled through `a[aria-current="page"]`), so apps/admin/test/source.test.ts:64-66 (exactly three `href={` lines, all in nav.tsx) and cases.test.tsx:1074 (`<a href="/queue" aria-current="page"`) are kept; creates apps/admin/test/contrast.test.ts. Checks: the console's unit tests unchanged, `test:browser` with its 79 steps, 23 at 360 by 740 px; at 1280 by 900 the composer steps (console.browser.ts:618, :683, :704, :739, "Confirm with your staff key" among them) and the nine clicks on `table.queue tbody tr` prove the sticky column and thead. Not a batch end; no stack rebuild.

**Task 10. Documentation and the walk-through.** Goal: the record. The design itself, docs/superpowers/specs/2026-10-21-interface-and-experience-ui-design.md (parts 1 to 6 joined), is committed before Task 1, as every sub-project's design is; this task fills its section 15 from the dry run; README.md gains "The interface" (themes, the reading place and what is stored on the device, by key, and when it is cleared, haptics, the browser check and how to run it, the budgets) and a new section "Third-party notices" (the fonts under the OFL 1.1 with the LICENSES folder, Lucide's ISC with its Feather MIT notice, class-variance-authority's Apache-2.0 notice, sonner's and sonner-native's MIT), placed so the sections apps/admin/test/readme.test.ts reads (## Moderation, ## Authorities' orders, ## Quarantine, ## Backups, ## Restoring, ## Upgrading, ## Before going public) keep their bounds; apps/admin/README.md notes the console's tokens; the main design's section 5 is marked delivered and section 9 gains the dated amendment "2026-10-21, the UI sub-project" (delivered; handles in the mono face; Popular now left the context column, amending the 2c design's section 11 too; the decisions of section 2; status and order: next 3b import, 2d engagement, 4 hardening, 5 native builds). a11y.test.tsx gains the check that `LEGACY_TEXT_FILES` names no file a task of this sub-project rewrote, and section 15 records the files still on it. The walk-through runs the browser check's layout steps at 360, 768 and 1280 px in the three themes and keeps the screenshots in the scratch folder, not in git. Batch end (the whole integration suite); stack task: the stack rebuilt from clean and the smoke test of Task 3 run again.

## 14. What is left for later

Sub-project 5, native builds:

- react-native-keyboard-controller 1.22.7 (or the line Expo then tests) for the composer and replies.
- react-native-screens form sheets for the composer and menus on iOS and Android, behind the same Sheet API.
- Static font files embedded with expo-font's config plugin (@expo-google-fonts/fraunces, atkinson-hyperlegible-next and atkinson-hyperlegible-mono 0.4.1, or their versions then), and fonts.ts naming them.
- Persistent storage on native for the appearance, the reading place and drafts, with a storage library chosen then under the same floor: a defect to fix, not polish, since study 3.2 names losing the draft and the place on native as Bluesky's weak point.
- Haptics, the lightbox's pinch and zoom, and sonner-native's reduced motion checked on devices; state kept across an Android configuration change (study 3.2); app icons and the splash; keyboard shortcuts on web with their off switch.

Sub-project 2d, engagement:

- Notifications (grouped, a seen-at snapshot, no re-engagement pushes; study 4.6), uploaded avatars in the Avatar component's place, mentions as data, share cards with server-rendered titles and meta, help on a first visit, and the author's per-post "hide counts". Delivered by sub-project 2d (`docs/superpowers/specs/2026-10-22-engagement-2d-design.md`; the main design's section 9, 2026-10-29), with one difference: titles are not server-rendered. The served `<title>` stays "korbat" on every page and the app's own title, which never names an account, replaces it once the bundle runs, so a card names its post's author or its profile in its Open Graph tags alone (2d decision 23). Notifications are the Activity screen, with follows grouped by UTC day and the seen marker kept on the server (2d decisions 5 and 6).

Other places:

- A "Restored after appeal" chip and the deadline on the chip need PostModeration to grow (decision 11).
- Reply order and a threaded view need the replies route to sort (study 4.10).
- A list of recent sign-ins in Settings, Security, which the main design's section 5 names, needs an account-side route; the console has one.
- A web manifest, a service worker and an offline page: sub-project 4.
- Translations: an i18n sub-project before korbat is offered in a home state whose language is not English (decision 1).
- @legendapp/list, if profiling ever asks (section 11.1); NativeWind 5 with Tailwind 4, and Expo SDK 58 with every expo-* module together (libraries 4).

## 15. Amendments from the dry run

The dry run of 2026-10-21 built the ten tasks in a scratch clone, one commit each, through the gated runner. Where the code differs from the text above, the code is right and the point is recorded here, in the order of the tasks that settled it (Tasks 1 to 10).

- **The native variables through a platform pair (4.2).** ThemeProvider.tsx sets the resolved theme's variables on its root View through scopeStyle() from apps/app/src/theme/scope.ts, which returns NativeWind's vars() of themeVariables(theme) (tokens.ts, each token as `--k-<token>`: `R G B`); the web build and the unit tests take scope.web.ts, which returns nothing, since global.css and the html class do that work there. NativeWind's runtime requires react-native when it loads, which Node cannot load (vitest aliases react-native to react-native-web only in the files it transforms), and the tests that render ReportForm reach ThemeProvider through useTheme(). A forced Dark scope (the lightbox's stage, Task 4) takes scopeStyle(`dark`) on native and the class dark on web.
- **The reset paints the html element only (4.2).** public/index.html's reset keeps Dark's surface (#100F16) and ink-high (#F3F1F7) for a browser without scripts, on `html` alone where it was `html, body`: theme-boot.js sets the reader's theme as the html element's inline background and colour, and a body painted Dark would cover a Light first frame. The body stays transparent and shows the html element's colours; ThemeProvider keeps them, the class, color-scheme and the theme-color meta in step after the bundle. index.html carries no theme-color meta of its own: theme-boot.js creates it.
- **Fonts installed by one call, each file required lazily (4.3).** fonts.ts and fonts.web.ts both export FONT_FAMILY (web: Fraunces Variable, Atkinson Hyperlegible Next Variable and Atkinson Hyperlegible Mono Variable; native: undefined, the system font) and installFonts(), which _layout.tsx calls once at module scope and which on web adds the one style element (id korbat-fonts). Each rule in FONT_FACES names its file twice, as `file` and in a thunk `url: () => require(<the same literal path>)`, so Metro bundles every file while loading the module reads none: Text.tsx imports FONT_FAMILY, and vitest runs no Metro. On web the require yields the hashed URL string (`/assets/__node_modules/@fontsource-variable/...woff2` in the Task 1 export), which the rule's src takes as it is; an object with a uri would be read too.
- **The lightbox's stage as a fixed colour, blended to 8 bits (4.2).** tokens.ts's FIXED_COLOURS holds the stage, rgba(0, 0, 0, 0.94), beside scrim and media-badge, each as [red, green, blue, alpha], and TEXT_PAIRS writes the forced row as a pair focus on surface with `forced: { theme: dark, over: stage }`: the foreground takes Dark's value whatever the theme and the background is the stage laid over the theme's surface. contrast.test.ts blends a fixed colour per channel and rounds to the 8 bits a pixel holds, which gives the table's 8.59, 9.30 and 9.36 and the media badge's 9.29:1 exactly (an unrounded blend gives 8.61, 9.32 and 9.23). The 43 other rows of the table match the tokens to two decimals.
- **The legacy allowlist in a helper of its own (4.2, 6.2).** LEGACY_COLOUR_FILES lives in apps/app/test/legacy-files.ts, with sourceFiles() and SRC, and is imported by contrast.test.ts (palette classes and hex colours, refused outside src/theme/tokens.ts) and theme.test.ts (size and weight classes, refused outside kit/Text.tsx), since a test file that imports another runs its tests twice. It starts with the 51 files that hold palette classes at 1222b87, the same 51 that hold size and weight classes, hex colours in five of them; a listed file that holds no palette class fails contrast.test.ts, so each task takes its own files off, and Task 8 empties it.
- **Icon's strong stroke (6.3).** Icon takes `strong` besides name, size, tone and filled: a stroke of 2.25 instead of 1.75, for section 4.7's reposted Repeat2 and section 7.1's current nav item. The props type, IconProps, lives in components/icons.ts so Icon.tsx and Icon.web.tsx export one shape; size defaults to 20 and tone to high.
- **The threshold haptic on Android (5.3).** The design names AndroidHaptics.Gesture_Threshold_Activate for the `threshold` intent; expo-haptics 57.0.3's AndroidHaptics has no such member (its list runs from Confirm to Text_Handle_Move), so tsc refuses it. lib/haptics.ts plays AndroidHaptics.Long_Press, the firm tick Android plays when a press arms an action, the nearest in kind; devices check it in sub-project 5 with the other constants.
- **Icons are imported one module at a time (4.7, 6.3).** The design has Icon.web.tsx and Icon.tsx import named components from lucide-react and lucide-react-native so that only listed icons are bundled, but Metro keeps every icon a package's main entry re-exports: once ui.tsx drew an Icon, the web export grew by about 1,900 icon modules, to 958,977 bytes of JavaScript gzip against Task 3's cap of 791,297. Icon.web.tsx now imports each icon from lucide-react/dist/esm/icons/<name>.mjs, typed by a new apps/app/src/components/kit/lucide-icons.d.ts (the package ships no types for those modules), and Icon.tsx from lucide-react-native/icons/<name>, the package's own subpath export (Trash2 from icons/trash, since 1.55.0 has no module for the alias). Each file still imports the LucideIcon type from its own package, so theme.test.ts's pin holds, and kit.test.tsx refuses a value imported from either main entry. The export is 723,951 bytes gzip.
- **ListRow's title is its `label` (6.11).** 6.11 lists the prop as `title`; 6.1 and section 10 require every ListRow to take `label: string`, which tsc enforces (kit.test.tsx holds a @ts-expect-error for a ListRow without one), so the code calls the row's title `label`.
- **Rows draw their focus ring inside (6.1, 6.11).** ListRow's ring is the kit's 2 px focus-colour outline at a -2 px offset (FOCUS_RING_INSET in kit/interaction.ts), since a row spans its scrolling column, whose edges clip a ring drawn outside. A switch row draws the ring on the row while its switch has keyboard focus (`:has(:focus-visible)`), because react-native-web marks a focused switch only with a faint box-shadow on its thumb, which forced colours remove; the row also flips the switch for a pointer, with no role and no tab stop of its own.
- **Skeleton gains Skeleton.List (6.12).** Besides the five parts, Skeleton.List({ kind: "posts" | "accounts", count }) draws the rows and the one visually hidden polite status ("Loading posts", "Loading accounts") that 6.12 asks a loading list to carry, so the screens of Tasks 3 and 5 take both at once. A composed row (Post, Row) pulses as one Animated.View rather than one per shape.
- **StatusChip takes `name` and `className` (6.13).** The information-only form is named by `name` when one is given (VerifiedChip shows "Verified" and is named "verified account"), else by its label; `className` places the chip in its parent (VerifiedChip passes self-center). The link and button forms are 44 px tall targets around the drawn chip (4.4), scale to 0.97 when pressed, as buttons do, and show the border in full ink under a fine pointer.
- **IconButton's further props (6.3).** Besides 6.3's props it takes `expanded` (the aria-expanded of a `hasPopup` trigger, false until given), `filled`, `disabled` and `tone` as low, high, accent or danger (ink-low at rest, the accent while `pressed`). It draws no count when `count` is left out or zero; the caller leaves it out, and drops the number from the label, when the reader hides counts (decision 15). The tooltip also closes when the button is pressed.
- **Text keeps a caller's role and gains the on-fill tones (6.2).** Task 1's Text replaced any accessibilityRole with that of `as`, so `<Text accessibilityRole="alert">` lost its role; it now keeps the caller's role when `as` is not a heading. Tone gains on-accent, on-danger and the four -on-wash tones, for text and icons on a filled button or a chip's wash, and Text.tsx exports fontVariation(), through webStyle()'s one cast, for the monogram's SOFT 100.
- **useMotion()'s timing names (5.1).** timing(name, duration?) takes pressIn and pressOut in place of MOTION's one `press`, and a duration for easeOut and easeInOut, whose rows in 5.2 give different durations (150 ms when none is given). Every timing carries Reanimated's ReduceMotion.Never, so Reanimated never second-guesses korbat's own reduced forms; a spring carries Always under reduced motion and lands at once. lib/motion.ts also holds usePressScale(), usePulse() and useSpin().
- **VisuallyHidden is an inline style (6.16).** Its 1 px clipped box is an inline style on every platform, which the unit tests can read and native honours, but which a :focus class cannot undo; the skip link of Task 3 therefore shows itself while it holds focus by rendering visibly then, rather than through VisuallyHidden.
- **The monogram is a capital (6.5).** monogram() upper-cases the display name's first grapheme ("ada" shows "A"); at 96 px the letter is display-1 with SOFT 100 alone, its WONK setting dropped.
- **LEGACY_TEXT_FILES holds 38 files and lives in test/legacy-files.ts (1.5).** The list sits beside LEGACY_COLOUR_FILES, for the reason Task 1 gave (a test file that imports another runs that file's tests twice). The scan, through TypeScript's parser, counts every JSX text with a letter or a digit and every string literal child but single punctuation, single words and the wordmark included; it finds 39 files at 0960bd8 where the design counted 34 at 1222b87, and 38 once ui.tsx leaves.
- **The header and the list's scroll get two files of their own (5.2, 7.1, 7.2; review ruling 8).** The design names none: components/ScreenHeader.tsx draws 7.2's bar (Back as IconButton shell.back when the screen passes an href, the title in display-2 as the h1, the screen's controls under it) and HeaderSpace; lib/shell-scroll.tsx holds headerOffset(), createShellScroll(), softReset(), ShellScrollProvider and useShellScroll(), one per screen, provided by AppShell. On a phone the header floats over the list (nativeID screen-header) and moves by translateY, 200 ms ease-out from where it is; the list starts below it by the header's measured height. From 768 px it sits above the list and draws its line-low rule once the list has left its top.
- **PagedList hands the shell its scroll and its top (7.5).** Its FlatList gains a ref, onScroll (scrollEventThrottle 16), the registration for the soft reset and, on a phone, the floating header's height as its top padding; nothing else of PagedList changes, and Task 5 moves all of it onto List. Explore's own list is not hooked yet, so the soft reset does nothing on the Explore tab until Task 5.
- **The toasts share two more files (5.4, 6.16).** lib/toast-rules.ts holds ToastInput (tone done, the default, with the done icon in ink-high, or rollback with the error icon), TOAST_LIMIT, toastDuration(), toastOffset() and the small store through which AppShell tells the one Toaster that a phone screen shows the compose button; components/ToastCard.tsx is korbat's drawing of one toast, which both files hand to their library as a custom toast, since sonner's own look has a box shadow (4.6: no shadow anywhere) and a 24 px action button (44 px controls). The phone offset is also given as sonner's mobileOffset, because sonner switches at 600 px and korbat's phone layout runs to 768 px.
- **The gesture root is a plain View on the web (7.4).** _layout.tsx takes GestureHandlerRootView from components/GestureRoot.tsx, which re-exports gesture handler's own on iOS and Android, while GestureRoot.web.tsx is a View. Importing the package's index for its root put the whole of gesture handler into the web bundle (797,748 bytes gzip against the cap of 791,297); its GestureDetector asks for no root on the web. A later task whose gestures need the package on the web brings it then, about 55 KB gzip.
- **zod is made jitless from the app's own entry (12.3).** The browser check found a script-src eval violation on every page: zod probes new Function when it builds its first object schema, which the policy refuses and reports although zod catches it. apps/app/index.ts, now package.json's main, imports src/lib/zod-jitless.ts and then expo-router/entry, because expo-router loads layouts while it builds the route tree, before the root layout runs; the console has the same module. The entry bundle's file is now named index-<hash>.js; the smoke test and the walk find it from index.html.
- **The walk holds the parts this sub-project has drawn to the target, label-fit and contrast rules (12.3, 10).** The design asks it of every control at 360 px, every label and every text of the main column; the screens' own content still paints with Tailwind's palette and fixed sizes until its task (in Light, Home's legacy text is near white on the light page). So in Task 3 those three rules measure the skip link, the nav, the context column, the screen header, the offline banner, and the missing page whole (DRAWN and ALL in app.browser.ts); each later task adds its screens. The keyboard step holds the skip link, the nav and the main column to the 2 px ring and the first stop inside Home's column to having an outline at all; the Largest step runs on the missing page and Bookmarks; horizontal scroll, reports, errors and unanswered requests are checked on every page and route.
- **The request count leaves images out (11.3).** Step 14 counts the API's JSON answers before a route's first content; /api/media/ files are the posts' own and are asked for after the posts are drawn.
- **A profile is read once the session is known (11.3).** u/[handle]/index.tsx read the profile and its posts again when the session resolved, five requests before the first content; its effect now waits while the session loads (one line, which Task 5 replaces when it rewrites the screen). A post's page still reads its thread twice, within the three requests.
- **What the nav shows while the session loads (7.1, 6.12).** Home alone, the item both sets share; the rest join when /me answers, so neither Sign in nor Bookmarks ever flashes.
- **The wordmark and the k are marks, not links (7.1).** They sit at the top of the full nav and the rail, hidden from screen readers (the page's title and the Home item already name korbat), so nothing comes between the skip link and the nav's items; nav.monogram holds the k.
- **Nav labels break inside their item at the extreme size (7.1, 10).** At 320 px with Largest and the root at 200 percent a word such as Bookmarks is wider than a quarter of the tab bar: labels may hyphenate and break (overflow-wrap) rather than clip or push the page sideways, and the pills, the bars and the rail's items are sized in px, as the icons are, so a larger root grows the words and not the shapes. ScreenHeader's title breaks the same way.
- **EmptyState takes a level, and the missing page scrolls (6.12, 8.11).** level 1 makes the empty state's title the screen's one h1, which the not-found screen needs; the screen puts it in a ScrollView, since the main column does not scroll by itself and at the largest text Go to Home would otherwise fall under the tab bar.
- **Skeleton.Page for screens that are not lists (6.12).** The report form and a notice's status show, while they load inside the shell, a heading's bar and lines of text with the polite status Loading (spinner.label).
- **VISUALLY_HIDDEN is exported from kit/VisuallyHidden.tsx (6.16).** The skip link takes it, with its least size undone and pinned to the corner, while it does not hold the focus, and is drawn at the top left over the page while it does.
- **usePageTitle() returns the element a screen renders (8.1).** A hook cannot write the document's head by itself: it returns Head with the title, which the screen renders once. TITLE_WORDS holds the four titles in use (not found, bookmarks, followers, following); the design gives the report form and a notice's status no title words, so they stay untitled until Task 7.
- **Back goes back (7.2).** ScreenHeader's back takes the screen above as an href: router.back() when there is history, router.replace(href) when the screen was opened from an address. Followers and following keep the account's @handle link under the title, now in the mono face.
- **The settings row, the banner and the handle box (4.8, 7.3).** SettingsNav's links are 44 px pills, the current one on the accent wash in ink-high body-strong with an accent underline, the others ink-medium; the banner's heading starts with Clock or EyeOff and its buttons are outlined in its on-wash ink, a control's boundary at well over 3:1 on the wash; the handle box types in the mono face and shows its error with the error icon.
- **The walk's two developer switches (12.3).** KORBAT_APP_EXPORT reuses an export already built with the walk's environment (read, never deleted) and KORBAT_SHOTS names the screenshots' folder (otherwise a new temporary folder, printed); the gates set neither, so each run builds its own export.
- **The smoke test's new step is 20 and runs after step 7's post (13).** It needs a public post for /post/<id>'s 200, so it runs once the run's first post exists; it also checks that / answers no-cache.
- **Pins moved without shifting later lines (3.2).** explore.test.tsx keeps its line numbers from :12 on (a comment stands where the PopularNow import was, and the Explore's rows case fills the old block's lines), so :853 to :866 still name the lines later tasks change; hidden-media.test.tsx keeps a comment at :7; announced.test.tsx:175 keeps one comment line.
- **Drags on the web run on pointer events (5.1, 6.8, 7.4).** The design drives everything a finger can move by a gesture-handler gesture, the Sheet by gesture-handler's Pan. kit/DragArea.tsx is that Pan on iOS and Android (its callbacks on the JS thread, inside the Sheet's and the lightbox's own GestureHandlerRootView), and kit/DragArea.web.tsx does the same on the browser's pointer events with the same handlers: a 10 px slop, the axis the drag starts along, pointer capture, and the release velocity over the last 80 ms. Gesture-handler draws its web gestures through the package's index, about 55 KB gzip, more than the 48,441 bytes the budget had left; the export measures 758,856 bytes gzip of JavaScript (16,000 more than Task 3, 32,441 under the cap) with no gesture-handler code in it.
- **IconButton is extended for the post's toggles (6.3, 6.6).** No social/ActionButton.tsx: IconButton gains `feedback` (the pop, Like's accent ring, the count's 6 px roll, the 120 ms cross-fade of a toggle turned off or of any toggle under reduced motion or pressed from the keyboard, and the rollback's 4 px nudge) and `disc` (section 4.7's reposted look, with the count in body-strong).
- **The pop always starts from the pressed scale, and its springs live in lib/motion.ts (5.1, 5.2).** The pop is set to 0.92 before its spring even after a quick tap whose press never reached it, because Reanimated 4.5 skips an animation whose value already sits at its target and drops a spring's velocity after a running timing. Its values are POPS in lib/motion.ts (stiffness and damping from the damping ratio and the response, with the velocity), not theme/motion.ts, whose table theme.test.ts pins as section 5.1's six values.
- **Text gains post-large (4.3, 6.6).** The thread's focused post sets its words at 19 / 28 through an eleventh variant, post-large (text face, 400, no tracking, no font-scale cap on native, as post); theme.test.ts's variants table gains its row.
- **The article is named through a hidden copy of its author line (6.6, 10).** aria-labelledby names a hidden, aria-hidden element holding post.label, 'Ada, @ada, 3h ago' with postedWhen's time, because the visible author line also holds the verified chip's name and the time link's 'open the post'.
- **A suspension's refusal shows RefusedNotice without the rollback toast (6.6, 8.4).** On account_suspended the card and FollowButton roll back with the error haptic and show the standing's sentence under them, and no toast, whose 'Try again' would mislead; every other refusal shows the toast.
- **A second tap of a busy kind is not sent (6.6).** The design's second tap waits for the first answer; lib/social.ts's lanes drop it instead and the card does not change for it, so a double tap still cannot undo itself and nothing is queued behind a slow request.
- **Quotes never enter Explore, said as for replies (6.14).** For the reader's own quote reach() says 'Quotes never enter Explore.' and asks nothing, since GET /api/posts/:id/explore answers `quote` for one and lib/explore.ts words that as nothing.
- **Words the tables leave out (6.6, 6.9, 6.14, 8.1, 8.3, 8.4).** post.label, the bare names at zero or hidden (post.reply.none, post.like.none, post.reposts.none), post.quote, post.delete, post.save and post.saved, the moved sentences (post.deleteQuestion, post.replyingTo, post.replyingHidden, post.deleted, post.unavailable, post.inExplore), reach.replyExplore and reach.quoteExplore, reach.summary.public and reach.summary.private for the one line under Who sees this in the menu, thread.stats as one key per part and number, the media.* words of the grid and the lightbox, and follow.follow and follow.following.
- **The decision link follows the order line (6.14).** With an authority's order 'Read the decision' sits after 'Removed for everyone else by an authority's order.'; without one it follows the chip's words.
- **The lightbox's controls are icon buttons, and its dialog is named by its place and the description (6.7).** Close, Previous and Next keep their names as IconButtons on the stage, without the visible words they showed before; the Modal is labelled by 'N of M' and the image's description. It closes back into the thumbnail of the image showing, which after paging may be another cell than the one that opened it, while the focus returns to the opening image.
- **Menus and sheets mount only while open (6.8, 6.9).** react-native-web's Modal adds an element to the page as it mounts, so Menu, Who sees this and the lightbox mount from the press until they have closed, and a list of cards keeps none. A Sheet has no close button: Escape, the scrim, the drag and Android's back close it.
- **The quote's empty space opens the quoted post (6.6).** The card's pointer convenience is applied to the quote too: a click on the quote's empty space opens the quoted post (native: a Pressable outside the accessibility tree), while its time stays its one link.
- **FollowButton draws Button's faces itself (8.4).** ui.tsx exports buttonFace and LABEL_TONE, and FollowButton draws the primary and secondary faces with its own 160 ms label fade, because Button keeps its mt-6 wrapper and changes its label at once.
- **One hairline around the frame (6.7).** The 1 px line-low hairline is drawn once inside the frame's radius-media edge, not around each image; images in one frame stay 2 px apart on surface-2.
- **A lost image says so with the error icon (6.7).** ImageFaultView shows a lost image in danger-ink with the error icon and one being restored in ink-medium with the retry icon, both on surface-2, where the design names the hidden icon for placeholders.
- **The focused post's time link (6.6).** In the large variant the link shows fullDate and is named 'on 21 Oct 2026, 18:40, open the post' (time.posted.on), so its name still contains its visible label.
- **The feed's rows in the browser walk (12.3).** DRAWN gains `[role='feed'] [data-row]` (every row of a list: its posts, the marker, Load more, the end) where the brief named `[role='feed']`, with `[role='tablist']`, `[data-pill]`, `[data-profile-header]` and `[data-thread]`: a feed's header holds the inline composer and a thread's the reply composer, which keep Tailwind's palette until Task 6 moves them onto the tokens and fail contrast in Light and the 44 px rule. `data-thread` wraps the ancestors and the focused post, not the reply composer. Task 6 widens the selector to the whole feed.
- **Empty and error are row kinds (8.2).** feedRows() gives nine kinds, the seven the design names and `empty` and `error`, because the design makes the empty and error states rows of the same list so the header and tabs never move.
- **At most 300 rows (11.1).** trimOlder() cuts only when rows are put above the reader (a poll, a gap read, the reader's own post), and only right after a row that ended a page, so the cursor that page answered reads the dropped rows again through Load more. Load more past 300 rows keeps every row: there the rows farthest from the reader are the newest, which the design keeps.
- **Where the marker is drawn (8.2).** The marker is drawn only with at least one post above it (over nothing, 'Newer posts are above' would be untrue), and when it sits right above the reading place the list holds the marker at the top, so 'You were here' is the first thing the reader sees over the post they stopped at.
- **The pill's count and You're all caught up (8.2, 10).** The count is the unread new posts above the post at the top of the view: a poll's posts, and on opening the posts above the place newer than the newest seen. A post leaves the count when it reaches the top of the view (pressing the pill puts the oldest one there). 'You're all caught up' is the marker's once the count is zero, or once the marker is seen with the reader above it and nothing unread. '50+ new posts' shows while a gap holds more not yet read.
- **How the anchor keeps the row (7.5).** anchor.web.ts corrects the scroll when a MutationObserver sees the list's rows or spacers change and when a ResizeObserver sees its content resize, with the browser's own anchoring off. Like the browser, it corrects nothing at the very top of the list (a header growing or the reader's own post push the rows down) unless the caller keeps the row for the change (a poll's posts). A row FlatList has not drawn yet is reached with scrollToIndex and FlatList's estimate (onScrollToIndexFailed), then placed exactly when drawn. Its own scrolls leave the phone's header where it is. Smooth scrolls go through the element's own scroll(), since react-native-web replaces the node's scrollTo().
- **Focus after a delete (10).** The anchor keeper sees a removed row that held the focus in the same MutationObserver and moves the focus to the next row's open link, or to the screen's h1 made focusable, so no list has to report its deletes; ExploreList's pinned remove line stays as it was.
- **new-own-post and post-removed (5.2).** The reader's own new post fades in (Reanimated FadeIn, 220 ms; at once under reduced motion), and a deleted post fades (Task 4's 150 ms); in both the rows below move at once rather than on a 200 to 220 ms LinearTransition, which FlatList's cells do not carry on react-native-web.
- **The session's end (8.8).** The decision and the clearing live in lib/session-end.ts (sessionEnded, clearSessionTraces), which SessionProvider calls on every change of its state: session.tsx imports the kit and, through it, expo-router, which a test cannot load without mocking, and the design asks for a pure function the tests call. The end also forgets the feeds kept in memory (lib/feed-cache.ts).
- **ListRow for accounts (6.11, 8.4).** ListRow gains `leading` (an element in the icon's place: the Avatar), `badge` (after the label: the VerifiedChip), `detail` (in place of the description: the handle in the mono face and the bio) and, on a link row, a control of the kind `button` (FollowButton) drawn beside the anchor and outside it, since a button inside an anchor cannot be reached; such a row has no chevron.
- **Image priority (11.2).** The first two rows' images load at priority high through a context, ImagePriority in MediaGrid.tsx, which PostCard's `priority` sets, rather than a MediaGrid prop: report.test.tsx:241 pins PostCard's MediaGrid line word for word.
- **The caught-up check's drawing (5.2).** A CSS rule, DRAW_RULE, in the one style element theme/fonts.web.ts writes, draws the done icon's check path from a dash offset of 9 to 0 in 450 ms ease-out; FeedRows.tsx sets data-draw on the icon only the first time in a session and never under reduced motion. Native draws the icon at once.
- **Explore's words and footer (1.5, 8.2).** ExploreList's sentences move to EXPLORE_WORDS in lib/explore.ts, the Explore area's words module; its posts, skeletons, error and empty state are typed rows, while Load more, the refresh notice's status line and the sign-in link stay in its footer, where explore.test.tsx reads them.
- **The profile's tabs (8.4, 6.10).** The profile header and its Tabs sit in the list's header, so they scroll with the posts, and the TabPanel wraps the whole list, so the panel holds its own tab list. The posts count shows as before; with hidden counts, a count that is not a link (signed out) is not shown. The owner gets no More menu.
- **Every page of 50 (8.2).** Following and Latest read every page with limit=50, Load more and the gap included, not only the opening pages.
- **Pull to refresh on Home (8.2).** On native, pulling Home's Following or Latest asks for new posts at once, which push the rows down at the top, instead of reading page one again; the web has no pull to refresh.
- **The thread's header (8.3).** The post page has a ScreenHeader 'Post' with Back to Home; a missing post's h1 'This post is not available' is that header's title; the focused post draws no divider of its own, its block does, after 'Quote this post'.
- **The browser walk's pages (12.3).** Step 11 (Largest text at 320 px) gains Home but not the post page, whose reply composer is Task 6's; LAYOUT_PAGES gains Bookmarks and a followers list held wholly (ALL). The fixture timelines page through 120 posts by an offset cursor with a repost every twenty posts, honour `limit`, and gain the newPosts switch and a delay for timeline answers; Ada's post 3 has a chain of three and five replies, and sign-out is answered.
- **Words the tables lack (8.1).** New keys: home.title, home.tabs, home.following, home.latest, home.explore; passkey.title, passkey.body, passkey.add, passkey.notNow; thread.title, thread.missing, thread.back, thread.quote, thread.empty, thread.exploreSetting; profile.posts, profile.followers, profile.following, their .hidden forms, profile.followsYou, profile.mute, profile.unmute, profile.block, profile.unblock, profile.blockQuestion, profile.blockBody, profile.cancel, profile.signIn, profile.settings, profile.missing, profile.tabs, profile.tab.posts, profile.tab.replies, profile.tab.likes, profile.empty.posts, profile.empty.replies, profile.empty.likes; feed.pill.announce, feed.loadMore, feed.empty.following.body, feed.empty.latest.body. The moved sentences are word for word.
- **Composer-open moves the card's height (5.1, 5.2).** The design has Home's card grow "to the full composer (LinearTransition)". ComposerCard (components/social/composer/ComposerCard.tsx) animates its box's height instead, with a Reanimated timing of 200 ms ease-out from the collapsed card's height to the composer's, the box clipping what is not reached yet, and turns back from wherever it is when the card closes mid-way; under reduced motion it opens and closes at once. On the web Reanimated's LinearTransition animates a scale and a translation from the element's last rectangle, which squashes the field's words while the card grows and slides the card whenever the list it sits in has scrolled between two renders. It stays one of section 5.1's three layout changes.
- **One New post sheet for the app, mounted in the root layout (7.2, 7.3).** The design gives the rail's and the full nav's New post and the phone's compose button, but no home for the sheet they open. lib/composing.ts holds whether it is open and components/social/ComposeHost.tsx, beside the Toaster in app/_layout.tsx, draws it; AppShell gains `compose` (the phone's button, on Home, a profile and Bookmarks) and `onNewPost` (Home passes its card's open() from 768 px). The shell loads no composer, so a screen and its tests do not pull the composer and expo-image through AppShell, and Home holds no sheet of its own. A post sent from the sheet goes on top of Home's feeds through insertPosted(), which now also tells a Home feed still mounted under the screen (onPosted in lib/feed-cache.ts).
- **The scrim has no name (8.6).** The design keeps the composer's scrim labelled "Close the composer". The composer's scrim is now Task 4's Sheet scrim: no tab stop and hidden from assistive technology on every platform, so a name would never be heard. Escape, Cancel, a drag and the scrim itself close the sheet, asking first when there is content, and the sentence is not kept in the words.
- **The Post button is drawn on Button's faces (6.15).** The design (and the brief) name the kit Button. SendBar draws its Post and Cancel with ui.tsx's buttonFace and LABEL_TONE inline in the row, as FollowButton does, because Button replaces its label with "Please wait..." while busy and carries a form's mt-6 wrapper, while the Post button must say "Posting..." with aria-busy and sit in the bar. DiscardDialog's two answers are drawn the same way.
- **Replying to @handle leaves the reply composer (6.15, 8.3).** The old composer showed "Replying to @handle" above a reply's field. Replies are now written in the reply card, directly under the post they answer, whose field is named "Your reply", so the line is not drawn; post.replyingTo stays for the post card.
- **A kept draft opens its card (decisions 18 and 19).** The design closes Home's card back when it is empty and loses focus, and does not say how a draft kept from an earlier visit shows. A card whose context holds a draft opens as it mounts, with its words and without taking the focus, so nothing written hides behind the placeholder; it closes only once it is empty and left.
- **Drafts fall back to memory wherever browser storage is missing or refused (decision 18).** The design keeps drafts in memory on native until sub-project 5. lib/drafts.ts uses the same memory whenever there is no localStorage or the browser refuses it (a private window), and clearDrafts() clears both.
- **The count is announced across 900 and 1000 either way (6.15, 10).** The design announces the count politely "only when the count crosses 900 and 1000". crossed() in composer/state.ts counts a crossing in both directions, so deleting back under 1000 or 900 is said too; the sentence goes into a polite status beside the field's description, which itself never announces.
- **On the web the sheet focuses its field after it opens (6.8, 6.15).** Inside the sheet the field takes no autoFocus on the web: react-native-web's Modal notes the element focused as it mounts as the one to give the focus back to, and a field focused as it mounts would be noted instead of the opener, leaving the focus nowhere after closing. The Sheet's initialFocus "first" moves the focus into the field once the sheet is laid out; natively the field still takes autoFocus.
- **A reply reads only the replies again (8.3).** post/[id].tsx read the whole thread again after a reply (its read followed `version`), which showed the skeleton and unmounted the reply card with the focus in it. The replies are now read again through a new fetchPage (it depends on `version`), the list and its header stay mounted, the thread is not read again, and the focused post's reply count rises by one at once.
- **Words the tables lack (8.6).** ui-words.ts gains, word for word from Composer.tsx, ComposeSheet.tsx and ComposerImages.tsx, the keys 8.6's table leaves out: composer.title.post, .reply and .quote; composer.newPost; composer.field.* and composer.placeholder.*; composer.action.post, .reply and .quote; composer.posting; composer.missing.failed, .undescribed and .waiting; composer.cancel; composer.addImage; composer.discard.question, .confirm and .keep; composer.refused.where ("{read}: Settings, Cases."); and composer.image.* (the tray's names, statuses, placeholder and Remove).
- **The details sheet is named by the chip's words (8.7, 6.8).** Section 8.7 gives StatusSheet no title, and kit/Sheet requires one, which names the dialog. StatusSheet (components/moderation/StatusSheet.tsx) takes the chip's own words, chipText() ('Removed: R6'), as its title, so the dialog is named as the button that opened it is; no word key is added for it.
- **The Rule block's words for the law, and an order's blocks (8.7).** The design says 'Rule' shows the rule's id and title 'or 'Illegal content' with the legal reference'; its table has no key for those words, so moderation-words.ts's new STATUS_SHEET_WORDS holds `status.illegal` ('Illegal content'), drawn with the decision's legal reference under it. A review or a correction names the rule of the decision it reviewed, at that decision's rules version. An authority's order shows no Rule block, as its row in About you names no rule and no law of korbat's judgement (3f), and no Appeal block, as OrderNotice offers no appeal; its other blocks stand, Decided by reading 'An authority's order'.
- **What it does, Who can see it now and Statement, as drawn (8.7).** 'What it does' is one sentence a measure: STATEMENT_WORDS.done's for the post's and the image's measures and the resets, the statement's seal sentences for a seal, and the measure's label (MEASURES) for the account's measures, which the statement words at length on the decision's screen. 'Who can see it now' draws reach()'s sentences without the line that repeats the chip's words (the sheet's title) and without their links, since Statement holds the sheet's link to the decision. 'Applies to' says the image for any measure whose kind ends in _media, the account for a decision about no post, else the post. Statement quotes the reason's first paragraph, and only the link when the decision has no reason (a program's, an order's).
- **The Appeal block (8.7, 6.4).** Open (appealUntil set, none filed), it comes first, on a surface-2 card, with 'You can appeal until {date}.' (fullDate) and 'Appeal': an anchor drawn with Button's primary face (buttonFace, LABEL_TONE), since it opens /settings/cases/<id>?appeal=1 and is a link, not a Button. Interim: the interim sentence of the decision's own redress version (getRedress(redressVersion)). Pending and answered: the decision screen's words (appealFiled with appealWaitWords, appealAnswered with its link). A decision reversed in full: DecisionDetail's reversed sentence. A program's decision adds AskPerson, now exported from DecisionDetail.tsx with `framed` (false in the sheet: no card of its own) and `onLeave`. A decision with none of these has no Appeal block.
- **A link in the sheet changes the route only once the sheet has closed (6.8, 8.7).** Pressed, 'Read the full decision', 'Appeal' and the sheet's other links close the sheet (the press's default is prevented), the focus goes back to the chip, and the route changes after the Sheet's onClosed. While react-native-web's Modal is on screen its focus trap takes the focus back from anything outside it, which would undo the appeal field's focus on the next screen. The links stay real anchors (components/moderation/parts.tsx: CaseLink, leaveBy).
- **The chip's sheet is mounted only while open, and StatusChip takes a ref (6.13).** PostCard's StateChip keeps `sheetOpen` and `sheetMounted` in the card, mounts StatusSheet on the press and unmounts it after it has closed, as Menu does, and focuses the chip again through kit/StatusChip's new `ref` (its button form). The chip's words now break inside a word when even one word is wider than the chip (largest text at 320 px), since a chip never truncates (6.13).
- **The order notice's heading is level 2 (8.1).** OrderNotice drew 'Notice: an authority's order' as a level-1 heading inside the decision's screen; with 'Cases' in ScreenHeader as the screen's one h1 it is level 2, as DecisionDetail's own heading is. orders.test.tsx:104 moves from aria-level='1' to aria-level='2'.
- **A report's items are rows on ListRow's measures, not ListRows (8.7, 6.11).** The design: 'NoticeStatusView's items ListRows'. ListRow is a control (a link, a button, a switch or a radio), and an item holds its own controls (the reported link, the re-examination's field and button), so each item is a row with ListRow's padding and line-low divider, in a card on the status page and under its report in Your reports; NoticeStatusView's title moves to the page's ScreenHeader and its reference is drawn in the mono face.
- **Titles the tables lack (8.1, 8.8, decision 16).** TITLE_WORDS gains `title.report` ('Report - korbat'), `title.notice` ('Report status - korbat', never the reference) and `title.cases` ('Cases - Settings - korbat') for the five case screens: 8.8's `title.settings` form filled in, since shell.test.tsx:269-272 refuses a title holding `{`. Task 8 adds its settings titles the same way or moves that test.
- **The public pages' column inside the shell (8.9, 7.3).** The design: 'a 640 px column'. /terms has it, in PublicFrame wide; inside AppShell the main column is 600 px at most (COLUMNS.timeline), so /rules, /transparency and /explore/about read in ScreenScroll's column, 640 px at most, at the header's 16 px gutter on every width (4.4 gives 20 px from 768 px; ScreenHeader, Task 3's, keeps 16 px, and the title and the text start on one line).
- **Two shared files for the restyled screens (8.7, 8.9).** components/Prose.tsx holds the public pages' reading layout: Heading (level 2 in display-3, level 3 in title), Paragraph at the post size, ProseList, DatedList (a change log, each entry's sentence whole) and FigureRows (a table's label and value rows, the value under its label below 768 px, at the row's end from 768 px, the label carrying its colon so a row still reads 'label: value'). components/moderation/parts.tsx holds Line, Note, CaseLink and leaveBy for the moderation screens. ScreenHeader.tsx gains ScreenScroll, the scroll view of a screen that is not a list, wired to the shell's scroll like List, with `data-screen` on its column and `flush` for rows with their own gutter.
- **Status words never by colour alone, on the tokens (4.8).** The report form's disabled ground keeps its reason, now in review-ink beside the review icon (it was amber-300 text); Your reports' 'manifestly unfounded' mark the same; RefusedNotice's sentence is danger-ink beside the error icon; the decision's 'Taken by a program' chip is a neutral chip (surface-2, line-high border), since it states a fact and not a status.
- **The report form's checkbox tick is drawn, and Back to korbat is a word (1.5).** The checked box showed the letter 'x', the form's one bare sentence for the scan: the tick is now two borders of a box turned 45 degrees in on-accent, and 'Back to korbat', a label prop in ReportForm, ReportSent and NoticeStatusView, is REPORT_WORDS.back. The terms' bare sentences are lib/terms.ts's TERMS_PAGE (title, version, back) and How Explore works' are EXPLORE_WORDS' aboutLead, versionHeading, version, change and backToExplore.
- **The browser walk (12.3).** LAYOUT_PAGES' entries take `frame` for a page in PublicFrame (/terms), whose layout has no shell kind, nav or context column; the decision's screen in the walk is the removed post's (a decision about a post), and steps 8 to 10 sample the open sheet after its opening fade, as the contrast script reads opacity. The fixture's `delayMs` also holds a decision's GET, and `refuse` takes the kind 'decision'.
- **The sign-in screen's heading (8.10, 8.1).** The design keeps the screens' words, but signin.tsx's h1 read korbat, which PublicFrame's wordmark now says just above it. The h1 reads Sign in (AUTH_WORDS.signinTitle), the screen's name as title.signin gives it, so the page holds one korbat and one heading that names the screen.
- **Words on the rewritten screens (1.5).** Every sentence that was a JSX child moved to a words module: lib/settings-words.ts (Security, Privacy, Profile, Account and components/security), lib/auth-words.ts (the six sign-in screens) and lib/lockdown-words.ts (the three token pages and the not-mine dialog, one block each, which passkeys.test.tsx's sentences() reads through its new lockdownBlock()). The labels of fields and buttons, placeholders and the notes an action leaves (setError, setDone) stay on the screens as props, because lifecycle.test.tsx :145-245 and passkeys.test.tsx :321-461 pin them word for word in the source and the scan of 1.5 reads JSX children; MfaSection.tsx keeps its re-enrolment and staff sentences in the file for the same reason.
- **Card groups (8.8, 4.4).** The design: each Section becomes a card group of ListRows and fields. ui.tsx's Section keeps its card and its h2, takes an optional id for the radio group it heads, pads 16 px instead of 20 px (the gutter of the rows and the screen; Task 7's decision cards move by 4 px) and clips what reaches its edges to its corners; the new SectionRows runs ListRows from edge to edge under a line-low rule, and with end the last row's divider goes under the card's border, so one line closes the card.
- **A neutral chip (8.8, 4.8, 6.13).** The design: this device as a neutral StatusChip. StatusChip's tones are the four statuses, which kit.test.tsx pins, so StatusChip.tsx gains NeutralChip (ink-medium on surface-2 with a line-high border and no icon, an image named by its words), used for this device and for a passkey's tags used for this session, new and synced; suspended, the one status among them, is the restricted StatusChip with its icon, where green and red text were.
- **ListRow's new forms (6.11).** A radio row is its group's one tab stop while chosen, and RadioGroup's arrow keys move the focus and the choice at once through the row's own press (radioMove beside tabMove in kit/Tabs.tsx; Space chooses the focused radio); a switch row may carry its own Switch (control.element) with the row's flip and ring, which Privacy's Explore switch uses so its pinned line stays; an info row (info) shows a session with an optional button beside its words; switchColours() gives every switch the theme's track and an on-accent thumb, since react-native-web drew a teal thumb when on; and the switch's hidden checkbox draws no ring of its own (web:[&_input]:outline-none, a transparent outline that forced colours still show), so the row's ring is the one a keyboard sees.
- **Appearance's layout (8.8).** Dark style shows only while System is chosen, as a second radio group in the Theme card. The theme rows carry a swatch of each theme and the text size and font rows an Aa in their own size or face, decoration hidden from assistive technology (new key appearance.glyphs). The sample post is a card under Text size, by korbat with its monogram. Haptics, on iOS and Android only, sits in the Reduce motion card. The page's title is title.settingsAppearance, Appearance - Settings - korbat, with the settings row's short name, as Cases has.
- **Who opens Appearance (8.8).** Signed out, the settings layout lets /settings/appearance through by its path (usePathname, as (auth)/_layout.tsx reads it), and the index and every other page still go to /signin; a signed-in account still choosing its handle is sent to /handle there too, as on every settings page.
- **The cross-fade (5.2).** ThemeProvider puts the class k-theme-fade on the html element, with the custom property --k-theme-fade (200ms, or 150ms when useMotion() is reduced), in the same change as the new theme, never on the first apply and never while the theme stays, and removes both 34 ms after the fade. theme/fonts.web.ts's THEME_FADE_RULE, beside STILL_RULE, turns background, border, text, fill, stroke, outline and decoration colours into transitions for that length and leaves a toast's own motion alone. The values are THEME_FADE in theme/motion.ts, kept apart from MOTION, whose table theme.test.ts pins.
- **No middle dots (4.1).** A passkey's facts and a session's are joined by commas (added 20/09/2026, never used, added on Chrome on Windows), where the old screens used middle dots, which section 4.1 leaves out of meta strings.
- **The profile's settings button (8.8, the owner's ruling for Task 8).** Security and privacy settings on the reader's own profile (u/[handle]/index.tsx) opens /settings, the new Settings index, as the nav's Settings item does; its words stay.
- **New words (1.5, 6.10, 8.10, 8.8).** PRIVACY_WORDS.tabs, Blocked and muted accounts, names the Blocked and Muted tab list, which 6.10 requires to have a name; AUTH_WORDS.handlePreview, How it will look, heads the handle's live preview; the terms' Your data names the browser's stores in its own sentences beside the device id's: the appearance choices, where you stopped reading and unsent drafts until you sign out, that none leaves the browser, that Clear what this device keeps removes them, and that the device id and your Not now stay.
- **Privacy's tabs (6.10, 8.8).** The Explore card, the sentence on what a block and a mute do and the Blocked and Muted Tabs head the list, which is their TabPanel and stays keyed by the tab, as a profile's tabs head its posts; the title and the settings row are in ScreenHeader.
- **The QR code's plate (4.2).** The authenticator's QR code sits on a literal white plate (bg-white) in every theme, since a camera reads its dark squares only on light ground; white is not one of the palette names the scan refuses.
- **The phone's target rule (12.3).** watch.ts measures a control the pointer cannot press (pointer-events none: a switch inside its row, which the whole row flips) as the element that takes the pointer for it, since that is the target a finger aims at; the switch's own 40 by 20 px box is no target.
- **The walk's sessions (12.3).** LAYOUT_PAGES entries take signedOut (Appearance signed out, and sign-in, which a signed-in account leaves for its feed), steps 8 to 10 carry a session per route, and before a signed-out page the walk forgets the reading places and drafts its signed-in pages kept: a signed-out start with one kept is a session that ended elsewhere, which clears the appearance too (8.8) and would cross-fade the step's theme back to System while it is measured. A client navigation keeps the screen it left mounted and hidden, so step 35 reads only what is shown. Step 38 picks Light and Dark by the system's scheme under System, because a stored appearance given to open() is written again at every load, over the Hide counts the step turns on.
- **Pins moved beyond the brief's list (8.8).** The nav's Settings href is /settings in shell.test.tsx :119, :127 and :149, composer.test.tsx :259 and :261 and the walk's step 7; the signed-out nav gains /settings/appearance at shell.test.tsx :136; shell.test.tsx :270 allows title.token, korbat alone, the one title without the suffix.
- **Files left as they were (13).** components/security/PasswordSection.tsx, QrCode.tsx and QrCode.web.tsx hold no bare sentence and no palette class, and their fields already sit in the restyled card, so they are unchanged; fixture-api.ts needed nothing new for the Appearance steps.
- **The sign-in flow's loading (8.1).** While the session loads, (auth)/_layout.tsx turns its spinner inside PublicFrame, so the sign-in pages keep their wordmark and footer.
- **The ok triple's values (9, 4.2).** Section 9 names an --ok-* triple, but the app has no ok token. --ok-ink is the app's explore-ink (#0B7350 light, #3DD39A dark), and --ok-bg and --ok-fg, which keep their names, take explore-wash and explore-on-wash (#DAF3E8 and #075A3E, #0C2A20 and #86EBC3) in place of the old greens, so the three are one family of the app's green (7.07 and 10.74:1 on the wash). Section 4.8 keeps green for In Explore in the app; the console has no Explore, and its notices were green already.
- **The mono stack's order (decision 2, 9).** The design names the stack ui-monospace, Cascadia Mono, Consolas, monospace. app.css's --mono is ui-monospace, Consolas, Cascadia Mono, monospace (the family name quoted in the file). On Windows 11, Chromium draws the system's variable Cascadia Mono at its Regular instance with strokes close to Segoe UI's bold (CDP's getPlatformFontsForNode named CascadiaMonoRoman; asking for weight 350 or font-variation-settings changed nothing). With mono now on every time, the who line and the clocks, every id and date read as emphasised. Consolas also tells l from 1 and O from 0, and macOS keeps SF Mono through ui-monospace. Code is set at 0.9em (it was 0.85em).
- **Mono beyond the named selectors (9).** Besides code, .hash, time, .who bdi and the order's clock, the audit log's place numbers (table.audit td:first-child, right-aligned from 600 px) and pre (the order form's values, which the browser set in its own monospace) take the mono stack. bdi in general stays in the text face.
- **The sticky table head (9).** The design: thead sticky only where the table's block does not scroll vertically. It is declared from 600 px on .scroll > table > thead th, with the page's surface behind it. .scroll is a scroll container (overflow-x auto makes it one on both axes), so the head sticks to the top of that block, which never scrolls up or down. On a page scroll the head therefore leaves with its table: it never covers a row the walk clicks, but it does not stay in view either. Home's sessions table is in no .scroll and is left unstuck.
- **Queue and Appeals by lane (9).** The design: dense tables by lane, each lane's heading with its count. Each screen keeps one table.queue, with the lane as its first column and no lane headings. Splitting the table or adding a heading would add elements, and the walk pins the rows by position (rows.count() of 2 and 3, nth(1) and nth(2), the hrefs of table.queue a in order).
- **Home's lines (9).** The design: the overview lines as a stack of panels, each a title, a count in tabular figures and its link, alerts first. The two blocks that have a title, Authorities and Sealed files and programs (div.authorities), are raised panels (surface-1, a line-low edge, 12 px corners) whose lines stand on their washes. The panels, the lanes list and every table use tabular figures. The other lines stay sentences where they are, because a count of its own or a new order would change markup and words the unit tests pin. Home already puts its alerts first.
- **Which wash each banner takes (9, 4.8).** The banner of a suspect report (.banner.suspect, on the case and in the composer) takes the restricted wash, since it says what nobody may open. The Art. 18 check (p.banner.art18), which was red, and the author's standing (section.panel.standing) take the review wash: they ask for a check, and they restrict nothing. Each has a 4 px rule at its start and its own on-wash text. Banners are 40rem wide at most, as panels are. A link or hint inside a wash takes the wash's text colour, which the test holds to the wash.
- **Error lines carry the rule too (9, 4.8).** Every .error line (form errors, the overdue clock, Home's late lines) has the 4 px restricted-ink rule at its start and square corners on that side, while a .notice line has none. An error and a notice therefore differ by shape as well as colour, and the error keeps its edge in forced colours.
- **The order's clock (9).** The clock is the paragraph after the h2 of the section labelled by order-title on the order's page and .orders > .block > .frame + p in the list, at 1.0625rem (1.25rem from 600 px) in the mono stack at the regular weight. When overdue, it is Order.tsx's .error line: restricted-on-wash on the restricted wash, ruled, with words that begin Overdue. The class follows the order's state as the API answers it, so a deadline that passes while the page is open turns red at the next read. At 360 px the clock ends about 470 px down the page, within the walk's 740.
- **A measure for prose (9).** Not in the design: main p, the home panels and .block cards are at most 48rem wide. The order, contact and home screens no longer run 150-character lines across a 1280 px window. Nothing narrower changes.
- **Disabled controls (9, 10).** A disabled button is ink-low on surface-2 with a line-low edge (at least 5.32:1) in place of opacity 0.6, so the words that often say why it is greyed stay readable. The red primary button changes only its border on hover, since no red fill keeps white at 4.5:1 in both schemes.
- **The design's file name (header, 13).** Line 5 and section 13's Task 10 name the design docs/superpowers/specs/2026-10-21-interface-and-experience-ui-design.md; the file committed before Task 1 is docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md, the name that the README's The interface, the main design's section 9 (2026-10-21) and the 2c design's section 20 cite.
- **Who sees this, by its keys (8.7, 6.14).** Section 8.7's table writes four keys that ui-words.ts has held under other names since Task 4: reach.blocks is reach.blocked, reach.ownLists is reach.feeds, reach.ownReply is reach.reply and reach.onlyYou is reach.private. Their sentences are the table's, except that reach.ownReply's last sentence, Replies never enter Explore., is the key reach.replyExplore of Task 4's words.
- **Line citations that no longer hold (3.2, 4.2, 8.8, 8.10, 13).** As they stand after Task 9: AppShell.tsx:39, the nav's Settings item (8.8), is AppShell.tsx:72 and opens /settings since Task 8 (it was right at 1222b87); explore.test.tsx:707-718 (8.8, 13) are :706-717, privacy's Switch line :717 (:718 at 1222b87); explore.test.tsx:864-866 (4.2, 13), the storage list, is :862-863 (already off at 1222b87, where it stood at :863-864); passkeys.test.tsx:454-458 (13, Task 8) is :456-462, with the label Sign in with a passkey at :459 (the same lines at 1222b87, so :459 was already outside the range); lifecycle.test.tsx:41 (8.8, 13), PAGES, is :42 (as at 1222b87); passkeys.test.tsx:520-536 (13, Task 8), the lockdown's sentences, is :524-539 (already :524-538 at 1222b87).
- **The one title without the suffix (8.10, 8.1, decision 16).** Every title ends in ' - korbat' but one: title.token, the three token pages' title, is korbat alone (8.10's table), and shell.test.tsx:270 allows it by its key (Task 8).
- **The console walk's queue rows (13, Task 9).** Section 13's nine clicks on table.queue tbody tr are nine uses of that selector in apps/admin/test/browser/console.browser.ts: three clicks on a row's Open the case (:552, :592 and :1160, all at 1280 by 900) and six reads of the rows (:447, :1141, :1211, :1212, :2621 and :3057), the last two at 360 by 740.
- **The console's banners (9).** Section 9 names the banners as .banner.suspect, the standing and order banners. The console has two banners, .banner.suspect (on the case and in the composer) and .banner.art18 (on the case); the author's standing is section.panel.standing, drawn as a banner on the review wash, and an order has no banner: its clock past the deadline is an .error line (Task 9).
- **Left for later (9, 1.5, 14).** Section 14 gains, from Task 9, the console's lane headings with their counts in Queue and Appeals, Home's count-and-link panels and Enroll's labelled key block (section 9), each a change of markup whose unit-test and walk pins move with it; and, from Task 8, the label props, placeholders and action notes that the rewritten settings, sign-in and token screens still carry in their source, held there word for word by lifecycle.test.tsx :145-245 and passkeys.test.tsx :321-461, which a later i18n pass moves into the words modules together with those pins.
- **No file is left on a legacy list (1.5, 4.2, 13).** Section 13 asks section 15 to record the files still on LEGACY_TEXT_FILES: there are none, and LEGACY_COLOUR_FILES is empty too (Task 8); both stay exported, empty, from apps/app/test/legacy-files.ts. a11y.test.tsx, appended after its line 221, holds REWRITTEN_FILES, the 107 .tsx files of src/app and src/components that the sub-project added or rewrote (git diff --name-only --diff-filter=AM 6babae1 b2fc637), sorted; it checks that each is still in src and fails when either list names one of them or is not empty. Listing PostCard.tsx in LEGACY_TEXT_FILES for one run failed it.
- **The rail's items span the rail (7.1, 12.3).** The walk-through found the tablet rail's 64 px items breaking Bookmarks, and signed out Appearance, inside the word at 768 px at the Default text (Bookmark over s), which the clipped-label rule passes, since a label wraps rather than clips (1.5). Each rail item is now 80 px, the rail's whole width, as a tab bar item spans its quarter, with its focus ring drawn inside (FOCUS_RING_INSET) and its 3 px accent bar at its start, so both labels keep one line at Default and Larger. The app's browser check gains step 40, which holds every label of the nav to one line at Default and Larger in the tab bar at 360, the rail at 768 and the full nav at 1280, signed in and signed out; only step 11's extreme sizes may break one. The check has 40 runs.
- **A time in a console table keeps its line (9).** The walk-through found Appeals at 1280 by 900 breaking its Filed and window times at their hyphen (2026-10- over 20 13:56). From 600 px every time in a table cell is kept on one line (td time, where only the audit log's were), and apps/admin/test/tables.test.ts holds the rule and the time elements in the cells of Appeals, the audit log and the queue.
- **A link inside a console sentence on a phone (9, 12.3).** At 360 px every console link is a 44 px block (3a's phone rule, which the console walk's cleanOnPhone holds with no inline exception), so a link inside a sentence, such as Contact point in Home's line on the authorities' mail, stands on its own line and the sentence goes on after it with its full stop. The app's target rule has WCAG 2.5.8's inline exception (12.3); giving the console the same changes its phone rule and its walk together, and is left for later.
- **The walk-through (13, 12.3).** A throwaway script after Task 8's .data/debug/shots8.ts, kept in the clone's ignored .data/walk10.mts, walked one web export: the check's 15 layout pages at 360 by 740, 768 by 1024 and 1280 by 900 in Light, Dim and Dark, each with reduced motion on and off, and the New post sheet and the lightbox about 100 ms after they start to open, 342 screenshots, running the check's own rules (sideways scroll, clipped labels, the phone's targets, contrast as drawn) on every page, Dim included, where the check runs its layout steps in Light and Dark only; the rules found nothing. A copy of Task 9's .data/ui9-shots.mts took the console's 12 screens and sign-in at 360 and 1280, light and dark, both motion settings, 112 screenshots, whose two motion settings drew the same pixels but for clocks. The eye found the two defects above, both fixed, and the phone links left for later; after the fixes the 768 px width and the console were walked again, and the check's own 256 screenshots of its 40 steps were looked at too. In the walk the lightbox from post 8 shows its blurhash over the image's 4:3 box while it grows, then the fixture's square file, and an overdue order's clock stays on the green wash, since the fixture never turns an order overdue: both the fixture's, not the app's. The screenshots stay in korbat-scratch/tools-ui/walk/, never in git.
- **Third-party notices name clsx too (13).** Section 13's list of notices names the fonts, Lucide, class-variance-authority, sonner and sonner-native; the README's Third-party notices also names clsx 2.1.1 (MIT), class-variance-authority's one dependency, which ships in the web bundle with it, and says that the class-variance-authority package carries no NOTICE file.
- **Section 5's pointer moves the main design's later lines (13).** The main design marks section 5 delivered with one line under its heading, so every later line of that file moves down by one: the 2026-10-19 amendment's lines 201, 203 and 204 of section 5 are now 202, 204 and 205, and its lines 291 and 293, which row UI's insertion of 2026-10-20 had already moved to 292 and 294, are now 293 and 295. The 2026-10-21 amendment cites section 5 by the new numbers.
- **The mock scan's own limit (12.4, kit.test.tsx).** The test that each native module's mock gives every name the source imports reads every source file and imports six modules: about 3 s alone, but 21 to 24 s inside the workspace's unit gate on a loaded machine, past the gate's 20 s. It carries its own limit of 60 s, set on its closing line so no later line number moves (found by Task 10's runner, twice).
- **The walk waits for the app's main region (12.3).** On a loaded machine the app drew its shell after the network was idle, and steps that measured at once read nothing (Task 10's runner met it in steps 6, 15 and 32, a different step each run). `visit()` now waits for `[role="main"]`, which the shell and PublicFrame both draw, and the app's browser config gives a step one more try; a step that fails for its own reason fails twice.
```

### Replace `docs/superpowers/specs/2026-10-22-engagement-2d-design.md` (whole file)

````markdown
# korbat engagement (sub-project 2d): design

Status: approved for the dry run under the owner's standing instruction to finish the app (2026-10-20); decisions marked (owner) in section 2 were made by the orchestrator and can be changed by the owner, and those marked (counsel) need a lawyer's confirmation before korbat is opened to the public. Inputs: the main design's row 2d and its amendment of 2026-09-30, the later designs that touch it (2a, 2b, 1b, 3c to 3f, the UI sub-project and 3b), the code at the time of writing, and the official documentation of link previews. One review round (build fit and security; people and values) shaped this text.

Inputs, as cited: korbat-scratch/research-2d/inputs.md ("inputs N"), the main design
docs/superpowers/specs/2026-09-03-korbat-design.md ("main design"), and the designs in the same folder, named by their
sub-project ("the 3c design", "the UI design"). Paths are relative to the repository root
C:/Users/Lenovo/Desktop/cool/korbat unless they start with korbat-scratch. Written against main at 0bc2dcc and
checked against 3b's replay (main at ebc8778): every name 3b adds (`posts.import_job_id`, `PostView.imported`, its
migrations 0043 to 0048) is used as 3b's code has it.
Committed before Task 1 as docs/superpowers/specs/2026-10-22-engagement-2d-design.md (section 13).

## 1. Context and scope

### 1.1 What the owner asked

On 2026-09-30 the owner added an engagement slice to the roadmap, before sub-project 4: in-app notifications for
replies, mentions, quotes and follows; mentions stored as data; avatars through the 2b pipeline and sub-project 3's
image checks; share cards for public posts and profiles, served by korbat itself; and help on a new account's first
visit (main design, section 6, row 2d, and section 9, 2026-09-30). The UI sub-project then handed 2d the uploaded
avatar in the monogram's place and the author's per-post "hide counts" (UI design, sections 1.4 and 14). On
2026-10-20 the owner said "finish the app". The owner is not asked questions during the design: every choice a
reasonable owner might want to change is listed in section 2.

### 1.2 The idea in one paragraph

korbat tells a person what other people did with them, and only when they come to look. A reply, a mention, a quote
or a follow writes one row for its recipient in the same transaction as the act, under the recipient's own rules
(who may reach them, and which kinds they want at all), and never across a block or from a muted account. The rows
are read on one screen, Activity, through the same visibility rules every other read of a post uses, so a reply that
moderation later withholds simply stops being shown, and nothing outside that screen counts or badges anything.
Follows are grouped by day; conversations never are. The decisions korbat told the person about their own content
appear in the same list, read only from the reads that already hide anything held. A handle typed in a post is stored
with the account it named at that moment and links to it only while that account still holds the handle, so a person
who renames is not found through old posts. An avatar is an upload like any other, made square by the worker, checked
like every image, served under the same cache rule, and reset by a moderator the way a display name is. A link to a
public post or profile shared elsewhere unfurls into a card that names only korbat, or, once its author has turned
previews on, shows exactly what a signed-out reader sees, built by the API and stitched into the web shell by Caddy,
while robots.txt turns away every crawler but the link-preview fetchers and search engines are asked not to index any
of it. A new account's empty Following feed becomes a short Getting started panel that points to Latest, Explore's
published rule and the handle box, and goes away by itself.

### 1.3 In scope

- **Activity.** The table `activity_items` and the per-account `activity_state` (the seen marker and the per-kind
  rules), written by `createPost` and `follow` in their own transactions and cleaned by `deletePost`, `block` and the
  purge; a retention job; the routes under `/api/activity`; the Activity screen with its tabs All and Conversations, its
  "New since you last looked" divider and its new-entries pill; the Activity page of Settings.
- **Moderation entries.** The decisions told to the author (3c, 3e, 3f and 3d's automated decisions) and 3d's author
  notices (releases, refused uploads, lost images) as entries of the same list, read only through the author-side reads
  (`toldToAuthor`, `authorNotices`) and one new told-only function for lost images.
- **Mentions as data.** The table `post_mentions`, one parser in packages/contracts shared by the server and the app,
  written by `createPost`, read into `PostView.mentions`, and drawn by `RichText` as links only where a mention was
  stored.
- **Avatars.** An upload of kind `avatar` in `post_media`, cropped square by the worker into the two usual file names,
  set and removed by its owner, served publicly under 3d's cache rule, gated by 3c's readers' test, held as evidence by
  an account case, reset by the new measure `reset_avatar` (with `restore_avatar`), sealed by an account case's seal,
  quarantined and released by 3d's paths, and erased with the account; the `Avatar` component's `src`.
- **Share cards.** Two API routes that answer a post's or a profile's card as a header, Caddy's `/post/*` and new
  `/u/*` handles that stitch it into a copy of the shell, a per-account switch for link previews (off by default), a
  `robots.txt` open only to the link-preview fetchers, and `X-Robots-Tag: noindex` on every page that names an account
  and on every API answer.
- **Hide counts.** A per-post switch, set by its author in the composer or the post's More menu, that hides the post's
  like and repost counts from everyone else.
- **First visit.** A Getting started panel in place of the empty Following feed's state, with the handle box on phones.
- **Migrations** named `activity`, `post_options`, `avatars`, `avatar_kinds` and `avatar_moderation`, numbered by the
  dry run after 3b's.
- The data export, the account's deletion and purge, the terms' privacy section and the README extended to all of
  the above; the app's browser check, the fixture API and the integration suite extended; crawler fixtures for cards.

### 1.4 Out of scope, and where it goes

- **Web push and mail for social events.** Not built (decision 9). Web push routes every person's notification
  metadata through a browser vendor's push service and needs the service worker sub-project 4 has not built; a mail
  about a reply is a re-engagement prompt. Native push stays in sub-project 5 (main design, row 5), where its design
  must keep decision 4's rule or reverse it explicitly.
- **Likes and reposts as Activity entries.** Not built (decision 3); they are the first candidates for a later change.
- **Mention suggestions in the composer.** Not built (decision 13): suggesting accounts from a typed prefix is a handle
  search, which korbat keeps out.
- **Named suggestions of accounts to follow.** Not built (decision 25); Explore is the published rule the Getting
  started panel points to.
- **Choosing the crop of an avatar freely.** The picker offers three positions along the longer side (decision 14); a
  free crop with pinch and drag needs a gesture library on the web, which the bundle has no room for.
- **A JPEG card image.** Cards use the WebP files korbat already serves (decision 22); a JPEG variant waits for evidence
  that an unfurler that matters drops WebP.
- **Search engines indexing korbat.** Refused by design (decision 20).
- **Expo SDK 58 and server rendering of the React app.** Not adopted; the card is stitched into the existing shell
  (decision 19).
- **Editing posts.** korbat has none, so a mention is added only at creation and removed only by deletion or
  moderation (section 4.4).
- **Native apps.** The Activity screen, the avatar picker and the cards work on the web first; sub-project 5 brings
  them to iOS and Android with their own file picker.

### 1.5 Rules this design keeps

- **A chronological feed and no engagement dark patterns.** Nothing outside the Activity screen counts, badges or
  marks new activity: no dot, no number, no word on the nav item, nothing in the page title, nothing while korbat is in
  the background, no mail and no push (UI design, decision 7 and section 1.7; AppShell.tsx's "Nothing here counts or
  badges anything"). Inside the screen a divider and a pill say what is new, as the feed's pill does.
- **Calm.** Follows are grouped by day; replies, mentions and quotes are never grouped, since each is a conversation to
  answer. Activity entries are never toasts (UI design, section 5.4).
- **Pseudonymity.** No contact upload, no phone number, no "find friends" step. A share card shows what the public page
  shows signed out and no more, never a count, a moderation state, a standing or an email, and previews of a person's
  posts and profile are off until that person turns them on.
- **Moderation visible and never leaked.** An entry about another person's act is shown only while its post is
  visible to the recipient through `postAccess`; an entry about moderation comes only from the reads that already hide
  a held notice; nothing reveals a block, a mute, a suspension's details or a state the recipient may not see.
- **Blocks both ways, everywhere.** No entry, mention link or card crosses a block in either direction, and a block
  deletes the pair's entries in the transaction that makes it, as it deletes their likes and reposts.
- **Data minimisation and retention with an end.** An entry holds ids and a kind, never a text; it lives 90 days; the
  seen marker and the rules live as long as the account; everything goes with the account's purge.
- **Same rules as every image.** An avatar passes 2b's pipeline and every gate of 3c, 3d and 3e; no program takes a
  measure on an account (3d design, section 16), and an avatar R1's check flags is kept from others only while the
  owner's hold for review is on, as a post's image is (7.6).
- **Self-owned.** No third-party service, library or font. No new package: every piece is built from what korbat
  already pins (sharp in the worker, Hono, Drizzle, zod, Caddy's standard templates module).
- **Migrations.** Hand-written SQL where needed, row-level security and grants as every earlier sub-project; no
  existing migration is edited; 2d's migrations take the next free numbers after 3b's.
- **The UI's language.** Every new sentence in a words module, every screen titled from `TITLE_WORDS`, the kit's
  components and tokens, labels that never clip at 360 px, and the app's JavaScript within its stated budget
  (section 10.9).

## 2. Decisions flagged for the owner

Each decision is made and built as written. The owner can change any of them; the alternative says what changing it
costs. All are marked (owner); those a lawyer should confirm are marked (counsel) as well.

### 2.1 Activity

1. **The name (owner).** Chosen: "Activity" for the screen, the nav label and the Settings page; `activity` for the
   API module (apps/api/src/activity/), the contracts (packages/contracts/src/activity.ts) and the job; `activity_items`
   and `activity_state` for the tables. "Notice", "notify" and "alert" stay 3c's, 3d's and 3f's, whose tables, role
   and service already use them (inputs 2.5). Alternative: "Notifications", the common word, whose 13 letters break in
   the 80 px rail where "Bookmarks" already needs all of it (AppShell.tsx's comment), and which collides with 3f's
   `notify` service and `authority_notifications` in every search of the code.
2. **The kinds of entry (owner).** Chosen: four social kinds, `reply` (to the recipient's post), `mention` (the
   recipient's account named in a post), `quote` (of the recipient's post) and `follow` (of the recipient); and
   moderation entries for every notice korbat already tells the recipient about their own content or account: a
   decision told to its author (3c, 3e and 3f's decisions and 3d's automated ones), a release of sealed images, a
   refused upload and a lost image (3d design, section 16). Alternative: moderation stays in Settings, Cases and mail
   only; 3d asked for its four notices to be entries if 2d builds a list.
3. **Likes and reposts do not notify (owner).** Chosen: no entry for a like or a repost. 2a's rule that liker lists
   are never exposed to anyone stands (2a design, Decisions, Visibility), and a stream of small approvals is the
   engagement loop korbat leaves out. Alternatives: named reposts grouped per post and day (a repost is already public
   on the reposter's profile, so it reveals nothing new; it costs one kind and one setting); likes as an anonymous count
   per post since the last visit ("12 likes on your post"), which says only what the public count says; named likes,
   which reverse 2a's decision and need the main design amended.
4. **How a person learns that something arrived (owner).** Chosen: only by opening Activity. Nothing on the nav item,
   in the page title, on the app icon or anywhere else says that something is new, and nothing asks for new entries
   unless the Activity screen is open. Alternative: an opt-in setting, off by default, that puts the word "new" on the
   Activity nav item; it is the first sign of activity on navigation korbat would draw, and it costs one request on
   every route's first load, the third of the three the UI design's section 11.3 allows.
5. **The seen marker lives on the server (owner).** Chosen: one time per account, `activity_state.seen_at`, moved
   forward when the Activity screen shows its first page, so an entry is marked new once on every device. This is the
   first per-account reading marker korbat keeps on the server; the feed's reading place stays on the device (UI design,
   decision 8), because a feed's place is per device and per tab while Activity is one list per account. Alternative:
   the marker on the device, cleared at the session's end like `korbat.place`; each device then shows the same entries
   as new.
6. **Grouping (owner).** Chosen: follows are grouped by the UTC day they arrived in ("Ada and 4 others followed you"),
   with up to three names and the count; replies, mentions, quotes and moderation entries are never grouped. A day is
   a fixed bucket, so a group never splits across pages; a group is labelled with the time of its newest follow, as
   every entry is, so a UTC day never shows as a day in the reader's own zone. Alternative: Bluesky's 48-hour window,
   which moves as follows arrive and needs grouping in the client across page edges; or no grouping at all.
7. **Who may reach a person (owner).** Chosen: one setting per kind on Settings, Activity: replies, mentions and quotes
   each "Everyone", "Accounts older than 2 days", "Accounts you follow" or "Off"; follows "On" or "Off"; every default
   is Everyone or On. "Accounts older than 2 days" leaves out accounts made in the last 48 hours (the age korbat's write
   limits and Explore already use, a rule and never a reputation), which quiets a pile-on by fresh accounts without
   silencing everyone the person does not follow. A setting that excludes an act means no row is written; a change
   applies to new acts only. Alternatives: no age choice, which leaves "Accounts you follow", Off, mutes and blocks as
   the only answers to a sock-puppet pile-on; or keeping excluded rows and hiding them, which stores more.
8. **A mute silences Activity (owner).** Chosen: while a person mutes an account, its acts write no entry for them and
   its earlier entries are hidden; an unmute shows the earlier ones again. A mute stays silent and one-way, so the muted
   account learns nothing. Privacy's explanation, "A mute only hides an account from your timelines", changes to name
   Activity too (section 10.8). Alternative: mutes stay timelines-only, as 2a built them (social/repo.ts:21).
9. **No web push and no mail (owner).** Chosen: neither. Alternative: web push behind an owner's switch, off by default,
   which sends when and how often each person is notified to Google, Mozilla or Apple, needs a service worker and VAPID
   keys, and is a re-engagement channel; or a daily mail digest, which is one.
10. **Entries after the fact (owner).** Chosen: an entry whose post is withheld, removed or disabled is hidden at read
    through `postAccess` and shown again if the post is restored; an entry whose post its author deletes is deleted in
    the deletion's transaction; a block deletes the pair's entries both ways; a follow entry is shown only while the
    follow stands; entries an account caused stay when it is later suspended or terminated, as its posts stay visible
    with no label (3e design, line 725); an account's purge deletes every entry it caused or received. Alternative:
    keep a deleted post's entries as "a post that was deleted"; or hide a suspended actor's entries, which would tell
    the recipient that the actor was suspended.
11. **Retention (owner, counsel).** Chosen: an entry is deleted 90 days after it was written, by the job
    `activity-retention`; the seen marker and the settings live until the account goes. Alternative: the newest 1,000
    entries per account, which keeps a quiet account's entries for years.

### 2.2 Mentions

12. **Which mentions count and what they link to (owner).** Chosen: the first 20 distinct handles of a post, in text
    order, that name a live account are stored with that account and the handle as written, whatever blocks exist;
    whether one links is decided per reader (a reader who blocks, or is blocked by, the mentioned account sees plain
    text) and whether it notifies per recipient (no entry crosses a block, 5.2), so the stored text never tells a third
    reader that a block exists. A stored mention links only while its account still holds the handle as written: after
    a rename it shows as plain text, so a person who renames to step away is not found through old posts, and the entry
    already sent stays. The first 10 stored notify, the author and a reply's parent author (who gets the reply entry
    instead) not counted. A reply notifies its parent's author only, never the thread's other authors. A post with more
    handles is accepted; the rest stay plain text. Alternatives: refuse a post that names more than 10 accounts, which
    turns a limit into a mistake to correct; let a stored mention follow its account's current handle, which leads every
    post that ever named a person to their new name (the rename screen and the README would then have to say so); leave
    a mention across a block unstored, which shows every reader as plain text that the two accounts had a block.
13. **No mention suggestions (owner).** Chosen: the composer suggests no account from a typed prefix; a person types
    the whole handle, as the handle box asks today. Suggesting from a prefix is a handle search, a ready tool for
    finding accounts to target, which korbat keeps out (main design, 2026-09-30, "Unchanged"). Alternative: an
    exact-handle check while typing, through `GET /api/profiles/:handle`, that marks a typed handle as found; it adds a
    request per handle and tells nothing the handle box does not.

### 2.3 Avatars

14. **Storage and crop (owner).** Chosen: an avatar is a `post_media` row of the new kind `avatar`, uploaded through
    `POST /api/media` with `kind=avatar`, so the owner, status, files, hashes, R1 score, matcher, holds, purge outbox,
    quarantine and erasure of 2b and 3d apply to it, the last three with the small changes of sections 6.4 and 6.5
    (they knew only images on posts). The worker crops it square at one of three positions
    along the longer side (start, centre, end), which the picker shows over the local file before upload, and writes
    a 400 px square as `large.webp` and a 128 px square as `small.webp`; the uncropped image is never stored.
    Alternative: a table of its own (as 3d's section 16 assumed), with each gate rebuilt; or a free crop in the browser,
    which needs a gesture library the bundle has no room for.
15. **What the checks do to an avatar (owner).** Chosen: an upload the matcher refuses is refused and held as any
    upload; an avatar whose R1 score is at or over the threshold, or that the matcher flags without acting, opens a
    program's finding on an account case with the avatar in scope and takes no measure, whatever
    `AUTOMATION_R1_ACTS` says, because no program takes a measure on an account (3d design, section 16); a moderator
    decides, with `reset_avatar`. While `AUTOMATION_R1_ACTS` is on, an avatar whose R1 score is at or over the threshold
    is also kept from everyone but its owner (the monogram shows) until a person decides, as an image in a post is
    withheld (7.6); with it off, nothing changes. Alternatives: refuse to set such an avatar, which tells the person how
    to get past the check, which is why 3d did not build the composer's warning (main design, 2026-10-19); show a
    flagged avatar to everyone until a moderator decides, whatever the owner chose for R1.
16. **Moderation of an avatar (owner).** Chosen: the account-case measure `reset_avatar`, interim or final, with its
    reversal `restore_avatar`, as 3c's `reset_display_name`: a compare-and-set against the report's snapshot, the
    monogram as the placeholder, written once; the author may set a new avatar at any time, judged on its own if
    reported, except the very picture the moderator removed (the same file by its SHA-256), which is refused as the
    account's picture for 30 days with words that say why; the reversal puts nothing back. An account's report
    snapshots the avatar by reference and holds its row; an account case's seal reaches the account's avatar rows as it
    reaches its posts' images. Alternatives: hold the avatar against its author's edits for the measure's length, which
    is a partial suspension 3e reserves for measures with a statement of their own; accept the same picture again at
    once, so that every return of an impersonating photo needs a new report and decision.
17. **What a suspended account may still change (owner).** Chosen: its avatar stays, with no label, as the profile does
    (3e design, section 2), and the account cannot set a new one while suspended, as it cannot change its display name.
    It may still remove its picture, turn link previews off and hide a post's counts: each only reduces what others
    see, as withdrawing from Explore does today; setting an avatar, turning previews on and showing counts stay refused
    by 3e's predicate. The route walk's `SUSPENDED_WRITES` records each (9.4). Alternative: refuse all three while
    suspended, which leaves a person whose picture or name is being passed around during a suspension only the deletion
    of the whole account.
18. **`profiles.avatar_path` goes (owner).** Chosen: the column, never written since 1b, is dropped; the profile's
    avatar is the `post_media` row whose `profile_id` names it. Alternative: keep the dead column and its grant.

### 2.4 Share cards and indexing

19. **How a card is served (owner).** Chosen: the API answers `GET /api/cards/post/:id` and
    `GET /api/cards/profile/:handle` with the card's head block, built and escaped in TypeScript, in one response header
    (`Korbat-Card`, base64); Caddy's `/post/*` and new `/u/*` handles ask it, as `/post/*` asks the status route today,
    and serve `card.html`, a copy of the exported shell made at the image's build with one template action that
    inserts the decoded header, through Caddy's standard `templates` module. Nothing the API sends is evaluated as a
    template. Alternatives: the API answers the whole document (the API image then needs the web export, built twice
    with the same hashes); answers by User-Agent to known crawlers only (every unlisted fetcher gets the bare shell);
    expo-router's server output on Expo SDK 58 (a new service and an SDK move for a head).
20. **No indexing and no collection (owner, counsel).** Chosen: `robots.txt` allows `/post/`, `/u/` and `/api/media/`
    only to the link-preview fetchers the design supports, named by their robots.txt tokens (Twitterbot,
    facebookexternalhit, Slackbot-LinkExpanding, Discordbot, LinkedInBot), so they still make cards, and disallows
    everything to every other agent: search engines, archives, data brokers and crawlers collecting text and images for
    model training. Pages that name an account keep `X-Robots-Tag: noindex` (every page of the app's site except `/`,
    `/rules`, `/transparency`, `/explore/about` and `/terms`), every API answer carries it, and every card has a robots
    meta tag. A search engine's index of korbat would rebuild the keyword search korbat keeps out. A crawler that
    ignores robots.txt is out of korbat's reach; what the terms may forbid is counsel's (11.3). Alternatives: a
    robots.txt open to every agent, relying on `noindex`, which a collector never reads; or index public posts and
    profiles, which makes korbat searchable by anyone's words through a third party.
21. **Link previews, per account (owner, counsel).** Chosen: off by default for every account; while off, a shared link
    to the person's posts or profile unfurls into a generic card that names only korbat. The switch on Settings,
    Privacy, "Show a preview when someone shares a link to my posts or profile", turns previews on, with one sentence
    saying what a preview shows and where; no prompt, panel or banner asks the person to turn it on. A card shows only
    what a signed-out reader sees, but other platforms keep their copy beyond korbat's reach (X for about 7 days, Meta
    until a re-scrape, every Mastodon instance its own), so a deleted post may still show there. Whether "on" by default
    could suit Art. 25(2) GDPR and, with members from 16, Art. 28 DSA is counsel's (11.3). Alternative: on by default,
    with a row of the Getting started panel pointing to the switch, which hands each shared post's name, text and
    picture to other platforms' stores without the person's act.
22. **What a card shows (owner).** Chosen: a post's card: the author's display name and handle as the title, the
    post's text cut to 200 characters as the description (an imported post's label first), its first image that is
    shown to everyone with its description, else the author's avatar, else no image; the time it was posted. A
    profile's card: the display name and handle, the bio cut to 200 characters, the avatar. Never a count, the
    verified badge, a moderation state, a standing or anything a signed-out reader does not see. Cards use the WebP
    files korbat serves. Alternative: a JPEG card variant from the worker for Meta, whose documentation lists only JPEG,
    GIF and PNG; counts in the description.
23. **The served page title (owner).** Chosen: the `<title>` the server sends stays the shell's "korbat", and the
    app's own title ("Post - korbat", "Profile - korbat") replaces it once the bundle runs; names appear only in the
    card's Open Graph tags, which every unfurler reads before `<title>`. A browser's history then never holds a handle
    (UI design, decision 16). Alternative: the card's name in `<title>`, which the history keeps when the bundle fails
    to load.

### 2.5 The screens, the budget and the record

24. **Where Activity sits in the nav (owner).** Chosen: second, after Home, for an account: Home, Activity, Bookmarks,
    Profile and Settings in the rail and the full nav; on a phone the tab bar keeps four items, Home, Activity,
    Bookmarks and Profile, and Settings is reached from the profile's settings button, which every own profile already
    shows (the UI sub-project's commit 61b1134) and whose label changes from "Security and privacy settings" to
    "Settings", since it is then the phone's only way to Appearance, Activity, Account and Cases (10.1). Five items in
    the 360 px tab bar leave 72 px each, and the walk-through found that "Bookmarks" breaks in the word below 80 px
    (AppShell.tsx's comment on the rail). This ends the shell's rule that the nav has the same items at every width (UI
    design, section 7.1), for the phone alone. Alternative: five items on a phone, with "Bookmarks" shortened or broken;
    or Activity reached from Home's header, which hides it.
25. **First-visit help (owner).** Chosen: while an account's Following feed is empty, Home's Following tab shows a
    Getting started panel in place of today's empty state: Latest, Explore and how it picks, the handle box (which
    phones do not otherwise see), the profile's settings with the avatar, and the rules, one line and one link each.
    Nothing is stored: the panel ends by itself with the first followed account's first post, nothing is dismissed and
    nothing syncs. No account is suggested by name. Alternative: a one-time card dismissed with "Not now" kept on the
    device, as the passkey suggestion is; or named suggestions by a published rule (for example accounts with posts in
    Explore now), never follower counts alone and never reputation.
26. **Hide counts, per post (owner).** Chosen: the author of a post may hide its like and repost counts, in the
    composer's options before posting or from the post's More menu at any time after; everyone else then receives no
    number for them in any answer, the answer to their own like or repost included (the API sends null), while reply
    and quote counts stay, as the reader's own setting has it (UI design, decision 15). The author keeps seeing the
    numbers on their own post. Alternative: leave it out of 2d; it was listed for 2d by the UI design (sections 1.4
    and 14) and not by the 2026-09-30 amendment.
27. **The JavaScript budget (owner).** Chosen: 2d adds at most 20 KB (20,480 bytes) of gzipped JavaScript to the web
    export as 3b's replay leaves it. The cap at 2d's start is 832,257 bytes, the baseline of 1222b87 plus 120 KB, set by
    3b's Task 7 under the orchestrator's rule for an overrun (inputs 1.3), when the export measured 812,307 bytes
    (apps/app/test/browser/app.browser.ts:622-623; 791,297 at 0bc2dcc). If the export after 2d goes past the cap, Task 5
    raises it to 852,737 bytes, the baseline plus 140 KB, by editing those two lines, as an amendment of section 15
    flagged (owner). Every icon is imported by its path, the
    avatar's crop is the worker's, and no library is added. Alternative: a smaller Activity screen without tabs or the
    pill, which saves a few kilobytes and leaves the cap alone.
28. **The data export (owner, counsel).** Chosen: the export gains the avatar's file and its size, the link-preview
    switch, each post's mentions as the handles written and its hidden-counts switch, and a member `activity` with the
    seen marker, the settings and every row the account received that korbat still holds (kind, time, the post's id and
    the actor's handle at the time of export), each with whether it is shown and, if not, why (muted, post not visible,
    unfollowed, actor deleted), a post not visible to the person named by no id. The right of access reaches what korbat
    holds, not only what it draws. Alternatives: only the rows the list shows, which hides from the person what korbat
    kept about them; or leave the entries out.
29. **Deleting an account removes its avatar at once (owner).** Chosen: the purge that the deletion request runs at
    once (1b) deletes the avatar's row with the account's other images in its `within`, and serving refuses an avatar
    whose profile is deleted from the same transaction on; a row that a case holds, a seal lists or a frozen case keeps
    stays until nothing keeps it (`post_media_keep`, 6.4 and 6.5), served to nobody. Alternative: keep the picture of
    a deleted account until the evidence of every case about it is erased, which shows a "Deleted account" with a face.
30. **Cards and the API's global limit (owner).** Chosen: a card's question counts against the visitor's address under
    the API's global limit, as the status route's does, and a 429 falls back to the plain shell with 200, which loses
    only the card. Alternative: a limit of its own for the card routes, which lets a burst of shares from one platform's
    crawler addresses through at the cost of another number to tune.

## 3. What exists

A short account of inputs.md, which holds every line number; the paths here are the ones 2d changes.

### 3.1 The brief and what changed it

- The main design's row 2d (line 223) and its 2026-09-30 amendment (lines 327 to 338) are the brief. The UI sub-project
  (2026-10-21) delivered client-side titles on every screen, the light themes and the monogram `Avatar`, and handed 2d
  uploaded avatars, mentions as data, share cards, first-visit help, notifications and the author's per-post "hide
  counts" (UI design, lines 36 and 1097). Its decision 7 (the new-posts pill is the only sign of new posts), decision
  8 (the reading place on the device), decision 16 (a title never names an account) and decision 22 (monograms until
  2d) bind this design (inputs 1.3).
- 3b (2026-10-22, built by ebc8778) adds `posts.import_job_id` and four more import columns, `PostView.imported`,
  the Imported tab, migrations 0043 to 0048, and says that 2d's parser skips imported posts and that their cards carry
  the provenance label (3b design, sections 5.3, 6.2 and 14).
- 3d's section 16 asks 2d to bring avatars under 3c's gates and 3d's quarantine, outbox, hashing and public header, and
  to make 3d's four author notices entries of any list 2d builds. 3e's and 3f's designs ask every new write to use
  3e's predicate and every new reader of a post to go through `postAccess` (inputs 1.5).

### 3.2 Posts, the graph and their writes

- `posts`, `follows`, `blocks`, `mutes`, `likes`, `reposts` in packages/db/src/schema/content.ts; every table has row
  level security with one policy for the API role (`fullAccess`, packages/db/src/schema/helpers.ts). Posts are never
  edited.
- The writes are transactions in apps/api/src/social/repo.ts (`createSocialRepo`): `createPost` (guardPair across a
  block, `lockActing`, the insert, counters, `judgeActing`), `deletePost` (tombstone), `like` and `repost`, `follow`
  (answers whether a row was inserted), `block` (removes follows and engagement both ways), `mute`, and
  `purgeProfile`. Write limits per account live in apps/api/src/social/tiers.ts and are counted in Valkey
  (apps/api/src/social/limits.ts).
- Reads go through `postAccess` (apps/api/src/social/visibility.ts:20-38) and the SQL fragments of repo.ts (`visibleTo`,
  `otherNotBlocked`, `otherWelcome`). Views are built in apps/api/src/social/views.ts; contracts in
  packages/contracts/src/social.ts (`Author`, `PostView`, `PostCounts`, `ProfileView`).
- 3e's predicate `liveNotSuspended` (apps/api/src/lib/standing.ts) judges every write by the acting account; the
  architecture test (apps/api/test/architecture.test.ts, `STANDING_PREDICATE`) pins the files that may name it and how
  many times each, and the route walk (apps/api/test/integration/standing-route-walk.test.ts, `SUSPENDED_WRITES`)
  records what a suspended account gets from every write route.

### 3.3 Mentions today

`RichText` (apps/app/src/components/social/RichText.tsx:8) links every `@handle` it finds to `/u/<handle>` in the client
only. The token has no right boundary, a renamed account's old mentions open "This account is not available", and
nothing is stored or notified (inputs 2.3). A handle once held stays that profile's for good, a deleted account's
included (`handle_history`, packages/db/src/schema/identity.ts), so no other account ever receives an old mention's
link. Post text is normalised and refuses bidirectional and zero-width characters (packages/contracts/src/text.ts), and
handles are ASCII `^[a-z0-9_]{3,20}$` (apps/api/src/auth/handles.ts), so a handle cannot be disguised in a post.

### 3.4 Images

- An upload is `POST /api/media` (apps/api/src/media/flows/upload.ts), a `post_media` row (owner, status, `post_id` and
  `position` once attached, `moderation_state` derived from the ledger, `hold_until`, `erased_at`), and a file the
  worker (apps/worker/src/pipeline.ts, no network) turns into `large.webp` (2,048 px) and `small.webp` (1,024 px) with a
  blurhash and, while 3d's tools are on, an R1 score and a PDQ hash (packages/media-protocol/src/limits.ts and
  result.ts). The sweeper (apps/api/src/media/sweeper.ts) deletes an upload left on no post for a day.
- Serving (apps/api/src/media/flows/serve.ts) joins the image to its post (`fileAccess`, media/repo.ts:287) and answers
  a visible image of a visible post with `public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0`; an
  image on no post is not found for everyone.
- 3c's ledger derives every image's state (`moderation_apply`, last replaced in migration 0028); an account case
  resets the display name or the bio (`reset_display_name`, `reset_bio`) and seals the account's posts' images
  (`seal_media`); evidence copies a post or a profile into `evidence_snapshots` and holds images by reference in
  `media_holds`. 3d writes an outbox row (`edge_purges`) from the triggers `post_media_purge` and `posts_purge`
  (migration 0035) whenever an image on a post stops being public, keeps sealed files in the `media-quarantine` volume
  (`quarantine_files`, whose file names are `small.webp` or `large.webp`), and handles a refused upload, an image on no
  post, by its media id.
- `profiles.avatar_path` (packages/db/src/schema/identity.ts:13) exists, is granted to the API and has never been
  written; the purge sets it null.

### 3.5 The author's notices

The author-side reads are the only source of moderation entries: `toldToAuthor`
(apps/api/src/moderation/author-repo.ts:24) keeps every decision whose author was not told or whose notice is held out
of the chip, the Cases screen and the export; `authorNotices` (apps/api/src/moderation/release.ts:360) lists releases
whose notice is not held and refused uploads; a lost file's notice is mailed by 3d's dispatch from
`quarantine_files.lost_told`, which the API's role cannot read except through 3d's functions. The app shows them under
Settings, Cases (apps/app/src/app/settings/cases/).

### 3.6 The web shell, Caddy and crawlers

The web app is a single-page export: every route gets the same `index.html` (apps/app/public/index.html is its template,
`<title>korbat</title>` once exported), built inside Caddy's image (infra/caddy/Dockerfile) and served with the page's
security headers (`app_page_headers`, infra/caddy/Caddyfile). `/post/*` already asks the API once per view
(`GET /api/posts/:id/status`) and serves the shell with 200 or 404 by its answer, and with 200 when the API cannot be
asked. There is no `robots.txt` and no `X-Robots-Tag`. Unfurlers read Open Graph and Twitter tags from the first bytes
of the HTML and none is documented to run JavaScript (inputs 3.1 to 3.4). The API knows the app's origin as
`APP_ORIGIN` (apps/api/src/config.ts:114).

### 3.7 The app

The shell (apps/app/src/components/AppShell.tsx) has four items for an account (Home, Bookmarks, Profile, Settings) and
draws nothing that counts. `Avatar` (apps/app/src/components/kit/Avatar.tsx) draws a monogram and already takes an
unused `src`. Every sentence lives in a words module (apps/app/src/lib/ui-words.ts, settings-words.ts,
moderation-words.ts), every screen has a title from `TITLE_WORDS`, and the source scan in apps/app/test/a11y.test.tsx
refuses bare strings. Sign-up ends at Home's empty Following feed (apps/app/src/components/social/FeedList.tsx, the
words `feed.empty.following.*`). The browser check (apps/app/test/browser/app.browser.ts, 51 steps after 3b, with the fixture API
apps/app/test/browser/fixture-api.ts) holds the JavaScript cap at the baseline of 1222b87 plus 120 KB (832,257 bytes,
app.browser.ts:622-623), which 3b's Task 7 set when the export measured 812,307 bytes (decision 27).

### 3.8 The export, deletion and the purge

The export is one streamed ZIP with `export.json` whose members are written in the order of `ExportFormat`
(packages/contracts/src/account.ts:224; apps/api/src/account/flows/export.ts); each image is a file `media/<id>.webp`.
Deletion (1b) runs the purge at once and its job resumes it: `purgeProfile` (apps/api/src/social/repo.ts:1361), in one
transaction under the profile's lock, anonymises the profile, tombstones the account's posts, removes its graph and runs
the media module's deletion of its images in `within`. No foreign key cascade fires on a profile, because no profile row
is ever deleted.

## 4. Mentions as data

### 4.1 The rule, in one place

A mention is a handle typed in a post's text, `@` followed by 3 to 20 of `a-z`, `A-Z`, `0-9` and `_`, with no such
character on either side. packages/contracts/src/mentions.ts (new) holds the one tokenizer both the server and the app
use:

- `MENTION_TOKEN = /(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g`. The right boundary is new: today's
  `RichText` token links `@abcdefghijklmnopqrstuvwxyz` to its first 20 characters, a different possible account; the
  new token does not match it at all.
- `mentionHandles(body: string): string[]`: the handles in text order, lowercased, each once, at most
  `MENTION_SCAN_MAX` (40) distinct handles read, so a 1,000-character post of 200 handles costs one bounded lookup.
- `MENTION_STORE_MAX = 20` and `MENTION_NOTIFY_MAX = 10` (decision 12).
- The `@` must not follow a letter, a digit or `_`, so `ada@example.org` is no mention, as today. A handle that starts
  with `retired_` is matched like any other: 3e's placeholder is an account's current handle.

Post text is already normalised and refuses bidirectional and zero-width characters (packages/contracts/src/text.ts),
and handles are ASCII, so a mention cannot be split, hidden or imitated by a homoglyph.

### 4.2 Writing a mention

`createPost` (apps/api/src/social/repo.ts) takes a new input `mentions: string[]`, the result of `mentionHandles` on the
normalised body, which the flow (apps/api/src/social/flows/posts.ts) computes before the transaction. Inside the
transaction, after the post's insert and before `within`:

1. One statement resolves the handles and takes each mentioned profile's row as `lockLive` does: `select id,
   lower(handle) from profiles where lower(handle) = any($1) and deleted_at is null order by id for key share`. A
   profile deleted while the statement waited for its lock is dropped, not refused: under READ COMMITTED the row is
   read again after the wait and fails `deleted_at is null`, so a purge that commits first leaves no mention and no
   entry naming the purged account. Blocks are not read here (decision 12): a mention is stored whatever blocks exist;
   whether it links is decided per reader (4.3) and whether it notifies per recipient (5.2). Old handles in
   `handle_history` are not read: a handle names the account that holds it now, at the moment of writing.
2. The kept accounts, in the order their handles first appear in the text, are cut to `MENTION_STORE_MAX` and inserted
   into `post_mentions` (`post_id`, `account_id`, `handle` as written in lowercase, `position` from 0) in one statement.
3. The Activity rows of section 5.3 are written from the same list.

The pair lock is taken only with a replied-to or quoted author (`guardPair`), so a block made while the post is in
flight is not waited for: an entry that raced it is hidden at read while the block stands (5.6). A self-mention is
stored and linked, never notified. An empty list writes nothing.

Imported posts are never parsed: 3b's `publishImportedBatch` inserts posts without calling `createPost`, and 2d does not
add mentions to it, so an imported body keeps its handles as plain text and never notifies (3b design, sections 5.3 and
14). A test holds it (section 12.3).

### 4.3 Reading a mention

`PostView` (packages/contracts/src/social.ts) gains `mentions: string[]`: the handles of the post's stored mentions that
link for this reader, lowercased, in text order. `loadPostViews` (apps/api/src/social/views.ts) reads them for a page of
posts in one statement: `post_mentions` joined to `profiles` where the profile is not deleted, its handle still equals
the handle as written (`lower(p.handle) = m.handle`), and, for a signed-in reader, no block exists between the reader
and the mentioned account in either direction, the same pair test every read uses. A signed-out reader gets every live
mention whose handle is unchanged, as a signed-out reader sees every public profile. `QuotedPost` gains nothing: the
embed draws plain text (4.5).

What the reader sees:
- A stored handle links to `/u/<handle>` while its account still holds it. After a rename (`changeHandle`) or a
  retirement (3e's `retire_handle`) it is plain text, so a person who renames is not found through the posts that named
  the old handle; the Activity entry already written stays (decision 12). A handle once held is never given to another
  account (3.3), so an old mention never reaches anyone else.
- A handle that was not stored (no such account then, beyond the first 20, or an imported post) is plain text, and so is
  a stored one whose account is now deleted or blocked either way with this reader. A mention is stored whatever blocks
  exist (4.2), so no third reader learns of a block.
- The text is never rewritten: the post still says what its author typed.

Posts deleted by their author carry no body, so their mentions are never read; their rows go in the deletion (4.4).

### 4.4 Deletion, moderation, handle changes and the purge

- **Deleted by its author.** `deletePost` deletes the post's `post_mentions` rows and its Activity rows in its own
  transaction, in the statement after the tombstone. Nothing of a deleted post's mentions stays.
- **Withheld, removed or disabled.** The rows stay: the author still sees their post and its links. Readers who are not
  shown the post do not read its mentions, and Activity hides the entries (5.6).
- **Erased.** When a post's `erased_at` becomes set (3c's R4 redaction blanks the body, 3f's end of preservation, 3d's
  release), the trigger `post_mentions_erase` deletes its mention rows: a blanked body keeps no list of the handles it
  named.
- **Handle changes.** A mention is stored by account id and the handle as written, so a rename (`changeHandle`) and a
  retirement (3e's `retire_handle`) change nothing stored; the link holds only while the account's handle equals the
  one written (4.3), so after either the old mention is plain text, and the entry already sent stays.
- **An account's purge.** `purgeProfile` deletes every `post_mentions` row naming the purged account and those of its
  own posts, which it tombstones, and every Activity row it caused or received (5.6), in its transaction, after the
  tombstones, beside the removal of its follows, blocks and mutes.

### 4.5 Rendering

`RichText` (apps/app/src/components/social/RichText.tsx) keeps its link token for URLs and takes mentions from the
contracts' `MENTION_TOKEN`. It gains the prop `mentions: string[]`; a token is a link exactly when its lowercased
handle is in that list, to `/u/<handle>`, in accent ink with its "@" and no underline, as the UI design
draws a mention (section 6.6). 3b's prop `mentions={post.imported === null}` (3b design, section 5.3) is replaced by
passing the post's list: an imported post's list is always empty, so the same test passes (an imported "@ada" while an
account @ada exists links nothing). `QuoteEmbed` and the bio stay plain text, as today: a quote's own mentions are read
on its own page.

The composer changes nothing in its text field. Below the field, once the text holds a handle, it shows one line from
`ACTIVITY_WORDS` (section 10.10, `activity.composer.mentions`) saying that up to 10 accounts named in a post are told,
the mentioned accounts' own settings permitting. No account is looked up while typing (decision 13).

## 5. Notifications: Activity

### 5.1 The entries

| Kind | Written when | For whom | What the row holds |
|---|---|---|---|
| `reply` | `createPost` inserts a reply | the parent post's author | the reply's id, its author |
| `quote` | `createPost` inserts a quote | the quoted post's author | the quoting post's id, its author |
| `mention` | `createPost` stores a mention (4.2) | each of the first 10 mentioned accounts | the post's id, its author |
| `follow` | `follow` inserts a follow | the followed account | the follower |
| moderation | never written | the author of the decided content or account | nothing: read from the author-side reads (5.5) |

A recipient gets at most one entry per post: a reply that also quotes or mentions its parent's author makes one `reply`
entry; a quote that mentions the quoted author makes one `quote` entry. The order is reply, then quote, then mention.
A reply notifies its parent's author only, never the thread's root or its other authors (decision 12).

### 5.2 The recipient's rules

`activity_state` (6.2) holds, per account, `replies`, `mentions` and `quotes` (each `everyone`, `older`, `following` or
`off`) and `follows` (true or false). An account without a row has the defaults: `everyone` and true. An act writes an
entry for a recipient only when all of these hold, in the act's own transaction:

- the recipient is not the actor and is not deleted;
- no block exists between them in either direction;
- the recipient does not mute the actor (decision 8);
- the recipient's setting for the kind is `everyone`; or `older` and the actor's account was created at least
  `ACTIVITY_MIN_AGE_HOURS` (48) hours before the act (`profiles.created_at`, the age korbat's write limits and Explore
  already use, a published rule and never a reputation); or `following` and the recipient follows the actor; or, for a
  follow, `follows` is true.

A refused rule writes nothing, so changing a setting later applies to new acts only and brings nothing back. A
suspended account cannot act (3e's predicate refuses its reply, quote and follow before any of this), so it causes no
entry. A suspended recipient still receives entries and reads Activity: what others do toward a suspended account is
unchanged (3e design, line 725) and reading is left to it.

### 5.3 Writing

- **In `createPost`.** After the post's insert and the mentions (4.2), one statement builds the candidates (the parent's
  author for a reply, the quoted author for a quote, then the stored mentions by position, the author and the
  recipients already listed removed, cut to `MENTION_NOTIFY_MAX`), joins each to its `activity_state` row, its follow of
  the author and its mute and block rows, reads the author's `created_at` once, and inserts the passing ones into
  `activity_items` with `on conflict do nothing`. It runs before `judgeActing`, so a post refused by the closing
  judgment leaves no entry. The parent and the quoted author are already locked live by `lockLive`, and the mentioned
  accounts FOR KEY SHARE by 4.2's lookup, in id order. Lock order: a post by A that mentions M while M is purged, where
  A follows M or M follows A, crosses the purge (A FOR NO KEY UPDATE by `lockActing`, then M FOR KEY SHARE; the purge
  holds M FOR UPDATE, then A FOR NO KEY UPDATE as a follow counterpart), as the purge already crosses a quote or a
  follow (`purgeProfile`'s comment, apps/api/src/social/repo.ts:1355-1359): PostgreSQL detects the cycle, `createPost`
  tries once more, and the purge is tried again by its job's next round.
- **In `follow`.** When the insert answered true (a follow that did not exist), the same statement for the one
  candidate. The unique key `(recipient_id, actor_id)` of follow entries makes a follow, unfollow and follow again
  within 90 days one entry, with the time of the first.
- **Nowhere else.** No other module writes `activity_items`. The architecture test (apps/api/test/architecture.test.ts)
  pins, in one table, the files that may name each of 2d's tables:

  | Table | Files that may name it |
  |---|---|
  | `activity_items` | apps/api/src/social/repo.ts (the writes and the deletions of 5.6); apps/api/src/activity/ (the reads, the newer count and the retention job) |
  | `activity_state` | apps/api/src/social/repo.ts (`createPost`'s and `follow`'s rules join it; `purgeProfile` deletes it); apps/api/src/activity/ (the seen marker and the settings) |
  | `post_mentions` | apps/api/src/social/repo.ts (`createPost`'s insert, the deletions of 4.4, the export's `exportProfile`); apps/api/src/social/views.ts (`loadPostViews`' read, if the read is written there) |

  As an assertion of its own, the one insert into `post_mentions` is in `createPost`.

### 5.4 What never makes an entry

- A like, a repost, a bookmark (decision 3).
- An act across a block in either direction: `guardPair` already refuses a reply, a quote and a follow across one, a
  mention across one is stored (4.2) but writes no entry (5.2), and the read hides any row that slipped past (5.5).
- An act by a muted account, for the person who muted it.
- An act a recipient's setting excludes.
- A post's own author naming, replying to or quoting themselves.
- An imported post's text (4.2); a reply to, a quote or a repost of an imported post is an ordinary act and follows
  the rules above.
- A moderation event: no row is ever written for one. Moderation entries are read from what the author may already
  read (5.5.2), so a held notice, a decision told to nobody, a staff note, a report about the recipient, a finding, a
  flag, a seal taken while deciding about someone else, or a suspension's details never appear.
- Anything staff do in the console, and anything the console can read: no staff route reads Activity, as none reads
  likes or follows (3c design, section 11), and the architecture test holds that apps/api/src/staff/ and
  apps/api/src/moderation/ never import the activity module or name its tables. Its `MODULES` list
  (apps/api/test/architecture.test.ts:28) gains `activity`, so the module is entered only through its index and this
  rule has something to stand on.

### 5.5 Reading

#### 5.5.1 Social entries

`GET /api/activity` (section 9) reads one page for the signed-in account R, newest first, with a keyset cursor on
(`at`, `key`):

- From `activity_items` where `recipient_id = R`, joined to the actor's profile, keeping a row only while the actor is
  not deleted, no block exists between R and the actor in either direction, R does not mute the actor, a `follow` row's
  follow still stands, and a post row's post has `state = 'visible'`. These are the rules of `otherWelcome` and
  `visibleTo` (apps/api/src/social/repo.ts), written once in the activity module's query and named in its comment.
- Rows that are not follows are entries of their own, with `key = 'e:' || id` and `at = created_at`.
- Follow rows are grouped by the UTC day of their `created_at` (decision 6): one entry per day, with `key = 'f:' ||
  day`, `at` the newest follow of the group, the number of distinct followers, and the three newest followers.
- The posts of the page's entries are built by `loadPostViews` for R, which passes each through `postAccess`
  (apps/api/src/social/visibility.ts); a post that does not pass, which only a race between the query and the views can
  produce, drops its entry from the page. This is the reader 3f's design asks every new reader of a post to be (3f
  design, line 237).

The tab Conversations keeps only `reply`, `mention` and `quote` rows and no moderation entries; the tab All keeps
everything.

#### 5.5.2 Moderation entries

On the tab All only, the activity module asks the moderation module's index for `authorActivity(viewer, before,
limit)`, a new function of apps/api/src/moderation/author.ts that answers, newest first by the time the author was told
and no older than `ACTIVITY_KEEP_DAYS` (90) days, so that the list's end sentence (`activity.end`) is true of both
sources while Cases keeps the full history, entries built only from the author-side reads:

- a decision told to its author: the rows the Cases screen's "About you" list reads, through `toldToAuthor('d')`
  (apps/api/src/moderation/author-repo.ts:24), with `at` the decision's `informed_at`, `key = 'd:' || decision id`, and
  its target (a post with its time, the profile, or the account for 3e's standing decisions). 3d's automated decisions
  are decisions told the same way, so a program's measure appears here;
- a release of sealed images and a refused upload: the rows of `authorNotices` (apps/api/src/moderation/release.ts:360),
  which already leave out a release whose notice is held, with the time the Notices list shows and keys `'r:'` and
  `'u:'`;
- a lost image: the rows of the new told-only function `lost_told_for` (6.5), one per image whose lost files' notice
  was due and has been handled by 3d's dispatch (its `lost_told` neither `pending` nor `none`), with `at` the loss's
  time and key `'l:' || media id`.

None of these reads the ledger, the cases or the quarantine directly; each answers no earlier than the author may be
told, because each is the read the author's own Cases screen already uses. The activity flow merges the two sources:
it asks each for `limit + 1` rows before the cursor, sorts the union by (`at`, `key`) descending, keeps `limit` and
makes the cursor from the last. The keys' prefixes keep every key distinct across sources.

#### 5.5.3 What an entry shows

Each entry carries `at`, `key` and `new` (5.7). A `reply`, `quote` or `mention` carries the post's `PostView`, drawn as
a static PostCard (the actor's line, the text with its links, the images), which opens the post. A follow group carries
its count and up to three `Author`s with their avatars. A moderation entry carries its kind, its target and the id its
screen needs, and opens that screen under Settings, Cases (or, for a lost image, the post). Words are section 10.10's:
a decision's line is new there, and a release's, a refused upload's and a lost image's are 3d's words unchanged.

### 5.6 After the fact

| Event | What happens to entries | Where |
|---|---|---|
| The entry's post is withheld, removed or disabled | hidden at read; shown again if restored | 5.5.1's `state = 'visible'` |
| The entry's post is deleted by its author | its rows deleted | `deletePost`'s transaction |
| The entry's post is erased | hidden at read (an erased post is not visible) | 5.5.1 |
| A block, either way | the pair's rows deleted both ways | `block`'s transaction, beside `retractEngagement` |
| A mute | hidden at read while it stands; no new rows | 5.2, 5.5.1 |
| An unfollow | the follow row hidden at read while the follow is gone | 5.5.1 |
| The actor is suspended or terminated | kept, with no label (decision 10) | nothing |
| The actor's or the recipient's account is deleted | hidden at read while deleted | 5.5.1 |
| The actor's or the recipient's account is purged | every row it caused or received deleted, with its `activity_state` | `purgeProfile`'s transaction |
| 90 days pass | deleted | the job `activity-retention` (5.10) |

A block's deletion and a mute's filter reveal nothing to the other account: neither reads the other's Activity.

A mention's entry written by a post in flight while the recipient and the author block each other (a mention takes no
pair lock, 4.2) commits after the block's deletion; it is hidden at read while the block stands and shown again after an
unblock. This is accepted: pair-locking up to 20 mentioned accounts per post would cost 20 advisory locks. A purge
leaves no such row (4.2's lock).

### 5.7 The seen marker and what is new

`activity_state.seen_at` is null until the account first opens Activity. Every page of `GET /api/activity` answers
`seenAt`, the stored value at the time of the request, and marks each entry `new` when its `at` is later. The app keeps
the first page's `seenAt` for the visit, draws the headings "New since you last looked" above the first new entry and
"Earlier" above the first entry that is not new (10.2), and then sends `POST /api/activity/seen` with the first page's
newest `at`. The server stores `greatest(seen_at, least($at, now()))`: the marker only moves forward and never past the
server's clock, and a marker older than what another device sent is ignored. A visit that shows nothing new sends
nothing.

No route answers a count of unread entries for the nav, the title or any other screen (decision 4).

### 5.8 While the Activity screen is open

The screen asks `GET /api/activity/newer?since=<the newest at it shows>` 30 seconds after it opened and then every 60
seconds, only while it is on screen and the page is visible, as the feed's pill does (UI design, decision 7). The
answer is the number of entries newer than `since` under the same rules as the list, capped at 21; the pill reads
"1 new", "{n} new" or "20+ new", and pressing it loads the first page again at the top and moves the marker. Pull to
refresh does the same. Nothing is asked while the screen is closed, so no other route gains a request.

### 5.9 Fan-out and limits

One post writes at most 12 entries (a reply, a quote and 10 mentions), one follow one entry, so the existing write
limits bound what one account can cause: at most 30 posts and 60 replies an hour for an established account
(apps/api/src/social/tiers.ts), 50 follows an hour and 400 a day. A person under a pile-on has their settings ("Accounts
older than 2 days", which leaves out accounts made for the pile-on and keeps a new reader's honest reply once its
account is two days old, "Accounts you follow" or Off, for replies, mentions and quotes), mutes and blocks; follows
arrive grouped. No program decides who is a brigade: 3d's coordinated-reporting flag stays staff-side.

The new write routes have limits of their own, declared next to the route as every write's (section 9.5).

### 5.10 Retention and the purge

The job `activity-retention` (apps/api/src/activity/retention.ts), created with `createJob` (apps/api/src/lib/jobs.ts)
under a Valkey lock, runs every hour and deletes `activity_items` rows written more than `ACTIVITY_KEEP_DAYS` (90) days
ago, in batches of 5,000 by id until none is left, logging only the count. The constant lives in
packages/contracts/src/activity.ts, so the terms' sentence and the README print it from there. `activity_state` and
`post_mentions` have no retention of their own: they live as long as the account and its posts. The purge deletes all
three for the account (4.4, 5.6).

## 6. The database

Five migrations, numbered by the dry run with the next free numbers after 3b's last (3b ends at 0048_import_staff_end.sql), each a
drizzle-generated part for what the schema files declare, followed by hand-written SQL for triggers, functions, grants
and checks, as 0016 to 0048 are written: every function owned by the migrator, `SET search_path = public, pg_temp`,
every object schema-qualified, EXECUTE taken from PUBLIC, errors raised with their code as the message under SQLSTATE
P0001 (or 42501 for a forbidden column), enum values compared as text. No existing migration is edited. The schema
gains packages/db/src/schema/activity.ts and changes content.ts, identity.ts and moderation.ts.

### 6.1 `activity_items`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid primary key default `gen_random_uuid()` | never shown as a count; the cursor's tie-breaker |
| `recipient_id` | uuid not null, references `profiles` | |
| `kind` | `activity_kind` (`reply`, `mention`, `quote`, `follow`) | |
| `actor_id` | uuid not null, references `profiles` | |
| `post_id` | uuid, references `posts` on delete cascade | the reply, the quoting post or the mentioning post; null for a follow |
| `created_at` | timestamptz not null | forced to `now()` at insert |

Checks: `activity_items_post` (`(kind = 'follow') = (post_id is null)`); `activity_items_not_self`
(`recipient_id <> actor_id`).

Indexes: `activity_items_recipient_idx` on (`recipient_id`, `created_at`, `id`), the list and the count; unique
`activity_items_post_once` on (`recipient_id`, `post_id`) where `post_id` is not null, one entry per recipient and post;
unique `activity_items_follow_once` on (`recipient_id`, `actor_id`) where `kind = 'follow'`; `activity_items_post_idx`
on (`post_id`) where `post_id` is not null, for `deletePost`; `activity_items_actor_idx` on (`actor_id`), for `block`
and the purge; `activity_items_created_brin` (BRIN on `created_at`), for the retention job.

`activity_items_insert`, before insert, plain, skipped for the migrator: forces `created_at` to `now()`. There is no
UPDATE grant: a row is written once and deleted.

### 6.2 `activity_state`

| Column | Type | Rule |
|---|---|---|
| `account_id` | uuid primary key, references `profiles` | |
| `seen_at` | timestamptz | null until the first visit; only moves forward |
| `replies`, `mentions`, `quotes` | `activity_reach` (`everyone`, `older`, `following`, `off`) not null default `everyone` | |
| `follows` | boolean not null default true | |

There is no `updated_at`: it would keep the account's last visit to Activity, which nothing reads (1.5).
`activity_state_guard`, before insert or update, plain, skipped for the migrator: refuses a `seen_at` that is earlier
than the old one, set back to null, or later than `now()` (`activity_seen`, 42501); `account_id` never changes. The API
writes the row with `insert ... on conflict (account_id) do update`, so an account without a row reads the defaults.

### 6.3 `post_mentions`

| Column | Type | Rule |
|---|---|---|
| `post_id` | uuid not null, references `posts` on delete cascade | |
| `account_id` | uuid not null, references `profiles` | |
| `handle` | text not null | the handle as written, lowercased; CHECK `^[a-z0-9_]{3,20}$` |
| `position` | smallint not null | CHECK between 0 and 19 (`MENTION_STORE_MAX` - 1) |

Primary key (`post_id`, `account_id`); unique `post_mentions_position` on (`post_id`, `position`); index
`post_mentions_account_idx` on (`account_id`) for the purge. `post_mentions_insert`, before insert, plain, skipped for
the migrator: refuses a row whose post is not in state `visible` or has `import_job_id` set (`mention_column`, 42501);
it reads no block, since a mention is stored whatever blocks exist (decision 12). Only `createPost` writes the table,
which the architecture test holds (section 12.2), so a mention is added only with its post.

`post_mentions_erase`, after update of `erased_at` on `posts`, security definer: deletes the post's mention rows when
`erased_at` becomes set (4.4). No UPDATE grant: a mention is written once and deleted.

### 6.4 Images, profiles and posts

New enum `media_kind` (`post`, `avatar`). New columns:

| Table | Column | Type | Rule |
|---|---|---|---|
| `post_media` | `kind` | `media_kind` not null default `post` | set at insert from the upload's `kind`; never changes |
| `post_media` | `profile_id` | uuid, references `profiles` | set while the image is that profile's avatar |
| `post_media` | `avatar_sha256` | text | the uploaded file's SHA-256, set at insert for an avatar (CHECK: null for a post's image, `^[0-9a-f]{64}$` for an avatar; 7.2, 7.7) |
| `profiles` | `share_previews` | boolean not null default false | decision 21: off until the person turns it on |
| `posts` | `hide_counts` | boolean not null default false | decision 26 |

`profiles.avatar_path` is dropped (decision 18), and with it its column grant.

Checks on `post_media`: `post_media_kind_place`, `(kind = 'post' and profile_id is null) or (kind = 'avatar' and
post_id is null and position is null and alt_text is null)`, so an avatar is never attached to a post and a post's image
is never an avatar; `post_media_avatar_owner`, `profile_id is null or profile_id = owner_id`. Unique index
`post_media_avatar_idx` on (`profile_id`) where `profile_id` is not null: one avatar per profile. Index
`post_media_owner_avatar_idx` on (`owner_id`) where `kind = 'avatar'`, for the seal's list and the purge.

`post_media_avatar_guard`, before update of `profile_id`, plain, skipped for the migrator: `profile_id` moves only from
null to the row's `owner_id` or from a value to null; it is set only on a row of kind `avatar` that is `ready`,
`visible` and not erased, whose owner's profile is not deleted; a refusal raises `avatar_column` under 42501. The API's
statement that sets an avatar applies 3e's predicate (section 7.3); the trigger does not.

`post_media_insert` (0015) is replaced from its text with one more refusal: a row inserted with a non-null `profile_id`
is refused (`moderation_column`, 42501), as one with a `post_id` is. INSERT is a table privilege of the API's role
(packages/db/migrations/0001_grants.sql:16) and the guard above fires only on UPDATE, so an inserted row could otherwise
be an avatar before any check had seen it.

`post_media_refused` (0039) is replaced from its text to fire `BEFORE UPDATE OF post_id, profile_id`, with the same
refusal for either column going from null to a value: `upload_refused` while an `upload_refusals` row names the image,
while it is erased, or while its `hold_until` is infinity, read in a statement of its own after the row's lock, as for a
post's image; the API answers it `avatar_not_ready` (7.3 step 2).

`post_media_keep` (0015) is replaced from its text so that a row on no post is also retained while it is of kind
`avatar` and its owner has an account case frozen by a suspect report (`frozen_for`'s second arm, read in a statement
of its own). Its seal arm is added in the migration `avatar_moderation` (6.5). Its owner's removal, a replacement
(7.3 step 6), the sweeper and the purge then skip such a row, as they skip a held one.

`post_media_purge` (0035) is replaced with the same body and two changes: a row counts as served when it was on a post
or was an avatar (`OLD.post_id is not null or OLD.profile_id is not null`), and a row whose `profile_id` goes from a
value to null writes cause `state`; the trigger fires on `moderation_state`, `erased_at` and `profile_id`, and on
delete. A released avatar's erasure writes `released` when the release lists it (`releases.avatar_ids`, 6.5), a cause
added when `avatar_moderation` replaces the function again (6.8).

### 6.5 Moderation of avatars

- `action_kind` gains `reset_avatar` and `restore_avatar`, in the migration `avatar_kinds`. Keeping it apart is
  harmless, but it is not what makes the values usable: drizzle's migrator runs every pending migration in one
  transaction (packages/db/test/enum-literals.test.ts, its header), so on an upgrade `avatar_kinds`, `avatar_moderation`
  and 3b's migrations share it, and a value added there cannot be used as an enum literal before that transaction
  commits (55P04) in anything parsed when it is created or run. 2d follows 3e's rule, as 3e, 3f and 3d did: the two
  values appear as literals only inside PL/pgSQL bodies (`decision_actions_check`, `decision_actions_apply`,
  `redact_r4_body`, `decision_holds`, `seal_release`, `release_replay`), and everywhere else (checks, SQL-language
  functions, views, index predicates, DO blocks) a kind is compared as text (`kind::text = 'reset_avatar'`), as the
  view `measures_in_force` and the SQL functions `item_current_outcome` and `case_evidence_due_at` must.
  enum-literals.test.ts gains a describe block for 2d's migrations from `avatar_kinds` on (Task 4).
- `decision_actions_check` is replaced with the latest body (3b's, from its migration `imported_posts`) and the avatar
  kinds added where the field kinds are: `reset_avatar` on an account case only, in an `interim` or a `final`
  decision; `restore_avatar` in the same places as `restore_display_name`; `no_effect` `already` when the account has
  no avatar, `deleted` when its profile is deleted.
- `decision_actions_apply` is replaced with the latest body and three changes. A `reset_avatar` whose `no_effect` is
  null refuses with `profile_changed` unless the profile's current avatar is the one the decision's snapshot holds
  (compare-and-set, as for a display name), then sets that row's `profile_id` to null and writes its `avatar_resets`
  row (below); the row stays while a hold keeps it and is deleted afterwards by the sweeper. A `restore_avatar` does
  nothing. A `seal_media` on an account case also locks, after the posts' images and in id order, every row of kind
  `avatar` the account owns (the current one and any former one a hold keeps), lists them in `seal_avatars`, and raises
  `invalid_decision` only when both its lists are empty; an `unseal_media` applies again to the lifted seal's avatars.
- `seal_avatars` (`action_id` uuid references `decision_actions` on delete restrict, `media_id` uuid not null, primary
  key both; no foreign key to the image, which may go): the avatars a seal listed, as `seal_posts` lists its posts. The
  API's role may read it; only the definer functions write it.
- `post_media_keep` is replaced again, from its text in `avatars` (6.4): a row on no post is also retained while
  `seal_avatars` lists it under a measure in force (`measures_in_force`) and no release that lists it in `avatar_ids`
  has a notice other than `held`, mirroring `frozen_for`'s seal arm. A sealed avatar that no hold keeps (one set after
  the report, so in no snapshot) is then never deleted by its owner, a replacement, the sweeper or the purge while 3d's
  quarantine lists it: the seal's evidence is never destroyed by the person it is about.
- `avatar_apply(media uuid[])`, security definer: locks the rows in id order `FOR NO KEY UPDATE` and sets each one's
  `moderation_state` to `sealed` while a seal in force lists it, else `withheld` while `avatar_reviews` lists it under
  an item not yet answered, else `visible`. `moderation_apply` is unchanged: it works by post, and an avatar has none.
- `avatar_reviews` (`media_id` uuid primary key, `item_id` uuid not null references `intake_items`): R1's hold for
  review (7.6), written only by the definer function `avatar_review(p_media uuid, p_item uuid)`, which the program's
  step calls while `AUTOMATION_R1_ACTS` is on, after its finding's item, and which then calls `avatar_apply`. The
  deciding transaction that answers an item calls `avatar_apply` for the avatars `avatar_reviews` names under it, so the
  avatar is `visible` again or, under a `reset_avatar`, detached. The API's role may read it.
- `avatar_resets` (`action_id` uuid primary key references `decision_actions` on delete restrict, `account_id` uuid not
  null, `sha256` text not null CHECK `^[0-9a-f]{64}$`, `until` timestamptz not null): written by
  `decision_actions_apply` when a `reset_avatar` applies, with the reset row's `avatar_sha256` and `until` 30 days after
  the decision, so the hash outlives the image row; `setAvatar` reads it (7.3 step 2, 7.7). Never read after `until`;
  erased with its case's evidence (3c's retention). The API's role may read it; only the definer function writes it.
- `releases` gains `avatar_ids uuid[] not null default '{}'`: `seal_release` and `release_replay` (3d) are replaced with
  their latest bodies and write the released seal's avatars there beside `post_ids`, and erase those rows as they erase
  a post's images; `quarantine_files` rows for an avatar carry `post_id` null, as for an upload on no post, and their
  `lost_told` is forced to `none` by the existing rule (no post).
- **Every list of the measures.** The field resets are also listed by hand outside the two functions above; a grep for
  `reset_display_name` at 0bc2dcc finds each, and the task that adds the measure (Task 4) changes them all:
  - in the database, each replaced in `avatar_moderation` from its newest text with `reset_avatar` added (and
    `restore_avatar` where reversals are listed), by 6.5's rule above: the view `measures_in_force`
    (0028_orders_ledger.sql:24); `item_current_outcome` (0021_standing_ledger.sql:306, an intake item's outcome);
    `case_evidence_due_at` (0018_retention.sql:57, a case's retention); `redact_r4_body` (0019_redaction_scope.sql:57
    and :94, so an avatar reset's held snapshot is erased under R4 with a display name's); `decision_holds`
    (0039_known_material.sql:922-924, the signed form's count of measures `IN` and `NOT IN`, so `reset_avatar` is
    signed as a measure);
  - in the API: `ROUTE_KINDS` (apps/api/src/moderation/decide.ts:42-50), built from `MEASURE_KINDS.slice(0, 7)` and
    `REVERSAL_KINDS.slice(0, 5)`, gains both kinds by name, never by moving a slice's edge;
    `MEASURE_KINDS_SQL` (apps/api/src/moderation/repo.ts:267, read by `answerChangedNothing`, which feeds 3e's reporter
    restriction); `REDACTABLE` (repo.ts:2224, R4's redaction candidates); the interim measures of the statement
    (apps/api/src/moderation/statement-repo.ts:282); `MEASURES` (apps/api/src/moderation/author-repo.ts:26); the reset
    facts of a statement (apps/api/src/moderation/statement.ts:26 and packages/rules/src/statement.ts:39-45, which know
    the targets `display_name` and `bio`);
  - in the contracts and the schema: `ACTION_KINDS`, `MEASURES` (with `MeasureTarget` gaining `"avatar"`),
    `MEASURE_KINDS` and `REVERSAL_KINDS` (packages/contracts/src/moderation.ts), and `actionKind`
    (packages/db/src/schema/moderation.ts:37);
  - in the app: the kind's switch of apps/app/src/components/moderation/StatusSheet.tsx:105, each measure's sentence in
    apps/app/src/lib/terms.ts:94, and `DECISION_WORDS` (apps/app/src/lib/moderation-words.ts:234), which gains
    `avatar` beside `displayName` and `bio`;
  - in the console: apps/admin/src/compose.ts (an account case's targets at :220, the `no_effect` prediction at
    :301-302, `ONE_BY_ONE` at :324, the reversal at :382, the reset facts at :1224) and
    apps/admin/src/screens/Case.tsx:895.
  A test of its own, apps/api/test/measure-lists.test.ts (Task 4), reads apps/api/src, apps/app/src, apps/admin/src,
  packages/rules/src and the newest body of every migration function and view that names `reset_display_name`, and
  expects `reset_avatar` wherever `reset_display_name` appears, as 3e's enum test reads its files.
- `lost_told_for(p_owner uuid, p_before timestamptz, p_limit integer)`, security definer, EXECUTE to the API's role
  only: one row per image of `p_owner` (by `post_media.owner_id`) on a post its author has not deleted, with the
  image's id, the post's id and creation time, and the earliest `lost_at` of its files whose `lost_told` is neither
  `pending` nor `none`, before `p_before`, newest first, at most `p_limit` (at most 100). It answers ids and times only,
  as 3d's six functions do.

### 6.6 Row-level security and grants

| Table | RLS | API role |
|---|---|---|
| `activity_items` | enabled, one policy for the API role (`activity_items_api_all`) | SELECT, INSERT, DELETE; no UPDATE |
| `activity_state` | enabled, one policy for the API role | SELECT, INSERT, UPDATE of `seen_at`, `replies`, `mentions`, `quotes`, `follows`, DELETE |
| `post_mentions` | enabled, one policy for the API role | SELECT, INSERT, DELETE; no UPDATE |
| `seal_avatars` | enabled, one policy for the API role | SELECT only |
| `avatar_reviews` | enabled, one policy for the API role | SELECT only |
| `avatar_resets` | enabled, one policy for the API role | SELECT only |
| `post_media` | unchanged | INSERT of `kind` and `avatar_sha256` (INSERT is a table privilege); UPDATE of `profile_id` under `post_media_avatar_guard`; no UPDATE of `kind` or `avatar_sha256` |
| `profiles` | unchanged | UPDATE of `share_previews` |
| `posts` | unchanged | UPDATE of `hide_counts` |

New tables receive SELECT, INSERT, UPDATE and DELETE through the default privileges
(packages/db/migrations/0001_grants.sql:16), so every "no UPDATE" and "SELECT only" above is an explicit REVOKE, as 0015
writes for `seal_posts` (0015_greedy_zuras.sql:410): UPDATE revoked on `activity_items` and `post_mentions`; INSERT,
UPDATE and DELETE revoked on `seal_avatars`, `avatar_reviews` and `avatar_resets`; UPDATE revoked on `activity_state`
and granted again on its five columns. `korbat_auth` and `korbat_notify` get nothing on any of them. The owner-scoped
policies stay sub-project 4's, as for every table (main design, 2026-09-23).

### 6.7 Retention and what the purge erases

| What | Kept | Erased by |
|---|---|---|
| An `activity_items` row | 90 days, or until its post is deleted, a block between the pair, or a purge | `activity-retention`; `deletePost`; `block`; `purgeProfile` |
| The `activity_state` row | as long as the account | `purgeProfile` |
| A `post_mentions` row | as long as its post is not deleted or erased | `deletePost`; `post_mentions_erase`; `purgeProfile` |
| An avatar's row and files | while it is the avatar; a replaced or reset one until no hold, seal or frozen case keeps it | the set and remove flows; the sweeper; the purge's media deletion |
| A `seal_avatars` row | as long as its decision's ledger | never deleted, as `seal_posts` |
| An `avatar_reviews` row | while its item waits, then as long as its case's evidence | 3c's retention of a case's evidence |
| An `avatar_resets` row | read for 30 days, then kept as long as its case's evidence | 3c's retention of a case's evidence |

### 6.8 The migrations

In the order the tasks create them (section 13), each with the next free number after 3b's last:

- **`activity`** (Task 1). The enums `activity_kind` and `activity_reach`; the tables `activity_items`, `activity_state`
  and `post_mentions` with their checks and indexes; RLS, policies, grants and the REVOKEs of 6.6; the triggers
  `activity_items_insert`, `activity_state_guard`, `post_mentions_insert` and `post_mentions_erase`; the function
  `lost_told_for`.
- **`post_options`** (Task 1). `profiles.share_previews` and `posts.hide_counts` with their grants.
- **`avatars`** (Task 3). The enum `media_kind`; `post_media.kind`, `post_media.profile_id` and
  `post_media.avatar_sha256` with their checks and indexes; `post_media_avatar_guard`; `post_media_insert`,
  `post_media_refused`, `post_media_keep` (its frozen-account arm) and `post_media_purge` (the served test and the
  `state` cause) replaced; `profiles.avatar_path` dropped; the grants of 6.6 for these.
- **`avatar_kinds`** (Task 4). `ALTER TYPE action_kind ADD VALUE 'reset_avatar'` and `'restore_avatar'`.
- **`avatar_moderation`** (Task 4). `seal_avatars`, `avatar_reviews` and `avatar_resets` with RLS, policies and the
  REVOKEs of 6.6; `avatar_apply` and `avatar_review`; `releases.avatar_ids`; `post_media_keep` (its seal arm) and
  `post_media_purge` (the `released` cause of an avatar) replaced again; `decision_actions_check`,
  `decision_actions_apply`, `seal_release` and `release_replay` replaced; the measure lists of 6.5 replaced
  (`measures_in_force`, `item_current_outcome`, `case_evidence_due_at`, `redact_r4_body`, `decision_holds`); every
  body under 6.5's enum-literal rule.

Each migration's drizzle snapshot is regenerated in packages/db/migrations/meta. A database test holds every CHECK's
constant equal to its contracts constant (`MENTION_STORE_MAX`, the two enums' values), as earlier sub-projects' do.

## 7. Avatars

### 7.1 What an avatar is

An avatar is a `post_media` row of kind `avatar` (6.4) whose two files are squares: `large.webp`, 400 by 400 pixels, and
`small.webp`, 128 by 128, each smaller only when the source's shorter side is (images are never enlarged). The names,
the store's layout, `MEDIA_SIZES`, `mediaPath`, the quarantine's file check and the export's file entry are 2b's and
3d's as they are; only the pixels differ. A profile has an avatar while one row's `profile_id` names it. Without one,
the generated monogram of the UI design's section 6.5 is drawn, as today.

The sizes cover every place an avatar is drawn: 40 px in posts and lists and 32 px in the composer use `small.webp` up
to three device pixels per CSS pixel, and the 64 and 96 px of the profile header and the 144 to 400 px a card needs use
`large.webp`. A list of 20 authors costs about 20 files of 3 to 5 KB each.

### 7.2 Uploading

The picker (section 10.5) sends the file to the existing `POST /api/media` with the query `kind=avatar` and
`crop=start`, `centre` or `end` (`UploadQuery`, packages/contracts/src/media.ts); without `kind` the upload is a post's
image, as today, and `crop` is refused on one. The flow (apps/api/src/media/flows/upload.ts) is unchanged up to the
row: the declared type, the first bytes, the 20 MiB cap, the account's upload limit, the pending count, the free-space
floor and, while the matcher is on, the three hashes taken while it streams (apps/api/src/media/files.ts:133); for
`kind=avatar` the SHA-256 is taken always, one hash of at most 20 MiB, and kept as `avatar_sha256` (6.4, 7.7). Then:

- `insertProcessing` writes the row with `kind = 'avatar'` and its `avatar_sha256` (its statement already takes the
  owner's row with 3e's predicate and the closing judgment, so a suspended account cannot upload an avatar either);
- `files.commit(id, { avatar: crop })` writes the job file `incoming/<id>.avatar` (one line of JSON,
  `{"v":1,"crop":"centre"}`, through tmp and a rename) before it renames the upload into `incoming/<id>`, so the worker
  never sees the upload without its job file. `uploadsLayout` (packages/media-protocol/src/layout.ts) gains
  `avatarJob(id)`; the job file's name fails `isMediaId`, so the worker's scan of `incoming/` skips it as a file of its
  own, and every removal of an upload removes it too. A crash between the job file's write and the rename leaves
  `<id>.avatar` alone, which `storedUploads` (apps/api/src/media/files.ts:304-311) and the worker's scan skip: so
  `storedUploads` also lists `<id>.avatar` files, and the reconcile pass removes one older than `ORPHAN_AGE_MS` whose
  id has no upload and no row; one unit test holds it.

The media module's queries of uploads on no post (apps/api/src/media/repo.ts) keep avatars out, since an avatar is never
an unposted upload: `pendingCount` (the pending count against `MAX_PENDING_UPLOADS`), `deleteUnattached`
(`DELETE /api/media/:id`, the composer's removal of an upload) and `attach` (a post's images) gain `kind = 'post'`, and
`deleteUnattachedBefore` (the sweeper) gains `profile_id is null`. So the current avatar and a held former one use no
pending slot, `DELETE /api/media/:id` on an avatar answers `not_found` (only 7.3's routes remove one, under their rules
and `avatarSet`), and an avatar's id sent as a post's image gets the error a missing upload gets, never the 500 that
`post_media_kind_place` (23514) would raise.

An avatar upload is an upload on no post: the sweeper deletes it after a day unless it was set (7.3).

### 7.3 Setting and removing

`PUT /api/me/avatar` with `{ mediaId }` (apps/api/src/social/routes.ts, beside `PATCH /me/profile`; the flow in
social/flows/profile-edit.ts) runs one transaction, `setAvatar` in apps/api/src/social/repo.ts beside `updateProfile`;
the image rows are written by the media module's `attachAvatar(tx, accountId, mediaId)` and `detachAvatar(tx,
accountId)` (apps/api/src/media/repo.ts) called inside it, as `createPost` calls `media.attach`, so only the media
module names `post_media`:

1. the profile row through `lockActing(tx, accountId, "no key update")`, the helper `createPost` uses, which applies
   3e's predicate (`account_suspended`, or `not_found` for a deleted profile) without naming `liveNotSuspended` again
   (12.2);
2. the upload's row `for no key update`, which must be the account's own, of kind `avatar`, `ready`, `visible` and not
   erased (`not_found` for another account's or a missing row, `avatar_not_ready` while it is processing or failed or
   when `post_media_refused` answers `upload_refused`, 6.4; `not_an_avatar` for a post's image), and whose content hash
   is not a picture a moderator reset on this account in the last 30 days (`avatar_reset`, 7.7);
3. the current avatar, if any, detached (`profile_id` to null), which writes its outbox row (6.4);
4. the new row's `profile_id` set to the account;
5. the closing judgment (`judgeActing`);
6. after the commit, the media module's deletion of the old row and its files, which skips a row that a hold, a seal or
   a frozen case keeps (`post_media_keep`, 6.4 and 6.5; the sweeper deletes it once nothing keeps it), and
   `moderation.avatarSet(accountId, mediaId)` (7.6).

`DELETE /api/me/avatar` (`removeAvatar`) takes the profile row `for no key update` with no predicate (a deleted profile
answers `not_found`) and runs steps 3 and 6 without a new row, so a suspended account may remove its picture (decision
17). Both answer the account's `AvatarView` (or null). `PUT` is refused for a suspended account by step 1. The new
avatar is public once the transaction commits; there is no cover, because an avatar has no description and is drawn
beside every post, except that an avatar the R1 check flags while `AUTOMATION_R1_ACTS` is on is shown to its owner only
until a person decides (7.6).

### 7.4 The worker

`processImage` (apps/worker/src/pipeline.ts) takes the job file's crop when `incoming/<id>.avatar` exists, read and
parsed strictly (a missing or malformed job file makes the upload `processing_failed`). For an avatar:

1. the same sniffing, pixel caps, format checks and `autoOrient` as any upload;
2. the square: with `w` and `h` the oriented size and `s = min(w, h)`, an `extract` of `s` by `s` at offset 0 (`start`),
   `(max - s) / 2` rounded down (`centre`) or `max - s` (`end`) along the longer side, then a resize to at most 400 and
   to at most 128 (`fit: "inside"`, `withoutEnlargement: true`);
3. `large.webp` from the 400 square at quality 82 and `small.webp` from the 128 square at quality 80
   (`AVATAR_VARIANTS` in packages/media-protocol/src/limits.ts);
4. the blurhash from the 128 square's pixels, and, with a scorer, the R1 score from the 400 square's pixels, as a
   post's image gives it its small size's; the PDQ hash as for any upload.

The result file gains version 3 (packages/media-protocol/src/result.ts): version 2's members and `avatar: true` on a
ready result of an avatar job; the API reads versions 1 to 3 and refuses an avatar row whose ready result lacks the
mark, and a post's row whose result has it. The worker writes version 3. The uncropped image is never written.

### 7.5 Serving and its gates

`fileAccess` (apps/api/src/media/repo.ts:287) also reads `kind`, `profile_id` and, through `profile_id`, the profile's
`deleted_at`. `serve` (apps/api/src/media/flows/serve.ts) gains a branch before the post's: a row of kind `avatar` is
served exactly when it is `ready`, its `profile_id` is set, its profile is not deleted, its `moderation_state` is
`visible` and it is not erased; then with `PUBLIC_CACHE`, as a visible post's image. A set avatar that 7.6's review
withholds (`withheld`) is served to its owner only, with `PRIVATE_CACHE`, as an author's own hidden image is. Every
other avatar row is `not_found` for everyone, its owner included: a replaced, reset, held, sealed or deleted account's
picture is shown to nobody. Only the withheld branch asks for the viewer, so a visible avatar costs one query. The
`ETag` and the 304 are unchanged.

Every reader of `post_media` is enumerated once, as 3c's section 11 requires: the serve route, the staff reader of a
case's images (7.7), the export, `avatarsOf` (`Author.avatar`, `ProfileView.avatar`, the card, `/api/me`), and 3d's
custody commands. Each gains its avatar test with a sealed avatar, which nobody, its owner and staff included, is
served (section 12.3).

The views read avatars only through the media module's interface, never by a join on `post_media` outside media/
(apps/api/test/architecture.test.ts:117-118 refuses any file outside media/ whose source names `post_media` or
`postMedia`, comments included; social's views already read images through `media.forPosts`). The media module's index
gains `avatarsOf(profileIds, viewer): Promise<Map<string, AvatarView>>`, one statement on `post_media_avatar_idx` with
the serve branch's conditions (`profile_id` set, `status = 'ready'`, `moderation_state = 'visible'`, `erased_at is
null`), and the viewer's own avatar while 7.6's review withholds it. `loadPostViews`, the profile views, the card
builder (8.1, with no viewer), the activity flow's follow groups and `/api/me` call it once after their own query: one
more indexed query per page, not per author. `Author`, `ProfileListItem`, `ProfileView` and
the account's own `/api/me` answer gain `avatar: AvatarView | null`, `{ small, large }` as `mediaPath` makes them.

### 7.6 The checks of 3d

- **The matcher.** An avatar upload is an upload: an acting match refuses and holds it, with 3d's notice and objection,
  before it can be set; `PUT /api/me/avatar` on it answers `avatar_not_ready` (its row is never ready for its owner).
  A match that only flags lets the upload through, and `avatarSet` opens the finding (below).
- **The R1 score.** Taken by the worker from the 400 square (7.4) and kept by the media module as for any upload.
- **`moderation.avatarSet(accountId, mediaId)`** (apps/api/src/moderation/automated.ts, beside `imagesPublished`): on
  the module's background, it reads the avatar's score and match record through `media.signals`, which gains an avatar
  form; a score at or over the threshold, or a flag of the matcher, becomes its signal (`scoreSignal`, `matchSignal`)
  and its step. `automatedStep` gains the account branch: for a signal on an avatar it opens the program's finding on
  the account's case with the avatar in its scope (3d's finding of 7.9 step 2, its words with "this profile picture"
  for "this image") and takes no measure, whatever `AUTOMATION_R1_ACTS` says: no program takes a measure on an account
  (decision 15). Its sweep finds a failed step as it finds a post's.
- **R1's hold for review.** While `AUTOMATION_R1_ACTS` is on, an R1 score at or over the threshold also keeps the avatar
  from everyone but its owner until a person decides, as an image in a post is withheld: after the finding, the step
  calls `avatar_review` (6.5), and `avatar_apply` makes the row `withheld`. `serve` then answers it to its owner only
  (7.5), and `avatarsOf`, other readers' views and the card see no avatar (the monogram is drawn, the card has no
  image). The decision that answers the finding ends it: a `reset_avatar` removes the picture, any other answer shows it
  again. With `AUTOMATION_R1_ACTS` off nothing changes. Neither is a measure, and the owner, who still sees the picture,
  learns nothing about how to pass the check (decision 15).
- **The edge.** The outbox row of 6.4 is written when an avatar stops being public (replaced, removed, reset, sealed,
  withheld for review, or deleted with its account) and drained by 3d's `edge-purge` job like any other.

### 7.7 Moderation of an avatar

- **Reports.** A report or notice about an account takes its snapshot as 3c's section 7.1 step 4 has it, and now also
  the current avatar: the snapshot's `media` member, empty for an account until now, holds `[{ id, alt: null, width,
  height }]`, which `snapshotDigest` (packages/contracts/src/moderation.ts) already covers, and the case holds the row
  in `media_holds` as it holds a reported post's images (`MediaForCases.hold`, apps/api/src/media/cases.ts, gains the
  avatar). The console's case page shows the snapshot's avatar beside the display name and bio through the staff
  reader of a case's images, under the same freeze: a case frozen by a report of child sexual abuse material shows
  the placeholder, never the image.
- **`reset_avatar`.** On an account case, interim or final, as `reset_display_name` (6.5). The console's composer
  (apps/admin) offers the measure's label, "Reset profile picture", where it offers "Reset display name". Its
  statement's measure sentence (packages/rules, beside the field resets' words) says: "korbat removed this profile
  picture once and shows the letter of your display name in its place. You may set a new picture; what you set is
  judged on its own if someone reports it, and korbat does not put the old picture back when this measure ends or is
  lifted. The same picture cannot be set as your profile picture again for 30 days." For those 30 days `setAvatar`
  refuses an upload whose SHA-256 equals the reset picture's (`avatar_resets`, 6.5) with `avatar_reset` and the words
  `AVATAR_WORDS.resetRecently` (10.10), which say why; a near copy stays a moderator's call. The author's decision
  screen shows the snapshot's picture under `DECISION_WORDS.avatar`, "Profile picture", beside `displayName` and `bio`
  (apps/app/src/lib/moderation-words.ts). The measure's spec in `MEASURES` (packages/contracts/src/moderation.ts) copies
  `reset_display_name`'s with a new target, `"avatar"`, and that label; `MEASURE_KINDS` and `REVERSAL_KINDS` grow by
  one each, which the ledger's order tests follow, and every other list of the measures follows 6.5's enumeration.
- **`restore_avatar`.** Lifts a `reset_avatar` in a review or a correction; it writes nothing (6.5), and its sentence is
  `restore_display_name`'s with "picture".
- **The seal.** An account case's `seal_media` lists the account's avatars in `seal_avatars` (6.5), so a picture
  reported as child sexual abuse material is shown to nobody from the seal on, as the account's posts' images are.
  3d's `quarantine` service moves a sealed avatar's two files as it moves a held upload's (no post), `quarantine-list`
  (apps/api/src/cli/custody.ts) names them from `seal_avatars`, and a release erases them with the seal's posts' images
  through `releases.avatar_ids`. 3f's records of a report to an authority and of a hand-over list a sealed avatar by its
  image id, as they list a held upload.
- **3e.** A strike counts only for a final rule decision on a post (3e design, section 2), so `reset_avatar` gives none,
  as `reset_display_name` gives none.

### 7.8 Deletion, the purge and the export

- The purge's `within` already deletes every `post_media` row of the account that nothing keeps (`post_media_keep`);
  the avatar's is one of them, and its delete writes the outbox row. From the purge's transaction on, `serve` answers
  `not_found` for it, because its profile is deleted (decision 29).
- The export writes the avatar's `large.webp` as `media/<id>.webp` and adds `avatar: { id, file, width, height } | null`
  and `sharePreviews` to the `profile` member, after `retiredHandles` (section 11.2).
- A replaced or removed avatar is deleted at once unless a hold keeps it; the sweeper's rule becomes "on no post and no
  profile for a day" (`deleteUnattachedBefore`, apps/api/src/media/repo.ts:450, called by
  apps/api/src/media/sweeper.ts), so a held former avatar goes the day its hold ends, and a sealed one stays while
  `post_media_keep` keeps it (6.4, 6.5).

## 8. Share cards and titles

### 8.1 The routes

A new module, apps/api/src/cards/ (index.ts, build.ts, words.ts), mounts two routes beside `postStatusRoutes`, after
the global limit and before the session's resolution (apps/api/src/app.ts), so they read no cookie and answer the same
for everyone:

- `GET /api/cards/post/:id`: 404 with no body unless the post is shown to a signed-out reader (its `state` is `visible`,
  its author not deleted), exactly as `GET /api/posts/:id/status` answers 404 (apps/api/src/social/routes.ts:115-134);
  else 204 with the header `Korbat-Card`.
- `GET /api/cards/profile/:handle`: 404 unless a live profile holds the handle now, compared lowercased as
  `findProfileByHandle` compares it; else 204 with `Korbat-Card`. An old handle in `handle_history` answers 404, as its
  page shows "This account is not available".

Each builds its card from the same reads a signed-out `GET /api/posts/:id` and `GET /api/profiles/:handle` make, through
`postAccess` with no viewer, so moderation, deletion and 3f's `disabled` follow without a rule of the card's own. A
suspended account's visible post and profile get their card with no label (3e design, section 2). The status route
stays as it is, with its tests; Caddy stops asking it.

`Korbat-Card` is the card's head block (8.3) in UTF-8, base64-encoded, at most 6,000 bytes encoded (the block is held
to 4,096 bytes before encoding, which the builder asserts and a test proves at every length limit). Both routes answer
`Cache-Control: no-store`, as every API answer does.

### 8.2 Caddy

- **`card.html`.** infra/caddy/Dockerfile, after `expo export`, writes `/repo/apps/app/dist/card.html` from the export's
  `index.html` by inserting one line right after `<meta charset="utf-8" />`:
  `{{placeholder "http.reverse_proxy.header.Korbat-Card" | b64dec}}`, and fails the build unless the result holds that
  action exactly once and no other `{{`. The file is copied to `/srv` with the rest; it is never served by its own
  path (the default handle answers `/card.html` with 404).
- **`/post/*` and `/u/*`.** The existing `/post/*` handle asks `/api/cards/post/<id>` instead of the status route, and a
  new `/u/*` handle asks `/api/cards/profile/<handle>`, each with `method GET` and the rewrite of
  `{http.request.uri.path.1}`. The new handle's first line is `respond @push 403`, as in every app-site handle
  (infra/caddy/Caddyfile:36-39 and :84). Both page handles drop the request's `Range` (`request_header -Range`), so
  every page answer is a whole 200 or 404: a 206 from `file_server` would carry a `Content-Range` of the template's
  size, which the templates handler does not rewrite. On 204, `handle_response` rewrites to `/card.html`, runs
  `templates` and serves it with 200; on 404 it serves the plain shell with 404; on any other answer (a 429 of the
  global limit) the plain shell with 200; `handle_errors` serves the plain shell with 200 when the API cannot be asked,
  for `/u/*` as for `/post/*`. Every answer keeps `app_page_headers`, `Cache-Control "no-cache"` and gzip. `templates`
  is enabled in that one `handle_response` block and nowhere else, so no other response, and no proxied body, is ever
  evaluated.
- **Why it is safe.** The template is Caddy's own file from the build; the only action reads a placeholder and decodes
  it, and Go's templates never evaluate a value an action prints, so nothing the API or a user wrote is parsed as a
  template. The API escapes every value it puts in the block (8.5) and also writes `{` and `}` as character
  references, so the block holds no template delimiter even if it were parsed.
- **`robots.txt`.** infra/caddy/robots.txt, copied to `/srv/robots.txt` and served by the default handle (a real file
  wins over `try_files`' fallback), allows the pages that carry cards and their images only to the link-preview
  fetchers the design supports, named by their robots.txt tokens, the unfurlers of crawlers.json (12.1), and disallows
  every other agent (decision 20):

  ```
  User-agent: Twitterbot
  User-agent: facebookexternalhit
  User-agent: Slackbot-LinkExpanding
  User-agent: Discordbot
  User-agent: LinkedInBot
  Allow: /post/
  Allow: /u/
  Allow: /api/media/
  Disallow: /

  User-agent: *
  Disallow: /
  ```

  Twitterbot honours robots.txt and a blocked page gets no card (inputs 3.2); every other agent that honours it reads
  nothing. The README lists the named agents and why.
- **`X-Robots-Tag`.** Never set and then dropped: after `app_page_headers`' deferred `-Server`
  (infra/caddy/Caddyfile:26) a dropping block would run before the set, and the Caddyfile's model refuses a
  `header @m -Name` line. So `app_page_headers` does not carry it; the default handle declares `@named not path /
  /rules /transparency /explore/about /terms` and `header @named X-Robots-Tag "noindex"` (decision 20), a form the model
  reads (apps/app/test/browser/caddyfile.ts:74-77), and the `/post/*` and `/u/*` handles and `handle_errors` set it
  always. The API's security headers (apps/api/src/middleware/security-headers.ts) add it to every answer.
- **The check.** caddy:2.11.4 carries `http.handlers.templates` in its standard build; Task 6's first step proves it on
  the pinned image with `caddy list-modules`, and the card lab and the stack's smoke test of section 12.4 prove the
  placeholder, `b64dec` (one of the Sprig functions Caddy's templates include) and the statuses end to end. Should the
  pinned image lack either, the dry run records it in section 15 and the card routes answer the whole document instead
  (decision 19's first alternative), with the export copied into the API's image by a build stage both images share.

### 8.3 The head block

In this order, each a `<meta>` element on its own line, attributes in double quotes:

1. `name="robots" content="noindex"`;
2. `property="og:site_name" content="korbat"`;
3. `property="og:type"`: `article` for a post, `profile` for a profile, `website` for a generic card;
4. `property="og:url"`: `APP_ORIGIN` and `/post/<id>` or `/u/<handle as stored>`, the undecorated address;
5. `property="og:title"`;
6. `property="og:description"` and `name="description"` with the same text, when there is text;
7. when there is an image: `og:image` (the absolute URL of `large.webp` on `APP_ORIGIN`), `og:image:type`
   (`image/webp`), `og:image:width`, `og:image:height` and `og:image:alt`;
8. for a post, `property="article:published_time"`, the post's `created_at` in ISO 8601 UTC; for a profile,
   `property="profile:username"`, the handle;
9. `name="twitter:card"`: `summary_large_image` when the image is a post's, else `summary`.

No `twitter:site` or `twitter:creator` (korbat has no account there to name, and a person's account elsewhere is not
korbat's to publish), no `og:locale` (English, the default), no counts, no verified mark, no dates but the post's.

### 8.4 What each card shows

| Page and state | Status | Card |
|---|---|---|
| Post visible, author turned previews on | 200 | title `{displayName} (@{handle})`; description the text (8.5), an imported post's label first; image the first image shown to everyone, else the author's avatar, else none |
| Post visible, author's previews off (the default, decision 21) | 200 | generic: title "A post on korbat", no description, no image |
| Post visible, author suspended | 200 | as visible, no label |
| Post withheld, removed, disabled, deleted, erased, missing, or its author deleted | 404 | none: the plain shell |
| A reply | 200 | as a post; nothing of its parent |
| A quote | 200 | as a post; only its own text and images, never the quoted post's |
| Profile live, previews turned on | 200 | title `{displayName} (@{handle})`; description the bio (8.5), none when empty; image the avatar, else none |
| Profile live, previews off (the default) | 200 | generic: title "A profile on korbat", no description, no image |
| Profile suspended | 200 | as live, no label |
| Profile deleted or purged, an old handle, an unknown handle | 404 | none |

An image on a card is a `MediaView` of the post as a signed-out reader gets it (`isHiddenMedia` false), so a withheld,
removed, sealed, lost or erased image is never named, and its description (`alt`) is the post's own, which 2b requires.
An avatar's `og:image:alt` is "Profile picture of @{handle}" (8.6); an avatar that 7.6's review withholds is not used
(`avatarsOf` does not answer it). The imported post's label is the API's own copy of 3b's `import.label` and
`import.label.shortened` (3b design, section 10.9), which the API cannot import from the app: `CARD_WORDS`'
`card.imported` and `card.imported.shortened` (8.6), followed by a full stop and the text.

### 8.5 Text, lengths and escaping

- Text is the post's body or the bio as stored, already normalised (no control, bidirectional or zero-width
  character). Line breaks become single spaces. Mentions and links stay as written.
- Lengths are counted in code points (`Array.from`), as the database counts them: a title at most 70 (X's limit), cut
  with "..." when longer; a description at most 200, cut at the last space before 197 and ended with "..."; an image's
  description at most 420.
- Every value is escaped for a double-quoted attribute: `&` `<` `>` `"` `'` as `&amp;` `&lt;` `&gt;` `&quot;` `&#39;`,
  and `{` `}` as `&#123;` `&#125;`. URLs are built from `APP_ORIGIN`, a uuid and a handle that the handle rule limits to
  `[a-z0-9_]`, and escaped the same way.
- One function, `cardBlock` (apps/api/src/cards/build.ts), builds every block; its unit tests feed it display names,
  bios and texts holding `<script>`, `"><meta`, `&amp;`, `{{ .Env }}`, `{{`, `}}`, a 1,000-character body of one word,
  four-byte characters at every cut, and an empty body with an image.

### 8.6 Words and caching

The card's sentences live in apps/api/src/cards/words.ts (`CARD_WORDS`): "A post on korbat", "A profile on korbat",
"Profile picture of @{handle}", the title form `{displayName} (@{handle})`, `card.imported` "Imported from {source},
dated {date}" and `card.imported.shortened` ", shortened on import". `{source}` is the source's display name (`x` is
"X", `mastodon` "Mastodon", `bluesky` "Bluesky"), and `{date}` the post's date in UTC in one fixed form, "3 March
2019", since the server has no reader's locale. A unit test holds the card's sentence equal in shape to 3b's. The site
name is "korbat".

The page that carries a card is `no-cache`, as the shell is today, so a post withheld after it was shared loses its card
on korbat's side at the next fetch; the images it names keep 3d's `PUBLIC_CACHE` and its outbox. Unfurlers keep their
own copies beyond korbat's reach (inputs 3.5): X for about 7 days, Meta until a re-scrape, Slack about 30 minutes, each
Mastodon instance two weeks. Settings, Privacy says so beside the switch (section 10.8).

### 8.7 Titles

The `<title>` the server sends stays the shell's, "korbat", on every page (decision 23); the app replaces it with its
own `TITLE_WORDS` title once the bundle runs, which never names an account (UI design, decision 16). `og:title` names
the author or the profile, and every unfurler reads it before `<title>` (inputs 3.3). Section 12.4's crawler fixtures
hold both: the served `<title>` is "korbat" on a post's and a profile's card.

## 9. The API

### 9.1 Modules

- **apps/api/src/activity/** (new): `index.ts` (the module's deps and its routes), `repo.ts` (the list's query, the
  newer count, the seen marker, the settings), `flows.ts` (the merge of 5.5.2, the views), `retention.ts` (the job).
  It reads `activity_items`, `activity_state` and, through the social module's index, post views; it asks the
  moderation module's index for `authorActivity`. It writes nothing but `activity_state` and the retention's deletes.
- **apps/api/src/cards/** (new), section 8.
- **apps/api/src/social/** writes `activity_items` and `post_mentions` (5.3, 4.2), deletes them (5.6, 4.4), reads
  mentions into views and avatars through `media.avatarsOf` (7.5), and gains the hide-counts route, the avatar's set
  and remove (7.3) and the link-preview switch, beside `/me/explore`.
- **apps/api/src/media/** gains the avatar's upload query, job file, `attachAvatar`, `detachAvatar` and `avatarsOf`,
  serve branch, sweeper rule and holds, and keeps avatars out of its unattached-upload queries (7.2).
- **apps/api/src/moderation/** gains `authorActivity`, `avatarSet`, the avatar in the account's snapshot, and the
  measure's words.

### 9.2 Routes

| Route | Session | Answer |
|---|---|---|
| `GET /api/activity?tab=&cursor=`, `tab` one of `all` and `conversations` | signed in | `ActivityPage` |
| `GET /api/activity/newer?tab=&since=`, `tab` as above | signed in | `{ count }`, 0 to 21 |
| `POST /api/activity/seen` with `{ at }` | signed in, CSRF | 204 |
| `GET /api/activity/settings` | signed in | `ActivitySettings` |
| `PUT /api/activity/settings` with `ActivitySettings` | signed in, CSRF | `ActivitySettings` |
| `POST /api/media?kind=avatar&crop=`, `crop` one of `start`, `centre` and `end` | signed in, CSRF | `UploadResponse`, as today |
| `PUT /api/me/avatar` with `{ mediaId }` | signed in, CSRF | `{ avatar: AvatarView }` |
| `DELETE /api/me/avatar` | signed in, CSRF | `{ avatar: null }` |
| `POST /api/me/share-previews`, `DELETE /api/me/share-previews` | signed in, CSRF | `{ sharePreviews }`, as `/api/me/explore` |
| `PATCH /api/posts/:id/counts` with `{ hidden }` | signed in, CSRF, the post's author | `{ countsHidden }` |
| `GET /api/cards/post/:id` | none, before the session | 204 with `Korbat-Card`, or 404 |
| `GET /api/cards/profile/:handle` | none, before the session | 204 with `Korbat-Card`, or 404 |

The hidden-counts route answers `not_found` for a post that is not the caller's, is deleted, or is disabled, as
`deletePost` does; it is allowed on a withheld or removed post, which its author still sees. A suspended author may hide
a post's counts (`hidden: true`), which only reduces what others see, and is refused showing them (`hidden: false`) by
3e's predicate through `lockActing` (decision 17). `setSharePreviews` is written as `setShowInExplore` is
(apps/api/src/social/repo.ts:1079-1086, no predicate) for turning previews off (`DELETE`); turning them on (`POST`)
takes the acting row through `lockActing`, so a suspended account is refused. Neither names `liveNotSuspended`.

### 9.3 Contracts

- **packages/contracts/src/activity.ts** (new): `ACTIVITY_KINDS` (`reply`, `mention`, `quote`, `follow`),
  `ACTIVITY_REACH` (`everyone`, `older`, `following`, `off`), `ACTIVITY_MIN_AGE_HOURS` (48), `ACTIVITY_KEEP_DAYS` (90),
  `ACTIVITY_PAGE_SIZE` (30), `ACTIVITY_NEWER_CAP` (21); `ActivitySettings` (`{ replies, mentions, quotes, follows }`);
  `ActivityEntry`, a union on `type`: `post` (`kind` reply, mention or quote; `key`; `at`; `new`; `post: PostView`),
  `follows` (`key`, `at`, `new`, `count`, `actors: Author[]`, at most 3), and `moderation` (`kind` `decision`,
  `release`, `upload` or `lost`; `key`; `at`; `new`; `target` `post`, `profile` or `account`; `id`, the decision's,
  release's, refusal's or image's; `postId` and `postCreatedAt` when the target is a post); `ActivityPage` (`items`,
  `nextCursor`, `seenAt`); `ActivityQuery`, `ActivityNewerQuery`, `SeenRequest` (`at`, an ISO time).
- **packages/contracts/src/mentions.ts** (new): section 4.1.
- **packages/contracts/src/social.ts:** `AvatarView` (`{ small, large }`, paths); `Author.avatar: AvatarView | null`
  (so `ProfileListItem` has it too); `ProfileView.avatar`; `PostView.mentions` (`string[]`, 4.3; `QuotedPost` gains
  nothing); `PostView.countsHidden: boolean`, true when the author hid the counts; `PostCounts.likes` and
  `PostCounts.reposts` become `number | null`. One rule holds for every answer that carries `PostCounts`,
  `EngagementResponse` (`{ counts, viewer }`, the answer to every reader's like, unlike, repost and unrepost) included:
  the two are null exactly when the post's counts are hidden and the reader is not its author, so no reader learns a
  hidden count by liking or unliking; the app's optimistic update keeps a null as null. `CreatePostRequest.hideCounts`
  (optional, default false); `CountsRequest` (`{ hidden: boolean }`); `SharePreviewsResponse`.
- **packages/contracts/src/media.ts:** `MEDIA_KINDS` (`post`, `avatar`), `AVATAR_CROPS` (`start`, `centre`, `end`),
  `UploadQuery`; `MediaErrorCode` gains `avatar_not_ready` and `not_an_avatar` (Task 3) and `avatar_reset` (Task 4).
- **packages/contracts/src/moderation.ts:** the measure `reset_avatar` and the reversal `restore_avatar` (7.7).
- **packages/contracts/src/account.ts:** `ExportFormat` gains section 11.2's members.
- **packages/contracts/src/auth.ts:** `MeProfile` gains `sharePreviews`, beside `showInExplore`, read by the auth
  module's `me()` (apps/api/src/auth/flows/account.ts) from the profile store (apps/api/src/profiles/store.ts), which
  reads `profiles.share_previews` as it reads `show_in_explore`. `MeResponse` gains `avatar: AvatarView | null`, which
  apps/api/src/app.ts's `/api/me` adds from the media module's `avatarsOf` (7.5), as it adds `standing` from the
  moderation module.
- **Where each change lands.** A contract change is made in the task that builds its producer, together with the app's
  code and test fixtures that build or read the changed shape, so the app's typecheck passes at every task (section 13):
  `PostView`'s, `PostCounts`'s, `MeProfile`'s and the export's 2d members in Task 2, the avatar's in Task 3, the
  measure's in Task 4.

### 9.4 Errors

| Code | Status | When |
|---|---|---|
| `invalid_request` | 400 | a bad tab, cursor, time, setting, crop, or a `crop` without `kind=avatar` |
| `not_found` | 404 | another account's upload or post, a missing one; a card that does not exist |
| `avatar_not_ready` | 409 | the upload is processing, failed or refused |
| `not_an_avatar` | 409 | the upload is a post's image |
| `rate_limited` | 429 | a limit of 9.5 |
| `avatar_reset` | 409 | the upload is the picture a moderator reset on this account less than 30 days ago (7.7) |
| 3e's refusal | as 3e answers | a suspended account's new avatar, showing a post's counts, or turning link previews on |

`POST /api/activity/seen` and `PUT /api/activity/settings` are not refused for a suspended account: they change only
what the account reads, as "Ask for a person" and reading are left to it (3e design, row 9). Nor are
`DELETE /api/me/avatar`, `DELETE /api/me/share-previews` and `PATCH /api/posts/:id/counts` with `{ hidden: true }`:
each only reduces what others see (decision 17). The route walk's table `SUSPENDED_WRITES`
(apps/api/test/integration/standing-route-walk.test.ts), which fails on a write route it does not list, gains every new
write route: those above `allowed` (the counts route with the walk's `{ hidden: true }`), `PUT /api/me/avatar` and
`POST /api/me/share-previews` `refused`.

### 9.5 Limits

Each write route declares its limit next to it, counted in Valkey under `social:<bucket>:<account>` by the existing
counter (apps/api/src/social/limits.ts), and fails closed. The five new actions join `WriteAction` and `limitsFor` in
apps/api/src/social/tiers.ts, with buckets named as the existing ones are (lower case and hyphenated, as `follow-hour`
and `upload-day`):

| Action | Bucket | Limit |
|---|---|---|
| `activity-seen` | `activity-seen` | 240 an hour |
| `activity-settings` | `activity-settings` | 120 an hour (the app saves a settled choice only, 10.8) |
| `avatar` (set and remove together) | `avatar-hour`, `avatar-day` | 10 an hour, 30 a day |
| `share-previews` | `share-previews` | 30 an hour |
| `hide-counts` | `hide-counts` | 60 an hour |

The activity module counts through the social module's index, which exports `enforceWriteLimit`
(apps/api/src/social/index.ts:21); it imports nothing deeper. An avatar's upload counts under the existing `upload`
and `upload-day` buckets. The reads and the card routes are under the API's global
limit per address (300 a minute), as the status route is (decision 30).

## 10. The screens

Every screen is drawn with the UI sub-project's tokens and kit (apps/app/src/components/kit/), titled from
`TITLE_WORDS` through `usePageTitle`, with one h1, times through apps/app/src/lib/time.ts, and every sentence from a
words module (10.10). Nothing here animates beyond the kit's own motion, and each has its reduced form.

### 10.1 The nav

`navItems` (apps/app/src/components/AppShell.tsx) gains Activity, second, with Lucide's `Bell`, named `activity` in the
icon map (apps/app/src/components/icons.ts) and the label `nav.activity`, "Activity" (decision 24):

- the full nav (1280 px and wider) and the rail (768 to 1279 px): Home, Activity, Bookmarks, Profile, Settings;
- the phone's tab bar (below 768 px): Home, Activity, Bookmarks, Profile; Settings is reached from the profile's
  settings button, which every own profile shows. That button's label, `profile.settings`
  (apps/app/src/lib/ui-words.ts:270, used at apps/app/src/app/u/[handle]/index.tsx:227), changes from "Security and
  privacy settings" to "Settings", since it opens the Settings index and is the phone's only way to Appearance,
  Activity, Account and Cases; the Getting started panel's profile row says where it is (10.7). Activity's header
  holds a quiet link to Settings, Activity.

The item never carries a dot, a number or a word other than its label; the shell's comment "Nothing here counts or
badges anything" stays true, and the shell test holds it (12.5). The signed-out nav is unchanged.

### 10.2 Activity

A new route, apps/app/src/app/activity.tsx (`/activity`), for an account only: signed out it redirects to Sign in, as
Bookmarks does. Title `title.activity`, "Activity - korbat"; h1 "Activity" in ScreenHeader.

- **Tabs.** The kit's Tabs, named `activity.tabs`: All and Conversations (replies, mentions and quotes). The selected
  tab is part of the address (`?tab=conversations`), so a reload keeps it; nothing is stored.
- **The list.** The kit's PagedList with Load more, as every list (UI design, decision 6), 30 entries a page. Each
  entry is a row of apps/app/src/components/activity/ (new), and each is an article named by its line and its time
  (`activity.entry.name`, "Ada replied to your post, 3h ago"), with "New, " first while it is new
  (`activity.entry.newName`), so a screen reader moving by item hears what each is and which are new:
  - `PostEntry`: the line (`activity.reply`, `activity.mention` or `activity.quote` with the actor's display name) and
    the time, then the post as a static PostCard (3b's static variant, UI design section 6.6), whose body is the link
    to the post; the actor's Avatar at 40 px. Below the card, the card's Reply action alone (no Like or Repost, which
    keeps the row quiet) opens the composer as a reply in place, as the feed's card does, since each entry is a
    conversation to answer (1.5).
  - `FollowsEntry`: up to three 32 px Avatars side by side, the line (`activity.follow.one`, `.two` or `.many`) and the
    time of the group's newest follow (`{time}`, as every entry is labelled; the UTC day of decision 6 stays the bucket
    and is never shown as a day). The row itself is not pressable: each of the up to three names in the line is its own
    link to that profile, and a group of more than three ends with `activity.follow.all`, "See your followers", which
    opens the account's own Followers list. One target per control, each at least 44 px high on phones.
  - `ModerationEntry`: a ListRow with the scale icon the Cases screen uses, the line (10.10), the time the person was
    told and `activity.moderation.open`, "Open in Cases"; it opens the decision, release or refusal screen under
    Settings, Cases, or the post for a lost image.
- **What is new.** Entries marked `new` come first, as they are newest. Two h2 headings mark the parts, so headings
  navigation reaches both: `activity.divider`, "New since you last looked", above the first new entry, and
  `activity.earlier`, "Earlier", above the first older one, drawn as the feed's "You were here" is (a line and a label,
  ink-medium, never a colour alone); with no new entry neither is drawn. After the first page is shown, the screen
  sends the seen marker (5.7). Entries are never highlighted by colour.
- **The pill.** While the screen is open and visible, `lib/activity.ts` asks for newer entries at 30 seconds and then
  every 60 (5.8) and shows the feed's pill component with `activity.pill`, announced once, politely, as the feed's
  pill is; pressing it reloads the first page at the top. Pull to refresh does the same on phones. After the pill or a
  refresh, focus moves to the list's first entry; after Load more, to the first entry it loaded.
- **Empty and end.** The kit's EmptyState with `activity.empty.all.*` or `activity.empty.conversations.*`; after the
  last page, `activity.end`, which names the 90 days. ErrorState with its retry on a failed load.

### 10.3 Mentions in posts and in the composer

`RichText` links stored mentions only (4.5). The composer (apps/app/src/components/social/composer/) shows
`activity.composer.mentions` under the text field, in ink-medium, while the text holds a handle by `MENTION_TOKEN`;
nothing else changes in it, and no account is looked up while typing (decision 13).

### 10.4 The avatar everywhere

`Avatar` (apps/app/src/components/kit/Avatar.tsx) draws `src` when it is given: `small` at 32 and 40 px, `large` at 64
and 96 px, through `expo-image` with no transition, in the same disc, ring and size as the monogram, and stays
`aria-hidden` inside its profile link (UI design, section 6.5). Without `src`, or when the image fails to load, the
monogram is drawn, so nothing moves (the UI design's decision 22). PostCard, ProfileList, the composer card, the profile
header and Activity's rows pass `author.avatar`. The profile header's layout does not change.

### 10.5 The avatar picker

Settings, Profile (apps/app/src/app/settings/profile.tsx) gains a card "Profile picture" above the display name:

- the current avatar at 96 px (or the monogram), "Choose a picture" (or "Choose another picture") and, when there is
  one, "Remove picture";
- choosing a file goes through the existing picker (apps/app/src/lib/pick-images.ts), one image, with the types and
  the HEIC sentence 2b already has. The card then shows a 96 px preview of the local file in the avatar's disc,
  `object-fit: cover`, and a radio group "Which part to keep" with three choices named by the image's shape (Top,
  Middle, Bottom for a portrait; Left, Middle, Right for a landscape; none for a square), each moving the preview's
  `object-position`, so the preview is the square the worker will keep; the preview's name says the choice
  (`AVATAR_WORDS.previewPart`, "Preview of your profile picture, Top part kept");
- "Use this picture" uploads with `kind=avatar` and the crop, shows `AVATAR_WORDS.uploading` and then
  `AVATAR_WORDS.processing` in a polite status line (`role="status"`, the UI design's rule for loading statuses) while
  it polls the upload's status as the composer does, then sets it, shows the toast `AVATAR_WORDS.updated` and moves
  focus to "Choose another picture". A refused upload shows UPLOAD_TEXTS' `refused` and its "Why" link, as the
  composer does, a failed one `AVATAR_WORDS.failed`, and a picture a moderator reset less than 30 days ago
  `AVATAR_WORDS.resetRecently` (7.7); each is an error line (`role="alert"`, as form errors are) that takes focus, with
  its "Why" link next in order. "Cancel" drops the local file and returns focus to "Choose a picture";
- "Remove picture" opens the kit's confirm dialog (`AVATAR_WORDS.confirmTitle`, `AVATAR_WORDS.confirmBody`, with
  `AVATAR_WORDS.confirm` and Cancel), since the files go after the commit; on Remove it shows the toast
  `AVATAR_WORDS.removed`, and focus returns to "Choose a picture".

The preview's `blob:` address is allowed by the page's policy (`img-src 'self' data: blob:`) and revoked when the card
closes.

### 10.6 Hide counts

- The composer's options gain a switch, `post.hideCounts.option`, "Hide like and repost counts", off by default, sent as
  `hideCounts`.
- The post's More menu gains, for its author, `post.hideCounts` or `post.showCounts`, which calls the route and
  answers at once with a rollback on refusal, as every action of the post does (UI design, section 6.6); the toast
  says `post.countsHidden` or `post.countsShown`.
- A post whose counts are null shows no number beside Like and Repost, as the reader's own setting draws it (UI design,
  decision 15); a like's or a repost's optimistic update (lib/post-actions.ts) keeps a null as null, and the answer
  (`EngagementResponse`) brings null again (9.3). The author's "Who sees this" sheet gains `reach.countsHidden` while
  they are hidden.

### 10.7 First visit

`FeedList` (apps/app/src/components/social/FeedList.tsx) shows, for a signed-in account on Following while the feed
has no item, a Getting started panel instead of today's empty state (decision 25): the heading `feed.start.title`, one
sentence `feed.start.body`, and five rows, each one line and one link: Latest (switches Home's tab), Explore and how it
picks (`/explore/about`), the handle box itself (the existing `HandleBox` component, drawn inside the panel on every
width), the profile's settings (`/settings/profile`, `feed.start.profile`, with `feed.start.settings` below it under
768 px, where Settings is on the profile, 10.1), and the rules (`/rules`). Below 1024 px, where the context column
is not drawn, the panel ends with AboutCard's three lines. No account is suggested, nothing is dismissed or stored, and
the panel goes as soon as Following has a post. The passkey suggestion keeps its place above it.

### 10.8 Settings

- **The index** (apps/app/src/app/settings/index.tsx) gains the row "Activity", after Appearance, with the hint
  `ACTIVITY_SETTINGS_WORDS.hint`.
- **Settings, Activity** (apps/app/src/app/settings/activity.tsx, new; title `title.settingsActivity`): an intro and
  four radio groups of the kit's form, each one tab stop whose arrows move the choice, as Appearance's are: Replies to
  your posts, Mentions of you, Quotes of your posts (Everyone, Accounts older than 2 days, Accounts you follow, Off) and
  New followers (On, Off). Unlike Appearance's, these choices are saved on the server, so a group's value is saved once
  it has been still for 800 ms or when focus leaves the group: one request and one toast per settled change, never one
  per arrow press; a failed save rolls back with its sentence.
- **Settings, Privacy** (apps/app/src/app/settings/privacy.tsx) gains a "Link previews" card with its switch, off
  until the person turns it on (decision 21), and its one sentence saying what a preview shows and where, and the note
  on search engines; its explanation of blocks and mutes changes (decision 8). Nothing elsewhere asks the person to
  turn previews on.

### 10.9 The browser check and the budget

- The fixture API (apps/app/test/browser/fixture-api.ts) gains the activity routes with entries of every kind (a page
  boundary inside a follow day, two new entries, moderation entries of each kind), `PUT` and `DELETE /api/me/avatar`,
  avatar files (two small WebP squares written by the fixture's code), the hide-counts route, mentions on its posts
  (one stored, one not, one imported), and a fresh account whose Following is empty.
- The check (apps/app/test/browser/app.browser.ts) gains steps 52 to 57 after 3b's 51: 52 Activity at 360, 768 and 1280 px in the
  three themes, its tabs, rows, headings and pill, each entry's accessible name and where focus goes after the pill and
  after Load more, a follow group's three name links, with no request to `/api/activity` from any other route and no
  change of the nav or the title when entries arrive, and at 360 px Settings reached from the profile by its name; 53
  Settings, Activity's radio groups by keyboard, arrowing across a group sending one request; 54 the avatar picker from
  a fixture image to the header and a post card, its status line, the confirm dialog of its removal and the focus after
  each; 55 mentions: a stored one links, an unstored and an imported one do not; 56 the Getting started panel at 360 px
  with the handle box; 57 hiding counts from the More menu, seen by another reader as no number. Every new label passes
  the clip test at 360 px; every new target is at least 44 by 44 px on phones; contrast is sampled on the new rows in
  Light, Dim and Dark.
- **The budget.** 2d adds at most 20,480 bytes of gzipped JavaScript to the export as 3b's replay leaves it (decision
  27). Each task that changes the app records the export's size in its summary; Task 5 (section 13) holds the total.
  The cap in force at 2d's start is the one in app.browser.ts as 3b's replay leaves it (832,257 bytes, the baseline
  plus 120 KB, which 3b's Task 7 set under the orchestrator's rule; 791,297 at 0bc2dcc). While the export fits, it
  stays; otherwise Task 5 raises it to the baseline plus 140 KB (852,737 bytes) by editing app.browser.ts:622-623 (the
  rule's added kilobytes and the pinned number), with the measured numbers as an amendment of section 15 flagged
  (owner).

### 10.10 Words

Every new sentence, by module. `{name}` is a display name, `{n}` a number, `{time}` comes from lib/time.ts, and
`{date}` is lib/time.ts's date form (never "ago"). The moderation entries reuse 3d's words unchanged where those exist
(the last rows of the first table).

apps/app/src/lib/activity-words.ts (new, `ACTIVITY_WORDS`):

| Key | Sentence |
|---|---|
| `activity.title` | Activity |
| `activity.tabs` | Activity |
| `activity.tab.all` | All |
| `activity.tab.conversations` | Conversations |
| `activity.settingsLink` | Activity settings |
| `activity.entry.name` | {line}, {time} |
| `activity.entry.newName` | New, {line}, {time} |
| `activity.divider` | New since you last looked |
| `activity.earlier` | Earlier |
| `activity.pill.one` | 1 new |
| `activity.pill` | {n} new |
| `activity.pill.many` | 20+ new |
| `activity.pill.label` | {visible} above, go to the first one |
| `activity.reply` | {name} replied to your post |
| `activity.mention` | {name} mentioned you |
| `activity.quote` | {name} quoted your post |
| `activity.follow.one` | {name} followed you |
| `activity.follow.two` | {name} and {other} followed you |
| `activity.follow.many` | {name} and {n} others followed you |
| `activity.follow.all` | See your followers |
| `activity.decision.post` | A decision about your post from {date} |
| `activity.decision.profile` | A decision about your profile |
| `activity.decision.account` | A decision about your account |
| `activity.moderation.open` | Open in Cases |
| `activity.empty.all.title` | Nothing here yet |
| `activity.empty.all.body` | When someone replies to you, mentions you, quotes you or follows you, it shows here, and so do decisions korbat sent you. korbat does not tell you about replies, mentions, quotes or follows anywhere else. |
| `activity.empty.conversations.title` | No conversations yet |
| `activity.empty.conversations.body` | Replies to your posts, mentions of you and quotes of your posts show here. |
| `activity.end` | That's everything from the last {days} days. |
| `activity.error` | Your activity could not be loaded. |
| `activity.composer.mentions` | Up to 10 accounts you name with @ are told, if their settings allow it. |
| (3d) release | `RELEASE_TEXTS.entry`, "Sealed images released", unchanged |
| (3d) refused upload | `UPLOAD_TEXTS.entry`, "An upload was not accepted", unchanged |
| (3d) lost image | `IMAGE_LOST_NOTICE.mail({time})` (packages/rules), unchanged |

apps/app/src/lib/ui-words.ts (`UI_WORDS` and `TITLE_WORDS`):

| Key | Sentence |
|---|---|
| `nav.activity` | Activity |
| `title.activity` | Activity - korbat |
| `title.settingsActivity` | Activity - Settings - korbat |
| `feed.start.title` | Getting started |
| `feed.start.body` | Following shows posts from the accounts you follow, newest first. Here is how to find some. |
| `feed.start.latest` | Read Latest: every public post, newest first |
| `feed.start.explore` | See Explore, and how it picks |
| `feed.start.handle` | Go to a profile by its handle |
| `feed.start.profile` | Set up your profile: a name, a bio and, if you like, a picture |
| `feed.start.settings` | On a phone, Settings is on your profile. |
| `feed.start.rules` | Read the rules |
| `profile.settings` (changed) | Settings |
| `post.hideCounts.option` | Hide like and repost counts |
| `post.hideCounts` | Hide like and repost counts |
| `post.showCounts` | Show like and repost counts |
| `post.countsHidden` | Like and repost counts hidden |
| `post.countsShown` | Like and repost counts shown |
| `reach.countsHidden` | Like and repost counts are hidden from everyone but you. |

apps/app/src/lib/settings-words.ts:

| Key | Sentence |
|---|---|
| `ACTIVITY_SETTINGS_WORDS.nav` | Activity |
| `ACTIVITY_SETTINGS_WORDS.hint` | Who can reach you in Activity |
| `ACTIVITY_SETTINGS_WORDS.intro` | Choose what shows in your Activity. korbat never tells you about replies, mentions, quotes or follows anywhere else: no email, no push and no badge. Decisions about your posts and account also come by email. |
| `ACTIVITY_SETTINGS_WORDS.replies` | Replies to your posts |
| `ACTIVITY_SETTINGS_WORDS.mentions` | Mentions of you |
| `ACTIVITY_SETTINGS_WORDS.quotes` | Quotes of your posts |
| `ACTIVITY_SETTINGS_WORDS.follows` | New followers |
| `ACTIVITY_SETTINGS_WORDS.everyone` | Everyone |
| `ACTIVITY_SETTINGS_WORDS.older` | Accounts older than 2 days |
| `ACTIVITY_SETTINGS_WORDS.following` | Accounts you follow |
| `ACTIVITY_SETTINGS_WORDS.off` | Off |
| `ACTIVITY_SETTINGS_WORDS.on` | On |
| `ACTIVITY_SETTINGS_WORDS.muted` | Accounts you mute or block never show in your Activity. |
| `ACTIVITY_SETTINGS_WORDS.fromNow` | A change applies from now on. It does not bring back what was not shown. |
| `ACTIVITY_SETTINGS_WORDS.saved` | Saved |
| `ACTIVITY_SETTINGS_WORDS.failed` | Your choice could not be saved. Try again. |
| `PRIVACY_WORDS.explain` (changed) | A block hides you and the other account from each other while signed in and refuses their interactions. Posts on korbat are public, so anyone who signs out can still read them. A mute hides an account from your timelines and your Activity, and they are never told. |
| `PRIVACY_WORDS.previews` | Link previews |
| `PRIVACY_WORDS.previewsSwitch` | Show a preview when someone shares a link to my posts or profile |
| `PRIVACY_WORDS.previewsExplain` | When this is on, a link to your post or profile shared on another site shows your display name, your handle, the post's text or your bio and its first image or your profile picture, as anyone signed out sees them, and that site may keep its copy after you delete the post, where korbat cannot remove it. |
| `PRIVACY_WORDS.search` | korbat asks search engines not to list your posts and your profile, and turns away every crawler but the link-preview fetchers. |
| `AVATAR_WORDS.section` | Profile picture |
| `AVATAR_WORDS.explain` | Your picture is public: anyone can see it, signed in or not, and link previews show it on other sites if you turn them on in Privacy. A picture of you can identify you. korbat keeps only the square you choose and removes the photo's location and camera details. |
| `AVATAR_WORDS.choose` | Choose a picture |
| `AVATAR_WORDS.change` | Choose another picture |
| `AVATAR_WORDS.remove` | Remove picture |
| `AVATAR_WORDS.keep` | Which part to keep |
| `AVATAR_WORDS.top` | Top |
| `AVATAR_WORDS.middle` | Middle |
| `AVATAR_WORDS.bottom` | Bottom |
| `AVATAR_WORDS.left` | Left |
| `AVATAR_WORDS.right` | Right |
| `AVATAR_WORDS.preview` | Preview of your profile picture |
| `AVATAR_WORDS.previewPart` | Preview of your profile picture, {part} part kept |
| `AVATAR_WORDS.use` | Use this picture |
| `AVATAR_WORDS.cancel` | Cancel |
| `AVATAR_WORDS.uploading` | Uploading your picture... |
| `AVATAR_WORDS.processing` | Preparing your picture... |
| `AVATAR_WORDS.updated` | Profile picture updated |
| `AVATAR_WORDS.removed` | Profile picture removed |
| `AVATAR_WORDS.failed` | This picture could not be used. Try another one. |
| `AVATAR_WORDS.resetRecently` | A moderator removed this picture from your profile less than 30 days ago, so it cannot be your profile picture again yet. |
| `AVATAR_WORDS.confirmTitle` | Remove your profile picture? |
| `AVATAR_WORDS.confirmBody` | korbat deletes it. You can choose a picture again at any time. |
| `AVATAR_WORDS.confirm` | Remove |

Elsewhere: apps/api/src/cards/words.ts (8.6); the measure's label "Reset profile picture" in `MEASURES`,
`DECISION_WORDS.avatar` ("Profile picture"), each measure's sentence in apps/app/src/lib/terms.ts, and the statement's
sentences in packages/rules (7.7); 3d's finding words with "this profile picture" (7.6). The source scan
(apps/app/test/a11y.test.tsx) covers the new files, and the shell test holds that no title key holds a placeholder.

## 11. Privacy and transparency

### 11.1 What is stored, and for how long

| What | Holds | Kept |
|---|---|---|
| An Activity entry | the recipient, the actor, the kind, the post's id, the time; never a text | 90 days, less when its post is deleted, a block falls between the pair or an account is purged |
| `activity_state` | the seen time and four settings | as long as the account |
| A mention | the post, the account named, the handle as typed, its place | as long as the post, less when it is erased |
| An avatar | the two squares and the row 2b keeps for any image (owner, sizes, blurhash, score and hashes while 3d's tools are on), and its SHA-256 | while it is the avatar; a replaced or removed one is deleted at once unless a case holds or a seal keeps it |
| A reset picture's SHA-256 (`avatar_resets`) | the hash, the account, the decision's action | read for 30 days after the reset, then kept as long as its case's evidence |
| The link-preview switch and the hidden-counts switch | one boolean each | as long as the account or the post |
| A card | nothing: built at each request from the public post or profile | never stored by korbat; other platforms keep their copies (8.6) |

The retention job logs only how many rows it deleted. The card routes are logged as every request is, by method,
path, status and duration (apps/api/src/middleware/observability.ts:17), so a profile card's path names the handle and
a post card's the post's id, as `GET /api/profiles/:handle` and `GET /api/posts/:id` already do; no text is logged.

### 11.2 The data export

`ExportFormat` (packages/contracts/src/account.ts) and apps/api/src/account/flows/export.ts gain, each in the format's
order after what 3b adds:

- in `profile`: `avatar` (`{ id, file, width, height }` or null; the file is `media/<id>.webp`, the 400 px square) and
  `sharePreviews`;
- in each element of `posts`: `mentions` (the handles as written, in order) and `countsHidden`;
- a member `activity`: `{ seenAt, settings, received }`, where `received` lists every row the account received that
  korbat still holds, newest first, ungrouped, each `{ kind, at, postId, actorHandle, shown }` with the actor's handle
  at the time of export (`postId` null for a follow), read through the activity module's index (`exportEntries`).
  `shown` is `true`, or why the list does not show it: `muted` (the person mutes the actor),
  `post_not_visible` (the post is withheld, removed, disabled or erased), `unfollowed` (the follow is gone) or
  `actor_deleted`. A row whose post is not visible carries `postId` null, so the export never discloses another
  person's moderation. Moderation entries are left out, since the `moderation` member already holds them (decision 28).
  The right of access reaches what korbat holds, not what it draws; counsel confirms the line (11.3).

### 11.3 The terms and the privacy text

The terms' privacy section (the terms' source in packages/rules, rendered at `/terms`) gains, as drafts that counsel
reviews before korbat opens (sub-project 4, as 3d's drafts are):

- what Activity stores and for how long, printed from `ACTIVITY_KEEP_DAYS`, and that no mail or push is sent about it;
- that a mention links to the account it named when the post was written and tells that account, within its settings;
- that a profile picture is public, is checked like every image, can be reset by a moderator under the rules, and is
  deleted with the account;
- that a shared link to a public post or profile shows a generic card, or, once its author turned previews on, a
  preview with what a signed-out reader sees; that other sites keep their copy beyond korbat's reach; that robots.txt
  turns away every crawler but the named link-preview fetchers; and that korbat asks search engines not to index posts
  and profiles, which search engines may or may not honour.

`TERMS_VERSION` does not change for drafts, as 3d's did not (3d design, section 16). Counsel also answers these
questions, which the design answers without a lawyer; the README's Before going public lists the review and the
questions word for word:

1. Export scope (decision 28): must the rows korbat holds but does not show be given, as 11.2 gives them, and is the
   actor's handle in `received` (a third party's data, GDPR Art. 15(4) and 20(4)) fine, as the export's likes and
   follows already are?
2. Link previews (decision 21): would "on" by default be compatible with Art. 25(2) GDPR's privacy by default, given
   that cards put a person's name, text and picture into other platforms' stores that korbat cannot erase? korbat
   admits people from 16 and cannot tell who is under 18: do Art. 28 DSA and, for UK users, the Children's Code
   require the default to stay off for everyone, or would a stored "adult from" date (never the date of birth) let it
   differ?
3. Crawlers (decision 20): may the terms forbid automated collection and the use of korbat's content for model
   training, and does robots.txt's wording matter for the text and data mining reservation of Art. 4(3) of Directive
   2019/790 (a machine-readable reservation)?
4. Avatars and hashing: are the matcher's perceptual hash of a face picture and the SHA-256 kept after a reset outside
   processing "for the purpose of uniquely identifying a natural person" (Art. 9 GDPR)? The terms will describe the
   checks, so counsel says so in writing.
5. `reset_avatar` as a restriction under Art. 17 DSA: its statement of reasons (7.7's sentences) and its place in the
   transparency report's measures table (11.4).
6. Retention (decision 11): 90 days for entries, the seen marker and the settings for the account's life, and a reset
   picture's hash for 30 days of use.

### 11.4 Transparency

The yearly editions on `/transparency` label their measures table with `MEASURE_KINDS`
(packages/contracts/src/transparency.ts, `FIGURE_LABELS.measures`), so `reset_avatar` becomes a label of its own from
the first edition after 2d, and a count under the floor folds into `other`, as every small cell does; editions already
published never change (3d). `/rules`, which lists the measures korbat may take, names the profile picture's reset
beside the display name's and the bio's. Nothing about Activity, mentions or cards is published: none is a decision.

## 12. Testing

Every fixture is built by code; no real person's image, archive or post is ever used. Tests sit where each package keeps
them today.

### 12.1 Fixtures built by code

- **Images.** The worker's tests draw their sources with sharp: a 300 by 200 PNG and a 200 by 300 PNG, each in three
  flat colour bands along its longer side, so a crop's position is read back from the square's centre pixel; a 90 by
  60 PNG (smaller than both squares); an EXIF-rotated JPEG. The app's browser check writes two small WebP squares in
  fixture-api.ts.
- **Accounts and posts.** apps/api/test/integration's existing helpers (flow-harness.ts, auth-fixtures.ts) make the
  accounts; a helper in the new activity tests makes a pair with each relation (follows, mutes, blocks either way).
- **Crawlers.** infra/caddy/lab/crawlers.json (new) holds the request shapes of six unfurlers as their official pages
  give them (inputs 3.2 and 3.3): the User-Agent strings of Twitterbot, facebookexternalhit, Slackbot-LinkExpanding,
  Discordbot, LinkedInBot and Mastodon's fetcher, with Meta's `Range: bytes=0-524288` and Slack's range request,
  `Accept-Encoding: gzip, deflate`, and no cookie. The card lab and the smoke test read it (12.4).

### 12.2 Unit tests

- packages/contracts/test/mentions.test.ts: `MENTION_TOKEN` and `mentionHandles`: the right boundary (a 26-character
  run is no mention), an e-mail address, `_` and digits at either edge, case folding, order, repeats, the 40-handle scan
  cap, a `retired_` handle, a handle beside punctuation and line breaks.
- packages/contracts/test/activity.test.ts: every shape of 9.3, the cursor's round trip, `ACTIVITY_KEEP_DAYS` and
  `ACTIVITY_MIN_AGE_HOURS`.
- packages/contracts/test/social.test.ts: `PostCounts` with null likes and reposts; `Author.avatar`.
- packages/media-protocol/test: `avatarJob` paths; result version 3 accepted with `avatar: true` only on a ready result;
  version 4 refused.
- apps/worker/test/pipeline.test.ts: each crop position on the portrait and the landscape fixture, the sizes 400 and
  128, the small fixture never enlarged, rotation applied before the crop, a malformed job file failing as
  `processing_failed`, a post's upload unchanged (two sizes of 2,048 and 1,024), the scorer fed the 400 square, and
  both squares carrying no EXIF or XMP (the EXIF-rotated fixture's metadata absent), which `AVATAR_WORDS.explain`
  promises (10.10).
- apps/api/test/media/files.test.ts: the job file written before the upload's rename; `storedUploads` listing an
  orphaned `<id>.avatar`, which the reconcile pass removes once older than `ORPHAN_AGE_MS` (7.2).
- apps/api/test/social/tiers.test.ts: the five new actions and their buckets (9.5).
- apps/api/test/cards.test.ts: `cardBlock` with section 8.5's hostile inputs, every length limit at its edge with
  four-byte characters, the tag order of 8.3, the 4,096-byte bound, the generic card naming no one, and
  `card.imported` (with `.shortened`) equal in shape to 3b's `import.label`, with each source's display name and the
  fixed UTC date.
- apps/api/test/architecture.test.ts: `MODULES` (line 28) gains `activity` (Task 2) and `cards` (Task 6), so each is
  entered only through its index; the one table of pins of 5.3 and the one insert into `post_mentions`;
  apps/api/src/staff/ and apps/api/src/moderation/ never import the activity module, beside the existing import rules;
  `STANDING_PREDICATE`'s counts per file (line 313) unchanged, since 2d's writes call `lockActing` and `judgeActing` or
  take no predicate (7.3, 9.2), and a builder who names a fragment anew states the new count in that task; the cards
  module reads no session.

### 12.3 Integration tests (apps/api/test/integration/)

- **activity-schema.test.ts.** Section 6: every CHECK and unique key; `activity_items_insert` forcing the time;
  `activity_state_guard` refusing a marker moved back or ahead of the clock; `post_mentions_insert` refusing a withheld
  or imported post's row and accepting one across a block; `post_mentions_erase`. Its avatar half (Task 3):
  `post_media_kind_place`, `post_media_avatar_owner` and `post_media_avatar_guard`; `post_media_insert` refusing a row
  inserted with `profile_id` set; `post_media_refused` refusing an avatar's set for each of its three arms (a refusal
  row, an erased row, a hold of infinity); `post_media_keep` keeping an avatar whose owner has a frozen account case;
  `post_media_purge` writing `state` for a detach, `deleted` for the purge's delete, nothing for a never-set or already
  detached avatar; the grants of 6.6 (no UPDATE on `activity_items` or `post_mentions`, no UPDATE of `kind` or
  `avatar_sha256`). Its moderation half (Task 4): `post_media_keep` keeping a sealed avatar that no hold keeps;
  `post_media_purge` writing `state` for a seal of a current avatar and `released` for a release; the REVOKEs on
  `seal_avatars`, `avatar_reviews` and `avatar_resets`.
- **http-activity.test.ts.** Each kind written and read; one entry per recipient and post (a reply that mentions its
  parent's author); the thread's root not told; the 10-mention cap; each setting (`everyone`, `older`, `following`,
  `off`) and the follow switch, with `older` refusing an actor 47 hours old and passing one 49 hours old; a mute
  stopping new entries and hiding old ones, an unmute showing them; a block either way deleting the pair's entries
  both ways and a block made between the lookup and the insert hidden at read; an unfollow hiding the follow entry and
  a re-follow writing none; a withheld reply hidden and shown again when restored, a removed
  and a disabled one hidden, a deleted one gone; a suspended actor's earlier entries kept and its new acts refused; a
  suspended recipient reading its list; follow groups by UTC day, with a page boundary inside a day giving one group;
  the tabs; the seen marker moving only forward, `new` against the stored value, `newer`'s cap of 21.
- **activity-moderation.test.ts.** A decision told to its author is an entry; one whose author was told nothing, one
  held for an order's notice, and one before the dispatch told it make none; a release with its notice held makes
  none until `releaseHeldNotices` runs; a refused upload and a lost image (through `lost_told_for`, after the dispatch)
  are entries; a staff note, a report about the recipient and a flag never appear; a decision told 91 days ago is no
  entry (Cases still lists it); the merge's paging across both sources is stable.
- **mentions.test.ts.** A stored mention links while its account holds the handle, and is plain text after a rename and
  after a retirement, the entry already written staying; a handle free when the post was written and claimed afterwards
  is not linked (no account then, so nothing stored); a mention of an account blocking the author, or blocked by it, is
  stored, links for a third reader, is plain text for the two accounts and writes no entry; a reader blocking the
  mentioned account sees plain text; a mentioned account purged while the post waits for its lock leaves no row; the 20
  stored; an imported post (3b's `publishImportedBatch`) stores none and tells no one; a deletion and an erasure remove
  the rows.
- **http-avatar.test.ts.** Upload with `kind=avatar` and each crop; set, replace and remove, each writing its outbox
  row; `not_an_avatar`, `avatar_not_ready`, another account's upload; a suspended account refused a new avatar and
  allowed to remove its own; the public cache header; a replaced and a deleted account's avatar not found for everyone,
  its owner included (a reset and a sealed one in avatar-moderation.test.ts, Task 4); the sweeper leaving the current
  avatar and deleting a held former one after its hold; an avatar using no pending slot,
  `DELETE /api/media/:id` on the current avatar answering `not_found`, and an avatar's id sent as a post's image
  answering the media error, not 500.
- **avatar-moderation.test.ts.** An account report's snapshot holding the avatar and its hold; `reset_avatar`'s
  compare-and-set (`profile_changed` after a new upload), its `no_effect` values, `restore_avatar` writing nothing;
  after a reset, the same file uploaded again refused with `avatar_reset` for 30 days and accepted after, and another
  file accepted at once; a reset and a sealed avatar not found for everyone, its owner included; the console's case
  page showing the held avatar and a frozen case showing the placeholder; an account case's seal
  listing the current and a held former avatar, their state `sealed`, `invalid_decision` only when both lists are
  empty, `unseal_media` restoring `visible`; its owner removing a sealed avatar that no hold keeps: the row and its
  files stay, and so do they under a replacement and the sweeper; `quarantine-list` naming a sealed avatar's two files;
  a release erasing them through `releases.avatar_ids`.
- **automation-avatar.test.ts.** With the scorer's test adapter, a score at the threshold on a set avatar opens the
  finding on the account's case with no measure, with `AUTOMATION_R1_ACTS` on and off; with it on, the avatar
  `withheld`: served to its owner only with `PRIVATE_CACHE`, absent from another reader's views and from the card, and
  shown again once a moderator answers the finding without a reset; with it off, shown throughout; a flagging match
  opening the finding the same way; an acting match refused at upload and `PUT /api/me/avatar` answering
  `avatar_not_ready`.
- **3c's gate S.** The test that walks the enumeration of `post_media`'s readers (3c design, section 11) gains a sealed
  avatar for each reader of 7.5.
- **http-cards.test.ts.** Every row of 8.4 through the route, with the status and the decoded block; the switch at its
  default (off, the generic card) and turned on; an avatar withheld for review never on a card; the status route still
  answering as before.
- **http-hide-counts.test.ts.** The composer's flag and the route; another reader's null counts in every view and in
  `EngagementResponse` (a second account likes a hidden-counts post and reads `counts.likes === null`, and again after
  unliking); the author's numbers; refusals of 9.2; a suspended author hiding counts and refused showing them.
- **account-export.test.ts and account-deletion.test.ts** gain the members of 11.2 (`received` holding a muted actor's
  row, a withheld post's row with `postId` null and an unfollowed follow, each with its `shown` reason) and the purge
  of 6.7; account-deletion.test.ts:207 stops expecting `avatarPath` (Task 3).
- **activity-retention.test.ts.** Rows of 89 and 91 days; batches; the job's lock.

### 12.4 The card lab, crawler fixtures and the Caddyfile's model

- **The card lab** (infra/caddy/lab/card-lab.mjs and README.md, new), run once in Task 6's first step and again at its
  end, as 3f's first step checked the status route on this image: it builds the Caddy image, starts it with a stub API
  of a few lines that answers the card routes with 204 and a block, 404, 429, or not at all, and asserts each page's
  status and bytes (`card.html` with the block decoded once in its head, or the plain shell); that a block holding
  `{{ .Env }}` and `{{env "HOME"}}` is written out as text and never evaluated; that `/card.html` asked directly answers
  404; `robots.txt`'s bytes; `X-Robots-Tag` on `/post/`, `/u/`, `/settings/appearance` and a `handle_errors` answer,
  and absent on `/`, `/rules`, `/transparency`, `/explore/about` and `/terms`; a push-network address answered 403 on
  `/u/x`; and that `caddy list-modules` lists `http.handlers.templates`. It sends each crawler of
  infra/caddy/lab/crawlers.json to both pages and asserts that the answers are the same for every User-Agent, that the
  Open Graph tags lie within the first 524,288 bytes and before `<title>`, that a ranged request gets a whole 200 with
  them (no 206), and that the served `<title>` is "korbat". Its measurements are recorded in Task 6's summary.
- **The smoke test** (scripts/smoke-auth-stack.mjs) does the same for one real post and one real profile on the rebuilt
  stack, with Twitterbot's User-Agent: the generic card while the account's previews are off (the default), the full
  card once it turns them on, and for a display name set to `{{env "HOME"}}` by its own account.
- **The Caddyfile's model.** apps/app/test/browser/caddyfile.ts (the browser check's reading of infra/caddy/Caddyfile,
  through apps/admin/test/caddyfile.ts) learns, in Task 6 with the Caddyfile itself, the `/u/*` handle as a page route
  served like `/post/*` and the `@named` line of `X-Robots-Tag`, so the browser check serves every page under the
  headers Caddy really sends. apps/admin/test/console-site.test.ts:227-228 asserts the push network's 403 on `/post/x`
  and `/u/x` too.

### 12.5 The app's tests and the browser check

- apps/app/test/activity.test.tsx: each entry's row, accessible name and words, the two headings, the pill's three
  forms, a follow group's name links and "See your followers", a post entry's Reply action, the empty and end states,
  the tabs in the address; Settings, Activity saving a settled choice once.
- apps/app/test/avatar-picker.test.tsx: the crop choices by shape, the preview's position and name, the upload and set
  sequence with its status line, a refused, a failed and a reset upload as error lines, the removal's confirm dialog,
  and where focus goes after each.
- apps/app/test/post-card.test.tsx: stored, unstored and imported mentions; null counts, kept null by a like's
  optimistic update.
- apps/app/test/shell.test.tsx: the nav's items at each width (four on a phone, five on wider screens); no count,
  dot or extra word on any item at any state of the fixture.
- apps/app/test/kit.test.tsx: `Avatar` with `src`, and its fallback to the monogram on an error.
- apps/app/test/a11y.test.tsx scans the new files; apps/app/test/terms.test.tsx holds the terms' new sections.
- The browser check's steps 52 to 57 (10.9).

### 12.6 Gates

- Every task: typecheck and unit tests of each package it changes (`pnpm --filter <package> typecheck` and `test`);
  a task that changes packages/contracts also runs the app's and the console's typecheck, so a contract change and its
  consumers land together (9.3).
- Batch ends: the runner's whole integration suite, as every sub-project's batches, and the app's typecheck from Task
  1 on; from Task 5 on, also `pnpm --filter @korbat/app test:browser`.
- Stack tasks: the stack rebuilt and scripts/smoke-auth-stack.mjs run, which gains an avatar set through the real
  worker (Task 3) and a card read through the real Caddy with Twitterbot's User-Agent (Task 6).

## 13. Tasks

Seven tasks in build order, in five batches: Tasks 1 and 2, Task 3 alone, Task 4 alone, Tasks 5 and 6, and Task 7
alone. Each runs the gates of 12.6. Before Task 1, this design is committed as
docs/superpowers/specs/2026-10-22-engagement-2d-design.md, and the names it takes from 3b (`posts.import_job_id`,
`PostView.imported`, 3b's last migration, its export members, `publishImportedBatch`, and the JavaScript cap its Task 7
leaves) are checked against 3b's replay; any difference is an amendment of section 15 before Task 1. Contract changes
land as 9.3 says.

**Task 1. Contracts and the database for Activity and mentions.** Goal: sections 4.1, 6.1 to 6.3, 6.6 and the
`post_options` columns of 6.4, and the two new contract modules of 9.3. Creates packages/contracts/src/activity.ts and
mentions.ts; packages/db/src/schema/activity.ts; the migrations `activity` and `post_options` with their meta
snapshots. Changes packages/contracts/src/index.ts; packages/db/src/schema/content.ts (`hide_counts`), identity.ts
(`share_previews`), index.ts; apps/api/test/integration/standing-grants.test.ts (`share_previews` among the profile
columns the API may update) and moderation-schema.test.ts (`hide_counts` among the posts' column grants), which pin
the grants this task changes. Tests: packages/contracts/test/mentions.test.ts, activity.test.ts;
packages/db/test/schema.test.ts (three tables more), enum-literals.test.ts (the two new enums created whole);
apps/api/test/integration/activity-schema.test.ts (its Activity and mention half). Not a batch end; no stack rebuild.

**Task 2. Mentions and Activity in the API.** Goal: sections 4.2 to 4.4, 5, 9's Activity, hide-counts and link-preview
routes with their contracts (9.3), and the export's and purge's parts of 11.2 and 6.7 for them. Creates
apps/api/src/activity/ (index.ts, repo.ts, flows.ts, retention.ts). Changes packages/contracts/src/social.ts, auth.ts
and account.ts; apps/api/src/social/repo.ts (`createPost` with mentions and entries, `follow`, `deletePost`, `block`,
`purgeProfile`, the hide-counts update, `setSharePreviews`), social/flows/posts.ts, social/views.ts (mentions,
`countsHidden`, null counts in every view and in `EngagementResponse`), social/routes.ts (`PATCH /posts/:id/counts`,
`/me/share-previews`), social/tiers.ts (the actions and buckets of 9.5), social/index.ts;
apps/api/src/auth/flows/account.ts and apps/api/src/profiles/store.ts (`sharePreviews` in `me()`);
apps/api/src/moderation/author.ts (`authorActivity`), moderation/index.ts; apps/api/src/account/flows/export.ts
(`activity` with `shown`, `mentions`, `countsHidden`, `sharePreviews`); apps/api/src/app.ts (the module's routes),
apps/api/src/index.ts (the module and `activity-retention`); apps/api/test/architecture.test.ts (`MODULES` gains
`activity`; the table pins of 5.3); apps/api/test/integration/standing-route-walk.test.ts (`SUSPENDED_WRITES` gains this
task's write routes, 9.4); and, so that the app compiles with the changed shapes, its readers and builders of
`PostView`, `PostCounts` and `MeProfile`: apps/app/src/components/social/PostCard.tsx (a null count drawn as no number),
lib/post-actions.ts (a null kept null), lib/feed-cache.ts, app/post/[id].tsx, apps/app/test/browser/fixture-api.ts and
the app's tests that build a `PostView` or a `MeProfile`. Tests: packages/contracts/test/social.test.ts (null counts);
apps/api/test/social/tiers.test.ts; apps/api/test/integration/http-activity.test.ts, activity-moderation.test.ts,
mentions.test.ts, http-hide-counts.test.ts, activity-retention.test.ts; account-export.test.ts and
account-deletion.test.ts extended; the existing social tests updated for the nullable counts. Batch end (Tasks 1 and 2):
the whole integration suite and the app's typecheck. No stack rebuild.

**Task 3. Avatar images.** Goal: section 6.4, section 7 without the moderation of 7.6 and 7.7, and 9's avatar routes
with their contracts. Creates the migration `avatars` with its meta snapshot;
apps/api/test/integration/http-avatar.test.ts. Changes packages/contracts/src/media.ts (`MEDIA_KINDS`, `AVATAR_CROPS`,
`UploadQuery`, the two error codes), social.ts (`AvatarView`, `Author.avatar`, `ProfileView.avatar`), auth.ts
(`MeResponse.avatar`), account.ts (the export's `avatar`); packages/db/src/schema/content.ts (`kind`, `profile_id`,
`avatar_sha256`, the checks and indexes), identity.ts (`avatar_path` gone); packages/media-protocol/src/layout.ts,
limits.ts, result.ts; apps/worker/src/pipeline.ts and loop.ts; apps/api/src/media/flows/upload.ts, flows/serve.ts,
files.ts (`avatarJob`, `storedUploads`, the avatar's SHA-256), repo.ts (7.2, 7.3, 7.5), sweeper.ts, index.ts;
apps/api/src/social/routes.ts, flows/profile-edit.ts (`PUT` and `DELETE /me/avatar`), social/views.ts (`avatarsOf`'s
callers), social/repo.ts (`setAvatar`, `removeAvatar`, `avatarPath` gone from the purge); apps/api/src/app.ts
(`/api/me`'s `avatar` from `avatarsOf`); apps/api/src/account/flows/export.ts (the avatar's file);
apps/api/test/integration/standing-route-walk.test.ts (the avatar routes), standing-grants.test.ts (`avatar_path` gone),
moderation-schema.test.ts (`profile_id`'s grant on `post_media`), account-deletion.test.ts (no `avatarPath`) and
apps/api/test/lab/standing.lab.ts:129 (its `avatar_path = null`); the app's builders of `Author`, `ProfileView` and
`MeResponse` (fixture-api.ts and the app's tests), so the app compiles; scripts/smoke-auth-stack.mjs (an avatar set
through the real worker). Tests: packages/media-protocol/test, apps/worker/test/pipeline.test.ts and loop.test.ts,
packages/contracts/test/media.test.ts and social.test.ts (`Author.avatar`), packages/db/test (`avatars` creates
`media_kind` whole), apps/api/test/media/files.test.ts, the new integration file, media-sweeper.test.ts,
activity-schema.test.ts's avatar half. Batch end (Task 3 alone): the whole integration suite and the app's typecheck.
Stack rebuild: yes (the worker's protocol and the API change together) and the smoke test.

**Task 4. Moderation of avatars.** Goal: section 6.5, 7.6, 7.7, the seal's and the review's parts of 7.5 and 7.8, and
the measure's contracts; every list of the measures of 6.5. Creates the migrations `avatar_kinds` and
`avatar_moderation` with their meta snapshots; apps/api/test/integration/avatar-moderation.test.ts and
automation-avatar.test.ts; apps/api/test/measure-lists.test.ts. Changes packages/contracts/src/moderation.ts
(`ACTION_KINDS`, `MEASURES` with the target `"avatar"`, `MEASURE_KINDS`, `REVERSAL_KINDS`), media.ts (`avatar_reset`);
packages/db/src/schema/moderation.ts (`actionKind`'s values, `seal_avatars`, `avatar_reviews`, `avatar_resets`,
`releases.avatar_ids`); apps/api/src/media/flows/serve.ts and repo.ts (the review's owner branch, `avatarsOf`'s),
cases.ts (`MediaForCases.hold` gains the avatar), index.ts; apps/api/src/social/repo.ts (`setAvatar`'s reset check);
apps/api/src/moderation/automated.ts (`avatarSet`, the account branch of `automatedStep`, R1's hold for review),
automated-repo.ts, decide.ts (`ROUTE_KINDS` by name), repo.ts (`MEASURE_KINDS_SQL`, `REDACTABLE`), statement-repo.ts,
statement.ts, author-repo.ts (`MEASURES`), the account snapshot's code, index.ts; apps/api/src/cli/custody.ts;
packages/rules (statement.ts's fields, the measure's sentences with the 30 days, 3d's finding words for a profile
picture); apps/app/src/components/moderation/StatusSheet.tsx, lib/terms.ts and lib/moderation-words.ts
(`DECISION_WORDS.avatar`); apps/admin/src/compose.ts and screens/Case.tsx (the composer's measure choice, the case
page's avatar). Tests: packages/contracts/test/moderation.test.ts; packages/db/test (one table more for each new table;
`avatar_kinds` adds two values to `action_kind`), enum-literals.test.ts (a describe block for 2d's migrations from
`avatar_kinds` on); packages/rules/test/statement.test.ts; the three new test files; activity-schema.test.ts's seal arm
of `post_media_keep`; 3c's gate S walk with a sealed avatar for each reader of 7.5; apps/admin's case and composer
tests; apps/app/test/status-sheet.test.tsx and terms.test.tsx. Batch end (Task 4 alone): the whole integration suite
and the app's typecheck. No stack rebuild.

**Task 5. The app.** Goal: section 10, without the cards. Creates apps/app/src/app/activity.tsx,
app/settings/activity.tsx, components/activity/PostEntry.tsx, FollowsEntry.tsx, ModerationEntry.tsx and
GettingStarted.tsx, lib/activity.ts, lib/activity-words.ts; apps/app/test/activity.test.tsx and
avatar-picker.test.tsx. Changes apps/app/src/components/AppShell.tsx, icons.ts, kit/Avatar.tsx,
components/social/RichText.tsx, PostCard.tsx, the composer (components/social/composer/),
components/social/FeedList.tsx, app/settings/index.tsx (the row), settings/profile.tsx (the picker and its confirm
dialog), settings/privacy.tsx (the switch and the sentences), lib/social.ts, lib/ui-words.ts (with `profile.settings`),
lib/settings-words.ts, apps/app/test/browser/fixture-api.ts, app.browser.ts (steps 52 to 57, and lines 622-623 if
decision 27 raises the cap); post-card.test.tsx, shell.test.tsx, kit.test.tsx, a11y.test.tsx. Checks: the export's size
against decision 27's 20,480 bytes and the cap in force, recorded in the task's summary. Not a batch end; no stack
rebuild.

**Task 6. Share cards, indexing and the terms.** Goal: sections 8 and 11.3. Creates apps/api/src/cards/ (index.ts,
build.ts, words.ts), apps/api/test/cards.test.ts, apps/api/test/integration/http-cards.test.ts, infra/caddy/robots.txt,
infra/caddy/lab/ (card-lab.mjs, crawlers.json, README.md). Changes apps/api/src/app.ts (the card routes beside the
status route), apps/api/src/middleware/security-headers.ts (`X-Robots-Tag`), infra/caddy/Caddyfile (`/post/*`, `/u/*`
with `respond @push 403` and `request_header -Range`, `handle_errors`, the `@named` line of `X-Robots-Tag`),
infra/caddy/Dockerfile (`card.html` and its check, `robots.txt`), apps/api/test/architecture.test.ts (`MODULES` gains
`cards`), apps/app/test/browser/caddyfile.ts (the `/u/*` page route and the `X-Robots-Tag` line, with the Caddyfile they
model), apps/admin/test/console-site.test.ts (the 403 on `/post/x` and `/u/x`), packages/rules (the terms' drafts of
11.3), apps/app/test/terms.test.tsx, scripts/smoke-auth-stack.mjs (the cards, previews off and on). Checks: the card
lab at the task's start (the module and the placeholder on caddy:2.11.4) and at its end. Batch end (Tasks 5 and 6): the
whole integration suite and the app's browser check. Stack rebuild: yes, and the smoke test.

**Task 7. The record.** Goal: the documentation. Changes README.md: a section Activity (what is written, the settings
with the age choice, the seen marker, what is never shown, 90 days), avatars under The interface (the picker, the
sizes, the checks, R1's hold for review, a reset picture refused for 30 days), Share cards and search engines (the
cards, the switch off by default, `robots.txt` with its named agents and why, `X-Robots-Tag`, what other platforms
keep), the budgets' paragraph with 2d's measured size and the cap in force, the upgrade notes (the five migrations),
Before going public (counsel's review of 11.3 and its six questions, word for word); the main design's section 9 gains
a dated amendment for 2d (delivered, what changes in its lines 97, 103, 113 and 225 and in the 2026-09-30 amendment,
the owner's decisions of section 2, left for later, status and order: next 4 hardening, 5 native builds); the UI
design's section 14 marks its 2d line done; this design's section 15 receives the dry run's amendments. Tests: none
new; the whole gates once. Batch end (Task 7 alone): the whole integration suite and the browser check. No stack
rebuild.

## 14. What is left for later

- **Sub-project 4, hardening.** Owner-scoped row-level security for `activity_items`, `activity_state` and
  `post_mentions`, as for every table; counsel's review of the terms' drafts of 11.3 and its six questions (decisions
  11, 20, 21 and 28, the hashes of avatars and `reset_avatar` under Art. 17 DSA), before korbat opens to the public;
  the per-address limits of the card routes if the global limit proves too tight for crawlers (decision 30); a check
  with Meta's Sharing Debugger and LinkedIn whether WebP cards unfurl (decision 22).
- **Sub-project 5, native builds.** The Activity screen, the avatar picker with the platform's own photo picker, and
  native push, whose design must keep decision 4 (nothing outside the screen) or reverse it explicitly with the owner;
  the app icon never carries a count unless that decision is reversed.
- **Possible later changes, each the owner's.** Reposts as Activity entries (decision 3); an opt-in word on the nav item
  (decision 4); an age choice for follows, beside On and Off (decision 7); an exact-handle check in the composer
  (decision 13); a free crop of the avatar (decision 14); a JPEG card variant (decision 22); a per-post switch for
  previews; mentions in bios and in quoted embeds; named suggestions of accounts by a published rule (decision 25); a
  header image on profiles, which 2d does not build; the avatar's own description, which korbat does not ask for
  because the avatar is decorative beside the name it stands for.
- **Expo SDK 58.** Server output of expo-router stays out; the card route of section 8 does not depend on it.

## 15. Amendments from the dry run

The dry run of 2026-10-28 to 2026-10-29 built the seven tasks in a scratch clone, one commit each, through the gated runner. Where the code differs from the text above, the code is right and the point is recorded here, in the order of the tasks that settled it (Tasks 1 to 7).

- **The CHECKs of post_mentions are named (6.3).** Section 6.3 names none. The code names them post_mentions_handle (the handle as written, `^[a-z0-9_]{3,20}$`) and post_mentions_position_range (`position between 0 and 19`, MENTION_STORE_MAX - 1), apart from the unique index post_mentions_position, whose name a CHECK may not reuse; the primary key keeps drizzle's name post_mentions_post_id_account_id_pk. activity-schema.test.ts holds the range equal to MENTION_STORE_MAX.
- **The seen marker is held to the clock only when it is written anew (6.2).** activity_state_guard refuses a seen_at later than now() on an insert and on an update that changes the marker, and refuses a marker set back to null or earlier than the stored one, each as activity_seen under 42501. An update that leaves the marker as it is, such as a change of the rules, is not compared with the clock, so a server clock set back never refuses a settings change. A changed account_id is refused by the guard as activity_seen and, before the guard is reached, by the API role's grants, which name only the five columns.
- **Activity's times keep the database's microseconds (5.7, 9.3).** ActivityEntry.at, ActivityPage.seenAt, ActivityNewerQuery.since and SeenRequest.at share one schema, ActivityTime (`z.iso.datetime({ precision: 6 })`: UTC with exactly six fractional digits), the form to_char's `US` writes, because activity_items.created_at is the database's now() with its microseconds: a millisecond `at` sent back as the seen marker would fall short of an entry written later in the same millisecond, which would then stay new for ever.
- **The cursor of Activity is in the contracts (9.3).** Section 9.3 names no function for the cursor on (at, key). packages/contracts/src/activity.ts exports encodeActivityCursor({ at, key }) and decodeActivityCursor(word), written without Buffer since the contracts load in the web app too: the word is the time's twenty digits (YYYYMMDDHHMMSS and the six of the microseconds), `_`, the key's prefix letter, `_` and the rest of the key, every character within the moderation lists' cursor word `^[A-Za-z0-9_-]{1,400}$`. The encoder throws on anything that is not a place of the list; the decoder answers null for every word the encoder would not write (another form, a day or an hour that does not exist, another spelling of the same place), which the API answers invalid_request.
- **An entry's key is held to its source (9.3).** ActivityEntry checks each key: a post entry's is `e:` and an id; a follows group's is `f:` and a real UTC day, the day of its `at`, with 1 to 3 actors and no more than its count; a moderation entry's is its kind's prefix (`d:` decision, `r:` release, `u:` upload, `l:` lost) over its own `id`. A moderation entry's `postId` and `postCreatedAt` are always present: the post's id and time when the target is a post, and null otherwise, rather than present only then.
- **The newer count may be asked with no time, and the contracts name what the screens share (5.8, 9.3).** ActivityNewerQuery's `since` is optional: while the screen shows no entry there is no newest time, and every entry counts. packages/contracts/src/activity.ts also exports ActivityNewerResponse (`{ count }`, 0 to ACTIVITY_NEWER_CAP), ACTIVITY_TABS (`all` and `conversations`, All by default in both queries) and ACTIVITY_DEFAULTS (Everyone for the three reaches, On for follows), which an account without an activity_state row reads and which are the table's column defaults.
- **lost_told_for's columns and order (6.5).** It returns TABLE(media_id uuid, post_id uuid, post_created_at timestamptz, lost_at timestamptz). A row's lost_at is the earliest loss among the image's files whose notice is neither pending nor none, so a file still pending neither makes nor dates a row; p_before is strict; rows come newest first and, among equal times, by image id descending, since the files lost in one transaction share its now(); a p_limit below 1 answers no row, and one above 100 answers at most 100.
- **A block hides an entry as a post the person may not see (11.2).** The export's `shown` names no reason of its own for a block: an entry about a post hidden by a block between the two accounts, which only a mention can leave behind in 5.6's race, says `post_not_visible` and carries `postId` null, since postAccess hides the post from the person while the block stands, and a follow hidden by a block says `unfollowed`, since the block removed the follow. When several rules hide an entry, the first of `actor_deleted`, `post_not_visible`, `unfollowed` and `muted` wins (the actor's state, then the post's, then the relation's, then the person's own choice), and a post the person may not see is named by no id whichever reason wins. ACTIVITY_NOT_SHOWN in packages/contracts/src/account.ts lists the four; apps/api/src/activity/flows.ts's receivedEntry decides.
- **The mention read is the social repository's (4.3, 5.3).** loadPostViews reads the page's linking mentions through `repo.mentionsFor`, one statement in apps/api/src/social/repo.ts over the posts the reader is shown, so post_mentions is named in that file alone; 5.3's allowance for apps/api/src/social/views.ts is not used, and the architecture test pins the table to social/repo.ts.
- **Where a moderation entry points (5.5.2, 9.3).** A decision about a post names the post and its time. A decision about an account names `account` when it holds one of 3e's measures of the account's standing or their reversals (the kinds MEASURES gives the targets account, handle and reporting: a strike, a suspension, a termination, a retired handle, the reporting measures, and what lifts each), and `profile` otherwise (a reset of the display name or the bio, and their reversals). A release and a refused upload name `account`: a seal's release may span several posts and opens by its own id, and a refused upload was on no post. A lost image names its post, which the entry opens.
- **Activity's times in the export (11.2).** `activity.seenAt` and each entry's `at` in `activity.received` are written to the microsecond, as the Activity screen's times are, while the export's other times stay to the millisecond, so the person can match an entry of the export to the one the screen showed; ExportFormat takes any precision for them.
- **The two switches end with the closing judgment (9.2).** Turning link previews on and showing a post's counts again take the acting row through lockActing (FOR NO KEY UPDATE for the profile's switch, FOR KEY SHARE when only the post changes) and end with judgeActing, as every write of the social repository that takes 3e's predicate does, so a suspension that starts while either waits refuses it; turning previews off and hiding counts take neither. STANDING_PREDICATE's counts are unchanged.
- **The hidden-counts route's answer has a contract (9.3).** PATCH /api/posts/:id/counts answers CountsResponse (`{ countsHidden }`) beside CountsRequest, both in packages/contracts/src/social.ts; 9.3 named only the request.
- **AvatarView lives in media.ts (9.3).** packages/contracts/src/media.ts defines `AvatarView` (`{ small, large }`, the two paths `mediaPath` makes) beside `MediaView`, not social.ts: auth.ts's `MeResponse` carries it too, and social.ts already reads auth.ts, so a definition in social.ts would make the two modules read each other while they load. social.ts and auth.ts both import it from media.ts. The request and answer of the avatar's routes are social.ts's `AvatarRequest` (`{ mediaId }`) and `AvatarResponse` (`{ avatar: AvatarView | null }`), the answer of both PUT and DELETE.
- **An avatar's upload needs its crop (7.2, 9.4).** `UploadQuery` refuses `kind=avatar` without `crop` as it refuses `crop` without `kind=avatar`, both invalid_request before the body is read: the picker always sends one, so an avatar never waits on a default. A repeated parameter arrives as a list and is refused; any other parameter is dropped, as the route read no query before. `kind=post` is accepted and means what no kind means.
- **The freeze's account arm is a function of its own (6.4).** 0051_avatars adds `account_frozen(account)`, a plain STABLE SQL function with frozen_for's second arm (an open case about the account with an unanswered suspect item), EXECUTE for the API role alone, as `post_frozen` has. `post_media_keep`'s new arm reads it in a statement of its own, and the media repository's disposal (`DISPOSABLE`) reads it for an avatar on no post, so that it does not take again, round after round, a row the trigger keeps: the API names `frozen_for` nowhere (apps/api/test/architecture.test.ts).
- **The purge detaches an avatar it cannot delete (7.8, decision 29).** `purgeOwner` deletes the account's image rows as before and then sets `profile_id` null on the account's avatar if `post_media_keep` kept its row (a frozen account case, a hold): from the purge on it is nobody's picture, and its detach writes the edge's outbox row (`state`) that its delete would have written (`deleted`). The disposal takes the row once nothing keeps it.
- **An avatar is exported only while it is the live account's picture (7.8, 11.2).** `EXPORTABLE` lists an avatar's row only while its `profile_id` names a profile that is not deleted, so the archive's files are the current picture's; a former avatar that a hold or a freeze keeps is in no export, as a deleted post's kept image is in none, and an avatar's upload never set (on no post for at most the sweeper's day) is not the account's picture either. The profile member's `avatar` comes from the media module's `exportAvatar` through `MediaForAccount`, and its file is one of `exportImages`, listed in `missingMedia` when it cannot be read.
- **A ready result whose mark does not match the row fails the upload (7.4).** Both writers of a verdict (`repo.finalize` and match.ts's `storeVerdict`) store a ready result only on a row of the kind its mark says (`resultKind`: `avatar: true` on a version-3 ready result is an avatar's, everything else a post's); on a row of the other kind the upload becomes failed with `processing_failed` (`failMismatch`), and nothing of the check of known material is written, rather than storing an image as an avatar's squares or the squares as a post's image.
- **attachAvatar does steps 2 to 4, and step 6 is dropFormerAvatar (7.3).** The media module's `attachAvatar(tx, accountId, mediaId)` locks and checks the upload, detaches the current avatar and sets the new one, and answers `{ avatar, former }`; setting the current avatar again changes nothing and detaches nothing. `detachAvatar(tx, accountId)` is removeAvatar's write. `MediaForPosts` also gains `dropFormerAvatar(id)`, the deletion after the commit, which asks for the files only when the row went (`deleteFormerAvatar` answers whether it did), and `avatarsOf`; `mediaForPosts(deps)` in apps/api/src/media/index.ts builds the interface for createMedia and the tests. The social repository's `setAvatar(accountId, write)` and `removeAvatar(accountId, write)` take the account's row and run the media module's write inside, as createPost's `within` attaches images.
- **avatar_not_ready covers every row that cannot be set (7.3 step 2, 9.4).** An upload of kind avatar that is not ready, not visible or erased answers avatar_not_ready, as one that is processing, failed or refused does; the guard's own refusal is never reached through the route. Its words, and not_an_avatar's, are in apps/api/src/media/context.ts's MESSAGES: the picture is not ready yet, wait or choose another; the image was uploaded for a post, choose the picture again as the profile picture.
- **The job file and the worker's strict read (7.2, 7.4).** The job file is one line of JSON with its newline, written as tmp/<id>.avatar and renamed into incoming/<id>.avatar before the upload's rename. A post's upload has no job file, so a missing one cannot be told from a post's; the worker fails an upload as processing_failed when an entry of that name is not a plain file, is over `MAX_JOB_BYTES` (256), or is not exactly `AvatarJob` (`{ v: 1, crop }`), before any decoder runs. The reconcile pass counts an upload and its job file as one id.
- **The worker's squares come from one decode (7.4).** The oriented square is rendered once to raw sRGB pixels of at most 400 px, never enlarged; large.webp is encoded from those pixels and the scorer is handed them, and the 128 px square is resized from them (not from the source), its pixels making small.webp and the blurhash. sharp orients the input before it extracts, so the crop is taken from the image as it is shown. Every file is a fresh encode, so nothing of the source's metadata survives and no WebP decoder is needed.
- **A page with reposts asks avatarsOf twice (7.5).** loadPostViews asks the media module once per page for every author it shows, quoted authors included; timelineItems asks once more, for the reposters, only when the page holds a repost. The profile lists ask once beside their other reads, the profile view once, and Activity's `authors` once with no viewer: an actor of a follow group is always another account.
- **The two migrations' numbers (6.8).** avatar_kinds is 0052_avatar_kinds.sql and avatar_moderation is 0053_avatar_moderation.sql, the next free numbers after Task 3's 0051_avatars. 0052 holds the two ALTER TYPE ... ADD VALUE statements and nothing else; enum-literals.test.ts reads every file from it on and refuses the two values as literals outside a PL/pgSQL body, and the runner's upgrade from 0048, which applies 0049 to 0053 in one transaction, passes.
- **The deciding transaction that answers an item is decisions_apply (6.5).** The items of a final decision are answered by the trigger decisions_apply (newest in 0030_authority_records), not by decisions_record, which only reads them. 0053 replaces decisions_apply from that text: after it answers the items it calls avatar_apply for every avatar avatar_reviews names under one of them, and where it derives again the posts of the interim seals that ended with the answer it derives their avatars too. Without the second change an avatar of an account seal taken while deciding would stay sealed after the admin's answer.
- **The keep trigger's seal arm is a function of its own (6.5).** 0053 adds avatar_sealed(media), a plain STABLE SQL function with frozen_for's seal arm for an avatar (a seal in force lists it in seal_avatars, and no release that lists it in avatar_ids has a notice other than held), EXECUTE for the API role alone, as account_frozen. post_media_keep reads it beside account_frozen, and the media repository's disposal (DISPOSABLE) reads it for an avatar, so that it does not take again, round after round, a row the trigger keeps.
- **What an account seal lists (6.5).** A seal_media on an account case lists every ready and unerased row of kind avatar the account owns, locked after the posts' images in id order: the current picture, a former one a hold keeps, and an avatar upload not set yet that the sweeper has not taken. A processing or failed upload is not listed: it has no files to move into the quarantine. invalid_decision is raised only when neither list holds anything.
- **The release and the quarantine take a seal's avatars (6.5, 7.7).** release_facts also asks every avatar the seal lists that no release lists yet, while its row is unerased, to have both its files in the quarantine. seal_release takes all such avatars with the release's first part (a seal lists an account's few), writes them to avatar_ids and erases them with the posts' images in one id order, and answers release_not_open only when both lists are empty. The confirmed params and releases_confirmed are unchanged: the avatars are the seal's own list, which no caller chooses. release_replay reads the avatars from the restored database's seal_avatars under the gap's seal (its target), since a replay's params name posts alone. quarantine_plan moves in an avatar a seal for good lists, returns one that no seal for good lists any more (not erased, not released, not a held upload) and destroys a released one; quarantine_counts dates them as a post's images; quarantine-list then names a sealed avatar's two files with no change to cli/custody.ts. seal_custody still counts a seal's posts' images only, and the console offers a release only for a seal that lists posts: a seal that lists avatars alone is released by no screen yet.
- **A case's evidence erases the avatar rows of 6.7.** erase_case_evidence (0018_retention) is replaced in 0053: before it releases the case's holds it deletes the avatar_resets rows of the case's resets and the avatar_reviews rows of the case's items, and counts them among the rows it changed. case_evidence_due_at keeps a reset picture's case at least 30 days after the reset stopped being in force, so the reset's own 30 days are over by then.
- **An account's report holds its picture on every ground (7.7).** MediaForCases.hold takes a pair { caseId, accountId } that locks the account's current avatar in the intake's one statement and id order, places the case's hold on it and answers it under the account's id; the snapshot's media is [{ id, alt: null, width, height }], and stays null for an account without a picture, as before 2d. latestSnapshot also answers its media's ids, so a picture set, changed or removed is a new snapshot. The staff snapshot route (snapshotIn) holds and copies the picture the same way, and an owner pair of a suspect report also locks the owner's avatars.
- **The staff reader opens an account's picture (7.7).** staffAccess reads an avatar (its owner, no post) and calls it frozen while account_frozen holds for its owner; caseImage opens, on an account case, the picture of that case's own account that a snapshot of the case lists. The case answer's imagesAllowed of an account case is no longer always false: it is not account_frozen(account). The console draws the newest snapshot's picture through the staff reader beside the display name and the bio, and in its place, while the case is frozen, the sentence PICTURE_NOT_SHOWN (only when the snapshot lists a picture).
- **The author's decision screen names the reset picture without drawing it (7.7).** The design has the screen show the snapshot's picture under DECISION_WORDS.avatar, while 7.5 serves a reset picture to nobody, its owner included. No new reader of post_media is added: the screen shows the label 'Profile picture' with DECISION_WORDS.avatarNotShown ('Removed by this decision. korbat keeps it with the case and shows it to nobody, you included.') when the decision holds reset_avatar, and no image. So a reset picture's statement never says that the decision's screen shows the old value: its oldValueKept is always false, in the API's statement and in the console's preview.
- **The statement's words for the picture (7.6, 7.7).** A reset that removed the picture reads 7.7's sentence word for word, while deciding and for good alike; one of an account without a picture reads 'korbat reset your profile picture. Your account had no profile picture, so this changes nothing now.', and one of a deleted account the field's deleted sentence. restore_avatar and an ended reset read restore_display_name's sentences with 'profile picture'. A person's decision after a program's finding on an account's case says 'this profile picture' for the image (STATEMENT_WORDS.automated.found.avatar and the comparison's subject). An account seal that listed avatars says so (StatementMeasure.sealed gains an optional avatars count and STATEMENT_WORDS.sealAvatars); the console's preview of an account seal omits that sentence, since the case answer counts no avatar.
- **The reset's 30 days are a constant (7.7).** packages/contracts/src/media.ts gains AVATAR_RESET_DAYS (30), which the statement prints and the console names; 0053 writes a reset's until as now() + make_interval(days => 30), and avatar-moderation.test.ts holds the two equal.
- **Where the reset check runs (7.3 step 2, 9.4).** The refusal avatar_reset is the media module's attachAvatar, inside setAvatar's transaction after the upload row's lock: it reads the row's avatar_sha256 and avatar_resets (this account, the same hash, until ahead). Its API message is AVATAR_WORDS.resetRecently's sentence; the app's words module is Task 5's.
- **The program's account branch (7.6).** avatarSet reads the picture through MediaForCases.signals' avatar form { avatarId, ownerId }, which answers it only while it is that owner's live profile's ready and unerased picture; automatedStep takes the account branch for a signal on an avatar (its owner read before the transaction through the media module's avatarOwner) and handles it gone when the picture is no longer set. A flagging match's finding cites no rule and a listed match's R2, as for a post's image. avatar_review refuses (invalid_review) anything but an unanswered item of a program's finding under R1 about the avatar's owner, and keeps one row an avatar.
- **The console's measure lists (6.5).** The composer offers 'Reset profile picture' on an account case while deciding and for good, after the field resets and, in a final decision, after 'Retire the handle' (the ledger's order). Its no_effect prediction reads the newest shown snapshot's media, since the case answer names the account's fields and not its picture; the database decides already from the account's own rows. cli/records.ts hands a seal's avatars over in handover-list after its posts' files; notification-facts lists posts only, since no produced kind of 3f's list names an image.
- **The static card is PostCard's quiet variant (5.5.3, 10.2).** 3b's StaticCard takes no PostView, so PostCard gains `quiet`: the post as every card draws it (the actor's 40 px avatar, the author line with the time as the one link to the post, the body with its stored mentions and its links, the images, the body as the open target for pointers), with Reply its only action and no Repost, Like, Save or More, and no article or divider of its own, since the entry's article names it. Reply opens the thread with its reply card open (`/post/<id>?reply=1`), as the feed's Reply does, rather than a composer in place. The entry's line ('Ada replied to your post, 3h ago', activity.entry.name's words) stands above the card in meta, hidden from assistive technology because the article's name says it; the actor's avatar is the card's own, not a second one in the line.
- **A follow group's links are its avatars (10.2).** activity.follow.many names one account and follow.two two, so the line cannot hold three name links: each of the up to three accounts is a 44 px link on its 32 px avatar, named by its display name, to its profile, and the line is text, hidden from assistive technology as the article's name says it. A group of more than three ends with 'See your followers' (/u/<own handle>/followers). The row itself is not pressable.
- **A lost image's entry says nothing of Cases (5.5.3, 10.2).** ModerationEntry is a link row with the scales, the line and the time the person was told, and activity.moderation.open ('Open in Cases') as its trailing words for a decision, a release and a refused upload, which open their screens under Settings, Cases; a lost image's row opens its post and shows no such words.
- **Every Activity row is a focusable article (10.2).** Each entry's article carries tabIndex -1 and the inset focus ring, so the focus can move to it by script: after the pill or a refresh to the list's first entry (the list is brought to its top first), after Load more to the first entry the page brought. The headings 'New since you last looked' and 'Earlier' are h2s in body-strong, ink-medium, beside a 1 px line in line-high, and are drawn only when the visit has something new.
- **Activity's pill is the feed's (10.2).** NewPostsPill takes its words (`wordsFor`, activityPill's '1 new', '{n} new', '20+ new' from the count's cap of 21) and its name's template (`label`, activity.pill.label); its one polite announcement reuses the feed's feed.pill.announce ('{visible} above'), and once the reload brings the count to zero it says 'You're all caught up' for two seconds, as on Home. The poll is lib/new-posts.ts's clock (30 s, then 60 s after each answer), active only while the screen is focused, the page visible and the first page in.
- **The seen marker after a reload (5.7, 5.8).** The pill and a refresh read the first page again and keep its seenAt as the visit's marker, so entries new since the marker the screen sent show under 'New since you last looked'; the screen sends the marker again with that page's newest time when something on it is new. Later pages are marked new against the visit's marker, compared as six-digit strings.
- **The confirm dialog is AskSheet with a sentence (10.5).** The kit has no confirm dialog: 'Remove picture' opens 3b's AskSheet (components/import/ImportProgress.tsx), which gains an optional `description` passed to Sheet, so the question (AVATAR_WORDS.confirmTitle), its sentence (confirmBody), Remove (confirm, in danger) and Cancel stand together; the focus goes to 'Choose a picture' only after a removal, and a sheet closed without one gives it back as Sheet does.
- **The picker's logic is lib/avatar.ts (10.5).** The crop choices by shape (cropChoices, with expo-image's contentPosition top, center, bottom, left or right over the local file and object-fit cover), the preview's name (previewName), the upload, its poll every second for at most six minutes and the PUT (sendAvatar, with avatar_reset read as the reset line), and the focus after each (pickerFocus) are pure functions in a new file; Settings, Profile draws the card (AvatarCardView, the state in AvatarCard). The chosen file is checked by 2b's refusal() before anything is sent, its size read by the browser to name the choices, and Middle is chosen first. A refused upload is shown to nobody, its uploader included, so its preview goes with the refusal and the card shows the error line, the 'Why' link and the chooser again.
- **The composer's option is one switch row (10.6).** The composer had no options area: above the send bar, under a line-low rule, one of the kit's switch rows (ListRow), 'Hide like and repost counts', whose row is the 44 px pointer target and whose named Switch is the one control, off for every new post, reply and quote, sent as hideCounts and set back to off once sent; it is not drawn while the discard question asks. The mentions line (activity.composer.mentions) sits under the field, in meta, ink-medium, while the text holds a handle by a fresh copy of MENTION_TOKEN (lib/activity.ts's hasMention).
- **pickImages takes `{ multiple }` (10.5).** lib/pick-images.ts always allowed several files; it now takes `{ multiple = true }`, and the avatar picker asks for one.
- **On a phone a settings page marks no nav item (10.1).** With Settings off the phone's tab bar, its settings pages mark no item current: aria-current='page' on Profile would call the settings page the profile, and the settings row under each page's title already says where the reader is. The shell test and the browser check's layout steps hold it (360 px: none on Cases, a decision, the Settings index, Appearance and Security).
- **The More menu's counts item (10.6).** For the author, Hide like and repost counts (EyeOff) or Show like and repost counts (Eye) stands after Copy link and before Delete; lib/post-actions.ts's toggleCountsHidden flips countsHidden at once in the post's own 'counts' lane, takes the server's answer, and puts it back on a refusal (a suspended author showing counts gets the standing's sentence under the card, any other refusal a rollback toast with the API's words). Who sees this adds reach.countsHidden before its last line for the author alone.
- **Link previews' card (10.8).** Privacy's new card holds the switch row (PRIVACY_WORDS.previewsSwitch as its label and name, previewsExplain under it), saved as Explore's switch is (POST on, DELETE off, the session read again, the old state back with the error on failure), and the note on search engines (PRIVACY_WORDS.search) as a line under the row in the same card.
- **Getting started below 1024 px (10.7).** The panel ends with AboutCard whole (its heading, its three lines and its three links) rather than the three lines alone; Latest is a button (it switches Home's tab, no address), the other rows are links, and feed.start.settings shows under the profile's row on phones only. feed.empty.following.* go, since an account's empty Following always shows the panel and Following has no signed-out form.
- **Avatar keeps the monogram per picture (10.4).** Avatar takes `src: AvatarView | null`; avatarFile picks small.webp at 32 and 40 px and large.webp at 64 and 96, with API_BASE before it, transition 0 and contentFit cover; a file that fails to load gives way to the monogram until the view carries another picture. The import's StaticCard and Appearance's sample keep the monogram.
- **The browser check's fixtures (10.9, 12.5).** The avatars' files are lossless WebPs of one colour written by fixture-api.ts's solidWebp (a VP8L header and five one-symbol prefix codes, 32 bytes whatever the size, a portrait 300 by 600 for the picker). Grace's and Linus's pictures are on Activity's entries only, so the steps before 52 keep their monograms; Ada's picture, once step 54 sets it, and a post's hidden counts are applied to every answer by a walker over the JSON. Activity's times are minutes before the walk started, so step 52 pins each entry's words and the form of its time ('5m ago') rather than the minute. Step 52 also leaves Home, Bookmarks, a profile, Settings and a post open past a poll's wait and finds no request to /api/activity; ROUTES gains /activity, /activity?tab=conversations and /settings/activity.
- **Pins that moved (12.5).** shell.test.tsx (the nav's items by layout, five wide and four on a phone), composer.test.tsx (the rail's links), rich-text.test.tsx (mentions as a list; the native card links the stored @ada), post-card.test.tsx (the author's More menu), kit.test.tsx (expo-image mocked for Avatar), explore.test.tsx (Following's empty text is the panel's Latest and Explore rows), theme.test.ts (the forty-first icon, activity: Bell), lifecycle.test.tsx, cases.test.tsx and appearance-page.test.tsx (Activity after Appearance in the settings row and the index, with its hint), appearance-page.test.tsx and standing.test.tsx (expo-image mocked, since Avatar draws through it), and the browser check's steps 7 (the nav's tab stops), 21 (the author's menu), 35 (eight index rows) and the layout steps (no current item on a phone's settings pages). Step 32 now waits for the removed post's chip before reading it: the profile asks for its posts only once the profile has answered, which a loaded machine left after the network's idle moment, with the export from before this task as well. Step 15 now waits, before the connection goes, until the number of Home's drawn rows has held for a second and the images those rows asked for (not one left to load lazily) and the fonts they use are in: on this machine the rows were drawn after the network's idle moment and their images and the mono face were then asked for offline, which the export from before this task met too after step 14. The README's line on the app's browser check says 57 steps (about fourteen minutes), since apps/admin/test/readme.test.ts holds it to the check's last numbered step; the rest of 2d's README record is Task 7's.
- **The focus after the pill and Load more waits for its row (10.2).** The gated runner's browser check failed step 52 at the focus Load more should move to the first entry it brought. The screen tried the focus once, in a timeout of 0 after the new page landed, but the list draws only a window of rows, in batches: with the CPU slowed four times the window was still around the 10th to 20th entries when the page landed (the Load more row, removed with the focus in it, took the scroll and the focus with it, and the list's keeper gave the focus to the screen's title), so the 31st row was not drawn, the query found no article and nothing tried again; a keyboard user on a slow phone would lose their place the same way. lib/activity.ts's retryFocus now tries at once and every 50 ms until the attempt says the focus landed, for at most 5 s, and answers a cancel. The screen's attempt focuses the row's article when it is drawn, and otherwise asks the list to draw the rows around it (ListHandle.jumpTo, which scrolls to the row's index), so the next try finds it; a waiting try is cancelled when a newer request (the pill, a refresh, another Load more) starts and when the list unmounts. The pill's and a refresh's focus on the first entry take the same path. activity.test.tsx holds the tries, the limit and the cancel with fake timers; step 52 passed with Chromium's CPU throttled four and five times, where the single try and the retry without the jump both failed.
- **The terms' drafts live in the app (11.3, 13 Task 6).** The terms' source is apps/app/src/lib/terms.ts, not packages/rules, which holds the rulebook only: the four drafts are the last four paragraphs of its 'Your data' (ENGAGEMENT_DATA), after 3b's import record, with ACTIVITY_KEEP_DAYS read from the contracts and printed as '90 days', TERMS_VERSION unchanged. apps/app/test/terms.test.tsx holds them, and its table of numbers, both number collections and the changed-constants mock gain ACTIVITY_KEEP_DAYS, so no number of the drafts is typed.
- **A read and an interface for the cards (8.1, 9.1, 13 Task 6).** No read gave the link-preview switch with a post or a handle (only the export's head read it, by id), so the social repository gains sharePreviewsOf(ids), the switch of live profiles only, and social/index.ts gains SocialForCards (post and profile) built as forActivity is: post goes through postView with no viewer, so postAccess decides it as for anyone signed out, and answers null when the author's profile is deleted; profile is findProfileByHandle and profileViewOf with no viewer. The cards module's deps are this interface and APP_ORIGIN.
- **An avatar on a card has no size (8.3 item 7).** AvatarView carries the two paths only and an avatar's large square is 400 px or less (never enlarged), so a card whose image is the author's or the profile's picture leaves out og:image:width and og:image:height; a post's image keeps its own MediaView size. Meta then renders the picture after its first fetch rather than at once.
- **The image's description gives way to the 4,096-byte bound (8.1, 8.5).** 8.5's three limits cannot all hold inside 4,096 bytes: with the title (70), the description (200, written twice) and the image's description (420) at their limits in four-byte characters the block is about 4,290 bytes, and in characters escaped to six bytes (an opening brace) about 6,020. cardBlock therefore cuts the image's description to 420 code points and then, with '...', to the room the rest of the block leaves (367 four-byte characters, or 97 braces, in those worst cases, 4,093 and 4,095 bytes); the title and the description are never cut for the bound. A block that cannot fit even so (an absurd APP_ORIGIN) throws rather than being sent cut, and Caddy then serves the plain shell with 200.
- **An imported post's description (8.4, 8.5).** The label and its full stop come first and the post's text is cut by 8.5's rule in the room the label leaves, so the cut never falls on a space of the label itself; an imported post without text says the label and a full stop. Each run of line breaks (CR, LF and the line and paragraph separators) becomes one space.
- **What a generic card carries (8.3, 8.4).** robots, og:site_name, og:type website, og:url (the address that was shared: the post's id, or the profile's handle as stored) and og:title ('A post on korbat' or 'A profile on korbat') and twitter:card summary only: no description, image, date or profile:username, so it names no one beyond the address itself.
- **The card route reads a handle as the profile's page does (8.1).** GET /api/cards/profile/:handle parses the handle with the contracts' HandleParam, so a leading @ and any case are read as GET /api/profiles/:handle reads them, and og:url names the handle as stored; anything else is 404 with no body before the social module is asked.
- **Caddy's form of 8.2.** templates sits in one snippet, card_page (root, rewrite to /card.html, templates, file_server), imported by the 204 handle_response of /post/* and of /u/*, the only two places it runs; @named is written as a block (`@named {` / `not path / /rules /transparency /explore/about /terms` / `}`) because the Caddyfile's readers take `not path` only so, and it applies to every file of the default handle (the bundles, theme-boot.js, robots.txt) as well as its pages; /card.html has a handle of its own, `respond @push 403`, the page headers, X-Robots-Tag and `respond '' 404`, the form both readers read as status 404 with no body; handle_errors' matcher is @pages, `path /post/* /u/*`, with X-Robots-Tag.
- **The card.html step (8.2).** The Dockerfile's web stage inserts the action line, indented as the head's other lines, after the line holding `<meta charset='utf-8' />` with awk (marker and action passed as variables, no shell escapes), and fails the build unless exactly one line holds `{{` and that line is the action; the final stage copies infra/caddy/robots.txt to /srv/robots.txt after the export.
- **The X-Robots-Tag of the API (8.2).** securityHeaders wraps hono's secureHeaders and sets X-Robots-Tag: noindex after the handler and the error handler answered, so every answer carries it, an image file's, a card's, a 404's and a 500's included; app.ts's chain is unchanged.
- **The cards are no counted reads (3d's RECIPIENT_READ_ROUTES).** The route table test's NOT_COUNTED gains GET /api/cards/post/:id and GET /api/cards/profile/:handle, which Caddy asks, beside the status route; they stand before the session's resolution, where nothing is counted.
- **The browser check knows the profile's page (10.9, 12.4).** apps/app/test/browser/caddyfile.ts reads a page handle's rewrite (the post's or the profile's card route; any other rewrite is an error) and gives /u/* its own route kind and headers; server.ts serves index.html for both under the status of the fixture API's postStatus or new profileStatus (the profiles GET /api/profiles answers, compared as the card route compares); step 2 gains /u/grace 200 and /u/nobody_here 404 and X-Robots-Tag on /post/ and /u/ and none on /. No step is added: 57 stay.
- **The console's pins of 3f move to the cards (12.4).** console-site.test.ts asserts the push 403 as the first line of /post/x's and /u/x's handles, the card rewrite and the three answers of both page handles, templates in those two blocks alone, handle_errors' @pages with noindex, /card.html's 404, the @named matcher, robots.txt byte for byte with crawlers.json's tokens as its named agents, and the Dockerfile's two steps.
- **The smoke test's step 17 (12.4).** A public post's page is card.html (the generic card while previews are off), so the deleted post's 404 and a missing or malformed id's are compared with /'s bytes, the plain shell, and both answers carry noindex; the status route's check stays. Step 23 is the cards with Twitterbot's request from crawlers.json, run before grant-role while the first account's token works, and it puts the display name and the switch back.
- **The card lab (12.4).** infra/caddy/lab/card-lab.mjs uses the Caddy image itself as the stub API (a Caddyfile copied into a created container with docker cp, no bind mount), whose blocks keep the template delimiters unescaped, to prove that Caddy prints a block as text even when nothing escaped it; its profile block is 4,096 bytes (5,464 in base64). crawlers.json's Slackbot range (bytes=0-32767) and LinkedInBot's User-Agent are not from an official page, and each carries a note saying so. Task 6's first step, before the lab existed, ran on a small image built FROM the pinned caddy:2.11.4-alpine with a Caddyfile of its own.
- **The main design's lines (3.1, 13 Task 7).** The 2026-09-30 amendment stands at lines 328 to 339 of the main design, not 327 to 338 as section 3.1 has it; its lines 97, 103, 113, 223 (row 2d) and 225 (row 5) are as section 13 names them. Row 2d gains its sentence "Delivered by sub-project 2d ...: see section 9, 2026-10-29" in place, as row 3b did, and the 2d entry of section 9 is appended after 3b's, so no line the design cites moves.
- **Lines 2d made false (13 Task 7).** Beyond section 13's list, the record corrects in place what 2d made false in the README: Posting and feed's Mutes (a mute silences Activity too) and its "Counts are public" (unless the author hides a post's like and repost counts, PATCH /api/posts/:id/counts); Moderation's measures ("Reset profile picture" with the display name's and the bio's resets); Profile and account's export (`activity` last, the profile's `avatar` and `sharePreviews`, each post's `mentions` and `countsHidden`, the current picture's file); the smoke test's paragraph (the picture through the real worker and the two cards); and the browser check's list of screens. `### A release` names as open, and fixes none of, the three points of an account's sealed pictures that no task built.
- **Counsel's six questions stand in a paragraph of their own (11.3, 13 Task 7).** The README's Before going public holds counsel's review of the four drafts (`ENGAGEMENT_DATA` in apps/app/src/lib/terms.ts, `TERMS_VERSION` unchanged) and the six questions of 11.3 word for word as a numbered list, in a paragraph after Counsel's list, whose line ends with a pointer to it that names no decision: apps/admin/test/readme.test.ts holds the decisions named on that line after "From importing posts:" to 3b's list.
- **Where the README puts 2d (13 Task 7).** Activity and Share cards and search engines are sections of their own after Explore and before Staff roles; the avatar is a bullet of The interface, Profile pictures, before Budgets; Upgrading's 2d paragraph comes first, above 3b's and 3f's, since 3f's part of Upgrading, from its own paragraph to the section's end, may hold no number but 3f's.
- **Task 7's gates (13).** The record changes no code, test, migration or package, so its batch end runs the whole integration suite once, alone, on a fresh test database, with the README's pins, the typecheck and the unit tests, and neither the app's browser check, which Task 6's tree passed and the final gates run again, nor a stack rebuild. Section 15 is filled by the orchestrator's script from the seven tasks' amendments, after Task 7's work and before its commit, rather than by Task 7's own edit.
````

## Step 2: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 3: verify: test

```bash
pnpm -r --if-present run test --testTimeout=60000
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/db test:       Tests  131 passed (131)
packages/contracts test:       Tests  537 passed (537)
packages/media-protocol test:       Tests  28 passed (28)
packages/rules test:       Tests  138 passed (138)
packages/import-protocol test:       Tests  35 passed | 2 skipped (37)
apps/admin test:       Tests  614 passed (614)
apps/worker test:       Tests  64 passed (64)
apps/app test:       Tests  764 passed (764)
apps/importer test:       Tests  143 passed (143)
apps/api test:       Tests  1019 passed | 1967 skipped (2986)
```

## Step 4: verify: test-database-fresh

```bash
node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `test database ready: korbat_test`

Observed on the dry run:

```text
test database ready: korbat_test
```

## Step 5: verify: integration-fresh

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  1961 passed | 4 skipped (1965)
```

## Step 6: verify: test-database-upgrade

```bash
node scripts/test-db.mjs --upgrade-from 48 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations up to 0048_import_staff_end applied and committed`
- `later migrations applied as one batch`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations up to 0048_import_staff_end applied and committed
later migrations applied as one batch
test database ready: korbat_test
```

## Step 7: verify: integration-upgraded

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  1961 passed | 4 skipped (1965)
```

## Step 8: verify: timing

```bash
cd apps/api && set -a && . ./.env && set +a && ok=0; for i in 1 2 3 4 5 6 7 8 9 10; do node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/integration/http-timing.test.ts test/integration/auth-flows-mfa.test.ts -t '(differ by less than 50 ms|sign-in timing does not reveal)' > ../../.data/timing-gate.log 2>&1 && { ok=1; break; }; sleep 45; done; tail -6 ../../.data/timing-gate.log; echo timing-ok=$ok attempts=$i
```

Expected output contains:

- `timing-ok=1`

Observed on the dry run:

```text
timing-ok=1 attempts=1
```

## Step 9: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `README.md`
- `docs/superpowers/specs/2026-09-03-korbat-design.md`
- `docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`
- `docs/superpowers/specs/2026-10-22-engagement-2d-design.md`

## Step 10: commit

```bash
git add -A
git commit -q -m "docs(readme,design): the record of engagement (2d): README gains Activity (what is written in the act's transaction, Settings, Activity's reach and its defaults, the server's seen marker and the pill, follows by UTC day, mentions stored 20 and told 10, what is never shown, 90 days by activity-retention, the export's activity) and Share cards and search engines (the card routes and Caddy's card.html, what a card shows and never shows, previews off by default, robots.txt's five agents and why, X-Robots-Tag, what other platforms keep, the global limit and the log, the card lab); The interface gains Profile pictures (crop, 400 and 128 px, the checks, R1's hold for review, Reset profile picture and 30 days, 10 an hour and 30 a day) and 2d's 824,905 bytes under the unchanged cap; Upgrading names 0049 to 0053 with 0051_avatars as the slow one; Before going public gains counsel's review and six questions; Mutes, counts, Moderation's measures, the export and the smoke paragraph corrected, A release names three open points; the main design's row 2d and its 2026-10-29 entry; the UI design's 2d line delivered" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `docs(readme,design): the record of engagement (2d): README gains Activity (what is written in the act's transaction, Settings, Activity's reach and its defaults, the server's seen marker and the pill, follows by UTC day, mentions stored 20 and told 10, what is never shown, 90 days by activity-retention, the export's activity) and Share cards and search engines (the card routes and Caddy's card.html, what a card shows and never shows, previews off by default, robots.txt's five agents and why, X-Robots-Tag, what other platforms keep, the global limit and the log, the card lab); The interface gains Profile pictures (crop, 400 and 128 px, the checks, R1's hold for review, Reset profile picture and 30 days, 10 an hour and 30 a day) and 2d's 824,905 bytes under the unchanged cap; Upgrading names 0049 to 0053 with 0051_avatars as the slow one; Before going public gains counsel's review and six questions; Mutes, counts, Moderation's measures, the export and the smoke paragraph corrected, A release names three open points; the main design's row 2d and its 2026-10-29 entry; the UI design's 2d line delivered`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 4>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "test-database-fresh": <paste the expected lines as printed>
Verify "integration-fresh": <paste the expected lines as printed>
Verify "test-database-upgrade": <paste the expected lines as printed>
Verify "integration-upgraded": <paste the expected lines as printed>
Verify "timing": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
