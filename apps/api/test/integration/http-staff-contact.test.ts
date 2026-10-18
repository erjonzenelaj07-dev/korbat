import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CONTACT_PAGE_SIZE, ContactPage, ErrorEnvelope, StaffOverview } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { CHANNEL_TABLES, casesMedia, removeFixtures, rowCounts } from "./moderation-fixtures";
import { closeNotifyFixtures, contactMessageForTest, outboxOf, removeMessages } from "./notify-fixtures";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount, rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 90_000 });

const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
const MARKED = { "x-staff-activity": "1" };

/**
 * The contact point's routes through the real app (3f design, sections 7.3, 8.3 and 10.2): GET /api/staff/contact, the
 * messages newest first with no sender and no subject, a page at a time, and only the open ones with open=1; and POST
 * /api/staff/contact/:message/close, which sets a disposition other than order once, without a key, with its audit row
 * contact_closed, and answers 409 message_handled for a message that has one and 404 for an id no message has. The home
 * screen's overview counts the messages nobody handled. The file's last test holds it to leaving no row behind but the
 * audit rows, which stay as audit-verify reads them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the contact point's routes over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  let moderator: Awaited<ReturnType<typeof staffBrowser>>;
  let before: Record<string, number>;
  const profileIds: string[] = [];
  const made: string[] = [];

  beforeAll(async () => {
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(apiDb, CHANNEL_TABLES);
    repo = createAuthRepo(authDb);
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb) });
    const rateLimitStore = new MemoryStore();
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore, config, logger });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, staff: createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff }), moderation });
    moderator = await staffBrowser();
  }, 120_000);
  afterAll(async () => {
    await removeMessages(migrateDb, made.splice(0));
    await removeFixtures(migrateDb, profileIds);
    await closeNotifyFixtures();
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  const answered = async (res: Response): Promise<[number, string]> => [res.status, ErrorEnvelope.parse(await res.json()).error.code];
  /** An answer held to its contract: what the schema reads from the raw JSON is all the JSON holds. */
  async function held<T>(schema: { parse(raw: unknown): T }, res: Response): Promise<T> {
    const raw = await res.json();
    const read = schema.parse(raw);
    expect(raw).toStrictEqual(read);
    return read;
  }

  /** A moderator with a profile and one key enrolled through the flow, signed in from the console's browser. */
  async function staffBrowser() {
    const { user } = await newStaffAccount(authDb, repo, "moderator");
    const handle = `c_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    profileIds.push(user.id);
    const soft = new SoftAuthenticator();
    const link = await issueEnrolment(migrateDb, user.id);
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    const b = consoleBrowser();
    const options = await b.fetch("/api/staff/signin/options", { method: "POST" });
    const { challenge } = ((await options.json()) as { options: { challenge: string } }).options;
    const signedIn = await b.fetch("/api/staff/signin/verify", {
      json: { response: soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 1 }) },
    });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    return { id: user.id, handle, b };
  }
  const message = async (receivedAt: Date, folder: "inbox" | "junk" = "inbox") => {
    const id = await contactMessageForTest(receivedAt, folder);
    made.push(id);
    return id;
  };
  const list = async (query = "") => held(ContactPage, await moderator.b.fetch(`/api/staff/contact${query}`, { headers: MARKED }));
  const close = (id: string, disposition: unknown) => moderator.b.fetch(`/api/staff/contact/${id}/close`, { json: { disposition }, headers: MARKED });

  test("both routes need a staff session", async () => {
    const id = await message(new Date());
    const b = consoleBrowser();
    expect(await answered(await b.fetch("/api/staff/contact"))).toEqual([401, "staff_session_required"]);
    expect(await answered(await b.fetch(`/api/staff/contact/${id}/close`, { json: { disposition: "not_an_order" } }))).toEqual([401, "staff_session_required"]);
  });

  test("the list: newest first by the time of receipt, each with its folder, its times and whether it is stale; no sender, no subject", async () => {
    const now = Date.now();
    const older = await message(new Date(now - 3 * 60 * 60_000), "junk");
    const newer = await message(new Date(now - 60_000));
    const page = await list();
    const ours = page.items.filter((m) => m.id === older || m.id === newer);
    expect(ours.map((m) => [m.id, m.folder, m.stale, m.disposition, m.handledBy, m.orders])).toEqual([
      [newer, "inbox", false, null, null, []],
      [older, "junk", true, null, null, []],
    ]);
    const received = page.items.map((m) => Date.parse(m.receivedAt));
    expect([...received].sort((a, b) => b - a)).toEqual(received);
  });

  test("a page holds CONTACT_PAGE_SIZE messages, and the cursor reads on without a gap or a repeat; a cursor the API did not write is refused", async () => {
    const base = Date.now() - 24 * 60 * 60_000;
    for (let i = 0; i < CONTACT_PAGE_SIZE + 3; i++) await message(new Date(base - i * 1_000));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ContactPage = await list(cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`);
      expect(page.items.length).toBeLessThanOrEqual(CONTACT_PAGE_SIZE);
      seen.push(...page.items.map((m) => m.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of made) expect(seen).toContain(id);
    expect(await answered(await moderator.b.fetch("/api/staff/contact?cursor=bm90LWEtY3Vyc29y", { headers: MARKED }))).toEqual([400, "invalid_request"]);
    expect(await answered(await moderator.b.fetch("/api/staff/contact?open=0", { headers: MARKED }))).toEqual([400, "invalid_request"]);
  });

  test("closing: a disposition other than order, once, without a key, with its audit row; the message then lists as handled by its staff handle", async () => {
    const id = await message(new Date(Date.now() - 5 * 60_000));
    const res = await close(id, "not_an_order");
    expect(res.status, await res.clone().text()).toBe(204);
    const [audit] = await migrateDb.execute<{ actor_id: string; target_type: string; target_id: string; metadata: Record<string, unknown>; key_id: string | null }>(
      sql`select actor_id, target_type, target_id, metadata, key_id from public.audit_log where action = 'contact_closed' and target_id = ${id} order by chain_seq desc limit 1`,
    );
    const [stored] = await migrateDb.execute<{ received_at: string; handled_by: string; handled_at: string | null }>(sql`select received_at, handled_by, handled_at from public.contact_messages where id = ${id}::uuid`);
    expect(audit).toEqual({ actor_id: moderator.id, target_type: "contact_message", target_id: id, metadata: { disposition: "not_an_order", receivedAt: new Date(stored!.received_at).toISOString(), folder: "inbox" }, key_id: null });
    expect(stored!.handled_by).toBe(moderator.id);
    expect(stored!.handled_at).not.toBeNull();
    const listed = (await list()).items.find((m) => m.id === id)!;
    expect([listed.disposition, listed.handledBy]).toEqual(["not_an_order", moderator.handle]);
    expect(listed.handledAt).not.toBeNull();
    // Only the open ones with open=1.
    expect((await list("?open=1")).items.map((m) => m.id)).not.toContain(id);
  });

  test("a message that has a disposition is 409 message_handled, an unknown id 404, order and any other word 400, an id not in lower case 400", async () => {
    const id = await message(new Date());
    expect((await close(id, "referral")).status).toBe(204);
    expect(await answered(await close(id, "not_an_order"))).toEqual([409, "message_handled"]);
    expect(await answered(await close(randomUUID(), "referral"))).toEqual([404, "not_found"]);
    const open = await message(new Date());
    expect(await answered(await close(open, "order"))).toEqual([400, "invalid_request"]);
    expect(await answered(await close(open, "spam"))).toEqual([400, "invalid_request"]);
    expect(await answered(await close(open.toUpperCase(), "referral"))).toEqual([400, "invalid_request"]);
    expect((await migrateDb.execute<{ disposition: string | null }>(sql`select disposition from public.contact_messages where id = ${open}::uuid`))[0]!.disposition).toBeNull();
  });

  test("closing ends the message's alerts: the steps write nothing for it any more", async () => {
    const id = await message(new Date());
    await migrateDb.execute(sql`update public.contact_messages set received_at = received_at - interval '61 minutes' where id = ${id}::uuid`);
    expect((await close(id, "clarification")).status).toBe(204);
    // In a transaction that is rolled back: the steps would also write the day's test, which this file must not leave.
    await rolledBack(apiDb, async (tx) => {
      await tx.execute(sql`select public.alert_steps()`);
      expect((await outboxOf(tx, id)).filter((r) => r.kind !== "contact_mail")).toEqual([]);
    });
  });

  test("the home screen counts the messages nobody handled", async () => {
    const id = await message(new Date(Date.now() - 10 * 60_000));
    const overview = await held(StaffOverview, await moderator.b.fetch("/api/staff/overview", { headers: MARKED }));
    expect(overview.contact.open).toBeGreaterThanOrEqual(1);
    expect(overview.contact.dueAt).not.toBeNull();
    expect(overview.alerts.channel).toBe(config.NOTIFY === "off" ? "off" : overview.alerts.channel);
    expect((await close(id, "not_an_order")).status).toBe(204);
    const after = await held(StaffOverview, await moderator.b.fetch("/api/staff/overview", { headers: MARKED }));
    expect(after.contact.open).toBe(overview.contact.open - 1);
  });

  test("leaves no row behind", async () => {
    await removeMessages(migrateDb, made.splice(0));
    await removeFixtures(migrateDb, profileIds.splice(0));
    expect(await rowCounts(apiDb, CHANNEL_TABLES)).toEqual(before);
  });
});
