import Redis from "ioredis";
import { afterAll } from "vitest";
import { redisKv } from "../../src/auth/kv";
import { kvContract } from "../auth/kv-contract";

const enabled = Boolean(process.env.INTEGRATION);
const redis = enabled ? new Redis(process.env.REDIS_URL ?? "redis://localhost:56379") : null;

afterAll(async () => {
  await redis?.quit();
});

kvContract("redis", () => redisKv(redis!, "korbat:test:"), enabled);
