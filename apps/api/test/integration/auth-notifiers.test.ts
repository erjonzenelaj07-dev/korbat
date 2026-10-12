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
