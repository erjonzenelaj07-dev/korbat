import { describe, expect, test } from "vitest";
import Redis from "ioredis";
import { HealthResponse } from "@korbat/contracts";
import { closeDb, createDb, ping } from "@korbat/db";
import pino from "pino";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { RedisStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";

describe.skipIf(!process.env.INTEGRATION)("integration: health against real services", () => {
  test("all checks ok and redis rate limiting counts", async () => {
    const config = loadConfig();
    const logger = pino({ level: "silent" });
    const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
    const authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
    const redis = new Redis(config.REDIS_URL);
    try {
      const auth = createAuth({ config, logger, authDb, redis, mailer: new MemoryMailer(), profiles: createProfileStore(apiDb) });
      const app = createApp({
        config,
        logger,
        rateLimitStore: new RedisStore(redis),
        healthChecks: { postgres_api: () => ping(apiDb), postgres_auth: () => ping(authDb), redis: async () => { await redis.ping(); } },
        auth,
      });
      const first = await app.request("/api/health");
      expect(first.status).toBe(200);
      expect(HealthResponse.parse(await first.json()).status).toBe("ok");
      const second = await app.request("/api/health");
      expect(Number(second.headers.get("ratelimit-remaining"))).toBeLessThan(Number(first.headers.get("ratelimit-remaining")));
    } finally {
      await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
    }
  });
});
