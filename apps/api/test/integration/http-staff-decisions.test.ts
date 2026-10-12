import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CaseDecisionResponse, ErrorEnvelope, StaffStepUpOptionsResponse, type AuthenticationResponseJSON, type CaseDecidedParams } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { RULES_VERSION } from "@korbat/rules";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration, type ModerationForStaff } from "../../src/moderation";
import { recordIntake } from "../../src/moderation/intake";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { aPost, act, casesMedia, decisionParams, gate, ground, newPostRow, postRow, removeFixtures, rowCounts, uuids, type DecisionInput } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount, withLockTimeout } from "./staff-fixtures";

// Each test signs a staff key in over HTTP and confirms a decision with it: on a loaded machine that takes longer than
// the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/**
 * POST /api/staff/cases/:case/decisions through the real app (3c design, section 7.5, steps 1 to 3): the console's
 * browser signs in with a staff key, asks for step-up options over exactly the decision's params, has the key confirm
 * them, and posts the params with the assertion. Every decision here is confirmed by a real key, so the audit rows that
 * stay are ones audit-verify accepts; the posts, cases and decisions are removed again, and the file's last test holds it
 * to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: deciding a case over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  let deps: ReturnType<typeof createModeration>["deps"];
  let moderator: Awaited<ReturnType<typeof staffBrowser>>;
  let admin: Awaited<ReturnType<typeof staffBrowser>>;
  /** A moderator whose session began while the auth module's clock stood back, for the tests that issue a challenge with little time left. */
  let slow: Awaited<ReturnType<typeof staffBrowser>>;
  let before: Record<string, number>;
  const staffIds: string[] = [];
  /** How far the auth module's clock stands from the real one, in milliseconds; 0 but where a test sets it back. */
  let skewMs = 0;
  /** What a test runs inside the request, once the step-up verified and before the decision's transaction begins. */
  let insideRequest: (() => Promise<unknown>) | null = null;
  /** How often the route handed a verified confirmation to the moderation module. */
  let decides = 0;

  beforeAll(async () => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    // The real clock, unless a test sets it back: a decision's audit row is stamped by the database and held against the
    // challenge's expiry, which the auth module's clock sets.
    const clock = () => Date.now() + skewMs;
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb), now: () => new Date(clock()) });
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore: new MemoryStore(), config, logger });
    deps = moderation.deps;
    // The staff routes get the moderation module through a wrapper that counts the route's calls and lets a test act
    // inside the request, between the step-up's verification and the decision's own transaction.
    const observed: ModerationForStaff = {
      ...moderation.forStaff,
      decide: async (...args) => {
        decides++;
        const run = insideRequest;
        insideRequest = null;
        await run?.();
        return moderation.forStaff.decide(...args);
      },
    };
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff: createStaff({ apiDb, auth: auth.forStaff, moderation: observed }) });
    moderator = await staffBrowser("moderator");
    admin = await staffBrowser("admin");
    // Signed in nine minutes and twenty seconds back: a challenge issued later under a clock set back by less still finds
    // this session begun.
    skewMs = -560_000;
    try {
      slow = await staffBrowser("moderator");
    } finally {
      skewMs = 0;
    }
    before = await rowCounts(apiDb);
  }, 120_000);
  afterAll(async () => {
    await migrateDb.execute(sql`delete from profiles where id = any(${uuids(staffIds)})`);
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;

  /** A live staff account with a profile and one key enrolled through the flow, signed in from the console's browser. */
  async function staffBrowser(role: "moderator" | "admin") {
    const { user } = await newStaffAccount(authDb, repo, role);
    await apiDb.insert(profiles).values({ id: user.id, handle: `s_${randomUUID().slice(0, 8)}`, displayName: "Staff" });
    staffIds.push(user.id);
    const soft = new SoftAuthenticator();
    const link = await issueEnrolment(migrateDb, user.id);
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    const assert = (challenge: string) => soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: ++counter });
    const b = consoleBrowser();
    const options = await b.fetch("/api/staff/signin/options", { method: "POST" });
    expect(options.status, await options.clone().text()).toBe(200);
    const { challenge } = ((await options.json()) as { options: { challenge: string } }).options;
    const signedIn = await b.fetch("/api/staff/signin/verify", { json: { response: assert(challenge) } });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    return { id: user.id, keyId: enrolled.key.id, role, b, assert };
  }

  /** A committed post reported under this rule, with its open case. Everything is removed after `fn`. */
  async function withReported(fn: (made: { postId: string; caseId: string }) => Promise<void>, rule: "R1" | "R5" = "R1") {
    const [author, reporter] = [await newProfile(apiDb), await newProfile(apiDb)];
    try {
      const postId = await newPostRow(apiDb, author.id);
      const recorded = await recordIntake(deps, { ground: ground.rule(reporter.id, rule), live: [aPost(postId)] });
      await fn({ postId, caseId: recorded.items[0]!.caseId! });
    } finally {
      await removeFixtures(migrateDb, [author.id, reporter.id]);
    }
  }
  /** The key's confirmation of exactly these params on the case, asked for as the console asks for it. */
  async function confirmation(s: typeof moderator, caseId: string, params: CaseDecidedParams): Promise<AuthenticationResponseJSON> {
    const res = await s.b.fetch("/api/staff/step-up/options", { json: { action: "case_decided", target: { type: "case", id: caseId }, params }, headers: MARKED });
    expect(res.status, await res.clone().text()).toBe(200);
    return s.assert(StaffStepUpOptionsResponse.parse(await res.json()).options.challenge);
  }
  const post = (s: typeof moderator, caseId: string, body: unknown) => s.b.fetch(`/api/staff/cases/${caseId}/decisions`, { json: body, headers: MARKED });
  /** The whole exchange: the params as the console builds them, the confirmation, and the decision's request. */
  async function decide(s: typeof moderator, caseId: string, input: DecisionInput) {
    const params = await decisionParams(apiDb, s, caseId, input);
    return post(s, caseId, { ...params, stepUp: await confirmation(s, caseId, params) });
  }
  const decisionsOf = async (caseId: string) => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from decisions where case_id = ${caseId}::uuid`))[0]!.n;

  test("a confirmed decision is answered 201 with its id; it is stored with its measure and its audit row, and its author's mail is pending", async () => {
    await withReported(async ({ postId, caseId }) => {
      const res = await decide(moderator, caseId, { kind: "interim", actions: [act("withhold")] });
      expect(res.status, await res.clone().text()).toBe(201);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { decisionId } = CaseDecisionResponse.parse(await res.json());
      const [stored] = await apiDb.execute<Record<string, unknown>>(sql`
        select d.case_id, d.kind, d.outcome, d.decided_by, d.author_mail,
               (select count(*)::int from decision_actions a where a.decision_id = d.id and a.kind = 'withhold') as measures,
               (select count(*)::int from audit_log l where l.action = 'case_decided' and l.target_id = d.case_id::text and l.metadata ->> 'decisionId' = d.id::text and l.actor_id = d.decided_by and l.step_up is not null) as audits
          from decisions d where d.id = ${decisionId}::uuid`);
      expect({ ...stored! }).toEqual({ case_id: caseId, kind: "interim", outcome: "restricted", decided_by: moderator.id, author_mail: "pending", measures: 1, audits: 1 });
      expect(await postRow(apiDb, postId)).toMatchObject({ state: "withheld", level: "withheld" });
    });
  });

  test("it needs a staff session and the key's confirmation of exactly this decision on exactly this case", async () => {
    await withReported(async ({ postId, caseId }) => {
      await withReported(async (other) => {
        const params = await decisionParams(apiDb, moderator, caseId, { kind: "interim", actions: [act("withhold")] });
        const stepUp = await confirmation(moderator, caseId, params);
        // No session at all.
        const stranger = await consoleBrowser().fetch(`/api/staff/cases/${caseId}/decisions`, { json: { ...params, stepUp }, headers: MARKED, csrf: false });
        expect([stranger.status, (await error(stranger)).code]).toEqual([401, "staff_session_required"]);
        const answers: Record<string, [number, string]> = {};
        const refusedAs = async (label: string, res: Response) => void (answers[label] = [res.status, (await error(res)).code]);
        // No confirmation, and a member the params do not take.
        await refusedAs("no confirmation", await post(moderator, caseId, params));
        await refusedAs("a member the params do not take", await post(moderator, caseId, { ...params, extra: true, stepUp }));
        // The confirmation of this decision does not confirm another one: other params, another case, another person's session.
        await refusedAs("other params", await post(moderator, caseId, { ...params, category: "STATEMENT_CATEGORY_VIOLENCE", stepUp }));
        await refusedAs("another case", await post(moderator, other.caseId, { ...params, stepUp }));
        await refusedAs("another person's session", await post(admin, caseId, { ...params, stepUp }));
        expect(answers).toEqual({
          "no confirmation": [403, "staff_step_up_required"],
          "a member the params do not take": [400, "invalid_request"],
          "other params": [403, "staff_step_up_invalid"],
          "another case": [403, "staff_step_up_invalid"],
          "another person's session": [403, "staff_step_up_invalid"],
        });
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await decisionsOf(other.caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
        // A fresh confirmation of the same params still decides: nothing above spent the decision.
        const fresh = await confirmation(moderator, caseId, params);
        const res = await post(moderator, caseId, { ...params, stepUp: fresh });
        expect(res.status, await res.clone().text()).toBe(201);
        // And a confirmation decides once: its challenge is spent.
        const again = await post(moderator, caseId, { ...params, stepUp: fresh });
        expect([again.status, (await error(again)).code]).toEqual([403, "staff_step_up_invalid"]);
        expect(await decisionsOf(caseId)).toBe(1);
      });
    });
  });

  test("what the database refuses is answered with its code: a case that changed, a decision only an admin takes, a case that does not exist", async () => {
    await withReported(async ({ caseId }) => {
      // The case moved on since the console read it.
      const stale = await decisionParams(apiDb, moderator, caseId, { kind: "interim", actions: [act("withhold")] });
      expect((await decide(moderator, caseId, { kind: "interim", actions: [act("withhold")] })).status).toBe(201);
      const late = await post(moderator, caseId, { ...stale, stepUp: await confirmation(moderator, caseId, stale) });
      expect([late.status, (await error(late)).code]).toEqual([409, "case_changed"]);
      // A final decision on a report under R5 needs an admin.
      const refused = await decide(moderator, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      expect([refused.status, (await error(refused)).code]).toEqual([403, "admin_required"]);
      expect(await decisionsOf(caseId)).toBe(1);
      const taken = await decide(admin, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      expect(taken.status, await taken.clone().text()).toBe(201);
      // A case nobody has: the params are the console's, the id is not.
      const params = await decisionParams(apiDb, admin, caseId, { kind: "correction", reviewsDecisionId: CaseDecisionResponse.parse(await taken.json()).decisionId, actions: [act("restore")] });
      const nowhere = randomUUID();
      const missing = await post(admin, nowhere, { ...params, stepUp: await confirmation(admin, nowhere, params) });
      expect([missing.status, (await error(missing)).code]).toEqual([404, "not_found"]);
    }, "R5");
  });

  test("a key revoked, or an account demoted to user, between the confirmation and the decision's transaction ends the session: 401 with both staff cookies cleared, and nothing stored", async () => {
    type Staff = typeof moderator;
    const ends: [string, (s: Staff) => Promise<unknown>][] = [
      ["the key revoked", (s) => authDb.execute(sql`update auth.staff_keys set revoked_at = now() where id = ${s.keyId}::uuid`)],
      ["the account demoted to user", (s) => authDb.execute(sql`update auth.users set role = 'user' where id = ${s.id}::uuid`)],
    ];
    for (const [label, end] of ends) {
      const leaving = await staffBrowser("moderator");
      try {
        await withReported(async ({ postId, caseId }) => {
          const params = await decisionParams(apiDb, leaving, caseId, { kind: "interim", actions: [act("withhold")] });
          const stepUp = await confirmation(leaving, caseId, params);
          // The change is made inside the request, once requireStaff has read the session live and requireStaffStepUp has
          // verified the confirmation: only the decision's own audit statement can notice it.
          const ran = decides;
          insideRequest = () => end(leaving);
          const res = await post(leaving, caseId, { ...params, stepUp });
          expect(decides - ran, label).toBe(1);
          expect(insideRequest, label).toBeNull();
          expect(res.status, label).toBe(401);
          expect((await error(res.clone())).code, label).toBe("staff_session_required");
          const cleared = res.headers.getSetCookie().filter((line) => line.includes("Max-Age=0")).map((line) => line.slice(0, line.indexOf("=")));
          expect(cleared.sort(), label).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
          expect(await decisionsOf(caseId), label).toBe(0);
          expect(await postRow(apiDb, postId), label).toMatchObject({ state: "visible", level: "visible" });
        });
      } finally {
        staffIds.splice(staffIds.indexOf(leaving.id), 1);
        await migrateDb.execute(sql`delete from profiles where id = ${leaving.id}::uuid`);
      }
    }
  });

  test("a decision under another rulebook than the API serves is answered 422 invalid_decision, and stores nothing", async () => {
    await withReported(async ({ caseId }) => {
      const params = { ...(await decisionParams(apiDb, moderator, caseId, { kind: "interim", actions: [act("withhold")] })), rulesVersion: RULES_VERSION - 1 };
      const ran = decides;
      const res = await post(moderator, caseId, { ...params, stepUp: await confirmation(moderator, caseId, params) });
      // The key confirmed it and the route handed it over: the moderation module refuses it before it reads or writes.
      expect(decides - ran).toBe(1);
      expect([res.status, (await error(res)).code]).toEqual([422, "invalid_decision"]);
      expect(await decisionsOf(caseId)).toBe(0);
    });
  });

  describe("a decision that waits for a lock", () => {
    /** The key's confirmation of the params, its challenge issued so that about `seconds` of its ten minutes are left now. */
    async function confirmationWithLeft(caseId: string, params: CaseDecidedParams, seconds: number) {
      skewMs = -(600 - seconds) * 1000;
      try {
        return await confirmation(slow, caseId, params);
      } finally {
        skewMs = 0;
      }
    }
    /**
     * Posts the decision while a transaction of the migrator holds the audit chain's head, which every decision's last
     * statement waits for, and notes each transaction it sees waiting there (by the time it began). `during` runs while the
     * request is under way and may let the head go; it goes in any case once the request is answered.
     */
    async function postBehindHead(caseId: string, body: unknown, during: (waiting: Set<string>, letGo: () => Promise<void>) => Promise<void>) {
      const [held, release] = [gate(), gate()];
      const holder = withLockTimeout(migrateDb, async (tx) => {
        await tx.execute(sql`select 1 from public.audit_head where id = 1 for update`);
        held.open();
        await release.opened;
      });
      await held.opened;
      const letGo = async () => {
        release.open();
        await holder;
      };
      const waiting = new Set<string>();
      let watching = true;
      const watch = (async () => {
        while (watching) {
          const rows = await apiDb.execute<{ began: string }>(
            sql`select xact_start::text as began from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like '%append_confirmed_audit%'`,
          );
          for (const row of rows) waiting.add(row.began);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })();
      try {
        const posting = post(slow, caseId, body);
        await during(waiting, letGo);
        return { res: await posting, waiting };
      } finally {
        watching = false;
        await watch;
        await letGo();
      }
    }
    const until = async (condition: () => boolean, what: string) => {
      const deadline = Date.now() + 40_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`nothing came of waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const withhold: DecisionInput = { kind: "interim", actions: [act("withhold")] };

    test("a lock timeout is retried once with the same confirmation, and the second run commits: 201 and one decision", async () => {
      await withReported(async ({ postId, caseId }) => {
        const params = await decisionParams(apiDb, slow, caseId, withhold);
        const stepUp = await confirmationWithLeft(caseId, params, 75);
        const ran = decides;
        const { res, waiting } = await postBehindHead(caseId, { ...params, stepUp }, async (seen, letGo) => {
          // The first run's wait is bounded by a fifteenth of the 75 seconds left. The second run waits in a transaction
          // of its own; then the head is let go.
          await until(() => seen.size === 2, "the second run to wait for the head");
          await letGo();
        });
        expect(res.status, await res.clone().text()).toBe(201);
        expect(waiting.size).toBe(2);
        // One confirmation, handed over once: the second run is the moderation module's own.
        expect(decides - ran).toBe(1);
        expect(await decisionsOf(caseId)).toBe(1);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "withheld", level: "withheld" });
      });
    });

    test("a second lock timeout is answered 400 challenge_expired, with nothing written", async () => {
      await withReported(async ({ postId, caseId }) => {
        const params = await decisionParams(apiDb, slow, caseId, withhold);
        const stepUp = await confirmationWithLeft(caseId, params, 75);
        // The head is held through both runs.
        const { res, waiting } = await postBehindHead(caseId, { ...params, stepUp }, async () => undefined);
        expect([res.status, (await error(res)).code]).toEqual([400, "challenge_expired"]);
        expect(waiting.size).toBe(2);
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
      });
    });

    test("a lock timeout met with a minute or less of the challenge left is not retried: 400 challenge_expired after the one run, with nothing written", async () => {
      await withReported(async ({ postId, caseId }) => {
        const params = await decisionParams(apiDb, slow, caseId, withhold);
        // 64 seconds: the step-up itself is refused within a minute of the expiry, so the decision starts with a little
        // more than that, and its one bounded wait, a fifteenth of what is left, ends with less than a minute to go.
        const stepUp = await confirmationWithLeft(caseId, params, 64);
        const { res, waiting } = await postBehindHead(caseId, { ...params, stepUp }, async () => undefined);
        expect([res.status, (await error(res)).code]).toEqual([400, "challenge_expired"]);
        expect(waiting.size).toBe(1);
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
