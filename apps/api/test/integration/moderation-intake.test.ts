import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { laneFor, snapshotDigest, type SnapshotDigestInput } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { socialForModeration } from "../../src/social";
import { createSocialRepo } from "../../src/social/repo";
import { recordIntake } from "../../src/moderation/intake";
import { aPost, anAccount, gate, ground, intake, moderationDeps, newPostRow, refusal, removeFixtures, rowCounts, suspendRowForTest, untilBlocked, uuids } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack, withLockTimeout } from "./staff-fixtures";

// Most tests here run dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

/**
 * The intake's transaction and what the social module hands the moderation module (3c design, sections 5 and 7.1, step
 * 4), against the real database: the moderation module's recordIntake as the routes of a later task will call it, as
 * korbat_api. A test with one session runs inside a transaction that is rolled back (the module's own transaction is
 * then a savepoint of it); the one test with two sessions commits, and removes what it committed in a `finally`. The
 * runs the module makes again after a deadlock, a lock timeout or a closed case are tested without a database
 * (test/moderation-retry.test.ts) and, for a case a decision closed under an intake, with one (moderation-races.test.ts).
 */
describe.skipIf(!process.env.INTEGRATION)("integration: taking in a report, a notice or a finding", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 6 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(apiDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  const profile = (db: Db | DbTx) => newProfile(db as Db);
  /** The snapshots of these cases as stored, each with the digest recomputed from its own columns. */
  async function snapshots(tx: DbTx, caseIds: readonly string[]) {
    const iso = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
    const rows = await tx.execute<Record<string, unknown> & { case_id: string; digest: string }>(sql`
      select s.case_id, s.target_type, s.target_id, ${iso("s.taken_at")} as taken, s.author_handle, s.post_state, ${iso("s.post_created_at")} as created, s.reply_to_id, s.quote_of_id, s.body, s.media,
             s.display_name, s.bio, s.handle, s.salt, s.digest
        from evidence_snapshots s where s.case_id = any(${uuids(caseIds)}) order by s.taken_at, s.id`);
    return Promise.all(
      rows.map(async (row) => {
        const input = {
          salt: row.salt,
          targetType: row.target_type,
          targetId: row.target_id,
          takenAt: row.taken,
          authorHandle: row.author_handle,
          postState: row.post_state,
          postCreatedAt: row.created,
          replyToId: row.reply_to_id,
          quoteOfId: row.quote_of_id,
          body: row.body,
          media: row.media,
          displayName: row.display_name,
          bio: row.bio,
          handle: row.handle,
        } as SnapshotDigestInput;
        return { caseId: row.case_id, ...input, digest: row.digest, recomputed: await snapshotDigest(input) };
      }),
    );
  }

  describe("recordIntake", () => {
    test("one intake stores its row, one item for each target in that target's open case, and the first copy of each target under a digest that recomputes", async () => {
      await rolledBack(apiDb, async (tx) => {
        const [ada, bob, reporter] = [await profile(tx), await profile(tx), await profile(tx)];
        const [adas, bobs] = [await newPostRow(tx, ada.id, { body: "what ada wrote" }), await newPostRow(tx, bob.id, { body: "what bob wrote" })];
        const recorded = await intake(tx, ground.rule(reporter.id, "R4"), [aPost(bobs, 1), anAccount(ada.id, ada.handle.toUpperCase(), 2), aPost(adas, 3)]);
        expect(recorded).toMatchObject({ token: null, suspect: false });
        expect(recorded.ref).toMatch(/^N-[A-Z2-7]{10}$/);
        expect(recorded.items.map((item) => [item.position, item.targetType, item.targetId, item.seq, item.lane])).toEqual([
          [1, "post", bobs, 1, 1],
          [2, "account", ada.id, 1, 1],
          [3, "post", adas, 1, 1],
        ]);
        const caseIds = recorded.items.map((item) => item.caseId!);
        expect(new Set(caseIds).size).toBe(3);

        const [stored] = await tx.execute<Record<string, unknown>>(sql`select kind, channel, reporter_id, rule_id, alleges_illegal, csam, lookup_hash, ref from intakes where id = ${recorded.intakeId}::uuid`);
        expect({ ...stored! }).toEqual({ kind: "user", channel: "signed_in", reporter_id: reporter.id, rule_id: "R4", alleges_illegal: false, csam: false, lookup_hash: null, ref: recorded.ref });
        const items = await tx.execute<Record<string, unknown>>(sql`
          select i.position, i.named_handle, i.reporter_account_id, i.suspect, i.outcome, c.target_id, c.intake_seq, c.closed_at, c.lane
            from intake_items i join cases c on c.id = i.case_id where i.intake_id = ${recorded.intakeId}::uuid order by i.position`);
        expect(items.map((row) => ({ ...row }))).toEqual([
          { position: 1, named_handle: null, reporter_account_id: reporter.id, suspect: false, outcome: null, target_id: bobs, intake_seq: 1, closed_at: null, lane: 1 },
          // The handle is kept as it was named, in lower case.
          { position: 2, named_handle: ada.handle, reporter_account_id: reporter.id, suspect: false, outcome: null, target_id: ada.id, intake_seq: 1, closed_at: null, lane: 1 },
          { position: 3, named_handle: null, reporter_account_id: reporter.id, suspect: false, outcome: null, target_id: adas, intake_seq: 1, closed_at: null, lane: 1 },
        ]);

        const copies = await snapshots(tx, caseIds);
        expect(copies).toHaveLength(3);
        for (const copy of copies) expect(copy.recomputed, copy.targetId).toBe(copy.digest);
        const of = (caseId: string) => copies.find((copy) => copy.caseId === caseId)!;
        expect(of(caseIds[0]!)).toMatchObject({ targetType: "post", targetId: bobs, authorHandle: bob.handle, postState: "visible", body: "what bob wrote", media: [], displayName: null, bio: null, handle: null });
        expect(of(caseIds[1]!)).toMatchObject({ targetType: "account", targetId: ada.id, authorHandle: ada.handle, postState: null, postCreatedAt: null, body: null, media: null, displayName: `Profile ${ada.handle}`, bio: "", handle: ada.handle });
        expect(of(caseIds[2]!)).toMatchObject({ targetType: "post", targetId: adas, authorHandle: ada.handle, body: "what ada wrote" });
      });
    });

    test("a later intake joins the target's open case; a post is copied once, an account again only when its fields changed; the same sender on the same ground is already_reported", async () => {
      await rolledBack(apiDb, async (tx) => {
        const [ada, first, second] = [await profile(tx), await profile(tx), await profile(tx)];
        const postId = await newPostRow(tx, ada.id);
        const targets = [aPost(postId, 1), anAccount(ada.id, ada.handle, 2)];
        const one = await intake(tx, ground.rule(first.id), targets);
        const two = await intake(tx, ground.rule(second.id), targets);
        expect(two.items.map((item) => [item.caseId, item.seq])).toEqual(one.items.map((item) => [item.caseId, 2]));
        const caseIds = one.items.map((item) => item.caseId!);
        expect(await snapshots(tx, caseIds)).toHaveLength(2);

        // The account changed its bio: the next report about it copies it again; the post's copy stays the one.
        await tx.execute(sql`update profiles set bio = 'a new bio' where id = ${ada.id}::uuid`);
        await intake(tx, ground.rule((await profile(tx)).id), targets);
        const copies = await snapshots(tx, caseIds);
        expect(copies.map((copy) => [copy.targetType, copy.bio])).toEqual([["post", null], ["account", ""], ["account", "a new bio"]]);
        for (const copy of copies) expect(copy.recomputed).toBe(copy.digest);

        // One item for each sender, case and ground: the refusal stores nothing, also not for the other target.
        expect(await refusal(intake(tx, ground.rule(first.id), targets))).toBe("already_reported");
        expect(await refusal(intake(tx, ground.rule(first.id), [aPost(await newPostRow(tx, ada.id), 1), anAccount(ada.id, ada.handle, 2)]))).toBe("already_reported");
        const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from intakes where reporter_id = ${first.id}::uuid`);
        expect(count!.n).toBe(1);
        // On another ground the same sender is heard again.
        expect(await refusal(intake(tx, ground.illegal(first.id), targets))).toBeNull();
      });
    });

    test("a notice sent signed out, or on the path for child sexual abuse material, gets a token that is stored only as its hash", async () => {
      await rolledBack(apiDb, async (tx) => {
        const postId = await newPostRow(tx, (await profile(tx)).id);
        for (const sent of [ground.illegal(null), ground.csam()]) {
          const recorded = await intake(tx, sent, aPost(postId));
          expect(recorded.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
          expect(recorded.suspect).toBe(sent.csam);
          expect(recorded.items[0]!.lane).toBe(laneFor(sent));
          const [stored] = await tx.execute<{ lookup_hash: string; reporter_id: string | null; channel: string }>(sql`select lookup_hash, reporter_id, channel from intakes where id = ${recorded.intakeId}::uuid`);
          expect({ ...stored! }).toEqual({ lookup_hash: createHash("sha256").update(recorded.token!).digest("hex"), reporter_id: null, channel: "signed_out" });
        }
        // Signed-out notices are never merged: each is an item of its own in the case.
        const [items] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from intake_items where target_id = ${postId}::uuid`);
        expect(items!.n).toBe(2);
      });
    });

    test("a suspect report about a post that quotes another adds an item for the quoted post, once, at the lowest position that quotes it plus 10, and one level deep", async () => {
      await rolledBack(apiDb, async (tx) => {
        const author = await profile(tx);
        const post = (options: { quoteOfId?: string } = {}) => newPostRow(tx, author.id, options);
        const deepest = await post();
        const quoted = await post({ quoteOfId: deepest });
        const [alone, quotingOne, quotingTwo] = [await post(), await post({ quoteOfId: quoted }), await post({ quoteOfId: quoted })];
        // A post that the notice names itself and that another named post quotes gets no second item.
        const named = await post();
        const quotingNamed = await post({ quoteOfId: named });
        const targets = [aPost(alone, 1), aPost(quotingTwo, 5), aPost(quotingOne, 2), aPost(named, 3), aPost(quotingNamed, 4)];

        const recorded = await intake(tx, ground.csam(), targets);
        expect(recorded.suspect).toBe(true);
        expect(recorded.items.map((item) => [item.position, item.targetId])).toEqual([[1, alone], [2, quotingOne], [3, named], [4, quotingNamed], [5, quotingTwo], [12, quoted]]);
        // The rule the database holds at commit passes, and nothing was added for the post the quoted post quotes.
        expect(await pgError(tx.execute(sql`set constraints public.intake_items_quote immediate`))).toBeNull();
        await tx.execute(sql`set constraints public.intake_items_quote deferred`);
        const [deep] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from intake_items where target_id = ${deepest}::uuid`);
        expect(deep!.n).toBe(0);
        // Every case holds its copy, the added item's too.
        expect(await snapshots(tx, recorded.items.map((item) => item.caseId!))).toHaveLength(6);

        // A finding citing R2 is suspect too; a report under any other rule adds nothing.
        const finder = await profile(tx);
        expect((await intake(tx, ground.finding(finder.id, "R2"), aPost(quotingOne))).items.map((item) => item.position)).toEqual([1, 11]);
        expect((await intake(tx, ground.rule((await profile(tx)).id, "R5"), aPost(quotingOne))).items.map((item) => item.position)).toEqual([1]);
      });
    });

    test("a target with nothing live is stored without a case, answered at once as not available; an account's link that names nothing gets an id that names nothing", async () => {
      await rolledBack(apiDb, async (tx) => {
        const [author, reporter] = [await profile(tx), await profile(tx)];
        const live = await newPostRow(tx, author.id);
        const gone = randomUUID();
        const recorded = await recordIntake(moderationDeps(tx), {
          ground: ground.rule(reporter.id),
          live: [aPost(live, 2)],
          dead: [{ type: "post", id: gone, position: 1 }, { type: "account", position: 3, namedHandle: "Nobody_Here" }],
        });
        expect(recorded.items.map((item) => [item.position, item.targetType, item.caseId === null, item.seq])).toEqual([[1, "post", true, null], [2, "post", false, 1], [3, "account", true, null]]);
        const rows = await tx.execute<Record<string, unknown>>(sql`select position, target_id, named_handle, outcome, case_id is null as no_case from intake_items where intake_id = ${recorded.intakeId}::uuid order by position`);
        expect(rows.map((row) => ({ ...row }))).toEqual([
          { position: 1, target_id: gone, named_handle: null, outcome: "not_available", no_case: true },
          { position: 2, target_id: live, named_handle: null, outcome: null, no_case: false },
          { position: 3, target_id: recorded.items[2]!.targetId, named_handle: "nobody_here", outcome: "not_available", no_case: true },
        ]);
        const [profiles] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from profiles where id = ${recorded.items[2]!.targetId}::uuid`);
        expect(profiles!.n).toBe(0);
      });
    });

    test("a sender whose account is deleted or does not exist is refused, and nothing is stored", async () => {
      await rolledBack(apiDb, async (tx) => {
        const postId = await newPostRow(tx, (await profile(tx)).id);
        const deleted = await profile(tx);
        await tx.execute(sql`update profiles set deleted_at = now() where id = ${deleted.id}::uuid`);
        const counts = await rowCounts(tx);
        expect(await refusal(intake(tx, ground.rule(deleted.id), aPost(postId)))).toBe("not_found");
        expect(await refusal(intake(tx, ground.rule(randomUUID()), aPost(postId)))).toBe("not_found");
        expect(await rowCounts(tx)).toEqual(counts);
      });
    });

    test("what is copied of a post its author deleted and of one whose content was erased: no text", async () => {
      // As the migrator: only its erasure, which a later migration brings, writes the erasure time.
      await rolledBack(migrateDb, async (tx) => {
        const author = await profile(tx);
        const [deleted, erased] = [await newPostRow(tx, author.id, { body: "deleted text" }), await newPostRow(tx, author.id, { body: "erased text" })];
        await tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted}::uuid`);
        // The body is left in place here, to show that the copy leaves it out by the erasure time alone.
        await tx.execute(sql`update posts set erased_at = now() where id = ${erased}::uuid`);
        const recorded = await intake(tx, ground.csam(), [aPost(deleted, 1), aPost(erased, 2)]);
        const copies = await snapshots(tx, recorded.items.map((item) => item.caseId!));
        expect(copies.map((copy) => [copy.targetId, copy.postState, copy.body]).sort()).toEqual([[deleted, "deleted_by_author", ""], [erased, "visible", ""]].sort());
        for (const copy of copies) expect(copy.recomputed).toBe(copy.digest);
      });
    });
  });

  describe("what the social module hands over", () => {
    test("findAccountByHandle: a live holder by its handle in any case; with withDeleted also a deleted profile and the account of a handle it has left", async () => {
      await rolledBack(apiDb, async (tx) => {
        const social = socialForModeration(tx as unknown as Db);
        const [live, deleted, moved] = [await profile(tx), await profile(tx), await profile(tx)];
        await tx.execute(sql`update profiles set deleted_at = now() where id = ${deleted.id}::uuid`);
        const left = `old_${moved.handle}`;
        await tx.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${moved.id}::uuid, now())`);

        for (const withDeleted of [false, true]) expect(await social.findAccountByHandle(live.handle.toUpperCase(), withDeleted)).toEqual({ id: live.id, deleted: false });
        expect(await social.findAccountByHandle(deleted.handle, false)).toBeNull();
        expect(await social.findAccountByHandle(deleted.handle, true)).toEqual({ id: deleted.id, deleted: true });
        expect(await social.findAccountByHandle(left, false)).toBeNull();
        expect(await social.findAccountByHandle(left.toUpperCase(), true)).toEqual({ id: moved.id, deleted: false });
        for (const withDeleted of [false, true]) expect(await social.findAccountByHandle("nobody_holds_this", withDeleted)).toBeNull();
      });
    });

    test("lockAccounts answers each row with whether it is deleted, and with `live` refuses a missing or deleted one; postAuthor and postRef read a post", async () => {
      await rolledBack(apiDb, async (tx) => {
        const social = socialForModeration(tx as unknown as Db);
        const [live, deleted] = [await profile(tx), await profile(tx)];
        await tx.execute(sql`update profiles set deleted_at = now() where id = ${deleted.id}::uuid`);
        const byId = (rows: { id: string; deleted: boolean }[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
        // 3e: each row also says whether the account is suspended and restricted in its reports, read in the same statement.
        const none = { suspended: false, reportsRestricted: false };
        expect(byId(await social.lockAccounts(tx, [live.id, deleted.id, live.id, randomUUID()], "no key update"))).toEqual(byId([{ id: live.id, deleted: false, ...none }, { id: deleted.id, deleted: true, ...none }]));
        expect(await social.lockAccounts(tx, [], "key share", true)).toEqual([]);
        expect(await social.lockAccounts(tx, [live.id], "key share", true)).toEqual([{ id: live.id, deleted: false, ...none }]);
        expect(await refusal(tx.transaction((sp) => social.lockAccounts(sp, [live.id, deleted.id], "key share", true)))).toBe("not_found");
        expect(await refusal(tx.transaction((sp) => social.lockAccounts(sp, [randomUUID()], "key share", true)))).toBe("not_found");

        const quoted = await newPostRow(tx, deleted.id);
        const postId = await newPostRow(tx, live.id, { quoteOfId: quoted });
        expect(await social.postAuthor(postId)).toBe(live.id);
        expect(await social.postAuthor(randomUUID())).toBeNull();
        expect(await social.postRef(postId)).toEqual({ authorId: live.id, state: "visible", quoteOfId: quoted });
        expect(await social.postRef(randomUUID())).toBeNull();
        expect(await social.capturePost(tx, randomUUID())).toBeNull();
        expect(await social.captureProfile(tx, randomUUID())).toBeNull();
      });
    });

    test("deletePost takes its author's profile row before the post: it waits for a transaction that holds that row, and holds no post meanwhile", async () => {
      const author = await profile(apiDb);
      try {
        const postId = await newPostRow(apiDb, author.id);
        const [held, release] = [gate(), gate()];
        // A decision about the author holds the profile row in this mode before it takes any post.
        const holder = withLockTimeout(apiDb, async (tx) => {
          await tx.execute(sql`select 1 from profiles where id = ${author.id}::uuid for no key update`);
          held.open();
          await release.opened;
        });
        await held.opened;
        const deleting = createSocialRepo(apiDb).deletePost(postId, author.id, new Date());
        try {
          // The holder is idle; the session that waits for a lock on this statement is the deletion's.
          await untilBlocked(apiDb, "from profiles where id");
          // The deletion has not touched the post: its row can be locked without waiting.
          expect(await pgError(withLockTimeout(apiDb, (tx) => tx.execute(sql`select id from posts where id = ${postId}::uuid for update nowait`)))).toBeNull();
          const [row] = await apiDb.execute<{ state: string }>(sql`select state from posts where id = ${postId}::uuid`);
          expect(row!.state).toBe("visible");
        } finally {
          release.open();
          await holder;
        }
        expect(await deleting).toBe(true);
        const [row] = await apiDb.execute<{ state: string; body: string }>(sql`select state, body from posts where id = ${postId}::uuid`);
        expect({ ...row! }).toEqual({ state: "deleted_by_author", body: "" });
      } finally {
        await removeFixtures(migrateDb, [author.id]);
      }
    });
  });

  test("3e: while its suspension runs, a signed-in reporter's report under a rule is refused account_suspended, from the row the intake locks; its notice of illegality and its report of child sexual abuse material are taken", async () => {
    const [reporter, target] = [await profile(apiDb), await profile(apiDb)];
    try {
      await suspendRowForTest(migrateDb, reporter.id);
      await rolledBack(apiDb, async (tx) => {
        const postId = await newPostRow(tx, target.id);
        const deps = moderationDeps(tx);
        expect(await refusal(recordIntake(deps, { ground: ground.rule(reporter.id, "R1"), live: [aPost(postId)] }))).toBe("account_suspended");
        const illegal = await recordIntake(deps, { ground: ground.illegal(reporter.id), live: [aPost(postId)] });
        expect(illegal.items).toHaveLength(1);
        // The refused report left nothing behind: only the notice of illegality names the reporter.
        const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from intakes where reporter_id = ${reporter.id}::uuid`);
        expect(count!.n).toBe(1);
      });
      // A suspension that ended refuses nothing.
      await suspendRowForTest(migrateDb, reporter.id, { from: "-2 hours", until: "-1 hour" });
      await rolledBack(apiDb, async (tx) => {
        const postId = await newPostRow(tx, target.id);
        expect((await recordIntake(moderationDeps(tx), { ground: ground.rule(reporter.id, "R1"), live: [aPost(postId)] })).items).toHaveLength(1);
      });
    } finally {
      await removeFixtures(migrateDb, [reporter.id, target.id]);
    }
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
