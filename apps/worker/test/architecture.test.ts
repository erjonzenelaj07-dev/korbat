import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The worker runs the image decoder, the most exploitable code in korbat. It is built so that a
 * compromise reaches two directories and nothing else. These rules keep it that way: no database,
 * no queue, no network client, no child processes, and the decoder behind one file.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const ALLOWED_DEPENDENCIES = ["@korbat/contracts", "@korbat/media-protocol", "blurhash", "pino", "sharp", "zod"];
const FORBIDDEN_IMPORTS = [
  /^node:(net|tls|http|https|http2|dgram|dns|child_process|cluster|worker_threads|inspector)$/,
  /^(net|tls|http|https|http2|dgram|dns|child_process|cluster|worker_threads|inspector)$/,
  /^@korbat\/db(\/|$)/,
  /^(ioredis|redis|postgres|pg|drizzle-orm|undici|axios|node-fetch|nodemailer|ws)(\/|$)/,
];
const FORBIDDEN_GLOBALS = /\b(fetch|WebSocket|XMLHttpRequest|EventSource)\s*\(/;

export interface SourceFile {
  path: string;
  source: string;
}

const importsOf = (source: string): string[] =>
  [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]!);

export function violations(files: SourceFile[], dependencies: string[]): string[] {
  const found: string[] = [];
  for (const name of dependencies) if (!ALLOWED_DEPENDENCIES.includes(name)) found.push(`package.json: depends on ${name}`);
  for (const file of files) {
    for (const specifier of importsOf(file.source)) {
      if (FORBIDDEN_IMPORTS.some((rule) => rule.test(specifier))) found.push(`${file.path}: imports ${specifier}`);
      if (specifier === "sharp" && file.path !== "pipeline.ts") found.push(`${file.path}: imports sharp, which only pipeline.ts may do`);
    }
    if (FORBIDDEN_GLOBALS.test(file.source)) found.push(`${file.path}: uses a network global`);
  }
  return found;
}

function sourceFiles(dir: string, prefix = ""): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sourceFiles(path.join(dir, entry.name), rel);
    return entry.name.endsWith(".ts") ? [{ path: rel, source: readFileSync(path.join(dir, entry.name), "utf8") }] : [];
  });
}

describe("worker isolation", () => {
  test("the real source tree and package.json have no violations", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(violations(sourceFiles(path.join(ROOT, "src")), Object.keys(manifest.dependencies ?? {}))).toEqual([]);
  });

  test("a database, queue or network dependency is a violation", () => {
    expect(violations([], ["sharp", "ioredis", "@korbat/db"])).toEqual(["package.json: depends on ioredis", "package.json: depends on @korbat/db"]);
  });

  test("network modules, child processes and network globals are violations", () => {
    const files = [
      { path: "a.ts", source: 'import net from "node:net";' },
      { path: "b.ts", source: "const { exec } = require('child_process');" },
      { path: "c.ts", source: 'const https = await import("https");' },
      { path: "d.ts", source: 'await fetch("https://example.com/beacon");' },
      { path: "e.ts", source: 'import { createDb } from "@korbat/db";' },
      { path: "ok.ts", source: 'import path from "node:path";\nimport { readFile } from "node:fs/promises";' },
    ];
    expect(violations(files, [])).toEqual([
      "a.ts: imports node:net",
      "b.ts: imports child_process",
      "c.ts: imports https",
      "d.ts: uses a network global",
      "e.ts: imports @korbat/db",
    ]);
  });

  test("only pipeline.ts may import the decoder", () => {
    expect(violations([{ path: "loop.ts", source: 'import sharp from "sharp";' }], [])).toEqual(["loop.ts: imports sharp, which only pipeline.ts may do"]);
    expect(violations([{ path: "pipeline.ts", source: 'import sharp from "sharp";' }], [])).toEqual([]);
  });
});
