# korbat 2a — Task 13 of 13: Docker stack with posting: smoke test posts and reads Latest through Caddy; README

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The Docker stack with posting: the smoke test signs up through Caddy, posts, reads the post back from the public Latest timeline and checks the profile count before the staff-role check; the README documents posting and the feed; semgrep and the audit stay clean.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API or web process started from this repository first; never stop other Node processes on the machine.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): bookmarks page, privacy settings listing blocked and muted accounts with undo, security settings inside the app shell`.
3. The previous task's last API unit run ended with `Tests  106 passed | 96 skipped (202)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

### Replace `scripts/smoke-auth-stack.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 3. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 4. /api/me answers for it.
 * 5. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 6. The grant-role CLI makes it a moderator, and its session stops working.
 *
 * Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit. Prints no codes or tokens.
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 \
 *     --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
const mailpit = option("mailpit");
const terms = option("terms");
if (!base || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --mailpit <url> --terms <version> -- <docker compose command>");
  process.exit(2);
}

/** Cloudflare's test secret accepts any token. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const deviceId = randomBytes(32).toString("base64url");
const email = `smoke-${randomUUID()}@korbat.local`;
const handle = `smoke_${randomBytes(4).toString("hex")}`;
let failures = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function api(path, { json, token } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: json === undefined ? "GET" : "POST", headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

async function signUpCode(to) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = list.messages?.[0];
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

async function main() {
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  const unknown = await api("/api/auth/password/signin", {
    json: { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" },
  });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await api("/api/auth/email/start", { json: { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" } });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await signUpCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Smoke Test" }, token: complete.body.token });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);

  const created = await api("/api/posts", { json: { body: "smoke test post" }, token });
  check("create a post", created.status === 201 && typeof created.body?.id === "string", created.summary);
  const latest = await api("/api/timeline/latest");
  check("the post appears in the public Latest timeline", Array.isArray(latest.body?.items) && latest.body.items.some((item) => item.post?.id === created.body?.id), latest.summary);
  const profile = await api(`/api/profiles/${handle}`);
  check("the profile counts one post", profile.body?.counts?.posts === 1, profile.summary);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
```

### Replace `README.md` (whole file)

````markdown
# korbat

Pseudonymous social platform with a narrow public rulebook and transparent moderation. Self-hosted.

- Design spec: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Accounts and sessions (sub-project 1a): `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- Posting and feed (sub-project 2a): `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- Plans: `docs/superpowers/plans/`

## Dev quick start
```bash
pnpm install
node scripts/gen-dev-env.mjs                # creates or completes infra/.env, apps/api/.env and apps/app/.env; values are random and never printed
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis minio minio-init mailpit   # dev host ports 55432, 56379, 59000, 59001, 51025, 58025
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health
pnpm --filter @korbat/app web               # http://localhost:8081
```

Emails sent in development (sign-in codes, new-device alerts, lockout notices) land in Mailpit at http://localhost:58025. Locally the web app uses Cloudflare's always-pass Turnstile test key, so the human check never blocks you.

## Full stack
```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build   # http://localhost:8080
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

The smoke test signs up a throwaway account through Caddy, reads its code from Mailpit, posts and reads the post back from the public Latest timeline, grants the account a staff role with the CLI and checks that its session was revoked.

## Posting and feed
Text posts up to 1000 characters, replies, quotes, likes, reposts and bookmarks; follows, blocks and mutes; a chronological Following timeline and a public Latest timeline; threads and profile pages. The web app's home is the timeline; sign-in lives at `/signin`.

- **Reading signed out:** Latest, threads and profiles are public. Following, bookmarks, likes, follower lists and privacy settings need a session.
- **Blocks** are enforced in every query, not just the interface: neither account sees the other while signed in, follows are removed both ways, and the blocked side gets `not_found` so nothing is revealed. Posts are public, so a block does not hide them from someone who signs out; the interface says so.
- **Mutes** are one-way and silent, and hide an account from your timelines only.
- **Liker lists are never exposed.** Counts are public; likes and bookmarks are private to their owner.
- **Write limits** per account, tiered by account age: in the first 24 hours 5 posts and 20 replies an hour and no reposts or quotes for 48 hours; afterwards 30 posts and 60 replies an hour. Everyone: 100 likes an hour, 50 follows an hour and 400 a day, 30 blocks or mutes an hour. Undo actions are never limited.
- **Deleting** blanks the text in the database and leaves a tombstone only where a thread or a quote needs it. There is no editing.

## Staff roles
No API endpoint changes roles. Run this on the server:
```bash
docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
```
Every session of the account is revoked and the change is written to the audit log. Staff tools refuse moderators and admins until they turn on two-factor authentication.

## Before going public
Set these in `infra/.env`:
- `API_APP_ORIGIN` to the public origin, for example `https://korbat.example`.
- `API_TURNSTILE_SECRET_KEY` and `WEB_TURNSTILE_SITE_KEY` to the keys of one Turnstile widget.
- `API_SMTP_URL` and `API_MAIL_FROM` to the EU mail relay.

Keep `API_AUTH_HMAC_KEY`, `API_IP_HASH_KEY` and `API_TOTP_ENC_KEY` secret and backed up. Losing `API_TOTP_ENC_KEY` breaks every enrolled authenticator.
````

## Step 2: verify: build

```bash
pnpm --filter @korbat/api build 2>&1 | grep -E 'Build success|error' ; echo "argon2 imports left external: $(cat apps/api/dist/*.js | grep -c 'from "@node-rs/argon2"')"
```

Expected output contains:

- `Build success`
- `argon2 imports left external: 1`

Must not contain:

- `error`

Observed on the dry run:

```text
ESM ⚡️ Build success in 732ms
argon2 imports left external: 1
```

## Step 3: verify: stack

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build >/dev/null 2>&1; s=000; for i in $(seq 1 90); do s=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/health); [ "$s" = 200 ] && break; sleep 2; done; echo "health through caddy: $s"; js=$(curl -s http://localhost:8080/ | grep -o '/_expo/static/js/web/[^"]*\.js' | head -1); n=$(curl -s http://localhost:8080$js | grep -o 'Nothing here yet. Follow someone' | wc -l); echo "home timeline in web bundle: $([ "$n" -gt 0 ] && echo yes || echo no)"; echo "latest timeline public: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/timeline/latest)"
```

Expected output contains:

- `health through caddy: 200`
- `home timeline in web bundle: yes`
- `latest timeline public: 200`

Allowed difference: Rebuilding the API and web images can take more than ten minutes.

Observed on the dry run:

```text
health through caddy: 200
home timeline in web bundle: yes
latest timeline public: 200
```

## Step 4: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `ok   create a post`
- `ok   the post appears in the public Latest timeline`
- `smoke test passed`

Must not contain:

- `FAIL`

Observed on the dry run:

```text
ok   create a post (HTTP 201)
ok   the post appears in the public Latest timeline (HTTP 200)
smoke test passed
```

## Step 5: verify: semgrep

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src" semgrep/semgrep semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist --exclude node_modules 2>&1 | grep -E 'Findings:|Ran [0-9]+ rules'
```

Expected output contains:

- `Findings: 0 (0 blocking)`

Allowed difference: The scan can take fifteen minutes on Windows because of Docker's file access to the bind mount; it is slow, not stuck.

Observed on the dry run:

```text
• Findings: 0 (0 blocking)
```

## Step 6: verify: audit

```bash
pnpm audit --audit-level high; echo "audit exit: $?"
```

Expected output contains:

- `audit exit: 0`

Observed on the dry run:

```text
audit exit: 0
```

## Step 7: verify: api-unchanged

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  106 passed | 96 skipped (202)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  106 passed | 96 skipped (202)
```

## Step 8: verify: stop-app-services

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker minio >/dev/null 2>&1; echo app services stopped
```

Expected output contains:

- `app services stopped`

Observed on the dry run:

```text
app services stopped
```

## Step 9: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `README.md`
- `scripts/smoke-auth-stack.mjs`

## Step 10: commit

```bash
git add -A
git commit -q -m "feat(infra): smoke test posts through Caddy and reads it back from Latest; README covers posting and feed" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(infra): smoke test posts through Caddy and reads it back from Latest; README covers posting and feed`.

## Report format (mandatory)

```text
TASK 13 REPORT
Files written: <count, expected 2>
Verify "build": <paste the expected lines as printed>
Verify "stack": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "semgrep": <paste the expected lines as printed>
Verify "audit": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Verify "stop-app-services": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
