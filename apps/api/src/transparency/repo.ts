import { desc, eq, lt, sql } from "drizzle-orm";
import { ALERT_KINDS, HEAD_RULES, type EditionReason, type HeadKind, type HeadWitness, type TransparencyFigures } from "@korbat/contracts";
import { recipientMonths, transparencyEditions, type Db } from "@korbat/db";
import type { HeadDayRow, HeadToday } from "./head";

/**
 * The transparency module's statements (3d design, sections 6.4, 6.5, 7.5, 7.6 and 7.7). It names the three tables of
 * public record and nothing of a person (the architecture test holds every file of the module to the names of
 * schema/transparency.ts and the audit head): the editions it reads and has edition_publish() write, the months it reads
 * and inserts, and the head's daily rows, whose every forced column the database writes. Raw SQL reaches two tables of
 * other modules, as media/repo.ts reaches the outbox: alert_outbox, for the job's own two alerts, and audit_log's hash at
 * one place, for the keeper's mail when the head has moved on since the day's row was written.
 */

/** One stored version of a year's edition, as the public route reads it. */
export interface EditionRow {
  year: number;
  version: number;
  publishedAt: Date;
  method: number;
  reason: EditionReason;
  figures: TransparencyFigures;
}

/** One month of the recipients' count. */
export interface MonthRow {
  month: string;
  signedIn: number;
  signedOutDays: number | null;
  method: number;
}

/** How long a statement of the job waits for a lock: the job's other rounds are minutes away. */
const LOCK_TIMEOUT = sql`set local lock_timeout = '10s'`;

/** The database's UTC day, which the head's insert trigger stamps on the day's row. */
const TODAY = sql`(now() at time zone 'UTC')::date`;

export function createTransparencyRepo(apiDb: Db) {
  return {
    /** Every stored version of every year, newest year first and, inside a year, newest version first. */
    async editions(): Promise<EditionRow[]> {
      const rows = await apiDb
        .select({
          year: transparencyEditions.year,
          version: transparencyEditions.version,
          publishedAt: transparencyEditions.publishedAt,
          method: transparencyEditions.method,
          reason: transparencyEditions.reason,
          figures: transparencyEditions.figures,
        })
        .from(transparencyEditions)
        .orderBy(desc(transparencyEditions.year), desc(transparencyEditions.version));
      return rows.map((row) => ({ ...row, reason: row.reason as EditionReason, figures: row.figures as TransparencyFigures }));
    },

    /** The years before `before` that have an edition: a hold that ends after its year closed still gives it a version. */
    async yearsWithEdition(before: number): Promise<number[]> {
      const rows = await apiDb
        .selectDistinct({ year: transparencyEditions.year })
        .from(transparencyEditions)
        .where(lt(transparencyEditions.year, before))
        .orderBy(desc(transparencyEditions.year));
      return rows.map((row) => row.year);
    },

    /**
     * edition_publish(year, 'first') in a transaction of its own, since its audit row holds the chain's head until the
     * commit: the version it wrote, or null when nothing was due or new. The function decides; the job only asks.
     */
    publish(year: number): Promise<number | null> {
      return apiDb.transaction(async (tx) => {
        await tx.execute(LOCK_TIMEOUT);
        const [row] = await tx.execute<{ version: number | null }>(sql`select public.edition_publish(${year}::int, 'first') as version`);
        return row?.version ?? null;
      });
    },

    /** Whether a month (yyyy-mm) is stored already. */
    async monthStored(month: string): Promise<boolean> {
      const [row] = await apiDb.select({ month: recipientMonths.month }).from(recipientMonths).where(eq(recipientMonths.month, `${month}-01`)).limit(1);
      return row !== undefined;
    },

    /**
     * 7.7 step 2: the day's head row, inserted once (on conflict, nothing) with the witness's name and nothing else, since
     * the trigger forces the rest from audit_head; then the day's row as it stands, in the same transaction, so both read
     * the database's today at one instant.
     */
    headInsert(witness: HeadWitness): Promise<HeadToday> {
      return apiDb.transaction(async (tx) => {
        await tx.execute(LOCK_TIMEOUT);
        const inserted = await tx.execute(sql`insert into public.head_publications (witness) values (${witness}) on conflict (day, kind) do nothing returning 1`);
        const [row] = await tx.execute<{ day: string; value: string; witness: HeadWitness; witnessed: boolean; published: boolean; mailed: boolean }>(sql`
          select to_char(h.day, 'YYYY-MM-DD') as day, h.value, h.witness, h.token is not null as witnessed, h.published_at is not null as published,
                 h.keeper_mailed_at is not null as mailed
            from public.head_publications h where h.day = ${TODAY} and h.kind = 'head'`);
        return { inserted: inserted.length > 0, ...row! };
      });
    },

    /** 7.7 step 3: the witness's token, set from null alone (the guard refuses a second); false when the row had one. */
    async headWitnessed(day: string, token: Uint8Array): Promise<boolean> {
      const rows = await apiDb.execute(sql`
        update public.head_publications set token = ${Buffer.from(token)}, witnessed_at = now()
         where day = ${day}::date and kind = 'head' and token is null returning 1`);
      return rows.length > 0;
    },

    /** 7.7 step 4: published, from null, once: whether a token is stored, or null when an earlier round published it. */
    async headPublish(day: string): Promise<{ witnessed: boolean } | null> {
      const [row] = await apiDb.execute<{ witnessed: boolean }>(sql`
        update public.head_publications set published_at = now()
         where day = ${day}::date and kind = 'head' and published_at is null returning token is not null as witnessed`);
      return row ?? null;
    },

    /**
     * 7.7 step 5: the place the day's value was computed from and that place's hash, read from the head while it still
     * stands there or from the audit log's row of that place, and only when head_value() of the day, the place and the
     * hash gives the stored value; null otherwise, and then the keeper is not mailed.
     */
    async headPlace(day: string): Promise<{ seq: number; hash: string } | null> {
      const [row] = await apiDb.execute<{ seq: number; hash: string; fits: boolean }>(sql`
        select h.chain_seq::int as seq, x.hash, public.head_value(h.day, h.chain_seq, x.hash) = h.value as fits
          from public.head_publications h
          cross join lateral (
            select a.hash from public.audit_head a where a.id = 1 and a.seq = h.chain_seq
            union all
            select l.hash from public.audit_log l where l.chain_seq = h.chain_seq
            limit 1) x
         where h.day = ${day}::date and h.kind = 'head'`);
      return row?.fits ? { seq: row.seq, hash: row.hash } : null;
    },

    /** 3d review M13: the relay accepted the keeper's mail of the day's value: keeper_mailed_at, from null alone (the guard forces the time). */
    async headMailed(day: string): Promise<void> {
      await apiDb.execute(sql`update public.head_publications set keeper_mailed_at = now() where day = ${day}::date and kind = 'head' and keeper_mailed_at is null`);
    },

    /** 3d review M13: the day before the database's today, when its value was published and its keeper's mail never accepted; null otherwise. */
    async headUnmailed(): Promise<string | null> {
      const [row] = await apiDb.execute<{ day: string }>(sql`
        select to_char(h.day, 'YYYY-MM-DD') as day from public.head_publications h
         where h.kind = 'head' and h.day = ${TODAY} - 1 and h.published_at is not null and h.keeper_mailed_at is null`);
      return row?.day ?? null;
    },

    /**
     * 7.7 step 6: the day before the database's today, when it has no published head value while an earlier day has a
     * row; null otherwise. On the head's first day nothing is missed: no earlier day ever had a value.
     */
    async headMissed(): Promise<string | null> {
      const [row] = await apiDb.execute<{ day: string }>(sql`
        select to_char(${TODAY} - 1, 'YYYY-MM-DD') as day
         where not exists (select 1 from public.head_publications h where h.kind = 'head' and h.day = ${TODAY} - 1 and h.published_at is not null)
           and exists (select 1 from public.head_publications h where h.kind = 'head' and h.day < ${TODAY} - 1)`);
      return row?.day ?? null;
    },

    /**
     * The job's own alert head_unwitnessed or head_missed (7.14, "Alerts a job writes"): one row of the outbox with its
     * kind's priority and scope and its one fact, the day's first instant, under F's daily rule: none while a row of the
     * kind was written in the last 24 hours. F's two legs push and mail it. Answers whether it wrote one.
     */
    async headAlert(kind: "head_unwitnessed" | "head_missed" | "head_unmailed", day: string): Promise<boolean> {
      const entry = ALERT_KINDS[kind];
      const written = await apiDb.execute(sql`
        insert into public.alert_outbox (kind, priority, scope, facts)
        select ${kind}, ${entry.priority}, ${entry.scope}, ${JSON.stringify({ day: `${day}T00:00:00.000Z` })}::jsonb
         where not exists (select 1 from public.alert_outbox o where o.kind = ${kind} and o.created_at > now() - make_interval(hours => 24))
        returning id`);
      return written.length > 0;
    },

    /**
     * GET /api/public/head's rows (10.6): the published rows of the last HEAD_RULES.shownDays days, today's included, newest
     * day first and, within a day, the latest published first. The place is not read.
     */
    async headDays(): Promise<HeadDayRow[]> {
      const rows = await apiDb.execute<{ day: string; kind: HeadKind; value: string; witness: HeadWitness; token: Buffer | null; retired_on: string | null; last_day: string | null }>(sql`
        select to_char(h.day, 'YYYY-MM-DD') as day, h.kind, h.value, h.witness, h.token,
               to_char(h.retired_at at time zone 'UTC', 'YYYY-MM-DD') as retired_on, to_char(h.last_day, 'YYYY-MM-DD') as last_day
          from public.head_publications h
         where h.published_at is not null and h.day > ${TODAY} - ${HEAD_RULES.shownDays}::int
         order by h.day desc, h.published_at desc`);
      return rows.map((row) => ({ day: row.day, kind: row.kind, value: row.value, witness: row.witness, token: row.token, retiredOn: row.retired_on, lastDay: row.last_day }));
    },

    /** Stores a month's two numbers once; false when another round stored it first. computed_at is the database's. */
    async storeMonth(month: MonthRow): Promise<boolean> {
      // The API's role may insert these four columns and no other: the insert trigger forces computed_at.
      const rows = await apiDb.execute<{ month: string }>(sql`
        insert into public.recipient_months (month, signed_in, signed_out_days, method)
        values (${`${month.month}-01`}::date, ${month.signedIn}::int, ${month.signedOutDays}::int, ${month.method}::smallint)
        on conflict (month) do nothing returning month::text`);
      return rows.length > 0;
    },
  };
}

export type TransparencyRepo = ReturnType<typeof createTransparencyRepo>;
