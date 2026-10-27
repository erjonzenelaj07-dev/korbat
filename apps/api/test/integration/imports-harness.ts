import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import pino from "pino";
import { expect } from "vitest";
import { FlowResponse, IMPORT_RULES, ImportView, MeResponse, type ImportSummary, type ImportedPost } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { writeScanOutput } from "@korbat/import-protocol";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { createImports, importSettingsFrom, type ImportSettings } from "../../src/imports";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia, matchAdapterFrom, type MatchAdapter } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, socialForModeration } from "../../src/social";
import { Browser } from "./http-client";
import { fakeWorker } from "./media-harness";
import { removeFixtures, rowCounts } from "./moderation-fixtures";

/**
 * The imports module through the real app (3b design, section 12.3): sign-up over HTTP, cookie sessions with CSRF, the
 * auth, social and imports modules wired as the server wires them, the two import volumes in a temporary folder, and
 * packages/import-protocol's writeScanOutput standing in for the importer, as fakeWorker stands in for the image worker.
 * 3b Task 5: the media module over two volumes of its own, with the test matcher unless a test gives another (the media
 * tests' closed site), and fakeWorker on its store; the moderation module as the server builds it, handed to the media
 * module as its handler of refusals; and the profile store, which the confirmation asks about a suspension.
 */

/** The tables a file of these tests must leave as it found them. */
export const IMPORT_TABLES = ["import_jobs", "import_picks", "import_keys"];
export const DAY_MS = 86_400_000;

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** An archive's bytes for the declared source X or Mastodon: a zip's local header, then filler. The importer is not run. */
export function zipArchive(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
  for (let i = 4; i < size; i++) bytes[i] = (i * 31) % 253;
  return bytes;
}

/** One line of posts.jsonl as the importer writes it. */
export function line(ref: number, over: Partial<ImportedPost> = {}): ImportedPost {
  const day = String((ref % 28) + 1).padStart(2, "0");
  return {
    ref,
    key: createHash("sha256").update(`line ${ref} ${over.text ?? ""}`).digest("hex"),
    at: `2019-03-${day}T12:00:00Z`,
    kind: "post",
    parent: null,
    text: `imported line ${ref}`,
    media: [],
    protected: false,
    warning: false,
    ...over,
  };
}

export function scanned(id: string, posts: number, over: Partial<Extract<ImportSummary, { status: "scanned" }>> = {}): ImportSummary {
  return { v: 1, id, status: "scanned", posts, images: 0, skipped: {}, imagesSkipped: {}, cleaned: 0, warnings: 0, sourceLinks: 0, protectedPosts: 0, readInPart: false, ...over };
}

export interface HarnessOptions {
  settings?: Partial<ImportSettings>;
  /** The importer's heartbeat written at the start; fresh unless false. */
  heartbeat?: boolean;
  /** 3b Task 5: the comparison with known material; the test matcher, as on a closed site, unless given. */
  match?: MatchAdapter;
}

export async function importsHarness(options: HarnessOptions = {}) {
  const config: Config = loadConfig();
  const logger = pino({ level: "silent" });
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
  const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
  const root = mkdtempSync(path.join(tmpdir(), "korbat-imports-"));
  const mailer = new MemoryMailer();
  const rateLimitStore = new MemoryStore();
  /** The free space import-archives reports: plenty, unless a test sets less. */
  let free = 64 * 1024 ** 3;
  const auth = createAuth({
    config,
    logger,
    authDb,
    kv: new MemoryKv(),
    mailer,
    profiles: createProfileStore(apiDb),
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
  });
  const match = options.match ?? matchAdapterFrom({ MEDIA_MATCH: "test", APP_SITE: "closed" });
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
    enforceUploadLimit: async () => undefined,
    match,
  });
  // The store volume, which the image worker owns; the stand-in writes its results and files there.
  mkdirSync(path.join(root, "store"), { recursive: true });
  await media.prepare();
  const worker = fakeWorker(media.deps.files.store);
  const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: media.forCases, requireSession: auth.requireSession, rateLimitStore, config, logger });
  media.onMatch(moderation.matched);
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
  const settings: ImportSettings = { ...importSettingsFrom(config), ...options.settings };
  const imports = createImports({
    apiDb,
    archivesDir: path.join(root, "archives"),
    workDir: path.join(root, "work"),
    settings,
    auth: auth.forImports,
    social: social.forImports,
    media: media.forImports,
    moderation: moderation.forImports,
    profiles: createProfileStore(apiDb),
    rateLimitStore,
    requireSession: auth.requireSession,
    logger,
    freeBytes: async () => free,
  });
  await imports.prepare();
  mkdirSync(path.join(root, "work"), { recursive: true });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, imports });
  const made: string[] = [];
  const before = await rowCounts(apiDb, IMPORT_TABLES);
  const work = imports.deps.files.work;
  const archives = imports.deps.files.archives;

  /** The importer's heartbeat, `{ v: 1, at }`, as it writes it every ten seconds. */
  const beat = (at = Date.now()) => writeFileSync(work.heartbeat, JSON.stringify({ v: 1, at }));
  if (options.heartbeat !== false) beat();

  /** A signed-in, onboarded web account whose profile is `ageDays` old (eight unless said, past the import's seven). */
  async function signUp(options: { ageDays?: number; ip?: string } = {}) {
    const b = new Browser(app, config.APP_ORIGIN, options.ip === undefined ? {} : { ip: options.ip });
    const email = `imports-${randomUUID()}@korbat.local`;
    const handle = `i${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const id = MeResponse.parse(await (await b.fetch("/api/me")).json()).user.id;
    made.push(id);
    await age(id, options.ageDays ?? 8);
    return { b, id, handle, email };
  }

  /** Sets the profile's age, as only the migrator may. */
  const age = (id: string, days: number) => migrateDb.execute(sql`update profiles set created_at = now() - make_interval(secs => ${days * 86_400}) where id = ${id}::uuid`);

  /** POST /api/imports. */
  const create = (b: Browser, body: unknown = { source: "mastodon", bytes: 100 }) => b.fetch("/api/imports", { json: body });

  /** Creates an import and answers its view; the request must be taken. */
  async function created(b: Browser, body: { source: "x" | "mastodon" | "bluesky"; bytes: number } = { source: "mastodon", bytes: 100 }): Promise<ImportView> {
    const res = await create(b, body);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return ImportView.parse(await res.json());
  }

  /** One chunk, PUT /api/imports/<id>/archive, with its offset, its length and its SHA-256 unless the test says otherwise. */
  const chunk = (b: Browser, id: string, at: number, bytes: Uint8Array, headers: Record<string, string> = {}) =>
    b.fetch(`/api/imports/${id}/archive`, {
      method: "PUT",
      raw: { type: "application/octet-stream", body: bytes },
      headers: { "import-offset": String(at), "import-chunk-sha256": sha256(bytes), "content-length": String(bytes.length), ...headers },
    });

  /** The whole archive in chunks of IMPORT_RULES.chunkBytes, each taken. */
  async function upload(b: Browser, id: string, archive: Uint8Array): Promise<void> {
    for (let at = 0; at < archive.length; at += IMPORT_RULES.chunkBytes) {
      const res = await chunk(b, id, at, archive.subarray(at, Math.min(archive.length, at + IMPORT_RULES.chunkBytes)));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    }
  }

  /** An import of a new account brought to ready: created, uploaded, its scan written as the importer would, and driven. */
  async function ready(posts: readonly (ImportedPost | string)[], over: { images?: Record<string, Uint8Array>; summary?: Partial<Extract<ImportSummary, { status: "scanned" }>> } = {}) {
    const account = await signUp();
    const archive = zipArchive(100);
    const view = await created(account.b, { source: "mastodon", bytes: archive.length });
    await upload(account.b, view.id, archive);
    writeScanOutput(work.root, posts, scanned(view.id, posts.length, over.summary), over.images ?? {});
    await imports.drive(new Date(), { orphans: false });
    const shown = ImportView.parse(await (await account.b.fetch(`/api/imports/${view.id}`)).json());
    expect(shown.status).toBe("ready");
    return { ...account, view: shown };
  }

  /** The row's columns as the migrator reads them. */
  async function row(id: string) {
    const [found] = await migrateDb.execute<{ status: string; received_bytes: string; failure: string | null; scanned_at: Date | null; ended_at: Date | null; uploaded_at: Date | null; scan: unknown; images: boolean }>(
      sql`select status::text as status, received_bytes::text, failure, scanned_at, ended_at, uploaded_at, scan, images from import_jobs where id = ${id}::uuid`,
    );
    return found;
  }

  /** Removes every account the file made, with its imports, and answers the counts, which must be what they were before. */
  async function cleanup(): Promise<{ now: Record<string, number>; before: Record<string, number> }> {
    await removeFixtures(migrateDb, made.splice(0));
    return { now: await rowCounts(apiDb, IMPORT_TABLES), before };
  }

  async function close(): Promise<void> {
    try {
      // The notices and alerts a refusal or a flag started are sent before the pools close.
      await moderation.settle();
      await removeFixtures(migrateDb, made.splice(0));
    } finally {
      rmSync(root, { recursive: true, force: true });
      await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
    }
  }

  const setFree = (bytes: number) => {
    free = bytes;
  };

  return { config, apiDb, migrateDb, app, imports, media, moderation, worker, mailer, rateLimitStore, settings, root, work, archives, made, beat, setFree, signUp, age, create, created, chunk, upload, ready, row, cleanup, close };
}

export type ImportsHarness = Awaited<ReturnType<typeof importsHarness>>;
