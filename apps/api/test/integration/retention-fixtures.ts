import { sql, type SQL } from "drizzle-orm";
import type { Runner } from "./moderation-fixtures";

/**
 * The clock, moved for the tests of retention (3c design, sections 6.4, 6.6 and 7.9). Every due rule compares stored
 * times with the database's now(), which no test can move; so a test dates the rows back instead, as the migrator, the
 * one role that may write those columns: a case that closed "seven months ago" is a case whose every time lies seven
 * months back. A test that does this runs inside a transaction that is rolled back, or removes its rows afterwards.
 */

/** One row of a query, for the reads these tests make of single values. */
export async function one<T extends Record<string, unknown>>(db: Runner, query: SQL): Promise<T> {
  const [row] = await db.execute<T>(query);
  if (!row) throw new Error("the query answered no row");
  return { ...row } as T;
}

/**
 * Moves a case into the past by `ago` (a PostgreSQL interval, such as "25 hours" or "7 months"): its own times, those of
 * its items, decisions, measures, snapshots, texts, holds and access rows, and those of the appeals of its decisions. The
 * order of all of them is kept, so the case reads as the same case, only older.
 */
export async function ageCase(db: Runner, caseId: string, ago: string): Promise<void> {
  const i = sql`${ago}::interval`;
  const decisionsOf = sql`(select d.id from decisions d where d.case_id = ${caseId}::uuid)`;
  await db.execute(sql`update cases set opened_at = opened_at - ${i}, oldest_open_at = oldest_open_at - ${i}, last_decided_at = last_decided_at - ${i}, closed_at = closed_at - ${i} where id = ${caseId}::uuid`);
  await db.execute(sql`update intake_items set created_at = created_at - ${i}, outcome_sent_at = outcome_sent_at - ${i}, revision_pending_at = revision_pending_at - ${i}, revised_sent_at = revised_sent_at - ${i} where case_id = ${caseId}::uuid`);
  await db.execute(sql`update decisions set decided_at = decided_at - ${i}, informed_at = informed_at - ${i}, author_mail_at = author_mail_at - ${i}, redacted_at = redacted_at - ${i} where case_id = ${caseId}::uuid`);
  await db.execute(sql`update decision_actions set created_at = created_at - ${i} where decision_id in ${decisionsOf}`);
  await db.execute(sql`update appeals set filed_at = filed_at - ${i}, answered_at = answered_at - ${i} where decision_id in ${decisionsOf}`);
  await db.execute(sql`update evidence_snapshots set taken_at = taken_at - ${i} where case_id = ${caseId}::uuid`);
  await db.execute(sql`update staff_texts set created_at = created_at - ${i}, confirmed_at = confirmed_at - ${i} where case_id = ${caseId}::uuid`);
  await db.execute(sql`update media_holds set held_at = held_at - ${i} where case_id = ${caseId}::uuid`);
  await db.execute(sql`update case_access_log set at = at - ${i} where case_id = ${caseId}::uuid`);
}

/** Moves an intake into the past by `ago`: when it was received, and the times of its items wherever they are. */
export async function ageIntake(db: Runner, intakeId: string, ago: string): Promise<void> {
  const i = sql`${ago}::interval`;
  await db.execute(sql`update intakes set received_at = received_at - ${i}, receipt_sent_at = receipt_sent_at - ${i} where id = ${intakeId}::uuid`);
  await db.execute(sql`update intake_items set created_at = created_at - ${i}, outcome_sent_at = outcome_sent_at - ${i}, revision_pending_at = revision_pending_at - ${i}, revised_sent_at = revised_sent_at - ${i} where intake_id = ${intakeId}::uuid`);
}

/**
 * Releases an intake's answered items as the daily release does, without running it: each gets its outcome shown, now,
 * and its mail recorded as sent. The release itself is tested where it is defined; here a test only needs its result.
 */
export async function releaseItems(db: Runner, intakeId: string): Promise<void> {
  await db.execute(sql`update intake_items set outcome_sent_at = now(), shown_outcome = outcome, outcome_mail = case when outcome_mail = 'pending' then 'sent'::delivery_state else outcome_mail end
                        where intake_id = ${intakeId}::uuid and outcome is not null and outcome_sent_at is null`);
}

/** When a case's evidence is due: whether the rule answers a time at all, and whether that time has come. */
export async function evidenceDue(db: Runner, caseId: string): Promise<"never" | "later" | "due"> {
  const row = await one<{ at: string | null; due: boolean | null }>(db, sql`select public.case_evidence_due_at(${caseId}::uuid)::text as at, public.case_evidence_due_at(${caseId}::uuid) <= now() as due`);
  return row.at === null ? "never" : row.due ? "due" : "later";
}

/** The same for an intake's record. */
export async function intakeDue(db: Runner, intakeId: string): Promise<"never" | "later" | "due"> {
  const row = await one<{ at: string | null; due: boolean | null }>(db, sql`select public.intake_due_at(${intakeId}::uuid)::text as at, public.intake_due_at(${intakeId}::uuid) <= now() as due`);
  return row.at === null ? "never" : row.due ? "due" : "later";
}

/** What a case still holds of its evidence: unerased snapshots, unerased notes and drafts, appeal statements and unreleased holds. */
export async function evidenceLeft(db: Runner, caseId: string): Promise<{ snapshots: number; texts: number; statements: number; holds: number }> {
  return one(db, sql`
    select (select count(*)::int from evidence_snapshots s where s.case_id = ${caseId}::uuid and s.erased_at is null) as snapshots,
           (select count(*)::int from staff_texts t where t.case_id = ${caseId}::uuid and t.confirmed_at is null and t.erased_at is null) as texts,
           (select count(*)::int from appeals a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid and a.statement is not null) as statements,
           (select count(*)::int from media_holds h where h.case_id = ${caseId}::uuid and h.released_at is null) as holds`);
}

/** An account's row in the auth schema, for a profile a test made: live, or marked deleted that long ago. Only the migrator can write it there. */
export async function authAccount(db: Runner, id: string, deletedAgo: string | null = null): Promise<void> {
  await db.execute(sql`insert into auth.users (id, email, deleted_at) values (${id}::uuid, ${`retention-${id}@korbat.local`}, ${deletedAgo === null ? sql`null` : sql`now() - ${deletedAgo}::interval`})`);
}
