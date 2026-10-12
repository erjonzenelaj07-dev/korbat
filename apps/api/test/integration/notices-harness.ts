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
import { MailRefused, MailUnavailable, type FlatMailMessage, type MailMessage, type Mailer, type NoticeUpdateMessage } from "../../src/mail/mailer";
import { renderMail } from "../../src/mail/templates";
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
  /** The flat messages delivered, and, apart from them, the structured daily updates delivered: each in order. */
  readonly sent: FlatMailMessage[] = [];
  readonly updates: NoticeUpdateMessage[] = [];
  mode: "deliver" | "refuse" | "fail" | "hang" = "deliver";
  private waiting = gate();

  async send(message: MailMessage): Promise<void> {
    // As the real mailer does first: a message whose data its template lacks is a programming error.
    renderMail(message);
    this.attempts.push(message);
    if (this.mode === "hang") await this.waiting.opened;
    if (this.mode === "refuse") throw new MailRefused("the relay refused the recipient");
    if (this.mode === "fail") throw new MailUnavailable("the relay could not be reached");
    if (message.template === "notice_update") this.updates.push(message);
    else this.sent.push(message);
  }

  /** Lets every hanging send end, as `mode` now says. */
  release(mode: "deliver" | "refuse" | "fail" = "deliver"): void {
    this.mode = mode;
    this.waiting.open();
    this.waiting = gate();
  }

  to(address: string, template?: string): FlatMailMessage[] {
    return this.sent.filter((message) => message.to === address && (template === undefined || message.template === template));
  }

  /** The daily updates delivered to this address, in order. */
  updatesTo(address: string): NoticeUpdateMessage[] {
    return this.updates.filter((message) => message.to === address);
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
