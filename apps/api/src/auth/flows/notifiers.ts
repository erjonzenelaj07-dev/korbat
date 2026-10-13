import { RETENTION } from "@korbat/contracts";
import { MailRefused, type MailMessage, type NoticeUpdateLine } from "../../mail/mailer";
import type { DecisionMailSubject } from "../../mail/templates";
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

/** The daily update of decisions on the reports an account sent: its lines, as the moderation module composed them. */
export interface AccountUpdateMessage {
  template: "notice_update";
  lines: readonly NoticeUpdateLine[];
}

/**
 * The statement of reasons to the author of what a decision restricts or lifts: the subject by its key, and the
 * statement's paragraphs exactly as they were rendered for the author's screen. 3e (design, sections 7.15 and 18, W.6):
 * a suspension or termination taken at once, and the lift of one (or its end when a reversal broke its basis), are
 * mailed under a subject and a lead of their own, with the same paragraphs; the moderation module picks the template
 * (mailTemplateOf). Times are instants, printed here as the notices print them.
 */
export type DecisionMessage =
  | { template: "moderation_decision"; subject: DecisionMailSubject; paragraphs: readonly string[] }
  | { template: "suspension_started_at_once"; measure: "suspend" | "terminate"; days: number | null; endsAt: string | null; paragraphs: readonly string[] }
  | { template: "suspension_lifted"; measure: "suspend" | "terminate"; why: "lifted" | "basis"; period: "not_started" | "running" | "ended"; paragraphs: readonly string[] };

/** What the statement's paragraphs are joined with in a mail's data: one paragraph per line. */
const LINE_BREAK = String.fromCharCode(10);

/** A decision's message as its template's flat data: one data value for the statement, one paragraph per line, exactly as it was rendered. */
function decisionData(message: DecisionMessage): Record<string, string> {
  const statement = message.paragraphs.join(LINE_BREAK);
  switch (message.template) {
    case "moderation_decision":
      return { subject: message.subject, statement };
    case "suspension_started_at_once":
      return { measure: message.measure, statement, ...(message.days === null ? {} : { days: String(message.days) }), ...(message.endsAt === null ? {} : { endsAt: noticeTime(new Date(message.endsAt)) }) };
    case "suspension_lifted":
      return { measure: message.measure, why: message.why, period: message.period, statement };
  }
}

/** What may be sent to a signed-out notifier's contact by itself: the receipt. Its updates go by address, through mailNotifierUpdates. */
export type NotifierMessage = NoticeReceivedMessage;
/** What may be sent to an account: the receipt and the daily update of its reports, and the statement of a decision about it. */
export type AccountMessage = NoticeReceivedMessage | AccountUpdateMessage | DecisionMessage;

/** One contact's share of the daily update: the lines of its notice, and its receipt when the 24-hour cap folded it. */
export interface NotifierUpdatePart {
  contactId: string;
  /** The reference of the contact's notice. */
  ref: string;
  lines: readonly NoticeUpdateLine[];
  receipt?: { ref: string; receivedAt: Date; items: readonly string[] };
}

/** What became of one contact's share: as a mail's result, or "unavailable" when the relay could not take that address's mail or the contact could not be read. */
export type NotifierUpdateResult = "sent" | "suppressed" | "no_address" | "forgotten" | "refused" | "unavailable";

/**
 * The staff alerts: counts, times and a staff account's public handle, never a link or content. The urgent lane's alert;
 * the cases that wait longer than their lane's response time, and those that hold a measure taken while deciding for
 * more than a day; the staff account that confirmed many decisions in a short time; the one that reached its daily case
 * limit; every reveal of who sent a report, with the day's count; and every decision that lifted the protection of
 * images reported as child sexual abuse material.
 */
export type StaffMessage =
  | { template: "moderation_urgent"; count: number; oldest: Date }
  | { template: "moderation_waiting"; lanes: readonly { lane: 0 | 1 | 2; count: number; oldest: Date }[]; interim: number }
  | { template: "moderation_burst"; handle: string; count: number }
  | { template: "moderation_reads"; handle: string; limit: number }
  | { template: "moderation_reveal"; handle: string; at: Date; count: number; limit: number }
  | { template: "moderation_csam_lifted"; handle: string; at: Date; what: "unsealed" | "dismissed" };

/** A staff alert's template data: every member as the text the template prints. */
function staffData(message: StaffMessage): Record<string, string> {
  switch (message.template) {
    case "moderation_urgent":
      return { count: String(message.count), oldest: noticeTime(message.oldest) };
    case "moderation_waiting": {
      // A lane's pair only for a lane with a case past its time, and the measures' count only when it is not 0.
      const data: Record<string, string> = {};
      for (const lane of message.lanes) {
        if (lane.count <= 0) continue;
        data[`lane${lane.lane}Count`] = String(lane.count);
        data[`lane${lane.lane}Oldest`] = noticeTime(lane.oldest);
      }
      if (message.interim > 0) data.interimCount = String(message.interim);
      return data;
    }
    case "moderation_burst":
      return { handle: message.handle, count: String(message.count) };
    case "moderation_csam_lifted":
      return { handle: message.handle, time: noticeTime(message.at), what: message.what };
    case "moderation_reads":
      return { handle: message.handle, limit: String(message.limit) };
    case "moderation_reveal":
      return { handle: message.handle, time: noticeTime(message.at), count: String(message.count), limit: String(message.limit) };
  }
}

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
const open = (deps: Pick<AuthDeps, "config">, payload: string): string => decrypt(payload, [deps.config.notifierKey, ...deps.config.notifierPreviousKeys]).toString("utf8");
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
 * Sends a mail to an account's own address, which its sign-in code confirmed: no cap and no confirmation. A stop of
 * that address applies to the two report mails, the receipt and the daily update, and never to a statement of reasons.
 * The update of an account is signed in: it carries its lines and neither a receipt nor a page link, since an account
 * follows its reports in the app. "no_address" for an account that is deleted or was never there.
 */
export async function mailAccount(deps: AuthDeps, userId: string, message: AccountMessage): Promise<AccountMailResult> {
  const user = await deps.repo.findUserById(userId);
  if (!user) return "no_address";
  if (message.template === "moderation_decision" || message.template === "suspension_started_at_once" || message.template === "suspension_lifted") {
    // A statement is never held back by a stop of the address.
    return deliver(deps, { to: user.email, template: message.template, data: decisionData(message) });
  }
  const hash = emailHash(deps.config.authHmacKey, user.email);
  if ((await deps.repo.suppressedNotifierHashes([hash])).has(hash)) return "suppressed";
  if (message.template === "notice_update") return deliver(deps, { to: user.email, template: "notice_update", data: { signedIn: true, lines: [...message.lines], receipts: [], pages: [] } });
  return deliver(deps, { to: user.email, template: "notice_received", data: receiptData(deps, message) });
}

/**
 * The daily update to signed-out notifiers (3c design, sections 5 and 7.8): the parts are grouped by their contacts'
 * address, which only this module can see, and each address gets one notice_update with every part's lines, every
 * carried receipt with its page link, and the page link of each other notice it has a line for. A page link is the
 * status page's address with that contact's own mail token in the fragment, the same link its receipt carried.
 *
 * It applies a stop of the address, and neither the confirmation nor the 24-hour cap: nothing is withheld for want of a
 * confirmed address. It answers for each contact, and throws for none: an address whose mail the relay could not take is
 * "unavailable", so its lines stay pending while every other address's update is still sent. Each contact is read in a
 * try of its own: one that cannot be read (a ciphertext no configured key opens) is logged with its id, never an
 * address, and answered "unavailable" too.
 */
export async function mailNotifierUpdates(deps: AuthDeps, parts: readonly NotifierUpdatePart[]): Promise<Map<string, NotifierUpdateResult>> {
  const results = new Map<string, NotifierUpdateResult>();
  /** The readable parts, by their address's keyed hash, in the order given. */
  const byAddress = new Map<string, { to: string; parts: { part: NotifierUpdatePart; pageUrl: string }[] }>();
  for (const part of parts) {
    try {
      const contact = await deps.repo.findNotifierContact(part.contactId);
      if (!contact) {
        results.set(part.contactId, "forgotten");
        continue;
      }
      if (!contact.emailEnc || !contact.emailHash || !contact.mailTokenEnc) {
        results.set(part.contactId, "no_address");
        continue;
      }
      if ((await deps.repo.suppressedNotifierHashes([contact.emailHash])).has(contact.emailHash)) {
        results.set(part.contactId, "suppressed");
        continue;
      }
      const to = open(deps, contact.emailEnc);
      const pageUrl = `${deps.config.appOrigin}/notice/${part.ref}#t=${open(deps, contact.mailTokenEnc)}`;
      const group = byAddress.get(contact.emailHash) ?? { to, parts: [] };
      group.parts.push({ part, pageUrl });
      byAddress.set(contact.emailHash, group);
    } catch (err) {
      deps.log.error({ err, contactId: part.contactId }, "notifier update: the contact could not be read; its lines stay pending");
      results.set(part.contactId, "unavailable");
    }
  }
  for (const group of byAddress.values()) {
    const receipts = group.parts.flatMap(({ part, pageUrl }) => (part.receipt ? [{ ref: part.receipt.ref, time: noticeTime(part.receipt.receivedAt), items: part.receipt.items.join(", "), pageUrl }] : []));
    // A notice whose receipt rides in this update has its page with the receipt; every other notice with a line gets a page paragraph.
    const pages = group.parts.flatMap(({ part, pageUrl }) => (part.receipt || part.lines.length === 0 ? [] : [{ ref: part.ref, pageUrl }]));
    const lines = group.parts.flatMap(({ part }) => [...part.lines]);
    let result: NotifierUpdateResult;
    try {
      result = await deliver(deps, {
        to: group.to,
        template: "notice_update",
        data: { signedIn: false, lines, receipts, pages, ...(receipts.length > 0 ? { termsUrl: `${deps.config.appOrigin}/terms` } : {}) },
      });
    } catch (err) {
      // The relay could not take this address's mail: the other addresses' mails still go. The contacts' ids, never the address.
      deps.log.warn({ err, contactIds: group.parts.map(({ part }) => part.contactId) }, "notifier update: not sent; its lines stay pending for the next round");
      result = "unavailable";
    }
    for (const { part } of group.parts) results.set(part.contactId, result);
  }
  // In the order the parts were given, whatever order the addresses were mailed in.
  return new Map(parts.map((part) => [part.contactId, results.get(part.contactId) ?? "unavailable"]));
}

/**
 * Sends a staff alert to every live staff account's address, best effort: a failed send is logged and never thrown, and
 * the answer is the number of addresses the relay took, 0 when it took none or there is no live staff account. It
 * applies no throttle: the moderation module keeps every throttle, as a key in the shared limit store.
 */
export async function mailStaff(deps: AuthDeps, message: StaffMessage): Promise<number> {
  const data = staffData(message);
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
export async function findNotifierContacts(deps: Pick<AuthDeps, "repo" | "config">, email: string): Promise<{ id: string; name: string | null }[]> {
  const rows = await deps.repo.notifierContactsByEmailHash(emailHash(deps.config.authHmacKey, email));
  return rows.map((row) => ({ id: row.id, name: row.nameEnc ? open(deps, row.nameEnc) : null }));
}

/** How many contacts and confirmations the janitor should have removed more than a day ago: a count only, for the console's overview. */
export function overdueContacts(deps: AuthDeps): Promise<number> {
  return deps.repo.countNotifierRowsDue(new Date(deps.now().getTime() - DAY));
}
