import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ErrorEnvelope, FlowResponse, NoticeResponse, NoticeStatus, type NoticeRequest } from "@korbat/contracts";
import { randomToken } from "../../src/auth/crypto";
import { Browser, NativeClient } from "./http-client";
import { newPostRow } from "./moderation-fixtures";
import { HUMAN, accountTarget, linkTarget, notices, noticesWorld, postTarget, type NoticesWorld } from "./notices-harness";

// Each test signs accounts up over HTTP and waits for the mails a notice starts: on a loaded machine that takes longer
// than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

const HOUR = 60 * 60_000;

/**
 * POST /api/notices, /api/notices/status and /api/notices/contact through the real app (3c design, sections 7.1, 7.2 and
 * 12): a session is optional, so the same route answers a browser without cookies, a signed-in browser with its CSRF
 * token, and a client that sends neither cookie nor Origin; the human check, the limits per network and every refusal
 * code as HTTP answers them. What the flows store is tested in moderation-notices.test.ts. Every test commits, and what
 * it stored is removed after it; the file's last test holds the tables to what they held before it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: reports and notices over HTTP", () => {
  let w: NoticesWorld;
  let origin: string;
  let before: Record<string, number>;

  beforeAll(async () => {
    w = noticesWorld();
    origin = w.config.APP_ORIGIN;
    before = await w.counts();
  });
  afterAll(async () => {
    await w.close();
  });
  beforeEach(() => {
    w.mailer.mode = "deliver";
    w.mailer.attempts.length = 0;
    w.mailer.sent.length = 0;
    // Past every hourly window of the limit store and the urgent alert's throttle.
    w.ahead.limitsMs += HOUR;
  });
  afterEach(async () => {
    await w.cleanUp();
  });

  const browser = (ip?: string) => new Browser(w.app, origin, { ip });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const send = (b: Browser | NativeClient, body: unknown) => b.fetch("/api/notices", { json: body });
  /** A stored notice's answer, remembered for the cleanup. */
  const stored = async (res: Response) => {
    expect(res.status, await res.clone().text()).toBe(201);
    return w.remember(NoticeResponse.parse(await res.json()));
  };
  const missingPost = () => linkTarget(`${origin}/post/${randomUUID()}`);
  const withoutToken = (request: NoticeRequest) => {
    const { turnstileToken: _token, ...rest } = request;
    return rest;
  };

  /** A browser signed in over HTTP; with `onboard` false the account has not chosen a handle yet. */
  async function signUp(onboard = true) {
    const b = browser();
    const email = `notice-${randomUUID()}@korbat.local`;
    const handle = `h${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: HUMAN, deviceId: randomToken(), platform: "web" } });
    expect(start.status, await start.clone().text()).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: w.mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: w.config.TERMS_VERSION } })).status).toBe(200);
    let id: string | null = null;
    if (onboard) {
      expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
      id = (await w.migrateDb.execute<{ id: string }>(sql`select id from profiles where handle = ${handle}`))[0]!.id;
      w.profileIds.push(id);
    }
    return { b, email, handle, id };
  }

  /** An account with a post, as fixtures make them: the target of the reports below. */
  async function reported() {
    const author = await w.account();
    return { author, postId: await newPostRow(w.apiDb, author.id) };
  }

  test("the four routes are the module's whole surface under /api/notices, each a POST: nothing acts when an address is merely opened", async () => {
    const routes = w.app.routes.filter((route) => route.path.startsWith("/api/notices") && route.method !== "ALL").map((route) => `${route.method} ${route.path}`);
    expect([...new Set(routes)].sort()).toEqual(["POST /api/notices", "POST /api/notices/contact", "POST /api/notices/reexamine", "POST /api/notices/status"]);
    for (const path of ["/api/notices", "/api/notices/status", "/api/notices/contact", "/api/notices/reexamine", "/api/notices/N-ABCDEFGH23"]) {
      const res = await w.app.request(path);
      expect(res.status, path).toBe(404);
      expect((await error(res)).code, path).toBe("not_found");
    }
  });

  test("signed out, a rule report and a notice on the path for child sexual abuse material are refused without a token the human check passes, and taken with one", async () => {
    const { postId } = await reported();
    for (const request of [notices.rule([postTarget(postId)]), notices.csam([postTarget(postId)]), notices.illegal([postTarget(postId)])]) {
      for (const body of [withoutToken(request), { ...request, turnstileToken: "not-human" }]) {
        const res = await send(browser(), body);
        expect(res.status).toBe(403);
        // The API holds no contact address: the app words this code itself, with the users' address.
        expect(await error(res)).toMatchObject({ code: "human_check_failed", message: "We could not verify that you are human. Try again." });
      }
      const res = await send(browser(), request);
      const answer = await stored(res);
      expect(answer.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("a signed-out notice passes the app's site with its Origin checked and no CSRF token; another site's page cannot send one", async () => {
    const { postId } = await reported();
    // A browser without a cookie has no CSRF token to send: the allowed Origin is the whole check.
    const b = browser();
    expect(b.cookie("__Host-korbat_csrf")).toBeUndefined();
    await stored(await send(b, notices.rule([postTarget(postId)])));
    const foreign = new Browser(w.app, "https://evil.example");
    const refused = await send(foreign, notices.rule([postTarget(postId)]));
    expect(refused.status).toBe(403);
    expect((await error(refused)).code).toBe("csrf_failed");
    // A client that is no browser sends no Origin at all, and is held to the human check and the limits like anyone.
    await stored(await send(new NativeClient(w.app), notices.rule([postTarget(postId)])));
    expect((await send(new NativeClient(w.app), withoutToken(notices.rule([postTarget(postId)])))).status).toBe(403);
  });

  test("signed in: no human check and no token in the answer; the cookie session needs its CSRF token; a name or an address is refused", async () => {
    const { postId } = await reported();
    const reporter = await signUp();
    const answer = await stored(await send(reporter.b, { ground: "rule", ruleId: "R3", targets: [postTarget(postId)] }));
    expect(answer).toEqual({ ref: expect.stringMatching(/^N-[A-Z2-7]{10}$/) });
    expect(await w.notice(answer.ref)).toMatchObject({ channel: "signed_in", reporter_id: reporter.id, rule_id: "R3" });

    const withoutCsrf = await reporter.b.fetch("/api/notices", { json: { ground: "rule", ruleId: "R1", targets: [missingPost()] }, csrf: false });
    expect(withoutCsrf.status).toBe(403);
    expect((await error(withoutCsrf)).code).toBe("csrf_failed");
    const illegal = withoutToken(notices.illegal([missingPost()]));
    for (const extra of [{ name: "Ada" }, { email: "ada@example.com" }]) {
      const res = await send(reporter.b, { ...illegal, ...extra });
      expect(res.status).toBe(400);
      expect((await error(res)).code).toBe("invalid_request");
    }
    // The same person's second report of the post on the same rule ground.
    const again = await send(reporter.b, { ground: "rule", ruleId: "R1", targets: [postTarget(postId)] });
    expect(again.status).toBe(409);
    expect(await error(again)).toMatchObject({ code: "already_reported", message: "You already reported this; it is being looked at." });
    // The illegal ground mails its receipt to the account's own address.
    const notice = await stored(await send(reporter.b, illegal));
    await w.moderation.settle();
    expect(w.mailer.to(reporter.email, "notice_received")).toHaveLength(1);
    expect((await w.notice(notice.ref))!.receipt).toBe("sent");
  });

  test("a signed-in session that has not finished onboarding is answered onboarding_required, as every signed-in route answers it, whatever token it sends", async () => {
    const { postId } = await reported();
    const unfinished = await signUp(false);
    const counts = await w.counts();
    for (const request of [notices.rule([postTarget(postId)]), notices.csam([postTarget(postId)])]) {
      const res = await send(unfinished.b, request);
      expect(res.status).toBe(403);
      expect(await error(res)).toMatchObject({ code: "onboarding_required", message: "Choose a handle to finish setting up your account." });
    }
    expect(await w.counts()).toEqual(counts);
  });

  test("a staff account's session in the app is answered staff_cannot_report: staff report only as their own finding, in the console", async () => {
    const { postId } = await reported();
    const member = await signUp();
    await w.repo.setRole(member.id!, "moderator");
    // The session's cached copy runs out; the next request reads the account's role again.
    w.ahead.kvMs += 61_000;
    const counts = await w.counts();
    const res = await send(member.b, { ground: "rule", ruleId: "R1", targets: [postTarget(postId)] });
    expect(res.status).toBe(403);
    expect((await error(res)).code).toBe("staff_cannot_report");
    expect(await w.counts()).toEqual(counts);
  });

  test("a body that is no notice is invalid_request, a link to another site or path its own 422, and a notice of child sexual abuse material whose links name two accounts invalid_request; nothing is written", async () => {
    const { author, postId } = await reported();
    const other = await w.account();
    const counts = await w.counts();
    const posts = (n: number) => Array.from({ length: n }, () => postTarget(randomUUID()));
    for (const body of [
      { ...notices.rule(posts(11)) },
      { ...notices.rule([postTarget(postId)]), ruleId: "R2" },
      { ...notices.csam([postTarget(postId)]), name: "Ada" },
      { ...notices.csam([accountTarget(author.handle), accountTarget(other.handle)]) },
      { ...notices.csam([linkTarget(`${origin}/u/${author.handle}`), linkTarget(`${origin}/u/${other.handle}`)]) },
      { ...notices.illegal([postTarget(postId)]), explanation: undefined },
      { ...notices.rule([{ kind: "link", url: "not a link" } as never]) },
      { ground: "rule" },
      "not json",
    ]) {
      const res = await send(browser(), body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await error(res)).code).toBe("invalid_request");
    }
    for (const [url, code] of [
      [`https://elsewhere.example/post/${postId}`, "notice_link_offsite"],
      [`${origin}/explore/about`, "notice_link_invalid"],
    ] as const) {
      const res = await send(browser(), notices.rule([linkTarget(url)]));
      expect(res.status, url).toBe(422);
      expect((await error(res)).code, url).toBe(code);
    }
    expect(await w.counts()).toEqual(counts);
  });

  test("signed out the limit is per network: five an hour for a whole IPv6 /64, whichever of its addresses sends, with Retry-After on the sixth; the next /64 has its own", async () => {
    const prefix = `2001:db8:${randomInt(0x10000).toString(16)}:${randomInt(0x10000).toString(16)}`;
    const address = (network: string, n: number) => `${network}:0:0:0:${(n + 1).toString(16)}`;
    for (let n = 0; n < 5; n++) await stored(await send(browser(address(prefix, n)), notices.rule([missingPost()])));
    const sixth = await send(browser(address(prefix, 99)), notices.rule([missingPost()]));
    expect(sixth.status).toBe(429);
    expect((await error(sixth)).code).toBe("rate_limited");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(sixth.headers.get("retry-after"))).toBeLessThanOrEqual(3600);
    const next = `2001:db8:${randomInt(0x10000).toString(16)}:ffff`;
    await stored(await send(browser(address(next, 0)), notices.rule([missingPost()])));
    // An IPv4 address is a network of its own.
    const v4 = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    for (let n = 0; n < 5; n++) await stored(await send(browser(v4), notices.rule([missingPost()])));
    expect((await send(browser(v4), notices.rule([missingPost()]))).status).toBe(429);
  });

  test("the status page and its two buttons over HTTP: the tokens travel in a POST's body, a wrong one is 404, and a button answers 204", async () => {
    const { postId } = await reported();
    const email = w.address();
    const answer = await stored(await send(browser(), notices.illegal([postTarget(postId)], { name: "Ada", email })));
    await w.moderation.settle();
    const page = await browser().fetch("/api/notices/status", { json: { ref: answer.ref, token: answer.token } });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    const status = NoticeStatus.parse(await page.json());
    expect(status).toMatchObject({ ref: answer.ref, contact: { given: true, confirmed: null, stopped: null } });
    expect(status.items).toMatchObject([{ position: 1, link: `${origin}/post/${postId}`, outcome: null }]);
    // No answer of these routes carries the name or the address.
    expect(JSON.stringify(status)).not.toMatch(/Ada|@/);

    const press = (token: string, choice: string) => browser().fetch("/api/notices/contact", { json: { ref: answer.ref, token, choice } });
    for (const res of [await browser().fetch("/api/notices/status", { json: { ref: answer.ref, token: "A".repeat(43) } }), await press(answer.token!, "stop"), await press(answer.token!, "confirm")]) {
      expect(res.status).toBe(404);
      expect(await error(res)).toMatchObject({ code: "notice_not_found" });
    }
    const mailToken = /#t=([A-Za-z0-9_-]{43})$/.exec(w.mailer.to(email, "notice_received")[0]!.data.pageUrl!)![1]!;
    const stopped = await press(mailToken, "stop");
    expect(stopped.status).toBe(204);
    expect(await stopped.text()).toBe("");
    const byMail = NoticeStatus.parse(await (await browser().fetch("/api/notices/status", { json: { ref: answer.ref, token: mailToken } })).json());
    expect(byMail.contact).toEqual({ given: true, confirmed: false, stopped: true });
    expect((await press(mailToken, "confirm")).status).toBe(204);
    for (const body of [{ ref: answer.ref }, { ref: "nope", token: answer.token }, { ref: answer.ref, token: answer.token, extra: 1 }]) {
      expect((await browser().fetch("/api/notices/status", { json: body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await browser().fetch("/api/notices/contact", { json: { ref: answer.ref, token: mailToken, choice: "resume" } })).status).toBe(400);
    // Another site's page cannot press a button either.
    const foreign = await new Browser(w.app, "https://evil.example").fetch("/api/notices/contact", { json: { ref: answer.ref, token: mailToken, choice: "stop" } });
    expect(foreign.status).toBe(403);

    // The 30 reads an hour count per network: the 31st from one address is refused, with Retry-After.
    const reader = browser();
    for (let n = 0; n < 30; n++) expect((await reader.fetch("/api/notices/status", { json: { ref: answer.ref, token: answer.token } })).status).toBe(200);
    const over = await reader.fetch("/api/notices/status", { json: { ref: answer.ref, token: answer.token } });
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("this file left no row behind: the moderation tables, the posts and profiles and the notifier tables hold what they held before it", async () => {
    await w.cleanUp();
    expect(await w.counts()).toEqual(before);
  });
});
