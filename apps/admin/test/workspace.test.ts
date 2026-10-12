import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The workspace links the statement of reasons needs (3c design, section 13, Task 6): the rulebook's package renders
 * statements over the contracts' types, and the console previews them, so @korbat/rules depends on @korbat/contracts and
 * the console on @korbat/rules. Every image installs with --frozen-lockfile, so each link must stand in the lockfile's
 * importer as well as in the package's manifest, and no package version may have come with it.
 */
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const manifest = (dir: string) => JSON.parse(readFileSync(path.join(REPO, dir, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

/** The lines of one importer of the lockfile, from its own line to the next importer's. */
function importer(name: string): string[] {
  const lock = readFileSync(path.join(REPO, "pnpm-lock.yaml"), "utf8").split("\n");
  const at = lock.indexOf(`  ${name}:`);
  if (at === -1) throw new Error(`the lockfile has no importer ${name}`);
  const end = lock.findIndex((line, index) => index > at && /^ {0,2}[^ ]/.test(line));
  return lock.slice(at + 1, end === -1 ? undefined : end);
}

describe("the workspace links of the statement of reasons", () => {
  test("@korbat/rules depends on @korbat/contracts, in its manifest and in the lockfile", () => {
    expect(manifest("packages/rules").dependencies).toEqual({ "@korbat/contracts": "workspace:*" });
    expect(importer("packages/rules").slice(0, 4)).toEqual(["    dependencies:", "      '@korbat/contracts':", "        specifier: workspace:*", "        version: link:../contracts"]);
  });

  test("the contracts depend on nothing of the rulebook's: the two never form a cycle", () => {
    const contracts = manifest("packages/contracts");
    expect(Object.keys({ ...contracts.dependencies, ...contracts.devDependencies })).not.toContain("@korbat/rules");
    expect(importer("packages/contracts").join("\n")).not.toContain("@korbat/rules");
  });

  test("the console depends on @korbat/rules, in its manifest and in the lockfile", () => {
    expect(manifest("apps/admin").dependencies).toMatchObject({ "@korbat/contracts": "workspace:*", "@korbat/rules": "workspace:*" });
    const lines = importer("apps/admin");
    const at = lines.indexOf("      '@korbat/rules':");
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at + 1, at + 3)).toEqual(["        specifier: workspace:*", "        version: link:../../packages/rules"]);
  });

  test("the images that build the console and the API install from the frozen lockfile and copy every package", () => {
    for (const file of ["infra/caddy/Dockerfile", "apps/api/Dockerfile"]) {
      const dockerfile = readFileSync(path.join(REPO, file), "utf8");
      expect(dockerfile, file).toMatch(/COPY packages \.\/packages/);
      const installs = dockerfile.split("\n").filter((line) => line.includes("pnpm install"));
      expect(installs.length, file).toBeGreaterThan(0);
      for (const line of installs) expect(line, file).toContain("--frozen-lockfile");
    }
  });
});
