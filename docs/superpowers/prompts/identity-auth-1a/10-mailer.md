# korbat 1a — Task 10 of 21: Mailer, templates and Mailpit for development

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

All email goes through a small mailer interface with plain-text templates (no images, links as text). Development uses Mailpit, a local mail catcher with an HTTP API the integration tests read codes from. Production points the SMTP URL at an EU relay without code changes.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): __Host- session cookies, double-submit CSRF with Origin check, bearer parsing, Turnstile verifier`.
3. The previous task's last API unit run ended with `Tests  69 passed | 1 skipped (70)`.

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

### Create `apps/api/test/mail/templates.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { MemoryMailer } from "../../src/mail/memory";
import { renderTemplate } from "../../src/mail/templates";

describe("mail templates", () => {
  test("code emails carry the code and expiry, and no links or images", () => {
    const r = renderTemplate("sign_in_code", { code: "123456" });
    expect(r.subject).toBe("Your korbat sign-in code");
    expect(r.text).toContain("123456");
    expect(r.text).toContain("10 minutes");
    expect(r.html).toContain("123456");
    expect(r.html).not.toMatch(/<img|<a |https?:\/\//);
  });
  test("every template renders and HTML escapes its data", () => {
    const data = { code: "123456", deviceLabel: "<b>Chrome</b> on Windows", notMeUrl: "http://localhost:8081/not-me/abc", minutes: "15" };
    for (const template of ["sign_in_code", "sign_up_code", "reauth_code", "new_device", "account_locked"] as const) {
      const r = renderTemplate(template, data);
      expect(r.subject.length, template).toBeGreaterThan(5);
      expect(r.text.length, template).toBeGreaterThan(20);
    }
    const newDevice = renderTemplate("new_device", data);
    expect(newDevice.html).toContain("&lt;b&gt;Chrome&lt;/b&gt;");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
  });
  test("missing template data is a programming error", () => {
    expect(() => renderTemplate("sign_in_code", {})).toThrow(/code/);
  });
  test("the memory mailer records messages and finds the latest code per address", async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "111111" } });
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "222222" } });
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.lastCodeFor("a@b.io")).toBe("222222");
    expect(mailer.lastCodeFor("c@d.io")).toBeUndefined();
  });
});
```

### Create `apps/api/test/integration/mailpit.ts`

```ts
/** Reads messages from the local Mailpit HTTP API (infra/compose.dev.yml). Test helper only. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:58025";

interface SearchResult {
  messages: { ID: string; Subject: string }[];
}

/** Waits up to ~5 seconds for the newest message to `to` and returns its plain-text body. */
export async function latestMessageTo(to: string): Promise<{ subject: string; text: string }> {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)).json()) as SearchResult;
    const newest = list.messages[0];
    if (newest) {
      const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`)).json()) as { Subject: string; Text: string };
      return { subject: message.Subject, text: message.Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no email to ${to} arrived in Mailpit`);
}

/** The first 6-digit code in a message body. */
export function codeFrom(text: string): string {
  const code = /\b(\d{6})\b/.exec(text)?.[1];
  if (!code) throw new Error("no 6-digit code in message");
  return code;
}
```

### Create `apps/api/test/integration/mail.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { codeFrom, latestMessageTo } from "./mailpit";

describe.skipIf(!process.env.INTEGRATION)("integration: SMTP to Mailpit", () => {
  test("a sign-in code email arrives with the code in its text", async () => {
    const config = loadConfig();
    const to = `mail-test-${randomUUID()}@korbat.local`;
    await smtpMailer(config.SMTP_URL, config.MAIL_FROM).send({ to, template: "sign_in_code", data: { code: "424242" } });
    const message = await latestMessageTo(to);
    expect(message.subject).toBe("Your korbat sign-in code");
    expect(codeFrom(message.text)).toBe("424242");
  });
});
```

### Replace `infra/compose.dev.yml` (whole file)

```yaml
services:
  postgres:
    ports: ["127.0.0.1:55432:5432"]
  redis:
    ports: ["127.0.0.1:56379:6379"]
  minio:
    ports: ["127.0.0.1:59000:9000", "127.0.0.1:59001:9001"]
  api:
    ports: ["127.0.0.1:3000:3000"]
  caddy:
    ports: ["127.0.0.1:8080:80"]
  # Development mail catcher: SMTP on 51025, web UI and HTTP API on 58025. Never used in production.
  mailpit:
    image: axllent/mailpit:v1.31.1
    restart: unless-stopped
    ports: ["127.0.0.1:51025:1025", "127.0.0.1:58025:8025"]
```

### Replace `apps/api/.env.example` (whole file)

```text
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL_API=postgres://korbat_api:change-me-api@localhost:55432/korbat
DATABASE_URL_AUTH=postgres://korbat_auth:change-me-auth@localhost:55432/korbat
DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:55432/korbat
REDIS_URL=redis://localhost:56379
TRUSTED_ORIGINS=http://localhost:8081
APP_ORIGIN=http://localhost:8081
# Keys are generated by `node scripts/gen-dev-env.mjs`. Never reuse keys between environments.
AUTH_HMAC_KEY=change-me-key-auth-hmac
IP_HASH_KEY=change-me-key-ip-hash
TOTP_ENC_KEY=v1:change-me-key-totp
# Cloudflare's documented always-pass test secret. Production uses the real secret.
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Local Mailpit from infra/compose.dev.yml. Production points at the EU relay.
SMTP_URL=smtp://localhost:51025
MAIL_FROM="korbat <no-reply@korbat.local>"
TERMS_VERSION=draft-2026-09
# Mailpit HTTP API, read by integration tests only.
MAILPIT_URL=http://localhost:58025
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/mail/memory'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/mail/memory' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/mail/templates.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/mail/mailer.ts`

```ts
export type TemplateName = "sign_in_code" | "sign_up_code" | "reauth_code" | "new_device" | "account_locked";

export interface MailMessage {
  to: string;
  template: TemplateName;
  data: Record<string, string>;
}

export interface Mailer {
  /** Throws MailUnavailable when the message could not be handed to the relay. */
  send(message: MailMessage): Promise<void>;
}

export class MailUnavailable extends Error {}
```

### Create `apps/api/src/mail/templates.ts`

```ts
import type { TemplateName } from "./mailer";

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

function need(data: Record<string, string>, key: string): string {
  const value = data[key];
  if (value === undefined || value === "") throw new Error(`mail template data is missing "${key}"`);
  return value;
}

/** Plain paragraphs only: no images, no tracking, no anchor tags. URLs appear as text. */
function build(subject: string, paragraphs: string[]): RenderedMail {
  return {
    subject,
    text: `${paragraphs.join("\n\n")}\n`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">${paragraphs
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join("")}</body></html>`,
  };
}

export function renderTemplate(template: TemplateName, data: Record<string, string>): RenderedMail {
  switch (template) {
    case "sign_in_code":
      return build("Your korbat sign-in code", [
        `Your sign-in code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to sign in, you can ignore this email; nobody can sign in without the code.",
      ]);
    case "sign_up_code":
      return build("Your korbat sign-up code", [
        `Your sign-up code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to create a korbat account, you can ignore this email.",
      ]);
    case "reauth_code":
      return build("Confirm it's you on korbat", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. korbat asks for it before sensitive account changes.",
      ]);
    case "new_device":
      return build("New sign-in to your korbat account", [
        `Your account was just signed in from a new device: ${need(data, "deviceLabel")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 24 hours to sign out every session and remove your password: ${need(data, "notMeUrl")}`,
      ]);
    case "account_locked":
      return build("Password sign-in paused on your korbat account", [
        `After several wrong passwords, password sign-in is paused for ${need(data, "minutes")} minutes.`,
        "You can still sign in with an emailed code. If you did not try to sign in, consider turning on two-factor authentication.",
      ]);
  }
}
```

### Create `apps/api/src/mail/memory.ts`

```ts
import type { MailMessage, Mailer } from "./mailer";
import { MailUnavailable } from "./mailer";
import { renderTemplate } from "./templates";

/** Records messages instead of sending them. Used by unit tests and flow tests. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  failing = false;

  async send(message: MailMessage): Promise<void> {
    if (this.failing) throw new MailUnavailable("memory mailer set to fail");
    renderTemplate(message.template, message.data);
    this.sent.push(message);
  }

  /** The `code` from the most recent message to this address, if any. */
  lastCodeFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.data.code)?.data.code;
  }
}
```

### Create `apps/api/src/mail/smtp.ts`

```ts
import nodemailer from "nodemailer";
import type { MailMessage, Mailer } from "./mailer";
import { MailUnavailable } from "./mailer";
import { renderTemplate } from "./templates";

/** Sends through any SMTP relay given as a URL, e.g. smtps://user:pass@smtp-relay.example:465. */
export function smtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message: MailMessage) {
      const rendered = renderTemplate(message.template, message.data);
      try {
        await transport.sendMail({ from, to: message.to, subject: rendered.subject, text: rendered.text, html: rendered.html });
      } catch (err) {
        throw new MailUnavailable("mail relay rejected or unreachable", { cause: err });
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

- `Tests  73 passed | 2 skipped (75)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  73 passed | 2 skipped (75)
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

## Step 6: verify: compose-config

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml config -q && echo 'compose ok' && docker compose -f infra/compose.yml -f infra/compose.dev.yml config --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s).services.mailpit; console.log('mailpit image', m.image); console.log('mailpit ports', m.ports.map(p=>p.host_ip+':'+p.published+'->'+p.target).join(' '))})"
```

Expected output contains:

- `compose ok`
- `mailpit image axllent/mailpit:v1.31.1`
- `127.0.0.1:51025->1025`
- `127.0.0.1:58025->8025`

Observed on the dry run:

```text
compose ok
mailpit image axllent/mailpit:v1.31.1
mailpit ports 127.0.0.1:51025->1025 127.0.0.1:58025->8025
```

## Step 7: verify: mailpit-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d mailpit && for i in $(seq 1 20); do curl -s -o /dev/null http://localhost:58025/api/v1/messages && break; sleep 1; done; curl -s -o /dev/null -w 'mailpit api: %{http_code}\n' http://localhost:58025/api/v1/messages
```

Expected output contains:

- `mailpit api: 200`

Observed on the dry run:

```text
mailpit api: 200
```

## Step 8: verify: gen-env

```bash
node scripts/gen-dev-env.mjs && grep -c '^MAILPIT_URL=' apps/api/.env
```

Expected output contains:

- `added MAILPIT_URL`
- `1`

Observed on the dry run:

```text
apps/api/.env: completed, added MAILPIT_URL
1
```

## Step 9: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  2 passed (2)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  2 passed (2)
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/.env.example`
- `apps/api/src/mail/mailer.ts`
- `apps/api/src/mail/memory.ts`
- `apps/api/src/mail/smtp.ts`
- `apps/api/src/mail/templates.ts`
- `apps/api/test/integration/mail.test.ts`
- `apps/api/test/integration/mailpit.ts`
- `apps/api/test/mail/templates.test.ts`
- `infra/compose.dev.yml`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(mail): mailer interface, plain templates, SMTP adapter; Mailpit in dev compose" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(mail): mailer interface, plain templates, SMTP adapter; Mailpit in dev compose`.

## Report format (mandatory)

```text
TASK 10 REPORT
Files written: <count, expected 9>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "mailpit-up": <paste the expected lines as printed>
Verify "gen-env": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
