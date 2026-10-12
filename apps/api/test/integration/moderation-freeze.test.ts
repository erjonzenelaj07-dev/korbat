import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createMediaRepo } from "../../src/media/repo";
import {
  gate,
  illegalNotice,
  insertItem,
  newImageRow,
  newMarker,
  newPostRow,
  openCase,
  postFrozen,
  removeFixtures,
  rowCounts,
  ruleReport,
  suspectItemOn,
  untilBlocked,
  type TargetType,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack, withLockTimeout } from "./staff-fixtures";

// Most tests here issue dozens of statements, each a round trip, and several hold a transaction open across them: on a
// loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The freeze of the path for suspected child sexual abuse material (3c design, section 6.1) against the real database, as
 * far as it holds without a decision: the predicate, gate K (the trigger post_media_keep, which keeps every image row of
 * a frozen post and every held row against every delete, and post_media_guard and post_media_insert, which keep an image
 * on its post), and the holds' trigger. The statements the later flows will issue are written here as SQL. They run as
 * korbat_api unless a test says otherwise; a released hold exists only through code of a later migration, so the tests
 * that need one write it as the migrator. A test with one session runs inside a transaction that is rolled back; a test
 * with two sessions has to commit, and removes what it committed in a `finally`. The file's last test holds it to
 * leaving nothing behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the freeze, the keep trigger and the holds", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 6 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 3 });
    before = await rowCounts(apiDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  const profile = (db: Db | DbTx) => newProfile(db as Db);
  /** An author with a post that carries this many images. */
  async function imagePost(db: Db | DbTx, images = 2, authorId?: string) {
    const ownerId = authorId ?? (await profile(db)).id;
    const postId = await newPostRow(db, ownerId);
    const mediaIds: string[] = [];
    for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(db, ownerId, postId, position));
    return { ownerId, postId, mediaIds };
  }
  const uuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;
  /** Which of these image rows still exist. */
  async function existing(db: Db | DbTx, ids: readonly string[]): Promise<string[]> {
    const rows = await db.execute<{ id: string }>(sql`select id from post_media where id = any(${uuids(ids)}) order by id`);
    return rows.map((row) => row.id);
  }
  const ids = (rows: Iterable<{ id: string }>) => [...rows].map((row) => row.id).sort();
  /** The error of one step inside a transaction, which stays usable: the step runs in a savepoint. */
  const within = (tx: DbTx, fn: (sp: DbTx) => Promise<unknown>) => pgError(tx.transaction(fn));
  /** A transaction at the given isolation level, always rolled back, with the lock timeout every test transaction has. */
  async function rolledBackAt(db: Db, isolationLevel: "repeatable read" | "serializable", fn: (tx: DbTx) => Promise<void>): Promise<void> {
    const rollback = new Error("rolled back on purpose");
    const outcome = await db
      .transaction(
        async (tx) => {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          await fn(tx);
          throw rollback;
        },
        { isolationLevel },
      )
      .then(
        () => null,
        (err: unknown) => err,
      );
    if (outcome !== rollback) throw outcome;
  }
  /** A case's evidence hold on an image, as the API role places it. */
  const hold = (db: Db | DbTx, mediaId: string, caseId: string, until: SQL = sql`null`) =>
    db.execute<{ id: number }>(sql`insert into media_holds (media_id, case_id, until) values (${mediaId}::uuid, ${caseId}::uuid, ${until}) returning id`);
  const holdUntil = async (db: Db | DbTx, mediaId: string) => (await db.execute<{ until: string | null }>(sql`select hold_until::text as until from post_media where id = ${mediaId}::uuid`))[0]!.until;

  /** The two forms a delete of image rows takes, by post or by owner: in id order under row locks, and plain. */
  const DELETE = {
    ordered: (column: "post_id" | "owner_id", id: string, marker = "") =>
      sql`delete ${sql.raw(marker ? `/* ${marker} */` : "")} from post_media where id in (select id from post_media where ${sql.raw(column)} = ${id}::uuid order by id for update) returning id`,
    plain: (column: "post_id" | "owner_id", id: string, marker = "") => sql`delete ${sql.raw(marker ? `/* ${marker} */` : "")} from post_media where ${sql.raw(column)} = ${id}::uuid returning id`,
  };
  /** An intake's lock statement: every image row of the posts and every attached row of the owners, in one id order. */
  const lockImages = (tx: DbTx, posts: readonly string[], owners: readonly string[], marker = "") =>
    tx.execute<{ id: string }>(
      sql`select ${sql.raw(marker ? `/* ${marker} */` : "")} m.id from post_media m join posts p on p.id = m.post_id where m.post_id = any(${uuids(posts)}) or m.owner_id = any(${uuids(owners)}) order by m.id for key share of m`,
    );

  describe("the predicate, without a decision", () => {
    test("a post nobody reported is not frozen, nor one reported on another ground, nor a post that does not exist", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await imagePost(tx, 1);
        expect(await postFrozen(tx, postId)).toBe(false);
        const reporter = await profile(tx);
        const caseId = await openCase(tx, "post", postId);
        await insertItem(tx, { intakeId: await ruleReport(tx, reporter.id, "R5"), caseId, targetId: postId, lane: 0 });
        // A notice on the law alone has no rule: its item's suspect is false, never null, and the predicate stays false.
        const legal = await insertItem(tx, { intakeId: await illegalNotice(tx, reporter.id), caseId, targetId: postId, lane: 1 });
        expect(legal.suspect).toBe(false);
        expect(await postFrozen(tx, postId)).toBe(false);
        expect(await postFrozen(tx, randomUUID())).toBe(false);
      });
    });

    test("an unanswered suspect item about a post freezes that post and no other", async () => {
      await rolledBack(apiDb, async (tx) => {
        const one = await imagePost(tx, 1);
        const other = await imagePost(tx, 1, one.ownerId);
        await suspectItemOn(tx, "post", one.postId);
        expect([await postFrozen(tx, one.postId), await postFrozen(tx, other.postId)]).toEqual([true, false]);
      });
    });

    test("one about an account freezes every post of the account, a deleted one and a later one included, and nobody else's", async () => {
      await rolledBack(apiDb, async (tx) => {
        const live = await imagePost(tx, 1);
        const deleted = await imagePost(tx, 1, live.ownerId);
        await tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted.postId}::uuid`);
        const stranger = await imagePost(tx, 1);
        await suspectItemOn(tx, "account", live.ownerId);
        const later = await imagePost(tx, 1, live.ownerId);
        const frozen = [];
        for (const p of [live, deleted, later, stranger]) frozen.push(await postFrozen(tx, p.postId));
        expect(frozen).toEqual([true, true, true, false]);
      });
    });

    test("one about a post that quotes another freezes the quoted post through the item korbat adds for it, and no other post of its author", async () => {
      await rolledBack(apiDb, async (tx) => {
        const quoted = await imagePost(tx, 1);
        const sibling = await imagePost(tx, 1, quoted.ownerId);
        const quoter = await profile(tx);
        const quotingId = await newPostRow(tx, quoter.id, { quoteOfId: quoted.postId });
        const first = await suspectItemOn(tx, "post", quotingId);
        await insertItem(tx, { intakeId: first.intakeId, caseId: await openCase(tx, "post", quoted.postId), targetId: quoted.postId, position: 11, lane: 0 });
        const frozen = [];
        for (const id of [quotingId, quoted.postId, sibling.postId]) frozen.push(await postFrozen(tx, id));
        expect(frozen).toEqual([true, true, false]);
      });
    });
  });

  describe("gate K: no image row of a frozen post, and no held row, is deleted", () => {
    test("an upload on no post goes with any delete, unless a hold retains it", async () => {
      await rolledBack(apiDb, async (tx) => {
        const owner = await profile(tx);
        const free = await newImageRow(tx, owner.id, null);
        const held = await newImageRow(tx, owner.id, null);
        await hold(tx, held, await openCase(tx, "account", owner.id));
        expect(ids(await tx.execute<{ id: string }>(DELETE.plain("owner_id", owner.id)))).toEqual([free]);
        expect(await existing(tx, [free, held])).toEqual([held]);
      });
    });

    test("an attached row that a case holds is skipped and RETURNING omits it; its sibling goes; a hold whose time has passed keeps nothing", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId, mediaIds } = await imagePost(tx, 3);
        const caseId = await openCase(tx, "post", postId);
        await hold(tx, mediaIds[0]!, caseId);
        await hold(tx, mediaIds[1]!, caseId, sql`now() - interval '1 minute'`);
        expect(await holdUntil(tx, mediaIds[0]!)).toBe("infinity");
        expect(ids(await tx.execute<{ id: string }>(DELETE.plain("post_id", postId)))).toEqual([mediaIds[1]!, mediaIds[2]!].sort());
        expect(await existing(tx, mediaIds)).toEqual([mediaIds[0]!]);
        // The ordered form and a delete by id meet the same trigger.
        expect(ids(await tx.execute<{ id: string }>(DELETE.ordered("post_id", postId)))).toEqual([]);
        expect(ids(await tx.execute<{ id: string }>(sql`delete from post_media where id = ${mediaIds[0]!}::uuid returning id`))).toEqual([]);
        expect(await existing(tx, mediaIds)).toEqual([mediaIds[0]!]);
      });
    });

    test("every image row of a post frozen through its own item is kept against every form of delete, with no hold on it", async () => {
      await rolledBack(apiDb, async (tx) => {
        const frozen = await imagePost(tx, 2);
        const free = await imagePost(tx, 1, frozen.ownerId);
        await suspectItemOn(tx, "post", frozen.postId);
        for (const statement of [DELETE.plain("post_id", frozen.postId), DELETE.ordered("post_id", frozen.postId), sql`delete from post_media where id = ${frozen.mediaIds[0]!}::uuid returning id`]) {
          expect(ids(await tx.execute<{ id: string }>(statement))).toEqual([]);
        }
        // The owner's other post is not reached by a post's case: its image goes.
        expect(ids(await tx.execute<{ id: string }>(DELETE.ordered("owner_id", frozen.ownerId)))).toEqual(free.mediaIds);
        expect(await existing(tx, [...frozen.mediaIds, ...free.mediaIds])).toEqual([...frozen.mediaIds].sort());
        expect(await holdUntil(tx, frozen.mediaIds[0]!)).toBeNull();
      });
    });

    test("an item about the account keeps the images of every post of it, a deleted post included; the account's upload on no post goes", async () => {
      await rolledBack(apiDb, async (tx) => {
        const live = await imagePost(tx, 2);
        const deleted = await imagePost(tx, 1, live.ownerId);
        await tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted.postId}::uuid`);
        const upload = await newImageRow(tx, live.ownerId, null);
        await suspectItemOn(tx, "account", live.ownerId);
        expect(ids(await tx.execute<{ id: string }>(DELETE.plain("post_id", deleted.postId)))).toEqual([]);
        expect(ids(await tx.execute<{ id: string }>(DELETE.ordered("owner_id", live.ownerId)))).toEqual([upload]);
        expect(await existing(tx, [...live.mediaIds, ...deleted.mediaIds, upload])).toEqual([...live.mediaIds, ...deleted.mediaIds].sort());
      });
    });

    describe("a delete that races an intake", () => {
      test.each([
        ["post", "ordered"],
        ["post", "plain"],
        ["account", "ordered"],
        ["account", "plain"],
      ] as const)("a %s target: the %s delete, started while the intake holds the rows with its suspect item uncommitted, waits and then deletes nothing the case reaches", async (target: TargetType, form) => {
        const { ownerId, postId, mediaIds } = await imagePost(apiDb, 2);
        const marker = newMarker();
        const wait = gate();
        const locked = gate();
        let intake: Promise<void> = Promise.resolve();
        let deletion: Promise<Iterable<{ id: string }>> = Promise.resolve([]);
        try {
          const upload = await newImageRow(apiDb, ownerId, null);
          // The intake: the case, the suspect item, then the row locks; it commits when the test lets it.
          intake = withLockTimeout(apiDb, async (tx) => {
            await suspectItemOn(tx, target, target === "post" ? postId : ownerId);
            const rows = await lockImages(tx, target === "post" ? [postId] : [], target === "post" ? [] : [ownerId]);
            expect(ids(rows)).toEqual([...mediaIds].sort());
            locked.open();
            await wait.opened;
          });
          await Promise.race([locked.opened, intake]);
          // Uncommitted, the item freezes nothing for anyone else yet.
          expect(await postFrozen(apiDb, postId)).toBe(false);
          const column = target === "post" ? "post_id" : "owner_id";
          deletion = withLockTimeout(apiDb, (tx) => tx.execute<{ id: string }>(DELETE[form](column, target === "post" ? postId : ownerId, marker)));
          await untilBlocked(apiDb, marker);
          wait.open();
          await intake;
          // The trigger read the freeze after the wait, in a statement of its own: it saw the committed item.
          expect(ids(await deletion)).toEqual(target === "post" ? [] : [upload]);
          expect(await existing(apiDb, mediaIds)).toEqual([...mediaIds].sort());
        } finally {
          // Both transactions end before the rows go, whatever failed above.
          wait.open();
          await Promise.allSettled([intake, deletion]);
          await removeFixtures(migrateDb, [ownerId]);
        }
      }, 60_000);

      test("a delete that commits first leaves the intake's lock statement with no row, and no error", async () => {
        const { ownerId, postId, mediaIds } = await imagePost(apiDb, 2);
        const marker = newMarker();
        const wait = gate();
        const deleted = gate();
        const deletion = withLockTimeout(apiDb, async (tx) => {
          const rows = await tx.execute<{ id: string }>(DELETE.ordered("post_id", postId));
          deleted.open();
          await wait.opened;
          return ids(rows);
        });
        let intake: Promise<string[]> = Promise.resolve([]);
        try {
          await Promise.race([deleted.opened, deletion]);
          intake = withLockTimeout(apiDb, async (tx) => {
            await suspectItemOn(tx, "post", postId);
            return ids(await lockImages(tx, [postId], [], marker));
          });
          await untilBlocked(apiDb, marker);
          wait.open();
          expect(await deletion).toEqual([...mediaIds].sort());
          // The report came too late for these images, as it would have a moment later.
          expect(await intake).toEqual([]);
          expect(await existing(apiDb, mediaIds)).toEqual([]);
          expect(await postFrozen(apiDb, postId)).toBe(true);
        } finally {
          // Both transactions end before the rows go, whatever failed above.
          wait.open();
          await Promise.allSettled([deletion, intake]);
          await removeFixtures(migrateDb, [ownerId]);
        }
      }, 60_000);
    });

    test("outside READ COMMITTED a delete of an attached row is refused, since the trigger would read an old snapshot; an upload on no post goes", async () => {
      for (const isolationLevel of ["repeatable read", "serializable"] as const) {
        await rolledBackAt(apiDb, isolationLevel, async (tx) => {
          const { ownerId, postId, mediaIds } = await imagePost(tx, 1);
          const upload = await newImageRow(tx, ownerId, null);
          expect(await within(tx, (sp) => sp.execute(DELETE.plain("post_id", postId))), isolationLevel).toEqual({ code: "25000", message: "read_committed_only" });
          expect(await existing(tx, mediaIds)).toEqual(mediaIds);
          expect(ids(await tx.execute<{ id: string }>(sql`delete from post_media where id = ${upload}::uuid returning id`))).toEqual([upload]);
        });
      }
    });

    test("a cascade from a deleted post or profile is refused when it meets a retained row, and passes when it meets none", async () => {
      /** The error of a cascading delete as the migrator, inside a savepoint. */
      const cascade = (tx: DbTx, table: "posts" | "profiles", id: string) => within(tx, (sp) => sp.execute(sql`delete from ${sql.raw(table)} where id = ${id}::uuid`));
      const retained = expect.objectContaining({ code: "23001", message: expect.stringMatching(/^post_media row [0-9a-f-]{36} is retained$/) });

      await rolledBack(migrateDb, async (tx) => {
        // Frozen through its post's own item.
        const own = await imagePost(tx, 2);
        await suspectItemOn(tx, "post", own.postId);
        expect(await cascade(tx, "posts", own.postId)).toEqual(retained);
        expect(await cascade(tx, "profiles", own.ownerId)).toEqual(retained);
        // An erased image of that post is kept like the others.
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${own.mediaIds[0]!}::uuid`);
        await tx.execute(sql`delete from post_media where id = ${own.mediaIds[1]!}::uuid`);
        expect(await existing(tx, own.mediaIds)).toEqual([...own.mediaIds].sort());
        expect(await cascade(tx, "posts", own.postId)).toEqual(retained);

        // Frozen through its author's account's item.
        const account = await imagePost(tx, 1);
        await suspectItemOn(tx, "account", account.ownerId);
        expect(await cascade(tx, "posts", account.postId)).toEqual(retained);
        expect(await cascade(tx, "profiles", account.ownerId)).toEqual(retained);

        // Retained by a case's hold alone.
        const held = await imagePost(tx, 1);
        await hold(tx, held.mediaIds[0]!, await openCase(tx, "post", held.postId));
        expect(await cascade(tx, "posts", held.postId)).toEqual(retained);

        // Nothing retains this one: the post and its image go, as the development cleaner needs.
        const free = await imagePost(tx, 1);
        expect(await cascade(tx, "posts", free.postId)).toBeNull();
        expect(await existing(tx, free.mediaIds)).toEqual([]);
        // Every refused post is still there.
        const left = await tx.execute<{ n: number }>(sql`select count(*)::int as n from posts where id = any(${uuids([own.postId, account.postId, held.postId])})`);
        expect(left[0]!.n).toBe(3);
      });
    });
  });

  describe("an image stays on its post, with the content it was posted with", () => {
    const refused = { code: "42501", message: "moderation_column" };
    /** The API role holds no UPDATE on owner_id at all: the grant refuses before the trigger is asked. */
    const ungranted = { code: "42501", message: expect.stringMatching(/permission denied for table post_media/) };

    test("an image row is inserted on no post: an insert that names a post is refused, for the API role and for the migrator", async () => {
      for (const db of [apiDb, migrateDb]) {
        await rolledBack(db, async (tx) => {
          const mine = await imagePost(tx, 0);
          const theirs = await imagePost(tx, 0);
          // Whoever the post belongs to: a row comes to a post only by attach's update, which the guard checks.
          for (const postId of [theirs.postId, mine.postId]) {
            const err = await within(tx, (sp) =>
              sp.execute(sql`insert into post_media (owner_id, status, width, height, blurhash, post_id, position, alt_text) values (${mine.ownerId}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL', ${postId}::uuid, 0, 'x')`),
            );
            expect(err).toEqual(refused);
          }
          const left = await tx.execute<{ n: number }>(sql`select count(*)::int as n from post_media where owner_id = ${mine.ownerId}::uuid`);
          expect(left[0]!.n).toBe(0);
        });
      }
    });

    test("the API role can neither move, detach or re-own an image, nor put an upload on another account's post, nor change an attached image's content", async () => {
      await rolledBack(apiDb, async (tx) => {
        const mine = await imagePost(tx, 1);
        const second = await newPostRow(tx, mine.ownerId);
        const theirs = await imagePost(tx, 0);
        const upload = await newImageRow(tx, mine.ownerId, null);
        const attached = mine.mediaIds[0]!;
        for (const id of [attached, upload]) {
          expect(await within(tx, (sp) => sp.execute(sql`update post_media set owner_id = ${theirs.ownerId}::uuid where id = ${id}::uuid`)), "change the owner").toEqual(ungranted);
        }
        const statements: [string, SQL][] = [
          ["move to another post of the author", sql`update post_media set post_id = ${second}::uuid where id = ${attached}::uuid`],
          ["detach", sql`update post_media set post_id = null, position = null where id = ${attached}::uuid`],
          ["attach to another account's post", sql`update post_media set post_id = ${theirs.postId}::uuid, position = 0, alt_text = 'x' where id = ${upload}::uuid`],
          ["change the alt text", sql`update post_media set alt_text = 'another description' where id = ${attached}::uuid`],
          ["change the position", sql`update post_media set position = 3 where id = ${attached}::uuid`],
          ["change the width", sql`update post_media set width = 1 where id = ${attached}::uuid`],
          ["change the height", sql`update post_media set height = 1 where id = ${attached}::uuid`],
          ["change the blurhash", sql`update post_media set blurhash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' where id = ${attached}::uuid`],
        ];
        for (const [label, statement] of statements) expect(await within(tx, (sp) => sp.execute(statement)), label).toEqual(refused);
        // Naming a guarded column without changing it, and the worker's verdict on an upload, pass.
        expect(await within(tx, (sp) => sp.execute(sql`update post_media set alt_text = alt_text, post_id = post_id where id = ${attached}::uuid`))).toBeNull();
        expect(await within(tx, (sp) => sp.execute(sql`update post_media set width = 640, height = 480, blurhash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' where id = ${upload}::uuid`))).toBeNull();
      });
    });

    test("attach, for the post's author, passes: one update of a row that is on no post", async () => {
      await rolledBack(apiDb, async (tx) => {
        const author = await profile(tx);
        const postId = await newPostRow(tx, author.id);
        const upload = await newImageRow(tx, author.id, null);
        await createMediaRepo(tx as unknown as Db).attach(tx, { postId, ownerId: author.id, items: [{ id: upload, alt: "a described image" }] });
        const [row] = await tx.execute<Record<string, unknown>>(sql`select post_id, position, alt_text from post_media where id = ${upload}::uuid`);
        expect(row).toEqual({ post_id: postId, position: 0, alt_text: "a described image" });
      });
    });

    test("the migrator is held to the same, except that it may blank what an erasure erases", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const mine = await imagePost(tx, 1);
        const second = await newPostRow(tx, mine.ownerId);
        const theirs = await imagePost(tx, 0);
        const upload = await newImageRow(tx, mine.ownerId, null);
        const attached = mine.mediaIds[0]!;
        const statements: [string, SQL][] = [
          ["move", sql`update post_media set post_id = ${second}::uuid where id = ${attached}::uuid`],
          ["detach", sql`update post_media set post_id = null, position = null where id = ${attached}::uuid`],
          ["change the owner of an attached image", sql`update post_media set owner_id = ${theirs.ownerId}::uuid where id = ${attached}::uuid`],
          ["change the owner of an upload", sql`update post_media set owner_id = ${theirs.ownerId}::uuid where id = ${upload}::uuid`],
          ["attach to another account's post", sql`update post_media set post_id = ${theirs.postId}::uuid, position = 0, alt_text = 'x' where id = ${upload}::uuid`],
        ];
        for (const [label, statement] of statements) expect(await within(tx, (sp) => sp.execute(statement)), label).toEqual(refused);
        expect(await within(tx, (sp) => sp.execute(sql`update post_media set alt_text = '', erased_at = now() where id = ${attached}::uuid`))).toBeNull();
      });
    });
  });

  describe("media_holds_apply keeps hold_until at the latest end of an image's unreleased holds", () => {
    test("a hold without an end holds for good; with an end, until then; several, until the latest; released, no longer", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const { ownerId, postId, mediaIds } = await imagePost(tx, 1);
        const mediaId = mediaIds[0]!;
        expect(await holdUntil(tx, mediaId)).toBeNull();
        const postCase = await openCase(tx, "post", postId);
        const accountCase = await openCase(tx, "account", ownerId);

        const [timed] = await hold(tx, mediaId, postCase, sql`'2031-05-06T07:08:09Z'`);
        expect(await holdUntil(tx, mediaId)).toBe((await tx.execute<{ t: string }>(sql`select '2031-05-06T07:08:09Z'::timestamptz::text as t`))[0]!.t);
        const [open] = await hold(tx, mediaId, accountCase);
        expect(await holdUntil(tx, mediaId)).toBe("infinity");

        // A release is an update of the hold's row, which only migrator-owned code makes.
        await tx.execute(sql`update media_holds set released_at = now() where id = ${open!.id}`);
        expect(await holdUntil(tx, mediaId)).not.toBe("infinity");
        expect(await holdUntil(tx, mediaId)).not.toBeNull();
        await tx.execute(sql`update media_holds set released_at = now() where id = ${timed!.id}`);
        expect(await holdUntil(tx, mediaId)).toBeNull();
      });
    });

    test("a release of one case's hold that races a new hold of another case on the same image leaves the image held", async () => {
      const { ownerId, postId, mediaIds } = await imagePost(apiDb, 1);
      const mediaId = mediaIds[0]!;
      const marker = newMarker();
      const wait = gate();
      const placed = gate();
      let placing: Promise<void> = Promise.resolve();
      let releasing: Promise<void> = Promise.resolve();
      try {
        const postCase = await openCase(apiDb, "post", postId);
        const accountCase = await openCase(apiDb, "account", ownerId);
        const [first] = await hold(apiDb, mediaId, postCase);
        // The second case's hold is placed and not yet committed: its trigger holds the image's row.
        placing = withLockTimeout(apiDb, async (tx) => {
          await hold(tx, mediaId, accountCase);
          placed.open();
          await wait.opened;
        });
        await Promise.race([placed.opened, placing]);
        // The release of the first case's hold waits for that row; once it has it, it reads the holds afresh.
        releasing = rolledBack(migrateDb, async (tx) => {
          await tx.execute(sql`update ${sql.raw(`/* ${marker} */`)} media_holds set released_at = now() where id = ${first!.id}`);
          expect(await holdUntil(tx, mediaId)).toBe("infinity");
          const left = await tx.execute<{ n: number }>(sql`select count(*)::int as n from media_holds where media_id = ${mediaId}::uuid and released_at is null`);
          expect(left[0]!.n).toBe(1);
        });
        await untilBlocked(migrateDb, marker);
        wait.open();
        await placing;
        await releasing;
        expect(await holdUntil(apiDb, mediaId)).toBe("infinity");
      } finally {
        wait.open();
        await Promise.allSettled([placing, releasing]);
        await removeFixtures(migrateDb, [ownerId]);
      }
    }, 60_000);
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
