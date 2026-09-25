import { describe, expect, test } from "vitest";
import { deviceHash, emailHash, ipHash, phoneHash } from "../../src/auth/identifiers";

const key = Buffer.alloc(32, 1);

describe("identifier hashes", () => {
  test("are keyed, namespaced and stable", () => {
    expect(deviceHash(key, "abc")).toBe(deviceHash(key, "abc"));
    expect(deviceHash(key, "abc")).not.toBe(ipHash(key, "abc"));
    expect(deviceHash(Buffer.alloc(32, 2), "abc")).not.toBe(deviceHash(key, "abc"));
    expect(ipHash(key, "203.0.113.9")).toMatch(/^[0-9a-f]{64}$/);
  });
  test("email hashes ignore case and surrounding whitespace", () => {
    expect(emailHash(key, " Ada@Example.COM ")).toBe(emailHash(key, "ada@example.com"));
  });
  test("phone hashes are keyed and in a namespace of their own", () => {
    expect(phoneHash(key, "+447911123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash(key, "+447911123456")).toBe(phoneHash(key, "+447911123456"));
    expect(phoneHash(key, "+447911123456")).not.toBe(emailHash(key, "+447911123456"));
    expect(phoneHash(Buffer.alloc(32, 2), "+447911123456")).not.toBe(phoneHash(key, "+447911123456"));
  });
});
