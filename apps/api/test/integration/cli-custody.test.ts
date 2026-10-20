import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MEDIA_SIZES } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { STAFF_USAGE, runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { storedImageName } from "../../src/media";
import { custodyStore, type CustodyStore } from "../quarantine/custody-store";
import { planOf, quarantineCount, quarantineRows, removeCustody } from "./custody-fixtures";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { CHANNEL_TABLES, aPost, act, imagePost, removeDecided, removeFixtures, report, rowCounts } from "./moderation-fixtures";
import { SEAL_FOR_GOOD, removeRecords, sealActionOf } from "./records-fixtures";

vi.setConfig({ testTimeout: 180_000 });

const LF = String.fromCharCode(10);
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** A post of this file sealed for good: its author, its images, its case, the sealing decision and its seal's ledger row. */
interface Sealed {
  authorId: string;
  postId: string;
  mediaIds: string[];
  caseId: string;
  decisionId: string;
  sealActionId: string;
}

/**
 * The quarantine's commands around its mover (3d design, sections 7.1, 8.10 and 10.5; 12.1 rows 13 and 15): staff.js
 * quarantine-list and quarantine-record as the migrator, with the mover's program run on two temporary directories laid
 * out as the image store and the quarantine (custodyStore), filled with harmless files that are not images. The list
 * prints a line a file; the record takes the receipt line by line, whatever the plan says now, with its audit row last;
 * a stale line is recorded where the file is and reported, and the next list moves the file back; a file in neither place
 * records nothing, and only --lost records it lost, with the alert; an inventory gives a file without a row its row; a
 * post whose rows do not match its seal is left out and named. The seals commit with real keys; the last test removes
 * what the file made.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the quarantine's commands and its mover (3d Task 1)", () => {
  let world: DeciderWorld;
  let admin: RealStaff;
  let apiDb: Db;
  let migrateDb: Db;
  let store: CustodyStore;
  let before: Record<string, number>;
  let quarantineBefore: number;
  let startedAt: string;
  const authors: string[] = [];
  const posts: string[] = [];
  const media: string[] = [];

  /** A post with images whose files the store holds (unless said), reported on the path for child sexual abuse material and sealed for good by the admin's key. */
  async function sealedForGood(images: number, files = true): Promise<Sealed> {
    const p = await imagePost(apiDb, images);
    authors.push(p.authorId);
    posts.push(p.postId);
    media.push(...p.mediaIds);
    if (files) store.put(p.mediaIds);
    const { caseId } = await report(apiDb, aPost(p.postId), "csam");
    const outcome = await world.decideAs(admin, caseId, SEAL_FOR_GOOD);
    if (typeof outcome === "string") throw new Error(`the seal was not recorded (${outcome})`);
    return { ...p, caseId, decisionId: outcome.decisionId, sealActionId: await sealActionOf(migrateDb, outcome.decisionId) };
  }
  async function unseal(s: Sealed): Promise<void> {
    const outcome = await world.decideAs(admin, s.caseId, { kind: "correction", reviewsDecisionId: s.decisionId, actions: [act("unseal_media")] });
    if (typeof outcome === "string") throw new Error(`the seal was not lifted (${outcome})`);
  }

  const env = () => ({ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! });
  /** The command's printed lines, each marked with its stream, and its exit code; standard input as given. */
  async function cli(args: string[], input?: string) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, env(), { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) }, async () => Buffer.from(input ?? "", "utf8"));
    return { code, lines, out: lines.filter((line) => line.startsWith("out ")).map((line) => line.slice(4)), err: lines.filter((line) => line.startsWith("err ")).map((line) => line.slice(4)) };
  }
  /** quarantine-list's lines about these images only: other suites' seals are none of this file's business. */
  async function listFor(ids: readonly string[]) {
    const run = await cli(["quarantine-list"]);
    return { ...run, mine: run.out.filter((line) => ids.includes(line.split(" ")[1]!)) };
  }
  const lastAudit = async () =>
    ({ ...(await migrateDb.execute<{ action: string; actor_id: string; target_type: string | null; metadata: Record<string, unknown> }>(sql`select action, actor_id, target_type, metadata from public.audit_log order by chain_seq desc limit 1`))[0]! });
  const lines = (...files: string[]) => files.join(LF) + LF;

  beforeAll(async () => {
    // Read in beforeAll: a suite without a database is collected and skipped, and its environment is not loaded then.
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    world = deciderWorld(apiDb);
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    store = custodyStore();
    // Counted before the admin's profile exists: the last test removes it with the seals.
    before = await rowCounts(apiDb, [...CHANNEL_TABLES]);
    quarantineBefore = await quarantineCount(migrateDb);
    startedAt = (await migrateDb.execute<{ now: string }>(sql`select now()::text as now`))[0]!.now;
    admin = await world.staff("admin");
  }, 120_000);

  afterAll(async () => {
    store.remove();
    await removeCustody(migrateDb, media, startedAt);
    await removeRecords(migrateDb, [...authors, admin.id]);
    await removeDecided(migrateDb, posts, [admin.id]);
    await removeFixtures(migrateDb, authors);
    await world.close();
    await Promise.all([closeDb(migrateDb), closeDb(apiDb)]);
  });

  test("list, move, record: a line a file of a seal for good, the mover's receipt recorded with its audit row last, and then nothing is due for them; the home's counts and the case's custody", async () => {
    const a = await sealedForGood(2);
    const b = await sealedForGood(1);
    const ids = [...a.mediaIds, ...b.mediaIds];
    const listed = await listFor(ids);
    expect(listed.code).toBe(0);
    expect([...listed.mine].sort()).toEqual(ids.flatMap((id) => ["small", "large"].map((size) => `in ${id} ${storedImageName(id, size as "small" | "large")}`)).sort());
    expect(listed.err[0]).toMatch(/^quarantine-list: [0-9]+ files to move in, [0-9]+ to return, [0-9]+ to destroy, [0-9]+ for the operator[.]$/);
    const moved = await store.run(lines(...listed.mine));
    expect(moved.code).toBe(0);
    for (const id of ids) for (const size of ["small", "large"] as const) expect(store.place(storedImageName(id, size))).toBe("quarantine");

    const receipt = lines(...moved.lines);
    const recorded = await cli(["quarantine-record"], receipt);
    expect([recorded.code, recorded.err]).toEqual([0, []]);
    expect(recorded.out).toEqual([expect.stringMatching(/^quarantine-record: 6 files recorded as moved, 0 as returned, 0 as destroyed, 0 as lost, 0 found without a record[.] Still due: [0-9]+[.]$/)]);
    const audit = await lastAudit();
    expect([audit.action, audit.actor_id, audit.target_type]).toEqual(["quarantine_recorded", SYSTEM_ACTOR_ID, null]);
    expect(audit.metadata).toEqual({ in: 6, out: 0, destroyed: 0, mismatched: 0, lost: 0, found: 0, againstPlan: 0, reported: 0, receiptSha256: sha256(receipt) });
    const rows = await quarantineRows(migrateDb, ids);
    expect(rows.map((row) => [row.file, row.size, row.sha256, row.unknown, row.returned_at, row.lost_at])).toEqual(
      rows.map((row) => [row.file, store.read(row.file, "quarantine").length, sha256(store.read(row.file, "quarantine")), false, null, null]),
    );
    expect((await listFor(ids)).mine).toEqual([]);
    expect(await planOf(migrateDb, ids)).toEqual([]);
    // The same receipt again writes nothing more: every line is where its row says.
    const again = await cli(["quarantine-record"], receipt);
    expect([again.code, again.out[0]]).toEqual([0, expect.stringMatching(/^quarantine-record: 0 files recorded as moved, 0 as returned/)]);

    // Home: the four values of quarantine_counts(); the case: the seal's custody, counts and one time.
    const [counts] = await apiDb.execute<{ due_in: number; due_out: number; undestroyed: number }>(sql`select due_in, due_out, undestroyed from public.quarantine_counts()`);
    const overview = await world.moderation.forStaff.overview(admin.session);
    expect(overview.quarantine).toMatchObject({ dueIn: counts!.due_in, dueOut: counts!.due_out, undestroyed: counts!.undestroyed });
    const view = await world.moderation.forStaff.caseView(admin.session, a.caseId);
    const decision = view.decisions.find((d) => d.id === a.decisionId)!;
    expect(decision.custody).toEqual({ files: 4, moved: 4, movedAt: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/), toReturn: 0, filesLeft: 0, lost: 0 });
    // Every decision without a seal for good carries none.
    for (const other of view.decisions.filter((d) => d.id !== a.decisionId)) expect(other).not.toHaveProperty("custody");
  });

  test("a stale in line: list, unseal, move, record: the move is recorded where the file is and reported, the next list returns it, and its return is recorded", async () => {
    const c = await sealedForGood(1);
    const id = c.mediaIds[0]!;
    const listed = await listFor([id]);
    expect(listed.mine).toHaveLength(2);
    await unseal(c);
    const moved = await store.run(lines(...listed.mine));
    expect(moved.code).toBe(0);
    const recorded = await cli(["quarantine-record"], lines(...moved.lines));
    expect(recorded.code).toBe(1);
    expect(recorded.out[0]).toMatch(/^quarantine-record: 2 files recorded as moved, 0 as returned/);
    expect(recorded.err).toEqual([1, 2].map((n) => `quarantine-record: line ${n}: image ${id} no longer fits the plan; recorded where the file is, and the next list moves it back`));
    expect((await lastAudit()).metadata).toMatchObject({ in: 2, againstPlan: 2, reported: 2 });
    // The image is visible again and its files are in the quarantine: the plan returns them.
    const back = await listFor([id]);
    expect([...back.mine].sort()).toEqual(["small", "large"].map((size) => `out ${id} ${storedImageName(id, size as "small" | "large")}`).sort());
    const returned = await store.run(lines(...back.mine));
    expect(returned.code).toBe(0);
    const recordedBack = await cli(["quarantine-record"], lines(...returned.lines));
    expect([recordedBack.code, recordedBack.out[0]]).toEqual([0, expect.stringMatching(/^quarantine-record: 0 files recorded as moved, 2 as returned/)]);
    expect((await quarantineRows(migrateDb, [id])).every((row) => row.returned_at !== null)).toBe(true);
    expect((await listFor([id])).mine).toEqual([]);
    const view = await world.moderation.forStaff.caseView(admin.session, c.caseId);
    expect(view.decisions.find((d) => d.id === c.decisionId)!.custody).toMatchObject({ moved: 0, toReturn: 0, lost: 0 });
  });

  test("the mirror: a stale out line, after the seal was taken again, is recorded as the return it was and reported, and the next list moves the file in again", async () => {
    const d = await sealedForGood(1);
    const id = d.mediaIds[0]!;
    const moved = await store.run(lines(...(await listFor([id])).mine));
    expect((await cli(["quarantine-record"], lines(...moved.lines))).code).toBe(0);
    await unseal(d);
    const outLines = (await listFor([id])).mine;
    expect(outLines.every((line) => line.startsWith("out "))).toBe(true);
    // Sealed for good again before the mover ran the out lines.
    const { caseId } = await report(apiDb, aPost(d.postId), "csam");
    const again = await world.decideAs(admin, caseId, SEAL_FOR_GOOD);
    if (typeof again === "string") throw new Error(`the seal was not recorded (${again})`);
    const returned = await store.run(lines(...outLines));
    const recorded = await cli(["quarantine-record"], lines(...returned.lines));
    expect(recorded.code).toBe(1);
    expect(recorded.out[0]).toMatch(/^quarantine-record: 0 files recorded as moved, 2 as returned/);
    expect(recorded.err).toEqual([1, 2].map((n) => `quarantine-record: line ${n}: image ${id} no longer fits the plan; recorded where the file is, and the next list moves it back`));
    expect([...(await listFor([id])).mine].every((line) => line.startsWith("in "))).toBe(true);
    expect(await planOf(migrateDb, [id])).toEqual([`in ${id}`]);
  });

  test("a file in neither place: missing records nothing and the run goes on; with --lost it is recorded lost, quarantine_lost alerts every staff account, and the image leaves the plan", async () => {
    const e = await sealedForGood(1, false);
    const id = e.mediaIds[0]!;
    const listed = await listFor([id]);
    const missing = await store.run(lines(...listed.mine));
    expect(missing.code).toBe(1);
    expect(missing.lines).toEqual(listed.mine.map((line) => `${line} missing`));
    const recorded = await cli(["quarantine-record"], lines(...missing.lines));
    expect(recorded.code).toBe(1);
    expect(recorded.err).toEqual(listed.mine.map((line, i) => `quarantine-record: line ${i + 1}: ${line.split(" ")[2]} is missing in both places; nothing recorded (see the README, Quarantine, step 5)`));
    expect(await quarantineRows(migrateDb, [id])).toEqual([]);

    const lost = await store.run(lines(...listed.mine), ["--lost"]);
    expect([lost.code, lost.lines]).toEqual([0, listed.mine.map((line) => `${line} lost`)]);
    const recordedLost = await cli(["quarantine-record"], lines(...lost.lines));
    expect([recordedLost.code, recordedLost.out[0]]).toEqual([0, expect.stringMatching(/^quarantine-record: 0 files recorded as moved, 0 as returned, 0 as destroyed, 2 as lost, 0 found without a record/)]);
    // Sealed for good: nobody is told of a lost file of a seal that stands; staff are.
    expect((await quarantineRows(migrateDb, [id])).map((row) => [row.lost_told, row.size])).toEqual([
      ["none", null],
      ["none", null],
    ]);
    const [alert] = await migrateDb.execute<{ priority: number; scope: string; step: number | null; facts: Record<string, unknown> }>(
      sql`select priority, scope, step, facts from public.alert_outbox where kind = 'quarantine_lost' order by id desc limit 1`,
    );
    expect({ ...alert! }).toEqual({ priority: 3, scope: "all", step: null, facts: { count: 2, at: expect.stringMatching(/Z$/) } });
    expect((await lastAudit()).metadata).toMatchObject({ lost: 2, reported: 0 });
    expect(await planOf(migrateDb, [id])).toEqual([]);
    const view = await world.moderation.forStaff.caseView(admin.session, e.caseId);
    expect(view.decisions.find((x) => x.id === e.decisionId)!.custody).toEqual({ files: 2, moved: 0, movedAt: null, toReturn: 0, filesLeft: 0, lost: 2 });
  });

  test("the inventory: a file without a record gets its row, one of an image the database does not know is the operator's; a line that is no receipt line is skipped; another digest is reported and the stored one stays", async () => {
    const f = await sealedForGood(1, false);
    const id = f.mediaIds[0]!;
    const unknown = randomUUID();
    media.push(unknown);
    // Files that lie in the quarantine without a record: a receipt that was lost, and a restore that forgot an image.
    const fNames = store.put([id], "quarantine");
    const uNames = store.put([unknown], "quarantine");
    const inventory = await store.run("", ["--inventory"]);
    expect(inventory.code).toBe(0);
    const mine = inventory.lines.filter((line) => line.includes(id) || line.includes(unknown));
    expect(mine).toHaveLength(4);
    const recorded = await cli(["quarantine-record"], lines(mine[0]!, "a line that the mover never prints", ...mine.slice(1)));
    expect(recorded.code).toBe(1);
    expect(recorded.out[0]).toMatch(/0 as lost, 4 found without a record[.]/);
    expect(recorded.err).toContain("quarantine-record: line 2 is not a receipt line; skipped");
    expect(recorded.err.filter((line) => line.endsWith("was found in the quarantine without a record; recorded"))).toHaveLength(4);
    expect((await quarantineRows(migrateDb, [id, unknown])).map((row) => [row.media_id, row.unknown])).toEqual(
      [...[id, id].map((x) => [x, false]), ...[unknown, unknown].map((x) => [x, true])].sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : String(x[0]) > String(y[0]) ? 1 : 0)),
    );
    const listed = await listFor([id, unknown]);
    expect([...listed.mine].sort()).toEqual(uNames.map((name) => `operator ${unknown} ${name}`).sort());
    // The mover leaves an operator line alone.
    const left = await store.run(lines(...listed.mine));
    expect([left.code, left.lines]).toEqual([0, []]);
    // A line of a file whose recorded digest is another: recorded, reported and counted; the stored digest stays.
    const stored = (await quarantineRows(migrateDb, [id])).find((row) => row.file === fNames[0])!;
    const forged = await cli(["quarantine-record"], lines(`have ${id} ${fNames[0]} 77 ${"f".repeat(64)}`));
    expect(forged.code).toBe(1);
    // A receipt of have lines alone is an inventory (review M9): every other file recorded in the quarantine is reported
    // as not listed; this test reads the one line about the file it names.
    expect(forged.err.filter((line) => !line.includes("the inventory did not list it"))).toEqual([`quarantine-record: line 1: ${fNames[0]} has another digest than the one recorded when it was moved; the recorded digest stays`]);
    expect((await lastAudit()).metadata).toMatchObject({ mismatched: 1 });
    expect((await lastAudit()).metadata.reported).toBe(forged.err.length);
    expect((await quarantineRows(migrateDb, [id])).find((row) => row.file === fNames[0])!.sha256).toBe(stored.sha256);
  });

  test("review M9: a receipt made of have lines alone, an inventory, reports every file recorded in the quarantine that it did not list; a receipt of moves reports none", async () => {
    const g = await sealedForGood(1, false);
    const id = g.mediaIds[0]!;
    const [listedName, omitted] = MEDIA_SIZES.map((size) => storedImageName(id, size));
    // Both files are in the quarantine by record, as a move recorded before a restore leaves them.
    for (const name of [listedName!, omitted!]) await migrateDb.execute(sql`insert into public.quarantine_files (media_id, file, size, sha256) values (${id}::uuid, ${name}, 1234, ${"b".repeat(64)})`);
    const inventory = await cli(["quarantine-record"], lines(`have ${id} ${listedName} 1234 ${"b".repeat(64)}`));
    expect(inventory.code).toBe(1);
    const about = inventory.err.filter((line) => line.includes(id));
    expect(about).toEqual([`quarantine-record: ${omitted} of image ${id} is recorded in the quarantine and the inventory did not list it: find it, or record it lost with the quarantine service's --lost run (the README, Quarantine, step 5)`]);
    // A receipt that holds a move is no inventory: it names no file it did not list.
    const moved = await cli(["quarantine-record"], lines(`destroy ${randomUUID()} x refused`, `destroy ${id} ${omitted} refused`));
    expect(moved.err.filter((line) => line.includes("the inventory did not list it"))).toEqual([]);
  });

  test("quarantine-list leaves out a post whose image rows do not match its seal, names it, prints every other post's lines, and exits 1", async () => {
    const g = await sealedForGood(1);
    const h = await sealedForGood(1);
    await migrateDb.execute(sql`update public.seal_posts set images = 2 where action_id = ${g.sealActionId}::uuid`);
    try {
      const listed = await listFor([...g.mediaIds, ...h.mediaIds]);
      expect(listed.code).toBe(1);
      expect(listed.mine.every((line) => line.includes(h.mediaIds[0]!))).toBe(true);
      expect(listed.mine).toHaveLength(2);
      expect(listed.err).toContain(`quarantine-list: post ${g.postId}: its image rows do not match its seal; left out`);
    } finally {
      await migrateDb.execute(sql`update public.seal_posts set images = 1 where action_id = ${g.sealActionId}::uuid`);
    }
    // Moved and recorded, so nothing of this test is due when the file ends.
    for (const s of [g, h]) {
      const moved = await store.run(lines(...(await listFor(s.mediaIds)).mine));
      expect((await cli(["quarantine-record"], lines(...moved.lines))).code).toBe(0);
    }
  });

  test("STAFF_USAGE names both commands; an argument is refused; an empty receipt is refused and changes nothing", async () => {
    for (const command of ["quarantine-list", "quarantine-record"]) expect(STAFF_USAGE, command).toContain(`  ${command}`);
    expect((await cli(["quarantine-list", "now"])).code).toBe(2);
    const audits = (await migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log`))[0]!.n;
    const empty = await cli(["quarantine-record"], LF);
    expect([empty.code, empty.err]).toEqual([1, ["quarantine-record: the receipt holds no line; give the quarantine service's receipt on standard input; nothing changed"]]);
    expect((await migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log`))[0]!.n).toBe(audits);
  });

  test("this file left nothing behind: its seals, cases, records and quarantine rows are removed, and the tables hold what they held before", async () => {
    await removeCustody(migrateDb, media, startedAt);
    await removeRecords(migrateDb, [...authors, admin.id]);
    await removeDecided(migrateDb, posts, [admin.id]);
    await removeFixtures(migrateDb, authors);
    posts.length = 0;
    authors.length = 0;
    expect(await quarantineCount(migrateDb)).toBe(quarantineBefore);
    expect(await rowCounts(apiDb, [...CHANNEL_TABLES])).toEqual(before);
  });
});
