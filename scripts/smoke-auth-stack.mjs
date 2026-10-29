#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. The staff console's site (--console): its page answers with the console's CSP, exactly, and
 *    Cache-Control: no-store, no-transform. /api/staff/me answers 404 on the app's site, from Caddy itself,
 *    and, signed out, 401 staff_session_required on the console's, so the API has the console on there.
 *    The console's case routes (the overview, the queue, a case, the appeals) answer the same two ways, and
 *    the console's site answers the app's own moderation routes with 404 itself.
 * 3. Signed out, Explore answers a page that parses; its ranking is computed within a minute (the refresh
 *    job runs a round at start), and by the answer's own Date header it is less than 11 minutes old.
 * 4. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 5. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 6. /api/me answers for it.
 * 7. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 8. It uploads a JPEG carrying a GPS position, waits until it is ready, and posts it without text. The
 *    original upload is gone, no fingerprint of it is stored while MEDIA_MATCH is off (3d Task 7), and large.webp is
 *    served to anyone as a fresh WebP without metadata.
 * 9. A symlink to /proc/self/environ, planted in the store from inside the worker, is refused with 404.
 * 10. Deleting the post stops the image being served, and its folder leaves the store.
 * 11. The worker has only a loopback interface and a 768 MiB memory limit, and has never restarted.
 * 12. With --worst-case, flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP
 *     progressive JPEG, 48 MP GIF, 16 MP AVIF) all become ready without the worker being OOM-killed or
 *     restarted, and its memory peak is printed. Run it after every sharp upgrade.
 * 13. The grant-role CLI makes it a moderator, and its session stops working.
 * 14. A second throwaway account (the first one's session is gone by now, and a deleted account could not
 *     be granted a role) edits its bio, changes its handle, reports the first account's post under a rule
 *     (its own list of reports shows the report undecided, and no decision is about it), downloads its
 *     export as a ZIP whose export.json ends with the moderation member holding that report, since 3b the account's
 *     imports (none) and, since 2d, its Activity, posts, and deletes itself with a code read from Mailpit and its handle typed;
 *     afterwards its profile is not found, its session is gone, and its post has left the Latest timeline.
 * 15. Signed out, a notice that the first account's post is illegal is taken through the app's site with the
 *     human check: it answers a reference and a token. The status page opens with that token and shows the
 *     post's link, undecided, and the contact as given; another token finds no notice. The receipt arrives in
 *     Mailpit under the reference, and the token in its link opens the same page with the address not yet
 *     confirmed. Nothing here decides the case: a decision needs a staff key.
 * 16. With --push (3f, the stack under the Compose profile notify): the phones' push site answers 404 itself to ntfy's
 *     /v1/config, /v1/stats and /v1/account and to a publish, and hands a topic's subscription to ntfy, which refuses
 *     it without a user (403); from inside the ntfy container, on the push network, the app's and the console's sites
 *     answer 403. The contact point's routes (/api/staff/contact) stand behind the console's two doors like the case
 *     routes, in step 2.
 * 17. 3f: a post's page (/post/<id>) answers 200 while the post is public, the shell with its share card in its head (2d
 *     Task 6, step 23), and the plain shell, the same bytes as /, with the same security headers and noindex, with 404 once
 *     its author deleted it, and 404 for a post that does not exist or a malformed id: Caddy asks the API's card route, GET
 *     /api/cards/post/<id>; 3f's status route, GET /api/posts/<id>/status, still answers 204 or 404 with no body.
 * 18. With --closed (3f, the stack started with APP_SITE=closed, as for a restore): every path of the app's site, the
 *     API's included, answers 503 with Caddy's one sentence, the console's site still serves its page, and nothing else
 *     runs, since nothing else can be reached through the app's site.
 * 19. 3d Task 4: GET /api/public/facts answers no-cache and names every tool off (the R1 check, the comparison with
 *     known material, the edge and the head's witness). A status code proves nothing about the two public pages, since
 *     the web export is one page and Caddy answers every unknown path with its shell: so the lead sentences of the rules
 *     page and of the transparency page are looked for in the bundle Caddy serves under /_expo/, which proves they were
 *     built in (the app's render tests prove the pages). An app test holds the two sentences here to the pages' own.
 * 20. UI Task 3: the app's page and the files it loads first, as Caddy serves them: / answers 200 with no-cache;
 *     /theme-boot.js, the script that paints the reader's theme before the bundle, answers 200 with no-cache like the
 *     page; the first font file the entry bundle names (a hashed /assets/__node_modules/@fontsource-variable/... woff2)
 *     answers 200 with public, max-age=31536000, immutable; and a post's page answers 200 while the post is public and
 *     404 for a post that does not exist (step 17 checks the rest of the post's page).
 * 21. 3b Tasks 4 and 8: the whole import, before the grant-role step while the first account's session works: the account
 *     aged past seven days through psql in the postgres container, a Mastodon archive built here with fflate's zipSync
 *     (four public posts, a followers-only one and a boost beside a 9 MiB file korbat never opens), created and sent in
 *     chunks of 8 MiB with their SHA-256 through Caddy, the real importer's scan read by import-drive until the import is
 *     ready with its counts and its three samples, the archive gone once read; the importer healthy with only a loopback
 *     interface and 512 MiB. Then confirmed (POST /api/imports/:id/confirm) with every choice off or open, long posts left
 *     out and the statement; images are off in the stack, so it publishes at once, and import-drive's rounds every five
 *     seconds publish the four posts until it is done. The profile's Imported tab (GET /api/profiles/<handle>/imported)
 *     holds them, newest first by the archive's day, each labelled as imported from Mastodon with its day; the profile
 *     shows the tab (hasImported) and counts four more posts, and Latest holds none of them. Last, Remove imported posts
 *     (POST /api/imports/:id/undo) runs until the import is undone: the tab is empty, the profile no longer shows it and
 *     counts as before. The stack needs the archive's size, 4 GiB and IMPORT_MIN_FREE_BYTES free on Docker's disk.
 * 22. 2d Task 3: the first account's picture, a 900 by 600 JPEG whose middle third is a band of its own colour, sent through
 *     Caddy with kind=avatar&crop=centre and made square by the real worker (version 3 of its result); PUT /api/me/avatar
 *     sets it, /api/me and the author of the account's post carry its two paths, and large.webp is a 400 px square cut
 *     from the centre, served to anyone under the public header. It stays the account's picture.
 * 23. 2d Task 6: the share cards through the real Caddy, with Twitterbot's request from infra/caddy/lab/crawlers.json and no
 *     cookie. The first account's post (/post/<id>) and profile (/u/<handle>) answer 200 with the generic card while its
 *     link previews are off (the default): korbat's words alone, noindex in the header and in the head, and the served
 *     title korbat. Once the account sets its own display name to {{env "HOME"}} and turns previews on, the full cards: the
 *     name printed as text, escaped, with Caddy's HOME nowhere in the page and no {{ left in it; the post's text and time,
 *     its author's picture of step 22 with its description, the profile's handle. The name and the switch are put back.
 *
 * Runs only against a local Docker context. Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit, and API_CONSOLE_ORIGIN naming the --console address. Makes its images with the sharp the worker uses.
 * Tries a Turnstile refusal again for up to a minute, since outbound calls can stall. Prints no codes or tokens.
 *
 * Every run leaves its first account, by then a moderator, and one open case on that account's post, in the lane
 * that is read last, with a report and a notice that no run can decide. One network may run it five times an hour
 * and five times a day: its two sign-ups count against the hourly sign-up limit, its signed-out notice against the
 * limits of reports sent without an account, and its import against the five imports started from one address in a
 * day (3b's import-address-day).
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:8090 \
 *     --mailpit http://localhost:58025 --terms draft-2026-09 [--worst-case] \
 *     -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { CONSOLE_CSP } from "../apps/admin/site-headers.mjs";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
// The staff console's site: Caddy's second site, at exactly the address API_CONSOLE_ORIGIN names, never 127.0.0.1.
const consoleBase = option("console");
const mailpit = option("mailpit");
const terms = option("terms");
const worstCase = options.includes("--worst-case");
// 3f: the phones' push site (Caddy's third site), only while the stack runs with the Compose profile notify.
const pushBase = option("push");
// 3f: the app's site closed by APP_SITE=closed (step 18).
const closed = options.includes("--closed");
if (!base || !consoleBase || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --console <url> --mailpit <url> --terms <version> [--worst-case] [--push <url>] [--closed] -- <docker compose command>");
  process.exit(2);
}
function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

/** The sharp the worker depends on, so the test images come from the same library that will read them. */
const sharp = createRequire(new URL("../apps/worker/package.json", import.meta.url))("sharp");
/** The fflate the API depends on: the export's archive is opened with the library the API's own tests open it with. */
const { strFromU8, strToU8, unzipSync, zipSync } = createRequire(new URL("../apps/api/package.json", import.meta.url))("fflate");

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

async function api(path, { json, token, method } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: method ?? (json === undefined ? "GET" : "POST"), headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/** What a failed human check answers: the sign-in routes' code, and the code of a report sent signed out. */
const HUMAN_CHECK_REFUSALS = ["turnstile_failed", "human_check_failed"];

/**
 * Cloudflare's siteverify is a call across the internet, and the API fails closed when it stalls past
 * five seconds. On Docker Desktop, containers' outbound calls stall for up to half a minute right after a
 * heavy image build, which is not a fault of the stack, so a Turnstile refusal is tried again every five
 * seconds for up to a minute. A wrong secret still fails, a minute later.
 */
async function withTurnstile(path, json) {
  const deadline = Date.now() + 60_000;
  let result = await api(path, { json });
  while (HUMAN_CHECK_REFUSALS.includes(result.body?.error?.code) && Date.now() < deadline) {
    console.log(`info ${path}: Turnstile could not be verified; trying again in 5 s`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await api(path, { json });
  }
  return result;
}

/** Any request, with a raw body; answers with the status, the headers and the body's bytes. */
async function send(path, { method = "GET", token, body, type, ifNoneMatch } = {}) {
  const headers = {};
  if (type) headers["content-type"] = type;
  if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

/** The headers a page's security rests on, which Caddy sets the same on every answer of the app's page. */
const SECURITY_HEADERS = ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "cache-control"];

/**
 * 3f (design, section 7.12): a post's page as a browser or a checker asks for it, through Caddy: its status, its media
 * type, its bytes and the security headers.
 */
async function postPage(postId) {
  const res = await fetch(`${base}/post/${postId}`, { headers: { accept: "text/html" } });
  const security = Object.fromEntries(SECURITY_HEADERS.map((name) => [name, res.headers.get(name) ?? undefined]));
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()), security, robots: res.headers.get("x-robots-tag") };
}

/**
 * 3f (step 18): the app's site closed by APP_SITE=closed answers every path, the API's included, with 503 and Caddy's
 * one sentence; the console's site is not touched.
 */
async function closedSite() {
  for (const path of ["/", `/post/${randomUUID()}`, "/api/health", "/api/me", "/api/staff/me", "/assets/none.js"]) {
    const res = await send(path);
    check(`3f: with APP_SITE=closed, ${path} answers 503 with the fixed sentence`, res.status === 503 && res.bytes.toString("utf8") === "korbat is closed for maintenance. Please come back later.", `HTTP ${res.status}`);
  }
  const page = await fetch(`${consoleBase}/`);
  await page.arrayBuffer();
  check("3f: the console's site still serves its page", page.status === 200, `HTTP ${page.status}`);
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

/**
 * 3d Task 3 (design, sections 2 row 12 and 7.4): the header of a public image, which the API builds from the contracts'
 * EDGE_CACHE: a browser's minute, an edge's five minutes, revalidated and never stale.
 */
const PUBLIC_IMAGE_CACHE = "public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0";

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
  // 3d Task 7 (design, section 7.8; row 10): with every adapter off (MEDIA_MATCH=off) nothing is hashed: no row of
  // media_hashes exists for the upload. Read as the database's owner inside its own container, which the id alone reaches.
  const hashed = inside("postgres", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from public.media_hashes where media_id = '${id}'"`);
  check("3d: with MEDIA_MATCH off no media_hashes row exists for it", hashed === "0", hashed);

  const created = await api("/api/posts", { json: { media: [{ id, alt: "A plain green test image" }] }, token });
  if (!check("post it without text", created.status === 201 && created.body?.media?.length === 1, created.summary)) return;
  const large = created.body.media[0].large;
  const file = await send(large);
  const served = `HTTP ${file.status}, ${file.headers.get("content-type")}, ${file.headers.get("cache-control")}`;
  check("large.webp is served to anyone and may be cached publicly", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, served);
  // 3d Task 3 (design, section 7.4): the 304 of a public image carries the same header through Caddy.
  const revalidated = await send(large, { ifNoneMatch: file.headers.get("etag") ?? "" });
  check("3d: its 304 carries the same header", revalidated.status === 304 && revalidated.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, `HTTP ${revalidated.status}, ${revalidated.headers.get("cache-control")}`);
  const meta = await sharp(file.bytes).metadata();
  const clean = meta.format === "webp" && meta.exif === undefined && meta.xmp === undefined && meta.icc === undefined;
  check("large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text", clean && !hasLatitude(file.bytes) && !file.bytes.includes(PLANTED), `${meta.format} ${meta.width}x${meta.height}`);

  const shard = id.slice(0, 2);
  inside("worker", `ln -sf /proc/self/environ /media/store/files/${shard}/${id}/large.webp`);
  const planted = await send(large);
  const leaked = /DATABASE_URL|PASSWORD|SECRET|_KEY=/.test(planted.bytes.toString("latin1"));
  check("a symlink planted in the store by the worker is refused, and nothing leaks", planted.status === 404 && !leaked, `HTTP ${planted.status}`);

  const shown = await postPage(created.body.id);
  // 2d Task 6: a public post's page is card.html, the shell with the card's block in its head; the plain shell is /'s bytes.
  const shell = (await send("/")).bytes;
  check(
    "3f, 2d: the post's page answers 200 while the post is public, the shell with its card",
    shown.status === 200 && shown.type === "text/html; charset=utf-8" && shown.bytes.toString("utf8").includes('<meta property="og:site_name" content="korbat" />'),
    `HTTP ${shown.status}, ${shown.type}`,
  );
  const removed = await send(`/api/posts/${created.body.id}`, { method: "DELETE", token });
  check("delete the post", removed.status === 204, `HTTP ${removed.status}`);
  const gone = await postPage(created.body.id);
  check("3f: once deleted, its page answers the plain shell with 404, never 451", gone.status === 404 && gone.bytes.equals(shell), `HTTP ${gone.status}`);
  check("3f, 2d: the same security headers and noindex on both answers", isDeepStrictEqual(gone.security, shown.security) && shown.security["content-security-policy"] !== undefined && gone.robots === "noindex" && shown.robots === "noindex", JSON.stringify(gone.security));
  const missing = await postPage(randomUUID());
  const malformed = await postPage("not-a-post");
  check("3f: a post that does not exist and a malformed id answer 404 with the plain shell", missing.status === 404 && malformed.status === 404 && missing.bytes.equals(shell) && malformed.bytes.equals(shell), `HTTP ${missing.status}, ${malformed.status}`);
  const status = await send(`/api/posts/${created.body.id}/status`);
  check("3f: the API's status route answers 404 with no body for the deleted post", status.status === 404 && status.bytes.length === 0, `HTTP ${status.status}, ${status.bytes.length} bytes`);
  const after = await send(large);
  check("its image is no longer served, and its 404 may be cached by nobody", after.status === 404 && after.headers.get("cache-control") === "no-store", `HTTP ${after.status}, ${after.headers.get("cache-control")}`);
  const unknown = await send(`/api/media/${randomUUID()}/large.webp`);
  check("3d: an image that does not exist answers 404 with no-store", unknown.status === 404 && unknown.headers.get("cache-control") === "no-store", `HTTP ${unknown.status}, ${unknown.headers.get("cache-control")}`);
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

/**
 * 2d Task 3 (design, sections 7.2 to 7.5; step 22): the account's picture through the real worker. The source is 900 by 600,
 * blue with its middle third orange, so the centre crop's square (600 px from x = 150) has orange at its centre, and the
 * start's or the end's would not.
 */
async function avatar(token, postId) {
  const band = await sharp({ create: { width: 300, height: 600, channels: 3, background: "#e0a020" } }).png().toBuffer();
  const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#204080" } }).composite([{ input: band, left: 300, top: 0 }]).jpeg({ quality: 92 }).toBuffer();
  const sent = await send("/api/media?kind=avatar&crop=centre", { method: "POST", token, body: source, type: "image/jpeg" });
  let id = null;
  try {
    id = JSON.parse(sent.bytes.toString("utf8")).id ?? null;
  } catch {
    id = null;
  }
  if (!check("2d: upload a picture with kind=avatar&crop=centre through Caddy", sent.status === 202 && id !== null, `HTTP ${sent.status}`)) return;
  const state = await waitReady(id, token);
  if (!check("2d: the worker makes it ready as a 400 px square", state.status === "ready" && state.width === 400 && state.height === 400, `${state.status} ${state.width}x${state.height}`)) return;
  const set = await api("/api/me/avatar", { method: "PUT", json: { mediaId: id }, token });
  const paths = { small: `/api/media/${id}/small.webp`, large: `/api/media/${id}/large.webp` };
  if (!check("2d: PUT /api/me/avatar sets it and answers its two paths", set.status === 200 && isDeepStrictEqual(set.body?.avatar, paths), set.summary)) return;
  const me = await api("/api/me", { token });
  check("2d: /api/me carries the picture", isDeepStrictEqual(me.body?.avatar, paths), JSON.stringify(me.body?.avatar));
  const post = await api(`/api/posts/${postId}`);
  check("2d: the author of the account's post carries it, signed out", post.status === 200 && isDeepStrictEqual(post.body?.author?.avatar, paths), post.summary);
  const file = await send(paths.large);
  check("2d: large.webp is served to anyone under the public header", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, `HTTP ${file.status}, ${file.headers.get("cache-control")}`);
  const meta = file.status === 200 ? await sharp(file.bytes).metadata() : null;
  const { data, info } = file.status === 200 ? await sharp(file.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true }) : { data: Buffer.alloc(0), info: { width: 0, height: 0, channels: 3 } };
  const at = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  const centre = data.length > at + 2 ? [data[at], data[at + 1], data[at + 2]] : [0, 0, 0];
  check("2d: it is a 400 px WebP square cut from the centre", meta?.format === "webp" && meta.width === 400 && meta.height === 400 && centre[0] > 150 && centre[2] < 100, `${meta?.format} ${meta?.width}x${meta?.height}, centre ${centre.join(",")}`);
}

/** Twitterbot's request as the card lab's crawlers.json gives it: its User-Agent and Accept-Encoding, and no cookie. */
const TWITTERBOT = JSON.parse(readFileSync(new URL("../infra/caddy/lab/crawlers.json", import.meta.url), "utf8")).crawlers.find((crawler) => crawler.name === "Twitterbot").headers;

/**
 * A page as Twitterbot asks for it through Caddy: its status, its X-Robots-Tag, its text, its served titles and its head
 * block's tags, which are robots, description and the namespaced ones (og:, twitter:, article:, profile:); the shell's own
 * viewport and color-scheme are no card's.
 */
async function cardPage(path) {
  const res = await fetch(`${base}${path}`, { headers: TWITTERBOT });
  const text = await res.text();
  const tags = [...text.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)" [/]>/g)].map((match) => [match[1], match[2]]).filter(([key]) => key === "robots" || key === "description" || key.includes(":"));
  return { status: res.status, robots: res.headers.get("x-robots-tag"), text, titles: text.match(/<title>[^<]*<[/]title>/g) ?? [], tags };
}

/**
 * Step 23 (2d Task 6, design section 12.4): the share cards of the account's post and profile through the real Caddy, with
 * Twitterbot's request: the generic card while its link previews are off, the full one once on, and a display name the
 * account set to a template action printed as text.
 */
async function cards(token, postId) {
  const me = await api("/api/me", { token });
  const picture = me.body?.avatar?.large;
  if (!check("2d: the account has its picture of step 22 for its cards", typeof picture === "string" && typeof postId === "string", JSON.stringify(me.body?.avatar))) return;
  for (const [path, title] of [
    [`/post/${postId}`, "A post on korbat"],
    [`/u/${handle}`, "A profile on korbat"],
  ]) {
    const page = await cardPage(path);
    check(
      `2d: with previews off (the default) ${path.split("/")[1]}'s page is the generic card: korbat's words alone, noindex, the served title korbat`,
      page.status === 200 &&
        page.robots === "noindex" &&
        isDeepStrictEqual(page.tags.map(([key]) => key), ["robots", "og:site_name", "og:type", "og:url", "og:title", "twitter:card"]) &&
        page.tags.find(([key]) => key === "og:title")?.[1] === title &&
        page.tags.find(([key]) => key === "og:url")?.[1].endsWith(path) &&
        isDeepStrictEqual(page.titles, ["<title>korbat</title>"]) &&
        !page.text.includes("Smoke Test") &&
        !page.text.includes(picture),
      `HTTP ${page.status}, ${JSON.stringify(page.tags)}`,
    );
  }

  const named = await api("/api/me/profile", { method: "PATCH", json: { displayName: '{{env "HOME"}}' }, token });
  const on = await api("/api/me/share-previews", { method: "POST", token });
  if (!check("2d: the account sets its display name to a template action and turns link previews on", named.status === 200 && on.status === 200 && on.body?.sharePreviews === true, `${named.summary}, ${on.summary}`)) return;
  const home = inside("caddy", "printenv HOME || true");
  const escapedTitle = `&#123;&#123;env &quot;HOME&quot;&#125;&#125; (@${handle})`;
  const post = await cardPage(`/post/${postId}`);
  const read = (page, key) => page.tags.find(([name]) => name === key)?.[1];
  const created = (await api(`/api/posts/${postId}`)).body?.createdAt;
  check(
    "2d: with previews on the post's card names its author, its text, its time and its author's picture, the display name printed as text",
    post.status === 200 &&
      read(post, "og:type") === "article" &&
      read(post, "og:title") === escapedTitle &&
      read(post, "og:description") === "smoke test post" &&
      read(post, "og:image")?.endsWith(picture) &&
      read(post, "og:image:alt") === `Profile picture of @${handle}` &&
      read(post, "article:published_time") === created &&
      read(post, "twitter:card") === "summary" &&
      isDeepStrictEqual(post.titles, ["<title>korbat</title>"]),
    JSON.stringify(post.tags),
  );
  const profile = await cardPage(`/u/${handle}`);
  check(
    "2d: with previews on the profile's card names it, with its picture and its handle",
    profile.status === 200 && read(profile, "og:type") === "profile" && read(profile, "og:title") === escapedTitle && read(profile, "og:image")?.endsWith(picture) && read(profile, "profile:username") === handle,
    JSON.stringify(profile.tags),
  );
  for (const page of [post, profile]) {
    check("2d: nothing evaluated the name: no {{ in the page, and Caddy's HOME nowhere in it", !page.text.includes("{{") && (home === "" || !page.text.includes(home)), `HOME ${home === "" ? "unset" : "set"}`);
  }
  const back = await api("/api/me/profile", { method: "PATCH", json: { displayName: "Smoke Test" }, token });
  const off = await api("/api/me/share-previews", { method: "DELETE", token });
  check("2d: the display name and the switch are put back", back.status === 200 && off.status === 200 && off.body?.sharePreviews === false, `${back.summary}, ${off.summary}`);
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

/** A GET of a full URL: the status, the headers, and the body when it is JSON. */
async function getJson(url) {
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/**
 * The staff console's site (3a design, sections 8 and 12). Its page carries the console's own policy, the one
 * apps/admin/site-headers.mjs defines and the Caddyfile's console site sends, and is neither stored nor transformed. The
 * staff API answers only there: the app's site refuses it itself, with a 404 that carries no request id (the API puts one
 * in every error it answers, so none means Caddy answered ahead of its API proxy), and the console's site hands it to the
 * API, whose staff gate accepts the console's Host and, without a session, answers 401. A 404 there means the API has the
 * console off (API_CONSOLE_ORIGIN empty) or API_CONSOLE_ORIGIN names another address than --console.
 */
async function consoleSite() {
  const page = await fetch(`${consoleBase}/`);
  const csp = page.headers.get("content-security-policy");
  check("the console's page answers with the console's CSP, exactly", page.status === 200 && csp === CONSOLE_CSP, `HTTP ${page.status}, ${csp ?? "no CSP"}`);
  const cache = page.headers.get("cache-control");
  check("the console's page is neither stored nor transformed", cache === "no-store, no-transform", cache ?? "no Cache-Control");

  const onApp = await getJson(`${base}/api/staff/me`);
  check("the app's site answers /api/staff/me with 404", onApp.status === 404 && onApp.body?.error?.code === "not_found", onApp.summary);
  check("the app's site refuses the staff API itself, ahead of its API proxy", onApp.status === 404 && onApp.body?.error?.requestId === undefined, onApp.body?.error?.requestId ? "the API answered" : onApp.summary);

  const onConsole = await getJson(`${consoleBase}/api/staff/me`);
  check("signed out, the console's site answers /api/staff/me with 401 staff_session_required", onConsole.status === 401 && onConsole.body?.error?.code === "staff_session_required", onConsole.summary);

  // The console's case routes (3c design, section 12) stand behind the same two doors: the overview, the queue, a case
  // and the appeals, and since account sanctions (3e design, section 12.2) the Standing screen's lists. The staff session
  // is asked for before anything of the request is read, so a case that does not exist answers like the others.
  // 3f: the contact point's list too.
  const caseRoutes = ["/api/staff/overview", "/api/staff/queue", `/api/staff/cases/${randomUUID()}`, "/api/staff/appeals", "/api/staff/standing", "/api/staff/contact"];
  const answers = (list) => list.map((answer, index) => `${caseRoutes[index]}: ${answer.summary}`).join("; ");
  const casesOnApp = await Promise.all(caseRoutes.map((path) => getJson(`${base}${path}`)));
  check(
    "the app's site refuses the console's case routes itself, with 404",
    casesOnApp.every((answer) => answer.status === 404 && answer.body?.error?.code === "not_found" && answer.body.error.requestId === undefined),
    answers(casesOnApp),
  );
  const casesOnConsole = await Promise.all(caseRoutes.map((path) => getJson(`${consoleBase}${path}`)));
  check(
    "signed out, the console's site answers its case routes with 401 staff_session_required",
    casesOnConsole.every((answer) => answer.status === 401 && answer.body?.error?.code === "staff_session_required"),
    answers(casesOnConsole),
  );
  // And the other way round: the console's site proxies the staff API and nothing else, so the app's own moderation
  // routes are answered there by Caddy, never by the API.
  const appRoute = await getJson(`${consoleBase}/api/moderation/cases`);
  check("the console's site refuses the app's moderation routes itself, with 404", appRoute.status === 404 && appRoute.body?.error?.code === "not_found" && appRoute.body.error.requestId === undefined, appRoute.summary);
}

/**
 * The phones' push site (3f design, sections 5 and 12.2, with --push). Caddy hands ntfy only the two topics'
 * subscriptions: every path of ntfy's own API answers Caddy's 404 (ntfy's /v1/config and /v1/stats answer any caller
 * otherwise), and so does a publish; a subscription without a user reaches ntfy, whose deny-all answers 403. And from
 * inside the ntfy container, on the push network, the app's and the console's sites refuse the request with 403: until the
 * push site, only cloudflared could reach Caddy.
 */
async function pushSite() {
  for (const path of ["/v1/config", "/v1/stats", "/v1/account", "/v1/health", "/", "/korbat-all"]) {
    const res = await fetch(`${pushBase}${path}`);
    check(`the push site answers ${path} with 404 itself`, res.status === 404 && res.headers.get("server") === null, `HTTP ${res.status}`);
  }
  const publish = await fetch(`${pushBase}/korbat-all`, { method: "POST", body: "a publish from outside" });
  check("the push site refuses a publish with 404", publish.status === 404, `HTTP ${publish.status}`);
  const subscribe = await fetch(`${pushBase}/korbat-oncall,korbat-all/json?poll=1`);
  const refusal = await subscribe.json().catch(() => null);
  check("a subscription without a user reaches ntfy, which refuses it", subscribe.status === 403 && refusal?.code === 40301, `HTTP ${subscribe.status} ${JSON.stringify(refusal)}`);
  for (const [site, port] of [["app's", 8080], ["console's", 8090]]) {
    const answer = inside("ntfy", `wget -q -S -O /dev/null http://caddy:${port}/ 2>&1; true`);
    check(`from the push network the ${site} site answers 403`, / 403 /.test(answer), answer.split(String.fromCharCode(10))[0]);
  }
}

/**
 * Explore signed out (2c design, section 13). The page's fields are checked by hand: post items only, at most the
 * signed-out page of 20, no cursor, a boolean signInForMore and computedAt null or a time. The refresh job runs a round
 * as the API starts, so computedAt is polled for up to a minute. Its age is measured against the answer's Date header,
 * the server's clock rather than this machine's, and stays under 11 minutes: a round at most every 5 minutes, one that
 * skips because the last ranking is under 4.5 minutes old, and a minute and a half to spare.
 */
/** The lead sentences of /rules and /transparency (RULES_PAGE.lead and TRANSPARENCY_PAGE.lead), held to them by an app test. */
const RULES_LEAD =
  "These are all of korbat's rules. korbat restricts content when it breaks one of them, or when it is illegal under EU law or the law of an EU country and korbat is told about it in a notice. Opinions are never a reason. Every decision names one of these rules or the law, and its statement shows the rule as it read on the day of the decision.";
const TRANSPARENCY_LEAD =
  "What korbat's moderators, its programs and authorities' orders did, in numbers. korbat publishes counts and never a decision: on a service this small, a list of decisions would point at people. Whoever a decision concerns gets its full reasons from korbat directly.";

/** Step 19 (3d Task 4): the facts of a stack with every adapter off, and the two pages' lead sentences in the bundle. */
async function publicPages() {
  const res = await fetch(`${base}/api/public/facts`);
  const facts = await res.json().catch(() => null);
  check("3d: GET /api/public/facts answers no-cache", res.status === 200 && res.headers.get("cache-control") === "no-cache", `HTTP ${res.status}, ${res.headers.get("cache-control")}`);
  check(
    "3d: the facts name every tool off: the R1 check, the comparison with known material, the edge and the witness",
    facts?.r1?.state === "off" && facts?.match?.state === "off" && facts?.edge?.on === false && facts?.witness?.on === false,
    JSON.stringify(facts),
  );
  const shell = await (await fetch(`${base}/`)).text();
  const scripts = [...shell.matchAll(/<script[^>]* src="([^"]+)"/g)].map((match) => match[1]).filter((src) => src.startsWith("/_expo/"));
  if (!check("3d: the app's shell loads its bundle from /_expo/", scripts.length > 0, `${scripts.length} scripts`)) return;
  // A minifier may write an apostrophe inside a string escaped; the sentence is looked for with it read back.
  const escapedQuote = `${String.fromCharCode(92)}'`;
  let bundle = "";
  for (const src of scripts) bundle += (await (await fetch(`${base}${src}`)).text()).replaceAll(escapedQuote, "'");
  check("3d: the rules page's lead sentence is in the bundle Caddy serves", bundle.includes(RULES_LEAD));
  check("3d: the transparency page's lead sentence is in the bundle Caddy serves", bundle.includes(TRANSPARENCY_LEAD));
}

/**
 * Step 20 (UI Task 3): the app's page, theme-boot.js, the first font the entry bundle names and a post's page, each with
 * its status and caching. `postId` is a public post's.
 */
async function appShell(postId) {
  const page = await send("/");
  check("UI: / answers the app's page with no-cache", page.status === 200 && page.headers.get("cache-control") === "no-cache", `HTTP ${page.status}, ${page.headers.get("cache-control")}`);
  const boot = await send("/theme-boot.js");
  check("UI: /theme-boot.js answers 200 with no-cache, like the page", boot.status === 200 && boot.headers.get("cache-control") === "no-cache", `HTTP ${boot.status}, ${boot.headers.get("cache-control")}`);
  const entry = /<script[^>]* src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/.exec(page.bytes.toString("utf8"))?.[1];
  if (!check("UI: the page names its entry bundle", entry !== undefined)) return;
  const bundle = (await send(entry)).bytes.toString("utf8");
  // On web Metro's require of a font yields its hashed address as a string, which the bundle carries (Task 1).
  const font = /\/assets\/__node_modules\/@fontsource-variable\/[a-z-]+\/files\/[a-z0-9-]+\.[0-9a-f]+\.woff2/.exec(bundle)?.[0];
  const file = font === undefined ? null : await send(font);
  check(
    "UI: the first font the bundle names answers 200, public, max-age=31536000, immutable",
    file?.status === 200 && file.headers.get("cache-control") === "public, max-age=31536000, immutable",
    font === undefined ? "no font in the bundle" : `${font}: HTTP ${file?.status}, ${file?.headers.get("cache-control")}`,
  );
  const shown = await postPage(postId);
  const missing = await postPage(randomUUID());
  check("UI: a public post's page answers 200 and a missing post's 404", shown.status === 200 && missing.status === 404, `HTTP ${shown.status}, ${missing.status}`);
}

async function explore() {
  const deadline = Date.now() + 60_000;
  let answer;
  let page = null;
  for (;;) {
    answer = await send("/api/timeline/explore");
    try {
      page = JSON.parse(answer.bytes.toString("utf8"));
    } catch {
      page = null;
    }
    if (answer.status !== 200 || typeof page?.computedAt === "string" || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const items = Array.isArray(page?.items) ? page.items : null;
  const posts = items !== null && items.every((item) => item?.kind === "post" && typeof item.post?.id === "string" && typeof item.post?.author?.handle === "string");
  const parses =
    answer.status === 200 &&
    posts &&
    items.length <= 20 &&
    page.nextCursor === null &&
    typeof page.signInForMore === "boolean" &&
    (page.computedAt === null || (typeof page.computedAt === "string" && !Number.isNaN(Date.parse(page.computedAt))));
  check("signed out, Explore answers a page that parses", parses, `HTTP ${answer.status}, ${items === null ? "no" : items.length} posts`);
  if (!check("Explore has a ranking within a minute", typeof page?.computedAt === "string", page?.computedAt ?? "computedAt is null")) return;
  const age = Date.parse(answer.headers.get("date") ?? "") - Date.parse(page.computedAt);
  check("by the answer's Date header, the ranking is less than 11 minutes old", Number.isFinite(age) && age < 11 * 60 * 1000, `${Math.round(age / 1000)} s`);
}

/** The first 6-digit code in the newest message to `to`, or in the newest one with `subject` when an older code email is already in the box. */
async function emailCode(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = subject === undefined ? list.messages?.[0] : list.messages?.find((message) => message.Subject === subject);
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

/** A notice's public reference: N- and ten base32 characters. */
const NOTICE_REF = /^N-[A-Z2-7]{10}$/;

/** One line about a report's items as a status answer or a list gives them: how many, and each one's link and outcome. */
const itemsSummary = (items) => (Array.isArray(items) ? `${items.length} item(s): ${items.map((item) => `${item?.link} -> ${item?.outcome}`).join(", ")}` : "no items");
/** Whether these are exactly one item, about this post by its korbat link, with no outcome shown yet. */
const onePostUndecided = (items, postId) => Array.isArray(items) && items.length === 1 && typeof items[0]?.link === "string" && items[0].link.endsWith(`/post/${postId}`) && items[0].outcome === null;

/**
 * A report under a rule from a signed-in account (3c design, sections 7.1, 7.6 and 12), about another account's post:
 * it needs no human check and answers a reference without a token, since the account's own list follows it. That list
 * then shows the report with its one item undecided, and the account's list of decisions is empty. Answers the
 * reference, or null when the report was not taken.
 */
async function signedInReport(postId, token) {
  const reported = await api("/api/notices", { json: { ground: "rule", ruleId: "R6", targets: [{ kind: "post", id: postId }], explanation: "Sent by the smoke test." }, token });
  const ref = reported.body?.ref;
  if (!check("a signed-in report under a rule is taken: a reference and no token", reported.status === 201 && NOTICE_REF.test(ref ?? "") && reported.body.token === undefined, reported.summary)) return null;
  const reports = await api("/api/moderation/reports", { token });
  const mine = reports.body?.reports?.[0];
  check("the account's list of reports shows it, undecided", reports.status === 200 && mine?.ref === ref && onePostUndecided(mine.items, postId), `${reports.summary}, ${itemsSummary(mine?.items)}`);
  const cases = await api("/api/moderation/cases", { token });
  check("no decision is about the account", cases.status === 200 && Array.isArray(cases.body?.decisions) && cases.body.decisions.length === 0 && cases.body.nextCursor === null, cases.summary);
  return ref;
}

/**
 * The export's moderation member (3c design, section 7.11), read from the archive itself: export.json's member before
 * the last, with no decision about this account and the one report it sent, under its reference and its ground, its item
 * undecided. Since 3b Task 6 the last member is `imports` (3b design, section 11.2), empty for this account, which
 * imported nothing.
 */
function exportedModeration(archive, reportRef, postId) {
  let document = null;
  try {
    document = JSON.parse(strFromU8(unzipSync(new Uint8Array(archive))["export.json"]));
  } catch {
    document = null;
  }
  const moderation = document?.moderation;
  const last = document === null ? "export.json could not be read" : `last members ${Object.keys(document).slice(-3).join(", ")}`;
  // 2d (11.2): the account's Activity comes last, after 3b's imports.
  const ends = document !== null && isDeepStrictEqual(Object.keys(document).slice(-3), ["moderation", "imports", "activity"]) && isDeepStrictEqual(document.imports, []);
  if (!check("export.json ends with the moderation member, its decisions and its reports, then the account's imports, none, then its Activity", ends && Array.isArray(moderation?.decisions) && Array.isArray(moderation?.reports), last)) return;
  const own = moderation.reports[0];
  check(
    "the export holds no decision and the account's one report, undecided",
    reportRef !== null && moderation.decisions.length === 0 && moderation.reports.length === 1 && own?.ref === reportRef && own.ground === "rule" && own.ruleId === "R6" && onePostUndecided(own.items, postId) && own.items[0].reexaminationOpen === null,
    `${moderation.decisions.length} decision(s), ${moderation.reports.length} report(s), ${itemsSummary(own?.items)}`,
  );
}

/** The newest message to `to` in Mailpit whose subject is `subject`, read whole; null when none arrives within half a minute. */
async function mailTo(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 120; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const found = list.messages?.find((message) => message.Subject === subject);
    if (found) return (await fetch(`${mailpit}/api/v1/message/${found.ID}`)).json();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/**
 * A notice sent signed out, through the app's site (3c design, sections 7.1, 7.2 and 12): an Article 16 notice that the
 * first account's post is illegal, in a category of the lane that is read last, so that no urgent alert goes out, with a
 * name and an address. The human check is Turnstile's, with the test secret that passes any token. It answers a
 * reference and the notice's own token, which opens the status page; the receipt goes to the address at once, and the
 * token in its link opens the same page and shows what korbat knows of the address. A token travels in a POST's body,
 * never in an address.
 */
async function signedOutNotice(postId) {
  const notifier = `notifier-${randomUUID()}@korbat.local`;
  const notice = {
    ground: "illegal",
    category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
    explanation: "Sent by the smoke test: nothing is wrong with this post.",
    bonaFide: true,
    name: "Smoke Test",
    email: notifier,
    targets: [{ kind: "post", id: postId }],
    turnstileToken: TURNSTILE_TOKEN,
  };
  const sent = await withTurnstile("/api/notices", notice);
  const ref = sent.body?.ref;
  const token = sent.body?.token;
  if (!check("signed out, a notice of illegality is taken through the app's site: a reference and a token", sent.status === 201 && NOTICE_REF.test(ref ?? "") && typeof token === "string" && token.length === 43, sent.summary)) return;

  const status = await api("/api/notices/status", { json: { ref, token } });
  check("its status page opens with the token and shows the post's link, undecided", status.status === 200 && status.body?.ref === ref && onePostUndecided(status.body.items, postId), `${status.summary}, ${itemsSummary(status.body?.items)}`);
  // Opened with the notice's own token, the page says that a contact was given and nothing of what korbat knows about the address.
  const contact = status.body?.contact;
  check("the page says that a contact was given, and no more", contact?.given === true && contact.confirmed === null && contact.stopped === null, JSON.stringify(contact ?? null));
  const other = await api("/api/notices/status", { json: { ref, token: randomBytes(32).toString("base64url") } });
  check("another token finds no notice", other.status === 404 && other.body?.error?.code === "notice_not_found", other.summary);

  const receipt = await mailTo(notifier, `korbat received your report ${ref}`);
  if (!check("the receipt arrives in Mailpit under the notice's reference", receipt !== null && typeof receipt.Text === "string" && receipt.Text.includes(ref), receipt === null ? "no receipt within 30 s" : "a receipt without the reference")) return;
  // The mail's link carries the contact's mail token in its fragment, which no server log sees.
  const mailToken = /[/]notice[/]N-[A-Z2-7]{10}#t=([A-Za-z0-9_-]{43})/.exec(receipt.Text)?.[1];
  if (!check("the receipt links to the notice's page with a token of its own", typeof mailToken === "string" && mailToken !== token)) return;
  const byMail = await api("/api/notices/status", { json: { ref, token: mailToken } });
  const known = byMail.body?.contact;
  check(
    "the mail's token opens the same page, with the address not yet confirmed and not stopped",
    byMail.status === 200 && byMail.body?.ref === ref && onePostUndecided(byMail.body.items, postId) && known?.given === true && known.confirmed === false && known.stopped === false,
    `${byMail.summary}, ${JSON.stringify(known ?? null)}`,
  );
}

/**
 * A second account, since the first one's session is gone by now and a deleted account could not be
 * granted a role: the lifecycle of section 7 of the 1b design, end to end, on the bearer session. On its
 * way it reports the first account's post, and its export shows that report.
 */
async function accountLifecycle(reportedPostId) {
  const email = `lifecycle-${randomUUID()}@korbat.local`;
  const handle = `life_${randomBytes(4).toString("hex")}`;
  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("lifecycle: email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("lifecycle: sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("lifecycle: sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;
  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Lifecycle Test" }, token: complete.body.token });
  if (!check("lifecycle: onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;

  const edited = await api("/api/me/profile", { method: "PATCH", json: { bio: "Here for the smoke test." }, token });
  check("edit the bio", edited.status === 200 && edited.body?.profile?.bio === "Here for the smoke test.", edited.summary);
  const renamed = `${handle}_2`;
  const changed = await api("/api/me/handle", { json: { handle: renamed }, token });
  check("change the handle", changed.status === 200 && changed.body?.profile?.handle === renamed, changed.summary);
  const reportRef = await signedInReport(reportedPostId, token);
  const exported = await send("/api/account/export", { method: "POST", token });
  const zip = exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b;
  check("the export is a ZIP", exported.status === 200 && exported.headers.get("content-type") === "application/zip" && zip, `HTTP ${exported.status}, ${exported.headers.get("content-type")}, ${exported.bytes.length} bytes`);
  if (zip) exportedModeration(exported.bytes, reportRef, reportedPostId);
  const posted = await api("/api/posts", { json: { body: "a post that will not outlive its author" }, token });
  check("lifecycle: create a post", posted.status === 201 && typeof posted.body?.id === "string", posted.summary);

  const deletion = await api("/api/account/delete/start", { json: {}, token });
  if (!check("delete/start", deletion.status === 200 && typeof deletion.body?.flowId === "string", deletion.summary)) return;
  // The sign-up code email is still in the box, so the deletion code is picked by its subject.
  const code = await emailCode(email, "Confirm deleting your korbat account");
  const confirmed = await api("/api/account/delete/confirm", { json: { flowId: deletion.body.flowId, code, handle: renamed }, token });
  check("delete/confirm with the code from Mailpit and the handle typed", confirmed.status === 204, confirmed.summary);
  const profile = await api(`/api/profiles/${renamed}`);
  check("the deleted profile is not found", profile.status === 404 && profile.body?.error?.code === "not_found", profile.summary);
  const me = await api("/api/me", { token });
  check("the deleted account's session is gone", me.status === 401, me.summary);
  const latest = await api("/api/timeline/latest");
  check("its post has left the Latest timeline", Array.isArray(latest.body?.items) && !latest.body.items.some((item) => item.post?.id === posted.body?.id), latest.summary);
}

/** 3b (design, section 7.3): IMPORT_RULES.chunkBytes, the size of every chunk but an archive's last. */
const IMPORT_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Step 21's archive: what the Mastodon adapter reads (outbox.json, and the name of actor.json) and a file of 9 MiB it
 * never opens, so the upload takes two chunks. Four public Notes, one followers-only Note and one boost; the newest three
 * public ones are the samples. Nothing of it is a real person's: every name is the script's own.
 */
function mastodonArchive() {
  const actor = "https://smoke.korbat.test/users/smoke";
  const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
  const note = (n, to, published) => ({
    type: "Create",
    object: { type: "Note", id: `${actor}/statuses/${n}`, attributedTo: actor, published, to, cc: [], content: `<p>Smoke test post ${n}</p>` },
  });
  const outbox = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "OrderedCollection",
    orderedItems: [
      note(1, [PUBLIC], "2019-03-01T10:00:00Z"),
      note(2, [PUBLIC], "2019-03-02T10:00:00Z"),
      note(3, [`${actor}/followers`], "2019-03-03T10:00:00Z"),
      note(4, [PUBLIC], "2019-04-04T10:00:00Z"),
      { type: "Announce", object: `${actor}/statuses/1` },
      note(5, [PUBLIC], "2019-05-05T10:00:00Z"),
    ],
  };
  return zipSync(
    {
      "outbox.json": strToU8(JSON.stringify(outbox)),
      "actor.json": strToU8(JSON.stringify({ type: "Person", id: actor })),
      // Random bytes do not compress: stored, they make the archive larger than one chunk.
      "filler.bin": [new Uint8Array(randomBytes(9 * 1024 * 1024)), { level: 0 }],
    },
    { level: 6 },
  );
}

/** The importer's container: its memory limit, its restarts and its health. */
function importerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "importer"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.Health.Status}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), health: fields[2] };
}

/**
 * Reads an import every second while its state is one of `moving`, for at most two minutes, the scan's bound: import-drive
 * runs a round every five seconds, and the smoke archive's four posts are one batch. Answers the last view read.
 */
async function waitImport(id, token, moving) {
  let view = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    view = (await api(`/api/imports/${id}`, { token })).body;
    if (!moving.includes(view?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return view;
}

/** The posts of a profile's Imported tab, as [text, label] in the tab's order; null when the tab does not answer a page. */
async function importedTab(handle) {
  const tab = await api(`/api/profiles/${handle}/imported`);
  return Array.isArray(tab.body?.items) ? tab.body.items.map((post) => [post.body, post.imported]) : null;
}

/**
 * Step 21 (3b Tasks 4 and 8): an archive uploaded in chunks through Caddy and scanned by the real importer; the import
 * confirmed and published on the profile's Imported tab, then removed again with the person's own undo.
 */
async function importArchive(token) {
  const aged = inside("postgres", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "update public.profiles set created_at = now() - interval '8 days' where handle = '${handle}' returning 1"`);
  if (!check("3b: the account is aged past the import's seven days", aged.split(String.fromCharCode(10))[0] === "1", aged)) return;
  const archive = mastodonArchive();
  const created = await api("/api/imports", { json: { source: "mastodon", bytes: archive.length }, token });
  if (!check("3b: an import is created, uploading", created.status === 201 && created.body?.status === "uploading" && created.body?.chunkBytes === IMPORT_CHUNK_BYTES, created.summary)) return;
  const id = created.body.id;
  let received = 0;
  for (let at = 0; at < archive.length; at += IMPORT_CHUNK_BYTES) {
    const chunk = archive.subarray(at, Math.min(archive.length, at + IMPORT_CHUNK_BYTES));
    const res = await fetch(`${base}/api/imports/${id}/archive`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "import-offset": String(at), "import-chunk-sha256": createHash("sha256").update(chunk).digest("hex") },
      body: chunk,
    });
    const answer = await res.json().catch(() => null);
    if (!check(`3b: a chunk of ${chunk.length} bytes at ${at} is taken through Caddy`, res.status === 200 && answer?.receivedBytes === at + chunk.length, `HTTP ${res.status}${answer?.error?.code ? ` ${answer.error.code}` : ""}`)) return;
    received = answer.receivedBytes;
  }
  check("3b: the whole archive arrived, in more than one chunk", received === archive.length && archive.length > IMPORT_CHUNK_BYTES, `${received} of ${archive.length} bytes`);
  const view = await waitImport(id, token, ["uploading", "scanning"]);
  if (!check("3b: the importer's scan is read and the import is ready", view?.status === "ready", `${view?.status ?? "no answer"}${view?.failure ? ` ${view.failure}` : ""}`)) return;
  const scan = view.scan;
  check(
    "3b: its counts: four posts from March to May 2019, the followers-only post and the boost skipped",
    scan?.posts === 4 && scan.skipped?.not_public === 1 && scan.skipped?.repost === 1 && scan.first === "2019-03" && scan.last === "2019-05",
    JSON.stringify(scan),
  );
  check(
    "3b: its three samples, newest first, by day",
    isDeepStrictEqual(view.samples, [
      { at: "2019-05-05", text: "Smoke test post 5" },
      { at: "2019-04-04", text: "Smoke test post 4" },
      { at: "2019-03-02", text: "Smoke test post 2" },
    ]),
    JSON.stringify(view.samples),
  );
  check("3b: the archive was deleted once its scan was read", inside("api", `test -e /import/archives/jobs/${id} && echo present || echo gone`) === "gone");
  const importer = importerState();
  check("3b: the importer is healthy and has never restarted", importer.health === "healthy" && importer.restarts === 0, `${importer.health}, restarts ${importer.restarts}`);
  const interfaces = inside("importer", "ls -x /sys/class/net");
  check("3b: the importer has only a loopback interface", interfaces === "lo", interfaces);
  check("3b: the importer's memory limit is 512 MiB", importer.memory === 512 * 1024 * 1024, `${importer.memory} bytes`);

  // Task 8: the rest of the import. The profile's post count before it, which the four posts raise and the undo lowers again.
  const before = (await api(`/api/profiles/${handle}`)).body;
  check("3b: before the import the profile shows no Imported tab", before?.hasImported === false, JSON.stringify(before?.hasImported));
  // Every choice off or open, long posts left out (none is long), and the statement, without which nothing is confirmed.
  // Images are off in the stack (IMPORT_IMAGES needs a matcher), so the confirmation goes straight to publishing.
  const choice = { from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" };
  const confirmed = await api(`/api/imports/${id}/confirm`, { json: { choice, statement: true }, token });
  if (!check("3b: the import is confirmed with the statement and publishes", confirmed.status === 200 && ["publishing", "done"].includes(confirmed.body?.status), `${confirmed.summary} ${confirmed.body?.status ?? ""}`)) return;
  const done = await waitImport(id, token, ["publishing"]);
  if (!check("3b: import-drive publishes the four posts and the import is done", done?.status === "done" && done.progress?.postsPublished === 4, `${done?.status ?? "no answer"}, ${done?.progress?.postsPublished ?? "?"} published`)) return;
  const label = (at) => ({ source: "mastodon", at, shortened: false });
  const published = [
    ["Smoke test post 5", label("2019-05-05")],
    ["Smoke test post 4", label("2019-04-04")],
    ["Smoke test post 2", label("2019-03-02")],
    ["Smoke test post 1", label("2019-03-01")],
  ];
  const tab = await importedTab(handle);
  check("3b: the Imported tab holds the four posts, newest first by the archive's day, each imported from Mastodon on its day", isDeepStrictEqual(tab, published), JSON.stringify(tab));
  const shown = (await api(`/api/profiles/${handle}`)).body;
  check("3b: the profile shows its Imported tab and counts four more posts", shown?.hasImported === true && shown.counts?.posts === before?.counts?.posts + 4, `hasImported ${shown?.hasImported}, ${before?.counts?.posts} then ${shown?.counts?.posts} posts`);
  const latest = await api("/api/timeline/latest");
  const leaked = Array.isArray(latest.body?.items) ? latest.body.items.filter((item) => item.post?.imported != null || published.some(([text]) => item.post?.body === text)).length : -1;
  check("3b: Latest holds none of the imported posts", leaked === 0, `${latest.summary}, ${leaked} imported`);

  const undo = await api(`/api/imports/${id}/undo`, { method: "POST", token });
  if (!check("3b: Remove imported posts is taken", undo.status === 200 && ["undoing", "undone"].includes(undo.body?.status), `${undo.summary} ${undo.body?.status ?? ""}`)) return;
  const undone = await waitImport(id, token, ["undoing"]);
  check("3b: import-drive removes the four posts and the import is undone", undone?.status === "undone" && undone.progress?.postsRemoved === 4, `${undone?.status ?? "no answer"}, ${undone?.progress?.postsRemoved ?? "?"} removed`);
  const emptied = await importedTab(handle);
  check("3b: the Imported tab is empty again", Array.isArray(emptied) && emptied.length === 0, JSON.stringify(emptied));
  const after = (await api(`/api/profiles/${handle}`)).body;
  check("3b: the profile no longer shows the tab and counts its posts as before", after?.hasImported === false && after.counts?.posts === before?.counts?.posts, `hasImported ${after?.hasImported}, ${after?.counts?.posts} posts`);
}

async function main() {
  if (closed) return closedSite();
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  await consoleSite();
  if (pushBase) await pushSite();
  await explore();
  await publicPages();

  const unknown = await withTurnstile("/api/auth/password/signin", { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Smoke Test" }, token: complete.body.token });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);
  // Account sanctions (3e design, section 12.2): an onboarded account's standing, read fresh, holds no strike, no
  // measure, no restriction of reporting and no retired handle. A suspension needs a staff key: the walk-through's.
  const noStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };
  check("/api/me carries the new account's standing: no strike, no measure, no restriction", isDeepStrictEqual(me.body?.standing, noStanding), JSON.stringify(me.body?.standing));

  const created = await api("/api/posts", { json: { body: "smoke test post" }, token });
  check("create a post", created.status === 201 && typeof created.body?.id === "string", created.summary);
  const latest = await api("/api/timeline/latest");
  check("the post appears in the public Latest timeline", Array.isArray(latest.body?.items) && latest.body.items.some((item) => item.post?.id === created.body?.id), latest.summary);
  const profile = await api(`/api/profiles/${handle}`);
  check("the profile counts one post", profile.body?.counts?.posts === 1, profile.summary);
  await appShell(created.body?.id);

  await images(token);
  // 2d Task 3 (step 22): the account's picture, on its post made above.
  await avatar(token, created.body?.id);
  // 2d Task 6 (step 23): the post's and the profile's share cards, previews off and on, before the token dies at grant-role.
  await cards(token, created.body?.id);
  if (worstCase) await worstCaseImages(token);
  await importArchive(token);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);

  // The post both the signed-in report and the signed-out notice name: the first account's, which is still there.
  const reportedPostId = created.body?.id;
  if (!check("the first account's post can be reported", typeof reportedPostId === "string")) return;
  await accountLifecycle(reportedPostId);
  await signedOutNotice(reportedPostId);
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
// With --closed the run is a few requests long, and Node on Windows aborts (a libuv assertion, exit 127) when the process
// is ended while fetch's idle connections are still closing. So that run sets its code and ends when they have closed,
// a few seconds later; the full run, which holds other handles open, ends here as before.
if (closed) process.exitCode = failures === 0 ? 0 : 1;
else process.exit(failures === 0 ? 0 : 1);
