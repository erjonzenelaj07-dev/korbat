import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { GAP_CLASSES, GAP_DISPOSITIONS, ORDER_RULES, type GapClass } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { appendConfirmedAudit } from "../../src/moderation/repo";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import {
  RECOVERY_TABLES,
  aPost,
  act,
  decideIn,
  hex64,
  imagePost,
  newTestStaff,
  raised,
  refusal,
  report,
  rowCounts,
  staffProfile,
  type TestStaff,
} from "./moderation-fixtures";
import { SEAL_FOR_GOOD, SEAL_WHILE_DECIDING } from "./records-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 90_000 });

/**
 * The restore gaps (3f design, sections 6.6, 6.7 and 7.17; invariants 5, 21 and 24): the CHECKs hold the contracts'
 * lists; the API role reads the gaps and writes none, and inserts a copy mark's two columns alone, whose time the trigger
 * forces; gap_close closes a gap with the decision this transaction made by the acting account, when it fits the gap's
 * class and target, as reapplied, and refuses anything else (gap_mismatch), leaving the gap open; a gap closed as not
 * needed stands only with its confirmed audit row gap_closed on that gap, by an admin, refused at commit otherwise; and
 * delete_restore_gaps keeps every gap a decision closed, and the newest copy mark. The gaps are written as the import
 * writes them, as the migrator, and removed by their import's id; the decisions run in transactions that are rolled back,
 * but for the one real closing, whose rows the last test removes.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the restore gaps", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  let world: DeciderWorld;
  let real: RealStaff;
  let before: Record<string, number>;
  const imports: string[] = [];

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    world = deciderWorld(apiDb);
    // An admin with a real key, for the one closing that commits; its profile leaves with the world, after the last count.
    real = await world.staff("admin");
    before = await rowCounts(apiDb, RECOVERY_TABLES);
  }, 90_000);
  afterAll(async () => {
    await migrateDb.execute(sql`delete from public.restore_gaps where import_id = any(${`{${imports.join(",")}}`}::uuid[])`);
    await world.close();
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** A gap as the import writes it, as the migrator, committed: the class, the lost row's target and metadata. */
  async function gapOf(cls: GapClass, target: { type: string; id: string } | null = null, metadata: Record<string, unknown> = {}, actedAt = "2026-10-02T08:00:00.000Z"): Promise<string> {
    const importId = randomUUID();
    imports.push(importId);
    const [row] = await migrateDb.execute<{ id: string }>(sql`
      insert into public.restore_gaps (import_id, place, hash, action, target_type, target_id, metadata, acted_at, imported_at, class)
      values (${importId}::uuid, 7, ${hex64()}, 'case_decided', ${target?.type ?? null}, ${target?.id ?? null}, ${JSON.stringify(metadata)}::jsonb, ${actedAt}::timestamptz, now(), ${cls})
      returning id`);
    return row!.id;
  }
  const gapRow = async (q: Db | DbTx, id: string) =>
    (await q.execute<{ closed: boolean; closed_by: string | null; disposition: string | null }>(sql`select closed_at is not null as closed, closed_by, disposition from public.restore_gaps where id = ${id}::uuid`))[0]!;
  /** gap_close in a savepoint, so that a refusal leaves the test's transaction usable; answers the code or null. */
  const close = (tx: DbTx, gap: string, decision: string | null, staff: { id: string }) =>
    refusal(tx.transaction((sp) => sp.execute(sql`select public.gap_close(${gap}::uuid, ${decision}::uuid, ${staff.id}::uuid)`)));
  /** One test's world: a transaction of the API's pool that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>) =>
    rolledBack(apiDb, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  /** A reported post and a final removal of it by the moderator under R1: the plainest restriction. */
  async function removal(tx: DbTx): Promise<{ postId: string; caseId: string; decisionId: string }> {
    const p = await imagePost(tx, 0);
    const { caseId } = await report(tx, aPost(p.postId));
    return { postId: p.postId, caseId, decisionId: await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove")] }) };
  }

  test("the CHECKs are the contracts' lists; the API role reads the gaps and writes none, and inserts a copy mark's two columns, whose time the trigger forces", async () => {
    const definition = async (table: string, name: string) =>
      (await migrateDb.execute<{ def: string }>(sql`select pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = ${`public.${table}`}::regclass and c.conname = ${name}`))[0]!.def;
    const listed = (def: string) => [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(listed(await definition("restore_gaps", "restore_gaps_class"))).toEqual([...GAP_CLASSES]);
    expect(listed(await definition("restore_gaps", "restore_gaps_disposition"))).toEqual([...GAP_DISPOSITIONS]);
    const privileges = async (table: string) =>
      (await migrateDb.execute<{ p: string }>(sql`select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege('korbat_api', ${table}, p) order by p`)).map((r) => r.p);
    expect(await privileges("public.restore_gaps")).toEqual(["SELECT"]);
    expect(await privileges("public.copy_marks")).toEqual(["SELECT"]);
    const columns = await migrateDb.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'copy_marks' and has_column_privilege('korbat_api', 'public.copy_marks', column_name, 'INSERT') order by column_name`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(["place", "staff_id"]);
    for (const fn of ["public.gap_close(uuid, uuid, uuid)", "public.delete_restore_gaps(timestamptz)"]) {
      expect((await migrateDb.execute<{ ok: boolean }>(sql`select has_function_privilege('korbat_api', ${fn}, 'EXECUTE') as ok`))[0]!.ok, fn).toBe(true);
    }
    const gap = await gapOf("no_measure");
    await rolledBack(apiDb, async (tx) => {
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`update public.restore_gaps set closed_at = now(), disposition = 'not_needed' where id = ${gap}::uuid`))))?.code).toBe("42501");
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`delete from public.restore_gaps where id = ${gap}::uuid`))))?.code).toBe("42501");
      const [mark] = await tx.execute<{ fresh: boolean }>(sql`insert into public.copy_marks (staff_id, place) values (${mod.id}::uuid, 3) returning at > now() - interval '1 minute' as fresh`);
      expect(mark!.fresh).toBe(true);
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`insert into public.copy_marks (staff_id, place, at) values (${mod.id}::uuid, 3, now() - interval '9 days')`))))?.code).toBe("42501");
    });
    // The migrator's own time is forced too: a mark is the database's clock when it joined.
    await rolledBack(migrateDb, async (tx) => {
      const [mark] = await tx.execute<{ fresh: boolean }>(sql`insert into public.copy_marks (staff_id, place, at) values (${mod.id}::uuid, 3, now() - interval '9 days') returning at > now() - interval '1 minute' as fresh`);
      expect(mark!.fresh).toBe(true);
    });
  });

  test("a decision taken again closes the gap it fits, in its own transaction, as reapplied by that decision; a closed gap is refused", async () => {
    await inWorld(async (tx) => {
      const r = await removal(tx);
      const gap = await gapOf("restriction", { type: "case", id: r.caseId }, { target: { type: "post", id: r.postId } });
      expect(await close(tx, gap, r.decisionId, mod)).toBeNull();
      expect(await gapRow(tx, gap)).toEqual({ closed: true, closed_by: r.decisionId, disposition: "reapplied" });
      expect(await close(tx, gap, r.decisionId, mod)).toBe("gap_mismatch");
      // An unknown gap is not found.
      expect(await close(tx, randomUUID(), r.decisionId, mod)).toBe("not_found");
    });
  });

  test("gap_close refuses a decision that does not fit, and leaves the gap open: another class, another target, another account's, one this transaction did not make", async () => {
    await inWorld(async (tx) => {
      const r = await removal(tx);
      const other = await imagePost(tx, 0);
      for (const cls of ["order_effect", "seal_final", "seal_interim", "standing", "reversal", "record"] as const) {
        const gap = await gapOf(cls, { type: "case", id: r.caseId });
        expect(await close(tx, gap, r.decisionId, mod), cls).toBe("gap_mismatch");
        expect((await gapRow(tx, gap)).closed, cls).toBe(false);
      }
      const elsewhere = await gapOf("restriction", { type: "case", id: r.caseId }, { target: { type: "post", id: other.postId } });
      expect(await close(tx, elsewhere, r.decisionId, mod)).toBe("gap_mismatch");
      const fits = await gapOf("restriction", { type: "case", id: r.caseId }, { target: { type: "post", id: r.postId } });
      expect(await close(tx, fits, r.decisionId, admin)).toBe("gap_mismatch");
      // A decision of another transaction (committed before this one began) is no decision taken again here.
      const [old] = await tx.execute<{ id: string }>(sql`select id from public.decisions where id <> ${r.decisionId}::uuid order by decided_at limit 1`);
      if (old !== undefined) expect(await close(tx, fits, old.id, mod)).toBe("gap_mismatch");
      expect((await gapRow(tx, fits)).closed).toBe(false);
    });
  });

  test("each class's fit: a seal while deciding and for good, a reversal, a decision without a measure; a gap that names no target takes any", async () => {
    await inWorld(async (tx) => {
      // Seals, on posts reported on the path for child sexual abuse material.
      const sealDeciding = await imagePost(tx, 2);
      const deciding = await report(tx, aPost(sealDeciding.postId), "csam");
      const interim = await decideIn(tx, mod, deciding.caseId, SEAL_WHILE_DECIDING);
      const interimGap = await gapOf("seal_interim", null, { target: { type: "post", id: sealDeciding.postId } });
      expect(await close(tx, await gapOf("seal_final"), interim, mod)).toBe("gap_mismatch");
      expect(await close(tx, interimGap, interim, mod)).toBeNull();
      const forGood = await decideIn(tx, admin, deciding.caseId, SEAL_FOR_GOOD);
      expect(await close(tx, await gapOf("seal_interim"), forGood, admin)).toBe("gap_mismatch");
      expect(await close(tx, await gapOf("seal_final"), forGood, admin)).toBeNull();
      // A reversal: a correction that lifts a removal.
      const r = await removal(tx);
      const lifted = await decideIn(tx, admin, r.caseId, { kind: "correction", reviewsDecisionId: r.decisionId, actions: [act("restore")] });
      expect(await close(tx, await gapOf("restriction"), lifted, admin)).toBe("gap_mismatch");
      expect(await close(tx, await gapOf("reversal", null, { target: { type: "post", id: r.postId } }), lifted, admin)).toBeNull();
      // No measure: any decision of this transaction, here the removal itself.
      expect(await close(tx, await gapOf("no_measure"), r.decisionId, mod)).toBeNull();
    });
  });

  test("Not needed: only an admin, and only with its confirmed audit row gap_closed on that gap, which the commit checks; with it, it stands", async () => {
    const plain = async (staff: { id: string }, gap: string, audit: "none" | "plain" | "other") => {
      return refusal(
        apiDb.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          await tx.execute(sql`select public.gap_close(${gap}::uuid, null, ${staff.id}::uuid)`);
          if (audit !== "none") {
            await tx.execute(sql`insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
                                 values (${staff.id}::uuid, 'gap_closed', 'restore_gap', ${audit === "plain" ? gap : randomUUID()}, '{}'::jsonb)`);
          }
        }),
      );
    };
    const gap = await gapOf("no_measure");
    expect(await plain(mod, gap, "plain")).toBe("admin_required");
    for (const audit of ["none", "plain", "other"] as const) expect(await plain(admin, gap, audit), audit).toBe("gap_mismatch");
    expect((await gapRow(apiDb, gap)).closed).toBe(false);
    // With a real key: the module's own closing, its audit row confirmed by the admin's key on exactly this gap.
    const confirmed = await world.confirmAction(real, { action: "gap_closed", target: { type: "restore_gap", id: gap }, params: { disposition: "not_needed" } });
    const view = await world.moderation.forStaff.closeGap(real.session, confirmed, { requestId: `req-${randomUUID()}` });
    expect(typeof view).toBe("object");
    expect(await gapRow(apiDb, gap)).toEqual({ closed: true, closed_by: null, disposition: "not_needed" });
    const [audited] = await apiDb.execute<{ action: string; target: string; stepped: boolean }>(
      sql`select action, target_id as target, step_up is not null as stepped from public.audit_log where actor_id = ${real.id}::uuid order by chain_seq desc limit 1`,
    );
    expect(audited).toEqual({ action: "gap_closed", target: gap, stepped: true });
    // A second closing of the same gap is refused before anything is written.
    const again = await world.confirmAction(real, { action: "gap_closed", target: { type: "restore_gap", id: gap }, params: { disposition: "not_needed" } });
    expect(await refusal(world.moderation.forStaff.closeGap(real.session, again, { requestId: `req-${randomUUID()}` }))).toBe("gap_mismatch");
  });

  test("3f's review (proofs6): the commit's own check that the confirmed row is an admin's: gap_close naming an admin, with a moderator's confirmed row gap_closed on the gap, is refused at commit; with the admin's own, it stands", async () => {
    const gap = await gapOf("no_measure");
    /** The closing with a confirmed row of the signer's key, the commit's check run at once; rolled back either way. */
    const closing = async (named: TestStaff, signer: TestStaff): Promise<{ code: string; detail: string | null } | null> => {
      try {
        await apiDb.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          // gap_close checks the account it is given, here an admin, before it closes.
          await tx.execute(sql`select public.gap_close(${gap}::uuid, null, ${named.id}::uuid)`);
          await appendConfirmedAudit(tx, {
            actorId: signer.id,
            keyId: signer.keyId,
            action: "gap_closed",
            targetType: "restore_gap",
            targetId: gap,
            metadata: { disposition: "not_needed" },
            staffSession: randomUUID(),
            actionHash: hex64(),
            stepUp: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
            requestId: `req-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 10 * 60_000),
          });
          await tx.execute(sql`set constraints public.restore_gaps_confirmed immediate`);
          throw new Error("held");
        });
      } catch (err) {
        if (err instanceof Error && err.message === "held") return null;
        const found = raised(err);
        return found === null ? { code: String(err), detail: null } : { code: found.message, detail: found.detail };
      }
      return null;
    };
    // Another account than the one named, a moderator, signed the row: only the commit's check sees it.
    const refused = await closing(admin, mod);
    expect(refused?.code).toBe("gap_mismatch");
    expect(refused?.detail).toMatch(/^actor: /);
    expect(await closing(admin, admin)).toBeNull();
    expect((await gapRow(apiDb, gap)).closed).toBe(false);
  });

  test("delete_restore_gaps: a gap closed as not needed or imported goes 12 months on, a gap a decision closed never; the copy marks that old go, but the newest", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const months = ORDER_RULES.gapKeepMonths;
      const closedGap = async (disposition: "not_needed" | "imported" | "reapplied", monthsAgo: number) => {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into public.restore_gaps (import_id, place, hash, action, acted_at, imported_at, class, closed_at, closed_by, disposition)
          values (gen_random_uuid(), 9, ${hex64()}, 'case_decided', now(), now(), 'no_measure', now() - make_interval(months => ${monthsAgo}::int, days => 1),
                  ${disposition === "reapplied" ? sql`gen_random_uuid()` : sql`null`}, ${disposition})
          returning id`);
        return row!.id;
      };
      await tx.execute(sql`delete from public.copy_marks`);
      const oldNeeded = await closedGap("not_needed", months);
      const oldImported = await closedGap("imported", months);
      const oldReapplied = await closedGap("reapplied", months * 3);
      const young = await closedGap("imported", months - 1);
      await tx.execute(sql`insert into public.copy_marks (staff_id, place) values (${mod.id}::uuid, 3), (${mod.id}::uuid, 5)`);
      await tx.execute(sql`update public.copy_marks set at = now() - make_interval(months => ${months + 2}::int) where place = 3`);
      await tx.execute(sql`update public.copy_marks set at = now() - make_interval(months => ${months + 1}::int) where place = 5`);
      // Not before its period: a cut-off younger than gap_keep_months is refused.
      expect(await refusal(tx.transaction((sp) => sp.execute(sql`select public.delete_restore_gaps(now() - make_interval(months => ${months - 1}::int))`)))).toBe("not_due");
      const [done] = await tx.execute<{ n: number }>(sql`select public.delete_restore_gaps(now() - make_interval(months => ${months}::int)) as n`);
      expect(done!.n).toBe(3);
      const left = (await tx.execute<{ id: string }>(sql`select id from public.restore_gaps where id = any(${`{${[oldNeeded, oldImported, oldReapplied, young].join(",")}}`}::uuid[])`)).map((r) => r.id).sort();
      expect(left).toEqual([oldReapplied, young].sort());
      expect((await tx.execute<{ place: number }>(sql`select place::int from public.copy_marks`)).map((r) => r.place)).toEqual([5]);
    });
  });

  test("leaves no row behind", async () => {
    await migrateDb.execute(sql`delete from public.restore_gaps where import_id = any(${`{${imports.join(",")}}`}::uuid[])`);
    // The real closing's audit row stays, as every audit row does; its staff account goes with the world.
    expect(await rowCounts(apiDb, RECOVERY_TABLES)).toEqual(before);
  });
});
