# korbat Foundation — Task 12 of 16: `@korbat/worker` skeleton

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform with a self-owned backend (Hono API, our own Postgres, Redis, MinIO, Docker Compose). Anything slow or risky runs outside the API process in a separate **worker** container with its own memory and time limits, so a malicious upload or a long job cannot take the API down. In sub-project 2 the worker will run the image pipeline (re-encode, strip EXIF, blurhash, NSFW score) and scheduled jobs (30-day IP-hash purge, explore-view refresh).

This task creates only the skeleton: a job registry with typed handlers, a job parser, and a process that consumes a Redis list (`korbat:jobs`, `BLPOP`) and dispatches each job. It deliberately uses a plain list rather than a queue library; sub-project 2 chooses a queue with retries and delays once the real jobs exist. The registry interface (`register(type, handler)`, `dispatch(job, ctx)`) is what survives that change.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop must be running** with the Task 8 `redis` service up for the smoke test (`docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d redis` if not).
- Pinned: ioredis 5.11.1, pino 10.3.1, zod 4.5.4, tsup 8.5.1, tsx 4.23.13, vitest 4.1.11, typescript 5.9.3, @types/node 24.13.3.
- Notes: `redis.blpop(key, timeoutSeconds)` resolves to `[key, value]` or `null` on timeout; `maxRetriesPerRequest: null` is required by ioredis for blocking commands; top-level `await` works because the package is ESM and tsup emits ESM.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 12).

## Preconditions

`git log --oneline -1` must show `feat(api): app factory, health endpoint, entrypoints and tsup build`. If `apps/worker/` exists, verify against this prompt, fix drift, run tests, skip to the report.

## Rules

1. Test first: write `test/jobs.test.ts`, run, see it fail on the missing module, implement, run, see it pass.
2. Exact file contents below.
3. Do not add a queue library or any job handler other than `noop`.
4. LF line endings, 2-space indentation.
5. Verify before claiming; paste real output.
6. Commit exactly once with the given message and trailer.

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

### `apps/worker/test/jobs.test.ts` (FIRST)
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

1. Create `package.json`, `tsconfig.json`, `tsup.config.ts`, and the test file.
2. Run `pnpm install`.
3. Run `pnpm --filter @korbat/worker test`. Expected: FAIL, `../src/jobs` unresolved.
4. Create `src/jobs.ts` and `src/index.ts`.
5. Run `pnpm --filter @korbat/worker test`. Expected: `Tests  4 passed`.
6. Run `pnpm --filter @korbat/worker typecheck && pnpm --filter @korbat/worker build && ls apps/worker/dist`. Expected: exit 0; `index.js` present.
7. Live smoke against Redis:
   ```bash
   REDIS_URL=redis://localhost:6379 node apps/worker/dist/index.js &
   sleep 1
   docker compose -f infra/compose.yml exec redis redis-cli RPUSH korbat:jobs '{"type":"noop","payload":null}'
   docker compose -f infra/compose.yml exec redis redis-cli RPUSH korbat:jobs 'not json'
   sleep 1; kill -INT %1; sleep 6
   ```
   Expected worker output: `worker started`, then `noop job handled`, then a `job failed` error line for the bad payload, then `stopping after current job`, and the process exits within about 5 seconds of the signal (the BLPOP timeout).
8. Commit:
```bash
git add -A && git commit -m "feat(worker): redis list consumer with job registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Report format

- Files created
- Output of steps 3, 5, 6, and the worker log lines from step 7
- Deviations and why
- Anything blocked or uncertain
