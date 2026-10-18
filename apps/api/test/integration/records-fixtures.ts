import { sql } from "drizzle-orm";
import type { Db, DbTx } from "@korbat/db";
import { act, aPost, decideIn, imagePost, report, uuids, type DecisionInput, type TestStaff } from "./moderation-fixtures";

/**
 * 3f Task 5: fixtures of the records to authorities (3f design, sections 6.5, 7.13 to 7.15). The three record tables and
 * auth.report_holds are the migrator's alone: the API role holds no grant on them, so every read and count here is
 * made as the migrator, and every cleanup too.
 */

/** The tables of the records to authorities, schema-qualified, which a suite that writes them counts before and after. */
export const RECORD_TABLES = ["public.authority_notifications", "public.authority_notification_events", "public.productions", "auth.report_holds"] as const;

/** How many rows each record table holds, read as the migrator (the API role cannot count them). */
export async function recordCounts(migrateDb: Db | DbTx): Promise<Record<string, number>> {
  const columns = RECORD_TABLES.map((table) => `(select count(*)::int from ${table}) as "${table}"`).join(", ");
  const [row] = await migrateDb.execute<Record<string, number>>(sql.raw(`select ${columns}`));
  return { ...row! };
}

/** A seal taken while deciding, and a seal for good, as the seal tests take them. */
export const SEAL_WHILE_DECIDING: DecisionInput = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] };
export const SEAL_FOR_GOOD: DecisionInput = { kind: "final", ruleId: "R2", actions: [act("seal_media")] };
/** The admin's answer without a seal. */
export const NO_SEAL: DecisionInput = { kind: "final", outcome: "no_violation" };

/** A post of the author (a new profile unless one is given) with images, reported on the path for child sexual abuse material. */
export async function suspectPost(tx: DbTx | Db, images = 2, authorId?: string): Promise<{ authorId: string; postId: string; mediaIds: string[]; caseId: string }> {
  const p = await imagePost(tx, images, authorId);
  const { caseId } = await report(tx, aPost(p.postId), "csam");
  return { ...p, caseId };
}

/** The same with a seal on it: taken while deciding by the moderator, or for good by the admin. Answers the seal's ledger row too. */
export async function sealedPost(
  tx: DbTx,
  staff: TestStaff,
  how: "deciding" | "final",
  authorId?: string,
): Promise<{ authorId: string; postId: string; mediaIds: string[]; caseId: string; decisionId: string; sealActionId: string }> {
  const p = await suspectPost(tx, 2, authorId);
  const decisionId = await decideIn(tx, staff, p.caseId, how === "deciding" ? SEAL_WHILE_DECIDING : SEAL_FOR_GOOD);
  return { ...p, decisionId, sealActionId: await sealActionOf(tx, decisionId) };
}

/** The seal_media row of a decision. */
export async function sealActionOf(q: DbTx | Db, decisionId: string): Promise<string> {
  const [row] = await q.execute<{ id: string }>(sql`select id from decision_actions where decision_id = ${decisionId}::uuid and kind::text = 'seal_media'`);
  return row!.id;
}

export interface RecordRow {
  id: string;
  state: string;
  duties: string[];
  case_id: string | null;
  seal_action_id: string | null;
  account_id: string | null;
  opened_at: string;
  opened_via: string;
  first_report_at: string | null;
  admin_answer_at: string | null;
  declined_reason: string | null;
  closed_at: string | null;
  sent_at: string | null;
  answer: string | null;
}

/** The notification records of an account, oldest first, as the migrator reads them (times as text). */
export async function recordsOf(q: DbTx | Db, accountId: string): Promise<RecordRow[]> {
  return (await q.execute<RecordRow & Record<string, unknown>>(
    sql`select id, state, duties, case_id, seal_action_id, account_id, opened_at::text, opened_via, first_report_at::text, admin_answer_at::text,
               declined_reason, closed_at::text, sent_at::text, answer
          from public.authority_notifications where account_id = ${accountId}::uuid order by opened_at, id`,
  )).map((row) => ({ ...row }));
}

export interface HoldRow {
  set_at: string;
  seal_final: boolean;
  released_at: string | null;
  release_reason: string | null;
}

/** The account's row of auth.report_holds, or null. */
export async function holdOf(q: DbTx | Db, accountId: string): Promise<HoldRow | null> {
  const [row] = await q.execute<HoldRow & Record<string, unknown>>(
    sql`select set_at::text, seal_final, released_at::text, release_reason from auth.report_holds where user_id = ${accountId}::uuid`,
  );
  return row ? { ...row } : null;
}

/** What the auth module reads of the hold: until when (as text, or null), and whether the seal behind it is for good. */
export async function heldFor(q: DbTx | Db, accountId: string): Promise<{ until: string | null; held: boolean; final: boolean }> {
  const [row] = await q.execute<{ until: string | null; held: boolean; final: boolean }>(
    sql`select auth.address_held_until(${accountId}::uuid)::text as until, auth.address_held(${accountId}::uuid) as held, auth.address_hold_final(${accountId}::uuid) as final`,
  );
  return { ...row! };
}

/** Moves an account's hold back by the interval, as the migrator, so that its seven days pass without waiting. */
export async function ageHoldForTest(q: DbTx | Db, accountId: string, interval: string): Promise<void> {
  await q.execute(sql`update auth.report_holds set set_at = set_at - ${interval}::interval where user_id = ${accountId}::uuid`);
}

/**
 * Removes, as the migrator, the records to authorities of these accounts and of these cases: their notification records
 * with their events, their productions and their holds. The records hold no foreign key to a case or an account, so a
 * suite's own cleanup of its cases leaves them standing unless it calls this.
 */
export async function removeRecords(migrateDb: Db | DbTx, accountIds: readonly string[], caseIds: readonly string[] = []): Promise<void> {
  const run = async (tx: Db | DbTx) => {
    await tx.execute(sql`delete from public.authority_notifications where account_id = any(${uuids(accountIds)}) or case_id = any(${uuids(caseIds)})`);
    await tx.execute(sql`delete from public.productions where account_id = any(${uuids(accountIds)})`);
    await tx.execute(sql`delete from auth.report_holds where user_id = any(${uuids(accountIds)})`);
  };
  await run(migrateDb);
}
