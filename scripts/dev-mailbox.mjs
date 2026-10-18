#!/usr/bin/env node
/**
 * The development mailbox (3f design, sections 5 and 12): a stand-in for the contact point's mail host, so that the
 * watcher can run on this machine (`pnpm --filter @korbat/api notify:dev`) without a real mailbox. It is the test fixture
 * fakeImap (apps/api/test/notify/fake-imap.ts), which Node loads with its own type stripping, with a second caller:
 * an IMAP server over TLS on 127.0.0.1 with an inbox and a junk folder, the account `watcher` with the password
 * `dev-mailbox`, and a key and a certificate it makes into .data/dev-mailbox/ on its first run. The certificate is its
 * own authority: the watcher trusts it through NOTIFY_IMAP_CA, which production refuses.
 *
 * It takes "drop a message" on standard input, one line each:
 *   inbox (or an empty line)   a message delivered to the inbox now
 *   junk                       a message delivered to the junk folder now
 *   old <n>                    n messages delivered three days ago to the inbox, for the watcher's first read
 *
 * Every start is a new mailbox: its folders get a new UIDVALIDITY, so the watcher reads them whole. Nothing a message
 * holds exists: the watcher asks for two numbers a message and nothing else.
 *
 * Usage, from the repo root: node scripts/dev-mailbox.mjs [--port <n>]   (default 51993, as apps/api/.env.example says)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { fakeImap, makeCertificate } from "../apps/api/test/notify/fake-imap.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, ".data/dev-mailbox");
const argv = process.argv.slice(2);
const portAt = argv.indexOf("--port");
const port = portAt === -1 ? 51993 : Number(argv[portAt + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("usage: node scripts/dev-mailbox.mjs [--port <n>]");
  process.exit(2);
}

// The key and the certificate, made once and kept: the watcher's NOTIFY_IMAP_CA names the certificate's file.
mkdirSync(dir, { recursive: true });
const keyFile = resolve(dir, "key.pem");
const caFile = resolve(dir, "ca.pem");
if (!existsSync(keyFile) || !existsSync(caFile)) {
  const made = makeCertificate();
  writeFileSync(keyFile, made.key, { mode: 0o600 });
  writeFileSync(caFile, made.cert);
  console.log("dev-mailbox: made a key and a certificate for localhost in .data/dev-mailbox");
}
const tls = { key: readFileSync(keyFile, "utf8"), cert: readFileSync(caFile, "utf8") };

const validity = Math.floor(Date.now() / 1000);
const folders = new Map([
  ["INBOX", { uidValidity: validity, messages: [] }],
  ["Junk", { uidValidity: validity + 1, messages: [] }],
]);
const server = await fakeImap({ user: "watcher", password: "dev-mailbox", folders, tls, port });
console.log(`dev-mailbox: listening on localhost:${server.port} (IMAP over TLS), user watcher; certificate authority .data/dev-mailbox/ca.pem`);
console.log("dev-mailbox: type inbox, junk or old <n> and Enter to drop messages; Ctrl+C to stop");

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const words = line.trim().split(" ").filter((word) => word !== "");
  if (words.length === 0 || words[0] === "inbox" || words[0] === "junk") {
    const folder = words[0] === "junk" ? "Junk" : "INBOX";
    const message = server.drop(folder);
    console.log(`dev-mailbox: dropped UID ${message.uid} into ${folder} at ${message.internalDate.toISOString()}`);
    return;
  }
  if (words[0] === "old" && /^[0-9]+$/.test(words[1] ?? "")) {
    const count = Number(words[1]);
    const at = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    for (let i = 0; i < count; i++) server.drop("INBOX", new Date(at.getTime() + i * 1000));
    console.log(`dev-mailbox: dropped ${count} messages of three days ago into INBOX`);
    return;
  }
  console.log("dev-mailbox: inbox, junk or old <n>");
});
lines.on("close", () => {
  // Standard input ended (a pipe that closed): the mailbox keeps serving until it is stopped.
});
const stop = () => {
  void server.close().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
