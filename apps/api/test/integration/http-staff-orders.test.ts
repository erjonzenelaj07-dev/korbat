import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ErrorEnvelope, OrderView, OrdersPage, StaffMe, StaffStepUpOptionsResponse, type AuthenticationResponseJSON } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration, type Moderation } from "../../src/moderation";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { CHANNEL_TABLES, casesMedia, removeFixtures, rowCounts } from "./moderation-fixtures";
import { closeNotifyFixtures, contactMessageForTest, removeMessages } from "./notify-fixtures";
import { ORDER_TABLES, disableItemForTest, removeOrderAlerts, removeOrders } from "./orders-fixtures";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

vi.setConfig({ testTimeout: 90_000 });

const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
const MARKED = { "x-staff-activity": "1" };

/**
 * The routes of order records through the real app (3f design, sections 7.4, 7.5, 10.2 and 10.3; invariants 10, 24 and
 * 25 over HTTP): every route behind the staff session; an order opened with and without a message, without a key, 201
 * with its view; order_exists with the order that stands; links added; the list and one order, 404 for an unknown one; a
 * clock event under the step-up order_event_recorded, refused without it, an admin's closing refused to a moderator; a
 * correction without a key under entry and caution, and under admin only with the step-up order_corrected
 * (staff_step_up_required without it). /api/staff/me carries the home state and the contact point. Every answer is held
 * to its contract, and the last test to leaving no row behind but the audit rows.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the order routes over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let moderation: Moderation;
  let app: ReturnType<typeof createApp>;
  let moderator: Awaited<ReturnType<typeof staffBrowser>>;
  let admin: Awaited<ReturnType<typeof staffBrowser>>;
  let before: Record<string, number>;
  const staffIds: string[] = [];
  const orders: string[] = [];
  const messages: string[] = [];
  const started = new Date();

  beforeAll(async () => {
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "", HOME_STATE: "DE", CONTACT_POINT: "authorities@korbat.example" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb) });
    const rateLimitStore = new MemoryStore();
    moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore, config, logger });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, staff: createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff }), moderation });
    moderator = await staffBrowser("moderator");
    admin = await staffBrowser("admin");
    // Counted once the staff and the profiles stand: they leave in afterAll, after the last count.
    before = await rowCounts(apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES]);
  }, 120_000);
  afterAll(async () => {
    await moderation.settle();
    await removeOrders(migrateDb, orders);
    await removeMessages(migrateDb, messages);
    await removeFixtures(migrateDb, staffIds);
    await closeNotifyFixtures();
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  const refusal = async (res: Response): Promise<[number, string]> => [res.status, ErrorEnvelope.parse(await res.json()).error.code];
  async function held<T>(schema: { parse(raw: unknown): T }, res: Response): Promise<T> {
    expect([200, 201], await res.clone().text()).toContain(res.status);
    const raw = await res.json();
    const read = schema.parse(raw);
    expect(raw).toStrictEqual(read);
    return read;
  }

  /** A staff account with a profile and one key enrolled through the flow, signed in from the console's browser. */
  async function staffBrowser(role: "moderator" | "admin") {
    const { user } = await newStaffAccount(authDb, repo, role);
    await apiDb.insert(profiles).values({ id: user.id, handle: `o_${randomUUID().slice(0, 8)}`, displayName: "Staff" });
    staffIds.push(user.id);
    const soft = new SoftAuthenticator();
    const link = await issueEnrolment(migrateDb, user.id);
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    const assert = (challenge: string) => soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: ++counter });
    const b = consoleBrowser();
    const options = await b.fetch("/api/staff/signin/options", { method: "POST" });
    const { challenge } = ((await options.json()) as { options: { challenge: string } }).options;
    const signedIn = await b.fetch("/api/staff/signin/verify", { json: { response: assert(challenge) } });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    return { id: user.id, b, assert };
  }
  type Staff = typeof moderator;
  /** The key's confirmation of exactly this action on the order, asked for as the console asks for it. */
  async function confirmation(s: Staff, action: "order_event_recorded" | "order_corrected", orderId: string, params: unknown): Promise<AuthenticationResponseJSON> {
    const res = await s.b.fetch("/api/staff/step-up/options", { json: { action, target: { type: "order", id: orderId }, params }, headers: MARKED });
    expect(res.status, await res.clone().text()).toBe(200);
    return s.assert(StaffStepUpOptionsResponse.parse(await res.json()).options.challenge);
  }
  const openBody = (over: Record<string, unknown> = {}) => ({
    messageId: null,
    channel: "portal",
    kind: "tco_removal",
    memberState: "DE",
    authority: "Bundeskriminalamt",
    reference: `HTTP-${randomUUID()}`,
    links: ["https://elsewhere.example/http"],
    sectionC: false,
    emergency: false,
    withholdFromAuthor: true,
    ...over,
  });
  const open = async (s: Staff, over: Record<string, unknown> = {}) => {
    const view = await held(OrderView, await s.b.fetch("/api/staff/orders", { json: openBody(over), headers: MARKED }));
    orders.push(view.id);
    return view;
  };
  const event = async (s: Staff, orderId: string, params: { kind: string; ground: string | null; messageId: string | null }, keyed = true) =>
    s.b.fetch(`/api/staff/orders/${orderId}/events`, { json: keyed ? { ...params, stepUp: await confirmation(s, "order_event_recorded", orderId, params) } : params, headers: MARKED });
  const correct = async (s: Staff, orderId: string, facts: Record<string, unknown>, keyed = false) =>
    s.b.fetch(`/api/staff/orders/${orderId}/correct`, { json: keyed ? { facts, stepUp: await confirmation(s, "order_corrected", orderId, { facts }) } : { facts }, headers: MARKED });

  test("every order route needs a staff session", async () => {
    const b = consoleBrowser();
    const id = randomUUID();
    for (const [path, init] of [
      ["/api/staff/orders", undefined],
      [`/api/staff/orders/${id}`, undefined],
      ["/api/staff/orders", { json: openBody() }],
      [`/api/staff/orders/${id}/items`, { json: { links: ["https://elsewhere.example/x"] } }],
      [`/api/staff/orders/${id}/events`, { json: { kind: "annex3_sent", ground: "manifest_error", messageId: null } }],
      [`/api/staff/orders/${id}/correct`, { json: { facts: { emergency: true } } }],
    ] as const) {
      expect(await refusal(await b.fetch(path, init as never)), path).toEqual([401, "staff_session_required"]);
    }
  });

  test("/api/staff/me carries the home state and the contact point", async () => {
    const me = await held(StaffMe, await moderator.b.fetch("/api/staff/me"));
    expect([me.homeState, me.contactPoint]).toEqual(["DE", "authorities@korbat.example"]);
  });

  test("an order opened from a message and without one, without a key; the list and the read; an unknown order is 404; the same reference again is order_exists with the order that stands", async () => {
    const m = await contactMessageForTest(new Date(Date.now() - 60_000), "inbox");
    messages.push(m);
    const fromMessage = await open(moderator, { messageId: m, channel: "mailbox" });
    expect([fromMessage.channel, fromMessage.receivedAt !== null, fromMessage.state, fromMessage.openedBy]).toEqual(["mailbox", true, "running", expect.stringMatching(/^o_/)]);
    const without = await open(moderator, { kind: "dsa_art9", withholdFromAuthor: false, channel: "other" });
    expect([without.channel, without.receivedAt, without.state, without.clock]).toEqual(["other", null, "no_clock", null]);
    const page = await held(OrdersPage, await moderator.b.fetch("/api/staff/orders", { headers: MARKED }));
    expect(page.open.map((o) => o.id)).toEqual(expect.arrayContaining([fromMessage.id, without.id]));
    expect((await held(OrderView, await moderator.b.fetch(`/api/staff/orders/${fromMessage.id}`))).id).toBe(fromMessage.id);
    expect(await refusal(await moderator.b.fetch(`/api/staff/orders/${randomUUID()}`))).toEqual([404, "not_found"]);
    const again = await moderator.b.fetch("/api/staff/orders", { json: openBody({ reference: fromMessage.reference }), headers: MARKED });
    const body = ErrorEnvelope.parse(await again.json());
    expect([again.status, body.error.code, body.error.details]).toEqual([409, "order_exists", { orderId: fromMessage.id }]);
    // A request that would hold a notice on a post its author sees is refused by the schema.
    expect(await refusal(await moderator.b.fetch("/api/staff/orders", { json: openBody({ sectionC: true, withholdFromAuthor: false, kind: "dsa_art9" }), headers: MARKED }))).toEqual([400, "invalid_request"]);
  });

  test("links are added without a key", async () => {
    const order = await open(moderator);
    const added = await held(OrderView, await moderator.b.fetch(`/api/staff/orders/${order.id}/items`, { json: { links: ["https://elsewhere.example/more"] }, headers: MARKED }));
    expect(added.items.map((i) => i.position)).toEqual([1, 2]);
  });

  test("a clock event needs its step-up; an Annex III stops the clock and a clarification with its message starts a fresh hour; a closing is an admin's", async () => {
    const order = await open(moderator);
    expect(await refusal(await event(moderator, order.id, { kind: "annex3_sent", ground: "manifest_error", messageId: null }, false))).toEqual([403, "staff_step_up_required"]);
    const stopped = await held(OrderView, await event(moderator, order.id, { kind: "annex3_sent", ground: "manifest_error", messageId: null }));
    expect([stopped.state, stopped.clock!.stopped, stopped.clock!.stopGround, stopped.clock!.deadlineAt]).toEqual(["stopped", true, "manifest_error", null]);
    expect(stopped.mayEvents).toContain("clarification_received");
    expect(await refusal(await event(moderator, order.id, { kind: "grounds_ceased", ground: null, messageId: null }))).toEqual([422, "order_event_refused"]);
    const m = await contactMessageForTest(new Date(), "inbox");
    messages.push(m);
    const restarted = await held(OrderView, await event(moderator, order.id, { kind: "clarification_received", ground: null, messageId: m }));
    expect([restarted.state, restarted.clock!.stopped]).toEqual(["running", false]);
    expect(restarted.events.map((e) => e.kind)).toEqual(["opened", "annex3_sent", "clarification_received"]);
    expect(await refusal(await event(moderator, order.id, { kind: "closed_without_effect", ground: "withdrawn", messageId: null }))).toEqual([403, "admin_required"]);
    const closed = await held(OrderView, await event(admin, order.id, { kind: "closed_without_effect", ground: "withdrawn", messageId: null }));
    expect([closed.state, closed.closeGround, closed.mayCorrect]).toEqual(["closed", "withdrawn", null]);
    expect(await refusal(await moderator.b.fetch(`/api/staff/orders/${order.id}/items`, { json: { links: ["https://elsewhere.example/late"] }, headers: MARKED }))).toEqual([409, "order_closed"]);
    const reopened = await held(OrderView, await event(admin, order.id, { kind: "reopened", ground: null, messageId: null }));
    expect(reopened.closedAt).toBeNull();
  });

  test("a correction: entry without a key; after an effect, caution without one, and admin only with the step-up order_corrected", async () => {
    const order = await open(moderator, { kind: "dsa_art9", withholdFromAuthor: false, links: ["https://elsewhere.example/c1", "https://elsewhere.example/c2"] });
    const entry = await held(OrderView, await correct(moderator, order.id, { reference: `${order.reference}-fixed` }));
    expect(entry.events.at(-1)).toMatchObject({ kind: "corrected", ground: "entry" });
    await disableItemForTest(migrateDb, order.items[0]!.id);
    expect(await refusal(await correct(moderator, order.id, { emergency: true }))).toEqual([403, "admin_required"]);
    expect(await refusal(await correct(admin, order.id, { emergency: true }))).toEqual([403, "staff_step_up_required"]);
    const keyed = await held(OrderView, await correct(admin, order.id, { emergency: true }, true));
    expect([keyed.emergency, keyed.events.at(-1)!.ground]).toEqual([true, "admin"]);
    const caution = await held(OrderView, await correct(moderator, order.id, { sectionC: true }));
    expect([caution.sectionC, caution.withholdFromAuthor, caution.events.at(-1)!.ground]).toEqual([true, true, "caution"]);
    expect(await refusal(await correct(moderator, order.id, { openedBy: "x" } as never))).toEqual([400, "invalid_request"]);
  });

  test("leaves no row behind but the audit rows", async () => {
    await moderation.settle();
    await removeOrders(migrateDb, orders.splice(0));
    await removeMessages(migrateDb, messages.splice(0));
    await removeOrderAlerts(migrateDb, started);
    expect(await rowCounts(apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
  });
});
