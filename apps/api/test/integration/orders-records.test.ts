import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_ITEMS_MAX, ORDER_RULES, OrderView } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { createBackground, ModerationError } from "../../src/moderation/context";
import { addItems, contactOverview, contactPage } from "../../src/moderation/orders";
import { CHANNEL_TABLES, moderationDeps, newImageRow, newPostRow, newTestStaff, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures, contactMessageForTest, outboxSince, removeMessages } from "./notify-fixtures";
import { ORDER_TABLES, orderConfig, orderForTest, removeOrderAlerts, removeOrders, sessionOf } from "./orders-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 90_000 });

const MIN = 60_000;

/**
 * Opening an order record (3f design, sections 2 rows 7, 8 and 43, 6.2 and 7.4; invariants 10, 12 and 26). The route's
 * own code opens an order with or without a message: the trigger forces when and how it was opened, its time of receipt
 * from the message, the withholding of a removal order and of an order whose author must not be told, and the
 * preservation; it nulls every column of the command line. Each link becomes an item, resolved and never fetched: a post's
 * page, an image's address (its post), a profile's page and another site (no post). The message's disposition becomes
 * order. The audit row order_opened names an item by its post or by its link's digest and length, never the link. The
 * day's limit is counted by the API and by the trigger. An order of the same state, authority and reference is
 * order_exists, with the order that stands. More links come up to ORDER_ITEMS_MAX, and an item added after the
 * verification is unverified. The contact point's page names the orders opened from a message, and the home screen's
 * deadline is an order's too. Every staff account is alerted that an order was opened.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: opening an order record", () => {
  let w: NoticesWorld;
  let staff: TestStaff;
  let author: { id: string };
  let before: Record<string, number>;
  const orders: string[] = [];
  const messages: string[] = [];
  const started = new Date();

  beforeAll(async () => {
    w = noticesWorld();
    staff = await newTestStaff(w.authDb, w.migrateDb, w.repo, "moderator");
    await staffProfile(w.apiDb, staff);
    author = await newProfile(w.apiDb);
    // Counted once the staff and the profiles stand: they leave in afterAll, after the last count.
    before = await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES]);
  }, 60_000);
  afterAll(async () => {
    await removeOrders(w.migrateDb, orders);
    await removeMessages(w.migrateDb, messages);
    await removeFixtures(w.migrateDb, [staff.id, author.id]);
    await closeNotifyFixtures();
    await w.close();
  });

  // Read on first use: a suite without a database is collected and skipped, and its environment is not loaded then.
  let loaded: ReturnType<typeof orderConfig> | undefined;
  const configOf = () => (loaded ??= orderConfig());
  const message = async (minutesAgo = 1) => {
    const id = await contactMessageForTest(new Date(Date.now() - minutesAgo * MIN), "inbox");
    messages.push(id);
    return id;
  };
  const rowOf = async (tx: DbTx, id: string) =>
    (await tx.execute<Record<string, unknown>>(sql`select * from public.legal_orders where id = ${id}::uuid`))[0]!;

  test("from a message: the receipt is the message's, the channel mailbox, the withholding and the preservation forced; the command line's columns null; the message handled as an order", async () => {
    const m = await message(3);
    await rolledBack(w.apiDb, async (tx) => {
      const post = await newPostRow(tx, author.id);
      const view = await orderForTest(tx, staff, { messageId: m, posts: [post], sectionC: false, withholdFromAuthor: true });
      expect(OrderView.parse(view)).toEqual(view);
      const row = await rowOf(tx, view.id);
      const [msg] = await tx.execute<{ received_at: Date; disposition: string; handled_by: string; stamped: boolean }>(
        sql`select received_at, disposition, handled_by, handled_at is not null as stamped from public.contact_messages where id = ${m}::uuid`,
      );
      // A row read with select * may hold its times as text: each is compared as an instant.
      expect(new Date(row.received_at as string | Date).getTime()).toBe(new Date(msg!.received_at).getTime());
      expect([row.channel, row.opened_via, row.withhold_from_author, row.preserve, row.opened_by]).toEqual(["mailbox", "console", true, true, staff.id]);
      for (const column of ["sent_at", "issued_at", "due_at", "authority_hold_until", "hold_basis", "verified_at", "reasons", "redress", "scope", "document_sha256", "closed_at", "imported_at"]) {
        expect(row[column], column).toBeNull();
      }
      expect([msg!.disposition, msg!.handled_by, msg!.stamped]).toEqual(["order", staff.id, true]);
      expect(view.items.map((i) => [i.position, i.linkKind, i.postId, i.unverified])).toEqual([[1, "post", post, true]]);
      expect(view.events.map((e) => [e.kind, e.via])).toEqual([["opened", "console"]]);
      expect(view.state).toBe("running");
      expect(view.clock!.deadlineAt).toBe(new Date(Date.parse(view.receivedAt!) + ORDER_RULES.hourMinutes * MIN).toISOString());
    });
  });

  test("without a message: no receipt and no deadline (unknown_deadline), the channel as picked; a DSA order without Section C may show its post, and with Section C it is withheld by force", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const unknown = await orderForTest(tx, staff, { messageId: null, channel: "post", links: ["https://elsewhere.example/a"] });
      expect([unknown.receivedAt, unknown.channel, unknown.state, unknown.clock!.deadlineAt, unknown.owed.received]).toEqual([null, "post", "unknown_deadline", null, true]);
      const shown = await orderForTest(tx, staff, { kind: "dsa_art9", links: ["https://elsewhere.example/b"], withholdFromAuthor: false });
      expect([shown.withholdFromAuthor, shown.preserve, shown.clock, shown.state, shown.hold]).toEqual([false, false, null, "no_clock", null]);
      // Below the schema, an insert that holds a notice and does not withhold is withheld by the trigger.
      const id = randomUUID();
      await tx.execute(sql`insert into public.legal_orders (id, kind, member_state, authority, reference, channel, section_c, emergency, cross_border, withhold_from_author, opened_by)
                           values (${id}::uuid, 'dsa_art9', 'FR', 'X', ${`R-${id}`}, 'other', true, false, true, false, ${staff.id}::uuid)`);
      expect((await rowOf(tx, id)).withhold_from_author).toBe(true);
      // An insert that leaves Section C out is refused: no default decides it for a person.
      const missing = await tx
        .transaction((sp) => sp.execute(sql`insert into public.legal_orders (id, kind, member_state, authority, reference, channel, emergency, cross_border, withhold_from_author, opened_by)
                                            values (gen_random_uuid(), 'dsa_art9', 'FR', 'X', ${`R-${randomUUID()}`}, 'other', false, true, true, ${staff.id}::uuid)`))
        .then(() => null, (err: unknown) => String((err as { cause?: { code?: string } }).cause?.code));
      expect(missing).toBe("23502");
    });
  });

  test("each link is an item, resolved and never fetched: a post, an image (its post, the link kept as named), an account, another site; two links that name one post are refused", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const post = await newPostRow(tx, author.id);
      const pictured = await newPostRow(tx, author.id);
      const image = await newImageRow(tx, author.id, pictured);
      const imageLink = `${configOf().APP_ORIGIN}/api/media/${image}/large.webp`;
      const view = await orderForTest(tx, staff, {
        posts: [post],
        links: [imageLink, `${configOf().APP_ORIGIN}/u/someone`, "https://elsewhere.example/x", `${configOf().APP_ORIGIN}/post/${randomUUID()}`],
      });
      expect(view.items.map((i) => [i.linkKind, i.postId])).toEqual([
        ["post", post],
        ["image", pictured],
        ["account", null],
        ["other", null],
        ["other", null],
      ]);
      expect(view.items[1]!.link).toBe(imageLink);
      expect(view.items[0]!.post).toMatchObject({ state: "visible", images: 0 });
      expect(view.items[1]!.post).toMatchObject({ images: 1 });
      expect(view.clock!.itemsOpen).toBe(5);
      const twice = await orderForTest(tx, staff, { posts: [pictured], links: [imageLink] }).then(
        () => null,
        (err: unknown) => (err instanceof ModerationError ? [err.code, err.status] : String(err)),
      );
      expect(twice).toEqual(["invalid_request", 422]);
    });
  });

  test("the audit row order_opened holds the order's facts and names each item by its post, or by its link's digest and length, never the link", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const post = await newPostRow(tx, author.id);
      const link = `${configOf().APP_ORIGIN}/u/somebody_named`;
      const view = await orderForTest(tx, staff, { posts: [post], links: [link], reference: "AUDIT-1" });
      const [row] = await tx.execute<{ action: string; actor_id: string; target_type: string; target_id: string; metadata: Record<string, unknown> }>(
        sql`select action, actor_id, target_type, target_id, metadata from public.audit_log where target_id = ${view.id} order by chain_seq desc limit 1`,
      );
      expect([row!.action, row!.actor_id, row!.target_type]).toEqual(["order_opened", staff.id, "order"]);
      expect(row!.metadata).toMatchObject({ kind: "tco_removal", memberState: "DE", reference: "AUDIT-1", via: "console", crossBorder: false, withholdFromAuthor: true, receivedAt: null });
      const items = row!.metadata.items as Record<string, unknown>[];
      expect(items[0]).toMatchObject({ position: 1, postId: post });
      expect(items[1]).toMatchObject({ position: 2, linkSha256: createHash("sha256").update(link).digest("hex"), linkLength: link.length });
      expect(JSON.stringify(row!.metadata)).not.toContain("somebody_named");
      // An order from another Member State is cross-border.
      const foreign = await orderForTest(tx, staff, { memberState: "FR", links: ["https://elsewhere.example/f"] });
      expect(foreign.crossBorder).toBe(true);
    });
  });

  test("every staff account is alerted that an order was opened: one row of order_opened, with the count of items and the deadline or that it is unknown", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const since = new Date();
      await orderForTest(tx, staff, { links: ["https://elsewhere.example/1", "https://elsewhere.example/2"] });
      const rows = await outboxSince(tx, "order_opened", since);
      expect(rows.map((r) => [r.priority, r.scope, r.facts])).toEqual([[3, "all", { items: 2, unknown: 1 }]]);
    });
  });

  test("an order of the same state, authority and reference is order_exists, naming the order that stands; a closed one too", async () => {
    const first = await orderForTest(w.apiDb, staff, { reference: `DUP-${started.getTime()}`, links: ["https://elsewhere.example/d"] });
    orders.push(first.id);
    const again = await orderForTest(w.apiDb, staff, { reference: `DUP-${started.getTime()}`, links: ["https://elsewhere.example/e"] }).then(
      () => null,
      (err: unknown) => (err instanceof ModerationError ? { code: err.code, status: err.status, details: err.details } : String(err)),
    );
    expect(again).toEqual({ code: "order_exists", status: 409, details: { orderId: first.id } });
  });

  test("the day's limit: the API refuses the order after records_per_day with rate_limited and Retry-After; the trigger counts again under the account's lock", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      // The orders this account opened in the file's earlier tests count towards the day's limit too.
      const [today] = await tx.execute<{ opened: number }>(
        sql`select count(*)::int as opened from public.legal_orders where opened_by = ${staff.id}::uuid and opened_at > now() - make_interval(hours => 24)`,
      );
      for (let i = today!.opened; i < ORDER_RULES.recordsPerDay; i++) await orderForTest(tx, staff, { links: [`https://elsewhere.example/limit/${i}`] });
      const refused = await orderForTest(tx, staff, { links: ["https://elsewhere.example/limit/over"] }).then(
        () => null,
        (err: unknown) => (err instanceof ModerationError ? [err.code, err.status, (err.retryAfterSeconds ?? 0) > 0] : String(err)),
      );
      expect(refused).toEqual(["rate_limited", 429, true]);
      // Below the API's count, the trigger's own.
      const below = await tx
        .transaction((sp) =>
          sp.execute(sql`insert into public.legal_orders (id, kind, member_state, authority, reference, channel, section_c, emergency, cross_border, withhold_from_author, opened_by)
                         values (gen_random_uuid(), 'tco_removal', 'DE', 'BKA', ${`L-${randomUUID()}`}, 'portal', false, false, false, true, ${staff.id}::uuid)`),
        )
        .then(() => null, (err: unknown) => String((err as { cause?: { message?: string } }).cause?.message));
      expect(below).toBe("rate_limited");
    });
  });

  test("a named message that is not there is not_found; one that went between the read and the insert is order_needs_message", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      const gone = await orderForTest(tx, staff, { messageId: randomUUID(), links: ["https://elsewhere.example/g"] }).then(
        () => null,
        (err: unknown) => (err instanceof ModerationError ? err.code : String(err)),
      );
      expect(gone).toBe("not_found");
      const below = await tx
        .transaction((sp) =>
          sp.execute(sql`insert into public.legal_orders (id, kind, member_state, authority, reference, channel, message_id, section_c, emergency, cross_border, withhold_from_author, opened_by)
                         values (gen_random_uuid(), 'tco_removal', 'DE', 'BKA', ${`M-${randomUUID()}`}, 'mailbox', ${randomUUID()}::uuid, false, false, false, true, ${staff.id}::uuid)`),
        )
        .then(() => null, (err: unknown) => String((err as { cause?: { message?: string } }).cause?.message));
      expect(below).toBe("order_needs_message");
    });
  });

  test("more links: up to ORDER_ITEMS_MAX, after the last position, with their audit row; an item added after the verification is unverified; a closed order takes none", async () => {
    const opened = await orderForTest(w.apiDb, staff, { links: ["https://elsewhere.example/m/0"] });
    orders.push(opened.id);
    // The check, as the command line records it.
    await w.migrateDb.execute(sql`update public.legal_orders set verified_at = now() where id = ${opened.id}::uuid`);
    const deps = moderationDeps(w.apiDb, { config: configOf(), background: createBackground(pino({ level: "silent" })) });
    const added = await addItems(deps, sessionOf(staff), opened.id, { links: ["https://elsewhere.example/m/1"] }, { requestId: "req-items" });
    expect(added.items.map((i) => [i.position, i.unverified])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(added.owed.verification).toBe(true);
    const [audit] = await w.apiDb.execute<{ action: string; items: number }>(
      sql`select action, jsonb_array_length(metadata -> 'items') as items from public.audit_log where target_id = ${opened.id} order by chain_seq desc limit 1`,
    );
    expect(audit).toEqual({ action: "order_items_added", items: 1 });
    // Filled to ORDER_ITEMS_MAX, at most itemsPerAction links an addition.
    for (let filled = 2, round = 0; filled < ORDER_ITEMS_MAX; round++) {
      const take = Math.min(ORDER_RULES.itemsPerAction, ORDER_ITEMS_MAX - filled);
      await addItems(deps, sessionOf(staff), opened.id, { links: Array.from({ length: take }, (_, i) => `https://elsewhere.example/n/${round}/${i}`) }, { requestId: "req-items" });
      filled += take;
    }
    const over = await addItems(deps, sessionOf(staff), opened.id, { links: ["https://elsewhere.example/over"] }, { requestId: "req-items" }).then(
      () => null,
      (err: unknown) => (err instanceof ModerationError ? [err.code, err.status] : String(err)),
    );
    expect(over).toEqual(["invalid_request", 422]);
    await w.migrateDb.execute(sql`update public.legal_orders set closed_at = now() where id = ${opened.id}::uuid`);
    const closed = await addItems(deps, sessionOf(staff), opened.id, { links: ["https://elsewhere.example/closed"] }, { requestId: "req-items" }).then(
      () => null,
      (err: unknown) => (err instanceof ModerationError ? err.code : String(err)),
    );
    expect(closed).toBe("order_closed");
  });

  test("the contact point names the orders opened from a message, and the home screen's deadline is the earliest of a message's and an order's with an open item", async () => {
    const m = await message(2);
    const early = await message(1);
    const opened = await orderForTest(w.apiDb, staff, { messageId: m, links: ["https://elsewhere.example/c"] });
    orders.push(opened.id);
    const deps = moderationDeps(w.apiDb, { config: configOf() });
    const page = await contactPage(deps, {});
    expect(page.items.find((item) => item.id === m)!.orders).toEqual([opened.id]);
    expect(page.items.find((item) => item.id === early)!.orders).toEqual([]);
    // The order's receipt is a minute before the open message's, so its deadline is the earlier one.
    const due = (await contactOverview(deps)).dueAt!;
    expect(Date.parse(due)).toBeLessThanOrEqual(Date.parse(opened.clock!.deadlineAt!));
  });

  test("leaves no row behind", async () => {
    await removeOrders(w.migrateDb, orders.splice(0));
    await removeMessages(w.migrateDb, messages.splice(0));
    await removeOrderAlerts(w.migrateDb, started);
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
  });
});
