import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { BreachCheckUnavailable, checkPasswordLength, hashPassword, hibpChecker, needsRehash, verifyPassword } from "../../src/auth/passwords";

const password = "correct horse battery staple";
const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();

function fakeFetch(handler: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler();
  }) as typeof fetch;
  return { fn, calls };
}

describe("password rules", () => {
  test("length is counted in characters, 12 to 128", () => {
    expect(checkPasswordLength("a".repeat(11))).toBe("password_too_short");
    expect(checkPasswordLength("a".repeat(12))).toBeNull();
    expect(checkPasswordLength("\u{1F642}".repeat(12))).toBeNull();
    expect(checkPasswordLength("a".repeat(129))).toBe("password_too_long");
  });
});

describe("argon2id", () => {
  test("hashes use argon2id with the configured cost and verify", async () => {
    const stored = await hashPassword(password);
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(await verifyPassword(stored, password)).toBe(true);
    expect(await verifyPassword(stored, "wrong password entirely")).toBe(false);
    expect(needsRehash(stored)).toBe(false);
    expect(needsRehash("$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA")).toBe(true);
  });
  test("an account without a password never verifies", async () => {
    expect(await verifyPassword(null, password)).toBe(false);
  });
});

describe("breached password check", () => {
  test("sends only the 5-character prefix, with padding, and finds the suffix", async () => {
    const { fn, calls } = fakeFetch(() => new Response(`0000000000000000000000000000000000A:0\r\n${sha1.slice(5)}:42\r\n`));
    expect(await hibpChecker(fn).isBreached(password)).toBe(true);
    expect(calls[0]!.url).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
    expect(calls[0]!.url).not.toContain(sha1.slice(5));
    expect(new Headers(calls[0]!.init?.headers).get("add-padding")).toBe("true");
  });
  test("padding entries with a count of 0 are not breaches", async () => {
    const { fn } = fakeFetch(() => new Response(`${sha1.slice(5)}:0\r\n`));
    expect(await hibpChecker(fn).isBreached(password)).toBe(false);
  });
  test("network errors and non-200 responses make the check unavailable", async () => {
    const offline = fakeFetch(() => {
      throw new Error("offline");
    });
    await expect(hibpChecker(offline.fn).isBreached(password)).rejects.toBeInstanceOf(BreachCheckUnavailable);
    const down = fakeFetch(() => new Response("", { status: 503 }));
    await expect(hibpChecker(down.fn).isBreached(password)).rejects.toBeInstanceOf(BreachCheckUnavailable);
  });
});
