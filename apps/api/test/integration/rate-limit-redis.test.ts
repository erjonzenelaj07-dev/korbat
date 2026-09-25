import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, describe, expect, test } from "vitest";
import { RedisStore } from "../../src/middleware/rate-limit";

const enabled = Boolean(process.env.INTEGRATION);
const redis = enabled ? new Redis(process.env.REDIS_URL ?? "redis://localhost:56379") : null;

afterAll(async () => {
  await redis?.quit();
});

/**
 * The Redis limit store against the test database of the Compose Valkey: a hit given back with
 * release lowers the counter under `rl:<key>` by one and leaves its expiry alone, never takes it below
 * zero, and never creates a key that was not there. Every test uses keys of its own.
 */
describe.skipIf(!enabled)("integration: the Redis rate-limit store", () => {
  const WINDOW_MS = 60_000;

  test("release gives one hit back and keeps the window's expiry", async () => {
    const store = new RedisStore(redis!);
    const key = `release-${randomUUID()}`;
    await store.hit(key, WINDOW_MS);
    await store.hit(key, WINDOW_MS);
    const before = await redis!.pttl(`rl:${key}`);
    await store.release(key);
    expect(await redis!.get(`rl:${key}`)).toBe("1");
    const after = await redis!.pttl(`rl:${key}`);
    // The expiry was not touched: it only ran down, and it is still set.
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before);
    const next = await store.hit(key, WINDOW_MS);
    expect(next.count).toBe(2);
    expect(next.resetMs).toBeLessThanOrEqual(before);
  });

  test("release never goes below zero and never creates a key", async () => {
    const store = new RedisStore(redis!);
    const key = `release-${randomUUID()}`;
    await store.release(key);
    expect(await redis!.exists(`rl:${key}`)).toBe(0);
    await store.hit(key, WINDOW_MS);
    await store.release(key);
    await store.release(key);
    expect(await redis!.get(`rl:${key}`)).toBe("0");
    expect(await redis!.pttl(`rl:${key}`)).toBeGreaterThan(0);
    expect((await store.hit(key, WINDOW_MS)).count).toBe(1);
  });
});
