# korbat 1a — Task 9 of 21: Session cookies, CSRF, bearer tokens and Turnstile

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Web sessions use `__Host-` cookies (HttpOnly, Secure, SameSite=Lax) with a double-submit CSRF cookie and an Origin check; native apps send a bearer token. This task adds the cookie and CSRF helpers and server-side Turnstile verification that fails closed.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): keyed identifier hashes, handle rules, 16+ age check, device labels, pinned disposable-domain list`.
3. The previous task's last API unit run ended with `Tests  60 passed | 1 skipped (61)`.

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

### Create `apps/api/test/auth/cookies.test.ts`

```ts
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { bearerToken, checkCsrf, clearSessionCookies, readSessionCookie, setSessionCookies } from "../../src/auth/cookies";

const token = `kb1_${"A".repeat(43)}`;

function app() {
  const a = new Hono();
  a.post("/set", (c) => {
    setSessionCookies(c, token, 3600);
    return c.text("ok");
  });
  a.post("/clear", (c) => {
    clearSessionCookies(c);
    return c.text("ok");
  });
  a.get("/read", (c) => c.text(readSessionCookie(c) ?? "none"));
  a.post("/csrf", (c) => c.text(checkCsrf(c, ["http://localhost:8081"]) ? "pass" : "fail"));
  a.get("/bearer", (c) => c.text(bearerToken(c) ?? "none"));
  return a;
}

describe("session cookies", () => {
  test("session cookie is __Host-, HttpOnly, Secure, SameSite=Lax; the CSRF cookie is readable by scripts", async () => {
    const cookies = (await app().request("/set", { method: "POST" })).headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("__Host-korbat_session="))!;
    const csrf = cookies.find((c) => c.startsWith("__Host-korbat_csrf="))!;
    expect(session).toContain(`__Host-korbat_session=${token}`);
    for (const attribute of ["Max-Age=3600", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(session).toContain(attribute);
    expect(session).not.toContain("Domain=");
    expect(csrf).toMatch(/^__Host-korbat_csrf=[A-Za-z0-9_-]{43};/);
    expect(csrf).not.toContain("HttpOnly");
    expect(csrf).toContain("Secure");
  });
  test("only the prefixed session cookie is read", async () => {
    expect(await (await app().request("/read", { headers: { cookie: `__Host-korbat_session=${token}` } })).text()).toBe(token);
    expect(await (await app().request("/read", { headers: { cookie: `korbat_session=${token}` } })).text()).toBe("none");
  });
  test("clearing expires both cookies", async () => {
    const cookies = (await app().request("/clear", { method: "POST" })).headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) expect(cookie).toContain("Max-Age=0");
  });
});

describe("CSRF and bearer tokens", () => {
  test("CSRF needs an allowed Origin and a header equal to the cookie", async () => {
    const csrf = "c".repeat(43);
    const ok = { cookie: `__Host-korbat_csrf=${csrf}`, "x-csrf-token": csrf, origin: "http://localhost:8081" };
    const run = async (headers: Record<string, string>) => (await app().request("/csrf", { method: "POST", headers })).text();
    expect(await run(ok)).toBe("pass");
    expect(await run({ ...ok, origin: "https://evil.example" })).toBe("fail");
    expect(await run({ ...ok, "x-csrf-token": "d".repeat(43) })).toBe("fail");
    const { origin: _origin, ...withoutOrigin } = ok;
    expect(await run(withoutOrigin)).toBe("fail");
    const { "x-csrf-token": _header, ...withoutHeader } = ok;
    expect(await run(withoutHeader)).toBe("fail");
  });
  test("bearer tokens must be well-formed kb1_ tokens", async () => {
    const run = async (authorization?: string) =>
      (await app().request("/bearer", { headers: authorization ? { authorization } : {} })).text();
    expect(await run(`Bearer ${token}`)).toBe(token);
    expect(await run("Bearer kb1_short")).toBe("none");
    expect(await run(`Basic ${token}`)).toBe("none");
    expect(await run()).toBe("none");
  });
});
```

### Create `apps/api/test/auth/turnstile.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { cloudflareTurnstile } from "../../src/auth/turnstile";

function fake(outcome: Response | Error) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as typeof fetch;
  return { fn, calls };
}

describe("turnstile", () => {
  test("posts the secret and token only, and accepts success: true", async () => {
    const f = fake(Response.json({ success: true }));
    expect(await cloudflareTurnstile("secret-key", f.fn).verify("widget-token")).toBe(true);
    expect(f.calls[0]!.url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(f.calls[0]!.body).toEqual({ secret: "secret-key", response: "widget-token" });
  });
  test("success: false is rejected", async () => {
    expect(await cloudflareTurnstile("s", fake(Response.json({ success: false, "error-codes": ["invalid-input-response"] })).fn).verify("t")).toBe(false);
  });
  test("non-200 responses fail closed", async () => {
    expect(await cloudflareTurnstile("s", fake(new Response("", { status: 500 })).fn).verify("t")).toBe(false);
  });
  test("network errors fail closed", async () => {
    expect(await cloudflareTurnstile("s", fake(new Error("offline")).fn).verify("t")).toBe(false);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/auth/cookies'`
- `Cannot find module '../../src/auth/turnstile'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/cookies' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/auth/cookies.test.ts
Error: Cannot find module '../../src/auth/turnstile' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/auth/turnstile.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/cookies.ts`

```ts
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, safeEqual } from "./crypto";

/** Sent as `__Host-korbat_session` and `__Host-korbat_csrf`: Secure, Path=/, no Domain. */
export const SESSION_COOKIE = "korbat_session";
export const CSRF_COOKIE = "korbat_csrf";
export const CSRF_HEADER = "x-csrf-token";

const hostCookie = { path: "/", secure: true, sameSite: "Lax", prefix: "host" } as const;

/** Issues the HttpOnly session cookie and a fresh, script-readable CSRF cookie. */
export function setSessionCookies(c: Context, token: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, token, { ...hostCookie, httpOnly: true, maxAge: maxAgeSeconds });
  setCookie(c, CSRF_COOKIE, randomToken(32), { ...hostCookie, httpOnly: false, maxAge: maxAgeSeconds });
}

export function clearSessionCookies(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, hostCookie);
  deleteCookie(c, CSRF_COOKIE, hostCookie);
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE, "host");
}

/**
 * For state-changing requests authenticated by cookie: the Origin must be allowed and the
 * X-CSRF-Token header must equal the CSRF cookie (double submit).
 */
export function checkCsrf(c: Context, allowedOrigins: readonly string[]): boolean {
  const origin = c.req.header("origin");
  if (!origin || !allowedOrigins.includes(origin)) return false;
  const cookie = getCookie(c, CSRF_COOKIE, "host");
  const header = c.req.header(CSRF_HEADER);
  return Boolean(cookie && header && safeEqual(cookie, header));
}

/** The bearer token from `Authorization: Bearer kb1_...`, or undefined when absent or malformed. */
export function bearerToken(c: Context): string | undefined {
  const header = c.req.header("authorization");
  if (!header) return undefined;
  return /^Bearer (kb1_[A-Za-z0-9_-]{43})$/.exec(header)?.[1];
}
```

### Create `apps/api/src/auth/turnstile.ts`

```ts
export interface TurnstileVerifier {
  /** Resolves true only when Cloudflare confirms the token. Every failure resolves false (fail closed). */
  verify(token: string): Promise<boolean>;
}

/** Server-side Turnstile check. Sends the secret and the token only, never the user's IP. */
export function cloudflareTurnstile(secret: string, fetchFn: typeof fetch = fetch, timeoutMs = 5000): TurnstileVerifier {
  return {
    async verify(token) {
      try {
        const res = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret, response: token }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { success?: unknown };
        return body.success === true;
      } catch {
        return false;
      }
    },
  };
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  69 passed | 1 skipped (70)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  69 passed | 1 skipped (70)
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

## Step 6: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/cookies.ts`
- `apps/api/src/auth/turnstile.ts`
- `apps/api/test/auth/cookies.test.ts`
- `apps/api/test/auth/turnstile.test.ts`

## Step 7: commit

```bash
git add -A
git commit -q -m "feat(auth): __Host- session cookies, double-submit CSRF with Origin check, bearer parsing, Turnstile verifier" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): __Host- session cookies, double-submit CSRF with Origin check, bearer parsing, Turnstile verifier`.

## Report format (mandatory)

```text
TASK 9 REPORT
Files written: <count, expected 4>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
