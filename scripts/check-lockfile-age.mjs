#!/usr/bin/env node
/**
 * Fails when pnpm-lock.yaml gained a package version younger than the workspace's minimumReleaseAge.
 *
 * Why this exists: pnpm re-checks the age of the whole dependency graph on `pnpm add`, so while any
 * existing lock is younger than the floor (for example right after an Expo SDK release) every
 * dependency change fails. The safe workaround is to add the dependency with the age check disabled
 * for that one command and then prove with this script that nothing newly locked is too young.
 *
 * Usage: node scripts/check-lockfile-age.mjs [--base <git ref>]   (default base: HEAD)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "HEAD";

const workspace = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
const minutes = Number(/^minimumReleaseAge:\s*(\d+)\s*$/m.exec(workspace)?.[1] ?? "0");
if (!minutes) {
  console.log("minimumReleaseAge is not set; nothing to check");
  process.exit(0);
}

/** `name@version` for every entry in the lockfile's `packages:` section. */
function lockedVersions(text) {
  const section = text.split("\npackages:\n")[1]?.split("\nsnapshots:\n")[0] ?? "";
  return new Set([...section.matchAll(/^ {2}'?(@?[^@\s']+@[^:'()\s]+)'?:\s*$/gm)].map((m) => m[1]));
}

const current = lockedVersions(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"));
const previous = lockedVersions(execFileSync("git", ["show", `${base}:pnpm-lock.yaml`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const added = [...current].filter((entry) => !previous.has(entry)).sort();

const now = Date.now();
const floorMs = minutes * 60_000;

async function publishedAt(entry) {
  const at = entry.lastIndexOf("@");
  const name = entry.slice(0, at);
  const version = entry.slice(at + 1);
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`registry returned ${res.status} for ${name}`);
  const iso = (await res.json()).time?.[version];
  if (!iso) throw new Error(`no publish time for ${entry}`);
  return { entry, published: Date.parse(iso) };
}

const results = [];
for (let i = 0; i < added.length; i += 16) {
  results.push(...(await Promise.all(added.slice(i, i + 16).map(publishedAt))));
}

const tooYoung = results.filter((r) => now - r.published < floorMs);
const days = (minutes / 1440).toFixed(minutes % 1440 ? 1 : 0);
if (tooYoung.length > 0) {
  console.error(`${tooYoung.length} of ${added.length} new package versions are younger than ${days} days:`);
  for (const r of tooYoung) console.error(`  ${r.entry} (published ${new Date(r.published).toISOString()})`);
  process.exit(1);
}
console.log(`${added.length} new package versions since ${base}; all at least ${days} days old`);
