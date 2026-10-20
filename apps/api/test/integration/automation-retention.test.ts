import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { AUTOMATION_RULES, EDGE_RULES, ExportFormat, RETENTION } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig, type Config } from "../../src/config";
import { createMatchRepo } from "../../src/media/match-repo";
import { insertMatchSignal, insertScoreSignal } from "../../src/moderation/automated-repo";
import { exportFor } from "../../src/moderation/export";
import { RETENTION_ACTION, retentionRound } from "../../src/moderation/retention";
import { decisionStatement } from "../../src/moderation/statement";
import { automationDeps, matchForTest, removeAutomation, signalForTest } from "./automation-fixtures";
import { ageCustodyForTest } from "./custody-fixtures";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, casesMedia, imagePost, moderationDeps, newImageRow, removeFixtures } from "./moderation-fixtures";
import { ageCase, authAccount, one } from "./retention-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Real decisions are confirmed with a software authenticator, and a round of the retention job reads the whole database.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const KEEP = AUTOMATION_RULES.matchKeepDays;
const days = (n: number) => `${n} days`;

/**
 * Row 26 of the 3d design (sections 2 rows 33 and 37, 6.8, 6.10 and 7.14; Task 8): the records of the automated tools are
 * kept as the terms and the notices say, and no longer. The scenarios a person's or a program's decision makes are
 * committed through the API's own statements; every move of the clock is made as the migrator in a transaction that is
 * rolled back (the forced times can be moved by no other role, and no setting shortens a number of automation_rules()).
 * erase_automation_records is called as the retention job calls it; the job's three new steps run in a round of their own.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the retention of the automated tools' records (3d Task 8, row 26)", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let world: DeciderWorld;
  let admin: RealStaff;
  let startedAt: string;
  // Read in beforeAll: the unit run imports this file without the integration environment.
  let config: Config;
  const authors: string[] = [];
  const media: string[] = [];
  const log = pino({ level: "silent" });

  beforeAll(async () => {
    config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    world = deciderWorld(apiDb);
    admin = await world.staff("admin");
    startedAt = (await one<{ now: string }>(apiDb, sql`select now()::text as now`)).now;
  });

  afterAll(async () => {
    await world.moderation.settle();
    await removeFixtures(migrateDb, authors);
    await removeAutomation(migrateDb, startedAt, media);
    await world.close();
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** One call of the function, as the job's step makes it. */
  const erase = async (tx: DbTx) => (await one<{ n: number }>(tx, sql`select public.erase_automation_records() as n`)).n;
  /** What a match record keeps of itself, by its image. */
  const recordOf = (tx: DbTx, mediaId: string) =>
    one<{ erased: boolean; hash: boolean; classification: boolean; source: string; list_version: string | null; hash_type: string; match_kind: string; acting: boolean }>(
      tx,
      sql`select erased_at is not null as erased, hash is not null as hash, classification is not null as classification, source, list_version, hash_type, match_kind, acting
            from public.media_matches where media_id = ${mediaId}::uuid`,
    );
  /** The rows of the five tables that are the proof of a destruction and of the word it rests on. */
  const proofCounts = (tx: DbTx) =>
    one<Record<string, number>>(
      tx,
      sql`select (select count(*)::int from public.releases) as releases, (select count(*)::int from public.release_posts) as release_posts,
                 (select count(*)::int from public.release_leaves) as release_leaves, (select count(*)::int from public.release_notices) as release_notices,
                 (select count(*)::int from public.quarantine_files) as quarantine_files`,
    );

  /** A post with one image by a new author, committed, whose image an acting match sealed by a program's decision. */
  async function matched() {
    const p = await imagePost(apiDb, 1);
    authors.push(p.authorId);
    media.push(...p.mediaIds);
    const outcome = await signalForTest(automationDeps(apiDb, {}, { MEDIA_MATCH: "test" }), p.mediaIds[0]!, "known_match");
    if (outcome.caseId === null || outcome.decisionId === null) throw new Error("the match took no measure");
    return { ...p, caseId: outcome.caseId, decisionId: outcome.decisionId };
  }

  /** A release as the migrator records one, released that many days ago, of a post or of a refusal. */
  async function releaseFor(tx: DbTx, by: string, target: { postId: string } | { refusalId: string }, ago: number): Promise<string> {
    const { id } = await one<{ id: string }>(
      tx,
      "postId" in target
        ? sql`insert into public.releases (post_ids, basis, released_by, released_at, backups_clear_at, author_notice)
              values (array[${target.postId}::uuid], 'period', ${by}::uuid, now() - make_interval(days => ${ago}::int), now(), 'none') returning id`
        : sql`insert into public.releases (upload_refusal_id, post_ids, basis, released_by, released_at, backups_clear_at, author_notice)
              values (${target.refusalId}::uuid, '{}'::uuid[], 'period', ${by}::uuid, now() - make_interval(days => ${ago}::int), now(), 'none') returning id`,
    );
    if ("postId" in target) await tx.execute(sql`insert into public.release_posts (post_id, release_id) values (${target.postId}::uuid, ${id}::uuid)`);
    else await tx.execute(sql`update public.upload_refusals set release_id = ${id}::uuid where id = ${target.refusalId}::uuid`);
    return id;
  }

  test("a match record on a case is erased matchKeepDays after the case closed and not a day before; what stays names the source, the list's version, the hash type, the kind of match and whether it acted", async () => {
    expect(RETENTION.matchKeepDays).toBe(KEEP);
    const p = await matched();
    const answered = await world.decideAs(admin, p.caseId, { kind: "final", outcome: "no_violation", ground: null, ruleId: null, matchAnswerReason: "source_withdrew" });
    if (typeof answered === "string") throw new Error(answered);
    await rolledBack(migrateDb, async (tx) => {
      await ageCase(tx, p.caseId, days(KEEP - 1));
      await erase(tx);
      expect(await recordOf(tx, p.mediaIds[0]!)).toMatchObject({ erased: false, hash: true, classification: true });
      await ageCase(tx, p.caseId, days(2));
      expect(await erase(tx)).toBeGreaterThanOrEqual(1);
      expect(await recordOf(tx, p.mediaIds[0]!)).toEqual({ erased: true, hash: false, classification: false, source: "test", list_version: expect.any(String), hash_type: "sha256", match_kind: "exact", acting: true });
      // Once the record is erased, staff are no longer refused the image for a match (gate V reads unerased records).
      const [named] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.media_matches where media_id = ${p.mediaIds[0]!}::uuid and erased_at is null`);
      expect(named!.n).toBe(0);
    });
  });

  test("never while a seal for good in force lists the post and the post is not released; for a released post the days run from the release, and nothing of the release, its posts, the leaves, the notices or the quarantine is touched", async () => {
    const p = await matched();
    const sealed = await world.decideAs(admin, p.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
    if (typeof sealed === "string") throw new Error(sealed);
    await rolledBack(migrateDb, async (tx) => {
      await ageCase(tx, p.caseId, days(KEEP * 3));
      await erase(tx);
      expect((await recordOf(tx, p.mediaIds[0]!)).erased).toBe(false);
      const release = await releaseFor(tx, admin.id, { postId: p.postId }, KEEP - 1);
      await erase(tx);
      expect((await recordOf(tx, p.mediaIds[0]!)).erased).toBe(false);
      await tx.execute(sql`update public.releases set released_at = now() - make_interval(days => ${KEEP + 1}::int) where id = ${release}::uuid`);
      const before = await proofCounts(tx);
      expect(await erase(tx)).toBeGreaterThanOrEqual(1);
      expect((await recordOf(tx, p.mediaIds[0]!)).erased).toBe(true);
      expect(await proofCounts(tx)).toEqual(before);
    });
  });

  test("an upload's record is kept while its hold is unended or ended as report and not released; matchKeepDays after the release, or after an end as no_report, it is erased, and the refusal loses its account and its objection, also when korbat reported it", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const refused = async () => {
        const owner = await newProfile(tx as unknown as Db);
        const image = await newImageRow(tx, owner.id, null);
        const matchId = await matchForTest(tx, image, "acting");
        const refusalId = await createMatchRepo(tx as unknown as Db).insertRefusal(tx, { mediaId: image, ownerId: owner.id, matchId });
        await tx.execute(sql`update public.upload_refusals set objection = 'It is a photo of my own garden.', objected_at = now() where id = ${refusalId}::uuid`);
        return { owner: owner.id, image, refusalId };
      };
      const refusalOf = (id: string) =>
        one<{ owner: string | null; objection: string | null; objected: boolean; ended: boolean; released: boolean }>(
          tx,
          sql`select owner_id as owner, objection, objected_at is not null as objected, ended_at is not null as ended, release_id is not null as released from public.upload_refusals where id = ${id}::uuid`,
        );

      // Reported and released: kept, unended, for three times the days; kept after the end as report; erased after the release.
      const a = await refused();
      await ageCustodyForTest(tx, { refusal: a.refusalId }, days(KEEP * 3));
      await erase(tx);
      expect((await recordOf(tx, a.image)).erased).toBe(false);
      await tx.execute(sql`update public.upload_refusals set ended_at = now() - make_interval(days => ${KEEP * 2}::int), end_as = 'report', ended_by = ${a.owner}::uuid, notification_id = gen_random_uuid() where id = ${a.refusalId}::uuid`);
      await erase(tx);
      expect((await recordOf(tx, a.image)).erased).toBe(false);
      expect((await refusalOf(a.refusalId)).owner).toBe(a.owner);
      await releaseFor(tx, a.owner, { refusalId: a.refusalId }, KEEP - 1);
      await erase(tx);
      expect((await recordOf(tx, a.image)).erased).toBe(false);
      await tx.execute(sql`update public.releases set released_at = now() - make_interval(days => ${KEEP + 1}::int) where upload_refusal_id = ${a.refusalId}::uuid`);
      await erase(tx);
      expect((await recordOf(tx, a.image)).erased).toBe(true);
      // What stays says that an upload was refused on a day and how its hold ended, and names nobody.
      expect(await refusalOf(a.refusalId)).toEqual({ owner: null, objection: null, objected: true, ended: true, released: true });

      // Ended as no_report: kept the day before, erased the day after.
      const b = await refused();
      await tx.execute(sql`update public.upload_refusals set ended_at = now() - make_interval(days => ${KEEP - 1}::int), end_as = 'no_report', end_reason = 'other', ended_by = ${b.owner}::uuid where id = ${b.refusalId}::uuid`);
      await erase(tx);
      expect((await recordOf(tx, b.image)).erased).toBe(false);
      expect((await refusalOf(b.refusalId)).owner).toBe(b.owner);
      await tx.execute(sql`update public.upload_refusals set ended_at = now() - make_interval(days => ${KEEP + 1}::int) where id = ${b.refusalId}::uuid`);
      await erase(tx);
      expect((await recordOf(tx, b.image)).erased).toBe(true);
      expect(await refusalOf(b.refusalId)).toMatchObject({ owner: null, objection: null });
    });
  });

  test("a match that only flags, on an upload that was never posted, is erased matchKeepDays after the comparison", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const owner = await newProfile(tx as unknown as Db);
      const image = await newImageRow(tx, owner.id, null);
      await matchForTest(tx, image, "other");
      await tx.execute(sql`update public.media_matches set queried_at = now() - make_interval(days => ${KEEP - 1}::int) where media_id = ${image}::uuid`);
      await erase(tx);
      expect((await recordOf(tx, image)).erased).toBe(false);
      await tx.execute(sql`update public.media_matches set queried_at = now() - make_interval(days => ${KEEP + 1}::int) where media_id = ${image}::uuid`);
      await erase(tx);
      expect(await recordOf(tx, image)).toMatchObject({ erased: true, hash: false, classification: false, acting: false });
    });
  });

  test("a request for a person is erased with its decision's texts, by 3c's test: once its subject's account has been deleted for 12 months; the program's signal, which its statement reads, goes then too and not before", async () => {
    const p = await imagePost(apiDb, 1);
    authors.push(p.authorId);
    media.push(...p.mediaIds);
    const outcome = await signalForTest(automationDeps(apiDb), p.mediaIds[0]!);
    if (outcome.decisionId === null) throw new Error("the score took no measure");
    await apiDb.execute(sql`insert into public.automated_objections (decision_id, text) values (${outcome.decisionId}::uuid, 'It is a painting, please look again.')`);
    const objection = (tx: DbTx) =>
      one<{ text: string | null; erased: boolean }>(tx, sql`select text, erased_at is not null as erased from public.automated_objections where decision_id = ${outcome.decisionId!}::uuid`);
    const signals = async (tx: DbTx) => (await one<{ n: number }>(tx, sql`select count(*)::int as n from public.automated_signals where id = ${outcome.signalId}::uuid`)).n;
    // Its intake erased by 3c's retention, its subject alive: the signal stays, and the statement still reads it.
    await rolledBack(migrateDb, async (tx) => {
      await tx.execute(sql`update public.intakes set erased_at = now() where id = (select i.intake_id from public.intake_items i join public.automated_signals s on s.intake_item_id = i.id where s.id = ${outcome.signalId}::uuid)`);
      await authAccount(tx, p.authorId, "11 months");
      await erase(tx);
      expect(await objection(tx)).toEqual({ text: "It is a painting, please look again.", erased: false });
      expect(await signals(tx)).toBe(1);
      expect((await decisionStatement(tx as unknown as Db, outcome.decisionId!))!.statement.signal).toMatchObject({ kind: "r1_score" });
    });
    await rolledBack(migrateDb, async (tx) => {
      await tx.execute(sql`update public.intakes set erased_at = now() where id = (select i.intake_id from public.intake_items i join public.automated_signals s on s.intake_item_id = i.id where s.id = ${outcome.signalId}::uuid)`);
      await authAccount(tx, p.authorId, "13 months");
      expect(await erase(tx)).toBeGreaterThanOrEqual(2);
      expect(await objection(tx)).toEqual({ text: null, erased: true });
      expect(await signals(tx)).toBe(0);
    });
  });

  test("a signal no statement reads is deleted: a score's handled as gone matchKeepDays after it was handled, a match's once its record is erased; an unhandled one never", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const p = await imagePost(tx, 3);
      const gone = (await insertScoreSignal(tx, { mediaId: p.mediaIds[0]!, score: 1, thresholdVersion: 0 }))!;
      const waiting = (await insertScoreSignal(tx, { mediaId: p.mediaIds[1]!, score: 1, thresholdVersion: 0 }))!;
      await tx.execute(sql`update public.automated_signals set handled = 'gone', handled_at = now() - make_interval(days => ${KEEP - 1}::int) where id = ${gone}::uuid`);
      await tx.execute(sql`update public.automated_signals set created_at = now() - make_interval(days => ${KEEP * 3}::int) where id = ${waiting}::uuid`);
      const matchId = await matchForTest(tx, p.mediaIds[2]!, "other");
      const flagged = (await insertMatchSignal(tx, { mediaId: p.mediaIds[2]!, matchId }))!;
      await tx.execute(sql`update public.automated_signals set handled = 'gone', handled_at = now() where id = ${flagged}::uuid`);
      const left = async () => [...(await tx.execute<{ id: string }>(sql`select id from public.automated_signals where id in (${gone}::uuid, ${waiting}::uuid, ${flagged}::uuid) order by id`))].map((row) => row.id);
      await erase(tx);
      expect(await left()).toEqual([gone, waiting, flagged].sort());
      await tx.execute(sql`update public.automated_signals set handled_at = now() - make_interval(days => ${KEEP + 1}::int) where id = ${gone}::uuid`);
      await tx.execute(sql`update public.media_matches set queried_at = now() - make_interval(days => ${KEEP + 1}::int) where id = ${matchId}::uuid`);
      await erase(tx);
      expect(await left()).toEqual([waiting]);
    });
  });

  test("the export (W.10): a program's decision is an entry with what its statement says of automated means and the objection with its time; a refused upload is listed as its notice reads it, with no file and no hash; a release only once its author may be told", async () => {
    const p = await imagePost(apiDb, 1);
    authors.push(p.authorId);
    media.push(...p.mediaIds);
    const outcome = await signalForTest(automationDeps(apiDb), p.mediaIds[0]!);
    if (outcome.decisionId === null) throw new Error("the score took no measure");
    await apiDb.execute(sql`insert into public.automated_objections (decision_id, text) values (${outcome.decisionId}::uuid, 'It is a painting.')`);
    await rolledBack(migrateDb, async (tx) => {
      // A held upload of the same account, objected to; and a release of its post whose notice is held.
      const image = await newImageRow(tx, p.authorId, null);
      const refusalId = await createMatchRepo(tx as unknown as Db).insertRefusal(tx, { mediaId: image, ownerId: p.authorId, matchId: await matchForTest(tx, image, "acting") });
      await tx.execute(sql`update public.upload_refusals set objection = 'It is my own photo.', objected_at = now() where id = ${refusalId}::uuid`);
      const release = await releaseFor(tx, admin.id, { postId: p.postId }, 1);
      await tx.execute(sql`update public.releases set author_notice = 'held' where id = ${release}::uuid`);
      const exported = async () => ExportFormat.shape.moderation.parse(await exportFor(moderationDeps(tx), p.authorId));

      const held = await exported();
      const entry = held.decisions.find((decision) => decision.id === outcome.decisionId)!;
      expect(entry).toMatchObject({ kind: "interim", automatedDetection: true, automatedDecision: "fully", signal: { kind: "r1_score", source: null, matchKind: null, listedAs: null, viewed: null } });
      expect(entry.objection).toEqual({ text: "It is a painting.", createdAt: expect.stringMatching(/Z$/) });
      expect(held.uploads).toEqual([
        { id: refusalId, refusedAt: expect.any(String), source: "test", matchKind: "exact", listedAs: "csam", objection: { text: "It is my own photo.", objectedAt: expect.any(String) }, mayObject: false, endedAt: null, endAs: null, endReason: null, released: null, reportKept: false },
      ]);
      expect(JSON.stringify(held)).not.toMatch(/"hash"|classification|listVersion|"score"|"file"/);
      // While its notice is held, the release is in no export; once it may be told, it is, with its ground and its time.
      expect(held.releases).toEqual([]);
      await tx.execute(sql`update public.releases set author_notice = 'pending' where id = ${release}::uuid`);
      expect((await exported()).releases).toEqual([{ id: release, basis: "period", releasedAt: expect.any(String), upload: false }]);
    });
  });

  describe("the retention job's three steps (7.14)", () => {
    const settings = (over: Partial<Config>) => ({ ...config, MODERATION_RETENTION: "on" as const, MEDIA_MATCH: "off", R1_CLASSIFIER: "off" as const, ...over });
    const auditSince = (tx: DbTx, after: number, step: string) =>
      tx.execute<{ metadata: Record<string, unknown>; actor_id: string; step_up: unknown }>(
        sql`select metadata, actor_id, step_up from public.audit_log where action = ${RETENTION_ACTION} and chain_seq > ${after} and metadata ->> 'step' = ${step} order by chain_seq`,
      );
    const head = async (tx: DbTx) => (await one<{ seq: number }>(tx, sql`select seq::int as seq from public.audit_head where id = 1`)).seq;

    test("edge_purges deletes the outbox rows done EDGE_RULES.keepDays ago, never one done later or still pending, with an audit row of its count", async () => {
      expect(RETENTION.edgePurgeDays).toBe(EDGE_RULES.keepDays);
      await rolledBack(migrateDb, async (tx) => {
        const ids: string[] = [];
        for (const done of [EDGE_RULES.keepDays + 1, EDGE_RULES.keepDays - 1, null]) {
          const { id } = await one<{ id: string }>(tx, sql`insert into public.edge_purges (media_id, cause, created_at, next_at) values (gen_random_uuid(), 'state', now(), now()) returning id::text as id`);
          if (done !== null) await tx.execute(sql`update public.edge_purges set outcome = 'off', done_at = now() - make_interval(days => ${done}::int) where id = ${id}::bigint`);
          ids.push(id);
        }
        const after = await head(tx);
        const report = await retentionRound({ apiDb: tx as unknown as Db, media: casesMedia(tx), log, config: settings({ MEDIA_MATCH: "test", R1_CLASSIFIER: "test" }) });
        expect(report.edgePurges).toBeGreaterThanOrEqual(1);
        expect([...(await tx.execute<{ id: string }>(sql`select id::text as id from public.edge_purges where id = any(${`{${ids.join(",")}}`}::bigint[]) order by id`))].map((row) => row.id)).toEqual(ids.slice(1));
        const [row] = await auditSince(tx, after, "edge_purges");
        expect(row).toMatchObject({ metadata: { step: "edge_purges", count: report.edgePurges }, step_up: null });
      });
    });

    test("tools_off: while the comparison is off every stored hash goes, and while the R1 check is off every stored rating, but one an unhandled signal names; while a tool is on, nothing of it goes; and MODERATION_RETENTION=off holds every step but this one", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const p = await imagePost(tx, 3);
        const matches = createMatchRepo(tx as unknown as Db);
        for (const id of p.mediaIds) await matches.insertHashes(tx, id, { sha256: randomBytes(32), sha1: randomBytes(20), md5: randomBytes(16) });
        await tx.execute(sql`update public.post_media set nsfw_score = 0.9 where id = any(${`{${p.mediaIds.join(",")}}`}::uuid[])`);
        // The third image's score waits for the sweep: a person is still to be shown it, so it stays.
        await insertScoreSignal(tx, { mediaId: p.mediaIds[2]!, score: 0.9, thresholdVersion: 0 });
        // A due outbox row, which MODERATION_RETENTION=off keeps.
        const { id: due } = await one<{ id: string }>(tx, sql`insert into public.edge_purges (media_id, cause, created_at, next_at) values (gen_random_uuid(), 'state', now(), now()) returning id::text as id`);
        await tx.execute(sql`update public.edge_purges set outcome = 'off', done_at = now() - make_interval(days => ${EDGE_RULES.keepDays + 1}::int) where id = ${due}::bigint`);
        const state = async () =>
          one<{ hashes: number; scores: number; purge: number }>(
            tx,
            sql`select (select count(*)::int from public.media_hashes) as hashes,
                       (select count(*)::int from public.post_media where nsfw_score is not null and id = any(${`{${p.mediaIds.join(",")}}`}::uuid[])) as scores,
                       (select count(*)::int from public.edge_purges where id = ${due}::bigint) as purge`,
          );

        // On (the test adapters), and on with its measure: a tool keeps what it stored with the image.
        for (const acts of ["off", "on"] as const) {
          const kept = await retentionRound({ apiDb: tx as unknown as Db, media: casesMedia(tx), log, config: settings({ MODERATION_RETENTION: "off", MEDIA_MATCH: "test", R1_CLASSIFIER: "test", AUTOMATION_R1_ACTS: acts, AUTOMATION_R2_ACTS: acts }) });
          expect(kept.toolsOff).toBe(0);
          expect((await state()).hashes).toBeGreaterThanOrEqual(3);
          expect((await state()).scores).toBe(3);
        }

        // Off again after it ran, with the switch off: the step forgets both, writes its audit row, and nothing else runs.
        const after = await head(tx);
        const off = await retentionRound({ apiDb: tx as unknown as Db, media: casesMedia(tx), log, config: settings({ MODERATION_RETENTION: "off" }) });
        expect(off).toMatchObject({ drafts: 0, cases: 0, intakes: 0, statements: 0, automationRecords: 0, edgePurges: 0, batches: [], failed: 0 });
        expect(off.toolsOff).toBeGreaterThanOrEqual(5);
        expect(await state()).toEqual({ hashes: 0, scores: 1, purge: 1 });
        const rows = await auditSince(tx, after, "tools_off");
        expect(rows.map((row) => ({ ...row }))).toEqual([{ metadata: { step: "tools_off", caseId: null, intakeId: null, decisionId: null, count: off.toolsOff }, actor_id: "00000000-0000-0000-0000-000000000000", step_up: null }]);
        // A second round finds nothing to forget and writes nothing.
        const again = await retentionRound({ apiDb: tx as unknown as Db, media: casesMedia(tx), log, config: settings({ MODERATION_RETENTION: "off" }) });
        expect(again.toolsOff).toBe(0);
        expect(await auditSince(tx, after, "tools_off")).toHaveLength(1);
      });
    });

    test("automation_records is one call of erase_automation_records in a step of its own, with an audit row of its count", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const owner = await newProfile(tx as unknown as Db);
        const image = await newImageRow(tx, owner.id, null);
        await matchForTest(tx, image, "other");
        await tx.execute(sql`update public.media_matches set queried_at = now() - make_interval(days => ${KEEP + 1}::int) where media_id = ${image}::uuid`);
        const after = await head(tx);
        const report = await retentionRound({ apiDb: tx as unknown as Db, media: casesMedia(tx), log, config: settings({}) });
        expect(report.automationRecords).toBeGreaterThanOrEqual(1);
        expect((await recordOf(tx, image)).erased).toBe(true);
        const [row] = await auditSince(tx, after, "automation_records");
        expect(row).toMatchObject({ metadata: { step: "automation_records", count: report.automationRecords }, step_up: null });
      });
    });
  });
});
