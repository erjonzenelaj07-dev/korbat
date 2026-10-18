import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { ALERT_KINDS, ORDER_RULES, renderAlert } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createStore, createWatcher } from "../../src/notify/main";
import { fakeImap, makeCertificate, type FakeImap, type ScriptFolder } from "../notify/fake-imap";
import { fakeNtfy, type FakeNtfy } from "../notify/fake-ntfy";
import { CHANNEL_TABLES, rowCounts } from "./moderation-fixtures";
import { ageMessageForTest, closeNotifyFixtures, contactMessageForTest, nextValidity, notifyDb, outboxOf, removeMessages } from "./notify-fixtures";
import { pgError } from "./staff-fixtures";

vi.setConfig({ testTimeout: 60_000 });

/**
 * The watcher's side of the database (3f design, sections 6.1 and 7.1; invariants 12 to 14): as korbat_notify, a message's
 * insert with the columns the triggers force, the first push's row the insert writes, the bound on a flood, and the
 * loop's own statements run by the real watcher against fakeImap and fakeNtfy: the messages and the folders' marks, the
 * publish of every row still owed its push and of none past its bound, and the beat. The client's own rules are the unit
 * file test/notify/imap.test.ts. Each test removes its messages and their rows; the watcher's state rows are removed when
 * the file ends, and its last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the watcher's role and its statements", () => {
  let migrateDb: Db;
  let apiDb: Db;
  let before: Record<string, number>;
  const made: string[] = [];
  const pair = makeCertificate();
  const servers: { close(): Promise<void> }[] = [];

  beforeAll(async () => {
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    apiDb = createDb(process.env.DATABASE_URL_API!, { max: 2 });
    before = await rowCounts(apiDb, CHANNEL_TABLES);
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
    await removeMessages(migrateDb, made.splice(0));
  });
  afterAll(async () => {
    await migrateDb.execute(sql`delete from public.notify_state`);
    await migrateDb.execute(sql`delete from public.notify_folders`);
    await closeNotifyFixtures();
    await Promise.all([closeDb(migrateDb), closeDb(apiDb)]);
  });

  const message = async (receivedAt: Date, folder: "inbox" | "junk" = "inbox") => {
    const id = await contactMessageForTest(receivedAt, folder);
    made.push(id);
    return id;
  };
  const row = async (id: string) =>
    (await migrateDb.execute<{ received_at: string; seen_at: string; stale: boolean; disposition: string | null; handled_at: string | null; clock: string }>(
      sql`select received_at, seen_at, stale, disposition, handled_at, clock_timestamp() as clock from public.contact_messages where id = ${id}::uuid`,
    ))[0]!;

  test("as korbat_notify a message is its four columns, and the database forces the rest: seen now, not stale, nobody's yet", async () => {
    const id = await message(new Date(Date.now() - 60_000), "junk");
    const r = await row(id);
    expect(r.stale).toBe(false);
    expect([r.disposition, r.handled_at]).toEqual([null, null]);
    expect(Date.parse(r.seen_at)).toBeGreaterThan(Date.now() - 60_000);
    // A column the watcher may not write is refused, and so is any update and any read beyond its four tables.
    expect((await pgError(notifyDb().execute(sql`insert into public.contact_messages (folder, uidvalidity, uid, received_at, disposition) values ('inbox', ${nextValidity()}, 1, now(), 'not_an_order')`)))?.code)
      .toBe("42501");
    expect((await pgError(notifyDb().execute(sql`update public.contact_messages set received_at = now() where id = ${id}::uuid`)))?.code).toBe("42501");
    expect((await pgError(notifyDb().execute(sql`delete from public.contact_messages where id = ${id}::uuid`)))?.code).toBe("42501");
  });

  test("a time of receipt ahead of the database's clock is stored as the clock's time, so a deadline only ever moves earlier", async () => {
    const id = await message(new Date(Date.now() + 5 * 60_000));
    const r = await row(id);
    expect(Date.parse(r.received_at)).toBeLessThanOrEqual(Date.parse(r.clock));
    expect(r.received_at).toBe(r.seen_at);
  });

  test("the insert writes the first push's row: contact_mail, step 0, priority 5, to the phone on call, with the time of receipt and the deadline", async () => {
    const receivedAt = new Date(Date.now() - 2 * 60_000);
    const id = await message(receivedAt);
    const rows = await outboxOf(migrateDb, id);
    expect(rows).toHaveLength(1);
    const [first] = rows;
    expect([first!.kind, first!.step, first!.priority, first!.scope, first!.pushed_at, first!.mailed_at, first!.push_attempts]).toEqual(["contact_mail", 0, 5, "on_call", null, null, 0]);
    const stored = Date.parse((await row(id)).received_at);
    expect(Date.parse(String(first!.facts.receivedAt))).toBe(stored);
    expect(Date.parse(String(first!.facts.dueAt))).toBe(stored + ORDER_RULES.hourMinutes * 60_000);
    // The facts render the push's sentence, counts and times only.
    expect(renderAlert("contact_mail", first!.facts, new Date()).sentence).toMatch(/^Mail at the authorities' contact point, received [0-9:]+ UTC[.]/);
    expect(ALERT_KINDS.contact_mail.scope).toBe(first!.scope);
  });

  test("a message received more than stale_hours before it was seen is stale and raises nothing", async () => {
    const id = await message(new Date(Date.now() - (ORDER_RULES.staleHours * 60 + 1) * 60_000));
    expect((await row(id)).stale).toBe(true);
    expect(await outboxOf(migrateDb, id)).toEqual([]);
  });

  test("the bound on a flood: while an unhandled message's first push is younger than quiet_minutes, a further message gets its row and no first push", async () => {
    const first = await message(new Date());
    expect(await outboxOf(migrateDb, first)).toHaveLength(1);
    const second = await message(new Date());
    expect(await outboxOf(migrateDb, second)).toEqual([]);
    expect((await row(second)).stale).toBe(false);
    // Once the first push is older than the quiet minutes, a new message rings again.
    await migrateDb.execute(sql`update public.alert_outbox set created_at = created_at - make_interval(mins => ${ORDER_RULES.quietMinutes + 1}) where message_id = ${first}::uuid`);
    const third = await message(new Date());
    expect((await outboxOf(migrateDb, third)).map((r) => [r.kind, r.step])).toEqual([["contact_mail", 0]]);
    // A handled message bounds nothing: with the third handled, the next rings at once.
    await migrateDb.execute(sql`update public.contact_messages set disposition = 'not_an_order', handled_at = now() where id = ${third}::uuid`);
    const fourth = await message(new Date());
    expect(await outboxOf(migrateDb, fourth)).toHaveLength(1);
  });

  // ---------------------------------------------------------------- the loop's statements

  async function world(inbox: ScriptFolder, junk: ScriptFolder = { uidValidity: nextValidity(), messages: [] }) {
    const imap: FakeImap = await fakeImap({ user: "watcher", password: "secret", tls: pair, folders: new Map([["INBOX", inbox], ["Junk", junk]]) });
    const ntfy: FakeNtfy = await fakeNtfy();
    servers.push(imap, ntfy);
    // Each world starts from no mark: a folder of another world's validity is read whole.
    await migrateDb.execute(sql`delete from public.notify_folders`);
    const watcher = createWatcher({
      store: createStore(notifyDb()),
      imap: { host: "localhost", port: imap.port, user: "watcher", password: "secret", junk: "Junk", ca: imap.ca, timeoutMs: 5_000 },
      push: { url: ntfy.url, token: "tk_publisher" },
      fetch,
      now: () => new Date(),
      log: pino({ level: "silent" }),
    });
    servers.push({ close: () => watcher.stop() });
    return { imap, ntfy, watcher };
  }
  /** The messages of a validity number, by UID, as the migrator reads them. */
  const messagesOf = async (uidvalidity: number) =>
    (await migrateDb.execute<{ id: string; folder: string; uid: string; received_at: string; stale: boolean }>(sql`select id, folder, uid, received_at, stale from public.contact_messages where uidvalidity = ${uidvalidity} order by uid`)).map(
      (r) => ({ ...r, uid: Number(r.uid) }),
    );

  test("a round inserts each new message with its internal date, marks the folders, publishes the first push and beats", async () => {
    const inbox = { uidValidity: nextValidity(), messages: [{ uid: 4, internalDate: new Date(Date.now() - 30_000) }] };
    const junk = { uidValidity: nextValidity(), messages: [{ uid: 9, internalDate: new Date(Date.now() - 20_000) }] };
    const w = await world(inbox, junk);
    const report = await w.watcher.round();
    const inInbox = await messagesOf(inbox.uidValidity);
    const inJunk = await messagesOf(junk.uidValidity);
    made.push(...inInbox.map((m) => m.id), ...inJunk.map((m) => m.id));
    expect(report).toMatchObject({ mailboxOk: true, inserted: 2 });
    expect(inInbox.map((m) => [m.folder, m.uid, Date.parse(m.received_at)])).toEqual([["inbox", 4, Math.floor(inbox.messages[0]!.internalDate.getTime() / 1000) * 1000]]);
    expect(inJunk.map((m) => [m.folder, m.uid])).toEqual([["junk", 9]]);
    const marks = await migrateDb.execute<{ folder: string; uidvalidity: string; last_uid: string }>(sql`select folder, uidvalidity, last_uid from public.notify_folders order by folder`);
    expect(marks.map((m) => [m.folder, Number(m.uidvalidity), Number(m.last_uid)])).toEqual([
      ["inbox", inbox.uidValidity, 4],
      ["junk", junk.uidValidity, 9],
    ]);
    // The first message's push went out; the second, inside the quiet minutes, raised none of its own.
    const pushed = await outboxOf(migrateDb, inInbox[0]!.id);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.pushed_at).not.toBeNull();
    expect(w.ntfy.published.filter((p) => p.tags === "contact_mail" && p.topic === "korbat-oncall")).toHaveLength(1);
    expect(await outboxOf(migrateDb, inJunk[0]!.id)).toEqual([]);
    const [state] = await migrateDb.execute<{ beat: boolean; mailbox: boolean; push: boolean; error: string | null }>(
      sql`select beat_at > now() - interval '1 minute' as beat, mailbox_ok_at > now() - interval '1 minute' as mailbox, push_ok_at > now() - interval '1 minute' as push, error from public.notify_state where id = 1`,
    );
    expect(state).toEqual({ beat: true, mailbox: true, push: true, error: null });
    // The next round reads from the marks and inserts nothing twice.
    expect((await w.watcher.round()).inserted).toBe(0);
    expect(await messagesOf(inbox.uidValidity)).toHaveLength(1);
  });

  test("a push is owed for push_owed_minutes and no longer: a row past its bound is not published and counts for nothing", async () => {
    const id = await message(new Date());
    await migrateDb.execute(sql`update public.alert_outbox set created_at = created_at - make_interval(mins => ${ORDER_RULES.pushOwedMinutes + 1}) where message_id = ${id}::uuid`);
    const fresh = await message(new Date(Date.now() - 1000));
    const w = await world({ uidValidity: nextValidity(), messages: [] });
    // The first message's push is older than the quiet minutes too, so the second rang.
    await w.watcher.round();
    const [old] = await outboxOf(migrateDb, id);
    expect([old!.pushed_at, old!.push_attempts]).toEqual([null, 0]);
    const [rang] = await outboxOf(migrateDb, fresh);
    expect(rang!.pushed_at).not.toBeNull();
    expect(w.ntfy.published.some((p) => p.text.includes(renderAlert("contact_mail", rang!.facts, new Date()).sentence))).toBe(true);
  });

  test("a push the server refuses counts an attempt and stays owed, the beat says push_refused, and the next round publishes it", async () => {
    const id = await message(new Date());
    const w = await world({ uidValidity: nextValidity(), messages: [] });
    w.ntfy.fail({ status: 503, count: 1_000 });
    const failed = await w.watcher.round();
    expect(failed.pushOk).toBe(false);
    const [owed] = await outboxOf(migrateDb, id);
    expect([owed!.pushed_at, owed!.push_attempts]).toEqual([null, 1]);
    const [state] = await migrateDb.execute<{ error: string | null }>(sql`select error from public.notify_state where id = 1`);
    expect(state!.error).toBe("push_refused");
    w.ntfy.fail({ count: 0 });
    expect((await w.watcher.round()).pushOk).toBe(true);
    expect((await outboxOf(migrateDb, id))[0]!.pushed_at).not.toBeNull();
  });

  test("a first start on a mailbox with old mail inserts every message, each stale, and raises nothing", async () => {
    const old = Date.now() - 3 * 24 * 60 * 60_000;
    const inbox = { uidValidity: nextValidity(), messages: Array.from({ length: 300 }, (_, i) => ({ uid: i + 1, internalDate: new Date(old + i * 60_000) })) };
    const w = await world(inbox);
    expect((await w.watcher.round()).inserted).toBe(300);
    const rows = await messagesOf(inbox.uidValidity);
    made.push(...rows.map((m) => m.id));
    expect(rows).toHaveLength(300);
    expect(rows.every((m) => m.stale)).toBe(true);
    const [raised] = await migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.alert_outbox where message_id = any(${`{${rows.map((m) => m.id).join(",")}}`}::uuid[])`);
    expect(raised!.n).toBe(0);
  }, 120_000);

  test("a changed UIDVALIDITY reads the folder whole: every message is a new row, and the earlier rows stay", async () => {
    const first = nextValidity();
    const inbox = { uidValidity: first, messages: [{ uid: 1, internalDate: new Date(Date.now() - 10_000) }] };
    const w = await world(inbox);
    await w.watcher.round();
    const second = nextValidity();
    w.imap.folders.set("INBOX", { uidValidity: second, messages: [{ uid: 1, internalDate: new Date(Date.now() - 10_000) }] });
    expect((await w.watcher.round()).inserted).toBe(1);
    const before = await messagesOf(first);
    const after = await messagesOf(second);
    made.push(...before.map((m) => m.id), ...after.map((m) => m.id));
    expect([before.length, after.length]).toEqual([1, 1]);
    expect(after[0]!.received_at).toBe(before[0]!.received_at);
  });

  test("the watcher's role holds its four tables' grants and order_rules(), and nothing else of the database", async () => {
    const db = notifyDb();
    expect((await db.execute<{ n: number }>(sql`select (public.order_rules()).hour_minutes as n`))[0]!.n).toBe(ORDER_RULES.hourMinutes);
    for (const statement of [
      sql`select 1 from public.profiles limit 1`,
      sql`select 1 from public.audit_log limit 1`,
      sql`select public.alert_steps()`,
      sql`insert into public.alert_outbox (kind, priority, scope, facts) values ('alert_test', 3, 'all', '{}')`,
      sql`update public.alert_outbox set mailed_at = now() where false`,
      sql`delete from public.alert_outbox where false`,
      sql`select 1 from auth.users limit 1`,
    ]) {
      expect((await pgError(db.execute(statement)))?.code).toBe("42501");
    }
  });

  test("leaves no row behind", async () => {
    await migrateDb.execute(sql`delete from public.notify_state`);
    await migrateDb.execute(sql`delete from public.notify_folders`);
    await removeMessages(migrateDb, made.splice(0));
    // The rows other files' alerts left owed were published by these rounds: their pushed_at moved, their number did not.
    expect(await rowCounts(apiDb, CHANNEL_TABLES)).toEqual(before);
  });
});
