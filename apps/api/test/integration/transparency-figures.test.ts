import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { EDITION_REASONS, TRANSPARENCY_RULES, TransparencyFigures, band, type OrderView } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { tcoCounts, type TcoCounts } from "../../src/cli/counts";
import { aPost, act, decideIn, imagePost, newTestStaff, refusal, removeFixtures, report, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { closeNotifyFixtures } from "./notify-fixtures";
import { rolledBack } from "./staff-fixtures";
import { accountSince, yearForTest, type YearCells } from "./transparency-fixtures";

vi.setConfig({ testTimeout: 180_000 });

/**
 * The public figures on the database (3d design, sections 2 rows 1 to 5 and 8, 6.4 and 7.6; Task 4; invariants 1 and 21;
 * LAB E repeated on the built code, 12.3). transparency_figures() and edition_publish() over yearForTest's years, which
 * lie twelve and more years back, where nothing else in the test database stands: every row is written as the migrator
 * inside a transaction that is rolled back, and the figures are read inside it. This file runs on a database that has no
 * migration after the transparency one, which is how 12.1 row 1 asks that edition_publish be called before the label
 * automated exists.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the public figures and the yearly edition (3d Task 4)", () => {
  let w: NoticesWorld;
  let moderator: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  const NOW = new Date().getUTCFullYear();
  const YEAR = NOW - 12;

  beforeAll(async () => {
    w = noticesWorld();
    // Counted before the staff accounts' profiles exist: the last test removes them.
    before = await rowCounts(w.apiDb);
    moderator = await newTestStaff(w.authDb, w.migrateDb, w.repo, "moderator");
    admin = await newTestStaff(w.authDb, w.migrateDb, w.repo, "admin");
    await staffProfile(w.apiDb, moderator);
    await staffProfile(w.apiDb, admin);
  }, 60_000);
  afterAll(async () => {
    await removeFixtures(w.migrateDb, [moderator.id, admin.id]);
    await closeNotifyFixtures();
    await w.close();
  });

  type Figures = TransparencyFigures & Record<string, unknown>;
  /** The figures of a year at an instant, as the migrator (the one role that may compute them). */
  const figuresOf = async (tx: DbTx, year: number, asOf: Date = new Date()): Promise<Figures> => {
    const [row] = await tx.execute<{ f: Figures }>(sql`select public.transparency_figures(${year}::int, ${asOf.toISOString()}::timestamptz) as f`);
    return row!.f;
  };
  /** edition_publish() as the caller's role, in a savepoint: the version it wrote, null, or the code it was refused with. */
  const publish = async (tx: DbTx, year: number, reason: string): Promise<number | null | string> => {
    let version: number | null = null;
    const refused = await refusal(
      tx.transaction(async (sp) => {
        const [row] = await sp.execute<{ v: number | null }>(sql`select public.edition_publish(${year}::int, ${reason}) as v`);
        version = row!.v;
      }),
    );
    return refused ?? version;
  };
  const editions = (tx: DbTx, year: number) =>
    tx.execute<{ version: number; reason: string; method: number; figures: Figures; computed_at: string; published_at: string }>(
      sql`select version, reason, method, figures, computed_at::text, published_at::text from public.transparency_editions where year = ${year} order by version`,
    );
  /** The newest audit row: its action, actor, target, metadata and whether a key confirmed it. */
  const newestAudit = async (tx: DbTx) => {
    const [row] = await tx.execute<{ action: string; actor_id: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown>; key_id: string | null; step_up: unknown }>(
      sql`select action, actor_id, target_type, target_id, metadata, key_id, step_up from public.audit_log where chain_seq = (select seq from public.audit_head where id = 1)`,
    );
    return row!;
  };
  /** The number a band names: 0, 5 for "1 to 9", or the rounded count. */
  const named = (count: string) => (count === "0" ? 0 : count === "1 to 9" ? 5 : Number(count.replace("about ", "")));
  /** Every string of a stored edition outside the order section, with its path. */
  const stringsOf = (value: unknown, path = ""): { path: string; text: string }[] => {
    if (typeof value === "string") return [{ path, text: value }];
    if (Array.isArray(value)) return value.flatMap((entry, at) => stringsOf(entry, `${path}[${at}]`));
    if (value !== null && typeof value === "object") {
      return Object.entries(value).flatMap(([key, entry]) => (path === "" && key === "orders" ? [] : stringsOf(entry, path === "" ? key : `${path}.${key}`)));
    }
    return [];
  };
  const LABELS = new Set(["label"]);

  /** LAB E's seven cells of 2025, in the year of this test: 216 restrictions, 143 decisions without a breach. */
  const LAB_E: YearCells = { restrictions: { R1: 61, R3: 94, R4: 35, R5: 12, R6: 7, R2: 3, law: 4 }, noBreach: 143 };

  test("LAB E1, E2 and E4 on the built code: seven cells print as five rows and a total, the cells under ten fold into other, and the rows do not give the total", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      await yearForTest(tx, YEAR, LAB_E, moderator);
      const f = await figuresOf(tx, YEAR);
      expect(f.restrictions.byGround).toEqual([
        { label: "R1", count: "about 60" },
        { label: "R3", count: "about 90" },
        { label: "R4", count: "about 40" },
        { label: "R5", count: "about 10" },
        // R2's 3, R6's 7 and the law's 4: 14, printed with its own band.
        { label: "other", count: "about 10" },
      ]);
      expect(f.restrictions.total).toBe("about 220");
      expect(f.restrictions.byMeasure).toEqual([{ label: "remove", count: "about 220" }]);
      expect(f.noBreach).toBe("about 140");
      // E4: the printed rows give 210, the printed total 220: a folded cell cannot be subtracted back.
      expect(f.restrictions.byGround.reduce((sum, row) => sum + named(row.count), 0)).toBe(210);
      expect(named(f.restrictions.total)).toBe(220);
      // The other tables of a year with none of their rows are empty, and the recipients not recorded.
      expect([f.intakes, f.appeals, f.reexaminations, f.accountMeasures, f.automated, f.recipients, f.orders]).toEqual([[], [], [], [], { findings: [], measures: [] }, "not recorded", undefined]);
      expect(TransparencyFigures.parse(f)).toEqual(f);
    });
  });

  test("3d Task 6, row 21: the programs' table: findings and measures without a decider by rule, banded and folded, and R1's rate as two bands on a base of ten or more", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      // Twenty-four R1 findings, fourteen of them on the year's case, which a person's final removal under R1 restricted;
      // three R2 findings; twelve R1 measures without a decider and three R2 seals.
      await yearForTest(tx, YEAR, { restrictions: { R1: 1 }, automated: { findings: { R1: 24, R2: 3 }, restrictedR1: 14, measures: { R1: 12, R2: 3 } } }, moderator);
      const f = await figuresOf(tx, YEAR);
      // R2's three fold into other, printed with its own band; the rows are the rules, never a person.
      expect(f.automated).toEqual({
        findings: [
          { label: "R1", count: "about 20" },
          { label: "other", count: "1 to 9" },
        ],
        measures: [
          { label: "R1", count: "about 10" },
          { label: "other", count: "1 to 9" },
        ],
        r1: { base: "about 20", restricted: "about 10" },
      });
      // The programs' measures are restrictions of the year as well, counted by ground and by measure with the person's.
      expect(f.restrictions.total).toBe("about 20");
      expect(TransparencyFigures.parse(f)).toEqual(f);
    });
    // Under ten R1 findings no rate is printed: the base alone would point at a few people.
    await rolledBack(w.migrateDb, async (tx) => {
      await yearForTest(tx, YEAR, { restrictions: { R1: 1 }, automated: { findings: { R1: 9 }, restrictedR1: 9 } }, moderator);
      const f = await figuresOf(tx, YEAR);
      expect(f.automated).toEqual({ findings: [{ label: "other", count: "1 to 9" }], measures: [] });
    });
  });

  test("3d Task 7, row 21: the uploads' table: the year's refusals by how their hold had ended by the due day, banded and folded; a year without one prints an empty table", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      // Twelve held for a report, three ended without one, two that no admin had ended by the due day.
      await yearForTest(tx, YEAR, { restrictions: { R1: 1 }, uploads: { report: 12, no_report: 3, open: 2 } }, moderator);
      const f = await figuresOf(tx, YEAR);
      // Under ten a row folds into other: the rows are fates, never a person.
      expect(f.uploads).toEqual([
        { label: "report", count: "about 10" },
        { label: "other", count: "1 to 9" },
      ]);
      expect(TransparencyFigures.parse(f)).toEqual(f);
    });
    await rolledBack(w.migrateDb, async (tx) => {
      await yearForTest(tx, YEAR, { restrictions: { R1: 1 } }, moderator);
      expect((await figuresOf(tx, YEAR)).uploads).toEqual([]);
    });
  });

  test("review L5: a later version prints the uploads' fate as it stood on the due day: an end recorded before it as Report counts as Report, though an admin changed it after", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      await yearForTest(tx, YEAR, { restrictions: { R1: 1 }, uploads: { report: 12 } }, moderator);
      const refused = await tx.execute<{ id: string; media_id: string }>(
        sql`select id, media_id from public.upload_refusals where refused_at >= make_timestamptz(${YEAR}::int, 1, 1, 0, 0, 0, 'UTC') and refused_at < make_timestamptz(${YEAR + 1}::int, 1, 1, 0, 0, 0, 'UTC')`,
      );
      expect(refused).toHaveLength(12);
      // Each end's audit row as the route writes it, dated in the year (the chain's trigger is off for the backdating alone).
      for (const r of refused) {
        await tx.execute(sql`insert into public.audit_log (actor_id, action, target_type, target_id, metadata) values (${moderator.id}::uuid, 'upload_hold_ended', 'upload_refusal', ${r.id}, ${JSON.stringify({ params: { endAs: "report", reason: null }, mediaId: r.media_id })}::jsonb)`);
      }
      await tx.execute(sql.raw("alter table public.audit_log disable trigger user"));
      await tx.execute(sql`update public.audit_log set created_at = make_timestamptz(${YEAR}::int, 12, 1, 12, 0, 0, 'UTC') where action = 'upload_hold_ended' and target_id = any(${`{${refused.map((r) => r.id).join(",")}}`}::text[])`);
      await tx.execute(sql.raw("alter table public.audit_log enable trigger user"));
      const first = (await figuresOf(tx, YEAR)).uploads;
      expect(first).toEqual([{ label: "report", count: "about 10" }]);
      // In May after the due day another admin turns every end into No report.
      await tx.execute(sql`update public.upload_refusals set end_as = 'no_report', end_reason = 'other', ended_at = make_timestamptz(${YEAR + 1}::int, 5, 2, 12, 0, 0, 'UTC') where id = any(${`{${refused.map((r) => r.id).join(",")}}`}::uuid[])`);
      expect((await figuresOf(tx, YEAR)).uploads).toEqual(first);
    });
  });

  test("LAB E3: edition_not_due before 1 March of the next year in UTC and for the running year, whatever instant is passed; nothing is written", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      await yearForTest(tx, YEAR, { restrictions: { R1: 12 } }, moderator);
      const lastMoment = new Date(Date.UTC(YEAR + 1, TRANSPARENCY_RULES.dueMonth - 1, TRANSPARENCY_RULES.dueDay) - 1);
      expect(await refusal(tx.transaction((sp) => figuresOf(sp, YEAR, lastMoment)))).toBe("edition_not_due");
      expect((await figuresOf(tx, YEAR, new Date(lastMoment.getTime() + 1))).restrictions.total).toBe("about 10");
      // The running year, also with an instant after its due day: the clock refuses it.
      expect(await refusal(tx.transaction((sp) => figuresOf(sp, NOW, new Date(Date.UTC(NOW + 1, 3, 1)))))).toBe("edition_not_due");
      expect(await publish(tx, NOW, "first")).toBeNull();
      expect(await editions(tx, NOW)).toEqual([]);
      // The migrator's correction of the running year is refused the same way; of a year that is due but has no edition
      // yet, as there is nothing to correct: the first version is the job's.
      expect(await publish(tx, NOW, "correction")).toBe("edition_not_due");
      expect(await publish(tx, YEAR, "correction")).toBe("invalid_edition");
    });
  });

  test("LAB E5 and the order section: of two orders, one under a hold, the edition counts one; tco-counts still prints both, for the authority", async () => {
    const future = new Date(Date.now() + 30 * 86_400_000);
    await rolledBack(w.migrateDb, async (tx) => {
      const made = await yearForTest(tx, YEAR, { orders: [{ posts: 1, receivedBefore: 10 }, { posts: 1, receivedBefore: 20, heldUntil: future }] }, moderator);
      expect(made.orders).toHaveLength(2);
      const f = await figuresOf(tx, YEAR);
      expect(f.orders?.received).toEqual({ total: 1, crossBorder: 0 });
      expect(f.orders?.itemsDisabled).toBe(1);
      expect(f.orders?.minutes).toEqual({ list: [10], outside: 0, withoutReceipt: 0, open: 0 });
      const counts = await tcoCounts(tx, YEAR);
      expect(counts.received?.total).toBe(2);
      // An order decision is in no other table: the two disablings restrict nothing of korbat's own.
      expect([f.restrictions.total, f.restrictions.byMeasure, f.noBreach]).toEqual(["0", [], "0"]);
    });
    // Only the held order: no section, and nothing says one was left out.
    await rolledBack(w.migrateDb, async (tx) => {
      const made = await yearForTest(tx, YEAR, { orders: [{ posts: 1, receivedBefore: 5, heldUntil: future }] }, moderator);
      expect(made.orders).toHaveLength(1);
      const held = await figuresOf(tx, YEAR);
      expect(Object.keys(held)).not.toContain("orders");
      expect(JSON.stringify(held)).not.toMatch(/order|held|hold/i);
      expect((await tcoCounts(tx, YEAR)).received?.total).toBe(1);
    });
  });

  test("the order section is tco-counts' figures as numbers, without the issuing state, on the same rows", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      // As cli-counts.test.ts's fixture year: a German order of two posts, both disabled 10 minutes after receipt, one
      // later reinstated as annulled; an order from another Member State, disabled after 125 minutes, with scrutiny asked
      // and upheld; an order with one of two posts disabled after 5 minutes and Annex III sent; an authority's access to
      // preserved content; korbat's own removal of terrorist content.
      const { orders } = await yearForTest(
        tx,
        YEAR,
        {
          orders: [
            { posts: 2, receivedBefore: 10 },
            { posts: 1, receivedBefore: 125, memberState: "FR" },
            { posts: 2, effectOn: 1, receivedBefore: 5 },
          ],
        },
        moderator,
      );
      const [a, b, c] = orders as [OrderView, OrderView, OrderView];
      const inYear = sql`make_timestamptz(${YEAR}::int, 6, 20, 12, 0, 0, 'UTC')`;
      await decideIn(tx, admin, a.items[0]!.caseId!, { kind: "correction", reviewsDecisionId: a.items[0]!.decisionId!, outcome: "reversed", actions: [{ kind: "reinstate_by_order", orderGround: "annulled" }] });
      await tx.execute(sql`update public.legal_order_events set at = ${inYear}, effective_at = ${inYear} where order_id = ${a.id}::uuid and kind = 'reinstated'`);
      for (const [order, kind, ground] of [[b, "scrutiny_requested", null], [b, "scrutiny_decided", "upheld"], [c, "annex3_sent", "insufficient_information"]] as const) {
        await tx.execute(sql`insert into public.legal_order_events (order_id, kind, ground, at, by_staff, via) values (${order.id}::uuid, ${kind}, ${ground}, ${inYear}, null, 'cli')`);
      }
      await tx.execute(sql`insert into public.productions (instrument, purpose, authority, their_reference, produced, opened_at, imported_at, order_id)
                           values ('preserved_access', 'authority', 'Bundeskriminalamt', 'P-1', '{content}', ${inYear}, now(), ${a.id}::uuid)`);
      const p = await imagePost(tx, 0);
      const { caseId } = await report(tx, aPost(p.postId), "illegal");
      const terrorist = await decideIn(tx, moderator, caseId, { kind: "final", outcome: "restricted", ground: "illegal", categoryKeyword: "KEYWORD_TERRORIST_CONTENT", actions: [act("remove")] });
      await tx.execute(sql`update public.decisions set decided_at = ${inYear}, informed_at = ${inYear} where id = ${terrorist}::uuid`);

      const f = await figuresOf(tx, YEAR);
      const counts = await tcoCounts(tx, YEAR);
      expect(f.orders).toEqual(withoutState(counts));
      expect(f.orders).toMatchObject({ received: { total: 3, crossBorder: 1 }, itemsDisabled: 4, authorityAccess: 1, terroristWithoutOrder: 1, referralsClosed: 0 });
      expect(f.orders?.minutes).toEqual({ list: [10, 125], outside: 1, withoutReceipt: 0, open: 1 });
      // korbat's own removal is a restriction on the law in the tables too; the orders' decisions are in none.
      expect(f.restrictions.byGround).toEqual([{ label: "other", count: "1 to 9" }]);
    });
  });

  test("LAB E7: the time of transparency_figures over 20,000 decisions, beside the lab's 21 ms", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      await yearForTest(tx, YEAR - 2, { restrictions: { R1: 3334, R2: 3333, R3: 3333, R4: 3333, R5: 3333, R6: 3334 } }, moderator);
      await tx.execute(sql`analyze public.decisions`);
      await tx.execute(sql`analyze public.decision_actions`);
      await figuresOf(tx, YEAR - 2);
      const started = performance.now();
      const f = await figuresOf(tx, YEAR - 2);
      const ms = performance.now() - started;
      // The measurement goes to the run's standard error, which the runner's log keeps (a passing test's console is not printed).
      process.stderr.write(`LAB E7 on the built code: transparency_figures over 20,000 decisions took ${ms.toFixed(1)} ms (the lab: 21 ms)${String.fromCharCode(10)}`);
      expect(f.restrictions.total).toBe("about 20000");
      expect(ms).toBeLessThan(10_000);
    });
  });

  test("row 21: over generated years every string of a stored edition is 0, 1 to 9 or about N0, a label or not recorded, and every row under ten is folded", async () => {
    const random = (max: number) => Math.floor(Math.random() * (max + 1));
    await rolledBack(w.migrateDb, async (tx) => {
      for (let year = YEAR - 6; year <= YEAR - 3; year++) {
        await yearForTest(
          tx,
          year,
          {
            restrictions: { R1: random(40), R2: random(12), R3: random(40), R4: random(9), R5: random(25), R6: random(15), law: random(30) },
            interim: random(20),
            noBreach: random(30),
            intakes: { rules: random(40), illegal: random(15), finding: random(12) },
            appeals: { kept: random(12), partly_reversed: random(5), reversed: random(14) },
            accountMeasures: { strike: random(14), suspend: random(4), retire_handle: random(11) },
          },
          moderator,
        );
        expect(await publish(tx, year, "first")).toBe(1);
        const [stored] = await editions(tx, year);
        TransparencyFigures.parse(stored!.figures);
        for (const { path, text } of stringsOf(stored!.figures)) {
          const isLabel = LABELS.has(path.split(".").at(-1)!);
          expect([path, isLabel || /^(0|1 to 9|about [1-9][0-9]*0|not recorded)$/.test(text)]).toEqual([path, true]);
        }
        // Every row of a table split by a label is 10 or more, but the folded row.
        for (const table of [stored!.figures.restrictions.byGround, stored!.figures.intakes, stored!.figures.appeals, stored!.figures.accountMeasures]) {
          for (const row of table) if (row.label !== "other") expect([row.label, named(row.count) >= 10]).toEqual([row.label, true]);
        }
      }
    });
  });

  test("edition_publish: version 1 with the system's audit row; a held order absent, then a version hold_ended that changes the order section alone; only a correction counts the tables again; nothing updates a version", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const { orders, spareIds } = await yearForTest(
        tx,
        YEAR,
        { restrictions: { R1: 20, R3: 4 }, spare: 15, orders: [{ posts: 1, receivedBefore: 10 }, { posts: 1, receivedBefore: 20, heldUntil: new Date(Date.now() + 30 * 86_400_000) }] },
        moderator,
      );
      expect(await publish(tx, YEAR, "first")).toBe(1);
      const [first] = await editions(tx, YEAR);
      expect({ reason: first!.reason, method: first!.method, same: first!.computed_at === first!.published_at }).toEqual({ reason: "first", method: TRANSPARENCY_RULES.method, same: true });
      expect(first!.figures.orders?.received).toEqual({ total: 1, crossBorder: 0 });
      const audit = await newestAudit(tx);
      expect(audit).toEqual({
        action: "edition_published",
        actor_id: SYSTEM_ACTOR_ID,
        target_type: "edition",
        target_id: `${YEAR}.1`,
        metadata: { year: YEAR, version: 1, reason: "first" },
        key_id: null,
        step_up: null,
      });
      // Asked again with nothing new: nothing.
      expect(await publish(tx, YEAR, "first")).toBeNull();

      // In between, more decisions of the year come to light (the spare restrictions move into it), and the held
      // order's hold ends and its notice is told.
      await tx.execute(sql`update public.decisions set decided_at = make_timestamptz(${YEAR}::int, 7, 7, 12, 0, 0, 'UTC') where id = any(${`{${spareIds.join(",")}}`}::uuid[])`);
      await tx.execute(sql`update public.legal_orders set hold_ended_at = clock_timestamp() where id = ${orders[1]!.id}::uuid`);
      const [told] = await tx.execute<{ n: number }>(sql`select public.order_notices_release() as n`);
      expect(told!.n).toBeGreaterThanOrEqual(1);

      expect(await publish(tx, YEAR, "first")).toBe(2);
      const [, second] = await editions(tx, YEAR);
      expect(second!.reason).toBe("hold_ended");
      const { orders: firstOrders, ...firstTables } = first!.figures;
      const { orders: secondOrders, ...secondTables } = second!.figures;
      expect(secondTables).toEqual(firstTables);
      expect(firstOrders?.received?.total).toBe(1);
      expect(secondOrders?.received).toEqual({ total: 2, crossBorder: 0 });
      expect((await newestAudit(tx)).metadata).toEqual({ year: YEAR, version: 2, reason: "hold_ended" });
      expect(await publish(tx, YEAR, "first")).toBeNull();

      // A version is never changed, by any role, the migrator included.
      expect(await refusal(tx.transaction((sp) => sp.execute(sql`update public.transparency_editions set figures = '{}'::jsonb where year = ${YEAR} and version = 1`)))).toBe("edition_frozen");
      expect(await refusal(tx.transaction((sp) => sp.execute(sql`update public.transparency_editions set reason = 'correction' where year = ${YEAR} and version = 2`)))).toBe("edition_frozen");

      // The migrator's correction counts every table again, as of the same due day: the spare restrictions now count.
      expect(await publish(tx, YEAR, "correction")).toBe(3);
      const [, , third] = await editions(tx, YEAR);
      expect(third!.reason).toBe("correction");
      expect(third!.figures.restrictions.total).toBe(band(39));
      expect(first!.figures.restrictions.total).toBe(band(24));
      expect(third!.figures.orders?.received).toEqual({ total: 2, crossBorder: 0 });
      // A reason the caller may not give.
      expect(await publish(tx, YEAR, "hold_ended")).toBe("invalid_edition");
    });
  });

  test("review M3: a year that ended before korbat's first account is no year korbat ran: edition_publish stores nothing for it, and from a year with an account it publishes as before", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      // As if korbat's first account dated from the running year: no account was created before 1 January of it.
      const start = sql`make_timestamptz(${NOW}::int, 1, 1, 0, 0, 1, 'UTC')`;
      await tx.execute(sql`update public.profiles set created_at = ${start} where created_at < ${start}`);
      const audits = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log`))[0]!.n;
      expect(await publish(tx, NOW - 1, "first")).toBeNull();
      expect(await publish(tx, 1999, "first")).toBeNull();
      expect(await editions(tx, NOW - 1)).toEqual([]);
      expect(await editions(tx, 1999)).toEqual([]);
      expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from public.audit_log`))[0]!.n).toBe(audits);
      // A year in which an account was created is one korbat ran: its first version is stored.
      await yearForTest(tx, YEAR, { restrictions: { R1: 12 } }, moderator);
      expect(await publish(tx, YEAR, "first")).toBe(1);
    });
  });

  test("review M4: a held order whose end is recorded later, with an instant before version 1, is counted by a version hold_ended: each version keeps the orders it counted, which the public read never returns", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const future = new Date(Date.now() + 30 * 86_400_000);
      const { orders } = await yearForTest(tx, YEAR, { restrictions: { R1: 12 }, orders: [{ posts: 1, receivedBefore: 10 }, { posts: 1, receivedBefore: 20, heldUntil: future }] }, moderator);
      const held = orders[1]!.id;
      expect(await publish(tx, YEAR, "first")).toBe(1);
      const [first] = await editions(tx, YEAR);
      expect(first!.figures.orders?.received?.total).toBe(1);
      // Later the authority's letter says the hold ended an hour before version 1 (staff.js order-hold-until <instant>
      // --release), and the notice is told: read again at version 1's instant, the order would now count there.
      await tx.execute(sql`update public.legal_orders set hold_ended_at = null, hold_end_reason = null, authority_hold_until = ${first!.computed_at}::timestamptz - interval '1 hour' where id = ${held}::uuid`);
      await tx.execute(sql`select public.order_notices_release()`);
      expect(await publish(tx, YEAR, "first")).toBe(2);
      const [, second] = await editions(tx, YEAR);
      expect(second!.reason).toBe("hold_ended");
      expect(second!.figures.orders?.received).toEqual({ total: 2, crossBorder: 0 });
      const counted = await tx.execute<{ version: number; held: boolean; n: number }>(
        sql`select version, ${held}::uuid = any(counted_orders) as held, cardinality(counted_orders) as n from public.transparency_editions where year = ${YEAR} order by version`,
      );
      expect(counted.map((row) => ({ ...row }))).toEqual([
        { version: 1, held: false, n: 1 },
        { version: 2, held: true, n: 2 },
      ]);
      expect(await publish(tx, YEAR, "first")).toBeNull();
    });
  });

  test("the API's role publishes a first version but may not correct one, and may not compute figures itself", async () => {
    await rolledBack(w.apiDb, async (tx) => {
      // 3d review M3: an account of the year, so it is a year korbat ran.
      await accountSince(tx, YEAR - 7);
      expect(await publish(tx, YEAR - 7, "correction")).toBe("invalid_edition");
      expect(await publish(tx, YEAR - 7, "hold_ended")).toBe("invalid_edition");
      expect(await publish(tx, YEAR - 7, "first")).toBe(1);
      expect(await refusal(tx.transaction((sp) => figuresOf(sp, YEAR - 7)))).toMatch(/^42501/);
      expect(await refusal(tx.transaction((sp) => sp.execute(sql`update public.transparency_editions set reason = 'first' where year = ${YEAR - 7}`)))).toMatch(/^42501/);
      expect(await refusal(tx.transaction((sp) => sp.execute(sql`delete from public.transparency_editions where year = ${YEAR - 7}`)))).toMatch(/^42501/);
    });
  });

  test("the recipients of every version of a year are the six stored months before its due day, whatever the version's instant", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const month = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
      const insert = (y: number, m: number, signedIn: number, signedOutDays: number | null) =>
        tx.execute(sql`insert into public.recipient_months (month, signed_in, signed_out_days, method) values (${month(y, m)}::date, ${signedIn}, ${signedOutDays}, 1)`);
      // September to February: 100 to 150 accounts, 200 to 250 readers summed by day.
      const window: [number, number][] = [[YEAR, 9], [YEAR, 10], [YEAR, 11], [YEAR, 12], [YEAR + 1, 1], [YEAR + 1, 2]];
      for (const [at, [y, m]] of window.entries()) {
        if (at === 5) continue;
        await insert(y, m, 100 + at * 10, 200 + at * 10);
      }
      // Five months: not recorded.
      expect((await figuresOf(tx, YEAR)).recipients).toBe("not recorded");
      // 3d review M3: an account of the year, so it is a year korbat ran.
      await accountSince(tx, YEAR);
      await insert(YEAR + 1, 2, 150, 250);
      // Months after the due day count for nothing in this edition.
      for (let m = 3; m <= 12; m++) await insert(YEAR + 1, m, 9000, 9000);
      expect((await figuresOf(tx, YEAR)).recipients).toEqual({ low: band(125), high: band(125 + 225) });
      expect(await publish(tx, YEAR, "first")).toBe(1);
      expect(await publish(tx, YEAR, "correction")).toBe(2);
      const stored = await editions(tx, YEAR);
      expect(stored.map((row) => row.figures.recipients)).toEqual([
        { low: "about 130", high: "about 350" },
        { low: "about 130", high: "about 350" },
      ]);
      // A month that did not count signed-out readers: one bound, "at least".
      await tx.execute(sql`delete from public.recipient_months where month = ${month(YEAR, 9)}::date`);
      await insert(YEAR, 9, 100, null);
      expect((await figuresOf(tx, YEAR)).recipients).toEqual({ low: band(125) });
      // The API's role reads months and inserts one; it updates and deletes none, and computed_at is forced.
      const [row] = await tx.execute<{ fresh: boolean }>(sql`select computed_at = now() as fresh from public.recipient_months where month = ${month(YEAR, 9)}::date`);
      expect(row!.fresh).toBe(true);
      expect(await refusal(tx.transaction((sp) => sp.execute(sql`update public.recipient_months set signed_in = 1 where month = ${month(YEAR, 9)}::date`)))).toBe("edition_frozen");
    });
  });

  test("an order received on 31 December and disabled under a hold on 1 January starts the second version of the year it was received in", async () => {
    await rolledBack(w.migrateDb, async (tx) => {
      const { orders } = await yearForTest(
        tx,
        YEAR,
        { restrictions: { R1: 10 }, orders: [{ posts: 1, receivedBefore: 60, disabledAt: new Date(Date.UTC(YEAR + 1, 0, 1, 0, 30)), heldUntil: new Date(Date.now() + 30 * 86_400_000) }] },
        moderator,
      );
      const [received] = await tx.execute<{ y: number }>(sql`select extract(year from received_at at time zone 'UTC')::int as y from public.legal_orders where id = ${orders[0]!.id}::uuid`);
      expect(received!.y).toBe(YEAR);
      expect(await publish(tx, YEAR, "first")).toBe(1);
      expect((await editions(tx, YEAR))[0]!.figures.orders).toBeUndefined();
      await tx.execute(sql`update public.legal_orders set hold_ended_at = clock_timestamp() where id = ${orders[0]!.id}::uuid`);
      await tx.execute(sql`select public.order_notices_release()`);
      expect(await publish(tx, YEAR, "first")).toBe(2);
      const [, second] = await editions(tx, YEAR);
      expect(second!.reason).toBe("hold_ended");
      // Received in the year; its one item was disabled in the next, so this year's section counts the order and no item.
      expect(second!.figures.orders?.received).toEqual({ total: 1, crossBorder: 0 });
      expect(second!.figures.orders?.itemsDisabled).toBe(0);
    });
  });

  test("transparency_rules() is TRANSPARENCY_RULES, band over 0 to 200 is the contracts' band, the reasons are EDITION_REASONS, and the grants are 6.4's", async () => {
    const [rules] = await w.apiDb.execute<{ floor: number; round_to: number; due_month: number; due_day: number; method: number }>(sql`select * from public.transparency_rules()`);
    expect({ floor: rules!.floor, roundTo: rules!.round_to, dueMonth: rules!.due_month, dueDay: rules!.due_day, method: rules!.method }).toEqual({ ...TRANSPARENCY_RULES });
    const bands = await w.apiDb.execute<{ n: number; b: string }>(sql`select g::int as n, public.band(g) as b from generate_series(0, 200) g order by g`);
    expect(bands).toHaveLength(201);
    for (const row of bands) expect([row.n, row.b]).toEqual([row.n, band(row.n)]);
    const [check] = await w.migrateDb.execute<{ def: string }>(sql`select pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = 'public.transparency_editions'::regclass and c.conname = 'transparency_editions_reason'`);
    expect([...check!.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1])).toEqual([...EDITION_REASONS]);
    const [rights] = await w.migrateDb.execute<Record<string, boolean>>(sql`
      select has_table_privilege('korbat_api', 'public.transparency_editions', 'SELECT') as editions_sel,
             has_table_privilege('korbat_api', 'public.transparency_editions', 'INSERT') as editions_ins,
             has_table_privilege('korbat_api', 'public.transparency_editions', 'UPDATE') as editions_upd,
             has_table_privilege('korbat_api', 'public.transparency_editions', 'DELETE') as editions_del,
             has_table_privilege('korbat_api', 'public.recipient_months', 'SELECT') as months_sel,
             has_column_privilege('korbat_api', 'public.recipient_months', 'signed_in', 'INSERT') as months_ins,
             has_column_privilege('korbat_api', 'public.recipient_months', 'computed_at', 'INSERT') as months_time,
             has_table_privilege('korbat_api', 'public.recipient_months', 'UPDATE') as months_upd,
             has_table_privilege('korbat_api', 'public.recipient_months', 'DELETE') as months_del,
             has_function_privilege('korbat_api', 'public.transparency_rules()', 'EXECUTE') as rules,
             has_function_privilege('korbat_api', 'public.band(bigint)', 'EXECUTE') as band,
             has_function_privilege('korbat_api', 'public.edition_publish(integer, text)', 'EXECUTE') as publish,
             has_function_privilege('korbat_api', 'public.transparency_figures(integer, timestamptz)', 'EXECUTE') as figures,
             has_function_privilege('korbat_api', 'public.transparency_orders(integer, timestamptz)', 'EXECUTE') as orders,
             has_function_privilege('korbat_api', 'public.transparency_order_ids(integer, timestamptz)', 'EXECUTE') as ids,
             has_function_privilege('korbat_api', 'public.transparency_order_held(uuid, timestamptz)', 'EXECUTE') as held,
             has_function_privilege('korbat_api', 'public.transparency_fold(jsonb)', 'EXECUTE') as fold`);
    expect({ ...rights }).toEqual({
      editions_sel: true,
      editions_ins: false,
      editions_upd: false,
      editions_del: false,
      months_sel: true,
      months_ins: true,
      months_time: false,
      months_upd: false,
      months_del: false,
      rules: true,
      band: true,
      publish: true,
      figures: false,
      orders: false,
      ids: false,
      held: false,
      fold: false,
    });
  });

  test("this file left no row behind", async () => {
    await removeFixtures(w.migrateDb, [moderator.id, admin.id]);
    expect(await rowCounts(w.apiDb)).toEqual(before);
  });
});

/** tco-counts' figures as the order section holds them: without the year and the issuing state. */
function withoutState(counts: TcoCounts): Record<string, unknown> {
  const { year: _year, received, ...rest } = counts;
  return { ...rest, received: received === null ? null : { total: received.total, crossBorder: received.crossBorder } };
}
