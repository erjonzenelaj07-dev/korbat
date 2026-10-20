import { setTimeout as sleep } from "node:timers/promises";
import pino from "pino";
import { HEARTBEAT_INTERVAL_MS, storeLayout, uploadsLayout } from "@korbat/media-protocol";
import { loadConfig } from "./config";
import { WATCHDOG_MS, prepareStore, tick, writeHeartbeat, type LoopDeps } from "./loop";
import { configureDecoder, processImage } from "./pipeline";
import { scorerFrom } from "./score";

/**
 * The image worker. It reads uploads from one volume and writes WebP files, results and a
 * heartbeat to another, one image at a time. It has no network, no database and no queue: the two
 * volumes are everything it can reach. See docs/superpowers/specs/2026-09-18-images-2b-design.md.
 */
const config = loadConfig();
const log = pino({ level: config.logLevel, base: undefined });
configureDecoder(config.formats);

// 3d Task 6: the R1 scorer of R1_CLASSIFIER, none while it is off; the configuration refused a test scorer on an open site.
const scorer = scorerFrom(config.r1Classifier);

const deps: LoopDeps = {
  uploads: uploadsLayout(config.uploadsDir),
  store: storeLayout(config.storeDir),
  formats: config.formats,
  log,
  now: Date.now,
  process: (path, formats) => processImage(path, formats, scorer),
  abort: (reason) => {
    log.fatal({ reason }, "watchdog: exiting so the container restarts");
    process.exit(1);
  },
  watchdogMs: WATCHDOG_MS,
};

await prepareStore(deps.store);
await writeHeartbeat(deps);
// The heartbeat has its own timer: decoding runs off the main thread, so it keeps beating during a long image.
const heartbeat = setInterval(() => void writeHeartbeat(deps).catch((err: unknown) => log.error({ err }, "heartbeat failed")), HEARTBEAT_INTERVAL_MS);

let running = true;
const stop = (signal: string) => {
  log.info({ signal }, "stopping after the current image");
  running = false;
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

log.info({ formats: config.formats, r1Classifier: config.r1Classifier }, "worker started");
while (running) {
  const worked = await tick(deps).catch((err: unknown) => {
    log.error({ err }, "tick failed");
    return false;
  });
  if (!worked) await sleep(500);
}
clearInterval(heartbeat);
