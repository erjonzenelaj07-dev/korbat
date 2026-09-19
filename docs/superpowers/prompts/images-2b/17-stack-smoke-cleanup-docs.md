# korbat 2b — Task 17 of 17: The stack with images: the smoke test proves metadata stripping, the symlink refusal, deletion from disk and the worker's isolation; a worst-case mode at the pixel caps; a script that cleans test leftovers from the development database; README; scans

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The last task proves the whole on the built stack. The smoke test uploads a JPEG carrying a GPS position through Caddy and checks that the served file is a fresh WebP without metadata, that a symlink planted in the store from inside the worker gets a 404 without leaking anything, that deleting the post removes the image from disk, and that the worker is isolated. `--worst-case` sends flat-colour files at the pixel caps and requires the worker to survive them within its memory limit. `scripts/clean-dev-fixtures.mjs` lists what tests left in the development database and deletes it only with `--yes`. The README documents images; semgrep and the audit stay clean.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API, worker or web process started from this repository first; never stop other Node processes on the machine.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): post cards show images in a ratio-kept single frame or a 16:9 grid with blurhash placeholders and an ALT control; quotes show thumbnails; a full-screen viewer with arrow keys, Escape and focus return`.
3. The previous task's last API unit run ended with `Tests  142 passed | 139 skipped (281)`.

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
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/17-stack-smoke-cleanup-docs.md 1
```

Expected: 3 lines starting with `wrote`, one for each file below.

### Create `scripts/clean-dev-fixtures.mjs`

```js
#!/usr/bin/env node
/**
 * Lists, and with --yes deletes, what tests left in the development database:
 *
 * - accounts whose email has the tests' shape, `<word>-<uuid>@korbat.local` (the integration, HTTP and
 *   smoke tests all make them), with their profiles;
 * - profiles without an account behind them, which the integration suites inserted directly while they
 *   still ran against this database.
 *
 * Deleting a profile removes its posts, image rows, follows, likes, reposts, bookmarks, blocks and mutes.
 * Where those rows counted towards a kept profile or post (a follow of a real account, a like of a real
 * post), that counter is recomputed from the rows, the way the app keeps it. The API's sweeper removes
 * the image files within about an hour, as it does for any image without a row.
 *
 * Refuses to run unless API_APP_ORIGIN in infra/.env is a localhost origin, so it never touches a
 * deployed database. Runs psql inside the postgres container as its superuser: no password is read or
 * printed here.
 *
 * Usage, from the repo root:
 *   node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]
 * Without a command it uses `docker compose -f infra/compose.yml -f infra/compose.dev.yml`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? ["docker", "compose", "-f", "infra/compose.yml", "-f", "infra/compose.dev.yml"] : argv.slice(separator + 1);
const unknown = options.filter((option) => option !== "--yes");
if (compose.length === 0 || unknown.length > 0) {
  console.error("usage: node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]");
  process.exit(2);
}
const yes = options.includes("--yes");

/** The only emails tests create: a lowercase word or words, a UUID, and the korbat.local domain. */
const TEST_EMAIL = "^[a-z]+(-[a-z]+)*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@korbat[.]local$";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/** How many of each kind are printed; the counts are always complete. */
const LISTED = 25;
const NL = String.fromCharCode(10);
/** psql meta-commands start with a backslash; spelled this way, the file holds none that could be lost in copying. */
const META = String.fromCharCode(92);

function stop(message) {
  console.error(message);
  process.exit(1);
}

const envFile = resolve(root, "infra/.env");
if (!existsSync(envFile)) stop("infra/.env is missing. Run `node scripts/gen-dev-env.mjs` first.");
const origin = parseEnv(readFileSync(envFile, "utf8")).API_APP_ORIGIN ?? "";
let host = "";
try {
  host = new URL(origin).hostname;
} catch {
  host = "";
}
if (!LOCAL_HOSTS.includes(host)) stop(`API_APP_ORIGIN in infra/.env is "${origin}", not a localhost origin. This script only cleans a development database.`);

// Runs inside the postgres container, where POSTGRES_USER and POSTGRES_DB are set. psql fills in
// :'pattern' itself, so the pattern is never pasted into SQL by hand. Everything happens in one
// transaction, which only commits with --yes.
const script = `set -eu
psql -v ON_ERROR_STOP=1 -q -tA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pattern="$PATTERN" -v delete="$DELETE" <<'SQL'
begin;
create temp table doomed on commit drop as
  select u.id, 'account' as kind, u.email || coalesce(' (@' || p.handle || ')', '') as label
    from auth.users u left join public.profiles p on p.id = u.id
    where u.email ~ :'pattern'
  union all
  select p.id, 'profile', '@' || p.handle
    from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id);
create temp table touched_profiles on commit drop as
  select f.followee_id as id from public.follows f
    where f.follower_id in (select id from doomed) and f.followee_id not in (select id from doomed)
  union
  select f.follower_id from public.follows f
    where f.followee_id in (select id from doomed) and f.follower_id not in (select id from doomed);
create temp table touched_posts on commit drop as
  select distinct x.post_id as id
    from (
      select user_id as by_id, post_id from public.likes
      union all select user_id, post_id from public.reposts
      union all select author_id, reply_to_id from public.posts where reply_to_id is not null
      union all select author_id, quote_of_id from public.posts where quote_of_id is not null
    ) x
    join public.posts p on p.id = x.post_id
    where x.by_id in (select id from doomed) and p.author_id not in (select id from doomed);
select 'database|' || current_database();
select 'accounts|' || count(*) from doomed where kind = 'account';
select 'profiles|' || count(*) from doomed where kind = 'profile';
select 'posts|' || count(*) from public.posts where author_id in (select id from doomed);
select 'images|' || count(*) from public.post_media where owner_id in (select id from doomed);
select 'touched_profiles|' || count(*) from touched_profiles;
select 'touched_posts|' || count(*) from touched_posts;
select kind || '-item|' || label from doomed order by kind, label;
${META}if :delete
delete from public.profiles where id in (select id from doomed);
delete from auth.users where id in (select id from doomed);
update public.profiles p set
    follower_count = (select count(*) from public.follows f where f.followee_id = p.id),
    following_count = (select count(*) from public.follows f where f.follower_id = p.id)
  where p.id in (select id from touched_profiles);
update public.posts p set
    like_count = (select count(*) from public.likes l where l.post_id = p.id),
    repost_count = (select count(*) from public.reposts r where r.post_id = p.id),
    reply_count = (select count(*) from public.posts c where c.reply_to_id = p.id and c.state <> 'deleted_by_author'),
    quote_count = (select count(*) from public.posts c where c.quote_of_id = p.id and c.state <> 'deleted_by_author')
  where p.id in (select id from touched_posts);
commit;
select 'deleted|yes';
${META}else
rollback;
${META}endif
SQL
`;

const run = spawnSync(compose[0], [...compose.slice(1), "exec", "-T", "-e", `PATTERN=${TEST_EMAIL}`, "-e", `DELETE=${yes ? "on" : "off"}`, "postgres", "sh", "-s"], {
  cwd: root,
  input: script,
  encoding: "utf8",
});
if (run.error) stop(`Could not run ${compose[0]}: ${run.error.message}`);
if (run.status !== 0) stop(`The database could not be read. Is the postgres service up?${NL}${run.stderr}`);

const report = new Map();
const listed = { account: [], profile: [] };
for (const line of run.stdout.split(NL).map((text) => text.trim())) {
  const bar = line.indexOf("|");
  if (bar === -1) continue;
  const key = line.slice(0, bar);
  if (key === "account-item") listed.account.push(line.slice(bar + 1));
  else if (key === "profile-item") listed.profile.push(line.slice(bar + 1));
  else report.set(key, line.slice(bar + 1));
}
const count = (key) => Number(report.get(key) ?? 0);

function show(title, key, labels) {
  console.log(`${title}: ${count(key)}`);
  for (const label of labels.slice(0, LISTED)) console.log(`  ${label}`);
  if (labels.length > LISTED) console.log(`  ... and ${labels.length - LISTED} more`);
}

console.log(`database ${report.get("database")}`);
show("accounts with a test email", "accounts", listed.account);
show("profiles without an account", "profiles", listed.profile);
if (count("accounts") + count("profiles") === 0) {
  console.log("Nothing to clean.");
  process.exit(0);
}
console.log(`their posts: ${count("posts")}, image rows: ${count("images")}`);
console.log(`kept profiles and posts whose counters include them: ${count("touched_profiles")} and ${count("touched_posts")}`);
if (report.get("deleted") === "yes") {
  console.log(`Deleted ${count("accounts")} accounts and ${count("profiles")} profiles with everything they made; recomputed the counters of ${count("touched_profiles")} profiles and ${count("touched_posts")} posts.`);
  console.log("Their image files leave the store when the API's sweeper next finds them without a row, within about an hour.");
} else {
  console.log("Nothing was deleted. Run again with --yes to delete these.");
}
```

### Replace `scripts/smoke-auth-stack.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 3. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 4. /api/me answers for it.
 * 5. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 6. It uploads a JPEG carrying a GPS position, waits until it is ready, and posts it without text. The
 *    original upload is gone, and large.webp is served to anyone as a fresh WebP without metadata.
 * 7. A symlink to /proc/self/environ, planted in the store from inside the worker, is refused with 404.
 * 8. Deleting the post stops the image being served, and its folder leaves the store.
 * 9. The worker has only a loopback interface and a 768 MiB memory limit, and has never restarted.
 * 10. With --worst-case, flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP
 *     progressive JPEG, 48 MP GIF, 16 MP AVIF) all become ready without the worker being OOM-killed or
 *     restarted, and its memory peak is printed. Run it after every sharp upgrade.
 * 11. The grant-role CLI makes it a moderator, and its session stops working.
 *
 * Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit. Makes its images with the sharp the worker uses. Tries a Turnstile refusal again for up to a
 * minute, since outbound calls can stall. Prints no codes or tokens.
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 \
 *     --terms draft-2026-09 [--worst-case] -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
const mailpit = option("mailpit");
const terms = option("terms");
const worstCase = options.includes("--worst-case");
if (!base || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --mailpit <url> --terms <version> [--worst-case] -- <docker compose command>");
  process.exit(2);
}
/** The sharp the worker depends on, so the test images come from the same library that will read them. */
const sharp = createRequire(new URL("../apps/worker/package.json", import.meta.url))("sharp");

/** Cloudflare's test secret accepts any token. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const deviceId = randomBytes(32).toString("base64url");
const email = `smoke-${randomUUID()}@korbat.local`;
const handle = `smoke_${randomBytes(4).toString("hex")}`;
let failures = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function api(path, { json, token } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: json === undefined ? "GET" : "POST", headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/**
 * Cloudflare's siteverify is a call across the internet, and the API fails closed when it stalls past
 * five seconds. On Docker Desktop, containers' outbound calls stall for up to half a minute right after a
 * heavy image build, which is not a fault of the stack, so a Turnstile refusal is tried again every five
 * seconds for up to a minute. A wrong secret still fails, a minute later.
 */
async function withTurnstile(path, json) {
  const deadline = Date.now() + 60_000;
  let result = await api(path, { json });
  while (result.body?.error?.code === "turnstile_failed" && Date.now() < deadline) {
    console.log(`info ${path}: Turnstile could not be verified; trying again in 5 s`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await api(path, { json });
  }
  return result;
}

/** Any request, with a raw body; answers with the status, the headers and the body's bytes. */
async function send(path, { method = "GET", token, body, type } = {}) {
  const headers = {};
  if (type) headers["content-type"] = type;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Runs a shell command in a service's container. Its stdin is closed, so nothing can wait on it. */
function inside(service, command) {
  return execFileSync(compose[0], [...compose.slice(1), "exec", "-T", service, "sh", "-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function workerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "worker"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.OOMKilled}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), oomKilled: fields[2] === "true" };
}

async function upload(bytes, type, token) {
  const sent = await send("/api/media", { method: "POST", token, body: bytes, type });
  let id = null;
  try {
    id = JSON.parse(sent.bytes.toString("utf8")).id ?? null;
  } catch {
    id = null;
  }
  return { status: sent.status, id };
}

/** Polls an upload until it is no longer processing; the worker gives up on a file after two minutes. */
async function waitReady(id, token) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const res = await api(`/api/media/${id}`, { token });
    if (res.body?.status !== "processing") return res.body ?? { status: res.summary };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { status: "still processing after 150 s" };
}

const PLANTED = "korbat-smoke-planted-text";
/** 51 deg 30 min north, the latitude planted below, as EXIF writes it: three rationals of 32-bit numbers. */
const LATITUDE = [51, 1, 30, 1, 0, 1];
function hasLatitude(bytes) {
  const little = Buffer.alloc(24);
  const big = Buffer.alloc(24);
  LATITUDE.forEach((value, index) => {
    little.writeUInt32LE(value, index * 4);
    big.writeUInt32BE(value, index * 4);
  });
  return bytes.includes(little) || bytes.includes(big);
}

async function images(token) {
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#2f6f4f" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: PLANTED }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
    .toBuffer();
  check("the test JPEG carries a GPS position and planted text", hasLatitude(jpeg) && jpeg.includes(PLANTED));

  const sent = await upload(jpeg, "image/jpeg", token);
  if (!check("upload it through Caddy", sent.status === 202 && sent.id !== null, `HTTP ${sent.status}`)) return;
  const id = sent.id;
  const state = await waitReady(id, token);
  if (!check("the image is ready", state.status === "ready", state.error ?? state.status)) return;
  check("the original upload is gone", inside("api", `test -e /media/uploads/incoming/${id} && echo present || echo gone`) === "gone");

  const created = await api("/api/posts", { json: { media: [{ id, alt: "A plain green test image" }] }, token });
  if (!check("post it without text", created.status === 201 && created.body?.media?.length === 1, created.summary)) return;
  const large = created.body.media[0].large;
  const file = await send(large);
  const served = `HTTP ${file.status}, ${file.headers.get("content-type")}, ${file.headers.get("cache-control")}`;
  check("large.webp is served to anyone and may be cached publicly", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === "public, max-age=300", served);
  const meta = await sharp(file.bytes).metadata();
  const clean = meta.format === "webp" && meta.exif === undefined && meta.xmp === undefined && meta.icc === undefined;
  check("large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text", clean && !hasLatitude(file.bytes) && !file.bytes.includes(PLANTED), `${meta.format} ${meta.width}x${meta.height}`);

  const shard = id.slice(0, 2);
  inside("worker", `ln -sf /proc/self/environ /media/store/files/${shard}/${id}/large.webp`);
  const planted = await send(large);
  const leaked = /DATABASE_URL|PASSWORD|SECRET|_KEY=/.test(planted.bytes.toString("latin1"));
  check("a symlink planted in the store by the worker is refused, and nothing leaks", planted.status === 404 && !leaked, `HTTP ${planted.status}`);

  const removed = await send(`/api/posts/${created.body.id}`, { method: "DELETE", token });
  check("delete the post", removed.status === 204, `HTTP ${removed.status}`);
  const after = await send(large);
  check("its image is no longer served", after.status === 404, `HTTP ${after.status}`);
  let folder = "present";
  for (let attempt = 0; attempt < 60 && folder !== "gone"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    folder = inside("api", `test -e /media/store/files/${shard}/${id} && echo present || echo gone`);
  }
  check("its folder is gone from the store", folder === "gone");

  const interfaces = inside("worker", "ls -x /sys/class/net");
  check("the worker has only a loopback interface", interfaces === "lo", interfaces);
  const worker = workerState();
  check("the worker's memory limit is 768 MiB", worker.memory === 768 * 1024 * 1024, `${worker.memory} bytes`);
  check("the worker has never restarted or been OOM-killed", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
}

/** Flat colour compresses to almost nothing, so every file is small to send and at its cap to decode. */
const WORST_CASE = [
  ["48 MP 16-bit interlaced PNG", "image/png", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#806040" } }).toColourspace("rgb16").png({ progressive: true }).toBuffer()],
  ["48 MP progressive JPEG", "image/jpeg", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#406080" } }).jpeg({ progressive: true }).toBuffer()],
  ["48 MP GIF", "image/gif", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#608040" } }).gif().toBuffer()],
  ["16 MP AVIF", "image/avif", () => sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#804060" } }).avif({ effort: 0 }).toBuffer()],
];

async function worstCaseImages(token) {
  for (const [label, type, make] of WORST_CASE) {
    const bytes = await make();
    const sent = await upload(bytes, type, token);
    const state = sent.id ? await waitReady(sent.id, token) : { status: `HTTP ${sent.status}` };
    check(`worst case: ${label} is ready`, state.status === "ready", `${state.error ?? state.status}, ${Math.round(bytes.length / 1024)} KiB sent`);
    if (sent.id) await send(`/api/media/${sent.id}`, { method: "DELETE", token });
  }
  const worker = workerState();
  check("worst case: the worker was never OOM-killed or restarted", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
  const peak = Number(inside("worker", "cat /sys/fs/cgroup/memory.peak"));
  console.log(`info worst case: the worker's memory peak is ${Math.round(peak / 1048576)} MiB of ${Math.round(worker.memory / 1048576)} MiB`);
}

async function signUpCode(to) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = list.messages?.[0];
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

async function main() {
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  const unknown = await withTurnstile("/api/auth/password/signin", { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await signUpCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Smoke Test" }, token: complete.body.token });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);

  const created = await api("/api/posts", { json: { body: "smoke test post" }, token });
  check("create a post", created.status === 201 && typeof created.body?.id === "string", created.summary);
  const latest = await api("/api/timeline/latest");
  check("the post appears in the public Latest timeline", Array.isArray(latest.body?.items) && latest.body.items.some((item) => item.post?.id === created.body?.id), latest.summary);
  const profile = await api(`/api/profiles/${handle}`);
  check("the profile counts one post", profile.body?.counts?.posts === 1, profile.summary);

  await images(token);
  if (worstCase) await worstCaseImages(token);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
```

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
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit   # dev host ports 55432, 56379, 51025, 58025
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health; reads apps/api/.env
pnpm --filter @korbat/worker dev            # the image worker; reads apps/worker/.env and works on .data/media
pnpm --filter @korbat/app web               # http://localhost:8081
```

Emails sent in development (sign-in codes, new-device alerts, lockout notices) land in Mailpit at http://localhost:58025. Locally the web app uses Cloudflare's always-pass Turnstile test key, so the human check never blocks you.

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

## Before going public
Set these in `infra/.env`:
- `API_APP_ORIGIN` to the public origin, for example `https://korbat.example`.
- `API_TURNSTILE_SECRET_KEY` and `WEB_TURNSTILE_SITE_KEY` to the keys of one Turnstile widget.
- `API_SMTP_URL` and `API_MAIL_FROM` to the EU mail relay.

Keep `API_AUTH_HMAC_KEY`, `API_IP_HASH_KEY` and `API_TOTP_ENC_KEY` secret and backed up. Losing `API_TOTP_ENC_KEY` breaks every enrolled authenticator.
````

## Step 2: verify: stack

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build --remove-orphans >/dev/null 2>&1; s=000; for i in $(seq 1 120); do s=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/health); [ "$s" = 200 ] && break; sleep 2; done; echo "health through caddy: $s"; js=$(curl -s http://localhost:8080/ | grep -o '/_expo/static/js/web/[^"]*[.]js' | head -1); bundle=$(curl -s http://localhost:8080$js); echo "composer images in the web bundle: $(echo "$bundle" | grep -c 'Describe every image')"; echo "image viewer in the web bundle: $(echo "$bundle" | grep -c 'Close the image viewer')"
```

Expected output contains:

- `health through caddy: 200`
- `composer images in the web bundle: 1`
- `image viewer in the web bundle: 1`

Allowed difference: Rebuilding the images can take more than ten minutes. The step hides the build's output. If health stays at `000` or an expected line is missing, run `docker compose -f infra/compose.yml -f infra/compose.dev.yml build` to see why; `ECONNRESET` warnings from pnpm inside the build mean Docker's network is failing, which is a STOP condition to report, not to work around.

Observed on the dry run:

```text
health through caddy: 200
composer images in the web bundle: 1
image viewer in the web bundle: 1
```

## Step 3: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `ok   the test JPEG carries a GPS position and planted text`
- `ok   upload it through Caddy`
- `ok   the image is ready`
- `ok   the original upload is gone`
- `ok   post it without text`
- `ok   large.webp is served to anyone and may be cached publicly`
- `ok   large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text`
- `ok   a symlink planted in the store by the worker is refused, and nothing leaks`
- `ok   delete the post`
- `ok   its image is no longer served`
- `ok   its folder is gone from the store`
- `ok   the worker has only a loopback interface`
- `ok   the worker's memory limit is 768 MiB`
- `ok   the worker has never restarted or been OOM-killed`
- `ok   the session stops working after the role change`
- `smoke test passed`

Must not contain:

- `FAIL`

Allowed difference: Lines starting with `info` and ending in `trying again in 5 s` are allowed: on Docker Desktop, containers' calls to Cloudflare can stall for a while, and the smoke test waits up to a minute for Turnstile.

Observed on the dry run:

```text
ok   the test JPEG carries a GPS position and planted text
ok   upload it through Caddy (HTTP 202)
ok   the image is ready (ready)
ok   the original upload is gone
ok   post it without text (HTTP 201)
ok   large.webp is served to anyone and may be cached publicly (HTTP 200, image/webp, public, max-age=300)
ok   large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text (webp 1200x900)
ok   a symlink planted in the store by the worker is refused, and nothing leaks (HTTP 404)
ok   delete the post (HTTP 204)
ok   its image is no longer served (HTTP 404)
ok   its folder is gone from the store
ok   the worker has only a loopback interface (lo)
```

## Step 4: verify: worst-case

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 --worst-case -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `ok   worst case: 48 MP 16-bit interlaced PNG is ready`
- `ok   worst case: 48 MP progressive JPEG is ready`
- `ok   worst case: 48 MP GIF is ready`
- `ok   worst case: 16 MP AVIF is ready`
- `ok   worst case: the worker was never OOM-killed or restarted`
- `info worst case: the worker's memory peak is`
- `smoke test passed`

Must not contain:

- `FAIL`

Allowed difference: Making the four large test files and processing them takes a minute or two. The memory peak printed on the `info` line differs from run to run. Lines starting with `info` and ending in `trying again in 5 s` are allowed: on Docker Desktop, containers' calls to Cloudflare can stall for a while, and the smoke test waits up to a minute for Turnstile.

Observed on the dry run:

```text
ok   worst case: 48 MP 16-bit interlaced PNG is ready (ready, 1264 KiB sent)
ok   worst case: 48 MP progressive JPEG is ready (ready, 275 KiB sent)
ok   worst case: 48 MP GIF is ready (ready, 32 KiB sent)
ok   worst case: 16 MP AVIF is ready (ready, 1 KiB sent)
ok   worst case: the worker was never OOM-killed or restarted (restarts 0, OOM-killed false)
info worst case: the worker's memory peak is 385 MiB of 768 MiB
smoke test passed
```

## Step 5: verify: cleanup-guard

```bash
t=$(mktemp -d); mkdir -p "$t/scripts" "$t/infra"; cp scripts/clean-dev-fixtures.mjs "$t/scripts/"; echo 'API_APP_ORIGIN=https://korbat.example' > "$t/infra/.env"; node "$t/scripts/clean-dev-fixtures.mjs" --yes -- docker compose version; echo "exit $?"; rm -rf "$t"
```

Expected output contains:

- `API_APP_ORIGIN in infra/.env is "https://korbat.example", not a localhost origin.`
- `exit 1`

Observed on the dry run:

```text
exit 1
API_APP_ORIGIN in infra/.env is "https://korbat.example", not a localhost origin. This script only cleans a development database.
```

## Step 6: verify: cleanup-list

```bash
node scripts/clean-dev-fixtures.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `database korbat`
- `accounts with a test email:`
- `profiles without an account:`

Must not contain:

- `Deleted`

Observed on the dry run:

```text
database korbat
accounts with a test email: 0
profiles without an account: 0
```

## Step 7: verify: semgrep

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src" semgrep/semgrep semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist --exclude node_modules --exclude .data 2>&1 | grep -E 'Findings:|Ran [0-9]+ rules'
```

Expected output contains:

- `Findings: 0`

Allowed difference: The scan can take fifteen minutes on Windows because of Docker's file access to the bind mount; it is slow, not stuck.

Observed on the dry run:

```text
• Findings: 0 (0 blocking)
```

## Step 8: verify: audit

```bash
pnpm audit --audit-level high; echo "audit exit: $?"
```

Expected output contains:

- `audit exit: 0`

Observed on the dry run:

```text
audit exit: 0
```

## Step 9: verify: api-unchanged

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  142 passed | 139 skipped (281)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  142 passed | 139 skipped (281)
```

## Step 10: verify: stop-app-services

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker >/dev/null 2>&1; echo 'app services stopped'
```

Expected output contains:

- `app services stopped`

Observed on the dry run:

```text
app services stopped
```

## Step 11: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `README.md`
- `scripts/clean-dev-fixtures.mjs`
- `scripts/smoke-auth-stack.mjs`

## Step 12: commit

```bash
git add -A
git commit -q -m "feat(infra): the smoke test uploads a JPEG with GPS through Caddy and proves a clean WebP, a refused planted symlink, deletion from disk and the worker's isolation, with a worst-case mode at the pixel caps; clean-dev-fixtures lists and removes test leftovers; README covers images" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(infra): the smoke test uploads a JPEG with GPS through Caddy and proves a clean WebP, a refused planted symlink, deletion from disk and the worker's isolation, with a worst-case mode at the pixel caps; clean-dev-fixtures lists and removes test leftovers; README covers images`.

## Report format (mandatory)

```text
TASK 17 REPORT
Files written: <count, expected 3>
Verify "stack": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "worst-case": <paste the expected lines as printed>
Verify "cleanup-guard": <paste the expected lines as printed>
Verify "cleanup-list": <paste the expected lines as printed>
Verify "semgrep": <paste the expected lines as printed>
Verify "audit": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Verify "stop-app-services": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
