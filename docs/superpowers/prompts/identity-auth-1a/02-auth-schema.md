# korbat 1a — Task 2 of 21: Auth schema changes and migrations

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The `auth` Postgres schema is reachable only by the `korbat_auth` role; the public API role must never read it. This task adds the columns 1a needs (role, onboarding, terms acceptance, password-change time, the last used TOTP step), binds email codes to a flow id, and adds the append-only `auth_events` table. Drizzle generates the migration; a hand-written migration makes `auth_events` insert-and-read only for the auth role. The isolation step proves both rules against the running database.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(contracts): auth request, response and error-code schemas`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely.
2. Run every command exactly as written, in order, from the repo root.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

### Replace `packages/db/test/schema.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/schema/index";

const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
const byName = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));

describe("auth schema", () => {
  test("auth tables live in the auth schema", () => {
    for (const name of ["users", "devices", "sessions", "email_codes", "passkeys", "auth_events"]) {
      expect(byName.get(name)?.schema, name).toBe("auth");
    }
  });
  test("sessions store only a hash id and carry both expiries", () => {
    const cols = byName.get("sessions")!.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "user_id", "device_id", "expires_at", "absolute_expires_at", "reauth_at", "revoked_at"]));
  });
});

describe("row level security", () => {
  test("every table has RLS enabled and at least one policy", () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      expect(cfg.enableRLS, cfg.name).toBe(true);
      expect(cfg.policies.length, cfg.name).toBeGreaterThan(0);
    }
  });
});

describe("content schema", () => {
  test("posts carry a state enum and a body length check", () => {
    const cfg = byName.get("posts")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(cfg.columns.find((c) => c.name === "state")?.notNull).toBe(true);
    expect(cfg.checks.map((c) => c.name)).toContain("posts_body_len");
  });
  test("join tables have composite primary keys", () => {
    for (const name of ["follows", "likes", "reposts", "bookmarks", "blocks", "mutes"]) {
      expect(byName.get(name)!.primaryKeys.length, name).toBe(1);
      expect(byName.get(name)!.primaryKeys[0]!.columns.length, name).toBe(2);
    }
  });
});

describe("trust and safety schema", () => {
  test("there are 21 tables in total", () => {
    expect(tables.length).toBe(21);
  });
  test("transparency_log carries no user identifiers", () => {
    const cols = byName.get("transparency_log")!.columns.map((c) => c.name);
    for (const c of cols) expect(c, c).not.toMatch(/user|author|moderator|reporter/);
  });
  test("audit_log policies allow only insert and select", () => {
    const kinds = byName.get("audit_log")!.policies.map((p) => p.for).sort();
    expect(kinds).toEqual(["insert", "select"]);
  });
  test("one appeal per case", () => {
    const idx = byName.get("appeals")!.indexes.find((i) => i.config.name === "appeals_case_idx");
    expect(idx?.config.unique).toBe(true);
  });
});

describe("identity and auth 1a", () => {
  test("users carry role, age, terms, onboarding and TOTP replay columns", () => {
    const cols = byName.get("users")!.columns;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["role", "age_confirmed_at", "terms_version", "terms_accepted_at", "onboarded_at", "password_changed_at", "totp_last_step"]),
    );
    expect(cols.find((c) => c.name === "role")?.notNull).toBe(true);
  });
  test("email codes are bound to a unique flow id", () => {
    const cfg = byName.get("email_codes")!;
    expect(cfg.columns.find((c) => c.name === "flow_id")?.notNull).toBe(true);
    expect(cfg.indexes.find((i) => i.config.name === "email_codes_flow_idx")?.config.unique).toBe(true);
  });
  test("auth_events policies allow only insert and select", () => {
    expect(byName.get("auth_events")?.policies.map((p) => p.for).sort()).toEqual(["insert", "select"]);
  });
  test("email code purposes include reauth", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("reauth");
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/db test
```

Expected: the command exits with an error, and the output contains:

- `expected 20 to be 21`

Observed on the dry run:

```text
AssertionError: expected 20 to be 21 // Object.is equality
```

## Step 3: write the implementation

### Replace `packages/db/src/schema/auth.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, pgPolicy, pgSchema, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authRole, emptyTextArray, fullAccess, ts } from "./helpers";

export const auth = pgSchema("auth");

export const emailCodePurpose = auth.enum("email_code_purpose", ["signup", "login", "change_email", "recovery", "reauth"]);

export const userRole = auth.enum("user_role", ["user", "moderator", "admin"]);

export const authEventType = auth.enum("auth_event_type", [
  "signup",
  "signin_success",
  "signin_failure",
  "mfa_enabled",
  "mfa_disabled",
  "recovery_code_used",
  "recovery_codes_regenerated",
  "password_set",
  "password_changed",
  "session_revoked",
  "sessions_revoked_all",
  "account_locked",
  "new_device",
  "not_me",
]);

export const users = auth.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    /** Salted hash; the raw phone number is discarded after OTP verification. */
    phoneHash: text("phone_hash"),
    /** argon2id encoded string, null for passkey-only accounts. */
    passwordHash: text("password_hash"),
    /** Encrypted with the server-side key; never stored in clear. */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabledAt: ts("totp_enabled_at"),
    recoveryCodesHash: text("recovery_codes_hash").array().notNull().default(emptyTextArray),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    role: userRole("role").notNull().default("user"),
    /** When the 16+ check passed. Date of birth itself is never stored. */
    ageConfirmedAt: ts("age_confirmed_at"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: ts("terms_accepted_at"),
    /** Set once the public profile (handle) exists. */
    onboardedAt: ts("onboarded_at"),
    passwordChangedAt: ts("password_changed_at"),
    /** Last accepted TOTP time step; a code for this step or earlier is rejected (replay protection). */
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`), fullAccess("users_auth_all", authRole)],
).enableRLS();

export const devices = auth.table(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceHash: text("device_hash").notNull(),
    label: text("label"),
    /** 'web' | 'ios' | 'android' */
    platform: text("platform").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    /** Salted hash; purged by the 30-day job. Raw IPs are never stored. */
    ipHash: text("ip_hash"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("devices_user_idx").on(t.userId), index("devices_ip_hash_idx").on(t.ipHash), fullAccess("devices_auth_all", authRole)],
).enableRLS();

export const sessions = auth.table(
  "sessions",
  {
    /** sha256 hex of the opaque token handed to the client. The token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Sliding expiry, extended on use. */
    expiresAt: ts("expires_at").notNull(),
    /** Hard cap, never extended. */
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    lastUsedAt: ts("last_used_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    /** Last time the user proved possession of a credential on this session. */
    reauthAt: ts("reauth_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), fullAccess("sessions_auth_all", authRole)],
).enableRLS();

export const emailCodes = auth.table(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: emailCodePurpose("purpose").notNull(),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Random id returned to the client; a code can only complete the flow that requested it. */
    flowId: text("flow_id").notNull(),
    ipHash: text("ip_hash"),
  },
  (t) => [
    index("email_codes_email_idx").on(t.email),
    uniqueIndex("email_codes_flow_idx").on(t.flowId),
    fullAccess("email_codes_auth_all", authRole),
  ],
).enableRLS();

export const passkeys = auth.table(
  "passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(emptyTextArray),
    backedUp: boolean("backed_up").notNull().default(false),
    name: text("name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
  },
  (t) => [uniqueIndex("passkeys_credential_idx").on(t.credentialId), index("passkeys_user_idx").on(t.userId), fullAccess("passkeys_auth_all", authRole)],
).enableRLS();

/** Append-only security log. UPDATE, DELETE and TRUNCATE are also revoked at the grant level (migration 0003). */
export const authEvents = auth.table(
  "auth_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: authEventType("type").notNull(),
    deviceId: uuid("device_id"),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("auth_events_user_created_idx").on(t.userId, t.createdAt),
    pgPolicy("auth_events_auth_insert", { for: "insert", to: authRole, withCheck: sql`true` }),
    pgPolicy("auth_events_auth_select", { for: "select", to: authRole, using: sql`true` }),
  ],
).enableRLS();
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/db test
```

Expected output contains:

- `Tests  13 passed (13)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  13 passed (13)
```

## Step 5: verify: typecheck

```bash
pnpm --filter @korbat/db typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 6: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `Your SQL migration file`

Observed on the dry run:

```text
[✓] Your SQL migration file ➜ migrations\0002_next_tenebrous.sql 🚀
```

## Step 7: verify: migration-counts

```bash
f=$(ls packages/db/migrations/0002_*.sql); echo "file: $f"; echo "auth_events table: $(grep -c 'CREATE TABLE "auth"."auth_events"' "$f")"; echo "reauth enum value: $(grep -c "ADD VALUE 'reauth'" "$f")"; echo "new enums: $(grep -c 'CREATE TYPE' "$f")"; echo "policies: $(grep -c 'CREATE POLICY' "$f")"; echo "users columns: $(grep -c 'ALTER TABLE "auth"."users" ADD COLUMN' "$f")"; echo "email_codes columns: $(grep -c 'ALTER TABLE "auth"."email_codes" ADD COLUMN' "$f")"; echo "roles: $(grep -c 'CREATE ROLE' "$f")"
```

Expected output contains:

- `auth_events table: 1`
- `reauth enum value: 1`
- `new enums: 2`
- `policies: 2`
- `users columns: 7`
- `email_codes columns: 2`
- `roles: 0`

Observed on the dry run:

```text
auth_events table: 1
reauth enum value: 1
new enums: 2
policies: 2
users columns: 7
email_codes columns: 2
roles: 0
```

## Step 8: verify: grants-migration

```bash
pnpm --filter @korbat/db generate:custom --name=auth_events_grants && cat > packages/db/migrations/0003_auth_events_grants.sql <<'SQL'
-- auth_events is append-only: the auth role may insert and read, never change or remove rows.
-- Default privileges from 0001 granted UPDATE and DELETE on new auth tables, so revoke them here.
REVOKE UPDATE, DELETE, TRUNCATE ON "auth"."auth_events" FROM korbat_auth;
GRANT SELECT, INSERT ON "auth"."auth_events" TO korbat_auth;
GRANT USAGE, SELECT ON SEQUENCE "auth"."auth_events_id_seq" TO korbat_auth;
SQL
cat packages/db/migrations/0003_auth_events_grants.sql
```

Expected output contains:

- `Prepared empty file for your custom SQL migration`
- `REVOKE UPDATE, DELETE, TRUNCATE`

Observed on the dry run:

```text
Prepared empty file for your custom SQL migration!
REVOKE UPDATE, DELETE, TRUNCATE ON "auth"."auth_events" FROM korbat_auth;
```

## Step 9: verify: apply-migrations

```bash
set -a; . infra/.env; set +a; cd packages/db && DATABASE_URL_MIGRATE="postgres://korbat_migrate:${KORBAT_MIGRATE_DB_PASSWORD}@localhost:55432/korbat" npx tsx -e "import('./src/migrate.ts').then(m => m.runMigrations(process.env.DATABASE_URL_MIGRATE, './migrations')).then(() => console.log('migrated'))" && cd ../.. && docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations'
```

Expected output contains:

- `migrated`
- `4`

Observed on the dry run:

```text
migrated
4
```

## Step 10: verify: isolation

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U korbat_auth -d korbat -c "insert into auth.auth_events (type) values ('signup')" 2>&1; docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U korbat_auth -d korbat -c 'select count(*) from auth.auth_events' 2>&1; docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U korbat_auth -d korbat -c 'delete from auth.auth_events' 2>&1; docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U korbat_auth -d korbat -c "update auth.auth_events set ip_hash = 'x'" 2>&1; docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U korbat_api -d korbat -c 'select count(*) from auth.auth_events' 2>&1; docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select enum_range(null::auth.email_code_purpose)' 2>&1; docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select enum_range(null::auth.user_role)' 2>&1
```

Expected output contains:

- `INSERT 0 1`
- `permission denied for table auth_events`
- `permission denied for schema auth`
- `{signup,login,change_email,recovery,reauth}`
- `{user,moderator,admin}`

Observed on the dry run:

```text
INSERT 0 1
ERROR:  permission denied for table auth_events
ERROR:  permission denied for table auth_events
ERROR:  permission denied for schema auth
{signup,login,change_email,recovery,reauth}
{user,moderator,admin}
```

## Step 11: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `packages/db/migrations/0002_<two random words>.sql`
- `packages/db/migrations/0003_auth_events_grants.sql`
- `packages/db/migrations/meta/0002_snapshot.json`
- `packages/db/migrations/meta/0003_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/auth.ts`
- `packages/db/test/schema.test.ts`

Allowed difference: drizzle-kit names each generated migration with its number and two random words, so that file's name differs from the dry run (for example `0002_aspiring_prism.sql`). Any name of that shape is correct; do not rename it.

## Step 12: commit

```bash
git add -A
git commit -q -m "feat(db): auth roles, onboarding and terms columns, flow-bound email codes, append-only auth_events" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(db): auth roles, onboarding and terms columns, flow-bound email codes, append-only auth_events`.

## Report format (mandatory)

```text
TASK 2 REPORT
Files written: <count, expected 2>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "migration-counts": <paste the expected lines as printed>
Verify "grants-migration": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "isolation": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
