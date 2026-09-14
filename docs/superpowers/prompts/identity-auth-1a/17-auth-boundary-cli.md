# korbat 1a — Task 17 of 21: Auth module boundary test and the grant-role CLI

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Only `src/auth/index.ts` may be imported from outside the auth folder; the auth database pool and auth keys stay inside it; the auth module never touches public-schema tables. An architecture test enforces all of this and is proven to fail on a deliberate violation. The `grant-role` CLI is the only way to change a role, and writes an audit-log entry.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): HTTP routes, bearer/cookie session resolution with CSRF and Origin checks, guards; wire auth into the API`.
3. The previous task's last API unit run ended with `Tests  78 passed | 56 skipped (134)`.

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

### Create `apps/api/test/architecture.test.ts`

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The auth module boundary (1a spec, section 2.2). Paths are relative to apps/api/src with forward slashes.
 * The rules are plain functions so the tests below can prove each one catches a deliberate violation.
 */
interface SourceFile {
  path: string;
  source: string;
}

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA_ROOT = fileURLToPath(new URL("../../../packages/db/src/schema", import.meta.url));

/** Schema files that define auth-schema objects or shared helpers; every other schema file is public. */
const NON_PUBLIC_SCHEMA_FILES = new Set(["auth.ts", "helpers.ts", "index.ts"]);
const AUTH_POOL_ALLOWED = new Set(["config.ts", "index.ts", "cli/grant-role.ts"]);
const AUTH_KEYS_ALLOWED = new Set(["config.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function loadSources(): SourceFile[] {
  return walk(SRC_ROOT).map((full) => ({ path: relative(SRC_ROOT, full).split(sep).join("/"), source: readFileSync(full, "utf8") }));
}

/** Names exported by the public-schema files of @korbat/db (tables and enums the auth module must not touch). */
function publicSchemaNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SCHEMA_ROOT)) {
    if (!file.endsWith(".ts") || NON_PUBLIC_SCHEMA_FILES.has(file)) continue;
    const source = readFileSync(join(SCHEMA_ROOT, file), "utf8");
    for (const match of source.matchAll(/^export (?:const|function|type|interface|enum) ([A-Za-z0-9_]+)/gm)) names.add(match[1]!);
  }
  return names;
}

/** Every module specifier in static imports, re-exports, side-effect imports and dynamic imports. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]!);
}

const insideAuth = (path: string) => path.startsWith("auth/");

function findViolations(files: SourceFile[], publicNames: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (!insideAuth(path) && spec.startsWith(".")) {
        const target = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/\.ts$/, "");
        if (target.startsWith("auth/") && target !== "auth/index") violations.push(`${path}: imports ${spec}, which is inside the auth module (use ./auth)`);
      }
    }
    if (!insideAuth(path) && !AUTH_POOL_ALLOWED.has(path) && /\b(DATABASE_URL_AUTH|authDb)\b/.test(source)) {
      violations.push(`${path}: references the auth database pool`);
    }
    if (!insideAuth(path) && !AUTH_KEYS_ALLOWED.has(path) && /\b(TOTP_ENC_KEY|AUTH_HMAC_KEY|IP_HASH_KEY)\b/.test(source)) {
      violations.push(`${path}: references an auth key`);
    }
    if (insideAuth(path)) {
      for (const match of source.matchAll(/\bimport\s+(type\s+)?(\*\s+as\s+\w+|\{[^}]*\})\s+from\s+["'](@korbat\/db(?:\/[^"']*)?)["']/g)) {
        const bindings = match[2]!;
        if (bindings.startsWith("*")) {
          violations.push(`${path}: namespace import of ${match[3]} (import auth-schema names explicitly)`);
          continue;
        }
        const names = bindings
          .slice(1, -1)
          .split(",")
          .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim())
          .filter(Boolean);
        for (const name of names) if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db`);
      }
    }
  }
  return violations;
}

describe("auth module boundary", () => {
  test("walks the real source tree", () => {
    const paths = loadSources().map((f) => f.path);
    expect(paths).toContain("auth/index.ts");
    expect(paths).toContain("app.ts");
    expect(publicSchemaNames()).toContain("profiles");
    expect(publicSchemaNames()).not.toContain("users");
  });

  test("apps/api/src has no boundary violations", () => {
    expect(findViolations(loadSources(), publicSchemaNames())).toEqual([]);
  });

  test("allows the auth index, the permitted pool owners and auth-schema imports", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createAuth } from "./auth";\nimport type { Auth } from "./auth/index";` },
      { path: "profiles/store.ts", source: `import { isUniqueViolation } from "../auth";` },
      { path: "cli/grant-role.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "index.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "config.ts", source: `AUTH_HMAC_KEY: base64Key, IP_HASH_KEY: base64Key, TOTP_ENC_KEY: versionedKey, DATABASE_URL_AUTH: url` },
      { path: "auth/repo.ts", source: `import { users, sessions, type Db } from "@korbat/db";\nconst k = config.TOTP_ENC_KEY;` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]))).toEqual([]);
  });

  test("catches a deep import into the auth module", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `import { hashPassword } from "../auth/passwords";` },
      { path: "app.ts", source: `export { createSessions } from "./auth/sessions.ts";\nconst m = await import("./auth/repo");` },
    ];
    expect(findViolations(files, new Set())).toEqual([
      "routes/posts.ts: imports ../auth/passwords, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/sessions.ts, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/repo, which is inside the auth module (use ./auth)",
    ]);
  });

  test("catches auth pool and auth key references outside their owners", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `const url = config.DATABASE_URL_AUTH;` },
      { path: "profiles/store.ts", source: `export function f(authDb: Db) {}` },
      { path: "lib/hash.ts", source: `const key = config.IP_HASH_KEY;` },
      { path: "index.ts", source: `const k = config.AUTH_HMAC_KEY;` },
    ];
    expect(findViolations(files, new Set())).toEqual([
      "routes/posts.ts: references the auth database pool",
      "profiles/store.ts: references the auth database pool",
      "lib/hash.ts: references an auth key",
      "index.ts: references an auth key",
    ]);
  });

  test("catches public-schema imports inside the auth module", () => {
    const files: SourceFile[] = [
      { path: "auth/repo.ts", source: `import { users, profiles as p, type Db } from "@korbat/db";` },
      { path: "auth/flows/x.ts", source: `import type { posts } from "@korbat/db";` },
      { path: "auth/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]))).toEqual([
      "auth/repo.ts: imports public-schema profiles from @korbat/db",
      "auth/flows/x.ts: imports public-schema posts from @korbat/db",
      "auth/flows/y.ts: namespace import of @korbat/db (import auth-schema names explicitly)",
    ]);
  });
});
```

### Create `apps/api/test/cli-grant-role.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { GRANT_ROLE_USAGE, parseGrantRoleArgs } from "../src/cli/grant-role";

describe("grant-role arguments", () => {
  test("accepts an email and a role, normalising the email", () => {
    expect(parseGrantRoleArgs([" Mod@Korbat.Local ", "moderator"])).toEqual({ email: "mod@korbat.local", role: "moderator" });
    expect(parseGrantRoleArgs(["a@b.io", "user"]).role).toBe("user");
    expect(parseGrantRoleArgs(["a@b.io", "admin"]).role).toBe("admin");
  });

  test("prints usage for a wrong number of arguments", () => {
    expect(() => parseGrantRoleArgs([])).toThrow(GRANT_ROLE_USAGE);
    expect(() => parseGrantRoleArgs(["a@b.io"])).toThrow(GRANT_ROLE_USAGE);
    expect(() => parseGrantRoleArgs(["a@b.io", "admin", "extra"])).toThrow(GRANT_ROLE_USAGE);
  });

  test("rejects an unknown role", () => {
    expect(() => parseGrantRoleArgs(["a@b.io", "superuser"])).toThrow("unknown role: superuser");
    expect(() => parseGrantRoleArgs(["a@b.io", "Admin"])).toThrow("unknown role: Admin");
  });

  test("rejects something that is not an email address", () => {
    expect(() => parseGrantRoleArgs(["moderator", "a@b.io"])).toThrow("not an email address: moderator");
  });
});
```

### Create `apps/api/test/integration/cli-grant-role.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditLog, closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { SYSTEM_ACTOR_ID, runGrantRole } from "../../src/cli/grant-role";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: grant-role CLI", () => {
  let authDb: Db;
  let apiDb: Db;

  beforeAll(() => {
    const config = loadConfig();
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  test("grants a staff role, revokes every session and writes an audit entry", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect(await sessions.resolve(issued.token)).not.toBeNull();

    const result = await runGrantRole({ authDb, apiDb, kv }, user.email, "moderator");

    expect(result).toEqual({ userId: user.id, previousRole: "user" });
    expect((await repo.findUserById(user.id))!.role).toBe("moderator");
    expect(await sessions.resolve(issued.token)).toBeNull();
    const entries = await apiDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, user.id), eq(auditLog.action, "role_granted")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: SYSTEM_ACTOR_ID, targetType: "user", metadata: { from: "user", to: "moderator", via: "cli" } });
  });

  test("an unknown email fails without writing an audit entry", async () => {
    const before = await apiDb.$count(auditLog);
    await expect(runGrantRole({ authDb, apiDb, kv: new MemoryKv() }, `nobody-${randomUUID()}@korbat.local`, "admin")).rejects.toThrow("no account for");
    expect(await apiDb.$count(auditLog)).toBe(before);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Test Files  2 failed`
- `Cannot find module`

Observed on the dry run:

```text
Test Files  2 failed | 16 passed | 9 skipped (27)
Error: Cannot find module '../src/cli/grant-role' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/cli-grant-role.test.ts
Error: Cannot find module '../../src/cli/grant-role' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/cli-grant-role.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/cli/grant-role.ts`

```ts
/**
 * Changes an account's role. Run on the server only; there is no API endpoint for this.
 *
 *   docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
 *
 * Every session of the account is revoked, and the change is written to public.audit_log.
 */
import { pathToFileURL } from "node:url";
import Redis from "ioredis";
import { Email, Role } from "@korbat/contracts";
import { auditLog, closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions, grantRole, redisKv, type KeyValueStore, type UserRole } from "../auth";
import { loadConfig } from "../config";

/** Audit-log actor for changes made from the server console rather than by a signed-in person. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
export const GRANT_ROLE_USAGE = "usage: node dist/grant-role.js <email> <user|moderator|admin>";

export function parseGrantRoleArgs(args: readonly string[]): { email: string; role: UserRole } {
  if (args.length !== 2) throw new Error(GRANT_ROLE_USAGE);
  const email = Email.safeParse(args[0]);
  if (!email.success) throw new Error(`not an email address: ${args[0]}\n${GRANT_ROLE_USAGE}`);
  const role = Role.safeParse(args[1]);
  if (!role.success) throw new Error(`unknown role: ${args[1]}\n${GRANT_ROLE_USAGE}`);
  return { email: email.data, role: role.data };
}

export async function runGrantRole(deps: { authDb: Db; apiDb: Db; kv: KeyValueStore }, email: string, role: UserRole) {
  const repo = createAuthRepo(deps.authDb);
  const sessions = createSessions({ repo, kv: deps.kv });
  const result = await grantRole({ repo, sessions }, email, role);
  await deps.apiDb.insert(auditLog).values({
    actorId: SYSTEM_ACTOR_ID,
    action: "role_granted",
    targetType: "user",
    targetId: result.userId,
    metadata: { from: result.previousRole, to: role, via: "cli" },
  });
  return result;
}

async function main(): Promise<number> {
  let parsed: { email: string; role: UserRole };
  try {
    parsed = parseGrantRoleArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  const config = loadConfig();
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
  try {
    const { userId, previousRole } = await runGrantRole({ authDb, apiDb, kv: redisKv(redis) }, parsed.email, parsed.role);
    console.log(`user ${userId}: role ${previousRole} -> ${parsed.role}; every session revoked`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { Db } from "@korbat/db";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { authConfigFrom, type AuthDeps, type ProfileStore } from "./context";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStaffMfa, resolveSession } from "./middleware";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions } from "./sessions";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";

export type { ProfileStore } from "./context";
export type { UserRole } from "./repo";
export type { Session } from "./sessions";
export { AuthError, isUniqueViolation } from "./context";
export { grantRole } from "./admin";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

export interface CreateAuthOptions {
  config: Config;
  logger: Logger;
  /** The korbat_auth pool. The auth module never receives the API pool. */
  authDb: Db;
  mailer: Mailer;
  profiles: ProfileStore;
  /** Either a Redis client or a ready key-value store (tests use an in-memory store). */
  redis?: Redis;
  kv?: KeyValueStore;
  turnstile?: TurnstileVerifier;
  breachChecker?: BreachChecker;
  now?: () => Date;
}

export function createAuth(options: CreateAuthOptions) {
  const kv = options.kv ?? (options.redis ? redisKv(options.redis) : undefined);
  if (!kv) throw new Error("createAuth needs a Redis client or a key-value store");
  const now = options.now ?? (() => new Date());
  const repo = createAuthRepo(options.authDb);
  const sessions = createSessions({ repo, kv, now });
  const deps: AuthDeps = {
    repo,
    kv,
    sessions,
    lockout: createLockout({ repo, kv, now }),
    mailer: options.mailer,
    turnstile: options.turnstile ?? cloudflareTurnstile(options.config.TURNSTILE_SECRET_KEY),
    breachChecker: options.breachChecker ?? hibpChecker(),
    profiles: options.profiles,
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    requireStaffMfa,
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  88 passed | 58 skipped (146)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  88 passed | 58 skipped (146)
```

## Step 5: verify: typecheck

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 6: verify: deliberate-violation

```bash
printf 'import { hashPassword } from "./auth/passwords";\nexport const leaked = hashPassword;\n' > apps/api/src/zz-violation.ts; pnpm --filter @korbat/api exec vitest run test/architecture.test.ts; rm -f apps/api/src/zz-violation.ts; echo "violation file present: $(ls apps/api/src/zz-violation.ts 2>/dev/null | wc -l)"
```

Expected output contains:

- `zz-violation.ts: imports ./auth/passwords, which is inside the auth module (use ./auth)`
- `Tests  1 failed | 5 passed (6)`
- `violation file present: 0`

Observed on the dry run:

```text
Tests  1 failed | 5 passed (6)
violation file present: 0
+   "zz-violation.ts: imports ./auth/passwords, which is inside the auth module (use ./auth)",
```

## Step 7: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  58 passed (58)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  58 passed (58)
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/index.ts`
- `apps/api/src/cli/grant-role.ts`
- `apps/api/test/architecture.test.ts`
- `apps/api/test/cli-grant-role.test.ts`
- `apps/api/test/integration/cli-grant-role.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(auth): architecture test enforcing the auth module boundary; grant-role CLI with audit log entry" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): architecture test enforcing the auth module boundary; grant-role CLI with audit log entry`.

## Report format (mandatory)

```text
TASK 17 REPORT
Files written: <count, expected 5>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "deliberate-violation": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
