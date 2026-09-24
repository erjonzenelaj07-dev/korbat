import { readFileSync } from "node:fs";
import path from "node:path";
import queryString from "query-string";
import { describe, expect, test } from "vitest";

// expo-router parses and prints URL query strings through query-string; the workspace overrides it to a
// version whose decoder is not exponential on malformed input (GHSA for decode-uri-component < 0.5.0).
describe("query strings", () => {
  test("parse and stringify behave as expo-router uses them", () => {
    expect(queryString.parse("a=%2F&b=1&c=x%20y")).toEqual({ a: "/", b: "1", c: "x y" });
    expect(queryString.stringify({ b: "1", a: "/" }, { sort: false })).toBe("b=1&a=%2F");
    expect(queryString.parse("")).toEqual({});
  });

  test("the lockfile holds no decode-uri-component below 0.5.0", () => {
    const lock = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "pnpm-lock.yaml"), "utf8");
    const versions = [...lock.matchAll(/^ {2}decode-uri-component@([0-9]+)[.]([0-9]+)[.]([0-9]+):/gm)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(versions.length).toBeGreaterThan(0);
    for (const [major, minor] of versions) expect(major > 0 || minor >= 5).toBe(true);
  });
});
