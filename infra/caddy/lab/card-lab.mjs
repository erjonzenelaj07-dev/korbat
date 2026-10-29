#!/usr/bin/env node
/**
 * The card lab (2d design, sections 8.2 and 12.4): korbat's Caddy image, as built from infra/caddy/Dockerfile, started
 * beside a stub API of a few lines (Caddy itself, from the same image) that answers the card routes with 204 and a block,
 * 404, 429, or not at all, and asked for every page of 8.2 from this machine and from the push network. It asserts:
 *   - `caddy list-modules` lists http.handlers.templates, and card.html holds the one template action once;
 *   - each page's status and bytes: card.html with the block decoded once in its head for 204, the plain shell with 404
 *     for 404, with 200 for a 429 and for an API that does not answer (handle_errors), for a post's page and a profile's;
 *   - a block holding {{ .Env }} and {{env "HOME"}} is written out as text, never evaluated;
 *   - /card.html asked by its own path answers 404; robots.txt is infra/caddy/robots.txt, byte for byte;
 *   - X-Robots-Tag on /post/, /u/, /settings/appearance and a handle_errors answer, absent on /, /rules, /transparency,
 *     /explore/about and /terms;
 *   - a client on the push network is answered 403 on /u/x;
 *   - each crawler of crawlers.json gets the same answer for both pages, whatever its User-Agent, a ranged request a whole
 *     200 (never 206), with the Open Graph tags within the first 524,288 bytes and before <title>, which is "korbat".
 * It prints its measurements and "card lab passed", or each failed check and exits 1.
 *
 * Every image, network and container it makes is named with --prefix and removed at its end; it touches nothing else.
 * Without --image it builds the image itself (the web export runs inside, which takes minutes); with --image it uses one
 * already built, the stack's korbat2b-caddy for one.
 *
 * Usage, from the repo root:
 *   node infra/caddy/lab/card-lab.mjs --prefix korbat-cardlab [--image <built caddy image>] [--port 18381]
 *     [--push-subnet 172.16.193.0/24]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};
const prefix = option("prefix");
const givenImage = option("image");
const port = Number(option("port", "18381"));
const pushSubnet = option("push-subnet", "172.16.193.0/24");
if (!prefix || !/^[a-z0-9][a-z0-9-]*$/.test(prefix) || !Number.isInteger(port)) {
  console.error("usage: node infra/caddy/lab/card-lab.mjs --prefix <name> [--image <image>] [--port <port>] [--push-subnet <cidr>]");
  process.exit(2);
}

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const LF = String.fromCharCode(10);
const ACTION = '{{placeholder "http.reverse_proxy.header.Korbat-Card" | b64dec}}';
const names = { image: givenImage ?? `${prefix}-caddy`, app: `${prefix}-app`, push: `${prefix}-push`, api: `${prefix}-api`, caddy: `${prefix}-caddy`, client: `${prefix}-client` };
const made = { image: false, networks: [], containers: [] };
const measured = {};
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...options });
}

/** A docker command whose failure is an answer, not an error: its status and both outputs. */
function dockerTry(args) {
  const run = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** Removes what the lab made, containers first, and nothing else; each removal is tried whatever the others did. */
function cleanup() {
  for (const name of made.containers.reverse()) dockerTry(["rm", "-f", name]);
  for (const name of made.networks.reverse()) dockerTry(["network", "rm", name]);
  if (made.image) dockerTry(["image", "rm", "-f", names.image]);
}

/** One request to the lab's Caddy, as a fetcher sends it: no cookie, the headers given, the body decoded as sent. */
function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = request({ host: "127.0.0.1", port, path: pathname, method: "GET", headers: { Host: "localhost", ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const encoding = res.headers["content-encoding"];
        const body = encoding === "gzip" ? gunzipSync(raw) : encoding === "deflate" ? inflateSync(raw) : raw;
        resolve({ status: res.statusCode, headers: res.headers, raw, body, ms: Number(process.hrtime.bigint() - started) / 1e6 });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/** Waits until the lab's Caddy answers /, for at most thirty seconds. */
async function ready() {
  const until = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await get("/")).status === 200) return true;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** A docker command's standard output as bytes, for files read out of the image. */
function dockerBytes(args) {
  return execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

/** A four-byte character (U+1F600), so the block holds UTF-8 that base64 and b64dec must carry whole. */
const WIDE = String.fromCodePoint(0x1f600);
/** The lab Caddy's HOME, which the block's {{env "HOME"}} would print if anything evaluated it. */
const HOME = `/home/cardlab-${randomBytes(6).toString("hex")}`;

/**
 * The stub's two blocks. Unlike a block the API builds, these keep the template delimiters as they are, so the lab proves
 * that Caddy prints a block as text even when nothing escaped it. The profile's is near the API's bound of 4,096 bytes.
 */
const POST_BLOCK = [
  '<meta name="robots" content="noindex" />',
  '<meta property="og:site_name" content="korbat" />',
  '<meta property="og:type" content="article" />',
  '<meta property="og:url" content="https://korbat.example/post/card" />',
  `<meta property="og:title" content="Card Lab ${WIDE} (@card_lab)" />`,
  `<meta property="og:description" content='{{ .Env }} and {{env "HOME"}} stay text' />`,
  '<meta property="article:published_time" content="2026-10-29T12:00:00.000Z" />',
  '<meta name="twitter:card" content="summary" />',
].join(LF);
function profileBlock() {
  const lines = (fill) => [
    '<meta name="robots" content="noindex" />',
    '<meta property="og:site_name" content="korbat" />',
    '<meta property="og:type" content="profile" />',
    '<meta property="og:url" content="https://korbat.example/u/card_lab" />',
    '<meta property="og:title" content="Card Lab (@card_lab)" />',
    `<meta property="og:description" content="${fill}" />`,
    '<meta property="profile:username" content="card_lab" />',
    '<meta name="twitter:card" content="summary" />',
  ];
  let fill = "";
  while (Buffer.byteLength(lines(fill + WIDE).join(LF), "utf8") <= 4096) fill += WIDE;
  return lines(fill).join(LF);
}
const PROFILE_BLOCK = profileBlock();

/** The stub API: Caddy answering the card routes as the API would, 204 with a block, 404, 429, or by dropping the connection. */
function stubCaddyfile() {
  const b64 = (block) => Buffer.from(block, "utf8").toString("base64");
  return [
    "{",
    "  admin off",
    "  auto_https off",
    "}",
    ":3000 {",
    "  @post_card path /api/cards/post/card",
    "  handle @post_card {",
    `    header Korbat-Card "${b64(POST_BLOCK)}"`,
    "    respond 204",
    "  }",
    "  @profile_card path /api/cards/profile/card",
    "  handle @profile_card {",
    `    header Korbat-Card "${b64(PROFILE_BLOCK)}"`,
    "    respond 204",
    "  }",
    "  @limited path /api/cards/post/limited /api/cards/profile/limited",
    "  handle @limited {",
    "    respond 429",
    "  }",
    "  @silent path /api/cards/post/silent /api/cards/profile/silent",
    "  handle @silent {",
    "    abort",
    "  }",
    "  handle {",
    "    respond 404",
    "  }",
    "}",
    "",
  ].join(LF);
}

async function main() {
  const work = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  try {
    if (!givenImage) {
      console.log(`building ${names.image} from infra/caddy/Dockerfile (the web export runs inside: minutes)`);
      made.image = true;
      execFileSync(
        "docker",
        ["build", "-f", "infra/caddy/Dockerfile", "-t", names.image, "--build-arg", "EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA", "--build-arg", "EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat.local", "--build-arg", "KORBAT_ENV=development", "."],
        { cwd: REPO, stdio: ["ignore", "inherit", "inherit"] },
      );
    }
    measured.caddy = docker(["run", "--rm", "--name", `${prefix}-version`, names.image, "caddy", "version"]).trim();
    const modules = docker(["run", "--rm", "--name", `${prefix}-modules`, names.image, "caddy", "list-modules"]);
    check("caddy list-modules lists http.handlers.templates", modules.split(LF).some((line) => line.trim() === "http.handlers.templates"));
    const shell = dockerBytes(["run", "--rm", "--name", `${prefix}-shell`, names.image, "cat", "/srv/index.html"]);
    const card = dockerBytes(["run", "--rm", "--name", `${prefix}-card`, names.image, "cat", "/srv/card.html"]).toString("utf8");
    const cardLines = card.split(LF);
    const at = cardLines.findIndex((line) => line.trim() === ACTION);
    check(
      "card.html holds the template action once, on the line after the charset's meta element, and no other {{",
      at > 0 && cardLines[at - 1].trim() === '<meta charset="utf-8" />' && card.split("{{").length === 2 && card.replace(`${cardLines[at]}${LF}`, "") === shell.toString("utf8"),
      `line ${at + 1}`,
    );
    const robotsFile = readFileSync(path.join(REPO, "infra", "caddy", "robots.txt"));
    check("the image's /srv/robots.txt is infra/caddy/robots.txt", dockerBytes(["run", "--rm", "--name", `${prefix}-robots`, names.image, "cat", "/srv/robots.txt"]).equals(robotsFile));

    const stub = path.join(work, "Caddyfile");
    writeFileSync(stub, stubCaddyfile());
    docker(["network", "create", names.app]);
    made.networks.push(names.app);
    docker(["network", "create", "--subnet", pushSubnet, names.push]);
    made.networks.push(names.push);
    made.containers.push(names.api);
    docker(["create", "--name", names.api, "--network", names.app, "--network-alias", "api", names.image]);
    docker(["cp", stub, `${names.api}:/etc/caddy/Caddyfile`]);
    docker(["start", names.api]);
    made.containers.push(names.caddy);
    docker(["create", "--name", names.caddy, "--network", names.app, "-p", `127.0.0.1:${port}:8080`, "-e", `PUSH_SUBNET=${pushSubnet}`, "-e", `HOME=${HOME}`, names.image]);
    docker(["network", "connect", names.push, names.caddy]);
    docker(["start", names.caddy]);
    if (!check("the lab's Caddy answers on its port", await ready())) return;
    await pages(shell, card, robotsFile);
    await crawlersOn(shell);
    pushNetwork();
  } finally {
    cleanup();
    rmSync(work, { recursive: true, force: true });
  }
}

/** card.html as Caddy should serve it for a block: the action's line holding the block, decoded, in the action's place. */
const served = (card, block) => card.replace(ACTION, block);

/** Every page of 8.2: statuses, bytes, the evaluation that never happens, /card.html, robots.txt and X-Robots-Tag. */
async function pages(shell, card, robotsFile) {
  const root = await get("/");
  for (const [page, block] of [
    ["/post/card", POST_BLOCK],
    ["/u/card", PROFILE_BLOCK],
  ]) {
    const res = await get(page);
    const text = res.body.toString("utf8");
    check(`${page}: 204 gives card.html with 200, the block decoded once in its head`, res.status === 200 && text === served(card, block) && text.split(block).length === 2, `HTTP ${res.status}, ${res.body.length} bytes`);
    check(`${page}: the header itself never reaches the client`, res.headers["korbat-card"] === undefined);
    check(`${page}: no-cache, noindex, and the shell's security headers`, res.headers["cache-control"] === "no-cache" && res.headers["x-robots-tag"] === "noindex" && res.headers["content-security-policy"] === root.headers["content-security-policy"] && root.headers["content-security-policy"] !== undefined);
    measured[`${page} bytes`] = res.body.length;
  }
  const evaluated = (await get("/post/card")).body.toString("utf8");
  check(`a block holding {{ .Env }} and {{env "HOME"}} is written out as text, never evaluated`, evaluated.includes('{{ .Env }} and {{env "HOME"}} stay text') && !evaluated.includes(HOME) && !evaluated.includes("PUSH_SUBNET") && !evaluated.includes(pushSubnet));
  check("the block's four-byte character survives base64 and b64dec", evaluated.includes(`Card Lab ${WIDE} (@card_lab)`));
  measured["profile block bytes"] = Buffer.byteLength(PROFILE_BLOCK, "utf8");
  measured["profile header bytes (base64)"] = Buffer.from(PROFILE_BLOCK, "utf8").toString("base64").length;

  for (const [page, status, why] of [
    ["/post/none", 404, "404 gives the plain shell with 404"],
    ["/u/none", 404, "404 gives the plain shell with 404"],
    ["/post/limited", 200, "a 429 of the global limit gives the plain shell with 200"],
    ["/u/limited", 200, "a 429 of the global limit gives the plain shell with 200"],
    ["/post/silent", 200, "an API that does not answer gives the plain shell with 200 (handle_errors)"],
    ["/u/silent", 200, "an API that does not answer gives the plain shell with 200 (handle_errors)"],
  ]) {
    const res = await get(page);
    check(`${page}: ${why}`, res.status === status && res.body.equals(shell), `HTTP ${res.status}, ${res.body.length} bytes`);
  }
  const direct = await get("/card.html");
  check("/card.html asked by its own path answers 404 with no body", direct.status === 404 && direct.body.length === 0, `HTTP ${direct.status}, ${direct.body.length} bytes`);
  const robots = await get("/robots.txt");
  check("robots.txt is infra/caddy/robots.txt, byte for byte", robots.status === 200 && robots.body.equals(robotsFile), `HTTP ${robots.status}, ${robots.headers["content-type"]}`);
  measured["robots.txt bytes"] = robots.body.length;

  for (const page of ["/post/card", "/u/card", "/post/none", "/settings/appearance", "/post/silent", "/u/silent"]) {
    const res = await get(page);
    check(`X-Robots-Tag: noindex on ${page}`, res.headers["x-robots-tag"] === "noindex", String(res.headers["x-robots-tag"]));
  }
  for (const page of ["/", "/rules", "/transparency", "/explore/about", "/terms"]) {
    const res = await get(page);
    check(`no X-Robots-Tag on ${page}`, res.status === 200 && res.headers["x-robots-tag"] === undefined, String(res.headers["x-robots-tag"]));
  }
}

/** Each crawler of crawlers.json on both pages: the same answer for every User-Agent, whole, the tags early and before <title>. */
async function crawlersOn(shell) {
  const { crawlers } = JSON.parse(readFileSync(path.join(REPO, "infra", "caddy", "lab", "crawlers.json"), "utf8"));
  check("crawlers.json holds six fetchers, none with a cookie", crawlers.length === 6 && crawlers.every((crawler) => !Object.keys(crawler.headers).some((name) => name.toLowerCase() === "cookie")));
  const times = [];
  for (const page of ["/post/card", "/u/card"]) {
    const plain = await get(page);
    for (const crawler of crawlers) {
      const res = await get(page, crawler.headers);
      times.push(res.ms);
      check(`${crawler.name} on ${page}: a whole 200, the same page as anyone gets`, res.status === 200 && res.headers["content-range"] === undefined && res.body.equals(plain.body), `HTTP ${res.status}, ${res.headers["content-encoding"] ?? "identity"}`);
      const text = res.body.toString("utf8");
      const last = Math.max(text.lastIndexOf('property="og:'), text.lastIndexOf('name="twitter:'));
      const tagsEnd = Buffer.byteLength(text.slice(0, text.indexOf(LF, last)), "utf8");
      const title = Buffer.byteLength(text.slice(0, text.indexOf("<title>")), "utf8");
      const titles = text.match(/<title>[^<]*<[/]title>/g) ?? [];
      check(`${crawler.name} on ${page}: the Open Graph tags end at byte ${tagsEnd}, within 524,288 and before <title>, which is korbat`, last > 0 && tagsEnd <= 524_288 && tagsEnd < title && titles.length === 1 && titles[0] === "<title>korbat</title>");
      if (crawler.name === "Twitterbot") {
        measured[`${page} tags end at byte`] = tagsEnd;
        measured[`${page} <title> at byte`] = title;
        measured[`${page} gzip bytes on the wire`] = res.raw.length;
      }
    }
  }
  measured["shell bytes"] = shell.length;
  measured["crawler requests"] = times.length;
  measured["crawler request ms (median, max)"] = [times.sort((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(1), times.at(-1).toFixed(1)].join(", ");
}

/** A client on the push network, which the app's site refuses with 403 first in every handle. */
function pushNetwork() {
  const answers = {};
  for (const page of ["/u/x", "/post/x"]) {
    const run = dockerTry(["run", "--rm", "--name", names.client, "--network", names.push, names.image, "wget", "-T", "10", "-S", "-O", "/dev/null", `http://${names.caddy}:8080${page}`]);
    answers[page] = /HTTP[/]1[.]1 403/.test(run.stderr);
  }
  check("a client on the push network is answered 403 on /u/x and /post/x", answers["/u/x"] && answers["/post/x"], JSON.stringify(answers));
}

try {
  await main();
} catch (err) {
  check("the card lab ran to its end", false, err instanceof Error ? err.message : String(err));
}
console.log(`measurements: ${JSON.stringify(measured, null, 2)}`);
console.log(failures === 0 ? "card lab passed" : `card lab FAILED: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
