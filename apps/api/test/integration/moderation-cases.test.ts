import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  CaseView,
  OVERVIEW_LIST_MAX,
  QUEUE_PAGE_SIZE,
  QueuePage,
  SEAL_LIST_MAX,
  STAFF_TEXT_KINDS,
  SUSPECT_EARLIER_MONTHS,
  StaffOverview,
  snapshotDigest,
  textDigest,
  type FindingRequest,
  type StaffTextKind,
} from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { ActiveStaffSession, AuthForModeration, NotifierFacts, StaffMessage } from "../../src/auth";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { mediaForCases, type MediaForCases } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { caseImage, openFinding, overview, queue, readCase, takeSnapshot } from "../../src/moderation/cases";
import type { ModerationDeps } from "../../src/moderation/context";
import { recordIntake } from "../../src/moderation/intake";
import { queueRows } from "../../src/moderation/repo";
import { TEXT_SAVES_PER_MINUTE, ownTexts, saveText } from "../../src/moderation/texts";
import { webpBytes } from "../media/webp-bytes";
import { newUserWithDevice } from "./auth-fixtures";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { deciderWorld } from "./moderation-decide";
import {
  MINORS,
  TC,
  aPost,
  act,
  anAccount,
  decideIn,
  decisionParams,
  gate,
  ground,
  hex64,
  imagePost,
  intake,
  moderationDeps,
  newPostRow,
  postFrozen,
  refusal,
  removeFixtures,
  report,
  rowCounts,
  staffProfile,
  untilBlocked,
  type TestStaff,
  newTestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

const SEAL_WHILE_DECIDING = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] } as const;
const SEAL_FOR_GOOD = { kind: "final", ruleId: "R2", actions: [act("seal_media")] } as const;
const NO_SEAL = { kind: "final", outcome: "no_violation" } as const;
/** 3e: the standing columns of an action that is no standing measure and no strike, as the case answer carries them. */
const NO_STANDING = { days: null, announced: null, basis: null, restsOn: null, earliestStart: null, countsUntil: null, period: null, restedOnBy: null, reply: null } as const;

/**
 * The queue and the case, for staff (3c design, section 7.3), against the real database: the case answer with its
 * sources, its suspicion and its withheld content, the access log and the day's limits, the one door to a case's images,
 * the snapshot route, the saved texts, a moderator's own finding, the queue and the overview. Each test runs inside one
 * transaction that is rolled back, as korbat_api unless it needs a step only the migrator can take (moving a stored
 * time, a limit, a reporter's link); decisions go through the moderation module's own decide. The file's last test holds
 * it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the queue and the case, for staff", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  let other: TestStaff;
  /** A personal account the operator linked to the moderator's staff account. */
  let linked: string;
  let before: Record<string, number>;

  /** How many rows the moderation tables, the posts and profiles and the four auth tables of moderation hold. */
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
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    other = await newTestStaff(authDb, migrateDb, repo, "moderator");
    linked = (await newUserWithDevice(repo)).user.id;
    await migrateDb.execute(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${mod.id}::uuid, ${linked}::uuid)`);
  }, 60_000);
  afterAll(async () => {
    await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${mod.id}::uuid`);
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the given pool that is rolled back, with the three staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      for (const staff of [mod, admin, other]) await staffProfile(tx, staff);
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
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  const authorDeletes = (tx: DbTx, postId: string) => tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);

  /** A staff session as requireStaff hands it over. */
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

  /**
   * The moderation module on the test's transaction, with an auth module that knows the contacts the test names and
   * records every staff mail instead of sending it.
   */
  function world(tx: DbTx, overrides: Partial<ModerationDeps> = {}) {
    const contacts = new Map<string, NotifierFacts>();
    const mailed: StaffMessage[] = [];
    const auth = {
      notifierFacts: async (ids: readonly string[]) => new Map(ids.map((id) => [id, contacts.get(id) ?? { found: false, named: false, contactGiven: false, confirmed: false, suppressed: false }])),
      mailStaff: async (message: StaffMessage) => {
        mailed.push(message);
        return 3;
      },
      // The overview asks how many contacts the janitor is late with (its erasureOverdue): none here.
      overdueContacts: async () => 0,
    } as unknown as AuthForModeration;
    const deps = moderationDeps(tx, { auth, ...overrides });
    return { deps, contacts, mailed };
  }
  const handleOf = async (tx: DbTx, id: string) => (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${id}::uuid`))[0]!.handle;
  const accessRows = async (tx: DbTx, staffId: string, kind: string, caseId?: string) =>
    (await tx.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where staff_id = ${staffId}::uuid and kind = ${kind}::access_kind and (${caseId ?? null}::uuid is null or case_id = ${caseId ?? null}::uuid)`))[0]!.n;
  /** Saves a text as the console does: a fresh salt and the digest of the salt and the text. */
  async function save(deps: ModerationDeps, staff: TestStaff, caseId: string, kind: StaffTextKind, text: string) {
    const salt = hex64();
    return saveText(deps, sessionOf(staff), caseId, { kind, text, salt, digest: await textDigest(salt, text) });
  }

  describe("the case answer", () => {
    test("a rule report's case: the target as it stands, the snapshot with everything its digest covers, the item with its ground, and its sender as a summary that names nobody; the read is logged", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const p = await imagePost(tx, 2);
        const reporter = await profile(tx);
        const recorded = await intake(tx, { ...ground.rule(reporter.id, "R3"), explanation: "The reporter's own words about it." }, aPost(p.postId));
        const caseId = recorded.items[0]!.caseId!;

        const view = await readCase(deps, sessionOf(mod), caseId);
        expect(CaseView.safeParse(view).success, JSON.stringify(CaseView.safeParse(view).error?.issues)).toBe(true);
        expect(view).toMatchObject({ id: caseId, lane: 1, stateVersion: 0, intakeSeq: 1, answeredSeq: 0, closedAt: null, suspicion: null, imagesAllowed: true, decisions: [], appeals: [], drafts: [], notes: [], sealsDeclined: [] });
        expect(view.target).toEqual({ type: "post", id: p.postId, link: `${new URL(deps.config.APP_ORIGIN).origin}/post/${p.postId}`, authorHandle: await handleOf(tx, p.authorId), state: "visible", level: "visible", imported: null });

        // The snapshot is shown, and recomputes from the answer alone to the digest stored with it.
        expect(view.snapshots).toHaveLength(1);
        const snapshot = view.snapshots[0]!;
        if (snapshot.withheld) throw new Error("the snapshot is shown");
        expect(snapshot).toMatchObject({ targetType: "post", targetId: p.postId, postState: "visible", body: "a post", displayName: null, bio: null, handle: null });
        expect(snapshot.media).toEqual(p.mediaIds.map((id, position) => ({ id, alt: `image ${position + 1}`, width: 1200, height: 800 })));
        expect(await snapshotDigest(snapshot)).toBe(snapshot.digest);

        expect(view.items).toHaveLength(1);
        expect(view.items[0]).toMatchObject({
          id: recorded.items[0]!.id,
          seq: 1,
          position: 1,
          lane: 1,
          link: view.target.type === "post" ? view.target.link : "",
          ruleId: "R3",
          allegesIllegal: false,
          csam: false,
          category: TC,
          explanation: "The reporter's own words about it.",
          mediaId: null,
          suspect: false,
          quotedByPosition: null,
          quotedCaseId: null,
          reexaminesPosition: null,
          reexaminesYourDecision: false,
          outcome: null,
          answeredBy: null,
          erased: false,
          source: { kind: "reporter", label: "Reporter A", accountAge: "under_1_month", itemsFiled: "1", actedOn: "none_decided", answeredUnseen: "none", named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false },
        });
        // Neither the reporter's account nor its handle is anywhere in the answer.
        const text = JSON.stringify(view);
        expect(text).not.toContain(reporter.id);
        expect(text).not.toContain(reporter.handle);
        expect(view.history.map((entry) => entry.event)).toEqual(expect.arrayContaining(["item", "snapshot"]));
        // One access row for the read; a second read of the same case writes a second.
        expect(await accessRows(tx, mod.id, "case_opened", caseId)).toBe(1);
        await readCase(deps, sessionOf(mod), caseId);
        expect(await accessRows(tx, mod.id, "case_opened", caseId)).toBe(2);
        expect(await refusal(readCase(deps, sessionOf(mod), randomUUID()))).toBe("not_found");
      });
    });

    test("each source is a summary: reporters get letters in the order of their first items in the case; a notifier is what was given, or that the contact is lost; the path for child sexual abuse material is anonymous; a finding was found by a moderator; a reporter whose link is gone is only that", async () => {
      await inWorld(async (tx) => {
        const { deps, contacts } = world(tx);
        const p = await imagePost(tx, 0);
        const [first, second] = [await profile(tx), await profile(tx)];
        const [known, lost] = [randomUUID(), randomUUID()];
        contacts.set(known, { found: true, named: true, contactGiven: true, confirmed: false, suppressed: true });
        await intake(tx, ground.rule(first.id, "R1"), aPost(p.postId));
        await intake(tx, ground.illegal(second.id), aPost(p.postId));
        // The first reporter again, on the other ground: the same letter.
        await intake(tx, ground.illegal(first.id), aPost(p.postId));
        await intake(tx, { ...ground.illegal(null), contactId: known }, aPost(p.postId));
        await intake(tx, { ...ground.illegal(null), contactId: lost }, aPost(p.postId));
        await intake(tx, ground.illegal(null), aPost(p.postId));
        await intake(tx, ground.csam(), aPost(p.postId));
        const caseId = (await intake(tx, ground.finding(other.id, "R1"), aPost(p.postId))).items[0]!.caseId!;
        // The second reporter's link is forgotten, as after their account's deletion: only the migrator's functions do that.
        await tx.execute(sql`update intake_items set reporter_account_id = null where reporter_account_id = ${second.id}::uuid`);

        const view = await readCase(deps, sessionOf(mod), caseId);
        const none = { accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null };
        const noContact = { named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false };
        expect(view.items.map((item) => item.source)).toEqual([
          expect.objectContaining({ kind: "reporter", label: "Reporter A", itemsFiled: "2_to_9" }),
          { kind: "unlinked", label: "A signed-in reporter no longer linked", ...none, ...noContact },
          expect.objectContaining({ kind: "reporter", label: "Reporter A", itemsFiled: "2_to_9" }),
          { kind: "notifier", label: "A notifier", ...none, named: true, contactGiven: true, confirmed: false, suppressed: true, contactLost: false },
          { kind: "notifier", label: "A notifier", ...none, named: false, contactGiven: false, confirmed: false, suppressed: false, contactLost: true },
          { kind: "notifier", label: "A notifier", ...none, named: false, contactGiven: false, confirmed: false, suppressed: false, contactLost: false },
          { kind: "anonymous", label: "Anonymous", ...none, ...noContact },
          { kind: "staff", label: "Found by a moderator", ...none, ...noContact },
        ]);
        // No contact's id leaves the server: the summary is all the console gets.
        expect(JSON.stringify(view)).not.toContain(known);
        expect(JSON.stringify(view)).not.toContain(lost);

        // On another case the same person is lettered by that case's own order.
        const q = await imagePost(tx, 0);
        const third = await profile(tx);
        await intake(tx, ground.rule(third.id, "R1"), aPost(q.postId));
        const again = (await intake(tx, ground.rule(first.id, "R1"), aPost(q.postId))).items[0]!.caseId!;
        expect((await readCase(deps, sessionOf(mod), again)).items.map((item) => item.source.label)).toEqual(["Reporter A", "Reporter B"]);
      }, migrateDb);
    });

    test("a reporter's bands are computed over the reporter's own released items: an item answered without action while nobody could open the images is counted apart, never as decided without action", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const release = () => tx.execute(sql`select public.release_outcomes(now() - interval '1 hour')`);
        const decidedAgo = (decisionId: string) => tx.execute(sql`update decisions set decided_at = now() - interval '5 hours' where id = ${decisionId}::uuid`);
        // Whatever other suites left releasable goes first.
        await release();
        const reporter = await profile(tx);

        // A post frozen through its author's account's case: a moderator's no-action answer to the rule report is unseen.
        const frozen = await imagePost(tx, 1);
        const unseenCase = (await intake(tx, ground.rule(reporter.id, "R1"), aPost(frozen.postId))).items[0]!.caseId!;
        await report(tx, anAccount(frozen.authorId), "csam");
        await decidedAgo(await decideIn(tx, mod, unseenCase, NO_SEAL));
        await release();
        let view = await readCase(deps, sessionOf(mod), unseenCase);
        expect(view.decisions).toEqual([expect.objectContaining({ kind: "final", outcome: "no_violation", unseen: true, suspect: false })]);
        expect(view.items[0]!.source).toMatchObject({ itemsFiled: "1", actedOn: "none_decided", answeredUnseen: "1" });

        // A second report, acted on, and a third without action with the images in sight: one of two decided items acted on.
        const removed = await imagePost(tx, 0);
        const removedCase = (await intake(tx, ground.rule(reporter.id, "R1"), aPost(removed.postId))).items[0]!.caseId!;
        await decidedAgo(await decideIn(tx, mod, removedCase, { kind: "final", actions: [act("remove")] }));
        const cleared = await imagePost(tx, 0);
        const clearedCase = (await intake(tx, ground.rule(reporter.id, "R1"), aPost(cleared.postId))).items[0]!.caseId!;
        await decidedAgo(await decideIn(tx, mod, clearedCase, NO_SEAL));
        await release();
        view = await readCase(deps, sessionOf(mod), clearedCase);
        expect(view.items[0]!.source).toMatchObject({ kind: "reporter", label: "Reporter A", itemsFiled: "2_to_9", actedOn: "half_or_more", answeredUnseen: "1" });
        expect(view.items[0]).toMatchObject({ outcome: "no_violation", answeredBy: view.decisions[0]!.id });
        // An account made thirteen months ago is in the oldest band.
        await tx.execute(sql`update profiles set created_at = now() - interval '13 months' where id = ${reporter.id}::uuid`);
        expect((await readCase(deps, sessionOf(mod), clearedCase)).items[0]!.source.accountAge).toBe("over_12_months");
      }, migrateDb);
    });

    test("a report of child sexual abuse material: suspicion with what the case reaches, no image allowed, the quoted post's case linked from the quoting post's item and the added item marked; a seal lists what it covers; an answer without a seal is counted as an earlier answer", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const quoted = await imagePost(tx, 2);
        const quoting = await imagePost(tx, 1, undefined, { quoteOfId: quoted.postId });
        const recorded = await intake(tx, ground.csam(), aPost(quoting.postId));
        const [named, added] = [recorded.items.find((item) => item.position === 1)!, recorded.items.find((item) => item.position === 11)!];

        const quotingView = await readCase(deps, sessionOf(mod), named.caseId!);
        expect(quotingView).toMatchObject({ lane: 0, imagesAllowed: false });
        expect(quotingView.suspicion).toEqual({
          open: true,
          reach: { posts: 1, images: 1, sealed: 0, served: 1, newestPostOn: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) },
          earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } },
        });
        expect(quotingView.items[0]).toMatchObject({ suspect: true, csam: true, quotedByPosition: null, quotedCaseId: added.caseId, source: { kind: "anonymous" } });
        const quotedView = await readCase(deps, sessionOf(mod), added.caseId!);
        expect(quotedView.items[0]).toMatchObject({ suspect: true, position: 11, quotedByPosition: 1, quotedCaseId: null });
        expect(quotedView.suspicion?.reach).toMatchObject({ posts: 1, images: 2, sealed: 0, served: 2 });

        // Whoever is on duty seals the quoted post's images while deciding: the answer lists what the seal covers.
        const seal = await decideIn(tx, mod, added.caseId!, SEAL_WHILE_DECIDING);
        const sealedView = await readCase(deps, sessionOf(mod), added.caseId!);
        expect(sealedView.suspicion).toMatchObject({ open: true, reach: { posts: 1, images: 2, sealed: 2, served: 0 } });
        // Text is never sealed: the post keeps its state and level, and its snapshot is shown.
        expect(sealedView).toMatchObject({ imagesAllowed: false, target: { state: "visible", level: "visible" } });
        expect(sealedView.snapshots[0]).toMatchObject({ withheld: false, body: "a post" });
        expect(sealedView.decisions).toEqual([
          expect.objectContaining({ id: seal, kind: "interim", outcome: "restricted", ruleId: "R2", category: MINORS, suspect: true, unseen: false, needsAdmin: false, staffHandle: await handleOf(tx, mod.id) }),
        ]);
        expect(sealedView.decisions[0]!.actions).toEqual([
          { id: expect.any(String), kind: "seal_media", mediaId: null, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, ...NO_STANDING, sealed: { posts: 1, images: 2, deletedPosts: 0, list: [{ postId: quoted.postId, createdAt: expect.any(String), images: 2 }] } },
        ]);
        expect(sealedView.decisions[0]!.facts).toEqual(expect.stringContaining("facts"));

        // An admin answers without a seal: the seal has ended, the case is closed, and its images may be opened again.
        await decideIn(tx, admin, added.caseId!, NO_SEAL);
        const answered = await readCase(deps, sessionOf(mod), added.caseId!);
        expect(answered).toMatchObject({ imagesAllowed: true, suspicion: { open: false, reach: { sealed: 0, served: 2 } } });
        expect(answered.closedAt).not.toBeNull();
        // The seal taken while deciding ended by itself with that answer: no reversal lifted it. (Both decisions carry the
        // one time of this test's transaction, so the seal's is found by its id.)
        expect(answered.decisions.find((decision) => decision.id === seal)!.actions[0]).toMatchObject({ kind: "seal_media", inForce: false, liftedBy: null });
        // The answer counts as an earlier one, about the target and about its author, on the case itself and on the next
        // report of this kind; an answer with a seal about another post of the author does not.
        const today = new Date().toISOString().slice(0, 10);
        expect(answered.suspicion?.earlier).toEqual({ target: { count: 1, lastOn: today, imagesOpenedOn: null }, author: { count: 1, lastOn: today } });
        const sealedForGood = await imagePost(tx, 1, quoted.authorId);
        const goodCase = (await report(tx, aPost(sealedForGood.postId), "csam")).caseId;
        await decideIn(tx, admin, goodCase, SEAL_FOR_GOOD);
        const next = (await report(tx, aPost(quoted.postId), "csam")).caseId;
        const nextView = await readCase(deps, sessionOf(mod), next);
        expect(nextView.suspicion).toMatchObject({ open: true, earlier: { target: { count: 1, lastOn: today }, author: { count: 1, lastOn: today } } });
        // The sealed post's own closed case: the seal for good stands, so its images stay out of staff's sight.
        expect(await readCase(deps, sessionOf(mod), goodCase)).toMatchObject({ imagesAllowed: false, suspicion: { open: false, earlier: { target: { count: 0 }, author: { count: 1 } } } });
      });
    });

    test("an earlier answer without a seal is counted for twelve months and no longer: one decided eleven months ago is, one moved past twelve is not, about the target and about its author alike", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        expect(SUSPECT_EARLIER_MONTHS).toBe(12);
        const p = await imagePost(tx, 1);
        const answer = await decideIn(tx, admin, (await report(tx, aPost(p.postId), "csam")).caseId, NO_SEAL);
        // Another post of the same author, answered the same way: it counts for the author, never for this target.
        const sibling = await imagePost(tx, 1, p.authorId);
        const siblingAnswer = await decideIn(tx, admin, (await report(tx, aPost(sibling.postId), "csam")).caseId, NO_SEAL);
        const next = (await report(tx, aPost(p.postId), "csam")).caseId;
        const earlier = async () => (await readCase(deps, sessionOf(mod), next)).suspicion!.earlier;
        // Only the migrator moves a decision's time.
        const decidedAgo = (id: string, ago: string) => tx.execute(sql`update decisions set decided_at = now() - ${ago}::interval where id = ${id}::uuid`);
        const dayOf = async (id: string) => (await tx.execute<{ day: string }>(sql`select to_char(decided_at at time zone 'UTC', 'YYYY-MM-DD') as day from decisions where id = ${id}::uuid`))[0]!.day;

        await decidedAgo(answer, "11 months");
        expect(await earlier()).toEqual({ target: { count: 1, lastOn: await dayOf(answer), imagesOpenedOn: null }, author: { count: 2, lastOn: await dayOf(siblingAnswer) } });
        await decidedAgo(answer, "12 months 1 day");
        expect(await earlier()).toEqual({ target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 1, lastOn: await dayOf(siblingAnswer) } });
        await decidedAgo(siblingAnswer, "13 months");
        expect(await earlier()).toEqual({ target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } });
      }, migrateDb);
    });

    test("an account's case reaches every image on the account's posts, as it stands at each read, and never shows an image; a seal's list in the answer stops at SEAL_LIST_MAX posts", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const author = await profile(tx);
        await imagePost(tx, 2, author.id);
        const { caseId } = await report(tx, anAccount(author.id, author.handle), "csam");
        let view = await readCase(deps, sessionOf(mod), caseId);
        expect(view).toMatchObject({ imagesAllowed: false, target: { type: "account", id: author.id, handle: author.handle, deleted: false } });
        expect(view.suspicion).toMatchObject({ open: true, reach: { posts: 1, images: 2, sealed: 0, served: 2 }, earlier: { target: { count: 0, imagesOpenedOn: null } } });
        // The account posts again: the case reaches the new image too.
        await imagePost(tx, 1, author.id);
        expect((await readCase(deps, sessionOf(mod), caseId)).suspicion?.reach).toMatchObject({ posts: 2, images: 3, served: 3 });

        // SEAL_LIST_MAX and one more posts with an image each, written in three statements.
        const more = SEAL_LIST_MAX - 1;
        await tx.execute(sql`insert into posts (author_id, body, created_at) select ${author.id}::uuid, 'post ' || n, now() - interval '20 days' - n * interval '1 minute' from generate_series(1, ${more}::int) n`);
        await tx.execute(sql`insert into post_media (owner_id, status, width, height, blurhash) select ${author.id}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL' from generate_series(1, ${more}::int)`);
        await tx.execute(sql`
          update post_media m set post_id = pairs.post_id, position = 0, alt_text = 'one of many'
            from (select i.id as media_id, p.id as post_id
                    from (select id, row_number() over (order by id) as n from post_media where owner_id = ${author.id}::uuid and post_id is null) i
                    join (select id, row_number() over (order by id) as n from posts where author_id = ${author.id}::uuid and body like 'post %') p on p.n = i.n) pairs
           where m.id = pairs.media_id`);
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        view = await readCase(deps, sessionOf(mod), caseId);
        const sealed = view.decisions[0]!.actions[0]!.sealed!;
        expect(sealed).toMatchObject({ posts: SEAL_LIST_MAX + 1, images: SEAL_LIST_MAX + 2, deletedPosts: 0 });
        expect(sealed.list).toHaveLength(SEAL_LIST_MAX);
        // Oldest post first.
        expect(sealed.list.map((row) => row.createdAt)).toEqual([...sealed.list.map((row) => row.createdAt)].sort());
        expect(CaseView.safeParse(view).success).toBe(true);
      });
    });

    test("content that was erased since is withheld by the database's one predicate: the snapshot carries its id, time and digest and nothing else", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId));
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${p.postId}::uuid`);
        const view = await readCase(deps, sessionOf(mod), caseId);
        expect(view.snapshots).toHaveLength(1);
        expect(Object.keys(view.snapshots[0]!).sort()).toEqual(["digest", "id", "takenAt", "withheld"]);
        expect(view.snapshots[0]!.withheld).toBe(true);
        expect(JSON.stringify(view)).not.toContain("a post");
      }, migrateDb);
    });
  });

  describe("recusal", () => {
    test("a person too close to the case's subject is refused the case, its images, its snapshots and its texts, on a report's case and on a finding's case alike, with nothing logged or stored; a case that only a reporter close to them reported is not refused", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        await staffProfile(tx, { id: linked });
        // The linked account's own post, and its profile.
        const own = await imagePost(tx, 1, linked);
        const postCase = (await report(tx, aPost(own.postId))).caseId;
        const accountCase = (await report(tx, anAccount(linked))).caseId;
        // An account the linked account follows.
        const followed = await imagePost(tx, 0);
        await tx.execute(sql`insert into follows (follower_id, followee_id) values (${linked}::uuid, ${followed.authorId}::uuid)`);
        const followedCase = (await report(tx, aPost(followed.postId))).caseId;
        // A case that no report opened: another moderator's own finding about a second post of the linked account.
        const found = await imagePost(tx, 0, linked);
        const findingCase = (await openFinding(deps, sessionOf(other), { target: { kind: "post", id: found.postId }, ground: "rule", ruleId: "R1", category: TC })).caseId;
        const session = sessionOf(mod);
        for (const caseId of [postCase, accountCase, followedCase, findingCase]) {
          expect(await refusal(readCase(deps, session, caseId)), "case").toBe("staff_recused");
          expect(await refusal(caseImage(deps, session, caseId, own.mediaIds[0]!, "small")), "image").toBe("staff_recused");
          expect(await refusal(takeSnapshot(deps, session, caseId)), "snapshot").toBe("staff_recused");
          expect(await refusal(save(deps, mod, caseId, "note", "a note")), "text").toBe("staff_recused");
          expect(await refusal(ownTexts(deps, session, caseId)), "texts").toBe("staff_recused");
        }
        expect(await accessRows(tx, mod.id, "case_opened")).toBe(0);
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(0);
        expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where author_id = ${mod.id}::uuid`))[0]!.n).toBe(0);
        // Another staff member opens them.
        expect((await readCase(deps, sessionOf(other), postCase)).id).toBe(postCase);
        expect((await readCase(deps, sessionOf(other), findingCase)).id).toBe(findingCase);

        // A case the linked account reported, about a stranger: the read is not refused, since the check never looks at
        // who reported.
        const stranger = await imagePost(tx, 0);
        const reported = (await intake(tx, ground.rule(linked, "R1"), aPost(stranger.postId))).items[0]!.caseId!;
        expect((await readCase(deps, session, reported)).id).toBe(reported);
      });
    });

    test("what a subject did towards the person's linked account refuses nothing: a subject who follows it, blocks it or replied to a post of it has their case opened and decided by that person; what the linked account did towards the subject does", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        await staffProfile(tx, { id: linked });
        const linkedPost = await newPostRow(tx, linked);
        const session = sessionOf(mod);
        // Anyone can follow, block or answer anyone: one click must not put an account beyond a staff member.
        const towards: [string, (subjectId: string) => Promise<unknown>][] = [
          ["follows", (subjectId) => tx.execute(sql`insert into follows (follower_id, followee_id) values (${subjectId}::uuid, ${linked}::uuid)`)],
          ["blocks", (subjectId) => tx.execute(sql`insert into blocks (blocker_id, blocked_id) values (${subjectId}::uuid, ${linked}::uuid)`)],
          ["replied to", (subjectId) => newPostRow(tx, subjectId, { replyToId: linkedPost })],
        ];
        for (const [what, did] of towards) {
          const subject = await imagePost(tx, 0);
          await did(subject.authorId);
          // The case is about another post of the subject than a reply to the linked account.
          const { caseId } = await report(tx, aPost(subject.postId));
          expect((await readCase(deps, session, caseId)).id, what).toBe(caseId);
          expect(await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] }), what).toEqual(expect.any(String));
          expect((await readCase(deps, session, caseId)).decisions, what).toHaveLength(1);
        }
        expect(await accessRows(tx, mod.id, "case_opened")).toBe(6);
        // The other way round it counts: the linked account replied to a post of the subject.
        const answered = await imagePost(tx, 0);
        await newPostRow(tx, linked, { replyToId: answered.postId });
        const { caseId } = await report(tx, aPost(answered.postId));
        expect(await refusal(readCase(deps, session, caseId))).toBe("staff_recused");
        // And so does the post the case judges: a case about the very reply to the linked account's post is not theirs to
        // open, though a case about anything else its author wrote is.
        const replier = await profile(tx);
        const reply = await newPostRow(tx, replier.id, { replyToId: linkedPost });
        const replyCase = (await report(tx, aPost(reply))).caseId;
        expect(await refusal(readCase(deps, session, replyCase))).toBe("staff_recused");
        expect((await readCase(deps, sessionOf(other), replyCase)).target).toMatchObject({ type: "post", id: reply });
        expect(await accessRows(tx, mod.id, "case_opened")).toBe(6);
      });
    });
  });

  describe("the access log and the day's limit", () => {
    test("a person who has opened as many different cases as the day allows is refused every other case, with nothing written, and every staff account is told once; a case already opened today is never refused; a snapshot at the limit answers its id and no content", async () => {
      await inWorld(async (tx) => {
        const { deps, mailed } = world(tx);
        await tx.execute(sql`update moderation_limits set case_opens_per_day = 2 where id = 1`);
        const cases: string[] = [];
        for (let i = 0; i < 4; i++) cases.push((await report(tx, aPost((await imagePost(tx, 0)).postId))).caseId);
        const session = sessionOf(mod);
        await readCase(deps, session, cases[0]!);
        await readCase(deps, session, cases[1]!);
        // Two different cases today: the third is refused, and so is the fourth.
        const refused = await readCase(deps, session, cases[2]!).catch((err: unknown) => err as { code: string; status: number; retryAfterSeconds?: number });
        expect(refused).toMatchObject({ code: "rate_limited", status: 429 });
        expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
        expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeLessThanOrEqual(86_400);
        expect(await refusal(readCase(deps, session, cases[3]!))).toBe("rate_limited");
        expect(await accessRows(tx, mod.id, "case_opened", cases[2]!)).toBe(0);
        expect(await accessRows(tx, mod.id, "case_opened", cases[3]!)).toBe(0);
        // A case opened earlier today is read again, as often as the page reloads.
        expect((await readCase(deps, session, cases[0]!)).id).toBe(cases[0]);
        expect(await accessRows(tx, mod.id, "case_opened", cases[0]!)).toBe(2);
        // The snapshot route answers an id and a digest and nothing else, also for a case not opened today.
        const taken = await takeSnapshot(deps, session, cases[2]!);
        expect(Object.keys(taken).sort()).toEqual(["digest", "id"]);
        expect(await refusal(readCase(deps, session, cases[2]!))).toBe("rate_limited");
        expect(await accessRows(tx, mod.id, "case_opened", cases[2]!)).toBe(0);
        // Every staff account is mailed once that day, however often the person is refused.
        await deps.background.settle();
        expect(mailed).toEqual([{ template: "moderation_reads", handle: await handleOf(tx, mod.id), limit: 2 }]);
        // Another staff account has its own day.
        expect((await readCase(deps, sessionOf(other), cases[2]!)).id).toBe(cases[2]);
      }, migrateDb);
    });

    test("when no address took the mail, the next refused read sends it again", async () => {
      await inWorld(async (tx) => {
        const attempts: StaffMessage[] = [];
        let accepted = 0;
        const auth = {
          mailStaff: async (message: StaffMessage) => {
            attempts.push(message);
            return accepted;
          },
        } as unknown as AuthForModeration;
        const deps = moderationDeps(tx, { auth });
        await tx.execute(sql`update moderation_limits set case_opens_per_day = 0 where id = 1`);
        const { caseId } = await report(tx, aPost((await imagePost(tx, 0)).postId));
        expect(await refusal(readCase(deps, sessionOf(mod), caseId))).toBe("rate_limited");
        await deps.background.settle();
        accepted = 2;
        expect(await refusal(readCase(deps, sessionOf(mod), caseId))).toBe("rate_limited");
        await deps.background.settle();
        expect(await refusal(readCase(deps, sessionOf(mod), caseId))).toBe("rate_limited");
        await deps.background.settle();
        expect(attempts.map((message) => message.template)).toEqual(["moderation_reads", "moderation_reads"]);
      }, migrateDb);
    });
  });

  describe("images in the console (gate V, the console route's half of the readers)", () => {
    /** Writes the two files of each ready image as the worker would: WebP headers that state the sizes of their rows. */
    function webp(h: MediaHarness, ids: readonly string[]) {
      for (const id of ids) {
        writeFileSync(h.files.store.image(id, "large"), webpBytes("VP8X", 2048, 1536, `large of ${id}`));
        writeFileSync(h.files.store.image(id, "small"), webpBytes("VP8 ", 1024, 768, `small of ${id}`));
      }
    }
    /** What the image route's flow answers, with the file it opened closed again: its size, or the refusal's code. */
    async function view(deps: ModerationDeps, staff: TestStaff, caseId: string, mediaId: string, size: "small" | "large" = "small"): Promise<number | string | null> {
      try {
        const file = await caseImage(deps, sessionOf(staff), caseId, mediaId, size);
        await file.handle.close();
        return file.size;
      } catch (err) {
        return refusal(Promise.reject(err));
      }
    }
    const storeWorld = (tx: DbTx, h: MediaHarness) => world(tx, { media: mediaForCases(h.deps) });

    test("an image of the case's own post is served in either size and logged; an image of another post, an account's case and an unknown case answer the same refusal and log nothing", async () => {
      await withStore(async (tx, h) => {
        const { deps } = storeWorld(tx, h);
        const author = await h.established();
        const [p, elsewhere] = [await h.postWithImages(author.id, 2), await h.postWithImages(author.id, 1)];
        webp(h, [...p.mediaIds, ...elsewhere.mediaIds]);
        const postCase = (await report(tx, aPost(p.postId))).caseId;
        const accountCase = (await report(tx, anAccount(author.id, author.handle))).caseId;

        expect(await view(deps, mod, postCase, p.mediaIds[0]!, "small")).toBe(webpBytes("VP8 ", 1024, 768, `small of ${p.mediaIds[0]}`).length);
        expect(await view(deps, mod, postCase, p.mediaIds[1]!, "large")).toBe(webpBytes("VP8X", 2048, 1536, `large of ${p.mediaIds[1]}`).length);
        expect(await accessRows(tx, mod.id, "image_viewed", postCase)).toBe(2);
        const [logged] = await tx.execute<{ media_id: string }>(sql`select media_id from case_access_log where kind = 'image_viewed' and case_id = ${postCase}::uuid order by id limit 1`);
        expect(logged!.media_id).toBe(p.mediaIds[0]);

        // Not this case's image, an account's case (which shows no image), an image nobody has, a case nobody has.
        expect(await view(deps, mod, postCase, elsewhere.mediaIds[0]!)).toBe("image_refused");
        expect(await view(deps, mod, accountCase, p.mediaIds[0]!)).toBe("image_refused");
        expect(await view(deps, mod, postCase, randomUUID())).toBe("image_refused");
        expect(await view(deps, mod, randomUUID(), p.mediaIds[0]!)).toBe("not_found");
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(2);
        // The overview counts the day's views by staff handle.
        expect((await overview(deps, sessionOf(mod))).imagesToday).toContainEqual({ handle: await handleOf(tx, mod.id), count: 2 });
      });
    });

    test("an image that no unerased snapshot of the case lists is refused before the media module is asked: another post's image and an unknown id open no file; the case's own image is asked for, and an image the media module answers for another post is refused with its file closed", async () => {
      await withStore(async (tx, h) => {
        const real = mediaForCases(h.deps);
        const asked: string[] = [];
        /** The post the media module's answer names, when a step of the test replaces it. */
        let answeredPost: string | null = null;
        const opened: { handle: { fd: number } }[] = [];
        const media: MediaForCases = {
          ...real,
          staffImage: async (mediaId, size) => {
            asked.push(mediaId);
            const image = await real.staffImage(mediaId, size);
            if (!image || image === "matched") return image;
            opened.push(image.file);
            return answeredPost === null ? image : { ...image, postId: answeredPost };
          },
        };
        const { deps } = world(tx, { media });
        const author = await h.established();
        const [p, elsewhere] = [await h.postWithImages(author.id, 1), await h.postWithImages(author.id, 1)];
        webp(h, [...p.mediaIds, ...elsewhere.mediaIds]);
        const image = p.mediaIds[0]!;
        const served = webpBytes("VP8 ", 1024, 768, `small of ${image}`).length;
        const postCase = (await report(tx, aPost(p.postId))).caseId;
        await report(tx, aPost(elsewhere.postId));

        // Neither is listed by a snapshot of this case: the refusal comes before any file is looked for, so an id that
        // names nothing and one that names another post's image take the same steps.
        expect(await view(deps, mod, postCase, elsewhere.mediaIds[0]!)).toBe("image_refused");
        expect(await view(deps, mod, postCase, randomUUID())).toBe("image_refused");
        expect(asked).toEqual([]);
        // The case's own image, in either spelling of its id.
        expect(await view(deps, mod, postCase, image)).toBe(served);
        expect(await view(deps, mod, postCase, image.toUpperCase())).toBe(served);
        expect(asked).toEqual([image, image]);
        // The comparison after the call stays: an answer that names another post is refused, and the file it opened is closed.
        answeredPost = elsewhere.postId;
        expect(await view(deps, mod, postCase, image)).toBe("image_refused");
        expect(opened).toHaveLength(3);
        expect(opened[2]!.handle.fd).toBe(-1);
        answeredPost = null;
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(2);

        // The case's evidence is erased, as the retention job will erase it: its snapshot lists nothing any more.
        await tx.execute(sql`update evidence_snapshots set erased_at = now(), body = null, media = null, display_name = null, bio = null, salt = null where case_id = ${postCase}::uuid`);
        expect(await view(deps, mod, postCase, image)).toBe("image_refused");
        expect(asked).toHaveLength(3);
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(2);
      }, migrateDb);
    });

    test("an erased image, and an image of a post whose content was erased, is served to nobody: one refusal, and nothing logged", async () => {
      await withStore(async (tx, h) => {
        const { deps } = storeWorld(tx, h);
        const author = await h.established();
        const [one, two] = [await h.postWithImages(author.id, 2), await h.postWithImages(author.id, 1)];
        webp(h, [...one.mediaIds, ...two.mediaIds]);
        const [caseOne, caseTwo] = [(await report(tx, aPost(one.postId))).caseId, (await report(tx, aPost(two.postId))).caseId];
        // Only the migrator's erasure sets either mark. The image's own row is erased: the other image of the post is served.
        await tx.execute(sql`update post_media set erased_at = now() where id = ${one.mediaIds[0]!}::uuid`);
        expect(await view(deps, mod, caseOne, one.mediaIds[0]!)).toBe("image_refused");
        expect(await view(deps, admin, caseOne, one.mediaIds[0]!, "large")).toBe("image_refused");
        expect(await view(deps, mod, caseOne, one.mediaIds[1]!)).toBe(webpBytes("VP8 ", 1024, 768, `small of ${one.mediaIds[1]}`).length);
        // The post's content is erased: none of its images is served, though its files are still in the store.
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${two.postId}::uuid`);
        expect(await view(deps, mod, caseTwo, two.mediaIds[0]!)).toBe("image_refused");
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(1);
        expect(await accessRows(tx, admin.id, "image_viewed")).toBe(0);
      }, migrateDb);
    });

    test("while a suspect item about the post, about its author's account or about a post that quotes it is unanswered, no staff member is served its images on any case, open or closed; after an admin's answer without a seal they are served again, and the case says on which day staff last looked", async () => {
      await withStore(async (tx, h) => {
        const { deps } = storeWorld(tx, h);
        const author = await h.established();
        const p = await h.postWithImages(author.id, 1);
        webp(h, p.mediaIds);
        const image = p.mediaIds[0]!;
        const served = webpBytes("VP8 ", 1024, 768, `small of ${image}`).length;

        // A closed R1 case about the post, which served its image while it was open.
        const closedCase = (await report(tx, aPost(p.postId))).caseId;
        expect(await view(deps, mod, closedCase, image)).toBe(served);
        await decideIn(tx, mod, closedCase, NO_SEAL);

        // (1) The post's own suspect item: refused on the suspicion's case and on the closed case about the post.
        const own = (await report(tx, aPost(p.postId), "csam")).caseId;
        expect(await postFrozen(tx, p.postId)).toBe(true);
        expect(await view(deps, mod, own, image)).toBe("image_refused");
        expect(await view(deps, mod, closedCase, image)).toBe("image_refused");
        expect(await view(deps, admin, own, image, "large")).toBe("image_refused");
        expect((await readCase(deps, sessionOf(mod), closedCase)).imagesAllowed).toBe(false);
        await decideIn(tx, admin, own, NO_SEAL);
        expect(await view(deps, mod, closedCase, image)).toBe(served);

        // (2) Its author's account's suspect item: refused on the post's own open case, which holds no suspect item, and
        // on the closed ones.
        const openCase = (await report(tx, aPost(p.postId), "rule", "R3")).caseId;
        expect(await view(deps, mod, openCase, image)).toBe(served);
        const account = (await report(tx, anAccount(author.id, author.handle), "csam")).caseId;
        for (const caseId of [openCase, closedCase, own]) expect(await view(deps, mod, caseId, image), caseId).toBe("image_refused");
        expect(await view(deps, mod, account, image)).toBe("image_refused");
        await decideIn(tx, admin, account, NO_SEAL);
        expect(await view(deps, mod, openCase, image)).toBe(served);

        // (3) An item korbat added because a reported post quotes this one: it joins the post's open case.
        const quotingPost = await newPostRow(tx, (await profile(tx)).id, { quoteOfId: p.postId });
        const recorded = await intake(tx, ground.csam(), aPost(quotingPost));
        expect(recorded.items.find((item) => item.position === 11)!.caseId).toBe(openCase);
        expect(await view(deps, mod, openCase, image)).toBe("image_refused");
        expect(await view(deps, mod, closedCase, image)).toBe("image_refused");
        // Only an admin answers it; the rule report of the same case that arrived before it is answered with it.
        await decideIn(tx, admin, openCase, NO_SEAL);
        expect(await view(deps, mod, openCase, image)).toBe(served);

        // What records that staff looked: the day of the newest view on any case about the post, shown with the suspicion.
        const today = new Date().toISOString().slice(0, 10);
        const answered = await readCase(deps, sessionOf(mod), own);
        expect(answered.suspicion?.earlier.target).toEqual({ count: 2, lastOn: today, imagesOpenedOn: today });
        // An account's case never says so: the console shows no image of an account.
        expect((await readCase(deps, sessionOf(mod), account)).suspicion?.earlier.target.imagesOpenedOn).toBeNull();
        // Refusals logged nothing: one row for each view that was served.
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(5);
      });
    });

    test("a sealed image is served to no staff member on any case, while deciding and for good, whatever became of the case", async () => {
      await withStore(async (tx, h) => {
        const { deps } = storeWorld(tx, h);
        const author = await h.established();
        const p = await h.postWithImages(author.id, 1);
        webp(h, p.mediaIds);
        const image = p.mediaIds[0]!;
        const closedCase = (await report(tx, aPost(p.postId))).caseId;
        await decideIn(tx, mod, closedCase, NO_SEAL);
        const suspectCase = (await report(tx, aPost(p.postId), "csam")).caseId;
        await decideIn(tx, mod, suspectCase, SEAL_WHILE_DECIDING);
        for (const caseId of [suspectCase, closedCase]) expect(await view(deps, admin, caseId, image), "while deciding").toBe("image_refused");
        await decideIn(tx, admin, suspectCase, SEAL_FOR_GOOD);
        // The case is closed and the seal stands: an open R1 case about the post shows no image either.
        const later = (await report(tx, aPost(p.postId))).caseId;
        for (const caseId of [suspectCase, closedCase, later]) expect(await view(deps, admin, caseId, image), "for good").toBe("image_refused");
        expect((await readCase(deps, sessionOf(admin), later)).imagesAllowed).toBe(false);
        expect(await accessRows(tx, admin.id, "image_viewed")).toBe(0);
      });
    });
  });

  describe("a fresh snapshot", () => {
    test("is taken when the target differs from the case's newest one, and answers that one's id when nothing differed; a stored snapshot recomputes to its digest", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const subject = await profile(tx);
        const { caseId } = await report(tx, anAccount(subject.id, subject.handle));
        const session = sessionOf(mod);
        const first = (await readCase(deps, session, caseId)).snapshots[0]!;
        // Nothing changed: the newest snapshot's own id and digest.
        expect(await takeSnapshot(deps, session, caseId)).toEqual({ id: first.id, digest: first.digest });
        // The account sets another bio: a new snapshot, which the case then carries first.
        await tx.execute(sql`update profiles set bio = 'a new bio' where id = ${subject.id}::uuid`);
        const taken = await takeSnapshot(deps, session, caseId);
        expect(taken.id).not.toBe(first.id);
        const view = await readCase(deps, session, caseId);
        expect(view.snapshots.map((snapshot) => snapshot.id)).toEqual([taken.id, first.id]);
        const newest = view.snapshots[0]!;
        if (newest.withheld) throw new Error("the snapshot is shown");
        expect(newest).toMatchObject({ targetType: "account", bio: "a new bio", handle: subject.handle, body: null, media: null, digest: taken.digest });
        expect(await snapshotDigest(newest)).toBe(taken.digest);
        expect(await takeSnapshot(deps, session, caseId)).toEqual(taken);
      });
    });

    test("of a post its author deleted since is a tombstone, and a case whose newest snapshot is withheld gets one without content", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId));
        const session = sessionOf(mod);
        await authorDeletes(tx, p.postId);
        const tombstone = await takeSnapshot(deps, session, caseId);
        let newest = (await readCase(deps, session, caseId)).snapshots[0]!;
        if (newest.withheld) throw new Error("the snapshot is shown");
        // The image row is kept by the case's hold, so the tombstone still lists it.
        expect(newest).toMatchObject({ id: tombstone.id, postState: "deleted_by_author", body: "", media: [expect.objectContaining({ id: p.mediaIds[0] })] });
        expect(await snapshotDigest(newest)).toBe(tombstone.digest);

        // The post's content is erased: both snapshots that held content are withheld, and a fresh one holds none.
        await tx.execute(sql`update posts set erased_at = now() where id = ${p.postId}::uuid`);
        expect((await readCase(deps, session, caseId)).snapshots.map((snapshot) => snapshot.withheld)).toEqual([true, true]);
        const empty = await takeSnapshot(deps, session, caseId);
        newest = (await readCase(deps, session, caseId)).snapshots[0]!;
        if (newest.withheld) throw new Error("a snapshot taken after the erasure holds no content and is shown");
        expect(newest).toMatchObject({ id: empty.id, body: "", media: [expect.objectContaining({ alt: null })] });
        expect(await takeSnapshot(deps, session, caseId)).toEqual(empty);
      }, migrateDb);
    });

    test("is run again when its transaction meets a deadlock or a lock timeout, as an intake's is, up to three times; when the last run fails the same way the answer is case_closed; any other failure is not run again", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const subject = await profile(tx);
        const { caseId } = await report(tx, anAccount(subject.id, subject.handle));
        const session = sessionOf(mod);
        /** The module's pool with a transaction that gives way with this SQLSTATE for its first `failures` runs. */
        function givingWay(code: string, failures: number) {
          let runs = 0;
          const transaction = ((...args: Parameters<Db["transaction"]>) => {
            if (++runs <= failures) return Promise.reject(Object.assign(new Error("the statement failed"), { cause: Object.assign(new Error("PostgreSQL gave way"), { code }) }));
            // On the test's own transaction a transaction of the module is a savepoint.
            return (tx as unknown as Db).transaction(...args);
          }) as Db["transaction"];
          return { apiDb: Object.assign(Object.create(tx) as Db, { transaction }), runs: () => runs };
        }
        for (const code of ["40P01", "55P03"]) {
          const never = givingWay(code, Number.POSITIVE_INFINITY);
          const refused = await takeSnapshot({ ...deps, apiDb: never.apiDb }, session, caseId).catch((err: unknown) => err as { code: string; status: number });
          expect(refused, code).toMatchObject({ code: "case_closed", status: 409 });
          // The first run and three more.
          expect(never.runs(), code).toBe(4);
        }
        // Three runs give way and the fourth goes through: the changed account gets its fresh snapshot.
        await tx.execute(sql`update profiles set bio = 'a new bio' where id = ${subject.id}::uuid`);
        const before = (await readCase(deps, session, caseId)).snapshots[0]!.id;
        const late = givingWay("40P01", 3);
        const taken = await takeSnapshot({ ...deps, apiDb: late.apiDb }, session, caseId);
        expect(late.runs()).toBe(4);
        expect(taken.id).not.toBe(before);
        expect((await readCase(deps, session, caseId)).snapshots.map((snapshot) => snapshot.id)).toEqual([taken.id, before]);
        // A failure of another kind is the caller's to see, at once.
        const broken = givingWay("23505", 1);
        await expect(takeSnapshot({ ...deps, apiDb: broken.apiDb }, session, caseId)).rejects.toThrow("the statement failed");
        expect(broken.runs()).toBe(1);
      });
    });

    test("that meets a decision on its case in the opposite order of locks gives way and is taken again: the decision commits, the snapshot copies the post as the decision left it, and neither is refused", async () => {
      // A decision that commits is confirmed by a real key, and a second session must see the post: everything here
      // commits and is removed again; the decision's audit row stays, as the record does.
      const decider = deciderWorld(apiDb);
      const [author, reporter] = [await newProfile(apiDb), await newProfile(apiDb)];
      try {
        const staff = await decider.staff("admin");
        const postId = await newPostRow(apiDb, author.id);
        const caseId = (await recordIntake(decider.moderation.deps, { ground: ground.rule(reporter.id), live: [aPost(postId)] })).items[0]!.caseId!;
        // The target changes after the report: its author takes another handle. A fresh snapshot is then a new row, and
        // the row's insert needs the case's row.
        const renamed = `re_${randomUUID().slice(0, 8)}`;
        await apiDb.execute(sql`update profiles set handle = ${renamed} where id = ${author.id}::uuid`);
        const confirmed = await decider.confirm(staff, caseId, await decisionParams(apiDb, staff, caseId, { kind: "interim", actions: [act("withhold")] }));
        const [timeout] = await apiDb.execute<{ ms: number }>(sql`select setting::int as ms from pg_settings where name = 'deadlock_timeout'`);

        // The snapshot's first run is stopped once it has locked the post, before its first statement that needs the case.
        const [locked, goOn] = [gate(), gate()];
        let runs = 0;
        const transaction = ((...args: Parameters<Db["transaction"]>) => {
          runs++;
          return apiDb.transaction(...args);
        }) as Db["transaction"];
        const { media, social } = decider.moderation.deps;
        let holds = 0;
        const stopping: MediaForCases = {
          ...media,
          hold: async (holdTx, pairs) => {
            if (++holds === 1) {
              locked.open();
              await goOn.opened;
            }
            return media.hold(holdTx, pairs);
          },
        };
        const settled = <T>(promise: Promise<T>) => promise.then((value) => value as unknown, (err: unknown) => err);
        const snapping = settled(takeSnapshot({ apiDb: Object.assign(Object.create(apiDb) as Db, { transaction }), social, media: stopping }, staff.session, caseId));
        await locked.opened;
        // The decision takes the case's row and then waits for the post, which the snapshot's transaction holds.
        const deciding = settled(decider.moderation.forStaff.decide(staff.session, confirmed, { requestId: `req-${randomUUID()}` }));
        try {
          await untilBlocked(apiDb, "insert into decision_actions");
          // PostgreSQL looks for a deadlock once, this long after a wait begins. The decision's look is over by now and
          // found none; the snapshot comes to wait for the case's row after it, finds the cycle, and is the one to give way.
          await new Promise((resolve) => setTimeout(resolve, timeout!.ms + 500));
        } finally {
          goOn.open();
        }
        const [taken, decided] = await Promise.all([snapping, deciding]);
        expect(decided).toEqual({ decisionId: expect.any(String) });
        expect(taken).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
        // The run that gave way, and the one that waited for the decision's commit.
        expect(runs).toBe(2);
        const stored = await apiDb.execute<{ id: string; post_state: string; author_handle: string }>(sql`select id, post_state, author_handle from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc`);
        expect(stored).toHaveLength(2);
        expect({ ...stored[0]! }).toEqual({ id: (taken as { id: string }).id, post_state: "withheld", author_handle: renamed });
      } finally {
        await removeFixtures(migrateDb, [author.id, reporter.id]);
        await decider.close();
      }
    });
  });

  describe("saved texts", () => {
    test("a note and a recorded choice not to seal are complete when saved and listed on the case with their writer's handle; every other kind is the person's own draft until a decision names it", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const { caseId } = await report(tx, aPost((await imagePost(tx, 1)).postId), "csam");
        const note = await save(deps, mod, caseId, "note", "Art. 18 check: no suspicion");
        const declined = await save(deps, other, caseId, "seal_declined", "The report repeats the one answered yesterday.");
        const facts = await save(deps, mod, caseId, "facts", "The post names the home address of another person.");
        const reason = await save(deps, mod, caseId, "reveal_reason", "The notifier claims to be impersonated.");
        await save(deps, other, caseId, "reason", "Another person's draft.");

        const view = await readCase(deps, sessionOf(mod), caseId);
        expect(view.notes).toEqual([{ id: note.id, staffHandle: await handleOf(tx, mod.id), createdAt: expect.any(String), text: "Art. 18 check: no suspicion" }]);
        expect(view.sealsDeclined).toEqual([{ id: declined.id, staffHandle: await handleOf(tx, other.id), createdAt: expect.any(String), text: "The report repeats the one answered yesterday." }]);
        // The person's own drafts, with their salts, each recomputing to its digest; never another person's.
        expect(view.drafts.map((draft) => `${draft.kind} ${draft.id}`).sort()).toEqual([`facts ${facts.id}`, `reveal_reason ${reason.id}`]);
        for (const draft of view.drafts) expect(await textDigest(draft.salt, draft.text)).toBe(draft.digest);
        expect(await ownTexts(deps, sessionOf(mod), caseId)).toEqual({ texts: view.drafts });
        expect((await ownTexts(deps, sessionOf(other), caseId)).texts.map((draft) => draft.kind)).toEqual(["reason"]);
        expect(view.history.map((entry) => entry.event)).toEqual(expect.arrayContaining(["note", "seal_declined"]));
        // A decision that names the facts confirms them: they are no draft any more.
        const factsDigest = facts.digest;
        await decideIn(tx, mod, caseId, { kind: "interim", ruleId: "R1", actions: [act("withhold")], factsDigest });
        expect((await ownTexts(deps, sessionOf(mod), caseId)).texts.map((draft) => draft.kind)).toEqual(["reveal_reason"]);
        expect((await readCase(deps, sessionOf(mod), caseId)).decisions[0]).toMatchObject({ facts: "The post names the home address of another person." });
      });
    });

    test("no text is saved empty, whatever its kind: a text of nothing or of white space alone is refused as an invalid request, and nothing is stored", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const { caseId } = await report(tx, aPost((await imagePost(tx, 0)).postId));
        const LF = String.fromCharCode(10);
        const NBSP = String.fromCharCode(0xa0);
        for (const kind of STAFF_TEXT_KINDS) {
          for (const text of ["", " ", `  ${LF} ${NBSP}${LF}`]) {
            const refused = await save(deps, mod, caseId, kind, text).catch((err: unknown) => err as { code: string; status: number });
            expect(refused, `${kind}: ${JSON.stringify(text)}`).toMatchObject({ code: "invalid_request", status: 400 });
          }
        }
        expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where case_id = ${caseId}::uuid`))[0]!.n).toBe(0);
        // A reason of one word is one.
        expect((await save(deps, mod, caseId, "reveal_reason", " Impersonation. ")).digest).toMatch(/^[0-9a-f]{64}$/);
      });
    });

    test("a text is stored as written or refused: text_invalid for a text no rule allows or a digest that does not match, text_quotes_user for a quote of what someone wrote on the case, and nothing is stored either way", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const reporter = await profile(tx);
        const theirs = "He posted my home address and my phone number to hurt me.";
        const p = await imagePost(tx, 0);
        const caseId = (await intake(tx, { ...ground.illegal(reporter.id), explanation: theirs, citedLaw: "Article 8 of the Charter of Fundamental Rights of the Union" }, aPost(p.postId))).items[0]!.caseId!;
        const stored = async () => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where case_id = ${caseId}::uuid`))[0]!.n;
        const session = sessionOf(mod);

        const refusals: Record<string, string | null> = {};
        refusals["a control character"] = await refusal(save(deps, mod, caseId, "facts", `a${String.fromCharCode(7)}b`));
        refusals["an invisible direction character"] = await refusal(save(deps, mod, caseId, "note", `a${String.fromCharCode(0x202e)}b`));
        refusals["5001 units"] = await refusal(save(deps, mod, caseId, "reason", "x".repeat(5001)));
        refusals["another text's digest"] = await refusal(saveText(deps, session, caseId, { kind: "facts", text: "The facts.", salt: hex64(), digest: hex64() }));
        refusals["a quote of the explanation"] = await refusal(save(deps, mod, caseId, "facts", `The reporter says: ${theirs}`));
        refusals["a quote of the cited law, in other case and spacing"] = await refusal(save(deps, mod, caseId, "reveal_reason", "see ARTICLE 8 OF THE   CHARTER OF FUNDAMENTAL RIGHTS of the union"));
        expect(refusals).toEqual({
          "a control character": "text_invalid",
          "an invisible direction character": "text_invalid",
          "5001 units": "text_invalid",
          "another text's digest": "text_invalid",
          "a quote of the explanation": "text_quotes_user",
          "a quote of the cited law, in other case and spacing": "text_quotes_user",
        });
        expect(await stored()).toBe(0);

        // A note may quote: it stays with staff. A paraphrase is no quote. 5000 units fit.
        await save(deps, mod, caseId, "note", `The reporter says: ${theirs}`);
        await save(deps, mod, caseId, "facts", "The post names the home address and the phone number of another person.");
        await save(deps, mod, caseId, "reason", "x".repeat(5000));
        expect(await stored()).toBe(3);
        // The same save sent again answers the row already stored; the same digest from another person is refused.
        const salt = hex64();
        const request = { kind: "facts" as const, text: "Sent twice.", salt, digest: await textDigest(salt, "Sent twice.") };
        const once = await saveText(deps, session, caseId, request);
        expect(await saveText(deps, session, caseId, request)).toEqual(once);
        expect(await refusal(saveText(deps, sessionOf(other), caseId, request))).toBe("text_invalid");
        expect(await stored()).toBe(4);
        expect(await refusal(save(deps, mod, randomUUID(), "note", "a note"))).toBe("not_found");
      });
    });

    test("one staff account saves at most 60 texts a minute", async () => {
      await inWorld(async (tx) => {
        const limits = new MemoryStore();
        const { deps } = world(tx, { limits });
        const { caseId } = await report(tx, aPost((await imagePost(tx, 0)).postId));
        expect(TEXT_SAVES_PER_MINUTE).toBe(60);
        for (let i = 0; i < TEXT_SAVES_PER_MINUTE - 1; i++) await limits.hit(`staff-text:${mod.id}`, 60_000);
        await save(deps, mod, caseId, "note", "the sixtieth");
        const refused = await save(deps, mod, caseId, "note", "the sixty-first").catch((err: unknown) => err as { code: string; retryAfterSeconds?: number });
        expect(refused).toMatchObject({ code: "rate_limited" });
        expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
        // Another staff account has its own minute.
        await save(deps, other, caseId, "note", "another person's");
      });
    });
  });

  describe("a moderator's own finding", () => {
    const finding = (target: FindingRequest["target"], ruleId: FindingRequest["ruleId"] = "R1"): FindingRequest => ({ target, ground: "rule", ruleId, category: ruleId === "R2" ? MINORS : TC });
    const findingsOf = async (tx: DbTx, staffId: string) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from intakes where finding_by = ${staffId}::uuid`))[0]!.n;

    test("opens a case on a post or joins its open one, as a finding under its rule; a post, an account's handle and a korbat link name the target; a link to another site is refused", async () => {
      await inWorld(async (tx) => {
        const { deps, mailed } = world(tx);
        const p = await imagePost(tx, 1);
        const author = { id: p.authorId, handle: await handleOf(tx, p.authorId) };
        const origin = new URL(deps.config.APP_ORIGIN).origin;
        const { caseId } = await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: p.postId, mediaId: p.mediaIds[0] }, "R3"));
        // A second finding by another moderator through the post's link joins the same case.
        expect(await openFinding(deps, sessionOf(other), finding({ kind: "link", url: `${origin}/post/${p.postId}` }, "R1"))).toEqual({ caseId });
        const view = await readCase(deps, sessionOf(admin), caseId);
        expect(view.items.map((item) => [item.ruleId, item.source.kind, item.mediaId, item.allegesIllegal, item.explanation])).toEqual([
          ["R3", "staff", p.mediaIds[0], false, null],
          ["R1", "staff", null, false, null],
        ]);
        expect(view.lane).toBe(1);
        // An account, by its handle with or without the at sign, and by its profile's link.
        const byHandle = await openFinding(deps, sessionOf(mod), finding({ kind: "account", handle: author.handle }, "R6"));
        expect(await openFinding(deps, sessionOf(other), finding({ kind: "link", url: `${origin}/u/${author.handle}` }, "R6"))).toEqual(byHandle);
        expect((await readCase(deps, sessionOf(admin), byHandle.caseId)).target).toMatchObject({ type: "account", id: author.id, handle: author.handle });
        expect(await refusal(openFinding(deps, sessionOf(mod), finding({ kind: "link", url: "https://elsewhere.example/post/x" })))).toBe("notice_link_offsite");
        // None of these is in the urgent lane: no alert.
        await deps.background.settle();
        expect(mailed).toEqual([]);
        // The overview counts the day's findings by staff handle.
        const today = (await overview(deps, sessionOf(mod))).findingsToday;
        expect(today).toContainEqual({ handle: await handleOf(tx, mod.id), count: 2 });
        expect(today).toContainEqual({ handle: await handleOf(tx, other.id), count: 2 });
      });
    });

    test("a target with nothing live is not_found, with nothing written and the day's count unchanged; citing R2, whatever is left of a deleted post, a purged account or an account under a handle it has left gets a case in the urgent lane that freezes its images and alerts staff", async () => {
      await inWorld(async (tx) => {
        const { deps, mailed } = world(tx);
        const session = sessionOf(mod);
        const deleted = await imagePost(tx, 1);
        await authorDeletes(tx, deleted.postId);
        const purged = await profile(tx);
        const purgedPost = await imagePost(tx, 1, purged.id);
        await tx.execute(sql`update profiles set deleted_at = now(), display_name = 'Deleted account', bio = '' where id = ${purged.id}::uuid`);
        const moved = await profile(tx);
        const movedPost = await imagePost(tx, 2, moved.id);
        const left = `old_${randomUUID().slice(0, 8)}`;
        await tx.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${moved.id}::uuid, now())`);

        const dead: [string, FindingRequest["target"]][] = [
          ["a post nobody has", { kind: "post", id: randomUUID() }],
          ["a post its author deleted", { kind: "post", id: deleted.postId }],
          ["a deleted account", { kind: "account", handle: purged.handle }],
          ["a handle its account has left", { kind: "account", handle: left }],
          ["a handle nobody holds", { kind: "account", handle: "nobody_here_1" }],
        ];
        for (const [label, target] of dead) expect(await refusal(openFinding(deps, session, finding(target, "R1"))), label).toBe("not_found");
        expect(await findingsOf(tx, mod.id)).toBe(0);
        expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from cases where target_id = any(${`{${[deleted.postId, purged.id, moved.id].join(",")}}`}::uuid[])`))[0]!.n).toBe(0);
        await deps.background.settle();
        expect(mailed).toEqual([]);

        // The same targets under R2: each a case in the urgent lane that waits for an admin.
        const onDeleted = await openFinding(deps, session, finding({ kind: "post", id: deleted.postId }, "R2"));
        const onPurged = await openFinding(deps, session, finding({ kind: "account", handle: purged.handle }, "R2"));
        const onMoved = await openFinding(deps, session, finding({ kind: "account", handle: left }, "R2"));
        for (const { caseId } of [onDeleted, onPurged, onMoved]) expect(await readCase(deps, sessionOf(admin), caseId)).toMatchObject({ lane: 0, imagesAllowed: false, suspicion: { open: true } });
        // The case on the old handle is the account's, under the handle it holds now; its item shows the handle as named.
        const movedView = await readCase(deps, sessionOf(admin), onMoved.caseId);
        expect(movedView.target).toMatchObject({ type: "account", id: moved.id, handle: moved.handle });
        expect(movedView.items[0]).toMatchObject({ link: `${new URL(deps.config.APP_ORIGIN).origin}/u/${left}`, suspect: true, ruleId: "R2", source: { kind: "staff" } });
        expect(movedView.suspicion?.reach).toMatchObject({ posts: 1, images: 2 });
        for (const postId of [deleted.postId, purgedPost.postId, movedPost.postId]) expect(await postFrozen(tx, postId), postId).toBe(true);
        // But a post nobody has is no target under any rule.
        expect(await refusal(openFinding(deps, session, finding({ kind: "post", id: randomUUID() }, "R2")))).toBe("not_found");
        expect(await findingsOf(tx, mod.id)).toBe(3);
        // One alert for the urgent lane, throttled for the two findings after it.
        await deps.background.settle();
        expect(mailed.map((message) => message.template)).toEqual(["moderation_urgent"]);
      });
    });

    test("citing R2 on a post that quotes another, a finding gets the added item as a notice does: the answer carries the case of the post the finder named, that case links the quoted post's, both freeze, and it is one finding against the day's limit", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const quoted = await imagePost(tx, 2);
        const quoting = await imagePost(tx, 1, undefined, { quoteOfId: quoted.postId });
        const { caseId } = await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: quoting.postId }, "R2"));
        const named = await readCase(deps, sessionOf(admin), caseId);
        expect(named.target).toMatchObject({ type: "post", id: quoting.postId });
        expect(named.items).toHaveLength(1);
        const quotedCaseId = named.items[0]!.quotedCaseId;
        expect(named.items[0]).toMatchObject({ position: 1, ruleId: "R2", suspect: true, quotedByPosition: null, source: { kind: "staff" } });
        expect(quotedCaseId).toEqual(expect.any(String));
        expect(quotedCaseId).not.toBe(caseId);
        // The quoted post's case holds the item korbat added for it, under the same finding.
        const added = await readCase(deps, sessionOf(admin), quotedCaseId!);
        expect(added.target).toMatchObject({ type: "post", id: quoted.postId });
        expect(added.items).toEqual([expect.objectContaining({ position: 11, ruleId: "R2", suspect: true, quotedByPosition: 1, quotedCaseId: null, source: expect.objectContaining({ kind: "staff" }) })]);
        for (const view of [named, added]) expect(view).toMatchObject({ lane: 0, imagesAllowed: false, suspicion: { open: true } });
        expect(await postFrozen(tx, quoting.postId)).toBe(true);
        expect(await postFrozen(tx, quoted.postId)).toBe(true);
        // One intake with two items, both the finder's.
        expect(await findingsOf(tx, mod.id)).toBe(1);
        const [items] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from intake_items i join intakes k on k.id = i.intake_id where k.finding_by = ${mod.id}::uuid`);
        expect(items!.n).toBe(2);
        expect((await overview(deps, sessionOf(mod))).findingsToday).toContainEqual({ handle: await handleOf(tx, mod.id), count: 1 });
      });
    });

    test("one staff account opens at most the day's limit of findings: the next is refused with nothing written, and another staff account's is accepted", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        await tx.execute(sql`update moderation_limits set findings_per_day = 2 where id = 1`);
        const posts = [await imagePost(tx, 0), await imagePost(tx, 0), await imagePost(tx, 0)];
        await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: posts[0]!.postId }));
        await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: posts[1]!.postId }));
        const refused = await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: posts[2]!.postId })).catch((err: unknown) => err as { code: string; status: number; retryAfterSeconds?: number });
        expect(refused).toMatchObject({ code: "rate_limited", status: 429 });
        expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
        expect(await findingsOf(tx, mod.id)).toBe(2);
        expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from cases where target_id = ${posts[2]!.postId}::uuid`))[0]!.n).toBe(0);
        // The target is resolved before anything is counted: at the limit, a link that names nothing live, or another
        // site, is answered as on any other day, and only a finding that could be opened meets the limit.
        expect(await refusal(openFinding(deps, sessionOf(mod), finding({ kind: "post", id: randomUUID() })))).toBe("not_found");
        expect(await refusal(openFinding(deps, sessionOf(mod), finding({ kind: "account", handle: "nobody_here_1" })))).toBe("not_found");
        expect(await refusal(openFinding(deps, sessionOf(mod), finding({ kind: "link", url: "https://elsewhere.example/post/x" })))).toBe("notice_link_offsite");
        expect(await findingsOf(tx, mod.id)).toBe(2);
        await openFinding(deps, sessionOf(other), finding({ kind: "post", id: posts[2]!.postId }));
        const today = (await overview(deps, sessionOf(mod))).findingsToday;
        expect(today).toContainEqual({ handle: await handleOf(tx, mod.id), count: 2 });
        expect(today).toContainEqual({ handle: await handleOf(tx, other.id), count: 1 });
      }, migrateDb);
    });
  });

  describe("the queue", () => {
    /** The queue's rows that are this test's own, in the queue's order, read page by page. */
    async function ownRows(deps: ModerationDeps, own: readonly string[]) {
      const found: QueuePage["cases"] = [];
      let cursor: string | undefined;
      for (let pages = 0; pages < 40; pages++) {
        const page = await queue(deps, cursor);
        expect(QueuePage.safeParse(page).success).toBe(true);
        found.push(...page.cases.filter((row) => own.includes(row.id)));
        if (page.nextCursor === null) return found;
        cursor = page.nextCursor;
      }
      throw new Error("the queue did not end");
    }
    const openedAgo = (tx: DbTx, caseId: string, ago: string) => tx.execute(sql`update cases set oldest_open_at = now() - ${ago}::interval where id = ${caseId}::uuid`);

    test("orders open cases by lane, then by their oldest unanswered item, and says of each what its unanswered items cite; a closed case is not in it", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const reporter = await profile(tx);
        const lane2Old = (await report(tx, aPost((await imagePost(tx, 0)).postId), "rule", "R1")).caseId;
        const lane2New = (await report(tx, anAccount((await profile(tx)).id), "rule", "R6")).caseId;
        const lane1 = (await report(tx, aPost((await imagePost(tx, 0)).postId), "rule", "R3")).caseId;
        const urgent = (await report(tx, aPost((await imagePost(tx, 1)).postId), "csam")).caseId;
        const mixedPost = await imagePost(tx, 0);
        const mixed = (await intake(tx, ground.rule(reporter.id, "R4"), aPost(mixedPost.postId))).items[0]!.caseId!;
        await intake(tx, ground.illegal(reporter.id), aPost(mixedPost.postId));
        const closed = (await report(tx, aPost((await imagePost(tx, 0)).postId), "rule", "R1")).caseId;
        await decideIn(tx, mod, closed, NO_SEAL);
        await openedAgo(tx, lane2Old, "3 days");
        await openedAgo(tx, lane2New, "2 hours");
        await openedAgo(tx, lane1, "1 hour");
        await openedAgo(tx, mixed, "5 hours");
        await openedAgo(tx, urgent, "10 minutes");

        const rows = await ownRows(deps, [lane2Old, lane2New, lane1, urgent, mixed, closed]);
        expect(rows.map((row) => row.id)).toEqual([urgent, mixed, lane1, lane2Old, lane2New]);
        expect(rows[0]).toMatchObject({ lane: 0, targetType: "post", openItems: 1, rules: [], categories: [MINORS], allegesIllegal: true, suspect: true, reexamination: false, deferred: false });
        expect(rows[1]).toMatchObject({ lane: 1, openItems: 2, rules: ["R4"], categories: ["STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH", TC], allegesIllegal: true, suspect: false });
        expect(rows[4]).toMatchObject({ lane: 2, targetType: "account", rules: ["R6"], allegesIllegal: false, suspect: false });
        // No row names a reporter, a count of reports per person or a weight.
        // 3d Task 6: and three booleans of what a program found and took and whether the author asked for a person; Task
        // 7: and whether a match only flags; Task 8: and the flag "possible coordinated reporting", its two counts or null.
        expect(Object.keys(rows[0]!).sort()).toEqual([
          "allegesIllegal",
          "categories",
          "deferred",
          "flag",
          "foundByProgram",
          "id",
          "lane",
          "matchFlag",
          "objected",
          "oldestOpenAt",
          "openItems",
          "openedAt",
          "reexamination",
          "rules",
          "suspect",
          "takenByProgram",
          "targetType",
        ]);
        expect(rows.every((row) => !row.foundByProgram && !row.takenByProgram && !row.objected)).toBe(true);
        expect(rows.map((row) => row.flag)).toEqual([null, null, null, null, null]);
      }, migrateDb);
    });

    test("a page ends where the next begins: the cursor is the last row's sort key, and anything else for a cursor is refused", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const all = await queueRows(tx, { deferUnproven: false, after: null, limit: 1000 });
        const cases: string[] = [];
        for (let i = 0; i < 5; i++) cases.push((await report(tx, aPost((await imagePost(tx, 0)).postId), "rule", "R3")).caseId);
        // Two a page through the repository: every open case once, in one order, whatever the page's size.
        const paged: string[] = [];
        let after: Parameters<typeof queueRows>[1]["after"] = null;
        for (;;) {
          const page = await queueRows(tx, { deferUnproven: false, after, limit: 2 });
          paged.push(...page.map((row) => row.id));
          const last = page.at(-1);
          if (page.length < 2 || !last) break;
          after = { lane: last.lane, objected: last.objected, deferred: last.deferred, sortAt: last.sortAt, id: last.id };
        }
        const whole = (await queueRows(tx, { deferUnproven: false, after: null, limit: 1000 })).map((row) => row.id);
        expect(paged).toEqual(whole);
        expect(whole).toHaveLength(all.length + 5);
        expect(whole.filter((id) => cases.includes(id))).toHaveLength(5);
        // The route's page holds at most 50, and names a next page only when there is one.
        const first = await queue(deps);
        expect(first.cases.length).toBeLessThanOrEqual(QUEUE_PAGE_SIZE);
        expect(first.nextCursor === null).toBe(whole.length <= QUEUE_PAGE_SIZE);
        for (const cursor of ["bm9wZQ", Buffer.from(JSON.stringify([5, false, "2026-10-04T08:00:00.000000Z", randomUUID()])).toString("base64url"), Buffer.from(JSON.stringify([0, false, "now", randomUUID()])).toString("base64url")]) {
          expect(await refusal(queue(deps, cursor)), cursor).toBe("invalid_request");
        }
      });
    });

    test("only under the emergency switch are cases whose unanswered items all come from unproven sources sorted after the others of their lane, never below a less severe lane; in the urgent lane only signed-out intakes count as unproven", async () => {
      await inWorld(async (tx) => {
        const fresh = await profile(tx);
        const old = await profile(tx);
        await tx.execute(sql`update profiles set created_at = now() - interval '30 days' where id = ${old.id}::uuid`);
        const post = async () => (await imagePost(tx, 0)).postId;
        const caseOf = async (g: Parameters<typeof intake>[1]) => (await intake(tx, g, aPost(await post()))).items[0]!.caseId!;
        const signedOut3 = await caseOf({ ...ground.illegal(null), category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" });
        const fresh2 = await caseOf(ground.rule(fresh.id, "R1"));
        const old2 = await caseOf(ground.rule(old.id, "R1"));
        // A threat reported by a new account, about itself or not, is never deferred; a signed-out one is.
        const freshUrgent = await caseOf(ground.rule(fresh.id, "R5"));
        const signedOutUrgent = await caseOf({ ...ground.illegal(null), category: "STATEMENT_CATEGORY_VIOLENCE" });
        // A case with one proven source among its unanswered items is not deferred.
        const mixedPost = await post();
        const mixed = (await intake(tx, ground.rule(fresh.id, "R6"), aPost(mixedPost))).items[0]!.caseId!;
        await intake(tx, ground.rule(old.id, "R6"), aPost(mixedPost));
        const own = [signedOut3, fresh2, old2, freshUrgent, signedOutUrgent, mixed];
        const age: [string, string][] = [
          [signedOutUrgent, "9 hours"],
          [freshUrgent, "1 hour"],
          [signedOut3, "8 hours"],
          [fresh2, "7 hours"],
          [old2, "2 hours"],
          [mixed, "1 hour"],
        ];
        for (const [caseId, ago] of age) await tx.execute(sql`update cases set oldest_open_at = now() - ${ago}::interval where id = ${caseId}::uuid`);

        const off = await ownRows(world(tx).deps, own);
        expect(off.map((row) => row.id)).toEqual([signedOutUrgent, freshUrgent, signedOut3, fresh2, old2, mixed]);
        expect(off.every((row) => !row.deferred)).toBe(true);
        const switchedOn = { config: { ...loadConfig(), MODERATION_DEFER_UNPROVEN: "on" as const } };
        const on = await ownRows(world(tx, switchedOn).deps, own);
        expect(on.map((row) => [row.id, row.deferred])).toEqual([
          [freshUrgent, false],
          [signedOutUrgent, true],
          [old2, false],
          [mixed, false],
          [signedOut3, true],
          [fresh2, true],
        ]);
        expect((await overview(world(tx, switchedOn).deps, sessionOf(mod))).deferUnproven).toBe(true);
      }, migrateDb);
    });
  });

  describe("the overview", () => {
    test("per lane the open cases and the oldest unanswered item; the appeals waiting; mails waiting for more than an hour and those given up; decided items the release has not released after 26 hours; and the emergency switch", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const start = await overview(deps, sessionOf(mod));
        expect(StaffOverview.safeParse(start).success).toBe(true);
        expect(start.lanes.map((row) => row.lane)).toEqual([0, 1, 2]);
        expect(start.deferUnproven).toBe(false);

        const reporter = await profile(tx);
        const urgentCase = (await report(tx, aPost((await imagePost(tx, 1)).postId), "csam")).caseId;
        await tx.execute(sql`update cases set oldest_open_at = now() - interval '400 days' where id = ${urgentCase}::uuid`);
        // A notice whose sender is owed a receipt and an outcome mail, decided 30 hours ago and never released.
        const noticed = await intake(tx, ground.illegal(reporter.id), aPost((await imagePost(tx, 0)).postId));
        const decision = await decideIn(tx, mod, noticed.items[0]!.caseId!, { kind: "final", actions: [act("remove")] });
        await tx.execute(sql`update intakes set received_at = now() - interval '2 hours' where id = ${noticed.intakeId}::uuid`);
        await tx.execute(sql`update decisions set decided_at = now() - interval '30 hours' where id = ${decision}::uuid`);
        let seen = await overview(deps, sessionOf(mod));
        expect(seen.lanes[0]).toMatchObject({ lane: 0, open: start.lanes[0]!.open + 1 });
        expect(Date.parse(seen.lanes[0]!.oldestAt!)).toBeLessThan(Date.now() - 399 * 24 * 3600_000);
        expect(seen.mailsWaiting).toEqual({ receipts: start.mailsWaiting.receipts + 1, authorMails: start.mailsWaiting.authorMails + 1, outcomes: start.mailsWaiting.outcomes });
        expect(seen.releaseOverdue).toBe(start.releaseOverdue + 1);
        expect(seen.appealsWaiting).toBe(start.appealsWaiting);

        // Released three hours ago, its outcome mail still pending; the receipt and the author's mail given up.
        await tx.execute(sql`update intake_items set outcome_sent_at = now() - interval '3 hours', shown_outcome = outcome where id = ${noticed.items[0]!.id}::uuid`);
        await tx.execute(sql`update intakes set receipt = 'failed' where id = ${noticed.intakeId}::uuid`);
        await tx.execute(sql`update decisions set author_mail = 'failed' where id = ${decision}::uuid`);
        seen = await overview(deps, sessionOf(mod));
        expect(seen.mailsWaiting).toEqual({ receipts: start.mailsWaiting.receipts, authorMails: start.mailsWaiting.authorMails, outcomes: start.mailsWaiting.outcomes + 1 });
        expect(seen.mailsFailed).toEqual({ receipts: start.mailsFailed.receipts + 1, authorMails: start.mailsFailed.authorMails + 1, outcomes: start.mailsFailed.outcomes });
        expect(seen.releaseOverdue).toBe(start.releaseOverdue);
        // A mail given up more than 30 days ago is no longer counted.
        await tx.execute(sql`update decisions set decided_at = now() - interval '40 days' where id = ${decision}::uuid`);
        expect((await overview(deps, sessionOf(mod))).mailsFailed.authorMails).toBe(start.mailsFailed.authorMails);
        // An appeal nobody has answered waits.
        await tx.execute(sql`insert into appeals (decision_id, appellant_account_id, filed_at) select d.id, p.author_id, now() from decisions d join cases c on c.id = d.case_id join posts p on p.id = c.target_id where d.id = ${decision}::uuid`);
        expect((await overview(deps, sessionOf(mod))).appealsWaiting).toBe(start.appealsWaiting + 1);
        expect((await readCase(deps, sessionOf(admin), noticed.items[0]!.caseId!)).appeals).toEqual([expect.objectContaining({ decisionId: decision, statement: null, answeredAt: null, result: null })]);
      }, migrateDb);
    });

    test("the reveals it lists are those of the last 30 days, newest first, at most 100 of them, with how many there are in all", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        expect(OVERVIEW_LIST_MAX).toBe(100);
        const start = (await overview(deps, sessionOf(mod))).reveals;
        const [first, second] = [(await report(tx, aPost((await imagePost(tx, 0)).postId))).caseId, (await report(tx, aPost((await imagePost(tx, 0)).postId))).caseId];
        // One more than the list holds, written as the migrator: the database stamps each row with the transaction's time.
        const more = OVERVIEW_LIST_MAX + 1;
        const rows = await tx.execute<{ id: string }>(
          sql`insert into case_access_log (staff_id, case_id, kind) select ${mod.id}::uuid, ${first}::uuid, 'identity_revealed'::access_kind from generate_series(1, ${more}::int) returning id::text as id`,
        );
        expect(rows).toHaveLength(more);
        let seen = (await overview(deps, sessionOf(mod))).reveals;
        expect(StaffOverview.shape.reveals.safeParse(seen).success).toBe(true);
        expect(seen.total).toBe(start.total + more);
        expect(seen.items).toHaveLength(OVERVIEW_LIST_MAX);
        expect(seen.items.every((item) => item.caseId === first && item.handle !== "")).toBe(true);

        // One on another case a minute later is the newest; one of 29 days ago is still listed, one of 30 days and a
        // minute is not.
        const newest = (await tx.execute<{ id: string }>(sql`insert into case_access_log (staff_id, case_id, kind) values (${other.id}::uuid, ${second}::uuid, 'identity_revealed'::access_kind) returning id::text as id`))[0]!.id;
        await tx.execute(sql`update case_access_log set at = now() + interval '1 minute' where id = ${newest}::bigint`);
        await tx.execute(sql`update case_access_log set at = now() - interval '29 days' where id = ${rows[0]!.id}::bigint`);
        await tx.execute(sql`update case_access_log set at = now() - interval '30 days 1 minute' where id = ${rows[1]!.id}::bigint`);
        seen = (await overview(deps, sessionOf(mod))).reveals;
        expect(seen.total).toBe(start.total + more);
        expect(seen.items[0]).toEqual({ at: expect.any(String), handle: await handleOf(tx, other.id), caseId: second });
        expect(seen.items.map((item) => item.at)).toEqual([...seen.items.map((item) => item.at)].sort().reverse());
        // With the list cut to this test's cases: every row of the last 30 days but the one moved out of it.
        await tx.execute(sql`update case_access_log set at = now() - interval '31 days' where kind = 'identity_revealed' and case_id <> all(${`{${first},${second}}`}::uuid[])`);
        await tx.execute(sql`delete from case_access_log where kind = 'identity_revealed' and case_id = ${first}::uuid and id > ${rows[49]!.id}::bigint`);
        seen = (await overview(deps, sessionOf(mod))).reveals;
        expect(seen.total).toBe(50);
        expect(seen.items).toHaveLength(50);
        expect(seen.items.at(-1)).toMatchObject({ caseId: first, handle: await handleOf(tx, mod.id) });
        expect(Date.parse(seen.items.at(-1)!.at)).toBeLessThan(Date.now() - 28 * 24 * 3600_000);
      }, migrateDb);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${mod.id}::uuid`);
    expect(await counts()).toEqual(before);
  });
});
