import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { textDigest, type IdentityRevealedParams, type RevealReasonCategory } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { ActiveStaffSession, AuthForModeration, NotifierFacts, StaffMessage, StaffStepUpConfirmed } from "../../src/auth";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { overview, readCase } from "../../src/moderation/cases";
import type { ModerationDeps } from "../../src/moderation/context";
import { reveal } from "../../src/moderation/reveal";
import { saveText } from "../../src/moderation/texts";
import { newUserWithDevice } from "./auth-fixtures";
import { aPost, ground, hex64, imagePost, intake, moderationDeps, newTestStaff, refusal, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

/**
 * Revealing who sent a report or a notice (3c design, section 7.3), against the real database: each refusal before
 * anything is written, the access row and the audit row that commit together, the reason text the audit function
 * confirms, the day's limit, the identity read only after the commit, and the mail to every staff account. Each test runs
 * inside one transaction that is rolled back, with a made-up confirmation: the audit row it leads to is one audit-verify
 * would refuse, so it never commits. A reveal that commits is confirmed by a real key, in the HTTP suite. The file's last
 * test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: revealing who sent a report", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let other: TestStaff;
  /** A personal account the operator linked to the moderator's staff account. */
  let linked: string;
  let before: Record<string, number>;

  async function counts(): Promise<Record<string, number>> {
    const [authSide] = await migrateDb.execute<Record<string, number>>(
      sql`select (select count(*)::int from auth.notifier_contacts) as notifier_contacts, (select count(*)::int from auth.notifier_confirmations) as notifier_confirmations,
                 (select count(*)::int from auth.notifier_suppressions) as notifier_suppressions, (select count(*)::int from auth.staff_personal_accounts) as staff_personal_accounts`,
    );
    return { ...(await rowCounts(apiDb)), ...authSide! };
  }

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    before = await counts();
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    other = await newTestStaff(authDb, migrateDb, repo, "moderator");
    linked = (await newUserWithDevice(repo)).user.id;
    await migrateDb.execute(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${mod.id}::uuid, ${linked}::uuid)`);
  }, 60_000);
  afterAll(async () => {
    await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${mod.id}::uuid`);
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      for (const staff of [mod, other]) await staffProfile(tx, staff);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);

  function sessionOf(staff: TestStaff): ActiveStaffSession {
    const now = new Date();
    return {
      sessionId: hex64(),
      handle: randomUUID(),
      userId: staff.id,
      keyId: staff.keyId,
      role: staff.role,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    };
  }

  /** The moderation module on the test's transaction, with an auth module that knows the notifiers the test names and records every staff mail. */
  function world(tx: DbTx, options: { accepted?: number } = {}) {
    const contacts = new Map<string, NotifierFacts>();
    const names = new Map<string, string>();
    const mailed: StaffMessage[] = [];
    const auth = {
      notifierFacts: async (ids: readonly string[]) => new Map(ids.map((id) => [id, contacts.get(id) ?? { found: false, named: false, contactGiven: false, confirmed: false, suppressed: false }])),
      notifierName: async (id: string) => names.get(id) ?? null,
      mailStaff: async (message: StaffMessage) => {
        mailed.push(message);
        return options.accepted ?? 3;
      },
    } as unknown as AuthForModeration;
    return { deps: moderationDeps(tx, { auth }), contacts, names, mailed };
  }

  /** A reason saved on the case as the console saves it; its digest is what a reveal's params name. */
  async function savedReason(deps: ModerationDeps, staff: TestStaff, caseId: string, text = `The notifier claims to be impersonated (${randomUUID()}).`) {
    const salt = hex64();
    return saveText(deps, sessionOf(staff), caseId, { kind: "reveal_reason", text, salt, digest: await textDigest(salt, text) });
  }

  /**
   * A confirmation of a reveal as the staff routes hand it over, made up: its hash and assertion are placeholders, so the
   * audit row it leads to is only ever written inside a transaction that is rolled back.
   */
  function confirmation(staff: TestStaff, itemId: string, params: IdentityRevealedParams, expiresAt = new Date(Date.now() + 10 * 60_000)): { session: ActiveStaffSession; confirmed: StaffStepUpConfirmed } {
    return {
      session: sessionOf(staff),
      confirmed: {
        action: "identity_revealed",
        target: { type: "intake_item", id: itemId },
        params,
        actionHash: hex64(),
        keyId: staff.keyId,
        assertion: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
        expiresAt,
      },
    };
  }
  /** A whole reveal of the item by the staff member, with this reason digest. */
  function revealAs(deps: ModerationDeps, staff: TestStaff, itemId: string, reasonDigest: string, reasonCategory: RevealReasonCategory = "impersonation_claim", expiresAt?: Date) {
    const { session, confirmed } = confirmation(staff, itemId, { reasonCategory, reasonDigest }, expiresAt);
    return reveal(deps, session, confirmed, { requestId: `req-${randomUUID()}` });
  }
  const reveals = async (tx: DbTx, staffId: string) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where staff_id = ${staffId}::uuid and kind = 'identity_revealed'`))[0]!.n;
  const confirmedAt = async (tx: DbTx, textId: string) => (await tx.execute<{ confirmed: boolean }>(sql`select confirmed_at is not null as confirmed from staff_texts where id = ${textId}::uuid`))[0]!.confirmed;
  const handleOf = async (tx: DbTx, id: string) => (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${id}::uuid`))[0]!.handle;
  /** A post reported under a rule by a signed-in reporter. */
  async function reported(tx: DbTx, authorId?: string) {
    const [p, reporter] = [await imagePost(tx, 0, authorId), await profile(tx)];
    const recorded = await intake(tx, ground.rule(reporter.id, "R1"), aPost(p.postId));
    return { ...p, reporter, caseId: recorded.items[0]!.caseId!, itemId: recorded.items[0]!.id };
  }

  test("a signed-in reporter's handle is revealed with the access row and the audit row of one transaction, which confirms the reason; every staff account is mailed, and the home screen and the case's history list it", async () => {
    await inWorld(async (tx) => {
      const { deps, mailed } = world(tx);
      const r = await reported(tx);
      const reason = await savedReason(deps, mod, r.caseId);
      const start = (await overview(deps)).reveals.total;

      expect(await revealAs(deps, mod, r.itemId, reason.digest, "abuse_of_reporting")).toEqual({ handle: r.reporter.handle, name: null });

      const [access] = await tx.execute<{ case_id: string; intake_item_id: string; text_id: string }>(sql`select case_id, intake_item_id, text_id from case_access_log where staff_id = ${mod.id}::uuid and kind = 'identity_revealed'`);
      expect({ ...access! }).toEqual({ case_id: r.caseId, intake_item_id: r.itemId, text_id: reason.id });
      const [audit] = await tx.execute<{ actor_id: string; target_type: string; metadata: unknown; has_step_up: boolean }>(
        sql`select actor_id, target_type, metadata, step_up is not null as has_step_up from audit_log where action = 'identity_revealed' and target_id = ${r.itemId}`,
      );
      // The chain holds ids, an enum and a digest: never the reason's words, the reporter or the case's content.
      expect({ ...audit! }).toEqual({ actor_id: mod.id, target_type: "intake_item", metadata: { params: { reasonCategory: "abuse_of_reporting", reasonDigest: reason.digest } }, has_step_up: true });
      expect(await confirmedAt(tx, reason.id)).toBe(true);

      await deps.background.settle();
      expect(mailed).toEqual([{ template: "moderation_reveal", handle: await handleOf(tx, mod.id), at: expect.any(Date), count: 1, limit: 10 }]);
      const seen = await overview(deps);
      expect(seen.reveals.total).toBe(start + 1);
      expect(seen.reveals.items[0]).toEqual({ at: expect.any(String), handle: await handleOf(tx, mod.id), caseId: r.caseId });
      const history = (await readCase(deps, sessionOf(other), r.caseId)).history.filter((entry) => entry.event === "reveal");
      expect(history).toEqual([expect.objectContaining({ refId: r.itemId, staffHandle: await handleOf(tx, mod.id) })]);
      // The reason was used: it confirms no second reveal, of this item or another.
      expect(await refusal(revealAs(deps, mod, r.itemId, reason.digest))).toBe("text_not_found");
      expect(await reveals(tx, mod.id)).toBe(1);
    });
  });

  test("a signed-out notifier is revealed by the name they gave, never an address; when the name was forgotten in between the answer names nobody and the reveal still stands", async () => {
    await inWorld(async (tx) => {
      const { deps, contacts, names, mailed } = world(tx);
      const p = await imagePost(tx, 0);
      const [named, forgotten] = [randomUUID(), randomUUID()];
      contacts.set(named, { found: true, named: true, contactGiven: true, confirmed: true, suppressed: false });
      contacts.set(forgotten, { found: true, named: true, contactGiven: false, confirmed: false, suppressed: false });
      names.set(named, "Ada Lovelace");
      const first = await intake(tx, { ...ground.illegal(null), contactId: named }, aPost(p.postId));
      const second = await intake(tx, { ...ground.illegal(null), contactId: forgotten }, aPost(p.postId));
      const caseId = first.items[0]!.caseId!;

      expect(await revealAs(deps, mod, first.items[0]!.id, (await savedReason(deps, mod, caseId)).digest, "legal_requirement")).toEqual({ handle: null, name: "Ada Lovelace" });
      expect(await revealAs(deps, mod, second.items[0]!.id, (await savedReason(deps, mod, caseId)).digest)).toEqual({ handle: null, name: null });
      expect(await reveals(tx, mod.id)).toBe(2);
      await deps.background.settle();
      expect(mailed.map((message) => (message.template === "moderation_reveal" ? message.count : null)).sort()).toEqual([1, 2]);
    });
  });

  test("each refusal comes before anything is written: an item that is none or has no case, a recused person, a source that names nobody, a reason that is not the person's own unused one on this case", async () => {
    await inWorld(async (tx) => {
      const { deps, contacts } = world(tx);
      const r = await reported(tx);
      const reason = await savedReason(deps, mod, r.caseId);
      const answers: Record<string, string | null> = {};

      // not_found: no such item; an item whose link named nothing live, which has no case.
      answers["no such item"] = await refusal(revealAs(deps, mod, randomUUID(), reason.digest));
      const [dead] = await tx.execute<{ id: string }>(sql`
        insert into intake_items (intake_id, case_id, target_type, target_id, position, lane, outcome)
        select intake_id, null, 'post', gen_random_uuid(), 2, 2, 'not_available' from intake_items where id = ${r.itemId}::uuid returning id`);
      answers["an item without a case"] = await refusal(revealAs(deps, mod, dead!.id, reason.digest));

      // staff_recused: the case's subject is an account linked to the person.
      await staffProfile(tx, { id: linked });
      const close = await reported(tx, linked);
      answers["a case whose subject is linked to the person"] = await refusal(revealAs(deps, mod, close.itemId, (await savedReason(deps, other, close.caseId)).digest));

      // reveal_refused: the path for child sexual abuse material, a finding, a reporter whose link is gone, a notifier
      // who gave no name, and a contact that is lost.
      const csam = await intake(tx, ground.csam(), aPost(r.postId));
      const finding = await intake(tx, ground.finding(other.id, "R1"), aPost(r.postId));
      const unnamed = randomUUID();
      contacts.set(unnamed, { found: true, named: false, contactGiven: true, confirmed: false, suppressed: false });
      const withAddress = await intake(tx, { ...ground.illegal(null), contactId: unnamed }, aPost(r.postId));
      const lost = await intake(tx, { ...ground.illegal(null), contactId: randomUUID() }, aPost(r.postId));
      const nameless = await intake(tx, ground.illegal(null), aPost(r.postId));
      const gone = await reported(tx);
      await tx.execute(sql`update intake_items set reporter_account_id = null where id = ${gone.itemId}::uuid`);
      answers["a notice on the path for child sexual abuse material"] = await refusal(revealAs(deps, mod, csam.items[0]!.id, reason.digest));
      answers["a moderator's finding"] = await refusal(revealAs(deps, mod, finding.items[0]!.id, reason.digest));
      answers["a notifier who gave an address and no name"] = await refusal(revealAs(deps, mod, withAddress.items[0]!.id, reason.digest));
      answers["a notifier whose contact is lost"] = await refusal(revealAs(deps, mod, lost.items[0]!.id, reason.digest));
      answers["a notifier who left no contact"] = await refusal(revealAs(deps, mod, nameless.items[0]!.id, reason.digest));
      answers["a reporter whose link is gone"] = await refusal(revealAs(deps, mod, gone.itemId, (await savedReason(deps, mod, gone.caseId)).digest));

      // text_not_found: a digest nobody saved; another person's reason; a text of another kind; a reason of another case.
      const salt = hex64();
      const note = await saveText(deps, sessionOf(mod), r.caseId, { kind: "note", text: "a note", salt, digest: await textDigest(salt, "a note") });
      const elsewhere = await reported(tx);
      answers["a digest nobody saved"] = await refusal(revealAs(deps, mod, r.itemId, hex64()));
      answers["another person's reason"] = await refusal(revealAs(deps, mod, r.itemId, (await savedReason(deps, other, r.caseId)).digest));
      answers["a note's digest"] = await refusal(revealAs(deps, mod, r.itemId, note.digest));
      answers["a reason saved on another case"] = await refusal(revealAs(deps, mod, r.itemId, (await savedReason(deps, mod, elsewhere.caseId)).digest));

      expect(answers).toEqual({
        "no such item": "not_found",
        "an item without a case": "not_found",
        "a case whose subject is linked to the person": "staff_recused",
        "a notice on the path for child sexual abuse material": "reveal_refused",
        "a moderator's finding": "reveal_refused",
        "a notifier who gave an address and no name": "reveal_refused",
        "a notifier whose contact is lost": "reveal_refused",
        "a notifier who left no contact": "reveal_refused",
        "a reporter whose link is gone": "reveal_refused",
        "a digest nobody saved": "text_not_found",
        "another person's reason": "text_not_found",
        "a note's digest": "text_not_found",
        "a reason saved on another case": "text_not_found",
      });
      expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where kind = 'identity_revealed' and staff_id = any(${`{${mod.id},${other.id}}`}::uuid[])`))[0]!.n).toBe(0);
      expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_log where action = 'identity_revealed' and actor_id = ${mod.id}::uuid and target_id = ${r.itemId}`))[0]!.n).toBe(0);
      expect(await confirmedAt(tx, reason.id)).toBe(false);
      // Nothing above spent the reason: the reveal it was saved for still goes through.
      expect(await revealAs(deps, mod, r.itemId, reason.digest)).toEqual({ handle: r.reporter.handle, name: null });
    }, migrateDb);
  });

  test("one person reveals at most the day's limit of sources: the next is refused with nothing written, its reason left unconfirmed, while another staff account's is accepted", async () => {
    await inWorld(async (tx) => {
      const { deps, mailed } = world(tx);
      await tx.execute(sql`update moderation_limits set reveals_per_day = 2 where id = 1`);
      const items = [await reported(tx), await reported(tx), await reported(tx)];
      for (const r of items.slice(0, 2)) await revealAs(deps, mod, r.itemId, (await savedReason(deps, mod, r.caseId)).digest);
      const third = items[2]!;
      const reason = await savedReason(deps, mod, third.caseId);
      const { session, confirmed } = confirmation(mod, third.itemId, { reasonCategory: "other", reasonDigest: reason.digest });
      const refused = await reveal(deps, session, confirmed, { requestId: "req-limit" }).catch((err: unknown) => err as { code: string; status: number; retryAfterSeconds?: number });
      expect(refused).toMatchObject({ code: "rate_limited", status: 429 });
      expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
      expect(await reveals(tx, mod.id)).toBe(2);
      expect(await confirmedAt(tx, reason.id)).toBe(false);
      // Another staff account has its own day.
      expect(await revealAs(deps, other, third.itemId, (await savedReason(deps, other, third.caseId)).digest)).toEqual({ handle: third.reporter.handle, name: null });
      await deps.background.settle();
      // Each mail gives the person's count that day and the limit.
      expect(mailed.map((message) => (message.template === "moderation_reveal" ? [message.count, message.limit] : null))).toEqual(expect.arrayContaining([[1, 2], [2, 2]]));
      expect(mailed).toHaveLength(3);
    }, migrateDb);
  });

  test("a confirmation whose time has run out, and one whose key was revoked since, reveal nothing and write nothing; a mail no address took changes nothing", async () => {
    // A staff account of this test's own: its key is revoked for good on the auth side.
    const leaving = await newTestStaff(authDb, migrateDb, repo, "moderator");
    await inWorld(async (tx) => {
      await staffProfile(tx, leaving);
      const { deps, mailed } = world(tx, { accepted: 0 });
      const r = await reported(tx);

      // The challenge expired before the transaction began: nothing is written, and no identity is answered.
      const lateReason = await savedReason(deps, mod, r.caseId);
      expect(await revealAs(deps, mod, r.itemId, lateReason.digest, "other", new Date(Date.now() - 1000))).toBe("late");
      expect(await reveals(tx, mod.id)).toBe(0);
      expect(await confirmedAt(tx, lateReason.id)).toBe(false);

      // The key no longer opens anything: the audit function refuses as the transaction's last statement, which undoes
      // the access row with it.
      const endedReason = await savedReason(deps, leaving, r.caseId);
      await authDb.execute(sql`update auth.staff_keys set revoked_at = now() where id = ${leaving.keyId}::uuid`);
      expect(await revealAs(deps, leaving, r.itemId, endedReason.digest)).toBe("ended");
      expect(await reveals(tx, leaving.id)).toBe(0);
      expect(await confirmedAt(tx, endedReason.id)).toBe(false);
      await deps.background.settle();
      expect(mailed).toEqual([]);

      // No address took the mail: the reveal stands and is answered all the same.
      expect(await revealAs(deps, mod, r.itemId, lateReason.digest)).toEqual({ handle: r.reporter.handle, name: null });
      await deps.background.settle();
      expect(mailed).toHaveLength(1);
      expect(await reveals(tx, mod.id)).toBe(1);
    });
  });

  test("the case answer offers nothing more than the summary before a reveal, and after it: the handle is in the reveal's answer alone", async () => {
    await inWorld(async (tx) => {
      const { deps } = world(tx);
      const r = await reported(tx);
      await revealAs(deps, mod, r.itemId, (await savedReason(deps, mod, r.caseId)).digest);
      const view = await readCase(deps, sessionOf(mod), r.caseId);
      expect(JSON.stringify(view)).not.toContain(r.reporter.handle);
      expect(view.items[0]!.source).toMatchObject({ kind: "reporter", label: "Reporter A" });
      // The reason is confirmed: it is no draft any more.
      expect(view.drafts).toEqual([]);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${mod.id}::uuid`);
    expect(await counts()).toEqual(before);
  });
});
