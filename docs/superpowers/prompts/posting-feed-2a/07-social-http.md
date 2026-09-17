# korbat 2a — Task 7 of 13: Social routes, the module entry point, app wiring and the boundary test for the social module

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

This task puts the social module on HTTP: routes that only validate, call a flow and shape the response, mounted at `/api` behind the auth module's requireSession for every write; the module's entry point; the app and server wiring; and the architecture test extended so nothing outside the module reaches into it and nothing inside touches the auth schema. The task proves the boundary test fails on a deliberate violation.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(social): follow, block and mute flows; profile views and follower lists; Following, Latest, profile, likes and bookmarks pages`.
3. The previous task's last API unit run ended with `Tests  102 passed | 88 skipped (190)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

### Replace `apps/api/test/architecture.test.ts` (whole file)

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Module boundaries (1a spec section 2.2, 2a spec section 2.2). Paths are relative to apps/api/src
 * with forward slashes. The rules are plain functions so the tests below can prove each one catches
 * a deliberate violation.
 */
interface SourceFile {
  path: string;
  source: string;
}

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA_ROOT = fileURLToPath(new URL("../../../packages/db/src/schema", import.meta.url));

/** Schema files that define auth-schema objects or shared helpers; every other schema file is public. */
const NON_PUBLIC_SCHEMA_FILES = new Set(["auth.ts", "helpers.ts", "index.ts"]);
const AUTH_SCHEMA_FILE = "auth.ts";
const AUTH_POOL_ALLOWED = new Set(["config.ts", "index.ts", "cli/grant-role.ts"]);
const AUTH_KEYS_ALLOWED = new Set(["config.ts"]);

/** Modules that may only be entered through their index file. */
const MODULES = ["auth", "social"] as const;

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

function exportedNames(file: string): string[] {
  const source = readFileSync(join(SCHEMA_ROOT, file), "utf8");
  return [...source.matchAll(/^export (?:const|function|type|interface|enum) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
}

/** Names exported by the public-schema files of @korbat/db (tables and enums the auth module must not touch). */
function publicSchemaNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SCHEMA_ROOT)) {
    if (!file.endsWith(".ts") || NON_PUBLIC_SCHEMA_FILES.has(file)) continue;
    for (const name of exportedNames(file)) names.add(name);
  }
  return names;
}

/** Names exported by the auth-schema file of @korbat/db (tables and enums the social module must not touch). */
function authSchemaNames(): Set<string> {
  return new Set(exportedNames(AUTH_SCHEMA_FILE));
}

/** Every module specifier in static imports, re-exports, side-effect imports and dynamic imports. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]!);
}

/** Named bindings of every `import { ... } from "@korbat/db"`; a namespace import yields the marker "*". */
function dbImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/\bimport\s+(type\s+)?(\*\s+as\s+\w+|\{[^}]*\})\s+from\s+["'](@korbat\/db(?:\/[^"']*)?)["']/g)) {
    const bindings = match[2]!;
    if (bindings.startsWith("*")) {
      names.push("*");
      continue;
    }
    for (const part of bindings.slice(1, -1).split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

const insideAuth = (path: string) => path.startsWith("auth/");
const insideSocial = (path: string) => path.startsWith("social/");

function findViolations(files: SourceFile[], publicNames: Set<string>, authNames: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/\.ts$/, "");
      for (const module of MODULES) {
        if (path.startsWith(`${module}/`)) continue;
        if (target.startsWith(`${module}/`) && target !== `${module}/index`) {
          violations.push(`${path}: imports ${spec}, which is inside the ${module} module (use ./${module})`);
        }
      }
    }
    if (!insideAuth(path) && !AUTH_POOL_ALLOWED.has(path) && /\b(DATABASE_URL_AUTH|authDb)\b/.test(source)) {
      violations.push(`${path}: references the auth database pool`);
    }
    if (!insideAuth(path) && !AUTH_KEYS_ALLOWED.has(path) && /\b(TOTP_ENC_KEY|AUTH_HMAC_KEY|IP_HASH_KEY)\b/.test(source)) {
      violations.push(`${path}: references an auth key`);
    }
    if (insideAuth(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import auth-schema names explicitly)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db`);
      }
    }
    if (insideSocial(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import public-schema names explicitly)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db`);
      }
    }
  }
  return violations;
}

describe("module boundaries", () => {
  test("walks the real source tree", () => {
    const paths = loadSources().map((f) => f.path);
    expect(paths).toContain("auth/index.ts");
    expect(paths).toContain("social/index.ts");
    expect(paths).toContain("app.ts");
    expect(publicSchemaNames()).toContain("profiles");
    expect(publicSchemaNames()).not.toContain("users");
    expect(authSchemaNames()).toContain("users");
    expect(authSchemaNames()).not.toContain("posts");
  });

  test("apps/api/src has no boundary violations", () => {
    expect(findViolations(loadSources(), publicSchemaNames(), authSchemaNames())).toEqual([]);
  });

  test("allows the module indexes, the permitted pool owners and each module's own schema", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createAuth } from "./auth";\nimport type { Auth } from "./auth/index";\nimport { createSocial } from "./social";` },
      { path: "profiles/store.ts", source: `import { isUniqueViolation } from "../auth";` },
      { path: "cli/grant-role.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "index.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "config.ts", source: `AUTH_HMAC_KEY: base64Key, IP_HASH_KEY: base64Key, TOTP_ENC_KEY: versionedKey, DATABASE_URL_AUTH: url` },
      { path: "auth/repo.ts", source: `import { users, sessions, type Db } from "@korbat/db";\nconst k = config.TOTP_ENC_KEY;` },
      { path: "social/repo.ts", source: `import { posts, profiles, type Db } from "@korbat/db";\nimport { SocialError } from "./context";` },
      { path: "social/routes.ts", source: `import type { Auth } from "../auth";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]), new Set(["users", "sessions"]))).toEqual([]);
  });

  test("catches a deep import into the auth module", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `import { hashPassword } from "../auth/passwords";` },
      { path: "app.ts", source: `export { createSessions } from "./auth/sessions.ts";\nconst m = await import("./auth/repo");` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: imports ../auth/passwords, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/sessions.ts, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/repo, which is inside the auth module (use ./auth)",
    ]);
  });

  test("catches a deep import into the social module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createSocialRepo } from "./social/repo";` },
      { path: "auth/flows/signup.ts", source: `import { createPost } from "../../social/flows/posts";` },
      { path: "social/flows/graph.ts", source: `import { ownProfile } from "./posts";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./social/repo, which is inside the social module (use ./social)",
      "auth/flows/signup.ts: imports ../../social/flows/posts, which is inside the social module (use ./social)",
    ]);
  });

  test("catches auth pool and auth key references outside their owners", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `const url = config.DATABASE_URL_AUTH;` },
      { path: "profiles/store.ts", source: `export function f(authDb: Db) {}` },
      { path: "lib/hash.ts", source: `const key = config.IP_HASH_KEY;` },
      { path: "index.ts", source: `const k = config.AUTH_HMAC_KEY;` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
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
    expect(findViolations(files, new Set(["profiles", "posts"]), new Set())).toEqual([
      "auth/repo.ts: imports public-schema profiles from @korbat/db",
      "auth/flows/x.ts: imports public-schema posts from @korbat/db",
      "auth/flows/y.ts: namespace import of @korbat/db (import auth-schema names explicitly)",
    ]);
  });

  test("catches auth-schema imports inside the social module", () => {
    const files: SourceFile[] = [
      { path: "social/repo.ts", source: `import { posts, users as u, type Db } from "@korbat/db";` },
      { path: "social/flows/x.ts", source: `import type { sessions } from "@korbat/db";` },
      { path: "social/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users", "sessions"]))).toEqual([
      "social/repo.ts: imports auth-schema users from @korbat/db",
      "social/flows/x.ts: imports auth-schema sessions from @korbat/db",
      "social/flows/y.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });
});
```

### Replace `apps/api/test/app.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import pino from "pino";
import { HealthResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { MemoryKv } from "../src/auth/kv";
import { loadConfig } from "../src/config";
import { MemoryMailer } from "../src/mail/memory";
import { MemoryStore } from "../src/middleware/rate-limit";
import { createSocial } from "../src/social";

const key = Buffer.alloc(32, 7).toString("base64");

const config = loadConfig({
  DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
  DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
  REDIS_URL: "redis://localhost:56379",
  KORBAT_VERSION: "9.9.9",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
});

/** The real app with both modules; the database pools are created but never connect in these tests. */
function app(checks: Record<string, () => Promise<void>>) {
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null },
  });
  const social = createSocial({ apiDb: createDb(config.DATABASE_URL_API, { max: 1 }), rateLimitStore, logger, requireSession: auth.requireSession });
  return createApp({ config, logger, rateLimitStore, healthChecks: checks, auth, social });
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
  test("/api/me is 401 without a session", async () => {
    const res = await app({}).request("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });
  test("state-changing requests from another origin are refused before any handler runs", async () => {
    const res = await app({}).request("/api/auth/email/start", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "csrf_failed" } });
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

describe("social routes", () => {
  test("writes and the Following timeline need a session", async () => {
    const a = app({});
    const post = await a.request("/api/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "hi" }) });
    expect(post.status).toBe(401);
    expect(await post.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request("/api/timeline/following")).status).toBe(401);
    expect((await a.request("/api/me/bookmarks")).status).toBe(401);
  });
  test("malformed ids and handles are refused before any query runs", async () => {
    const a = app({});
    const post = await a.request("/api/posts/not-a-uuid");
    expect(post.status).toBe(400);
    expect(await post.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect((await a.request("/api/profiles/has%20space")).status).toBe(400);
    expect((await a.request("/api/timeline/latest?limit=500")).status).toBe(400);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../src/social'`

Observed on the dry run:

```text
Error: Cannot find module '../src/social' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/app.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/social/routes.ts`

```ts
import { CreatePostRequest, HandleParam, Pagination, PostId } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { SocialError, type SocialDeps, type ViewerId } from "./context";
import { setEngagement, type EngagementKind } from "./flows/engagement";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "./flows/graph";
import { createPost, deletePost, getPost, thread } from "./flows/posts";
import { followers, following, profile } from "./flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "./flows/timelines";

const PostParam = z.object({ id: PostId });
const ProfileParam = z.object({ handle: HandleParam });

/**
 * Every social endpoint, mounted at `/api`. Handlers only validate, call a flow and shape the
 * response. `guard` is the auth module's requireSession: an onboarded account, with CSRF and
 * Origin already checked for cookie sessions.
 */
export function socialRoutes(deps: SocialDeps, guard: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  const viewer = (c: Context<AppEnv>): ViewerId => c.get("session")?.userId ?? null;
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;

  r.onError((err, c) => {
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    c.get("log").error({ err }, "unhandled error in social route");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  // ---------------------------------------------------------------- posts

  r.post("/posts", guard, validate("json", CreatePostRequest), async (c) => c.json(await createPost(deps, me(c), c.req.valid("json")), 201));
  r.get("/posts/:id", validate("param", PostParam), async (c) => c.json(await getPost(deps, viewer(c), c.req.valid("param").id)));
  r.delete("/posts/:id", guard, validate("param", PostParam), async (c) => {
    await deletePost(deps, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  r.get("/posts/:id/thread", validate("param", PostParam), validate("query", Pagination), async (c) =>
    c.json(await thread(deps, viewer(c), c.req.valid("param").id, c.req.valid("query"))),
  );

  for (const kind of ["like", "repost", "bookmark"] as EngagementKind[]) {
    r.post(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, true)));
    r.delete(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, false)));
  }

  // ---------------------------------------------------------------- timelines

  r.get("/timeline/following", guard, validate("query", Pagination), async (c) => c.json(await followingTimeline(deps, me(c), c.req.valid("query"))));
  r.get("/timeline/latest", validate("query", Pagination), async (c) => c.json(await latestTimeline(deps, viewer(c), c.req.valid("query"))));

  // ---------------------------------------------------------------- profiles and graph

  r.get("/profiles/:handle", validate("param", ProfileParam), async (c) => c.json(await profile(deps, viewer(c), c.req.valid("param").handle)));
  r.get("/profiles/:handle/posts", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profilePosts(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/replies", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profileReplies(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/followers", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await followers(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/following", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await following(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );

  r.post("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, false)));

  // ---------------------------------------------------------------- the viewer's private lists

  r.get("/me/likes", guard, validate("query", Pagination), async (c) => c.json(await likedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/bookmarks", guard, validate("query", Pagination), async (c) => c.json(await bookmarkedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/blocks", guard, validate("query", Pagination), async (c) => c.json(await blockedList(deps, me(c), c.req.valid("query"))));
  r.get("/me/mutes", guard, validate("query", Pagination), async (c) => c.json(await mutedList(deps, me(c), c.req.valid("query"))));

  return r;
}
```

### Create `apps/api/src/social/index.ts`

```ts
/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialDeps } from "./context";
import { createSocialRepo } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export type { SocialDeps, ViewerId } from "./context";

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  return { deps, routes: socialRoutes(deps, options.requireSession) };
}

export type Social = ReturnType<typeof createSocial>;
```

### Replace `apps/api/src/app.ts` (whole file)

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Logger } from "pino";
import { AuthError, type Auth } from "./auth";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { observability } from "./middleware/observability";
import { clientIp, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { healthRoutes, type HealthChecks } from "./routes/health";
import { SocialError, type Social } from "./social";

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
  auth: Auth;
  /** Posting and feed. Optional so auth-only tests need no database for it; the server always wires it. */
  social?: Social;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(securityHeaders, noStore);
  app.use(cors({ origin: config.TRUSTED_ORIGINS, credentials: true }));
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIp }));
  app.use(auth.resolveSession);

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION));
  app.route("/api/auth", auth.routes);
  app.get("/api/me", auth.requireOnboarding, auth.me);
  if (social) app.route("/api", social.routes);

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    if (err instanceof AuthError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { RedisStore } from "./middleware/rate-limit";
import { createProfileStore } from "./profiles/store";
import { createSocial } from "./social";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
  profiles: createProfileStore(apiDb),
});

const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  auth,
  social,
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

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  106 passed | 88 skipped (194)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  106 passed | 88 skipped (194)
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
printf 'import { createSocialRepo } from "./social/repo";\nexport const leaked = createSocialRepo;\n' > apps/api/src/zz-violation.ts; pnpm --filter @korbat/api exec vitest run test/architecture.test.ts; rm -f apps/api/src/zz-violation.ts; echo "violation file present: $(ls apps/api/src/zz-violation.ts 2>/dev/null | wc -l)"
```

Expected output contains:

- `zz-violation.ts: imports ./social/repo, which is inside the social module (use ./social)`
- `Tests  1 failed | 7 passed (8)`
- `violation file present: 0`

Observed on the dry run:

```text
Tests  1 failed | 7 passed (8)
violation file present: 0
+   "zz-violation.ts: imports ./social/repo, which is inside the social module (use ./social)",
```

## Step 7: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  88 passed (88)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  88 passed (88)
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/app.ts`
- `apps/api/src/index.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/routes.ts`
- `apps/api/test/app.test.ts`
- `apps/api/test/architecture.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(social): HTTP routes and module entry point; wire posting and feed into the API; boundary test covers the social module" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(social): HTTP routes and module entry point; wire posting and feed into the API; boundary test covers the social module`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 6>
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
