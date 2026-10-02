import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { describe, expect, test } from "vitest";

/**
 * What the console's source must never hold (3a design, sections 3 and 9, and console-lab.md section 8). The page runs
 * under require-trusted-types-for 'script' with trusted-types 'none', so each of these sinks would throw at run time and
 * take its screen down; this scan finds them first. Every user-written string is a text node, and no link is built from
 * data.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

/**
 * Every line of the page's source (src/, which the bundle is built from) matching `pattern`, as `file:line`. The build
 * and development scripts run in Node, never in the page, so they are not scanned: the page they write needs its one
 * script element.
 */
function findInSource(pattern: RegExp): string[] {
  const found: string[] = [];
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).map((file) => path.join("src", file));
  for (const file of files) {
    if (!/\.(ts|tsx|css)$/.test(file)) continue;
    const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.split(path.sep).join("/")}:${index + 1}`);
    });
  }
  return found.sort();
}

describe("no HTML or script sink in apps/admin", () => {
  const sinks: [string, RegExp][] = [
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["innerHTML and outerHTML", /\b(inner|outer)HTML\b/],
    ["insertAdjacentHTML", /insertAdjacentHTML/],
    ["createContextualFragment", /createContextualFragment/],
    ["document.write", /document\.write/],
    ["srcdoc", /srcdoc/i],
    ["eval", /\beval\s*\(/],
    ["new Function", /new\s+Function\b|\bFunction\s*\(/],
    ["a string as a timer's code", /setTimeout\(\s*["'`]|setInterval\(\s*["'`]/],
    ["a rendered script or style element", /<script|<style|createElement\(\s*["'`](script|style)/i],
    ["React's preinit and preload", /\bpre(init|initModule|load|loadModule)\b/],
    ["a style attribute set as text", /setAttribute\(\s*["'`]style/],
    ["setAttribute at all: React sets every attribute", /\.setAttribute\(/],
    ["a Trusted Types policy", /trustedTypes|createPolicy/],
    ["DOMParser", /DOMParser/],
    ["window.open and navigations built in code", /window\.open|location\.(href|assign|replace)\s*[=(]/],
  ];
  for (const [name, pattern] of sinks) {
    test(name, () => {
      expect(findInSource(pattern)).toEqual([]);
    });
  }

  test("no style prop: every style is in the one CSS file", () => {
    expect(findInSource(/\bstyle=\{/)).toEqual([]);
    const css = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".css"));
    expect(css).toEqual(["app.css"]);
  });

  test("no link is built from data: the only href written from a value is NavLink's, whose type lists the console's own paths", () => {
    expect(findInSource(/href=\{/).map((found) => found.split(":")[0])).toEqual(["src/nav.tsx"]);
    const nav = readFileSync(path.join(SRC, "nav.tsx"), "utf8");
    expect(nav).toMatch(/href=\{to\}/);
    expect(nav).toMatch(/to: ConsolePath/);
    expect(readFileSync(path.join(SRC, "router.ts"), "utf8")).toMatch(/export type ConsolePath = "\/" \| "\/audit" \| "\/signin";/);
  });

  test("no src or action attribute written from a value", () => {
    expect(findInSource(/\b(src|action|formAction|xlinkHref)=\{/)).toEqual([]);
  });

  test("never a passkey_* code or text: the console has its own words", () => {
    expect(findInSource(/passkey_/)).toEqual([]);
  });
});

describe("the key is asked only after the console checked what it is asked to sign", () => {
  test("navigator.credentials is called only by the three ceremonies, each of which checks its challenge first", () => {
    // A fourth call site would need a check of its own (3a design, section 9): this list makes adding one a decision.
    expect(findInSource(/credentials\.(get|create)\(/).map((found) => found.split(":")[0])).toEqual(["src/enroll.ts", "src/sign-in.ts", "src/step-up.ts"]);
    const checks: [string, RegExp][] = [
      ["enroll.ts", /checkRegisterChallenge\(/],
      ["sign-in.ts", /checkSignInChallenge\(/],
      ["step-up.ts", /checkStepUpOptions\(/],
    ];
    for (const [file, check] of checks) {
      const source = readFileSync(path.join(SRC, file), "utf8");
      const call = source.search(/credentials\.(get|create)\(/);
      // The check is called in the function that makes the call, before it, as it runs before it. Only that function's
      // text up to the call is searched: a check declared in the same file (step-up.ts declares checkStepUpOptions) is
      // another top-level function, so its name there never stands in for the call.
      const declarations = [...source.matchAll(/^(export )?(async )?function \w+/gm)].map((found) => found.index ?? -1);
      const enclosing = Math.max(...declarations.filter((at) => at < call));
      expect(call, file).toBeGreaterThan(-1);
      expect(enclosing, file).toBeGreaterThan(-1);
      expect(source.slice(enclosing, call).search(check), file).toBeGreaterThan(-1);
    }
  });
});

describe("zod is jitless before the first schema is built", () => {
  test("the entry's first import is the module that sets it", () => {
    const main = readFileSync(path.join(SRC, "main.tsx"), "utf8");
    const imports = [...main.matchAll(/^import\s.*$/gm)].map((m) => m[0]);
    expect(imports[0]).toBe('import "./zod-jitless";');
    expect(readFileSync(path.join(SRC, "zod-jitless.ts"), "utf8")).toMatch(/z\.config\(\{ jitless: true \}\);/);
  });

  test("the module imports nothing that builds a schema", () => {
    const source = readFileSync(path.join(SRC, "zod-jitless.ts"), "utf8");
    expect([...source.matchAll(/^import\s.*$/gm)].map((m) => m[0])).toEqual(['import { z } from "zod";']);
  });

  test("loading it turns zod's eval probe off", async () => {
    await import("../src/zod-jitless");
    expect(z.config().jitless).toBe(true);
  });
});
