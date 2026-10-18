import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NOT_HELD_KINDS, RECORDS_NOT_HELD, RECORDS_NOT_HELD_VERSION } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { createAuthRepo } from "../../src/auth/repo";
import { recordDigest } from "../../src/cli/records";
import { loadConfig } from "../../src/config";
import { STAFF_USAGE, runStaffCommand } from "../../src/cli/staff";
import { newUserWithDevice } from "./auth-fixtures";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { CHANNEL_TABLES, aPost, imagePost, removeDecided, removeFixtures, report, rowCounts } from "./moderation-fixtures";
import { ORDER_TABLES, orderForTest, removeOrders } from "./orders-fixtures";
import { RECORD_TABLES, SEAL_FOR_GOOD, holdOf, recordCounts, recordsOf, removeRecords } from "./records-fixtures";

vi.setConfig({ testTimeout: 90_000 });

const NEWLINE = String.fromCharCode(10);

/**
 * The commands of the records to authorities (3f design, sections 7.13, 7.14, 8.11 and 10.5; W.8): each as the migrator,
 * one transaction with the 10-second lock timeout, the account's hold row before the record where a command releases
 * it, and its audit row last under the system actor (notification_recorded, production_recorded, address_checked),
 * whose later steps hold only the digest of the record's row. records lists and, with --verify, recomputes those digests;
 * notification-facts (in place of 3c's account-facts) prints the account's facts and records a production; a production
 * for an order to provide information waits for its tell rule; the hand-over's list holds one seal's files and its record
 * takes exactly those names. A refusal is one sentence ending in "nothing changed", exit 1, and writes nothing. The seal
 * commits with a real key; the last test removes what the file made.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the commands of the records to authorities", () => {
  let world: DeciderWorld;
  let admin: RealStaff;
  let migrateDb: Db;
  let authDb: Db;
  let before: Record<string, number>;
  let recordsBefore: Record<string, number>;
  /** The sealed account: a real auth row with an address, a profile, a post with two images, sealed for good. */
  let account: { id: string; email: string; handle: string };
  let sealed: { postId: string; caseId: string; sealActionId: string; mediaIds: string[] };
  const orders: string[] = [];
  const posts: string[] = [];

  beforeAll(async () => {
    // Read in beforeAll: a suite without a database is collected and skipped, and its environment is not loaded then.
    const config = loadConfig();
    world = deciderWorld(createDb(config.DATABASE_URL_API, { max: 4 }));
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
    admin = await world.staff("admin");
    const apiDb = world.moderation.deps.apiDb;
    before = await rowCounts(apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES]);
    recordsBefore = await recordCounts(migrateDb);
    const { user } = await newUserWithDevice(createAuthRepo(authDb));
    const handle = `r_${randomUUID().slice(0, 8)}`;
    await apiDb.execute(sql`insert into profiles (id, handle, display_name) values (${user.id}::uuid, ${handle}, 'Sealed')`);
    account = { id: user.id, email: user.email, handle };
    const p = await imagePost(apiDb, 2, account.id);
    posts.push(p.postId);
    const { caseId } = await report(apiDb, aPost(p.postId), "csam");
    const outcome = await world.decideAs(admin, caseId, SEAL_FOR_GOOD);
    if (typeof outcome === "string") throw new Error(`the seal was not recorded (${outcome})`);
    const [action] = await migrateDb.execute<{ id: string }>(sql`select id from decision_actions where decision_id = ${outcome.decisionId}::uuid and kind::text = 'seal_media'`);
    sealed = { postId: p.postId, caseId, sealActionId: action!.id, mediaIds: p.mediaIds };
  }, 120_000);
  afterAll(async () => {
    await removeOrders(migrateDb, orders);
    await removeRecords(migrateDb, [account.id, admin.id]);
    await removeDecided(migrateDb, posts, [admin.id]);
    await removeFixtures(migrateDb, [account.id]);
    await world.close();
    await Promise.all([closeDb(migrateDb), closeDb(authDb)]);
  });

  const env = () => ({ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! });
  /** The command's printed lines, each marked with its stream, and its exit code; standard input as given. */
  async function cli(args: string[], input?: string) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, env(), { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) }, async () => Buffer.from(input ?? "", "utf8"));
    return { code, lines, text: lines.join(NEWLINE) };
  }
  const lastAudit = async (id: string) =>
    (await migrateDb.execute<{ action: string; actor_id: string; target_type: string | null; metadata: Record<string, unknown> }>(
      sql`select action, actor_id, target_type, metadata from public.audit_log where target_id = ${id} order by chain_seq desc limit 1`,
    ))[0]!;
  const auditCount = async () => (await migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log`))[0]!.n;
  const theRecord = async () => (await recordsOf(migrateDb, account.id)).find((r) => r.seal_action_id === sealed.sealActionId)!;
  const production = async (id: string) => ({ ...(await migrateDb.execute<Record<string, unknown>>(sql`select * from public.productions where id = ${id}::uuid`))[0]! });

  test("the seal opened its record and the hold; records lists it; notification-facts prints the account's facts, records a production, and refuses a record that is not owed", async () => {
    const record = await theRecord();
    expect(record).toMatchObject({ state: "owed", case_id: sealed.caseId, account_id: account.id, opened_via: "system" });
    expect(await holdOf(migrateDb, account.id)).toMatchObject({ seal_final: true, released_at: null });
    const listed = await cli(["records"]);
    expect(listed.code).toBe(0);
    expect(listed.lines[0]).toMatch(/^out records: [0-9]+ notifications owed, [0-9]+ archives not recorded as destroyed[.]$/);
    expect(listed.text).toMatch(new RegExp(`out records: ${record.id}: case ${sealed.caseId}, duties none, owed since [0-9T:.Z-]+, address held until [0-9T:.Z-]+`));

    const audits = await auditCount();
    const facts = await cli(["notification-facts", record.id]);
    expect(facts.code).toBe(0);
    const [created] = await authDb.execute<{ at: string }>(sql`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from auth.users where id = ${account.id}::uuid`);
    expect(facts.lines.slice(0, 3)).toEqual([`out handle: @${account.handle}`, `out email: ${account.email}`, `out created_at: ${created!.at}`]);
    expect(facts.lines).toContain(`out post_id: ${sealed.postId}`);
    expect(facts.lines.some((line) => line.startsWith("out post_created_at: "))).toBe(true);
    expect(facts.lines).toContain(`out ${RECORDS_NOT_HELD[RECORDS_NOT_HELD_VERSION]}`);
    const made = /^out notification-facts: recorded as production ([0-9a-f-]{36})[.]$/.exec(facts.lines.at(-1)!);
    expect(made).not.toBeNull();
    const row = await production(made![1]!);
    expect(row).toMatchObject({ instrument: "notification", notification_id: record.id, account_id: account.id, seal_action_id: sealed.sealActionId, produced: ["handle", "address", "created_at", "post_ids", "post_times"], not_held: [...NOT_HELD_KINDS] });
    const audit = await lastAudit(made![1]!);
    expect([audit.action, audit.actor_id, audit.target_type]).toEqual(["production_recorded", SYSTEM_ACTOR_ID, "production"]);
    expect(audit.metadata).toEqual({ step: "account", digest: await recordDigest(migrateDb, "production", made![1]!) });
    expect(await auditCount()).toBe(audits + 1);

    expect((await cli(["notification-facts", randomUUID()])).text).toMatch(/^err notification-facts: no notification record has the id [0-9a-f-]{36}; nothing changed$/);
    // 3c's account-facts is gone: notification-facts replaces it.
    expect((await cli(["account-facts", account.handle, sealed.caseId])).code).toBe(2);
    for (const command of ["records", "notification-open", "notification-facts", "notification-sent", "notification-declined", "notification-answer", "notification-event", "production-account", "address-check", "handover-list", "handover-record", "handover-destroyed"]) {
      expect(STAFF_USAGE, command).toContain(`  ${command} `);
    }
    expect(STAFF_USAGE).not.toContain("account-facts");
  });

  test("handover-list lists one seal's stored files and opens a production; handover-record takes exactly those names; handover-destroyed ends it; a seizure is taken", async () => {
    const audits = await auditCount();
    const listed = await cli(["handover-list", sealed.sealActionId, "--instrument", "notification", "--authority", "BKA", "--reference", "ST 1/26"]);
    expect(listed.code).toBe(0);
    const out = listed.lines.filter((line) => line.startsWith("out ")).map((line) => line.slice(4));
    const first = /^production ([0-9a-f-]{36})$/.exec(out[0]!);
    expect(first).not.toBeNull();
    const id = first![1]!;
    const names = sealed.mediaIds.flatMap((m) => ["small", "large"].map((size) => `files/${m.slice(0, 2)}/${m}/${size}.webp`)).sort();
    expect(out.slice(1).sort()).toEqual(names);
    expect(listed.lines).toContain(`err handover-list: production ${id}: 4 files of 1 posts.`);
    expect(await production(id)).toMatchObject({ instrument: "notification", seal_action_id: sealed.sealActionId, account_id: account.id, authority: "BKA", their_reference: "ST 1/26", produced: ["files"], archive_sha256: null });
    expect((await lastAudit(id)).metadata).toEqual({ step: "listed", digest: await recordDigest(migrateDb, "production", id) });

    const sha = (name: string) => createHash("sha256").update(name).digest("hex");
    const digests = (list: string[]) => [...list.map((name, i) => `${name} ${100 + i} ${sha(name)}`), `archive 999 ${sha("archive")}`].join(NEWLINE) + NEWLINE;
    const listOrder = out.slice(1);
    expect((await cli(["handover-record", id, "--channel", "courier", "--receipt", "R-1"], digests([...listOrder.slice(1), "files/aa/other/small.webp"]))).text).toBe(
      "err handover-record: the digests do not name exactly the files handover-list printed; nothing changed",
    );
    const recorded = await cli(["handover-record", id, "--channel", "courier", "--receipt", "R-1"], digests(listOrder));
    expect(recorded.text).toBe(`out handover-record: production ${id}: 4 files, archive ${sha("archive")}. Delete every copy once the authority confirms, then run handover-destroyed.`);
    const row = await production(id);
    expect(row).toMatchObject({ archive_sha256: sha("archive"), channel: "courier", receipt: "R-1", destroyed_at: null });
    expect((row.files as { name: string; bytes: number; sha256: string }[]).map((f) => [f.name, f.bytes, f.sha256])).toEqual(listOrder.map((name, i) => [name, 100 + i, sha(name)]));
    expect((await cli(["handover-record", id, "--channel", "courier", "--receipt", "R-1"], digests(listOrder))).code).toBe(1);
    const destroyed = await cli(["handover-destroyed", id, "--how", "the archive and its copy were overwritten"]);
    expect(destroyed.text).toMatch(/^out handover-destroyed: recorded at [0-9T:.Z-]+[.]$/);
    expect((await production(id)).destroyed_how).toBe("the archive and its copy were overwritten");
    expect((await cli(["handover-destroyed", id, "--how", "again"])).code).toBe(1);
    expect(await auditCount()).toBe(audits + 3);

    // A seizure: the list, then the record that the authority took the files, with no archive.
    const seized = await cli(["handover-list", sealed.sealActionId, "--instrument", "seizure", "--authority", "Staatsanwaltschaft", "--reference", "AZ 9"]);
    const seizure = /^out production ([0-9a-f-]{36})$/.exec(seized.lines.find((line) => line.startsWith("out production "))!)![1]!;
    expect((await cli(["handover-record", seizure, "--taken"])).code).toBe(0);
    expect(await production(seizure)).toMatchObject({ instrument: "seizure", archive_sha256: null, destroyed_how: "taken by the authority" });

    // Refused: not a seal's row, and an instrument that does not hand files over.
    expect((await cli(["handover-list", randomUUID(), "--instrument", "demand", "--authority", "x", "--reference", "y"])).code).toBe(1);
    expect((await cli(["handover-list", sealed.sealActionId, "--instrument", "dsa_art10", "--authority", "x", "--reference", "y"])).code).toBe(1);
  });

  test("handover-list refuses a seal whose posts' image rows are not as many as it recorded (handover_mismatch), and writes nothing", async () => {
    const audits = await auditCount();
    await migrateDb.execute(sql`update public.seal_posts set images = images + 1 where action_id = ${sealed.sealActionId}::uuid`);
    try {
      expect((await cli(["handover-list", sealed.sealActionId, "--instrument", "demand", "--authority", "BKA", "--reference", "ST 2/26"])).text).toBe(
        "err handover-list: handover_mismatch: the image rows of this seal's posts are not what the seal recorded: run staff.js text-verify, and hand nothing over; nothing changed",
      );
    } finally {
      await migrateDb.execute(sql`update public.seal_posts set images = images - 1 where action_id = ${sealed.sealActionId}::uuid`);
    }
    expect(await auditCount()).toBe(audits);
  });

  test("notification-sent records the notification by kind and releases the hold; notification-answer and notification-event follow; records --verify recomputes each digest", async () => {
    const record = await theRecord();
    const args = ["notification-sent", record.id, "--authority", "BKA", "--channel", "portal", "--duty", "dsa18_1", "--duty", "tco14_5", "--state", "DE", "--basis", "the account's address", "--own-reference", "K-7", "--kinds", "handle,address,post_ids,files", "--at", "2026-10-10T03:00:00+02:00", "--receipt", "receipt 7", "--by", "the operator"];
    expect((await cli([...args.slice(0, -2)])).text).toBe("err notification-sent: --by is required; nothing changed");
    expect((await cli(args.map((word) => (word === "handle,address,post_ids,files" ? "handle,name" : word)))).text).toBe(
      "err notification-sent: --kinds takes handle, address, created_at, post_ids, post_times, report_time and files; nothing changed",
    );
    const sent = await cli(args);
    expect(sent.text).toBe(`out notification-sent: record ${record.id} sent to BKA at 2026-10-10T01:00:00.000Z. The address hold is released.`);
    const [row] = await migrateDb.execute<Record<string, unknown>>(sql`select state, duties, state_concerned, state_basis, sent_kinds, not_kept_version, own_reference, receipt, sent_by, check_result from public.authority_notifications where id = ${record.id}::uuid`);
    expect({ ...row }).toEqual({ state: "sent", duties: ["dsa18_1", "tco14_5"], state_concerned: "DE", state_basis: "the account's address", sent_kinds: ["handle", "address", "post_ids", "files"], not_kept_version: RECORDS_NOT_HELD_VERSION, own_reference: "K-7", receipt: "receipt 7", sent_by: "the operator", check_result: true });
    expect(await holdOf(migrateDb, account.id)).toMatchObject({ release_reason: "sent" });
    const audit = await lastAudit(record.id);
    expect([audit.action, audit.actor_id, audit.target_type]).toEqual(["notification_recorded", SYSTEM_ACTOR_ID, "notification"]);
    expect(audit.metadata).toEqual({ step: "sent", caseId: sealed.caseId, sealActionId: sealed.sealActionId, duties: ["dsa18_1", "tco14_5"], sentKinds: ["handle", "address", "post_ids", "files"], at: "2026-10-10T01:00:00.000Z" });
    expect((await cli(args)).text).toBe(`err notification-sent: record ${record.id} is sent, not owed; nothing changed`);

    expect((await cli(["notification-answer", record.id, "--their-reference", "ST 12/34", "--at", "2026-10-12T00:00:00Z", "--answer", "a sentence"])).code).toBe(1);
    expect((await cli(["notification-answer", record.id, "--their-reference", "ST 12/34", "--at", "2026-10-12T00:00:00Z", "--answer", "illegal"])).text).toBe("out notification-answer: recorded.");
    expect((await lastAudit(record.id)).metadata).toEqual({ step: "answered", digest: await recordDigest(migrateDb, "notification", record.id) });
    const [answer] = await migrateDb.execute<Record<string, unknown>>(sql`select reported, their_reference, answer from public.seal_report(${sealed.sealActionId}::uuid)`);
    expect({ ...answer }).toEqual({ reported: true, their_reference: "ST 12/34", answer: "illegal" });

    expect((await cli(["notification-event", record.id, "--kind", "request", "--at", "2026-10-13T00:00:00Z", "--how", "a letter", "--until", "2027-01-01T00:00:00Z"])).code).toBe(1);
    const event = await cli(["notification-event", record.id, "--kind", "request", "--at", "2026-10-13T00:00:00Z", "--how", "a letter asking for the files", "--reference", "ST 12/34-2", "--not-to-person"]);
    expect(event.lines).toEqual([
      "out notification-event: recorded.",
      "out notification-event: until further notice, nothing about this may be told to the person: korbat's access-request draft marks the case.",
    ]);
    expect((await lastAudit(record.id)).metadata).toEqual({ step: "event", digest: await recordDigest(migrateDb, "notification", record.id) });

    expect((await cli(["records", "--verify"])).code).toBe(0);
    // A record changed around the command line no longer recomputes to its audit row's digest.
    await migrateDb.execute(sql`update public.authority_notifications set their_reference = 'changed' where id = ${record.id}::uuid`);
    try {
      const verify = await cli(["records", "--verify"]);
      expect(verify.code).toBe(1);
      expect(verify.text).toContain(`records: notification ${record.id} differs from its audit row`);
    } finally {
      await migrateDb.execute(sql`update public.authority_notifications set their_reference = 'ST 12/34' where id = ${record.id}::uuid`);
    }
    expect((await cli(["records", "--verify"])).code).toBe(0);
  });

  test("notification-open opens a record for a check on other content, with no hold; notification-declined closes it with its reason", async () => {
    const p = await imagePost(world.moderation.deps.apiDb, 0, account.id);
    posts.push(p.postId);
    const { caseId } = await report(world.moderation.deps.apiDb, aPost(p.postId), "illegal");
    expect((await cli(["notification-open", "--case", caseId, "--duty", "dsa18_3"])).code).toBe(1);
    expect((await cli(["notification-open", "--case", randomUUID(), "--duty", "voluntary"])).text).toMatch(/^err notification-open: no case has the id /);
    const holdBefore = await holdOf(migrateDb, account.id);
    const opened = await cli(["notification-open", "--case", caseId, "--duty", "voluntary"]);
    const made = /^out notification-open: record ([0-9a-f-]{36}), owed since [0-9T:.Z-]+[.]$/.exec(opened.text);
    expect(made).not.toBeNull();
    const id = made![1]!;
    const record = (await recordsOf(migrateDb, account.id)).find((r) => r.id === id)!;
    expect(record).toMatchObject({ state: "owed", duties: ["voluntary"], case_id: caseId, seal_action_id: null, opened_via: "cli" });
    expect((await lastAudit(id)).metadata).toMatchObject({ step: "opened", caseId, sealActionId: null, duties: ["voluntary"] });
    expect(await holdOf(migrateDb, account.id)).toEqual(holdBefore);
    expect((await cli(["notification-declined", id, "--reason", "the check found nothing to report", "--by", "the operator"])).text).toBe(`out notification-declined: record ${id} closed. No address is held for it.`);
    expect((await recordsOf(migrateDb, account.id)).find((r) => r.id === id)).toMatchObject({ state: "declined", declined_reason: "the check found nothing to report" });
    expect(await holdOf(migrateDb, account.id)).toEqual(holdBefore);
  });

  test("production-account waits for the tell rule, then prints the account's three facts and records what was asked and produced by kind", async () => {
    const view = await orderForTest(world.moderation.deps.apiDb, admin, { kind: "dsa_art10", links: [] });
    orders.push(view.id);
    const args = ["production-account", view.id, "--handle", account.handle, "--asked", "handle,address,created_at"];
    expect((await cli(args)).text).toBe("err production-account: tell_rule_missing: whether the person may be told of this order is not recorded: run staff.js order-tell-rule first; nothing changed");
    expect((await cli(["order-tell-rule", view.id, "--when", "never", "--basis", "section 5 of the order"])).code).toBe(0);
    expect((await cli([...args.slice(0, -1), "handle,name"])).code).toBe(1);
    const done = await cli(args);
    expect(done.code).toBe(0);
    expect(done.lines.slice(0, 3)).toEqual([`out handle: @${account.handle}`, `out email: ${account.email}`, expect.stringMatching(/^out created_at: /)]);
    expect(done.lines).toContain(`out ${RECORDS_NOT_HELD[RECORDS_NOT_HELD_VERSION]}`);
    const made = /^out production-account: recorded as production ([0-9a-f-]{36}), instrument dsa_art10[.]$/.exec(done.lines.at(-1)!);
    expect(made).not.toBeNull();
    const row = await production(made![1]!);
    expect(row).toMatchObject({ instrument: "dsa_art10", order_id: view.id, account_id: account.id, asked: ["handle", "address", "created_at"], produced: ["handle", "address", "created_at"], not_held: [...NOT_HELD_KINDS] });
    // The rule never: the production is kept for as long as the person must not be told.
    const [until] = await migrateDb.execute<{ infinite: boolean }>(sql`select not_to_person_until = 'infinity'::timestamptz as infinite from public.productions where id = ${made![1]!}::uuid`);
    expect(until!.infinite).toBe(true);
    expect((await lastAudit(made![1]!)).metadata).toEqual({ step: "account", digest: await recordDigest(migrateDb, "production", made![1]!) });
    // Only an order to provide information takes it.
    const removal = await orderForTest(world.moderation.deps.apiDb, admin, { kind: "tco_removal", links: ["https://elsewhere.example/r"] });
    orders.push(removal.id);
    expect((await cli(["production-account", removal.id, "--handle", account.handle, "--asked", "handle"])).text).toMatch(/^err production-account: .* not an order to provide information; nothing changed$/);
  });

  test("address-check answers yes or no for the address on standard input, prints no address and writes one audit row", async () => {
    const yes = await cli(["address-check", "--handle", account.handle], `${account.email.toUpperCase()}${NEWLINE}`);
    expect(yes.text).toBe("out address-check: yes");
    expect(yes.text).not.toContain("@korbat");
    expect((await lastAudit(account.id)).metadata).toEqual({ match: true });
    expect((await lastAudit(account.id)).action).toBe("address_checked");
    expect((await cli(["address-check", "--handle", account.handle], "someone@else.example")).text).toBe("out address-check: no");
    expect((await lastAudit(account.id)).metadata).toEqual({ match: false });
    expect((await cli(["address-check", "--handle", "nobody_here_1"], "a@b.example")).code).toBe(1);
  });

  test("leaves no row behind", async () => {
    await removeOrders(migrateDb, orders.splice(0));
    await removeRecords(migrateDb, [account.id, admin.id]);
    await removeDecided(migrateDb, posts.splice(0), []);
    expect(await recordCounts(migrateDb)).toEqual(recordsBefore);
    expect(RECORD_TABLES).toHaveLength(4);
    await removeFixtures(migrateDb, [account.id]);
    expect(await rowCounts(world.moderation.deps.apiDb, [...ORDER_TABLES, ...CHANNEL_TABLES])).toMatchObject({ cases: before.cases, decisions: before.decisions, legal_orders: before.legal_orders });
  });
});
