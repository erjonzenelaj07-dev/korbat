# korbat audit fixes — Task 5 of 11: A job runner with a refreshed lock runs the media sweeper and a new auth janitor (dead codes, old sessions, the IP-hash purge, a 90-day security log through a definer function); reconcile refuses to delete many orphan images; the untrusted store is never opened blocking

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend. The API runs background work: a sweeper that keeps the image store in step with the database, and from this task a janitor that applies the design's retention rules (dead sign-in codes, old sessions, device address hashes after 30 days, the security log after 90 days through a function the migrator owns, so the log stays append-only for the API role). Both run on a small job runner with a lock that is refreshed while a round runs, so rounds never overlap. The audit also found that the sweeper's orphan pass would delete every image posted since an older database snapshot after a restore, and that a FIFO planted in the untrusted store would block an API thread: the pass now refuses large deletions unless forced, and store entries are inspected before they are opened, never blocking. The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, section 5.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `fix(api): TRUST_PROXY decides which header names the client, limits key its hash and never the address; production refuses Turnstile test secrets and plain-http origins; JSON bodies over 64 KiB are 413; the relay must offer TLS in production; error stacks are scrubbed like messages`.
3. The previous task's last API unit run ended with `Tests  158 passed | 148 skipped (306)`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: prepare: custom-migration

```bash
pnpm --filter @korbat/db generate:custom --name auth_purge_events
```

Expected output contains:

- `0007_auth_purge_events.sql`

Observed on the dry run:

```text
[✓] Your SQL migration file ➜ migrations\0007_auth_purge_events.sql 🚀
```

## Step 2: write the tests

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/05-jobs-retention-media-safety.md 2
```

Expected: 7 lines starting with `wrote`, one for each file below.

### Create `packages/db/migrations/0007_auth_purge_events.sql`

```sql
-- auth_events stays append-only for korbat_auth (migration 0003 revoked UPDATE and DELETE). Retention runs
-- through this function instead: it belongs to the migrator, which owns the table, so the API role can remove
-- rows older than a cut-off without ever holding DELETE itself.
CREATE OR REPLACE FUNCTION "auth"."purge_events"(older_than interval) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM auth.auth_events WHERE created_at < now() - older_than;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."purge_events"(interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."purge_events"(interval) TO korbat_auth;
```

### Create `apps/api/test/jobs.test.ts`

```ts
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryJobLock, createJob } from "../src/lib/jobs";

const log = pino({ level: "silent" });

describe("job lock", () => {
  test("one holder at a time; refresh and release only for the holder; an expired hold is free", async () => {
    let t = 1_000;
    const lock = new MemoryJobLock(() => t);
    expect(await lock.acquire("k", "a", 100)).toBe(true);
    expect(await lock.acquire("k", "b", 100)).toBe(false);
    await lock.release("k", "b");
    expect(await lock.acquire("k", "b", 100)).toBe(false);
    t += 60;
    await lock.refresh("k", "a", 100);
    t += 60;
    expect(await lock.acquire("k", "b", 100)).toBe(false);
    t += 60;
    expect(await lock.acquire("k", "b", 100)).toBe(true);
    await lock.release("k", "b");
    expect(await lock.acquire("k", "c", 100)).toBe(true);
  });
});

describe("jobs", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("a round runs under the lock, is skipped while another instance holds it, and releases it afterwards", async () => {
    const lock = new MemoryJobLock(() => Date.now());
    let runs = 0;
    const job = createJob({ name: "t", intervalMs: 1_000, lockTtlMs: 10_000, lock, log, run: async () => void runs++ });
    await lock.acquire("job:t", "other", 10_000);
    expect(await job.round()).toBe("skipped");
    expect(runs).toBe(0);
    await lock.release("job:t", "other");
    expect(await job.round()).toBe("ran");
    expect(runs).toBe(1);
    expect(await lock.acquire("job:t", "other", 10_000)).toBe(true);
  });

  test("a slow round keeps refreshing the lock and a second call in the meantime is busy", async () => {
    const lock = new MemoryJobLock(() => Date.now());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const job = createJob({ name: "slow", intervalMs: 1_000, lockTtlMs: 1_000, lock, log, run: () => gate });
    const first = job.round();
    await vi.advanceTimersByTimeAsync(1);
    expect(await job.round()).toBe("busy");
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await lock.acquire("job:slow", "other", 1_000)).toBe(false);
    release();
    expect(await first).toBe("ran");
    expect(await lock.acquire("job:slow", "other", 1_000)).toBe(true);
  });

  test("the timer waits between rounds, never overlaps them, and stops on request", async () => {
    const lock = new MemoryJobLock(() => Date.now());
    let running = 0;
    let overlaps = 0;
    let runs = 0;
    const run = async () => {
      if (running > 0) overlaps++;
      running++;
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 300));
      running--;
    };
    const stop = createJob({ name: "timer", intervalMs: 100, lockTtlMs: 1_000, lock, log, run }).start();
    await vi.advanceTimersByTimeAsync(2_050);
    expect(runs).toBe(5);
    expect(overlaps).toBe(0);
    stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runs).toBe(5);
  });
});
```

### Create `apps/api/test/integration/auth-janitor.test.ts`

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { randomToken } from "../../src/auth/crypto";
import { EMAIL_CODE_RETENTION_MS, SESSION_RETENTION_MS, janitor } from "../../src/auth/janitor";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";
import { flowHarness } from "./flow-harness";

const DAY = 24 * 60 * 60_000;

describe.skipIf(!process.env.INTEGRATION)("integration: the auth janitor", () => {
  let db: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    const config = loadConfig();
    db = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it for setup.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await Promise.all([closeDb(db), closeDb(migrateDb)]);
  });

  test("dead codes, old sessions and stale device address hashes go; live ones stay", async () => {
    const h = flowHarness(repo);
    const { user, device } = await newUserWithDevice(repo);
    const now = h.clock.now();
    const code = (expiresAt: Date) =>
      repo.createEmailCode({ flowId: randomToken(), email: `janitor-${randomToken(6)}@korbat.local`, userId: user.id, purpose: "login", codeHash: "h", expiresAt, ipHash: "x" });
    await code(new Date(now.getTime() - EMAIL_CODE_RETENTION_MS - DAY));
    await code(new Date(now.getTime() + 600_000));

    const old = await h.deps.sessions.issue(user.id, device.id);
    await repo.revokeSession(old.session.sessionId, user.id, new Date(now.getTime() - SESSION_RETENTION_MS - DAY));
    const live = await h.deps.sessions.issue(user.id, device.id);

    await repo.touchDevice(device.id, "stale-hash", new Date(now.getTime() - 31 * DAY));
    const { device: recent } = await newUserWithDevice(repo);
    await repo.touchDevice(recent.id, "fresh-hash", now);

    const report = await janitor(h.deps, now);
    expect(report.emailCodes).toBeGreaterThanOrEqual(1);
    expect(report.sessions).toBeGreaterThanOrEqual(1);
    expect(report.deviceIpHashes).toBeGreaterThanOrEqual(1);
    expect(await repo.findActiveSession(live.session.sessionId, now)).toBeDefined();
    expect(await repo.listActiveSessions(user.id, now)).toHaveLength(1);
    const [stale] = (await db.execute(sql`select ip_hash from auth.devices where id = ${device.id}::uuid`)) as unknown as { ip_hash: string | null }[];
    expect(stale?.ip_hash).toBeNull();
    const [fresh] = (await db.execute(sql`select ip_hash from auth.devices where id = ${recent.id}::uuid`)) as unknown as { ip_hash: string | null }[];
    expect(fresh?.ip_hash).toBe("fresh-hash");
  });

  test("events older than 90 days are purged through the function; the role still cannot delete rows itself", async () => {
    const h = flowHarness(repo);
    const { user } = await newUserWithDevice(repo);
    await repo.appendEvent({ userId: user.id, type: "signin_success" });
    await repo.appendEvent({ userId: user.id, type: "signin_failure" });
    await migrateDb.execute(sql`update auth.auth_events set created_at = now() - interval '91 days' where user_id = ${user.id}::uuid and type = 'signin_success'`);

    // Drizzle wraps driver errors ("Failed query: ..."); the Postgres error is the cause.
    const failure = await db.execute(sql`delete from auth.auth_events where user_id = ${user.id}::uuid`).then(() => null, (err: unknown) => err);
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied for table auth_events/);
    const report = await janitor(h.deps, h.clock.now());
    expect(report.events).toBeGreaterThanOrEqual(1);
    expect((await repo.recentEvents(user.id)).map((e) => e.type)).toEqual(["signin_failure"]);
  });
});
```

### Replace `apps/api/test/config.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config";

const key = Buffer.alloc(32, 7).toString("base64");

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(good);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.TRUSTED_ORIGINS).toEqual([]);
  });
  test("parses trusted origins list", () => {
    expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://a.test, http://b.test" }).TRUSTED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
  test("fails loudly on a missing database url", () => {
    expect(() => loadConfig({ REDIS_URL: good.REDIS_URL })).toThrow(/DATABASE_URL_API/);
  });
  test("rejects keys shorter than 32 bytes", () => {
    expect(() => loadConfig({ ...good, AUTH_HMAC_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/AUTH_HMAC_KEY/);
  });
  test("TOTP key must be versioned and exactly 32 bytes", () => {
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: key })).toThrow(/TOTP_ENC_KEY/);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: `v1:${Buffer.alloc(33).toString("base64")}` })).toThrow(/TOTP_ENC_KEY/);
  });
  test("SMTP_URL must be smtp or smtps", () => {
    expect(() => loadConfig({ ...good, SMTP_URL: "http://relay.example" })).toThrow(/SMTP_URL/);
    expect(loadConfig({ ...good, SMTP_URL: "smtps://user:pass@relay.example:465" }).SMTP_URL).toMatch(/^smtps:/);
  });
  test("every auth variable is required", () => {
    for (const name of ["APP_ORIGIN", "AUTH_HMAC_KEY", "IP_HASH_KEY", "TOTP_ENC_KEY", "TURNSTILE_SECRET_KEY", "SMTP_URL", "MAIL_FROM", "TERMS_VERSION"]) {
      const env: Record<string, string | undefined> = { ...good };
      delete env[name];
      expect(() => loadConfig(env), name).toThrow(new RegExp(name));
    }
  });
  test("TRUST_PROXY defaults to none and accepts the three modes", () => {
    expect(loadConfig(good).TRUST_PROXY).toBe("none");
    for (const mode of ["cloudflare", "caddy", "none"]) expect(loadConfig({ ...good, TRUST_PROXY: mode }).TRUST_PROXY).toBe(mode);
    expect(() => loadConfig({ ...good, TRUST_PROXY: "nginx" })).toThrow(/TRUST_PROXY/);
  });
  describe("production refuses development values", () => {
    const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
    test("accepts a production configuration", () => {
      expect(loadConfig(prod).NODE_ENV).toBe("production");
    });
    test("refuses Cloudflare's test secrets", () => {
      for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
        expect(() => loadConfig({ ...prod, TURNSTILE_SECRET_KEY: secret }), secret).toThrow(/TURNSTILE_SECRET_KEY/);
      }
    });
    test("requires https for the app origin and every trusted origin", () => {
      expect(() => loadConfig({ ...prod, APP_ORIGIN: "http://korbat.example" })).toThrow(/APP_ORIGIN/);
      expect(() => loadConfig({ ...prod, TRUSTED_ORIGINS: "https://a.example, http://b.example" })).toThrow(/TRUSTED_ORIGINS/);
    });
    test("development keeps accepting them", () => {
      expect(loadConfig(good).TURNSTILE_SECRET_KEY).toBe("1x0000000000000000000000000000000AA");
    });
  });
  test("previous TOTP keys are optional, comma-separated and each versioned", () => {
    expect(loadConfig(good).TOTP_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: `v0:${key}, v1:${key}` }).TOTP_ENC_KEYS_PREVIOUS).toEqual([`v0:${key}`, `v1:${key}`]);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: key })).toThrow(/TOTP_ENC_KEYS_PREVIOUS/);
  });
  test("media settings default to the development directories, every format and a 2 GiB free-space floor", () => {
    const c = loadConfig(good);
    expect(c.MEDIA_UPLOADS_DIR).toBe("../../.data/media/uploads");
    expect(c.MEDIA_STORE_DIR).toBe("../../.data/media/store");
    expect(c.MEDIA_FORMATS).toEqual(["jpeg", "png", "webp", "gif", "avif"]);
    expect(c.MEDIA_MIN_FREE_BYTES).toBe(2_147_483_648);
  });
  test("MEDIA_RECONCILE is on by default and takes off or force", () => {
    expect(loadConfig(good).MEDIA_RECONCILE).toBe("on");
    expect(loadConfig({ ...good, MEDIA_RECONCILE: "force" }).MEDIA_RECONCILE).toBe("force");
    expect(() => loadConfig({ ...good, MEDIA_RECONCILE: "maybe" })).toThrow(/MEDIA_RECONCILE/);
  });
  test("MEDIA_FORMATS enables a subset, and a typo stops the process instead of changing what is accepted", () => {
    expect(loadConfig({ ...good, MEDIA_FORMATS: "png, jpeg" }).MEDIA_FORMATS).toEqual(["jpeg", "png"]);
    expect(() => loadConfig({ ...good, MEDIA_FORMATS: "jpeg,tiff" })).toThrow(/unknown formats: tiff/);
    expect(loadConfig({ ...good, MEDIA_MIN_FREE_BYTES: "0", MEDIA_STORE_DIR: "/media/store" })).toMatchObject({ MEDIA_MIN_FREE_BYTES: 0, MEDIA_STORE_DIR: "/media/store" });
  });
});
```

### Replace `apps/api/test/media/files.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { MAX_VARIANT_BYTES, SNIFF_BYTES } from "@korbat/media-protocol";
import { MediaError } from "../../src/media/context";
import { createMediaFiles } from "../../src/media/files";

const root = mkdtempSync(path.join(tmpdir(), "korbat-media-files-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function volumes(storeDevice?: number) {
  const base = path.join(root, randomUUID());
  const files = createMediaFiles({ uploadsDir: path.join(base, "uploads"), storeDir: path.join(base, "store"), log: pino({ level: "silent" }), storeDevice });
  await files.prepare();
  for (const dir of [files.store.files, files.store.results, files.store.attempts, files.store.tmp]) mkdirSync(dir, { recursive: true });
  return files;
}

/** A body that arrives in chunks and declares no length, like a chunked upload. */
function chunked(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      controller.close();
    },
  });
}
const accept = () => undefined;

describe("receiving an upload", () => {
  test("the body is streamed to tmp/ and only becomes an upload when committed", async () => {
    const files = await volumes();
    const id = randomUUID();
    expect(await files.receive(id, chunked("hello ", "world"), 100, accept)).toBe(11);
    expect(readFileSync(files.uploads.part(id), "utf8")).toBe("hello world");
    expect(existsSync(files.uploads.upload(id))).toBe(false);
    await files.commit(id);
    expect(readFileSync(files.uploads.upload(id), "utf8")).toBe("hello world");
    expect(existsSync(files.uploads.part(id))).toBe(false);
  });

  test("the first bytes are judged before anything is written", async () => {
    const files = await volumes();
    const id = randomUUID();
    let seen = 0;
    let onDisk = true;
    const body = chunked(new Uint8Array(200).fill(1), new Uint8Array(200).fill(2), new Uint8Array(200).fill(3));
    await files.receive(id, body, 10_000, (head) => {
      seen = head.byteLength;
      onDisk = existsSync(files.uploads.part(id));
    });
    expect(seen).toBe(SNIFF_BYTES);
    expect(onDisk).toBe(false);
    expect(statSync(files.uploads.part(id)).size).toBe(600);
  });

  test("a refused head leaves no file behind", async () => {
    const files = await volumes();
    const id = randomUUID();
    const refuse = () => {
      throw new MediaError("unsupported_media_type", 415);
    };
    await expect(files.receive(id, chunked("%PDF-1.7"), 100, refuse)).rejects.toMatchObject({ code: "unsupported_media_type", status: 415 });
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
  });

  test("an empty or missing body reaches the judge as zero bytes", async () => {
    const files = await volumes();
    const heads: number[] = [];
    await files.receive(randomUUID(), chunked(), 100, (head) => void heads.push(head.byteLength));
    await files.receive(randomUUID(), null, 100, (head) => void heads.push(head.byteLength));
    expect(heads).toEqual([0, 0]);
  });

  test("bytes are counted as they arrive: one byte over the limit ends the upload and removes the file", async () => {
    const files = await volumes();
    const id = randomUUID();
    const kib = new Uint8Array(1024);
    await expect(files.receive(id, chunked(kib, kib, kib, new Uint8Array(1)), 3 * 1024, accept)).rejects.toMatchObject({ code: "file_too_large", status: 413 });
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
    expect(await files.receive(randomUUID(), chunked(kib, kib, kib), 3 * 1024, accept)).toBe(3 * 1024);
  });

  test("the same id cannot be received twice", async () => {
    const files = await volumes();
    const id = randomUUID();
    await files.receive(id, chunked("a"), 100, accept);
    await expect(files.receive(id, chunked("b"), 100, accept)).rejects.toMatchObject({ code: "EEXIST" });
  });

  test("discarding removes an upload whether it was committed or not", async () => {
    const files = await volumes();
    const [partial, complete] = [randomUUID(), randomUUID()];
    await files.receive(partial, chunked("a"), 100, accept);
    await files.receive(complete, chunked("b"), 100, accept);
    await files.commit(complete);
    await files.discardUpload(partial);
    await files.discardUpload(complete);
    await files.discardUpload(randomUUID());
    expect([...readdirSync(files.uploads.tmp), ...readdirSync(files.uploads.incoming)]).toEqual([]);
  });

  test("preparing again clears half-received bodies and keeps complete uploads", async () => {
    const files = await volumes();
    const [partial, complete] = [randomUUID(), randomUUID()];
    await files.receive(partial, chunked("a"), 100, accept);
    await files.receive(complete, chunked("b"), 100, accept);
    await files.commit(complete);
    await files.prepare();
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
    expect(readdirSync(files.uploads.incoming)).toEqual([complete]);
  });
});

describe("reading the store, which is not trusted", () => {
  const ready = (id: string) => ({ v: 1, id, status: "ready", width: 800, height: 600, blurhash: "L2Eo_P_3jb_3" });

  test("a result that follows the protocol is returned", async () => {
    const files = await volumes();
    const id = randomUUID();
    expect(await files.readResult(id)).toBeNull();
    writeFileSync(files.store.result(id), JSON.stringify(ready(id)));
    expect(await files.readResult(id)).toEqual(ready(id));
  });

  test("anything else is ignored: not JSON, extra keys, another id, too large, a directory", async () => {
    const files = await volumes();
    const [a, b, c, d, e] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    writeFileSync(files.store.result(a), "not json");
    writeFileSync(files.store.result(b), JSON.stringify({ ...ready(b), path: "/etc/passwd" }));
    writeFileSync(files.store.result(c), JSON.stringify(ready(randomUUID())));
    writeFileSync(files.store.result(d), JSON.stringify({ ...ready(d), blurhash: "x".repeat(40_000) }));
    mkdirSync(files.store.result(e));
    for (const id of [a, b, c, d, e]) expect(await files.readResult(id), id).toBeNull();
  });

  test("an image is opened with its size, and the caller gets a handle to stream", async () => {
    const files = await volumes();
    const id = randomUUID();
    expect(await files.openImage(id, "large")).toBeNull();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), "webp-bytes");
    const stored = await files.openImage(id, "large");
    expect(stored?.size).toBe(10);
    expect(await stored!.handle.readFile("utf8")).toBe("webp-bytes");
    await stored!.handle.close();
  });

  test("a file on another device is refused: that is what a symlink out of the volume looks like", async () => {
    const files = await volumes(-1);
    const id = randomUUID();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), "webp-bytes");
    writeFileSync(files.store.result(id), JSON.stringify(ready(id)));
    expect(await files.openImage(id, "large")).toBeNull();
    expect(await files.readResult(id)).toBeNull();
  });

  test.skipIf(process.platform === "win32")("a symlink in place of an image is not followed", async () => {
    const files = await volumes();
    const id = randomUUID();
    const secret = path.join(root, `${randomUUID()}.secret`);
    writeFileSync(secret, "DATABASE_URL=secret");
    mkdirSync(files.store.imageDir(id), { recursive: true });
    symlinkSync(secret, files.store.image(id, "large"));
    expect(await files.openImage(id, "large")).toBeNull();
  });

  test.skipIf(process.platform === "win32")("a FIFO in place of an image is refused at once instead of blocking a thread", { timeout: 5_000 }, async () => {
    const files = await volumes();
    const id = randomUUID();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    execFileSync("mkfifo", [files.store.image(id, "large")]);
    expect(await files.openImage(id, "large")).toBeNull();
    expect(await files.readResult(id)).toBeNull();
  });

  test("an oversized image and a directory are refused", async () => {
    const files = await volumes();
    const [big, dir] = [randomUUID(), randomUUID()];
    mkdirSync(files.store.imageDir(big), { recursive: true });
    writeFileSync(files.store.image(big, "small"), "");
    truncateSync(files.store.image(big, "small"), MAX_VARIANT_BYTES + 1);
    mkdirSync(files.store.image(dir, "small"), { recursive: true });
    expect(await files.openImage(big, "small")).toBeNull();
    expect(await files.openImage(dir, "small")).toBeNull();
  });
});

describe("deletion requests and the sweeper's view", () => {
  test("a request is an empty file; it is withdrawn once nothing remains", async () => {
    const files = await volumes();
    const id = randomUUID();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    await files.requestDeletion([id]);
    await files.requestDeletion([id]);
    expect(await files.deletionRequests()).toEqual([id]);
    expect(statSync(files.uploads.deletion(id)).size).toBe(0);
    expect(await files.imageRemains(id)).toBe(true);
    rmSync(files.store.imageDir(id), { recursive: true });
    expect(await files.imageRemains(id)).toBe(false);
    await files.withdrawDeletion(id);
    expect(await files.deletionRequests()).toEqual([]);
  });

  test("a leftover result also counts as remaining", async () => {
    const files = await volumes();
    const id = randomUUID();
    writeFileSync(files.store.result(id), "{}");
    expect(await files.imageRemains(id)).toBe(true);
  });

  test("images and uploads on disk are listed with their age; stray names are skipped", async () => {
    const files = await volumes();
    const [image, upload, partial] = [randomUUID(), randomUUID(), randomUUID()];
    mkdirSync(files.store.imageDir(image), { recursive: true });
    mkdirSync(path.join(files.store.files, "zz", "stray"), { recursive: true });
    mkdirSync(path.join(files.store.files, image.slice(0, 2), "not-an-id"), { recursive: true });
    await files.receive(upload, chunked("a"), 100, accept);
    await files.commit(upload);
    await files.receive(partial, chunked("b"), 100, accept);
    writeFileSync(path.join(files.uploads.incoming, "stray"), "x");
    const now = Date.now() + 60_000;
    expect((await files.storedImages(now)).map((entry) => entry.id)).toEqual([image]);
    expect((await files.storedImages(now))[0]!.ageMs).toBeGreaterThan(50_000);
    expect((await files.storedUploads(now)).map((entry) => entry.id).sort()).toEqual([upload, partial].sort());
  });
});

describe("heartbeat and free space", () => {
  test("the heartbeat's age is measured against the clock; a missing or broken one is null", async () => {
    const files = await volumes();
    expect(await files.heartbeatAge(1_000)).toBeNull();
    writeFileSync(files.store.heartbeat, JSON.stringify({ v: 1, at: 1_000 }));
    expect(await files.heartbeatAge(31_000)).toBe(30_000);
    writeFileSync(files.store.heartbeat, "soon");
    expect(await files.heartbeatAge(31_000)).toBeNull();
    writeFileSync(files.store.heartbeat, JSON.stringify({ v: 1, at: 1_000, pid: 7 }));
    expect(await files.heartbeatAge(31_000)).toBeNull();
  });

  test("free space is a number of bytes", async () => {
    const files = await volumes();
    expect(await files.freeBytes()).toBeGreaterThan(0);
  });
});
```

### Replace `apps/api/test/integration/media-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import pino from "pino";
import { postMedia, posts, type Db } from "@korbat/db";
import type { MediaFailure } from "@korbat/contracts";
import { MEDIA_FORMATS, storeLayout, type MediaFormat, type StoreLayout } from "@korbat/media-protocol";
import type { MediaDeps } from "../../src/media/context";
import { createMediaFiles } from "../../src/media/files";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { createMediaRepo } from "../../src/media/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { enforceWriteLimit } from "../../src/social/limits";
import { createSocialRepo } from "../../src/social/repo";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { newPost, newProfile, ticker } from "./social-fixtures";

/** The first bytes of each kind of file. The API judges an upload by these and never decodes it. */
export const BYTES = {
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF-test-image")]),
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-test-image")]),
  pdf: Buffer.from("%PDF-1.7 not an image"),
  heic: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1heic")]),
  animatedWebp: Buffer.concat([Buffer.from("RIFF"), Buffer.from([40, 0, 0, 0]), Buffer.from("WEBPVP8X"), Buffer.from([10, 0, 0, 0, 0x02, 0, 0, 0])]),
};

/** A request body that arrives in chunks and declares no length. */
export function bodyOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Stands in for the worker: writes files and results into a store directory exactly as the protocol says, without decoding anything. */
export function fakeWorker(store: StoreLayout | string) {
  const layout = typeof store === "string" ? storeLayout(store) : store;
  for (const dir of [layout.files, layout.results, layout.attempts, layout.tmp]) mkdirSync(dir, { recursive: true });
  return {
    /** What the worker leaves behind for an image it accepted. */
    ready(id: string, size: { width: number; height: number } = { width: 2048, height: 1536 }) {
      mkdirSync(layout.imageDir(id), { recursive: true });
      writeFileSync(layout.image(id, "large"), `large-webp-of-${id}`);
      writeFileSync(layout.image(id, "small"), `small-webp-of-${id}`);
      writeFileSync(layout.result(id), JSON.stringify({ v: 1, id, status: "ready", ...size, blurhash: "L2Eo_P_3jb_3~qoL" }));
    },
    /** What it leaves behind for one it refused. */
    failed(id: string, reason: MediaFailure) {
      writeFileSync(layout.result(id), JSON.stringify({ v: 1, id, status: "failed", reason }));
    },
    /** A heartbeat written at the given time. */
    beat(at: number) {
      writeFileSync(layout.heartbeat, JSON.stringify({ v: 1, at }));
    },
  };
}

/**
 * The media module on real Postgres, with both volumes in a temporary directory and a stand-in for
 * the worker that writes files and results exactly as the protocol says. Nothing here decodes an image.
 */
export async function mediaHarness(db: Db, options: { formats?: readonly MediaFormat[]; minFreeBytes?: number; storeDevice?: number; clockStart?: number } = {}) {
  const clock = ticker(options.clockStart);
  const root = mkdtempSync(path.join(tmpdir(), "korbat-media-"));
  const files = createMediaFiles({ uploadsDir: path.join(root, "uploads"), storeDir: path.join(root, "store"), log: pino({ level: "silent" }), storeDevice: options.storeDevice });
  await files.prepare();

  const limits = new MemoryStore(() => clock.now().getTime());
  const deps: MediaDeps = {
    repo: createMediaRepo(db),
    files,
    formats: options.formats ?? MEDIA_FORMATS,
    minFreeBytes: options.minFreeBytes ?? 0,
    reconcileMode: "on",
    enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(limits, userId, "upload", accountCreatedAt, now),
    log: pino({ level: "silent" }),
    now: clock.next,
  };

  const worker = fakeWorker(files.store);

  /** An image of this account that the worker accepted and the API recorded: ready, on no post yet. */
  async function readyImage(ownerId: string, size?: { width: number; height: number }): Promise<string> {
    const sent = await upload(deps, ownerId, { contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.jpeg) });
    worker.ready(sent.id, size);
    await status(deps, ownerId, sent.id);
    return sent.id;
  }

  /** A post by this account with ready images on it, written straight to the tables. */
  async function postWithImages(authorId: string, count = 1, body = "a post with images"): Promise<{ postId: string; mediaIds: string[] }> {
    const postId = await newPost(createSocialRepo(db), authorId, clock.next(), body);
    const mediaIds: string[] = [];
    for (let position = 0; position < count; position++) {
      const id = await readyImage(authorId);
      await db.update(postMedia).set({ postId, position, altText: `image ${position + 1}` }).where(eq(postMedia.id, id));
      mediaIds.push(id);
    }
    return { postId, mediaIds };
  }

  const setPostState = (postId: string, state: "visible" | "withheld" | "removed" | "deleted_by_author") => db.update(posts).set({ state }).where(eq(posts.id, postId));

  return {
    deps,
    files,
    clock,
    worker,
    readyImage,
    postWithImages,
    setPostState,
    jpeg: () => ({ contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.jpeg) }),
    /** An account old enough for the established tier. */
    established: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - 3 * DAY_MS) }),
    /** An account in its first day. */
    fresh: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - HOUR_MS) }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    newId: randomUUID,
  };
}

export type MediaHarness = Awaited<ReturnType<typeof mediaHarness>>;
```

### Replace `apps/api/test/integration/media-sweeper.test.ts` (whole file)

```ts
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { upload } from "../../src/media/flows/upload";
import { MemoryJobLock } from "../../src/lib/jobs";
import {
  DELETION_GRACE_MS,
  ORPHAN_AGE_MS,
  PROCESSING_TIMEOUT_MS,
  RECONCILE_INTERVAL_MS,
  RECONCILE_MAX_ORPHANS,
  SWEEP_INTERVAL_MS,
  UNATTACHED_TTL_MS,
  createSweeper,
  sweep,
} from "../../src/media/sweeper";
import { mediaHarness, type MediaHarness } from "./media-harness";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The sweep acts on every row in the database, and other test files run next to this one. So this
 * file never moves "now": it makes its own rows old by starting a harness clock in the past, and
 * sweeps at the real time. Rows other files create are seconds old and stay out of reach.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the media sweeper", () => {
  let db: Db;
  const harnesses: MediaHarness[] = [];
  const started = (ago: number) => mediaHarness(db, { clockStart: Date.now() - ago }).then((h) => (harnesses.push(h), h));
  const now = () => new Date();

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
  });
  afterAll(async () => {
    for (const h of harnesses) h.cleanup();
    await closeDb(db);
  });

  test("the numbers", () => {
    expect([PROCESSING_TIMEOUT_MS, UNATTACHED_TTL_MS, ORPHAN_AGE_MS, SWEEP_INTERVAL_MS, RECONCILE_INTERVAL_MS]).toEqual([5 * MINUTE, 24 * HOUR, HOUR, 30_000, 10 * MINUTE]);
    expect(DELETION_GRACE_MS).toBe(10 * MINUTE);
  });

  test("a result nobody asked for is recorded, and the upload is removed", async () => {
    const h = await started(MINUTE);
    const ada = await h.established();
    const sent = await upload(h.deps, ada.id, h.jpeg());
    h.worker.ready(sent.id, { width: 640, height: 480 });
    const report = await sweep(h.deps, now(), { reconcile: false });
    expect(report.finalized).toBeGreaterThanOrEqual(1);
    expect(await h.deps.repo.find(sent.id)).toMatchObject({ status: "ready", width: 640, height: 480 });
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(false);
  });

  test("an upload the worker never answered fails after five minutes; a younger one is left alone", async () => {
    const old = await started(6 * MINUTE);
    const young = await started(MINUTE);
    const [ada, bob] = [await old.established(), await young.established()];
    const stuck = await upload(old.deps, ada.id, old.jpeg());
    const waiting = await upload(young.deps, bob.id, young.jpeg());

    expect((await sweep(old.deps, now(), { reconcile: false })).timedOut).toBeGreaterThanOrEqual(1);
    expect(await old.deps.repo.find(stuck.id)).toMatchObject({ status: "failed", error: "processing_failed" });
    expect(existsSync(old.files.uploads.upload(stuck.id))).toBe(false);
    expect(await old.files.deletionRequests()).toContain(stuck.id);
    expect(await young.deps.repo.find(waiting.id)).toMatchObject({ status: "processing" });
    expect(existsSync(young.files.uploads.upload(waiting.id))).toBe(true);
  });

  test("uploads nobody posted within a day are removed with their files; images on posts stay", async () => {
    const h = await started(25 * HOUR);
    const ada = await h.established();
    const forgotten = await h.readyImage(ada.id);
    const refused = await upload(h.deps, ada.id, h.jpeg());
    h.worker.failed(refused.id, "corrupt_image");
    const { mediaIds } = await h.postWithImages(ada.id);

    expect((await sweep(h.deps, now(), { reconcile: false })).expired).toBeGreaterThanOrEqual(2);
    expect(await h.deps.repo.find(forgotten)).toBeNull();
    expect(await h.deps.repo.find(refused.id)).toBeNull();
    expect(await h.files.deletionRequests()).toEqual(expect.arrayContaining([forgotten, refused.id]));
    expect(await h.deps.repo.find(mediaIds[0]!)).toMatchObject({ status: "ready" });
    expect(await h.files.deletionRequests()).not.toContain(mediaIds[0]);
  });

  test("a deletion request is withdrawn once the worker has removed everything, but not before it is ten minutes old", async () => {
    const h = await started(MINUTE);
    const [done, pending, fresh] = [h.newId(), h.newId(), h.newId()];
    mkdirSync(h.files.store.imageDir(pending), { recursive: true });
    await h.files.requestDeletion([done, pending, fresh]);
    const elevenMinutesAgo = new Date(Date.now() - 11 * MINUTE);
    for (const id of [done, pending]) utimesSync(h.files.uploads.deletion(id), elevenMinutesAgo, elevenMinutesAgo);

    expect((await sweep(h.deps, now(), { reconcile: false })).withdrawn).toBe(1);
    expect((await h.files.deletionRequests()).sort()).toEqual([pending, fresh].sort());
  });

  test("reconcile: old files without a row are removed, young ones and ones with a row are not", async () => {
    const h = await started(MINUTE);
    const ada = await h.established();
    const longAgo = new Date(Date.now() - 2 * HOUR);
    const age = (path: string) => utimesSync(path, longAgo, longAgo);

    const [orphanImage, youngImage, orphanUpload, youngUpload] = [h.newId(), h.newId(), h.newId(), h.newId()];
    for (const id of [orphanImage, youngImage]) mkdirSync(h.files.store.imageDir(id), { recursive: true });
    age(h.files.store.imageDir(orphanImage));
    for (const id of [orphanUpload, youngUpload]) writeFileSync(h.files.uploads.upload(id), "bytes");
    age(h.files.uploads.upload(orphanUpload));
    const owned = await h.readyImage(ada.id);
    age(h.files.store.imageDir(owned));

    expect((await sweep(h.deps, now(), { reconcile: false })).orphans).toBe(0);
    expect((await sweep(h.deps, now(), { reconcile: true })).orphans).toBe(2);
    expect(await h.files.deletionRequests()).toEqual([orphanImage]);
    expect(existsSync(h.files.uploads.upload(orphanUpload))).toBe(false);
    expect(existsSync(h.files.uploads.upload(youngUpload))).toBe(true);
    expect(existsSync(h.files.store.imageDir(owned))).toBe(true);
  });

  test("only the instance that holds the lock sweeps; it reconciles once every ten minutes and releases the lock afterwards", async () => {
    const h = await started(MINUTE);
    const lock = new MemoryJobLock();
    await lock.acquire("job:media-sweeper", "another instance", 60_000);
    expect(await createSweeper(h.deps, lock).round()).toBeNull();
    await lock.release("job:media-sweeper", "another instance");

    const orphan = h.newId();
    mkdirSync(h.files.store.imageDir(orphan), { recursive: true });
    const longAgo = new Date(Date.now() - 2 * HOUR);
    utimesSync(h.files.store.imageDir(orphan), longAgo, longAgo);
    h.deps.now = () => new Date();
    const sweeper = createSweeper(h.deps, lock);
    expect((await sweeper.round())?.orphans).toBe(1);
    expect((await sweeper.round())?.orphans).toBe(0);
    expect(await lock.acquire("job:media-sweeper", "another instance", 60_000)).toBe(true);
    expect(await lock.acquire("job:media-sweeper:reconcile", "x", RECONCILE_INTERVAL_MS)).toBe(false);
  });

  test("reconcile refuses to delete many images without a row unless forced, and can be switched off", async () => {
    const h = await started(MINUTE);
    const longAgo = new Date(Date.now() - 2 * HOUR);
    const orphans: string[] = [];
    for (let i = 0; i <= RECONCILE_MAX_ORPHANS; i++) {
      const id = h.newId();
      mkdirSync(h.files.store.imageDir(id), { recursive: true });
      utimesSync(h.files.store.imageDir(id), longAgo, longAgo);
      orphans.push(id);
    }
    const refused = await sweep(h.deps, now(), { reconcile: true });
    expect(refused.refused).toBe(orphans.length);
    expect(refused.orphans).toBe(0);
    expect(await h.files.deletionRequests()).toEqual([]);

    h.deps.reconcileMode = "off";
    expect(await sweep(h.deps, now(), { reconcile: true })).toMatchObject({ orphans: 0, refused: 0 });

    h.deps.reconcileMode = "force";
    expect((await sweep(h.deps, now(), { reconcile: true })).orphans).toBe(orphans.length);
    expect((await h.files.deletionRequests()).sort()).toEqual([...orphans].sort());
  });
});
```

## Step 3: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/config.test.ts (16 tests | 1 failed) 41ms
Test Files  4 failed | 24 passed | 20 skipped (48)
Tests  1 failed | 158 passed | 142 skipped (301)
```

## Step 4: write the implementation

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/05-jobs-retention-media-safety.md 4
```

Expected: 10 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/lib/jobs.ts`

```ts
import { randomBytes } from "node:crypto";
import type Redis from "ioredis";
import type { Logger } from "pino";

/**
 * A lock the API instances share, held by a token while a job round runs. The server builds it on
 * Redis; tests use the in-memory one. A key is also used as a plain marker (`acquire` and let it
 * expire) for work that must not repeat within a window.
 */
export interface JobLock {
  /** True when the key was free and is now held by `token` for `ttlMs`. */
  acquire(key: string, token: string, ttlMs: number): Promise<boolean>;
  /** Extends the hold, only while `token` still holds the key. */
  refresh(key: string, token: string, ttlMs: number): Promise<void>;
  /** Releases the key, only while `token` holds it. */
  release(key: string, token: string): Promise<void>;
}

const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
const REFRESH = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";

export function redisJobLock(redis: Redis): JobLock {
  return {
    acquire: async (key, token, ttlMs) => (await redis.set(key, token, "PX", ttlMs, "NX")) === "OK",
    async refresh(key, token, ttlMs) {
      await redis.eval(REFRESH, 1, key, token, ttlMs);
    },
    async release(key, token) {
      await redis.eval(RELEASE, 1, key, token);
    },
  };
}

/** The same rules in one process, for tests. The clock is injectable. */
export class MemoryJobLock implements JobLock {
  private readonly held = new Map<string, { token: string; until: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private holder(key: string) {
    const entry = this.held.get(key);
    if (entry && entry.until <= this.now()) this.held.delete(key);
    return this.held.get(key);
  }

  async acquire(key: string, token: string, ttlMs: number) {
    if (this.holder(key)) return false;
    this.held.set(key, { token, until: this.now() + ttlMs });
    return true;
  }

  async refresh(key: string, token: string, ttlMs: number) {
    const entry = this.holder(key);
    if (entry?.token === token) entry.until = this.now() + ttlMs;
  }

  async release(key: string, token: string) {
    if (this.holder(key)?.token === token) this.held.delete(key);
  }
}

export interface JobOptions {
  name: string;
  /** Time between the end of one round and the start of the next. */
  intervalMs: number;
  /** How long the lock outlives a crash; refreshed every half of it while a round runs. */
  lockTtlMs: number;
  lock: JobLock;
  log: Logger;
  run: () => Promise<unknown>;
}

export type RoundOutcome = "ran" | "skipped" | "busy";

/**
 * Runs `run` under the lock `job:<name>`. Rounds never overlap: another instance holding the lock
 * means `skipped`, a round still in flight in this process means `busy`, and the timer only starts
 * the next wait once a round has ended. The lock is refreshed while the round runs, so a slow round
 * neither loses it nor lets a second instance start.
 */
export function createJob(options: JobOptions) {
  const key = `job:${options.name}`;
  let inFlight = false;

  async function round(): Promise<RoundOutcome> {
    if (inFlight) return "busy";
    const token = randomBytes(16).toString("hex");
    if (!(await options.lock.acquire(key, token, options.lockTtlMs))) return "skipped";
    inFlight = true;
    const refresh = setInterval(() => {
      void options.lock.refresh(key, token, options.lockTtlMs).catch((err: unknown) => options.log.warn({ err, job: options.name }, "job: could not refresh the lock"));
    }, options.lockTtlMs / 2);
    try {
      await options.run();
      return "ran";
    } finally {
      clearInterval(refresh);
      inFlight = false;
      await options.lock.release(key, token).catch((err: unknown) => options.log.warn({ err, job: options.name }, "job: could not release the lock"));
    }
  }

  /** Starts the timer and returns the function that stops it. A round in flight finishes. */
  function start(): () => void {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(() => {
        void round()
          .catch((err: unknown) => options.log.error({ err, job: options.name }, "job: round failed"))
          .finally(schedule);
      }, options.intervalMs);
      timer.unref();
    };
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  return { round, start };
}
```

### Create `apps/api/src/auth/janitor.ts`

```ts
import { createJob, type JobLock } from "../lib/jobs";
import type { AuthDeps } from "./context";
import { HOUR, MINUTE } from "./limits";

const DAY = 24 * HOUR;

export const JANITOR_INTERVAL_MS = 10 * MINUTE;
/** A code is dead ten minutes after it was sent; the row goes a day later. */
export const EMAIL_CODE_RETENTION_MS = 24 * HOUR;
/** Revoked and expired sessions stay listed nowhere; the rows go after a month. */
export const SESSION_RETENTION_MS = 30 * DAY;
/** The design's IP-hash purge (section 3b): a device keeps its address hash for 30 days after it was last seen. */
export const DEVICE_IP_RETENTION_DAYS = 30;
/** The security log is kept for 90 days. */
export const EVENT_RETENTION_DAYS = 90;

export interface JanitorReport {
  emailCodes: number;
  sessions: number;
  deviceIpHashes: number;
  events: number;
}

/** One pass of retention. A plain function of the clock, so tests call it with whatever time they need. */
export async function janitor(deps: AuthDeps, now: Date): Promise<JanitorReport> {
  const report: JanitorReport = {
    emailCodes: await deps.repo.purgeEmailCodes(new Date(now.getTime() - EMAIL_CODE_RETENTION_MS)),
    sessions: await deps.repo.purgeSessions(new Date(now.getTime() - SESSION_RETENTION_MS)),
    deviceIpHashes: await deps.repo.purgeDeviceIpHashes(new Date(now.getTime() - DEVICE_IP_RETENTION_DAYS * DAY)),
    events: await deps.repo.purgeEvents(EVENT_RETENTION_DAYS),
  };
  if (Object.values(report).some((n) => n > 0)) deps.log.info(report, "auth janitor: rows purged");
  return report;
}

/** Runs the pass every ten minutes under the shared lock. */
export function createJanitor(deps: AuthDeps, lock: JobLock) {
  return createJob({ name: "auth-janitor", intervalMs: JANITOR_INTERVAL_MS, lockTtlMs: JANITOR_INTERVAL_MS, lock, log: deps.log, run: () => janitor(deps, deps.now()) });
}
```

### Replace `apps/api/src/config.ts` (whole file)

```ts
import { z } from "zod";
import { parseFormats } from "@korbat/media-protocol";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A base64 secret that decodes to at least 32 bytes. */
const base64Key = z
  .string()
  .regex(BASE64, "must be base64")
  .refine((s) => Buffer.from(s, "base64").length >= 32, "must decode to at least 32 bytes");

/** `v<N>:<base64>` decoding to exactly 32 bytes (AES-256). The version lets keys rotate. */
const versionedKey = z
  .string()
  .regex(/^v\d+:[A-Za-z0-9+/]+={0,2}$/, "must look like v1:<base64>")
  .refine((s) => Buffer.from(s.slice(s.indexOf(":") + 1), "base64").length === 32, "must decode to exactly 32 bytes");

/** Cloudflare's documented Turnstile test secrets: always pass, always fail, token spent. */
const TURNSTILE_TEST_SECRET = /^[123]x0+AA$/;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_AUTH: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  KORBAT_VERSION: z.string().default("0.0.0-dev"),
  /**
   * Which header names the client: `cloudflare` behind the tunnel (cf-connecting-ip), `caddy` behind Caddy
   * alone (the first X-Forwarded-For entry, which Caddy sets itself), `none` for the socket address only.
   * A header the mode does not trust is ignored, so a client cannot choose its own rate-limit bucket.
   */
  TRUST_PROXY: z.enum(["cloudflare", "caddy", "none"]).default("none"),
  /** Origin of the web app; state-changing cookie requests must come from here (or TRUSTED_ORIGINS). */
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  /** Keys email codes, recovery codes, device ids and email rate-limit buckets. */
  AUTH_HMAC_KEY: base64Key,
  /** Keys IP addresses before they are stored or used as rate-limit buckets. */
  IP_HASH_KEY: base64Key,
  /** Encrypts TOTP secrets at rest. */
  TOTP_ENC_KEY: versionedKey,
  /** Earlier TOTP keys, comma-separated, still accepted for decryption; a secret read with one is re-encrypted with TOTP_ENC_KEY. */
  TOTP_ENC_KEYS_PREVIOUS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(versionedKey)),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  MAIL_FROM: z.string().min(3),
  TERMS_VERSION: z.string().min(1).max(64),
  /** The uploads volume, which the API writes and the image worker only reads. The default suits `pnpm dev` from apps/api. */
  MEDIA_UPLOADS_DIR: z.string().min(1).default("../../.data/media/uploads"),
  /** The store volume, which the image worker writes and the API only reads. */
  MEDIA_STORE_DIR: z.string().min(1).default("../../.data/media/store"),
  /** A comma-separated subset of jpeg, png, webp, gif, avif; unset enables all. The worker reads the same variable. */
  MEDIA_FORMATS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseFormats(value);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: (err as Error).message });
        return z.NEVER;
      }
    }),
  /** Uploads are refused while either media volume has less free space than this. The volumes share a disk with Postgres. */
  MEDIA_MIN_FREE_BYTES: z.coerce.number().int().nonnegative().default(2 * 1024 ** 3),
  /**
   * The sweeper's reconcile pass deletes images that have no row. `on` refuses when there are many of them
   * (a database restored from an older snapshot looks like that); `force` deletes anyway; `off` skips the pass,
   * for the restore window.
   */
  MEDIA_RECONCILE: z.enum(["on", "off", "force"]).default("on"),
}).superRefine((c, ctx) => {
  if (c.NODE_ENV !== "production") return;
  const refuse = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (TURNSTILE_TEST_SECRET.test(c.TURNSTILE_SECRET_KEY)) refuse("TURNSTILE_SECRET_KEY", "is a Turnstile test secret; production needs the secret of your own widget");
  if (!c.APP_ORIGIN.startsWith("https://")) refuse("APP_ORIGIN", "must be an https origin in production");
  for (const origin of c.TRUSTED_ORIGINS) if (!origin.startsWith("https://")) refuse("TRUSTED_ORIGINS", `${origin} is not an https origin`);
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit } from "./social";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles: createProfileStore(apiDb),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  reconcile: config.MEDIA_RECONCILE,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
const stopJanitor = auth.startJanitor(jobLock);

const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, media: media.forPosts });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopJanitor();
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { authEventType, authEvents, devices, emailCodePurpose, emailCodes, sessions, userRole, users, type Db } from "@korbat/db";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionListRow {
  id: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    /** Replaces the hash only, after a sign-in verified the password against older parameters. */
    async replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    /** The same secret re-encrypted with the current key; nothing else about MFA changes. */
    async setTotpSecretEnc(userId: string, totpSecretEnc: string): Promise<void> {
      await db.update(users).set({ totpSecretEnc }).where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    /** A revoked device no longer carries live sessions and counts as new at its next sign-in. */
    async revokeDevice(id: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
    },

    // ------------------------------------------------------------ sessions

    async createSession(input: { id: string; userId: string; deviceId: string; now: Date; expiresAt: Date; absoluteExpiresAt: Date }): Promise<void> {
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    async setReauth(id: string, now: Date): Promise<void> {
      await db.update(sessions).set({ reauthAt: now }).where(eq(sessions.id, id));
    },

    /** Revokes one session of this user. False when it does not belong to the user or is already revoked. */
    async revokeSession(id: string, userId: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    // ------------------------------------------------------------ retention

    /** Codes consumed or expired before `before` are of no use to anyone; they still hold an email and an ip hash. */
    async purgeEmailCodes(before: Date): Promise<number> {
      const rows = await db
        .delete(emailCodes)
        .where(or(and(sql`${emailCodes.consumedAt} is not null`, lt(emailCodes.consumedAt, before)), lt(emailCodes.expiresAt, before)))
        .returning({ id: emailCodes.id });
      return rows.length;
    },

    /** Sessions revoked or expired before `before`. Live ones are never touched. */
    async purgeSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(or(and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, before)), lt(sessions.expiresAt, before), lt(sessions.absoluteExpiresAt, before)))
        .returning({ id: sessions.id });
      return rows.length;
    },

    /** The design's IP-hash purge: a device not seen since `before` keeps no address hash. */
    async purgeDeviceIpHashes(before: Date): Promise<number> {
      const rows = await db
        .update(devices)
        .set({ ipHash: null })
        .where(and(sql`${devices.ipHash} is not null`, lt(devices.lastSeenAt, before)))
        .returning({ id: devices.id });
      return rows.length;
    },

    /**
     * Events older than `days` days, through auth.purge_events (migration 0007): the table stays
     * append-only for this role, which holds no DELETE on it; the function is owned by the migrator.
     */
    async purgeEvents(days: number): Promise<number> {
      const [row] = (await db.execute(sql`select auth.purge_events(make_interval(days => ${days}::int)) as removed`)) as unknown as { removed: number }[];
      return Number(row?.removed ?? 0);
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },
  };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { Db } from "@korbat/db";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore } from "./context";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStaffMfa, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions } from "./sessions";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";

export type { ProfileStore } from "./context";
export type { UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export { AuthError, isUniqueViolation } from "./context";
export { grantRole } from "./admin";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

export interface CreateAuthOptions {
  config: Config;
  logger: Logger;
  /** The korbat_auth pool. The auth module never receives the API pool. */
  authDb: Db;
  mailer: Mailer;
  profiles: ProfileStore;
  /** Either a Redis client or a ready key-value store (tests use an in-memory store). */
  redis?: Redis;
  kv?: KeyValueStore;
  turnstile?: TurnstileVerifier;
  breachChecker?: BreachChecker;
  now?: () => Date;
}

export function createAuth(options: CreateAuthOptions) {
  const kv = options.kv ?? (options.redis ? redisKv(options.redis) : undefined);
  if (!kv) throw new Error("createAuth needs a Redis client or a key-value store");
  const now = options.now ?? (() => new Date());
  const repo = createAuthRepo(options.authDb);
  const sessions = createSessions({ repo, kv, now });
  const deps: AuthDeps = {
    repo,
    kv,
    sessions,
    lockout: createLockout({ repo, kv, now }),
    mailer: options.mailer,
    turnstile: options.turnstile ?? cloudflareTurnstile(options.config.TURNSTILE_SECRET_KEY),
    breachChecker: options.breachChecker ?? hibpChecker(),
    profiles: options.profiles,
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    requireStaffMfa,
    /** Starts the retention pass (dead codes, old sessions, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/media/context.ts` (whole file)

```ts
import type { MediaAttachment, MediaErrorCode, MediaView } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { MediaFormat } from "@korbat/media-protocol";
import type { Logger } from "pino";
import type { MediaFiles } from "./files";
import type { MediaRepo } from "./repo";

/** The media codes plus the shared ones the module also raises. */
export type MediaErrorKind = MediaErrorCode | "not_found" | "invalid_request";
export type MediaErrorStatus = 400 | 404 | 409 | 413 | 415 | 503;

const MESSAGES: Record<MediaErrorKind, string> = {
  unsupported_media_type: "That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.",
  file_too_large: "Images can be at most 20 MB.",
  too_many_pending_uploads: "You have too many images waiting to be posted. Post or remove some first.",
  uploads_unavailable: "Image uploads are temporarily unavailable. Try again later.",
  media_unavailable: "One of the images is not available. Remove it and add it again.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
};

/** What an iPhone calls a photo. The decoder cannot read it, so the message says what to do instead. */
export const HEIC_MESSAGE = "HEIC photos are not supported. Export the photo as JPEG and try again.";

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorKind,
    readonly status: MediaErrorStatus,
    message: string = MESSAGES[code],
  ) {
    super(message);
    this.name = "MediaError";
  }
}

export function mediaErrorMessage(code: MediaErrorKind): string {
  return MESSAGES[code];
}

/**
 * What the social module needs from this one. `attach` and `detachAll` run inside the social
 * module's own transaction; `requestDeletion` runs after it committed, because files cannot be
 * rolled back.
 */
export interface MediaForPosts {
  attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly MediaAttachment[] }): Promise<void>;
  detachAll(tx: DbTx, postId: string): Promise<string[]>;
  requestDeletion(ids: readonly string[]): Promise<void>;
  forPosts(postIds: readonly string[]): Promise<Map<string, MediaView[]>>;
}

/** How many uploads one account may hold that are not on a post yet. */
export const MAX_PENDING_UPLOADS = 20;

export interface MediaDeps {
  repo: MediaRepo;
  files: MediaFiles;
  /** The formats MEDIA_FORMATS enables. The worker reads the same setting. */
  formats: readonly MediaFormat[];
  /** Uploads are refused while either volume has less free space than this. */
  minFreeBytes: number;
  /** See MEDIA_RECONCILE. `on` refuses to delete many orphans at once; `force` does not; `off` skips the pass. */
  reconcileMode: "on" | "off" | "force";
  /** Counts one upload against the account's hourly limit and throws when it is used up. */
  enforceUploadLimit: (userId: string, accountCreatedAt: Date, now: Date) => Promise<void>;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/media/index.ts` (whole file)

```ts
/**
 * The only file outside `src/media/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import { HEARTBEAT_STALE_MS, type MediaFormat } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { MediaDeps, MediaForPosts } from "./context";
import { createMediaFiles } from "./files";
import { createMediaRepo } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";
import type { JobLock } from "../lib/jobs";
import { createSweeper, sweep } from "./sweeper";

export { MediaError } from "./context";
export type { MediaDeps, MediaForPosts } from "./context";
export type { SweepReport } from "./sweeper";

export interface CreateMediaOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The uploads volume, which the API writes, and the store volume, which it only reads. */
  uploadsDir: string;
  storeDir: string;
  formats: readonly MediaFormat[];
  minFreeBytes: number;
  /** See MEDIA_RECONCILE; defaults to `on`. */
  reconcile?: "on" | "off" | "force";
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's resolveSession. The file routes run it themselves, and only when they must. */
  resolveSession: MiddlewareHandler<AppEnv>;
  /** Image requests have their own per-IP bucket in the store the other limits use. */
  rateLimitStore: RateLimitStore;
  /** Built from the social module's write limits, so every per-account limit lives in one table. */
  enforceUploadLimit: MediaDeps["enforceUploadLimit"];
  now?: () => Date;
}

export function createMedia(options: CreateMediaOptions) {
  const deps: MediaDeps = {
    repo: createMediaRepo(options.apiDb),
    files: createMediaFiles({ uploadsDir: options.uploadsDir, storeDir: options.storeDir, log: options.logger }),
    formats: options.formats,
    minFreeBytes: options.minFreeBytes,
    reconcileMode: options.reconcile ?? "on",
    enforceUploadLimit: options.enforceUploadLimit,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forPosts: MediaForPosts = {
    attach: (tx, input) => deps.repo.attach(tx, input),
    detachAll: (tx, postId) => deps.repo.detachAll(tx, postId),
    requestDeletion: (ids) => deps.files.requestDeletion(ids),
    forPosts: (postIds) => deps.repo.forPosts(postIds),
  };
  return {
    deps,
    /** The interface the social module uses to put images on posts and read them back. */
    forPosts,
    /** Creates the uploads volume's directories. Call once before serving. */
    prepare: () => deps.files.prepare(),
    routes: mediaRoutes(deps, options.requireSession),
    /** Mounted before the global rate limit and session resolution. */
    fileRoutes: mediaFileRoutes(deps, { resolveSession: options.resolveSession, rateLimitStore: options.rateLimitStore }),
    /** One pass of housekeeping at the given time. The server runs it on a timer; tests call it directly. */
    sweep: (now: Date, options: { reconcile: boolean }) => sweep(deps, now, options),
    /** Starts sweeping every thirty seconds under the shared job lock, and returns the function that stops it. */
    startSweeper: (lock: JobLock) => createSweeper(deps, lock).start(),
    /** An advisory health check: the worker's heartbeat is fresh and the volumes have room. */
    async healthCheck(): Promise<void> {
      const age = await deps.files.heartbeatAge(deps.now().getTime());
      if (age === null || age > HEARTBEAT_STALE_MS) throw new Error("the image worker's heartbeat is missing or stale");
      if ((await deps.files.freeBytes()) < deps.minFreeBytes) throw new Error("free space on the media volumes is under the floor");
    },
  };
}

export type Media = ReturnType<typeof createMedia>;
```

### Replace `apps/api/src/media/sweeper.ts` (whole file)

```ts
import { createJob, type JobLock } from "../lib/jobs";
import type { MediaDeps } from "./context";
import { finalize } from "./flows/status";

/** An upload the worker has not answered for this long has failed. Normal processing takes seconds. */
export const PROCESSING_TIMEOUT_MS = 5 * 60_000;
/** An upload nobody put on a post within a day is removed. */
export const UNATTACHED_TTL_MS = 24 * 60 * 60_000;
/** Files without a row are only treated as orphans once they are this old, so work in flight is never touched. */
export const ORPHAN_AGE_MS = 60 * 60_000;
/**
 * A deletion request stays at least this long. The worker may be in the middle of an image when
 * the request arrives, and writes its files afterwards; one image takes at most two minutes before
 * the worker's watchdog ends it, so after ten the request has been seen with everything in place.
 */
export const DELETION_GRACE_MS = 10 * 60_000;
export const SWEEP_INTERVAL_MS = 30_000;
export const RECONCILE_INTERVAL_MS = 10 * 60_000;
/**
 * Reconcile refuses to delete images without a row when there are more of them than both of these:
 * a database restored from an older snapshot has rows missing for every image posted since, and
 * those images must not go. MEDIA_RECONCILE=force overrides it once the operator has checked.
 */
export const RECONCILE_MAX_ORPHANS = 50;
export const RECONCILE_MAX_ORPHAN_SHARE = 0.02;

export interface SweepReport {
  finalized: number;
  timedOut: number;
  expired: number;
  withdrawn: number;
  orphans: number;
  /** Orphan images the reconcile pass refused to delete. */
  refused: number;
}

/**
 * Housekeeping that no request triggers. It is a plain function of the clock, so tests call it
 * with whatever time they need. Every step is safe to repeat and safe to run next to live traffic.
 */
export async function sweep(deps: MediaDeps, now: Date, options: { reconcile: boolean }): Promise<SweepReport> {
  const report: SweepReport = { finalized: 0, timedOut: 0, expired: 0, withdrawn: 0, orphans: 0, refused: 0 };

  // 1. Results nobody asked for: the composer was closed, or the post was written from another device.
  for (const id of await deps.repo.processingIds()) {
    if (await finalize(deps, id)) report.finalized++;
  }

  // 2. Uploads the worker never answered, because it was down or the file killed it three times.
  const stale = await deps.repo.failStale(new Date(now.getTime() - PROCESSING_TIMEOUT_MS));
  // 3. Uploads nobody posted.
  const expired = await deps.repo.deleteUnattachedBefore(new Date(now.getTime() - UNATTACHED_TTL_MS));
  report.timedOut = stale.length;
  report.expired = expired.length;
  for (const id of [...stale, ...expired]) await deps.files.discardUpload(id);
  await deps.files.requestDeletion([...stale, ...expired]);

  // 4. Deletion requests the worker has carried out, once they are old enough to have covered late writes.
  for (const { id, ageMs } of await deps.files.deletionRequestAges(now.getTime())) {
    if (ageMs < DELETION_GRACE_MS || (await deps.files.imageRemains(id))) continue;
    await deps.files.withdrawDeletion(id);
    report.withdrawn++;
  }

  // 5. What a crash between a commit and a file operation left behind, and the files of deleted
  //    accounts, whose rows went by cascade.
  if (options.reconcile && deps.reconcileMode !== "off") {
    const nowMs = now.getTime();
    const stored = await deps.files.storedImages(nowMs);
    const images = stored.filter((entry) => entry.ageMs > ORPHAN_AGE_MS).map((entry) => entry.id);
    const uploads = (await deps.files.storedUploads(nowMs)).filter((entry) => entry.ageMs > ORPHAN_AGE_MS).map((entry) => entry.id);
    const known = await deps.repo.existing([...new Set([...images, ...uploads])]);
    const orphanImages = images.filter((id) => !known.has(id));
    const orphanUploads = uploads.filter((id) => !known.has(id));
    for (const id of orphanUploads) await deps.files.discardUpload(id);
    const tooMany = orphanImages.length > RECONCILE_MAX_ORPHANS && orphanImages.length > stored.length * RECONCILE_MAX_ORPHAN_SHARE;
    if (tooMany && deps.reconcileMode !== "force") {
      report.refused = orphanImages.length;
      report.orphans = orphanUploads.length;
      deps.log.error(
        { images: orphanImages.length, stored: stored.length },
        "media: reconcile refused to delete this many images without a row. If the database was restored from an older snapshot, restore the store from the same one; if the images are really orphans, set MEDIA_RECONCILE=force for one pass",
      );
    } else {
      await deps.files.requestDeletion(orphanImages);
      report.orphans = orphanImages.length + orphanUploads.length;
      if (report.orphans > 0) deps.log.warn({ images: orphanImages.length, uploads: orphanUploads.length }, "media: removed files that had no row");
    }
  }
  return report;
}

/**
 * The sweeper as a job: one instance at a time, rounds never overlapping, the lock refreshed while a
 * long reconcile runs. The reconcile marker is a second key that simply expires every ten minutes.
 */
export function createSweeper(deps: MediaDeps, lock: JobLock) {
  let last: SweepReport | null = null;
  const job = createJob({
    name: "media-sweeper",
    intervalMs: SWEEP_INTERVAL_MS,
    lockTtlMs: SWEEP_INTERVAL_MS,
    lock,
    log: deps.log,
    run: async () => {
      const reconcile = await lock.acquire("job:media-sweeper:reconcile", "due", RECONCILE_INTERVAL_MS);
      last = await sweep(deps, deps.now(), { reconcile });
    },
  });
  return {
    /** One round now: the report, or null when another instance holds the lock or a round is still in flight. */
    async round(): Promise<SweepReport | null> {
      last = null;
      return (await job.round()) === "ran" ? last : null;
    },
    /** Sweeps every thirty seconds until the returned function is called. */
    start: job.start,
  };
}
```

### Replace `apps/api/src/media/files.ts` (whole file)

```ts
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, stat, statfs, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { MediaSize } from "@korbat/contracts";
import { Heartbeat, MAX_RESULT_BYTES, MAX_VARIANT_BYTES, ResultFile, SNIFF_BYTES, isMediaId, storeLayout, uploadsLayout } from "@korbat/media-protocol";
import { MediaError } from "./context";

/**
 * The API's side of the file protocol (section 2.2 of the 2b design). The API writes the uploads
 * volume and only reads the store volume, which belongs to the worker. The worker runs the image
 * decoder, so everything in the store is treated as written by an attacker: a file is opened first
 * and the open handle is checked afterwards, which leaves no gap between the check and the use.
 */

export interface StoredFile {
  handle: FileHandle;
  size: number;
}

export interface MediaFilesOptions {
  uploadsDir: string;
  storeDir: string;
  log: Logger;
  /** Tests only: pretend the store lives on this device. */
  storeDevice?: number;
}

/**
 * Follows no symlink at the last path component where the platform can say so (Windows cannot; the device
 * check still holds there), and never waits: opening a FIFO planted in the store would otherwise block a
 * thread of the pool until a writer appeared.
 */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export function createMediaFiles(options: MediaFilesOptions) {
  const uploads = uploadsLayout(options.uploadsDir);
  const store = storeLayout(options.storeDir);
  const { log } = options;
  let storeDevice = options.storeDevice;

  const device = async (): Promise<number> => (storeDevice ??= (await stat(store.root)).dev);

  /**
   * Opens a file of the store for reading. Returns null unless the open handle is a regular file,
   * on the store's own device, and no larger than `maxBytes`. A symlink to anything outside the
   * volume, /proc/self/environ for one, resolves to another device and is refused here.
   */
  async function openStored(file: string, maxBytes: number): Promise<StoredFile | null> {
    // Looked at before it is opened, so that nothing but a plain file is ever opened; the handle is checked again after.
    try {
      const entry = await lstat(file);
      if (!entry.isFile()) {
        log.error({ file: path.basename(file), directory: entry.isDirectory(), symlink: entry.isSymbolicLink(), fifo: entry.isFIFO() }, "media store: refused an entry that is not a plain file");
        return null;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") log.warn({ file: path.basename(file), code: (err as NodeJS.ErrnoException).code }, "media store: a file could not be inspected");
      return null;
    }
    let handle: FileHandle;
    try {
      handle = await open(file, READ_FLAGS);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") log.warn({ file: path.basename(file), code: (err as NodeJS.ErrnoException).code }, "media store: a file could not be opened");
      return null;
    }
    try {
      const stats = await handle.stat();
      if (stats.isFile() && stats.dev === (await device()) && stats.size <= maxBytes) return { handle, size: stats.size };
      log.error({ file: path.basename(file), regular: stats.isFile(), size: stats.size }, "media store: refused a file that is not a plain file of the store");
    } catch (err) {
      log.error({ err }, "media store: could not inspect an open file");
    }
    await handle.close();
    return null;
  }

  async function readStored(file: string, maxBytes: number): Promise<string | null> {
    const stored = await openStored(file, maxBytes);
    if (!stored) return null;
    try {
      return await stored.handle.readFile("utf8");
    } finally {
      await stored.handle.close();
    }
  }

  const namesIn = (dir: string): Promise<string[]> => readdir(dir).catch(() => []);

  return {
    uploads,
    store,

    /** Creates the uploads volume's directories and forgets bodies a crash left half received. */
    async prepare(): Promise<void> {
      await rm(uploads.tmp, { recursive: true, force: true });
      for (const dir of [uploads.tmp, uploads.incoming, uploads.deletions]) await mkdir(dir, { recursive: true });
    },

    /**
     * Streams a request body to tmp/<id>.part. `accept` sees the first bytes before anything is
     * written and throws to refuse them. Bytes are counted here while they arrive, because a
     * declared length can be absent or wrong; one byte over `maxBytes` ends the upload.
     */
    async receive(id: string, body: ReadableStream<Uint8Array> | null, maxBytes: number, accept: (head: Uint8Array) => void): Promise<number> {
      const reader = body?.getReader();
      const first: Uint8Array[] = [];
      let buffered = 0;
      let ended = !reader;
      try {
        while (reader && buffered < SNIFF_BYTES) {
          const chunk = await reader.read();
          if (chunk.done) {
            ended = true;
            break;
          }
          first.push(chunk.value);
          buffered += chunk.value.byteLength;
        }
        accept(Buffer.concat(first).subarray(0, SNIFF_BYTES));
      } catch (err) {
        await reader?.cancel().catch(() => undefined);
        throw err;
      }

      const part = uploads.part(id);
      const handle = await open(part, "wx");
      let bytes = 0;
      try {
        const write = async (chunk: Uint8Array) => {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) throw new MediaError("file_too_large", 413);
          await handle.appendFile(chunk);
        };
        for (const chunk of first) await write(chunk);
        while (reader && !ended) {
          const chunk = await reader.read();
          if (chunk.done) break;
          await write(chunk.value);
        }
        await handle.sync();
        await handle.close();
      } catch (err) {
        await reader?.cancel().catch(() => undefined);
        await handle.close().catch(() => undefined);
        await rm(part, { force: true });
        throw err;
      }
      return bytes;
    },

    /** The upload becomes visible to the worker. A rename inside one volume is atomic. */
    commit: (id: string): Promise<void> => rename(uploads.part(id), uploads.upload(id)),

    /** Removes an upload, complete or not. A file the worker still holds open on Windows is left for the sweeper. */
    async discardUpload(id: string): Promise<void> {
      for (const file of [uploads.part(id), uploads.upload(id)]) {
        await rm(file, { force: true }).catch((err: unknown) => log.warn({ id, code: (err as NodeJS.ErrnoException).code }, "media uploads: an upload could not be removed yet"));
      }
    },

    /** The worker's verdict on an upload, or null while there is none. A result that does not parse is ignored and logged. */
    async readResult(id: string): Promise<ResultFile | null> {
      const text = await readStored(store.result(id), MAX_RESULT_BYTES);
      if (text === null) return null;
      try {
        const parsed = ResultFile.safeParse(JSON.parse(text));
        if (parsed.success && parsed.data.id === id) return parsed.data;
      } catch {
        // falls through to the log line below
      }
      log.error({ id }, "media store: ignored a result file that does not follow the protocol");
      return null;
    },

    /** An image file to stream. The caller closes the handle. */
    openImage: (id: string, size: MediaSize): Promise<StoredFile | null> => openStored(store.image(id, size), MAX_VARIANT_BYTES),

    /** Asks the worker to delete images. The request is an empty file named after the id. */
    async requestDeletion(ids: readonly string[]): Promise<void> {
      for (const id of ids) await (await open(uploads.deletion(id), "w")).close();
    },

    /** Ids with a deletion request. */
    async deletionRequests(): Promise<string[]> {
      return (await namesIn(uploads.deletions)).filter(isMediaId);
    },

    /** Deletion requests with their age, for the sweeper, which only withdraws one after a grace period. */
    async deletionRequestAges(now: number): Promise<{ id: string; ageMs: number }[]> {
      const found: { id: string; ageMs: number }[] = [];
      for (const id of (await namesIn(uploads.deletions)).filter(isMediaId)) {
        const stats = await stat(uploads.deletion(id)).catch(() => null);
        if (stats) found.push({ id, ageMs: now - stats.mtimeMs });
      }
      return found;
    },

    withdrawDeletion: (id: string): Promise<void> => rm(uploads.deletion(id), { force: true }),

    /** Whether the worker still holds anything for this id. */
    async imageRemains(id: string): Promise<boolean> {
      for (const target of [store.imageDir(id), store.result(id)]) {
        if (await stat(target).then(() => true, () => false)) return true;
      }
      return false;
    },

    /** Every image folder in the store with its age, for the reconcile pass. */
    async storedImages(now: number): Promise<{ id: string; ageMs: number }[]> {
      const found: { id: string; ageMs: number }[] = [];
      for (const shard of await namesIn(store.files)) {
        if (!/^[0-9a-f]{2}$/.test(shard)) continue;
        for (const id of await namesIn(path.join(store.files, shard))) {
          if (!isMediaId(id) || !id.startsWith(shard)) continue;
          const stats = await stat(store.imageDir(id)).catch(() => null);
          if (stats) found.push({ id, ageMs: now - stats.mtimeMs });
        }
      }
      return found;
    },

    /** Every upload on disk, complete or partial, with its age, for the reconcile pass. */
    async storedUploads(now: number): Promise<{ id: string; ageMs: number }[]> {
      const found: { id: string; ageMs: number }[] = [];
      const add = async (id: string, file: string) => {
        if (!isMediaId(id)) return;
        const stats = await stat(file).catch(() => null);
        if (stats) found.push({ id, ageMs: now - stats.mtimeMs });
      };
      for (const name of await namesIn(uploads.incoming)) await add(name, path.join(uploads.incoming, name));
      for (const name of await namesIn(uploads.tmp)) if (name.endsWith(".part")) await add(name.slice(0, -".part".length), path.join(uploads.tmp, name));
      return found;
    },

    /** Milliseconds since the worker's last heartbeat, or null when there is none to read. */
    async heartbeatAge(now: number): Promise<number | null> {
      const text = await readStored(store.heartbeat, 1024);
      if (text === null) return null;
      try {
        const beat = Heartbeat.safeParse(JSON.parse(text));
        return beat.success ? now - beat.data.at : null;
      } catch {
        return null;
      }
    },

    /** Free space on the volume with less of it. The volumes share a disk with Postgres, so running out would stop the database. */
    async freeBytes(): Promise<number> {
      const sizes = await Promise.all([uploads.root, store.root].map(async (dir) => {
        const fs = await statfs(dir);
        return fs.bavail * fs.bsize;
      }));
      return Math.min(...sizes);
    },
  };
}

export type MediaFiles = ReturnType<typeof createMediaFiles>;
```

## Step 5: verify: typecheck

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 6: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  163 passed | 152 skipped (315)
```

## Step 7: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && echo count=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations')
```

Expected output contains:

- `migrations applied`
- `count=8`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=8
```

## Step 8: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Must not contain:

- `failed`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 9: verify: function-live

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat_test -tAc "select has_function_privilege('korbat_auth', 'auth.purge_events(interval)', 'execute'), has_table_privilege('korbat_auth', 'auth.auth_events', 'delete')"
```

Expected output contains:

- `t|f`

Observed on the dry run:

```text
t|f
```

## Step 10: verify: integration

```bash
cd apps/api && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  150 passed (150)
```

## Step 11: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/janitor.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/config.ts`
- `apps/api/src/index.ts`
- `apps/api/src/lib/jobs.ts`
- `apps/api/src/media/context.ts`
- `apps/api/src/media/files.ts`
- `apps/api/src/media/index.ts`
- `apps/api/src/media/sweeper.ts`
- `apps/api/test/config.test.ts`
- `apps/api/test/integration/auth-janitor.test.ts`
- `apps/api/test/integration/media-harness.ts`
- `apps/api/test/integration/media-sweeper.test.ts`
- `apps/api/test/jobs.test.ts`
- `apps/api/test/media/files.test.ts`
- `packages/db/migrations/0007_auth_purge_events.sql`
- `packages/db/migrations/meta/0007_snapshot.json`
- `packages/db/migrations/meta/_journal.json`

## Step 12: commit

```bash
git add -A
git commit -q -m "feat(api): background jobs run under a refreshed lock without overlapping; the auth janitor purges dead codes, old sessions, device address hashes after 30 days and security events after 90 through a migrator-owned function; the sweeper refuses to delete many images without a row unless forced; store entries are inspected before being opened, never blocking" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api): background jobs run under a refreshed lock without overlapping; the auth janitor purges dead codes, old sessions, device address hashes after 30 days and security events after 90 through a migrator-owned function; the sweeper refuses to delete many images without a row unless forced; store entries are inspected before being opened, never blocking`.

## Report format (mandatory)

```text
TASK 5 REPORT
Files written: <count, expected 17>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "function-live": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
