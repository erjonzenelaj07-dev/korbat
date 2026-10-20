import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { loadConfig } from "../../src/config";
import { RULE_DEFAULT_CATEGORY } from "@korbat/contracts";
import pino from "pino";
import { automatedStep, matchSignal, measureIn, sweepRound } from "../../src/moderation/automated";
import { retentionRound } from "../../src/moderation/retention";
import { insertMatchSignal, joinSignal } from "../../src/moderation/automated-repo";
import { recordIntakeIn, type IntakeGround } from "../../src/moderation/intake";
import { decisionStatement } from "../../src/moderation/statement";
import { automationDeps, matchForTest, removeAutomation, signalForTest, signalRow, systemRowOf } from "./automation-fixtures";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { MINORS, act, decisionRow, imagePost, imageStates, inForce, itemsOf, postFrozen, refusal, refusalDetail, removeFixtures, rowCounts } from "./moderation-fixtures";
import { ageCase, ageIntake, releaseItems } from "./retention-fixtures";
import { rolledBack } from "./staff-fixtures";

/** A program's finding under R2 as the step writes one for a listed match. */
const R2_GROUND: IntakeGround = {
  kind: "automated",
  channel: "system",
  reporterId: null,
  findingBy: null,
  contactId: null,
  ruleId: "R2",
  allegesIllegal: false,
  csam: false,
  category: RULE_DEFAULT_CATEGORY.R2,
  categoryKeyword: null,
  citedLaw: null,
  explanation: null,
  bonaFide: false,
  automatedProcessing: true,
};

// The step and a person's confirmed decisions run dozens of statements each: slow on a loaded machine.
vi.setConfig({ testTimeout: 180_000 });

/**
 * LAB C as tests on the built code (3d design, sections 6.6, 6.7, 7.9, 7.11 and 12.3, O4; Task 7): the automatic seal
 * against the freeze, through the API's own statements, on the migration known_material. Each case of the lab's out-C.txt
 * is one test here with its code: C1 an acting match on one of a post's two images seals both while an admin decides and
 * freezes the post; C2 gate K keeps the frozen post's image rows against the API's role; C3 a person may still seal
 * while the automatic seal stands; C4 the other order, a program's seal after a person's, is already_protected (the
 * built code accepted it in the lab); C5 the fallback (AUTOMATION_R2_ACTS=off): the finding freezes and nothing is
 * sealed; C6 a moderator cannot answer the seal, and an admin's answer without a seal needs its reason (note 26) and ends
 * the seal and the freeze, unseen; C7 an admin's seal for good replaces the automatic one and is partly automated. With
 * gate K throughout, and E's strike_due answering false for a program's interim decision. A match that is not acting,
 * of either kind, seals nothing and is a finding (of R2, freezing) or a flag (no rule, freezing nothing).
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the automatic seal on a match (3d Task 7, LAB C)", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let world: DeciderWorld;
  let moderator: RealStaff;
  let admin: RealStaff;
  let startedAt: string;
  let before: Record<string, number>;
  const authors: string[] = [];
  const media: string[] = [];

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    world = deciderWorld(apiDb);
    // One retention round first, so a row another file left for the disposal (a post its author deleted keeps its image
    // row until the disposal takes it) is not counted against this file: the 6.7 test runs the whole job, which takes it.
    await retentionRound({ apiDb, media: world.moderation.deps.media, log: pino({ level: "silent" }) });
    // Counted before the staff accounts' profiles exist: the last test removes them with the file's posts.
    before = await rowCounts(apiDb);
    moderator = await world.staff("moderator");
    admin = await world.staff("admin");
    const [row] = await apiDb.execute<{ now: string }>(sql`select now()::text as now`);
    startedAt = row!.now;
  });

  afterAll(async () => {
    await world.moderation.settle();
    await removeFixtures(migrateDb, authors);
    await removeAutomation(migrateDb, startedAt, media);
    await world.close();
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** A match record as the sweep reads it: whether the program is done with it, and the case it names. */
  const recordRow = async (matchId: string) =>
    ({ ...(await apiDb.execute<{ handled: boolean; case_id: string | null }>(sql`select handled_at is not null as handled, case_id from media_matches where id = ${matchId}::uuid`))[0]! });

  /** A post with images by a new author, committed, whose first image the comparison matched: the step's outcome on it. */
  async function matched(images = 2, kind: "acting" | "near" | "other" = "acting", config: Parameters<typeof automationDeps>[2] = {}) {
    const p = await imagePost(apiDb, images);
    authors.push(p.authorId);
    media.push(...p.mediaIds);
    const outcome = await signalForTest(automationDeps(apiDb, {}, { MEDIA_MATCH: "test", ...config }), p.mediaIds[0]!, "known_match", 1, { kind });
    return { ...p, ...outcome };
  }

  test("C1: an acting match on one of two images seals both while an admin decides, lists the post with 2 images, and freezes it; the decision is the program's, fully automated, for no admin, never due a strike", async () => {
    const p = await matched(2);
    expect(p.handled).toBe("measure");
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["sealed", "sealed"]);
    expect(await postFrozen(apiDb, p.postId)).toBe(true);
    expect(await inForce(apiDb, { caseId: p.caseId! })).toEqual(["seal_media"]);
    const decision = await decisionRow(apiDb, p.decisionId!);
    expect(decision).toMatchObject({ kind: "interim", rule_id: "R2", suspect: true, automated_detection: true, automated_decision: "fully", needs_admin: false, decided_by: null, author_mail: "pending" });
    const [listed] = await apiDb.execute<{ images: number }>(
      sql`select s.images from seal_posts s join decision_actions a on a.id = s.action_id where a.decision_id = ${p.decisionId!}::uuid and s.post_id = ${p.postId}::uuid`,
    );
    expect(listed!.images).toBe(2);
    // The system's plain audit row names the decision and the signal; the params seal the post's images under R2.
    const audit = await systemRowOf(apiDb, p.decisionId!);
    expect(audit).toMatchObject({ actor_id: SYSTEM_ACTOR_ID, action: "automated_decided", step_up: null, key_id: null });
    expect((audit!.metadata.params as { actions: unknown; ruleId: string }).actions).toEqual([{ kind: "seal_media", mediaId: null }]);
    // The finding cites R2 in lane 0, suspect; the record names its case and is marked handled (review ruling 8).
    const signal = await signalRow(apiDb, p.signalId);
    const [item] = await itemsOf(apiDb, decision.case_id);
    expect(item).toMatchObject({ id: signal.intake_item_id, lane: 0, suspect: true, media_id: p.mediaIds[0] });
    const [record] = await apiDb.execute<{ case_id: string | null; handled: boolean; acting: boolean }>(sql`select case_id, handled_at is not null as handled, acting from media_matches where id = ${p.matchId!}::uuid`);
    expect(record).toEqual({ case_id: decision.case_id, handled: true, acting: true });
    // E's strike_due answers false for the program's interim decision: no strike rests on a program's measure.
    const [due] = await apiDb.execute<{ due: boolean }>(sql`select public.strike_due(${decision.case_id}::uuid, 'incompatible', 'R2', true, ${p.decisionId!}::uuid) as due`);
    expect(due!.due).toBe(false);
    // Its statement speaks of an exact match of a cryptographic hash, a measure by automated means, and an admin.
    const found = await decisionStatement(apiDb, p.decisionId!);
    expect(found!.statement).toMatchObject({ automatedDetection: true, automatedDecision: "fully", signal: { kind: "known_match", source: "test", matchKind: "exact", listedAs: "csam", viewed: null } });
    // A second entry for the same signal finds it handled and writes nothing.
    expect((await automatedStep(automationDeps(apiDb, {}, { MEDIA_MATCH: "test" }), p.signalId)).handled).toBe("already");
  });

  test("C2: gate K while frozen: the API's role deletes none of the post's image rows", async () => {
    const p = await matched(2);
    const gone = await apiDb.execute(sql`delete from post_media where post_id = ${p.postId}::uuid returning id`);
    expect(gone.length).toBe(0);
    const [left] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from post_media where post_id = ${p.postId}::uuid`);
    expect(left!.n).toBe(2);
  });

  test("C3: a person may still seal while deciding on the case while the automatic seal stands: two seals in force", async () => {
    const p = await matched(2);
    const outcome = await world.decideAs(admin, p.caseId!, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
    expect(typeof outcome).toBe("object");
    expect(await inForce(apiDb, { caseId: p.caseId! })).toEqual(["seal_media", "seal_media"]);
    expect(await postFrozen(apiDb, p.postId)).toBe(true);
  });

  test("C4: the other order: a person's finding citing R2 and seal while deciding first, then an acting match: the program's seal is already_protected, its finding stands, its signal covered", async () => {
    const p = await imagePost(apiDb, 2);
    authors.push(p.authorId);
    media.push(...p.mediaIds);
    const finding = await world.moderation.forStaff.openFinding(admin.session, { target: { kind: "post", id: p.postId }, ground: "rule", ruleId: "R2", category: MINORS });
    await world.moderation.settle();
    const sealed = await world.decideAs(admin, finding.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
    expect(typeof sealed).toBe("object");
    const step = await signalForTest(automationDeps(apiDb, {}, { MEDIA_MATCH: "test" }), p.mediaIds[0]!, "known_match");
    expect(step.handled).toBe("covered");
    expect(step.decisionId).toBeNull();
    expect(step.caseId).toBe(finding.caseId);
    expect(await inForce(apiDb, { caseId: finding.caseId })).toEqual(["seal_media"]);
    expect((await signalRow(apiDb, step.signalId)).handled).toBe("covered");
  });

  test("C5: the fallback, AUTOMATION_R2_ACTS=off: the acting match's finding freezes the post and alerts, and nothing is sealed", async () => {
    const p = await matched(1, "acting", { AUTOMATION_R2_ACTS: "off" });
    expect([p.handled, p.decisionId]).toEqual(["finding", null]);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["visible"]);
    expect(await postFrozen(apiDb, p.postId)).toBe(true);
    expect(await inForce(apiDb, { caseId: p.caseId! })).toEqual([]);
  });

  test("C6: a moderator cannot answer the automatic seal; an admin's answer without a seal needs its reason, signed, and ends the seal and the freeze, unseen and not automated", async () => {
    const p = await matched(2);
    expect(await refusal(world.decideAs(moderator, p.caseId!, { kind: "final", outcome: "no_violation", ground: null, ruleId: null }))).toBe("admin_required");
    // Without the reason note 26 asks for, and with one on another kind of decision, decision_holds (c) refuses at commit.
    const without = world.decideAs(admin, p.caseId!, { kind: "final", outcome: "no_violation", ground: null, ruleId: null });
    expect(await refusal(without)).toBe("invalid_decision");
    expect(await refusalDetail(world.decideAs(admin, p.caseId!, { kind: "final", outcome: "no_violation", ground: null, ruleId: null, matchAnswerReason: null }))).toMatch(/^matchAnswerReason:/);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["sealed", "sealed"]);
    const answered = await world.decideAs(admin, p.caseId!, { kind: "final", outcome: "no_violation", ground: null, ruleId: null, matchAnswerReason: "source_withdrew" });
    if (typeof answered === "string") throw new Error(answered);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["visible", "visible"]);
    expect(await postFrozen(apiDb, p.postId)).toBe(false);
    expect(await inForce(apiDb, { caseId: p.caseId! })).toEqual([]);
    const row = await decisionRow(apiDb, answered.decisionId);
    expect(row).toMatchObject({ unseen: true, suspect: true, automated_detection: true, automated_decision: "not_automated" });
    const [stored] = await apiDb.execute<{ reason: string | null }>(sql`select match_answer_reason as reason from decisions where id = ${answered.decisionId}::uuid`);
    expect(stored!.reason).toBe("source_withdrew");
    // The answer's statement: a person decided, unseen, on a program's finding of an exact match.
    const found = await decisionStatement(apiDb, answered.decisionId);
    expect(found!.statement).toMatchObject({ automatedDetection: true, automatedDecision: "not_automated", signal: { kind: "known_match", matchKind: "exact", listedAs: "csam" } });
    // After the answer the images are public again, and the one function that serves staff an image still refuses them.
    expect(await world.moderation.deps.media.staffImage(p.mediaIds[0]!, "large")).toBe("matched");
  });

  test("C7: a moderator cannot seal for good; an admin's seal for good, unseen, replaces the automatic seal and is partly automated; the program's stays fully", async () => {
    const p = await matched(2);
    expect(await refusal(world.decideAs(moderator, p.caseId!, { kind: "final", ruleId: "R2", actions: [act("seal_media")] }))).toBe("admin_required");
    const sealed = await world.decideAs(admin, p.caseId!, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
    if (typeof sealed === "string") throw new Error(sealed);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["sealed", "sealed"]);
    expect(await inForce(apiDb, { caseId: p.caseId! })).toEqual(["seal_media"]);
    const final = await decisionRow(apiDb, sealed.decisionId);
    expect(final).toMatchObject({ kind: "final", unseen: true, automated_detection: true, automated_decision: "partially", needs_admin: true });
    expect(await decisionRow(apiDb, p.decisionId!)).toMatchObject({ unseen: false, automated_detection: true, automated_decision: "fully", needs_admin: false });
    // A seal for good holds no reason: the reason belongs to an answer without a seal alone.
    const [stored] = await apiDb.execute<{ reason: string | null }>(sql`select match_answer_reason as reason from decisions where id = ${sealed.decisionId}::uuid`);
    expect(stored!.reason).toBeNull();
  });

  test("a near match of the listed class is a finding under R2 that freezes and seals nothing, whatever AUTOMATION_R2_ACTS says; its answer without a seal takes no reason", async () => {
    const p = await matched(1, "near");
    expect([p.handled, p.decisionId]).toEqual(["finding", null]);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["visible"]);
    expect(await postFrozen(apiDb, p.postId)).toBe(true);
    const [item] = await itemsOf(apiDb, p.caseId!);
    expect(item).toMatchObject({ lane: 0, suspect: true });
    const answered = await world.decideAs(admin, p.caseId!, { kind: "final", outcome: "no_violation", ground: null, ruleId: null });
    expect(typeof answered).toBe("object");
    expect(await postFrozen(apiDb, p.postId)).toBe(false);
    // A reason on an answer that needs none is refused as well.
    const q = await matched(1, "near");
    expect(await refusal(world.decideAs(admin, q.caseId!, { kind: "final", outcome: "no_violation", ground: null, ruleId: null, matchAnswerReason: "other" }))).toBe("invalid_decision");
  });

  test("a match of another class is a flag: no rule, lane 2, not suspect, nothing frozen or sealed, closed to staff all the same", async () => {
    const p = await matched(1, "other");
    expect([p.handled, p.decisionId]).toEqual(["finding", null]);
    expect(await postFrozen(apiDb, p.postId)).toBe(false);
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(["visible"]);
    const [item] = await itemsOf(apiDb, p.caseId!);
    expect(item).toMatchObject({ lane: 2, suspect: false });
    const [intake] = await apiDb.execute<{ rule_id: string | null; kind: string; category: string }>(
      sql`select n.rule_id, n.kind::text as kind, n.category from intakes n join intake_items i on i.intake_id = n.id where i.id = ${item!.id}::uuid`,
    );
    expect(intake).toEqual({ rule_id: null, kind: "automated", category: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE" });
    expect(await world.moderation.deps.media.staffImage(p.mediaIds[0]!, "large")).toBe("matched");
  });

  test("the database holds that a flag cannot seal: a program's seal whose signal names a record that is not acting is refused at commit, and a finding citing R2 for an unlisted record is refused by the signal's guard", async () => {
    await rolledBack(apiDb, async (tx) => {
      const p = await imagePost(tx, 1);
      const deps = automationDeps(tx, {}, { MEDIA_MATCH: "test" });
      const live = [{ type: "post" as const, id: p.postId, position: 1, mediaId: p.mediaIds[0]! }];
      // A near match of the listed class: its finding cites R2, and a seal written on it by hand, as an API under an
      // attacker's control would write one, is refused by decision_holds (b) at commit.
      const nearSignal = (await insertMatchSignal(tx, { mediaId: p.mediaIds[0]!, matchId: await matchForTest(tx, p.mediaIds[0]!, "near") }))!;
      const sealed = tx.transaction(async (sp) => {
        await deps.social.lockAccounts(sp, [p.authorId], "no key update");
        const recorded = await recordIntakeIn(deps, sp, { ground: { ...R2_GROUND }, live });
        await joinSignal(sp, nearSignal, recorded.items[0]!.id);
        await measureIn(deps, sp, { caseId: recorded.items[0]!.caseId!, postId: p.postId, signalId: nearSignal, mediaId: p.mediaIds[0]!, rule: "R2" });
        await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
      });
      expect(await refusal(sealed)).toBe("invalid_decision");
    });
    await rolledBack(apiDb, async (tx) => {
      const q = await imagePost(tx, 1);
      const deps = automationDeps(tx, {}, { MEDIA_MATCH: "test" });
      // A match of another class: a finding citing R2 joined to its signal is refused by the guard of automated_signals.
      const flagSignal = (await insertMatchSignal(tx, { mediaId: q.mediaIds[0]!, matchId: await matchForTest(tx, q.mediaIds[0]!, "other") }))!;
      const joined = tx.transaction(async (sp) => {
        const recorded = await recordIntakeIn(deps, sp, { ground: { ...R2_GROUND }, live: [{ type: "post", id: q.postId, position: 1, mediaId: q.mediaIds[0]! }] });
        await joinSignal(sp, flagSignal, recorded.items[0]!.id);
      });
      expect(await refusal(joined)).toMatch(/^42501 moderation_column/);
    });
  });

  test("6.7's case: an automatic seal answered without a seal, its intake made due and erased by 3c's retention job, then the sweep: the match opens no new intake", async () => {
    const p = await matched(1);
    // Review ruling L6: the step marked the record itself, before any sweep ran, so the mark is the step's memory and not
    // something the sweep's own read wrote afterwards.
    expect(await recordRow(p.matchId!)).toEqual({ handled: true, case_id: p.caseId });
    const answered = await world.decideAs(admin, p.caseId!, { kind: "final", outcome: "no_violation", ground: null, ruleId: null, matchAnswerReason: "source_withdrew" });
    if (typeof answered === "string") throw new Error(answered);
    const items = async () => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from intake_items where target_id = ${p.postId}::uuid`))[0]!.n;
    const [first] = await apiDb.execute<{ intake_id: string }>(sql`select intake_id from intake_items where case_id = ${p.caseId!}::uuid limit 1`);
    // As the migrator: the answer released and the case and its intake two years old, so 3c's rules make the intake due.
    await releaseItems(migrateDb, first!.intake_id);
    await ageCase(migrateDb, p.caseId!, "2 years");
    await ageIntake(migrateDb, first!.intake_id, "2 years");
    await retentionRound({ apiDb, media: world.moderation.deps.media, log: pino({ level: "silent" }) });
    const before = await items();
    // The sweep reads the signals still waiting and the match records on posts that no signal took: this one was taken.
    await sweepRound(automationDeps(apiDb, {}, { MEDIA_MATCH: "test" }));
    expect(await items()).toBe(before);
    const [record] = await apiDb.execute<{ handled: boolean }>(sql`select handled_at is not null as handled from media_matches where media_id = ${p.mediaIds[0]!}::uuid`);
    expect(record!.handled).toBe(true);
  });

  /** A post of `images` images by a new author, committed and kept for the file's cleanup. */
  async function posted(images = 1) {
    const p = await imagePost(apiDb, images);
    authors.push(p.authorId);
    media.push(...p.mediaIds);
    return p;
  }
  /** What the program's step must have left on a post whose acting match it took: the finding, the seal and the record naming the case. */
  async function sealedByTheProgram(p: { postId: string; mediaIds: string[] }, matchId: string, caseId: string | null) {
    expect(caseId).not.toBeNull();
    expect(await imageStates(apiDb, p.mediaIds)).toEqual(p.mediaIds.map(() => "sealed"));
    expect(await inForce(apiDb, { caseId: caseId! })).toEqual(["seal_media"]);
    expect(await postFrozen(apiDb, p.postId)).toBe(true);
    expect(await recordRow(matchId)).toEqual({ handled: true, case_id: caseId });
  }

  test("review H1, first interleaving: a second entry's whole matchSignal between the first's signal and its step leaves the record unmarked, and the first's step takes the finding and the seal, the record naming its case", async () => {
    const p = await posted();
    const deps = automationDeps(apiDb, {}, { MEDIA_MATCH: "test", AUTOMATION_R2_ACTS: "on" });
    const mediaId = p.mediaIds[0]!;
    const matchId = await matchForTest(apiDb, mediaId, "acting");
    // Entry A (match-retry's late answer, or imagesPublished) has written its signal; its step has not run yet.
    const signalA = (await insertMatchSignal(apiDb, { mediaId, matchId }))!;
    // Entry B (the sweep, with the record it read before A's signal existed): its signal meets A's, and the record a
    // signal names is not B's to mark.
    expect(await matchSignal(deps, { mediaId, matchId })).toBeNull();
    expect(await recordRow(matchId)).toEqual({ handled: false, case_id: null });
    const step = await automatedStep(deps, signalA);
    expect(step.handled).toBe("measure");
    expect((await signalRow(apiDb, signalA)).handled).toBe("measure");
    await sealedByTheProgram(p, matchId, step.caseId);
  });

  test("review H1, second interleaving: the second entry's matchSignal right after the first's step read the record: the step still names its case on the record", async () => {
    const p = await posted();
    const base = automationDeps(apiDb, {}, { MEDIA_MATCH: "test", AUTOMATION_R2_ACTS: "on" });
    const mediaId = p.mediaIds[0]!;
    const matchId = await matchForTest(apiDb, mediaId, "acting");
    const signalA = (await insertMatchSignal(apiDb, { mediaId, matchId }))!;
    // Entry B runs whole, on connections of its own, the moment A's step has read the record inside its transaction.
    let entered = false;
    const media = {
      ...base.media,
      async matchRecord(q: Parameters<typeof base.media.matchRecord>[0], id: string) {
        const record = await base.media.matchRecord(q, id);
        if (!entered) {
          entered = true;
          await matchSignal(base, { mediaId, matchId });
        }
        return record;
      },
    };
    const step = await automatedStep({ ...base, media }, signalA);
    expect(entered).toBe(true);
    expect(step.handled).toBe("measure");
    await sealedByTheProgram(p, matchId, step.caseId);
  });

  test("review H1: a record marked handled with no case while its signal waits, as the conflicting branch left one before this fix: the signal's step runs, and the record gains the case", async () => {
    const p = await posted();
    const deps = automationDeps(apiDb, {}, { MEDIA_MATCH: "test", AUTOMATION_R2_ACTS: "on" });
    const mediaId = p.mediaIds[0]!;
    const matchId = await matchForTest(apiDb, mediaId, "acting");
    const signalId = (await insertMatchSignal(apiDb, { mediaId, matchId }))!;
    await apiDb.execute(sql`update media_matches set handled_at = now() where id = ${matchId}::uuid`);
    expect(await recordRow(matchId)).toEqual({ handled: true, case_id: null });
    const step = await automatedStep(deps, signalId);
    expect(step.handled).toBe("measure");
    await sealedByTheProgram(p, matchId, step.caseId);
    // A second record of the same image, which no signal names, is still marked by the conflicting branch alone.
    const second = await matchForTest(apiDb, mediaId, "acting");
    expect(await matchSignal(deps, { mediaId, matchId: second })).toBeNull();
    expect(await recordRow(second)).toEqual({ handled: true, case_id: null });
  });

  test("review H1, the sweep's round whose retry fails: the signal's step throws, the round's second read leaves its record alone, and the next round takes the finding and the seal", async () => {
    const p = await posted();
    const mediaId = p.mediaIds[0]!;
    const matchId = await matchForTest(apiDb, mediaId, "acting");
    const signalId = (await insertMatchSignal(apiDb, { mediaId, matchId }))!;
    // As the migrator: the signal two minutes old, so the sweep's first read holds it (a step that crashed or failed).
    await migrateDb.execute(sql`update automated_signals set created_at = created_at - interval '2 minutes' where id = ${signalId}::uuid`);
    const base = automationDeps(apiDb, {}, { MEDIA_MATCH: "test", AUTOMATION_R2_ACTS: "on" });
    // The step's first run fails on the author's lock, as a step fails on a lost connection: not a retried error.
    let failures = 0;
    const social = {
      ...base.social,
      async lockAccounts(...args: Parameters<typeof base.social.lockAccounts>) {
        if (failures === 0 && args[1].includes(p.authorId)) {
          failures++;
          throw new Error("a failure of the test's own");
        }
        return base.social.lockAccounts(...args);
      },
    };
    const first = await sweepRound({ ...base, social });
    expect(failures).toBe(1);
    expect(first.failed).toBeGreaterThanOrEqual(1);
    // The round's second read did not mark the record its own signal names.
    expect(await recordRow(matchId)).toEqual({ handled: false, case_id: null });
    expect((await signalRow(apiDb, signalId)).handled).toBeNull();
    await sweepRound(base);
    expect((await signalRow(apiDb, signalId)).handled).toBe("measure");
    const [item] = await apiDb.execute<{ case_id: string }>(sql`select case_id from intake_items where target_id = ${p.postId}::uuid`);
    await sealedByTheProgram(p, matchId, item?.case_id ?? null);
  });

  test("review H1: twenty signals whose step ends with nothing written fill the sweep's first read, and its second read still takes a record that no signal names", async () => {
    const dead: string[] = [];
    for (let post = 0; post < 5; post++) {
      const q = await posted(4);
      for (const mediaId of q.mediaIds) {
        const matchId = await matchForTest(apiDb, mediaId, "acting");
        dead.push((await insertMatchSignal(apiDb, { mediaId, matchId }))!);
        // As the migrator: the record erased as its retention erases one, so its signal's step ends with nothing written.
        await migrateDb.execute(sql`update media_matches set erased_at = now(), hash = null, classification = null where id = ${matchId}::uuid`);
      }
    }
    // As the migrator: the twenty signals two minutes old, so the first read holds them, the oldest first.
    await migrateDb.execute(sql`update automated_signals set created_at = created_at - interval '2 minutes' where id = any(${`{${dead.join(",")}}`}::uuid[])`);
    const p = await posted();
    const matchId = await matchForTest(apiDb, p.mediaIds[0]!, "acting");
    const round = await sweepRound(automationDeps(apiDb, {}, { MEDIA_MATCH: "test", AUTOMATION_R2_ACTS: "on" }));
    expect(round.signalled).toBeGreaterThanOrEqual(1);
    const [item] = await apiDb.execute<{ case_id: string }>(sql`select case_id from intake_items where target_id = ${p.postId}::uuid`);
    await sealedByTheProgram(p, matchId, item?.case_id ?? null);
  });

  test("this file left no row behind", async () => {
    await world.moderation.settle();
    await removeFixtures(migrateDb, authors);
    await removeAutomation(migrateDb, startedAt, media);
    await migrateDb.execute(sql`delete from profiles where id = any(${`{${[moderator.id, admin.id].join(",")}}`}::uuid[])`);
    authors.length = 0;
    media.length = 0;
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
