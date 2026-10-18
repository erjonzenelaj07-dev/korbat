import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { ALERT_KINDS, ORDER_RULES, renderAlert, type AlertFacts } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import type { StaffMessage } from "../../src/auth";
import { alertMailLeg, alertTick, channelHealth, staffAlert } from "../../src/moderation/alerts";
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
  /** One round of each of the two jobs, the tick and (a job of its own since 3f's review) its mail leg: the tick's report. */
  const round = async (notify: "on" | "off") => {
    const report = await alertTick(tickDeps(notify));
    await alertMailLeg(tickDeps(notify));
    return report;
  };
  const mailsOf = (template: string) => w.mailer.to(staffEmail, template);

  test("the tick's mail leg mails a row whose mail is its sentence once, to every staff account, and marks it", async () => {
    const id = await contactMessageForTest(new Date());
    made.push(id);
    const sent = mailsOf("contact_mail").length;
    const report = await round("off");
    expect(report.channel).toBeNull();
    const [row] = await outboxOf(w.migrateDb, id);
    expect(row!.mailed_at).not.toBeNull();
    const mails = mailsOf("contact_mail").slice(sent);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.data).toMatchObject({ receivedAt: row!.facts.receivedAt, dueAt: row!.facts.dueAt });
    // Mailed once: the next round finds nothing owed.
    await round("off");
    expect(mailsOf("contact_mail").slice(sent)).toHaveLength(1);
  });

  test("a row whose mail no address took is tried again next round", async () => {
    const id = await contactMessageForTest(new Date());
    made.push(id);
    w.mailer.mode = "fail";
    try {
      await round("off");
    } finally {
      w.mailer.mode = "deliver";
    }
    expect((await outboxOf(w.migrateDb, id))[0]!.mailed_at).toBeNull();
    await round("off");
    expect((await outboxOf(w.migrateDb, id))[0]!.mailed_at).not.toBeNull();
  });

  test("staffAlert writes the row of each kind of 3c and 3e, with its counts and times, and marks it mailed whether or not an address took the mail; the tick never mails it again", async () => {
    const at = new Date();
    const messages: StaffMessage[] = [
      { template: "moderation_urgent", count: 2, oldest: at, phones: true },
      { template: "moderation_waiting", lanes: [{ lane: 1, count: 3, oldest: at }], interim: 0, phones: true },
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
    await round("off");
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
    expect((await round("off")).raised).toEqual([]);
    expect(await alarms(at)).toEqual([]);
  });

  test("a beat older than channel_down_minutes is down: alert_channel_down once in 24 hours, mailed by the next round, and the home screen says so", async () => {
    await clearAlarms();
    await beat(ORDER_RULES.channelDownMinutes + 1, 0);
    const health = await channelHealth(tickDeps("on"));
    expect(health.channel).toBe("down");
    const at = new Date(Date.now() - 1000);
    expect((await round("on")).raised).toEqual(["alert_channel_down"]);
    expect((await round("on")).raised).toEqual([]);
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
    // 3f's review (operations3): while the watcher's last publish was taken or only throttled (push_ok_at fresh), ntfy
    // answers and the row waits for its turn: not down. Once no publish has worked for channel_down_minutes, it is.
    await w.migrateDb.execute(sql`update public.notify_state set push_ok_at = now() where id = 1`);
    expect((await channelHealth(tickDeps("on"))).channel).toBe("ok");
    await w.migrateDb.execute(sql`update public.notify_state set push_ok_at = now() - make_interval(mins => ${ORDER_RULES.channelDownMinutes + 1}) where id = 1`);
    expect((await channelHealth(tickDeps("on"))).channel).toBe("down");
    await w.migrateDb.execute(sql`update public.alert_outbox set created_at = now() - make_interval(mins => ${ORDER_RULES.pushOwedMinutes + 1}) where message_id = ${id}::uuid`);
    expect((await channelHealth(tickDeps("on"))).channel).toBe("ok");
    // The watcher works again for the tests that follow.
    await w.migrateDb.execute(sql`update public.notify_state set push_ok_at = now() where id = 1`);
    await clearAlarms();
  });

  test("a fresh beat with a mailbox not read for channel_down_minutes is mailbox_unreachable, pushed and mailed, once in 24 hours", async () => {
    await clearAlarms();
    await beat(0, ORDER_RULES.channelDownMinutes + 1);
    // Rows other files left owed are not this test's to judge: a working watcher would have pushed them.
    await w.migrateDb.execute(sql`update public.alert_outbox set pushed_at = now() where pushed_at is null`);
    expect((await channelHealth(tickDeps("on"))).channel).toBe("mailbox");
    const at = new Date(Date.now() - 1000);
    expect((await round("on")).raised).toEqual(["mailbox_unreachable"]);
    await round("on");
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

  // ---------------------------------------------------------------- 3f, Task 2: an order's steps (section 6.1, the rows marked 0025)

  /** A removal order of the migrator's in the transaction, received `minutes` ago, with an item open or disabled. */
  async function orderIn(tx: DbTx, minutes: number, options: { disabled?: boolean; open?: boolean; kind?: string; verified?: boolean; reasons?: boolean } = {}): Promise<string> {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into public.legal_orders (id, kind, member_state, authority, reference, channel, section_c, emergency, cross_border, withhold_from_author, received_at, opened_at, opened_via,
                                       verified_at, reasons)
      values (gen_random_uuid(), ${options.kind ?? "tco_removal"}, 'DE', 'BKA', ${`S-${randomUUID()}`}, 'portal', false, false, false, true,
              now() - make_interval(mins => ${minutes}), now() - make_interval(mins => ${minutes}), 'cli',
              ${options.verified ? sql`now()` : sql`null`}, ${options.reasons ? "the authority's reasons" : null})
      returning id`);
    if (options.open ?? true) await tx.execute(sql`insert into public.legal_order_items (order_id, position, link) values (${row!.id}::uuid, 1, 'https://elsewhere.example/open')`);
    if (options.disabled) {
      await tx.execute(sql`insert into public.legal_order_items (order_id, position, link, added_at, disabled_at) values (${row!.id}::uuid, 2, 'https://elsewhere.example/done', now() - make_interval(hours => 2), now() - make_interval(mins => 1))`);
    }
    return row!.id;
  }
  const orderRows = async (tx: DbTx, orderId: string) =>
    (await tx.execute<{ kind: string; step: number; scope: string; priority: number; facts: Record<string, unknown> }>(
      sql`select kind, step, scope, priority, facts from public.alert_outbox where order_id = ${orderId}::uuid order by id`,
    )).map((r) => ({ ...r }));
  const restart = (tx: DbTx, orderId: string, annexMinutes: number, clarifiedMinutes: number) =>
    tx.execute(sql`insert into public.legal_order_events (order_id, kind, ground, at, via) values
                     (${orderId}::uuid, 'annex3_sent', 'manifest_error', now() - make_interval(mins => ${annexMinutes}), 'cli'),
                     (${orderId}::uuid, 'clarification_received', null, now() - make_interval(mins => ${clarifiedMinutes}), 'cli')`);

  test("order_due for an order: at remind_minutes and at the deadline while an item is open, the clock runs and the order is not closed; never for one given effect in full, stopped or closed", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const remind = await orderIn(tx, ORDER_RULES.remindMinutes + 1);
      const late = await orderIn(tx, ORDER_RULES.hourMinutes + 1);
      const partial = await orderIn(tx, ORDER_RULES.remindMinutes + 1, { disabled: true });
      const full = await orderIn(tx, ORDER_RULES.hourMinutes + 1, { disabled: true, open: false });
      const stopped = await orderIn(tx, ORDER_RULES.hourMinutes + 1);
      await tx.execute(sql`insert into public.legal_order_events (order_id, kind, ground, at, via) values (${stopped}::uuid, 'annex3_sent', 'force_majeure', now() - make_interval(mins => 30), 'cli')`);
      const closed = await orderIn(tx, ORDER_RULES.hourMinutes + 1);
      await tx.execute(sql`update public.legal_orders set closed_at = now() where id = ${closed}::uuid`);
      await steps(tx);
      await steps(tx);
      const due = (rows: Awaited<ReturnType<typeof orderRows>>) => rows.filter((r) => r.kind === "order_due").map((r) => [r.step, r.facts.itemsOpen, r.scope, r.priority]);
      expect(due(await orderRows(tx, remind))).toEqual([[0, 1, "all", 5]]);
      expect(due(await orderRows(tx, late))).toEqual([[0, 1, "all", 5]]);
      expect((await orderRows(tx, late))[0]!.facts.minutesLeft).toBe(0);
      expect(due(await orderRows(tx, partial))).toEqual([[0, 1, "all", 5]]);
      for (const none of [full, stopped, closed]) expect(due(await orderRows(tx, none))).toEqual([]);
      // The deadline passes for the order reminded at remind_minutes: the second reminder, once.
      // The order and its first reminder an hour further back, as the hour would have passed.
      await tx.execute(sql`update public.legal_orders set received_at = received_at - make_interval(mins => ${ORDER_RULES.hourMinutes}), opened_at = opened_at - make_interval(mins => ${ORDER_RULES.hourMinutes}) where id = ${remind}::uuid`);
      await tx.execute(sql`update public.alert_outbox set created_at = created_at - make_interval(mins => ${ORDER_RULES.hourMinutes}) where order_id = ${remind}::uuid`);
      await steps(tx);
      await steps(tx);
      expect(due(await orderRows(tx, remind))).toEqual([
        [0, 1, "all", 5],
        [1, 1, "all", 5],
      ]);
    });
  });

  test("a restart of an order's clock rings the phone on call again, as a message's first push, once a restart; a second restart alerts again", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const order = await orderIn(tx, 50);
      await restart(tx, order, 40, 10);
      await steps(tx);
      await steps(tx);
      const first = (await orderRows(tx, order)).filter((r) => r.kind === "contact_mail");
      expect(first.map((r) => [r.step, r.scope, r.priority, Object.keys(r.facts)])).toEqual([[0, "on_call", 5, ["dueAt"]]]);
      // The first restart's row was written when it came, nine minutes before the second.
      await tx.execute(sql`update public.alert_outbox set created_at = now() - make_interval(mins => 9) where order_id = ${order}::uuid`);
      await restart(tx, order, 5, 1);
      await steps(tx);
      expect((await orderRows(tx, order)).filter((r) => r.kind === "contact_mail").map((r) => r.step)).toEqual([0, 1]);
      // A stopped clock does not ring.
      const stopped = await orderIn(tx, 50);
      await restart(tx, stopped, 40, 10);
      await tx.execute(sql`insert into public.legal_order_events (order_id, kind, ground, at, via) values (${stopped}::uuid, 'annex3_sent', 'force_majeure', now(), 'cli')`);
      await steps(tx);
      expect((await orderRows(tx, stopped)).filter((r) => r.kind === "contact_mail")).toEqual([]);
    });
  });

  test("order_unverified, daily: one count for orders given effect and not verified (or with an item added after the check), one for missing reasons, one for holds without an end", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const since = new Date();
      await tx.execute(sql`delete from public.alert_outbox where kind = 'order_unverified'`);
      await orderIn(tx, 120, { disabled: true });
      await orderIn(tx, 120, { disabled: true, verified: true, reasons: true });
      await orderIn(tx, 120, { disabled: false });
      await steps(tx);
      await steps(tx);
      const rows = await outboxSince(tx, "order_unverified", since);
      // The verified order's disabled item was added two hours before its check: it counts as verified.
      expect(rows.map((r) => [r.step, r.scope, r.priority, r.facts.count, r.facts.textsMissing, r.facts.holdsOpen, typeof r.facts.oldestAt])).toEqual([[0, "all", 5, 1, 1, 0, "string"]]);
    });
  });

  test("3f Task 5: report_owed, daily, while a notification record is owed and was opened more than reportAlertHours ago, with how many and the oldest; none once it is sent", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const since = new Date();
      // Inside a transaction that ends in a rollback: no other file's owed record may count here.
      await tx.execute(sql`delete from public.alert_outbox where kind = 'report_owed'`);
      await tx.execute(sql`delete from public.authority_notifications`);
      const record = async (hoursAgo: number) => {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into public.authority_notifications (state, duties, case_id, account_id, opened_at, opened_via, imported_at)
          values ('owed', '{voluntary}', gen_random_uuid(), gen_random_uuid(), now() - make_interval(hours => ${hoursAgo}), 'cli', now()) returning id`);
        return row!.id;
      };
      await record(ORDER_RULES.reportAlertHours - 1);
      await steps(tx);
      expect(await outboxSince(tx, "report_owed", since)).toEqual([]);
      const late = await record(ORDER_RULES.reportAlertHours + 2);
      await record(ORDER_RULES.reportAlertHours + 1);
      await steps(tx);
      await steps(tx);
      const rows = await outboxSince(tx, "report_owed", since);
      expect(rows.map((r) => [r.step, r.scope, r.priority, r.facts.count, typeof r.facts.oldestAt])).toEqual([[0, "all", 5, 2, "string"]]);
      // Sent, and the day over: nothing more.
      await tx.execute(sql`update public.authority_notifications set state = 'declined', declined_reason = 'not identifiable', closed_at = now() where id <> ${late}::uuid`);
      await tx.execute(sql`update public.authority_notifications set state = 'declined', declined_reason = 'a check that ended in no', closed_at = now() where id = ${late}::uuid`);
      await tx.execute(sql`update public.alert_outbox set created_at = created_at - interval '1 day 1 minute' where kind = 'report_owed'`);
      await steps(tx);
      expect((await outboxSince(tx, "report_owed", new Date(since.getTime() - 2 * 24 * 60 * MIN))).map((r) => r.step)).toEqual([0]);
      expect(ALERT_KINDS.report_owed.legs).toEqual(["push", "mail"]);
    });
  });

  test("3f Task 5: handover_undestroyed, daily, while a production with files was delivered more than handoverAlertDays ago and is not destroyed", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const since = new Date();
      await tx.execute(sql`delete from public.alert_outbox where kind = 'handover_undestroyed'`);
      await tx.execute(sql`delete from public.productions`);
      const production = async (daysAgo: number, destroyed = false) =>
        tx.execute(sql`
          insert into public.productions (instrument, produced, files, archive_sha256, delivered_at, destroyed_at, destroyed_how, opened_at)
          values ('demand', '{files}', '[{"name": "files/ab/x/small.webp", "bytes": 1, "sha256": null}]'::jsonb, ${"a".repeat(64)},
                  now() - make_interval(days => ${daysAgo}), ${destroyed ? sql`now()` : sql`null`}, ${destroyed ? "deleted" : null}, now())`);
      await production(ORDER_RULES.handoverAlertDays - 1);
      await production(ORDER_RULES.handoverAlertDays + 3, true);
      await steps(tx);
      expect(await outboxSince(tx, "handover_undestroyed", since)).toEqual([]);
      await production(ORDER_RULES.handoverAlertDays + 1);
      await steps(tx);
      await steps(tx);
      const rows = await outboxSince(tx, "handover_undestroyed", since);
      expect(rows.map((r) => [r.step, r.scope, r.priority, r.facts.count, Object.keys(r.facts)])).toEqual([[0, "all", 3, 1, ["count"]]]);
    });
  });

  test("3f Task 6: copy_overdue, daily, from alert_steps() alone, while the newest copy mark is older than copyOverdueHours, or there is none and the audit log's first row is that old; a fresh mark ends it", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const since = new Date();
      await tx.execute(sql`delete from public.alert_outbox where kind = 'copy_overdue'`);
      await tx.execute(sql`delete from public.copy_marks`);
      const hours = ORDER_RULES.copyOverdueHours;
      // Every row of the record younger than the period, and no mark: nothing is overdue yet.
      await tx.execute(sql`update public.audit_log set created_at = now() - make_interval(hours => ${hours - 1}::int) where chain_seq = (select min(chain_seq) from public.audit_log)`);
      await steps(tx);
      expect(await outboxSince(tx, "copy_overdue", since)).toEqual([]);
      // The first row is older than the period, and nobody ever took a copy.
      await tx.execute(sql`update public.audit_log set created_at = now() - make_interval(hours => ${hours + 5}::int) where chain_seq = (select min(chain_seq) from public.audit_log)`);
      await steps(tx);
      await steps(tx);
      const rows = await outboxSince(tx, "copy_overdue", since);
      expect(rows.map((r) => [r.step, r.scope, r.priority, r.facts.hours, Object.keys(r.facts)])).toEqual([[0, "all", 3, hours + 5, ["hours"]]]);
      // A fresh mark: the next day writes nothing; a mark older than the period writes the next step.
      await tx.execute(sql`update public.alert_outbox set created_at = created_at - interval '1 day 1 minute' where kind = 'copy_overdue'`);
      await tx.execute(sql`insert into public.copy_marks (staff_id, place) values (gen_random_uuid(), 1)`);
      await steps(tx);
      expect((await outboxSince(tx, "copy_overdue", new Date(since.getTime() - 2 * 24 * 60 * MIN))).map((r) => r.step)).toEqual([0]);
      await tx.execute(sql`update public.copy_marks set at = now() - make_interval(hours => ${hours + 1}::int)`);
      await steps(tx);
      const next = await outboxSince(tx, "copy_overdue", new Date(since.getTime() - 2 * 24 * 60 * MIN));
      expect(next.map((r) => [r.step, r.facts.hours])).toEqual([
        [0, hours + 5],
        [1, hours + 1],
      ]);
      expect(ALERT_KINDS.copy_overdue.legs).toEqual(["push", "mail"]);
    });
  });

  test("3f's review: a row of report_owed and one of handover_undestroyed pass through the mail leg to every staff account, each once, with their sentence", async () => {
    const sent = { report_owed: mailsOf("report_owed").length, handover_undestroyed: mailsOf("handover_undestroyed").length };
    const rows = await w.migrateDb.execute<{ id: string }>(sql`
      insert into public.alert_outbox (kind, priority, scope, facts)
      values ('report_owed', 5, 'all', '{"count": 1, "oldestAt": "2026-10-16T08:00:00.000Z"}'::jsonb), ('handover_undestroyed', 3, 'all', '{"count": 2}'::jsonb)
      returning id`);
    try {
      expect(await alertMailLeg(tickDeps("off"))).toBeGreaterThanOrEqual(2);
      expect(mailsOf("report_owed").slice(sent.report_owed).map((m) => m.data)).toEqual([expect.objectContaining({ count: "1", oldestAt: "2026-10-16T08:00:00.000Z" })]);
      expect(mailsOf("handover_undestroyed").slice(sent.handover_undestroyed).map((m) => m.data)).toEqual([expect.objectContaining({ count: "2" })]);
      const marked = await w.migrateDb.execute<{ mailed: boolean }>(sql`select mailed_at is not null as mailed from public.alert_outbox where id = any(${`{${rows.map((r) => r.id).join(",")}}`}::bigint[]) order by id`);
      expect(marked.map((r) => r.mailed)).toEqual([true, true]);
    } finally {
      await w.migrateDb.execute(sql`delete from public.alert_outbox where id = any(${`{${rows.map((r) => r.id).join(",")}}`}::bigint[])`);
    }
  });

  test("leaves no row behind", async () => {
    await removeMessages(w.migrateDb, made.splice(0));
    // The tick's own daily test, which no message names, and the rows of this file's kinds of 3f.
    await w.migrateDb.execute(sql`delete from public.alert_outbox where created_at >= ${started.toISOString()}::timestamptz and kind in ('alert_test', 'alert_channel_down', 'mailbox_unreachable')`);
    expect(await rowCounts(w.apiDb, CHANNEL_TABLES)).toEqual(before);
  });
});
