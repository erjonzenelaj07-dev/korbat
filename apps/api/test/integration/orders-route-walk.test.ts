import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Db } from "@korbat/db";
import { serve } from "../../src/media/flows/serve";
import { mediaForAccount } from "../../src/media";
import { authorCases, authorDecisionView, authorFacts, exportedDecisions } from "../../src/moderation/author";
import { deletePost, getPost, thread } from "../../src/social/flows/posts";
import { setEngagement } from "../../src/social/flows/engagement";
import { exportProfile } from "../../src/social/flows/export";
import { profileImported, profilePosts } from "../../src/social/flows/timelines";
import { IMPORT_TABLES } from "./imports-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { CHANNEL_TABLES, aPost, act, decideIn, ground, intake, newTestStaff, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures } from "./notify-fixtures";
import { ORDER_TABLES, effectParams, effectWith, orderForTest } from "./orders-fixtures";
import { socialHarness } from "./social-harness";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 180_000 });

/**
 * The route walk of invariant 2 (3f design, sections 7.10, 9.1 and 9.2; invariants 2 and 3): every reader of a post, an
 * image, a list and the author's own moderation reads, walked as the post's author, as another account and signed out,
 * for four posts: one under a held removal order, one under a held DSA Article 9 order (kept from its author by force),
 * one whose author was told of an earlier decision about it before the order, and one of an author who also has a 3c
 * decision that told them nothing. No answer to the author differs from a stranger's; nothing of a held order reaches
 * the author; an earlier decision's screen reads as it did, its images answering as images that cannot be loaded. The
 * walk runs at the level of the flows the routes call, in a transaction that is rolled back.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: a disabled post, walked as its author", () => {
  let w: NoticesWorld;
  let moderator: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  let media: MediaHarness | null = null;

  beforeAll(async () => {
    w = noticesWorld();
    moderator = await newTestStaff(w.authDb, w.migrateDb, w.repo, "moderator");
    admin = await newTestStaff(w.authDb, w.migrateDb, w.repo, "admin");
    await staffProfile(w.apiDb, moderator);
    await staffProfile(w.apiDb, admin);
    before = await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES, ...IMPORT_TABLES]);
  }, 60_000);
  afterAll(async () => {
    media?.cleanup();
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES, ...IMPORT_TABLES])).toEqual(before);
    await removeFixtures(w.migrateDb, [moderator.id, admin.id]);
    await closeNotifyFixtures();
    await w.close();
  });

  /** What a reader answers: the value's shape, or the refusal's code; a stranger's and the author's are compared. */
  const outcome = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
      return "answered";
    } catch (err) {
      return String((err as { code?: unknown }).code ?? err);
    }
  };

  test("four disabled posts are not there for anyone, their authors included, on any path, and a held order tells nothing", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const db = tx as unknown as Db;
      media = await mediaHarness(db);
      const social = socialHarness(db).deps;
      const stranger = await newProfile(db);
      // A: a held removal order. B: a held DSA order. C: told of an earlier decision first. D: also holds a 3c decision that told nothing.
      const authors = [await newProfile(db), await newProfile(db), await newProfile(db), await newProfile(db)];
      const made: { author: { id: string; handle: string }; postId: string; mediaIds: string[] }[] = [];
      for (const author of authors) made.push({ author, ...(await media.postWithImages(author.id, 1)) });
      // C's earlier decision, told to its author: a withhold while deciding, on a report.
      const reporter = await newProfile(db);
      const cReport = await intake(db, ground.rule(reporter.id), aPost(made[2]!.postId));
      const earlier = await decideIn(tx, moderator, cReport.items[0]!.caseId!, { kind: "interim", actions: [act("withhold")] });
      const earlierBefore = await authorDecisionView({ apiDb: db }, made[2]!.author.id, earlier);
      // D's 3c decision that told nothing: a report on another post of D's, answered "no breach".
      const other = await media.postWithImages(made[3]!.author.id, 0);
      const dReport = await intake(db, ground.rule(reporter.id), aPost(other.postId));
      const noBreach = await decideIn(tx, moderator, dReport.items[0]!.caseId!, { kind: "final", outcome: "no_violation" });
      const exportedBefore = await Promise.all(made.map((m) => exportedDecisions({ apiDb: db }, m.author.id)));

      // The orders: A and C under removal orders with Section C, B under a DSA order with Section C, D under one without.
      const orderA = await orderForTest(tx, moderator, { posts: [made[0]!.postId, made[2]!.postId], sectionC: true });
      await effectWith(tx, moderator, orderA.id, effectParams(orderA));
      const orderB = await orderForTest(tx, admin, { kind: "dsa_art9", posts: [made[1]!.postId], sectionC: true });
      await effectWith(tx, admin, orderB.id, { ...effectParams(orderB), urgent: true });
      const orderD = await orderForTest(tx, moderator, { posts: [made[3]!.postId], sectionC: true });
      await effectWith(tx, moderator, orderD.id, effectParams(orderD));

      for (const [index, m] of made.entries()) {
        const viewers: (string | null)[] = [m.author.id, stranger.id, null];
        const readers = {
          post: (viewer: string | null) => outcome(() => getPost(social, viewer, m.postId)),
          thread: (viewer: string | null) => outcome(() => thread(social, viewer, m.postId, { limit: 20 })),
          listed: async (viewer: string | null) => ((await profilePosts(social, viewer, m.author.handle, { limit: 50 })).items.some((item) => JSON.stringify(item).includes(m.postId)) ? "listed" : "absent"),
          // 3b Task 6 (design, section 8.6): the Imported tab, the new reader of 9.2, walked with the others.
          imported: async (viewer: string | null) => ((await profileImported(social, viewer, m.author.handle, { limit: 50 })).items.some((item) => JSON.stringify(item).includes(m.postId)) ? "listed" : "absent"),
          image: async (viewer: string | null) => (await serve(media!.deps, { id: m.mediaIds[0]!, size: "small", ifNoneMatch: undefined, viewer: async () => viewer })).kind,
        };
        for (const [name, read] of Object.entries(readers)) {
          const answers = await Promise.all(viewers.map((viewer) => read(viewer)));
          expect(answers, `post ${index}: ${name}`).toEqual([answers[1], answers[1], answers[1]]);
          expect(answers[0], `post ${index}: ${name}`).not.toBe("answered");
          if (name === "listed" || name === "imported") expect(answers[0], `post ${index}: ${name}`).toBe("absent");
          if (name === "image") expect(answers[0], `post ${index}: ${name}`).toBe("not_found");
        }
        // Writing to it: like, bookmark, and the author's own deletion, all as for a post that does not exist.
        expect(await outcome(() => setEngagement(social, m.author.id, m.postId, "like", true)), `post ${index}: like`).toBe("not_found");
        expect(await outcome(() => setEngagement(social, stranger.id, m.postId, "bookmark", true)), `post ${index}: bookmark`).toBe("not_found");
        expect(await outcome(() => deletePost(social, m.author.id, m.postId)), `post ${index}: delete`).toBe("not_found");
        // The author's own moderation reads: no chip, no new row, no new export entry.
        expect((await authorFacts({ apiDb: db }, m.author.id, [m.postId])).size, `post ${index}: chip`).toBe(0);
        expect(await exportedDecisions({ apiDb: db }, m.author.id), `post ${index}: export`).toEqual(exportedBefore[index]);
        const exported = await exportProfile(social, m.author.id);
        const posts: string[] = [];
        for await (const page of exported.posts) posts.push(...page.map((p) => p.id));
        expect(posts, `post ${index}: exported posts`).not.toContain(m.postId);
        // Nor its image files (W.7): the export's files and the check it makes again before opening each leave them out.
        const files = (await mediaForAccount(media.deps).exportImages(m.author.id)).map((file) => file.id);
        for (const id of m.mediaIds) {
          expect(files, `post ${index}: exported images`).not.toContain(id);
          expect(await media.deps.repo.isExportable(m.author.id, id), `post ${index}: exportable`).toBe(false);
        }
      }
      // The held orders' decisions are on no author's list; C's earlier decision is, and reads byte for byte as before.
      expect((await authorCases({ apiDb: db }, made[0]!.author.id)).decisions).toEqual([]);
      expect((await authorCases({ apiDb: db }, made[1]!.author.id)).decisions).toEqual([]);
      expect((await authorCases({ apiDb: db }, made[2]!.author.id)).decisions.map((d) => d.id)).toEqual([earlier]);
      const earlierAfter = await authorDecisionView({ apiDb: db }, made[2]!.author.id, earlier);
      expect(earlierAfter).toEqual(earlierBefore);
      expect(earlierAfter.content?.kind).toBe("post");
      // Its images answer as images that cannot be loaded, to the author too.
      const listedImage = earlierAfter.content?.kind === "post" ? earlierAfter.content.images[0] : undefined;
      if (listedImage) expect((await serve(media.deps, { id: listedImage.id, size: "small", ifNoneMatch: undefined, viewer: async () => made[2]!.author.id })).kind).toBe("not_found");
      // D's 3c decision that told nothing stays out of every read on the author's side.
      expect((await authorCases({ apiDb: db }, made[3]!.author.id)).decisions.map((d) => d.id)).not.toContain(noBreach);
      const [untold] = await tx.execute<{ mail: string; informed: boolean }>(sql`select author_mail::text as mail, informed_at is not null as informed from public.decisions where id = ${noBreach}::uuid`);
      expect([untold!.mail, untold!.informed]).toEqual(["none", true]);
    });
  });
});

