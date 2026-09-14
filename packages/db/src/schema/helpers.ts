import { sql } from "drizzle-orm";
import { pgPolicy, pgRole, timestamp, type PgRole } from "drizzle-orm/pg-core";

/** Roles are created by infra/postgres/init/01-roles.sh, not by migrations. */
export const apiRole = pgRole("korbat_api").existing();
export const authRole = pgRole("korbat_auth").existing();

export const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Foundation policy: the given role may touch every row of the table.
 * Sub-projects replace this per table with owner-scoped policies as the
 * routes that need them are built. RLS being ON from day one means adding a
 * tighter policy later is a migration, not a redesign.
 */
export function fullAccess(name: string, role: PgRole) {
  return pgPolicy(name, { for: "all", to: role, using: sql`true`, withCheck: sql`true` });
}

export const emptyTextArray = sql`'{}'::text[]`;
