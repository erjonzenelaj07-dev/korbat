import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_RULES, type OrderView } from "@korbat/contracts";
import { ORDER_NOTICE, statementParagraphs } from "@korbat/rules";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { STAFF_USAGE, runStaffCommand } from "../../src/cli/staff";
import { MemoryJobLock } from "../../src/lib/jobs";
import { dispatchRound } from "../../src/moderation/dispatch";
import { loadConfig } from "../../src/config";
import { authorCases, authorDecisionView, authorFacts, exportedDecisions } from "../../src/moderation/author";
import { ModerationError } from "../../src/moderation/context";
import { decisionStatement, mailTemplateOf } from "../../src/moderation/statement";
import { orderNoticeOf } from "../../src/moderation/statement-repo";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { CHANNEL_TABLES, aPost, act, ground, imagePost, intake, removeDecided, removeFixtures, rowCounts } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures, outboxSince } from "./notify-fixtures";
import { ORDER_TABLES, effectForTest, effectParams, orderForTest, removeOrderAlerts } from "./orders-fixtures";
import { newProfile } from "./social-fixtures";

vi.setConfig({ testTimeout: 180_000 });

/**
 * The author's notice of an order (3f design, sections 6.3, 7.7 step 3, 7.10 and 9.2; invariants 3, 4's commands and
 * alert, and 28). With Section C the notice is held: nothing reaches the author, and a decision of korbat's own about
 * the post taken during the hold is held with it, while its reporter is answered as always. order_notices_release()
 * tells nothing before the hold's end and everything at it, stamping clock_timestamp(); a correction that holds the
 * order decision's row makes the release wait for it. The authority's words recorded after the author was told make the
 * notice's mail owed again, as order_notice_added. The hold's commands extend, end and move a hold, and the daily
 * hold_ending warns before any release. The effects commit with real keys; the last test removes what they made.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the author's notice of an order", () => {
  let w: NoticesWorld;
  let world: DeciderWorld;
  let moderator: RealStaff;
  let admin: RealStaff;
  let before: Record<string, number>;
  const posts: string[] = [];
  const people: string[] = [];
  const started = new Date();
  let appOrigin: string;

  beforeAll(async () => {
    appOrigin = loadConfig().APP_ORIGIN;
    w = noticesWorld();
    world = deciderWorld(w.apiDb);
    before = await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES]);
    moderator = await world.staff("moderator");
    admin = await world.staff("admin");
  }, 90_000);
  afterAll(async () => {
    await removeDecided(world.migrateDb, posts, [moderator.id, admin.id]);
    await removeOrderAlerts(world.migrateDb, started);
    // alert_steps(), which the last test runs, also writes its daily test push.
    await world.migrateDb.execute(sql`delete from public.alert_outbox where kind = 'alert_test' and created_at >= ${started.toISOString()}::timestamptz`);
    await removeFixtures(world.migrateDb, people);
    await world.close({ keepStaff: true });
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
    await closeNotifyFixtures();
    await w.close();
  });

  /** A post of a new author, kept for the cleanup. */
  async function post(images = 0) {
    const made = await imagePost(w.apiDb, images);
    posts.push(made.postId);
    people.push(made.authorId);
    return made;
  }
  async function effect(view: OrderView): Promise<OrderView> {
    const outcome = await effectForTest(world, moderator, view.id, effectParams(view));
    if (typeof outcome === "string") throw new Error(`the effect was not recorded: ${outcome}`);
    return outcome;
  }
  const release = async () => (await w.apiDb.execute<{ told: number }>(sql`select public.order_notices_release() as told`))[0]!.told;
  const told = async (decisionId: string) =>
    (await w.apiDb.execute<{ informed: boolean; mail: string; informed_at: string | null }>(
      sql`select informed_at is not null as informed, author_mail::text as mail, to_char(informed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as informed_at from public.decisions where id = ${decisionId}::uuid`,
    ))[0]!;
  const env = () => ({ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE!, HOME_STATE: "DE", APP_ORIGIN: appOrigin });
  async function cli(args: string[], input?: string) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, env(), { log: (line) => lines.push(line), error: (line) => lines.push(line) }, async () => Buffer.from(input ?? "", "utf8"));
    return { code, text: lines.join(" ") };
  }

  test("a held notice tells nobody, on any path; a decision of korbat's own about the post is held with it and its reporter answered; the release tells both at the hold's end and not before", async () => {
    const p = await post(1);
    const reporter = await newProfile(w.apiDb);
    people.push(reporter.id);
    const reported = await intake(w.apiDb, ground.rule(reporter.id), aPost(p.postId));
    const caseId = reported.items[0]!.caseId!;
    const order = await orderForTest(w.apiDb, moderator, { posts: [p.postId], sectionC: true });
    const done = await effect(order);
    const decisionId = done.items[0]!.decisionId!;
    expect(await told(decisionId)).toMatchObject({ informed: false, mail: "none" });
    // During the hold a removal under a rule: recorded, held, and its reporter's item answered.
    const removal = await world.decideAs(moderator, caseId, { kind: "final", actions: [act("remove")] });
    if (typeof removal === "string") throw new Error(removal);
    expect(await told(removal.decisionId)).toMatchObject({ informed: false, mail: "none" });
    const [item] = await w.apiDb.execute<{ answered: boolean }>(sql`select answered_by is not null as answered from public.intake_items where case_id = ${caseId}::uuid and reporter_account_id = ${reporter.id}::uuid`);
    expect(item!.answered).toBe(true);
    // Nothing on the author's side: no row, no screen, no chip, no export entry.
    const deps = { apiDb: w.apiDb };
    expect((await authorCases(deps, p.authorId)).decisions).toEqual([]);
    await expect(authorDecisionView(deps, p.authorId, decisionId)).rejects.toBeInstanceOf(ModerationError);
    await expect(authorDecisionView(deps, p.authorId, removal.decisionId)).rejects.toBeInstanceOf(ModerationError);
    expect((await authorFacts(deps, p.authorId, [p.postId])).size).toBe(0);
    expect(await exportedDecisions(deps, p.authorId)).toEqual([]);
    // The API role cannot write a decision's informed_at.
    const refused = await w.apiDb.execute(sql`update public.decisions set informed_at = now() where id = ${decisionId}::uuid`).then(
      () => "written",
      () => "refused",
    );
    expect(refused).toBe("refused");
    // Before the end, nothing is told; an end a moment ahead, and at it everything is.
    expect(await release()).toBe(0);
    await world.migrateDb.execute(sql`update public.legal_orders set authority_hold_until = clock_timestamp() + make_interval(secs => 2) where id = ${order.id}::uuid`);
    expect(await release()).toBe(0);
    const [end] = await w.apiDb.execute<{ until: string }>(sql`select to_char(public.order_hold_until(${order.id}::uuid) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as until`);
    await sleep(2_200);
    expect(await release()).toBe(2);
    const order_told = await told(decisionId);
    expect(order_told).toMatchObject({ informed: true, mail: "pending" });
    // Never before the end: the stamp is the clock's at the release.
    expect(Date.parse(order_told.informed_at!)).toBeGreaterThanOrEqual(Date.parse(end!.until));
    expect(await told(removal.decisionId)).toMatchObject({ informed: true, mail: "pending" });
    const [event] = await w.apiDb.execute<{ n: number }>(sql`select count(*)::int as n from public.legal_order_events where order_id = ${order.id}::uuid and kind = 'notice_released' and via = 'system'`);
    expect(event!.n).toBe(1);
    // Now the author reads both, and the notice says that it was held until now.
    expect((await authorCases(deps, p.authorId)).decisions.map((d) => [d.kind, d.order ?? null])).toEqual([
      ["final", null],
      ["order", "disabled"],
    ]);
    const view = await authorDecisionView(deps, p.authorId, decisionId);
    expect(view.content).toBeNull();
    expect(view.appealUntil).toBeNull();
    expect(view.order).toMatchObject({ held: true, kind: "tco_removal", withholdAuthor: true });
    expect(statementParagraphs(view, { texts: view.orderTexts ?? null }).join(" ")).toContain("korbat was not allowed to tell you until now.");
    // The chip: a disabled post has none (its level is disabled, which no list shows).
    expect((await authorFacts(deps, p.authorId, [p.postId])).size).toBe(0);
    // A second release tells nothing more.
    expect(await release()).toBe(0);
  });

  test("the release waits for a transaction that holds an untold order decision's row, and then tells it", async () => {
    const p = await post();
    const order = await orderForTest(w.apiDb, moderator, { posts: [p.postId], sectionC: true });
    const done = await effect(order);
    const decisionId = done.items[0]!.decisionId!;
    await world.migrateDb.execute(sql`update public.legal_orders set hold_ended_at = now(), hold_end_reason = 'released_by_authority' where id = ${order.id}::uuid`);
    let finished = false;
    let releasing: Promise<number> | null = null;
    await w.apiDb.transaction(async (tx) => {
      // What a correction of the order decision takes first.
      await tx.execute(sql`select 1 from public.decisions where id = ${decisionId}::uuid for share`);
      releasing = release().then((n) => {
        finished = true;
        return n;
      });
      await sleep(500);
      expect(finished).toBe(false);
    });
    expect(await releasing!).toBe(1);
    expect(await told(decisionId)).toMatchObject({ informed: true, mail: "pending" });
  });

  test("the authority's words recorded after the author was told make the notice's mail owed again, as order_notice_added, with the record's time; on a held notice nothing is mailed and the release's time counts", async () => {
    const p = await post();
    const order = await orderForTest(w.apiDb, moderator, { posts: [p.postId] });
    const done = await effect(order);
    const decisionId = done.items[0]!.decisionId!;
    // The first mail went (no address takes one here): what the dispatch round records.
    await world.migrateDb.execute(sql`update public.decisions set author_mail = 'sent', author_mail_at = now() where id = ${decisionId}::uuid`);
    const recorded = await cli(["order-texts", order.id, "--reasons"], "Les motifs de l'autorite.");
    expect(recorded.code).toBe(0);
    expect(recorded.text).toContain("1 authors are sent an email that the notice has grown");
    expect(await told(decisionId)).toMatchObject({ informed: true, mail: "pending" });
    const found = (await decisionStatement(w.apiDb, decisionId))!;
    expect(mailTemplateOf(found.statement, [], found.decision.authorMailAt !== null).template).toBe("order_notice_added");
    const notice = (await orderNoticeOf(w.apiDb, decisionId, "DE"))!;
    const [event] = await w.apiDb.execute<{ at: string }>(sql`select to_char(max(at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from public.legal_order_events where order_id = ${order.id}::uuid and kind = 'texts_recorded'`);
    expect([notice.texts.reasons, notice.texts.textsAt]).toEqual(["Les motifs de l'autorite.", event!.at]);
    // A held notice: the record changes no mail, and at the release the author holds the words from the release.
    const q = await post();
    const held = await orderForTest(w.apiDb, moderator, { posts: [q.postId], sectionC: true });
    const heldDone = await effect(held);
    const heldDecision = heldDone.items[0]!.decisionId!;
    const quiet = await cli(["order-texts", held.id, "--reasons"], "Reasons.");
    expect(quiet.text).toContain("The notice is held: it will show the text once it is released");
    expect(await told(heldDecision)).toMatchObject({ informed: false, mail: "none" });
    expect((await cli(["order-hold-end", held.id, "--reason", "released_by_authority", "--how", "the authority's letter"])).code).toBe(0);
    expect(await release()).toBe(1);
    const afterRelease = (await orderNoticeOf(w.apiDb, heldDecision, "DE"))!;
    expect(afterRelease.texts.textsAt).toBe(afterRelease.facts.informedAt);
    expect(statementParagraphs((await decisionStatement(w.apiDb, heldDecision))!.statement, { texts: afterRelease.texts }).join(" ")).not.toContain("korbat added the authority's words");
  });

  test("the hold's commands: one extension of 42 days, refused a second time and after the release; a DSA order's end is the authority's, and with none nothing is released; ending a hold tells at the next round", async () => {
    const p = await post();
    const order = await orderForTest(w.apiDb, moderator, { posts: [p.postId], sectionC: true });
    const done = await effect(order);
    const until = async (id: string) => (await w.apiDb.execute<{ until: string | null }>(sql`select public.order_hold_until(${id}::uuid)::text as until`))[0]!.until;
    const first = await until(order.id);
    const extended = await cli(["order-hold-extend", order.id, "--received", new Date(Date.now() - 60_000).toISOString(), "--how", "the authority's reasoned decision"]);
    expect(extended.code).toBe(0);
    const [days] = await w.apiDb.execute<{ days: number }>(sql`select extract(day from public.order_hold_until(${order.id}::uuid) - ${first}::timestamptz)::int as days`);
    expect(days!.days).toBe(ORDER_RULES.holdExtensionDays);
    const again = await cli(["order-hold-extend", order.id, "--received", new Date(Date.now() - 60_000).toISOString(), "--how", "again"]);
    expect([again.code, again.text]).toEqual([1, expect.stringContaining("already extended once")]);
    // Ended as korbat's own mistake is refused while the first period of an extended hold runs; another reason ends it.
    expect((await cli(["order-hold-end", order.id, "--reason", "not_ordered", "--how", "x"])).code).toBe(1);
    expect((await cli(["order-hold-end", order.id, "--reason", "annulled", "--how", "the court's ruling"])).code).toBe(0);
    expect(await release()).toBeGreaterThanOrEqual(1);
    expect(await told(done.items[0]!.decisionId!)).toMatchObject({ informed: true });
    const late = await cli(["order-hold-extend", order.id, "--received", new Date(Date.now() - 60_000).toISOString(), "--how", "late"]);
    expect([late.code, late.text]).toEqual([1, expect.stringContaining("already released")]);
    // A DSA order whose author must not be told, given effect as urgent by an admin: no end until the authority names one.
    const d = await post();
    const dsa = await orderForTest(w.apiDb, admin, { kind: "dsa_art9", posts: [d.postId], sectionC: true });
    const urgent = await effectForTest(world, admin, dsa.id, { ...effectParams(dsa), urgent: true });
    if (typeof urgent === "string") throw new Error(urgent);
    expect(await until(dsa.id)).toBe("infinity");
    expect((await cli(["order-hold-extend", dsa.id, "--received", new Date().toISOString(), "--how", "x"])).code).toBe(1);
    expect(await release()).toBe(0);
    const named = await cli(["order-hold-until", dsa.id, new Date(Date.now() + 90 * 86_400_000).toISOString(), "--basis", "the order's sentence 3", "--how", "read in the order"]);
    expect(named.code).toBe(0);
    expect(named.text).toContain("held until");
    expect(await release()).toBe(0);
    // An end in the past changes nothing without --release.
    const past = await cli(["order-hold-until", dsa.id, new Date(Date.now() - 60_000).toISOString(), "--basis", "b", "--how", "h"]);
    expect([past.code, past.text]).toEqual([1, expect.stringContaining("give --release")]);
  });

  test("the dispatch round releases what a hold no longer keeps before its statements, with one audit row order_notices_released by the system", async () => {
    const p = await post();
    const order = await orderForTest(w.apiDb, moderator, { posts: [p.postId], sectionC: true });
    const done = await effect(order);
    expect((await cli(["order-hold-end", order.id, "--reason", "not_authentic", "--how", "the register has no such authority"])).code).toBe(0);
    const report = await dispatchRound(world.moderation.deps, new MemoryJobLock());
    expect(report.noticesReleased).toBe(1);
    const [audit] = await w.apiDb.execute<{ actor_id: string; metadata: { count: number } }>(
      sql`select actor_id, metadata from public.audit_log where action = 'order_notices_released' order by chain_seq desc limit 1`,
    );
    expect([audit!.actor_id, audit!.metadata.count]).toEqual([SYSTEM_ACTOR_ID, 1]);
    // The statement's step tried its mail in the same round; no address takes one here, so it stays owed, and is not
    // given up for the weeks it was held: a mail is owed from its telling.
    expect(await told(done.items[0]!.decisionId!)).toMatchObject({ informed: true, mail: "pending" });
    const notice = (await orderNoticeOf(w.apiDb, done.items[0]!.decisionId!, "DE"))!;
    expect([notice.facts.held, notice.facts.holdEndReason]).toEqual([true, "not_authentic"]);
  });

  test("hold_ending warns every staff account daily in the last days before a hold's end, and not before", async () => {
    const p = await post();
    const order = await orderForTest(w.apiDb, moderator, { posts: [p.postId], sectionC: true });
    await effect(order);
    const since = new Date();
    // The other held notices of this file end later than the warning's days; this one ends sooner.
    await world.migrateDb.execute(sql`update public.legal_orders set authority_hold_until = now() + make_interval(days => ${ORDER_RULES.holdWarningDays + 3}) where id = ${order.id}::uuid`);
    await world.migrateDb.execute(sql`delete from public.alert_outbox where kind = 'hold_ending'`);
    await w.apiDb.execute(sql`select public.alert_steps()`);
    const none = await outboxSince(world.migrateDb, "hold_ending", since);
    await world.migrateDb.execute(sql`update public.legal_orders set authority_hold_until = now() + make_interval(days => 2) where id = ${order.id}::uuid`);
    await w.apiDb.execute(sql`select public.alert_steps()`);
    const warned = await outboxSince(world.migrateDb, "hold_ending", since);
    expect(none).toEqual([]);
    expect(warned).toHaveLength(1);
    expect(warned[0]!.facts.count).toBeGreaterThanOrEqual(1);
    expect([warned[0]!.priority, warned[0]!.scope]).toEqual([3, "all"]);
    await w.apiDb.execute(sql`select public.alert_steps()`);
    expect((await outboxSince(world.migrateDb, "hold_ending", since)).length).toBe(warned.length);
    // The notice's words of the hold do not depend on its own warning.
    expect(ORDER_NOTICE.heldUntilNow.tco_removal("a", "b")).toContain("must not be told");
    expect(STAFF_USAGE).toContain("order-hold-end");
  });
});
