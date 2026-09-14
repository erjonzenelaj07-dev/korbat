import { describe, expect, test } from "vitest";
import type { KeyValueStore } from "../../src/auth/kv";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One behaviour contract, run against every KeyValueStore implementation. */
export function kvContract(label: string, make: () => KeyValueStore, enabled = true) {
  describe.skipIf(!enabled)(`key-value store contract: ${label}`, () => {
    const key = () => `contract:${Math.random().toString(36).slice(2)}`;

    test("set, get and del", async () => {
      const kv = make();
      const k = key();
      expect(await kv.get(k)).toBeNull();
      await kv.set(k, "v", 10_000);
      expect(await kv.get(k)).toBe("v");
      await kv.del(k);
      expect(await kv.get(k)).toBeNull();
    });
    test("values expire after their TTL", async () => {
      const kv = make();
      const k = key();
      await kv.set(k, "v", 60);
      await sleep(150);
      expect(await kv.get(k)).toBeNull();
    });
    test("setIfAbsent writes only once", async () => {
      const kv = make();
      const k = key();
      expect(await kv.setIfAbsent(k, "a", 10_000)).toBe(true);
      expect(await kv.setIfAbsent(k, "b", 10_000)).toBe(false);
      expect(await kv.get(k)).toBe("a");
    });
    test("take returns a value once", async () => {
      const kv = make();
      const k = key();
      await kv.set(k, "once", 10_000);
      expect(await kv.take(k)).toBe("once");
      expect(await kv.take(k)).toBeNull();
    });
    test("incr counts inside a window that starts at the first increment", async () => {
      const kv = make();
      const k = key();
      expect(await kv.incr(k, 150)).toBe(1);
      expect(await kv.incr(k, 150)).toBe(2);
      await sleep(250);
      expect(await kv.incr(k, 150)).toBe(1);
    });
  });
}
