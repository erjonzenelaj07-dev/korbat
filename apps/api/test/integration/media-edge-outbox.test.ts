import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MEASURES, type ActionKind } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { edgeAdapterFrom } from "../../src/media/edge-adapter";
import { edgeRound } from "../../src/media/edge";
import { createMediaRepo } from "../../src/media/repo";
import { createSocialRepo } from "../../src/social/repo";
import { aPost, act, actionsOf, anAccount, decideIn, ground, imagePost, intake, newImageRow, newPostRow, newTestStaff, report, rowCounts, staffProfile, timed, uuids, type Runner, type TestStaff } from "./moderation-fixtures";
import { effectParams, effectWith, orderForTest } from "./orders-fixtures";
import { moveForTest, reportForTest } from "./release-fixtures";
import { ageCase } from "./retention-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// Each test runs dozens of decisions inside one open transaction: on a loaded machine that takes longer than the five
// seconds a test gets by default.
vi.setConfig({ testTimeout: 120_000 });

/**
 * The edge's outbox (3d design, sections 2 row 11, 6.3 and 7.4; 12.1 row 19; Task 3): every way an image stops being
 * public writes its outbox row in the transaction that hides it, through the two triggers post_media_purge and
 * posts_purge, whoever the writer is: a measure of 3c, 3e or 3f (moderation_apply), an author's deletion, the account's
 * purge, an R4 redaction, the disposal and a release, each with its cause. Nothing writes a row when nothing public
 * changed: a lift, an account's measure, an upload on no post. A row is written with the edge's adapter off, and the job
 * then closes it as off. Every test runs in a transaction that is rolled back, so nothing stays.
 */

/**
 * Every kind of MEASURES with what it writes when it is taken on a public post: `state` for each image it hides, or
 * nothing. Typed over every action kind, so a kind added to the ledger fails this file until it is listed here.
 */
const WRITES: Record<ActionKind, "state" | "none"> = {
  withhold: "state",
  remove: "state",
  seal_media: "state",
  withhold_media: "state",
  remove_media: "state",
  // A profile's resets, and every measure of 3e on an account: an account case names no post, and its ledger row none.
  reset_display_name: "none",
  reset_bio: "none",
  strike: "none",
  suspend: "none",
  terminate: "none",
  retire_handle: "none",
  warn_reporting: "none",
  restrict_reporting: "none",
  // 3f: a post disabled for an order leaves the public through its level.
  disable_by_order: "state",
  // A lift makes something public again: nothing has to leave a cache.
  restore: "none",
  unseal_media: "none",
  restore_media: "none",
  restore_display_name: "none",
  restore_bio: "none",
  overrule: "none",
  lift_suspension: "none",
  unretire_handle: "none",
  lift_reporting: "none",
  reinstate_by_order: "none",
};

type OutboxRow = {
  media_id: string;
  cause: string;
  outcome: string | null;
  attempts: number;
  done: boolean;
  due_now: boolean;
};

/** The outbox rows of these images, oldest first. */
const outbox = (q: Runner, mediaIds: readonly string[]) =>
  q.execute<OutboxRow>(sql`
    select media_id, cause, outcome, attempts, done_at is not null as done, next_at = now() as due_now
      from public.edge_purges where media_id = any(${uuids(mediaIds)}) order by id`);

/** For each image, in the order given, the causes its rows carry, each once and sorted. */
async function causes(q: Runner, mediaIds: readonly string[]): Promise<string[][]> {
  const rows = await outbox(q, mediaIds);
  return mediaIds.map((id) => [...new Set(rows.filter((row) => row.media_id === id).map((row) => row.cause))].sort());
}
const none = (n: number): string[][] => Array.from({ length: n }, () => []);
const each = (n: number, cause: string): string[][] => Array.from({ length: n }, () => [cause]);

describe.skipIf(!process.env.INTEGRATION)("integration: the edge's outbox, written by two triggers (3d Task 3)", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    const repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb, ["edge_purges"]);
  }, 120_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction rolled back, as the API's role unless the migrator's pool is given, with both staff profiles. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  /** A post of a new author with these many ready images, and its case opened by a report under R1. */
  async function reported(tx: DbTx, images = 2, by: "rule" | "csam" = "rule") {
    const p = await imagePost(tx, images);
    const { caseId } = await report(tx, aPost(p.postId), by);
    return { ...p, caseId };
  }
  /** The account's case, opened by an admin's finding under the rule. */
  const accountCase = async (tx: DbTx, accountId: string, rule: "R1" | "R4" | "R5") =>
    (await intake(tx, ground.finding(admin.id, rule), anAccount(accountId, "named"))).items[0]!.caseId!;

  test("the table names every kind of MEASURES, and only the measures that hide a post or an image write", () => {
    expect(Object.keys(WRITES).sort()).toEqual(Object.keys(MEASURES).sort());
    expect(Object.entries(WRITES).filter(([, writes]) => writes === "state").map(([kind]) => kind)).toEqual(["withhold", "remove", "seal_media", "withhold_media", "remove_media", "disable_by_order"]);
  });

  test("each measure on a post or an image writes, for each image it hid, its row with the cause state, due at once and with no outcome; an image it left public gets none", async () => {
    await inWorld(async (tx) => {
      const withheld = await reported(tx);
      await decideIn(tx, mod, withheld.caseId, { kind: "interim", actions: [act("withhold")] });
      expect(await causes(tx, withheld.mediaIds), "withhold").toEqual(each(2, WRITES.withhold));

      const removed = await reported(tx);
      await decideIn(tx, mod, removed.caseId, { kind: "final", actions: [act("remove")] });
      expect(await causes(tx, removed.mediaIds), "remove").toEqual(each(2, WRITES.remove));

      const oneWithheld = await reported(tx);
      await decideIn(tx, mod, oneWithheld.caseId, { kind: "interim", actions: [act("withhold_media", oneWithheld.mediaIds[0]!)] });
      expect(await causes(tx, oneWithheld.mediaIds), "withhold_media").toEqual([[WRITES.withhold_media], []]);

      const oneRemoved = await reported(tx);
      await decideIn(tx, mod, oneRemoved.caseId, { kind: "final", actions: [act("remove_media", oneRemoved.mediaIds[1]!)] });
      expect(await causes(tx, oneRemoved.mediaIds), "remove_media").toEqual([[], [WRITES.remove_media]]);

      const sealed = await reported(tx, 2, "csam");
      await decideIn(tx, admin, sealed.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
      expect(await causes(tx, sealed.mediaIds), "seal_media").toEqual(each(2, WRITES.seal_media));

      // 3f: "Disable for an order" through the module's own effect, which disables the post (its level, not its images).
      const ordered = await imagePost(tx, 2);
      const order = await orderForTest(tx, admin, { posts: [ordered.postId] });
      const view = await effectWith(tx, admin, order.id, effectParams(order));
      expect(view.items[0]!.disabledAt).not.toBeNull();
      expect(await causes(tx, ordered.mediaIds), "disable_by_order").toEqual(each(2, WRITES.disable_by_order));

      // Every row as the trigger wrote it: due at the transaction's start, no attempt, no outcome, not done.
      const all = await outbox(tx, [withheld, removed, oneWithheld, oneRemoved, sealed, ordered].flatMap((p) => p.mediaIds));
      expect(all.length).toBeGreaterThan(0);
      expect(all.every((row) => row.due_now && row.attempts === 0 && row.outcome === null && !row.done)).toBe(true);
    });
  });

  test("a profile's resets, a strike, a suspension and a retired handle write none for the account's public images; a strike's removal writes for its own post alone", async () => {
    await inWorld(async (tx) => {
      const author = await newProfile(tx as unknown as Db, { createdAt: new Date(Date.now() - 40 * 86_400_000) });
      const shown = await imagePost(tx, 2, author.id);
      // Both resets on the account's case.
      await decideIn(tx, admin, await accountCase(tx, author.id, "R1"), { kind: "final", ruleId: "R1", actions: [act("reset_display_name"), act("reset_bio")] });
      // A final removal under R5 of another post of the account, which gives a strike: its own images leave the public.
      // Posted now, as a strike counts only a post newer than the account's newest strike.
      const threatPost = await newPostRow(tx, author.id, { createdAt: sql`now()`, body: "a post with a direct threat" });
      const threatImage = await newImageRow(tx, author.id, threatPost, 0);
      const { caseId } = await report(tx, aPost(threatPost), "rule", "R5");
      const removal = await decideIn(tx, admin, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      expect((await actionsOf(tx, removal)).map((a) => a.kind)).toContain("strike");
      expect(await causes(tx, [threatImage])).toEqual([["state"]]);
      // A suspension at once on that threat, and a retired handle.
      const suspension = await decideIn(tx, admin, await accountCase(tx, author.id, "R5"), { kind: "final", ruleId: "R5", actions: [timed("suspend", 7, false)] });
      expect((await actionsOf(tx, suspension)).map((a) => [a.kind, a.post_id])).toEqual([["suspend", null]]);
      await decideIn(tx, admin, await accountCase(tx, author.id, "R4"), { kind: "final", ruleId: "R4", actions: [act("retire_handle")] });
      expect(await causes(tx, shown.mediaIds)).toEqual(none(2));
      // The post stays public all the while: nothing of the account's measures touched it.
      const [post] = await tx.execute<{ state: string; level: string }>(sql`select state::text as state, moderation_level::text as level from posts where id = ${shown.postId}::uuid`);
      expect(post).toEqual({ state: "visible", level: "visible" });
    });
  });

  test("a lift writes none: a withhold ended by its case's decision, a removal reversed, an image's removal reversed, a seal answered without a seal", async () => {
    await inWorld(async (tx) => {
      const withheld = await reported(tx);
      await decideIn(tx, mod, withheld.caseId, { kind: "interim", actions: [act("withhold"), act("withhold_media", withheld.mediaIds[0]!)] });
      const removed = await reported(tx);
      const removal = await decideIn(tx, mod, removed.caseId, { kind: "final", actions: [act("remove"), act("remove_media", removed.mediaIds[0]!)] });
      const sealed = await reported(tx, 2, "csam");
      await decideIn(tx, admin, sealed.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
      const ids = [withheld, removed, sealed].flatMap((p) => p.mediaIds);
      const written = (await outbox(tx, ids)).length;

      await decideIn(tx, mod, withheld.caseId, { kind: "final", outcome: "no_violation" });
      await decideIn(tx, admin, removed.caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore"), act("restore_media", removed.mediaIds[0]!)] });
      await decideIn(tx, admin, sealed.caseId, { kind: "final", outcome: "no_violation" });
      const states = await tx.execute<{ state: string }>(sql`select m.moderation_state::text || '/' || p.state::text as state from post_media m join posts p on p.id = m.post_id where m.id = any(${uuids(ids)})`);
      expect(new Set(states.map((row) => row.state))).toEqual(new Set(["visible/visible"]));
      expect((await outbox(tx, ids)).length).toBe(written);
    });
  });

  test("an author's deletion: the cause deleted, from the post's state and from each deleted row; an upload on no post never gets a row", async () => {
    await inWorld(async (tx) => {
      const social = createSocialRepo(tx as unknown as Db);
      const media = createMediaRepo(tx as unknown as Db);
      const p = await imagePost(tx, 2);
      expect(await social.deletePost(p.postId, p.authorId, new Date(), async (inner) => void (await media.detachAll(inner, p.postId)))).toBe(true);
      expect(await causes(tx, p.mediaIds)).toEqual(each(2, "deleted"));
      // Two rows an image (the post's state, then the row's delete), which the job sends as one prefix.
      expect((await outbox(tx, p.mediaIds)).length).toBe(4);

      // Uploads on no post: deleted by their owner, and by the sweeper's expiry; neither was ever served.
      const owner = await newProfile(tx as unknown as Db);
      const [own, expired] = [await newImageRow(tx, owner.id, null), await newImageRow(tx, owner.id, null)];
      expect(await media.deleteUnattached(own, owner.id)).toBe("deleted");
      await tx.execute(sql`delete from post_media where id = ${expired}::uuid`);
      expect(await outbox(tx, [own, expired])).toEqual([]);
    });
  });

  test("the account's purge: every image row it deletes gets the cause deleted", async () => {
    await inWorld(async (tx) => {
      const p = await imagePost(tx, 2);
      const upload = await newImageRow(tx, p.authorId, null);
      const gone = await createMediaRepo(tx as unknown as Db).purgeOwner(tx, p.authorId);
      expect([...gone].sort()).toEqual([...p.mediaIds, upload].sort());
      expect(await causes(tx, [...p.mediaIds, upload])).toEqual([["deleted"], ["deleted"], []]);
    });
  });

  test("an R4 redaction erases a removed image: the cause deleted; the disposal then drops its row: deleted once more", async () => {
    // As the migrator, in a transaction rolled back: the redaction waits until the decision is final, so the case is aged.
    await inWorld(async (tx) => {
      const p = await reported(tx);
      const decision = await decideIn(tx, mod, p.caseId, { kind: "final", ruleId: "R4", actions: [act("remove_media", p.mediaIds[0]!)] });
      expect(await causes(tx, p.mediaIds)).toEqual([["state"], []]);
      await ageCase(tx, p.caseId, "7 months");
      await tx.execute(sql`select public.redact_r4_body(${decision}::uuid)`);
      expect(await causes(tx, p.mediaIds)).toEqual([["deleted", "state"], []]);
      const erased = (await outbox(tx, [p.mediaIds[0]!])).length;
      // Nothing retains the erased row any more: the disposal takes it.
      await tx.execute(sql`update public.post_media set hold_until = null where id = ${p.mediaIds[0]!}::uuid`);
      const dropped = await createMediaRepo(tx as unknown as Db).dropDisposable(tx, 500);
      expect(dropped).toContain(p.mediaIds[0]!);
      const rows = await outbox(tx, [p.mediaIds[0]!]);
      expect(rows.length).toBe(erased + 1);
      expect(rows.at(-1)!.cause).toBe("deleted");
      expect(await causes(tx, [p.mediaIds[1]!])).toEqual([[]]);
    }, migrateDb);
  });

  test("a release erases a seal's images: the cause released, since its post is marked first", async () => {
    // As the migrator, who owns seal_release, in a transaction rolled back: the commit check would hold the release to an
    // admin's confirmed audit row, which this transaction never meets.
    await inWorld(async (tx) => {
      const p = await reported(tx, 2, "csam");
      const decision = await decideIn(tx, admin, p.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
      expect(await causes(tx, p.mediaIds)).toEqual(each(2, "state"));
      const seal = (await actionsOf(tx, decision)).find((a) => a.kind === "seal_media")!.id;
      const { leaveId } = await reportForTest(tx, seal, { answer: "illegal", leave: { from: "authority" } });
      await moveForTest(tx, p.mediaIds);
      await tx.execute(sql`select public.seal_release(${seal}::uuid, 'leave', ${leaveId}::uuid, ${admin.id}::uuid)`);
      expect(await causes(tx, p.mediaIds)).toEqual([
        ["released", "state"],
        ["released", "state"],
      ]);
      const rows = await outbox(tx, p.mediaIds);
      expect(rows.filter((row) => row.cause === "released").map((row) => row.media_id).sort()).toEqual([...p.mediaIds].sort());
    }, migrateDb);
  });

  test("with the adapter off a round of the job closes every open row as off, and nothing is sent", async () => {
    await inWorld(async (tx) => {
      const p = await reported(tx);
      await decideIn(tx, mod, p.caseId, { kind: "interim", actions: [act("withhold")] });
      const off = edgeAdapterFrom({ EDGE_PURGE: "off", APP_SITE: "open" });
      const report = await edgeRound({ repo: createMediaRepo(tx as unknown as Db), adapter: off, log: pino({ level: "silent" }) });
      expect(report.off).toBeGreaterThanOrEqual(4);
      expect(report.sent).toBe(0);
      const rows = await outbox(tx, p.mediaIds);
      expect(rows.length).toBe(4);
      expect(rows.every((row) => row.outcome === "off" && row.done)).toBe(true);
      // Every open row, not only these: the queue closes by itself while the adapter is off.
      expect(await tx.execute(sql`select 1 from public.edge_purges where done_at is null`)).toHaveLength(0);
    });
  });

  test("a new row's times are forced, its two lists and its ends are CHECKs, and the API's role reads, moves the four columns and deletes, but inserts nothing", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const [row] = await tx.execute<{ forced: boolean }>(sql`
        insert into public.edge_purges (media_id, cause, created_at, next_at) values (gen_random_uuid(), 'state', '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z')
        returning created_at > '2001-01-02T00:00:00Z' and next_at = now() as forced`);
      expect(row!.forced).toBe(true);
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`insert into public.edge_purges (media_id, cause) values (gen_random_uuid(), 'hidden')`))))?.code).toBe("23514");
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`insert into public.edge_purges (media_id, cause, outcome) values (gen_random_uuid(), 'state', 'off')`))))?.code).toBe("23514");
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`insert into public.edge_purges (media_id, cause, outcome, done_at) values (gen_random_uuid(), 'state', 'sent', now())`))))?.code).toBe("23514");
    });
    await rolledBack(apiDb, async (tx) => {
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`insert into public.edge_purges (media_id, cause) values (gen_random_uuid(), 'state')`))))?.code).toBe("42501");
      const p = await imagePost(tx, 1);
      await tx.execute(sql`update posts set state = 'deleted_by_author' where id = ${p.postId}::uuid`);
      const [mine] = await tx.execute<{ id: string }>(sql`select id from public.edge_purges where media_id = ${p.mediaIds[0]!}::uuid`);
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`update public.edge_purges set created_at = now() where id = ${mine!.id}`))))?.code).toBe("42501");
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`update public.edge_purges set media_id = gen_random_uuid() where id = ${mine!.id}`))))?.code).toBe("42501");
      await tx.execute(sql`update public.edge_purges set attempts = 1, next_at = now() + interval '30 seconds' where id = ${mine!.id}`);
      await tx.execute(sql`update public.edge_purges set outcome = 'accepted', done_at = now() where id = ${mine!.id}`);
      await tx.execute(sql`delete from public.edge_purges where id = ${mine!.id}`);
      expect(await outbox(tx, p.mediaIds)).toEqual([]);
    });
  });

  test("this file left no row behind", async () => {
    expect(await rowCounts(apiDb, ["edge_purges"])).toEqual(before);
  });
});
