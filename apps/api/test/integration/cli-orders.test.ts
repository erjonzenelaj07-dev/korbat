import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_RULES } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { loadConfig } from "../../src/config";
import { STAFF_USAGE, runStaffCommand } from "../../src/cli/staff";
import { CHANNEL_TABLES, newPostRow, newTestStaff, removeFixtures, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures, contactMessageForTest, removeMessages } from "./notify-fixtures";
import { ORDER_TABLES, orderForTest, removeOrderAlerts, removeOrders } from "./orders-fixtures";
import { newProfile } from "./social-fixtures";

vi.setConfig({ testTimeout: 90_000 });

const NEWLINE = String.fromCharCode(10);

/**
 * The order commands of the command line (3f design, sections 7.4, 7.7 and 8.11; W.8): each as the migrator, one
 * transaction with the 10-second lock timeout, the order's row first, its event via `cli` and its audit row
 * order_recorded last under the system actor, never a text in the audit row but its digest; a refusal is one sentence
 * ending in "nothing changed", exit 1, and writes nothing. order-open writes the console's rows through insertOrder with
 * the receipt it is given, its alert order_opened before its audit row, and refuses without HOME_STATE and APP_ORIGIN. An
 * order is named by its id or as <CC>:<reference>, order_ambiguous when several share it; an instant has its offset.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the order commands", () => {
  let w: NoticesWorld;
  let staff: TestStaff;
  let author: { id: string };
  let migrateDb: Db;
  let before: Record<string, number>;
  const orders: string[] = [];
  const messages: string[] = [];
  const started = new Date();
  // Read in beforeAll: a suite without a database is collected and skipped, and its environment is not loaded then.
  let appOrigin: string;

  beforeAll(async () => {
    appOrigin = loadConfig().APP_ORIGIN;
    w = noticesWorld();
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
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
    await closeDb(migrateDb);
    await w.close();
  });

  const env = (extra: Record<string, string> = {}) => ({ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE!, HOME_STATE: "DE", APP_ORIGIN: appOrigin, ...extra });
  /** The command's printed lines, each marked with its stream, and its exit code; standard input as given. */
  async function cli(args: string[], options: { env?: Record<string, string>; input?: string | Buffer } = {}) {
    const lines: string[] = [];
    const input = async () => (options.input === undefined ? Buffer.alloc(0) : Buffer.isBuffer(options.input) ? options.input : Buffer.from(options.input, "utf8"));
    const code = await runStaffCommand(args, options.env ?? env(), { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) }, input);
    return { code, lines, text: lines.join(NEWLINE) };
  }
  const orderRow = async (id: string) => (await migrateDb.execute<Record<string, unknown>>(sql`select * from public.legal_orders where id = ${id}::uuid`))[0]!;
  const eventsOf = async (id: string) =>
    (await migrateDb.execute<{ kind: string; ground: string | null; via: string }>(sql`select kind, ground, via from public.legal_order_events where order_id = ${id}::uuid order by at, id`)).map((e) => [
      e.kind,
      e.ground,
      e.via,
    ]);
  const lastAudit = async (id: string) =>
    (await migrateDb.execute<{ action: string; actor_id: string; metadata: Record<string, unknown> }>(
      sql`select action, actor_id, metadata from public.audit_log where target_id = ${id} order by chain_seq desc limit 1`,
    ))[0]!;
  /** An order opened in the console, without a message, for the commands to record against. */
  const consoleOrder = async (kind: "tco_removal" | "dsa_art9" | "dsa_art10" = "tco_removal", sectionC = false) => {
    const view = await orderForTest(w.apiDb, staff, { kind, sectionC, links: kind === "dsa_art10" ? [] : ["https://elsewhere.example/cli"], withholdFromAuthor: kind === "tco_removal" || sectionC });
    orders.push(view.id);
    return view;
  };

  test("the usage lists every order command", () => {
    for (const command of ["order-open", "order-received", "order-sent-at", "order-due", "order-verify", "order-issued", "order-texts", "order-document", "order-scrutiny", "order-reopen", "order-tell-rule", "order-told"]) {
      expect(STAFF_USAGE, command).toContain(`  ${command} `);
    }
  });

  test("order-open: the console's rows with the receipt it is given, the alert order_opened and its audit row as the system actor; without HOME_STATE or APP_ORIGIN it refuses", async () => {
    const post = await newPostRow(w.apiDb, author.id);
    const refused = await cli(["order-open", "--kind", "tco_removal", "--state", "DE", "--authority", "BKA", "--reference", "X", "--channel", "portal", "--link", "https://e.example/x"], {
      env: { DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! },
    });
    expect(refused).toMatchObject({ code: 1, lines: ["err order-open: HOME_STATE and APP_ORIGIN must be set for the migrate service; nothing changed"] });
    const received = new Date(Date.now() - 20 * 60_000);
    const reference = `CLI-${randomUUID()}`;
    const opened = await cli([
      "order-open",
      "--kind",
      "tco_removal",
      "--state",
      "FR",
      "--authority",
      "Office central",
      "--reference",
      reference,
      "--channel",
      "post",
      "--received",
      received.toISOString(),
      "--section-c",
      "--link",
      `${appOrigin}/post/${post}`,
      "--link",
      "https://elsewhere.example/named",
    ]);
    expect(opened.code, opened.text).toBe(0);
    const id = /order ([0-9a-f-]{36}) opened/.exec(opened.text)![1]!;
    orders.push(id);
    const deadline = new Date(received.getTime() + ORDER_RULES.hourMinutes * 60_000).toISOString();
    expect(opened.lines).toEqual([`out order-open: order ${id} opened: tco_removal, FR, reference ${reference}, 2 items (1 name no post). Receipt: ${received.toISOString()}; deadline ${deadline}.`]);
    const row = await orderRow(id);
    expect([row.opened_via, row.opened_by, row.cross_border, row.section_c, row.withhold_from_author, row.preserve, row.channel]).toEqual(["cli", null, true, true, true, true, "post"]);
    expect(await eventsOf(id)).toEqual([["opened", null, "cli"]]);
    const [alert] = await migrateDb.execute<{ kind: string; facts: Record<string, unknown>; mailed: boolean }>(
      sql`select kind, facts, mailed_at is not null as mailed from public.alert_outbox where order_id = ${id}::uuid`,
    );
    expect(alert).toEqual({ kind: "order_opened", facts: { items: 2, dueAt: deadline, unknown: 0 }, mailed: false });
    const audit = await lastAudit(id);
    expect([audit.action, audit.actor_id, audit.metadata.via, audit.metadata.reference]).toEqual(["order_opened", SYSTEM_ACTOR_ID, "cli", reference]);
    expect(JSON.stringify(audit.metadata)).not.toContain("elsewhere.example/named");
    // The same reference again: refused, nothing changed.
    const again = await cli(["order-open", "--kind", "tco_removal", "--state", "FR", "--authority", "Office central", "--reference", reference, "--channel", "post", "--link", "https://e.example/y"]);
    expect([again.code, again.text]).toEqual([1, "err order-open: an order of this authority with this reference is already recorded (order_exists); nothing changed"]);
    // Without a receipt: the console says deadline unknown.
    const unknown = await cli(["order-open", "--kind", "tco_removal", "--state", "DE", "--authority", "BKA", "--reference", `U-${randomUUID()}`, "--channel", "other", "--link", "https://e.example/u"]);
    orders.push(/order ([0-9a-f-]{36}) opened/.exec(unknown.text)![1]!);
    expect(unknown.text).toMatch(/Receipt not recorded: the console says deadline unknown[.]$/);
  });

  test("order-open from a listed message: the message's receipt, the channel mailbox, the message handled as an order", async () => {
    const m = await contactMessageForTest(new Date(Date.now() - 5 * 60_000), "junk");
    messages.push(m);
    const opened = await cli(["order-open", "--kind", "dsa_art9", "--state", "DE", "--authority", "Staatsanwaltschaft", "--reference", `M-${randomUUID()}`, "--channel", "mailbox", "--message", m, "--link", "https://e.example/m"]);
    expect(opened.code, opened.text).toBe(0);
    const id = /order ([0-9a-f-]{36}) opened/.exec(opened.text)![1]!;
    orders.push(id);
    const [msg] = await migrateDb.execute<{ disposition: string; stamped: boolean; received: Date }>(sql`select disposition, handled_at is not null as stamped, received_at as received from public.contact_messages where id = ${m}::uuid`);
    expect([msg!.disposition, msg!.stamped]).toEqual(["order", true]);
    // A row read with select * may hold its times as text: each is compared as an instant.
    expect(new Date((await orderRow(id)).received_at as string | Date).getTime()).toBe(new Date(msg!.received).getTime());
    const portal = await cli(["order-open", "--kind", "dsa_art9", "--state", "DE", "--authority", "S", "--reference", `P-${randomUUID()}`, "--channel", "portal", "--message", m, "--link", "https://e.example/p"]);
    expect(portal).toMatchObject({ code: 1, text: "err order-open: an order whose message is listed arrived by mail: --channel mailbox; nothing changed" });
  });

  test("the receipt, the sending time and a DSA order's deadline; an instant without its offset is refused", async () => {
    const order = await consoleOrder();
    const noOffset = await cli(["order-received", order.id, "2026-10-10T01:00:12"]);
    expect(noOffset).toMatchObject({ code: 1, text: "err order-received: 2026-10-10T01:00:12 is not an instant with an offset; nothing changed" });
    const at = new Date(Date.now() - 30 * 60_000);
    const received = await cli(["order-received", order.id, at.toISOString()]);
    expect(received.text).toBe(`out order-received: receipt ${at.toISOString()}; deadline ${new Date(at.getTime() + ORDER_RULES.hourMinutes * 60_000).toISOString()}.`);
    expect((await cli(["order-received", order.id, at.toISOString()])).code).toBe(1);
    const sent = new Date(at.getTime() - 5 * 60_000);
    expect((await cli(["order-sent-at", order.id, sent.toISOString()])).text).toBe(`out order-sent-at: sent ${sent.toISOString()}; the clock starts ${sent.toISOString()}.`);
    expect((await cli(["order-due", order.id, "none"])).text).toBe("err order-due: a removal order's deadline is its hour, from its receipt; nothing changed");
    const dsa = await consoleOrder("dsa_art9");
    const due = new Date(Date.now() + 86_400_000);
    expect((await cli(["order-due", `DE:${dsa.reference}`, due.toISOString()])).text).toBe(`out order-due: due ${due.toISOString()}.`);
    expect(await eventsOf(order.id)).toEqual([
      ["opened", null, "console"],
      ["received_set", null, "cli"],
      ["sent_at_set", null, "cli"],
    ]);
    const audit = await lastAudit(order.id);
    expect([audit.action, audit.actor_id, audit.metadata.event]).toEqual(["order_recorded", SYSTEM_ACTOR_ID, "sent_at_set"]);
  });

  test("order-verify records the check, its text only as a digest in the audit row; an item added later is unverified again", async () => {
    const order = await consoleOrder();
    const how = "Register entry BKA, checked by phone against the copy of the register";
    const verified = await cli(["order-verify", order.id, "--how", how]);
    expect(verified.text).toMatch(new RegExp(`^out order-verify: order ${order.id} verified at [0-9T:.Z-]+: 1 items compared with the order[.]$`));
    const audit = await lastAudit(order.id);
    expect(audit.metadata.howSha256).toBe(createHash("sha256").update(how).digest("hex"));
    expect(JSON.stringify(audit.metadata)).not.toContain("by phone");
    expect((await cli(["order-verify", order.id])).text).toBe("err order-verify: --how is required; nothing changed");
  });

  test("order-issued: refused after the receipt; recorded before it, with the notice's hold", async () => {
    const order = await consoleOrder("tco_removal", true);
    await cli(["order-received", order.id, new Date(Date.now() - 60 * 60_000).toISOString()]);
    expect((await cli(["order-issued", order.id, new Date().toISOString()])).text).toBe("err order-issued: an order is not issued after it was received; nothing changed");
    const issued = new Date(Date.now() - 2 * 60 * 60_000);
    const done = await cli(["order-issued", order.id, issued.toISOString()]);
    expect(done.text).toMatch(new RegExp(`^out order-issued: issued ${issued.toISOString()}; the notice is held until [0-9T:.Z-]+[.]$`));
  });

  test("order-texts reads the authority's words from standard input, with salt and digest; the audit row holds the digest; order-document keeps the digest and the length alone", async () => {
    const order = await consoleOrder("dsa_art9");
    const reasons = `The content incites violence.${NEWLINE}Article 9 order of the authority.`;
    const recorded = await cli(["order-texts", order.id, "--reasons"], { input: reasons });
    expect(recorded.text).toBe(`out order-texts: reasons recorded (${Array.from(reasons).length} characters). No author has been told of this order: the notice shows the text from its first telling.`);
    const row = await orderRow(order.id);
    expect([row.reasons, typeof row.reasons_salt, typeof row.reasons_digest]).toEqual([reasons, "string", "string"]);
    // Task 3: how many told authors the record made owed a mail again (none here: no item was given effect).
    expect((await lastAudit(order.id)).metadata).toEqual({ event: "texts_recorded", text: "reasons", digest: row.reasons_digest, authors: 0 });
    expect((await cli(["order-texts", order.id, "--scope"], { input: "x".repeat(501) })).code).toBe(1);
    expect((await cli(["order-texts", order.id, "--reasons", "--redress"], { input: "x" })).text).toBe("err order-texts: give exactly one of --reasons, --redress and --scope; nothing changed");
    const document = Buffer.from("%PDF-1.7 an order's document");
    const doc = await cli(["order-document", order.id], { input: document });
    const digest = createHash("sha256").update(document).digest("hex");
    expect(doc.text).toBe(`out order-document: ${digest}, ${document.length} bytes.`);
    expect([(await orderRow(order.id)).document_sha256, Number((await orderRow(order.id)).document_bytes)]).toEqual([digest, document.length]);
  });

  test("order-scrutiny and order-reopen", async () => {
    const order = await consoleOrder();
    const at = new Date(Date.now() - 60_000).toISOString();
    expect((await cli(["order-scrutiny", order.id, "requested", "--by", "korbat", "--at", at])).text).toBe("out order-scrutiny: request recorded.");
    expect((await cli(["order-scrutiny", order.id, "decided", "--outcome", "annulled", "--at", at])).text).toBe(
      "out order-scrutiny: decided: annulled. An admin reinstates each item on its case, ground scrutiny, at once.",
    );
    expect((await cli(["order-reopen", order.id, "--how", "closed by mistake"])).text).toBe("err order-reopen: the order is not closed; nothing changed");
    await migrateDb.execute(sql`update public.legal_orders set closed_at = now() where id = ${order.id}::uuid`);
    expect((await cli(["order-reopen", order.id, "--how", "closed by mistake"])).text).toBe(`out order-reopen: order ${order.id} is open again. Its times are unchanged.`);
    expect(await eventsOf(order.id)).toEqual([
      ["opened", null, "console"],
      ["scrutiny_requested", null, "cli"],
      ["scrutiny_decided", "annulled", "cli"],
      ["reopened", null, "cli"],
    ]);
  });

  test("order-tell-rule and order-told: an order to provide information alone; the home state's default when --when is left out; told only once the rule allows it", async () => {
    const info = await consoleOrder("dsa_art10");
    expect((await cli(["order-told", info.id, "--at", new Date().toISOString(), "--how", "mail"])).text).toBe(
      "err order-told: whether the person may be told of this order is not recorded: run staff.js order-tell-rule first; nothing changed",
    );
    expect((await cli(["order-tell-rule", info.id])).text).toBe("err order-tell-rule: the home state's default is never; give --when to record a rule; nothing changed");
    expect((await cli(["order-tell-rule", info.id, "--when", "never", "--basis", "TDDDG s. 22"])).text).toBe("out order-tell-rule: the person is told never, on the basis recorded.");
    expect((await cli(["order-told", info.id, "--at", new Date().toISOString(), "--how", "mail"])).text).toBe("err order-told: the rule recorded for this order is that the person is never told; nothing changed");
    expect((await cli(["order-tell-rule", info.id, "--when", "at_effect", "--basis", "the order's sentence 3"])).code).toBe(0);
    expect((await cli(["order-told", info.id, "--at", new Date(Date.now() - 60_000).toISOString(), "--how", "mail from the contact address"])).text).toMatch(/^out order-told: recorded at /);
    const removal = await consoleOrder();
    expect((await cli(["order-tell-rule", removal.id, "--when", "never", "--basis", "x"])).code).toBe(1);
  });

  test("an order named as <CC>:<reference> while several orders of the state share it is order_ambiguous, naming each by its id", async () => {
    const reference = `AMB-${randomUUID()}`;
    const one = await orderForTest(w.apiDb, staff, { reference, authority: "Authority one", links: ["https://e.example/a1"] });
    const two = await orderForTest(w.apiDb, staff, { reference, authority: "Authority two", links: ["https://e.example/a2"] });
    orders.push(one.id, two.id);
    const named = await cli(["order-verify", `DE:${reference}`, "--how", "x"]);
    expect(named.code).toBe(1);
    expect(named.text).toContain(`err order_ambiguous: 2 orders of DE have this reference; name one by its id:`);
    expect(named.text).toContain(one.id);
    expect(named.text).toContain(two.id);
    expect(named.text).toMatch(/nothing changed$/);
  });

  test("leaves no row behind", async () => {
    await removeOrders(w.migrateDb, orders.splice(0));
    await removeMessages(w.migrateDb, messages.splice(0));
    await removeOrderAlerts(w.migrateDb, started);
    // The post an order named, once no item names it.
    await w.migrateDb.execute(sql`delete from public.posts where author_id = ${author.id}::uuid`);
    expect(await rowCounts(w.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toEqual(before);
  });
});
