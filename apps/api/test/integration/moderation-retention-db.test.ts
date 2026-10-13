import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { RETENTION } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { createMediaRepo } from "../../src/media/repo";
import { authorDecisionView } from "../../src/moderation/author";
import { dueCases, dueRedactions, eraseCaseEvidence, redactR4 } from "../../src/moderation/repo";
import { decisionStatement } from "../../src/moderation/statement";
import { aPost, act, anAccount, appealOf, authCaseCounts, csamNotice, decideIn, ground, hex64, imagePost, imageStates, inForce, intake, moderationDeps, newTestStaff, openCase, postFrozen, postRow, refusal, report, reviewIn, rowCounts, saveText, staffProfile, type TestStaff } from "./moderation-fixtures";
import { ageCase, authAccount, evidenceDue, evidenceLeft, intakeDue, one, releaseItems } from "./retention-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

/**
 * The functions of migration 0018 (3c design, section 6.4), against the real database: when each kind of data is due,
 * that each erasure refuses what is not due, what each erases and what it keeps, and the two gates of the freeze that an
 * erasure meets. Every due rule compares stored times with the database's now(), so the tests run as the migrator, which
 * dates a case or an intake back (ageCase), inside a transaction that is rolled back. What the API role and the auth
 * role may and may not do is tested on their own pools. The file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the retention functions of migration 0018", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  /** A second admin, for a review of an admin's seal. */
  let admin2: TestStaff;
  let before: Record<string, number>;
  let beforeAuth: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    admin2 = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb);
    beforeAuth = await authCaseCounts(migrateDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the migrator that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>) =>
    rolledBack(migrateDb, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  /** A call inside a savepoint: what it was refused with (a code, or SQLSTATE and message), or null. A refusal leaves the test's transaction usable. */
  const refused = (tx: DbTx, query: SQL) => refusal(tx.transaction((sp) => sp.execute(query)));
  const count = async (tx: DbTx, query: SQL) => (await one<{ n: number | boolean }>(tx, query)).n;
  const finalAt = async (tx: DbTx, decisionId: string) => (await one<{ at: string | null }>(tx, sql`select public.decision_final_at(${decisionId}::uuid)::text as at`)).at;
  const authorDeletes = (tx: DbTx, postId: string) => tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
  /** A snapshot of the case's target straight in the table, as a second look at the case leaves one; a decision may name it. */
  const snapshotOn = (tx: DbTx, caseId: string, targetType: "post" | "account", targetId: string) =>
    one<{ id: string; digest: string }>(tx, sql`insert into evidence_snapshots (case_id, target_type, target_id, author_handle, body, salt, digest)
      values (${caseId}::uuid, ${targetType}::moderation_target, ${targetId}::uuid, 'author', 'a later copy', ${hex64()}, ${hex64()}) returning id, digest`);
  /** What a snapshot still holds. */
  const snapshots = (tx: DbTx, where: SQL) =>
    tx.execute<{ erased: boolean; body: string | null; salt: string | null; digest: string; handle: string }>(sql`select erased_at is not null as erased, body, salt, digest, author_handle as handle from evidence_snapshots where ${where} order by taken_at, id`);
  /** A post with images, reported under a rule, and its case closed by a removal under that rule: a final restriction. */
  async function removed(tx: DbTx, rule: "R1" | "R3" | "R4" = "R4", images = 1) {
    const p = await imagePost(tx, images);
    const { caseId, recorded } = await report(tx, aPost(p.postId), "rule", rule === "R3" ? "R3" : "R1");
    const decisionId = await decideIn(tx, mod, caseId, { kind: "final", ruleId: rule, actions: [act("remove")] });
    return { ...p, caseId, decisionId, intakeId: recorded.intakeId, itemId: recorded.items[0]!.id };
  }

  describe("the periods are the contracts'", () => {
    test("24 hours for a case's newest snapshot or draft, 30 days for a reset value and for an intake, 12 months for statements and the access log", () => {
      // The functions write these numbers as SQL intervals; the tests below move the clock just under and just over each.
      expect(RETENTION).toMatchObject({ evidenceHours: 24, draftHours: 24, resetValueDays: 30, intakeDays: 30, statementMonths: 12, accessLogMonths: 12 });
    });
  });

  describe("decision_final_at", () => {
    test("a decision that cannot be appealed is final when taken; a final restriction at the end of its window, never while an appeal is pending, and at the appeal's answer", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const { caseId } = await report(tx, aPost(p.postId));
        const interim = await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] });
        const removal = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove")] });
        const taken = async (id: string) => (await one<{ at: string }>(tx, sql`select decided_at::text as at from decisions where id = ${id}::uuid`)).at;
        expect(await finalAt(tx, interim)).toBe(await taken(interim));
        // No appeal yet: six calendar months after the author was told.
        expect(await finalAt(tx, removal)).toBe((await one<{ at: string }>(tx, sql`select public.appeal_deadline(informed_at)::text as at from decisions where id = ${removal}::uuid`)).at);
        const appeal = await appealOf(tx, removal, p.authorId, "I disagree.");
        expect(await finalAt(tx, removal)).toBeNull();
        const review = await reviewIn(tx, admin, removal);
        expect(await finalAt(tx, removal)).toBe((await one<{ at: string }>(tx, sql`select answered_at::text as at from appeals where id = ${appeal}::uuid`)).at);
        // The review itself, a decision without action and a correction are final at once.
        expect(await finalAt(tx, review)).toBe(await taken(review));
        const q = await imagePost(tx, 0);
        const other = await report(tx, aPost(q.postId));
        const cleared = await decideIn(tx, mod, other.caseId, { kind: "final", outcome: "no_violation" });
        expect(await finalAt(tx, cleared)).toBe(await taken(cleared));
        expect(await finalAt(tx, randomUUID())).toBeNull();
      });
    });
  });

  describe("case_evidence_due_at and erase_case_evidence", () => {
    test("an open case is never due; a closed case without action is due a day after its close and its newest snapshot, and a note or a draft taken on it waits a day more", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId));
        expect(await evidenceDue(tx, caseId)).toBe("never");
        expect(await refused(tx, sql`select public.erase_case_evidence(${caseId}::uuid)`)).toBe("not_due");
        await decideIn(tx, mod, caseId, { kind: "final", outcome: "no_violation" });
        expect(await evidenceDue(tx, caseId)).toBe("later");
        expect(await refused(tx, sql`select public.erase_case_evidence(${caseId}::uuid)`)).toBe("not_due");
        await ageCase(tx, caseId, "23 hours");
        expect(await evidenceDue(tx, caseId)).toBe("later");
        await ageCase(tx, caseId, "2 hours");
        expect(await evidenceDue(tx, caseId)).toBe("due");
        // A note written now, or a fresh snapshot, moves the day: nothing is erased under the person using it.
        await saveText(tx, caseId, mod.id, "note");
        expect(await evidenceDue(tx, caseId)).toBe("later");
        await tx.execute(sql`update staff_texts set created_at = now() - interval '25 hours' where case_id = ${caseId}::uuid and kind = 'note'`);
        expect(await evidenceDue(tx, caseId)).toBe("due");
        const fresh = await snapshotOn(tx, caseId, "post", p.postId);
        expect(await evidenceDue(tx, caseId)).toBe("later");
        expect(await refused(tx, sql`select public.erase_case_evidence(${caseId}::uuid)`)).toBe("not_due");
        await tx.execute(sql`update evidence_snapshots set taken_at = now() - interval '25 hours' where id = ${fresh.id}::uuid`);
        expect(await evidenceDue(tx, caseId)).toBe("due");
        // A case that does not exist is not due.
        expect(await refused(tx, sql`select public.erase_case_evidence(${randomUUID()}::uuid)`)).toBe("not_due");
      });
    });

    test("it erases the case's snapshots, notes and drafts and its appeals' statements, keeps every digest, handle and confirmed text, releases the holds, and changes nothing when run again", async () => {
      await inWorld(async (tx) => {
        const r = await removed(tx, "R1", 2);
        const appeal = await appealOf(tx, r.decisionId, r.authorId, "It broke no rule.");
        const review = await reviewIn(tx, admin, r.decisionId);
        await saveText(tx, r.caseId, mod.id, "note", "a note for the case");
        await saveText(tx, r.caseId, mod.id, "seal_declined", "not sealed, and why");
        const draft = await saveText(tx, r.caseId, mod.id, "facts", "a draft nobody confirmed");
        expect(await evidenceLeft(tx, r.caseId)).toEqual({ snapshots: 1, texts: 3, statements: 1, holds: 2 });
        // The review answered the appeal just now, so the restriction is final, and the case is due a day later.
        expect(await evidenceDue(tx, r.caseId)).toBe("later");
        await ageCase(tx, r.caseId, "25 hours");
        expect(await evidenceDue(tx, r.caseId)).toBe("due");
        const [held] = await tx.execute<{ held: boolean }>(sql`select bool_and(hold_until is not null) as held from post_media where post_id = ${r.postId}::uuid`);
        expect(held!.held).toBe(true);

        // One snapshot, three texts, one statement and two holds.
        expect(await count(tx, sql`select public.erase_case_evidence(${r.caseId}::uuid) as n`)).toBe(7);
        expect(await evidenceLeft(tx, r.caseId)).toEqual({ snapshots: 0, texts: 0, statements: 0, holds: 0 });
        const [snapshot] = await snapshots(tx, sql`case_id = ${r.caseId}::uuid`);
        expect(snapshot).toMatchObject({ erased: true, body: null, salt: null, handle: expect.stringMatching(/^s_/), digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
        // Each erased text keeps its row and its digest; the texts the decisions confirmed are their statements, and stay.
        const texts = await tx.execute<{ kind: string; erased: boolean; text: string | null; confirmed: boolean; digest: string }>(
          sql`select kind::text as kind, erased_at is not null as erased, text, confirmed_at is not null as confirmed, digest from staff_texts where case_id = ${r.caseId}::uuid order by kind::text, digest`);
        expect(texts.filter((t) => !t.confirmed).map((t) => [t.kind, t.erased, t.text])).toEqual([["facts", true, null], ["note", true, null], ["seal_declined", true, null]]);
        expect(texts.find((t) => t.kind === "facts" && !t.confirmed)!.digest).toBe(draft);
        expect(texts.filter((t) => t.confirmed).map((t) => [t.kind, t.erased, t.text !== null])).toEqual([["facts", false, true], ["reason", false, true], ["review_reason", false, true]]);
        expect(await one(tx, sql`select statement, statement_salt as salt, erased_at is not null as erased, statement_digest ~ '^[0-9a-f]{64}$' as digest, answered_by::text as review from appeals where id = ${appeal}::uuid`)).toEqual({ statement: null, salt: null, erased: true, digest: true, review });
        const [free] = await tx.execute<{ free: boolean }>(sql`select bool_and(hold_until is null) as free from post_media where post_id = ${r.postId}::uuid`);
        expect(free!.free).toBe(true);
        // It touched no intake, and a second run finds nothing to change.
        expect(await count(tx, sql`select (explanation is null and erased_at is null and reporter_id is not null) as n from intakes where id = ${r.intakeId}::uuid`)).toBe(true);
        expect(await count(tx, sql`select public.erase_case_evidence(${r.caseId}::uuid) as n`)).toBe(0);
      });
    });

    test("a restriction's evidence is kept until it is final for its author: through the appeal's window, while an appeal is pending, and no longer than its answer when the review looked at the copy the case already held", async () => {
      await inWorld(async (tx) => {
        const r = await removed(tx, "R1");
        expect(await evidenceDue(tx, r.caseId)).toBe("never");
        await ageCase(tx, r.caseId, "5 months 20 days");
        expect(await evidenceDue(tx, r.caseId)).toBe("never");
        expect(await refused(tx, sql`select public.erase_case_evidence(${r.caseId}::uuid)`)).toBe("not_due");
        // The author appeals inside the window; the case then waits for the answer, however long that takes.
        await appealOf(tx, r.decisionId, r.authorId);
        await ageCase(tx, r.caseId, "3 months");
        expect(await evidenceDue(tx, r.caseId)).toBe("never");
        // The review keeps the removal on the snapshot the case held: the restriction is final at its answer, and nothing
        // newer than a day holds the evidence back. Had the reviewer taken a fresh snapshot, it would wait a day (the test above).
        await reviewIn(tx, admin, r.decisionId);
        expect(await evidenceDue(tx, r.caseId)).toBe("due");

        // Without an appeal: due once the six months have run.
        const quiet = await removed(tx, "R1");
        await ageCase(tx, quiet.caseId, "6 months 2 days");
        expect(await evidenceDue(tx, quiet.caseId)).toBe("due");
        // A restriction that a correction reversed in full leaves its author nothing to appeal: the case is due a day after it.
        const undone = await removed(tx, "R1");
        await decideIn(tx, mod, undone.caseId, { kind: "correction", reviewsDecisionId: undone.decisionId, actions: [act("restore")] });
        expect(await evidenceDue(tx, undone.caseId)).toBe("later");
        await ageCase(tx, undone.caseId, "25 hours");
        expect(await evidenceDue(tx, undone.caseId)).toBe("due");
      });
    });

    test("a field reset's case is not due before 30 days after the reset stopped: after its lift, and after the close of the case for a reset taken while deciding", async () => {
      await inWorld(async (tx) => {
        // A final reset, lifted by a correction: the old value stays readable on the decision's screen for 30 days.
        const a = await newProfile(tx as unknown as Db);
        const lifted = (await report(tx, anAccount(a.id, a.handle))).caseId;
        const reset = await decideIn(tx, mod, lifted, { kind: "final", actions: [act("reset_bio")] });
        await ageCase(tx, lifted, "7 months");
        expect(await evidenceDue(tx, lifted)).toBe("due");
        await decideIn(tx, mod, lifted, { kind: "correction", reviewsDecisionId: reset, actions: [act("restore_bio")] });
        expect(await evidenceDue(tx, lifted)).toBe("later");
        await ageCase(tx, lifted, "29 days");
        expect(await evidenceDue(tx, lifted)).toBe("later");
        expect(await refused(tx, sql`select public.erase_case_evidence(${lifted}::uuid)`)).toBe("not_due");
        await ageCase(tx, lifted, "2 days");
        expect(await evidenceDue(tx, lifted)).toBe("due");

        // A reset taken while deciding ends with the case: 30 days from its close.
        const b = await newProfile(tx as unknown as Db);
        const interim = (await report(tx, anAccount(b.id, b.handle))).caseId;
        await decideIn(tx, mod, interim, { kind: "interim", actions: [act("reset_display_name")] });
        await decideIn(tx, mod, interim, { kind: "final", outcome: "no_violation" });
        await ageCase(tx, interim, "29 days");
        expect(await evidenceDue(tx, interim)).toBe("later");
        await ageCase(tx, interim, "2 days");
        expect(await evidenceDue(tx, interim)).toBe("due");
      });
    });
  });

  describe("gate E: a frozen post's snapshots", () => {
    test("erase_case_evidence erases the case's notes and releases its holds, and keeps its snapshot of a post that is frozen through its author's account, through the post itself, or through a seal", async () => {
      for (const reach of ["account", "post", "seal"] as const) {
        await inWorld(async (tx) => {
          const p = await imagePost(tx, 2);
          const { caseId } = await report(tx, aPost(p.postId));
          await saveText(tx, caseId, mod.id, "note");
          await decideIn(tx, mod, caseId, { kind: "final", outcome: "no_violation" });
          await ageCase(tx, caseId, "3 days");
          expect(await evidenceDue(tx, caseId), reach).toBe("due");
          // The freeze begins after the case closed: a suspect item about the author's account, or about the post itself
          // (in a new case of the post), or a seal for good that lists the post.
          const suspect = await report(tx, reach === "account" ? anAccount(p.authorId) : aPost(p.postId), "csam");
          if (reach === "seal") {
            await decideIn(tx, admin, suspect.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
            expect(await inForce(tx, { caseId: suspect.caseId }), reach).toEqual(["seal_media"]);
          }
          expect(await postFrozen(tx, p.postId), reach).toBe(true);

          // The note and the two holds go; the snapshot of the frozen post stays, whole.
          expect(await count(tx, sql`select public.erase_case_evidence(${caseId}::uuid) as n`), reach).toBe(3);
          expect(await evidenceLeft(tx, caseId), reach).toEqual({ snapshots: 1, texts: 0, statements: 0, holds: 0 });
          expect((await snapshots(tx, sql`case_id = ${caseId}::uuid`))[0], reach).toMatchObject({ erased: false, body: "a post" });
          // The images are kept by the freeze, held or not: the author's deletion takes none of them.
          await authorDeletes(tx, p.postId);
          const gone = await tx.execute(sql`delete from post_media where id in (select id from post_media where post_id = ${p.postId}::uuid order by id for update) returning id`);
          expect(gone.length, reach).toBe(0);
          if (reach === "seal") return;
          // An admin answers without a seal: the freeze ends, and the same call erases the snapshot.
          await decideIn(tx, admin, suspect.caseId, { kind: "final", outcome: "no_violation" });
          expect(await postFrozen(tx, p.postId), reach).toBe(false);
          expect(await count(tx, sql`select public.erase_case_evidence(${caseId}::uuid) as n`), reach).toBe(1);
          expect((await snapshots(tx, sql`case_id = ${caseId}::uuid`))[0], reach).toMatchObject({ erased: true, body: null });
        });
      }
    });

    test("the API role may call neither the one function that erases a snapshot nor the one that releases holds, and can write no erasure itself", async () => {
      const denied = { code: "42501", message: expect.stringMatching(/permission denied/) };
      expect(await pgError(apiDb.execute(sql`select public.erase_snapshots(array[${randomUUID()}]::uuid[])`))).toEqual(denied);
      expect(await pgError(apiDb.execute(sql`select public.release_case_holds(${randomUUID()}::uuid, null)`))).toEqual(denied);
      expect(await pgError(apiDb.execute(sql`update evidence_snapshots set erased_at = now(), body = null where id = ${randomUUID()}::uuid`))).toEqual(denied);
      expect(await pgError(apiDb.execute(sql`update decisions set redacted_at = now() where id = ${randomUUID()}::uuid`))).toEqual(denied);
      // It may ask every due rule and call every erasure that checks one; each refuses what is not due, or what it does not know.
      for (const call of [sql`public.erase_case_evidence(${randomUUID()}::uuid)`, sql`public.erase_intake(${randomUUID()}::uuid)`, sql`public.erase_statement_texts(${randomUUID()}::uuid)`, sql`public.sweep_staff_texts(now())`, sql`public.delete_access_log(now() - interval '11 months')`]) {
        expect(await refusal(apiDb.execute(sql`select ${call}`))).toBe("not_due");
      }
      expect(await refusal(apiDb.execute(sql`select public.redact_r4_body(${randomUUID()}::uuid)`))).toBe("invalid_decision");
      expect(await one(apiDb, sql`select public.forget_reporter(${randomUUID()}::uuid) as n, public.decision_final_at(${randomUUID()}::uuid) as f, public.case_evidence_due_at(${randomUUID()}::uuid) as c, public.intake_due_at(${randomUUID()}::uuid) as i`)).toEqual({ n: 0, f: null, c: null, i: null });
    });

    test("erase_snapshots, redact_r4_body and a delete of an attached image row refuse to run outside READ COMMITTED", async () => {
      for (const isolationLevel of ["repeatable read", "serializable"] as const) {
        const errors: (string | null)[] = [];
        await migrateDb
          .transaction(
            async (tx) => {
              await tx.execute(sql`set local lock_timeout = '10s'`);
              await staffProfile(tx, mod);
              const r = await removed(tx, "R4");
              await ageCase(tx, r.caseId, "7 months");
              errors.push(await refused(tx, sql`select public.erase_snapshots(array[${randomUUID()}]::uuid[])`));
              errors.push(await refused(tx, sql`select public.redact_r4_body(${r.decisionId}::uuid)`));
              errors.push(await refused(tx, sql`delete from post_media where id = ${r.mediaIds[0]!}::uuid`));
              throw new Error("rolled back on purpose");
            },
            { isolationLevel },
          )
          .catch((err: unknown) => {
            if ((err as Error).message !== "rolled back on purpose") throw err;
          });
        expect(errors, isolationLevel).toEqual(["25000 read_committed_only", "25000 read_committed_only", "25000 read_committed_only"]);
      }
    });
  });

  describe("intake_due_at and erase_intake", () => {
    /** A signed-in notice of illegality about a post, whose sender is owed a mail, answered without action by a final decision. */
    async function answered(tx: DbTx, outcome: "no_violation" | "restricted" = "no_violation") {
      const p = await imagePost(tx, 0);
      const { caseId, recorded } = await report(tx, aPost(p.postId), "illegal");
      const decisionId = await decideIn(tx, mod, caseId, outcome === "restricted" ? { kind: "final", actions: [act("remove")] } : { kind: "final", outcome });
      return { ...p, caseId, decisionId, intakeId: recorded.intakeId, itemId: recorded.items[0]!.id };
    }

    test("an intake is not due while an item is unanswered, unreleased, unmailed, changed and not released again, or open to re-examination; then 30 days after its last release", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const open = await report(tx, aPost(p.postId), "illegal");
        expect(await intakeDue(tx, open.recorded.intakeId)).toBe("never");
        expect(await refused(tx, sql`select public.erase_intake(${open.recorded.intakeId}::uuid)`)).toBe("not_due");

        const n = await answered(tx);
        // Answered, not released.
        expect(await intakeDue(tx, n.intakeId)).toBe("never");
        // Released, its mail still pending.
        await tx.execute(sql`update intake_items set outcome_sent_at = now(), shown_outcome = outcome where id = ${n.itemId}::uuid`);
        await ageIntakeItems(tx, n.intakeId, "8 months");
        expect(await intakeDue(tx, n.intakeId)).toBe("never");
        await tx.execute(sql`update intake_items set outcome_mail = 'sent' where id = ${n.itemId}::uuid`);
        expect(await intakeDue(tx, n.intakeId)).toBe("due");
        // A changed outcome that waits for its release.
        await tx.execute(sql`update intake_items set revision_pending_at = now() where id = ${n.itemId}::uuid`);
        expect(await intakeDue(tx, n.intakeId)).toBe("never");
        // Released again just now: 30 days from then.
        await tx.execute(sql`update intake_items set revision_pending_at = null, revised_sent_at = now() where id = ${n.itemId}::uuid`);
        expect(await intakeDue(tx, n.intakeId)).toBe("later");
        await tx.execute(sql`update intake_items set revised_sent_at = now() - interval '29 days' where id = ${n.itemId}::uuid`);
        expect(await intakeDue(tx, n.intakeId)).toBe("later");
        await tx.execute(sql`update intake_items set revised_sent_at = now() - interval '31 days' where id = ${n.itemId}::uuid`);
        expect(await intakeDue(tx, n.intakeId)).toBe("due");

        // Open to re-examination for six months after the release of "no action"; not once it was asked for and answered.
        const m = await answered(tx);
        await releaseItems(tx, m.intakeId);
        await ageIntakeItems(tx, m.intakeId, "5 months 20 days");
        expect(await intakeDue(tx, m.intakeId)).toBe("never");
        await ageIntakeItems(tx, m.intakeId, "20 days");
        expect(await intakeDue(tx, m.intakeId)).toBe("due");
      });
    });

    test("an intake is kept while a restriction it led to is not final for its author, so a reversal on appeal still reaches whoever reported", async () => {
      await inWorld(async (tx) => {
        const n = await answered(tx, "restricted");
        await releaseItems(tx, n.intakeId);
        await ageCase(tx, n.caseId, "5 months");
        // Released five months ago, and not open to re-examination; but the author may still appeal.
        expect(await intakeDue(tx, n.intakeId)).toBe("never");
        await appealOf(tx, n.decisionId, n.authorId);
        await ageCase(tx, n.caseId, "4 months");
        expect(await intakeDue(tx, n.intakeId)).toBe("never");
        expect(await refused(tx, sql`select public.erase_intake(${n.intakeId}::uuid)`)).toBe("not_due");
        // The review reverses the removal: the item's changed outcome waits for its release, and the intake with it.
        await reviewIn(tx, admin, n.decisionId, { actions: [act("restore")] });
        expect(await count(tx, sql`select revision_pending_at is not null as n from intake_items where id = ${n.itemId}::uuid`)).toBe(true);
        expect(await intakeDue(tx, n.intakeId)).toBe("never");
        await tx.execute(sql`update intake_items set revision_pending_at = null, revised_sent_at = now(), shown_outcome = 'reversed' where id = ${n.itemId}::uuid`);
        expect(await intakeDue(tx, n.intakeId)).toBe("later");
        await tx.execute(sql`update intake_items set revised_sent_at = now() - interval '31 days' where id = ${n.itemId}::uuid`);
        expect(await intakeDue(tx, n.intakeId)).toBe("due");
      });
    });

    test("erase_intake nulls the explanation and the cited law, forgets who sent it and erases its re-examinations' statements, each digest kept; a second run changes nothing", async () => {
      await inWorld(async (tx) => {
        const n = await answered(tx);
        await releaseItems(tx, n.intakeId);
        await tx.execute(sql`update intakes set cited_law = 'Section 1 of an act' where id = ${n.intakeId}::uuid`);
        // The reporter asks for a re-examination, with a statement; it is answered and released too.
        const salt = hex64();
        const statement = "Please look again.";
        // The first case is closed, so the re-examination opens a new one, as the intake transaction does.
        const reopened = await openCase(tx, "post", n.postId);
        const [item] = await tx.execute<{ id: string }>(sql`
          insert into intake_items (intake_id, position, target_type, target_id, case_id, lane, reexamines_item_id, statement, statement_salt, statement_digest)
          values (${n.intakeId}::uuid, 1, 'post', ${n.postId}::uuid, ${reopened}::uuid, 1, ${n.itemId}::uuid, ${statement}, ${salt},
                  encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${salt}, 'hex') || convert_to(${statement}, 'UTF8')), 'hex')) returning id`);
        expect(await intakeDue(tx, n.intakeId)).toBe("never");
        await snapshotOn(tx, reopened, "post", n.postId);
        await decideIn(tx, mod, reopened, { kind: "final", outcome: "no_violation" });
        await releaseItems(tx, n.intakeId);
        await tx.execute(sql`update intake_items set outcome_mail = 'sent' where intake_id = ${n.intakeId}::uuid`);
        await ageIntakeItems(tx, n.intakeId, "31 days");
        // The first item was re-examined and its re-examination was answered: nothing is open any more.
        expect(await intakeDue(tx, n.intakeId)).toBe("due");

        // The intake, its two items' reporter, and the one statement.
        expect(await count(tx, sql`select public.erase_intake(${n.intakeId}::uuid) as n`)).toBe(4);
        expect(await one(tx, sql`select explanation, cited_law, reporter_id, erased_at is not null as erased, bona_fide, alleges_illegal from intakes where id = ${n.intakeId}::uuid`)).toEqual({ explanation: null, cited_law: null, reporter_id: null, erased: true, bona_fide: true, alleges_illegal: true });
        expect(await count(tx, sql`select count(*)::int as n from intake_items where intake_id = ${n.intakeId}::uuid and reporter_account_id is not null`)).toBe(0);
        expect(await one(tx, sql`select statement, statement_salt as salt, erased_at is not null as erased, statement_digest ~ '^[0-9a-f]{64}$' as digest from intake_items where id = ${item!.id}::uuid`)).toEqual({ statement: null, salt: null, erased: true, digest: true });
        expect(await count(tx, sql`select public.erase_intake(${n.intakeId}::uuid) as n`)).toBe(0);
        // The items are still the record: their outcomes and times stay.
        expect(await count(tx, sql`select count(*)::int as n from intake_items where intake_id = ${n.intakeId}::uuid and outcome = 'no_violation' and outcome_sent_at is not null`)).toBe(2);
      });
    });

    /** Dates an intake's items back, wherever their cases are. */
    const ageIntakeItems = (tx: DbTx, intakeId: string, ago: string) =>
      tx.execute(sql`update intake_items set created_at = created_at - ${ago}::interval, outcome_sent_at = outcome_sent_at - ${ago}::interval, revised_sent_at = revised_sent_at - ${ago}::interval where intake_id = ${intakeId}::uuid`);
  });

  describe("statements, drafts, the access log and a deleted account's reports", () => {
    test("erase_statement_texts erases a decision's texts only once its subject's account has been deleted for 12 months, by the auth row's mark alone", async () => {
      await inWorld(async (tx) => {
        const r = await removed(tx, "R1");
        const texts = () => tx.execute<{ kind: string; erased: boolean; held: boolean; digest: boolean }>(sql`select kind::text as kind, erased_at is not null as erased, text is not null as held, digest ~ '^[0-9a-f]{64}$' as digest from staff_texts where case_id = ${r.caseId}::uuid and confirmed_at is not null order by kind::text`);
        const erase = sql`select public.erase_statement_texts(${r.decisionId}::uuid) as n`;
        // No auth row at all, then a live one: not due, also when the API role's own table says the profile was deleted long ago.
        expect(await refused(tx, erase)).toBe("not_due");
        await authAccount(tx, r.authorId);
        await tx.execute(sql`update profiles set deleted_at = now() - interval '13 months' where id = ${r.authorId}::uuid`);
        expect(await refused(tx, erase)).toBe("not_due");
        await tx.execute(sql`update auth.users set deleted_at = now() - interval '11 months 20 days' where id = ${r.authorId}::uuid`);
        expect(await refused(tx, erase)).toBe("not_due");
        await tx.execute(sql`update auth.users set deleted_at = now() - interval '12 months 1 day' where id = ${r.authorId}::uuid`);
        expect(await count(tx, erase)).toBe(2);
        expect([...(await texts())].map((t) => ({ ...t }))).toEqual([
          { kind: "facts", erased: true, held: false, digest: true },
          { kind: "reason", erased: true, held: false, digest: true },
        ]);
        expect(await count(tx, erase)).toBe(0);
        // The decision keeps its enums, its dates and its digests.
        expect(await count(tx, sql`select (facts_digest is not null and reason_digest is not null and rule_id = 'R1') as n from decisions where id = ${r.decisionId}::uuid`)).toBe(true);
      });
    });

    test("erase_statement_texts takes a correction's reason and a legal reference too", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const { caseId } = await report(tx, aPost(p.postId), "illegal");
        const removal = await decideIn(tx, mod, caseId, { kind: "final", ground: "illegal", actions: [act("remove")] });
        const correction = await decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] });
        await authAccount(tx, p.authorId, "13 months");
        expect(await count(tx, sql`select public.erase_statement_texts(${removal}::uuid) as n`)).toBe(3);
        expect(await count(tx, sql`select public.erase_statement_texts(${correction}::uuid) as n`)).toBe(1);
        expect(await count(tx, sql`select count(*)::int as n from staff_texts where case_id = ${caseId}::uuid and text is not null`)).toBe(0);
      });
    });

    test("forget_reporter forgets a deleted account's reports, with (3e Task 5) its marks and its tallies, and changes nothing for a live one, whatever its profile says", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const reporter = await newProfile(tx as unknown as Db);
        const recorded = await intake(tx, ground.rule(reporter.id), aPost(p.postId));
        // 3e Task 5: the report was counted on its day, and a decision that found no breach marked it.
        await decideIn(tx, mod, recorded.items[0]!.caseId!, { kind: "final", outcome: "no_violation", unfounded: [recorded.items[0]!.id] });
        const counted = () => one(tx, sql`select (select count(*)::int from unfounded_marks where account_id = ${reporter.id}::uuid) as marks, (select count(*)::int from report_tallies where account_id = ${reporter.id}::uuid) as tallies`);
        expect(await counted()).toEqual({ marks: 1, tallies: 1 });
        const linked = () => one(tx, sql`select (select reporter_id from intakes where id = ${recorded.intakeId}::uuid) as intake, (select reporter_account_id from intake_items where id = ${recorded.items[0]!.id}::uuid) as item`);
        const forget = sql`select public.forget_reporter(${reporter.id}::uuid) as n`;
        expect(await count(tx, forget)).toBe(0);
        await authAccount(tx, reporter.id);
        await tx.execute(sql`update profiles set deleted_at = now() where id = ${reporter.id}::uuid`);
        expect(await count(tx, forget)).toBe(0);
        expect(await linked()).toEqual({ intake: reporter.id, item: reporter.id });
        // The take-down marks the auth row; from then on the purge's call forgets the links, and its rerun finds none.
        await tx.execute(sql`update auth.users set deleted_at = now() where id = ${reporter.id}::uuid`);
        expect(await counted()).toEqual({ marks: 1, tallies: 1 });
        // The intake's and the item's links, the mark and the day's tally.
        expect(await count(tx, forget)).toBe(4);
        expect(await linked()).toEqual({ intake: null, item: null });
        expect(await counted()).toEqual({ marks: 0, tallies: 0 });
        expect(await count(tx, forget)).toBe(0);
        // The intake goes on: its item is still in its case, with the outcome its decision gave.
        expect(await count(tx, sql`select count(*)::int as n from intake_items where id = ${recorded.items[0]!.id}::uuid and case_id is not null and outcome = 'no_violation'`)).toBe(1);
      });
    });

    test("sweep_staff_texts deletes drafts older than a day, never a note, a recorded choice not to seal or a confirmed text, and refuses a time less than a day back", async () => {
      await inWorld(async (tx) => {
        const r = await removed(tx, "R1");
        const old = await saveText(tx, r.caseId, mod.id, "reason", "an old draft");
        const recent = await saveText(tx, r.caseId, mod.id, "reason", "a draft of this hour");
        const note = await saveText(tx, r.caseId, mod.id, "note");
        const declined = await saveText(tx, r.caseId, mod.id, "seal_declined");
        await tx.execute(sql`update staff_texts set created_at = now() - interval '3 days' where case_id = ${r.caseId}::uuid and digest <> ${recent}`);
        expect(await refused(tx, sql`select public.sweep_staff_texts(now() - interval '23 hours')`)).toBe("not_due");
        expect(await refused(tx, sql`select public.sweep_staff_texts(null)`)).toBe("not_due");
        const left = async () => [...(await tx.execute<{ digest: string }>(sql`select digest from staff_texts where case_id = ${r.caseId}::uuid`))].map((t) => t.digest);
        expect(await left()).toContain(old);
        expect(await count(tx, sql`select public.sweep_staff_texts(now() - interval '24 hours') as n`)).toBeGreaterThanOrEqual(1);
        const kept = await left();
        expect(kept).not.toContain(old);
        expect(kept).toEqual(expect.arrayContaining([recent, note, declined]));
        // The decision's own two texts, which it confirmed, are three days old too, and stay.
        expect(kept.length).toBe(5);
      });
    });

    test("delete_access_log deletes the rows older than its time, erasing first the reveal reasons they name, and refuses a time less than 12 months back", async () => {
      await inWorld(async (tx) => {
        const r = await removed(tx, "R1");
        const reason = await saveText(tx, r.caseId, mod.id, "reveal_reason", "why the source was revealed");
        const textId = (await one<{ id: string }>(tx, sql`update staff_texts set confirmed_at = now() where digest = ${reason} returning id`)).id;
        await tx.execute(sql`insert into case_access_log (staff_id, case_id, kind) values (${mod.id}::uuid, ${r.caseId}::uuid, 'case_opened')`);
        await tx.execute(sql`insert into case_access_log (staff_id, case_id, kind, intake_item_id, text_id) values (${mod.id}::uuid, ${r.caseId}::uuid, 'identity_revealed', ${r.itemId}::uuid, ${textId}::uuid)`);
        await ageCase(tx, r.caseId, "12 months 2 days");
        await tx.execute(sql`insert into case_access_log (staff_id, case_id, kind) values (${mod.id}::uuid, ${r.caseId}::uuid, 'image_viewed')`);
        expect(await refused(tx, sql`select public.delete_access_log(now() - interval '11 months 29 days')`)).toBe("not_due");
        expect(await refused(tx, sql`select public.delete_access_log(null)`)).toBe("not_due");
        // The reason and the two old rows; today's row stays.
        expect(await count(tx, sql`select public.delete_access_log(now() - interval '12 months') as n`)).toBeGreaterThanOrEqual(3);
        expect([...(await tx.execute<{ kind: string }>(sql`select kind::text as kind from case_access_log where case_id = ${r.caseId}::uuid`))].map((row) => row.kind)).toEqual(["image_viewed"]);
        expect(await one(tx, sql`select text, salt, erased_at is not null as erased, digest from staff_texts where id = ${textId}::uuid`)).toEqual({ text: null, salt: null, erased: true, digest: reason });
      });
    });
  });

  describe("users_deleted_mark", () => {
    test("for the auth role a mark set from null becomes now(), whatever was supplied, and a mark that is set is never cleared or changed; the migrator is not bound", async () => {
      await rolledBack(authDb, async (tx) => {
        const { id } = await one<{ id: string }>(tx, sql`insert into auth.users (email) values (${`mark-${randomUUID()}@korbat.local`}) returning id`);
        const mark = () => one<{ now: boolean | null }>(tx, sql`select deleted_at = now() as now from auth.users where id = ${id}::uuid`);
        // A back-dated mark would let the API erase a live account's statements at once.
        await tx.execute(sql`update auth.users set deleted_at = now() - interval '2 years' where id = ${id}::uuid`);
        expect(await mark()).toEqual({ now: true });
        const kept = { code: "23514", message: expect.stringMatching(/users_deleted_mark/) };
        expect(await pgError(tx.transaction((sp) => sp.execute(sql`update auth.users set deleted_at = null where id = ${id}::uuid`)))).toEqual(kept);
        expect(await pgError(tx.transaction((sp) => sp.execute(sql`update auth.users set deleted_at = now() - interval '2 years' where id = ${id}::uuid`)))).toEqual(kept);
        expect(await pgError(tx.transaction((sp) => sp.execute(sql`update auth.users set deleted_at = deleted_at + interval '1 second', failed_logins = 3 where id = ${id}::uuid`)))).toEqual(kept);
        // Writing the same mark again, or another column, is no change of the mark.
        await tx.execute(sql`update auth.users set deleted_at = deleted_at, failed_logins = 1 where id = ${id}::uuid`);
        await tx.execute(sql`update auth.users set failed_logins = 2 where id = ${id}::uuid`);
        expect(await mark()).toEqual({ now: true });
      });
      await rolledBack(migrateDb, async (tx) => {
        const { id } = await one<{ id: string }>(tx, sql`insert into auth.users (email) values (${`mark-${randomUUID()}@korbat.local`}) returning id`);
        await tx.execute(sql`update auth.users set deleted_at = now() - interval '2 years' where id = ${id}::uuid`);
        expect(await one(tx, sql`select deleted_at = now() - interval '2 years' as back from auth.users where id = ${id}::uuid`)).toEqual({ back: true });
        await tx.execute(sql`update auth.users set deleted_at = null where id = ${id}::uuid`);
        expect(await one(tx, sql`select deleted_at is null as cleared from auth.users where id = ${id}::uuid`)).toEqual({ cleared: true });
      });
    });
  });

  describe("redact_r4_body", () => {
    const redact = (id: string) => sql`select public.redact_r4_body(${id}::uuid) as n`;

    test("it takes only a final R4 decision that removes or resets, and only once that decision is final for its author", async () => {
      await inWorld(async (tx) => {
        const r3 = await removed(tx, "R3");
        await ageCase(tx, r3.caseId, "7 months");
        expect(await refused(tx, redact(r3.decisionId))).toBe("invalid_decision");
        const p = await imagePost(tx, 1);
        const open = await report(tx, aPost(p.postId));
        const withheld = await decideIn(tx, mod, open.caseId, { kind: "interim", ruleId: "R4", actions: [act("withhold")] });
        expect(await refused(tx, redact(withheld))).toBe("invalid_decision");
        const cleared = await decideIn(tx, mod, open.caseId, { kind: "final", outcome: "no_violation" });
        expect(await refused(tx, redact(cleared))).toBe("invalid_decision");
        expect(await refused(tx, redact(randomUUID()))).toBe("invalid_decision");

        // The window is open, then an appeal is pending: not due, and nothing changes.
        const r = await removed(tx, "R4");
        expect(await refused(tx, redact(r.decisionId))).toBe("not_due");
        await ageCase(tx, r.caseId, "5 months");
        await appealOf(tx, r.decisionId, r.authorId);
        await ageCase(tx, r.caseId, "3 months");
        expect(await refused(tx, redact(r.decisionId))).toBe("not_due");
        expect(await postRow(tx, r.postId)).toEqual({ state: "removed", level: "removed", erased: false });
        expect(await count(tx, sql`select body = 'a post' as n from posts where id = ${r.postId}::uuid`)).toBe(true);
        // The review keeps the removal: final at its answer, and the redaction acts.
        await reviewIn(tx, admin, r.decisionId);
        expect(await count(tx, redact(r.decisionId))).toBe(true);
        expect(await postRow(tx, r.postId)).toEqual({ state: "removed", level: "removed", erased: true });
      });
    });

    test("a post removal made final: the body blank, the post erased for good, every snapshot of the post taken up to the removal erased in every case, the case's holds released, and a later reversal changes nothing anyone sees", async () => {
      await inWorld(async (tx) => {
        // An earlier case about the same post, closed without action, still holds its snapshot and its holds.
        const p = await imagePost(tx, 2);
        const earlier = (await report(tx, aPost(p.postId))).caseId;
        await decideIn(tx, mod, earlier, { kind: "final", outcome: "no_violation" });
        const { caseId } = await report(tx, aPost(p.postId));
        const removal = await decideIn(tx, mod, caseId, { kind: "final", ruleId: "R4", actions: [act("remove")] });
        await ageCase(tx, caseId, "6 months 1 day");
        // The earlier case is the older of the two: its copy was taken before the removal, and holds what was removed.
        await ageCase(tx, earlier, "6 months 2 days");
        expect(await count(tx, sql`select count(*)::int as n from evidence_snapshots where target_id = ${p.postId}::uuid and erased_at is null`)).toBe(2);

        expect(await count(tx, redact(removal))).toBe(true);
        expect(await one(tx, sql`select body, erased_at = now() as erased_now, state::text as state, moderation_level::text as level from posts where id = ${p.postId}::uuid`)).toEqual({ body: "", erased_now: true, state: "removed", level: "removed" });
        expect([...(await snapshots(tx, sql`target_type = 'post' and target_id = ${p.postId}::uuid`))].map((s) => [s.erased, s.body])).toEqual([[true, null], [true, null]]);
        expect(await count(tx, sql`select redacted_at = now() as n from decisions where id = ${removal}::uuid`)).toBe(true);
        // This case's holds on the erased images are released; the earlier case's holds are its own evidence still. The
        // image rows carry no mark of their own: their post's mark is what every reader and the disposal read.
        expect(await evidenceLeft(tx, caseId)).toMatchObject({ snapshots: 0, holds: 0 });
        expect(await evidenceLeft(tx, earlier)).toMatchObject({ snapshots: 0, holds: 2 });
        expect(await count(tx, sql`select count(*)::int as n from post_media where post_id = ${p.postId}::uuid and erased_at is not null`)).toBe(0);
        // A second call changes nothing and says so.
        expect(await count(tx, redact(removal))).toBe(false);
        // A correction lifts the measure in the ledger; the post stays removed and blank.
        await snapshotOn(tx, caseId, "post", p.postId);
        await decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] });
        expect(await inForce(tx, { postId: p.postId })).toEqual([]);
        expect(await postRow(tx, p.postId)).toEqual({ state: "removed", level: "removed", erased: true });
        expect(await count(tx, sql`select body = '' as n from posts where id = ${p.postId}::uuid`)).toBe(true);
        expect(await count(tx, redact(removal))).toBe(false);
      });
    });

    test("it acts on a removal of a post its author deleted, before the removal or after it: the state stays the author's, the copies go", async () => {
      for (const order of ["deleted first", "deleted after"] as const) {
        await inWorld(async (tx) => {
          const p = await imagePost(tx, 1);
          const { caseId } = await report(tx, aPost(p.postId));
          if (order === "deleted first") await authorDeletes(tx, p.postId);
          const removal = await decideIn(tx, mod, caseId, { kind: "final", ruleId: "R4", actions: [act("remove")] });
          if (order === "deleted after") await authorDeletes(tx, p.postId);
          await ageCase(tx, caseId, "7 months");
          expect(await count(tx, redact(removal)), order).toBe(true);
          expect(await postRow(tx, p.postId), order).toEqual({ state: "deleted_by_author", level: "removed", erased: true });
          expect(await count(tx, sql`select count(*)::int as n from evidence_snapshots where target_id = ${p.postId}::uuid and erased_at is null`), order).toBe(0);
          expect(await count(tx, sql`select redacted_at is not null as n from decisions where id = ${removal}::uuid`), order).toBe(true);
        });
      }
    });

    test("an image removal marks that image alone erased and releases its hold alone; a field reset erases the account's snapshots and marks no post", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId));
        const removal = await decideIn(tx, mod, caseId, { kind: "final", ruleId: "R4", actions: [act("remove_media", p.mediaIds[0]!)] });
        await ageCase(tx, caseId, "7 months");
        expect(await count(tx, redact(removal))).toBe(true);
        // The post keeps its body and is not erased: posts.erased_at is a post removal's alone.
        expect(await postRow(tx, p.postId)).toEqual({ state: "visible", level: "visible", erased: false });
        expect(await count(tx, sql`select body = 'a post' as n from posts where id = ${p.postId}::uuid`)).toBe(true);
        expect([...(await tx.execute<{ erased: boolean; held: boolean }>(sql`select erased_at is not null as erased, hold_until is not null as held from post_media where id = any(${`{${p.mediaIds.join(",")}}`}::uuid[]) order by position`))].map((m) => ({ ...m }))).toEqual([
          { erased: true, held: false },
          { erased: false, held: true },
        ]);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["removed", "visible"]);
        expect(await count(tx, sql`select count(*)::int as n from evidence_snapshots where target_id = ${p.postId}::uuid and erased_at is null`)).toBe(0);
        expect(await count(tx, sql`select redacted_at is not null as n from decisions where id = ${removal}::uuid`)).toBe(true);

        const a = await newProfile(tx as unknown as Db);
        const post = await imagePost(tx, 0, a.id);
        const accountCase = (await report(tx, anAccount(a.id, a.handle))).caseId;
        const reset = await decideIn(tx, mod, accountCase, { kind: "final", ruleId: "R4", actions: [act("reset_bio")] });
        await ageCase(tx, accountCase, "7 months");
        expect(await count(tx, sql`select count(*)::int as n from evidence_snapshots where target_type = 'account' and target_id = ${a.id}::uuid and erased_at is null`)).toBe(1);
        expect(await count(tx, redact(reset))).toBe(true);
        expect(await count(tx, sql`select count(*)::int as n from evidence_snapshots where target_type = 'account' and target_id = ${a.id}::uuid and erased_at is null`)).toBe(0);
        expect(await count(tx, sql`select redacted_at is not null as n from decisions where id = ${reset}::uuid`)).toBe(true);
        expect(await postRow(tx, post.postId)).toEqual({ state: "visible", level: "visible", erased: false });
      });
    });

    test("a field reset made final erases the copies taken up to the reset and never the copy an open case took afterwards: that case is still decided on what its moderator read", async () => {
      await inWorld(async (tx) => {
        const a = await newProfile(tx as unknown as Db);
        await tx.execute(sql`update profiles set bio = 'a home address' where id = ${a.id}::uuid`);
        const first = (await report(tx, anAccount(a.id, a.handle))).caseId;
        const reset = await decideIn(tx, mod, first, { kind: "final", ruleId: "R4", actions: [act("reset_bio")] });
        await ageCase(tx, first, "7 months");
        // Since the reset the account wrote a new bio, which someone reports on another ground: a new, open case, whose copy
        // holds what the R4 decision never judged.
        await tx.execute(sql`update profiles set bio = 'a new bio, written after the reset' where id = ${a.id}::uuid`);
        const second = (await report(tx, anAccount(a.id, a.handle))).caseId;
        expect(second).not.toBe(first);
        const copies = async () =>
          [...(await tx.execute<{ case_id: string; erased: boolean; bio: string | null }>(sql`select case_id, erased_at is not null as erased, bio from evidence_snapshots where target_type = 'account' and target_id = ${a.id}::uuid order by taken_at, id`))].map((row) => ({ ...row }));
        expect(await copies()).toEqual([
          { case_id: first, erased: false, bio: "a home address" },
          { case_id: second, erased: false, bio: "a new bio, written after the reset" },
        ]);

        expect(await count(tx, redact(reset))).toBe(true);
        expect(await copies()).toEqual([
          { case_id: first, erased: true, bio: null },
          { case_id: second, erased: false, bio: "a new bio, written after the reset" },
        ]);
        // Nothing the decision restricted is left, so it is marked, and a second call changes nothing.
        expect(await count(tx, sql`select redacted_at is not null as n from decisions where id = ${reset}::uuid`)).toBe(true);
        expect(await count(tx, redact(reset))).toBe(false);
        // The open case is undecided and unanswered still, and a decision that names the copy its moderator read commits.
        expect(await one(tx, sql`select closed_at is null as open, (select count(*)::int from intake_items i where i.case_id = c.id and i.answered_by is null) as unanswered from cases c where c.id = ${second}::uuid`)).toEqual({ open: true, unanswered: 1 });
        await decideIn(tx, mod, second, { kind: "final", outcome: "no_violation" });
        expect(await count(tx, sql`select closed_at is not null as n from cases where id = ${second}::uuid`)).toBe(true);
      });
    });

    test("a post removal made final keeps the copy an open case took after the removal: the case is decided on it, and the copy then goes by its own case's rule", async () => {
      await inWorld(async (tx) => {
        const r = await removed(tx, "R4", 1);
        await ageCase(tx, r.caseId, "7 months");
        // A later report opens a new case about the post. Its copy is taken before the redaction, so it holds the body.
        const later = (await report(tx, aPost(r.postId))).caseId;
        expect(later).not.toBe(r.caseId);

        expect(await count(tx, redact(r.decisionId))).toBe(true);
        expect(await one(tx, sql`select body, erased_at is not null as erased from posts where id = ${r.postId}::uuid`)).toEqual({ body: "", erased: true });
        expect(await evidenceLeft(tx, r.caseId)).toMatchObject({ snapshots: 0 });
        expect([...(await snapshots(tx, sql`case_id = ${later}::uuid`))].map((s) => [s.erased, s.body])).toEqual([[false, "a post"]]);
        expect(await count(tx, sql`select redacted_at is not null as n from decisions where id = ${r.decisionId}::uuid`)).toBe(true);
        expect(await count(tx, redact(r.decisionId))).toBe(false);

        // The open case's decision names the copy its moderator read, and commits.
        await decideIn(tx, mod, later, { kind: "final", outcome: "no_violation" });
        // Closed without action, the case's evidence is due a day after its close and its newest copy: its own rule erases it.
        await ageCase(tx, later, "25 hours");
        expect(await evidenceDue(tx, later)).toBe("due");
        await tx.execute(sql`select public.erase_case_evidence(${later}::uuid)`);
        expect(await evidenceLeft(tx, later)).toMatchObject({ snapshots: 0 });
      });
    });

    test("while the post is frozen it answers false and changes nothing; after a seal for good it goes on waiting, and after an answer without a seal it erases as usual", async () => {
      for (const answer of ["without a seal", "sealed for good"] as const) {
        await inWorld(async (tx) => {
          const r = await removed(tx, "R4", 2);
          await ageCase(tx, r.caseId, "7 months");
          const suspect = await report(tx, anAccount(r.authorId), "csam");
          expect(await postFrozen(tx, r.postId)).toBe(true);
          const untouched = async () => {
            expect(await count(tx, redact(r.decisionId)), answer).toBe(false);
            expect(await postRow(tx, r.postId), answer).toEqual({ state: "removed", level: "removed", erased: false });
            expect(await count(tx, sql`select body = 'a post' as n from posts where id = ${r.postId}::uuid`), answer).toBe(true);
            expect(await evidenceLeft(tx, r.caseId), answer).toMatchObject({ snapshots: 1, holds: 2 });
            expect(await count(tx, sql`select redacted_at is null as n from decisions where id = ${r.decisionId}::uuid`), answer).toBe(true);
          };
          await untouched();
          if (answer === "sealed for good") {
            await decideIn(tx, admin, suspect.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
            expect(await postFrozen(tx, r.postId)).toBe(true);
            await untouched();
            return;
          }
          await decideIn(tx, admin, suspect.caseId, { kind: "final", outcome: "no_violation" });
          expect(await postFrozen(tx, r.postId)).toBe(false);
          expect(await count(tx, redact(r.decisionId)), answer).toBe(true);
          expect(await postRow(tx, r.postId), answer).toEqual({ state: "removed", level: "removed", erased: true });
          expect(await evidenceLeft(tx, r.caseId), answer).toMatchObject({ snapshots: 0, holds: 0 });
        });
      }
    });

    test("a suspect item about the author's account that arrives between its check and its erasures: the body is blank, the snapshots are kept, the decision is not marked, and the call after the answer finishes it", async () => {
      await inWorld(async (tx) => {
        const r = await removed(tx, "R4", 1);
        await ageCase(tx, r.caseId, "7 months");
        // The account's case is open on another ground and the suspect intake exists: only its item is missing. A trigger
        // of this transaction alone (the DDL is rolled back with it) inserts that item when the redaction marks the post
        // erased, which is after its check of the freeze and before it erases the snapshots.
        const accountCase = (await report(tx, anAccount(r.authorId, "named"))).caseId;
        const suspectIntake = await csamNotice(tx);
        await tx.execute(sql.raw(`
          create function public.zz_test_report_between() returns trigger language plpgsql as $f$
          begin
            insert into public.intake_items (intake_id, position, target_type, target_id, named_handle, case_id, lane)
            values ('${suspectIntake}', 1, 'account', '${r.authorId}', 'named', '${accountCase}', 0);
            return null;
          end $f$`));
        await tx.execute(sql`create trigger report_between after update of erased_at on public.posts for each row execute function public.zz_test_report_between()`);
        expect(await postFrozen(tx, r.postId)).toBe(false);

        expect(await count(tx, redact(r.decisionId))).toBe(true);
        await tx.execute(sql`drop trigger report_between on public.posts`);
        expect(await postFrozen(tx, r.postId)).toBe(true);
        expect(await one(tx, sql`select body, erased_at is not null as erased from posts where id = ${r.postId}::uuid`)).toEqual({ body: "", erased: true });
        expect(await evidenceLeft(tx, r.caseId)).toMatchObject({ snapshots: 1 });
        expect(await count(tx, sql`select redacted_at is null as n from decisions where id = ${r.decisionId}::uuid`)).toBe(true);
        // While the freeze lasts the decision stays a candidate, and the call changes nothing.
        expect(await count(tx, redact(r.decisionId))).toBe(false);
        // An admin answers the account's items without a seal: the next call erases the snapshot and marks the decision.
        await decideIn(tx, admin, accountCase, { kind: "final", outcome: "no_violation" });
        expect(await postFrozen(tx, r.postId)).toBe(false);
        expect(await count(tx, redact(r.decisionId))).toBe(true);
        expect(await evidenceLeft(tx, r.caseId)).toMatchObject({ snapshots: 0 });
        expect(await count(tx, sql`select redacted_at is not null as n from decisions where id = ${r.decisionId}::uuid`)).toBe(true);
      });
    });
  });

  describe("section 12's retention cases", () => {
    /** One test's world, with the second admin's profile too. */
    const inWorld3 = (fn: (tx: DbTx) => Promise<void>) =>
      inWorld(async (tx) => {
        await staffProfile(tx, admin2);
        await fn(tx);
      });
    const copies = (tx: DbTx, where: SQL) =>
      tx.execute<{ case_id: string; erased: boolean; body: string | null; media: { id: string; alt: string | null }[] | null }>(sql`select case_id, erased_at is not null as erased, body, media from evidence_snapshots where ${where} order by taken_at, id`);

    test("an R4 removal made final while a suspect item waits in the same open case: the redaction waits for the admin's answer, and then erases the body, the post and its copy", async () => {
      await inWorld3(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "rule", "R1");
        const suspect = await report(tx, aPost(p.postId), "csam");
        expect(suspect.caseId).toBe(caseId);
        // A moderator removes the post under R4 for the rule report alone: answered with the images unseen; the case stays open.
        const removal = await decideIn(tx, mod, caseId, { kind: "final", ruleId: "R4", actions: [act("remove")], throughSeq: 1 });
        expect(await one(tx, sql`select unseen, suspect, needs_admin from decisions where id = ${removal}::uuid`)).toEqual({ unseen: true, suspect: false, needs_admin: false });
        expect(await count(tx, sql`select closed_at is null as n from cases where id = ${caseId}::uuid`)).toBe(true);
        expect(await postRow(tx, p.postId)).toEqual({ state: "removed", level: "removed", erased: false });
        expect(await postFrozen(tx, p.postId)).toBe(true);
        await ageCase(tx, caseId, "7 months");
        // Final for its author and a candidate, but the post is frozen: nothing is erased, and the open case's evidence is not due.
        expect(await dueRedactions(tx)).toContain(removal);
        expect(await redactR4(tx, removal)).toBe(false);
        expect([...(await copies(tx, sql`case_id = ${caseId}::uuid`))].map((s) => ({ erased: s.erased, body: s.body, alt: s.media?.[0]?.alt }))).toEqual([{ erased: false, body: "a post", alt: "image 1" }]);
        expect(await evidenceDue(tx, caseId)).toBe("never");
        expect(await dueCases(tx)).not.toContain(caseId);
        // The admin answers the suspect item without a seal: the freeze ends, and the redaction does its work.
        await decideIn(tx, admin, caseId, { kind: "final", outcome: "no_violation" });
        expect(await postFrozen(tx, p.postId)).toBe(false);
        expect(await redactR4(tx, removal)).toBe(true);
        expect(await postRow(tx, p.postId)).toEqual({ state: "removed", level: "removed", erased: true });
        expect(await one(tx, sql`select body from posts where id = ${p.postId}::uuid`)).toEqual({ body: "" });
        expect([...(await copies(tx, sql`case_id = ${caseId}::uuid`))].map((s) => [s.erased, s.body, s.media])).toEqual([[true, null, null]]);
        expect(await count(tx, sql`select redacted_at is not null as n from decisions where id = ${removal}::uuid`)).toBe(true);
      });
    });

    test("a closed case's copy that a seal for good kept is erased at the first round after a review lifts the seal", async () => {
      await inWorld3(async (tx) => {
        const p = await imagePost(tx, 1);
        const first = await report(tx, aPost(p.postId), "rule");
        await decideIn(tx, mod, first.caseId, { kind: "final", outcome: "no_violation" });
        const second = await report(tx, aPost(p.postId), "csam");
        expect(second.caseId).not.toBe(first.caseId);
        const seal = await decideIn(tx, admin, second.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
        await ageCase(tx, first.caseId, "3 days");
        // The closed case is due and a candidate once: its holds go, its copy of the frozen post stays (gate E).
        expect(await postFrozen(tx, p.postId)).toBe(true);
        expect(await evidenceDue(tx, first.caseId)).toBe("due");
        expect(await dueCases(tx)).toContain(first.caseId);
        expect(await eraseCaseEvidence(tx, first.caseId)).toBe(1);
        expect(await evidenceLeft(tx, first.caseId)).toEqual({ snapshots: 1, texts: 0, statements: 0, holds: 0 });
        expect(await dueCases(tx)).not.toContain(first.caseId);
        // The author appeals the seal, and a second admin lifts it.
        await appealOf(tx, seal, p.authorId, "It is a holiday picture.");
        await reviewIn(tx, admin2, seal, { outcome: "reversed", actions: [act("unseal_media")] });
        expect(await postFrozen(tx, p.postId)).toBe(false);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
        // The next round finds the closed case due again, and erases its copy.
        expect(await dueCases(tx)).toContain(first.caseId);
        expect(await eraseCaseEvidence(tx, first.caseId)).toBe(1);
        expect(await evidenceLeft(tx, first.caseId)).toEqual({ snapshots: 0, texts: 0, statements: 0, holds: 0 });
        expect(await evidenceDue(tx, second.caseId)).toBe("later");
      });
    });

    test("an R4-redacted image that a second, later case still holds: erased for every reader, the later case keeps its own copy and its hold, a report into it holds nothing more, and a new case copies no alt text of it", async () => {
      await inWorld3(async (tx) => {
        const p = await imagePost(tx, 2);
        const [m1, m2] = p.mediaIds as [string, string];
        const first = await report(tx, aPost(p.postId), "rule");
        const removal = await decideIn(tx, mod, first.caseId, { kind: "final", ruleId: "R4", actions: [act("remove_media", m1)] });
        const second = await report(tx, aPost(p.postId), "rule");
        expect(second.caseId).not.toBe(first.caseId);
        await ageCase(tx, first.caseId, "7 months");
        const holds = () => tx.execute<{ first: boolean; m1: boolean; released: boolean }>(sql`select case_id = ${first.caseId}::uuid as first, media_id = ${m1}::uuid as m1, released_at is not null as released from media_holds where media_id in (${m1}::uuid, ${m2}::uuid) order by 1, 2, 3`);

        expect(await redactR4(tx, removal)).toBe(true);
        expect([...(await tx.execute(sql`select id = ${m1}::uuid as m1, erased_at is not null as erased, moderation_state::text as state, hold_until is not null as held from post_media where post_id = ${p.postId}::uuid order by position`))].map((row) => ({ ...row }))).toEqual([
          { m1: true, erased: true, state: "removed", held: true },
          { m1: false, erased: false, state: "visible", held: true },
        ]);
        // The first case's hold on the erased image is released; the second case's holds stand.
        expect([...(await holds())].map((row) => ({ ...row }))).toEqual([
          { first: false, m1: false, released: false },
          { first: false, m1: true, released: false },
          { first: true, m1: false, released: false },
          { first: true, m1: true, released: true },
        ]);
        // The first case's copy, taken before the removal, is erased; the second case's, taken after it, is that open case's.
        expect([...(await copies(tx, sql`target_id = ${p.postId}::uuid`))].map((s) => [s.case_id === first.caseId, s.erased])).toEqual([
          [true, true],
          [false, false],
        ]);
        // Every reader refuses the erased image; the disposal takes neither, both being held.
        const repo = createMediaRepo(tx as unknown as Db);
        expect(await repo.fileAccess(m1)).toMatchObject({ erased: true });
        expect(await repo.staffAccess(m1)).toMatchObject({ erased: true });
        expect(await repo.find(m1)).toBeNull();
        expect((await repo.forPosts([p.postId])).get(p.postId)?.map((image) => image.id)).toEqual([m2]);
        expect(await repo.readyImages(p.authorId)).toEqual([m2]);
        expect(await repo.isExportable(p.authorId, m1)).toBe(false);
        expect((await repo.dropDisposable(tx, 500)).filter((id) => p.mediaIds.includes(id))).toEqual([]);
        // A later report joins the open second case and holds nothing more.
        const third = await report(tx, aPost(p.postId), "illegal");
        expect(third.caseId).toBe(second.caseId);
        expect([...(await holds())].map((row) => ({ ...row }))).toHaveLength(4);
        // Once the second case is closed, a report opens a new case: its copy lists the erased image without its alt
        // text, and it holds only the other image.
        await decideIn(tx, mod, second.caseId, { kind: "final", outcome: "no_violation" });
        const fourth = await report(tx, aPost(p.postId), "rule");
        expect([...(await copies(tx, sql`case_id = ${fourth.caseId}::uuid`))].map((s) => s.media?.map((image) => [image.id === m1, image.alt]))).toEqual([
          [
            [true, null],
            [false, "image 2"],
          ],
        ]);
        expect([...(await tx.execute<{ m1: boolean }>(sql`select media_id = ${m1}::uuid as m1 from media_holds where case_id = ${fourth.caseId}::uuid`))].map((row) => row.m1)).toEqual([false]);
      });
    });

    test("the correction that lifts a final reset of the bio after its copies were erased: refused on the erased copy, committed on a fresh one, and its statement says that korbat does not put the old bio back", async () => {
      await inWorld3(async (tx) => {
        const account = await newProfile(tx as unknown as Db);
        await tx.execute(sql`update profiles set bio = 'my home address is 1 Example Street' where id = ${account.id}::uuid`);
        const { caseId } = await report(tx, anAccount(account.id, account.handle), "rule");
        const reset = await decideIn(tx, mod, caseId, { kind: "final", ruleId: "R4", actions: [act("reset_bio")] });
        await ageCase(tx, caseId, "7 months");
        expect(await redactR4(tx, reset)).toBe(true);
        expect([...(await tx.execute<{ erased: boolean; bio: string | null }>(sql`select erased_at is not null as erased, bio from evidence_snapshots where case_id = ${caseId}::uuid`))].map((row) => ({ ...row }))).toEqual([{ erased: true, bio: null }]);
        expect(await inForce(tx, { caseId })).toEqual(["reset_bio"]);
        // On the case's only copy, which is erased, the correction is refused.
        expect(await refusal(decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: reset, actions: [act("restore_bio")] }))).toBe("snapshot_erased");
        // On a fresh copy it commits, and lifts the reset.
        await tx.execute(sql`insert into evidence_snapshots (case_id, target_type, target_id, author_handle, salt, digest) values (${caseId}::uuid, 'account', ${account.id}::uuid, 'author', ${hex64()}, ${hex64()})`);
        const correction = await decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: reset, actions: [act("restore_bio")] });
        expect(await inForce(tx, { caseId })).toEqual([]);
        const found = await decisionStatement(tx as unknown as Db, correction);
        expect(found!.statement.reversals).toEqual([{ kind: "restore_bio", mediaId: null, resetDecisionId: reset, oldValueKept: false, resetRuleId: "R4" }]);
        const paragraphs = statementParagraphs(found!.statement);
        expect(paragraphs[1]).toBe(`${STATEMENT_WORDS.liftedField("bio")} ${STATEMENT_WORDS.field("bio")}`);
        expect(paragraphs.join(" ")).not.toContain(STATEMENT_WORDS.oldValueKeptR4);
        // The reset's own screen shows the content as erased under R4, and that it was reversed.
        const view = await authorDecisionView(moderationDeps(tx), account.id, reset);
        expect(view).toMatchObject({ content: { kind: "r4_redacted" }, reversedOn: expect.any(String) });
        expect(await one(tx, sql`select bio from profiles where id = ${account.id}::uuid`)).toEqual({ bio: "" });
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
    expect(await authCaseCounts(migrateDb)).toEqual(beforeAuth);
  });
});
