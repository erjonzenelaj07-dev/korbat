import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES } from "@korbat/contracts";
import { ImporterHeartbeat, SCAN_MAX_ATTEMPTS } from "@korbat/import-protocol";
import { prepareWork, tick, writeHeartbeat, type LoopDeps } from "../src/loop";
import { scanJob, type ScanOutcome } from "../src/scan";
import { capturingLogger, placeJob, readOutput, volumes, workspace } from "./fixtures/harness";
import { buildMastodonArchive } from "./fixtures/mastodon";
import { buildXArchive } from "./fixtures/x";

/** The importer's loop (7.1): attempts, the third start, deletion requests, the order of the files, the watchdog. */

const ws = workspace();
afterAll(() => ws.remove());

function harness(overrides: Partial<LoopDeps> = {}) {
  const { archives, work } = volumes(ws.dir);
  const { log, lines } = capturingLogger();
  const aborted: string[] = [];
  const deps: LoopDeps = {
    archives,
    work,
    log,
    now: () => 1_800_000_000_000,
    idleMs: 5,
    watchdogMs: 60_000,
    abort: (reason) => void aborted.push(reason),
    ...overrides,
  };
  return { deps, archives, work, logs: lines, aborted };
}

const mastodon = buildMastodonArchive();

describe("a scan through the loop", () => {
  test("a queued archive is scanned once: the attempt is counted, the summary written, the next tick idle", async () => {
    const h = harness();
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    expect(await tick(h.deps)).toBe(true);
    expect(readFileSync(h.work.attempt(id), "utf8")).toBe("1");
    expect(readOutput(h.work, id).summary).toMatchObject({ status: "scanned", posts: 14 });
    expect(await tick(h.deps)).toBe(false);
    expect(readFileSync(h.work.attempt(id), "utf8")).toBe("1");
    expect(readdirSync(h.work.tmp)).toEqual([]);
  });

  test("the oldest queue marker goes first, one archive a tick", async () => {
    const h = harness();
    await prepareWork(h.work);
    const late = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    const early = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    utimesSync(h.archives.queued(late), new Date(2_000_000), new Date(2_000_000));
    utimesSync(h.archives.queued(early), new Date(1_000_000), new Date(1_000_000));
    await tick(h.deps);
    expect(existsSync(h.work.summary(early))).toBe(true);
    expect(existsSync(h.work.summary(late))).toBe(false);
    await tick(h.deps);
    expect(existsSync(h.work.summary(late))).toBe(true);
  });

  test("a scan that dies is tried again, and its third start fails interrupted without opening the archive", async () => {
    let calls = 0;
    const h = harness({
      scan: async (id, signal) => {
        calls++;
        // Stands in for a scan that kills the process: the real scan counts its attempt, then the hook throws.
        const hooks = { attempted: () => {
          throw new Error("simulated crash");
        } };
        return scanJob({ archives: h.archives, work: h.work, log: h.deps.log, hooks }, id, signal);
      },
    });
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    await tick(h.deps);
    expect(readFileSync(h.work.attempt(id), "utf8")).toBe(String(SCAN_MAX_ATTEMPTS - 1));
    expect(existsSync(h.work.summary(id))).toBe(false);
    // The archive is replaced by bytes no reader takes: a third start must not open it at all.
    writeFileSync(h.archives.archive(id), "not an archive");
    await tick(h.deps);
    expect(calls).toBe(3);
    expect(readOutput(h.work, id).summary).toEqual({ v: 1, id, status: "failed", failure: "interrupted" });
  });

  test("a job file that cannot be read fails the scan unreadable", async () => {
    const h = harness();
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    writeFileSync(h.archives.job(id), JSON.stringify({ v: 1, id: randomUUID(), source: "mastodon" }));
    await tick(h.deps);
    expect(readOutput(h.work, id).summary).toMatchObject({ status: "failed", failure: "unreadable" });
  });

  test("the summary is written last: images, then posts.jsonl, then summary.json", async () => {
    const placed: string[] = [];
    const h = harness();
    h.deps.hooks = { placed: (file) => void placed.push(file) };
    await prepareWork(h.work);
    placeJob(h.archives, { source: "x", archive: buildXArchive(), images: true });
    await tick(h.deps);
    expect(placed.length).toBe(4);
    expect(placed.slice(0, 2).every((file) => /^media[/][0-9]+-0[.](jpg|png)$/.test(file))).toBe(true);
    expect(placed.slice(2)).toEqual(["posts.jsonl", "summary.json"]);
  });
});

describe("deletion requests", () => {
  test("remove the work folder, and an archive with a request is not scanned", async () => {
    const h = harness();
    await prepareWork(h.work);
    const done = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    expect(existsSync(h.work.jobDir(done))).toBe(true);
    writeFileSync(h.archives.deletion(done), "");
    const waiting = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    writeFileSync(h.archives.deletion(waiting), "");
    expect(await tick(h.deps)).toBe(true);
    expect(existsSync(h.work.jobDir(done))).toBe(false);
    expect(existsSync(h.work.jobDir(waiting))).toBe(false);
    expect(existsSync(h.work.attempt(waiting))).toBe(false);
    // Carried out: the next tick has nothing to do, while the API has not withdrawn the requests yet.
    expect(await tick(h.deps)).toBe(false);
  });

  test("a request for the archive being scanned aborts that scan; nothing of it is left", async () => {
    let outcome: ScanOutcome | undefined;
    const h = harness({
      scan: async (id, signal) => {
        writeFileSync(h.archives.deletion(id), "");
        // The loop looks for requests every idleMs while a scan runs; the scan sees its signal between items.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("the scan was not aborted")), 5_000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        outcome = await scanJob({ archives: h.archives, work: h.work, log: h.deps.log }, id, signal);
        return outcome;
      },
    });
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    expect(outcome).toBe("aborted");
    expect(existsSync(h.work.jobDir(id))).toBe(false);
  });

  test("attempts/<id> goes once the job's archive folder is gone", async () => {
    const h = harness();
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    expect(existsSync(h.work.attempt(id))).toBe(true);
    rmSync(h.archives.jobDir(id), { recursive: true });
    rmSync(h.archives.queued(id));
    await tick(h.deps);
    expect(existsSync(h.work.attempt(id))).toBe(false);
  });

  test("names that are not import ids are ignored in queue/ and delete/", async () => {
    const h = harness();
    await prepareWork(h.work);
    writeFileSync(`${h.archives.queue}/not-an-id`, "");
    writeFileSync(`${h.archives.deletions}/x..`, "");
    mkdirSync(`${h.archives.queue}/${randomUUID()}`);
    expect(await tick(h.deps)).toBe(false);
  });
});

describe("the process's own care", () => {
  test("prepareWork creates the folders and forgets files a crash left half written", async () => {
    const h = harness();
    mkdirSync(h.work.tmp, { recursive: true });
    writeFileSync(`${h.work.tmp}/half`, "x");
    await prepareWork(h.work);
    expect(readdirSync(h.work.tmp)).toEqual([]);
    expect(existsSync(h.work.jobs) && existsSync(h.work.attempts)).toBe(true);
  });

  test("the heartbeat is { v: 1, at } in epoch milliseconds, written through tmp/", async () => {
    const h = harness();
    await prepareWork(h.work);
    await writeHeartbeat(h.deps);
    expect(ImporterHeartbeat.parse(JSON.parse(readFileSync(h.work.heartbeat, "utf8")))).toEqual({ v: 1, at: 1_800_000_000_000 });
    expect(readdirSync(h.work.tmp)).toEqual([]);
    expect(IMPORT_RULES.heartbeatMs).toBe(10_000);
  });

  test("the watchdog ends the process when one scan runs too long", async () => {
    const h = harness({
      watchdogMs: 20,
      scan: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "scanned";
      },
    });
    await prepareWork(h.work);
    placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    expect(h.aborted).toHaveLength(1);
    expect(IMPORT_RULES.watchdogMs).toBe(1_800_000);
  });
});
