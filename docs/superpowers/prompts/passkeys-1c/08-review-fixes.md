# korbat passkeys (1c) — Task 8 of 9: What the review of 1c upheld, fixed: links are checked before they are spent, the lockdown is one transaction, 'not mine' counts only lockdowns, sessions are listed and revoked by their handle, the pending TOTP secret is spent once, the session cache key is versioned, the user handle is required at sign-in, six test gaps are closed, and the web app keeps what a recovery-code re-authentication just showed, follows the refusal it answers and words the lockdown as it works; the whole stack rebuilt and smoke-tested

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-25 to 2026-09-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

This task applies what the adversarial review of Tasks 1 to 7 upheld (18 of 21 findings) and what the walk-through in a real browser confirmed: the mailed links are checked before they are spent; the lockdown's writes and its event are one transaction; 'not mine' counts only calls that run the lockdown; sessions are listed, revoked and exported by their handle; TOTP confirm spends its pending secret once; the session cache key is versioned; the user handle is required at sign-in; six test gaps are closed; and in the web app a recovery-code re-authentication keeps what the action just showed, the panel follows the refusal it is answering, and the lockdown's texts say what it removes. Its gates rebuild the whole stack and run the smoke test through Caddy.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API, worker or web process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): the web app's passkey screens: a passkey button and conditional-mediation autofill on sign-in (one request at a time, renewed after nine minutes or an expired challenge, aborted on blur and unmount); the Passkeys section of Security with the list's tags, rename, remove, 'This wasn't me' behind its explanation, and the add dialog with the name the password manager shows; the re-authentication panel's passkey and recovery-code methods and its level-2 choice from what the refusal says is missing; the home screen's suggestion card with a 30-day 'Not now'; the passkey-remove page and the lockdown texts on the not-me and email-undo pages; TOTP disable without a code; the terms' passkey sentence`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/08-review-fixes.md 1
```

Expected: 33 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/totp-confirm.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { decrypt } from "../../src/auth/crypto";
import { confirmTotp, setupTotp, totpPendingKey } from "../../src/auth/flows/mfa";
import { hashRecoveryCode } from "../../src/auth/recovery-codes";
import type { Session } from "../../src/auth/sessions";
import { currentStep, hotp } from "../../src/auth/totp";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const SETUP_EXPIRED = "Two-factor setup expired. Start again.";

/** Starts a setup on the session and answers the pending secret as the store holds it, with the code an authenticator app shows for it now. */
async function setup(h: MemoryFlowHarness, session: Session) {
  await setupTotp(h.deps, session);
  const pending = (await h.kv.get(totpPendingKey(session.handle)))!;
  const secret = new Uint8Array(decrypt(pending, [h.deps.config.totpKey]));
  return { pending, code: hotp(secret, currentStep(h.now().getTime())) };
}

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("confirming a TOTP setup (1c design, section 2): the pending secret is spent once", () => {
  test("two confirmations of one setup at once turn two-factor on once: one answers with the recovery codes that are stored, the other is refused before it writes anything", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { pending, code } = await setup(h, ada.session);
    // A double submit: both requests carry the same session and the same code. Each read of the pending secret waits for
    // the other, so both hold it before either spends it.
    const get = h.kv.get.bind(h.kv);
    let readers = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    h.kv.get = async (key) => {
      const value = await get(key);
      if (key === totpPendingKey(ada.session.handle)) {
        if (++readers === 2) release();
        await bothRead;
      }
      return value;
    };
    const outcomes = await Promise.allSettled([confirmTotp(h.deps, ada.session, { code }), confirmTotp(h.deps, ada.session, { code })]);
    h.kv.get = get;
    expect(readers).toBe(2);
    const won = outcomes.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof confirmTotp>>> => o.status === "fulfilled");
    const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect([won.length, lost.length]).toEqual([1, 1]);
    expect(lost[0]!.reason).toMatchObject({ code: "invalid_mfa_code", status: 400, message: SETUP_EXPIRED });

    // The codes the one answer shows are the codes the account holds.
    const stored = h.users.get(ada.user.id)!;
    const key = h.deps.config.authHmacKey;
    expect(won[0]!.value.recoveryCodes).toHaveLength(10);
    expect(stored.recoveryCodesHash).toEqual(won[0]!.value.recoveryCodes.map((recoveryCode) => hashRecoveryCode(key, recoveryCode)));
    expect(stored).toMatchObject({ totpSecretEnc: pending, totpEnabledAt: h.now() });
    // The code's step is claimed, so the same code cannot be the second factor of a sign-in.
    expect(stored.totpLastStep).not.toBeNull();
    // Once on the record, once in the owner's mailbox, and one rotation: the session's row is under the token the answer carries.
    expect(h.events).toEqual([{ userId: ada.user.id, type: "mfa_enabled", deviceId: ada.session.deviceId, metadata: {} }]);
    expect(h.mailer.sent.map((m) => [m.to, m.template])).toEqual([["ada@korbat.local", "mfa_enabled"]]);
    const row = h.sessions.find((s) => s.handle === ada.session.handle)!;
    expect(row.id).toBe(won[0]!.value.issued.session.sessionId);
    expect(row.factors).toEqual({ ...ada.session.factors, totp: h.now().getTime() });
    expect(won[0]!.value.issued.session).toMatchObject({ handle: ada.session.handle, mfaEnabled: true });
    expect(await h.kv.get(totpPendingKey(ada.session.handle))).toBeNull();
  });

  test("a second confirmation with the same code, after the first, is refused and writes nothing: the codes, the step, the record and the session stay as the first left them", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { code } = await setup(h, ada.session);
    const first = await confirmTotp(h.deps, ada.session, { code });
    const after = structuredClone(h.users.get(ada.user.id)!);
    const row = { ...h.sessions.find((s) => s.handle === ada.session.handle)! };

    for (const session of [ada.session, first.issued.session]) {
      await expect(confirmTotp(h.deps, session, { code })).rejects.toMatchObject({ code: "invalid_mfa_code", status: 400, message: SETUP_EXPIRED });
    }
    expect(h.users.get(ada.user.id)).toEqual(after);
    expect(h.sessions.find((s) => s.handle === ada.session.handle)).toEqual(row);
    expect(h.events.map((e) => e.type)).toEqual(["mfa_enabled"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["mfa_enabled"]);
  });

  test("a wrong code does not spend the setup: the right one still confirms it", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { pending, code } = await setup(h, ada.session);
    await expect(confirmTotp(h.deps, ada.session, { code: wrong(code) })).rejects.toMatchObject({ code: "invalid_mfa_code", status: 400, message: "That authentication code is not valid." });
    expect(await h.kv.get(totpPendingKey(ada.session.handle))).toBe(pending);
    expect(h.users.get(ada.user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null });
    expect(h.events).toEqual([]);
    expect((await confirmTotp(h.deps, ada.session, { code })).recoveryCodes).toHaveLength(10);
    expect(h.users.get(ada.user.id)!.totpSecretEnc).toBe(pending);
  });

  test("a setup replaced between the confirmation's read and its spend is refused: the code proved a secret that is no longer the pending one", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { code } = await setup(h, ada.session);
    // The session starts a new setup just after the confirmation read the old one.
    const get = h.kv.get.bind(h.kv);
    h.kv.get = async (key) => {
      const value = await get(key);
      if (key === totpPendingKey(ada.session.handle)) {
        h.kv.get = get;
        await setupTotp(h.deps, ada.session);
      }
      return value;
    };
    await expect(confirmTotp(h.deps, ada.session, { code })).rejects.toMatchObject({ code: "invalid_mfa_code", status: 400, message: SETUP_EXPIRED });
    expect(h.users.get(ada.user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] });
    expect(h.events).toEqual([]);
    expect(h.mailer.sent).toEqual([]);
    expect(h.sessions.find((s) => s.handle === ada.session.handle)!.id).toBe(ada.session.sessionId);
    // The newer secret went with the refusal, so the owner starts the setup again, as the message says.
    expect(await h.kv.get(totpPendingKey(ada.session.handle))).toBeNull();
  });
});
```

### Replace `apps/api/test/account/export.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { Deflate, strFromU8, unzipSync } from "fflate";
import { Hono, type MiddlewareHandler } from "hono";
import pino from "pino";
import { afterAll, describe, expect, test, vi } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { MAX_VARIANT_BYTES } from "@korbat/media-protocol";
import { AccountError, type AccountDeps } from "../../src/account/context";
import { EXPORT_WINDOW_MS, buildExport, enforceExportLimit, exportFilename, exportJson, mediaEntry, writeExport } from "../../src/account/flows/export";
import { accountRoutes } from "../../src/account/routes";
import { createZipWriter, type OpenFile } from "../../src/account/zip";
import type { AccountExport, AuthEventType, Session } from "../../src/auth";
import type { AppEnv } from "../../src/env";
import { createMediaFiles } from "../../src/media/files";
import { MemoryStore } from "../../src/middleware/rate-limit";
import type { ExportedPost } from "../../src/social";
import type { HandleRefRow, PostRefRow } from "../../src/social/repo";

const root = mkdtempSync(path.join(tmpdir(), "korbat-account-export-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = 1_789_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const silent = pino({ level: "silent" });
const KIB64 = 64 * 1024;
const TWO_32 = 0x1_0000_0000;

/** A file of the given bytes in a fresh directory, and its absolute path. */
function fileOf(bytes: Uint8Array): string {
  const dir = path.join(root, randomUUID());
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "large.webp");
  writeFileSync(file, bytes);
  return file;
}

/** Opens a file as the media module's checked open answers: the handle with the size it measured, or null for no plain file. */
function openerOf(file: string): OpenFile {
  return async () => {
    let handle: FileHandle;
    try {
      handle = await open(file, "r");
    } catch {
      return null;
    }
    const stats = await handle.stat();
    if (stats.isFile()) return { handle, size: stats.size };
    await handle.close();
    return null;
  };
}

/**
 * Collects the archive in memory. Every write takes a turn of the event loop, and a write that
 * starts while another is still pending is remembered: the writer must await each one.
 */
function memorySink() {
  const chunks: Uint8Array[] = [];
  let busy = false;
  let overlapped = false;
  return {
    async write(chunk: Uint8Array): Promise<void> {
      if (busy) overlapped = true;
      busy = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      chunks.push(Uint8Array.from(chunk));
      busy = false;
    },
    bytes: (): Buffer => Buffer.concat(chunks),
    get overlapped() {
      return overlapped;
    },
    get count() {
      return chunks.length;
    },
  };
}

/**
 * A stand-in for an opened store file: `size` bytes of `chunk` (zeros unless given), yielded lazily in
 * chunks of its length, failing once `failAfter` chunks were read when asked to. It records how many
 * chunks were read, whether the reading stopped and whether the handle was closed.
 */
function fakeFile(size: number, options: { failAfter?: number; chunk?: Uint8Array } = {}) {
  const chunk = options.chunk ?? new Uint8Array(KIB64);
  const state = { chunks: 0, stopped: false, closed: false };
  const handle = {
    createReadStream({ start = 0, end = size - 1 }: { start?: number; end?: number }): AsyncIterable<Uint8Array> {
      return (async function* () {
        try {
          for (let at = start; at <= end; at += chunk.length) {
            if (options.failAfter !== undefined && state.chunks >= options.failAfter) throw new Error("the disk failed in the middle of the file");
            state.chunks += 1;
            yield at + chunk.length - 1 <= end ? chunk : chunk.subarray(0, end - at + 1);
          }
        } finally {
          state.stopped = true;
        }
      })();
    },
    async close() {
      state.closed = true;
    },
  };
  const opener: OpenFile = async () => ({ handle: handle as unknown as FileHandle, size });
  return { open: opener, state, chunk };
}

async function collect(pieces: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const piece of pieces) out.push(piece);
  return out;
}

async function* piecesOf(...pieces: string[]): AsyncGenerator<string> {
  yield* pieces;
}

/** One central directory entry as a reader finds it. */
interface CentralEntry {
  at: number;
  name: string;
  method: number;
  versionNeeded: number;
  flags: number;
  compressed: number;
  size: number;
  offset: number;
  /** The payload of the ZIP64 extra field (id 0x0001), as 64-bit values, or null without one. */
  zip64: number[] | null;
}

const u64 = (bytes: Buffer, at: number) => bytes.readUInt32LE(at) + bytes.readUInt32LE(at + 4) * TWO_32;

/** Every central directory entry in archive order, found by its signature (none of the test data holds it). */
function centralDirectory(archive: Uint8Array, base = 0): CentralEntry[] {
  const bytes = Buffer.from(archive);
  const entries: CentralEntry[] = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    const extraLength = bytes.readUInt16LE(i + 30);
    let zip64: number[] | null = null;
    for (let at = i + 46 + nameLength; at + 4 <= i + 46 + nameLength + extraLength; at += 4 + bytes.readUInt16LE(at + 2)) {
      if (bytes.readUInt16LE(at) !== 0x0001) continue;
      const length = bytes.readUInt16LE(at + 2);
      zip64 = Array.from({ length: length / 8 }, (_, k) => u64(bytes, at + 4 + 8 * k));
    }
    entries.push({
      at: base + i,
      name: bytes.toString("utf8", i + 46, i + 46 + nameLength),
      method: bytes.readUInt16LE(i + 10),
      versionNeeded: bytes.readUInt16LE(i + 6),
      flags: bytes.readUInt16LE(i + 8),
      compressed: bytes.readUInt32LE(i + 20),
      size: bytes.readUInt32LE(i + 24),
      offset: bytes.readUInt32LE(i + 42),
      zip64,
    });
  }
  return entries;
}

/** The end records, read from the archive's last bytes as a reader does: the classic one, then the ZIP64 locator and record when present. */
function endRecords(archive: Uint8Array, base = 0) {
  const bytes = Buffer.from(archive);
  const at = bytes.length - 22;
  expect(bytes.readUInt32LE(at)).toBe(0x06054b50);
  const end = { entriesHere: bytes.readUInt16LE(at + 8), entries: bytes.readUInt16LE(at + 10), size: bytes.readUInt32LE(at + 12), offset: bytes.readUInt32LE(at + 16), comment: bytes.readUInt16LE(at + 20) };
  if (at < 20 || bytes.readUInt32LE(at - 20) !== 0x07064b50) return { end, locator: null, end64: null };
  const locator = { disk: bytes.readUInt32LE(at - 16), offset: u64(bytes, at - 12), disks: bytes.readUInt32LE(at - 4) };
  const r = locator.offset - base;
  expect(bytes.readUInt32LE(r)).toBe(0x06064b50);
  const end64 = {
    at: base + r,
    recordSize: u64(bytes, r + 4),
    versionMadeBy: bytes.readUInt16LE(r + 12),
    versionNeeded: bytes.readUInt16LE(r + 14),
    disk: bytes.readUInt32LE(r + 16),
    directoryDisk: bytes.readUInt32LE(r + 20),
    entriesHere: u64(bytes, r + 24),
    entries: u64(bytes, r + 32),
    size: u64(bytes, r + 40),
    offset: u64(bytes, r + 48),
  };
  return { end, locator, end64 };
}

interface RecordedEvent {
  userId: string;
  type: AuthEventType;
  metadata: Record<string, unknown> | undefined;
}

interface Lists {
  posts: ExportedPost[];
  likes: PostRefRow[];
  reposts: PostRefRow[];
  bookmarks: PostRefRow[];
  following: HandleRefRow[];
  blocks: HandleRefRow[];
  mutes: HandleRefRow[];
}

/**
 * The export flow on fakes of the three module interfaces: an account with two live sessions, one
 * device and two events; a profile with a post carrying two images and a deleted reply, one like, one
 * bookmark, a follow, a block and a mute; and whatever images the test puts in `images`. The social
 * fake hands each list out in pages of the size it is asked for, reading a page only when it is
 * iterated, and records every read in `reads`; a test may add rows to `lists`. `failures` makes the
 * next calls of a module read throw.
 */
function harness() {
  let t = T0;
  const images: { id: string; open: OpenFile }[] = [];
  const userId = randomUUID();
  // Sessions are named by their handles, as the auth module's export lists them; the hash of a token is in no part of the archive.
  const currentSession = randomUUID();
  const otherSession = randomUUID();
  const [postId, deletedId, likedId, bookmarkedId, imageA, imageB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const events: RecordedEvent[] = [];
  const reads: string[] = [];
  const failures = { exportAccount: 0 };
  // The deletion side of the three interfaces is not exercised by the export; test/account/deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const account: AccountExport = {
    account: { id: userId, email: "ada@korbat.local", createdAt: new Date(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: new Date(T0 - 3 * DAY_MS) },
    // Newest first, as the auth module lists them: a plain key never used, added from a device since gone, and a synced one used yesterday.
    passkeys: [
      { name: "Security key", createdAt: new Date(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
      { name: "Laptop", createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
    ],
    sessions: [
      { id: otherSession, createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS) },
      { id: currentSession, createdAt: new Date(T0 - DAY_MS), lastUsedAt: new Date(T0) },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: new Date(T0 - 3 * DAY_MS), lastSeenAt: new Date(T0) }],
    events: [
      { type: "signin_success", at: new Date(T0 - DAY_MS) },
      { type: "signup", at: new Date(T0 - 3 * DAY_MS) },
    ],
  };
  const lists: Lists = {
    posts: [
      {
        id: postId,
        body: "two photos",
        createdAt: new Date(T0 - 2 * DAY_MS),
        replyToId: null,
        quoteOfId: null,
        state: "visible",
        deletedAt: null,
        media: [
          { id: imageA, altText: "a harbour at dawn", width: 1600, height: 1200 },
          { id: imageB, altText: "a lighthouse", width: 900, height: 1600 },
        ],
      },
      { id: deletedId, body: "", createdAt: new Date(T0 - DAY_MS), replyToId: postId, quoteOfId: null, state: "deleted_by_author", deletedAt: new Date(T0 - 1_000), media: [] },
    ],
    likes: [{ postId: likedId, at: new Date(T0 - DAY_MS) }],
    reposts: [],
    bookmarks: [{ postId: bookmarkedId, at: new Date(T0 - 500) }],
    following: [{ handle: "bob", since: new Date(T0 - 2 * DAY_MS) }],
    blocks: [{ handle: "eve", since: new Date(T0 - DAY_MS) }],
    mutes: [{ handle: "carol", since: new Date(T0 - 200) }],
  };
  /** A list in pages of `pageSize`, each read when the one before has been used, as the social module pages its keyset reads. */
  function paged<T>(name: keyof Lists, rows: T[], pageSize: number): AsyncIterable<T[]> {
    return {
      async *[Symbol.asyncIterator]() {
        for (let at = 0; ; at += pageSize) {
          reads.push(name);
          const page = rows.slice(at, at + pageSize);
          if (page.length > 0) yield page;
          if (page.length < pageSize) return;
        }
      },
    };
  }
  const deps: AccountDeps = {
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      exportAccount: async () => {
        if (failures.exportAccount > 0) {
          failures.exportAccount -= 1;
          throw new Error("the auth pool timed out");
        }
        return account;
      },
      appendEvent: async (id, type, metadata) => {
        events.push({ userId: id, type, metadata });
      },
    },
    social: {
      purgeProfile: notHere,
      exportProfile: async (_id, pageSize = 1000) => ({
        profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: new Date(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] },
        posts: paged("posts", lists.posts, pageSize),
        likes: paged("likes", lists.likes, pageSize),
        reposts: paged("reposts", lists.reposts, pageSize),
        bookmarks: paged("bookmarks", lists.bookmarks, pageSize),
        following: paged("following", lists.following, pageSize),
        blocks: paged("blocks", lists.blocks, pageSize),
        mutes: paged("mutes", lists.mutes, pageSize),
      }),
    },
    media: { purgeOwner: notHere, requestDeletion: notHere, exportImages: async () => images },
    limits: new MemoryStore(() => t),
    log: silent,
    now: () => new Date(t),
  };
  return {
    deps,
    userId,
    currentSession,
    otherSession,
    postId,
    deletedId,
    likedId,
    bookmarkedId,
    imageA,
    imageB,
    images,
    events,
    lists,
    reads,
    failures,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

type Harness = ReturnType<typeof harness>;

/** export.json as a document in memory, built from the harness's rows the way the export describes them, for JSON.stringify to write. */
function expectedDocument(h: Harness, missingMedia: string[] = []) {
  const ref = (row: PostRefRow) => ({ postId: row.postId, at: row.at.toISOString() });
  const other = (row: HandleRefRow) => ({ handle: row.handle, since: row.since.toISOString() });
  return {
    format: "korbat-export-1",
    exportedAt: iso(T0),
    account: {
      id: h.userId,
      email: "ada@korbat.local",
      createdAt: iso(T0 - 3 * DAY_MS),
      role: "user",
      mfaEnabled: true,
      hasPassword: false,
      verified: true,
      termsVersion: "draft-test",
      termsAcceptedAt: iso(T0 - 3 * DAY_MS),
      passkeys: [
        { name: "Security key", createdAt: iso(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
        { name: "Laptop", createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
      ],
    },
    profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] },
    posts: h.lists.posts.map((post) => ({
      id: post.id,
      body: post.body,
      createdAt: post.createdAt.toISOString(),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      state: post.state,
      deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
      media: post.media.map((image) => ({ id: image.id, file: `media/${image.id}.webp`, altText: image.altText, width: image.width, height: image.height })),
    })),
    likes: h.lists.likes.map(ref),
    reposts: h.lists.reposts.map(ref),
    bookmarks: h.lists.bookmarks.map(ref),
    following: h.lists.following.map(other),
    blocks: h.lists.blocks.map(other),
    mutes: h.lists.mutes.map(other),
    sessions: [
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }],
    events: [
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ],
    missingMedia,
  };
}

/** More rows in every list than a few pages of two hold: text that JSON escapes, a line break inside a body, characters outside ASCII. */
function addManyRows(h: Harness): void {
  const quote = String.fromCharCode(34);
  const newline = String.fromCharCode(10);
  const accented = `caf${String.fromCharCode(0xe9)} ${String.fromCodePoint(0x1f600)}`;
  for (let i = 0; i < 5; i++) {
    h.lists.posts.push({
      id: randomUUID(),
      body: `post ${i}: ${quote}quoted${quote}${newline}second line, ${accented}`,
      createdAt: new Date(T0 - DAY_MS + i),
      replyToId: i % 2 === 0 ? h.postId : null,
      quoteOfId: i === 3 ? h.postId : null,
      state: i === 4 ? "withheld" : "visible",
      deletedAt: null,
      media: i === 1 ? [{ id: randomUUID(), altText: `alt ${accented}`, width: 10, height: 20 }] : [],
    });
  }
  for (let i = 0; i < 6; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 900 + i) });
  for (let i = 0; i < 3; i++) h.lists.reposts.push({ postId: randomUUID(), at: new Date(T0 - 800 + i) });
  for (let i = 0; i < 4; i++) h.lists.bookmarks.push({ postId: randomUUID(), at: new Date(T0 - 700 + i) });
  for (let i = 0; i < 5; i++) h.lists.following.push({ handle: `friend_${i}`, since: new Date(T0 - 600 + i) });
  for (let i = 0; i < 2; i++) h.lists.blocks.push({ handle: `blocked_${i}`, since: new Date(T0 - 500 + i) });
  for (let i = 0; i < 3; i++) h.lists.mutes.push({ handle: `muted_${i}`, since: new Date(T0 - 400 + i) });
}

/** How many reads a list of `rows` takes in pages of `size`: full pages, then the short (maybe empty) one that says it is over. */
const readsFor = (rows: number, size: number) => Math.floor(rows / size) + 1;

describe("building the export", () => {
  test("the JSON follows the contract, marks the current session, lists the passkeys with nothing of their keys, and keeps a deleted post with its empty body and deletion time", async () => {
    const h = harness();
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const json = ExportFormat.parse(JSON.parse((await collect(exportJson(plan))).join("")));
    expect(json.format).toBe("korbat-export-1");
    expect(json.exportedAt).toBe(iso(T0));
    expect(json.account).toEqual({
      id: h.userId,
      email: "ada@korbat.local",
      createdAt: iso(T0 - 3 * DAY_MS),
      role: "user",
      mfaEnabled: true,
      hasPassword: false,
      verified: true,
      termsVersion: "draft-test",
      termsAcceptedAt: iso(T0 - 3 * DAY_MS),
      // Inside the account, in the auth module's order (newest first), each as the five facts with the times as ISO text.
      passkeys: [
        { name: "Security key", createdAt: iso(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
        { name: "Laptop", createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
      ],
    });
    expect(json.sessions).toEqual([
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ]);
    expect(json.devices).toEqual([{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }]);
    expect(json.events).toEqual([
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ]);
    expect(json.profile).toEqual({ handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] });
    expect(json.posts).toHaveLength(2);
    expect(json.posts[0]).toEqual({
      id: h.postId,
      body: "two photos",
      createdAt: iso(T0 - 2 * DAY_MS),
      replyToId: null,
      quoteOfId: null,
      state: "visible",
      deletedAt: null,
      media: [
        { id: h.imageA, file: `media/${h.imageA}.webp`, altText: "a harbour at dawn", width: 1600, height: 1200 },
        { id: h.imageB, file: `media/${h.imageB}.webp`, altText: "a lighthouse", width: 900, height: 1600 },
      ],
    });
    expect(json.posts[1]).toEqual({ id: h.deletedId, body: "", createdAt: iso(T0 - DAY_MS), replyToId: h.postId, quoteOfId: null, state: "deleted_by_author", deletedAt: iso(T0 - 1_000), media: [] });
    expect(json.likes).toEqual([{ postId: h.likedId, at: iso(T0 - DAY_MS) }]);
    expect(json.reposts).toEqual([]);
    expect(json.bookmarks).toEqual([{ postId: h.bookmarkedId, at: iso(T0 - 500) }]);
    expect(json.following).toEqual([{ handle: "bob", since: iso(T0 - 2 * DAY_MS) }]);
    expect(json.blocks).toEqual([{ handle: "eve", since: iso(T0 - DAY_MS) }]);
    expect(json.mutes).toEqual([{ handle: "carol", since: iso(T0 - 200) }]);
    expect(json.missingMedia).toEqual([]);
    expect(plan.images).toEqual([]);
    // Building the plan records nothing: the event belongs after the last chunk of the stream.
    expect(h.events).toEqual([]);
  });

  test("the images to write are the media module's, and the entry name is media/<id>.webp", async () => {
    const h = harness();
    h.images.push({ id: randomUUID(), open: openerOf(path.join(root, "a")) }, { id: randomUUID(), open: openerOf(path.join(root, "b")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect(plan.images).toEqual(h.images);
    expect(mediaEntry(h.images[0]!.id)).toBe(`media/${h.images[0]!.id}.webp`);
  });

  test("export.json is read list by list in pages and written piece by piece, byte for byte as JSON.stringify(document, null, 2) writes it", async () => {
    const h = harness();
    addManyRows(h);
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 2);
    // Only the account and the profile's own fields are read up front; the lists wait for the JSON to be written.
    expect(h.reads).toEqual([]);
    const text = (await collect(exportJson(plan))).join("");
    expect(text).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(() => ExportFormat.parse(JSON.parse(text))).not.toThrow();
    // Every list was read in pages of two, one page after the other, in the document's order.
    const order: (keyof Lists)[] = ["posts", "likes", "reposts", "bookmarks", "following", "blocks", "mutes"];
    expect(h.reads).toEqual(order.flatMap((name) => Array.from({ length: readsFor(h.lists[name].length, 2) }, () => name)));
    // The same account in one page per list is the same text.
    const whole = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect((await collect(exportJson(whole))).join("")).toBe(text);
  });

  test("empty lists and missing images are written as JSON.stringify writes them", async () => {
    const h = harness();
    for (const name of ["posts", "likes", "bookmarks", "following", "blocks", "mutes"] as const) h.lists[name].length = 0;
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 3);
    plan.missingMedia.push(h.imageA, h.imageB);
    expect((await collect(exportJson(plan))).join("")).toBe(JSON.stringify(expectedDocument(h, [h.imageA, h.imageB]), null, 2));
  });

  test("a large account's export.json comes in several pieces of at most 64 KiB of UTF-8", async () => {
    const h = harness();
    const accented = String.fromCharCode(0xe9).repeat(200);
    for (let i = 0; i < 3_000; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 100_000 + i) });
    for (let i = 0; i < 1_000; i++) h.lists.posts.push({ id: randomUUID(), body: accented, createdAt: new Date(T0 - 50_000 + i), replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [] });
    const pieces = await collect(exportJson(await buildExport(h.deps, h.userId, h.currentSession, h.now())));
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) expect(Buffer.byteLength(piece, "utf8")).toBeLessThanOrEqual(KIB64);
    expect(pieces.join("")).toBe(JSON.stringify(expectedDocument(h), null, 2));
  });

  test("the file name carries the handle and the day of the export", () => {
    expect(exportFilename("ada_l", new Date("2026-09-24T23:59:59.000Z"))).toBe("korbat-export-ada_l-2026-09-24.zip");
  });

  test("one export a day: the second is rate_limited with a Retry-After, the next day is allowed again, and a store that fails closes the door", async () => {
    const h = harness();
    await enforceExportLimit(h.deps, h.userId);
    const refused = await enforceExportLimit(h.deps, h.userId).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AccountError);
    expect((refused as AccountError).code).toBe("rate_limited");
    expect((refused as AccountError).status).toBe(429);
    expect((refused as AccountError).retryAfterSeconds).toBeGreaterThan(0);
    expect((refused as AccountError).retryAfterSeconds).toBeLessThanOrEqual(EXPORT_WINDOW_MS / 1000);
    // Another account is not affected.
    await enforceExportLimit(h.deps, randomUUID());
    h.advance(EXPORT_WINDOW_MS + 1);
    await enforceExportLimit(h.deps, h.userId);

    const failing: AccountDeps = {
      ...h.deps,
      limits: {
        hit: async () => {
          throw new Error("store down");
        },
        release: async () => undefined,
      },
    };
    const down = await enforceExportLimit(failing, h.userId).catch((err: unknown) => err);
    expect(down).toBeInstanceOf(AccountError);
    expect((down as AccountError).code).toBe("service_unavailable");
    expect((down as AccountError).status).toBe(503);
    expect((down as AccountError).retryAfterSeconds).toBe(30);
  });
});

describe("writing the archive", () => {
  test("the archive holds export.json and every image byte for byte, in chunks that are each awaited", async () => {
    const bytesA = randomBytes(200_000);
    const bytesB = Buffer.from("small-webp");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(fileOf(bytesB)) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    expect(sink.overlapped).toBe(false);
    // Two hundred kilobytes do not fit in one read: the image went through several awaited writes.
    expect(sink.count).toBeGreaterThan(3);

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`, `media/${h.imageB}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageB}.webp`]!), bytesB)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(centralDirectory(sink.bytes()).map((entry) => [entry.name, entry.method])).toEqual([
      [`media/${h.imageA}.webp`, 0],
      [`media/${h.imageB}.webp`, 0],
      ["export.json", 8],
    ]);
  });

  test("an image whose file is gone is listed under missingMedia, and the archive still closes with the others", async () => {
    const bytesA = Buffer.from("still-there");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(path.join(root, randomUUID(), "large.webp")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.missingMedia).toEqual([h.imageB]);
    // The post still names the entry the image would have had; missingMedia says why it is not there.
    expect(json.posts[0]!.media[1]!.file).toBe(`media/${h.imageB}.webp`);
    expect(plan.missingMedia).toEqual([h.imageB]);
  });

  /** A store with one image whose large variant holds `bytes`, read through the media module's checked open. */
  async function storeWith(id: string, bytes: Uint8Array) {
    const base = path.join(root, randomUUID());
    const files = createMediaFiles({ uploadsDir: path.join(base, "uploads"), storeDir: path.join(base, "store"), log: silent });
    await files.prepare();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), bytes);
    return files;
  }

  test("an image larger than a variant may be is refused by the checked open and listed under missingMedia like a missing one", async () => {
    const h = harness();
    const files = await storeWith(h.imageA, Buffer.from("planted"));
    // A sparse file of any size could be planted in the store; the checked open refuses anything over the variant limit.
    truncateSync(files.store.image(h.imageA, "large"), MAX_VARIANT_BYTES + 1);
    const kept = await storeWith(h.imageB, Buffer.from("fine"));
    h.images.push({ id: h.imageA, open: () => files.openImage(h.imageA, "large") }, { id: h.imageB, open: () => kept.openImage(h.imageB, "large") });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const archive = sink.bytes();
    expect(archive.length).toBeLessThan(MAX_VARIANT_BYTES);
    const unpacked = unzipSync(archive);
    expect(Object.keys(unpacked).sort()).toEqual(["export.json", `media/${h.imageB}.webp`].sort());
    expect(ExportFormat.parse(JSON.parse(strFromU8(unpacked["export.json"]!))).missingMedia).toEqual([h.imageA]);
  });

  test("a file that grows after the checked open is read only to the size the open measured", async () => {
    const h = harness();
    const original = randomBytes(150_000);
    const files = await storeWith(h.imageA, original);
    h.images.push({
      id: h.imageA,
      open: async () => {
        const stored = await files.openImage(h.imageA, "large");
        // Whatever lands in the file after the check is not the checked file's.
        appendFileSync(files.store.image(h.imageA, "large"), randomBytes(100_000));
        return stored;
      },
    });
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), await buildExport(h.deps, h.userId, h.currentSession, h.now()));
    const unpacked = unzipSync(sink.bytes());
    expect(Buffer.compare(Buffer.from(unpacked[`media/${h.imageA}.webp`]!), original)).toBe(0);
  });
});

describe("the zip writer", () => {
  test("entries come out in the order they were added: JSON pieces deflated as one text, files stored as they are", async () => {
    const stored = randomBytes(70_000);
    const first = JSON.stringify({ kind: "first", filler: "x".repeat(2_000) }, null, 2);
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.addJsonPieces("first.json", piecesOf(first.slice(0, 700), first.slice(700)));
    expect(await writer.addFile("files/stored.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("last.json", piecesOf('{ "kind": "last" }'));
    await writer.end();

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["first.json", "files/stored.bin", "last.json"]);
    expect(strFromU8(files["first.json"]!)).toBe(first);
    expect(Buffer.compare(Buffer.from(files["files/stored.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["last.json"]!)).toBe('{ "kind": "last" }');
    const directory = centralDirectory(sink.bytes());
    expect(directory.map((entry) => [entry.name, entry.method])).toEqual([
      ["first.json", 8],
      ["files/stored.bin", 0],
      ["last.json", 8],
    ]);
    // A plain archive has no ZIP64 field or record, and every entry streams its sizes after its data.
    expect(directory.map((entry) => entry.zip64)).toEqual([null, null, null]);
    expect(directory.every((entry) => entry.versionNeeded === 45 && (entry.flags & 0x0008) !== 0)).toBe(true);
    expect(endRecords(sink.bytes()).end64).toBeNull();
    expect(sink.overlapped).toBe(false);
  });

  test("a file the open refuses adds nothing and answers false; a zero-byte file is an entry without data", async () => {
    const dir = path.join(root, randomUUID());
    mkdirSync(dir, { recursive: true });
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    expect(await writer.addFile("missing.bin", openerOf(path.join(root, randomUUID(), "missing.webp")))).toBe(false);
    expect(await writer.addFile("dir.bin", openerOf(dir))).toBe(false);
    const empty = fakeFile(0);
    expect(await writer.addFile("empty.bin", empty.open)).toBe(true);
    expect(empty.state).toEqual({ chunks: 0, stopped: false, closed: true });
    await writer.addJsonPieces("only.json", piecesOf('{ "ok": true }'));
    await writer.end();
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["empty.bin", "only.json"]);
    expect(files["empty.bin"]!.length).toBe(0);
    expect(centralDirectory(sink.bytes()).map((entry) => entry.name)).toEqual(["empty.bin", "only.json"]);
  });

  test("an empty archive is still a valid archive", async () => {
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.end();
    expect(unzipSync(sink.bytes())).toEqual({});
  });

  test("the JSON is fed to the deflate at most 64 KiB at a time, and the event loop turns between two feeds", async () => {
    const push = vi.spyOn(Deflate.prototype, "push");
    const chunks: Uint8Array[] = [];
    const writer = createZipWriter(async (chunk) => {
      chunks.push(Uint8Array.from(chunk));
    });
    let turns = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      turns += 1;
      setImmediate(tick);
    };
    setImmediate(tick);
    // One piece of 300 KiB and ten small ones.
    const big = "y".repeat(300 * 1024);
    let fed: number[];
    try {
      await writer.addJsonPieces("big.json", piecesOf(big, ...Array.from({ length: 10 }, (_, i) => `,${i}`)));
      await writer.end();
      // Read before the spy is restored, which forgets its calls.
      fed = push.mock.calls.map(([chunk]) => chunk.length);
    } finally {
      running = false;
      push.mockRestore();
    }
    expect(Math.max(...fed)).toBeLessThanOrEqual(KIB64);
    expect(fed.filter((length) => length > 0)).toHaveLength(5 + 10);
    expect(turns).toBeGreaterThanOrEqual(10);
    expect(strFromU8(unzipSync(Buffer.concat(chunks))["big.json"]!)).toBe(big + Array.from({ length: 10 }, (_, i) => `,${i}`).join(""));
  });

  test("forced ZIP64 on a small archive: it opens and gives back its bytes, and its records say what a ZIP64 reader needs", async () => {
    const stored = randomBytes(5_000);
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { zip64: "always" });
    expect(await writer.addFile("a.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("b.json", piecesOf('{ "b": 1 }'));
    await writer.end();
    const archive = sink.bytes();

    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(["a.bin", "b.json"]);
    expect(Buffer.compare(Buffer.from(files["a.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["b.json"]!)).toBe('{ "b": 1 }');

    // Every 32-bit field reads 0xFFFFFFFF and the extra field holds the uncompressed size, the compressed size and the offset, in that order.
    const [a, b] = centralDirectory(archive);
    expect(a).toMatchObject({ name: "a.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0xffffffff, zip64: [5_000, 5_000, 0] });
    expect(b!.zip64![2]).toBe(30 + "a.bin".length + 5_000 + 24);
    expect(b!.zip64![0]).toBe(10);
    // The data descriptor after a.bin's bytes carries 8-byte sizes.
    const descriptor = 30 + "a.bin".length + 5_000;
    expect(archive.readUInt32LE(descriptor)).toBe(0x08074b50);
    expect([u64(archive, descriptor + 8), u64(archive, descriptor + 16)]).toEqual([5_000, 5_000]);

    const { end, locator, end64 } = endRecords(archive);
    const directoryOffset = a!.at;
    expect(end64).toEqual({
      at: archive.length - 22 - 20 - 56,
      recordSize: 44,
      versionMadeBy: 45,
      versionNeeded: 45,
      disk: 0,
      directoryDisk: 0,
      entriesHere: 2,
      entries: 2,
      size: end64!.at - directoryOffset,
      offset: directoryOffset,
    });
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    expect(end).toEqual({ entriesHere: 0xffff, entries: 0xffff, size: 0xffffffff, offset: 0xffffffff, comment: 0 });
  });

  test("the writer turns to ZIP64 by itself once an offset passes 4 GiB", async () => {
    const start = TWO_32 - 100;
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { startOffset: start });
    await writer.addFile("a.bin", openerOf(fileOf(Buffer.alloc(50, 1))));
    await writer.addFile("b.bin", openerOf(fileOf(Buffer.alloc(40, 2))));
    await writer.end();
    const archive = sink.bytes();

    const bOffset = start + 30 + 5 + 50 + 16;
    expect(bOffset).toBeGreaterThan(0xffffffff);
    const [a, b] = centralDirectory(archive, start);
    // a.bin starts below 4 GiB and needs nothing; b.bin's offset goes into the extra field alone.
    expect(a).toMatchObject({ name: "a.bin", compressed: 50, size: 50, offset: start, zip64: null });
    expect(b).toMatchObject({ name: "b.bin", compressed: 40, size: 40, offset: 0xffffffff, zip64: [bOffset] });
    // Neither entry reached 4 GiB, so both descriptors keep 4-byte sizes.
    expect(archive.readUInt32LE(30 + 5 + 50)).toBe(0x08074b50);
    expect(archive.readUInt32LE(30 + 5 + 50 + 16)).toBe(0x04034b50);

    const { end, locator, end64 } = endRecords(archive, start);
    expect(end64).toMatchObject({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: a!.at });
    expect(a!.at).toBeGreaterThan(0xffffffff);
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    // Only the directory's offset overflows the classic record.
    expect(end).toEqual({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: 0xffffffff, comment: 0 });
  });

  test("an entry of more than 4 GiB is a ZIP64 entry by itself, without the archive being kept in memory", { timeout: 120_000 }, async () => {
    const huge = fakeFile(TWO_32 + 1);
    // Counts every byte and keeps only what is not the file's own data, with where it starts.
    const kept: { at: number; bytes: Uint8Array }[] = [];
    let written = 0;
    const writer = createZipWriter(async (chunk) => {
      if (chunk.buffer !== huge.chunk.buffer) kept.push({ at: written, bytes: Uint8Array.from(chunk) });
      written += chunk.length;
    });
    expect(await writer.addFile("huge.bin", huge.open)).toBe(true);
    await writer.addJsonPieces("after.json", piecesOf('{ "after": true }'));
    await writer.end();
    expect(huge.state).toEqual({ chunks: TWO_32 / KIB64 + 1, stopped: true, closed: true });

    // Everything after the file's data is kept together: its descriptor, the next entry, the directory and the end records.
    const dataEnd = 30 + "huge.bin".length + TWO_32 + 1;
    const tail = Buffer.concat(kept.filter((piece) => piece.at >= dataEnd).map((piece) => piece.bytes));
    expect(dataEnd + tail.length).toBe(written);
    expect(tail.readUInt32LE(0)).toBe(0x08074b50);
    expect([u64(tail, 8), u64(tail, 16)]).toEqual([TWO_32 + 1, TWO_32 + 1]);
    const [hugeEntry, after] = centralDirectory(tail, dataEnd);
    expect(hugeEntry).toMatchObject({ name: "huge.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0, zip64: [TWO_32 + 1, TWO_32 + 1] });
    expect(after).toMatchObject({ name: "after.json", offset: 0xffffffff, zip64: [dataEnd + 24] });
    const { end, end64 } = endRecords(tail, dataEnd);
    expect(end64).toMatchObject({ entries: 2, offset: hugeEntry!.at });
    expect(end).toMatchObject({ entries: 2, offset: 0xffffffff });
  });
});

describe("the export route", () => {
  /**
   * The account routes on their own, with the session and the logger a request would carry and an error
   * handler that renders AccountError as the app's does; everything else is a 500. The freshness and
   * session guards are passed through: http-account.test.ts covers them on the real app.
   */
  function app(h: Harness, log = silent) {
    const session: Session = {
      sessionId: randomBytes(32).toString("hex"),
      userId: h.userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: h.now(),
      // The route marks the current session by this, the id the list carries, and not by the token's hash above.
      handle: h.currentSession,
      factors: { email: h.now().getTime() },
      passkeyId: null,
    };
    const pass: MiddlewareHandler<AppEnv> = async (_c, next) => {
      await next();
    };
    const a = new Hono<AppEnv>();
    a.use(async (c, next) => {
      c.set("requestId", "test");
      c.set("log", log);
      c.set("session", session);
      c.set("authVia", "cookie");
      await next();
    });
    a.route("/api/account", accountRoutes(h.deps, pass, pass, pass));
    a.onError((err, c) => (err instanceof AccountError ? c.json({ error: { code: err.code } }, err.status) : c.json({ error: { code: "internal" } }, 500)));
    return a;
  }
  const exportOf = (a: Hono<AppEnv>) => a.request("/api/account/export", { method: "POST" });
  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
  const exported = (h: Harness) => h.events.filter((event) => event.type === "export_created").length;

  test("a complete export streams a valid archive with its headers and records export_created", async () => {
    const h = harness();
    const bytesA = randomBytes(300_000);
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="korbat-export-ada-${iso(T0).slice(0, 10)}.zip"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    // Recorded once every chunk was taken, before the body ended.
    expect(h.events).toEqual([{ userId: h.userId, type: "export_created", metadata: undefined }]);
  });

  test("a failure before the first byte answers an error and gives the day's export back", async () => {
    const h = harness();
    const a = app(h);
    // The build fails: a pool timeout while the account is read.
    h.failures.exportAccount = 1;
    const failed = await exportOf(a);
    expect(failed.status).toBe(500);
    expect(await errorCode(failed)).toBe("internal");
    // The first image cannot even be opened: still nothing sent.
    h.images.push({
      id: h.imageA,
      open: async () => {
        throw new Error("too many open files");
      },
    });
    const unopened = await exportOf(a);
    expect(unopened.status).toBe(500);
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    const ok = await exportOf(a);
    expect(ok.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await ok.arrayBuffer())))).toEqual(["export.json"]);
    expect(exported(h)).toBe(1);
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a limit store that cannot give the export back is logged, and the build's own error is answered", async () => {
    const h = harness();
    const lines: string[] = [];
    const log = pino({ level: "warn" }, new Writable({ write: (chunk: Buffer, _encoding, done) => (lines.push(chunk.toString("utf8")), done()) }));
    const store = new MemoryStore(() => h.now().getTime());
    h.deps.limits = {
      hit: (key, windowMs) => store.hit(key, windowMs),
      release: async () => {
        throw new Error("the store went away");
      },
    };
    h.failures.exportAccount = 1;
    const res = await exportOf(app(h, log));
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe("internal");
    expect(lines.map((line) => (JSON.parse(line) as { level: number; msg: string }).level)).toEqual([40]);
    expect(lines[0]).toMatch(/could not be given back/);
  });

  test("an image that fails in the middle of its reading fails the response body, and the day's export stays spent", async () => {
    const h = harness();
    const failing = fakeFile(1_000_000, { failAfter: 3 });
    h.images.push({ id: h.imageA, open: failing.open });
    const a = app(h);
    const res = await exportOf(a);
    // The status went out with the first bytes; what follows can only end the body with an error, never cleanly.
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect(failing.state).toMatchObject({ chunks: 3, stopped: true, closed: true });
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a client that goes away stops the file reads", async () => {
    const h = harness();
    // A hundred megabytes, read only as fast as the response is taken.
    const big = fakeFile(100 * 1024 * 1024);
    h.images.push({ id: h.imageA, open: big.open });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(big.state).toMatchObject({ stopped: true, closed: true }));
    expect(big.state.chunks).toBeLessThan(10);
    expect(exported(h)).toBe(0);
  });
});
```

### Replace `apps/api/test/auth/deletion.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { DELETE_STARTS_PER_HOUR, confirmDeletion, finishPurge, startDeletion } from "../../src/auth/flows/deletion";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MIN_START_RESPONSE_MS, flowKey, startEmail } from "../../src/auth/flows/email";
import { passwordSignIn } from "../../src/auth/flows/password";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashPassword } from "../../src/auth/passwords";
import type { Session } from "../../src/auth/sessions";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** Starts a deletion and returns its flow id with the code from the mail to the account's address. */
async function start(h: MemoryFlowHarness, session: Session, email: string) {
  const { flowId } = await startDeletion(h.deps, session, h.ctx);
  return { flowId, code: h.mailer.lastCodeFor(email)! };
}

describe("account deletion: the start step", () => {
  test("mails a code to the account's own address, keeps the pending deletion under the hashed flow id, and changes nothing else", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId } = await startDeletion(h.deps, ada.session, h.ctx);
    expect(flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.mailer.sent.map((m) => [m.to, m.template, Object.keys(m.data)])).toEqual([["ada@korbat.local", "delete_account_code", ["code"]]]);
    const expiresAt = new Date(h.now().getTime() + CODE_TTL_MS);
    expect(h.codes.map((c) => [c.email, c.purpose, c.userId, c.ipHash, c.expiresAt, c.attempts])).toEqual([["ada@korbat.local", "delete_account", ada.user.id, h.ctx.ipHash, expiresAt, 0]]);
    expect(JSON.parse((await h.kv.get(flowKey(flowId)))!)).toEqual({ userId: ada.user.id });
    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(h.sessions.filter((s) => s.revokedAt !== null)).toEqual([]);
    expect(h.events).toEqual([]);
  });

  test("allows 3 starts an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < DELETE_STARTS_PER_HOUR; i++) await startDeletion(h.deps, ada.session, h.ctx);
    const refused = await failure(startDeletion(h.deps, ada.session, h.ctx));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent).toHaveLength(DELETE_STARTS_PER_HOUR);
    expect(await h.kv.get(`rl:delete-start:${ada.user.id}`)).toBe(String(DELETE_STARTS_PER_HOUR + 1));
    // Another account's window is its own.
    const bob = h.user("bob@korbat.local");
    await startDeletion(h.deps, bob.session, h.ctx);
    h.advance(HOUR + 1);
    await startDeletion(h.deps, ada.session, h.ctx);
    expect(h.mailer.sent.map((m) => m.to)).toEqual(["ada@korbat.local", "ada@korbat.local", "ada@korbat.local", "bob@korbat.local", "ada@korbat.local"]);
  });
});

describe("account deletion: the confirmation", () => {
  test("the typed handle must be the account's own, in any case, and is checked before the code, so a slip costs no attempt", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local", "ada_l");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    const mismatch = await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada_" }));
    expect(mismatch).toMatchObject({ code: "invalid_request", status: 400, message: "handle_mismatch" });
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "bob" }))).toMatchObject({ code: "invalid_request", status: 400, message: "handle_mismatch" });
    expect(h.codes[0]!.attempts).toBe(0);
    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);
    expect(h.events).toEqual([]);
    // The handle compares case-insensitively: what the owner types may differ in case from what they chose.
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ADA_L" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
  });

  test("a wrong code is invalid_code and counts an attempt; another account's flow, an unknown flow and an expired code are refused; five wrong codes exhaust it", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada" }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    // A flow another account started is no code at all for this one, settled before an attempt is counted.
    expect(await failure(confirmDeletion(h.deps, bob.session, { flowId, code, handle: "bob" }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId: randomToken(), code, handle: "ada" }))).toMatchObject({ code: "invalid_code", status: 400 });
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada" }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" }))).toMatchObject({ code: "too_many_attempts", status: 429 });

    const again = await start(h, ada.session, "ada@korbat.local");
    h.advance(CODE_TTL_MS + 1);
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId: again.flowId, code: again.code, handle: "ada" }))).toMatchObject({ code: "code_expired", status: 400 });

    for (const user of [ada, bob]) expect(h.users.get(user.user.id)!.deletedAt).toBeNull();
    expect(h.sessions.filter((s) => s.revokedAt !== null)).toEqual([]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code", "delete_account_code"]);
    expect(h.events).toEqual([]);
  });

  test("tells the address, marks the account deleted, revokes every session with a tombstone, deletes devices, codes and passkeys with the WebAuthn user handle, records the event, and spends the code", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    // A passkey each, on accounts that both hold a WebAuthn user handle: ada's passkey and handle go with the take-down, bob's stay.
    h.passkey(ada.user.id);
    const bobs = h.passkey(bob.user.id);
    h.users.get(ada.user.id)!.webauthnUserId = Buffer.alloc(32, 7);
    h.users.get(bob.user.id)!.webauthnUserId = Buffer.alloc(32, 8);
    // A sign-in code out for ada, and one for bob: the account's codes go, nobody else's.
    for (const user of [ada, bob]) {
      await h.deps.repo.createEmailCode({ flowId: randomToken(), email: user.user.email, userId: user.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    }
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.advance(1000);
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });

    expect(h.mailer.sent.map((m) => [m.to, m.template])).toEqual([
      ["ada@korbat.local", "delete_account_code"],
      ["ada@korbat.local", "account_deleted"],
    ]);
    const stored = h.users.get(ada.user.id)!;
    expect(stored.deletedAt).toEqual(h.now());
    // The row is anonymised by the purge, not here: the address and the credentials are still in place for the moment.
    expect([stored.email, stored.purgedAt]).toEqual(["ada@korbat.local", null]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(await h.kv.get(`sess:2:${bob.session.sessionId}`)).toBeNull();
    expect(h.devices.map((d) => d.userId)).toEqual([bob.user.id]);
    expect(h.codes.map((c) => [c.userId, c.purpose])).toEqual([[bob.user.id, "login"]]);
    expect(h.passkeys.map((p) => p.id)).toEqual([bobs]);
    expect(stored.webauthnUserId).toBeNull();
    expect(h.users.get(bob.user.id)!.webauthnUserId).toEqual(Buffer.alloc(32, 8));
    expect(h.events).toEqual([{ userId: ada.user.id, type: "account_deleted", deviceId: ada.session.deviceId, metadata: {} }]);
    expect(await h.kv.get(flowKey(flowId))).toBeNull();
    // The account is gone for every purpose: the same session cannot confirm again, whatever it sends.
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" }))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(await failure(startDeletion(h.deps, ada.session, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
  });

  test("the notice is best effort: a mail failure does not stop the deletion", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.mailer.failing = true;
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);
    expect(h.events.map((e) => e.type)).toEqual(["account_deleted"]);
  });

  test("a take-down whose transaction fails midway leaves the account live with its sessions, devices and codes, and tells nobody", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    await h.deps.repo.createEmailCode({ flowId: randomToken(), email: "ada@korbat.local", userId: ada.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.faults.add("takeDown");
    await expect(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" })).rejects.toThrow(/midway/);

    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(await h.deps.repo.findUserById(ada.user.id)).toBeDefined();
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null, null]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBeNull();
    expect(h.devices.filter((d) => d.userId === ada.user.id)).toHaveLength(2);
    expect(h.codes.map((c) => c.purpose)).toEqual(["login", "delete_account"]);
    expect(h.events).toEqual([]);
    // Nobody is told the account is gone while it is not.
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);

    // The code is spent, but the account is its owner's, who can start again and finish.
    h.faults.clear();
    const again = await start(h, ada.session, "ada@korbat.local");
    await confirmDeletion(h.deps, ada.session, { flowId: again.flowId, code: again.code, handle: "ada" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
  });

  test("a cache failure after the take-down does not fail the confirmation: the rows are revoked, the owner is told, and only the tombstones are missing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    const set = h.kv.set.bind(h.kv);
    h.kv.set = async () => {
      throw new Error("the cache is unreachable");
    };
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    h.kv.set = set;
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.devices.filter((d) => d.userId === ada.user.id)).toEqual([]);
    expect(h.events.map((e) => e.type)).toEqual(["account_deleted"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code", "account_deleted"]);
    // A cached copy of the session can live out its minute; the revoked row is what every other lookup reads.
    expect(await h.kv.get(`sess:2:${ada.session.sessionId}`)).toBeNull();
  });
});

describe("account deletion: the purge's last step", () => {
  test("repeats step 1's rows for an account marked deleted by hand, with tombstones, the passkey and the WebAuthn user handle included, then anonymises the row; a repeat changes nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    Object.assign(h.users.get(ada.user.id)!, { passwordHash: "hash", phoneHash: "phone", totpSecretEnc: "v1:secret", totpEnabledAt: h.now(), recoveryCodesHash: ["r"], webauthnUserId: Buffer.alloc(32, 7) });
    h.passkey(ada.user.id);
    await h.deps.repo.createEmailCode({ flowId: randomToken(), email: "ada@korbat.local", userId: ada.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    const bob = h.user("bob@korbat.local");
    // Marked deleted and nothing else, as a take-down that stopped after the mark would leave it.
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    h.advance(1000);
    await finishPurge(h.deps, ada.user.id);

    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(h.devices.map((d) => d.userId)).toEqual([bob.user.id]);
    expect(h.codes).toEqual([]);
    expect(h.passkeys).toEqual([]);
    expect(h.users.get(ada.user.id)).toMatchObject({
      email: `deleted:${ada.user.id}`,
      webauthnUserId: null,
      passwordHash: null,
      phoneHash: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      recoveryCodesHash: [],
      termsVersion: null,
      purgedAt: h.now(),
    });
    // Nothing is recorded or sent: the event and the notice belong to the confirmation.
    expect(h.events).toEqual([]);
    expect(h.mailer.sent).toEqual([]);

    const purged = structuredClone(h.users.get(ada.user.id));
    h.advance(1000);
    await finishPurge(h.deps, ada.user.id);
    expect(h.users.get(ada.user.id)).toEqual(purged);
  });

  test("leaves a live account alone", async () => {
    const h = memoryFlowHarness();
    const bob = h.user("bob@korbat.local");
    await finishPurge(h.deps, bob.user.id);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null]);
    expect(await h.kv.get(`sess:2:${bob.session.sessionId}`)).toBeNull();
    expect(h.devices).toHaveLength(1);
    expect(h.users.get(bob.user.id)).toMatchObject({ email: "bob@korbat.local", deletedAt: null, purgedAt: null });
  });
});

describe("a deleted account is invisible to sign-in", () => {
  test("the sign-in start treats the address as unknown, in the same shape and time; password sign-in is invalid_credentials and records no failure", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const password = "correct horse battery staple";
    h.users.get(ada.user.id)!.passwordHash = await hashPassword(password);
    const device = { deviceId: randomToken(), platform: "web" as const };

    // While the account lives: the start sends a sign-in code, and a wrong password is a recorded failure.
    await startEmail(h.deps, { email: "ada@korbat.local", turnstileToken: "ok", ...device }, h.ctx);
    expect(h.codes.map((c) => c.purpose)).toEqual(["login"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["sign_in_code"]);
    expect(await failure(passwordSignIn(h.deps, { email: "ada@korbat.local", password: "not it", turnstileToken: "ok", ...device }, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure"]);
    expect(h.users.get(ada.user.id)!.failedLogins).toBe(1);

    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure", "account_deleted"]);

    // Past the address's cooldown: the start now answers as for an address without an account, in the same shape and time.
    h.advance(MINUTE + 1);
    const startedAt = Date.now();
    const started = await startEmail(h.deps, { email: "ada@korbat.local", turnstileToken: "ok", ...device }, h.ctx);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(MIN_START_RESPONSE_MS - 10);
    expect(Object.keys(started)).toEqual(["flowId"]);
    expect(h.codes.map((c) => [c.purpose, c.userId])).toEqual([["signup", null]]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["sign_in_code", "delete_account_code", "account_deleted", "sign_up_code"]);
    // The right password no longer signs in, and the failure counter and the event log do not move: there is no account to record against.
    expect(await failure(passwordSignIn(h.deps, { email: "ada@korbat.local", password, turnstileToken: "ok", ...device }, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure", "account_deleted"]);
    expect(h.users.get(ada.user.id)!.failedLogins).toBe(1);
  });
});
```

### Replace `apps/api/test/auth/email-change.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MIN_START_RESPONSE_MS, flowKey } from "../../src/auth/flows/email";
import {
  EMAIL_CHANGE_STARTS_PER_HOUR,
  EMAIL_REVERTS_PER_IP_PER_HOUR,
  EMAIL_REVERT_TTL_MS,
  emailRevertKey,
  revertEmailChange,
  startEmailChange,
  verifyEmailChange,
} from "../../src/auth/flows/email-change";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import type { AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
/** What the undo's event carries beside the address hashes once the lockdown ran and found nothing else to remove. */
const NOTHING_ELSE = { passkeysRemoved: [], totpCleared: false, passwordCleared: true };

/** An account with two-factor on since `enabledAt`, as the confirm step leaves it. */
function withTotp(h: MemoryFlowHarness, userId: string, enabledAt: Date) {
  Object.assign(h.users.get(userId)!, { totpSecretEnc: "v1:owner", totpEnabledAt: enabledAt, totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
}

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** Starts a change and returns its flow id with the code from the mail to the new address. */
async function start(h: MemoryFlowHarness, session: Session, email: string) {
  const { flowId } = await startEmailChange(h.deps, session, { email }, h.ctx);
  return { flowId, code: h.mailer.lastCodeFor(email)! };
}

const REVERT_URL = /^http:\/\/localhost:8081\/email-revert\/([A-Za-z0-9_-]{43})$/;
const LINK_GONE = "This link has expired or was already used.";

/** Moves the account to `email` with the code from its mailbox, and returns the undo link's token from the notice to the old address, if it carried one. */
async function change(h: MemoryFlowHarness, session: Session, email: string): Promise<string | null> {
  const { flowId, code } = await start(h, session, email);
  await verifyEmailChange(h.deps, session, { flowId, code });
  const notice = h.mailer.sent.at(-1)!;
  expect(notice.template).toBe("email_changed");
  const url = notice.data.revertUrl;
  return url === undefined ? null : REVERT_URL.exec(url)![1]!;
}

describe("email change: the start step", () => {
  test("answers the same, in the same time, whether or not the new address already has an account", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.user("taken@korbat.local");
    const startedAt = Date.now();
    const toTaken = await startEmailChange(h.deps, ada.session, { email: "taken@korbat.local" }, h.ctx);
    const elapsed = Date.now() - startedAt;
    const toFree = await startEmailChange(h.deps, ada.session, { email: "free@korbat.local" }, h.ctx);
    expect(Object.keys(toTaken)).toEqual(["flowId"]);
    expect(Object.keys(toFree)).toEqual(["flowId"]);
    expect(toTaken.flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(elapsed).toBeGreaterThanOrEqual(MIN_START_RESPONSE_MS - 10);
    expect(h.mailer.sent.map((m) => [m.to, m.template, Object.keys(m.data)])).toEqual([
      ["taken@korbat.local", "email_change_code", ["code"]],
      ["free@korbat.local", "email_change_code", ["code"]],
    ]);
    const expiresAt = new Date(h.now().getTime() + CODE_TTL_MS);
    expect(h.codes.map((c) => [c.email, c.purpose, c.userId, c.ipHash, c.expiresAt, c.attempts])).toEqual([
      ["taken@korbat.local", "change_email", ada.user.id, h.ctx.ipHash, expiresAt, 0],
      ["free@korbat.local", "change_email", ada.user.id, h.ctx.ipHash, expiresAt, 0],
    ]);
    expect(JSON.parse((await h.kv.get(flowKey(toFree.flowId)))!)).toEqual({ userId: ada.user.id, email: "free@korbat.local" });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.events).toEqual([]);
  });

  test("refuses a disposable domain and the account's current address, in any case, before any mail or limit is touched", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    expect(await failure(startEmailChange(h.deps, ada.session, { email: "someone@mailinator.com" }, h.ctx))).toMatchObject({ code: "disposable_email", status: 400 });
    expect(await failure(startEmailChange(h.deps, ada.session, { email: "ada@korbat.local" }, h.ctx))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(await failure(startEmailChange(h.deps, ada.session, { email: "Ada@korbat.local" }, h.ctx))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(h.mailer.sent).toEqual([]);
    expect(h.codes).toEqual([]);
    // A slip does not delay the account's own sign-in codes: the current address got no cooldown.
    expect(await h.kv.get(`email-cooldown:${emailHash(h.deps.config.authHmacKey, "ada@korbat.local")}`)).toBeNull();
    expect(await h.kv.get(`rl:email-change:${ada.user.id}`)).toBeNull();
  });

  test("allows 3 starts an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < EMAIL_CHANGE_STARTS_PER_HOUR; i++) await startEmailChange(h.deps, ada.session, { email: `new-${i}@korbat.local` }, h.ctx);
    const refused = await failure(startEmailChange(h.deps, ada.session, { email: "new-3@korbat.local" }, h.ctx));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent).toHaveLength(EMAIL_CHANGE_STARTS_PER_HOUR);
    // Another account's window is its own.
    const bob = h.user("bob@korbat.local");
    await startEmailChange(h.deps, bob.session, { email: "bob-new@korbat.local" }, h.ctx);
    h.advance(HOUR + 1);
    await startEmailChange(h.deps, ada.session, { email: "new-3@korbat.local" }, h.ctx);
    expect(h.mailer.sent.map((m) => m.to)).toEqual(["new-0@korbat.local", "new-1@korbat.local", "new-2@korbat.local", "bob-new@korbat.local", "new-3@korbat.local"]);
  });

  test("a new address waits 60 seconds between codes and gets at most 3 an hour, whoever asks, in the sign-in start's buckets", async () => {
    const h = memoryFlowHarness();
    const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => h.user(`${name}@korbat.local`));
    const target = "shared@korbat.local";
    const hashed = emailHash(h.deps.config.authHmacKey, target);
    await startEmailChange(h.deps, a!.session, { email: target }, h.ctx);
    expect(await failure(startEmailChange(h.deps, b!.session, { email: target }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: MINUTE / 1000 });
    h.advance(MINUTE + 1);
    await startEmailChange(h.deps, b!.session, { email: target }, h.ctx);
    h.advance(MINUTE + 1);
    await startEmailChange(h.deps, c!.session, { email: target }, h.ctx);
    expect(await h.kv.get(`rl:email-start:email:${hashed}`)).toBe("3");
    expect(await h.kv.get(`email-cooldown:${hashed}`)).toBe("1");
    h.advance(MINUTE + 1);
    expect(await failure(startEmailChange(h.deps, d!.session, { email: target }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent.filter((m) => m.to === target)).toHaveLength(3);
    h.advance(HOUR);
    await startEmailChange(h.deps, d!.session, { email: target }, h.ctx);
    expect(h.mailer.sent.filter((m) => m.to === target)).toHaveLength(4);
  });
});

describe("email change: the verification step", () => {
  test("a wrong code is invalid_code and counts an attempt; the right one still works within the limit", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code: wrong(code) }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId: randomToken(), code }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
  });

  test("a code older than 10 minutes is code_expired and changes nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    h.advance(CODE_TTL_MS + 1);
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "code_expired", status: 400 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.events).toEqual([]);
  });

  test("five wrong codes exhaust the code: too_many_attempts even for the right one", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code: wrong(code) }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
  });

  test("a flow another account started is invalid_code for this one and costs its owner no attempt", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, bob.session, { flowId, code }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(0);
    expect(h.users.get(bob.user.id)!.email).toBe("bob@korbat.local");
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
  });

  test("an address that belongs to another account, in any case, is email_in_use only now, and nothing changes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.user("Wanted@korbat.local");
    const { flowId, code } = await start(h, ada.session, "wanted@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "email_in_use", status: 409 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["email_change_code"]);
    expect(h.events).toEqual([]);
    // The code was spent on the attempt: the owner starts again rather than retrying it.
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "invalid_code" });
  });

  test("replaces the address and marks it verified, tells the old address, records both hashes, and keeps the session signed in", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    h.advance(1000);
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
    const stored = h.users.get(ada.user.id)!;
    expect([stored.email, stored.emailVerifiedAt]).toEqual(["ada-new@korbat.local", h.now()]);
    expect(h.mailer.sent.map((m) => [m.to, m.template, m.data])).toEqual([
      ["ada-new@korbat.local", "email_change_code", { code }],
      ["ada@korbat.local", "email_changed", { email: "ada-new@korbat.local", revertUrl: expect.stringMatching(REVERT_URL) }],
    ]);
    const key = h.deps.config.authHmacKey;
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "email_changed", deviceId: ada.session.deviceId, metadata: { from: emailHash(key, "ada@korbat.local"), to: emailHash(key, "ada-new@korbat.local") } },
    ]);
    expect(h.codes[0]!.consumedAt).toEqual(h.now());
    expect(await h.kv.get(flowKey(flowId))).toBeNull();
    // No revocation tombstone was written for the session that made the change.
    expect(await h.kv.get(`sess:2:${ada.session.sessionId}`)).toBeNull();
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "invalid_code" });
  });

  test("the notice to the old address is best effort: a mail failure does not undo the change", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    h.mailer.failing = true;
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
    expect(h.users.get(ada.user.id)!.email).toBe("ada-new@korbat.local");
    expect(h.events.map((e) => e.type)).toEqual(["email_changed"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["email_change_code"]);
  });
});

describe("email change: the undo link sent to the old address", () => {
  test("the notice carries a link good for 24 hours, kept under its hashed token with the old address, the time of the change and the passkey behind the changing session", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.advance(1000);
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    const raw = (await h.kv.get(emailRevertKey(token)))!;
    expect(emailRevertKey(token)).toBe(`email-revert:${sha256Hex(token)}`);
    expect(JSON.parse(raw)).toEqual({ userId: ada.user.id, oldEmail: "ada@korbat.local", changedAt: h.now().getTime(), passkeyId: null });
    expect(raw).not.toContain(token);
    h.advance(EMAIL_REVERT_TTL_MS - 1);
    expect(await h.kv.get(emailRevertKey(token))).not.toBeNull();
    h.advance(1);
    expect(await h.kv.get(emailRevertKey(token))).toBeNull();

    // A session a passkey started names it, so the undo removes that passkey whatever its age.
    const bob = h.user("bob@korbat.local");
    const passkeyId = h.passkey(bob.user.id);
    const byPasskey = h.session(bob.user.id, { passkeyId });
    const bobsToken = (await change(h, byPasskey, "bob-new@korbat.local"))!;
    expect(JSON.parse((await h.kv.get(emailRevertKey(bobsToken)))!)).toMatchObject({ userId: bob.user.id, passkeyId });
  });

  test("the link moves the account back, signs every session out, records the undo with both hashes, tells the old address and nobody else", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // The session an attacker got hold of, which makes the change, and the owner's own, which the change leaves alone.
    const owners = h.session(ada.user.id);
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    const changedAt = h.now();
    // What the undo hands the lockdown's one transaction: the change as its anchor, and the event to record with it.
    const handed: Parameters<AuthRepo["lockDown"]>[] = [];
    const lockDown = h.deps.repo.lockDown;
    h.deps.repo.lockDown = async (...args) => {
      handed.push(args);
      return lockDown(...args);
    };
    h.advance(60_000);
    await revertEmailChange(h.deps, { token }, h.ctx);

    const stored = h.users.get(ada.user.id)!;
    expect([stored.email, stored.emailVerifiedAt]).toEqual(["ada@korbat.local", h.now()]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, owners.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    const key = h.deps.config.authHmacKey;
    const hashes = { from: emailHash(key, "attacker@korbat.local"), to: emailHash(key, "ada@korbat.local"), reverted: true };
    expect(handed).toEqual([
      [
        ada.user.id,
        { now: h.now(), since: new Date(changedAt.getTime() - LOCKDOWN_LOOKBACK_MS), passkeyIds: [], event: { type: "email_changed", deviceId: null, ipHash: h.ctx.ipHash, metadata: hashes } },
      ],
    ]);
    expect(h.events.at(-1)).toEqual({ userId: ada.user.id, type: "email_changed", deviceId: null, metadata: { ...hashes, ...NOTHING_ELSE } });
    // The address the account was moved to is told nothing; the old one gets a short note.
    expect(h.mailer.sent.filter((m) => m.to === "attacker@korbat.local").map((m) => m.template)).toEqual(["email_change_code"]);
    expect(h.mailer.sent.at(-1)).toEqual({ to: "ada@korbat.local", template: "email_change_reverted", data: {} });
    // The old address signs in again; the other one no longer belongs to any account.
    expect((await h.deps.repo.findUserByEmail("ada@korbat.local"))?.id).toBe(ada.user.id);
    expect(await h.deps.repo.findUserByEmail("attacker@korbat.local")).toBeUndefined();
  });

  test("the undo also revokes every device of the account, so a sign-in on any of them counts as a new device again", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // The device whoever made the change used, and the owner's own; another account's device is not touched.
    h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(60_000);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.devices.filter((d) => d.userId === bob.user.id).map((d) => d.revokedAt)).toEqual([null]);
  });

  test("the password goes whenever it was set, and two-factor turned on more than a day before the change stays", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // The owner's own, from before: a password nobody can tell from one an attacker set, and two-factor from just outside the day the lockdown reaches back.
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    withTotp(h, ada.user.id, h.now());
    h.advance(LOCKDOWN_LOOKBACK_MS + 1);
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(HOUR);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: "v1:owner", totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
    expect(h.events.at(-1)!.metadata).toMatchObject({ reverted: true, totpCleared: false, passwordCleared: true });
  });

  test("two-factor turned on within the day before the change, or after it, goes with it", async () => {
    const h = memoryFlowHarness();
    const before = h.user("before@korbat.local");
    // Exactly a day before the change: the first moment the lockdown reaches.
    withTotp(h, before.user.id, h.now());
    h.advance(LOCKDOWN_LOOKBACK_MS);
    const beforesToken = (await change(h, before.session, "attacker-1@korbat.local"))!;
    const after = h.user("after@korbat.local");
    const aftersToken = (await change(h, after.session, "attacker-2@korbat.local"))!;
    h.advance(1000);
    Object.assign(h.users.get(after.user.id)!, { totpSecretEnc: "v1:attacker", totpEnabledAt: h.now(), totpLastStep: 42, recoveryCodesHash: ["attacker-code"] });
    h.advance(1000);
    await revertEmailChange(h.deps, { token: beforesToken }, h.ctx);
    await revertEmailChange(h.deps, { token: aftersToken }, h.ctx);
    for (const account of [before, after]) {
      expect(h.users.get(account.user.id), account.user.email).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    }
    expect(h.events.filter((e) => e.metadata.reverted).map((e) => [e.userId, e.metadata.totpCleared])).toEqual([
      [before.user.id, true],
      [after.user.id, true],
    ]);
  });

  test("a passkey added since the day before the change goes, an older one stays, and the passkey that started the changing session goes whatever its age", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const older = h.passkey(ada.user.id, new Date(h.now().getTime() - 1));
    const ownSince = h.passkey(ada.user.id, h.now());
    const named = h.passkey(ada.user.id, new Date(h.now().getTime() - 30 * DAY));
    const changing = h.session(ada.user.id, { passkeyId: named });
    h.advance(LOCKDOWN_LOOKBACK_MS);
    const token = (await change(h, changing, "attacker@korbat.local"))!;
    h.advance(HOUR);
    const added = h.passkey(ada.user.id);
    h.advance(HOUR);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.passkeys.map((p) => p.id)).toEqual([older]);
    const removed = h.events.at(-1)!.metadata.passkeysRemoved as string[];
    expect([...removed].sort()).toEqual([ownSince, named, added].sort());
  });

  test("a used link and an expired one are refused and change nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    await revertEmailChange(h.deps, { token }, h.ctx);
    const used = await failure(revertEmailChange(h.deps, { token }, h.ctx));
    expect(used).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });

    const bob = h.user("bob@korbat.local");
    const late = (await change(h, bob.session, "bob-new@korbat.local"))!;
    h.advance(EMAIL_REVERT_TTL_MS);
    expect(await failure(revertEmailChange(h.deps, { token: late }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.users.get(bob.user.id)!.email).toBe("bob-new@korbat.local");
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.mailer.sent.filter((m) => m.template === "email_change_reverted").map((m) => m.to)).toEqual(["ada@korbat.local"]);
  });

  test("the link of an account deleted since is refused before it is spent, and nothing is restored", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    const stored = await h.kv.get(emailRevertKey(token));
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    const eventsBefore = h.events.length;
    expect(await failure(revertEmailChange(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.users.get(ada.user.id)!.email).toBe("ada-new@korbat.local");
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.events).toHaveLength(eventsBefore);
    expect(h.mailer.sent.map((m) => m.template)).not.toContain("email_change_reverted");
    // The checks come first and the link is taken only just before the address is restored: a refusal leaves it to run out with its day.
    expect(await h.kv.get(emailRevertKey(token))).toBe(stored);
  });

  test("two uses of one link at once act once: the address is restored and the lockdown recorded once, and the other use is refused", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(MINUTE);
    const outcomes = await Promise.allSettled([revertEmailChange(h.deps, { token }, h.ctx), revertEmailChange(h.deps, { token }, { ...h.ctx, ipHash: randomToken() })]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected")!.reason).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", emailVerifiedAt: h.now() });
    expect(h.events.filter((e) => e.metadata.reverted)).toHaveLength(1);
    expect(h.mailer.sent.filter((m) => m.template === "email_change_reverted").map((m) => m.to)).toEqual(["ada@korbat.local"]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
  });

  test("an old address that got another account meanwhile is email_in_use, and nothing changes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    h.user("Ada@korbat.local");
    const eventsBefore = h.events.length;
    expect(await failure(revertEmailChange(h.deps, { token }, h.ctx))).toMatchObject({ code: "email_in_use", status: 409 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada-new@korbat.local");
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.events).toHaveLength(eventsBefore);
    expect(h.mailer.sent.map((m) => m.template)).not.toContain("email_change_reverted");
    // The unique index on the address decides at the restore itself, for which the link was already taken: this one refusal spends it.
    expect(await failure(revertEmailChange(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
  });

  test("allows 10 tries an hour per address, then rate_limited with a Retry-After", async () => {
    const h = memoryFlowHarness();
    for (let i = 0; i < EMAIL_REVERTS_PER_IP_PER_HOUR; i++) {
      expect(await failure(revertEmailChange(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(revertEmailChange(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    // Another address has its own window.
    expect(await failure(revertEmailChange(h.deps, { token: randomToken() }, { ...h.ctx, ipHash: randomToken() }))).toMatchObject({ code: "invalid_code" });
  });

  test("an undo whose lockdown fails leaves the address restored and nothing else changed: no session revoked, the password in place, no undo recorded and no note sent", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "set-since", h.now());
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(MINUTE);
    h.faults.add("lockDown");
    await expect(revertEmailChange(h.deps, { token }, h.ctx)).rejects.toThrow(/midway/);
    // The address went back before the lockdown began; the lockdown is one transaction, so none of it landed.
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", passwordHash: "set-since" });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([null]);
    expect(h.events.map((e) => [e.type, e.metadata.reverted])).toEqual([["email_changed", undefined]]);
    expect(h.mailer.sent.map((m) => m.template)).not.toContain("email_change_reverted");
    // The link was spent by the attempt.
    h.faults.clear();
    expect(await failure(revertEmailChange(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
  });

  test("a second change while the link is out sends no second link, so whoever made it holds none; the one link undoes both and clears what was set since the first", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "middle@korbat.local"))!;
    h.advance(MINUTE + 1);
    // Were the middle address sent a link to itself, an attacker who made both changes could use it after the owner used theirs and take the account back.
    expect(await change(h, ada.session, "last@korbat.local")).toBeNull();
    const toMiddle = h.mailer.sent.at(-1)!;
    expect([toMiddle.to, toMiddle.data]).toEqual(["middle@korbat.local", { email: "last@korbat.local" }]);
    await h.deps.repo.setPasswordHash(ada.user.id, "attacker-password", h.now());
    h.advance(1000);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", passwordHash: null });
    const key = h.deps.config.authHmacKey;
    expect(h.events.at(-1)!.metadata).toEqual({ from: emailHash(key, "last@korbat.local"), to: emailHash(key, "ada@korbat.local"), reverted: true, ...NOTHING_ELSE });

    // Once the link was used, the next change sends one again.
    const owner = h.session(ada.user.id);
    h.advance(HOUR);
    expect(await change(h, owner, "ada-2@korbat.local")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the note to the old address is best effort: a mail failure does not undo the revert", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    h.mailer.failing = true;
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.events.map((e) => e.type)).toEqual(["email_changed", "email_changed"]);
  });
});
```

### Replace `apps/api/test/auth/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { Platform } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type {
  ActiveSessionRow,
  AddPasskeyOutcome,
  AuthEventType,
  AuthRepo,
  DeviceRow,
  EmailCodeRow,
  LockDownInput,
  LockDownOutcome,
  NewPasskey,
  PasskeyLimits,
  PasskeyListRow,
  PasskeyRow,
  SessionListRow,
  UserRow,
} from "../../src/auth/repo";
import { createSessions, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, type Factors, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/**
 * A session of a user, as the deletion and lockdown flows revoke it and, since Task 5, as the sign-in and re-authentication
 * flows issue, resolve and rotate it. The first three fields are all those older flows read; the rest let findActiveSession
 * answer a full row.
 */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
  deviceId: string;
  handle: string;
  factors: Record<string, number>;
  passkeyId: string | null;
  reauthAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RecordedDevice {
  id: string;
  userId: string;
  revokedAt: Date | null;
  /** What the passkey flows read of the row: the platform for a passkey's default name and the label for the Security list. */
  platform: Platform;
  label: string | null;
  /** The keyed hash a sign-in looks a device up by; absent on the devices h.session and h.user seed, which no lookup finds. */
  deviceHash?: string;
}

/** A passkey of a user, as the registration writes it and the lockdown and the management flows read it. */
export type RecordedPasskey = PasskeyRow;

/**
 * The auth flows without a database: users, email codes, sessions, devices and passkeys live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge, deletion, not-me,
 * lockdown and TOTP confirmation flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
 * mailer are the in-memory ones; the clock moves only when a test says so, so expiries and timestamps
 * compare exactly; and events are kept as the server would write them to auth_events. The integration
 * harness (test/integration/flow-harness.ts) runs flows against the real repository instead.
 */
export function memoryFlowHarness(start = 1_789_000_000_000) {
  let t = start;
  const now = () => new Date(t);
  const users = new Map<string, UserRow>();
  const codes: EmailCodeRow[] = [];
  const events: RecordedEvent[] = [];
  const sessions: RecordedSession[] = [];
  const devices: RecordedDevice[] = [];
  const passkeys: RecordedPasskey[] = [];
  /**
   * When each event was recorded, at the harness clock, kept beside the events rather than on them: the tests compare
   * the events with the exact objects the flows write, and the daily passkey bound is the only reader of the times.
   */
  const eventTimes = new WeakMap<RecordedEvent, number>();
  const recordEvent = (event: RecordedEvent) => {
    events.push(event);
    eventTimes.set(event, t);
  };
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
  /** Repository methods told to fail: "takeDown" and "lockDown" each fail as a transaction that breaks off midway, after staging its writes and before any lands. */
  const faults = new Set<"takeDown" | "lockDown">();
  /** A device as the real row reads, from what the harness keeps of it; the hash and the times are placeholders no flow reads here. */
  const deviceRow = (device: RecordedDevice): DeviceRow => ({
    id: device.id,
    userId: device.userId,
    deviceHash: device.deviceHash ?? `hash-${device.id}`,
    label: device.label,
    platform: device.platform,
    firstSeenAt: now(),
    lastSeenAt: now(),
    ipHash: null,
    revokedAt: device.revokedAt,
  });
  /** A passkey with the label of the device that added it, as the real join answers it: null once that device is gone. */
  const withDevice = (passkey: RecordedPasskey): PasskeyListRow => ({ ...passkey, createdOn: devices.find((d) => d.id === passkey.createdDeviceId)?.label ?? null });
  /**
   * The daily bound's reading, as the real statement makes it: the times of the account's latest passkey_added events within
   * the window, at most `limit` of them, and the seconds until the oldest of those leaves the window.
   */
  const recentPasskeyAdditions = (userId: string, withinMs: number, limit: number) => {
    const recent = events
      .filter((e) => e.userId === userId && e.type === "passkey_added")
      .map((e) => eventTimes.get(e)!)
      .filter((at) => at > t - withinMs)
      .sort((a, b) => b - a)
      .slice(0, limit);
    const oldest = recent.at(-1);
    return { count: recent.length, retryAfterSeconds: oldest === undefined ? 0 : Math.ceil((oldest + withinMs - t) / 1000) };
  };
  /**
   * Step 1's rows for a user, as the real repository's takeDownRows writes them: live sessions revoked (their ids
   * returned), devices, codes and passkeys gone, and the WebAuthn user handle cleared (1c design, section 7.7).
   */
  const takeDownRows = (userId: string, at: Date): string[] => {
    const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
    for (const s of live) s.revokedAt = at;
    for (let i = devices.length - 1; i >= 0; i--) if (devices[i]!.userId === userId) devices.splice(i, 1);
    for (let i = codes.length - 1; i >= 0; i--) if (codes[i]!.userId === userId) codes.splice(i, 1);
    for (let i = passkeys.length - 1; i >= 0; i--) if (passkeys[i]!.userId === userId) passkeys.splice(i, 1);
    const row = users.get(userId);
    if (row) row.webauthnUserId = null;
    return live.map((s) => s.id);
  };
  const repo = {
    async findUserById(id: string): Promise<UserRow | undefined> {
      const row = users.get(id);
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      // As the real lookup: the address in any case, and never a deleted row.
      const row = [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      const row = users.get(userId);
      if (row) {
        row.failedLogins = failedLogins;
        row.lockedUntil = lockedUntil;
      }
    },
    async createEmailCode(input: Parameters<AuthRepo["createEmailCode"]>[0]): Promise<void> {
      codes.push({ id: randomUUID(), ...input, attempts: 0, consumedAt: null, createdAt: now() });
    },
    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const row = codes.find((c) => c.flowId === flowId);
      return row ? { ...row } : undefined;
    },
    async addCodeAttempt(id: string): Promise<number> {
      const row = codes.find((c) => c.id === id);
      if (!row) return Number.MAX_SAFE_INTEGER;
      row.attempts += 1;
      return row.attempts;
    },
    async consumeEmailCode(id: string, at: Date): Promise<boolean> {
      const row = codes.find((c) => c.id === id);
      if (!row || row.consumedAt !== null) return false;
      row.consumedAt = at;
      return true;
    },
    async changeEmail(userId: string, email: string, at: Date): Promise<void> {
      // As the real unique index on lower(email), deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      for (const other of users.values()) {
        if (other.id !== userId && other.email.toLowerCase() === email.toLowerCase()) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "users_email_lower_idx"'), { code: "23505" });
        }
      }
      const row = users.get(userId);
      if (!row) return;
      row.email = email;
      row.emailVerifiedAt = at;
    },
    async setPasswordHash(userId: string, passwordHash: string | null, at: Date): Promise<void> {
      // As the real statement: setting or clearing a password also clears any lockout, and records when.
      const row = users.get(userId);
      if (row) Object.assign(row, { passwordHash, passwordChangedAt: at, failedLogins: 0, lockedUntil: null });
    },
    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      // As the real statement: unconditional, whatever the row held, and the last accepted step starts over.
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash });
    },
    async disableTotp(userId: string): Promise<void> {
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    },
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("lockDown")) throw new Error("the lockdown transaction failed midway and was rolled back");
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = input.now;
      for (const device of devices) if (device.userId === userId && device.revokedAt === null) device.revokedAt = input.now;
      // As the real statement: the user's passkeys created at or after `since`, plus any of theirs the caller names.
      const passkeysRemoved: string[] = [];
      for (let i = passkeys.length - 1; i >= 0; i--) {
        const passkey = passkeys[i]!;
        if (passkey.userId !== userId) continue;
        if (passkey.createdAt.getTime() >= input.since.getTime() || input.passkeyIds.includes(passkey.id)) {
          passkeysRemoved.push(passkey.id);
          passkeys.splice(i, 1);
        }
      }
      const row = users.get(userId);
      // As the real read of the locked row: an account that is gone has no two-factor to clear.
      const totpCleared = row !== undefined && row.deletedAt === null && row.totpEnabledAt !== null && row.totpEnabledAt.getTime() >= input.since.getTime();
      if (row) {
        // The password as setPasswordHash clears it, and two-factor as disableTotp turns it off.
        Object.assign(row, { passwordHash: null, passwordChangedAt: input.now, failedLogins: 0, lockedUntil: null });
        if (totpCleared) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
      }
      recordEvent({ userId, type: input.event.type, deviceId: input.event.deviceId, metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true } });
      return { sessionIds: live.map((s) => s.id), passkeysRemoved, totpCleared };
    },
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      // As the real partial unique index on phone_hash, deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      if (phoneHash !== null) {
        for (const other of users.values()) {
          if (other.id !== userId && other.phoneHash === phoneHash) {
            throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_hash_idx"'), { code: "23505" });
          }
        }
      }
      const row = users.get(userId);
      if (row) row.phoneHash = phoneHash;
    },
    async appendEvent(input: Parameters<AuthRepo["appendEvent"]>[0]): Promise<void> {
      recordEvent({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.id === id);
      return device ? deviceRow(device) : undefined;
    },
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      // As the real compare-and-set: the first candidate sticks, every later call reads it back.
      const row = users.get(userId);
      if (!row || row.deletedAt !== null) return undefined;
      row.webauthnUserId ??= candidate;
      return row.webauthnUserId;
    },
    async countPasskeys(userId: string): Promise<number> {
      return passkeys.filter((p) => p.userId === userId).length;
    },
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      // Newest first, as the real statement orders them.
      return passkeys
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(withDevice);
    },
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      return passkey ? withDevice(passkey) : undefined;
    },
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(userId, withinMs, limit);
    },
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      // As the real transaction: the account locked, both bounds checked again, then the row and its event, or nothing.
      const row = users.get(input.userId);
      if (!row || row.deletedAt !== null) return { ok: false, reason: "gone" };
      if (passkeys.filter((p) => p.userId === input.userId).length >= limits.passkeys) return { ok: false, reason: "cap" };
      const additions = recentPasskeyAdditions(input.userId, limits.windowMs, limits.additions);
      if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
      // As the real unique index on credential_id: the driver error that the flow recognises through isUniqueViolation.
      if (passkeys.some((p) => p.credentialId === input.credentialId)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "passkeys_credential_idx"'), { code: "23505" });
      }
      const passkey: RecordedPasskey = { id: randomUUID(), lastUsedAt: null, suspectAt: null, ...input };
      passkeys.push(passkey);
      recordEvent({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey.id } });
      return { ok: true, passkey: { ...passkey } };
    },
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      if (!passkey) return false;
      passkey.name = name;
      return true;
    },
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const index = passkeys.findIndex((p) => p.id === id && p.userId === userId);
      if (index === -1) return undefined;
      const [removed] = passkeys.splice(index, 1);
      return { name: removed!.name };
    },
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      // As the real lookup: any account's, and the flow refuses a deleted owner through findUserById.
      const passkey = passkeys.find((p) => p.credentialId === credentialId);
      return passkey ? { ...passkey } : undefined;
    },
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const passkey = passkeys.find((p) => p.credentialId === credentialId && p.userId === userId);
      return passkey ? { ...passkey } : undefined;
    },
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, at: Date): Promise<boolean> {
      // As the real conditional update: a suspect passkey never matches, and the counter must move forward unless both are zero.
      const passkey = passkeys.find((p) => p.id === id);
      if (!passkey || passkey.suspectAt !== null) return false;
      if (!((newCounter === 0 && passkey.counter === 0) || newCounter > passkey.counter)) return false;
      passkey.counter = newCounter;
      passkey.lastUsedAt = at;
      passkey.backedUp = backedUp;
      return true;
    },
    async suspectPasskey(id: string, at: Date): Promise<void> {
      const passkey = passkeys.find((p) => p.id === id);
      if (passkey && passkey.suspectAt === null) passkey.suspectAt = at;
    },
    async findDevice(userId: string, deviceHashValue: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.userId === userId && d.deviceHash === deviceHashValue && d.revokedAt === null);
      return device ? deviceRow(device) : undefined;
    },
    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const device: RecordedDevice = { id: randomUUID(), userId: input.userId, revokedAt: null, platform: input.platform as Platform, label: input.label, deviceHash: input.deviceHash };
      devices.push(device);
      return deviceRow(device);
    },
    async touchDevice(): Promise<void> {
      // The row's last-seen and ip are placeholders no flow reads here, so touching it changes nothing observable.
    },
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      // As the real insert: the reauth time is the latest of the factors, and a fresh handle stands in for the column's default.
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      sessions.push({
        id: input.id,
        userId: input.userId,
        revokedAt: null,
        deviceId: input.deviceId,
        handle: randomUUID(),
        factors,
        passkeyId: input.passkeyId ?? null,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        createdAt: input.now,
        lastUsedAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },
    async findActiveSession(id: string, at: Date): Promise<ActiveSessionRow | undefined> {
      // As the real joins: the session, its account and its device must all be live.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at);
      if (!row) return undefined;
      const user = users.get(row.userId);
      if (!user || user.deletedAt !== null) return undefined;
      const device = devices.find((d) => d.id === row.deviceId && d.revokedAt === null);
      if (!device) return undefined;
      return {
        id: row.id,
        userId: row.userId,
        deviceId: row.deviceId,
        role: user.role,
        onboardedAt: user.onboardedAt,
        totpEnabledAt: user.totpEnabledAt,
        reauthAt: row.reauthAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        handle: row.handle,
        factors: row.factors,
        passkeyId: row.passkeyId,
      };
    },
    async rotateSession(id: string, newId: string): Promise<boolean> {
      // As the real statement: the primary key changes in place for a live row, and everything else stays.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null);
      if (!row) return false;
      row.id = newId;
      return true;
    },
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      // As the real statement: the kind's time is set or replaced and the reauth time follows it.
      const row = sessions.find((s) => s.id === id);
      if (!row) return;
      row.factors = { ...row.factors, [kind]: at.getTime() };
      row.reauthAt = at;
    },
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      // As the real conditional update: a step no later than the last accepted one is refused, so a code cannot be reused.
      const row = users.get(userId);
      if (!row || (row.totpLastStep !== null && row.totpLastStep >= step)) return false;
      row.totpLastStep = step;
      return true;
    },
    async revokeAllSessions(userId: string, at: Date): Promise<string[]> {
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = at;
      return live.map((s) => s.id);
    },
    async listActiveSessions(userId: string, at: Date): Promise<SessionListRow[]> {
      // As the real statement: the user's sessions that are neither revoked nor expired, most recently used first, each with its device's label.
      return sessions
        .filter((s) => s.userId === userId && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at)
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
        .map((s) => {
          const device = devices.find((d) => d.id === s.deviceId);
          return { id: s.id, handle: s.handle, deviceLabel: device?.label ?? null, platform: device?.platform ?? "web", createdAt: s.createdAt, lastUsedAt: s.lastUsedAt };
        });
    },
    async markDeleted(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
    },
    async takeDown(userId: string, at: Date, deviceId: string | null): Promise<string[]> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("takeDown")) throw new Error("the take-down transaction failed midway and was rolled back");
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
      const revoked = takeDownRows(userId, at);
      recordEvent({ userId, type: "account_deleted", deviceId, metadata: {} });
      return revoked;
    },
    async finishTakeDown(userId: string, at: Date): Promise<string[]> {
      // As the real statement: only a row marked deleted and not purged yet.
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return [];
      return takeDownRows(userId, at);
    },
    async finishPurge(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return;
      Object.assign(row, {
        email: `deleted:${userId}`,
        emailVerifiedAt: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        phoneHash: null,
        ageConfirmedAt: null,
        termsVersion: null,
        termsAcceptedAt: null,
        purgedAt: at,
      });
    },
  } satisfies Pick<
    AuthRepo,
    | "findUserById"
    | "findUserByEmail"
    | "setPasswordFailures"
    | "createEmailCode"
    | "findEmailCode"
    | "addCodeAttempt"
    | "consumeEmailCode"
    | "changeEmail"
    | "setPasswordHash"
    | "enableTotp"
    | "disableTotp"
    | "lockDown"
    | "setPhoneHash"
    | "appendEvent"
    | "findDeviceById"
    | "ensureWebauthnUserId"
    | "countPasskeys"
    | "listPasskeys"
    | "findPasskey"
    | "recentPasskeyAdditions"
    | "addPasskey"
    | "renamePasskey"
    | "deletePasskey"
    | "findPasskeyByCredentialId"
    | "findPasskeyByCredential"
    | "claimPasskeyUse"
    | "suspectPasskey"
    | "findDevice"
    | "createDevice"
    | "touchDevice"
    | "createSession"
    | "findActiveSession"
    | "rotateSession"
    | "writeFactor"
    | "claimTotpStep"
    | "revokeAllSessions"
    | "listActiveSessions"
    | "markDeleted"
    | "takeDown"
    | "finishTakeDown"
    | "finishPurge"
  >;
  const authRepo = repo as unknown as AuthRepo;
  const kv = new MemoryKv(() => t);
  const mailer = new MemoryMailer();
  /** profiles.verified_at by account, as the badge flows set and clear it through the profile store. */
  const verified = new Map<string, Date | null>();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs create no profile; the badge flows only set and clear verified_at, kept above by
    // account, and the deletion flow reads the handle, kept by account as `user` registers it.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async (id) => {
        const handle = handles.get(id);
        return handle === undefined ? null : { id, handle, displayName: handle, handleChangedAt: null, verified: (verified.get(id) ?? null) !== null };
      },
      setVerified: async (id, at) => {
        verified.set(id, at);
      },
    },
    // The development provider, which accepts exactly 000000; a test swaps it for null or a scripted one.
    verify: devProvider(),
    config,
    log: pino({ level: "silent" }),
    now,
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: undefined };
  /**
   * A live session on a device of its own, both recorded as the deletion flow will find them. It proved an email code
   * just now unless given other factors, as a session behind requireFreshAuth has, and started from no passkey unless told so.
   * The device is a web browser labelled as the sign-in labels one, unless the test says otherwise.
   */
  const session = (userId: string, options: { factors?: Factors; passkeyId?: string | null; platform?: Platform; label?: string | null } = {}): Session => {
    const s: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: now(),
      handle: randomUUID(),
      factors: options.factors ?? { email: t },
      passkeyId: options.passkeyId ?? null,
    };
    sessions.push({
      id: s.sessionId,
      userId,
      revokedAt: null,
      deviceId: s.deviceId,
      handle: s.handle,
      factors: s.factors,
      passkeyId: s.passkeyId,
      reauthAt: s.reauthAt,
      createdAt: now(),
      lastUsedAt: now(),
      expiresAt: new Date(t + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t + SESSION_ABSOLUTE_MS),
    });
    devices.push({ id: s.deviceId, userId, revokedAt: null, platform: options.platform ?? "web", label: options.label === undefined ? "Chrome on Windows" : options.label });
    return s;
  };
  return {
    deps,
    kv,
    mailer,
    ctx,
    users,
    codes,
    events,
    sessions,
    devices,
    passkeys,
    verified,
    faults,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
    /**
     * A passkey of an existing account, created at `createdAt` (now unless given) with the row's defaults (a plain,
     * unnamed synced key added from no device) unless overridden; answers its id.
     */
    passkey(userId: string, createdAt: Date = now(), overrides: Partial<Omit<RecordedPasskey, "id" | "userId" | "createdAt">> = {}): string {
      const id = randomUUID();
      passkeys.push({
        id,
        userId,
        createdAt,
        credentialId: randomToken(),
        publicKey: "cose-key",
        counter: 0,
        transports: [],
        backedUp: false,
        name: "Passkey",
        lastUsedAt: null,
        aaguid: null,
        backupEligible: false,
        uvInitialized: false,
        createdDeviceId: null,
        suspectAt: null,
        ...overrides,
      });
      return id;
    },
    /**
     * An onboarded account holding a verified address, with a session that just proved a credential, as a route
     * behind requireFreshAuth passes it on. Its profile's handle is the address's local part unless given.
     */
    user(email: string, handle: string = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "_")): { user: UserRow; session: Session } {
      const id = randomUUID();
      const user: UserRow = {
        id,
        email,
        emailVerifiedAt: now(),
        phoneHash: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now(),
        deletedAt: null,
        role: "user",
        ageConfirmedAt: now(),
        termsVersion: TEST_TERMS,
        termsAcceptedAt: now(),
        onboardedAt: now(),
        passwordChangedAt: null,
        totpLastStep: null,
        purgedAt: null,
        webauthnUserId: null,
      };
      users.set(id, user);
      handles.set(id, handle);
      return { user, session: session(id) };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
```

### Replace `apps/api/test/auth/lockdown.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { LOCKDOWN_LOOKBACK_MS, lockdown } from "../../src/auth/flows/lockdown";
import { HOUR, MINUTE } from "../../src/auth/limits";
import type { AuthRepo } from "../../src/auth/repo";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;

/** An account with two-factor on since `enabledAt`, as the confirm step leaves it, with the harness's own values. */
function withTotp(h: MemoryFlowHarness, userId: string, enabledAt: Date) {
  Object.assign(h.users.get(userId)!, { totpSecretEnc: "v1:owner", totpEnabledAt: enabledAt, totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
}

describe("the lockdown (1c design, sections 2 and 7.6)", () => {
  test("revokes every session and device with tombstones, clears the password, and records the caller's event with what it did", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    h.advance(HOUR);
    const report = await lockdown(h.deps, { userId: ada.user.id, anchor: h.now(), caller: { type: "not_me", deviceId: ada.session.deviceId }, ctx: h.ctx });
    expect(report).toEqual({ passkeysRemoved: [], totpCleared: false, passwordCleared: true });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, passwordChangedAt: h.now() });
    // Another account is not touched.
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.devices.filter((d) => d.userId === bob.user.id).map((d) => d.revokedAt)).toEqual([null]);
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: [], totpCleared: false, passwordCleared: true } },
    ]);
  });

  test("removes the passkeys created at or after the day before the anchor, and any it is told to name, and leaves the rest and other accounts' alone", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const since = new Date(h.now().getTime() + 6 * HOUR);
    const anchor = new Date(since.getTime() + LOCKDOWN_LOOKBACK_MS);
    const kept = [h.passkey(ada.user.id, new Date(since.getTime() - 1)), h.passkey(bob.user.id, since), h.passkey(bob.user.id, new Date(anchor.getTime() + HOUR))];
    // Old enough to stay, but named by the caller (the passkey that started the session in question).
    const named = h.passkey(ada.user.id, new Date(since.getTime() - 3 * DAY));
    const removed = [h.passkey(ada.user.id, since), h.passkey(ada.user.id, new Date(anchor.getTime() + HOUR)), named];
    h.advance(3 * DAY);
    const report = await lockdown(h.deps, { userId: ada.user.id, anchor, passkeyIds: [named], caller: { type: "not_me" }, ctx: h.ctx });
    expect([...report.passkeysRemoved].sort()).toEqual([...removed].sort());
    expect(h.passkeys.map((p) => p.id).sort()).toEqual([...kept].sort());
    expect(h.events.at(-1)!.metadata.passkeysRemoved).toEqual(report.passkeysRemoved);
    // A named passkey of another account is not the caller's to remove.
    const stray = h.passkey(bob.user.id, new Date(since.getTime() - 3 * DAY));
    const again = await lockdown(h.deps, { userId: ada.user.id, anchor, passkeyIds: [stray], caller: { type: "not_me" }, ctx: h.ctx });
    expect(again.passkeysRemoved).toEqual([]);
    expect(h.passkeys.map((p) => p.id)).toContain(stray);
  });

  test("turns two-factor off when it was enabled at or after the day before the anchor, and keeps it when it was enabled earlier", async () => {
    const h = memoryFlowHarness();
    const since = h.now();
    const anchor = new Date(since.getTime() + LOCKDOWN_LOOKBACK_MS);
    const earlier = h.user("earlier@korbat.local");
    withTotp(h, earlier.user.id, new Date(since.getTime() - 1));
    const atSince = h.user("at-since@korbat.local");
    withTotp(h, atSince.user.id, since);
    const later = h.user("later@korbat.local");
    withTotp(h, later.user.id, new Date(anchor.getTime() + MINUTE));
    const never = h.user("never@korbat.local");
    h.advance(2 * DAY);
    const run = (userId: string) => lockdown(h.deps, { userId, anchor, caller: { type: "not_me" }, ctx: h.ctx });
    expect((await run(earlier.user.id)).totpCleared).toBe(false);
    expect(h.users.get(earlier.user.id)).toMatchObject({ totpSecretEnc: "v1:owner", totpEnabledAt: new Date(since.getTime() - 1), totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
    expect((await run(atSince.user.id)).totpCleared).toBe(true);
    expect(h.users.get(atSince.user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    expect((await run(later.user.id)).totpCleared).toBe(true);
    expect(h.users.get(later.user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null });
    expect((await run(never.user.id)).totpCleared).toBe(false);
    expect(h.events.map((e) => [e.userId, e.metadata.totpCleared])).toEqual([
      [earlier.user.id, false],
      [atSince.user.id, true],
      [later.user.id, true],
      [never.user.id, false],
    ]);
  });

  test("the caller's own metadata is kept beside the lockdown's, with the request's address hash and no device unless the caller names one", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const named = h.passkey(ada.user.id, new Date(h.now().getTime() - 30 * DAY));
    // What the flow hands the repository for its one transaction: the clock, the reach, the named passkeys and the caller's event.
    const handed: Parameters<AuthRepo["lockDown"]>[] = [];
    const lockDown = h.deps.repo.lockDown;
    h.deps.repo.lockDown = async (...args) => {
      handed.push(args);
      return lockDown(...args);
    };
    h.advance(HOUR);
    const anchor = new Date(h.now().getTime() - MINUTE);
    await lockdown(h.deps, { userId: ada.user.id, anchor, passkeyIds: [named], caller: { type: "email_changed", metadata: { from: "a", to: "b", reverted: true } }, ctx: h.ctx });
    expect(handed).toEqual([
      [
        ada.user.id,
        {
          now: h.now(),
          since: new Date(anchor.getTime() - LOCKDOWN_LOOKBACK_MS),
          passkeyIds: [named],
          event: { type: "email_changed", deviceId: null, ipHash: h.ctx.ipHash, metadata: { from: "a", to: "b", reverted: true } },
        },
      ],
    ]);
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "email_changed", deviceId: null, metadata: { from: "a", to: "b", reverted: true, passkeysRemoved: [named], totpCleared: false, passwordCleared: true } },
    ]);
  });

  test("a lockdown whose transaction fails lands nothing: the sessions and devices stay live with no tombstone, the password, the passkeys and two-factor stay, and no event is recorded", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    withTotp(h, ada.user.id, h.now());
    const passkey = h.passkey(ada.user.id);
    h.advance(HOUR);
    h.faults.add("lockDown");
    await expect(lockdown(h.deps, { userId: ada.user.id, anchor: h.now(), passkeyIds: [passkey], caller: { type: "not_me", deviceId: ada.session.deviceId }, ctx: h.ctx })).rejects.toThrow(/midway/);

    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null, null]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBeNull();
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([null, null]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: "owner-password", totpSecretEnc: "v1:owner", totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
    expect(h.passkeys.map((p) => p.id)).toEqual([passkey]);
    expect(h.events).toEqual([]);

    // The account is as it was, so the next lockdown, from another link or from "not mine", finds everything still to do.
    h.faults.clear();
    const report = await lockdown(h.deps, { userId: ada.user.id, anchor: h.now(), passkeyIds: [passkey], caller: { type: "not_me", deviceId: ada.session.deviceId }, ctx: h.ctx });
    expect(report).toEqual({ passkeysRemoved: [passkey], totpCleared: true, passwordCleared: true });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.events).toHaveLength(1);
  });

  test("a cache failure after the lockdown landed does not fail it: the rows are revoked and the event recorded, and only the tombstones are missing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    const set = h.kv.set.bind(h.kv);
    h.kv.set = async () => {
      throw new Error("the cache is unreachable");
    };
    const report = await lockdown(h.deps, { userId: ada.user.id, anchor: h.now(), caller: { type: "not_me" }, ctx: h.ctx });
    h.kv.set = set;
    expect(report).toEqual({ passkeysRemoved: [], totpCleared: false, passwordCleared: true });
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null });
    expect(h.events.map((e) => e.type)).toEqual(["not_me"]);
    // A cached copy of the session can live out its minute; the revoked row is what every other lookup reads.
    expect(await h.kv.get(`sess:2:${ada.session.sessionId}`)).toBeNull();
  });

  test("run again, it changes nothing more: the first revocation times stay, and the second event says nothing was left to remove", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    withTotp(h, ada.user.id, h.now());
    h.passkey(ada.user.id);
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    h.advance(HOUR);
    const anchor = h.now();
    const first = await lockdown(h.deps, { userId: ada.user.id, anchor, caller: { type: "not_me" }, ctx: h.ctx });
    expect(first).toMatchObject({ totpCleared: true, passwordCleared: true });
    expect(first.passkeysRemoved).toHaveLength(1);
    const firstRun = h.now();
    h.advance(MINUTE);
    const second = await lockdown(h.deps, { userId: ada.user.id, anchor, caller: { type: "not_me" }, ctx: h.ctx });
    expect(second).toEqual({ passkeysRemoved: [], totpCleared: false, passwordCleared: true });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([firstRun]);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([firstRun]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null });
    expect(h.passkeys).toEqual([]);
    expect(h.events.map((e) => e.metadata)).toEqual([
      { passkeysRemoved: first.passkeysRemoved, totpCleared: true, passwordCleared: true },
      { passkeysRemoved: [], totpCleared: false, passwordCleared: true },
    ]);
  });
});
```

### Replace `apps/api/test/auth/not-me.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { notMe } from "../../src/auth/flows/not-me";
import { NOT_ME_TTL_MS, notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR } from "../../src/auth/limits";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
const LINK_GONE = "This link has expired or was already used.";

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/** A link as the new-device alert stores it (or as an older alert did, when given less), answering its token. */
async function link(h: MemoryFlowHarness, stored: NotMeToken | string): Promise<string> {
  const token = randomToken();
  await h.kv.set(notMeKey(token), typeof stored === "string" ? stored : JSON.stringify(stored), NOT_ME_TTL_MS);
  return token;
}

/** An account with two-factor on since `enabledAt`, as the confirm step leaves it. */
function withTotp(h: MemoryFlowHarness, userId: string, enabledAt: Date) {
  Object.assign(h.users.get(userId)!, { totpSecretEnc: "v1:owner", totpEnabledAt: enabledAt, totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
}

describe("'This wasn't me' on the lockdown (1c design, section 7.6)", () => {
  test("the link locks the account down anchored at the sign-in it announced: everything set up since the day before goes, and the passkey it names whatever its age", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const owners = h.session(ada.user.id);
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    // The alerted sign-in was two hours ago; the rows around its anchor are placed in the past, so the link is still within its day.
    const signedInAt = h.now().getTime() - 2 * HOUR;
    const since = signedInAt - LOCKDOWN_LOOKBACK_MS;
    const old = h.passkey(ada.user.id, new Date(since - 1));
    const named = h.passkey(ada.user.id, new Date(since - DAY));
    const recent = h.passkey(ada.user.id, new Date(since));
    withTotp(h, ada.user.id, new Date(signedInAt - HOUR));
    const key = h.deps.config.authHmacKey;
    const token = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId, signedInAt, passkeyId: named, sentTo: emailHash(key, "Ada@korbat.local") });
    await notMe(h.deps, { token }, h.ctx);

    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, owners.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] });
    expect(h.passkeys.map((p) => p.id)).toEqual([old]);
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: expect.arrayContaining([named, recent]), totpCleared: true, passwordCleared: true } },
    ]);
    expect(h.events[0]!.metadata.passkeysRemoved).toHaveLength(2);
    // The link worked once.
    expect(await failure(notMe(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events).toHaveLength(1);
  });

  test("a link from before the deploy, without a sign-in time or as the bare user id, is anchored a day before it is used and checks no address", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    // Anchored at the moment of use minus the link's 24-hour life, the lockdown reaches two days back: more than a link with its sign-in time would, never less.
    const since = h.now().getTime() - NOT_ME_TTL_MS - LOCKDOWN_LOOKBACK_MS;
    const older = h.passkey(ada.user.id, new Date(since - 1));
    const inReach = h.passkey(ada.user.id, new Date(since));
    withTotp(h, ada.user.id, new Date(since));
    const bobsOlder = h.passkey(bob.user.id, new Date(since - 1));
    withTotp(h, bob.user.id, new Date(since + HOUR));
    const legacy = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId });
    const bare = await link(h, bob.user.id);
    // Both addresses changed since the alerts went out; a link without an address to check works regardless.
    await h.deps.repo.changeEmail(ada.user.id, "ada-moved@korbat.local", h.now());
    await h.deps.repo.changeEmail(bob.user.id, "bob-moved@korbat.local", h.now());

    await notMe(h.deps, { token: legacy }, h.ctx);
    expect(h.passkeys.filter((p) => p.userId === ada.user.id).map((p) => p.id)).toEqual([older]);
    expect(h.users.get(ada.user.id)).toMatchObject({ totpEnabledAt: null, passwordHash: null });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);

    await notMe(h.deps, { token: bare }, h.ctx);
    expect(h.passkeys.filter((p) => p.userId === bob.user.id).map((p) => p.id)).toEqual([bobsOlder]);
    expect(h.users.get(bob.user.id)).toMatchObject({ totpEnabledAt: null });
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: [inReach], totpCleared: true, passwordCleared: true } },
      { userId: bob.user.id, type: "not_me", deviceId: null, metadata: { passkeysRemoved: [], totpCleared: true, passwordCleared: true } },
    ]);
  });

  test("while the account's address differs from the one the alert went to, the link does nothing but refuse and is not spent; once the address is back it works, once; a change of case alone is no change", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    const added = h.passkey(ada.user.id);
    const key = h.deps.config.authHmacKey;
    const signedInAt = h.now().getTime();
    const stale = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId, signedInAt, passkeyId: null, sentTo: emailHash(key, "ada@korbat.local") });
    const stored = await h.kv.get(notMeKey(stale));
    await h.deps.repo.changeEmail(ada.user.id, "attacker@korbat.local", h.now());
    h.advance(HOUR);
    for (let i = 0; i < 2; i++) expect(await failure(notMe(h.deps, { token: stale }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([null]);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "attacker@korbat.local", passwordHash: "owner-password" });
    expect(h.passkeys).toHaveLength(1);
    expect(h.events).toEqual([]);
    // Refused, not spent: the link is in the store as it was, for the rest of its day.
    expect(await h.kv.get(notMeKey(stale))).toBe(stored);
    // The address is the owner's again, as the email undo leaves it: the same link now runs the lockdown, anchored at its sign-in.
    await h.deps.repo.changeEmail(ada.user.id, "ada@korbat.local", h.now());
    h.advance(HOUR);
    await notMe(h.deps, { token: stale }, h.ctx);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", passwordHash: null });
    expect(h.passkeys).toEqual([]);
    expect(h.events).toEqual([{ userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: [added], totpCleared: false, passwordCleared: true } }]);
    // Once: it is spent now.
    expect(await h.kv.get(notMeKey(stale))).toBeNull();
    expect(await failure(notMe(h.deps, { token: stale }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events).toHaveLength(1);

    const bob = h.user("bob@korbat.local");
    const fine = await link(h, { userId: bob.user.id, deviceId: bob.session.deviceId, signedInAt: h.now().getTime(), passkeyId: null, sentTo: emailHash(key, "bob@korbat.local") });
    await h.deps.repo.changeEmail(bob.user.id, "Bob@korbat.local", h.now());
    await notMe(h.deps, { token: fine }, h.ctx);
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
  });

  test("two uses of one link at once act once: one runs the lockdown, the other is refused", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const key = h.deps.config.authHmacKey;
    const token = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId, signedInAt: h.now().getTime(), passkeyId: null, sentTo: emailHash(key, "ada@korbat.local") });
    const outcomes = await Promise.allSettled([notMe(h.deps, { token }, h.ctx), notMe(h.deps, { token }, { ...h.ctx, ipHash: randomToken() })]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected")!.reason).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events).toEqual([{ userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: [], totpCleared: false, passwordCleared: true } }]);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([h.now()]);
  });

  test("a link of an account that is gone, an unknown link and a used one are refused alike, and change nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const key = h.deps.config.authHmacKey;
    const token = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId, signedInAt: h.now().getTime(), passkeyId: null, sentTo: emailHash(key, "ada@korbat.local") });
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    expect(await failure(notMe(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await failure(notMe(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null]);
    expect(h.events).toEqual([]);
  });

  test("allows 10 tries an hour per address, then rate_limited with a Retry-After", async () => {
    const h = memoryFlowHarness();
    for (let i = 0; i < 10; i++) expect(await failure(notMe(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "invalid_code" });
    expect(await failure(notMe(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(await failure(notMe(h.deps, { token: randomToken() }, { ...h.ctx, ipHash: randomToken() }))).toMatchObject({ code: "invalid_code" });
  });
});
```

### Replace `apps/api/test/auth/passkey-management.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { me } from "../../src/auth/flows/account";
import { revertEmailChange, startEmailChange, verifyEmailChange } from "../../src/auth/flows/email-change";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import {
  NEW_PASSKEY_MS,
  NOT_MINE_PER_DAY,
  PASSKEY_ADDITIONS_PER_DAY,
  PASSKEY_CAP,
  PASSKEY_REMOVE_TTL_MS,
  listPasskeys,
  notMine,
  passkeyRemoveKey,
  registerOptions,
  registerVerify,
  removeByLink,
  removePasskey,
  renamePasskey,
  type PasskeyRemoveToken,
} from "../../src/auth/passkeys/flows";
import type { Session } from "../../src/auth/sessions";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";
import { SoftAuthenticator, ZERO_AAGUID, type CborValue, type SoftCreateInput, type SoftFlags } from "./soft-authenticator";

const DAY = 24 * HOUR;
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const LINK_GONE = "This link has expired or was already used.";
const CAP_MESSAGE = "You have 10 passkeys. Remove one to add another.";

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/** A time as the passkey mails print it: the date and the minute in UTC. */
const mailTime = (at: Date) => `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;

/** An account with two-factor on since `enabledAt`, as the confirm step leaves it. */
function withTotp(h: MemoryFlowHarness, userId: string, enabledAt: Date) {
  Object.assign(h.users.get(userId)!, { totpSecretEnc: "v1:owner", totpEnabledAt: enabledAt, totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
}

/** A session of an account with TOTP, holding the given factors, as the middleware would carry it. */
const mfaSession = (h: MemoryFlowHarness, userId: string, factors: Session["factors"]): Session => ({ ...h.session(userId, { factors }), mfaEnabled: true });

/** The options of a registration, and the browser's answer to them from the software authenticator. */
async function ceremony(h: MemoryFlowHarness, session: Session, auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> & { label?: string } = {}) {
  const { label = "ada", ...create } = overrides;
  const { options } = await registerOptions(h.deps, session, { label });
  const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags: ALL, ...create });
  return { options, response };
}

/** A whole registration: the options, the browser's answer and the verification; answers the stored passkey's view. */
async function register(h: MemoryFlowHarness, session: Session, auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> & { label?: string; name?: string } = {}) {
  const { name, ...rest } = overrides;
  const { response } = await ceremony(h, session, auth, rest);
  return (await registerVerify(h.deps, session, { name, response })).passkey;
}

describe("passkey registration (1c design, section 7.3)", () => {
  test("options carry the RP, the label as the user's name, a user handle set once, the account's passkeys excluded and a challenge; verify stores the passkey with its flags, records the event and answers the view", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const { options, response } = await ceremony(h, ada.session, auth, { label: "ada on the laptop", aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd", counter: 3 });
    expect(options.rp).toEqual({ id: "localhost", name: "korbat" });
    expect(options.user.name).toBe("ada on the laptop");
    expect(options.user.displayName).toBe("ada on the laptop");
    expect(options.excludeCredentials).toEqual([]);
    expect(options.attestation).toBe("none");
    // The user handle: 32 random bytes, never the account id, written once and read back from then on.
    const handle = Buffer.from(options.user.id, "base64url");
    expect(handle).toHaveLength(32);
    expect(handle.toString("utf8")).not.toContain(ada.user.id);
    expect(h.users.get(ada.user.id)!.webauthnUserId).toEqual(handle);
    const again = await registerOptions(h.deps, ada.session, { label: "ada" });
    expect(again.options.user.id).toBe(options.user.id);
    expect(again.options.challenge).not.toBe(options.challenge);

    // The browser's prompt takes a minute, so a factor written at the verification would carry a later time than the sign-in's.
    h.advance(MINUTE);
    const { passkey } = await registerVerify(h.deps, ada.session, { name: "Laptop", response });
    expect(passkey).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Laptop",
      createdAt: h.now().toISOString(),
      lastUsedAt: null,
      synced: true,
      createdOn: "Chrome on Windows",
      current: false,
      isNew: true,
      suspended: false,
    });
    expect(h.passkeys).toEqual([
      {
        id: passkey.id,
        userId: ada.user.id,
        credentialId: response.id,
        publicKey: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
        counter: 3,
        transports: ["internal", "hybrid"],
        backedUp: true,
        name: "Laptop",
        createdAt: h.now(),
        lastUsedAt: null,
        aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
        backupEligible: true,
        uvInitialized: true,
        createdDeviceId: ada.session.deviceId,
        suspectAt: null,
      },
    ]);
    expect(h.events).toEqual([{ userId: ada.user.id, type: "passkey_added", deviceId: ada.session.deviceId, metadata: { passkeyId: passkey.id } }]);
    // The session's factors are not touched: adding a passkey proves nothing about the session. Its row holds what the
    // sign-in proved, at the sign-in's time, and the freshness window was not moved on.
    const row = h.sessions.find((s) => s.handle === ada.session.handle)!;
    expect(ada.session.factors).toEqual({ email: h.now().getTime() - MINUTE });
    expect(row.factors).toEqual(ada.session.factors);
    expect(row.reauthAt).toEqual(ada.session.reauthAt);
    expect(row.reauthAt).toEqual(new Date(h.now().getTime() - MINUTE));
    // Nor was its token rotated or revoked: the row is under the same id, and no tombstone was written.
    expect([row.id, row.revokedAt]).toEqual([ada.session.sessionId, null]);
    expect(await h.kv.get(`sess:2:${ada.session.sessionId}`)).toBeNull();

    // The next options exclude the passkey, with its transports, so the same authenticator does not add another.
    const next = await registerOptions(h.deps, ada.session, { label: "ada" });
    expect(next.options.excludeCredentials).toEqual([{ id: response.id, transports: ["internal", "hybrid"], type: "public-key" }]);
  });

  test("a registration without user verification is stored as such, and the flags follow the authenticator data", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const passkey = await register(h, ada.session, new SoftAuthenticator(), { name: "Key", flags: BARE });
    expect(passkey).toMatchObject({ name: "Key", synced: false });
    expect(h.passkeys[0]).toMatchObject({ uvInitialized: false, backupEligible: false, backedUp: false, counter: 0, aaguid: ZERO_AAGUID });
  });

  test("without a name the passkey is called after the platform of the device that added it", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    expect((await register(h, ada.session, auth)).name).toBe("Passkey on the web");
    expect((await register(h, h.session(ada.user.id, { platform: "ios" }), auth)).name).toBe("Passkey on iOS");
    expect((await register(h, h.session(ada.user.id, { platform: "android" }), auth)).name).toBe("Passkey on Android");
    expect(h.passkeys.map((p) => p.name)).toEqual(["Passkey on the web", "Passkey on iOS", "Passkey on Android"]);
  });

  test("the owner is told, with a remove link that lives 7 days and names the passkey, its creation and the address it went to; a failed mail does not undo the registration", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const passkey = await register(h, ada.session, new SoftAuthenticator(), { name: "Laptop" });
    expect(h.mailer.sent).toEqual([
      {
        to: "ada@korbat.local",
        template: "passkey_added",
        data: { name: "Laptop", deviceLabel: "Chrome on Windows", time: mailTime(h.now()), removeUrl: expect.stringMatching(/^http:\/\/localhost:8081\/passkey-remove\/[A-Za-z0-9_-]{43}$/) },
      },
    ]);
    const url = h.mailer.sent[0]!.data.removeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    // Stored under the token's hash only, as every link is, for 7 days.
    expect(PASSKEY_REMOVE_TTL_MS).toBe(7 * DAY);
    const stored = JSON.parse((await h.kv.get(passkeyRemoveKey(token)))!) as PasskeyRemoveToken;
    expect(stored).toEqual({ userId: ada.user.id, passkeyId: passkey.id, createdAt: h.now().getTime(), sentTo: emailHash(h.deps.config.authHmacKey, "ada@korbat.local") });
    h.advance(PASSKEY_REMOVE_TTL_MS - 1);
    expect(await h.kv.get(passkeyRemoveKey(token))).not.toBeNull();
    h.advance(1);
    expect(await h.kv.get(passkeyRemoveKey(token))).toBeNull();

    // A week on, from a session that is fresh then.
    h.mailer.failing = true;
    const second = await register(h, h.session(ada.user.id), new SoftAuthenticator(), { name: "Phone" });
    expect(h.passkeys.map((p) => p.id)).toEqual([passkey.id, second.id]);
    expect(h.mailer.sent).toHaveLength(1);
  });

  test("a challenge bound to another session's handle is refused, and a challenge answers once", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const auth = new SoftAuthenticator();
    const { response } = await ceremony(h, ada.session, auth);
    expect(await failure(registerVerify(h.deps, other, { response }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys).toEqual([]);
    // The refused try did not spend the challenge for the session it belongs to.
    const { passkey } = await registerVerify(h.deps, ada.session, { response });
    expect(h.passkeys.map((p) => p.id)).toEqual([passkey.id]);
    // The same answer again: its challenge is spent, and the credential id is known.
    expect(await failure(registerVerify(h.deps, ada.session, { response }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // A new answer to the spent challenge is refused too, whatever it carries.
    const reused = auth.create({ rpId: "localhost", challenge: JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString()).challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    expect(await failure(registerVerify(h.deps, ada.session, { response: reused }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys).toHaveLength(1);
    expect(h.events).toHaveLength(1);
  });

  test("a packed attestation with a certificate chain is passkey_unsupported, and its challenge is spent all the same", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const attStmt = new Map<string | number, CborValue>([
      ["alg", -7],
      ["sig", randomBytes(70)],
      ["x5c", [randomBytes(300)]],
    ]);
    const { options, response } = await ceremony(h, ada.session, auth, { fmt: "packed", attStmt });
    expect(await failure(registerVerify(h.deps, ada.session, { response }))).toMatchObject({ code: "passkey_unsupported", status: 400 });
    expect(h.passkeys).toEqual([]);
    expect(h.mailer.sent).toEqual([]);
    const retry = auth.create({ rpId: "localhost", challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags: ALL });
    expect(await failure(registerVerify(h.deps, ada.session, { response: retry }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // A self attestation passes.
    expect((await register(h, ada.session, auth, { fmt: "packed" })).isNew).toBe(true);
  });

  test("a credential id already held, by anyone, is passkey_invalid", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = randomBytes(32);
    await register(h, bob.session, auth, { credentialId });
    expect(await failure(register(h, ada.session, auth, { credentialId }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys.map((p) => p.userId)).toEqual([bob.user.id]);
  });

  test("the cap: at 10 passkeys the options are refused with the reason, and so is a verification whose options came before the tenth", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    expect(PASSKEY_CAP).toBe(10);
    for (let i = 0; i < 9; i++) h.passkey(ada.user.id);
    const { response } = await ceremony(h, ada.session, auth);
    h.passkey(ada.user.id);
    const capped = await failure(registerOptions(h.deps, ada.session, { label: "ada" }));
    expect(capped).toMatchObject({ code: "passkey_limit", status: 409, message: CAP_MESSAGE });
    expect(capped.details).toEqual({ reason: "cap" });
    // The transaction checks again: the tenth slot went to someone else between the options and the answer.
    const late = await failure(registerVerify(h.deps, ada.session, { response }));
    expect(late).toMatchObject({ code: "passkey_limit", status: 409, message: CAP_MESSAGE });
    expect(late.details).toEqual({ reason: "cap" });
    expect(h.passkeys).toHaveLength(10);
    expect(h.events).toEqual([]);
    // The answer's challenge was spent by the refused try.
    expect(await failure(registerVerify(h.deps, ada.session, { response }))).toMatchObject({ code: "passkey_invalid" });
  });

  test("the daily bound: five additions in 24 hours refuse the sixth with the seconds until the oldest of them is a day old, counted from the events so a removal frees nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    expect(PASSKEY_ADDITIONS_PER_DAY).toBe(5);
    const first = await register(h, ada.session, auth);
    // Twenty hours on, from a session that is fresh then (the morning's has gone stale).
    h.advance(20 * HOUR);
    const afternoon = h.session(ada.user.id);
    for (let i = 0; i < 3; i++) await register(h, afternoon, auth);
    // The fifth: its options are handed out under the bound, and the verification is the fifth addition of the day.
    const { response } = await ceremony(h, afternoon, auth);
    await registerVerify(h.deps, afternoon, { response });
    expect(h.passkeys).toHaveLength(5);

    const bound = await failure(registerOptions(h.deps, afternoon, { label: "ada" }));
    expect(bound).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 4 hours." });
    expect(bound.details).toEqual({ reason: "daily", retryAfter: (4 * HOUR) / 1000 });
    // Removing one of today's passkeys frees no slot: the bound counts the additions, not the passkeys.
    await removePasskey(h.deps, afternoon, first.id);
    expect((await failure(registerOptions(h.deps, afternoon, { label: "ada" }))).details).toEqual({ reason: "daily", retryAfter: (4 * HOUR) / 1000 });
    h.advance(3 * HOUR + 59 * MINUTE);
    const evening = h.session(ada.user.id);
    expect((await failure(registerOptions(h.deps, evening, { label: "ada" }))).details).toEqual({ reason: "daily", retryAfter: 60 });
    // Once the oldest addition is a day old, the day has a slot again.
    h.advance(MINUTE);
    expect((await registerOptions(h.deps, evening, { label: "ada" })).options.challenge).toBeDefined();
    expect(h.passkeys).toHaveLength(4);
  });

  test("the daily bound is checked again in the transaction, so options handed out under it do not add a sixth", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const { response } = await ceremony(h, ada.session, auth);
    for (let i = 0; i < 5; i++) await h.deps.repo.appendEvent({ userId: ada.user.id, type: "passkey_added", deviceId: null, metadata: {} });
    const late = await failure(registerVerify(h.deps, ada.session, { response }));
    expect(late).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 24 hours." });
    expect(late.details).toEqual({ reason: "daily", retryAfter: DAY / 1000 });
    expect(h.passkeys).toEqual([]);
  });

  test("the options need a fresh session, at level 2 on an account with TOTP; the verification needs only its bound challenge", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const stale = h.session(ada.user.id, { factors: { email: h.now().getTime() - 10 * MINUTE } });
    const refused = await failure(registerOptions(h.deps, stale, { label: "ada" }));
    expect(refused).toMatchObject({ code: "reauth_required", status: 403 });
    expect(refused.details).toEqual({ level: 1, have: [] });

    withTotp(h, ada.user.id, h.now());
    const weak = mfaSession(h, ada.user.id, { email: h.now().getTime() });
    const level2 = await failure(registerOptions(h.deps, weak, { label: "ada" }));
    expect(level2.details).toEqual({ level: 2, have: ["email"] });
    const strong = mfaSession(h, ada.user.id, { email: h.now().getTime(), totp: h.now().getTime() });
    const { response } = await ceremony(h, strong, auth);
    // The ceremony outlasts the window: the challenge, issued to a strong session and bound to it, stands in for the check.
    h.advance(9 * MINUTE);
    expect((await registerVerify(h.deps, strong, { name: "Laptop", response })).passkey.name).toBe("Laptop");
  });

  test("allows 10 options an hour per session handle, then rate_limited with a Retry-After; another session of the account has its own allowance", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < 10; i++) await registerOptions(h.deps, ada.session, { label: "ada" });
    expect(await failure(registerOptions(h.deps, ada.session, { label: "ada" }))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    // A rotation keeps the handle, so it changes nothing.
    expect(await failure(registerOptions(h.deps, { ...ada.session, sessionId: randomToken() }, { label: "ada" }))).toMatchObject({ code: "rate_limited" });
    expect((await registerOptions(h.deps, h.session(ada.user.id), { label: "ada" })).options.challenge).toBeDefined();
  });
});

describe("the passkey list (1c design, section 7.5)", () => {
  test("lists the account's passkeys newest first, with whether each started this session, is new, is suspended, is synced and where it was added", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    expect(NEW_PASSKEY_MS).toBe(7 * DAY);
    const old = h.passkey(ada.user.id, new Date(h.now().getTime() - NEW_PASSKEY_MS), { name: "Old", createdDeviceId: ada.session.deviceId, backedUp: true, lastUsedAt: new Date(h.now().getTime() - DAY) });
    const suspect = h.passkey(ada.user.id, new Date(h.now().getTime() - DAY), { name: "Suspect", suspectAt: new Date(h.now().getTime() - HOUR) });
    const current = h.passkey(ada.user.id, new Date(h.now().getTime() - NEW_PASSKEY_MS + 1), { name: "Current" });
    h.passkey(bob.user.id, h.now(), { name: "Bobs" });
    const session = h.session(ada.user.id, { passkeyId: current });
    const { passkeys } = await listPasskeys(h.deps, session);
    expect(passkeys).toEqual([
      { id: suspect, name: "Suspect", createdAt: new Date(h.now().getTime() - DAY).toISOString(), lastUsedAt: null, synced: false, createdOn: null, current: false, isNew: true, suspended: true },
      { id: current, name: "Current", createdAt: new Date(h.now().getTime() - NEW_PASSKEY_MS + 1).toISOString(), lastUsedAt: null, synced: false, createdOn: null, current: true, isNew: true, suspended: false },
      {
        id: old,
        name: "Old",
        createdAt: new Date(h.now().getTime() - NEW_PASSKEY_MS).toISOString(),
        lastUsedAt: new Date(h.now().getTime() - DAY).toISOString(),
        synced: true,
        createdOn: "Chrome on Windows",
        current: false,
        isNew: false,
        suspended: false,
      },
    ]);
    expect((await listPasskeys(h.deps, ada.session)).passkeys.map((p) => p.current)).toEqual([false, false, false]);
    expect((await listPasskeys(h.deps, h.user("carol@korbat.local").session)).passkeys).toEqual([]);
  });

  test("me counts the account's passkeys", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    expect((await me(h.deps, ada.session)).user.passkeys).toBe(0);
    h.passkey(ada.user.id);
    h.passkey(ada.user.id);
    h.passkey(bob.user.id);
    expect((await me(h.deps, ada.session)).user).toEqual({ id: ada.user.id, email: "ada@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 2 });
  });
});

describe("renaming and removing a passkey (1c design, section 7.5)", () => {
  test("renames only a passkey of the session's account, answering its view; another account's and an unknown one are passkey_not_found", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const mine = h.passkey(ada.user.id, h.now(), { name: "Laptop", createdDeviceId: ada.session.deviceId });
    const theirs = h.passkey(bob.user.id, h.now(), { name: "Bobs" });
    const { passkey } = await renamePasskey(h.deps, ada.session, mine, { name: "Work laptop" });
    expect(passkey).toMatchObject({ id: mine, name: "Work laptop", createdOn: "Chrome on Windows", isNew: true });
    expect(h.passkeys.map((p) => p.name)).toEqual(["Work laptop", "Bobs"]);
    expect(await failure(renamePasskey(h.deps, ada.session, theirs, { name: "Taken" }))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(await failure(renamePasskey(h.deps, ada.session, randomUUID(), { name: "Nothing" }))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(h.passkeys.map((p) => p.name)).toEqual(["Work laptop", "Bobs"]);
    expect(h.events).toEqual([]);
    expect(h.mailer.sent).toEqual([]);
  });

  test("allows 30 renames an hour per account, then rate_limited", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const id = h.passkey(ada.user.id);
    for (let i = 0; i < 30; i++) await renamePasskey(h.deps, ada.session, id, { name: `Name ${i}` });
    expect(await failure(renamePasskey(h.deps, h.session(ada.user.id), id, { name: "Once more" }))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.passkeys[0]!.name).toBe("Name 29");
  });

  test("removes only a passkey of the session's account, the last one too, records it and tells the owner; another account's is passkey_not_found and changes nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const mine = h.passkey(ada.user.id, h.now(), { name: "Laptop" });
    const theirs = h.passkey(bob.user.id, h.now(), { name: "Bobs" });
    expect(await failure(removePasskey(h.deps, ada.session, theirs))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(await failure(removePasskey(h.deps, ada.session, randomUUID()))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(h.passkeys).toHaveLength(2);
    expect(h.events).toEqual([]);
    await removePasskey(h.deps, ada.session, mine);
    expect(h.passkeys.map((p) => p.id)).toEqual([theirs]);
    expect(h.events).toEqual([{ userId: ada.user.id, type: "passkey_removed", deviceId: ada.session.deviceId, metadata: { passkeyId: mine, via: "settings" } }]);
    expect(h.mailer.sent).toEqual([{ to: "ada@korbat.local", template: "passkey_removed", data: { name: "Laptop", time: mailTime(h.now()) } }]);
    // The sessions stay: the owner removed a credential, nothing more.
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null, null]);
    expect(await failure(removePasskey(h.deps, ada.session, mine))).toMatchObject({ code: "passkey_not_found", status: 404 });
  });

  test("removal needs a fresh session, at level 2 on an account with TOTP, and allows 10 an hour per account", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const id = h.passkey(ada.user.id);
    const stale = h.session(ada.user.id, { factors: { email: h.now().getTime() - 10 * MINUTE } });
    expect((await failure(removePasskey(h.deps, stale, id))).details).toEqual({ level: 1, have: [] });
    withTotp(h, ada.user.id, h.now());
    const weak = mfaSession(h, ada.user.id, { email: h.now().getTime() });
    const refused = await failure(removePasskey(h.deps, weak, id));
    expect(refused).toMatchObject({ code: "reauth_required", status: 403 });
    expect(refused.details).toEqual({ level: 2, have: ["email"] });
    expect(h.passkeys).toHaveLength(1);
    const strong = mfaSession(h, ada.user.id, { email: h.now().getTime(), totp: h.now().getTime() });
    for (let i = 0; i < 10; i++) expect(await failure(removePasskey(h.deps, strong, randomUUID()))).toMatchObject({ code: "passkey_not_found" });
    expect(await failure(removePasskey(h.deps, strong, id))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.passkeys).toHaveLength(1);
  });
});

describe("'This wasn't me' on a passkey (1c design, sections 7.5 and 7.6)", () => {
  test("runs the lockdown anchored at the passkey's creation, naming it, and records it with the session's device", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    // The suspect passkey was added six days ago; the rows around its anchor are placed in the past.
    const createdAt = new Date(h.now().getTime() - 6 * DAY);
    const since = createdAt.getTime() - LOCKDOWN_LOOKBACK_MS;
    const kept = h.passkey(ada.user.id, new Date(since - 1));
    const earlier = h.passkey(ada.user.id, new Date(since));
    const suspect = h.passkey(ada.user.id, createdAt);
    const bobs = h.passkey(bob.user.id, createdAt);
    withTotp(h, ada.user.id, new Date(createdAt.getTime() - HOUR));
    await notMine(h.deps, ada.session, suspect, h.ctx);
    expect(h.passkeys.map((p) => p.id).sort()).toEqual([kept, bobs].sort());
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null });
    expect(h.events).toEqual([
      {
        userId: ada.user.id,
        type: "passkey_removed",
        deviceId: ada.session.deviceId,
        metadata: { passkeyId: suspect, via: "not_mine", passkeysRemoved: expect.arrayContaining([earlier, suspect]), totpCleared: true, passwordCleared: true },
      },
    ]);
    expect(h.events[0]!.metadata.passkeysRemoved).toHaveLength(2);
    expect(h.mailer.sent).toEqual([]);
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
  });

  test("only a passkey of the account added in the last 7 days: older ones, another account's and unknown ones are passkey_not_found and change nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    // Exactly 7 days old is no longer new; a month old is also out of any lockdown's reach below.
    const week = h.passkey(ada.user.id, new Date(h.now().getTime() - NEW_PASSKEY_MS));
    const month = h.passkey(ada.user.id, new Date(h.now().getTime() - 30 * DAY));
    const theirs = h.passkey(bob.user.id, h.now());
    for (const id of [week, month, theirs, randomUUID()]) expect(await failure(notMine(h.deps, ada.session, id, h.ctx))).toMatchObject({ code: "passkey_not_found", status: 404 });
    expect(h.passkeys).toHaveLength(3);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null, null]);
    expect(h.events).toEqual([]);
    // One millisecond younger than 7 days is still new; the lockdown it runs reaches the week-old passkey, a day before it.
    const newest = h.passkey(ada.user.id, new Date(h.now().getTime() - NEW_PASSKEY_MS + 1));
    await notMine(h.deps, ada.session, newest, h.ctx);
    expect(h.passkeys.map((p) => p.id).sort()).toEqual([month, theirs].sort());
    expect(h.events.at(-1)!.metadata.passkeysRemoved).toEqual(expect.arrayContaining([week, newest]));
  });

  test("needs a fresh session at level 1 only; a call that finds no new passkey of the account costs the account nothing, however many a session makes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const stale = h.session(ada.user.id, { factors: { email: h.now().getTime() - 10 * MINUTE } });
    const refused = await failure(notMine(h.deps, stale, randomUUID(), h.ctx));
    expect(refused).toMatchObject({ code: "reauth_required", status: 403 });
    expect(refused.details).toEqual({ level: 1, have: [] });
    // Level 1 is enough on an account with TOTP: whoever re-enrolled it holds level 2.
    withTotp(h, ada.user.id, new Date(h.now().getTime() - 30 * DAY));
    const weak = mfaSession(h, ada.user.id, { email: h.now().getTime() });
    // Any session of the account can make these calls, a stolen one too: unknown ids, another account's passkey, one older than a week.
    const misses = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), h.passkey(bob.user.id), h.passkey(ada.user.id, new Date(h.now().getTime() - NEW_PASSKEY_MS))];
    for (const id of misses) expect(await failure(notMine(h.deps, weak, id, h.ctx)), id).toMatchObject({ code: "passkey_not_found", status: 404 });
    // None of them was counted, so the owner's five lockdowns of the day are all still there.
    expect(await h.kv.get(`rl:passkey-not-mine:${ada.user.id}`)).toBeNull();
    expect(h.events).toEqual([]);
    const owners = mfaSession(h, ada.user.id, { email: h.now().getTime() });
    const added = h.passkey(ada.user.id);
    await notMine(h.deps, owners, added, h.ctx);
    expect(await h.kv.get(`rl:passkey-not-mine:${ada.user.id}`)).toBe("1");
    expect(h.events.map((e) => [e.type, e.metadata.passkeysRemoved])).toEqual([["passkey_removed", [added]]]);
  });

  test("allows five lockdowns a day per account: the sixth call that would run one is rate_limited and runs none, while a miss is still answered as a miss", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    expect(NOT_MINE_PER_DAY).toBe(5);
    /** A call that will run the lockdown: a passkey added just now, named from a session that is fresh now. */
    const bound = () => ({ session: h.session(ada.user.id), passkey: h.passkey(ada.user.id) });
    for (let i = 0; i < NOT_MINE_PER_DAY; i++) {
      const { session, passkey } = bound();
      await notMine(h.deps, session, passkey, h.ctx);
      h.advance(HOUR);
    }
    expect(h.events.map((e) => e.type)).toEqual(Array.from({ length: NOT_MINE_PER_DAY }, () => "passkey_removed"));
    expect(h.passkeys).toEqual([]);

    const sixth = bound();
    expect(await failure(notMine(h.deps, sixth.session, sixth.passkey, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: DAY / 1000 });
    // Refused before it ran: the passkey, the session and the log are as they were.
    expect(h.passkeys.map((p) => p.id)).toEqual([sixth.passkey]);
    expect(h.sessions.find((s) => s.id === sixth.session.sessionId)!.revokedAt).toBeNull();
    expect(h.events).toHaveLength(NOT_MINE_PER_DAY);
    // The lookup comes before the bucket, so a miss says what it is, whatever the bucket holds.
    expect(await failure(notMine(h.deps, sixth.session, randomUUID(), h.ctx))).toMatchObject({ code: "passkey_not_found", status: 404 });
    // The day is counted from the first lockdown; once it is over the account has its five again.
    h.advance(DAY - NOT_MINE_PER_DAY * HOUR);
    const next = h.session(ada.user.id);
    await notMine(h.deps, next, sixth.passkey, h.ctx);
    expect(h.passkeys).toEqual([]);
    expect(h.events).toHaveLength(NOT_MINE_PER_DAY + 1);
  });
});

describe("the passkey remove link (1c design, section 7.6)", () => {
  /** A registered passkey and the token of the remove link its mail carried. */
  async function registeredWithLink(h: MemoryFlowHarness, session: Session) {
    const passkey = await register(h, session, new SoftAuthenticator(), { name: "Laptop" });
    const url = h.mailer.sent.at(-1)!.data.removeUrl!;
    return { passkey, token: url.slice(url.lastIndexOf("/") + 1) };
  }

  test("runs the lockdown anchored at the passkey's creation, naming it, once; a second use finds nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    const kept = h.passkey(ada.user.id, new Date(h.now().getTime() - LOCKDOWN_LOOKBACK_MS - 1));
    const earlier = h.passkey(ada.user.id, new Date(h.now().getTime() - LOCKDOWN_LOOKBACK_MS));
    const { passkey, token } = await registeredWithLink(h, ada.session);
    const createdAt = h.now();
    h.advance(3 * DAY);
    const later = h.passkey(ada.user.id, h.now());
    withTotp(h, ada.user.id, h.now());
    const stranger = { ...h.ctx, ipHash: randomToken() };
    await removeByLink(h.deps, { token }, stranger);
    expect(h.passkeys.map((p) => p.id)).toEqual([kept]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null });
    expect(h.events.at(-1)).toEqual({
      userId: ada.user.id,
      type: "passkey_removed",
      deviceId: null,
      metadata: { passkeyId: passkey.id, via: "link", passkeysRemoved: expect.arrayContaining([earlier, passkey.id, later]), totpCleared: true, passwordCleared: true },
    });
    expect(h.events.at(-1)!.metadata.passkeysRemoved).toHaveLength(3);
    expect(h.events.map((e) => e.type)).toEqual(["passkey_added", "passkey_removed"]);
    // Anchored at the creation, not at the use: the day before the creation is the reach, whatever the passkey's age now.
    expect(new Date(h.now().getTime() - 3 * DAY)).toEqual(createdAt);
    expect(await failure(removeByLink(h.deps, { token }, stranger))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events).toHaveLength(2);
  });

  test("works after the passkey is already gone: the sessions and the password still go", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    const { passkey, token } = await registeredWithLink(h, ada.session);
    await removePasskey(h.deps, ada.session, passkey.id);
    expect(h.passkeys).toEqual([]);
    h.advance(DAY);
    await removeByLink(h.deps, { token }, h.ctx);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null });
    expect(h.events.at(-1)).toEqual({
      userId: ada.user.id,
      type: "passkey_removed",
      deviceId: null,
      metadata: { passkeyId: passkey.id, via: "link", passkeysRemoved: [], totpCleared: false, passwordCleared: true },
    });
  });

  test("while the account's address differs from the one the link went to, the link does nothing but refuse and is not spent; once the address is back it works, once", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    const { passkey, token } = await registeredWithLink(h, ada.session);
    const stored = await h.kv.get(passkeyRemoveKey(token));
    await h.deps.repo.changeEmail(ada.user.id, "attacker@korbat.local", h.now());
    for (let i = 0; i < 2; i++) expect(await failure(removeByLink(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.passkeys).toHaveLength(1);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null]);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "attacker@korbat.local", passwordHash: "owner-password" });
    expect(h.events.map((e) => e.type)).toEqual(["passkey_added"]);
    // Refused, not spent: the link is in the store as it was, and its seven days go on running.
    expect(await h.kv.get(passkeyRemoveKey(token))).toBe(stored);
    h.advance(DAY);
    // The address is the owner's again, as the email undo leaves it: the same link now runs the lockdown.
    await h.deps.repo.changeEmail(ada.user.id, "ada@korbat.local", h.now());
    await removeByLink(h.deps, { token }, h.ctx);
    expect(h.passkeys).toEqual([]);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", passwordHash: null });
    expect(h.events.map((e) => e.type)).toEqual(["passkey_added", "passkey_removed"]);
    expect(h.events.at(-1)!.metadata).toMatchObject({ passkeyId: passkey.id, via: "link", passkeysRemoved: [passkey.id] });
    // Once: it is spent now.
    expect(await h.kv.get(passkeyRemoveKey(token))).toBeNull();
    expect(await failure(removeByLink(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events).toHaveLength(2);
    // A change of case alone is no change.
    const bob = h.user("bob@korbat.local");
    const bobs = await registeredWithLink(h, bob.session);
    await h.deps.repo.changeEmail(bob.user.id, "Bob@korbat.local", h.now());
    await removeByLink(h.deps, { token: bobs.token }, h.ctx);
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
  });

  test("the owner who opens the remove link before the email undo loses nothing: refused while the attacker's address stands, the link then removes what the undo's day did not reach", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // From a stolen session: two-factor after an hour, a passkey after two (its notice, with the remove link, goes to the owner).
    h.advance(HOUR);
    withTotp(h, ada.user.id, h.now());
    h.advance(HOUR);
    const { passkey, token: removeToken } = await registeredWithLink(h, mfaSession(h, ada.user.id, { email: h.now().getTime(), totp: h.now().getTime() }));
    // More than a day later, so that the undo's lockdown will not reach either, the address is changed; the undo link goes to the owner too.
    h.advance(28 * HOUR);
    const changing = mfaSession(h, ada.user.id, { email: h.now().getTime(), totp: h.now().getTime() });
    const { flowId } = await startEmailChange(h.deps, changing, { email: "attacker@korbat.local" }, h.ctx);
    await verifyEmailChange(h.deps, changing, { flowId, code: h.mailer.lastCodeFor("attacker@korbat.local")! });
    const undoUrl = h.mailer.sent.at(-1)!.data.revertUrl!;
    const undoToken = undoUrl.slice(undoUrl.lastIndexOf("/") + 1);

    // The owner reads the mails oldest first: the remove link, which the address no longer matches.
    h.advance(HOUR);
    expect(await failure(removeByLink(h.deps, { token: removeToken }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    // Then the undo: the address is back, every session is out, and what was set up more than a day before the change stays.
    await revertEmailChange(h.deps, { token: undoToken }, h.ctx);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", totpSecretEnc: "v1:owner" });
    expect(h.passkeys.map((p) => p.id)).toEqual([passkey.id]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id && s.revokedAt === null)).toEqual([]);
    expect(h.events.at(-1)!.metadata).toMatchObject({ reverted: true, passkeysRemoved: [], totpCleared: false });

    // The remove link again: anchored at the passkey's creation, it reaches the day before it, and so the attacker's two-factor.
    await removeByLink(h.deps, { token: removeToken }, h.ctx);
    expect(h.passkeys).toEqual([]);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] });
    expect(h.events.at(-1)).toEqual({
      userId: ada.user.id,
      type: "passkey_removed",
      deviceId: null,
      metadata: { passkeyId: passkey.id, via: "link", passkeysRemoved: [passkey.id], totpCleared: true, passwordCleared: true },
    });
    expect(await failure(removeByLink(h.deps, { token: removeToken }, h.ctx))).toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("two uses of one link at once act once: one runs the lockdown, the other is refused", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { passkey, token } = await registeredWithLink(h, ada.session);
    const outcomes = await Promise.allSettled([removeByLink(h.deps, { token }, h.ctx), removeByLink(h.deps, { token }, { ...h.ctx, ipHash: randomToken() })]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected")!.reason).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events.filter((e) => e.type === "passkey_removed")).toEqual([
      { userId: ada.user.id, type: "passkey_removed", deviceId: null, metadata: { passkeyId: passkey.id, via: "link", passkeysRemoved: [passkey.id], totpCleared: false, passwordCleared: true } },
    ]);
  });

  test("an unknown link and one of an account that is gone are refused alike, and 10 tries an hour per address are allowed", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { token } = await registeredWithLink(h, ada.session);
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    expect(await failure(removeByLink(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    for (let i = 0; i < 9; i++) expect(await failure(removeByLink(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "invalid_code" });
    expect(await failure(removeByLink(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(await failure(removeByLink(h.deps, { token: randomToken() }, { ...h.ctx, ipHash: randomToken() }))).toMatchObject({ code: "invalid_code" });
    expect(h.events.map((e) => e.type)).toEqual(["passkey_added"]);
  });
});
```

### Replace `apps/api/test/auth/passkey-signin.test.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { AuthError } from "../../src/auth/context";
import { encrypt } from "../../src/auth/crypto";
import { verifyMfa } from "../../src/auth/flows/mfa";
import { reauthenticate } from "../../src/auth/flows/reauth";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, readChallenge } from "../../src/auth/passkeys/challenge";
import {
  SIGNIN_NEW_DEVICE_PER_DAY,
  SIGNIN_NEW_DEVICE_PER_HOUR,
  SIGNIN_OPTIONS_PER_IP,
  SIGNIN_VERIFY_PER_IP,
  reauthOptions,
  reauthenticatePasskey,
  registerOptions,
  registerVerify,
  signInOptions,
  signInVerify,
} from "../../src/auth/passkeys/flows";
import type { Session } from "../../src/auth/sessions";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";
import { SoftAuthenticator, type SoftFlags } from "./soft-authenticator";

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/** An account with two-factor on now, encrypted with the harness key so the MFA step can verify a real code. */
function withTotp(h: MemoryFlowHarness, userId: string, secret: Uint8Array): void {
  Object.assign(h.users.get(userId)!, {
    totpSecretEnc: encrypt(Buffer.from(secret), h.deps.config.totpKey),
    totpEnabledAt: h.now(),
    totpLastStep: null,
    recoveryCodesHash: [],
  });
}

/** Registers a passkey through the real flow (before any TOTP, so the level-1 session suffices) and answers its credential id. */
async function registerPasskey(h: MemoryFlowHarness, session: Session, auth: SoftAuthenticator, flags: SoftFlags = ALL): Promise<string> {
  const { options } = await registerOptions(h.deps, session, { label: "ada" });
  const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
  await registerVerify(h.deps, session, { response });
  return response.id;
}

/**
 * A whole passkey sign-in: fresh options, the authenticator's answer, and the verification. The answer carries the user
 * handle the passkey was created with unless the test gives another, or null for none at all.
 */
async function passkeySignIn(
  h: MemoryFlowHarness,
  auth: SoftAuthenticator,
  credentialId: string,
  deviceId: string,
  opts: { flags?: SoftFlags; counter?: number; userHandle?: Uint8Array | null; tamper?: boolean } = {},
) {
  const { options } = await signInOptions(h.deps, h.ctx);
  const response = auth.get({
    credentialId,
    rpId: RP_ID,
    challenge: options.challenge,
    origin: ORIGIN,
    flags: opts.flags ?? ALL,
    counter: opts.counter ?? 0,
    ...(opts.userHandle !== undefined ? { userHandle: opts.userHandle } : {}),
  });
  // A tampered signature stands for any assertion the library will not verify.
  if (opts.tamper) response.response.signature = response.response.signature.slice(0, -4) + (response.response.signature.endsWith("AAAA") ? "BBBB" : "AAAA");
  return signInVerify(h.deps, { deviceId, platform: "web", response }, h.ctx);
}

describe("passkey sign-in options (1c design, section 7.4)", () => {
  test("carry an empty allow list and a sign-in challenge, and store nothing but the address's counter", async () => {
    const h = memoryFlowHarness();
    // The three methods of the store that can create a key: what handing out options writes is what they are called with.
    const set = vi.spyOn(h.kv, "set");
    const setIfAbsent = vi.spyOn(h.kv, "setIfAbsent");
    const incr = vi.spyOn(h.kv, "incr");
    const { options } = await signInOptions(h.deps, h.ctx);
    expect(options.allowCredentials).toEqual([]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    expect(options.rpId).toBe(RP_ID);
    // A second call is a different challenge, and neither wrote a challenge record, a used-challenge marker or anything else.
    const again = await signInOptions(h.deps, h.ctx);
    expect(again.options.challenge).not.toBe(options.challenge);
    const counter = `rl:passkey-signin-options:ip:${h.ctx.ipHash}`;
    expect(set).not.toHaveBeenCalled();
    expect(setIfAbsent).not.toHaveBeenCalled();
    expect(incr.mock.calls).toEqual([
      [counter, 15 * MINUTE],
      [counter, 15 * MINUTE],
    ]);
    expect(await h.kv.get(counter)).toBe("2");
  });

  test("allows 30 per IP per 15 minutes, then rate_limited with a Retry-After", async () => {
    const h = memoryFlowHarness();
    expect(SIGNIN_OPTIONS_PER_IP).toBe(30);
    for (let i = 0; i < SIGNIN_OPTIONS_PER_IP; i++) await signInOptions(h.deps, h.ctx);
    expect(await failure(signInOptions(h.deps, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address has its own allowance.
    expect((await signInOptions(h.deps, { ...h.ctx, ipHash: "other" })).options.challenge).toBeDefined();
  });
});

describe("passkey sign-in verify (1c design, section 7.4)", () => {
  test("a user-verified passkey on an account with TOTP signs in with passkey_uv and level 2, skipping the TOTP step", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());

    const outcome = await passkeySignIn(h, auth, credentialId, "device-uv");
    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") throw new Error("unreachable");
    expect(outcome.issued.session.factors).toEqual({ passkey_uv: h.now().getTime() });
    expect(outcome.issued.session.passkeyId).toBe(h.passkeys[0]!.id);
    expect(h.deps.sessions.level(outcome.issued.session)).toBe(2);
    expect(outcome.issued.session.mfaEnabled).toBe(true);
    // The sign-in is recorded with its method.
    expect(h.events.filter((e) => e.type === "signin_success").at(-1)!.metadata).toEqual({ method: "passkey" });
  });

  test("a passkey without user verification on an account with TOTP gets an MFA ticket, and the TOTP step then holds passkey and totp at level 2", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, BARE);
    const secret = newTotpSecret();
    withTotp(h, ada.user.id, secret);

    // Even a UV assertion is one factor here: the passkey was not registered with user verification.
    const pending = await passkeySignIn(h, auth, credentialId, "device-plain", { flags: ALL });
    expect(pending.kind).toBe("mfa");
    if (pending.kind !== "mfa") throw new Error("unreachable");

    const signed = await verifyMfa(h.deps, { mfaTicket: pending.mfaTicket, code: hotp(secret, currentStep(h.now().getTime())) }, h.ctx);
    expect(Object.keys(signed.issued.session.factors).sort()).toEqual(["passkey", "totp"]);
    expect(signed.issued.session.passkeyId).toBe(h.passkeys[0]!.id);
    expect(h.deps.sessions.level(signed.issued.session)).toBe(2);
    expect(h.events.filter((e) => e.type === "signin_success").at(-1)!.metadata).toEqual({ method: "passkey" });
  });

  test("a passkey registered with user verification but asserted without it is one factor: on an account with TOTP it goes to the TOTP step, and without TOTP it signs in at level 1", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    expect(h.passkeys[0]!.uvInitialized).toBe(true);

    // The options only prefer user verification, so an authenticator may answer without it: the UV flag of this assertion decides.
    const plain = await passkeySignIn(h, auth, credentialId, "device-bare", { flags: BARE });
    expect(plain.kind).toBe("session");
    if (plain.kind !== "session") throw new Error("unreachable");
    expect(plain.issued.session.factors).toEqual({ passkey: h.now().getTime() });
    expect(h.deps.sessions.level(plain.issued.session)).toBe(1);

    const secret = newTotpSecret();
    withTotp(h, ada.user.id, secret);
    const pending = await passkeySignIn(h, auth, credentialId, "device-bare", { flags: BARE });
    expect(pending.kind).toBe("mfa");
    if (pending.kind !== "mfa") throw new Error("unreachable");
    const signed = await verifyMfa(h.deps, { mfaTicket: pending.mfaTicket, code: hotp(secret, currentStep(h.now().getTime())) }, h.ctx);
    expect(Object.keys(signed.issued.session.factors).sort()).toEqual(["passkey", "totp"]);
    // The same passkey with the user verified skips the step.
    expect((await passkeySignIn(h, auth, credentialId, "device-bare", { flags: ALL })).kind).toBe("session");
  });

  test("a staff account with TOTP always goes to the TOTP step, even with a user-verified passkey", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());
    h.users.get(ada.user.id)!.role = "moderator";
    expect((await passkeySignIn(h, auth, credentialId, "device-staff")).kind).toBe("mfa");
  });

  test("a staff account without TOTP signs in directly, as with an email code", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    h.users.get(ada.user.id)!.role = "admin";
    const outcome = await passkeySignIn(h, auth, credentialId, "device-staff");
    expect(outcome.kind).toBe("session");
  });

  test("an account without TOTP signs in directly; a user-verified passkey is level 2, a plain one level 1", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await registerPasskey(h, ada.session, uv, ALL);
    const plainId = await registerPasskey(h, ada.session, plain, BARE);

    const withUv = await passkeySignIn(h, uv, uvId, "device-a");
    expect(withUv.kind === "session" && h.deps.sessions.level(withUv.issued.session)).toBe(2);
    const withoutUv = await passkeySignIn(h, plain, plainId, "device-b");
    expect(withoutUv.kind === "session" && h.deps.sessions.level(withoutUv.issued.session)).toBe(1);
  });

  test("an unknown credential, a mismatched user handle and a deleted account are all passkey_invalid", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);

    // A credential korbat never stored: its holder answers, but no row names it.
    const orphan = new SoftAuthenticator();
    const orphanReg = orphan.create({ rpId: RP_ID, challenge: (await signInOptions(h.deps, h.ctx)).options.challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    expect(await failure(passkeySignIn(h, orphan, orphanReg.id, "device-x"))).toMatchObject({ code: "passkey_invalid", status: 401 });

    // The right credential, but a user handle that is not this account's.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-x", { userHandle: randomBytes(32) }))).toMatchObject({ code: "passkey_invalid", status: 401 });

    // The account is gone.
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-x"))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("the options name no account, so the assertion must: without the user handle, or on an account that has none, the sign-in is passkey_invalid before the signature is looked at; a re-authentication, whose session names the account, takes the same assertion", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);

    const { options } = await signInOptions(h.deps, h.ctx);
    const withoutHandle = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 1, userHandle: null });
    expect("userHandle" in withoutHandle.response).toBe(false);
    expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response: withoutHandle }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // Nothing moved: the passkey was not used, and no session, device or event came of it.
    expect(h.passkeys[0]).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
    expect(h.sessions).toHaveLength(1);
    expect(h.devices).toHaveLength(1);
    expect(h.events.map((e) => e.type)).toEqual(["passkey_added"]);

    // The handle is checked before the library runs: a suspended passkey, which a verified signature would name as such, stays unnamed.
    await h.deps.repo.suspectPasskey(h.passkeys[0]!.id, h.now());
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { userHandle: null }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a"))).toMatchObject({ code: "passkey_suspended", status: 403 });
    h.passkeys[0]!.suspectAt = null;

    // Re-authentication has an allow list and a session, and there the handle may be absent: the same kind of assertion answers.
    const reauth = await reauthOptions(h.deps, ada.session);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: reauth.options.challenge, origin: ORIGIN, flags: ALL, counter: 2, userHandle: null });
    expect("userHandle" in response.response).toBe(false);
    const result = await reauthenticate(h.deps, ada.session, { method: "passkey", response }, h.ctx);
    expect(result.level).toBe(2);
    expect(result.issued.session.factors.passkey_uv).toBe(h.now().getTime());

    // With its handle the passkey signs in; on an account whose handle is gone, no handle an assertion carries is the account's.
    expect((await passkeySignIn(h, auth, credentialId, "device-a", { counter: 3 })).kind).toBe("session");
    h.users.get(ada.user.id)!.webauthnUserId = null;
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 4 }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 4, userHandle: null }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys[0]!.counter).toBe(3);
  });

  test("a challenge answers once: a replayed assertion is passkey_invalid", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    const { options } = await signInOptions(h.deps, h.ctx);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect((await signInVerify(h.deps, { deviceId: "device-a", platform: "web", response }, h.ctx)).kind).toBe("session");
    expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("allows 20 verifications per IP per 15 minutes, counted before the challenge, then rate_limited", async () => {
    const h = memoryFlowHarness();
    expect(SIGNIN_VERIFY_PER_IP).toBe(20);
    const orphan = new SoftAuthenticator();
    const reg = orphan.create({ rpId: RP_ID, challenge: (await signInOptions(h.deps, h.ctx)).options.challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    // A bogus challenge is refused at the MAC check, before it is spent, so the same response counts each time.
    const bogus = orphan.get({ credentialId: reg.id, rpId: RP_ID, challenge: "not-a-real-challenge", origin: ORIGIN, flags: ALL, counter: 0 });
    for (let i = 0; i < SIGNIN_VERIFY_PER_IP; i++) {
      expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response: bogus }, h.ctx))).toMatchObject({ code: "passkey_invalid" });
    }
    expect(await failure(signInVerify(h.deps, { deviceId: "device-a", platform: "web", response: bogus }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (15 * MINUTE) / 1000 });
  });
});

describe("the passkey counter rule at sign-in (1c design, section 2)", () => {
  test("two zeros pass repeatedly, as a synced passkey always sends", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    for (let i = 0; i < 3; i++) expect((await passkeySignIn(h, auth, credentialId, "device-a", { counter: 0 })).kind).toBe("session");
    expect(h.passkeys[0]!.counter).toBe(0);
    expect(h.passkeys[0]!.suspectAt).toBeNull();
    expect(h.passkeys[0]!.lastUsedAt).toEqual(h.now());
  });

  test("a counter that went backwards after a verified signature suspends the passkey, mails the owner and refuses; a later sign-in is then passkey_suspended, and a bad signature never reveals that", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    // A counter that moves forward is stored.
    expect((await passkeySignIn(h, auth, credentialId, "device-a", { counter: 5 })).kind).toBe("session");
    expect(h.passkeys[0]!.counter).toBe(5);

    // A counter that regresses is caught after the signature: suspect, recorded, mailed and refused.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 3 }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys[0]!.suspectAt).toEqual(h.now());
    expect(h.events.filter((e) => e.type === "passkey_counter_regression")).toEqual([{ userId: ada.user.id, type: "passkey_counter_regression", deviceId: null, metadata: { passkeyId: h.passkeys[0]!.id } }]);
    expect(h.mailer.sent.filter((m) => m.template === "passkey_suspect")).toEqual([{ to: "ada@korbat.local", template: "passkey_suspect", data: { name: h.passkeys[0]!.name } }]);

    // From now on a good signature is passkey_suspended, but only after the signature checks.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 9 }))).toMatchObject({ code: "passkey_suspended", status: 403 });
    // A response the library will not verify is passkey_invalid, never passkey_suspended: the state is not revealed before the signature.
    expect(await failure(passkeySignIn(h, auth, credentialId, "device-a", { counter: 9, tamper: true }))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });
});

describe("the new-device limit at passkey sign-in (1c design, section 7.4)", () => {
  test("counts only devices the account has not used, only after a verified signature, and refuses beyond five an hour", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    expect(SIGNIN_NEW_DEVICE_PER_HOUR).toBe(5);

    // A failed sign-in from a new device does not count: an unknown credential answered before any device was seen.
    const orphan = new SoftAuthenticator();
    const reg = orphan.create({ rpId: RP_ID, challenge: (await signInOptions(h.deps, h.ctx)).options.challenge, origin: ORIGIN, userHandle: randomBytes(32), flags: ALL });
    await failure(passkeySignIn(h, orphan, reg.id, "new-0"));
    // Nor does the account's own credential under a signature the library refuses, from as many new devices as the hour
    // allows: the count comes after the signature, so naming a real credential id without its key spends nothing.
    for (let i = 0; i < SIGNIN_NEW_DEVICE_PER_HOUR; i++) {
      expect(await failure(passkeySignIn(h, auth, credentialId, `forged-${i}`, { tamper: true }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    }
    for (const window of ["hour", "day"]) expect(await h.kv.get(`rl:passkey-signin-new-device:${window}:${ada.user.id}`), window).toBeNull();
    expect(h.devices).toHaveLength(1);

    // Five new devices are allowed; the sixth new device is refused.
    for (let i = 0; i < SIGNIN_NEW_DEVICE_PER_HOUR; i++) expect((await passkeySignIn(h, auth, credentialId, `new-${i}`)).kind).toBe("session");
    expect(await failure(passkeySignIn(h, auth, credentialId, "new-6"))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    // Past the bound a forged answer from a new device is still told it is invalid, not that the account is limited:
    // the signature is looked at first.
    expect(await failure(passkeySignIn(h, auth, credentialId, "forged-after", { tamper: true }))).toMatchObject({ code: "passkey_invalid", status: 401 });

    // A device the account already used never counts, so it keeps working past the bound.
    for (let i = 0; i < 3; i++) expect((await passkeySignIn(h, auth, credentialId, "new-0")).kind).toBe("session");
  });

  test("refuses beyond twenty new devices a day, however they are spread over the hours, until a day after the first of them", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    expect(SIGNIN_NEW_DEVICE_PER_DAY).toBe(20);
    expect(SIGNIN_NEW_DEVICE_PER_DAY % SIGNIN_NEW_DEVICE_PER_HOUR).toBe(0);

    // Five an hour, the most an hour allows, four hours running; each pause lets the hour's bucket run out.
    const pause = HOUR + MINUTE;
    const hours = SIGNIN_NEW_DEVICE_PER_DAY / SIGNIN_NEW_DEVICE_PER_HOUR;
    for (let hour = 0; hour < hours; hour++) {
      for (let i = 0; i < SIGNIN_NEW_DEVICE_PER_HOUR; i++) expect((await passkeySignIn(h, auth, credentialId, `hour-${hour}-device-${i}`)).kind, `hour ${hour}, device ${i}`).toBe("session");
      h.advance(pause);
    }
    expect(await h.kv.get(`rl:passkey-signin-new-device:day:${ada.user.id}`)).toBe(String(SIGNIN_NEW_DEVICE_PER_DAY));
    // The hour has room again, the day has not: the twenty-first new device is refused until the day is over.
    expect(await failure(passkeySignIn(h, auth, credentialId, "one-too-many"))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (24 * HOUR) / 1000 });
    expect(h.devices).toHaveLength(1 + SIGNIN_NEW_DEVICE_PER_DAY);
    // A device the account already used is not counted, so it still signs in.
    expect((await passkeySignIn(h, auth, credentialId, "hour-0-device-0")).kind).toBe("session");
    // The day is counted from the first new device: a millisecond before its end the bound holds, at its end it is over.
    h.advance(24 * HOUR - hours * pause - 1);
    expect(await failure(passkeySignIn(h, auth, credentialId, "still-too-many"))).toMatchObject({ code: "rate_limited", status: 429 });
    h.advance(1);
    expect((await passkeySignIn(h, auth, credentialId, "next-day")).kind).toBe("session");
  });
});

describe("passkey re-authentication (1c design, section 7.2)", () => {
  test("options list the account's usable passkeys, leaving a suspect one out, with a challenge bound to the session", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const good = new SoftAuthenticator();
    const bad = new SoftAuthenticator();
    await registerPasskey(h, ada.session, good, ALL);
    await registerPasskey(h, ada.session, bad, ALL);
    const suspect = h.passkeys[1]!;
    await h.deps.repo.suspectPasskey(suspect.id, h.now());

    const { options } = await reauthOptions(h.deps, ada.session);
    expect(options.allowCredentials!.map((c) => c.id)).toEqual([h.passkeys[0]!.credentialId]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    expect(options.rpId).toBe(RP_ID);
    // The challenge is sealed for re-authentication with this session's handle: it reads with that handle and with no
    // other, not with another session's of the same account, not without one, and not as a sign-in challenge.
    const key = challengeKey(h.deps.config.authHmacKey);
    const refusal = (read: () => void): unknown => {
      try {
        read();
      } catch (err) {
        return err;
      }
      return undefined;
    };
    expect(refusal(() => readChallenge(key, options.challenge, "reauth", h.now(), ada.session.handle))).toBeUndefined();
    for (const handle of [h.session(ada.user.id).handle, undefined]) {
      expect(refusal(() => readChallenge(key, options.challenge, "reauth", h.now(), handle)), String(handle)).toMatchObject({ code: "passkey_invalid", status: 401 });
    }
    expect(refusal(() => readChallenge(key, options.challenge, "signin", h.now()))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("a re-authentication challenge answers only on the session it was issued to: another session of the same account is passkey_invalid, and the owner's session still answers it at level 2", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    const { options } = await reauthOptions(h.deps, ada.session);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 1 });

    // The same account and its own passkey: the session's handle is what does not match.
    expect(await failure(reauthenticate(h.deps, other, { method: "passkey", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
    expect(h.passkeys[0]).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
    const otherRow = h.sessions.find((s) => s.handle === other.handle)!;
    expect([otherRow.id, otherRow.factors, otherRow.reauthAt]).toEqual([other.sessionId, other.factors, other.reauthAt]);

    // The refusal came before the challenge was spent, so the session it belongs to still answers it, once.
    const result = await reauthenticate(h.deps, ada.session, { method: "passkey", response }, h.ctx);
    expect(result.level).toBe(2);
    expect(result.issued.session.handle).toBe(ada.session.handle);
    expect(result.issued.session.factors.passkey_uv).toBe(h.now().getTime());
    expect(h.passkeys[0]).toMatchObject({ counter: 1, lastUsedAt: h.now() });
    expect(await failure(reauthenticate(h.deps, result.issued.session, { method: "passkey", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });

  test("a passkey of another account is refused and its counter is left untouched", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const adaAuth = new SoftAuthenticator();
    const adaCredential = await registerPasskey(h, ada.session, adaAuth, ALL);
    // ada's passkey has a counter on the record.
    await passkeySignIn(h, adaAuth, adaCredential, "device-a", { counter: 7 });
    const before = { ...h.passkeys.find((p) => p.credentialId === adaCredential)! };

    // bob asks for a re-authentication challenge, then answers it with ada's credential.
    const { options } = await reauthOptions(h.deps, bob.session);
    const response = adaAuth.get({ credentialId: adaCredential, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 20 });
    expect(await failure(reauthenticate(h.deps, bob.session, { method: "passkey", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // ada's passkey never moved: the lookup with bob's user never found it.
    const after = h.passkeys.find((p) => p.credentialId === adaCredential)!;
    expect(after.counter).toBe(before.counter);
    expect(after.lastUsedAt).toEqual(before.lastUsedAt);
    expect(after.suspectAt).toBeNull();
  });

  test("a user-verified passkey re-authentication gives level 2 on an account with TOTP, rotating the token in place", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());

    const { options } = await reauthOptions(h.deps, ada.session);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    const result = await reauthenticate(h.deps, ada.session, { method: "passkey", response }, h.ctx);
    expect(result.level).toBe(2);
    expect(result.mustReenrollMfa).toBe(false);
    // The token rotated in place: same handle, the passkey_uv factor written.
    expect(result.issued.session.handle).toBe(ada.session.handle);
    expect(result.issued.session.factors.passkey_uv).toBe(h.now().getTime());
    expect(h.passkeys[0]!.lastUsedAt).toEqual(h.now());
  });

  test("the passkey helper answers passkey_uv only when this assertion verified the user and the passkey was registered with user verification; either half missing, it answers passkey", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await registerPasskey(h, ada.session, uv, ALL);
    const plainId = await registerPasskey(h, ada.session, plain, BARE);

    const optionsA = (await reauthOptions(h.deps, ada.session)).options;
    const uvResponse = uv.get({ credentialId: uvId, rpId: RP_ID, challenge: optionsA.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, uvResponse, h.now())).toBe("passkey_uv");

    // Registered without user verification: a verified assertion is still one factor.
    const optionsB = (await reauthOptions(h.deps, ada.session)).options;
    const plainResponse = plain.get({ credentialId: plainId, rpId: RP_ID, challenge: optionsB.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, plainResponse, h.now())).toBe("passkey");

    // Registered with user verification, asserted without it: one factor too.
    const optionsC = (await reauthOptions(h.deps, ada.session)).options;
    const bareResponse = uv.get({ credentialId: uvId, rpId: RP_ID, challenge: optionsC.challenge, origin: ORIGIN, flags: BARE, counter: 0 });
    expect(await reauthenticatePasskey(h.deps, ada.session, ada.user, bareResponse, h.now())).toBe("passkey");
  });

  test("a re-authentication with a passkey registered with user verification but asserted without it writes the factor passkey: level 1, and on an account with TOTP not the level 2 its routes ask for", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const auth = new SoftAuthenticator();
    const credentialId = await registerPasskey(h, ada.session, auth, ALL);
    withTotp(h, ada.user.id, newTotpSecret());
    // Ten minutes on, the sign-in's own factor is out of the window: what this re-authentication proves is all the session holds.
    h.advance(10 * MINUTE);

    const { options } = await reauthOptions(h.deps, ada.session);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: BARE, counter: 0 });
    const result = await reauthenticate(h.deps, ada.session, { method: "passkey", response }, h.ctx);
    expect(result.level).toBe(1);
    expect(result.issued.session.factors).toEqual({ ...ada.session.factors, passkey: h.now().getTime() });
    expect(h.deps.sessions.reauthNeeded(result.issued.session, h.deps.sessions.requiredLevel(result.issued.session))).toEqual({ level: 2, have: ["passkey"] });
  });
});
```

### Replace `apps/api/test/auth/sessions.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, test } from "vitest";
import type { AuthDeps } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { requireFreshAuth, requireStrongFreshAuth } from "../../src/auth/middleware";
import type { AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, SESSION_ABSOLUTE_MS, SESSION_CACHE_TTL_MS, createSessions, type Factors, type Session, type Sessions } from "../../src/auth/sessions";
import type { AppEnv } from "../../src/env";
import { memoryFlowHarness } from "./flow-harness";

const T0 = 1_789_000_000_000;
const MINUTE = 60_000;

/** The freshness rules read nothing but the session and the clock: no row is ever read or written here. */
function setup(start = T0) {
  let t = start;
  const sessions = createSessions({ repo: {} as AuthRepo, kv: new MemoryKv(() => t), now: () => new Date(t) });
  return {
    sessions,
    advance(ms: number) {
      t += ms;
    },
  };
}

/** A resolved session of an account with or without TOTP, holding exactly the given factors. */
function session(factors: Factors, mfaEnabled = false): Session {
  const times = Object.values(factors);
  return {
    sessionId: sha256Hex(randomToken()),
    userId: randomUUID(),
    deviceId: randomUUID(),
    role: "user",
    onboarded: true,
    mfaEnabled,
    reauthAt: new Date(times.length > 0 ? Math.max(...times) : 0),
    handle: randomUUID(),
    factors,
    passkeyId: null,
  };
}

describe("session factors: freshness and level (1c design, sections 2 and 7.1)", () => {
  test("fresh means any factor within the window; a factor older than five minutes does not count, whatever reauthAt says", () => {
    const { sessions, advance } = setup();
    expect(sessions.isFresh(session({ email: T0 }))).toBe(true);
    expect(sessions.isFresh(session({}))).toBe(false);
    advance(REAUTH_WINDOW_MS);
    expect(sessions.isFresh(session({ email: T0 }))).toBe(true);
    advance(1);
    expect(sessions.isFresh(session({ email: T0 }))).toBe(false);
    expect(sessions.isFresh(session({ email: T0, totp: T0 + MINUTE }))).toBe(true);
    // The column follows the factors, never the other way round: a reauthAt of its own proves nothing.
    expect(sessions.isFresh({ ...session({ email: T0 }), reauthAt: new Date(T0 + REAUTH_WINDOW_MS + 1) })).toBe(false);
    // A shorter window applies to every factor alike.
    const recent = session({ email: T0 + REAUTH_WINDOW_MS - MINUTE });
    expect(sessions.isFresh(recent)).toBe(true);
    expect(sessions.isFresh(recent, MINUTE)).toBe(false);
  });

  test("the level rule: a user-verified passkey, or a TOTP or recovery code together with an email code, a password or a passkey, is level 2", () => {
    const { sessions } = setup();
    const levelTwo: Factors[] = [{ email: T0, totp: T0 }, { password: T0, recovery: T0 }, { passkey_uv: T0 }, { passkey: T0, totp: T0 }, { email: T0, recovery: T0, password: T0 }];
    for (const factors of levelTwo) expect(sessions.level(session(factors)), JSON.stringify(factors)).toBe(2);
    const levelOne: Factors[] = [{ totp: T0, recovery: T0 }, { email: T0 }, { password: T0 }, { passkey: T0 }, { email: T0, password: T0, passkey: T0 }, {}];
    for (const factors of levelOne) expect(sessions.level(session(factors)), JSON.stringify(factors)).toBe(1);
  });

  test("a factor older than five minutes counts towards no level, and the factors in time are listed by kind", () => {
    const { sessions, advance } = setup();
    const s = session({ email: T0, totp: T0 + 2 * MINUTE });
    expect(sessions.recentFactors(s)).toEqual(["email", "totp"]);
    expect(sessions.level(s)).toBe(2);
    advance(REAUTH_WINDOW_MS + 1);
    expect(sessions.recentFactors(s)).toEqual(["totp"]);
    expect(sessions.level(s)).toBe(1);
    expect(sessions.isFresh(s)).toBe(true);
    advance(2 * MINUTE);
    expect(sessions.recentFactors(s)).toEqual([]);
    expect(sessions.level(s)).toBe(1);
    expect(sessions.isFresh(s)).toBe(false);
  });

  test("an account with TOTP needs level 2 and one without needs level 1; a refusal names the level and the factors proven in time", () => {
    const { sessions, advance } = setup();
    expect(sessions.requiredLevel(session({ email: T0 }, true))).toBe(2);
    expect(sessions.requiredLevel(session({ email: T0 }, false))).toBe(1);
    const onlyEmail = session({ email: T0 }, true);
    expect(sessions.reauthNeeded(onlyEmail, 1)).toBeNull();
    expect(sessions.reauthNeeded(onlyEmail, 2)).toEqual({ level: 2, have: ["email"] });
    expect(sessions.reauthNeeded(session({ email: T0, totp: T0 }, true), 2)).toBeNull();
    expect(sessions.reauthNeeded(session({ totp: T0, recovery: T0 }, true), 2)).toEqual({ level: 2, have: ["totp", "recovery"] });
    advance(REAUTH_WINDOW_MS + 1);
    expect(sessions.reauthNeeded(onlyEmail, 1)).toEqual({ level: 1, have: [] });
    expect(sessions.reauthNeeded(onlyEmail, 2)).toEqual({ level: 2, have: [] });
  });
});

describe("the session cache key carries a version (1c design, amendments)", () => {
  test("a copy the release before 1c cached, without handle or factors, is never read: the session comes from its row and is cached under the versioned key", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const issued = await h.deps.sessions.issue(ada.user.id, ada.session.deviceId, { factors: { email: h.now().getTime() } });
    const id = issued.session.sessionId;
    // What the previous release wrote under its key: seven fields, a year of life left, and no handle, factors or passkey.
    const before = JSON.stringify({
      session: { sessionId: id, userId: ada.user.id, deviceId: ada.session.deviceId, role: "user", onboarded: true, mfaEnabled: false, reauthAt: h.now().toISOString() },
      absoluteExpiresAt: new Date(h.now().getTime() + SESSION_ABSOLUTE_MS).toISOString(),
    });
    await h.kv.set(`sess:${id}`, before, SESSION_CACHE_TTL_MS);

    const resolved = (await h.deps.sessions.resolve(issued.token))!.session;
    expect(resolved).toEqual(issued.session);
    expect(resolved.handle).toBe(issued.session.handle);
    // The freshness rules read the factors; on the old copy they would have had none to read.
    expect(h.deps.sessions.recentFactors(resolved)).toEqual(["email"]);
    expect(h.deps.sessions.reauthNeeded(resolved, 1)).toBeNull();
    // The fill went under the versioned key, and the old entry is left to run out on its own.
    expect(JSON.parse((await h.kv.get(`sess:2:${id}`))!)).toEqual({
      session: { ...issued.session, reauthAt: issued.session.reauthAt.toISOString() },
      absoluteExpiresAt: new Date(h.now().getTime() + SESSION_ABSOLUTE_MS).toISOString(),
    });
    expect(await h.kv.get(`sess:${id}`)).toBe(before);
    h.advance(SESSION_CACHE_TTL_MS);
    expect(await h.kv.get(`sess:${id}`)).toBeNull();
  });

  test("tombstones are written under the versioned key too, so a rotated token stops working at once", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const issued = await h.deps.sessions.issue(ada.user.id, ada.session.deviceId, { factors: { email: h.now().getTime() } });
    expect(await h.deps.sessions.resolve(issued.token)).not.toBeNull();
    const rotated = await h.deps.sessions.rotate(issued.session);
    expect(await h.kv.get(`sess:2:${issued.session.sessionId}`)).toBe("revoked");
    expect(await h.kv.get(`sess:${issued.session.sessionId}`)).toBeNull();
    expect(await h.deps.sessions.resolve(issued.token)).toBeNull();
    expect((await h.deps.sessions.resolve(rotated.token))?.session).toEqual(rotated.session);
  });
});

describe("the freshness middlewares", () => {
  /** One guard on one route, with the session a request would carry, or none. */
  function app(guard: MiddlewareHandler<AppEnv>, current: Session | null) {
    const a = new Hono<AppEnv>();
    a.use(async (c, next) => {
      c.set("requestId", "req-1");
      c.set("session", current);
      c.set("authVia", "cookie");
      await next();
    });
    a.get("/x", guard, (c) => c.text("ok"));
    return a;
  }
  const deps = (sessions: Sessions) => ({ sessions }) as unknown as AuthDeps;

  test("requireFreshAuth asks for level 1 and, refusing, says which factors the session has in time", async () => {
    const { sessions, advance } = setup();
    const s = session({ email: T0 }, true);
    expect((await app(requireFreshAuth(deps(sessions)), s).request("/x")).status).toBe(200);
    advance(REAUTH_WINDOW_MS + 1);
    const refused = await app(requireFreshAuth(deps(sessions)), s).request("/x");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: { code: "reauth_required", message: "Confirm it's you to continue.", requestId: "req-1", details: { level: 1, have: [] } },
    });
    // A window of the caller's own, in seconds, as the social module's handle change could ask for.
    expect((await app(requireFreshAuth(deps(sessions), 10 * 60), s).request("/x")).status).toBe(200);
  });

  test("requireStrongFreshAuth asks for level 2 on an account with TOTP and for level 1 otherwise", async () => {
    const { sessions } = setup();
    const strong = requireStrongFreshAuth(deps(sessions));
    const refused = await app(strong, session({ email: T0 }, true)).request("/x");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "reauth_required", details: { level: 2, have: ["email"] } } });
    expect((await app(strong, session({ totp: T0, recovery: T0 }, true)).request("/x")).status).toBe(403);
    expect((await app(strong, session({ email: T0, totp: T0 }, true)).request("/x")).status).toBe(200);
    expect((await app(strong, session({ password: T0, recovery: T0 }, true)).request("/x")).status).toBe(200);
    expect((await app(strong, session({ passkey_uv: T0 }, true)).request("/x")).status).toBe(200);
    expect((await app(strong, session({ email: T0 }, false)).request("/x")).status).toBe(200);
    const stale = await app(strong, session({}, false)).request("/x");
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: { code: "reauth_required", details: { level: 1, have: [] } } });
  });

  test("both answer 401 without a session", async () => {
    const { sessions } = setup();
    for (const guard of [requireFreshAuth(deps(sessions)), requireStrongFreshAuth(deps(sessions))]) {
      const res = await app(guard, null).request("/x");
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
    }
  });
});
```

### Replace `apps/api/test/integration/account-deletion.test.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { count, eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { blocks, bookmarks, closeDb, createDb, follows, handleHistory, likes, mutes, posts, profiles, reposts, users, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { confirmDeletion, purge, startDeletion } from "../../src/account/flows/deletion";
import { createPurgeJob, purgePending } from "../../src/account/purge";
import { confirmDeletion as authConfirmDeletion, startDeletion as authStartDeletion } from "../../src/auth/flows/deletion";
import { startEmail } from "../../src/auth/flows/email";
import { exportAccount } from "../../src/auth/flows/export";
import { passwordSignIn } from "../../src/auth/flows/password";
import { signIn } from "../../src/auth/flows/signin";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MemoryJobLock } from "../../src/lib/jobs";
import { mediaForAccount } from "../../src/media";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { exportProfile } from "../../src/social/flows/export";
import { createPost, deletePost, getPost, thread } from "../../src/social/flows/posts";
import { profile } from "../../src/social/flows/profiles";
import { latestTimeline } from "../../src/social/flows/timelines";
import { flowHarness, newTestDevice, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `d_${randomBytes(5).toString("hex")}`;
const PASSWORD = "correct horse battery staple";
const page = { limit: 50 };

/**
 * Account deletion across the three modules on real Postgres: the auth repository behind the auth
 * flows, the social repository's purge, the media repository with both volumes in a temporary
 * directory, composed the way the server composes the account module's dependencies from the module
 * indexes. The auth flows read the handle through the real profile store, as the server wires it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: account deletion", () => {
  let apiDb: Db;
  let authDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    authRepo = createAuthRepo(authDb);
    h = flowHarness(authRepo, { profiles: createProfileStore(apiDb) });
    m = await mediaHarness(apiDb);
    s = socialHarness(apiDb, {
      media: {
        attach: (tx, input) => m.deps.repo.attach(tx, input),
        detachAll: (tx, postId) => m.deps.repo.detachAll(tx, postId),
        requestDeletion: (ids) => m.files.requestDeletion(ids),
        forPosts: (postIds) => m.deps.repo.forPosts(postIds),
      },
    });
  });
  afterAll(async () => {
    m.cleanup();
    await Promise.all([closeDb(apiDb), closeDb(authDb)]);
  });

  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: (session, ctx) => authStartDeletion(h.deps, session, ctx),
      confirmDeletion: (session, input) => authConfirmDeletion(h.deps, session, input),
      pendingPurges: () => authRepo.pendingPurges(),
      finishPurge: (userId) => authRepo.finishPurge(userId, new Date()),
      exportAccount: (userId) => exportAccount(h.deps, userId),
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: {
      purgeProfile: (userId, now, within) => s.repo.purgeProfile(userId, now, within),
      exportProfile: (userId) => exportProfile(s.deps, userId),
    },
    // The media module's own interface for this one, over the harness's repository and volumes.
    media: mediaForAccount(m.deps),
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  /** An auth account with a password, signed in on one device, with a profile of the same id in the public schema, old enough to quote and repost. */
  async function account() {
    const owner = await onboardedUser(h, authRepo, { password: PASSWORD });
    const handle = newHandle();
    const created = await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" });
    expect(created.ok).toBe(true);
    await apiDb.update(profiles).set({ createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) }).where(eq(profiles.id, owner.user.id));
    return { ...owner, handle };
  }

  const authRow = async (id: string) => (await authDb.select().from(users).where(eq(users.id, id)))[0];
  const profileRow = async (id: string) => (await apiDb.select().from(profiles).where(eq(profiles.id, id)))[0]!;
  const postRow = async (id: string) => (await apiDb.select().from(posts).where(eq(posts.id, id)))[0]!;
  const rowCount = async (table: typeof likes | typeof reposts | typeof bookmarks, userId: string) =>
    (await apiDb.select({ n: count() }).from(table).where(eq(table.userId, userId)))[0]!.n;
  const pairCount = async (table: typeof follows | typeof blocks | typeof mutes, id: string) =>
    (await apiDb.select({ n: count() }).from(table).where(sql`${table.fromId} = ${id}::uuid or ${table.toId} = ${id}::uuid`))[0]!.n;
  const image = (id: string, alt: string) => ({ id, alt });

  test("deleting an account with posts, images, engagement and graph rows leaves tombstones, right counters elsewhere, no image rows, an anonymised profile with its handle reserved, and an anonymised auth row", async () => {
    const owner = await account();
    const userId = owner.user.id;
    // The handle left behind stays reserved, and so does the current one.
    const renamed = newHandle();
    expect((await s.repo.changeHandle(userId, renamed, s.clock.next())).ok).toBe(true);
    const other = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await authRepo.createEmailCode({ flowId: randomBytes(16).toString("hex"), email: owner.email, userId, purpose: "reauth", codeHash: "h", expiresAt: new Date(Date.now() + 600_000), ipHash: "x" });
    await authRepo.setPhoneHash(userId, randomBytes(16).toString("hex"));
    await h.deps.profiles.setVerified(userId, new Date());

    const [bob, carol, dan, eve] = await Promise.all([s.established(), s.established(), s.established(), s.established()]);
    const bobsPost = await createPost(s.deps, bob.id, { body: "bob's post", media: [] });
    const [imageA, imageB] = [await m.readyImage(userId), await m.readyImage(userId)];
    const root = await createPost(s.deps, userId, { body: "two photos", media: [image(imageA, "a harbour at dawn"), image(imageB, "a lighthouse")] });
    const selfReply = await createPost(s.deps, userId, { body: "my own follow-up", replyToId: root.id, media: [] });
    const replyToBob = await createPost(s.deps, userId, { body: "a reply to bob", replyToId: bobsPost.id, media: [] });
    const quoteOfBob = await createPost(s.deps, userId, { body: "quoting bob", quoteOfId: bobsPost.id, media: [] });
    const earlier = await createPost(s.deps, userId, { body: "deleted before the account", media: [] });
    await deletePost(s.deps, userId, earlier.id);
    const earlierDeletedAt = (await postRow(earlier.id)).deletedAt;
    const bobsReply = await createPost(s.deps, bob.id, { body: "bob replies", replyToId: root.id, media: [] });
    // Engagement: the owner's on bob's post goes with the counters; carol's stays, so the counters come down to one, not to zero.
    for (const who of [userId, carol.id]) expect(await s.repo.like(who, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.repost(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.bookmark(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.like(carol.id, root.id, s.clock.next())).toBe(true);
    // The graph: follows both ways with a bystander on each side, a block each way, a mute each way.
    for (const [from, to] of [
      [userId, bob.id],
      [bob.id, userId],
      [carol.id, userId],
      [carol.id, bob.id],
      [bob.id, carol.id],
    ]) {
      expect(await s.repo.follow(from!, to!, s.clock.next())).toBe(true);
    }
    expect(await s.repo.block(userId, dan.id, s.clock.next())).toBe(true);
    expect(await s.repo.block(eve.id, userId, s.clock.next())).toBe(true);
    expect(await s.repo.mute(userId, carol.id, s.clock.next())).toBe(true);
    expect(await s.repo.mute(dan.id, userId, s.clock.next())).toBe(true);
    // Uploads on no post, in every state: they go too, files and all.
    const loose = await m.readyImage(userId);
    const processing = (await upload(m.deps, userId, m.jpeg())).id;
    const failed = (await upload(m.deps, userId, m.jpeg())).id;
    m.worker.failed(failed, "corrupt_image");
    await status(m.deps, userId, failed);
    // The upload still in processing has its file waiting in the uploads volume for the worker.
    expect(existsSync(m.files.uploads.upload(processing))).toBe(true);

    expect(await profileRow(bob.id)).toMatchObject({ followerCount: 2, followingCount: 2, postCount: 1 });
    expect(await profileRow(carol.id)).toMatchObject({ followerCount: 1, followingCount: 2 });
    expect(await postRow(bobsPost.id)).toMatchObject({ likeCount: 2, repostCount: 1, replyCount: 1, quoteCount: 1 });
    expect(await profileRow(userId)).toMatchObject({ followerCount: 2, followingCount: 1, postCount: 2 });

    const { flowId } = await startDeletion(deps(), owner.session, h.ctx);
    const code = h.mailer.lastCodeFor(owner.email)!;
    await confirmDeletion(deps(), owner.session, { flowId, code, handle: renamed.toUpperCase() });

    // The auth row: gone for every lookup, anonymised, both sessions dead and tombstoned, no devices or codes, the event recorded, the notice sent.
    expect(await authRepo.findUserById(userId)).toBeUndefined();
    expect(await authRepo.findUserByEmail(owner.email)).toBeUndefined();
    const anonymised = (await authRow(userId))!;
    expect(anonymised.deletedAt).not.toBeNull();
    expect(anonymised.purgedAt).not.toBeNull();
    expect(anonymised).toMatchObject({
      email: `deleted:${userId}`,
      emailVerifiedAt: null,
      passwordHash: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      recoveryCodesHash: [],
      phoneHash: null,
      ageConfirmedAt: null,
      termsVersion: null,
      termsAcceptedAt: null,
    });
    for (const id of [owner.session.sessionId, other.issued.session.sessionId]) {
      expect(await authRepo.findActiveSession(id, new Date()), id).toBeUndefined();
      expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    }
    expect(await authRepo.listDevices(userId)).toEqual([]);
    expect((await authDb.execute(sql`select count(*)::int as n from auth.email_codes where user_id = ${userId}::uuid`)) as unknown as { n: number }[]).toEqual([{ n: 0 }]);
    expect((await authRepo.recentEvents(userId)).map((e) => e.type)).toContain("account_deleted");
    expect(h.mailer.sent.filter((mail) => mail.to === owner.email).map((mail) => mail.template)).toEqual(["delete_account_code", "account_deleted"]);

    // The profile: not found by either handle, anonymised, its handles still reserved for it.
    expect(await s.repo.findProfileByHandle(renamed)).toBeNull();
    expect(await s.repo.findProfileByHandle(owner.handle)).toBeNull();
    expect(await rejection(profile(s.deps, null, renamed))).toBe("not_found");
    expect(await rejection(exportProfile(s.deps, userId))).toBe("not_found");
    const gone = await profileRow(userId);
    expect(gone).toMatchObject({ handle: renamed, displayName: "Deleted account", bio: "", avatarPath: null, verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0 });
    expect(gone.deletedAt).not.toBeNull();
    expect((await apiDb.select({ handle: handleHistory.handleLower }).from(handleHistory).where(eq(handleHistory.profileId, userId))).map((row) => row.handle).sort()).toEqual([owner.handle, renamed].sort());
    expect(await s.repo.changeHandle(bob.id, renamed, s.clock.next())).toEqual({ ok: false, reason: "handle_taken" });
    expect(await s.repo.changeHandle(bob.id, owner.handle, s.clock.next())).toEqual({ ok: false, reason: "handle_taken" });

    // Every post is a tombstone; the one deleted earlier keeps its time; parents and quoted posts count them no more.
    for (const id of [root.id, selfReply.id, replyToBob.id, quoteOfBob.id, earlier.id]) {
      expect(await postRow(id), id).toMatchObject({ state: "deleted_by_author", body: "" });
      expect((await postRow(id)).deletedAt, id).not.toBeNull();
      expect(await rejection(getPost(s.deps, null, id)), id).toBe("not_found");
    }
    expect((await postRow(earlier.id)).deletedAt).toEqual(earlierDeletedAt);
    expect(await postRow(bobsPost.id)).toMatchObject({ likeCount: 1, repostCount: 0, replyCount: 0, quoteCount: 0 });
    expect((await thread(s.deps, null, bobsReply.id, page)).ancestors).toEqual([{ id: root.id, deleted: true }]);
    expect((await latestTimeline(s.deps, null, page)).items.map((item) => item.post.id)).not.toContain(root.id);
    expect(await postRow(bobsReply.id)).toMatchObject({ state: "visible", replyToId: root.id });

    // The owner's engagement and graph rows are gone, in both directions, and the other accounts' counters follow.
    for (const table of [likes, reposts, bookmarks]) expect(await rowCount(table, userId)).toBe(0);
    for (const table of [follows, blocks, mutes]) expect(await pairCount(table, userId)).toBe(0);
    expect(await rowCount(likes, carol.id)).toBe(2);
    expect(await profileRow(bob.id)).toMatchObject({ followerCount: 1, followingCount: 1, postCount: 1 });
    expect(await profileRow(carol.id)).toMatchObject({ followerCount: 1, followingCount: 1 });
    expect((await s.repo.relation(eve.id, userId)).blocked).toBe(false);
    expect((await s.repo.relation(dan.id, userId)).muted).toBe(false);

    // The image rows are gone whatever their state, and the worker is asked for every file.
    for (const id of [imageA, imageB, loose, processing, failed]) expect(await m.deps.repo.find(id), id).toBeNull();
    expect(await m.deps.repo.readyImages(userId)).toEqual([]);
    expect(await m.files.deletionRequests()).toEqual(expect.arrayContaining([imageA, imageB, loose, processing, failed]));
    // On the disk: every id has its request, and the processing upload's file is gone, so no worker picks it up afterwards.
    for (const id of [imageA, imageB, loose, processing, failed]) expect(existsSync(m.files.uploads.deletion(id)), id).toBe(true);
    for (const id of [imageA, imageB, loose, processing, failed]) expect(existsSync(m.files.uploads.upload(id)), id).toBe(false);
    expect(await authRepo.pendingPurges()).not.toContain(userId);

    // A second purge changes nothing: the rows read the same afterwards, and no further file deletion is asked for.
    const before = { auth: await authRow(userId), profile: gone, bob: await profileRow(bob.id), bobsPost: await postRow(bobsPost.id), requests: (await m.files.deletionRequests()).sort() };
    await purge(deps(), userId);
    expect({ auth: await authRow(userId), profile: await profileRow(userId), bob: await profileRow(bob.id), bobsPost: await postRow(bobsPost.id), requests: (await m.files.deletionRequests()).sort() }).toEqual(before);
  });

  test("sign-in with a deleted address behaves as for an unknown one before the purge ran, and one round of the job finishes deletions left half done, oldest first", async () => {
    const ghost = await account();
    const later = await account();
    const bob = await s.established();
    const ghostsPost = await createPost(s.deps, ghost.user.id, { body: "left behind", media: [] });
    expect(await s.repo.follow(bob.id, ghost.user.id, s.clock.next())).toBe(true);
    expect(await s.repo.follow(ghost.user.id, bob.id, s.clock.next())).toBe(true);
    // Deleted by hand, as a process that died after the auth step leaves them: no purge has run.
    await authRepo.markDeleted(ghost.user.id, new Date(Date.now() - 120_000));
    await authRepo.markDeleted(later.user.id, new Date(Date.now() - 60_000));

    // The start answers as for an address without an account, and the right password no longer signs in.
    const device = newTestDevice();
    const started = await startEmail(h.deps, { email: ghost.email, turnstileToken: "ok", ...device }, h.ctx);
    expect(Object.keys(started)).toEqual(["flowId"]);
    expect((await authRepo.findEmailCode(started.flowId))?.purpose).toBe("signup");
    expect(h.mailer.sent.filter((mail) => mail.to === ghost.email).map((mail) => mail.template)).toEqual(["sign_up_code"]);
    expect(await rejection(passwordSignIn(h.deps, { email: ghost.email, password: PASSWORD, turnstileToken: "ok", ...device }, h.ctx))).toBe("invalid_credentials");
    expect(await authRepo.findActiveSession(ghost.session.sessionId, new Date())).toBeUndefined();
    // The profile is still there for the moment; the job is what takes it down.
    expect(await s.repo.findProfileByHandle(ghost.handle)).not.toBeNull();

    const pending = await authRepo.pendingPurges();
    expect(pending).toEqual(expect.arrayContaining([ghost.user.id, later.user.id]));
    expect(pending.indexOf(ghost.user.id)).toBeLessThan(pending.indexOf(later.user.id));
    const report = await purgePending(deps());
    expect(report.failed).toBe(0);
    expect(report.purged).toBeGreaterThanOrEqual(2);
    expect(await authRepo.pendingPurges()).toEqual([]);
    for (const user of [ghost, later]) {
      const row = (await authRow(user.user.id))!;
      expect(row.purgedAt, user.handle).not.toBeNull();
      expect(row.email, user.handle).toBe(`deleted:${user.user.id}`);
      expect(await s.repo.findProfileByHandle(user.handle), user.handle).toBeNull();
      expect(await profileRow(user.user.id)).toMatchObject({ displayName: "Deleted account", followerCount: 0, followingCount: 0, postCount: 0 });
    }
    expect(await postRow(ghostsPost.id)).toMatchObject({ state: "deleted_by_author", body: "" });
    expect(await profileRow(bob.id)).toMatchObject({ followerCount: 0, followingCount: 0 });
    // The job as the server runs it: a round under its lock, with nothing left to do.
    expect(await createPurgeJob(deps(), new MemoryJobLock()).round()).toBe("ran");

    // finishPurge twice is once: the second call leaves the row as it was; and it never touches a live account.
    const purged = await authRow(ghost.user.id);
    await authRepo.finishPurge(ghost.user.id, new Date(Date.now() + 1000));
    expect(await authRow(ghost.user.id)).toEqual(purged);
    const alive = await account();
    await authRepo.finishPurge(alive.user.id, new Date());
    expect(await authRow(alive.user.id)).toMatchObject({ email: alive.email, purgedAt: null, deletedAt: null });
    expect(await authRepo.findUserById(alive.user.id)).toBeDefined();
  });
});
```

### Replace `apps/api/test/integration/account-export.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { buildExport, exportJson, writeExport } from "../../src/account/flows/export";
import { createZipWriter } from "../../src/account/zip";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { exportAccount } from "../../src/auth/flows/export";
import { signIn } from "../../src/auth/flows/signin";
import { MINUTE } from "../../src/auth/limits";
import { registerOptions, registerVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { loadConfig } from "../../src/config";
import { mediaForAccount } from "../../src/media";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SocialError } from "../../src/social/context";
import { exportProfile } from "../../src/social/flows/export";
import { createPost, deletePost } from "../../src/social/flows/posts";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { TEST_TERMS, flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { newPost } from "./social-fixtures";
import { socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `x_${randomBytes(5).toString("hex")}`;
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

/** Collects the archive in memory, copying each chunk as the sink of a response would consume it. */
function memorySink() {
  const chunks: Uint8Array[] = [];
  return {
    write: async (chunk: Uint8Array): Promise<void> => {
      chunks.push(Uint8Array.from(chunk));
    },
    bytes: (): Uint8Array => Buffer.concat(chunks),
  };
}

/**
 * The export across the three modules on real Postgres: the auth repository behind the auth flow,
 * the social repository and flows, and the media repository with both volumes in a temporary
 * directory and the stand-in for the worker. Only the account module's dependencies are composed
 * here, the way the server composes them from the module indexes.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the data export of an account", () => {
  let apiDb: Db;
  let authDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    authRepo = createAuthRepo(authDb);
    h = flowHarness(authRepo);
    m = await mediaHarness(apiDb);
    s = socialHarness(apiDb, {
      media: {
        attach: (tx, input) => m.deps.repo.attach(tx, input),
        detachAll: (tx, postId) => m.deps.repo.detachAll(tx, postId),
        requestDeletion: (ids) => m.files.requestDeletion(ids),
        forPosts: (postIds) => m.deps.repo.forPosts(postIds),
      },
    });
  });
  afterAll(async () => {
    m.cleanup();
    await Promise.all([closeDb(apiDb), closeDb(authDb)]);
  });

  // The deletion side of the three interfaces is not exercised by the export; account-deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      exportAccount: (userId) => exportAccount(h.deps, userId),
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: { purgeProfile: notHere, exportProfile: (userId, pageSize) => exportProfile(s.deps, userId, pageSize) },
    // The media module's own interface for this one, over the harness's repository and volumes.
    media: { ...mediaForAccount(m.deps), purgeOwner: notHere, requestDeletion: notHere },
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  const collect = async (pieces: AsyncIterable<string>): Promise<string> => {
    let text = "";
    for await (const piece of pieces) text += piece;
    return text;
  };

  /** An auth account signed in on one device, with a profile of the same id in the public schema. */
  async function account() {
    const owner = await onboardedUser(h, authRepo, { password: "correct horse battery staple" });
    const handle = newHandle();
    const created = await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" });
    expect(created.ok).toBe(true);
    return { ...owner, handle };
  }

  /** A whole passkey registration through the 1c flow: the options, the software authenticator's answer and the verification; answers the stored view. */
  async function register(session: Session, auth: SoftAuthenticator, name: string | undefined, flags: SoftFlags) {
    const { options } = await registerOptions(h.deps, session, { label: "Owner" });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
    return (await registerVerify(h.deps, session, { name, response })).passkey;
  }

  test("an account with real uploads exports an archive whose images are the store's large.webp byte for byte, and whose JSON holds its rows and its passkeys without their keys", { timeout: 30_000 }, async () => {
    const owner = await account();
    const userId = owner.user.id;
    // A second live session on the same device, and a third one revoked: only the two live ones are listed.
    const second = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    const revoked = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await h.deps.sessions.revoke(revoked.issued.session.handle, userId);
    // Two passkeys a minute apart on the harness clock, both from the signed-in device: a synced one, used once since, and a plain one never used.
    const laptopAt = h.clock.now();
    const laptop = await register(owner.session, new SoftAuthenticator(), "Laptop", ALL);
    h.clock.advance(MINUTE);
    const plainAt = h.clock.now();
    await register(owner.session, new SoftAuthenticator(), undefined, BARE);
    const usedAt = new Date();
    expect(await authRepo.claimPasskeyUse(laptop.id, 1, true, usedAt)).toBe(true);
    // The handle left behind is reserved in handle_history; the export lists both.
    const renamed = newHandle();
    expect((await s.repo.changeHandle(userId, renamed, s.clock.next())).ok).toBe(true);

    const [imageA, imageB] = [await m.readyImage(userId, { width: 1600, height: 1200 }), await m.readyImage(userId, { width: 900, height: 1600 })];
    const post = await createPost(s.deps, userId, {
      body: "two photos",
      media: [
        { id: imageA, alt: "a harbour at dawn" },
        { id: imageB, alt: "a lighthouse" },
      ],
    });
    const reply = await createPost(s.deps, userId, { body: "a reply, soon deleted", replyToId: post.id, media: [] });
    await deletePost(s.deps, userId, reply.id);
    // A ready image on no post is still the account's upload; one still processing and one that failed have no file to export.
    const loose = await m.readyImage(userId);
    await upload(m.deps, userId, m.jpeg());
    const failed = (await upload(m.deps, userId, m.jpeg())).id;
    m.worker.failed(failed, "corrupt_image");
    await status(m.deps, userId, failed);

    const [bob, eve, carol] = await Promise.all([s.established(), s.established(), s.established()]);
    const bobsPost = await createPost(s.deps, bob.id, { body: "bob's post", media: [] });
    expect(await s.repo.like(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.repost(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.bookmark(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.follow(userId, bob.id, s.clock.next())).toBe(true);
    expect(await s.repo.block(userId, eve.id, s.clock.next())).toBe(true);
    expect(await s.repo.mute(userId, carol.id, s.clock.next())).toBe(true);
    await authRepo.appendEvent({ userId, type: "profile_updated" });

    const plan = await buildExport(deps(), userId, owner.session.handle, new Date());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${imageA}.webp`, `media/${imageB}.webp`, `media/${loose}.webp`].sort());
    for (const id of [imageA, imageB, loose]) {
      expect(Buffer.compare(Buffer.from(files[`media/${id}.webp`]!), readFileSync(m.files.store.image(id, "large"))), id).toBe(0);
    }
    const text = strFromU8(files["export.json"]!);
    const json = ExportFormat.parse(JSON.parse(text));
    expect(json.missingMedia).toEqual([]);

    expect(json.account).toMatchObject({ id: userId, email: owner.email, role: "user", mfaEnabled: false, hasPassword: true, verified: false, termsVersion: TEST_TERMS });
    expect(json.account.termsAcceptedAt).not.toBeNull();
    // Newest first, the times from the flows' clock and the use as it was written, and the device that added each by its label.
    expect(json.account.passkeys).toEqual([
      { name: "Passkey on the web", createdAt: plainAt.toISOString(), lastUsedAt: null, synced: false, createdOn: "Chrome on Windows" },
      { name: "Laptop", createdAt: laptopAt.toISOString(), lastUsedAt: usedAt.toISOString(), synced: true, createdOn: "Chrome on Windows" },
    ]);
    // In the archive's own text: exactly those five members, and nothing that identifies a key, not the passkey ids, the credential ids or the public keys.
    const raw = JSON.parse(text) as { account: { passkeys: Record<string, unknown>[] } };
    expect(raw.account.passkeys.map((passkey) => Object.keys(passkey))).toEqual(Array.from({ length: 2 }, () => ["name", "createdAt", "lastUsedAt", "synced", "createdOn"]));
    for (const row of await authRepo.listPasskeys(userId)) {
      for (const secret of [row.id, row.credentialId, row.publicKey]) expect(text, secret).not.toContain(secret);
    }
    // The archive's JSON is the document exactly as JSON.stringify writes it, the passkeys in their place inside the account.
    expect(text).toBe(JSON.stringify(raw, null, 2));
    // The live sessions under their handles, the ids the session list shows; the hash of a token, which is what the server
    // looks a session up by, is nowhere in the archive.
    expect(json.sessions.map((session) => session.id).sort()).toEqual([owner.session.handle, second.issued.session.handle].sort());
    expect(json.sessions.find((session) => session.id === owner.session.handle)!.current).toBe(true);
    expect(json.sessions.find((session) => session.id === second.issued.session.handle)!.current).toBe(false);
    for (const hash of [owner.session.sessionId, second.issued.session.sessionId, revoked.issued.session.sessionId]) expect(text, hash).not.toContain(hash);
    expect(json.devices).toHaveLength(1);
    expect(json.devices[0]!.platform).toBe("web");
    // The account's own events, newest first; the sign-ins are among them.
    expect(json.events[0]!.type).toBe("profile_updated");
    expect(json.events.map((event) => event.type)).toContain("signin_success");
    for (let i = 1; i < json.events.length; i++) expect(json.events[i]!.at <= json.events[i - 1]!.at).toBe(true);

    expect(json.profile).toMatchObject({ handle: renamed, displayName: "Owner", bio: "", handleHistory: [owner.handle, renamed] });
    expect(json.posts.map((p) => p.id)).toEqual([post.id, reply.id]);
    expect(json.posts[0]).toMatchObject({
      body: "two photos",
      state: "visible",
      deletedAt: null,
      media: [
        { id: imageA, file: `media/${imageA}.webp`, altText: "a harbour at dawn", width: 1600, height: 1200 },
        { id: imageB, file: `media/${imageB}.webp`, altText: "a lighthouse", width: 900, height: 1600 },
      ],
    });
    expect(json.posts[1]).toMatchObject({ body: "", state: "deleted_by_author", replyToId: post.id, media: [] });
    expect(json.posts[1]!.deletedAt).not.toBeNull();
    expect(json.likes.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.reposts.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.bookmarks.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.following).toEqual([{ handle: bob.handle, since: expect.any(String) }]);
    expect(json.blocks).toEqual([{ handle: eve.handle, since: expect.any(String) }]);
    expect(json.mutes).toEqual([{ handle: carol.handle, since: expect.any(String) }]);
  });

  test("the badge and two-factor are reported as held, an account without passkeys lists none; an unknown account or profile is refused", async () => {
    const owner = await account();
    await authRepo.setPhoneHash(owner.user.id, sha256Hex(randomToken()));
    await authRepo.enableTotp(owner.user.id, { secretEnc: "v1:test", recoveryCodesHash: ["a"], now: new Date() });
    const exported = await exportAccount(h.deps, owner.user.id);
    expect(exported.account).toMatchObject({ verified: true, mfaEnabled: true, hasPassword: true });
    // An account that never registered a passkey exports an empty list, not a missing one.
    expect(exported.passkeys).toEqual([]);

    const unknown = await exportAccount(h.deps, randomUUID()).catch((err: unknown) => err);
    expect(unknown).toBeInstanceOf(AuthError);
    expect((unknown as AuthError).code).toBe("invalid_credentials");
    const nobody = await exportProfile(s.deps, randomUUID()).catch((err: unknown) => err);
    expect(nobody).toBeInstanceOf(SocialError);
    expect((nobody as SocialError).code).toBe("not_found");
    expect(await m.deps.repo.readyImages(randomUUID())).toEqual([]);
  });

  test("export.json read in keyset pages of two is, byte for byte, the document read in pages of a thousand; rows that share a moment are neither lost nor repeated", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const [bob, ...others] = await Promise.all(Array.from({ length: 10 }, () => s.established()));
    const posts: string[] = [];
    for (let i = 0; i < 5; i++) posts.push(await newPost(s.repo, userId, s.clock.next(), `post ${i}`));
    const bobsPosts: string[] = [];
    for (let i = 0; i < 5; i++) bobsPosts.push(await newPost(s.repo, bob!.id, s.clock.next(), `bob ${i}`));
    // Five likes at one moment: within it the post id orders them, and a page may end between two of them.
    const moment = s.clock.next();
    for (const post of bobsPosts) expect(await s.repo.like(userId, post, moment)).toBe(true);
    // Three reposts a microsecond apart inside one millisecond, as a database default writes them: a page key cut to the
    // millisecond would read the same rows again or skip some.
    for (const [i, post] of bobsPosts.slice(0, 3).entries()) {
      await apiDb.execute(sql`insert into reposts (user_id, post_id, created_at) values (${userId}::uuid, ${post}::uuid, ${`2026-01-01T00:00:00.12345${i}Z`}::timestamptz)`);
    }
    for (const post of bobsPosts.slice(0, 4)) expect(await s.repo.bookmark(userId, post, s.clock.next())).toBe(true);
    for (const other of others.slice(0, 5)) expect(await s.repo.follow(userId, other.id, moment)).toBe(true);
    for (const other of others.slice(5, 8)) expect(await s.repo.block(userId, other.id, s.clock.next())).toBe(true);
    for (const other of others.slice(0, 3)) expect(await s.repo.mute(userId, other.id, s.clock.next())).toBe(true);

    const now = new Date();
    const paged = await collect(exportJson(await buildExport(deps(), userId, owner.session.handle, now, 2)));
    const whole = await collect(exportJson(await buildExport(deps(), userId, owner.session.handle, now)));
    expect(paged).toBe(whole);
    expect(paged).toBe(JSON.stringify(JSON.parse(paged), null, 2));
    const json = ExportFormat.parse(JSON.parse(paged));
    expect(json.posts.map((post) => post.id)).toEqual(posts);
    expect(json.likes.map((like) => like.postId)).toEqual([...bobsPosts].sort());
    expect(json.reposts.map((repost) => [repost.postId, repost.at])).toEqual(bobsPosts.slice(0, 3).map((post) => [post, "2026-01-01T00:00:00.123Z"]));
    expect(json.bookmarks.map((bookmark) => bookmark.postId)).toEqual(bobsPosts.slice(0, 4));
    const byId = (list: { id: string; handle: string }[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1)).map((profile) => profile.handle);
    expect(json.following.map((ref) => ref.handle)).toEqual(byId(others.slice(0, 5)));
    expect(json.blocks.map((ref) => ref.handle)).toEqual(others.slice(5, 8).map((profile) => profile.handle));
    expect(json.mutes.map((ref) => ref.handle)).toEqual(others.slice(0, 3).map((profile) => profile.handle));
  });
});
```

### Replace `apps/api/test/integration/account-takedown.test.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, profiles, users, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { purgePending } from "../../src/account/purge";
import { AuthError } from "../../src/auth/context";
import { confirmDeletion, finishPurge, startDeletion } from "../../src/auth/flows/deletion";
import { signIn } from "../../src/auth/flows/signin";
import { registerOptions, registerVerify, signInOptions, signInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, newTestDevice, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `t_${randomBytes(5).toString("hex")}`;
const ORIGIN = "http://localhost:8081";
const RP_ID = "localhost";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };

interface StepOneRows {
  live_sessions: number;
  sessions: number;
  devices: number;
  codes: number;
  events: number;
  passkeys: number;
  /** 1 while the account's WebAuthn user handle is set, 0 once the take-down cleared it. */
  user_handles: number;
}

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/**
 * Step 1 of an account deletion on real Postgres (1b design, section 7.6): the auth module marks the
 * account deleted, revokes its sessions, deletes its devices and codes and records the event in one
 * transaction, and the purge job's last step (the auth module's finishPurge) does the row side again for
 * an account marked deleted without the rest, as a take-down that stopped after the mark leaves it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: step 1 of an account deletion", () => {
  let apiDb: Db;
  let authDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    authRepo = createAuthRepo(authDb);
    h = flowHarness(authRepo, { profiles: createProfileStore(apiDb) });
    m = await mediaHarness(apiDb);
    s = socialHarness(apiDb);
  });
  afterAll(async () => {
    m.cleanup();
    await Promise.all([closeDb(apiDb), closeDb(authDb)]);
  });

  /** The account module's dependencies as the server composes them, with the auth side's last step through the auth module's own finishPurge. */
  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: (session, ctx) => startDeletion(h.deps, session, ctx),
      confirmDeletion: (session, input) => confirmDeletion(h.deps, session, input),
      pendingPurges: () => authRepo.pendingPurges(),
      finishPurge: (userId) => finishPurge(h.deps, userId),
      exportAccount: async () => {
        throw new Error("not exercised here");
      },
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: {
      purgeProfile: (userId, now, within) => s.repo.purgeProfile(userId, now, within),
      exportProfile: async () => {
        throw new Error("not exercised here");
      },
    },
    media: {
      purgeOwner: (tx, ownerId) => m.deps.repo.purgeOwner(tx, ownerId),
      requestDeletion: (ids) => m.files.requestDeletion(ids),
      exportImages: async () => [],
    },
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  /**
   * An account with a profile, signed in on two devices, with a code out for it and a passkey registered from the first
   * device (which also set the account's WebAuthn user handle), besides whatever the test asks for. The authenticator that
   * holds the passkey is answered too, for a sign-in with it later.
   */
  async function account() {
    const owner = await onboardedUser(h, authRepo);
    const handle = newHandle();
    expect((await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" })).ok).toBe(true);
    const other = await signIn(h.deps, owner.user, newTestDevice(), h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await authRepo.createEmailCode({ flowId: randomBytes(16).toString("hex"), email: owner.email, userId: owner.user.id, purpose: "reauth", codeHash: "h", expiresAt: new Date(Date.now() + 600_000), ipHash: "x" });
    const auth = new SoftAuthenticator();
    const { options } = await registerOptions(h.deps, owner.session, { label: "Owner" });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags: ALL });
    await registerVerify(h.deps, owner.session, { response });
    return { ...owner, handle, sessionIds: [owner.session.sessionId, other.issued.session.sessionId], auth, credentialId: response.id };
  }

  /** A whole passkey sign-in on the account's first device: fresh options, the authenticator's answer and the verification. */
  async function passkeySignIn(owner: Awaited<ReturnType<typeof account>>) {
    const { options } = await signInOptions(h.deps, h.ctx);
    const response = owner.auth.get({ credentialId: owner.credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    return signInVerify(h.deps, { deviceId: owner.device.deviceId, platform: "web", response }, h.ctx);
  }

  const stepOneRows = async (userId: string): Promise<StepOneRows> =>
    (
      (await authDb.execute(sql`select
        (select count(*)::int from auth.sessions where user_id = ${userId}::uuid and revoked_at is null) as live_sessions,
        (select count(*)::int from auth.sessions where user_id = ${userId}::uuid) as sessions,
        (select count(*)::int from auth.devices where user_id = ${userId}::uuid) as devices,
        (select count(*)::int from auth.email_codes where user_id = ${userId}::uuid) as codes,
        (select count(*)::int from auth.auth_events where user_id = ${userId}::uuid and type = 'account_deleted') as events,
        (select count(*)::int from auth.passkeys where user_id = ${userId}::uuid) as passkeys,
        (select count(*)::int from auth.users where id = ${userId}::uuid and webauthn_user_id is not null) as user_handles`)) as unknown as StepOneRows[]
    )[0]!;
  const authRow = async (id: string) => (await authDb.select().from(users).where(eq(users.id, id)))[0]!;

  test("one confirmation takes every row of step 1 down: the mark, the sessions with their tombstones, the devices, the codes, the passkeys with the WebAuthn user handle, and the event", { timeout: 30_000 }, async () => {
    const owner = await account();
    const { flowId } = await startDeletion(h.deps, owner.session, h.ctx);
    const code = h.mailer.lastCodeFor(owner.email)!;
    expect(await stepOneRows(owner.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 2, events: 0, passkeys: 1, user_handles: 1 });

    await confirmDeletion(h.deps, owner.session, { flowId, code, handle: owner.handle });

    expect(await stepOneRows(owner.user.id)).toEqual({ live_sessions: 0, sessions: 0, devices: 0, codes: 0, events: 1, passkeys: 0, user_handles: 0 });
    const row = await authRow(owner.user.id);
    expect(row.deletedAt).not.toBeNull();
    // Only step 1 ran: the purge anonymises the row later.
    expect([row.email, row.purgedAt]).toEqual([owner.email, null]);
    for (const id of owner.sessionIds) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(await authRepo.pendingPurges()).toContain(owner.user.id);
  });

  test("the take-down is one transaction: when its last statement fails, the mark and every row are still as they were", { timeout: 30_000 }, async () => {
    const owner = await account();
    // The event's device column is a uuid, so this device id makes the transaction's last statement fail.
    await expect(authRepo.takeDown(owner.user.id, new Date(), "not-a-uuid")).rejects.toThrow();
    // The passkey and the user handle are written before the event: both are back, so they went in the same transaction.
    expect(await stepOneRows(owner.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0, passkeys: 1, user_handles: 1 });
    expect((await authRow(owner.user.id)).deletedAt).toBeNull();
    expect(await authRepo.findUserById(owner.user.id)).toBeDefined();
    expect(await authRepo.findActiveSession(owner.session.sessionId, new Date())).toBeDefined();
  });

  test("one round of the purge job fully takes down an account marked deleted by hand with its sessions, devices, codes and passkey still there", { timeout: 30_000 }, async () => {
    const ghost = await account();
    const alive = await account();
    await authRepo.markDeleted(ghost.user.id, new Date(Date.now() - 60_000));
    expect(await stepOneRows(ghost.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0, passkeys: 1, user_handles: 1 });

    const report = await purgePending(deps());
    expect(report.failed).toBe(0);
    expect(report.purged).toBeGreaterThanOrEqual(1);

    expect(await stepOneRows(ghost.user.id)).toEqual({ live_sessions: 0, sessions: 0, devices: 0, codes: 0, events: 0, passkeys: 0, user_handles: 0 });
    for (const id of ghost.sessionIds) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(await authRow(ghost.user.id)).toMatchObject({ email: `deleted:${ghost.user.id}`, emailVerifiedAt: null, termsVersion: null });
    expect((await authRow(ghost.user.id)).purgedAt).not.toBeNull();
    expect((await apiDb.select().from(profiles).where(eq(profiles.id, ghost.user.id)))[0]).toMatchObject({ displayName: "Deleted account", handle: ghost.handle });
    expect(await authRepo.pendingPurges()).not.toContain(ghost.user.id);

    // A live account is not the job's business: its rows stay as they were.
    expect(await stepOneRows(alive.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0, passkeys: 1, user_handles: 1 });
    expect(await authRepo.findActiveSession(alive.session.sessionId, new Date())).toBeDefined();
    // The last step on its own, again or for a live account, changes nothing.
    const purged = await authRow(ghost.user.id);
    await finishPurge(h.deps, ghost.user.id);
    await finishPurge(h.deps, alive.user.id);
    expect(await authRow(ghost.user.id)).toEqual(purged);
    expect(await stepOneRows(alive.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0, passkeys: 1, user_handles: 1 });
    expect(await authRow(alive.user.id)).toMatchObject({ email: alive.email, deletedAt: null, purgedAt: null });
  });

  test("a deleted account's passkey signs nobody in: passkey_invalid after the take-down, and still after the purge", { timeout: 30_000 }, async () => {
    const owner = await account();
    // While the account lives, the passkey signs in on the device that registered it.
    expect((await passkeySignIn(owner)).kind).toBe("session");

    const { flowId } = await startDeletion(h.deps, owner.session, h.ctx);
    await confirmDeletion(h.deps, owner.session, { flowId, code: h.mailer.lastCodeFor(owner.email)!, handle: owner.handle });
    // The passkey row went with the take-down and the handle with it, so the credential is one korbat has never seen, whatever the assertion says.
    expect(await stepOneRows(owner.user.id)).toMatchObject({ passkeys: 0, user_handles: 0 });
    expect(await failure(passkeySignIn(owner))).toMatchObject({ code: "passkey_invalid", status: 401 });

    await finishPurge(h.deps, owner.user.id);
    expect((await authRow(owner.user.id)).purgedAt).not.toBeNull();
    expect(await stepOneRows(owner.user.id)).toMatchObject({ passkeys: 0, user_handles: 0 });
    expect(await failure(passkeySignIn(owner))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });
});
```

### Replace `apps/api/test/integration/auth-flows-account.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, type Db } from "@korbat/db";
import { grantRole } from "../../src/auth/admin";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "../../src/auth/flows/account";
import { startEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate, startReauthEmail } from "../../src/auth/flows/reauth";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, type Session } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { currentTotpCode, flowHarness, newTestDevice, newTestEmail, onboardedUser, wrongCode, type FlowHarness } from "./flow-harness";

const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

describe.skipIf(!process.env.INTEGRATION)("integration: re-authentication, account and session flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Turns TOTP on for an account as the confirm step leaves it, with recovery codes, and answers the codes in the clear. */
  async function enableTotp(h: FlowHarness, userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(h.deps.config.authHmacKey, code)),
      now: h.clock.now(),
    });
    await h.deps.sessions.forgetUser(userId);
    return codes;
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("re-authenticating with the password or a TOTP code writes the factor, rotates the token and answers the level reached; wrong credentials do not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableTotp(h, account.user.id);
    let token = account.token;
    const current = async () => (await h.deps.sessions.resolve(token))!.session;
    const stale = async () => {
      h.clock.advance(REAUTH_WINDOW_MS + 1_000);
      const session = await current();
      expect(h.deps.sessions.isFresh(session)).toBe(false);
      return session;
    };

    let session = await stale();
    await expect(reauthenticate(h.deps, session, { method: "password", password: "wrong password entirely" }, h.ctx)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.deps.sessions.isFresh(await current())).toBe(false);
    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword).toMatchObject({ level: 1, mustReenrollMfa: false });
    // The factor is written with the flows' clock, the reauth time follows it, and the token rotates in place: same handle, same device.
    expect(byPassword.issued.session).toMatchObject({ handle: session.handle, deviceId: session.deviceId, factors: { ...session.factors, password: h.clock.ms() }, reauthAt: h.clock.now() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byPassword.issued.token;
    expect(h.deps.sessions.isFresh(await current())).toBe(true);

    session = await current();
    const code = await currentTotpCode(h, repo, account.user.id);
    await expect(reauthenticate(h.deps, session, { method: "totp", code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    const byTotp = await reauthenticate(h.deps, session, { method: "totp", code }, h.ctx);
    // With the password still in the window, the code makes level 2.
    expect(byTotp).toMatchObject({ level: 2, mustReenrollMfa: false });
    expect(byTotp.issued.session.factors).toEqual({ ...session.factors, totp: h.clock.ms() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byTotp.issued.token;

    // Five minutes later a code alone is level 1 again: the first factor must be as recent as the second.
    session = await stale();
    const alone = await reauthenticate(h.deps, session, { method: "totp", code: await currentTotpCode(h, repo, account.user.id) }, h.ctx);
    expect(alone.level).toBe(1);
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(alone.issued.token))!.session)).toBe(1);
  });

  test("re-authenticating by email accepts only a re-auth code for this account, once, and sends three codes an hour per session", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const other = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;

    const { flowId } = await startReauthEmail(h.deps, session, h.ctx);
    const reauthMail = h.mailer.sent.at(-1)!;
    expect(reauthMail).toMatchObject({ to: account.email, template: "reauth_code" });
    const reauthCode = reauthMail.data.code!;

    const otherSession = (await h.deps.sessions.resolve(other.token))!.session;
    const otherFlow = await startReauthEmail(h.deps, otherSession, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: otherFlow.flowId, code: h.mailer.lastCodeFor(other.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const signInFlow = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: signInFlow.flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const byEmail = await reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode }, h.ctx);
    expect(byEmail).toMatchObject({ level: 1, mustReenrollMfa: false });
    expect(byEmail.issued.session).toMatchObject({ handle: session.handle, factors: { email: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(byEmail.issued.token))!.session)).toBe(true);
    await expect(reauthenticate(h.deps, byEmail.issued.session, { method: "email", flowId, code: reauthCode }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });

    // Three codes an hour, counted by the session's handle, which the rotation kept; another session of the account has three of its own.
    for (let i = 0; i < 2; i++) await startReauthEmail(h.deps, byEmail.issued.session, h.ctx);
    await expect(startReauthEmail(h.deps, byEmail.issued.session, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: HOUR / 1000 });
    const second = await h.deps.sessions.issue(account.user.id, session.deviceId, { factors: { email: h.clock.ms() } });
    expect((await startReauthEmail(h.deps, second.session, h.ctx)).flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("re-authentication allows five tries per session every 15 minutes, counted by the handle so two sessions of one account share nothing and a rotation resets nothing", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, h.ctx);
    for (let i = 0; i < 5; i++) await expect(wrong(account.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(reauthenticate(h.deps, account.session, { method: "password", password: PASSWORD }, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });

    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const ok = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(ok.level).toBe(1);
    // The success counted as one of the five, and the rotated session carries the count on: four more tries, then the limit.
    for (let i = 0; i < 4; i++) await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("re-authentication allows thirty tries per address every 15 minutes, whichever sessions try", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const ctx = { ...h.ctx, ipHash: randomToken() };
    const newSession = async () => (await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } })).session;
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, ctx);
    // Six sessions, five tries each: none reaches its own limit, together they reach the address's.
    for (let s = 0; s < 6; s++) {
      const session = await newSession();
      for (let i = 0; i < 5; i++) await expect(wrong(session)).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(wrong(await newSession())).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address is not affected.
    await expect(reauthenticate(h.deps, await newSession(), { method: "email", flowId: randomToken(), code: "000000" }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("a recovery code re-authenticates an account with TOTP once, makes level 2 after a password, and is recorded and announced", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const without = await onboardedUser(h, repo, { password: PASSWORD });
    await expect(reauthenticate(h.deps, without.session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "mfa_required", status: 400 });

    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const codes = await enableTotp(h, account.user.id);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    // A wrong code is refused, recorded as a failed sign-in by recovery code, and rotates nothing.
    await expect(reauthenticate(h.deps, session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code", status: 401 });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();

    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword.level).toBe(1);
    const byCode = await reauthenticate(h.deps, byPassword.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx);
    expect(byCode).toMatchObject({ level: 2, mustReenrollMfa: true });
    expect(byCode.issued.session).toMatchObject({ handle: session.handle, factors: { ...byPassword.issued.session.factors, recovery: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(byPassword.issued.token)).toBeNull();
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(byCode.issued.token))!.session)).toBe(2);
    // The code is spent.
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    await expect(reauthenticate(h.deps, byCode.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "signin_failure").map((e) => [e.ipHash, e.metadata])).toEqual([
      [h.ctx.ipHash, { method: "recovery_code" }],
      [h.ctx.ipHash, { method: "recovery_code" }],
    ]);
    expect(events.filter((e) => e.type === "recovery_code_used").map((e) => [e.deviceId, e.ipHash])).toEqual([[account.session.deviceId, h.ctx.ipHash]]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("me describes the signed-in account and its profile", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await h.deps.profiles.create({ id: account.user.id, handle: "me_test", displayName: "Me Test" });
    expect(await me(h.deps, account.session)).toEqual({
      user: { id: account.user.id, email: account.email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: true, passkeys: 0 },
      profile: { id: account.user.id, handle: "me_test", displayName: "Me Test", handleChangedAt: null, verified: false },
    });
  });

  test("sessions can be listed, revoked one at a time, signed out, and revoked all at once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const third = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });

    // Each session is listed under its handle, the id a rotation keeps; the hash of a token is never listed.
    const { sessions } = await listSessions(h.deps, account.session);
    expect(sessions.map((s) => s.id).sort()).toEqual([account.session.handle, second.session.handle, third.session.handle].sort());
    expect(sessions.filter((s) => s.current).map((s) => s.id)).toEqual([account.session.handle]);

    // The listed session re-authenticates before the revoke lands, so its token rotates: the listed id still names it.
    const rotated = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(await h.deps.sessions.resolve(second.token)).toBeNull();
    expect(await h.deps.sessions.resolve(rotated.issued.token)).not.toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(true);
    expect(await h.deps.sessions.resolve(rotated.issued.token)).toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(false);
    expect(await revokeSession(h.deps, account.session, randomUUID())).toBe(false);
    // Another account's session is not this one's to revoke.
    const stranger = await onboardedUser(h, repo);
    expect(await revokeSession(h.deps, account.session, stranger.session.handle)).toBe(false);
    expect(await h.deps.sessions.resolve(stranger.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "session_revoked")).toEqual([
      { type: "session_revoked", deviceId: account.session.deviceId, ipHash: null, metadata: { handle: second.session.handle } },
    ]);

    // Signing out after a rotation ends the session under its new token.
    const thirdRotated = await h.deps.sessions.rotate(third.session);
    await signOut(h.deps, thirdRotated.session);
    expect(await h.deps.sessions.resolve(thirdRotated.token)).toBeNull();

    const fourth = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(await revokeAllSessions(h.deps, account.session)).toBe(2);
    expect(h.mailer.sent.filter((m) => m.template === "sessions_revoked_all").map((m) => m.data.count)).toEqual(["2"]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' locks the account down (every session and device, the password) once, and only for the address it was sent to", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const link = async (stored: NotMeToken) => {
      const token = randomToken();
      await h.kv.set(notMeKey(token), JSON.stringify(stored), 60_000);
      return token;
    };
    const key = h.deps.config.authHmacKey;
    const token = await link({ userId: account.user.id, deviceId: account.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, account.email) });

    await notMe(h.deps, { token }, h.ctx);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.ipHash, e.metadata])).toEqual([
      [account.session.deviceId, h.ctx.ipHash, { passkeysRemoved: [], totpCleared: false, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });

    // A link sent to an address the account has since left does nothing but refuse, and is not spent by the refusal.
    const moved = await onboardedUser(h, repo, { password: PASSWORD });
    const stale = await link({ userId: moved.user.id, deviceId: moved.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, moved.email) });
    await repo.changeEmail(moved.user.id, newTestEmail("moved"), h.clock.now());
    for (let i = 0; i < 2; i++) await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await h.deps.sessions.resolve(moved.token)).not.toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).not.toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type)).not.toContain("not_me");
    // Once the account is back at the address the alert went to, as the email undo puts it, the link works, once.
    await repo.changeEmail(moved.user.id, moved.email, h.clock.now());
    await notMe(h.deps, { token: stale }, h.ctx);
    expect(await h.deps.sessions.resolve(moved.token)).toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type).filter((type) => type === "not_me")).toHaveLength(1);
    await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("granting a role signs the account out everywhere so the new role applies at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    expect(await grantRole(h.deps, account.email.toUpperCase(), "moderator")).toEqual({ userId: account.user.id, previousRole: "user" });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    const again = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(again.session).toMatchObject({ role: "moderator", mfaEnabled: false });
    await expect(grantRole(h.deps, "nobody-at-all@korbat.local", "admin")).rejects.toThrow(/no account/);
  });
});
```

### Replace `apps/api/test/integration/auth-flows-mfa.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { hash } from "@node-rs/argon2";
import { decrypt, parseVersionedKey, randomToken } from "../../src/auth/crypto";
import { startEmail, verifyEmail } from "../../src/auth/flows/email";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "../../src/auth/flows/mfa";
import { passwordSignIn, setPassword } from "../../src/auth/flows/password";
import { BreachCheckUnavailable, hashPassword, needsRehash } from "../../src/auth/passwords";
import { hashRecoveryCode } from "../../src/auth/recovery-codes";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS } from "../../src/auth/sessions";
import { currentStep, hotp } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import {
  currentTotpCode,
  flowHarness,
  newTestDevice,
  newTestEmail,
  onboardedUser,
  wrongCode,
  type FlowHarness,
  type OnboardedUser,
} from "./flow-harness";

const PASSWORD = "correct horse battery staple";

describe.skipIf(!process.env.INTEGRATION)("integration: password and MFA flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  async function enableMfa(h: FlowHarness, account: OnboardedUser) {
    await setupTotp(h.deps, account.session);
    // The pending secret is kept for the session's handle, which a rotation keeps (1c design, section 2).
    const pending = (await h.kv.get(`totp-pending:${account.session.handle}`))!;
    const secret = new Uint8Array(decrypt(pending, [h.deps.config.totpKey]));
    return confirmTotp(h.deps, account.session, { code: hotp(secret, currentStep(h.clock.ms())) });
  }

  /** Signs in by email code (after the resend cooldown) and returns the MFA ticket. */
  async function mfaTicketByEmail(h: FlowHarness, account: OnboardedUser) {
    h.clock.advance(61_000);
    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...account.device }, h.ctx);
    const outcome = await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx);
    if (outcome.kind !== "mfa") throw new Error(`expected an MFA ticket, got ${outcome.kind}`);
    return outcome.mfaTicket;
  }

  test("password sign-in succeeds; unknown emails, accounts without a password and wrong passwords get the same error", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const withPassword = await onboardedUser(h, repo, { password: PASSWORD });
    const withoutPassword = await onboardedUser(h, repo);
    const attempt = (email: string, password: string, turnstileToken = "ok") =>
      passwordSignIn(h.deps, { email, password, turnstileToken, ...newTestDevice() }, h.ctx);

    expect((await attempt(withPassword.email, PASSWORD)).kind).toBe("session");
    for (const [email, password] of [
      [newTestEmail(), PASSWORD],
      [withoutPassword.email, PASSWORD],
      [withPassword.email, "wrong password entirely"],
    ] as const) {
      await expect(attempt(email, password)).rejects.toMatchObject({ code: "invalid_credentials", status: 401 });
    }
    await expect(attempt(withPassword.email, PASSWORD, "fail")).rejects.toMatchObject({ code: "turnstile_failed" });
  });

  test("five wrong passwords lock password sign-in for 15 minutes and email the owner; email-code sign-in keeps working", { timeout: 60_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const attempt = (password: string) =>
      passwordSignIn(h.deps, { email: account.email, password, turnstileToken: "ok", ...account.device }, h.ctx);

    for (let i = 0; i < 5; i++) await expect(attempt("wrong password entirely")).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(attempt(PASSWORD)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.mailer.sent.filter((m) => m.template === "account_locked")).toHaveLength(1);

    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...account.device }, h.ctx);
    expect((await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).kind).toBe("session");

    h.clock.advance(16 * 60_000);
    expect((await attempt(PASSWORD)).kind).toBe("session");
  });

  test("password sign-in timing does not reveal whether an email has an account", { timeout: 120_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const time = async (email: string) => {
      const startedAt = performance.now();
      await passwordSignIn(
        h.deps,
        { email, password: "wrong password entirely", turnstileToken: "ok", ...newTestDevice() },
        { ...h.ctx, ipHash: randomToken() },
      ).catch(() => undefined);
      return performance.now() - startedAt;
    };
    const unknown: number[] = [];
    const known: number[] = [];
    for (let i = 0; i < 10; i++) {
      unknown.push(await time(newTestEmail()));
      known.push(await time(account.email));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    expect(Math.abs(median(unknown) - median(known))).toBeLessThan(50);
  });

  test("setting a password enforces length and breach rules, fails closed when the check is down, and rotates the session", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);

    await expect(setPassword(h.deps, account.session, { password: "short" })).rejects.toMatchObject({ code: "password_too_short" });
    await expect(setPassword(h.deps, account.session, { password: "a".repeat(129) })).rejects.toMatchObject({ code: "password_too_long" });
    await expect(setPassword(h.deps, account.session, { password: "breached password 123" })).rejects.toMatchObject({ code: "password_breached" });

    const realChecker = h.deps.breachChecker;
    h.deps.breachChecker = {
      isBreached: async () => {
        throw new BreachCheckUnavailable("offline");
      },
    };
    await expect(setPassword(h.deps, account.session, { password: PASSWORD })).rejects.toMatchObject({ code: "password_check_unavailable", status: 503 });
    h.deps.breachChecker = realChecker;
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();

    const rotated = await setPassword(h.deps, account.session, { password: PASSWORD });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(rotated.token)).not.toBeNull();
    await setPassword(h.deps, rotated.session, { password: `${PASSWORD} again` });
    expect(h.mailer.sent.filter((m) => m.template === "password_changed").map((m) => m.to)).toEqual([account.email, account.email]);
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["password_set", "password_changed"]));
  });

  test("MFA setup: a wrong code keeps it off; the right code turns it on, returns 10 recovery codes and rotates the session", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const setup = await setupTotp(h.deps, account.session);
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/korbat:account\?secret=/);
    expect(setup.qrSvg.startsWith("<svg")).toBe(true);

    const pending = (await h.kv.get(`totp-pending:${account.session.handle}`))!;
    const right = hotp(new Uint8Array(decrypt(pending, [h.deps.config.totpKey])), currentStep(h.clock.ms()));
    await expect(confirmTotp(h.deps, account.session, { code: wrongCode(right) })).rejects.toMatchObject({ code: "invalid_mfa_code" });
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).toBeNull();

    const confirmed = await confirmTotp(h.deps, account.session, { code: right });
    expect(confirmed.recoveryCodes).toHaveLength(10);
    // The code proved the new secret, so the session gains the totp factor; the token rotates in place and the cached copy knows MFA is on.
    expect(confirmed.issued.session).toMatchObject({
      mfaEnabled: true,
      handle: account.session.handle,
      factors: { ...account.session.factors, totp: h.clock.ms() },
      reauthAt: h.clock.now(),
    });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect((await h.deps.sessions.resolve(confirmed.issued.token))!.session).toEqual(confirmed.issued.session);
    expect(await h.kv.get(`totp-pending:${account.session.handle}`)).toBeNull();
    const stored = (await repo.findUserById(account.user.id))!;
    expect(stored.totpEnabledAt).toEqual(h.clock.now());
    expect(stored.totpSecretEnc).toMatch(/^v1:/);
    expect(stored.recoveryCodesHash).toHaveLength(10);
    expect(stored.recoveryCodesHash).not.toContain(confirmed.recoveryCodes[0]);
  });

  test("two confirmations of one setup at once turn two-factor on once: the recovery codes the one answer shows are the ones stored, and the other is refused before it writes", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    await setupTotp(h.deps, account.session);
    const pending = (await h.kv.get(`totp-pending:${account.session.handle}`))!;
    const code = hotp(new Uint8Array(decrypt(pending, [h.deps.config.totpKey])), currentStep(h.clock.ms()));
    // A double submit: the same session and the same code, twice at once. Each read of the pending secret waits for the
    // other, so both requests hold it before either goes on, whatever the database's timing.
    const get = h.kv.get.bind(h.kv);
    let readers = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    h.kv.get = async (key) => {
      const value = await get(key);
      if (key === `totp-pending:${account.session.handle}`) {
        if (++readers === 2) release();
        await bothRead;
      }
      return value;
    };
    const outcomes = await Promise.allSettled([confirmTotp(h.deps, account.session, { code }), confirmTotp(h.deps, account.session, { code })]);
    h.kv.get = get;
    expect(readers).toBe(2);
    const won = outcomes.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof confirmTotp>>> => o.status === "fulfilled");
    const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect([won.length, lost.length]).toEqual([1, 1]);
    expect(lost[0]!.reason).toMatchObject({ code: "invalid_mfa_code", status: 400, message: "Two-factor setup expired. Start again." });

    const stored = (await repo.findUserById(account.user.id))!;
    expect(stored.recoveryCodesHash).toEqual(won[0]!.value.recoveryCodes.map((recoveryCode) => hashRecoveryCode(h.deps.config.authHmacKey, recoveryCode)));
    expect(stored).toMatchObject({ totpSecretEnc: pending, totpEnabledAt: h.clock.now() });
    expect((await repo.recentEvents(account.user.id)).filter((e) => e.type === "mfa_enabled")).toHaveLength(1);
    expect(h.mailer.sent.filter((m) => m.template === "mfa_enabled").map((m) => m.to)).toEqual([account.email]);
    // One rotation: the old token is dead, and the token the one answer carries is the session's.
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect((await h.deps.sessions.resolve(won[0]!.value.issued.token))!.session).toMatchObject({ handle: account.session.handle, mfaEnabled: true, factors: { ...account.session.factors, totp: h.clock.ms() } });
    // Every recovery code shown works; the first one proves it at the next sign-in.
    const signed = await verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: won[0]!.value.recoveryCodes[0]! }, h.ctx);
    expect(signed.mustReenrollMfa).toBe(true);
  });

  test("MFA sign-in accepts a current code once, rejects a replay, and voids a ticket after five wrong codes", { timeout: 60_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableMfa(h, account);

    const firstTicket = await mfaTicketByEmail(h, account);
    const code = await currentTotpCode(h, repo, account.user.id);
    const signed = await verifyMfa(h.deps, { mfaTicket: firstTicket, code }, h.ctx);
    expect(signed.issued.session.mfaEnabled).toBe(true);
    expect(signed.mustReenrollMfa).toBe(false);
    await expect(verifyMfa(h.deps, { mfaTicket: firstTicket, code }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const ticketByPassword = async () => {
      const outcome = await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx);
      if (outcome.kind !== "mfa") throw new Error("expected an MFA ticket");
      return outcome.mfaTicket;
    };
    await expect(verifyMfa(h.deps, { mfaTicket: await ticketByPassword(), code }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const ticket = await ticketByPassword();
    for (let i = 0; i < 5; i++) {
      await expect(verifyMfa(h.deps, { mfaTicket: ticket, code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    }
    await expect(verifyMfa(h.deps, { mfaTicket: ticket, code }, h.ctx)).rejects.toMatchObject({ code: "too_many_attempts" });
    await expect(verifyMfa(h.deps, { mfaTicket: ticket, code }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
  });

  test("a recovery code signs in once, asks for MFA to be set up again, is recorded with the device and announced, and cannot be reused", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const { recoveryCodes } = await enableMfa(h, account);

    const signed = await verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]!.toUpperCase() }, h.ctx);
    expect(signed.mustReenrollMfa).toBe(true);
    expect(signed.issued.session.factors).toMatchObject({ email: h.clock.ms(), recovery: h.clock.ms() });
    await expect(verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_mfa_code",
    });
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    // The event names the device the session was issued on, as the re-authentication path's does; the owner is told once, whichever path spent the code.
    const used = (await repo.recentEvents(account.user.id)).filter((e) => e.type === "recovery_code_used");
    expect(used.map((e) => e.deviceId)).toEqual([signed.issued.session.deviceId]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("recovery codes can be regenerated; turning MFA off takes no code (the re-authentication spent it), and is refused for staff and for an account without it", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const { recoveryCodes, issued } = await enableMfa(h, account);

    const regenerated = await regenerateRecoveryCodes(h.deps, issued.session);
    expect(regenerated).toHaveLength(10);
    expect(regenerated).not.toContain(recoveryCodes[0]);
    await expect(verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_mfa_code",
    });

    await repo.setRole(account.user.id, "moderator");
    const staff = await h.deps.sessions.issue(account.user.id, issued.session.deviceId, { factors: { email: h.clock.ms(), totp: h.clock.ms() } });
    await expect(disableTotp(h.deps, staff.session)).rejects.toMatchObject({ code: "staff_mfa_required" });
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).not.toBeNull();

    await repo.setRole(account.user.id, "user");
    const regular = await h.deps.sessions.issue(account.user.id, issued.session.deviceId, { factors: { email: h.clock.ms(), totp: h.clock.ms() } });
    await disableTotp(h.deps, regular.session);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ totpEnabledAt: null, totpSecretEnc: null, recoveryCodesHash: [] });
    expect((await h.deps.sessions.resolve(regular.token))!.session.mfaEnabled).toBe(false);
    await expect(disableTotp(h.deps, regular.session)).rejects.toMatchObject({ code: "mfa_required", status: 400 });
  });

  test("setup needs a fresh session and, once two-factor is on, level 2; confirmation needs only the pending secret, even six minutes later; the owner is told when it turns on or off", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const stale = (await h.deps.sessions.resolve(account.token))!.session;
    await expect(setupTotp(h.deps, stale)).rejects.toMatchObject({ code: "reauth_required", status: 403, details: { level: 1, have: [] } });
    // Without a setup there is no pending secret, whatever the code says.
    await expect(confirmTotp(h.deps, stale, { code: "000000" })).rejects.toMatchObject({ code: "invalid_mfa_code", message: "Two-factor setup expired. Start again." });

    await h.deps.sessions.addFactor(stale.sessionId, "email");
    const fresh = (await h.deps.sessions.resolve(account.token))!.session;
    await setupTotp(h.deps, fresh);
    const pending = (await h.kv.get(`totp-pending:${fresh.handle}`))!;
    const secret = new Uint8Array(decrypt(pending, [h.deps.config.totpKey]));
    // Scanning the QR code took a while: the session is no longer fresh, and the confirmation does not care.
    h.clock.advance(6 * 60_000);
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(account.token))!.session)).toBe(false);
    const { issued } = await confirmTotp(h.deps, fresh, { code: hotp(secret, currentStep(h.clock.ms())) });
    expect(issued.session).toMatchObject({ mfaEnabled: true, factors: { ...fresh.factors, totp: h.clock.ms() } });
    expect(h.mailer.sent.filter((m) => m.template === "mfa_enabled").map((m) => m.to)).toEqual([account.email]);

    // Now that the account has TOTP, replacing the secret needs level 2: an email code alone is refused, with a TOTP code beside it accepted.
    const onlyEmail = await h.deps.sessions.issue(account.user.id, fresh.deviceId, { factors: { email: h.clock.ms() } });
    await expect(setupTotp(h.deps, onlyEmail.session)).rejects.toMatchObject({ code: "reauth_required", status: 403, details: { level: 2, have: ["email"] } });
    await h.deps.sessions.addFactor(onlyEmail.session.sessionId, "totp");
    const strong = (await h.deps.sessions.resolve(onlyEmail.token))!.session;
    expect((await setupTotp(h.deps, strong)).otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    await disableTotp(h.deps, issued.session);
    expect(h.mailer.sent.filter((m) => m.template === "mfa_disabled")).toHaveLength(1);
    expect((await h.deps.sessions.resolve(issued.token))!.session.mfaEnabled).toBe(false);
  });

  test("a secret encrypted with a previous key still verifies and is re-encrypted with the current key", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    await enableMfa(h, account);
    const v1 = h.deps.config.totpKey;
    const v2 = parseVersionedKey(`v2:${Buffer.alloc(32, 9).toString("base64")}`);
    h.deps.config = { ...h.deps.config, totpKey: v2, totpPreviousKeys: [v1] };

    const before = (await repo.findUserById(account.user.id))!;
    const ticket = await mfaTicketByEmail(h, account);
    const code = hotp(new Uint8Array(decrypt(before.totpSecretEnc!, [v1])), currentStep(h.clock.ms()));
    expect((await verifyMfa(h.deps, { mfaTicket: ticket, code }, h.ctx)).issued.session.mfaEnabled).toBe(true);
    const after = (await repo.findUserById(account.user.id))!;
    expect(after.totpSecretEnc).toMatch(/^v2:/);
    expect(decrypt(after.totpSecretEnc!, [v2])).toEqual(decrypt(before.totpSecretEnc!, [v1]));
  });

  test("a password hashed with older parameters is re-hashed on the next sign-in", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const weak = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    await repo.setPasswordHash(account.user.id, weak, new Date());
    expect(needsRehash(weak)).toBe(true);
    expect((await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx)).kind).toBe("session");
    const stored = (await repo.findUserById(account.user.id))!.passwordHash!;
    expect(needsRehash(stored)).toBe(false);
    expect(stored).not.toBe(weak);
  });

  test("hashPassword output is accepted by password sign-in on a fresh account", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    await repo.setPasswordHash(account.user.id, await hashPassword(PASSWORD), new Date());
    expect((await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx)).kind).toBe("session");
  });
});
```

### Replace `apps/api/test/integration/auth-janitor.test.ts` (whole file)

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

    const old = await h.deps.sessions.issue(user.id, device.id, { factors: { email: now.getTime() } });
    await repo.revokeSession(old.session.handle, user.id, new Date(now.getTime() - SESSION_RETENTION_MS - DAY));
    const live = await h.deps.sessions.issue(user.id, device.id, { factors: { email: now.getTime() } });

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

### Replace `apps/api/test/integration/auth-lockdown.test.ts` (whole file)

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, passkeys, sessions, type Db } from "@korbat/db";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { startEmail, verifyEmail } from "../../src/auth/flows/email";
import { emailRevertKey, revertEmailChange, startEmailChange, verifyEmailChange } from "../../src/auth/flows/email-change";
import { LOCKDOWN_LOOKBACK_MS, lockdown } from "../../src/auth/flows/lockdown";
import { notMe } from "../../src/auth/flows/not-me";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR } from "../../src/auth/limits";
import { createAuthRepo, type AuthEventType, type AuthRepo } from "../../src/auth/repo";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { flowHarness, newTestDevice, newTestEmail, onboardedUser, type FlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

/**
 * The lockdown against the real repository (1c design, sections 2 and 7.6), and the two links that run it in
 * this task: the new-device alert's "not me" and the email undo. Passkey rows are written directly, since no
 * flow adds one yet.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the lockdown and the links that run it", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** A passkey of the account created at `createdAt`, as a registration would write it; answers its id. */
  async function newPasskey(userId: string, createdAt: Date): Promise<string> {
    const [row] = await db.insert(passkeys).values({ userId, credentialId: randomToken(), publicKey: "cose-key", name: "Passkey", createdAt }).returning({ id: passkeys.id });
    return row!.id;
  }
  const passkeyIds = async (userId: string) => (await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId))).map((row) => row.id).sort();

  /** TOTP on since `enabledAt`, as the confirm step leaves it; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(h: FlowHarness, userId: string, enabledAt: Date) {
    await repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey), recoveryCodesHash: ["owner-code"], now: enabledAt });
    await h.deps.sessions.forgetUser(userId);
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("revokes every session and device, clears the password, removes the passkeys from the day before the anchor on and the one named, turns off two-factor from then on, and records it; run again, it finds nothing more", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const bystander = await onboardedUser(h, repo, { password: PASSWORD });
    const anchor = new Date(h.clock.ms() + 3 * DAY);
    const since = new Date(anchor.getTime() - LOCKDOWN_LOOKBACK_MS);
    const kept = await newPasskey(account.user.id, new Date(since.getTime() - 1));
    const named = await newPasskey(account.user.id, new Date(since.getTime() - 10 * DAY));
    const atSince = await newPasskey(account.user.id, since);
    const later = await newPasskey(account.user.id, new Date(anchor.getTime() + HOUR));
    const bystanders = await newPasskey(bystander.user.id, since);
    await withTotp(h, account.user.id, since);
    await withTotp(h, bystander.user.id, since);
    h.clock.advance(4 * DAY);

    const report = await lockdown(h.deps, { userId: account.user.id, anchor, passkeyIds: [named, bystanders], caller: { type: "not_me", deviceId: account.session.deviceId }, ctx: h.ctx });
    expect([...report.passkeysRemoved].sort()).toEqual([named, atSince, later].sort());
    expect(report).toMatchObject({ totpCleared: true, passwordCleared: true });
    expect(await passkeyIds(account.user.id)).toEqual([kept]);
    expect(await passkeyIds(bystander.user.id)).toEqual([bystanders]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await h.kv.get(`sess:2:${account.session.sessionId}`)).toBe("revoked");
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] });
    expect((await repo.findUserById(bystander.user.id))!).toMatchObject({ totpSecretEnc: expect.stringMatching(/^v1:/) });
    expect(await h.deps.sessions.resolve(bystander.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me")).toEqual([
      { type: "not_me", deviceId: account.session.deviceId, ipHash: h.ctx.ipHash, metadata: { passkeysRemoved: report.passkeysRemoved, totpCleared: true, passwordCleared: true } },
    ]);

    const again = await lockdown(h.deps, { userId: account.user.id, anchor, caller: { type: "not_me", deviceId: account.session.deviceId }, ctx: h.ctx });
    expect(again).toEqual({ passkeysRemoved: [], totpCleared: false, passwordCleared: true });
    expect(await passkeyIds(account.user.id)).toEqual([kept]);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me")).toHaveLength(2);

    // Two-factor from just before the day the lockdown reaches back stays.
    const earlier = await onboardedUser(h, repo);
    await withTotp(h, earlier.user.id, new Date(since.getTime() - 1));
    expect((await lockdown(h.deps, { userId: earlier.user.id, anchor, caller: { type: "not_me" }, ctx: h.ctx })).totpCleared).toBe(false);
    expect((await repo.findUserById(earlier.user.id))!.totpEnabledAt).toEqual(new Date(since.getTime() - 1));
  });

  test("the lockdown is one transaction: when its last statement, the event, cannot be written, nothing of it lands, and the next run finds everything still to do", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const passkey = await newPasskey(account.user.id, h.clock.now());
    await withTotp(h, account.user.id, h.clock.now());
    const before = (await repo.findUserById(account.user.id))!;
    h.clock.advance(HOUR);

    // An event type the database does not know: the insert, which comes after every other write, is refused.
    const unknown = "no_such_event" as AuthEventType;
    await expect(lockdown(h.deps, { userId: account.user.id, anchor: h.clock.now(), passkeyIds: [passkey], caller: { type: unknown, deviceId: account.session.deviceId }, ctx: h.ctx })).rejects.toThrow();
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).not.toBeNull();
    expect(await h.kv.get(`sess:2:${account.session.sessionId}`)).not.toBe("revoked");
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toHaveLength(2);
    expect(await repo.listDevices(account.user.id)).toHaveLength(1);
    expect(await passkeyIds(account.user.id)).toEqual([passkey]);
    expect((await repo.findUserById(account.user.id))!).toEqual(before);
    expect(before).toMatchObject({ passwordHash: expect.stringMatching(/^\$argon2id\$/), totpSecretEnc: expect.stringMatching(/^v1:/), recoveryCodesHash: ["owner-code"] });
    // The sign-in that made the account's session is the one event on record: the refused lockdown left none.
    expect((await eventsOf(account.user.id)).map((e) => e.type)).toEqual(["signin_success"]);

    // The same lockdown with an event the database takes: the rows and the event land together.
    const report = await lockdown(h.deps, { userId: account.user.id, anchor: h.clock.now(), passkeyIds: [passkey], caller: { type: "not_me", deviceId: account.session.deviceId }, ctx: h.ctx });
    expect(report).toEqual({ passkeysRemoved: [passkey], totpCleared: true, passwordCleared: true });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    for (const id of [account.session.sessionId, other.session.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect(await passkeyIds(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ passwordHash: null, passwordChangedAt: h.clock.now(), failedLogins: 0, lockedUntil: null, totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    expect((await eventsOf(account.user.id)).filter((e) => e.type !== "signin_success")).toEqual([
      { type: "not_me", deviceId: account.session.deviceId, ipHash: h.ctx.ipHash, metadata: { passkeysRemoved: [passkey], totpCleared: true, passwordCleared: true } },
    ]);
  });

  test("the alert of a sign-in on a new device stores the sign-in's time and the address, and its link locks the account down anchored there", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const signedInAt = h.clock.ms() + 2 * DAY;
    const since = signedInAt - LOCKDOWN_LOOKBACK_MS;
    const older = await newPasskey(account.user.id, new Date(since - 1));
    const recent = await newPasskey(account.user.id, new Date(since));
    h.clock.advance(2 * DAY);
    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    const signedIn = await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx);
    expect(signedIn.kind).toBe("session");
    const url = h.mailer.sent.find((m) => m.template === "new_device")!.data.notMeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    const stored = JSON.parse((await h.kv.get(notMeKey(token)))!) as NotMeToken;
    expect(stored).toEqual({
      userId: account.user.id,
      deviceId: (signedIn as { issued: { session: { deviceId: string } } }).issued.session.deviceId,
      signedInAt,
      passkeyId: null,
      sentTo: emailHash(h.deps.config.authHmacKey, account.email),
    });
    // Whoever signed in turns two-factor on afterwards.
    h.clock.advance(HOUR);
    await withTotp(h, account.user.id, h.clock.now());
    h.clock.advance(HOUR);

    await notMe(h.deps, { token }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([older]);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ passwordHash: null, totpEnabledAt: null });
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.metadata])).toEqual([
      [stored.deviceId, { passkeysRemoved: [recent], totpCleared: true, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("a link from before the deploy is anchored a day before it is used: it reaches two days back", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const used = h.clock.ms() + 3 * DAY;
    const since = used - DAY - LOCKDOWN_LOOKBACK_MS;
    const older = await newPasskey(account.user.id, new Date(since - 1));
    const inReach = await newPasskey(account.user.id, new Date(since));
    await withTotp(h, account.user.id, new Date(since));
    const token = randomToken();
    await h.kv.set(notMeKey(token), JSON.stringify({ userId: account.user.id, deviceId: account.session.deviceId }), 4 * DAY);
    h.clock.advance(3 * DAY);
    await notMe(h.deps, { token }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([older]);
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me").map((e) => e.metadata)).toEqual([{ passkeysRemoved: [inReach], totpCleared: true, passwordCleared: true }]);
  });

  test("a not-me link after the address changed does nothing but refuse", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    expect((await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).kind).toBe("session");
    const url = h.mailer.sent.find((m) => m.template === "new_device")!.data.notMeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    await repo.changeEmail(account.user.id, newTestEmail("moved"), h.clock.now());
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toHaveLength(2);
    expect(await repo.listDevices(account.user.id)).toHaveLength(2);
    expect((await repo.findUserById(account.user.id))!.passwordHash).not.toBeNull();
    expect((await eventsOf(account.user.id)).map((e) => e.type)).not.toContain("not_me");
  });

  test("the email undo is anchored at the change and names the passkey behind the changing session", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const owners = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const changedAt = h.clock.ms() + 3 * DAY;
    const since = changedAt - LOCKDOWN_LOOKBACK_MS;
    const older = await newPasskey(account.user.id, new Date(since - 1));
    const recent = await newPasskey(account.user.id, new Date(since));
    // The passkey that started the changing session is far older than the day the lockdown reaches back.
    const behind = await newPasskey(account.user.id, new Date(since - 10 * DAY));
    await db.update(sessions).set({ passkeyId: behind }).where(eq(sessions.id, account.session.sessionId));
    await h.deps.sessions.forgetUser(account.user.id);
    await withTotp(h, account.user.id, new Date(since - 1));
    h.clock.advance(3 * DAY);
    const changing = (await h.deps.sessions.resolve(account.token))!.session;
    expect(changing.passkeyId).toBe(behind);
    const newAddress = newTestEmail("moved");
    const started = await startEmailChange(h.deps, changing, { email: newAddress }, h.ctx);
    await verifyEmailChange(h.deps, changing, { flowId: started.flowId, code: h.mailer.lastCodeFor(newAddress)! });
    const notice = h.mailer.sent.at(-1)!;
    expect(notice).toMatchObject({ to: account.email, template: "email_changed" });
    const token = /\/email-revert\/([A-Za-z0-9_-]{43})$/.exec(notice.data.revertUrl!)![1]!;
    expect(JSON.parse((await h.kv.get(emailRevertKey(token)))!)).toEqual({ userId: account.user.id, oldEmail: account.email, changedAt, passkeyId: behind });

    h.clock.advance(HOUR);
    const added = await newPasskey(account.user.id, h.clock.now());
    h.clock.advance(HOUR);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ email: account.email, passwordHash: null, totpSecretEnc: expect.stringMatching(/^v1:/) });
    expect(await passkeyIds(account.user.id)).toEqual([older]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(owners.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    const key = h.deps.config.authHmacKey;
    const reverted = (await eventsOf(account.user.id)).filter((e) => e.type === "email_changed").at(-1)!;
    expect(reverted).toMatchObject({ deviceId: null, ipHash: h.ctx.ipHash });
    expect(reverted.metadata).toMatchObject({ from: emailHash(key, newAddress), to: emailHash(key, account.email), reverted: true, totpCleared: false, passwordCleared: true });
    expect([...((reverted.metadata as { passkeysRemoved: string[] }).passkeysRemoved)].sort()).toEqual([recent, behind, added].sort());
    expect(h.mailer.sent.at(-1)).toMatchObject({ to: account.email, template: "email_change_reverted" });
  });
});
```

### Replace `apps/api/test/integration/auth-passkey-signin.test.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, passkeys, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate } from "../../src/auth/flows/reauth";
import { notMeKey } from "../../src/auth/flows/signin";
import { MINUTE } from "../../src/auth/limits";
import { reauthOptions, registerOptions, registerVerify, signInOptions, signInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";

const ORIGIN = "http://localhost:8081";
const RP_ID = "localhost";
const PASSWORD = "correct horse battery staple";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/**
 * Passkey sign-in and re-authentication against the real repository (1c design, sections 7.2 and 7.4), with the software
 * authenticator: the session model, the counter write's conditional update, and the new-device alert's not-me link naming
 * the passkey that signed in.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: passkey sign-in and re-authentication", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Registers a passkey through Task 4's flow (before any TOTP, so the level-1 session suffices) and answers its credential id. */
  async function register(h: FlowHarness, session: Session, auth: SoftAuthenticator, flags: SoftFlags = ALL): Promise<string> {
    const { options } = await registerOptions(h.deps, session, { label: "ada" });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
    await registerVerify(h.deps, session, { response });
    return response.id;
  }

  /** A whole passkey sign-in against the real repository: fresh options, the authenticator's answer, and the verification. */
  async function passkeySignIn(h: FlowHarness, auth: SoftAuthenticator, credentialId: string, deviceId: string, opts: { flags?: SoftFlags; counter?: number } = {}) {
    const { options } = await signInOptions(h.deps, h.ctx);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: opts.flags ?? ALL, counter: opts.counter ?? 0 });
    return signInVerify(h.deps, { deviceId, platform: "web", response }, h.ctx);
  }

  async function withTotp(h: FlowHarness, userId: string): Promise<Uint8Array> {
    const secret = newTotpSecret();
    await repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(secret), h.deps.config.totpKey), recoveryCodesHash: [], now: h.clock.now() });
    await h.deps.sessions.forgetUser(userId);
    return secret;
  }

  const passkeyRow = async (credentialId: string) => (await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)))[0]!;

  test("register, sign out, sign in with the passkey, then re-authenticate with it", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, account.session, auth);
    // Sign out the registration session; the passkey signs in without it.
    await h.deps.sessions.revoke(account.session.handle, account.user.id);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();

    const outcome = await passkeySignIn(h, auth, credentialId, randomToken(), { counter: 1 });
    expect(outcome.kind).toBe("session");
    if (outcome.kind !== "session") throw new Error("unreachable");
    const signedIn = (await h.deps.sessions.resolve(outcome.issued.token))!.session;
    // A user-verified passkey on a TOTP-less account is two factors in one gesture.
    expect(signedIn.factors.passkey_uv).toBeDefined();
    expect(h.deps.sessions.level(signedIn)).toBe(2);
    expect(signedIn.passkeyId).toBe((await passkeyRow(credentialId)).id);
    expect((await passkeyRow(credentialId)).counter).toBe(1);

    // Re-authenticate with the same passkey: the options list it, the assertion answers, level 2 and the token rotates.
    const { options } = await reauthOptions(h.deps, signedIn);
    expect(options.allowCredentials!.map((c) => c.id)).toContain(credentialId);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 2 });
    const reauthed = await reauthenticate(h.deps, signedIn, { method: "passkey", response }, h.ctx);
    expect(reauthed.level).toBe(2);
    expect(reauthed.issued.session.handle).toBe(signedIn.handle);
    expect(await h.deps.sessions.resolve(outcome.issued.token)).toBeNull();
    expect((await passkeyRow(credentialId)).counter).toBe(2);
  });

  test("on an account with TOTP a user-verified passkey skips the step, a plain one does not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const uv = new SoftAuthenticator();
    const plain = new SoftAuthenticator();
    const uvId = await register(h, account.session, uv, ALL);
    const plainId = await register(h, account.session, plain, BARE);
    const secret = await withTotp(h, account.user.id);

    // The user-verified passkey signs in outright at level 2.
    const skipped = await passkeySignIn(h, uv, uvId, randomToken());
    expect(skipped.kind).toBe("session");
    if (skipped.kind !== "session") throw new Error("unreachable");
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(skipped.issued.token))!.session)).toBe(2);

    // The plain passkey stops at the TOTP step; the code then completes the sign-in.
    const pending = await passkeySignIn(h, plain, plainId, randomToken());
    expect(pending.kind).toBe("mfa");
    if (pending.kind !== "mfa") throw new Error("unreachable");
    const { verifyMfa } = await import("../../src/auth/flows/mfa");
    const signed = await verifyMfa(h.deps, { mfaTicket: pending.mfaTicket, code: hotp(secret, currentStep(h.clock.ms())) }, h.ctx);
    expect(Object.keys(signed.issued.session.factors).sort()).toEqual(["passkey", "totp"]);

    // The user-verified passkey asserted without user verification stops there too: the registration alone does not make two factors.
    expect((await passkeyRow(uvId)).uvInitialized).toBe(true);
    expect((await passkeySignIn(h, uv, uvId, randomToken(), { flags: BARE })).kind).toBe("mfa");
    // And re-authenticating with it that way writes the one-factor kind, which is not level 2.
    const session = (await h.deps.sessions.resolve(skipped.issued.token))!.session;
    h.clock.advance(10 * MINUTE);
    const { options } = await reauthOptions(h.deps, session);
    const response = uv.get({ credentialId: uvId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: BARE, counter: 0 });
    const reauthed = await reauthenticate(h.deps, session, { method: "passkey", response }, h.ctx);
    expect(reauthed.level).toBe(1);
    expect(reauthed.issued.session.factors).toMatchObject({ passkey: h.clock.ms() });
  });

  test("another account's passkey never re-authenticates a session: the repository looks it up with the session's account, and the passkey's row stays as it was", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const ada = await onboardedUser(h, repo);
    const bob = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, ada.session, auth);
    // ada's passkey has a use on the record.
    expect((await passkeySignIn(h, auth, credentialId, randomToken(), { counter: 7 })).kind).toBe("session");
    const before = await passkeyRow(credentialId);
    expect(before).toMatchObject({ userId: ada.user.id, counter: 7, lastUsedAt: h.clock.now(), suspectAt: null });
    h.clock.advance(MINUTE);

    // bob's session gets a challenge of its own and answers it with ada's passkey: a signature that checks, over bob's challenge.
    const { options } = await reauthOptions(h.deps, bob.session);
    expect(options.allowCredentials).toEqual([]);
    const response = auth.get({ credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 20 });
    expect(await failure(reauthenticate(h.deps, bob.session, { method: "passkey", response }, h.ctx))).toMatchObject({ code: "passkey_invalid", status: 401 });
    // ada's passkey was never found, so nothing of it moved: not the counter, not the use, and it was not suspected.
    expect(await passkeyRow(credentialId)).toEqual(before);
    // bob's session proved nothing: its factors are the sign-in's, and its token was not rotated.
    const bobs = (await h.deps.sessions.resolve(bob.token))!.session;
    expect(bobs).toEqual(bob.session);
    expect(h.deps.sessions.level(bobs)).toBe(1);
    const events = await db.select({ type: authEvents.type }).from(authEvents).where(eq(authEvents.userId, ada.user.id));
    expect(events.map((e) => e.type)).not.toContain("passkey_counter_regression");

    // The passkey still re-authenticates a session of its own account.
    const signedIn = (await h.deps.sessions.resolve(ada.token))!.session;
    const own = await reauthOptions(h.deps, signedIn);
    const ownResponse = auth.get({ credentialId, rpId: RP_ID, challenge: own.options.challenge, origin: ORIGIN, flags: ALL, counter: 21 });
    expect((await reauthenticate(h.deps, signedIn, { method: "passkey", response: ownResponse }, h.ctx)).level).toBe(2);
    expect(await passkeyRow(credentialId)).toMatchObject({ counter: 21, lastUsedAt: h.clock.now() });
  });

  test("a counter regression end to end suspends the passkey, records it, mails the owner and refuses; a later good sign-in is passkey_suspended", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, account.session, auth);
    expect((await passkeySignIn(h, auth, credentialId, randomToken(), { counter: 5 })).kind).toBe("session");
    expect((await passkeyRow(credentialId)).counter).toBe(5);

    // A counter that goes backwards, after the signature checks: suspend, record, mail, refuse.
    expect(await failure(passkeySignIn(h, auth, credentialId, randomToken(), { counter: 3 }))).toMatchObject({ code: "passkey_invalid", status: 401 });
    const row = await passkeyRow(credentialId);
    expect(row.suspectAt).not.toBeNull();
    const events = await db.select({ type: authEvents.type, metadata: authEvents.metadata }).from(authEvents).where(eq(authEvents.userId, account.user.id));
    expect(events.filter((e) => e.type === "passkey_counter_regression")).toEqual([{ type: "passkey_counter_regression", metadata: { passkeyId: row.id } }]);
    expect(h.mailer.sent.filter((m) => m.template === "passkey_suspect")).toEqual([{ to: account.email, template: "passkey_suspect", data: { name: row.name } }]);

    // A suspended passkey is refused from then on, after its signature checks.
    expect(await failure(passkeySignIn(h, auth, credentialId, randomToken(), { counter: 9 }))).toMatchObject({ code: "passkey_suspended", status: 403 });
  });

  test("the new-device alert's not-me link removes the passkey that signed in", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const auth = new SoftAuthenticator();
    const credentialId = await register(h, account.session, auth);
    const added = await passkeyRow(credentialId);

    // Sign in from a device the account has not used: the passkey signs in and its new-device alert names it.
    const outcome = await passkeySignIn(h, auth, credentialId, randomToken());
    expect(outcome.kind).toBe("session");
    const alert = h.mailer.sent.filter((m) => m.template === "new_device").at(-1)!;
    const token = alert.data.notMeUrl!.slice(alert.data.notMeUrl!.lastIndexOf("/") + 1);
    const stored = JSON.parse((await h.deps.kv.get(notMeKey(token)))!) as { passkeyId: string | null };
    expect(stored.passkeyId).toBe(added.id);

    await notMe(h.deps, { token }, h.ctx);
    expect(await db.select().from(passkeys).where(eq(passkeys.id, added.id))).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
  });
});
```

### Replace `apps/api/test/integration/auth-passkeys.test.ts` (whole file)

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, passkeys, sessions, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { me } from "../../src/auth/flows/account";
import { revertEmailChange, startEmailChange, verifyEmailChange } from "../../src/auth/flows/email-change";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { listPasskeys, notMine, passkeyRemoveKey, registerOptions, registerVerify, removeByLink, removePasskey, renamePasskey, type PasskeyRemoveToken } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, newTestEmail, onboardedUser, type FlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
const PASSWORD = "correct horse battery staple";
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const LINK_GONE = "This link has expired or was already used.";

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/**
 * Passkey registration and management against the real repository (1c design, sections 7.3, 7.5 and 7.6): the rows,
 * the transaction behind the bounds under a race, the foreign key from a session to the passkey that started it, and the
 * two lockdown paths a passkey offers.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: passkey registration and management", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** The options of a registration and the browser's answer to them from the software authenticator. */
  async function ceremony(h: FlowHarness, session: Session, auth: SoftAuthenticator, flags: SoftFlags = ALL) {
    const { options } = await registerOptions(h.deps, session, { label: "ada" });
    return auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
  }

  /** A whole registration; answers the stored passkey's view. */
  async function register(h: FlowHarness, session: Session, auth: SoftAuthenticator, name?: string, flags: SoftFlags = ALL) {
    const response = await ceremony(h, session, auth, flags);
    return (await registerVerify(h.deps, session, { name, response })).passkey;
  }

  /** A passkey row written directly, as the cap tests fill an account without spending the day's additions. */
  async function directPasskey(userId: string, createdAt: Date): Promise<string> {
    const [row] = await db.insert(passkeys).values({ userId, credentialId: randomToken(), publicKey: "cose-key", name: "Passkey", createdAt }).returning({ id: passkeys.id });
    return row!.id;
  }

  const passkeyIds = async (userId: string) => (await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId))).map((row) => row.id).sort();

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("registers two passkeys with one user handle, stores their flags and provenance, records and mails each, and lists them newest first", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const laptop = await register(h, account.session, auth, "Laptop");
    h.clock.advance(MINUTE);
    const plain = await register(h, account.session, auth, undefined, BARE);
    expect(laptop).toMatchObject({ name: "Laptop", synced: true, createdOn: "Chrome on Windows", current: false, isNew: true, suspended: false, lastUsedAt: null });
    expect(plain).toMatchObject({ name: "Passkey on the web", synced: false, createdAt: h.clock.now().toISOString() });

    const user = (await repo.findUserById(account.user.id))!;
    expect(Buffer.isBuffer(user.webauthnUserId)).toBe(true);
    expect(user.webauthnUserId).toHaveLength(32);
    // Both options carried the same handle: it was set once.
    const { options } = await registerOptions(h.deps, account.session, { label: "ada" });
    expect(Buffer.from(options.user.id, "base64url")).toEqual(user.webauthnUserId);
    expect(options.excludeCredentials!.map((c) => c.id).sort()).toHaveLength(2);

    const rows = await db.select().from(passkeys).where(eq(passkeys.userId, account.user.id)).orderBy(passkeys.createdAt);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: laptop.id, name: "Laptop", counter: 0, transports: ["internal", "hybrid"], backedUp: true, backupEligible: true, uvInitialized: true, createdDeviceId: account.session.deviceId, suspectAt: null, lastUsedAt: null });
    expect(rows[0]!.aaguid).toBe("00000000-0000-0000-0000-000000000000");
    expect(rows[0]!.createdAt).toEqual(new Date(h.clock.ms() - MINUTE));
    expect(rows[1]).toMatchObject({ id: plain.id, name: "Passkey on the web", backedUp: false, backupEligible: false, uvInitialized: false, createdAt: h.clock.now() });

    const { passkeys: listed } = await listPasskeys(h.deps, account.session);
    expect(listed.map((p) => p.id)).toEqual([plain.id, laptop.id]);
    expect((await me(h.deps, account.session)).user.passkeys).toBe(2);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_added")).toEqual([
      { type: "passkey_added", deviceId: account.session.deviceId, ipHash: null, metadata: { passkeyId: laptop.id } },
      { type: "passkey_added", deviceId: account.session.deviceId, ipHash: null, metadata: { passkeyId: plain.id } },
    ]);
    const mails = h.mailer.sent.filter((m) => m.template === "passkey_added");
    expect(mails.map((m) => [m.to, m.data.name, m.data.deviceLabel])).toEqual([
      [account.email, "Laptop", "Chrome on Windows"],
      [account.email, "Passkey on the web", "Chrome on Windows"],
    ]);
    const token = /\/passkey-remove\/([A-Za-z0-9_-]{43})$/.exec(mails[1]!.data.removeUrl!)![1]!;
    expect(JSON.parse((await h.kv.get(passkeyRemoveKey(token)))!) as PasskeyRemoveToken).toEqual({
      userId: account.user.id,
      passkeyId: plain.id,
      createdAt: h.clock.ms(),
      sentTo: emailHash(h.deps.config.authHmacKey, account.email),
    });
  });

  test("the cap under a race: with nine passkeys, two registrations answered at once get one tenth slot between them", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    for (let i = 0; i < 9; i++) await directPasskey(account.user.id, h.clock.now());
    const first = await ceremony(h, account.session, auth);
    const second = await ceremony(h, account.session, auth);
    const outcomes = await Promise.allSettled([registerVerify(h.deps, account.session, { response: first }), registerVerify(h.deps, account.session, { response: second })]);
    const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reason).toBeInstanceOf(AuthError);
    expect(refused[0]!.reason).toMatchObject({ code: "passkey_limit", status: 409, details: { reason: "cap" } });
    expect(await passkeyIds(account.user.id)).toHaveLength(10);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_added")).toHaveLength(1);
    const options = await failure(registerOptions(h.deps, account.session, { label: "ada" }));
    expect(options).toMatchObject({ code: "passkey_limit", status: 409, details: { reason: "cap" } });
  });

  test("the daily bound under a race, counted from the events by the database clock: with four additions today, two registrations at once get one fifth between them", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    // An addition from before yesterday is out of the window, whatever the harness clock says.
    await db.insert(authEvents).values({ userId: account.user.id, type: "passkey_added", deviceId: null, metadata: {}, createdAt: new Date(Date.now() - 25 * HOUR) });
    for (let i = 0; i < 4; i++) await repo.appendEvent({ userId: account.user.id, type: "passkey_added", deviceId: account.session.deviceId, metadata: {} });
    const first = await ceremony(h, account.session, auth);
    const second = await ceremony(h, account.session, auth);
    const outcomes = await Promise.allSettled([registerVerify(h.deps, account.session, { response: first }), registerVerify(h.deps, account.session, { response: second })]);
    const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const daily = refused[0]!.reason as AuthError;
    expect(daily).toBeInstanceOf(AuthError);
    expect(daily).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 24 hours." });
    expect(daily.details).toMatchObject({ reason: "daily" });
    // Until the oldest of today's five is a day old: they were all recorded moments ago.
    const retryAfter = (daily.details as { retryAfter: number }).retryAfter;
    expect(retryAfter).toBeGreaterThan(DAY / 1000 - 60);
    expect(retryAfter).toBeLessThanOrEqual(DAY / 1000);
    expect(await passkeyIds(account.user.id)).toHaveLength(1);
    const options = await failure(registerOptions(h.deps, account.session, { label: "ada" }));
    expect(options.details).toMatchObject({ reason: "daily" });
  });

  test("the remove link runs the lockdown anchored at the passkey's creation: the passkey and the ones from the day before it go, every session and device, the password too; it works once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const since = h.clock.ms() - LOCKDOWN_LOOKBACK_MS;
    const kept = await directPasskey(account.user.id, new Date(since - 1));
    const earlier = await directPasskey(account.user.id, new Date(since));
    const added = await register(h, account.session, new SoftAuthenticator(), "Laptop");
    const url = h.mailer.sent.at(-1)!.data.removeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    h.clock.advance(3 * DAY);
    const later = await directPasskey(account.user.id, h.clock.now());

    await removeByLink(h.deps, { token }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([kept]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const removed = (await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ deviceId: null, ipHash: h.ctx.ipHash });
    expect(removed[0]!.metadata).toMatchObject({ passkeyId: added.id, via: "link", totpCleared: false, passwordCleared: true });
    expect([...(removed[0]!.metadata as { passkeysRemoved: string[] }).passkeysRemoved].sort()).toEqual([earlier, added.id, later].sort());
    await expect(removeByLink(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
  });

  test("the remove link opened while an attacker's address change stands is refused and kept; after the email undo it removes the passkey and the two-factor that the undo's day did not reach", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const createdAt = h.clock.ms();
    // From a stolen session: a passkey, whose notice with the remove link goes to the owner, and two-factor from an hour before it.
    const added = await register(h, account.session, new SoftAuthenticator(), "Not the owner's");
    const removeUrl = h.mailer.sent.at(-1)!.data.removeUrl!;
    const removeToken = removeUrl.slice(removeUrl.lastIndexOf("/") + 1);
    await repo.enableTotp(account.user.id, { secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey), recoveryCodesHash: ["attackers-code"], now: new Date(createdAt - HOUR) });
    await h.deps.sessions.forgetUser(account.user.id);
    // More than a day later the address is changed; the undo link goes to the owner's address too.
    h.clock.advance(28 * HOUR);
    const changing = (await h.deps.sessions.resolve(account.token))!.session;
    const newAddress = newTestEmail("attacker");
    const started = await startEmailChange(h.deps, changing, { email: newAddress }, h.ctx);
    await verifyEmailChange(h.deps, changing, { flowId: started.flowId, code: h.mailer.lastCodeFor(newAddress)! });
    const undoToken = /\/email-revert\/([A-Za-z0-9_-]{43})$/.exec(h.mailer.sent.at(-1)!.data.revertUrl!)![1]!;

    // The owner opens the mails oldest first. The remove link does not match the address the account is at: refused, and kept.
    h.clock.advance(HOUR);
    await expect(removeByLink(h.deps, { token: removeToken }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await passkeyIds(account.user.id)).toEqual([added.id]);
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();
    expect(await h.kv.get(passkeyRemoveKey(removeToken))).not.toBeNull();

    // The undo puts the address back and locks down from the day before the change: the passkey and the two-factor are older.
    await revertEmailChange(h.deps, { token: undoToken }, h.ctx);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ email: account.email, passwordHash: null, totpSecretEnc: expect.stringMatching(/^v1:/), recoveryCodesHash: ["attackers-code"] });
    expect(await passkeyIds(account.user.id)).toEqual([added.id]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();

    // The remove link again, now that the address is the one it went to: anchored at the passkey's creation, it reaches both.
    await removeByLink(h.deps, { token: removeToken }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ email: account.email, totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] });
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed")).toEqual([
      { type: "passkey_removed", deviceId: null, ipHash: h.ctx.ipHash, metadata: { passkeyId: added.id, via: "link", passkeysRemoved: [added.id], totpCleared: true, passwordCleared: true } },
    ]);
    await expect(removeByLink(h.deps, { token: removeToken }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
  });

  test("'not mine' on a passkey of the last 7 days does the same from inside a session, and is recorded with that session's device", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const old = await directPasskey(account.user.id, new Date(h.clock.ms() - 30 * DAY));
    const added = await register(h, account.session, new SoftAuthenticator(), "Laptop");
    await expect(notMine(h.deps, account.session, old, h.ctx)).rejects.toMatchObject({ code: "passkey_not_found", status: 404 });

    await notMine(h.deps, account.session, added.id, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([old]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const removed = (await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed");
    expect(removed).toEqual([
      { type: "passkey_removed", deviceId: account.session.deviceId, ipHash: h.ctx.ipHash, metadata: { passkeyId: added.id, via: "not_mine", passkeysRemoved: [added.id], totpCleared: false, passwordCleared: true } },
    ]);
    expect(h.mailer.sent.filter((m) => m.template === "passkey_removed")).toEqual([]);
  });

  test("removing the passkey that started the current session keeps the session, without it; rename and removal act only on the account's own passkeys", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const bystander = await onboardedUser(h, repo);
    const added = await register(h, account.session, new SoftAuthenticator(), "Laptop");
    await db.update(sessions).set({ passkeyId: added.id }).where(eq(sessions.id, account.session.sessionId));
    await h.deps.sessions.forgetUser(account.user.id);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    expect(session.passkeyId).toBe(added.id);
    expect((await listPasskeys(h.deps, session)).passkeys.map((p) => [p.id, p.current])).toEqual([[added.id, true]]);

    await expect(renamePasskey(h.deps, bystander.session, added.id, { name: "Taken" })).rejects.toMatchObject({ code: "passkey_not_found", status: 404 });
    await expect(removePasskey(h.deps, bystander.session, added.id)).rejects.toMatchObject({ code: "passkey_not_found", status: 404 });
    expect((await renamePasskey(h.deps, session, added.id, { name: "Work laptop" })).passkey).toMatchObject({ id: added.id, name: "Work laptop", current: true });

    h.clock.advance(MINUTE);
    await removePasskey(h.deps, session, added.id);
    expect(await passkeyIds(account.user.id)).toEqual([]);
    const [row] = await db.select({ passkeyId: sessions.passkeyId, revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, account.session.sessionId));
    expect(row).toEqual({ passkeyId: null, revokedAt: null });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed")).toEqual([
      { type: "passkey_removed", deviceId: account.session.deviceId, ipHash: null, metadata: { passkeyId: added.id, via: "settings" } },
    ]);
    expect(h.mailer.sent.at(-1)).toEqual({ to: account.email, template: "passkey_removed", data: { name: "Work laptop", time: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/) } });
    expect(await passkeyIds(bystander.user.id)).toEqual([]);
  });
});
```

### Replace `apps/api/test/integration/auth-repo.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { isUniqueViolation } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: auth repo", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  test("users are found by email in any case, and a second account for the same email is rejected", async () => {
    const email = `repo-${randomUUID()}@korbat.local`;
    const user = await repo.createUser({ email, termsVersion: "test", now: new Date() });
    expect(user.role).toBe("user");
    expect(user.emailVerifiedAt).not.toBeNull();
    expect((await repo.findUserByEmail(email.toUpperCase()))?.id).toBe(user.id);
    await expect(repo.createUser({ email: email.toUpperCase(), termsVersion: "test", now: new Date() })).rejects.toThrow();
  });

  test("an email code counts attempts and can be consumed exactly once", async () => {
    const flowId = randomToken();
    await repo.createEmailCode({
      flowId,
      email: `repo-${randomUUID()}@korbat.local`,
      userId: null,
      purpose: "signup",
      codeHash: "hash",
      expiresAt: new Date(Date.now() + 600_000),
      ipHash: null,
    });
    const code = (await repo.findEmailCode(flowId))!;
    expect(await repo.addCodeAttempt(code.id)).toBe(1);
    expect(await repo.addCodeAttempt(code.id)).toBe(2);
    const results = await Promise.all([repo.consumeEmailCode(code.id, new Date()), repo.consumeEmailCode(code.id, new Date())]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("TOTP steps can only be claimed forwards, once, even concurrently", async () => {
    const { user } = await newUserWithDevice(repo);
    expect(await repo.claimTotpStep(user.id, 100)).toBe(true);
    expect(await repo.claimTotpStep(user.id, 100)).toBe(false);
    expect(await repo.claimTotpStep(user.id, 99)).toBe(false);
    const results = await Promise.all([repo.claimTotpStep(user.id, 101), repo.claimTotpStep(user.id, 101)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("a recovery code hash is removed once, even under concurrent use", async () => {
    const { user } = await newUserWithDevice(repo);
    await repo.enableTotp(user.id, { secretEnc: "v1:test", recoveryCodesHash: ["a", "b", "c"], now: new Date() });
    const results = await Promise.all([repo.consumeRecoveryCodeHash(user.id, "b"), repo.consumeRecoveryCodeHash(user.id, "b")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await repo.findUserById(user.id))!.recoveryCodesHash).toEqual(["a", "c"]);
  });

  test("changing the password clears the lockout state", async () => {
    const { user } = await newUserWithDevice(repo);
    await repo.setPasswordFailures(user.id, 5, new Date(Date.now() + 900_000));
    await repo.setPasswordHash(user.id, "$argon2id$placeholder", new Date());
    const row = (await repo.findUserById(user.id))!;
    expect(row.failedLogins).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(row.passwordChangedAt).not.toBeNull();
  });

  test("one phone hash per account: the partial unique index refuses a second account's identical hash, and a cleared hash frees it", async () => {
    const first = await newUserWithDevice(repo);
    const second = await newUserWithDevice(repo);
    const hash = sha256Hex(randomToken());
    await repo.setPhoneHash(first.user.id, hash);
    expect((await repo.findUserById(first.user.id))!.phoneHash).toBe(hash);
    const conflict = await repo.setPhoneHash(second.user.id, hash).then(() => null, (err: unknown) => err);
    expect(isUniqueViolation(conflict)).toBe(true);
    expect((await repo.findUserById(second.user.id))!.phoneHash).toBeNull();
    // The holder may write its own hash again; accounts without a number stay out of the index; a cleared hash is free to take.
    await repo.setPhoneHash(first.user.id, hash);
    await repo.setPhoneHash(second.user.id, null);
    await repo.setPhoneHash(first.user.id, null);
    await repo.setPhoneHash(second.user.id, hash);
    expect((await repo.findUserById(first.user.id))!.phoneHash).toBeNull();
    expect((await repo.findUserById(second.user.id))!.phoneHash).toBe(hash);
  });

  test("only live sessions are active, listed and revoked", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const now = new Date();
    const make = async (expiresAt: Date) => {
      const id = sha256Hex(randomToken());
      await repo.createSession({ id, userId: user.id, deviceId: device.id, now, expiresAt, absoluteExpiresAt: new Date(now.getTime() + 86_400_000) });
      return id;
    };
    const live = await make(new Date(now.getTime() + 60_000));
    const expired = await make(new Date(now.getTime() - 1_000));
    const revoked = await make(new Date(now.getTime() + 60_000));
    // A session is revoked by its handle, which the column's default gave it; the answer is the row's id, for the cache.
    const handleOf = async (id: string) => (await repo.findActiveSession(id, now))!.handle;
    const liveHandle = await handleOf(live);
    expect(liveHandle).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await repo.revokeSession(await handleOf(revoked), user.id, now)).toBe(revoked);

    expect((await repo.findActiveSession(live, new Date()))?.role).toBe("user");
    expect(await repo.findActiveSession(expired, new Date())).toBeUndefined();
    expect(await repo.findActiveSession(revoked, new Date())).toBeUndefined();
    expect((await repo.listActiveSessions(user.id, new Date())).map((s) => [s.id, s.handle])).toEqual([[live, liveHandle]]);
    // Sessions that expired without being revoked are revoked too, so nothing stale stays live.
    expect((await repo.revokeAllSessions(user.id, new Date())).sort()).toEqual([live, expired].sort());
    expect(await repo.findActiveSession(live, new Date())).toBeUndefined();
  });

  test("a user cannot revoke another user's session", async () => {
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    const now = new Date();
    const id = sha256Hex(randomToken());
    await repo.createSession({ id, userId: owner.user.id, deviceId: owner.device.id, now, expiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 86_400_000) });
    const { handle } = (await repo.findActiveSession(id, now))!;
    expect(await repo.revokeSession(handle, other.user.id, now)).toBeUndefined();
    expect(await repo.findActiveSession(id, new Date())).toBeDefined();
    // The owner's revoke answers the row's id, once: a session already revoked answers nothing.
    expect(await repo.revokeSession(handle, owner.user.id, now)).toBe(id);
    expect(await repo.revokeSession(handle, owner.user.id, now)).toBeUndefined();
  });

  test("auth events are append-only for the auth role", async () => {
    const { user } = await newUserWithDevice(repo);
    await repo.appendEvent({ userId: user.id, type: "signup", metadata: { via: "test" } });
    expect((await repo.recentEvents(user.id)).map((e) => e.type)).toEqual(["signup"]);
    // Drizzle wraps driver errors ("Failed query: ..."); the Postgres error is the cause.
    const failure = await db.execute(sql`delete from auth.auth_events where user_id = ${user.id}`).then(() => null, (err: unknown) => err);
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied for table auth_events/);
  });
});
```

### Replace `apps/api/test/integration/auth-sessions.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout, LOCK_DURATION_MS } from "../../src/auth/lockout";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, SESSION_IDLE_MS, createSessions } from "../../src/auth/sessions";
import { loadConfig } from "../../src/config";
import { fakeClock, newUserWithDevice } from "./auth-fixtures";

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!process.env.INTEGRATION)("integration: sessions and lockout", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Sessions with a fake clock shared by the cache, so expiry can be tested without waiting. */
  function setup() {
    const clock = fakeClock();
    const kv = new MemoryKv(clock.ms);
    return { clock, kv, sessions: createSessions({ repo, kv, now: clock.now }), lockout: createLockout({ repo, kv, now: clock.now }) };
  }

  test("issued tokens resolve, and only their sha256 identifies the session", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect(issued.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(issued.session.sessionId).toBe(sha256Hex(issued.token));
    expect(issued.maxAgeSeconds).toBe(SESSION_IDLE_MS / 1000);
    const resolved = await sessions.resolve(issued.token);
    expect(resolved?.session).toMatchObject({ userId: user.id, deviceId: device.id, role: "user", onboarded: false, mfaEnabled: false });
    // What the session proved and when, its handle for life, and the passkey it started from, if any (1c design, section 7.1).
    expect(resolved?.session).toMatchObject({ factors: { email: clock.ms() }, reauthAt: clock.now(), passkeyId: null });
    expect(resolved?.session.handle).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolved?.session).toEqual(issued.session);
    expect(await sessions.resolve(`kb1_${"x".repeat(43)}`)).toBeNull();
    // The reauth time is the latest of the factors, whatever order they are given in.
    const two = await sessions.issue(user.id, device.id, { factors: { totp: clock.ms() + 5_000, password: clock.ms() - 5_000 } });
    expect(two.session).toMatchObject({ factors: { totp: clock.ms() + 5_000, password: clock.ms() - 5_000 }, reauthAt: new Date(clock.ms() + 5_000) });
    expect(two.session.handle).not.toBe(issued.session.handle);
  });

  test("revocation takes effect immediately, even while the session is cached", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect(await sessions.resolve(issued.token)).not.toBeNull();
    // A session is revoked by its handle, the id the list shows; a second revoke finds nothing live.
    expect(await sessions.revoke(issued.session.handle, user.id)).toBe(true);
    expect(await sessions.resolve(issued.token)).toBeNull();
    expect(await sessions.revoke(issued.session.handle, user.id)).toBe(false);
  });

  test("a revoked session stays revoked while a cache fill is in flight, and a foreign revoke leaves the cache alone", async () => {
    const { clock, kv, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const key = `sess:2:${issued.session.sessionId}`;
    await sessions.resolve(issued.token);
    const other = await newUserWithDevice(repo);
    expect(await sessions.revoke(issued.session.handle, other.user.id)).toBe(false);
    expect(await kv.get(key)).not.toBe("revoked");
    // Revoked by the handle; the tombstone lies where the cached copy does, under the token's hash.
    expect(await sessions.revoke(issued.session.handle, user.id)).toBe(true);
    expect(await kv.get(key)).toBe("revoked");
    expect(await kv.setIfAbsent(key, "a stale copy", 60_000)).toBe(false);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  test("a session cannot be revoked through another user's account", async () => {
    const { clock, sessions } = setup();
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    const issued = await sessions.issue(owner.user.id, owner.device.id, { factors: { email: clock.ms() } });
    expect(await sessions.revoke(issued.session.handle, other.user.id)).toBe(false);
    expect(await sessions.resolve(issued.token)).not.toBeNull();
  });

  test("activity slides the expiry at most once an hour, and the 12-month cap cannot be extended", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect((await sessions.resolve(issued.token))?.slid).toBe(false);
    clock.advance(2 * 60 * 60 * 1000);
    expect((await sessions.resolve(issued.token))?.slid).toBe(true);
    clock.advance(10 * 60 * 1000);
    expect((await sessions.resolve(issued.token))?.slid).toBe(false);
    for (let day = 20; day <= 360; day += 20) {
      clock.advance(20 * DAY);
      expect(await sessions.resolve(issued.token), `day ${day}`).not.toBeNull();
    }
    clock.advance(20 * DAY);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  test("rotation replaces the token in place: the handle, factors, reauth time, passkey, device and expiries stay, and the old token stops working at once", async () => {
    const { clock, kv, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const first = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() - 60_000, totp: clock.ms() } });
    const before = (await repo.findActiveSession(first.session.sessionId, clock.now()))!;
    // Cached, as a session in use is.
    expect(await sessions.resolve(first.token)).not.toBeNull();
    clock.advance(60_000);
    const second = await sessions.rotate(first.session);
    expect(second.token).not.toBe(first.token);
    expect(second.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(second.maxAgeSeconds).toBe(SESSION_IDLE_MS / 1000);
    // Only the id, the token's hash, changed; the reauth time did not move, since no factor was proven.
    expect(second.session).toEqual({ ...first.session, sessionId: sha256Hex(second.token) });
    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await kv.get(`sess:2:${first.session.sessionId}`)).toBe("revoked");
    expect((await sessions.resolve(second.token))?.session).toEqual(second.session);
    const after = (await repo.findActiveSession(second.session.sessionId, clock.now()))!;
    expect(after).toEqual({ ...before, id: second.session.sessionId });
    // One row, under the new id and the same handle: the list names it by the handle and marks it current by it.
    expect((await sessions.list(user.id, second.session.handle)).map((s) => [s.id, s.current])).toEqual([[first.session.handle, true]]);
  });

  test("a session listed before its token rotated is revoked by the id the list gave: the rotated token stops working, with a tombstone under its hash", async () => {
    const { clock, kv, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const owners = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const target = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const before = await sessions.list(user.id, owners.session.handle);
    // The ids a client sees are the handles: no token's hash is among them.
    expect(before.map((s) => s.id).sort()).toEqual([owners.session.handle, target.session.handle].sort());
    const listed = before.find((s) => !s.current)!;
    expect(listed.id).toBe(target.session.handle);

    // The listed session re-authenticates before the revoke lands: a factor is written and its token rotates, twice over.
    await sessions.addFactor(target.session.sessionId, "password");
    const once = await sessions.rotate(target.session);
    const twice = await sessions.rotate(once.session);
    expect((await sessions.resolve(twice.token))?.session.handle).toBe(listed.id);

    expect(await sessions.revoke(listed.id, user.id)).toBe(true);
    expect(await sessions.resolve(twice.token)).toBeNull();
    // The tombstone is keyed by the row's id at the moment of the revoke, where a cached copy lies.
    expect(await kv.get(`sess:2:${twice.session.sessionId}`)).toBe("revoked");
    expect((await sessions.list(user.id, owners.session.handle)).map((s) => s.id)).toEqual([owners.session.handle]);
    expect(await sessions.resolve(owners.token)).not.toBeNull();
    expect(await sessions.revoke(listed.id, user.id)).toBe(false);
  });

  test("a session revoked meanwhile cannot be rotated: nothing replaces it", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect(await sessions.revoke(issued.session.handle, user.id)).toBe(true);
    await expect(sessions.rotate(issued.session)).rejects.toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(await sessions.list(user.id, issued.session.handle)).toEqual([]);
  });

  test("signing out everywhere revokes every session of the user and lists them first", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const a = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const b = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const listed = await sessions.list(user.id, a.session.handle);
    expect(listed).toHaveLength(2);
    expect(listed.filter((s) => s.current).map((s) => s.id)).toEqual([a.session.handle]);
    expect(listed.filter((s) => !s.current).map((s) => s.id)).toEqual([b.session.handle]);
    expect(await sessions.revokeAll(user.id)).toBe(2);
    expect(await sessions.resolve(a.token)).toBeNull();
    expect(await sessions.resolve(b.token)).toBeNull();
  });

  test("a session is fresh for five minutes after a factor was proven, and a factor written later renews it and can raise its level", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const signedIn = clock.ms();
    const issued = await sessions.issue(user.id, device.id, { factors: { email: signedIn } });
    expect(sessions.isFresh(issued.session)).toBe(true);
    clock.advance(REAUTH_WINDOW_MS + 1_000);
    expect(sessions.isFresh((await sessions.resolve(issued.token))!.session)).toBe(false);
    await sessions.addFactor(issued.session.sessionId, "password");
    // The cached copy went with the write, so the factor shows at once, with the reauth time following it.
    const renewed = (await sessions.resolve(issued.token))!.session;
    expect(renewed).toMatchObject({ factors: { email: signedIn, password: clock.ms() }, reauthAt: clock.now() });
    expect(sessions.isFresh(renewed)).toBe(true);
    expect(sessions.level(renewed)).toBe(1);
    await sessions.addFactor(issued.session.sessionId, "totp");
    const strong = (await sessions.resolve(issued.token))!.session;
    expect(strong.factors).toEqual({ email: signedIn, password: clock.ms(), totp: clock.ms() });
    expect(sessions.level(strong)).toBe(2);
  });

  test("the fifth wrong password in 15 minutes locks password sign-in for 15 minutes", async () => {
    const { clock, lockout } = setup();
    const { user } = await newUserWithDevice(repo);
    for (let i = 1; i <= 4; i++) expect(await lockout.recordFailure(user.id)).toEqual({ failures: i, locked: false });
    expect(await lockout.recordFailure(user.id)).toEqual({ failures: 5, locked: true });
    const locked = (await repo.findUserById(user.id))!;
    expect(lockout.isLocked(locked)).toBe(true);
    expect(locked.lockedUntil!.getTime() - clock.ms()).toBe(LOCK_DURATION_MS);
    clock.advance(LOCK_DURATION_MS + 1_000);
    expect(lockout.isLocked(locked)).toBe(false);
  });

  test("a correct password resets the failure count", async () => {
    const { lockout } = setup();
    const { user } = await newUserWithDevice(repo);
    for (let i = 0; i < 4; i++) await lockout.recordFailure(user.id);
    await lockout.recordSuccess(user.id);
    expect(await lockout.recordFailure(user.id)).toEqual({ failures: 1, locked: false });
    expect((await repo.findUserById(user.id))!.failedLogins).toBe(1);
  });

  test("failures older than the 15-minute window do not count", async () => {
    const { clock, lockout } = setup();
    const { user } = await newUserWithDevice(repo);
    for (let i = 0; i < 4; i++) await lockout.recordFailure(user.id);
    clock.advance(16 * 60 * 1000);
    expect(await lockout.recordFailure(user.id)).toEqual({ failures: 1, locked: false });
  });
});
```

### Replace `apps/api/test/integration/http-account.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, ExportFormat, FlowResponse, MeResponse, MediaStatusResponse, PostView, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { Browser } from "./http-client";
import { BYTES, fakeWorker } from "./media-harness";

type App = ReturnType<typeof createApp>;

const newHandle = () => `a${randomBytes(4).toString("hex")}`;

/**
 * The export route through the real app: 1a sign-up for the accounts, cookie sessions with CSRF,
 * the auth module's freshness check, an image uploaded over HTTP with the stand-in for the worker
 * on the store directory, and the four modules wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the data export over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-account-"));
  const worker = fakeWorker(path.join(root, "store"));
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, events: { append: auth.appendEvent } });
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: media.forAccount,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `export-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, email, handle, userId: me.user.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  const exportOf = (b: Browser) => b.fetch("/api/account/export", { method: "POST" });
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionIdOf(b)}`);
  }
  /** The opposite: the session proved a credential just now. */
  async function makeFresh(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date());
    await auth.deps.kv.del(`sess:2:${sessionIdOf(b)}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);

  /** Uploads an image and lets the stand-in worker accept it. */
  async function readyImage(b: Browser): Promise<string> {
    const res = await b.fetch("/api/media", { raw: { type: "image/jpeg", body: BYTES.jpeg } });
    expect(res.status).toBe(202);
    const { id } = UploadResponse.parse(await res.json());
    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    return id;
  }

  test("the export needs an onboarded, fresh session", async () => {
    const anonymous = await app.request("/api/account/export", { method: "POST" });
    expect(anonymous.status).toBe(401);
    expect(await errorCode(anonymous)).toBe("unauthenticated");
    const notOnboarded = await signUp(false);
    const early = await exportOf(notOnboarded.b);
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");
    const stale = await signUp();
    await makeStale(stale.b);
    const refused = await exportOf(stale.b);
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("reauth_required");
    // A refusal spends nothing: once fresh again, the day's export is still available.
    await makeFresh(stale.b);
    expect((await exportOf(stale.b)).status).toBe(200);
  });

  test("the archive streams with its headers, holds export.json and the uploaded image, records the event, and comes once a day", async () => {
    const ada = await signUp();
    const image = await readyImage(ada.b);
    const created = await ada.b.fetch("/api/posts", { json: { body: "a photo", media: [{ id: image, alt: "a harbour at dawn" }] } });
    expect(created.status).toBe(201);
    const post = PostView.parse(await created.json());

    const res = await exportOf(ada.b);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename="korbat-export-${ada.handle}-\\d{4}-\\d{2}-\\d{2}\\.zip"$`));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${image}.webp`].sort());
    expect(strFromU8(files[`media/${image}.webp`]!)).toBe(`large-webp-of-${image}`);
    const text = strFromU8(files["export.json"]!);
    const json = ExportFormat.parse(JSON.parse(text));
    expect(json.account).toMatchObject({ id: ada.userId, email: ada.email, role: "user", termsVersion: config.TERMS_VERSION });
    expect(json.profile).toMatchObject({ handle: ada.handle, displayName: `User ${ada.handle}`, handleHistory: [ada.handle] });
    // The session under its handle, marked as the one that asked for the export; the hash of its token stays on the server.
    const { handle: sessionHandle } = (await auth.deps.repo.findActiveSession(sessionIdOf(ada.b), new Date()))!;
    expect(json.sessions).toEqual([{ id: sessionHandle, createdAt: expect.any(String), lastUsedAt: expect.any(String), current: true }]);
    expect(text).not.toContain(sessionIdOf(ada.b));
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0]).toMatchObject({ id: post.id, body: "a photo", media: [{ id: image, file: `media/${image}.webp`, altText: "a harbour at dawn", width: 1200, height: 800 }] });
    expect(json.missingMedia).toEqual([]);
    expect(await eventTypes(ada.userId)).toContain("export_created");

    // The freshness check comes before the daily limit: a stale session is told to re-authenticate, not to wait a day.
    await makeStale(ada.b);
    const stale = await exportOf(ada.b);
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("reauth_required");
    await makeFresh(ada.b);
    const again = await exportOf(ada.b);
    expect(again.status).toBe(429);
    expect(await errorCode(again)).toBe("rate_limited");
    const retryAfter = Number(again.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(24 * 3600);
    expect((await eventTypes(ada.userId)).filter((type) => type === "export_created")).toHaveLength(1);
  });
});
```

### Replace `apps/api/test/integration/http-auth.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { EmailChangeResponse, ErrorEnvelope, FlowResponse, MeResponse, SessionResult, SessionsResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { Browser, NativeClient } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `h_${randomBytes(6).toString("hex")}`;

describe.skipIf(!process.env.INTEGRATION)("integration: auth over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const mailer = new MemoryMailer();

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async (token) => token !== "fail" },
      breachChecker: { isBreached: async (password) => password.includes("breached") },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
    // Routes must be registered before the first request builds the router.
    app.get("/api/test/staff-only", auth.requireSession, auth.requireStaffMfa, (c) => c.text("ok"));
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  async function signUp(b: Browser, platform: "web" | "ios" = "web") {
    const email = `http-${randomUUID()}@korbat.local`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    const verify = await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    expect(await verify.json()).toEqual({ result: "signup_required" });
    const complete = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION } });
    expect(complete.status).toBe(200);
    return { email, complete };
  }

  test("web sign-up end to end: cookies only, CSRF on state changes, onboarding, me and sessions", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email, complete } = await signUp(b);
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(complete.headers.getSetCookie().find((c) => c.startsWith("__Host-korbat_session="))).toContain("HttpOnly");

    const before = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(before.user).toMatchObject({ email, onboarded: false, hasPassword: false });
    expect(before.profile).toBeNull();

    const firstToken = b.cookie("__Host-korbat_session");
    const handle = newHandle();
    const withoutCsrf = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Web User" }, csrf: false });
    expect(withoutCsrf.status).toBe(403);
    expect(await withoutCsrf.json()).toMatchObject({ error: { code: "csrf_failed" } });

    const onboarded = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Web User" } });
    expect(onboarded.status).toBe(200);
    expect(await onboarded.json()).toEqual({ profile: { id: before.user.id, handle, displayName: "Web User" } });
    expect(b.cookie("__Host-korbat_session")).not.toBe(firstToken);

    const after = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(after.user.onboarded).toBe(true);
    expect(after.profile?.handle).toBe(handle);
    const { sessions } = SessionsResponse.parse(await (await b.fetch("/api/auth/sessions")).json());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.current).toBe(true);
  });

  test("native clients get the token in the body and never cookies; bearer requests need no CSRF token", async () => {
    const native = new NativeClient(app);
    const email = `http-${randomUUID()}@korbat.local`;
    const start = await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } });
    const { flowId } = FlowResponse.parse(await start.json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    const complete = await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION } });
    expect(complete.status).toBe(200);
    const body = SessionResult.parse(await complete.json());
    expect(body.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(complete.headers.getSetCookie()).toHaveLength(0);

    const onboarded = await app.request("/api/auth/onboarding/handle", {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
      body: JSON.stringify({ handle: newHandle(), displayName: "Phone User" }),
    });
    expect(onboarded.status).toBe(200);
    const { token: rotated } = (await onboarded.json()) as { token?: string };
    expect(rotated).toMatch(/^kb1_/);
    expect((await app.request("/api/me", { headers: { authorization: `Bearer ${body.token}` } })).status).toBe(401);
    expect((await app.request("/api/me", { headers: { authorization: `Bearer ${rotated}` } })).status).toBe(200);
  });

  test("a browser gets cookies and no token even when it claims a native platform", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { complete } = await signUp(b, "ios");
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(complete.headers.getSetCookie().some((c) => c.startsWith("__Host-korbat_session="))).toBe(true);
  });

  test("a script that sends only Sec-Fetch-Mode, as Node's fetch does, keeps its native platform", async () => {
    const headers = { "content-type": "application/json", "sec-fetch-mode": "cors", "cf-connecting-ip": "203.0.113.77" };
    const email = `http-${randomUUID()}@korbat.local`;
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
    const start = await post("/api/auth/email/start", { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" });
    const { flowId } = FlowResponse.parse(await start.json());
    await post("/api/auth/email/verify", { flowId, code: mailer.lastCodeFor(email) });
    const complete = await post("/api/auth/signup/complete", { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION });
    expect(complete.status).toBe(200);
    expect(SessionResult.parse(await complete.json()).token).toMatch(/^kb1_/);
    expect(complete.headers.getSetCookie()).toHaveLength(0);
  });

  test("malformed JSON is a 400 with the error envelope, not a 500", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const res = await b.fetch("/api/auth/email/verify", { raw: { type: "application/json", body: new TextEncoder().encode("{not json") } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("revoking one session needs fresh re-authentication", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Fresh" } });
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);
    const revoke = await b.fetch(`/api/auth/sessions/${randomUUID()}`, { method: "DELETE" });
    expect(revoke.status).toBe(403);
    expect(await revoke.json()).toMatchObject({ error: { code: "reauth_required" } });
  });

  test("a session is revoked by its handle: an unknown one is 404, and anything that is not a uuid, a token's hash included, is 400", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Handles" } });
    const { sessions } = SessionsResponse.parse(await (await b.fetch("/api/auth/sessions")).json());
    const row = (await auth.deps.repo.findActiveSession(sha256Hex(b.cookie("__Host-korbat_session")!), new Date()))!;
    expect(sessions.map((s) => [s.id, s.current])).toEqual([[row.handle, true]]);

    const unknown = await b.fetch(`/api/auth/sessions/${randomUUID()}`, { method: "DELETE" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "not_found" } });
    for (const id of [row.id, "0".repeat(64), "not-a-uuid"]) {
      const malformed = await b.fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
      expect(malformed.status, id).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    expect((await b.fetch("/api/me")).status).toBe(200);
    // Its own handle signs the session out.
    expect((await b.fetch(`/api/auth/sessions/${row.handle}`, { method: "DELETE" })).status).toBe(204);
    expect((await b.fetch("/api/me")).status).toBe(401);
  });

  test("other origins cannot change state; no session gets 401; unfinished onboarding gets 403", async () => {
    const evil = new Browser(app, "https://evil.example");
    const crossOrigin = await evil.fetch("/api/auth/email/start", { json: { email: "a@b.io", turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toMatchObject({ error: { code: "csrf_failed" } });

    const anonymous = await app.request("/api/me");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "unauthenticated" } });

    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    const sessions = await b.fetch("/api/auth/sessions");
    expect(sessions.status).toBe(403);
    expect(await sessions.json()).toMatchObject({ error: { code: "onboarding_required" } });
  });

  test("sensitive routes need fresh re-authentication, which an emailed code provides", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Fresh" } });
    const token = b.cookie("__Host-korbat_session")!;
    const sessionId = sha256Hex(token);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);

    const blocked = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "reauth_required" } });

    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(200);
    // The level reached; the token rotated into the cookies, never into a browser's body (1c design, section 7.2).
    expect(await reauth.json()).toEqual({ level: 1 });
    const rotated = b.cookie("__Host-korbat_session")!;
    expect(rotated).not.toBe(token);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);

    const set = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({});
    expect(b.cookie("__Host-korbat_session")).not.toBe(rotated);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.hasPassword).toBe(true);
  });

  test("changing the email address needs an onboarded, fresh session on both routes; the new address is then verified by its code and shown by /me", async () => {
    const newAddress = `http-moved-${randomUUID()}@korbat.local`;
    const routes = [
      ["/api/auth/email/change/start", { email: newAddress }],
      ["/api/auth/email/change/verify", { flowId: randomToken(), code: "123456" }],
    ] as const;
    for (const [path, body] of routes) {
      const anonymous = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(anonymous.status, path).toBe(401);
      expect(await anonymous.json()).toMatchObject({ error: { code: "unauthenticated" } });
    }

    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    for (const [path, body] of routes) {
      const early = await b.fetch(path, { json: body });
      expect(early.status, path).toBe(403);
      expect(await early.json()).toMatchObject({ error: { code: "onboarding_required" } });
    }

    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Mover" } });
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);
    for (const [path, body] of routes) {
      const stale = await b.fetch(path, { json: body });
      expect(stale.status, path).toBe(403);
      expect(await stale.json()).toMatchObject({ error: { code: "reauth_required" } });
    }
    const { flowId: reauthFlow } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    expect((await b.fetch("/api/auth/reauth", { json: { method: "email", flowId: reauthFlow, code: mailer.lastCodeFor(email) } })).status).toBe(200);

    const malformed = await b.fetch("/api/auth/email/change/start", { json: { email: "not an address" } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
    const started = await b.fetch("/api/auth/email/change/start", { json: { email: newAddress } });
    expect(started.status).toBe(200);
    const { flowId } = FlowResponse.parse(await started.json());
    const verified = await b.fetch("/api/auth/email/change/verify", { json: { flowId, code: mailer.lastCodeFor(newAddress) } });
    expect(verified.status).toBe(200);
    expect(EmailChangeResponse.parse(await verified.json())).toEqual({ email: newAddress });
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.email).toBe(newAddress);
    expect(mailer.sent.at(-1)).toMatchObject({ to: email, template: "email_changed", data: { email: newAddress } });
  });

  test("the undo link of an email change needs no session: a malformed token is 400, the right one 204 with every session signed out, a used one 400", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Undo" } });
    const newAddress = `http-undo-${randomUUID()}@korbat.local`;
    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/email/change/start", { json: { email: newAddress } })).json());
    expect((await b.fetch("/api/auth/email/change/verify", { json: { flowId, code: mailer.lastCodeFor(newAddress) } })).status).toBe(200);
    const notice = mailer.sent.at(-1)!;
    expect(notice).toMatchObject({ to: email, template: "email_changed" });
    const token = /\/email-revert\/([A-Za-z0-9_-]{43})$/.exec(notice.data.revertUrl ?? "")?.[1];
    expect(token).toBeDefined();

    // Opened in a browser that holds no session: the link is the only credential.
    const stranger = new Browser(app, config.APP_ORIGIN);
    for (const body of [{ token: "not-a-token" }, { token: `${token!.slice(1)}/` }, {}]) {
      const malformed = await stranger.fetch("/api/auth/email/revert", { json: body });
      expect(malformed.status, JSON.stringify(body)).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    const reverted = await stranger.fetch("/api/auth/email/revert", { json: { token } });
    expect(reverted.status).toBe(204);
    expect(await reverted.text()).toBe("");
    expect((await b.fetch("/api/me")).status).toBe(401);
    expect((await auth.deps.repo.findUserByEmail(email))?.email).toBe(email);
    expect(await auth.deps.repo.findUserByEmail(newAddress)).toBeUndefined();
    expect(mailer.sent.at(-1)).toMatchObject({ to: email, template: "email_change_reverted" });
    const used = await stranger.fetch("/api/auth/email/revert", { json: { token } });
    expect(used.status).toBe(400);
    expect(await used.json()).toMatchObject({ error: { code: "invalid_code" } });
  });

  test("staff-only routes require a staff role and MFA", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Staff" } });
    const regular = await b.fetch("/api/test/staff-only");
    expect(regular.status).toBe(403);
    expect(await regular.json()).toMatchObject({ error: { code: "forbidden" } });

    const user = (await auth.deps.repo.findUserByEmail(email))!;
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.setRole(user.id, "moderator");
    await auth.deps.kv.del(`sess:2:${sessionId}`);
    const withoutMfa = await b.fetch("/api/test/staff-only");
    expect(withoutMfa.status).toBe(403);
    expect(await withoutMfa.json()).toMatchObject({ error: { code: "staff_mfa_required" } });

    await auth.deps.repo.enableTotp(user.id, { secretEnc: "v1:unused", recoveryCodesHash: [], now: new Date() });
    await auth.deps.kv.del(`sess:2:${sessionId}`);
    expect((await b.fetch("/api/test/staff-only")).status).toBe(200);
  });

  test("signing out clears both cookies and ends the session", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    const token = b.cookie("__Host-korbat_session")!;
    const signedOut = await b.fetch("/api/auth/signout", { method: "POST" });
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers.getSetCookie().filter((c) => c.includes("Max-Age=0"))).toHaveLength(2);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);
  });

  test("validation and flow errors use the error envelope with the request id", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const invalid = await b.fetch("/api/auth/email/verify", { json: { flowId: "nope", code: "12" } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_request" } });

    const unknown = await b.fetch("/api/auth/email/verify", { json: { flowId: randomToken(), code: "123456" } });
    expect(unknown.status).toBe(400);
    const body = ErrorEnvelope.parse(await unknown.json());
    expect(body.error.code).toBe("invalid_code");
    expect(body.error.requestId).toBe(unknown.headers.get("x-request-id"));
  });
});
```

### Replace `apps/api/test/integration/http-badge.test.ts` (whole file)

```ts
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BadgeVerifyResponse, ErrorEnvelope, FlowResponse, MeResponse, ProfileView } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { phoneHash } from "../../src/auth/identifiers";
import { MemoryKv } from "../../src/auth/kv";
import { DEV_CODE, devProvider } from "../../src/auth/verify/dev";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { Browser } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `b${randomBytes(4).toString("hex")}`;
/** A distinct number per use, so the per-number limit of one test never reaches another. */
const newPhone = () => `+4477${String(randomInt(10_000_000, 100_000_000))}`;

/**
 * The badge routes through the real app: 1a sign-up for the accounts, cookie sessions with CSRF, the
 * auth module's freshness check, the development provider, the real profile store (so /me and the
 * public profile read verified_at) and the unique index on the phone hash.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the verified badge over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  /** The same server with the provider off, as a korbat without an SMS account runs. */
  let appOff: App;
  const mailer = new MemoryMailer();

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const shared = { config, logger, authDb, mailer, turnstile: { verify: async () => true }, breachChecker: { isBreached: async () => false } };
    auth = createAuth({ ...shared, kv: new MemoryKv(), profiles: createProfileStore(apiDb), verify: devProvider() });
    const rateLimitStore = new MemoryStore();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), events: { append: auth.appendEvent } });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social });
    const authOff = createAuth({ ...shared, kv: new MemoryKv(), profiles: createProfileStore(apiDb) });
    appOff = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth: authOff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account on the given app, onboarded unless told otherwise. */
  async function signUp(on: App = app, onboard = true) {
    const b = new Browser(on, config.APP_ORIGIN);
    const email = `badge-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, email, handle, userId: me.user.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);
  const verifiedOnMe = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).profile!.verified;
  const verifiedInPublic = async (handle: string) => ProfileView.parse(await (await app.request(`/api/profiles/${handle}`)).json()).verified;
  const storedHash = async (userId: string) => (await auth.deps.repo.findUserById(userId))!.phoneHash;
  const mailsTo = (email: string) => mailer.sent.filter((m) => m.to === email).map((m) => m.template);

  /** Starts a verification for the number and returns the flow id. */
  async function start(b: Browser, phone: string) {
    const res = await b.fetch("/api/auth/badge/start", { json: { phone } });
    expect(res.status).toBe(200);
    return FlowResponse.parse(await res.json()).flowId;
  }
  const verify = (b: Browser, flowId: string, code: string) => b.fetch("/api/auth/badge/verify", { json: { flowId, code } });

  test("all three routes need an onboarded, fresh session", async () => {
    const routes = [
      ["POST", "/api/auth/badge/start", { phone: newPhone() }],
      ["POST", "/api/auth/badge/verify", { flowId: randomToken(), code: DEV_CODE }],
      ["DELETE", "/api/auth/badge", undefined],
    ] as const;
    for (const [method, path, body] of routes) {
      const anonymous = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(anonymous.status, path).toBe(401);
      expect(await errorCode(anonymous), path).toBe("unauthenticated");
    }
    const notOnboarded = await signUp(app, false);
    for (const [method, path, body] of routes) {
      const early = await notOnboarded.b.fetch(path, { method, json: body });
      expect(early.status, path).toBe(403);
      expect(await errorCode(early), path).toBe("onboarding_required");
    }
    const stale = await signUp();
    await makeStale(stale.b);
    for (const [method, path, body] of routes) {
      const refused = await stale.b.fetch(path, { method, json: body });
      expect(refused.status, path).toBe(403);
      expect(await errorCode(refused), path).toBe("reauth_required");
    }
  });

  test("the development provider end to end: a wrong code, the right one, the badge on /me and the public profile, the notices and events, then removal", async () => {
    const ada = await signUp();
    const phone = newPhone();
    const malformed = await ada.b.fetch("/api/auth/badge/start", { json: { phone: "0044 7911" } });
    expect(malformed.status).toBe(400);
    expect(await errorCode(malformed)).toBe("invalid_request");
    const flowId = await start(ada.b, phone);
    const wrong = await verify(ada.b, flowId, "123456");
    expect(wrong.status).toBe(400);
    expect(await errorCode(wrong)).toBe("invalid_code");
    expect(await verifiedOnMe(ada.b)).toBe(false);

    const right = await verify(ada.b, flowId, DEV_CODE);
    expect(right.status).toBe(200);
    expect(BadgeVerifyResponse.parse(await right.json())).toEqual({ verified: true });
    expect(await verifiedOnMe(ada.b)).toBe(true);
    expect(await verifiedInPublic(ada.handle)).toBe(true);
    expect(await storedHash(ada.userId)).toBe(phoneHash(auth.deps.config.authHmacKey, phone));
    expect(mailsTo(ada.email).at(-1)).toBe("badge_verified");
    expect(await eventTypes(ada.userId)).toContain("badge_verified");
    const replay = await verify(ada.b, flowId, DEV_CODE);
    expect(replay.status).toBe(400);
    expect(await errorCode(replay)).toBe("invalid_code");

    expect((await ada.b.fetch("/api/auth/badge", { method: "DELETE" })).status).toBe(204);
    expect(await verifiedOnMe(ada.b)).toBe(false);
    expect(await verifiedInPublic(ada.handle)).toBe(false);
    expect(await storedHash(ada.userId)).toBeNull();
    expect(mailsTo(ada.email).at(-1)).toBe("badge_removed");
    expect(await eventTypes(ada.userId)).toContain("badge_removed");
    // Removing a badge the account does not hold answers the same and tells nobody.
    const before = mailer.sent.length;
    expect((await ada.b.fetch("/api/auth/badge", { method: "DELETE" })).status).toBe(204);
    expect(mailer.sent).toHaveLength(before);
    // Nothing that left the server carries the number.
    expect(JSON.stringify(mailer.sent)).not.toContain(phone);
  });

  test("one number per account: the second account learns of the conflict only after its code, and the first keeps the badge", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const phone = newPhone();
    expect((await verify(ada.b, await start(ada.b, phone), DEV_CODE)).status).toBe(200);
    // The start answers alike for a number another account holds: nothing is revealed before the code proves the phone.
    const bobFlow = await start(bob.b, phone);
    const conflict = await verify(bob.b, bobFlow, DEV_CODE);
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe("phone_in_use");
    expect(await verifiedOnMe(ada.b)).toBe(true);
    expect(await verifiedOnMe(bob.b)).toBe(false);
    expect(await storedHash(bob.userId)).toBeNull();
    expect(await eventTypes(bob.userId)).not.toContain("badge_verified");
    // The holder can verify the same number again without conflict.
    expect((await verify(ada.b, await start(ada.b, phone), DEV_CODE)).status).toBe(200);
    expect(await verifiedOnMe(ada.b)).toBe(true);
  });

  test("with the provider off the badge routes answer badge_unavailable, and a badge can still be removed", async () => {
    const ada = await signUp(appOff);
    const started = await ada.b.fetch("/api/auth/badge/start", { json: { phone: newPhone() } });
    expect(started.status).toBe(404);
    expect(await errorCode(started)).toBe("badge_unavailable");
    const verified = await ada.b.fetch("/api/auth/badge/verify", { json: { flowId: randomToken(), code: DEV_CODE } });
    expect(verified.status).toBe(404);
    expect(await errorCode(verified)).toBe("badge_unavailable");
    expect((await ada.b.fetch("/api/auth/badge", { method: "DELETE" })).status).toBe(204);
  });
});
```

### Replace `apps/api/test/integration/http-deletion.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DeleteStartResponse, ErrorEnvelope, FlowResponse, MeResponse, PostView, SessionResult } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { Browser, NativeClient } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `del${randomBytes(4).toString("hex")}`;

/**
 * The deletion routes through the real app: 1a sign-up for the accounts, cookie and bearer sessions,
 * the auth module's freshness check, and the four modules wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: account deletion over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-deletion-"));
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, events: { append: auth.appendEvent } });
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: media.forAccount,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `deletion-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, email, handle, userId: me.user.id };
  }

  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const startOf = (b: Browser) => b.fetch("/api/account/delete/start", { method: "POST" });
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionIdOf(b)}`);
  }

  test("both routes need an onboarded, fresh session", async () => {
    const confirmBody = JSON.stringify({ flowId: randomToken(), code: "123456", handle: "nobody" });
    for (const [path, body] of [
      ["/api/account/delete/start", undefined],
      ["/api/account/delete/confirm", confirmBody],
    ] as const) {
      const anonymous = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body });
      expect(anonymous.status, path).toBe(401);
      expect((await error(anonymous)).code, path).toBe("unauthenticated");
    }
    const notOnboarded = await signUp(false);
    const early = await startOf(notOnboarded.b);
    expect(early.status).toBe(403);
    expect((await error(early)).code).toBe("onboarding_required");
    const earlyConfirm = await notOnboarded.b.fetch("/api/account/delete/confirm", { json: { flowId: randomToken(), code: "123456", handle: "nobody" } });
    expect(earlyConfirm.status).toBe(403);
    expect((await error(earlyConfirm)).code).toBe("onboarding_required");

    const stale = await signUp();
    await makeStale(stale.b);
    const refused = await startOf(stale.b);
    expect(refused.status).toBe(403);
    expect((await error(refused)).code).toBe("reauth_required");
    const refusedConfirm = await stale.b.fetch("/api/account/delete/confirm", { json: { flowId: randomToken(), code: "123456", handle: stale.handle } });
    expect(refusedConfirm.status).toBe(403);
    expect((await error(refusedConfirm)).code).toBe("reauth_required");
    // Nothing was sent or changed for a refused start.
    expect(mailer.sent.filter((mail) => mail.to === stale.email).map((mail) => mail.template)).toEqual(["sign_up_code"]);
    expect((await stale.b.fetch("/api/me")).status).toBe(200);
  });

  test("the typed handle must be the account's own, then the code must be right", async () => {
    const ada = await signUp();
    const started = await startOf(ada.b);
    expect(started.status).toBe(200);
    const { flowId } = DeleteStartResponse.parse(await started.json());
    const code = mailer.lastCodeFor(ada.email)!;
    expect(mailer.sent.filter((mail) => mail.to === ada.email).map((mail) => mail.template)).toEqual(["sign_up_code", "delete_account_code"]);

    const mismatch = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code, handle: "someone_else" } });
    expect(mismatch.status).toBe(400);
    expect(await error(mismatch)).toMatchObject({ code: "invalid_request", message: "handle_mismatch" });
    const wrong = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code: String((Number(code) + 1) % 1_000_000).padStart(6, "0"), handle: ada.handle } });
    expect(wrong.status).toBe(400);
    expect((await error(wrong)).code).toBe("invalid_code");
    // Still signed in, still there.
    expect((await ada.b.fetch("/api/me")).status).toBe(200);
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(200);
  });

  test("a web session's deletion answers 204 with both cookies cleared, and leaves nothing of the account reachable", async () => {
    const ada = await signUp();
    const created = await ada.b.fetch("/api/posts", { json: { body: "soon gone" } });
    expect(created.status).toBe(201);
    const post = PostView.parse(await created.json());
    const token = ada.b.cookie("__Host-korbat_session")!;
    const { flowId } = DeleteStartResponse.parse(await (await startOf(ada.b)).json());
    const confirmed = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code: mailer.lastCodeFor(ada.email)!, handle: ada.handle.toUpperCase() } });
    expect(confirmed.status).toBe(204);
    expect(confirmed.headers.getSetCookie().filter((c) => c.includes("Max-Age=0"))).toHaveLength(2);
    expect(ada.b.cookie("__Host-korbat_session")).toBeUndefined();
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(404);
    expect((await app.request(`/api/posts/${post.id}`)).status).toBe(404);
    expect(mailer.sent.filter((mail) => mail.to === ada.email).map((mail) => mail.template)).toEqual(["sign_up_code", "delete_account_code", "account_deleted"]);
    expect((await auth.deps.repo.recentEvents(ada.userId)).map((e) => e.type)).toContain("account_deleted");
    expect(await auth.deps.repo.pendingPurges()).not.toContain(ada.userId);
  });

  test("a native session gets a plain 204 without cookies, and its token stops working", async () => {
    const native = new NativeClient(app);
    const email = `deletion-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const { flowId } = FlowResponse.parse(await (await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } })).json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    native.token = SessionResult.parse(await (await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).json()).token;
    const onboarded = (await (await native.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Phone User" } })).json()) as { token: string };
    native.token = onboarded.token;

    const started = await native.fetch("/api/account/delete/start", { method: "POST" });
    expect(started.status).toBe(200);
    const deletion = DeleteStartResponse.parse(await started.json());
    const confirmed = await native.fetch("/api/account/delete/confirm", { json: { flowId: deletion.flowId, code: mailer.lastCodeFor(email)!, handle } });
    expect(confirmed.status).toBe(204);
    expect(confirmed.headers.getSetCookie()).toHaveLength(0);
    expect((await native.fetch("/api/me")).status).toBe(401);
    expect((await app.request(`/api/profiles/${handle}`)).status).toBe(404);
  });
});
```

### Replace `apps/api/test/integration/http-e2e.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  FlowResponse,
  MeResponse,
  RecoveryCodesResponse,
  SessionResult,
  SessionsResponse,
  SignInResponse,
  TotpSetupResponse,
} from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { emailHash } from "../../src/auth/identifiers";
import { hashPassword } from "../../src/auth/passwords";
import { currentStep, hotp } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { Browser, NativeClient } from "./http-client";
import { codeFrom, inbox, type Inbox } from "./mailpit";

const PASSWORD = "correct horse battery staple";
const SUBJECT = {
  signUp: "Your korbat sign-up code",
  signIn: "Your korbat sign-in code",
  newDevice: "New sign-in to your korbat account",
  locked: "Password sign-in paused on your korbat account",
  emailChangeCode: "Confirm your new korbat email address",
  emailChanged: "Your korbat email address changed",
  emailReverted: "Your korbat account is back at this address",
};

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;
const newHandle = () => `e_${randomBytes(6).toString("hex")}`;

/** The raw secret from an otpauth:// URI (RFC 4648 base32). */
function secretFromUri(uri: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const encoded = new URL(uri).searchParams.get("secret") ?? "";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of encoded.replace(/=+$/, "")) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * The whole auth module over HTTP with the real Redis store, real SMTP into Mailpit and a clock the
 * tests can move forward (for lockout expiry, the re-auth window and new TOTP steps).
 */
describe.skipIf(!process.env.INTEGRATION)("integration: auth end to end (Postgres, Redis, Mailpit)", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let redis: Redis;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  let offsetMs = 0;
  const now = () => new Date(Date.now() + offsetMs);
  const advance = (ms: number) => {
    offsetMs += ms;
  };

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    auth = createAuth({
      config,
      logger,
      authDb,
      // A fresh key prefix per run, so rate-limit counters from earlier runs never interfere.
      kv: redisKv(redis, `korbat:test:${randomUUID()}:`),
      mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async (token) => token !== "fail" },
      breachChecker: { isBreached: async () => false },
      now,
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  });

  const web = () => new Browser(app, config.APP_ORIGIN);

  /** An onboarded account created directly in the database, optionally with PASSWORD set. */
  async function existingAccount(options: { password?: boolean } = {}) {
    const email = newEmail("e2e");
    const user = await auth.deps.repo.createUser({ email, termsVersion: config.TERMS_VERSION, now: now() });
    await auth.deps.repo.markOnboarded(user.id, now());
    if (options.password) await auth.deps.repo.setPasswordHash(user.id, await hashPassword(PASSWORD), now());
    return { email, userId: user.id };
  }

  const passwordSignIn = (b: Browser, email: string, password: string, deviceId: string) =>
    b.fetch("/api/auth/password/signin", { json: { email, password, turnstileToken: "ok", deviceId, platform: "web" } });

  async function signInByCode(b: Browser, email: string, box: Inbox, deviceId: string) {
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId, platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    return b.fetch("/api/auth/email/verify", { json: { flowId, code: codeFrom(await box.next(SUBJECT.signIn)) } });
  }

  async function signUpAndOnboard(b: Browser) {
    const email = newEmail("signup");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    const code = codeFrom(await box.next(SUBJECT.signUp));
    expect(await (await b.fetch("/api/auth/email/verify", { json: { flowId, code } })).json()).toEqual({ result: "signup_required" });
    const complete = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } });
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    const reused = await b.fetch("/api/auth/email/verify", { json: { flowId, code } });
    expect(reused.status).toBe(400);
    const handle = newHandle();
    const onboarded = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "End To End" } });
    expect(onboarded.status).toBe(200);
    return { email, handle, box };
  }

  test("sign-up through onboarding with codes read from Mailpit", async () => {
    const b = web();
    const { email, handle } = await signUpAndOnboard(b);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(me.user).toMatchObject({ email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: false });
    expect(me.profile?.handle).toBe(handle);
  });

  test("sign-in by email code on a new device sends an alert whose link signs out everywhere and removes the password", async () => {
    const { email } = await existingAccount({ password: true });
    const box = await inbox(email);
    const phone = new NativeClient(app);
    const phoneSignIn = await phone.fetch("/api/auth/password/signin", {
      json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" },
    });
    phone.token = SessionResult.parse(await phoneSignIn.json()).token;

    const laptop = web();
    const signedIn = await signInByCode(laptop, email, box, randomToken());
    expect(await signedIn.json()).toEqual({ result: "session", mustReenrollMfa: false });
    const alert = await box.next(SUBJECT.newDevice);
    const token = /\/not-me\/([A-Za-z0-9_-]{43})/.exec(alert)?.[1];
    expect(token).toBeDefined();
    expect((await laptop.fetch("/api/me")).status).toBe(200);
    expect((await phone.fetch("/api/me")).status).toBe(200);

    const stranger = web();
    expect((await stranger.fetch("/api/auth/not-me", { json: { token } })).status).toBe(204);
    expect((await laptop.fetch("/api/me")).status).toBe(401);
    expect((await phone.fetch("/api/me")).status).toBe(401);
    const withPassword = await passwordSignIn(web(), email, PASSWORD, randomToken());
    expect(withPassword.status).toBe(401);
    expect(await withPassword.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    expect((await stranger.fetch("/api/auth/not-me", { json: { token } })).status).toBe(400);
  });

  test("five wrong passwords pause password sign-in and send a notice; email codes still work; the pause lifts after 15 minutes", async () => {
    const { email } = await existingAccount({ password: true });
    const box = await inbox(email);
    const b = web();
    const deviceId = randomToken();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await passwordSignIn(b, email, "not the right password", deviceId)).status).toBe(401);
    }
    expect(await box.next(SUBJECT.locked)).toContain("15 minutes");

    const whileLocked = await passwordSignIn(b, email, PASSWORD, deviceId);
    expect(whileLocked.status).toBe(401);
    expect(await whileLocked.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    expect(await (await signInByCode(b, email, box, deviceId)).json()).toEqual({ result: "session", mustReenrollMfa: false });

    advance(15 * 60_000 + 1000);
    const afterPause = await passwordSignIn(web(), email, PASSWORD, deviceId);
    expect(afterPause.status).toBe(200);
    expect(await afterPause.json()).toEqual({ result: "session", mustReenrollMfa: false });
  });

  test("MFA: setup, sign-in challenge, replay rejected, recovery code, re-enrolment and disable", { timeout: 60_000 }, async () => {
    const b = web();
    const { email } = await signUpAndOnboard(b);
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);

    const totpNow = (secret: Uint8Array) => hotp(secret, currentStep(now().getTime()));
    const enrol = async () => {
      const setup = TotpSetupResponse.parse(await (await b.fetch("/api/auth/mfa/totp/setup", { method: "POST" })).json());
      const secret = secretFromUri(setup.otpauthUri);
      const code = totpNow(secret);
      const confirm = await b.fetch("/api/auth/mfa/totp/confirm", { json: { code } });
      expect(confirm.status).toBe(200);
      return { secret, code, recoveryCodes: RecoveryCodesResponse.parse(await confirm.json()).recoveryCodes };
    };
    const signOut = async () => expect((await b.fetch("/api/auth/signout", { method: "POST" })).status).toBe(204);
    const deviceId = randomToken();
    const challenge = async () => {
      const body = SignInResponse.parse(await (await passwordSignIn(b, email, PASSWORD, deviceId)).json());
      if (body.result !== "mfa_required") throw new Error(`expected an MFA challenge, got ${body.result}`);
      return body.mfaTicket;
    };
    const verify = (mfaTicket: string, second: { code: string } | { recoveryCode: string }) => b.fetch("/api/auth/mfa/verify", { json: { mfaTicket, ...second } });

    const first = await enrol();
    await signOut();

    let ticket = await challenge();
    const replay = await verify(ticket, { code: first.code });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: { code: "invalid_mfa_code" } });
    advance(30_000);
    expect(await (await verify(ticket, { code: totpNow(first.secret) })).json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(true);
    await signOut();

    ticket = await challenge();
    expect(await (await verify(ticket, { recoveryCode: first.recoveryCodes[0]! })).json()).toEqual({ result: "session", mustReenrollMfa: true });
    await signOut();
    ticket = await challenge();
    expect((await verify(ticket, { recoveryCode: first.recoveryCodes[0]! })).status).toBe(401);
    advance(30_000);
    expect((await verify(ticket, { code: totpNow(first.secret) })).status).toBe(200);

    const second = await enrol();
    expect(second.recoveryCodes).not.toEqual(first.recoveryCodes);
    advance(30_000);
    // No code: the sign-in's password and TOTP code, minutes ago, are the level-2 proof the route asks for (1c design, section 2).
    expect((await b.fetch("/api/auth/mfa/totp/disable", { json: {} })).status).toBe(204);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(false);
  });

  test("session list, revoking one session, and revoke-all behind re-authentication", async () => {
    const { email } = await existingAccount({ password: true });
    const laptop = web();
    expect((await passwordSignIn(laptop, email, PASSWORD, randomToken())).status).toBe(200);
    const phone = new NativeClient(app);
    const phoneDevice = randomToken();
    const phoneSignIn = async () => {
      const res = await phone.fetch("/api/auth/password/signin", { json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: phoneDevice, platform: "ios" } });
      phone.token = SessionResult.parse(await res.json()).token;
    };
    await phoneSignIn();

    const { sessions } = SessionsResponse.parse(await (await laptop.fetch("/api/auth/sessions")).json());
    expect(sessions).toHaveLength(2);
    const other = sessions.find((s) => !s.current)!;
    expect(other.platform).toBe("ios");
    // The phone re-authenticates after the laptop listed it and before the laptop's revoke lands: its token rotates, and
    // the id the list gave, the session's handle, still names it.
    const listedToken = phone.token!;
    const reauthed = await phone.fetch("/api/auth/reauth", { json: { method: "password", password: PASSWORD } });
    expect(reauthed.status).toBe(200);
    phone.token = ((await reauthed.json()) as { token: string }).token;
    expect(phone.token).not.toBe(listedToken);
    expect((await phone.fetch("/api/me")).status).toBe(200);
    expect((await laptop.fetch(`/api/auth/sessions/${other.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await phone.fetch("/api/me")).status).toBe(401);
    expect((await laptop.fetch(`/api/auth/sessions/${other.id}`, { method: "DELETE" })).status).toBe(404);

    await phoneSignIn();
    advance(6 * 60_000);
    const stale = await laptop.fetch("/api/auth/sessions/revoke-all", { method: "POST" });
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: { code: "reauth_required" } });
    const reauth = await laptop.fetch("/api/auth/reauth", { json: { method: "password", password: PASSWORD } });
    expect(reauth.status).toBe(200);
    expect(await reauth.json()).toEqual({ level: 1 });
    expect((await laptop.fetch("/api/auth/sessions/revoke-all", { method: "POST" })).status).toBe(204);
    expect((await laptop.fetch("/api/me")).status).toBe(401);
    expect((await phone.fetch("/api/me")).status).toBe(401);
  });

  test("moving the account to a new address: the code goes to the new mailbox, the old address is told, and only the new address signs in", { timeout: 60_000 }, async () => {
    const b = web();
    const { email: oldAddress, box: oldBox } = await signUpAndOnboard(b);
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);

    // An address that already has an account gets its code like any other; the refusal waits for the code to prove the mailbox.
    const taken = await existingAccount();
    const takenBox = await inbox(taken.email);
    const conflict = await b.fetch("/api/auth/email/change/start", { json: { email: taken.email } });
    expect(conflict.status).toBe(200);
    const conflictFlow = FlowResponse.parse(await conflict.json());
    const conflictCode = codeFrom(await takenBox.next(SUBJECT.emailChangeCode));
    const refused = await b.fetch("/api/auth/email/change/verify", { json: { flowId: conflictFlow.flowId, code: conflictCode } });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "email_in_use" } });

    const newAddress = newEmail("moved");
    const newBox = await inbox(newAddress);
    const started = await b.fetch("/api/auth/email/change/start", { json: { email: newAddress } });
    expect(started.status).toBe(200);
    const { flowId } = FlowResponse.parse(await started.json());
    const code = codeFrom(await newBox.next(SUBJECT.emailChangeCode));
    const verified = await b.fetch("/api/auth/email/change/verify", { json: { flowId, code } });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ email: newAddress });
    expect(await oldBox.next(SUBJECT.emailChanged)).toContain(newAddress);

    // The session that made the change stays signed in and sees the new address.
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(me.user.email).toBe(newAddress);
    expect((await auth.deps.repo.recentEvents(me.user.id)).map((e) => e.type)).toContain("email_changed");

    const oldSignIn = await passwordSignIn(web(), oldAddress, PASSWORD, randomToken());
    expect(oldSignIn.status).toBe(401);
    expect(await oldSignIn.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    const newSignIn = await passwordSignIn(web(), newAddress, PASSWORD, randomToken());
    expect(newSignIn.status).toBe(200);
    expect(await newSignIn.json()).toEqual({ result: "session", mustReenrollMfa: false });
  });

  test("an email change undone from the old mailbox: the account moves back, the taker's sessions and password go, and the owner signs in at the old address with a code", { timeout: 60_000 }, async () => {
    const owner = web();
    const { email: oldAddress, box: oldBox } = await signUpAndOnboard(owner);
    const ownerId = MeResponse.parse(await (await owner.fetch("/api/me")).json()).user.id;
    // An address waits a minute between codes, in real time in Redis; the test clears that wait instead of sitting through it.
    const skipCooldown = () => auth.deps.kv.del(`email-cooldown:${emailHash(auth.deps.config.authHmacKey, oldAddress)}`);
    // Someone else gets into the account (here with a code from the owner's mailbox), moves it to an address of their own and sets a password there.
    await skipCooldown();
    const taker = web();
    expect(await (await signInByCode(taker, oldAddress, oldBox, randomToken())).json()).toEqual({ result: "session", mustReenrollMfa: false });
    const takerAddress = newEmail("taker");
    const takerBox = await inbox(takerAddress);
    const started = await taker.fetch("/api/auth/email/change/start", { json: { email: takerAddress } });
    expect(started.status).toBe(200);
    const { flowId } = FlowResponse.parse(await started.json());
    const code = codeFrom(await takerBox.next(SUBJECT.emailChangeCode));
    expect((await taker.fetch("/api/auth/email/change/verify", { json: { flowId, code } })).status).toBe(200);
    expect((await taker.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);
    expect((await passwordSignIn(web(), takerAddress, PASSWORD, randomToken())).status).toBe(200);

    // The notice in the old mailbox carries the link; a browser without any session opens it.
    const notice = await oldBox.next(SUBJECT.emailChanged);
    expect(notice).toContain(takerAddress);
    const token = /\/email-revert\/([A-Za-z0-9_-]{43})/.exec(notice)?.[1];
    expect(token).toBeDefined();
    expect((await web().fetch("/api/auth/email/revert", { json: { token } })).status).toBe(204);
    expect(await oldBox.next(SUBJECT.emailReverted)).toMatch(/every session/i);

    // Every session is gone, the taker's and the owner's own, and so is the password set after the change. Every device is
    // revoked too, so the taker's next sign-in on theirs counts as a new device and the owner is told of it.
    expect(await auth.deps.repo.listDevices(ownerId)).toEqual([]);
    expect((await taker.fetch("/api/me")).status).toBe(401);
    expect((await owner.fetch("/api/me")).status).toBe(401);
    for (const address of [takerAddress, oldAddress]) {
      const refused = await passwordSignIn(web(), address, PASSWORD, randomToken());
      expect(refused.status, address).toBe(401);
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    }
    // The owner signs in at the old address with a code from the old mailbox.
    await skipCooldown();
    const back = web();
    expect(await (await signInByCode(back, oldAddress, oldBox, randomToken())).json()).toEqual({ result: "session", mustReenrollMfa: false });
    const me = MeResponse.parse(await (await back.fetch("/api/me")).json());
    expect(me.user).toMatchObject({ email: oldAddress, hasPassword: false });
    expect((await auth.deps.repo.recentEvents(me.user.id)).filter((e) => e.type === "email_changed")).toHaveLength(2);
    expect((await web().fetch("/api/auth/email/revert", { json: { token } })).status).toBe(400);
  });

  test("an under-16 sign-up is refused and leaves no account behind", async () => {
    const b = web();
    const email = newEmail("young");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    const code = codeFrom(await box.next(SUBJECT.signUp));
    expect(await (await b.fetch("/api/auth/email/verify", { json: { flowId, code } })).json()).toEqual({ result: "signup_required" });

    const dateOfBirth = `${now().getUTCFullYear() - 15}-01-01`;
    const refused = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth, termsVersion: config.TERMS_VERSION } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "age_requirement" } });
    expect(await auth.deps.repo.findUserByEmail(email)).toBeFalsy();

    const retry = await web().fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(retry.status).toBe(403);
    expect(await retry.json()).toMatchObject({ error: { code: "age_requirement" } });
  });

  test("the API database role cannot read auth events", async () => {
    const failure = await apiDb.execute(sql`select id from auth.auth_events limit 1`).then(
      () => null,
      (err: unknown) => err,
    );
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied/);
  });
});
```

### Replace `apps/api/test/integration/http-passkey-signin.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, PasskeyOptionsResponse, ReauthResponse, SessionResult } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { encrypt, randomToken } from "../../src/auth/crypto";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { Browser, NativeClient } from "./http-client";
import { codeFrom, inbox } from "./mailpit";

const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SUBJECT = { signUp: "Your korbat sign-up code" };

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;
const newHandle = () => `s_${randomBytes(6).toString("hex")}`;

/**
 * The passkey sign-in and re-authentication-options routes over HTTP (1c design, sections 7.2, 7.4 and 10): their guards
 * and limits, the web cookies and the bearer token on a sign-in, and the TOTP step's answer shape.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the passkey sign-in routes over HTTP (Postgres, Redis, Mailpit)", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let redis: Redis;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: redisKv(redis, `korbat:test:${randomUUID()}:`),
      mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  });

  const web = () => new Browser(app, config.APP_ORIGIN);
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const userIdOf = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;

  /** A signed-up, onboarded web account with codes read from Mailpit. */
  async function signUp() {
    const b = web();
    const email = newEmail("signin");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: codeFrom(await box.next(SUBJECT.signUp)) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Passkey User" } })).status).toBe(200);
    return { b, email, userId: await userIdOf(b) };
  }

  /** Registers a passkey on the signed-in browser and answers the authenticator that holds it and its credential id. */
  async function register(b: Browser, flags: SoftFlags = ALL) {
    const optionsRes = await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } });
    expect(optionsRes.status).toBe(200);
    const options = PasskeyOptionsResponse.parse(await optionsRes.json()).options as unknown as PublicKeyCredentialCreationOptionsJSON;
    const authenticator = new SoftAuthenticator();
    const response = authenticator.create({ rpId: options.rp.id!, challenge: options.challenge, origin: config.APP_ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
    expect((await b.fetch("/api/auth/passkeys/register/verify", { json: { response } })).status).toBe(200);
    return { authenticator, credentialId: response.id };
  }

  /** TOTP on, as the confirm step leaves it; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(userId: string) {
    const secret = newTotpSecret();
    await auth.deps.repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(secret), auth.deps.config.totpKey), recoveryCodesHash: [], now: new Date() });
    await auth.deps.sessions.forgetUser(userId);
    return secret;
  }

  const signinOptions = async (client: Browser | NativeClient) => {
    const res = await client.fetch("/api/auth/passkey/signin/options", { method: "POST" });
    expect(res.status).toBe(200);
    return PasskeyOptionsResponse.parse(await res.json()).options as unknown as PublicKeyCredentialRequestOptionsJSON;
  };
  const assertion = (authenticator: SoftAuthenticator, options: PublicKeyCredentialRequestOptionsJSON, credentialId: string, flags: SoftFlags = ALL) =>
    authenticator.get({ credentialId, rpId: config.WEBAUTHN_RP_ID, challenge: options.challenge, origin: config.APP_ORIGIN, flags, counter: 0 });
  const signinVerify = (client: Browser | NativeClient, response: unknown, platform: "web" | "ios", deviceId = randomToken()) =>
    client.fetch("/api/auth/passkey/signin/verify", { json: { deviceId, platform, response } });
  /** The re-authentication options of the browser's session: its account's usable passkeys and a challenge bound to it. */
  const reauthOptions = async (b: Browser) => {
    const res = await b.fetch("/api/auth/reauth/passkey/options", { method: "POST" });
    expect(res.status).toBe(200);
    return PasskeyOptionsResponse.parse(await res.json()).options as unknown as PublicKeyCredentialRequestOptionsJSON;
  };

  test("the sign-in routes need no session; the verify body is validated; re-auth options need a session", { timeout: 60_000 }, async () => {
    const stranger = web();
    // Options are public and store nothing but the per-IP counter.
    const options = await signinOptions(stranger);
    expect(options.allowCredentials).toEqual([]);
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
    // A malformed verify body is a 400 before any lookup.
    const bad = await stranger.fetch("/api/auth/passkey/signin/verify", { json: { deviceId: "short", platform: "web", response: {} } });
    expect(bad.status).toBe(400);
    expect((await error(bad)).code).toBe("invalid_request");
    // Re-authentication options need an onboarded session.
    const noSession = await stranger.fetch("/api/auth/reauth/passkey/options", { method: "POST" });
    expect(noSession.status).toBe(401);
    expect((await error(noSession)).code).toBe("unauthenticated");
  });

  test("a web sign-in sets the session cookies and no token; a native sign-in returns the bearer token and no cookies", { timeout: 60_000 }, async () => {
    const { b } = await signUp();
    const { authenticator, credentialId } = await register(b);

    // Web: a fresh browser (a new device) signs in with the passkey and gets cookies only.
    const browser = web();
    const webRes = await signinVerify(browser, assertion(authenticator, await signinOptions(browser), credentialId), "web");
    expect(webRes.status).toBe(200);
    expect(await webRes.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(webRes.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session="))).toBe(true);
    expect(browser.cookie("__Host-korbat_session")).toBeDefined();
    expect((await browser.fetch("/api/me")).status).toBe(200);

    // Native: the bearer token comes back in the body, and no cookies are set.
    const phone = new NativeClient(app);
    const nativeRes = await signinVerify(phone, assertion(authenticator, await signinOptions(phone), credentialId), "ios");
    expect(nativeRes.status).toBe(200);
    const body = SessionResult.parse(await nativeRes.json());
    expect(body.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(nativeRes.headers.getSetCookie()).toHaveLength(0);
    phone.token = body.token;
    expect((await phone.fetch("/api/me")).status).toBe(200);
  });

  test("a sign-in assertion without the user handle is passkey_invalid, well-formed as it is; with the handle the same passkey signs in", { timeout: 60_000 }, async () => {
    const { b } = await signUp();
    const { authenticator, credentialId } = await register(b);
    const browser = web();
    const options = await signinOptions(browser);
    // The options named no account (the allow list is empty), so the response has to: a discoverable passkey always does.
    const withoutHandle = authenticator.get({ credentialId, rpId: config.WEBAUTHN_RP_ID, challenge: options.challenge, origin: config.APP_ORIGIN, flags: ALL, counter: 0, userHandle: null });
    expect("userHandle" in withoutHandle.response).toBe(false);
    const refused = await signinVerify(browser, withoutHandle, "web");
    expect(refused.status).toBe(401);
    expect((await error(refused)).code).toBe("passkey_invalid");
    expect(browser.cookie("__Host-korbat_session")).toBeUndefined();
    expect((await auth.deps.repo.findPasskeyByCredentialId(credentialId))!.lastUsedAt).toBeNull();

    const signedIn = await signinVerify(browser, assertion(authenticator, await signinOptions(browser), credentialId), "web");
    expect(signedIn.status).toBe(200);
    expect(browser.cookie("__Host-korbat_session")).toBeDefined();
  });

  test("re-authentication with a passkey over HTTP: the session's own passkey gives level 2 and a rotated cookie, with or without a user handle; another account's passkey is passkey_invalid and changes nothing", { timeout: 60_000 }, async () => {
    const ada = await signUp();
    const bob = await signUp();
    const { authenticator, credentialId } = await register(ada.b);

    // bob's session gets a challenge of its own and answers it with ada's passkey: the signature checks, the account does not.
    const bobsOptions = await reauthOptions(bob.b);
    expect(bobsOptions.allowCredentials).toEqual([]);
    const bobsCookie = bob.b.cookie("__Host-korbat_session");
    const foreign = await bob.b.fetch("/api/auth/reauth", { json: { method: "passkey", response: assertion(authenticator, bobsOptions, credentialId) } });
    expect(foreign.status).toBe(401);
    expect((await error(foreign)).code).toBe("passkey_invalid");
    expect(foreign.headers.getSetCookie()).toHaveLength(0);
    expect(bob.b.cookie("__Host-korbat_session")).toBe(bobsCookie);
    expect((await bob.b.fetch("/api/me")).status).toBe(200);
    expect((await auth.deps.repo.findPasskeyByCredentialId(credentialId))!).toMatchObject({ userId: ada.userId, counter: 0, lastUsedAt: null, suspectAt: null });
    // A level-1 route still passes on the sign-up's email code, a moment ago; nothing was added to bob's session.
    const bobsSession = (await auth.deps.sessions.resolve(bobsCookie!))!.session;
    expect(Object.keys(bobsSession.factors)).toEqual(["email"]);

    // ada's own session: the options list the passkey, and the assertion, here without a user handle as an authenticator
    // given an allow list may answer, re-authenticates at level 2.
    const adasOptions = await reauthOptions(ada.b);
    expect(adasOptions.allowCredentials!.map((c) => c.id)).toEqual([credentialId]);
    const adasCookie = ada.b.cookie("__Host-korbat_session")!;
    const withoutHandle = authenticator.get({ credentialId, rpId: config.WEBAUTHN_RP_ID, challenge: adasOptions.challenge, origin: config.APP_ORIGIN, flags: ALL, counter: 0, userHandle: null });
    const own = await ada.b.fetch("/api/auth/reauth", { json: { method: "passkey", response: withoutHandle } });
    expect(own.status).toBe(200);
    expect(ReauthResponse.parse(await own.json())).toEqual({ level: 2 });
    expect(ada.b.cookie("__Host-korbat_session")).not.toBe(adasCookie);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${adasCookie}` } })).status).toBe(401);
    expect((await ada.b.fetch("/api/me")).status).toBe(200);
    expect((await auth.deps.repo.findPasskeyByCredentialId(credentialId))!.lastUsedAt).not.toBeNull();
    // The challenge answered once.
    const replay = await ada.b.fetch("/api/auth/reauth", { json: { method: "passkey", response: withoutHandle } });
    expect(replay.status).toBe(401);
    expect((await error(replay)).code).toBe("passkey_invalid");
  });

  test("on an account with TOTP, a passkey registered with user verification but asserted without it stops at the TOTP step; asserted with it, it signs in", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    const { authenticator, credentialId } = await register(b, ALL);
    await withTotp(userId);

    const browser = web();
    const pending = await signinVerify(browser, assertion(authenticator, await signinOptions(browser), credentialId, BARE), "web");
    expect(pending.status).toBe(200);
    expect(((await pending.json()) as { result: string }).result).toBe("mfa_required");
    expect(browser.cookie("__Host-korbat_session")).toBeUndefined();

    const verified = await signinVerify(browser, assertion(authenticator, await signinOptions(browser), credentialId, ALL), "web");
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(browser.cookie("__Host-korbat_session")).toBeDefined();
  });

  test("on an account with TOTP, a passkey without user verification stops at the TOTP step, whose code completes the sign-in", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    const { authenticator, credentialId } = await register(b, BARE);
    const secret = await withTotp(userId);

    const browser = web();
    const pending = await signinVerify(browser, assertion(authenticator, await signinOptions(browser), credentialId), "web");
    expect(pending.status).toBe(200);
    const body = (await pending.json()) as { result: string; mfaTicket?: string };
    expect(body.result).toBe("mfa_required");
    expect(body.mfaTicket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(browser.cookie("__Host-korbat_session")).toBeUndefined();

    const done = await browser.fetch("/api/auth/mfa/verify", { json: { mfaTicket: body.mfaTicket, code: hotp(secret, currentStep(Date.now())) } });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(browser.cookie("__Host-korbat_session")).toBeDefined();
  });

  test("the limits: 30 options and 20 verifications per IP per 15 minutes, and 5 new-device sign-ins an hour per account", { timeout: 90_000 }, async () => {
    const limited = async (res: Response, retryAfter: number) => {
      expect(res.status).toBe(429);
      expect((await error(res)).code).toBe("rate_limited");
      expect(res.headers.get("retry-after")).toBe(String(retryAfter));
    };

    // Options: 30 per IP per 15 minutes.
    const optionsClient = web();
    for (let i = 0; i < 30; i++) expect((await optionsClient.fetch("/api/auth/passkey/signin/options", { method: "POST" })).status).toBe(200);
    await limited(await optionsClient.fetch("/api/auth/passkey/signin/options", { method: "POST" }), 900);

    // Verify: 20 per IP per 15 minutes, counted before the challenge, so a bogus assertion still counts.
    const verifyClient = web();
    const orphan = new SoftAuthenticator();
    const reg = orphan.create({ rpId: config.WEBAUTHN_RP_ID, challenge: (await signinOptions(verifyClient)).challenge, origin: config.APP_ORIGIN, userHandle: randomBytes(32), flags: ALL });
    const bogus = orphan.get({ credentialId: reg.id, rpId: config.WEBAUTHN_RP_ID, challenge: "not-a-real-challenge", origin: config.APP_ORIGIN, flags: ALL, counter: 0 });
    for (let i = 0; i < 20; i++) expect((await signinVerify(verifyClient, bogus, "web")).status).toBe(401);
    await limited(await signinVerify(verifyClient, bogus, "web"), 900);

    // New device: 5 an hour per account. A fresh client each time is a new device; the sixth is refused.
    const { b } = await signUp();
    const { authenticator, credentialId } = await register(b);
    for (let i = 0; i < 5; i++) {
      const client = web();
      expect((await signinVerify(client, assertion(authenticator, await signinOptions(client), credentialId), "web")).status).toBe(200);
    }
    const sixth = web();
    await limited(await signinVerify(sixth, assertion(authenticator, await signinOptions(sixth), credentialId), "web"), 3600);
  });
});
```

### Replace `apps/api/test/integration/http-passkeys.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { ErrorEnvelope, FlowResponse, MeResponse, PasskeyListResponse, PasskeyOptionsResponse, PasskeyView, ReauthResponse } from "@korbat/contracts";
import { closeDb, createDb, passkeys, sessions, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { encrypt, randomToken, sha256Hex } from "../../src/auth/crypto";
import type { PublicKeyCredentialCreationOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { Browser, NativeClient } from "./http-client";
import { codeFrom, inbox } from "./mailpit";

const PASSWORD = "correct horse battery staple";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const SUBJECT = {
  signUp: "Your korbat sign-up code",
  reauth: "Confirm it's you on korbat",
  passkeyAdded: "A passkey was added to your korbat account",
  passkeyRemoved: "A passkey was removed from your korbat account",
};
const PasskeyResponse = z.object({ passkey: PasskeyView });

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;
const newHandle = () => `p_${randomBytes(6).toString("hex")}`;

/**
 * The passkey routes over HTTP (1c design, section 10) with the real Redis store and real SMTP into Mailpit: every guard
 * and limit of registration, the list, rename, removal, "not mine" and the remove link, and strong freshness on the two
 * level-2 routes for an account with TOTP.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the passkey routes over HTTP (Postgres, Redis, Mailpit)", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let redis: Redis;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    auth = createAuth({
      config,
      logger,
      authDb,
      // A fresh key prefix per run, so rate-limit counters from earlier runs never interfere.
      kv: redisKv(redis, `korbat:test:${randomUUID()}:`),
      mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  });

  const web = () => new Browser(app, config.APP_ORIGIN);
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  const userIdOf = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;

  /** A signed-up web account with codes read from Mailpit, onboarded unless told otherwise; its session proved the sign-up's email code and nothing else. */
  async function signUp(options: { onboard?: boolean } = {}) {
    const b = web();
    const email = newEmail("passkeys");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: codeFrom(await box.next(SUBJECT.signUp)) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (options.onboard !== false) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Passkey User" } })).status).toBe(200);
    return { b, email, box, userId: await userIdOf(b) };
  }

  /** A second session of an account that holds PASSWORD, signed in with it from another browser (a code would wait on the address's one-minute cooldown). */
  async function secondSession(email: string) {
    const other = web();
    const signedIn = await other.fetch("/api/auth/password/signin", { json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(signedIn.status).toBe(200);
    expect((await other.fetch("/api/me")).status).toBe(200);
    return other;
  }

  /** TOTP on, as the confirm step leaves it; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(userId: string) {
    const secret = newTotpSecret();
    await auth.deps.repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(secret), auth.deps.config.totpKey), recoveryCodesHash: [], now: new Date() });
    await auth.deps.sessions.forgetUser(userId);
    return secret;
  }
  const totpNow = (secret: Uint8Array) => hotp(secret, currentStep(Date.now()));

  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionIdOf(b)}`);
  }

  const optionsFor = async (b: Browser, label = "ada") => {
    const res = await b.fetch("/api/auth/passkeys/register/options", { json: { label } });
    expect(res.status).toBe(200);
    // The contract checks the challenge only and passes the rest through; the test reads the options as the library wrote them.
    return PasskeyOptionsResponse.parse(await res.json()).options as unknown as PublicKeyCredentialCreationOptionsJSON;
  };
  const answer = (authenticator: SoftAuthenticator, options: PublicKeyCredentialCreationOptionsJSON, flags: SoftFlags = ALL) =>
    authenticator.create({ rpId: options.rp.id!, challenge: options.challenge, origin: config.APP_ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
  /** A whole registration over HTTP; answers the stored passkey's view. */
  async function register(b: Browser, name?: string) {
    const response = answer(new SoftAuthenticator(), await optionsFor(b));
    const res = await b.fetch("/api/auth/passkeys/register/verify", { json: name === undefined ? { response } : { name, response } });
    expect(res.status).toBe(200);
    return PasskeyResponse.parse(await res.json()).passkey;
  }
  const listed = async (b: Browser) => PasskeyListResponse.parse(await (await b.fetch("/api/auth/passkeys")).json()).passkeys;

  test("registration takes a session at onboarding scope: the options need strong freshness, the verification only its bound challenge; the list needs an onboarded session; me counts", { timeout: 60_000 }, async () => {
    const { b, box } = await signUp({ onboard: false });
    const options = await optionsFor(b, "ada on the laptop");
    expect(options.user.name).toBe("ada on the laptop");
    expect(options.rp).toEqual({ id: config.WEBAUTHN_RP_ID, name: config.WEBAUTHN_RP_NAME });
    // Bad input: an empty label.
    expect((await b.fetch("/api/auth/passkeys/register/options", { json: { label: "" } })).status).toBe(400);
    // A stale session gets no options; the ceremony it already started still completes.
    await makeStale(b);
    const refused = await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } });
    expect(refused.status).toBe(403);
    expect(await error(refused)).toMatchObject({ code: "reauth_required", details: { level: 1, have: [] } });
    const verify = await b.fetch("/api/auth/passkeys/register/verify", { json: { name: "Laptop", response: answer(new SoftAuthenticator(), options) } });
    expect(verify.status).toBe(200);
    const { passkey } = PasskeyResponse.parse(await verify.json());
    expect(passkey).toMatchObject({ name: "Laptop", synced: true, createdOn: "Browser on unknown OS", current: false, isNew: true, suspended: false });
    expect(await box.next(SUBJECT.passkeyAdded)).toMatch(/\/passkey-remove\/[A-Za-z0-9_-]{43}/);
    // The list waits for onboarding; me counts already.
    const early = await b.fetch("/api/auth/passkeys");
    expect(early.status).toBe(403);
    expect((await error(early)).code).toBe("onboarding_required");
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.passkeys).toBe(1);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Passkey User" } })).status).toBe(200);
    expect(await listed(b)).toEqual([passkey]);

    // Bad input: a name over the display-name rules, a response missing its attestation.
    expect((await b.fetch("/api/auth/passkeys/register/verify", { json: { name: "x".repeat(51), response: answer(new SoftAuthenticator(), options) } })).status).toBe(400);
    expect((await b.fetch("/api/auth/passkeys/register/verify", { json: { response: { id: "AAAA" } } })).status).toBe(400);

    // Without a session, both are unauthenticated.
    const stranger = web();
    for (const route of ["/api/auth/passkeys/register/options", "/api/auth/passkeys/register/verify"]) {
      const res = await stranger.fetch(route, { json: { label: "ada", response: answer(new SoftAuthenticator(), options) } });
      expect(res.status, route).toBe(401);
      expect((await error(res)).code, route).toBe("unauthenticated");
    }
    expect((await stranger.fetch("/api/auth/passkeys")).status).toBe(401);
  });

  test("on an account with TOTP, the options and the removal need level 2: a session with its email code alone is refused with what it lacks, and passes after a TOTP re-authentication", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    const passkey = await register(b, "Laptop");
    const secret = await withTotp(userId);
    const options = await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } });
    expect(options.status).toBe(403);
    expect(await error(options)).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["email"] } });
    const removal = await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" });
    expect(removal.status).toBe(403);
    expect(await error(removal)).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["email"] } });
    // Level 1 keeps its routes: the list, a rename and "not mine" on an unknown passkey answer for their own reasons.
    expect((await b.fetch("/api/auth/passkeys")).status).toBe(200);
    expect((await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: { name: "Renamed" } })).status).toBe(200);
    expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}/not-mine`, { method: "POST" })).status).toBe(404);

    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "totp", code: totpNow(secret) } });
    expect(reauth.status).toBe(200);
    expect(ReauthResponse.parse(await reauth.json())).toEqual({ level: 2 });
    expect((await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } })).status).toBe(200);
    expect((await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await listed(b)).toEqual([]);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.passkeys).toBe(0);
  });

  test("rename and removal act on the account's own passkeys only: another account's is 404, a malformed id or name is 400; the removal is mailed", { timeout: 60_000 }, async () => {
    const ada = await signUp();
    const bob = await signUp();
    const passkey = await register(ada.b, "Laptop");
    await ada.box.next(SUBJECT.passkeyAdded);
    for (const init of [{ method: "PATCH", json: { name: "Taken" } }, { method: "DELETE" }, { method: "POST" }] as const) {
      const route = init.method === "POST" ? `/api/auth/passkeys/${passkey.id}/not-mine` : `/api/auth/passkeys/${passkey.id}`;
      const res = await bob.b.fetch(route, init);
      expect(res.status, init.method).toBe(404);
      expect((await error(res)).code, init.method).toBe("passkey_not_found");
    }
    expect((await ada.b.fetch("/api/auth/passkeys/not-a-uuid", { method: "PATCH", json: { name: "Fine" } })).status).toBe(400);
    expect((await ada.b.fetch("/api/auth/passkeys/not-a-uuid", { method: "DELETE" })).status).toBe(400);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: { name: "" } })).status).toBe(400);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: {} })).status).toBe(400);
    expect(await listed(ada.b)).toEqual([passkey]);

    const renamed = await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "PATCH", json: { name: " Work laptop " } });
    expect(renamed.status).toBe(200);
    expect(PasskeyResponse.parse(await renamed.json()).passkey).toEqual({ ...passkey, name: "Work laptop" });
    expect((await listed(ada.b)).map((p) => p.name)).toEqual(["Work laptop"]);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await ada.box.next(SUBJECT.passkeyRemoved)).toContain('"Work laptop"');
    expect(await listed(ada.b)).toEqual([]);
    expect((await ada.b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(404);
    // Still signed in: a removal is not a lockdown.
    expect((await ada.b.fetch("/api/me")).status).toBe(200);
  });

  test("the limits: 10 options an hour per session, 30 renames and 10 removals an hour per account, 5 'not mine' lockdowns a day, 10 remove links an hour per address; each answers rate_limited with a Retry-After", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    const limited = async (res: Response, retryAfter: number) => {
      expect(res.status).toBe(429);
      expect((await error(res)).code).toBe("rate_limited");
      expect(res.headers.get("retry-after")).toBe(String(retryAfter));
    };
    for (let i = 0; i < 10; i++) expect((await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } })).status).toBe(200);
    await limited(await b.fetch("/api/auth/passkeys/register/options", { json: { label: "ada" } }), 3600);
    for (let i = 0; i < 30; i++) expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "PATCH", json: { name: "Name" } })).status).toBe(404);
    await limited(await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "PATCH", json: { name: "Name" } }), 3600);
    for (let i = 0; i < 10; i++) expect((await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "DELETE" })).status).toBe(404);
    await limited(await b.fetch(`/api/auth/passkeys/${randomUUID()}`, { method: "DELETE" }), 3600);
    // "Not mine" counts only the calls that will run the lockdown: a miss, which any session of the account can make, costs nothing.
    for (let i = 0; i < 7; i++) {
      const miss = await b.fetch(`/api/auth/passkeys/${randomUUID()}/not-mine`, { method: "POST" });
      expect(miss.status).toBe(404);
      expect((await error(miss)).code).toBe("passkey_not_found");
    }
    // Still signed in: none of the refusals was a lockdown.
    expect((await b.fetch("/api/me")).status).toBe(200);
    /** A call that will run the lockdown: a passkey added just now, named by a session of the account that is fresh now, on a device of its own. */
    const lockdownBound = async () => {
      const device = await auth.deps.repo.createDevice({ userId, deviceHash: randomToken(), label: "Phone", platform: "ios", ipHash: null });
      const issued = await auth.deps.sessions.issue(userId, device.id, { factors: { email: Date.now() } });
      const [row] = await authDb.insert(passkeys).values({ userId, credentialId: randomToken(), publicKey: "cose-key", name: "Passkey", createdAt: new Date() }).returning({ id: passkeys.id });
      const phone = new NativeClient(app);
      phone.token = issued.token;
      return { phone, res: await phone.fetch(`/api/auth/passkeys/${row!.id}/not-mine`, { method: "POST" }) };
    };
    for (let i = 0; i < 5; i++) {
      const { phone, res } = await lockdownBound();
      expect(res.status, `lockdown ${i + 1}`).toBe(204);
      expect((await phone.fetch("/api/me")).status).toBe(401);
    }
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(0);
    expect((await b.fetch("/api/me")).status).toBe(401);
    const sixth = await lockdownBound();
    await limited(sixth.res, 86400);
    // Refused before it ran: the sixth session is still signed in and its passkey is still there.
    expect((await sixth.phone.fetch("/api/me")).status).toBe(200);
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(1);
    expect((await auth.deps.repo.eventsSince(userId, new Date(0))).filter((e) => e.type === "passkey_removed")).toHaveLength(5);

    const stranger = web();
    for (let i = 0; i < 10; i++) {
      const res = await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token: randomToken() } });
      expect(res.status).toBe(400);
      expect((await error(res)).code).toBe("invalid_code");
    }
    await limited(await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token: randomToken() } }), 3600);
    expect((await web().fetch("/api/auth/passkeys/remove-link", { json: { token: randomToken() } })).status).toBe(400);
    expect((await web().fetch("/api/auth/passkeys/remove-link", { json: { token: "short" } })).status).toBe(400);
  });

  test("the remove link read from Mailpit removes the passkey, signs out every session and clears the password, once", { timeout: 60_000 }, async () => {
    const { b, email, box, userId } = await signUp();
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);
    const other = await secondSession(email);
    await register(b, "Laptop");
    const token = /\/passkey-remove\/([A-Za-z0-9_-]{43})/.exec(await box.next(SUBJECT.passkeyAdded))?.[1];
    expect(token).toBeDefined();
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(1);
    expect((await other.fetch("/api/me")).status).toBe(200);

    const stranger = web();
    expect((await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token } })).status).toBe(204);
    expect((await b.fetch("/api/me")).status).toBe(401);
    expect((await other.fetch("/api/me")).status).toBe(401);
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(0);
    expect((await auth.deps.repo.findUserById(userId))!.passwordHash).toBeNull();
    const withPassword = await web().fetch("/api/auth/password/signin", { json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(withPassword.status).toBe(401);
    expect((await error(withPassword)).code).toBe("invalid_credentials");
    const again = await stranger.fetch("/api/auth/passkeys/remove-link", { json: { token } });
    expect(again.status).toBe(400);
    expect(await error(again)).toMatchObject({ code: "invalid_code", message: "This link has expired or was already used." });
    expect((await auth.deps.repo.eventsSince(userId, new Date(0))).map((e) => e.type)).toContain("passkey_removed");
  });

  test("'not mine' needs a fresh session, then does what the link does and clears the web session's cookies", { timeout: 60_000 }, async () => {
    const { b, email, box, userId } = await signUp();
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);
    const other = await secondSession(email);
    const passkey = await register(b, "Laptop");
    await box.next(SUBJECT.passkeyAdded);
    await makeStale(b);
    const stale = await b.fetch(`/api/auth/passkeys/${passkey.id}/not-mine`, { method: "POST" });
    expect(stale.status).toBe(403);
    expect(await error(stale)).toMatchObject({ code: "reauth_required", details: { level: 1, have: [] } });
    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    expect((await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: codeFrom(await box.next(SUBJECT.reauth)) } })).status).toBe(200);

    const res = await b.fetch(`/api/auth/passkeys/${passkey.id}/not-mine`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session=") && line.includes("Max-Age=0"))).toBe(true);
    expect(b.cookie("__Host-korbat_session")).toBeUndefined();
    expect((await b.fetch("/api/me")).status).toBe(401);
    expect((await other.fetch("/api/me")).status).toBe(401);
    expect(await auth.deps.repo.countPasskeys(userId)).toBe(0);
    expect((await auth.deps.repo.findUserById(userId))!.passwordHash).toBeNull();
  });

  test("removing the passkey that started the current session keeps the session, without it", { timeout: 60_000 }, async () => {
    const { b, box } = await signUp();
    const passkey = await register(b, "Laptop");
    await box.next(SUBJECT.passkeyAdded);
    await authDb.update(sessions).set({ passkeyId: passkey.id }).where(eq(sessions.id, sessionIdOf(b)));
    await auth.deps.kv.del(`sess:2:${sessionIdOf(b)}`);
    expect((await listed(b)).map((p) => [p.id, p.current])).toEqual([[passkey.id, true]]);
    expect((await b.fetch(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await b.fetch("/api/me")).status).toBe(200);
    expect(await listed(b)).toEqual([]);
    const [row] = await authDb.select({ passkeyId: sessions.passkeyId, revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, sessionIdOf(b)));
    expect(row).toEqual({ passkeyId: null, revokedAt: null });
  });
});
```

### Replace `apps/api/test/integration/http-profile.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, ProfileView } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { Browser } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `p${randomBytes(4).toString("hex")}`;

/**
 * The profile-editing routes through the real app: 1a sign-up for the accounts, cookie sessions with
 * CSRF, the auth module's freshness check on the handle change, and events written to auth_events
 * through the auth module, wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: profile editing and handle change over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const mailer = new MemoryMailer();

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), events: { append: auth.appendEvent } });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `profile-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, handle, userId: me.user.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  /** The `{ profile }` body of a successful edit or handle change, checked against the contract. */
  const profileOf = async (res: Response) => {
    expect(res.status).toBe(200);
    return ProfileView.parse(((await res.json()) as { profile: unknown }).profile);
  };
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);
  const signedOut = (path: string, method: string, body: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("editing the profile needs an onboarded session; the edit is public at once and recorded", async () => {
    expect((await signedOut("/api/me/profile", "PATCH", { bio: "nobody" })).status).toBe(401);
    const notOnboarded = await signUp(false);
    const early = await notOnboarded.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "too early" } });
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");

    const ada = await signUp();
    const edited = await profileOf(await ada.b.fetch("/api/me/profile", { method: "PATCH", json: { displayName: "Ada Lovelace", bio: "  Analytical engines.  " } }));
    expect(edited).toMatchObject({ id: ada.userId, handle: ada.handle, displayName: "Ada Lovelace", bio: "Analytical engines.", verified: false });
    expect(edited.viewer).toBeUndefined();
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${ada.handle}`)).json())).toMatchObject({ displayName: "Ada Lovelace", bio: "Analytical engines." });
    const empty = await ada.b.fetch("/api/me/profile", { method: "PATCH", json: {} });
    expect(empty.status).toBe(400);
    expect(await errorCode(empty)).toBe("invalid_request");
    expect((await ada.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "x".repeat(161) } })).status).toBe(400);
    expect(await eventTypes(ada.userId)).toContain("profile_updated");
  });

  test("changing the handle needs an onboarded, fresh session; /me and the profile routes follow; the cooldown answers with Retry-After", async () => {
    expect((await signedOut("/api/me/handle", "POST", { handle: "nobody" })).status).toBe(401);
    const notOnboarded = await signUp(false);
    const early = await notOnboarded.b.fetch("/api/me/handle", { json: { handle: "too_early" } });
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");

    const ada = await signUp();
    const bob = await signUp();
    const to = newHandle();
    const changed = await profileOf(await ada.b.fetch("/api/me/handle", { json: { handle: to.toUpperCase() } }));
    expect(changed).toMatchObject({ id: ada.userId, handle: to });
    const me = MeResponse.parse(await (await ada.b.fetch("/api/me")).json());
    expect(me.profile).toMatchObject({ id: ada.userId, handle: to, verified: false });
    expect(me.profile!.handleChangedAt).not.toBeNull();
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(404);
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${to}`)).json()).id).toBe(ada.userId);
    expect(await eventTypes(ada.userId)).toContain("handle_changed");

    const again = await ada.b.fetch("/api/me/handle", { json: { handle: newHandle() } });
    expect(again.status).toBe(429);
    expect(await errorCode(again)).toBe("handle_cooldown");
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(29 * 24 * 3600);

    const refusals = [
      [ada.handle, "handle_taken", 409],
      [to.toUpperCase(), "handle_taken", 409],
      ["admin", "handle_reserved", 400],
      ["ab", "handle_invalid", 400],
      [bob.handle, "invalid_request", 400],
    ] as const;
    for (const [handle, code, status] of refusals) {
      const refused = await bob.b.fetch("/api/me/handle", { json: { handle } });
      expect(refused.status, handle).toBe(status);
      expect(await errorCode(refused), handle).toBe(code);
    }
    expect(MeResponse.parse(await (await bob.b.fetch("/api/me")).json()).profile).toMatchObject({ handle: bob.handle, handleChangedAt: null });
    expect(await eventTypes(bob.userId)).not.toContain("handle_changed");

    await makeStale(bob.b);
    const stale = await bob.b.fetch("/api/me/handle", { json: { handle: newHandle() } });
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("reauth_required");
    // Editing the name or the bio needs a session but no fresh proof of a credential.
    expect((await bob.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "still allowed" } })).status).toBe(200);
  });
});
```

### Replace `apps/api/test/integration/http-reauth.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, ReauthResponse, RecoveryCodesResponse, SessionResult, TotpSetupResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { encrypt, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { Browser, NativeClient } from "./http-client";

type App = ReturnType<typeof createApp>;

const PASSWORD = "correct horse battery staple";
const newHandle = () => `r${randomBytes(4).toString("hex")}`;
const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;

/**
 * The level-2 routes of the 1c design (section 10) and the re-authentication answer over HTTP: the four
 * modules wired as the server wires them, cookie and bearer sessions, and TOTP put on accounts directly.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: strong freshness and re-authentication over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-reauth-"));
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, events: { append: auth.appendEvent } });
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: media.forAccount,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in, onboarded web account: its session proved the sign-up's email code and nothing else. */
  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = newEmail("reauth");
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, email, handle, userId: me.user.id };
  }

  /** TOTP on, as the confirm step leaves it, with recovery codes; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(userId: string) {
    const secret = newTotpSecret();
    const codes = newRecoveryCodes();
    await auth.deps.repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(secret), auth.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(auth.deps.config.authHmacKey, code)),
      now: new Date(),
    });
    await auth.deps.sessions.forgetUser(userId);
    return { secret, codes };
  }
  const totpNow = (secret: Uint8Array) => hotp(secret, currentStep(Date.now()));
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionIdOf(b)}`);
  }
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const post = (b: Browser, route: string, body: unknown) => (body === undefined ? b.fetch(route, { method: "POST" }) : b.fetch(route, { json: body }));

  /** Every level-2 route of section 10 that exists before the passkey routes, with a body that passes validation. */
  const strongRoutes = (handle: string): [string, unknown][] => [
    ["/api/auth/mfa/totp/setup", undefined],
    ["/api/auth/mfa/recovery-codes/regenerate", undefined],
    ["/api/auth/password/set", { password: PASSWORD }],
    ["/api/auth/email/change/start", { email: newEmail("moved") }],
    ["/api/account/delete/start", undefined],
    ["/api/account/delete/confirm", { flowId: randomToken(), code: "123456", handle }],
    ["/api/auth/mfa/totp/disable", {}],
  ];

  test("on an account with TOTP, a session that proved only its email code is refused level 2 by every strong route, keeps its level-1 routes, and passes after a TOTP re-authentication", { timeout: 60_000 }, async () => {
    const { b, handle } = await signUp();
    const { secret } = await withTotp((MeResponse.parse(await (await b.fetch("/api/me")).json())).user.id);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(true);
    for (const [route, body] of strongRoutes(handle)) {
      const refused = await post(b, route, body);
      expect(refused.status, route).toBe(403);
      expect(await error(refused), route).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["email"] } });
    }
    // Level 1 stays what it was: past the guard, these answer for their own reasons.
    const verify = await b.fetch("/api/auth/email/change/verify", { json: { flowId: randomToken(), code: "123456" } });
    expect(verify.status).toBe(400);
    expect((await error(verify)).code).toBe("invalid_code");
    expect((await b.fetch(`/api/auth/sessions/${randomUUID()}`, { method: "DELETE" })).status).toBe(404);
    expect((await b.fetch("/api/account/export", { method: "POST" })).status).toBe(200);

    const before = b.cookie("__Host-korbat_session")!;
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "totp", code: totpNow(secret) } });
    expect(reauth.status).toBe(200);
    // The level reached; the token rotated into the cookies, never into a browser's body.
    expect(ReauthResponse.parse(await reauth.json())).toEqual({ level: 2 });
    expect(b.cookie("__Host-korbat_session")).not.toBe(before);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${before}` } })).status).toBe(401);
    expect((await b.fetch("/api/me")).status).toBe(200);

    const setup = await post(b, "/api/auth/mfa/totp/setup", undefined);
    expect(setup.status).toBe(200);
    TotpSetupResponse.parse(await setup.json());
    const regenerated = await post(b, "/api/auth/mfa/recovery-codes/regenerate", undefined);
    expect(regenerated.status).toBe(200);
    expect(RecoveryCodesResponse.parse(await regenerated.json()).recoveryCodes).toHaveLength(10);
    const set = await post(b, "/api/auth/password/set", { password: PASSWORD });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({});
    const change = await post(b, "/api/auth/email/change/start", { email: newEmail("moved") });
    expect(change.status).toBe(200);
    FlowResponse.parse(await change.json());
    const deletion = await post(b, "/api/account/delete/start", undefined);
    expect(deletion.status).toBe(200);
    FlowResponse.parse(await deletion.json());
    const confirm = await post(b, "/api/account/delete/confirm", { flowId: randomToken(), code: "123456", handle });
    expect(confirm.status).toBe(400);
    expect((await error(confirm)).code).toBe("invalid_code");
    // Last, since it changes what the account needs: no code in the body, the re-authentication spent it.
    expect((await post(b, "/api/auth/mfa/totp/disable", {})).status).toBe(204);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(false);
  });

  test("an account without TOTP passes every strong route with its email code alone, and its re-authentication answers level 1", { timeout: 60_000 }, async () => {
    const { b, email, handle } = await signUp();
    const expected: Record<string, number> = {
      "/api/auth/mfa/totp/setup": 200,
      "/api/auth/mfa/recovery-codes/regenerate": 400,
      "/api/auth/password/set": 200,
      "/api/auth/email/change/start": 200,
      "/api/account/delete/start": 200,
      "/api/account/delete/confirm": 400,
      "/api/auth/mfa/totp/disable": 400,
    };
    for (const [route, body] of strongRoutes(handle)) {
      const res = await post(b, route, body);
      expect(res.status, route).toBe(expected[route]);
      if (res.status === 400) expect((await error(res)).code, route).toMatch(/^(mfa_required|invalid_code)$/);
    }
    await makeStale(b);
    const refused = await post(b, "/api/auth/password/set", { password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(await error(refused)).toMatchObject({ code: "reauth_required", details: { level: 1, have: [] } });
    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(200);
    expect(ReauthResponse.parse(await reauth.json())).toEqual({ level: 1 });
    expect((await post(b, "/api/auth/password/set", { password: PASSWORD })).status).toBe(200);
  });

  test("a native session gets the rotated token in the answer's body, and the old one stops working at once", async () => {
    const native = new NativeClient(app);
    const email = newEmail("native");
    const { flowId } = FlowResponse.parse(await (await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } })).json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    native.token = SessionResult.parse(await (await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).json()).token;
    native.token = ((await (await native.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Phone User" } })).json()) as { token: string }).token;
    const before = native.token!;
    const start = FlowResponse.parse(await (await native.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await native.fetch("/api/auth/reauth", { json: { method: "email", flowId: start.flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(200);
    expect(reauth.headers.getSetCookie()).toHaveLength(0);
    const body = ReauthResponse.parse(await reauth.json());
    expect(body).toEqual({ level: 1, token: expect.stringMatching(/^kb1_[A-Za-z0-9_-]{43}$/) });
    expect(body.token).not.toBe(before);
    expect((await native.fetch("/api/me")).status).toBe(401);
    native.token = body.token;
    expect((await native.fetch("/api/me")).status).toBe(200);
  });

  test("a recovery code re-authenticates over HTTP: level 2 after a password, the code normalised, the answer asking for re-enrolment", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    expect((await post(b, "/api/auth/password/set", { password: PASSWORD })).status).toBe(200);
    const { codes } = await withTotp(userId);
    await makeStale(b);
    const wrong = await b.fetch("/api/auth/reauth", { json: { method: "recovery", recoveryCode: "abcd-ef23-gh45" } });
    expect(wrong.status).toBe(401);
    expect((await error(wrong)).code).toBe("invalid_mfa_code");
    const byPassword = await b.fetch("/api/auth/reauth", { json: { method: "password", password: PASSWORD } });
    expect(ReauthResponse.parse(await byPassword.json())).toEqual({ level: 1 });
    const byCode = await b.fetch("/api/auth/reauth", { json: { method: "recovery", recoveryCode: ` ${codes[0]!.toUpperCase()} ` } });
    expect(byCode.status).toBe(200);
    expect(ReauthResponse.parse(await byCode.json())).toEqual({ level: 2, mustReenrollMfa: true });
    expect(mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([(await auth.deps.repo.findUserById(userId))!.email]);
    // Without TOTP there is no recovery code to check.
    const plain = await signUp();
    const refused = await plain.b.fetch("/api/auth/reauth", { json: { method: "recovery", recoveryCode: codes[1] } });
    expect(refused.status).toBe(400);
    expect((await error(refused)).code).toBe("mfa_required");
  });

  test("TOTP confirm needs no freshness: a session gone stale since the setup still confirms with the pending secret, and the code it proved counts as a factor", { timeout: 60_000 }, async () => {
    const { b } = await signUp();
    const setup = TotpSetupResponse.parse(await (await post(b, "/api/auth/mfa/totp/setup", undefined)).json());
    const encoded = new URL(setup.otpauthUri).searchParams.get("secret")!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const char of encoded.replace(/=+$/, "")) {
      buffer = (buffer << 5) | alphabet.indexOf(char);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >>> bits) & 0xff);
        buffer &= (1 << bits) - 1;
      }
    }
    const secret = Uint8Array.from(bytes);
    await makeStale(b);
    expect((await post(b, "/api/auth/password/set", { password: PASSWORD })).status).toBe(403);
    const before = b.cookie("__Host-korbat_session")!;
    const confirm = await post(b, "/api/auth/mfa/totp/confirm", { code: totpNow(secret) });
    expect(confirm.status).toBe(200);
    expect(RecoveryCodesResponse.parse(await confirm.json()).recoveryCodes).toHaveLength(10);
    expect(b.cookie("__Host-korbat_session")).not.toBe(before);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(true);
    // The code proved the new secret, so the session holds `totp` alone: level 1, and a strong route says what is missing.
    const again = await post(b, "/api/auth/mfa/totp/setup", undefined);
    expect(again.status).toBe(403);
    expect(await error(again)).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["totp"] } });
  });
});
```

### Replace `apps/app/test/passkeys.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReauthResponse, type MeResponse, type PasskeyView } from "@korbat/contracts";
import EmailRevert from "../src/app/email-revert/[token]";
import NotMe from "../src/app/not-me/[token]";
import PasskeyRemove from "../src/app/passkey-remove/[token]";
import { AddPasskeyDialog, PasskeyItem } from "../src/components/security/PasskeysSection";
import { methodsForLevel, panelStart, REENROLL_HINT, ReauthPanel, reauthNeeded, recoveryCodeSpent, ReenrollNotice, type Method } from "../src/components/security/ReauthPanel";
import { ApiError, apiResponse, messageFor } from "../src/lib/api";
import { AUTOFILL_RESTART_MS, createAutofillScheduler, SUGGESTION_SNOOZE_MS, suggestPasskey, type AutofillEffects } from "../src/lib/passkeys";
import { TERMS_SECTIONS } from "../src/lib/terms";

/**
 * The passkey screens (1c design, section 9): the sign-in autofill's schedule, the level-2 panel's choice, the home
 * card's rule and the messages are pure helpers and are called; the Security list's rows, the Add dialog and the
 * re-authentication panel are server-rendered as lifecycle.test.tsx renders the email-revert page; what a static
 * render cannot show (the sign-in screen's field and button, the pages' calls, the absence of the Signal API) is
 * read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** The route parameters the page under test reads; each test sets them. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));

// expo-router cannot load in Node (it reaches React Native's own modules); Link with `asChild` hands the child its
// href, a page reads its route parameters, and nothing navigates in a static render.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { replace: () => undefined, push: () => undefined, setParams: () => undefined },
  useLocalSearchParams: () => route.params,
  useFocusEffect: () => undefined,
}));
// The panel and the pages read the session only to refresh it after their call; a static render never makes one.
vi.mock("@/lib/session", () => ({ useSession: () => ({ refresh: async () => undefined }) }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);

const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** Every source line matching `pattern`, as `file:line`. */
function findInSource(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const lines = readFileSync(path.join(SRC, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.split(path.sep).join("/")}:${index + 1}`);
    });
  }
  return found.sort();
}

const noop = async () => undefined;
const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2);

/** Effects the scheduler drives, recorded: the runs it started, the aborts it asked for, and the timers it set. */
function fakeEffects() {
  const started: number[] = [];
  let aborts = 0;
  const timers: { callback: () => void; ms: number; cancelled: boolean }[] = [];
  const effects: AutofillEffects = {
    start: (run) => started.push(run),
    abort: () => {
      aborts += 1;
    },
    after: (callback, ms) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return { effects, started, aborts: () => aborts, timers };
}

describe("the sign-in autofill's schedule", () => {
  test("starts one conditional request when the screen is focused, and never a second while it runs", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.focus();
    expect(fx.started).toEqual([1]);
    expect(scheduler.isCurrent(1)).toBe(true);
    // A challenge lives 10 minutes and conditional mediation ignores the ceremony's timeout, so the request is renewed before its challenge expires.
    expect(AUTOFILL_RESTART_MS).toBe(9 * 60 * 1000);
    expect(fx.timers.map((timer) => timer.ms)).toEqual([AUTOFILL_RESTART_MS]);
  });

  test("renews the request after 9 minutes: aborts it and starts another, and the old one's late ending changes nothing", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    fx.timers[0]!.callback();
    expect(fx.aborts()).toBe(1);
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(1)).toBe(false);
    expect(scheduler.isCurrent(2)).toBe(true);
    scheduler.ended(1, "expired");
    scheduler.ended(1, "failed");
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(2)).toBe(true);
  });

  test("starts over after the API said the challenge expired, and stops after any other failure or a sign-in until the next focus", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1, 2]);
    expect(fx.timers[0]!.cancelled).toBe(true);
    scheduler.ended(2, "failed");
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(2)).toBe(false);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2, 3]);
    scheduler.ended(3, "done");
    expect(fx.started).toEqual([1, 2, 3]);
    expect(fx.timers.every((timer) => timer.cancelled)).toBe(true);
    expect(fx.aborts()).toBe(0);
  });

  test("aborts the request when the screen loses focus, and starts a new one when it is focused again", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.blur();
    expect(fx.aborts()).toBe(0);
    scheduler.focus();
    scheduler.blur();
    expect(fx.aborts()).toBe(1);
    expect(scheduler.isCurrent(1)).toBe(false);
    expect(fx.timers[0]!.cancelled).toBe(true);
    // The aborted request's own ending arrives later and starts nothing while the screen is away.
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1]);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2]);
  });

  test("holds while the button's own request runs: options fetched meanwhile start no ceremony, and it resumes afterwards if still focused", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.hold();
    expect(fx.aborts()).toBe(1);
    expect(scheduler.isCurrent(1)).toBe(false);
    scheduler.release();
    expect(fx.started).toEqual([1, 2]);
    scheduler.hold();
    scheduler.blur();
    scheduler.release();
    expect(fx.started).toEqual([1, 2]);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2, 3]);
    // A hold with nothing running aborts nothing.
    scheduler.ended(3, "failed");
    scheduler.hold();
    expect(fx.aborts()).toBe(2);
  });

  test("does nothing once it is disposed, whatever comes after", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.dispose();
    expect(fx.aborts()).toBe(1);
    scheduler.focus();
    scheduler.release();
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1]);
    expect(scheduler.isCurrent(1)).toBe(false);
  });
});

describe("the level-2 panel's choice from the factors the session proved", () => {
  const ALL: Method[] = ["password", "passkey", "totp", "email", "recovery"];

  test("level 1 offers every method the account has", () => {
    expect(methodsForLevel({ level: 1, have: [] }, ALL)).toEqual({ methods: ALL, missing: null });
    expect(methodsForLevel({ level: 1, have: ["email"] }, ["email"])).toEqual({ methods: ["email"], missing: null });
  });

  test("after a first factor, only a second one is offered: a passkey, an authenticator code or a recovery code", () => {
    for (const first of ["email", "password", "passkey"] as const) {
      expect(methodsForLevel({ level: 2, have: [first] }, ALL), first).toEqual({ methods: ["passkey", "totp", "recovery"], missing: "second" });
    }
  });

  test("with only a second factor, a first one is offered: the password, a passkey or an email code", () => {
    for (const second of ["totp", "recovery"] as const) {
      expect(methodsForLevel({ level: 2, have: [second] }, ALL), second).toEqual({ methods: ["password", "passkey", "email"], missing: "first" });
    }
  });

  test("with nothing proved in time, everything is offered", () => {
    expect(methodsForLevel({ level: 2, have: [] }, ALL)).toEqual({ methods: ALL, missing: null });
  });

  test("the account's own methods bound the choice, and a choice that would be empty falls back to all of them", () => {
    expect(methodsForLevel({ level: 2, have: ["password"] }, ["password", "totp", "email"])).toEqual({ methods: ["totp"], missing: "second" });
    expect(methodsForLevel({ level: 2, have: ["email"] }, ["password", "email"])).toEqual({ methods: ["password", "email"], missing: null });
  });

  test("the details of a refusal are read as the level and the factors, and anything else means level 1 with nothing proved", () => {
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue.", undefined, { level: 2, have: ["email", "totp"] }))).toEqual({ level: 2, have: ["email", "totp"] });
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue."))).toEqual({ level: 1, have: [] });
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue.", undefined, { level: 3, have: "email" }))).toEqual({ level: 1, have: [] });
  });
});

describe("the home screen's passkey suggestion", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-09-25T12:00:00Z");

  test("shows for an account without passkeys on a device with a built-in authenticator, unless Not now was chosen in the last 30 days", () => {
    expect(SUGGESTION_SNOOZE_MS).toBe(30 * DAY);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: null, now })).toBe(true);
    expect(suggestPasskey({ passkeys: 1, platformAuthenticator: true, dismissedAt: null, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: false, dismissedAt: null, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now - 29 * DAY, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now - 31 * DAY, now })).toBe(true);
    // A dismissal from the future (the clock moved) still counts as recent.
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now + DAY, now })).toBe(false);
  });
});

describe("the passkey messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("every new code has its sentence, and the daily bound says its wait in hours from the details", () => {
    expect(messageFor("passkey_invalid")).toBe("That passkey did not work. Try again or use your email.");
    expect(messageFor("passkey_unsupported")).toBe("This passkey provider is not supported. Try another one.");
    expect(messageFor("passkey_limit")).toBe("You have 10 passkeys. Remove one to add another.");
    expect(messageFor("passkey_limit", undefined, { reason: "cap" })).toBe("You have 10 passkeys. Remove one to add another.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 7200 })).toBe("You added 5 passkeys today. You can add another in about 2 hours.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 7201 })).toBe("You added 5 passkeys today. You can add another in about 3 hours.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 1 })).toBe("You added 5 passkeys today. You can add another in about 1 hour.");
    expect(messageFor("passkey_suspended")).toBe("This passkey was switched off because a copy of it may exist. Remove it and add a new one.");
    expect(messageFor("challenge_expired")).toBe("That took too long. Try again.");
    expect(messageFor("passkey_not_found")).toBe("That passkey is gone.");
  });

  test("a refusal's details reach the error, and the daily bound is worded here from them rather than by the server", async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", answer(409, { error: { code: "passkey_limit", message: "server wording", details: { reason: "daily", retryAfter: 7200 } } }));
    await expect(apiResponse("/api/auth/passkeys/register/options", { json: { label: "alice" } })).rejects.toMatchObject({
      status: 409,
      code: "passkey_limit",
      message: "You added 5 passkeys today. You can add another in about 2 hours.",
      details: { reason: "daily", retryAfter: 7200 },
    });
    vi.stubGlobal("fetch", answer(403, { error: { code: "reauth_required", message: "Confirm it's you to continue.", details: { level: 2, have: ["password"] } } }));
    const refused = await apiResponse("/api/auth/passkeys/register/options", { json: { label: "alice" } }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(ApiError);
    expect(reauthNeeded(refused as ApiError)).toEqual({ level: 2, have: ["password"] });
    // The server's own wording still stands for every other code.
    vi.stubGlobal("fetch", answer(401, { error: { code: "passkey_invalid", message: "server wording" } }));
    await expect(apiResponse("/api/auth/passkey/signin/verify", { json: {} })).rejects.toMatchObject({ code: "passkey_invalid", message: "server wording", details: undefined });
  });
});

describe("the Security screen's passkeys", () => {
  const view = (extra: Partial<PasskeyView> = {}): PasskeyView => ({
    id: "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f",
    name: "Laptop",
    createdAt: "2026-09-20T10:00:00.000Z",
    lastUsedAt: null,
    synced: false,
    createdOn: "Chrome on Windows",
    current: false,
    isNew: false,
    suspended: false,
    ...extra,
  });
  const row = (passkey: PasskeyView) => html(<PasskeyItem passkey={passkey} busy={false} onRename={async () => true} onRemove={() => undefined} onNotMine={() => undefined} />);

  test("a row shows the name, when it was added and last used, and the device that added it", () => {
    const out = row(view());
    expect(out).toContain("Laptop");
    expect(out).toContain("added ");
    expect(out).toContain("never used");
    expect(out).toContain("added on Chrome on Windows");
    expect(out).toContain("Rename");
    expect(out).toContain("Remove");
    expect(out).not.toMatch(/This wasn(&#x27;|')t me/);
    expect(out).not.toContain('role="img"');
    const gone = row(view({ createdOn: null, lastUsedAt: "2026-09-25T10:00:00.000Z" }));
    expect(gone).toContain("last used ");
    expect(gone).not.toContain("never used");
    expect(gone).not.toContain("added on");
  });

  test("each tag names itself for a screen reader as an image, since ARIA lets no generic element carry a name", () => {
    const out = row(view({ current: true, isNew: true, suspended: true, synced: true }));
    for (const label of [
      "used for this session: it signed you in here",
      "new: added in the last 7 days",
      "suspended: switched off because a copy of it may exist",
      "synced: backed up by your password manager to your other devices",
    ]) {
      const tag = new RegExp(`<div[^>]*aria-label="${label}"[^>]*>`).exec(out)?.[0] ?? "";
      expect(tag, label).toContain('role="img"');
    }
    expect(out).toMatch(/This wasn(&#x27;|')t me/);
  });

  test("the Add dialog labels both fields, prefills the password manager's name with the handle and says what that name reveals", () => {
    const out = html(<AddPasskeyDialog handle="alice" busy={false} error={null} onCreate={noop} onCancel={() => undefined} />);
    expect(out).toContain('role="dialog"');
    expect(out).toMatch(/<input[^>]*aria-label="Name"[^>]*>/);
    const label = /<input[^>]*aria-label="Name in your password manager"[^>]*>/.exec(out)?.[0] ?? "";
    expect(label).toContain('value="alice"');
    expect(out).toContain("Your password manager shows this name to anyone who can see this device.");
    expect(out).toContain("Create passkey");
    expect(out).toContain("Cancel");
  });

  test("the screen shows the section, opens the Add dialog from the home card's link, and turns two-factor off without a code", () => {
    const security = read("app", "settings", "security.tsx");
    expect(security).toContain('<Section title="Passkeys">');
    expect(security).toContain('openAdd={add === "1"}');
    const mfa = read("components", "security", "MfaSection.tsx");
    expect(mfa).toContain('api("/api/auth/mfa/totp/disable", { json: {} })');
    expect(mfa).not.toMatch(/totp\/disable", \{ json: \{ code/);
    const home = read("app", "index.tsx");
    expect(home).toContain("<PasskeySuggestion");
    expect(home).toContain('router.push("/settings/security?add=1")');
  });
});

describe("the re-authentication panel", () => {
  const me: MeResponse = {
    user: { id: "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f", email: "alice@example.org", role: "user", onboarded: true, mfaEnabled: true, hasPassword: true, passkeys: 1 },
    profile: null,
  };
  /** The method chips, in order: each is a pressed or unpressed native button. */
  const chips = (out: string): string[] => [...out.matchAll(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1] ?? "");

  test("offers the recovery code beside the other methods, and the passkey only in a browser that supports it, which Node is not", () => {
    const out = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 1, have: [] } }} onClose={() => undefined} />);
    expect(chips(out)).toEqual(["Password", "Authenticator code", "Email code", "Recovery code"]);
    expect(out).not.toContain("This change needs two factors");
    const source = read("components", "security", "ReauthPanel.tsx");
    expect(source).toContain('label="Use a passkey"');
    expect(source).toContain('method: "passkey"');
    expect(source).toContain('method: "recovery"');
    expect(source).toContain("me.user.passkeys > 0 && passkeysSupported()");
  });

  test("at level 2 it says why and asks only for what is missing", () => {
    const out = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 2, have: ["password"] } }} onClose={() => undefined} />);
    expect(out).toContain("This change needs two factors because two-factor authentication is on.");
    expect(chips(out)).toEqual(["Authenticator code", "Recovery code"]);
    const first = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 2, have: ["totp"] } }} onClose={() => undefined} />);
    expect(chips(first)).toEqual(["Password", "Email code"]);
  });

  test("closing the panel never replaces the route, which would mount the screen anew and lose what the action just showed: the hint is a parameter set on the route the screen is on", () => {
    const source = read("components", "security", "ReauthPanel.tsx");
    // A replace builds a route with a new key: the new recovery codes, a setup's QR code and the flow id of a mailed code would go with the old one.
    expect(source).not.toMatch(/router\.(replace|push|navigate)\(/);
    expect(source.match(/router\.setParams\(\{ reenroll: "1" \}\)/g)).toHaveLength(1);
    // Security reads the parameter where it stands and hands it to the two-factor section; Account and Profile show the notice.
    const security = read("app", "settings", "security.tsx");
    expect(security).toContain("useLocalSearchParams<{ reenroll?: string; add?: string }>()");
    expect(security).toContain('reenroll={reenroll === "1"}');
    for (const screen of ["account.tsx", "profile.tsx"]) expect(read("app", "settings", screen), screen).toContain("<ReenrollNotice me={me} />");
  });

  test("on a screen without a two-factor section the hint is a notice with a link to Security, shown when the parameter is set and two-factor is on", () => {
    route.params = { reenroll: "1" };
    const out = html(<ReenrollNotice me={me} />);
    expect(out).toContain(REENROLL_HINT);
    expect(out).toMatch(/<a[^>]*href="\/settings\/security\?reenroll=1"[^>]*>/);
    // One sentence on the three screens: Security's own, which its two-factor section shows.
    expect(REENROLL_HINT).toBe("You used a recovery code. Set up two-factor again to get a fresh set of codes.");
    expect(read("components", "security", "MfaSection.tsx")).toContain(REENROLL_HINT);
    route.params = {};
    expect(html(<ReenrollNotice me={me} />)).toBe("");
    route.params = { reenroll: "0" };
    expect(html(<ReenrollNotice me={me} />)).toBe("");
    // Without two-factor there is nothing to set up again, as on Security.
    route.params = { reenroll: "1" };
    expect(html(<ReenrollNotice me={{ ...me, user: { ...me.user, mfaEnabled: false } }} />)).toBe("");
    route.params = {};
  });

  test("a spent recovery code is remembered for the panel's life: whichever answer carried it, and whether or not the action then went through, the panel closes with the hint", () => {
    const spent = (answers: unknown[]): boolean => answers.map((answer) => ReauthResponse.parse(answer)).reduce(recoveryCodeSpent, false);
    // At level 2 with nothing proved in time: the recovery code first, after which the action is refused again, then the password.
    expect(spent([{ level: 1, mustReenrollMfa: true }, { level: 2 }])).toBe(true);
    // The password first, then the recovery code.
    expect(spent([{ level: 1 }, { level: 2, mustReenrollMfa: true }])).toBe(true);
    // A recovery code, after which the action fails for a reason of its own: the panel stays open with the error and closes by Cancel.
    expect(spent([{ level: 2, mustReenrollMfa: true }])).toBe(true);
    // No recovery code, no hint.
    expect(spent([{ level: 1 }, { level: 2 }])).toBe(false);
    expect(spent([{ level: 2, mustReenrollMfa: false }])).toBe(false);
    expect(spent([])).toBe(false);

    const source = read("components", "security", "ReauthPanel.tsx");
    // Held in a ref, which outlives one answer, and read from every answer before the action runs.
    expect(source).toContain("const recoveryUsed = useRef(false);");
    expect(source).toContain("recoveryUsed.current = recoveryCodeSpent(recoveryUsed.current, result);");
    expect(source.indexOf("recoveryUsed.current = recoveryCodeSpent(")).toBeLessThan(source.indexOf("await pending.action();"));
    // Acted on in one place, which both ways out of the panel go through: the action that went through, and Cancel.
    expect(source).toMatch(/function close\(\) \{\s*onClose\(\);\s*if \(recoveryUsed\.current\) router\.setParams\(\{ reenroll: "1" \}\);\s*\}/);
    expect(source).toContain('<Button label="Cancel" onPress={close} tone="secondary" />');
    expect(source.match(/^\s*close\(\);$/gm)).toHaveLength(1);
    expect(source).not.toMatch(/onPress=\{onClose\}/);
    expect(source.match(/\bonClose\(\)/g)).toHaveLength(1);
  });

  test("the panel follows the refusal it is answering: when another action's refusal replaces the one it shows, it starts over from what that one needs", () => {
    const available: Method[] = ["password", "totp", "email", "recovery"];
    // A level-2 action refused after the password: the two-factor sentence, and second factors only.
    expect(methodsForLevel({ level: 2, have: ["password"] }, available)).toEqual({ methods: ["totp", "recovery"], missing: "second" });
    expect(panelStart({ level: 2, have: ["password"] }, available)).toEqual({ needed: { level: 2, have: ["password"] }, method: "totp", value: "", flowId: null, error: null });
    // "This wasn't me" or "Sign out everywhere" refused while that panel is open: level 1 with nothing proved in time, so
    // every method the account has, the password and the email code among them, and nothing typed, mailed or refused yet.
    expect(methodsForLevel({ level: 1, have: [] }, available)).toEqual({ methods: available, missing: null });
    expect(panelStart({ level: 1, have: [] }, available)).toEqual({ needed: { level: 1, have: [] }, method: "password", value: "", flowId: null, error: null });

    const source = read("components", "security", "ReauthPanel.tsx");
    // The panel is one instance whatever refusal it shows (the screens give it no key), so it compares the refusal it
    // started from with the one it is given, and starts over when they differ.
    expect(source).toContain("const [asked, setAsked] = useState(pending);");
    const reset = /if \(asked !== pending\) \{([^}]*)\}/.exec(source)?.[1] ?? "";
    for (const line of ["const next = panelStart(pending.needed, available);", "setAsked(pending);", "setNeeded(next.needed);", "setMethod(next.method);", "setValue(next.value);", "setFlowId(next.flowId);", "setError(next.error);"]) {
      expect(reset, line).toContain(line);
    }
    // The focus moves to the panel for every refusal, not only the first.
    expect(source).toMatch(/\.focus\?\.\(\);\s*\}, \[pending\]\);/);
    for (const screen of ["security.tsx", "account.tsx", "profile.tsx"]) {
      expect(read("app", "settings", screen), screen).toContain("{reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}");
    }
  });
});

describe("the sign-in screen", () => {
  const signin = read("app", "(auth)", "signin.tsx");

  test("the email field carries the autofill pair, and the passkey button sends the response with the device fields the password sign-in sends", () => {
    expect(signin).toContain('const EMAIL_AUTOFILL = "email webauthn" as unknown as TextInputProps["autoComplete"];');
    expect(signin).toMatch(/<Field label="Email" autoComplete=\{EMAIL_AUTOFILL\}/);
    expect(signin).toContain('label="Sign in with a passkey"');
    expect(signin).toContain('api("/api/auth/passkey/signin/verify", { json: { response, deviceId: deviceId(), platform }, schema: SignInResponse })');
    expect(signin).toContain('router.replace("/mfa")');
  });

  test("one controller owns the conditional request: focus and blur drive it, and unmounting disposes of it", () => {
    expect(signin).toContain("createAutofillScheduler(");
    expect(signin).toContain("useFocusEffect(");
    expect(signin).toMatch(/scheduler\.blur\(\)/);
    expect(signin).toMatch(/scheduler\.dispose\(\)/);
    expect(signin).toMatch(/scheduler\.hold\(\)/);
  });

  test("no screen calls the Signal API, which deletes other accounts' passkeys on Safari", () => {
    expect(findInSource(/signalUnknownCredential|signalAllAcceptedCredentials|signalCurrentUserDetails|sendSignal\(/)).toEqual([]);
  });
});

describe("the pages behind the links", () => {
  /** The opening tag of the button whose text is `label`, or "" when there is none. */
  const buttonTag = (markup: string, label: string): string => {
    const at = markup.indexOf(label);
    const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
    return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
  };
  // The lockdown reaches from the day before its anchor to the moment it runs, which can be a week later: "since", never "in".
  const LOCKDOWN = /passkeys and two-factor authentication set up since the day before/;
  /** A page before the confirmation and after it: the second render starts from the state the confirmation leaves. */
  const sentences = (source: string): string[] => source.replace(/\s+/g, " ").match(/[^.]*set up (?:since|in) the day before[^.;]*/g) ?? [];

  test("the passkey-remove page explains the lockdown, confirms, and offers the button only with the link's token", () => {
    route.params = { token: TOKEN };
    const out = html(<PasskeyRemove />);
    const label = "Remove the passkey and lock down my account";
    expect(out).toContain(label);
    expect(out).toMatch(/sign(s|ed)? out every session/i);
    expect(out).toMatch(LOCKDOWN);
    expect(buttonTag(out, label)).not.toBe("");
    expect(buttonTag(out, label)).not.toContain('aria-disabled="true"');
    expect(out).not.toContain('role="alert"');
    for (const token of ["", "short", "A".repeat(42) + "/"]) {
      route.params = { token };
      const bad = html(<PasskeyRemove />);
      expect(bad, token).toContain('role="alert"');
      expect(bad, token).toMatch(/link is incomplete/);
      expect(buttonTag(bad, label), token).toContain('aria-disabled="true"');
    }
    const source = read("app", "passkey-remove", "[token].tsx");
    expect(source).toContain('api("/api/auth/passkeys/remove-link", { json: { token } })');
    expect(source).toMatch(/router\.replace\("\/signin"\)/);
  });

  test("the not-me and email-undo pages describe the lockdown: every session out, the password removed, and what was set up since the day before", () => {
    route.params = { token: TOKEN };
    for (const [name, page] of [
      ["not-me", <NotMe />],
      ["email-revert", <EmailRevert />],
    ] as const) {
      const out = html(page);
      expect(out, name).toMatch(/sign(s|ed)? out every session/i);
      expect(out, name).toMatch(/remove (your|any) password/i);
      expect(out, name).toMatch(LOCKDOWN);
    }
  });

  test("every explanation of the lockdown names its reach as it is, before the confirmation and after it: what was set up since the day before, the person's own later additions included", () => {
    const anchors = { "passkey-remove": "it was added", "not-me": "that sign-in", "email-revert": "the change" };
    for (const [page, anchor] of Object.entries(anchors)) {
      const found = sentences(read("app", page, "[token].tsx"));
      // Twice on each page: what confirming will do, and what it did.
      expect(found, page).toHaveLength(2);
      for (const sentence of found) expect(sentence, page).toContain(`passkeys and two-factor authentication set up since the day before ${anchor}`);
    }
    // The dialog behind "This wasn't me", whose passkey can be a week old by then.
    const dialog = sentences(read("components", "security", "PasskeysSection.tsx"));
    expect(dialog).toHaveLength(1);
    expect(dialog[0]).toContain("every passkey and two-factor authentication set up since the day before this passkey was added is removed, including any you set up yourself after it");
    // Nowhere does the app say "in the day before", which names one day of what can be eight.
    expect(findInSource(/in the day before/)).toEqual([]);
  });
});

describe("the terms", () => {
  test("say what a passkey keeps on the server and that nothing about fingerprints or faces leaves the device", () => {
    const body = TERMS_SECTIONS.find((section) => section.title === "Your data")?.body ?? "";
    expect(body).toMatch(/passkey/);
    expect(body).toMatch(/public key/);
    expect(body).toMatch(/the device that added it/);
    expect(body).toMatch(/fingerprint/);
    expect(body).toMatch(/face/);
  });
});
```

### Replace `packages/contracts/test/account.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { ExportFormat } from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-24T10:00:00.000Z";

/** A complete export of a small account: every list holds one entry so each entry shape is exercised. */
const full = {
  format: "korbat-export-1",
  exportedAt: at,
  account: {
    id: id(1),
    email: "ada@example.com",
    createdAt: at,
    role: "user",
    mfaEnabled: true,
    hasPassword: true,
    verified: false,
    termsVersion: "draft-2026-09",
    termsAcceptedAt: at,
    passkeys: [
      { name: "Laptop", createdAt: at, lastUsedAt: at, synced: true, createdOn: "Chrome on Windows" },
      { name: "Security key", createdAt: at, lastUsedAt: null, synced: false, createdOn: null },
    ],
  },
  profile: { handle: "ada", displayName: "Ada", bio: "hello", createdAt: at, handleHistory: ["ada_l", "ada"] },
  posts: [
    { id: id(2), body: "first", createdAt: at, replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [{ id: id(3), file: `media/${id(3)}.webp`, altText: "a cat", width: 2048, height: 1536 }] },
    { id: id(4), body: "", createdAt: at, replyToId: id(2), quoteOfId: null, state: "deleted_by_author", deletedAt: at, media: [] },
  ],
  likes: [{ postId: id(5), at }],
  reposts: [{ postId: id(5), at }],
  bookmarks: [{ postId: id(5), at }],
  following: [{ handle: "grace", since: at }],
  blocks: [{ handle: "troll", since: at }],
  mutes: [{ handle: "loud", since: at }],
  // A session is named by its handle, as the session list names it; the token's hash stays on the server.
  sessions: [{ id: id(9), createdAt: at, lastUsedAt: at, current: true }],
  devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: at, lastSeenAt: at }],
  events: [{ type: "signup", at }],
  missingMedia: [id(6)],
};

describe("export format", () => {
  test("a complete export parses unchanged, and every list may be empty", () => {
    expect(ExportFormat.parse(full)).toEqual(full);
    const empty = { ...full, account: { ...full.account, passkeys: [] }, posts: [], likes: [], reposts: [], bookmarks: [], following: [], blocks: [], mutes: [], sessions: [], devices: [], events: [], missingMedia: [] };
    expect(ExportFormat.parse(empty)).toEqual(empty);
  });

  test("the format name is fixed, so a reader can tell what it opened", () => {
    expect(ExportFormat.safeParse({ ...full, format: "korbat-export-2" }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, format: undefined }).success).toBe(false);
  });

  test("the account and the profile carry the nullable facts as null, never missing", () => {
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, termsVersion: null, termsAcceptedAt: null } }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, email: "not-an-email" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, role: "owner" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: [1] } }).success).toBe(false);
  });

  test("the account's passkeys carry a name, their times, whether they are synced and where they were added, and nothing that identifies the key", () => {
    const [laptop] = full.account.passkeys;
    const withPasskeys = (passkeys: unknown) => ExportFormat.safeParse({ ...full, account: { ...full.account, passkeys } }).success;
    // The list is part of the format since 1c: always present, empty for an account without passkeys.
    expect(withPasskeys(undefined)).toBe(false);
    expect(withPasskeys([])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: null, createdOn: null }])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdOn: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, name: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdAt: "last week" }])).toBe(false);
    expect(withPasskeys([{ ...laptop, synced: "yes" }])).toBe(false);
    // A reader gets the five fields and no more: nothing of the key, its id or its authenticator is part of the format.
    const parsed = ExportFormat.parse({ ...full, account: { ...full.account, passkeys: [{ ...laptop, id: id(7), credentialId: "Y3JlZA", publicKey: "cose", aaguid: id(8) }] } });
    expect(parsed.account.passkeys).toEqual([laptop]);
  });

  test("a deleted post keeps its place with an empty body and a deletion time; an attached image has its dimensions", () => {
    const [post] = full.posts;
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, state: "hidden" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, replyToId: undefined }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: [{ id: id(3), file: "media/x.webp", altText: "a cat" }] }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: undefined }] }).success).toBe(false);
  });

  test("engagement entries name a post and a time, graph entries a handle and a time", () => {
    expect(ExportFormat.safeParse({ ...full, likes: [{ postId: "nope", at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, bookmarks: [{ postId: id(5) }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, following: [{ handle: "grace" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, mutes: [{ handle: "loud", since: "last week" }] }).success).toBe(false);
  });

  test("sessions, devices, events and missing media keep their shapes", () => {
    expect(ExportFormat.safeParse({ ...full, sessions: [{ id: id(9), createdAt: at, lastUsedAt: at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], label: null }] }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], platform: "desktop" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, events: [{ type: "signup" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, missingMedia: undefined }).success).toBe(false);
  });
});
```

### Replace `packages/contracts/test/auth.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  AuthErrorCode,
  BadgeStartRequest,
  BadgeVerifyRequest,
  BadgeVerifyResponse,
  DeleteConfirmRequest,
  DeleteStartResponse,
  DeviceId,
  DisplayName,
  Email,
  EmailChangeResponse,
  EmailChangeStartRequest,
  EmailChangeVerifyRequest,
  EmailRevertRequest,
  EmailVerifyResponse,
  MeProfile,
  MeResponse,
  MfaVerifyRequest,
  OpaqueId,
  Phone,
  ReauthRequest,
  ReauthResponse,
  RecoveryCode,
  SessionInfo,
  SessionsResponse,
  SignupCompleteRequest,
  TotpDisableRequest,
} from "../src/index";

const flow = "a".repeat(43);
const userId = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

/** A minimal well-formed authentication assertion, for the passkey re-authentication variant. */
const reauthAssertion = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: "A".repeat(200), authenticatorData: "A".repeat(50), signature: "A".repeat(96) },
  clientExtensionResults: {},
};

describe("auth primitives", () => {
  test("email is trimmed and lowercased, invalid rejected", () => {
    expect(Email.parse("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(Email.safeParse("not-an-email").success).toBe(false);
    expect(Email.safeParse(`${"a".repeat(250)}@x.io`).success).toBe(false);
  });
  test("opaque ids are exactly 43 base64url characters", () => {
    expect(OpaqueId.safeParse(flow).success).toBe(true);
    expect(OpaqueId.safeParse("a".repeat(42)).success).toBe(false);
    expect(OpaqueId.safeParse(`${"a".repeat(42)}=`).success).toBe(false);
  });
  test("device ids are 22 to 64 url-safe characters", () => {
    expect(DeviceId.safeParse("x".repeat(22)).success).toBe(true);
    expect(DeviceId.safeParse("x".repeat(21)).success).toBe(false);
    expect(DeviceId.safeParse("x".repeat(65)).success).toBe(false);
  });
  test("recovery codes are normalised to lowercase base32 groups", () => {
    expect(RecoveryCode.parse(" ABCD-EF23-GH45 ")).toBe("abcd-ef23-gh45");
    expect(RecoveryCode.safeParse("abcd-ef01-gh45").success).toBe(false);
  });
  test("display names reject control characters and more than 50 characters", () => {
    expect(DisplayName.parse("  Ada Lovelace ")).toBe("Ada Lovelace");
    expect(DisplayName.safeParse(`bad${String.fromCharCode(7)}name`).success).toBe(false);
    expect(DisplayName.safeParse("x".repeat(51)).success).toBe(false);
  });
  test("phone numbers are E.164 once spaces, hyphens and parentheses are dropped", () => {
    expect(Phone.parse(" +44 7911 123-456 ")).toBe("+447911123456");
    expect(Phone.parse("+1 (415) 555-0132")).toBe("+14155550132");
    expect(Phone.parse("+1234567")).toBe("+1234567");
    expect(Phone.parse(`+${"9".repeat(15)}`)).toBe(`+${"9".repeat(15)}`);
    // No plus, a leading zero, too short, too long, letters, a plus in the middle.
    for (const bad of ["447911123456", "+0447911123456", "+123456", `+${"9".repeat(16)}`, "+44 7911 ext 12", "44+7911123456", ""]) {
      expect(Phone.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("auth requests and responses", () => {
  test("email verify response is discriminated by result", () => {
    expect(EmailVerifyResponse.parse({ result: "signup_required" })).toEqual({ result: "signup_required" });
    expect(EmailVerifyResponse.parse({ result: "mfa_required", mfaTicket: flow }).result).toBe("mfa_required");
    expect(EmailVerifyResponse.safeParse({ result: "session" }).success).toBe(false);
    expect(EmailVerifyResponse.parse({ result: "session", mustReenrollMfa: false })).toEqual({ result: "session", mustReenrollMfa: false });
  });
  test("mfa verify takes exactly one of code or recoveryCode", () => {
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, code: "123456" }).success).toBe(true);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, recoveryCode: "abcd-ef23-gh45" }).success).toBe(true);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, code: "123456", recoveryCode: "abcd-ef23-gh45" }).success).toBe(false);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow }).success).toBe(false);
  });
  test("reauth accepts password, totp, email, recovery and passkey methods only", () => {
    expect(ReauthRequest.safeParse({ method: "password", password: "x" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "totp", code: "000000" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "email", flowId: flow, code: "000000" }).success).toBe(true);
    // A recovery code (1c design, section 7.2), normalised as the MFA step normalises it.
    expect(ReauthRequest.parse({ method: "recovery", recoveryCode: " ABCD-EF23-GH45 " })).toEqual({ method: "recovery", recoveryCode: "abcd-ef23-gh45" });
    expect(ReauthRequest.safeParse({ method: "recovery", recoveryCode: "abcd-ef01-gh45" }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "recovery", code: "000000" }).success).toBe(false);
    // A passkey re-authentication carries an assertion (1c design, section 7.2); a registration is not one.
    expect(ReauthRequest.safeParse({ method: "passkey", response: reauthAssertion }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "passkey" }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "passkey", response: { ...reauthAssertion, response: {} } }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "sms", code: "000000" }).success).toBe(false);
  });
  test("the reauth answer carries the level reached, the rotated token for native clients and, after a recovery code, the re-enrolment flag", () => {
    expect(ReauthResponse.parse({ level: 1 })).toEqual({ level: 1 });
    expect(ReauthResponse.parse({ level: 2, token: "kb1_x", mustReenrollMfa: true })).toEqual({ level: 2, token: "kb1_x", mustReenrollMfa: true });
    expect(ReauthResponse.safeParse({ level: 3 }).success).toBe(false);
    expect(ReauthResponse.safeParse({ level: "2" }).success).toBe(false);
    expect(ReauthResponse.safeParse({ token: "kb1_x" }).success).toBe(false);
  });
  test("turning TOTP off takes an empty body: the re-authentication already spent the code, and a code sent anyway is dropped", () => {
    expect(TotpDisableRequest.parse({})).toEqual({});
    expect(TotpDisableRequest.parse({ code: "123456" })).toEqual({});
    expect(TotpDisableRequest.safeParse(null).success).toBe(false);
    expect(TotpDisableRequest.safeParse("code").success).toBe(false);
  });
  test("signup completion needs an ISO calendar date", () => {
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "2008-02-29", termsVersion: "draft" }).success).toBe(true);
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "29/02/2008", termsVersion: "draft" }).success).toBe(false);
  });
  test("a listed session is named by its handle, a uuid that stays while its token rotates, and never by the token's hash", () => {
    const session = { id: userId, deviceLabel: "Chrome on Windows", platform: "web", createdAt: "2026-09-24T10:00:00.000Z", lastUsedAt: "2026-09-24T10:05:00.000Z", current: true };
    expect(SessionsResponse.parse({ sessions: [session, { ...session, id: "0b0e7c1a-5a53-4f0e-8a3f-2f6f8f5d9c11", platform: "ios", current: false }] }).sessions.map((s) => [s.id, s.current])).toEqual([
      [userId, true],
      ["0b0e7c1a-5a53-4f0e-8a3f-2f6f8f5d9c11", false],
    ]);
    // What the list carried before: sha256 of the token, which a rotation replaces, so a listed session could not be revoked after one.
    expect(SessionInfo.safeParse({ ...session, id: "a".repeat(64) }).success).toBe(false);
    expect(SessionInfo.safeParse({ ...session, id: "not-a-uuid" }).success).toBe(false);
    expect(SessionInfo.safeParse({ ...session, id: undefined }).success).toBe(false);
    expect(SessionInfo.safeParse({ ...session, platform: "desktop" }).success).toBe(false);
  });
  test("me response carries email, the count of passkeys and a nullable profile", () => {
    const me = {
      user: { id: userId, email: "a@b.io", role: "user", onboarded: false, mfaEnabled: false, hasPassword: false, passkeys: 0 },
      profile: null,
    };
    expect(MeResponse.parse(me)).toEqual(me);
    // The count decides whether the app offers a passkey re-authentication and the suggestion card (1c design, section 9), so it is never left out.
    expect(MeResponse.parse({ ...me, user: { ...me.user, passkeys: 3 } }).user.passkeys).toBe(3);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: undefined } }).success).toBe(false);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: -1 } }).success).toBe(false);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: 1.5 } }).success).toBe(false);
  });
  test("the own profile in the me response says when the handle last changed and whether the badge is held", () => {
    const user = { id: userId, email: "a@b.io", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 };
    const profile = { id: userId, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false };
    expect(MeResponse.parse({ user, profile })).toEqual({ user, profile });
    expect(MeProfile.parse({ ...profile, handleChangedAt: "2026-09-24T10:00:00.000Z", verified: true }).verified).toBe(true);
    // Both fields are facts the account screen relies on, so a profile without them is not a valid answer.
    expect(MeResponse.safeParse({ user, profile: { id: userId, handle: "ada", displayName: "Ada" } }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, handleChangedAt: "yesterday" }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, verified: "yes" }).success).toBe(false);
  });
  test("every documented auth error code exists", () => {
    expect(AuthErrorCode.options).toHaveLength(34);
    expect(AuthErrorCode.options).toContain("password_check_unavailable");
    expect(AuthErrorCode.options).toEqual(expect.arrayContaining(["handle_cooldown", "email_in_use", "phone_in_use", "badge_unavailable", "verify_unavailable"]));
    // Passkeys (1c design, section 8).
    expect(AuthErrorCode.options).toEqual(
      expect.arrayContaining(["passkey_invalid", "passkey_unsupported", "passkey_limit", "passkey_suspended", "passkey_not_found", "challenge_expired"]),
    );
  });
});

describe("account lifecycle requests and responses", () => {
  test("an email change starts with an address under the sign-up rules and verifies with a flow id and code", () => {
    expect(EmailChangeStartRequest.parse({ email: " New@Example.COM " })).toEqual({ email: "new@example.com" });
    expect(EmailChangeStartRequest.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(EmailChangeStartRequest.safeParse({}).success).toBe(false);
    expect(EmailChangeVerifyRequest.parse({ flowId: flow, code: "123456" })).toEqual({ flowId: flow, code: "123456" });
    expect(EmailChangeVerifyRequest.safeParse({ flowId: flow, code: "12345" }).success).toBe(false);
    expect(EmailChangeVerifyRequest.safeParse({ flowId: "short", code: "123456" }).success).toBe(false);
    expect(EmailChangeResponse.parse({ email: "new@example.com" })).toEqual({ email: "new@example.com" });
    expect(EmailChangeResponse.safeParse({ email: "nope" }).success).toBe(false);
  });
  test("the undo link of an email change carries one opaque token", () => {
    expect(EmailRevertRequest.parse({ token: flow })).toEqual({ token: flow });
    expect(EmailRevertRequest.safeParse({ token: "a".repeat(42) }).success).toBe(false);
    expect(EmailRevertRequest.safeParse({ token: `${"a".repeat(42)}/` }).success).toBe(false);
    expect(EmailRevertRequest.safeParse({}).success).toBe(false);
  });
  test("the badge starts with a phone number and verifies with a flow id and a six-digit code", () => {
    expect(BadgeStartRequest.parse({ phone: "+44 7911 123456" })).toEqual({ phone: "+447911123456" });
    expect(BadgeStartRequest.safeParse({ phone: "07911123456" }).success).toBe(false);
    expect(BadgeStartRequest.safeParse({}).success).toBe(false);
    expect(BadgeVerifyRequest.parse({ flowId: flow, code: "000000" })).toEqual({ flowId: flow, code: "000000" });
    expect(BadgeVerifyRequest.safeParse({ flowId: flow, code: "abcdef" }).success).toBe(false);
    expect(BadgeVerifyRequest.safeParse({ flowId: flow, code: "0000000" }).success).toBe(false);
    expect(BadgeVerifyResponse.parse({ verified: true })).toEqual({ verified: true });
    expect(BadgeVerifyResponse.safeParse({ verified: false }).success).toBe(false);
  });
  test("deletion starts with a flow id and is confirmed with the code and the typed handle", () => {
    expect(DeleteStartResponse.parse({ flowId: flow })).toEqual({ flowId: flow });
    expect(DeleteStartResponse.safeParse({ flowId: "x" }).success).toBe(false);
    expect(DeleteConfirmRequest.parse({ flowId: flow, code: "123456", handle: " Ada_Lovelace " })).toEqual({ flowId: flow, code: "123456", handle: "ada_lovelace" });
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, code: "123456" }).success).toBe(false);
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, code: "123456", handle: "" }).success).toBe(false);
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, handle: "ada" }).success).toBe(false);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:  ❯ test/auth.test.ts (20 tests | 1 failed) 68ms
packages/contracts test:  Test Files  1 failed | 5 passed (6)
packages/contracts test:       Tests  1 failed | 89 passed (90)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/08-review-fixes.md 3
```

Expected: 21 lines starting with `wrote`, one for each file below.

### Replace `apps/api/src/account/flows/export.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { Platform } from "@korbat/contracts";
import type { AccountExport } from "../../auth";
import type { ProfileExport } from "../../social";
import { AccountError, type AccountDeps } from "../context";
import type { OpenFile, ZipWriter } from "../zip";

/** One export a day (1b design, section 10). */
export const EXPORTS_PER_WINDOW = 1;
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

const exportLimitKey = (userId: string) => `export:${userId}`;

/** The entry an image has in the archive; export.json names it under the post's media. */
export function mediaEntry(id: string): string {
  return `media/${id}.webp`;
}

/** The download's name: the handle and the day, so several exports of one account sort by date. */
export function exportFilename(handle: string, now: Date): string {
  return `korbat-export-${handle}-${now.toISOString().slice(0, 10)}.zip`;
}

/**
 * What the archive is written from. The account's own facts and the profile are read before the first
 * byte; the profile's lists are read page by page while export.json is written, and the images, each
 * behind the media module's checked open, go first, so `missingMedia` is complete by the time the JSON
 * that lists it is written.
 */
export interface ExportPlan {
  exportedAt: Date;
  /** The handle of the session that asked for the export: the id the auth module lists each session under. */
  currentSession: string;
  account: AccountExport;
  profile: ProfileExport;
  images: { id: string; open: OpenFile }[];
  /** The images whose file the checked open refused or could not find, filled while the images are written. */
  missingMedia: string[];
}

/**
 * Counts one export of the account in the daily window and refuses once it is used up. Taken before
 * anything is built or streamed, so a stream that fails midway still counts; Retry-After says when the
 * window resets.
 */
export async function enforceExportLimit(deps: AccountDeps, userId: string): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(exportLimitKey(userId), EXPORT_WINDOW_MS);
  } catch {
    // Fails closed: an export that cannot be counted is not made, and the client is told to retry shortly.
    throw new AccountError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > EXPORTS_PER_WINDOW) throw new AccountError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Gives the day's export back after a failure before the archive's first byte (a pool timeout, a
 * restart): the owner received nothing, so the attempt must not use up the day. Best effort: when the
 * store cannot be reached, the export stays counted and a warning says so, which costs the owner a day
 * at worst.
 */
export async function giveBackExport(deps: AccountDeps, userId: string, log: Logger): Promise<void> {
  try {
    await deps.limits.release(exportLimitKey(userId));
  } catch (err) {
    log.warn({ err, userId }, "account export: the day's export could not be given back after a failure before the first byte");
  }
}

const iso = (at: Date): string => at.toISOString();
const isoOrNull = (at: Date | null): string | null => (at ? at.toISOString() : null);

/**
 * Reads what is needed before the first byte: the account's facts, sessions, devices and events (one
 * read, bounded by the 90 days of events), the profile's own fields, and the list of images. The three
 * modules are asked at once. `currentSession` is the handle of the session asking, which marks its
 * entry among the sessions. `pageSize` is how many rows of each profile list are read at a time; tests
 * lower it.
 */
export async function buildExport(deps: AccountDeps, userId: string, currentSession: string, now: Date, pageSize?: number): Promise<ExportPlan> {
  const [account, profile, images] = await Promise.all([deps.auth.exportAccount(userId), deps.social.exportProfile(userId, pageSize), deps.media.exportImages(userId)]);
  return { exportedAt: now, currentSession, account, profile, images, missingMedia: [] };
}

/** A list member of export.json, read in pages and written one element at a time. */
class Paged<T> {
  constructor(
    readonly pages: AsyncIterable<readonly T[]>,
    readonly element: (row: T) => unknown,
  ) {}
}

/** An array already in memory, as one page. */
function inMemory<T>(rows: readonly T[], element: (row: T) => unknown): Paged<T> {
  return new Paged(
    (async function* () {
      yield rows;
    })(),
    element,
  );
}

/** Fragments are gathered into pieces of about this many UTF-16 units, at most 3 bytes each in UTF-8: well under 64 KiB. */
const PIECE_CHARS = 16 * 1024;

/**
 * export.json in pieces, written exactly as JSON.stringify(document, null, 2) writes the whole
 * document: member by member at the top level, and the lists element by element, each element
 * stringified on its own and indented to its depth (JSON.stringify's output holds line breaks only
 * between tokens; one inside a string is escaped, so indenting after every line break is exact). No list
 * is ever whole in memory: each is read page by page as it is written.
 */
export async function* exportJson(plan: ExportPlan): AsyncGenerator<string> {
  let buffer = "";
  for await (const fragment of documentFragments(plan)) {
    buffer += fragment;
    if (buffer.length >= PIECE_CHARS) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer.length > 0) yield buffer;
}

async function* documentFragments(plan: ExportPlan): AsyncGenerator<string> {
  const { account, profile } = plan;
  const ref = (row: { postId: string; at: Date }) => ({ postId: row.postId, at: iso(row.at) });
  const other = (row: { handle: string; since: Date }) => ({ handle: row.handle, since: iso(row.since) });
  // The members in the order of the format (ExportFormat in the contracts); the order is part of the bytes.
  const members: [string, unknown][] = [
    ["format", "korbat-export-1"],
    ["exportedAt", iso(plan.exportedAt)],
    [
      "account",
      {
        id: account.account.id,
        email: account.account.email,
        createdAt: iso(account.account.createdAt),
        role: account.account.role,
        mfaEnabled: account.account.mfaEnabled,
        hasPassword: account.account.hasPassword,
        verified: account.account.verified,
        termsVersion: account.account.termsVersion,
        termsAcceptedAt: isoOrNull(account.account.termsAcceptedAt),
        // Inside the account, where the format places them; at most the cap of ten, so they are written with the account's other facts rather than paged.
        passkeys: account.passkeys.map((passkey) => ({ name: passkey.name, createdAt: iso(passkey.createdAt), lastUsedAt: isoOrNull(passkey.lastUsedAt), synced: passkey.synced, createdOn: passkey.createdOn })),
      },
    ],
    [
      "profile",
      {
        handle: profile.profile.handle,
        displayName: profile.profile.displayName,
        bio: profile.profile.bio,
        createdAt: iso(profile.profile.createdAt),
        handleHistory: [...profile.profile.handleHistory],
      },
    ],
    [
      "posts",
      new Paged(profile.posts, (post) => ({
        id: post.id,
        body: post.body,
        createdAt: iso(post.createdAt),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        state: post.state,
        deletedAt: isoOrNull(post.deletedAt),
        media: post.media.map((image) => ({ id: image.id, file: mediaEntry(image.id), altText: image.altText, width: image.width, height: image.height })),
      })),
    ],
    ["likes", new Paged(profile.likes, ref)],
    ["reposts", new Paged(profile.reposts, ref)],
    ["bookmarks", new Paged(profile.bookmarks, ref)],
    ["following", new Paged(profile.following, other)],
    ["blocks", new Paged(profile.blocks, other)],
    ["mutes", new Paged(profile.mutes, other)],
    [
      "sessions",
      inMemory(account.sessions, (session) => ({ id: session.id, createdAt: iso(session.createdAt), lastUsedAt: iso(session.lastUsedAt), current: session.id === plan.currentSession })),
    ],
    [
      "devices",
      // The platform column is text; sign-in only ever writes one of the contract's three values.
      inMemory(account.devices, (device) => ({ label: device.label, platform: device.platform as Platform, firstSeenAt: iso(device.firstSeenAt), lastSeenAt: iso(device.lastSeenAt) })),
    ],
    ["events", inMemory(account.events, (event) => ({ type: event.type, at: iso(event.at) }))],
    // Complete by now: the images were written before the JSON.
    ["missingMedia", inMemory(plan.missingMedia, (id) => id)],
  ];

  yield "{\n";
  for (const [index, [key, value]] of members.entries()) {
    yield `${index === 0 ? "" : ",\n"}  ${JSON.stringify(key)}: `;
    if (value instanceof Paged) yield* listFragments(value);
    else yield indented(JSON.stringify(value, null, 2), "  ");
  }
  yield "\n}";
}

/** A top-level member's array, as JSON.stringify writes it at that depth: "[]" when empty, else one element per line group. */
async function* listFragments<T>(list: Paged<T>): AsyncGenerator<string> {
  let first = true;
  for await (const page of list.pages) {
    for (const row of page) {
      yield `${first ? "[\n" : ",\n"}    ${indented(JSON.stringify(list.element(row), null, 2), "    ")}`;
      first = false;
    }
  }
  yield first ? "[]" : "\n  ]";
}

const indented = (json: string, pad: string): string => json.replaceAll("\n", `\n${pad}`);

/**
 * Writes the archive: every image as a stored entry, then export.json, then the central directory.
 * export.json comes last so that missingMedia can name every image whose file the checked open refused
 * or did not find when its turn came (the sweeper may be between the row and the file); the order of
 * entries means nothing to a reader.
 */
export async function writeExport(writer: ZipWriter, plan: ExportPlan): Promise<void> {
  for (const image of plan.images) {
    if (!(await writer.addFile(mediaEntry(image.id), image.open))) plan.missingMedia.push(image.id);
  }
  await writer.addJsonPieces("export.json", exportJson(plan));
  await writer.end();
}
```

### Replace `apps/api/src/account/routes.ts` (whole file)

```ts
import { DeleteConfirmRequest } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { clearSessionCookies, type RequestContext } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { AccountDeps } from "./context";
import { confirmDeletion, startDeletion } from "./flows/deletion";
import { buildExport, enforceExportLimit, exportFilename, giveBackExport, writeExport, type ExportPlan } from "./flows/export";
import { createZipWriter } from "./zip";

/**
 * The account endpoints, mounted at /api/account. `guard` is the auth module's requireSession: an
 * onboarded account, with CSRF and Origin already checked for cookie sessions. `fresh` is its
 * requireFreshAuth: a credential proven in the last five minutes, which the export needs on top
 * (1b design, section 10). `strong` is its requireStrongFreshAuth: level 2 on an account with TOTP,
 * which starting and confirming a deletion need (1c design, section 10). Errors are the app's to
 * render: AccountError and those of the three modules.
 */
export function accountRoutes(deps: AccountDeps, guard: MiddlewareHandler<AppEnv>, fresh: MiddlewareHandler<AppEnv>, strong: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();

  /** What the auth flows record about a request, as the auth routes build it: the hashed address, never the address. */
  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
  });

  r.post("/delete/start", guard, strong, async (c) => c.json(await startDeletion(deps, c.get("session")!, requestContext(c))));

  r.post("/delete/confirm", guard, strong, validate("json", DeleteConfirmRequest), async (c) => {
    await confirmDeletion(deps, c.get("session")!, c.req.valid("json"));
    // The session behind a web request's cookies is revoked; the browser is told to drop them so it does not keep sending a dead token.
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/export", guard, fresh, async (c) => {
    const session = c.get("session")!;
    const log = c.get("log");
    // Taken before anything is built or streamed; given back below when the export fails before its first byte.
    await enforceExportLimit(deps, session.userId);
    const now = deps.now();

    // The body is a stream this handler writes itself, so a failure after the first byte can fail it: the
    // connection then drops before the final chunk, and the client sees a broken download, never a short
    // archive that ends cleanly.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const body = writable.getWriter();
    let started = false;
    let clientLeft = false;
    let plan: ExportPlan | undefined;
    let begin!: () => void;
    const begun = new Promise<void>((resolve) => (begin = resolve));
    const archive = (async () => {
      // By its handle, as the auth module lists the sessions: the hash of the token is no part of the export.
      plan = await buildExport(deps, session.userId, session.handle, now);
      const writer = createZipWriter(async (chunk) => {
        if (!started) {
          started = true;
          begin();
        }
        try {
          // Resolves once the client's side has taken the chunk: a slow client slows the file reads.
          await body.write(chunk);
        } catch (err) {
          // Only a client that went away fails a write; reading on would be waste.
          clientLeft = true;
          throw err;
        }
      });
      await writeExport(writer, plan);
      // Every chunk is on its way: the export happened. Recorded before the body ends, so whoever read the whole body
      // finds the event; a failure to record it is logged and does not spoil a complete download.
      await deps.auth.appendEvent(session.userId, "export_created").catch((err: unknown) => log.error({ err, userId: session.userId }, "account export: the export_created event could not be recorded"));
      await body.close();
    })();

    try {
      // Until the first chunk the export can still fail as a plain error response.
      await Promise.race([begun, archive]);
    } catch (err) {
      // Nothing was sent, so nothing was exported: the day's export goes back before the error is answered.
      await giveBackExport(deps, session.userId, log);
      throw err;
    }
    // From here the failure of the archive can only fail the body; as the design says, the day's export stays spent.
    archive.catch(async (err: unknown) => {
      await body.abort(err).catch(() => undefined);
      if (clientLeft) log.warn({ userId: session.userId }, "account export: the client left before the archive was complete");
      else log.error({ err, userId: session.userId }, "account export: the archive could not be completed");
    });

    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${exportFilename(plan!.profile.profile.handle, now)}"`);
    // The archive holds the account's email address; nothing on the way may keep a copy.
    c.header("Cache-Control", "no-store");
    return c.body(readable, 200);
  });

  return r;
}
```

### Replace `apps/api/src/auth/flows/account.ts` (whole file)

```ts
import type { MeResponse, SessionsResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps } from "../context";
import type { Session } from "../sessions";
import { notifyAccount } from "./notify";

/** The signed-in account. The only response in the API that contains the email address. */
export async function me(deps: AuthDeps, session: Session): Promise<MeResponse> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      onboarded: user.onboardedAt !== null,
      mfaEnabled: user.totpEnabledAt !== null,
      hasPassword: user.passwordHash !== null,
      // The count only (1c design, section 7.5); the Security list is where the passkeys themselves are read.
      passkeys: await deps.repo.countPasskeys(user.id),
    },
    profile: await deps.profiles.find(user.id),
  };
}

/** The user's live sessions, each under its handle: the id that stays while the session's token rotates. */
export async function listSessions(deps: AuthDeps, session: Session): Promise<SessionsResponse> {
  return { sessions: await deps.sessions.list(session.userId, session.handle) };
}

/**
 * Revokes one of the user's own sessions, named by the handle the list gave, so a session that re-authenticated since
 * it was listed (its token rotated) is still revoked. False when no such live session belongs to them.
 */
export async function revokeSession(deps: AuthDeps, session: Session, handle: string): Promise<boolean> {
  const revoked = await deps.sessions.revoke(handle, session.userId);
  if (revoked) await deps.repo.appendEvent({ userId: session.userId, type: "session_revoked", deviceId: session.deviceId, metadata: { handle } });
  return revoked;
}

/** Signs out every session of the account, including the current one (the route requires fresh auth). */
export async function revokeAllSessions(deps: AuthDeps, session: Session): Promise<number> {
  const user = await deps.repo.findUserById(session.userId);
  const count = await deps.sessions.revokeAll(session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "sessions_revoked_all", deviceId: session.deviceId, metadata: { count } });
  if (user) await notifyAccount(deps, user.email, "sessions_revoked_all", { count: String(count) });
  return count;
}

export async function signOut(deps: AuthDeps, session: Session): Promise<void> {
  await deps.sessions.revoke(session.handle, session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "session_revoked", deviceId: session.deviceId, metadata: { signOut: true } });
}
```

### Replace `apps/api/src/auth/flows/email-change.ts` (whole file)

```ts
import type { EmailChangeResponse, EmailChangeStartRequest, EmailChangeVerifyRequest, EmailRevertRequest } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { isDisposableEmail } from "../disposable";
import { emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit, padResponseTime } from "../limits";
import type { Session } from "../sessions";
import { CODE_TTL_MS, MIN_START_RESPONSE_MS, checkEmailCode, emailCodeHash, flowKey, newEmailCode, sendCode } from "./email";
import { lockdown } from "./lockdown";
import { notifyAccount } from "./notify";

export const EMAIL_CHANGE_STARTS_PER_HOUR = 3;
/** How long the old address can undo a change, as long as the new-device "not me" link works. */
export const EMAIL_REVERT_TTL_MS = 24 * HOUR;
export const EMAIL_REVERTS_PER_IP_PER_HOUR = 10;

/** The undo link is a bearer credential for a day, so the store holds only its hash. */
export const emailRevertKey = (token: string) => `email-revert:${sha256Hex(token)}`;
/** Present while an account's undo link is out; see openRevert. */
export const emailRevertOpenKey = (userId: string) => `email-revert-open:${userId}`;

/** The change a code is out for: kept under the hashed flow id until the code is entered or expires. */
export interface PendingEmailChange {
  userId: string;
  email: string;
}

/**
 * What an undo link puts back: the address the account had, when it left it (epoch milliseconds from the
 * flows' clock, the one passwordChangedAt, totpEnabledAt and a passkey's createdAt are written with, so the
 * lockdown at the undo compares like with like), and the passkey behind the session that made the change,
 * which the lockdown removes whatever its age.
 */
export interface PendingEmailRevert {
  userId: string;
  oldEmail: string;
  changedAt: number;
  passkeyId: string | null;
}

const LINK_GONE = "This link has expired or was already used.";

/**
 * Sends a code to the address the account wants to move to. The answer, the mail and the time taken
 * are the same whether or not that address already has an account: the conflict is reported only at
 * verification, once the code has proved that the requester holds the mailbox, so this step tells
 * nobody which addresses are registered.
 */
export async function startEmailChange(deps: AuthDeps, session: Session, input: EmailChangeStartRequest, ctx: RequestContext): Promise<{ flowId: string }> {
  const startedAt = Date.now();
  try {
    if (isDisposableEmail(input.email)) throw new AuthError("disposable_email", 400);
    const user = await deps.repo.findUserById(session.userId);
    if (!user) throw new AuthError("invalid_credentials", 401);
    // Refused before any limit is touched, so a slip does not put the account's own address on the cooldown its sign-in codes share.
    if (user.email.toLowerCase() === input.email.toLowerCase()) throw new AuthError("invalid_request", 400, "That is already your email address.");
    await enforceLimit(deps.kv, `email-change:${user.id}`, EMAIL_CHANGE_STARTS_PER_HOUR, HOUR);
    // The new address gets the sign-in start's cooldown and hourly limit, in the same buckets, so asking
    // for a change cannot send an address more codes than asking to sign in could.
    const hashedEmail = emailHash(deps.config.authHmacKey, input.email);
    if (!(await deps.kv.setIfAbsent(`email-cooldown:${hashedEmail}`, "1", MINUTE))) throw new AuthError("rate_limited", 429, undefined, MINUTE / 1000);
    await enforceLimit(deps.kv, `email-start:email:${hashedEmail}`, 3, HOUR);

    const flowId = randomToken();
    const code = newEmailCode();
    await deps.repo.createEmailCode({
      flowId,
      email: input.email,
      userId: user.id,
      purpose: "change_email",
      codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
      expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
      ipHash: ctx.ipHash,
    });
    const pending: PendingEmailChange = { userId: user.id, email: input.email };
    await deps.kv.set(flowKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
    await sendCode(deps, { to: input.email, template: "email_change_code", data: { code } });
    return { flowId };
  } finally {
    await padResponseTime(startedAt, MIN_START_RESPONSE_MS);
  }
}

/**
 * Moves the account to the new address once its code is right. The unique index on the address
 * decides conflicts, so an address that got an account after the code went out is email_in_use here.
 * Every session stays signed in, because the owner just proved a credential. The old address is told,
 * with a link that undoes the change for 24 hours (revertEmailChange): an account without a password
 * signs in only by a code to its address, so once the address is someone else's, the old one could not
 * sign in to change it back.
 */
export async function verifyEmailChange(deps: AuthDeps, session: Session, input: EmailChangeVerifyRequest): Promise<EmailChangeResponse> {
  const row = await deps.repo.findEmailCode(input.flowId);
  // A code from another account's change, or from any other flow, is no code at all. The row carries
  // the owner, so this is settled before an attempt is counted: nobody can spend another account's attempts.
  if (row?.purpose !== "change_email" || row.userId !== session.userId) throw new AuthError("invalid_code", 400);
  await checkEmailCode(deps, row, input.flowId, input.code);
  // Taken, not read: whatever happens next, this flow is over and the code is spent.
  const raw = await deps.kv.take(flowKey(input.flowId));
  if (!raw) throw new AuthError("code_expired", 400);
  const pending = JSON.parse(raw) as PendingEmailChange;

  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const changedAt = deps.now();
  try {
    await deps.repo.changeEmail(user.id, pending.email, changedAt);
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("email_in_use", 409);
    throw err;
  }
  // Hashes only: the event log never holds an address.
  await deps.repo.appendEvent({
    userId: user.id,
    type: "email_changed",
    deviceId: session.deviceId,
    metadata: { from: emailHash(deps.config.authHmacKey, user.email), to: emailHash(deps.config.authHmacKey, pending.email) },
  });
  const revertUrl = await openRevert(deps, { userId: user.id, oldEmail: user.email, changedAt: changedAt.getTime(), passkeyId: session.passkeyId });
  await notifyAccount(deps, user.email, "email_changed", revertUrl === null ? { email: pending.email } : { email: pending.email, revertUrl });
  return { email: pending.email };
}

/**
 * Mints the undo link for a change, or none. One link per account at a time: the first change opens a
 * day in which later changes get no link of their own, and the one link, used, goes back to the address
 * before that first change. A link per change would undo nothing: someone who took the account and
 * changed the address twice would hold the link sent to the address in the middle, one of their own,
 * and could use it after the owner used theirs to move the account back to it.
 */
async function openRevert(deps: AuthDeps, revert: PendingEmailRevert): Promise<string | null> {
  if (!(await deps.kv.setIfAbsent(emailRevertOpenKey(revert.userId), "1", EMAIL_REVERT_TTL_MS))) return null;
  const token = randomToken();
  await deps.kv.set(emailRevertKey(token), JSON.stringify(revert), EMAIL_REVERT_TTL_MS);
  return `${deps.config.appOrigin}/email-revert/${token}`;
}

/**
 * The undo link from the email_changed notice, which needs no session: the link is the credential, and
 * works once. The account goes back to the old address (email_in_use when that address got another
 * account meanwhile), then the lockdown runs anchored at the change (1c design, section 7.6): every
 * session signed out, every device revoked, the password removed, the passkeys added since the day
 * before the change and the one behind the changing session removed, and two-factor set up since then
 * turned off, so whoever made the change keeps no way in. What the owner set up earlier stays, except
 * the password, which nobody can tell from one an attacker set. The address the account was moved to
 * is told nothing; the old one gets a short note. The link is read and checked first and taken only
 * just before the address is restored, as the other links are before their lockdown: a refusal that
 * comes before the restore leaves it as it was. The restore itself can still refuse (email_in_use),
 * and by then the link is spent.
 */
export async function revertEmailChange(deps: AuthDeps, input: EmailRevertRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `email-revert:ip:${ctx.ipHash}`, EMAIL_REVERTS_PER_IP_PER_HOUR, HOUR);
  const linkKey = emailRevertKey(input.token);
  const raw = await deps.kv.get(linkKey);
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const revert = JSON.parse(raw) as PendingEmailRevert;
  // An account deleted since has nothing left to move back.
  const user = await deps.repo.findUserById(revert.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  // Taken only now, just before it acts: of two requests with the same link, one gets it and the other is refused.
  if (!(await deps.kv.take(linkKey))) throw new AuthError("invalid_code", 400, LINK_GONE);
  try {
    await deps.repo.changeEmail(user.id, revert.oldEmail, deps.now());
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("email_in_use", 409);
    throw err;
  }
  // The lockdown records the undo itself: the event log holds hashes only, never an address.
  const key = deps.config.authHmacKey;
  await lockdown(deps, {
    userId: user.id,
    anchor: new Date(revert.changedAt),
    passkeyIds: revert.passkeyId ? [revert.passkeyId] : [],
    caller: { type: "email_changed", metadata: { from: emailHash(key, user.email), to: emailHash(key, revert.oldEmail), reverted: true } },
    ctx,
  });
  // The link is spent, so the next change may send one again.
  await deps.kv.del(emailRevertOpenKey(user.id));
  await notifyAccount(deps, revert.oldEmail, "email_change_reverted");
}
```

### Replace `apps/api/src/auth/flows/export.ts` (whole file)

```ts
import { AuthError, type AuthDeps } from "../context";
import { EVENT_RETENTION_DAYS } from "../janitor";
import { HOUR } from "../limits";
import type { AuthEventType, UserRole } from "../repo";

const DAY = 24 * HOUR;

/**
 * The auth module's part of the data export (1b design, section 7.5): the account row's facts, its
 * passkeys, its live sessions, its devices and its own security events. Times are Dates here; the
 * account module writes them as ISO text.
 */
export interface AccountExport {
  account: {
    id: string;
    email: string;
    createdAt: Date;
    role: UserRole;
    mfaEnabled: boolean;
    hasPassword: boolean;
    /** The verified badge as this row records it: the phone hash is held exactly while the badge is. */
    verified: boolean;
    termsVersion: string | null;
    termsAcceptedAt: Date | null;
  };
  /**
   * The account's passkeys, newest first, as the Security list shows them (1c design, section 7.7): the key
   * material, the credential id, the AAGUID and the row's id stay behind, since none of them is the owner's to
   * carry and any of them would name the key to whoever reads the archive.
   */
  passkeys: { name: string; createdAt: Date; lastUsedAt: Date | null; synced: boolean; createdOn: string | null }[];
  /**
   * Live sessions only, most recently used first, each under its handle, as the session list names it: the hash of a
   * token is what the server finds a session by and nobody outside needs it. The caller marks the current one.
   */
  sessions: { id: string; createdAt: Date; lastUsedAt: Date }[];
  devices: { label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[];
  /** The account's own events, newest first, at most the 90 days the janitor keeps; the metadata stays behind. */
  events: { type: AuthEventType; at: Date }[];
}

export async function exportAccount(deps: AuthDeps, userId: string): Promise<AccountExport> {
  const user = await deps.repo.findUserById(userId);
  // A session whose account is gone is answered as /me answers it.
  if (!user) throw new AuthError("invalid_credentials", 401);
  const now = deps.now();
  const [passkeys, sessions, devices, events] = await Promise.all([
    deps.repo.listPasskeys(userId),
    deps.repo.listActiveSessions(userId, now),
    deps.repo.listDevices(userId),
    deps.repo.eventsSince(userId, new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY)),
  ]);
  return {
    account: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      role: user.role,
      mfaEnabled: user.totpEnabledAt !== null,
      hasPassword: user.passwordHash !== null,
      verified: user.phoneHash !== null,
      termsVersion: user.termsVersion,
      termsAcceptedAt: user.termsAcceptedAt,
    },
    // The backed-up flag is what the Security list calls synced; the list is already newest first.
    passkeys: passkeys.map((passkey) => ({ name: passkey.name, createdAt: passkey.createdAt, lastUsedAt: passkey.lastUsedAt, synced: passkey.backedUp, createdOn: passkey.createdOn })),
    sessions: sessions.map((session) => ({ id: session.handle, createdAt: session.createdAt, lastUsedAt: session.lastUsedAt })),
    devices: devices.map((device) => ({ label: device.label, platform: device.platform, firstSeenAt: device.firstSeenAt, lastSeenAt: device.lastSeenAt })),
    events: events.map((event) => ({ type: event.type, at: event.createdAt })),
  };
}
```

### Replace `apps/api/src/auth/flows/lockdown.ts` (whole file)

```ts
import type { AuthDeps, RequestContext } from "../context";
import { HOUR } from "../limits";
import type { AuthEventType } from "../repo";

/** How far back a lockdown reaches before its anchor (1c design, section 2): a day catches what an attacker set up just before the event the owner noticed. */
export const LOCKDOWN_LOOKBACK_MS = 24 * HOUR;

/** Who ran the lockdown, for the event it records: the event's type, the device it concerns, and the caller's own facts, kept beside the lockdown's. */
export interface LockdownCaller {
  type: AuthEventType;
  deviceId?: string | null;
  metadata?: Record<string, unknown>;
}

/** What one run did, as its event records it. The password is cleared on every run. */
export interface LockdownReport {
  passkeysRemoved: string[];
  totpCleared: boolean;
  passwordCleared: true;
}

/**
 * The one routine behind every undo link (1c design, sections 2 and 7.6): every session revoked with a tombstone, every
 * device revoked (so the next sign-in on any of them is a new device again, and the owner hears of it), the password
 * cleared, the passkeys created at or after the day before the anchor removed, plus any the caller names (the one that
 * signed in, or the one a link is about, whatever its age), and TOTP turned off when it was enabled at or after that
 * day. The anchor is the event the owner is answering: the alerted sign-in, the address change, a passkey's creation.
 * What the owner had from before stays, except the password, which nobody can tell from one an attacker set. Running
 * it again finds nothing more to remove and records that.
 *
 * All of it, the event included, is one transaction of the repository's: the link behind a lockdown is spent before it
 * starts, so a run that a database fault stopped halfway could not be repeated. A run that fails leaves the account as
 * it was. The tombstones follow the commit, since the cache is not the database's to write.
 */
export async function lockdown(
  deps: AuthDeps,
  input: { userId: string; anchor: Date; passkeyIds?: readonly string[]; caller: LockdownCaller; ctx: RequestContext },
): Promise<LockdownReport> {
  const since = new Date(input.anchor.getTime() - LOCKDOWN_LOOKBACK_MS);
  const done = await deps.repo.lockDown(input.userId, {
    now: deps.now(),
    since,
    passkeyIds: input.passkeyIds ?? [],
    event: { type: input.caller.type, deviceId: input.caller.deviceId ?? null, ipHash: input.ctx.ipHash, metadata: input.caller.metadata ?? {} },
  });
  try {
    await deps.sessions.tombstone(done.sessionIds);
  } catch (err) {
    // Best effort, as after a deletion's take-down: the rows are revoked whatever happens here, so a failure only lets a
    // cached copy live out its minute, and the owner is not told that a lockdown which landed has failed.
    deps.log.error({ err, userId: input.userId }, "lockdown: the session tombstones could not be written; the sessions are revoked in the database");
  }
  return { passkeysRemoved: done.passkeysRemoved, totpCleared: done.totpCleared, passwordCleared: true };
}
```

### Replace `apps/api/src/auth/flows/mfa.ts` (whole file)

```ts
import type { MfaVerifyRequest, TotpCodeRequest, TotpSetupResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { decrypt, encrypt, payloadVersion } from "../crypto";
import { MINUTE, enforceLimit } from "../limits";
import { hashRecoveryCode, newRecoveryCodes } from "../recovery-codes";
import type { UserRow } from "../repo";
import type { FactorKind, IssuedSession, Session } from "../sessions";
import { newTotpSecret, totpQrSvg, totpUri, verifyTotp } from "../totp";
import { notifyAccount } from "./notify";
import { MFA_TICKET_TTL_MS, mfaTicketKey, signIn, type MfaTicket, type SignedIn } from "./signin";

export const TOTP_PENDING_TTL_MS = 10 * MINUTE;
export const MAX_MFA_ATTEMPTS = 5;

/** The pending secret of a setup, kept for the session's handle (1c design, section 2): a rotation keeps the handle, and no other session can confirm it. */
export const totpPendingKey = (handle: string) => `totp-pending:${handle}`;

/**
 * The account's TOTP secret. Previous keys are accepted so that TOTP_ENC_KEY can rotate; a secret
 * still encrypted with an earlier key is re-encrypted with the current one as soon as it is read.
 */
export async function storedSecret(deps: AuthDeps, user: UserRow): Promise<Uint8Array> {
  if (!user.totpSecretEnc) throw new AuthError("mfa_required", 400);
  const secret = decrypt(user.totpSecretEnc, [deps.config.totpKey, ...deps.config.totpPreviousKeys]);
  if (payloadVersion(user.totpSecretEnc) !== deps.config.totpKey.version) {
    await deps.repo.setTotpSecretEnc(user.id, encrypt(secret, deps.config.totpKey));
  }
  return new Uint8Array(secret);
}

/** Verifies a TOTP code and claims its time step atomically, so the same code cannot be used twice. */
async function acceptTotp(deps: AuthDeps, user: UserRow, code: string): Promise<boolean> {
  const step = verifyTotp(await storedSecret(deps, user), code, user.totpLastStep, deps.now().getTime());
  return step !== null && (await deps.repo.claimTotpStep(user.id, step));
}

/**
 * Starts setup with a new secret held encrypted for 10 minutes under the session's handle. Needs a fresh session, at
 * level 2 once the account has TOTP, since setup replaces the secret and the recovery codes (the route checks as well).
 */
export async function setupTotp(deps: AuthDeps, session: Session): Promise<TotpSetupResponse> {
  const needed = deps.sessions.reauthNeeded(session, deps.sessions.requiredLevel(session));
  if (needed) throw new AuthError("reauth_required", 403, undefined, undefined, needed);
  const secret = newTotpSecret();
  await deps.kv.set(totpPendingKey(session.handle), encrypt(Buffer.from(secret), deps.config.totpKey), TOTP_PENDING_TTL_MS);
  const profile = await deps.profiles.find(session.userId);
  const otpauthUri = totpUri(secret, profile?.handle ?? "account");
  return { otpauthUri, qrSvg: totpQrSvg(otpauthUri) };
}

const SETUP_EXPIRED = "Two-factor setup expired. Start again.";

/**
 * Turns MFA on with the pending secret its setup stored for this session's handle: no freshness check of its own, so
 * scanning the QR code cannot run the window out. Issues 10 recovery codes (shown once), writes the totp factor (the
 * code proved the new secret), drops every cached copy of the account's sessions so mfaEnabled is right, rotates the
 * token in place and tells the owner. The pending secret is read first, so a wrong code does not end the setup, and
 * spent once the code is right, before anything is written: of two confirmations at once (a double submit) one
 * turns two-factor on, and the other is refused before it could replace the recovery codes the first one shows.
 */
export async function confirmTotp(deps: AuthDeps, session: Session, input: TotpCodeRequest): Promise<{ recoveryCodes: string[]; issued: IssuedSession }> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const pendingKey = totpPendingKey(session.handle);
  const pending = await deps.kv.get(pendingKey);
  if (!pending) throw new AuthError("invalid_mfa_code", 400, SETUP_EXPIRED);
  const secret = new Uint8Array(decrypt(pending, [deps.config.totpKey]));
  const step = verifyTotp(secret, input.code, null, deps.now().getTime());
  if (step === null) throw new AuthError("invalid_mfa_code", 400);
  // Taken, and compared with what the code was checked against: gone means another confirmation spent it, and another
  // value means a newer setup replaced the secret this code proved.
  if ((await deps.kv.take(pendingKey)) !== pending) throw new AuthError("invalid_mfa_code", 400, SETUP_EXPIRED);

  const recoveryCodes = newRecoveryCodes();
  await deps.repo.enableTotp(session.userId, {
    secretEnc: pending,
    recoveryCodesHash: recoveryCodes.map((code) => hashRecoveryCode(deps.config.authHmacKey, code)),
    now: deps.now(),
  });
  await deps.repo.claimTotpStep(session.userId, step);
  await deps.repo.appendEvent({ userId: session.userId, type: "mfa_enabled", deviceId: session.deviceId });
  await deps.sessions.addFactor(session.sessionId, "totp");
  await deps.sessions.forgetUser(session.userId);
  const issued = await deps.sessions.rotate(session);
  await notifyAccount(deps, user.email, "mfa_enabled");
  return { recoveryCodes, issued };
}

/**
 * Second factor at sign-in: a TOTP code, or a recovery code (single use; the response then asks the
 * user to set up MFA again). A ticket allows five wrong attempts and issues at most one session.
 */
export async function verifyMfa(deps: AuthDeps, input: MfaVerifyRequest, ctx: RequestContext): Promise<SignedIn> {
  await enforceLimit(deps.kv, `mfa-verify:ip:${ctx.ipHash}`, 20, 15 * MINUTE);
  const key = mfaTicketKey(input.mfaTicket);
  const raw = await deps.kv.get(key);
  if (!raw) throw new AuthError("invalid_mfa_code", 401);
  const ticket = JSON.parse(raw) as MfaTicket;

  if ((await deps.kv.incr(`mfa-attempts:${key}`, MFA_TICKET_TTL_MS)) > MAX_MFA_ATTEMPTS) {
    await deps.kv.del(key);
    throw new AuthError("too_many_attempts", 429);
  }

  const user = await deps.repo.findUserById(ticket.userId);
  if (!user?.totpSecretEnc) throw new AuthError("invalid_mfa_code", 401);

  let mustReenrollMfa = false;
  let second: FactorKind;
  if ("code" in input) {
    if (!(await acceptTotp(deps, user, input.code))) {
      await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "totp" } });
      throw new AuthError("invalid_mfa_code", 401);
    }
    second = "totp";
  } else {
    const consumed = await deps.repo.consumeRecoveryCodeHash(user.id, hashRecoveryCode(deps.config.authHmacKey, input.recoveryCode));
    if (!consumed) {
      await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "recovery_code" } });
      throw new AuthError("invalid_mfa_code", 401);
    }
    mustReenrollMfa = true;
    second = "recovery";
  }

  if (!(await deps.kv.take(key))) throw new AuthError("invalid_mfa_code", 401);
  // The second factor joins the first step's, from the ticket, at this step's clock.
  const signed = await signIn(deps, user, { deviceId: ticket.deviceId, platform: ticket.platform }, ctx, {
    alertNewDevice: true,
    mustReenrollMfa,
    factors: { ...ticket.factors, [second]: deps.now().getTime() },
    method: ticket.method,
    passkeyId: ticket.passkeyId,
  });
  if (second === "recovery") {
    // Recorded with the device the session was issued on, whose row a first sign-in creates only in signIn (the ticket
    // holds the app's device id, not the row), and announced as the re-authentication path announces it: a code spent is
    // one fewer of ten, whichever path spent it.
    await deps.repo.appendEvent({ userId: user.id, type: "recovery_code_used", deviceId: signed.issued.session.deviceId, ipHash: ctx.ipHash });
    await notifyAccount(deps, user.email, "recovery_code_used");
  }
  return signed;
}

/**
 * Turns MFA off and tells the owner. No code: the route needs level 2, so a TOTP or recovery code was proven minutes ago
 * (1c design, section 2). Staff accounts can never turn it off.
 */
export async function disableTotp(deps: AuthDeps, session: Session): Promise<void> {
  if (session.role !== "user") throw new AuthError("staff_mfa_required", 403);
  const user = await deps.repo.findUserById(session.userId);
  if (!user?.totpSecretEnc) throw new AuthError("mfa_required", 400);
  await deps.repo.disableTotp(user.id);
  await deps.sessions.forgetUser(user.id);
  await deps.repo.appendEvent({ userId: user.id, type: "mfa_disabled", deviceId: session.deviceId });
  await notifyAccount(deps, user.email, "mfa_disabled");
}

/** Replaces all recovery codes (the route requires strong fresh auth) and tells the owner. The old codes stop working. */
export async function regenerateRecoveryCodes(deps: AuthDeps, session: Session): Promise<string[]> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user?.totpEnabledAt) throw new AuthError("mfa_required", 400);
  const recoveryCodes = newRecoveryCodes();
  await deps.repo.setRecoveryCodes(user.id, recoveryCodes.map((code) => hashRecoveryCode(deps.config.authHmacKey, code)));
  await deps.repo.appendEvent({ userId: user.id, type: "recovery_codes_regenerated", deviceId: session.deviceId });
  await notifyAccount(deps, user.email, "recovery_codes_regenerated");
  return recoveryCodes;
}
```

### Replace `apps/api/src/auth/flows/not-me.ts` (whole file)

```ts
import type { NotMeRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { emailHash } from "../identifiers";
import { HOUR, enforceLimit } from "../limits";
import { lockdown } from "./lockdown";
import { NOT_ME_TTL_MS, notMeKey, type NotMeToken } from "./signin";

const LINK_GONE = "This link has expired or was already used.";

/**
 * "This wasn't me" from a new-device email: the lockdown (1c design, section 7.6) anchored at the sign-in the alert
 * announced, naming the passkey that signed in, if one did. The link works once, within 24 hours, and does nothing but
 * refuse when the account is gone or its address is no longer the one the alert went to: a link mailed to an attacker's
 * address dies when the owner's is restored. A refusal does not spend the link: the owner may open it while an
 * attacker's address change stands, and it works once the email undo has restored the address, reaching the day before
 * the alerted sign-in, which the undo's lockdown may not. A link from before 1c (no sign-in time, or the bare user id)
 * is anchored at its use minus its 24-hour life, so it removes more, never less, and checks no address.
 */
export async function notMe(deps: AuthDeps, input: NotMeRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `not-me:ip:${ctx.ipHash}`, 10, HOUR);
  const key = notMeKey(input.token);
  // Read first, so that a refusal leaves the link as it was.
  const raw = await deps.kv.get(key);
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const link: NotMeToken = raw.startsWith("{") ? (JSON.parse(raw) as NotMeToken) : { userId: raw, deviceId: null };
  const user = await deps.repo.findUserById(link.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  if (link.sentTo !== undefined && link.sentTo !== emailHash(deps.config.authHmacKey, user.email)) throw new AuthError("invalid_code", 400, LINK_GONE);
  // Taken only now, just before it acts: of two requests with the same link, one gets it and the other is refused.
  if (!(await deps.kv.take(key))) throw new AuthError("invalid_code", 400, LINK_GONE);
  const anchor = link.signedInAt === undefined ? new Date(deps.now().getTime() - NOT_ME_TTL_MS) : new Date(link.signedInAt);
  await lockdown(deps, { userId: user.id, anchor, passkeyIds: link.passkeyId ? [link.passkeyId] : [], caller: { type: "not_me", deviceId: link.deviceId }, ctx });
}
```

### Replace `apps/api/src/auth/passkeys/flows.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PasskeyListResponse,
  PasskeyRegisterOptionsRequest,
  PasskeyRegisterVerifyRequest,
  PasskeyRemoveLinkRequest,
  PasskeyRenameRequest,
  PasskeySignInVerifyRequest,
  PasskeyView,
} from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { MFA_TICKET_TTL_MS, mfaTicketKey, signIn, type DeviceInput, type MfaPending, type MfaTicket, type SignedIn } from "../flows/signin";
import { lockdown } from "../flows/lockdown";
import { notifyAccount } from "../flows/notify";
import { deviceHash, emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import type { AddPasskeyOutcome, PasskeyLimits, PasskeyRow, UserRow } from "../repo";
import type { FactorKind, Session } from "../sessions";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "./challenge";
import {
  authenticationOptions,
  readResponseChallenge,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthentication,
} from "./webauthn";

const DAY = 24 * HOUR;

/** At most this many passkeys on an account at a time (1c design, section 2). */
export const PASSKEY_CAP = 10;
/** At most this many added in any 24 hours, counted from the passkey_added events, so removing one frees no slot of the day. */
export const PASSKEY_ADDITIONS_PER_DAY = 5;
export const PASSKEY_ADDITIONS_WINDOW_MS = DAY;
/** A passkey counts as new for this long: the Security list marks it and offers "This wasn't me" on it. */
export const NEW_PASSKEY_MS = 7 * DAY;
/** How long the remove link in the passkey_added notice works. */
export const PASSKEY_REMOVE_TTL_MS = 7 * DAY;
export const REGISTER_OPTIONS_PER_HOUR = 10;
export const RENAMES_PER_HOUR = 30;
export const REMOVALS_PER_HOUR = 10;
export const NOT_MINE_PER_DAY = 5;
export const REMOVE_LINKS_PER_IP_PER_HOUR = 10;
/** The window the two unauthenticated sign-in limits count over. */
export const SIGNIN_WINDOW_MS = 15 * MINUTE;
export const SIGNIN_OPTIONS_PER_IP = 30;
export const SIGNIN_VERIFY_PER_IP = 20;
/** A passkey sign-in from a device the account has not used: bounded per account, since the assertion carries no session to key by. */
export const SIGNIN_NEW_DEVICE_PER_HOUR = 5;
export const SIGNIN_NEW_DEVICE_PER_DAY = 20;

const LIMITS: PasskeyLimits = { passkeys: PASSKEY_CAP, additions: PASSKEY_ADDITIONS_PER_DAY, windowMs: PASSKEY_ADDITIONS_WINDOW_MS };
const LINK_GONE = "This link has expired or was already used.";

/** The remove link is a bearer credential for 7 days, so the store holds only its hash. */
export const passkeyRemoveKey = (token: string) => `passkey-remove:${sha256Hex(token)}`;

/**
 * What a remove link acts on: the account, the passkey, its creation (epoch milliseconds from the flows' clock, the
 * lockdown's anchor, which holds whether or not the passkey is still there) and the keyed hash of the address the link
 * went to, which the link checks against the account's current address.
 */
export interface PasskeyRemoveToken {
  userId: string;
  passkeyId: string;
  createdAt: number;
  sentTo: string;
}

/** Refuses a session that has not proven enough within the window: level 2 on an account with TOTP unless told level 1, as the route's guard does. */
function requireFresh(deps: AuthDeps, session: Session, level: 1 | 2 = deps.sessions.requiredLevel(session)): void {
  const needed = deps.sessions.reauthNeeded(session, level);
  if (needed) throw new AuthError("reauth_required", 403, undefined, undefined, needed);
}

/**
 * A bound refused, as the app reads it: the reason in the details, and for the daily bound the seconds until the day has
 * a slot again, said in hours in the message (the cap keeps the code's own message).
 */
function limitReached(bound: { reason: "cap" } | { reason: "daily"; retryAfterSeconds: number }): AuthError {
  if (bound.reason === "cap") return new AuthError("passkey_limit", 409, undefined, undefined, { reason: "cap" });
  const hours = Math.max(1, Math.ceil(bound.retryAfterSeconds / 3600));
  const wait = hours === 1 ? "1 hour" : `${hours} hours`;
  return new AuthError("passkey_limit", 409, `You added ${PASSKEY_ADDITIONS_PER_DAY} passkeys today. You can add another in about ${wait}.`, undefined, {
    reason: "daily",
    retryAfter: bound.retryAfterSeconds,
  });
}

/** Both bounds before the options are handed out, so a full account is told at once; the registration's transaction checks them again. */
async function checkBounds(deps: AuthDeps, userId: string): Promise<void> {
  if ((await deps.repo.countPasskeys(userId)) >= PASSKEY_CAP) throw limitReached({ reason: "cap" });
  const additions = await deps.repo.recentPasskeyAdditions(userId, PASSKEY_ADDITIONS_WINDOW_MS, PASSKEY_ADDITIONS_PER_DAY);
  if (additions.count >= PASSKEY_ADDITIONS_PER_DAY) throw limitReached({ reason: "daily", retryAfterSeconds: additions.retryAfterSeconds });
}

const isNew = (createdAt: Date, now: Date) => now.getTime() - createdAt.getTime() < NEW_PASSKEY_MS;

/** A passkey as the Security list shows it: nothing of the key itself. */
function view(row: PasskeyRow, createdOn: string | null, session: Session, now: Date): PasskeyView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    synced: row.backedUp,
    createdOn,
    current: session.passkeyId === row.id,
    isNew: isNew(row.createdAt, now),
    suspended: row.suspectAt !== null,
  };
}

/** The name a passkey gets when the owner gives none: after the platform of the device whose session added it. */
function defaultName(platform: string | undefined): string {
  const where = platform === "ios" ? "iOS" : platform === "android" ? "Android" : "the web";
  return `Passkey on ${where}`;
}

/** A time as the passkey notices print it: the date and the minute in UTC, since the reader's zone is unknown. */
function mailTime(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Options for adding a passkey (1c design, section 7.3): the account's user handle (set now if it never had one), the
 * label the password manager will show, the account's passkeys excluded so an authenticator does not add a second copy,
 * and a registration challenge bound to this session's handle. Needs level 2 on an account with TOTP (the route checks as
 * well): adding a credential is the first thing a stolen session would do.
 */
export async function registerOptions(deps: AuthDeps, session: Session, input: PasskeyRegisterOptionsRequest): Promise<{ options: PublicKeyCredentialCreationOptionsJSON }> {
  requireFresh(deps, session);
  // Counted by the handle: a rotation keeps it, and no other session of the account can spend it.
  await enforceLimit(deps.kv, `passkey-register:${session.handle}`, REGISTER_OPTIONS_PER_HOUR, HOUR);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  await checkBounds(deps, user.id);
  // 32 random bytes, never the account id, set once: a registration racing this one reads the same bytes back.
  const userId = user.webauthnUserId ?? (await deps.repo.ensureWebauthnUserId(user.id, randomBytes(32)));
  if (!userId) throw new AuthError("invalid_credentials", 401);
  const held = await deps.repo.listPasskeys(user.id);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "register", deps.now(), session.handle);
  const options = await registrationOptions({
    rp: { id: deps.config.webauthn.rpId, name: deps.config.webauthn.rpName },
    // The label goes to the password manager and nowhere else: korbat keeps nothing of it.
    user: { id: userId, name: input.label, displayName: input.label },
    exclude: held.map((p) => ({ id: p.credentialId, transports: p.transports })),
    challenge,
  });
  return { options };
}

/**
 * Stores the passkey the browser created (1c design, section 7.3). The challenge is read from the response, checked
 * against this session's handle and spent before anything else runs, so it stays spent whatever happens next; it was
 * issued to a strong-fresh session and bound to it, so no second freshness check is needed and a ceremony that outlasts
 * the window still completes. The row and its passkey_added event land in one transaction that checks both bounds
 * again. The session's factors do not change: adding a passkey proves nothing about the session. Then the owner is told,
 * with a one-shot link that runs the lockdown for 7 days, tied to the address it goes to.
 */
export async function registerVerify(deps: AuthDeps, session: Session, input: PasskeyRegisterVerifyRequest): Promise<{ passkey: PasskeyView }> {
  const now = deps.now();
  const challenge = readResponseChallenge(input.response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "register", now, session.handle);
  await spendChallenge(deps.kv, challenge, now);
  const verified = await verifyRegistration({ response: input.response, expectedChallenge: challenge, origins: deps.config.webauthn.origins, rpId: deps.config.webauthn.rpId });
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const device = await deps.repo.findDeviceById(session.deviceId);
  const name = input.name ?? defaultName(device?.platform);
  let outcome: AddPasskeyOutcome;
  try {
    outcome = await deps.repo.addPasskey(
      {
        userId: user.id,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports,
        aaguid: verified.aaguid,
        backupEligible: verified.backupEligible,
        backedUp: verified.backedUp,
        uvInitialized: verified.userVerified,
        createdDeviceId: session.deviceId,
        // From the flows' clock, like password_changed_at: the lockdown compares it with flow times.
        createdAt: now,
        name,
      },
      LIMITS,
    );
  } catch (err) {
    // A credential id korbat already holds, whoever's it is: the authenticator answered for a key that is not new.
    if (isUniqueViolation(err)) throw new AuthError("passkey_invalid", 401);
    throw err;
  }
  if (!outcome.ok) {
    if (outcome.reason === "gone") throw new AuthError("invalid_credentials", 401);
    throw limitReached(outcome);
  }
  const passkey = outcome.passkey;
  // After the commit, and best effort as every notice is: a failed mail never undoes a registration.
  const token = randomToken();
  const link: PasskeyRemoveToken = { userId: user.id, passkeyId: passkey.id, createdAt: passkey.createdAt.getTime(), sentTo: emailHash(deps.config.authHmacKey, user.email) };
  await deps.kv.set(passkeyRemoveKey(token), JSON.stringify(link), PASSKEY_REMOVE_TTL_MS);
  await notifyAccount(deps, user.email, "passkey_added", {
    name,
    deviceLabel: device?.label ?? "Unknown device",
    time: mailTime(now),
    removeUrl: `${deps.config.appOrigin}/passkey-remove/${token}`,
  });
  return { passkey: view(passkey, device?.label ?? null, session, now) };
}

/** The account's passkeys for the Security screen, newest first (1c design, section 7.5). */
export async function listPasskeys(deps: AuthDeps, session: Session): Promise<PasskeyListResponse> {
  const now = deps.now();
  const rows = await deps.repo.listPasskeys(session.userId);
  return { passkeys: rows.map((row) => view(row, row.createdOn, session, now)) };
}

/** Renames one passkey of the session's account; another account's and an unknown one are not told apart. Thirty an hour per account. */
export async function renamePasskey(deps: AuthDeps, session: Session, id: string, input: PasskeyRenameRequest): Promise<{ passkey: PasskeyView }> {
  await enforceLimit(deps.kv, `passkey-rename:${session.userId}`, RENAMES_PER_HOUR, HOUR);
  if (!(await deps.repo.renamePasskey(id, session.userId, input.name))) throw new AuthError("passkey_not_found", 404);
  const row = await deps.repo.findPasskey(id, session.userId);
  if (!row) throw new AuthError("passkey_not_found", 404);
  return { passkey: view(row, row.createdOn, session, deps.now()) };
}

/**
 * Removes one passkey of the session's account, the last one too (email stays the recovery root), records it and tells
 * the owner. Needs level 2 on an account with TOTP (the route checks as well). The sessions the passkey started keep
 * running: the owner removed a credential, nothing more.
 */
export async function removePasskey(deps: AuthDeps, session: Session, id: string): Promise<void> {
  requireFresh(deps, session);
  await enforceLimit(deps.kv, `passkey-remove:${session.userId}`, REMOVALS_PER_HOUR, HOUR);
  const removed = await deps.repo.deletePasskey(id, session.userId);
  if (!removed) throw new AuthError("passkey_not_found", 404);
  await deps.repo.appendEvent({ userId: session.userId, type: "passkey_removed", deviceId: session.deviceId, metadata: { passkeyId: id, via: "settings" } });
  const user = await deps.repo.findUserById(session.userId);
  if (user) await notifyAccount(deps, user.email, "passkey_removed", { name: removed.name, time: mailTime(deps.now()) });
}

/**
 * "This wasn't me" on a passkey of the last 7 days, the ones the Security list offers it on (1c design, section 7.5):
 * the lockdown anchored at the passkey's creation, naming it, recorded with this session's device. Level 1 is enough,
 * on an account with TOTP too: whoever re-enrolled it from a stolen session holds level 2, and the owner may not.
 * Five a day per account, counted only for a call that will run the lockdown: the bucket is the account's, so were a
 * miss to count, any session of the account, a stolen one too, could spend the owner's five with unknown ids and keep
 * its access. A call that does count signs its own session out with every other.
 */
export async function notMine(deps: AuthDeps, session: Session, id: string, ctx: RequestContext): Promise<void> {
  requireFresh(deps, session, 1);
  // The lookup is by the session's account, so a miss tells the caller nothing about anyone else's passkeys.
  const passkey = await deps.repo.findPasskey(id, session.userId);
  // An older passkey, another account's and an unknown one are not told apart.
  if (!passkey || !isNew(passkey.createdAt, deps.now())) throw new AuthError("passkey_not_found", 404);
  await enforceLimit(deps.kv, `passkey-not-mine:${session.userId}`, NOT_MINE_PER_DAY, DAY);
  await lockdown(deps, {
    userId: session.userId,
    anchor: passkey.createdAt,
    passkeyIds: [passkey.id],
    caller: { type: "passkey_removed", deviceId: session.deviceId, metadata: { passkeyId: passkey.id, via: "not_mine" } },
    ctx,
  });
}

/**
 * The remove link from the passkey_added notice, which needs no session: the link is the credential, and works once.
 * The lockdown runs anchored at the passkey's creation and names it, so the link works whether or not the passkey is
 * still there (1c design, section 7.6). It does nothing but refuse when the account is gone or its address is no longer
 * the one the notice went to: a link mailed to an attacker's address dies when the owner's is restored. A refusal does
 * not spend the link. The owner may open it while an attacker's address change stands, and once the email undo has
 * restored the address this link is the one whose lockdown reaches the day before the passkey, which the undo's may not.
 */
export async function removeByLink(deps: AuthDeps, input: PasskeyRemoveLinkRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `passkey-remove-link:ip:${ctx.ipHash}`, REMOVE_LINKS_PER_IP_PER_HOUR, HOUR);
  const key = passkeyRemoveKey(input.token);
  // Read first, so that a refusal leaves the link as it was.
  const raw = await deps.kv.get(key);
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const link = JSON.parse(raw) as PasskeyRemoveToken;
  const user = await deps.repo.findUserById(link.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  if (link.sentTo !== emailHash(deps.config.authHmacKey, user.email)) throw new AuthError("invalid_code", 400, LINK_GONE);
  // Taken only now, just before it acts: of two requests with the same link, one gets it and the other is refused.
  if (!(await deps.kv.take(key))) throw new AuthError("invalid_code", 400, LINK_GONE);
  await lockdown(deps, {
    userId: user.id,
    anchor: new Date(link.createdAt),
    passkeyIds: [link.passkeyId],
    caller: { type: "passkey_removed", metadata: { passkeyId: link.passkeyId, via: "link" } },
    ctx,
  });
}

/**
 * Records a verified passkey's use (1c design, sections 2, 7.2 and 7.4): the counter, the use time and the current backup
 * state in one conditional update. When it matches no row after a signature has checked, the counter did not move forward,
 * or a concurrent use took the same step: the passkey is marked suspect, the regression recorded, the owner told best
 * effort, and the attempt refused. A passkey already suspect is caught by the caller before this runs, so this only ever
 * suspends a fresh regression.
 */
async function recordPasskeyUse(deps: AuthDeps, passkey: Pick<PasskeyRow, "id" | "userId" | "name">, email: string, verified: VerifiedAuthentication, now: Date): Promise<void> {
  if (await deps.repo.claimPasskeyUse(passkey.id, verified.newCounter, verified.backedUp, now)) return;
  await deps.repo.suspectPasskey(passkey.id, now);
  await deps.repo.appendEvent({ userId: passkey.userId, type: "passkey_counter_regression", metadata: { passkeyId: passkey.id } });
  await notifyAccount(deps, email, "passkey_suspect", { name: passkey.name });
  throw new AuthError("passkey_invalid", 401);
}

/** The factor a verified assertion proves: two factors only when the authenticator verified the user and the passkey was registered with UV. */
function passkeyFactor(verified: VerifiedAuthentication, passkey: Pick<PasskeyRow, "uvInitialized">): FactorKind {
  return verified.userVerified && passkey.uvInitialized ? "passkey_uv" : "passkey";
}

/**
 * Options for a passkey sign-in (1c design, section 7.4): an empty allow list, so the options name no account and the
 * browser offers every passkey it holds for the relying party, and a sign-in challenge with no session binding. Handing
 * them out stores nothing beyond the per-IP counter, so it cannot fill the key-value store. Thirty per IP per 15 minutes.
 */
export async function signInOptions(deps: AuthDeps, ctx: RequestContext): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  await enforceLimit(deps.kv, `passkey-signin-options:ip:${ctx.ipHash}`, SIGNIN_OPTIONS_PER_IP, SIGNIN_WINDOW_MS);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "signin", deps.now());
  const options = await authenticationOptions({ rpId: deps.config.webauthn.rpId, allow: [], challenge });
  return { options };
}

/**
 * Verifies a passkey sign-in (1c design, section 7.4). The challenge is read from the response, checked with no session
 * binding and spent before anything else runs, so a forged, foreign or spent one never reaches the library. The passkey is
 * found by its credential id and its account read: an unknown credential, and a deleted or purged account, are alike
 * passkey_invalid, as is a response without a user handle, or with one that is not this account's: the options named no
 * account, so the response has to (WebAuthn L3, section 7.2, step 6). Only after the signature checks is
 * a suspect passkey passkey_suspended, and only then does the counter write run (a counter that did not move forward
 * suspends the passkey and refuses); the factor is passkey_uv only when the authenticator verified the user and the passkey
 * was registered with UV. A sign-in from a device the account has not used is counted, and only after a verified signature,
 * so nobody but the passkey's holder can spend the new-device allowance. Then, on an account with TOTP, a one-factor
 * passkey (and every staff sign-in) goes to the TOTP step with an MFA ticket; otherwise a session is issued directly, with
 * the new-device alert whose not-me link names the passkey. There is no account lockout.
 */
export async function signInVerify(deps: AuthDeps, input: PasskeySignInVerifyRequest, ctx: RequestContext): Promise<SignedIn | MfaPending> {
  await enforceLimit(deps.kv, `passkey-signin:ip:${ctx.ipHash}`, SIGNIN_VERIFY_PER_IP, SIGNIN_WINDOW_MS);
  const now = deps.now();
  const challenge = readResponseChallenge(input.response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "signin", now);
  await spendChallenge(deps.kv, challenge, now);

  const passkey = await deps.repo.findPasskeyByCredentialId(input.response.id);
  if (!passkey) throw new AuthError("passkey_invalid", 401);
  const user = await deps.repo.findUserById(passkey.userId);
  // A deleted or purged account's row is gone from findUserById: its passkey signs nobody in.
  if (!user) throw new AuthError("passkey_invalid", 401);
  // The allow list was empty, so nothing named an account before the ceremony: the response must carry the account's user
  // handle, which every passkey korbat registers returns (they are discoverable). Without one, or on an account that has
  // none, or with another's, the answer is the one every failure before the signature gets. The field stays optional in
  // the contract, which re-authentication shares: there the session names the account and the handle may be absent.
  const userHandle = input.response.response.userHandle;
  if (userHandle === undefined || user.webauthnUserId === null || !Buffer.from(userHandle, "base64url").equals(user.webauthnUserId)) {
    throw new AuthError("passkey_invalid", 401);
  }

  const verified = await verifyAuthentication({
    response: input.response,
    expectedChallenge: challenge,
    origins: deps.config.webauthn.origins,
    rpId: deps.config.webauthn.rpId,
    credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports },
  });
  // After the signature only: an unsigned response can never switch a passkey off or tell one from another.
  if (passkey.suspectAt !== null) throw new AuthError("passkey_suspended", 403);
  await recordPasskeyUse(deps, passkey, user.email, verified, now);

  const factor = passkeyFactor(verified, passkey);
  const device: DeviceInput = { deviceId: input.deviceId, platform: input.platform };
  if (!(await deps.repo.findDevice(user.id, deviceHash(deps.config.authHmacKey, device.deviceId)))) {
    await enforceLimit(deps.kv, `passkey-signin-new-device:hour:${user.id}`, SIGNIN_NEW_DEVICE_PER_HOUR, HOUR);
    await enforceLimit(deps.kv, `passkey-signin-new-device:day:${user.id}`, SIGNIN_NEW_DEVICE_PER_DAY, DAY);
  }

  const proof = { factors: { [factor]: now.getTime() }, method: "passkey" as const, passkeyId: passkey.id };
  // On an account with TOTP, a one-factor passkey still needs the second factor, and staff always do (1c design, section 2).
  if (user.totpEnabledAt && (factor === "passkey" || user.role !== "user")) {
    const mfaTicket = randomToken();
    const ticket: MfaTicket = { userId: user.id, deviceId: device.deviceId, platform: device.platform, ...proof };
    await deps.kv.set(mfaTicketKey(mfaTicket), JSON.stringify(ticket), MFA_TICKET_TTL_MS);
    return { kind: "mfa", mfaTicket };
  }
  return signIn(deps, user, device, ctx, { alertNewDevice: true, ...proof });
}

/**
 * Options for re-authenticating with a passkey (1c design, section 7.2): the account's passkeys that are not suspect in the
 * allow list, so the browser offers only ones that still work, and a re-authentication challenge bound to this session's
 * handle, which no other session of the account can answer.
 */
export async function reauthOptions(deps: AuthDeps, session: Session): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const held = await deps.repo.listPasskeys(session.userId);
  const allow = held.filter((p) => p.suspectAt === null).map((p) => ({ id: p.credentialId, transports: p.transports }));
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "reauth", deps.now(), session.handle);
  const options = await authenticationOptions({ rpId: deps.config.webauthn.rpId, allow, challenge });
  return { options };
}

/**
 * The passkey method of the re-authentication flow (1c design, section 7.2), run from flows/reauth.ts so the buckets,
 * reauth_at, the rotation and the answer stay that flow's. The challenge is read from the response, checked against this
 * session's handle and spent first; the passkey is looked up with the session's user, so another account's and an unknown
 * one are alike passkey_invalid and neither touches a passkey's counter; after the signature checks, a suspect passkey is
 * passkey_suspended, and the counter write applies. Answers the factor proven, passkey_uv or passkey.
 */
export async function reauthenticatePasskey(deps: AuthDeps, session: Session, user: UserRow, response: AuthenticationResponseJSON, now: Date): Promise<FactorKind> {
  const challenge = readResponseChallenge(response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "reauth", now, session.handle);
  await spendChallenge(deps.kv, challenge, now);
  const passkey = await deps.repo.findPasskeyByCredential(response.id, session.userId);
  if (!passkey) throw new AuthError("passkey_invalid", 401);
  const verified = await verifyAuthentication({
    response,
    expectedChallenge: challenge,
    origins: deps.config.webauthn.origins,
    rpId: deps.config.webauthn.rpId,
    credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports },
  });
  if (passkey.suspectAt !== null) throw new AuthError("passkey_suspended", 403);
  await recordPasskeyUse(deps, passkey, user.email, verified, now);
  return passkeyFactor(verified, passkey);
}
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { authEventType, authEvents, devices, emailCodePurpose, emailCodes, passkeys, sessions, userRole, users, type Db } from "@korbat/db";

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
export type PasskeyRow = typeof passkeys.$inferSelect;
/** A passkey with the label of the device that added it, null once that device is gone. */
export type PasskeyListRow = PasskeyRow & { createdOn: string | null };
/** What a registration stores of a verified passkey; the id, the last use and the suspicion are the row's own. */
export type NewPasskey = Omit<PasskeyRow, "id" | "lastUsedAt" | "suspectAt">;

/** The per-account bounds a registration checks in its transaction (1c design, section 2): at most `passkeys` at a time, and `additions` within `windowMs`. */
export interface PasskeyLimits {
  passkeys: number;
  additions: number;
  windowMs: number;
}

/** What addPasskey answers: the row it inserted; which bound refused it, with the seconds until the day has a slot again; or that the account is gone. */
export type AddPasskeyOutcome =
  | { ok: true; passkey: PasskeyRow }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "cap" }
  | { ok: false; reason: "daily"; retryAfterSeconds: number };

/** What the lockdown's transaction is told (1c design, sections 2 and 7.6); the flow works it out from the caller's anchor. */
export interface LockDownInput {
  /** The flows' clock, for the revocations and the password's change time. */
  now: Date;
  /** How far back the lockdown reaches: passkeys created at or after this go, and two-factor enabled at or after it is turned off. */
  since: Date;
  /** Passkeys to remove whatever their age: the one that signed in, or the one a link is about. */
  passkeyIds: readonly string[];
  /** The caller's event, recorded in the same transaction with what the lockdown did added to its metadata. */
  event: { type: AuthEventType; deviceId: string | null; ipHash: string | null; metadata: Record<string, unknown> };
}

/** What a lockdown did: the ids of the sessions it revoked, for the cache tombstones, the passkeys it removed, and whether it turned two-factor off. */
export interface LockDownOutcome {
  sessionIds: string[];
  passkeysRemoved: string[];
  totpCleared: boolean;
}

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
  /** The session's id for life, which a rotation keeps. */
  handle: string;
  /** The factors proven, kind to epoch milliseconds; empty for a session from before migration 0010. */
  factors: Record<string, number>;
  passkeyId: string | null;
}

export interface SessionListRow {
  /** The hash of the session's token, which its cached copy is keyed by; it changes when the token rotates and is never shown to a client. */
  id: string;
  /** The session's id for life: what the list shows, and what the targeted revoke takes. */
  handle: string;
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

    /**
     * Moves the account to an address its owner just proved with a code, so it is verified as of now.
     * When another row holds the address, in any case, the unique index on lower(email) raises the
     * driver's unique violation; the flow reports that as email_in_use.
     */
    async changeEmail(userId: string, email: string, now: Date): Promise<void> {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(eq(users.id, userId));
    },

    /**
     * The keyed hash of the phone number behind the verified badge, or null to drop it. When another row
     * holds the same hash, the partial unique index on phone_hash raises the driver's unique violation;
     * the flow reports that as phone_in_use.
     */
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      await db.update(users).set({ phoneHash }).where(eq(users.id, userId));
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

    // ------------------------------------------------------------ deletion

    /**
     * Marks the row deleted and nothing else: from now on every lookup above treats it as absent. Once only; a
     * later call changes nothing. A deletion goes through takeDown; this is the state a take-down that stopped
     * after the mark would leave, which finishTakeDown completes.
     */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /**
     * Step 1 of a deletion (1b design, section 7.6) in one transaction: the row is marked deleted, every live
     * session revoked, every device, code and passkey deleted, the WebAuthn user handle cleared, and the
     * account_deleted event appended. Either all of it lands or none of it does, so a failure leaves a live
     * account with its sessions, never a deleted one with sessions, devices and passkeys that nothing would
     * remove. Answers the ids of the sessions it revoked, for the cache tombstones, which are not the database's
     * to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const revoked = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        return revoked;
      });
    },

    /**
     * The rows of step 1 again (the sessions, devices, codes and passkeys, and the WebAuthn user handle), for a row
     * marked deleted and not purged yet: a take-down that stopped after the mark, or a session that a sign-in already
     * past its lookup created after it. Nothing for a live or a purged row. The event is not appended again: the
     * confirmation that recorded it is the only one there was.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
        return row ? takeDownRows(tx, userId, now) : [];
      });
    },

    /** Deleted accounts whose row the purge has not anonymised yet, oldest deletion first, at most 100 a round. */
    async pendingPurges(): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNotNull(users.deletedAt), isNull(users.purgedAt)))
        .orderBy(users.deletedAt, users.id)
        .limit(100);
      return rows.map((r) => r.id);
    },

    /**
     * The last step of a deletion: the address becomes deleted:<id> (unique, and never a real address),
     * every credential and personal fact is cleared, and purged_at says it is done. Only a deleted row
     * not purged yet is written, so a second call, or a call for a live account, changes nothing.
     */
    async finishPurge(userId: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({
          email: `deleted:${userId}`,
          emailVerifiedAt: null,
          passwordHash: null,
          totpSecretEnc: null,
          totpEnabledAt: null,
          recoveryCodesHash: [],
          phoneHash: null,
          ageConfirmedAt: null,
          termsVersion: null,
          termsAcceptedAt: null,
          purgedAt: now,
        })
        .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
    },

    // ------------------------------------------------------------ lockdown

    /**
     * The lockdown (1c design, sections 2 and 7.6) in one transaction, as takeDown is one: every live session
     * revoked, every device revoked (so the next sign-in on any of them counts as a new device), the password
     * cleared as setPasswordHash clears it, the passkeys in reach removed, two-factor turned off as disableTotp
     * does when it was enabled at or after `since`, and the caller's event appended with what was done. Either
     * all of it lands or none of it does: the link that started it is spent by then, so a lockdown that stopped
     * halfway could not be asked for again, and would be on no record. The user row is locked first, as takeDown
     * and a registration take it first, so none of the three can wait on another in a circle, and two-factor is
     * read from the locked row. Answers the ids of the sessions it revoked, for the cache tombstones, which are
     * not the database's to write.
     */
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      return db.transaction(async (tx) => {
        // An account that is gone has no two-factor to clear; its rows, if any are left, are still locked down below.
        const [locked] = await tx
          .select({ totpEnabledAt: users.totpEnabledAt })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for("update");
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: input.now })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        await tx.update(devices).set({ revokedAt: input.now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
        // The user's passkeys from `since` on, plus any of theirs the caller names; a named passkey of another account is not the caller's to remove and stays.
        const reach = input.passkeyIds.length > 0 ? or(gte(passkeys.createdAt, input.since), inArray(passkeys.id, [...input.passkeyIds])) : gte(passkeys.createdAt, input.since);
        const removed = await tx
          .delete(passkeys)
          .where(and(eq(passkeys.userId, userId), reach))
          .returning({ id: passkeys.id });
        const totpCleared = locked !== undefined && locked.totpEnabledAt !== null && locked.totpEnabledAt.getTime() >= input.since.getTime();
        await tx
          .update(users)
          .set({
            passwordHash: null,
            passwordChangedAt: input.now,
            failedLogins: 0,
            lockedUntil: null,
            ...(totpCleared ? { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] } : {}),
          })
          .where(eq(users.id, userId));
        const passkeysRemoved = removed.map((row) => row.id);
        await tx.insert(authEvents).values({
          userId,
          type: input.event.type,
          deviceId: input.event.deviceId,
          ipHash: input.event.ipHash,
          metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true },
        });
        return { sessionIds: revoked.map((row) => row.id), passkeysRemoved, totpCleared };
      });
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

    /** The device by its row id, revoked or not: a session's device, whose platform names a passkey and whose label the passkey notices carry. */
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
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

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
    },

    // ------------------------------------------------------------ sessions

    /**
     * A new session with the factors its sign-in proved (kind to epoch milliseconds from the flows' clock) and the passkey
     * that started it, if one did. The reauth time is the latest of the factors, which is what freshness is read from. A row
     * without factors, as migration 0010 left the sessions from before it, re-authenticates before its next sensitive action.
     */
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        factors,
        passkeyId: input.passkeyId ?? null,
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
          handle: sessions.handle,
          factors: sessions.factors,
          passkeyId: sessions.passkeyId,
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

    /**
     * Records a factor the session proved at `at`: the kind's time is set or replaced, and reauth_at, the latest of
     * them, follows the write. The flows always pass their clock's now.
     */
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      await db
        .update(sessions)
        .set({ factors: sql`${sessions.factors} || ${JSON.stringify({ [kind]: at.getTime() })}::jsonb`, reauthAt: at })
        .where(eq(sessions.id, id));
    },

    /**
     * Replaces the session's id, the token's hash, and nothing else, for a live session only: the handle, factors, reauth
     * time, passkey, device and expiries stay. False when the session is revoked or gone, so a rotation never revives one.
     * Nothing references sessions.id, so the primary key changes in place.
     */
    async rotateSession(id: string, newId: string): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ id: newId })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /**
     * Revokes one session of this user, named by its handle: the id a rotation keeps, so a session listed before its
     * token rotated is still found. Answers the row's id as it is now, which its cached copy is keyed by; undefined
     * when the session does not belong to the user or is already revoked.
     */
    async revokeSession(handle: string, userId: string, now: Date): Promise<string | undefined> {
      const [row] = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.handle, handle), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return row?.id;
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
          handle: sessions.handle,
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

    // ------------------------------------------------------------ passkeys

    /**
     * The account's WebAuthn user handle, set to `candidate` when there is none yet (1c design, section 6): a
     * compare-and-set in one statement, so two registrations at once end with the same handle, whichever wrote it.
     * Undefined for an account that is gone.
     */
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      const [row] = await db
        .update(users)
        .set({ webauthnUserId: sql`coalesce(${users.webauthnUserId}, ${candidate})` })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ webauthnUserId: users.webauthnUserId });
      return row?.webauthnUserId ?? undefined;
    },

    async countPasskeys(userId: string): Promise<number> {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, userId));
      return row?.count ?? 0;
    },

    /** The account's passkeys newest first, each with the label of the device that added it, for the Security list and the options' exclusions. */
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      return db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(eq(passkeys.userId, userId))
        .orderBy(desc(passkeys.createdAt), desc(passkeys.id));
    },

    /** One passkey of the account, with its device's label. Undefined when it is another account's or gone, which the flows do not tell apart. */
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const [row] = await db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * The passkey a sign-in's credential id names, whichever account it belongs to (1c design, section 7.4): the assertion
     * says nothing about the account, so the flow finds the owner from here. Undefined for an unknown credential; the flow
     * then reads the owner and refuses a deleted one, so a gone account never signs in.
     */
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
      return row;
    },

    /**
     * A passkey the session's account holds, by credential id (1c design, section 7.2): the re-authentication looks it up
     * with the session's user, so another account's passkey and an unknown one are alike undefined and never re-authenticate.
     */
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * Writes a verified passkey's use in one conditional update (1c design, section 2), in the pattern of claimTotpStep: the
     * new counter, the use time and the current backup state, only for a passkey that is not suspect and whose counter moved
     * forward (two zeros, as synced passkeys always send, pass repeatedly). False when it matched no row, which the flow
     * reads, after a verified signature, as a counter regression or a race lost to one.
     */
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, now: Date): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ counter: newCounter, lastUsedAt: now, backedUp })
        .where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt), sql`((${newCounter} = 0 and ${passkeys.counter} = 0) or ${newCounter} > ${passkeys.counter})`))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /** Marks a passkey suspect once (1c design, section 2), so a later sign-in with it is refused; a second call changes nothing. */
    async suspectPasskey(id: string, now: Date): Promise<void> {
      await db.update(passkeys).set({ suspectAt: now }).where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt)));
    },

    /** The daily bound's reading for the options step; the registration's transaction reads it again. */
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(db, userId, withinMs, limit);
    },

    /**
     * A registration's transaction (1c design, section 7.3): the user row locked `for update`, so two registrations of one
     * account run one after the other and the later one sees what the earlier committed; both bounds checked again there;
     * then the passkey and its passkey_added event, or neither. A credential id already held raises the driver's unique
     * violation, which the flow reports as passkey_invalid.
     */
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      return db.transaction(async (tx): Promise<AddPasskeyOutcome> => {
        const [locked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
          .for("update");
        if (!locked) return { ok: false, reason: "gone" };
        const [held] = await tx.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, input.userId));
        if ((held?.count ?? 0) >= limits.passkeys) return { ok: false, reason: "cap" };
        const additions = await recentPasskeyAdditions(tx, input.userId, limits.windowMs, limits.additions);
        if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
        const [passkey] = await tx.insert(passkeys).values(input).returning();
        await tx.insert(authEvents).values({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey!.id } });
        return { ok: true, passkey: passkey! };
      });
    },

    /** Renames one passkey of the account. False when it is another account's or gone. */
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /**
     * Removes one passkey of the account and answers its name, for the notice; undefined when it is another account's or
     * gone. The sessions it started keep running without it: the foreign key sets their passkey_id to null.
     */
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const [row] = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ name: passkeys.name });
      return row;
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

    /** The user's own events since `since`, newest first, for the data export: their kind and time, never the metadata. */
    async eventsSince(userId: string, since: Date): Promise<{ type: AuthEventType; createdAt: Date }[]> {
      return db
        .select({ type: authEvents.type, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), gte(authEvents.createdAt, since)))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a read runs through: the pool, or a transaction that needs the read to see its own lock. */
type Querier = Pick<Db, "select">;

/**
 * The daily bound's reading (1c design, section 2): how many passkey_added events the account has within the window, at
 * most `limit` of them, and the seconds until the oldest of those is out of the window, when the day has a slot again.
 * Counted from the events, so a removal frees nothing, and by the database clock, which wrote them.
 */
async function recentPasskeyAdditions(q: Querier, userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
  const window = sql`make_interval(secs => ${withinMs / 1000}::float8)`;
  const recent = q
    .select({ createdAt: authEvents.createdAt })
    .from(authEvents)
    .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "passkey_added"), gt(authEvents.createdAt, sql`now() - ${window}`)))
    .orderBy(desc(authEvents.createdAt))
    .limit(limit)
    .as("recent");
  const [row] = await q
    .select({
      count: sql<number>`count(*)::int`,
      retryAfterSeconds: sql<number>`coalesce(ceil(extract(epoch from (min(${recent.createdAt}) + ${window} - now())))::int, 0)`,
    })
    .from(recent);
  return { count: row?.count ?? 0, retryAfterSeconds: row?.retryAfterSeconds ?? 0 };
}

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, every code out for the user goes, whatever its purpose, so none can complete a flow for an account
 * that is gone, and every passkey goes with the WebAuthn user handle (1c design, section 7.7), so a deleted
 * account keeps no credential of any kind and no assertion can name it again. Run again by finishTakeDown,
 * each statement finds nothing more to do.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<string[]> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  await tx.delete(passkeys).where(eq(passkeys.userId, userId));
  // The handle only ever named the account to its passkeys; cleared here rather than by finishPurge, so the take-down leaves nothing of the ceremony behind.
  await tx.update(users).set({ webauthnUserId: null }).where(eq(users.id, userId));
  return revoked.map((row) => row.id);
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

### Replace `apps/api/src/auth/routes.ts` (whole file)

```ts
import {
  BadgeStartRequest,
  BadgeVerifyRequest,
  EmailChangeStartRequest,
  EmailChangeVerifyRequest,
  EmailRevertRequest,
  EmailStartRequest,
  EmailVerifyRequest,
  MfaVerifyRequest,
  NotMeRequest,
  OnboardingHandleRequest,
  PasskeyRegisterOptionsRequest,
  PasskeyRegisterVerifyRequest,
  PasskeyRemoveLinkRequest,
  PasskeyRenameRequest,
  PasskeySignInVerifyRequest,
  PasswordSetRequest,
  PasswordSigninRequest,
  ReauthRequest,
  SignupCompleteRequest,
  TotpCodeRequest,
  TotpDisableRequest,
  type Platform,
} from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { AuthError, type AuthDeps, type RequestContext } from "./context";
import { clearSessionCookies, setSessionCookies } from "./cookies";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "./flows/account";
import { removeBadge, startBadge, verifyBadge } from "./flows/badge";
import { startEmail, verifyEmail } from "./flows/email";
import { revertEmailChange, startEmailChange, verifyEmailChange } from "./flows/email-change";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "./flows/mfa";
import { notMe } from "./flows/not-me";
import { passwordSignIn, setPassword } from "./flows/password";
import { reauthenticate, startReauthEmail } from "./flows/reauth";
import type { MfaPending, SignedIn } from "./flows/signin";
import { chooseHandle, completeSignup } from "./flows/signup";
import { requireFreshAuth, requireOnboarding, requireSession, requireStrongFreshAuth } from "./middleware";
import { listPasskeys, notMine, reauthOptions, registerOptions, registerVerify, removeByLink, removePasskey, renamePasskey, signInOptions, signInVerify } from "./passkeys/flows";
import type { IssuedSession, Session } from "./sessions";

/** Every `/api/auth/*` endpoint. Handlers only validate, call a flow and shape the response. */
export function authRoutes(deps: AuthDeps) {
  const r = new Hono<AppEnv>();
  const fresh = requireFreshAuth(deps);
  // Level 2 on an account with TOTP (1c design, section 10): the routes that replace or remove a credential.
  const strong = requireStrongFreshAuth(deps);

  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
  });
  const currentSession = (c: Context<AppEnv>): Session => c.get("session")!;

  /**
   * Browsers send Origin on state changes and the fetch metadata headers Sec-Fetch-Site and Sec-Fetch-Dest
   * on every request; native apps send none of them, and Node's own fetch sends a bare Sec-Fetch-Mode that
   * cannot be removed, which therefore does not count. A request from a browser is a web session whatever
   * the body says, so it gets cookies, never a token.
   */
  const fromBrowser = (c: Context<AppEnv>): boolean =>
    c.req.header("origin") !== undefined || c.req.header("sec-fetch-site") !== undefined || c.req.header("sec-fetch-dest") !== undefined;
  const asWeb = <T extends { platform: Platform }>(c: Context<AppEnv>, input: T): T => (fromBrowser(c) ? { ...input, platform: "web" } : input);

  /** Web: cookies only, never the token in the body. Native: the bearer token in the body, no cookies. */
  const sessionIssued = (c: Context<AppEnv>, signed: SignedIn) => {
    if (signed.platform === "web") {
      setSessionCookies(c, signed.issued.token, signed.issued.maxAgeSeconds);
      return c.json({ result: "session" as const, mustReenrollMfa: signed.mustReenrollMfa });
    }
    return c.json({ result: "session" as const, mustReenrollMfa: signed.mustReenrollMfa, token: signed.issued.token });
  };

  const firstFactor = (c: Context<AppEnv>, outcome: SignedIn | MfaPending) =>
    outcome.kind === "mfa" ? c.json({ result: "mfa_required" as const, mfaTicket: outcome.mfaTicket }) : sessionIssued(c, outcome);

  /** After a flow rotated the current session: fresh cookies for web, the new token for native. */
  const rotated = (c: Context<AppEnv>, issued: IssuedSession): { token?: string } => {
    if (c.get("authVia") === "cookie") {
      setSessionCookies(c, issued.token, issued.maxAgeSeconds);
      return {};
    }
    return { token: issued.token };
  };

  r.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    c.get("log").error({ err }, "unhandled error in auth route");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  r.post("/email/start", validate("json", EmailStartRequest), async (c) => c.json(await startEmail(deps, asWeb(c, c.req.valid("json")), requestContext(c))));

  r.post("/email/verify", validate("json", EmailVerifyRequest), async (c) => {
    const outcome = await verifyEmail(deps, c.req.valid("json"), requestContext(c));
    if (outcome.kind === "signup_required") return c.json({ result: "signup_required" as const });
    return firstFactor(c, outcome);
  });

  r.post("/signup/complete", validate("json", SignupCompleteRequest), async (c) =>
    sessionIssued(c, await completeSignup(deps, c.req.valid("json"), requestContext(c))),
  );

  r.post("/onboarding/handle", requireOnboarding, validate("json", OnboardingHandleRequest), async (c) => {
    const { profile, issued } = await chooseHandle(deps, currentSession(c), c.req.valid("json"));
    return c.json({ profile, ...rotated(c, issued) });
  });

  r.post("/email/change/start", requireSession, strong, validate("json", EmailChangeStartRequest), async (c) =>
    c.json(await startEmailChange(deps, currentSession(c), c.req.valid("json"), requestContext(c))),
  );

  r.post("/email/change/verify", requireSession, fresh, validate("json", EmailChangeVerifyRequest), async (c) =>
    c.json(await verifyEmailChange(deps, currentSession(c), c.req.valid("json"))),
  );

  // The undo link from the email_changed notice: no session, like the not-me link, since the link itself is the credential.
  r.post("/email/revert", validate("json", EmailRevertRequest), async (c) => {
    await revertEmailChange(deps, c.req.valid("json"), requestContext(c));
    return c.body(null, 204);
  });

  r.post("/badge/start", requireSession, fresh, validate("json", BadgeStartRequest), async (c) =>
    c.json(await startBadge(deps, currentSession(c), c.req.valid("json"), requestContext(c))),
  );

  r.post("/badge/verify", requireSession, fresh, validate("json", BadgeVerifyRequest), async (c) =>
    c.json(await verifyBadge(deps, currentSession(c), c.req.valid("json"))),
  );

  r.delete("/badge", requireSession, fresh, async (c) => {
    await removeBadge(deps, currentSession(c));
    return c.body(null, 204);
  });

  r.post("/password/signin", validate("json", PasswordSigninRequest), async (c) =>
    firstFactor(c, await passwordSignIn(deps, asWeb(c, c.req.valid("json")), requestContext(c))),
  );

  // Passkey sign-in (1c design, section 7.4), unauthenticated like /password/signin: the options carry an empty allow list,
  // and verify handles web and native exactly as /password/signin does (asWeb, then a session or the TOTP step).
  r.post("/passkey/signin/options", async (c) => c.json(await signInOptions(deps, requestContext(c))));

  r.post("/passkey/signin/verify", validate("json", PasskeySignInVerifyRequest), async (c) =>
    firstFactor(c, await signInVerify(deps, asWeb(c, c.req.valid("json")), requestContext(c))),
  );

  r.post("/password/set", requireSession, strong, validate("json", PasswordSetRequest), async (c) =>
    c.json(rotated(c, await setPassword(deps, currentSession(c), c.req.valid("json")))),
  );

  r.post("/mfa/verify", validate("json", MfaVerifyRequest), async (c) => sessionIssued(c, await verifyMfa(deps, c.req.valid("json"), requestContext(c))));

  r.post("/mfa/totp/setup", requireSession, strong, async (c) => c.json(await setupTotp(deps, currentSession(c))));

  // No freshness check: the pending secret its setup stored for the session is the proof, so scanning the QR code cannot run the window out.
  r.post("/mfa/totp/confirm", requireSession, validate("json", TotpCodeRequest), async (c) => {
    const { recoveryCodes, issued } = await confirmTotp(deps, currentSession(c), c.req.valid("json"));
    return c.json({ recoveryCodes, ...rotated(c, issued) });
  });

  r.post("/mfa/totp/disable", requireSession, strong, validate("json", TotpDisableRequest), async (c) => {
    await disableTotp(deps, currentSession(c));
    return c.body(null, 204);
  });

  r.post("/mfa/recovery-codes/regenerate", requireSession, strong, async (c) => c.json({ recoveryCodes: await regenerateRecoveryCodes(deps, currentSession(c)) }));

  r.post("/reauth/email/start", requireOnboarding, async (c) => c.json(await startReauthEmail(deps, currentSession(c), requestContext(c))));

  // The level reached and, after a recovery code, the call to set MFA up again; the rotated token as every rotation hands it out.
  r.post("/reauth", requireOnboarding, validate("json", ReauthRequest), async (c) => {
    const { level, issued, mustReenrollMfa } = await reauthenticate(deps, currentSession(c), c.req.valid("json"), requestContext(c));
    return c.json({ level, ...(mustReenrollMfa ? { mustReenrollMfa } : {}), ...rotated(c, issued) });
  });

  // Options for a passkey re-authentication (1c design, section 7.2): the account's usable passkeys and a challenge bound to this session.
  r.post("/reauth/passkey/options", requireOnboarding, async (c) => c.json(await reauthOptions(deps, currentSession(c))));

  r.get("/sessions", requireSession, async (c) => c.json(await listSessions(deps, currentSession(c))));

  // The id is the session's handle, as the list gives it: it stays while the session's token rotates.
  r.delete("/sessions/:id", requireSession, fresh, validate("param", z.object({ id: z.uuid() })), async (c) => {
    const revoked = await revokeSession(deps, currentSession(c), c.req.valid("param").id);
    return revoked ? c.body(null, 204) : c.json(errorBody("not_found", "No such session", c.get("requestId")), 404);
  });

  r.post("/sessions/revoke-all", requireSession, fresh, async (c) => {
    await revokeAllSessions(deps, currentSession(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/signout", requireOnboarding, async (c) => {
    await signOut(deps, currentSession(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/not-me", validate("json", NotMeRequest), async (c) => {
    await notMe(deps, c.req.valid("json"), requestContext(c));
    return c.body(null, 204);
  });

  // Passkeys (1c design, sections 7.3 and 7.5). Registration takes any signed-in session, one still choosing a handle too:
  // the options need level 2 on an account with TOTP, the verification only the challenge those options carried, which
  // is bound to the session (a ceremony that outlasts the window still completes).
  r.post("/passkeys/register/options", requireOnboarding, strong, validate("json", PasskeyRegisterOptionsRequest), async (c) =>
    c.json(await registerOptions(deps, currentSession(c), c.req.valid("json"))),
  );

  r.post("/passkeys/register/verify", requireOnboarding, validate("json", PasskeyRegisterVerifyRequest), async (c) =>
    c.json(await registerVerify(deps, currentSession(c), c.req.valid("json"))),
  );

  r.get("/passkeys", requireSession, async (c) => c.json(await listPasskeys(deps, currentSession(c))));

  r.patch("/passkeys/:id", requireSession, validate("param", z.object({ id: z.uuid() })), validate("json", PasskeyRenameRequest), async (c) =>
    c.json(await renamePasskey(deps, currentSession(c), c.req.valid("param").id, c.req.valid("json"))),
  );

  r.delete("/passkeys/:id", requireSession, strong, validate("param", z.object({ id: z.uuid() })), async (c) => {
    await removePasskey(deps, currentSession(c), c.req.valid("param").id);
    return c.body(null, 204);
  });

  // "This wasn't me" on a new passkey: the lockdown signs this session out with every other, so a web session loses its cookies here.
  r.post("/passkeys/:id/not-mine", requireSession, fresh, validate("param", z.object({ id: z.uuid() })), async (c) => {
    await notMine(deps, currentSession(c), c.req.valid("param").id, requestContext(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  // The remove link from the passkey_added notice: no session, like the not-me link, since the link itself is the credential.
  r.post("/passkeys/remove-link", validate("json", PasskeyRemoveLinkRequest), async (c) => {
    await removeByLink(deps, c.req.valid("json"), requestContext(c));
    return c.body(null, 204);
  });

  return r;
}

/** GET /api/me, mounted by the app behind requireOnboarding. */
export function meHandler(deps: AuthDeps) {
  return async (c: Context<AppEnv>) => c.json(await me(deps, c.get("session")!));
}
```

### Replace `apps/api/src/auth/sessions.ts` (whole file)

```ts
import type { Platform, Role, SessionInfo } from "@korbat/contracts";
import { AuthError } from "./context";
import { newSessionToken, sha256Hex } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { ActiveSessionRow, AuthRepo } from "./repo";

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 365 * 24 * 60 * 60 * 1000;
export const SESSION_SLIDE_INTERVAL_MS = 60 * 60 * 1000;
export const SESSION_CACHE_TTL_MS = 60 * 1000;
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

/**
 * What a session can have proven (1c design, section 2): a first factor at sign-in (an email code, a password, a passkey,
 * or a passkey whose authenticator verified the user), and the second factors the MFA step or a re-authentication adds.
 */
export type FactorKind = "email" | "password" | "passkey" | "passkey_uv" | "totp" | "recovery";
/** The factors a session has proven, kind to epoch milliseconds from the flows' clock. */
export type Factors = Partial<Record<FactorKind, number>>;

/** Every kind in one fixed order, so the factors a refusal lists do not depend on how the row stored them. */
const KINDS: readonly FactorKind[] = ["email", "password", "passkey", "passkey_uv", "totp", "recovery"];
/** A first factor on its own is level 1. */
const FIRST: readonly FactorKind[] = ["email", "password", "passkey"];
/** A second factor makes level 2 only beside a first one; a user-verified passkey is both at once. */
const SECOND: readonly FactorKind[] = ["totp", "recovery"];

export interface Session {
  /** sha256 of the token; never the token itself. A rotation changes it; `handle` stays. */
  sessionId: string;
  userId: string;
  deviceId: string;
  role: Role;
  onboarded: boolean;
  mfaEnabled: boolean;
  /** The latest of `factors`, as the row keeps it; freshness is read from the factors themselves. */
  reauthAt: Date;
  /** A random id for the session's whole life: the re-authentication limits and the passkey challenges are keyed by it. */
  handle: string;
  factors: Factors;
  /** The passkey that started the session, for the lockdown and the Security list; null after any other sign-in. */
  passkeyId: string | null;
}

/** What a sign-in proved, for the session it issues: its factors and, for a passkey sign-in, the passkey. */
export interface SessionProof {
  factors: Factors;
  passkeyId?: string | null;
}

/**
 * What a reauth_required refusal tells the app: the level the action needs and the factor kinds proven within the
 * window. A type alias, not an interface, so it passes as an AuthError's details as it is.
 */
export type ReauthNeeded = {
  level: 1 | 2;
  have: FactorKind[];
};

export interface IssuedSession {
  token: string;
  session: Session;
  /** Cookie Max-Age matching the idle expiry. */
  maxAgeSeconds: number;
}

interface CachedSession {
  session: Omit<Session, "reauthAt"> & { reauthAt: string };
  absoluteExpiresAt: string;
}

/**
 * The version of the cached copy's shape, part of every cache key. The key-value store keeps running across a deploy, so
 * for a minute the new release would read copies the previous one wrote: raise this whenever CachedSession changes, and
 * those copies are never read and run out on their own. 2 is the shape with the handle, the factors and the passkey
 * (1c); before it the key was `sess:<id>`. Tombstones move with the entries: a revoked session is revoked in the
 * database first, so one the previous release wrote is not needed to keep it out.
 */
const CACHE_VERSION = 2;

export function createSessions(deps: { repo: AuthRepo; kv: KeyValueStore; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const cacheKey = (sessionId: string) => `sess:${CACHE_VERSION}:${sessionId}`;
  const REVOKED = "revoked";

  const fromRow = (row: ActiveSessionRow): Session => ({
    sessionId: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    role: row.role,
    onboarded: row.onboardedAt !== null,
    mfaEnabled: row.totpEnabledAt !== null,
    reauthAt: row.reauthAt,
    handle: row.handle,
    factors: row.factors as Factors,
    passkeyId: row.passkeyId,
  });

  async function forget(sessionIds: readonly string[]) {
    await Promise.all(sessionIds.map((id) => deps.kv.del(cacheKey(id))));
  }

  /**
   * A tombstone that outlives any cache fill in flight, so a revoked session cannot come back for the cache TTL.
   * Also for sessions revoked in the database by another statement, such as a deletion's take-down.
   */
  async function tombstone(sessionIds: readonly string[]) {
    await Promise.all(sessionIds.map((id) => deps.kv.set(cacheKey(id), REVOKED, SESSION_CACHE_TTL_MS)));
  }

  /** Drops the cached copy of every live session of the user, after a change to what a session carries. */
  async function forgetUser(userId: string) {
    const rows = await deps.repo.listActiveSessions(userId, now());
    await forget(rows.map((r) => r.id));
  }

  /** A new session holding what its sign-in proved; its reauth time is the latest of those factors. */
  async function issue(userId: string, deviceId: string, proof: SessionProof): Promise<IssuedSession> {
    const t = now();
    const { token, id } = newSessionToken();
    await deps.repo.createSession({
      id,
      userId,
      deviceId,
      now: t,
      expiresAt: new Date(t.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t.getTime() + SESSION_ABSOLUTE_MS),
      factors: proof.factors,
      passkeyId: proof.passkeyId ?? null,
    });
    const row = await deps.repo.findActiveSession(id, t);
    if (!row) throw new Error("session not found immediately after it was created");
    return { token, session: fromRow(row), maxAgeSeconds: Math.floor(SESSION_IDLE_MS / 1000) };
  }

  /**
   * Resolves a token to a live session. Results are cached for 60 seconds; revocation writes a
   * tombstone over the entry and a fill never overwrites one, so it takes effect at once. `slid` is
   * true when the idle expiry was just extended
   * (callers refresh the cookie then).
   */
  async function resolve(token: string): Promise<{ session: Session; slid: boolean } | null> {
    const id = sha256Hex(token);
    const t = now();
    const cached = await deps.kv.get(cacheKey(id));
    if (cached === REVOKED) return null;
    if (cached) {
      const c = JSON.parse(cached) as CachedSession;
      if (new Date(c.absoluteExpiresAt).getTime() > t.getTime()) {
        return { session: { ...c.session, reauthAt: new Date(c.session.reauthAt) }, slid: false };
      }
    }
    const row = await deps.repo.findActiveSession(id, t);
    if (!row) return null;
    let slid = false;
    if (t.getTime() - row.lastUsedAt.getTime() >= SESSION_SLIDE_INTERVAL_MS) {
      const expiresAt = new Date(Math.min(t.getTime() + SESSION_IDLE_MS, row.absoluteExpiresAt.getTime()));
      await deps.repo.slideSession(id, expiresAt, t);
      slid = true;
    }
    const session = fromRow(row);
    const entry: CachedSession = {
      session: { ...session, reauthAt: session.reauthAt.toISOString() },
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    };
    await deps.kv.setIfAbsent(cacheKey(id), JSON.stringify(entry), SESSION_CACHE_TTL_MS);
    return { session, slid };
  }

  /**
   * Revokes one session of the user by its handle, the id the list shows: the token's hash changes with every rotation,
   * so a session that re-authenticated since it was listed could not be found by it. The tombstone goes under the id
   * the row has now, where its cached copy lies. False when no such live session belongs to the user.
   */
  async function revoke(handle: string, userId: string): Promise<boolean> {
    const id = await deps.repo.revokeSession(handle, userId, now());
    if (id === undefined) return false;
    await tombstone([id]);
    return true;
  }

  async function revokeAll(userId: string): Promise<number> {
    const ids = await deps.repo.revokeAllSessions(userId, now());
    await tombstone(ids);
    return ids.length;
  }

  /**
   * Replaces the token in place (1c design, section 2): only the row's id, the token's hash, changes; its handle,
   * factors, reauth time, passkey, device and expiries stay. The old token stops working at once, so a re-authentication
   * by the owner ends a thief's copy. A session revoked meanwhile gets no replacement.
   */
  async function rotate(current: Session): Promise<IssuedSession> {
    const { token, id } = newSessionToken();
    if (!(await deps.repo.rotateSession(current.sessionId, id))) throw new AuthError("invalid_credentials", 401);
    // The old id may sit in the cache for up to a minute; the tombstone ends the old token now.
    await tombstone([current.sessionId]);
    const row = await deps.repo.findActiveSession(id, now());
    if (!row) throw new AuthError("invalid_credentials", 401);
    return { token, session: fromRow(row), maxAgeSeconds: Math.floor(SESSION_IDLE_MS / 1000) };
  }

  /** Records a factor the session just proved, at the flows' clock; the reauth time follows it and the cached copy goes. */
  async function addFactor(sessionId: string, kind: FactorKind): Promise<void> {
    await deps.repo.writeFactor(sessionId, kind, now());
    await forget([sessionId]);
  }

  /** The kinds proven within the window (five minutes by default), in a fixed order; freshness and the level are read from them. */
  function recentFactors(session: Session, windowMs: number = REAUTH_WINDOW_MS): FactorKind[] {
    const t = now().getTime();
    return KINDS.filter((kind) => {
      const at = session.factors[kind];
      return at !== undefined && t - at <= windowMs;
    });
  }

  function isFresh(session: Session, windowMs: number = REAUTH_WINDOW_MS): boolean {
    return recentFactors(session, windowMs).length > 0;
  }

  /** Level 2 when a user-verified passkey, or a second factor beside a first, was proven within the window; level 1 otherwise. */
  function level(session: Session, windowMs: number = REAUTH_WINDOW_MS): 1 | 2 {
    const have = recentFactors(session, windowMs);
    const strong = have.includes("passkey_uv") || (have.some((kind) => SECOND.includes(kind)) && have.some((kind) => FIRST.includes(kind)));
    return strong ? 2 : 1;
  }

  /** The level a sensitive action needs on this account: 2 once it has TOTP, 1 otherwise (1c design, section 2). */
  function requiredLevel(session: Session): 1 | 2 {
    return session.mfaEnabled ? 2 : 1;
  }

  /** Null when the session proved enough within the window; otherwise what the refusal tells the app. */
  function reauthNeeded(session: Session, need: 1 | 2, windowMs: number = REAUTH_WINDOW_MS): ReauthNeeded | null {
    const have = recentFactors(session, windowMs);
    const met = need === 1 ? have.length > 0 : level(session, windowMs) === 2;
    return met ? null : { level: need, have };
  }

  /** The user's live sessions, each under its handle, which stays while its token rotates; `currentHandle` marks the asking one. */
  async function list(userId: string, currentHandle: string): Promise<SessionInfo[]> {
    const rows = await deps.repo.listActiveSessions(userId, now());
    return rows.map((r) => ({
      id: r.handle,
      deviceLabel: r.deviceLabel ?? "Unknown device",
      platform: r.platform as Platform,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      current: r.handle === currentHandle,
    }));
  }

  return { issue, resolve, revoke, revokeAll, rotate, addFactor, forgetUser, recentFactors, isFresh, level, requiredLevel, reauthNeeded, list, tombstone };
}

export type Sessions = ReturnType<typeof createSessions>;
```

### Replace `apps/app/src/app/email-revert/[token].tsx` (whole file)

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, ErrorText, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Opened from the link in the "email address changed" notice, which goes to the address the account
 * had. The link is the only credential needed, because an account without a password can no longer
 * sign in at that address. Nothing happens until the person confirms.
 */
export default function EmailRevert() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/email/revert", { json: { token } });
      setDone(true);
      // This browser's own session, if it had one, was signed out with the others.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Your account is back at this address</Title>
        <Body>
          Every session is signed out, including any in this browser. Sign in again with a code sent to this address. Your password was removed, and so were any passkeys and
          two-factor authentication set up since the day before the change; set them up again from Security.
        </Body>
        <Button label="Sign in" onPress={() => router.replace("/signin")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Undo the email change</Title>
      <Body>
        If you did not move your korbat account to a new email address, confirm below. We will move it back to the address this link was sent to, sign out every session,
        including this browser, remove your password, and remove any passkeys and two-factor authentication set up since the day before the change.
      </Body>
      <ErrorText message={valid ? error : "This link is incomplete. Open it again from the email."} />
      <Button label="Move my account back to this address" onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label="It was me, go back" href="/" replace />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/not-me/[token].tsx` (whole file)

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, ErrorText, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Opened from the new-device email. Nothing happens until the person confirms. */
export default function NotMe() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/not-me", { json: { token } });
      setDone(true);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Your account is locked down</Title>
        <Body>
          Every session is signed out, your password is removed, and any passkeys and two-factor authentication set up since the day before that sign-in are removed. Sign in again
          with a code sent to your email, then set a new password and turn on two-factor authentication.
        </Body>
        <Button label="Sign in" onPress={() => router.replace("/signin")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>This wasn't me</Title>
      <Body>
        If you didn't just sign in to korbat on a new device, confirm below. We'll sign out every session, including this browser, remove your password, and remove any passkeys
        and two-factor authentication set up since the day before that sign-in, so only someone with your email can get back in.
      </Body>
      <ErrorText message={valid ? error : "This link is incomplete. Open it again from the email."} />
      <Button label="Sign out everywhere and lock down my account" onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label="It was me, go back" href="/" replace />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/passkey-remove/[token].tsx` (whole file)

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, ErrorText, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Opened from the link in the "passkey added" notice (1c design, section 7.6). The link is the only credential
 * needed; it works for 7 days, and still once the passkey is gone. Nothing happens until the person confirms.
 */
export default function PasskeyRemove() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/passkeys/remove-link", { json: { token } });
      setDone(true);
      // This browser's own session, if it had one, was signed out with the others.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Your account is locked down</Title>
        <Body>
          The passkey is removed. Every session is signed out, your password is removed, and any passkeys and two-factor authentication set up since the day before it was added
          are removed. Sign in again with a code sent to your email, then set a new password and turn on two-factor authentication.
        </Body>
        <Button label="Sign in" onPress={() => router.replace("/signin")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Remove this passkey</Title>
      <Body>
        If you did not add this passkey to your korbat account, confirm below. We'll remove it, sign out every session, including this browser, remove your password, and
        remove any passkeys and two-factor authentication set up since the day before it was added, so only someone with your email can get back in.
      </Body>
      <ErrorText message={valid ? error : "This link is incomplete. Open it again from the email."} />
      <Button label="Remove the passkey and lock down my account" onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label="It was me, go back" href="/" replace />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/settings/account.tsx` (whole file)

```tsx
import { useEffect, useRef, useState, type RefObject } from "react";
import { Platform, ScrollView, Text, View, type TextInput } from "react-native";
import { router } from "expo-router";
import { BadgeVerifyResponse, DeleteStartResponse, EmailChangeResponse, FlowResponse, type MeResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ReauthPanel, ReenrollNotice, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { api, ApiError, apiResponse, errorMessage } from "@/lib/api";
import { exportFilename, saveBlob } from "@/lib/download";
import { useSession } from "@/lib/session";

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/**
 * Expo inlines this public value into the web bundle at export time (WEB_BADGE in infra/.env). The
 * badge routes answer badge_unavailable when the API's verification provider is off, and there is no
 * harmless read to probe that with, so the section is shown only by a build that says "on"; the API's
 * provider is off by default, and so is this.
 */
const BADGE_SHOWN = process.env.EXPO_PUBLIC_BADGE === "on";

const CODE = /^\d{6}$/;

/** One request at a time for a section, through the re-authentication hook, with its busy, error and done texts. */
function useAction(run: Run, describe: (err: unknown) => string = errorMessage) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Enter in a field calls the action as the button does, so the button's busy rule is here too: a second Enter while a request is out sends nothing.
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(action);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, done, setDone, act };
}

/**
 * Moves the focus to `target` when `away` turns false after being true: the section went back to the
 * step `target` is in, and the control that had the focus (Start over, Cancel, Change, Verify, Remove
 * badge) left the tree with the step it was in, which would drop the focus to the page body.
 */
function useFocusOnReturn(away: boolean, target: RefObject<{ focus(): void } | null>) {
  const wasAway = useRef(away);
  useEffect(() => {
    if (!away && wasAway.current) target.current?.focus();
    wasAway.current = away;
  }, [away, target]);
}

/** A new address gets a code; the account moves to it once the code is entered, and every session stays signed in. */
function EmailSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, setError, done, setDone, act } = useAction(run);
  const emailRef = useRef<TextInput>(null);
  // The code field takes the focus itself (autoFocus); Change and Start over bring the address field back, which takes it here.
  useFocusOnReturn(flowId !== null, emailRef);
  // The API would answer a generic invalid_request for the account's own address; it is refused here in its own words instead.
  const current = email.trim().toLowerCase() === me.user.email.toLowerCase();

  // Enter in the field calls this as the button does, so the button's conditions come first.
  async function start() {
    if (email.trim().length === 0) return;
    if (current) {
      setDone(null);
      setError("That is already your email address.");
      return;
    }
    await act(async () => {
      const flow = await api("/api/auth/email/change/start", { json: { email: email.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });
  }

  async function verify() {
    if (!CODE.test(code.trim())) return;
    await act(async () => {
      const changed = await api("/api/auth/email/change/verify", { json: { flowId, code: code.trim() }, schema: EmailChangeResponse });
      setFlowId(null);
      setEmail("");
      setCode("");
      setDone(`Your email address is now ${changed.email}.`);
      // The address shown here and on the security screen reads the session.
      await refresh();
    });
  }

  return (
    <View>
      <Body>Your address is {me.user.email}. Sign-in codes and security messages go there, and nobody else sees it.</Body>
      {flowId ? (
        <>
          <Body>We sent a code to {email.trim()}. Enter it to move your account to that address. Every session stays signed in.</Body>
          <Field label="Code from the email" autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Change" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field ref={emailRef} label="New email address" autoComplete="email" autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={() => void start()} />
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={email.trim().length === 0 || current} />
        </>
      )}
    </View>
  );
}

/** The API reuses the email flows' code errors, whose wording points at an email; the badge's code came by text message. */
function badgeMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_code") return "That code is not right. Check the text message.";
  if (err instanceof ApiError && err.code === "code_expired") return "That code has expired. Send a new one.";
  return errorMessage(err);
}

/** Holding the badge, verifying a number, or removing it; each needs fresh authentication. */
function BadgeSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [phone, setPhone] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, done, setDone, act } = useAction(run, badgeMessage);
  const verified = me.profile?.verified === true;
  const phoneRef = useRef<TextInput>(null);
  const removeRef = useRef<View>(null);
  // The code field takes the focus itself (autoFocus). Start over and a removed badge bring the phone field back, and a verified
  // badge brings Remove badge: each takes the focus when its step returns.
  useFocusOnReturn(verified || flowId !== null, phoneRef);
  useFocusOnReturn(!verified, removeRef);

  // Enter in the field calls this as the button does, so the button's condition comes first.
  async function start() {
    if (phone.trim().length === 0) return;
    await act(async () => {
      const flow = await api("/api/auth/badge/start", { json: { phone: phone.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });
  }

  async function verify() {
    if (!CODE.test(code.trim())) return;
    await act(async () => {
      await api("/api/auth/badge/verify", { json: { flowId, code: code.trim() }, schema: BadgeVerifyResponse });
      setFlowId(null);
      setPhone("");
      setCode("");
      setDone("Your account is now verified.");
      // The chip on posts and the profile, and this section, read the session.
      await refresh();
    });
  }

  const remove = () =>
    act(async () => {
      await api("/api/auth/badge", { method: "DELETE" });
      setDone("The badge was removed.");
      await refresh();
    });

  return (
    <View>
      <Body>
        The Verified badge means you hold a phone number that no other account uses. To check it, the number is handed to the verification provider for one text message; korbat
        keeps it only as a keyed hash, never the number itself.
      </Body>
      {verified ? (
        <>
          <Body>Your account holds the badge.</Body>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button ref={removeRef} label="Remove badge" onPress={() => void remove()} busy={busy} tone="danger" />
        </>
      ) : flowId ? (
        <>
          <Body>We texted a code to {phone.trim()}.</Body>
          <Field label="Code from the text message" autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Verify" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field ref={phoneRef} label="Phone number" autoComplete="tel" inputMode="tel" placeholder="+447911123456" value={phone} onChangeText={setPhone} onSubmitEditing={() => void start()} />
          <Text className="mt-1 text-xs text-zinc-400">International format: a plus sign, the country code and the number, without the leading zero.</Text>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={phone.trim().length === 0} />
        </>
      )}
    </View>
  );
}

/** The export's own words for its daily limit: the generic "wait a moment" would be wrong for a window of a day. */
export function exportMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "rate_limited" && err.retryAfter) {
    const hours = Math.ceil(err.retryAfter / 3600);
    return hours <= 1 ? "You exported your data today already. You can export again in about an hour." : `You exported your data today already. You can export again in about ${hours} hours.`;
  }
  return errorMessage(err);
}

/**
 * The ZIP comes back as the response body, so the raw response is turned into a file the browser saves;
 * native has no downloads folder to offer. The API fails the body when the archive breaks off part way,
 * so res.blob() rejects and the section shows an error, never the note that the export was downloaded.
 */
function ExportSection({ run }: { run: Run }) {
  const { busy, error, done, setDone, act } = useAction(run, exportMessage);

  const download = () =>
    act(async () => {
      const res = await apiResponse("/api/account/export", { method: "POST" });
      saveBlob(await res.blob(), exportFilename(res.headers.get("content-disposition")));
      setDone("Your export was downloaded.");
    });

  return (
    <View>
      <Body>
        The archive is a ZIP with export.json (your account, profile, posts, likes, reposts, bookmarks, follows, blocks, mutes, sessions, devices and security events) and every
        image you uploaded. It holds your email address, so keep it somewhere private. You can export once a day.
      </Body>
      {Platform.OS === "web" ? (
        <>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Download my data" onPress={() => void download()} busy={busy} />
        </>
      ) : (
        <Body>Export your data from the web app.</Body>
      )}
    </View>
  );
}

/** Deletion needs an emailed code and the handle typed back; the API takes the account down at once and this session with it. */
function DeleteSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const { busy, error, act } = useAction(run);
  const handle = me.profile?.handle ?? "";
  const typedHandle = typed.trim().replace(/^@/, "").toLowerCase();
  // The API compares the typed handle case-insensitively and answers a mismatch as a generic invalid request; the same rule here keeps the button off until it matches.
  const matches = typedHandle.length > 0 && typedHandle === handle.toLowerCase();
  const sendRef = useRef<View>(null);
  // The code field takes the focus itself (autoFocus); Cancel brings "Send me a code" back, which takes it here.
  useFocusOnReturn(flowId !== null, sendRef);

  const start = () =>
    act(async () => {
      const flow = await api("/api/account/delete/start", { method: "POST", schema: DeleteStartResponse });
      setCode("");
      setTyped("");
      setFlowId(flow.flowId);
    });

  // The button's condition comes first, as in every other action of this screen.
  async function confirm() {
    if (!CODE.test(code.trim()) || !matches) return;
    await act(async () => {
      await api("/api/account/delete/confirm", { json: { flowId, code: code.trim(), handle: typedHandle } });
      // The API cleared the cookies: the session reloads as signed out, and the home page is public.
      await refresh();
      router.replace("/");
    });
  }

  return (
    <View>
      <Body>
        Deleting your account removes your posts and images, and your likes, reposts, bookmarks, follows, blocks and mutes. Your handle stays reserved, so nobody can take it.
        This cannot be undone.
      </Body>
      {flowId ? (
        <>
          <Body>We emailed a code to {me.user.email}.</Body>
          <Field label="Code from the email" autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} />
          <Field label="Type your handle to confirm" autoCapitalize="none" autoComplete="off" placeholder={`@${handle}`} value={typed} onChangeText={setTyped} />
          <ErrorText message={error} />
          <Button label="Delete my account" onPress={() => void confirm()} busy={busy} disabled={!CODE.test(code.trim()) || !matches} tone="danger" />
          <Button
            label="Cancel"
            onPress={() => {
              setFlowId(null);
              setCode("");
              setTyped("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <ErrorText message={error} />
          <Button ref={sendRef} label="Send me a code" onPress={() => void start()} busy={busy} tone="secondary" />
        </>
      )}
    </View>
  );
}

export default function AccountSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Account
        </Text>
        <Text className="mt-2 text-base text-zinc-400">@{me.profile?.handle}</Text>
        <SettingsNav current="account" />

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}
        {/* After a recovery code confirmed an action here: the screen stays, with the field for the code it mailed, and says where two-factor is set up again. */}
        <ReenrollNotice me={me} />

        <Section title="Email address">
          <EmailSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        {BADGE_SHOWN ? (
          <Section title="Verified badge">
            <BadgeSection me={me} run={reauth.run} refresh={refresh} />
          </Section>
        ) : null}
        <Section title="Data export">
          <ExportSection run={reauth.run} />
        </Section>
        <Section title="Delete account">
          <DeleteSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScrollView>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/profile.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { BIO_MAX_LENGTH, postLength, type MeResponse, type ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ReauthPanel, ReenrollNotice, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

/** The DisplayName contract's limit, in the code points the counter shows. */
const DISPLAY_NAME_MAX = 50;
/** The API lets a handle change again this long after the last change (1b design, section 7.2); mirrored so the date shows before a refused attempt. */
const HANDLE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

function Counter({ length, max }: { length: number; max: number }) {
  return (
    <Text className={`mt-1 text-right text-xs ${length > max ? "text-red-400" : "text-zinc-400"}`}>
      {length}/{max}
    </Text>
  );
}

/** Display name and bio. /api/me carries no bio, so the form starts from the public profile, which has both. */
function ProfileForm({ handle, refresh }: { handle: string; refresh: Refresh }) {
  const [saved, setSaved] = useState<ProfileView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    social
      .profile(handle)
      .then((profile) => {
        if (cancelled) return;
        setSaved(profile);
        setDisplayName(profile.displayName);
        setBio(profile.bio);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const name = displayName.trim();
  const text = bio.trim();
  const nameLength = postLength(name);
  const bioLength = postLength(text);
  const changed = saved !== null && (name !== saved.displayName || text !== saved.bio);
  const ready = changed && nameLength >= 1 && nameLength <= DISPLAY_NAME_MAX && bioLength <= BIO_MAX_LENGTH;

  // Enter in the bio calls this as the button does, so the button's conditions come first: nothing unchanged or invalid is
  // sent, and a second Enter while the first request is out sends nothing.
  async function save() {
    if (!saved || !ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      // Only what changed is sent: the contract refuses an empty edit, and the server records an event per call.
      const { profile } = await social.editProfile({ ...(name !== saved.displayName ? { displayName: name } : {}), ...(text !== saved.bio ? { bio: text } : {}) });
      setSaved(profile);
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setDone("Profile saved.");
      // The shell's Profile link and the profile page read the session, so it follows the new name.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!saved) {
    return error ? <ErrorText message={error} /> : <Text className="mt-3 text-sm text-zinc-400">Loading your profile...</Text>;
  }
  return (
    <View>
      <Body>Your display name is shown next to your posts. The bio is one line on your profile.</Body>
      <Field label="Display name" autoComplete="name" value={displayName} onChangeText={setDisplayName} />
      <Counter length={nameLength} max={DISPLAY_NAME_MAX} />
      {/* The Bio contract refuses control characters, which a line break is, so the field stays single-line. */}
      <Field label="Bio" value={bio} onChangeText={setBio} onSubmitEditing={() => void save()} />
      <Counter length={bioLength} max={BIO_MAX_LENGTH} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Save" onPress={() => void save()} busy={busy} disabled={!ready} />
    </View>
  );
}

/** The handle and its 30-day rule. The change needs fresh authentication, so it runs through useReauth. */
function HandleSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const current = me.profile?.handle ?? "";
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The moment a handle_cooldown answer named through Retry-After; until one comes, the last change plus 30 days says it.
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null);
  const fromLastChange = me.profile?.handleChangedAt ? new Date(me.profile.handleChangedAt).getTime() + HANDLE_COOLDOWN_MS : null;
  const until = refusedUntil ?? fromLastChange;
  const allowedAt = until !== null && until > Date.now() ? new Date(until) : null;
  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  const ready = normalized.length > 0 && normalized !== current.toLowerCase();

  // Enter in the field calls this as the button does, so the button's conditions come first.
  async function change() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(async () => {
        const { profile } = await social.changeHandle(normalized);
        setHandle("");
        setRefusedUntil(null);
        setDone(`Your handle is now @${profile.handle}. The old one stays reserved for you.`);
        // The shell's Profile link and this screen's heading read the session.
        await refresh();
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "handle_cooldown") setRefusedUntil(err.retryAfter ? Date.now() + err.retryAfter * 1000 : fromLastChange);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Body>Your handle is @{current}. You can change it once every 30 days. Handles you used before stay yours.</Body>
      {allowedAt ? <Text className="mt-2 text-sm text-amber-300">Your next change is allowed on {allowedAt.toLocaleDateString()}.</Text> : null}
      <Field label="New handle" autoCapitalize="none" autoComplete="username" placeholder="@yourname" value={handle} onChangeText={setHandle} onSubmitEditing={() => void change()} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Change handle" onPress={() => void change()} busy={busy} disabled={!ready} />
    </View>
  );
}

export default function ProfileSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;
  // The settings layout sends an account without a handle to onboarding, so the profile is there; the type still allows null.
  if (!me.profile) return <Loading />;

  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Profile
        </Text>
        <Text className="mt-2 text-base text-zinc-400">@{me.profile.handle}</Text>
        <SettingsNav current="profile" />

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}
        {/* After a recovery code confirmed the handle change: the screen stays as it is and says where two-factor is set up again. */}
        <ReenrollNotice me={me} />

        <Section title="Name and bio">
          <ProfileForm handle={me.profile.handle} refresh={refresh} />
        </Section>
        <Section title="Handle">
          <HandleSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScrollView>
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/security/PasskeysSection.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { z } from "zod";
import { PasskeyListResponse, PasskeyOptionsResponse, PasskeyView, type MeResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Notice } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { createPasskey, passkeysSupported } from "@/lib/passkeys";

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/** What the registration's verify and a rename answer: the passkey as the list shows it. */
const PasskeyResponse = z.object({ passkey: PasskeyView });

/** The PasskeyName contract's limit (the display-name rules). */
const NAME_MAX = 50;

/** The separator of a row's facts, the middle dot the sessions list uses, spelled by its code so the file stays ASCII. */
const DOT = " " + String.fromCharCode(183) + " ";

/** Ids come from the API's list; only a UUID may become part of a path. */
const passkeyPath = (id: string) => `/api/auth/passkeys/${encodeURIComponent(z.uuid().parse(id))}`;

/**
 * A short tag beside a passkey's name. It is an image to assistive technology, as the verified chip is: ARIA forbids
 * naming a generic element, and the label says what the one word means.
 */
function Tag({ label, meaning, tone = "plain" }: { label: string; meaning: string; tone?: "plain" | "good" | "bad" }) {
  const surface = tone === "good" ? "bg-emerald-950" : tone === "bad" ? "bg-red-950" : "bg-zinc-800";
  const text = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-zinc-300";
  return (
    <View role="img" accessibilityLabel={`${label}: ${meaning}`} className={`rounded-full px-2 py-0.5 ${surface}`}>
      <Text className={`text-xs font-medium ${text}`}>{label}</Text>
    </View>
  );
}

/** A small action inside a row, an underlined text like the sessions list's Sign out. */
function RowButton({ label, onPress, disabled, tone = "plain" }: { label: string; onPress: () => void; disabled: boolean; tone?: "plain" | "danger" }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} className="mr-4 py-1">
      <Text className={`text-sm underline ${disabled ? "text-zinc-500" : tone === "danger" ? "text-red-400" : "text-zinc-300"}`}>{label}</Text>
    </Pressable>
  );
}

/** One passkey of the list: its name and tags, its dates and device, and its actions; the rename is a field in place. */
export function PasskeyItem({
  passkey,
  busy,
  onRename,
  onRemove,
  onNotMine,
}: {
  passkey: PasskeyView;
  busy: boolean;
  /** Answers whether the new name was saved; the field stays for a retry otherwise. */
  onRename: (name: string) => Promise<boolean>;
  onRemove: () => void;
  onNotMine: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(passkey.name);
  const trimmed = name.trim();
  const ready = trimmed.length > 0 && trimmed.length <= NAME_MAX && trimmed !== passkey.name;

  // Enter in the field saves as the button does, so the button's conditions come first.
  async function save() {
    if (!ready || busy) return;
    if (await onRename(trimmed)) setRenaming(false);
  }

  return (
    <View className="mt-3 rounded-lg border border-zinc-800 px-4 py-3">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-base text-zinc-50">{passkey.name}</Text>
        {passkey.current ? <Tag label="used for this session" meaning="it signed you in here" tone="good" /> : null}
        {passkey.isNew ? <Tag label="new" meaning="added in the last 7 days" /> : null}
        {passkey.suspended ? <Tag label="suspended" meaning="switched off because a copy of it may exist" tone="bad" /> : null}
        {passkey.synced ? <Tag label="synced" meaning="backed up by your password manager to your other devices" /> : null}
      </View>
      <Text className="mt-1 text-xs text-zinc-400">
        added {new Date(passkey.createdAt).toLocaleDateString()}
        {DOT}
        {passkey.lastUsedAt ? `last used ${new Date(passkey.lastUsedAt).toLocaleString()}` : "never used"}
        {passkey.createdOn ? `${DOT}added on ${passkey.createdOn}` : null}
      </Text>
      {renaming ? (
        <>
          <Field label="Name" autoComplete="off" maxLength={NAME_MAX} value={name} onChangeText={setName} onSubmitEditing={() => void save()} />
          <View className="mt-2 flex-row flex-wrap">
            <RowButton label="Save" onPress={() => void save()} disabled={!ready || busy} />
            <RowButton
              label="Cancel"
              onPress={() => {
                setRenaming(false);
                setName(passkey.name);
              }}
              disabled={busy}
            />
          </View>
        </>
      ) : (
        <View className="mt-2 flex-row flex-wrap">
          <RowButton
            label="Rename"
            onPress={() => {
              // The field starts from the name the list shows now, not from an earlier edit.
              setName(passkey.name);
              setRenaming(true);
            }}
            disabled={busy}
          />
          <RowButton label="Remove" onPress={onRemove} disabled={busy} tone="danger" />
          {passkey.isNew ? <RowButton label="This wasn't me" onPress={onNotMine} disabled={busy} tone="danger" /> : null}
        </View>
      )}
    </View>
  );
}

/**
 * The dialog behind Add a passkey (1c design, section 9): the name korbat shows, optional, and the name the password
 * manager shows, prefilled with the handle, with one sentence on what that name reveals. Nothing is sent until Create.
 */
export function AddPasskeyDialog({
  handle,
  busy,
  error,
  onCreate,
  onCancel,
}: {
  handle: string;
  busy: boolean;
  error: string | null;
  onCreate: (name: string | undefined, label: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState(handle);
  const dialog = useRef<View>(null);
  // The dialog appears in reply to the Add button; the focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    (dialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);
  const ready = label.trim().length > 0 && label.trim().length <= NAME_MAX && name.trim().length <= NAME_MAX;

  // Enter in a field creates as the button does, so the button's conditions come first.
  async function create() {
    if (!ready || busy) return;
    await onCreate(name.trim().length > 0 ? name.trim() : undefined, label.trim());
  }

  return (
    <View ref={dialog} role="dialog" aria-labelledby="add-passkey-title" tabIndex={-1} className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <Text nativeID="add-passkey-title" accessibilityRole="header" aria-level={3} className="text-base font-semibold text-zinc-50">
        Add a passkey
      </Text>
      <Text className="mt-1 text-sm text-zinc-400">Your browser or password manager will ask you to confirm with your fingerprint, face, PIN or security key.</Text>
      <Field label="Name" autoComplete="off" maxLength={NAME_MAX} placeholder="For example Laptop or Phone" value={name} onChangeText={setName} />
      <Text className="mt-1 text-xs text-zinc-400">Optional: what korbat calls this passkey in the list.</Text>
      <Field label="Name in your password manager" autoComplete="off" maxLength={NAME_MAX} value={label} onChangeText={setLabel} onSubmitEditing={() => void create()} />
      <Text className="mt-1 text-xs text-zinc-400">Your password manager shows this name to anyone who can see this device.</Text>
      <ErrorText message={error} />
      <Button label="Create passkey" onPress={() => void create()} busy={busy} disabled={!ready} />
      <Button label="Cancel" onPress={onCancel} tone="secondary" />
    </View>
  );
}

/**
 * The Passkeys section of the Security screen (1c design, sections 7.3 and 7.5): the list, Add a passkey, Rename,
 * Remove, and "This wasn't me" on a new passkey, which explains the lockdown before running it. Adding and removing may
 * need level 2 on an account with two-factor, so they run through the re-authentication hook.
 */
export function PasskeysSection({ me, run, refresh, openAdd }: { me: MeResponse; run: Run; refresh: Refresh; openAdd: boolean }) {
  const supported = passkeysSupported();
  const [passkeys, setPasskeys] = useState<PasskeyView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The home screen's card opens the dialog at once; without support there is nothing to open.
  const [adding, setAdding] = useState(openAdd && supported);
  const [notMine, setNotMine] = useState<PasskeyView | null>(null);
  const lockdownDialog = useRef<View>(null);
  // The lockdown question appears in reply to "This wasn't me"; the focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    if (notMine) (lockdownDialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [notMine]);

  const load = useCallback(async () => {
    try {
      setPasskeys((await api("/api/auth/passkeys", { schema: PasskeyListResponse })).passkeys);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** One request at a time for the section, through the re-authentication hook; answers whether the action went through, with its failure shown where `show` puts it. */
  async function act(action: () => Promise<void>, show: (message: string) => void = setError): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setDialogError(null);
    setDone(null);
    try {
      await run(action);
      return true;
    } catch (err) {
      show(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** A verify that fails after the browser created the passkey leaves one in the password manager that korbat does not know; the message says so. */
  function kept(err: unknown): ApiError {
    const sentence = " Your password manager may have kept a passkey that korbat does not know; you can delete it there.";
    return err instanceof ApiError ? new ApiError(err.status, err.code, err.message + sentence, err.retryAfter, err.details) : new ApiError(0, "internal", errorMessage(err) + sentence);
  }

  const create = (name: string | undefined, label: string) =>
    act(async () => {
      const { options } = await api("/api/auth/passkeys/register/options", { json: { label }, schema: PasskeyOptionsResponse });
      const response = await createPasskey(options);
      // The prompt was closed: the dialog stays, with nothing to say.
      if (response === null) return;
      try {
        await api("/api/auth/passkeys/register/verify", { json: { ...(name ? { name } : {}), response }, schema: PasskeyResponse });
      } catch (err) {
        throw kept(err);
      }
      setAdding(false);
      setDone("Passkey added. An email about it is on its way, with a link that removes it in case this was not you.");
      await load();
      // The count in the session decides whether the home screen suggests a passkey and the panel offers one.
      await refresh();
    }, setDialogError);

  const rename = (passkey: PasskeyView, name: string) =>
    act(async () => {
      await api(passkeyPath(passkey.id), { method: "PATCH", json: { name }, schema: PasskeyResponse });
      await load();
    });

  const remove = (passkey: PasskeyView) =>
    act(async () => {
      await api(passkeyPath(passkey.id), { method: "DELETE" });
      setDone(`The passkey named ${passkey.name} was removed.`);
      await load();
      await refresh();
    });

  const lockDown = (passkey: PasskeyView) =>
    act(async () => {
      await api(`${passkeyPath(passkey.id)}/not-mine`, { method: "POST" });
      // The API signed this session out with every other and cleared its cookies; the session reloads as signed out.
      await refresh();
      router.replace("/signin");
    });

  return (
    <View>
      <Body>A passkey signs you in with your fingerprint, face, PIN or a security key, and cannot be phished. You can have up to 10.</Body>
      {passkeys === null ? <Text className="mt-3 text-sm text-zinc-400">Loading passkeys...</Text> : null}
      {passkeys?.length === 0 ? <Text className="mt-3 text-sm text-zinc-400">You have no passkeys yet.</Text> : null}
      {passkeys?.map((passkey) => (
        <PasskeyItem key={passkey.id} passkey={passkey} busy={busy} onRename={(name) => rename(passkey, name)} onRemove={() => void remove(passkey)} onNotMine={() => setNotMine(passkey)} />
      ))}
      {notMine ? (
        <View ref={lockdownDialog} role="dialog" aria-labelledby="not-mine-title" tabIndex={-1} className="mt-4 rounded-lg border border-red-900 bg-zinc-900 p-4">
          <Text nativeID="not-mine-title" accessibilityRole="header" aria-level={3} className="text-base font-semibold text-zinc-50">
            Lock down your account?
          </Text>
          {/* What the lockdown reaches, as it is: from the day before this passkey to now, which can be a week, the person's own additions since included. */}
          <Text className="mt-1 text-sm text-zinc-300">
            If you did not add the passkey named {notMine.name}, confirm below. Every session is signed out, including this browser, your password is removed, and every
            passkey and two-factor authentication set up since the day before this passkey was added is removed, including any you set up yourself after it, so only someone
            with your email can get back in.
          </Text>
          <Button label="Sign out everywhere and lock down" onPress={() => void lockDown(notMine)} busy={busy} tone="danger" />
          <Button label="Cancel" onPress={() => setNotMine(null)} tone="secondary" />
        </View>
      ) : null}
      <ErrorText message={error} />
      <Notice message={done} />
      {!supported ? (
        <Body>This browser cannot add a passkey. Use a recent browser on a device with a screen lock, or a password manager that stores passkeys.</Body>
      ) : adding ? (
        <AddPasskeyDialog
          handle={me.profile?.handle ?? ""}
          busy={busy}
          error={dialogError}
          onCreate={async (name, label) => {
            await create(name, label);
          }}
          onCancel={() => {
            setAdding(false);
            setDialogError(null);
          }}
        />
      ) : (
        <Button label="Add a passkey" onPress={() => setAdding(true)} tone="secondary" />
      )}
    </View>
  );
}
```

### Replace `apps/app/src/components/security/ReauthPanel.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { z } from "zod";
import { FlowResponse, PasskeyOptionsResponse, ReauthResponse, type MeResponse, type ReauthRequest } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, TextLink } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { confirmWithPasskey, passkeysSupported } from "@/lib/passkeys";
import { useSession } from "@/lib/session";

type Action = () => Promise<void>;

/** The factor kinds a session can have proven (1c design, section 7.1), as the API names them. */
export type FactorKind = "email" | "password" | "passkey" | "passkey_uv" | "totp" | "recovery";

/** What a reauth_required refusal says: the level the action needs, and the factors proven within the last five minutes. */
export interface ReauthNeeded {
  level: 1 | 2;
  have: FactorKind[];
}

const Needed = z.object({ level: z.union([z.literal(1), z.literal(2)]), have: z.array(z.enum(["email", "password", "passkey", "passkey_uv", "totp", "recovery"])) });

/** Reads a refusal's details; an answer without them, or in a shape this app does not know, counts as level 1 with nothing proved. */
export function reauthNeeded(err: ApiError): ReauthNeeded {
  const parsed = Needed.safeParse(err.details);
  return parsed.success ? parsed.data : { level: 1, have: [] };
}

/** What the panel keeps for the action it will run again: the action, and what its refusal said is needed. */
export interface Pending {
  action: Action;
  needed: ReauthNeeded;
}

/**
 * Runs a sensitive action. When the server answers `reauth_required`, the action is kept, with what the refusal said
 * is needed, so the re-authentication panel can run it again once the person has confirmed it's them.
 */
export function useReauth() {
  const [pending, setPending] = useState<Pending | null>(null);
  const run = useCallback(async (action: Action) => {
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_required") {
        setPending({ action, needed: reauthNeeded(err) });
        return;
      }
      throw err;
    }
  }, []);
  const clear = useCallback(() => setPending(null), []);
  return { pending, run, clear };
}

export type Method = "password" | "passkey" | "totp" | "email" | "recovery";

const FIRST: readonly FactorKind[] = ["email", "password", "passkey"];
const SECOND: readonly FactorKind[] = ["totp", "recovery"];
/** The methods that prove a first factor and those that prove a second; a passkey is in both, since a device that verifies the person makes it count as two. */
const PROVES_FIRST: readonly Method[] = ["password", "passkey", "email"];
const PROVES_SECOND: readonly Method[] = ["passkey", "totp", "recovery"];

/**
 * Which methods the panel offers (1c design, section 9): every one the account has at level 1; at level 2, only what
 * closes the gap the factors in `have` leave (a second factor after a first, a first after a second), and every one
 * when nothing was proved in time or nothing the account has would close it.
 */
export function methodsForLevel(needed: ReauthNeeded, available: Method[]): { methods: Method[]; missing: "first" | "second" | null } {
  if (needed.level === 2) {
    const hasFirst = needed.have.some((kind) => FIRST.includes(kind));
    const hasSecond = needed.have.some((kind) => SECOND.includes(kind));
    const missing = hasFirst && !hasSecond ? "second" : hasSecond && !hasFirst ? "first" : null;
    const proves = missing === "second" ? PROVES_SECOND : missing === "first" ? PROVES_FIRST : null;
    const methods = proves ? available.filter((method) => proves.includes(method)) : available;
    if (missing && methods.length > 0) return { methods, missing };
  }
  return { methods: available, missing: null };
}

/**
 * What the panel starts from for a refusal: what the refusal said is needed, the first method that closes the gap, and
 * nothing typed, mailed or refused yet. The same at mount and whenever another action's refusal takes the panel over.
 */
export function panelStart(needed: ReauthNeeded, available: Method[]): { needed: ReauthNeeded; method: Method; value: string; flowId: string | null; error: string | null } {
  return { needed, method: methodsForLevel(needed, available).methods[0]!, value: "", flowId: null, error: null };
}

/**
 * Whether the panel owes the hint to set two-factor up again: once any answer of its life spent a recovery code, whatever
 * was answered before or after it. `before` is what the earlier answers left.
 */
export function recoveryCodeSpent(before: boolean, answer: { mustReenrollMfa?: boolean }): boolean {
  return before || answer.mustReenrollMfa === true;
}

/** The hint after a recovery code was used, in the words of the Security screen's two-factor section. */
export const REENROLL_HINT = "You used a recovery code. Set up two-factor again to get a fresh set of codes.";

/**
 * The hint on a screen that has no two-factor section of its own (Account, Profile): shown once the panel set the
 * parameter on the route, with a link to Security, where two-factor is set up. The screen stays as it is, with what the
 * action just put on it.
 */
export function ReenrollNotice({ me }: { me: MeResponse }) {
  const { reenroll } = useLocalSearchParams<{ reenroll?: string }>();
  if (reenroll !== "1" || !me.user.mfaEnabled) return null;
  return (
    <View className="mt-6 rounded-lg bg-amber-500/10 px-4 py-3">
      <Text className="text-sm text-amber-300">{REENROLL_HINT}</Text>
      <TextLink label="Open Security" href="/settings/security?reenroll=1" />
    </View>
  );
}

const LABELS: Record<Method, string> = { password: "Password", passkey: "Passkey", totp: "Authenticator code", email: "Email code", recovery: "Recovery code" };

export function ReauthPanel({ me, pending, onClose }: { me: MeResponse; pending: Pending; onClose: () => void }) {
  const { refresh } = useSession();
  // The methods the account has, in the order the chips show them; a passkey only where the browser can use one.
  const available: Method[] = [
    ...(me.user.hasPassword ? (["password"] as const) : []),
    ...(me.user.passkeys > 0 && passkeysSupported() ? (["passkey"] as const) : []),
    ...(me.user.mfaEnabled ? (["totp"] as const) : []),
    "email",
    ...(me.user.mfaEnabled ? (["recovery"] as const) : []),
  ];
  const start = panelStart(pending.needed, available);
  // What the last refusal said is needed; the action's own refusal after a first answer replaces it.
  const [needed, setNeeded] = useState(start.needed);
  const { methods, missing } = methodsForLevel(needed, available);
  const [method, setMethod] = useState<Method>(start.method);
  const [value, setValue] = useState(start.value);
  const [flowId, setFlowId] = useState(start.flowId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(start.error);
  // The screens render one panel for whatever refusal is pending, so another action refused while this one is open
  // hands the same panel a new refusal. It starts over from that one, here rather than in an effect, so that no frame
  // shows the old refusal's sentence and methods above an action that needs something else.
  const [asked, setAsked] = useState(pending);
  if (asked !== pending) {
    const next = panelStart(pending.needed, available);
    setAsked(pending);
    setNeeded(next.needed);
    setMethod(next.method);
    setValue(next.value);
    setFlowId(next.flowId);
    setError(next.error);
  }
  // Whether an answer of this panel's life spent a recovery code. A ref, since the answer's own result is gone when the
  // action is refused again (the code was the first of two answers) or fails, and the hint is due all the same.
  const recoveryUsed = useRef(false);
  const panel = useRef<View>(null);
  // The panel appears in reply to an action elsewhere on the page, and so does each refusal that takes it over; focus
  // moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    (panel.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [pending]);

  /**
   * Closes the panel, after the action went through and on Cancel alike. A recovery code works once, so after one
   * two-factor should be set up again for a fresh set: the hint is a parameter set on the route the screen is on, which
   * keeps the screen mounted, with what the action just showed (new recovery codes, a QR code, the field for a mailed
   * code). Replacing the route would build the screen anew and lose that.
   */
  function close() {
    onClose();
    if (recoveryUsed.current) router.setParams({ reenroll: "1" });
  }

  async function sendEmailCode() {
    setBusy(true);
    setError(null);
    try {
      setFlowId((await api("/api/auth/reauth/email/start", { method: "POST", schema: FlowResponse })).flowId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Sends one answer, then runs the action. A web session got fresh cookies with the answer, and a native client would
   * keep the token it carries; the session is reloaded so the app follows what the answer changed. When the action is
   * refused again, the level rose past what one answer gave, and the panel asks for what is still missing.
   */
  async function answer(body: ReauthRequest) {
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/auth/reauth", { json: body, schema: ReauthResponse });
      recoveryUsed.current = recoveryCodeSpent(recoveryUsed.current, result);
      setValue("");
      await refresh();
      try {
        await pending.action();
      } catch (err) {
        if (err instanceof ApiError && err.code === "reauth_required") {
          const next = reauthNeeded(err);
          setNeeded(next);
          setMethod(methodsForLevel(next, available).methods[0]!);
          setFlowId(null);
          return;
        }
        throw err;
      }
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** The passkey method: the account's usable passkeys in the options, the browser's prompt, and the response as the answer. */
  async function passkey() {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api("/api/auth/reauth/passkey/options", { method: "POST", schema: PasskeyOptionsResponse });
      const response = await confirmWithPasskey(options);
      // The prompt was closed: nothing to say.
      if (response === null) return;
      await answer({ method: "passkey", response });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Enter in the field confirms as the button does, so the button's condition comes first.
  async function confirm() {
    const typed = value.trim();
    if (typed.length === 0) return;
    if (method === "password") return answer({ method: "password", password: value });
    if (method === "totp") return answer({ method: "totp", code: typed });
    if (method === "recovery") return answer({ method: "recovery", recoveryCode: typed.toLowerCase() });
    if (flowId) return answer({ method: "email", flowId, code: typed });
    return undefined;
  }

  const explanation =
    missing === "second"
      ? "You confirmed a first factor; add a second one: an authenticator code, a recovery code, or a passkey that checks your fingerprint, face or PIN. "
      : missing === "first"
        ? "You confirmed a second factor; add a first one: your password, an email code or a passkey. "
        : "";

  return (
    <View ref={panel} role="dialog" aria-labelledby="reauth-title" tabIndex={-1} className="mt-6 rounded-xl border border-amber-500/40 bg-zinc-900 p-5">
      <Text nativeID="reauth-title" accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        Confirm it's you
      </Text>
      <Text className="mt-1 text-sm text-zinc-400">
        {needed.level === 2 ? "This change needs two factors because two-factor authentication is on. " : "This change needs a fresh confirmation. "}
        {explanation}
        It stays valid for 5 minutes.
      </Text>
      <View className="mt-4 flex-row flex-wrap gap-2">
        {methods.map((m) => (
          <Text
            key={m}
            accessibilityRole="button"
            aria-pressed={m === method}
            onPress={() => {
              setMethod(m);
              setValue("");
              setError(null);
            }}
            className={`rounded-full px-3 py-1 text-sm ${m === method ? "bg-zinc-50 text-zinc-950" : "border border-zinc-600 text-zinc-300"}`}
          >
            {LABELS[m]}
          </Text>
        ))}
      </View>
      {method === "passkey" ? (
        <>
          <Body>Confirm with a passkey of this account. The browser will ask for it.</Body>
          <Button label="Use a passkey" onPress={() => void passkey()} busy={busy} />
        </>
      ) : method === "email" && !flowId ? (
        <Button label="Email me a code" onPress={() => void sendEmailCode()} busy={busy} tone="secondary" />
      ) : (
        <>
          <Field
            label={LABELS[method]}
            secureTextEntry={method === "password"}
            autoComplete={method === "password" ? "current-password" : method === "recovery" ? "off" : "one-time-code"}
            autoCapitalize={method === "recovery" ? "none" : undefined}
            inputMode={method === "password" || method === "recovery" ? "text" : "numeric"}
            maxLength={method === "recovery" ? 14 : undefined}
            placeholder={method === "recovery" ? "abcd-efgh-ijkl" : undefined}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={() => void confirm()}
          />
          <Button label="Confirm" onPress={() => void confirm()} busy={busy} disabled={value.trim().length === 0} />
        </>
      )}
      <ErrorText message={error} />
      <Button label="Cancel" onPress={close} tone="secondary" />
    </View>
  );
}
```

### Replace `packages/contracts/src/account.ts` (whole file)

```ts
import { z } from "zod";
import { Platform, Role } from "./auth";

const at = z.iso.datetime();

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
const PostRef = z.object({ postId: z.uuid(), at });

/** The other side of a graph relation by the handle it had at export time (nothing else about them), and since when. */
const HandleRef = z.object({ handle: z.string(), since: at });

/** An image attached to one of the account's posts; `file` names its entry in the archive. */
const ExportedMedia = z.object({ id: z.uuid(), file: z.string(), altText: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });

/** A post as its author wrote it; a deleted one keeps its place with an empty body and its deletion time. */
const ExportedPost = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: at,
  replyToId: z.uuid().nullable(),
  quoteOfId: z.uuid().nullable(),
  state: z.enum(["visible", "withheld", "removed", "deleted_by_author"]),
  deletedAt: at.nullable(),
  media: z.array(ExportedMedia),
});

/** A passkey of the account as the export lists it (1c design, section 7.7): what the Security screen shows, and nothing that identifies the key, its id or its authenticator. */
const ExportedPasskey = z.object({
  name: z.string(),
  createdAt: at,
  lastUsedAt: at.nullable(),
  /** Backed up, so the password manager syncs it to the owner's other devices. */
  synced: z.boolean(),
  /** The label of the device that added it; null once that device is gone. */
  createdOn: z.string().nullable(),
});

/**
 * export.json inside the data export archive (1b design, section 7.5): everything the account owns, and
 * nothing about other people beyond the handle they had at export time.
 */
export const ExportFormat = z.object({
  format: z.literal("korbat-export-1"),
  exportedAt: at,
  account: z.object({
    id: z.uuid(),
    email: z.email(),
    createdAt: at,
    role: Role,
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
    verified: z.boolean(),
    termsVersion: z.string().nullable(),
    termsAcceptedAt: at.nullable(),
    /** The account's passkeys, newest first. Added to korbat-export-1 without a new format name: a reader that does not know the member loses nothing by skipping it. */
    passkeys: z.array(ExportedPasskey),
  }),
  profile: z.object({
    handle: z.string(),
    displayName: z.string(),
    bio: z.string(),
    createdAt: at,
    /** Every handle the account ever had, the current one included. */
    handleHistory: z.array(z.string()),
  }),
  posts: z.array(ExportedPost),
  likes: z.array(PostRef),
  reposts: z.array(PostRef),
  bookmarks: z.array(PostRef),
  following: z.array(HandleRef),
  blocks: z.array(HandleRef),
  mutes: z.array(HandleRef),
  /** The live sessions. `id` is the session's handle, as the session list names it; the hash of its token never leaves the server. */
  sessions: z.array(z.object({ id: z.string(), createdAt: at, lastUsedAt: at, current: z.boolean() })),
  devices: z.array(z.object({ label: z.string().nullable(), platform: Platform, firstSeenAt: at, lastSeenAt: at })),
  /** The account's own security events: their kind and time, without the metadata. */
  events: z.array(z.object({ type: z.string(), at })),
  /** Ids of ready images whose file was not on disk when the archive was written. */
  missingMedia: z.array(z.string()),
});
export type ExportFormat = z.infer<typeof ExportFormat>;
```

### Replace `packages/contracts/src/auth.ts` (whole file)

```ts
import { z } from "zod";
import { FORBIDDEN_FORMAT } from "./text";

/** Every code the auth endpoints can put in ErrorEnvelope.error.code. */
export const AuthErrorCode = z.enum([
  "invalid_code",
  "code_expired",
  "too_many_attempts",
  "invalid_credentials",
  "mfa_required",
  "invalid_mfa_code",
  "reauth_required",
  "csrf_failed",
  "turnstile_failed",
  "disposable_email",
  "age_requirement",
  "terms_required",
  "handle_taken",
  "handle_invalid",
  "handle_reserved",
  "password_too_short",
  "password_too_long",
  "password_breached",
  "password_check_unavailable",
  "staff_mfa_required",
  "onboarding_required",
  "mail_unavailable",
  "rate_limited",
  "handle_cooldown",
  "email_in_use",
  "phone_in_use",
  "badge_unavailable",
  "verify_unavailable",
  // Passkeys (1c design, sections 8 and 9).
  "passkey_invalid",
  "passkey_unsupported",
  "passkey_limit",
  "passkey_suspended",
  "passkey_not_found",
  "challenge_expired",
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCode>;

export const Platform = z.enum(["web", "ios", "android"]);
export type Platform = z.infer<typeof Platform>;

export const Role = z.enum(["user", "moderator", "admin"]);
export type Role = z.infer<typeof Role>;

/** Random id created once per app install. The server stores only a keyed hash of it. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
/** 32 random bytes as base64url without padding: flow ids, MFA tickets, single-use link tokens. */
export const OpaqueId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const EmailCode = z.string().regex(/^\d{6}$/);
export const TotpCode = z.string().regex(/^\d{6}$/);
/**
 * A phone number in E.164 once the spaces, hyphens and parentheses people type are dropped: a plus and
 * 7 to 15 digits, the first not zero. Whether the number exists is the verification provider's call.
 */
export const Phone = z
  .string()
  .trim()
  .max(64)
  .transform((raw) => raw.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9][0-9]{6,14}$/, "phone numbers are written like +447911123456"));
/** The six-digit code the verification provider texts to a phone; the development provider's is 000000. */
export const PhoneCode = z.string().regex(/^\d{6}$/);
export const RecoveryCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
/** Handle rules (3-20 of a-z, 0-9, _; reserved names) are enforced by the flow so it can return a specific error code. */
export const HandleInput = z.string().trim().toLowerCase().min(1).max(64);
export const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[^\p{Cc}]+$/u)
  .refine((name) => !FORBIDDEN_FORMAT.test(name), { message: "invisible direction and spacing characters are not allowed" });
export const TurnstileToken = z.string().min(1).max(2048);
/** Length rules (12-128) are enforced by the flow so it can return password_too_short or password_too_long. */
export const PasswordInput = z.string().min(1).max(1024);

/**
 * A new bearer token after the server rotated the session. Present only for native clients; web
 * clients receive fresh cookies instead.
 */
export const RotatedToken = z.string().optional();

// ---------------------------------------------------------------- email entry and sign-up

export const EmailStartRequest = z.object({
  email: Email,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type EmailStartRequest = z.infer<typeof EmailStartRequest>;

export const FlowResponse = z.object({ flowId: OpaqueId });
export type FlowResponse = z.infer<typeof FlowResponse>;

export const EmailVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailVerifyRequest = z.infer<typeof EmailVerifyRequest>;

/** A session was issued. Native clients get the bearer token in the body; web clients only get cookies. */
export const SessionResult = z.object({
  result: z.literal("session"),
  mustReenrollMfa: z.boolean(),
  token: z.string().optional(),
});
export const MfaRequiredResult = z.object({ result: z.literal("mfa_required"), mfaTicket: OpaqueId });
export const SignupRequiredResult = z.object({ result: z.literal("signup_required") });

export const EmailVerifyResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult, SignupRequiredResult]);
export type EmailVerifyResponse = z.infer<typeof EmailVerifyResponse>;

export const SignInResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult]);
export type SignInResponse = z.infer<typeof SignInResponse>;

export const SignupCompleteRequest = z.object({
  flowId: OpaqueId,
  dateOfBirth: z.iso.date(),
  termsVersion: z.string().min(1).max(64),
});
export type SignupCompleteRequest = z.infer<typeof SignupCompleteRequest>;

export const Profile = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string() });
export type Profile = z.infer<typeof Profile>;

export const OnboardingHandleRequest = z.object({ handle: HandleInput, displayName: DisplayName });
export type OnboardingHandleRequest = z.infer<typeof OnboardingHandleRequest>;

export const OnboardingHandleResponse = z.object({ profile: Profile, token: RotatedToken });
export type OnboardingHandleResponse = z.infer<typeof OnboardingHandleResponse>;

// ---------------------------------------------------------------- password

export const PasswordSigninRequest = z.object({
  email: Email,
  password: PasswordInput,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type PasswordSigninRequest = z.infer<typeof PasswordSigninRequest>;

export const PasswordSetRequest = z.object({ password: PasswordInput });
export type PasswordSetRequest = z.infer<typeof PasswordSetRequest>;

export const PasswordSetResponse = z.object({ token: RotatedToken });
export type PasswordSetResponse = z.infer<typeof PasswordSetResponse>;

// ---------------------------------------------------------------- MFA

export const TotpSetupResponse = z.object({
  otpauthUri: z.string().startsWith("otpauth://totp/"),
  qrSvg: z.string().startsWith("<svg"),
});
export type TotpSetupResponse = z.infer<typeof TotpSetupResponse>;

export const TotpCodeRequest = z.object({ code: TotpCode });
export type TotpCodeRequest = z.infer<typeof TotpCodeRequest>;

/**
 * Turning TOTP off takes no code (1c design, section 2): the route needs a level-2 re-authentication, which already spent
 * the current step. A code a client sends anyway is dropped.
 */
export const TotpDisableRequest = z.object({});
export type TotpDisableRequest = z.infer<typeof TotpDisableRequest>;

export const RecoveryCodesResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10) });
export type RecoveryCodesResponse = z.infer<typeof RecoveryCodesResponse>;

export const TotpConfirmResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10), token: RotatedToken });
export type TotpConfirmResponse = z.infer<typeof TotpConfirmResponse>;

/** Exactly one of `code` or `recoveryCode`. */
export const MfaVerifyRequest = z.union([
  z.strictObject({ mfaTicket: OpaqueId, code: TotpCode }),
  z.strictObject({ mfaTicket: OpaqueId, recoveryCode: RecoveryCode }),
]);
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>;

// ---------------------------------------------------------------- re-authentication

// ReauthRequest lives in passkeys.ts: its `passkey` variant needs AuthenticationResponseJSON, and having auth.ts import
// that would form a cycle (passkeys.ts already imports this file). ReauthResponse stays here, as it names no passkey type.

/**
 * What a re-authentication answers (1c design, section 7.2): the level the session holds now (2 when a second factor
 * stands beside a first within the window, or a user-verified passkey does), the rotated token for native clients (web
 * clients get fresh cookies instead), and, after a recovery code, that two-factor authentication should be set up again.
 */
export const ReauthResponse = z.object({
  level: z.union([z.literal(1), z.literal(2)]),
  token: RotatedToken,
  mustReenrollMfa: z.boolean().optional(),
});
export type ReauthResponse = z.infer<typeof ReauthResponse>;

// ---------------------------------------------------------------- sessions and account

export const SessionInfo = z.object({
  /**
   * The session's handle: a random id it keeps for its whole life, which `DELETE /api/auth/sessions/:id` takes. Never the
   * token's hash, which changes whenever the token rotates (at every re-authentication, for one), so a session listed
   * before a rotation can still be revoked after it.
   */
  id: z.uuid(),
  deviceLabel: z.string(),
  platform: Platform,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const SessionsResponse = z.object({ sessions: z.array(SessionInfo) });
export type SessionsResponse = z.infer<typeof SessionsResponse>;

export const NotMeRequest = z.object({ token: OpaqueId });
export type NotMeRequest = z.infer<typeof NotMeRequest>;

/**
 * The signed-in account's own profile as /me returns it (the profile-editing routes answer the public ProfileView): the public facts
 * plus when the handle last changed (the app shows when the next change is allowed) and whether the
 * verified badge is held.
 */
export const MeProfile = Profile.extend({ handleChangedAt: z.iso.datetime().nullable(), verified: z.boolean() });
export type MeProfile = z.infer<typeof MeProfile>;

export const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    role: Role,
    onboarded: z.boolean(),
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
    /** How many passkeys the account holds (1c design, section 7.5): above zero the app offers a passkey re-authentication, at zero it suggests adding one. */
    passkeys: z.number().int().nonnegative(),
  }),
  profile: MeProfile.nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;

// ---------------------------------------------------------------- email change

/** The new address, under the sign-up rules. The flow refuses the current address and disposable ones. */
export const EmailChangeStartRequest = z.object({ email: Email });
export type EmailChangeStartRequest = z.infer<typeof EmailChangeStartRequest>;

export const EmailChangeVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailChangeVerifyRequest = z.infer<typeof EmailChangeVerifyRequest>;

/** The address the account now has. */
export const EmailChangeResponse = z.object({ email: z.email() });
export type EmailChangeResponse = z.infer<typeof EmailChangeResponse>;

/**
 * The token from the link the email_changed notice sends to the old address. It is the only credential
 * the undo needs, since a passwordless account cannot sign in at the old address any more.
 */
export const EmailRevertRequest = z.object({ token: OpaqueId });
export type EmailRevertRequest = z.infer<typeof EmailRevertRequest>;

// ---------------------------------------------------------------- verified badge

export const BadgeStartRequest = z.object({ phone: Phone });
export type BadgeStartRequest = z.infer<typeof BadgeStartRequest>;

export const BadgeVerifyRequest = z.object({ flowId: OpaqueId, code: PhoneCode });
export type BadgeVerifyRequest = z.infer<typeof BadgeVerifyRequest>;

export const BadgeVerifyResponse = z.object({ verified: z.literal(true) });
export type BadgeVerifyResponse = z.infer<typeof BadgeVerifyResponse>;

// ---------------------------------------------------------------- account deletion

export const DeleteStartResponse = z.object({ flowId: OpaqueId });
export type DeleteStartResponse = z.infer<typeof DeleteStartResponse>;

/** The emailed code and the account's handle typed by the owner; the flow compares the handle case-insensitively. */
export const DeleteConfirmRequest = z.object({ flowId: OpaqueId, code: EmailCode, handle: HandleInput });
export type DeleteConfirmRequest = z.infer<typeof DeleteConfirmRequest>;
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:       Tests  90 passed (90)
packages/db test:       Tests  27 passed (27)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  64 passed (64)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  434 passed | 249 skipped (683)
```

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  247 passed (247)
```

## Step 7: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 8: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 9: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 10: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 11: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 12: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 13: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 14: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 15: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up 56 seconds (healthy)
```

## Step 16: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/account/flows/export.ts`
- `apps/api/src/account/routes.ts`
- `apps/api/src/auth/flows/account.ts`
- `apps/api/src/auth/flows/email-change.ts`
- `apps/api/src/auth/flows/export.ts`
- `apps/api/src/auth/flows/lockdown.ts`
- `apps/api/src/auth/flows/mfa.ts`
- `apps/api/src/auth/flows/not-me.ts`
- `apps/api/src/auth/passkeys/flows.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/src/auth/sessions.ts`
- `apps/api/test/account/export.test.ts`
- `apps/api/test/auth/deletion.test.ts`
- `apps/api/test/auth/email-change.test.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/auth/lockdown.test.ts`
- `apps/api/test/auth/not-me.test.ts`
- `apps/api/test/auth/passkey-management.test.ts`
- `apps/api/test/auth/passkey-signin.test.ts`
- `apps/api/test/auth/sessions.test.ts`
- `apps/api/test/auth/totp-confirm.test.ts`
- `apps/api/test/integration/account-deletion.test.ts`
- `apps/api/test/integration/account-export.test.ts`
- `apps/api/test/integration/account-takedown.test.ts`
- `apps/api/test/integration/auth-flows-account.test.ts`
- `apps/api/test/integration/auth-flows-mfa.test.ts`
- `apps/api/test/integration/auth-janitor.test.ts`
- `apps/api/test/integration/auth-lockdown.test.ts`
- `apps/api/test/integration/auth-passkey-signin.test.ts`
- `apps/api/test/integration/auth-passkeys.test.ts`
- `apps/api/test/integration/auth-repo.test.ts`
- `apps/api/test/integration/auth-sessions.test.ts`
- `apps/api/test/integration/http-account.test.ts`
- `apps/api/test/integration/http-auth.test.ts`
- `apps/api/test/integration/http-badge.test.ts`
- `apps/api/test/integration/http-deletion.test.ts`
- `apps/api/test/integration/http-e2e.test.ts`
- `apps/api/test/integration/http-passkey-signin.test.ts`
- `apps/api/test/integration/http-passkeys.test.ts`
- `apps/api/test/integration/http-profile.test.ts`
- `apps/api/test/integration/http-reauth.test.ts`
- `apps/app/src/app/email-revert/[token].tsx`
- `apps/app/src/app/not-me/[token].tsx`
- `apps/app/src/app/passkey-remove/[token].tsx`
- `apps/app/src/app/settings/account.tsx`
- `apps/app/src/app/settings/profile.tsx`
- `apps/app/src/components/security/PasskeysSection.tsx`
- `apps/app/src/components/security/ReauthPanel.tsx`
- `apps/app/test/passkeys.test.tsx`
- `packages/contracts/src/account.ts`
- `packages/contracts/src/auth.ts`
- `packages/contracts/test/account.test.ts`
- `packages/contracts/test/auth.test.ts`

## Step 17: commit

```bash
git add -A
git commit -q -m "fix(auth,app): what the review of 1c upheld, fixed: the not-me link, the passkey remove link and the email undo are checked before they are spent, so a link refused while the account is at another address works once the address is back; the lockdown's writes and its event are one transaction, with the cache tombstones after the commit; 'not mine' counts only calls that run the lockdown; sessions are listed, revoked and exported by their handle, which survives the in-place rotation; TOTP confirm spends the pending secret once; the session cache key is versioned; an assertion without a user handle is refused at sign-in; six test gaps are closed; the web app keeps the screen mounted after a recovery-code re-authentication and shows its hint in place, the panel follows the refusal it is answering, and the lockdown's dialog and pages say what it removes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `fix(auth,app): what the review of 1c upheld, fixed: the not-me link, the passkey remove link and the email undo are checked before they are spent, so a link refused while the account is at another address works once the address is back; the lockdown's writes and its event are one transaction, with the cache tombstones after the commit; 'not mine' counts only calls that run the lockdown; sessions are listed, revoked and exported by their handle, which survives the in-place rotation; TOTP confirm spends the pending secret once; the session cache key is versioned; an assertion without a user handle is refused at sign-in; six test gaps are closed; the web app keeps the screen mounted after a recovery-code re-authentication and shows its hint in place, the panel follows the refusal it is answering, and the lockdown's dialog and pages say what it removes`.

## Report format (mandatory)

```text
TASK 8 REPORT
Files written: <count, expected 54>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
