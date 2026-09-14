import type Redis from "ioredis";

/** Short-lived auth state: session cache, MFA tickets, pending TOTP secrets, single-use links, failure counters. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Writes only when the key does not exist. Resolves true when it wrote. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Returns the value and deletes the key in one step, so a value can be taken once. */
  take(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** Increments a counter; the TTL starts at the first increment and is not extended afterwards. */
  incr(key: string, ttlMs: number): Promise<number>;
}

const INCR_WITH_TTL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

export function redisKv(redis: Redis, prefix = "korbat:auth:"): KeyValueStore {
  const k = (key: string) => prefix + key;
  return {
    get: (key) => redis.get(k(key)),
    async set(key, value, ttlMs) {
      await redis.set(k(key), value, "PX", ttlMs);
    },
    async setIfAbsent(key, value, ttlMs) {
      return (await redis.set(k(key), value, "PX", ttlMs, "NX")) === "OK";
    },
    take: (key) => redis.getdel(k(key)),
    async del(key) {
      await redis.del(k(key));
    },
    async incr(key, ttlMs) {
      return Number(await redis.eval(INCR_WITH_TTL, 1, k(key), ttlMs));
    },
  };
}

/** In-process store with the same semantics, for unit tests. The clock is injectable. */
export class MemoryKv implements KeyValueStore {
  private readonly items = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string) {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= this.now()) {
      this.items.delete(key);
      return undefined;
    }
    return item;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlMs: number) {
    this.items.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  async setIfAbsent(key: string, value: string, ttlMs: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async take(key: string) {
    const item = this.live(key);
    this.items.delete(key);
    return item?.value ?? null;
  }

  async del(key: string) {
    this.items.delete(key);
  }

  async incr(key: string, ttlMs: number) {
    const item = this.live(key);
    if (!item) {
      this.items.set(key, { value: "1", expiresAt: this.now() + ttlMs });
      return 1;
    }
    const next = Number(item.value) + 1;
    item.value = String(next);
    return next;
  }
}
