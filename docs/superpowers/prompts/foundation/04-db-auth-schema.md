# korbat Foundation — Task 4 of 16: `@korbat/db` auth schema

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a self-owned backend: a TypeScript API (Hono + Drizzle ORM) is the only thing that talks to our own Postgres 16. Authentication is hand-rolled in the API; there is no auth vendor. The database is designed for least privilege from day one:

- All PII (email, hashed phone, credentials, sessions) lives in a separate Postgres schema called `auth`. The public API role (`korbat_api`) has no access to it; only the auth module's role (`korbat_auth`) does. Migrations run as a third role, `korbat_migrate`, which owns every object.
- Row Level Security is enabled on every table, with a policy per role. In the Foundation the policies grant the owning role full access; later sub-projects tighten them per table.
- Session rows never store the session token, only its SHA-256. IP addresses are never stored raw, only salted hashes with a 30-day purge.

`@korbat/db` holds the Drizzle schema and migrations, shared by the API and the worker. This task creates the package and the `auth` schema tables. Tasks 5 and 6 add the public tables, Task 7 the client and migrations.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. Docker not needed (tests inspect schema objects in memory).
- Pinned: drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9, vitest 4.1.11, typescript 5.9.3, @types/node 24.13.3.

## Preconditions

`git log --oneline -1` must show `feat(rules): public rulebook R1-R6 as data`. If `packages/db/` already exists, compare with this prompt, fix drift, run steps 5 and 6, and report.

## Rules (read twice)

1. Copy every file below byte for byte. Column names are snake_case on purpose; later SQL depends on them.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. Cosmetic differences are fine: timings, colours, the pnpm progress line, the `npm warn Unknown project config "node-linker"` line, git's CRLF warnings. A different test count, any unexpected `error`, `ERR_`, `error TS`, or `FAIL` line, or a missing file is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it.
6. Never commit `.env` files or `node_modules`.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Files to create

### `packages/db/package.json`
```json
{
  "name": "@korbat/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./migrate": "./src/migrate.ts"
  },
  "scripts": {
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "generate": "drizzle-kit generate",
    "generate:custom": "drizzle-kit generate --custom"
  },
  "dependencies": {
    "drizzle-orm": "0.45.2",
    "postgres": "3.4.9"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "drizzle-kit": "0.31.10",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```
(`src/index.ts`, `src/migrate.ts`, and `drizzle.config.ts` are created in Task 7. Declaring them now keeps this manifest stable.)

### `packages/db/tsconfig.json`
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test", "drizzle.config.ts"] }
```

### `packages/db/test/schema.test.ts`
```ts
import { describe, expect, test } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/schema/index";

const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
const byName = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));

describe("auth schema", () => {
  test("auth tables live in the auth schema", () => {
    for (const name of ["users", "devices", "sessions", "email_codes", "passkeys"]) {
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
```
(The `as PgTable[]` cast on line 6 is deliberate: `.enableRLS()` returns an `Omit<...>` type that a type predicate cannot narrow to. This exact line was verified to typecheck.)

### `packages/db/src/schema/helpers.ts`
```ts
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
```

### `packages/db/src/schema/auth.ts`
```ts
import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, pgSchema, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authRole, emptyTextArray, fullAccess, ts } from "./helpers";

export const auth = pgSchema("auth");

export const emailCodePurpose = auth.enum("email_code_purpose", ["signup", "login", "change_email", "recovery"]);

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
  },
  (t) => [index("email_codes_email_idx").on(t.email), fullAccess("email_codes_auth_all", authRole)],
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
```

### `packages/db/src/schema/index.ts`
```ts
export * from "./auth";
```

## Steps

1. Create `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/test/schema.test.ts`. Do not create the `src/` files yet.
2. Run:
   ```bash
   pnpm install
   ```
   Expected: ends with `Done in <time> using pnpm v10.30.0`.
3. Run:
   ```bash
   pnpm --filter @korbat/db test
   ```
   Expected: FAILS with `Failed to resolve import "../src/schema/index"`. If it passes, STOP.
4. Create `packages/db/src/schema/helpers.ts`, `packages/db/src/schema/auth.ts`, `packages/db/src/schema/index.ts`.
5. Run:
   ```bash
   pnpm --filter @korbat/db test
   ```
   Expected: `Tests  3 passed (3)`.
6. Run:
   ```bash
   pnpm --filter @korbat/db typecheck
   ```
   Expected: no `error TS` lines.
7. Commit:
   ```bash
   git add -A && git commit -m "feat(db): auth schema tables with RLS

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
8. Run `git log --oneline -1`. Expected subject: `feat(db): auth schema tables with RLS`.

## Report format (mandatory)

```
TASK 4 REPORT
Files created: <list>
Step 3 output (the failure line): <paste>
Step 5 output (Tests line): <paste>
Step 6 output: <paste or "clean">
Step 8 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
