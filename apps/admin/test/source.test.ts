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

  test("no link is built from data: the only two hrefs written from a value are NavLink's, whose type lists the console's own paths, and CaseLink's, built from a checked case id", () => {
    expect(findInSource(/href=\{/).map((found) => found.split(":")[0])).toEqual(["src/nav.tsx", "src/nav.tsx"]);
    const nav = readFileSync(path.join(SRC, "nav.tsx"), "utf8");
    expect([...nav.matchAll(/href=\{[^}]*\}/g)].map((found) => found[0])).toEqual(["href={to}", "href={caseHref(id)}"]);
    expect(nav).toMatch(/to: ConsolePath/);
    expect(nav).toMatch(/id: CaseId/);
    const router = readFileSync(path.join(SRC, "router.ts"), "utf8");
    expect(router).toContain('export type ConsolePath = "/" | "/audit" | "/signin" | "/queue" | "/appeals" | "/standing";');
    // A CaseId is made in one place, by the function that checks it: nothing else may call a text a case's id.
    expect(findInSource(/\bas CaseId\b/).map((found) => found.split(":")[0])).toEqual(["src/router.ts"]);
    expect(router).toMatch(/return isLowerUuid\(text\) \? \(text as CaseId\) : null;/);
  });

  test("no src or action attribute written from a value, but the one image site, whose address is built from two checked ids and a literal size", () => {
    expect(findInSource(/\b(action|formAction|xlinkHref)=\{/)).toEqual([]);
    expect(findInSource(/\bsrc=\{/).map((found) => found.split(":")[0])).toEqual(["src/media.tsx"]);
    const media = readFileSync(path.join(SRC, "media.tsx"), "utf8");
    expect(media).toMatch(/src=\{staffImageSrc\(caseId, mediaId, size\)\}/);
    expect(media).toMatch(/staffImageSrc\(caseId: CaseId, mediaId: ImageId, size: StaffImageSize\)/);
    expect(findInSource(/\bas ImageId\b/).map((found) => found.split(":")[0])).toEqual(["src/media.tsx"]);
    // An image element is written nowhere else.
    expect(findInSource(/<img\b/).map((found) => found.split(":")[0])).toEqual(["src/media.tsx"]);
    // And nothing else builds an image's address: staffImageSrc is declared and called in that file alone, once each.
    expect(findInSource(/\bstaffImageSrc\b/).map((found) => found.split(":")[0])).toEqual(["src/media.tsx", "src/media.tsx"]);
    expect(media.match(/\bstaffImageSrc\(/g)).toHaveLength(2);
    // A failed load reaches the page through a handler React attaches (a prop), never through an attribute written as text.
    expect(media).toMatch(/onError=\{onError\}/);
    expect(findInSource(/\bon[A-Z][A-Za-z]*=["'`]/)).toEqual([]);
  });

  test("every refusal and every outcome is worded from messages.ts, one table each: no screen keeps a table of its own", () => {
    // A table of words by code or by outcome is an object whose keys are the contracts' names: none is written outside
    // the one file, where a second copy could drift from the first. A key opens a line or follows a brace or a comma.
    const keyed = /(^|[{,])\s*(rate_limited|not_found|invalid_request|staff_recused|text_invalid|restricted_rule|restricted_legal|no_violation|not_evident|not_available|partly_reversed|interim|correction)\s*:/;
    expect([...new Set(findInSource(keyed).map((found) => found.split(":")[0]))]).toEqual(["src/messages.ts"]);
    const messages = readFileSync(path.join(SRC, "messages.ts"), "utf8").split("\n");
    for (const table of ["CASE_WORDS", "REVEAL_WORDS", "NOTE_WORDS", "FINDING_WORDS", "OUTCOME_WORDS", "DECISION_KINDS", "DECISION_OUTCOMES", "PROTECTION_LIFTED_WORDS", "COMPOSER_KINDS", "COMPOSER_OUTCOMES", "COMPOSER_WORDS"]) {
      expect(messages.filter((line) => line.startsWith(`export const ${table}:`) || line.startsWith(`export const ${table} =`)), table).toHaveLength(1);
      // Declared nowhere else: the name follows `const` in that one file only.
      expect(findInSource(new RegExp(`const ${table}[^A-Za-z0-9_]`)).map((found) => found.split(":")[0]), table).toEqual(["src/messages.ts"]);
    }
  });

  test("no link into the app: no source line writes the address of a post or a profile", () => {
    expect(findInSource(/["'`]\/(post|u)\//)).toEqual([]);
    expect(findInSource(/APP_ORIGIN|appOrigin/)).toEqual([]);
  });

  test("never a passkey_* code or text: the console has its own words", () => {
    expect(findInSource(/passkey_/)).toEqual([]);
  });
});

describe("the key is asked only after the console checked what it is asked to sign", () => {
  test("a confirmation asks the key in one function, which every confirmed action goes through", () => {
    const stepUp = readFileSync(path.join(SRC, "step-up.ts"), "utf8");
    expect(stepUp.match(/credentials\.get\(/g)).toHaveLength(1);
    expect(stepUp).toMatch(/export async function confirmWithKey</);
    // The revocation of a session, the reveal, the decision and the review are callers of it; none asks the key itself.
    expect(stepUp.match(/confirmWithKey\(deps, action,/g)).toHaveLength(4);
  });

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
