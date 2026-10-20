import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ANNEX3_GROUNDS, ORDER_GROUNDS, type TransparencyFigures } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { describeEdition, describeRecipients, figureCommand } from "../../src/cli/figures";
import { runStaffCommand } from "../../src/cli/staff";

/**
 * staff.js recipients and edition (3d design, sections 7.5, 7.6 and 8.10, "The public figures and the head"; Task 4), as
 * the migrator. The months and editions the commands read are committed by the test, in 2006 and 2007, where nothing else
 * in the test database stands, and deleted afterwards (the migrator alone may delete them).
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff.js recipients and edition (3d Task 4)", () => {
  let migrateDb: Db;
  const env = () => ({ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! });
  const run = async (args: string[]) => {
    const lines: string[] = [];
    const code = await runStaffCommand(args, env(), { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) });
    return { code, lines };
  };
  const YEAR = 2006;
  const today = () => new Date().toISOString().slice(0, 10);
  const cleanUp = async () => {
    await migrateDb.execute(sql`delete from public.transparency_editions where year between 2005 and 2007`);
    await migrateDb.execute(sql`delete from public.recipient_months where month between '2006-01-01'::date and '2007-12-01'::date`);
  };

  beforeAll(async () => {
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    await cleanUp();
  });
  afterAll(async () => {
    await cleanUp();
    await closeDb(migrateDb);
  });

  const insertMonth = (month: string, signedIn: number, signedOutDays: number | null) =>
    migrateDb.execute(sql`insert into public.recipient_months (month, signed_in, signed_out_days, method) values (${`${month}-01`}::date, ${signedIn}, ${signedOutDays}, 1)`);

  test("recipients prints each of the six full months before the day, a month not recorded as such, and the average as two bounds", async () => {
    // Asked on 10 March 2007: the six full months are September 2006 to February 2007; October was not recorded.
    for (const [month, signedIn, out] of [["2006-09", 100, 300], ["2006-11", 110, 310], ["2006-12", 120, 320], ["2007-01", 130, 330], ["2007-02", 140, 340]] as const) await insertMonth(month, signedIn, out);
    const at = new Date("2007-03-10T12:00:00.000Z");
    const done = await figureCommand(migrateDb, { command: "recipients", months: 6 }, at);
    expect(done).toEqual({
      ok: true,
      lines: [
        "recipients: method 1; the 6 full months to 2007-02.",
        "recipients: 2006-09: signed in 100; signed out, summed by day, 300",
        "recipients: 2006-10: not recorded",
        "recipients: 2006-11: signed in 110; signed out, summed by day, 310",
        "recipients: 2006-12: signed in 120; signed out, summed by day, 320",
        "recipients: 2007-01: signed in 130; signed out, summed by day, 330",
        "recipients: 2007-02: signed in 140; signed out, summed by day, 340",
        "recipients: only 5 full months are recorded.",
        "recipients: average monthly active recipients: between 120 and 440.",
      ],
    });
    // A month that did not count signed-out readers: "at least", and no second bound.
    await insertMonth("2006-10", 100, null);
    expect(await figureCommand(migrateDb, { command: "recipients", months: 6 }, at)).toMatchObject({
      ok: true,
      lines: expect.arrayContaining(["recipients: 2006-10: signed in 100; signed out, summed by day, not counted", "recipients: average monthly active recipients: at least 117; signed-out readers are not counted."]),
    });
    expect(describeRecipients([], 2, at)).toEqual([
      "recipients: method 1; the 2 full months to 2007-02.",
      "recipients: 2007-01: not recorded",
      "recipients: 2007-02: not recorded",
      "recipients: only 0 full months are recorded.",
      "recipients: average monthly active recipients: not recorded.",
    ]);
  });

  test("recipients and edition run as commands: their words, the usage on a wrong word, and nothing written", async () => {
    const audits = async () => (await migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log`))[0]!.n;
    const before = await audits();
    const asked = await run(["recipients", "--months", "3"]);
    expect(asked.code).toBe(0);
    expect(asked.lines[0]).toMatch(/^out recipients: method 1; the 3 full months to [0-9]{4}-[0-9]{2}[.]$/);
    expect(await run(["edition", String(YEAR - 1)])).toEqual({ code: 0, lines: [`out edition: none stored for ${YEAR - 1}.`] });
    expect(await audits()).toBe(before);
    for (const args of [["recipients", "--months", "0"], ["recipients", "6"], ["edition"], ["edition", "06"], ["edition", "2006", "--fix"]]) expect((await run(args)).code).toBe(2);
  });

  test("edition prints the newest stored version a line a figure; --correct stores the next version, the migrator's alone, and is refused for a year not due and for one with no edition", async () => {
    for (const [month, signedIn, out] of [["2006-09", 100, 300], ["2006-10", 100, 300], ["2006-11", 100, 300], ["2006-12", 100, 300], ["2007-01", 100, 300], ["2007-02", 100, 300]] as const) {
      await migrateDb.execute(sql`delete from public.recipient_months where month = ${`${month}-01`}::date`);
      await insertMonth(month, signedIn, out);
    }
    await migrateDb.execute(sql`select public.edition_publish(${YEAR}::int, 'first')`);
    const printed = await run(["edition", String(YEAR)]);
    expect(printed).toEqual({
      code: 0,
      lines: [
        `out edition: ${YEAR}, version 1 of ${today()}, first.`,
        "out edition: restrictions by ground: none",
        "out edition: restrictions, all: 0",
        "out edition: restrictions by kind of measure: none",
        "out edition: decisions that found no breach: 0",
        "out edition: reports and notices received: none",
        "out edition: appeals answered: none",
        "out edition: re-examinations answered: none",
        "out edition: measures on accounts: none",
        "out edition: findings by a program: none",
        "out edition: measures a program took: none",
        "out edition: recipients: between about 100 and about 400",
      ],
    });
    const corrected = await run(["edition", String(YEAR), "--correct"]);
    expect(corrected).toEqual({ code: 0, lines: [`out edition: ${YEAR}, version 2 stored, every table computed again. The page lists version 1 as replaced on ${today()}.`] });
    const [audit] = await migrateDb.execute<{ action: string; target_id: string; metadata: Record<string, unknown> }>(
      sql`select action, target_id, metadata from public.audit_log where chain_seq = (select seq from public.audit_head where id = 1)`,
    );
    expect({ ...audit }).toEqual({ action: "edition_published", target_id: `${YEAR}.2`, metadata: { year: YEAR, version: 2, reason: "correction" } });
    expect((await run(["edition", String(YEAR)])).lines[0]).toBe(`out edition: ${YEAR}, version 2 of ${today()}, correction.`);

    const running = new Date().getUTCFullYear();
    expect(await run(["edition", String(running), "--correct"])).toEqual({ code: 1, lines: [`err edition: edition_not_due: the edition of ${running} is due on ${running + 1}-03-01; nothing changed`] });
    expect(await run(["edition", String(YEAR + 1), "--correct"])).toEqual({
      code: 1,
      lines: [`err edition: invalid_edition: no edition of ${YEAR + 1} is stored yet; the job publishes its first version on or after ${YEAR + 2}-03-01; nothing changed`],
    });
  });

  test("an edition's every table, its programs' rate and its order section print as the page prints them, a null figure as not recorded", () => {
    const figures: TransparencyFigures = {
      restrictions: { byGround: [{ label: "R1", count: "about 60" }, { label: "law", count: "about 10" }, { label: "other", count: "about 10" }], byMeasure: [{ label: "remove", count: "about 80" }], total: "about 80" },
      noBreach: "about 140",
      intakes: [{ label: "rules", count: "about 30" }, { label: "illegal", count: "1 to 9" }],
      appeals: [{ label: "kept", count: "about 10" }],
      reexaminations: [{ label: "no_action", count: "about 20" }],
      accountMeasures: [{ label: "strike", count: "about 10" }],
      automated: { findings: [{ label: "R1", count: "about 20" }], measures: [], r1: { base: "about 20", restricted: "about 10" } },
      orders: {
        received: { total: 2, crossBorder: 1 },
        itemsDisabled: 3,
        minutes: { list: [10, 125], outside: 1, withoutReceipt: 0, open: 0 },
        annex3: Object.fromEntries(ANNEX3_GROUNDS.map((ground) => [ground, 0])) as never,
        scrutiny: { requested: 1, annulled: 0, upheld: 1 },
        reinstated: Object.fromEntries(ORDER_GROUNDS.map((ground) => [ground, 0])) as never,
        authorityAccess: null,
        terroristWithoutOrder: 1,
        referralsClosed: 0,
      },
      recipients: { low: "about 120" },
    };
    expect(describeEdition(2025, { version: 2, published_on: "2026-05-02", reason: "hold_ended", figures })).toEqual([
      "edition: 2025, version 2 of 2026-05-02, hold ended.",
      "edition: restrictions by ground, R1: about 60",
      "edition: restrictions by ground, the law: about 10",
      "edition: restrictions by ground, other: about 10",
      "edition: restrictions, all: about 80",
      "edition: restrictions by kind of measure, remove: about 80",
      "edition: decisions that found no breach: about 140",
      "edition: reports and notices received, reports under the rules: about 30",
      "edition: reports and notices received, notices of illegal content: 1 to 9",
      "edition: appeals answered, kept: about 10",
      "edition: re-examinations answered, no action again: about 20",
      "edition: measures on accounts, strike: about 10",
      "edition: findings by a program, R1: about 20",
      "edition: measures a program took: none",
      "edition: of about 20 findings by a program under rule R1, a person then restricted about 10",
      "edition: authorities' orders, removal orders received: 2 (from another Member State: 1)",
      "edition: authorities' orders, items disabled following a removal order: 3",
      "edition: authorities' orders, minutes from the clock's start to the disabling of an order's last item: 10, 125; outside the hour: 1; with an item still open: 0",
      "edition: authorities' orders, Annex III sent, by ground: force_majeure 0, manifest_error 0, insufficient_information 0",
      "edition: authorities' orders, scrutiny: requested 1; annulled 0; upheld 1",
      "edition: authorities' orders, reinstated, by ground: withdrawn 0, annulled 0, scrutiny 0, not_authentic 0, wrong_item 0",
      "edition: authorities' orders, access to preserved content by an authority: not recorded",
      "edition: authorities' orders, restricted by korbat as terrorist content without an order: 1",
      "edition: authorities' orders, referrals closed: 0",
      "edition: recipients: at least about 120; signed-out readers are not counted",
    ]);
  });
});
