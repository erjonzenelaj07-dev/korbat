# korbat Foundation — Task 7 of 16: `@korbat/db` client, drizzle-kit config, migrations

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a self-owned backend: a TypeScript API (Hono + Drizzle ORM) is the only client of our own Postgres 16. Three database roles enforce least privilege: `korbat_migrate` runs migrations and owns every object; `korbat_api` reads and writes the `public` schema and must have no access to `auth`; `korbat_auth` reads and writes the `auth` schema and must have no access to `public`. The roles are created by a Postgres init script (Task 8); everything else about privileges is a migration so it is versioned with the schema.

This task adds the runtime client (`createDb`, `ping`, `closeDb`), the migrator, the drizzle-kit config, the generated initial migration for all 20 tables with RLS and policies, and a hand-written `0001_grants` migration.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed: `drizzle-kit generate` works offline from the TypeScript schema.
- Pinned: drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9.

## Preconditions

`git log --oneline -1` must show `feat(db): trust and safety tables, append-only audit log`. `pnpm --filter @korbat/db test` passes 9 tests. If `packages/db/migrations/` exists, check the grep counts in step 3 against the existing `0000_*.sql`; if they match and `0001_grants.sql` matches this prompt, skip to step 5.

## Rules (read twice)

1. Copy every file below byte for byte.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. The generated migration filename is `0000_` followed by two random words (for example `0000_demonic_sabra.sql`); that randomness is expected. Any grep count that differs from the expected number, any unexpected `error`, or a missing file is a **STOP condition**.
4. On a STOP condition: do not edit a generated `.sql` file by hand, do not change the schema, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it.
6. Do not run migrations against any database in this task; Task 8 does that.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

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
    url: process.env.DATABASE_URL_MIGRATE ?? "postgres://korbat_migrate:change-me-migrate@localhost:55432/korbat",
  },
  strict: true,
  verbose: true,
});
```

### `packages/db/migrations/0001_grants.sql` (created empty by step 4, then filled with exactly this)
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

1. Create `packages/db/src/index.ts`, `packages/db/src/migrate.ts`, `packages/db/drizzle.config.ts`.
2. Run:
   ```bash
   pnpm --filter @korbat/db generate
   ```
   Expected: a list of tables with column/index/fk counts, ending with `[✓] Your SQL migration file ➜ migrations\0000_<two words>.sql`. The folder `packages/db/migrations/meta/` now contains `_journal.json` and `0000_snapshot.json`.
3. Run this exact block and compare every count:
   ```bash
   f=$(ls packages/db/migrations/0000_*.sql); echo "$f"
   grep -c 'CREATE SCHEMA "auth"' "$f"
   grep -c 'CREATE TABLE' "$f"
   grep -c 'ENABLE ROW LEVEL SECURITY' "$f"
   grep -c 'CREATE POLICY' "$f"
   grep -c 'CREATE ROLE' "$f"
   grep -c 'posts_body_len' "$f"
   grep -c 'CREATE TYPE' "$f"
   ```
   Expected, in order: the filename, then `1`, `20`, `20`, `21`, `0`, `1`, `6`.
4. Run:
   ```bash
   pnpm --filter @korbat/db generate:custom --name=grants
   ```
   Expected: `Prepared empty file for your custom SQL migration!` and `migrations\0001_grants.sql`. Now write the SQL above into `packages/db/migrations/0001_grants.sql`.
5. Run:
   ```bash
   pnpm --filter @korbat/db typecheck && pnpm --filter @korbat/db test
   ```
   Expected: no `error TS` lines; `Tests  9 passed (9)`.
6. Run:
   ```bash
   git status --short packages/db/migrations
   ```
   Expected: the `0000_*.sql`, `0001_grants.sql`, and `meta/` entries listed as untracked (`??`), not ignored.
7. Commit:
   ```bash
   git add -A && git commit -m "feat(db): client, migrator and initial migrations with role grants

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
8. Run `git log --oneline -1`. Expected subject: `feat(db): client, migrator and initial migrations with role grants`.

## Report format (mandatory)

```
TASK 7 REPORT
Files created: <list, including the exact 0000_ filename>
Step 3 output (all eight lines): <paste>
Step 5 output: <paste>
Step 8 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
