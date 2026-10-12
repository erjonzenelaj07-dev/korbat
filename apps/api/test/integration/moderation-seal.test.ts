import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import {
  MINORS,
  aPost,
  act,
  actionsOf,
  anAccount,
  decideIn,
  decisionRow,
  imagePost,
  imageStates,
  inForce,
  insertItem,
  itemsOf,
  newImageRow,
  newTestStaff,
  openCase,
  postFrozen,
  postRow,
  readCase,
  refusal,
  report,
  rowCounts,
  staffProfile,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

/** A seal taken while deciding, a seal for good, and an admin's answer without a seal. */
const SEAL_WHILE_DECIDING: DecisionInput = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] };
const SEAL_FOR_GOOD: DecisionInput = { kind: "final", ruleId: "R2", actions: [act("seal_media")] };
const NO_SEAL: DecisionInput = { kind: "final", outcome: "no_violation" };

/**
 * The seal and the freeze with decisions (3c design, sections 6.1 and 6.2), against the real database: what a report
 * of child sexual abuse material freezes, what a seal covers and who takes, ends and lifts it, the range of an admin's
 * answer, and the stored fact that a decision was taken while nobody could open a post's images. Each test runs inside one
 * transaction that is rolled back, as korbat_api unless it needs a step only the migrator can take (moving a stored time,
 * a cascade); the decisions go through the moderation module's own decide. The file's last test holds it to leaving no
 * row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the seal, the freeze and the admin's answer", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the given pool that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** The list a decision's seal wrote: one row for each post, with the number of its images. */
  const sealList = async (tx: DbTx, decisionId: string) =>
    (
      await tx.execute<{ post_id: string; images: number }>(
        sql`select s.post_id, s.images from seal_posts s join decision_actions a on a.id = s.action_id where a.decision_id = ${decisionId}::uuid and a.kind = 'seal_media' order by s.post_id`,
      )
    ).map((row) => ({ ...row }));
  const listOf = (...posts: [string, number][]) => posts.map(([post_id, images]) => ({ post_id, images })).sort((a, b) => (a.post_id < b.post_id ? -1 : 1));
  const authorDeletes = (tx: DbTx, postId: string) => tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);

  describe("a seal is a person's act", () => {
    test("a report hides nothing by itself; whoever is on duty seals every image the case reaches, for everyone; an admin's answer without a seal ends it", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(await postFrozen(tx, p.postId)).toBe(true);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);

        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await decisionRow(tx, seal)).toMatchObject({ kind: "interim", suspect: true, needs_admin: false, unseen: false, author_mail: "pending" });
        // A seal names no post and no image: its posts are listed by the database, from the image rows it locked.
        expect(await actionsOf(tx, seal)).toEqual([expect.objectContaining({ kind: "seal_media", media_id: null, post_id: null, subject_account_id: p.authorId, no_effect: null })]);
        expect(await sealList(tx, seal)).toEqual(listOf([p.postId, 2]));
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed", "sealed"]);
        // Text is never sealed: the post keeps its level and its state.
        expect(await postRow(tx, p.postId)).toEqual({ state: "visible", level: "visible", erased: false });
        expect(await inForce(tx, { caseId })).toEqual(["seal_media"]);

        // The admin answers without a seal: the seal taken while deciding ends by itself, and its author is told.
        const answer = await decideIn(tx, admin, caseId, NO_SEAL);
        expect(await decisionRow(tx, answer)).toMatchObject({ outcome: "no_violation", suspect: true, needs_admin: true, unseen: true, ended_interim: true, author_mail: "pending" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);
        expect(await inForce(tx, { caseId })).toEqual([]);
        expect(await postFrozen(tx, p.postId)).toBe(false);
        expect((await readCase(tx, caseId)).closed_at).not.toBeNull();
      });
    });

    test("only an admin seals for good; the seal for good has a list of its own, and is not told as changing nothing", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const interim = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await refusal(decideIn(tx, mod, caseId, SEAL_FOR_GOOD))).toBe("admin_required");
        const final = await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);

        const [first] = await actionsOf(tx, interim);
        const [second] = await actionsOf(tx, final);
        expect([first!.no_effect, second!.no_effect]).toEqual([null, null]);
        expect(await sealList(tx, final)).toEqual(listOf([p.postId, 2]));
        // The answer ended the seal taken while deciding; the seal for good is the one in force.
        const standing = await tx.execute<{ id: string }>(sql`select id from measures_in_force where case_id = ${caseId}::uuid`);
        expect(standing.map((row) => row.id)).toEqual([second!.id]);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed", "sealed"]);
        expect(await decisionRow(tx, final)).toMatchObject({ suspect: true, needs_admin: true, unseen: true, ended_interim: true, author_mail: "pending" });
        // The case is closed, and the post stays frozen: a seal in force lists it.
        expect((await readCase(tx, caseId)).closed_at).not.toBeNull();
        expect((await itemsOf(tx, caseId))[0]).toMatchObject({ outcome: "restricted_rule", answered_by: final });
        expect(await postFrozen(tx, p.postId)).toBe(true);

        // Only an admin lifts it, in a correction; then nothing freezes the post any more.
        const lift: DecisionInput = { kind: "correction", reviewsDecisionId: final, actions: [act("unseal_media")] };
        expect(await refusal(decideIn(tx, mod, caseId, lift))).toBe("admin_required");
        const lifted = await decideIn(tx, admin, caseId, lift);
        expect(await decisionRow(tx, lifted)).toMatchObject({ kind: "correction", outcome: "reversed", needs_admin: true, suspect: true, author_mail: "pending" });
        expect((await actionsOf(tx, lifted))[0]).toMatchObject({ kind: "unseal_media", reverses_action_id: second!.id, media_id: null, post_id: null });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);
        expect(await postFrozen(tx, p.postId)).toBe(false);
        const [item] = await tx.execute<{ pending: boolean }>(sql`select revision_pending_at is not null as pending from intake_items where case_id = ${caseId}::uuid`);
        expect(item!.pending).toBe(true);
      });
    });

    test("a seal taken while deciding is lifted only by an admin, also the moderator's own; lifting marks the decision as an admin's", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        // Not in a decision taken while deciding, nor in one that decides the case, for an admin either.
        expect(await refusal(decideIn(tx, admin, caseId, { kind: "interim", ruleId: "R2", actions: [act("unseal_media")] }))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, admin, caseId, { kind: "final", outcome: "no_violation", actions: [act("unseal_media")] }))).toBe("invalid_decision");
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);

        const lift: DecisionInput = { kind: "correction", reviewsDecisionId: seal, actions: [act("unseal_media")] };
        expect(await refusal(decideIn(tx, mod, caseId, lift))).toBe("admin_required");
        const lifted = await decideIn(tx, admin, caseId, lift);
        // The corrected decision needed no admin; the lifting of a seal does, whatever the decision's kind, and stores it.
        expect(await decisionRow(tx, lifted)).toMatchObject({ needs_admin: true, ended_interim: true, author_mail: "pending" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
        // The report is still unanswered: the post stays frozen, and a person may seal again.
        expect(await postFrozen(tx, p.postId)).toBe(true);
        const again = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect((await actionsOf(tx, again))[0]!.no_effect).toBeNull();
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
      });
    });

    test("a seal needs a decision that rests on a suspect item, under R2 or in the category Protection of minors, and a case that reaches an image", async () => {
      await inWorld(async (tx) => {
        // No suspect item: a rule report, whatever the decision says of itself.
        const plain = await imagePost(tx, 1);
        const reported = await report(tx, aPost(plain.postId), "illegal");
        expect(await refusal(decideIn(tx, admin, reported.caseId, { kind: "interim", ground: "illegal", category: MINORS, actions: [act("seal_media")] }))).toBe("invalid_decision");

        // A suspect item, but another rule and another category.
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(await refusal(decideIn(tx, mod, caseId, { kind: "interim", ruleId: "R1", actions: [act("seal_media")] }))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, mod, caseId, { kind: "interim", ruleId: "R5", actions: [act("seal_media")] }))).toBe("invalid_decision");
        // On the law, in the category Protection of minors, it stands.
        expect(await refusal(decideIn(tx, mod, caseId, { kind: "interim", ground: "illegal", category: MINORS, actions: [act("seal_media")] }))).toBeNull();

        // A post without an image, and an account whose only image is an upload on no post: there is nothing to seal.
        const textOnly = await imagePost(tx, 0);
        expect(await refusal(decideIn(tx, mod, (await report(tx, aPost(textOnly.postId), "csam")).caseId, SEAL_WHILE_DECIDING))).toBe("invalid_decision");
        const owner = await profile(tx);
        await newImageRow(tx, owner.id, null);
        await imagePost(tx, 0, owner.id);
        expect(await refusal(decideIn(tx, mod, (await report(tx, anAccount(owner.id, owner.handle), "csam")).caseId, SEAL_WHILE_DECIDING))).toBe("invalid_decision");
      });
    });

    test("a seal on an account's case lists every post of the account with an image row, a deleted post's kept images included; a later seal covers what was posted since", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const p1 = await imagePost(tx, 2, owner.id);
        const p2 = await imagePost(tx, 1, owner.id);
        await imagePost(tx, 0, owner.id);
        const upload = await newImageRow(tx, owner.id, null);
        const stranger = await imagePost(tx, 1);
        const { caseId } = await report(tx, anAccount(owner.id, owner.handle), "csam");
        // The author deletes one of the posts: the freeze keeps its image row against the delete.
        await authorDeletes(tx, p2.postId);
        expect(await tx.execute(sql`delete from post_media where post_id = ${p2.postId}::uuid returning id`)).toHaveLength(0);

        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await sealList(tx, seal)).toEqual(listOf([p1.postId, 2], [p2.postId, 1]));
        expect((await actionsOf(tx, seal))[0]).toMatchObject({ subject_account_id: owner.id, post_id: null, media_id: null, no_effect: null });
        expect(await imageStates(tx, [...p1.mediaIds, ...p2.mediaIds, upload, ...stranger.mediaIds])).toEqual(["sealed", "sealed", "sealed", "visible", "visible"]);
        // No post is touched: a seal changes no level.
        expect(await postRow(tx, p1.postId)).toMatchObject({ state: "visible", level: "visible" });
        expect(await postRow(tx, p2.postId)).toMatchObject({ state: "deleted_by_author", level: "visible" });

        // An image posted since is frozen and not sealed, until a person seals again: that seal has a list of its own.
        const p4 = await imagePost(tx, 1, owner.id);
        expect(await postFrozen(tx, p4.postId)).toBe(true);
        expect(await imageStates(tx, p4.mediaIds)).toEqual(["visible"]);
        const second = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await sealList(tx, second)).toEqual(listOf([p1.postId, 2], [p2.postId, 1], [p4.postId, 1]));
        expect((await actionsOf(tx, second))[0]!.no_effect).toBeNull();
        expect(await imageStates(tx, p4.mediaIds)).toEqual(["sealed"]);
        // A third over the same posts is recorded, in force, and changes nothing now.
        const third = await decideIn(tx, admin, caseId, SEAL_WHILE_DECIDING);
        expect((await actionsOf(tx, third))[0]!.no_effect).toBe("already");
        expect(await inForce(tx, { caseId })).toEqual(["seal_media", "seal_media", "seal_media"]);

        // The admin seals for good: the answer ends all three, and the seal for good keeps every image sealed.
        const final = await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);
        expect(await sealList(tx, final)).toEqual(listOf([p1.postId, 2], [p2.postId, 1], [p4.postId, 1]));
        expect((await actionsOf(tx, final))[0]!.no_effect).toBeNull();
        expect(await inForce(tx, { caseId })).toEqual(["seal_media"]);
        expect(await imageStates(tx, [...p1.mediaIds, ...p2.mediaIds, ...p4.mediaIds, upload])).toEqual(["sealed", "sealed", "sealed", "sealed", "visible"]);
      });
    });

    test("a seal on a deleted target is recorded as changing nothing anyone sees, without a mail while deciding", async () => {
      await inWorld(async (tx) => {
        const gone = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(gone.postId), "csam");
        await authorDeletes(tx, gone.postId);
        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect((await actionsOf(tx, seal))[0]!.no_effect).toBe("deleted");
        expect(await decisionRow(tx, seal)).toMatchObject({ author_mail: "none" });
        expect(await imageStates(tx, gone.mediaIds)).toEqual(["sealed"]);
        // The answer ends a seal its author was never told of: nothing is told now either.
        expect(await decisionRow(tx, await decideIn(tx, admin, caseId, NO_SEAL))).toMatchObject({ ended_interim: false, author_mail: "none" });

        // A purged account: its handle stays on the row, and its posts' kept images are reached like any.
        const owner = await profile(tx);
        const post = await imagePost(tx, 1, owner.id);
        const account = await report(tx, anAccount(owner.id, owner.handle), "csam");
        await tx.execute(sql`update profiles set display_name = 'Deleted account', bio = '', deleted_at = now() where id = ${owner.id}::uuid`);
        const onPurged = await decideIn(tx, admin, account.caseId, SEAL_FOR_GOOD);
        expect((await actionsOf(tx, onPurged))[0]!.no_effect).toBe("deleted");
        expect(await decisionRow(tx, onPurged)).toMatchObject({ author_mail: "pending" });
        expect(await imageStates(tx, post.mediaIds)).toEqual(["sealed"]);
      });
    });

    test("the post's text is removed by an ordinary measure beside the seal; lifting the seal leaves the removal, and the images not sealed", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const final = await decideIn(tx, admin, caseId, { kind: "final", ruleId: "R2", actions: [act("remove"), act("seal_media")] });
        expect((await actionsOf(tx, final)).map((a) => [a.kind, a.post_id, a.no_effect])).toEqual([
          ["remove", p.postId, null],
          ["seal_media", null, null],
        ]);
        // Sealed whatever the post's level.
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
        const lifted = await decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: final, outcome: "partly_reversed", actions: [act("unseal_media")] });
        expect(await decisionRow(tx, lifted)).toMatchObject({ outcome: "partly_reversed" });
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
      });
    });

    test("a report of this kind merged into an R5 case about a post without images: the admin removes under R5, and a seal is refused there", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const { caseId } = await report(tx, aPost(p.postId), "rule", "R5");
        await report(tx, aPost(p.postId), "csam");
        expect(await refusal(decideIn(tx, admin, caseId, SEAL_FOR_GOOD))).toBe("invalid_decision");
        const removal: DecisionInput = { kind: "final", ruleId: "R5", actions: [act("remove")] };
        expect(await refusal(decideIn(tx, mod, caseId, removal))).toBe("admin_required");
        const id = await decideIn(tx, admin, caseId, removal);
        expect(await decisionRow(tx, id)).toMatchObject({ suspect: true, needs_admin: true, rule_id: "R5" });
        expect((await itemsOf(tx, caseId)).map((item) => [item.suspect, item.outcome])).toEqual([
          [false, "restricted_rule"],
          [true, "restricted_rule"],
        ]);
      });
    });

    test("on a staff account's posts whoever is on duty seals while deciding; a seal for good is refused", async () => {
      const staffAuthor = await newTestStaff(authDb, migrateDb, repo, "moderator");
      await inWorld(async (tx) => {
        await staffProfile(tx, staffAuthor);
        const p = await imagePost(tx, 1, staffAuthor.id);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(await refusal(decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING))).toBeNull();
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
        expect(await refusal(decideIn(tx, admin, caseId, SEAL_FOR_GOOD))).toBe("staff_target");
        // The admin can still answer: without a measure nothing restricts the staff account.
        expect(await refusal(decideIn(tx, admin, caseId, NO_SEAL))).toBeNull();
      });
    });
  });

  describe("the range of an admin's answer", () => {
    test("the answer ends a seal taken while deciding also while an item of another kind keeps the case open, and tells its author", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        await report(tx, aPost(p.postId), "rule");
        const answer = await decideIn(tx, admin, caseId, { ...NO_SEAL, throughSeq: 1 });
        expect(await decisionRow(tx, answer)).toMatchObject({ through_seq: 1, ended_interim: true, author_mail: "pending", unseen: true });
        expect(await readCase(tx, caseId)).toMatchObject({ answered_seq: 1, intake_seq: 2, closed_at: null });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
        expect(await inForce(tx, { caseId })).toEqual([]);
        expect(await postFrozen(tx, p.postId)).toBe(false);
        // The later report is the moderator's, with the images open again: not unseen.
        const later = await decideIn(tx, mod, caseId, { kind: "final", outcome: "no_violation" });
        expect(await decisionRow(tx, later)).toMatchObject({ unseen: false, suspect: false, needs_admin: false, ended_interim: false, author_mail: "none" });
      });
    });

    test("an answer through an earlier suspect item while a later one waits is refused, for an admin too; through both it ends the seal", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        await report(tx, aPost(p.postId), "csam");
        expect(await refusal(decideIn(tx, admin, caseId, { ...NO_SEAL, throughSeq: 1 }))).toBe("case_changed");
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
        expect(await refusal(decideIn(tx, admin, caseId, NO_SEAL))).toBeNull();
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
        expect(await postFrozen(tx, p.postId)).toBe(false);
      });
    });
  });

  describe("unseen: the stored fact that a decision was taken while nobody could open the post's images", () => {
    test("true for a final decision on a post frozen through its author's account's case, which a moderator takes without an admin", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const p = await imagePost(tx, 1, owner.id);
        const account = await report(tx, anAccount(owner.id, owner.handle), "csam");
        const { caseId } = await report(tx, aPost(p.postId), "rule");
        expect(await postFrozen(tx, p.postId)).toBe(true);
        // While deciding, and on the account's own case, nothing is marked.
        const interim = await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await decisionRow(tx, interim)).toMatchObject({ unseen: false, suspect: false });
        const answer = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove")] });
        expect(await decisionRow(tx, answer)).toMatchObject({ unseen: true, suspect: false, needs_admin: false });
        // A correction is never unseen.
        const correction = await decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: answer, actions: [act("restore")] });
        expect(await decisionRow(tx, correction)).toMatchObject({ unseen: false });
        // The admin's answer on the account's case concerns its fields, which staff read: not unseen.
        const onAccount = await decideIn(tx, admin, account.caseId, NO_SEAL);
        expect(await decisionRow(tx, onAccount)).toMatchObject({ unseen: false, suspect: true, needs_admin: true });
        // The freeze has ended: the next report about the post is answered with the images open.
        const again = await report(tx, aPost(p.postId), "rule");
        expect(await decisionRow(tx, await decideIn(tx, mod, again.caseId, { kind: "final", outcome: "no_violation" }))).toMatchObject({ unseen: false });
      });
    });

    test("true while a seal for good lists the post, on a later case about it", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const sealed = await report(tx, aPost(p.postId), "csam");
        await decideIn(tx, admin, sealed.caseId, SEAL_FOR_GOOD);
        const later = await report(tx, aPost(p.postId), "rule");
        expect(later.caseId).not.toBe(sealed.caseId);
        const answer = await decideIn(tx, mod, later.caseId, { kind: "final", outcome: "no_violation" });
        expect(await decisionRow(tx, answer)).toMatchObject({ unseen: true, suspect: false, needs_admin: false });
      });
    });
  });

  describe("the freeze's predicate, with decisions", () => {
    test("a post is frozen while a suspect item about it is unanswered, and no longer once an admin answered without a seal", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(await postFrozen(tx, p.postId)).toBe(true);
        // A moderator's withhold of the text does not answer the report.
        await decideIn(tx, mod, caseId, { kind: "interim", ruleId: "R2", actions: [act("withhold")] });
        expect(await postFrozen(tx, p.postId)).toBe(true);
        await decideIn(tx, admin, caseId, NO_SEAL);
        expect(await postFrozen(tx, p.postId)).toBe(false);
      });
    });

    test("a suspect item that arrives after a seal taken while deciding ended freezes the post again and never brings that seal back", async () => {
      // As the migrator: the seal's decision is dated a minute back, as one made in an earlier transaction is. Inside one
      // transaction every time is its start, and the seal would count the later item as its own.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        await report(tx, aPost(p.postId), "rule");
        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        await tx.execute(sql`update decisions set decided_at = decided_at - interval '1 minute' where id = ${seal}::uuid`);
        await tx.execute(sql`update intake_items set created_at = created_at - interval '2 minutes' where case_id = ${caseId}::uuid`);
        expect(await inForce(tx, { caseId })).toEqual(["seal_media"]);
        // The admin answers the suspect item; the rule report keeps the case open.
        await decideIn(tx, admin, caseId, { ...NO_SEAL, throughSeq: 1 });
        expect(await postFrozen(tx, p.postId)).toBe(false);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);

        // A new report of this kind joins the open case: frozen again through the new item, the old seal stays ended, and
        // the images stay as they are until a person seals again.
        await report(tx, aPost(p.postId), "csam");
        expect(await postFrozen(tx, p.postId)).toBe(true);
        expect(await inForce(tx, { caseId })).toEqual([]);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
        const again = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect((await actionsOf(tx, again))[0]!.no_effect).toBeNull();
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
      }, migrateDb);
    });

    test("an item that arrived after the seal's decision began does not put that seal in force, and freezes all the same", async () => {
      // As the migrator, which moves the item's time: the item committed while the seal's decision waited for its locks.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await inForce(tx, { caseId })).toEqual(["seal_media"]);
        await tx.execute(sql`update intake_items set created_at = created_at + interval '1 second' where case_id = ${caseId}::uuid`);
        expect(await inForce(tx, { caseId })).toEqual([]);
        expect(await postFrozen(tx, p.postId)).toBe(true);
        expect((await decisionRow(tx, seal)).suspect).toBe(true);
      }, migrateDb);
    });

    test("a post frozen through the item korbat added for it stays frozen after the quoting post's item is answered", async () => {
      await inWorld(async (tx) => {
        const quoted = await imagePost(tx, 1);
        const quoting = await imagePost(tx, 0, undefined, { quoteOfId: quoted.postId });
        const { caseId, recorded } = await report(tx, aPost(quoting.postId), "csam");
        expect(recorded.items.map((item) => [item.position, item.targetId])).toEqual([
          [1, quoting.postId],
          [11, quoted.postId],
        ]);
        expect([await postFrozen(tx, quoting.postId), await postFrozen(tx, quoted.postId)]).toEqual([true, true]);
        await decideIn(tx, admin, caseId, NO_SEAL);
        expect([await postFrozen(tx, quoting.postId), await postFrozen(tx, quoted.postId)]).toEqual([false, true]);
        // The quoting post's case reached no image; the quoted post's case is sealed on its own.
        const quotedCase = recorded.items[1]!.caseId!;
        await decideIn(tx, admin, quotedCase, SEAL_FOR_GOOD);
        expect(await postFrozen(tx, quoted.postId)).toBe(true);
        expect(await imageStates(tx, quoted.mediaIds)).toEqual(["sealed"]);
      });
    });

    test("a post made after an account's seal is frozen while the item waits; one made once the item is answered is not, though the seal stands", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const earlier = await imagePost(tx, 1, owner.id);
        const { caseId } = await report(tx, anAccount(owner.id, owner.handle), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        const after = await imagePost(tx, 1, owner.id);
        expect([await postFrozen(tx, earlier.postId), await postFrozen(tx, after.postId)]).toEqual([true, true]);
        expect(await imageStates(tx, [...earlier.mediaIds, ...after.mediaIds])).toEqual(["sealed", "visible"]);
        await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);
        // The seal for good lists what existed when it was taken, the post made meanwhile included; a post made after it
        // is on no seal's list, and no item waits any more.
        const later = await imagePost(tx, 1, owner.id);
        expect([await postFrozen(tx, earlier.postId), await postFrozen(tx, after.postId), await postFrozen(tx, later.postId)]).toEqual([true, true, false]);
        expect(await imageStates(tx, [...earlier.mediaIds, ...after.mediaIds, ...later.mediaIds])).toEqual(["sealed", "sealed", "visible"]);
      });
    });

    test("once an admin answered an account's report without a seal, none of the account's posts is frozen", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const earlier = await imagePost(tx, 1, owner.id);
        const { caseId } = await report(tx, anAccount(owner.id, owner.handle), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        const after = await imagePost(tx, 1, owner.id);
        await decideIn(tx, admin, caseId, NO_SEAL);
        expect([await postFrozen(tx, earlier.postId), await postFrozen(tx, after.postId)]).toEqual([false, false]);
        expect(await imageStates(tx, [...earlier.mediaIds, ...after.mediaIds])).toEqual(["visible", "visible"]);
      });
    });

    test("after a re-examination of the answered report the post is frozen again", async () => {
      // As the migrator: the answer is dated an hour back, so the release, whose cut-off is not in the future, takes it.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId, recorded } = await report(tx, aPost(p.postId), "csam");
        const answer = await decideIn(tx, admin, caseId, NO_SEAL);
        expect(await postFrozen(tx, p.postId)).toBe(false);
        await tx.execute(sql`update decisions set decided_at = decided_at - interval '1 hour' where id = ${answer}::uuid`);
        await tx.execute(sql`select public.release_outcomes(now())`);
        const reopened = await openCase(tx, "post", p.postId);
        const again = await insertItem(tx, { intakeId: recorded.intakeId, caseId: reopened, targetId: p.postId, lane: 0, reexaminesItemId: recorded.items[0]!.id });
        expect(again).toMatchObject({ suspect: true, lane: 0, case_id: reopened });
        expect(await postFrozen(tx, p.postId)).toBe(true);
      }, migrateDb);
    });

    test("a cascade from a deleted post, and from its author's deleted profile, is refused while a seal in force lists the post; a direct delete skips the kept row, and takes it once the seal is lifted", async () => {
      // As the migrator: the API role deletes no post and no profile.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const final = await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);
        // The case is closed and no item waits: the seal alone keeps the row.
        expect((await readCase(tx, caseId)).closed_at).not.toBeNull();
        const retained = { code: "23001", message: expect.stringMatching(/^post_media row [0-9a-f-]{36} is retained$/) };
        expect(await pgError(tx.transaction((sp) => sp.execute(sql`delete from posts where id = ${p.postId}::uuid`)))).toEqual(retained);
        expect(await pgError(tx.transaction((sp) => sp.execute(sql`delete from profiles where id = ${p.authorId}::uuid`)))).toEqual(retained);
        // A direct delete skips the kept row.
        expect(await tx.execute(sql`delete from post_media where post_id = ${p.postId}::uuid returning id`)).toHaveLength(0);
        // Once the seal is lifted nothing keeps the row, and the direct delete takes it.
        await decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: final, actions: [act("unseal_media")] });
        expect(await tx.execute(sql`delete from post_media where post_id = ${p.postId}::uuid returning id`)).toHaveLength(1);
      }, migrateDb);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
