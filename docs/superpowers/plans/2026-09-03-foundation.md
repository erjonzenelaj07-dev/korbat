# korbat Foundation (Sub-project 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable, self-hosted monorepo skeleton: shared contracts and rulebook packages, the full Drizzle schema with three least-privilege Postgres roles and RLS, a hardened Hono API with a health endpoint, a worker skeleton, an Expo web shell that calls the API, a Docker Compose stack that serves all of it, CI, and a Cloudflare Tunnel in front.

**Architecture:** pnpm workspace. `packages/*` export TypeScript source directly; `apps/api` and `apps/worker` are bundled with tsup into single files for Docker. The API is the only thing that touches Postgres, using two pools (`korbat_api` for public schema, `korbat_auth` for the `auth` schema); migrations run as `korbat_migrate`. Caddy serves the Expo web export and proxies `/api/*` to the API; cloudflared is the only ingress.

**Tech Stack (pinned):** Node 24, pnpm 10.30.0, TypeScript 5.9.3, vitest 4.1.11, tsx 4.23.13, tsup 8.5.1, hono 4.13.5, @hono/node-server 2.1.1, @hono/zod-validator 0.9.1, zod 4.5.4, drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9, ioredis 5.11.1, pino 10.3.1, Expo SDK 57, nativewind 4.2.6, tailwindcss 3.4.19, Postgres 16, Redis 7, MinIO, Caddy 2.

**Conventions for every task:** commands run from `C:\Users\Lenovo\Desktop\cool\korbat` in Git Bash. All files use LF line endings. Package names are `@korbat/<name>`. Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

**Deliberately out of scope (later sub-projects):** real auth (1), image pipeline (2), moderation routes (3), backups and log shipping (4), per-user RLS policies (added table by table as routes land; foundation ships full-access policies per role so the mechanism is proven).

---

## File structure

```
korbat/
  package.json  pnpm-workspace.yaml  .npmrc  tsconfig.base.json  .gitattributes  .editorconfig  README.md  renovate.json
  .github/workflows/ci.yml
  packages/
    contracts/  src/index.ts (ErrorEnvelope, HealthResponse, Pagination)          test/contracts.test.ts
    rules/      src/index.ts (RULES data, getRule)                                test/rules.test.ts
    db/         src/schema/{helpers,auth,identity,content,safety,index}.ts
                src/index.ts (createDb, ping)  src/migrate.ts (runMigrations)
                drizzle.config.ts  migrations/  test/schema.test.ts
  apps/
    api/        src/index.ts (wire real deps, serve)  src/app.ts (createApp factory)  src/migrate.ts
                src/config.ts  src/env.ts  src/lib/{logger,errors,validate}.ts
                src/middleware/{observability,security-headers,rate-limit,session}.ts
                src/routes/health.ts  test/**/*.test.ts  tsup.config.ts  Dockerfile
    worker/     src/index.ts  src/jobs.ts  test/jobs.test.ts  tsup.config.ts  Dockerfile
    app/        Expo: app/_layout.tsx  app/index.tsx  src/lib/api.ts  global.css  tailwind.config.js
                babel.config.js  metro.config.js  nativewind-env.d.ts
    admin/      package.json  README.md (placeholder)
  infra/
    compose.yml  compose.dev.yml  .env.example  postgres/init/01-roles.sh  caddy/Dockerfile  caddy/Caddyfile
```

---

### Task 1: Repository root scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, `.gitattributes`, `.editorconfig`, `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Write the root files**

`package.json`:
```json
{
  "name": "korbat",
  "private": true,
  "packageManager": "pnpm@10.30.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "pnpm -r --if-present run typecheck",
    "test": "pnpm -r --if-present run test",
    "build": "pnpm -r --if-present run build"
  },
  "devDependencies": {
    "typescript": "5.9.3"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`.npmrc` (Expo needs a flat node_modules):
```
node-linker=hoisted
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noEmit": true
  }
}
```

`.gitattributes`:
```
* text=auto eol=lf
*.sh text eol=lf
```

`.editorconfig`:
```
root = true
[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
indent_style = space
indent_size = 2
```

Append to `.gitignore`:
```
.expo/
web-build/
apps/app/dist/
infra/.env
```

`README.md`:
```markdown
# korbat

Pseudonymous social platform with a narrow public rulebook and transparent moderation. Self-hosted.

- Design spec: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Plans: `docs/superpowers/plans/`

## Dev quick start
```bash
pnpm install
cp infra/.env.example infra/.env            # then edit passwords
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis minio minio-init migrate
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health
pnpm --filter @korbat/app web               # http://localhost:8081
```
```

- [ ] **Step 2: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: creates `pnpm-lock.yaml`, no errors (no packages yet, that's fine).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm workspace

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `@korbat/contracts`

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`, `packages/contracts/test/contracts.test.ts`

- [ ] **Step 1: Package manifest**

`packages/contracts/package.json`:
```json
{
  "name": "@korbat/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "dependencies": { "zod": "4.5.4" },
  "devDependencies": { "vitest": "4.1.11", "typescript": "5.9.3" }
}
```

`packages/contracts/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Write the failing test**

`packages/contracts/test/contracts.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { ErrorEnvelope, HealthResponse, Pagination } from "../src/index";

describe("ErrorEnvelope", () => {
  test("accepts a minimal error", () => {
    const r = ErrorEnvelope.safeParse({ error: { code: "not_found", message: "nope" } });
    expect(r.success).toBe(true);
  });
  test("rejects a missing code", () => {
    expect(ErrorEnvelope.safeParse({ error: { message: "nope" } }).success).toBe(false);
  });
});

describe("HealthResponse", () => {
  test("accepts ok with checks", () => {
    const r = HealthResponse.safeParse({ status: "ok", version: "1.2.3", checks: { postgres: "ok", redis: "fail" } });
    expect(r.success).toBe(true);
  });
  test("rejects unknown check state", () => {
    expect(HealthResponse.safeParse({ status: "ok", version: "1", checks: { postgres: "meh" } }).success).toBe(false);
  });
});

describe("Pagination", () => {
  test("defaults limit to 20 and caps at 50", () => {
    expect(Pagination.parse({})).toEqual({ limit: 20 });
    expect(Pagination.safeParse({ limit: 51 }).success).toBe(false);
  });
  test("cursor is optional opaque string", () => {
    expect(Pagination.parse({ cursor: "abc", limit: 5 })).toEqual({ cursor: "abc", limit: 5 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @korbat/contracts test`
Expected: FAIL, cannot resolve `../src/index`.

- [ ] **Step 4: Implement**

`packages/contracts/src/index.ts`:
```ts
import { z } from "zod";

/** Every non-2xx response from the API has this shape. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const CheckState = z.enum(["ok", "fail"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), CheckState),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Keyset pagination query params shared by every list endpoint. */
export const Pagination = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @korbat/contracts test && pnpm --filter @korbat/contracts typecheck`
Expected: 6 tests pass, tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(contracts): error envelope, health and pagination schemas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `@korbat/rules`

**Files:**
- Create: `packages/rules/package.json`, `packages/rules/tsconfig.json`, `packages/rules/src/index.ts`, `packages/rules/test/rules.test.ts`

- [ ] **Step 1: Package manifest**

`packages/rules/package.json`:
```json
{
  "name": "@korbat/rules",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "devDependencies": { "vitest": "4.1.11", "typescript": "5.9.3" }
}
```
`packages/rules/tsconfig.json`: same content as contracts.

- [ ] **Step 2: Write the failing test**

`packages/rules/test/rules.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { RULES, getRule, isRuleId } from "../src/index";

describe("rulebook", () => {
  test("has exactly six rules R1..R6 in order", () => {
    expect(RULES.map((r) => r.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });
  test("every rule has text and at least one example on each side", () => {
    for (const r of RULES) {
      expect(r.title.length, r.id).toBeGreaterThan(5);
      expect(r.text.length, r.id).toBeGreaterThan(40);
      expect(r.notAllowed.length, r.id).toBeGreaterThan(0);
      expect(r.allowed.length, r.id).toBeGreaterThan(0);
    }
  });
  test("only R2 is fully automated; only R1 is auto-withheld", () => {
    expect(RULES.filter((r) => r.automation === "auto_remove").map((r) => r.id)).toEqual(["R2"]);
    expect(RULES.filter((r) => r.automation === "withhold_for_review").map((r) => r.id)).toEqual(["R1"]);
  });
  test("getRule and isRuleId", () => {
    expect(getRule("R3")?.title).toMatch(/hatred/i);
    expect(getRule("R9")).toBeUndefined();
    expect(isRuleId("R6")).toBe(true);
    expect(isRuleId("x")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @korbat/rules test`
Expected: FAIL, cannot resolve `../src/index`.

- [ ] **Step 4: Implement**

`packages/rules/src/index.ts`:
```ts
/**
 * The public rulebook. This is the complete list of reasons content can be
 * actioned on korbat. Opinions are never a reason. Every moderation case
 * cites exactly one of these IDs.
 */
export type Automation =
  | "none"                 // report-driven, human decides
  | "withhold_for_review"  // automation may hide from others pending a human
  | "auto_remove";         // automation may remove (R2 only)

export interface Rule {
  id: string;
  title: string;
  text: string;
  allowed: string[];
  notAllowed: string[];
  automation: Automation;
  seniorQueue: boolean;
}

export const RULES = [
  {
    id: "R1",
    title: "No sexual or pornographic content",
    text: "Images or text whose primary purpose is sexual arousal are not allowed. This includes nudity presented sexually, explicit sexual acts, and sexualised depictions of anyone. Images that score high on the automated check are hidden from others until a person reviews them; the author can always see their own post.",
    allowed: ["Medical or educational discussion of sexuality without explicit imagery", "Art with non-sexual nudity in a clearly artistic or historical context", "Frank discussion of sexual politics or policy"],
    notAllowed: ["Pornographic images or video", "Sexually explicit text posted for arousal", "Links whose preview is pornographic"],
    automation: "withhold_for_review",
    seniorQueue: false,
  },
  {
    id: "R2",
    title: "No child sexual abuse material",
    text: "Any sexualised depiction of a minor is removed automatically on a hash match, the account is suspended, and the material is reported to the relevant authority. This is the only rule enforced without a human decision first. Appeals are reviewed by a senior moderator.",
    allowed: ["Reporting or discussing child safety issues without imagery", "News about arrests or legislation"],
    notAllowed: ["Any sexualised image of a minor, real or generated", "Links to such material", "Solicitation"],
    automation: "auto_remove",
    seniorQueue: true,
  },
  {
    id: "R3",
    title: "No targeted hatred or harassment based on protected traits",
    text: "Attacking a person or group because of race, ethnicity, national origin, religion, disability, sex, sexual orientation, or gender identity is not allowed. Criticising ideas, beliefs, policies, institutions, public figures, or the actions of groups is allowed, even harshly. The line is attacking people for what they are, not disagreeing with what they think or do.",
    allowed: ["Criticism of any religion's doctrine or any government's policy", "Arguing that a political movement is wrong or harmful", "Blunt, offensive, or unpopular opinions about ideas"],
    notAllowed: ["Slurs directed at a person or group", "Calling for a protected group to be harmed or excluded", "Sustained pile-ons against one person because of a protected trait"],
    automation: "none",
    seniorQueue: false,
  },
  {
    id: "R4",
    title: "No doxxing",
    text: "Publishing someone's private information without consent is not allowed: home address, phone number, private email, workplace details intended to enable harassment, financial or ID documents, or private images. When a report is credible the post is hidden from others while a person decides, because the harm is immediate.",
    allowed: ["Public business contact details", "Information a public figure has published about themselves", "Linking to public court records in a news context"],
    notAllowed: ["Posting someone's home address or phone number", "Sharing private messages or images without consent", "Coordinating to find where someone lives"],
    automation: "none",
    seniorQueue: false,
  },
  {
    id: "R5",
    title: "No direct threats of violence",
    text: "Stating an intent to physically harm a specific person or group, or calling for others to do so, is not allowed. Hyperbole, dark humour, and discussion of violence in news, history, or fiction are allowed. Cases go to the senior queue.",
    allowed: ["Discussing wars, crimes, or historical violence", "Obvious hyperbole ('I could kill for a coffee')", "Fiction and satire"],
    notAllowed: ["'I will hurt you' directed at a person", "Calling for a named person to be attacked", "Posting a target list"],
    automation: "none",
    seniorQueue: true,
  },
  {
    id: "R6",
    title: "No spam, scams, or impersonation",
    text: "Repetitive unsolicited posting, deceptive schemes, malware links, and pretending to be another person or organisation are not allowed. Parody and fan accounts are fine when clearly labelled.",
    allowed: ["Promoting your own work in your own posts", "Clearly labelled parody accounts", "Sharing a link once in a relevant thread"],
    notAllowed: ["Posting the same link across many threads", "Phishing or crypto giveaway scams", "An account presenting itself as a real person or brand it is not"],
    automation: "none",
    seniorQueue: false,
  },
] as const satisfies readonly Rule[];

export type RuleId = (typeof RULES)[number]["id"];

const byId = new Map<string, Rule>(RULES.map((r) => [r.id, r]));

export function getRule(id: string): Rule | undefined {
  return byId.get(id);
}

export function isRuleId(id: string): id is RuleId {
  return byId.has(id);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @korbat/rules test && pnpm --filter @korbat/rules typecheck`
Expected: 4 tests pass, tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(rules): public rulebook R1-R6 as data

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `@korbat/db` schema, auth schema tables

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/schema/helpers.ts`, `packages/db/src/schema/auth.ts`, `packages/db/src/schema/index.ts`, `packages/db/test/schema.test.ts`

- [ ] **Step 1: Package manifest**

`packages/db/package.json`:
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

`packages/db/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test", "drizzle.config.ts"] }
```

- [ ] **Step 2: Write the failing test (grows in Tasks 5 and 6)**

`packages/db/test/schema.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/schema/index";

const tables = Object.values(schema).filter((v): v is PgTable => is(v, PgTable));
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

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @korbat/db test`
Expected: FAIL, cannot resolve `../src/schema/index`.

- [ ] **Step 4: Implement helpers and the auth schema**

`packages/db/src/schema/helpers.ts`:
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

`packages/db/src/schema/auth.ts`:
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

`packages/db/src/schema/index.ts` (for now):
```ts
export * from "./auth";
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @korbat/db test && pnpm --filter @korbat/db typecheck`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(db): auth schema tables with RLS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `@korbat/db` schema, identity and content tables

**Files:**
- Create: `packages/db/src/schema/identity.ts`, `packages/db/src/schema/content.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/test/schema.test.ts`

- [ ] **Step 1: Extend the test**

Append to `packages/db/test/schema.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @korbat/db test`
Expected: FAIL on `byName.get("posts")` being undefined.

- [ ] **Step 3: Implement**

`packages/db/src/schema/identity.ts`:
```ts
import { sql } from "drizzle-orm";
import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";

export const profiles = pgTable(
  "profiles",
  {
    /** Equals auth.users.id. Deliberately no cross-schema FK so korbat_api never needs auth access. */
    id: uuid("id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarPath: text("avatar_path"),
    verifiedAt: ts("verified_at"),
    reputation: integer("reputation").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [uniqueIndex("profiles_handle_lower_idx").on(sql`lower(${t.handle})`), fullAccess("profiles_api_all", apiRole)],
).enableRLS();
```

`packages/db/src/schema/content.ts`:
```ts
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, real, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const postState = pgEnum("post_state", ["visible", "withheld", "removed", "deleted_by_author"]);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    quoteOfId: uuid("quote_of_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    state: postState("state").notNull().default("visible"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    index("posts_created_id_idx").on(t.createdAt, t.id),
    index("posts_reply_to_idx").on(t.replyToId),
    check("posts_body_len", sql`char_length(${t.body}) <= 1000`),
    fullAccess("posts_api_all", apiRole),
  ],
).enableRLS();

export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** Random object key in the media bucket; never the original filename. */
    path: text("path").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    blurhash: text("blurhash").notNull(),
    altText: text("alt_text"),
    nsfwScore: real("nsfw_score"),
  },
  (t) => [uniqueIndex("post_media_post_position_idx").on(t.postId, t.position), fullAccess("post_media_api_all", apiRole)],
).enableRLS();

/** user -> user relation table (follows, blocks, mutes). */
function userPairTable(name: string, from: string, to: string) {
  return pgTable(
    name,
    {
      fromId: uuid(from).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      toId: uuid(to).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.fromId, t.toId] }),
      index(`${name}_to_idx`).on(t.toId),
      check(`${name}_not_self`, sql`${t.fromId} <> ${t.toId}`),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

/** user -> post relation table (likes, reposts, bookmarks). */
function userPostTable(name: string) {
  return pgTable(
    name,
    {
      userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
      postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.postId] }), index(`${name}_post_idx`).on(t.postId), fullAccess(`${name}_api_all`, apiRole)],
  ).enableRLS();
}

export const follows = userPairTable("follows", "follower_id", "followee_id");
export const blocks = userPairTable("blocks", "blocker_id", "blocked_id");
export const mutes = userPairTable("mutes", "muter_id", "muted_id");
export const likes = userPostTable("likes");
export const reposts = userPostTable("reposts");
export const bookmarks = userPostTable("bookmarks");
```

`packages/db/src/schema/index.ts`:
```ts
export * from "./auth";
export * from "./identity";
export * from "./content";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @korbat/db test && pnpm --filter @korbat/db typecheck`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): identity and content tables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `@korbat/db` schema, trust and safety tables

**Files:**
- Create: `packages/db/src/schema/safety.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/test/schema.test.ts`

- [ ] **Step 1: Extend the test**

Append to `packages/db/test/schema.test.ts`:
```ts
describe("trust and safety schema", () => {
  test("there are 20 tables in total", () => {
    expect(tables.length).toBe(20);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @korbat/db test`
Expected: FAIL, 14 tables instead of 20.

- [ ] **Step 3: Implement**

`packages/db/src/schema/safety.ts`:
```ts
import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, pgEnum, pgPolicy, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const targetType = pgEnum("target_type", ["post", "profile"]);
export const reportStatus = pgEnum("report_status", ["open", "merged", "closed"]);
export const caseAction = pgEnum("case_action", ["none", "withhold", "remove", "strike", "suspend"]);
export const appealStatus = pgEnum("appeal_status", ["open", "upheld", "denied"]);

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: targetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    ruleId: text("rule_id").notNull(),
    action: caseAction("action").notNull().default("none"),
    /** Shown verbatim to the author. Required for any action other than none. */
    publicReason: text("public_reason").notNull().default(""),
    moderatorId: uuid("moderator_id").references(() => profiles.id, { onDelete: "set null" }),
    senior: boolean("senior").notNull().default(false),
    brigadingFlag: boolean("brigading_flag").notNull().default(false),
    /** Sum of reporter weights, used for queue ordering. */
    weight: integer("weight").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  (t) => [index("cases_open_idx").on(t.closedAt, t.weight, t.createdAt), index("cases_target_idx").on(t.targetType, t.targetId), fullAccess("cases_api_all", apiRole)],
).enableRLS();

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    targetType: targetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    ruleId: text("rule_id").notNull(),
    details: text("details").notNull().default(""),
    /** Derived from reporter reputation at report time. */
    weight: integer("weight").notNull().default(1),
    status: reportStatus("status").notNull().default("open"),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reports_reporter_target_idx").on(t.reporterId, t.targetType, t.targetId),
    index("reports_target_idx").on(t.targetType, t.targetId),
    fullAccess("reports_api_all", apiRole),
  ],
).enableRLS();

export const appeals = pgTable(
  "appeals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    status: appealStatus("status").notNull().default("open"),
    /** Must differ from cases.moderator_id; enforced in the API and covered by an integration test. */
    reviewerId: uuid("reviewer_id").references(() => profiles.id, { onDelete: "set null" }),
    decisionReason: text("decision_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
  },
  (t) => [uniqueIndex("appeals_case_idx").on(t.caseId), fullAccess("appeals_api_all", apiRole)],
).enableRLS();

export const strikes = pgTable(
  "strikes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("strikes_user_active_idx").on(t.userId, t.expiresAt), fullAccess("strikes_api_all", apiRole)],
).enableRLS();

/** Public, anonymised copy of every closed case. No user ids by design. */
export const transparencyLog = pgTable(
  "transparency_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: text("rule_id").notNull(),
    action: caseAction("action").notNull(),
    targetType: targetType("target_type").notNull(),
    decidedAt: ts("decided_at").notNull(),
    appealed: boolean("appealed").notNull().default(false),
    appealOutcome: appealStatus("appeal_outcome"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("transparency_decided_idx").on(t.decidedAt), fullAccess("transparency_api_all", apiRole)],
).enableRLS();

/** Append-only. UPDATE/DELETE are also revoked at the grant level in migration 0001. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  () => [
    pgPolicy("audit_log_api_insert", { for: "insert", to: apiRole, withCheck: sql`true` }),
    pgPolicy("audit_log_api_select", { for: "select", to: apiRole, using: sql`true` }),
  ],
).enableRLS();
```

Add to `packages/db/src/schema/index.ts`:
```ts
export * from "./safety";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @korbat/db test && pnpm --filter @korbat/db typecheck`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): trust and safety tables, append-only audit log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `@korbat/db` client, drizzle-kit config, migrations

**Files:**
- Create: `packages/db/src/index.ts`, `packages/db/src/migrate.ts`, `packages/db/drizzle.config.ts`, `packages/db/migrations/0000_*.sql` (generated), `packages/db/migrations/0001_grants.sql` (custom)

- [ ] **Step 1: Client and migrator**

`packages/db/src/index.ts`:
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

`packages/db/src/migrate.ts`:
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

`packages/db/drizzle.config.ts`:
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

- [ ] **Step 2: Generate the initial migration**

Run: `pnpm --filter @korbat/db generate`
Expected: `packages/db/migrations/0000_<words>.sql` plus `meta/` folder. Open the SQL and confirm it contains `CREATE SCHEMA "auth"`, 20 `CREATE TABLE`, `ENABLE ROW LEVEL SECURITY` for each, and `CREATE POLICY` lines.

- [ ] **Step 3: Add the custom grants migration**

Run: `pnpm --filter @korbat/db generate:custom --name=grants`
Expected: empty `packages/db/migrations/0001_grants.sql`. Fill it with:
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

- [ ] **Step 4: Typecheck and test still pass**

Run: `pnpm --filter @korbat/db typecheck && pnpm --filter @korbat/db test`
Expected: exit 0, 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): client, migrator and initial migrations with role grants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Infra, data services and migration in Docker Compose

**Files:**
- Create: `infra/compose.yml`, `infra/compose.dev.yml`, `infra/.env.example`, `infra/postgres/init/01-roles.sh`

- [ ] **Step 1: Postgres role bootstrap**

`infra/postgres/init/01-roles.sh` (runs once on an empty data volume, as the superuser):
```sh
#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v migrate_pw="$KORBAT_MIGRATE_DB_PASSWORD" \
  -v api_pw="$KORBAT_API_DB_PASSWORD" \
  -v auth_pw="$KORBAT_AUTH_DB_PASSWORD" <<'EOSQL'
CREATE ROLE korbat_migrate LOGIN PASSWORD :'migrate_pw';
CREATE ROLE korbat_api     LOGIN PASSWORD :'api_pw';
CREATE ROLE korbat_auth    LOGIN PASSWORD :'auth_pw';

-- Nobody gets the public schema for free (PG15+ already removed CREATE; remove USAGE too).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE USAGE  ON SCHEMA public FROM PUBLIC;

-- Migrator owns all objects and may create schemas.
GRANT CREATE ON DATABASE :"db" TO korbat_migrate;
GRANT ALL ON SCHEMA public TO korbat_migrate;
GRANT USAGE ON SCHEMA public TO korbat_api;
EOSQL
```
Then: `chmod +x infra/postgres/init/01-roles.sh`

- [ ] **Step 2: Environment template**

`infra/.env.example`:
```
# Copy to infra/.env and change every password. Never commit infra/.env.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-superuser
POSTGRES_DB=korbat
KORBAT_MIGRATE_DB_PASSWORD=change-me-migrate
KORBAT_API_DB_PASSWORD=change-me-api
KORBAT_AUTH_DB_PASSWORD=change-me-auth

MINIO_ROOT_USER=korbat
MINIO_ROOT_PASSWORD=change-me-minio
MINIO_BUCKET=korbat-media

API_LOG_LEVEL=info
# Comma-separated browser origins allowed to call the API cross-origin. Empty in prod (same origin via Caddy).
API_TRUSTED_ORIGINS=http://localhost:8081

# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel.
TUNNEL_TOKEN=
```

- [ ] **Step 3: Compose files (data services + migrate only; app services are added in Task 14)**

`infra/compose.yml`:
```yaml
name: korbat

x-node-common: &node-common
  restart: unless-stopped
  read_only: true
  tmpfs: ["/tmp"]
  security_opt: ["no-new-privileges:true"]

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      KORBAT_MIGRATE_DB_PASSWORD: ${KORBAT_MIGRATE_DB_PASSWORD}
      KORBAT_API_DB_PASSWORD: ${KORBAT_API_DB_PASSWORD}
      KORBAT_AUTH_DB_PASSWORD: ${KORBAT_AUTH_DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "noeviction"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 20

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: ["/bin/sh", "-c"]
    command:
      - >
        mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
        mc mb --ignore-existing "local/$MINIO_BUCKET" &&
        mc anonymous set none "local/$MINIO_BUCKET"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
      MINIO_BUCKET: ${MINIO_BUCKET}

  migrate:
    <<: *node-common
    restart: "no"
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL_MIGRATE: postgres://korbat_migrate:${KORBAT_MIGRATE_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MIGRATIONS_DIR: /app/migrations
    depends_on:
      postgres: { condition: service_healthy }

volumes:
  pgdata:
  redisdata:
  miniodata:
```

`infra/compose.dev.yml` (localhost ports for running api/app on the host):
```yaml
services:
  postgres:
    ports: ["5432:5432"]
  redis:
    ports: ["6379:6379"]
  minio:
    ports: ["9000:9000", "9001:9001"]
```

- [ ] **Step 4: Bring up the data services and verify roles**

The `migrate` service needs the API image from Task 11 and 14, so for now run the migrator from the host:

```bash
cp infra/.env.example infra/.env
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis minio minio-init
docker compose -f infra/compose.yml exec postgres psql -U postgres -d korbat -c "\du"
```
Expected: roles `korbat_api`, `korbat_auth`, `korbat_migrate` listed.

- [ ] **Step 5: Apply migrations from the host and verify grants**

```bash
cd packages/db && DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:5432/korbat npx tsx -e "import('./src/migrate.ts').then(m => m.runMigrations(process.env.DATABASE_URL_MIGRATE, './migrations'))" && cd ../..
```
Expected: exits 0.

Verify isolation (all three must print the shown result):
```bash
docker compose -f infra/compose.yml exec postgres psql -U korbat_api -d korbat -c "select count(*) from auth.users"
# Expected: ERROR:  permission denied for schema auth
docker compose -f infra/compose.yml exec postgres psql -U korbat_api -d korbat -c "insert into audit_log (actor_id, action) values (gen_random_uuid(), 'test'); update audit_log set action='x'"
# Expected: INSERT 0 1 then ERROR:  permission denied for table audit_log
docker compose -f infra/compose.yml exec postgres psql -U korbat_auth -d korbat -c "select count(*) from profiles"
# Expected: ERROR:  permission denied for schema public
docker compose -f infra/compose.yml exec postgres psql -U korbat_api -d korbat -c "select count(*) from posts"
# Expected: count 0
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(infra): compose data services, postgres roles bootstrap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `@korbat/api` config and PII-scrubbing logger

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/config.ts`, `apps/api/src/lib/logger.ts`, `apps/api/test/config.test.ts`, `apps/api/test/logger.test.ts`

- [ ] **Step 1: Package manifest**

`apps/api/package.json`:
```json
{
  "name": "@korbat/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "test:integration": "INTEGRATION=1 vitest run test/integration"
  },
  "dependencies": {
    "@hono/node-server": "2.1.1",
    "@hono/zod-validator": "0.9.1",
    "@korbat/contracts": "workspace:*",
    "@korbat/db": "workspace:*",
    "@korbat/rules": "workspace:*",
    "hono": "4.13.5",
    "ioredis": "5.11.1",
    "pino": "10.3.1",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "pino-pretty": "13.1.3",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```

`apps/api/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test", "tsup.config.ts"] }
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/config.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config";

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(good);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.TRUSTED_ORIGINS).toEqual([]);
  });
  test("parses trusted origins list", () => {
    expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://a.test, http://b.test" }).TRUSTED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
  test("fails loudly on a missing database url", () => {
    expect(() => loadConfig({ REDIS_URL: good.REDIS_URL })).toThrow(/DATABASE_URL_API/);
  });
});
```

`apps/api/test/logger.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { scrub } from "../src/lib/logger";

describe("scrub", () => {
  test("masks emails and IPs inside strings", () => {
    expect(scrub("user a.b+c@example.com from 203.0.113.9")).toBe("user [email] from [ip]");
    expect(scrub("v6 2001:db8:85a3::8a2e:370:7334 and ::1 and fe80::1")).toBe("v6 [ip] and [ip] and [ip]");
  });
  test("leaves timestamps alone", () => {
    expect(scrub("at 2026-09-03T10:30:45Z")).toBe("at 2026-09-03T10:30:45Z");
  });
  test("redacts secret-bearing keys regardless of value", () => {
    expect(scrub({ authorization: "Bearer abc", cookie: "s=1", password: "p", nested: { token: "t" } })).toEqual({
      authorization: "[redacted]",
      cookie: "[redacted]",
      password: "[redacted]",
      nested: { token: "[redacted]" },
    });
  });
  test("walks arrays and keeps non-strings", () => {
    expect(scrub({ n: 1, ok: true, list: ["x@y.io", 2] })).toEqual({ n: 1, ok: true, list: ["[email]", 2] });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm install && pnpm --filter @korbat/api test`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement config**

`apps/api/src/config.ts`:
```ts
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_AUTH: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  KORBAT_VERSION: z.string().default("0.0.0-dev"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

- [ ] **Step 5: Implement the logger**

`apps/api/src/lib/logger.ts`:
```ts
import pino, { type Logger } from "pino";

export type { Logger };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Full form, compressed form with "::", and leading "::" form. Requires "::" or 8 groups so times like 10:30:45 are untouched.
const IPV6 = /(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})/gi;
const SECRET_KEYS = new Set(["authorization", "cookie", "set-cookie", "password", "token", "secret", "session", "code", "otp"]);

/** Recursively masks emails, IPs, and secret-bearing keys. Applied to every log line. */
export function scrub(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.has(key.toLowerCase())) return "[redacted]";
  if (typeof value === "string") return value.replace(EMAIL, "[email]").replace(IPV6, "[ip]").replace(IPV4, "[ip]");
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (value && typeof value === "object" && !(value instanceof Error)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, k);
    return out;
  }
  if (value instanceof Error) return { name: value.name, message: scrub(value.message), stack: value.stack };
  return value;
}

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    base: undefined,
    formatters: { log: (obj) => scrub(obj) as Record<string, unknown> },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === "string" ? scrub(a) : a));
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @korbat/api test && pnpm --filter @korbat/api typecheck`
Expected: 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(api): env config and PII-scrubbing logger

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `@korbat/api` middleware

**Files:**
- Create: `apps/api/src/env.ts`, `apps/api/src/lib/errors.ts`, `apps/api/src/lib/validate.ts`, `apps/api/src/middleware/observability.ts`, `apps/api/src/middleware/security-headers.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/middleware/session.ts`, `apps/api/test/middleware.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/api/test/middleware.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import pino from "pino";
import type { AppEnv } from "../src/env";
import { observability } from "../src/middleware/observability";
import { noStore, securityHeaders } from "../src/middleware/security-headers";
import { MemoryStore, rateLimit } from "../src/middleware/rate-limit";
import { requireSession, sessionStub } from "../src/middleware/session";
import { validate } from "../src/lib/validate";

const silent = pino({ level: "silent" });

function base() {
  const app = new Hono<AppEnv>();
  app.use(observability(silent));
  app.use(securityHeaders, noStore);
  app.use(sessionStub);
  return app;
}

describe("observability", () => {
  test("adds a uuid x-request-id header", async () => {
    const app = base().get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("security headers", () => {
  test("sets the hardened header set on every response", async () => {
    const app = base().get("/x", (c) => c.json({}));
    const h = (await app.request("/x")).headers;
    expect(h.get("content-security-policy")).toContain("default-src 'none'");
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.get("strict-transport-security")).toContain("max-age=31536000");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("cache-control")).toBe("no-store");
  });
});

describe("rateLimit", () => {
  test("allows up to limit then returns 429 with Retry-After", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    const app = base()
      .use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);
    const blocked = await app.request("/x");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()) as { error: { code: string } }).toMatchObject({ error: { code: "rate_limited" } });
    now += 10_001;
    expect((await app.request("/x")).status).toBe(200);
  });
  test("exposes RateLimit-* headers", async () => {
    const app = base()
      .use(rateLimit({ name: "t", store: new MemoryStore(), limit: 5, windowMs: 1000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    const h = (await app.request("/x")).headers;
    expect(h.get("ratelimit-limit")).toBe("5");
    expect(h.get("ratelimit-remaining")).toBe("4");
  });
});

describe("session stub", () => {
  test("requireSession returns 401 envelope with requestId", async () => {
    const app = base().get("/me", requireSession, (c) => c.text("never"));
    const res = await app.request("/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("unauthenticated");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });
});

describe("validate", () => {
  test("returns 400 envelope with field details", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: "no" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { properties?: Record<string, unknown> } } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.properties).toHaveProperty("n");
  });
  test("passes valid input through", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: 4 }), headers: { "content-type": "application/json" } });
    expect(await res.json()).toEqual({ n: 4 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @korbat/api test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement env type and error helper**

`apps/api/src/env.ts`:
```ts
import type { Logger } from "pino";

export interface Session {
  sessionId: string;
  userId: string;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    session: Session | null;
  };
};
```

`apps/api/src/lib/errors.ts`:
```ts
import type { ErrorEnvelope } from "@korbat/contracts";

export function errorBody(code: string, message: string, requestId?: string, details?: unknown): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(requestId ? { requestId } : {}),
      ...(details !== undefined ? { details } : {}),
    },
  };
}
```

- [ ] **Step 4: Implement observability**

`apps/api/src/middleware/observability.ts`:
```ts
import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { Logger } from "pino";
import type { AppEnv } from "../env";

/** Request id (never client-supplied), child logger, and one access-log line per request. */
export function observability(logger: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = randomUUID();
    const start = performance.now();
    const log = logger.child({ requestId, cfRay: c.req.header("cf-ray") });
    c.set("requestId", requestId);
    c.set("log", log);
    await next();
    c.res.headers.set("x-request-id", requestId);
    log.info(
      { method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Math.round(performance.now() - start) },
      "request",
    );
  });
}
```

- [ ] **Step 5: Implement security headers**

`apps/api/src/middleware/security-headers.ts`:
```ts
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "../env";

/** The API only ever returns JSON, so the CSP forbids everything. HTML headers for the web app live in the Caddyfile. */
export const securityHeaders = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  referrerPolicy: "no-referrer",
  crossOriginResourcePolicy: "same-origin",
  crossOriginOpenerPolicy: "same-origin",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
});

export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});
```

- [ ] **Step 6: Implement rate limiting**

`apps/api/src/middleware/rate-limit.ts`:
```ts
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type Redis from "ioredis";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";

export interface RateLimitStore {
  /** Increments the counter for key and returns the new count plus ms until the window resets. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

export class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async hit(key: string, windowMs: number) {
    const t = this.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      this.buckets.set(key, { count: 1, resetAt: t + windowMs });
      return { count: 1, resetMs: windowMs };
    }
    b.count += 1;
    return { count: b.count, resetMs: b.resetAt - t };
  }
}

const LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {c, ttl}
`;

type RedisWithHit = Redis & { korbatRateHit(key: string, windowMs: number): Promise<[number, number]> };

export class RedisStore implements RateLimitStore {
  private readonly redis: RedisWithHit;
  constructor(redis: Redis) {
    redis.defineCommand("korbatRateHit", { numberOfKeys: 1, lua: LUA });
    this.redis = redis as RedisWithHit;
  }
  async hit(key: string, windowMs: number) {
    const [count, ttl] = await this.redis.korbatRateHit(`rl:${key}`, windowMs);
    return { count, resetMs: ttl > 0 ? ttl : windowMs };
  }
}

export interface RateLimitOptions {
  name: string;
  store: RateLimitStore;
  limit: number;
  windowMs: number;
  key: (c: Context<AppEnv>) => string;
}

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { count, resetMs } = await opts.store.hit(`${opts.name}:${opts.key(c)}`, opts.windowMs);
    const resetSec = Math.max(1, Math.ceil(resetMs / 1000));
    c.header("RateLimit-Limit", String(opts.limit));
    c.header("RateLimit-Remaining", String(Math.max(0, opts.limit - count)));
    c.header("RateLimit-Reset", String(resetSec));
    if (count > opts.limit) {
      c.header("Retry-After", String(resetSec));
      return c.json(errorBody("rate_limited", "Too many requests", c.get("requestId")), 429);
    }
    await next();
  });
}

/** Cloudflare sets cf-connecting-ip; Caddy forwards it. Anything else is a direct/dev connection. */
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "direct";
}
```

- [ ] **Step 7: Implement session stub and validate**

`apps/api/src/middleware/session.ts`:
```ts
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";

/**
 * Foundation stub: nobody is ever signed in. Sub-project 1 replaces this with
 * cookie (web) and bearer (native) session resolution against auth.sessions.
 * The requireSession contract stays the same.
 */
export const sessionStub = createMiddleware<AppEnv>(async (c, next) => {
  c.set("session", null);
  await next();
});

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("session")) {
    return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  }
  await next();
});
```

`apps/api/src/lib/validate.ts`:
```ts
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z, type ZodType } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "./errors";

/** zod validation that answers with the shared error envelope instead of Hono's default. */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator<T, Target, AppEnv>(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(errorBody("invalid_request", "Request validation failed", c.get("requestId"), z.treeifyError(result.error)), 400);
    }
    return undefined;
  });
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm --filter @korbat/api test && pnpm --filter @korbat/api typecheck`
Expected: 15 tests pass. If `zValidator` generic arity differs, drop the explicit generics and let inference work; the test is the contract.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(api): observability, security headers, rate limit, session stub, validation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `@korbat/api` app factory, health route, entrypoints, build

**Files:**
- Create: `apps/api/src/routes/health.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/migrate.ts`, `apps/api/tsup.config.ts`, `apps/api/.env.example`, `apps/api/test/app.test.ts`, `apps/api/test/integration/health.test.ts`

- [ ] **Step 1: Write the failing unit test**

`apps/api/test/app.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import pino from "pino";
import { HealthResponse } from "@korbat/contracts";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryStore } from "../src/middleware/rate-limit";

const config = loadConfig({
  DATABASE_URL_API: "postgres://a:b@localhost:5432/k",
  DATABASE_URL_AUTH: "postgres://a:b@localhost:5432/k",
  REDIS_URL: "redis://localhost:6379",
  KORBAT_VERSION: "9.9.9",
});

function app(checks: Record<string, () => Promise<void>>) {
  return createApp({ config, logger: pino({ level: "silent" }), rateLimitStore: new MemoryStore(), healthChecks: checks });
}

describe("GET /api/health", () => {
  test("200 ok when all checks pass", async () => {
    const res = await app({ postgres: async () => {}, redis: async () => {} }).request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toEqual({ status: "ok", version: "9.9.9", checks: { postgres: "ok", redis: "ok" } });
  });
  test("503 degraded when a check throws", async () => {
    const res = await app({ postgres: async () => { throw new Error("down"); }, redis: async () => {} }).request("/api/health");
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks).toEqual({ postgres: "fail", redis: "ok" });
  });
});

describe("routing", () => {
  test("unknown route returns 404 envelope", async () => {
    const res = await app({}).request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
  test("/api/me is 401 while the session stub is in place", async () => {
    expect((await app({}).request("/api/me")).status).toBe(401);
  });
  test("thrown errors become a 500 envelope without leaking the message", async () => {
    const a = app({});
    a.get("/api/boom", () => { throw new Error("secret detail"); });
    const res = await a.request("/api/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret detail");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "internal" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @korbat/api test`
Expected: FAIL, `../src/app` not found.

- [ ] **Step 3: Implement health route and app factory**

`apps/api/src/routes/health.ts`:
```ts
import { Hono } from "hono";
import type { HealthResponse } from "@korbat/contracts";
import type { AppEnv } from "../env";

export type HealthChecks = Record<string, () => Promise<void>>;

export function healthRoutes(checks: HealthChecks, version: string) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, fn]) => {
        try {
          await fn();
          return [name, "ok"] as const;
        } catch (err) {
          c.get("log").warn({ err, check: name }, "health check failed");
          return [name, "fail"] as const;
        }
      }),
    );
    const ok = entries.every(([, s]) => s === "ok");
    const body: HealthResponse = { status: ok ? "ok" : "degraded", version, checks: Object.fromEntries(entries) };
    return c.json(body, ok ? 200 : 503);
  });
  return r;
}
```

`apps/api/src/app.ts`:
```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Logger } from "pino";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { observability } from "./middleware/observability";
import { clientIp, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { requireSession, sessionStub } from "./middleware/session";
import { healthRoutes, type HealthChecks } from "./routes/health";

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
}

export function createApp({ config, logger, rateLimitStore, healthChecks }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(securityHeaders, noStore);
  app.use(cors({ origin: config.TRUSTED_ORIGINS, credentials: true }));
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIp }));
  app.use(sessionStub);

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION));
  app.get("/api/me", requireSession, (c) => c.json({ session: c.get("session") }));

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
```

- [ ] **Step 4: Run unit tests**

Run: `pnpm --filter @korbat/api test`
Expected: 20 tests pass.

- [ ] **Step 5: Entrypoints and build config**

`apps/api/src/index.ts`:
```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./lib/logger";
import { RedisStore } from "./middleware/rate-limit";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));

const app = createApp({
  config,
  logger,
  rateLimitStore: new RedisStore(redis),
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

`apps/api/src/migrate.ts`:
```ts
import path from "node:path";
import { runMigrations } from "@korbat/db/migrate";

const url = process.env.DATABASE_URL_MIGRATE;
if (!url) throw new Error("DATABASE_URL_MIGRATE is required");
const folder = path.resolve(process.env.MIGRATIONS_DIR ?? "../../packages/db/migrations");

runMigrations(url, folder)
  .then(() => { console.log(`migrations applied from ${folder}`); })
  .catch((err) => { console.error(err); process.exit(1); });
```

`apps/api/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", migrate: "src/migrate.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  noExternal: [/.*/],
  sourcemap: true,
  clean: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
```

`apps/api/.env.example`:
```
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL_API=postgres://korbat_api:change-me-api@localhost:5432/korbat
DATABASE_URL_AUTH=postgres://korbat_auth:change-me-auth@localhost:5432/korbat
DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:5432/korbat
REDIS_URL=redis://localhost:6379
TRUSTED_ORIGINS=http://localhost:8081
```

- [ ] **Step 6: Run against the compose data services**

```bash
cp apps/api/.env.example apps/api/.env
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis
(cd apps/api && set -a && . ./.env && set +a && pnpm dev) &
sleep 4
curl -si http://localhost:3000/api/health
```
Expected: `HTTP/1.1 200`, body `{"status":"ok","version":"0.0.0-dev","checks":{"postgres_api":"ok","postgres_auth":"ok","redis":"ok"}}`, headers include `x-request-id`, `content-security-policy`, `ratelimit-remaining`. Stop the dev server afterwards (`kill %1`).

- [ ] **Step 7: Integration test (gated)**

`apps/api/test/integration/health.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import Redis from "ioredis";
import { HealthResponse } from "@korbat/contracts";
import { closeDb, createDb, ping } from "@korbat/db";
import pino from "pino";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { RedisStore } from "../../src/middleware/rate-limit";

describe.skipIf(!process.env.INTEGRATION)("integration: health against real services", () => {
  test("all checks ok and redis rate limiting counts", async () => {
    const config = loadConfig();
    const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
    const authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
    const redis = new Redis(config.REDIS_URL);
    try {
      const app = createApp({
        config,
        logger: pino({ level: "silent" }),
        rateLimitStore: new RedisStore(redis),
        healthChecks: { postgres_api: () => ping(apiDb), postgres_auth: () => ping(authDb), redis: async () => { await redis.ping(); } },
      });
      const first = await app.request("/api/health");
      expect(first.status).toBe(200);
      expect(HealthResponse.parse(await first.json()).status).toBe("ok");
      const second = await app.request("/api/health");
      expect(Number(second.headers.get("ratelimit-remaining"))).toBeLessThan(Number(first.headers.get("ratelimit-remaining")));
    } finally {
      await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
    }
  });
});
```
Run: `(cd apps/api && set -a && . ./.env && set +a && pnpm test:integration)`
Expected: 1 test passes.

- [ ] **Step 8: Build and run the bundle**

```bash
pnpm --filter @korbat/api build && ls apps/api/dist
```
Expected: `index.js`, `migrate.js` (plus maps).
```bash
(cd apps/api && set -a && . ./.env && set +a && MIGRATIONS_DIR=../../packages/db/migrations node dist/migrate.js)
```
Expected: `migrations applied from ...` (idempotent, nothing new).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(api): app factory, health endpoint, entrypoints and tsup build

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `@korbat/worker` skeleton

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/tsup.config.ts`, `apps/worker/src/jobs.ts`, `apps/worker/src/index.ts`, `apps/worker/test/jobs.test.ts`

- [ ] **Step 1: Manifest and configs**

`apps/worker/package.json`:
```json
{
  "name": "@korbat/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/db": "workspace:*",
    "ioredis": "5.11.1",
    "pino": "10.3.1",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "tsup": "8.5.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3",
    "vitest": "4.1.11"
  }
}
```
`apps/worker/tsconfig.json`: same as api's. `apps/worker/tsup.config.ts`: same as api's but `entry: { index: "src/index.ts" }`.

- [ ] **Step 2: Write the failing test**

`apps/worker/test/jobs.test.ts`:
```ts
import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import { JobRegistry, parseJob } from "../src/jobs";

const ctx = { log: pino({ level: "silent" }) };

describe("parseJob", () => {
  test("parses a well-formed job", () => {
    expect(parseJob('{"type":"noop","payload":{"a":1}}')).toEqual({ type: "noop", payload: { a: 1 } });
  });
  test("rejects garbage", () => {
    expect(() => parseJob("nope")).toThrow();
    expect(() => parseJob('{"payload":1}')).toThrow(/type/);
  });
});

describe("JobRegistry", () => {
  test("dispatches to the registered handler", async () => {
    const handler = vi.fn(async () => {});
    await new JobRegistry().register("noop", handler).dispatch({ type: "noop", payload: 7 }, ctx);
    expect(handler).toHaveBeenCalledWith(7, ctx);
  });
  test("rejects duplicate and unknown types", async () => {
    const r = new JobRegistry().register("a", async () => {});
    expect(() => r.register("a", async () => {})).toThrow(/duplicate/);
    await expect(r.dispatch({ type: "b", payload: null }, ctx)).rejects.toThrow(/no handler/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @korbat/worker test`
Expected: FAIL, `../src/jobs` not found.

- [ ] **Step 4: Implement**

`apps/worker/src/jobs.ts`:
```ts
import type { Logger } from "pino";
import { z } from "zod";

export const JobSchema = z.object({ type: z.string().min(1), payload: z.unknown() });
export type Job = z.infer<typeof JobSchema>;
export interface JobContext { log: Logger }
export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>;

export const QUEUE_KEY = "korbat:jobs";

export function parseJob(raw: string): Job {
  return JobSchema.parse(JSON.parse(raw));
}

export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  register(type: string, handler: JobHandler): this {
    if (this.handlers.has(type)) throw new Error(`duplicate handler for job type: ${type}`);
    this.handlers.set(type, handler);
    return this;
  }
  async dispatch(job: Job, ctx: JobContext): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) throw new Error(`no handler for job type: ${job.type}`);
    await handler(job.payload, ctx);
  }
}
```

`apps/worker/src/index.ts`:
```ts
import Redis from "ioredis";
import pino from "pino";
import { JobRegistry, QUEUE_KEY, parseJob } from "./jobs";

/**
 * Foundation worker: a plain Redis list consumer. Sub-project 2 decides on a
 * real queue (retries, delays) when the image pipeline lands; the registry
 * interface stays.
 */
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required");
const log = pino({ level: process.env.LOG_LEVEL ?? "info", base: undefined });
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const registry = new JobRegistry().register("noop", async (_payload, ctx) => { ctx.log.info("noop job handled"); });

let running = true;
const stop = (signal: string) => { log.info({ signal }, "stopping after current job"); running = false; };
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

log.info("worker started");
while (running) {
  const item = await redis.blpop(QUEUE_KEY, 5);
  if (!item) continue;
  const raw = item[1];
  try {
    const job = parseJob(raw);
    await registry.dispatch(job, { log: log.child({ jobType: job.type }) });
  } catch (err) {
    log.error({ err }, "job failed");
  }
}
await redis.quit();
```

- [ ] **Step 5: Run tests, typecheck, build, and a live smoke**

```bash
pnpm --filter @korbat/worker test && pnpm --filter @korbat/worker typecheck && pnpm --filter @korbat/worker build
REDIS_URL=redis://localhost:6379 node apps/worker/dist/index.js &
sleep 1
docker compose -f infra/compose.yml exec redis redis-cli RPUSH korbat:jobs '{"type":"noop","payload":null}'
sleep 1; kill %1
```
Expected: worker logs `worker started` then `noop job handled`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(worker): redis list consumer with job registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: `@korbat/app` Expo web shell

**Files:**
- Create via scaffold: `apps/app/**`
- Create: `apps/app/global.css`, `apps/app/tailwind.config.js`, `apps/app/babel.config.js`, `apps/app/metro.config.js`, `apps/app/nativewind-env.d.ts`, `apps/app/src/lib/api.ts`
- Modify: `apps/app/package.json`, `apps/app/app.json`, `apps/app/app/_layout.tsx`, `apps/app/app/index.tsx`

- [ ] **Step 1: Scaffold with the official template (no install yet)**

```bash
cd apps && npx create-expo-app@latest app --template default --no-install && cd ..
```
Then in `apps/app/package.json` set `"name": "@korbat/app"`, add `"typecheck": "tsc --noEmit"` and `"web": "expo start --web"` to scripts, and add `"@korbat/contracts": "workspace:*"` to dependencies. Delete the template's `app/(tabs)` folder, `components/`, `constants/`, `hooks/`, and `scripts/reset-project.js`.

Run: `pnpm install`
Expected: installs Expo SDK 57 and pins.

- [ ] **Step 2: NativeWind**

```bash
pnpm --filter @korbat/app exec npx expo install nativewind
pnpm --filter @korbat/app add -D tailwindcss@3.4.19
```

`apps/app/global.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`apps/app/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: { extend: {} },
  plugins: [],
};
```

`apps/app/babel.config.js`:
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
```

`apps/app/metro.config.js`:
```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: "./global.css" });
```

`apps/app/nativewind-env.d.ts`:
```ts
/// <reference types="nativewind/types" />
```

In `apps/app/app.json` set `"expo.web": { "bundler": "metro", "output": "single", "favicon": "./assets/images/favicon.png" }` and `"expo.name": "korbat"`, `"expo.slug": "korbat"`, `"expo.scheme": "korbat"`.

- [ ] **Step 3: Screens and API client**

`apps/app/src/lib/api.ts`:
```ts
import { Platform } from "react-native";
import { HealthResponse } from "@korbat/contracts";

/** Same origin on web (Caddy proxies /api). Native needs an absolute URL. */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://localhost:3000");

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`, { credentials: "include" });
  return HealthResponse.parse(await res.json());
}
```

`apps/app/app/_layout.tsx`:
```tsx
import "../global.css";
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`apps/app/app/index.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { HealthResponse } from "@korbat/contracts";
import { fetchHealth } from "../src/lib/api";

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const status = error ? `api unreachable: ${error}` : health ? `api ${health.status} · v${health.version}` : "checking api…";

  return (
    <View className="flex-1 items-center justify-center bg-zinc-950 px-6">
      <Text className="text-4xl font-bold tracking-tight text-zinc-50">korbat</Text>
      <Text className="mt-3 text-base text-zinc-400">{status}</Text>
    </View>
  );
}
```

- [ ] **Step 4: Run on web against the dev API**

```bash
(cd apps/api && set -a && . ./.env && set +a && pnpm dev) &
EXPO_PUBLIC_API_URL=http://localhost:3000 pnpm --filter @korbat/app web
```
Expected: browser at http://localhost:8081 shows "korbat" and "api ok · v0.0.0-dev" on a dark background. Stop both processes.

- [ ] **Step 5: Typecheck and static export**

```bash
pnpm --filter @korbat/app typecheck && pnpm --filter @korbat/app exec npx expo export --platform web
ls apps/app/dist
```
Expected: `index.html` and `_expo/` present.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(app): expo web shell with nativewind calling /api/health

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Dockerfiles, Caddy, and the full compose stack

**Files:**
- Create: `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `infra/caddy/Dockerfile`, `infra/caddy/Caddyfile`, `.dockerignore`
- Modify: `infra/compose.yml`, `infra/compose.dev.yml`

- [ ] **Step 1: Ignore file for the root build context**

`.dockerignore`:
```
**/node_modules
**/dist
**/.expo
**/.env
**/.env.*
!**/.env.example
.git
docs
infra/.env
```

- [ ] **Step 2: API and worker images**

`apps/api/Dockerfile`:
```dockerfile
FROM node:24-alpine AS build
RUN npm install -g pnpm@10.30.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @korbat/api...
RUN pnpm --filter @korbat/api build

FROM node:24-alpine
ENV NODE_ENV=production
ARG KORBAT_VERSION=0.0.0
ENV KORBAT_VERSION=$KORBAT_VERSION
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

`apps/worker/Dockerfile`: identical except `apps/worker` in place of `apps/api`, no `migrations` copy, no `EXPOSE`.

- [ ] **Step 3: Caddy image with the web export baked in**

`infra/caddy/Dockerfile`:
```dockerfile
FROM node:24-alpine AS web
RUN npm install -g pnpm@10.30.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
RUN cd apps/app && npx expo export --platform web

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /repo/apps/app/dist /srv
```

`infra/caddy/Caddyfile` (plain HTTP inside the box; Cloudflare terminates TLS at the edge and the tunnel is encrypted):
```
{
  auto_https off
}

:80 {
  encode gzip

  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "no-referrer"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    -Server
  }

  handle /api/* {
    reverse_proxy api:3000
  }

  handle {
    root * /srv
    try_files {path} /index.html
    file_server
  }
}
```

- [ ] **Step 4: Add the app services to compose**

Append to `infra/compose.yml` under `services:`:
```yaml
  api:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
      args:
        KORBAT_VERSION: ${KORBAT_VERSION:-0.0.0}
    environment:
      NODE_ENV: production
      PORT: "3000"
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      DATABASE_URL_API: postgres://korbat_api:${KORBAT_API_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      DATABASE_URL_AUTH: postgres://korbat_auth:${KORBAT_AUTH_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://redis:6379
      TRUSTED_ORIGINS: ${API_TRUSTED_ORIGINS:-}
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      REDIS_URL: redis://redis:6379
    depends_on:
      redis: { condition: service_healthy }

  caddy:
    restart: unless-stopped
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
    depends_on:
      api: { condition: service_healthy }
    volumes:
      - caddydata:/data
      - caddyconfig:/config

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    profiles: ["tunnel"]
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    depends_on:
      - caddy
```
Add `caddydata:` and `caddyconfig:` under `volumes:`.

Append to `infra/compose.dev.yml`:
```yaml
  api:
    ports: ["3000:3000"]
  caddy:
    ports: ["8080:80"]
```

- [ ] **Step 5: Validate and bring the whole stack up**

```bash
docker compose -f infra/compose.yml config -q && echo "compose ok"
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build
docker compose -f infra/compose.yml ps
```
Expected: `postgres`, `redis`, `minio`, `api`, `worker`, `caddy` running; `migrate` and `minio-init` exited 0.

```bash
curl -s http://localhost:8080/api/health
curl -sI http://localhost:8080/ | grep -i -E "content-security-policy|x-frame-options"
```
Expected: health JSON with all checks `ok`; both headers present. Open http://localhost:8080 in a browser: "korbat" and "api ok · v0.0.0", no CSP errors in the console. If the console shows a CSP violation for an inline script from the Expo export, add its hash (`'sha256-...'` from the console message) to `script-src` in the Caddyfile and rebuild.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(infra): api, worker and caddy images; full compose stack

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: CI, Renovate, admin placeholder

**Files:**
- Create: `.github/workflows/ci.yml`, `renovate.json`, `apps/admin/package.json`, `apps/admin/README.md`

- [ ] **Step 1: Admin placeholder so the workspace shape is complete**

`apps/admin/package.json`:
```json
{ "name": "@korbat/admin", "version": "0.0.0", "private": true, "type": "module" }
```
`apps/admin/README.md`:
```markdown
# @korbat/admin
Moderation console. Built in sub-project 3 (Trust & safety). Deploys as its own container on its own hostname behind Cloudflare Access.
```

- [ ] **Step 2: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.30.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm audit --audit-level high
      - run: pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build
      - run: docker compose --env-file infra/.env.example -f infra/compose.yml config -q

  semgrep:
    runs-on: ubuntu-latest
    container: semgrep/semgrep
    steps:
      - uses: actions/checkout@v4
      - run: semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist
```

- [ ] **Step 3: Renovate**

`renovate.json`:
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits"],
  "schedule": ["before 6am on monday"],
  "packageRules": [
    { "matchUpdateTypes": ["minor", "patch"], "groupName": "non-major dependencies" },
    { "matchPackageNames": ["expo", "react-native"], "enabled": false, "description": "Expo SDK upgrades are done by hand with expo upgrade" }
  ],
  "vulnerabilityAlerts": { "enabled": true, "labels": ["security"] }
}
```

- [ ] **Step 4: Run the CI steps locally**

```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm audit --audit-level high
docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist
```
Expected: all exit 0. If `pnpm audit` reports a high finding in a transitive dep with no fix, add it to `pnpm.auditConfig.ignoreCves` in the root package.json with a comment in the commit message; never lower the level.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "ci: typecheck, tests, audit, semgrep, compose validation; renovate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Cloudflare Tunnel

No repo files change here beyond `infra/.env`. This is the "reachable from the internet with no open ports" proof.

- [ ] **Step 1: Create the tunnel (manual, Cloudflare dashboard)**

1. Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared → name `korbat-dev`.
2. Choose the Docker install option and copy only the token from the shown command.
3. Public Hostname tab: subdomain `dev`, your domain, Service type `HTTP`, URL `caddy:80`. Save.
4. Put the token in `infra/.env` as `TUNNEL_TOKEN=...`.

- [ ] **Step 2: Start the tunnel service**

```bash
docker compose -f infra/compose.yml --profile tunnel up -d cloudflared
docker compose -f infra/compose.yml logs cloudflared | tail -5
```
Expected: log lines containing `Registered tunnel connection`.

- [ ] **Step 3: Verify from outside**

```bash
curl -s https://dev.<your-domain>/api/health
curl -sI https://dev.<your-domain>/ | grep -i -E "cf-ray|content-security-policy"
```
Expected: health JSON with all checks `ok`; a `cf-ray` header (proves Cloudflare is in front) and the CSP header (proves Caddy served it). Open the URL in a browser: the korbat shell renders and shows `api ok`.

- [ ] **Step 4: Confirm nothing is exposed directly**

On the host: `docker compose -f infra/compose.yml ps --format "{{.Name}} {{.Ports}}"` with only `compose.yml` (no dev override) must show no published ports for `api` or `caddy`. Restart without the dev override before leaving it running: `docker compose -f infra/compose.yml --profile tunnel up -d`.

- [ ] **Step 5: Record the hostname**

Add a line to `README.md` under a new `## Environments` heading: `dev: https://dev.<your-domain> (Cloudflare Tunnel korbat-dev)`. Commit:
```bash
git add README.md && git commit -m "docs: dev environment hostname

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Verification (definition of done for sub-project 0)

1. `pnpm typecheck && pnpm test` pass locally with 30+ tests across contracts, rules, db, api, worker.
2. Role isolation checks from Task 8 Step 5 all print the expected results (api role cannot read `auth.*`, cannot update `audit_log`; auth role cannot read `public.*`).
3. `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build` from a clean state (`down -v` first) ends with every long-running service healthy, and http://localhost:8080 shows the shell with `api ok`.
4. The API integration test passes against the compose services.
5. The Expo web shell has no CSP console errors under the Caddy headers.
6. `https://dev.<your-domain>/api/health` responds through the tunnel with a `cf-ray` header, and no host ports are published in the non-dev configuration.
7. CI is green on the first push to GitHub (typecheck, tests, audit, builds, compose config, semgrep).

## Handoff to sub-project 1

Sub-project 1 (Identity & auth) starts with a short brainstorm, then its own plan. It replaces `apps/api/src/middleware/session.ts` (keeping the `requireSession` contract and `Session` shape from `apps/api/src/env.ts`), adds `apps/api/src/auth/**`, and uses the `authDb` pool from `apps/api/src/index.ts`. The tables it needs already exist in `packages/db/src/schema/auth.ts`.

---

## Addendum (2026-09-13): dry-run corrections

The whole plan was executed in a scratch clone against real containers. The execution prompts in `docs/superpowers/prompts/foundation/` carry the corrected files and the observed outputs and are the verified source; where this plan and a prompt differ, the prompt wins. Corrections found:

1. **Task 4 test**: `filter((v): v is PgTable => is(v, PgTable))` does not compile because `.enableRLS()` returns an `Omit<...>` type. Use `filter((v) => is(v, PgTable)) as PgTable[]`.
2. **Task 10 `validate.ts`**: `zValidator` needs five explicit type arguments in @hono/zod-validator 0.9.1; the hook is typed `Hook<z.infer<T>, AppEnv, string, Target, {}, T>` so `result.error` is a zod v4 error. Test count is 14 after Task 10, 19 after Task 11.
3. **Task 9 logger**: pino-pretty must be used as an in-process stream (`pino(options, pinoPretty(...))`), not a transport, because a transport spawns a worker via `__dirname`, which does not exist inside the tsup ESM bundle. `pino-pretty` moves to `dependencies`.
4. **Task 8 images**: `minio/minio` and `minio/mc` are no longer on Docker Hub. Use `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` and `quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z`.
5. **Task 8 isolation check**: an unqualified `profiles` from `korbat_auth` yields `relation "profiles" does not exist`; the check uses `public.profiles` to get `permission denied for schema public`.
6. **Task 13**: the current Expo 57 template puts routes in `src/app`, has no tabs group, pins TypeScript 6, and `create-expo-app` prompts interactively. The app is now hand-written with exact pins resolved from the template (expo 57.0.22, react-native 0.86.3, react 19.2.3, expo-router 57.0.21, reanimated 4.5.1, worklets 0.10.1, screens 4.26.2, safe-area 5.7.0, gesture-handler 2.32.0, web 0.21.2, nativewind 4.2.6, tailwindcss 3.4.19).
7. **Task 11**: a clean `rm -rf node_modules && pnpm install --frozen-lockfile` precedes the build; the hoisted `node_modules` lost transitive files after several incremental installs on Windows.
8. **Task 15**: semgrep on Git Bash needs `MSYS_NO_PATHCONV=1 -v "$(pwd -W):/src"`. Its rulesets require SHA-pinned actions (checkout v7.0.1, pnpm/action-setup v6.1.0, setup-node v7.0.0), a 7-day minimum release age in pnpm (`minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true`), `.npmrc` `min-release-age=7`, and `minimumReleaseAge` on every Renovate `packageRules` entry. The release-age floor is applied in Task 15, after the lockfile is complete, because a fresh resolve under the floor fails whenever any transitive package is under a week old.
9. **Task 1**: root `package.json` gains `pnpm.onlyBuiltDependencies: ["esbuild"]` to silence pnpm 10's ignored-build-scripts warning.
10. **Dev host ports (2026-09-14)**: the development machine already runs a Postgres on 5432 and a service on 9000/9001. `compose.dev.yml` publishes korbat on 55432 (Postgres), 56379 (Redis), 59000/59001 (MinIO); `apps/api/.env.example`, `drizzle.config.ts` defaults, and every host-side command use those ports. Container-internal ports are unchanged. The README quick start no longer starts `migrate` by name, because that service needs the API image from Task 14.
11. **Real execution (2026-09-14)**: dev ports bind to 127.0.0.1; `infra/.env` uses random secrets and `apps/api/.env` derives from it; `test:integration` uses `apps/api/vitest.integration.config.ts` (inline env vars fail under cmd.exe); `tailwind.config.js` sets `darkMode: "class"` (NativeWind throws in dev under "media"); Windows process cleanup uses PowerShell, and the worker smoke test gates on Redis consumer counts. The prompts carry all of these.
