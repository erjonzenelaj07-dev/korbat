import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ANNEX3_GROUNDS, ORDER_GROUNDS, type TransparencyFigures } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { describeEdition, describeRecipients, figureCommand, parseFigureArgs } from "../../src/cli/figures";
import { restoreImport } from "../../src/cli/restore";
import { runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { exportLines } from "../../src/staff";
import { headValue } from "../../src/transparency/head";
import { rowCounts } from "./moderation-fixtures";
import { rolledBack } from "./staff-fixtures";
import { accountSince } from "./transparency-fixtures";

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

  let since: string;
  beforeAll(async () => {
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    await cleanUp();
    // 3d review M3: an account of 2005, so the years these tests publish are years korbat ran.
    since = await accountSince(migrateDb, 2005);
  });
  afterAll(async () => {
    await cleanUp();
    await migrateDb.execute(sql`delete from public.profiles where id = ${since}::uuid`);
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
        // 3d Task 7: an edition stored from known material on holds the uploads' table, empty here.
        "out edition: uploads not accepted: none",
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

/**
 * staff.js head-restore-mark (3d design, sections 6.5, 7.3 step 4, 7.7 step 7, 8.10 and 10.5; Task 5; 12.1 row 24), as
 * the migrator, after a restore: it stores the values the keeper's mails hold for days the restored database lacks, as
 * retired rows without a place; retires every stored value whose place and hash the restored chain no longer holds,
 * deleting none; writes today's restore row from the restored head, naming the last published value that still fits;
 * and ends with the system's audit row head_restore_marked. The rows are committed and deleted afterwards.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff.js head-restore-mark (3d Task 5)", () => {
  let migrateDb: Db;
  const env = () => ({ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! });
  const run = async (args: string[]) => {
    const lines: string[] = [];
    const code = await runStaffCommand(args, env(), { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) });
    return { code, lines };
  };
  const cleanUp = () => migrateDb.execute(sql`delete from public.head_publications`);
  const ZEROS = "0".repeat(64);
  let before: Record<string, number>;

  beforeAll(async () => {
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    await cleanUp();
    before = await rowCounts(migrateDb);
  });
  afterAll(async () => {
    await cleanUp();
    await closeDb(migrateDb);
  });

  test("its words: day:value pairs or none; a day that is no day, a value that is no head's, or a day given twice is refused before anything is read", () => {
    expect(parseFigureArgs("head-restore-mark", [])).toEqual({ command: "head-restore-mark", values: [] });
    expect(parseFigureArgs("head-restore-mark", [`2026-10-17:${"a".repeat(64)}`, `2026-10-18:${"b".repeat(64)}`])).toEqual({
      command: "head-restore-mark",
      values: [
        { day: "2026-10-17", value: "a".repeat(64) },
        { day: "2026-10-18", value: "b".repeat(64) },
      ],
    });
    for (const bad of [["2026-10-17"], [`2026-13-01:${ZEROS}`], [`2026-10-17:${"A".repeat(64)}`], [`2026-10-17:${"a".repeat(63)}`], [`2026-10-17:${ZEROS}`, `2026-10-17:${"1".repeat(64)}`], ["--force"]]) {
      expect(() => parseFigureArgs("head-restore-mark", bad), bad.join(" ")).toThrow(/head-restore-mark/);
    }
  });

  test("after a restore: the keeper's values stored retired, every value that no longer fits retired and none deleted, today's restore row naming the last that fits, and its audit row last", async () => {
    const [state] = await migrateDb.execute<{ today: string; seq: number; hash: string }>(
      sql`select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as today, seq::int as seq, hash from public.audit_head where id = 1`,
    );
    const { today, seq, hash } = state!;
    const back = (n: number) => new Date(Date.parse(`${today}T00:00:00.000Z`) - n * 86_400_000).toISOString().slice(0, 10);
    // Six days ago, a value of the restored head's place and hash: it fits. Five days ago, the same place with a value its
    // hash does not give, and four days ago a place above the restored head: neither fits.
    const insert = (d: string, place: number, value: string) =>
      migrateDb.execute(sql`insert into public.head_publications (day, kind, chain_seq, value, witness, published_at) values (${d}::date, 'head', ${place}, ${value}, 'none', now())`);
    const wrongHash = `${"0".repeat(63)}1`;
    await insert(back(6), seq, headValue(back(6), seq, hash));
    await insert(back(5), seq, headValue(back(5), seq, wrongHash));
    await insert(back(4), seq + 3, headValue(back(4), seq + 3, ZEROS));
    const v3 = "3".repeat(64);
    const v2 = "2".repeat(64);
    const audits = async () => (await migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log`))[0]!.n;
    const before = await audits();

    // A keeper's value for a day the database holds with another value: refused, and nothing changed.
    expect(await run(["head-restore-mark", `${back(6)}:${v3}`])).toEqual({
      code: 1,
      lines: [`err head-restore-mark: head_mismatch: the value of ${back(6)} differs from the one the database holds; nothing changed`],
    });
    // A day after today is no day a mail was sent for.
    const tomorrow = new Date(Date.parse(`${today}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
    expect((await run(["head-restore-mark", `${tomorrow}:${v3}`])).lines).toEqual([`err head-restore-mark: invalid_day: ${tomorrow} is after today; nothing changed`]);
    expect(await audits()).toBe(before);

    const done = await run(["head-restore-mark", `${back(3)}:${v3}`, `${back(2)}:${v2}`, `${back(6)}:${headValue(back(6), seq, hash)}`]);
    expect(done).toEqual({
      code: 0,
      lines: [
        "out head-restore-mark: 2 values of the keeper's mails stored, retired; 1 already held.",
        `out head-restore-mark: restore recorded for ${today}. The last published value that still verifies is of ${back(6)}. 4 later values are shown as retired.`,
      ],
    });
    const rows = await migrateDb.execute<{ day: string; kind: string; chain_seq: number | null; value: string; published: boolean; retired: boolean; last_day: string | null }>(sql`
      select to_char(day, 'YYYY-MM-DD') as day, kind, chain_seq::int as chain_seq, value, published_at is not null as published, retired_at is not null as retired, to_char(last_day, 'YYYY-MM-DD') as last_day
        from public.head_publications order by day desc, kind`);
    expect(rows.map((row) => ({ ...row }))).toEqual([
      { day: today, kind: "restore", chain_seq: seq, value: headValue(today, seq, hash), published: true, retired: false, last_day: back(6) },
      { day: back(2), kind: "head", chain_seq: null, value: v2, published: true, retired: true, last_day: null },
      { day: back(3), kind: "head", chain_seq: null, value: v3, published: true, retired: true, last_day: null },
      { day: back(4), kind: "head", chain_seq: seq + 3, value: headValue(back(4), seq + 3, ZEROS), published: true, retired: true, last_day: null },
      { day: back(5), kind: "head", chain_seq: seq, value: headValue(back(5), seq, wrongHash), published: true, retired: true, last_day: null },
      { day: back(6), kind: "head", chain_seq: seq, value: headValue(back(6), seq, hash), published: true, retired: false, last_day: null },
    ]);
    const [audit] = await migrateDb.execute<{ action: string; actor_id: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown>; step_up: unknown }>(
      sql`select action, actor_id, target_type, target_id, metadata, step_up from public.audit_log where chain_seq = (select seq from public.audit_head where id = 1)`,
    );
    expect({ ...audit }).toEqual({ action: "head_restore_marked", actor_id: SYSTEM_ACTOR_ID, target_type: null, target_id: null, metadata: { day: today, retired: 4 }, step_up: null });
    expect(await audits()).toBe(before + 1);

    // One restore a day: a second run is refused and changes nothing.
    expect(await run(["head-restore-mark"])).toEqual({ code: 1, lines: [`err head-restore-mark: restore_marked: a restore is recorded for ${today} already; nothing changed`] });
    expect(await audits()).toBe(before + 1);
  });

  test("with nothing stored that still fits, the restore row names no day, and the line says so", async () => {
    await cleanUp();
    const done = await figureCommand(migrateDb, { command: "head-restore-mark", values: [] });
    const [state] = await migrateDb.execute<{ today: string }>(sql`select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as today`);
    expect(done).toEqual({ ok: true, lines: [`head-restore-mark: restore recorded for ${state!.today}. No published value still verifies. 0 later values are shown as retired.`] });
    const [row] = await migrateDb.execute<{ last_day: string | null }>(sql`select last_day::text from public.head_publications where kind = 'restore'`);
    expect(row!.last_day).toBeNull();
  });

  test("3d Task 8 (W.11, Restoring): restore-import prints one line for each published version of an edition that the restored database lacks, writes nothing for it and opens no gap; one it holds gets no line", async () => {
    await rolledBack(migrateDb, async (tx) => {
      // 3d review M3: an account of 2005, so both years are years korbat ran.
      await accountSince(tx, 2005);
      // Before the backup: 2005's first version is published, and stays.
      await tx.execute(sql`select public.edition_publish(2005, 'first')`);
      const [head] = await tx.execute<{ seq: string; hash: string }>(sql`select seq::text as seq, hash from public.audit_head where id = 1`);
      const tail: string[] = [];
      // The lost work, rolled back to its savepoint as a restore would lose it: 2007's first version, and a row that
      // names 2005's again, which the restored database holds.
      await tx
        .transaction(async (lost) => {
          await lost.execute(sql`select public.edition_publish(2007, 'first')`);
          await lost.execute(sql`insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
                                  values (${SYSTEM_ACTOR_ID}::uuid, 'edition_published', 'edition', '2005.1', jsonb_build_object('year', 2005, 'version', 1, 'reason', 'first'))`);
          const [through] = await lost.execute<{ seq: string }>(sql`select seq::text as seq from public.audit_head where id = 1`);
          for await (const line of exportLines(lost as unknown as Db, Number(head!.seq) - 1, Number(through!.seq))) tail.push(JSON.stringify(line));
          throw new Error("lost with the restore");
        })
        .catch((err: unknown) => {
          if (!(err instanceof Error) || err.message !== "lost with the restore") throw err;
        });
      const gaps = async () => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.restore_gaps`))[0]!.n;
      const before = await gaps();
      const done = await restoreImport(tx as unknown as Db, [], Buffer.from(tail.map((line) => `${line}${String.fromCharCode(10)}`).join(""), "utf8"), loadConfig().APP_ORIGIN);
      if (!done.ok) throw new Error(done.problem);
      const editions = done.lines.filter((line) => line.includes(" is not in the restored database"));
      expect(editions).toEqual([expect.stringMatching(/^restore-import: edition 2007 version 1, published [0-9T:.-]+Z, is not in the restored database: [/]transparency no longer shows it until the job publishes the year again [(]the README, Restoring[)][.]$/)]);
      expect(await gaps()).toBe(before);
      const [held] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.transparency_editions where year in (2005, 2007)`);
      expect(held!.n).toBe(1);
    });
  });

  test("this file left no row behind", async () => {
    await cleanUp();
    expect(await rowCounts(migrateDb)).toEqual(before);
  });
});
