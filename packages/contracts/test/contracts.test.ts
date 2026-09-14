import { describe, expect, test } from "vitest";
import { ErrorEnvelope, HealthResponse, Pagination } from "../src/index";

describe("ErrorEnvelope", () => {
  test("accepts a minimal error", () => {
    const r = ErrorEnvelope.safeParse({ error: { code: "not_found", message: "nope" } });
    expect(r.success).toBe(true);
  });
  test("rejects a missing code", () => {
    expect(ErrorEnvelope.safeParse({ error: { message: "nope" } }).success).toBe(false);
  });
});

describe("HealthResponse", () => {
  test("accepts ok with checks", () => {
    const r = HealthResponse.safeParse({ status: "ok", version: "1.2.3", checks: { postgres: "ok", redis: "fail" } });
    expect(r.success).toBe(true);
  });
  test("rejects unknown check state", () => {
    expect(HealthResponse.safeParse({ status: "ok", version: "1", checks: { postgres: "meh" } }).success).toBe(false);
  });
});

describe("Pagination", () => {
  test("defaults limit to 20 and caps at 50", () => {
    expect(Pagination.parse({})).toEqual({ limit: 20 });
    expect(Pagination.safeParse({ limit: 51 }).success).toBe(false);
  });
  test("cursor is optional opaque string", () => {
    expect(Pagination.parse({ cursor: "abc", limit: 5 })).toEqual({ cursor: "abc", limit: 5 });
  });
});
