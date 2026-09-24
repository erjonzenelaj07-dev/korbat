import { readFileSync } from "node:fs";
import path from "node:path";
import * as queryString from "query-string";
import { describe, expect, test } from "vitest";

// expo-router parses and prints URL query strings through query-string 7, imported as a namespace
// (`import * as queryString`), so the module must expose `parse` and `stringify` by name: a version with only
// a default export left every navigation's address bar unchanged in the exported web bundle. The workspace
// keeps 7.1.3 and overrides its decoder to decode-uri-component 0.5.0, which is not exponential on malformed
// input (GHSA for < 0.5.0); a repository patch lets the CommonJS module call that ES module's default export.
describe("query strings", () => {
  test("parse and stringify are named exports and decode percent-encoded values", () => {
    expect(typeof queryString.parse).toBe("function");
    expect(typeof queryString.stringify).toBe("function");
    expect(queryString.parse("a=%2F&b=1&c=x%20y&d=%C3%A5")).toEqual({ a: "/", b: "1", c: "x y", d: "\u00e5" });
    expect(queryString.stringify({ b: "1", a: "/" }, { sort: false })).toBe("b=1&a=%2F");
    expect(queryString.parse("")).toEqual({});
  });

  test("the lockfile holds query-string 7.1.3, patched, and no decode-uri-component below 0.5.0", () => {
    const lock = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "pnpm-lock.yaml"), "utf8");
    expect(new Set([...lock.matchAll(/^ {2}query-string@([0-9.]+)/gm)].map((m) => m[1]))).toEqual(new Set(["7.1.3"]));
    expect(lock).toMatch(/^ {2}query-string@7[.]1[.]3:\n {4}hash: /m);
    const versions = [...lock.matchAll(/^ {2}decode-uri-component@([0-9]+)[.]([0-9]+)[.]([0-9]+)/gm)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(versions.length).toBeGreaterThan(0);
    for (const [major, minor] of versions) expect(major > 0 || minor >= 5).toBe(true);
  });
});
