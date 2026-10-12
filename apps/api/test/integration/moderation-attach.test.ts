import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { textDigest } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import {
  MINORS,
  SPEECH,
  answerItem,
  csamNotice,
  fabricateDecision,
  findingBy,
  gate,
  hex64,
  illegalNotice,
  insertIntake,
  insertItem,
  newMarker,
  newPostRow,
  openCase,
  readCase,
  removeFixtures,
  rowCounts,
  ruleReport,
  untilBlocked,
  type ItemRow,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack, withLockTimeout } from "./staff-fixtures";

// Most tests here issue dozens of statements, each a round trip, and several hold a transaction open across them: on a
// loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The triggers of intake_items (3c design, section 6.1) against the real database, with the statements the intake
 * transaction will issue written here as SQL: intake_items_attach, which numbers an item into its open case and forces
 * what the API must not choose, with its checks of a re-examination; and intake_items_quote, which holds at commit that a
 * suspect item about a post that quotes another is a report about both. Statements run as korbat_api unless a test says
 * otherwise. Nothing in 0015 can answer an item or close a case, so the tests that need either write those rows as the
 * migrator. A test with one session runs inside a transaction that is rolled back; a test with two sessions has to
 * commit, and removes what it committed in a `finally`. The file's last test holds it to leaving nothing behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: intake items, their cases and their re-examinations", () => {
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

  /** A profile, written by whichever role runs the test. */
  const profile = (db: Db | DbTx) => newProfile(db as Db);
  /** An author and a post of theirs. */
  async function authored(db: Db | DbTx, options: { quoteOfId?: string } = {}) {
    const author = await profile(db);
    return { author, postId: await newPostRow(db, author.id, options) };
  }
  /** The error of one step inside a transaction, which stays usable: the step runs in a savepoint. */
  const within = (tx: DbTx, fn: (sp: DbTx) => Promise<unknown>) => pgError(tx.transaction(fn));
  /**
   * The quote rule as it runs at commit, made to run now: the step's items are inserted with the check deferred, then the
   * check is made immediate, all in a savepoint, so the transaction goes on after a refusal.
   */
  const atCommit = (tx: DbTx, make: (sp: DbTx) => Promise<void>) =>
    within(tx, async (sp) => {
      await sp.execute(sql`set constraints public.intake_items_quote deferred`);
      await make(sp);
      await sp.execute(sql`set constraints public.intake_items_quote immediate`);
    });

  describe("numbering and the case's derived columns", () => {
    test("the first item is number 1 and gives the case its lane and its oldest time; later items number on, and the lane only gets more severe", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const reporters = [await profile(tx), await profile(tx), await profile(tx)];
        const caseId = await openCase(tx, "post", postId);
        expect(await readCase(tx, caseId)).toMatchObject({ lane: 2, intake_seq: 0, answered_seq: 0, oldest_open_at: null, closed_at: null });

        const first = await insertItem(tx, { intakeId: await ruleReport(tx, reporters[0]!.id), caseId, targetId: postId, lane: 2 });
        expect(first).toMatchObject({ seq: 1, case_id: caseId, outcome: null });
        const opened = await readCase(tx, caseId);
        expect(opened).toMatchObject({ lane: 2, intake_seq: 1, answered_seq: 0 });
        expect(opened.oldest_open_at).toEqual(first.created_at);

        const second = await insertItem(tx, { intakeId: await ruleReport(tx, reporters[1]!.id, "R3"), caseId, targetId: postId, lane: 1 });
        const third = await insertItem(tx, { intakeId: await ruleReport(tx, reporters[2]!.id), caseId, targetId: postId, lane: 2 });
        expect([second.seq, third.seq]).toEqual([2, 3]);
        // The most severe lane of the unanswered items, and the time of the oldest of them.
        expect(await readCase(tx, caseId)).toMatchObject({ lane: 1, intake_seq: 3, oldest_open_at: opened.oldest_open_at });
      });
    });

    test("when no item is left unanswered, the next item's lane is the case's lane, also when it is less severe", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const { postId } = await authored(tx);
        const caseId = await openCase(tx, "post", postId);
        await insertItem(tx, { intakeId: await csamNotice(tx), caseId, targetId: postId, lane: 0 });
        expect(await readCase(tx, caseId)).toMatchObject({ lane: 0, intake_seq: 1 });
        // As a final decision leaves a case it does not close: everything so far answered.
        await tx.execute(sql`update cases set answered_seq = intake_seq, oldest_open_at = null where id = ${caseId}::uuid`);
        await insertItem(tx, { intakeId: await ruleReport(tx, (await profile(tx)).id), caseId, targetId: postId, lane: 2 });
        const after = await readCase(tx, caseId);
        expect(after).toMatchObject({ lane: 2, intake_seq: 2, answered_seq: 1 });
        expect(after.oldest_open_at).not.toBeNull();
      });
    });
  });

  describe("the forced columns", () => {
    test("an item's times, answer, release, reporter, ground and mail state are the database's, whatever the insert supplies", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const reporter = await profile(tx);
        const caseId = await openCase(tx, "post", postId);
        const supplied: Record<string, SQL> = {
          seq: sql`99`,
          created_at: sql`'2001-01-01T00:00:00Z'`,
          answered_by: sql`${randomUUID()}::uuid`,
          outcome_sent_at: sql`now()`,
          shown_outcome: sql`'no_violation'`,
          revision_pending_at: sql`now()`,
          revised_sent_at: sql`now()`,
          erased_at: sql`now()`,
          reporter_account_id: sql`${randomUUID()}::uuid`,
          alleges_illegal: sql`true`,
          suspect: sql`true`,
          outcome_mail: sql`'sent'`,
        };
        const item = await insertItem(tx, { intakeId: await ruleReport(tx, reporter.id), caseId, targetId: postId, outcome: "no_violation", namedHandle: "not_for_a_post", extra: supplied });
        expect(item).toMatchObject({
          seq: 1,
          answered_by: null,
          outcome: null,
          outcome_sent_at: null,
          shown_outcome: null,
          revision_pending_at: null,
          revised_sent_at: null,
          erased_at: null,
          reporter_account_id: reporter.id,
          alleges_illegal: false,
          suspect: false,
          outcome_mail: "none",
          named_handle: null,
        });
        const [age] = await tx.execute<{ at_start: boolean }>(sql`select (created_at = now()) as at_start from intake_items where id = ${item.id}::uuid`);
        expect(age!.at_start).toBe(true);
      });
    });

    test("suspect is forced from the intake: the CSAM path and a finding citing R2, and nothing else; never null", async () => {
      await rolledBack(apiDb, async (tx) => {
        const staff = await profile(tx);
        const reporter = await profile(tx);
        const cases: [string, () => Promise<string>, boolean, SQL][] = [
          ["a notice on the CSAM path", () => csamNotice(tx), true, sql`false`],
          ["a finding citing R2", () => findingBy(tx, staff.id, "R2", MINORS), true, sql`false`],
          ["a finding citing R5", () => findingBy(tx, staff.id, "R5"), false, sql`true`],
          ["a rule report", () => ruleReport(tx, reporter.id, "R1"), false, sql`true`],
          // A notice on the law alone has no rule: the comparison with R2 is then null, and suspect must still be false.
          ["a notice of illegality without a rule", () => illegalNotice(tx, reporter.id), false, sql`true`],
        ];
        for (const [label, intake, suspect, supplied] of cases) {
          const { postId } = await authored(tx);
          const item = await insertItem(tx, { intakeId: await intake(), caseId: await openCase(tx, "post", postId), targetId: postId, lane: 0, extra: { suspect: supplied } });
          expect(item.suspect, label).toBe(suspect);
        }
      });
    });

    test("alleges_illegal and the outcome's mail state are copied from the intake: pending for a contact, or for a reporter who alleged illegality", async () => {
      await rolledBack(apiDb, async (tx) => {
        const reporter = await profile(tx);
        const withContact = () => insertIntake(tx, { channel: "signed_out", contactId: randomUUID(), lookupHash: hex64(), allegesIllegal: true, category: SPEECH, explanation: "why", bonaFide: true });
        const cases: [string, () => Promise<string>, { alleges_illegal: boolean; outcome_mail: string; reporter_account_id: string | null }][] = [
          ["a rule report", () => ruleReport(tx, reporter.id), { alleges_illegal: false, outcome_mail: "none", reporter_account_id: reporter.id }],
          ["a signed-in notice of illegality", () => illegalNotice(tx, reporter.id), { alleges_illegal: true, outcome_mail: "pending", reporter_account_id: reporter.id }],
          ["a signed-out notice with a contact", withContact, { alleges_illegal: true, outcome_mail: "pending", reporter_account_id: null }],
          ["a notice on the CSAM path, which has nobody to mail", () => csamNotice(tx), { alleges_illegal: true, outcome_mail: "none", reporter_account_id: null }],
        ];
        for (const [label, intake, expected] of cases) {
          const { postId } = await authored(tx);
          const item = await insertItem(tx, { intakeId: await intake(), caseId: await openCase(tx, "post", postId), targetId: postId });
          expect(item, label).toMatchObject(expected);
        }
      });
    });

    test("an account item keeps the handle it was named by; a post item never has one; an account item without one is refused", async () => {
      await rolledBack(apiDb, async (tx) => {
        const account = await profile(tx);
        const reporter = await profile(tx);
        const caseId = await openCase(tx, "account", account.id);
        const kept = await insertItem(tx, { intakeId: await ruleReport(tx, reporter.id), caseId, targetType: "account", targetId: account.id, namedHandle: "an_old_handle" });
        expect(kept.named_handle).toBe("an_old_handle");
        const intakeId = await illegalNotice(tx, reporter.id);
        const err = await within(tx, (sp) => insertItem(sp, { intakeId, caseId, targetType: "account", targetId: account.id, namedHandle: null }));
        expect(err).toMatchObject({ code: "23514", message: expect.stringMatching(/intake_items_named_handle/) });
      });
    });

    test("an item of an intake that does not exist is refused as a missing reference", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const caseId = await openCase(tx, "post", postId);
        const err = await within(tx, (sp) => insertItem(sp, { intakeId: randomUUID(), caseId, targetId: postId }));
        expect(err?.code).toBe("23503");
      });
    });
  });

  describe("an item without a case", () => {
    test("is stored only as 'not available', with no number", async () => {
      await rolledBack(apiDb, async (tx) => {
        const reporter = await profile(tx);
        const intakeId = await ruleReport(tx, reporter.id);
        const dead = await insertItem(tx, { intakeId, caseId: null, targetId: randomUUID(), outcome: "not_available", extra: { seq: sql`5` } });
        expect(dead).toMatchObject({ case_id: null, seq: null, outcome: "not_available", answered_by: null });
        // Any other outcome, and no outcome, are refused: an item is in a case or answered at once.
        for (const [position, outcome] of [
          [2, null],
          [3, "no_violation"],
          [4, "restricted_rule"],
        ] as const) {
          const err = await within(tx, (sp) => insertItem(sp, { intakeId, caseId: null, targetId: randomUUID(), position, outcome }));
          expect(err, String(outcome)).toMatchObject({ code: "23514", message: expect.stringMatching(/intake_items_case/) });
        }
      });
    });

    test("the check itself refuses it too: with the trigger switched off, a row with no case and no outcome, or another outcome, is not stored", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const intakeId = await ruleReport(tx, (await profile(tx)).id);
        // Only the table's owner can do this, and the rollback switches the trigger on again.
        await tx.execute(sql`alter table public.intake_items disable trigger intake_items_attach`);
        const insert = (position: number, outcome: SQL) =>
          within(tx, (sp) =>
            sp.execute(sql`insert into intake_items (intake_id, target_type, target_id, position, lane, created_at, outcome) values (${intakeId}::uuid, 'post', ${randomUUID()}::uuid, ${position}, 2, now(), ${outcome})`),
          );
        // The check's own words: a null outcome is no longer a null expression, which a CHECK would let through.
        const refusedByCheck = expect.objectContaining({ code: "23514", message: expect.stringMatching(/violates check constraint "intake_items_case"/) });
        expect(await insert(1, sql`null`)).toEqual(refusedByCheck);
        expect(await insert(2, sql`'no_violation'`)).toEqual(refusedByCheck);
        expect(await insert(3, sql`'not_available'`)).toBeNull();
      });
    });

    test("an item in a case never arrives answered", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const item = await insertItem(tx, { intakeId: await ruleReport(tx, (await profile(tx)).id), caseId: await openCase(tx, "post", postId), targetId: postId, outcome: "not_available" });
        expect(item.outcome).toBeNull();
      });
    });
  });

  describe("one open case a target, under concurrency", () => {
    test("two first reports of one target merge into one case", async () => {
      const { author, postId } = await authored(apiDb);
      const reporters = [await profile(apiDb), await profile(apiDb)];
      const marker = newMarker();
      const hold = gate();
      const inserted = gate();
      // The first report has opened the case and waits before its item; the second one's case insert waits for it.
      const first = withLockTimeout(apiDb, async (tx) => {
        const intakeId = await ruleReport(tx, reporters[0]!.id);
        const caseId = await openCase(tx, "post", postId);
        inserted.open();
        await hold.opened;
        return insertItem(tx, { intakeId, caseId, targetId: postId });
      });
      let second: Promise<unknown> = Promise.resolve();
      try {
        await Promise.race([inserted.opened, first]);
        const racing = withLockTimeout(apiDb, async (tx) => {
          const intakeId = await ruleReport(tx, reporters[1]!.id);
          await tx.execute(sql`insert ${sql.raw(`/* ${marker} */`)} into cases (target_type, target_id) values ('post', ${postId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
          // A statement of its own: it sees the case the first report committed while the insert waited.
          const caseId = await openCase(tx, "post", postId);
          return insertItem(tx, { intakeId, caseId, targetId: postId });
        });
        second = racing;
        await untilBlocked(apiDb, marker);
        hold.open();
        const items = await Promise.all([first, racing]);
        expect(items[0].case_id).toBe(items[1].case_id);
        expect(items.map((item) => item.seq)).toEqual([1, 2]);
        const cases = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from cases where target_type = 'post' and target_id = ${postId}::uuid`);
        expect(cases[0]!.n).toBe(1);
      } finally {
        // Both transactions end before the rows go, whatever failed above.
        hold.open();
        await Promise.allSettled([first, second]);
        await removeFixtures(migrateDb, [author.id, ...reporters.map((reporter) => reporter.id)]);
      }
    }, 60_000);

    test("an item that names a case of another target is refused as a serialization failure, the code its transaction retries on", async () => {
      await rolledBack(apiDb, async (tx) => {
        const one = await authored(tx);
        const other = await authored(tx);
        const caseId = await openCase(tx, "post", one.postId);
        const intakeId = await ruleReport(tx, (await profile(tx)).id);
        const wrongPost = await within(tx, (sp) => insertItem(sp, { intakeId, caseId, targetId: other.postId }));
        expect(wrongPost).toEqual({ code: "40001", message: "case_closed" });
        const wrongKind = await within(tx, (sp) => insertItem(sp, { intakeId, caseId, targetType: "account", targetId: one.postId, namedHandle: "x" }));
        expect(wrongKind).toEqual({ code: "40001", message: "case_closed" });
        expect((await readCase(tx, caseId)).intake_seq).toBe(0);
      });
    });

    test("an item that names a closed case is refused the same way, and the retry opens a new case", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const { postId } = await authored(tx);
        const reporter = await profile(tx);
        const closed = await openCase(tx, "post", postId);
        // Read by the report, then closed by a decision before the report's item arrives.
        await tx.execute(sql`update cases set closed_at = now() where id = ${closed}::uuid`);
        const intakeId = await ruleReport(tx, reporter.id);
        expect(await within(tx, (sp) => insertItem(sp, { intakeId, caseId: closed, targetId: postId }))).toEqual({ code: "40001", message: "case_closed" });
        const reopened = await openCase(tx, "post", postId);
        expect(reopened).not.toBe(closed);
        expect(await insertItem(tx, { intakeId, caseId: reopened, targetId: postId })).toMatchObject({ case_id: reopened, seq: 1 });
        expect((await readCase(tx, closed)).intake_seq).toBe(0);
      });
    });

    test("an item waits for a transaction that holds its case, and attaches once it ends", async () => {
      const { author, postId } = await authored(apiDb);
      const reporter = await profile(apiDb);
      const marker = newMarker();
      const hold = gate();
      const held = gate();
      let holder: Promise<void> = Promise.resolve();
      let attaching: Promise<unknown> = Promise.resolve();
      try {
        const caseId = await openCase(apiDb, "post", postId);
        const intakeId = await ruleReport(apiDb, reporter.id);
        // What a decision holds while it decides: the case's row. Rolled back, so the case stays open.
        holder = rolledBack(migrateDb, async (tx) => {
          await tx.execute(sql`update cases set closed_at = now() where id = ${caseId}::uuid`);
          held.open();
          await hold.opened;
        });
        await Promise.race([held.opened, holder]);
        const waiting = withLockTimeout(apiDb, (tx) => insertItem(tx, { intakeId, caseId, targetId: postId, marker }));
        attaching = waiting;
        await untilBlocked(apiDb, marker);
        hold.open();
        await holder;
        expect(await waiting).toMatchObject({ case_id: caseId, seq: 1 });
      } finally {
        // Both transactions end before the rows go, whatever failed above.
        hold.open();
        await Promise.allSettled([holder, attaching]);
        await removeFixtures(migrateDb, [author.id, reporter.id]);
      }
    }, 60_000);

    test("notices that name the same two posts, each taking its cases in the targets' order, all land without a deadlock", async () => {
      const authors = [await authored(apiDb), await authored(apiDb)];
      const posts = authors.map((a) => a.postId).sort();
      try {
        const notice = () =>
          withLockTimeout(apiDb, async (tx) => {
            const intakeId = await insertIntake(tx, { channel: "signed_out", lookupHash: hex64(), ruleId: "R3" });
            // First every case, in (target_type, target_id) order; then the items.
            const caseIds = [await openCase(tx, "post", posts[0]!), await openCase(tx, "post", posts[1]!)];
            await insertItem(tx, { intakeId, caseId: caseIds[0]!, targetId: posts[0]!, position: 1, lane: 1 });
            await insertItem(tx, { intakeId, caseId: caseIds[1]!, targetId: posts[1]!, position: 2, lane: 1 });
          });
        // Settled, not raced: every notice has ended before anything is asserted or removed.
        const landed = await Promise.allSettled([notice(), notice(), notice(), notice()]);
        expect(landed.map((outcome) => (outcome.status === "rejected" ? String(outcome.reason) : outcome.status))).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
        for (const postId of posts) {
          const rows = await apiDb.execute<{ cases: number; items: number; top: number }>(
            sql`select count(distinct c.id)::int as cases, count(i.id)::int as items, max(i.seq)::int as top from cases c join intake_items i on i.case_id = c.id where c.target_type = 'post' and c.target_id = ${postId}::uuid`,
          );
          expect({ ...rows[0]! }).toEqual({ cases: 1, items: 4, top: 4 });
        }
      } finally {
        await removeFixtures(migrateDb, authors.map((a) => a.author.id));
      }
    }, 60_000);

    test("one item per signed-in reporter, case and ground; signed-out notifiers are never merged; a notice names a target once", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const [ada, bob] = [await profile(tx), await profile(tx)];
        const caseId = await openCase(tx, "post", postId);
        const report = (intakeId: string, position = 1) => within(tx, (sp) => insertItem(sp, { intakeId, caseId, targetId: postId, position }));

        expect(await report(await ruleReport(tx, ada.id))).toBeNull();
        // A second rule report by the same person on the same case, under another rule or not.
        expect(await report(await ruleReport(tx, ada.id, "R3"))).toMatchObject({ code: "23505", message: expect.stringMatching(/intake_items_reporter_once/) });
        // The same person's later notice that the post is illegal is another ground, and stands beside the report.
        expect(await report(await illegalNotice(tx, ada.id))).toBeNull();
        expect(await report(await illegalNotice(tx, ada.id))).toMatchObject({ code: "23505", message: expect.stringMatching(/intake_items_reporter_once/) });
        expect(await report(await ruleReport(tx, bob.id))).toBeNull();
        // Signed out there is no account to merge by: every notice keeps its own item.
        for (let i = 0; i < 2; i++) expect(await report(await insertIntake(tx, { channel: "signed_out", lookupHash: hex64(), ruleId: "R1" }))).toBeNull();

        const twice = await insertIntake(tx, { channel: "signed_out", lookupHash: hex64(), ruleId: "R1" });
        expect(await report(twice, 1)).toBeNull();
        expect(await report(twice, 2)).toMatchObject({ code: "23505", message: expect.stringMatching(/intake_items_target_once/) });
        expect((await readCase(tx, caseId)).intake_seq).toBe(6);
      });
    });
  });

  describe("re-examinations", () => {
    /**
     * Inside a migrator transaction: a signed-in report about a post (or, with a handle, an account), its open case and
     * its item, with a staff profile for the decisions the tests fabricate.
     */
    async function reported(tx: DbTx, options: { suspect?: boolean; handle?: string } = {}) {
      const staff = await profile(tx);
      const author = await profile(tx);
      const targetType = options.handle ? ("account" as const) : ("post" as const);
      const targetId = options.handle ? author.id : await newPostRow(tx, author.id);
      const intakeId = options.suspect ? await csamNotice(tx) : await ruleReport(tx, (await profile(tx)).id);
      const caseId = await openCase(tx, targetType, targetId);
      const item = await insertItem(tx, { intakeId, caseId, targetType, targetId, position: 3, lane: options.suspect ? 0 : 1, namedHandle: options.handle ?? null });
      return { staff, intakeId, caseId, targetType, targetId, item };
    }
    /** A re-examination of the item, supplying a wrong target, position and lane on purpose. */
    const reexamine = (tx: DbTx, r: { intakeId: string; caseId: string }, item: ItemRow, extra: Record<string, SQL> = {}) =>
      insertItem(tx, { intakeId: r.intakeId, caseId: r.caseId, targetType: "account", targetId: randomUUID(), position: 9, lane: 0, namedHandle: "supplied", reexaminesItemId: item.id, extra });

    test("a released no-action item is re-examined within its window, with the original's target, position, lane and handle whatever was supplied", async () => {
      await rolledBack(migrateDb, async (tx) => {
        for (const outcome of ["no_violation", "not_evident"] as const) {
          const r = await reported(tx);
          await answerItem(tx, r.item, r.staff.id, { outcome });
          const again = await reexamine(tx, r, r.item);
          expect(again, outcome).toMatchObject({ target_type: "post", target_id: r.targetId, position: 3, lane: 1, named_handle: null, reexamines_item_id: r.item.id, case_id: r.caseId, seq: 2, suspect: false, outcome: null });
        }
        const account = await reported(tx, { handle: "as_named" });
        await answerItem(tx, account.item, account.staff.id);
        expect(await reexamine(tx, account, account.item)).toMatchObject({ target_type: "account", target_id: account.targetId, named_handle: "as_named", position: 3, lane: 1 });
      });
    });

    test("it is refused for an unanswered item, a restricted one, an unreleased one, one past its window, an item of another intake and an erased intake", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const refused = async (label: string, prepare: (r: Awaited<ReturnType<typeof reported>>) => Promise<{ intakeId?: string } | void>) => {
          const r = await reported(tx);
          const other = await prepare(r);
          const err = await within(tx, (sp) => reexamine(sp, { intakeId: other?.intakeId ?? r.intakeId, caseId: r.caseId }, r.item));
          expect(err, label).toEqual({ code: "P0001", message: "reexamination_not_open" });
        };
        await refused("unanswered", async () => undefined);
        await refused("restricted", async (r) => void (await answerItem(tx, r.item, r.staff.id, { outcome: "restricted_rule" })));
        await refused("answered, not yet released", async (r) => void (await answerItem(tx, r.item, r.staff.id, { released: null })));
        await refused("released seven months ago", async (r) => void (await answerItem(tx, r.item, r.staff.id, { released: sql`now() - interval '7 months'` })));
        await refused("an item of another intake", async (r) => {
          await answerItem(tx, r.item, r.staff.id);
          return { intakeId: await ruleReport(tx, (await profile(tx)).id) };
        });
        await refused("an erased intake", async (r) => {
          await answerItem(tx, r.item, r.staff.id);
          await tx.execute(sql`update intakes set erased_at = now(), explanation = null, cited_law = null where id = ${r.intakeId}::uuid`);
        });
        // The window is the appeal's, six calendar months from the release: five months on it is still open.
        const r = await reported(tx);
        await answerItem(tx, r.item, r.staff.id, { released: sql`now() - interval '5 months'` });
        expect(await within(tx, (sp) => reexamine(sp, r, r.item))).toBeNull();
        // An item that does not exist cannot be re-examined either.
        const err = await within(tx, (sp) => insertItem(sp, { intakeId: r.intakeId, caseId: r.caseId, targetId: r.targetId, reexaminesItemId: randomUUID() }));
        expect(err).toEqual({ code: "P0001", message: "reexamination_not_open" });
      });
    });

    test("an item is re-examined once", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const r = await reported(tx);
        await answerItem(tx, r.item, r.staff.id);
        await reexamine(tx, r, r.item);
        const err = await within(tx, (sp) => reexamine(sp, r, r.item));
        expect(err).toMatchObject({ code: "23505", message: expect.stringMatching(/intake_items_reexamines_once/) });
      });
    });

    test("a re-examination is not re-examined, unless it is about a post, is not suspect and was answered while nobody could open the images", async () => {
      await rolledBack(migrateDb, async (tx) => {
        // Answered by a decision that saw the images: the one request is spent.
        const seen = await reported(tx);
        await answerItem(tx, seen.item, seen.staff.id);
        const seenAgain = await reexamine(tx, seen, seen.item);
        await answerItem(tx, seenAgain, seen.staff.id, { unseen: false });
        expect(await within(tx, (sp) => reexamine(sp, seen, seenAgain))).toEqual({ code: "P0001", message: "reexamination_not_open" });

        // Answered unseen: it can be asked again, and again while the answers stay unseen.
        const unseen = await reported(tx);
        await answerItem(tx, unseen.item, unseen.staff.id, { unseen: true });
        const second = await reexamine(tx, unseen, unseen.item);
        await answerItem(tx, second, unseen.staff.id, { unseen: true });
        const third = await reexamine(tx, unseen, second);
        expect(third).toMatchObject({ reexamines_item_id: second.id, target_id: unseen.targetId, position: 3, lane: 1, seq: 3 });
        await answerItem(tx, third, unseen.staff.id, { unseen: true, outcome: "not_evident" });
        expect(await within(tx, (sp) => reexamine(sp, unseen, third))).toBeNull();

        // A suspect item's answer is never "unseen" in this sense: its re-examination is final.
        const suspect = await reported(tx, { suspect: true });
        await answerItem(tx, suspect.item, suspect.staff.id, { unseen: true });
        const suspectAgain = await reexamine(tx, suspect, suspect.item);
        expect(suspectAgain).toMatchObject({ suspect: true, lane: 0 });
        await answerItem(tx, suspectAgain, suspect.staff.id, { unseen: true });
        expect(await within(tx, (sp) => reexamine(sp, suspect, suspectAgain))).toEqual({ code: "P0001", message: "reexamination_not_open" });

        // Nor an account's: its answer concerns the display name and bio, which staff read.
        const account = await reported(tx, { handle: "named" });
        await answerItem(tx, account.item, account.staff.id, { unseen: true });
        const accountAgain = await reexamine(tx, account, account.item);
        await answerItem(tx, accountAgain, account.staff.id, { unseen: true });
        expect(await within(tx, (sp) => reexamine(sp, account, accountAgain))).toEqual({ code: "P0001", message: "reexamination_not_open" });
      });
    });

    test("only a re-examination carries a statement, and only with its salt and the digest of both; the same holds for an appeal's statement", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const statement = "I think this was judged too quickly.";
        const salt = hex64();
        const digest = await textDigest(salt, statement);
        const stated = (held: string | null): Record<string, SQL> => ({ statement: sql`${statement}`, statement_salt: sql`${salt}`, statement_digest: held === null ? sql`null` : sql`${held}` });
        const refusedBy = (name: string) => expect.objectContaining({ code: "23514", message: expect.stringMatching(new RegExp(`violates check constraint "${name}"`)) });

        const r = await reported(tx);
        await answerItem(tx, r.item, r.staff.id);
        // A wrong digest, and no digest at all: a null comparison must not let the statement through.
        expect(await within(tx, (sp) => reexamine(sp, r, r.item, stated(hex64())))).toEqual(refusedBy("intake_items_statement"));
        expect(await within(tx, (sp) => reexamine(sp, r, r.item, stated(null)))).toEqual(refusedBy("intake_items_statement"));
        expect(await reexamine(tx, r, r.item, stated(digest))).toMatchObject({ statement });

        // An ordinary item has none, with a digest or without.
        const plain = await reported(tx);
        for (const held of [digest, null]) {
          const err = await within(tx, (sp) => insertItem(sp, { intakeId: plain.intakeId, caseId: plain.caseId, targetId: plain.targetId, position: 4, extra: stated(held) }));
          expect(err, String(held)).toEqual(refusedBy("intake_items_statement"));
        }

        // An appeal's statement is held the same way. Its row names a decision, which only the fixture can write here.
        const decisionId = await fabricateDecision(tx, { caseId: plain.caseId, targetType: "post", targetId: plain.targetId, staffId: plain.staff.id, outcome: "restricted" });
        const appeal = (held: string | null) =>
          within(tx, (sp) =>
            sp.execute(
              sql`insert into appeals (decision_id, appellant_account_id, statement, statement_salt, statement_digest, filed_at) values (${decisionId}::uuid, ${plain.staff.id}::uuid, ${statement}, ${salt}, ${held}, now())`,
            ),
          );
        expect(await appeal(null)).toEqual(refusedBy("appeals_statement"));
        expect(await appeal(hex64())).toEqual(refusedBy("appeals_statement"));
        expect(await appeal(digest)).toBeNull();
      });
    });
  });

  describe("a suspect item about a post that quotes another is a report about both", () => {
    /** A post, and a post by someone else that quotes it. */
    async function quoting(db: Db | DbTx) {
      const quoted = await authored(db);
      const quoter = await authored(db, { quoteOfId: quoted.postId });
      return { quotedId: quoted.postId, quotingId: quoter.postId };
    }

    test("alone it is refused at commit, and nothing of the transaction is stored", async () => {
      let made: { quotedId: string; quotingId: string } | undefined;
      // Everything in the one transaction, the two posts included: its commit runs the rule and fails.
      const err = await pgError(
        withLockTimeout(apiDb, async (tx) => {
          made = await quoting(tx);
          const item = await insertItem(tx, { intakeId: await csamNotice(tx), caseId: await openCase(tx, "post", made.quotingId), targetId: made.quotingId, lane: 0 });
          // The insert itself passes: the rule is held when the transaction commits.
          expect(item.suspect).toBe(true);
        }),
      );
      expect(err).toEqual({ code: "P0001", message: "quote_item_missing" });
      const [left] = await apiDb.execute<{ posts: number; cases: number }>(sql`
        select (select count(*)::int from posts where id in (${made!.quotedId}::uuid, ${made!.quotingId}::uuid)) as posts,
               (select count(*)::int from cases where target_id in (${made!.quotedId}::uuid, ${made!.quotingId}::uuid)) as cases`);
      expect({ ...left! }).toEqual({ posts: 0, cases: 0 });
    });

    test("with an item on the quoted post, added at the origin's position plus 10 or named by the sender, it passes", async () => {
      await rolledBack(apiDb, async (tx) => {
        const added = await quoting(tx);
        expect(
          await atCommit(tx, async (sp) => {
            const intakeId = await csamNotice(sp);
            // The cases in their targets' order, then the items.
            const caseOf: Record<string, string> = {};
            for (const id of [added.quotingId, added.quotedId].sort()) caseOf[id] = await openCase(sp, "post", id);
            await insertItem(sp, { intakeId, caseId: caseOf[added.quotingId]!, targetId: added.quotingId, position: 4, lane: 0 });
            await insertItem(sp, { intakeId, caseId: caseOf[added.quotedId]!, targetId: added.quotedId, position: 14, lane: 0 });
          }),
        ).toBeNull();

        const named = await quoting(tx);
        expect(
          await atCommit(tx, async (sp) => {
            const intakeId = await csamNotice(sp);
            await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", named.quotedId), targetId: named.quotedId, position: 1, lane: 0 });
            await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", named.quotingId), targetId: named.quotingId, position: 2, lane: 0 });
          }),
        ).toBeNull();
      });
    });

    test("an item that is not suspect, a post that quotes nothing and a link that names no row need no second item", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { quotingId } = await quoting(tx);
        const reporter = await profile(tx);
        expect(await atCommit(tx, async (sp) => void (await insertItem(sp, { intakeId: await ruleReport(sp, reporter.id), caseId: await openCase(sp, "post", quotingId), targetId: quotingId })))).toBeNull();
        const plain = await authored(tx);
        expect(await atCommit(tx, async (sp) => void (await insertItem(sp, { intakeId: await csamNotice(sp), caseId: await openCase(sp, "post", plain.postId), targetId: plain.postId, lane: 0 })))).toBeNull();
        // A link that names nothing live: no case, answered at once.
        expect(await atCommit(tx, async (sp) => void (await insertItem(sp, { intakeId: await csamNotice(sp), caseId: null, targetId: randomUUID(), outcome: "not_available", lane: 0 })))).toBeNull();
      });
    });

    test("an added item without its origin is refused", async () => {
      await rolledBack(apiDb, async (tx) => {
        const reporter = await profile(tx);
        const refused = { code: "P0001", message: "quote_item_missing" };
        // No item at its position minus 10.
        const alone = await quoting(tx);
        expect(await atCommit(tx, async (sp) => void (await insertItem(sp, { intakeId: await csamNotice(sp), caseId: await openCase(sp, "post", alone.quotedId), targetId: alone.quotedId, position: 11, lane: 0 })))).toEqual(refused);

        // An origin whose post quotes another post than the item's own.
        const one = await quoting(tx);
        const stranger = await authored(tx);
        const strayed = await atCommit(tx, async (sp) => {
          const intakeId = await csamNotice(sp);
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", one.quotingId), targetId: one.quotingId, position: 1, lane: 0 });
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", one.quotedId), targetId: one.quotedId, position: 2, lane: 0 });
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", stranger.postId), targetId: stranger.postId, position: 11, lane: 0 });
        });
        expect(strayed).toEqual(refused);

        // An origin that is not suspect brings no added item.
        const ordinary = await quoting(tx);
        const notSuspect = await atCommit(tx, async (sp) => {
          const intakeId = await ruleReport(sp, reporter.id);
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", ordinary.quotingId), targetId: ordinary.quotingId, position: 1 });
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", ordinary.quotedId), targetId: ordinary.quotedId, position: 11 });
        });
        expect(notSuspect).toEqual(refused);
      });
    });

    test("a re-examination of the origin re-examines its added item too while that is open to it, and alone otherwise", async () => {
      /** A notice about a quoting post as it stands once committed: its origin item, the added item, both in their cases. */
      async function notice(tx: DbTx) {
        // An earlier block may have left the check immediate; a notice's two items are checked together.
        await tx.execute(sql`set constraints public.intake_items_quote deferred`);
        const staff = await profile(tx);
        const { quotingId, quotedId } = await quoting(tx);
        const intakeId = await csamNotice(tx);
        const originCase = await openCase(tx, "post", quotingId);
        const addedCase = await openCase(tx, "post", quotedId);
        const origin = await insertItem(tx, { intakeId, caseId: originCase, targetId: quotingId, position: 2, lane: 0 });
        const added = await insertItem(tx, { intakeId, caseId: addedCase, targetId: quotedId, position: 12, lane: 0 });
        // The notice's own check passes here; from now on only the re-examinations' rows are pending.
        await tx.execute(sql`set constraints public.intake_items_quote immediate`);
        await answerItem(tx, origin, staff.id);
        return { staff, intakeId, originCase, addedCase, origin, added };
      }
      const again = (sp: DbTx, n: Awaited<ReturnType<typeof notice>>, item: ItemRow) =>
        insertItem(sp, { intakeId: n.intakeId, caseId: item.id === n.origin.id ? n.originCase : n.addedCase, targetId: item.target_id, lane: 0, reexaminesItemId: item.id });

      await rolledBack(migrateDb, async (tx) => {
        // The added item was answered without action and released too: both are re-examined, or neither.
        const open = await notice(tx);
        await answerItem(tx, open.added, open.staff.id);
        expect(await atCommit(tx, async (sp) => void (await again(sp, open, open.origin)))).toEqual({ code: "P0001", message: "quote_item_missing" });
        expect(
          await atCommit(tx, async (sp) => {
            await again(sp, open, open.origin);
            await again(sp, open, open.added);
          }),
        ).toBeNull();

        // The added item is still unanswered: the quoted post is frozen anyway, and the origin goes alone.
        const unanswered = await notice(tx);
        expect(await atCommit(tx, async (sp) => void (await again(sp, unanswered, unanswered.origin)))).toBeNull();

        // Answered with a restriction, not yet released, or past its window: not open to re-examination, so the origin goes alone.
        const restricted = await notice(tx);
        await answerItem(tx, restricted.added, restricted.staff.id, { outcome: "restricted_rule" });
        expect(await atCommit(tx, async (sp) => void (await again(sp, restricted, restricted.origin)))).toBeNull();
        const unreleased = await notice(tx);
        await answerItem(tx, unreleased.added, unreleased.staff.id, { released: null });
        expect(await atCommit(tx, async (sp) => void (await again(sp, unreleased, unreleased.origin)))).toBeNull();
        const late = await notice(tx);
        await answerItem(tx, late.added, late.staff.id, { released: sql`now() - interval '7 months'` });
        expect(await atCommit(tx, async (sp) => void (await again(sp, late, late.origin)))).toBeNull();

        // The added item can also be re-examined by itself: it has no added item of its own.
        const own = await notice(tx);
        await answerItem(tx, own.added, own.staff.id);
        expect(await atCommit(tx, async (sp) => void (await again(sp, own, own.added)))).toBeNull();
        // And once it has been, the origin's re-examination needs nothing more.
        expect(await atCommit(tx, async (sp) => void (await again(sp, own, own.origin)))).toBeNull();
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
