import { describe, expect, test } from "vitest";
import { MemoryKv } from "../../src/auth/kv";
import { enforceLimit } from "../../src/auth/limits";

describe("enforceLimit", () => {
  test("allows max hits in the window, then refuses with the window as Retry-After", async () => {
    let t = 1_000_000;
    const kv = new MemoryKv(() => t);
    for (let i = 0; i < 3; i++) await enforceLimit(kv, "b", 3, 90_000);
    await expect(enforceLimit(kv, "b", 3, 90_000)).rejects.toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: 90 });
    t += 90_001;
    await expect(enforceLimit(kv, "b", 3, 90_000)).resolves.toBeUndefined();
  });
});
