import { sql } from "drizzle-orm";
import { customType, pgPolicy, pgRole, timestamp, type PgRole } from "drizzle-orm/pg-core";

/** Roles are created by infra/postgres/init/01-roles.sh, not by migrations. */
export const apiRole = pgRole("korbat_api").existing();
export const authRole = pgRole("korbat_auth").existing();
/**
 * 3f: the contact point's watcher (apps/api/src/notify). The superuser creates it and gives it USAGE on the schema public
 * (01-roles.sh, scripts/test-db.mjs, the README's Upgrading), since a migration cannot; the migration that creates its
 * tables stops when either is missing.
 */
export const notifyRole = pgRole("korbat_notify").existing();

export const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Raw bytes, which drizzle's pg-core has no column for. postgres.js sends a Buffer as bytea and parses bytea back into
 * a Buffer; a driver that answers a plain Uint8Array is given a Buffer view of the same memory, so readers can rely on
 * Buffer's methods (equals, toString("base64url")).
 */
export const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
});

/**
 * A 64-bit transaction id (what pg_current_xact_id() answers), which drizzle's pg-core has no column for. It is handed
 * over as its decimal string, as postgres.js reads a type it does not know: a JavaScript number cannot hold every value.
 */
export const xid8 = customType<{ data: string; driverData: string }>({
  dataType() {
    return "xid8";
  },
});

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
