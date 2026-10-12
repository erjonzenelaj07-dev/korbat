# korbat moderation cases (3c) — Task 4 of 12: Reports and notices: the notice routes with their links, liveness, limits and human check, the notifier's encrypted contact in the auth module, the mailer's refusals and time limits, the notifier key in the configuration and the compose file, the janitor's two purges, the receipt and the urgent alert

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-03 to 2026-10-12 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 to 3 laid the ground, built the decision engine and the media module's interface for cases. This task opens the front door: the routes for reports and notices with their links, liveness, limits and human check, the status page's answer, the notifier's encrypted contact in the auth module, the receipt and the urgent alert. The design is `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` (sections 5, 7.1, 7.2, 7.12, 7.15 and 10). This task changes an example env file: after writing the files and before the checks, run `node scripts/gen-dev-env.mjs`, which appends every setting that is new in an example to the ignored env files, generates the keys an example marks and prints no value.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,app,contracts): holds and images: MediaForCases.hold locks every image row an intake reaches in one id order (FOR KEY SHARE; a post's rows also get its case's hold, an account's are only locked, since the freeze keeps them) and the intake's snapshots list what it returned; reach counts a case's posts, images, sealed and served ones; staffImage is the one function that opens an image for staff and refuses a frozen post's, a sealed and an erased one; dropDisposable deletes at most a batch of the images nothing retains, its candidates chosen by their marks before the freeze is read; detachAll and purgeOwner delete in id order with no filter and the keep trigger decides; purgeProfile takes its posts' row locks first, in id order, and deletes images as its last act; serve, forPosts, readyImages and the export's open follow an image's own state: a withheld or removed image goes to its author only, a sealed one to nobody, and others get the placeholder HiddenMedia; the app draws it ("Image hidden by korbat moderation", or "Sealed: not shown to anyone, you included" for the author) in the grid, the viewer and a quote's row, never loads a hidden image, and Popular now skips it`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/04-reports-notices.md 1
```

Expected: 28 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/auth-notifiers.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import type { AuthDeps } from "../../src/auth/context";
import { decrypt, parseVersionedKey } from "../../src/auth/crypto";
import {
  accountReportMailStopped,
  confirmNotifier,
  findNotifierContacts,
  forgetNotifierAfter,
  mailAccount,
  mailNotifier,
  mailStaff,
  notifierFacts,
  notifierMailTokenMatches,
  notifierName,
  overdueContacts,
  resumeAccountReportMail,
  stopNotifier,
  storeNotifierContact,
  type NoticeReceivedMessage,
} from "../../src/auth/flows/notifiers";
import { emailHash } from "../../src/auth/identifiers";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MailRefused, MailUnavailable, type MailMessage, type Mailer } from "../../src/mail/mailer";
import { flowHarness, newTestEmail, type FlowHarness } from "./flow-harness";
import { newStaffAccount } from "./staff-fixtures";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * The auth module's side of reports and notices (3c design, sections 5 and 6.1), against the real auth tables as
 * korbat_auth: a signed-out notifier's contact stored encrypted, the receipt's mail with its suppression, confirmation
 * and 24-hour cap, the mail to an account and to staff, and the contact's mail token, which alone confirms or stops an
 * address. The clock, the key-value store and the mailer are the flow harness's; every row a test stores is removed in
 * the file's last step, which holds the three notifier tables to the counts they had before it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: notifier contacts and the mails of reports", () => {
  let db: Db;
  let repo: AuthRepo;
  let before: Record<string, number>;
  /** What the tests stored: contact ids, and the addresses whose confirmations and suppressions they made. */
  const contactIds: string[] = [];
  const addresses: string[] = [];

  beforeAll(async () => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
    before = await counts();
  });
  afterAll(async () => {
    await closeDb(db);
  });

  async function counts(): Promise<Record<string, number>> {
    const [row] = (await db.execute(
      sql`select (select count(*)::int from auth.notifier_contacts) as contacts, (select count(*)::int from auth.notifier_confirmations) as confirmations, (select count(*)::int from auth.notifier_suppressions) as suppressions`,
    )) as unknown as Record<string, number>[];
    return { ...row! };
  }

  const newAddress = () => {
    const address = newTestEmail("notifier");
    addresses.push(address);
    return address;
  };
  /** A stored contact: its id, and the address it was given under. */
  async function contact(h: FlowHarness, given: { name?: string; email?: string } = {}) {
    const id = randomUUID();
    contactIds.push(id);
    const email = "email" in given ? given.email : newAddress();
    await storeNotifierContact(h.deps, id, { name: given.name, email });
    return { id, email };
  }
  const row = async (id: string) => {
    const [found] = (await db.execute(sql`select * from auth.notifier_contacts where id = ${id}::uuid`)) as unknown as Record<string, string | null>[];
    return found;
  };
  /** The day a contact is forgotten, in epoch milliseconds: a raw read would hand the time over as PostgreSQL's text. */
  const forgetAfterOf = async (id: string) => {
    const [found] = (await db.execute(sql`select (extract(epoch from forget_after) * 1000)::float8 as ms from auth.notifier_contacts where id = ${id}::uuid`)) as unknown as { ms: number }[];
    return Math.round(Number(found!.ms));
  };
  const receipt = (ref = "N-ABCDEFGH23"): NoticeReceivedMessage => ({
    template: "notice_received",
    ref,
    receivedAt: new Date("2026-10-04T06:59:59.123Z"),
    items: ["http://localhost:8081/post/0190f3a2-7c1e-7b1a-9f00-0123456789ab", "http://localhost:8081/u/ada"],
  });
  /** The mail token of the page link the newest mail to this address carries. */
  const tokenSentTo = (h: FlowHarness, to: string) => /#t=([A-Za-z0-9_-]{43})$/.exec([...h.mailer.sent].reverse().find((m) => m.to === to)!.data.pageUrl!)![1]!;
  /** The harness's dependencies with a mailer that ends every send as the test scripts it. */
  const withMailer = (h: FlowHarness, send: (message: MailMessage) => Promise<void>): AuthDeps => ({ ...h.deps, mailer: { send } satisfies Mailer });

  describe("storeNotifierContact", () => {
    test("stores the name, the address and a fresh mail token encrypted under the notifier key, with the address's keyed hash, to be forgotten 13 months on", async () => {
      const h = flowHarness(repo);
      const address = newAddress();
      const { id } = await contact(h, { name: "  Ada Lovelace ", email: `  ${address.toUpperCase()} ` });
      const stored = (await row(id))!;
      const keys = [h.deps.config.notifierKey];
      expect(decrypt(stored.name_enc!, keys).toString("utf8")).toBe("Ada Lovelace");
      // The address is kept as the mails need it: trimmed, in lower case.
      expect(decrypt(stored.email_enc!, keys).toString("utf8")).toBe(address);
      expect(decrypt(stored.mail_token_enc!, keys).toString("utf8")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(stored.email_hash).toBe(emailHash(h.deps.config.authHmacKey, address));
      for (const column of ["name_enc", "email_enc", "mail_token_enc"]) expect(stored[column], column).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
      // Nothing of it stands in the row as it was typed.
      expect(JSON.stringify(stored)).not.toMatch(/Ada|notifier-/i);
      const forgetAfter = await forgetAfterOf(id);
      const thirteenMonths = new Date(h.clock.now());
      thirteenMonths.setUTCMonth(thirteenMonths.getUTCMonth() + 13);
      // A month's end may clamp the day: within three days of the same day 13 months on.
      expect(Math.abs(forgetAfter - thirteenMonths.getTime())).toBeLessThanOrEqual(3 * DAY);
    });

    test("a contact with a name alone has no address, no hash and no mail token; one with an address alone no name; a disposable address is taken", async () => {
      const h = flowHarness(repo);
      const named = await contact(h, { name: "Ada", email: undefined });
      expect(await row(named.id)).toMatchObject({ email_enc: null, email_hash: null, mail_token_enc: null });
      const addressed = await contact(h);
      expect((await row(addressed.id))!.name_enc).toBeNull();
      const disposable = `x-${randomUUID()}@mailinator.com`;
      addresses.push(disposable);
      const thrown = await contact(h, { email: disposable });
      expect(decrypt((await row(thrown.id))!.email_enc!, [h.deps.config.notifierKey]).toString("utf8")).toBe(disposable);
    });

    test("every read decrypts with the key or one it replaced, and writes nothing back", async () => {
      const old = flowHarness(repo);
      const { id, email } = await contact(old, { name: "Ada" });
      const stored = await row(id);
      // The key was rotated: the old one is now among the previous keys.
      const h = flowHarness(repo);
      h.deps.config.notifierKey = parseVersionedKey(`v2:${Buffer.alloc(32, 8).toString("base64")}`);
      h.deps.config.notifierPreviousKeys = [old.deps.config.notifierKey];
      expect(await notifierName(h.deps, id)).toBe("Ada");
      expect(await mailNotifier(h.deps, id, receipt())).toBe("sent");
      expect(await notifierMailTokenMatches(h.deps, id, tokenSentTo(h, email!))).toBe(true);
      expect(await findNotifierContacts(h.deps, email!)).toEqual([{ id, name: "Ada" }]);
      expect(await row(id)).toEqual(stored);
      // A contact stored now is encrypted under the new key.
      const fresh = await contact(h, { name: "Bob" });
      expect((await row(fresh.id))!.name_enc).toMatch(/^v2:/);
    });
  });

  describe("mailNotifier: a signed-out notifier's receipt", () => {
    test("sends notice_received to the contact's address with the page link, whose fragment is the contact's mail token, and the terms link", async () => {
      const h = flowHarness(repo);
      const { id, email } = await contact(h);
      expect(await mailNotifier(h.deps, id, receipt("N-QRSTUVWX45"))).toBe("sent");
      expect(h.mailer.sent).toHaveLength(1);
      const sent = h.mailer.sent[0]!;
      expect(sent).toMatchObject({ to: email, template: "notice_received" });
      expect(sent.data).toEqual({
        ref: "N-QRSTUVWX45",
        time: "2026-10-04 06:59 UTC",
        items: "http://localhost:8081/post/0190f3a2-7c1e-7b1a-9f00-0123456789ab, http://localhost:8081/u/ada",
        pageUrl: `http://localhost:8081/notice/N-QRSTUVWX45#t=${tokenSentTo(h, email!)}`,
        termsUrl: "http://localhost:8081/terms",
      });
      expect(tokenSentTo(h, email!)).toBe(decrypt((await row(id))!.mail_token_enc!, [h.deps.config.notifierKey]).toString("utf8"));
    });

    test("forgotten for an id no contact has, no_address for a contact without an address; neither sends anything", async () => {
      const h = flowHarness(repo);
      expect(await mailNotifier(h.deps, randomUUID(), receipt())).toBe("forgotten");
      const named = await contact(h, { name: "Ada", email: undefined });
      expect(await mailNotifier(h.deps, named.id, receipt())).toBe("no_address");
      expect(h.mailer.sent).toHaveLength(0);
    });

    test("an unconfirmed address gets one receipt in 24 hours: the next is folded, whichever contact names the address, and the one after the day is sent", async () => {
      const h = flowHarness(repo);
      const first = await contact(h);
      const second = await contact(h, { email: first.email!.toUpperCase() });
      expect(await mailNotifier(h.deps, first.id, receipt())).toBe("sent");
      expect(await mailNotifier(h.deps, second.id, receipt())).toBe("folded");
      expect(await mailNotifier(h.deps, first.id, receipt())).toBe("folded");
      // Another address has a day of its own.
      const other = await contact(h);
      expect(await mailNotifier(h.deps, other.id, receipt())).toBe("sent");
      h.clock.advance(DAY - 1000);
      expect(await mailNotifier(h.deps, second.id, receipt())).toBe("folded");
      h.clock.advance(2000);
      expect(await mailNotifier(h.deps, second.id, receipt())).toBe("sent");
      expect(h.mailer.sent.filter((m) => m.to === first.email)).toHaveLength(2);
    });

    test("a confirmed address has no cap for the 30 days of its confirmation; a stopped one gets nothing until a confirmation lifts the stop", async () => {
      const h = flowHarness(repo);
      const { id, email } = await contact(h);
      expect(await mailNotifier(h.deps, id, receipt())).toBe("sent");
      const token = tokenSentTo(h, email!);
      expect(await confirmNotifier(h.deps, id, token)).toBe(true);
      for (let n = 0; n < 3; n++) expect(await mailNotifier(h.deps, id, receipt())).toBe("sent");
      // The confirmation runs out after 30 days: the cap is back.
      h.clock.advance(30 * DAY + 1000);
      expect(await mailNotifier(h.deps, id, receipt())).toBe("sent");
      expect(await mailNotifier(h.deps, id, receipt())).toBe("folded");

      expect(await stopNotifier(h.deps, id, token)).toBe(true);
      h.clock.advance(2 * DAY);
      const sentBefore = h.mailer.sent.length;
      expect(await mailNotifier(h.deps, id, receipt())).toBe("suppressed");
      // Another contact of the same address is stopped with it.
      const again = await contact(h, { email });
      expect(await mailNotifier(h.deps, again.id, receipt())).toBe("suppressed");
      expect(h.mailer.sent).toHaveLength(sentBefore);
      expect(await confirmNotifier(h.deps, id, token)).toBe(true);
      expect(await mailNotifier(h.deps, id, receipt())).toBe("sent");
    });

    test("refused when the relay says the address is bad; any other failure is thrown, leaves the day's one receipt unspent, and the retry carries the same page link", async () => {
      const h = flowHarness(repo);
      const { id, email } = await contact(h);
      const failing = withMailer(h, async () => {
        throw new MailUnavailable("relay down");
      });
      await expect(mailNotifier(failing, id, receipt())).rejects.toBeInstanceOf(MailUnavailable);
      await expect(mailNotifier(failing, id, receipt())).rejects.not.toBeInstanceOf(MailRefused);
      expect(await mailNotifier(h.deps, id, receipt())).toBe("sent");
      const link = h.mailer.sent[0]!.data.pageUrl;
      h.clock.advance(DAY + 1000);
      expect(await mailNotifier(h.deps, id, receipt())).toBe("sent");
      expect(h.mailer.sent[1]!.data.pageUrl).toBe(link);

      const bad = await contact(h);
      const refusing = withMailer(h, async () => {
        throw new MailRefused("no such mailbox");
      });
      expect(await mailNotifier(refusing, bad.id, receipt())).toBe("refused");
      expect(h.mailer.sent.filter((m) => m.to === bad.email)).toHaveLength(0);
      expect(email).not.toBe(bad.email);
    });
  });

  describe("mailAccount: a signed-in sender's receipt", () => {
    async function account(h: FlowHarness) {
      const email = newTestEmail("reporter");
      addresses.push(email);
      const user = await repo.createUser({ email, termsVersion: "test", now: h.clock.now() });
      return { id: user.id, email };
    }

    test("sends notice_received to the account's address without a page link; neither the cap nor a confirmation applies", async () => {
      const h = flowHarness(repo);
      const { id, email } = await account(h);
      for (let n = 0; n < 3; n++) expect(await mailAccount(h.deps, id, receipt())).toBe("sent");
      expect(h.mailer.sent).toHaveLength(3);
      expect(h.mailer.sent[0]).toMatchObject({ to: email, template: "notice_received" });
      expect(h.mailer.sent[0]!.data).toEqual({
        ref: "N-ABCDEFGH23",
        time: "2026-10-04 06:59 UTC",
        items: "http://localhost:8081/post/0190f3a2-7c1e-7b1a-9f00-0123456789ab, http://localhost:8081/u/ada",
        termsUrl: "http://localhost:8081/terms",
      });
    });

    test("an account whose address said stop gets no report mail, and says so; the account's own resume lifts it", async () => {
      const h = flowHarness(repo);
      const { id, email } = await account(h);
      expect(await accountReportMailStopped(h.deps, id)).toBe(false);
      expect(await resumeAccountReportMail(h.deps, id)).toBe(false);
      // The stop came from a notice sent signed out under the same address.
      const signedOut = await contact(h, { email });
      expect(await mailNotifier(h.deps, signedOut.id, receipt())).toBe("sent");
      expect(await stopNotifier(h.deps, signedOut.id, tokenSentTo(h, email))).toBe(true);
      expect(await accountReportMailStopped(h.deps, id)).toBe(true);
      const sentBefore = h.mailer.sent.length;
      expect(await mailAccount(h.deps, id, receipt())).toBe("suppressed");
      expect(h.mailer.sent).toHaveLength(sentBefore);
      expect(await resumeAccountReportMail(h.deps, id)).toBe(true);
      expect(await accountReportMailStopped(h.deps, id)).toBe(false);
      expect(await mailAccount(h.deps, id, receipt())).toBe("sent");
      // An account that does not exist stopped nothing and resumes nothing.
      expect(await accountReportMailStopped(h.deps, randomUUID())).toBe(false);
      expect(await resumeAccountReportMail(h.deps, randomUUID())).toBe(false);
    });

    test("no_address for a deleted account and for one that never was; refused and unavailable as for a notifier", async () => {
      const h = flowHarness(repo);
      expect(await mailAccount(h.deps, randomUUID(), receipt())).toBe("no_address");
      const gone = await account(h);
      await repo.markDeleted(gone.id, h.clock.now());
      expect(await mailAccount(h.deps, gone.id, receipt())).toBe("no_address");
      expect(h.mailer.sent).toHaveLength(0);
      const { id } = await account(h);
      expect(
        await mailAccount(
          withMailer(h, async () => {
            throw new MailRefused("no such mailbox");
          }),
          id,
          receipt(),
        ),
      ).toBe("refused");
      await expect(
        mailAccount(
          withMailer(h, async () => {
            throw new MailUnavailable("relay down");
          }),
          id,
          receipt(),
        ),
      ).rejects.toBeInstanceOf(MailUnavailable);
    });
  });

  describe("mailStaff: an alert to every live staff account", () => {
    test("goes to every moderator and admin, to no user and to no deleted staff account, and answers how many addresses the relay took", async () => {
      const h = flowHarness(repo);
      const [moderator, admin, gone] = [await newStaffAccount(db, repo, "moderator"), await newStaffAccount(db, repo, "admin"), await newStaffAccount(db, repo, "moderator")];
      await repo.markDeleted(gone.user.id, h.clock.now());
      const user = await repo.createUser({ email: newTestEmail("plain"), termsVersion: "test", now: h.clock.now() });
      const accepted = await mailStaff(h.deps, { template: "moderation_urgent", count: 2, oldest: new Date("2026-10-04T06:59:59.123Z") });
      // Other suites leave staff accounts in the shared database: every one of them is mailed too.
      expect(accepted).toBe(h.mailer.sent.length);
      const recipients = h.mailer.sent.map((m) => m.to);
      expect(recipients).toEqual(expect.arrayContaining([moderator.user.email, admin.user.email]));
      expect(recipients).not.toContain(gone.user.email);
      expect(recipients).not.toContain(user.email);
      expect(new Set(recipients).size).toBe(recipients.length);
      for (const sent of h.mailer.sent) {
        expect(sent.template).toBe("moderation_urgent");
        expect(sent.data).toEqual({ count: "2", oldest: "2026-10-04 06:59 UTC" });
      }
    });

    test("is best effort: a relay that takes no mail gives 0 and nothing is thrown; one that takes some gives their number", async () => {
      const h = flowHarness(repo);
      await newStaffAccount(db, repo, "moderator");
      await newStaffAccount(db, repo, "admin");
      const message = { template: "moderation_urgent", count: 1, oldest: h.clock.now() } as const;
      expect(
        await mailStaff(
          withMailer(h, async () => {
            throw new MailUnavailable("relay down");
          }),
          message,
        ),
      ).toBe(0);
      let sends = 0;
      const everyOther = withMailer(h, async () => {
        if (++sends % 2 === 0) throw new MailRefused("no such mailbox");
      });
      const accepted = await mailStaff(everyOther, message);
      expect(sends).toBeGreaterThanOrEqual(2);
      expect(accepted).toBe(Math.ceil(sends / 2));
    });
  });

  describe("what staff may know of a contact, and what only its mail token does", () => {
    test("notifierFacts: whether a name and an address were given, and whether the address is confirmed or stopped; an id without a row is not found", async () => {
      const h = flowHarness(repo);
      const [both, named, addressed] = [await contact(h, { name: "Ada" }), await contact(h, { name: "Bob", email: undefined }), await contact(h)];
      const missing = randomUUID();
      const none = { found: false, named: false, contactGiven: false, confirmed: false, suppressed: false };
      let facts = await notifierFacts(h.deps, [both.id, named.id, addressed.id, missing]);
      expect(Object.fromEntries(facts)).toEqual({
        [both.id]: { found: true, named: true, contactGiven: true, confirmed: false, suppressed: false },
        [named.id]: { found: true, named: true, contactGiven: false, confirmed: false, suppressed: false },
        [addressed.id]: { found: true, named: false, contactGiven: true, confirmed: false, suppressed: false },
        [missing]: none,
      });
      await mailNotifier(h.deps, both.id, receipt());
      await mailNotifier(h.deps, addressed.id, receipt());
      await confirmNotifier(h.deps, both.id, tokenSentTo(h, both.email!));
      await stopNotifier(h.deps, addressed.id, tokenSentTo(h, addressed.email!));
      facts = await notifierFacts(h.deps, [both.id, addressed.id]);
      expect(facts.get(both.id)).toMatchObject({ confirmed: true, suppressed: false });
      expect(facts.get(addressed.id)).toMatchObject({ confirmed: false, suppressed: true });
      // A confirmation lasts 30 days.
      h.clock.advance(30 * DAY + 1000);
      expect((await notifierFacts(h.deps, [both.id])).get(both.id)!.confirmed).toBe(false);
      expect(await notifierFacts(h.deps, [])).toEqual(new Map());
    });

    test("notifierName answers the name that was given, or null", async () => {
      const h = flowHarness(repo);
      const [named, unnamed] = [await contact(h, { name: "Ada Lovelace" }), await contact(h)];
      expect(await notifierName(h.deps, named.id)).toBe("Ada Lovelace");
      expect(await notifierName(h.deps, unnamed.id)).toBeNull();
      expect(await notifierName(h.deps, randomUUID())).toBeNull();
    });

    test("only the contact's own mail token matches, confirms or stops: not another contact's, not a guess, and nothing for a contact without an address", async () => {
      const h = flowHarness(repo);
      const [mine, other, named] = [await contact(h), await contact(h), await contact(h, { name: "Ada", email: undefined })];
      await mailNotifier(h.deps, mine.id, receipt());
      await mailNotifier(h.deps, other.id, receipt());
      const [token, othersToken] = [tokenSentTo(h, mine.email!), tokenSentTo(h, other.email!)];
      expect(token).not.toBe(othersToken);
      expect(await notifierMailTokenMatches(h.deps, mine.id, token)).toBe(true);
      for (const wrong of [othersToken, "A".repeat(43), "", token.slice(0, 42)]) {
        expect(await notifierMailTokenMatches(h.deps, mine.id, wrong), wrong).toBe(false);
        expect(await confirmNotifier(h.deps, mine.id, wrong), wrong).toBe(false);
        expect(await stopNotifier(h.deps, mine.id, wrong), wrong).toBe(false);
      }
      for (const id of [named.id, randomUUID()]) {
        expect(await notifierMailTokenMatches(h.deps, id, token)).toBe(false);
        expect(await confirmNotifier(h.deps, id, token)).toBe(false);
        expect(await stopNotifier(h.deps, id, token)).toBe(false);
      }
      // Nothing was confirmed or stopped by any of it.
      expect((await notifierFacts(h.deps, [mine.id])).get(mine.id)).toMatchObject({ confirmed: false, suppressed: false });
      // Stopping twice, and confirming twice, is each done once.
      expect(await stopNotifier(h.deps, mine.id, token)).toBe(true);
      expect(await stopNotifier(h.deps, mine.id, token)).toBe(true);
      expect(await confirmNotifier(h.deps, mine.id, token)).toBe(true);
      expect(await confirmNotifier(h.deps, mine.id, token)).toBe(true);
      expect((await notifierFacts(h.deps, [mine.id])).get(mine.id)).toMatchObject({ confirmed: true, suppressed: false });
    });
  });

  describe("forgetting", () => {
    test("forgetNotifierAfter moves the day a contact is forgotten, and no other column of it can be written", async () => {
      const h = flowHarness(repo);
      const [one, two, kept] = [await contact(h), await contact(h), await contact(h)];
      const untouched = await forgetAfterOf(kept.id);
      const at = new Date("2027-04-04T07:00:00.000Z");
      await forgetNotifierAfter(h.deps, [one.id, two.id, randomUUID()], at);
      await forgetNotifierAfter(h.deps, [], at);
      for (const id of [one.id, two.id]) expect(await forgetAfterOf(id)).toBe(at.getTime());
      expect(await forgetAfterOf(kept.id)).toBe(untouched);
      const failure = await db.execute(sql`update auth.notifier_contacts set email_hash = 'x' where id = ${one.id}::uuid`).then(() => null, (err: unknown) => err);
      expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied/);
    });

    test("findNotifierContacts answers the contacts of an address, however it is written, with their names; overdueContacts counts what the janitor should have taken a day ago", async () => {
      const h = flowHarness(repo);
      const first = await contact(h, { name: "Ada" });
      const second = await contact(h, { email: first.email });
      const found = await findNotifierContacts(h.deps, ` ${first.email!.toUpperCase()} `);
      expect(found).toHaveLength(2);
      expect(found).toEqual(expect.arrayContaining([{ id: first.id, name: "Ada" }, { id: second.id, name: null }]));
      expect(await findNotifierContacts(h.deps, newTestEmail("nobody"))).toEqual([]);

      const overdue = await overdueContacts(h.deps);
      // A contact due an hour ago is not overdue yet; one due two days ago is, and so is a confirmation that ran out two days ago.
      await forgetNotifierAfter(h.deps, [first.id], new Date(h.clock.ms() - HOUR));
      expect(await overdueContacts(h.deps)).toBe(overdue);
      await forgetNotifierAfter(h.deps, [second.id], new Date(h.clock.ms() - 2 * DAY));
      expect(await overdueContacts(h.deps)).toBe(overdue + 1);
      // A confirmation made now is not overdue; one made 32 days ago ran out two days ago, and is.
      await mailNotifier(h.deps, first.id, receipt());
      await confirmNotifier(h.deps, first.id, tokenSentTo(h, first.email!));
      expect(await overdueContacts(h.deps)).toBe(overdue + 1);
      const past = flowHarness(repo);
      past.clock.advance(-32 * DAY);
      const old = await contact(past);
      await mailNotifier(past.deps, old.id, receipt());
      await confirmNotifier(past.deps, old.id, tokenSentTo(past, old.email!));
      expect(await overdueContacts(h.deps)).toBe(overdue + 2);
    });
  });

  test("this file left no row behind: the notifier tables hold what they held before it", async () => {
    const hashes = addresses.map((address) => emailHash(flowHarness(repo).deps.config.authHmacKey, address));
    if (contactIds.length > 0) await db.execute(sql`delete from auth.notifier_contacts where id = any(${`{${contactIds.join(",")}}`}::uuid[])`);
    if (hashes.length > 0) {
      await db.execute(sql`delete from auth.notifier_confirmations where email_hash = any(${`{${hashes.join(",")}}`}::text[])`);
      await db.execute(sql`delete from auth.notifier_suppressions where email_hash = any(${`{${hashes.join(",")}}`}::text[])`);
    }
    expect(await counts()).toEqual(before);
  });
});
```

### Create `apps/api/test/integration/http-notices.test.ts`

```ts
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ErrorEnvelope, FlowResponse, NoticeResponse, NoticeStatus, type NoticeRequest } from "@korbat/contracts";
import { randomToken } from "../../src/auth/crypto";
import { Browser, NativeClient } from "./http-client";
import { newPostRow } from "./moderation-fixtures";
import { HUMAN, accountTarget, linkTarget, notices, noticesWorld, postTarget, type NoticesWorld } from "./notices-harness";

// Each test signs accounts up over HTTP and waits for the mails a notice starts: on a loaded machine that takes longer
// than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

const HOUR = 60 * 60_000;

/**
 * POST /api/notices, /api/notices/status and /api/notices/contact through the real app (3c design, sections 7.1, 7.2 and
 * 12): a session is optional, so the same route answers a browser without cookies, a signed-in browser with its CSRF
 * token, and a client that sends neither cookie nor Origin; the human check, the limits per network and every refusal
 * code as HTTP answers them. What the flows store is tested in moderation-notices.test.ts. Every test commits, and what
 * it stored is removed after it; the file's last test holds the tables to what they held before it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: reports and notices over HTTP", () => {
  let w: NoticesWorld;
  let origin: string;
  let before: Record<string, number>;

  beforeAll(async () => {
    w = noticesWorld();
    origin = w.config.APP_ORIGIN;
    before = await w.counts();
  });
  afterAll(async () => {
    await w.close();
  });
  beforeEach(() => {
    w.mailer.mode = "deliver";
    w.mailer.attempts.length = 0;
    w.mailer.sent.length = 0;
    // Past every hourly window of the limit store and the urgent alert's throttle.
    w.ahead.limitsMs += HOUR;
  });
  afterEach(async () => {
    await w.cleanUp();
  });

  const browser = (ip?: string) => new Browser(w.app, origin, { ip });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const send = (b: Browser | NativeClient, body: unknown) => b.fetch("/api/notices", { json: body });
  /** A stored notice's answer, remembered for the cleanup. */
  const stored = async (res: Response) => {
    expect(res.status, await res.clone().text()).toBe(201);
    return w.remember(NoticeResponse.parse(await res.json()));
  };
  const missingPost = () => linkTarget(`${origin}/post/${randomUUID()}`);
  const withoutToken = (request: NoticeRequest) => {
    const { turnstileToken: _token, ...rest } = request;
    return rest;
  };

  /** A browser signed in over HTTP; with `onboard` false the account has not chosen a handle yet. */
  async function signUp(onboard = true) {
    const b = browser();
    const email = `notice-${randomUUID()}@korbat.local`;
    const handle = `h${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: HUMAN, deviceId: randomToken(), platform: "web" } });
    expect(start.status, await start.clone().text()).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: w.mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: w.config.TERMS_VERSION } })).status).toBe(200);
    let id: string | null = null;
    if (onboard) {
      expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
      id = (await w.migrateDb.execute<{ id: string }>(sql`select id from profiles where handle = ${handle}`))[0]!.id;
      w.profileIds.push(id);
    }
    return { b, email, handle, id };
  }

  /** An account with a post, as fixtures make them: the target of the reports below. */
  async function reported() {
    const author = await w.account();
    return { author, postId: await newPostRow(w.apiDb, author.id) };
  }

  test("the three routes are the module's whole surface under /api/notices, each a POST: nothing acts when an address is merely opened", async () => {
    const routes = w.app.routes.filter((route) => route.path.startsWith("/api/notices") && route.method !== "ALL").map((route) => `${route.method} ${route.path}`);
    expect([...new Set(routes)].sort()).toEqual(["POST /api/notices", "POST /api/notices/contact", "POST /api/notices/status"]);
    for (const path of ["/api/notices", "/api/notices/status", "/api/notices/contact", "/api/notices/N-ABCDEFGH23"]) {
      const res = await w.app.request(path);
      expect(res.status, path).toBe(404);
      expect((await error(res)).code, path).toBe("not_found");
    }
  });

  test("signed out, a rule report and a notice on the path for child sexual abuse material are refused without a token the human check passes, and taken with one", async () => {
    const { postId } = await reported();
    for (const request of [notices.rule([postTarget(postId)]), notices.csam([postTarget(postId)]), notices.illegal([postTarget(postId)])]) {
      for (const body of [withoutToken(request), { ...request, turnstileToken: "not-human" }]) {
        const res = await send(browser(), body);
        expect(res.status).toBe(403);
        // The API holds no contact address: the app words this code itself, with the users' address.
        expect(await error(res)).toMatchObject({ code: "human_check_failed", message: "We could not verify that you are human. Try again." });
      }
      const res = await send(browser(), request);
      const answer = await stored(res);
      expect(answer.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("a signed-out notice passes the app's site with its Origin checked and no CSRF token; another site's page cannot send one", async () => {
    const { postId } = await reported();
    // A browser without a cookie has no CSRF token to send: the allowed Origin is the whole check.
    const b = browser();
    expect(b.cookie("__Host-korbat_csrf")).toBeUndefined();
    await stored(await send(b, notices.rule([postTarget(postId)])));
    const foreign = new Browser(w.app, "https://evil.example");
    const refused = await send(foreign, notices.rule([postTarget(postId)]));
    expect(refused.status).toBe(403);
    expect((await error(refused)).code).toBe("csrf_failed");
    // A client that is no browser sends no Origin at all, and is held to the human check and the limits like anyone.
    await stored(await send(new NativeClient(w.app), notices.rule([postTarget(postId)])));
    expect((await send(new NativeClient(w.app), withoutToken(notices.rule([postTarget(postId)])))).status).toBe(403);
  });

  test("signed in: no human check and no token in the answer; the cookie session needs its CSRF token; a name or an address is refused", async () => {
    const { postId } = await reported();
    const reporter = await signUp();
    const answer = await stored(await send(reporter.b, { ground: "rule", ruleId: "R3", targets: [postTarget(postId)] }));
    expect(answer).toEqual({ ref: expect.stringMatching(/^N-[A-Z2-7]{10}$/) });
    expect(await w.notice(answer.ref)).toMatchObject({ channel: "signed_in", reporter_id: reporter.id, rule_id: "R3" });

    const withoutCsrf = await reporter.b.fetch("/api/notices", { json: { ground: "rule", ruleId: "R1", targets: [missingPost()] }, csrf: false });
    expect(withoutCsrf.status).toBe(403);
    expect((await error(withoutCsrf)).code).toBe("csrf_failed");
    const illegal = withoutToken(notices.illegal([missingPost()]));
    for (const extra of [{ name: "Ada" }, { email: "ada@example.com" }]) {
      const res = await send(reporter.b, { ...illegal, ...extra });
      expect(res.status).toBe(400);
      expect((await error(res)).code).toBe("invalid_request");
    }
    // The same person's second report of the post on the same rule ground.
    const again = await send(reporter.b, { ground: "rule", ruleId: "R1", targets: [postTarget(postId)] });
    expect(again.status).toBe(409);
    expect(await error(again)).toMatchObject({ code: "already_reported", message: "You already reported this; it is being looked at." });
    // The illegal ground mails its receipt to the account's own address.
    const notice = await stored(await send(reporter.b, illegal));
    await w.moderation.settle();
    expect(w.mailer.to(reporter.email, "notice_received")).toHaveLength(1);
    expect((await w.notice(notice.ref))!.receipt).toBe("sent");
  });

  test("a signed-in session that has not finished onboarding is answered onboarding_required, as every signed-in route answers it, whatever token it sends", async () => {
    const { postId } = await reported();
    const unfinished = await signUp(false);
    const counts = await w.counts();
    for (const request of [notices.rule([postTarget(postId)]), notices.csam([postTarget(postId)])]) {
      const res = await send(unfinished.b, request);
      expect(res.status).toBe(403);
      expect(await error(res)).toMatchObject({ code: "onboarding_required", message: "Choose a handle to finish setting up your account." });
    }
    expect(await w.counts()).toEqual(counts);
  });

  test("a staff account's session in the app is answered staff_cannot_report: staff report only as their own finding, in the console", async () => {
    const { postId } = await reported();
    const member = await signUp();
    await w.repo.setRole(member.id!, "moderator");
    // The session's cached copy runs out; the next request reads the account's role again.
    w.ahead.kvMs += 61_000;
    const counts = await w.counts();
    const res = await send(member.b, { ground: "rule", ruleId: "R1", targets: [postTarget(postId)] });
    expect(res.status).toBe(403);
    expect((await error(res)).code).toBe("staff_cannot_report");
    expect(await w.counts()).toEqual(counts);
  });

  test("a body that is no notice is invalid_request, a link to another site or path its own 422, and a notice of child sexual abuse material whose links name two accounts invalid_request; nothing is written", async () => {
    const { author, postId } = await reported();
    const other = await w.account();
    const counts = await w.counts();
    const posts = (n: number) => Array.from({ length: n }, () => postTarget(randomUUID()));
    for (const body of [
      { ...notices.rule(posts(11)) },
      { ...notices.rule([postTarget(postId)]), ruleId: "R2" },
      { ...notices.csam([postTarget(postId)]), name: "Ada" },
      { ...notices.csam([accountTarget(author.handle), accountTarget(other.handle)]) },
      { ...notices.csam([linkTarget(`${origin}/u/${author.handle}`), linkTarget(`${origin}/u/${other.handle}`)]) },
      { ...notices.illegal([postTarget(postId)]), explanation: undefined },
      { ...notices.rule([{ kind: "link", url: "not a link" } as never]) },
      { ground: "rule" },
      "not json",
    ]) {
      const res = await send(browser(), body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await error(res)).code).toBe("invalid_request");
    }
    for (const [url, code] of [
      [`https://elsewhere.example/post/${postId}`, "notice_link_offsite"],
      [`${origin}/explore/about`, "notice_link_invalid"],
    ] as const) {
      const res = await send(browser(), notices.rule([linkTarget(url)]));
      expect(res.status, url).toBe(422);
      expect((await error(res)).code, url).toBe(code);
    }
    expect(await w.counts()).toEqual(counts);
  });

  test("signed out the limit is per network: five an hour for a whole IPv6 /64, whichever of its addresses sends, with Retry-After on the sixth; the next /64 has its own", async () => {
    const prefix = `2001:db8:${randomInt(0x10000).toString(16)}:${randomInt(0x10000).toString(16)}`;
    const address = (network: string, n: number) => `${network}:0:0:0:${(n + 1).toString(16)}`;
    for (let n = 0; n < 5; n++) await stored(await send(browser(address(prefix, n)), notices.rule([missingPost()])));
    const sixth = await send(browser(address(prefix, 99)), notices.rule([missingPost()]));
    expect(sixth.status).toBe(429);
    expect((await error(sixth)).code).toBe("rate_limited");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(sixth.headers.get("retry-after"))).toBeLessThanOrEqual(3600);
    const next = `2001:db8:${randomInt(0x10000).toString(16)}:ffff`;
    await stored(await send(browser(address(next, 0)), notices.rule([missingPost()])));
    // An IPv4 address is a network of its own.
    const v4 = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    for (let n = 0; n < 5; n++) await stored(await send(browser(v4), notices.rule([missingPost()])));
    expect((await send(browser(v4), notices.rule([missingPost()]))).status).toBe(429);
  });

  test("the status page and its two buttons over HTTP: the tokens travel in a POST's body, a wrong one is 404, and a button answers 204", async () => {
    const { postId } = await reported();
    const email = w.address();
    const answer = await stored(await send(browser(), notices.illegal([postTarget(postId)], { name: "Ada", email })));
    await w.moderation.settle();
    const page = await browser().fetch("/api/notices/status", { json: { ref: answer.ref, token: answer.token } });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    const status = NoticeStatus.parse(await page.json());
    expect(status).toMatchObject({ ref: answer.ref, contact: { given: true, confirmed: null, stopped: null } });
    expect(status.items).toMatchObject([{ position: 1, link: `${origin}/post/${postId}`, outcome: null }]);
    // No answer of these routes carries the name or the address.
    expect(JSON.stringify(status)).not.toMatch(/Ada|@/);

    const press = (token: string, choice: string) => browser().fetch("/api/notices/contact", { json: { ref: answer.ref, token, choice } });
    for (const res of [await browser().fetch("/api/notices/status", { json: { ref: answer.ref, token: "A".repeat(43) } }), await press(answer.token!, "stop"), await press(answer.token!, "confirm")]) {
      expect(res.status).toBe(404);
      expect(await error(res)).toMatchObject({ code: "notice_not_found" });
    }
    const mailToken = /#t=([A-Za-z0-9_-]{43})$/.exec(w.mailer.to(email, "notice_received")[0]!.data.pageUrl!)![1]!;
    const stopped = await press(mailToken, "stop");
    expect(stopped.status).toBe(204);
    expect(await stopped.text()).toBe("");
    const byMail = NoticeStatus.parse(await (await browser().fetch("/api/notices/status", { json: { ref: answer.ref, token: mailToken } })).json());
    expect(byMail.contact).toEqual({ given: true, confirmed: false, stopped: true });
    expect((await press(mailToken, "confirm")).status).toBe(204);
    for (const body of [{ ref: answer.ref }, { ref: "nope", token: answer.token }, { ref: answer.ref, token: answer.token, extra: 1 }]) {
      expect((await browser().fetch("/api/notices/status", { json: body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await browser().fetch("/api/notices/contact", { json: { ref: answer.ref, token: mailToken, choice: "resume" } })).status).toBe(400);
    // Another site's page cannot press a button either.
    const foreign = await new Browser(w.app, "https://evil.example").fetch("/api/notices/contact", { json: { ref: answer.ref, token: mailToken, choice: "stop" } });
    expect(foreign.status).toBe(403);

    // The 30 reads an hour count per network: the 31st from one address is refused, with Retry-After.
    const reader = browser();
    for (let n = 0; n < 30; n++) expect((await reader.fetch("/api/notices/status", { json: { ref: answer.ref, token: answer.token } })).status).toBe(200);
    const over = await reader.fetch("/api/notices/status", { json: { ref: answer.ref, token: answer.token } });
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("this file left no row behind: the moderation tables, the posts and profiles and the notifier tables hold what they held before it", async () => {
    await w.cleanUp();
    expect(await w.counts()).toEqual(before);
  });
});
```

### Create `apps/api/test/integration/moderation-notices.test.ts`

```ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ITEM_OUTCOMES, NOTICE_LIMITS, NoticeStatus, type NoticeRequest } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { purge } from "../../src/account/flows/deletion";
import type { AccountDeps } from "../../src/account/context";
import { createMediaRepo } from "../../src/media/repo";
import { createBackground, type ModerationDeps } from "../../src/moderation/context";
import { STATUS_READS_PER_HOUR, liveTarget, noticeContact, noticeStatus, sendReceipt, submitNotice, type NoticeSender } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import type { SocialDeps } from "../../src/social/context";
import { deletePost } from "../../src/social/flows/posts";
import { createSocialRepo } from "../../src/social/repo";
import { deciderWorld } from "./moderation-decide";
import { act, casesMedia, gate, imagePost, newPostRow, postFrozen, refusal, untilBlocked, uuids, type DecisionInput } from "./moderation-fixtures";
import { HUMAN, accountTarget, linkTarget, notices, noticesWorld, postTarget, type NoticesWorld } from "./notices-harness";
import { newStaffAccount, withLockTimeout } from "./staff-fixtures";

// Each test commits on two pools and waits for the mails a notice starts: on a loaded machine that takes longer than the
// five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

const HOUR = 60 * 60_000;

/**
 * Reports and notices as the routes run them (3c design, sections 7.1 and 7.2), through the moderation module's flows
 * with the real auth module behind them: who may send, the human check and the limits, the targets and the one liveness
 * rule, what follows the commit, the status page and the contact's two buttons, and a notice on the path for child sexual
 * abuse material racing its target's deletion. The HTTP side of the same routes is in http-notices.test.ts. Every test
 * commits, and what it stored is removed after it; the file's last test holds the tables to what they held before it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: reports and notices", () => {
  let w: NoticesWorld;
  let app: string;
  let before: Record<string, number>;
  /** A staff account of this file's own, which every urgent alert must reach. */
  let staffAddress: string;

  beforeAll(async () => {
    w = noticesWorld();
    app = w.config.APP_ORIGIN;
    before = await w.counts();
    staffAddress = (await newStaffAccount(w.authDb, w.repo, "moderator")).user.email;
  });
  afterAll(async () => {
    await w.close();
  });
  beforeEach(() => {
    w.mailer.mode = "deliver";
    w.mailer.attempts.length = 0;
    w.mailer.sent.length = 0;
    // Past every window of the limit store but the day's: no test meets another's hourly count or the urgent alert's throttle.
    w.ahead.limitsMs += HOUR;
  });
  afterEach(async () => {
    w.mailer.release();
    await w.cleanUp();
  });

  const submit = async (request: NoticeRequest, from: NoticeSender = w.sender()) => w.remember(await submitNotice(w.deps, request, from));
  const settle = () => w.moderation.settle();
  const status = (ref: string, token: string) => noticeStatus(w.deps, { ref, token }, w.sender().netHash);
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
  const missingPost = () => linkTarget(`${app}/post/${randomUUID()}`);
  const urgentMails = () => w.mailer.to(staffAddress, "moderation_urgent");
  const urgentCases = async () => (await w.apiDb.execute<{ n: number }>(sql`select count(*)::int as n from cases where closed_at is null and lane = 0`))[0]!.n;
  const existing = async (ids: readonly string[]) => (await w.migrateDb.execute<{ id: string }>(sql`select id from post_media where id = any(${uuids(ids)}) order by id`)).map((row) => row.id);
  const holds = async (ids: readonly string[]) => (await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from media_holds where media_id = any(${uuids(ids)}) and released_at is null`))[0]!.n;
  const mailToken = (address: string) => /#t=([A-Za-z0-9_-]{43})$/.exec(w.mailer.to(address, "notice_received").at(-1)!.data.pageUrl!)![1]!;
  /** The author's deletion of a post, as the social module's flow runs it, over a pool or an open transaction. No file is asked for: these posts' images have none. */
  const deleteByAuthor = (db: Db | DbTx, authorId: string, postId: string) => {
    const media = createMediaRepo(db as Db);
    const social = { repo: createSocialRepo(db as Db), media: { detachAll: (tx: DbTx, id: string) => media.detachAll(tx, id), requestDeletion: async () => undefined }, now: () => new Date() } as unknown as SocialDeps;
    return deletePost(social, authorId, postId);
  };
  /** The account's purge, as the account module's flow runs it once the auth side has taken the account down. */
  const purgeAccount = (db: Db | DbTx, userId: string) => {
    const media = createMediaRepo(db as Db);
    const account = {
      social: { purgeProfile: (id: string, now: Date, within: (tx: DbTx) => Promise<void>) => createSocialRepo(db as Db).purgeProfile(id, now, within) },
      media: { purgeOwner: (tx: DbTx, id: string) => media.purgeOwner(tx, id), requestDeletion: async () => undefined },
      auth: { finishPurge: async () => undefined },
      now: () => new Date(),
    } as unknown as AccountDeps;
    return purge(account, userId);
  };

  describe("who sends it", () => {
    test("signed in, on a rule: the report carries its sender, no token is given, and nothing is mailed", async () => {
      const [author, reporter] = [await w.account(), await w.account()];
      const postId = await newPostRow(w.apiDb, author.id);
      // A signed-in sender's token is ignored: none is needed, and one that would fail the check changes nothing.
      const answer = await submit({ ground: "rule", ruleId: "R4", targets: [postTarget(postId)], explanation: "It shows my address.", turnstileToken: "not-human" }, w.sender(reporter.session));
      expect(answer).toEqual({ ref: expect.stringMatching(/^N-[A-Z2-7]{10}$/) });
      expect(await w.notice(answer.ref)).toMatchObject({
        kind: "user",
        channel: "signed_in",
        reporter_id: reporter.id,
        contact_id: null,
        rule_id: "R4",
        alleges_illegal: false,
        csam: false,
        category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
        explanation: "It shows my address.",
        bona_fide: false,
        lookup_hash: null,
        receipt: "none",
      });
      expect(await w.items(answer.ref)).toMatchObject([{ position: 1, target_type: "post", target_id: postId, lane: 1, suspect: false, outcome: null, reporter_account_id: reporter.id, case_lane: 1 }]);
      await settle();
      expect(w.mailer.attempts).toHaveLength(0);
    });

    test("signed out without a name or an address: a token, stored only as its hash, and no contact; without the human check nothing is taken", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      for (const request of [notices.rule([postTarget(postId)]), notices.illegal([postTarget(postId)])]) {
        const answer = await submit(request);
        expect(answer.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(await w.notice(answer.ref)).toMatchObject({ channel: "signed_out", reporter_id: null, contact_id: null, lookup_hash: sha256(answer.token!), receipt: "none" });
      }
      const counts = await w.counts();
      const { turnstileToken: _token, ...unchecked } = notices.rule([postTarget(postId)]);
      expect(await refusal(submitNotice(w.deps, unchecked as NoticeRequest, w.sender()))).toBe("human_check_failed");
      expect(await refusal(submitNotice(w.deps, notices.csam([postTarget(postId)], { turnstileToken: "not-human" }), w.sender()))).toBe("human_check_failed");
      expect(await w.counts()).toEqual(counts);
      await settle();
      expect(w.mailer.attempts).toHaveLength(0);
    });

    test("signed out with a name and an address: the notice holds an id alone, the auth module the contact, and the receipt goes at once with a page link of its own token", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      const email = w.address();
      const answer = await submit(notices.illegal([postTarget(postId), accountTarget(author.handle.toUpperCase())], { name: "Ada Lovelace", email, citedLaw: "StGB 241", category: "STATEMENT_CATEGORY_VIOLENCE" }));
      await settle();
      const stored = (await w.notice(answer.ref))!;
      expect(stored).toMatchObject({ channel: "signed_out", reporter_id: null, alleges_illegal: true, category: "STATEMENT_CATEGORY_VIOLENCE", cited_law: "StGB 241", bona_fide: true, lookup_hash: sha256(answer.token!), receipt: "sent", receipt_sent: true });
      expect(stored.contact_id).toMatch(/^[0-9a-f-]{36}$/);
      // Neither the name nor the address is in the notice's row.
      expect(JSON.stringify(stored)).not.toMatch(/Ada|notifier-/);
      expect((await w.items(answer.ref)).map((item) => [item.position, item.lane])).toEqual([[1, 0], [2, 0]]);

      const receipts = w.mailer.to(email, "notice_received");
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.data).toMatchObject({ ref: answer.ref, items: `${app}/post/${postId}, ${app}/u/${author.handle}`, termsUrl: `${app}/terms` });
      expect(receipts[0]!.data.pageUrl).toBe(`${app}/notice/${answer.ref}#t=${mailToken(email)}`);
      // The mail never carries the notice's own token.
      expect(mailToken(email)).not.toBe(answer.token);
      expect(JSON.stringify(receipts[0]!.data)).not.toContain(answer.token!);
      expect((await w.auth.forModeration.notifierFacts([stored.contact_id!])).get(stored.contact_id!)).toEqual({ found: true, named: true, contactGiven: true, confirmed: false, suppressed: false });
      expect(await w.auth.forModeration.notifierName(stored.contact_id!)).toBe("Ada Lovelace");
    });

    test("signed in, on the law: the receipt goes to the account's own address, without a page link; a name or an address from a signed-in sender is refused", async () => {
      const [author, reporter] = [await w.account(), await w.account()];
      const postId = await newPostRow(w.apiDb, author.id);
      const { turnstileToken: _token, ...request } = notices.illegal([postTarget(postId)], { ruleId: "R3" });
      const answer = await submit(request as NoticeRequest, w.sender(reporter.session));
      expect(answer.token).toBeUndefined();
      await settle();
      expect(await w.notice(answer.ref)).toMatchObject({ channel: "signed_in", reporter_id: reporter.id, contact_id: null, rule_id: "R3", alleges_illegal: true, lookup_hash: null, receipt: "sent", receipt_sent: true });
      const receipts = w.mailer.to(reporter.email, "notice_received");
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.data).toEqual({ ref: answer.ref, time: expect.stringMatching(/^[0-9-]{10} [0-9:]{5} UTC$/), items: `${app}/post/${postId}`, termsUrl: `${app}/terms` });

      const counts = await w.counts();
      for (const extra of [{ name: "Ada" }, { email: w.address() }]) {
        expect(await refusal(submitNotice(w.deps, { ...request, ...extra } as NoticeRequest, w.sender(reporter.session)))).toBe("invalid_request");
      }
      expect(await w.counts()).toEqual(counts);
    });

    test("a staff account does not report, and a session that has not finished onboarding is refused, never treated as signed out; neither is counted or stored", async () => {
      const [author, member] = [await w.account(), await w.account()];
      const postId = await newPostRow(w.apiDb, author.id);
      // Every refused request below names this one account and comes from this one network.
      const network = w.sender().netHash;
      const from = (session: NoticeSender["session"]): NoticeSender => ({ session, netHash: network });
      const counts = await w.counts();
      for (const role of ["moderator", "admin"] as const) {
        expect(await refusal(submitNotice(w.deps, notices.rule([postTarget(postId)]), from({ userId: member.id, role, onboarded: true })))).toBe("staff_cannot_report");
      }
      const unfinished = from({ userId: member.id, role: "user", onboarded: false });
      // It carries the token a signed-out sender needs, and is refused all the same.
      expect(await refusal(submitNotice(w.deps, notices.rule([postTarget(postId)]), unfinished))).toBe("onboarding_required");
      expect(await refusal(submitNotice(w.deps, notices.csam([postTarget(postId)]), unfinished))).toBe("onboarding_required");
      expect(await w.counts()).toEqual(counts);
      // Not counted: the account can still send every report of its hour, and the network every one a signed-out sender has.
      const asUser = from(member.session);
      const report = (): NoticeRequest => ({ ground: "rule", ruleId: "R1", targets: [missingPost()] });
      for (let n = 0; n < NOTICE_LIMITS.signedIn.perHour; n++) await submit(report(), asUser);
      expect(await refusal(submitNotice(w.deps, report(), asUser))).toBe("rate_limited");
      for (let n = 0; n < NOTICE_LIMITS.signedOut.perHour; n++) await submit(notices.rule([missingPost()]), from(null));
      expect(await refusal(submitNotice(w.deps, notices.rule([missingPost()]), from(null)))).toBe("rate_limited");
    });

    test("on the path for child sexual abuse material no sender is recorded, signed in or out: a token, the urgent lane, and the keyword of the choice", async () => {
      const [author, reporter] = [await w.account(), await w.account()];
      const { postId } = await imagePost(w.apiDb, 1, author.id);
      const signedOut = await submit(notices.csam([postTarget(postId)], { keyword: "grooming", explanation: "The image.", bonaFide: true }));
      const signedIn = await submit({ ground: "csam", targets: [postTarget(postId)], keyword: "abuse" }, w.sender(reporter.session));
      for (const answer of [signedOut, signedIn]) expect(answer.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const expected = { kind: "user", reporter_id: null, contact_id: null, rule_id: null, alleges_illegal: true, csam: true, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", receipt: "none" };
      expect(await w.notice(signedOut.ref)).toMatchObject({ ...expected, channel: "signed_out", category_keyword: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS", explanation: "The image.", bona_fide: true, lookup_hash: sha256(signedOut.token!) });
      expect(await w.notice(signedIn.ref)).toMatchObject({ ...expected, channel: "signed_in", category_keyword: null, explanation: null, bona_fide: false, lookup_hash: sha256(signedIn.token!) });
      for (const answer of [signedOut, signedIn]) {
        expect(await w.items(answer.ref)).toMatchObject([{ position: 1, target_id: postId, lane: 0, suspect: true, outcome: null, reporter_account_id: null, case_lane: 0 }]);
      }
    });
  });

  describe("what follows the commit", () => {
    test("the receipt's states: folded for a second notice to an unconfirmed address, suppressed for a stopped one, no address for a name alone, failed for an address the relay refuses", async () => {
      const email = w.address();
      const first = await submit(notices.illegal([missingPost()], { email }));
      await settle();
      const second = await submit(notices.illegal([missingPost()], { email }));
      await settle();
      expect([(await w.notice(first.ref))!.receipt, (await w.notice(second.ref))!.receipt]).toEqual(["sent", "folded"]);
      expect((await w.notice(second.ref))!.receipt_sent).toBe(false);
      expect(w.mailer.to(email)).toHaveLength(1);

      await noticeContact(w.deps, { ref: first.ref, token: mailToken(email), choice: "stop" }, w.sender().netHash);
      const third = await submit(notices.illegal([missingPost()], { email }));
      const named = await submit(notices.illegal([missingPost()], { name: "Ada" }));
      w.mailer.mode = "refuse";
      const refused = await submit(notices.illegal([missingPost()], { email: w.address() }));
      await settle();
      expect([(await w.notice(third.ref))!.receipt, (await w.notice(named.ref))!.receipt, (await w.notice(refused.ref))!.receipt]).toEqual(["suppressed", "no_address", "failed"]);
      expect(w.mailer.to(email)).toHaveLength(1);
    });

    test("a relay failure leaves the receipt pending; the later try sends it with the same page link, and a receipt already recorded is not sent again", async () => {
      const email = w.address();
      w.mailer.mode = "fail";
      const answer = await submit(notices.illegal([missingPost()], { email }));
      await settle();
      const stored = (await w.notice(answer.ref))!;
      expect(stored).toMatchObject({ receipt: "pending", receipt_sent: false });
      const attempted = w.mailer.attempts.filter((message) => message.to === email);
      expect(attempted).toHaveLength(1);
      expect(w.mailer.to(email)).toHaveLength(0);

      w.mailer.mode = "deliver";
      expect(await sendReceipt(w.deps, stored.id)).toBe("sent");
      expect(await w.notice(answer.ref)).toMatchObject({ receipt: "sent", receipt_sent: true });
      expect(w.mailer.to(email)).toHaveLength(1);
      expect(w.mailer.to(email)[0]!.data).toEqual(attempted[0]!.data);
      expect(await sendReceipt(w.deps, stored.id)).toBe("none");
      expect(w.mailer.to(email)).toHaveLength(1);
    });

    test("the contact is stored after the commit; when that fails the notice stands without it: answered as any other, its receipt recorded as having no address", async () => {
      const store = w.authForModeration.storeNotifierContact;
      w.authForModeration.storeNotifierContact = async () => {
        throw new Error("the auth pool cannot be reached");
      };
      try {
        const answer = await submit(notices.illegal([missingPost()], { name: "Ada", email: w.address() }));
        expect(answer).toEqual({ ref: expect.stringMatching(/^N-/), token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
        await settle();
        const stored = (await w.notice(answer.ref))!;
        expect(stored.receipt).toBe("no_address");
        // Staff see "contact lost or forgotten": no contact has the id the notice names.
        expect((await w.auth.forModeration.notifierFacts([stored.contact_id!])).get(stored.contact_id!)).toEqual({ found: false, named: false, contactGiven: false, confirmed: false, suppressed: false });
        expect(w.mailer.attempts).toHaveLength(0);
        // The status page still answers to the token on screen.
        expect((await status(answer.ref, answer.token!)).contact).toEqual({ given: false, confirmed: null, stopped: null });
      } finally {
        w.authForModeration.storeNotifierContact = store;
      }
    });

    test("the answer never waits for a mail: a notice with an address and one on the urgent path are answered while the relay hangs, and their mails are recorded once it answers", async () => {
      const author = await w.account();
      const { postId } = await imagePost(w.apiDb, 1, author.id);
      const email = w.address();
      w.mailer.mode = "hang";
      const withAddress = await submit(notices.illegal([missingPost()], { email, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" }));
      const urgent = await submit(notices.csam([postTarget(postId)]));
      for (const answer of [withAddress, urgent]) expect(answer).toEqual({ ref: expect.stringMatching(/^N-/), token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
      let settled = false;
      const settling = settle().then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(settled).toBe(false);
      expect((await w.notice(withAddress.ref))!.receipt).toBe("pending");
      expect(w.mailer.sent).toHaveLength(0);
      w.mailer.release();
      await settling;
      expect((await w.notice(withAddress.ref))!.receipt).toBe("sent");
      expect(w.mailer.to(email, "notice_received")).toHaveLength(1);
      expect(urgentMails()).toHaveLength(1);
    });
  });

  describe("the limits", () => {
    test("signed out: 5 an hour and 20 a day for each network, counted after the human check; another network has its own", async () => {
      expect(NOTICE_LIMITS.signedOut).toEqual({ perHour: 5, perDay: 20 });
      const network = w.sender();
      const send = (from: NoticeSender = network, request = notices.rule([missingPost()])) => submitNotice(w.deps, request, from).then(w.remember);
      // A request that fails the human check is not counted.
      for (let n = 0; n < 8; n++) expect(await refusal(send(network, notices.rule([missingPost()], { turnstileToken: "not-human" })))).toBe("human_check_failed");
      for (let n = 0; n < 5; n++) await send();
      await expect(send()).rejects.toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: expect.any(Number) });
      // The ground does not matter, and neither does what the notice names.
      expect(await refusal(send(network, notices.csam([missingPost()])))).toBe("rate_limited");
      await send(w.sender());
      // The next three hours take five each; then the day is used up, though the hour is new.
      for (let hour = 0; hour < 3; hour++) {
        w.ahead.limitsMs += HOUR + 1000;
        for (let n = 0; n < 5; n++) await send();
      }
      w.ahead.limitsMs += HOUR + 1000;
      const refused = await send().then(() => null, (err: { code: string; retryAfterSeconds: number }) => err);
      expect(refused).toMatchObject({ code: "rate_limited" });
      // The day's window began with the first of the twenty: about 20 hours of it are left.
      expect(refused!.retryAfterSeconds).toBeGreaterThan(18 * 3600);
    });

    test("signed in: 10 an hour for each account, whatever network it comes from; a store that cannot count refuses, and nothing is stored", async () => {
      expect(NOTICE_LIMITS.signedIn).toEqual({ perHour: 10, perDay: 50 });
      const reporter = await w.account();
      const send = () => submitNotice(w.deps, { ground: "rule", ruleId: "R1", targets: [missingPost()] }, w.sender(reporter.session)).then(w.remember);
      for (let n = 0; n < 10; n++) await send();
      expect(await refusal(send())).toBe("rate_limited");
      // Another account is not held to this one's count.
      const other = await w.account();
      await submit({ ground: "rule", ruleId: "R1", targets: [missingPost()] }, w.sender(other.session));

      const counts = await w.counts();
      const down: ModerationDeps = {
        ...w.deps,
        limits: {
          hit: async () => {
            throw new Error("the limit store cannot be reached");
          },
          release: async () => undefined,
        },
      };
      await expect(submitNotice(down, notices.rule([missingPost()]), w.sender())).rejects.toMatchObject({ code: "service_unavailable", status: 503 });
      await expect(noticeStatus(down, { ref: "N-ABCDEFGH23", token: "A".repeat(43) }, "net")).rejects.toMatchObject({ code: "service_unavailable", status: 503 });
      expect(await w.counts()).toEqual(counts);
    });
  });

  describe("the targets", () => {
    test("links are parsed, duplicates named once, and each link that names nothing is an item of its own with an id that names nothing", async () => {
      const [author, other, reporter] = [await w.account(), await w.account(), await w.account()];
      const { postId, mediaIds } = await imagePost(w.apiDb, 1, author.id);
      const gone = randomUUID();
      // The other account has left this handle: on a rule it names nothing.
      const left = `old_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${other.id}::uuid, now())`);
      const [unknownOne, unknownTwo] = [`u1_${randomBytes(4).toString("hex")}`, `u2_${randomBytes(4).toString("hex")}`];
      const answer = await submit(
        {
          ground: "rule",
          ruleId: "R1",
          targets: [
            linkTarget(`${app}/post/${postId.toUpperCase()}/`),
            postTarget(postId, mediaIds[0]),
            accountTarget(author.handle),
            linkTarget(`${app}/u/${author.handle.toUpperCase()}`),
            accountTarget(unknownOne),
            accountTarget(unknownTwo),
            linkTarget(`${app}/u/${unknownOne}`),
            linkTarget(`${app}/post/${gone}`),
            accountTarget(left),
          ],
        },
        w.sender(reporter.session),
      );
      const items = await w.items(answer.ref);
      expect(items.map((item) => [item.position, item.target_type, item.named_handle, item.case_id === null, item.outcome])).toEqual([
        [1, "post", null, false, null],
        [2, "account", author.handle, false, null],
        [3, "account", unknownOne, true, "not_available"],
        [4, "account", unknownTwo, true, "not_available"],
        [5, "post", null, true, "not_available"],
        [6, "account", left, true, "not_available"],
      ]);
      // The image one of the two spellings pointed at is kept as the hint.
      expect([items[0]!.target_id, items[0]!.media_id, items[1]!.target_id, items[4]!.target_id]).toEqual([postId, mediaIds[0], author.id, gone]);
      // The three handles that name nothing live have ids that name nothing, each its own: the old handle's is not its account's.
      const made = [items[2]!.target_id, items[3]!.target_id, items[5]!.target_id];
      expect(new Set(made).size).toBe(3);
      expect(made).not.toContain(other.id);
      expect((await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from profiles where id = any(${uuids(made)})`))[0]!.n).toBe(0);
    });

    test("a link to another site or to another path is refused with its own code, and nothing of the notice is stored", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      const counts = await w.counts();
      for (const [url, code] of [
        [`https://elsewhere.example/post/${postId}`, "notice_link_offsite"],
        [`${app}/settings/profile`, "notice_link_invalid"],
        [`${app}/u/${author.handle}/followers`, "notice_link_invalid"],
      ] as const) {
        await expect(submitNotice(w.deps, notices.rule([postTarget(postId), linkTarget(url)]), w.sender())).rejects.toMatchObject({ code, status: 422 });
      }
      expect(await w.counts()).toEqual(counts);
    });

    test("a signed-in sender's target they reported already on the same ground is dropped; when every target is, the answer is already_reported; another ground, and the anonymous path, are heard", async () => {
      const [author, reporter] = [await w.account(), await w.account()];
      const [first, second] = [(await imagePost(w.apiDb, 1, author.id)).postId, await newPostRow(w.apiDb, author.id)];
      const from = () => w.sender(reporter.session);
      const rule = (targets: NoticeRequest["targets"]): NoticeRequest => ({ ground: "rule", ruleId: "R1", targets });
      await submit(rule([postTarget(first)]), from());
      const counts = await w.counts();
      expect(await refusal(submitNotice(w.deps, rule([postTarget(first)]), from()))).toBe("already_reported");
      expect(await refusal(submitNotice(w.deps, rule([linkTarget(`${app}/post/${first}`), postTarget(first)]), from()))).toBe("already_reported");
      expect(await w.counts()).toEqual(counts);
      // Named beside a new target, the reported one is dropped and the new one is the notice's first item.
      const mixed = await submit(rule([postTarget(first), postTarget(second)]), from());
      expect((await w.items(mixed.ref)).map((item) => [item.position, item.target_id])).toEqual([[1, second]]);
      // Beside a link that names nothing, the notice stands with that link alone.
      const withDead = await submit(rule([postTarget(first), accountTarget(`nobody_${randomBytes(4).toString("hex")}`)]), from());
      expect((await w.items(withDead.ref)).map((item) => [item.position, item.target_type, item.outcome])).toEqual([[1, "account", "not_available"]]);

      // That it is illegal is another ground: the same sender is heard on it, once.
      const { turnstileToken: _token, ...illegal } = notices.illegal([postTarget(first)]);
      await submit(illegal as NoticeRequest, from());
      expect(await refusal(submitNotice(w.deps, illegal as NoticeRequest, from()))).toBe("already_reported");
      // On the path for child sexual abuse material nothing is matched against the account: both notices are taken, each
      // an item with no sender, and the case moves to the urgent lane and freezes the post.
      expect(await postFrozen(w.apiDb, first)).toBe(false);
      const [one, two] = [await submit({ ground: "csam", targets: [postTarget(first)], keyword: "csam" }, from()), await submit({ ground: "csam", targets: [postTarget(first)], keyword: "csam" }, from())];
      for (const answer of [one, two]) expect(await w.items(answer.ref)).toMatchObject([{ target_id: first, suspect: true, reporter_account_id: null, case_lane: 0 }]);
      expect(await postFrozen(w.apiDb, first)).toBe(true);
      // Someone else's report of the same post on the same rule is an item of its own.
      const third = await w.account();
      expect(await refusal(submitNotice(w.deps, rule([postTarget(first)]), w.sender(third.session)).then(w.remember))).toBeNull();
    });

    test("a notice on the path for child sexual abuse material that names two accounts is refused, also when the two handles are one account's old and present one; nothing is written", async () => {
      const [ada, bob] = [await w.account(), await w.account()];
      const left = `old_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${ada.id}::uuid, now())`);
      const counts = await w.counts();
      for (const targets of [
        [linkTarget(`${app}/u/${ada.handle}`), linkTarget(`${app}/u/${bob.handle}`)],
        [accountTarget(ada.handle), linkTarget(`${app}/u/${bob.handle}`)],
        [linkTarget(`${app}/u/${ada.handle}`), linkTarget(`${app}/u/${left}`)],
        // Counted as named, before any is looked up: two handles nobody holds are two accounts too.
        [linkTarget(`${app}/u/nobody_one`), linkTarget(`${app}/u/nobody_two`)],
      ]) {
        await expect(submitNotice(w.deps, notices.csam(targets), w.sender())).rejects.toMatchObject({ code: "invalid_request", status: 400 });
      }
      expect(await w.counts()).toEqual(counts);
      // One account, also named twice, is taken; on another ground so are two.
      const once = await submit(notices.csam([accountTarget(ada.handle), linkTarget(`${app}/u/${ada.handle.toUpperCase()}`)]));
      expect((await w.items(once.ref)).map((item) => [item.position, item.target_id])).toEqual([[1, ada.id]]);
      const two = await submit(notices.rule([accountTarget(ada.handle), accountTarget(bob.handle)]));
      expect(await w.items(two.ref)).toHaveLength(2);
    });
  });

  describe("liveness: one rule for every ground", () => {
    test("liveTarget: a deleted post or account names nothing on a rule or on the law, and still names its row on the path for child sexual abuse material, an account also under a handle it has left", async () => {
      const [author, gone] = [await w.account(), await w.account()];
      const [live, deleted] = [await newPostRow(w.apiDb, author.id), await newPostRow(w.apiDb, author.id)];
      await w.migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted}::uuid`);
      await w.migrateDb.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
      const left = `old_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${author.id}::uuid, now())`);
      const post = (id: string) => ({ type: "post" as const, id, mediaId: null });
      const account = (handle: string) => ({ type: "account" as const, handle });
      for (const suspect of [false, true]) {
        expect(await liveTarget(w.deps, post(live), suspect)).toEqual({ type: "post", id: live });
        expect(await liveTarget(w.deps, account(author.handle), suspect)).toEqual({ type: "account", id: author.id });
        expect(await liveTarget(w.deps, post(randomUUID()), suspect)).toBeNull();
        expect(await liveTarget(w.deps, account("nobody_holds_it"), suspect)).toBeNull();
      }
      expect(await liveTarget(w.deps, post(deleted), false)).toBeNull();
      expect(await liveTarget(w.deps, account(gone.handle), false)).toBeNull();
      expect(await liveTarget(w.deps, account(left), false)).toBeNull();
      expect(await liveTarget(w.deps, post(deleted), true)).toEqual({ type: "post", id: deleted });
      expect(await liveTarget(w.deps, account(gone.handle), true)).toEqual({ type: "account", id: gone.id });
      expect(await liveTarget(w.deps, account(left), true)).toEqual({ type: "account", id: author.id });
    });

    test("a report on a rule or on the law about a post its author deleted, or about a deleted account, is answered not available: no case, no hold, no alert", async () => {
      const [author, gone] = [await w.account(), await w.account()];
      const { postId, mediaIds } = await imagePost(w.apiDb, 2, author.id);
      await w.migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
      await w.migrateDb.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
      for (const request of [notices.rule([postTarget(postId), accountTarget(gone.handle)], { ruleId: "R5" }), notices.illegal([postTarget(postId), accountTarget(gone.handle)], { category: "STATEMENT_CATEGORY_VIOLENCE" })]) {
        const answer = await submit(request);
        const items = await w.items(answer.ref);
        expect(items.map((item) => [item.position, item.case_id, item.outcome, item.lane])).toEqual([[1, null, "not_available", 0], [2, null, "not_available", 0]]);
        expect(items[0]!.target_id).toBe(postId);
        expect(items[1]!.target_id).not.toBe(gone.id);
      }
      expect(await holds(mediaIds)).toBe(0);
      expect((await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from cases where target_id = any(${uuids([postId, gone.id])})`))[0]!.n).toBe(0);
      await settle();
      // An item without a case enters no lane: nobody is alerted for a link that names nothing.
      expect(urgentMails()).toHaveLength(0);
    });

    test("a notice on the path for child sexual abuse material about a live image post: an urgent case, a snapshot, holds, the post frozen, and one alert to staff", async () => {
      const author = await w.account();
      const { postId, mediaIds } = await imagePost(w.apiDb, 2, author.id);
      const waitingBefore = await urgentCases();
      const answer = await submit(notices.csam([postTarget(postId, mediaIds[1])]));
      await settle();
      const [item] = await w.items(answer.ref);
      expect(item).toMatchObject({ position: 1, target_id: postId, media_id: mediaIds[1], lane: 0, suspect: true, outcome: null, case_lane: 0 });
      expect(await holds(mediaIds)).toBe(2);
      expect(await postFrozen(w.apiDb, postId)).toBe(true);
      expect((await w.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from evidence_snapshots where case_id = ${item!.case_id}::uuid`))[0]!.n).toBe(1);
      expect(urgentMails()).toHaveLength(1);
      expect(urgentMails()[0]!.data).toEqual({ count: String(waitingBefore + 1), oldest: expect.stringMatching(/^[0-9-]{10} [0-9:]{5} UTC$/) });
      // A second urgent report within the alert's window sends no second mail.
      await submit(notices.csam([postTarget(postId)]));
      await settle();
      expect(urgentMails()).toHaveLength(1);
    });

    test("when no staff address took the alert its throttle is given back, so the next urgent report alerts again", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      w.mailer.mode = "fail";
      await submit(notices.rule([postTarget(postId)], { ruleId: "R5" }));
      await settle();
      expect(urgentMails()).toHaveLength(0);
      expect(w.mailer.attempts.some((message) => message.template === "moderation_urgent" && message.to === staffAddress)).toBe(true);
      w.mailer.mode = "deliver";
      await submit(notices.rule([postTarget(postId)], { ruleId: "R5" }));
      await settle();
      expect(urgentMails()).toHaveLength(1);
    });

    test("on that path a post its author deleted, one the purge blanked, and a purged account named by its handle each get an urgent case that waits for an admin; a link to no row is answered at once", async () => {
      const [author, purged] = [await w.account(), await w.account()];
      const deleted = await newPostRow(w.apiDb, author.id);
      await w.migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted}::uuid`);
      const blanked = await newPostRow(w.apiDb, purged.id);
      await w.migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${blanked}::uuid`);
      await w.migrateDb.execute(sql`update profiles set deleted_at = now(), display_name = '', bio = '' where id = ${purged.id}::uuid`);
      const posts = await submit(notices.csam([postTarget(deleted), postTarget(blanked), missingPost()]));
      expect((await w.items(posts.ref)).map((item) => [item.position, item.case_id !== null, item.outcome, item.case_lane])).toEqual([[1, true, null, 0], [2, true, null, 0], [3, false, "not_available", null]]);
      const account = await submit(notices.csam([accountTarget(purged.handle)]));
      expect(await w.items(account.ref)).toMatchObject([{ position: 1, target_type: "account", target_id: purged.id, named_handle: purged.handle, suspect: true, outcome: null, case_lane: 0 }]);
    });

    test("on that path a post its author deleted, whose images a closed case's hold still keeps, gets an urgent case on the tombstone: the kept images are held for it, listed in its snapshot and frozen", async () => {
      // The decision that closes the first case commits, so a real staff key confirms it, as the console would.
      const decider = deciderWorld(w.apiDb);
      try {
        const [admin, author] = [await decider.staff("admin"), await w.account()];
        const { postId, mediaIds } = await imagePost(w.apiDb, 2, author.id);
        // A rule report's case holds the post's images as evidence. A decision closes the case; its holds stand.
        const first = await submit(notices.rule([postTarget(postId)]));
        const closedCase = (await w.items(first.ref))[0]!.case_id!;
        expect(typeof (await decider.decideAs(admin, closedCase, { kind: "final", outcome: "no_violation" }))).toBe("object");
        expect((await w.migrateDb.execute<{ closed: boolean }>(sql`select closed_at is not null as closed from cases where id = ${closedCase}::uuid`))[0]!.closed).toBe(true);
        expect(await holds(mediaIds)).toBe(2);
        // The author deletes the post: it is a tombstone, and the held image rows are kept.
        await deleteByAuthor(w.apiDb, author.id, postId);
        expect((await w.migrateDb.execute<{ state: string }>(sql`select state from posts where id = ${postId}::uuid`))[0]!.state).toBe("deleted_by_author");
        expect(await existing(mediaIds)).toEqual([...mediaIds].sort());
        // On a rule the deleted post names nothing, kept images or not: no case, and no further hold.
        const ruled = await submit(notices.rule([postTarget(postId)]));
        expect(await w.items(ruled.ref)).toMatchObject([{ position: 1, case_id: null, outcome: "not_available" }]);
        expect(await holds(mediaIds)).toBe(2);

        const answer = await submit(notices.csam([postTarget(postId)]));
        await settle();
        const [item] = await w.items(answer.ref);
        expect(item).toMatchObject({ position: 1, target_id: postId, suspect: true, outcome: null, case_lane: 0 });
        expect(item!.case_id).not.toBe(closedCase);
        // The new case holds what is left of the images beside the closed case's holds, and its snapshot lists them on the tombstone.
        expect(await holds(mediaIds)).toBe(4);
        const [snapshot] = await w.migrateDb.execute<{ post_state: string; body: string; images: number }>(sql`select post_state, body, jsonb_array_length(media) as images from evidence_snapshots where case_id = ${item!.case_id}::uuid`);
        expect({ ...snapshot! }).toEqual({ post_state: "deleted_by_author", body: "", images: 2 });
        expect(await postFrozen(w.apiDb, postId)).toBe(true);
        expect(urgentMails()).toHaveLength(1);
      } finally {
        await w.cleanUp();
        await decider.close();
      }
    });

    test("on that path a quoting post its author deleted before the notice, with no image of its own, still brings the post it quotes: two items, two urgent cases, the quoted post's images frozen, one alert that counts both", async () => {
      const [quotedAuthor, author] = [await w.account(), await w.account()];
      const quoted = await imagePost(w.apiDb, 1, quotedAuthor.id);
      const quoting = await newPostRow(w.apiDb, author.id, { quoteOfId: quoted.postId });
      await deleteByAuthor(w.apiDb, author.id, quoting);
      // The deletion leaves what the post quoted on its row.
      expect({ ...(await w.migrateDb.execute<{ state: string; quote_of_id: string }>(sql`select state, quote_of_id from posts where id = ${quoting}::uuid`))[0]! }).toEqual({ state: "deleted_by_author", quote_of_id: quoted.postId });
      const waitingBefore = await urgentCases();
      const answer = await submit(notices.csam([postTarget(quoting)]));
      await settle();
      const items = await w.items(answer.ref);
      expect(items.map((item) => [item.position, item.target_id, item.suspect, item.outcome, item.case_lane])).toEqual([[1, quoting, true, null, 0], [11, quoted.postId, true, null, 0]]);
      expect(new Set(items.map((item) => item.case_id)).size).toBe(2);
      // The tombstone's own case reaches no image; the quoted post's image is held by its case, and both posts are frozen.
      expect(await holds(quoted.mediaIds)).toBe(1);
      expect([await postFrozen(w.apiDb, quoted.postId), await postFrozen(w.apiDb, quoting)]).toEqual([true, true]);
      expect(urgentMails()).toHaveLength(1);
      expect(urgentMails()[0]!.data.count).toBe(String(waitingBefore + 2));
      // The page lists the named item alone until a release: the item korbat added would tell that the tombstone's id names a row.
      expect((await status(answer.ref, answer.token!)).items.map((item) => [item.position, item.quotedBy, item.outcome])).toEqual([[1, null, null]]);
      // On a rule the deleted quoting post names nothing, and brings nothing.
      const ruled = await submit(notices.rule([postTarget(quoting)]));
      expect(await w.items(ruled.ref)).toMatchObject([{ position: 1, case_id: null, outcome: "not_available" }]);
      expect(await holds(quoted.mediaIds)).toBe(1);
    });

    test("on that path a post that quotes another is a report about both: two items, two urgent cases, one alert that counts both; the status page lists the named items alone until a release", async () => {
      const [quotedAuthor, author] = [await w.account(), await w.account()];
      const quoted = (await imagePost(w.apiDb, 1, quotedAuthor.id)).postId;
      const [quotingOne, quotingTwo, plain] = [await newPostRow(w.apiDb, author.id, { quoteOfId: quoted }), await newPostRow(w.apiDb, author.id, { quoteOfId: quoted }), await newPostRow(w.apiDb, author.id)];
      const waitingBefore = await urgentCases();
      const answer = await submit(notices.csam([postTarget(quotingOne)]));
      await settle();
      const items = await w.items(answer.ref);
      expect(items.map((item) => [item.position, item.target_id, item.suspect, item.case_lane])).toEqual([[1, quotingOne, true, 0], [11, quoted, true, 0]]);
      expect(new Set(items.map((item) => item.case_id)).size).toBe(2);
      expect(await postFrozen(w.apiDb, quoted)).toBe(true);
      expect(urgentMails()).toHaveLength(1);
      expect(urgentMails()[0]!.data.count).toBe(String(waitingBefore + 2));
      // The item korbat added is stored, and not listed yet: before a release it would tell that the named post exists.
      const page = await status(answer.ref, answer.token!);
      expect(page.items.map((item) => [item.position, item.link, item.quotedBy, item.suspect, item.scope, item.outcome])).toEqual([[1, `${app}/post/${quotingOne}`, null, true, null, null]]);

      // A notice that names both posts adds nothing; two named posts that quote the same post add one item, after the lower.
      const both = await submit(notices.csam([postTarget(quoted), postTarget(quotingOne)]));
      expect((await w.items(both.ref)).map((item) => item.position)).toEqual([1, 2]);
      const twice = await submit(notices.csam([postTarget(plain), postTarget(quotingTwo), postTarget(quotingOne)]));
      expect((await w.items(twice.ref)).map((item) => [item.position, item.target_id])).toEqual([[1, plain], [2, quotingTwo], [3, quotingOne], [12, quoted]]);
      expect((await status(twice.ref, twice.token!)).items.map((item) => [item.position, item.quotedBy])).toEqual([[1, null], [2, null], [3, null]]);
      // On a rule the quoting post is one item, and its answer concerns its own text and images. The page says so only with
      // the released outcome: before it a live post that quotes another, a live post that quotes nothing and a link to no
      // row read the same, so the page never tells which of them names a row.
      const ruled = await submit(notices.rule([postTarget(quotingOne), postTarget(plain), missingPost()]));
      expect((await status(ruled.ref, ruled.token!)).items.map((item) => [item.position, item.scope, item.outcome])).toEqual([[1, null, null], [2, null, null], [3, null, null]]);
    });

    test("an account named by a handle it has left: on that path an urgent case on the account, its posts frozen, and the alert; on a rule the same handle names nothing", async () => {
      const author = await w.account();
      const { postId } = await imagePost(w.apiDb, 1, author.id);
      const left = `old_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${author.id}::uuid, now())`);
      const ruled = await submit(notices.rule([accountTarget(left)]));
      expect(await w.items(ruled.ref)).toMatchObject([{ target_type: "account", named_handle: left, case_id: null, outcome: "not_available" }]);
      expect((await w.items(ruled.ref))[0]!.target_id).not.toBe(author.id);
      expect(await postFrozen(w.apiDb, postId)).toBe(false);

      const answer = await submit(notices.csam([linkTarget(`${app}/u/${left.toUpperCase()}`)]));
      await settle();
      expect(await w.items(answer.ref)).toMatchObject([{ position: 1, target_type: "account", target_id: author.id, named_handle: left, suspect: true, outcome: null, case_lane: 0 }]);
      expect(await postFrozen(w.apiDb, postId)).toBe(true);
      expect(urgentMails()).toHaveLength(1);
      // The page shows the handle as it was named, never the one the profile holds now, and what the answer will concern.
      const page = await status(answer.ref, answer.token!);
      expect(page.items).toMatchObject([{ position: 1, link: `${app}/u/${left}`, scope: "account_suspect", suspect: true, outcome: null }]);
      expect(JSON.stringify(page)).not.toContain(author.handle);
    });
  });

  describe("the status page and the contact's two buttons", () => {
    test("the notice's own token and the mail's token both open the page; only the mail's tells whether the address is confirmed or stopped; anything else is not found", async () => {
      const author = await w.account();
      const postId = await newPostRow(w.apiDb, author.id);
      const email = w.address();
      const nobody = `nobody_${randomBytes(4).toString("hex")}`;
      const answer = await submit(notices.illegal([postTarget(postId), accountTarget(author.handle), missingPost(), accountTarget(nobody)], { email }));
      await settle();
      const page = await status(answer.ref, answer.token!);
      expect(NoticeStatus.parse(page)).toEqual(page);
      expect(page).toMatchObject({ ref: answer.ref, receivedAt: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/), contact: { given: true, confirmed: null, stopped: null } });
      const waiting = { suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
      expect(page.items).toEqual([
        { position: 1, link: `${app}/post/${postId}`, scope: null, ...waiting },
        { position: 2, link: `${app}/u/${author.handle}`, scope: "account", ...waiting },
        // A link to no row and a handle nobody holds read like the live targets beside them until the daily release: the
        // page never says which targets were live.
        { position: 3, link: expect.stringMatching(/[/]post[/][0-9a-f-]{36}$/), scope: null, ...waiting },
        { position: 4, link: `${app}/u/${nobody}`, scope: "account", ...waiting },
      ]);
      const byMail = await status(answer.ref, mailToken(email));
      expect(byMail).toEqual({ ...page, contact: { given: true, confirmed: false, stopped: false } });
      // On the path for child sexual abuse material too: a notice that names a handle nobody holds reads, link apart,
      // exactly as one that names a live account, so the page never says whether a handle names an account.
      const [onLive, onNobody] = [await submit(notices.csam([accountTarget(author.handle)])), await submit(notices.csam([accountTarget(nobody)]))];
      const withoutLink = async (notice: { ref: string; token?: string }) => (await status(notice.ref, notice.token!)).items.map(({ link: _link, ...rest }) => rest);
      expect(await withoutLink(onNobody)).toEqual(await withoutLink(onLive));
      expect(await withoutLink(onLive)).toMatchObject([{ position: 1, scope: "account_suspect", suspect: true, outcome: null }]);

      // A report sent signed in has no token: the page has no way in, whatever is typed.
      const reporter = await w.account();
      const signedIn = await submit({ ground: "rule", ruleId: "R1", targets: [postTarget(postId)] }, w.sender(reporter.session));
      const other = await submit(notices.rule([postTarget(postId)]));
      for (const [ref, token] of [[answer.ref, "A".repeat(43)], [answer.ref, other.token!], [other.ref, answer.token!], [other.ref, mailToken(email)], ["N-AAAAAAAAAA", answer.token!], [signedIn.ref, answer.token!]] as const) {
        await expect(status(ref, token)).rejects.toMatchObject({ code: "notice_not_found", status: 404 });
      }
      // A notice that left no name or address has no contact.
      expect((await status(other.ref, other.token!)).contact).toBeNull();
    });

    test("confirm and stop take the mail's token alone: the notice's own token, a notice without a contact and a wrong token are not found; a confirmation lifts a stop", async () => {
      const email = w.address();
      const answer = await submit(notices.illegal([missingPost()], { email }));
      const bare = await submit(notices.illegal([missingPost()]));
      await settle();
      const token = mailToken(email);
      const press = (ref: string, by: string, choice: "confirm" | "stop") => noticeContact(w.deps, { ref, token: by, choice }, w.sender().netHash);
      for (const choice of ["confirm", "stop"] as const) {
        for (const [ref, by] of [[answer.ref, answer.token!], [answer.ref, "A".repeat(43)], [bare.ref, bare.token!], [bare.ref, token], ["N-AAAAAAAAAA", token]] as const) {
          await expect(press(ref, by, choice)).rejects.toMatchObject({ code: "notice_not_found", status: 404 });
        }
      }
      expect((await status(answer.ref, token)).contact).toEqual({ given: true, confirmed: false, stopped: false });
      await press(answer.ref, token, "stop");
      expect((await status(answer.ref, token)).contact).toEqual({ given: true, confirmed: false, stopped: true });
      await press(answer.ref, token, "confirm");
      expect((await status(answer.ref, token)).contact).toEqual({ given: true, confirmed: true, stopped: false });
      // A confirmed address has no cap: a second notice's receipt is sent, not folded.
      const second = await submit(notices.illegal([missingPost()], { email }));
      await settle();
      expect((await w.notice(second.ref))!.receipt).toBe("sent");
      // To whoever holds only the token on screen, the page says nothing of what korbat knows about the address.
      expect((await status(second.ref, second.token!)).contact).toEqual({ given: true, confirmed: null, stopped: null });
    });

    test("a notice that names a confirmed or a stopped address is answered exactly as one that names an address korbat never saw", async () => {
      const [confirmed, stopped, fresh] = [w.address(), w.address(), w.address()];
      for (const [email, choice] of [[confirmed, "confirm"], [stopped, "stop"]] as const) {
        const first = await submit(notices.illegal([missingPost()], { email }));
        await settle();
        await noticeContact(w.deps, { ref: first.ref, token: mailToken(email), choice }, w.sender().netHash);
      }
      const shape = (value: unknown) => JSON.stringify(value).replace(/N-[A-Z2-7]{10}/g, "N-ref").replace(/"[A-Za-z0-9_-]{43}"/g, '"token"').replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z/g, "time").replace(/post[/][0-9a-f-]{36}/g, "post/id");
      const answers: string[] = [];
      const pages: string[] = [];
      for (const email of [confirmed, stopped, fresh]) {
        const answer = await submit(notices.illegal([missingPost()], { email }));
        answers.push(shape(answer));
        pages.push(shape(await status(answer.ref, answer.token!)));
      }
      expect(new Set(answers).size).toBe(1);
      expect(new Set(pages).size).toBe(1);
    });

    test("the two routes share one count: 30 an hour for each network, and a refused read is counted too", async () => {
      expect(STATUS_READS_PER_HOUR).toBe(30);
      const answer = await submit(notices.rule([missingPost()]));
      const net = w.sender().netHash;
      for (let n = 0; n < 20; n++) await noticeStatus(w.deps, { ref: answer.ref, token: answer.token! }, net);
      for (let n = 0; n < 10; n++) expect(await refusal(noticeContact(w.deps, { ref: answer.ref, token: answer.token!, choice: "stop" }, net))).toBe("notice_not_found");
      await expect(noticeStatus(w.deps, { ref: answer.ref, token: answer.token! }, net)).rejects.toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: expect.any(Number) });
      expect(await refusal(noticeContact(w.deps, { ref: answer.ref, token: answer.token!, choice: "confirm" }, net))).toBe("rate_limited");
      // Another network reads on.
      expect((await status(answer.ref, answer.token!)).ref).toBe(answer.ref);
    });

    test("an item korbat added for a quoted post is listed only once a release has shown its origin's outcome or its own: before it, notices about a quoting post, a plain post and a link to no row read the same", async () => {
      // The decisions commit, so a real staff key confirms them, as the console would.
      const decider = deciderWorld(w.apiDb);
      try {
        const [admin, quotedAuthor, author] = [await decider.staff("admin"), await w.account(), await w.account()];
        const [quotedOne, quotedTwo, quotedThree] = [(await imagePost(w.apiDb, 1, quotedAuthor.id)).postId, (await imagePost(w.apiDb, 1, quotedAuthor.id)).postId, (await imagePost(w.apiDb, 1, quotedAuthor.id)).postId];
        const quoting = (quoteOfId: string) => newPostRow(w.apiDb, author.id, { quoteOfId });
        const [quotingOne, quotingTwo, quotingThree, plain] = [await quoting(quotedOne), await quoting(quotedTwo), await quoting(quotedThree), await newPostRow(w.apiDb, author.id)];
        const onQuoting = await submit(notices.csam([postTarget(quotingOne)]));
        const onOther = await submit(notices.csam([postTarget(quotingTwo)]));
        // Two named posts, the second of which quotes: its added item stands at position 12.
        const onTwo = await submit(notices.csam([postTarget(plain), postTarget(quotingThree)]));
        const onPlain = await submit(notices.csam([postTarget(plain)]));
        const onNothing = await submit(notices.csam([missingPost()]));
        // Each quoting post brought an item for the post it quotes; the page does not list it yet.
        for (const notice of [onQuoting, onOther]) expect((await w.items(notice.ref)).map((item) => item.position)).toEqual([1, 11]);
        expect((await w.items(onTwo.ref)).map((item) => item.position)).toEqual([1, 2, 12]);
        const withoutLink = async (notice: { ref: string; token?: string }) => (await status(notice.ref, notice.token!)).items.map(({ link: _link, ...rest }) => rest);
        const waiting = { scope: null, suspect: true, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
        for (const notice of [onQuoting, onOther, onPlain, onNothing]) expect(await withoutLink(notice)).toEqual([{ position: 1, ...waiting }]);
        expect(await withoutLink(onTwo)).toEqual([{ position: 1, ...waiting }, { position: 2, ...waiting }]);

        // An admin answers the first quoting post's own case, and the post that the second one quotes.
        const caseAt = async (ref: string, position: number) => (await w.items(ref)).find((item) => item.position === position)!.case_id!;
        for (const caseId of [await caseAt(onQuoting.ref, 1), await caseAt(onOther.ref, 11)]) {
          expect(typeof (await decider.decideAs(admin, caseId, { kind: "final", outcome: "no_violation" }))).toBe("object");
        }
        // Decided and not yet released: still the named item alone.
        for (const notice of [onQuoting, onOther]) expect(await withoutLink(notice)).toEqual([{ position: 1, ...waiting }]);
        await w.apiDb.execute(sql`select public.release_outcomes(now())`);

        // The origin's outcome is released: the added item is listed directly after it, waiting, and marked as added for item 1.
        expect((await status(onQuoting.ref, onQuoting.token!)).items.map((item) => [item.position, item.link, item.quotedBy, item.outcome])).toEqual([
          [1, `${app}/post/${quotingOne}`, null, "no_violation"],
          [11, `${app}/post/${quotedOne}`, 1, null],
        ]);
        // The added item's own outcome is released while its origin still waits: it is listed with it, since from the
        // release an outcome shows on the page and the window to ask for a re-examination runs. The origin's waiting past
        // this release already told that it names a row: a link to no row was answered by the same release.
        const other = (await status(onOther.ref, onOther.token!)).items;
        expect(other.map((item) => [item.position, item.link, item.quotedBy, item.outcome])).toEqual([
          [1, `${app}/post/${quotingTwo}`, null, null],
          [11, `${app}/post/${quotedTwo}`, 1, "no_violation"],
        ]);
        expect(other[1]!.reexamination).toMatchObject({ open: true });
        // Nothing of the third pair is released: its added item stays unlisted beside the two named posts.
        expect((await withoutLink(onTwo)).map((item) => [item.position, item.outcome])).toEqual([[1, null], [2, null]]);
        // The notices that brought no item read one item as before: the plain post waits, the link to no row is answered.
        expect((await withoutLink(onPlain)).map((item) => item.outcome)).toEqual([null]);
        expect((await withoutLink(onNothing)).map((item) => item.outcome)).toEqual(["not_available"]);

        // Once the third pair's quoting post is answered and released, its added item is listed directly after it.
        expect(typeof (await decider.decideAs(admin, await caseAt(onTwo.ref, 2), { kind: "final", outcome: "no_violation" }))).toBe("object");
        await w.apiDb.execute(sql`select public.release_outcomes(now())`);
        expect((await status(onTwo.ref, onTwo.token!)).items.map((item) => [item.position, item.quotedBy, item.outcome])).toEqual([[1, null, null], [2, null, "no_violation"], [12, 2, null]]);
      } finally {
        await w.cleanUp();
        await decider.close();
      }
    });

    test("after the daily release an item answered at intake shows its outcome and its day, and cannot be examined again; the outcomes the page can show are the database's", async () => {
      const outcomes = await w.apiDb.execute<{ value: string }>(sql`select unnest(enum_range(null::item_outcome))::text as value`);
      expect(outcomes.map((row) => row.value)).toEqual([...ITEM_OUTCOMES]);
      const answer = await submit(notices.rule([missingPost(), accountTarget(`nobody_${randomBytes(4).toString("hex")}`)]));
      expect((await status(answer.ref, answer.token!)).items.map((item) => [item.outcome, item.scope])).toEqual([[null, null], [null, "account"]]);
      // The release takes every item answered before its cut-off; the cut-off is the statement's own time.
      await w.apiDb.execute(sql`select public.release_outcomes(now())`);
      const today = new Date().toISOString().slice(0, 10);
      const page = await status(answer.ref, answer.token!);
      for (const item of page.items) expect(item).toMatchObject({ outcome: "not_available", decidedOn: today, sealed: false, unseen: false, changed: false, reexamination: null });
      // The scope is what the notice named, as it was before the release: it never depended on what the handle named. After
      // this outcome the page and the app add no scope sentence.
      expect(page.items.map((item) => item.scope)).toEqual([null, "account"]);
    });

    test("a decided item says nothing before the release; after it, its outcome and day, whether it can be examined again and until when, and the marks of a seal and of an answer given with the images out of sight", async () => {
      // Decisions that commit are confirmed by a real staff key, as the console confirms them.
      const decider = deciderWorld(w.apiDb);
      try {
        const [admin, author, sealedAuthor] = [await decider.staff("admin"), await w.account(), await w.account()];
        const plain = await newPostRow(w.apiDb, author.id);
        const frozen = (await imagePost(w.apiDb, 1, author.id)).postId;
        await imagePost(w.apiDb, 2, sealedAuthor.id);
        // A rule notice about a post and its author's account; a notice of illegality and one of child sexual abuse
        // material about another post, which land in one case; and one of the latter kind about an account.
        const quoting = await newPostRow(w.apiDb, author.id, { quoteOfId: plain });
        const ruled = await submit(notices.rule([postTarget(plain), accountTarget(author.handle)]));
        const quote = await submit(notices.rule([postTarget(quoting), missingPost()]));
        const onLaw = await submit(notices.illegal([postTarget(frozen)]));
        const suspect = await submit(notices.csam([postTarget(frozen)]));
        // A rule report about the account stands in the case the notice of child sexual abuse material about it joins.
        const beside = await submit(notices.rule([accountTarget(sealedAuthor.handle)]));
        const sealing = await submit(notices.csam([accountTarget(sealedAuthor.handle)]));
        const caseOf = async (ref: string) => (await w.items(ref))[0]!.case_id!;
        const decide = async (caseId: string, input: DecisionInput) => {
          const outcome = await decider.decideAs(admin, caseId, input);
          expect(typeof outcome, String(outcome)).toBe("object");
        };
        // No breach in the first post (its author's account stays undecided) nor in the post that quotes it; no action on
        // the third, decided while its images were out of staff's sight, which answers both of its notices; and the
        // account's images sealed for good, which answers both of its reports.
        await decide(await caseOf(ruled.ref), { kind: "final", outcome: "no_violation" });
        await decide(await caseOf(quote.ref), { kind: "final", outcome: "no_violation" });
        expect(await caseOf(onLaw.ref)).toBe(await caseOf(suspect.ref));
        await decide(await caseOf(onLaw.ref), { kind: "final", outcome: "no_violation" });
        expect(await caseOf(beside.ref)).toBe(await caseOf(sealing.ref));
        await decide(await caseOf(sealing.ref), { kind: "final", ruleId: "R2", actions: [act("seal_media")] });

        const silent = { outcome: null, decidedOn: null, sealed: false, unseen: false, changed: false, reexamination: null };
        for (const answer of [ruled, quote, onLaw, suspect, beside, sealing]) {
          for (const item of (await status(answer.ref, answer.token!)).items) expect(item).toMatchObject(silent);
        }
        // Before the release a decided post that quotes another reads as the link to no row beside it, and the rule report
        // about the account as any item about an account: no scope tells what was decided, or what exists.
        expect((await status(quote.ref, quote.token!)).items.map((item) => item.scope)).toEqual([null, null]);
        expect((await status(beside.ref, beside.token!)).items.map((item) => item.scope)).toEqual(["account"]);
        await w.apiDb.execute(sql`select public.release_outcomes(now())`);
        const today = new Date().toISOString().slice(0, 10);

        // With its released outcome the quoting post's item says that its answer concerns its own text and images; the
        // link that named nothing has no scope.
        expect((await status(quote.ref, quote.token!)).items.map((item) => [item.outcome, item.scope])).toEqual([["no_violation", "quote"], ["not_available", null]]);

        const [post, account] = (await status(ruled.ref, ruled.token!)).items;
        expect(post).toMatchObject({ position: 1, outcome: "no_violation", decidedOn: today, scope: null, sealed: false, unseen: false, changed: false, reexamines: false });
        // The window runs six calendar months from the release.
        expect(post!.reexamination).toEqual({ open: true, until: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z$/) });
        const sixMonths = new Date();
        sixMonths.setUTCMonth(sixMonths.getUTCMonth() + 6);
        expect(Math.abs(new Date(post!.reexamination!.until).getTime() - sixMonths.getTime())).toBeLessThan(4 * 24 * HOUR);
        // The item about the account is still waiting, and says so by saying nothing.
        expect(account).toMatchObject({ position: 2, scope: "account", ...silent });

        // The notice of illegality was answered while nobody could open the post's images: it reads "no action for now",
        // and can be examined again. The suspect item itself is not marked that way.
        expect((await status(onLaw.ref, onLaw.token!)).items).toMatchObject([{ outcome: "no_violation", decidedOn: today, suspect: false, unseen: true, sealed: false, scope: null, reexamination: { open: true } }]);
        expect((await status(suspect.ref, suspect.token!)).items).toMatchObject([{ outcome: "no_violation", decidedOn: today, suspect: true, unseen: false, sealed: false, scope: null, reexamination: { open: true } }]);
        // A seal: the answer concerns the images on the account's posts, and a restriction is not examined again.
        expect((await status(sealing.ref, sealing.token!)).items).toMatchObject([{ outcome: "restricted_rule", decidedOn: today, suspect: true, sealed: true, unseen: false, scope: "account_suspect", reexamination: null }]);
        // The rule report the same decision answered is not suspect, and its answer concerns those images all the same.
        expect((await status(beside.ref, beside.token!)).items).toMatchObject([{ outcome: "restricted_rule", suspect: false, sealed: true, scope: "account_suspect", reexamination: null }]);
      } finally {
        await w.cleanUp();
        await decider.close();
      }
    });
  });

  describe("the handle as it was named", () => {
    test("after the account takes another handle, the status page and a receipt sent later still show the one the notice named, never the new one", async () => {
      const author = await w.account();
      const email = w.address();
      const named = author.handle;
      // The first try of the receipt fails, so it is sent after the rename.
      w.mailer.mode = "fail";
      const answer = await submit(notices.illegal([accountTarget(named.toUpperCase())], { email }));
      await settle();
      const renamed = `new_${randomBytes(4).toString("hex")}`;
      await w.migrateDb.execute(sql`update profiles set handle = ${renamed} where id = ${author.id}::uuid`);
      await w.migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${named}, ${author.id}::uuid, now())`);
      w.mailer.mode = "deliver";
      expect(await sendReceipt(w.deps, (await w.notice(answer.ref))!.id)).toBe("sent");
      expect(w.mailer.to(email, "notice_received")[0]!.data.items).toBe(`${app}/u/${named}`);
      const page = await status(answer.ref, answer.token!);
      expect(page.items).toMatchObject([{ position: 1, link: `${app}/u/${named}`, scope: "account" }]);
      expect(JSON.stringify(page)).not.toContain(renamed);
      expect(JSON.stringify(w.mailer.sent)).not.toContain(renamed);
    });
  });

  describe("a notice on the path for child sexual abuse material racing the deletion of what it names (gate K)", () => {
    /** The moderation module over an open transaction: its intake is then a savepoint, and its locks are held until the test lets the transaction end. */
    const depsOver = (tx: DbTx): ModerationDeps => ({ ...w.deps, apiDb: tx as unknown as Db, social: socialForModeration(tx as unknown as Db), media: casesMedia(tx), background: createBackground(pino({ level: "silent" })) });

    const deleters = [
      ["the author's deletion of the post", (db: Db | DbTx, authorId: string, postId: string) => deleteByAuthor(db, authorId, postId)],
      ["the account's purge", (db: Db | DbTx, authorId: string) => purgeAccount(db, authorId)],
    ] as const;
    const targets = [
      ["the post", (made: { postId: string }) => postTarget(made.postId)],
      ["the account", (made: { handle: string }) => accountTarget(made.handle)],
    ] as const;

    for (const [deleterName, remove] of deleters) {
      for (const [targetName, target] of targets) {
        test(`${deleterName}, a notice about ${targetName}: when the notice locks first every image row it reaches is kept; no error, no deadlock`, async () => {
          const author = await w.account();
          const { postId, mediaIds } = await imagePost(w.apiDb, 3, author.id);
          const [locked, wait] = [gate(), gate()];
          let noticing: Promise<void> = Promise.resolve();
          let removing: Promise<void> = Promise.resolve();
          try {
            noticing = withLockTimeout(w.apiDb, async (tx) => {
              const deps = depsOver(tx);
              w.remember(await submitNotice(deps, notices.csam([target({ postId, handle: author.handle })]), w.sender()));
              await deps.background.settle();
              locked.open();
              await wait.opened;
            });
            await Promise.race([locked.opened, noticing]);
            removing = remove(w.apiDb, author.id, postId);
            // The removal waits for a lock the notice's open transaction holds.
            await untilBlocked(w.apiDb, "");
            wait.open();
            await noticing;
            await removing;
            // The keep trigger read the freeze after the wait and saw the committed item.
            expect(await existing(mediaIds)).toEqual([...mediaIds].sort());
            expect(await postFrozen(w.apiDb, postId)).toBe(true);
            const [post] = await w.migrateDb.execute<{ state: string }>(sql`select state from posts where id = ${postId}::uuid`);
            expect(post!.state).toBe("deleted_by_author");
          } finally {
            wait.open();
            await Promise.allSettled([noticing, removing]);
          }
        });

        test(`${deleterName}, a notice about ${targetName}: when the deletion locks first the notice waits, is stored without an error, and no image row is kept`, async () => {
          const author = await w.account();
          const { postId, mediaIds } = await imagePost(w.apiDb, 3, author.id);
          const [removed, wait] = [gate(), gate()];
          let removing: Promise<void> = Promise.resolve();
          let noticing: Promise<{ ref: string; token?: string } | null> = Promise.resolve(null);
          try {
            removing = withLockTimeout(w.apiDb, async (tx) => {
              await remove(tx, author.id, postId);
              removed.open();
              await wait.opened;
            });
            await Promise.race([removed.opened, removing]);
            noticing = submitNotice(w.deps, notices.csam([target({ postId, handle: author.handle })]), w.sender()).then(w.remember);
            await untilBlocked(w.apiDb, "");
            wait.open();
            await removing;
            const answer = (await noticing)!;
            // The report came too late for these images, as it would have a moment later; it still waits for an admin.
            expect(await existing(mediaIds)).toEqual([]);
            expect(await w.items(answer.ref)).toMatchObject([{ position: 1, suspect: true, outcome: null, case_lane: 0 }]);
            expect(await postFrozen(w.apiDb, postId)).toBe(true);
          } finally {
            wait.open();
            await Promise.allSettled([removing, noticing]);
          }
        });
      }
    }
  });

  test("this file left no row behind: the moderation tables, the posts and profiles and the notifier tables hold what they held before it", async () => {
    await w.cleanUp();
    expect(await w.counts()).toEqual(before);
  });
});
```

### Create `apps/api/test/integration/notices-harness.ts`

```ts
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import type { NoticeRequest } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type AuthForModeration } from "../../src/auth";
import { emailHash } from "../../src/auth/identifiers";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MailRefused, MailUnavailable, type MailMessage, type Mailer } from "../../src/mail/mailer";
import { renderTemplate } from "../../src/mail/templates";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import type { NoticeSender } from "../../src/moderation/intake";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { newTestEmail } from "./flow-harness";
import { casesMedia, gate, removeFixtures, rowCounts, uuids } from "./moderation-fixtures";

/**
 * What the tests of reports and notices share (3c design, sections 7.1 and 7.2): the real auth and moderation modules
 * over the test database, as the server wires them, with a mailer the test scripts, a human check that passes one
 * token, and clocks for the limits and the auth module's key-value store that the test moves. Every test commits (the
 * auth side is another pool), so the world remembers what was made and `cleanUp` removes it.
 */

/** The only token the human check passes. */
export const HUMAN = "human";

/** Records what was sent, and ends a send the way the test says: delivered, refused for good, failed, or not at all until released. */
export class ScriptedMailer implements Mailer {
  /** Every message handed over, delivered or not, in order. */
  readonly attempts: MailMessage[] = [];
  readonly sent: MailMessage[] = [];
  mode: "deliver" | "refuse" | "fail" | "hang" = "deliver";
  private waiting = gate();

  async send(message: MailMessage): Promise<void> {
    // As the real mailer does first: a message whose data its template lacks is a programming error.
    renderTemplate(message.template, message.data);
    this.attempts.push(message);
    if (this.mode === "hang") await this.waiting.opened;
    if (this.mode === "refuse") throw new MailRefused("the relay refused the recipient");
    if (this.mode === "fail") throw new MailUnavailable("the relay could not be reached");
    this.sent.push(message);
  }

  /** Lets every hanging send end, as `mode` now says. */
  release(mode: "deliver" | "refuse" | "fail" = "deliver"): void {
    this.mode = mode;
    this.waiting.open();
    this.waiting = gate();
  }

  to(address: string, template?: string): MailMessage[] {
    return this.sent.filter((message) => message.to === address && (template === undefined || message.template === template));
  }

  /** The code of the newest mail to this address that carries one: a sign-up or sign-in code. */
  lastCodeFor(address: string): string | undefined {
    return this.to(address).findLast((message) => message.data.code)?.data.code;
  }
}

export function noticesWorld() {
  const config = loadConfig();
  const logger = pino({ level: "silent" });
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 8 });
  // The migrate role is not part of the API configuration; the test environment carries it, for the fixtures' cleanup.
  const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  const repo = createAuthRepo(authDb);
  const mailer = new ScriptedMailer();
  /** How far the limit store's clock, and the auth module's key-value store's, stand ahead of the real one. */
  const ahead = { limitsMs: 0, kvMs: 0 };
  const rateLimitStore = new MemoryStore(() => Date.now() + ahead.limitsMs);
  const auth = createAuth({
    config,
    logger,
    authDb,
    kv: new MemoryKv(() => Date.now() + ahead.kvMs),
    mailer,
    profiles: createProfileStore(apiDb),
    turnstile: { verify: async (token) => token === HUMAN },
    breachChecker: { isBreached: async () => false },
  });
  // A copy the tests may script: a member replaced here is what the moderation module calls.
  const authForModeration: AuthForModeration = { ...auth.forModeration };
  const moderation = createModeration({ apiDb, auth: authForModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore, config, logger });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, moderation });

  const profileIds: string[] = [];
  const refs: string[] = [];
  const addresses: string[] = [];

  /** An onboarded account: an auth user with an address of its own and its profile, as sign-up leaves them. */
  async function account(options: { createdAt?: Date } = {}) {
    const email = newTestEmail("reporter");
    addresses.push(email);
    const user = await repo.createUser({ email, termsVersion: config.TERMS_VERSION, now: new Date() });
    await repo.markOnboarded(user.id, new Date());
    const handle = `n_${randomBytes(5).toString("hex")}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: `Profile ${handle}`, createdAt: options.createdAt ?? new Date() });
    profileIds.push(user.id);
    return { id: user.id, handle, email, session: { userId: user.id, role: "user" as const, onboarded: true } };
  }

  /** A fresh address a signed-out notifier gives. */
  const address = () => {
    const email = newTestEmail("notifier");
    addresses.push(email);
    return email;
  };

  /** A sender from a network of its own: signed out, or the session given. */
  const sender = (session: NoticeSender["session"] = null): NoticeSender => ({ session, netHash: `net-${randomBytes(8).toString("hex")}` });

  /** The stored notice with this reference, as the migrator reads it. */
  async function notice(ref: string) {
    const [row] = await migrateDb.execute<{ id: string; kind: string; channel: string; reporter_id: string | null; contact_id: string | null; rule_id: string | null; alleges_illegal: boolean; csam: boolean; category: string; category_keyword: string | null; cited_law: string | null; explanation: string | null; bona_fide: boolean; lookup_hash: string | null; receipt: string; receipt_sent: boolean }>(
      sql`select id, kind, channel, reporter_id, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide, lookup_hash, receipt, receipt_sent_at is not null as receipt_sent from intakes where ref = ${ref}`,
    );
    return row ? { ...row } : undefined;
  }

  /** The notice's items in position order, each with its case's lane when it has a case. */
  async function items(ref: string) {
    const rows = await migrateDb.execute<{ position: number; target_type: string; target_id: string; named_handle: string | null; media_id: string | null; case_id: string | null; lane: number; suspect: boolean; outcome: string | null; reporter_account_id: string | null; case_lane: number | null }>(
      sql`select i.position, i.target_type, i.target_id, i.named_handle, i.media_id, i.case_id, i.lane, i.suspect, i.outcome, i.reporter_account_id, c.lane as case_lane
            from intake_items i join intakes n on n.id = i.intake_id left join cases c on c.id = i.case_id where n.ref = ${ref} order by i.position, i.created_at`,
    );
    return rows.map((row) => ({ ...row }));
  }

  /** Remembers a notice the test stored, so that the cleanup removes it, and hands the answer back. */
  function remember<T extends { ref: string }>(answer: T): T {
    refs.push(answer.ref);
    return answer;
  }

  /** How many rows the moderation tables, the posts and profiles, and the auth side's notifier tables hold. */
  async function counts(): Promise<Record<string, number>> {
    const [authSide] = (await authDb.execute(
      sql`select (select count(*)::int from auth.notifier_contacts) as notifier_contacts, (select count(*)::int from auth.notifier_confirmations) as notifier_confirmations, (select count(*)::int from auth.notifier_suppressions) as notifier_suppressions`,
    )) as unknown as Record<string, number>[];
    return { ...(await rowCounts(apiDb)), ...authSide! };
  }

  /**
   * Removes what the tests stored: the profiles with their posts, images and cases; the notices that named nothing of
   * theirs (a link to no row, a handle nobody holds), by their references; and, on the auth side, the notices' contacts
   * and whatever the tests' addresses confirmed or stopped. The tasks the requests started are waited for first.
   */
  async function cleanUp(): Promise<void> {
    await moderation.settle();
    const contacts = refs.length === 0 ? [] : await migrateDb.execute<{ contact_id: string }>(sql`select contact_id from intakes where ref = any(${`{${refs.join(",")}}`}::text[]) and contact_id is not null`);
    await removeFixtures(migrateDb, profileIds.splice(0));
    if (refs.length > 0) {
      await migrateDb.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        // What is left of these notices names nothing live: their items have no case.
        await tx.execute(sql`delete from intake_items where intake_id in (select id from intakes where ref = any(${`{${refs.join(",")}}`}::text[]))`);
        await tx.execute(sql`delete from intakes where ref = any(${`{${refs.join(",")}}`}::text[])`);
      });
      refs.length = 0;
    }
    if (contacts.length > 0) await authDb.execute(sql`delete from auth.notifier_contacts where id = any(${uuids(contacts.map((row) => row.contact_id))})`);
    if (addresses.length > 0) {
      const hashes = `{${addresses.splice(0).map((email) => emailHash(auth.deps.config.authHmacKey, email)).join(",")}}`;
      await authDb.execute(sql`delete from auth.notifier_confirmations where email_hash = any(${hashes}::text[])`);
      await authDb.execute(sql`delete from auth.notifier_suppressions where email_hash = any(${hashes}::text[])`);
    }
  }

  return {
    config,
    apiDb,
    authDb,
    migrateDb,
    repo,
    mailer,
    ahead,
    auth,
    authForModeration,
    moderation,
    deps: moderation.deps,
    app,
    profileIds,
    account,
    address,
    sender,
    notice,
    items,
    remember,
    counts,
    cleanUp,
    close: () => Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]),
  };
}

export type NoticesWorld = ReturnType<typeof noticesWorld>;

/** The three grounds as a signed-out sender words them, each about the targets given. */
export const notices = {
  rule: (targets: NoticeRequest["targets"], extra: Record<string, unknown> = {}) => ({ ground: "rule", ruleId: "R1", targets, turnstileToken: HUMAN, ...extra }) as NoticeRequest,
  illegal: (targets: NoticeRequest["targets"], extra: Record<string, unknown> = {}) =>
    ({ ground: "illegal", targets, category: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH", explanation: "It is a threat under section 241.", bonaFide: true, turnstileToken: HUMAN, ...extra }) as NoticeRequest,
  csam: (targets: NoticeRequest["targets"], extra: Record<string, unknown> = {}) => ({ ground: "csam", targets, keyword: "csam", turnstileToken: HUMAN, ...extra }) as NoticeRequest,
};

export const postTarget = (id: string, mediaId?: string) => ({ kind: "post" as const, id, ...(mediaId === undefined ? {} : { mediaId }) });
export const accountTarget = (handle: string) => ({ kind: "account" as const, handle });
export const linkTarget = (url: string) => ({ kind: "link" as const, url });
```

### Create `apps/api/test/moderation-alerts.test.ts`

```ts
import pino from "pino";
import { describe, expect, test } from "vitest";
import type { AuthForModeration, StaffMessage } from "../src/auth";
import { MemoryStore, type RateLimitStore } from "../src/middleware/rate-limit";
import { URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS, alertUrgentLane, staffAlert } from "../src/moderation/alerts";
import { createBackground, type ModerationDeps } from "../src/moderation/context";

/**
 * The staff alerts' throttle and the work a request starts without waiting for it (3c design, sections 7.1 step 5 and
 * 7.12), without a database: the limit store is the in-memory one or a stand-in that fails, and the auth module is a
 * stand-in that takes, or does not take, the mail.
 */

const message: StaffMessage = { template: "moderation_urgent", count: 2, oldest: new Date("2026-10-04T06:59:59.123Z") };

/** What the alert needs: a store, an auth module whose mailStaff answers as scripted, and a log that keeps its warnings. */
function world(options: { accepted?: number[]; limits?: RateLimitStore; waiting?: { n: number; oldest: string | null } } = {}) {
  let now = 1_000_000;
  const store = options.limits ?? new MemoryStore(() => now);
  const mails: StaffMessage[] = [];
  const warnings: string[] = [];
  const accepted = [...(options.accepted ?? [])];
  const deps = {
    limits: store,
    auth: {
      mailStaff: async (sent: StaffMessage) => {
        mails.push(sent);
        return accepted.length > 0 ? accepted.shift()! : 1;
      },
    } as unknown as AuthForModeration,
    log: { warn: (_fields: unknown, text: string) => warnings.push(text) } as unknown as ModerationDeps["log"],
    // The one read the urgent alert makes: how many cases wait in the urgent lane, and since when.
    apiDb: { execute: async () => [options.waiting ?? { n: 2, oldest: "2026-10-04T06:59:59.123Z" }] } as unknown as ModerationDeps["apiDb"],
  };
  return { deps, mails, warnings, store, advance: (ms: number) => (now += ms) };
}

describe("a staff alert is sent at most once in its key's window", () => {
  test("the first goes, the next within the window do not, and one after the window goes again", async () => {
    const w = world();
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("throttled");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("throttled");
    // Another alert has a key of its own.
    expect(await staffAlert(w.deps, "other", 60_000, message)).toBe("sent");
    w.advance(60_001);
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(w.mails).toEqual([message, message, message]);
  });

  test("when no address took the mail the hit is given back: the next occasion sends it again", async () => {
    const w = world({ accepted: [0, 0, 2] });
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("unsent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("unsent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("throttled");
    expect(w.mails).toHaveLength(3);
    expect(w.warnings).toEqual([]);
  });

  test("a hit that cannot be given back is logged, never thrown", async () => {
    const hits = new MemoryStore();
    const limits: RateLimitStore = {
      hit: (key, windowMs) => hits.hit(key, windowMs),
      release: async () => {
        throw new Error("the store went away");
      },
    };
    const w = world({ accepted: [0], limits });
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("unsent");
    expect(w.warnings).toEqual(["moderation alert: the hit of an alert nobody received could not be given back"]);
  });

  test("an alert fails open: when the store cannot be reached the mail goes anyway, every time, and nothing is given back", async () => {
    let released = 0;
    const limits: RateLimitStore = {
      hit: async () => {
        throw new Error("the store cannot be reached");
      },
      release: async () => {
        released++;
      },
    };
    const w = world({ accepted: [1, 0], limits });
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("unsent");
    expect(w.mails).toHaveLength(2);
    expect(released).toBe(0);
    expect(w.warnings).toHaveLength(2);
  });
});

describe("the urgent lane's alert", () => {
  test("tells how many cases wait in the urgent lane and since when the oldest does, under its own key and a 15-minute window", async () => {
    expect([URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS]).toEqual(["moderation-urgent", 15 * 60_000]);
    const w = world({ waiting: { n: 3, oldest: "2026-10-04T06:59:59.123Z" } });
    expect(await alertUrgentLane(w.deps)).toBe("sent");
    expect(w.mails).toEqual([{ template: "moderation_urgent", count: 3, oldest: new Date("2026-10-04T06:59:59.123Z") }]);
    expect(await alertUrgentLane(w.deps)).toBe("throttled");
    w.advance(15 * 60_000 + 1);
    expect(await alertUrgentLane(w.deps)).toBe("sent");
    // The key is the one the dispatch job repeats the alert under.
    expect((await w.store.hit("moderation-urgent", URGENT_ALERT_WINDOW_MS)).count).toBe(2);
  });

  test("with nothing waiting any more, nothing is sent and no window is opened", async () => {
    const w = world({ waiting: { n: 0, oldest: null } });
    expect(await alertUrgentLane(w.deps)).toBe("nothing_waiting");
    expect(w.mails).toEqual([]);
    expect((await w.store.hit(URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS)).count).toBe(1);
  });
});

describe("the work a request starts and does not wait for", () => {
  test("settle resolves once every task has ended, those started meanwhile included; a task that throws is logged and stops nothing", async () => {
    const errors: unknown[] = [];
    const background = createBackground({ error: (fields: { err: unknown }) => errors.push(fields.err) } as unknown as pino.Logger);
    const done: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    background.start(async () => {
      await held;
      done.push("first");
      // A task may start another: settle waits for that one too.
      background.start(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        done.push("started meanwhile");
      });
    });
    const failure = new Error("the relay fell over");
    background.start(async () => {
      throw failure;
    });
    let settled = false;
    const settling = background.settle().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(errors).toEqual([failure]);
    release();
    await settling;
    expect(done).toEqual(["first", "started meanwhile"]);
    // With nothing running, settle resolves at once.
    await background.settle();
  });
});
```

### Create `apps/api/test/moderation-links.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { ModerationError } from "../src/moderation/context";
import { accountLink, parseLink, postLink } from "../src/moderation/links";

/**
 * korbat links (3c design, section 7.1, step 3): the only thing a report may name besides an id or a handle. A link must
 * be the app's own address of a post or of a profile; anything else is refused with one of two codes, and nothing is
 * ever fetched or followed.
 */
const APP = "http://localhost:8081";
const POST = "0190f3a2-7c1e-7b1a-9f00-0123456789ab";

const refusal = (origin: string, url: string): string | null => {
  try {
    parseLink(origin, url);
    return null;
  } catch (err) {
    if (err instanceof ModerationError) return `${err.code} ${err.status}`;
    throw err;
  }
};

describe("parseLink", () => {
  test("a post's address names the post by its id, a profile's the account by its handle", () => {
    expect(parseLink(APP, `${APP}/post/${POST}`)).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, `${APP}/u/ada_99`)).toEqual({ type: "account", handle: "ada_99" });
  });

  test("hosts: only the app's own host and port; the scheme and the host's case do not matter, a port or a subdomain does", () => {
    expect(parseLink(APP, `HTTP://LOCALHOST:8081/post/${POST}`)).toEqual({ type: "post", id: POST });
    // Someone copies the address as their browser showed it before a redirect to https.
    expect(parseLink("https://korbat.example", `http://korbat.example/u/ada`)).toEqual({ type: "account", handle: "ada" });
    expect(parseLink("https://korbat.example", `https://KORBAT.example:443/u/ada`)).toEqual({ type: "account", handle: "ada" });
    for (const url of [
      `http://localhost:8082/post/${POST}`,
      `http://localhost/post/${POST}`,
      `https://elsewhere.example/post/${POST}`,
      `http://www.localhost:8081/post/${POST}`,
      `http://localhost.evil.example:8081/post/${POST}`,
      // The part before the @ is a user name; the host is what follows it.
      `http://localhost:8081@evil.example/post/${POST}`,
    ]) {
      expect(refusal(APP, url), url).toBe("notice_link_offsite 422");
    }
    expect(refusal("https://korbat.example", `https://korbat.example.evil.example/u/ada`)).toBe("notice_link_offsite 422");
  });

  test("paths: only /post/<id> and /u/<handle>, each with at most one final slash; a query and a fragment are ignored", () => {
    expect(parseLink(APP, `${APP}/post/${POST}/`)).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, `${APP}/u/ada/`)).toEqual({ type: "account", handle: "ada" });
    expect(parseLink(APP, `${APP}/post/${POST}?ref=share#top`)).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, `${APP}/u/ada?x=1`)).toEqual({ type: "account", handle: "ada" });
    for (const url of [
      APP,
      `${APP}/`,
      `${APP}/post`,
      `${APP}/post/`,
      `${APP}/post/${POST}//`,
      `${APP}/post/${POST}/thread`,
      `${APP}/posts/${POST}`,
      `${APP}/u`,
      `${APP}/u/ada/followers`,
      `${APP}/u/ada/following`,
      `${APP}/settings/profile`,
      `${APP}/terms`,
      `${APP}/api/posts/${POST}`,
      `${APP}/notice/N-ABCDEFGH23`,
      `${APP}//post/${POST}`,
    ]) {
      expect(refusal(APP, url), url).toBe("notice_link_invalid 422");
    }
  });

  test("case: an id and a handle are taken in lower case; the path's own words are the app's, in lower case only", () => {
    expect(parseLink(APP, `${APP}/post/${POST.toUpperCase()}`)).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, `${APP}/u/Ada_99`)).toEqual({ type: "account", handle: "ada_99" });
    expect(refusal(APP, `${APP}/Post/${POST}`)).toBe("notice_link_invalid 422");
    expect(refusal(APP, `${APP}/U/ada`)).toBe("notice_link_invalid 422");
  });

  test("an id that is not an id and a handle that is not a handle are no link to anything", () => {
    for (const url of [`${APP}/post/123`, `${APP}/post/${POST.slice(1)}`, `${APP}/post/${POST}x`, `${APP}/post/${POST.replace(/-/g, "")}`]) {
      expect(refusal(APP, url), url).toBe("notice_link_invalid 422");
    }
    for (const handle of ["ab", "a".repeat(21), "ada-lovelace", "ada.lovelace", "@ada", "ada%20x", "%61da"]) {
      expect(refusal(APP, `${APP}/u/${handle}`), handle).toBe("notice_link_invalid 422");
    }
    expect(parseLink(APP, `${APP}/u/${"a".repeat(20)}`)).toEqual({ type: "account", handle: "a".repeat(20) });
    expect(parseLink(APP, `${APP}/u/abc`)).toEqual({ type: "account", handle: "abc" });
  });

  test("what is no web address at all, or carries a user name or a password, is refused as no link", () => {
    for (const url of ["", "not a link", "/u/ada", "localhost:8081/u/ada", "javascript:alert(1)", `ftp://localhost:8081/post/${POST}`, `http://ada:secret@localhost:8081/u/ada`, `http://ada@localhost:8081/u/ada`]) {
      expect(refusal(APP, url), url).toBe("notice_link_invalid 422");
    }
  });
});

describe("the links korbat builds", () => {
  test("a post's from its id and an account's from a handle, at the app's origin, and each parses back to what it names", () => {
    expect(postLink(APP, POST)).toBe(`${APP}/post/${POST}`);
    expect(accountLink(APP, "ada_99")).toBe(`${APP}/u/ada_99`);
    expect(parseLink(APP, postLink(APP, POST))).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, accountLink(APP, "ada_99"))).toEqual({ type: "account", handle: "ada_99" });
    // An origin written with a final slash gives the same links.
    expect(postLink("https://korbat.example/", POST)).toBe(`https://korbat.example/post/${POST}`);
    expect(accountLink("https://korbat.example/", "ada")).toBe("https://korbat.example/u/ada");
  });
});
```

### Create `apps/api/test/moderation-notice-limits.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { NOTICE_LIMITS, type NoticeRequest } from "@korbat/contracts";
import { MemoryStore, type RateLimitStore } from "../src/middleware/rate-limit";
import { ModerationError, createBackground, type ModerationDeps } from "../src/moderation/context";
import { submitNotice, type IntakeRecorded, type NoticeSender } from "../src/moderation/intake";

/**
 * What a report or a notice costs its sender of their limits when it could not be saved (3c design, section 7.1, steps 2
 * and 4), without a database: the pool is a stand-in whose transaction never runs its statements and ends the way the
 * test scripts it, with the errors PostgreSQL gives and drizzle wraps. Every request that passed the checks of its
 * sender is counted before a target is looked up, and one that a later step refuses stays counted. One that failed
 * through no fault of its sender, whose answer says "send it again", gives its hits back.
 */

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const HUMAN = "human";

/** PostgreSQL's error as drizzle hands it over: its own error, with the driver's as the cause. */
const pg = (code: string, extra: Record<string, unknown> = {}) => new Error("Failed query", { cause: Object.assign(new Error(String(extra.message ?? code)), { code, ...extra }) });
/** The four runs of an intake whose case closed under each of them: the answer is case_closed. */
const closedEveryTime = () => [pg("40001", { message: "case_closed" }), pg("40001"), pg("40P01"), pg("55P03")];

const stored: IntakeRecorded = { intakeId: randomUUID(), ref: "N-ABCDEFGH23", token: "t".repeat(43), suspect: false, items: [] };
const post = { kind: "post" as const, id: randomUUID() };
const signedOut: NoticeRequest = { ground: "rule", ruleId: "R1", targets: [post], turnstileToken: HUMAN };
const signedIn: NoticeRequest = { ground: "rule", ruleId: "R1", targets: [post] };

/** The module over a pool whose transactions end as scripted, one entry for each run, with the in-memory limit store unless another is given. */
function world(ends: unknown[], limits: RateLimitStore = new MemoryStore()) {
  let runs = 0;
  const warnings: string[] = [];
  const log = { warn: (_fields: unknown, text: string) => warnings.push(text), error: () => undefined } as unknown as ModerationDeps["log"];
  const deps = {
    apiDb: {
      // The reads outside the transaction find nothing: no target the sender reported already, no receipt to send.
      execute: async () => [],
      transaction: async () => {
        const end = ends[runs++];
        if (end instanceof Error) throw end;
        if (end === undefined) throw new Error("the transaction ran more often than the test scripted");
        return end;
      },
    },
    auth: { verifyHuman: async (token: string) => token === HUMAN },
    social: { postRef: async () => ({ authorId: randomUUID(), state: "visible", quoteOfId: null }), findAccountByHandle: async () => null },
    limits,
    background: createBackground(log),
    config: { APP_ORIGIN: "http://localhost:8081" },
    log,
    now: () => new Date(),
  } as unknown as ModerationDeps;
  return { deps, limits, warnings, runs: () => runs };
}

/** How many hits a key of the store holds, read by hitting it once more. */
const held = async (limits: RateLimitStore, key: string, windowMs: number) => (await limits.hit(key, windowMs)).count - 1;

describe("a report that could not be saved through no fault of its sender gives its limit hits back", () => {
  test("signed out: after case_closed the network's hour and day are as before, so every one of the hour's five can still be sent", async () => {
    const from: NoticeSender = { session: null, netHash: "network" };
    const w = world([...Array.from({ length: 5 }, closedEveryTime).flat(), ...Array.from({ length: NOTICE_LIMITS.signedOut.perHour }, () => stored)]);
    for (let n = 0; n < 5; n++) await expect(submitNotice(w.deps, signedOut, from)).rejects.toMatchObject({ name: "ModerationError", code: "case_closed", status: 409 });
    expect(w.runs()).toBe(20);
    // Had the five refused requests kept their hits, the hour would be used up now.
    for (let n = 0; n < NOTICE_LIMITS.signedOut.perHour; n++) expect(await submitNotice(w.deps, signedOut, from)).toEqual({ ref: stored.ref, token: stored.token });
    await expect(submitNotice(w.deps, signedOut, from)).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    // The day holds the five that were saved, and nothing of the five that were not.
    expect(await held(w.limits, "notice:day:net:network", DAY)).toBe(NOTICE_LIMITS.signedOut.perHour);
    expect(w.warnings).toEqual([]);
  });

  test("signed in: after case_closed the account's hour and day are as before", async () => {
    const userId = randomUUID();
    const from: NoticeSender = { session: { userId, role: "user", onboarded: true }, netHash: "network" };
    const w = world([...closedEveryTime(), stored]);
    await expect(submitNotice(w.deps, signedIn, from)).rejects.toMatchObject({ code: "case_closed" });
    expect([await held(w.limits, `notice:hour:account:${userId}`, HOUR), await held(w.limits, `notice:day:account:${userId}`, DAY)]).toEqual([0, 0]);
    // A report that is saved keeps its hits: the two reads above, and this one.
    expect(await submitNotice(w.deps, signedIn, from)).toEqual({ ref: stored.ref, token: stored.token });
    expect([await held(w.limits, `notice:hour:account:${userId}`, HOUR), await held(w.limits, `notice:day:account:${userId}`, DAY)]).toEqual([2, 2]);
    // The network's counts are a signed-out sender's alone.
    expect(await held(w.limits, "notice:hour:net:network", HOUR)).toBe(0);
  });

  test("an unexpected failure of the transaction is thrown as it is, and gives the hits back too", async () => {
    const from: NoticeSender = { session: null, netHash: "network" };
    for (const failure of [new Error("the connection ended"), pg("23503"), pg("P0001", { message: "quote_item_missing" })]) {
      const w = world([failure]);
      await expect(submitNotice(w.deps, signedOut, from)).rejects.toBe(failure);
      expect([await held(w.limits, "notice:hour:net:network", HOUR), await held(w.limits, "notice:day:net:network", DAY)]).toEqual([0, 0]);
    }
  });

  test("a refusal that is the sender's own keeps its hit: already reported, a link to another site, an account that is gone", async () => {
    const userId = randomUUID();
    const from: NoticeSender = { session: { userId, role: "user", onboarded: true }, netHash: "network" };
    const w = world([pg("23505", { constraint_name: "intake_items_reporter_once" }), new ModerationError("not_found")]);
    await expect(submitNotice(w.deps, signedIn, from)).rejects.toMatchObject({ code: "already_reported" });
    await expect(submitNotice(w.deps, signedIn, from)).rejects.toMatchObject({ code: "not_found" });
    await expect(submitNotice(w.deps, { ...signedIn, targets: [{ kind: "link", url: "https://elsewhere.example/u/ada" }] }, from)).rejects.toMatchObject({ code: "notice_link_offsite" });
    expect(w.runs()).toBe(2);
    expect([await held(w.limits, `notice:hour:account:${userId}`, HOUR), await held(w.limits, `notice:day:account:${userId}`, DAY)]).toEqual([3, 3]);
  });

  test("a request refused before it was counted has nothing to give back: a failed human check, a staff session, one that has not finished onboarding", async () => {
    const w = world([]);
    await expect(submitNotice(w.deps, { ...signedOut, turnstileToken: "not-human" }, { session: null, netHash: "network" })).rejects.toMatchObject({ code: "human_check_failed" });
    const userId = randomUUID();
    await expect(submitNotice(w.deps, signedIn, { session: { userId, role: "moderator", onboarded: true }, netHash: "network" })).rejects.toMatchObject({ code: "staff_cannot_report" });
    await expect(submitNotice(w.deps, signedIn, { session: { userId, role: "user", onboarded: false }, netHash: "network" })).rejects.toMatchObject({ code: "onboarding_required" });
    expect(w.runs()).toBe(0);
    expect([await held(w.limits, "notice:hour:net:network", HOUR), await held(w.limits, `notice:hour:account:${userId}`, HOUR)]).toEqual([0, 0]);
  });

  test("a hit that cannot be given back is logged without the sender's key, and the answer is still case_closed", async () => {
    const hits = new MemoryStore();
    const limits: RateLimitStore = {
      hit: (key, windowMs) => hits.hit(key, windowMs),
      release: async () => {
        throw new Error("the store went away");
      },
    };
    const w = world(closedEveryTime(), limits);
    await expect(submitNotice(w.deps, signedOut, { session: null, netHash: "network" })).rejects.toMatchObject({ code: "case_closed" });
    expect(w.warnings).toEqual(["notice: a limit hit of a request that could not be saved could not be given back", "notice: a limit hit of a request that could not be saved could not be given back"]);
    // Nothing was given back: the hits stand.
    expect(await held(hits, "notice:hour:net:network", HOUR)).toBe(1);
  });
});
```

### Create `packages/contracts/test/notices.test.ts`

```ts
import { describe, expect, test } from "vitest";
import {
  CSAM_KEYWORDS,
  ITEM_OUTCOMES,
  ItemOutcome,
  NOTICE_LIMITS,
  NOTICE_NAME_MAX,
  NoticeContactRequest,
  NoticeRequest,
  NoticeResponse,
  NoticeStatus,
  NoticeStatusRequest,
  NoticeTarget,
  REPORT_RULE_IDS,
  TDB_FORM_CATEGORIES,
} from "../src/index";

// Reports and notices (3c design, sections 7.1, 7.2 and 10): what POST /api/notices takes and what the status page reads.

const POST = "0190f3a2-7c1e-7b1a-9f00-0123456789ab";
const OTHER_POST = "0190f3a2-7c1e-7b1a-9f00-0123456789ac";
const MEDIA = "0190f3a2-7c1e-7b1a-9f00-0123456789ad";
const TOKEN = "A".repeat(43);
const postTarget = { kind: "post", id: POST } as const;

const rule = { ground: "rule", ruleId: "R1", targets: [postTarget] };
const illegal = { ground: "illegal", targets: [postTarget], category: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH", explanation: "It is a threat under section 241.", bonaFide: true };
const csam = { ground: "csam", targets: [postTarget], keyword: "csam" };

const accepted = (value: unknown) => NoticeRequest.safeParse(value).success;

/** Characters built in code: a file of this repository holds none of them as a literal. */
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
const LONE_SURROGATE = String.fromCharCode(0xd800);
const GRINNING = String.fromCodePoint(0x1f600);

describe("a notice's targets", () => {
  test("a post by its id, with or without one of its images, in the lower case the database keeps", () => {
    expect(NoticeTarget.parse({ kind: "post", id: POST.toUpperCase() })).toEqual({ kind: "post", id: POST });
    expect(NoticeTarget.parse({ kind: "post", id: POST, mediaId: MEDIA.toUpperCase() })).toEqual({ kind: "post", id: POST, mediaId: MEDIA });
    expect(NoticeTarget.safeParse({ kind: "post", id: "not-an-id" }).success).toBe(false);
    expect(NoticeTarget.safeParse({ kind: "post", id: POST, mediaId: "x" }).success).toBe(false);
  });

  test("an account by its handle, with or without the @, kept in lower case", () => {
    expect(NoticeTarget.parse({ kind: "account", handle: "@Ada_99" })).toEqual({ kind: "account", handle: "ada_99" });
    expect(NoticeTarget.parse({ kind: "account", handle: " ada " })).toEqual({ kind: "account", handle: "ada" });
    for (const handle of ["ab", "a".repeat(21), "ada lovelace", "ada-lovelace", ""]) expect(NoticeTarget.safeParse({ kind: "account", handle }).success, handle).toBe(false);
  });

  test("a link of at most 300 characters that is an http or https address; whose address it is the route decides", () => {
    for (const url of ["http://localhost:8081/post/" + POST, "https://korbat.example/u/ada", "https://elsewhere.example/anything"]) {
      expect(NoticeTarget.parse({ kind: "link", url })).toEqual({ kind: "link", url });
    }
    for (const url of ["javascript:alert(1)", "ftp://korbat.example/post/" + POST, "korbat.example/u/ada", "/u/ada", "", "https://korbat.example/" + "a".repeat(300)]) {
      expect(NoticeTarget.safeParse({ kind: "link", url }).success, url).toBe(false);
    }
  });

  test("a target of no kind, of another kind, or with a member that is not its own is refused", () => {
    expect(NoticeTarget.safeParse({ id: POST }).success).toBe(false);
    expect(NoticeTarget.safeParse({ kind: "image", id: MEDIA }).success).toBe(false);
    expect(NoticeTarget.safeParse({ kind: "post", id: POST, handle: "ada" }).success).toBe(false);
    expect(NoticeTarget.safeParse({ kind: "account", handle: "ada", id: POST }).success).toBe(false);
  });
});

describe("NoticeRequest", () => {
  test("the three grounds, each with what it needs and nothing more", () => {
    expect(NoticeRequest.parse(rule)).toEqual(rule);
    expect(NoticeRequest.parse(illegal)).toEqual(illegal);
    expect(NoticeRequest.parse(csam)).toEqual(csam);
    expect(accepted({ targets: [postTarget] })).toBe(false);
    expect(accepted({ ...rule, ground: "other" })).toBe(false);
  });

  test("accepted: a rule notice with a turnstileToken, a CSAM notice without explanation or bona fide, a CSAM notice with keyword abuse", () => {
    expect(accepted({ ...rule, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" })).toBe(true);
    expect(accepted({ ground: "csam", targets: [postTarget], keyword: "abuse" })).toBe(true);
    for (const keyword of Object.keys(CSAM_KEYWORDS)) expect(accepted({ ...csam, keyword }), keyword).toBe(true);
    expect(accepted({ ...csam, explanation: "The second image.", bonaFide: true, turnstileToken: "t" })).toBe(true);
    expect(accepted({ ...csam, bonaFide: false })).toBe(true);
    // Every rule but R2, on the rule ground and beside an allegation of illegality.
    for (const ruleId of REPORT_RULE_IDS) {
      expect(accepted({ ...rule, ruleId }), ruleId).toBe(true);
      expect(accepted({ ...illegal, ruleId }), ruleId).toBe(true);
    }
    expect(REPORT_RULE_IDS).toEqual(["R1", "R3", "R4", "R5", "R6"]);
  });

  test("refused: a rule report or an illegal-ground notice citing R2, which only a moderator's finding cites", () => {
    expect(accepted({ ...rule, ruleId: "R2" })).toBe(false);
    expect(accepted({ ...illegal, ruleId: "R2" })).toBe(false);
    expect(accepted({ ...rule, ruleId: "R7" })).toBe(false);
    expect(accepted({ ground: "rule", targets: [postTarget] })).toBe(false);
  });

  test("refused: a CSAM notice with a name or an email, and a rule report with either: only the illegal ground asks for them", () => {
    expect(accepted({ ...csam, name: "Ada" })).toBe(false);
    expect(accepted({ ...csam, email: "ada@example.com" })).toBe(false);
    expect(accepted({ ...rule, email: "ada@example.com" })).toBe(false);
    expect(accepted({ ...csam, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS" })).toBe(false);
    expect(accepted({ ...csam, keyword: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL" })).toBe(false);
    expect(accepted({ ground: "csam", targets: [postTarget] })).toBe(false);
  });

  test("an illegal-ground notice may carry a name and an email; the address is kept trimmed and in lower case", () => {
    const parsed = NoticeRequest.parse({ ...illegal, name: "Ada Lovelace", email: " Ada@Example.COM ", citedLaw: "StGB 241" });
    expect(parsed).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com", citedLaw: "StGB 241" });
    expect(accepted({ ...illegal, email: "not an address" })).toBe(false);
    expect(accepted({ ...illegal, name: "" })).toBe(false);
    expect(accepted({ ...illegal, name: "a".repeat(NOTICE_NAME_MAX) })).toBe(true);
    expect(accepted({ ...illegal, name: "a".repeat(NOTICE_NAME_MAX + 1) })).toBe(false);
    expect(accepted({ ...illegal, name: `Ada${LF}Lovelace` })).toBe(false);
    expect(NOTICE_NAME_MAX).toBe(100);
  });

  test("an illegal-ground notice needs its explanation, its good-faith statement and a category the form offers or 'not sure'", () => {
    const { explanation: _explanation, ...withoutExplanation } = illegal;
    expect(accepted(withoutExplanation)).toBe(false);
    expect(accepted({ ...illegal, bonaFide: false })).toBe(false);
    const { bonaFide: _bonaFide, ...withoutStatement } = illegal;
    expect(accepted(withoutStatement)).toBe(false);
    for (const category of [...TDB_FORM_CATEGORIES, "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"]) expect(accepted({ ...illegal, category }), category).toBe(true);
    // A rule-only report gets this category from the server; a notice of illegality never carries it.
    expect(accepted({ ...illegal, category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" })).toBe(false);
    expect(accepted({ ...illegal, category: "STATEMENT_CATEGORY_PORNOGRAPHY_OR_SEXUALIZED_CONTENT" })).toBe(false);
  });

  test("one to ten targets: none and eleven are refused", () => {
    expect(NOTICE_LIMITS.maxTargets).toBe(10);
    const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "post", id: `0190f3a2-7c1e-7b1a-9f00-${String(i).padStart(12, "0")}` }));
    expect(accepted({ ...rule, targets: [] })).toBe(false);
    expect(accepted({ ...rule, targets: posts(10) })).toBe(true);
    expect(accepted({ ...rule, targets: posts(11) })).toBe(false);
    expect(accepted({ ...csam, targets: posts(11) })).toBe(false);
  });

  test("refused: a CSAM notice with two account targets; one account, also named twice, and beside posts, is accepted", () => {
    const account = (handle: string) => ({ kind: "account", handle });
    expect(accepted({ ...csam, targets: [account("ada"), account("bob")] })).toBe(false);
    expect(accepted({ ...csam, targets: [account("ada"), postTarget, account("bob")] })).toBe(false);
    expect(accepted({ ...csam, targets: [account("ada")] })).toBe(true);
    expect(accepted({ ...csam, targets: [account("ada"), account("@ADA"), postTarget, { kind: "post", id: OTHER_POST }] })).toBe(true);
    // On the other grounds a notice may name several accounts.
    expect(accepted({ ...rule, targets: [account("ada"), account("bob")] })).toBe(true);
    expect(accepted({ ...illegal, targets: [account("ada"), account("bob")] })).toBe(true);
  });

  test("refused: an off-pattern link", () => {
    expect(accepted({ ...rule, targets: [{ kind: "link", url: "see my profile" }] })).toBe(false);
    expect(accepted({ ...rule, targets: [{ kind: "link", url: "mailto:ada@example.com" }] })).toBe(false);
    expect(accepted({ ...rule, targets: [{ kind: "link", url: "https://korbat.example/post/" + POST }] })).toBe(true);
  });

  test("every text is taken as written or refused, never changed: its bounds, and no control or disguising character", () => {
    const withText = (explanation: string) => ({ ...illegal, explanation });
    const kept = `  first line${LF}${LF}${LF}second line ${GRINNING} `;
    expect(NoticeRequest.parse(withText(kept))).toMatchObject({ explanation: kept });
    expect(NOTICE_LIMITS.explanationMax).toBe(2000);
    expect(accepted(withText("a".repeat(2000)))).toBe(true);
    expect(accepted(withText("a".repeat(2001)))).toBe(false);
    // Counted as PostgreSQL's char_length counts: a character outside the basic plane is one.
    expect(accepted(withText(GRINNING.repeat(2000)))).toBe(true);
    expect(accepted(withText(GRINNING.repeat(2001)))).toBe(false);
    for (const [name, bad] of [["NUL", NUL], ["a tab", TAB], ["a carriage return", CR], ["a zero-width space", ZERO_WIDTH_SPACE], ["a direction override", RIGHT_TO_LEFT_OVERRIDE], ["a lone surrogate", LONE_SURROGATE]] as const) {
      expect(accepted(withText(`an explanation with ${bad} in it`)), name).toBe(false);
    }
    expect(accepted(withText(""))).toBe(false);
    expect(accepted(withText(`  ${LF} `))).toBe(false);
    expect(accepted({ ...illegal, citedLaw: "a".repeat(NOTICE_LIMITS.citedLawMax) })).toBe(true);
    expect(accepted({ ...illegal, citedLaw: "a".repeat(NOTICE_LIMITS.citedLawMax + 1) })).toBe(false);
    expect(accepted({ ...rule, explanation: "a".repeat(2001) })).toBe(false);
    expect(accepted({ ...csam, explanation: `with ${ZERO_WIDTH_SPACE}` })).toBe(false);
  });
});

describe("the notice's answers and the status page", () => {
  test("the answer carries the reference, and the token only where there is one", () => {
    expect(NoticeResponse.parse({ ref: "N-ABCDEFGH23", token: TOKEN })).toEqual({ ref: "N-ABCDEFGH23", token: TOKEN });
    expect(NoticeResponse.parse({ ref: "N-ABCDEFGH23" })).toEqual({ ref: "N-ABCDEFGH23" });
    expect(NoticeResponse.safeParse({ ref: "N-abcdefgh23" }).success).toBe(false);
    expect(NoticeResponse.safeParse({ ref: "N-ABCDEFGH23", token: "short" }).success).toBe(false);
  });

  test("the status and contact requests take a reference and a token, and the contact request one of two choices", () => {
    expect(NoticeStatusRequest.parse({ ref: "N-ABCDEFGH23", token: TOKEN })).toEqual({ ref: "N-ABCDEFGH23", token: TOKEN });
    expect(NoticeStatusRequest.safeParse({ ref: "N-ABCDEFGH23" }).success).toBe(false);
    expect(NoticeStatusRequest.safeParse({ ref: "N-ABCDEFGH2", token: TOKEN }).success).toBe(false);
    expect(NoticeStatusRequest.safeParse({ ref: "N-ABCDEFGH23", token: TOKEN, position: 1 }).success).toBe(false);
    for (const choice of ["confirm", "stop"]) expect(NoticeContactRequest.safeParse({ ref: "N-ABCDEFGH23", token: TOKEN, choice }).success, choice).toBe(true);
    expect(NoticeContactRequest.safeParse({ ref: "N-ABCDEFGH23", token: TOKEN, choice: "resume" }).success).toBe(false);
    expect(NoticeContactRequest.safeParse({ ref: "N-ABCDEFGH23", token: TOKEN }).success).toBe(false);
  });

  test("the outcomes an item can be shown are the seven of the database's item_outcome", () => {
    expect(ITEM_OUTCOMES).toEqual(["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"]);
    expect(ItemOutcome.options).toEqual([...ITEM_OUTCOMES]);
  });

  test("the status answer: each item with its link, scope and marks, its outcome and day only once released, and the contact's facts", () => {
    const waiting = { position: 1, link: "http://localhost:8081/post/" + POST, scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
    const answered = { ...waiting, position: 11, link: "http://localhost:8081/u/ada", scope: "account_suspect", suspect: true, sealed: true, quotedBy: 1, outcome: "no_violation", decidedOn: "2026-10-04", reexamination: { open: true, until: "2027-04-04T07:00:00.000Z" } };
    const status = { ref: "N-ABCDEFGH23", receivedAt: "2026-10-04T06:59:59.123Z", items: [waiting, answered], contact: { given: true, confirmed: null, stopped: null } };
    expect(NoticeStatus.parse(status)).toEqual(status);
    expect(NoticeStatus.parse({ ...status, contact: null }).contact).toBeNull();
    expect(NoticeStatus.parse({ ...status, contact: { given: true, confirmed: true, stopped: false } }).contact).toEqual({ given: true, confirmed: true, stopped: false });
    for (const scope of ["account", "quote", "account_suspect", null]) expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, scope }] }).success, String(scope)).toBe(true);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, scope: "post" }] }).success).toBe(false);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, position: 21 }] }).success).toBe(false);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, quotedBy: 11 }] }).success).toBe(false);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, outcome: "removed" }] }).success).toBe(false);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, decidedOn: "04.10.2026" }] }).success).toBe(false);
  });
});
```

### Replace `apps/api/test/app.test.ts` (whole file)

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import pino from "pino";
import { HealthResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createAccount } from "../src/account";
import { createApp } from "../src/app";
import { AuthError, createAuth } from "../src/auth";
import { MemoryKv } from "../src/auth/kv";
import { loadConfig } from "../src/config";
import { MemoryMailer } from "../src/mail/memory";
import { createMedia } from "../src/media";
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
  NOTIFIER_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
});

const mediaRoot = mkdtempSync(path.join(tmpdir(), "korbat-app-test-"));

/** The real app with every module; the database pools are created but never connect in these tests. */
function app(checks: Record<string, () => Promise<void>>, advisoryChecks?: Record<string, () => Promise<void>>) {
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
  const media = createMedia({
    apiDb,
    uploadsDir: path.join(mediaRoot, "uploads"),
    storeDir: path.join(mediaRoot, "store"),
    formats: config.MEDIA_FORMATS,
    minFreeBytes: 0,
    logger,
    requireSession: auth.requireSession,
    resolveSession: auth.resolveSession,
    rateLimitStore,
    enforceUploadLimit: async () => undefined,
  });
  const account = createAccount({
    auth: auth.forAccount,
    social: social.forAccount,
    media: media.forAccount,
    requireSession: auth.requireSession,
    requireFreshAuth: auth.requireFreshAuth(),
    requireStrongFreshAuth: auth.requireStrongFreshAuth(),
    rateLimitStore,
    logger,
  });
  return createApp({ config, logger, rateLimitStore, healthChecks: checks, advisoryChecks, auth, social, media, account });
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

describe("advisory health checks", () => {
  const down = async () => {
    throw new Error("stale heartbeat");
  };
  test("a failing advisory check is reported as degraded, with status 200", async () => {
    const res = await app({ postgres: async () => {} }, { image_worker: down }).request("/api/health");
    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({ status: "degraded", version: "9.9.9", checks: { postgres: "ok", image_worker: "fail" } });
  });
  test("a failing critical check is still 503, whatever the advisory ones say", async () => {
    const res = await app({ postgres: down }, { image_worker: async () => {} }).request("/api/health");
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks).toEqual({ postgres: "fail", image_worker: "ok" });
  });
});

describe("caching", () => {
  test("responses are no-store unless the handler set its own Cache-Control", async () => {
    const a = app({});
    a.get("/api/cached", (c) => {
      c.header("Cache-Control", "public, max-age=300");
      return c.text("image bytes");
    });
    expect((await a.request("/api/health")).headers.get("cache-control")).toBe("no-store");
    expect((await a.request("/api/nope")).headers.get("cache-control")).toBe("no-store");
    expect((await a.request("/api/cached")).headers.get("cache-control")).toBe("public, max-age=300");
  });
});

describe("request bodies", () => {
  test("JSON bodies over 64 KiB are refused with 413; the raw upload route is exempt", async () => {
    const a = app({});
    const big = JSON.stringify({ email: "x".repeat(70_000) });
    const refused = await a.request("/api/auth/email/start", { method: "POST", headers: { "content-type": "application/json" }, body: big });
    expect(refused.status).toBe(413);
    expect(await refused.json()).toMatchObject({ error: { code: "payload_too_large" } });
    const upload = await a.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: big });
    expect(upload.status).toBe(401);
  });
});

describe("media routes", () => {
  const id = "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab";
  test("uploading, status and removal need a session", async () => {
    const a = app({});
    const upload = await a.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: "x" });
    expect(upload.status).toBe(401);
    expect(await upload.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request(`/api/media/${id}`)).status).toBe(401);
    expect((await a.request(`/api/media/${id}`, { method: "DELETE" })).status).toBe(401);
  });
  test("image file requests that cannot name an image are not found before any query runs", async () => {
    const a = app({});
    for (const url of ["/api/media/not-an-id/large.webp", `/api/media/${id}/large.png`, `/api/media/${id}/huge.webp`]) {
      const res = await a.request(url);
      expect(res.status, url).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    }
  });
  test("image files have their own bucket of 1200 a minute, outside the global 300", async () => {
    const a = app({});
    let last = 0;
    for (let i = 0; i < 1201; i++) last = (await a.request("/api/media/not-an-id/large.webp")).status;
    expect(last).toBe(429);
    expect((await a.request("/api/health")).status).toBe(200);
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
  test("an auth error's details reach the envelope, so the app can ask for what a refusal names", async () => {
    const a = app({});
    a.get("/api/needs-more", () => {
      throw new AuthError("reauth_required", 403, undefined, undefined, { level: 2, have: ["email"] });
    });
    a.get("/api/needs-nothing", () => {
      throw new AuthError("mfa_required", 400);
    });
    const refused = await a.request("/api/needs-more");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "reauth_required", message: "Confirm it's you to continue.", details: { level: 2, have: ["email"] } } });
    const plain = (await (await a.request("/api/needs-nothing")).json()) as { error: Record<string, unknown> };
    expect(plain.error).not.toHaveProperty("details");
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

describe("account routes", () => {
  test("the data export is mounted at /api/account and needs a session", async () => {
    const a = app({});
    const res = await a.request("/api/account/export", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request("/api/account/export")).status).toBe(404);
  });
});
```

### Replace `apps/api/test/architecture.test.ts` (whole file)

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Module boundaries (1a spec section 2.2, 2a spec section 2.2, 3a design section 5, 3c design section 5). Paths are relative to apps/api/src
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
// The command lines open both pools: grant-role changes a role on the auth pool, and staff.js reads there the staff keys
// that audit-verify checks the record against.
const AUTH_POOL_ALLOWED = new Set(["config.ts", "index.ts", "cli/grant-role.ts", "cli/staff.ts"]);
const AUTH_KEYS_ALLOWED = new Set(["config.ts"]);

/** Modules that may only be entered through their index file. */
const MODULES = ["auth", "social", "media", "account", "staff", "moderation"] as const;

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
const insideMedia = (path: string) => path.startsWith("media/");
const insideAccount = (path: string) => path.startsWith("account/");
const insideStaff = (path: string) => path.startsWith("staff/");
const insideModeration = (path: string) => path.startsWith("moderation/");

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
    // Each encryption key with the list of the keys it replaced: after a rotation those still open what was stored before it.
    if (!insideAuth(path) && !AUTH_KEYS_ALLOWED.has(path) && /\b(TOTP_ENC_KEY|TOTP_ENC_KEYS_PREVIOUS|NOTIFIER_ENC_KEY|NOTIFIER_ENC_KEYS_PREVIOUS|AUTH_HMAC_KEY|IP_HASH_KEY)\b/.test(source)) {
      violations.push(`${path}: references an auth key`);
    }
    if (insideAuth(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import auth-schema names explicitly)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db`);
      }
    }
    if (!insideMedia(path) && /\b(postMedia|post_media)\b/.test(source)) {
      violations.push(`${path}: references post_media, which only the media module may touch`);
    }
    // The staff module (role korbat_api) reads and writes the public audit log; staff keys, staff sessions and enrolments
    // are credentials, the auth module's alone (3a design, section 5). The moderation module owns the moderation tables on
    // the same role: a notifier's contact and the staff links live in the auth schema, out of its reach (3c design, section 5).
    if (insideSocial(path) || insideMedia(path) || insideStaff(path) || insideModeration(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import public-schema names explicitly)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db`);
      }
    }
    // The account module sequences the other three through their index files and holds no table access of its own
    // (1b spec, section 5): no table or enum of either schema may be named in it. Db and DbTx, which are not schema
    // names, stay allowed, since a transaction is passed through it.
    if (insideAccount(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (the account module holds no table access)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db (the account module holds no table access)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db (the account module holds no table access)`);
      }
    }
    // The staff module uses the auth module's interface as the other modules do, never its repository or its session
    // store, which would hand it the auth tables; the moderation module likewise. Any mention counts, so a renamed,
    // namespace or dynamic import is caught as surely as a named one.
    if (insideStaff(path) || insideModeration(path)) {
      const module = insideStaff(path) ? "staff" : "moderation";
      for (const name of new Set([...source.matchAll(/\b(createAuthRepo|createSessions)\b/g)].map((m) => m[1]!))) {
        violations.push(`${path}: uses the auth module's ${name} (the ${module} module goes through the auth module's interface)`);
      }
    }
  }
  return violations;
}

/**
 * The source pins of the freeze (3c design, sections 6.1 and 6.5). The freeze of the path for suspected child sexual abuse
 * material holds only while every path of a kind passes one gate, so who may name what is pinned here, beside the
 * database's own pins of who names the predicate there:
 *   - `post_frozen` is named only in the media repository and the moderation repository, and `frozen_for` nowhere in the
 *     API: no other file decides by itself what is frozen;
 *   - a delete of `post_media` is written only in the media repository, whose every delete the keep trigger judges and
 *     whose every answer names only rows that are gone;
 *   - `requestDeletion` (asking the worker to delete an image's files) and `openImage` (opening an image file of the
 *     store) are named in a pinned list of files, each a pinned number of times, comments included: a new caller of
 *     either fails the test until whoever adds it has checked it against the gates and listed it.
 */
const POST_FROZEN_ALLOWED = new Set(["media/repo.ts", "moderation/repo.ts"]);
const POST_MEDIA_DELETE_ALLOWED = new Set(["media/repo.ts"]);
const POST_MEDIA_DELETE = /\bdelete\s+from\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?post_media\b|\btruncate\b[^;`]*\bpost_media\b|\.delete\(\s*postMedia\b/i;

function findFreezeViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (/\bfrozen_for\b/.test(source)) violations.push(`${path}: names frozen_for, which only the database's own functions name`);
    if (/\bpost_frozen\b/.test(source) && !POST_FROZEN_ALLOWED.has(path)) violations.push(`${path}: names post_frozen, which only the media and moderation repositories may`);
    if (POST_MEDIA_DELETE.test(source) && !POST_MEDIA_DELETE_ALLOWED.has(path)) violations.push(`${path}: deletes from post_media, which only the media repository may`);
  }
  return violations;
}

/** Every file that names `name` as a whole word, with how often, comments included. */
function mentions(files: SourceFile[], name: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const { path, source } of files) {
    // Cut at every word boundary: a whole word is then a piece of its own.
    const count = source.split(/\b/).filter((piece) => piece === name).length;
    if (count > 0) found[path] = count;
  }
  return found;
}

/**
 * Where `requestDeletion` is named. A deletion request names an id that a delete of post_media answered, an upload that
 * failed before it could be put on a post, or a file that has no row: the files module writes the request; the upload's
 * removal, the sweeper, the author's deletion (after its commit), the account's purge (inside its transaction) and the
 * disposal's caller (after its commit) ask for it through the module's interfaces.
 */
const REQUEST_DELETION = {
  "account/flows/deletion.ts": 1,
  "media/cases.ts": 4,
  "media/context.ts": 2,
  "media/files.ts": 1,
  "media/flows/remove.ts": 1,
  "media/index.ts": 5,
  "media/sweeper.ts": 2,
  "social/context.ts": 1,
  "social/flows/posts.ts": 1,
};

/**
 * Where `openImage` is named: the files module, which opens a file of the store under its checks, and its three callers,
 * each behind its own reader's rule: serve (gate S), the export's open (which reads the row again) and the staff's image
 * (gate V).
 */
const OPEN_IMAGE = {
  "media/cases.ts": 1,
  "media/files.ts": 1,
  "media/flows/serve.ts": 1,
  "media/index.ts": 1,
};

describe("the freeze's source pins", () => {
  test("apps/api/src names post_frozen only in the two repositories, frozen_for nowhere, and deletes from post_media only in the media repository", () => {
    expect(findFreezeViolations(loadSources())).toEqual([]);
    // The media repository does name the predicate and does delete: the pins are about a file that exists.
    const repo = loadSources().find((file) => file.path === "media/repo.ts")!;
    expect(repo.source).toMatch(/\bpost_frozen\b/);
    expect(POST_MEDIA_DELETE.test(repo.source)).toBe(true);
  });

  test("catches the predicate named outside the two repositories, and its core named anywhere", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "sql`select public.post_frozen(m.post_id) as frozen from post_media m`" },
      { path: "moderation/repo.ts", source: "sql`select not public.post_frozen(${postId}::uuid) as images_allowed`" },
      { path: "moderation/cases.ts", source: "const [row] = await tx.execute(sql`select public.post_frozen(${postId}::uuid) as frozen`);" },
      { path: "media/flows/serve.ts", source: "const frozen = await db.execute(sql`select post_frozen(${postId})`);" },
      { path: "staff/cases.ts", source: "await db.execute(sql`select public.frozen_for(${postId}::uuid, ${authorId}::uuid)`);" },
      { path: "media/repo.ts", source: "sql`select public.frozen_for(m.post_id, m.owner_id) from post_media m`" },
      // Another word that only contains the name is not the name.
      { path: "social/views.ts", source: "const post_frozen_label = 1; const unfrozen_for_now = 2;" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "moderation/cases.ts: names post_frozen, which only the media and moderation repositories may",
      "media/flows/serve.ts: names post_frozen, which only the media and moderation repositories may",
      "staff/cases.ts: names frozen_for, which only the database's own functions name",
      "media/repo.ts: names frozen_for, which only the database's own functions name",
    ]);
  });

  test("catches a delete of post_media outside the media repository, in SQL and through the query builder", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "await tx.execute(sql`delete from post_media where id in (select id from post_media where post_id = ${postId}::uuid order by id for update) returning id`);\nawait db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/sweeper.ts", source: "await db.execute(sql`delete from post_media where post_id is null and created_at < ${before}`);" },
      { path: "media/flows/remove.ts", source: "await deps.db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/cases.ts", source: 'await tx.execute(sql`DELETE FROM "public"."post_media" WHERE "id" = ${id}`);' },
      { path: "media/index.ts", source: "await tx.execute(sql`truncate table post_media cascade`);" },
      // Reading and updating image rows, and deleting something else, is not a delete of image rows.
      { path: "media/flows/status.ts", source: "await db.update(postMedia).set({ status }).where(eq(postMedia.id, id));\nawait db.delete(posts).where(eq(posts.id, id));\nconst rows = await db.execute(sql`select id from post_media`);" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "media/sweeper.ts: deletes from post_media, which only the media repository may",
      "media/flows/remove.ts: deletes from post_media, which only the media repository may",
      "media/cases.ts: deletes from post_media, which only the media repository may",
      "media/index.ts: deletes from post_media, which only the media repository may",
    ]);
  });

  test("requestDeletion and openImage are named in exactly the pinned files, each the pinned number of times", () => {
    expect(mentions(loadSources(), "requestDeletion")).toEqual(REQUEST_DELETION);
    expect(mentions(loadSources(), "openImage")).toEqual(OPEN_IMAGE);
  });

  test("catches a new caller of either, in a file of the list and in one outside it", () => {
    const real = loadSources();
    // A second request in the purge's flow, and a first one in a file that had none.
    const withCallers = real
      .map((file) => (file.path === "account/flows/deletion.ts" ? { ...file, source: `${file.source}\nawait deps.media.requestDeletion(kept);` } : file))
      .concat([{ path: "moderation/retention.ts", source: "await deps.media.requestDeletion(ids);" }]);
    expect(mentions(withCallers, "requestDeletion")).not.toEqual(REQUEST_DELETION);
    expect(mentions(withCallers, "requestDeletion")).toMatchObject({ "account/flows/deletion.ts": 2, "moderation/retention.ts": 1 });
    // A fourth opener of the store's files.
    const withOpener = real.concat([{ path: "staff/cases.ts", source: 'const file = await files.openImage(id, "large");' }]);
    expect(mentions(withOpener, "openImage")).not.toEqual(OPEN_IMAGE);
    // A name that only contains the word is not counted.
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "requestDeletion")).toEqual({});
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "openImage")).toEqual({});
  });
});

describe("module boundaries", () => {
  test("walks the real source tree", () => {
    const paths = loadSources().map((f) => f.path);
    expect(paths).toContain("auth/index.ts");
    expect(paths).toContain("social/index.ts");
    expect(paths).toContain("media/index.ts");
    expect(paths).toContain("account/index.ts");
    expect(paths).toContain("staff/index.ts");
    expect(paths).toContain("moderation/index.ts");
    expect(paths).toContain("cli/staff.ts");
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
      { path: "index.ts", source: `import { createAccount } from "./account";\nimport { createMedia } from "./media";` },
      { path: "account/routes.ts", source: `import type { AuthForAccount } from "../auth";\nimport type { SocialForAccount } from "../social";\nimport { buildExport } from "./flows/export";` },
      { path: "account/flows/deletion.ts", source: `import type { DbTx } from "@korbat/db";\nimport type { MediaForAccount } from "../../media";` },
      { path: "cli/staff.ts", source: `import { createStaff } from "../staff";\nconst authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `import { auditHead, auditLog, profiles, type Db, type DbTx } from "@korbat/db";` },
      { path: "staff/routes.ts", source: `import { AuthError, type Auth } from "../auth";\nimport { staffGate } from "./gate";` },
      { path: "staff/cases.ts", source: `import { ModerationError, type ModerationForStaff } from "../moderation";` },
      { path: "index.ts", source: `import { createModeration } from "./moderation";\nimport { socialForModeration } from "./social";` },
      { path: "moderation/repo.ts", source: `import { cases, decisions, evidenceSnapshots, intakes, type Db, type DbTx } from "@korbat/db";\nimport { ModerationError } from "./context";` },
      { path: "moderation/decide.ts", source: `import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";\nimport { boundLockWaits } from "../lib/lock-bounds";\nimport type { SocialForModeration } from "../social";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts", "auditLog", "auditHead", "cases", "decisions", "evidenceSnapshots", "intakes"]), new Set(["users", "sessions"]))).toEqual([]);
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

  test("catches a deep import into the media module, post_media outside it, and the auth schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createMediaRepo } from "./media/repo";\nimport { createMedia } from "./media";` },
      { path: "social/repo.ts", source: `import { postMedia, posts } from "@korbat/db";` },
      { path: "social/views.ts", source: "const rows = await db.execute(sql`select * from post_media`);" },
      { path: "media/repo.ts", source: `import { postMedia, posts, users, type Db } from "@korbat/db";` },
      { path: "media/flows/serve.ts", source: `import type { MediaDeps } from "../context";` },
    ];
    expect(findViolations(files, new Set(["posts", "postMedia"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./media/repo, which is inside the media module (use ./media)",
      "social/repo.ts: references post_media, which only the media module may touch",
      "social/views.ts: references post_media, which only the media module may touch",
      "media/repo.ts: imports auth-schema users from @korbat/db",
    ]);
  });

  test("catches a deep import into the account module, and a table or enum of either schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createZipWriter } from "./account/zip";\nimport { createAccount } from "./account";` },
      { path: "social/flows/graph.ts", source: `import { buildExport } from "../../account/flows/export";` },
      { path: "account/flows/export.ts", source: `import { posts, users, type DbTx } from "@korbat/db";` },
      { path: "account/purge.ts", source: `import * as db from "@korbat/db";` },
      { path: "account/zip.ts", source: `import type { Db } from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./account/zip, which is inside the account module (use ./account)",
      "social/flows/graph.ts: imports ../../account/flows/export, which is inside the account module (use ./account)",
      "account/flows/export.ts: imports public-schema posts from @korbat/db (the account module holds no table access)",
      "account/flows/export.ts: imports auth-schema users from @korbat/db (the account module holds no table access)",
      "account/purge.ts: namespace import of @korbat/db (the account module holds no table access)",
    ]);
  });

  test("catches auth pool and auth key references outside their owners", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `const url = config.DATABASE_URL_AUTH;` },
      { path: "profiles/store.ts", source: `export function f(authDb: Db) {}` },
      { path: "lib/hash.ts", source: `const key = config.IP_HASH_KEY;` },
      { path: "index.ts", source: `const k = config.AUTH_HMAC_KEY;` },
      // The key a notifier's name and address are encrypted under is the auth module's too: the moderation module, which
      // names contacts by their ids, never sees it.
      { path: "moderation/intake.ts", source: `const key = deps.config.NOTIFIER_ENC_KEY;` },
      // The keys a key replaced are guarded as the key is: a contact is never encrypted again, so after a rotation they are
      // the only keys of every contact stored before it. The TOTP key's earlier keys likewise.
      { path: "moderation/context.ts", source: `const older = config.NOTIFIER_ENC_KEYS_PREVIOUS;` },
      { path: "staff/routes.ts", source: `const older = config.TOTP_ENC_KEYS_PREVIOUS;` },
      // A longer name that only contains a key's name is not the key; config.ts and the auth module may name every key.
      { path: "lib/names.ts", source: `const MY_NOTIFIER_ENC_KEY_NAME = 1; const NOTIFIER_ENC_KEYS = 2; const TOTP_ENC_KEYS_PREVIOUSLY = 3;` },
      { path: "config.ts", source: `NOTIFIER_ENC_KEY: versionedKey, NOTIFIER_ENC_KEYS_PREVIOUS: z.string(), TOTP_ENC_KEYS_PREVIOUS: z.string(),` },
      { path: "auth/context.ts", source: `notifierKey: parseVersionedKey(config.NOTIFIER_ENC_KEY), notifierPreviousKeys: config.NOTIFIER_ENC_KEYS_PREVIOUS.map(parseVersionedKey),` },
      // The staff command line may open the auth pool; another command line, or the staff module itself, may not.
      { path: "cli/other.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `export function readKeys(authDb: Db) {}` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: references the auth database pool",
      "profiles/store.ts: references the auth database pool",
      "lib/hash.ts: references an auth key",
      "index.ts: references an auth key",
      "moderation/intake.ts: references an auth key",
      "moderation/context.ts: references an auth key",
      "staff/routes.ts: references an auth key",
      "cli/other.ts: references the auth database pool",
      "staff/audit.ts: references the auth database pool",
    ]);
  });

  test("catches a deep import into the staff module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { staffGate } from "./staff/gate";\nimport { createStaff } from "./staff";` },
      { path: "cli/staff.ts", source: `import { canonicalText } from "../staff/chain";` },
      { path: "auth/staff/flows.ts", source: `import { appendAuditRow } from "../../staff/audit";` },
      { path: "staff/routes.ts", source: `import { staffGate } from "./gate";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./staff/gate, which is inside the staff module (use ./staff)",
      "cli/staff.ts: imports ../staff/chain, which is inside the staff module (use ./staff)",
      "auth/staff/flows.ts: imports ../../staff/audit, which is inside the staff module (use ./staff)",
    ]);
  });

  test("catches auth-schema imports inside the staff module", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { auditLog, staffKeys, type Db } from "@korbat/db";` },
      { path: "staff/reader.ts", source: `import type { staffSessions as s } from "@korbat/db";` },
      { path: "staff/writer.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["auditLog"]), new Set(["staffKeys", "staffSessions"]))).toEqual([
      "staff/audit.ts: imports auth-schema staffKeys from @korbat/db",
      "staff/reader.ts: imports auth-schema staffSessions from @korbat/db",
      "staff/writer.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });

  test("catches the auth module's repository or session store inside the staff module, however it is imported", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { AuthError, createAuthRepo } from "../auth";` },
      { path: "staff/routes.ts", source: `import { createSessions as sessionsOf } from "../auth";` },
      { path: "staff/flows/x.ts", source: `import * as auth from "../../auth";\nconst repo = auth.createAuthRepo(db);\nconst s = auth.createSessions(deps);` },
      { path: "staff/flows/y.ts", source: `const { createSessions } = await import("../../auth");` },
      // Outside the staff module the rule does not apply: the command lines build the auth module's parts themselves.
      { path: "cli/grant-role.ts", source: `import { createAuthRepo, createSessions } from "../auth";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "staff/audit.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/routes.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/y.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
    ]);
  });

  test("catches a deep import into the moderation module, from outside it and from another module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { decide } from "./moderation/decide";\nimport { createModeration } from "./moderation";` },
      { path: "staff/cases.ts", source: `import { ModerationError } from "../moderation/context";` },
      { path: "social/views.ts", source: `import { authorFacts } from "../moderation/repo";` },
      { path: "cli/staff.ts", source: `const { recordIntake } = await import("../moderation/intake");` },
      { path: "moderation/decide.ts", source: `import { ModerationError } from "./context";\nimport { insertDecision } from "./repo";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./moderation/decide, which is inside the moderation module (use ./moderation)",
      "staff/cases.ts: imports ../moderation/context, which is inside the moderation module (use ./moderation)",
      "social/views.ts: imports ../moderation/repo, which is inside the moderation module (use ./moderation)",
      "cli/staff.ts: imports ../moderation/intake, which is inside the moderation module (use ./moderation)",
    ]);
  });

  test("catches the moderation module reaching into another module, naming post_media, or opening the auth pool", () => {
    const files: SourceFile[] = [
      { path: "moderation/intake.ts", source: `import { createSocialRepo } from "../social/repo";` },
      { path: "moderation/decide.ts", source: `import { verifyStepUp } from "../auth/staff/step-up";` },
      { path: "moderation/repo.ts", source: `import { cases, postMedia, type Db } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: "const rows = await tx.execute(sql`select id from post_media where post_id = ${postId}`);" },
      { path: "moderation/context.ts", source: `export interface ModerationDeps { authDb: Db }` },
    ];
    expect(findViolations(files, new Set(["cases", "postMedia"]), new Set())).toEqual([
      "moderation/intake.ts: imports ../social/repo, which is inside the social module (use ./social)",
      "moderation/decide.ts: imports ../auth/staff/step-up, which is inside the auth module (use ./auth)",
      "moderation/repo.ts: references post_media, which only the media module may touch",
      "moderation/cases.ts: references post_media, which only the media module may touch",
      "moderation/context.ts: references the auth database pool",
    ]);
  });

  test("catches auth-schema imports inside the moderation module, and the auth module's repository or session store", () => {
    const files: SourceFile[] = [
      { path: "moderation/repo.ts", source: `import { decisions, notifierContacts, type Db } from "@korbat/db";` },
      { path: "moderation/decide.ts", source: `import type { staffPersonalAccounts as links, users } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: `import * as db from "@korbat/db";` },
      { path: "moderation/intake.ts", source: `import { createAuthRepo } from "../auth";` },
      { path: "moderation/reveal.ts", source: `const { createSessions } = await import("../auth");` },
    ];
    expect(findViolations(files, new Set(["decisions"]), new Set(["notifierContacts", "staffPersonalAccounts", "users"]))).toEqual([
      "moderation/repo.ts: imports auth-schema notifierContacts from @korbat/db",
      "moderation/decide.ts: imports auth-schema staffPersonalAccounts from @korbat/db",
      "moderation/decide.ts: imports auth-schema users from @korbat/db",
      "moderation/cases.ts: namespace import of @korbat/db (import public-schema names explicitly)",
      "moderation/intake.ts: uses the auth module's createAuthRepo (the moderation module goes through the auth module's interface)",
      "moderation/reveal.ts: uses the auth module's createSessions (the moderation module goes through the auth module's interface)",
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

### Replace `apps/api/test/auth/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { Platform } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type {
  ActiveSessionRow,
  AddPasskeyOutcome,
  AuthEventType,
  AuthRepo,
  DeviceRow,
  EmailCodeRow,
  LockDownInput,
  LockDownOutcome,
  NewPasskey,
  PasskeyLimits,
  PasskeyListRow,
  PasskeyRow,
  SessionListRow,
  UserRow,
} from "../../src/auth/repo";
import { createSessions, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, type Factors, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/**
 * A session of a user, as the deletion and lockdown flows revoke it and, since Task 5, as the sign-in and re-authentication
 * flows issue, resolve and rotate it. The first three fields are all those older flows read; the rest let findActiveSession
 * answer a full row.
 */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
  deviceId: string;
  handle: string;
  factors: Record<string, number>;
  passkeyId: string | null;
  reauthAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RecordedDevice {
  id: string;
  userId: string;
  revokedAt: Date | null;
  /** What the passkey flows read of the row: the platform for a passkey's default name and the label for the Security list. */
  platform: Platform;
  label: string | null;
  /** The keyed hash a sign-in looks a device up by; absent on the devices h.session and h.user seed, which no lookup finds. */
  deviceHash?: string;
}

/** A passkey of a user, as the registration writes it and the lockdown and the management flows read it. */
export type RecordedPasskey = PasskeyRow;

/**
 * The auth flows without a database: users, email codes, sessions, devices and passkeys live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge, deletion, not-me,
 * lockdown and TOTP confirmation flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
 * mailer are the in-memory ones; the clock moves only when a test says so, so expiries and timestamps
 * compare exactly; and events are kept as the server would write them to auth_events. The integration
 * harness (test/integration/flow-harness.ts) runs flows against the real repository instead.
 */
export function memoryFlowHarness(start = 1_789_000_000_000) {
  let t = start;
  const now = () => new Date(t);
  const users = new Map<string, UserRow>();
  const codes: EmailCodeRow[] = [];
  const events: RecordedEvent[] = [];
  const sessions: RecordedSession[] = [];
  const devices: RecordedDevice[] = [];
  const passkeys: RecordedPasskey[] = [];
  /**
   * When each event was recorded, at the harness clock, kept beside the events rather than on them: the tests compare
   * the events with the exact objects the flows write, and the daily passkey bound is the only reader of the times.
   */
  const eventTimes = new WeakMap<RecordedEvent, number>();
  const recordEvent = (event: RecordedEvent) => {
    events.push(event);
    eventTimes.set(event, t);
  };
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
  /** Repository methods told to fail: "takeDown" and "lockDown" each fail as a transaction that breaks off midway, after staging its writes and before any lands. */
  const faults = new Set<"takeDown" | "lockDown">();
  /** A device as the real row reads, from what the harness keeps of it; the hash and the times are placeholders no flow reads here. */
  const deviceRow = (device: RecordedDevice): DeviceRow => ({
    id: device.id,
    userId: device.userId,
    deviceHash: device.deviceHash ?? `hash-${device.id}`,
    label: device.label,
    platform: device.platform,
    firstSeenAt: now(),
    lastSeenAt: now(),
    ipHash: null,
    revokedAt: device.revokedAt,
  });
  /** A passkey with the label of the device that added it, as the real join answers it: null once that device is gone. */
  const withDevice = (passkey: RecordedPasskey): PasskeyListRow => ({ ...passkey, createdOn: devices.find((d) => d.id === passkey.createdDeviceId)?.label ?? null });
  /**
   * The daily bound's reading, as the real statement makes it: the times of the account's latest passkey_added events within
   * the window, at most `limit` of them, and the seconds until the oldest of those leaves the window.
   */
  const recentPasskeyAdditions = (userId: string, withinMs: number, limit: number) => {
    const recent = events
      .filter((e) => e.userId === userId && e.type === "passkey_added")
      .map((e) => eventTimes.get(e)!)
      .filter((at) => at > t - withinMs)
      .sort((a, b) => b - a)
      .slice(0, limit);
    const oldest = recent.at(-1);
    return { count: recent.length, retryAfterSeconds: oldest === undefined ? 0 : Math.ceil((oldest + withinMs - t) / 1000) };
  };
  /**
   * Step 1's rows for a user, as the real repository's takeDownRows writes them: live sessions revoked (their ids
   * returned), devices, codes and passkeys gone, and the WebAuthn user handle cleared (1c design, section 7.7).
   */
  const takeDownRows = (userId: string, at: Date): string[] => {
    const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
    for (const s of live) s.revokedAt = at;
    for (let i = devices.length - 1; i >= 0; i--) if (devices[i]!.userId === userId) devices.splice(i, 1);
    for (let i = codes.length - 1; i >= 0; i--) if (codes[i]!.userId === userId) codes.splice(i, 1);
    for (let i = passkeys.length - 1; i >= 0; i--) if (passkeys[i]!.userId === userId) passkeys.splice(i, 1);
    const row = users.get(userId);
    if (row) row.webauthnUserId = null;
    return live.map((s) => s.id);
  };
  const repo = {
    async findUserById(id: string): Promise<UserRow | undefined> {
      const row = users.get(id);
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      // As the real lookup: the address in any case, and never a deleted row.
      const row = [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      const row = users.get(userId);
      if (row) {
        row.failedLogins = failedLogins;
        row.lockedUntil = lockedUntil;
      }
    },
    async createEmailCode(input: Parameters<AuthRepo["createEmailCode"]>[0]): Promise<void> {
      codes.push({ id: randomUUID(), ...input, attempts: 0, consumedAt: null, createdAt: now() });
    },
    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const row = codes.find((c) => c.flowId === flowId);
      return row ? { ...row } : undefined;
    },
    async addCodeAttempt(id: string): Promise<number> {
      const row = codes.find((c) => c.id === id);
      if (!row) return Number.MAX_SAFE_INTEGER;
      row.attempts += 1;
      return row.attempts;
    },
    async consumeEmailCode(id: string, at: Date): Promise<boolean> {
      const row = codes.find((c) => c.id === id);
      if (!row || row.consumedAt !== null) return false;
      row.consumedAt = at;
      return true;
    },
    async changeEmail(userId: string, email: string, at: Date): Promise<void> {
      // As the real unique index on lower(email), deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      for (const other of users.values()) {
        if (other.id !== userId && other.email.toLowerCase() === email.toLowerCase()) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "users_email_lower_idx"'), { code: "23505" });
        }
      }
      const row = users.get(userId);
      if (!row) return;
      row.email = email;
      row.emailVerifiedAt = at;
    },
    async setPasswordHash(userId: string, passwordHash: string | null, at: Date): Promise<void> {
      // As the real statement: setting or clearing a password also clears any lockout, and records when.
      const row = users.get(userId);
      if (row) Object.assign(row, { passwordHash, passwordChangedAt: at, failedLogins: 0, lockedUntil: null });
    },
    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      // As the real statement: unconditional, whatever the row held, and the last accepted step starts over.
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash });
    },
    async disableTotp(userId: string): Promise<void> {
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    },
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("lockDown")) throw new Error("the lockdown transaction failed midway and was rolled back");
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = input.now;
      for (const device of devices) if (device.userId === userId && device.revokedAt === null) device.revokedAt = input.now;
      // As the real statement: the user's passkeys created at or after `since`, plus any of theirs the caller names.
      const passkeysRemoved: string[] = [];
      for (let i = passkeys.length - 1; i >= 0; i--) {
        const passkey = passkeys[i]!;
        if (passkey.userId !== userId) continue;
        if (passkey.createdAt.getTime() >= input.since.getTime() || input.passkeyIds.includes(passkey.id)) {
          passkeysRemoved.push(passkey.id);
          passkeys.splice(i, 1);
        }
      }
      const row = users.get(userId);
      // As the real read of the locked row: an account that is gone has no two-factor to clear.
      const totpCleared = row !== undefined && row.deletedAt === null && row.totpEnabledAt !== null && row.totpEnabledAt.getTime() >= input.since.getTime();
      if (row) {
        // The password as setPasswordHash clears it, and two-factor as disableTotp turns it off.
        Object.assign(row, { passwordHash: null, passwordChangedAt: input.now, failedLogins: 0, lockedUntil: null });
        if (totpCleared) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
      }
      recordEvent({ userId, type: input.event.type, deviceId: input.event.deviceId, metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true } });
      return { sessionIds: live.map((s) => s.id), passkeysRemoved, totpCleared };
    },
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      // As the real partial unique index on phone_hash, deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      if (phoneHash !== null) {
        for (const other of users.values()) {
          if (other.id !== userId && other.phoneHash === phoneHash) {
            throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_hash_idx"'), { code: "23505" });
          }
        }
      }
      const row = users.get(userId);
      if (row) row.phoneHash = phoneHash;
    },
    async appendEvent(input: Parameters<AuthRepo["appendEvent"]>[0]): Promise<void> {
      recordEvent({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.id === id);
      return device ? deviceRow(device) : undefined;
    },
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      // As the real compare-and-set: the first candidate sticks, every later call reads it back.
      const row = users.get(userId);
      if (!row || row.deletedAt !== null) return undefined;
      row.webauthnUserId ??= candidate;
      return row.webauthnUserId;
    },
    async countPasskeys(userId: string): Promise<number> {
      return passkeys.filter((p) => p.userId === userId).length;
    },
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      // Newest first, as the real statement orders them.
      return passkeys
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(withDevice);
    },
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      return passkey ? withDevice(passkey) : undefined;
    },
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(userId, withinMs, limit);
    },
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      // As the real transaction: the account locked, both bounds checked again, then the row and its event, or nothing.
      const row = users.get(input.userId);
      if (!row || row.deletedAt !== null) return { ok: false, reason: "gone" };
      if (passkeys.filter((p) => p.userId === input.userId).length >= limits.passkeys) return { ok: false, reason: "cap" };
      const additions = recentPasskeyAdditions(input.userId, limits.windowMs, limits.additions);
      if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
      // As the real unique index on credential_id: the driver error that the flow recognises through isUniqueViolation.
      if (passkeys.some((p) => p.credentialId === input.credentialId)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "passkeys_credential_idx"'), { code: "23505" });
      }
      const passkey: RecordedPasskey = { id: randomUUID(), lastUsedAt: null, suspectAt: null, ...input };
      passkeys.push(passkey);
      recordEvent({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey.id } });
      return { ok: true, passkey: { ...passkey } };
    },
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      if (!passkey) return false;
      passkey.name = name;
      return true;
    },
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const index = passkeys.findIndex((p) => p.id === id && p.userId === userId);
      if (index === -1) return undefined;
      const [removed] = passkeys.splice(index, 1);
      return { name: removed!.name };
    },
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      // As the real lookup: any account's, and the flow refuses a deleted owner through findUserById.
      const passkey = passkeys.find((p) => p.credentialId === credentialId);
      return passkey ? { ...passkey } : undefined;
    },
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const passkey = passkeys.find((p) => p.credentialId === credentialId && p.userId === userId);
      return passkey ? { ...passkey } : undefined;
    },
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, at: Date): Promise<boolean> {
      // As the real conditional update: a suspect passkey never matches, and the counter must move forward unless both are zero.
      const passkey = passkeys.find((p) => p.id === id);
      if (!passkey || passkey.suspectAt !== null) return false;
      if (!((newCounter === 0 && passkey.counter === 0) || newCounter > passkey.counter)) return false;
      passkey.counter = newCounter;
      passkey.lastUsedAt = at;
      passkey.backedUp = backedUp;
      return true;
    },
    async suspectPasskey(id: string, at: Date): Promise<void> {
      const passkey = passkeys.find((p) => p.id === id);
      if (passkey && passkey.suspectAt === null) passkey.suspectAt = at;
    },
    async findDevice(userId: string, deviceHashValue: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.userId === userId && d.deviceHash === deviceHashValue && d.revokedAt === null);
      return device ? deviceRow(device) : undefined;
    },
    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const device: RecordedDevice = { id: randomUUID(), userId: input.userId, revokedAt: null, platform: input.platform as Platform, label: input.label, deviceHash: input.deviceHash };
      devices.push(device);
      return deviceRow(device);
    },
    async touchDevice(): Promise<void> {
      // The row's last-seen and ip are placeholders no flow reads here, so touching it changes nothing observable.
    },
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      // As the real insert: the reauth time is the latest of the factors, and a fresh handle stands in for the column's default.
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      sessions.push({
        id: input.id,
        userId: input.userId,
        revokedAt: null,
        deviceId: input.deviceId,
        handle: randomUUID(),
        factors,
        passkeyId: input.passkeyId ?? null,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        createdAt: input.now,
        lastUsedAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },
    async findActiveSession(id: string, at: Date): Promise<ActiveSessionRow | undefined> {
      // As the real joins: the session, its account and its device must all be live.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at);
      if (!row) return undefined;
      const user = users.get(row.userId);
      if (!user || user.deletedAt !== null) return undefined;
      const device = devices.find((d) => d.id === row.deviceId && d.revokedAt === null);
      if (!device) return undefined;
      return {
        id: row.id,
        userId: row.userId,
        deviceId: row.deviceId,
        role: user.role,
        onboardedAt: user.onboardedAt,
        totpEnabledAt: user.totpEnabledAt,
        reauthAt: row.reauthAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        handle: row.handle,
        factors: row.factors,
        passkeyId: row.passkeyId,
      };
    },
    async rotateSession(id: string, newId: string): Promise<boolean> {
      // As the real statement: the primary key changes in place for a live row, and everything else stays.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null);
      if (!row) return false;
      row.id = newId;
      return true;
    },
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      // As the real statement: the kind's time is set or replaced and the reauth time follows it.
      const row = sessions.find((s) => s.id === id);
      if (!row) return;
      row.factors = { ...row.factors, [kind]: at.getTime() };
      row.reauthAt = at;
    },
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      // As the real conditional update: a step no later than the last accepted one is refused, so a code cannot be reused.
      const row = users.get(userId);
      if (!row || (row.totpLastStep !== null && row.totpLastStep >= step)) return false;
      row.totpLastStep = step;
      return true;
    },
    async revokeAllSessions(userId: string, at: Date): Promise<string[]> {
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = at;
      return live.map((s) => s.id);
    },
    async listActiveSessions(userId: string, at: Date): Promise<SessionListRow[]> {
      // As the real statement: the user's sessions that are neither revoked nor expired, most recently used first, each with its device's label.
      return sessions
        .filter((s) => s.userId === userId && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at)
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
        .map((s) => {
          const device = devices.find((d) => d.id === s.deviceId);
          return { id: s.id, handle: s.handle, deviceLabel: device?.label ?? null, platform: device?.platform ?? "web", createdAt: s.createdAt, lastUsedAt: s.lastUsedAt };
        });
    },
    async markDeleted(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
    },
    async takeDown(userId: string, at: Date, deviceId: string | null): Promise<string[]> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("takeDown")) throw new Error("the take-down transaction failed midway and was rolled back");
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
      const revoked = takeDownRows(userId, at);
      recordEvent({ userId, type: "account_deleted", deviceId, metadata: {} });
      return revoked;
    },
    async finishTakeDown(userId: string, at: Date): Promise<string[]> {
      // As the real statement: only a row marked deleted and not purged yet.
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return [];
      return takeDownRows(userId, at);
    },
    async finishPurge(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return;
      Object.assign(row, {
        email: `deleted:${userId}`,
        emailVerifiedAt: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        phoneHash: null,
        ageConfirmedAt: null,
        termsVersion: null,
        termsAcceptedAt: null,
        purgedAt: at,
      });
    },
  } satisfies Pick<
    AuthRepo,
    | "findUserById"
    | "findUserByEmail"
    | "setPasswordFailures"
    | "createEmailCode"
    | "findEmailCode"
    | "addCodeAttempt"
    | "consumeEmailCode"
    | "changeEmail"
    | "setPasswordHash"
    | "enableTotp"
    | "disableTotp"
    | "lockDown"
    | "setPhoneHash"
    | "appendEvent"
    | "findDeviceById"
    | "ensureWebauthnUserId"
    | "countPasskeys"
    | "listPasskeys"
    | "findPasskey"
    | "recentPasskeyAdditions"
    | "addPasskey"
    | "renamePasskey"
    | "deletePasskey"
    | "findPasskeyByCredentialId"
    | "findPasskeyByCredential"
    | "claimPasskeyUse"
    | "suspectPasskey"
    | "findDevice"
    | "createDevice"
    | "touchDevice"
    | "createSession"
    | "findActiveSession"
    | "rotateSession"
    | "writeFactor"
    | "claimTotpStep"
    | "revokeAllSessions"
    | "listActiveSessions"
    | "markDeleted"
    | "takeDown"
    | "finishTakeDown"
    | "finishPurge"
  >;
  const authRepo = repo as unknown as AuthRepo;
  const kv = new MemoryKv(() => t);
  const mailer = new MemoryMailer();
  /** profiles.verified_at by account, as the badge flows set and clear it through the profile store. */
  const verified = new Map<string, Date | null>();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    notifierKey: parseVersionedKey(`v1:${Buffer.alloc(32, 6).toString("base64")}`),
    notifierPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
    // The staff console is off: no flow this harness runs reaches it.
    console: null,
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs create no profile; the badge flows only set and clear verified_at, kept above by
    // account, and the deletion flow reads the handle, kept by account as `user` registers it. No flow here changes the
    // Explore switch, which reads as the column's default.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async (id) => {
        const handle = handles.get(id);
        return handle === undefined ? null : { id, handle, displayName: handle, handleChangedAt: null, verified: (verified.get(id) ?? null) !== null, showInExplore: true };
      },
      setVerified: async (id, at) => {
        verified.set(id, at);
      },
    },
    // The development provider, which accepts exactly 000000; a test swaps it for null or a scripted one.
    verify: devProvider(),
    config,
    log: pino({ level: "silent" }),
    now,
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: undefined };
  /**
   * A live session on a device of its own, both recorded as the deletion flow will find them. It proved an email code
   * just now unless given other factors, as a session behind requireFreshAuth has, and started from no passkey unless told so.
   * The device is a web browser labelled as the sign-in labels one, unless the test says otherwise.
   */
  const session = (userId: string, options: { factors?: Factors; passkeyId?: string | null; platform?: Platform; label?: string | null } = {}): Session => {
    const s: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: now(),
      handle: randomUUID(),
      factors: options.factors ?? { email: t },
      passkeyId: options.passkeyId ?? null,
    };
    sessions.push({
      id: s.sessionId,
      userId,
      revokedAt: null,
      deviceId: s.deviceId,
      handle: s.handle,
      factors: s.factors,
      passkeyId: s.passkeyId,
      reauthAt: s.reauthAt,
      createdAt: now(),
      lastUsedAt: now(),
      expiresAt: new Date(t + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t + SESSION_ABSOLUTE_MS),
    });
    devices.push({ id: s.deviceId, userId, revokedAt: null, platform: options.platform ?? "web", label: options.label === undefined ? "Chrome on Windows" : options.label });
    return s;
  };
  return {
    deps,
    kv,
    mailer,
    ctx,
    users,
    codes,
    events,
    sessions,
    devices,
    passkeys,
    verified,
    faults,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
    /**
     * A passkey of an existing account, created at `createdAt` (now unless given) with the row's defaults (a plain,
     * unnamed synced key added from no device) unless overridden; answers its id.
     */
    passkey(userId: string, createdAt: Date = now(), overrides: Partial<Omit<RecordedPasskey, "id" | "userId" | "createdAt">> = {}): string {
      const id = randomUUID();
      passkeys.push({
        id,
        userId,
        createdAt,
        credentialId: randomToken(),
        publicKey: "cose-key",
        counter: 0,
        transports: [],
        backedUp: false,
        name: "Passkey",
        lastUsedAt: null,
        aaguid: null,
        backupEligible: false,
        uvInitialized: false,
        createdDeviceId: null,
        suspectAt: null,
        ...overrides,
      });
      return id;
    },
    /**
     * An onboarded account holding a verified address, with a session that just proved a credential, as a route
     * behind requireFreshAuth passes it on. Its profile's handle is the address's local part unless given.
     */
    user(email: string, handle: string = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "_")): { user: UserRow; session: Session } {
      const id = randomUUID();
      const user: UserRow = {
        id,
        email,
        emailVerifiedAt: now(),
        phoneHash: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now(),
        deletedAt: null,
        role: "user",
        ageConfirmedAt: now(),
        termsVersion: TEST_TERMS,
        termsAcceptedAt: now(),
        onboardedAt: now(),
        passwordChangedAt: null,
        totpLastStep: null,
        purgedAt: null,
        webauthnUserId: null,
      };
      users.set(id, user);
      handles.set(id, handle);
      return { user, session: session(id) };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
```

### Replace `apps/api/test/auth/identifiers.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { deviceHash, emailHash, ipHash, netHash, phoneHash } from "../../src/auth/identifiers";

const key = Buffer.alloc(32, 1);

describe("identifier hashes", () => {
  test("are keyed, namespaced and stable", () => {
    expect(deviceHash(key, "abc")).toBe(deviceHash(key, "abc"));
    expect(deviceHash(key, "abc")).not.toBe(ipHash(key, "abc"));
    expect(deviceHash(Buffer.alloc(32, 2), "abc")).not.toBe(deviceHash(key, "abc"));
    expect(ipHash(key, "203.0.113.9")).toMatch(/^[0-9a-f]{64}$/);
  });
  test("email hashes ignore case and surrounding whitespace", () => {
    expect(emailHash(key, " Ada@Example.COM ")).toBe(emailHash(key, "ada@example.com"));
  });
  test("phone hashes are keyed and in a namespace of their own", () => {
    expect(phoneHash(key, "+447911123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash(key, "+447911123456")).toBe(phoneHash(key, "+447911123456"));
    expect(phoneHash(key, "+447911123456")).not.toBe(emailHash(key, "+447911123456"));
    expect(phoneHash(Buffer.alloc(32, 2), "+447911123456")).not.toBe(phoneHash(key, "+447911123456"));
  });
  test("a network's hash is keyed and in a namespace of its own: an IPv4 address, which is its own network, hashes otherwise as a network than as an address", () => {
    expect(netHash(key, "203.0.113.9")).toMatch(/^[0-9a-f]{64}$/);
    expect(netHash(key, "203.0.113.9")).toBe(netHash(key, "203.0.113.9"));
    expect(netHash(key, "203.0.113.9")).not.toBe(ipHash(key, "203.0.113.9"));
    expect(netHash(key, "2001:db8:1:2::/64")).not.toBe(netHash(key, "2001:db8:1:3::/64"));
    expect(netHash(Buffer.alloc(32, 2), "203.0.113.9")).not.toBe(netHash(key, "203.0.113.9"));
  });
});
```

### Replace `apps/api/test/auth/verify-config.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { verificationProviderFrom } from "../../src/auth";
import { DEV_CODE } from "../../src/auth/verify/dev";
import { loadConfig } from "../../src/config";

const key = Buffer.alloc(32, 7).toString("base64");

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  NOTIFIER_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
};

describe("the verification provider VERIFY_PROVIDER names", () => {
  test("off, the default, is no provider, so the badge routes answer badge_unavailable", () => {
    expect(verificationProviderFrom(loadConfig(good))).toBeNull();
    expect(verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "off" }))).toBeNull();
  });

  test("dev is the fixed-code provider", async () => {
    const provider = verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "dev" }))!;
    const { reference } = await provider.start("+447911123456");
    expect(reference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await provider.check(reference, DEV_CODE)).toBe("verified");
    expect(await provider.check(reference, "123456")).toBe("invalid_code");
  });

  test("vonage needs both credentials, in development too, and sends them with the brand", async () => {
    expect(() => verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "vonage" }))).toThrow(/VONAGE_API_KEY and VONAGE_API_SECRET/);
    expect(() => verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234" }))).toThrow(/VONAGE_API_KEY and VONAGE_API_SECRET/);
    const calls: { url: string; authorization: string | null; body: string }[] = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), body: String(init?.body) });
      return Response.json({ request_id: "ref-1" }, { status: 201 });
    }) as typeof fetch;
    const config = loadConfig({ ...good, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret", VERIFY_BRAND: "My korbat" });
    const provider = verificationProviderFrom(config, fetchFn)!;
    expect(await provider.start("+447911123456")).toEqual({ reference: "ref-1" });
    expect(calls).toEqual([
      {
        url: "https://api.nexmo.com/v2/verify",
        authorization: `Basic ${Buffer.from("abcd1234:s3cret").toString("base64")}`,
        body: JSON.stringify({ brand: "My korbat", workflow: [{ channel: "sms", to: "+447911123456" }], code_length: 6 }),
      },
    ]);
  });
});
```

### Replace `apps/api/test/config.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { authConfigFrom } from "../src/auth/context";
import { loadConfig } from "../src/config";

const key = Buffer.alloc(32, 7).toString("base64");

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  NOTIFIER_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
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
  test("rejects keys shorter than 32 bytes", () => {
    expect(() => loadConfig({ ...good, AUTH_HMAC_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/AUTH_HMAC_KEY/);
  });
  test("TOTP key must be versioned and exactly 32 bytes", () => {
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: key })).toThrow(/TOTP_ENC_KEY/);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: `v1:${Buffer.alloc(33).toString("base64")}` })).toThrow(/TOTP_ENC_KEY/);
  });
  test("the notifier key must be versioned and exactly 32 bytes, as the TOTP key is", () => {
    expect(loadConfig(good).NOTIFIER_ENC_KEY).toBe(`v1:${key}`);
    expect(() => loadConfig({ ...good, NOTIFIER_ENC_KEY: key })).toThrow(/NOTIFIER_ENC_KEY/);
    expect(() => loadConfig({ ...good, NOTIFIER_ENC_KEY: `v1:${Buffer.alloc(33).toString("base64")}` })).toThrow(/NOTIFIER_ENC_KEY/);
    expect(() => loadConfig({ ...good, NOTIFIER_ENC_KEY: "" })).toThrow(/NOTIFIER_ENC_KEY/);
  });
  test("previous notifier keys are optional, comma-separated and each versioned", () => {
    expect(loadConfig(good).NOTIFIER_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, NOTIFIER_ENC_KEYS_PREVIOUS: "" }).NOTIFIER_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, NOTIFIER_ENC_KEYS_PREVIOUS: `v0:${key}, v1:${key}` }).NOTIFIER_ENC_KEYS_PREVIOUS).toEqual([`v0:${key}`, `v1:${key}`]);
    expect(() => loadConfig({ ...good, NOTIFIER_ENC_KEYS_PREVIOUS: key })).toThrow(/NOTIFIER_ENC_KEYS_PREVIOUS/);
  });
  test("the auth configuration holds the notifier key and the keys it replaced, parsed", () => {
    const older = Buffer.alloc(32, 9).toString("base64");
    const auth = authConfigFrom(loadConfig({ ...good, NOTIFIER_ENC_KEY: `v2:${key}`, NOTIFIER_ENC_KEYS_PREVIOUS: `v1:${older}` }));
    expect(auth.notifierKey).toEqual({ version: "v2", key: Buffer.alloc(32, 7) });
    expect(auth.notifierPreviousKeys).toEqual([{ version: "v1", key: Buffer.alloc(32, 9) }]);
    expect(authConfigFrom(loadConfig(good)).notifierPreviousKeys).toEqual([]);
  });
  describe("the moderation settings", () => {
    test("MODERATION_DISPATCH_HOUR is an hour of the UTC day, 7 unless set; a blank value is the default", () => {
      expect(loadConfig(good).MODERATION_DISPATCH_HOUR).toBe(7);
      for (const blank of ["", "   "]) expect(loadConfig({ ...good, MODERATION_DISPATCH_HOUR: blank }).MODERATION_DISPATCH_HOUR, JSON.stringify(blank)).toBe(7);
      for (const [written, hour] of [["0", 0], ["7", 7], ["23", 23], [" 12 ", 12]] as const) {
        expect(loadConfig({ ...good, MODERATION_DISPATCH_HOUR: written }).MODERATION_DISPATCH_HOUR, written).toBe(hour);
      }
      for (const refused of ["24", "-1", "7.5", "yes"]) {
        expect(() => loadConfig({ ...good, MODERATION_DISPATCH_HOUR: refused }), refused).toThrow(/MODERATION_DISPATCH_HOUR/);
      }
    });
    test("MODERATION_DEFER_UNPROVEN is off unless set to on; a blank value is the default and nothing else is taken", () => {
      expect(loadConfig(good).MODERATION_DEFER_UNPROVEN).toBe("off");
      expect(loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: "" }).MODERATION_DEFER_UNPROVEN).toBe("off");
      expect(loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: " " }).MODERATION_DEFER_UNPROVEN).toBe("off");
      expect(loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: "on" }).MODERATION_DEFER_UNPROVEN).toBe("on");
      expect(loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: "off" }).MODERATION_DEFER_UNPROVEN).toBe("off");
      for (const refused of ["yes", "true", "1", "ON"]) {
        expect(() => loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: refused }), refused).toThrow(/MODERATION_DEFER_UNPROVEN/);
      }
    });
  });
  test("SMTP_URL must be smtp or smtps", () => {
    expect(() => loadConfig({ ...good, SMTP_URL: "http://relay.example" })).toThrow(/SMTP_URL/);
    expect(loadConfig({ ...good, SMTP_URL: "smtps://user:pass@relay.example:465" }).SMTP_URL).toMatch(/^smtps:/);
  });
  test("every auth variable is required", () => {
    for (const name of ["APP_ORIGIN", "AUTH_HMAC_KEY", "IP_HASH_KEY", "TOTP_ENC_KEY", "NOTIFIER_ENC_KEY", "TURNSTILE_SECRET_KEY", "SMTP_URL", "MAIL_FROM", "TERMS_VERSION"]) {
      const env: Record<string, string | undefined> = { ...good };
      delete env[name];
      expect(() => loadConfig(env), name).toThrow(new RegExp(name));
    }
  });
  test("TRUST_PROXY defaults to none and accepts the three modes", () => {
    expect(loadConfig(good).TRUST_PROXY).toBe("none");
    for (const mode of ["cloudflare", "caddy", "none"]) expect(loadConfig({ ...good, TRUST_PROXY: mode }).TRUST_PROXY).toBe(mode);
    expect(() => loadConfig({ ...good, TRUST_PROXY: "nginx" })).toThrow(/TRUST_PROXY/);
  });
  describe("production refuses development values", () => {
    const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
    test("accepts a production configuration", () => {
      expect(loadConfig(prod).NODE_ENV).toBe("production");
    });
    test("refuses Cloudflare's test secrets", () => {
      for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
        expect(() => loadConfig({ ...prod, TURNSTILE_SECRET_KEY: secret }), secret).toThrow(/TURNSTILE_SECRET_KEY/);
      }
    });
    test("requires https for the app origin and every trusted origin", () => {
      expect(() => loadConfig({ ...prod, APP_ORIGIN: "http://korbat.example" })).toThrow(/APP_ORIGIN/);
      expect(() => loadConfig({ ...prod, TRUSTED_ORIGINS: "https://a.example, http://b.example" })).toThrow(/TRUSTED_ORIGINS/);
    });
    test("development keeps accepting them", () => {
      expect(loadConfig(good).TURNSTILE_SECRET_KEY).toBe("1x0000000000000000000000000000000AA");
    });
  });
  test("previous TOTP keys are optional, comma-separated and each versioned", () => {
    expect(loadConfig(good).TOTP_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: `v0:${key}, v1:${key}` }).TOTP_ENC_KEYS_PREVIOUS).toEqual([`v0:${key}`, `v1:${key}`]);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: key })).toThrow(/TOTP_ENC_KEYS_PREVIOUS/);
  });
  test("media settings default to the development directories, every format and a 2 GiB free-space floor", () => {
    const c = loadConfig(good);
    expect(c.MEDIA_UPLOADS_DIR).toBe("../../.data/media/uploads");
    expect(c.MEDIA_STORE_DIR).toBe("../../.data/media/store");
    expect(c.MEDIA_FORMATS).toEqual(["jpeg", "png", "webp", "gif", "avif"]);
    expect(c.MEDIA_MIN_FREE_BYTES).toBe(2_147_483_648);
  });
  test("MEDIA_RECONCILE is on by default and takes off or force", () => {
    expect(loadConfig(good).MEDIA_RECONCILE).toBe("on");
    expect(loadConfig({ ...good, MEDIA_RECONCILE: "force" }).MEDIA_RECONCILE).toBe("force");
    expect(() => loadConfig({ ...good, MEDIA_RECONCILE: "maybe" })).toThrow(/MEDIA_RECONCILE/);
  });
  test("MEDIA_FORMATS enables a subset, and a typo stops the process instead of changing what is accepted", () => {
    expect(loadConfig({ ...good, MEDIA_FORMATS: "png, jpeg" }).MEDIA_FORMATS).toEqual(["jpeg", "png"]);
    expect(() => loadConfig({ ...good, MEDIA_FORMATS: "jpeg,tiff" })).toThrow(/unknown formats: tiff/);
    expect(loadConfig({ ...good, MEDIA_MIN_FREE_BYTES: "0", MEDIA_STORE_DIR: "/media/store" })).toMatchObject({ MEDIA_MIN_FREE_BYTES: 0, MEDIA_STORE_DIR: "/media/store" });
  });
  describe("the verification provider behind the badge", () => {
    test("is off by default, with the brand korbat and no Vonage credentials", () => {
      const c = loadConfig(good);
      expect(c.VERIFY_PROVIDER).toBe("off");
      expect(c.VERIFY_BRAND).toBe("korbat");
      expect(c.VONAGE_API_KEY).toBeUndefined();
      expect(c.VONAGE_API_SECRET).toBeUndefined();
    });
    test("is off, dev or vonage", () => {
      for (const provider of ["off", "dev", "vonage"]) expect(loadConfig({ ...good, VERIFY_PROVIDER: provider }).VERIFY_PROVIDER).toBe(provider);
      expect(() => loadConfig({ ...good, VERIFY_PROVIDER: "twilio" })).toThrow(/VERIFY_PROVIDER/);
      expect(loadConfig({ ...good, VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" })).toMatchObject({ VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" });
    });
    test("the brand is 1 to 18 characters without the characters Vonage refuses", () => {
      expect(loadConfig({ ...good, VERIFY_BRAND: "x".repeat(18) }).VERIFY_BRAND).toBe("x".repeat(18));
      expect(loadConfig({ ...good, VERIFY_BRAND: "My korbat 1" }).VERIFY_BRAND).toBe("My korbat 1");
      for (const brand of ["", "x".repeat(19), "kor/bat", "{korbat}", "kor:bat", "$korbat"]) {
        expect(() => loadConfig({ ...good, VERIFY_BRAND: brand }), JSON.stringify(brand)).toThrow(/VERIFY_BRAND/);
      }
    });
    describe("in production", () => {
      const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
      test("the development provider is refused, like the Turnstile test secret", () => {
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "dev" })).toThrow(/VERIFY_PROVIDER=dev is for development only/);
        expect(loadConfig({ ...good, VERIFY_PROVIDER: "dev" }).VERIFY_PROVIDER).toBe("dev");
      });
      test("vonage needs both the key and the secret; off needs nothing", () => {
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage" })).toThrow(/VONAGE_API_KEY/);
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234" })).toThrow(/VONAGE_API_SECRET/);
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_SECRET: "s3cret" })).toThrow(/VONAGE_API_KEY/);
        expect(loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" }).VERIFY_PROVIDER).toBe("vonage");
        expect(loadConfig({ ...prod, VERIFY_PROVIDER: "off" }).VERIFY_PROVIDER).toBe("off");
      });
    });
  });
  describe("the WebAuthn relying party", () => {
    test("defaults to the host of APP_ORIGIN and the name korbat; an empty value, as compose passes it, counts as unset", () => {
      expect(loadConfig(good)).toMatchObject({ WEBAUTHN_RP_ID: "localhost", WEBAUTHN_RP_NAME: "korbat" });
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "", WEBAUTHN_RP_NAME: "" })).toMatchObject({ WEBAUTHN_RP_ID: "localhost", WEBAUTHN_RP_NAME: "korbat" });
      expect(loadConfig({ ...good, APP_ORIGIN: "http://127.0.0.1:8380" }).WEBAUTHN_RP_ID).toBe("127.0.0.1");
    });
    test("takes an explicit RP ID in lowercase, and only a bare domain name", () => {
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "Korbat.Example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "localhost" }).WEBAUTHN_RP_ID).toBe("localhost");
      for (const rpId of ["https://korbat.example", "korbat.example:443", "korbat.example/path", "-korbat.example", "korbat..example", "korbat.example.", "kor bat.example", `${"a".repeat(64)}.example`]) {
        expect(() => loadConfig({ ...good, WEBAUTHN_RP_ID: rpId }), rpId).toThrow(/WEBAUTHN_RP_ID/);
      }
    });
    test("the name is 1 to 64 printable characters", () => {
      expect(loadConfig({ ...good, WEBAUTHN_RP_NAME: "My korbat" }).WEBAUTHN_RP_NAME).toBe("My korbat");
      expect(loadConfig({ ...good, WEBAUTHN_RP_NAME: "x".repeat(64) }).WEBAUTHN_RP_NAME).toBe("x".repeat(64));
      // A control character, a tab, and U+202E (the invisible right-to-left override).
      for (const name of ["x".repeat(65), `kor${String.fromCharCode(7)}bat`, `kor${String.fromCharCode(9)}bat`, `kor${String.fromCharCode(0x202e)}bat`]) {
        expect(() => loadConfig({ ...good, WEBAUTHN_RP_NAME: name }), JSON.stringify(name)).toThrow(/WEBAUTHN_RP_NAME/);
      }
    });
    test("the auth configuration exposes it, with APP_ORIGIN and TRUSTED_ORIGINS as the expected origins outside production", () => {
      expect(authConfigFrom(loadConfig({ ...good, TRUSTED_ORIGINS: "http://localhost:19006" })).webauthn).toEqual({
        rpId: "localhost",
        rpName: "korbat",
        origins: ["http://localhost:8081", "http://localhost:19006"],
      });
      expect(authConfigFrom(loadConfig({ ...good, WEBAUTHN_RP_NAME: "My korbat" })).webauthn).toEqual({ rpId: "localhost", rpName: "My korbat", origins: ["http://localhost:8081"] });
    });
    describe("in production", () => {
      const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
      test("the expected origin is APP_ORIGIN alone", () => {
        expect(authConfigFrom(loadConfig({ ...prod, TRUSTED_ORIGINS: "https://admin.korbat.example" })).webauthn).toEqual({
          rpId: "korbat.example",
          rpName: "korbat",
          origins: ["https://korbat.example"],
        });
      });
      test("the RP ID may be the host of APP_ORIGIN", () => {
        expect(loadConfig(prod).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(loadConfig({ ...prod, WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
      });
      test("or a parent domain of that host, when it has a dot", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        expect(loadConfig({ ...app, WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(loadConfig({ ...prod, APP_ORIGIN: "https://a.b.korbat.example", WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(() => loadConfig({ ...app, WEBAUTHN_RP_ID: "example" })).toThrow(/WEBAUTHN_RP_ID must be the host of APP_ORIGIN/);
      });
      test("any other domain is refused: another site, a child of the host, or a suffix that is not a parent", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        for (const rpId of ["other.example", "sub.app.korbat.example", "pp.korbat.example", "korbat.example.net"]) {
          expect(() => loadConfig({ ...app, WEBAUTHN_RP_ID: rpId }), rpId).toThrow(/WEBAUTHN_RP_ID must be the host of APP_ORIGIN/);
        }
      });
      test("never an IP address or localhost", () => {
        for (const origin of ["https://203.0.113.7", "https://[2001:db8::1]", "https://localhost", "https://app.localhost"]) {
          expect(() => loadConfig({ ...prod, APP_ORIGIN: origin }), origin).toThrow(/WEBAUTHN_RP_ID/);
        }
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://203.0.113.7", WEBAUTHN_RP_ID: "203.0.113.7" })).toThrow(/WEBAUTHN_RP_ID cannot be an IP address/);
        // A parent of an address is no domain either.
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://10.0.0.1", WEBAUTHN_RP_ID: "0.0.1" })).toThrow(/WEBAUTHN_RP_ID cannot be an IP address/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://localhost", WEBAUTHN_RP_ID: "localhost" })).toThrow(/WEBAUTHN_RP_ID cannot be localhost/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://app.localhost", WEBAUTHN_RP_ID: "localhost" })).toThrow(/WEBAUTHN_RP_ID cannot be localhost/);
      });
      test("development accepts all of them, since browsers treat localhost as secure", () => {
        expect(loadConfig({ ...good, APP_ORIGIN: "http://localhost:8081", WEBAUTHN_RP_ID: "localhost" }).WEBAUTHN_RP_ID).toBe("localhost");
        expect(loadConfig({ ...good, APP_ORIGIN: "http://app.localhost:8081", WEBAUTHN_RP_ID: "other.example" }).WEBAUTHN_RP_ID).toBe("other.example");
      });
    });
  });
  describe("the staff console (3a design, section 8)", () => {
    const consoleOrigin = "http://localhost:8090";
    test("is off unless CONSOLE_ORIGIN is set; a blank value, as compose passes it, counts as unset", () => {
      for (const blank of [undefined, "", "   "]) {
        const c = loadConfig({ ...good, CONSOLE_ORIGIN: blank, CONSOLE_RP_ID: blank });
        expect(c.CONSOLE_ORIGIN, JSON.stringify(blank)).toBeUndefined();
        expect(c.CONSOLE_RP_ID, JSON.stringify(blank)).toBeUndefined();
      }
    });
    test("takes the console's origin, and its relying party ID defaults to the console's hostname", () => {
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin })).toMatchObject({ CONSOLE_ORIGIN: consoleOrigin, CONSOLE_RP_ID: "localhost" });
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: " http://console.localhost:8090 ", CONSOLE_RP_ID: "" })).toMatchObject({
        CONSOLE_ORIGIN: "http://console.localhost:8090",
        CONSOLE_RP_ID: "console.localhost",
      });
      // The app's relying party is untouched by the console's.
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: "http://console.localhost:8090" }).WEBAUTHN_RP_ID).toBe("localhost");
    });
    test("takes an explicit relying party ID in lowercase, and only a bare domain name", () => {
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: "http://console.localhost:8090", CONSOLE_RP_ID: "Console.Localhost" }).CONSOLE_RP_ID).toBe("console.localhost");
      for (const rpId of ["http://console.localhost", "console.localhost:8090", "console.localhost/", "-console.localhost", "console..localhost"]) {
        expect(() => loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin, CONSOLE_RP_ID: rpId }), rpId).toThrow(/CONSOLE_RP_ID/);
      }
    });
    test("must be an origin exactly as a browser sends it: http or https, a host, a port only when it is not the default", () => {
      // The staff gate compares the Origin header with this value as a string.
      for (const origin of ["localhost:8090", "ftp://localhost:8090", "http://localhost:8090/", "http://localhost:8090/console", "http://localhost:8090?x=1", "http://user@localhost:8090", "https://console.example:443", "http://Console.Localhost:8090"]) {
        expect(() => loadConfig({ ...good, CONSOLE_ORIGIN: origin }), origin).toThrow(/CONSOLE_ORIGIN/);
      }
    });
    test("is refused in every environment when it is the app's origin or one of the trusted origins", () => {
      expect(() => loadConfig({ ...good, CONSOLE_ORIGIN: good.APP_ORIGIN })).toThrow(/CONSOLE_ORIGIN must not be APP_ORIGIN/);
      // The same origin written with a final slash is still the same origin.
      expect(() => loadConfig({ ...good, APP_ORIGIN: "http://localhost:8090/", CONSOLE_ORIGIN: consoleOrigin })).toThrow(/CONSOLE_ORIGIN must not be APP_ORIGIN/);
      expect(() => loadConfig({ ...good, TRUSTED_ORIGINS: `http://localhost:19006, ${consoleOrigin}`, CONSOLE_ORIGIN: consoleOrigin })).toThrow(/CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS/);
      expect(() => loadConfig({ ...good, TRUSTED_ORIGINS: `${consoleOrigin}/`, CONSOLE_ORIGIN: consoleOrigin })).toThrow(/CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS/);
      expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://localhost:19006", CONSOLE_ORIGIN: consoleOrigin }).CONSOLE_ORIGIN).toBe(consoleOrigin);
    });
    describe("in production", () => {
      const prod = {
        ...good,
        NODE_ENV: "production",
        APP_ORIGIN: "https://korbat.example",
        TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret",
        CONSOLE_ORIGIN: "https://staff-korbat.example",
      };
      test("accepts a console on a domain of its own or on a subdomain of the app's, with its hostname as the relying party ID", () => {
        expect(loadConfig(prod)).toMatchObject({ CONSOLE_ORIGIN: "https://staff-korbat.example", CONSOLE_RP_ID: "staff-korbat.example", WEBAUTHN_RP_ID: "korbat.example" });
        expect(loadConfig({ ...prod, CONSOLE_ORIGIN: "https://console.korbat.example", CONSOLE_RP_ID: "console.korbat.example" }).CONSOLE_RP_ID).toBe("console.korbat.example");
        // A name that merely ends like the app's is not a parent of it.
        expect(loadConfig({ ...prod, APP_ORIGIN: "https://mykorbat.example", CONSOLE_ORIGIN: "https://korbat.example" }).CONSOLE_RP_ID).toBe("korbat.example");
      });
      test("the console is still off when CONSOLE_ORIGIN is unset", () => {
        const c = loadConfig({ ...prod, CONSOLE_ORIGIN: "" });
        expect(c.CONSOLE_ORIGIN).toBeUndefined();
        expect(c.CONSOLE_RP_ID).toBeUndefined();
      });
      test("requires https", () => {
        expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: "http://staff-korbat.example" })).toThrow(/CONSOLE_ORIGIN must be an https origin in production/);
      });
      test("refuses the app's origin and the trusted origins, as everywhere", () => {
        expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: "https://korbat.example" })).toThrow(/CONSOLE_ORIGIN must not be APP_ORIGIN/);
        expect(() => loadConfig({ ...prod, TRUSTED_ORIGINS: "https://staff-korbat.example" })).toThrow(/CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS/);
      });
      test("refuses the app's hostname with another port, since ports separate neither sites nor cookies", () => {
        expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: "https://korbat.example:8443" })).toThrow(/CONSOLE_ORIGIN must not be on the hostname of APP_ORIGIN/);
      });
      test("refuses a console on a parent domain of the app's hostname", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        expect(() => loadConfig({ ...app, CONSOLE_ORIGIN: "https://korbat.example" })).toThrow(/APP_ORIGIN's hostname must not be a subdomain of the console's/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://a.b.korbat.example", CONSOLE_ORIGIN: "https://b.korbat.example" })).toThrow(/must not be a subdomain of the console's/);
      });
      test("the relying party ID must be the console's hostname, never a parent domain of it", () => {
        const sub = { ...prod, CONSOLE_ORIGIN: "https://console.korbat-staff.example" };
        expect(loadConfig({ ...sub, CONSOLE_RP_ID: "console.korbat-staff.example" }).CONSOLE_RP_ID).toBe("console.korbat-staff.example");
        for (const rpId of ["korbat-staff.example", "other.example", "sub.console.korbat-staff.example"]) {
          expect(() => loadConfig({ ...sub, CONSOLE_RP_ID: rpId }), rpId).toThrow(/CONSOLE_RP_ID must be the hostname of CONSOLE_ORIGIN/);
        }
      });
      test("the relying party ID must differ from the app's", () => {
        // The app's passkeys on the parent domain korbat.example, the console on that domain itself: both rules refuse it.
        const shared = { ...prod, APP_ORIGIN: "https://app.korbat.example", WEBAUTHN_RP_ID: "korbat.example", CONSOLE_ORIGIN: "https://korbat.example" };
        expect(() => loadConfig(shared)).toThrow(/CONSOLE_RP_ID must differ from the app's relying party ID \(korbat\.example\)/);
      });
      test("never an IP address or localhost", () => {
        for (const origin of ["https://203.0.113.9", "https://[2001:db8::2]", "https://localhost:8090", "https://console.localhost"]) {
          expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: origin }), origin).toThrow(/CONSOLE_RP_ID cannot be an IP address or localhost in production/);
        }
      });
    });
    test("development accepts what only production refuses: http, the app's hostname, a shared or foreign relying party ID", () => {
      // Both relying party IDs are localhost in development; only the tables keep staff keys and passkeys apart there.
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin })).toMatchObject({ CONSOLE_RP_ID: "localhost", WEBAUTHN_RP_ID: "localhost" });
      expect(loadConfig({ ...good, APP_ORIGIN: "http://app.localhost:8081", CONSOLE_ORIGIN: "http://localhost:8090" }).CONSOLE_RP_ID).toBe("localhost");
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin, CONSOLE_RP_ID: "other.example" }).CONSOLE_RP_ID).toBe("other.example");
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: "http://127.0.0.1:8090" }).CONSOLE_RP_ID).toBe("127.0.0.1");
    });
  });
});
```

### Replace `apps/api/test/integration/auth-janitor.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, staffEnrollments, staffSessions, type Db } from "@korbat/db";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { confirmNotifier, forgetNotifierAfter, mailNotifier, storeNotifierContact } from "../../src/auth/flows/notifiers";
import { emailHash } from "../../src/auth/identifiers";
import { EMAIL_CODE_RETENTION_MS, SESSION_RETENTION_MS, STAFF_ENROLLMENT_RETENTION_MS, STAFF_SESSION_RETENTION_MS, janitor } from "../../src/auth/janitor";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";
import { flowHarness, newTestEmail } from "./flow-harness";
import { TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, newStaffKey, newStaffSession } from "./staff-fixtures";

const DAY = 24 * 60 * 60_000;

describe.skipIf(!process.env.INTEGRATION)("integration: the auth janitor", () => {
  let db: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let notifierRowsBefore: Record<string, number>;

  /** How many rows the three notifier tables hold: what this file's last test holds them to. */
  async function notifierRows(): Promise<Record<string, number>> {
    const [row] = (await db.execute(
      sql`select (select count(*)::int from auth.notifier_contacts) as contacts, (select count(*)::int from auth.notifier_confirmations) as confirmations, (select count(*)::int from auth.notifier_suppressions) as suppressions`,
    )) as unknown as Record<string, number>[];
    return { ...row! };
  }

  beforeAll(async () => {
    const config = loadConfig();
    db = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it for setup.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    repo = createAuthRepo(db);
    notifierRowsBefore = await notifierRows();
  });
  afterAll(async () => {
    await Promise.all([closeDb(db), closeDb(migrateDb)]);
  });

  test("dead codes, old sessions and stale device address hashes go; live ones stay", async () => {
    const h = flowHarness(repo);
    const { user, device } = await newUserWithDevice(repo);
    const now = h.clock.now();
    const code = (expiresAt: Date) =>
      repo.createEmailCode({ flowId: randomToken(), email: `janitor-${randomToken(6)}@korbat.local`, userId: user.id, purpose: "login", codeHash: "h", expiresAt, ipHash: "x" });
    await code(new Date(now.getTime() - EMAIL_CODE_RETENTION_MS - DAY));
    await code(new Date(now.getTime() + 600_000));

    const old = await h.deps.sessions.issue(user.id, device.id, { factors: { email: now.getTime() } });
    await repo.revokeSession(old.session.handle, user.id, new Date(now.getTime() - SESSION_RETENTION_MS - DAY));
    const live = await h.deps.sessions.issue(user.id, device.id, { factors: { email: now.getTime() } });

    await repo.touchDevice(device.id, "stale-hash", new Date(now.getTime() - 31 * DAY));
    const { device: recent } = await newUserWithDevice(repo);
    await repo.touchDevice(recent.id, "fresh-hash", now);

    const report = await janitor(h.deps, now);
    expect(report.emailCodes).toBeGreaterThanOrEqual(1);
    expect(report.sessions).toBeGreaterThanOrEqual(1);
    expect(report.deviceIpHashes).toBeGreaterThanOrEqual(1);
    expect(await repo.findActiveSession(live.session.sessionId, now)).toBeDefined();
    expect(await repo.listActiveSessions(user.id, now)).toHaveLength(1);
    const [stale] = (await db.execute(sql`select ip_hash from auth.devices where id = ${device.id}::uuid`)) as unknown as { ip_hash: string | null }[];
    expect(stale?.ip_hash).toBeNull();
    const [fresh] = (await db.execute(sql`select ip_hash from auth.devices where id = ${recent.id}::uuid`)) as unknown as { ip_hash: string | null }[];
    expect(fresh?.ip_hash).toBe("fresh-hash");
  });

  test("events older than 90 days are purged through the function; the role still cannot delete rows itself", async () => {
    const h = flowHarness(repo);
    const { user } = await newUserWithDevice(repo);
    await repo.appendEvent({ userId: user.id, type: "signin_success" });
    await repo.appendEvent({ userId: user.id, type: "signin_failure" });
    await migrateDb.execute(sql`update auth.auth_events set created_at = now() - interval '91 days' where user_id = ${user.id}::uuid and type = 'signin_success'`);

    // Drizzle wraps driver errors ("Failed query: ..."); the Postgres error is the cause.
    const failure = await db.execute(sql`delete from auth.auth_events where user_id = ${user.id}::uuid`).then(() => null, (err: unknown) => err);
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied for table auth_events/);
    const report = await janitor(h.deps, h.clock.now());
    expect(report.events).toBeGreaterThanOrEqual(1);
    expect((await repo.recentEvents(user.id)).map((e) => e.type)).toEqual(["signin_failure"]);
  });

  test("staff sessions go 30 days after they were revoked or expired and enrolment links a day after use or expiry; live ones stay", async () => {
    expect(STAFF_SESSION_RETENTION_MS).toBe(30 * DAY);
    expect(STAFF_ENROLLMENT_RETENTION_MS).toBe(DAY);
    const h = flowHarness(repo);
    const now = h.clock.now();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const { user, key } = await newStaffKey(db, migrateDb, repo);

    // A session ended 30 days ago and more: it expired 15 minutes after it started, 31 days ago.
    const old = await newStaffSession(db, user.id, key.id, ago(31 * DAY));
    // One that expired 29 days ago, never revoked; one revoked an hour ago; and a live one.
    const expired = await newStaffSession(db, user.id, key.id, ago(29 * DAY));
    const revoked = await newStaffSession(db, user.id, key.id, ago(2 * 60 * 60_000));
    await db.update(staffSessions).set({ revokedAt: ago(60 * 60_000) }).where(eq(staffSessions.id, revoked.id));
    const live = await newStaffSession(db, user.id, key.id, ago(60_000));

    // Enrolments are written by the migrator alone, so it backdates them: a spent one's used_at is set as it is inserted.
    const link = (values: { usedAt?: Date; expiresAt: Date }) =>
      migrateDb
        .insert(staffEnrollments)
        .values({ userId: user.id, tokenHash: sha256Hex(randomToken()), origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID, ...values })
        .returning({ id: staffEnrollments.id })
        .then(([row]) => row!.id);
    const usedLongAgo = await link({ usedAt: ago(25 * 60 * 60_000), expiresAt: ago(24 * 60 * 60_000) });
    const expiredLongAgo = await link({ expiresAt: ago(25 * 60 * 60_000) });
    const usedRecently = await link({ usedAt: ago(23 * 60 * 60_000), expiresAt: new Date(now.getTime() + 60_000) });
    const expiredRecently = await link({ expiresAt: ago(23 * 60 * 60_000) });
    const open = await link({ expiresAt: new Date(now.getTime() + 30 * 60_000) });

    const report = await janitor(h.deps, now);
    expect(report.staffSessions).toBeGreaterThanOrEqual(1);
    expect(report.staffEnrollments).toBeGreaterThanOrEqual(2);
    const sessionsLeft = (await migrateDb.select({ id: staffSessions.id }).from(staffSessions).where(eq(staffSessions.userId, user.id))).map((s) => s.id);
    expect(sessionsLeft.sort()).toEqual([expired.id, revoked.id, live.id].sort());
    expect(sessionsLeft).not.toContain(old.id);
    const ids = [usedLongAgo, expiredLongAgo, usedRecently, expiredRecently, open];
    const linksLeft = (await migrateDb.select({ id: staffEnrollments.id }).from(staffEnrollments).where(inArray(staffEnrollments.id, ids))).map((e) => e.id);
    expect(linksLeft.sort()).toEqual([usedRecently, expiredRecently, open].sort());
    // The staff key itself is never the janitor's: audit rows name it.
    const [kept] = (await db.execute(sql`select id from auth.staff_keys where id = ${key.id}::uuid`)) as unknown as { id: string }[];
    expect(kept?.id).toBe(key.id);
  });

  /** A notifier's contact with an address of its own, stored through the flow. */
  async function contact(h: ReturnType<typeof flowHarness>) {
    const id = randomUUID();
    const email = newTestEmail("janitor-notifier");
    await storeNotifierContact(h.deps, id, { name: "Ada", email });
    return { id, email, hash: emailHash(h.deps.config.authHmacKey, email) };
  }
  const contactsLeft = async (ids: string[]) =>
    ((await db.execute(sql`select id from auth.notifier_contacts where id = any(${`{${ids.join(",")}}`}::uuid[])`)) as unknown as { id: string }[]).map((row) => row.id).sort();
  const confirmationsLeft = async (hashes: string[]) =>
    ((await db.execute(sql`select email_hash from auth.notifier_confirmations where email_hash = any(${`{${hashes.join(",")}}`}::text[])`)) as unknown as { email_hash: string }[]).map((row) => row.email_hash).sort();

  test("a notifier's contact goes once its day to be forgotten has passed, and a confirmation once its 30 days have; those not yet due stay (3c design, section 6.1)", async () => {
    const h = flowHarness(repo);
    const now = h.clock.now();
    const [due, later, fresh] = [await contact(h), await contact(h), await contact(h)];
    await forgetNotifierAfter(h.deps, [due.id], new Date(now.getTime() - 1000));
    await forgetNotifierAfter(h.deps, [later.id], new Date(now.getTime() + 60_000));
    // A confirmation made 31 days ago ran out yesterday; one made now has 30 days ahead of it.
    const past = flowHarness(repo);
    past.clock.advance(-31 * DAY);
    const old = await contact(past);
    for (const [harness, made] of [[past, old], [h, fresh]] as const) {
      expect(await mailNotifier(harness.deps, made.id, { template: "notice_received", ref: "N-ABCDEFGH23", receivedAt: now, items: ["http://localhost:8081/u/ada"] })).toBe("sent");
      const token = /#t=(.+)$/.exec(harness.mailer.sent.at(-1)!.data.pageUrl!)![1]!;
      expect(await confirmNotifier(harness.deps, made.id, token)).toBe(true);
    }
    try {
      const report = await janitor(h.deps, now);
      expect(report.notifierContacts).toBeGreaterThanOrEqual(1);
      expect(report.notifierConfirmations).toBeGreaterThanOrEqual(1);
      expect(await contactsLeft([due.id, later.id, fresh.id, old.id])).toEqual([later.id, fresh.id, old.id].sort());
      expect(await confirmationsLeft([old.hash, fresh.hash])).toEqual([fresh.hash]);
      // Nothing more is due: a second pass takes none of the rest.
      const again = await janitor(h.deps, now);
      expect([again.notifierContacts, again.notifierConfirmations]).toEqual([0, 0]);
    } finally {
      await db.execute(sql`delete from auth.notifier_contacts where id = any(${`{${[due.id, later.id, fresh.id, old.id].join(",")}}`}::uuid[])`);
      await db.execute(sql`delete from auth.notifier_confirmations where email_hash = any(${`{${[old.hash, fresh.hash].join(",")}}`}::text[])`);
    }
  });

  test("each purge runs in a try of its own: one that throws is logged with its name and counts 0, and the others still run", async () => {
    const h = flowHarness(repo);
    const now = h.clock.now();
    const { user } = await newUserWithDevice(repo);
    // Something for the purges around the failing one to take: a dead code, before it, and a contact that is due, after it.
    await repo.createEmailCode({ flowId: randomToken(), email: `janitor-${randomToken(6)}@korbat.local`, userId: user.id, purpose: "login", codeHash: "h", expiresAt: new Date(now.getTime() - EMAIL_CODE_RETENTION_MS - DAY), ipHash: "x" });
    const due = await contact(h);
    await forgetNotifierAfter(h.deps, [due.id], new Date(now.getTime() - 1000));
    const logged: { fields: Record<string, unknown>; message: string }[] = [];
    const log = { error: (fields: Record<string, unknown>, message: string) => logged.push({ fields, message }), info: () => undefined } as unknown as typeof h.deps.log;
    const failure = new Error("the sessions table cannot be reached");
    const failing = {
      ...repo,
      purgeSessions: async () => {
        throw failure;
      },
      purgeEvents: async () => {
        throw failure;
      },
    } as AuthRepo;
    try {
      const report = await janitor({ ...h.deps, repo: failing, log }, now);
      expect(report.sessions).toBe(0);
      expect(report.events).toBe(0);
      expect(report.emailCodes).toBeGreaterThanOrEqual(1);
      expect(report.notifierContacts).toBeGreaterThanOrEqual(1);
      expect(await contactsLeft([due.id])).toEqual([]);
      expect(logged).toEqual([
        { fields: { err: failure, purge: "sessions" }, message: "auth janitor: purge failed" },
        { fields: { err: failure, purge: "events" }, message: "auth janitor: purge failed" },
      ]);
      // Every purge has its place in the report, whatever became of it.
      expect(Object.keys(report).sort()).toEqual(["deviceIpHashes", "emailCodes", "events", "notifierConfirmations", "notifierContacts", "sessions", "staffEnrollments", "staffSessions"]);
    } finally {
      await db.execute(sql`delete from auth.notifier_contacts where id = ${due.id}::uuid`);
    }
  });

  test("this file left no notifier row behind: the three notifier tables hold what they held before it", async () => {
    // Every suite removes its own contacts, so none that was due stood here for the passes above to take.
    expect(await notifierRows()).toEqual(notifierRowsBefore);
  });
});
```

### Replace `apps/api/test/integration/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { MeProfile } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, ProfileStore, RequestContext } from "../../src/auth/context";
import { decrypt, parseVersionedKey, randomToken } from "../../src/auth/crypto";
import { signIn } from "../../src/auth/flows/signin";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import { hashPassword } from "../../src/auth/passwords";
import type { AuthRepo } from "../../src/auth/repo";
import { createSessions } from "../../src/auth/sessions";
import { currentStep, hotp } from "../../src/auth/totp";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";
import { fakeClock } from "./auth-fixtures";

/**
 * Handles unique per store, like the real public.profiles index. A new profile has never changed its handle, holds no
 * badge and shows its posts in Explore, as the column's default has it.
 */
export function memoryProfiles(): ProfileStore {
  const byHandle = new Map<string, MeProfile>();
  const byId = new Map<string, MeProfile>();
  return {
    async create({ id, handle, displayName }) {
      if (byHandle.has(handle) || byId.has(id)) return { ok: false, reason: "handle_taken" };
      const profile = { id, handle, displayName, handleChangedAt: null, verified: false, showInExplore: true };
      byHandle.set(handle, profile);
      byId.set(id, profile);
      return { ok: true, profile: { id, handle, displayName } };
    },
    async find(id) {
      return byId.get(id) ?? null;
    },
    async setVerified(id, at) {
      const profile = byId.get(id);
      if (profile) profile.verified = at !== null;
    },
  };
}

export const TEST_TERMS = "draft-test";
export const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

/**
 * Real auth repository (Postgres) with an in-memory key-value store, mailer and profile store, a fake
 * clock shared by all of them, Turnstile that fails only for the token "fail", and a breach checker
 * that flags passwords containing "breached". A suite whose profiles live in the public schema (the
 * deletion flow compares the typed handle with the profile's) passes the real profile store instead. The staff
 * console is off unless a suite names its origin and relying party ID, as the staff suites do (3a design, section 12).
 */
export function flowHarness(repo: AuthRepo, options: { profiles?: ProfileStore; console?: { origin: string; rpId: string } } = {}) {
  const clock = fakeClock();
  const kv = new MemoryKv(clock.ms);
  const mailer = new MemoryMailer();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    notifierKey: parseVersionedKey(`v1:${Buffer.alloc(32, 6).toString("base64")}`),
    notifierPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
    console: options.console ?? null,
  };
  const deps: AuthDeps = {
    repo,
    kv,
    mailer,
    config,
    now: clock.now,
    sessions: createSessions({ repo, kv, now: clock.now }),
    lockout: createLockout({ repo, kv, now: clock.now }),
    turnstile: { verify: async (token) => token !== "fail" },
    breachChecker: { isBreached: async (password) => password.includes("breached") },
    profiles: options.profiles ?? memoryProfiles(),
    verify: devProvider(),
    log: pino({ level: "silent" }),
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: CHROME_WINDOWS };
  return { deps, clock, kv, mailer, ctx };
}

export type FlowHarness = ReturnType<typeof flowHarness>;

export const newTestEmail = (prefix = "flow") => `${prefix}-${randomUUID()}@korbat.local`;
export const newTestDevice = () => ({ deviceId: randomToken(), platform: "web" as const });
export const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** An onboarded account, optionally with a password, signed in on one web device. */
export async function onboardedUser(h: FlowHarness, repo: AuthRepo, options: { password?: string } = {}) {
  const email = newTestEmail("account");
  const created = await repo.createUser({ email, termsVersion: TEST_TERMS, now: new Date() });
  await repo.markOnboarded(created.id, new Date());
  if (options.password) await repo.setPasswordHash(created.id, await hashPassword(options.password), new Date());
  const user = (await repo.findUserById(created.id))!;
  const device = newTestDevice();
  const signed = await signIn(h.deps, user, device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
  return { email, user, device, session: signed.issued.session, token: signed.issued.token };
}

export type OnboardedUser = Awaited<ReturnType<typeof onboardedUser>>;

/** The TOTP code for a user's stored secret at the harness clock. */
export async function currentTotpCode(h: FlowHarness, repo: AuthRepo, userId: string): Promise<string> {
  const user = (await repo.findUserById(userId))!;
  const secret = new Uint8Array(decrypt(user.totpSecretEnc!, [h.deps.config.totpKey]));
  return hotp(secret, currentStep(h.clock.ms()));
}
```

### Replace `apps/api/test/integration/http-staff-decisions.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CaseDecisionResponse, ErrorEnvelope, StaffStepUpOptionsResponse, type AuthenticationResponseJSON, type CaseDecidedParams } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { RULES_VERSION } from "@korbat/rules";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration, type ModerationForStaff } from "../../src/moderation";
import { recordIntake } from "../../src/moderation/intake";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { aPost, act, casesMedia, decisionParams, gate, ground, newPostRow, postRow, removeFixtures, rowCounts, uuids, type DecisionInput } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount, withLockTimeout } from "./staff-fixtures";

// Each test signs a staff key in over HTTP and confirms a decision with it: on a loaded machine that takes longer than
// the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/**
 * POST /api/staff/cases/:case/decisions through the real app (3c design, section 7.5, steps 1 to 3): the console's
 * browser signs in with a staff key, asks for step-up options over exactly the decision's params, has the key confirm
 * them, and posts the params with the assertion. Every decision here is confirmed by a real key, so the audit rows that
 * stay are ones audit-verify accepts; the posts, cases and decisions are removed again, and the file's last test holds it
 * to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: deciding a case over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  let deps: ReturnType<typeof createModeration>["deps"];
  let moderator: Awaited<ReturnType<typeof staffBrowser>>;
  let admin: Awaited<ReturnType<typeof staffBrowser>>;
  /** A moderator whose session began while the auth module's clock stood back, for the tests that issue a challenge with little time left. */
  let slow: Awaited<ReturnType<typeof staffBrowser>>;
  let before: Record<string, number>;
  const staffIds: string[] = [];
  /** How far the auth module's clock stands from the real one, in milliseconds; 0 but where a test sets it back. */
  let skewMs = 0;
  /** What a test runs inside the request, once the step-up verified and before the decision's transaction begins. */
  let insideRequest: (() => Promise<unknown>) | null = null;
  /** How often the route handed a verified confirmation to the moderation module. */
  let decides = 0;

  beforeAll(async () => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    // The real clock, unless a test sets it back: a decision's audit row is stamped by the database and held against the
    // challenge's expiry, which the auth module's clock sets.
    const clock = () => Date.now() + skewMs;
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb), now: () => new Date(clock()) });
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore: new MemoryStore(), config, logger });
    deps = moderation.deps;
    // The staff routes get the moderation module through a wrapper that counts the route's calls and lets a test act
    // inside the request, between the step-up's verification and the decision's own transaction.
    const observed: ModerationForStaff = {
      ...moderation.forStaff,
      decide: async (...args) => {
        decides++;
        const run = insideRequest;
        insideRequest = null;
        await run?.();
        return moderation.forStaff.decide(...args);
      },
    };
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff: createStaff({ apiDb, auth: auth.forStaff, moderation: observed }) });
    moderator = await staffBrowser("moderator");
    admin = await staffBrowser("admin");
    // Signed in nine minutes and twenty seconds back: a challenge issued later under a clock set back by less still finds
    // this session begun.
    skewMs = -560_000;
    try {
      slow = await staffBrowser("moderator");
    } finally {
      skewMs = 0;
    }
    before = await rowCounts(apiDb);
  }, 120_000);
  afterAll(async () => {
    await migrateDb.execute(sql`delete from profiles where id = any(${uuids(staffIds)})`);
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;

  /** A live staff account with a profile and one key enrolled through the flow, signed in from the console's browser. */
  async function staffBrowser(role: "moderator" | "admin") {
    const { user } = await newStaffAccount(authDb, repo, role);
    await apiDb.insert(profiles).values({ id: user.id, handle: `s_${randomUUID().slice(0, 8)}`, displayName: "Staff" });
    staffIds.push(user.id);
    const soft = new SoftAuthenticator();
    const link = await issueEnrolment(migrateDb, user.id);
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    const assert = (challenge: string) => soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: ++counter });
    const b = consoleBrowser();
    const options = await b.fetch("/api/staff/signin/options", { method: "POST" });
    expect(options.status, await options.clone().text()).toBe(200);
    const { challenge } = ((await options.json()) as { options: { challenge: string } }).options;
    const signedIn = await b.fetch("/api/staff/signin/verify", { json: { response: assert(challenge) } });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    return { id: user.id, keyId: enrolled.key.id, role, b, assert };
  }

  /** A committed post reported under this rule, with its open case. Everything is removed after `fn`. */
  async function withReported(fn: (made: { postId: string; caseId: string }) => Promise<void>, rule: "R1" | "R5" = "R1") {
    const [author, reporter] = [await newProfile(apiDb), await newProfile(apiDb)];
    try {
      const postId = await newPostRow(apiDb, author.id);
      const recorded = await recordIntake(deps, { ground: ground.rule(reporter.id, rule), live: [aPost(postId)] });
      await fn({ postId, caseId: recorded.items[0]!.caseId! });
    } finally {
      await removeFixtures(migrateDb, [author.id, reporter.id]);
    }
  }
  /** The key's confirmation of exactly these params on the case, asked for as the console asks for it. */
  async function confirmation(s: typeof moderator, caseId: string, params: CaseDecidedParams): Promise<AuthenticationResponseJSON> {
    const res = await s.b.fetch("/api/staff/step-up/options", { json: { action: "case_decided", target: { type: "case", id: caseId }, params }, headers: MARKED });
    expect(res.status, await res.clone().text()).toBe(200);
    return s.assert(StaffStepUpOptionsResponse.parse(await res.json()).options.challenge);
  }
  const post = (s: typeof moderator, caseId: string, body: unknown) => s.b.fetch(`/api/staff/cases/${caseId}/decisions`, { json: body, headers: MARKED });
  /** The whole exchange: the params as the console builds them, the confirmation, and the decision's request. */
  async function decide(s: typeof moderator, caseId: string, input: DecisionInput) {
    const params = await decisionParams(apiDb, s, caseId, input);
    return post(s, caseId, { ...params, stepUp: await confirmation(s, caseId, params) });
  }
  const decisionsOf = async (caseId: string) => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from decisions where case_id = ${caseId}::uuid`))[0]!.n;

  test("a confirmed decision is answered 201 with its id; it is stored with its measure and its audit row, and its author's mail is pending", async () => {
    await withReported(async ({ postId, caseId }) => {
      const res = await decide(moderator, caseId, { kind: "interim", actions: [act("withhold")] });
      expect(res.status, await res.clone().text()).toBe(201);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { decisionId } = CaseDecisionResponse.parse(await res.json());
      const [stored] = await apiDb.execute<Record<string, unknown>>(sql`
        select d.case_id, d.kind, d.outcome, d.decided_by, d.author_mail,
               (select count(*)::int from decision_actions a where a.decision_id = d.id and a.kind = 'withhold') as measures,
               (select count(*)::int from audit_log l where l.action = 'case_decided' and l.target_id = d.case_id::text and l.metadata ->> 'decisionId' = d.id::text and l.actor_id = d.decided_by and l.step_up is not null) as audits
          from decisions d where d.id = ${decisionId}::uuid`);
      expect({ ...stored! }).toEqual({ case_id: caseId, kind: "interim", outcome: "restricted", decided_by: moderator.id, author_mail: "pending", measures: 1, audits: 1 });
      expect(await postRow(apiDb, postId)).toMatchObject({ state: "withheld", level: "withheld" });
    });
  });

  test("it needs a staff session and the key's confirmation of exactly this decision on exactly this case", async () => {
    await withReported(async ({ postId, caseId }) => {
      await withReported(async (other) => {
        const params = await decisionParams(apiDb, moderator, caseId, { kind: "interim", actions: [act("withhold")] });
        const stepUp = await confirmation(moderator, caseId, params);
        // No session at all.
        const stranger = await consoleBrowser().fetch(`/api/staff/cases/${caseId}/decisions`, { json: { ...params, stepUp }, headers: MARKED, csrf: false });
        expect([stranger.status, (await error(stranger)).code]).toEqual([401, "staff_session_required"]);
        const answers: Record<string, [number, string]> = {};
        const refusedAs = async (label: string, res: Response) => void (answers[label] = [res.status, (await error(res)).code]);
        // No confirmation, and a member the params do not take.
        await refusedAs("no confirmation", await post(moderator, caseId, params));
        await refusedAs("a member the params do not take", await post(moderator, caseId, { ...params, extra: true, stepUp }));
        // The confirmation of this decision does not confirm another one: other params, another case, another person's session.
        await refusedAs("other params", await post(moderator, caseId, { ...params, category: "STATEMENT_CATEGORY_VIOLENCE", stepUp }));
        await refusedAs("another case", await post(moderator, other.caseId, { ...params, stepUp }));
        await refusedAs("another person's session", await post(admin, caseId, { ...params, stepUp }));
        expect(answers).toEqual({
          "no confirmation": [403, "staff_step_up_required"],
          "a member the params do not take": [400, "invalid_request"],
          "other params": [403, "staff_step_up_invalid"],
          "another case": [403, "staff_step_up_invalid"],
          "another person's session": [403, "staff_step_up_invalid"],
        });
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await decisionsOf(other.caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
        // A fresh confirmation of the same params still decides: nothing above spent the decision.
        const fresh = await confirmation(moderator, caseId, params);
        const res = await post(moderator, caseId, { ...params, stepUp: fresh });
        expect(res.status, await res.clone().text()).toBe(201);
        // And a confirmation decides once: its challenge is spent.
        const again = await post(moderator, caseId, { ...params, stepUp: fresh });
        expect([again.status, (await error(again)).code]).toEqual([403, "staff_step_up_invalid"]);
        expect(await decisionsOf(caseId)).toBe(1);
      });
    });
  });

  test("what the database refuses is answered with its code: a case that changed, a decision only an admin takes, a case that does not exist", async () => {
    await withReported(async ({ caseId }) => {
      // The case moved on since the console read it.
      const stale = await decisionParams(apiDb, moderator, caseId, { kind: "interim", actions: [act("withhold")] });
      expect((await decide(moderator, caseId, { kind: "interim", actions: [act("withhold")] })).status).toBe(201);
      const late = await post(moderator, caseId, { ...stale, stepUp: await confirmation(moderator, caseId, stale) });
      expect([late.status, (await error(late)).code]).toEqual([409, "case_changed"]);
      // A final decision on a report under R5 needs an admin.
      const refused = await decide(moderator, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      expect([refused.status, (await error(refused)).code]).toEqual([403, "admin_required"]);
      expect(await decisionsOf(caseId)).toBe(1);
      const taken = await decide(admin, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      expect(taken.status, await taken.clone().text()).toBe(201);
      // A case nobody has: the params are the console's, the id is not.
      const params = await decisionParams(apiDb, admin, caseId, { kind: "correction", reviewsDecisionId: CaseDecisionResponse.parse(await taken.json()).decisionId, actions: [act("restore")] });
      const nowhere = randomUUID();
      const missing = await post(admin, nowhere, { ...params, stepUp: await confirmation(admin, nowhere, params) });
      expect([missing.status, (await error(missing)).code]).toEqual([404, "not_found"]);
    }, "R5");
  });

  test("a key revoked, or an account demoted to user, between the confirmation and the decision's transaction ends the session: 401 with both staff cookies cleared, and nothing stored", async () => {
    type Staff = typeof moderator;
    const ends: [string, (s: Staff) => Promise<unknown>][] = [
      ["the key revoked", (s) => authDb.execute(sql`update auth.staff_keys set revoked_at = now() where id = ${s.keyId}::uuid`)],
      ["the account demoted to user", (s) => authDb.execute(sql`update auth.users set role = 'user' where id = ${s.id}::uuid`)],
    ];
    for (const [label, end] of ends) {
      const leaving = await staffBrowser("moderator");
      try {
        await withReported(async ({ postId, caseId }) => {
          const params = await decisionParams(apiDb, leaving, caseId, { kind: "interim", actions: [act("withhold")] });
          const stepUp = await confirmation(leaving, caseId, params);
          // The change is made inside the request, once requireStaff has read the session live and requireStaffStepUp has
          // verified the confirmation: only the decision's own audit statement can notice it.
          const ran = decides;
          insideRequest = () => end(leaving);
          const res = await post(leaving, caseId, { ...params, stepUp });
          expect(decides - ran, label).toBe(1);
          expect(insideRequest, label).toBeNull();
          expect(res.status, label).toBe(401);
          expect((await error(res.clone())).code, label).toBe("staff_session_required");
          const cleared = res.headers.getSetCookie().filter((line) => line.includes("Max-Age=0")).map((line) => line.slice(0, line.indexOf("=")));
          expect(cleared.sort(), label).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
          expect(await decisionsOf(caseId), label).toBe(0);
          expect(await postRow(apiDb, postId), label).toMatchObject({ state: "visible", level: "visible" });
        });
      } finally {
        staffIds.splice(staffIds.indexOf(leaving.id), 1);
        await migrateDb.execute(sql`delete from profiles where id = ${leaving.id}::uuid`);
      }
    }
  });

  test("a decision under another rulebook than the API serves is answered 422 invalid_decision, and stores nothing", async () => {
    await withReported(async ({ caseId }) => {
      const params = { ...(await decisionParams(apiDb, moderator, caseId, { kind: "interim", actions: [act("withhold")] })), rulesVersion: RULES_VERSION - 1 };
      const ran = decides;
      const res = await post(moderator, caseId, { ...params, stepUp: await confirmation(moderator, caseId, params) });
      // The key confirmed it and the route handed it over: the moderation module refuses it before it reads or writes.
      expect(decides - ran).toBe(1);
      expect([res.status, (await error(res)).code]).toEqual([422, "invalid_decision"]);
      expect(await decisionsOf(caseId)).toBe(0);
    });
  });

  describe("a decision that waits for a lock", () => {
    /** The key's confirmation of the params, its challenge issued so that about `seconds` of its ten minutes are left now. */
    async function confirmationWithLeft(caseId: string, params: CaseDecidedParams, seconds: number) {
      skewMs = -(600 - seconds) * 1000;
      try {
        return await confirmation(slow, caseId, params);
      } finally {
        skewMs = 0;
      }
    }
    /**
     * Posts the decision while a transaction of the migrator holds the audit chain's head, which every decision's last
     * statement waits for, and notes each transaction it sees waiting there (by the time it began). `during` runs while the
     * request is under way and may let the head go; it goes in any case once the request is answered.
     */
    async function postBehindHead(caseId: string, body: unknown, during: (waiting: Set<string>, letGo: () => Promise<void>) => Promise<void>) {
      const [held, release] = [gate(), gate()];
      const holder = withLockTimeout(migrateDb, async (tx) => {
        await tx.execute(sql`select 1 from public.audit_head where id = 1 for update`);
        held.open();
        await release.opened;
      });
      await held.opened;
      const letGo = async () => {
        release.open();
        await holder;
      };
      const waiting = new Set<string>();
      let watching = true;
      const watch = (async () => {
        while (watching) {
          const rows = await apiDb.execute<{ began: string }>(
            sql`select xact_start::text as began from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like '%append_confirmed_audit%'`,
          );
          for (const row of rows) waiting.add(row.began);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })();
      try {
        const posting = post(slow, caseId, body);
        await during(waiting, letGo);
        return { res: await posting, waiting };
      } finally {
        watching = false;
        await watch;
        await letGo();
      }
    }
    const until = async (condition: () => boolean, what: string) => {
      const deadline = Date.now() + 40_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`nothing came of waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const withhold: DecisionInput = { kind: "interim", actions: [act("withhold")] };

    test("a lock timeout is retried once with the same confirmation, and the second run commits: 201 and one decision", async () => {
      await withReported(async ({ postId, caseId }) => {
        const params = await decisionParams(apiDb, slow, caseId, withhold);
        const stepUp = await confirmationWithLeft(caseId, params, 75);
        const ran = decides;
        const { res, waiting } = await postBehindHead(caseId, { ...params, stepUp }, async (seen, letGo) => {
          // The first run's wait is bounded by a fifteenth of the 75 seconds left. The second run waits in a transaction
          // of its own; then the head is let go.
          await until(() => seen.size === 2, "the second run to wait for the head");
          await letGo();
        });
        expect(res.status, await res.clone().text()).toBe(201);
        expect(waiting.size).toBe(2);
        // One confirmation, handed over once: the second run is the moderation module's own.
        expect(decides - ran).toBe(1);
        expect(await decisionsOf(caseId)).toBe(1);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "withheld", level: "withheld" });
      });
    });

    test("a second lock timeout is answered 400 challenge_expired, with nothing written", async () => {
      await withReported(async ({ postId, caseId }) => {
        const params = await decisionParams(apiDb, slow, caseId, withhold);
        const stepUp = await confirmationWithLeft(caseId, params, 75);
        // The head is held through both runs.
        const { res, waiting } = await postBehindHead(caseId, { ...params, stepUp }, async () => undefined);
        expect([res.status, (await error(res)).code]).toEqual([400, "challenge_expired"]);
        expect(waiting.size).toBe(2);
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
      });
    });

    test("a lock timeout met with a minute or less of the challenge left is not retried: 400 challenge_expired after the one run, with nothing written", async () => {
      await withReported(async ({ postId, caseId }) => {
        const params = await decisionParams(apiDb, slow, caseId, withhold);
        // 64 seconds: the step-up itself is refused within a minute of the expiry, so the decision starts with a little
        // more than that, and its one bounded wait, a fifteenth of what is left, ends with less than a minute to go.
        const stepUp = await confirmationWithLeft(caseId, params, 64);
        const { res, waiting } = await postBehindHead(caseId, { ...params, stepUp }, async () => undefined);
        expect([res.status, (await error(res)).code]).toEqual([400, "challenge_expired"]);
        expect(waiting.size).toBe(1);
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
```

### Replace `apps/api/test/integration/http-staff-enroll.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, StaffEnrollOptionsResponse, StaffEnrollVerifyResponse, type RegistrationResponseJSON } from "@korbat/contracts";
import { auditLog, closeDb, createDb, staffKeys, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { challengeKey, issueChallenge } from "../../src/auth/passkeys/challenge";
import type { PublicKeyCredentialCreationOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { decodeKey } from "../../src/auth/crypto";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createModeration } from "../../src/moderation";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator, type CborValue, type SoftCreateInput } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { casesMedia } from "./moderation-fixtures";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

/**
 * The enrolment routes over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090,
 * through the staff gate to the auth module's flows. Every refusal answers a staff code, never a passkey_* one, and no
 * answer carries CORS headers.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the enrolment routes over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mailer: MemoryMailer;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mailer = new MemoryMailer();
    const auth = createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer, profiles: createProfileStore(apiDb) });
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore: new MemoryStore(), config, logger });
    const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: "__Host-korbat_staff_csrf", csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;

  /** The options for a link over HTTP, parsed as the console parses them. */
  async function options(b: Browser, token: string, kind: "security_key" | "this_device" = "security_key") {
    const res = await b.fetch("/api/staff/enroll/options", { json: { token, name: "Blue key", kind } });
    expect(res.status, await res.clone().text()).toBe(200);
    const answer = StaffEnrollOptionsResponse.parse(await res.json());
    // The contract checks the challenge alone and passes the rest to the browser's library, which knows its shape.
    return { rpShared: answer.rpShared, options: answer.options as unknown as PublicKeyCredentialCreationOptionsJSON };
  }

  const verify = (b: Browser, token: string, response: RegistrationResponseJSON) => b.fetch("/api/staff/enroll/verify", { json: { token, name: "Blue key", response } });

  test("a whole enrolment from the console's page: the options, the verification, the stored key and its mail", { timeout: 30_000 }, async () => {
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const b = consoleBrowser();
    const answer = await options(b, enrolment.token);
    expect(answer.rpShared).toBe(false);
    expect(answer.options.rp.id).toBe(TEST_CONSOLE_RP_ID);
    const response = new SoftAuthenticator().create({
      rpId: TEST_CONSOLE_RP_ID,
      challenge: answer.options.challenge,
      origin: TEST_CONSOLE_ORIGIN,
      userHandle: Buffer.from(answer.options.user.id, "base64url"),
      flags: DEVICE_BOUND,
      transports: ["usb"],
    });
    const res = await verify(b, enrolment.token, response);
    expect(res.status, await res.clone().text()).toBe(200);
    expect([...res.headers.keys()].filter((name) => name.startsWith("access-control-"))).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { key } = StaffEnrollVerifyResponse.parse(await res.json());
    const [stored] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, key.id));
    expect(stored).toMatchObject({ userId: user.id, name: "Blue key", credentialId: response.id, origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID });
    // The key's audit row carries the request's id, which the access log carries too.
    const [row] = await migrateDb.select().from(auditLog).where(eq(auditLog.keyId, key.id));
    expect(row!.requestId).toBe(res.headers.get("x-request-id"));
    expect(mailer.sent.filter((m) => m.to === user.email).map((m) => m.template)).toEqual(["staff_key_added"]);
  });

  test("a spent challenge, one of another purpose, one bound to another enrolment and a bad signature are each staff_key_refused, never a passkey code, and the link still works", { timeout: 60_000 }, async () => {
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const other = await newStaffAccount(authDb, repo);
    const otherEnrolment = await issueEnrolment(migrateDb, other.user.id);
    const b = consoleBrowser();
    const auth = new SoftAuthenticator();
    const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
    const create = (challenge: string, overrides: Partial<SoftCreateInput> = {}) =>
      auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND, ...overrides });

    // The first answer is refused on its flags, after its challenge was spent.
    const spent = create((await options(b, enrolment.token)).options.challenge, { flags: { up: true, uv: false, be: false, bs: false } });
    const first = await verify(b, enrolment.token, spent);
    expect([first.status, (await error(first)).code]).toEqual([403, "staff_key_not_user_verified"]);

    const cases: [string, RegistrationResponseJSON][] = [
      ["a spent challenge", spent],
      ["a staff sign-in challenge", create(issueChallenge(key, "staff_signin", new Date()))],
      ["a personal passkey's registration challenge", create(issueChallenge(key, "register", new Date(), enrolment.id))],
      ["a challenge bound to another enrolment", create((await options(b, otherEnrolment.token)).options.challenge)],
      [
        "a self attestation with a bad signature",
        create((await options(b, enrolment.token)).options.challenge, { fmt: "packed", attStmt: new Map<string | number, CborValue>([["alg", -7], ["sig", randomBytes(70)]]) }),
      ],
    ];
    for (const [label, response] of cases) {
      const res = await verify(b, enrolment.token, response);
      const { code, message } = await error(res);
      expect([label, res.status, code]).toEqual([label, 400, "staff_key_refused"]);
      expect(message, label).toContain("this link still works");
      expect(code, label).not.toMatch(/^passkey_/);
    }
    // Then a good answer on the same link.
    const good = create((await options(b, enrolment.token)).options.challenge);
    expect((await verify(b, enrolment.token, good)).status).toBe(200);
  });

  test("an unknown link and a spent one are each staff_enrollment_invalid at both steps", { timeout: 30_000 }, async () => {
    const b = consoleBrowser();
    const auth = new SoftAuthenticator();
    const unknown = await b.fetch("/api/staff/enroll/options", { json: { token: randomBytes(32).toString("base64url"), name: "Blue key", kind: "this_device" } });
    expect([unknown.status, (await error(unknown)).code]).toEqual([400, "staff_enrollment_invalid"]);
    const response = auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
    const late = await verify(b, `${randomUUID().replace(/-/g, "")}${"a".repeat(11)}`, response);
    expect([late.status, (await error(late)).code]).toEqual([400, "staff_enrollment_invalid"]);

    // A link that has enrolled a key. The second answer was made on it before the first was sent, on a challenge of its own
    // that nothing spent, so only the link being spent can refuse it.
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const answer = async () => {
      const { options: creation } = await options(b, enrolment.token);
      return auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: creation.challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: Buffer.from(creation.user.id, "base64url"), flags: DEVICE_BOUND });
    };
    const first = await answer();
    const second = await answer();
    const enrolled = await verify(b, enrolment.token, first);
    expect(enrolled.status, await enrolled.clone().text()).toBe(200);
    const again = await b.fetch("/api/staff/enroll/options", { json: { token: enrolment.token, name: "Blue key", kind: "security_key" } });
    expect([again.status, (await error(again)).code]).toEqual([400, "staff_enrollment_invalid"]);
    const spent = await verify(b, enrolment.token, second);
    expect([spent.status, (await error(spent)).code]).toEqual([400, "staff_enrollment_invalid"]);
    expect(await migrateDb.select({ id: staffKeys.id }).from(staffKeys).where(eq(staffKeys.userId, user.id))).toHaveLength(1);
  });
});
```

### Replace `apps/api/test/integration/http-staff-sessions.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  AuditPage,
  ErrorEnvelope,
  STAFF_STEP_UP_CHALLENGE,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyResponse,
  StaffStepUpOptionsResponse,
  stepUpActionHash,
  stepUpBinding,
  type AuthenticationResponseJSON,
} from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, revokeStaffKeys, type Auth } from "../../src/auth";
import { decodeKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, issueStepUpChallenge } from "../../src/auth/passkeys/challenge";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { runGrantRole } from "../../src/cli/grant-role";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createModeration } from "../../src/moderation";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { fakeClock } from "./auth-fixtures";
import { Browser, randomIp } from "./http-client";
import { casesMedia } from "./moderation-fixtures";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";
import { revokeRequest } from "./staff-step-up";

const CONSOLE_HOST = new URL(TEST_CONSOLE_ORIGIN).host;
const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/** The Set-Cookie lines of an answer, by cookie name. */
function setCookies(res: Response): Map<string, string> {
  return new Map(res.headers.getSetCookie().map((line) => [line.slice(0, line.indexOf("=")), line]));
}

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

/** A response's signature with its last byte changed. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/**
 * Staff sessions over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090 signs
 * in with a staff key, and every staff request after it passes the staff gate and requireStaff, which reads the session
 * from the database each time. The auth module runs on a clock the tests move, so the idle and absolute ends are reached
 * without waiting.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff sessions over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  const mailer = new MemoryMailer();
  const clock = fakeClock();

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock.ms), mailer, profiles: createProfileStore(apiDb), now: clock.now });
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore: new MemoryStore(), config, logger });
    const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  /** A request to the console's host with exactly these headers, for what the browser above never sends. */
  const raw = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    app.request(`${TEST_CONSOLE_ORIGIN}${path}`, { method: init.method ?? "GET", headers: { host: CONSOLE_HOST, "cf-connecting-ip": randomIp(), ...init.headers } });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const sessionRow = async (token: string) => (await migrateDb.select().from(staffSessions).where(eq(staffSessions.id, sha256Hex(token))))[0]!;
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;

  /** The 401 that ends a staff session in the console: staff_session_required, with both staff cookies cleared. */
  async function expectEnded(res: Response, label: string) {
    expect(res.status, label).toBe(401);
    const cookies = setCookies(res);
    expect([...cookies.keys()].sort(), label).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
    for (const line of cookies.values()) {
      expect(line, label).toContain("Max-Age=0");
      expect(line, label).toContain("Path=/");
      expect(line, label).toContain("Secure");
    }
    expect((await error(res)).code, label).toBe("staff_session_required");
  }

  /**
   * A live staff account with a handle and one key enrolled through the flow, signed in from the console's browser with
   * Firefox's user agent. `signIn` signs in again, from any browser, with the next counter unless told one.
   */
  async function staffBrowser(role: "moderator" | "admin" = "moderator") {
    const { user, device } = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    const soft = new SoftAuthenticator();
    // The flows run on the moved clock: the link is valid 30 minutes from it, which is never earlier than the database's.
    const link = await issueEnrolment(migrateDb, user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) });
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    async function signIn(browser: Browser, options: { counter?: number; headers?: Record<string, string> } = {}) {
      const answer = await browser.fetch("/api/staff/signin/options", { method: "POST" });
      expect(answer.status, await answer.clone().text()).toBe(200);
      const { options: request } = StaffSignInOptionsResponse.parse(await answer.json());
      counter = options.counter ?? counter + 1;
      const response = soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: request.challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const res = await browser.fetch("/api/staff/signin/verify", { json: { response }, headers: options.headers });
      return { res, response };
    }
    const b = consoleBrowser();
    const first = await signIn(b, { headers: { "user-agent": FIREFOX_LINUX } });
    expect(first.res.status, await first.res.clone().text()).toBe(200);
    return { user, device, handle, soft, keyId: enrolled.key.id, credentialId: enrolled.credentialId, b, token: b.cookie(STAFF_COOKIE)!, signIn, first };
  }

  /**
   * The key's answer to step-up options for revoking the staff session `handle`, asked for from `s`'s browser as the
   * console asks for them, or over a challenge of the test's own.
   */
  async function confirmation(s: Awaited<ReturnType<typeof staffBrowser>>, handle: string, options: { counter: number; challenge?: string }) {
    let challenge = options.challenge;
    if (challenge === undefined) {
      const res = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(handle), headers: MARKED });
      expect(res.status, await res.clone().text()).toBe(200);
      challenge = StaffStepUpOptionsResponse.parse(await res.json()).options.challenge;
    }
    return s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: options.counter });
  }
  const revokeSession = (b: Browser, handle: string, stepUp?: AuthenticationResponseJSON) =>
    b.fetch(`/api/staff/sessions/${handle}`, { method: "DELETE", ...(stepUp ? { json: { stepUp } } : {}), headers: MARKED });

  describe("signing in", () => {
    test("sets both staff cookies, __Host-, Secure, Path=/, SameSite=Strict and 12 hours long, the session's HttpOnly; answers /me's body with no CORS header and no-store", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const res = s.first.res;
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      const session = cookies.get(STAFF_COOKIE)!;
      const csrf = cookies.get(STAFF_CSRF_COOKIE)!;
      expect(session).toMatch(/^__Host-korbat_staff=[A-Za-z0-9_-]{43};/);
      expect(csrf).toMatch(/^__Host-korbat_staff_csrf=[A-Za-z0-9_-]{43};/);
      for (const line of [session, csrf]) {
        for (const attribute of ["Max-Age=43200", "Path=/", "Secure", "SameSite=Strict"]) expect(line).toContain(attribute);
        expect(line).not.toContain("Domain=");
      }
      expect(session).toContain("HttpOnly");
      expect(csrf).not.toContain("HttpOnly");
      // No app cookie is set on the console.
      expect(res.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session=") || line.startsWith("__Host-korbat_csrf="))).toBe(false);
      expect(accessControlHeaders(res)).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const me = StaffSignInVerifyResponse.parse(await res.json());
      const row = await sessionRow(s.token);
      expect(me).toMatchObject({ handle: s.handle, role: "moderator", sessionHandle: row.handle, idleSecondsLeft: 900, absoluteSecondsLeft: 43_200 });
      // The coarse label of the browser that signed in, never its user agent, as the session list and the mail show it.
      expect(row.browser).toBe("Firefox on Linux");
      expect(mailer.sent.filter((m) => m.to === s.user.email).map((m) => [m.template, m.data.browser])).toEqual([
        ["staff_key_added", undefined],
        ["staff_session_started", "Firefox on Linux"],
      ]);
    });

    test("one answer before the signature: a spent challenge, one of another purpose, one with another binding and a bad signature are staff_key_invalid, never a passkey code, and a bad signature on a live key reads as an unknown key", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const b = consoleBrowser();
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const fresh = async () => StaffSignInOptionsResponse.parse(await (await b.fetch("/api/staff/signin/options", { method: "POST" })).json()).options.challenge;
      const assert = (challenge: string, counter: number) =>
        s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const spentChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const stranger = new SoftAuthenticator();
      const unknown = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });

      const cases: [string, AuthenticationResponseJSON][] = [
        ["a spent challenge", assert(spentChallenge, 20)],
        ["the app's sign-in challenge", assert(issueChallenge(key, "signin", clock.now()), 21)],
        ["a staff registration challenge", assert(issueChallenge(key, "staff_register", clock.now(), randomUUID()), 22)],
        ["a staff sign-in challenge with a binding", assert(issueChallenge(key, "staff_signin", clock.now(), randomUUID()), 23)],
        ["a bad signature on a live key", badSignature(assert(await fresh(), 24))],
        ["an unknown key", stranger.get({ credentialId: unknown.id, rpId: TEST_CONSOLE_RP_ID, challenge: await fresh(), origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 1 })],
      ];
      const answers: Record<string, { status: number; code: string; message: string }> = {};
      for (const [label, response] of cases) {
        const res = await b.fetch("/api/staff/signin/verify", { json: { response } });
        const { code, message } = await error(res);
        answers[label] = { status: res.status, code, message };
        expect([label, res.status, code]).toEqual([label, 401, "staff_key_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(answers["a bad signature on a live key"]).toEqual(answers["an unknown key"]);
      expect((await migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, s.user.id))).length).toBe(1);
    });
  });

  describe("the person's own reads", () => {
    test("/me with the seconds left, /sessions with every live session and this one marked, /keys with the live keys and never a public key; no answer sets a cookie", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      // Another account's session is never listed, nor a key the account no longer holds.
      await staffBrowser();
      const red = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Red key" });
      const old = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Old key" });
      await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, old.key.id));
      clock.advance(MINUTE);

      for (const headers of [{}, MARKED]) {
        const me = await s.b.fetch("/api/staff/me", { headers });
        expect(me.status).toBe(200);
        expect(me.headers.getSetCookie()).toEqual([]);
        const body = StaffMe.parse(await me.json());
        expect(body.sessionHandle).toBe((await sessionRow(s.token)).handle);
        expect(body.absoluteSecondsLeft).toBe(12 * 60 * 60 - 60);
      }

      const sessions = await s.b.fetch("/api/staff/sessions");
      expect(sessions.headers.getSetCookie()).toEqual([]);
      const listed = StaffSessionsResponse.parse(await sessions.json()).sessions;
      const mine = await sessionRow(s.token);
      const theirs = await sessionRow(other.cookie(STAFF_COOKIE)!);
      expect(listed.map((x) => [x.handle, x.current, x.browser]).sort()).toEqual(
        [
          [mine.handle, true, "Firefox on Linux"],
          [theirs.handle, false, "Browser on unknown OS"],
        ].sort(),
      );
      // The other browser sees the same two, with its own marked.
      const fromOther = StaffSessionsResponse.parse(await (await other.fetch("/api/staff/sessions")).json()).sessions;
      expect(fromOther.find((x) => x.current)!.handle).toBe(theirs.handle);

      const keys = await s.b.fetch("/api/staff/keys");
      const text = await keys.clone().text();
      expect(StaffKeysResponse.parse(await keys.json()).keys.map((k) => [k.id, k.name])).toEqual([
        [s.keyId, "Blue key"],
        [red.key.id, "Red key"],
      ]);
      // The key that signed in shows when it was last used; nothing of any key's credential leaves the server.
      const [blue] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, s.keyId));
      expect(text).toContain(blue!.lastUsedAt!.toISOString());
      for (const secret of [blue!.publicKey, blue!.credentialId]) expect(text).not.toContain(secret);
    });
  });

  describe("the idle and absolute limits", () => {
    test("only marked requests count: unmarked reads neither slide the idle end nor move last_used_at, so the session ends 15 minutes after the last marked one", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t0 = (await sessionRow(s.token)).createdAt.getTime();
      clock.advance(10 * MINUTE);
      const unmarked = await s.b.fetch("/api/staff/me");
      expect(StaffMe.parse(await unmarked.json()).idleSecondsLeft).toBe(5 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0), idleExpiresAt: new Date(t0 + 15 * MINUTE) });

      clock.advance(4 * MINUTE);
      const marked = await s.b.fetch("/api/staff/me", { headers: MARKED });
      expect(StaffMe.parse(await marked.json()).idleSecondsLeft).toBe(15 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // Any other value of the header marks nothing.
      clock.advance(MINUTE);
      expect((await s.b.fetch("/api/staff/sessions", { headers: { "x-staff-activity": "true" } })).status).toBe(200);
      clock.advance(13 * MINUTE);
      expect((await s.b.fetch("/api/staff/keys")).status).toBe(200);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // At the idle end, the next request is refused and the cookies cleared; a marked one revives nothing.
      clock.advance(MINUTE);
      await expectEnded(await s.b.fetch("/api/staff/me"), "at the idle end");
      expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), "marked, after the idle end");
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE), revokedAt: null });
    });

    test("a marked request slides the idle end, never past the absolute end, which ends the session after 12 hours whatever its person does", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const t0 = row.createdAt.getTime();
      expect(row.absoluteExpiresAt).toEqual(new Date(t0 + 12 * HOUR));
      // A marked request every 14 minutes for 11 hours and 54 minutes.
      for (let i = 0; i < 51; i++) {
        clock.advance(14 * MINUTE);
        expect((await s.b.fetch("/api/staff/me", { headers: MARKED })).status, `request ${i}`).toBe(200);
      }
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 714 * MINUTE), idleExpiresAt: new Date(t0 + 12 * HOUR) });
      const me = StaffMe.parse(await (await s.b.fetch("/api/staff/me", { headers: MARKED })).json());
      expect([me.idleSecondsLeft, me.absoluteSecondsLeft]).toEqual([6 * 60, 6 * 60]);
      expect(me.idleExpiresAt).toBe(me.absoluteExpiresAt);
      clock.advance(6 * MINUTE);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "unmarked, at the absolute end");
      await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), "at the absolute end");
    });
  });

  describe("every way a session ends, refused at its next request", () => {
    type Ender = [string, (s: Awaited<ReturnType<typeof staffBrowser>>) => Promise<void>];
    const enders: Ender[] = [
      ["a revocation by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, s.keyId))],
      ["a revocation of every key by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, "all"))],
      [
        "a counter that went backwards in another browser",
        async (s) => {
          const { res } = await s.signIn(consoleBrowser(), { counter: 1 });
          expect((await error(res)).code).toBe("staff_key_suspended");
        },
      ],
      ["a demotion by grant-role", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "user"))],
      ["a change from moderator to admin", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "admin"))],
      ["the account's take-down", async (s) => void (await repo.takeDown(s.user.id, clock.now(), null))],
      // Changes that revoke nothing: the session is read with its key and its account at every request, so no tombstone is needed.
      ["its key revoked in the database alone", async (s) => void (await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId)))],
      ["the account's role set to user in the database alone", async (s) => void (await authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id)))],
      ["the account marked deleted in the database alone", async (s) => void (await authDb.update(users).set({ deletedAt: clock.now() }).where(eq(users.id, s.user.id)))],
      ["the session revoked in the database", async (s) => void (await authDb.update(staffSessions).set({ revokedAt: clock.now() }).where(eq(staffSessions.id, sha256Hex(s.token))))],
      [
        "a revocation confirmed with the key in another browser",
        async (s) => {
          const other = consoleBrowser();
          expect((await s.signIn(other)).res.status).toBe(200);
          const handle = (await sessionRow(s.token)).handle;
          const stepUp = await confirmation({ ...s, b: other }, handle, { counter: 3 });
          expect((await revokeSession(other, handle, stepUp)).status).toBe(204);
        },
      ],
      [
        "a counter that went backwards at a step-up",
        async (s) => {
          const handle = (await sessionRow(s.token)).handle;
          const res = await revokeSession(s.b, handle, await confirmation(s, handle, { counter: 1 }));
          expect([res.status, (await error(res)).code]).toEqual([403, "staff_key_suspended"]);
        },
      ],
    ];
    for (const [label, end] of enders) {
      test(label, { timeout: 30_000 }, async () => {
        const s = await staffBrowser();
        expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
        await end(s);
        // Both of requireStaff's reads refuse it: the plain read (no mark, as the console's idle timer and 3c's refreshes
        // read) and the marked one, which slides the idle end in the same statement. Each is sent with the token by hand,
        // since the first 401 clears the browser's cookies; then the browser's own request.
        await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), `${label}, unmarked`);
        await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), `${label}, marked`);
        await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), label);
        expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE)).toBeUndefined();
      });
    }

    test("signing out: 204, both cookies cleared, the session revoked with staff_signed_out and its audit row, and no mail", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const sent = mailer.sent.length;
      const before = await head();
      clock.advance(MINUTE);
      const res = await s.b.fetch("/api/staff/signout", { method: "POST" });
      expect(res.status).toBe(204);
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      for (const line of cookies.values()) expect(line).toContain("Max-Age=0");
      expect((await sessionRow(s.token)).revokedAt).toEqual(clock.now());

      const [event] = await migrateDb
        .select({ metadata: authEvents.metadata })
        .from(authEvents)
        .where(and(eq(authEvents.userId, s.user.id), eq(authEvents.type, "staff_signed_out")));
      expect(event!.metadata).toEqual({ handle: row.handle });
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.requestId, r.metadata])).toEqual([
        ["staff_signed_out", s.user.id, "staff_session", row.handle, row.handle, s.keyId, res.headers.get("x-request-id"), {}],
      ]);
      expect(mailer.sent.length).toBe(sent);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "after signing out");
      // Signing out again is a session that has ended.
      await expectEnded(await raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=x`, "x-staff-csrf": "x" } }), "signing out twice");
    });
  });

  describe("revoking a session, confirmed with the staff key", () => {
    test("the options name the session's key alone over a challenge the console can check; DELETE with the confirmation answers 204, the session ends at its next request, and the row carries the request's id and the confirmation", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const request = revokeRequest(target.handle);

      const optionsRes = await s.b.fetch("/api/staff/step-up/options", { json: request, headers: MARKED });
      expect(optionsRes.status).toBe(200);
      expect(accessControlHeaders(optionsRes)).toEqual([]);
      expect(optionsRes.headers.getSetCookie()).toEqual([]);
      const { options } = StaffStepUpOptionsResponse.parse(await optionsRes.json());
      expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
      expect(options.allowCredentials).toEqual([{ id: s.credentialId, type: "public-key", transports: ["usb", "nfc"] }]);
      expect(options.userVerification).toBe("required");
      // What the console checks before it asks for the key: the layout, the purpose, and the binding of its own session's
      // handle and the hash of what it sent.
      const actionHash = await stepUpActionHash(request);
      const challenge = Buffer.from(options.challenge, "base64url");
      const L = STAFF_STEP_UP_CHALLENGE;
      expect(challenge).toHaveLength(L.bytes);
      expect(challenge[L.purposeAt]).toBe(L.purpose);
      expect(challenge.subarray(L.bindingAt, L.sealAt).equals(Buffer.from(await stepUpBinding(mine.handle, actionHash)))).toBe(true);

      const stepUp = await confirmation(s, target.handle, { counter: 3, challenge: options.challenge });
      const before = await head();
      clock.advance(MINUTE);
      const res = await revokeSession(s.b, target.handle, stepUp);
      expect(res.status, await res.clone().text()).toBe(204);
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(accessControlHeaders(res)).toEqual([]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toEqual(clock.now());
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.actionHash, r.stepUp, r.metadata, r.requestId])).toEqual([
        [
          "staff_session_revoked",
          s.user.id,
          "staff_session",
          target.handle,
          mine.handle,
          s.keyId,
          actionHash,
          { authenticatorData: stepUp.response.authenticatorData, clientDataJSON: stepUp.response.clientDataJSON, signature: stepUp.response.signature },
          { params: {} },
          res.headers.get("x-request-id"),
        ],
      ]);
      await expectEnded(await other.fetch("/api/staff/me"), "the revoked session");
      expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
      // The person may end the session they ask from as well; it ends at its next request.
      expect((await revokeSession(s.b, mine.handle, await confirmation(s, mine.handle, { counter: 4 }))).status).toBe(204);
      await expectEnded(await s.b.fetch("/api/staff/me"), "the session that revoked itself");
    });

    test("without a confirmation the answer is staff_step_up_required; a body, target or options request the schemas refuse is invalid_request; without the staff CSRF header, csrf_failed; nothing changes", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const before = await head();
      for (const [label, init] of [
        ["no body", { method: "DELETE" }],
        ["an empty body", { method: "DELETE", json: {} }],
      ] as const) {
        const res = await s.b.fetch(`/api/staff/sessions/${target.handle}`, init);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "staff_step_up_required"]);
      }
      // Any assertion's shape will do for the schemas: the sign-in's is one.
      const shaped = s.first.response;
      for (const [label, path, body] of [
        ["a member the action's params do not take", `/api/staff/sessions/${target.handle}`, { all: true, stepUp: shaped }],
        ["a stepUp that is not an assertion", `/api/staff/sessions/${target.handle}`, { stepUp: { id: "x" } }],
        ["a handle that is not a uuid", "/api/staff/sessions/not-a-handle", { stepUp: shaped }],
      ] as const) {
        const res = await s.b.fetch(path, { method: "DELETE", json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      for (const [label, body] of [
        ["an action no step-up confirms", { ...revokeRequest(target.handle), action: "role_granted" }],
        ["another target type", { ...revokeRequest(target.handle), target: { type: "user", id: target.handle } }],
        ["params the action does not take", { ...revokeRequest(target.handle), params: { all: true } }],
        ["a target that is not a uuid", revokeRequest("not-a-handle")],
      ] as const) {
        const res = await s.b.fetch("/api/staff/step-up/options", { json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      // A write without the staff CSRF header is refused before the session is read, the options included.
      const stepUp = await confirmation(s, target.handle, { counter: 3 });
      expect((await s.b.fetch(`/api/staff/sessions/${target.handle}`, { method: "DELETE", json: { stepUp }, csrf: false })).status).toBe(403);
      expect((await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), csrf: false })).status).toBe(403);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The confirmation the refused write carried was never read, so it still confirms what it was given for.
      expect((await revokeSession(s.b, target.handle, stepUp)).status).toBe(204);
    });

    test("a spent challenge, one of another purpose, one with another binding and a bad signature are staff_step_up_invalid, never a passkey code; an expired one is challenge_expired", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const actionHash = await stepUpActionHash(revokeRequest(target.handle));
      const fresh = await confirmation(s, target.handle, { counter: 3 });
      const freshChallenge = JSON.parse(Buffer.from(fresh.response.clientDataJSON, "base64url").toString()).challenge as string;
      const signInChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const cases: [string, () => Promise<AuthenticationResponseJSON>][] = [
        // The library refuses it, after the challenge was spent: the same challenge signed well is then a spent one.
        ["a bad signature", async () => badSignature(fresh)],
        ["a spent step-up challenge", () => confirmation(s, target.handle, { counter: 4, challenge: freshChallenge })],
        ["the sign-in's challenge", () => confirmation(s, target.handle, { counter: 5, challenge: signInChallenge })],
        ["a staff sign-in challenge", () => confirmation(s, target.handle, { counter: 6, challenge: issueChallenge(key, "staff_signin", clock.now()) })],
        ["a re-authentication challenge for this session", () => confirmation(s, target.handle, { counter: 7, challenge: issueChallenge(key, "reauth", clock.now(), mine.handle) })],
        ["a step-up challenge for another session", () => confirmation(s, target.handle, { counter: 8, challenge: issueStepUpChallenge(key, clock.now(), target.handle, actionHash) })],
        [
          "a step-up challenge for another target",
          async () => confirmation(s, target.handle, { counter: 9, challenge: issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(mine.handle))) }),
        ],
      ];
      for (const [label, make] of cases) {
        const res = await revokeSession(s.b, target.handle, await make());
        const { code } = await error(res);
        expect([label, res.status, code]).toEqual([label, 403, "staff_step_up_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
      }
      const late = await confirmation(s, target.handle, { counter: 10 });
      clock.advance(10 * MINUTE);
      const expired = await revokeSession(s.b, target.handle, late);
      expect([expired.status, (await error(expired)).code]).toEqual([400, "challenge_expired"]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
    });

    test("another account's session is no session of the person's: 404, it lives on, and the confirmation is spent", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t = await staffBrowser();
      const theirs = await sessionRow(t.token);
      const before = await head();
      const stepUp = await confirmation(s, theirs.handle, { counter: 3 });
      const res = await revokeSession(s.b, theirs.handle, stepUp);
      expect([res.status, (await error(res)).code]).toEqual([404, "not_found"]);
      expect((await sessionRow(t.token)).revokedAt).toBeNull();
      expect((await t.b.fetch("/api/staff/me")).status).toBe(200);
      expect(await head()).toEqual(before);
      const again = await revokeSession(s.b, theirs.handle, stepUp);
      expect([again.status, (await error(again)).code]).toEqual([403, "staff_step_up_invalid"]);
    });

    test("a handle in upper case is invalid_request, for the options and for the revocation even with a confirmation bound to that spelling: the id is hashed as sent but recorded as the database writes it, so only that spelling is taken", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const upper = target.handle.toUpperCase();
      expect(upper).not.toBe(target.handle);
      const before = await head();
      const options = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(upper), headers: MARKED });
      expect(options.status, await options.clone().text()).toBe(400);
      expect((await error(options)).code).toBe("invalid_request");
      // The challenge such options would have carried, bound to the upper-case spelling and signed by the session's key.
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const bound = issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(upper)));
      const res = await revokeSession(s.b, upper, await confirmation(s, upper, { counter: 3, challenge: bound }));
      expect(res.status, await res.clone().text()).toBe(400);
      expect((await error(res)).code).toBe("invalid_request");
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The spelling the console reads from /sessions revokes it.
      expect((await revokeSession(s.b, target.handle, await confirmation(s, target.handle, { counter: 4 }))).status).toBe(204);
    });

    test("a session that ends inside the step-up is answered as requireStaff answers it, staff_session_required with both cookies cleared: its key revoked just before the options, or its key revoked or its account demoted between the confirmation and the action", { timeout: 60_000 }, async () => {
      type Staff = Awaited<ReturnType<typeof staffBrowser>>;
      const revokeKey = (s: Staff) => authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId));
      const demote = (s: Staff) => authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id));
      // Each change is made inside the request, after requireStaff read the session live: just before the options read
      // the session's key, or just before the revocation's transaction.
      const cases: [string, "findStaffKeyCredential" | "revokeConfirmedStaffSession", (s: Staff) => Promise<unknown>][] = [
        ["the key revoked before the options", "findStaffKeyCredential", revokeKey],
        ["the key revoked after the confirmation", "revokeConfirmedStaffSession", revokeKey],
        ["the account demoted after the confirmation", "revokeConfirmedStaffSession", demote],
      ];
      for (const [label, method, end] of cases) {
        const s = await staffBrowser();
        const other = consoleBrowser();
        expect((await s.signIn(other)).res.status, label).toBe(200);
        const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
        const stepUp = method === "revokeConfirmedStaffSession" ? await confirmation(s, target.handle, { counter: 3 }) : undefined;
        const flows = auth.deps.repo;
        const original = flows[method].bind(flows) as (...args: unknown[]) => Promise<unknown>;
        const spy = vi.spyOn(flows, method).mockImplementationOnce((async (...args: unknown[]) => {
          await end(s);
          return original(...args);
        }) as never);
        try {
          const res = stepUp
            ? await revokeSession(s.b, target.handle, stepUp)
            : await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), headers: MARKED });
          expect(spy, label).toHaveBeenCalledOnce();
          await expectEnded(res, label);
        } finally {
          spy.mockRestore();
        }
        expect(s.b.cookie(STAFF_COOKIE), label).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE), label).toBeUndefined();
        expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt, label).toBeNull();
      }
    });
  });

  describe("what opens a staff route", () => {
    test("the staff cookie only: the app's session cookie and a bearer token are refused, a staff cookie opens no app route, and a session created after now is refused", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `__Host-korbat_session=${app_.token}` } }), "the app's session cookie");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${app_.token}` } }), "a bearer token");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${s.token}` } }), "the staff token as a bearer token");
      // The staff cookie under the app's name, and on the app's host, opens nothing there.
      const onApp = await app.request("/api/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(onApp.status).toBe(401);
      expect((await error(onApp)).code).toBe("unauthenticated");
      const asApp = await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(asApp.status).toBe(401);

      // A row written behind the flows' back that starts in the future, within the database's 12 hours.
      const token = randomToken();
      const start = new Date(clock.ms() + HOUR);
      await authDb.insert(staffSessions).values({
        id: sha256Hex(token),
        userId: s.user.id,
        keyId: s.keyId,
        createdAt: start,
        lastUsedAt: start,
        idleExpiresAt: new Date(start.getTime() + 15 * MINUTE),
        absoluteExpiresAt: new Date(start.getTime() + 12 * HOUR),
        browser: "Firefox on Linux",
      });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${token}` } }), "a session created after now");
    });

    test("CSRF: a write needs x-staff-csrf equal to the staff CSRF cookie; the app's CSRF cookie and header do not count, and a refused write touches nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const before = await sessionRow(s.token);
      clock.advance(MINUTE);
      const post = (headers: Record<string, string>) => raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, ...MARKED, ...headers } });
      const cases: [string, Record<string, string>][] = [
        ["no header", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}` }],
        ["another value", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`, "x-staff-csrf": `${csrf.slice(1)}A` }],
        ["the header without its cookie", { cookie: `${STAFF_COOKIE}=${s.token}`, "x-staff-csrf": csrf }],
        ["the app's CSRF cookie and header", { cookie: `${STAFF_COOKIE}=${s.token}; __Host-korbat_csrf=${csrf}`, "x-csrf-token": csrf }],
      ];
      for (const [label, headers] of cases) {
        const res = await post(headers);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect((await s.b.fetch("/api/staff/signout", { method: "POST", csrf: false })).status).toBe(403);
      expect(await sessionRow(s.token)).toEqual(before);
      expect((await s.b.fetch("/api/staff/signout", { method: "POST" })).status).toBe(204);
    });
  });

  describe("the staff gate over HTTP", () => {
    test("a console POST sent with the app's session and CSRF cookies present reaches its route and is not csrf_failed", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const res = await raw("/api/staff/signout", {
        method: "POST",
        headers: {
          origin: TEST_CONSOLE_ORIGIN,
          "sec-fetch-site": "same-origin",
          cookie: `__Host-korbat_session=${app_.token}; __Host-korbat_csrf=app-csrf; ${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`,
          "x-csrf-token": "app-csrf",
          "x-staff-csrf": csrf,
        },
      });
      expect(res.status, await res.clone().text()).toBe(204);
      expect((await sessionRow(s.token)).revokedAt).not.toBeNull();
      // The app's session was neither read nor ended.
      expect(await repo.findActiveSession(app_.session.sessionId, clock.now())).toBeDefined();
    });

    test("no answer under /api/staff/ carries an Access-Control-* header, even to an Origin the app trusts", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const trusted = config.TRUSTED_ORIGINS[0]!;
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, path, init] of [
        ["a read with the trusted Origin", "/api/staff/me", { headers: { cookie, origin: trusted } }],
        ["a preflight from the trusted Origin", "/api/staff/signout", { method: "OPTIONS", headers: { origin: trusted, "access-control-request-method": "POST" } }],
        ["a read of the audit log", "/api/staff/audit", { headers: { cookie } }],
        ["a read with the console's Origin", "/api/staff/sessions", { headers: { cookie, origin: TEST_CONSOLE_ORIGIN } }],
        ["the sign-in options", "/api/staff/signin/options", { method: "POST", headers: { origin: trusted } }],
        // The case routes of sub-project 3c stand behind the same gate.
        ["a decision on a case, from the trusted Origin", `/api/staff/cases/${randomUUID()}/decisions`, { method: "POST", headers: { cookie, origin: trusted } }],
        ["a preflight for a decision on a case", `/api/staff/cases/${randomUUID()}/decisions`, { method: "OPTIONS", headers: { origin: trusted, "access-control-request-method": "POST" } }],
      ] as const) {
        const res = await raw(path, init);
        expect(accessControlHeaders(res), label).toEqual([]);
      }
      expect(accessControlHeaders(s.first.res)).toEqual([]);
    });

    test("Sec-Fetch-Site other than same-origin, or another Origin, is refused and leaves the idle end and the last use unchanged; another Host is the unknown route", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const before = await sessionRow(s.token);
      clock.advance(5 * MINUTE);
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, headers] of [
        ["same-site", { "sec-fetch-site": "same-site" }],
        ["cross-site", { "sec-fetch-site": "cross-site" }],
        ["the app's Origin", { origin: "http://localhost:8081" }],
        ["another localhost port", { origin: "http://localhost:8090" }],
      ] as const) {
        const res = await raw("/api/staff/me", { headers: { cookie, ...MARKED, ...headers } });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
      // Another Host, the console's cookie and mark notwithstanding: the 404 of an unknown route, the session untouched.
      for (const host of ["localhost:8080", "console.localhost", "localhost:8090"]) {
        const res = await app.request(`http://${host}/api/staff/me`, { headers: { host, cookie, ...MARKED, "cf-connecting-ip": randomIp() } });
        expect([host, res.status, (await error(res)).code]).toEqual([host, 404, "not_found"]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
    });
  });

  describe("the audit log", () => {
    test("newest first by place, the sign-in's row naming its actor by handle; the staff_sign_in filter, cursor pages and ?at=; reading writes nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const [signInRow] = await migrateDb
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "staff_sign_in"), eq(auditLog.actorId, s.user.id)));
      const before = await head();

      const page = AuditPage.parse(await (await s.b.fetch("/api/staff/audit")).json());
      expect(page.entries[0]!.seq).toBe(before.seq);
      expect(page.entries.map((e) => e.seq)).toEqual([...page.entries.map((e) => e.seq)].sort((a, b) => b - a));
      const mine = page.entries.find((e) => e.seq === signInRow!.chainSeq)!;
      expect(mine).toEqual({
        seq: signInRow!.chainSeq,
        hash: signInRow!.hash,
        createdAt: signInRow!.createdAt.toISOString(),
        actorHandle: s.handle,
        action: "staff_sign_in",
        targetType: "staff_session",
        targetId: signInRow!.targetId,
        actionHash: null,
      });

      const signIns = AuditPage.parse(await (await s.b.fetch("/api/staff/audit?action=staff_sign_in")).json());
      expect(signIns.entries.every((e) => e.action === "staff_sign_in")).toBe(true);
      expect(signIns.entries[0]!.seq).toBe(signInRow!.chainSeq);

      const at = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?at=${signInRow!.chainSeq}`)).json());
      expect(at.entries[0]!.seq).toBe(signInRow!.chainSeq);
      const older = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?cursor=${signInRow!.chainSeq}`)).json());
      expect(older.entries.every((e) => e.seq < signInRow!.chainSeq)).toBe(true);

      for (const query of ["?at=0", "?cursor=2&at=2", "?action=role_granted", "?cursor=abc"]) {
        const res = await s.b.fetch(`/api/staff/audit${query}`);
        expect([query, res.status, (await error(res)).code]).toEqual([query, 400, "invalid_request"]);
      }
      expect(await head()).toEqual(before);
      await expectEnded(await raw("/api/staff/audit"), "without a session");
    });
  });
});
```

### Replace `apps/api/test/integration/moderation-decide.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { beforeAll, expect, test } from "vitest";
import type { CaseDecidedParams } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../../src/auth";
import { createAuthRepo } from "../../src/auth/repo";
import { verifyStepUp } from "../../src/auth/staff/step-up";
import { loadConfig } from "../../src/config";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration, type DecideOutcome } from "../../src/moderation";
import { recordIntake } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { flowHarness } from "./flow-harness";
import { act, casesMedia, decisionParams, ground, moderationCounts, noAuthForModeration, removeDecided, uuids, type DecisionInput, type TestStaff } from "./moderation-fixtures";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { signedIn, stepUpAssertion } from "./staff-step-up";

/**
 * Decisions that commit (3c design, section 12). A committed decision carries an audit row for good, and audit-verify
 * refuses every case_decided row whose step-up is not a real assertion of its actor's staff key over exactly that action.
 * So a test that commits a decision confirms it as the console does: a staff account with a key enrolled through the
 * enrolment flow on the software authenticator, a staff session opened by the sign-in flow, step-up options for the
 * action, the authenticator's assertion, the auth module's verification, and then the moderation module's decide.
 */

/** A staff account whose key the software authenticator holds, signed in at the test console. */
export interface RealStaff extends TestStaff {
  handle: string;
  soft: SoftAuthenticator;
  credentialId: string;
  session: ActiveStaffSession;
  /** The signature counter the authenticator last reported; each use reports the next. */
  counter: number;
}

export interface DeciderWorld {
  authDb: Db;
  migrateDb: Db;
  /** The moderation module on the API's pool, as the server builds it. */
  moderation: ReturnType<typeof createModeration>;
  /** A new staff account with a profile, a real key and a staff session. */
  staff(role?: "moderator" | "admin"): Promise<RealStaff>;
  /** A verified confirmation of exactly these params, by the member's own key in the member's session. */
  confirm(member: RealStaff, caseId: string, params: CaseDecidedParams): Promise<StaffStepUpConfirmed>;
  /** A whole confirmed decision on the case: the params as the console builds them, the confirmation, and decide. */
  decideAs(member: RealStaff, caseId: string, input?: DecisionInput): Promise<DecideOutcome>;
  /** Removes the staff profiles this world made (their decisions, findings and texts must be gone by then) and closes its pools. */
  close(options?: { keepStaff?: boolean }): Promise<void>;
}

export function deciderWorld(apiDb: Db): DeciderWorld {
  const config = loadConfig();
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
  // The migrate role issues enrolment links, which only it may; the test environment carries its URL.
  const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  const repo = createAuthRepo(authDb);
  const h = flowHarness(repo, { console: TEST_CONSOLE });
  // No decision sends a mail or stores a contact yet: the module is built without an auth module to call.
  const moderation = createModeration({ apiDb, auth: noAuthForModeration(), social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore: new MemoryStore(), config, logger: pino({ level: "silent" }) });
  const members: RealStaff[] = [];
  /**
   * The harness's clock stands still unless moved, and a step-up challenge lives ten minutes from it; the audit row is
   * stamped by the database's clock. So the harness's clock is brought to the real time before every flow.
   */
  const sync = () => h.clock.advance(Date.now() - h.clock.ms());

  async function staff(role: "moderator" | "admin" = "moderator"): Promise<RealStaff> {
    sync();
    const { user } = await newStaffAccount(authDb, repo, role);
    const handle = `st_${randomBytes(5).toString("hex")}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    const soft = new SoftAuthenticator();
    const enrolled = await enrolKey(h, soft, (await issueEnrolment(migrateDb, user.id)).token);
    const { session } = await signedIn(h, soft, enrolled.credentialId, 1);
    const member: RealStaff = { id: user.id, keyId: enrolled.key.id, role, handle, soft, credentialId: enrolled.credentialId, session, counter: 1 };
    members.push(member);
    return member;
  }

  async function confirm(member: RealStaff, caseId: string, params: CaseDecidedParams): Promise<StaffStepUpConfirmed> {
    sync();
    const request = { action: "case_decided" as const, target: { type: "case" as const, id: caseId }, params };
    const stepUp = await stepUpAssertion(h, member.soft, member.credentialId, member.session, request, { counter: ++member.counter });
    return verifyStepUp(h.deps, member.session, request, stepUp, { ...h.ctx, requestId: `req-${randomUUID()}` });
  }

  async function decideAs(member: RealStaff, caseId: string, input: DecisionInput = {}): Promise<DecideOutcome> {
    const params = await decisionParams(apiDb, member, caseId, input);
    return moderation.forStaff.decide(member.session, await confirm(member, caseId, params), { requestId: `req-${randomUUID()}` });
  }

  async function close(options: { keepStaff?: boolean } = {}): Promise<void> {
    try {
      if (!options.keepStaff && members.length > 0) await migrateDb.execute(sql`delete from profiles where id = any(${uuids(members.map((member) => member.id))})`);
    } finally {
      await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
    }
  }

  return { authDb, migrateDb, moderation, staff, confirm, decideAs, close };
}

// ---------------------------------------------------------------- decideForTest

let world: DeciderWorld | null = null;
let admin: Promise<RealStaff> | null = null;
/** The posts decideForTest decided in this test file. */
const decidedPosts = new Set<string>();

/** The id of a committed decision, or a failure that says why none committed. */
function decided(outcome: DecideOutcome, what: string): string {
  if (typeof outcome === "string") throw new Error(`decideForTest: ${what} was not recorded (${outcome})`);
  return outcome.decisionId;
}

/**
 * Puts a post into a moderation state the only way one comes about: by a real, confirmed decision (3c design, section
 * 12). The suites of posting, timelines, Explore and images used to write posts.state themselves; the posts' guard now
 * refuses that for the API role, and nothing but the ledger of measures moves a post's level.
 *
 * - `withheld`: an admin's own finding under R1 opens a case on the post, and an interim decision withholds it.
 * - `removed`: the same finding, and a final decision removes it, which closes the case.
 * - `visible`: what was done is undone: the post's open case is closed by a final decision that finds no breach, which
 *   ends its interim withhold, and every removal in force is reversed in full by a correction.
 *
 * It takes the API's pool. The staff account, its key and its session are made once for each test file; closeDecisions
 * removes what the decisions left.
 */
export async function decideForTest(apiDb: Db, postId: string, state: "withheld" | "removed" | "visible"): Promise<void> {
  world ??= deciderWorld(apiDb);
  admin ??= world.staff("admin");
  const [w, staff] = [world, await admin];
  decidedPosts.add(postId);
  if (state === "visible") {
    const [open] = await apiDb.execute<{ id: string }>(sql`select id from cases where target_type = 'post' and target_id = ${postId}::uuid and closed_at is null`);
    if (open) decided(await w.decideAs(staff, open.id, { kind: "final", outcome: "no_violation" }), "the closing decision");
    const removals = await apiDb.execute<{ decision_id: string; case_id: string }>(sql`select decision_id, case_id from measures_in_force where post_id = ${postId}::uuid and kind = 'remove'`);
    for (const removal of removals) {
      decided(await w.decideAs(staff, removal.case_id, { kind: "correction", reviewsDecisionId: removal.decision_id, actions: [act("restore")] }), "the correction");
    }
    return;
  }
  const recorded = await recordIntake(w.moderation.deps, { ground: ground.finding(staff.id, "R1"), live: [{ type: "post", id: postId, position: 1 }] });
  const caseId = recorded.items[0]!.caseId!;
  decided(await w.decideAs(staff, caseId, state === "withheld" ? { kind: "interim", actions: [act("withhold")] } : { kind: "final", actions: [act("remove")] }), `the decision that makes the post ${state}`);
}

/**
 * Removes what decideForTest committed in this test file, if it was used, and closes the pools it opened: the cases of
 * the posts it decided with their items, decisions, measures, texts, snapshots and intakes, and the staff account's
 * profile; the posts' levels are derived again. Two kinds of row stay, and no suite counts either. The audit rows (the
 * staff account's enrolment and sign-in, and one case_decided row for each decision): the audit log is an append-only
 * chain, and audit-verify refuses a record with a row gone. And the staff account's rows in the auth schema (the account,
 * its key, its session and its events), which the auth suites leave for their own accounts too. Calling it again does
 * nothing.
 */
export async function closeDecisions(): Promise<void> {
  const [used, member, posts] = [world, admin, [...decidedPosts]];
  world = null;
  admin = null;
  decidedPosts.clear();
  if (!used) return;
  try {
    const staff = member ? await member.catch(() => null) : null;
    await removeDecided(used.migrateDb, posts, staff ? [staff.id] : []);
  } finally {
    await used.close({ keepStaff: true });
  }
}

/**
 * Holds a test file that uses decideForTest to leaving no moderation row behind. Called last inside the file's describe,
 * with a getter of its pool: it reads the moderation tables' row counts before the file's first test, and adds the file's
 * last test, which removes what decideForTest committed and expects the counts unchanged. The file's own posts and
 * profiles stay, as they always did.
 */
export function leavesNoModerationRows(db: () => Db): void {
  let before: Record<string, number>;
  beforeAll(async () => {
    before = await moderationCounts(db());
  });
  test("this file left no moderation row behind: what put its posts into their states is removed, and the moderation tables hold what they held before it", async () => {
    await closeDecisions();
    expect(await moderationCounts(db())).toEqual(before);
  }, 30_000);
}
```

### Replace `apps/api/test/integration/moderation-fixtures.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import pino from "pino";
import { RULE_DEFAULT_CATEGORY, compareDecisionActions, textDigest, type ActionKind, type CaseDecidedParams, type RuleId, type TdbCategory } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { REDRESS_VERSION, RULES_VERSION } from "@korbat/rules";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../../src/auth";
import type { AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { mediaForCases, type MediaForCases } from "../../src/media";
import { createMediaFiles } from "../../src/media/files";
import { createMediaRepo } from "../../src/media/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { ModerationError, createBackground, isModerationErrorCode, type ModerationDeps } from "../../src/moderation/context";
import { decide } from "../../src/moderation/decide";
import { recordIntake, type IntakeGround, type IntakeRecorded, type LiveTarget } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import { newProfile } from "./social-fixtures";
import { newStaffKey } from "./staff-fixtures";

/**
 * Rows for the database tests of the moderation tables (3c design, sections 6.1 and 6.2), written as SQL the way the
 * intake transaction writes them: an insert names only what the API supplies, and the triggers of migrations 0015 and
 * 0016 force the rest. The helpers take a pool or a transaction, so a test chooses the role and whether anything commits.
 * The suites share one database, so a test leaves nothing behind: it runs inside a transaction that is rolled back, or,
 * where a second session must see its rows, it commits them and removes them again with removeFixtures.
 */
export type Runner = Db | DbTx;
export type TargetType = "post" | "account";

export const TC = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC";
export const MINORS = "STATEMENT_CATEGORY_PROTECTION_OF_MINORS";
export const SPEECH = "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH";

/** 32 random bytes as lower-case hex: a salt, a digest's stand-in or a token's hash. */
export const hex64 = () => randomBytes(32).toString("hex");

/** A public reference as the API makes it: N- and ten base32 characters. */
export function newRef(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return `N-${Array.from(randomBytes(10), (byte) => alphabet[byte % 32]).join("")}`;
}

/** Null as SQL, any other value as a parameter. */
const orNull = (value: string | null | undefined, cast: string): SQL => (value === null || value === undefined ? sql`null` : sql`${value}::${sql.raw(cast)}`);

/** Ids as one uuid[] parameter. */
export const uuids = (ids: readonly string[]): SQL => sql`${`{${ids.join(",")}}`}::uuid[]`;

/**
 * A post row straight in the table: these tests need the row, not the flow and its counters. It is dated a month back.
 * The suites share one database, and others read the public Latest timeline from its newest post down and Explore's
 * 48-hour window: a visible post dated now would stand among theirs, and dozens of them push theirs off the first page.
 */
export async function newPostRow(db: Runner, authorId: string, options: { quoteOfId?: string; replyToId?: string; body?: string; createdAt?: SQL } = {}): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`insert into posts (author_id, body, quote_of_id, reply_to_id, created_at)
        values (${authorId}::uuid, ${options.body ?? "a post"}, ${orNull(options.quoteOfId, "uuid")}, ${orNull(options.replyToId, "uuid")}, ${options.createdAt ?? sql`now() - interval '30 days'`})
        returning id`,
  );
  return row!.id;
}

/**
 * A ready image of the account, on the post when one is given. The row is inserted on no post, which is the only way the
 * database takes one, and then attached with one update of post_id, position and alt text, as the media repository's
 * attach does.
 */
export async function newImageRow(db: Runner, ownerId: string, postId: string | null, position = 0): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`insert into post_media (owner_id, status, width, height, blurhash) values (${ownerId}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL') returning id`,
  );
  if (postId) await db.execute(sql`update post_media set post_id = ${postId}::uuid, position = ${position}, alt_text = ${`image ${position + 1}`} where id = ${row!.id}::uuid`);
  return row!.id;
}

export interface IntakeInput {
  kind?: "user" | "finding";
  channel?: "signed_in" | "signed_out" | "staff";
  reporterId?: string | null;
  findingBy?: string | null;
  contactId?: string | null;
  ruleId?: string | null;
  allegesIllegal?: boolean;
  csam?: boolean;
  category?: string;
  categoryKeyword?: string | null;
  citedLaw?: string | null;
  explanation?: string | null;
  bonaFide?: boolean;
  lookupHash?: string | null;
  ref?: string;
}

/** Inserts an intake with the ground's columns, as step 4.2 of the intake transaction does, and answers its id. */
export async function insertIntake(db: Runner, input: IntakeInput): Promise<string> {
  const [row] = await db.execute<{ id: string }>(sql`
    insert into intakes (kind, ref, lookup_hash, channel, reporter_id, finding_by, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide)
    values (${input.kind ?? "user"}::intake_kind, ${input.ref ?? newRef()}, ${orNull(input.lookupHash, "text")}, ${input.channel ?? "signed_in"}::intake_channel,
            ${orNull(input.reporterId, "uuid")}, ${orNull(input.findingBy, "uuid")}, ${orNull(input.contactId, "uuid")}, ${orNull(input.ruleId, "text")},
            ${input.allegesIllegal ?? false}, ${input.csam ?? false}, ${input.category ?? TC}, ${orNull(input.categoryKeyword, "text")},
            ${orNull(input.citedLaw, "text")}, ${orNull(input.explanation, "text")}, ${input.bonaFide ?? false})
    returning id`);
  return row!.id;
}

/** A signed-in report under a korbat rule. */
export const ruleReport = (db: Runner, reporterId: string, ruleId = "R1") => insertIntake(db, { kind: "user", channel: "signed_in", reporterId, ruleId, category: TC });

/** A signed-in notice that the target is illegal, with its explanation and good-faith statement. */
export const illegalNotice = (db: Runner, reporterId: string) =>
  insertIntake(db, { kind: "user", channel: "signed_in", reporterId, allegesIllegal: true, category: SPEECH, explanation: "It breaks the law.", bonaFide: true });

/** A notice on the path for child sexual abuse material: signed out, no account, no contact, only the token's hash. */
export const csamNotice = (db: Runner) => insertIntake(db, { kind: "user", channel: "signed_out", csam: true, allegesIllegal: true, category: MINORS, lookupHash: hex64() });

/** A moderator's own finding under a rule. */
export const findingBy = (db: Runner, staffId: string, ruleId: string, category = TC) => insertIntake(db, { kind: "finding", channel: "staff", findingBy: staffId, ruleId, category });

/**
 * The target's open case, opened when there is none: the insert that does nothing on a conflict and the read of the
 * open case, as step 4.3 of the intake transaction runs them.
 */
export async function openCase(db: Runner, targetType: TargetType, targetId: string): Promise<string> {
  await db.execute(sql`insert into cases (target_type, target_id) values (${targetType}::moderation_target, ${targetId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
  const [row] = await db.execute<{ id: string }>(sql`select id from cases where target_type = ${targetType}::moderation_target and target_id = ${targetId}::uuid and closed_at is null`);
  if (!row) throw new Error("the target has no open case");
  return row.id;
}

/** An item as the database stores it, with the columns these tests read. A raw read hands every time over as PostgreSQL's text. */
export interface ItemRow {
  id: string;
  intake_id: string;
  position: number;
  target_type: TargetType;
  target_id: string;
  named_handle: string | null;
  case_id: string | null;
  seq: number | null;
  lane: number;
  reporter_account_id: string | null;
  alleges_illegal: boolean;
  suspect: boolean;
  created_at: string;
  outcome: string | null;
  answered_by: string | null;
  outcome_sent_at: string | null;
  shown_outcome: string | null;
  revision_pending_at: string | null;
  revised_sent_at: string | null;
  outcome_mail: string;
  reexamines_item_id: string | null;
  statement: string | null;
  erased_at: string | null;
}

export interface ItemInput {
  intakeId: string;
  caseId: string | null;
  targetType?: TargetType;
  targetId: string;
  position?: number;
  lane?: number;
  namedHandle?: string | null;
  outcome?: string | null;
  reexaminesItemId?: string | null;
  /** Further columns and their values as SQL, for the tests that supply what the trigger forces. */
  extra?: Record<string, SQL>;
  /** A comment the statement carries, by which a test finds the session that runs it. */
  marker?: string;
}

/** Inserts one item and answers the row as the attach trigger left it. */
export async function insertItem(db: Runner, input: ItemInput): Promise<ItemRow> {
  const extra = Object.entries(input.extra ?? {});
  const names = extra.map(([name]) => sql.raw(`, ${name}`));
  const values = extra.map(([, value]) => sql`, ${value}`);
  const [row] = await db.execute<ItemRow & Record<string, unknown>>(sql`
    insert ${sql.raw(input.marker ? `/* ${input.marker} */` : "")} into intake_items (intake_id, case_id, target_type, target_id, position, lane, named_handle, outcome, reexamines_item_id${sql.join(names, sql``)})
    values (${input.intakeId}::uuid, ${orNull(input.caseId, "uuid")}, ${input.targetType ?? "post"}::moderation_target, ${input.targetId}::uuid, ${input.position ?? 1}, ${input.lane ?? 2},
            ${orNull(input.namedHandle, "text")}, ${orNull(input.outcome, "item_outcome")}, ${orNull(input.reexaminesItemId, "uuid")}${sql.join(values, sql``)})
    returning *`);
  return row!;
}

/** A case's derived columns. */
export interface CaseRow {
  id: string;
  lane: number;
  intake_seq: number;
  answered_seq: number;
  state_version: number;
  opened_at: string;
  oldest_open_at: string | null;
  last_decided_at: string | null;
  closed_at: string | null;
}

export async function readCase(db: Runner, id: string): Promise<CaseRow> {
  const [row] = await db.execute<CaseRow & Record<string, unknown>>(sql`select * from cases where id = ${id}::uuid`);
  return row!;
}

/** The items of a case, in the order they attached. */
export async function itemsOf(db: Runner, caseId: string): Promise<ItemRow[]> {
  const rows = await db.execute<ItemRow & Record<string, unknown>>(sql`select * from intake_items where case_id = ${caseId}::uuid order by seq`);
  return [...rows];
}

/**
 * A whole suspect intake on one target, as a notice on the CSAM path leaves it: the intake, the target's open case and
 * the item in lane 0. From its commit on, every post the case reaches is frozen.
 */
export async function suspectItemOn(db: Runner, targetType: TargetType, targetId: string, namedHandle: string | null = null): Promise<{ intakeId: string; caseId: string; item: ItemRow }> {
  const intakeId = await csamNotice(db);
  const caseId = await openCase(db, targetType, targetId);
  const item = await insertItem(db, { intakeId, caseId, targetType, targetId, lane: 0, namedHandle: targetType === "account" ? (namedHandle ?? "named") : null });
  return { intakeId, caseId, item };
}

/** Whether the post is frozen, as the role of the runner reads it. */
export async function postFrozen(db: Runner, postId: string): Promise<boolean> {
  const [row] = await db.execute<{ frozen: boolean }>(sql`select public.post_frozen(${postId}::uuid) as frozen`);
  return row!.frozen;
}

// ---------------------------------------------------------------- the moderation module on a pool or a transaction

/**
 * The moderation module's dependencies over a pool, or over a transaction that the test rolls back: the module opens its
 * own transactions on what it is given, which on a transaction are savepoints, so the intake and the decision run their
 * real statements and nothing commits.
 */
export function moderationDeps(db: Runner, overrides: Partial<ModerationDeps> = {}): ModerationDeps {
  const log = pino({ level: "silent" });
  return {
    apiDb: db as Db,
    auth: noAuthForModeration(),
    social: socialForModeration(db as Db),
    media: casesMedia(db),
    limits: new MemoryStore(),
    background: createBackground(log),
    config: loadConfig(),
    log,
    now: () => new Date(),
    ...overrides,
  };
}

/**
 * The auth module's interface for a test that stores no contact and sends no mail: every member throws, so a flow that
 * reaches one fails its test instead of passing by accident. A test of the notice routes passes the real interface.
 */
export function noAuthForModeration(): AuthForModeration {
  return new Proxy({} as AuthForModeration, {
    get: (_target, member) =>
      typeof member !== "string" || member === "then"
        ? undefined
        : () => {
            throw new Error(`this test built the moderation module without the auth module, and ${member} was called`);
          },
  });
}

/**
 * The media module's interface for cases over a pool or a transaction, as the server hands it to the moderation module.
 * Its volumes are folders that nothing creates: the database tests lock, hold and count image rows and never open or
 * request a file, and a test that does builds the interface over a store of its own.
 */
export function casesMedia(db: Runner): MediaForCases {
  const log = pino({ level: "silent" });
  const root = path.join(tmpdir(), "korbat-test-no-volumes");
  return mediaForCases({ repo: createMediaRepo(db as Db), files: createMediaFiles({ uploadsDir: path.join(root, "uploads"), storeDir: path.join(root, "store"), log }), log });
}

const NO_GROUND = { reporterId: null, findingBy: null, contactId: null, ruleId: null, allegesIllegal: false, csam: false, categoryKeyword: null, citedLaw: null, explanation: null, bonaFide: false } as const;

/** What an intake alleges and who sent it, for each way a report arrives. */
export const ground = {
  /** A signed-in report under a korbat rule. */
  rule: (reporterId: string, ruleId: RuleId = "R1"): IntakeGround => ({ ...NO_GROUND, kind: "user", channel: "signed_in", reporterId, ruleId, category: TC }),
  /** A notice that the target is illegal: signed in, or signed out without a contact when no reporter is given. */
  illegal: (reporterId: string | null, category: TdbCategory = SPEECH): IntakeGround => ({
    ...NO_GROUND,
    kind: "user",
    channel: reporterId === null ? "signed_out" : "signed_in",
    reporterId,
    allegesIllegal: true,
    category,
    explanation: "It breaks the law.",
    bonaFide: true,
  }),
  /** A notice on the path for child sexual abuse material: no account, no contact. */
  csam: (): IntakeGround => ({ ...NO_GROUND, kind: "user", channel: "signed_out", allegesIllegal: true, csam: true, category: MINORS }),
  /** A moderator's own finding under a rule; citing R2 it is suspect. */
  finding: (staffId: string, ruleId: RuleId = "R1"): IntakeGround => ({ ...NO_GROUND, kind: "finding", channel: "staff", findingBy: staffId, ruleId, category: RULE_DEFAULT_CATEGORY[ruleId] }),
};

/** One intake through the module's own transaction. A single target gets position 1. */
export function intake(db: Runner, ground: IntakeGround, targets: LiveTarget | readonly LiveTarget[]): Promise<IntakeRecorded> {
  const live = Array.isArray(targets) ? (targets as readonly LiveTarget[]) : [targets as LiveTarget];
  return recordIntake(moderationDeps(db), { ground, live });
}

/** A post as an intake's first target. */
export const aPost = (id: string, position = 1): LiveTarget => ({ type: "post", id, position });
/** An account as an intake's first target, named by a handle. */
export const anAccount = (id: string, namedHandle = "named", position = 1): LiveTarget => ({ type: "account", id, position, namedHandle });

/** An author (a new profile unless one is given) and a post of theirs with this many images. */
export async function imagePost(db: Runner, images = 0, authorId?: string, options: { quoteOfId?: string; replyToId?: string } = {}): Promise<{ authorId: string; postId: string; mediaIds: string[] }> {
  const owner = authorId ?? (await newProfile(db as Db)).id;
  const postId = await newPostRow(db, owner, options);
  const mediaIds: string[] = [];
  for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(db, owner, postId, position));
  return { authorId: owner, postId, mediaIds };
}

/**
 * One report about the target by someone new, into the target's open case (opened when there is none): under a rule, as
 * a notice of illegality, or on the path for child sexual abuse material, which records no sender.
 */
export async function report(db: Runner, target: LiveTarget, by: "rule" | "illegal" | "csam" = "rule", rule: RuleId = "R1"): Promise<{ caseId: string; recorded: IntakeRecorded }> {
  const sender = by === "csam" ? null : (await newProfile(db as Db)).id;
  const recorded = await intake(db, by === "csam" ? ground.csam() : by === "illegal" ? ground.illegal(sender) : ground.rule(sender!, rule), target);
  return { caseId: recorded.items.find((item) => item.position === target.position)!.caseId!, recorded };
}

// ---------------------------------------------------------------- staff and decisions

/** A staff account as the database tests need it: its id, a live staff key of its own and its role. It has no profile until a test gives it one. */
export interface TestStaff {
  id: string;
  keyId: string;
  role: "moderator" | "admin";
}

/**
 * A live staff account with one live key, committed on the auth side: the decision triggers read the account's role and
 * the audit function its key, in the auth schema, which a transaction of the API role cannot write. The key's public key
 * is a placeholder: no test that commits an audit row signs with it.
 */
export async function newTestStaff(authDb: Db, migrateDb: Db, repo: AuthRepo, role: "moderator" | "admin" = "moderator"): Promise<TestStaff> {
  const { user, key } = await newStaffKey(authDb, migrateDb, repo, role);
  return { id: user.id, keyId: key.id, role };
}

/** The staff account's profile row, which a decision, a finding and a staff text refer to. Its handle is random. */
export async function staffProfile(db: Runner, staff: { id: string }): Promise<void> {
  await db.execute(sql`insert into profiles (id, handle, display_name) values (${staff.id}::uuid, ${`st_${randomBytes(5).toString("hex")}`}, 'Staff')`);
}

/** Saves a staff text on a case as the console will: a fresh salt, and the digest of the salt and the text. Answers the digest. */
export async function saveText(db: Runner, caseId: string, authorId: string, kind: string, text = `a ${kind} text ${randomUUID()}`): Promise<string> {
  const salt = hex64();
  const digest = await textDigest(salt, text);
  await db.execute(sql`insert into staff_texts (case_id, author_id, kind, text, salt, digest) values (${caseId}::uuid, ${authorId}::uuid, ${kind}::staff_text_kind, ${text}, ${salt}, ${digest})`);
  return digest;
}

/** The case's newest snapshot, as a decision names it. */
export async function newestSnapshot(db: Runner, caseId: string): Promise<{ id: string; digest: string }> {
  const [row] = await db.execute<{ id: string; digest: string }>(sql`select id, digest from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc limit 1`);
  if (!row) throw new Error("the case holds no snapshot");
  return { id: row.id, digest: row.digest };
}

/** What a test says about a decision; everything left out is filled in from the case as the console would. */
export interface DecisionInput {
  /** `interim` unless said. */
  kind?: "interim" | "final" | "correction";
  /** `restricted` for an interim or final decision, `reversed` for a correction, unless said. */
  outcome?: CaseDecidedParams["outcome"];
  /** For a restriction `incompatible` unless said; else none. */
  ground?: "incompatible" | "illegal" | null;
  /** R1 for the ground `incompatible` unless said. */
  ruleId?: RuleId | null;
  category?: TdbCategory;
  categoryKeyword?: "KEYWORD_TERRORIST_CONTENT" | null;
  actions?: readonly { kind: ActionKind; mediaId?: string | null }[];
  /** For a final decision the case's newest item unless said. */
  throughSeq?: number;
  /** The case's version now unless said. */
  stateVersion?: number;
  reviewsDecisionId?: string | null;
  snapshotId?: string;
  snapshotDigest?: string;
  /** Each text is saved fresh where the decision needs one, unless a digest (or null) is given. */
  factsDigest?: string | null;
  reasonDigest?: string | null;
  legalReferenceDigest?: string | null;
  rulesVersion?: number;
  redressVersion?: number;
}

/** A measure on the post, the account's field or the case's images; an image measure with its image. */
export const act = (kind: ActionKind, mediaId: string | null = null) => ({ kind, mediaId });

/**
 * The params of a decision on the case as the console builds them: the case's version, the range a final decision
 * answers, the newest snapshot with its digest, the digests of freshly saved texts, and the actions in their one order.
 */
export async function decisionParams(db: Runner, staff: { id: string }, caseId: string, input: DecisionInput = {}): Promise<CaseDecidedParams> {
  const kind = input.kind ?? "interim";
  const outcome = input.outcome ?? (kind === "correction" ? "reversed" : "restricted");
  const groundOf = input.ground !== undefined ? input.ground : outcome === "restricted" ? "incompatible" : null;
  const ruleId = input.ruleId !== undefined ? input.ruleId : groundOf === "incompatible" ? "R1" : null;
  const current = await readCase(db, caseId);
  const snapshot = input.snapshotId !== undefined && input.snapshotDigest !== undefined ? { id: input.snapshotId, digest: input.snapshotDigest } : await newestSnapshot(db, caseId);
  let category: TdbCategory = input.category ?? (ruleId !== null ? RULE_DEFAULT_CATEGORY[ruleId] : groundOf === "illegal" ? SPEECH : TC);
  let rulesVersion = input.rulesVersion ?? RULES_VERSION;
  if (kind === "correction" && input.reviewsDecisionId) {
    // A correction carries the category and the rules version of the decision it corrects.
    const [corrected] = await db.execute<{ category: TdbCategory; rules_version: number }>(sql`select category, rules_version from decisions where id = ${input.reviewsDecisionId}::uuid`);
    category = input.category ?? corrected?.category ?? category;
    rulesVersion = input.rulesVersion ?? corrected?.rules_version ?? rulesVersion;
  }
  const text = async (given: string | null | undefined, needed: boolean, textKind: string) => (given !== undefined ? given : needed ? await saveText(db, caseId, staff.id, textKind) : null);
  return {
    kind,
    stateVersion: input.stateVersion ?? current.state_version,
    throughSeq: input.throughSeq ?? (kind === "final" ? current.intake_seq : 0),
    reviewsDecisionId: input.reviewsDecisionId ?? null,
    snapshotId: input.snapshotId ?? snapshot.id,
    snapshotDigest: input.snapshotDigest ?? snapshot.digest,
    outcome,
    ground: groundOf,
    ruleId,
    rulesVersion,
    redressVersion: input.redressVersion ?? REDRESS_VERSION,
    category,
    categoryKeyword: input.categoryKeyword ?? null,
    actions: (input.actions ?? []).map((action) => ({ kind: action.kind, mediaId: action.mediaId ?? null })).sort(compareDecisionActions),
    factsDigest: await text(input.factsDigest, outcome === "restricted", "facts"),
    reasonDigest: await text(input.reasonDigest, outcome === "restricted" || kind === "correction", kind === "correction" ? "review_reason" : "reason"),
    legalReferenceDigest: await text(input.legalReferenceDigest, groundOf === "illegal", "legal_reference"),
  };
}

/**
 * A staff session and a confirmation as the staff routes hand them to the moderation module, made up: the hash and the
 * assertion are placeholders that audit-verify would refuse, so the audit row they lead to is only ever written inside a
 * transaction that is rolled back. A decision that commits is confirmed with a real key (moderation-decide.ts).
 */
export function madeUpConfirmation(staff: TestStaff, caseId: string, params: CaseDecidedParams, expiresAt = new Date(Date.now() + 10 * 60_000)): { session: ActiveStaffSession; confirmed: StaffStepUpConfirmed } {
  const now = new Date();
  return {
    session: {
      sessionId: hex64(),
      handle: randomUUID(),
      userId: staff.id,
      keyId: staff.keyId,
      role: staff.role,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    },
    confirmed: {
      action: "case_decided",
      target: { type: "case", id: caseId },
      params,
      actionHash: hex64(),
      keyId: staff.keyId,
      assertion: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
      expiresAt,
    },
  };
}

/** What the database raised, however deeply the driver wrapped it: its SQLSTATE, message and detail. */
export function raised(err: unknown): { code: string; message: string; detail: string | null } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && typeof (current as { code?: unknown }).code === "string" && /^[0-9A-Z]{5}$/.test((current as { code: string }).code)) {
      const found = current as { code: string; message?: unknown; detail?: unknown };
      return { code: found.code, message: String(found.message ?? ""), detail: typeof found.detail === "string" ? found.detail : null };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * A decision inside a transaction that the test rolls back, through the module's own decide: the decision's row, its
 * measures and its audit row, with a made-up confirmation of exactly these params. The deferred check, which a real
 * decision meets at its commit, is made to run right after, inside the same savepoint, so a decision it refuses leaves
 * nothing behind and a later decision of the test is checked alone. Answers the decision's id; a refusal is thrown as the
 * module throws it, with the detail the database gave.
 */
export async function decideWith(tx: DbTx, staff: TestStaff, caseId: string, params: CaseDecidedParams): Promise<string> {
  const { session, confirmed } = madeUpConfirmation(staff, caseId, params);
  try {
    return await tx.transaction(async (sp) => {
      const outcome = await decide(moderationDeps(sp), session, confirmed, { requestId: `req-${randomUUID()}` });
      if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck deferred`);
      return outcome.decisionId;
    });
  } catch (err) {
    // The check at commit raises its code as the triggers do; decide maps the same code when a real commit fails.
    const refused = raised(err);
    if (!(err instanceof ModerationError) && refused?.code === "P0001" && isModerationErrorCode(refused.message)) {
      throw Object.assign(new ModerationError(refused.message), { detail: refused.detail });
    }
    throw err;
  }
}

/** The same, with the params filled in from the case as the console would build them. */
export async function decideIn(tx: DbTx, staff: TestStaff, caseId: string, input: DecisionInput = {}): Promise<string> {
  return decideWith(tx, staff, caseId, await decisionParams(tx, staff, caseId, input));
}

/** The code a flow or a statement was refused with, or null when it went through: a module's error code, or what the database raised. */
export async function refusal(promise: PromiseLike<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof ModerationError) return err.code;
    const fromDatabase = raised(err);
    if (fromDatabase) return fromDatabase.code === "P0001" ? fromDatabase.message : `${fromDatabase.code} ${fromDatabase.message}`;
    if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
    throw err;
  }
}

/** The detail a refusal at commit names: the member of the audit row, or the rule, that did not hold. */
export async function refusalDetail(promise: PromiseLike<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return (err as { detail?: string | null }).detail ?? raised(err)?.detail ?? null;
  }
}

/** A decision's row as the triggers left it, with the columns these tests read. */
export interface DecisionRow {
  id: string;
  case_id: string;
  kind: string;
  outcome: string;
  ground: string | null;
  rule_id: string | null;
  through_seq: number;
  answers_from_seq: number | null;
  source: string;
  suspect: boolean;
  unseen: boolean;
  needs_admin: boolean;
  ended_interim: boolean;
  author_mail: string;
  decided_by: string;
  automated_detection: boolean;
  automated_decision: string;
  territorial_scope: string;
  puid: string;
  redacted_at: string | null;
}

export async function decisionRow(db: Runner, id: string): Promise<DecisionRow> {
  const [row] = await db.execute<DecisionRow & Record<string, unknown>>(sql`select * from decisions where id = ${id}::uuid`);
  return row!;
}

/** A ledger row as the triggers left it. actionsOf answers a decision's rows in the order its params list them: by kind as a word, then by image. */
export interface ActionRow {
  id: string;
  decision_id: string;
  kind: ActionKind;
  media_id: string | null;
  subject_account_id: string;
  post_id: string | null;
  reverses_action_id: string | null;
  no_effect: string | null;
}

export async function actionsOf(db: Runner, decisionId: string): Promise<ActionRow[]> {
  const rows = await db.execute<ActionRow & Record<string, unknown>>(sql`select * from decision_actions where decision_id = ${decisionId}::uuid order by kind::text, media_id`);
  return [...rows];
}

/** A post's state, its level and whether its content was erased. */
export async function postRow(db: Runner, id: string): Promise<{ state: string; level: string; erased: boolean }> {
  const [row] = await db.execute<{ state: string; level: string; erased: boolean }>(sql`select state, moderation_level as level, erased_at is not null as erased from posts where id = ${id}::uuid`);
  return { ...row! };
}

/** Each image's moderation state, in the order asked. */
export async function imageStates(db: Runner, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute<{ id: string; state: string }>(sql`select id, moderation_state as state from post_media where id = any(${uuids(ids)})`);
  const byId = new Map([...rows].map((row) => [row.id, row.state]));
  return ids.map((id) => byId.get(id) ?? "missing");
}

/** The measures in force that the view names, as "kind" or "kind:image", sorted. */
export async function inForce(db: Runner, where: { caseId?: string; postId?: string }): Promise<string[]> {
  const rows = await db.execute<{ kind: string; media_id: string | null }>(
    sql`select kind, media_id from measures_in_force where ${where.caseId ? sql`case_id = ${where.caseId}::uuid` : sql`post_id = ${where.postId!}::uuid`} order by kind::text, media_id`,
  );
  return [...rows].map((row) => (row.media_id ? `${row.kind}:${row.media_id}` : row.kind));
}

/**
 * Deletes these cases with everything that hangs on them, and these intakes with their items, in the order the keep
 * trigger and the foreign keys ask for (removeFixtures says why). Both ids are uuid[] parameters.
 */
async function removeCasesIn(tx: DbTx, caseIds: SQL, intakeIds: SQL): Promise<void> {
  await tx.execute(sql`delete from intake_items where case_id = any(${caseIds}) or intake_id = any(${intakeIds})`);
  await tx.execute(sql`update media_holds set released_at = now() where case_id = any(${caseIds}) and released_at is null`);
  await tx.execute(sql`delete from media_holds where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from seal_posts where action_id in (select a.id from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decision_actions where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from staff_texts where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from appeals where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decisions where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from evidence_snapshots where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from case_access_log where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from cases where id = any(${caseIds})`);
  await tx.execute(sql`delete from intakes where id = any(${intakeIds})`);
}

/**
 * Removes, as the migrator, what decisions about these posts left: the posts' cases with everything that hangs on them,
 * the findings of these staff accounts, and those accounts' profiles. The posts themselves stay, as their suites leave
 * them, and their levels are derived again, so none keeps a level that no decision gives it any more.
 */
export async function removeDecided(migrateDb: Db, postIds: readonly string[], staffIds: readonly string[]): Promise<void> {
  if (postIds.length === 0 && staffIds.length === 0) return;
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const cases = await tx.execute<{ id: string }>(sql`select id from cases where target_type = 'post' and target_id = any(${uuids(postIds)})`);
    const caseIds = uuids(cases.map((row) => row.id));
    const intakes = await tx.execute<{ id: string }>(sql`
      select distinct i.intake_id as id from intake_items i where i.case_id = any(${caseIds})
      union select n.id from intakes n where n.finding_by = any(${uuids(staffIds)})`);
    await removeCasesIn(tx, caseIds, uuids(intakes.map((row) => row.id)));
    await tx.execute(sql`select public.moderation_apply(${uuids(postIds)}, true)`);
    await tx.execute(sql`delete from profiles where id = any(${uuids(staffIds)})`);
  });
}

/**
 * Removes, as the migrator, everything a test committed about these profiles. Only a test whose second session must see
 * its rows commits them, and it calls this in a `finally`. The order is the one the keep trigger and the foreign keys
 * ask for: the items first (an unanswered suspect item freezes every image its case reaches, and the database then keeps
 * those rows against every delete); the holds released and then deleted (a release takes the image's hold_until back; a
 * delete of the hold's row would not); the seals' lists, the ledger and the texts before the decisions that own them, and
 * the decisions before the snapshots they name; access rows; the cases; the intakes of the items and of these reporters
 * and finders; then the image rows, the posts and the profiles. The audit rows of committed decisions stay: they are the
 * record, and audit-verify still accepts them.
 */
export async function removeFixtures(migrateDb: Db, profileIds: readonly string[]): Promise<void> {
  if (profileIds.length === 0) return;
  const profiles = uuids(profileIds);
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const cases = await tx.execute<{ id: string }>(sql`
      select c.id from cases c
       where (c.target_type = 'account' and c.target_id = any(${profiles}))
          or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = any(${profiles})))`);
    const caseIds = uuids(cases.map((row) => row.id));
    const intakes = await tx.execute<{ id: string }>(sql`
      select distinct i.intake_id as id from intake_items i where i.case_id = any(${caseIds})
      union select n.id from intakes n where n.reporter_id = any(${profiles}) or n.finding_by = any(${profiles})`);
    const intakeIds = uuids(intakes.map((row) => row.id));
    await removeCasesIn(tx, caseIds, intakeIds);
    await tx.execute(sql`delete from post_media where owner_id = any(${profiles})`);
    await tx.execute(sql`delete from posts where author_id = any(${profiles})`);
    await tx.execute(sql`delete from profiles where id = any(${profiles})`);
  });
}

/** How many rows each table that these suites write holds. A suite reads it before its first test and after its last. */
export async function rowCounts(db: Runner): Promise<Record<string, number>> {
  const tables = ["cases", "intakes", "intake_items", "media_holds", "evidence_snapshots", "staff_texts", "case_access_log", "decisions", "decision_actions", "seal_posts", "appeals", "post_media", "posts", "profiles"];
  const columns = tables.map((table) => `(select count(*)::int from public.${table}) as ${table}`).join(", ");
  const [row] = await db.execute<Record<string, number>>(sql.raw(`select ${columns}`));
  return { ...row! };
}

/** The same for the moderation tables alone: what a suite that keeps its own posts and profiles is held to. */
export async function moderationCounts(db: Runner): Promise<Record<string, number>> {
  const kept = new Set(["post_media", "posts", "profiles"]);
  return Object.fromEntries(Object.entries(await rowCounts(db)).filter(([table]) => !kept.has(table)));
}

/** A marker for one statement of one test: a word that no other statement holds. */
export const newMarker = () => `race_${randomBytes(6).toString("hex")}`;

/**
 * Resolves once a session is waiting for a lock while it runs a statement that carries the marker. A two-session test
 * waits for this instead of sleeping, so a loaded machine cannot make it read "did not wait" too early. The pool must be
 * of the waiting session's role: a role sees only its own sessions' statements.
 */
export async function untilBlocked(db: Db, marker: string, timeoutMs = 20_000): Promise<void> {
  const pattern = `%${marker}%`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like ${pattern}`,
    );
    if (row!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no session came to wait for a lock with the statement marked ${marker}`);
}

/** A promise with its resolver, for a transaction that stays open until the test lets it end. */
export function gate(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}
```

### Replace `apps/api/test/mail/smtp.test.ts` (whole file)

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { MailRefused, MailUnavailable } from "../../src/mail/mailer";
import { smtpMailer, smtpTransportOptions } from "../../src/mail/smtp";

/** What the transport's sendMail does in the test at hand; nodemailer itself is never loaded, so nothing connects. */
const sendMail = vi.fn<(message: unknown) => Promise<unknown>>();
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: (message: unknown) => sendMail(message) }) } }));

/** The explicit time limits every transport gets (3c design, section 5): nodemailer's own are minutes long. */
const LIMITS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000, dnsTimeout: 10_000 };

describe("smtp transport options", () => {
  test("smtps is implicit TLS on 465 with the credentials from the URL", () => {
    expect(smtpTransportOptions("smtps://user:p%40ss@relay.example")).toEqual({
      host: "relay.example",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "user", pass: "p@ss" },
      ...LIMITS,
    });
  });
  test("smtp is plain in development; with TLS required, STARTTLS becomes mandatory", () => {
    expect(smtpTransportOptions("smtp://mailpit:1025")).toEqual({ host: "mailpit", port: 1025, secure: false, requireTLS: false, ...LIMITS });
    expect(smtpTransportOptions("smtp://relay.example", { requireTls: true })).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });
  test("a relay that does not answer, or answers and then stalls, fails a send within about 50 seconds: the four limits, for smtp and smtps alike", () => {
    for (const url of ["smtp://mailpit:1025", "smtps://user:pass@relay.example:465"]) {
      const options = smtpTransportOptions(url);
      expect(options.connectionTimeout, url).toBe(10_000);
      expect(options.greetingTimeout, url).toBe(10_000);
      expect(options.socketTimeout, url).toBe(30_000);
      expect(options.dnsTimeout, url).toBe(10_000);
    }
  });
});

/** nodemailer's error as its smtp-connection formats one: the code, the command that failed, and the relay's reply with its number. */
function smtpError(code: string, command: string | undefined, response: string | undefined): Error {
  const err = new Error(response === undefined ? "send failed" : `send failed: ${response}`) as Error & { code?: string; command?: string; response?: string; responseCode?: number };
  err.code = code;
  if (command !== undefined) err.command = command;
  if (response !== undefined) {
    err.response = response;
    const number = Number(/^[0-9]+/.exec(response)?.[0]);
    if (number) err.responseCode = number;
  }
  return err;
}

const LF = String.fromCharCode(10);

describe("smtpMailer's errors", () => {
  const mailer = smtpMailer("smtp://relay.example:587", "korbat <no-reply@korbat.local>");
  const message = { to: "a@b.example", template: "sign_in_code", data: { code: "123456" } } as const;
  const failure = async (err: Error) => {
    sendMail.mockRejectedValueOnce(err);
    return mailer.send(message).then(
      () => null,
      (thrown: unknown) => thrown,
    );
  };

  beforeEach(() => {
    sendMail.mockReset();
  });

  test("a send the relay takes resolves, with the rendered subject and both bodies", async () => {
    sendMail.mockResolvedValueOnce({ messageId: "x" });
    await mailer.send(message);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({ from: "korbat <no-reply@korbat.local>", to: "a@b.example", subject: "Your korbat sign-in code" });
  });

  test("the relay saying that the recipient's address itself is bad is MailRefused: no retry changes such an address", async () => {
    for (const response of [
      "550 5.1.1 <a@b>: Recipient address rejected: User unknown",
      // A reply of several lines: every line but the last carries a hyphen after the number.
      `550-5.1.1 The email account that you tried to reach does not exist.${LF}550 5.1.1 Please check the address.`,
      "556 5.1.10 Recipient address has null MX",
      "550 5.1.2 Bad destination system address",
      "553 5.1.3 Bad destination mailbox address syntax",
      "551 5.1.6 Destination mailbox has moved",
    ]) {
      const thrown = await failure(smtpError("EENVELOPE", "RCPT TO", response));
      expect(thrown, response).toBeInstanceOf(MailRefused);
      // Every existing caller catches MailUnavailable and so behaves as before.
      expect(thrown, response).toBeInstanceOf(MailUnavailable);
      expect((thrown as Error).cause, response).toMatchObject({ code: "EENVELOPE" });
    }
  });

  test("every other failure stays a plain MailUnavailable, to be tried again", async () => {
    for (const [name, err] of [
      // Postfix checks its client and sender restrictions at RCPT TO: a relay that refuses korbat itself answers there for every recipient.
      ["relaying denied", smtpError("EENVELOPE", "RCPT TO", "554 5.7.1 <a@b>: Relay access denied")],
      ["a refused sender, reported at RCPT TO", smtpError("EENVELOPE", "RCPT TO", "553 5.1.8 <f@g>: Sender address rejected: Domain not found")],
      ["a bad sender mailbox", smtpError("EENVELOPE", "RCPT TO", "550 5.1.7 Bad sender's mailbox address syntax")],
      ["no enhanced status", smtpError("EENVELOPE", "RCPT TO", "550 rejected")],
      // 5.1.1 followed by another digit is another status.
      ["a longer detail number", smtpError("EENVELOPE", "RCPT TO", "550 5.1.11 something else")],
      ["a temporary refusal", smtpError("EENVELOPE", "RCPT TO", "450 4.1.1 <a@b>: Recipient address rejected: try again later")],
      ["a temporary refusal that names 5.1.1 later in its text", smtpError("EENVELOPE", "RCPT TO", "451 4.7.1 try later (was 550 5.1.1)")],
      ["a refused MAIL FROM", smtpError("EENVELOPE", "MAIL FROM", "550 5.1.1 Sender unknown")],
      ["failed credentials", smtpError("EAUTH", "AUTH PLAIN", "535 5.7.8 Authentication credentials invalid")],
      ["a refused message", smtpError("EMESSAGE", "DATA", "554 5.1.1 Transaction failed")],
      ["no connection", smtpError("ECONNECTION", undefined, undefined)],
      ["a timeout", smtpError("ETIMEDOUT", "CONN", undefined)],
      ["a bad recipient without a command", smtpError("EENVELOPE", undefined, "550 5.1.1 User unknown")],
      ["something that is no SMTP error", new TypeError("boom")],
    ] as const) {
      const thrown = await failure(err);
      expect(thrown, name).toBeInstanceOf(MailUnavailable);
      expect(thrown, name).not.toBeInstanceOf(MailRefused);
      expect((thrown as Error).cause, name).toBe(err);
    }
  });
});
```

### Replace `apps/api/test/mail/templates.test.ts` (whole file)

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
    const data = {
      code: "123456",
      deviceLabel: "<b>Chrome</b> on Windows",
      notMeUrl: "http://localhost:8081/not-me/abc",
      revertUrl: "http://localhost:8081/email-revert/def",
      minutes: "15",
      count: "3",
      email: "new<address>@example.com",
      name: "<i>Work</i> laptop",
      time: "2026-09-25 10:00 UTC",
      removeUrl: "http://localhost:8081/passkey-remove/ghi",
      browser: "Firefox on Linux",
      names: '"Blue key", "Red key"',
      ref: "N-ABCDEFGH23",
      items: "http://localhost:8081/post/0190f3a2-7c1e-7b1a-9f00-0123456789ab",
      pageUrl: "http://localhost:8081/notice/N-ABCDEFGH23#t=mail-token",
      termsUrl: "http://localhost:8081/terms",
      oldest: "2026-10-04 06:59 UTC",
    };
    for (const template of [
      "sign_in_code",
      "sign_up_code",
      "reauth_code",
      "new_device",
      "account_locked",
      "mfa_enabled",
      "mfa_disabled",
      "password_changed",
      "recovery_codes_regenerated",
      "sessions_revoked_all",
      "email_change_code",
      "email_changed",
      "email_change_reverted",
      "badge_verified",
      "badge_removed",
      "delete_account_code",
      "account_deleted",
      "passkey_added",
      "passkey_removed",
      "passkey_suspect",
      "recovery_code_used",
      "staff_key_added",
      "staff_session_started",
      "staff_key_suspect",
      "staff_keys_revoked",
      "notice_received",
      "moderation_urgent",
    ] as const) {
      const r = renderTemplate(template, data);
      expect(r.subject.length, template).toBeGreaterThan(5);
      expect(r.text.length, template).toBeGreaterThan(20);
      // Links stay plain text (new_device carries the not-me URL that way); nothing is ever an anchor or an image.
      expect(r.html, template).not.toMatch(/<img|<a /);
    }
    const newDevice = renderTemplate("new_device", data);
    expect(newDevice.html).toContain("&lt;b&gt;Chrome&lt;/b&gt;");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
    const emailChanged = renderTemplate("email_changed", data);
    expect(emailChanged.html).toContain("new&lt;address&gt;@example.com");
    expect(emailChanged.text).toContain("new<address>@example.com");
    expect(emailChanged.text).toContain("http://localhost:8081/email-revert/def");
  });
  test("the mails that carry a lockdown link, and the note after one ran, say what the lockdown does (1c design, section 7.6)", () => {
    // The link's page says the same before the owner opens it (Task 7); the mail is where they first read it.
    const lockdownWording = (text: string) => {
      expect(text).toMatch(/signs out every session|every session was signed out/);
      expect(text).toMatch(/removes (your|the) password|password was removed/);
      expect(text).toMatch(/passkey/);
      expect(text).toMatch(/two-factor authentication/);
      expect(text).toMatch(/the day before/);
    };
    const newDevice = renderTemplate("new_device", { deviceLabel: "Chrome on Windows", notMeUrl: "http://localhost:8081/not-me/abc" });
    expect(newDevice.text).toContain("Chrome on Windows");
    expect(newDevice.text).toContain("24 hours");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
    lockdownWording(newDevice.text);
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("24 hours");
    expect(changed.text).toMatch(/back to this address/);
    expect(changed.text).toContain("http://localhost:8081/email-revert/abc");
    lockdownWording(changed.text);
    const reverted = renderTemplate("email_change_reverted", {});
    expect(reverted.text).toMatch(/back at this address/);
    expect(reverted.text).not.toMatch(/https?:\/\//);
    lockdownWording(reverted.text);
  });
  test("a recovery code spent at re-authentication is announced, without a link", () => {
    const used = renderTemplate("recovery_code_used", {});
    expect(used.subject).toBe("A recovery code was used on your korbat account");
    expect(used.text).toMatch(/recovery code/);
    expect(used.text).toMatch(/once/);
    expect(used.text).toMatch(/If this was not you/);
    expect(used.text).not.toMatch(/https?:\/\//);
  });
  test("the account lifecycle templates say what happened and what to do if it was not the owner", () => {
    const changeCode = renderTemplate("email_change_code", { code: "654321" });
    expect(changeCode.text).toContain("654321");
    expect(changeCode.text).toContain("10 minutes");
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("new@example.com");
    expect(changed.text).toMatch(/stays? signed in/);
    expect(changed.text).toMatch(/If this was not you, open this link within 24 hours\./);
    expect(changed.text).toMatch(/: http:\/\/localhost:8081\/email-revert\/abc$/m);
    // A change while an earlier change's link is still out sends no link of its own, and says where the one that works went.
    const again = renderTemplate("email_changed", { email: "new@example.com" });
    expect(again.text).toContain("new@example.com");
    expect(again.text).not.toMatch(/https?:\/\//);
    expect(again.text).toMatch(/less than a day ago/);
    const reverted = renderTemplate("email_change_reverted", {});
    expect(reverted.text).toMatch(/back at this address/);
    expect(reverted.text).toMatch(/every session/i);
    const deleteCode = renderTemplate("delete_account_code", { code: "111222" });
    expect(deleteCode.text).toContain("111222");
    expect(deleteCode.text).toMatch(/delete/i);
    expect(deleteCode.text).toMatch(/revoke|sign out/i);
    expect(renderTemplate("account_deleted", {}).text).toMatch(/cannot be undone/);
    expect(renderTemplate("badge_verified", {}).text).toMatch(/verified/i);
    expect(renderTemplate("badge_removed", {}).text).toMatch(/removed/i);
  });
  test("the passkey templates name the passkey, say what happened and what to do, and never let the name become HTML", () => {
    const name = `<img src=x onerror=alert(1)> "Work" laptop`;
    const removeUrl = "http://localhost:8081/passkey-remove/abc";
    const added = renderTemplate("passkey_added", { name, deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl });
    expect(added.subject).toBe("A passkey was added to your korbat account");
    expect(added.text).toContain(name);
    expect(added.text).toContain("Chrome on Windows");
    expect(added.text).toContain("2026-09-25 10:00 UTC");
    expect(added.text).toContain(removeUrl);
    expect(added.text).toContain("7 days");
    // What the link does (the lockdown of the 1c design, section 7.6), before the owner opens it.
    expect(added.text).toMatch(/removes? (this|the) passkey/);
    expect(added.text).toMatch(/sign(s)? out every session/);
    expect(added.text).toMatch(/password/);
    expect(added.text).toMatch(/two-factor authentication/);
    expect(added.text).toMatch(/the day before/);
    expect(added.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Work&quot; laptop");
    expect(added.html).not.toMatch(/<img|<a /);
    expect(added.html).toContain(removeUrl);

    const removed = renderTemplate("passkey_removed", { name, time: "2026-09-25 11:00 UTC" });
    expect(removed.subject).toBe("A passkey was removed from your korbat account");
    expect(removed.text).toContain(name);
    expect(removed.text).toContain("2026-09-25 11:00 UTC");
    expect(removed.text).not.toMatch(/https?:\/\//);
    expect(removed.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(removed.html).not.toMatch(/<img|<a /);

    const suspect = renderTemplate("passkey_suspect", { name });
    expect(suspect.subject).toBe("A passkey on your korbat account was switched off");
    expect(suspect.text).toContain(name);
    expect(suspect.text).toMatch(/copy/);
    expect(suspect.text).toMatch(/switched (it|that passkey) off/);
    expect(suspect.text).toMatch(/remove it/i);
    expect(suspect.text).toMatch(/add a new one/);
    expect(suspect.text).not.toMatch(/https?:\/\//);
    expect(suspect.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(suspect.html).not.toMatch(/<img|<a /);
  });
  describe("the staff mails (3a design, section 7)", () => {
    const LAST = "korbat never puts a link in a staff email.";
    const name = `<img src=x onerror=alert(1)> "Blue" key`;

    /** Plain paragraphs with no link of any kind, the last one saying so; and a user-written name never becomes HTML. */
    function linkless(template: string, r: { text: string; html: string }) {
      expect(r.text, template).not.toMatch(/https?:|www\.|:\/\//);
      expect(r.html, template).not.toMatch(/<img|<a |href=|https?:/);
      expect(r.text.trimEnd().split("\n\n").at(-1), template).toBe(LAST);
    }

    test("staff_key_added names the key and the time, and tells the person to go to the operator if it was not them", () => {
      const r = renderTemplate("staff_key_added", { name, time: "2026-10-01 09:30 UTC" });
      expect(r.subject).toBe("A staff key was added to your korbat staff account");
      expect(r.text).toBe(
        [
          `A staff key named "${name}" was registered for your korbat staff account at 2026-10-01 09:30 UTC. It can open the staff console.`,
          "If this was you, there is nothing to do. If not, tell the operator at once; they revoke the key with the staff command line.",
          LAST,
        ].join("\n\n") + "\n",
      );
      expect(r.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Blue&quot; key");
      linkless("staff_key_added", r);
    });

    test("staff_session_started names the key, the browser and the time", () => {
      const r = renderTemplate("staff_session_started", { name, browser: "Firefox on Linux", time: "2026-10-01 09:31 UTC" });
      expect(r.subject).toBe("A staff session started on the korbat console");
      expect(r.text).toBe(
        [
          `A staff session was started on the korbat console at 2026-10-01 09:31 UTC with your staff key "${name}", from Firefox on Linux.`,
          "If this was you, there is nothing to do. If not, someone holds that key: tell the operator at once; they revoke it and every session it opened with the staff command line.",
          LAST,
        ].join("\n\n") + "\n",
      );
      linkless("staff_session_started", r);
    });

    test("staff_key_suspect says the key was switched off as a likely copy, and never sends the person to the app's Security screen", () => {
      const r = renderTemplate("staff_key_suspect", { name });
      expect(r.subject).toBe("A staff key on your korbat staff account was switched off");
      expect(r.text).toBe(
        [
          `A use of your staff key "${name}" on the korbat console (a sign-in or a confirmation) looked like a copy of it, so korbat switched that key off and ended every staff session it opened. It can no longer open the console.`,
          "Ask the operator for a link to register a new key. If you did not use it just now, tell them so: someone else holds a copy of the key.",
          LAST,
        ].join("\n\n") + "\n",
      );
      expect(r.text).not.toMatch(/Security/);
      linkless("staff_key_suspect", r);
    });

    test("staff_keys_revoked lists the keys and the time", () => {
      const r = renderTemplate("staff_keys_revoked", { names: `"${name}", "Red key"`, time: "2026-10-01 09:32 UTC" });
      expect(r.subject).toBe("Staff keys revoked on your korbat staff account");
      expect(r.text).toBe(
        [
          `These staff keys of your korbat staff account were revoked at 2026-10-01 09:32 UTC: "${name}", "Red key". They can no longer open the console, and every staff session they opened has ended.`,
          "If you expected this, there is nothing to do. If not, ask the operator why.",
          LAST,
        ].join("\n\n") + "\n",
      );
      linkless("staff_keys_revoked", r);
    });

    test("each staff mail needs its data", () => {
      expect(() => renderTemplate("staff_key_added", { name: "Blue key" })).toThrow(/time/);
      expect(() => renderTemplate("staff_key_added", { time: "2026-10-01 09:30 UTC" })).toThrow(/name/);
      expect(() => renderTemplate("staff_session_started", { name: "Blue key", time: "2026-10-01 09:31 UTC" })).toThrow(/browser/);
      expect(() => renderTemplate("staff_key_suspect", {})).toThrow(/name/);
      expect(() => renderTemplate("staff_keys_revoked", { time: "2026-10-01 09:32 UTC" })).toThrow(/names/);
    });
  });

  describe("the moderation mails of reports and notices (3c design, section 7.15)", () => {
    const LAST_USER = "korbat staff never ask for your password or a code, and korbat does not read replies to this email.";
    const LAST_STAFF = "korbat never puts a link in a staff email.";
    const POST_LINK = "http://localhost:8081/post/0190f3a2-7c1e-7b1a-9f00-0123456789ab";
    const ACCOUNT_LINK = "http://localhost:8081/u/ada";
    const received = { ref: "N-ABCDEFGH23", time: "2026-10-04 06:59 UTC", items: `${POST_LINK}, ${ACCOUNT_LINK}`, termsUrl: "http://localhost:8081/terms" };
    const paragraphs = (text: string) => text.trimEnd().split("\n\n");

    test("notice_received to a signed-out notifier: the reference, the time, the links, and the page with the mail token in its fragment", () => {
      const pageUrl = "http://localhost:8081/notice/N-ABCDEFGH23#t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const r = renderTemplate("notice_received", { ...received, pageUrl });
      expect(r.subject).toBe("korbat received your report N-ABCDEFGH23");
      expect(paragraphs(r.text)).toEqual([
        `korbat received your report N-ABCDEFGH23 at 2026-10-04 06:59 UTC. It names: ${POST_LINK}, ${ACCOUNT_LINK}.`,
        "A moderator decides each item that names something on korbat; a link that names nothing is answered automatically. You get one email with every decision, at most once a day.",
        `To see where your report stands, ask for a re-examination of a decision, confirm that you sent it, or stop korbat's emails about reports to this address, open this page: ${pageUrl}`,
        "How korbat handles reports, and what it keeps: http://localhost:8081/terms.",
        LAST_USER,
      ]);
      // The page link stands at the end of its paragraph, so nothing after it can be taken for a part of the token.
      expect(r.text).toMatch(/#t=A{43}$/m);
      expect(r.html).not.toMatch(/<img|<a |href=/);
    });

    test("notice_received to an account: no page link, and where to follow the report in the app", () => {
      const r = renderTemplate("notice_received", received);
      expect(paragraphs(r.text)).toEqual([
        `korbat received your report N-ABCDEFGH23 at 2026-10-04 06:59 UTC. It names: ${POST_LINK}, ${ACCOUNT_LINK}.`,
        "A moderator decides each item that names something on korbat; a link that names nothing is answered automatically. You get one email with every decision, at most once a day.",
        "You can follow it in korbat under Settings, Cases, Your reports.",
        "How korbat handles reports, and what it keeps: http://localhost:8081/terms.",
        LAST_USER,
      ]);
      expect(r.text).not.toMatch(/[/]notice[/]|#t=/);
    });

    test("notice_received carries only what korbat generated, and needs each of its fields", () => {
      expect(() => renderTemplate("notice_received", { ...received, ref: "" })).toThrow(/ref/);
      for (const key of ["ref", "time", "items", "termsUrl"] as const) {
        const { [key]: _left, ...rest } = received;
        expect(() => renderTemplate("notice_received", rest), key).toThrow(new RegExp(key));
      }
      // A report's words have no field to travel in: a member the template does not know is not printed.
      const r = renderTemplate("notice_received", { ...received, explanation: "the notifier's own words", name: "Ada" });
      expect(r.text).not.toMatch(/the notifier's own words|Ada/);
    });

    test("moderation_urgent gives the count and the oldest time, no link and no content, and says it is the only alert", () => {
      const r = renderTemplate("moderation_urgent", { count: "3", oldest: "2026-10-04 06:59 UTC" });
      expect(r.subject).toBe("korbat: a case is waiting in the urgent lane");
      expect(paragraphs(r.text)).toEqual([
        "3 cases in the urgent lane (child sexual abuse or exploitation, direct threats, violence, public security or self-harm) are waiting; the oldest since 2026-10-04 06:59 UTC.",
        "Open the staff console. Until the phone alerts of sub-project 3e, this email is the only alert.",
        LAST_STAFF,
      ]);
      expect(r.text).not.toMatch(/https?:|www[.]|:[/][/]/);
      expect(r.html).not.toMatch(/<img|<a |href=|https?:/);
      // One case reads as one: the only case is the oldest, so the sentence gives its time alone.
      const one = renderTemplate("moderation_urgent", { count: "1", oldest: "2026-10-04 06:59 UTC" });
      expect(one.subject).toBe("korbat: a case is waiting in the urgent lane");
      expect(paragraphs(one.text)).toEqual([
        "1 case in the urgent lane (child sexual abuse or exploitation, direct threats, violence, public security or self-harm) is waiting, since 2026-10-04 06:59 UTC.",
        "Open the staff console. Until the phone alerts of sub-project 3e, this email is the only alert.",
        LAST_STAFF,
      ]);
      for (const count of ["2", "10", "11", "21"]) {
        expect(renderTemplate("moderation_urgent", { count, oldest: "2026-10-04 06:59 UTC" }).text, count).toContain(`${count} cases in the urgent lane (child sexual abuse or exploitation, direct threats, violence, public security or self-harm) are waiting; the oldest since 2026-10-04 06:59 UTC.`);
      }
      expect(() => renderTemplate("moderation_urgent", { count: "3" })).toThrow(/oldest/);
      expect(() => renderTemplate("moderation_urgent", { oldest: "2026-10-04 06:59 UTC" })).toThrow(/count/);
    });
  });

  test("missing template data is a programming error", () => {
    expect(() => renderTemplate("sign_in_code", {})).toThrow(/code/);
    expect(() => renderTemplate("passkey_added", { name: "Phone", deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC" })).toThrow(/removeUrl/);
    expect(() => renderTemplate("passkey_added", { deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl: "http://localhost:8081/passkey-remove/abc" })).toThrow(/name/);
    expect(() => renderTemplate("passkey_removed", { name: "Phone" })).toThrow(/time/);
    expect(() => renderTemplate("passkey_suspect", {})).toThrow(/name/);
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

### Replace `apps/api/test/middleware.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import pino from "pino";
import type { AppEnv } from "../src/env";
import { observability } from "../src/middleware/observability";
import { noStore, securityHeaders } from "../src/middleware/security-headers";
import { MemoryStore, rateLimit } from "../src/middleware/rate-limit";
import { validate } from "../src/lib/validate";
import { clientIdentity, clientNetwork, resolveClientIp } from "../src/auth/client-ip";

const silent = pino({ level: "silent" });

function base() {
  const app = new Hono<AppEnv>();
  app.use(observability(silent));
  app.use(securityHeaders, noStore);
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
  test("a hit given back with release leaves the count one lower in the same window, and never below zero", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    await store.hit("k", 10_000);
    now += 4_000;
    await store.hit("k", 10_000);
    await store.release("k");
    // One hit left, and the window still ends where the first hit put it: nothing was restarted.
    expect(await store.hit("k", 10_000)).toEqual({ count: 2, resetMs: 6_000 });
    await store.release("k");
    await store.release("k");
    await store.release("k");
    expect(await store.hit("k", 10_000)).toEqual({ count: 1, resetMs: 6_000 });
    // A key that was never hit has nothing to give back, and another key is not touched.
    await store.release("never");
    expect(await store.hit("never", 10_000)).toEqual({ count: 1, resetMs: 10_000 });
    // Once the window is over, a release belongs to no window and the next hit opens a fresh one.
    now += 6_000;
    await store.release("k");
    expect(await store.hit("k", 10_000)).toEqual({ count: 1, resetMs: 10_000 });
  });
  test("a failing store answers 503 with Retry-After instead of letting the request through", async () => {
    const store = {
      hit: async () => {
        throw new Error("redis down");
      },
      release: async () => undefined,
    };
    const app = base().use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" })).get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toMatchObject({ error: { code: "service_unavailable" } });
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

describe("client identity", () => {
  const key = Buffer.alloc(32, 1);
  const spoofed = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.7, 10.0.0.1" };
  const seen = async (trust: "cloudflare" | "caddy" | "none", ipHashKey = key) => {
    const app = base().use(clientIdentity({ trust, ipHashKey })).get("/x", (c) => c.json({ ip: c.get("clientIp"), hash: c.get("clientIpHash") }));
    return (await (await app.request("/x", { headers: spoofed })).json()) as { ip: string; hash: string };
  };
  test("cloudflare mode believes cf-connecting-ip", async () => {
    expect((await seen("cloudflare")).ip).toBe("203.0.113.9");
  });
  test("caddy mode takes the first forwarded entry and ignores cf-connecting-ip", async () => {
    expect((await seen("caddy")).ip).toBe("198.51.100.7");
  });
  test("none mode uses the socket only, so a spoofed header opens no bucket", async () => {
    expect((await seen("none")).ip).toBe("direct");
  });
  test("the hash is keyed and never the address itself", async () => {
    const a = await seen("cloudflare");
    const b = await seen("cloudflare", Buffer.alloc(32, 2));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.ip);
    expect(a.hash).not.toBe(b.hash);
  });
  test("missing headers fall back down the list", () => {
    const c = { req: { header: () => undefined } } as unknown as Parameters<typeof resolveClientIp>[0];
    for (const trust of ["cloudflare", "caddy", "none"] as const) expect(resolveClientIp(c, trust)).toBe("direct");
  });

  describe("the network an address belongs to, for the limits that count per network (3c design, section 7.1)", () => {
    test("an IPv4 address is its own network; an IPv6 address is its first 64 bits, however it is written", () => {
      expect(clientNetwork("203.0.113.9")).toBe("203.0.113.9");
      expect(clientNetwork("2001:db8:1234:5678:9abc:def0:1234:5678")).toBe("2001:db8:1234:5678::/64");
      expect(clientNetwork("2001:db8:1234:5678::1")).toBe("2001:db8:1234:5678::/64");
      expect(clientNetwork("2001:DB8:1234:5678:FFFF:FFFF:FFFF:FFFF")).toBe("2001:db8:1234:5678::/64");
      // Leading zeros and the compressed form name the same network.
      expect(clientNetwork("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8:0:0::/64");
      expect(clientNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
      expect(clientNetwork("::1")).toBe("0:0:0:0::/64");
      expect(clientNetwork("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
      // Another /64 is another network.
      expect(clientNetwork("2001:db8:1234:5679::1")).toBe("2001:db8:1234:5679::/64");
    });
    test("an IPv4 address written as an IPv6 one counts as the IPv4 address it is", () => {
      expect(clientNetwork("::ffff:203.0.113.9")).toBe("203.0.113.9");
      expect(clientNetwork("::FFFF:203.0.113.9")).toBe("203.0.113.9");
    });
    test("what is no address is taken as it is, so a request without one still has a bucket", () => {
      expect(clientNetwork("direct")).toBe("direct");
      expect(clientNetwork("not an address")).toBe("not an address");
    });
    test("the middleware sets its keyed hash beside the address's: one hash for a whole /64, another for the next, never the network itself", async () => {
      const netOf = async (ip: string, ipHashKey = key) => {
        const app = base().use(clientIdentity({ trust: "cloudflare", ipHashKey })).get("/x", (c) => c.json({ hash: c.get("clientIpHash"), net: c.get("clientNetHash") }));
        return (await (await app.request("/x", { headers: { "cf-connecting-ip": ip } })).json()) as { hash: string; net: string };
      };
      const [one, two, next] = [await netOf("2001:db8:1234:5678::1"), await netOf("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd"), await netOf("2001:db8:1234:5679::1")];
      expect(one.net).toMatch(/^[0-9a-f]{64}$/);
      expect(two.net).toBe(one.net);
      expect(next.net).not.toBe(one.net);
      // The address's own hash still tells the two addresses apart.
      expect(two.hash).not.toBe(one.hash);
      expect(one.net).not.toBe(one.hash);
      expect((await netOf("2001:db8:1234:5678::1", Buffer.alloc(32, 2))).net).not.toBe(one.net);
      const v4 = await netOf("203.0.113.9");
      expect(v4.net).toMatch(/^[0-9a-f]{64}$/);
      expect(v4.net).not.toBe(v4.hash);
      expect((await netOf("::ffff:203.0.113.9")).net).toBe(v4.net);
      expect((await netOf("203.0.113.10")).net).not.toBe(v4.net);
    });
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

### Replace `apps/api/test/moderation-context.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { ModerationErrorCode } from "@korbat/contracts";
import { ModerationError, isModerationErrorCode, moderationErrorMessage } from "../src/moderation/context";

describe("the moderation module's refusals", () => {
  test("each of the seventeen codes this module raises answers with the status the design gives it (3c design, section 10)", () => {
    const statuses = {
      notice_link_invalid: 422,
      notice_link_offsite: 422,
      human_check_failed: 403,
      staff_cannot_report: 403,
      notice_not_found: 404,
      already_reported: 409,
      case_changed: 409,
      case_closed: 409,
      staff_recused: 403,
      staff_target: 403,
      admin_required: 403,
      decision_cap: 429,
      profile_changed: 409,
      snapshot_mismatch: 409,
      snapshot_erased: 409,
      text_not_found: 409,
      invalid_decision: 422,
    } as const;
    // The table above is the whole of the contracts' list, so a code added there fails here until its status is pinned.
    expect(Object.keys(statuses).sort()).toEqual([...ModerationErrorCode.options].sort());
    for (const [code, status] of Object.entries(statuses) as [keyof typeof statuses, number][]) {
      const err = new ModerationError(code);
      expect([err.name, err.code, err.status], code).toEqual(["ModerationError", code, status]);
      expect(err.message, code).toBe(moderationErrorMessage(code));
      expect(err.message.length, code).toBeGreaterThan(10);
      expect(isModerationErrorCode(code), code).toBe(true);
    }
    // What the audit function raises is an answer of the decision, never one of these codes.
    expect(isModerationErrorCode("staff_confirmation_ended")).toBe(false);
    expect(isModerationErrorCode("staff_confirmation_late")).toBe(false);
    // The module's own answers beside them.
    expect([new ModerationError("not_found").status, new ModerationError("invalid_request").status]).toEqual([404, 400]);
    // A session that has not finished onboarding is refused as requireSession refuses it, in the same words.
    expect(new ModerationError("onboarding_required")).toMatchObject({ status: 403, message: "Choose a handle to finish setting up your account." });
    expect([new ModerationError("rate_limited").status, new ModerationError("service_unavailable").status]).toEqual([429, 503]);
  });

  test("the words of the notice routes are written for the person reporting, and the human check names no address", () => {
    expect(moderationErrorMessage("human_check_failed")).toBe("We could not verify that you are human. Try again.");
    expect(moderationErrorMessage("already_reported")).toBe("You already reported this; it is being looked at.");
    for (const code of ["notice_link_invalid", "notice_link_offsite", "human_check_failed", "staff_cannot_report", "notice_not_found"] as const) {
      expect(moderationErrorMessage(code), code).not.toMatch(/@|https?:/);
    }
  });
});
```

### Replace `apps/api/test/staff/app-mount.test.ts` (whole file)

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { createDb } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { mediaForCases } from "../../src/media";
import { createMediaFiles } from "../../src/media/files";
import { createMediaRepo } from "../../src/media/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const APP_ORIGIN = "http://localhost:8081";
const TRUSTED = "http://localhost:8080";
const CONSOLE_ORIGIN = "http://console.localhost:8090";
const CONSOLE_HOST = "console.localhost:8090";
/** The staff prefix itself, with and without its final slash (distinct paths to Hono's router), and a path under it. */
const PROBE_PATHS = ["/api/staff", "/api/staff/", "/api/staff/probe"];

/**
 * createApp with the staff module (3a design, section 5), the console on or off. The pools are created but never connect:
 * nothing here reaches a flow. `probe` adds a stub route at each of PROBE_PATHS before the first request builds the router,
 * standing in for a route that needs no session, so a request that passes the gate can be told from one that does not: without a route
 * there, a wrong Host and a missing route both end in the same unknown-route 404, gate or no gate.
 */
function build(consoleOrigin: string | undefined, probe = false) {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN,
    TRUSTED_ORIGINS: TRUSTED,
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    NOTIFIER_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    ...(consoleOrigin === undefined ? {} : { CONSOLE_ORIGIN: consoleOrigin }),
  });
  const logger = pino({ level: "silent" });
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  // The media module's interface for cases, over volumes nothing here creates: no route of this test reads an image.
  const media = mediaForCases({ repo: createMediaRepo(apiDb), files: createMediaFiles({ uploadsDir: "no-uploads", storeDir: "no-store", log: logger }), log: logger });
  const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media, rateLimitStore: new MemoryStore(), config, logger });
  const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
  const app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  const seen: { session: unknown; method: string; path: string }[] = [];
  if (probe) {
    app.on(["GET", "POST"], PROBE_PATHS, (c) => {
      seen.push({ session: c.get("session"), method: c.req.method, path: c.req.path });
      return c.json({ ok: true });
    });
  }
  return { app, seen, auth };
}

type ErrorBody = { error: { code: string; message: string; requestId?: string } };

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

describe("the staff module in createApp", () => {
  test("with CONSOLE_ORIGIN unset, every path under /api/staff is the unknown route, whatever the request carries", async () => {
    const { app } = build(undefined);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    for (const [method, path, headers] of [
      ["GET", "/api/staff", { host: CONSOLE_HOST }],
      ["GET", "/api/staff/me", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
      // A write from a foreign origin would meet resolveSession's csrf_failed on any other path.
      ["POST", "/api/staff/signout", { host: CONSOLE_HOST, origin: "https://evil.example" }],
      // A preflight from an origin the app trusts would meet the app's CORS on any other path.
      ["OPTIONS", "/api/staff/me", { origin: TRUSTED, "access-control-request-method": "POST" }],
    ] as const) {
      const res = await app.request(path, { method, headers });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(accessControlHeaders(res), `${method} ${path}`).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
    }
  });

  test("with CONSOLE_ORIGIN set, the staff gate stands before every staff path, the prefix itself included", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    // Another Host: the same 404 as an unknown route, so the console cannot tell a wrong address from a console that is off.
    // Each of these paths has a route, so the 404 is the gate's: for another host, the console's host without its port, and
    // no Host at all.
    for (const path of PROBE_PATHS) {
      for (const headers of [{ host: "localhost:8080" }, { host: "console.localhost" }, {}]) {
        const res = await app.request(path, { headers });
        expect(res.status, `${path} ${JSON.stringify(headers)}`).toBe(404);
        expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
      }
    }
    // The console's Host with another Origin: refused by the gate before any route runs.
    const foreign = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST, origin: APP_ORIGIN } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: { code: "csrf_failed" } });
    expect(seen).toEqual([]);
    // Through the gate, a path no route answers is still the unknown route.
    expect((await app.request("/api/staff/nothing-here", { headers: { host: CONSOLE_HOST } })).status).toBe(404);
    // The console's Host reaches the route at every one of them, the prefix itself included.
    for (const path of PROBE_PATHS) expect((await app.request(path, { headers: { host: CONSOLE_HOST } })).status, path).toBe(200);
    expect(seen.map((request) => request.path)).toEqual(PROBE_PATHS);
  });

  test("a console write carrying the app's session and CSRF cookies reaches the staff route: the app's session is never resolved there", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: {
        host: CONSOLE_HOST,
        origin: CONSOLE_ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: "__Host-korbat_session=not-a-session; __Host-korbat_csrf=abc",
        authorization: "Bearer not-a-token",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ session: undefined, method: "POST", path: "/api/staff/probe" }]);
  });

  test("no staff answer carries CORS headers, even to an origin the app trusts; the app's other paths keep them", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    for (const [method, headers] of [
      ["GET", { host: CONSOLE_HOST, origin: TRUSTED }],
      ["OPTIONS", { host: CONSOLE_HOST, origin: TRUSTED, "access-control-request-method": "POST" }],
      ["GET", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
    ] as const) {
      const res = await app.request("/api/staff/probe", { method, headers });
      expect(accessControlHeaders(res), `${method} ${headers.origin}`).toEqual([]);
    }
    // The one path test: /api/staff and what begins with /api/staff/, never a path that merely starts with the letters.
    const neighbour = await app.request("/api/staffing", { headers: { origin: TRUSTED } });
    expect(neighbour.status).toBe(404);
    expect(neighbour.headers.get("access-control-allow-origin")).toBe(TRUSTED);
    const health = await app.request("/api/health", { headers: { origin: TRUSTED } });
    expect(health.headers.get("access-control-allow-origin")).toBe(TRUSTED);
  });

  test("the enrolment routes stand behind the gate and validate their bodies before any flow runs", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    for (const path of ["/api/staff/enroll/options", "/api/staff/enroll/verify"]) {
      const post = (headers: Record<string, string>, body: unknown) =>
        app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      // Another Host is the unknown route, another Origin the gate's refusal, a write without an Origin too.
      expect((await post({ host: "localhost:8080", origin: CONSOLE_ORIGIN }, {})).status, path).toBe(404);
      const foreign = await post({ host: CONSOLE_HOST, origin: APP_ORIGIN }, {});
      expect([path, foreign.status, ((await foreign.json()) as ErrorBody).error.code]).toEqual([path, 403, "csrf_failed"]);
      expect((await post({ host: CONSOLE_HOST }, {})).status, path).toBe(403);
      // Through the gate, a body the contracts refuse is invalid_request; the pools behind the flows are never reached.
      const invalid = await post({ host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }, { token: "short", name: "", kind: "phone" });
      expect([path, invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([path, 400, "invalid_request"]);
    }
  });

  test("the session routes stand behind the gate and requireStaff: without a staff cookie each is staff_session_required with both staff cookies cleared, before any database read", async () => {
    // The pools point at a port nothing listens on: a route that read the database would fail with another answer.
    const { app } = build(CONSOLE_ORIGIN);
    const routes = [
      ["GET", "/api/staff/me"],
      ["GET", "/api/staff/sessions"],
      ["GET", "/api/staff/keys"],
      ["GET", "/api/staff/audit"],
      ["POST", "/api/staff/signout"],
      // Step-up and the revocation it confirms: no session, no confirmation is even read.
      ["POST", "/api/staff/step-up/options"],
      ["DELETE", "/api/staff/sessions/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"],
    ] as const;
    for (const [method, path] of routes) {
      // Another Host is still the unknown route, before any session is looked for.
      expect((await app.request(path, { method, headers: { host: "localhost:8080", origin: CONSOLE_ORIGIN } })).status, path).toBe(404);
      // The app's session cookie and a bearer token are not staff sessions.
      const res = await app.request(path, {
        method,
        headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_session=kb1_x; __Host-korbat_csrf=c", "x-csrf-token": "c", authorization: `Bearer kb1_${"A".repeat(43)}` },
      });
      expect([path, res.status, ((await res.json()) as ErrorBody).error.code]).toEqual([path, 401, "staff_session_required"]);
      const cleared = res.headers.getSetCookie();
      expect(cleared.map((line) => line.slice(0, line.indexOf("="))).sort(), path).toEqual(["__Host-korbat_staff", "__Host-korbat_staff_csrf"]);
      for (const line of cleared) expect(line, path).toContain("Max-Age=0");
      expect(accessControlHeaders(res), path).toEqual([]);
    }
  });

  test("a staff write with the staff cookie but without the staff CSRF header is csrf_failed, before any database read", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    for (const [method, path] of [
      ["POST", "/api/staff/signout"],
      ["POST", "/api/staff/step-up/options"],
      ["DELETE", "/api/staff/sessions/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"],
    ] as const) {
      const res = await app.request(path, { method, headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_staff=x; __Host-korbat_staff_csrf=y" } });
      expect([path, res.status]).toEqual([path, 403]);
      expect(((await res.json()) as ErrorBody).error.code).toBe("csrf_failed");
      // A refused write ends nothing: the cookies stay.
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  test("the sign-in options need no session and read no database: a staff sign-in challenge for discoverable, user-verified credentials of the console", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    const res = await app.request("/api/staff/signin/options", { method: "POST", headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN } });
    expect(res.status).toBe(200);
    const { options } = (await res.json()) as { options: { rpId: string; challenge: string; allowCredentials?: unknown[]; userVerification: string } };
    expect(options.rpId).toBe("console.localhost");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("required");
    expect(Buffer.from(options.challenge, "base64url")).toHaveLength(58);
    expect(res.headers.getSetCookie()).toEqual([]);
    // The verification validates its body before any flow runs.
    const invalid = await app.request("/api/staff/signin/verify", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ response: { id: "x" } }),
    });
    expect([invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([400, "invalid_request"]);
  });

  test("no staff power remains in the app: the auth module offers no requireStaffMfa, and no source names it", () => {
    const { auth } = build(CONSOLE_ORIGIN);
    expect(Object.keys(auth)).not.toContain("requireStaffMfa");
    expect(Object.keys(auth)).toContain("requireStaff");
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const mentions = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts") && readFileSync(join(src, file), "utf8").includes("requireStaffMfa"));
    expect(mentions).toEqual([]);
  });

  test("staff paths keep the JSON body limit and the API's headers", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ x: "x".repeat(70_000) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "payload_too_large" } });
    const ok = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST } });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

### Replace `apps/api/test/staff/route-table.test.ts` (whole file)

```ts
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { AuditEntry, AuditPage, CaseDecisionResponse, StaffEnrollVerifyResponse, StaffKey, StaffKeysResponse, StaffMe, StaffSession, StaffSessionsResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createSocial, socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const CONSOLE_ORIGIN = "http://console.localhost:8090";

interface RouteEntry {
  method: string;
  path: string;
}

/**
 * The real app with every module and the console on (3a design, section 11). The database pools are created but never
 * connect: only the route table is read. Returns the app and the staff module's own routes, as it would mount them.
 */
function build() {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN: "http://localhost:8081",
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    NOTIFIER_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    CONSOLE_ORIGIN,
  });
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
  const mediaRoot = mkdtempSync(path.join(tmpdir(), "korbat-route-table-"));
  const media = createMedia({
    apiDb,
    uploadsDir: path.join(mediaRoot, "uploads"),
    storeDir: path.join(mediaRoot, "store"),
    formats: config.MEDIA_FORMATS,
    minFreeBytes: 0,
    logger,
    requireSession: auth.requireSession,
    resolveSession: auth.resolveSession,
    rateLimitStore,
    enforceUploadLimit: async () => undefined,
  });
  const account = createAccount({
    auth: auth.forAccount,
    social: social.forAccount,
    media: media.forAccount,
    requireSession: auth.requireSession,
    requireFreshAuth: auth.requireFreshAuth(),
    requireStrongFreshAuth: auth.requireStrongFreshAuth(),
    rateLimitStore,
    logger,
  });
  const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: media.forCases, rateLimitStore, config, logger });
  const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account, staff, moderation });
  // What the staff module mounts at /api/staff, as createApp mounts it.
  const staffOwn = staff.routes(CONSOLE_ORIGIN).routes.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
  return { app, staffOwn };
}

const isStaffPath = (p: string) => p === "/api/staff" || p.startsWith("/api/staff/");
const keyOf = (r: RouteEntry) => `${r.method} ${r.path}`;

/** Each method and path once, sorted: Hono lists a route once for every handler it chains. */
const distinct = (routes: RouteEntry[]) => [...new Set(routes.map(keyOf))].sort();

/**
 * A Hono path as a pattern: a parameter matches one segment, and a final wildcard the path itself and anything below it.
 * The app's paths hold only letters, digits, dashes, underscores and dots, so nothing else needs escaping.
 */
function patternOf(routePath: string): RegExp {
  const segments = routePath.split("/").map((segment) => {
    if (segment === "*") return ".*";
    if (segment.startsWith(":")) return "[^/]+";
    if (!/^[A-Za-z0-9_.-]*$/.test(segment)) throw new Error(`a path segment this check cannot read: ${segment}`);
    return segment.replaceAll(".", "[.]");
  });
  const last = segments.length - 1;
  // "/x/*" matches /x itself too, as Hono routes it.
  const body = segments[last] === ".*" ? `${segments.slice(0, last).join("/")}(/.*)?` : segments.join("/");
  return new RegExp(`^${body}$`);
}

/** A lower-case uuid, as a staff path's parameter (a session's handle, a case's id) takes one. */
const SAMPLE_PARAMETER = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

/**
 * Paths under /api/staff a route of another module could answer, built from the staff module's own route table: each of
 * its paths with every parameter filled in, and each path that leads to one (/api/staff/signin for /signin/verify), so a
 * staff route added later is probed too; then the prefix itself, with a final slash, and a path the module does not have.
 * A foreign route that reaches one of them answers there for any method the staff module does not define, behind the gate
 * but with no app session, since createApp skips resolveSession on staff paths.
 */
function staffProbes(staffOwn: RouteEntry[]): string[] {
  const probes = new Set(["/api/staff", "/api/staff/", "/api/staff/x/y"]);
  for (const route of staffOwn) {
    if (!isStaffPath(route.path) || route.path.includes("*")) continue;
    const segments = route.path.split("/").map((segment) => (segment.startsWith(":") ? SAMPLE_PARAMETER : segment));
    for (let end = 3; end <= segments.length; end++) probes.add(segments.slice(0, end).join("/"));
  }
  return [...probes];
}

/**
 * The routes of the app that answer under /api/staff without being the staff module's own: every route not among those
 * the staff module mounts there (as many times as it mounts each) whose path lies under /api/staff or whose pattern
 * reaches a path there (staffProbes). The app's own chain,
 * registered on every path ("ALL /*"), is the one exception: request id, access log, client identity, headers and limits
 * apply to staff paths too (3a design, section 5).
 */
function foreignStaffRoutes(appRoutes: RouteEntry[], staffOwn: RouteEntry[]): string[] {
  const own = new Map<string, number>();
  for (const route of staffOwn) own.set(keyOf(route), (own.get(keyOf(route)) ?? 0) + 1);
  const probes = staffProbes(staffOwn);
  const foreign: string[] = [];
  for (const route of appRoutes) {
    const k = keyOf(route);
    if (k === "ALL /*") continue;
    const left = own.get(k) ?? 0;
    if (left > 0) {
      own.set(k, left - 1);
      continue;
    }
    const pattern = patternOf(route.path);
    if (isStaffPath(route.path) || probes.some((probe) => pattern.test(probe))) foreign.push(k);
  }
  return foreign;
}

/** A route path naming a role, a grant or a promotion: what a route that changes a role would be called. */
const ROLE_PATH = new RegExp("(^|/)(roles?|grants?|grant-role|promote|demote|make-staff|staff-role)(/|$)", "i");

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));
function sources(): { path: string; source: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  return walk(SRC_ROOT).map((full) => ({ path: path.relative(SRC_ROOT, full).split(path.sep).join("/"), source: readFileSync(full, "utf8") }));
}

/**
 * Where an account's role may be changed: the repository's statements (changeRole for grant-role, setRole for the tests)
 * are reached only through grant-role's grantRole, which only the auth index (for the command line) and grant-role's own
 * command name. A route that changed a role would have to name one of them.
 */
const ROLE_WRITERS = /\b(changeRole|setRole|grantRole)\b/;
const ROLE_WRITER_FILES = new Set(["auth/repo.ts", "auth/admin.ts", "auth/index.ts", "cli/grant-role.ts"]);
const roleWriterViolations = (files: { path: string; source: string }[]) => files.filter((f) => !ROLE_WRITER_FILES.has(f.path) && ROLE_WRITERS.test(f.source)).map((f) => f.path);

/** A member of a staff answer that would name a person beyond their public handle: an address, a device, a phone or an account. */
const PERSONAL = /email|^ip|ipHash|address|device|phone|userId|accountId|actorId|userAgent|webauthn/i;

describe("the staff routes in the route table (3a design, section 11)", () => {
  test("are exactly the staff module's: the gate, sign-in, enrolment, the person's own reads, sign-out, step-up, the confirmed revocation and the confirmed decision", () => {
    const { app } = build();
    expect(distinct(app.routes.filter((r) => isStaffPath(r.path)))).toEqual(
      [
        "ALL /api/staff/*",
        "POST /api/staff/enroll/options",
        "POST /api/staff/enroll/verify",
        "POST /api/staff/signin/options",
        "POST /api/staff/signin/verify",
        "GET /api/staff/me",
        "GET /api/staff/sessions",
        "GET /api/staff/keys",
        "GET /api/staff/audit",
        "POST /api/staff/signout",
        "POST /api/staff/step-up/options",
        "DELETE /api/staff/sessions/:handle",
        "POST /api/staff/cases/:case/decisions",
      ].sort(),
    );
  });

  test("hold no route of another module under /api/staff", () => {
    const { app, staffOwn } = build();
    expect(staffOwn.length).toBeGreaterThan(0);
    // Every staff path is probed, the ones the old fixed list left out among them.
    const probes = staffProbes(staffOwn);
    for (const p of [
      "/api/staff/audit",
      "/api/staff/keys",
      "/api/staff/signout",
      "/api/staff/signin/options",
      "/api/staff/signin/verify",
      "/api/staff/enroll/options",
      "/api/staff/enroll/verify",
      `/api/staff/sessions/${SAMPLE_PARAMETER}`,
      "/api/staff/cases",
      `/api/staff/cases/${SAMPLE_PARAMETER}`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/decisions`,
    ]) {
      expect(probes, p).toContain(p);
    }
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual([]);
  });

  test("the check catches another module's route under /api/staff, a pattern that reaches it, and a second copy of a staff route", () => {
    const staffSub = new Hono();
    staffSub.use("*", async (_c, next) => next());
    staffSub.get("/me", (c) => c.text("staff"));
    staffSub.get("/audit", (c) => c.text("staff"));
    staffSub.get("/keys", (c) => c.text("staff"));
    staffSub.post("/signout", (c) => c.text("staff"));
    staffSub.post("/signin/verify", (c) => c.text("staff"));
    staffSub.post("/enroll/options", (c) => c.text("staff"));
    staffSub.delete("/sessions/:handle", (c) => c.text("staff"));
    const app = new Hono();
    app.use(async (_c, next) => next());
    app.route("/api/staff", staffSub);
    // As the social module is mounted at /api: a route of its own under /api/staff, ones whose parameter reaches a staff
    // path (with a method the staff module does not answer there, which would fall through to it), and a copy of a staff
    // route.
    const other = new Hono();
    other.get("/staff/extra", (c) => c.text("other"));
    other.get("/:section/me", (c) => c.text("other"));
    other.post("/:section/audit", (c) => c.text("other"));
    other.put("/:section/keys", (c) => c.text("other"));
    other.get("/:section/signout", (c) => c.text("other"));
    other.get("/:section/signin/verify", (c) => c.text("other"));
    other.get("/:section/enroll/:step", (c) => c.text("other"));
    other.get("/:section/sessions/:id", (c) => c.text("other"));
    other.get("/staff/me", (c) => c.text("other"));
    other.get("/profiles/:handle", (c) => c.text("other"));
    other.get("/:section/feed", (c) => c.text("other"));
    app.route("/api", other);
    const staffOwn = staffSub.routes.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual([
      "GET /api/staff/extra",
      "GET /api/:section/me",
      "POST /api/:section/audit",
      "PUT /api/:section/keys",
      "GET /api/:section/signout",
      "GET /api/:section/signin/verify",
      "GET /api/:section/enroll/:step",
      "GET /api/:section/sessions/:id",
      "GET /api/staff/me",
    ]);
  });

  test("no route changes a role: no path names one, and only grant-role's command line reaches the statements that do", () => {
    const { app } = build();
    expect(app.routes.filter((r) => ROLE_PATH.test(r.path)).map(keyOf)).toEqual([]);
    expect(roleWriterViolations(sources())).toEqual([]);
    // The rules catch a deliberate violation.
    expect(ROLE_PATH.test("/api/staff/users/:id/role")).toBe(true);
    expect(ROLE_PATH.test("/api/admin/grant")).toBe(true);
    expect(ROLE_PATH.test("/api/profiles/:handle")).toBe(false);
    expect(
      roleWriterViolations([
        { path: "staff/routes.ts", source: "routes.post('/x', (c) => auth.grantRole(email, 'admin'))" },
        { path: "auth/flows/x.ts", source: "await deps.repo.setRole(userId, 'admin');" },
        { path: "cli/grant-role.ts", source: "await grantRole(deps, email, role);" },
      ]),
    ).toEqual(["staff/routes.ts", "auth/flows/x.ts"]);
  });

  test("no route acts as another user or reads another user's sessions, email, IP, device or phone: no staff path names an account, and no staff answer has a member that would", () => {
    const { app } = build();
    // The path parameters under /api/staff are a staff session's handle, which the revocation takes only from the
    // person's own sessions (the step-up suites show another account's is not found), and a case's id: a case, never an
    // account.
    const parameters = distinct(app.routes.filter((r) => isStaffPath(r.path) && r.path.includes(":")));
    expect(parameters).toEqual(["DELETE /api/staff/sessions/:handle", "POST /api/staff/cases/:case/decisions"]);
    const answers = { StaffMe, StaffSession, StaffKey, AuditEntry, StaffSessionsResponse, StaffKeysResponse, AuditPage, StaffEnrollVerifyResponse, CaseDecisionResponse };
    const members = Object.entries(answers).flatMap(([name, schema]) => Object.keys(schema.shape).map((member) => `${name}.${member}`));
    expect(members.filter((member) => PERSONAL.test(member.split(".")[1]!))).toEqual([]);
    // The browser's coarse label and the actor's public handle are what the console shows of a session and a row.
    expect(members).toContain("StaffSession.browser");
    expect(members).toContain("AuditEntry.actorHandle");
    expect(PERSONAL.test("email")).toBe(true);
    expect(PERSONAL.test("ipHash")).toBe(true);
    expect(PERSONAL.test("deviceId")).toBe(true);
  });
});
```

### Replace `packages/contracts/test/moderation.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  ACTION_KINDS,
  APPEAL_MONTHS,
  CSAM_KEYWORDS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  DECISION_KEYWORDS,
  MEASURES,
  ModerationErrorCode,
  NOTICE_LIMITS,
  RETENTION,
  REVEAL_REASON_CATEGORIES,
  RULE_DEFAULT_CATEGORY,
  RULE_IDS,
  SEAL_LIST_MAX,
  SNAPSHOT_DIGEST_TAG,
  SUSPECT_EARLIER_MONTHS,
  TDB_CATEGORIES,
  TDB_FORM_CATEGORIES,
  TEXT_DIGEST_TAG,
  appealDeadline,
  compareDecisionActions,
  laneFor,
  snapshotDigest,
  snapshotText,
  textDigest,
  type ActionKind,
  type DecisionActionParams,
  type SnapshotDigestInput,
  type TdbCategory,
} from "../src/index";
import { TEXT_DIGEST_VECTORS } from "./digest-vectors";

const LF = String.fromCharCode(10);
const GRINNING = String.fromCodePoint(0x1f600);
const E_ACUTE = String.fromCharCode(0xe9);

describe("the Transparency Database's values", () => {
  test("there are 16 categories, as the database was read on 2026-10-02", () => {
    expect(TDB_CATEGORIES).toEqual([
      "STATEMENT_CATEGORY_ANIMAL_WELFARE",
      "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
      "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
      "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
      "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
      "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
      "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
      "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
      "STATEMENT_CATEGORY_SELF_HARM",
      "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
      "STATEMENT_CATEGORY_VIOLENCE",
    ]);
    expect(new Set(TDB_CATEGORIES).size).toBe(16);
  });

  test("the illegal-ground form shows 14 of them: not the terms-and-conditions category, and not 'not specified'", () => {
    expect(TDB_FORM_CATEGORIES).toHaveLength(14);
    expect(TDB_FORM_CATEGORIES).toEqual(TDB_CATEGORIES.filter((c) => c !== "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" && c !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"));
  });

  test("the CSAM path's four choices map to the three keywords, and 'abuse' to none", () => {
    expect(CSAM_KEYWORDS).toEqual({
      csam: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
      deepfake: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE",
      grooming: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS",
      abuse: null,
    });
    expect(Object.keys(CSAM_KEYWORDS)).toEqual(["csam", "deepfake", "grooming", "abuse"]);
  });

  test("a decision on the law may carry one keyword: terrorist content", () => {
    expect(DECISION_KEYWORDS).toEqual(["KEYWORD_TERRORIST_CONTENT"]);
  });

  test("each rule has its default category", () => {
    expect(RULE_IDS).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
    expect(RULE_DEFAULT_CATEGORY).toEqual({
      R1: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
      R2: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      R3: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      R4: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      R5: "STATEMENT_CATEGORY_VIOLENCE",
      R6: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
    });
    for (const category of Object.values(RULE_DEFAULT_CATEGORY)) expect(TDB_CATEGORIES).toContain(category);
  });
});

describe("laneFor", () => {
  const TC: TdbCategory = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC";

  test("a rule report takes its rule's lane: R2 and R5 are urgent, R3 and R4 next, R1 and R6 last", () => {
    const lanes = RULE_IDS.map((ruleId) => laneFor({ ruleId, allegesIllegal: false, csam: false, category: TC }));
    expect(lanes).toEqual([2, 0, 1, 1, 0, 2]);
  });

  test("the CSAM path is lane 0 whatever else the intake says", () => {
    expect(laneFor({ ruleId: null, allegesIllegal: true, csam: true, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS" })).toBe(0);
    expect(laneFor({ ruleId: null, allegesIllegal: false, csam: true, category: TC })).toBe(0);
  });

  test("a notice of illegality takes its category's lane, for every category", () => {
    const urgent = ["STATEMENT_CATEGORY_VIOLENCE", "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY", "STATEMENT_CATEGORY_SELF_HARM"];
    const next = [
      "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
      "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
    ];
    for (const category of TDB_CATEGORIES) {
      const expected = urgent.includes(category) ? 0 : next.includes(category) ? 1 : 2;
      expect(laneFor({ ruleId: null, allegesIllegal: true, csam: false, category }), category).toBe(expected);
    }
  });

  test("a notice of illegality that also cites a rule takes the more severe of the two lanes", () => {
    // Fraud (lane 2) under R5 (lane 0), and violence (lane 0) under R1 (lane 2): both are urgent.
    expect(laneFor({ ruleId: "R5", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" })).toBe(0);
    expect(laneFor({ ruleId: "R1", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_VIOLENCE" })).toBe(0);
    expect(laneFor({ ruleId: "R3", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" })).toBe(1);
    expect(laneFor({ ruleId: "R6", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_ANIMAL_WELFARE" })).toBe(2);
  });

  test("where nothing is alleged to be illegal, the category is korbat's own classification and moves no lane", () => {
    for (const category of TDB_CATEGORIES) {
      expect(laneFor({ ruleId: "R1", allegesIllegal: false, csam: false, category }), category).toBe(2);
      expect(laneFor({ ruleId: "R3", allegesIllegal: false, csam: false, category }), category).toBe(1);
    }
  });
});

describe("limits and periods", () => {
  test("the notice limits: per network signed out, per account signed in, ten targets, and the two text bounds", () => {
    expect(NOTICE_LIMITS).toEqual({ signedOut: { perHour: 5, perDay: 20 }, signedIn: { perHour: 10, perDay: 50 }, maxTargets: 10, explanationMax: 2000, citedLawMax: 300 });
  });

  test("a notice on the CSAM path names at most one account; a seal's list shows 500 rows; earlier answers count for 12 months", () => {
    expect(CSAM_NOTICE_MAX_ACCOUNTS).toBe(1);
    expect(SEAL_LIST_MAX).toBe(500);
    expect(SUSPECT_EARLIER_MONTHS).toBe(12);
  });

  test("six months to appeal or to ask for a re-examination, five of each a day", () => {
    expect(APPEAL_MONTHS).toBe(6);
    expect(DAILY_LIMITS).toEqual({ appeals: 5, reexaminations: 5 });
  });

  test("the retention periods of the design's table", () => {
    expect(RETENTION).toEqual({
      r4FinalMonths: 6,
      intakeDays: 30,
      resetValueDays: 30,
      evidenceHours: 24,
      statementMonths: 12,
      accessLogMonths: 12,
      contactMonths: 6,
      contactMaxMonths: 13,
      confirmationDays: 30,
      backupDays: 30,
      draftHours: 24,
      mailGiveUpDays: 5,
    });
    // Content restricted under R4 goes when its restriction is final: the appeal's window.
    expect(RETENTION.r4FinalMonths).toBe(APPEAL_MONTHS);
  });
});

describe("the measures", () => {
  const kinds = Object.keys(MEASURES) as ActionKind[];
  const measures = kinds.filter((kind) => MEASURES[kind].lifts === null);
  const reversals = kinds.filter((kind) => MEASURES[kind].lifts !== null);

  test("every action kind has an entry: the seven measures, then the five reversals", () => {
    expect(kinds).toEqual([
      "withhold",
      "remove",
      "seal_media",
      "withhold_media",
      "remove_media",
      "reset_display_name",
      "reset_bio",
      "restore",
      "unseal_media",
      "restore_media",
      "restore_display_name",
      "restore_bio",
    ]);
    expect(ACTION_KINDS).toEqual(kinds);
    expect(measures).toEqual(kinds.slice(0, 7));
    expect(reversals).toEqual(kinds.slice(7));
  });

  test("a post or one image is withheld only while deciding and removed only when the case is decided; a seal and a reset are either", () => {
    const when = (kind: ActionKind) => [MEASURES[kind].interim, MEASURES[kind].final];
    expect(when("withhold")).toEqual([true, false]);
    expect(when("withhold_media")).toEqual([true, false]);
    expect(when("remove")).toEqual([false, true]);
    expect(when("remove_media")).toEqual([false, true]);
    for (const kind of ["seal_media", "reset_display_name", "reset_bio"] as const) expect(when(kind), kind).toEqual([true, true]);
    // A reversal is neither: which decision may hold one is the reversed measure's matter.
    for (const kind of reversals) expect(when(kind), kind).toEqual([false, false]);
  });

  test("each measure has its target, and each reversal lifts the measures of its own target", () => {
    expect(Object.fromEntries(kinds.map((kind) => [kind, MEASURES[kind].target]))).toEqual({
      withhold: "post",
      remove: "post",
      seal_media: "images",
      withhold_media: "image",
      remove_media: "image",
      reset_display_name: "display_name",
      reset_bio: "bio",
      restore: "post",
      unseal_media: "images",
      restore_media: "image",
      restore_display_name: "display_name",
      restore_bio: "bio",
    });
    expect(Object.fromEntries(reversals.map((kind) => [kind, MEASURES[kind].lifts]))).toEqual({
      restore: ["withhold", "remove"],
      unseal_media: ["seal_media"],
      restore_media: ["withhold_media", "remove_media"],
      restore_display_name: ["reset_display_name"],
      restore_bio: ["reset_bio"],
    });
    // Every measure can be lifted, by exactly one kind of reversal.
    for (const measure of measures) expect(reversals.filter((kind) => (MEASURES[kind].lifts as readonly ActionKind[]).includes(measure)), measure).toHaveLength(1);
  });

  test("each has a label of its own: the composer's words where the composer names the measure", () => {
    // The first seven and "Lift the seal" are the words of the decision composer; the composer, the statement and the
    // terms all take them from here.
    expect(Object.fromEntries(kinds.map((kind) => [kind, MEASURES[kind].label]))).toEqual({
      withhold: "Withhold the post",
      remove: "Remove",
      seal_media: "Seal the images this case reaches",
      withhold_media: "Withhold one image",
      remove_media: "Remove one image",
      reset_display_name: "Reset display name",
      reset_bio: "Reset bio",
      restore: "Lift the restriction of the post",
      unseal_media: "Lift the seal",
      restore_media: "Lift the restriction of one image",
      restore_display_name: "Lift the reset of the display name",
      restore_bio: "Lift the reset of the bio",
    });
    const labels = kinds.map((kind) => MEASURES[kind].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("the order of a decision's actions", () => {
  const a = "1a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
  const b = "2a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

  test("by kind as a string, then by image as a string, an action without an image first", () => {
    const sorted: DecisionActionParams[] = [
      { kind: "remove", mediaId: null },
      { kind: "remove_media", mediaId: a },
      { kind: "remove_media", mediaId: b },
      { kind: "reset_bio", mediaId: null },
      { kind: "seal_media", mediaId: null },
      { kind: "withhold_media", mediaId: a },
    ];
    for (const shuffled of [[...sorted].reverse(), [sorted[3]!, sorted[0]!, sorted[5]!, sorted[2]!, sorted[1]!, sorted[4]!]]) {
      expect([...shuffled].sort(compareDecisionActions)).toEqual(sorted);
    }
    expect(compareDecisionActions(sorted[1]!, sorted[1]!)).toBe(0);
    expect(compareDecisionActions({ kind: "restore_media", mediaId: null }, { kind: "restore_media", mediaId: a })).toBeLessThan(0);
  });
});

describe("the reasons for revealing a source", () => {
  test("are the four categories the reveal dialog offers", () => {
    expect(REVEAL_REASON_CATEGORIES).toEqual(["impersonation_claim", "abuse_of_reporting", "legal_requirement", "other"]);
  });
});

describe("moderation error codes", () => {
  test("are the codes the notice routes, the intake and the decision raise", () => {
    expect(ModerationErrorCode.options).toEqual([
      "notice_link_invalid",
      "notice_link_offsite",
      "human_check_failed",
      "staff_cannot_report",
      "notice_not_found",
      "already_reported",
      "case_changed",
      "case_closed",
      "staff_recused",
      "staff_target",
      "admin_required",
      "decision_cap",
      "profile_changed",
      "snapshot_mismatch",
      "snapshot_erased",
      "text_not_found",
      "invalid_decision",
    ]);
    // The codes the database keeps to itself are no route's answer.
    for (const code of ["moderation_column", "quote_item_missing", "read_committed_only", "staff_confirmation_ended", "staff_confirmation_late"]) {
      expect(ModerationErrorCode.safeParse(code).success, code).toBe(false);
    }
  });
});

describe("textDigest", () => {
  test("the tag names the version of the rule", () => {
    expect(TEXT_DIGEST_TAG).toBe("korbat.text.v1");
  });

  test.each(TEXT_DIGEST_VECTORS.map((vector) => [vector.name, vector] as const))("%s: the sha256 of the tag, a line feed, the salt's bytes and the text's UTF-8 bytes", async (_name, vector) => {
    expect(await textDigest(vector.salt, vector.text)).toBe(vector.digest);
  });

  test("the longest vector is 5000 UTF-16 units, and the vectors hold a line feed, a character outside ASCII and one outside the basic plane", () => {
    expect(Math.max(...TEXT_DIGEST_VECTORS.map((vector) => vector.text.length))).toBe(5000);
    const all = TEXT_DIGEST_VECTORS.map((vector) => vector.text).join("");
    expect(all).toContain(LF);
    expect(all).toContain(E_ACUTE);
    expect(all).toContain(GRINNING);
  });

  test("another salt or another text gives another digest", async () => {
    const digests = await Promise.all([textDigest("a1".repeat(32), "one"), textDigest("a2".repeat(32), "one"), textDigest("a1".repeat(32), "one "), textDigest("a1".repeat(32), "One")]);
    expect(new Set(digests).size).toBe(4);
  });

  test("a salt that is not 32 bytes of lower-case hex is refused, never padded or folded", async () => {
    for (const salt of ["", "a1".repeat(31), "a1".repeat(33), "A1".repeat(32), "g1".repeat(32), ` ${"a1".repeat(32)}`]) {
      await expect(textDigest(salt, "text"), JSON.stringify(salt)).rejects.toThrow(TypeError);
    }
  });

  test("a text with a lone surrogate, which has no UTF-8 bytes, is refused rather than hashed as something else", async () => {
    const high = String.fromCharCode(0xd83d);
    const low = String.fromCharCode(0xde00);
    for (const text of [high, low, `a${high}b`, `${low}${high}`]) await expect(textDigest("a1".repeat(32), text)).rejects.toThrow(TypeError);
    // The pair itself is a character.
    await expect(textDigest("a1".repeat(32), `${high}${low}`)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("snapshotText and snapshotDigest", () => {
  const post: SnapshotDigestInput = {
    salt: "ab".repeat(32),
    targetType: "post",
    targetId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
    takenAt: "2026-10-03T10:00:00.123Z",
    authorHandle: "ada",
    postState: "visible",
    postCreatedAt: "2026-10-01T08:30:00.000Z",
    replyToId: null,
    quoteOfId: "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36",
    body: `Line one${LF}caf${E_ACUTE} ${GRINNING}`,
    media: [
      { id: "11111111-2222-4333-8444-555555555555", alt: "A cat", width: 1200, height: 800 },
      { id: "66666666-7777-4888-9999-aaaaaaaaaaaa", alt: null, width: 640, height: 480 },
    ],
    displayName: null,
    bio: null,
    handle: null,
  };
  const account: SnapshotDigestInput = {
    salt: "cd".repeat(32),
    targetType: "account",
    targetId: "8a3c7f0e-1111-4222-8333-944445555666",
    takenAt: "2026-10-03T10:00:00.000Z",
    authorHandle: "bob",
    postState: null,
    postCreatedAt: null,
    replyToId: null,
    quoteOfId: null,
    body: null,
    media: null,
    displayName: `Bob ${GRINNING}`,
    bio: "",
    handle: "bob",
  };
  const BS = String.fromCharCode(92);
  // The texts and the digests below were computed with Python's json and hashlib when they were written.
  const POST_TEXT =
    `{"authorHandle":"ada","bio":null,"body":"Line one${BS}ncaf${E_ACUTE} ${GRINNING}","displayName":null,"handle":null,` +
    `"media":[{"alt":"A cat","height":800,"id":"11111111-2222-4333-8444-555555555555","width":1200},{"alt":null,"height":480,"id":"66666666-7777-4888-9999-aaaaaaaaaaaa","width":640}],` +
    `"postCreatedAt":"2026-10-01T08:30:00.000Z","postState":"visible","quoteOfId":"7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36","replyToId":null,` +
    `"salt":"${"ab".repeat(32)}","takenAt":"2026-10-03T10:00:00.123Z","targetId":"3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a","targetType":"post","v":1}`;
  const POST_DIGEST = "cb995d11ed14e3c4e555c187d319a86506b263e98f924f59f2f7d5231a3bc6e6";
  const ACCOUNT_DIGEST = "41019b2a47d4ebad37cc8c5ad25f8d79a7232c4e3e705231f9e9ba1e02fb1f26";

  test("the tag names the version of the rule", () => {
    expect(SNAPSHOT_DIGEST_TAG).toBe("korbat.snapshot.v1");
  });

  test("the text is the sorted JSON of version 1 and the snapshot's fifteen members", () => {
    expect(snapshotText(post)).toBe(POST_TEXT);
    const parsed = JSON.parse(snapshotText(account)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["authorHandle", "bio", "body", "displayName", "handle", "media", "postCreatedAt", "postState", "quoteOfId", "replyToId", "salt", "takenAt", "targetId", "targetType", "v"]);
    expect(parsed).toEqual({ v: 1, ...account });
  });

  test("the digest is the sha256 of the tag, a line feed and that text", async () => {
    expect(await snapshotDigest(post)).toBe(POST_DIGEST);
    expect(await snapshotDigest(account)).toBe(ACCOUNT_DIGEST);
  });

  test("it round-trips the snapshot answer's JSON, whatever order and whatever else the answer carries", async () => {
    // As the console receives it: parsed from JSON, with members the digest does not cover, in another order.
    const sent = {
      id: "9d0f5e3c-0000-4000-8000-000000000001",
      digest: POST_DIGEST,
      withheld: false,
      erasedAt: null,
      ...Object.fromEntries(Object.entries(post).reverse()),
      media: post.media!.map((image) => ({ height: image.height, width: image.width, note: "never part of a snapshot", alt: image.alt, id: image.id })),
    };
    const answer = JSON.parse(JSON.stringify(sent)) as SnapshotDigestInput;
    expect(snapshotText(answer)).toBe(POST_TEXT);
    expect(await snapshotDigest(answer)).toBe(POST_DIGEST);
  });

  test("any member that changes gives another digest", async () => {
    const changed: SnapshotDigestInput[] = [
      { ...post, salt: "ac".repeat(32) },
      { ...post, takenAt: "2026-10-03T10:00:00.124Z" },
      { ...post, body: `${post.body} ` },
      { ...post, postState: "withheld" },
      { ...post, quoteOfId: null },
      { ...post, media: [post.media![1]!, post.media![0]!] },
      { ...post, media: [{ ...post.media![0]!, alt: "A dog" }, post.media![1]!] },
      { ...post, authorHandle: "adb" },
    ];
    const digests = await Promise.all([post, ...changed].map(snapshotDigest));
    expect(new Set(digests).size).toBe(changed.length + 1);
  });

  test("a time that is not the UTC string toISOString writes, to the millisecond, is refused", () => {
    for (const takenAt of ["2026-10-03T10:00:00Z", "2026-10-03T10:00:00.123456Z", "2026-10-03T12:00:00.123+02:00", "2026-10-03 10:00:00.123Z", ""]) {
      expect(() => snapshotText({ ...post, takenAt }), takenAt).toThrow(TypeError);
    }
    expect(() => snapshotText({ ...post, postCreatedAt: "2026-10-01T08:30:00Z" })).toThrow(TypeError);
    expect(snapshotText({ ...post, takenAt: new Date(Date.UTC(2026, 9, 3, 10, 0, 0, 123)).toISOString() })).toBe(POST_TEXT);
  });
});

describe("appealDeadline", () => {
  const at = (iso: string) => new Date(iso);
  const deadline = (iso: string) => appealDeadline(at(iso)).toISOString();

  test("six calendar months later, at the same UTC time", () => {
    expect(deadline("2026-10-03T10:15:30.250Z")).toBe("2027-04-03T10:15:30.250Z");
    expect(deadline("2026-01-15T00:00:00.000Z")).toBe("2026-07-15T00:00:00.000Z");
    expect(deadline("2026-07-01T23:59:59.999Z")).toBe("2027-01-01T23:59:59.999Z");
  });

  test("a day the sixth month lacks becomes that month's last day", () => {
    // 31 August plus six months is the end of February: the 28th, or the 29th in a leap year.
    expect(deadline("2026-08-31T12:00:00.000Z")).toBe("2027-02-28T12:00:00.000Z");
    expect(deadline("2027-08-31T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2027-08-30T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2027-08-29T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2026-03-31T08:00:00.000Z")).toBe("2026-09-30T08:00:00.000Z");
    expect(deadline("2026-05-31T08:00:00.000Z")).toBe("2026-11-30T08:00:00.000Z");
    expect(deadline("2026-10-31T08:00:00.000Z")).toBe("2027-04-30T08:00:00.000Z");
    expect(deadline("2026-12-31T08:00:00.000Z")).toBe("2027-06-30T08:00:00.000Z");
    // A leap day itself moves to 29 August: August has the day.
    expect(deadline("2028-02-29T08:00:00.000Z")).toBe("2028-08-29T08:00:00.000Z");
  });

  test("it is computed in UTC: the last instants of a UTC month stay on that month's side", () => {
    expect(deadline("2026-08-31T23:59:59.999Z")).toBe("2027-02-28T23:59:59.999Z");
    expect(deadline("2026-09-01T00:00:00.000Z")).toBe("2027-03-01T00:00:00.000Z");
  });

  test("it leaves its argument as it was", () => {
    const informed = at("2026-08-31T12:00:00.000Z");
    appealDeadline(informed);
    expect(informed.toISOString()).toBe("2026-08-31T12:00:00.000Z");
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/rules test:       Tests  18 passed (18)
packages/db test:       Tests  60 passed (60)
packages/contracts test:  ❯ test/notices.test.ts (18 tests | 18 failed) 44ms
packages/contracts test:  ❯ test/moderation.test.ts (42 tests | 1 failed) 53ms
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/04-reports-notices.md 3
```

Expected: 25 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/flows/notifiers.ts`

```ts
import { RETENTION } from "@korbat/contracts";
import { MailRefused, type MailMessage } from "../../mail/mailer";
import type { AuthDeps } from "../context";
import { decrypt, encrypt, randomToken, safeEqual } from "../crypto";
import { emailHash } from "../identifiers";
import { HOUR } from "../limits";
import { noticeTime } from "./notify";

/**
 * The auth module's side of reports and notices (3c design, section 5): a signed-out notifier's name and address, which
 * live here, encrypted, where the API's role cannot reach them, and every mail of the moderation module, which never
 * sees an address or a mail token. The moderation module names a contact by an id it chose, names an account by its id,
 * and passes typed messages: no caller passes free text, and this module builds every link itself.
 */

const DAY = 24 * HOUR;

/** An address that is not confirmed gets at most one receipt in this long; further ones are folded into the next daily mail. */
export const RECEIPT_CAP_MS = DAY;

/** The receipt of a report or a notice: its reference, when it was received, and the korbat links it named, in the order named. */
export interface NoticeReceivedMessage {
  template: "notice_received";
  ref: string;
  receivedAt: Date;
  items: readonly string[];
}

/** What may be sent to a signed-out notifier's contact, and to an account that reported. Each gains its other mails with the dispatch job. */
export type NotifierMessage = NoticeReceivedMessage;
export type AccountMessage = NoticeReceivedMessage;

/** The staff alerts: counts and times only, never a link or content. */
export type StaffMessage = { template: "moderation_urgent"; count: number; oldest: Date };

export type NotifierMailResult = "sent" | "folded" | "suppressed" | "no_address" | "forgotten" | "refused";
export type AccountMailResult = "sent" | "suppressed" | "no_address" | "refused";

/** What staff may know of a signed-out notifier without a reveal: never the name or the address themselves. */
export interface NotifierFacts {
  /** False for an id no contact has: it was never stored, or the janitor has forgotten it. Then the other four are false too. */
  found: boolean;
  named: boolean;
  contactGiven: boolean;
  confirmed: boolean;
  suppressed: boolean;
}

/** A contact's ciphertexts open under the key, or under a key it replaced. Nothing read is ever written back under the newer key. */
const open = (deps: AuthDeps, payload: string): string => decrypt(payload, [deps.config.notifierKey, ...deps.config.notifierPreviousKeys]).toString("utf8");
const seal = (deps: AuthDeps, plain: string): string => encrypt(Buffer.from(plain, "utf8"), deps.config.notifierKey);

/** The same day `months` calendar months later in UTC; a day the target month lacks becomes that month's last day. */
function monthsLater(at: Date, months: number): Date {
  const month = at.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(at.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(at.getUTCFullYear(), month, Math.min(at.getUTCDate(), lastDay), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds()));
}

/** The cap's marker for an address, by its keyed hash: set when a receipt goes to it unconfirmed, gone a day later. */
const receiptCapKey = (hash: string) => `notifier-receipt:${hash}`;

/** The receipt's template data. The page link is this module's: the status page's address with the contact's mail token in the fragment, which no server log sees. */
function receiptData(deps: AuthDeps, message: NoticeReceivedMessage, pageUrl?: string): Record<string, string> {
  return {
    ref: message.ref,
    time: noticeTime(message.receivedAt),
    items: message.items.join(", "),
    ...(pageUrl === undefined ? {} : { pageUrl }),
    termsUrl: `${deps.config.appOrigin}/terms`,
  };
}

/** Sends one mail. "refused" when the relay refused the recipient for good; any other failure is thrown, for the caller to try again. */
async function deliver(deps: AuthDeps, message: MailMessage): Promise<"sent" | "refused"> {
  try {
    await deps.mailer.send(message);
    return "sent";
  } catch (err) {
    if (err instanceof MailRefused) return "refused";
    throw err;
  }
}

/**
 * Stores a signed-out notifier's contact under the id the moderation module wrote on the notice: the name and the
 * address normalised and encrypted under the notifier key, the address's keyed hash for the cap and for stops, and, with
 * an address, a fresh mail token encrypted beside it. A disposable address is taken: a notifier may want one. The contact
 * is forgotten 13 months on unless the notice is still owed something by then.
 */
export async function storeNotifierContact(deps: AuthDeps, contactId: string, contact: { name?: string; email?: string }): Promise<void> {
  const name = contact.name?.trim() || null;
  const email = contact.email?.trim().toLowerCase() || null;
  await deps.repo.createNotifierContact({
    id: contactId,
    nameEnc: name === null ? null : seal(deps, name),
    emailEnc: email === null ? null : seal(deps, email),
    emailHash: email === null ? null : emailHash(deps.config.authHmacKey, email),
    // The token of the mails' link: it alone confirms or stops the address, so whoever typed someone else's address cannot.
    mailTokenEnc: email === null ? null : seal(deps, randomToken()),
    forgetAfter: monthsLater(deps.now(), RETENTION.contactMaxMonths),
  });
}

/**
 * Sends a signed-out notifier's receipt, under three rules. A stopped address gets nothing ("suppressed"). An address
 * that is not confirmed gets one receipt in 24 hours, and a further one is "folded": it rides in the next daily mail, so
 * typing someone's address into the form many times sends them one mail. A confirmed address has no cap. "forgotten"
 * when no contact has the id, "no_address" when the contact left none. A failure of the relay that is not about the
 * address is thrown, and gives the day's one receipt back first, so the retry is sent rather than folded.
 */
export async function mailNotifier(deps: AuthDeps, contactId: string, message: NotifierMessage): Promise<NotifierMailResult> {
  const contact = await deps.repo.findNotifierContact(contactId);
  if (!contact) return "forgotten";
  if (!contact.emailEnc || !contact.emailHash || !contact.mailTokenEnc) return "no_address";
  const hash = contact.emailHash;
  if ((await deps.repo.suppressedNotifierHashes([hash])).has(hash)) return "suppressed";
  // Opened before the cap is taken: a ciphertext no configured key opens throws here and spends nothing.
  const to = open(deps, contact.emailEnc);
  const pageUrl = `${deps.config.appOrigin}/notice/${message.ref}#t=${open(deps, contact.mailTokenEnc)}`;
  const confirmed = (await deps.repo.confirmedNotifierHashes([hash], deps.now())).has(hash);
  if (!confirmed && !(await deps.kv.setIfAbsent(receiptCapKey(hash), "1", RECEIPT_CAP_MS))) return "folded";
  try {
    return await deliver(deps, { to, template: "notice_received", data: receiptData(deps, message, pageUrl) });
  } catch (err) {
    if (!confirmed) await deps.kv.del(receiptCapKey(hash)).catch((failure: unknown) => deps.log.warn({ err: failure }, "notifier receipt: the day's one receipt could not be given back after a failed send"));
    throw err;
  }
}

/**
 * Sends a report mail to an account's own address, which its sign-in code confirmed: no cap and no confirmation. A stop
 * of that address applies to the report mails. "no_address" for an account that is deleted or was never there.
 */
export async function mailAccount(deps: AuthDeps, userId: string, message: AccountMessage): Promise<AccountMailResult> {
  const user = await deps.repo.findUserById(userId);
  if (!user) return "no_address";
  const hash = emailHash(deps.config.authHmacKey, user.email);
  // Only the mails about a report honour a stop: a statement of reasons to an author is never one of them.
  if (message.template === "notice_received" && (await deps.repo.suppressedNotifierHashes([hash])).has(hash)) return "suppressed";
  return deliver(deps, { to: user.email, template: "notice_received", data: receiptData(deps, message) });
}

/**
 * Sends a staff alert to every live staff account's address, best effort: a failed send is logged and never thrown, and
 * the answer is the number of addresses the relay took, 0 when it took none or there is no live staff account. It
 * applies no throttle: the moderation module keeps every throttle, as a key in the shared limit store.
 */
export async function mailStaff(deps: AuthDeps, message: StaffMessage): Promise<number> {
  const data = { count: String(message.count), oldest: noticeTime(message.oldest) };
  let addresses: string[];
  try {
    addresses = await deps.repo.liveStaffAddresses();
  } catch (err) {
    deps.log.error({ err, template: message.template }, "staff alert: the staff accounts could not be read");
    return 0;
  }
  let accepted = 0;
  for (const to of addresses) {
    try {
      await deps.mailer.send({ to, template: message.template, data });
      accepted++;
    } catch (err) {
      deps.log.error({ err, template: message.template }, "staff alert email failed");
    }
  }
  return accepted;
}

/** For each id: whether a contact has it, whether a name and an address were given, and whether the address is confirmed or stopped now. */
export async function notifierFacts(deps: AuthDeps, contactIds: readonly string[]): Promise<Map<string, NotifierFacts>> {
  const rows = await deps.repo.notifierContactFacts(contactIds);
  const hashes = rows.flatMap((row) => (row.emailHash === null ? [] : [row.emailHash]));
  const [confirmed, suppressed] = await Promise.all([deps.repo.confirmedNotifierHashes(hashes, deps.now()), deps.repo.suppressedNotifierHashes(hashes)]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return new Map(
    contactIds.map((id): [string, NotifierFacts] => {
      const row = byId.get(id);
      if (!row) return [id, { found: false, named: false, contactGiven: false, confirmed: false, suppressed: false }];
      return [id, { found: true, named: row.named, contactGiven: row.contactGiven, confirmed: row.emailHash !== null && confirmed.has(row.emailHash), suppressed: row.emailHash !== null && suppressed.has(row.emailHash) }];
    }),
  );
}

/** The name a notifier gave, or null: for a confirmed reveal only. The address is never handed out. */
export async function notifierName(deps: AuthDeps, contactId: string): Promise<string | null> {
  const contact = await deps.repo.findNotifierContact(contactId);
  return contact?.nameEnc ? open(deps, contact.nameEnc) : null;
}

/** The contact's address hash when the token is its mail token, compared in constant time; null for anything else. */
async function addressOfToken(deps: AuthDeps, contactId: string, token: string): Promise<string | null> {
  const contact = await deps.repo.findNotifierContact(contactId);
  if (!contact?.mailTokenEnc || !contact.emailHash) return null;
  let mailToken: string;
  try {
    mailToken = open(deps, contact.mailTokenEnc);
  } catch (err) {
    // A contact no configured key opens matches nothing; the fault is the operator's to see, with the contact's id and no address.
    deps.log.error({ err, contactId }, "notifier contact: its mail token could not be decrypted");
    return null;
  }
  return safeEqual(mailToken, token) ? contact.emailHash : null;
}

/** Whether the token is the contact's mail token; false when the contact has none. */
export async function notifierMailTokenMatches(deps: AuthDeps, contactId: string, token: string): Promise<boolean> {
  return (await addressOfToken(deps, contactId, token)) !== null;
}

/**
 * "I sent this": with the contact's mail token, records the address as confirmed for 30 days and lifts any stop of it.
 * False, and nothing done, for any other token: typing someone's address proves nothing about it.
 */
export async function confirmNotifier(deps: AuthDeps, contactId: string, token: string): Promise<boolean> {
  const hash = await addressOfToken(deps, contactId, token);
  if (hash === null) return false;
  const now = deps.now();
  await deps.repo.confirmNotifierAddress(hash, now, new Date(now.getTime() + RETENTION.confirmationDays * DAY));
  return true;
}

/** "Stop": with the contact's mail token, korbat sends this address no more mails about reports. Its notices are still processed. */
export async function stopNotifier(deps: AuthDeps, contactId: string, token: string): Promise<boolean> {
  const hash = await addressOfToken(deps, contactId, token);
  if (hash === null) return false;
  await deps.repo.suppressNotifierAddress(hash);
  return true;
}

/** Whether the account's address asked korbat to stop its report mails. */
export async function accountReportMailStopped(deps: AuthDeps, userId: string): Promise<boolean> {
  const user = await deps.repo.findUserById(userId);
  if (!user) return false;
  const hash = emailHash(deps.config.authHmacKey, user.email);
  return (await deps.repo.suppressedNotifierHashes([hash])).has(hash);
}

/** Lifts a stop of the account's address, for the account's own Settings: the session proves the address. True when there was one. */
export async function resumeAccountReportMail(deps: AuthDeps, userId: string): Promise<boolean> {
  const user = await deps.repo.findUserById(userId);
  if (!user) return false;
  return deps.repo.liftNotifierSuppression(emailHash(deps.config.authHmacKey, user.email));
}

/** Moves the day these contacts are forgotten. */
export function forgetNotifierAfter(deps: AuthDeps, contactIds: readonly string[], at: Date): Promise<void> {
  return deps.repo.setNotifierForgetAfter(contactIds, at);
}

/** The contacts that gave this address, with the names they gave: for an access request from a signed-out notifier, from the command line only. */
export async function findNotifierContacts(deps: AuthDeps, email: string): Promise<{ id: string; name: string | null }[]> {
  const rows = await deps.repo.notifierContactsByEmailHash(emailHash(deps.config.authHmacKey, email));
  return rows.map((row) => ({ id: row.id, name: row.nameEnc ? open(deps, row.nameEnc) : null }));
}

/** How many contacts and confirmations the janitor should have removed more than a day ago: a count only, for the console's overview. */
export function overdueContacts(deps: AuthDeps): Promise<number> {
  return deps.repo.countNotifierRowsDue(new Date(deps.now().getTime() - DAY));
}
```

### Create `apps/api/src/moderation/alerts.ts`

```ts
import type { StaffMessage } from "../auth";
import type { ModerationDeps } from "./context";
import { urgentWaiting } from "./repo";

/**
 * Staff alerts before the phone channel of sub-project 3e (3c design, section 7.12): a mail to every live staff account,
 * with counts and times only and never a link or content. The moderation module, which never sees an address, keeps
 * each alert's throttle as one key of the shared limit store.
 */

/** The key and the window of the urgent lane's alert. The dispatch job repeats the alert under the same key. */
export const URGENT_ALERT_KEY = "moderation-urgent";
export const URGENT_ALERT_WINDOW_MS = 15 * 60_000;

/**
 * Sends a staff alert at most once in its key's window: the key is hit, and the mail goes when the count is 1. When no
 * address took the mail the hit is given back, so the next occasion that meets the alert's condition sends it again; a
 * failed give-back is logged. The alert fails open: when the store cannot be reached, the mail goes without a throttle.
 * Answers what happened; it never throws for a failed send, which mailStaff logs.
 */
export async function staffAlert(deps: Pick<ModerationDeps, "auth" | "limits" | "log">, key: string, windowMs: number, message: StaffMessage): Promise<"sent" | "throttled" | "unsent"> {
  let counted = false;
  try {
    const hit = await deps.limits.hit(key, windowMs);
    counted = true;
    if (hit.count > 1) return "throttled";
  } catch (err) {
    deps.log.warn({ err, alert: key }, "moderation alert: the limit store could not be reached; the alert goes without its throttle");
  }
  const accepted = await deps.auth.mailStaff(message);
  if (accepted > 0) return "sent";
  if (counted) {
    await deps.limits.release(key).catch((err: unknown) => deps.log.warn({ err, alert: key }, "moderation alert: the hit of an alert nobody received could not be given back"));
  }
  return "unsent";
}

/**
 * The urgent lane's alert: when an intake has put an item into lane 0, every staff account is told how many cases wait
 * there and since when the oldest does. A notice about a post that quotes another puts two cases into the lane and sends
 * one mail that counts both. Best effort, after the commit and the answer; the dispatch job repeats it while a lane-0
 * item still calls for someone.
 */
export async function alertUrgentLane(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits" | "log">): Promise<"sent" | "throttled" | "unsent" | "nothing_waiting"> {
  const waiting = await urgentWaiting(deps.apiDb);
  // Decided in the moment between the intake's commit and this read: nothing is left to alert about.
  if (waiting.count === 0 || waiting.oldest === null) return "nothing_waiting";
  return staffAlert(deps, URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS, { template: "moderation_urgent", count: waiting.count, oldest: waiting.oldest });
}
```

### Create `apps/api/src/moderation/links.ts`

```ts
import { ModerationError } from "./context";

/**
 * korbat links (3c design, section 7.1, step 3). A report names things on korbat only: a post by its id, an account by
 * its handle, or the app's own address of either, which is parsed here. Nothing is ever fetched: a link to another site
 * is refused, never followed, so no moderator and no server opens an address a stranger chose.
 */

/** What a korbat link names. */
export type LinkTarget = { type: "post"; id: string } | { type: "account"; handle: string };

// The path's own words are the app's, in lower case only; the id's letters may be written in either case.
const POST_PATH = /^[/]post[/]([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})[/]?$/;
const PROFILE_PATH = /^[/]u[/]([A-Za-z0-9_]{3,20})[/]?$/;

/**
 * Parses a link: it must be the app's address of a post (`/post/<id>`) or of a profile (`/u/<handle>`). Refused with
 * notice_link_offsite when it names another host, and with notice_link_invalid when it is no web address or names
 * another path. The host is compared with the app's, port included; the scheme is not, since a person may copy an
 * address from before the redirect to https. A query and a fragment are ignored. The id and the handle are answered in
 * lower case, as the database keeps them.
 */
export function parseLink(appOrigin: string, link: string): LinkTarget {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new ModerationError("notice_link_invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ModerationError("notice_link_invalid");
  if (url.host !== new URL(appOrigin).host) throw new ModerationError("notice_link_offsite");
  // No korbat address carries a user name or a password.
  if (url.username !== "" || url.password !== "") throw new ModerationError("notice_link_invalid");
  const post = POST_PATH.exec(url.pathname);
  if (post) return { type: "post", id: post[1]!.toLowerCase() };
  const profile = PROFILE_PATH.exec(url.pathname);
  if (profile) return { type: "account", handle: profile[1]!.toLowerCase() };
  throw new ModerationError("notice_link_invalid");
}

/** The app's origin without a path, whatever final slash the setting was written with. */
const originOf = (appOrigin: string) => new URL(appOrigin).origin;

/** The app's address of a post. */
export const postLink = (appOrigin: string, postId: string): string => `${originOf(appOrigin)}/post/${postId}`;

/**
 * The app's address of an account under a handle. A report is shown back under the handle it named, never under the one
 * the profile holds now: no report may show its sender a later handle, since there is no redirect from a handle an
 * account has left either.
 */
export const accountLink = (appOrigin: string, handle: string): string => `${originOf(appOrigin)}/u/${handle}`;
```

### Create `apps/api/src/moderation/routes.ts`

```ts
import { NoticeContactRequest, NoticeRequest, NoticeStatusRequest } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { ModerationDeps } from "./context";
import { noticeContact, noticeStatus, submitNotice, type NoticeSender } from "./intake";

/**
 * The moderation module's app routes, mounted at `/api` after the global rate limit and session resolution (3c design,
 * section 5). Handlers only validate, call a flow and shape the response; a flow's refusal is a ModerationError, which
 * the app's error handler turns into the shared envelope.
 *
 * The three routes under `/api/notices` take a request with or without a session. Signed out, such a request passes
 * session resolution with its Origin checked and no CSRF token, since there is no cookie to ride on; signed in from a
 * browser, it carries the token as every cookie request does. The status page's tokens travel in the body of a POST, so
 * no address, and no server log, ever holds one.
 */
export function moderationRoutes(deps: ModerationDeps) {
  const r = new Hono<AppEnv>();
  /** The keyed hash of the client's network, which the client identity middleware set; "direct" where it did not run. */
  const netHash = (c: Context<AppEnv>): string => c.get("clientNetHash") ?? "direct";
  const sender = (c: Context<AppEnv>): NoticeSender => ({ session: c.get("session"), netHash: netHash(c) });

  // One request is one report or notice: one intake, an item for each target it names.
  r.post("/notices", validate("json", NoticeRequest), async (c) => c.json(await submitNotice(deps, c.req.valid("json"), sender(c)), 201));
  // Where a notice stands, for whoever holds its reference with its own token or with the token of a mail's link.
  r.post("/notices/status", validate("json", NoticeStatusRequest), async (c) => c.json(await noticeStatus(deps, c.req.valid("json"), netHash(c))));
  // The status page's two buttons: a POST each, never a link that acts when it is merely opened.
  r.post("/notices/contact", validate("json", NoticeContactRequest), async (c) => {
    await noticeContact(deps, c.req.valid("json"), netHash(c));
    return c.body(null, 204);
  });

  return r;
}
```

### Replace `apps/api/.env.example` (whole file)

```text
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL_API=postgres://korbat_api:change-me-api@localhost:55432/korbat
DATABASE_URL_AUTH=postgres://korbat_auth:change-me-auth@localhost:55432/korbat
DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:55432/korbat
REDIS_URL=redis://:change-me-redis@localhost:56379
TRUSTED_ORIGINS=http://localhost:8081
APP_ORIGIN=http://localhost:8081
# Which header names the client: cloudflare (behind the tunnel), caddy (behind Caddy alone) or none (the
# socket). Development and the integration tests use cloudflare, the most permissive mode.
TRUST_PROXY=cloudflare
# Keys are generated by `node scripts/gen-dev-env.mjs`. Never reuse keys between environments.
AUTH_HMAC_KEY=change-me-key-auth-hmac
IP_HASH_KEY=change-me-key-ip-hash
TOTP_ENC_KEY=v1:change-me-key-totp
# Earlier TOTP keys, comma-separated, kept only while secrets they encrypted are still stored.
TOTP_ENC_KEYS_PREVIOUS=
# Encrypts what a signed-out notifier leaves to be told about their notice: a name, an address and the token of the
# mails' link. Back it up as TOTP_ENC_KEY is: without it korbat can neither mail a notifier nor say who sent a notice.
NOTIFIER_ENC_KEY=v1:change-me-key-notifier
# Earlier notifier keys, comma-separated. A contact is never encrypted again, so a key stays here while a contact it
# encrypted is still stored.
NOTIFIER_ENC_KEYS_PREVIOUS=
# Cloudflare's documented always-pass test secret. Production uses the real secret.
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Local Mailpit from infra/compose.dev.yml. Production points at the EU relay.
SMTP_URL=smtp://localhost:51025
MAIL_FROM="korbat <no-reply@korbat.local>"
TERMS_VERSION=draft-2026-09
# Mailpit HTTP API, read by integration tests only.
MAILPIT_URL=http://localhost:58025
# Images on the host: the API writes uploads, the worker (apps/worker) writes the store. Both
# directories are created on demand under the repository's ignored .data folder.
MEDIA_UPLOADS_DIR=../../.data/media/uploads
MEDIA_STORE_DIR=../../.data/media/store
MEDIA_FORMATS=jpeg,png,webp,gif,avif
MEDIA_MIN_FREE_BYTES=2147483648
# Who checks the phone number behind the verified badge: off hides the badge, dev accepts the code 000000
# (development only; production refuses it), vonage texts a real code and needs VONAGE_API_KEY,
# VONAGE_API_SECRET and VERIFY_BRAND (1 to 18 characters), see infra/.env.example.
VERIFY_PROVIDER=dev
# Passkeys. The RP ID every passkey is bound to: empty means the host of APP_ORIGIN (localhost here). Production
# refuses an address or localhost and accepts only that host or a parent domain of it; changing it later strands
# every passkey. Browsers refuse passkeys on an IP address, so open the app at http://localhost, not 127.0.0.1.
WEBAUTHN_RP_ID=
# The site name password managers show next to a korbat passkey (1 to 64 printable characters); empty means korbat.
WEBAUTHN_RP_NAME=
# The staff console (apps/admin): its origin turns the staff routes on, and empty turns them off. Its development
# server (pnpm --filter @korbat/admin dev) listens on this port and forwards /api/staff/* to this API; open it at
# exactly this address, never 127.0.0.1. It must differ from APP_ORIGIN and never appear in TRUSTED_ORIGINS. Staff keys
# are bound to its relying party ID, CONSOLE_RP_ID, which defaults to its hostname: localhost here, as for passkeys.
CONSOLE_ORIGIN=http://localhost:8090
# Moderation. The hour of the UTC day, 0 to 23, at which the day's decisions on reports and notices are released to those
# who sent them, in one batch; empty means 7.
MODERATION_DISPATCH_HOUR=7
# The queue's emergency switch: on sorts cases whose open reports all come from unproven sources after the others of
# their lane, never below a less severe lane. off, the default, orders by lane and age alone.
MODERATION_DEFER_UNPROVEN=off
```

### Replace `apps/api/src/app.ts` (whole file)

```ts
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import { AccountError, type Account } from "./account";
import { AuthError, type Auth } from "./auth";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { MediaError, type Media } from "./media";
import { observability } from "./middleware/observability";
import { clientIpKey, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { ModerationError, type Moderation } from "./moderation";
import { healthRoutes, type HealthChecks } from "./routes/health";
import { SocialError, type Social } from "./social";
import type { Staff } from "./staff";

/** JSON requests are small; the one raw upload route counts its own bytes and is exempt. */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * The staff console's paths (3a design, section 5): /api/staff and everything under it, never a path that merely begins
 * with the same letters. The app's CORS and session resolution pass over them, so a staff route never meets the app's
 * credentialed CORS, its Origin allow-list, its session or its CSRF check: the staff gate and the staff session are the
 * only origin and session logic there. Everything else in the chain (request id, access log, client identity, security
 * headers, no-store, the body limit, the global rate limit) applies to them as to any path.
 */
const isStaffPath = (path: string) => path === "/api/staff" || path.startsWith("/api/staff/");

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
  auth: Auth;
  /** Posting and feed. Optional so auth-only tests need no database for it; the server always wires it. */
  social?: Social;
  /** Image uploads. Optional for the same reason; the server always wires it. */
  media?: Media;
  /** The account lifecycle (the data export). Optional for the same reason; the server always wires it. */
  account?: Account;
  /** The staff console's API. Mounted only while CONSOLE_ORIGIN is set; optional as the other modules are. */
  staff?: Staff;
  /** Reports and notices. Optional as the other modules are; the server always wires it, whether the console is on or off. */
  moderation?: Moderation;
  /** Checks that report a part being down without marking the API unhealthy, the image worker for one. */
  advisoryChecks?: HealthChecks;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social, media, account, staff, moderation, advisoryChecks }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(auth.clientIdentity);
  app.use(securityHeaders, noStore);
  const appCors = cors({ origin: config.TRUSTED_ORIGINS, credentials: true });
  app.use((c, next) => (isStaffPath(c.req.path) ? next() : appCors(c, next)));
  const jsonBodies = bodyLimit({
    maxSize: JSON_BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorBody("payload_too_large", "The request body is too large", (c as typeof c & { get(key: "requestId"): string }).get("requestId")), 413),
  });
  app.use((c, next) => (c.req.method === "POST" && c.req.path === "/api/media" ? next() : jsonBodies(c, next)));
  // Image files come before the global limit and session resolution: they have their own bucket,
  // and a public image needs no session. Everything else under /api/media falls through to below.
  if (media) app.route("/api/media", media.fileRoutes);
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIpKey }));
  app.use((c, next) => (isStaffPath(c.req.path) ? next() : auth.resolveSession(c, next)));

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION, advisoryChecks));
  app.route("/api/auth", auth.routes);
  app.get("/api/me", auth.requireOnboarding, auth.me);
  if (media) app.route("/api/media", media.routes);
  if (account) app.route("/api/account", account.routes);
  // The console is off while CONSOLE_ORIGIN is unset: nothing is mounted, and every staff path is the unknown route below.
  if (staff && config.CONSOLE_ORIGIN !== undefined) app.route("/api/staff", staff.routes(config.CONSOLE_ORIGIN));
  // Reports and notices are taken, kept and given receipts whether or not the console is on: anyone may send one, signed
  // in or not, so these routes stand after session resolution and behind no session guard of their own.
  if (moderation) app.route("/api", moderation.routes);
  if (social) app.route("/api", social.routes);

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // The account routes render nothing themselves: their own errors and those of the three modules they call all land here.
    if (err instanceof AccountError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // A moderation flow's refusal, from the app's routes or from the console's case routes.
    if (err instanceof ModerationError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
```

### Replace `apps/api/src/auth/client-ip.ts` (whole file)

```ts
import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { ipHash, netHash } from "./identifiers";

export type ProxyTrust = "cloudflare" | "caddy" | "none";

/** The socket's peer address, or "direct" where there is no socket (tests call the app in-process). */
function socketAddress(c: Context<AppEnv>): string {
  try {
    return getConnInfo(c).remote.address ?? "direct";
  } catch {
    return "direct";
  }
}

/**
 * Which address to believe is a deployment fact, never a request's. Behind the Cloudflare tunnel it is
 * cf-connecting-ip, which Cloudflare sets; behind Caddy alone it is the first X-Forwarded-For entry,
 * which Caddy sets from the socket and never copies from the client; with nothing in front, the
 * socket. A missing header falls back down the list; a header the mode does not trust is ignored.
 */
export function resolveClientIp(c: Context<AppEnv>, trust: ProxyTrust): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  if (trust === "cloudflare") return c.req.header("cf-connecting-ip") ?? forwarded ?? socketAddress(c);
  if (trust === "caddy") return forwarded ?? socketAddress(c);
  return socketAddress(c);
}

/** The eight groups of an IPv6 address as numbers, the "::" filled in; null when the text is not such an address. */
function ipv6Groups(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16)));
  const [head, tail] = [groups(halves[0]!), halves.length === 2 ? groups(halves[1]!) : []];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const all = [...head, ...Array.from({ length: missing }, () => 0), ...tail];
  return all.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? all : null;
}

/**
 * The network an address belongs to, for the limits that count per network (3c design, section 7.1): an IPv4 address
 * is its own network, and an IPv6 address is its first 64 bits, since a single subscriber is usually given a whole /64
 * and could otherwise send from a new address every time. An IPv4 address written as an IPv6 one (::ffff:a.b.c.d)
 * counts as the IPv4 address it is. Anything that is no address is taken as it is, so a request without one ("direct",
 * in tests) still has a bucket.
 */
export function clientNetwork(ip: string): string {
  // A zone index names a link of this machine, not a network.
  const address = ip.split("%")[0]!.trim();
  if (isIP(address) !== 6) return ip;
  const mapped = /^::ffff:([0-9]+(?:[.][0-9]+){3})$/i.exec(address);
  if (mapped && isIP(mapped[1]!) === 4) return mapped[1]!;
  // An address that ends in dotted form otherwise (the old "compatible" form) is rare enough to be a bucket of its own.
  const groups = address.includes(".") ? null : ipv6Groups(address);
  if (!groups) return address.toLowerCase();
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** Sets `clientIp`, its keyed hash and the keyed hash of its network on every request, before anything limits or records it. */
export function clientIdentity(options: { trust: ProxyTrust; ipHashKey: Buffer }) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = resolveClientIp(c, options.trust);
    c.set("clientIp", ip);
    c.set("clientIpHash", ipHash(options.ipHashKey, ip));
    c.set("clientNetHash", netHash(options.ipHashKey, clientNetwork(ip)));
    await next();
  });
}
```

### Replace `apps/api/src/auth/context.ts` (whole file)

```ts
import type { AuthErrorCode, MeProfile, Profile, StaffErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { decodeKey, parseVersionedKey, type VersionedKey } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { Lockout } from "./lockout";
import type { BreachChecker } from "./passwords";
import type { AuthRepo } from "./repo";
import type { Sessions } from "./sessions";
import type { TurnstileVerifier } from "./turnstile";
import type { VerificationProvider } from "./verify/provider";

export interface AuthConfig {
  appOrigin: string;
  /** Origins allowed to send cookie-authenticated state-changing requests. */
  allowedOrigins: string[];
  authHmacKey: Buffer;
  ipHashKey: Buffer;
  totpKey: VersionedKey;
  /** Keys TOTP_ENC_KEY replaced; still accepted for decryption. */
  totpPreviousKeys: VersionedKey[];
  /** Encrypts a signed-out notifier's name, address and mail token (3c design, section 6.1); see NOTIFIER_ENC_KEY in config.ts. */
  notifierKey: VersionedKey;
  /** Keys NOTIFIER_ENC_KEY replaced; still accepted for decryption. A contact is never encrypted again under the new key. */
  notifierPreviousKeys: VersionedKey[];
  termsVersion: string;
  /** How the client address is read; see TRUST_PROXY in config.ts. */
  trustProxy: "cloudflare" | "caddy" | "none";
  /** Who checks the phone number behind the verified badge; see VERIFY_PROVIDER in config.ts. With `off` the badge routes answer badge_unavailable. */
  verifyProvider: "off" | "dev" | "vonage";
  /** The relying party passkeys are bound to; see WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME in config.ts. */
  webauthn: {
    rpId: string;
    rpName: string;
    /** The origins a ceremony's clientDataJSON may name. */
    origins: string[];
  };
  /**
   * The staff console (3a design, section 8): the only origin a staff ceremony's clientDataJSON may name and the relying
   * party staff keys are bound to, CONSOLE_ORIGIN and CONSOLE_RP_ID. Null while CONSOLE_ORIGIN is unset: the console is
   * off and no staff route is mounted.
   */
  console: { origin: string; rpId: string } | null;
}

export function authConfigFrom(config: Config): AuthConfig {
  return {
    appOrigin: config.APP_ORIGIN,
    allowedOrigins: [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    authHmacKey: decodeKey(config.AUTH_HMAC_KEY),
    ipHashKey: decodeKey(config.IP_HASH_KEY),
    totpKey: parseVersionedKey(config.TOTP_ENC_KEY),
    totpPreviousKeys: config.TOTP_ENC_KEYS_PREVIOUS.map(parseVersionedKey),
    notifierKey: parseVersionedKey(config.NOTIFIER_ENC_KEY),
    notifierPreviousKeys: config.NOTIFIER_ENC_KEYS_PREVIOUS.map(parseVersionedKey),
    termsVersion: config.TERMS_VERSION,
    trustProxy: config.TRUST_PROXY,
    verifyProvider: config.VERIFY_PROVIDER,
    webauthn: {
      rpId: config.WEBAUTHN_RP_ID,
      rpName: config.WEBAUTHN_RP_NAME,
      // A passkey ceremony run from a development origin (Expo's dev server, say) is accepted outside production only:
      // in production the web app is served from APP_ORIGIN, and no other origin may use its passkeys.
      origins: config.NODE_ENV === "production" ? [config.APP_ORIGIN] : [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    },
    // The configuration fills CONSOLE_RP_ID with the console's hostname whenever CONSOLE_ORIGIN is set.
    console: config.CONSOLE_ORIGIN === undefined ? null : { origin: config.CONSOLE_ORIGIN, rpId: config.CONSOLE_RP_ID! },
  };
}

/** Public profiles live in the public schema, which the auth module cannot reach; the API supplies this. */
export interface ProfileStore {
  create(input: { id: string; handle: string; displayName: string }): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "handle_taken" }>;
  /** The owner's view of their profile, which /me returns: the public facts plus the handle-change date, the badge and the Explore switch. */
  find(id: string): Promise<MeProfile | null>;
  /** Sets or clears the badge (profiles.verified_at), which the auth module decides but cannot write itself. */
  setVerified(id: string, at: Date | null): Promise<void>;
}

export interface AuthDeps {
  repo: AuthRepo;
  kv: KeyValueStore;
  sessions: Sessions;
  lockout: Lockout;
  mailer: Mailer;
  turnstile: TurnstileVerifier;
  breachChecker: BreachChecker;
  profiles: ProfileStore;
  /** The phone verification provider behind the badge, or null when VERIFY_PROVIDER is off. */
  verify: VerificationProvider | null;
  config: AuthConfig;
  log: Logger;
  now: () => Date;
}

/** Per-request facts the flows need. The IP is already hashed; the raw address never enters a flow. */
export interface RequestContext {
  ipHash: string;
  userAgent: string | undefined;
}

/** A staff request's facts: those of any request, and its id, which the audit rows it writes carry (3a design, section 6). */
export interface StaffRequestContext extends RequestContext {
  requestId: string;
}

export type AuthErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 503;

/**
 * The auth codes, the staff console's (the module owns staff keys and sessions, and the staff routes raise its codes as
 * AuthErrors, 3a design section 10), plus the shared one the module also raises, as the social and media modules do: a
 * well-formed request that asks for nothing, such as the current address as the new one.
 */
export type AuthErrorKind = AuthErrorCode | StaffErrorCode | "invalid_request";

const MESSAGES: Record<AuthErrorKind, string> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Request a new code.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Two-factor authentication must be turned on first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  handle_cooldown: "Handles can change once every 30 days.",
  email_in_use: "That email address already belongs to an account.",
  phone_in_use: "That phone number is already verified on another account.",
  badge_unavailable: "Verification is not available on this korbat.",
  verify_unavailable: "We could not reach the verification service. Try again in a moment.",
  passkey_invalid: "That passkey did not work. Try again or use your email.",
  passkey_unsupported: "This passkey provider is not supported. Try another one.",
  // The cap of 10; the flow passes its own message, with the hours left, for the bound of 5 a day.
  passkey_limit: "You have 10 passkeys. Remove one to add another.",
  passkey_suspended: "This passkey was switched off because a copy of it may exist. Remove it and add a new one.",
  passkey_not_found: "That passkey is gone.",
  challenge_expired: "That took too long. Try again.",
  invalid_request: "Some details are missing or invalid.",
  // The staff console's (3a design, section 10). Where only the operator can help, they say so; none sends the person to
  // a remedy the console does not have, which is why the staff flows never answer a passkey_* code.
  staff_session_required: "Your staff session ended. Sign in with your staff key.",
  staff_key_invalid: "This key does not open the staff console. If it should, ask the operator to check your staff keys.",
  staff_key_suspended: "This staff key was switched off because a copy of it may exist. Ask the operator for a link to enrol a new one.",
  staff_key_limit: "This account has 5 staff keys. Ask the operator to revoke one before enrolling another.",
  staff_key_not_device_bound: "This key can be synced or copied, so it cannot be a staff key. Use a security key or a device-bound authenticator.",
  staff_key_not_user_verified: "This key did not ask for a PIN or fingerprint, so it cannot be a staff key. Set a PIN on it, or use another key.",
  staff_key_refused: "The browser's answer for this key could not be checked. Try again, or use another key; this link still works.",
  staff_enrollment_invalid: "This enrolment link has expired or was already used. Ask the operator for a new one.",
  staff_step_up_required: "Confirm this with your staff key.",
  staff_step_up_invalid: "That confirmation was for another action, was already used or could not be checked. Try again.",
};

export function authErrorMessage(code: AuthErrorKind): string {
  return MESSAGES[code];
}

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorKind,
    readonly status: AuthErrorStatus,
    message: string = MESSAGES[code],
    /** For rate limits: seconds until the window resets, sent as Retry-After. */
    readonly retryAfterSeconds?: number,
    /**
     * What the app needs beyond the code, sent as the envelope's `details`: for reauth_required, the level the action
     * asks for and the factor kinds the session proved in time (1c design, section 7.1).
     */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** True for a Postgres unique-constraint violation, however deeply the driver error is wrapped. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

### Replace `apps/api/src/auth/identifiers.ts` (whole file)

```ts
import { hmacHex } from "./crypto";

/**
 * Keyed, namespaced hashes for identifiers the server must recognise but never store raw.
 * The namespace prefix keeps a device id, an IP, an email and a phone number that happen to share
 * text from producing the same hash.
 */
export function deviceHash(key: Buffer, deviceId: string): string {
  return hmacHex(key, `device:${deviceId}`);
}

export function ipHash(key: Buffer, ip: string): string {
  return hmacHex(key, `ip:${ip}`);
}

/** The network a client is on, as client-ip.ts names it: what the limits that count per network are keyed by. */
export function netHash(key: Buffer, network: string): string {
  return hmacHex(key, `net:${network}`);
}

export function emailHash(key: Buffer, email: string): string {
  return hmacHex(key, `email:${email.trim().toLowerCase()}`);
}

/** The number arrives in E.164 already (the Phone contract), so it is hashed as given. */
export function phoneHash(key: Buffer, phone: string): string {
  return hmacHex(key, `phone:${phone}`);
}
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type {
  DeleteConfirmRequest,
  DeleteStartResponse,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffEnrollVerifyResponse,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInVerifyRequest,
  StaffStepUpAction,
  StaffStepUpOptionsRequest,
} from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Context, MiddlewareHandler } from "hono";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore, type RequestContext, type StaffRequestContext } from "./context";
import { confirmDeletion, finishPurge, startDeletion } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import {
  accountReportMailStopped,
  confirmNotifier,
  findNotifierContacts,
  forgetNotifierAfter,
  mailAccount,
  mailNotifier,
  mailStaff,
  notifierFacts,
  notifierMailTokenMatches,
  notifierName,
  overdueContacts,
  resumeAccountReportMail,
  stopNotifier,
  storeNotifierContact,
  type AccountMailResult,
  type AccountMessage,
  type NotifierFacts,
  type NotifierMailResult,
  type NotifierMessage,
  type StaffMessage,
} from "./flows/notifiers";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStrongFreshAuth, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions, type Session } from "./sessions";
import type { PublicKeyCredentialRequestOptionsJSON } from "./passkeys/webauthn";
import { enrollOptions, enrollVerify, type StaffEnrollOptions } from "./staff/enroll";
import { requireStaff } from "./staff/middleware";
import { listStaffKeys, listStaffSessions, signOutStaff, staffMe, type ActiveStaffSession } from "./staff/sessions";
import { signInOptions, signInVerify, type StaffSignedIn } from "./staff/signin";
import { requireStaffStepUp, revokeStaffSession, stepUpOptions, type StaffStepUpConfirmed } from "./staff/step-up";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore, RequestContext, StaffRequestContext } from "./context";
export type { AccountExport } from "./flows/export";
export type { AccountMailResult, AccountMessage, NoticeReceivedMessage, NotifierFacts, NotifierMailResult, NotifierMessage, StaffMessage } from "./flows/notifiers";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { ActiveStaffSession } from "./staff/sessions";
export type { StaffSignedIn } from "./staff/signin";
export type { StaffStepUpConfirmed } from "./staff/step-up";
export type { StaffKeysRevokedReport } from "./staff/revoke";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, isUniqueViolation } from "./context";
export { SYSTEM_ACTOR_ID, grantRole, type RoleGranted } from "./admin";
/** The account module clears a web session's cookies after a deletion; the cookie names and attributes stay this module's. */
export { clearSessionCookies } from "./cookies";
/**
 * The staff module's sign-in and sign-out routes set and clear the staff cookies (3a design, section 5); their names and
 * attributes stay this module's, and requireStaff is their only reader.
 */
export { clearStaffCookies, setStaffCookies } from "./staff/cookies";
/** `staff.js revoke`, from the server's command line only, as grant-role's grantRole is. */
export { revokeStaffKeys } from "./staff/revoke";
/**
 * audit-verify's check of a step-up assertion an audit row stored, against the public key, origin and relying party ID
 * recorded on its key (3a design, section 7, Command line): the WebAuthn library stays behind the wrapper, and the check
 * needs no server secret.
 */
export { verifyRecordedAssertion, type RecordedAssertion } from "./passkeys/webauthn";
export { checkHandle } from "./handles";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

/**
 * What the account module needs from this one (1b design, section 5): the auth side of a deletion
 * (the code, the confirmation that takes the account down, the purge's list and its last step), the
 * auth side of the data export, and the event log for what the account module does.
 */
export interface AuthForAccount {
  /** Mails the deletion code to the account's own address and answers the flow id. */
  startDeletion(session: Session, ctx: RequestContext): Promise<DeleteStartResponse>;
  /** Checks the typed handle and the code, then marks the account deleted and revokes every session, in one transaction: from here the account is gone. */
  confirmDeletion(session: Session, input: DeleteConfirmRequest): Promise<void>;
  /** Deleted accounts whose auth row is not anonymised yet, oldest deletion first. */
  pendingPurges(): Promise<string[]>;
  /** Finishes step 1's rows if a take-down stopped after the mark, then anonymises the auth row and marks it purged; a no-op when it already is. */
  finishPurge(userId: string): Promise<void>;
  /** The account's facts, its passkeys (without their keys), its live sessions, its devices and its own events. */
  exportAccount(userId: string): Promise<AccountExport>;
  appendEvent(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

/**
 * What the staff module needs from this one (3a design, section 5): the credential side of the staff routes, which the
 * staff module mounts behind its gate. Staff keys, staff sessions and enrolments are credentials, so their flows and
 * tables stay here, and the staff module reaches them only through this interface.
 */
export interface AuthForStaff {
  /** Registration options for the key an enrolment link's holder is about to create. */
  enrollOptions(input: StaffEnrollOptionsRequest): Promise<StaffEnrollOptions>;
  /** Checks the browser's answer and stores the staff key, spending the link; the owner is mailed. */
  enrollVerify(input: StaffEnrollVerifyRequest, ctx: StaffRequestContext): Promise<StaffEnrollVerifyResponse>;
  /** Discoverable-credential options for a staff sign-in. */
  signInOptions(): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>;
  /** Checks a staff key's assertion and opens a staff session; the route sets its cookies with setStaffCookies. */
  signInVerify(input: StaffSignInVerifyRequest, ctx: StaffRequestContext): Promise<StaffSignedIn>;
  /** Stands before every staff route that needs a session: reads it and sets `staffSession` on the context. */
  requireStaff: MiddlewareHandler<AppEnv>;
  /** The session's account and both its ends, with the seconds left. */
  me(session: ActiveStaffSession): Promise<StaffMe>;
  /** The person's own live staff sessions. */
  sessions(session: ActiveStaffSession): Promise<StaffSessionsResponse>;
  /** The person's own live staff keys. */
  keys(session: ActiveStaffSession): Promise<StaffKeysResponse>;
  /** Ends the session, on the record; the route clears its cookies with clearStaffCookies. */
  signOut(session: ActiveStaffSession, ctx: StaffRequestContext): Promise<void>;
  /** Options for confirming one action with the session's key: a challenge bound to the session and to exactly that action. */
  stepUpOptions(session: ActiveStaffSession, request: StaffStepUpOptionsRequest): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>;
  /**
   * Stands before every staff route that changes something, behind requireStaff: verifies the body's `stepUp` against the
   * action, the target `target` reads from the request and the body's params, and sets `staffStepUp` on the context.
   */
  requireStaffStepUp(action: StaffStepUpAction, target: (c: Context<AppEnv>) => string | undefined): MiddlewareHandler<AppEnv>;
  /** Revokes one of the person's own live staff sessions, on the record with its confirmation; false when the handle names none. */
  revokeSession(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: StaffRequestContext): Promise<boolean>;
}

/**
 * What the moderation module needs from this one (3c design, section 5): the human check of a signed-out notice, a
 * signed-out notifier's contact, which is stored here, encrypted, out of the API role's reach, and every mail to an
 * account, a notifier or staff. The moderation module names a contact by the id it chose and an account by its id; it
 * never sees an address or a mail token, and a message is a typed union over the templates, so no caller passes free
 * text. `mailNotifier` and `mailAccount` answer "refused" when the relay refused the recipient for good and throw
 * MailUnavailable for any other failure, so the caller records the one and tries the other again.
 */
export interface AuthForModeration {
  /** Turnstile's answer for the token of a signed-out notice; every failure is false. */
  verifyHuman(token: string): Promise<boolean>;
  /** Stores a signed-out notifier's name and address under the id the notice carries, with a fresh mail token when an address is given. */
  storeNotifierContact(contactId: string, contact: { name?: string; email?: string }): Promise<void>;
  /**
   * Sends a signed-out notifier's receipt, with its page link. "suppressed" for a stopped address, "folded" for a
   * second receipt in 24 hours to an address that is not confirmed, "no_address" for a contact without one, "forgotten"
   * for an id no contact has (it was never stored, or the janitor has deleted it).
   */
  mailNotifier(contactId: string, message: NotifierMessage): Promise<NotifierMailResult>;
  /** Sends a report mail to an account's own address, with neither the cap nor a confirmation; "suppressed" when that address said stop, "no_address" for a deleted account. */
  mailAccount(userId: string, message: AccountMessage): Promise<AccountMailResult>;
  /** Sends a staff alert to every live staff account, best effort; answers how many addresses the relay took, and never throws for a failed send. */
  mailStaff(message: StaffMessage): Promise<number>;
  /** For each id, whether a contact has it, whether a name and an address were given, and whether the address is confirmed or stopped. */
  notifierFacts(contactIds: readonly string[]): Promise<Map<string, NotifierFacts>>;
  /** The name a notifier gave, or null: for a confirmed reveal only. */
  notifierName(contactId: string): Promise<string | null>;
  /** Whether the token is the contact's mail token, compared in constant time; false when it has none. */
  notifierMailTokenMatches(contactId: string, token: string): Promise<boolean>;
  /** With the contact's mail token: the address is confirmed for 30 days and any stop of it lifted. False for any other token. */
  confirmNotifier(contactId: string, token: string): Promise<boolean>;
  /** With the contact's mail token: no more report mails to the address. False for any other token. */
  stopNotifier(contactId: string, token: string): Promise<boolean>;
  /** Whether the account's own address said stop. */
  accountReportMailStopped(userId: string): Promise<boolean>;
  /** Lifts a stop of the account's own address; true when there was one. */
  resumeAccountReportMail(userId: string): Promise<boolean>;
  /** Sets the day each of these contacts is forgotten. */
  forgetNotifierAfter(contactIds: readonly string[], at: Date): Promise<void>;
  /** Command line only: the contacts that gave an address, with the names they gave, for an access request. */
  findNotifierContacts(email: string): Promise<{ id: string; name: string | null }[]>;
  /** How many contacts and confirmations should have been removed more than a day ago: a count only. */
  overdueContacts(): Promise<number>;
}

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
  /**
   * The phone verification provider behind the verified badge. Absent or null, the badge routes answer
   * badge_unavailable; the server passes verificationProviderFrom(config), tests the development provider.
   */
  verify?: VerificationProvider | null;
  now?: () => Date;
}

/**
 * The provider VERIFY_PROVIDER names: none for `off` (the badge is hidden), the fixed-code one for `dev`,
 * Vonage Verify with the configured credentials and brand for `vonage`. `fetchFn` is for tests only.
 */
export function verificationProviderFrom(config: Config, fetchFn?: typeof fetch): VerificationProvider | null {
  switch (config.VERIFY_PROVIDER) {
    case "off":
      return null;
    case "dev":
      return devProvider();
    case "vonage":
      // Production refuses this configuration in config.ts; development gets the same refusal here, at start-up, rather than a failing first request.
      if (!config.VONAGE_API_KEY || !config.VONAGE_API_SECRET) throw new Error("VERIFY_PROVIDER=vonage needs VONAGE_API_KEY and VONAGE_API_SECRET");
      return vonageProvider({ apiKey: config.VONAGE_API_KEY, apiSecret: config.VONAGE_API_SECRET, brand: config.VERIFY_BRAND, fetch: fetchFn });
  }
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
    verify: options.verify ?? null,
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  /** A security event about an account, for the modules that own no auth table (the social module's profile and handle changes, the account module's export). */
  const appendEvent = (userId: string, type: AuthEventType, metadata?: Record<string, unknown>) => repo.appendEvent({ userId, type, metadata });
  const forAccount: AuthForAccount = {
    startDeletion: (session, ctx) => startDeletion(deps, session, ctx),
    confirmDeletion: (session, input) => confirmDeletion(deps, session, input),
    pendingPurges: () => repo.pendingPurges(),
    finishPurge: (userId) => finishPurge(deps, userId),
    exportAccount: (userId) => exportAccount(deps, userId),
    appendEvent,
  };
  const staffGuard = requireStaff(deps);
  const forStaff: AuthForStaff = {
    enrollOptions: (input) => enrollOptions(deps, input),
    enrollVerify: (input, ctx) => enrollVerify(deps, input, ctx),
    signInOptions: () => signInOptions(deps),
    signInVerify: (input, ctx) => signInVerify(deps, input, ctx),
    requireStaff: staffGuard,
    me: (session) => staffMe(deps, session),
    sessions: (session) => listStaffSessions(deps, session),
    keys: (session) => listStaffKeys(deps, session),
    signOut: (session, ctx) => signOutStaff(deps, session, ctx),
    stepUpOptions: (session, request) => stepUpOptions(deps, session, request),
    requireStaffStepUp: (action, target) => requireStaffStepUp(deps, action, target),
    revokeSession: (session, confirmed, ctx) => revokeStaffSession(deps, session, confirmed, ctx),
  };
  const forModeration: AuthForModeration = {
    verifyHuman: (token) => deps.turnstile.verify(token),
    storeNotifierContact: (contactId, contact) => storeNotifierContact(deps, contactId, contact),
    mailNotifier: (contactId, message) => mailNotifier(deps, contactId, message),
    mailAccount: (userId, message) => mailAccount(deps, userId, message),
    mailStaff: (message) => mailStaff(deps, message),
    notifierFacts: (contactIds) => notifierFacts(deps, contactIds),
    notifierName: (contactId) => notifierName(deps, contactId),
    notifierMailTokenMatches: (contactId, token) => notifierMailTokenMatches(deps, contactId, token),
    confirmNotifier: (contactId, token) => confirmNotifier(deps, contactId, token),
    stopNotifier: (contactId, token) => stopNotifier(deps, contactId, token),
    accountReportMailStopped: (userId) => accountReportMailStopped(deps, userId),
    resumeAccountReportMail: (userId) => resumeAccountReportMail(deps, userId),
    forgetNotifierAfter: (contactIds, at) => forgetNotifierAfter(deps, contactIds, at),
    findNotifierContacts: (email) => findNotifierContacts(deps, email),
    overdueContacts: () => overdueContacts(deps),
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    appendEvent,
    /** The interface the account module uses. */
    forAccount,
    /** The interface the staff module uses. */
    forStaff,
    /** The interface the moderation module uses. */
    forModeration,
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it, and its network with it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    /** Level 2 within the window on an account with TOTP, level 1 otherwise: for the routes of the 1c design's section 10. */
    requireStrongFreshAuth: (maxAgeSeconds?: number) => requireStrongFreshAuth(deps, maxAgeSeconds),
    /** A staff session from the staff cookie, read from the database at every request (3a design, section 7). */
    requireStaff: staffGuard,
    /** A fresh confirmation by the staff session's key, bound to the action a route is about to execute (3a design, section 7). */
    requireStaffStepUp: forStaff.requireStaffStepUp,
    /** Starts the retention pass (dead codes, old sessions and staff sessions, spent enrolment links, device address hashes, old events, forgotten notifier contacts and their confirmations) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/auth/janitor.ts` (whole file)

```ts
import { createJob, type JobLock } from "../lib/jobs";
import type { AuthDeps } from "./context";
import { HOUR, MINUTE } from "./limits";

const DAY = 24 * HOUR;

export const JANITOR_INTERVAL_MS = 10 * MINUTE;
/** A code is dead ten minutes after it was sent; the row goes a day later. */
export const EMAIL_CODE_RETENTION_MS = 24 * HOUR;
/** Revoked and expired sessions stay listed nowhere; the rows go after a month. */
export const SESSION_RETENTION_MS = 30 * DAY;
/** The design's IP-hash purge (section 3b): a device keeps its address hash for 30 days after it was last seen. */
export const DEVICE_IP_RETENTION_DAYS = 30;
/** The security log is kept for 90 days. */
export const EVENT_RETENTION_DAYS = 90;
/** Staff sessions go as the app's sessions do, a month after they were revoked or expired (3a design, section 7). */
export const STAFF_SESSION_RETENTION_MS = 30 * DAY;
/** Enrolment links go as email codes do, a day after they were used or expired; one that can still enrol is never the janitor's. */
export const STAFF_ENROLLMENT_RETENTION_MS = 24 * HOUR;

export interface JanitorReport {
  emailCodes: number;
  sessions: number;
  staffSessions: number;
  staffEnrollments: number;
  deviceIpHashes: number;
  events: number;
  /** Notifier contacts whose day to be forgotten has passed (3c design, section 6.1). */
  notifierContacts: number;
  /** Confirmations of a notifier's address that ran out. */
  notifierConfirmations: number;
}

/**
 * One pass of retention. A plain function of the clock, so tests call it with whatever time they need. Each purge runs
 * in a try of its own: one that throws is logged with its name and counts 0, and the round goes on, so a table that
 * cannot be purged never keeps the others' rows past their time.
 */
export async function janitor(deps: AuthDeps, now: Date): Promise<JanitorReport> {
  const purge = async (name: keyof JanitorReport, run: () => Promise<number>): Promise<number> => {
    try {
      return await run();
    } catch (err) {
      deps.log.error({ err, purge: name }, "auth janitor: purge failed");
      return 0;
    }
  };
  const report: JanitorReport = {
    emailCodes: await purge("emailCodes", () => deps.repo.purgeEmailCodes(new Date(now.getTime() - EMAIL_CODE_RETENTION_MS))),
    sessions: await purge("sessions", () => deps.repo.purgeSessions(new Date(now.getTime() - SESSION_RETENTION_MS))),
    // Staff keys are never deleted: audit-verify checks old confirmations against them, and audit rows name them.
    staffSessions: await purge("staffSessions", () => deps.repo.purgeStaffSessions(new Date(now.getTime() - STAFF_SESSION_RETENTION_MS))),
    staffEnrollments: await purge("staffEnrollments", () => deps.repo.purgeStaffEnrollments(new Date(now.getTime() - STAFF_ENROLLMENT_RETENTION_MS))),
    deviceIpHashes: await purge("deviceIpHashes", () => deps.repo.purgeDeviceIpHashes(new Date(now.getTime() - DEVICE_IP_RETENTION_DAYS * DAY))),
    events: await purge("events", () => deps.repo.purgeEvents(EVENT_RETENTION_DAYS)),
    // A contact goes once its own day has passed, which the moderation module moves while the notice is owed something;
    // a confirmation at the end of its 30 days. Neither has a grace period: the day itself is the published one.
    notifierContacts: await purge("notifierContacts", () => deps.repo.purgeNotifierContacts(now)),
    notifierConfirmations: await purge("notifierConfirmations", () => deps.repo.purgeNotifierConfirmations(now)),
  };
  if (Object.values(report).some((n) => n > 0)) deps.log.info(report, "auth janitor: rows purged");
  return report;
}

/** Runs the pass every ten minutes under the shared lock. */
export function createJanitor(deps: AuthDeps, lock: JobLock) {
  return createJob({ name: "auth-janitor", intervalMs: JANITOR_INTERVAL_MS, lockTtlMs: JANITOR_INTERVAL_MS, lock, log: deps.log, run: () => janitor(deps, deps.now()) });
}
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  authEventType,
  authEvents,
  devices,
  emailCodePurpose,
  emailCodes,
  notifierConfirmations,
  notifierContacts,
  notifierSuppressions,
  passkeys,
  sessions,
  staffEnrollments,
  staffKeys,
  staffSessions,
  userRole,
  users,
  type Db,
} from "@korbat/db";
import { boundLockWaits, isLockNotAvailable } from "../lib/lock-bounds";
import { SYSTEM_ACTOR_ID } from "./admin";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type PasskeyRow = typeof passkeys.$inferSelect;
/** What a signed-out notifier gave, as stored: every `Enc` column a ciphertext under the notifier key. */
export type NotifierContactRow = typeof notifierContacts.$inferSelect;
/** A passkey with the label of the device that added it, null once that device is gone. */
export type PasskeyListRow = PasskeyRow & { createdOn: string | null };
/** What a registration stores of a verified passkey; the id, the last use and the suspicion are the row's own. */
export type NewPasskey = Omit<PasskeyRow, "id" | "lastUsedAt" | "suspectAt">;

/** The per-account bounds a registration checks in its transaction (1c design, section 2): at most `passkeys` at a time, and `additions` within `windowMs`. */
export interface PasskeyLimits {
  passkeys: number;
  additions: number;
  windowMs: number;
}

/** What addPasskey answers: the row it inserted; which bound refused it, with the seconds until the day has a slot again; or that the account is gone. */
export type AddPasskeyOutcome =
  | { ok: true; passkey: PasskeyRow }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "cap" }
  | { ok: false; reason: "daily"; retryAfterSeconds: number };

/** What the lockdown's transaction is told (1c design, sections 2 and 7.6); the flow works it out from the caller's anchor. */
export interface LockDownInput {
  /** The flows' clock, for the revocations and the password's change time. */
  now: Date;
  /** How far back the lockdown reaches: passkeys created at or after this go, and two-factor enabled at or after it is turned off. */
  since: Date;
  /** Passkeys to remove whatever their age: the one that signed in, or the one a link is about. */
  passkeyIds: readonly string[];
  /** The caller's event, recorded in the same transaction with what the lockdown did added to its metadata. */
  event: { type: AuthEventType; deviceId: string | null; ipHash: string | null; metadata: Record<string, unknown> };
}

/** What a lockdown did: the ids of the sessions it revoked, for the cache tombstones, the passkeys it removed, and whether it turned two-factor off. */
export interface LockDownOutcome {
  sessionIds: string[];
  passkeysRemoved: string[];
  totpCleared: boolean;
}

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  /** The session's id for life, which a rotation keeps. */
  handle: string;
  /** The factors proven, kind to epoch milliseconds; empty for a session from before migration 0010. */
  factors: Record<string, number>;
  passkeyId: string | null;
}

/** A staff enrolment found by its token, with what the enrolment flow checks of its account (3a design, section 7). */
export interface StaffEnrollmentRow {
  id: string;
  userId: string;
  origin: string;
  rpId: string;
  expiresAt: Date;
  usedAt: Date | null;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  onboardedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What the enrolment flow stores of a verified staff key; auth.add_staff_key copies the origin and relying party ID from the enrolment. */
export interface NewStaffKey {
  userId: string;
  enrollmentId: string;
  /** The link's token itself: the function hashes it, so a hash read from the table spends nothing. */
  token: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
  aaguid: string;
  requestId: string;
}

/** What addStaffKey answers: the new key's id, or which of auth.add_staff_key's re-checks refused it. */
export type AddStaffKeyOutcome = { ok: true; keyId: string } | { ok: false; reason: "enrollment_invalid" | "limit" };

/** A staff key as the console's sign-in finds it by its credential id, with what the flow checks of its account. */
export interface StaffKeyForSignIn {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
  name: string;
  revokedAt: Date | null;
  /** The console's origin and relying party ID the key was enrolled for, which audit-verify judges its confirmations by. */
  origin: string;
  rpId: string;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What a staff sign-in's transaction writes (3a design, section 7, Sign-in): the key's use, the session, its event and its audit row. */
export interface NewStaffSession {
  /** sha256 of the token; the token itself is never stored. */
  id: string;
  userId: string;
  keyId: string;
  /** The counter the verified assertion reported, which the key's row takes only if it moved forward. */
  newCounter: number;
  now: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
  ipHash: string | null;
  requestId: string;
}

/** A live staff session as requireStaff reads it, with its account's role, in one statement joined to its key and its account. */
export interface StaffSessionRow {
  id: string;
  handle: string;
  userId: string;
  keyId: string;
  role: UserRole;
  createdAt: Date;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
}

/**
 * A revocation of staff keys in one auth transaction (3a design, section 7): `staff.js revoke` with one key or `all`, and the
 * counter rule's revocation of the key that went backwards, which also marks it suspect and records its own event. The
 * account is named by its id (the counter rule knows it) or by its address (the command line).
 */
export interface StaffKeyRevocation {
  account: { id: string } | { email: string };
  key: string | "all";
  suspect: boolean;
  /**
   * Where it came from, as the events and audit rows record it: the command line, or the counter rule at a sign-in or a
   * step-up. The command line also waits at most 10 seconds for a lock.
   */
  via: "cli" | "sign_in" | "step_up";
  actorId: string;
  now: Date;
  requestId?: string | null;
}

/** What a revocation did, for the command line's report and the mail; or why it found nothing to act on. */
export type StaffKeysRevoked =
  | {
      ok: true;
      userId: string;
      /** The account's address as stored, which the mail goes to. */
      email: string;
      /** The keys revoked now, oldest first, each with how many of its staff sessions were revoked now. */
      keys: { id: string; name: string; sessionsRevoked: number }[];
      staffSessionsRevoked: number;
      enrollmentsCancelled: number;
      /** For one key named by the command line: when it was revoked before, in which case nothing changed. */
      alreadyRevokedAt: Date | null;
    }
  | { ok: false; reason: "no_account" | "no_key" };

/** The staff key a staff session was opened with, as its step-up reads it: the credential to verify against and its name for a suspect key's mail. */
export interface StaffKeyCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
  name: string;
  revokedAt: Date | null;
  /** The console's origin and relying party ID the key was enrolled for, which audit-verify judges its confirmations by. */
  origin: string;
  rpId: string;
}

/**
 * A staff session's revocation confirmed by a step-up (3a design, section 7, Sessions and keys): who confirms it (the
 * account, its session and the key that signed) and what the audit row stores of the confirmation.
 */
export interface ConfirmedStaffSessionRevocation {
  userId: string;
  /** The confirming session's handle, which the step-up's challenge was bound to. */
  staffSession: string;
  keyId: string;
  /** The handle of the session to revoke. */
  handle: string;
  actionHash: string;
  params: Record<string, unknown>;
  stepUp: { authenticatorData: string; clientDataJSON: string; signature: string };
  /** The step-up challenge's expiry: the audit row must join the chain before it, by the database's clock. */
  expiresAt: Date;
  now: Date;
  ipHash: string | null;
  requestId: string;
}

/** A role change as it committed: what it revoked and deleted, for the cache tombstones, the command's report and the mail. */
export interface RoleChange {
  userId: string;
  /** The account's address as stored, which the staff_keys_revoked mail goes to. */
  email: string;
  previousRole: UserRole;
  /** The revoked app sessions' ids, for the cache tombstones. */
  sessionIds: string[];
  staffSessionsRevoked: number;
  enrollmentsDeleted: number;
  /** The staff keys revoked by a change to user, oldest first. */
  keysRevoked: { id: string; name: string }[];
}

export interface SessionListRow {
  /** The hash of the session's token, which its cached copy is keyed by; it changes when the token rotates and is never shown to a client. */
  id: string;
  /** The session's id for life: what the list shows, and what the targeted revoke takes. */
  handle: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /**
     * Moves the account to an address its owner just proved with a code, so it is verified as of now.
     * When another row holds the address, in any case, the unique index on lower(email) raises the
     * driver's unique violation; the flow reports that as email_in_use.
     */
    async changeEmail(userId: string, email: string, now: Date): Promise<void> {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(eq(users.id, userId));
    },

    /**
     * The keyed hash of the phone number behind the verified badge, or null to drop it. When another row
     * holds the same hash, the partial unique index on phone_hash raises the driver's unique violation;
     * the flow reports that as phone_in_use.
     */
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      await db.update(users).set({ phoneHash }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    /** Replaces the hash only, after a sign-in verified the password against older parameters. */
    async replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    /** The same secret re-encrypted with the current key; nothing else about MFA changes. */
    async setTotpSecretEnc(userId: string, totpSecretEnc: string): Promise<void> {
      await db.update(users).set({ totpSecretEnc }).where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    /**
     * A role change (3a design, section 7) in one transaction: the account's row is locked first, FOR NO KEY UPDATE (the
     * lock the role's update would take, and the one every writer of staff rows takes first, so none of them can wait on
     * another in a circle); the role is set, every session and every staff session revoked and every unused enrolment link
     * deleted, so the new role applies at once and no link issued before enrols anything. A change to user also revokes
     * every staff key, with a staff_key_revoked event each: a person made staff again enrols new keys. Last, through
     * auth.append_audit, each revocation's audit row and then the role_granted row, which hold the audit chain's head until
     * the commit, so the change and its record commit together or not at all. Only the command line calls this, and it
     * waits at most 10 seconds for a lock: an API that holds the head or the row open cannot stall it for longer, and one
     * that times out has changed nothing. The cache tombstones and the mail are not the database's to write, so the caller
     * does them after the commit with what this answers; undefined when no live account has the address.
     */
    async changeRole(email: string, role: UserRole, audit: { actorId: string; now: Date }): Promise<RoleChange | undefined> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return undefined;
        await tx.update(users).set({ role }).where(eq(users.id, account.id));
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: audit.now })
          .where(and(eq(sessions.userId, account.id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        const staff = await revokeStaffAccess(tx, account.id, audit.now, { keys: role === "user", enrollments: "unused", via: "role_change" });
        await appendKeyRevocations(tx, audit.actorId, staff, "role_change");
        await appendAudit(tx, {
          actorId: audit.actorId,
          action: "role_granted",
          targetType: "user",
          targetId: account.id,
          // A role change deletes open links only, so every link it deleted was one it cancelled.
          metadata: { from: account.role, to: role, via: "cli", staffSessionsRevoked: staff.staffSessionsRevoked, enrollmentsDeleted: staff.enrollmentsCancelled },
        });
        return {
          userId: account.id,
          email: account.email,
          previousRole: account.role,
          sessionIds: revoked.map((row) => row.id),
          staffSessionsRevoked: staff.staffSessionsRevoked,
          enrollmentsDeleted: staff.enrollmentsCancelled,
          keysRevoked: staff.keys.map(({ id, name }) => ({ id, name })),
        };
      });
    },

    // ------------------------------------------------------------ deletion

    /**
     * Marks the row deleted and nothing else: from now on every lookup above treats it as absent. Once only; a
     * later call changes nothing. A deletion goes through takeDown; this is the state a take-down that stopped
     * after the mark would leave, which finishTakeDown completes.
     */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /**
     * Step 1 of a deletion (1b design, section 7.6) in one transaction: the row is marked deleted, every live
     * session revoked, every device, code and passkey deleted, the WebAuthn user handle cleared, the account's staff
     * keys and staff sessions revoked, its enrolment links deleted and its keys blanked (3a design, section 7), and the
     * account_deleted event appended; last, the audit rows of the staff side, with the account as their actor, since its
     * owner asked for the deletion. Either all of it lands or none of it does, so a failure leaves a live account with its
     * sessions, never a deleted one with sessions, devices, passkeys or staff keys that nothing would remove. Answers the
     * ids of the sessions it revoked, for the cache tombstones, which are not the database's to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const taken = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        await appendTakeDownAudit(tx, userId, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /**
     * The rows of step 1 again (the sessions, devices, codes and passkeys, the WebAuthn user handle and the staff rows), for
     * a row marked deleted and not purged yet: a take-down that stopped after the mark, or a session that a sign-in already
     * past its lookup created after it. Nothing for a live or a purged row. The account_deleted event is not appended
     * again: the confirmation that recorded it is the only one there was. The staff side's audit rows are written, last,
     * for what this run revoked, with the server as their actor: the purge job finishes the take-down, no person.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        // The account's row first, as every writer of staff rows takes it (3a design, section 7).
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)))
          .for("no key update");
        if (!row) return [];
        const taken = await takeDownRows(tx, userId, now);
        await appendTakeDownAudit(tx, SYSTEM_ACTOR_ID, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /** Deleted accounts whose row the purge has not anonymised yet, oldest deletion first, at most 100 a round. */
    async pendingPurges(): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNotNull(users.deletedAt), isNull(users.purgedAt)))
        .orderBy(users.deletedAt, users.id)
        .limit(100);
      return rows.map((r) => r.id);
    },

    /**
     * The last step of a deletion: the address becomes deleted:<id> (unique, and never a real address),
     * every credential and personal fact is cleared, and purged_at says it is done. Only a deleted row
     * not purged yet is written, so a second call, or a call for a live account, changes nothing.
     */
    async finishPurge(userId: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({
          email: `deleted:${userId}`,
          emailVerifiedAt: null,
          passwordHash: null,
          totpSecretEnc: null,
          totpEnabledAt: null,
          recoveryCodesHash: [],
          phoneHash: null,
          ageConfirmedAt: null,
          termsVersion: null,
          termsAcceptedAt: null,
          purgedAt: now,
        })
        .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
    },

    // ------------------------------------------------------------ lockdown

    /**
     * The lockdown (1c design, sections 2 and 7.6) in one transaction, as takeDown is one: every live session
     * revoked, every device revoked (so the next sign-in on any of them counts as a new device), the password
     * cleared as setPasswordHash clears it, the passkeys in reach removed, two-factor turned off as disableTotp
     * does when it was enabled at or after `since`, and the caller's event appended with what was done. Either
     * all of it lands or none of it does: the link that started it is spent by then, so a lockdown that stopped
     * halfway could not be asked for again, and would be on no record. The user row is locked first, as takeDown
     * and a registration take it first, so none of the three can wait on another in a circle, and two-factor is
     * read from the locked row. Answers the ids of the sessions it revoked, for the cache tombstones, which are
     * not the database's to write.
     */
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      return db.transaction(async (tx) => {
        // An account that is gone has no two-factor to clear; its rows, if any are left, are still locked down below.
        const [locked] = await tx
          .select({ totpEnabledAt: users.totpEnabledAt })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for("update");
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: input.now })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        await tx.update(devices).set({ revokedAt: input.now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
        // The user's passkeys from `since` on, plus any of theirs the caller names; a named passkey of another account is not the caller's to remove and stays.
        const reach = input.passkeyIds.length > 0 ? or(gte(passkeys.createdAt, input.since), inArray(passkeys.id, [...input.passkeyIds])) : gte(passkeys.createdAt, input.since);
        const removed = await tx
          .delete(passkeys)
          .where(and(eq(passkeys.userId, userId), reach))
          .returning({ id: passkeys.id });
        const totpCleared = locked !== undefined && locked.totpEnabledAt !== null && locked.totpEnabledAt.getTime() >= input.since.getTime();
        await tx
          .update(users)
          .set({
            passwordHash: null,
            passwordChangedAt: input.now,
            failedLogins: 0,
            lockedUntil: null,
            ...(totpCleared ? { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] } : {}),
          })
          .where(eq(users.id, userId));
        const passkeysRemoved = removed.map((row) => row.id);
        await tx.insert(authEvents).values({
          userId,
          type: input.event.type,
          deviceId: input.event.deviceId,
          ipHash: input.event.ipHash,
          metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true },
        });
        return { sessionIds: revoked.map((row) => row.id), passkeysRemoved, totpCleared };
      });
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    /** The device by its row id, revoked or not: a session's device, whose platform names a passkey and whose label the passkey notices carry. */
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    /** A revoked device no longer carries live sessions and counts as new at its next sign-in. */
    async revokeDevice(id: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
    },

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
    },

    // ------------------------------------------------------------ sessions

    /**
     * A new session with the factors its sign-in proved (kind to epoch milliseconds from the flows' clock) and the passkey
     * that started it, if one did. The reauth time is the latest of the factors, which is what freshness is read from. A row
     * without factors, as migration 0010 left the sessions from before it, re-authenticates before its next sensitive action.
     */
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        factors,
        passkeyId: input.passkeyId ?? null,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          handle: sessions.handle,
          factors: sessions.factors,
          passkeyId: sessions.passkeyId,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    /**
     * Records a factor the session proved at `at`: the kind's time is set or replaced, and reauth_at, the latest of
     * them, follows the write. The flows always pass their clock's now.
     */
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      await db
        .update(sessions)
        .set({ factors: sql`${sessions.factors} || ${JSON.stringify({ [kind]: at.getTime() })}::jsonb`, reauthAt: at })
        .where(eq(sessions.id, id));
    },

    /**
     * Replaces the session's id, the token's hash, and nothing else, for a live session only: the handle, factors, reauth
     * time, passkey, device and expiries stay. False when the session is revoked or gone, so a rotation never revives one.
     * Nothing references sessions.id, so the primary key changes in place.
     */
    async rotateSession(id: string, newId: string): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ id: newId })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /**
     * Revokes one session of this user, named by its handle: the id a rotation keeps, so a session listed before its
     * token rotated is still found. Answers the row's id as it is now, which its cached copy is keyed by; undefined
     * when the session does not belong to the user or is already revoked.
     */
    async revokeSession(handle: string, userId: string, now: Date): Promise<string | undefined> {
      const [row] = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.handle, handle), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return row?.id;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          handle: sessions.handle,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ passkeys

    /**
     * The account's WebAuthn user handle, set to `candidate` when there is none yet (1c design, section 6): a
     * compare-and-set in one statement, so two registrations at once end with the same handle, whichever wrote it.
     * Undefined for an account that is gone.
     */
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      const [row] = await db
        .update(users)
        .set({ webauthnUserId: sql`coalesce(${users.webauthnUserId}, ${candidate})` })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ webauthnUserId: users.webauthnUserId });
      return row?.webauthnUserId ?? undefined;
    },

    async countPasskeys(userId: string): Promise<number> {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, userId));
      return row?.count ?? 0;
    },

    /** The account's passkeys newest first, each with the label of the device that added it, for the Security list and the options' exclusions. */
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      return db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(eq(passkeys.userId, userId))
        .orderBy(desc(passkeys.createdAt), desc(passkeys.id));
    },

    /** One passkey of the account, with its device's label. Undefined when it is another account's or gone, which the flows do not tell apart. */
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const [row] = await db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * The passkey a sign-in's credential id names, whichever account it belongs to (1c design, section 7.4): the assertion
     * says nothing about the account, so the flow finds the owner from here. Undefined for an unknown credential; the flow
     * then reads the owner and refuses a deleted one, so a gone account never signs in.
     */
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
      return row;
    },

    /**
     * A passkey the session's account holds, by credential id (1c design, section 7.2): the re-authentication looks it up
     * with the session's user, so another account's passkey and an unknown one are alike undefined and never re-authenticate.
     */
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * Writes a verified passkey's use in one conditional update (1c design, section 2), in the pattern of claimTotpStep: the
     * new counter, the use time and the current backup state, only for a passkey that is not suspect and whose counter moved
     * forward (two zeros, as synced passkeys always send, pass repeatedly). False when it matched no row, which the flow
     * reads, after a verified signature, as a counter regression or a race lost to one.
     */
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, now: Date): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ counter: newCounter, lastUsedAt: now, backedUp })
        .where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt), sql`((${newCounter} = 0 and ${passkeys.counter} = 0) or ${newCounter} > ${passkeys.counter})`))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /** Marks a passkey suspect once (1c design, section 2), so a later sign-in with it is refused; a second call changes nothing. */
    async suspectPasskey(id: string, now: Date): Promise<void> {
      await db.update(passkeys).set({ suspectAt: now }).where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt)));
    },

    /** The daily bound's reading for the options step; the registration's transaction reads it again. */
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(db, userId, withinMs, limit);
    },

    /**
     * A registration's transaction (1c design, section 7.3): the user row locked `for update`, so two registrations of one
     * account run one after the other and the later one sees what the earlier committed; both bounds checked again there;
     * then the passkey and its passkey_added event, or neither. A credential id already held raises the driver's unique
     * violation, which the flow reports as passkey_invalid.
     */
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      return db.transaction(async (tx): Promise<AddPasskeyOutcome> => {
        const [locked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
          .for("update");
        if (!locked) return { ok: false, reason: "gone" };
        const [held] = await tx.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, input.userId));
        if ((held?.count ?? 0) >= limits.passkeys) return { ok: false, reason: "cap" };
        const additions = await recentPasskeyAdditions(tx, input.userId, limits.windowMs, limits.additions);
        if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
        const [passkey] = await tx.insert(passkeys).values(input).returning();
        await tx.insert(authEvents).values({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey!.id } });
        return { ok: true, passkey: passkey! };
      });
    },

    /** Renames one passkey of the account. False when it is another account's or gone. */
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /**
     * Removes one passkey of the account and answers its name, for the notice; undefined when it is another account's or
     * gone. The sessions it started keep running without it: the foreign key sets their passkey_id to null.
     */
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const [row] = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ name: passkeys.name });
      return row;
    },

    // ------------------------------------------------------------ staff keys and enrolments (3a design, section 7)

    /**
     * The enrolment whose token hashes to `tokenHash`, used or not, expired or not, with what the enrolment flow checks of
     * its account: whether it is live, staff and has a handle, and its WebAuthn user handle. Undefined for an unknown
     * token. The flow decides; auth.add_staff_key decides again under the account's lock.
     */
    async findStaffEnrollment(tokenHash: string): Promise<StaffEnrollmentRow | undefined> {
      const [row] = await db
        .select({
          id: staffEnrollments.id,
          userId: staffEnrollments.userId,
          origin: staffEnrollments.origin,
          rpId: staffEnrollments.rpId,
          expiresAt: staffEnrollments.expiresAt,
          usedAt: staffEnrollments.usedAt,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          onboardedAt: users.onboardedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffEnrollments)
        .innerJoin(users, eq(users.id, staffEnrollments.userId))
        .where(eq(staffEnrollments.tokenHash, tokenHash))
        .limit(1);
      return row;
    },

    /**
     * The account's live staff keys as an options list excludes them: an authenticator keeps one discoverable credential
     * per relying party and user handle, so a revoked key is left out and the same security key can be enrolled again.
     */
    async listLiveStaffKeys(userId: string): Promise<{ credentialId: string; transports: string[] }[]> {
      return db
        .select({ credentialId: staffKeys.credentialId, transports: staffKeys.transports })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(staffKeys.createdAt, staffKeys.id);
    },

    /** One staff key as the console shows it: never its public key, credential id or AAGUID. */
    async findStaffKey(id: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null } | undefined> {
      const [row] = await db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(eq(staffKeys.id, id))
        .limit(1);
      return row;
    },

    /**
     * The enrolment's write, in one transaction on the auth role (3a design, section 7): the account's row locked first,
     * FOR NO KEY UPDATE, so a role change or take-down that holds it either committed before (and deleted the link, which
     * the function then does not find) or waits until this commits; the staff_key_added event; and last
     * auth.add_staff_key, which re-checks under that lock that the link is unused and unexpired and the account live,
     * staff, with a handle and fewer than five live keys, then spends the link, stores the key with the origin and relying
     * party ID the link recorded and writes its audit row, which holds the chain's head until the commit. A refusal by the
     * function rolls the event back with it. A credential id already held raises the driver's unique violation, which the
     * flow reports.
     */
    async addStaffKey(input: NewStaffKey): Promise<AddStaffKeyOutcome> {
      try {
        return await db.transaction(async (tx) => {
          await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("no key update");
          await tx.insert(authEvents).values({ userId: input.userId, type: "staff_key_added", metadata: { enrollmentId: input.enrollmentId } });
          // Each transport as its own parameter: an empty list is an empty array.
          const transports = sql`array[${sql.join(input.transports.map((t) => sql`${t}`), sql`, `)}]::text[]`;
          const [row] = await tx.execute<{ id: string }>(
            sql`select auth.add_staff_key(${input.token}::text, ${input.credentialId}::text, ${input.publicKey}::text, ${input.counter}::bigint,
              ${transports}, ${input.name}::text, ${input.aaguid}::uuid, ${input.requestId}::text) as id`,
          );
          return { ok: true as const, keyId: row!.id };
        });
      } catch (err) {
        // The function raises its refusal's staff code as the message.
        const refusal = raisedMessage(err);
        if (refusal === "staff_enrollment_invalid") return { ok: false, reason: "enrollment_invalid" };
        if (refusal === "staff_key_limit") return { ok: false, reason: "limit" };
        throw err;
      }
    },

    // ------------------------------------------------------------ staff sessions

    /** A staff key by its credential id, revoked or not, with its account's address, role, deletion and user handle; the sign-in decides. */
    async findStaffKeyForSignIn(credentialId: string): Promise<StaffKeyForSignIn | undefined> {
      const [row] = await db
        .select({
          id: staffKeys.id,
          userId: staffKeys.userId,
          credentialId: staffKeys.credentialId,
          publicKey: staffKeys.publicKey,
          transports: staffKeys.transports,
          name: staffKeys.name,
          revokedAt: staffKeys.revokedAt,
          origin: staffKeys.origin,
          rpId: staffKeys.rpId,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffKeys)
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(eq(staffKeys.credentialId, credentialId))
        .limit(1);
      return row;
    },

    /**
     * A staff sign-in's write, in one transaction (3a design, section 7): first 1c's counter rule as one conditional update
     * of the key, which records its use only while it is live and its counter moved forward (two zeros pass, as some
     * authenticators always report 0); then the session, its staff_sign_in event and last its audit row, which holds the
     * chain's head until the commit. Null when the update matched no row: a counter that went backwards, or a key revoked
     * since the flow read it, which the caller tells apart. The update holds the key's row until the commit, so a
     * revocation waiting for it then also finds the session this opened.
     */
    async openStaffSession(input: NewStaffSession): Promise<{ handle: string } | null> {
      return db.transaction(async (tx) => {
        if (!(await recordStaffKeyUse(tx, input))) return null;
        const [session] = await tx
          .insert(staffSessions)
          .values({
            id: input.id,
            userId: input.userId,
            keyId: input.keyId,
            createdAt: input.now,
            lastUsedAt: input.now,
            idleExpiresAt: input.idleExpiresAt,
            absoluteExpiresAt: input.absoluteExpiresAt,
            browser: input.browser,
          })
          .returning({ handle: staffSessions.handle });
        const handle = session!.handle;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_sign_in", ipHash: input.ipHash, metadata: { keyId: input.keyId, handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_sign_in",
          targetType: "staff_session",
          targetId: handle,
          staffSession: handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return { handle };
      });
    },

    /**
     * A staff session by its token's hash, read from the database on every request, never cached (3a design, section 7):
     * one indexed read joined to its key and its account. It counts only while it is unrevoked, has started (a created_at
     * later than now is a row written behind the flows' back) and is before both its ends, its key unrevoked and its account
     * live and still staff, so a revocation, a demotion, a deletion or a suspect key ends it at its next request with no
     * tombstone. With `slideTo` (a request its person's action started) the same statement moves last_used_at to now and the
     * idle end to `slideTo`, never past the absolute end; without, nothing moves.
     */
    async resolveStaffSession(id: string, now: Date, slideTo: Date | null): Promise<StaffSessionRow | undefined> {
      const live = and(
        eq(staffSessions.id, id),
        isNull(staffSessions.revokedAt),
        lte(staffSessions.createdAt, now),
        gt(staffSessions.idleExpiresAt, now),
        gt(staffSessions.absoluteExpiresAt, now),
        isNull(staffKeys.revokedAt),
        isNull(users.deletedAt),
        ne(users.role, "user"),
      );
      const columns = {
        id: staffSessions.id,
        handle: staffSessions.handle,
        userId: staffSessions.userId,
        keyId: staffSessions.keyId,
        role: users.role,
        createdAt: staffSessions.createdAt,
        lastUsedAt: staffSessions.lastUsedAt,
        idleExpiresAt: staffSessions.idleExpiresAt,
        absoluteExpiresAt: staffSessions.absoluteExpiresAt,
        browser: staffSessions.browser,
      };
      if (slideTo === null) {
        const [row] = await db
          .select(columns)
          .from(staffSessions)
          .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
          .innerJoin(users, eq(users.id, staffSessions.userId))
          .where(live)
          .limit(1);
        return row;
      }
      const [row] = await db
        .update(staffSessions)
        // least() on the row's own absolute end, so the idle end never passes it, as the table's check also requires.
        .set({ lastUsedAt: now, idleExpiresAt: sql`least(${slideTo.toISOString()}::timestamptz, ${staffSessions.absoluteExpiresAt})` })
        .from(staffKeys)
        // A join in UPDATE ... FROM cannot name the updated table, so the account is reached through the key, whose owner
        // the sessions' foreign key on (key_id, user_id) makes the session's account.
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(and(eq(staffKeys.id, staffSessions.keyId), live))
        .returning(columns);
      return row;
    },

    /** The account's live staff sessions, the same tests as resolveStaffSession's, most recently used first. */
    async listStaffSessions(userId: string, now: Date): Promise<{ handle: string; browser: string; createdAt: Date; lastUsedAt: Date }[]> {
      return db
        .select({ handle: staffSessions.handle, browser: staffSessions.browser, createdAt: staffSessions.createdAt, lastUsedAt: staffSessions.lastUsedAt })
        .from(staffSessions)
        .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
        .where(
          and(
            eq(staffSessions.userId, userId),
            isNull(staffSessions.revokedAt),
            lte(staffSessions.createdAt, now),
            gt(staffSessions.idleExpiresAt, now),
            gt(staffSessions.absoluteExpiresAt, now),
            isNull(staffKeys.revokedAt),
          ),
        )
        .orderBy(desc(staffSessions.lastUsedAt), desc(staffSessions.createdAt));
    },

    /** The account's live staff keys as the console lists them, oldest first: never a public key, a credential id or an AAGUID. */
    async listStaffKeyViews(userId: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[]> {
      return db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
    },

    /**
     * A sign-out (3a design, section 7) in one transaction: the session revoked, if it still is live, then its
     * staff_signed_out event and last its audit row. False when another request ended it first, which writes nothing.
     */
    async endStaffSession(input: { id: string; userId: string; keyId: string; now: Date; ipHash: string | null; requestId: string }): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [ended] = await tx
          .update(staffSessions)
          .set({ revokedAt: input.now })
          .where(and(eq(staffSessions.id, input.id), eq(staffSessions.userId, input.userId), isNull(staffSessions.revokedAt)))
          .returning({ handle: staffSessions.handle });
        if (!ended) return false;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_signed_out", ipHash: input.ipHash, metadata: { handle: ended.handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_signed_out",
          targetType: "staff_session",
          targetId: ended.handle,
          staffSession: ended.handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return true;
      });
    },

    /** The staff key a step-up confirms with, revoked or not, by its id; the step-up decides. */
    async findStaffKeyCredential(id: string): Promise<StaffKeyCredential | undefined> {
      const [row] = await db
        .select({
          id: staffKeys.id,
          userId: staffKeys.userId,
          credentialId: staffKeys.credentialId,
          publicKey: staffKeys.publicKey,
          transports: staffKeys.transports,
          name: staffKeys.name,
          revokedAt: staffKeys.revokedAt,
          origin: staffKeys.origin,
          rpId: staffKeys.rpId,
        })
        .from(staffKeys)
        .where(eq(staffKeys.id, id))
        .limit(1);
      return row;
    },

    /**
     * The counter rule at a step-up (3a design, section 7), as at sign-in: the key's use is recorded only while it is live
     * and its counter moved forward. False when the update matched no row: a counter that went backwards, or a key
     * revoked since the step-up read it, which the caller hands to the counter rule's revocation.
     */
    async recordStaffKeyUse(input: { keyId: string; userId: string; newCounter: number; now: Date }): Promise<boolean> {
      return recordStaffKeyUse(db, input);
    },

    /**
     * Revokes one of the account's own live staff sessions, confirmed by a step-up, in one transaction on the auth role
     * (3a design, section 7). The account's row is locked first, FOR NO KEY UPDATE, as every revocation takes it, so a
     * revocation of the confirming key, a demotion or a take-down either committed before (and this refuses: the session
     * that confirmed has ended) or waits until this commits. Then the session, only where revoked_at is still null and
     * before both its ends, and only if it is the account's own; its staff_session_revoked event; and last its audit row,
     * through auth.append_audit, with the action's hash, its params in the metadata, the key and the assertion, which
     * audit-verify checks. "ended" when the confirming key or account no longer opens anything, "not_found" when the
     * handle names no live session of the account; neither writes anything.
     *
     * audit-verify refuses for good a row stamped at or after its challenge's expiry, and the trigger stamps the row only
     * once it holds the audit head, so a head held open would otherwise let a genuine confirmation become such a row. Every
     * lock wait here is therefore bounded by a third of the challenge's life left by the database's clock (at most 15
     * seconds), and the statement that writes the row also checks the database's clock against the expiry: "late" when a
     * wait gave up or the expiry came first, which rolls everything back and writes nothing.
     */
    async revokeConfirmedStaffSession(input: ConfirmedStaffSessionRevocation): Promise<"revoked" | "ended" | "not_found" | "late"> {
      try {
        return await db.transaction(async (tx) => {
          // Three waits: the account's row, the session's row and the audit head.
          if (!(await boundLockWaits(tx, input.expiresAt, 3))) return "late";
          return revokeConfirmedIn(tx, input);
        });
      } catch (err) {
        if (err instanceof LateConfirmation || isLockNotAvailable(err)) return "late";
        throw err;
      }
    },

    /**
     * Revokes staff keys in one transaction on the auth role (3a design, section 7): `staff.js revoke <email> <key id>` and
     * `revoke <email> all`, and the counter rule's revocation, which is the same routine with suspect_at set as well and the
     * regression's own event. The account's row is locked first, FOR NO KEY UPDATE, as every writer of staff rows takes it.
     * Then the keys (one, or every live one), each only where revoked_at is still null, since a set one is never changed;
     * then every staff session they opened (for `all`, every staff session of the account), after the keys, so a session a
     * sign-in opened while this waited for a key's row is found too; for `all`, the unused enrolment links; an event per key;
     * and last the audit rows, a key's revocation each and, when a link went, one staff_enrollments_cancelled row, so it
     * never changes the database without a row. The command line waits at most 10 seconds for a lock.
     */
    async revokeStaffKeys(input: StaffKeyRevocation): Promise<StaffKeysRevoked> {
      return db.transaction(async (tx): Promise<StaffKeysRevoked> => {
        if (input.via === "cli") await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and("id" in input.account ? eq(users.id, input.account.id) : sql`lower(${users.email}) = lower(${input.account.email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return { ok: false, reason: "no_account" };
        let alreadyRevokedAt: Date | null = null;
        if (input.key !== "all") {
          // Another account's key and an unknown one are alike: neither is this account's to revoke.
          const [key] = await tx
            .select({ revokedAt: staffKeys.revokedAt })
            .from(staffKeys)
            .where(and(eq(staffKeys.id, input.key), eq(staffKeys.userId, account.id)));
          if (!key) return { ok: false, reason: "no_key" };
          alreadyRevokedAt = key.revokedAt;
        }
        const revoked = await tx
          .update(staffKeys)
          .set(input.suspect ? { revokedAt: input.now, suspectAt: input.now } : { revokedAt: input.now })
          .where(and(eq(staffKeys.userId, account.id), input.key === "all" ? undefined : eq(staffKeys.id, input.key), isNull(staffKeys.revokedAt)))
          .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt });
        // An update answers in no set order; the events, rows and mail list the keys oldest first.
        revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
        const keyIds = revoked.map((key) => key.id);
        const sessionsOf = input.key === "all" ? eq(staffSessions.userId, account.id) : keyIds.length > 0 ? inArray(staffSessions.keyId, keyIds) : null;
        const ended =
          sessionsOf === null
            ? []
            : await tx
                .update(staffSessions)
                .set({ revokedAt: input.now })
                .where(and(sessionsOf, isNull(staffSessions.revokedAt)))
                .returning({ keyId: staffSessions.keyId });
        const enrollmentsCancelled =
          input.key === "all"
            ? (
                await tx
                  .delete(staffEnrollments)
                  .where(and(eq(staffEnrollments.userId, account.id), isNull(staffEnrollments.usedAt)))
                  .returning({ id: staffEnrollments.id })
              ).length
            : 0;
        const action = input.suspect ? "staff_key_counter_regression" : "staff_key_revoked";
        const keys = revoked.map((key) => ({ id: key.id, name: key.name, sessionsRevoked: ended.filter((session) => session.keyId === key.id).length }));
        for (const key of keys) {
          // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
          await tx.insert(authEvents).values({ userId: account.id, type: action, metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via } });
        }
        for (const key of keys) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action,
            targetType: "staff_key",
            targetId: key.id,
            metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        if (enrollmentsCancelled > 0) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action: "staff_enrollments_cancelled",
            targetType: "user",
            targetId: account.id,
            metadata: { count: enrollmentsCancelled, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        return { ok: true, userId: account.id, email: account.email, keys, staffSessionsRevoked: ended.length, enrollmentsCancelled, alreadyRevokedAt };
      });
    },

    // ------------------------------------------------------------ notifiers (3c design, section 6.1)

    /**
     * Stores what a signed-out notifier gave to be told about their notice, already encrypted, under the id the
     * moderation module chose and wrote on the notice. The role may never update any of it but the day it is forgotten.
     */
    async createNotifierContact(input: { id: string; nameEnc: string | null; emailEnc: string | null; emailHash: string | null; mailTokenEnc: string | null; forgetAfter: Date }): Promise<void> {
      await db.insert(notifierContacts).values(input);
    },

    async findNotifierContact(id: string): Promise<NotifierContactRow | undefined> {
      const [row] = await db.select().from(notifierContacts).where(eq(notifierContacts.id, id)).limit(1);
      return row;
    },

    /** What is known of these contacts without opening a ciphertext: whether a name and an address were given, and the address's hash. */
    async notifierContactFacts(ids: readonly string[]): Promise<{ id: string; named: boolean; contactGiven: boolean; emailHash: string | null }[]> {
      if (ids.length === 0) return [];
      return db
        .select({ id: notifierContacts.id, named: sql<boolean>`${notifierContacts.nameEnc} is not null`, contactGiven: sql<boolean>`${notifierContacts.emailEnc} is not null`, emailHash: notifierContacts.emailHash })
        .from(notifierContacts)
        .where(inArray(notifierContacts.id, [...ids]));
    },

    /** The contacts that gave this address, oldest first: the command line's read for an access request. */
    async notifierContactsByEmailHash(emailHash: string): Promise<NotifierContactRow[]> {
      return db.select().from(notifierContacts).where(eq(notifierContacts.emailHash, emailHash)).orderBy(asc(notifierContacts.createdAt), asc(notifierContacts.id));
    },

    /** Which of these address hashes hold a confirmation that has not run out. */
    async confirmedNotifierHashes(hashes: readonly string[], now: Date): Promise<Set<string>> {
      if (hashes.length === 0) return new Set();
      const rows = await db
        .select({ emailHash: notifierConfirmations.emailHash })
        .from(notifierConfirmations)
        .where(and(inArray(notifierConfirmations.emailHash, [...hashes]), gt(notifierConfirmations.expiresAt, now)));
      return new Set(rows.map((row) => row.emailHash));
    },

    /** Which of these address hashes asked korbat to stop its report mails. */
    async suppressedNotifierHashes(hashes: readonly string[]): Promise<Set<string>> {
      if (hashes.length === 0) return new Set();
      const rows = await db.select({ emailHash: notifierSuppressions.emailHash }).from(notifierSuppressions).where(inArray(notifierSuppressions.emailHash, [...hashes]));
      return new Set(rows.map((row) => row.emailHash));
    },

    /**
     * Records an address as confirmed until `expiresAt` and lifts any stop of it, in one transaction: whoever holds a
     * mail korbat sent there said "I sent this", which also means they want its mails.
     */
    async confirmNotifierAddress(emailHash: string, now: Date, expiresAt: Date): Promise<void> {
      await db.transaction(async (tx) => {
        await tx
          .insert(notifierConfirmations)
          .values({ emailHash, confirmedAt: now, expiresAt })
          .onConflictDoUpdate({ target: notifierConfirmations.emailHash, set: { confirmedAt: now, expiresAt } });
        await tx.delete(notifierSuppressions).where(eq(notifierSuppressions.emailHash, emailHash));
      });
    },

    /** Records that an address asked korbat to stop its report mails; a second stop changes nothing. The role cannot update the row. */
    async suppressNotifierAddress(emailHash: string): Promise<void> {
      await db.insert(notifierSuppressions).values({ emailHash }).onConflictDoNothing();
    },

    /** Lifts a stop; true when there was one. */
    async liftNotifierSuppression(emailHash: string): Promise<boolean> {
      const rows = await db.delete(notifierSuppressions).where(eq(notifierSuppressions.emailHash, emailHash)).returning({ emailHash: notifierSuppressions.emailHash });
      return rows.length > 0;
    },

    /** Moves the day these contacts are forgotten: the one column of a contact the role may update. */
    async setNotifierForgetAfter(ids: readonly string[], at: Date): Promise<void> {
      if (ids.length === 0) return;
      await db.update(notifierContacts).set({ forgetAfter: at }).where(inArray(notifierContacts.id, [...ids]));
    },

    /** How many contacts were to be forgotten, and confirmations had run out, before `before`: what a janitor that ran would have removed. */
    async countNotifierRowsDue(before: Date): Promise<number> {
      const [row] = (await db.execute(
        sql`select (select count(*) from auth.notifier_contacts where forget_after < ${before.toISOString()}::timestamptz)
                 + (select count(*) from auth.notifier_confirmations where expires_at < ${before.toISOString()}::timestamptz) as due`,
      )) as unknown as { due: string | number }[];
      return Number(row?.due ?? 0);
    },

    /** The address of every live staff account: not deleted, and a moderator or an admin. */
    async liveStaffAddresses(): Promise<string[]> {
      const rows = await db
        .select({ email: users.email })
        .from(users)
        .where(and(isNull(users.deletedAt), ne(users.role, "user")))
        .orderBy(asc(users.createdAt), asc(users.id));
      return rows.map((row) => row.email);
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    // ------------------------------------------------------------ retention

    /** Codes consumed or expired before `before` are of no use to anyone; they still hold an email and an ip hash. */
    async purgeEmailCodes(before: Date): Promise<number> {
      const rows = await db
        .delete(emailCodes)
        .where(or(and(sql`${emailCodes.consumedAt} is not null`, lt(emailCodes.consumedAt, before)), lt(emailCodes.expiresAt, before)))
        .returning({ id: emailCodes.id });
      return rows.length;
    },

    /** Sessions revoked or expired before `before`. Live ones are never touched. */
    async purgeSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(or(and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, before)), lt(sessions.expiresAt, before), lt(sessions.absoluteExpiresAt, before)))
        .returning({ id: sessions.id });
      return rows.length;
    },

    /**
     * Staff sessions revoked or expired before `before` (3a design, section 7). A live one is never touched: both its ends
     * lie ahead. The audit rows that name a session keep its handle, which needs no row.
     */
    async purgeStaffSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(staffSessions)
        .where(
          or(
            and(isNotNull(staffSessions.revokedAt), lt(staffSessions.revokedAt, before)),
            lt(staffSessions.idleExpiresAt, before),
            lt(staffSessions.absoluteExpiresAt, before),
          ),
        )
        .returning({ id: staffSessions.id });
      return rows.length;
    },

    /** Enrolment links used or expired before `before`, which can enrol nothing more; one that still can is cancelled only by name. */
    async purgeStaffEnrollments(before: Date): Promise<number> {
      const rows = await db
        .delete(staffEnrollments)
        .where(or(and(isNotNull(staffEnrollments.usedAt), lt(staffEnrollments.usedAt, before)), lt(staffEnrollments.expiresAt, before)))
        .returning({ id: staffEnrollments.id });
      return rows.length;
    },

    /** The design's IP-hash purge: a device not seen since `before` keeps no address hash. */
    async purgeDeviceIpHashes(before: Date): Promise<number> {
      const rows = await db
        .update(devices)
        .set({ ipHash: null })
        .where(and(sql`${devices.ipHash} is not null`, lt(devices.lastSeenAt, before)))
        .returning({ id: devices.id });
      return rows.length;
    },

    /** Notifier contacts whose day to be forgotten lies before `before` (3c design, section 6.1): the name, the address and the mail token go with the row. */
    async purgeNotifierContacts(before: Date): Promise<number> {
      const rows = await db.delete(notifierContacts).where(lt(notifierContacts.forgetAfter, before)).returning({ id: notifierContacts.id });
      return rows.length;
    },

    /** Confirmations of a notifier's address that ran out before `before`: an address is confirmed for 30 days. */
    async purgeNotifierConfirmations(before: Date): Promise<number> {
      const rows = await db.delete(notifierConfirmations).where(lt(notifierConfirmations.expiresAt, before)).returning({ emailHash: notifierConfirmations.emailHash });
      return rows.length;
    },

    /**
     * Events older than `days` days, through auth.purge_events (migration 0007): the table stays
     * append-only for this role, which holds no DELETE on it; the function is owned by the migrator.
     */
    async purgeEvents(days: number): Promise<number> {
      const [row] = (await db.execute(sql`select auth.purge_events(make_interval(days => ${days}::int)) as removed`)) as unknown as { removed: number }[];
      return Number(row?.removed ?? 0);
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },

    /** The user's own events since `since`, newest first, for the data export: their kind and time, never the metadata. */
    async eventsSince(userId: string, since: Date): Promise<{ type: AuthEventType; createdAt: Date }[]> {
      return db
        .select({ type: authEvents.type, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), gte(authEvents.createdAt, since)))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a read runs through: the pool, or a transaction that needs the read to see its own lock. */
type Querier = Pick<Db, "select">;

/** The auth side's actions in the audit log: the only ones auth.append_audit writes (migration 0012). */
type AuthAuditAction =
  | "staff_key_revoked"
  | "staff_key_counter_regression"
  | "staff_sign_in"
  | "staff_signed_out"
  | "staff_session_revoked"
  | "staff_enrollments_cancelled"
  | "role_granted";

/** One auth-side row of the audit log. The trigger sets its id, time, place and hashes. */
interface AuthAuditRow {
  actorId: string;
  action: AuthAuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  staffSession?: string | null;
  keyId?: string | null;
  actionHash?: string | null;
  stepUp?: { authenticatorData: string; clientDataJSON: string; signature: string } | null;
  requestId?: string | null;
}

/**
 * Writes an auth-side row of the audit log in the caller's transaction, through auth.append_audit: the auth role holds
 * nothing in the public schema, and the function, which the migrator owns, writes only the auth side's actions (3a design,
 * section 6). It must be the transaction's last statement: the row holds the chain's head until the commit, so nothing that
 * can wait may run after it. Answers the row's place in the chain.
 */
async function appendAudit(tx: Tx, row: AuthAuditRow): Promise<number> {
  // The jsonb arguments go as text and are cast, so postgres.js sends them exactly as serialised here.
  const stepUp = row.stepUp ? JSON.stringify(row.stepUp) : null;
  const [written] = await tx.execute<{ place: string }>(
    sql`select auth.append_audit(${row.actorId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
      ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession ?? null}::uuid, ${row.keyId ?? null}::uuid,
      ${row.actionHash ?? null}::text, ${stepUp}::text::jsonb, ${row.requestId ?? null}::text)::text as place`,
  );
  return Number(written!.place);
}

/**
 * A confirmed action whose row could not join the chain before its step-up challenge expired; nothing was written.
 * Exported for the step-up suite, which runs revokeConfirmedIn past its challenge's expiry and expects this.
 */
export class LateConfirmation extends Error {
  constructor() {
    super("the confirmation's row could not join the chain before its challenge expired");
    this.name = "LateConfirmation";
  }
}

/**
 * appendAudit for a row a step-up confirmed, in one statement that also reads the database's clock once the row is in the
 * chain: the trigger stamped the row no later than that, so a clock still before the challenge's expiry means the row is
 * too, as audit-verify requires. The audit row stays the last statement of its transaction. False when the expiry came
 * first: the caller then rolls the transaction back.
 */
async function appendAuditBefore(tx: Tx, expiresAt: Date, row: AuthAuditRow): Promise<boolean> {
  const stepUp = row.stepUp ? JSON.stringify(row.stepUp) : null;
  // A volatile function in a CTE is evaluated once, before the outer query reads its row, so the clock is read after it.
  const [written] = await tx.execute<{ inTime: boolean }>(
    sql`with written as (
      select auth.append_audit(${row.actorId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
        ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession ?? null}::uuid, ${row.keyId ?? null}::uuid,
        ${row.actionHash ?? null}::text, ${stepUp}::text::jsonb, ${row.requestId ?? null}::text) as place
    )
    select extract(epoch from clock_timestamp()) * 1000 < ${expiresAt.getTime()}::numeric as "inTime" from written`,
  );
  return written!.inTime === true;
}

/**
 * revokeConfirmedStaffSession's statements, in its transaction: the account's row first, then the key, the session, the
 * event, and last the audit row, written only while the challenge has not expired by the database's clock.
 *
 * Exported for the step-up suite alone, which runs it without boundLockWaits on a challenge already expired, as if the
 * waits had together outlasted it: that is the only way to reach the row's own clock check on cue, since the bound ends
 * any one wait the suite could hold before then. Everything else calls revokeConfirmedStaffSession.
 */
export async function revokeConfirmedIn(tx: Tx, input: ConfirmedStaffSessionRevocation): Promise<"revoked" | "ended" | "not_found"> {
  const [account] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, input.userId), isNull(users.deletedAt), ne(users.role, "user")))
    .limit(1)
    .for("no key update");
  if (!account) return "ended";
  const [key] = await tx
    .select({ id: staffKeys.id })
    .from(staffKeys)
    .where(and(eq(staffKeys.id, input.keyId), eq(staffKeys.userId, input.userId), isNull(staffKeys.revokedAt)));
  if (!key) return "ended";
  const [revoked] = await tx
    .update(staffSessions)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(staffSessions.handle, input.handle),
        eq(staffSessions.userId, input.userId),
        isNull(staffSessions.revokedAt),
        gt(staffSessions.idleExpiresAt, input.now),
        gt(staffSessions.absoluteExpiresAt, input.now),
      ),
    )
    .returning({ handle: staffSessions.handle });
  if (!revoked) return "not_found";
  // The account's own log names the session that ended and the one that ended it.
  await tx.insert(authEvents).values({ userId: input.userId, type: "staff_session_revoked", ipHash: input.ipHash, metadata: { handle: revoked.handle, by: input.staffSession } });
  const inTime = await appendAuditBefore(tx, input.expiresAt, {
    actorId: input.userId,
    action: "staff_session_revoked",
    targetType: "staff_session",
    targetId: revoked.handle,
    staffSession: input.staffSession,
    keyId: input.keyId,
    actionHash: input.actionHash,
    stepUp: input.stepUp,
    metadata: { params: input.params },
    requestId: input.requestId,
  });
  // Thrown, so the transaction rolls back: the session stays live and no row is written.
  if (!inTime) throw new LateConfirmation();
  return "revoked";
}

/**
 * 1c's counter rule as one conditional update of a staff key (3a design, section 7), at a sign-in in the session's
 * transaction and at a step-up on its own: the key's use and counter are recorded only while it is the account's, live, and
 * its counter moved forward (two zeros pass, as some authenticators always report 0). False when no row matched. The
 * update holds the key's row until the commit, so a revocation waiting for it then also finds what this transaction did.
 */
async function recordStaffKeyUse(q: Pick<Db, "update">, input: { keyId: string; userId: string; newCounter: number; now: Date }): Promise<boolean> {
  const claimed = await q
    .update(staffKeys)
    .set({ counter: input.newCounter, lastUsedAt: input.now })
    .where(
      and(
        eq(staffKeys.id, input.keyId),
        eq(staffKeys.userId, input.userId),
        isNull(staffKeys.revokedAt),
        sql`((${input.newCounter} = 0 and ${staffKeys.counter} = 0) or ${input.newCounter} > ${staffKeys.counter})`,
      ),
    )
    .returning({ id: staffKeys.id });
  return claimed.length > 0;
}

/**
 * The daily bound's reading (1c design, section 2): how many passkey_added events the account has within the window, at
 * most `limit` of them, and the seconds until the oldest of those is out of the window, when the day has a slot again.
 * Counted from the events, so a removal frees nothing, and by the database clock, which wrote them.
 */
async function recentPasskeyAdditions(q: Querier, userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
  const window = sql`make_interval(secs => ${withinMs / 1000}::float8)`;
  const recent = q
    .select({ createdAt: authEvents.createdAt })
    .from(authEvents)
    .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "passkey_added"), gt(authEvents.createdAt, sql`now() - ${window}`)))
    .orderBy(desc(authEvents.createdAt))
    .limit(limit)
    .as("recent");
  const [row] = await q
    .select({
      count: sql<number>`count(*)::int`,
      retryAfterSeconds: sql<number>`coalesce(ceil(extract(epoch from (min(${recent.createdAt}) + ${window} - now())))::int, 0)`,
    })
    .from(recent);
  return { count: row?.count ?? 0, retryAfterSeconds: row?.retryAfterSeconds ?? 0 };
}

/** The message of an exception a PL/pgSQL function raised (SQLSTATE P0001), however deeply the driver wrapped it; null for anything else. */
function raisedMessage(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "P0001") {
      const message = (current as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** What revoking an account's staff access did, for the auth events already written, the audit rows and the mail. */
interface StaffRevocation {
  /** Each key revoked now, oldest first, with how many of its staff sessions were revoked now. */
  keys: { id: string; name: string; sessionsRevoked: number }[];
  staffSessionsRevoked: number;
  /**
   * The open enrolment links (never used) deleted now: the deletions that end something, and the count the record carries.
   * A spent link deleted with them at a take-down is not counted, since it could enrol nothing more and nothing was cancelled.
   */
  enrollmentsCancelled: number;
}

/**
 * Ends an account's staff access inside the caller's transaction, which has locked the account's row first (3a design,
 * section 7): when `keys` is set every live staff key is revoked, then every staff session not yet revoked, the
 * enrolment links deleted (the unused ones, or every one at a take-down), and a staff_key_revoked event for each key. The
 * keys go before the sessions, as in revokeStaffKeys: a sign-in holds its key's row from the moment it records the key's
 * use until it commits the session it opens, and the session's insert does not wait for the account's lock, so a session
 * opened while this waited for a key's row is committed by the time the sessions are revoked, and is found and counted.
 * A revocation sets revoked_at only where it is still null, since a set one is never changed. Writes no audit row: the
 * caller writes those last, after its own statements.
 */
async function revokeStaffAccess(
  tx: Tx,
  userId: string,
  now: Date,
  options: { keys: boolean; enrollments: "unused" | "all"; via: "role_change" | "take_down" },
): Promise<StaffRevocation> {
  const revoked = options.keys
    ? await tx
        .update(staffKeys)
        .set({ revokedAt: now })
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt })
    : [];
  const ended = await tx
    .update(staffSessions)
    .set({ revokedAt: now })
    .where(and(eq(staffSessions.userId, userId), isNull(staffSessions.revokedAt)))
    .returning({ keyId: staffSessions.keyId });
  const deleted = await tx
    .delete(staffEnrollments)
    .where(and(eq(staffEnrollments.userId, userId), options.enrollments === "unused" ? isNull(staffEnrollments.usedAt) : undefined))
    .returning({ usedAt: staffEnrollments.usedAt });
  const keys: StaffRevocation["keys"] = [];
  if (options.keys) {
    // An update answers in no set order; the events, rows and mail list the keys oldest first.
    revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    for (const key of revoked) {
      const sessionsRevoked = ended.filter((session) => session.keyId === key.id).length;
      keys.push({ id: key.id, name: key.name, sessionsRevoked });
      // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
      await tx.insert(authEvents).values({ userId, type: "staff_key_revoked", metadata: { keyId: key.id, sessionsRevoked, via: options.via } });
    }
  }
  return { keys, staffSessionsRevoked: ended.length, enrollmentsCancelled: deleted.filter((link) => link.usedAt === null).length };
}

/** The audit row of each staff key a revocation revoked, in the order of its events; among the caller's last statements. */
async function appendKeyRevocations(tx: Tx, actorId: string, revocation: StaffRevocation, via: "role_change" | "take_down"): Promise<void> {
  for (const key of revocation.keys) {
    await appendAudit(tx, {
      actorId,
      action: "staff_key_revoked",
      targetType: "staff_key",
      targetId: key.id,
      metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via },
    });
  }
}

/**
 * A take-down's audit rows, its transaction's last statements (3a design, section 7): each staff key's revocation and,
 * when an open enrolment link went, one staff_enrollments_cancelled row with their count, so the take-down never ends
 * any staff access without a row on the record. The spent links it deletes too are no cancellation, and like the
 * janitor's deletions of them they get no row. Nothing when the account had no staff access left to take.
 */
async function appendTakeDownAudit(tx: Tx, actorId: string, userId: string, revocation: StaffRevocation): Promise<void> {
  await appendKeyRevocations(tx, actorId, revocation, "take_down");
  if (revocation.enrollmentsCancelled > 0) {
    await appendAudit(tx, {
      actorId,
      action: "staff_enrollments_cancelled",
      targetType: "user",
      targetId: userId,
      metadata: { count: revocation.enrollmentsCancelled, via: "take_down" },
    });
  }
}

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, every code out for the user goes, whatever its purpose, so none can complete a flow for an account
 * that is gone, and every passkey goes with the WebAuthn user handle (1c design, section 7.7), so a deleted
 * account keeps no credential of any kind and no assertion can name it again. Its staff access ends too (3a design,
 * section 7): its live staff keys and staff sessions are revoked, with a staff_key_revoked event per key, and its
 * enrolment links deleted. The keys themselves are never deleted, since audit-verify checks old confirmations against
 * them, so auth.forget_staff_keys blanks their names, AAGUIDs and transports and keeps what audit-verify needs. It writes
 * no audit row: the caller writes those last, from what this answers. Run again by finishTakeDown, each statement finds
 * nothing more to do.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<{ sessionIds: string[]; staff: StaffRevocation }> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  await tx.delete(passkeys).where(eq(passkeys.userId, userId));
  // The handle only ever named the account to its passkeys and staff keys; cleared here rather than by finishPurge, so the
  // take-down leaves nothing of the ceremony behind.
  await tx.update(users).set({ webauthnUserId: null }).where(eq(users.id, userId));
  const staff = await revokeStaffAccess(tx, userId, now, { keys: true, enrollments: "all", via: "take_down" });
  // The account is marked deleted by now, which the function checks: for a live account it would change nothing.
  await tx.execute(sql`select auth.forget_staff_keys(${userId}::uuid)`);
  return { sessionIds: revoked.map((row) => row.id), staff };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

### Replace `apps/api/src/config.ts` (whole file)

```ts
import { isIP } from "node:net";
import { z } from "zod";
import { parseFormats } from "@korbat/media-protocol";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A base64 secret that decodes to at least 32 bytes. */
const base64Key = z
  .string()
  .regex(BASE64, "must be base64")
  .refine((s) => Buffer.from(s, "base64").length >= 32, "must decode to at least 32 bytes");

/** `v<N>:<base64>` decoding to exactly 32 bytes (AES-256). The version lets keys rotate. */
const versionedKey = z
  .string()
  .regex(/^v\d+:[A-Za-z0-9+/]+={0,2}$/, "must look like v1:<base64>")
  .refine((s) => Buffer.from(s.slice(s.indexOf(":") + 1), "base64").length === 32, "must decode to exactly 32 bytes");

/** Cloudflare's documented Turnstile test secrets: always pass, always fail, token spent. */
const TURNSTILE_TEST_SECRET = /^[123]x0+AA$/;

/** A secret that may be absent. Compose passes a blank line of infra/.env as an empty string, which counts as absent too. */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/** A setting whose blank value means "use the default": compose passes a variable infra/.env leaves empty as an empty string. */
const blankAsUnset = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

/**
 * A domain name as WebAuthn takes an RP ID: dot-separated labels of letters, digits and hyphens, each at most 63
 * characters and neither starting nor ending with a hyphen; no scheme, port, path or final dot.
 */
const RP_ID = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Printable text: no control, format, private-use or unassigned characters, and no line or paragraph separators. */
const PRINTABLE = /^[^\p{C}\p{Zl}\p{Zp}]+$/u;

/** The host of an origin as an RP ID would name it: lowercase, without the port or the brackets of an IPv6 address. */
function hostOf(origin: string): string {
  return new URL(origin).hostname.replace(/^\[(.*)\]$/, "$1");
}

/** localhost and its subdomains (RFC 6761): names that only ever mean this machine. */
function isLocalhost(name: string): boolean {
  return name === "localhost" || name.endsWith(".localhost");
}

/** Whether two values name the same origin, so `http://a.test/` and `http://a.test` count as one. An unparsable value is compared as written. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
}

/**
 * The staff console's origin (3a design, section 8), written exactly as a browser sends it in the Origin header: http or
 * https, a host and a port only when it is not the default, lowercase, with no path, not even a final slash. The staff gate
 * compares the Origin header with it as a string, so any other spelling would refuse every write the console makes.
 */
const consoleOrigin = z
  .url({ protocol: /^https?$/ })
  .refine((value) => URL.canParse(value) && new URL(value).origin === value, "must be an origin as browsers send it, such as https://console.example: scheme, lowercase host and port only, with no path or final slash");

/** A PostgreSQL connection URL. The staff command line reads the database URLs it needs with the same rule (cli/staff.ts). */
export const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** The mail relay and the sender, which the command line's mailer reads with the same rules (cli/mail.ts). */
export const smtpUrl = z.url({ protocol: /^smtps?$/ });
export const mailFrom = z.string().min(3);

/**
 * CONSOLE_ORIGIN and CONSOLE_RP_ID as `staff.js enroll` reads them, by the API's own rules for each value (cli/staff.ts),
 * so a link is issued only for a console the API would run.
 */
export const consoleOriginSetting = blankAsUnset.pipe(consoleOrigin.optional());
export const consoleRpIdSetting = blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as console.example: no scheme, port or path").optional());

/** The console's hostname, which CONSOLE_RP_ID defaults to. */
export const consoleHostOf = (origin: string): string => hostOf(origin);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: databaseUrl,
  DATABASE_URL_AUTH: databaseUrl,
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  KORBAT_VERSION: z.string().default("0.0.0-dev"),
  /**
   * Which header names the client: `cloudflare` behind the tunnel (cf-connecting-ip), `caddy` behind Caddy
   * alone (the first X-Forwarded-For entry, which Caddy sets itself), `none` for the socket address only.
   * A header the mode does not trust is ignored, so a client cannot choose its own rate-limit bucket.
   */
  TRUST_PROXY: z.enum(["cloudflare", "caddy", "none"]).default("none"),
  /** Origin of the web app; state-changing cookie requests must come from here (or TRUSTED_ORIGINS). */
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  /** Keys email codes, recovery codes, device ids and email rate-limit buckets. */
  AUTH_HMAC_KEY: base64Key,
  /** Keys IP addresses before they are stored or used as rate-limit buckets. */
  IP_HASH_KEY: base64Key,
  /** Encrypts TOTP secrets at rest. */
  TOTP_ENC_KEY: versionedKey,
  /** Earlier TOTP keys, comma-separated, still accepted for decryption; a secret read with one is re-encrypted with TOTP_ENC_KEY. */
  TOTP_ENC_KEYS_PREVIOUS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(versionedKey)),
  /**
   * Encrypts what a signed-out notifier gave to be told about their notice: a name, an address and the token of the
   * mails' link (3c design, section 6.1). Back it up as TOTP_ENC_KEY is: without it korbat can neither mail a notifier
   * nor answer who sent a notice.
   */
  NOTIFIER_ENC_KEY: versionedKey,
  /**
   * Earlier notifier keys, comma-separated, still accepted for decryption. A contact is never re-encrypted, so a key
   * stays here for as long as a contact it encrypted is kept.
   */
  NOTIFIER_ENC_KEYS_PREVIOUS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(versionedKey)),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SMTP_URL: smtpUrl,
  MAIL_FROM: mailFrom,
  TERMS_VERSION: z.string().min(1).max(64),
  /** The uploads volume, which the API writes and the image worker only reads. The default suits `pnpm dev` from apps/api. */
  MEDIA_UPLOADS_DIR: z.string().min(1).default("../../.data/media/uploads"),
  /** The store volume, which the image worker writes and the API only reads. */
  MEDIA_STORE_DIR: z.string().min(1).default("../../.data/media/store"),
  /** A comma-separated subset of jpeg, png, webp, gif, avif; unset enables all. The worker reads the same variable. */
  MEDIA_FORMATS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseFormats(value);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: (err as Error).message });
        return z.NEVER;
      }
    }),
  /** Uploads are refused while either media volume has less free space than this. The volumes share a disk with Postgres. */
  MEDIA_MIN_FREE_BYTES: z.coerce.number().int().nonnegative().default(2 * 1024 ** 3),
  /**
   * The sweeper's reconcile pass deletes images that have no row. `on` refuses when there are many of them
   * (a database restored from an older snapshot looks like that); `force` deletes anyway; `off` skips the pass,
   * for the restore window.
   */
  MEDIA_RECONCILE: z.enum(["on", "off", "force"]).default("on"),
  /**
   * Who checks the phone number behind the verified badge: `off` hides the badge, `dev` accepts the code
   * 000000 and nothing else (development only), `vonage` texts a real code through Vonage Verify with the
   * two credentials below.
   */
  VERIFY_PROVIDER: z.enum(["off", "dev", "vonage"]).default("off"),
  VONAGE_API_KEY: optionalSecret,
  VONAGE_API_SECRET: optionalSecret,
  /** The sender name in the verification text. Vonage allows 1 to 18 characters and none of / { } : $. */
  VERIFY_BRAND: z.string().min(1).max(18).regex(/^[^\/{}:$]*$/, "must not contain / { } : or $").default("korbat"),
  /**
   * The relying party ID every passkey is bound to (1c design, section 11): the host of APP_ORIGIN when unset, or a
   * parent domain of it, which subdomains can then share. Changing it later strands every passkey already added.
   */
  WEBAUTHN_RP_ID: blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as korbat.example: no scheme, port or path").optional()),
  /** The site name password managers show next to a korbat passkey. */
  WEBAUTHN_RP_NAME: blankAsUnset.pipe(z.string().max(64).regex(PRINTABLE, "must be printable: no control or invisible characters").default("korbat")),
  /**
   * The staff console's own origin (3a design, section 8). Unset, the console is off: no staff route is mounted and the
   * command line issues no enrolment. A blank value, as compose passes it, counts as unset.
   */
  CONSOLE_ORIGIN: consoleOriginSetting,
  /**
   * The relying party ID staff keys are bound to: the console's hostname when unset. Production requires exactly that
   * hostname, so staff keys work on the console and nowhere else; a parent domain was declined (3a design, section 2).
   */
  CONSOLE_RP_ID: consoleRpIdSetting,
  /**
   * The hour of the UTC day (0 to 23) at which the day's decisions on reports and notices are released to those who sent
   * them, in one batch (3c design, section 7.8): the batch hides the minute a decision landed. A blank value, as compose
   * passes it, is the default.
   */
  MODERATION_DISPATCH_HOUR: blankAsUnset.pipe(z.coerce.number<string>().int().min(0).max(23).default(7)),
  /**
   * The published emergency switch of the queue (3c design, section 2): `on` sorts cases whose open items all come from
   * unproven sources after the others of their lane, never below a less severe lane. `off` is the default.
   */
  MODERATION_DEFER_UNPROVEN: blankAsUnset.pipe(z.enum(["on", "off"]).default("off")),
}).superRefine((c, ctx) => {
  const refuse = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  // In every environment: an origin the app trusts is an allowed Origin for the app's cookie writes, a credentialed CORS
  // origin of the app's API and, outside production, an accepted origin for personal passkeys (3a design, section 8).
  if (c.CONSOLE_ORIGIN !== undefined) {
    if (sameOrigin(c.CONSOLE_ORIGIN, c.APP_ORIGIN)) refuse("CONSOLE_ORIGIN", "CONSOLE_ORIGIN must not be APP_ORIGIN: the staff console needs an origin of its own");
    if (c.TRUSTED_ORIGINS.some((origin) => sameOrigin(origin, c.CONSOLE_ORIGIN!))) {
      refuse("CONSOLE_ORIGIN", "CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS: the app would accept the console's requests as its own");
    }
  }
  if (c.NODE_ENV !== "production") return;
  if (TURNSTILE_TEST_SECRET.test(c.TURNSTILE_SECRET_KEY)) refuse("TURNSTILE_SECRET_KEY", "is a Turnstile test secret; production needs the secret of your own widget");
  if (!c.APP_ORIGIN.startsWith("https://")) refuse("APP_ORIGIN", "must be an https origin in production");
  for (const origin of c.TRUSTED_ORIGINS) if (!origin.startsWith("https://")) refuse("TRUSTED_ORIGINS", `${origin} is not an https origin`);
  // The development provider would hand the badge to anyone who types 000000.
  if (c.VERIFY_PROVIDER === "dev") refuse("VERIFY_PROVIDER", "VERIFY_PROVIDER=dev is for development only");
  if (c.VERIFY_PROVIDER === "vonage") {
    if (!c.VONAGE_API_KEY) refuse("VONAGE_API_KEY", "is required when VERIFY_PROVIDER is vonage");
    if (!c.VONAGE_API_SECRET) refuse("VONAGE_API_SECRET", "is required when VERIFY_PROVIDER is vonage");
  }
  // Browsers accept an RP ID only on its own host or a subdomain of it, and never an address; localhost would
  // bind every passkey to one machine. The dot keeps a bare top-level name out (browsers refuse public suffixes
  // such as co.uk themselves).
  const host = hostOf(c.APP_ORIGIN);
  const rpId = c.WEBAUTHN_RP_ID ?? host;
  if (isIP(rpId) || isIP(host)) {
    refuse("WEBAUTHN_RP_ID", "WEBAUTHN_RP_ID cannot be an IP address, nor can APP_ORIGIN name one: WebAuthn refuses them, so production needs a domain name");
  } else if (isLocalhost(rpId) || isLocalhost(host)) {
    refuse("WEBAUTHN_RP_ID", "WEBAUTHN_RP_ID cannot be localhost in production, nor can APP_ORIGIN name it");
  } else if (rpId !== host && !(host.endsWith(`.${rpId}`) && rpId.includes("."))) {
    refuse("WEBAUTHN_RP_ID", `WEBAUTHN_RP_ID must be the host of APP_ORIGIN (${host}) or a parent domain of it that has a dot`);
  }
  if (c.CONSOLE_ORIGIN === undefined) return;
  if (!c.CONSOLE_ORIGIN.startsWith("https://")) refuse("CONSOLE_ORIGIN", "CONSOLE_ORIGIN must be an https origin in production");
  const consoleHost = hostOf(c.CONSOLE_ORIGIN);
  // Ports separate neither sites nor cookies, so the console needs a hostname of its own. On a parent domain of the app's
  // hostname, the app's pages could ask for staff keys, whose relying party ID would then cover the app.
  if (consoleHost === host) refuse("CONSOLE_ORIGIN", `CONSOLE_ORIGIN must not be on the hostname of APP_ORIGIN (${host}), whatever its port`);
  if (host.endsWith(`.${consoleHost}`)) refuse("CONSOLE_ORIGIN", `APP_ORIGIN's hostname must not be a subdomain of the console's (${consoleHost})`);
  // The relying-party rules, like the app's above, bind staff keys to the console alone.
  const consoleRpId = c.CONSOLE_RP_ID ?? consoleHost;
  if (isIP(consoleHost) || isLocalhost(consoleHost)) {
    refuse("CONSOLE_RP_ID", "CONSOLE_RP_ID cannot be an IP address or localhost in production, nor can CONSOLE_ORIGIN name one: production needs a domain name");
  } else if (consoleRpId !== consoleHost) {
    refuse("CONSOLE_RP_ID", `CONSOLE_RP_ID must be the hostname of CONSOLE_ORIGIN (${consoleHost}) in production`);
  }
  if (consoleRpId === rpId) refuse("CONSOLE_RP_ID", `CONSOLE_RP_ID must differ from the app's relying party ID (${rpId}), so staff keys never work in the app`);
}).transform((c) => ({
  ...c,
  WEBAUTHN_RP_ID: c.WEBAUTHN_RP_ID ?? hostOf(c.APP_ORIGIN),
  CONSOLE_RP_ID: c.CONSOLE_RP_ID ?? (c.CONSOLE_ORIGIN === undefined ? undefined : hostOf(c.CONSOLE_ORIGIN)),
}));

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

### Replace `apps/api/src/env.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { ActiveStaffSession, Session, StaffStepUpConfirmed } from "./auth";

export type { Session };

export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    session: Session | null;
    /** How the session was presented: the HttpOnly cookie (web) or a bearer token (native). */
    authVia: "cookie" | "bearer" | null;
    /** The staff session requireStaff read on a staff route (3a design, section 7); never set elsewhere. */
    staffSession: ActiveStaffSession | null;
    /** The action a step-up confirmed, which requireStaffStepUp leaves for the route that executes and records it; never set elsewhere. */
    staffStepUp: StaffStepUpConfirmed | null;
    /** The client address as TRUST_PROXY says to read it, and its keyed hash: the only form limits and audit rows hold. */
    clientIp: string;
    clientIpHash: string;
    /** The keyed hash of the client's network: its IPv4 address, or the first 64 bits of its IPv6 address. Limits that count per network use it. */
    clientNetHash: string;
  };
};
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createAccount } from "./account";
import { createApp } from "./app";
import { createAuth, verificationProviderFrom } from "./auth";
import { loadConfig } from "./config";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createModeration } from "./moderation";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit, socialForModeration } from "./social";
import { createStaff } from "./staff";

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
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles: createProfileStore(apiDb),
  // Null when VERIFY_PROVIDER is off: the badge routes then answer badge_unavailable and the app hides the section.
  verify: verificationProviderFrom(config),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  reconcile: config.MEDIA_RECONCILE,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
const stopJanitor = auth.startJanitor(jobLock);

// Moderation cases: the module owns its tables on the API's role and reaches the social module through an interface of
// that module's own, built over the same pool, the image rows through the media module's interface for cases, and a
// notifier's contact and every mail through the auth module's. Its limits count in the store the per-IP limit uses.
const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: media.forCases, rateLimitStore, config, logger });

const social = createSocial({
  apiDb,
  rateLimitStore,
  logger,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  media: media.forPosts,
  // Profile and handle changes are security events; the social module hands them to the auth module, which owns the table.
  events: { append: auth.appendEvent },
});
// Explore's ranking: a round at once, so Explore is filled on a new database or after downtime, then one every five minutes.
const stopExplore = social.startExplore(jobLock);

// The account module owns no table: it reaches the three modules above only through the interfaces their index files export.
const account = createAccount({
  auth: auth.forAccount,
  social: social.forAccount,
  media: media.forAccount,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  requireStrongFreshAuth: auth.requireStrongFreshAuth(),
  rateLimitStore,
  logger,
});
// Deletions the process did not finish (a crash after the auth step, a failed purge) are completed within five minutes.
const stopPurge = account.startPurge(jobLock);

// The staff console's API; createApp mounts it only while CONSOLE_ORIGIN is set. Its credential work is the auth module's,
// its case work the moderation module's.
const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
  account,
  staff,
  moderation,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopJanitor();
  stopExplore();
  stopPurge();
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### Replace `apps/api/src/mail/mailer.ts` (whole file)

```ts
export type TemplateName =
  | "sign_in_code"
  | "sign_up_code"
  | "reauth_code"
  | "new_device"
  | "account_locked"
  | "mfa_enabled"
  | "mfa_disabled"
  | "password_changed"
  | "recovery_codes_regenerated"
  | "sessions_revoked_all"
  | "email_change_code"
  | "email_changed"
  | "email_change_reverted"
  | "badge_verified"
  | "badge_removed"
  | "delete_account_code"
  | "account_deleted"
  | "passkey_added"
  | "passkey_removed"
  | "passkey_suspect"
  | "recovery_code_used"
  // The staff console's mails (3a design, section 7): to the staff account's own address, and never with a link.
  | "staff_key_added"
  | "staff_session_started"
  | "staff_key_suspect"
  | "staff_keys_revoked"
  // Moderation (3c design, section 7.15): the receipt of a report or a notice, and the staff alert for the urgent lane.
  | "notice_received"
  | "moderation_urgent";

export interface MailMessage {
  to: string;
  template: TemplateName;
  data: Record<string, string>;
}

export interface Mailer {
  /**
   * Throws MailUnavailable when the message could not be handed to the relay, and its subclass MailRefused when the
   * relay answered that the recipient's address itself is bad, which no later try changes.
   */
  send(message: MailMessage): Promise<void>;
}

export class MailUnavailable extends Error {}

/**
 * The relay refused the recipient for good: no such mailbox or destination, a malformed address, a mailbox that moved or
 * a domain that takes no mail. A subclass of MailUnavailable, so a caller that does not tell the two apart behaves as
 * before; one that does records the mail as failed instead of trying again (3c design, section 5).
 */
export class MailRefused extends MailUnavailable {}
```

### Replace `apps/api/src/mail/smtp.ts` (whole file)

```ts
import nodemailer from "nodemailer";
import type { MailMessage, Mailer } from "./mailer";
import { MailRefused, MailUnavailable } from "./mailer";
import { renderTemplate } from "./templates";

export interface SmtpOptions {
  /** Refuse to send unless a plain smtp:// relay upgrades the connection with STARTTLS. Production sets it. */
  requireTls?: boolean;
}

/**
 * nodemailer's settings for a relay URL such as smtps://user:pass@smtp-relay.example:465. The four time limits are
 * explicit because nodemailer's own are 2 minutes to connect, 30 seconds for the greeting, 10 minutes of silence on the
 * socket and 30 seconds for the name lookup: with these, a relay that does not answer, or answers and then stalls, fails
 * a send within about 50 seconds, so a sign-in code answers mail_unavailable within a minute and no job waits ten. A
 * message the relay took but acknowledged after 30 seconds is sent again by whoever retries, and may arrive twice.
 */
export function smtpTransportOptions(smtpUrl: string, options: SmtpOptions = {}) {
  const url = new URL(smtpUrl);
  const secure = url.protocol === "smtps:";
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure && options.requireTls === true,
    ...(url.username ? { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    dnsTimeout: 10_000,
  };
}

/**
 * A reply that begins with an RFC 3463 enhanced status saying that the recipient's address itself is bad: 5.1.1 (no such
 * mailbox), 5.1.2 (no such destination system), 5.1.3 (a malformed address), 5.1.6 (the mailbox has moved) or 5.1.10
 * (the domain accepts no mail, RFC 7505). The first line of a reply of several lines has a hyphen after its number.
 */
const BAD_RECIPIENT = /^5[0-9][0-9][ -]5[.]1[.](1|2|3|6|10)(?![0-9])/;

/**
 * Whether nodemailer's error says that the relay refused the recipient for good: an envelope error at RCPT TO with a 5yz
 * reply whose enhanced status names the address. Everything else can change with another try or with a fixed relay: a
 * connection or TLS error, failed credentials, a refused sender or message, any 4yz reply, and every other 5yz reply to
 * RCPT TO. Postfix checks its client and sender restrictions at RCPT TO too, so a relay that refuses korbat itself
 * (relaying denied, a sender it does not take, a quota) answers 5yz there for every recipient; those are not about the
 * recipient, and their mails wait until the relay or its settings are fixed.
 */
function recipientRefused(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { code, command, responseCode, response } = err as { code?: unknown; command?: unknown; responseCode?: unknown; response?: unknown };
  return code === "EENVELOPE" && command === "RCPT TO" && typeof responseCode === "number" && responseCode >= 500 && responseCode <= 599 && typeof response === "string" && BAD_RECIPIENT.test(response);
}

/** Sends through any SMTP relay given as a URL. */
export function smtpMailer(smtpUrl: string, from: string, options: SmtpOptions = {}): Mailer {
  const transport = nodemailer.createTransport(smtpTransportOptions(smtpUrl, options));
  return {
    async send(message: MailMessage) {
      const rendered = renderTemplate(message.template, message.data);
      try {
        await transport.sendMail({ from, to: message.to, subject: rendered.subject, text: rendered.text, html: rendered.html });
      } catch (err) {
        if (recipientRefused(err)) throw new MailRefused("mail relay refused the recipient's address", { cause: err });
        throw new MailUnavailable("mail relay rejected or unreachable", { cause: err });
      }
    },
  };
}
```

### Replace `apps/api/src/mail/templates.ts` (whole file)

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
      // The link runs the lockdown anchored at this sign-in (1c design, section 7.6): it reaches back a day, so a
      // passkey or two-factor set up just before, from the same stolen session, goes with it.
      return build("New sign-in to your korbat account", [
        `Your account was just signed in from a new device: ${need(data, "deviceLabel")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 24 hours. It signs out every session, removes your password, and turns off every passkey and two-factor authentication set up since the day before this sign-in; then you sign in with a code sent to this address: ${need(data, "notMeUrl")}`,
      ]);
    case "account_locked":
      return build("Password sign-in paused on your korbat account", [
        `After several wrong passwords, password sign-in is paused for ${need(data, "minutes")} minutes.`,
        "You can still sign in with an emailed code. If you did not try to sign in, consider turning on two-factor authentication.",
      ]);
    case "mfa_enabled":
      return build("Two-factor authentication is on for your korbat account", [
        "Two-factor authentication was just turned on for your korbat account, and a new set of recovery codes was issued.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "mfa_disabled":
      return build("Two-factor authentication is off for your korbat account", [
        "Two-factor authentication was just turned off for your korbat account.",
        "If this was you, there is nothing to do. If not, sign in, open Security, turn it back on and sign out everywhere.",
      ]);
    case "password_changed":
      return build("Your korbat password changed", [
        "The password of your korbat account was just set or changed.",
        "If this was you, there is nothing to do. If not, sign in with an emailed code, open Security, set a new password and sign out everywhere.",
      ]);
    case "recovery_codes_regenerated":
      return build("New recovery codes for your korbat account", [
        "A new set of recovery codes was just issued for your korbat account. The old codes no longer work.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "sessions_revoked_all":
      return build("Signed out everywhere on korbat", [
        `Every session of your korbat account was just signed out (${need(data, "count")} in total).`,
        "If this was you, there is nothing to do. If not, sign in and set a new password.",
      ]);
    case "email_change_code":
      return build("Confirm your new korbat email address", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not ask to move a korbat account to this address, you can ignore this email; nothing changes without the code.",
      ]);
    case "email_changed":
      // The undo link goes with the first change in a day only (flows/email-change.ts); a later change in that day
      // says where the link that works went, because signing in here is no longer possible.
      return build("Your korbat email address changed", [
        `The email address of your korbat account was just changed to ${need(data, "email")}. This address no longer belongs to the account.`,
        "Every session stays signed in. If this was you, there is nothing to do.",
        data.revertUrl
          ? `If this was not you, open this link within 24 hours. It moves the account back to this address, signs out every session, removes the password, and turns off every passkey and two-factor authentication set up since the day before the change; then you sign in with a code sent to this address: ${data.revertUrl}`
          : "If this was not you: the address had already changed less than a day ago, and the link sent then, to the address the account had before, can still move the account back there and sign out every session.",
      ]);
    case "email_change_reverted":
      return build("Your korbat account is back at this address", [
        "Your korbat account is back at this address, moved back from the link sent when its address changed, and every session was signed out.",
        "Sign in with a code sent to this address. The password was removed, and every passkey and two-factor authentication set up since the day before the change was turned off; set them up again from Security.",
      ]);
    case "badge_verified":
      return build("Your korbat account is verified", [
        "Your phone number was just confirmed, and your korbat account now shows the verified badge.",
        "korbat keeps only a keyed hash of the number, never the number itself. If this was not you, sign in, open Account, and remove the badge.",
      ]);
    case "badge_removed":
      return build("The verified badge was removed from your korbat account", [
        "The verified badge was just removed from your korbat account, and the phone number behind it was forgotten.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "delete_account_code":
      return build("Confirm deleting your korbat account", [
        `Someone asked to delete your korbat account. The confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. Deleting the account removes your posts, images and profile for good; nothing happens without the code.",
        "If this was not you, do not enter the code: sign in, open Security, and revoke your other sessions.",
      ]);
    case "account_deleted":
      return build("Your korbat account was deleted", [
        "Your korbat account was deleted as you asked. Your posts, images and profile are gone, and your handle stays reserved so nobody can take it.",
        "This cannot be undone. Thank you for having been part of korbat; you are welcome back with a new account any time.",
      ]);
    case "passkey_added":
      // The link runs the lockdown anchored at the passkey's creation (1c design, section 7.6): it reaches back a day,
      // so a password or two-factor set up just before the passkey, from the same stolen session, goes with it.
      return build("A passkey was added to your korbat account", [
        `A passkey named "${need(data, "name")}" was added to your korbat account from ${need(data, "deviceLabel")} at ${need(data, "time")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 7 days. It removes this passkey, signs out every session, removes your password, and turns off every passkey and two-factor authentication set up since the day before this one was added; then you sign in with a code sent to this address: ${need(data, "removeUrl")}`,
      ]);
    case "passkey_removed":
      return build("A passkey was removed from your korbat account", [
        `The passkey named "${need(data, "name")}" was removed from your korbat account at ${need(data, "time")}. It can no longer sign in.`,
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your passkeys, sessions and devices.",
      ]);
    case "passkey_suspect":
      // A counter that went backwards (1c design, section 2): the signature was right, so someone holds the key, and
      // either the authenticator was cloned or a backup was restored. Only the owner can tell, so the key stays off.
      return build("A passkey on your korbat account was switched off", [
        `A sign-in just used what looks like a copy of your passkey named "${need(data, "name")}", so korbat switched that passkey off. It can no longer sign in.`,
        "Sign in with a code sent to this address, open Security, remove it and add a new one. If you did not try to sign in just now, also review your sessions and devices.",
      ]);
    case "recovery_code_used":
      // A code spent at re-authentication (1c design, section 7.2): each of the ten works once, so the owner should know the count is down.
      return build("A recovery code was used on your korbat account", [
        "A recovery code was just used to confirm it's you on your korbat account. Each code works once; set up two-factor authentication again from Security to get a new set.",
        "If this was not you, sign in, open Security, sign out everywhere and set up two-factor authentication again.",
      ]);
    case "staff_key_added":
      return staffMail("A staff key was added to your korbat staff account", [
        `A staff key named "${need(data, "name")}" was registered for your korbat staff account at ${need(data, "time")}. It can open the staff console.`,
        "If this was you, there is nothing to do. If not, tell the operator at once; they revoke the key with the staff command line.",
      ]);
    case "staff_session_started":
      return staffMail("A staff session started on the korbat console", [
        `A staff session was started on the korbat console at ${need(data, "time")} with your staff key "${need(data, "name")}", from ${need(data, "browser")}.`,
        "If this was you, there is nothing to do. If not, someone holds that key: tell the operator at once; they revoke it and every session it opened with the staff command line.",
      ]);
    case "staff_key_suspect":
      // A counter that went backwards on a staff key (3a design, section 7): never passkey_suspect, whose remedy is the
      // app's Security screen; only the operator can enrol a replacement.
      return staffMail("A staff key on your korbat staff account was switched off", [
        `A use of your staff key "${need(data, "name")}" on the korbat console (a sign-in or a confirmation) looked like a copy of it, so korbat switched that key off and ended every staff session it opened. It can no longer open the console.`,
        "Ask the operator for a link to register a new key. If you did not use it just now, tell them so: someone else holds a copy of the key.",
      ]);
    case "staff_keys_revoked":
      // `names` is the list of the revoked keys' names, each in quotes, as the sender joins them.
      return staffMail("Staff keys revoked on your korbat staff account", [
        `These staff keys of your korbat staff account were revoked at ${need(data, "time")}: ${need(data, "names")}. They can no longer open the console, and every staff session they opened has ended.`,
        "If you expected this, there is nothing to do. If not, ask the operator why.",
      ]);
    case "notice_received":
      // The receipt of a report or a notice (3c design, section 7.15). `items` is the list of korbat links the report
      // named, as the sender joins them: built from parsed ids, an account's from the handle as it was named. With
      // `pageUrl` it goes to a signed-out notifier's address, and the link's fragment holds that contact's mail token,
      // which no server log sees; without it, to an account, whose reports are in the app.
      return userMail(`korbat received your report ${need(data, "ref")}`, [
        `korbat received your report ${need(data, "ref")} at ${need(data, "time")}. It names: ${need(data, "items")}.`,
        "A moderator decides each item that names something on korbat; a link that names nothing is answered automatically. You get one email with every decision, at most once a day.",
        data.pageUrl
          ? `To see where your report stands, ask for a re-examination of a decision, confirm that you sent it, or stop korbat's emails about reports to this address, open this page: ${data.pageUrl}`
          : "You can follow it in korbat under Settings, Cases, Your reports.",
        `How korbat handles reports, and what it keeps: ${need(data, "termsUrl")}.`,
      ]);
    case "moderation_urgent": {
      // The alert for the urgent lane (3c design, section 7.12): counts and times only, to every staff account. A single
      // case is its own oldest, so its sentence gives one time and is worded for one.
      const lane = "in the urgent lane (child sexual abuse or exploitation, direct threats, violence, public security or self-harm)";
      return staffMail("korbat: a case is waiting in the urgent lane", [
        need(data, "count") === "1" ? `1 case ${lane} is waiting, since ${need(data, "oldest")}.` : `${need(data, "count")} cases ${lane} are waiting; the oldest since ${need(data, "oldest")}.`,
        "Open the staff console. Until the phone alerts of sub-project 3e, this email is the only alert.",
      ]);
    }
  }
}

/**
 * A moderation mail to a user: plain paragraphs as every mail, closed by the sentence that korbat's staff ask for
 * nothing by mail, so a message that asks for a password or a code, or for an answer, is known for a fake (3c design,
 * section 7.15).
 */
function userMail(subject: string, paragraphs: string[]): RenderedMail {
  return build(subject, [...paragraphs, "korbat staff never ask for your password or a code, and korbat does not read replies to this email."]);
}

/**
 * A staff mail: plain paragraphs as every mail, closed by the sentence that no staff mail carries a link, so a message
 * that does carry one is known for a fake (3a design, section 7).
 */
function staffMail(subject: string, paragraphs: string[]): RenderedMail {
  return build(subject, [...paragraphs, "korbat never puts a link in a staff email."]);
}
```

### Replace `apps/api/src/moderation/context.ts` (whole file)

```ts
import { ModerationErrorCode } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { AuthForModeration } from "../auth";
import type { Config } from "../config";
import type { MediaForCases } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";

/** The moderation codes plus the shared ones the module also raises. */
export type ModerationErrorKind = ModerationErrorCode | "not_found" | "invalid_request" | "onboarding_required" | "rate_limited" | "service_unavailable";
export type ModerationErrorStatus = 400 | 403 | 404 | 409 | 422 | 429 | 503;

/** What each code answers with over HTTP (3c design, section 10). */
const STATUS: Record<ModerationErrorKind, ModerationErrorStatus> = {
  notice_link_invalid: 422,
  notice_link_offsite: 422,
  human_check_failed: 403,
  staff_cannot_report: 403,
  notice_not_found: 404,
  already_reported: 409,
  case_changed: 409,
  case_closed: 409,
  staff_recused: 403,
  staff_target: 403,
  admin_required: 403,
  decision_cap: 429,
  profile_changed: 409,
  snapshot_mismatch: 409,
  snapshot_erased: 409,
  text_not_found: 409,
  invalid_decision: 422,
  not_found: 404,
  invalid_request: 400,
  onboarding_required: 403,
  rate_limited: 429,
  service_unavailable: 503,
};

// Those of the notice routes, and the first three after them, are written for the person reporting; the rest for staff,
// whose console words them again for the screen. The human check's names no contact address: the API holds none, and the
// app words that code itself.
const MESSAGES: Record<ModerationErrorKind, string> = {
  notice_link_invalid: "That link does not name a post or a profile on korbat.",
  notice_link_offsite: "Only links to this korbat can be reported.",
  human_check_failed: "We could not verify that you are human. Try again.",
  staff_cannot_report: "A staff account does not send reports. Open a finding in the staff console instead.",
  notice_not_found: "No report matches that reference and link.",
  already_reported: "You already reported this; it is being looked at.",
  case_changed: "The case changed since it was opened. Open it again.",
  case_closed: "The case changed at that moment. Try again.",
  staff_recused: "You cannot act on this case: you, or an account close to you, are a party to it.",
  staff_target: "A final decision cannot restrict a staff account. Staff are disciplined by demotion.",
  admin_required: "Only an admin can take this decision.",
  decision_cap: "You have reached the limit on decisions for now. Try again later.",
  profile_changed: "The profile changed since the snapshot was taken. Take a fresh snapshot and decide again.",
  snapshot_mismatch: "The snapshot is not the one this case holds.",
  snapshot_erased: "The snapshot was erased. Take a fresh one and decide again.",
  text_not_found: "A text of this decision is not saved, or was used already. Save it again.",
  invalid_decision: "This decision cannot stand as it is.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  // The words requireSession answers with: a route with an optional session refuses such a session itself.
  onboarding_required: "Choose a handle to finish setting up your account.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
};

/** An expected failure of a moderation flow. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class ModerationError extends Error {
  constructor(
    readonly code: ModerationErrorKind,
    readonly status: ModerationErrorStatus = STATUS[code],
    message: string = MESSAGES[code],
    /** Set for rate_limited so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ModerationError";
  }
}

export function moderationErrorMessage(code: ModerationErrorKind): string {
  return MESSAGES[code];
}

/** Whether a message the database raised is one of the module's codes, which the triggers raise as their message. */
export function isModerationErrorCode(message: string): message is ModerationErrorCode {
  return ModerationErrorCode.safeParse(message).success;
}

/**
 * The work a request starts and does not wait for: the mails after a report or a notice (3c design, section 7.1, step
 * 5). The answer, which carries the reference and the token, must never wait for a relay. Every task's error is caught
 * and logged here, and the tasks are kept until they end, so that `settle` can wait for them all.
 */
export interface Background {
  start(task: () => Promise<void>): void;
  /** Resolves once every started task has ended, those started meanwhile included. */
  settle(): Promise<void>;
}

export function createBackground(log: Logger): Background {
  const running = new Set<Promise<void>>();
  return {
    start(task) {
      const run = (async () => {
        try {
          await task();
        } catch (err) {
          log.error({ err }, "moderation: a task started after a request failed");
        }
      })();
      running.add(run);
      void run.then(() => running.delete(run));
    },
    async settle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

export interface ModerationDeps {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's interface: the human check, a notifier's contact and every mail. The module never sees an address. */
  auth: AuthForModeration;
  /** The social module's interface: the locks on profile rows and the reads evidence is copied from. */
  social: SocialForModeration;
  /** The media module's interface: an intake's holds on image rows, which this module never names itself. */
  media: MediaForCases;
  /** The shared limit store: what one sender may send, and the throttles of the staff alerts. */
  limits: RateLimitStore;
  /** The tasks requests started and did not wait for. */
  background: Background;
  config: Config;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/moderation/index.ts` (whole file)

```ts
/**
 * The only file outside `src/moderation/` may import. Everything else in the module is private and the architecture test
 * fails the build if another file reaches into it.
 *
 * The moderation module (3c design, section 5) runs on the API's role and owns the moderation tables: intakes and their
 * items, cases, decisions and their ledger of measures, evidence snapshots and staff texts. It inserts rows; the database
 * checks them, derives every restriction from them and refuses at commit what cannot stand. It reaches the other modules
 * only through the interfaces they export, never names an image row (the media module locks and holds a case's images for
 * it), and never sees the auth schema: a notifier's name and address, and every mail, are the auth module's.
 */
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../auth";
import type { Config } from "../config";
import type { MediaForCases } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";
import { createBackground, type ModerationDeps } from "./context";
import { decide, type DecideOutcome } from "./decide";
import { moderationRoutes } from "./routes";

export { ModerationError } from "./context";
export type { ModerationDeps, ModerationErrorKind } from "./context";
export type { DecideOutcome } from "./decide";

/** What the staff module needs from this one: the console's operations on cases, which its routes run behind the staff gate. */
export interface ModerationForStaff {
  /**
   * Records the decision a step-up confirmed, in one transaction with its audit row. "ended" when the confirming account
   * or key no longer opens anything, "late" when the challenge's time ran out; neither writes anything.
   */
  decide(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<DecideOutcome>;
}

export interface CreateModerationOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's interface for moderation: auth.forModeration. */
  auth: AuthForModeration;
  /** The social module's interface for cases: socialForModeration(apiDb). */
  social: SocialForModeration;
  /** The media module's interface for cases: media.forCases. */
  media: MediaForCases;
  /** What one sender may send, and the throttles of the staff alerts, count in the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  config: Config;
  logger: Logger;
  now?: () => Date;
}

export function createModeration(options: CreateModerationOptions) {
  const deps: ModerationDeps = {
    apiDb: options.apiDb,
    auth: options.auth,
    social: options.social,
    media: options.media,
    limits: options.rateLimitStore,
    background: createBackground(options.logger),
    config: options.config,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forStaff: ModerationForStaff = {
    decide: (session, confirmed, ctx) => decide(deps, session, confirmed, ctx),
  };
  return {
    deps,
    /** The app's routes, mounted at /api: reports and notices, their status page and its contact buttons. */
    routes: moderationRoutes(deps),
    /** The interface the staff module uses. */
    forStaff,
    /**
     * Resolves once every task a request started and did not wait for has ended: the mails after a report or a notice.
     * The tests await it; the server lets the tasks run.
     */
    settle: () => deps.background.settle(),
  };
}

export type Moderation = ReturnType<typeof createModeration>;
```

### Replace `apps/api/src/moderation/intake.ts` (whole file)

```ts
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CSAM_KEYWORDS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  NOTICE_LIMITS,
  laneFor,
  snapshotDigest,
  type ItemOutcome,
  type Lane,
  type NoticeContactRequest,
  type NoticeItemStatus,
  type NoticeRequest,
  type NoticeResponse,
  type NoticeStatus,
  type NoticeStatusRequest,
  type RuleId,
  type TdbCategory,
} from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { AccountMailResult, NotifierMailResult, Session } from "../auth";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import type { HoldPair } from "../media";
import type { CapturedPost, CapturedProfile } from "../social";
import { alertUrgentLane } from "./alerts";
import { ModerationError, type ModerationDeps } from "./context";
import { accountLink, parseLink, postLink } from "./links";
import {
  alreadyReported,
  insertIntake,
  insertItem,
  insertSnapshot,
  isSerializationFailure,
  latestSnapshot,
  noticeById,
  noticeByRef,
  noticeItems,
  openCase,
  recordReceipt,
  snapshotTime,
  targetKey,
  violatedUniqueConstraint,
  type NoticeItemRow,
  type ReceiptState,
} from "./repo";

/**
 * Taking in a report, a notice or a moderator's own finding (3c design, section 7.1): one intake, one item for each
 * target it names, each item in exactly one open case, and the first copy of each target as evidence. First the
 * transaction every intake runs (step 4); below it what a report or a notice passes before it and what follows its
 * commit (steps 1 to 3, 5 and 6), and the notifier's status page and contact (section 7.2).
 */

/** What an intake alleges and who sent it: the ground's columns of the intake's row. */
export interface IntakeGround {
  kind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  /** The signed-in reporter; never set on the path for child sexual abuse material, which records no sender. */
  reporterId: string | null;
  /** The staff account behind a finding. */
  findingBy: string | null;
  /** The id under which the auth module keeps a signed-out notifier's name and address. */
  contactId: string | null;
  ruleId: RuleId | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: TdbCategory;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  bonaFide: boolean;
}

/** A target that is live: a post by its id, or an account by its id with the handle it was named by. `position` is its place among the targets named, from 1. */
export type LiveTarget =
  | { type: "post"; id: string; position: number; mediaId?: string | null }
  | { type: "account"; id: string; position: number; namedHandle: string };

/** A target with nothing live: a link to a post that names no row or a deleted one, or a handle that names no account. It is stored as answered at once. */
export type DeadTarget = { type: "post"; id: string; position: number } | { type: "account"; position: number; namedHandle: string };

export interface IntakeRequest {
  ground: IntakeGround;
  live: readonly LiveTarget[];
  dead?: readonly DeadTarget[];
}

export interface RecordedItem {
  id: string;
  position: number;
  targetType: "post" | "account";
  targetId: string;
  /** Null for a target with nothing live. */
  caseId: string | null;
  seq: number | null;
  lane: Lane;
}

export interface IntakeRecorded {
  intakeId: string;
  /** The public reference: N- and ten base32 characters. */
  ref: string;
  /** The notice's token, for a signed-out notice and for every notice on the CSAM path: shown once, and stored only as its sha256. */
  token: string | null;
  /** Whether the intake's items are suspect: it is on the CSAM path, or a finding citing R2. */
  suspect: boolean;
  items: RecordedItem[];
}

/** How often the transaction is run again after a case closed under it, a deadlock or a lock timeout: in each nothing was written. */
const RETRIES = 3;
/** How often one transaction asks for a target's open case before it starts over. */
const CASE_READS = 3;
/**
 * The longest the intake waits for a lock. A case's row is held by a decision for as long as that decision's
 * transaction runs, which for a seal over thousands of images is seconds; an intake that waited longer starts over.
 */
const LOCK_TIMEOUT_MS = 10_000;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A fresh public reference: N- and ten base32 characters from 50 random bits. */
function newRef(): string {
  const bytes = randomBytes(7);
  // 48 bits and two more: 50 in all, which a JavaScript number holds exactly.
  const bits = bytes.readUIntBE(0, 6) * 4 + (bytes[6]! & 3);
  let ref = "";
  // 50 bits, five at a time from the top.
  for (let shift = 45; shift >= 0; shift -= 5) ref += BASE32[Math.floor(bits / 2 ** shift) % 32];
  return `N-${ref}`;
}

/** Whether an intake's items are suspect, as the attach trigger forces it: the CSAM path, or a finding citing R2. */
export const isSuspect = (ground: IntakeGround) => ground.csam || ground.ruleId === "R2";

/**
 * The live targets of a suspect intake with the items korbat adds: a post's card shows the images of the post it
 * quotes, so a report of child sexual abuse material about a post that quotes another is a report about both. Each
 * quoted post that the request does not name itself becomes a target of its own, at the position of the item it was
 * added for plus 10 (the lowest such position when several named posts quote it). One level only, as a card draws one
 * quote deep: an added target brings none of its own. Read outside any transaction; a post's quote never changes.
 */
export async function withAddedTargets(deps: Pick<ModerationDeps, "social">, live: readonly LiveTarget[]): Promise<LiveTarget[]> {
  const named = new Set(live.filter((target) => target.type === "post").map((target) => target.id));
  const added = new Map<string, number>();
  for (const target of live) {
    if (target.type !== "post" || target.position > 10) continue;
    const quoted = (await deps.social.postRef(target.id))?.quoteOfId;
    if (!quoted || named.has(quoted)) continue;
    added.set(quoted, Math.min(added.get(quoted) ?? target.position, target.position));
  }
  return [...live, ...[...added].map(([id, position]): LiveTarget => ({ type: "post", id, position: position + 10 }))];
}

/** Thrown inside the transaction to roll it back and run it again: the case a target was read into closed before the read found one. */
class StartOver extends Error {}

/** A case's targets in one order for every intake: by kind (posts before accounts, as the database orders the two) and then by id. */
const byTarget = (a: LiveTarget, b: LiveTarget) => (a.type !== b.type ? (a.type === "post" ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stores one intake in one transaction, which changes nothing unless it commits. In this order:
 *   1. a signed-in reporter's profile row, FOR KEY SHARE, refusing a missing or deleted account;
 *   2. the intake's row, with a fresh reference and, for a signed-out or CSAM notice, the hash of a fresh token;
 *   3. for each live target, in the targets' order: its open case (opened when there is none) and then its item, which
 *      the attach trigger numbers into the case, so every intake takes its cases in one order and two notices that name
 *      the same targets never deadlock; only then the captures, posts in id order, each under a share lock on its post,
 *      so none holds a post while it waits for a case;
 *   4. one hold through the media module for the whole intake: the image rows of every post target, and for a suspect
 *      item about an account every image row on the account's posts, locked by one statement in one id order, with each
 *      post's case's evidence hold on its images; then a snapshot for each case that holds none yet, or, for an account,
 *      whose newest one differs from the account now, a post's listing the images the hold answered;
 *   5. for each target with nothing live, an item with no case, answered at once.
 * It is run again, up to three times, when an item's case closed in between (the attach trigger says so), on a deadlock
 * and on a lock timeout; when the last run fails the same way the answer is case_closed. A signed-in reporter who already
 * has an item on the same ground in a target's open case is answered already_reported.
 */
export async function recordIntake(deps: ModerationDeps, request: IntakeRequest): Promise<IntakeRecorded> {
  const suspect = isSuspect(request.ground);
  const live = suspect ? await withAddedTargets(deps, request.live) : [...request.live];
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.apiDb.transaction((tx) => recordIn(deps, tx, { ...request, live }, suspect));
    } catch (err) {
      const constraint = violatedUniqueConstraint(err);
      if (constraint === "intake_items_reporter_once") throw new ModerationError("already_reported");
      // A reference another intake already has: one in 2^50 for each pair. The next run draws a new one.
      const startOver = err instanceof StartOver || isSerializationFailure(err) || isDeadlock(err) || isLockNotAvailable(err) || constraint === "intakes_ref_unique";
      if (!startOver) throw err;
      if (attempt >= RETRIES) throw new ModerationError("case_closed");
    }
  }
}

async function recordIn(deps: ModerationDeps, tx: DbTx, request: IntakeRequest, suspect: boolean): Promise<IntakeRecorded> {
  const { ground } = request;
  await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}::text, true)`);

  // 1.
  if (ground.reporterId !== null) await deps.social.lockAccounts(tx, [ground.reporterId], "key share", true);

  // 2. The token is stored only as its hash; the answer carries it once.
  const ref = newRef();
  const token = ground.channel === "signed_out" || ground.csam ? randomBytes(32).toString("base64url") : null;
  const intakeId = await insertIntake(tx, { ...ground, ref, lookupHash: token === null ? null : createHash("sha256").update(token).digest("hex") });
  const lane = laneFor({ ruleId: ground.ruleId, allegesIllegal: ground.allegesIllegal, csam: ground.csam, category: ground.category });

  // 3. First every case with its item, in the targets' order.
  const items: RecordedItem[] = [];
  const cases = new Map<LiveTarget, string>();
  for (const target of [...request.live].sort(byTarget)) {
    let caseId: string | null = null;
    for (let read = 0; read < CASE_READS && caseId === null; read++) caseId = await openCase(tx, target.type, target.id);
    // A live target's item is never stored without a case.
    if (caseId === null) throw new StartOver();
    cases.set(target, caseId);
    const item = await insertItem(tx, {
      intakeId,
      caseId,
      targetType: target.type,
      targetId: target.id,
      position: target.position,
      lane,
      mediaId: target.type === "post" ? (target.mediaId ?? null) : null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId: target.id, caseId, seq: item.seq, lane });
  }

  // Then the captures: every post in id order under a share lock, and every account's fields. The time is the
  // transaction's start, which the snapshots' trigger stamps.
  const takenAt = await snapshotTime(tx);
  const posts = new Map<string, CapturedPost>();
  const profiles = new Map<string, CapturedProfile>();
  for (const target of cases.keys()) {
    if (target.type === "post") {
      const post = await deps.social.capturePost(tx, target.id);
      if (!post) throw new Error("a post that an intake names has no row");
      posts.set(target.id, post);
    } else {
      const profile = await deps.social.captureProfile(tx, target.id);
      if (!profile) throw new Error("an account that an intake names has no row");
      profiles.set(target.id, profile);
    }
  }

  // 4. One hold for the whole intake, after every capture, so that no image row is locked before the last post is. Each
  // post's case holds the post's images as evidence, on every ground alike. A suspect item about an account reaches every
  // image on the account's posts: the freeze keeps those from the item's commit on, without a hold, and the pair only locks
  // them, so that a delete racing this intake waits and then reads the committed item.
  const pairs: HoldPair[] = [];
  for (const [target, caseId] of cases) if (target.type === "post") pairs.push({ caseId, postId: target.id });
  for (const target of cases.keys()) if (target.type === "account" && suspect) pairs.push({ ownerId: target.id });
  const held = await deps.media.hold(tx, pairs);

  // Then the snapshots, each post's with the images the hold answered for it.
  for (const [target, caseId] of cases) {
    const before = await latestSnapshot(tx, caseId);
    if (target.type === "post") {
      const post = posts.get(target.id)!;
      if (before !== null) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "post",
        targetId: target.id,
        authorHandle: post.authorHandle,
        postState: post.state,
        postCreatedAt: post.createdAt.toISOString(),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        body: post.body,
        // The images as the media module read them under their row locks, in position order; an erased image's alt text
        // is not copied. An empty list means that the post had none, or that they were gone before this intake.
        media: held.get(target.id) ?? [],
        displayName: null,
        bio: null,
        handle: null,
      });
    } else {
      const profile = profiles.get(target.id)!;
      if (before !== null && before.displayName === profile.displayName && before.bio === profile.bio && before.handle === profile.handle) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "account",
        targetId: target.id,
        authorHandle: profile.handle,
        postState: null,
        postCreatedAt: null,
        replyToId: null,
        quoteOfId: null,
        body: null,
        media: null,
        displayName: profile.displayName,
        bio: profile.bio,
        handle: profile.handle,
      });
    }
  }

  // 5. An account's link that names nothing gets an id that names nothing either, whether or not a profile holds or once
  // held the handle: no stored id ties an old handle to its account.
  for (const target of request.dead ?? []) {
    const targetId = target.type === "post" ? target.id : randomUUID();
    const item = await insertItem(tx, {
      intakeId,
      caseId: null,
      targetType: target.type,
      targetId,
      position: target.position,
      lane,
      mediaId: null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId, caseId: null, seq: null, lane });
  }
  items.sort((a, b) => a.position - b.position);
  return { intakeId, ref, token, suspect, items };
}

type SnapshotContent = Omit<Parameters<typeof insertSnapshot>[1], "salt" | "digest">;

/**
 * One snapshot: a salt of the server's own, and the digest over the salt, the time and everything copied. The time in
 * the digest is the one the database stamps the row with; when the two differ the transaction is rolled back, since the
 * stored row would not recompute to its digest.
 */
async function storeSnapshot(tx: DbTx, takenAt: string, content: SnapshotContent): Promise<void> {
  const salt = randomBytes(32).toString("hex");
  const digest = await snapshotDigest({
    salt,
    targetType: content.targetType,
    targetId: content.targetId,
    takenAt,
    authorHandle: content.authorHandle,
    postState: content.postState,
    postCreatedAt: content.postCreatedAt,
    replyToId: content.replyToId,
    quoteOfId: content.quoteOfId,
    body: content.body,
    media: content.media,
    displayName: content.displayName,
    bio: content.bio,
    handle: content.handle,
  });
  const stored = await insertSnapshot(tx, { ...content, salt, digest });
  if (stored.takenAt !== takenAt) throw new Error("a snapshot was stamped at another time than its digest covers");
}

// ---------------------------------------------------------------- reports and notices: POST /api/notices

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** How often one network may read a notice's status or use its contact buttons in an hour; the two routes share the count. */
export const STATUS_READS_PER_HOUR = 30;

/** Who sends a report or a notice: the session of a signed-in sender, or none, and the keyed hash of the network the request came from. */
export interface NoticeSender {
  session: Pick<Session, "userId" | "role" | "onboarded"> | null;
  netHash: string;
}

/** A target as a report names it, once a link is parsed: a post by its id, or an account by a handle. */
export type NamedTarget = { type: "post"; id: string; mediaId: string | null } | { type: "account"; handle: string };

/**
 * Counts one event in a window of the shared limit store and refuses it once the window is used up. An event that
 * cannot be counted is refused too: the limits are what keeps one sender from flooding the queue.
 */
async function countOrRefuse(deps: Pick<ModerationDeps, "limits">, key: string, windowMs: number, max: number): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(key, windowMs);
  } catch {
    throw new ModerationError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > max) throw new ModerationError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Which targets are live is one rule for every route (3c design, section 7.1, step 3), and it reads no image.
 *
 * For a suspect intake (a report of child sexual abuse material, or a finding citing R2) a target is live while its row
 * exists: a post in any state, one its author deleted or the purge blanked included, and an account whose profile row
 * exists, purged or not, also under a handle it has left, which the handle history keeps reserved for it. So no such
 * report about anything that exists is answered automatically: it waits for an admin, whatever is left of its target.
 *
 * For every other ground a post is live when it exists and its author has not deleted it, whatever its level, and an
 * account when a profile holds the named handle now and is not deleted: an old handle names nothing, and repeated
 * reports cannot keep content its author deleted, nor put deleted images before staff.
 *
 * Answers the target with its id, or null when it names nothing live.
 */
export async function liveTarget(deps: Pick<ModerationDeps, "social">, target: NamedTarget, suspect: boolean): Promise<{ type: "post" | "account"; id: string } | null> {
  if (target.type === "post") {
    const post = await deps.social.postRef(target.id);
    if (!post) return null;
    return suspect || post.state !== "deleted_by_author" ? { type: "post", id: target.id } : null;
  }
  const account = await deps.social.findAccountByHandle(target.handle, suspect);
  return account ? { type: "account", id: account.id } : null;
}

/** A notice's targets, resolved: the live ones and those with nothing live, numbered from 1 in the order the notice named them. */
export interface ResolvedTargets {
  live: LiveTarget[];
  dead: DeadTarget[];
}

/**
 * Resolves a notice's targets, outside any transaction (3c design, section 7.1, step 3):
 *   - a link is parsed into the post or the account it names, or refused;
 *   - a notice on the path for child sexual abuse material that names more than CSAM_NOTICE_MAX_ACCOUNTS accounts is
 *     refused, the accounts counted by the handles as named, before any is looked up, so the refusal says nothing about
 *     which handles are live or name the same account;
 *   - the targets are de-duplicated as named, a post by its id and an account by its handle: an account's link with
 *     nothing live has no id to compare, and a stored id must never tie an old handle to its account;
 *   - each is looked up by the one liveness rule;
 *   - a signed-in sender's target that they have reported already on this ground is dropped (`skip`).
 * What is left is numbered from 1 in the order named. The answer to the sender never says which targets were live.
 */
export async function resolveTargets(
  deps: Pick<ModerationDeps, "social" | "config">,
  request: Pick<NoticeRequest, "ground" | "targets">,
  skip: (live: readonly { type: "post" | "account"; id: string }[]) => Promise<Set<string>> = async () => new Set(),
): Promise<ResolvedTargets> {
  const suspect = request.ground === "csam";
  const named: NamedTarget[] = [];
  for (const target of request.targets) {
    const parsed = target.kind === "link" ? parseLink(deps.config.APP_ORIGIN, target.url) : target.kind === "post" ? { type: "post" as const, id: target.id } : { type: "account" as const, handle: target.handle };
    if (parsed.type === "account") {
      if (!named.some((seen) => seen.type === "account" && seen.handle === parsed.handle)) named.push(parsed);
      continue;
    }
    const mediaId = target.kind === "post" ? (target.mediaId ?? null) : null;
    const seen = named.find((earlier) => earlier.type === "post" && earlier.id === parsed.id);
    // Named twice, the post is one target; the image one of the two pointed at is kept.
    if (seen && seen.type === "post") seen.mediaId ??= mediaId;
    else named.push({ type: "post", id: parsed.id, mediaId });
  }
  if (suspect && named.filter((target) => target.type === "account").length > CSAM_NOTICE_MAX_ACCOUNTS) throw new ModerationError("invalid_request");

  const found = await Promise.all(named.map((target) => liveTarget(deps, target, suspect)));
  const liveOnes = found.flatMap((target) => (target === null ? [] : [target]));
  const skipped = liveOnes.length === 0 ? new Set<string>() : await skip(liveOnes);
  const resolved: ResolvedTargets = { live: [], dead: [] };
  const stored = new Set<string>();
  let position = 0;
  named.forEach((target, index) => {
    const live = found[index] ?? null;
    if (live !== null) {
      // Dropped: already reported by this sender, or (on the path that looks up old handles) the same account as an earlier target.
      if (skipped.has(targetKey(live)) || stored.has(targetKey(live))) return;
      stored.add(targetKey(live));
      position++;
      if (target.type === "post") resolved.live.push({ type: "post", id: live.id, position, mediaId: target.mediaId });
      else resolved.live.push({ type: "account", id: live.id, position, namedHandle: target.handle });
      return;
    }
    position++;
    if (target.type === "post") resolved.dead.push({ type: "post", id: target.id, position });
    else resolved.dead.push({ type: "account", position, namedHandle: target.handle });
  });
  // Every target was live and reported already: there is nothing to store.
  if (position === 0) throw new ModerationError("already_reported");
  return resolved;
}

/** The ground's columns of a report or a notice, from the request and its sender. */
function groundOf(request: NoticeRequest, reporterId: string | null, signedIn: boolean): IntakeGround {
  const channel = signedIn ? "signed_in" : "signed_out";
  const base = { kind: "user" as const, channel, findingBy: null, contactId: null } satisfies Partial<IntakeGround>;
  switch (request.ground) {
    case "rule":
      // A rule-only report alleges no illegality: its category is the Transparency Database's for a breach of the terms.
      return { ...base, reporterId, ruleId: request.ruleId, allegesIllegal: false, csam: false, category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", categoryKeyword: null, citedLaw: null, explanation: request.explanation ?? null, bonaFide: false };
    case "illegal":
      return {
        ...base,
        reporterId,
        // A signed-out notifier's name and address go to the auth module under this id; the notice holds the id alone.
        contactId: !signedIn && (request.name !== undefined || request.email !== undefined) ? randomUUID() : null,
        ruleId: request.ruleId ?? null,
        allegesIllegal: true,
        csam: false,
        category: request.category,
        categoryKeyword: null,
        citedLaw: request.citedLaw ?? null,
        explanation: request.explanation,
        bonaFide: true,
      };
    case "csam":
      // An Art. 16 notice of illegal content that records no sender, whoever sent it: no account, no contact.
      return {
        ...base,
        reporterId: null,
        ruleId: null,
        allegesIllegal: true,
        csam: true,
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        categoryKeyword: CSAM_KEYWORDS[request.keyword],
        citedLaw: null,
        explanation: request.explanation ?? null,
        bonaFide: request.bonaFide ?? false,
      };
  }
}

/**
 * One report or notice (3c design, section 7.1). In this order:
 *   1. who may send it: a staff account reports only as its own finding, in the console; a session that has not finished
 *      onboarding has no profile to report from and is refused, never treated as signed out; a signed-in sender leaves no
 *      name or address, since their contact is their account;
 *   2. the human check of a signed-out sender, then the limits: per network signed out, per account signed in;
 *   3. the targets, resolved outside any transaction;
 *   4. the intake's transaction; a request it could not save through no fault of its sender gives its limit hits back;
 *   5. after its commit, a signed-out notifier's contact is stored by the auth module (a failure is logged: the notice
 *      stands without it, and no contact can exist without its notice), and the mails are started without being waited
 *      for: the urgent lane's alert first, then the receipt;
 *   6. the answer: the reference, and the token of a notice sent signed out or on the path for child sexual abuse
 *      material, which is shown once and is the only way to follow such a notice. A stalled relay never costs it.
 */
export async function submitNotice(deps: ModerationDeps, request: NoticeRequest, sender: NoticeSender): Promise<NoticeResponse> {
  // 1.
  const { session } = sender;
  if (session !== null) {
    if (session.role !== "user") throw new ModerationError("staff_cannot_report");
    if (!session.onboarded) throw new ModerationError("onboarding_required");
    if (request.ground === "illegal" && (request.name !== undefined || request.email !== undefined)) throw new ModerationError("invalid_request");
  }

  // 2. A signed-in sender's token is ignored. From here on the request is counted, whatever a later step says of its
  // links or its targets: a sender cannot probe what exists without spending the hour.
  const counted: string[] = [];
  const count = async (key: string, windowMs: number, max: number) => {
    await countOrRefuse(deps, key, windowMs, max);
    counted.push(key);
  };
  if (session === null) {
    if (request.turnstileToken === undefined || !(await deps.auth.verifyHuman(request.turnstileToken))) throw new ModerationError("human_check_failed");
    await count(`notice:hour:net:${sender.netHash}`, HOUR_MS, NOTICE_LIMITS.signedOut.perHour);
    await count(`notice:day:net:${sender.netHash}`, DAY_MS, NOTICE_LIMITS.signedOut.perDay);
  } else {
    await count(`notice:hour:account:${session.userId}`, HOUR_MS, NOTICE_LIMITS.signedIn.perHour);
    await count(`notice:day:account:${session.userId}`, DAY_MS, NOTICE_LIMITS.signedIn.perDay);
  }

  // 3. On the path for child sexual abuse material nothing is matched against the session's account or its reports: every
  // live target gets an item, so someone who sent a notice of illegality about a post can still report it this way.
  const ground = groundOf(request, session?.userId ?? null, session !== null);
  const reporterId = ground.reporterId;
  const targets = await resolveTargets(deps, request, reporterId === null ? undefined : (live) => alreadyReported(deps.apiDb, reporterId, ground.allegesIllegal, live));

  // 4. A request that fails here through no fault of its sender gives back what it took of their limits, since its answer
  // tells them to send it again: its case kept changing until the last retry (case_closed), or the transaction failed in
  // a way no rule of the module names. A refusal that is the sender's own (already reported, an account that is gone)
  // stays counted.
  let recorded: IntakeRecorded;
  try {
    recorded = await recordIntake(deps, { ground, live: targets.live, dead: targets.dead });
  } catch (err) {
    if (!(err instanceof ModerationError) || err.code === "case_closed") {
      // The key holds the sender's network or account: the warning names neither.
      for (const key of counted) await deps.limits.release(key).catch((failure: unknown) => deps.log.warn({ err: failure }, "notice: a limit hit of a request that could not be saved could not be given back"));
    }
    throw err;
  }

  // 5. The contact is stored before the answer; the mails are not waited for.
  if (ground.contactId !== null && request.ground === "illegal") {
    try {
      await deps.auth.storeNotifierContact(ground.contactId, { name: request.name, email: request.email });
    } catch (err) {
      deps.log.error({ err, intakeId: recorded.intakeId }, "notice: the notifier's contact could not be stored; the notice stands without it");
    }
  }
  const urgent = recorded.items.some((item) => item.caseId !== null && item.lane === 0);
  deps.background.start(async () => {
    if (urgent) {
      try {
        await alertUrgentLane(deps);
      } catch (err) {
        deps.log.error({ err, intakeId: recorded.intakeId }, "notice: the urgent lane's alert failed; the dispatch job repeats it");
      }
    }
    await sendReceipt(deps, recorded.intakeId);
  });

  // 6.
  return recorded.token === null ? { ref: recorded.ref } : { ref: recorded.ref, token: recorded.token };
}

/** What a mail's result is recorded as. A contact nobody has (never stored, or forgotten) has no address; a refused address is given up. */
const RECEIPT_STATES: Record<NotifierMailResult | AccountMailResult, ReceiptState> = { sent: "sent", folded: "folded", suppressed: "suppressed", no_address: "no_address", forgotten: "no_address", refused: "failed" };

/**
 * Sends a notice's receipt and records what became of it: to a signed-out notifier's contact, or to the account behind a
 * notice of illegality sent signed in. It is built from the stored notice alone, so a receipt sent later carries the
 * same reference, time and links as one sent at once: the links of the items the sender named, in their order, an
 * account's under the handle as named. A notice without a pending receipt sends nothing. A failure of the relay leaves
 * the receipt pending, for the dispatch job to send; any other result is recorded, only while the receipt is still
 * pending.
 */
export async function sendReceipt(deps: Pick<ModerationDeps, "apiDb" | "auth" | "config" | "log">, intakeId: string): Promise<ReceiptState | "pending" | "none"> {
  const notice = await noticeById(deps.apiDb, intakeId);
  if (!notice || notice.receipt !== "pending") return "none";
  // The items the sender named: not those korbat added for a quoted post, and no re-examination, which shares its item's position.
  const items = (await noticeItems(deps.apiDb, intakeId)).filter((item) => item.position <= 10 && !item.reexamines);
  const message = { template: "notice_received" as const, ref: notice.ref, receivedAt: new Date(notice.receivedAt), items: items.map((item) => itemLink(deps, item)) };
  let result: NotifierMailResult | AccountMailResult;
  try {
    if (notice.contactId !== null) result = await deps.auth.mailNotifier(notice.contactId, message);
    else if (notice.reporterId !== null) result = await deps.auth.mailAccount(notice.reporterId, message);
    // The reporter's link was forgotten with their account: there is nobody to mail.
    else result = "no_address";
  } catch (err) {
    deps.log.warn({ err, intakeId }, "notice receipt: not sent; it stays pending for the next try");
    return "pending";
  }
  await recordReceipt(deps.apiDb, intakeId, RECEIPT_STATES[result]);
  return RECEIPT_STATES[result];
}

// ---------------------------------------------------------------- the notifier's status page and contact

/** An item's korbat address: a post's from its id, an account's from the handle as the notice named it, never from the handle the profile holds now. */
function itemLink(deps: Pick<ModerationDeps, "config">, item: Pick<NoticeItemRow, "targetType" | "targetId" | "namedHandle">): string {
  return item.targetType === "post" ? postLink(deps.config.APP_ORIGIN, item.targetId) : accountLink(deps.config.APP_ORIGIN, item.namedHandle!);
}

/** Whether two hex digests are the same, compared in constant time. */
function sameDigest(a: string, b: string): boolean {
  const [left, right] = [Buffer.from(a, "hex"), Buffer.from(b, "hex")];
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * One item as its sender reads it (3c design, sections 7.2 and 10). Nothing of the outcome is told before the daily
 * release: not the outcome or its day, not whether images were sealed or out of sight, not whether a re-examination can
 * be asked for, so the page and the mail tell the same at the same time. And nothing before it tells whether the target
 * was live: an item whose link named nothing reads exactly as one that waits for a moderator.
 */
async function itemStatus(deps: Pick<ModerationDeps, "social" | "config">, item: NoticeItemRow): Promise<NoticeItemStatus> {
  // "No action for now": a decision taken while nobody could open the post's images, on an item about a post that is not itself suspect.
  const unseen = item.released && item.decisionUnseen && item.targetType === "post" && !item.suspect;
  // What the answer concerns. Before the release the scope comes from what the notice named and from the item's suspect
  // mark alone, never from what the target turned out to be: the page must not tell a live target from a link that names
  // nothing, nor, on the path for child sexual abuse material, whether a handle names an account.
  let scope: NoticeItemStatus["scope"] = null;
  if (item.targetType === "account") {
    // With or without a case: the answer concerns the images on the account's posts too when the item is suspect or,
    // once released, when its decision sealed them. After "not available" the page and the app add no scope sentence.
    scope = item.suspect || (item.released && item.sealed) ? "account_suspect" : "account";
  } else if (item.released && item.hasCase && !item.suspect && (await deps.social.postRef(item.targetId))?.quoteOfId) {
    // Whether a post quotes another can be read only from its row, so this scope comes with the released outcome and not
    // before it. A suspect item about a quoting post has an item of its own for the quoted post, and no such scope.
    scope = "quote";
  }
  // Only a moderator's decision to take no action can be examined again, once; an answer given with the images out of
  // sight does not spend that, also when it answered a re-examination.
  const reexaminable = item.released && item.noAction && (!item.reexamines || unseen);
  return {
    position: item.position,
    link: itemLink(deps, item),
    scope,
    suspect: item.suspect,
    sealed: item.released && item.sealed,
    unseen,
    quotedBy: item.position > 10 ? item.position - 10 : null,
    outcome: item.released ? (item.shownOutcome as ItemOutcome) : null,
    decidedOn: item.released ? item.decidedOn : null,
    changed: item.changed,
    reexamines: item.reexamines,
    reexamination: reexaminable ? { open: !item.reexamined && item.inWindow, until: item.until! } : null,
  };
}

/**
 * The items the status page lists. An item korbat added for a quoted post (a position above 10) exists only where the
 * named post exists and quotes another, so listing it at once would tell a live target from a link that names nothing.
 * It is listed from the first release that shows an outcome of its pair: its origin's, after which it stands directly
 * behind it, with its own outcome or waiting; or its own, since from the release an outcome shows on the page and its
 * window to ask for a re-examination runs. Its origin's waiting past that same release already told that it names a row:
 * a link to no row was answered by then. A re-examination is filed only on a released item, so it is always listed.
 */
function listedItems(items: readonly NoticeItemRow[]): NoticeItemRow[] {
  const releasedOrigins = new Set(items.filter((item) => item.position <= 10 && !item.reexamines && item.released).map((item) => item.position));
  return items.filter((item) => item.position <= 10 || item.reexamines || item.released || releasedOrigins.has(item.position - 10));
}

/**
 * The notifier's status page (3c design, section 7.2): the notice whose reference matches and whose token this is, either
 * the notice's own, shown once on screen, or the mail token of its contact, which the receipt's link carries. Anything
 * else is notice_not_found. With the notice's own token the contact's `confirmed` and `stopped` are null, so the answer
 * to whoever typed an address never depends on what korbat knows about that address.
 */
export async function noticeStatus(deps: Pick<ModerationDeps, "apiDb" | "auth" | "social" | "limits" | "config">, request: NoticeStatusRequest, netHash: string): Promise<NoticeStatus> {
  await countOrRefuse(deps, `notice-status:${netHash}`, HOUR_MS, STATUS_READS_PER_HOUR);
  const notice = await noticeByRef(deps.apiDb, request.ref);
  if (!notice) throw new ModerationError("notice_not_found");
  const own = notice.lookupHash !== null && sameDigest(notice.lookupHash, createHash("sha256").update(request.token).digest("hex"));
  const byMail = !own && notice.contactId !== null && (await deps.auth.notifierMailTokenMatches(notice.contactId, request.token));
  if (!own && !byMail) throw new ModerationError("notice_not_found");

  const items: NoticeItemStatus[] = [];
  for (const item of listedItems(await noticeItems(deps.apiDb, notice.id))) items.push(await itemStatus(deps, item));
  let contact: NoticeStatus["contact"] = null;
  if (notice.contactId !== null) {
    const facts = (await deps.auth.notifierFacts([notice.contactId])).get(notice.contactId);
    contact = { given: facts?.contactGiven ?? false, confirmed: byMail ? (facts?.confirmed ?? false) : null, stopped: byMail ? (facts?.suppressed ?? false) : null };
  }
  return { ref: notice.ref, receivedAt: notice.receivedAt, items, contact };
}

/**
 * The status page's two buttons (3c design, section 7.2): "I sent this" and "stop korbat's emails about reports to this
 * address". Only the contact's mail token works them: the notice's own token, a notice without a contact and a wrong
 * token are all notice_not_found, so typing someone's address neither confirms it nor stops korbat's mail to it.
 */
export async function noticeContact(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits">, request: NoticeContactRequest, netHash: string): Promise<void> {
  await countOrRefuse(deps, `notice-status:${netHash}`, HOUR_MS, STATUS_READS_PER_HOUR);
  const notice = await noticeByRef(deps.apiDb, request.ref);
  if (!notice || notice.contactId === null) throw new ModerationError("notice_not_found");
  const done = request.choice === "confirm" ? await deps.auth.confirmNotifier(notice.contactId, request.token) : await deps.auth.stopNotifier(notice.contactId, request.token);
  if (!done) throw new ModerationError("notice_not_found");
}
```

### Replace `apps/api/src/moderation/repo.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import type { ActionKind, CaseDecidedParams, Lane, StaffStoredAssertion } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";

/**
 * The SQL statements of the moderation module, on the korbat_api pool (3c design, sections 5 and 6). The module inserts
 * rows; migrator-owned triggers check them, force the columns the API must not choose, and derive every restriction from
 * them. So each insert here names only what the API supplies: the database sets the rest whatever an insert said (a time,
 * a number in a case, who a report came from), and a column left out can never be mistaken for one the API chose. That is
 * why the inserts are written as SQL: a query builder would name every column of the table.
 */

/** What a statement runs through: the pool, or a transaction. */
type Runner = Pick<Db, "execute"> | Pick<DbTx, "execute">;

const rows = async <T>(q: Runner, query: ReturnType<typeof sql>): Promise<T[]> => (await q.execute(query)) as unknown as T[];

/** A timestamptz expression as the text Date.prototype.toISOString writes: UTC, to the millisecond. The expression is written here, never input. */
const iso = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

// ---------------------------------------------------------------- what the database raised

/** The first of the driver's errors in the chain that carries a SQLSTATE; drizzle wraps the driver's error as a cause. */
function driverError(err: unknown): { code: string; message: unknown; constraint_name?: unknown } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && typeof (current as { code?: unknown }).code === "string") return current as { code: string; message: unknown; constraint_name?: unknown };
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** The message of an exception a trigger or a function raised as its code (SQLSTATE P0001); null for anything else. */
export function raisedMessage(err: unknown): string | null {
  const raised = driverError(err);
  return raised?.code === "P0001" && typeof raised.message === "string" ? raised.message : null;
}

/** True for a serialization failure (SQLSTATE 40001): the attach trigger raises it when an item's case closed in between. */
export function isSerializationFailure(err: unknown): boolean {
  return driverError(err)?.code === "40001";
}

/** The constraint a unique violation names (SQLSTATE 23505), or null for anything else. */
export function violatedUniqueConstraint(err: unknown): string | null {
  const raised = driverError(err);
  return raised?.code === "23505" && typeof raised.constraint_name === "string" ? raised.constraint_name : null;
}

// ---------------------------------------------------------------- intakes, items and cases

export type TargetType = "post" | "account";

/** One report, notice or finding as the intake's transaction stores it; the trigger sets when it was received and its receipt's state. */
export interface IntakeRow {
  kind: "user" | "finding";
  ref: string;
  /** The sha256 hex of the notice's token, for a signed-out notice and for every notice on the CSAM path. */
  lookupHash: string | null;
  channel: "signed_in" | "signed_out" | "staff";
  reporterId: string | null;
  findingBy: string | null;
  contactId: string | null;
  ruleId: string | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: string;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  bonaFide: boolean;
}

export async function insertIntake(tx: DbTx, row: IntakeRow): Promise<string> {
  const [inserted] = await rows<{ id: string }>(
    tx,
    sql`insert into intakes (kind, ref, lookup_hash, channel, reporter_id, finding_by, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide)
        values (${row.kind}::intake_kind, ${row.ref}, ${row.lookupHash}, ${row.channel}::intake_channel, ${row.reporterId}::uuid, ${row.findingBy}::uuid, ${row.contactId}::uuid,
                ${row.ruleId}, ${row.allegesIllegal}::boolean, ${row.csam}::boolean, ${row.category}, ${row.categoryKeyword}, ${row.citedLaw}, ${row.explanation}, ${row.bonaFide}::boolean)
        returning id`,
  );
  return inserted!.id;
}

/**
 * The target's open case, opened when there is none: an insert that does nothing on a conflict (the API role holds no
 * UPDATE on cases, so it could not do anything else), then a read of the open case in a statement of its own, which
 * sees a case another transaction committed while the insert waited. Null when the read finds none: a decision closed
 * the case after the insert, and the caller runs both again.
 */
export async function openCase(tx: DbTx, targetType: TargetType, targetId: string): Promise<string | null> {
  await tx.execute(sql`insert into cases (target_type, target_id) values (${targetType}::moderation_target, ${targetId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
  const [open] = await rows<{ id: string }>(tx, sql`select id from cases where target_type = ${targetType}::moderation_target and target_id = ${targetId}::uuid and closed_at is null`);
  return open?.id ?? null;
}

/** One target of an intake. With a case the attach trigger numbers it into the case; without one it is stored as answered at once, not available. */
export interface ItemRow {
  intakeId: string;
  caseId: string | null;
  targetType: TargetType;
  targetId: string;
  position: number;
  lane: Lane;
  /** The image the sender pointed at: a hint. */
  mediaId: string | null;
  /** For an account, the handle as it was named, in lower case. */
  namedHandle: string | null;
}

export async function insertItem(tx: DbTx, row: ItemRow): Promise<{ id: string; seq: number | null }> {
  const [inserted] = await rows<{ id: string; seq: number | null }>(
    tx,
    sql`insert into intake_items (intake_id, case_id, target_type, target_id, position, lane, media_id, named_handle, outcome)
        values (${row.intakeId}::uuid, ${row.caseId}::uuid, ${row.targetType}::moderation_target, ${row.targetId}::uuid, ${row.position}::smallint, ${row.lane}::smallint,
                ${row.mediaId}::uuid, ${row.namedHandle}, ${row.caseId === null ? "not_available" : null}::item_outcome)
        returning id, seq`,
  );
  return inserted!;
}

// ---------------------------------------------------------------- reports and notices

/** Ids as one uuid[] parameter. */
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

/** One target as a key of a set: its kind and its id. */
export const targetKey = (target: { type: TargetType; id: string }) => `${target.type}:${target.id}`;

/**
 * Which of these targets the sender has reported already on this ground (alleging illegality or not): the target's open
 * case holds an item of theirs that is no re-examination. The unique index the intake's transaction meets holds the same
 * rule; this read lets a notice that names several targets drop the ones already reported instead of failing whole.
 */
export async function alreadyReported(q: Runner, reporterId: string, allegesIllegal: boolean, targets: readonly { type: TargetType; id: string }[]): Promise<Set<string>> {
  if (targets.length === 0) return new Set();
  const ids = (type: TargetType) => uuids(targets.filter((target) => target.type === type).map((target) => target.id));
  const found = await rows<{ target_type: TargetType; target_id: string }>(
    q,
    sql`select c.target_type, c.target_id from cases c
         where c.closed_at is null
           and ((c.target_type = 'post' and c.target_id = any(${ids("post")})) or (c.target_type = 'account' and c.target_id = any(${ids("account")})))
           and exists (select 1 from intake_items i
                        where i.case_id = c.id and i.reporter_account_id = ${reporterId}::uuid and i.alleges_illegal = ${allegesIllegal}::boolean and i.reexamines_item_id is null)`,
  );
  return new Set(found.map((row) => targetKey({ type: row.target_type, id: row.target_id })));
}

/** A notice as the status page and its receipt need it: where it stands and whom its receipt goes to, never what it says. */
export interface NoticeRow {
  id: string;
  ref: string;
  /** The sha256 hex of the notice's own token; null for a report sent signed in on a rule or on the law. */
  lookupHash: string | null;
  contactId: string | null;
  reporterId: string | null;
  allegesIllegal: boolean;
  /** As Date.prototype.toISOString writes it. */
  receivedAt: string;
  receipt: "pending" | "sent" | "folded" | "suppressed" | "no_address" | "none" | "failed";
}

const noticeColumns = sql`id, ref, lookup_hash, contact_id, reporter_id, alleges_illegal, ${iso("received_at")} as received_at, receipt`;
type NoticeColumns = { id: string; ref: string; lookup_hash: string | null; contact_id: string | null; reporter_id: string | null; alleges_illegal: boolean; received_at: string; receipt: NoticeRow["receipt"] };
const noticeOf = (row: NoticeColumns | undefined): NoticeRow | null =>
  row ? { id: row.id, ref: row.ref, lookupHash: row.lookup_hash, contactId: row.contact_id, reporterId: row.reporter_id, allegesIllegal: row.alleges_illegal, receivedAt: row.received_at, receipt: row.receipt } : null;

/** The notice with this public reference, or null. */
export async function noticeByRef(q: Runner, ref: string): Promise<NoticeRow | null> {
  return noticeOf((await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where ref = ${ref}`))[0]);
}

export async function noticeById(q: Runner, intakeId: string): Promise<NoticeRow | null> {
  return noticeOf((await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where id = ${intakeId}::uuid`))[0]);
}

/** One item of a notice as its sender may read it: nothing of the case, the decision's reasons or the target's content. */
export interface NoticeItemRow {
  position: number;
  targetType: TargetType;
  targetId: string;
  /** For an account, the handle as the notice named it. */
  namedHandle: string | null;
  /** False for a link that named nothing live: its item has no case and was answered at once. */
  hasCase: boolean;
  suspect: boolean;
  /** Whether the daily release has shown the outcome; nothing below is told before it. */
  released: boolean;
  shownOutcome: string | null;
  /** The UTC day of the answering decision, or of the item itself when it was answered without one. */
  decidedOn: string;
  /** Whether the answering decision holds a seal. */
  sealed: boolean;
  /** Whether the answering decision was taken while nobody could open the post's images. */
  decisionUnseen: boolean;
  changed: boolean;
  reexamines: boolean;
  /** A moderator's decision to take no action: the only answer a re-examination can be asked for. */
  noAction: boolean;
  reexamined: boolean;
  /** The end of the re-examination window, as toISOString writes it; null before the release. */
  until: string | null;
  inWindow: boolean;
}

/**
 * A notice's items in the order its page lists them: by position, an item korbat added for a quoted post (positions 11
 * to 20) directly after the item it was added for, and a re-examination, which shares its item's position, after it.
 * The window's end is the database's own appeal_deadline of the release, read against its clock, as the attach trigger
 * reads it when a re-examination is filed.
 */
export async function noticeItems(q: Runner, intakeId: string): Promise<NoticeItemRow[]> {
  const found = await rows<{
    position: number;
    target_type: TargetType;
    target_id: string;
    named_handle: string | null;
    has_case: boolean;
    suspect: boolean;
    released: boolean;
    shown_outcome: string | null;
    decided_on: string;
    sealed: boolean;
    decision_unseen: boolean;
    changed: boolean;
    reexamines: boolean;
    no_action: boolean;
    reexamined: boolean;
    until: string | null;
    in_window: boolean;
  }>(
    q,
    sql`select i.position, i.target_type, i.target_id, i.named_handle, i.case_id is not null as has_case, i.suspect,
               i.outcome_sent_at is not null as released, i.shown_outcome,
               to_char(coalesce(d.decided_at, i.created_at) at time zone 'UTC', 'YYYY-MM-DD') as decided_on,
               exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind = 'seal_media') as sealed,
               coalesce(d.unseen, false) as decision_unseen,
               i.revised_sent_at is not null as changed,
               i.reexamines_item_id is not null as reexamines,
               (i.answered_by is not null and i.outcome in ('no_violation', 'not_evident')) as no_action,
               exists (select 1 from intake_items r where r.reexamines_item_id = i.id) as reexamined,
               ${iso("public.appeal_deadline(i.outcome_sent_at)")} as until,
               coalesce(clock_timestamp() < public.appeal_deadline(i.outcome_sent_at), false) as in_window
          from intake_items i left join decisions d on d.id = i.answered_by
         where i.intake_id = ${intakeId}::uuid
         order by (case when i.position > 10 then i.position - 10 else i.position end), (i.position > 10), i.created_at, i.id`,
  );
  return found.map((row) => ({
    position: row.position,
    targetType: row.target_type,
    targetId: row.target_id,
    namedHandle: row.named_handle,
    hasCase: row.has_case,
    suspect: row.suspect,
    released: row.released,
    shownOutcome: row.shown_outcome,
    decidedOn: row.decided_on,
    sealed: row.sealed,
    decisionUnseen: row.decision_unseen,
    changed: row.changed,
    reexamines: row.reexamines,
    noAction: row.no_action,
    reexamined: row.reexamined,
    until: row.until,
    inWindow: row.in_window,
  }));
}

/** What became of a receipt: the delivery states a send can end in. */
export type ReceiptState = "sent" | "folded" | "suppressed" | "no_address" | "failed";

/**
 * Records what became of a notice's receipt, only while it is still pending, so a late answer never overwrites one
 * already recorded: the later writer waits for the first one's commit and then changes nothing. True when this call
 * recorded it.
 */
export async function recordReceipt(q: Runner, intakeId: string, state: ReceiptState): Promise<boolean> {
  const updated = await rows<{ id: string }>(
    q,
    sql`update intakes set receipt = ${state}::delivery_state, receipt_sent_at = case when ${state}::text = 'sent' then now() else receipt_sent_at end
         where id = ${intakeId}::uuid and receipt = 'pending' returning id`,
  );
  return updated.length > 0;
}

/** The open cases in the urgent lane: how many, and since when the oldest of them has waited. One read of the queue's index. */
export async function urgentWaiting(q: Runner): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await rows<{ n: number; oldest: string | null }>(q, sql`select count(*)::int as n, ${iso("min(oldest_open_at)")} as oldest from cases where closed_at is null and lane = 0`);
  return { count: row!.n, oldest: row!.oldest === null ? null : new Date(row!.oldest) };
}

// ---------------------------------------------------------------- evidence

/** The transaction's start to the millisecond, as the snapshots' trigger stamps a snapshot taken in it. */
export async function snapshotTime(tx: DbTx): Promise<string> {
  const [row] = await rows<{ at: string }>(tx, sql`select ${iso("date_trunc('milliseconds', now())")} as at`);
  return row!.at;
}

/**
 * Whether the case holds a snapshot yet, and for an account's case the fields of its newest one. A snapshot's time is its
 * transaction's start to the millisecond, so two snapshots of one case can carry the same time; their ids, which
 * insertSnapshot draws in time order, say which is the newer.
 */
export async function latestSnapshot(tx: DbTx, caseId: string): Promise<{ displayName: string | null; bio: string | null; handle: string | null } | null> {
  const [row] = await rows<{ display_name: string | null; bio: string | null; handle: string | null }>(
    tx,
    sql`select display_name, bio, handle from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc limit 1`,
  );
  return row ? { displayName: row.display_name, bio: row.bio, handle: row.handle } : null;
}

/** A snapshot as the intake stores it: what was copied, with the salt and the digest the server made over all of it. */
export interface SnapshotRow {
  caseId: string;
  targetType: TargetType;
  targetId: string;
  authorHandle: string;
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | null;
  postCreatedAt: string | null;
  replyToId: string | null;
  quoteOfId: string | null;
  body: string | null;
  media: { id: string; alt: string | null; width: number; height: number }[] | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
  salt: string;
  digest: string;
}

/**
 * Stores a snapshot and answers its id with the time the database stamped it, as text to the millisecond. The id is a
 * version 7 uuid, which PostgreSQL draws in time order and never backwards within a session: the newest snapshot of a
 * case is then the one with the latest time and, among those of one millisecond, the greatest id.
 */
export async function insertSnapshot(tx: DbTx, row: SnapshotRow): Promise<{ id: string; takenAt: string }> {
  const [inserted] = await rows<{ id: string; taken_at: string }>(
    tx,
    sql`insert into evidence_snapshots (id, case_id, target_type, target_id, author_handle, post_state, post_created_at, reply_to_id, quote_of_id, body, media, display_name, bio, handle, salt, digest)
        values (uuidv7(), ${row.caseId}::uuid, ${row.targetType}::moderation_target, ${row.targetId}::uuid, ${row.authorHandle}, ${row.postState}::post_state, ${row.postCreatedAt}::timestamptz,
                ${row.replyToId}::uuid, ${row.quoteOfId}::uuid, ${row.body}, ${row.media === null ? null : JSON.stringify(row.media)}::text::jsonb, ${row.displayName}, ${row.bio}, ${row.handle},
                ${row.salt}, ${row.digest})
        returning id, ${iso("taken_at")} as taken_at`,
  );
  return { id: inserted!.id, takenAt: inserted!.taken_at };
}

// ---------------------------------------------------------------- decisions

/** What a case is about, or null when no case has the id. */
export async function caseTarget(q: Runner, caseId: string): Promise<{ type: TargetType; id: string } | null> {
  const [row] = await rows<{ target_type: TargetType; target_id: string }>(q, sql`select target_type, target_id from cases where id = ${caseId}::uuid`);
  return row ? { type: row.target_type, id: row.target_id } : null;
}

/**
 * The decision's row, from the params its staff key confirmed and the account that decided. The id is the API's, so the
 * audit row can name the decision; everything else the row holds is the triggers'.
 */
export async function insertDecision(tx: DbTx, row: { id: string; caseId: string; decidedBy: string; params: CaseDecidedParams }): Promise<void> {
  const p = row.params;
  await tx.execute(
    sql`insert into decisions (id, case_id, kind, reviews_decision_id, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, category_keyword,
                               snapshot_id, snapshot_digest, facts_digest, reason_digest, legal_reference_digest, decided_by)
        values (${row.id}::uuid, ${row.caseId}::uuid, ${p.kind}::decision_kind, ${p.reviewsDecisionId}::uuid, ${p.stateVersion}::int, ${p.throughSeq}::int, ${p.outcome}::decision_outcome,
                ${p.ground}::decision_ground, ${p.ruleId}, ${p.rulesVersion}::smallint, ${p.redressVersion}::smallint, ${p.category}, ${p.categoryKeyword},
                ${p.snapshotId}::uuid, ${p.snapshotDigest}, ${p.factsDigest}, ${p.reasonDigest}, ${p.legalReferenceDigest}, ${row.decidedBy}::uuid)`,
  );
}

/** One measure or reversal of a decision. Its target, the measure it lifts and whether it changes anything are the triggers'. */
export async function insertAction(tx: DbTx, decisionId: string, action: { kind: ActionKind; mediaId: string | null }): Promise<void> {
  await tx.execute(sql`insert into decision_actions (decision_id, kind, media_id) values (${decisionId}::uuid, ${action.kind}::action_kind, ${action.mediaId}::uuid)`);
}

/** The audit row of a confirmed action, as public.append_confirmed_audit writes it. */
export interface ConfirmedAuditRow {
  actorId: string;
  keyId: string;
  action: "case_decided" | "appeals_reviewed" | "identity_revealed";
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  staffSession: string;
  actionHash: string;
  stepUp: StaffStoredAssertion;
  requestId: string;
  /** The step-up challenge's expiry: the function refuses a row that joins the chain at or after it. */
  expiresAt: Date;
}

/**
 * Writes a confirmed action's audit row through public.append_confirmed_audit, as the last statement of the action's
 * transaction: the function checks that the acting account and its key are still live, writes the row, and refuses it when
 * the challenge had expired by then, which rolls the whole transaction back. The row holds the chain's head until the
 * commit, so nothing that can wait may run after it. Answers the row's place in the chain.
 */
export async function appendConfirmedAudit(tx: DbTx, row: ConfirmedAuditRow): Promise<number> {
  // The jsonb arguments go as text and are cast, so the driver sends them exactly as serialised here.
  const [written] = await rows<{ place: string }>(
    tx,
    sql`select public.append_confirmed_audit(${row.actorId}::uuid, ${row.keyId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
          ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession}::uuid, ${row.actionHash}::text, ${JSON.stringify(row.stepUp)}::text::jsonb,
          ${row.requestId}::text, ${row.expiresAt.getTime()}::bigint)::text as place`,
  );
  return Number(written!.place);
}
```

### Replace `infra/.env.example` (whole file)

```text
# Copy to infra/.env and change every password. Never commit infra/.env.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-superuser
POSTGRES_DB=korbat
KORBAT_MIGRATE_DB_PASSWORD=change-me-migrate
KORBAT_API_DB_PASSWORD=change-me-api
KORBAT_AUTH_DB_PASSWORD=change-me-auth
# Valkey (the session cache and rate-limit counters) refuses every command without it.
REDIS_PASSWORD=change-me-redis

# Images. The formats korbat accepts: remove one to refuse it and keep its decoder blocked, for
# example after a security advisory against that decoder, then restart api and worker.
MEDIA_FORMATS=jpeg,png,webp,gif,avif
# Uploads are refused while a media volume has less free space than this many bytes (2 GiB). The
# volumes share a disk with Postgres, and a full disk stops the database.
MEDIA_MIN_FREE_BYTES=2147483648
# The sweeper's pass that deletes images without a database row: on refuses when there are many of
# them (a database restored from an older snapshot looks like that), off skips it during a restore,
# force deletes them once you have checked.
MEDIA_RECONCILE=on

API_LOG_LEVEL=info
# Comma-separated browser origins allowed to call the API cross-origin. Empty in prod (same origin via Caddy).
API_TRUSTED_ORIGINS=http://localhost:8081

# Auth. `node scripts/gen-dev-env.mjs` fills the keys with random values and shares them with apps/api/.env.
# Origin the web app is served from (Caddy). Production: https://<your domain>.
API_APP_ORIGIN=http://localhost:8080
# Which header names the client: cloudflare when the tunnel is the only way in (the API then trusts
# cf-connecting-ip), caddy when Caddy's port is reachable directly. Never none behind a proxy.
API_TRUST_PROXY=caddy
API_AUTH_HMAC_KEY=change-me-key-auth-hmac
API_IP_HASH_KEY=change-me-key-ip-hash
API_TOTP_ENC_KEY=v1:change-me-key-totp
# Earlier TOTP keys, comma-separated, kept only while secrets they encrypted are still stored; a secret
# read with one is re-encrypted with API_TOTP_ENC_KEY.
API_TOTP_ENC_KEYS_PREVIOUS=
# Encrypts what a signed-out notifier leaves to be told about their notice: a name, an address and the token of the
# mails' link. Keep it secret and backed up as API_TOTP_ENC_KEY is: without it korbat can neither mail a notifier nor
# say who sent a notice.
API_NOTIFIER_ENC_KEY=v1:change-me-key-notifier
# Earlier notifier keys, comma-separated. A contact is never encrypted again, so a key stays here while a contact it
# encrypted is still stored.
API_NOTIFIER_ENC_KEYS_PREVIOUS=
# Cloudflare's documented always-pass test secret. Production uses the secret of your Turnstile widget.
API_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Mailpit from compose.dev.yml. Production: the EU relay, e.g. smtps://user:pass@smtp-relay.example:465
API_SMTP_URL=smtp://mailpit:1025
API_MAIL_FROM="korbat <no-reply@korbat.local>"
API_TERMS_VERSION=draft-2026-09
# Who checks the phone number behind the verified badge: off turns the badge off, dev accepts the code
# 000000 (development only; production refuses it), vonage texts a real code through Vonage Verify with the
# key and secret from the Vonage dashboard (the runbook in the 1b design says how).
API_VERIFY_PROVIDER=off
# Whether the web app's account settings show the verified badge section: on or off. Set it together with
# API_VERIFY_PROVIDER: off while that is off, on once it is dev or vonage (a section shown without a provider
# answers every Send code with "Verification is not available"). The web image reads it as EXPO_PUBLIC_BADGE,
# which Expo inlines at export time.
WEB_BADGE=off
API_VONAGE_API_KEY=
API_VONAGE_API_SECRET=
# The sender name of the verification text: 1 to 18 characters, none of / { } : $.
API_VERIFY_BRAND=korbat
# Passkeys. The RP ID every passkey is bound to: empty means the host of API_APP_ORIGIN. It may instead be a parent
# domain of that host (korbat.example for app.korbat.example). The staff console does not use it: staff keys have their
# own RP ID. Production refuses an IP address or localhost. Choose it before the first passkey is added: changing it
# later strands every passkey.
API_WEBAUTHN_RP_ID=
# The site name password managers show next to a korbat passkey: 1 to 64 printable characters; empty means korbat.
API_WEBAUTHN_RP_NAME=

# The staff console: the origin staff open it at, served by Caddy's second site (port 8090 in its container). Empty
# switches the console off: every /api/staff path then answers 404. It must differ from API_APP_ORIGIN and never appear
# in API_TRUSTED_ORIGINS. In development it is localhost on the port compose.dev.yml publishes the console on
# (DEV_CONSOLE_PORT below); open it there, never at 127.0.0.1. Production: https://<the console's own hostname>, a
# hostname apart from the app's.
API_CONSOLE_ORIGIN=http://localhost:8090
# The RP ID staff keys are bound to: empty means the hostname of API_CONSOLE_ORIGIN, which production requires. Choose
# the console's hostname before the first staff key is enrolled: moving the console later means enrolling every key
# again.
API_CONSOLE_RP_ID=

# Moderation. The hour of the UTC day, 0 to 23, at which the day's decisions on reports and notices are released to those
# who sent them, in one batch, so that nobody can tell from a mail's minute when a decision was made; empty means 7.
API_MODERATION_DISPATCH_HOUR=7
# The queue's emergency switch, published in the terms: on sorts cases whose open reports all come from unproven sources
# after the others of their lane, never below a less severe lane. off, the default, orders by lane and age alone.
API_MODERATION_DEFER_UNPROVEN=off

# Public Turnstile site key baked into the web image. Cloudflare's always-pass test key for development;
# production uses the site key of the same widget as API_TURNSTILE_SECRET_KEY.
WEB_TURNSTILE_SITE_KEY=1x00000000000000000000AA

# development or production. It is the API's NODE_ENV (production refuses Turnstile test keys, plain-http
# origins and a relay without TLS) and a build argument of the web image (production refuses the
# Turnstile test site key). Set it to production before building the images for the public.
KORBAT_ENV=development
# on when cloudflared is the only way in: Caddy then keeps CF-Connecting-IP for the API (and
# API_TRUST_PROXY is cloudflare). off drops the header, so nobody on the network can claim an address.
TUNNEL=off
# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel. The
# tunnel has two public hostnames: the app's, pointing at http://caddy:8080, and the staff console's (the hostname of
# API_CONSOLE_ORIGIN), pointing at http://caddy:8090. Leave the HTTP Host Header setting of each empty, so the API sees
# the hostname the browser used.
TUNNEL_TOKEN=

# The development stack's host ports, read only by infra/compose.dev.yml. Set one when another container
# on this machine holds the default, and give apps/api/.env the same port. Defaults: 55432, 56379, 3000,
# 8080, 8090, 51025, 58025.
# DEV_PG_PORT=55432
# DEV_REDIS_PORT=56379
# DEV_API_PORT=3000
# DEV_CADDY_PORT=8080
# The staff console's port: API_CONSOLE_ORIGIN must name the same port on localhost (http://localhost:<port>).
# DEV_CONSOLE_PORT=8090
# DEV_SMTP_PORT=51025
# DEV_MAILPIT_PORT=58025
```

### Replace `infra/compose.yml` (whole file)

```yaml
name: korbat

x-logging: &logging
  driver: json-file
  options: { max-size: "20m", max-file: "5" }

x-node-common: &node-common
  restart: unless-stopped
  read_only: true
  tmpfs: ["/tmp"]
  security_opt: ["no-new-privileges:true"]
  logging: *logging

services:
  postgres:
    # PostgreSQL 18. From 18 on the image keeps the cluster under /var/lib/postgresql/<major>/docker, so
    # the volume is mounted one level up and a later major can pg_upgrade inside it. A cluster from the
    # earlier pgdata volume (PostgreSQL 16) is moved over by scripts/pg-major-upgrade.mjs.
    image: postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
    restart: unless-stopped
    logging: *logging
    mem_limit: 1g
    memswap_limit: 1g
    pids_limit: 256
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      KORBAT_MIGRATE_DB_PASSWORD: ${KORBAT_MIGRATE_DB_PASSWORD}
      KORBAT_API_DB_PASSWORD: ${KORBAT_API_DB_PASSWORD}
      KORBAT_AUTH_DB_PASSWORD: ${KORBAT_AUTH_DB_PASSWORD}
    volumes:
      - pgdata18:/var/lib/postgresql
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    # Valkey, the BSD-licensed fork of Redis, under the service name the URLs already use. A password
    # is required: nothing on the data network may read the session cache without it.
    image: valkey/valkey:9.1.2-alpine@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11
    restart: unless-stopped
    logging: *logging
    mem_limit: 384m
    memswap_limit: 384m
    pids_limit: 64
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?set REDIS_PASSWORD in infra/.env}
    command: ["sh", "-c", "exec valkey-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction --requirepass $$REDIS_PASSWORD"]
    volumes:
    # A fresh volume: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into `redisdata`, and that
    # volume held only transient state (limits, codes in flight, cached sessions, queued image jobs).
      - valkeydata:/data
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "VALKEYCLI_AUTH=$$REDIS_PASSWORD valkey-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 20

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
      # `staff.js enroll` runs here, as the migrator, the one role the running API never holds, and records on each link
      # the console's origin and relying party ID it is issued for. Empty, the console is off and enroll refuses.
      CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}
      CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}
    networks: [data]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
      args:
        KORBAT_VERSION: ${KORBAT_VERSION:-0.0.0}
    mem_limit: 512m
    memswap_limit: 512m
    pids_limit: 256
    environment:
      # development or production, from infra/.env; production turns on the guards against test keys, plain-http
      # origins and a relay without TLS. The worker below always runs as production.
      NODE_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
      PORT: "3000"
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      DATABASE_URL_API: postgres://korbat_api:${KORBAT_API_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      DATABASE_URL_AUTH: postgres://korbat_auth:${KORBAT_AUTH_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      TRUSTED_ORIGINS: ${API_TRUSTED_ORIGINS:-}
      # Which header names the client: the stack refuses to start without a choice.
      TRUST_PROXY: ${API_TRUST_PROXY:?set API_TRUST_PROXY in infra/.env}
      # Auth settings. The stack refuses to start while any of these is missing from infra/.env.
      APP_ORIGIN: ${API_APP_ORIGIN:?set API_APP_ORIGIN in infra/.env}
      AUTH_HMAC_KEY: ${API_AUTH_HMAC_KEY:?set API_AUTH_HMAC_KEY in infra/.env}
      IP_HASH_KEY: ${API_IP_HASH_KEY:?set API_IP_HASH_KEY in infra/.env}
      TOTP_ENC_KEY: ${API_TOTP_ENC_KEY:?set API_TOTP_ENC_KEY in infra/.env}
      TOTP_ENC_KEYS_PREVIOUS: ${API_TOTP_ENC_KEYS_PREVIOUS:-}
      # Encrypts a signed-out notifier's name and address; earlier keys stay accepted for decryption.
      NOTIFIER_ENC_KEY: ${API_NOTIFIER_ENC_KEY:?set API_NOTIFIER_ENC_KEY in infra/.env}
      NOTIFIER_ENC_KEYS_PREVIOUS: ${API_NOTIFIER_ENC_KEYS_PREVIOUS:-}
      TURNSTILE_SECRET_KEY: ${API_TURNSTILE_SECRET_KEY:?set API_TURNSTILE_SECRET_KEY in infra/.env}
      SMTP_URL: ${API_SMTP_URL:?set API_SMTP_URL in infra/.env}
      MAIL_FROM: ${API_MAIL_FROM:?set API_MAIL_FROM in infra/.env}
      TERMS_VERSION: ${API_TERMS_VERSION:?set API_TERMS_VERSION in infra/.env}
      # The verified badge's phone check. off (the default) hides the badge; vonage needs the two credentials.
      VERIFY_PROVIDER: ${API_VERIFY_PROVIDER:-off}
      VONAGE_API_KEY: ${API_VONAGE_API_KEY:-}
      VONAGE_API_SECRET: ${API_VONAGE_API_SECRET:-}
      VERIFY_BRAND: ${API_VERIFY_BRAND:-korbat}
      # Passkeys. Empty values leave the API's defaults: the host of APP_ORIGIN as the RP ID and korbat as the name.
      WEBAUTHN_RP_ID: ${API_WEBAUTHN_RP_ID:-}
      WEBAUTHN_RP_NAME: ${API_WEBAUTHN_RP_NAME:-}
      # The staff console, served by Caddy's second site: the origin staff open it at, and the RP ID staff keys are bound
      # to (empty means the console's hostname). An empty origin switches the console off: every /api/staff path then
      # answers 404. The migrate service gets the same two values for `staff.js enroll`.
      CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}
      CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}
      # Moderation: the UTC hour of the daily release of decisions to those who reported, and the queue's emergency switch.
      MODERATION_DISPATCH_HOUR: ${API_MODERATION_DISPATCH_HOUR:-7}
      MODERATION_DEFER_UNPROVEN: ${API_MODERATION_DEFER_UNPROVEN:-off}
      # Images. The API writes uploads and only reads what the worker stored.
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
      MEDIA_MIN_FREE_BYTES: ${MEDIA_MIN_FREE_BYTES:-2147483648}
      MEDIA_RECONCILE: ${MEDIA_RECONCILE:-on}
    volumes:
      - media-uploads:/media/uploads
      - media-store:/media/store:ro
    networks: [app, data]
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  # The image worker runs the decoder, the most exploitable code in the stack. It has no network at
  # all, no credentials and no capabilities: it reads uploads and writes the store, and that is
  # everything it can reach. The memory limit was sized on worst-case images (2b design, Research).
  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 768m
    memswap_limit: 768m
    cpus: 1.0
    pids_limit: 64
    tmpfs: ["/tmp:size=64m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
    volumes:
      - media-uploads:/media/uploads:ro
      - media-store:/media/store
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/media/store/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4

  # Caddy serves the web app on port 8080, proxying /api, and the staff console on port 8090, proxying only
  # /api/staff. It runs as its own user, sees only the API, and is the only thing cloudflared can reach.
  caddy:
    restart: unless-stopped
    read_only: true
    tmpfs: ["/tmp"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    mem_limit: 128m
    memswap_limit: 128m
    pids_limit: 64
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
      args:
        EXPO_PUBLIC_TURNSTILE_SITE_KEY: ${WEB_TURNSTILE_SITE_KEY:?set WEB_TURNSTILE_SITE_KEY in infra/.env}
        KORBAT_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
        TUNNEL: ${TUNNEL:-off}
        EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}
    depends_on:
      api: { condition: service_healthy }
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    networks: [edge, app]

  cloudflared:
    image: cloudflare/cloudflared:2026.9.1@sha256:b269e8abd07a5bf6f3f4be65d5050b2174eca89c56a0241a8ff32a16aec454e4
    restart: unless-stopped
    read_only: true
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    profiles: ["tunnel"]
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    networks: [edge]
    depends_on:
      - caddy

# cloudflared reaches only Caddy, Caddy reaches only the API, and the API alone reaches the data services.
networks:
  edge:
  app:
  data:

volumes:
  # PostgreSQL 18. The earlier pgdata volume (PostgreSQL 16) stays until scripts/pg-major-upgrade.mjs has
  # moved it and you remove it by hand.
  pgdata18:
  valkeydata:
  # Uploads wait here for the worker and are deleted once processed. Nothing in it needs a backup.
  media-uploads:
  # The images korbat serves. Back it up together with the database.
  media-store:
  # Caddy's state, owned by its own user; the earlier root-owned caddydata and caddyconfig volumes can go.
  caddy-data:
  caddy-config:
```

### Replace `packages/contracts/src/moderation.ts` (whole file)

```ts
import { z } from "zod";
import { Email, OpaqueId, TurnstileToken } from "./auth";
import { hex, sha256, sha256Bytes, sortedJson, utf8 } from "./canonical";
import { MediaId } from "./media";
import { FORBIDDEN_FORMAT } from "./text";

// Moderation cases (3c design, section 10): the constants and digests that the database, the API, the console, the app,
// the mails and the terms share. Each is the one source its words and numbers are taken from. This module imports
// nothing from staff.ts, and the index evaluates it first, so staff.ts can read these constants while it loads; an import
// the other way round would be a cycle that fails at load. For the same reason it imports nothing from social.ts, whose
// shapes may come to name this module's constants: what a notice needs of a post's id and of a handle is written here.

// ---------------------------------------------------------------- rules, categories and keywords

/** The rulebook's rule ids. @korbat/rules holds the rules themselves; the contracts never import it. */
export const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
export type RuleId = (typeof RULE_IDS)[number];

/**
 * The 16 categories of the Commission's Transparency Database (read 2026-10-02), which every intake and decision carries.
 * The migration's CHECK lists are written from this constant, and a database test holds them to it. A value the
 * Commission removes stays here: a kept row may hold it, and only the lists offered for new input drop it.
 */
export const TDB_CATEGORIES = [
  "STATEMENT_CATEGORY_ANIMAL_WELFARE",
  "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
  "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
  "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
  "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
  "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
  "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
  "STATEMENT_CATEGORY_SELF_HARM",
  "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
  "STATEMENT_CATEGORY_VIOLENCE",
] as const;
export type TdbCategory = (typeof TDB_CATEGORIES)[number];

/** The two categories a notifier never chooses: a rule-only report gets the first, a notifier who is not sure the second. */
type UnofferedCategory = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" | "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE";
export type TdbFormCategory = Exclude<TdbCategory, UnofferedCategory>;

/** The 14 categories the illegal-ground form shows. */
export const TDB_FORM_CATEGORIES: readonly TdbFormCategory[] = TDB_CATEGORIES.filter(
  (category): category is TdbFormCategory => category !== "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" && category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
);

/**
 * The four choices of the path for child sexual abuse material and the Transparency Database keyword each stores. "abuse"
 * stores none: the database has no keyword for it.
 */
export const CSAM_KEYWORDS = {
  csam: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
  deepfake: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE",
  grooming: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS",
  abuse: null,
} as const;
export type CsamKeywordChoice = keyof typeof CSAM_KEYWORDS;

/** The keywords a decision on the law may carry: in 3c only the Transparency Database's "Terrorist content". */
export const DECISION_KEYWORDS = ["KEYWORD_TERRORIST_CONTENT"] as const;
export type DecisionKeyword = (typeof DECISION_KEYWORDS)[number];

/** The category the composer presets for a decision under each rule. */
export const RULE_DEFAULT_CATEGORY = {
  R1: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  R2: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  R3: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  R4: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  R5: "STATEMENT_CATEGORY_VIOLENCE",
  R6: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
} as const satisfies Record<RuleId, TdbCategory>;

// ---------------------------------------------------------------- lanes

/** The queue's lanes: 0 is the most urgent. A case takes the most severe lane of its unanswered items. */
export type Lane = 0 | 1 | 2;

/** R2 and R5 are urgent; R3 and R4 come next; R1 and R6 last. */
const RULE_LANES: Record<RuleId, Lane> = { R1: 2, R2: 0, R3: 1, R4: 1, R5: 0, R6: 2 };

/** The categories that are not in lane 2: violence, public security and self-harm are urgent; six more come next. */
const CATEGORY_LANES: Partial<Record<TdbCategory, Lane>> = {
  STATEMENT_CATEGORY_VIOLENCE: 0,
  STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY: 0,
  STATEMENT_CATEGORY_SELF_HARM: 0,
  STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN: 1,
  STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH: 1,
  STATEMENT_CATEGORY_PROTECTION_OF_MINORS: 1,
  STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE: 1,
};

/**
 * The lane of an intake's items, from its ground alone: nothing is weighted. The CSAM path is urgent whatever else is
 * said. Otherwise it is the more severe of the cited rule's lane and, on a notice that alleges illegality, the category's:
 * only there is the category a claim about the content, where on a rule report or a finding it is korbat's own
 * classification for the Transparency Database.
 */
export function laneFor(input: { ruleId: RuleId | null; allegesIllegal: boolean; csam: boolean; category: TdbCategory }): Lane {
  if (input.csam) return 0;
  const byRule: Lane = input.ruleId === null ? 2 : RULE_LANES[input.ruleId];
  const byCategory: Lane = input.allegesIllegal ? (CATEGORY_LANES[input.category] ?? 2) : 2;
  return byRule < byCategory ? byRule : byCategory;
}

// ---------------------------------------------------------------- limits and periods

/**
 * What one sender may send, published in the terms: intakes an hour and a day per network signed out and per account
 * signed in, the targets one notice names, and the bounds of its two texts in characters (the migration's CHECKs hold
 * the same numbers).
 */
export const NOTICE_LIMITS = {
  signedOut: { perHour: 5, perDay: 20 },
  signedIn: { perHour: 10, perDay: 50 },
  maxTargets: 10,
  explanationMax: 2000,
  citedLawMax: 300,
} as const;

/** A notice on the CSAM path names at most one account: one such target reaches every image on the account's posts. */
export const CSAM_NOTICE_MAX_ACCOUNTS = 1;

/** How many months back a case page counts earlier answers to reports of this kind about the same target or author. */
export const SUSPECT_EARLIER_MONTHS = 12;

/** How many rows of a seal's list the case answer carries. */
export const SEAL_LIST_MAX = 500;

/** The author's appeal and the re-examination window, in calendar months (appealDeadline, and appeal_deadline in SQL). */
export const APPEAL_MONTHS = 6;

/** Appeals a day per account, and re-examinations a day per account or network. */
export const DAILY_LIMITS = { appeals: 5, reexaminations: 5 } as const;

/**
 * How long 3c keeps each kind of data (the design's section 6.6), published in the terms. Each is a design choice, not a
 * legal figure.
 */
export const RETENTION = {
  /** Content restricted under R4 is erased once the restriction is final: this long after its author was told, or at the answer to their appeal. */
  r4FinalMonths: APPEAL_MONTHS,
  /** An intake's record (its texts and who sent it) goes this long after its last release. */
  intakeDays: 30,
  /** A reset field's old value stays readable this long after a lift that comes before the case's copies are erased. */
  resetValueDays: 30,
  /** A case's evidence waits this long after the case's newest snapshot or draft text. */
  evidenceHours: 24,
  /** Statements are erased this long after the account's deletion. */
  statementMonths: 12,
  /** The access log, and the reveal reasons its rows name. */
  accessLogMonths: 12,
  /** A notifier's contact goes this long after the last day korbat owed the notice something, */
  contactMonths: 6,
  /** and at most this long after the notice when nothing moved that day. */
  contactMaxMonths: 13,
  /** A notifier's confirmation of an address. */
  confirmationDays: 30,
  /** Backups are deleted this long after each was taken. No code of 3c enforces it: the README tells the operator. */
  backupDays: 30,
  /** An unconfirmed staff text is deleted after this long. */
  draftHours: 24,
  /** A mail still unsent this long after it was due is given up. */
  mailGiveUpDays: 5,
} as const;

// ---------------------------------------------------------------- measures

/** The ledger's kinds, in the order of the database's action_kind: the seven measures, then the five reversals. */
export const ACTION_KINDS = [
  "withhold",
  "remove",
  "seal_media",
  "withhold_media",
  "remove_media",
  "reset_display_name",
  "reset_bio",
  "restore",
  "unseal_media",
  "restore_media",
  "restore_display_name",
  "restore_bio",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** What a measure acts on: a post, one image of it, every image its case reaches, or one of an account's two fields. */
export type MeasureTarget = "post" | "image" | "images" | "display_name" | "bio";

export interface MeasureSpec {
  /** A decision taken while deciding (interim) may hold it. */
  interim: boolean;
  /** A decision that decides the case (final) may hold it. */
  final: boolean;
  /** For a reversal, the measures it lifts (it names exactly one row of them); null for a measure. */
  lifts: readonly ActionKind[] | null;
  target: MeasureTarget;
  /** The words for it in the composer, the statement and the terms. */
  label: string;
}

/**
 * Every kind of the ledger: whether it is taken while deciding, when the case is decided, or is a reversal; its target;
 * and its label. A post or one image is withheld only while deciding and removed only when the case is decided; a seal
 * and a field reset are either. A reversal is neither: the database's triggers say which decision may hold one.
 */
export const MEASURES = {
  withhold: { interim: true, final: false, lifts: null, target: "post", label: "Withhold the post" },
  remove: { interim: false, final: true, lifts: null, target: "post", label: "Remove" },
  seal_media: { interim: true, final: true, lifts: null, target: "images", label: "Seal the images this case reaches" },
  withhold_media: { interim: true, final: false, lifts: null, target: "image", label: "Withhold one image" },
  remove_media: { interim: false, final: true, lifts: null, target: "image", label: "Remove one image" },
  reset_display_name: { interim: true, final: true, lifts: null, target: "display_name", label: "Reset display name" },
  reset_bio: { interim: true, final: true, lifts: null, target: "bio", label: "Reset bio" },
  restore: { interim: false, final: false, lifts: ["withhold", "remove"], target: "post", label: "Lift the restriction of the post" },
  unseal_media: { interim: false, final: false, lifts: ["seal_media"], target: "images", label: "Lift the seal" },
  restore_media: { interim: false, final: false, lifts: ["withhold_media", "remove_media"], target: "image", label: "Lift the restriction of one image" },
  restore_display_name: { interim: false, final: false, lifts: ["reset_display_name"], target: "display_name", label: "Lift the reset of the display name" },
  restore_bio: { interim: false, final: false, lifts: ["reset_bio"], target: "bio", label: "Lift the reset of the bio" },
} as const satisfies Record<ActionKind, MeasureSpec>;

/** One measure or reversal as a decision's confirmed params name it: its kind, and for an image measure the image. */
export interface DecisionActionParams {
  kind: ActionKind;
  mediaId: string | null;
}

/**
 * The one order a decision's actions are confirmed in: by kind and then by image, each compared as a string, an action
 * without an image first. The console sorts with it before it asks for the key, and the params' schema refuses any other
 * order, so the same decision always has the same hash.
 */
export function compareDecisionActions(a: DecisionActionParams, b: DecisionActionParams): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const [left, right] = [a.mediaId ?? "", b.mediaId ?? ""];
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Why a moderator reveals who sent a report: the choices of the reveal dialog. The reason itself is a saved text. */
export const REVEAL_REASON_CATEGORIES = ["impersonation_claim", "abuse_of_reporting", "legal_requirement", "other"] as const;
export type RevealReasonCategory = (typeof REVEAL_REASON_CATEGORIES)[number];

// ---------------------------------------------------------------- errors

/**
 * Every code the moderation flows put in ErrorEnvelope.error.code so far: what sending a report or a notice, reading its
 * status, taking it in and deciding a case raise. The routes may also answer the shared invalid_request,
 * onboarding_required, not_found, rate_limited and service_unavailable, and the staff routes the staff codes. The codes
 * the database keeps to itself (moderation_column, quote_item_missing, read_committed_only) are not among them: no route
 * answers one.
 */
export const ModerationErrorCode = z.enum([
  "notice_link_invalid",
  "notice_link_offsite",
  "human_check_failed",
  "staff_cannot_report",
  "notice_not_found",
  "already_reported",
  "case_changed",
  "case_closed",
  "staff_recused",
  "staff_target",
  "admin_required",
  "decision_cap",
  "profile_changed",
  "snapshot_mismatch",
  "snapshot_erased",
  "text_not_found",
  "invalid_decision",
]);
export type ModerationErrorCode = z.infer<typeof ModerationErrorCode>;

// ---------------------------------------------------------------- reports and notices

/**
 * The rules a report or a notice may cite. R2 is offered nowhere: a report of child sexual abuse material goes a path of
 * its own, which records no sender, and only a moderator's finding cites R2 (the database refuses a user's intake that
 * does).
 */
export const REPORT_RULE_IDS = ["R1", "R3", "R4", "R5", "R6"] as const satisfies readonly RuleId[];
export type ReportRuleId = (typeof REPORT_RULE_IDS)[number];

/** How many characters the name a signed-out notifier gives may have. */
export const NOTICE_NAME_MAX = 100;

/** Any control character but the line feed. */
const TEXT_CONTROL = /[^\P{Cc}\n]/u;
/** Any control character at all: a name is one line. */
const LINE_CONTROL = /\p{Cc}/u;

const NOT_WELL_FORMED = { message: "half of a surrogate pair is not text" };
const NO_CONTROL = { message: "control characters are not allowed" };
const NO_FORMAT = { message: "invisible direction and spacing characters are not allowed" };
const SOME_TEXT = { message: "some text is needed" };

/**
 * A free text of a notice. The server stores it as it was written or refuses it, and never changes it: a well-formed
 * string with some text in it, no control character but the line feed, none of the invisible direction and spacing
 * characters, and at most `max` characters as PostgreSQL's char_length counts them, which is what the tables' CHECKs hold.
 */
const noticeText = (max: number) =>
  z
    .string()
    // A character outside the basic plane is two UTF-16 units, so this bound never refuses what the count below accepts.
    .max(2 * max)
    .refine(isWellFormed, NOT_WELL_FORMED)
    .refine((text) => !TEXT_CONTROL.test(text), NO_CONTROL)
    .refine((text) => !FORBIDDEN_FORMAT.test(text), NO_FORMAT)
    .refine((text) => text.trim().length > 0, SOME_TEXT)
    .refine((text) => Array.from(text).length <= max, { message: `at most ${max} characters` });

/** The name a signed-out notifier may give: one line under the same rules. */
const NotifierName = z
  .string()
  .max(2 * NOTICE_NAME_MAX)
  .refine(isWellFormed, NOT_WELL_FORMED)
  .refine((name) => !LINE_CONTROL.test(name), NO_CONTROL)
  .refine((name) => !FORBIDDEN_FORMAT.test(name), NO_FORMAT)
  .refine((name) => name.trim().length > 0, SOME_TEXT)
  .refine((name) => Array.from(name).length <= NOTICE_NAME_MAX, { message: `at most ${NOTICE_NAME_MAX} characters` });

/** A post's id in the lower case PostgreSQL returns, so an id written in any case names the same row. */
const TargetPostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle as a notice names it: an optional leading @, then the 3 to 20 characters handles may contain, kept in lower case. */
const TargetHandle = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

/**
 * A link as a notice gives it: an http or https address of at most 300 characters, kept as written. Whether it is an
 * address of this korbat, and of what, the route decides.
 */
const TargetLink = z.url({ protocol: /^https?$/ }).max(300);

/**
 * What a report or a notice names: a post by its id, optionally with the one of its images that is meant; an account by
 * its handle; or a korbat link, which the server parses. Nothing else can be named, and nothing can be attached.
 */
export const NoticeTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("post"), id: TargetPostId, mediaId: MediaId.optional() }),
  z.strictObject({ kind: z.literal("account"), handle: TargetHandle }),
  z.strictObject({ kind: z.literal("link"), url: TargetLink }),
]);
export type NoticeTarget = z.infer<typeof NoticeTarget>;

const NoticeTargets = z.array(NoticeTarget).min(1).max(NOTICE_LIMITS.maxTargets);
const ReportRule = z.enum(REPORT_RULE_IDS);

/** The categories an illegal-ground notice may carry: the 14 the form shows, and "not specified" for someone who is not sure. */
const NoticeCategory = z.enum([...TDB_FORM_CATEGORIES, "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"] as const);

/** The four choices of the path for child sexual abuse material. */
const CsamChoice = z.enum(Object.keys(CSAM_KEYWORDS) as [CsamKeywordChoice, ...CsamKeywordChoice[]]);

/**
 * One report or notice, by its ground. Each ground is a strict shape, so a member that belongs to another ground is
 * refused rather than ignored:
 *   - `rule`: it breaks a korbat rule (any but R2), with an optional explanation;
 *   - `illegal`: an Art. 16 notice that it is illegal, with the category, the explanation and the statement of good
 *     faith the Article asks for, optionally the law, a rule it also breaks and, from someone signed out, a name and an
 *     address (a signed-in sender's contact is their account, and the route refuses either from them);
 *   - `csam`: the path for child sexual abuse material, which asks no name or address and records no sender; its
 *     explanation and statement are optional, and it names at most CSAM_NOTICE_MAX_ACCOUNTS accounts, counted by the
 *     handles as named (the route counts again once the links are parsed).
 * `turnstileToken` is the human check of a signed-out sender; a signed-in sender's is ignored.
 */
export const NoticeRequest = z.discriminatedUnion("ground", [
  z.strictObject({
    ground: z.literal("rule"),
    ruleId: ReportRule,
    targets: NoticeTargets,
    explanation: noticeText(NOTICE_LIMITS.explanationMax).optional(),
    turnstileToken: TurnstileToken.optional(),
  }),
  z.strictObject({
    ground: z.literal("illegal"),
    targets: NoticeTargets,
    category: NoticeCategory,
    citedLaw: noticeText(NOTICE_LIMITS.citedLawMax).optional(),
    explanation: noticeText(NOTICE_LIMITS.explanationMax),
    bonaFide: z.literal(true),
    ruleId: ReportRule.optional(),
    name: NotifierName.optional(),
    email: Email.optional(),
    turnstileToken: TurnstileToken.optional(),
  }),
  z
    .strictObject({
      ground: z.literal("csam"),
      targets: NoticeTargets,
      keyword: CsamChoice,
      explanation: noticeText(NOTICE_LIMITS.explanationMax).optional(),
      bonaFide: z.boolean().optional(),
      turnstileToken: TurnstileToken.optional(),
    })
    .refine((notice) => new Set(notice.targets.flatMap((target) => (target.kind === "account" ? [target.handle] : []))).size <= CSAM_NOTICE_MAX_ACCOUNTS, {
      message: `a notice of this kind names at most ${CSAM_NOTICE_MAX_ACCOUNTS} account`,
      path: ["targets"],
    }),
]);
export type NoticeRequest = z.infer<typeof NoticeRequest>;

/** A notice's public reference: N- and ten base32 characters. */
export const NoticeRef = z.string().regex(/^N-[A-Z2-7]{10}$/);

/**
 * The answer to a report or a notice. The token comes only with a notice sent signed out or on the path for child sexual
 * abuse material: it opens the status page, and is shown once.
 */
export const NoticeResponse = z.object({ ref: NoticeRef, token: OpaqueId.optional() });
export type NoticeResponse = z.infer<typeof NoticeResponse>;

/** What the status page sends: the reference with the notice's own token, or with the token of a mail's link. */
export const NoticeStatusRequest = z.strictObject({ ref: NoticeRef, token: OpaqueId });
export type NoticeStatusRequest = z.infer<typeof NoticeStatusRequest>;

/** The page's two buttons, for which only the token of a mail's link works: "I sent this", or "stop korbat's mails about reports to this address". */
export const NoticeContactRequest = z.strictObject({ ref: NoticeRef, token: OpaqueId, choice: z.enum(["confirm", "stop"]) });
export type NoticeContactRequest = z.infer<typeof NoticeContactRequest>;

/** What an item's sender can be shown, as the database's item_outcome lists them. */
export const ITEM_OUTCOMES = ["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"] as const;
export const ItemOutcome = z.enum(ITEM_OUTCOMES);
export type ItemOutcome = z.infer<typeof ItemOutcome>;

/**
 * One item of a notice as its sender reads it. `link` is the item's korbat address, an account's built from the handle
 * as the notice named it and never from the handle the profile holds now. `scope` says what the answer concerns
 * (`account`, `quote`, `account_suspect`, or null). An item about an account carries its scope from the first moment,
 * whatever the handle named: `account_suspect` when the item is suspect or, once released, when its answering decision
 * sealed images, and `account` otherwise. `quote`, for a post that quotes another, comes only with the released outcome,
 * so that before the release nothing tells a live target from a link that names nothing. The page and the app add the
 * scope's sentence after every outcome but `not_available`. `quotedBy` is the position of the item this one was added for,
 * when korbat added it for a quoted post. `outcome` and `decidedOn` (a UTC day) stay null until the outcome is released,
 * and `sealed`, `unseen` and `reexamination` say nothing before that either: `sealed` that the answering decision sealed
 * images, `unseen` that it was taken while nobody could open the post's images, `reexamination` whether a re-examination
 * can still be asked for and until when (null for an item that cannot be re-examined). `changed` marks an outcome that a
 * review or a correction changed, `reexamines` the item of a re-examination.
 */
export const NoticeItemStatus = z.object({
  position: z.number().int().min(1).max(20),
  link: z.string(),
  scope: z.enum(["account", "quote", "account_suspect"]).nullable(),
  suspect: z.boolean(),
  sealed: z.boolean(),
  unseen: z.boolean(),
  quotedBy: z.number().int().min(1).max(10).nullable(),
  outcome: ItemOutcome.nullable(),
  decidedOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).nullable(),
  changed: z.boolean(),
  reexamines: z.boolean(),
  reexamination: z.object({ open: z.boolean(), until: z.string() }).nullable(),
});
export type NoticeItemStatus = z.infer<typeof NoticeItemStatus>;

/**
 * The status page's answer. `items` holds the items the notice named, by position, and an item korbat added for a
 * quoted post directly after the item it was added for, from the first release that shows that item's outcome or its
 * own: listed earlier, it would tell that the named post exists. `contact` is null for a notice that left no name or
 * address; `confirmed` and `stopped` are null unless the request carried the token of a mail's link, so the answer to
 * whoever typed an address never depends on what korbat knows about that address.
 */
export const NoticeStatus = z.object({
  ref: NoticeRef,
  receivedAt: z.string(),
  items: z.array(NoticeItemStatus),
  contact: z.object({ given: z.boolean(), confirmed: z.boolean().nullable(), stopped: z.boolean().nullable() }).nullable(),
});
export type NoticeStatus = z.infer<typeof NoticeStatus>;

// ---------------------------------------------------------------- digests

/** Names the rule a text's digest is made by; a later rule gets a later tag. */
export const TEXT_DIGEST_TAG = "korbat.text.v1";

const SALT_HEX = /^[0-9a-f]{64}$/;

/** Whether every surrogate in the text is half of a pair: only then has it UTF-8 bytes. */
function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * The salted digest of a free text (a staff text, a statement): the lower-case hex sha256 of the tag's bytes, a line
 * feed, the salt's 32 bytes and the text's UTF-8 bytes. The API, the console and text-verify call it, and the database's
 * CHECKs compute the same, so a stored text is always the one its digest names. The salt keeps a short text from being
 * confirmed by hashing guesses. A malformed salt or text is refused, never changed: TextEncoder would otherwise hash a
 * lone surrogate as another character.
 */
export async function textDigest(saltHex: string, text: string): Promise<string> {
  if (!SALT_HEX.test(saltHex)) throw new TypeError("a text digest's salt is 32 bytes as 64 lower-case hex characters");
  if (!isWellFormed(text)) throw new TypeError("a text digest is taken over a well-formed text: a lone surrogate has no UTF-8 bytes");
  const tag = utf8(TEXT_DIGEST_TAG);
  const body = utf8(text);
  const bytes = new Uint8Array(tag.length + 1 + 32 + body.length);
  bytes.set(tag, 0);
  bytes[tag.length] = 0x0a;
  for (let i = 0; i < 32; i++) bytes[tag.length + 1 + i] = Number.parseInt(saltHex.slice(2 * i, 2 * i + 2), 16);
  bytes.set(body, tag.length + 33);
  return hex(await sha256Bytes(bytes));
}

/** Names the rule a snapshot's digest is made by. */
export const SNAPSHOT_DIGEST_TAG = "korbat.snapshot.v1";

/**
 * What a snapshot's digest covers: its salt and everything it copied. A post's snapshot leaves the three profile fields
 * null, an account's the post's. Each image is its id, alt text and size, in position order; an alt text is null for an
 * image whose content was erased.
 */
export interface SnapshotDigestInput {
  salt: string;
  targetType: "post" | "account";
  targetId: string;
  /** When the snapshot was taken, as Date.prototype.toISOString writes it. */
  takenAt: string;
  authorHandle: string;
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | null;
  /** As Date.prototype.toISOString writes it. */
  postCreatedAt: string | null;
  replyToId: string | null;
  quoteOfId: string | null;
  body: string | null;
  media: { id: string; alt: string | null; width: number; height: number }[] | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
}

/** A time as toISOString writes it: UTC, to the millisecond. Any other spelling of the same instant would hash differently. */
const ISO_MILLIS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/;

function isoTime(name: string, value: string): string {
  if (!ISO_MILLIS.test(value)) throw new TypeError(`a snapshot's ${name} is a UTC time to the millisecond, as toISOString writes it`);
  return value;
}

/**
 * The text a snapshot's digest is taken over: the sorted JSON of version 1 and the snapshot's members, each picked by
 * name, so that whatever else an answer carries, and in whatever order, the API and the console write the same text.
 */
export function snapshotText(snapshot: SnapshotDigestInput): string {
  return sortedJson({
    v: 1,
    salt: snapshot.salt,
    targetType: snapshot.targetType,
    targetId: snapshot.targetId,
    takenAt: isoTime("takenAt", snapshot.takenAt),
    authorHandle: snapshot.authorHandle,
    postState: snapshot.postState,
    postCreatedAt: snapshot.postCreatedAt === null ? null : isoTime("postCreatedAt", snapshot.postCreatedAt),
    replyToId: snapshot.replyToId,
    quoteOfId: snapshot.quoteOfId,
    body: snapshot.body,
    media: snapshot.media === null ? null : snapshot.media.map((image) => ({ id: image.id, alt: image.alt, width: image.width, height: image.height })),
    displayName: snapshot.displayName,
    bio: snapshot.bio,
    handle: snapshot.handle,
  });
}

/** A snapshot's digest: the lower-case hex sha256 of the tag, a line feed and snapshotText, in UTF-8. */
export async function snapshotDigest(snapshot: SnapshotDigestInput): Promise<string> {
  return hex(await sha256(`${SNAPSHOT_DIGEST_TAG}\n${snapshotText(snapshot)}`));
}

/**
 * The end of the author's appeal window and of the re-examination window: APPEAL_MONTHS calendar months after the person
 * was told, in UTC, at the same time of day. A day the target month lacks becomes that month's last day (31 August gives
 * the end of February). PostgreSQL's appeal_deadline computes the same; a test holds the two equal over every month end.
 */
export function appealDeadline(informedAt: Date): Date {
  const year = informedAt.getUTCFullYear();
  const month = informedAt.getUTCMonth() + APPEAL_MONTHS;
  // Day 0 of the month after the target month is the target month's last day; Date.UTC carries a month past 11 into the year.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(informedAt.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, informedAt.getUTCHours(), informedAt.getUTCMinutes(), informedAt.getUTCSeconds(), informedAt.getUTCMilliseconds()));
}
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  18 passed (18)
packages/db test:       Tests  60 passed (60)
packages/contracts test:       Tests  226 passed (226)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  120 passed (120)
apps/admin test:       Tests  228 passed (228)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  635 passed | 860 skipped (1495)
```

## Step 6: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `No schema changes`

Observed on the dry run:

```text
No schema changes, nothing to migrate 😴
```

## Step 7: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && echo count=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations')
```

Expected output contains:

- `migrations applied`
- `count=17`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=17
```

## Step 8: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 9: verify: test-database-fresh

```bash
node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `test database ready: korbat_test`

Observed on the dry run:

```text
test database ready: korbat_test
```

## Step 10: verify: integration-fresh

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  855 passed | 3 skipped (858)
```

## Step 11: verify: test-database-upgrade

```bash
node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations up to 0013_forget_revoked_staff_keys applied and committed`
- `later migrations applied as one batch`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations up to 0013_forget_revoked_staff_keys applied and committed
later migrations applied as one batch
test database ready: korbat_test
```

## Step 12: verify: integration-upgraded

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  855 passed | 3 skipped (858)
```

## Step 13: verify: timing

```bash
cd apps/api && set -a && . ./.env && set +a && ok=0; for i in 1 2 3 4 5 6 7 8 9 10; do node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/integration/http-timing.test.ts test/integration/auth-flows-mfa.test.ts -t '(differ by less than 50 ms|sign-in timing does not reveal)' > ../../.data/timing-gate.log 2>&1 && { ok=1; break; }; sleep 45; done; tail -6 ../../.data/timing-gate.log; echo timing-ok=$ok attempts=$i
```

Expected output contains:

- `timing-ok=1`

Observed on the dry run:

```text
timing-ok=1 attempts=1
```

## Step 14: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && node --check apps/api/dist/staff.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 15: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/.env.example`
- `apps/api/src/app.ts`
- `apps/api/src/auth/client-ip.ts`
- `apps/api/src/auth/context.ts`
- `apps/api/src/auth/flows/notifiers.ts`
- `apps/api/src/auth/identifiers.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/janitor.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/config.ts`
- `apps/api/src/env.ts`
- `apps/api/src/index.ts`
- `apps/api/src/mail/mailer.ts`
- `apps/api/src/mail/smtp.ts`
- `apps/api/src/mail/templates.ts`
- `apps/api/src/moderation/alerts.ts`
- `apps/api/src/moderation/context.ts`
- `apps/api/src/moderation/index.ts`
- `apps/api/src/moderation/intake.ts`
- `apps/api/src/moderation/links.ts`
- `apps/api/src/moderation/repo.ts`
- `apps/api/src/moderation/routes.ts`
- `apps/api/test/app.test.ts`
- `apps/api/test/architecture.test.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/auth/identifiers.test.ts`
- `apps/api/test/auth/verify-config.test.ts`
- `apps/api/test/config.test.ts`
- `apps/api/test/integration/auth-janitor.test.ts`
- `apps/api/test/integration/auth-notifiers.test.ts`
- `apps/api/test/integration/flow-harness.ts`
- `apps/api/test/integration/http-notices.test.ts`
- `apps/api/test/integration/http-staff-decisions.test.ts`
- `apps/api/test/integration/http-staff-enroll.test.ts`
- `apps/api/test/integration/http-staff-sessions.test.ts`
- `apps/api/test/integration/moderation-decide.ts`
- `apps/api/test/integration/moderation-fixtures.ts`
- `apps/api/test/integration/moderation-notices.test.ts`
- `apps/api/test/integration/notices-harness.ts`
- `apps/api/test/mail/smtp.test.ts`
- `apps/api/test/mail/templates.test.ts`
- `apps/api/test/middleware.test.ts`
- `apps/api/test/moderation-alerts.test.ts`
- `apps/api/test/moderation-context.test.ts`
- `apps/api/test/moderation-links.test.ts`
- `apps/api/test/moderation-notice-limits.test.ts`
- `apps/api/test/staff/app-mount.test.ts`
- `apps/api/test/staff/route-table.test.ts`
- `infra/.env.example`
- `infra/compose.yml`
- `packages/contracts/src/moderation.ts`
- `packages/contracts/test/moderation.test.ts`
- `packages/contracts/test/notices.test.ts`

## Step 16: commit

```bash
git add -A
git commit -q -m "feat(api,infra): reports and notices: POST /api/notices takes a report on a rule or a notice of illegality from anyone, signed in or not (a human check and limits by network when signed out), about up to ten posts or profiles of this korbat; a target is live by one rule, and on the path for child sexual abuse material by its row alone, an account also under a handle it has left; such a notice names at most one account, counted by the handles as named; a link that names nothing is stored as an item with no case; the status page (POST /api/notices/status) answers by reference and token with each item's link as it was named, never a later handle, and /api/notices/contact confirms or stops the notifier's mail; a signed-out notifier's name and address are kept encrypted in the auth schema under NOTIFIER_ENC_KEY and never shown to staff; the receipt notice_received and the urgent alert moderation_urgent are sent after the commit; the mailer tells a refused recipient from an unavailable relay and bounds each send in time; the auth janitor purges forgotten contacts and expired confirmations, each purge in a try of its own; MODERATION_DISPATCH_HOUR and MODERATION_DEFER_UNPROVEN join the configuration" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,infra): reports and notices: POST /api/notices takes a report on a rule or a notice of illegality from anyone, signed in or not (a human check and limits by network when signed out), about up to ten posts or profiles of this korbat; a target is live by one rule, and on the path for child sexual abuse material by its row alone, an account also under a handle it has left; such a notice names at most one account, counted by the handles as named; a link that names nothing is stored as an item with no case; the status page (POST /api/notices/status) answers by reference and token with each item's link as it was named, never a later handle, and /api/notices/contact confirms or stops the notifier's mail; a signed-out notifier's name and address are kept encrypted in the auth schema under NOTIFIER_ENC_KEY and never shown to staff; the receipt notice_received and the urgent alert moderation_urgent are sent after the commit; the mailer tells a refused recipient from an unavailable relay and bounds each send in time; the auth janitor purges forgotten contacts and expired confirmations, each purge in a try of its own; MODERATION_DISPATCH_HOUR and MODERATION_DEFER_UNPROVEN join the configuration`.

## Report format (mandatory)

```text
TASK 4 REPORT
Files written: <count, expected 53>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "test-database-fresh": <paste the expected lines as printed>
Verify "integration-fresh": <paste the expected lines as printed>
Verify "test-database-upgrade": <paste the expected lines as printed>
Verify "integration-upgraded": <paste the expected lines as printed>
Verify "timing": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
