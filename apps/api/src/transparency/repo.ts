import { desc, eq, lt, sql } from "drizzle-orm";
import type { EditionReason, TransparencyFigures } from "@korbat/contracts";
import { recipientMonths, transparencyEditions, type Db } from "@korbat/db";

/**
 * The transparency module's statements (3d design, sections 6.4, 7.5 and 7.6). It names the two tables of public record
 * and nothing of a person (the architecture test holds every file of the module to the names of schema/transparency.ts
 * and the audit head): the editions it reads and has edition_publish() write, and the months it reads and inserts.
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
