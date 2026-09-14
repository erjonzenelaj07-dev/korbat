# korbat Foundation — Task 12 of 16: `@korbat/worker` skeleton

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a self-owned backend (Hono API, own Postgres, Redis, MinIO, Docker Compose). Anything slow or risky runs outside the API in a separate **worker** container with its own limits, so a malicious upload or a long job cannot take the API down. In sub-project 2 the worker runs the image pipeline and scheduled jobs.

This task creates the skeleton: a job registry with typed handlers, a job parser, and a process that consumes a Redis list (`korbat:jobs`, `BLPOP`) and dispatches each job. It uses a plain list on purpose; sub-project 2 chooses a queue library once real jobs exist. The registry interface (`register(type, handler)`, `dispatch(job, ctx)`) is what survives.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop running** with the Task 8 `redis` service up for the smoke test (`docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d redis` if not).
- Pinned: ioredis 5.11.1, pino 10.3.1, zod 4.5.4, tsup 8.5.1, tsx 4.23.13, vitest 4.1.11, typescript 5.9.3, @types/node 24.13.3.

## Preconditions

`git log --oneline -1` must show `feat(api): app factory, health endpoint, entrypoints and tsup build`. If `apps/worker/` exists, compare with this prompt, fix drift, run steps 5 to 7, and report.

## Rules (read twice)

1. Copy every file below byte for byte.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. A different test count, any unexpected `error`, `error TS`, or `FAIL` line, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it.
6. Do not add a queue library or any handler other than `noop`.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Files to create

### `apps/worker/package.json`
```json
{
  "name": "@korbat/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/db": "workspace:*",
    "ioredis": "5.11.1",
    "pino": "10.3.1",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```

### `apps/worker/tsconfig.json`
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test", "tsup.config.ts"] }
```

### `apps/worker/tsup.config.ts`
```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  noExternal: [/.*/],
  sourcemap: true,
  clean: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
```

### `apps/worker/test/jobs.test.ts`
```ts
import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import { JobRegistry, parseJob } from "../src/jobs";

const ctx = { log: pino({ level: "silent" }) };

describe("parseJob", () => {
  test("parses a well-formed job", () => {
    expect(parseJob('{"type":"noop","payload":{"a":1}}')).toEqual({ type: "noop", payload: { a: 1 } });
  });
  test("rejects garbage", () => {
    expect(() => parseJob("nope")).toThrow();
    expect(() => parseJob('{"payload":1}')).toThrow(/type/);
  });
});

describe("JobRegistry", () => {
  test("dispatches to the registered handler", async () => {
    const handler = vi.fn(async () => {});
    await new JobRegistry().register("noop", handler).dispatch({ type: "noop", payload: 7 }, ctx);
    expect(handler).toHaveBeenCalledWith(7, ctx);
  });
  test("rejects duplicate and unknown types", async () => {
    const r = new JobRegistry().register("a", async () => {});
    expect(() => r.register("a", async () => {})).toThrow(/duplicate/);
    await expect(r.dispatch({ type: "b", payload: null }, ctx)).rejects.toThrow(/no handler/);
  });
});
```

### `apps/worker/src/jobs.ts`
```ts
import type { Logger } from "pino";
import { z } from "zod";

export const JobSchema = z.object({ type: z.string().min(1), payload: z.unknown() });
export type Job = z.infer<typeof JobSchema>;
export interface JobContext { log: Logger }
export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>;

export const QUEUE_KEY = "korbat:jobs";

export function parseJob(raw: string): Job {
  return JobSchema.parse(JSON.parse(raw));
}

export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  register(type: string, handler: JobHandler): this {
    if (this.handlers.has(type)) throw new Error(`duplicate handler for job type: ${type}`);
    this.handlers.set(type, handler);
    return this;
  }
  async dispatch(job: Job, ctx: JobContext): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) throw new Error(`no handler for job type: ${job.type}`);
    await handler(job.payload, ctx);
  }
}
```

### `apps/worker/src/index.ts`
```ts
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
```

## Steps

1. Create `package.json`, `tsconfig.json`, `tsup.config.ts`, and `test/jobs.test.ts`. Do not create the `src/` files yet.
2. Run:
   ```bash
   pnpm install
   ```
   Expected: ends with `Done in <time> using pnpm v10.30.0`.
3. Run:
   ```bash
   pnpm --filter @korbat/worker test
   ```
   Expected: FAILS with `Failed to resolve import "../src/jobs"`. If it passes, STOP.
4. Create `src/jobs.ts` and `src/index.ts`.
5. Run:
   ```bash
   pnpm --filter @korbat/worker test
   ```
   Expected: `Tests  4 passed (4)`.
6. Run:
   ```bash
   pnpm --filter @korbat/worker typecheck && pnpm --filter @korbat/worker build && ls apps/worker/dist
   ```
   Expected: no `error TS` lines; `Build success`; `index.js` and `index.js.map` listed.
7. Live smoke against Redis:
   ```bash
   R="docker compose -f infra/compose.yml exec -T redis redis-cli"
   $R CLIENT LIST | grep -c cmd=blpop
   REDIS_URL=redis://localhost:56379 node apps/worker/dist/index.js > .worker.log 2>&1 & WPID=$!
   for i in $(seq 1 20); do grep -q "worker started" .worker.log 2>/dev/null && break; sleep 1; done
   $R CLIENT LIST | grep -c cmd=blpop
   $R RPUSH korbat:jobs '{"type":"noop","payload":null}'
   $R RPUSH korbat:jobs 'not json'
   for i in $(seq 1 20); do grep -q '"msg":"job failed"' .worker.log 2>/dev/null && break; sleep 1; done
   cat .worker.log
   kill $WPID; sleep 2
   $R CLIENT LIST | grep -c cmd=blpop
   $R LLEN korbat:jobs
   rm -f .worker.log
   ```
   Expected: the three `grep -c cmd=blpop` counts are `0`, `1`, `0` (no other consumer before, exactly this worker while running, none after), and `LLEN` is `0`. If the first count is not `0`, a stray worker from an earlier run is consuming jobs: STOP and report it rather than killing processes you did not start. `.worker.log` contains, in order: a line with `"msg":"worker started"`, a line with `"jobType":"noop","msg":"noop job handled"`, and a `"level":50` line that contains `is not valid JSON` and ends with `"msg":"job failed"` (check the whole line, it is long).
8. Commit:
   ```bash
   git add -A && git commit -m "feat(worker): redis list consumer with job registry

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
9. Run `git log --oneline -1`. Expected subject: `feat(worker): redis list consumer with job registry`.

## Report format (mandatory)

```
TASK 12 REPORT
Files created: <list>
Step 3 output (failure line): <paste>
Step 5 output (Tests line): <paste>
Step 6 output: <paste>
Step 7 output (the three log lines): <paste>
Step 9 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
