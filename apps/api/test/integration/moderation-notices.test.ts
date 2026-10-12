import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ITEM_OUTCOMES, NOTICE_LIMITS, NoticeStatus, type NoticeRequest } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { purge } from "../../src/account/flows/deletion";
import type { AccountDeps } from "../../src/account/context";
import { createMediaRepo } from "../../src/media/repo";
import { createBackground, type ModerationDeps } from "../../src/moderation/context";
import { STATUS_READS_PER_HOUR, liveTarget, noticeContact, noticeStatus, sendReceipt, submitNotice, type NoticeSender } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import type { SocialDeps } from "../../src/social/context";
import { deletePost } from "../../src/social/flows/posts";
import { createSocialRepo } from "../../src/social/repo";
import { deciderWorld } from "./moderation-decide";
import { act, authCaseCounts, casesMedia, gate, imagePost, newPostRow, postFrozen, refusal, untilBlocked, uuids, type DecisionInput } from "./moderation-fixtures";
import { HUMAN, accountTarget, linkTarget, notices, noticesWorld, postTarget, type NoticesWorld } from "./notices-harness";
import { newStaffAccount, withLockTimeout } from "./staff-fixtures";

// Each test commits on two pools and waits for the mails a notice starts: on a loaded machine that takes longer than the
// five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

const HOUR = 60 * 60_000;

/**
 * Reports and notices as the routes run them (3c design, sections 7.1 and 7.2), through the moderation module's flows
 * with the real auth module behind them: who may send, the human check and the limits, the targets and the one liveness
 * rule, what follows the commit, the status page and the contact's two buttons, and a notice on the path for child sexual
 * abuse material racing its target's deletion. The HTTP side of the same routes is in http-notices.test.ts. Every test
 * commits, and what it stored is removed after it; the file's last test holds the tables to what they held before it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: reports and notices", () => {
  let w: NoticesWorld;
  let app: string;
  let before: Record<string, number>;
  let beforeAuth: Record<string, number>;
  /** A staff account of this file's own, which every urgent alert must reach. */
  let staffAddress: string;

  beforeAll(async () => {
    w = noticesWorld();
    app = w.config.APP_ORIGIN;
    before = await w.counts();
    beforeAuth = await authCaseCounts(w.migrateDb);
    staffAddress = (await newStaffAccount(w.authDb, w.repo, "moderator")).user.email;
  });
  afterAll(async () => {
    await w.close();
  });
  beforeEach(() => {
    w.mailer.mode = "deliver";
    w.mailer.attempts.length = 0;
    w.mailer.sent.length = 0;
    // Past every window of the limit store but the day's: no test meets another's hourly count or the urgent alert's throttle.
    w.ahead.limitsMs += HOUR;
  });
  afterEach(async () => {
    w.mailer.release();
    await w.cleanUp();
  });

  const submit = async (request: NoticeRequest, from: NoticeSender = w.sender()) => w.remember(await submitNotice(w.deps, request, from));
  const settle = () => w.moderation.settle();
  const status = (ref: string, token: string) => noticeStatus(w.deps, { ref, token }, w.sender().netHash);
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
  const missingPost = () => linkTarget(`${app}/post/${randomUUID()}`);
  const urgentMails = () => w.mailer.to(staffAddress, "moderation_urgent");
  const urgentCases = async () => (await w.apiDb.execute<{ n: number }>(sql`select count(*)::int as n from cases where closed_at is null and lane = 0`))[0]!.n;
  const existing = async (ids: readonly string[]) => (await w.migrateDb.execute<{ id: string }>(sql`select id from post_media where id = any(${uuids(ids)}) order by id`)).map((row) => row.id);
  const holds = async (ids: readonly string[]) => (await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from media_holds where media_id = any(${uuids(ids)}) and released_at is null`))[0]!.n;
  const mailToken = (address: string) => /#t=([A-Za-z0-9_-]{43})$/.exec(w.mailer.to(address, "notice_received").at(-1)!.data.pageUrl!)![1]!;
  /** The author's deletion of a post, as the social module's flow runs it, over a pool or an open transaction. No file is asked for: these posts' images have none. */
  const deleteByAuthor = (db: Db | DbTx, authorId: string, postId: string) => {
    const media = createMediaRepo(db as Db);
    const social = { repo: createSocialRepo(db as Db), media: { detachAll: (tx: DbTx, id: string) => media.detachAll(tx, id), requestDeletion: async () => undefined }, now: () => new Date() } as unknown as SocialDeps;
    return deletePost(social, authorId, postId);
  };
  /** The account's purge, as the account module's flow runs it once the auth side has taken the account down. */
  const purgeAccount = (db: Db | DbTx, userId: string) => {
    const media = createMediaRepo(db as Db);
    const account = {
      social: { purgeProfile: (id: string, now: Date, within: (tx: DbTx) => Promise<void>) => createSocialRepo(db as Db).purgeProfile(id, now, within) },
      media: { purgeOwner: (tx: DbTx, id: string) => media.purgeOwner(tx, id), requestDeletion: async () => undefined },
      auth: { finishPurge: async () => undefined },
      now: () => new Date(),
    } as unknown as AccountDeps;
    return purge(account, userId);
  };

  describe("who sends it", () => {
    test("signed in, on a rule: the report carries its sender, no token is given, and nothing is mailed", async () => {
      const [author, reporter] = [await w.account(), await w.account()];
      const postId = await newPostRow(w.apiDb, author.id);
      // A signed-in sender's token is ignored: none is needed, and one that would fail the check changes nothing.
      const answer = await submit({ ground: "rule", ruleId: "R4", targets: [postTarget(postId)], explanation: "It shows my address.", turnstileToken: "not-human" }, w.sender(reporter.session));
      expect(answer).toEqual({ ref: expect.stringMatching(/^N-[A-Z2-7]{10}$/) });
      expect(await w.notice(answer.ref)).toMatchObject({
        kind: "user",
        channel: "signed_in",
        reporter_id: reporter.id,
        contact_id: null,
        rule_id: "R4",
        alleges_illegal: false,
        csam: false,
        category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
        explanation: "It shows my address.",
        bona_fide: false,
        lookup_hash: null,
        receipt: "none",
      });
      expect(await w.items(answer.ref)).toMatchObject([{ position: 1, target_type: "post", target_id: postId, lane: 1, suspect: false, outcome: null, reporter_account_id: reporter.id, case_lane: 1 }]);
      await settle();
      expect(w.mailer.attempts).toHaveLength(0);
    });

    test("signed out without a name or an address: a token, stored only as its hash, and no contact; without the human check nothing is taken", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      for (const request of [notices.rule([postTarget(postId)]), notices.illegal([postTarget(postId)])]) {
        const answer = await submit(request);
        expect(answer.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(await w.notice(answer.ref)).toMatchObject({ channel: "signed_out", reporter_id: null, contact_id: null, lookup_hash: sha256(answer.token!), receipt: "none" });
      }
      const counts = await w.counts();
      const { turnstileToken: _token, ...unchecked } = notices.rule([postTarget(postId)]);
      expect(await refusal(submitNotice(w.deps, unchecked as NoticeRequest, w.sender()))).toBe("human_check_failed");
      expect(await refusal(submitNotice(w.deps, notices.csam([postTarget(postId)], { turnstileToken: "not-human" }), w.sender()))).toBe("human_check_failed");
      expect(await w.counts()).toEqual(counts);
      await settle();
      expect(w.mailer.attempts).toHaveLength(0);
    });

    test("signed out with a name and an address: the notice holds an id alone, the auth module the contact, and the receipt goes at once with a page link of its own token", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      const email = w.address();
      const answer = await submit(notices.illegal([postTarget(postId), accountTarget(author.handle.toUpperCase())], { name: "Ada Lovelace", email, citedLaw: "StGB 241", category: "STATEMENT_CATEGORY_VIOLENCE" }));
      await settle();
      const stored = (await w.notice(answer.ref))!;
      expect(stored).toMatchObject({ channel: "signed_out", reporter_id: null, alleges_illegal: true, category: "STATEMENT_CATEGORY_VIOLENCE", cited_law: "StGB 241", bona_fide: true, lookup_hash: sha256(answer.token!), receipt: "sent", receipt_sent: true });
      expect(stored.contact_id).toMatch(/^[0-9a-f-]{36}$/);
      // Neither the name nor the address is in the notice's row.
      expect(JSON.stringify(stored)).not.toMatch(/Ada|notifier-/);
      expect((await w.items(answer.ref)).map((item) => [item.position, item.lane])).toEqual([[1, 0], [2, 0]]);

      const receipts = w.mailer.to(email, "notice_received");
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.data).toMatchObject({ ref: answer.ref, items: `${app}/post/${postId}, ${app}/u/${author.handle}`, termsUrl: `${app}/terms` });
      expect(receipts[0]!.data.pageUrl).toBe(`${app}/notice/${answer.ref}#t=${mailToken(email)}`);
      // The mail never carries the notice's own token.
      expect(mailToken(email)).not.toBe(answer.token);
      expect(JSON.stringify(receipts[0]!.data)).not.toContain(answer.token!);
      expect((await w.auth.forModeration.notifierFacts([stored.contact_id!])).get(stored.contact_id!)).toEqual({ found: true, named: true, contactGiven: true, confirmed: false, suppressed: false });
      expect(await w.auth.forModeration.notifierName(stored.contact_id!)).toBe("Ada Lovelace");
    });

    test("signed in, on the law: the receipt goes to the account's own address, without a page link; a name or an address from a signed-in sender is refused", async () => {
      const [author, reporter] = [await w.account(), await w.account()];
      const postId = await newPostRow(w.apiDb, author.id);
      const { turnstileToken: _token, ...request } = notices.illegal([postTarget(postId)], { ruleId: "R3" });
      const answer = await submit(request as NoticeRequest, w.sender(reporter.session));
      expect(answer.token).toBeUndefined();
      await settle();
      expect(await w.notice(answer.ref)).toMatchObject({ channel: "signed_in", reporter_id: reporter.id, contact_id: null, rule_id: "R3", alleges_illegal: true, lookup_hash: null, receipt: "sent", receipt_sent: true });
      const receipts = w.mailer.to(reporter.email, "notice_received");
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.data).toEqual({ ref: answer.ref, time: expect.stringMatching(/^[0-9-]{10} [0-9:]{5} UTC$/), items: `${app}/post/${postId}`, termsUrl: `${app}/terms` });

      const counts = await w.counts();
      for (const extra of [{ name: "Ada" }, { email: w.address() }]) {
        expect(await refusal(submitNotice(w.deps, { ...request, ...extra } as NoticeRequest, w.sender(reporter.session)))).toBe("invalid_request");
      }
      expect(await w.counts()).toEqual(counts);
    });

    test("a staff account does not report, and a session that has not finished onboarding is refused, never treated as signed out; neither is counted or stored", async () => {
      const [author, member] = [await w.account(), await w.account()];
      const postId = await newPostRow(w.apiDb, author.id);
      // Every refused request below names this one account and comes from this one network.
      const network = w.sender().netHash;
      const from = (session: NoticeSender["session"]): NoticeSender => ({ session, netHash: network });
      const counts = await w.counts();
      for (const role of ["moderator", "admin"] as const) {
        expect(await refusal(submitNotice(w.deps, notices.rule([postTarget(postId)]), from({ userId: member.id, role, onboarded: true })))).toBe("staff_cannot_report");
      }
      const unfinished = from({ userId: member.id, role: "user", onboarded: false });
      // It carries the token a signed-out sender needs, and is refused all the same.
      expect(await refusal(submitNotice(w.deps, notices.rule([postTarget(postId)]), unfinished))).toBe("onboarding_required");
      expect(await refusal(submitNotice(w.deps, notices.csam([postTarget(postId)]), unfinished))).toBe("onboarding_required");
      expect(await w.counts()).toEqual(counts);
      // Not counted: the account can still send every report of its hour, and the network every one a signed-out sender has.
      const asUser = from(member.session);
      const report = (): NoticeRequest => ({ ground: "rule", ruleId: "R1", targets: [missingPost()] });
      for (let n = 0; n < NOTICE_LIMITS.signedIn.perHour; n++) await submit(report(), asUser);
      expect(await refusal(submitNotice(w.deps, report(), asUser))).toBe("rate_limited");
      for (let n = 0; n < NOTICE_LIMITS.signedOut.perHour; n++) await submit(notices.rule([missingPost()]), from(null));
      expect(await refusal(submitNotice(w.deps, notices.rule([missingPost()]), from(null)))).toBe("rate_limited");
    });

    test("on the path for child sexual abuse material no sender is recorded, signed in or out: a token, the urgent lane, and the keyword of the choice", async () => {
      const [author, reporter] = [await w.account(), await w.account()];
      const { postId } = await imagePost(w.apiDb, 1, author.id);
      const signedOut = await submit(notices.csam([postTarget(postId)], { keyword: "grooming", explanation: "The image.", bonaFide: true }));
      const signedIn = await submit({ ground: "csam", targets: [postTarget(postId)], keyword: "abuse" }, w.sender(reporter.session));
      for (const answer of [signedOut, signedIn]) expect(answer.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const expected = { kind: "user", reporter_id: null, contact_id: null, rule_id: null, alleges_illegal: true, csam: true, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", receipt: "none" };
      expect(await w.notice(signedOut.ref)).toMatchObject({ ...expected, channel: "signed_out", category_keyword: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS", explanation: "The image.", bona_fide: true, lookup_hash: sha256(signedOut.token!) });
      expect(await w.notice(signedIn.ref)).toMatchObject({ ...expected, channel: "signed_in", category_keyword: null, explanation: null, bona_fide: false, lookup_hash: sha256(signedIn.token!) });
      for (const answer of [signedOut, signedIn]) {
        expect(await w.items(answer.ref)).toMatchObject([{ position: 1, target_id: postId, lane: 0, suspect: true, outcome: null, reporter_account_id: null, case_lane: 0 }]);
      }
    });
  });

  describe("what follows the commit", () => {
    test("the receipt's states: folded for a second notice to an unconfirmed address, suppressed for a stopped one, no address for a name alone, failed for an address the relay refuses", async () => {
      const email = w.address();
      const first = await submit(notices.illegal([missingPost()], { email }));
      await settle();
      const second = await submit(notices.illegal([missingPost()], { email }));
      await settle();
      expect([(await w.notice(first.ref))!.receipt, (await w.notice(second.ref))!.receipt]).toEqual(["sent", "folded"]);
      expect((await w.notice(second.ref))!.receipt_sent).toBe(false);
      expect(w.mailer.to(email)).toHaveLength(1);

      await noticeContact(w.deps, { ref: first.ref, token: mailToken(email), choice: "stop" }, w.sender().netHash);
      const third = await submit(notices.illegal([missingPost()], { email }));
      const named = await submit(notices.illegal([missingPost()], { name: "Ada" }));
      w.mailer.mode = "refuse";
      const refused = await submit(notices.illegal([missingPost()], { email: w.address() }));
      await settle();
      expect([(await w.notice(third.ref))!.receipt, (await w.notice(named.ref))!.receipt, (await w.notice(refused.ref))!.receipt]).toEqual(["suppressed", "no_address", "failed"]);
      expect(w.mailer.to(email)).toHaveLength(1);
    });

    test("a relay failure leaves the receipt pending; the later try sends it with the same page link, and a receipt already recorded is not sent again", async () => {
      const email = w.address();
      w.mailer.mode = "fail";
      const answer = await submit(notices.illegal([missingPost()], { email }));
      await settle();
      const stored = (await w.notice(answer.ref))!;
      expect(stored).toMatchObject({ receipt: "pending", receipt_sent: false });
      const attempted = w.mailer.attempts.filter((message) => message.to === email);
      expect(attempted).toHaveLength(1);
      expect(w.mailer.to(email)).toHaveLength(0);

      w.mailer.mode = "deliver";
      expect(await sendReceipt(w.deps, stored.id)).toBe("sent");
      expect(await w.notice(answer.ref)).toMatchObject({ receipt: "sent", receipt_sent: true });
      expect(w.mailer.to(email)).toHaveLength(1);
      expect(w.mailer.to(email)[0]!.data).toEqual(attempted[0]!.data);
      expect(await sendReceipt(w.deps, stored.id)).toBe("none");
      expect(w.mailer.to(email)).toHaveLength(1);
    });

    test("the contact is stored after the commit; when that fails the notice stands without it: answered as any other, its receipt recorded as having no address", async () => {
      const store = w.authForModeration.storeNotifierContact;
      w.authForModeration.storeNotifierContact = async () => {
        throw new Error("the auth pool cannot be reached");
      };
      try {
        const answer = await submit(notices.illegal([missingPost()], { name: "Ada", email: w.address() }));
        expect(answer).toEqual({ ref: expect.stringMatching(/^N-/), token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
        await settle();
        const stored = (await w.notice(answer.ref))!;
        expect(stored.receipt).toBe("no_address");
        // Staff see "contact lost or forgotten": no contact has the id the notice names.
        expect((await w.auth.forModeration.notifierFacts([stored.contact_id!])).get(stored.contact_id!)).toEqual({ found: false, named: false, contactGiven: false, confirmed: false, suppressed: false });
        expect(w.mailer.attempts).toHaveLength(0);
        // The status page still answers to the token on screen.
        expect((await status(answer.ref, answer.token!)).contact).toEqual({ given: false, confirmed: null, stopped: null });
      } finally {
        w.authForModeration.storeNotifierContact = store;
      }
    });

    test("a notice on the urgent lane whose staff alert fails still gets its receipt: the alert's failure is logged, and the receipt goes after it", async () => {
      const author = await w.account();
      const { postId } = await imagePost(w.apiDb, 0, author.id);
      const email = w.address();
      const mailStaff = w.authForModeration.mailStaff;
      w.authForModeration.mailStaff = async () => Promise.reject(new Error("the staff accounts could not be read"));
      let answer: Awaited<ReturnType<typeof submit>>;
      try {
        // A notice of illegality about violence goes to the urgent lane, and its sender gave an address.
        answer = await submit(notices.illegal([postTarget(postId)], { email, category: "STATEMENT_CATEGORY_VIOLENCE" }));
        await settle();
      } finally {
        w.authForModeration.mailStaff = mailStaff;
      }
      expect((await w.items(answer.ref))[0]!.lane).toBe(0);
      expect((await w.notice(answer.ref))!.receipt).toBe("sent");
      expect(w.mailer.to(email, "notice_received")).toHaveLength(1);
    });

    test("the answer never waits for a mail: a notice with an address and one on the urgent path are answered while the relay hangs, and their mails are recorded once it answers", async () => {
      const author = await w.account();
      const { postId } = await imagePost(w.apiDb, 1, author.id);
      const email = w.address();
      w.mailer.mode = "hang";
      const withAddress = await submit(notices.illegal([missingPost()], { email, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" }));
      const urgent = await submit(notices.csam([postTarget(postId)]));
      for (const answer of [withAddress, urgent]) expect(answer).toEqual({ ref: expect.stringMatching(/^N-/), token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
      let settled = false;
      const settling = settle().then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(settled).toBe(false);
      expect((await w.notice(withAddress.ref))!.receipt).toBe("pending");
      expect(w.mailer.sent).toHaveLength(0);
      w.mailer.release();
      await settling;
      expect((await w.notice(withAddress.ref))!.receipt).toBe("sent");
      expect(w.mailer.to(email, "notice_received")).toHaveLength(1);
      expect(urgentMails()).toHaveLength(1);
    });
  });

  describe("the limits", () => {
    test("signed out: 5 an hour and 20 a day for each network, counted after the human check; another network has its own", async () => {
      expect(NOTICE_LIMITS.signedOut).toEqual({ perHour: 5, perDay: 20 });
      const network = w.sender();
      const send = (from: NoticeSender = network, request = notices.rule([missingPost()])) => submitNotice(w.deps, request, from).then(w.remember);
      // A request that fails the human check is not counted.
      for (let n = 0; n < 8; n++) expect(await refusal(send(network, notices.rule([missingPost()], { turnstileToken: "not-human" })))).toBe("human_check_failed");
      for (let n = 0; n < 5; n++) await send();
      await expect(send()).rejects.toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: expect.any(Number) });
      // The ground does not matter, and neither does what the notice names.
      expect(await refusal(send(network, notices.csam([missingPost()])))).toBe("rate_limited");
      await send(w.sender());
      // The next three hours take five each; then the day is used up, though the hour is new.
      for (let hour = 0; hour < 3; hour++) {
        w.ahead.limitsMs += HOUR + 1000;
        for (let n = 0; n < 5; n++) await send();
      }
      w.ahead.limitsMs += HOUR + 1000;
      const refused = await send().then(() => null, (err: { code: string; retryAfterSeconds: number }) => err);
      expect(refused).toMatchObject({ code: "rate_limited" });
      // The day's window began with the first of the twenty: about 20 hours of it are left.
      expect(refused!.retryAfterSeconds).toBeGreaterThan(18 * 3600);
    });

    test("signed in: 10 an hour for each account, whatever network it comes from; a store that cannot count refuses, and nothing is stored", async () => {
      expect(NOTICE_LIMITS.signedIn).toEqual({ perHour: 10, perDay: 50 });
      const reporter = await w.account();
      const send = () => submitNotice(w.deps, { ground: "rule", ruleId: "R1", targets: [missingPost()] }, w.sender(reporter.session)).then(w.remember);
      for (let n = 0; n < 10; n++) await send();
      expect(await refusal(send())).toBe("rate_limited");
      // Another account is not held to this one's count.
      const other = await w.account();
      await submit({ ground: "rule", ruleId: "R1", targets: [missingPost()] }, w.sender(other.session));

      const counts = await w.counts();
      const down: ModerationDeps = {
        ...w.deps,
        limits: {
          hit: async () => {
            throw new Error("the limit store cannot be reached");
          },
          release: async () => undefined,
        },
      };
      await expect(submitNotice(down, notices.rule([missingPost()]), w.sender())).rejects.toMatchObject({ code: "service_unavailable", status: 503 });
      await expect(noticeStatus(down, { ref: "N-ABCDEFGH23", token: "A".repeat(43) }, "net")).rejects.toMatchObject({ code: "service_unavailable", status: 503 });
      expect(await w.counts()).toEqual(counts);
    });
  });

  describe("the targets", () => {
    test("links are parsed, duplicates named once, and each link that names nothing is an item of its own with an id that names nothing", async () => {
      const [author, other, reporter] = [await w.account(), await w.account(), await w.account()];
      const { postId, mediaIds } = await imagePost(w.apiDb, 1, author.id);
      const gone = randomUUID();
      // The other account has left this handle: on a rule it names nothing.
      const left = `old_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${other.id}::uuid, now())`);
      const [unknownOne, unknownTwo] = [`u1_${randomBytes(4).toString("hex")}`, `u2_${randomBytes(4).toString("hex")}`];
      const answer = await submit(
        {
          ground: "rule",
          ruleId: "R1",
          targets: [
            linkTarget(`${app}/post/${postId.toUpperCase()}/`),
            postTarget(postId, mediaIds[0]),
            accountTarget(author.handle),
            linkTarget(`${app}/u/${author.handle.toUpperCase()}`),
            accountTarget(unknownOne),
            accountTarget(unknownTwo),
            linkTarget(`${app}/u/${unknownOne}`),
            linkTarget(`${app}/post/${gone}`),
            accountTarget(left),
          ],
        },
        w.sender(reporter.session),
      );
      const items = await w.items(answer.ref);
      expect(items.map((item) => [item.position, item.target_type, item.named_handle, item.case_id === null, item.outcome])).toEqual([
        [1, "post", null, false, null],
        [2, "account", author.handle, false, null],
        [3, "account", unknownOne, true, "not_available"],
        [4, "account", unknownTwo, true, "not_available"],
        [5, "post", null, true, "not_available"],
        [6, "account", left, true, "not_available"],
      ]);
      // The image one of the two spellings pointed at is kept as the hint.
      expect([items[0]!.target_id, items[0]!.media_id, items[1]!.target_id, items[4]!.target_id]).toEqual([postId, mediaIds[0], author.id, gone]);
      // The three handles that name nothing live have ids that name nothing, each its own: the old handle's is not its account's.
      const made = [items[2]!.target_id, items[3]!.target_id, items[5]!.target_id];
      expect(new Set(made).size).toBe(3);
      expect(made).not.toContain(other.id);
      expect((await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from profiles where id = any(${uuids(made)})`))[0]!.n).toBe(0);
    });

    test("a link to another site or to another path is refused with its own code, and nothing of the notice is stored", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      const counts = await w.counts();
      for (const [url, code] of [
        [`https://elsewhere.example/post/${postId}`, "notice_link_offsite"],
        [`${app}/settings/profile`, "notice_link_invalid"],
        [`${app}/u/${author.handle}/followers`, "notice_link_invalid"],
      ] as const) {
        await expect(submitNotice(w.deps, notices.rule([postTarget(postId), linkTarget(url)]), w.sender())).rejects.toMatchObject({ code, status: 422 });
      }
      expect(await w.counts()).toEqual(counts);
    });

    test("a signed-in sender's target they reported already on the same ground is dropped; when every target is, the answer is already_reported; another ground, and the anonymous path, are heard", async () => {
      const [author, reporter] = [await w.account(), await w.account()];
      const [first, second] = [(await imagePost(w.apiDb, 1, author.id)).postId, await newPostRow(w.apiDb, author.id)];
      const from = () => w.sender(reporter.session);
      const rule = (targets: NoticeRequest["targets"]): NoticeRequest => ({ ground: "rule", ruleId: "R1", targets });
      await submit(rule([postTarget(first)]), from());
      const counts = await w.counts();
      expect(await refusal(submitNotice(w.deps, rule([postTarget(first)]), from()))).toBe("already_reported");
      expect(await refusal(submitNotice(w.deps, rule([linkTarget(`${app}/post/${first}`), postTarget(first)]), from()))).toBe("already_reported");
      expect(await w.counts()).toEqual(counts);
      // Named beside a new target, the reported one is dropped and the new one is the notice's first item.
      const mixed = await submit(rule([postTarget(first), postTarget(second)]), from());
      expect((await w.items(mixed.ref)).map((item) => [item.position, item.target_id])).toEqual([[1, second]]);
      // Beside a link that names nothing, the notice stands with that link alone.
      const withDead = await submit(rule([postTarget(first), accountTarget(`nobody_${randomBytes(4).toString("hex")}`)]), from());
      expect((await w.items(withDead.ref)).map((item) => [item.position, item.target_type, item.outcome])).toEqual([[1, "account", "not_available"]]);

      // That it is illegal is another ground: the same sender is heard on it, once.
      const { turnstileToken: _token, ...illegal } = notices.illegal([postTarget(first)]);
      await submit(illegal as NoticeRequest, from());
      expect(await refusal(submitNotice(w.deps, illegal as NoticeRequest, from()))).toBe("already_reported");
      // On the path for child sexual abuse material nothing is matched against the account: both notices are taken, each
      // an item with no sender, and the case moves to the urgent lane and freezes the post.
      expect(await postFrozen(w.apiDb, first)).toBe(false);
      const [one, two] = [await submit({ ground: "csam", targets: [postTarget(first)], keyword: "csam" }, from()), await submit({ ground: "csam", targets: [postTarget(first)], keyword: "csam" }, from())];
      for (const answer of [one, two]) expect(await w.items(answer.ref)).toMatchObject([{ target_id: first, suspect: true, reporter_account_id: null, case_lane: 0 }]);
      expect(await postFrozen(w.apiDb, first)).toBe(true);
      // Someone else's report of the same post on the same rule is an item of its own.
      const third = await w.account();
      expect(await refusal(submitNotice(w.deps, rule([postTarget(first)]), w.sender(third.session)).then(w.remember))).toBeNull();
    });

    test("a notice on the path for child sexual abuse material that names two accounts is refused, also when the two handles are one account's old and present one; nothing is written", async () => {
      const [ada, bob] = [await w.account(), await w.account()];
      const left = `old_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${ada.id}::uuid, now())`);
      const counts = await w.counts();
      for (const targets of [
        [linkTarget(`${app}/u/${ada.handle}`), linkTarget(`${app}/u/${bob.handle}`)],
        [accountTarget(ada.handle), linkTarget(`${app}/u/${bob.handle}`)],
        [linkTarget(`${app}/u/${ada.handle}`), linkTarget(`${app}/u/${left}`)],
        // Counted as named, before any is looked up: two handles nobody holds are two accounts too.
        [linkTarget(`${app}/u/nobody_one`), linkTarget(`${app}/u/nobody_two`)],
      ]) {
        await expect(submitNotice(w.deps, notices.csam(targets), w.sender())).rejects.toMatchObject({ code: "invalid_request", status: 400 });
      }
      expect(await w.counts()).toEqual(counts);
      // One account, also named twice, is taken; on another ground so are two.
      const once = await submit(notices.csam([accountTarget(ada.handle), linkTarget(`${app}/u/${ada.handle.toUpperCase()}`)]));
      expect((await w.items(once.ref)).map((item) => [item.position, item.target_id])).toEqual([[1, ada.id]]);
      const two = await submit(notices.rule([accountTarget(ada.handle), accountTarget(bob.handle)]));
      expect(await w.items(two.ref)).toHaveLength(2);
    });
  });

  describe("liveness: one rule for every ground", () => {
    test("liveTarget: a deleted post or account names nothing on a rule or on the law, and still names its row on the path for child sexual abuse material, an account also under a handle it has left", async () => {
      const [author, gone] = [await w.account(), await w.account()];
      const [live, deleted] = [await newPostRow(w.apiDb, author.id), await newPostRow(w.apiDb, author.id)];
      await w.migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted}::uuid`);
      await w.migrateDb.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
      const left = `old_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${author.id}::uuid, now())`);
      const post = (id: string) => ({ type: "post" as const, id, mediaId: null });
      const account = (handle: string) => ({ type: "account" as const, handle });
      for (const suspect of [false, true]) {
        expect(await liveTarget(w.deps, post(live), suspect)).toEqual({ type: "post", id: live });
        expect(await liveTarget(w.deps, account(author.handle), suspect)).toEqual({ type: "account", id: author.id });
        expect(await liveTarget(w.deps, post(randomUUID()), suspect)).toBeNull();
        expect(await liveTarget(w.deps, account("nobody_holds_it"), suspect)).toBeNull();
      }
      expect(await liveTarget(w.deps, post(deleted), false)).toBeNull();
      expect(await liveTarget(w.deps, account(gone.handle), false)).toBeNull();
      expect(await liveTarget(w.deps, account(left), false)).toBeNull();
      expect(await liveTarget(w.deps, post(deleted), true)).toEqual({ type: "post", id: deleted });
      expect(await liveTarget(w.deps, account(gone.handle), true)).toEqual({ type: "account", id: gone.id });
      expect(await liveTarget(w.deps, account(left), true)).toEqual({ type: "account", id: author.id });
    });

    test("a report on a rule or on the law about a post its author deleted, or about a deleted account, is answered not available: no case, no hold, no alert", async () => {
      const [author, gone] = [await w.account(), await w.account()];
      const { postId, mediaIds } = await imagePost(w.apiDb, 2, author.id);
      await w.migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
      await w.migrateDb.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
      for (const request of [notices.rule([postTarget(postId), accountTarget(gone.handle)], { ruleId: "R5" }), notices.illegal([postTarget(postId), accountTarget(gone.handle)], { category: "STATEMENT_CATEGORY_VIOLENCE" })]) {
        const answer = await submit(request);
        const items = await w.items(answer.ref);
        expect(items.map((item) => [item.position, item.case_id, item.outcome, item.lane])).toEqual([[1, null, "not_available", 0], [2, null, "not_available", 0]]);
        expect(items[0]!.target_id).toBe(postId);
        expect(items[1]!.target_id).not.toBe(gone.id);
      }
      expect(await holds(mediaIds)).toBe(0);
      expect((await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from cases where target_id = any(${uuids([postId, gone.id])})`))[0]!.n).toBe(0);
      await settle();
      // An item without a case enters no lane: nobody is alerted for a link that names nothing.
      expect(urgentMails()).toHaveLength(0);
    });

    test("a notice on the path for child sexual abuse material about a live image post: an urgent case, a snapshot, holds, the post frozen, and one alert to staff", async () => {
      const author = await w.account();
      const { postId, mediaIds } = await imagePost(w.apiDb, 2, author.id);
      const waitingBefore = await urgentCases();
      const answer = await submit(notices.csam([postTarget(postId, mediaIds[1])]));
      await settle();
      const [item] = await w.items(answer.ref);
      expect(item).toMatchObject({ position: 1, target_id: postId, media_id: mediaIds[1], lane: 0, suspect: true, outcome: null, case_lane: 0 });
      expect(await holds(mediaIds)).toBe(2);
      expect(await postFrozen(w.apiDb, postId)).toBe(true);
      expect((await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from evidence_snapshots where case_id = ${item!.case_id}::uuid`))[0]!.n).toBe(1);
      expect(urgentMails()).toHaveLength(1);
      expect(urgentMails()[0]!.data).toEqual({ count: String(waitingBefore + 1), oldest: expect.stringMatching(/^[0-9-]{10} [0-9:]{5} UTC$/) });
      // A second urgent report within the alert's window sends no second mail.
      await submit(notices.csam([postTarget(postId)]));
      await settle();
      expect(urgentMails()).toHaveLength(1);
    });

    test("when no staff address took the alert its throttle is given back, so the next urgent report alerts again", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      w.mailer.mode = "fail";
      await submit(notices.rule([postTarget(postId)], { ruleId: "R5" }));
      await settle();
      expect(urgentMails()).toHaveLength(0);
      expect(w.mailer.attempts.some((message) => message.template === "moderation_urgent" && message.to === staffAddress)).toBe(true);
      w.mailer.mode = "deliver";
      await submit(notices.rule([postTarget(postId)], { ruleId: "R5" }));
      await settle();
      expect(urgentMails()).toHaveLength(1);
    });

    test("on that path a post its author deleted, one the purge blanked, and a purged account named by its handle each get an urgent case that waits for an admin; a link to no row is answered at once", async () => {
      const [author, purged] = [await w.account(), await w.account()];
      const deleted = await newPostRow(w.apiDb, author.id);
      await w.migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted}::uuid`);
      const blanked = await newPostRow(w.apiDb, purged.id);
      await w.migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${blanked}::uuid`);
      await w.migrateDb.execute(sql`update profiles set deleted_at = now(), display_name = '', bio = '' where id = ${purged.id}::uuid`);
      const posts = await submit(notices.csam([postTarget(deleted), postTarget(blanked), missingPost()]));
      expect((await w.items(posts.ref)).map((item) => [item.position, item.case_id !== null, item.outcome, item.case_lane])).toEqual([[1, true, null, 0], [2, true, null, 0], [3, false, "not_available", null]]);
      const account = await submit(notices.csam([accountTarget(purged.handle)]));
      expect(await w.items(account.ref)).toMatchObject([{ position: 1, target_type: "account", target_id: purged.id, named_handle: purged.handle, suspect: true, outcome: null, case_lane: 0 }]);
    });

    test("on that path a post its author deleted, whose images a closed case's hold still keeps, gets an urgent case on the tombstone: the kept images are held for it, listed in its snapshot and frozen", async () => {
      // The decision that closes the first case commits, so a real staff key confirms it, as the console would.
      const decider = deciderWorld(w.apiDb);
      try {
        const [admin, author] = [await decider.staff("admin"), await w.account()];
        const { postId, mediaIds } = await imagePost(w.apiDb, 2, author.id);
        // A rule report's case holds the post's images as evidence. A decision closes the case; its holds stand.
        const first = await submit(notices.rule([postTarget(postId)]));
        const closedCase = (await w.items(first.ref))[0]!.case_id!;
        expect(typeof (await decider.decideAs(admin, closedCase, { kind: "final", outcome: "no_violation" }))).toBe("object");
        expect((await w.migrateDb.execute<{ closed: boolean }>(sql`select closed_at is not null as closed from cases where id = ${closedCase}::uuid`))[0]!.closed).toBe(true);
        expect(await holds(mediaIds)).toBe(2);
        // The author deletes the post: it is a tombstone, and the held image rows are kept.
        await deleteByAuthor(w.apiDb, author.id, postId);
        expect((await w.migrateDb.execute<{ state: string }>(sql`select state from posts where id = ${postId}::uuid`))[0]!.state).toBe("deleted_by_author");
        expect(await existing(mediaIds)).toEqual([...mediaIds].sort());
        // On a rule the deleted post names nothing, kept images or not: no case, and no further hold.
        const ruled = await submit(notices.rule([postTarget(postId)]));
        expect(await w.items(ruled.ref)).toMatchObject([{ position: 1, case_id: null, outcome: "not_available" }]);
        expect(await holds(mediaIds)).toBe(2);

        const answer = await submit(notices.csam([postTarget(postId)]));
        await settle();
        const [item] = await w.items(answer.ref);
        expect(item).toMatchObject({ position: 1, target_id: postId, suspect: true, outcome: null, case_lane: 0 });
        expect(item!.case_id).not.toBe(closedCase);
        // The new case holds what is left of the images beside the closed case's holds, and its snapshot lists them on the tombstone.
        expect(await holds(mediaIds)).toBe(4);
        const [snapshot] = await w.migrateDb.execute<{ post_state: string; body: string; images: number }>(sql`select post_state, body, jsonb_array_length(media) as images from evidence_snapshots where case_id = ${item!.case_id}::uuid`);
        expect({ ...snapshot! }).toEqual({ post_state: "deleted_by_author", body: "", images: 2 });
        expect(await postFrozen(w.apiDb, postId)).toBe(true);
        expect(urgentMails()).toHaveLength(1);
      } finally {
        await w.cleanUp();
        await decider.close();
      }
    });

    test("on that path a quoting post its author deleted before the notice, with no image of its own, still brings the post it quotes: two items, two urgent cases, the quoted post's images frozen, one alert that counts both", async () => {
      const [quotedAuthor, author] = [await w.account(), await w.account()];
      const quoted = await imagePost(w.apiDb, 1, quotedAuthor.id);
      const quoting = await newPostRow(w.apiDb, author.id, { quoteOfId: quoted.postId });
      await deleteByAuthor(w.apiDb, author.id, quoting);
      // The deletion leaves what the post quoted on its row.
      expect({ ...(await w.migrateDb.execute<{ state: string; quote_of_id: string }>(sql`select state, quote_of_id from posts where id = ${quoting}::uuid`))[0]! }).toEqual({ state: "deleted_by_author", quote_of_id: quoted.postId });
      const waitingBefore = await urgentCases();
      const answer = await submit(notices.csam([postTarget(quoting)]));
      await settle();
      const items = await w.items(answer.ref);
      expect(items.map((item) => [item.position, item.target_id, item.suspect, item.outcome, item.case_lane])).toEqual([[1, quoting, true, null, 0], [11, quoted.postId, true, null, 0]]);
      expect(new Set(items.map((item) => item.case_id)).size).toBe(2);
      // The tombstone's own case reaches no image; the quoted post's image is held by its case, and both posts are frozen.
      expect(await holds(quoted.mediaIds)).toBe(1);
      expect([await postFrozen(w.apiDb, quoted.postId), await postFrozen(w.apiDb, quoting)]).toEqual([true, true]);
      expect(urgentMails()).toHaveLength(1);
      expect(urgentMails()[0]!.data.count).toBe(String(waitingBefore + 2));
      // The page lists the named item alone until a release: the item korbat added would tell that the tombstone's id names a row.
      expect((await status(answer.ref, answer.token!)).items.map((item) => [item.position, item.quotedBy, item.outcome])).toEqual([[1, null, null]]);
      // On a rule the deleted quoting post names nothing, and brings nothing.
      const ruled = await submit(notices.rule([postTarget(quoting)]));
      expect(await w.items(ruled.ref)).toMatchObject([{ position: 1, case_id: null, outcome: "not_available" }]);
      expect(await holds(quoted.mediaIds)).toBe(1);
    });

    test("on that path a post that quotes another is a report about both: two items, two urgent cases, one alert that counts both; the status page lists the named items alone until a release", async () => {
      const [quotedAuthor, author] = [await w.account(), await w.account()];
      const quoted = (await imagePost(w.apiDb, 1, quotedAuthor.id)).postId;
      const [quotingOne, quotingTwo, plain] = [await newPostRow(w.apiDb, author.id, { quoteOfId: quoted }), await newPostRow(w.apiDb, author.id, { quoteOfId: quoted }), await newPostRow(w.apiDb, author.id)];
      const waitingBefore = await urgentCases();
      const answer = await submit(notices.csam([postTarget(quotingOne)]));
      await settle();
      const items = await w.items(answer.ref);
      expect(items.map((item) => [item.position, item.target_id, item.suspect, item.case_lane])).toEqual([[1, quotingOne, true, 0], [11, quoted, true, 0]]);
      expect(new Set(items.map((item) => item.case_id)).size).toBe(2);
      expect(await postFrozen(w.apiDb, quoted)).toBe(true);
      expect(urgentMails()).toHaveLength(1);
      expect(urgentMails()[0]!.data.count).toBe(String(waitingBefore + 2));
      // The item korbat added is stored, and not listed yet: before a release it would tell that the named post exists.
      const page = await status(answer.ref, answer.token!);
      expect(page.items.map((item) => [item.position, item.link, item.quotedBy, item.suspect, item.scope, item.outcome])).toEqual([[1, `${app}/post/${quotingOne}`, null, true, null, null]]);

      // A notice that names both posts adds nothing; two named posts that quote the same post add one item, after the lower.
      const both = await submit(notices.csam([postTarget(quoted), postTarget(quotingOne)]));
      expect((await w.items(both.ref)).map((item) => item.position)).toEqual([1, 2]);
      const twice = await submit(notices.csam([postTarget(plain), postTarget(quotingTwo), postTarget(quotingOne)]));
      expect((await w.items(twice.ref)).map((item) => [item.position, item.target_id])).toEqual([[1, plain], [2, quotingTwo], [3, quotingOne], [12, quoted]]);
      expect((await status(twice.ref, twice.token!)).items.map((item) => [item.position, item.quotedBy])).toEqual([[1, null], [2, null], [3, null]]);
      // On a rule the quoting post is one item, and its answer concerns its own text and images. The page says so only with
      // the released outcome: before it a live post that quotes another, a live post that quotes nothing and a link to no
      // row read the same, so the page never tells which of them names a row.
      const ruled = await submit(notices.rule([postTarget(quotingOne), postTarget(plain), missingPost()]));
      expect((await status(ruled.ref, ruled.token!)).items.map((item) => [item.position, item.scope, item.outcome])).toEqual([[1, null, null], [2, null, null], [3, null, null]]);
    });

    test("an account named by a handle it has left: on that path an urgent case on the account, its posts frozen, and the alert; on a rule the same handle names nothing", async () => {
      const author = await w.account();
      const { postId } = await imagePost(w.apiDb, 1, author.id);
      const left = `old_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${author.id}::uuid, now())`);
      const ruled = await submit(notices.rule([accountTarget(left)]));
      expect(await w.items(ruled.ref)).toMatchObject([{ target_type: "account", named_handle: left, case_id: null, outcome: "not_available" }]);
      expect((await w.items(ruled.ref))[0]!.target_id).not.toBe(author.id);
      expect(await postFrozen(w.apiDb, postId)).toBe(false);

      const answer = await submit(notices.csam([linkTarget(`${app}/u/${left.toUpperCase()}`)]));
      await settle();
      expect(await w.items(answer.ref)).toMatchObject([{ position: 1, target_type: "account", target_id: author.id, named_handle: left, suspect: true, outcome: null, case_lane: 0 }]);
      expect(await postFrozen(w.apiDb, postId)).toBe(true);
      expect(urgentMails()).toHaveLength(1);
      // The page shows the handle as it was named, never the one the profile holds now, and what the answer will concern.
      const page = await status(answer.ref, answer.token!);
      expect(page.items).toMatchObject([{ position: 1, link: `${app}/u/${left}`, scope: "account_suspect", suspect: true, outcome: null }]);
      expect(JSON.stringify(page)).not.toContain(author.handle);
    });
  });

  describe("the status page and the contact's two buttons", () => {
    test("the notice's own token and the mail's token both open the page; only the mail's tells whether the address is confirmed or stopped; anything else is not found", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      const email = w.address();
      const nobody = `nobody_${randomBytes(4).toString("hex")}`;
      const answer = await submit(notices.illegal([postTarget(postId), accountTarget(author.handle), missingPost(), accountTarget(nobody)], { email }));
      await settle();
      const page = await status(answer.ref, answer.token!);
      expect(NoticeStatus.parse(page)).toEqual(page);
      expect(page).toMatchObject({ ref: answer.ref, receivedAt: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/), contact: { given: true, confirmed: null, stopped: null } });
      const waiting = { suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
      expect(page.items).toEqual([
        { position: 1, link: `${app}/post/${postId}`, scope: null, ...waiting },
        { position: 2, link: `${app}/u/${author.handle}`, scope: "account", ...waiting },
        // A link to no row and a handle nobody holds read like the live targets beside them until the daily release: the
        // page never says which targets were live.
        { position: 3, link: expect.stringMatching(/[/]post[/][0-9a-f-]{36}$/), scope: null, ...waiting },
        { position: 4, link: `${app}/u/${nobody}`, scope: "account", ...waiting },
      ]);
      const byMail = await status(answer.ref, mailToken(email));
      expect(byMail).toEqual({ ...page, contact: { given: true, confirmed: false, stopped: false } });
      // On the path for child sexual abuse material too: a notice that names a handle nobody holds reads, link apart,
      // exactly as one that names a live account, so the page never says whether a handle names an account.
      const [onLive, onNobody] = [await submit(notices.csam([accountTarget(author.handle)])), await submit(notices.csam([accountTarget(nobody)]))];
      const withoutLink = async (notice: { ref: string; token?: string }) => (await status(notice.ref, notice.token!)).items.map(({ link: _link, ...rest }) => rest);
      expect(await withoutLink(onNobody)).toEqual(await withoutLink(onLive));
      expect(await withoutLink(onLive)).toMatchObject([{ position: 1, scope: "account_suspect", suspect: true, outcome: null }]);

      // A report sent signed in has no token: the page has no way in, whatever is typed.
      const reporter = await w.account();
      const signedIn = await submit({ ground: "rule", ruleId: "R1", targets: [postTarget(postId)] }, w.sender(reporter.session));
      const other = await submit(notices.rule([postTarget(postId)]));
      for (const [ref, token] of [[answer.ref, "A".repeat(43)], [answer.ref, other.token!], [other.ref, answer.token!], [other.ref, mailToken(email)], ["N-AAAAAAAAAA", answer.token!], [signedIn.ref, answer.token!]] as const) {
        await expect(status(ref, token)).rejects.toMatchObject({ code: "notice_not_found", status: 404 });
      }
      // A notice that left no name or address has no contact.
      expect((await status(other.ref, other.token!)).contact).toBeNull();
    });

    test("confirm and stop take the mail's token alone: the notice's own token, a notice without a contact and a wrong token are not found; a confirmation lifts a stop", async () => {
      const email = w.address();
      const answer = await submit(notices.illegal([missingPost()], { email }));
      const bare = await submit(notices.illegal([missingPost()]));
      await settle();
      const token = mailToken(email);
      const press = (ref: string, by: string, choice: "confirm" | "stop") => noticeContact(w.deps, { ref, token: by, choice }, w.sender().netHash);
      for (const choice of ["confirm", "stop"] as const) {
        for (const [ref, by] of [[answer.ref, answer.token!], [answer.ref, "A".repeat(43)], [bare.ref, bare.token!], [bare.ref, token], ["N-AAAAAAAAAA", token]] as const) {
          await expect(press(ref, by, choice)).rejects.toMatchObject({ code: "notice_not_found", status: 404 });
        }
      }
      expect((await status(answer.ref, token)).contact).toEqual({ given: true, confirmed: false, stopped: false });
      await press(answer.ref, token, "stop");
      expect((await status(answer.ref, token)).contact).toEqual({ given: true, confirmed: false, stopped: true });
      await press(answer.ref, token, "confirm");
      expect((await status(answer.ref, token)).contact).toEqual({ given: true, confirmed: true, stopped: false });
      // A confirmed address has no cap: a second notice's receipt is sent, not folded.
      const second = await submit(notices.illegal([missingPost()], { email }));
      await settle();
      expect((await w.notice(second.ref))!.receipt).toBe("sent");
      // To whoever holds only the token on screen, the page says nothing of what korbat knows about the address.
      expect((await status(second.ref, second.token!)).contact).toEqual({ given: true, confirmed: null, stopped: null });
    });

    test("a notice that names a confirmed or a stopped address is answered exactly as one that names an address korbat never saw", async () => {
      const [confirmed, stopped, fresh] = [w.address(), w.address(), w.address()];
      for (const [email, choice] of [[confirmed, "confirm"], [stopped, "stop"]] as const) {
        const first = await submit(notices.illegal([missingPost()], { email }));
        await settle();
        await noticeContact(w.deps, { ref: first.ref, token: mailToken(email), choice }, w.sender().netHash);
      }
      const shape = (value: unknown) => JSON.stringify(value).replace(/N-[A-Z2-7]{10}/g, "N-ref").replace(/"[A-Za-z0-9_-]{43}"/g, '"token"').replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z/g, "time").replace(/post[/][0-9a-f-]{36}/g, "post/id");
      const answers: string[] = [];
      const pages: string[] = [];
      for (const email of [confirmed, stopped, fresh]) {
        const answer = await submit(notices.illegal([missingPost()], { email }));
        answers.push(shape(answer));
        pages.push(shape(await status(answer.ref, answer.token!)));
      }
      expect(new Set(answers).size).toBe(1);
      expect(new Set(pages).size).toBe(1);
    });

    test("the two routes share one count: 30 an hour for each network, and a refused read is counted too", async () => {
      expect(STATUS_READS_PER_HOUR).toBe(30);
      const answer = await submit(notices.rule([missingPost()]));
      const net = w.sender().netHash;
      for (let n = 0; n < 20; n++) await noticeStatus(w.deps, { ref: answer.ref, token: answer.token! }, net);
      for (let n = 0; n < 10; n++) expect(await refusal(noticeContact(w.deps, { ref: answer.ref, token: answer.token!, choice: "stop" }, net))).toBe("notice_not_found");
      await expect(noticeStatus(w.deps, { ref: answer.ref, token: answer.token! }, net)).rejects.toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: expect.any(Number) });
      expect(await refusal(noticeContact(w.deps, { ref: answer.ref, token: answer.token!, choice: "confirm" }, net))).toBe("rate_limited");
      // Another network reads on.
      expect((await status(answer.ref, answer.token!)).ref).toBe(answer.ref);
    });

    test("an item korbat added for a quoted post is listed only once a release has shown its origin's outcome or its own: before it, notices about a quoting post, a plain post and a link to no row read the same", async () => {
      // The decisions commit, so a real staff key confirms them, as the console would.
      const decider = deciderWorld(w.apiDb);
      try {
        const [admin, quotedAuthor, author] = [await decider.staff("admin"), await w.account(), await w.account()];
        const [quotedOne, quotedTwo, quotedThree] = [(await imagePost(w.apiDb, 1, quotedAuthor.id)).postId, (await imagePost(w.apiDb, 1, quotedAuthor.id)).postId, (await imagePost(w.apiDb, 1, quotedAuthor.id)).postId];
        const quoting = (quoteOfId: string) => newPostRow(w.apiDb, author.id, { quoteOfId });
        const [quotingOne, quotingTwo, quotingThree, plain] = [await quoting(quotedOne), await quoting(quotedTwo), await quoting(quotedThree), await newPostRow(w.apiDb, author.id)];
        const onQuoting = await submit(notices.csam([postTarget(quotingOne)]));
        const onOther = await submit(notices.csam([postTarget(quotingTwo)]));
        // Two named posts, the second of which quotes: its added item stands at position 12.
        const onTwo = await submit(notices.csam([postTarget(plain), postTarget(quotingThree)]));
        const onPlain = await submit(notices.csam([postTarget(plain)]));
        const onNothing = await submit(notices.csam([missingPost()]));
        // Each quoting post brought an item for the post it quotes; the page does not list it yet.
        for (const notice of [onQuoting, onOther]) expect((await w.items(notice.ref)).map((item) => item.position)).toEqual([1, 11]);
        expect((await w.items(onTwo.ref)).map((item) => item.position)).toEqual([1, 2, 12]);
        const withoutLink = async (notice: { ref: string; token?: string }) => (await status(notice.ref, notice.token!)).items.map(({ link: _link, ...rest }) => rest);
        const waiting = { scope: null, suspect: true, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
        for (const notice of [onQuoting, onOther, onPlain, onNothing]) expect(await withoutLink(notice)).toEqual([{ position: 1, ...waiting }]);
        expect(await withoutLink(onTwo)).toEqual([{ position: 1, ...waiting }, { position: 2, ...waiting }]);

        // An admin answers the first quoting post's own case, and the post that the second one quotes.
        const caseAt = async (ref: string, position: number) => (await w.items(ref)).find((item) => item.position === position)!.case_id!;
        for (const caseId of [await caseAt(onQuoting.ref, 1), await caseAt(onOther.ref, 11)]) {
          expect(typeof (await decider.decideAs(admin, caseId, { kind: "final", outcome: "no_violation" }))).toBe("object");
        }
        // Decided and not yet released: still the named item alone.
        for (const notice of [onQuoting, onOther]) expect(await withoutLink(notice)).toEqual([{ position: 1, ...waiting }]);
        await w.apiDb.execute(sql`select public.release_outcomes(now())`);

        // The origin's outcome is released: the added item is listed directly after it, waiting, and marked as added for item 1.
        expect((await status(onQuoting.ref, onQuoting.token!)).items.map((item) => [item.position, item.link, item.quotedBy, item.outcome])).toEqual([
          [1, `${app}/post/${quotingOne}`, null, "no_violation"],
          [11, `${app}/post/${quotedOne}`, 1, null],
        ]);
        // The added item's own outcome is released while its origin still waits: it is listed with it, since from the
        // release an outcome shows on the page and the window to ask for a re-examination runs. The origin's waiting past
        // this release already told that it names a row: a link to no row was answered by the same release.
        const other = (await status(onOther.ref, onOther.token!)).items;
        expect(other.map((item) => [item.position, item.link, item.quotedBy, item.outcome])).toEqual([
          [1, `${app}/post/${quotingTwo}`, null, null],
          [11, `${app}/post/${quotedTwo}`, 1, "no_violation"],
        ]);
        expect(other[1]!.reexamination).toMatchObject({ open: true });
        // Nothing of the third pair is released: its added item stays unlisted beside the two named posts.
        expect((await withoutLink(onTwo)).map((item) => [item.position, item.outcome])).toEqual([[1, null], [2, null]]);
        // The notices that brought no item read one item as before: the plain post waits, the link to no row is answered.
        expect((await withoutLink(onPlain)).map((item) => item.outcome)).toEqual([null]);
        expect((await withoutLink(onNothing)).map((item) => item.outcome)).toEqual(["not_available"]);

        // Once the third pair's quoting post is answered and released, its added item is listed directly after it.
        expect(typeof (await decider.decideAs(admin, await caseAt(onTwo.ref, 2), { kind: "final", outcome: "no_violation" }))).toBe("object");
        await w.apiDb.execute(sql`select public.release_outcomes(now())`);
        expect((await status(onTwo.ref, onTwo.token!)).items.map((item) => [item.position, item.quotedBy, item.outcome])).toEqual([[1, null, null], [2, null, "no_violation"], [12, 2, null]]);
      } finally {
        await w.cleanUp();
        await decider.close();
      }
    });

    test("after the daily release an item answered at intake shows its outcome and its day, and cannot be examined again; the outcomes the page can show are the database's", async () => {
      const outcomes = await w.apiDb.execute<{ value: string }>(sql`select unnest(enum_range(null::item_outcome))::text as value`);
      expect(outcomes.map((row) => row.value)).toEqual([...ITEM_OUTCOMES]);
      const answer = await submit(notices.rule([missingPost(), accountTarget(`nobody_${randomBytes(4).toString("hex")}`)]));
      expect((await status(answer.ref, answer.token!)).items.map((item) => [item.outcome, item.scope])).toEqual([[null, null], [null, "account"]]);
      // The release takes every item answered before its cut-off; the cut-off is the statement's own time.
      await w.apiDb.execute(sql`select public.release_outcomes(now())`);
      const today = new Date().toISOString().slice(0, 10);
      const page = await status(answer.ref, answer.token!);
      for (const item of page.items) expect(item).toMatchObject({ outcome: "not_available", decidedOn: today, sealed: false, unseen: false, changed: false, reexamination: null });
      // The scope is what the notice named, as it was before the release: it never depended on what the handle named. After
      // this outcome the page and the app add no scope sentence.
      expect(page.items.map((item) => item.scope)).toEqual([null, "account"]);
    });

    test("a decided item says nothing before the release; after it, its outcome and day, whether it can be examined again and until when, and the marks of a seal and of an answer given with the images out of sight", async () => {
      // Decisions that commit are confirmed by a real staff key, as the console confirms them.
      const decider = deciderWorld(w.apiDb);
      try {
        const [admin, author, sealedAuthor] = [await decider.staff("admin"), await w.account(), await w.account()];
        const plain = await newPostRow(w.apiDb, author.id);
        const frozen = (await imagePost(w.apiDb, 1, author.id)).postId;
        await imagePost(w.apiDb, 2, sealedAuthor.id);
        // A rule notice about a post and its author's account; a notice of illegality and one of child sexual abuse
        // material about another post, which land in one case; and one of the latter kind about an account.
        const quoting = await newPostRow(w.apiDb, author.id, { quoteOfId: plain });
        const ruled = await submit(notices.rule([postTarget(plain), accountTarget(author.handle)]));
        const quote = await submit(notices.rule([postTarget(quoting), missingPost()]));
        const onLaw = await submit(notices.illegal([postTarget(frozen)]));
        const suspect = await submit(notices.csam([postTarget(frozen)]));
        // A rule report about the account stands in the case the notice of child sexual abuse material about it joins.
        const beside = await submit(notices.rule([accountTarget(sealedAuthor.handle)]));
        const sealing = await submit(notices.csam([accountTarget(sealedAuthor.handle)]));
        const caseOf = async (ref: string) => (await w.items(ref))[0]!.case_id!;
        const decide = async (caseId: string, input: DecisionInput) => {
          const outcome = await decider.decideAs(admin, caseId, input);
          expect(typeof outcome, String(outcome)).toBe("object");
        };
        // No breach in the first post (its author's account stays undecided) nor in the post that quotes it; no action on
        // the third, decided while its images were out of staff's sight, which answers both of its notices; and the
        // account's images sealed for good, which answers both of its reports.
        await decide(await caseOf(ruled.ref), { kind: "final", outcome: "no_violation" });
        await decide(await caseOf(quote.ref), { kind: "final", outcome: "no_violation" });
        expect(await caseOf(onLaw.ref)).toBe(await caseOf(suspect.ref));
        await decide(await caseOf(onLaw.ref), { kind: "final", outcome: "no_violation" });
        expect(await caseOf(beside.ref)).toBe(await caseOf(sealing.ref));
        await decide(await caseOf(sealing.ref), { kind: "final", ruleId: "R2", actions: [act("seal_media")] });

        const silent = { outcome: null, decidedOn: null, sealed: false, unseen: false, changed: false, reexamination: null };
        for (const answer of [ruled, quote, onLaw, suspect, beside, sealing]) {
          for (const item of (await status(answer.ref, answer.token!)).items) expect(item).toMatchObject(silent);
        }
        // Before the release a decided post that quotes another reads as the link to no row beside it, and the rule report
        // about the account as any item about an account: no scope tells what was decided, or what exists.
        expect((await status(quote.ref, quote.token!)).items.map((item) => item.scope)).toEqual([null, null]);
        expect((await status(beside.ref, beside.token!)).items.map((item) => item.scope)).toEqual(["account"]);
        await w.apiDb.execute(sql`select public.release_outcomes(now())`);
        const today = new Date().toISOString().slice(0, 10);

        // With its released outcome the quoting post's item says that its answer concerns its own text and images; the
        // link that named nothing has no scope.
        expect((await status(quote.ref, quote.token!)).items.map((item) => [item.outcome, item.scope])).toEqual([["no_violation", "quote"], ["not_available", null]]);

        const [post, account] = (await status(ruled.ref, ruled.token!)).items;
        expect(post).toMatchObject({ position: 1, outcome: "no_violation", decidedOn: today, scope: null, sealed: false, unseen: false, changed: false, reexamines: false });
        // The window runs six calendar months from the release.
        expect(post!.reexamination).toEqual({ open: true, until: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/) });
        const sixMonths = new Date();
        sixMonths.setUTCMonth(sixMonths.getUTCMonth() + 6);
        expect(Math.abs(new Date(post!.reexamination!.until).getTime() - sixMonths.getTime())).toBeLessThan(4 * 24 * HOUR);
        // The item about the account is still waiting, and says so by saying nothing.
        expect(account).toMatchObject({ position: 2, scope: "account", ...silent });

        // The notice of illegality was answered while nobody could open the post's images: it reads "no action for now",
        // and can be examined again. The suspect item itself is not marked that way.
        expect((await status(onLaw.ref, onLaw.token!)).items).toMatchObject([{ outcome: "no_violation", decidedOn: today, suspect: false, unseen: true, sealed: false, scope: null, reexamination: { open: true } }]);
        expect((await status(suspect.ref, suspect.token!)).items).toMatchObject([{ outcome: "no_violation", decidedOn: today, suspect: true, unseen: false, sealed: false, scope: null, reexamination: { open: true } }]);
        // A seal: the answer concerns the images on the account's posts, and a restriction is not examined again.
        expect((await status(sealing.ref, sealing.token!)).items).toMatchObject([{ outcome: "restricted_rule", decidedOn: today, suspect: true, sealed: true, unseen: false, scope: "account_suspect", reexamination: null }]);
        // The rule report the same decision answered is not suspect, and its answer concerns those images all the same.
        expect((await status(beside.ref, beside.token!)).items).toMatchObject([{ outcome: "restricted_rule", suspect: false, sealed: true, scope: "account_suspect", reexamination: null }]);
      } finally {
        await w.cleanUp();
        await decider.close();
      }
    });
  });

  describe("the handle as it was named", () => {
    test("after the account takes another handle, the status page and a receipt sent later still show the one the notice named, never the new one", async () => {
      const author = await w.account();
      const email = w.address();
      const named = author.handle;
      // The first try of the receipt fails, so it is sent after the rename.
      w.mailer.mode = "fail";
      const answer = await submit(notices.illegal([accountTarget(named.toUpperCase())], { email }));
      await settle();
      const renamed = `new_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`update profiles set handle = ${renamed} where id = ${author.id}::uuid`);
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${named}, ${author.id}::uuid, now())`);
      w.mailer.mode = "deliver";
      expect(await sendReceipt(w.deps, (await w.notice(answer.ref))!.id)).toBe("sent");
      expect(w.mailer.to(email, "notice_received")[0]!.data.items).toBe(`${app}/u/${named}`);
      const page = await status(answer.ref, answer.token!);
      expect(page.items).toMatchObject([{ position: 1, link: `${app}/u/${named}`, scope: "account" }]);
      expect(JSON.stringify(page)).not.toContain(renamed);
      expect(JSON.stringify(w.mailer.sent)).not.toContain(renamed);
    });
  });

  describe("a notice on the path for child sexual abuse material racing the deletion of what it names (gate K)", () => {
    /** The moderation module over an open transaction: its intake is then a savepoint, and its locks are held until the test lets the transaction end. */
    const depsOver = (tx: DbTx): ModerationDeps => ({ ...w.deps, apiDb: tx as unknown as Db, social: socialForModeration(tx as unknown as Db), media: casesMedia(tx), background: createBackground(pino({ level: "silent" })) });

    const deleters = [
      ["the author's deletion of the post", (db: Db | DbTx, authorId: string, postId: string) => deleteByAuthor(db, authorId, postId)],
      ["the account's purge", (db: Db | DbTx, authorId: string) => purgeAccount(db, authorId)],
    ] as const;
    const targets = [
      ["the post", (made: { postId: string }) => postTarget(made.postId)],
      ["the account", (made: { handle: string }) => accountTarget(made.handle)],
    ] as const;

    for (const [deleterName, remove] of deleters) {
      for (const [targetName, target] of targets) {
        test(`${deleterName}, a notice about ${targetName}: when the notice locks first every image row it reaches is kept; no error, no deadlock`, async () => {
          const author = await w.account();
          const { postId, mediaIds } = await imagePost(w.apiDb, 3, author.id);
          const [locked, wait] = [gate(), gate()];
          let noticing: Promise<void> = Promise.resolve();
          let removing: Promise<void> = Promise.resolve();
          try {
            noticing = withLockTimeout(w.apiDb, async (tx) => {
              const deps = depsOver(tx);
              w.remember(await submitNotice(deps, notices.csam([target({ postId, handle: author.handle })]), w.sender()));
              await deps.background.settle();
              locked.open();
              await wait.opened;
            });
            await Promise.race([locked.opened, noticing]);
            removing = remove(w.apiDb, author.id, postId);
            // The removal waits for a lock the notice's open transaction holds.
            await untilBlocked(w.apiDb, "");
            wait.open();
            await noticing;
            await removing;
            // The keep trigger read the freeze after the wait and saw the committed item.
            expect(await existing(mediaIds)).toEqual([...mediaIds].sort());
            expect(await postFrozen(w.apiDb, postId)).toBe(true);
            const [post] = await w.migrateDb.execute<{ state: string }>(sql`select state from posts where id = ${postId}::uuid`);
            expect(post!.state).toBe("deleted_by_author");
          } finally {
            wait.open();
            await Promise.allSettled([noticing, removing]);
          }
        });

        test(`${deleterName}, a notice about ${targetName}: when the deletion locks first the notice waits, is stored without an error, and no image row is kept`, async () => {
          const author = await w.account();
          const { postId, mediaIds } = await imagePost(w.apiDb, 3, author.id);
          const [removed, wait] = [gate(), gate()];
          let removing: Promise<void> = Promise.resolve();
          let noticing: Promise<{ ref: string; token?: string } | null> = Promise.resolve(null);
          try {
            removing = withLockTimeout(w.apiDb, async (tx) => {
              await remove(tx, author.id, postId);
              removed.open();
              await wait.opened;
            });
            await Promise.race([removed.opened, removing]);
            noticing = submitNotice(w.deps, notices.csam([target({ postId, handle: author.handle })]), w.sender()).then(w.remember);
            await untilBlocked(w.apiDb, "");
            wait.open();
            await removing;
            const answer = (await noticing)!;
            // The report came too late for these images, as it would have a moment later; it still waits for an admin.
            expect(await existing(mediaIds)).toEqual([]);
            expect(await w.items(answer.ref)).toMatchObject([{ position: 1, suspect: true, outcome: null, case_lane: 0 }]);
            expect(await postFrozen(w.apiDb, postId)).toBe(true);
          } finally {
            wait.open();
            await Promise.allSettled([removing, noticing]);
          }
        });
      }
    }
  });

  test("this file left no row behind: the moderation tables, the posts and profiles, and the four auth tables of moderation cases hold what they held before it", async () => {
    await w.cleanUp();
    expect(await w.counts()).toEqual(before);
    expect(await authCaseCounts(w.migrateDb)).toEqual(beforeAuth);
  });
});
