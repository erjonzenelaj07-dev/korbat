import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { DISPOSAL_BATCH, mediaForCases, type MediaForCases } from "../../src/media";
import { createMediaRepo } from "../../src/media/repo";
import { ORPHAN_AGE_MS, RECONCILE_MAX_ORPHANS, sweep } from "../../src/media/sweeper";
import { recordIntake, type IntakeGround, type LiveTarget } from "../../src/moderation/intake";
import { createSocialRepo } from "../../src/social/repo";
import { webpBytes, type WebpKind } from "../media/webp-bytes";
import { mediaHarness, type MediaHarness } from "./media-harness";
import {
  aPost,
  act,
  anAccount,
  casesMedia,
  decideIn,
  gate,
  ground,
  imagePost,
  intake,
  moderationCounts,
  moderationDeps,
  newImageRow,
  newPostRow,
  newTestStaff,
  openCase,
  postFrozen,
  refusal,
  removeFixtures,
  report,
  staffProfile,
  untilBlocked,
  uuids,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack, withLockTimeout } from "./staff-fixtures";

// Most tests here issue dozens of statements inside one open transaction, each a round trip, and the two-session ones
// wait for a lock on purpose: on a loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

const SEAL_WHILE_DECIDING: DecisionInput = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] };
const SEAL_FOR_GOOD: DecisionInput = { kind: "final", ruleId: "R2", actions: [act("seal_media")] };
const NO_SEAL: DecisionInput = { kind: "final", outcome: "no_violation" };

/**
 * What the media module does for moderation cases (3c design, section 5, MediaForCases), against the real database: the
 * intake's holds and its lock statement, the counts of what a case reaches, the one function that opens an image file for
 * staff (gate V), the disposal of image rows nothing retains, and the deleters' lock order. As korbat_api unless a test
 * needs a mark only migrator-owned code writes (an erasure, a released hold, a moved time): that code comes with a later
 * migration, so such a test writes the mark as the migrator. A test with one session runs inside a transaction that is
 * rolled back; a test with two sessions has to commit, and removes what it committed in a `finally`. The file's last
 * test holds it to leaving no moderation row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: holds, reach, the staff's image and the disposal", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 3 });
    const repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await moderationCounts(apiDb);
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
  /** The same with the media module on that transaction and a store directory of its own, for the tests that open files. */
  const withStore = (fn: (tx: DbTx, h: MediaHarness) => Promise<void>, db: Db = apiDb) =>
    inWorld(async (tx) => {
      const h = await mediaHarness(tx as unknown as Db);
      try {
        await fn(tx, h);
      } finally {
        h.cleanup();
      }
    }, db);

  const profile = (db: Db | DbTx) => newProfile(db as Db);
  const repoOn = (db: Db | DbTx) => createMediaRepo(db as Db);
  const sorted = (ids: readonly string[]) => [...ids].sort();
  const authorDeletes = (db: Db | DbTx, postId: string, when: SQL = sql`now()`) =>
    db.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = ${when} where id = ${postId}::uuid`);
  /** Which of these image rows still exist, sorted. */
  async function existing(db: Db | DbTx, ids: readonly string[]): Promise<string[]> {
    const rows = await db.execute<{ id: string }>(sql`select id from post_media where id = any(${uuids(ids)}) order by id`);
    return rows.map((row) => row.id);
  }
  /** The holds on these images, by image and then in the order they were placed. */
  async function holdsOf(db: Db | DbTx, mediaIds: readonly string[]) {
    const rows = await db.execute<{ media_id: string; case_id: string; released: boolean; until: string | null }>(
      sql`select media_id, case_id, released_at is not null as released, until::text as until from media_holds where media_id = any(${uuids(mediaIds)}) order by media_id, id`,
    );
    return rows.map((row) => ({ mediaId: row.media_id, caseId: row.case_id, released: row.released, until: row.until }));
  }
  const holdUntil = async (db: Db | DbTx, mediaId: string) => (await db.execute<{ until: string | null }>(sql`select hold_until::text as until from post_media where id = ${mediaId}::uuid`))[0]!.until;
  /** A case's evidence hold written as a row, with an end when one is given. */
  const holdRow = (db: Db | DbTx, mediaId: string, caseId: string, until: SQL = sql`null`) =>
    db.execute(sql`insert into media_holds (media_id, case_id, until) values (${mediaId}::uuid, ${caseId}::uuid, ${until})`);
  /** A release as the migrator-owned code of a later migration makes it: an update of the hold's row. */
  const release = (tx: DbTx, mediaId: string, when: SQL = sql`now()`) => tx.execute(sql`update media_holds set released_at = ${when} where media_id = ${mediaId}::uuid and released_at is null`);

  /** The transaction with every statement it is asked to run recorded: the statement itself, its text and the rows it answered. */
  function spying(tx: DbTx) {
    const dialect = new PgDialect();
    const seen: { query: SQL; text: string; rows: Record<string, unknown>[] }[] = [];
    const spy = new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== "execute") return Reflect.get(target, property, receiver) as unknown;
        return async (query: SQL) => {
          const rows = await target.execute(query);
          seen.push({ query, text: dialect.sqlToQuery(query).sql.replace(/\s+/g, " ").trim(), rows: [...rows] as Record<string, unknown>[] });
          return rows;
        };
      },
    });
    return { spy, seen };
  }

  /**
   * One intake through the moderation module, which runs its transaction again by itself after a deadlock, a lock timeout
   * or a case that closed under it. It answers how many runs the intake took, so a deadlock the module absorbed is counted
   * here and not just survived. `afterCopy`, when given, is called each time a post was copied under its share lock.
   */
  async function intakeRuns(db: Db | DbTx, sent: IntakeGround, live: LiveTarget[], afterCopy?: (postId: string) => Promise<void>): Promise<number> {
    const deps = moderationDeps(db);
    let runs = 0;
    const counting = new Proxy(deps.apiDb, {
      get(target, property, receiver) {
        if (property !== "transaction") return Reflect.get(target, property, receiver) as unknown;
        return (...args: Parameters<Db["transaction"]>) => {
          runs++;
          return target.transaction(...args);
        };
      },
    });
    const social: typeof deps.social = !afterCopy
      ? deps.social
      : {
          ...deps.social,
          capturePost: async (tx, postId) => {
            const post = await deps.social.capturePost(tx, postId);
            await afterCopy(postId);
            return post;
          },
        };
    await recordIntake({ ...deps, apiDb: counting, social }, { ground: sent, live });
    return runs;
  }

  /** Thrown to leave a savepoint by rolling it back, and caught by whoever opened it. */
  const ROLLBACK = new Error("rolled back on purpose");

  /** One node of a plan as `explain (format json)` gives it. */
  interface PlanNode {
    "Node Type": string;
    Plans?: PlanNode[];
    [key: string]: unknown;
  }
  /** The plan PostgreSQL would run the statement under, as a flat list of its nodes. */
  async function planOf(tx: DbTx, statement: SQL): Promise<PlanNode[]> {
    const [row] = await tx.execute<{ "QUERY PLAN": { Plan: PlanNode }[] }>(sql`explain (format json) ${statement}`);
    const flat = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flat)];
    return flat(row!["QUERY PLAN"][0]!.Plan);
  }
  /** The nodes of a plan one of whose conditions calls the freeze's predicate, each by its type. */
  const readsFreeze = (nodes: PlanNode[]): string[] =>
    nodes
      .filter((node) => ["Filter", "Join Filter", "Index Cond", "Recheck Cond", "Hash Cond", "Merge Cond", "One-Time Filter"].some((key) => typeof node[key] === "string" && (node[key] as string).includes("post_frozen")))
      .map((node) => node["Node Type"]);

  /**
   * Takes every image row that is disposable now, in a transaction of the caller's: the suites share one database, and a
   * row another suite left on a deleted post would otherwise be counted among a test's own, or fill its batch.
   */
  async function drain(tx: DbTx): Promise<void> {
    while ((await repoOn(tx).dropDisposable(tx, 500)).length === 500);
  }

  describe("hold", () => {
    test("a post pair places the case's hold on every image of the post and answers them in position order, with their alt texts and sizes", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 3);
        const caseId = await openCase(tx, "post", p.postId);
        const held = await casesMedia(tx).hold(tx, [{ caseId, postId: p.postId }]);
        expect([...held.keys()]).toEqual([p.postId]);
        expect(held.get(p.postId)).toEqual(p.mediaIds.map((id, position) => ({ id, alt: `image ${position + 1}`, width: 1200, height: 800 })));
        expect(await holdsOf(tx, p.mediaIds)).toEqual(sorted(p.mediaIds).map((mediaId) => ({ mediaId, caseId, released: false, until: null })));
        for (const id of p.mediaIds) expect(await holdUntil(tx, id)).toBe("infinity");
        // What the hold is for: the author's deletion leaves the rows, and names no file to delete.
        await authorDeletes(tx, p.postId);
        expect(await repoOn(tx).detachAll(tx, p.postId)).toEqual([]);
        expect(await existing(tx, p.mediaIds)).toEqual(sorted(p.mediaIds));
      });
    });

    test("a second hold by the same case adds nothing; another case's hold stands beside it", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const postCase = await openCase(tx, "post", p.postId);
        const otherCase = await openCase(tx, "account", p.authorId);
        const media = casesMedia(tx);
        const first = await media.hold(tx, [{ caseId: postCase, postId: p.postId }]);
        expect(await media.hold(tx, [{ caseId: postCase, postId: p.postId }])).toEqual(first);
        expect(await holdsOf(tx, p.mediaIds)).toHaveLength(2);
        await media.hold(tx, [{ caseId: otherCase, postId: p.postId }]);
        expect((await holdsOf(tx, p.mediaIds)).map((hold) => hold.caseId).sort()).toEqual([postCase, postCase, otherCase, otherCase].sort());
      });
    });

    test("a hold that was released is placed again by a later report", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const caseId = await openCase(tx, "post", p.postId);
        const media = casesMedia(tx);
        await media.hold(tx, [{ caseId, postId: p.postId }]);
        await release(tx, p.mediaIds[0]!);
        expect(await holdUntil(tx, p.mediaIds[0]!)).toBeNull();
        await media.hold(tx, [{ caseId, postId: p.postId }]);
        expect((await holdsOf(tx, p.mediaIds)).map((hold) => hold.released)).toEqual([true, false]);
        expect(await holdUntil(tx, p.mediaIds[0]!)).toBe("infinity");
      }, migrateDb);
    });

    test("an erased image, and every image of a post whose content was erased, is listed without its alt text and gets no hold", async () => {
      await inWorld(async (tx) => {
        const one = await imagePost(tx, 2);
        const whole = await imagePost(tx, 1, one.authorId);
        // What the R4 redaction will leave: marks only migrator-owned code writes.
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${one.mediaIds[0]!}::uuid`);
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${whole.postId}::uuid`);
        const [caseOne, caseWhole] = [await openCase(tx, "post", one.postId), await openCase(tx, "post", whole.postId)];
        const held = await casesMedia(tx).hold(tx, [
          { caseId: caseOne, postId: one.postId },
          { caseId: caseWhole, postId: whole.postId },
        ]);
        expect(held.get(one.postId)).toEqual([
          { id: one.mediaIds[0], alt: null, width: 1200, height: 800 },
          { id: one.mediaIds[1], alt: "image 2", width: 1200, height: 800 },
        ]);
        expect(held.get(whole.postId)).toEqual([{ id: whole.mediaIds[0], alt: null, width: 1200, height: 800 }]);
        // No report prolongs the retention of what an erasure erased: only the image that was not erased is held.
        expect(await holdsOf(tx, [...one.mediaIds, ...whole.mediaIds])).toEqual([{ mediaId: one.mediaIds[1], caseId: caseOne, released: false, until: null }]);
      }, migrateDb);
    });

    test("a post without an image answers an empty list, and a hold of nothing issues no statement", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const caseId = await openCase(tx, "post", p.postId);
        const held = await casesMedia(tx).hold(tx, [{ caseId, postId: p.postId }]);
        expect([...held.entries()]).toEqual([[p.postId, []]]);
        const { spy, seen } = spying(tx);
        expect((await casesMedia(tx).hold(spy, [])).size).toBe(0);
        expect(seen).toEqual([]);
      });
    });

    test("an owner pair locks every image on the account's posts and holds none; posts' pairs and the owner's rows are locked by one statement, in one id order, and no post is locked", async () => {
      await inWorld(async (tx) => {
        const first = await imagePost(tx, 2);
        const second = await imagePost(tx, 2, first.authorId);
        const other = await imagePost(tx, 2);
        const stranger = await imagePost(tx, 1);
        const upload = await newImageRow(tx, first.authorId, null);
        const otherCase = await openCase(tx, "post", other.postId);
        const { spy, seen } = spying(tx);
        const held = await casesMedia(tx).hold(spy, [{ caseId: otherCase, postId: other.postId }, { ownerId: first.authorId }]);

        const locks = seen.filter((statement) => /\bfor (key share|share|update|no key update)\b/.test(statement.text));
        expect(locks).toHaveLength(1);
        // The rows are the images' own, the posts are read and never locked, and the order is the rows' ids.
        expect(locks[0]!.text).toMatch(/from post_media m join posts p on p\.id = m\.post_id where .* order by m\.id for key share of m$/);
        const reached = sorted([...first.mediaIds, ...second.mediaIds, ...other.mediaIds]);
        expect(locks[0]!.rows.map((row) => row.id)).toEqual(reached);
        expect(locks[0]!.rows.map((row) => row.id)).not.toContain(upload);
        expect(locks[0]!.rows.map((row) => row.id)).not.toContain(stranger.mediaIds[0]);

        // Only the post pair is answered and held: the owner's images are kept by the freeze, not by a hold.
        expect([...held.keys()]).toEqual([other.postId]);
        expect(held.get(other.postId)!.map((image) => image.id)).toEqual(other.mediaIds);
        expect((await holdsOf(tx, [...first.mediaIds, ...second.mediaIds, ...other.mediaIds, upload])).map((hold) => hold.mediaId)).toEqual(sorted(other.mediaIds));
        // The holds are placed in the images' id order, as they will be released.
        const inserts = seen.filter((statement) => statement.text.startsWith("insert into media_holds"));
        expect(inserts).toHaveLength(1);
        expect(inserts[0]!.text).toMatch(/order by [a-z.]*media_id$/);
      });
    });

    test("an owner pair alone answers nothing and holds nothing", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const held = await casesMedia(tx).hold(tx, [{ ownerId: p.authorId }]);
        expect(held.size).toBe(0);
        expect(await holdsOf(tx, p.mediaIds)).toEqual([]);
      });
    });
  });

  describe("the intake's holds", () => {
    test("a report under a rule holds the post's images for its case and lists them in the post's snapshot; a report of child sexual abuse material about an account holds none and freezes them all", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId), "rule");
        expect(await holdsOf(tx, p.mediaIds)).toEqual(sorted(p.mediaIds).map((mediaId) => ({ mediaId, caseId, released: false, until: null })));
        const [snapshot] = await tx.execute<{ media: unknown }>(sql`select media from evidence_snapshots where case_id = ${caseId}::uuid`);
        expect(snapshot!.media).toEqual(p.mediaIds.map((id, position) => ({ id, alt: `image ${position + 1}`, width: 1200, height: 800 })));

        const q = await imagePost(tx, 2);
        const handle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${q.authorId}::uuid`))[0]!.handle;
        const account = await report(tx, anAccount(q.authorId, handle), "csam");
        expect(await holdsOf(tx, q.mediaIds)).toEqual([]);
        expect(await postFrozen(tx, q.postId)).toBe(true);
        // An account's snapshot copies its fields and lists no image.
        const [fields] = await tx.execute<{ media: unknown }>(sql`select media from evidence_snapshots where case_id = ${account.caseId}::uuid`);
        expect(fields!.media).toBeNull();
      });
    });

    test("a second report into the same case adds no hold and no snapshot; a notice that names a post and its author's account holds the post's images once", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const first = await report(tx, aPost(p.postId), "rule");
        const second = await report(tx, aPost(p.postId), "illegal");
        expect(second.caseId).toBe(first.caseId);
        expect(await holdsOf(tx, p.mediaIds)).toHaveLength(2);
        const [snapshots] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from evidence_snapshots where case_id = ${first.caseId}::uuid`);
        expect(snapshots!.n).toBe(1);

        const q = await imagePost(tx, 2);
        const handle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${q.authorId}::uuid`))[0]!.handle;
        const recorded = await intake(tx, ground.csam(), [aPost(q.postId, 1), anAccount(q.authorId, handle, 2)]);
        const postCase = recorded.items.find((item) => item.targetType === "post")!.caseId!;
        expect(await holdsOf(tx, q.mediaIds)).toEqual(sorted(q.mediaIds).map((mediaId) => ({ mediaId, caseId: postCase, released: false, until: null })));
      });
    });

    test("a report of child sexual abuse material about a post its author deleted holds what is left of its images, and the tombstone's snapshot lists them", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        // An earlier case, closed since, still holds one image; its hold on the other was released, and that image went
        // with the post when its author deleted it.
        const earlier = await report(tx, aPost(p.postId), "rule");
        await decideIn(tx, mod, earlier.caseId, { kind: "final", outcome: "no_violation" });
        await release(tx, p.mediaIds[1]!);
        await authorDeletes(tx, p.postId);
        expect(await repoOn(tx).detachAll(tx, p.postId)).toEqual([p.mediaIds[1]]);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(caseId).not.toBe(earlier.caseId);
        expect((await holdsOf(tx, p.mediaIds)).map((hold) => hold.caseId).sort()).toEqual([earlier.caseId, caseId].sort());
        const [snapshot] = await tx.execute<{ media: unknown; post_state: string; body: string }>(sql`select media, post_state, body from evidence_snapshots where case_id = ${caseId}::uuid`);
        expect(snapshot).toEqual({ post_state: "deleted_by_author", body: "", media: [{ id: p.mediaIds[0], alt: "image 1", width: 1200, height: 800 }] });
      }, migrateDb);
    });
  });

  describe("reach", () => {
    const day = async (tx: DbTx, at: SQL) => (await tx.execute<{ d: string }>(sql`select to_char((${at}) at time zone 'UTC', 'YYYY-MM-DD') as d`))[0]!.d;
    const createdAt = async (tx: DbTx, postId: string) => new Date((await tx.execute<{ at: string }>(sql`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from posts where id = ${postId}::uuid`))[0]!.at);
    /** A post of the author created this long ago, with this many images. */
    async function postAged(tx: DbTx, authorId: string, age: string, images: number) {
      const postId = await newPostRow(tx, authorId, { createdAt: sql`now() - ${age}::interval` });
      const mediaIds: string[] = [];
      for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(tx, authorId, postId, position));
      return { postId, mediaIds };
    }

    test("a post case reaches its post: its image rows, how many are sealed and served, and the post's day", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const p = await postAged(tx, author.id, "3 days", 3);
        const media = casesMedia(tx);
        expect(await media.reach({ type: "post", id: p.postId })).toEqual({ posts: 1, images: 3, sealed: 0, served: 3, newestPostOn: await day(tx, sql`now() - interval '3 days'`), newestServedAt: await createdAt(tx, p.postId) });
        // A post without an image, and an id that names nothing, reach nothing.
        const empty = await postAged(tx, author.id, "1 day", 0);
        const nothing = { posts: 0, images: 0, sealed: 0, served: 0, newestPostOn: null, newestServedAt: null };
        expect(await media.reach({ type: "post", id: empty.postId })).toEqual(nothing);
        expect(await media.reach({ type: "post", id: author.id })).toEqual(nothing);
        expect(await media.reach({ type: "account", id: p.postId })).toEqual(nothing);
      });
    });

    test("an account case reaches every post of the account whatever its state, and nothing else: not an upload on no post, not another account's post", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const old = await postAged(tx, author.id, "9 days", 2);
        const deleted = await postAged(tx, author.id, "2 days", 1);
        await authorDeletes(tx, deleted.postId);
        const served = await postAged(tx, author.id, "5 days", 1);
        await postAged(tx, author.id, "1 day", 0);
        await newImageRow(tx, author.id, null);
        const stranger = await profile(tx);
        await postAged(tx, stranger.id, "1 hour", 4);
        // The newest post with image rows is the deleted one; the newest whose image is still served is the one before it.
        expect(await casesMedia(tx).reach({ type: "account", id: author.id })).toEqual({
          posts: 3,
          images: 4,
          sealed: 0,
          served: 3,
          newestPostOn: await day(tx, sql`now() - interval '2 days'`),
          newestServedAt: await createdAt(tx, served.postId),
        });
        expect(old.mediaIds).toHaveLength(2);
      });
    });

    test("after a seal nothing the case reaches is served; an image posted afterwards is served again, and counted as the newest", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const p = await postAged(tx, author.id, "4 days", 2);
        const { caseId } = await report(tx, anAccount(author.id, author.handle), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        const media = casesMedia(tx);
        expect(await media.reach({ type: "account", id: author.id })).toEqual({ posts: 1, images: 2, sealed: 2, served: 0, newestPostOn: await day(tx, sql`now() - interval '4 days'`), newestServedAt: null });
        expect(await media.reach({ type: "post", id: p.postId })).toMatchObject({ images: 2, sealed: 2, served: 0, newestServedAt: null });
        // A seal covers the images that exist when it is taken.
        const later = await postAged(tx, author.id, "1 hour", 1);
        expect(await media.reach({ type: "account", id: author.id })).toEqual({ posts: 2, images: 3, sealed: 2, served: 1, newestPostOn: await day(tx, sql`now() - interval '1 hour'`), newestServedAt: await createdAt(tx, later.postId) });
      });
    });

    test("an erased image, and an image of a post whose content was erased, is counted and not served", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const one = await postAged(tx, author.id, "3 days", 2);
        const whole = await postAged(tx, author.id, "2 days", 1);
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${one.mediaIds[0]!}::uuid`);
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${whole.postId}::uuid`);
        expect(await casesMedia(tx).reach({ type: "account", id: author.id })).toMatchObject({ posts: 2, images: 3, sealed: 0, served: 1, newestServedAt: await createdAt(tx, one.postId) });
      }, migrateDb);
    });

    test("it locks nothing, and answers counts, a day and a time: never an id, an alt text or a file", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { spy, seen } = spying(tx);
        const answer = await casesMedia(spy).reach({ type: "post", id: p.postId });
        expect(Object.keys(answer).sort()).toEqual(["images", "newestPostOn", "newestServedAt", "posts", "sealed", "served"]);
        expect(seen).toHaveLength(1);
        expect(seen[0]!.text).not.toMatch(/\bfor (key share|share|update|no key update)\b/);
        expect(JSON.stringify(answer)).not.toContain(p.mediaIds[0]);
      });
    });
  });

  describe("staffImage: the one function that opens an image file for staff", () => {
    /** Writes the two files of a ready image as the worker would: WebP headers that state these sizes. */
    function webp(h: MediaHarness, id: string, large: [WebpKind, number, number] = ["VP8X", 2048, 1536], small: [WebpKind, number, number] = ["VP8 ", 1024, 768]) {
      writeFileSync(h.files.store.image(id, "large"), webpBytes(...large, `large of ${id}`));
      writeFileSync(h.files.store.image(id, "small"), webpBytes(...small, `small of ${id}`));
    }
    /** What staffImage answers, with the file it opened closed again: the image's post and the file's size, or null. */
    async function open(media: MediaForCases, id: string, size: "small" | "large" = "large") {
      const got = await media.staffImage(id, size);
      if (!got) return null;
      await got.file.handle.close();
      return { postId: got.postId, bytes: got.file.size };
    }
    /** A post with images whose files are WebP files of the sizes their rows state. */
    async function webpPost(h: MediaHarness, authorId: string, images = 1) {
      const p = await h.postWithImages(authorId, images);
      for (const id of p.mediaIds) webp(h, id);
      return p;
    }

    test("it opens an image of a post nobody froze, in either size, and says which post the image is on", async () => {
      await withStore(async (_tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 2);
        const media = mediaForCases(h.deps);
        for (const id of p.mediaIds) {
          expect(await open(media, id, "large")).toEqual({ postId: p.postId, bytes: webpBytes("VP8X", 2048, 1536, `large of ${id}`).length });
          expect(await open(media, id, "small")).toEqual({ postId: p.postId, bytes: webpBytes("VP8 ", 1024, 768, `small of ${id}`).length });
        }
      });
    });

    test.each(["its own item", "its author's account's item", "an item korbat added for a post it is quoted by"] as const)(
      "it refuses every image of a post frozen through %s, and opens them again once an admin has answered without a seal",
      async (reach) => {
        await withStore(async (tx, h) => {
          const ada = await h.established();
          const p = await webpPost(h, ada.id, 2);
          const media = mediaForCases(h.deps);
          let caseId: string;
          if (reach === "its own item") caseId = (await report(tx, aPost(p.postId), "csam")).caseId;
          else if (reach === "its author's account's item") caseId = (await report(tx, anAccount(ada.id, ada.handle), "csam")).caseId;
          else {
            const quoting = await newPostRow(tx, (await profile(tx)).id, { quoteOfId: p.postId });
            const { recorded } = await report(tx, aPost(quoting), "csam");
            // The notice named the quoting post; the item at its position plus 10 is the quoted post's.
            caseId = recorded.items.find((item) => item.position === 11)!.caseId!;
          }
          expect(await postFrozen(tx, p.postId)).toBe(true);
          for (const id of p.mediaIds) for (const size of ["large", "small"] as const) expect(await open(media, id, size), `${id} ${size}`).toBeNull();
          await decideIn(tx, admin, caseId, NO_SEAL);
          expect(await postFrozen(tx, p.postId)).toBe(false);
          for (const id of p.mediaIds) expect(await open(media, id)).toMatchObject({ postId: p.postId });
        });
      },
    );

    test("a closed case's images are judged by the material: a later report of child sexual abuse material takes them out of staff's sight until an admin answers", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 1);
        const media = mediaForCases(h.deps);
        const closed = await report(tx, aPost(p.postId), "rule");
        await decideIn(tx, mod, closed.caseId, { kind: "final", actions: [act("remove")] });
        // A removed post's image is still evidence staff may open.
        expect(await open(media, p.mediaIds[0]!)).toMatchObject({ postId: p.postId });
        const notice = await report(tx, aPost(p.postId), "csam");
        expect(await open(media, p.mediaIds[0]!)).toBeNull();
        await decideIn(tx, admin, notice.caseId, NO_SEAL);
        expect(await open(media, p.mediaIds[0]!)).toMatchObject({ postId: p.postId });
      });
    });

    test("it refuses a sealed image: under a seal taken while deciding, under a seal for good, which keeps the post frozen though its case is closed, until an admin lifts it", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 2);
        const media = mediaForCases(h.deps);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        for (const id of p.mediaIds) expect(await open(media, id)).toBeNull();
        const final = await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);
        for (const id of p.mediaIds) expect(await open(media, id)).toBeNull();
        await decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: final, actions: [act("unseal_media")] });
        for (const id of p.mediaIds) expect(await open(media, id)).toMatchObject({ postId: p.postId });
      });
    });

    test("it refuses an erased image and every image of a post whose content was erased", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const one = await webpPost(h, ada.id, 2);
        const whole = await webpPost(h, ada.id, 1);
        const media = mediaForCases(h.deps);
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${one.mediaIds[0]!}::uuid`);
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${whole.postId}::uuid`);
        expect(await open(media, one.mediaIds[0]!)).toBeNull();
        expect(await open(media, whole.mediaIds[0]!)).toBeNull();
        expect(await open(media, one.mediaIds[1]!)).toMatchObject({ postId: one.postId });
      }, migrateDb);
    });

    test("it opens the held image of a post its author deleted, which is evidence, and nothing that is on no post, not ready or not there", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 1);
        const media = mediaForCases(h.deps);
        await report(tx, aPost(p.postId), "rule");
        await authorDeletes(tx, p.postId);
        expect(await h.deps.repo.detachAll(tx, p.postId)).toEqual([]);
        expect(await open(media, p.mediaIds[0]!)).toMatchObject({ postId: p.postId });

        const upload = await h.readyImage(ada.id);
        webp(h, upload);
        expect(await open(media, upload)).toBeNull();
        expect(await open(media, h.newId())).toBeNull();
      });
    });

    test("the file is checked before it is handed over: a WebP of the variant's size, and for the large one of the row's size; a refusal is logged as a fault of the store", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 1);
        const id = p.mediaIds[0]!;
        const faults: string[] = [];
        const log = { error: (_fields: unknown, message: string) => faults.push(message), warn: () => undefined, info: () => undefined } as unknown as Logger;
        const media = mediaForCases({ ...h.deps, log });
        const refusedWith = async (size: "small" | "large") => {
          const count = faults.length;
          expect(await open(media, id, size), size).toBeNull();
          expect(faults.length, size).toBe(count + 1);
          expect(faults.at(-1)).toMatch(/^media store: /);
        };

        // Each of the three forms a WebP takes is accepted.
        for (const kind of ["VP8 ", "VP8L", "VP8X"] as const) {
          webp(h, id, [kind, 2048, 1536], [kind, 1024, 768]);
          expect(await open(media, id, "large"), kind).not.toBeNull();
          expect(await open(media, id, "small"), kind).not.toBeNull();
        }
        expect(faults).toEqual([]);

        // Not a WebP at all: what the stand-in worker of the other suites writes, and a JPEG's first bytes.
        writeFileSync(h.files.store.image(id, "large"), `large-webp-of-${id} and enough text to fill thirty bytes`);
        await refusedWith("large");
        writeFileSync(h.files.store.image(id, "small"), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 0x20)]));
        await refusedWith("small");
        // Shorter than a header.
        writeFileSync(h.files.store.image(id, "small"), webpBytes("VP8X", 1024, 768).subarray(0, 20));
        await refusedWith("small");

        // A longer side beyond the variant's edge: 1024 for the small one.
        webp(h, id, ["VP8X", 2048, 1536], ["VP8X", 1025, 768]);
        await refusedWith("small");
        webp(h, id, ["VP8X", 2048, 1536], ["VP8L", 600, 1025]);
        await refusedWith("small");
        // The large one must be the size its row states (2048 by 1536 here), not another, and not its sides swapped.
        webp(h, id, ["VP8X", 2048, 1535]);
        await refusedWith("large");
        webp(h, id, ["VP8X", 1536, 2048]);
        await refusedWith("large");

        // A row that states a size beyond the large variant's edge of 2048 is no better for a file that agrees with it.
        const wide = await h.readyImage(ada.id, { width: 4096, height: 100 });
        const widePost = await newPostRow(tx, ada.id);
        await tx.execute(sql`update post_media set post_id = ${widePost}::uuid, position = 0, alt_text = 'wide' where id = ${wide}::uuid`);
        webp(h, wide, ["VP8X", 4096, 100], ["VP8X", 1024, 25]);
        const count = faults.length;
        expect(await open(media, wide, "large")).toBeNull();
        expect(faults.length).toBe(count + 1);
        expect(await open(media, wide, "small")).not.toBeNull();

        // A file that is not there is not found, as for any reader.
        rmSync(h.files.store.image(id, "large"));
        expect(await open(media, id, "large")).toBeNull();
      });
    });
  });

  describe("dropDisposable: the one deleter of images a case or a freeze kept", () => {
    test("a batch is half of what one reconcile pass deletes without being forced", () => {
      expect(DISPOSAL_BATCH).toBe(25);
      expect(DISPOSAL_BATCH).toBe(RECONCILE_MAX_ORPHANS / 2);
    });

    test("the files of a batch whose request was skipped are deleted by one reconcile pass without MEDIA_RECONCILE=force", async () => {
      await withStore(async (tx, h) => {
        await drain(tx);
        // Seven deleted posts of four images each, with their files in the store: 28 disposable rows, more than a batch.
        const all: string[] = [];
        for (let n = 0; n < 7; n++) {
          const p = await h.postWithImages((await h.established()).id, 4);
          await authorDeletes(tx, p.postId);
          all.push(...p.mediaIds);
        }
        const gone = await mediaForCases(h.deps).dropDisposable(tx);
        expect(gone).toEqual(sorted(all).slice(0, DISPOSAL_BATCH));
        // The crash: the batch's rows are gone, and its files were never asked for.
        expect((await h.files.deletionRequests()).filter((id) => all.includes(id))).toEqual([]);
        expect(h.deps.reconcileMode).toBe("on");

        // A reconcile pass once the files are old enough to be orphans: it takes all 25 for files without a row, which is
        // within what it deletes by itself, and refuses none.
        const report = await sweep(h.deps, new Date(Date.now() + 2 * ORPHAN_AGE_MS), { reconcile: true });
        expect(report.refused).toBe(0);
        expect(report.orphans).toBe(DISPOSAL_BATCH);
        expect(sorted((await h.files.deletionRequests()).filter((id) => all.includes(id)))).toEqual(gone);
        // The three rows the batch left keep their files.
        expect(await existing(tx, all)).toEqual(sorted(all).slice(DISPOSAL_BATCH));
      });
    });

    test("the freeze is read only for rows that carry a mark of disposal: in neither statement's plan does a scan's filter name the predicate", async () => {
      await inWorld(async (tx) => {
        const { spy, seen } = spying(tx);
        const repo = repoOn(spy);
        await repo.dropDisposable(spy, DISPOSAL_BATCH);
        await repo.overdueDeletions();
        expect(seen.map((statement) => statement.text.slice(0, 30))).toEqual(["with batch as materialized ( s", "select count(*)::int as n from"]);
        // Under the plan the planner picks, and under each join method alone.
        for (const off of [[], ["enable_nestloop"], ["enable_hashjoin", "enable_mergejoin"]]) {
          await tx.transaction(async (sp) => {
            for (const setting of off) await sp.execute(sql.raw(`set local ${setting} = off`));
            for (const statement of seen) {
              const label = `${statement.text.slice(0, 30)}, without ${off.join(" and ") || "nothing"}`;
              const nodes = await planOf(sp, statement.query);
              const reading = readsFreeze(nodes);
              // The predicate is read where a row's post and owner are known: at a join, never as the filter of a scan,
              // which would call it for every attached image row in the table.
              expect(reading.length, label).toBeGreaterThan(0);
              expect(reading.filter((type) => type.includes("Scan")), label).toEqual([]);
              // And wherever it is read, it is the branch of the CASE that comes after the marks were tested.
              for (const node of nodes) {
                for (const condition of Object.values(node)) {
                  if (typeof condition === "string" && condition.includes("post_frozen")) expect(condition, label).toMatch(/CASE WHEN \(\(p\.state = 'deleted_by_author'.*\) THEN \(.*post_frozen\(m\.post_id\).*\) ELSE false END/);
                }
              }
            }
            // The settings were for this savepoint alone.
            throw ROLLBACK;
          }).catch((err: unknown) => {
            if (err !== ROLLBACK) throw err;
          });
        }
        // What the pin is there against: the freeze as a condition of its own on the image row is the filter of that row's scan.
        const separate = sql`
          select m.id from post_media m join profiles o on o.id = m.owner_id left join posts p on p.id = m.post_id
          where (p.state = 'deleted_by_author' or o.deleted_at is not null or p.erased_at is not null or m.erased_at is not null)
            and (m.post_id is null or not public.post_frozen(m.post_id))`;
        expect(readsFreeze(await planOf(tx, separate)).filter((type) => type.includes("Scan"))).not.toEqual([]);
      });
    });

    test("each branch of its predicate: a row goes when nothing retains it and its post is deleted, its owner is purged, or its post's or its own content was erased", async () => {
      await inWorld(async (tx) => {
        await drain(tx);
        const media = casesMedia(tx);
        const owner = await profile(tx);
        const postOf = async (images: number, ownerId = owner.id) => imagePost(tx, images, ownerId);
        const caseOf = (postId: string) => openCase(tx, "post", postId);

        // Kept: nothing about these rows says that they may go.
        const live = await postOf(2);
        const liveUpload = await newImageRow(tx, owner.id, null);
        // A deleted post's rows, which a freeze or a hold that has ended left behind.
        const deleted = await postOf(2);
        await authorDeletes(tx, deleted.postId);
        // Retained: an unreleased hold without an end, and one whose end lies ahead.
        const held = await postOf(2);
        await holdRow(tx, held.mediaIds[0]!, await caseOf(held.postId));
        await holdRow(tx, held.mediaIds[1]!, await caseOf(held.postId), sql`now() + interval '1 hour'`);
        await authorDeletes(tx, held.postId);
        // No longer retained: a released hold, and a hold whose end has passed.
        const released = await postOf(2);
        await holdRow(tx, released.mediaIds[0]!, await caseOf(released.postId));
        await release(tx, released.mediaIds[0]!);
        await holdRow(tx, released.mediaIds[1]!, await caseOf(released.postId), sql`now() - interval '1 minute'`);
        await authorDeletes(tx, released.postId);
        // An erased image of a visible post goes; its sibling stays. Every image of a post whose content was erased goes.
        const erasedImage = await postOf(2);
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${erasedImage.mediaIds[0]!}::uuid`);
        const erasedPost = await postOf(1);
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${erasedPost.postId}::uuid`);
        // An erased image that another case still holds is retained like any held row.
        const erasedHeld = await postOf(1);
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${erasedHeld.mediaIds[0]!}::uuid`);
        await holdRow(tx, erasedHeld.mediaIds[0]!, await caseOf(erasedHeld.postId));
        // A purged owner's upload on no post that a hold kept through the purge and no longer keeps; a live owner's stays.
        const purged = await profile(tx);
        const purgedUpload = await newImageRow(tx, purged.id, null);
        await holdRow(tx, purgedUpload, await openCase(tx, "account", purged.id), sql`now() - interval '1 minute'`);
        await tx.execute(sql`update profiles set deleted_at = now() where id = ${purged.id}::uuid`);
        const lapsedUpload = await newImageRow(tx, owner.id, null);
        await holdRow(tx, lapsedUpload, await openCase(tx, "account", owner.id), sql`now() - interval '1 minute'`);

        const gone = [...deleted.mediaIds, ...released.mediaIds, erasedImage.mediaIds[0]!, ...erasedPost.mediaIds, purgedUpload];
        const kept = [...live.mediaIds, liveUpload, ...held.mediaIds, erasedImage.mediaIds[1]!, ...erasedHeld.mediaIds, lapsedUpload];
        // The lowest ids first, and each id it answers names a row that is gone.
        expect(await media.dropDisposable(tx)).toEqual(sorted(gone));
        expect(await existing(tx, [...gone, ...kept])).toEqual(sorted(kept));
        // The history of a deleted row's holds goes with it.
        expect(await holdsOf(tx, gone)).toEqual([]);
        expect(await media.dropDisposable(tx)).toEqual([]);
      }, migrateDb);
    });

    test("a frozen post's rows are no candidates, under each kind of freeze; a row whose freeze has ended goes", async () => {
      await inWorld(async (tx) => {
        await drain(tx);
        const media = casesMedia(tx);
        // Through the account's item, which places no hold: the freeze alone keeps the rows of the deleted post.
        const p = await imagePost(tx, 2);
        const handle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${p.authorId}::uuid`))[0]!.handle;
        const { caseId } = await report(tx, anAccount(p.authorId, handle), "csam");
        await authorDeletes(tx, p.postId);
        expect(await media.dropDisposable(tx)).toEqual([]);
        // Through a seal for good, whose case is closed.
        const q = await imagePost(tx, 1);
        const qHandle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${q.authorId}::uuid`))[0]!.handle;
        const sealing = await report(tx, anAccount(q.authorId, qHandle), "csam");
        const sealed = await decideIn(tx, admin, sealing.caseId, SEAL_FOR_GOOD);
        await authorDeletes(tx, q.postId);
        expect(await media.dropDisposable(tx)).toEqual([]);

        // The admin answers the first without a seal: its freeze ends, and the rows are disposable at once.
        await decideIn(tx, admin, caseId, NO_SEAL);
        expect(await media.dropDisposable(tx)).toEqual(sorted(p.mediaIds));
        // The seal is lifted: the second post's row goes too.
        await decideIn(tx, admin, sealing.caseId, { kind: "correction", reviewsDecisionId: sealed, actions: [act("unseal_media")] });
        expect(await media.dropDisposable(tx)).toEqual(q.mediaIds);
        expect(await existing(tx, [...p.mediaIds, ...q.mediaIds])).toEqual([]);
      });
    });

    test("60 disposable rows go in three batches of 25, 25 and 10, the lowest ids first; of 60 rows with 40 on a frozen account's posts, the other 20 go in one batch and the next is empty", async () => {
      await inWorld(async (tx) => {
        await drain(tx);
        const media = casesMedia(tx);
        const owner = await profile(tx);
        const all: string[] = [];
        for (let n = 0; n < 15; n++) {
          const p = await imagePost(tx, 4, owner.id);
          await authorDeletes(tx, p.postId);
          all.push(...p.mediaIds);
        }
        const order = sorted(all);
        expect(await media.dropDisposable(tx)).toEqual(order.slice(0, 25));
        expect(await media.dropDisposable(tx)).toEqual(order.slice(25, 50));
        expect(await media.dropDisposable(tx)).toEqual(order.slice(50));
        expect(await media.dropDisposable(tx)).toEqual([]);

        const frozen = await profile(tx);
        await report(tx, anAccount(frozen.id, frozen.handle), "csam");
        const free: string[] = [];
        for (let n = 0; n < 15; n++) {
          const p = await imagePost(tx, 4, n < 10 ? frozen.id : owner.id);
          await authorDeletes(tx, p.postId);
          if (n >= 10) free.push(...p.mediaIds);
        }
        // The kept rows never fill a batch: the candidates leave them out.
        expect(await media.dropDisposable(tx)).toEqual(sorted(free));
        expect(await media.dropDisposable(tx)).toEqual([]);
      });
    }, 120_000);

    test("a batch is a batch whatever plan the statement gets: the candidates are chosen once, also when the planner would scan them again for every row", async () => {
      // A delete whose candidates are a sub-select with a limit and row locks deletes more than the limit when the
      // planner joins by a nested loop and runs the sub-select again for each row: every run skips the rows this
      // statement has deleted already and lets the next ones in. These settings leave the planner only that join.
      for (const settings of [["enable_hashjoin", "enable_mergejoin", "enable_material"], ["enable_hashjoin", "enable_mergejoin", "enable_material", "enable_hashagg", "enable_sort"]]) {
        await inWorld(async (tx) => {
          await drain(tx);
          const owner = await profile(tx);
          const all: string[] = [];
          for (let n = 0; n < 9; n++) {
            const p = await imagePost(tx, 4, owner.id);
            await authorDeletes(tx, p.postId);
            all.push(...p.mediaIds);
          }
          for (const setting of settings) await tx.execute(sql.raw(`set local ${setting} = off`));
          const order = sorted(all);
          expect(await casesMedia(tx).dropDisposable(tx), settings.join(", ")).toEqual(order.slice(0, 25));
          expect(await existing(tx, all)).toEqual(order.slice(25));
          expect(await casesMedia(tx).dropDisposable(tx), settings.join(", ")).toEqual(order.slice(25));
        });
      }
    }, 120_000);
  });

  describe("overdueDeletions", () => {
    test("counts the rows the disposal should have taken by now: disposable, with no hold ended and no mark set in the last day", async () => {
      await inWorld(async (tx) => {
        const media = casesMedia(tx);
        const baseline = await media.overdueDeletions();
        const owner = await profile(tx);
        const twoDays = sql`now() - interval '2 days'`;
        const anHour = sql`now() - interval '1 hour'`;
        let expected = baseline;
        const check = async (label: string, change: number) => {
          expected += change;
          expect(await media.overdueDeletions(), label).toBe(expected);
        };

        const old = await imagePost(tx, 1, owner.id);
        await authorDeletes(tx, old.postId, twoDays);
        await check("a post deleted two days ago", 1);
        const fresh = await imagePost(tx, 1, owner.id);
        await authorDeletes(tx, fresh.postId, anHour);
        await check("a post deleted an hour ago", 0);

        // A hold that ended within the last day keeps the row out of the count; one that ended before it does not.
        const heldOld = await imagePost(tx, 2, owner.id);
        const heldCase = await openCase(tx, "post", heldOld.postId);
        await authorDeletes(tx, heldOld.postId, twoDays);
        await holdRow(tx, heldOld.mediaIds[0]!, heldCase);
        await holdRow(tx, heldOld.mediaIds[1]!, heldCase);
        await check("retained by unreleased holds", 0);
        await release(tx, heldOld.mediaIds[0]!, anHour);
        await check("a hold released an hour ago", 0);
        await release(tx, heldOld.mediaIds[1]!, twoDays);
        await check("a hold released two days ago", 1);
        const lapsed = await imagePost(tx, 2, owner.id);
        const lapsedCase = await openCase(tx, "post", lapsed.postId);
        await authorDeletes(tx, lapsed.postId, twoDays);
        await holdRow(tx, lapsed.mediaIds[0]!, lapsedCase, anHour);
        await holdRow(tx, lapsed.mediaIds[1]!, lapsedCase, twoDays);
        await check("holds whose end passed an hour ago and two days ago", 1);

        // The marks of an erasure, each two days old and an hour old.
        const erased = await imagePost(tx, 2, owner.id);
        await tx.execute(sql`update post_media set erased_at = ${twoDays}, alt_text = '' where id = ${erased.mediaIds[0]!}::uuid`);
        await tx.execute(sql`update post_media set erased_at = ${anHour}, alt_text = '' where id = ${erased.mediaIds[1]!}::uuid`);
        await check("an image erased two days ago and one erased an hour ago", 1);
        const erasedPost = await imagePost(tx, 1, owner.id);
        await tx.execute(sql`update posts set erased_at = ${twoDays}, body = '' where id = ${erasedPost.postId}::uuid`);
        await check("a post erased two days ago", 1);
        const erasedLately = await imagePost(tx, 1, owner.id);
        await tx.execute(sql`update posts set erased_at = ${anHour}, body = '' where id = ${erasedLately.postId}::uuid`);
        await check("a post erased an hour ago", 0);

        // A frozen post's rows are not disposable, however long ago it was deleted.
        const frozen = await imagePost(tx, 1);
        await authorDeletes(tx, frozen.postId, twoDays);
        await check("before the report", 1);
        const frozenHandle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${frozen.authorId}::uuid`))[0]!.handle;
        await report(tx, anAccount(frozen.authorId, frozenHandle), "csam");
        await check("frozen", -1);
      }, migrateDb);
    });
  });

  describe("requestDeletion", () => {
    test("asks the worker to delete the files of these images: one request file an id, and asking again is asking once", async () => {
      await withStore(async (_tx, h) => {
        const media = mediaForCases(h.deps);
        const ids = [h.newId(), h.newId()];
        await media.requestDeletion(ids);
        await media.requestDeletion([ids[0]!]);
        expect(sorted(await h.files.deletionRequests())).toEqual(sorted(ids));
      });
    });
  });

  describe("the deleters take their rows in id order", () => {
    /** A post with two images whose position order is the reverse of their id order. */
    async function reversedImages(db: Db) {
      const owner = await profile(db);
      const postId = await newPostRow(db, owner.id);
      const [low, high] = sorted([randomUUID(), randomUUID()]) as [string, string];
      // The higher id is created first and stands first on the post.
      for (const [position, id] of [high, low].entries()) {
        await db.execute(sql`insert into post_media (id, owner_id, status, width, height, blurhash, created_at) values (${id}::uuid, ${owner.id}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL', now() - ${`${10 - position} minutes`}::interval)`);
        await db.execute(sql`update post_media set post_id = ${postId}::uuid, position = ${position}, alt_text = ${`image ${position + 1}`} where id = ${id}::uuid`);
      }
      return { ownerId: owner.id, postId, low, high };
    }
    /** Whether another session could lock the row now: false while a transaction that updated, deleted or locked it holds it. */
    const free = async (table: "post_media" | "posts", id: string) => (await apiDb.execute(sql`select id from ${sql.raw(table)} where id = ${id}::uuid for share skip locked`)).length === 1;

    test.each([
      ["detachAll", "where post_id = "],
      ["purgeOwner", "where owner_id = "],
    ] as const)("%s waits at the row with the lowest id and has taken no other meanwhile, though that row stands second on the post", async (method, marker) => {
      const { ownerId, postId, low, high } = await reversedImages(apiDb);
      const [held, wait] = [gate(), gate()];
      let holding: Promise<void> = Promise.resolve();
      let deleting: Promise<string[]> = Promise.resolve([]);
      try {
        // Another transaction holds the row with the lowest id, as an intake does that reaches it.
        holding = withLockTimeout(apiDb, async (tx) => {
          await tx.execute(sql`select id from post_media where id = ${low}::uuid for key share`);
          held.open();
          await wait.opened;
        });
        await Promise.race([held.opened, holding]);
        deleting = withLockTimeout(apiDb, (tx) => (method === "detachAll" ? repoOn(tx).detachAll(tx, postId) : repoOn(tx).purgeOwner(tx, ownerId)));
        await untilBlocked(apiDb, marker);
        // A delete in the order of the post's positions would have taken the higher id first and hold it now.
        expect(await free("post_media", high)).toBe(true);
        wait.open();
        await holding;
        expect(sorted(await deleting)).toEqual([low, high]);
        expect(await existing(apiDb, [low, high])).toEqual([]);
      } finally {
        wait.open();
        await Promise.allSettled([holding, deleting]);
        await removeFixtures(migrateDb, [ownerId]);
      }
    });

    test("purgeProfile takes the account's posts in id order: it waits at the post with the lowest id and has taken no other meanwhile", async () => {
      const owner = await profile(apiDb);
      // Three posts; the one with the lowest id is neither the first nor the last by creation time, nor the first stored.
      const ids = sorted([randomUUID(), randomUUID(), randomUUID()]) as [string, string, string];
      const [low, middle, high] = ids;
      for (const [id, age] of [[middle, "3 days"], [low, "2 days"], [high, "1 day"]] as const) {
        await apiDb.execute(sql`insert into posts (id, author_id, body, created_at) values (${id}::uuid, ${owner.id}::uuid, 'a post', now() - interval '30 days' - ${age}::interval)`);
      }
      const [held, wait] = [gate(), gate()];
      let holding: Promise<void> = Promise.resolve();
      let purging: Promise<void> = Promise.resolve();
      try {
        // An intake holds a post for share while it copies it, lowest id first.
        holding = withLockTimeout(apiDb, async (tx) => {
          await tx.execute(sql`select id from posts where id = ${low}::uuid for share`);
          held.open();
          await wait.opened;
        });
        await Promise.race([held.opened, holding]);
        purging = createSocialRepo(apiDb).purgeProfile(owner.id, new Date(), async () => undefined);
        await untilBlocked(apiDb, "order by id for update");
        expect([await free("posts", middle), await free("posts", high)]).toEqual([true, true]);
        wait.open();
        await holding;
        await purging;
        const states = await apiDb.execute<{ state: string }>(sql`select state from posts where id = any(${uuids(ids)})`);
        expect(states.map((row) => row.state)).toEqual(["deleted_by_author", "deleted_by_author", "deleted_by_author"]);
      } finally {
        wait.open();
        await Promise.allSettled([holding, purging]);
        await removeFixtures(migrateDb, [owner.id]);
      }
    });

    /**
     * The two shapes in which a report holds two posts of one account that the purge's counters write: a post that quotes
     * its author's own post brings the quoted post as a target the module adds, and the report copies the two in id order.
     * In the first the quoting post has the lower id and the purge's quote counter writes the other one. In the second the
     * quoted post has the lower id and its author has deleted it: the purge tombstones only the quoting post, and its
     * counter still writes the deleted one.
     */
    const SHAPES = ["the quoting post has the lower id", "the quoted post has the lower id and was deleted by its author"] as const;
    /** An account with a post that quotes its own earlier post, an image on each, committed; `first` is the post a report copies first. */
    async function selfQuote(shape: (typeof SHAPES)[number]) {
      const owner = await profile(apiDb);
      const [low, high] = sorted([randomUUID(), randomUUID()]) as [string, string];
      const [quoting, quoted] = shape === SHAPES[0] ? [low, high] : [high, low];
      await apiDb.execute(sql`insert into posts (id, author_id, body, quote_count, created_at) values (${quoted}::uuid, ${owner.id}::uuid, 'the quoted post', 1, now() - interval '31 days')`);
      await apiDb.execute(sql`insert into posts (id, author_id, body, quote_of_id, created_at) values (${quoting}::uuid, ${owner.id}::uuid, 'a post that quotes its author', ${quoted}::uuid, now() - interval '30 days')`);
      const images = [await newImageRow(apiDb, owner.id, quoting, 0), await newImageRow(apiDb, owner.id, quoted, 0)];
      // The deleted post keeps its image row here, as a hold or a freeze would have kept it.
      if (shape === SHAPES[1]) await authorDeletes(apiDb, quoted);
      return { owner, quoting, quoted, first: low, second: high, images };
    }
    const postsOf = async (ids: readonly string[]) =>
      (await apiDb.execute<{ id: string; state: string; quote_count: number }>(sql`select id, state, quote_count from posts where id = any(${uuids(ids)}) order by id`)).map((row) => ({ ...row }));

    test.each(SHAPES)("a post that quotes its author's own post, %s; the notice holding first: the purge waits at the first post having locked neither, and no deadlock follows", async (shape) => {
      const f = await selfQuote(shape);
      const [held, wait] = [gate(), gate()];
      let reporting: Promise<number> = Promise.resolve(0);
      let purging: Promise<void> = Promise.resolve();
      let answered: string[] | null = null;
      try {
        // The notice names the quoting post and the module adds the post it quotes. It copies its posts in id order and
        // is stopped here between the two, holding the first for share.
        reporting = withLockTimeout(apiDb, (tx) =>
          intakeRuns(tx, ground.csam(), [aPost(f.quoting)], async (postId) => {
            if (postId !== f.first) return;
            held.open();
            await wait.opened;
          }),
        );
        await Promise.race([held.opened, reporting]);
        purging = createSocialRepo(apiDb).purgeProfile(f.owner.id, new Date(), async (tx) => {
          answered = await repoOn(tx).purgeOwner(tx, f.owner.id);
        });
        // The purge waits in the statement that takes the account's posts in id order, before it has written anything.
        await untilBlocked(apiDb, "order by id for update");
        // It holds nothing of the second post, which the notice asks for next. A purge that had written a counter or a
        // tombstone on that post first would hold it by now, and the two would wait for each other.
        expect(await free("posts", f.second)).toBe(true);
        wait.open();
        // Counted, not just survived: the module ran the notice once, and the purge, which nothing runs again, went through.
        expect(await reporting).toBe(1);
        expect(await refusal(purging)).toBeNull();
        expect(await postsOf([f.quoting, f.quoted])).toEqual(sorted([f.quoting, f.quoted]).map((id) => ({ id, state: "deleted_by_author", quote_count: 0 })));
        // The notice came first: both posts are frozen and their images held, and the purge took neither row.
        expect(answered).toEqual([]);
        expect(await existing(apiDb, f.images)).toEqual(sorted(f.images));
      } finally {
        wait.open();
        await Promise.allSettled([reporting, purging]);
        await removeFixtures(migrateDb, [f.owner.id]);
      }
    });

    test.each(SHAPES)("the same, %s; the purge holding first: the notice waits at the first post and then copies two tombstones in one run", async (shape) => {
      const f = await selfQuote(shape);
      const [reached, wait] = [gate(), gate()];
      let purging: Promise<void> = Promise.resolve();
      let reporting: Promise<number> = Promise.resolve(0);
      let answered: string[] = [];
      try {
        // The purge is stopped in its last act, holding the account's row, both posts and the image rows it deleted.
        purging = createSocialRepo(apiDb).purgeProfile(f.owner.id, new Date(), async (tx) => {
          answered = await repoOn(tx).purgeOwner(tx, f.owner.id);
          reached.open();
          await wait.opened;
        });
        await Promise.race([reached.opened, purging]);
        // Both posts are the purge's, the deleted one too: nobody else can take either.
        expect([await free("posts", f.first), await free("posts", f.second)]).toEqual([false, false]);
        reporting = intakeRuns(apiDb, ground.csam(), [aPost(f.quoting)]);
        await untilBlocked(apiDb, "for share of p");
        wait.open();
        expect(await refusal(purging)).toBeNull();
        expect(await reporting).toBe(1);
        // The purge came first: its delete won, and the notice's snapshots are of two tombstones.
        expect(sorted(answered)).toEqual(sorted(f.images));
        expect(await existing(apiDb, f.images)).toEqual([]);
        const copied = await apiDb.execute<{ target_id: string; post_state: string; body: string }>(sql`select target_id, post_state, body from evidence_snapshots where target_id = any(${uuids([f.quoting, f.quoted])}) order by target_id`);
        expect(copied.map((row) => ({ ...row }))).toEqual(sorted([f.quoting, f.quoted]).map((id) => ({ target_id: id, post_state: "deleted_by_author", body: "" })));
      } finally {
        wait.open();
        await Promise.allSettled([purging, reporting]);
        await removeFixtures(migrateDb, [f.owner.id]);
      }
    });

    test("purgeProfile runs the media step as the last act of its transaction: the profile is anonymised and its handle reserved by then", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const other = await profile(tx);
        const otherPost = await newPostRow(tx, other.id);
        await newPostRow(tx, owner.id);
        await tx.execute(sql`insert into likes (user_id, post_id) values (${owner.id}::uuid, ${otherPost}::uuid)`);
        await tx.execute(sql`insert into follows (follower_id, followee_id) values (${owner.id}::uuid, ${other.id}::uuid)`);
        let seen: Record<string, unknown> | undefined;
        await createSocialRepo(tx as unknown as Db).purgeProfile(owner.id, new Date(), async (within) => {
          [seen] = await within.execute<Record<string, unknown>>(sql`
            select (select deleted_at is not null from profiles where id = ${owner.id}::uuid) as anonymised,
                   (select display_name from profiles where id = ${owner.id}::uuid) as name,
                   (select count(*)::int from posts where author_id = ${owner.id}::uuid and state <> 'deleted_by_author') as live_posts,
                   (select count(*)::int from likes where user_id = ${owner.id}::uuid) as likes,
                   (select count(*)::int from follows where follower_id = ${owner.id}::uuid) as follows,
                   (select count(*)::int from handle_history where profile_id = ${owner.id}::uuid) as reserved`);
        });
        expect(seen).toEqual({ anonymised: true, name: "Deleted account", live_posts: 0, likes: 0, follows: 0, reserved: 1 });
      });
    });
  });

  describe("an intake that locks an account's images, racing the purge's ordered delete", () => {
    /** An account with two image posts and an upload on no post, committed. */
    async function account() {
      const owner = await profile(apiDb);
      const first = await imagePost(apiDb, 2, owner.id);
      const second = await imagePost(apiDb, 2, owner.id);
      const upload = await newImageRow(apiDb, owner.id, null);
      return { owner, attached: [...first.mediaIds, ...second.mediaIds], postIds: [first.postId, second.postId], upload };
    }

    test("the intake locks first: the purge waits, then keeps every attached row and takes only the upload on no post", async () => {
      const { owner, attached, upload } = await account();
      const [locked, wait] = [gate(), gate()];
      let reporting: Promise<void> = Promise.resolve();
      let purging: Promise<string[]> = Promise.resolve([]);
      try {
        // The module's own transaction is a savepoint of this one, which commits when the test lets it.
        reporting = withLockTimeout(apiDb, async (tx) => {
          await intake(tx, ground.csam(), anAccount(owner.id, owner.handle));
          locked.open();
          await wait.opened;
        });
        await Promise.race([locked.opened, reporting]);
        purging = withLockTimeout(apiDb, (tx) => repoOn(tx).purgeOwner(tx, owner.id));
        await untilBlocked(apiDb, "where owner_id = ");
        wait.open();
        await reporting;
        // The keep trigger read the freeze after the wait, in a statement of its own: it saw the committed item.
        expect(await purging).toEqual([upload]);
        expect(await existing(apiDb, attached)).toEqual(sorted(attached));
        expect(await holdsOf(apiDb, attached)).toEqual([]);
      } finally {
        wait.open();
        await Promise.allSettled([reporting, purging]);
        await removeFixtures(migrateDb, [owner.id]);
      }
    });

    test("the purge locks first: the intake waits, then locks nothing and is stored without an error; no attached row is kept", async () => {
      const { owner, attached, postIds, upload } = await account();
      const [deleted, wait] = [gate(), gate()];
      let purging: Promise<string[]> = Promise.resolve([]);
      let reporting: Promise<unknown> = Promise.resolve();
      try {
        purging = withLockTimeout(apiDb, async (tx) => {
          const ids = await repoOn(tx).purgeOwner(tx, owner.id);
          deleted.open();
          await wait.opened;
          return ids;
        });
        await Promise.race([deleted.opened, purging]);
        reporting = withLockTimeout(apiDb, (tx) => intake(tx, ground.csam(), anAccount(owner.id, owner.handle)));
        await untilBlocked(apiDb, "for key share of m");
        wait.open();
        expect(sorted(await purging)).toEqual(sorted([...attached, upload]));
        // The report came too late for these images, as it would have a moment later.
        expect(await refusal(reporting)).toBeNull();
        expect(await existing(apiDb, attached)).toEqual([]);
        expect(await postFrozen(apiDb, postIds[0]!)).toBe(true);
      } finally {
        wait.open();
        await Promise.allSettled([purging, reporting]);
        await removeFixtures(migrateDb, [owner.id]);
      }
    });

    test("the order of cases: two notices that name the same two image posts in opposite orders, at once, each land in one run, queued at their first case", async () => {
      // This says nothing about the order of image locks: every intake takes its cases in the targets' order, so the two
      // meet at the first case and the second waits there until the first has committed, its holds included. What it
      // holds is that naming the targets in another order changes nothing, and that no deadlock was absorbed on the way:
      // the module would run a deadlocked intake again, so its runs are counted.
      const owner = await profile(apiDb);
      const [a, b] = [await imagePost(apiDb, 4, owner.id), await imagePost(apiDb, 4, owner.id)];
      try {
        for (let round = 0; round < 6; round++) {
          const runs = await Promise.all([
            intakeRuns(apiDb, ground.illegal(null), [aPost(a.postId, 1), aPost(b.postId, 2)]),
            intakeRuns(apiDb, ground.illegal(null), [aPost(b.postId, 1), aPost(a.postId, 2)]),
          ]);
          expect(runs, `round ${round}`).toEqual([1, 1]);
        }
        // One hold an image from each post's case, however many notices joined it.
        expect(await holdsOf(apiDb, [...a.mediaIds, ...b.mediaIds])).toHaveLength(8);
      } finally {
        await removeFixtures(migrateDb, [owner.id]);
      }
    });
  });

  describe("hold racing dropDisposable on a deleted post's images whose hold has just ended", () => {
    /** A deleted post with two images that nothing retains any more, committed, with an open case that reaches it. */
    async function disposablePost() {
      // Rows other suites left disposable go first, in a transaction that commits: the race below must meet only its own.
      await withLockTimeout(apiDb, (tx) => drain(tx));
      const p = await imagePost(apiDb, 2);
      const caseId = await openCase(apiDb, "post", p.postId);
      await authorDeletes(apiDb, p.postId);
      return { ...p, caseId };
    }

    test("the hold locks first: the disposal waits, finds the rows held and skips them", async () => {
      const p = await disposablePost();
      const [locked, wait] = [gate(), gate()];
      let holding: Promise<void> = Promise.resolve();
      let dropping: Promise<string[]> = Promise.resolve([]);
      try {
        holding = withLockTimeout(apiDb, async (tx) => {
          const held = await casesMedia(tx).hold(tx, [{ caseId: p.caseId, postId: p.postId }]);
          expect(held.get(p.postId)!.map((image) => image.id)).toEqual(p.mediaIds);
          locked.open();
          await wait.opened;
        });
        await Promise.race([locked.opened, holding]);
        dropping = withLockTimeout(apiDb, (tx) => casesMedia(tx).dropDisposable(tx));
        await untilBlocked(apiDb, "delete from post_media where id in");
        wait.open();
        await holding;
        expect(await dropping).toEqual([]);
        expect(await existing(apiDb, p.mediaIds)).toEqual(sorted(p.mediaIds));
        expect(await holdsOf(apiDb, p.mediaIds)).toHaveLength(2);
      } finally {
        wait.open();
        await Promise.allSettled([holding, dropping]);
        await removeFixtures(migrateDb, [p.authorId]);
      }
    });

    test("the disposal deletes first: the hold waits, then skips the deleted rows: no foreign-key error, no hold, an empty answer", async () => {
      const p = await disposablePost();
      const [deleted, wait] = [gate(), gate()];
      let dropping: Promise<string[]> = Promise.resolve([]);
      let holding: Promise<Map<string, unknown[]>> = Promise.resolve(new Map());
      try {
        dropping = withLockTimeout(apiDb, async (tx) => {
          const ids = await casesMedia(tx).dropDisposable(tx);
          deleted.open();
          await wait.opened;
          return ids;
        });
        await Promise.race([deleted.opened, dropping]);
        holding = withLockTimeout(apiDb, (tx) => casesMedia(tx).hold(tx, [{ caseId: p.caseId, postId: p.postId }]));
        await untilBlocked(apiDb, "for key share of m");
        wait.open();
        expect(await dropping).toEqual(sorted(p.mediaIds));
        // An empty answer means the images are gone.
        expect([...(await holding).entries()]).toEqual([[p.postId, []]]);
        expect(await holdsOf(apiDb, p.mediaIds)).toEqual([]);
      } finally {
        wait.open();
        await Promise.allSettled([dropping, holding]);
        await removeFixtures(migrateDb, [p.authorId]);
      }
    });

    test("a report of child sexual abuse material about the account that commits while the disposal waits for its row locks: the candidates were chosen before it, and the keep trigger keeps them", async () => {
      const p = await disposablePost();
      const handle = (await apiDb.execute<{ handle: string }>(sql`select handle from profiles where id = ${p.authorId}::uuid`))[0]!.handle;
      const [locked, wait] = [gate(), gate()];
      let reporting: Promise<void> = Promise.resolve();
      let dropping: Promise<string[]> = Promise.resolve([]);
      try {
        reporting = withLockTimeout(apiDb, async (tx) => {
          await intake(tx, ground.csam(), anAccount(p.authorId, handle));
          locked.open();
          await wait.opened;
        });
        await Promise.race([locked.opened, reporting]);
        // Uncommitted, the item freezes nothing for the disposal's statement: both rows are its candidates.
        dropping = withLockTimeout(apiDb, (tx) => casesMedia(tx).dropDisposable(tx));
        await untilBlocked(apiDb, "delete from post_media where id in");
        wait.open();
        await reporting;
        expect(await dropping).toEqual([]);
        expect(await existing(apiDb, p.mediaIds)).toEqual(sorted(p.mediaIds));
      } finally {
        wait.open();
        await Promise.allSettled([reporting, dropping]);
        await removeFixtures(migrateDb, [p.authorId]);
      }
    });
  });

  test("this file left no moderation row behind: the moderation tables hold what they held before it", async () => {
    expect(await moderationCounts(apiDb)).toEqual(before);
  });
});
