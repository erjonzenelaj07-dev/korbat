import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildConsole, buildOptions, BUILD_TARGET } from "../build.mjs";

/**
 * The build (3a design, section 9): esbuild called directly, its target pinned, minified, the bundle and the stylesheet
 * under hashed names, and dist/index.html referencing them with no inline script or style, which the page's policy would
 * refuse.
 */
let out = "";

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), "korbat-admin-build-"));
  await buildConsole({ outdir: out });
}, 60_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("the console's build", () => {
  test("pins its target, and esbuild is given exactly that target and told to minify", () => {
    expect(BUILD_TARGET.length).toBeGreaterThan(0);
    for (const target of BUILD_TARGET) expect(target).toMatch(/^(chrome|edge|firefox|safari)\d+$/);
    // The options the build and the development server hand esbuild. The list above pins nothing unless they carry it:
    // without `target` esbuild writes for its own default, which a new esbuild may change.
    const options = buildOptions(out);
    expect(options.target).toEqual(BUILD_TARGET);
    expect(options.minify).toBe(true);
  });

  test("writes a hashed bundle and stylesheet, and index.html naming exactly them", () => {
    const assets = readdirSync(path.join(out, "assets")).sort();
    const script = assets.find((file) => /^main-[A-Z0-9]{8}\.js$/.test(file));
    const style = assets.find((file) => /^main-[A-Z0-9]{8}\.css$/.test(file));
    expect(script, assets.join(", ")).toBeDefined();
    expect(style, assets.join(", ")).toBeDefined();
    const index = readFileSync(path.join(out, "index.html"), "utf8");
    expect(index).toContain(`<script type="module" src="/assets/${script}"></script>`);
    expect(index).toContain(`<link rel="stylesheet" href="/assets/${style}">`);
    expect(existsSync(path.join(out, "favicon.svg"))).toBe(true);
    expect(index).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  });

  test("index.html holds no inline script, style or event handler", () => {
    const index = readFileSync(path.join(out, "index.html"), "utf8");
    expect(index.match(/<script/g)).toHaveLength(1);
    expect(index).not.toMatch(/<style|style=| on[a-z]+=|javascript:|data:/i);
  });

  test("the bundle is minified, in production mode, and holds zod's jitless setting", () => {
    const script = readdirSync(path.join(out, "assets")).find((file) => file.endsWith(".js"))!;
    const bundle = readFileSync(path.join(out, "assets", script), "utf8");
    // Minified: long lines throughout. The few short ones are template literals of zod's code generator, which jitless
    // never runs, and the licence comments at the end.
    const lines = bundle.split("\n");
    expect(bundle.length / lines.length).toBeGreaterThan(2000);
    expect(bundle).not.toMatch(/process\.env\.NODE_ENV/);
    expect(bundle).toMatch(/jitless:!0/);
  });
});
