import { setTimeout as sleep } from "node:timers/promises";
import pino from "pino";
import { IMPORT_RULES } from "@korbat/contracts";
import { IMPORTER_HEARTBEAT_INTERVAL_MS, archivesLayout, workLayout } from "@korbat/import-protocol";
import { loadConfig } from "./config";
import { prepareWork, tick, writeHeartbeat, type LoopDeps } from "./loop";
import { errorCode } from "./scan";

/**
 * The importer (3b design, section 7.1; decision 1). It reads archives from one volume and writes normalised posts,
 * images and a heartbeat to another, one archive at a time. It has no network, no database, no Valkey and no secret but
 * the per-account key each job brings: the two volumes are everything it can reach.
 */
const config = loadConfig();
const log = pino({ level: config.logLevel, base: undefined });

const deps: LoopDeps = {
  archives: archivesLayout(config.archivesDir),
  work: workLayout(config.workDir),
  log,
  now: Date.now,
  idleMs: IMPORT_RULES.idleMs,
  watchdogMs: IMPORT_RULES.watchdogMs,
  abort: (reason) => {
    log.fatal({ reason }, "watchdog: exiting so the container restarts");
    process.exit(1);
  },
};

await prepareWork(deps.work);
await writeHeartbeat(deps);
// The heartbeat has its own timer, so it keeps beating while a long scan awaits its reads.
const heartbeat = setInterval(() => void writeHeartbeat(deps).catch((caught: unknown) => log.error({ error: errorCode(caught) }, "heartbeat failed")), IMPORTER_HEARTBEAT_INTERVAL_MS);

let running = true;
const stop = (signal: string) => {
  log.info({ signal }, "stopping after the current scan");
  running = false;
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

log.info({ phase: "ready" }, "importer started");
while (running) {
  const worked = await tick(deps).catch((caught: unknown) => {
    log.error({ error: errorCode(caught) }, "tick failed");
    return false;
  });
  if (!worked) await sleep(deps.idleMs);
}
clearInterval(heartbeat);
