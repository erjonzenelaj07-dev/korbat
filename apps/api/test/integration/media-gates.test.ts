import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { PostView, mediaPath, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { purge } from "../../src/account/flows/deletion";
import { buildExport, writeExport } from "../../src/account/flows/export";
import { purgePending } from "../../src/account/purge";
import { createZipWriter } from "../../src/account/zip";
import type { AccountExport } from "../../src/auth";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { mediaForAccount, mediaForCases, type MediaForCases, type MediaForPosts } from "../../src/media";
import { serve } from "../../src/media/flows/serve";
import { status } from "../../src/media/flows/status";
import { createMediaRepo, type MediaRepo } from "../../src/media/repo";
import { sweep } from "../../src/media/sweeper";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { dueStatements, eraseStatementTexts, forgetReporter } from "../../src/moderation/repo";
import { decisionStatement, sendStatement } from "../../src/moderation/statement";
import { socialForModeration } from "../../src/social";
import { explorePage } from "../../src/social/flows/explore";
import { exportProfile } from "../../src/social/flows/export";
import { deletePost, getPost, thread } from "../../src/social/flows/posts";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "../../src/social/flows/timelines";
import { webpBytes } from "../media/webp-bytes";
import { DAY, HOUR, accounts, before as earlier, likedBy, rank } from "./explore-fixtures";
import { mediaHarness, type MediaHarness } from "./media-harness";
import {
  aPost,
  act,
  actionsOf,
  anAccount,
  authCaseCounts,
  decideIn,
  ground,
  imagePost,
  insertItem,
  intake,
  moderationCounts,
  newImageRow,
  newPostRow,
  newTestStaff,
  openCase,
  postFrozen,
  report,
  staffProfile,
  suspectItemOn,
  uuids,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newPost, newProfile } from "./social-fixtures";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";
import { ageCase, authAccount } from "./retention-fixtures";
import { rolledBack } from "./staff-fixtures";

// Each test builds a store directory, uploads its images and runs dozens of statements inside one open transaction: on
// a loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

const SEAL_WHILE_DECIDING: DecisionInput = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] };
const SEAL_FOR_GOOD: DecisionInput = { kind: "final", ruleId: "R2", actions: [act("seal_media")] };

/**
 * Every method of the media repository, in one record (3c design, section 12). A method that deletes image rows is run
 * against a frozen post below; a method that gives an image, or what an image is, to someone is run against sealed
 * images; and a method that does neither says why. The record is typed over the repository's methods and compared with
 * them at run time, so a method added to createMediaRepo fails this file until whoever adds it has said which it is,
 * and a new deleter or reader fails it until it has a run of its own.
 */
type Role = { is: "deleter" } | { is: "reader" } | { is: "neither"; why: string };
const METHODS: Record<keyof MediaRepo, Role> = {
  accountCreatedAt: { is: "neither", why: "reads when an account was onboarded, and no image row" },
  pendingCount: { is: "neither", why: "counts an account's uploads that are on no post" },
  insertProcessing: { is: "neither", why: "inserts an upload on no post" },
  find: { is: "reader" },
  finalize: { is: "neither", why: "records the worker's verdict on an upload that is still processing" },
  deleteUnattached: { is: "deleter" },
  fileAccess: { is: "reader" },
  attach: { is: "neither", why: "puts its author's own upload on a new post" },
  detachAll: { is: "deleter" },
  purgeOwner: { is: "deleter" },
  forPosts: { is: "reader" },
  readyImages: { is: "reader" },
  isExportable: { is: "reader" },
  processingIds: { is: "neither", why: "lists uploads that are still processing, which are on no post" },
  failStale: { is: "neither", why: "fails uploads that are still processing, which are on no post" },
  deleteUnattachedBefore: { is: "deleter" },
  existing: { is: "neither", why: "says which ids have a row, to the reconcile pass, and must see every row" },
  deleteRow: { is: "deleter" },
  hold: { is: "neither", why: "locks image rows and places holds; what it answers is text and sizes for a case's snapshot" },
  reach: { is: "neither", why: "answers counts, a day and a time, never an id or anything of an image" },
  staffAccess: { is: "reader" },
  dropDisposable: { is: "deleter" },
  overdueDeletions: { is: "neither", why: "answers how many rows the disposal should have taken by now" },
  moderationStates: { is: "neither", why: "answers each attached row's id, post, stored state and erasure time to text-verify, and nothing of an image itself" },
  // 3f, Task 2: opening an order takes an image's address as its post, and an order's screen counts a post's images.
  imagePost: { is: "neither", why: "answers which post an image id is attached to, for an order's item, and nothing of the image" },
  imageCounts: { is: "neither", why: "answers how many image rows each post holds, for an order's screen, and nothing of an image" },
};
const methodsThatAre = (role: Role["is"]) => (Object.keys(METHODS) as (keyof MediaRepo)[]).filter((name) => METHODS[name].is === role).sort();

/** What a deleter is run on: the repository on the test's transaction, and the frozen post with its author and images. */
interface Frozen {
  repo: MediaRepo;
  tx: DbTx;
  ownerId: string;
  postId: string;
  mediaIds: string[];
}

/** Each deleter run as hard as it can be against the post's images; it answers the ids it says are gone. */
const DELETERS = {
  deleteUnattached: async (f: Frozen) => {
    const gone: string[] = [];
    for (const id of f.mediaIds) if (await f.repo.deleteUnattached(id, f.ownerId)) gone.push(id);
    return gone;
  },
  detachAll: (f: Frozen) => f.repo.detachAll(f.tx, f.postId),
  purgeOwner: (f: Frozen) => f.repo.purgeOwner(f.tx, f.ownerId),
  // Every upload on no post that is older than tomorrow: every one there is.
  deleteUnattachedBefore: (f: Frozen) => f.repo.deleteUnattachedBefore(new Date(Date.now() + DAY)),
  deleteRow: async (f: Frozen) => {
    for (const id of f.mediaIds) await f.repo.deleteRow(id);
    return [] as string[];
  },
  // Batch after batch until one is not full: everything that is disposable now.
  dropDisposable: async (f: Frozen) => {
    const gone: string[] = [];
    for (;;) {
      const batch = await f.repo.dropDisposable(f.tx, 500);
      gone.push(...batch);
      if (batch.length < 500) return gone;
    }
  },
} satisfies Partial<Record<keyof MediaRepo, (f: Frozen) => Promise<string[]>>>;

/** What every test here works in: a transaction that is rolled back, the media module with a store of its own on it, and the social module's flows over both. */
interface World {
  tx: DbTx;
  h: MediaHarness;
  s: SocialHarness;
  repo: MediaRepo;
  cases: MediaForCases;
}

describe.skipIf(!process.env.INTEGRATION)("integration: every deleter and every reader of images, by enumeration", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let mod: TestStaff;
  let admin: TestStaff;
  let counts: Record<string, number>;
  let authCounts: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    const repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    counts = await moderationCounts(apiDb);
    authCounts = await authCaseCounts(migrateDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  const inWorld = (fn: (w: World) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      const h = await mediaHarness(tx as unknown as Db);
      // The media module's interface for posts, as createMedia hands it out.
      const forPosts: MediaForPosts = {
        attach: (within, input) => h.deps.repo.attach(within, input),
        detachAll: (within, postId) => h.deps.repo.detachAll(within, postId),
        requestDeletion: (ids) => h.files.requestDeletion(ids),
        forPosts: (postIds) => h.deps.repo.forPosts(postIds),
      };
      try {
        await fn({ tx, h, s: socialHarness(tx as unknown as Db, { media: forPosts }), repo: h.deps.repo, cases: mediaForCases(h.deps) });
      } finally {
        h.cleanup();
      }
    });

  const sorted = (ids: readonly string[]) => [...ids].sort();
  const page = { limit: 50 };
  /** An image as a reader who is shown it gets it: with its blurhash and both paths. */
  const whole = (id: string) => expect.objectContaining({ id, blurhash: "L2Eo_P_3jb_3~qoL", small: mediaPath(id, "small"), large: mediaPath(id, "large") });
  async function existing(tx: DbTx, ids: readonly string[]): Promise<string[]> {
    const rows = await tx.execute<{ id: string }>(sql`select id from post_media where id = any(${uuids(ids)}) order by id`);
    return rows.map((row) => row.id);
  }
  const authorDeletes = (tx: DbTx, postId: string) => tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
  /** What serve answers for the large file, with the file it opened closed again. */
  async function ask(w: World, id: string, viewer: string | null, ifNoneMatch?: string) {
    const served = await serve(w.h.deps, { id, size: "large", ifNoneMatch, viewer: async () => viewer });
    if (served.kind === "file") await served.file.handle.close();
    return served.kind === "not_found" ? { kind: served.kind } : { kind: served.kind, cacheControl: served.cacheControl };
  }
  /** Whether the one function that opens an image for staff opens this one. */
  async function staffOpens(w: World, id: string): Promise<boolean> {
    const got = await w.cases.staffImage(id, "large");
    await got?.file.handle.close();
    return got !== null;
  }
  /** The account module's dependencies over this world: the real purge of profiles and images and the real export, with the auth module stood in for. */
  function accountDeps(w: World, pending: string[] = []): AccountDeps & { finished: string[] } {
    const finished: string[] = [];
    const notHere = async (): Promise<never> => {
      throw new Error("not exercised here");
    };
    const exported = (id: string): AccountExport => ({
      account: { id, email: "owner@korbat.local", createdAt: new Date(), role: "user", mfaEnabled: false, hasPassword: false, verified: false, termsVersion: null, termsAcceptedAt: null },
      passkeys: [],
      sessions: [],
      devices: [],
      events: [],
    });
    return {
      finished,
      auth: {
        startDeletion: notHere,
        confirmDeletion: notHere,
        pendingPurges: async () => pending,
        finishPurge: async (userId) => void finished.push(userId),
        takeDownTerminated: notHere,
        exportAccount: async (userId) => exported(userId),
        appendEvent: async () => undefined,
      },
      social: { purgeProfile: (userId, now, within) => w.s.repo.purgeProfile(userId, now, within), exportProfile: (userId, pageSize) => exportProfile(w.s.deps, userId, pageSize) },
      media: mediaForAccount(w.h.deps),
      limits: new MemoryStore(),
      log: pino({ level: "silent" }),
      now: () => new Date(),
    };
  }
  /** The account's whole export as its archive holds it: the entries' names, and export.json. */
  async function exportOf(w: World, userId: string) {
    const plan = await buildExport(accountDeps(w), userId, "the-asking-session", new Date());
    const chunks: Uint8Array[] = [];
    await writeExport(createZipWriter(async (chunk) => void chunks.push(Uint8Array.from(chunk))), plan);
    const files = unzipSync(Buffer.concat(chunks));
    const json = JSON.parse(strFromU8(files["export.json"]!)) as { posts: { id: string; body: string; state: string; media: { id: string; file: string; altText: string }[] }[]; missingMedia: string[] };
    return { entries: Object.keys(files).sort(), json };
  }

  describe("the record over the repository's methods", () => {
    test("names every method createMediaRepo has, and no other", () => {
      expect(Object.keys(createMediaRepo(apiDb)).sort()).toEqual(Object.keys(METHODS).sort());
    });

    test("every deleter has a run against a frozen post, and every method that does neither says why", () => {
      expect(Object.keys(DELETERS).sort()).toEqual(methodsThatAre("deleter"));
      expect(methodsThatAre("deleter")).toEqual(["deleteRow", "deleteUnattached", "deleteUnattachedBefore", "detachAll", "dropDisposable", "purgeOwner"]);
      // The readers are run through what calls them: serve (fileAccess), the lists (forPosts), the export's files
      // (readyImages and isExportable), the status (find) and the staff's image (staffAccess).
      expect(methodsThatAre("reader")).toEqual(["fileAccess", "find", "forPosts", "isExportable", "readyImages", "staffAccess"]);
      for (const name of methodsThatAre("neither")) {
        const role = METHODS[name];
        expect(role.is === "neither" && role.why.length > 20, `${name}: ${role.is === "neither" ? role.why : ""}`).toBe(true);
      }
    });
  });

  describe("gate K: every deleter against a frozen post", () => {
    /** Each way a post comes to be frozen, with nothing else that would keep its rows: no hold stands on them. */
    const FREEZES: Record<string, (w: World, post: { postId: string; ownerId: string; handle: string }) => Promise<void>> = {
      "its own item": async (w, post) => {
        await suspectItemOn(w.tx, "post", post.postId);
      },
      "its author's account's item": async (w, post) => {
        await suspectItemOn(w.tx, "account", post.ownerId);
      },
      "an item korbat added for a post that quotes it": async (w, post) => {
        const quoting = await newPostRow(w.tx, (await newProfile(w.tx as unknown as Db)).id, { quoteOfId: post.postId });
        const named = await suspectItemOn(w.tx, "post", quoting);
        await insertItem(w.tx, { intakeId: named.intakeId, caseId: await openCase(w.tx, "post", post.postId), targetId: post.postId, position: 11, lane: 0 });
      },
      "a seal taken while deciding": async (w, post) => {
        const { caseId } = await report(w.tx, anAccount(post.ownerId, post.handle), "csam");
        await decideIn(w.tx, mod, caseId, SEAL_WHILE_DECIDING);
      },
      "a seal for good, whose case is closed": async (w, post) => {
        const { caseId } = await report(w.tx, anAccount(post.ownerId, post.handle), "csam");
        await decideIn(w.tx, admin, caseId, SEAL_FOR_GOOD);
      },
    };

    test.each(Object.keys(FREEZES))("frozen through %s: each deleter leaves the rows, answers no id of them and no file of them is requested, before and after the author deleted the post", async (freeze) => {
      await inWorld(async (w) => {
        const ada = await w.h.established();
        const p = await w.h.postWithImages(ada.id, 2);
        const upload = await w.h.readyImage(ada.id);
        await FREEZES[freeze]!(w, { postId: p.postId, ownerId: ada.id, handle: ada.handle });
        expect(await postFrozen(w.tx, p.postId)).toBe(true);
        // No hold stands on the rows: what keeps them is the freeze.
        expect(await w.tx.execute(sql`select 1 from media_holds where media_id = any(${uuids(p.mediaIds)})`)).toHaveLength(0);

        const frozen: Frozen = { repo: w.repo, tx: w.tx, ownerId: ada.id, postId: p.postId, mediaIds: p.mediaIds };
        for (const when of ["as posted", "deleted by its author"]) {
          if (when === "deleted by its author") await authorDeletes(w.tx, p.postId);
          for (const [name, run] of Object.entries(DELETERS)) {
            const answered = await run(frozen);
            expect(answered.filter((id) => p.mediaIds.includes(id)), `${name}, ${when}`).toEqual([]);
            expect(await existing(w.tx, p.mediaIds), `${name}, ${when}`).toEqual(sorted(p.mediaIds));
          }
        }
        // The account's upload on no post is reached by no case: the owner's purge took it.
        expect(await existing(w.tx, [upload])).toEqual([]);
        expect((await w.h.files.deletionRequests()).filter((id) => p.mediaIds.includes(id))).toEqual([]);
      });
    });

    test("once nothing freezes the post any more, the same deleters take its rows", async () => {
      await inWorld(async (w) => {
        const ada = await w.h.established();
        const p = await w.h.postWithImages(ada.id, 2);
        const { caseId } = await report(w.tx, anAccount(ada.id, ada.handle), "csam");
        expect(await w.repo.detachAll(w.tx, p.postId)).toEqual([]);
        await decideIn(w.tx, admin, caseId, { kind: "final", outcome: "no_violation" });
        expect(sorted(await w.repo.detachAll(w.tx, p.postId))).toEqual(sorted(p.mediaIds));
      });
    });

    test("a hold that is released on a frozen post's image frees nothing: the freeze keeps the row whether a hold stands or not", async () => {
      await inWorld(async (w) => {
        const ada = await w.h.established();
        const p = await w.h.postWithImages(ada.id, 1);
        // A report about the post itself places its case's hold and freezes the post.
        await report(w.tx, aPost(p.postId), "csam");
        await w.tx.execute(sql`update media_holds set released_at = now() where media_id = ${p.mediaIds[0]!}::uuid`);
        const [row] = await w.tx.execute<{ held: boolean }>(sql`select hold_until is not null as held from post_media where id = ${p.mediaIds[0]!}::uuid`);
        expect(row).toEqual({ held: false });
        await authorDeletes(w.tx, p.postId);
        for (const [name, run] of Object.entries(DELETERS)) {
          await run({ repo: w.repo, tx: w.tx, ownerId: ada.id, postId: p.postId, mediaIds: p.mediaIds });
          expect(await existing(w.tx, p.mediaIds), name).toEqual(p.mediaIds);
        }
      }, migrateDb);
    });
  });

  describe("gate K through the flows: the author's deletion, the purge, the sweeper and the reconcile pass", () => {
    /** Each kind of reach through a real report of child sexual abuse material; it answers nothing, the post is frozen. */
    const REPORTS: Record<string, (w: World, post: { postId: string; ownerId: string; handle: string }) => Promise<unknown>> = {
      "its own item": (w, post) => report(w.tx, aPost(post.postId), "csam"),
      "its author's account's item": (w, post) => report(w.tx, anAccount(post.ownerId, post.handle), "csam"),
      "an item korbat added for a post that quotes it": async (w, post) => report(w.tx, aPost(await newPostRow(w.tx, (await newProfile(w.tx as unknown as Db)).id, { quoteOfId: post.postId })), "csam"),
    };

    test.each(Object.keys(REPORTS))("a post frozen through %s: its rows outlive every flow that deletes, no file of them is requested, and no reader shows them once the post is deleted", async (kind) => {
      await inWorld(async (w) => {
        const ada = await w.s.established();
        const frozen = await w.h.postWithImages(ada.id, 2);
        const free = await w.h.postWithImages(ada.id, 1);
        const upload = await w.h.readyImage(ada.id);
        await REPORTS[kind]!(w, { postId: frozen.postId, ownerId: ada.id, handle: ada.handle });
        // A case about the account reaches every post of the account, so there the other post's image is kept too.
        const kept = kind === "its author's account's item" ? [...frozen.mediaIds, ...free.mediaIds] : frozen.mediaIds;
        const requested = async () => (await w.h.files.deletionRequests()).filter((id) => kept.includes(id));

        // The author deletes the post, through the flow: the post is a tombstone, and its image rows stay.
        await deletePost(w.s.deps, ada.id, frozen.postId);
        expect(await rejection(getPost(w.s.deps, ada.id, frozen.postId))).toBe("not_found");
        expect(await existing(w.tx, frozen.mediaIds)).toEqual(sorted(frozen.mediaIds));
        expect(await requested()).toEqual([]);

        // No reader shows a kept image of a deleted post, to its owner either, so the freeze tells the author nothing.
        for (const id of frozen.mediaIds) {
          for (const viewer of [ada.id, null]) expect((await ask(w, id, viewer)).kind, `serve ${String(viewer)}`).toBe("not_found");
          expect(await w.repo.find(id)).toBeNull();
          expect(await rejection(status(w.h.deps, ada.id, id))).toBe("not_found");
          expect(await w.repo.isExportable(ada.id, id)).toBe(false);
        }
        expect((await w.repo.forPosts([frozen.postId])).size).toBe(0);
        expect(await w.repo.readyImages(ada.id)).toEqual([...free.mediaIds, upload]);
        // The reconcile pass asks which ids have a row: the kept rows are seen, so their files are no orphans.
        expect(await w.repo.existing(frozen.mediaIds)).toEqual(new Set(frozen.mediaIds));

        // The export names no image under the deleted post, holds no file of it, and lists none as missing.
        const { entries, json } = await exportOf(w, ada.id);
        expect(entries).toEqual(["export.json", `media/${free.mediaIds[0]}.webp`, `media/${upload}.webp`].sort());
        expect(json.posts.find((post) => post.id === frozen.postId)).toMatchObject({ state: "deleted_by_author", body: "", media: [] });
        expect(json.posts.find((post) => post.id === free.postId)!.media.map((image) => image.id)).toEqual(free.mediaIds);
        expect(json.missingMedia).toEqual([]);

        // The sweeper two days on, with its reconcile pass: every stored file is old by then, and none of the kept rows'
        // files is taken for an orphan.
        await sweep(w.h.deps, new Date(Date.now() + 2 * DAY), { reconcile: true });
        expect(await existing(w.tx, frozen.mediaIds)).toEqual(sorted(frozen.mediaIds));
        expect(await requested()).toEqual([]);

        // The account is purged, by the request and then again by the job: the kept rows stay, unserved, and only the
        // files of the rows that went are requested.
        const deps = accountDeps(w, [ada.id]);
        await purge(deps, ada.id);
        expect(await purgePending(deps)).toEqual({ purged: 1, failed: 0, terminated: 0 });
        expect(deps.finished).toEqual([ada.id, ada.id]);
        expect(await existing(w.tx, [...frozen.mediaIds, ...free.mediaIds, upload])).toEqual(sorted(kept));
        expect(await requested()).toEqual([]);
        expect(await w.h.files.deletionRequests()).toEqual(expect.arrayContaining([...free.mediaIds, upload].filter((id) => !kept.includes(id))));
        for (const id of frozen.mediaIds) expect((await ask(w, id, ada.id)).kind).toBe("not_found");
        expect(await postFrozen(w.tx, frozen.postId)).toBe(true);
      });
    });

    test("a purge whose transaction does not commit has asked for no file: a report that then freezes the account keeps rows whose files nobody was told to delete, neither the rerun nor the sweeper asks for them, and a seal lists images that are still there", async () => {
      await inWorld(async (w) => {
        const ada = await w.s.established();
        const own = await w.h.postWithImages(ada.id, 2);
        const requested = async () => (await w.h.files.deletionRequests()).filter((id) => own.mediaIds.includes(id));
        const deps = accountDeps(w, [ada.id]);
        // The first run deletes the rows, and its transaction does not commit: the process stops, or the connection is lost.
        const stopping: AccountDeps = {
          ...deps,
          social: {
            ...deps.social,
            purgeProfile: (userId, now, within) =>
              w.s.repo.purgeProfile(userId, now, async (tx) => {
                await within(tx);
                throw new Error("the transaction did not commit");
              }),
          },
        };
        await expect(purge(stopping, ada.id)).rejects.toThrow("the transaction did not commit");
        expect(await existing(w.tx, own.mediaIds)).toEqual(sorted(own.mediaIds));
        // The rows are back, and no file of them was asked for: the worker deletes whatever a request names.
        expect(await requested()).toEqual([]);

        // Before the purge job's next round, a report on the protected path about the account: every image is frozen.
        const suspect = await report(w.tx, anAccount(ada.id, ada.handle), "csam");
        expect(await postFrozen(w.tx, own.postId)).toBe(true);
        // The job's rerun keeps the frozen rows and asks for nothing of them.
        expect(await purgePending(deps)).toEqual({ purged: 1, failed: 0, terminated: 0 });
        expect(await existing(w.tx, own.mediaIds)).toEqual(sorted(own.mediaIds));
        expect(await requested()).toEqual([]);
        // The sweeper, which asks again for whatever a deleter still owes: a row that is still there is owed nothing,
        // at once or two days on, when the marker the failed run left is forgotten.
        await sweep(w.h.deps, new Date(), { reconcile: false });
        expect(await requested()).toEqual([]);
        await sweep(w.h.deps, new Date(Date.now() + 2 * DAY), { reconcile: true });
        expect(await requested()).toEqual([]);
        expect((await w.h.files.owedDeletions(Date.now())).filter((entry) => own.mediaIds.includes(entry.id))).toEqual([]);
        for (const id of own.mediaIds) expect(await w.h.files.imageRemains(id)).toBe(true);

        // An admin seals: the seal lists the rows, and their files are there for whoever they are released to.
        await decideIn(w.tx, admin, suspect.caseId, SEAL_FOR_GOOD);
        const states = await w.tx.execute<{ moderation_state: string }>(sql`select moderation_state from post_media where id = any(${uuids(own.mediaIds)})`);
        expect(states.map((row) => row.moderation_state)).toEqual(["sealed", "sealed"]);
        expect(await requested()).toEqual([]);
      });
    });

    test("a purge that commits and whose request for the files then fails still finishes: what it deleted stays owed, is counted as late, and the sweeper's next pass asks for exactly those files", async () => {
      await inWorld(async (w) => {
        const ada = await w.s.established();
        const own = await w.h.postWithImages(ada.id, 2);
        const upload = await w.h.readyImage(ada.id);
        const mine = [...own.mediaIds, upload];
        const requested = async () => sorted((await w.h.files.deletionRequests()).filter((id) => mine.includes(id)));
        const owed = async () => sorted((await w.h.files.owedDeletions(Date.now())).map((entry) => entry.id).filter((id) => mine.includes(id)));
        const deps = accountDeps(w, [ada.id]);
        // The requests' directory cannot be written when the purge comes to ask.
        const failing: AccountDeps = {
          ...deps,
          media: mediaForAccount({
            ...w.h.deps,
            files: {
              ...w.h.files,
              requestDeletion: async () => {
                throw new Error("EROFS: the uploads volume cannot be written");
              },
            },
          }),
        };
        await purge(failing, ada.id);
        expect(deps.finished).toEqual([ada.id]);
        expect(await existing(w.tx, mine)).toEqual([]);
        expect(await requested()).toEqual([]);
        expect(await owed()).toEqual(sorted(mine));
        // Ten minutes on, what is still owed counts among the late erasures of the staff's home screen.
        const drained = await mediaForCases(w.h.deps).overdueDeletions();
        const later = mediaForCases({ ...w.h.deps, now: () => new Date(Date.now() + 11 * 60_000) });
        expect((await later.overdueDeletions()) - drained).toBe(mine.length);

        // The sweeper's next pass, with the volume back: the files are asked for, and nothing is owed any more.
        await sweep(w.h.deps, new Date(), { reconcile: false });
        expect(await requested()).toEqual(sorted(mine));
        expect(await owed()).toEqual([]);
        expect(await later.overdueDeletions()).toBe(drained);
      });
    });

    test("the account's purge end to end with open cases about it and a report it sent: a run that does not commit asks for nothing; the request's run and the job's keep what a case holds or a freeze keeps, ask for none of its files and forget her report; the cases then go on to their decisions, the disposal and the erasure of statements", async () => {
      await inWorld(async (w) => {
        const ada = await w.s.established();
        const own = await w.h.postWithImages(ada.id, 1);
        const second = await w.h.postWithImages(ada.id, 1);
        const other = await imagePost(w.tx, 0);
        // She reported someone else's post, signed in; someone reported a post of hers under a rule; and her account is
        // reported on the protected path. The take-down has marked her auth row.
        const hers = await intake(w.tx, ground.illegal(ada.id), aPost(other.postId));
        const rule = await report(w.tx, aPost(own.postId), "rule");
        const suspect = await report(w.tx, anAccount(ada.id, ada.handle), "csam");
        await authAccount(w.tx, ada.id, "0 seconds");
        const images = [...own.mediaIds, ...second.mediaIds];
        const requested = async () => (await w.h.files.deletionRequests()).filter((id) => images.includes(id));
        const base = accountDeps(w, [ada.id]);
        const deps: typeof base = {
          ...base,
          moderation: {
            forgetAccount: async (userId) => void (await forgetReporter(w.tx, userId)),
            exportFor: () => Promise.reject(new Error("not exercised here")),
            takeDownDue: async () => ({ terminated: 0, failed: 0 }),
          },
        };

        // A first run whose transaction does not commit: nothing of it stands, and no file was asked for.
        const stopping: AccountDeps = {
          ...deps,
          social: {
            ...deps.social,
            purgeProfile: (userId, now, within) =>
              w.s.repo.purgeProfile(userId, now, async (tx) => {
                await within(tx);
                throw new Error("the transaction did not commit");
              }),
          },
        };
        await expect(purge(stopping, ada.id)).rejects.toThrow("the transaction did not commit");
        expect(await requested()).toEqual([]);

        // The request's run, and the job's after it.
        await purge(deps, ada.id);
        expect(await purgePending(deps)).toEqual({ purged: 1, failed: 0, terminated: 0 });
        expect(deps.finished).toEqual([ada.id, ada.id]);
        const [profile] = await w.tx.execute<{ display_name: string; bio: string; deleted: boolean; handle: string }>(sql`select display_name, bio, deleted_at is not null as deleted, handle from profiles where id = ${ada.id}::uuid`);
        expect({ ...profile! }).toEqual({ display_name: "Deleted account", bio: "", deleted: true, handle: ada.handle });
        expect([...(await w.tx.execute<{ state: string; body: string }>(sql`select state, body from posts where author_id = ${ada.id}::uuid`))].map((row) => ({ ...row }))).toEqual([
          { state: "deleted_by_author", body: "" },
          { state: "deleted_by_author", body: "" },
        ]);
        // Every image row stays (the freeze keeps them all, the rule case holds one), and none of their files was asked for.
        expect(await existing(w.tx, images)).toEqual(sorted(images));
        expect(await requested()).toEqual([]);
        expect([await postFrozen(w.tx, own.postId), await postFrozen(w.tx, second.postId)]).toEqual([true, true]);
        // Her report no longer names her, on the notice or on its items.
        const [forgotten] = await w.tx.execute<{ intake: boolean; items: boolean }>(
          sql`select n.reporter_id is null as intake, (select bool_and(i.reporter_account_id is null) from intake_items i where i.intake_id = n.id) as items from intakes n where n.id = ${hers.intakeId}::uuid`,
        );
        expect({ ...forgotten! }).toEqual({ intake: true, items: true });

        // The rule case is decided on its copy: the removal changes nothing, the post being deleted, and says so.
        const removal = await decideIn(w.tx, mod, rule.caseId, { kind: "final", ruleId: "R1", actions: [act("remove")] });
        // 3e: the strike it gives counts all the same (a strike never has a no_effect): what counts is the breach.
        expect((await actionsOf(w.tx, removal)).map((action) => [action.kind, action.no_effect])).toEqual([
          ["remove", "deleted"],
          ["strike", null],
        ]);
        expect(statementParagraphs((await decisionStatement(w.tx as unknown as Db, removal))!.statement)[0]).toContain(STATEMENT_WORDS.deletedPost);
        // Its mail finds nobody: the auth module answers no_address for an account that is gone.
        expect(await sendStatement({ apiDb: w.tx as unknown as Db, auth: { mailAccount: async () => "no_address" } as never, social: socialForModeration(w.tx as unknown as Db) }, removal)).toBe("no_address");

        // The admin answers the report about her account without a seal: the freeze ends, and the disposal takes the image
        // no case holds and keeps the one the rule case holds.
        await decideIn(w.tx, admin, suspect.caseId, { kind: "final", outcome: "no_violation" });
        expect([await postFrozen(w.tx, own.postId), await postFrozen(w.tx, second.postId)]).toEqual([false, false]);
        const gone = await w.cases.dropDisposable(w.tx);
        expect(gone.filter((id) => images.includes(id))).toEqual(second.mediaIds);
        expect(await existing(w.tx, images)).toEqual(own.mediaIds);

        // Thirteen months after her account was deleted, the removal's statement texts are due and erased.
        await ageCase(w.tx, rule.caseId, "13 months");
        await w.tx.execute(sql`update auth.users set deleted_at = now() - interval '13 months' where id = ${ada.id}::uuid`);
        await w.tx.execute(sql`update profiles set deleted_at = now() - interval '13 months' where id = ${ada.id}::uuid`);
        expect(await dueStatements(w.tx, 12)).toContain(removal);
        expect(await eraseStatementTexts(w.tx, removal)).toBe(2);
      }, migrateDb);
    });

    test("a deleted post whose images a case holds, with no freeze: the same for every reader and for the export", async () => {
      await inWorld(async (w) => {
        const ada = await w.s.established();
        const held = await w.h.postWithImages(ada.id, 2);
        const free = await w.h.postWithImages(ada.id, 1);
        // A report under a rule: its case holds the post's images as evidence.
        await report(w.tx, aPost(held.postId), "rule");
        expect(await postFrozen(w.tx, held.postId)).toBe(false);
        await deletePost(w.s.deps, ada.id, held.postId);
        expect(await existing(w.tx, held.mediaIds)).toEqual(sorted(held.mediaIds));
        expect((await w.h.files.deletionRequests()).filter((id) => held.mediaIds.includes(id))).toEqual([]);
        for (const id of held.mediaIds) {
          expect((await ask(w, id, ada.id)).kind).toBe("not_found");
          expect(await rejection(status(w.h.deps, ada.id, id))).toBe("not_found");
        }
        const { entries, json } = await exportOf(w, ada.id);
        expect(entries).toEqual(["export.json", `media/${free.mediaIds[0]}.webp`].sort());
        expect(json.posts.find((post) => post.id === held.postId)).toMatchObject({ state: "deleted_by_author", media: [] });
        expect(json.missingMedia).toEqual([]);
        // The sweeper's reconcile pass leaves the retained rows' files alone.
        await sweep(w.h.deps, new Date(Date.now() + 2 * DAY), { reconcile: true });
        expect((await w.h.files.deletionRequests()).filter((id) => held.mediaIds.includes(id))).toEqual([]);
        expect(await existing(w.tx, held.mediaIds)).toEqual(sorted(held.mediaIds));
      });
    });
  });

  describe("gates S and V: every reader, for a frozen post and for sealed images", () => {
    /** An author with an image post, a reply of their own with an image and a post Explore ranks, and a reader who follows them. */
    async function scene(w: World) {
      // Explore ranks as of a past this file has to itself, so no other suite's post is in the ranking read below.
      const asOf = new Date(Date.UTC(2019, 0, 10, 12));
      const [author, other, ...fans] = await accounts(w.tx as unknown as Db, asOf, 5);
      const top = await w.h.postWithImages(author!.id, 2);
      const strangerReply = await newPost(w.s.repo, other!.id, w.s.clock.next(), "a reply by someone else", { replyToId: top.postId });
      const reply = await newPost(w.s.repo, author!.id, w.s.clock.next(), "a reply with an image", { replyToId: top.postId });
      const replyImage = await w.h.readyImage(author!.id);
      await w.tx.execute(sql`update post_media set post_id = ${reply}::uuid, position = 0, alt_text = 'a reply image' where id = ${replyImage}::uuid`);
      const quoting = await newPost(w.s.repo, other!.id, w.s.clock.next(), "look at this", { quoteOfId: top.postId });
      const ranked = await newPostRow(w.tx, author!.id, { createdAt: sql`${earlier(asOf, 2 * HOUR).toISOString()}::timestamptz` });
      const rankedImage = await newImageRow(w.tx, author!.id, ranked, 0);
      await likedBy(w.s.repo, ranked, fans as { id: string }[], earlier(asOf, HOUR));
      // A round writes nothing while a ranking as new as its own time exists, and other suites leave theirs behind:
      // inside this transaction, which is rolled back, there is none.
      await w.tx.execute(sql`delete from explore_runs`);
      await rank(w.s.repo, asOf);
      for (const reader of [author!, other!]) {
        expect(await w.s.repo.like(reader.id, top.postId, w.s.clock.next())).toBe(true);
        expect(await w.s.repo.bookmark(reader.id, top.postId, w.s.clock.next())).toBe(true);
      }
      expect(await w.s.repo.follow(other!.id, author!.id, w.s.clock.next())).toBe(true);
      return { author: author!, other: other!, top, strangerReply, reply, replyImage, quoting, ranked, rankedImage };
    }
    type Scene = Awaited<ReturnType<typeof scene>>;
    type Listed = (MediaView | HiddenMedia)[] | undefined;

    /**
     * Every list a post's images are read through, each as the viewer gets it: the images of the named post in that list.
     * `signedIn` marks the lists only an account has; Following is read by the one who follows the author.
     */
    function lists(w: World, f: Scene): { name: string; images: string[]; signedIn?: boolean; onlyFor?: string; read: (viewer: string | null) => Promise<Listed> }[] {
      const top = [...f.top.mediaIds];
      const inItems = (items: { post: PostView }[], id: string) => items.find((item) => item.post.id === id)?.post.media;
      const inPosts = (items: PostView[], id: string) => items.find((post) => post.id === id)?.media;
      return [
        { name: "the single post", images: top, read: async (v) => (await getPost(w.s.deps, v, f.top.postId)).media },
        { name: "a thread's own post", images: top, read: async (v) => (await thread(w.s.deps, v, f.top.postId, page)).post.media },
        { name: "a thread's ancestor", images: top, read: async (v) => inPosts((await thread(w.s.deps, v, f.strangerReply, page)).ancestors as PostView[], f.top.postId) },
        { name: "a thread's reply", images: [f.replyImage], read: async (v) => inPosts((await thread(w.s.deps, v, f.top.postId, page)).replies.items, f.reply) },
        { name: "the Latest timeline", images: top, read: async (v) => inItems((await latestTimeline(w.s.deps, v, page)).items, f.top.postId) },
        { name: "the Following timeline", images: top, signedIn: true, onlyFor: f.other.id, read: async (v) => inItems((await followingTimeline(w.s.deps, v!, page)).items, f.top.postId) },
        { name: "Explore", images: [f.rankedImage], read: async (v) => inItems((await explorePage(w.s.deps, v, page)).items, f.ranked) },
        { name: "the profile's posts", images: top, read: async (v) => inItems((await profilePosts(w.s.deps, v, f.author.handle, page)).items, f.top.postId) },
        { name: "the profile's replies", images: [f.replyImage], read: async (v) => inPosts((await profileReplies(w.s.deps, v, f.author.handle, page)).items, f.reply) },
        { name: "likes", images: top, signedIn: true, read: async (v) => inPosts((await likedPosts(w.s.deps, v!, page)).items, f.top.postId) },
        { name: "bookmarks", images: top, signedIn: true, read: async (v) => inPosts((await bookmarkedPosts(w.s.deps, v!, page)).items, f.top.postId) },
        { name: "a quote embed", images: top, read: async (v) => { const quote = (await getPost(w.s.deps, v, f.quoting)).quoteOf; return quote && "media" in quote ? quote.media : undefined; } },
      ];
    }
    /** Runs every list for every viewer it has, and hands each answer to `check`. */
    async function everyList(w: World, f: Scene, check: (answer: Listed, images: string[], viewer: string | null, label: string) => void) {
      for (const list of lists(w, f)) {
        for (const viewer of [f.author.id, f.other.id, null]) {
          if (viewer === null && list.signedIn) continue;
          if (list.onlyFor && viewer !== list.onlyFor) continue;
          check(await list.read(viewer), list.images, viewer, `${list.name}, read by ${viewer === f.author.id ? "the author" : viewer === null ? "nobody signed in" : "another account"}`);
        }
      }
    }
    test("a frozen post whose images are not sealed: staff are refused, and every other reader is unchanged", async () => {
      await inWorld(async (w) => {
        const f = await scene(w);
        await report(w.tx, anAccount(f.author.id, f.author.handle), "csam");
        expect(await postFrozen(w.tx, f.top.postId)).toBe(true);

        let read = 0;
        await everyList(w, f, (answer, images, _viewer, label) => {
          read++;
          expect(answer, label).toEqual(images.map(whole));
          expect(answer!.some((image) => "hidden" in image), label).toBe(false);
        });
        // Twelve lists: nine for every reader, likes and bookmarks for the two accounts, Following for the one who follows.
        expect(read).toBe(9 * 3 + 2 * 2 + 1);
        for (const id of f.top.mediaIds) {
          for (const viewer of [f.author.id, f.other.id, null]) expect(await ask(w, id, viewer), String(viewer)).toEqual({ kind: "file", cacheControl: "public, max-age=300" });
          expect(await status(w.h.deps, f.author.id, id)).toMatchObject({ status: "ready", blurhash: "L2Eo_P_3jb_3~qoL" });
          expect(await w.repo.isExportable(f.author.id, id)).toBe(true);
        }
        expect(await w.repo.readyImages(f.author.id)).toEqual(expect.arrayContaining([...f.top.mediaIds, f.replyImage, f.rankedImage]));
        // Gate V: nobody at korbat opens an image of a frozen post, though everyone else is still served it.
        for (const id of f.top.mediaIds) {
          writeFileSync(w.h.files.store.image(id, "large"), webpBytes("VP8X", 2048, 1536));
          expect(await staffOpens(w, id)).toBe(false);
        }
      });
    });

    test("sealed images: nobody is served, the author included; every list carries the placeholder, with `sealed` only for the author and nothing of the image; the export holds none", async () => {
      await inWorld(async (w) => {
        const f = await scene(w);
        // The export's list of files is read before the seal, as an archive that is already streaming read it.
        const streaming = await mediaForAccount(w.h.deps).exportImages(f.author.id);
        const all = [...f.top.mediaIds, f.replyImage, f.rankedImage];
        expect(streaming.map((image) => image.id)).toEqual(expect.arrayContaining(all));

        const { caseId } = await report(w.tx, anAccount(f.author.id, f.author.handle), "csam");
        await decideIn(w.tx, mod, caseId, SEAL_WHILE_DECIDING);

        let read = 0;
        await everyList(w, f, (answer, images, viewer, label) => {
          read++;
          expect(answer, label).toEqual(images.map((id) => (viewer === f.author.id ? { id, hidden: true, sealed: true } : { id, hidden: true })));
          // Nothing made from the image, and nothing that leads to it.
          const text = JSON.stringify(answer);
          for (const part of ["blurhash", "L2Eo_P", "/api/media/", "width", "alt", "image 1"]) expect(text, `${label}: ${part}`).not.toContain(part);
          // What the contract's post view accepts in its media list.
          for (const image of answer!) expect(PostView.shape.media.element.safeParse(image).success, label).toBe(true);
        });
        expect(read).toBe(9 * 3 + 2 * 2 + 1);

        for (const id of all) {
          for (const viewer of [f.author.id, f.other.id, null]) expect((await ask(w, id, viewer)).kind, `serve ${String(viewer)}`).toBe("not_found");
          // A browser that holds the file's tag gets no "not modified" either.
          expect((await ask(w, id, f.author.id, `"${id}-large"`)).kind).toBe("not_found");
          expect(await w.repo.find(id)).toMatchObject({ id, status: "ready", blurhash: null });
          const answer = await status(w.h.deps, f.author.id, id);
          expect(answer).toMatchObject({ id, status: "ready" });
          expect("blurhash" in answer).toBe(false);
          expect(await w.repo.isExportable(f.author.id, id)).toBe(false);
          expect(await staffOpens(w, id)).toBe(false);
        }
        expect((await w.repo.forPosts([f.top.postId])).get(f.top.postId)).toEqual(f.top.mediaIds.map((id) => ({ id, state: "sealed" })));

        // The export: the posts keep their text and name no sealed image; no file of one is in the archive, and an
        // archive that was streaming when the seal committed opens none from then on.
        expect((await w.repo.readyImages(f.author.id)).filter((id) => all.includes(id))).toEqual([]);
        const { entries, json } = await exportOf(w, f.author.id);
        expect(entries.filter((name) => all.some((id) => name.includes(id)))).toEqual([]);
        for (const postId of [f.top.postId, f.reply, f.ranked]) expect(json.posts.find((post) => post.id === postId)!.media, postId).toEqual([]);
        expect(json.posts.find((post) => post.id === f.top.postId)!.body).toBe("a post with images");
        expect(json.missingMedia).toEqual([]);
        for (const image of streaming.filter((entry) => all.includes(entry.id))) expect(await image.open(), image.id).toBeNull();
        // The reconcile pass still sees every sealed row.
        expect(await w.repo.existing(all)).toEqual(new Set(all));
      });
    });

    test.each([
      ["withheld", { kind: "interim", ruleId: "R2", actions: [act("seal_media"), act("withhold")] }, "moderator"],
      ["removed", { kind: "final", ruleId: "R2", actions: [act("seal_media"), act("remove")] }, "admin"],
    ] as const)("a sealed image of a post that is itself %s answers not found to its author too: the seal is tested before the author's branch", async (state, decision, by) => {
      await inWorld(async (w) => {
        const ada = await w.s.established();
        const p = await w.h.postWithImages(ada.id, 1);
        const plain = await w.h.postWithImages(ada.id, 1);
        const { caseId } = await report(w.tx, aPost(p.postId), "csam");
        await decideIn(w.tx, by === "admin" ? admin : mod, caseId, decision as DecisionInput);
        const [row] = await w.tx.execute<{ state: string }>(sql`select state from posts where id = ${p.postId}::uuid`);
        expect(row!.state).toBe(state);
        expect((await ask(w, p.mediaIds[0]!, ada.id)).kind).toBe("not_found");
        // The author still reads the post, with the placeholder in the image's place.
        expect((await getPost(w.s.deps, ada.id, p.postId)).media).toEqual([{ id: p.mediaIds[0], hidden: true, sealed: true }]);
        // A post that is only withheld or removed, with an image that is not sealed, still shows it to its author alone.
        const other = await report(w.tx, aPost(plain.postId), "rule");
        await decideIn(w.tx, mod, other.caseId, state === "withheld" ? { kind: "interim", actions: [act("withhold")] } : { kind: "final", actions: [act("remove")] });
        expect(await ask(w, plain.mediaIds[0]!, ada.id)).toEqual({ kind: "file", cacheControl: "private, no-store" });
        expect((await ask(w, plain.mediaIds[0]!, null)).kind).toBe("not_found");
        const view = (await getPost(w.s.deps, ada.id, plain.postId)).media[0]!;
        expect(view).toMatchObject({ id: plain.mediaIds[0], alt: "image 1" });
        // The image itself is not restricted: its post's chip says what the post is.
        expect("moderation" in view).toBe(false);
      });
    });
  });

  describe("an image that is itself withheld or removed", () => {
    test("its author gets it with its state and is served it; anyone else gets a placeholder that does not say which, and is not served it", async () => {
      await inWorld(async (w) => {
        const [ada, bob] = [await w.s.established(), await w.s.established()];
        const p = await w.h.postWithImages(ada.id, 3);
        const [first, second, third] = p.mediaIds as [string, string, string];
        const { caseId } = await report(w.tx, aPost(p.postId), "rule");
        const media = async (viewer: string | null) => (await getPost(w.s.deps, viewer, p.postId)).media;

        await decideIn(w.tx, mod, caseId, { kind: "interim", actions: [act("withhold_media", first)] });
        expect(await media(ada.id)).toEqual([expect.objectContaining({ id: first, moderation: "withheld", alt: "image 1", large: mediaPath(first, "large") }), whole(second), whole(third)]);
        for (const viewer of [bob.id, null]) expect(await media(viewer), String(viewer)).toEqual([{ id: first, hidden: true }, whole(second), whole(third)]);
        expect(await ask(w, first, ada.id)).toEqual({ kind: "file", cacheControl: "private, no-store" });
        for (const viewer of [bob.id, null]) expect((await ask(w, first, viewer)).kind).toBe("not_found");
        expect(await ask(w, second, null)).toEqual({ kind: "file", cacheControl: "public, max-age=300" });

        // The final decision removes another image and closes the case, which ends the withhold taken while deciding.
        await decideIn(w.tx, mod, caseId, { kind: "final", actions: [act("remove_media", second)] });
        const own = await media(ada.id);
        expect(own).toEqual([whole(first), expect.objectContaining({ id: second, moderation: "removed" }), whole(third)]);
        expect("moderation" in own[0]!).toBe(false);
        // The same placeholder as for a withheld image: it does not say which.
        for (const viewer of [bob.id, null]) expect(await media(viewer), String(viewer)).toEqual([whole(first), { id: second, hidden: true }, whole(third)]);
        // A removed image stays with its author: in their view, in their export's list and among its files.
        const { entries, json } = await exportOf(w, ada.id);
        expect(json.posts.find((post) => post.id === p.postId)!.media.map((image) => image.id)).toEqual(p.mediaIds);
        expect(entries).toEqual(["export.json", ...p.mediaIds.map((id) => `media/${id}.webp`)].sort());
        // Staff may open a removed image: it is what they judge an appeal on.
        writeFileSync(w.h.files.store.image(second, "large"), webpBytes("VP8X", 2048, 1536));
        expect(await staffOpens(w, second)).toBe(true);
      });
    });
  });

  test("this file left no moderation row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    expect(await moderationCounts(apiDb)).toEqual(counts);
    expect(await authCaseCounts(migrateDb)).toEqual(authCounts);
  });
});
