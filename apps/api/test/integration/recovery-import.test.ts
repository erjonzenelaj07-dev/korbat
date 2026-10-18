import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { parseOrderArgs, orderCommand } from "../../src/cli/orders";
import { parseRecordArgs, recordCommand } from "../../src/cli/records";
import { restoreImport } from "../../src/cli/restore";
import { loadConfig } from "../../src/config";
import { orderView } from "../../src/moderation/orders";
import { exportLines } from "../../src/staff";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { RECOVERY_TABLES, aPost, act, imagePost, moderationDeps, refusal, report, restoreForTest, rowCounts, snapshotForTest } from "./moderation-fixtures";
import { ORDER_TABLES, effectForTest, effectParams, orderConfig, orderForTest } from "./orders-fixtures";

vi.setConfig({ testTimeout: 180_000 });

const LF = String.fromCharCode(10);

/**
 * A restore and the import of the keeper's files (3f design, sections 7.17 and 12.3, LAB F on the real code; invariants 5
 * and 18). A backup is taken by snapshotForTest; then work is lost: an order opened and given effect with Section C, a
 * removal decided, a record to an authority opened and answered, the order verified from the shell. The keeper's file is
 * the tail from 300 places before the backup's head, as a keeper holds it. The database is restored by restoreForTest.
 * A tail that begins above the head's next place, a line whose hash does not recompute, a line at the head's place with
 * another hash and a kept place with another hash are each refused whole; a hole is reported and the run before it
 * imported. The import writes again the order with its original times and its verification, the item's first disabling
 * and preservation (the post is frozen at once, before any measure is back), the owed record with its original opening,
 * and one gap for each lost decision and each later step of a record; never a decision or a measure, and the migrator's
 * own copy of the lost decision is refused at commit. A disabling taken again keeps its times and closes its gap; the
 * removal taken again closes its own and its statement names the lost day. The file restores the database it found.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: a restore, and the import of the keeper's files", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let world: DeciderWorld;
  let mod: RealStaff;
  let admin: RealStaff;
  let found: string;
  let before: Record<string, number>;
  // Read in beforeAll: the files are collected without the test environment.
  let appOrigin: string;
  // The backup's head, the keeper's file, and what the lost work made.
  let head: { seq: number; hash: string };
  let tail: string[] = [];
  let backups: string[] = [];
  let orderId: string;
  let itemId: string;
  let orderPost: string;
  let removalCase: string;
  let removalDecision: string;
  let recordId: string;
  let lostDecision: { decision: unknown; actions: unknown[] };
  let lostEffectAt: string;
  let lostRemovalAt: string;
  let lostOrderOpenedAt: string;

  const readHead = async () => {
    const [row] = await migrateDb.execute<{ seq: string; hash: string }>(sql`select seq::text as seq, hash from public.audit_head where id = 1`);
    return { seq: Number(row!.seq), hash: row!.hash };
  };
  const input = (lines: readonly string[]) => Buffer.from(lines.map((line) => line + LF).join(""), "utf8");
  const placeOf = (line: string) => (JSON.parse(line) as { place: number }).place;
  const count = async (table: string) => Number((await migrateDb.execute<{ n: number }>(sql.raw(`select count(*)::int as n from public.${table}`)))[0]!.n);

  beforeAll(async () => {
    const config = loadConfig();
    appOrigin = config.APP_ORIGIN;
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    // The database as this file found it, which its last test puts back.
    before = await rowCounts(apiDb, [...ORDER_TABLES, ...RECOVERY_TABLES]);
    found = await snapshotForTest(migrateDb);
    world = deciderWorld(apiDb);
    mod = await world.staff("moderator");
    admin = await world.staff("admin");

    // Before the backup: the posts, the report on the second, and enough rows that the keeper's file starts 300 places
    // before the head.
    orderPost = (await imagePost(apiDb, 0)).postId;
    const removed = await imagePost(apiDb, 0);
    removalCase = (await report(apiDb, aPost(removed.postId))).caseId;
    await migrateDb.execute(sql`insert into public.audit_log (actor_id, action, metadata) select '00000000-0000-0000-0000-000000000000'::uuid, 'filler', jsonb_build_object('n', n) from generate_series(1, 320) n`);
    head = await readHead();
    backups = [await snapshotForTest(migrateDb), await snapshotForTest(migrateDb)];

    // The lost work.
    const view = await orderForTest(apiDb, mod, { kind: "tco_removal", sectionC: true, posts: [orderPost] });
    orderId = view.id;
    itemId = view.items[0]!.id;
    const effected = await effectForTest(world, mod, orderId, effectParams(view));
    if (typeof effected === "string") throw new Error(`the effect was not recorded: ${effected}`);
    const decided = await world.decideAs(mod, removalCase, { kind: "final", actions: [act("remove")] });
    if (typeof decided === "string") throw new Error(`the removal was not recorded: ${decided}`);
    removalDecision = decided.decisionId;
    const opened = await recordCommand(migrateDb, parseRecordArgs("notification-open", ["--case", removalCase, "--duty", "voluntary"]), async () => Buffer.alloc(0));
    if (!opened.ok) throw new Error(opened.problem);
    recordId = /record ([0-9a-f-]{36})/.exec(opened.lines[0]!)![1]!;
    const answered = await recordCommand(
      migrateDb,
      parseRecordArgs("notification-event", [recordId, "--kind", "note", "--at", new Date(Date.now() - 60_000).toISOString(), "--how", "a note on the record"]),
      async () => Buffer.alloc(0),
    );
    if (!answered.ok) throw new Error(answered.problem);
    const verified = await orderCommand(migrateDb, parseOrderArgs("order-verify", [orderId, "--how", "compared with the register"]), { homeState: "DE", appOrigin }, async () => Buffer.alloc(0));
    if (!verified.ok) throw new Error(verified.problem);
    const [decision] = await migrateDb.execute<{ row: unknown }>(sql`select to_jsonb(d) as row from public.decisions d where d.id = ${removalDecision}::uuid`);
    const actions = await migrateDb.execute<{ row: unknown }>(sql`select to_jsonb(a) as row from public.decision_actions a where a.decision_id = ${removalDecision}::uuid`);
    lostDecision = { decision: decision!.row, actions: actions.map((a) => a.row) };
    const times = await migrateDb.execute<{ action: string; at: string; meta: Record<string, unknown> }>(
      sql`select action, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, metadata as meta from public.audit_log where chain_seq > ${head.seq} order by chain_seq`,
    );
    lostEffectAt = times.find((t) => t.action === "order_effected")!.at;
    lostRemovalAt = times.find((t) => t.action === "case_decided")!.at;
    lostOrderOpenedAt = String(times.find((t) => t.action === "order_opened")!.meta.openedAt);

    // The keeper's file: from 300 places before the backup's head to the newest row.
    const through = (await readHead()).seq;
    for await (const line of exportLines(apiDb, head.seq - 300, through)) tail.push(JSON.stringify(line));
  }, 300_000);
  afterAll(async () => {
    await world.close({ keepStaff: true });
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  test("the keeper's file holds the 300 places before the head and every lost row, oldest first", () => {
    expect(placeOf(tail[0]!)).toBe(head.seq - 299);
    const actions = tail.filter((line) => placeOf(line) > head.seq).map((line) => (JSON.parse(line) as { action: string }).action);
    expect(actions).toEqual(expect.arrayContaining(["order_opened", "order_effected", "case_decided", "notification_recorded", "order_recorded"]));
  });

  test("after the restore the lost work is gone: no order, the post public, the head the backup's", async () => {
    await restoreForTest(migrateDb, backups[0]!);
    expect(await readHead()).toEqual(head);
    expect((await migrateDb.execute(sql`select 1 from public.legal_orders where id = ${orderId}::uuid`)).length).toBe(0);
    expect((await migrateDb.execute<{ state: string }>(sql`select state::text from public.posts where id = ${orderPost}::uuid`))[0]!.state).toBe("visible");
    expect((await migrateDb.execute<{ frozen: boolean }>(sql`select public.post_preserved(${orderPost}::uuid) as frozen`))[0]!.frozen).toBe(false);
  });

  test("a changed file is refused whole and writes nothing: a tail that begins above the head's next place, a line that does not recompute, another hash at the head's place or at a kept place", async () => {
    const gapsBefore = await count("restore_gaps");
    const refusedWith = async (lines: readonly string[], kept: { seq: number; hash: string }[] = []) => {
      const done = await restoreImport(migrateDb, kept, input(lines), appOrigin);
      expect(done.ok).toBe(false);
      if (!done.ok) expect(done.problem).toMatch(new RegExp(`^restore-import: refused: line [0-9]+ does not continue the restored head ${head.seq}:${head.hash}; nothing was written$`));
    };
    await refusedWith(tail.filter((line) => placeOf(line) > head.seq + 1));
    const changed = tail.map((line) => (placeOf(line) === head.seq + 1 ? line.replace("Bundeskriminalamt", "Bundesamt") : line));
    await refusedWith(changed);
    const other = tail.map((line) => (placeOf(line) === head.seq ? line.replace(head.hash, "e".repeat(64)) : line));
    await refusedWith(other);
    await refusedWith(tail, [{ seq: head.seq - 10, hash: "f".repeat(64) }]);
    expect(await count("restore_gaps")).toBe(gapsBefore);
    expect(await readHead()).toEqual(head);
    expect((await migrateDb.execute(sql`select 1 from public.legal_orders where id = ${orderId}::uuid`)).length).toBe(0);
  });

  test("a hole is reported, not fatal: the run up to it is imported, the hole printed and in the audit row, nothing behind it", async () => {
    const holed = tail.filter((line) => placeOf(line) !== head.seq + 2);
    const done = await restoreImport(migrateDb, [], input(holed), appOrigin);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.lines[0]).toBe(`restore-import: places ${head.seq + 1} to ${head.seq + 1} continue the head ${head.seq}:${head.hash} (300 earlier lines checked, not imported).`);
    expect(done.lines.at(-1)).toBe(`restore-import: the files hold nothing between place ${head.seq + 1} and place ${head.seq + 3}: what happened there is not imported`);
    const [imported] = await migrateDb.execute<{ meta: { holes: number[][]; firstPlace: number; lastPlace: number; files: string[] } }>(
      sql`select metadata as meta from public.audit_log where action = 'restore_imported' order by chain_seq desc limit 1`,
    );
    expect(imported!.meta.holes).toEqual([[head.seq + 1, head.seq + 3]]);
    expect([imported!.meta.firstPlace, imported!.meta.lastPlace]).toEqual([head.seq + 1, head.seq + 1]);
    expect(imported!.meta.files).toHaveLength(1);
    // The order is back; its effect, behind the hole, is not.
    expect((await migrateDb.execute<{ disabled: string | null }>(sql`select disabled_at::text as disabled from public.legal_order_items where id = ${itemId}::uuid`))[0]!.disabled).toBeNull();
    expect((await migrateDb.execute(sql`select 1 from public.restore_gaps where class = 'order_effect' and target_id = ${itemId}`)).length).toBe(0);
  });

  test("the import writes the records again with their original times and one gap for each lost decision, never a decision or a measure; the post is frozen at once", async () => {
    await restoreForTest(migrateDb, backups[1]!);
    const decisions = await count("decisions");
    const measures = await count("decision_actions");
    const done = await restoreImport(migrateDb, [{ seq: head.seq - 10, hash: (JSON.parse(tail.find((line) => placeOf(line) === head.seq - 10)!) as { hash: string }).hash }], input(tail), appOrigin);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.lines[0]).toMatch(new RegExp(`^restore-import: places ${head.seq + 1} to [0-9]+ continue the head ${head.seq}:${head.hash} [(]300 earlier lines checked, not imported[)][.]$`));
    expect(done.lines).toContain("restore-import: gaps, in the order to take them again:");
    expect(done.lines.some((line) => line.startsWith("restore-import: 1. order_effect, order_item"))).toBe(true);
    expect(done.lines).toContain("restore-import: The app's site stays closed until gaps 1 to 1 are closed on the console's After a restore screen.");
    // No ledger row: the import writes records and gaps alone.
    expect(await count("decisions")).toBe(decisions);
    expect(await count("decision_actions")).toBe(measures);
    const [order] = await migrateDb.execute<{ opened: string; imported: boolean; verified: boolean; section_c: boolean }>(
      sql`select to_char(opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as opened, imported_at is not null as imported, verified_at is not null as verified, section_c from public.legal_orders where id = ${orderId}::uuid`,
    );
    expect(order).toEqual({ opened: lostOrderOpenedAt, imported: true, verified: true, section_c: true });
    const [item] = await migrateDb.execute<{ disabled: string; preserve: boolean; decision: string | null }>(
      sql`select to_char(disabled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as disabled, preserve_until = public.order_preserve_until(disabled_at) as preserve, decision_id as decision
            from public.legal_order_items where id = ${itemId}::uuid`,
    );
    expect(item).toEqual({ disabled: lostEffectAt, preserve: true, decision: null });
    expect((await migrateDb.execute<{ frozen: boolean }>(sql`select public.post_preserved(${orderPost}::uuid) as frozen`))[0]!.frozen).toBe(true);
    expect((await migrateDb.execute<{ state: string }>(sql`select state::text from public.posts where id = ${orderPost}::uuid`))[0]!.state).toBe("visible");
    const [record] = await migrateDb.execute<{ state: string; imported: boolean; case_id: string }>(
      sql`select state, imported_at is not null as imported, case_id from public.authority_notifications where id = ${recordId}::uuid`,
    );
    expect(record).toEqual({ state: "owed", imported: true, case_id: removalCase });
    const gaps = await migrateDb.execute<{ class: string; action: string; open: boolean }>(
      sql`select class, action, closed_at is null as open from public.restore_gaps where place > ${head.seq} order by place, target_id`,
    );
    expect(gaps.filter((g) => g.open).map((g) => [g.class, g.action])).toEqual([
      ["order_effect", "order_effected"],
      ["restriction", "case_decided"],
      ["record", "notification_recorded"],
    ]);
    expect(gaps.filter((g) => !g.open).map((g) => g.action).sort()).toEqual(["notification_recorded", "order_opened", "order_recorded"]);
    const [imported] = await migrateDb.execute<{ action: string; counts: Record<string, number> }>(
      sql`select action, metadata -> 'counts' as counts from public.audit_log where chain_seq = (select seq from public.audit_head where id = 1)`,
    );
    expect(imported).toEqual({ action: "restore_imported", counts: { order_effect: 1, restriction: 1, record: 4 } });
  });

  test("the migrator's own copy of the lost decision and its measure never commits: decision_holds refuses it without a confirmed audit row", async () => {
    const decisions = await count("decisions");
    const copied = refusal(
      migrateDb.transaction(async (tx) => {
        await tx.execute(sql`insert into public.decisions select * from jsonb_populate_record(null::public.decisions, ${JSON.stringify(lostDecision.decision)}::jsonb)`);
        for (const action of lostDecision.actions) await tx.execute(sql`insert into public.decision_actions select * from jsonb_populate_record(null::public.decision_actions, ${JSON.stringify(action)}::jsonb)`);
      }),
    );
    expect(await copied).not.toBeNull();
    expect(await count("decisions")).toBe(decisions);
    expect((await migrateDb.execute<{ state: string }>(sql`select state::text from public.posts p join public.cases c on c.target_id = p.id where c.id = ${removalCase}::uuid`))[0]!.state).toBe("visible");
  });

  test("taken again under a key: the disabling keeps its first time and its preservation, its notice stays held, and its gap closes; the removal closes its own, and its statement names the lost day", async () => {
    const view = (await orderView(moderationDeps(apiDb, { config: orderConfig() }), orderId, { role: "moderator" }))!;
    expect(view.items[0]!.gap).toBe(true);
    const again = await effectForTest(world, mod, orderId, effectParams(view));
    if (typeof again === "string") throw new Error(`the effect was not recorded: ${again}`);
    const [item] = await migrateDb.execute<{ disabled: string; preserve: boolean; decision: string }>(
      sql`select to_char(disabled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as disabled, preserve_until = public.order_preserve_until(${lostEffectAt}::timestamptz) as preserve, decision_id as decision
            from public.legal_order_items where id = ${itemId}::uuid`,
    );
    expect([item!.disabled, item!.preserve]).toEqual([lostEffectAt, true]);
    const [held] = await migrateDb.execute<{ informed: string | null; level: string }>(
      sql`select d.informed_at::text as informed, p.moderation_level::text as level from public.decisions d join public.posts p on p.id = ${orderPost}::uuid where d.id = ${item!.decision}::uuid`,
    );
    expect(held).toEqual({ informed: null, level: "disabled" });
    const [effectGap] = await migrateDb.execute<{ disposition: string; closed_by: string }>(sql`select disposition, closed_by from public.restore_gaps where class = 'order_effect' and target_id = ${itemId}`);
    expect(effectGap).toEqual({ disposition: "reapplied", closed_by: item!.decision });
    const [removal] = await migrateDb.execute<{ id: string }>(sql`select id from public.restore_gaps where class = 'restriction' and closed_at is null and place > ${head.seq}`);
    const decided = await world.decideAs(admin, removalCase, { kind: "final", actions: [act("remove")] }, { gap: removal!.id });
    if (typeof decided === "string") throw new Error(`the removal was not taken again: ${decided}`);
    const [closed] = await migrateDb.execute<{ disposition: string; closed_by: string }>(sql`select disposition, closed_by from public.restore_gaps where id = ${removal!.id}::uuid`);
    expect(closed).toEqual({ disposition: "reapplied", closed_by: decided.decisionId });
    const [audit] = await migrateDb.execute<{ gap: string }>(sql`select metadata ->> 'gapId' as gap from public.audit_log where action = 'case_decided' and metadata ->> 'decisionId' = ${decided.decisionId}`);
    expect(audit!.gap).toBe(removal!.id);
    const { decisionStatement } = await import("../../src/moderation/statement");
    const statement = (await decisionStatement(apiDb, decided.decisionId))!.statement;
    expect(statement.reapplied).toEqual({ lostOn: lostRemovalAt.slice(0, 10) });
  });

  test("leaves the database as the file found it", async () => {
    await restoreForTest(migrateDb, found);
    expect(await rowCounts(apiDb, [...ORDER_TABLES, ...RECOVERY_TABLES])).toEqual(before);
  });
});
