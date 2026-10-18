import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { ALERT_KINDS, ORDER_RULES, renderAlert, type AlertFacts } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import type { StaffMessage } from "../../src/auth";
import { alertTick, channelHealth, staffAlert } from "../../src/moderation/alerts";
import { overview } from "../../src/moderation/cases";
import { CHANNEL_TABLES, rowCounts } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { ageMessageForTest, closeNotifyFixtures, contactMessageForTest, nextValidity, outboxOf, outboxSince, removeMessages, type OutboxRow } from "./notify-fixtures";
import { newStaffKey, newStaffSession, rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 60_000 });

const MIN = 60_000;

/**
 * The alert channel's time-driven alerts and its two legs (3f design, sections 6.1, 7.2 and 12.1; invariants 14 and 15):
 * alert_steps() writes an escalation at escalate_minutes and the deadline's two reminders, each once, and stops them when
 * the message is handled; a person already at work in the console is not absent; the daily test is written once a day.
 * The alert tick mails every row whose mail is its sentence once, never one of 3c's or 3e's kinds, and with NOTIFY on
 * judges the channel's health with its own alarms, once in 24 hours. staffAlert writes the row of every kind of 3c and
 * 3e and marks it mailed either way.
 *
 * The steps run inside transactions of the migrator that end in a rollback: there the test sets the times it needs and
 * pushes every staff session back a day, so that the sessions earlier files of the run opened do not count as someone at
 * work. The tick commits, as the server's does; its rows and messages are removed by id, and the file's last test holds
 * it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the alert steps and the alert tick", () => {
  let w: NoticesWorld;
  let staffEmail: string;
  let before: Record<string, number>;
  const made: string[] = [];
  const started = new Date();

  beforeAll(async () => {
    w = noticesWorld();
    before = await rowCounts(w.apiDb, CHANNEL_TABLES);
    // A live staff account with a key and a session: the address the staff mails of this file go to, and a session a
    // test can mark as used.
    const staff = await newStaffKey(w.authDb, w.migrateDb, w.repo, "moderator");
    staffEmail = staff.user.email;
    await newStaffSession(w.authDb, staff.user.id, staff.key.id);
    await w.migrateDb.execute(sql`delete from public.notify_state`);
  }, 60_000);
  afterEach(async () => {
    await removeMessages(w.migrateDb, made.splice(0));
  });
  afterAll(async () => {
    await w.migrateDb.execute(sql`delete from public.notify_state`);
    await closeNotifyFixtures();
    await w.close();
  });

  /** A message inside the migrator's transaction, received `minutes` ago: the migrator keeps the time it supplies. */
  const messageIn = async (tx: DbTx, minutes: number, extra: { stale?: boolean } = {}) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into public.contact_messages (folder, uidvalidity, uid, received_at, seen_at, stale)
      values ('inbox', ${nextValidity()}, 1, now() - make_interval(mins => ${minutes}), now() - make_interval(mins => ${minutes}), ${extra.stale ?? false}) returning id`);
    return row!.id;
  };
  /** Every staff session pushed a day back, its lifetime with it: nobody is at work in the console. */
  const nobodyAtWork = (tx: DbTx) =>
    tx.execute(sql`update auth.staff_sessions set created_at = created_at - interval '1 day', last_used_at = last_used_at - interval '1 day', idle_expires_at = idle_expires_at - interval '1 day', absolute_expires_at = absolute_expires_at - interval '1 day'`);
  const steps = async (tx: DbTx) => Number((await tx.execute<{ written: number }>(sql`select public.alert_steps() as written`))[0]!.written);
  const kinds = (rows: OutboxRow[]) => rows.map((r) => [r.kind, r.step]);

  test("an unanswered message is escalated to every phone once, escalate_minutes after it arrived, and not before", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      await nobodyAtWork(tx);
      const early = await messageIn(tx, ORDER_RULES.escalateMinutes - 1);
      const due = await messageIn(tx, ORDER_RULES.escalateMinutes + 1);
      await steps(tx);
      expect(kinds((await outboxOf(tx, early)).filter((r) => r.kind === "contact_mail_escalated"))).toEqual([]);
      const escalated = (await outboxOf(tx, due)).filter((r) => r.kind === "contact_mail_escalated");
      expect(kinds(escalated)).toEqual([["contact_mail_escalated", 0]]);
      expect([escalated[0]!.priority, escalated[0]!.scope]).toEqual([5, "all"]);
      expect(Object.keys(escalated[0]!.facts).sort()).toEqual(["dueAt", "receivedAt"]);
      // Once a message: a second call writes nothing for it.
      await steps(tx);
      expect((await outboxOf(tx, due)).filter((r) => r.kind === "contact_mail_escalated")).toHaveLength(1);
    });
  });

  test("a person already signed in who acts in the console is not absent: a staff session created or used since the message arrived stops the escalation", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      await nobodyAtWork(tx);
      const [session] = await tx.execute<{ id: string }>(sql`select id from auth.staff_sessions limit 1`);
      expect(session, "a staff session of this run").toBeDefined();
      await tx.execute(sql`update auth.staff_sessions set last_used_at = now() where id = ${session!.id}`);
      const due = await messageIn(tx, ORDER_RULES.escalateMinutes + 1);
      await steps(tx);
      expect((await outboxOf(tx, due)).filter((r) => r.kind === "contact_mail_escalated")).toEqual([]);
    });
  });

  test("order_due for a message: one row at remind_minutes and one at the deadline, each once, with the deadline and the minutes left", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      await nobodyAtWork(tx);
      const early = await messageIn(tx, ORDER_RULES.remindMinutes - 1);
      const reminded = await messageIn(tx, ORDER_RULES.remindMinutes + 1);
      const late = await messageIn(tx, ORDER_RULES.hourMinutes + 1);
      await steps(tx);
      const due = async (id: string) => (await outboxOf(tx, id)).filter((r) => r.kind === "order_due");
      expect(await due(early)).toEqual([]);
      const [first] = await due(reminded);
      expect([first!.step, first!.priority, first!.scope]).toEqual([0, 5, "all"]);
      expect(first!.facts.minutesLeft).toBe(ORDER_RULES.hourMinutes - ORDER_RULES.remindMinutes - 1);
      expect(renderAlert("order_due", first!.facts, new Date()).title).toBe(`${first!.facts.minutesLeft} minutes left`);
      // Past the deadline only the deadline's row: the later of the two that has passed.
      expect((await due(late)).map((r) => [r.step, r.facts.minutesLeft])).toEqual([[0, 0]]);
      // Each once: a second call writes nothing; the deadline's row comes when the deadline passes.
      await steps(tx);
      expect(await due(reminded)).toHaveLength(1);
      await ageMessageForTest(tx, reminded, ORDER_RULES.hourMinutes - ORDER_RULES.remindMinutes);
      await steps(tx);
      expect((await due(reminded)).map((r) => [r.step, r.facts.minutesLeft])).toEqual([
        [0, ORDER_RULES.hourMinutes - ORDER_RULES.remindMinutes - 1],
        [1, 0],
      ]);
    });
  });

  test("handling a message ends its steps, and a stale message never has any", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      await nobodyAtWork(tx);
      const handled = await messageIn(tx, ORDER_RULES.hourMinutes + 1);
      await tx.execute(sql`update public.contact_messages set disposition = 'referral', handled_at = now() where id = ${handled}::uuid`);
      const stale = await messageIn(tx, ORDER_RULES.hourMinutes + 1, { stale: true });
      await steps(tx);
      // The handled message keeps the first push its insert wrote, and gets nothing more.
      expect(kinds(await outboxOf(tx, handled))).toEqual([["contact_mail", 0]]);
      expect(await outboxOf(tx, stale)).toEqual([]);
    });
  });

  test("the daily test is written once in 24 hours, pushed only", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      await tx.execute(sql`delete from public.alert_outbox where kind = 'alert_test'`);
      const at = new Date(Date.now() - 1000);
      await steps(tx);
      const [test] = await outboxSince(tx, "alert_test", at);
      expect([test!.priority, test!.scope, test!.step, Object.keys(test!.facts)]).toEqual([3, "all", 0, ["at"]]);
      expect(ALERT_KINDS.alert_test.legs).toEqual(["push"]);
      await steps(tx);
      expect(await outboxSince(tx, "alert_test", at)).toHaveLength(1);
      // A day later the next one, with the next step.
      // The transaction's own clock stands still: the row moves back a day and a minute.
      await tx.execute(sql`update public.alert_outbox set created_at = created_at - interval '1 day 1 minute' where kind = 'alert_test'`);
      await steps(tx);
      expect((await tx.execute<{ step: number }>(sql`select step from public.alert_outbox where kind = 'alert_test' order by step`)).map((r) => r.step)).toEqual([0, 1]);
    });
  });

  test("two calls at once write a step once: the unique key drops the second", async () => {
    const id = await contactMessageForTest(new Date());
    made.push(id);
    await ageMessageForTest(w.migrateDb, id, ORDER_RULES.remindMinutes + 1);
    await Promise.all([w.apiDb.execute(sql`select public.alert_steps()`), w.apiDb.execute(sql`select public.alert_steps()`)]);
    expect((await outboxOf(w.migrateDb, id)).filter((r) => r.kind === "order_due")).toHaveLength(1);
  });

  // ---------------------------------------------------------------- the tick

  const tickDeps = (notify: "on" | "off") => ({ ...w.deps, config: { ...w.deps.config, NOTIFY: notify } });
  const mailsOf = (template: string) => w.mailer.to(staffEmail, template);

  test("the tick's mail leg mails a row whose mail is its sentence once, to every staff account, and marks it", async () => {
    const id = await contactMessageForTest(new Date());
    made.push(id);
    const sent = mailsOf("contact_mail").length;
    const report = await alertTick(tickDeps("off"));
    expect(report.channel).toBeNull();
    const [row] = await outboxOf(w.migrateDb, id);
    expect(row!.mailed_at).not.toBeNull();
    const mails = mailsOf("contact_mail").slice(sent);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.data).toMatchObject({ receivedAt: row!.facts.receivedAt, dueAt: row!.facts.dueAt });
    // Mailed once: the next round finds nothing owed.
    await alertTick(tickDeps("off"));
    expect(mailsOf("contact_mail").slice(sent)).toHaveLength(1);
  });

  test("a row whose mail no address took is tried again next round", async () => {
    const id = await contactMessageForTest(new Date());
    made.push(id);
    w.mailer.mode = "fail";
    try {
      await alertTick(tickDeps("off"));
    } finally {
      w.mailer.mode = "deliver";
    }
    expect((await outboxOf(w.migrateDb, id))[0]!.mailed_at).toBeNull();
    await alertTick(tickDeps("off"));
    expect((await outboxOf(w.migrateDb, id))[0]!.mailed_at).not.toBeNull();
  });

  test("staffAlert writes the row of each kind of 3c and 3e, with its counts and times, and marks it mailed whether or not an address took the mail; the tick never mails it again", async () => {
    const at = new Date();
    const messages: StaffMessage[] = [
      { template: "moderation_urgent", count: 2, oldest: at },
      { template: "moderation_waiting", lanes: [{ lane: 1, count: 3, oldest: at }], interim: 0 },
      { template: "moderation_burst", handle: "mod_anna", count: 20 },
      { template: "moderation_reads", handle: "mod_anna", limit: 200 },
      { template: "moderation_reveal", handle: "mod_anna", at, count: 1, limit: 10 },
      { template: "moderation_csam_lifted", handle: "mod_anna", at, what: "unsealed" },
    ];
    const since = new Date(Date.now() - 1000);
    for (const [index, message] of messages.entries()) {
      // Every other one finds no address that takes its mail.
      w.mailer.mode = index % 2 === 0 ? "deliver" : "fail";
      try {
        expect(await staffAlert(w.deps, `alerts-steps-${randomUUID()}`, MIN, message), message.template).toBe("sent");
      } finally {
        w.mailer.mode = "deliver";
      }
    }
    for (const message of messages) {
      const rows = await outboxSince(w.migrateDb, message.template, since);
      expect(rows, message.template).toHaveLength(1);
      const [row] = rows;
      expect([row!.priority, row!.scope, row!.step, row!.mailed_at !== null], message.template).toEqual([ALERT_KINDS[message.template].priority, ALERT_KINDS[message.template].scope, null, true]);
      // The push names nobody: the handle of the staff mail is not among its facts.
      expect(JSON.stringify(row!.facts), message.template).not.toContain("mod_anna");
    }
    const mailed = messages.map((m) => w.mailer.attempts.filter((a) => a.template === m.template).length);
    await alertTick(tickDeps("off"));
    expect(messages.map((m) => w.mailer.attempts.filter((a) => a.template === m.template).length)).toEqual(mailed);
    await w.migrateDb.execute(sql`delete from public.alert_outbox where kind like 'moderation_%' and created_at >= ${since.toISOString()}::timestamptz`);
  });

  // ---------------------------------------------------------------- the channel's health

  const beat = (beatMinutesAgo: number | null, mailboxMinutesAgo: number | null) =>
    w.migrateDb.execute(sql`
      insert into public.notify_state (id, beat_at, mailbox_ok_at, push_ok_at)
      values (1, case when ${beatMinutesAgo}::int is null then null else now() - make_interval(mins => ${beatMinutesAgo}::int) end,
                 case when ${mailboxMinutesAgo}::int is null then null else now() - make_interval(mins => ${mailboxMinutesAgo}::int) end, now())
      on conflict (id) do update set beat_at = excluded.beat_at, mailbox_ok_at = excluded.mailbox_ok_at`);
  const alarms = (since: Date) => w.migrateDb.execute<{ kind: string; facts: AlertFacts; mailed: boolean }>(sql`select kind, facts, mailed_at is not null as mailed from public.alert_outbox where kind in ('alert_channel_down', 'mailbox_unreachable') and created_at >= ${since.toISOString()}::timestamptz order by id`);
  const clearAlarms = () => w.migrateDb.execute(sql`delete from public.alert_outbox where kind in ('alert_channel_down', 'mailbox_unreachable')`);

  test("with NOTIFY off the channel is off, its check is skipped, and the tick still writes and mails the steps", async () => {
    await beat(null, null);
    expect(await channelHealth(tickDeps("off"))).toEqual({ channel: "off", since: null });
    const at = new Date();
    expect((await alertTick(tickDeps("off"))).raised).toEqual([]);
    expect(await alarms(at)).toEqual([]);
  });

  test("a beat older than channel_down_minutes is down: alert_channel_down once in 24 hours, mailed by the next round, and the home screen says so", async () => {
    await clearAlarms();
    await beat(ORDER_RULES.channelDownMinutes + 1, 0);
    const health = await channelHealth(tickDeps("on"));
    expect(health.channel).toBe("down");
    const at = new Date(Date.now() - 1000);
    expect((await alertTick(tickDeps("on"))).raised).toEqual(["alert_channel_down"]);
    expect((await alertTick(tickDeps("on"))).raised).toEqual([]);
    const rows = await alarms(at);
    expect(rows.map((r) => [r.kind, r.mailed])).toEqual([["alert_channel_down", true]]);
    expect(Date.parse(String(rows[0]!.facts.since))).toBe(health.since!.getTime());
    expect(mailsOf("alert_channel_down").length).toBeGreaterThanOrEqual(1);
    // Mailed only: the watcher publishes no row of this kind.
    expect(ALERT_KINDS.alert_channel_down.legs).toEqual(["mail"]);
    const home = await overview(tickDeps("on"), { userId: randomUUID() } as Parameters<typeof overview>[1]);
    expect(home.alerts.channel).toBe("down");
    await clearAlarms();
  });

  test("a push still owed for longer than channel_down_minutes reads as down, and a row past push_owed_minutes no longer counts", async () => {
    await clearAlarms();
    await beat(0, 0);
    // Rows other files left owed are not this test's to judge: a working watcher would have pushed them.
    await w.migrateDb.execute(sql`update public.alert_outbox set pushed_at = now() where pushed_at is null`);
    expect((await channelHealth(tickDeps("on"))).channel).toBe("ok");
    const id = await contactMessageForTest(new Date());
    made.push(id);
    await w.migrateDb.execute(sql`update public.alert_outbox set created_at = now() - make_interval(mins => ${ORDER_RULES.channelDownMinutes + 1}) where message_id = ${id}::uuid`);
    // Every other row still owed is pushed meanwhile, as a working watcher would have: this file judges its own row.
    await w.migrateDb.execute(sql`update public.alert_outbox set pushed_at = now() where pushed_at is null and message_id is distinct from ${id}::uuid`);
    expect((await channelHealth(tickDeps("on"))).channel).toBe("down");
    await w.migrateDb.execute(sql`update public.alert_outbox set created_at = now() - make_interval(mins => ${ORDER_RULES.pushOwedMinutes + 1}) where message_id = ${id}::uuid`);
    expect((await channelHealth(tickDeps("on"))).channel).toBe("ok");
    await clearAlarms();
  });

  test("a fresh beat with a mailbox not read for channel_down_minutes is mailbox_unreachable, pushed and mailed, once in 24 hours", async () => {
    await clearAlarms();
    await beat(0, ORDER_RULES.channelDownMinutes + 1);
    // Rows other files left owed are not this test's to judge: a working watcher would have pushed them.
    await w.migrateDb.execute(sql`update public.alert_outbox set pushed_at = now() where pushed_at is null`);
    expect((await channelHealth(tickDeps("on"))).channel).toBe("mailbox");
    const at = new Date(Date.now() - 1000);
    expect((await alertTick(tickDeps("on"))).raised).toEqual(["mailbox_unreachable"]);
    await alertTick(tickDeps("on"));
    expect((await alarms(at)).map((r) => [r.kind, r.mailed])).toEqual([["mailbox_unreachable", true]]);
    expect(ALERT_KINDS.mailbox_unreachable.legs).toEqual(["push", "mail"]);
    await clearAlarms();
    await w.migrateDb.execute(sql`delete from public.notify_state`);
  });

  test("the home screen counts the messages nobody handled, stale ones included, with the oldest and the earliest deadline", async () => {
    const first = await contactMessageForTest(new Date(Date.now() - 3 * 60 * MIN));
    const second = await contactMessageForTest(new Date(Date.now() - 2 * MIN));
    made.push(first, second);
    const home = await overview(tickDeps("off"), { userId: randomUUID() } as Parameters<typeof overview>[1]);
    expect(home.contact.open).toBeGreaterThanOrEqual(2);
    const [stored] = await w.migrateDb.execute<{ received_at: string }>(sql`select received_at from public.contact_messages where id = ${first}::uuid`);
    expect(home.contact.oldestAt).not.toBeNull();
    expect(Date.parse(home.contact.oldestAt!)).toBeLessThanOrEqual(Date.parse(stored!.received_at));
    expect(Date.parse(home.contact.dueAt!)).toBe(Date.parse(home.contact.oldestAt!) + ORDER_RULES.hourMinutes * MIN);
    expect(home.alerts).toEqual({ channel: "off", since: null });
  });

  test("leaves no row behind", async () => {
    await removeMessages(w.migrateDb, made.splice(0));
    // The tick's own daily test, which no message names, and the rows of this file's kinds of 3f.
    await w.migrateDb.execute(sql`delete from public.alert_outbox where created_at >= ${started.toISOString()}::timestamptz and kind in ('alert_test', 'alert_channel_down', 'mailbox_unreachable')`);
    expect(await rowCounts(w.apiDb, CHANNEL_TABLES)).toEqual(before);
  });
});
