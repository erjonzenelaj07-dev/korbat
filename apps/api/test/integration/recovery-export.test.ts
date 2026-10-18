import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { AuditExportLine, AuditPage } from "@korbat/contracts";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { runStaffCommand } from "../../src/cli/staff";
import { canonicalText, chainHash } from "../../src/staff";
import { RECOVERY_TABLES, restoreForTest, rowCounts, snapshotForTest } from "./moderation-fixtures";
import { MARKED, recoveryWorld, type ConsoleStaff, type RecoveryWorld } from "./recovery-harness";

vi.setConfig({ testTimeout: 120_000 });

const LF = String.fromCharCode(10);

/**
 * The daily copy over HTTP (3f design, sections 6.6, 7.16, 8.7 and 10.5; invariant 29): the download of the audit log's
 * tail is a confirmed action, refused without the key, and with it writes one row, its confirmed audit row
 * audit_exported, and no mark; its lines carry the chain's members as stored, so each hash recomputes off the server with
 * the canonical text alone. The mark records the copy, with the plain audit row copy_marked, only when the place holds the
 * hash and the caller's own newest confirmed download released that place; a download cut short records nothing, and the
 * next starts at the same place. A download by someone who did not take the last copy alerts every staff account
 * (copy_taken). staff.js audit-export marks under the system actor. The page carries the reader's newest copied place and
 * each row's key, and lists what one key confirmed in a period. The file restores the database it found.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the daily copy of the audit log's tail", () => {
  let w: RecoveryWorld;
  let keeper: ConsoleStaff;
  let other: ConsoleStaff;
  let found: string;
  let before: Record<string, number>;
  let head = 0;

  beforeAll(async () => {
    w = recoveryWorld();
    before = await rowCounts(w.apiDb, [...RECOVERY_TABLES]);
    found = await snapshotForTest(w.migrateDb);
    keeper = await w.staff("moderator");
    other = await w.staff("admin");
    await filler(250);
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });

  /** Rows of the server's own, committed, so that a download spans a few hundred places. */
  async function filler(n: number): Promise<void> {
    await w.migrateDb.execute(sql`insert into public.audit_log (actor_id, action, metadata) select ${SYSTEM_ACTOR_ID}::uuid, 'filler', jsonb_build_object('n', n) from generate_series(1, ${n}::int) n`);
  }
  const page = async (s: ConsoleStaff, query = "") => {
    const res = await s.b.fetch(`/api/staff/audit${query}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return AuditPage.parse(await res.json());
  };
  const newestPlace = async () => Number((await w.migrateDb.execute<{ seq: string }>(sql`select seq::text as seq from public.audit_head where id = 1`))[0]!.seq);
  /** The download of the places after `after` up to `through`, confirmed with the member's key unless `key` is false. */
  async function download(s: ConsoleStaff, after: number, through: number, key = true): Promise<Response> {
    const params = { after, through };
    const stepUp = key ? await w.confirmation(s, { action: "audit_exported", target: { type: "audit", id: String(through) }, params }) : undefined;
    return s.b.fetch("/api/staff/audit/export", { json: { ...params, ...(stepUp ? { stepUp } : {}) }, headers: MARKED });
  }
  const linesOf = (text: string) => text.split(LF).filter((line) => line !== "").map((line) => AuditExportLine.parse(JSON.parse(line)));
  const recomputes = (line: ReturnType<typeof linesOf>[number]) =>
    chainHash(
      line.prevHash,
      canonicalText({
        chainVersion: line.v,
        chainSeq: line.place,
        id: line.id,
        createdAt: new Date(line.at),
        actorId: line.actor,
        action: line.action,
        targetType: line.targetType,
        targetId: line.targetId,
        requestId: line.requestId,
        staffSession: line.staffSession,
        keyId: line.keyId,
        actionHash: line.actionHash,
        stepUpText: line.stepUp,
        metadataText: line.metadata,
      }),
    ) === line.hash;
  const marksOf = async (staffId: string) => (await w.migrateDb.execute<{ place: number }>(sql`select place::int from public.copy_marks where staff_id = ${staffId}::uuid order by id`)).map((r) => r.place);

  test("the download needs the key; with it, it writes its confirmed row audit_exported alone and no mark, and every line recomputes off the server", async () => {
    const first = await page(keeper);
    expect(first.copy).toEqual({ lastPlace: null });
    head = first.entries[0]!.seq;
    expect(await w.refusal(await download(keeper, 0, head, false))).toEqual([403, "staff_step_up_required"]);
    const res = await download(keeper, 0, head);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="korbat-audit-1-${head}.jsonl"`);
    const lines = linesOf(await res.text());
    expect(lines.map((line) => line.place)).toEqual(Array.from({ length: head }, (_, i) => i + 1));
    expect(lines.every(recomputes)).toBe(true);
    for (const [i, line] of lines.entries()) if (i > 0) expect(line.prevHash).toBe(lines[i - 1]!.hash);
    // A line holds the row's metadata as stored: the page never shows it.
    expect(lines.some((line) => line.metadata.includes('"n": '))).toBe(true);
    const [exported] = await w.migrateDb.execute<{ actor: string; target: string; params: unknown; stepped: boolean }>(
      sql`select actor_id::text as actor, target_id as target, metadata -> 'params' as params, step_up is not null as stepped from public.audit_log where action = 'audit_exported' order by chain_seq desc limit 1`,
    );
    expect(exported).toEqual({ actor: keeper.id, target: String(head), params: { after: 0, through: head }, stepped: true });
    expect(await marksOf(keeper.id)).toEqual([]);
    // A download that would end after the newest place is refused once the key has confirmed it.
    expect(await w.refusal(await download(keeper, head, (await newestPlace()) + 1000))).toEqual([422, "invalid_request"]);
  });

  test("the mark: refused for another hash, for a place the caller's newest confirmed download did not release, and for a caller who downloaded nothing; then the copy is recorded with copy_marked", async () => {
    // The keeper's newest confirmed download now releases places after `head` (the refused one above): download again.
    const res = await download(keeper, 0, head);
    const lines = linesOf(await res.text());
    const last = lines[lines.length - 1]!;
    const mark = (s: ConsoleStaff, body: unknown) => s.b.fetch("/api/staff/audit/export/mark", { json: body, headers: MARKED });
    expect(await w.refusal(await mark(keeper, { through: head, hash: "0".repeat(64) }))).toEqual([409, "copy_mismatch"]);
    expect(await w.refusal(await mark(keeper, { through: head - 1, hash: lines[lines.length - 2]!.hash }))).toEqual([409, "copy_mismatch"]);
    expect(await w.refusal(await mark(other, { through: head, hash: last.hash }))).toEqual([409, "copy_mismatch"]);
    expect(await marksOf(keeper.id)).toEqual([]);
    const marked = await mark(keeper, { through: head, hash: last.hash });
    expect(marked.status, await marked.clone().text()).toBe(204);
    expect(await marksOf(keeper.id)).toEqual([head]);
    const [row] = await w.migrateDb.execute<{ actor: string; meta: unknown; stepped: boolean }>(
      sql`select actor_id::text as actor, metadata as meta, step_up is not null as stepped from public.audit_log where action = 'copy_marked' order by chain_seq desc limit 1`,
    );
    expect(row).toEqual({ actor: keeper.id, meta: { after: 0, through: head, rows: head }, stepped: false });
    expect((await page(keeper)).copy).toEqual({ lastPlace: head });
    expect((await page(other)).copy).toEqual({ lastPlace: null });
  });

  test("a download cut short at line 200 leaves its confirmed row and no mark, and the next download starts at the same place", async () => {
    await filler(250);
    const through = await newestPlace();
    const res = await download(keeper, head, through);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (text.split(LF).length <= 200) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel();
    expect(text.split(LF).length).toBeGreaterThan(200);
    const [exported] = await w.migrateDb.execute<{ params: unknown }>(sql`select metadata -> 'params' as params from public.audit_log where action = 'audit_exported' and actor_id = ${keeper.id}::uuid order by chain_seq desc limit 1`);
    expect(exported!.params).toEqual({ after: head, through });
    expect(await marksOf(keeper.id)).toEqual([head]);
    expect((await page(keeper)).copy).toEqual({ lastPlace: head });
  });

  test("a download by an account that did not take the last copy alerts every staff account (copy_taken); the last downloader's own does not", async () => {
    const since = new Date();
    const taken = async () =>
      w.migrateDb.execute<{ rows: number }>(sql`select (facts ->> 'rows')::int as rows from public.alert_outbox where kind = 'copy_taken' and created_at >= ${since.toISOString()}::timestamptz order by id`);
    const through = await newestPlace();
    expect((await download(other, 0, 10)).status).toBe(200);
    await w.moderation.settle();
    expect((await taken()).map((r) => r.rows)).toEqual([10]);
    expect((await download(keeper, head, through)).status).toBe(200);
    await w.moderation.settle();
    expect((await taken()).map((r) => r.rows)).toEqual([10]);
  });

  test("staff.js audit-export prints the lines and marks the copy under the system actor, which no staff member's newest copy is", async () => {
    const out: string[] = [];
    const notes: string[] = [];
    const code = await runStaffCommand(["audit-export", "--after", String(head)], { DATABASE_URL_API: w.config.DATABASE_URL_API }, { log: (line) => out.push(line), error: (line) => notes.push(line) });
    expect(code).toBe(0);
    const lines = out.map((line) => AuditExportLine.parse(JSON.parse(line)));
    expect(lines[0]!.place).toBe(head + 1);
    expect(lines.every(recomputes)).toBe(true);
    expect(notes).toEqual([`audit-export: places ${head + 1} to ${lines[lines.length - 1]!.place}, ${lines.length} rows.`]);
    expect(await marksOf(SYSTEM_ACTOR_ID)).toEqual([lines[lines.length - 1]!.place]);
    expect((await page(keeper)).copy).toEqual({ lastPlace: head });
    const [row] = await w.migrateDb.execute<{ actor: string }>(sql`select actor_id::text as actor from public.audit_log where action = 'copy_marked' order by chain_seq desc limit 1`);
    expect(row!.actor).toBe(SYSTEM_ACTOR_ID);
    // From its own newest copy when no place is given: only the mark's own row is newer now.
    const again: string[] = [];
    expect(await runStaffCommand(["audit-export"], { DATABASE_URL_API: w.config.DATABASE_URL_API }, { log: (line) => again.push(line), error: () => undefined })).toBe(0);
    expect(again.map((line) => (JSON.parse(line) as { action: string }).action)).toEqual(["copy_marked"]);
  });

  test("the page names each row's key, and lists what one key confirmed in a period", async () => {
    const all = await page(keeper);
    const confirmed = all.entries.find((entry) => entry.action === "audit_exported" && entry.actionHash !== null)!;
    expect(confirmed.keyId).not.toBeNull();
    expect(all.entries.filter((entry) => entry.actionHash === null).every((entry) => entry.keyId === null)).toBe(true);
    const byKey = await page(keeper, `?key=${confirmed.keyId}`);
    expect(byKey.entries.length).toBeGreaterThan(0);
    expect(byKey.entries.every((entry) => entry.keyId === confirmed.keyId && entry.actionHash !== null)).toBe(true);
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    expect((await page(keeper, `?key=${confirmed.keyId}&from=${later}`)).entries).toEqual([]);
    const res = await keeper.b.fetch(`/api/staff/audit?from=${later}`);
    expect(res.status).toBe(400);
  });

  test("leaves the database as the file found it", async () => {
    await w.moderation.settle();
    await restoreForTest(w.migrateDb, found);
    expect(await rowCounts(w.apiDb, [...RECOVERY_TABLES])).toEqual(before);
  });
});
