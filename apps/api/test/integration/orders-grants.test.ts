import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_CHANNELS, ORDER_CLOSE_GROUNDS, ORDER_CORRECTION_RULES, ORDER_EVENT_GROUNDS, ORDER_EVENT_KINDS, ORDER_EVENT_VIA, ORDER_ITEM_CLOSE_REASONS, ORDER_KINDS, ORDER_TEXT_KINDS, HOLD_END_REASONS } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { appendConfirmedAudit } from "../../src/moderation/repo";
import { appendAuditRow } from "../../src/staff";
import { CHANNEL_TABLES, hex64, newTestStaff, raised, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures, contactMessageForTest, removeMessages } from "./notify-fixtures";
import { ORDER_TABLES, removeOrderAlerts, disableItemForTest, orderForTest, removeOrders } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 90_000 });

/**
 * The grants and the binding of a console's event to its audit row (3f design, sections 6.2 and 6.7; invariants 12 and
 * 24, events and a correction before effect). As korbat_api: SELECT and the console's columns on an order, never an
 * update; an item's link, and its intake item alone afterwards; an event's insert, of which the trigger takes `opened`
 * alone; no update of a decision's informed_at. Each call that a key must cover (order_event_record for a closing, an
 * Annex III, a reopening and an extension; order_correct under each of its three rules), committed without the matching
 * audit row as the transaction's head, with another order's row, without a step-up where one is needed, or under another
 * account, is refused at commit (order_event_refused), leaving nothing; with its row it stands, and by_staff is the row's
 * actor. Each closed list's CHECK is its contracts' constant.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the grants of order records and the binding of their console events", () => {
  let w: NoticesWorld;
  let moderator: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  const orders: string[] = [];
  const messages: string[] = [];
  const started = new Date();

  beforeAll(async () => {
    w = noticesWorld();
    moderator = await newTestStaff(w.authDb, w.migrateDb, w.repo, "moderator");
    admin = await newTestStaff(w.authDb, w.migrateDb, w.repo, "admin");
    await staffProfile(w.apiDb, moderator);
    await staffProfile(w.apiDb, admin);
    // Counted once the staff profiles stand: they leave in afterAll, after the last count.
    before = await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES]);
  }, 60_000);
  afterAll(async () => {
    await removeOrders(w.migrateDb, orders);
    await removeMessages(w.migrateDb, messages);
    await removeFixtures(w.migrateDb, [moderator.id, admin.id]);
    await closeNotifyFixtures();
    await w.close();
  });

  const privileges = async (table: string) =>
    (await w.migrateDb.execute<{ p: string }>(sql`
      select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
       where has_table_privilege('korbat_api', ${`public.${table}`}, p) order by p`)).map((r) => r.p);
  const columns = async (table: string, privilege: string) =>
    (await w.migrateDb.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = ${table} and has_column_privilege('korbat_api', ${`public.${table}`}, column_name, ${privilege})
       order by ordinal_position`)).map((r) => r.column_name);
  const checkValues = async (table: string, name: string) =>
    [...((await w.migrateDb.execute<{ d: string }>(sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = ${name} and conrelid = ${`public.${table}`}::regclass`))[0]!.d.matchAll(/'([a-z_0-9]+)'/g))].map((m) => m[1]!);

  test("korbat_api: an order is read and inserted with the console's columns, never updated; an item's link, then its intake item alone; an event inserted; a decision's informed_at never", async () => {
    // A table's privilege counts only a grant on the whole table: the order's and the item's inserts are by column.
    expect(await privileges("legal_orders")).toEqual(["SELECT"]);
    expect(await columns("legal_orders", "INSERT")).toEqual(["id", "kind", "member_state", "authority", "reference", "channel", "message_id", "section_c", "emergency", "cross_border", "withhold_from_author", "opened_by"]);
    expect(await columns("legal_orders", "UPDATE")).toEqual([]);
    expect(await privileges("legal_order_items")).toEqual(["SELECT"]);
    expect(await columns("legal_order_items", "INSERT")).toEqual(["id", "order_id", "position", "link", "post_id"]);
    expect(await columns("legal_order_items", "UPDATE")).toEqual(["intake_item_id"]);
    expect(await privileges("legal_order_events")).toEqual(["INSERT", "SELECT"]);
    expect(await columns("legal_order_events", "UPDATE")).toEqual([]);
    expect(await privileges("legal_order_clock")).toEqual(["SELECT"]);
    expect(await columns("decisions", "UPDATE")).toEqual(["author_mail", "author_mail_at"]);
    expect(await columns("decision_actions", "UPDATE")).toEqual([]);
  });

  test("korbat_api: an event other than opened is refused by the trigger, a command line's as order_event_cli_only; an update of an order or of informed_at is refused by the grants", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const order = await orderForTest(tx, moderator, { links: ["https://elsewhere.example/g1"] });
      const tried = (statement: ReturnType<typeof sql>) =>
        tx.transaction((sp) => sp.execute(statement)).then(
          () => null,
          (err: unknown) => {
            const found = raised(err);
            return found?.code === "P0001" ? found.message : found?.code;
          },
        );
      for (const kind of ["verified", "received_set", "texts_recorded", "reopened", "hold_extended", "imported"]) {
        expect(await tried(sql`insert into public.legal_order_events (order_id, kind, via) values (${order.id}::uuid, ${kind}, 'cli')`), kind).toBe("order_event_cli_only");
      }
      for (const kind of ["annex3_sent", "closed_without_effect", "corrected", "effect_given", "notice_released"]) {
        expect(await tried(sql`insert into public.legal_order_events (order_id, kind, ground, via) values (${order.id}::uuid, ${kind}, null, 'console')`), kind).toBe("order_event_refused");
      }
      expect(await tried(sql`update public.legal_orders set section_c = true where id = ${order.id}::uuid`)).toBe("42501");
      expect(await tried(sql`update public.legal_orders set verified_at = now() where id = ${order.id}::uuid`)).toBe("42501");
      expect(await tried(sql`update public.legal_order_items set disabled_at = now() where order_id = ${order.id}::uuid`)).toBe("42501");
      expect(await tried(sql`update public.decisions set informed_at = null where false`)).toBe("42501");
      expect(await tried(sql`insert into public.legal_orders (id, kind, member_state, authority, reference, channel, section_c, emergency, cross_border, withhold_from_author, opened_by, verified_at)
                             values (gen_random_uuid(), 'tco_removal', 'DE', 'B', ${`V-${randomUUID()}`}, 'portal', false, false, false, true, ${moderator.id}::uuid, now())`)).toBe("42501");
    });
  });

  /** Runs `write` in a savepoint, then the deferred check of a console's event at once: null when it stood, else the refusal. */
  async function atCommit(tx: DbTx, write: (sp: DbTx) => Promise<void>): Promise<string | null> {
    const outcome = await tx
      .transaction(async (sp) => {
        await write(sp);
        await sp.execute(sql`set constraints public.legal_order_events_confirmed immediate`);
      })
      .then(
        () => null,
        (err: unknown) => raised(err)?.message ?? String(err),
      );
    await tx.execute(sql`set constraints public.legal_order_events_confirmed deferred`);
    return outcome;
  }
  const record = async (sp: DbTx, orderId: string, kind: string, ground: string | null, messageId: string | null, by: TestStaff) =>
    (await sp.execute<{ id: string }>(sql`select public.order_event_record(${orderId}::uuid, ${kind}, ${ground}, ${messageId}::uuid, ${by.id}::uuid) as id`))[0]!.id;
  const correct = async (sp: DbTx, orderId: string, facts: Record<string, unknown>, by: TestStaff) =>
    (await sp.execute<{ id: string }>(sql`select public.order_correct(${orderId}::uuid, ${JSON.stringify(facts)}::jsonb, ${by.id}::uuid) as id`))[0]!.id;
  const confirmedRow = (sp: DbTx, by: TestStaff, action: "order_event_recorded" | "order_corrected", orderId: string, eventId: string) =>
    appendConfirmedAudit(sp, {
      actorId: by.id,
      keyId: by.keyId,
      action,
      targetType: "order",
      targetId: orderId,
      metadata: { params: {}, eventId },
      staffSession: randomUUID(),
      actionHash: hex64(),
      stepUp: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
      requestId: "req-grants",
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  const plainRow = (sp: DbTx, by: TestStaff, action: string, orderId: string, eventId: string) =>
    appendAuditRow(sp, { actorId: by.id, action, targetType: "order", targetId: orderId, requestId: "req-grants", metadata: { eventId } });

  test("each clock event, closing, reopening and extension stands only with its confirmed audit row, on this order, naming this event, by its account", async () => {
    const m = await contactMessageForTest(new Date(Date.now() - 60_000), "inbox");
    messages.push(m);
    await rolledBack(w.apiDb, async (tx) => {
      const order = (await orderForTest(tx, moderator, { sectionC: true, links: ["https://elsewhere.example/b1"] })).id;
      const other = (await orderForTest(tx, moderator, { links: ["https://elsewhere.example/b2"] })).id;
      // Without a row; with another order's; with a plain row; under another account: each refused at commit.
      expect(await atCommit(tx, (sp) => record(sp, order, "annex3_sent", "manifest_error", null, moderator).then(() => undefined))).toBe("order_event_refused");
      expect(await atCommit(tx, async (sp) => void (await confirmedRow(sp, moderator, "order_event_recorded", other, await record(sp, order, "annex3_sent", "manifest_error", null, moderator))))).toBe(
        "order_event_refused",
      );
      expect(await atCommit(tx, async (sp) => void (await plainRow(sp, moderator, "order_event_recorded", order, await record(sp, order, "annex3_sent", "manifest_error", null, moderator))))).toBe(
        "order_event_refused",
      );
      expect(await atCommit(tx, async (sp) => void (await confirmedRow(sp, admin, "order_event_recorded", order, await record(sp, order, "annex3_sent", "manifest_error", null, moderator))))).toBe(
        "order_event_refused",
      );
      expect(await atCommit(tx, async (sp) => void (await confirmedRow(sp, moderator, "order_corrected", order, await record(sp, order, "annex3_sent", "manifest_error", null, moderator))))).toBe(
        "order_event_refused",
      );
      // With it: stored, by the row's actor.
      expect(await atCommit(tx, async (sp) => void (await confirmedRow(sp, moderator, "order_event_recorded", order, await record(sp, order, "annex3_sent", "manifest_error", null, moderator))))).toBeNull();
      // The admin's three: an extension, a closing and a reopening, each refused without its row and standing with it.
      expect(await atCommit(tx, (sp) => record(sp, order, "hold_extended", null, m, admin).then(() => undefined))).toBe("order_event_refused");
      expect(await atCommit(tx, async (sp) => void (await confirmedRow(sp, admin, "order_event_recorded", order, await record(sp, order, "hold_extended", null, m, admin))))).toBeNull();
      expect(await atCommit(tx, (sp) => record(sp, other, "closed_without_effect", "withdrawn", null, admin).then(() => undefined))).toBe("order_event_refused");
      expect(await atCommit(tx, async (sp) => void (await confirmedRow(sp, admin, "order_event_recorded", other, await record(sp, other, "closed_without_effect", "withdrawn", null, admin))))).toBeNull();
      expect(await atCommit(tx, (sp) => record(sp, other, "reopened", null, null, admin).then(() => undefined))).toBe("order_event_refused");
      expect(await atCommit(tx, async (sp) => void (await confirmedRow(sp, admin, "order_event_recorded", other, await record(sp, other, "reopened", null, null, admin))))).toBeNull();
      const events = await tx.execute<{ kind: string; by: string }>(
        sql`select kind, by_staff as by from public.legal_order_events where order_id in (${order}::uuid, ${other}::uuid) and kind <> 'opened' order by at, id`,
      );
      expect(events.map((e) => [e.kind, e.by])).toEqual([
        ["annex3_sent", moderator.id],
        ["hold_extended", admin.id],
        ["closed_without_effect", admin.id],
        ["reopened", admin.id],
      ]);
    });
  });

  test("a correction stands only with its audit row order_corrected: a plain one under entry and caution, a confirmed one under admin", async () => {
    const effected = await orderForTest(w.apiDb, moderator, { links: ["https://elsewhere.example/c1"] });
    orders.push(effected.id);
    await disableItemForTest(w.migrateDb, effected.items[0]!.id);
    await rolledBack(w.apiDb, async (tx) => {
      const order = (await orderForTest(tx, moderator, { links: ["https://elsewhere.example/c2"] })).id;
      // entry: without a row refused, with a plain row by the acting account standing.
      expect(await atCommit(tx, (sp) => correct(sp, order, { emergency: true }, moderator).then(() => undefined))).toBe("order_event_refused");
      expect(await atCommit(tx, async (sp) => void (await plainRow(sp, admin, "order_corrected", order, await correct(sp, order, { emergency: true }, moderator))))).toBe("order_event_refused");
      expect(await atCommit(tx, async (sp) => void (await plainRow(sp, moderator, "order_corrected", order, await correct(sp, order, { emergency: true }, moderator))))).toBeNull();
      // caution: the same, on an order given effect.
      expect(await atCommit(tx, (sp) => correct(sp, effected.id, { sectionC: true }, moderator).then(() => undefined))).toBe("order_event_refused");
      expect(await atCommit(tx, async (sp) => void (await plainRow(sp, moderator, "order_corrected", effected.id, await correct(sp, effected.id, { sectionC: true }, moderator))))).toBeNull();
      // admin: a plain row in place of a confirmed one is refused; the confirmed one stands.
      expect(await atCommit(tx, (sp) => correct(sp, effected.id, { emergency: true }, admin).then(() => undefined))).toBe("order_event_refused");
      expect(await atCommit(tx, async (sp) => void (await plainRow(sp, admin, "order_corrected", effected.id, await correct(sp, effected.id, { emergency: true }, admin))))).toBe("order_event_refused");
      expect(await atCommit(tx, async (sp) => void (await confirmedRow(sp, admin, "order_corrected", effected.id, await correct(sp, effected.id, { emergency: true }, admin))))).toBeNull();
      const grounds = await tx.execute<{ ground: string }>(sql`select ground from public.legal_order_events where order_id = ${effected.id}::uuid and kind = 'corrected' order by at, id`);
      expect(grounds.map((g) => g.ground)).toEqual(["caution", "admin"]);
    });
  });

  test("each closed list's CHECK is its contracts' constant, in one spelling", async () => {
    expect(await checkValues("legal_orders", "legal_orders_kind")).toEqual([...ORDER_KINDS]);
    expect(await checkValues("legal_orders", "legal_orders_channel")).toEqual([...ORDER_CHANNELS]);
    expect(await checkValues("legal_orders", "legal_orders_hold_end")).toEqual([...HOLD_END_REASONS]);
    expect(await checkValues("legal_order_items", "legal_order_items_closed")).toEqual([...ORDER_ITEM_CLOSE_REASONS]);
    expect((await checkValues("legal_order_events", "legal_order_events_kind")).sort()).toEqual([...ORDER_EVENT_KINDS].sort());
    expect(await checkValues("legal_order_events", "legal_order_events_via")).toEqual([...ORDER_EVENT_VIA]);
    const ground = (await w.migrateDb.execute<{ d: string }>(sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'legal_order_events_ground'`))[0]!.d;
    for (const [kind, grounds] of Object.entries(ORDER_EVENT_GROUNDS)) {
      for (const value of grounds) expect(ground, `${kind} ${value}`).toContain(`'${value}'`);
    }
    expect(await checkValues("decision_actions", "decision_actions_order_ground")).toEqual([...ORDER_CLOSE_GROUNDS].filter((g) => g !== "not_addressed"));
    expect(ORDER_CORRECTION_RULES.every((rule) => ground.includes(`'${rule}'`))).toBe(true);
    // 3f's review (people2): texts_recorded takes the name of the text it wrote, or none.
    for (const text of ORDER_TEXT_KINDS) expect(ground, text).toContain(`'${text}'`);
  });

  test("leaves no row behind", async () => {
    await removeOrders(w.migrateDb, orders.splice(0));
    await removeMessages(w.migrateDb, messages.splice(0));
    await removeOrderAlerts(w.migrateDb, started);
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
  });
});
