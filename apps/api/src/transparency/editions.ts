import type { Logger } from "pino";
import type { PublicTransparency } from "@korbat/contracts";
import type { EditionRow, TransparencyRepo } from "./repo";

/**
 * The yearly edition (3d design, sections 2 rows 2 to 5, 6.4 and 7.6). Once a day, after the dispatch hour, the
 * transparency job asks edition_publish(year, 'first') for the last closed year and for every earlier year that has an
 * edition; the database decides, under an advisory lock on the year, whether to write version 1 (once the year is due on
 * 1 March of the next one), a version hold_ended (an order whose hold ended since), or nothing. Each call is idempotent
 * by the table's key, so a round that asks again writes nothing; a correction is the command line's alone.
 */

/** What one daily pass wrote: each year with the version stored, and the years asked. */
export interface EditionPass {
  asked: number[];
  published: { year: number; version: number }[];
}

export async function publishEditions(deps: { repo: Pick<TransparencyRepo, "publish" | "yearsWithEdition">; log: Logger }, now: Date): Promise<EditionPass> {
  const last = now.getUTCFullYear() - 1;
  const asked = [last, ...(await deps.repo.yearsWithEdition(last))];
  const published: EditionPass["published"] = [];
  for (const year of asked) {
    const version = await deps.repo.publish(year);
    if (version !== null) {
      published.push({ year, version });
      deps.log.info({ job: "transparency", year, version }, "transparency: an edition was published");
    }
  }
  return { asked, published };
}

/** A day as the public pages print it, in UTC. */
const dayOf = (at: Date) => at.toISOString().slice(0, 10);

/**
 * GET /api/public/transparency's answer (10.6): every year's newest version, newest year first, with the older versions of
 * that year, oldest first, each with the day the next version replaced it. The rows come newest year and version first.
 */
export function publicTransparency(rows: readonly EditionRow[]): PublicTransparency {
  const byYear = new Map<number, EditionRow[]>();
  for (const row of rows) byYear.set(row.year, [...(byYear.get(row.year) ?? []), row]);
  return {
    editions: [...byYear.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, versions]) => {
        const sorted = [...versions].sort((a, b) => a.version - b.version);
        const newest = sorted.at(-1)!;
        return {
          year,
          version: newest.version,
          publishedOn: dayOf(newest.publishedAt),
          method: newest.method,
          reason: newest.reason,
          figures: newest.figures,
          older: sorted.slice(0, -1).map((older, at) => ({
            version: older.version,
            publishedOn: dayOf(older.publishedAt),
            replacedOn: dayOf(sorted[at + 1]!.publishedAt),
            reason: older.reason,
            figures: older.figures,
          })),
        };
      }),
  };
}
