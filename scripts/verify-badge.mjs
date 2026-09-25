#!/usr/bin/env node
/**
 * Live check of the verification provider behind the verified badge (1b design, section 13, step 3).
 *
 * Reads VERIFY_PROVIDER, VONAGE_API_KEY, VONAGE_API_SECRET and VERIFY_BRAND from apps/api/.env, refuses
 * to run unless the provider is vonage, starts a verification for the number given on the command line
 * with the same two requests the adapter (apps/api/src/auth/verify/vonage.ts) sends, asks for the code
 * from the text on standard input and prints the provider's answer with its status code. No account is
 * touched and nothing is written: the first run proves the credentials, the brand and the route to that
 * country. The requests are repeated here on purpose, so the script needs no build step.
 *
 * Values from .env are never printed.
 *
 * Usage, from the repo root:
 *   node scripts/verify-badge.mjs +447911123456
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERIFY_URL = "https://api.nexmo.com/v2/verify";
const TIMEOUT_MS = 10_000;
/** E.164 as the Phone contract accepts it once spaces, hyphens and parentheses are dropped: a plus and 7 to 15 digits, the first not zero. */
const E164 = /^\+[1-9][0-9]{6,14}$/;
const LINE = /^([A-Z0-9_]+)=(.*)$/;

function usage() {
  console.error("usage: node scripts/verify-badge.mjs <phone number in E.164, such as +447911123456>");
  console.error("Needs VERIFY_PROVIDER=vonage with VONAGE_API_KEY and VONAGE_API_SECRET in apps/api/.env. Touches no account.");
  process.exit(2);
}
function stop(message) {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.length !== 1) usage();
const phone = argv[0].replace(/[\s()-]/g, "");
if (!E164.test(phone)) usage();

/** apps/api/.env as scripts/gen-dev-env.mjs reads it: NAME=value lines and nothing else, kept in memory only. */
function parse(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}
const envPath = resolve(root, "apps/api/.env");
if (!existsSync(envPath)) stop("apps/api/.env is missing. Run `node scripts/gen-dev-env.mjs`, then set the Vonage values by hand.");
const env = parse(readFileSync(envPath, "utf8"));
/** A value wrapped in double quotes, as MAIL_FROM is, is read without them, the way the API's own loader reads the file. */
const value = (name) => (env.get(name) ?? "").trim().replace(/^"(.*)"$/, "$1");

if ((value("VERIFY_PROVIDER") || "off") !== "vonage") {
  stop("VERIFY_PROVIDER in apps/api/.env is not vonage; this check only runs against vonage. The dev provider needs no check: it accepts 000000.");
}
const apiKey = value("VONAGE_API_KEY");
const apiSecret = value("VONAGE_API_SECRET");
const brand = value("VERIFY_BRAND") || "korbat";
if (!apiKey || !apiSecret) stop("VONAGE_API_KEY and VONAGE_API_SECRET must both be set in apps/api/.env.");
if (brand.length > 18 || /[/{}:$]/.test(brand)) stop("VERIFY_BRAND must be 1 to 18 characters without / { } : or $.");

const headers = {
  authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
  "content-type": "application/json",
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** One POST as the adapter sends it. The status and the body are printed as they came; they never carry the credentials. */
async function post(url, body, what) {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((err) =>
    stop(`${what}: no answer from ${url} within ${TIMEOUT_MS / 1000} seconds: ${err?.cause?.message ?? err?.message ?? err}`),
  );
  const text = await res.text();
  console.log(`${what}: HTTP ${res.status}${text ? ` ${text}` : ""}`);
  return { status: res.status, body: parseJson(text) };
}

console.log(`Starting a verification for ${phone} with the configured brand...`);
const started = await post(VERIFY_URL, { brand, workflow: [{ channel: "sms", to: phone }], code_length: 6 }, "start");
if (started.status !== 201 || typeof started.body?.request_id !== "string") {
  stop("The adapter answers verify_unavailable to this: the credentials, the brand or the route to that country need attention.");
}
const reference = started.body.request_id;

const rl = createInterface({ input: stdin, output: stdout });
const code = (await rl.question("Code from the text message (6 digits): ")).trim();
rl.close();
if (!/^\d{6}$/.test(code)) stop("A code is six digits; nothing was checked.");

const checked = await post(`${VERIFY_URL}/${encodeURIComponent(reference)}`, { code }, "check");
let meaning;
if (checked.status === 200) meaning = checked.body?.status === "completed" ? "verified" : "verify_unavailable (a 200 without a completed status)";
else if (checked.status === 400) meaning = "invalid_code";
else if (checked.status === 410) meaning = "code_expired";
else meaning = "verify_unavailable (the adapter treats this answer as the provider being unreachable)";
console.log(`The adapter would answer: ${meaning}`);
