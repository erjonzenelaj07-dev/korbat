# korbat Foundation — Task 7 of 16: `@korbat/db` client, drizzle-kit config, migrations

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform with a self-owned backend: a TypeScript API (Hono + Drizzle ORM) is the only client of our own Postgres 16. Three database roles enforce least privilege:

- `korbat_migrate` runs migrations and owns every object.
- `korbat_api` reads and writes the `public` schema (profiles, posts, moderation) and must have no access to `auth`.
- `korbat_auth` reads and writes the `auth` schema (users, sessions, credentials) and must have no access to `public`.

The roles themselves are created by a Postgres init script (Task 8), because creating login roles needs a superuser. Everything else about privileges is a migration so it is versioned with the schema. This task adds the runtime client (`createDb`, `ping`, `closeDb`), the migrator, the drizzle-kit config, the generated initial migration for all 20 tables (Tasks 4 to 6) with RLS and policies, and a hand-written `0001_grants` migration that wires up schema access, default privileges for future tables, and makes `audit_log` append-only at the grant level.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed: `drizzle-kit generate` works offline from the TypeScript schema; nothing connects to a database in this task.
- Pinned: drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9.
- drizzle-kit notes: `generate` writes `migrations/NNNN_<random-words>.sql` and a `migrations/meta/` folder (both are committed). `generate --custom --name=<name>` creates an empty SQL file to fill by hand. `schemaFilter` lists the schemas to manage. The migrator `migrate()` from `drizzle-orm/postgres-js/migrator` records applied files in a `drizzle.__drizzle_migrations` table.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 7).

## Preconditions

`git log --oneline -1` must show `feat(db): trust and safety tables, append-only audit log`. `pnpm --filter @korbat/db test` must pass with 9 tests. If `packages/db/migrations/` already exists, verify the files match this prompt (the generated `0000_*.sql` must define 20 tables), fix drift, and skip to the report.

## Rules

1. Exact file contents below.
2. Never edit a generated `0000_*.sql` by hand; if it looks wrong, fix the schema and regenerate (delete `migrations/` first, since no database has consumed it yet).
3. Do not run migrations against any database in this task; Task 8 does that.
4. LF line endings, 2-space indentation.
5. Verify before claiming; paste real output.
6. Commit exactly once with the given message and trailer.

## Files to create

### `packages/db/src/index.ts`
```ts
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
```

### `packages/db/src/migrate.ts`
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
```

### `packages/db/drizzle.config.ts`
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["public", "auth"],
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATE ?? "postgres://korbat_migrate:change-me-migrate@localhost:5432/korbat",
  },
  strict: true,
  verbose: true,
});
```

### `packages/db/migrations/0001_grants.sql` (created empty by drizzle-kit in step 3, then filled with this)
```sql
-- Schema access. Roles exist already (infra/postgres/init/01-roles.sh).
GRANT USAGE ON SCHEMA "auth" TO korbat_auth;
GRANT USAGE ON SCHEMA "public" TO korbat_api;
REVOKE ALL ON SCHEMA "auth" FROM korbat_api;
REVOKE ALL ON SCHEMA "public" FROM korbat_auth;

-- Tables that exist now.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "auth" TO korbat_auth;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "auth" TO korbat_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO korbat_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO korbat_api;

-- Tables created by future migrations (run as korbat_migrate).
ALTER DEFAULT PRIVILEGES IN SCHEMA "auth" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO korbat_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA "auth" GRANT USAGE, SELECT ON SEQUENCES TO korbat_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO korbat_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT USAGE, SELECT ON SEQUENCES TO korbat_api;

-- audit_log is append-only for the API role, at the grant level as well as via RLS.
REVOKE UPDATE, DELETE, TRUNCATE ON "public"."audit_log" FROM korbat_api;
```

## Steps

1. Create `src/index.ts`, `src/migrate.ts`, `drizzle.config.ts`.
2. Run `pnpm --filter @korbat/db generate`.
   Expected: prints the tables it found and writes `packages/db/migrations/0000_<words>.sql` plus `migrations/meta/_journal.json` and `migrations/meta/0000_snapshot.json`.
3. Inspect the generated SQL and confirm all of the following with grep (paste the counts):
   ```bash
   f=$(ls packages/db/migrations/0000_*.sql)
   grep -c 'CREATE SCHEMA "auth"' "$f"          # expected 1
   grep -c 'CREATE TABLE' "$f"                  # expected 20
   grep -c 'ENABLE ROW LEVEL SECURITY' "$f"     # expected 20
   grep -c 'CREATE POLICY' "$f"                 # expected 21 (one per table, two on audit_log)
   grep -c 'CREATE ROLE' "$f"                   # expected 0 (roles are .existing())
   grep -c 'posts_body_len' "$f"                # expected 1
   ```
   If `CREATE ROLE` is present, the `.existing()` calls in `helpers.ts` are missing; fix and regenerate.
4. Run `pnpm --filter @korbat/db generate:custom --name=grants`.
   Expected: creates `packages/db/migrations/0001_grants.sql` (empty) and updates the journal. Fill it with the SQL above.
5. Run `pnpm --filter @korbat/db typecheck && pnpm --filter @korbat/db test`. Expected: exit 0, `Tests  9 passed`.
6. Run `git status --short` and confirm `migrations/` files are staged as new (not ignored).
7. Commit:
```bash
git add -A && git commit -m "feat(db): client, migrator and initial migrations with role grants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Report format

- Files created (including the exact generated migration filename)
- The six grep counts from step 3
- Output of step 5
- Deviations and why
- Anything blocked or uncertain
