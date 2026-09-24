import { describe, expect, test } from "vitest";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { SocialError } from "../../src/social/context";
import { enforceWriteLimit } from "../../src/social/limits";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";

const user = "00000000-0000-4000-8000-000000000001";

function harness(accountAgeMs: number) {
  let t = 1_789_000_000_000;
  const store = new MemoryStore(() => t);
  const createdAt = new Date(t - accountAgeMs);
  const now = () => new Date(t);
  return { store, createdAt, now, advance: (ms: number) => { t += ms; } };
}

async function code(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof SocialError) return err.code;
    throw err;
  }
}

describe("write limits", () => {
  test("a new account gets five posts an hour, then rate_limited with a Retry-After", async () => {
    const h = harness(HOUR_MS);
    for (let i = 0; i < 5; i++) await enforceWriteLimit(h.store, user, "post", h.createdAt, h.now());
    const err = await enforceWriteLimit(h.store, user, "post", h.createdAt, h.now()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SocialError);
    expect((err as SocialError).code).toBe("rate_limited");
    expect((err as SocialError).status).toBe(429);
    expect((err as SocialError).retryAfterSeconds).toBeGreaterThan(0);
    h.advance(HOUR_MS + 1);
    expect(await code(enforceWriteLimit(h.store, user, "post", h.createdAt, h.now()))).toBeNull();
  });
  test("an established account gets thirty posts an hour", async () => {
    const h = harness(3 * DAY_MS);
    for (let i = 0; i < 30; i++) await enforceWriteLimit(h.store, user, "post", h.createdAt, h.now());
    expect(await code(enforceWriteLimit(h.store, user, "post", h.createdAt, h.now()))).toBe("rate_limited");
  });
  test("reposts and quotes are account_too_new before 48 hours, and quotes then count as posts", async () => {
    const young = harness(47 * HOUR_MS);
    expect(await code(enforceWriteLimit(young.store, user, "repost", young.createdAt, young.now()))).toBe("account_too_new");
    expect(await code(enforceWriteLimit(young.store, user, "quote", young.createdAt, young.now()))).toBe("account_too_new");
    const old = harness(49 * HOUR_MS);
    for (let i = 0; i < 30; i++) await enforceWriteLimit(old.store, user, "quote", old.createdAt, old.now());
    expect(await code(enforceWriteLimit(old.store, user, "post", old.createdAt, old.now()))).toBe("rate_limited");
  });
  test("a store that fails refuses the write with service_unavailable and a 30-second Retry-After", async () => {
    const failing = {
      hit: async () => {
        throw new Error("connection lost");
      },
    };
    const err = await enforceWriteLimit(failing, user, "post", new Date(0), new Date()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "service_unavailable", status: 503, retryAfterSeconds: 30 });
  });
  test("follows stop at 400 a day even when each hour stays under 50", async () => {
    const h = harness(10 * DAY_MS);
    for (let hour = 0; hour < 8; hour++) {
      for (let i = 0; i < 50; i++) await enforceWriteLimit(h.store, user, "follow", h.createdAt, h.now());
      h.advance(HOUR_MS + 1);
    }
    expect(await code(enforceWriteLimit(h.store, user, "follow", h.createdAt, h.now()))).toBe("rate_limited");
    expect(await code(enforceWriteLimit(h.store, user, "like", h.createdAt, h.now()))).toBeNull();
  });
});
