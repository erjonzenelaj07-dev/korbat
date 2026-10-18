import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import type { AuthForModeration } from "../../src/auth";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import type { JobLock } from "../../src/lib/jobs";
import { MemoryJobLock } from "../../src/lib/jobs";
import { DISPOSAL_BATCH, type MediaForCases } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { authorDecisionView } from "../../src/moderation/author";
import { erasureOverdue, ERASURE_OVERDUE_TTL_MS } from "../../src/moderation/cases";
import { recordIntake } from "../../src/moderation/intake";
import { RETENTION_ACTION, RETENTION_INTERVAL_MS, RETENTION_JOB, RETENTION_OFF_WARNING, createRetentionJob, retentionRound } from "../../src/moderation/retention";
import { socialForModeration } from "../../src/social";
import { newUserWithDevice } from "./auth-fixtures";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { aPost, act, anAccount, authCaseCounts, casesMedia, gate, ground, imagePost, insertItem, intake, moderationCounts, newImageRow, newMarker, newPostRow, noAuthForModeration, refusal, removeFixtures, report, saveText, untilBlocked } from "./moderation-fixtures";
import { ageCase, ageIntake, authAccount, evidenceLeft, one, releaseItems } from "./retention-fixtures";
import { newProfile } from "./social-fixtures";
import { withLockTimeout } from "./staff-fixtures";

// Real decisions are confirmed with a software authenticator, and each round reads and writes dozens of rows.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * The retention job, the purge's forgetting and the erasures' races (3c design, sections 6.6, 7.9, 7.10 and 12), on
 * committed rows: the job runs on the API's pool, as the server runs it, over cases that real, confirmed decisions
 * closed. The clock is moved by dating a case back as the migrator (ageCase). Everything a test committed about its
 * profiles is removed at the end; the audit rows stay, as the record does. 3e's two steps (a reply's text and the
 * reporting counts) are in every round's report, at 0 here; standing-retention.test.ts tests what they erase.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the retention job", () => {
  let apiDb: Db;
  let w: DeciderWorld;
  let mod: RealStaff;
  let admin: RealStaff;
  let before: Record<string, number>;
  let beforeAuth: Record<string, number>;
  /** The profiles the tests committed, and the auth rows the migrator made for some of them. */
  const profilesMade: string[] = [];
  const authRowsMade: string[] = [];
  const log = pino({ level: "silent" });

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 6 });
    w = deciderWorld(apiDb);
    before = await moderationCounts(apiDb);
    beforeAuth = await authCaseCounts(w.migrateDb);
    mod = await w.staff("moderator");
    admin = await w.staff("admin");
  });
  afterAll(async () => {
    try {
      await removeFixtures(w.migrateDb, profilesMade);
      if (authRowsMade.length > 0) await w.migrateDb.execute(sql`delete from auth.users where id = any(${`{${authRowsMade.join(",")}}`}::uuid[])`);
    } finally {
      await w.close();
      await closeDb(apiDb);
    }
  });

  /** The media module's interface for cases over the API's pool, recording every batch the disposal takes and every request for files, in order. */
  function recordingMedia(onRequest?: (ids: readonly string[]) => Promise<void>): { media: MediaForCases; events: string[]; requested: string[][] } {
    const real = casesMedia(apiDb);
    const events: string[] = [];
    const requested: string[][] = [];
    const media: MediaForCases = {
      ...real,
      dropDisposable: async (tx) => {
        const ids = await real.dropDisposable(tx);
        events.push(`deleted ${ids.length}`);
        return ids;
      },
      requestDeletion: async (ids) => {
        events.push(`requested ${ids.length}`);
        requested.push([...ids]);
        await onRequest?.(ids);
      },
    };
    return { media, events, requested };
  }
  const round = (media: MediaForCases) => retentionRound({ apiDb, media, log });
  /** The retention rows of the audit log after a place, as the record holds them. */
  const retentionRows = async (after: number) =>
    [...(await apiDb.execute<{ place: number; actor_id: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown>; step_up: unknown }>(
      sql`select chain_seq::int as place, actor_id, target_type, target_id, metadata, step_up from audit_log where action = ${RETENTION_ACTION} and chain_seq > ${after} order by chain_seq`,
    ))].map((row) => ({ ...row }));
  const head = async () => (await one<{ seq: number }>(apiDb, sql`select seq::int as seq from audit_head where id = 1`)).seq;
  /** A post with images whose author is committed and remembered for the clean-up. */
  async function post(images: number, authorId?: string) {
    const p = await imagePost(apiDb, images, authorId);
    if (!authorId) profilesMade.push(p.authorId);
    return p;
  }
  /** A report about the target by someone new, remembered for the clean-up. */
  async function reported(target: Parameters<typeof report>[1], by: Parameters<typeof report>[2] = "rule") {
    const made = await report(apiDb, target, by);
    const [sender] = await apiDb.execute<{ id: string | null }>(sql`select reporter_id as id from intakes where id = ${made.recorded.intakeId}::uuid`);
    if (sender?.id) profilesMade.push(sender.id);
    return made;
  }
  const authorDeletes = (postId: string, ago = "0 seconds") =>
    w.migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() - ${ago}::interval where id = ${postId}::uuid`);
  const decided = (outcome: Awaited<ReturnType<DeciderWorld["decideAs"]>>): string => {
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  };
  const imagesLeft = async (ids: readonly string[]) => [...(await apiDb.execute<{ id: string }>(sql`select id from post_media where id = any(${`{${ids.join(",")}}`}::uuid[]) order by id`))].map((row) => row.id);

  test("the job runs every ten minutes under the lock job:moderation-retention, and skips a round another instance holds", async () => {
    expect(RETENTION_INTERVAL_MS).toBe(10 * 60_000);
    expect(RETENTION_JOB).toBe("moderation-retention");
    const lock = new MemoryJobLock();
    const job = createRetentionJob({ apiDb, media: casesMedia(apiDb), log }, lock);
    await lock.acquire("job:moderation-retention", "other", 60_000);
    expect(await job.round()).toBe("skipped");
    await lock.release("job:moderation-retention", "other");
    expect(await job.round()).toBe("ran");
    expect(await lock.acquire("job:moderation-retention", "other", 1_000)).toBe(true);
  });

  test("the disposal deletes 60 image rows in three committed batches of 25, 25 and 10, each with its audit row and its files requested before the next batch", async () => {
    expect(DISPOSAL_BATCH).toBe(25);
    // Whatever earlier rounds left disposable goes first, so the batches below are this test's own.
    await round(casesMedia(apiDb));
    const owner = await newProfile(apiDb);
    profilesMade.push(owner.id);
    const ids: string[] = [];
    for (let n = 0; n < 15; n++) {
      const postId = await newPostRow(apiDb, owner.id);
      for (let position = 0; position < 4; position++) ids.push(await newImageRow(apiDb, owner.id, postId, position));
      await authorDeletes(postId);
    }
    const start = await head();
    /** What another session sees at each request: the batch's rows are gone and its audit row is in the record. */
    const seen: { gone: boolean; rows: number }[] = [];
    const { media, events, requested } = recordingMedia(async (batch) => {
      seen.push({ gone: (await imagesLeft(batch)).length === 0, rows: (await retentionRows(start)).length });
    });
    const report1 = await round(media);
    expect(report1.batches).toEqual([25, 25, 10]);
    expect(report1.failed).toBe(0);
    expect(events).toEqual(["deleted 25", "requested 25", "deleted 25", "requested 25", "deleted 10", "requested 10"]);
    expect(seen).toEqual([{ gone: true, rows: 1 }, { gone: true, rows: 2 }, { gone: true, rows: 3 }]);
    // The lowest ids first, each id requested once, and every one of the 60.
    expect(requested.flat()).toEqual([...ids].sort());
    expect(await imagesLeft(ids)).toEqual([]);
    expect((await retentionRows(start)).map((row) => [row.actor_id, row.target_type, row.target_id, row.metadata, row.step_up])).toEqual(
      [25, 25, 10].map((count) => ["00000000-0000-0000-0000-000000000000", null, null, { step: "images", caseId: null, intakeId: null, decisionId: null, count }, null]),
    );
    // A second round changes nothing and writes no audit row.
    const again = recordingMedia();
    expect(await round(again.media)).toEqual({ drafts: 0, cases: 0, intakes: 0, redactions: 0, statements: 0, replies: 0, reportCounts: 0, accessLog: 0, batches: [0], failed: 0 });
    expect(again.requested).toEqual([]);
    expect(await head()).toBe(start + 3);
  });

  test("every row of the retention table through one round with the clock moved: evidence, the intake record, an R4 redaction of a deleted post of a purged account, statements, drafts, the access log and the kept images; the late counts before, and none after", async () => {
    let now = Date.now();
    let contactsLate = 0;
    const auth: AuthForModeration = { ...noAuthForModeration(), overdueContacts: async () => contactsLate } as AuthForModeration;
    const late = () => erasureOverdue({ apiDb, media: casesMedia(apiDb), auth, now: () => new Date(now) });
    const baseline = await late();

    // A notice of illegality answered without action 13 months ago, released and mailed then; a note, a draft, an access row.
    const q = await post(1);
    const quiet = await reported(aPost(q.postId), "illegal");
    decided(await w.decideAs(mod, quiet.caseId, { kind: "final", outcome: "no_violation" }));
    await saveText(apiDb, quiet.caseId, mod.id, "note", "a note on the case");
    const draft = await saveText(apiDb, quiet.caseId, mod.id, "facts", "a draft nobody confirmed");
    await apiDb.execute(sql`insert into case_access_log (staff_id, case_id, kind) values (${mod.id}::uuid, ${quiet.caseId}::uuid, 'case_opened')`);
    await releaseItems(w.migrateDb, quiet.recorded.intakeId);
    await ageCase(w.migrateDb, quiet.caseId, "13 months 3 days");
    await w.migrateDb.execute(sql`update intakes set received_at = received_at - interval '13 months 3 days' where id = ${quiet.recorded.intakeId}::uuid`);
    // An R4 removal that became final a month ago; its author deleted the post, and the account was purged 13 months ago.
    const p = await post(2);
    const r4 = await reported(aPost(p.postId));
    const removal = decided(await w.decideAs(mod, r4.caseId, { kind: "final", ruleId: "R4", actions: [act("remove")] }));
    await authorDeletes(p.postId, "3 days");
    await ageCase(w.migrateDb, r4.caseId, "7 months");
    await w.migrateDb.execute(sql`update profiles set deleted_at = now() - interval '13 months 2 days' where id = ${p.authorId}::uuid`);
    await authAccount(w.migrateDb, p.authorId, "13 months 2 days");
    authRowsMade.push(p.authorId);
    // An image of a post deleted three days ago that no case ever held: the disposal is late with it.
    const junk = await post(1);
    await authorDeletes(junk.postId, "3 days");
    contactsLate = 4;

    now += ERASURE_OVERDUE_TTL_MS + 1;
    const lateBefore = await late();
    const more = (key: keyof typeof baseline) => lateBefore[key] - baseline[key];
    expect({ caseEvidence: more("caseEvidence"), intakeRecords: more("intakeRecords"), statements: more("statements"), redactions: more("redactions"), images: more("images"), drafts: more("drafts"), accessLog: more("accessLog"), contacts: lateBefore.contacts }).toEqual({
      caseEvidence: 2, intakeRecords: 1, statements: 1, redactions: 1, images: 1, drafts: 1, accessLog: 1, contacts: 4,
    });
    // Within the minute every reader is answered what was read last, whatever changed since; a minute later it is read again.
    contactsLate = 0;
    expect(await late()).toBe(lateBefore);

    const start = await head();
    const { media, requested } = recordingMedia();
    const done = await round(media);
    expect(done).toMatchObject({ cases: 2, intakes: 1, redactions: 1, statements: 1, batches: [3], failed: 0 });
    expect(done.drafts).toBeGreaterThanOrEqual(1);
    expect(done.accessLog).toBeGreaterThanOrEqual(1);

    // The no-action case: snapshot, note and hold gone; its image stays, since its post does.
    expect(await evidenceLeft(apiDb, quiet.caseId)).toEqual({ snapshots: 0, texts: 0, statements: 0, holds: 0 });
    expect(await imagesLeft(q.mediaIds)).toEqual(q.mediaIds);
    expect(await one(apiDb, sql`select count(*)::int as n from staff_texts where digest = ${draft}`)).toEqual({ n: 0 });
    expect(await one(apiDb, sql`select count(*)::int as n from case_access_log where case_id = ${quiet.caseId}::uuid`)).toEqual({ n: 0 });
    // The intake record: its words and its sender gone, its items kept.
    expect(await one(apiDb, sql`select explanation, reporter_id, erased_at is not null as erased, (select count(*)::int from intake_items i where i.intake_id = n.id and i.outcome = 'no_violation') as items from intakes n where id = ${quiet.recorded.intakeId}::uuid`)).toEqual({ explanation: null, reporter_id: null, erased: true, items: 1 });
    // The R4 removal: the post erased for good under its author's deletion, every copy gone, the statement's texts erased, the images deleted and their files requested.
    expect(await one(apiDb, sql`select body, state::text as state, moderation_level::text as level, erased_at is not null as erased from posts where id = ${p.postId}::uuid`)).toEqual({ body: "", state: "deleted_by_author", level: "removed", erased: true });
    expect(await one(apiDb, sql`select redacted_at is not null as redacted from decisions where id = ${removal}::uuid`)).toEqual({ redacted: true });
    expect(await evidenceLeft(apiDb, r4.caseId)).toEqual({ snapshots: 0, texts: 0, statements: 0, holds: 0 });
    expect(await one(apiDb, sql`select count(*)::int as n from staff_texts where case_id = ${r4.caseId}::uuid and text is not null`)).toEqual({ n: 0 });
    expect(await imagesLeft([...p.mediaIds, ...junk.mediaIds])).toEqual([]);
    expect(requested.flat().sort()).toEqual([...p.mediaIds, ...junk.mediaIds].sort());

    // Each step's audit row: the server's own, ids and counts only.
    const rows = await retentionRows(start);
    expect(rows.every((row) => row.actor_id === "00000000-0000-0000-0000-000000000000" && row.target_type === null && row.target_id === null && row.step_up === null)).toBe(true);
    for (const row of rows) expect(Object.keys(row.metadata).sort()).toEqual(["caseId", "count", "decisionId", "intakeId", "step"]);
    const named = (step: string, key: string, id: string) => rows.filter((row) => row.metadata.step === step && row.metadata[key] === id).map((row) => row.metadata);
    expect(named("case_evidence", "caseId", quiet.caseId)).toEqual([{ step: "case_evidence", caseId: quiet.caseId, intakeId: null, decisionId: null, count: 3 }]);
    expect(named("case_evidence", "caseId", r4.caseId)).toEqual([{ step: "case_evidence", caseId: r4.caseId, intakeId: null, decisionId: null, count: 3 }]);
    expect(named("intake_record", "intakeId", quiet.recorded.intakeId)).toEqual([{ step: "intake_record", caseId: null, intakeId: quiet.recorded.intakeId, decisionId: null, count: 2 }]);
    expect(named("redaction", "decisionId", removal)).toEqual([{ step: "redaction", caseId: null, intakeId: null, decisionId: removal, count: 1 }]);
    expect(named("statements", "decisionId", removal)).toEqual([{ step: "statements", caseId: null, intakeId: null, decisionId: removal, count: 2 }]);
    expect(rows.map((row) => row.metadata.step)).toEqual(expect.arrayContaining(["drafts", "access_log", "images"]));
    // In the order of the steps: the drafts first, the images last.
    expect(rows[0]!.metadata.step).toBe("drafts");
    expect(rows.at(-1)!.metadata).toEqual({ step: "images", caseId: null, intakeId: null, decisionId: null, count: 3 });

    // Nothing is late any more, and a second round changes nothing and writes nothing.
    now += ERASURE_OVERDUE_TTL_MS + 1;
    expect(await late()).toEqual({ ...baseline, contacts: 0 });
    const after = await head();
    expect(await round(casesMedia(apiDb))).toEqual({ drafts: 0, cases: 0, intakes: 0, redactions: 0, statements: 0, replies: 0, reportCounts: 0, accessLog: 0, batches: [0], failed: 0 });
    expect(await head()).toBe(after);
  });

  test.each(["its author's account", "its author's purged account", "the post itself, by the item korbat adds for a quoted post"] as const)(
    "a closed case holding the images of a post its author then deleted, due while the post is frozen through %s: every step of a round leaves its snapshot and its image rows, its notes go and its holds are released, and no file is requested; after an answer without a seal the next round takes them",
    async (reach) => {
    const f = await post(2);
    const closed = await reported(aPost(f.postId));
    decided(await w.decideAs(mod, closed.caseId, { kind: "final", outcome: "no_violation" }));
    await saveText(apiDb, closed.caseId, mod.id, "note");
    await authorDeletes(f.postId, "3 days");
    await ageCase(w.migrateDb, closed.caseId, "3 days");
    // The report of child sexual abuse material that freezes the post: about its author's account (purged or not), or about
    // a post of someone else that quotes it, which brings an item of its own for the quoted post.
    let suspectCases: string[];
    if (reach.startsWith("the post")) {
      const quoter = await newProfile(apiDb);
      profilesMade.push(quoter.id);
      const quoting = await newPostRow(apiDb, quoter.id, { quoteOfId: f.postId });
      const made = await reported(aPost(quoting), "csam");
      suspectCases = made.recorded.items.map((item) => item.caseId!);
      expect(suspectCases).toHaveLength(2);
    } else {
      if (reach.includes("purged")) await w.migrateDb.execute(sql`update profiles set display_name = 'Deleted account', bio = '', deleted_at = now() - interval '3 days' where id = ${f.authorId}::uuid`);
      suspectCases = [(await reported(anAccount(f.authorId), "csam")).caseId];
    }

    const first = recordingMedia();
    const start = await head();
    expect(await round(first.media)).toMatchObject({ cases: 1, batches: [0], failed: 0 });
    expect(await evidenceLeft(apiDb, closed.caseId)).toEqual({ snapshots: 1, texts: 0, statements: 0, holds: 0 });
    expect(await imagesLeft(f.mediaIds)).toEqual([...f.mediaIds].sort());
    expect(first.requested).toEqual([]);
    expect((await retentionRows(start)).map((row) => row.metadata)).toEqual([{ step: "case_evidence", caseId: closed.caseId, intakeId: null, decisionId: null, count: 3 }]);
    // The case holds only a snapshot of a frozen post now: it is no candidate, nothing is late, and a round leaves it alone.
    const counts = await erasureOverdue({ apiDb, media: casesMedia(apiDb), auth: noAuthForModeration(), now: () => new Date(Date.now() + 10 * ERASURE_OVERDUE_TTL_MS) });
    expect({ caseEvidence: counts.caseEvidence, images: counts.images }).toEqual({ caseEvidence: 0, images: 0 });
    expect(await round(first.media)).toMatchObject({ cases: 0, batches: [0], failed: 0 });
    expect(first.requested).toEqual([]);

    // An admin answers the report without a seal: the freeze ends. Two days on, the answered cases' own evidence is due
    // too (the case of the post itself held the images for that long), and one round takes everything.
    for (const id of suspectCases) {
      decided(await w.decideAs(admin, id, { kind: "final", outcome: "no_violation" }));
      await ageCase(w.migrateDb, id, "2 days");
    }
    const second = recordingMedia();
    expect(await round(second.media)).toMatchObject({ cases: 1 + suspectCases.length, batches: [2], failed: 0 });
    expect(await evidenceLeft(apiDb, closed.caseId)).toEqual({ snapshots: 0, texts: 0, statements: 0, holds: 0 });
    expect(await imagesLeft(f.mediaIds)).toEqual([]);
    expect(second.requested.flat().sort()).toEqual([...f.mediaIds].sort());
    },
  );

  test("a row that raises is rolled back alone with no audit row, is logged with its step and its id, and never stops another row; the count of what is late names it", async () => {
    // A decision whose subject's profile says deleted 13 months ago while its auth row is live: the job names it, the database refuses it.
    const p = await post(0);
    const made = await reported(aPost(p.postId));
    const removal = decided(await w.decideAs(mod, made.caseId, { kind: "final", actions: [act("remove")] }));
    await w.migrateDb.execute(sql`update profiles set deleted_at = now() - interval '13 months 2 days' where id = ${p.authorId}::uuid`);
    await authAccount(w.migrateDb, p.authorId);
    authRowsMade.push(p.authorId);
    // And a draft of three days ago, which the same round still deletes.
    const draft = await saveText(apiDb, made.caseId, mod.id, "reason", "an old draft");
    await w.migrateDb.execute(sql`update staff_texts set created_at = now() - interval '3 days' where digest = ${draft}`);

    const lines: Record<string, unknown>[] = [];
    const logging = pino({ level: "info" }, { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) });
    const start = await head();
    const done = await retentionRound({ apiDb, media: casesMedia(apiDb), log: logging });
    expect(done).toMatchObject({ statements: 0, failed: 1 });
    expect(done.drafts).toBeGreaterThanOrEqual(1);
    const failures = lines.filter((line) => line.level === 50);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ job: "moderation-retention", step: "statements", decisionId: removal });
    // No log line of the round carries an address, a handle or an account id.
    expect(JSON.stringify(lines)).not.toContain(p.authorId);
    expect((await retentionRows(start)).map((row) => row.metadata.step)).toEqual(["drafts"]);
    expect(await one(apiDb, sql`select count(*)::int as n from staff_texts where case_id = ${made.caseId}::uuid and confirmed_at is not null and text is not null`)).toEqual({ n: 2 });
    const counts = await erasureOverdue({ apiDb, media: casesMedia(apiDb), auth: noAuthForModeration(), now: () => new Date(Date.now() + 20 * ERASURE_OVERDUE_TTL_MS) });
    expect(counts.statements).toBe(1);
    // The mark comes off the profile again, so that the rounds of the other tests are not held to this refusal.
    await w.migrateDb.execute(sql`update profiles set deleted_at = null where id = ${p.authorId}::uuid`);
  });

  describe("MODERATION_RETENTION", () => {
    /** A lock that says which keys were asked for, and resolves when one is let go. */
    function watchedLock() {
      const inner = new MemoryJobLock();
      const asked: string[] = [];
      const released = new Map<string, () => void>();
      const lock: JobLock = {
        acquire: (key, token, ttlMs) => {
          asked.push(key);
          return inner.acquire(key, token, ttlMs);
        },
        refresh: (key, token, ttlMs) => inner.refresh(key, token, ttlMs),
        release: async (key, token) => {
          await inner.release(key, token);
          released.get(key)?.();
        },
      };
      const until = (key: string) => new Promise<void>((resolve) => released.set(key, resolve));
      return { lock, asked, until };
    }

    test.each(["off", "on"] as const)("%s: after ten minutes the dispatch job's round runs, and the retention job's only while the switch is on; off, the warning is logged and a due case keeps its snapshot and a due R4 decision's post its body", async (setting) => {
      const p = await post(0);
      const made = await reported(aPost(p.postId));
      const removal = decided(await w.decideAs(mod, made.caseId, { kind: "final", ruleId: "R4", actions: [act("remove")] }));
      await ageCase(w.migrateDb, made.caseId, "7 months");
      const state = async () => ({
        ...(await one<{ body: string; redacted: boolean }>(apiDb, sql`select (select body from posts where id = ${p.postId}::uuid) as body, (select redacted_at is not null from decisions where id = ${removal}::uuid) as redacted`)),
        snapshots: (await evidenceLeft(apiDb, made.caseId)).snapshots,
      });
      expect(await state()).toEqual({ body: "a post", redacted: false, snapshots: 1 });

      const warnings: string[] = [];
      const logger = pino({ level: "warn" }, { write: (line: string) => void warnings.push((JSON.parse(line) as { msg: string }).msg) });
      const moderation = createModeration({ apiDb, auth: noAuthForModeration(), social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore: new MemoryStore(), config: { ...loadConfig(), MODERATION_RETENTION: setting }, logger });
      const { lock, asked, until } = watchedLock();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let stop: () => void = () => undefined;
      try {
        stop = moderation.startJobs(lock);
        expect(warnings.filter((line) => line === RETENTION_OFF_WARNING)).toHaveLength(setting === "off" ? 1 : 0);
        expect(RETENTION_OFF_WARNING).toBe("moderation-retention: off (MODERATION_RETENTION)");
        const dispatched = until("job:moderation-dispatch");
        const retained = setting === "on" ? until("job:moderation-retention") : Promise.resolve();
        // Nothing of these two runs before the ten minutes are over. 3f's alert tick, which startJobs also starts in
        // both branches, runs every 30 seconds meanwhile.
        await vi.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS - 1);
        expect(asked.filter((key) => key !== "job:alert-tick")).toEqual([]);
        expect(asked).toContain("job:alert-tick");
        await vi.advanceTimersByTimeAsync(2);
        await Promise.all([dispatched, retained]);
      } finally {
        stop();
        vi.useRealTimers();
      }
      expect(asked).toContain("job:moderation-dispatch");
      expect(asked.includes("job:moderation-retention")).toBe(setting === "on");
      expect(await state()).toEqual(setting === "off" ? { body: "a post", redacted: false, snapshots: 1 } : { body: "", redacted: true, snapshots: 0 });
      // The author's decision screen: the copy while korbat holds it, and after the job's redaction the words of an R4 erasure.
      expect((await authorDecisionView({ apiDb }, p.authorId, removal)).content.kind).toBe(setting === "off" ? "post" : "r4_redacted");
      // What the switch held back is made up by a round once it is on again.
      if (setting === "off") {
        await round(casesMedia(apiDb));
        expect(await state()).toEqual({ body: "", redacted: true, snapshots: 0 });
      }
    });
  });

  describe("the purge's forgetting", () => {
    test("forgetAccount forgets the reports of an account the take-down marked deleted, changes nothing for a live one, and nothing when run again", async () => {
      const moderation = createModeration({ apiDb, auth: noAuthForModeration(), social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore: new MemoryStore(), config: loadConfig(), logger: log });
      const { user } = await newUserWithDevice(createAuthRepo(w.authDb));
      await apiDb.execute(sql`insert into profiles (id, handle, display_name) values (${user.id}::uuid, ${`r_${randomUUID().slice(0, 8)}`}, 'Reporter')`);
      profilesMade.push(user.id);
      const p = await post(0);
      const recorded = await recordIntake(moderation.deps, { ground: ground.rule(user.id), live: [aPost(p.postId)] });
      const linked = () => one(apiDb, sql`select (select reporter_id from intakes where id = ${recorded.intakeId}::uuid) as intake, (select reporter_account_id from intake_items where id = ${recorded.items[0]!.id}::uuid) as item`);

      await moderation.forAccount.forgetAccount(user.id);
      expect(await linked()).toEqual({ intake: user.id, item: user.id });
      // The take-down's mark, as the auth role sets it; from then on the purge's step forgets the links.
      await w.authDb.execute(sql`update auth.users set deleted_at = now() where id = ${user.id}::uuid and deleted_at is null`);
      await moderation.forAccount.forgetAccount(user.id);
      expect(await linked()).toEqual({ intake: null, item: null });
      await moderation.forAccount.forgetAccount(user.id);
      expect(await linked()).toEqual({ intake: null, item: null });
      // The report goes on: its item still waits in its case.
      expect(await one(apiDb, sql`select count(*)::int as n from intake_items where id = ${recorded.items[0]!.id}::uuid and outcome is null and case_id is not null`)).toEqual({ n: 1 });
    });
  });

  describe("the erasures' races", () => {
    /** A signed-out notice of illegality about a new post, answered without action and released `ago` ago: no account stands on its items. */
    async function releasedNotice(ago: string) {
      const p = await post(0);
      const recorded = await intake(apiDb, ground.illegal(null), aPost(p.postId));
      const caseId = recorded.items[0]!.caseId!;
      decided(await w.decideAs(mod, caseId, { kind: "final", outcome: "no_violation" }));
      await releaseItems(w.migrateDb, recorded.intakeId);
      await ageIntake(w.migrateDb, recorded.intakeId, ago);
      return { ...p, caseId, intakeId: recorded.intakeId, itemId: recorded.items[0]!.id };
    }
    /** The re-examination's item, as the intake transaction inserts it, in a new open case of the post. */
    const reexamine = (db: Parameters<typeof insertItem>[0], n: { intakeId: string; postId: string; itemId: string }, caseId: string, marker?: string) =>
      insertItem(db, { intakeId: n.intakeId, caseId, targetId: n.postId, lane: 1, reexaminesItemId: n.itemId, marker });
    const openCaseOf = async (postId: string) => (await one<{ id: string }>(apiDb, sql`insert into cases (target_type, target_id) values ('post', ${postId}::uuid) returning id`)).id;

    test("a re-examination that holds the intake first makes the erasure wait, and the erasure then finds the intake not due", async () => {
      const n = await releasedNotice("5 months");
      const caseId = await openCaseOf(n.postId);
      const marker = newMarker();
      let erasing: Promise<string | null> = Promise.resolve(null);
      await withLockTimeout(apiDb, async (tx) => {
        // The re-examination is inside its window, and its transaction holds the intake's row.
        await reexamine(tx, n, caseId);
        // Meanwhile the window runs out: without the new item the intake's record would be due.
        await ageIntake(w.migrateDb, n.intakeId, "8 months");
        erasing = refusal(apiDb.execute(sql`select /* ${sql.raw(marker)} */ public.erase_intake(${n.intakeId}::uuid)`));
        await untilBlocked(apiDb, marker);
      });
      expect(await erasing).toBe("not_due");
      expect(await one(apiDb, sql`select erased_at is null as held, explanation is not null as words from intakes where id = ${n.intakeId}::uuid`)).toEqual({ held: true, words: true });
      expect(await one(apiDb, sql`select count(*)::int as n from intake_items where reexamines_item_id = ${n.itemId}::uuid`)).toEqual({ n: 1 });
    });

    test("an erasure that holds the intake first makes the re-examination wait, and the re-examination is then refused: nothing is asked of an erased record", async () => {
      const n = await releasedNotice("8 months");
      const caseId = await openCaseOf(n.postId);
      const marker = newMarker();
      let asking: Promise<string | null> = Promise.resolve(null);
      await withLockTimeout(apiDb, async (tx) => {
        expect(await one(tx, sql`select public.erase_intake(${n.intakeId}::uuid) as n`)).toMatchObject({ n: expect.any(Number) });
        // The item's release is dated forward again while the erasure is still open: by the clock alone the window
        // would be open, so only the erased record refuses the request.
        await w.migrateDb.execute(sql`update intake_items set outcome_sent_at = now() - interval '5 months' where id = ${n.itemId}::uuid`);
        asking = refusal(reexamine(apiDb, n, caseId, marker));
        await untilBlocked(apiDb, marker);
      });
      expect(await asking).toBe("reexamination_not_open");
      expect(await one(apiDb, sql`select erased_at is not null as erased from intakes where id = ${n.intakeId}::uuid`)).toEqual({ erased: true });
      expect(await one(apiDb, sql`select count(*)::int as n from intake_items where reexamines_item_id = ${n.itemId}::uuid`)).toEqual({ n: 0 });
      await w.migrateDb.execute(sql`delete from cases where id = ${caseId}::uuid`);
    });

    /** A post removed under R1 seven months ago: its restriction is final for its author, and its case's evidence is due. */
    async function dueRemoval() {
      const p = await post(1);
      const made = await reported(aPost(p.postId));
      const removal = decided(await w.decideAs(mod, made.caseId, { kind: "final", actions: [act("remove")] }));
      await ageCase(w.migrateDb, made.caseId, "7 months");
      return { ...p, caseId: made.caseId, removal };
    }
    const snapshotErased = async (caseId: string) => (await evidenceLeft(apiDb, caseId)).snapshots === 0;

    test("a correction that names the old snapshot and takes the case first commits before the erasure, which then erases the snapshot", async () => {
      const r = await dueRemoval();
      const marker = newMarker();
      const release = gate();
      const held = gate();
      // Another session holds the post's row, which the correction's measure needs after it has taken the case.
      const holding = withLockTimeout(w.migrateDb, async (tx) => {
        await tx.execute(sql`select 1 from posts where id = ${r.postId}::uuid for update`);
        held.open();
        await release.opened;
      });
      await held.opened;
      const correcting = w.decideAs(admin, r.caseId, { kind: "correction", reviewsDecisionId: r.removal, actions: [act("restore")] });
      await untilBlocked(apiDb, "insert into decision_actions (decision_id");
      const erasing = refusal(apiDb.execute(sql`select /* ${sql.raw(marker)} */ public.erase_case_evidence(${r.caseId}::uuid)`));
      await untilBlocked(apiDb, marker);
      release.open();
      await holding;
      const correction = decided(await correcting);
      expect(await erasing).toBeNull();
      // The correction committed naming a snapshot that was whole at its commit; the erasure came after it.
      expect(await one(apiDb, sql`select (select decided_at from decisions where id = ${correction}::uuid) <= (select erased_at from evidence_snapshots where case_id = ${r.caseId}::uuid) as before`)).toEqual({ before: true });
      expect(await snapshotErased(r.caseId)).toBe(true);
    });

    test("an erasure that takes the case first erases the snapshot, and the correction that named it is refused: snapshot_erased", async () => {
      const r = await dueRemoval();
      let correcting: Promise<unknown> = Promise.resolve();
      await withLockTimeout(apiDb, async (tx) => {
        await tx.execute(sql`select public.erase_case_evidence(${r.caseId}::uuid)`);
        correcting = w.decideAs(admin, r.caseId, { kind: "correction", reviewsDecisionId: r.removal, actions: [act("restore")] });
        // The correction first saves its reason on the case, and that already waits for the erasure, which holds the case's row.
        await untilBlocked(apiDb, "insert into staff_texts (case_id");
      });
      expect(await refusal(correcting)).toBe("snapshot_erased");
      expect(await snapshotErased(r.caseId)).toBe(true);
      expect(await one(apiDb, sql`select count(*)::int as n from decisions where case_id = ${r.caseId}::uuid`)).toEqual({ n: 1 });
    });

    test("a correction that names a snapshot taken in the last day commits, and the erasure is refused: the case is not due for a day", async () => {
      const r = await dueRemoval();
      const fresh = await one<{ id: string; digest: string }>(w.migrateDb, sql`
        insert into evidence_snapshots (case_id, target_type, target_id, author_handle, body, salt, digest)
        select case_id, target_type, target_id, author_handle, body, salt, digest from evidence_snapshots where case_id = ${r.caseId}::uuid returning id, digest`);
      expect(await refusal(apiDb.execute(sql`select public.erase_case_evidence(${r.caseId}::uuid)`))).toBe("not_due");
      decided(await w.decideAs(admin, r.caseId, { kind: "correction", reviewsDecisionId: r.removal, actions: [act("restore")], snapshotId: fresh.id, snapshotDigest: fresh.digest }));
      expect(await refusal(apiDb.execute(sql`select public.erase_case_evidence(${r.caseId}::uuid)`))).toBe("not_due");
      expect((await evidenceLeft(apiDb, r.caseId)).snapshots).toBe(2);
    });

    /**
     * A post with one image and two closed cases. The earlier one removed the image under R1 eight months ago, and its copy
     * of the post was taken then. The later one removed the post under R4 seven months ago: that removal is final for its
     * author, so its redaction is due, and the earlier case's copy, taken before it, holds what it restricted.
     */
    async function dueRedaction() {
      const p = await post(1);
      const earlier = await reported(aPost(p.postId));
      const imageRemoval = decided(await w.decideAs(mod, earlier.caseId, { kind: "final", actions: [act("remove_media", p.mediaIds[0]!)] }));
      const later = await reported(aPost(p.postId));
      const removal = decided(await w.decideAs(mod, later.caseId, { kind: "final", ruleId: "R4", actions: [act("remove")] }));
      await ageCase(w.migrateDb, earlier.caseId, "8 months");
      await ageCase(w.migrateDb, later.caseId, "7 months");
      return { ...p, earlier: earlier.caseId, imageRemoval, later: later.caseId, removal };
    }

    test("the R4 redaction takes every case whose copy it erases before it erases one: it waits for a transaction that holds an earlier case of the post, as a decision on that case does, and erases that case's copy only afterwards", async () => {
      const r = await dueRedaction();
      const marker = newMarker();
      const [held, release] = [gate(), gate()];
      // A decision takes its case's row in this mode before it reads the copy it names.
      const holding = withLockTimeout(w.migrateDb, async (tx) => {
        await tx.execute(sql`select 1 from cases where id = ${r.earlier}::uuid for update`);
        held.open();
        await release.opened;
      });
      await held.opened;
      const redacting = one<{ changed: boolean }>(apiDb, sql`select /* ${sql.raw(marker)} */ public.redact_r4_body(${r.removal}::uuid) as changed`);
      try {
        // The redaction either comes to wait, or ends without waiting: then it erased the earlier case's copy beside
        // whoever holds that case, and a decision in that place would commit naming a copy erased under it.
        const first = await Promise.race([
          untilBlocked(apiDb, marker).then(() => "waited" as const, () => "never waited" as const),
          redacting.then(() => "ended without waiting" as const, () => "ended without waiting" as const),
        ]);
        expect(first).toBe("waited");
        expect(await snapshotErased(r.earlier)).toBe(false);
      } finally {
        release.open();
        await holding;
      }
      expect(await redacting).toEqual({ changed: true });
      expect(await snapshotErased(r.earlier)).toBe(true);
      expect(await snapshotErased(r.later)).toBe(true);
      expect(await one(apiDb, sql`select redacted_at is not null as redacted from decisions where id = ${r.removal}::uuid`)).toEqual({ redacted: true });
    });

    test("a correction of an earlier case's decision that names a copy the R4 redaction is erasing waits for the redaction at that case and is refused before it commits: snapshot_erased", async () => {
      const r = await dueRedaction();
      let correcting: Promise<unknown> = Promise.resolve();
      await withLockTimeout(apiDb, async (tx) => {
        expect(await one(tx, sql`select public.redact_r4_body(${r.removal}::uuid) as changed`)).toEqual({ changed: true });
        correcting = w.decideAs(admin, r.earlier, { kind: "correction", reviewsDecisionId: r.imageRemoval, actions: [act("restore_media", r.mediaIds[0]!)] });
        // The correction first saves its reason on the earlier case, and that already waits for the redaction, which holds
        // that case's row because it erases that case's copy. A redaction that held only its own case would let the
        // correction read the copy whole and commit naming it.
        await untilBlocked(apiDb, "insert into");
      });
      expect(await refusal(correcting)).toBe("snapshot_erased");
      expect(await snapshotErased(r.earlier)).toBe(true);
      expect(await one(apiDb, sql`select count(*)::int as n from decisions where case_id = ${r.earlier}::uuid`)).toEqual({ n: 1 });
    });
  });

  test("this file left no moderation row behind: what its tests committed is removed, and the moderation tables and the four auth tables hold what they held before it", async () => {
    await removeFixtures(w.migrateDb, profilesMade);
    profilesMade.length = 0;
    // The two staff members' own rows go with the world; their decisions are gone with the cases above.
    expect(await moderationCounts(apiDb)).toEqual(before);
    expect(await authCaseCounts(w.migrateDb)).toEqual(beforeAuth);
  });
});
