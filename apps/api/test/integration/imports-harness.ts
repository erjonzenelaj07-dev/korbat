import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import pino from "pino";
import { expect } from "vitest";
import { FlowResponse, IMPORT_RULES, ImportView, MeResponse, StaffStepUpOptionsResponse, type ImportChoice, type ImportSummary, type ImportedPost, type StaffStepUpOptionsRequest } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { writeScanOutput } from "@korbat/import-protocol";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { createAuthRepo } from "../../src/auth/repo";
import { createImports, importSettingsFrom, importsForModeration, type ImportSettings } from "../../src/imports";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia, matchAdapterFrom, type MatchAdapter } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { fakeWorker } from "./media-harness";
import { removeFixtures, rowCounts } from "./moderation-fixtures";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

/**
 * The imports module through the real app (3b design, section 12.3): sign-up over HTTP, cookie sessions with CSRF, the
 * auth, social and imports modules wired as the server wires them, the two import volumes in a temporary folder, and
 * packages/import-protocol's writeScanOutput standing in for the importer, as fakeWorker stands in for the image worker.
 * 3b Task 5: the media module over two volumes of its own, with the test matcher unless a test gives another (the media
 * tests' closed site), and fakeWorker on its store; the moderation module as the server builds it, handed to the media
 * module as its handler of refusals; and the profile store, which the confirmation asks about a suspension.
 * 3b Task 6: the social module with the media module's images and the moderation module's chip, as the server wires it,
 * so the publisher attaches kept images through it; the moderation module reads an import's size through the imports
 * module's own factory; and, with `console`, the staff console's routes at the test console's address, with the imports
 * module's staff interface, and staff accounts signed in from the console's browser.
 */

/** The tables a file of these tests must leave as it found them. */
export const IMPORT_TABLES = ["import_jobs", "import_picks", "import_keys"];

/**
 * 3b Task 6: the three import tables' rows alone, for a file outside these tests that writes import rows of its own and
 * leaves its other rows, as the social and account suites do: what it must leave as it found them.
 */
export async function importCounts(db: Db): Promise<Record<string, number>> {
  const all = await rowCounts(db, IMPORT_TABLES);
  return Object.fromEntries(IMPORT_TABLES.map((table) => [table, all[table]!]));
}
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
  /** 3b Task 6: the staff console's routes at the test console's address (CONSOLE_ORIGIN set), and staffBrowser. */
  console?: boolean;
}

/** Everything, without images: the choice of the publishing tests unless one says otherwise. */
export const ALL: ImportChoice = { from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" };

export async function importsHarness(options: HarnessOptions = {}) {
  const config: Config = options.console ? loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" }) : loadConfig();
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
  const moderation = createModeration({
    apiDb,
    auth: auth.forModeration,
    social: socialForModeration(apiDb),
    media: media.forCases,
    imports: importsForModeration(apiDb),
    requireSession: auth.requireSession,
    rateLimitStore,
    config,
    logger,
  });
  media.onMatch(moderation.matched);
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, moderation: moderation.forSocial });
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
  const staff = options.console ? createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff, imports: imports.forStaff }) : undefined;
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, imports, ...(staff ? { staff, moderation } : {}) });
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

  /** POST /api/imports/<id>/confirm with the statement. */
  const confirm = (b: Browser, id: string, choice: ImportChoice = ALL) => b.fetch(`/api/imports/${id}/confirm`, { method: "POST", json: { choice, statement: true } });

  /**
   * 3b Task 6: an import of a new account brought to ready with these lines, confirmed with the choice (everything,
   * without images, unless said), and driven until it is no longer publishing, each round a second after the last.
   */
  async function published(posts: readonly ImportedPost[], choice: ImportChoice = ALL, over: { summary?: Partial<Extract<ImportSummary, { status: "scanned" }>> } = {}) {
    const r = await ready(posts, over);
    const res = await confirm(r.b, r.view.id, choice);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    let at = Date.now();
    for (let round = 0; round < 60; round++) {
      await imports.drive(new Date((at += 1_000)), { orphans: false });
      const [state] = await migrateDb.execute<{ status: string }>(sql`select status::text as status from import_jobs where id = ${r.view.id}::uuid`);
      if (state!.status !== "publishing") break;
    }
    const view = ImportView.parse(await (await r.b.fetch(`/api/imports/${r.view.id}`)).json());
    return { ...r, view };
  }

  /**
   * 3b Task 6, with `console`: a live staff account with a profile and one key enrolled through the flow, signed in from
   * the console's browser, as the console's case tests make one. `stepUp` asks for step-up options for a request and
   * answers the key's assertion of them.
   */
  async function staffBrowser(role: "moderator" | "admin") {
    if (!options.console) throw new Error("staffBrowser needs the harness's console");
    const repo = createAuthRepo(authDb);
    const { user } = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    made.push(user.id);
    const soft = new SoftAuthenticator();
    const link = await issueEnrolment(migrateDb, user.id);
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    const assert = (challenge: string) => soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: ++counter });
    const b = new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: "__Host-korbat_staff_csrf", csrfHeader: "x-staff-csrf" });
    const signInOptions = await b.fetch("/api/staff/signin/options", { method: "POST" });
    expect(signInOptions.status, await signInOptions.clone().text()).toBe(200);
    const { challenge } = ((await signInOptions.json()) as { options: { challenge: string } }).options;
    const signedIn = await b.fetch("/api/staff/signin/verify", { json: { response: assert(challenge) } });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    /** The mark the console sends on a request its person's action started (3a design, section 7). */
    const marked = { "x-staff-activity": "1" };
    async function stepUp(request: StaffStepUpOptionsRequest) {
      const res = await b.fetch("/api/staff/step-up/options", { json: request, headers: marked });
      expect(res.status, await res.clone().text()).toBe(200);
      return assert(StaffStepUpOptionsResponse.parse(await res.json()).options.challenge);
    }
    return { id: user.id, email: user.email, handle, keyId: enrolled.key.id, role, b, stepUp, marked };
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

  return {
    config,
    apiDb,
    migrateDb,
    app,
    imports,
    media,
    moderation,
    social,
    worker,
    mailer,
    rateLimitStore,
    settings,
    root,
    work,
    archives,
    made,
    beat,
    setFree,
    signUp,
    age,
    create,
    created,
    chunk,
    upload,
    ready,
    confirm,
    published,
    staffBrowser,
    row,
    cleanup,
    close,
  };
}

export type ImportsHarness = Awaited<ReturnType<typeof importsHarness>>;
