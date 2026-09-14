import Redis from "ioredis";
import pino from "pino";
import { JobRegistry, QUEUE_KEY, parseJob } from "./jobs";

/**
 * Foundation worker: a plain Redis list consumer. Sub-project 2 decides on a
 * real queue (retries, delays) when the image pipeline lands; the registry
 * interface stays.
 */
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required");
const log = pino({ level: process.env.LOG_LEVEL ?? "info", base: undefined });
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const registry = new JobRegistry().register("noop", async (_payload, ctx) => { ctx.log.info("noop job handled"); });

let running = true;
const stop = (signal: string) => { log.info({ signal }, "stopping after current job"); running = false; };
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

log.info("worker started");
while (running) {
  const item = await redis.blpop(QUEUE_KEY, 5);
  if (!item) continue;
  const raw = item[1];
  try {
    const job = parseJob(raw);
    await registry.dispatch(job, { log: log.child({ jobType: job.type }) });
  } catch (err) {
    log.error({ err }, "job failed");
  }
}
await redis.quit();
