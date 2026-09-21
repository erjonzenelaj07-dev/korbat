import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { closeDb, createDb } from "@korbat/db";
import { assertTestTargets, loadTestEnv } from "./test-env";

/**
 * Runs once before the integration suites. Every run starts from an empty test database and an
 * empty Redis database, so suites never depend on what an earlier run left behind.
 */
export default async function setup(): Promise<void> {
  const env = loadTestEnv();
  assertTestTargets(env);

  const redis = new Redis(env.REDIS_URL!, { maxRetriesPerRequest: 2 });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }

  // The migrate role owns every table, so it may truncate them. Names come from the catalog, quoted.
  const db = createDb(env.DATABASE_URL_MIGRATE!, { max: 1 });
  try {
    const tables = await db.execute<{ name: string }>(
      sql`select quote_ident(schemaname) || '.' || quote_ident(tablename) as name from pg_tables where schemaname in ('public', 'auth') order by 1`,
    );
    if (tables.length === 0) throw new Error("The test database has no tables. Run `node scripts/test-db.mjs`.");
    await db.execute(sql.raw(`truncate table ${tables.map((table) => table.name).join(", ")} restart identity cascade`));
  } finally {
    await closeDb(db);
  }
}
