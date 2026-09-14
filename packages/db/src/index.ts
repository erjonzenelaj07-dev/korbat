import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export * from "./schema/index";
export { schema };

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return drizzle(client, { schema });
}

export async function ping(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}
