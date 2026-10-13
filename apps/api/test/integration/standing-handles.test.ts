import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACCOUNT_MEASURE_SCOPE, ACTION_KINDS, OUTCOME_PHRASES, itemOutcomeWords } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import type { Db } from "@korbat/db";
import { closeDb, createDb } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { ROUTE_KINDS } from "../../src/moderation/decide";
import { updateLine } from "../../src/moderation/dispatch";
import { itemStatus } from "../../src/moderation/intake";
import { dueRedactions, insertAction, insertDecision, lateErasures, noticeItems, pendingOutcomeLines } from "../../src/moderation/repo";
import { decisionStatement } from "../../src/moderation/statement";
import { createProfileStore } from "../../src/profiles/store";
import { changeHandle } from "../../src/social/flows/profile-edit";
import { closeDecisions, deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, actionsOf, anAccount, appealOf, decisionParams, ground, intake, refusal, removeFixtures, rowCounts, type DecisionInput } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";
import { rolledBack } from "./staff-fixtures";

// Every test commits decisions confirmed with a real key, each a round of the step-up flow: slow on a loaded machine.
vi.setConfig({ testTimeout: 240_000 });

/** A handle nobody holds: lower-case, as the flows store a chosen one. */
const newHandle = () => `rh_${randomBytes(5).toString("hex")}`;
/** The placeholder decision_actions_apply gives: the prefix and the first 12 hex digits of the sha256 of the measure's id as text. */
const placeholderOf = (actionId: string) => `retired_${createHash("sha256").update(actionId, "utf8").digest("hex").slice(0, 12)}`;

/**
 * The retirement of a handle and its reversal through the routes (3e design, sections 6.2, 7.10 and 7.11; section 12.1,
 * invariant 15 and row 24 for a retirement). Each decision is confirmed as the console confirms one, with a staff key on
 * the software authenticator, and recorded by the moderation module's own decide and review, which the staff routes
 * run. The handle change and onboarding are the social module's flow and the profile store, on the API's pool, so a
 * refusal is the one a person meets; a write that skips them is made as korbat_api, which the trigger refuses. What the
 * file commits is removed in the end, and its last test holds it to that.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the retirement of a handle and its reversal", () => {
  let apiDb: Db;
  let world: DeciderWorld;
  let s: SocialHarness;
  let moderator: RealStaff;
  let admin: RealStaff;
  let reviewer: RealStaff;
  let before: Record<string, number>;
  /** The profiles this file made, removed with everything they hold at the end. */
  const made: string[] = [];

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    world = deciderWorld(apiDb);
    s = socialHarness(apiDb);
    moderator = await world.staff("moderator");
    admin = await world.staff("admin");
    reviewer = await world.staff("moderator");
    // Read once the staff profiles exist: the world removes them when it closes, after the last test.
    before = await rowCounts(apiDb);
  }, 240_000);
  afterAll(async () => {
    try {
      await closeDecisions();
      await removeFixtures(world.migrateDb, made.splice(0));
      await world.close();
    } finally {
      await closeDb(apiDb);
    }
  }, 240_000);

  const store = () => createProfileStore(apiDb);
  async function account() {
    const profile = await newProfile(apiDb);
    made.push(profile.id);
    return profile;
  }
  /** The account's case, opened by a signed-in report under R4 that names it by this handle: the case and the report. */
  async function reportedAccount(subjectId: string, named: string) {
    const reporter = await account();
    const recorded = await intake(apiDb, ground.rule(reporter.id, "R4"), anAccount(subjectId, named));
    return { caseId: recorded.items[0]!.caseId!, intakeId: recorded.intakeId };
  }
  /** A confirmed decision through the route's code: its id. */
  async function decided(member: RealStaff, caseId: string, input: DecisionInput): Promise<string> {
    const outcome = await world.decideAs(member, caseId, input);
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  }
  /** A final retirement under R4 by the moderator, with what else the decision holds. */
  const retire = (caseId: string, also: DecisionInput["actions"] = [], more: Partial<DecisionInput> = {}) =>
    decided(moderator, caseId, { kind: "final", ruleId: "R4", actions: [act("retire_handle"), ...(also ?? [])], ...more });
  const profileRow = async (id: string) =>
    (await apiDb.execute<{ handle: string; display_name: string; handle_changed_at: string | null }>(sql`select handle, display_name, handle_changed_at::text from profiles where id = ${id}::uuid`))[0]!;
  const historyRow = async (handle: string) =>
    (await apiDb.execute<{ profile_id: string; retired: boolean }>(sql`select profile_id, retired_at is not null as retired from handle_history where handle_lower = ${handle.toLowerCase()}`))[0] ?? null;
  const retirementRow = async (decisionId: string) => (await actionsOf(apiDb, decisionId)).find((a) => a.kind === "retire_handle")!;

  test("the routes take the retirement and its reversal, and since Task 5 every kind of the ledger (7.1 item 2)", () => {
    expect(ROUTE_KINDS.has("retire_handle")).toBe(true);
    expect(ROUTE_KINDS.has("unretire_handle")).toBe(true);
    // Task 3 opened a suspension at once and its lift, Task 4 a termination, Task 5 the reporting kinds: the list holds
    // every kind of the ledger now.
    for (const kind of ["suspend", "lift_suspension", "terminate", "warn_reporting", "restrict_reporting", "lift_reporting"] as const) expect(ROUTE_KINDS.has(kind), kind).toBe(true);
    expect([...ACTION_KINDS].filter((kind) => !ROUTE_KINDS.has(kind))).toEqual([]);
  });

  test("invariant 15: a retirement swaps the handle for the placeholder made from the measure's id and clears the change time; the handle is refused to everyone, its former holder included, and the new handle is chosen at once", async () => {
    const subject = await account();
    // The account changed its handle once, so the ordinary wait would apply, and the handle it holds now has no row in
    // handle_history yet: the retirement writes it first.
    const judged = newHandle();
    expect((await changeHandle(s.deps, subject.id, { handle: judged })).handle).toBe(judged);
    expect(await historyRow(judged)).toBeNull();
    const { caseId, intakeId } = await reportedAccount(subject.id, judged);
    // A signed-in notice of illegal content about the same account joins the case: its sender is mailed the outcome.
    const noticer = await account();
    const notice = await intake(apiDb, ground.illegal(noticer.id), anAccount(subject.id, judged));
    expect(notice.items[0]!.caseId).toBe(caseId);
    const caseRead = () => world.moderation.forStaff.caseView(admin.session, caseId);
    expect((await caseRead()).standing).toMatchObject({ snapshotHandleRetired: false });
    const decisionId = await retire(caseId);
    const row = await retirementRow(decisionId);
    // The case answer names the handle on the retirement's row, and says that a retirement now would change nothing.
    const after = await caseRead();
    expect(after.decisions.find((d) => d.id === decisionId)!.actions).toEqual([expect.objectContaining({ kind: "retire_handle", handle: judged, inForce: true, noEffect: null })]);
    expect(after.standing).toMatchObject({ snapshotHandleRetired: true });
    expect(row.no_effect).toBeNull();
    const placeholder = placeholderOf(row.id);
    expect(placeholder).toHaveLength(20);
    expect(await profileRow(subject.id)).toMatchObject({ handle: placeholder, handle_changed_at: null });
    expect(await historyRow(judged)).toEqual({ profile_id: subject.id, retired: true });
    expect(await historyRow(subject.handle)).toEqual({ profile_id: subject.id, retired: false });

    // Refused to everyone, its former holder included, by the flows' own check: handle_retired, 409.
    const stranger = await account();
    expect(await rejection(changeHandle(s.deps, subject.id, { handle: judged }))).toBe("handle_retired");
    expect(await rejection(changeHandle(s.deps, stranger.id, { handle: judged.toUpperCase() }))).toBe("handle_retired");
    expect(await store().create({ id: randomUUID(), handle: judged, displayName: "Late" })).toEqual({ ok: false, reason: "handle_retired" });
    expect(await store().create({ id: randomUUID(), handle: judged.toUpperCase(), displayName: "Late" })).toEqual({ ok: false, reason: "handle_retired" });
    // The placeholder's prefix is reserved in the handle rule: handle_reserved, 400.
    expect(await rejection(changeHandle(s.deps, stranger.id, { handle: placeholder }))).toBe("handle_reserved");
    // The repository and the store answer the trigger's codes where a caller skipped the handle rule.
    expect(await s.repo.changeHandle(stranger.id, "retired_0123456789ab", new Date())).toEqual({ ok: false, reason: "handle_reserved" });
    expect(await s.repo.changeHandle(subject.id, judged, new Date())).toEqual({ ok: false, reason: "handle_retired" });
    expect(await store().create({ id: randomUUID(), handle: "retired_0123456789ab", displayName: "Late" })).toEqual({ ok: false, reason: "handle_reserved" });
    // A direct write as korbat_api meets the trigger, for every role but the migrator.
    expect(await refusal(apiDb.execute(sql`update profiles set handle = ${judged} where id = ${stranger.id}::uuid`))).toBe("handle_retired");
    expect(await refusal(apiDb.execute(sql`update profiles set handle = 'retired_0123456789ab' where id = ${stranger.id}::uuid`))).toBe("handle_reserved");
    expect(await refusal(apiDb.execute(sql`insert into profiles (id, handle, display_name) values (${randomUUID()}::uuid, ${judged.toUpperCase()}, 'Late')`))).toBe("handle_retired");
    expect((await profileRow(stranger.id)).handle).toBe(stranger.handle);

    // The statement names the handle and the placeholder, and the end that fits the decision's own measures.
    const found = (await decisionStatement(apiDb, decisionId))!;
    expect(found.statement.measures).toEqual([{ kind: "retire_handle", mediaId: null, noEffect: null, sealed: null, handle: judged, placeholder }]);
    const paragraphs = statementParagraphs(found.statement);
    expect(paragraphs[0]).toBe(STATEMENT_WORDS.retire(judged, placeholder, "at_once"));
    expect(paragraphs).toContain(STATEMENT_WORDS.automation);

    // The reporter reads 3c's restricted outcome with the retired phrase in place of the display name's.
    await apiDb.execute(sql`select public.release_outcomes(now())`);
    const [item] = await noticeItems(apiDb, intakeId);
    const status = await itemStatus(world.moderation.deps, item!);
    expect(status.scope).toBe("account_retired");
    expect(itemOutcomeWords(status)!.endsWith(` ${ACCOUNT_MEASURE_SCOPE.retired}`)).toBe(true);
    expect(itemOutcomeWords(status)!.startsWith("access restricted: it breaks korbat rule R4")).toBe(true);
    // The notice's sender is mailed the same line by the dispatch job.
    const mailed = (await pendingOutcomeLines(apiDb)).find((line) => line.intakeId === notice.intakeId)!;
    expect(mailed).toMatchObject({ targetType: "account", retired: true });
    expect(updateLine(world.moderation.deps, mailed).outcome).toBe(itemOutcomeWords(status));

    // A new handle at once: the swap cleared the change time, so the change made minutes ago sets no wait.
    const next = newHandle();
    expect((await changeHandle(s.deps, subject.id, { handle: next })).handle).toBe(next);
    expect((await profileRow(subject.id)).handle_changed_at).not.toBeNull();
  });

  test("the retirement is stored first beside a reset of the display name, which then copies the placeholder; a retirement that is not its decision's first row is refused", async () => {
    const subject = await account();
    const { caseId } = await reportedAccount(subject.id, subject.handle);
    // The signed list is in its one order, the reset first; the decide route inserts the retirement before it.
    const decisionId = await retire(caseId, [act("reset_display_name")]);
    const placeholder = placeholderOf((await retirementRow(decisionId)).id);
    expect(await profileRow(subject.id)).toMatchObject({ handle: placeholder, display_name: placeholder });
    expect((await actionsOf(apiDb, decisionId)).map((a) => [a.kind, a.no_effect])).toEqual([
      ["reset_display_name", null],
      ["retire_handle", null],
    ]);
    // Below the route, in the order of the list: the trigger refuses the retirement after the reset (invalid_decision).
    await rolledBack(apiDb, async (tx) => {
      const other = await newProfile(tx as unknown as Db);
      const recorded = await intake(tx, ground.finding(moderator.id, "R4"), anAccount(other.id, other.handle));
      const params = await decisionParams(tx, moderator, recorded.items[0]!.caseId!, { kind: "final", ruleId: "R4", actions: [act("reset_display_name"), act("retire_handle")] });
      const rows = (order: ("reset_display_name" | "retire_handle")[]) =>
        refusal(
          tx.transaction(async (sp) => {
            const id = randomUUID();
            await insertDecision(sp, { id, caseId: recorded.items[0]!.caseId!, decidedBy: moderator.id, params });
            for (const kind of order) await insertAction(sp, id, { kind, mediaId: null });
          }),
        );
      expect(await rows(["reset_display_name", "retire_handle"])).toBe("invalid_decision");
      expect(await rows(["retire_handle", "reset_display_name"])).toBeNull();
    });
  });

  test("the reversal, while the profile holds the placeholder: a review of the appeal gives the handle back, clears the retirement and the change time", async () => {
    const subject = await account();
    const { caseId } = await reportedAccount(subject.id, subject.handle);
    const decisionId = await retire(caseId);
    const placeholder = placeholderOf((await retirementRow(decisionId)).id);
    expect((await profileRow(subject.id)).handle).toBe(placeholder);
    await appealOf(apiDb, decisionId, subject.id);
    const outcome = await world.reviewAs(reviewer, decisionId, { outcome: "reversed", actions: [act("unretire_handle")] });
    if (typeof outcome === "string") throw new Error(`the review was not recorded: ${outcome}`);
    expect(await profileRow(subject.id)).toMatchObject({ handle: subject.handle, handle_changed_at: null });
    expect(await historyRow(subject.handle)).toEqual({ profile_id: subject.id, retired: false });
    // The review's statement names the handle given back.
    const found = (await decisionStatement(apiDb, outcome.decisionId))!;
    expect(found.statement.reversals).toEqual([{ kind: "unretire_handle", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null, handle: subject.handle }]);
    expect(statementParagraphs(found.statement)).toContain(STATEMENT_WORDS.unretired(subject.handle));
    // It is the account's again, and nobody else's.
    const stranger = await account();
    expect(await rejection(changeHandle(s.deps, stranger.id, { handle: subject.handle }))).toBe("handle_taken");
  });

  test("the reversal, once the holder moved on: a correction keeps the new handle, clears the change time, and the old handle can be taken back at once", async () => {
    const subject = await account();
    const { caseId, intakeId } = await reportedAccount(subject.id, subject.handle);
    const decisionId = await retire(caseId);
    const moved = newHandle();
    expect((await changeHandle(s.deps, subject.id, { handle: moved })).handle).toBe(moved);
    expect((await profileRow(subject.id)).handle_changed_at).not.toBeNull();
    const correction = await decided(admin, caseId, { kind: "correction", reviewsDecisionId: decisionId, actions: [act("unretire_handle")] });
    expect(await profileRow(subject.id)).toMatchObject({ handle: moved, handle_changed_at: null });
    expect(await historyRow(subject.handle)).toEqual({ profile_id: subject.id, retired: false });
    expect(statementParagraphs((await decisionStatement(apiDb, correction))!.statement)).toContain(STATEMENT_WORDS.unretired(subject.handle));
    // Another account still cannot take it; its former holder takes it back at once, without the wait.
    const stranger = await account();
    expect(await rejection(changeHandle(s.deps, stranger.id, { handle: subject.handle }))).toBe("handle_taken");
    expect((await changeHandle(s.deps, subject.id, { handle: subject.handle })).handle).toBe(subject.handle);
    // The reporter's line, once released, reads the reversal alone: never "korbat retired the handle" after it.
    await apiDb.execute(sql`select public.release_outcomes(now())`);
    const [item] = await noticeItems(apiDb, intakeId);
    // Released after the correction, the item reads as reversed (item_current_outcome), and nothing follows the phrase.
    expect(itemOutcomeWords(await itemStatus(world.moderation.deps, item!))).toBe(`${OUTCOME_PHRASES.reversed}.`);
  });

  test("no_effect: already when the snapshot's handle is retired, deleted for a deleted account; neither touches the profile", async () => {
    // Two reports in one open case, the second arriving before anything changed: one snapshot. The first retirement answers
    // only the first report, so the case stays open, and the second answers the other with the same snapshot.
    const subject = await account();
    const first = await reportedAccount(subject.id, subject.handle);
    const second = await reportedAccount(subject.id, subject.handle);
    expect(second.caseId).toBe(first.caseId);
    const retiring = await retire(first.caseId, [], { throughSeq: 1 });
    const placeholder = placeholderOf((await retirementRow(retiring)).id);
    const again = await retire(first.caseId);
    expect((await retirementRow(again)).no_effect).toBe("already");
    expect((await profileRow(subject.id)).handle).toBe(placeholder);
    const already = (await decisionStatement(apiDb, again))!.statement;
    expect(already.measures[0]).toMatchObject({ handle: subject.handle, noEffect: "already", placeholder: null });
    expect(statementParagraphs(already)[0]).toBe(`${STATEMENT_WORDS.retireLead(subject.handle)} ${STATEMENT_WORDS.retireAlready}`);

    const gone = await account();
    const goneCase = await reportedAccount(gone.id, gone.handle);
    await apiDb.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
    const onDeleted = await retire(goneCase.caseId);
    expect((await retirementRow(onDeleted)).no_effect).toBe("deleted");
    expect((await profileRow(gone.id)).handle).toBe(gone.handle);
    expect(await historyRow(gone.handle)).toBeNull();
    expect(statementParagraphs((await decisionStatement(apiDb, onDeleted))!.statement)[0]).toBe(`${STATEMENT_WORDS.retireLead(gone.handle)} ${STATEMENT_WORDS.deletedAccount}`);
  });

  test("row 24: a retirement that cites R4 is final for months and never meets the R4 redaction: no candidate, no erasure, never counted as late", async () => {
    // The built text of the retention job and of the overview: REDACTABLE names exactly 3c's four kinds.
    const source = readFileSync(path.resolve(import.meta.dirname, "../../src/moderation/repo.ts"), "utf8");
    const redactable = source.slice(source.indexOf("const REDACTABLE = sql`"), source.indexOf("`;", source.indexOf("const REDACTABLE = sql`")));
    expect(redactable).toContain("m.kind in ('remove', 'remove_media', 'reset_bio', 'reset_display_name')");
    const subject = await account();
    const decisionId = await retire((await reportedAccount(subject.id, subject.handle)).caseId);
    const periods = { intakeDays: 30, statementMonths: 12, draftHours: 24, accessLogMonths: 12 };
    await rolledBack(world.migrateDb, async (tx) => {
      const late = (await lateErasures(tx, periods)).redactions;
      // Final for its author long ago, as only the migrator can make it here.
      await tx.execute(sql`update decisions set informed_at = informed_at - interval '7 months', decided_at = decided_at - interval '7 months' where id = ${decisionId}::uuid`);
      const [final] = await tx.execute<{ final: boolean }>(sql`select public.decision_final_at(${decisionId}::uuid) < now() - interval '1 day' as final`);
      expect(final!.final).toBe(true);
      expect(await dueRedactions(tx)).not.toContain(decisionId);
      expect((await lateErasures(tx, periods)).redactions).toBe(late);
      expect(await refusal(tx.transaction((sp) => sp.execute(sql`select public.redact_r4_body(${decisionId}::uuid)`)))).toBe("invalid_decision");
    });
    // The handle stays retired: refusing it needs it (6.7).
    expect(await historyRow(subject.handle)).toEqual({ profile_id: subject.id, retired: true });
  });

  test("this file left no row behind", async () => {
    await closeDecisions();
    await removeFixtures(world.migrateDb, made.splice(0));
    expect(await rowCounts(apiDb)).toEqual(before);
  }, 120_000);
});
