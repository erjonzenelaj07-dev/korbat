import { z } from "zod";
import { hex, sha256, sortedJson } from "./canonical";
import { FORBIDDEN_FORMAT } from "./text";

// Authorities' orders and the alert channel (3f design, sections 6.1, 6.2, 10.1, 10.2 and 18, W.1 and W.4). This module
// imports nothing from the other modules of the contracts but text.ts, which imports nothing: moderation.ts reads its
// constants for the staff overview, staff.ts its step-up params, and the watcher (apps/api/src/notify), which imports the
// contracts and nothing of the API, renders its pushes from it.

// ---------------------------------------------------------------- the numbers

/**
 * The numbers of 3f, the same as the SQL function order_rules() returns, which a database test compares member by
 * member: one constant mirrors one function, as STANDING_RULES mirrors standing_rules(). Every function and view of 3f
 * reads its numbers from there, and every word of the console, the pushes and the mails from here. Each is a cautious
 * default flagged for the owner (3f design, section 2): one line to change in each place.
 */
export const ORDER_RULES = {
  /** A removal order's hour (TCO Art. 3(3)); a restart of its clock is a fresh one; a message's deadline as an order. */
  hourMinutes: 60,
  /** The console's target until sub-project 3d purges edge copies. */
  targetMinutes: 55,
  /** The most items one "Disable for an order" confirms, and the most links one request names. */
  itemsPerAction: 10,
  /** Order decisions of one staff account in 24 hours. */
  decisionsPerDay: 50,
  /** Order records one staff account opens in 24 hours. */
  recordsPerDay: 20,
  /** A removal order's computed hold, and its one extension. */
  holdDays: 43,
  holdExtensionDays: 42,
  /** Every staff account is alerted this long before a held notice is released. */
  holdWarningDays: 7,
  /** No shorter hold for a tick the command line has not confirmed; a number here would cap it. */
  unconfirmedHoldHours: null,
  /** How long what a removal order disabled is preserved: months from the disabling, and a margin of days. */
  preserveMonths: 6,
  preserveMarginDays: 1,
  /** How long a deletion keeps the address while a report is owed, and when an owed report is alerted. */
  reportHoldDays: 7,
  reportAlertHours: 24,
  /** A message read more than this long after it arrived is stale and raises no push. */
  staleHours: 2,
  /** While an unhandled message's first push is this young, a further message raises no first push of its own; 0 switches the bound off. */
  quietMinutes: 15,
  /** When an unanswered message rings every phone, and the first reminder of its deadline. */
  escalateMinutes: 15,
  remindMinutes: 45,
  /** When the channel reads as down, and how long a row is still owed its push. */
  channelDownMinutes: 3,
  pushOwedMinutes: 60,
  /** When the copy of the audit log's tail is overdue, and when a hand-over archive not destroyed is alerted. */
  copyOverdueHours: 48,
  handoverAlertDays: 7,
  /** How long a handled message, an order's records and a closed restore gap are kept. */
  messageKeepDays: 30,
  recordKeepYears: 3,
  gapKeepMonths: 12,
} as const;
export type OrderRules = typeof ORDER_RULES;

/** What the database never reads: the watcher's round, the alert tick's, and how long the tick tries a row's mail. */
export const ALERT_RULES = {
  pollSeconds: 20,
  tickSeconds: 30,
  mailRetryHours: 24,
} as const;

// ---------------------------------------------------------------- the contact point

/** The two folders the watcher reads: the inbox, and the folder the mail host files junk in. */
export const CONTACT_FOLDERS = ["inbox", "junk"] as const;
export type ContactFolder = (typeof CONTACT_FOLDERS)[number];

/** What a message at the contact point turned out to be; `order` is set only by opening an order from it. */
export const CONTACT_DISPOSITIONS = ["order", "referral", "first_order_notice", "preservation_request", "scrutiny_decision", "clarification", "not_an_order"] as const;
export type ContactDisposition = (typeof CONTACT_DISPOSITIONS)[number];
/** What the close route takes: every disposition but `order`. */
export const CONTACT_CLOSE_DISPOSITIONS = ["referral", "first_order_notice", "preservation_request", "scrutiny_decision", "clarification", "not_an_order"] as const satisfies readonly Exclude<ContactDisposition, "order">[];

/** The words of the Contact point screen for each disposition (W.1). */
export const DISPOSITION_LABELS: Record<ContactDisposition, string> = {
  order: "An order",
  referral: "Referral",
  first_order_notice: "Notice before a first order",
  preservation_request: "Request to preserve longer",
  scrutiny_decision: "Scrutiny decision",
  clarification: "About an order korbat holds",
  not_an_order: "Not an order",
};

/** The eight words of notify_state.error: why the watcher's last round failed. */
export const NOTIFY_ERRORS = ["imap_connect", "imap_timeout", "imap_tls", "imap_login", "imap_folder", "imap_protocol", "push_connect", "push_refused"] as const;
export type NotifyError = (typeof NOTIFY_ERRORS)[number];

/** Messages a page of the Contact point screen. */
export const CONTACT_PAGE_SIZE = 50;

const Instant = z.iso.datetime();

/** One message at the contact point, as the console reads it: no sender, no subject and no content exist to show. */
export const ContactMessage = z.strictObject({
  id: z.uuid(),
  folder: z.enum(CONTACT_FOLDERS),
  receivedAt: Instant,
  seenAt: Instant,
  stale: z.boolean(),
  disposition: z.enum(CONTACT_DISPOSITIONS).nullable(),
  handledAt: Instant.nullable(),
  /** The staff handle of whoever closed it, or null. */
  handledBy: z.string().nullable(),
  /** The orders opened from it. */
  orders: z.array(z.uuid()),
});
export type ContactMessage = z.infer<typeof ContactMessage>;

/** GET /api/staff/contact: the messages newest first by receivedAt, a page at a time. */
export const ContactPage = z.strictObject({
  items: z.array(ContactMessage).max(CONTACT_PAGE_SIZE),
  nextCursor: z.string().nullable(),
});
export type ContactPage = z.infer<typeof ContactPage>;

/** The list's query: after the cursor the API handed out, and only the messages without a disposition with open=1. */
export const ContactQuery = z.strictObject({
  cursor: z.string().min(1).max(200).optional(),
  open: z.literal("1").optional(),
});
export type ContactQuery = z.infer<typeof ContactQuery>;

/** POST /api/staff/contact/:message/close. */
export const ContactCloseRequest = z.strictObject({ disposition: z.enum(CONTACT_CLOSE_DISPOSITIONS) });
export type ContactCloseRequest = z.infer<typeof ContactCloseRequest>;

/** The channel's state on the console's home: up, down, the mailbox unreadable, or switched off on this server. */
export const ALERT_CHANNEL_STATES = ["ok", "down", "mailbox", "off"] as const;
export type AlertChannelState = (typeof ALERT_CHANNEL_STATES)[number];

// ---------------------------------------------------------------- the alerts

/**
 * The closed list of alerts, the CHECK of alert_outbox.kind written from it: 3f's kinds, then 3c's and 3e's six, whose
 * mails stay their own and which gain a push.
 */
export const ALERT_KIND_LIST = [
  "contact_mail",
  "contact_mail_escalated",
  "order_due",
  "order_opened",
  "order_corrected",
  "order_effected",
  "order_reinstated",
  "order_unverified",
  "hold_ending",
  "report_owed",
  "handover_undestroyed",
  "copy_overdue",
  "copy_taken",
  "alert_channel_down",
  "mailbox_unreachable",
  "alert_test",
  "moderation_urgent",
  "moderation_waiting",
  "moderation_burst",
  "moderation_reads",
  "moderation_reveal",
  "moderation_csam_lifted",
] as const;
export type AlertKind = (typeof ALERT_KIND_LIST)[number];

export type AlertLeg = "push" | "mail";
/** The ntfy topic of a push: the phone on call, or every staff phone. A mail goes to every staff account whatever the scope. */
export type AlertScope = "on_call" | "all";

/** One kind's entry: its priority and scope, its legs, who renders its mail, and the names of its facts. */
export interface AlertKindEntry {
  readonly priority: 3 | 5;
  readonly scope: AlertScope;
  readonly legs: readonly AlertLeg[];
  /**
   * `sentence`: the mail is the kind's own entry of ALERT_TEXTS, which the alert tick can mail again from the row's facts;
   * `own`: a mail of 3c or 3e that says more than the facts hold, which only staffAlert sends; null: pushed only.
   */
  readonly mail: "sentence" | "own" | null;
  /** The names of the row's facts: counts and times, at most six. */
  readonly facts: readonly string[];
}

const both: readonly AlertLeg[] = ["push", "mail"];
const sentenceKind = (priority: 3 | 5, scope: AlertScope, facts: readonly string[]): AlertKindEntry => ({ priority, scope, legs: both, mail: "sentence", facts });
const ownKind = (priority: 3 | 5, scope: AlertScope, facts: readonly string[]): AlertKindEntry => ({ priority, scope, legs: both, mail: "own", facts });

/**
 * Each kind's facts under the names the sentences print. `order_opened` carries `unknown` (1 for an order opened without
 * a time of receipt, else 0) beside its count and its deadline, so its sentence can tell "No deadline runs" from "Its
 * deadline is unknown"; `order_effected` carries `urgent` the same way.
 */
export const ALERT_KINDS: Record<AlertKind, AlertKindEntry> = {
  contact_mail: sentenceKind(5, "on_call", ["receivedAt", "dueAt"]),
  contact_mail_escalated: sentenceKind(5, "all", ["receivedAt", "dueAt"]),
  order_due: sentenceKind(5, "all", ["dueAt", "minutesLeft", "itemsOpen"]),
  order_opened: sentenceKind(3, "all", ["items", "dueAt", "unknown"]),
  order_corrected: sentenceKind(3, "all", ["count", "at"]),
  order_effected: sentenceKind(3, "all", ["items", "at", "itemsOpen", "urgent"]),
  order_reinstated: sentenceKind(3, "all", ["at"]),
  order_unverified: sentenceKind(5, "all", ["count", "textsMissing", "holdsOpen", "oldestAt"]),
  hold_ending: sentenceKind(3, "all", ["count", "at"]),
  report_owed: sentenceKind(5, "all", ["count", "oldestAt"]),
  handover_undestroyed: sentenceKind(3, "all", ["count"]),
  copy_overdue: sentenceKind(3, "all", ["hours"]),
  copy_taken: sentenceKind(3, "all", ["at", "rows"]),
  alert_channel_down: { priority: 3, scope: "all", legs: ["mail"], mail: "sentence", facts: ["since"] },
  mailbox_unreachable: sentenceKind(5, "all", ["since"]),
  alert_test: { priority: 3, scope: "all", legs: ["push"], mail: null, facts: ["at"] },
  moderation_urgent: ownKind(5, "on_call", ["count", "oldestAt"]),
  moderation_waiting: ownKind(3, "all", ["count"]),
  moderation_burst: ownKind(3, "all", ["count"]),
  moderation_reads: ownKind(3, "all", ["limit"]),
  moderation_reveal: ownKind(3, "all", ["at"]),
  moderation_csam_lifted: ownKind(3, "all", ["at"]),
};

/** The kinds the watcher publishes: every kind with a push leg. */
export const PUSH_KINDS: readonly AlertKind[] = ALERT_KIND_LIST.filter((kind) => ALERT_KINDS[kind].legs.includes("push"));
/** The kinds whose mail is their push's sentence, which the alert tick mails from the row. */
export const SENTENCE_MAIL_KINDS: readonly AlertKind[] = ALERT_KIND_LIST.filter((kind) => ALERT_KINDS[kind].mail === "sentence");

/** The facts of a row: counts, and instants as ISO strings in UTC. */
export type AlertFacts = Readonly<Record<string, number | string>>;

/** A fact that is a time: `at`, `since`, or a name that ends in At. Every other fact is a count. */
export const isTimeFact = (name: string): boolean => name === "at" || name === "since" || name.endsWith("At");

/** What a part of a sentence is printed under: a fact present or missing, above zero, or equal to 1 or not. */
export interface AlertCondition {
  readonly fact: string;
  readonly is: "present" | "absent" | "positive" | "one" | "not_one";
}
/** A part of a sentence, printed when its condition holds; the parts printed are joined with a space. */
export interface AlertPart {
  readonly text: string;
  /** One condition, or several that must all hold. */
  readonly when?: AlertCondition | readonly AlertCondition[];
}
/** A kind's words: the title, the sentence in parts, and for a kind whose mail is its sentence the mail's line of what to do. */
export interface AlertText {
  readonly title: string;
  readonly sentence: readonly AlertPart[];
  readonly todo: string | null;
}

const NOT_LISTED = 'An order you find there is opened in the console under Orders, with "The message is not listed".';
const KEY_TOLD = "Every staff account gets this. If it was confirmed with your key and not by you, someone else holds your key: tell the operator at once.";
const one = (text: string): readonly AlertPart[] => [{ text }];

/**
 * The words of each kind (W.4). A value in braces is a member of the row's facts, a count or a time, or a number of
 * ORDER_RULES, which is no fact of the row: no number is typed here, so a changed rule changes the words. The push is the
 * title and the sentence; a mail whose kind's mail is its sentence has the title as its subject after "korbat: ", and
 * the sentence and the line of what to do as its paragraphs.
 */
export const ALERT_TEXTS: Record<AlertKind, AlertText> = {
  contact_mail: {
    title: "Mail at the contact point",
    sentence: [
      { text: "Mail at the authorities' contact point, received {receivedAt}. If it is a removal order it is due {dueAt}.", when: { fact: "receivedAt", is: "present" } },
      // A restart of an order's clock writes a row with the new deadline and no time of receipt.
      { text: "A removal order's hour has started again: due {dueAt}.", when: { fact: "receivedAt", is: "absent" } },
    ],
    todo: "Read it in the mail host's app, never in korbat, and with it every other new message there: further mail within {quietMinutes} minutes raises no alarm of its own. Then open Contact point in the staff console. What ends this message's alarms is handling it there: opening an order from it, or closing it.",
  },
  contact_mail_escalated: {
    title: "Nobody has answered: mail at the contact point",
    sentence: one("Nobody has answered the mail that arrived at the authorities' contact point at {receivedAt}. If it is a removal order it is due {dueAt}."),
    todo: "This went to every staff phone. Whoever reads it first acts, and tells the others.",
  },
  order_due: {
    title: "{minutesLeft} minutes left",
    sentence: one("A removal order, or mail that may be one, is due {dueAt}: {minutesLeft} minutes are left and it is not carried out in full."),
    todo: "Give effect now, to every post the order names. Only if the order has a manifest error, or lacks what you need to find the content, send Annex III and record it: that is no way to stop this alarm. If nobody can act in time: the README, When nobody can act within the hour.",
  },
  order_opened: {
    title: "An order was opened",
    sentence: [
      { text: "An order was opened: {items} items." },
      { text: "Due {dueAt}.", when: { fact: "dueAt", is: "present" } },
      { text: "No deadline runs.", when: [{ fact: "dueAt", is: "absent" }, { fact: "unknown", is: "not_one" }] },
      { text: "Its deadline is unknown: act now.", when: [{ fact: "dueAt", is: "absent" }, { fact: "unknown", is: "one" }] },
    ],
    todo: "If you are not the one on call, you need do nothing. If nobody was on call, ask who opened it.",
  },
  order_corrected: {
    title: "An order's record was corrected",
    sentence: one("An order's record was corrected at {at}: {count} of its entries changed."),
    todo: "Every staff account gets this, because a record can be corrected without a key. If you are on call, read the order again before you act on it. If nobody says it was them, a staff session is in someone else's hands: tell the operator at once.",
  },
  order_effected: {
    title: "An order was given effect",
    sentence: [
      { text: "An order was given effect at {at}: {items} posts disabled.", when: { fact: "urgent", is: "not_one" } },
      { text: "An order that is not verified was given effect as urgent at {at}: {items} posts disabled.", when: { fact: "urgent", is: "one" } },
      { text: "{itemsOpen} items of the order are still open.", when: { fact: "itemsOpen", is: "positive" } },
    ],
    todo: KEY_TOLD,
  },
  order_reinstated: {
    title: "An order's measure was lifted",
    sentence: one("An admin lifted an order's measure on a post at {at}."),
    todo: KEY_TOLD,
  },
  order_unverified: {
    title: "Orders with something missing",
    sentence: [
      { text: "{count} orders are given effect and not verified, or hold a post added after their check, the oldest since {oldestAt}." },
      { text: "{textsMissing} are given effect and have no reasons of the authority recorded for their authors.", when: { fact: "textsMissing", is: "positive" } },
      { text: "{holdsOpen} hold a notice with no end recorded.", when: { fact: "holdsOpen", is: "positive" } },
    ],
    todo: "Whoever has the server compares each with the order in the mailbox and records what is missing: staff.js order-verify, order-texts, order-hold-until. This repeats daily until then.",
  },
  hold_ending: {
    title: "A held notice is about to be released",
    sentence: one("{count} held notices are released within {holdWarningDays} days, the first on {at}."),
    todo: "Whoever has the server checks the contact-point mailbox today for an extension or a later time from the authority, and records it before that day. If nothing came, nothing is to be done: korbat tells the author by itself.",
  },
  report_owed: {
    title: "A report to the authorities is owed",
    sentence: one("{count} reports to the authorities have been owed for more than {reportAlertHours} hours, the oldest since {oldestAt}."),
    todo: "The admin answers the case; whoever has the server reports and records it (staff.js records). This repeats daily until then.",
  },
  handover_undestroyed: {
    title: "A hand-over copy still exists",
    sentence: one("{count} hand-over archives are older than {handoverAlertDays} days and not recorded as destroyed."),
    todo: "Whoever has the server deletes every copy and records it with staff.js handover-destroyed.",
  },
  copy_overdue: {
    title: "The copy is overdue",
    sentence: one("The audit log's tail was last downloaded {hours} hours ago."),
    todo: "The keeper opens the console's Audit log today and presses Download since my last copy.",
  },
  copy_taken: {
    title: "The audit log's tail was downloaded",
    sentence: one("A staff account that did not take the last copy downloaded the audit log's tail at {at}: {rows} rows."),
    todo: "If you are the keeper's stand-in, or asked for it, nothing is to be done. If nobody says it was them, a staff session and its key are in someone else's hands: tell the operator at once.",
  },
  mailbox_unreachable: {
    title: "The contact point cannot be read",
    sentence: one("korbat has not been able to read the contact-point mailbox since {since}."),
    todo: `Mail that arrives there raises no alert now. Check the mailbox in the mail host's app until this is repaired; ${NOT_LISTED.charAt(0).toLowerCase()}${NOT_LISTED.slice(1)} The operator checks the password and the mail host.`,
  },
  alert_channel_down: {
    title: "Phone alerts are down",
    sentence: one("Phone alerts are down since {since}: korbat's watcher or its push server does not answer."),
    todo: `Until it is repaired, korbat wakes nobody: the mail host's own app on the on-call phone, signed in to the contact-point mailbox and allowed to ring at night, is the only thing that does. Check now that it is. ${NOT_LISTED} The operator restarts the notify and ntfy services.`,
  },
  alert_test: {
    title: "Daily test",
    sentence: one("Daily test, {at}. If you read this on your phone, alerts reach it. Nothing to do."),
    todo: null,
  },
  // 3c's and 3e's kinds: a push that names nobody, beside their mails, which stay word for word.
  moderation_urgent: { title: "Urgent lane", sentence: one("{count} cases wait in the urgent lane, the oldest since {oldestAt}."), todo: null },
  moderation_waiting: { title: "Cases are waiting", sentence: one("{count} cases or replies are waiting longer than their response time."), todo: null },
  moderation_burst: { title: "Many decisions in a short time", sentence: one("One staff account confirmed {count} decisions in 15 minutes. The staff mail says which."), todo: null },
  moderation_reads: { title: "A daily case limit was reached", sentence: one("One staff account opened {limit} different cases today. The staff mail says which."), todo: null },
  moderation_reveal: { title: "A reporter was revealed", sentence: one("One staff account revealed who sent a report, at {at}. The staff mail says which."), todo: null },
  moderation_csam_lifted: { title: "Reported images are no longer protected", sentence: one("A decision at {at} ended the protection of reported images. Read the staff mail."), todo: null },
};

/** A placeholder in braces: a fact's name or a member of ORDER_RULES. */
const PLACEHOLDER = /[{]([a-zA-Z]+)[}]/g;

/** Every placeholder a kind's words name, each once. */
export function alertPlaceholders(kind: AlertKind): string[] {
  const text = ALERT_TEXTS[kind];
  const words = [text.title, ...text.sentence.map((part) => part.text), text.todo ?? ""].join(" ");
  return [...new Set([...words.matchAll(PLACEHOLDER)].map((found) => found[1]!))];
}

/** The form of a time in a row's facts: an instant in UTC with up to six decimals of a second. */
export const ALERT_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$/;

const two = (n: number) => String(n).padStart(2, "0");

/** An alert's time (rule 5 of section 18): "14:05 UTC", with the day before it when it is not the day of `now` in UTC. */
export function alertTime(iso: string, now: Date): string {
  const at = new Date(iso);
  const clock = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC`;
  const day = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`;
  const today = `${now.getUTCFullYear()}-${two(now.getUTCMonth() + 1)}-${two(now.getUTCDate())}`;
  return day === today ? clock : `${day} ${clock}`;
}

/** Whether a part's condition, or every one of its conditions, holds for the facts. */
function holds(when: AlertPart["when"], facts: AlertFacts): boolean {
  if (when === undefined) return true;
  if (Array.isArray(when)) return when.every((condition: AlertCondition) => holds(condition, facts));
  const condition = when as AlertCondition;
  const value = facts[condition.fact];
  switch (condition.is) {
    case "present":
      return value !== undefined;
    case "absent":
      return value === undefined;
    case "positive":
      return typeof value === "number" && value > 0;
    case "one":
      return value === 1;
    case "not_one":
      return value !== 1;
  }
}

/** The facts held to the kind's names and kinds: a time where the name is a time's, a whole number elsewhere. */
function checkFacts(kind: AlertKind, facts: AlertFacts): void {
  const names = ALERT_KINDS[kind].facts;
  for (const [name, value] of Object.entries(facts)) {
    if (!names.includes(name)) throw new Error(`alert ${kind}: the fact ${name} is not one of its facts`);
    if (isTimeFact(name) ? typeof value !== "string" || !ALERT_TIME.test(value) : typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`alert ${kind}: the fact ${name} is not ${isTimeFact(name) ? "a time" : "a count"}`);
    }
  }
}

/**
 * A kind's title, sentence and line of what to do, filled from the facts and ORDER_RULES. A time prints as alertTime
 * does at `now`. A placeholder with nothing to fill it, a fact of another kind and a fact of the wrong form throw: an
 * alert never goes out with a hole or with anything but counts and times in it.
 */
export function renderAlert(kind: AlertKind, facts: AlertFacts, now: Date): { title: string; sentence: string; todo: string | null } {
  checkFacts(kind, facts);
  const rules = ORDER_RULES as Record<string, number | null>;
  const fill = (text: string) =>
    text.replace(PLACEHOLDER, (_match, name: string) => {
      const value = facts[name];
      if (value !== undefined) return typeof value === "string" ? alertTime(value, now) : String(value);
      const rule = Object.hasOwn(rules, name) ? rules[name] : undefined;
      if (typeof rule === "number") return String(rule);
      throw new Error(`alert ${kind}: nothing fills {${name}}`);
    });
  const text = ALERT_TEXTS[kind];
  return {
    title: fill(text.title),
    sentence: text.sentence
      .filter((part) => holds(part.when, facts))
      .map((part) => fill(part.text))
      .join(" "),
    todo: text.todo === null ? null : fill(text.todo),
  };
}

// ---------------------------------------------------------------- order records (3f design, sections 6.2 and 10.1)

/** The three kinds of order korbat records (section 2, row 5): a TCO removal order, a DSA Article 9 and an Article 10 order. */
export const ORDER_KINDS = ["tco_removal", "dsa_art9", "dsa_art10"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/** How an order arrived: the form's "How it arrived", the request's channel, the correction's and order-open's. */
export const ORDER_CHANNELS = ["mailbox", "portal", "post", "other"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** What an order's link names (7.4): a post, an image korbat serves, an account, or anything else. */
export const ORDER_LINK_KINDS = ["post", "image", "account", "other"] as const;
export type OrderLinkKind = (typeof ORDER_LINK_KINDS)[number];

/** The events order_event_record writes and the events route takes. */
export const ORDER_CONSOLE_EVENTS = ["annex3_sent", "grounds_ceased", "clarification_received", "annex2_sent", "receipt_confirmed", "closed_without_effect", "reopened", "hold_extended"] as const;
export type OrderConsoleEvent = (typeof ORDER_CONSOLE_EVENTS)[number];

/** The events the command line writes, as the migrator; reopened and hold_extended are written in the console too. */
export const ORDER_CLI_EVENTS = [
  "verified",
  "issued_at_set",
  "texts_recorded",
  "document_recorded",
  "received_set",
  "sent_at_set",
  "due_set",
  "hold_extended",
  "hold_ended",
  "hold_until_set",
  "preservation_extended",
  "scrutiny_requested",
  "scrutiny_decided",
  "reopened",
  "tell_person_set",
  "person_told",
  "imported",
] as const;
export type OrderCliEvent = (typeof ORDER_CLI_EVENTS)[number];

/** The kinds the database alone writes: the API's insert of `opened`, and those of the definer functions and the ledger. */
export const ORDER_SYSTEM_EVENTS = ["opened", "corrected", "effect_given", "reinstated", "notice_released", "preservation_ended"] as const;

/** Every kind of legal_order_events.kind (6.2's table), the CHECK written from it, each once. */
export const ORDER_EVENT_KINDS = [
  "opened",
  "annex3_sent",
  "grounds_ceased",
  "clarification_received",
  "annex2_sent",
  "receipt_confirmed",
  "closed_without_effect",
  "reopened",
  "hold_extended",
  "corrected",
  "effect_given",
  "reinstated",
  "notice_released",
  "preservation_ended",
  "verified",
  "issued_at_set",
  "texts_recorded",
  "document_recorded",
  "received_set",
  "sent_at_set",
  "due_set",
  "hold_ended",
  "hold_until_set",
  "preservation_extended",
  "scrutiny_requested",
  "scrutiny_decided",
  "tell_person_set",
  "person_told",
  "imported",
] as const;
export type OrderEventKind = (typeof ORDER_EVENT_KINDS)[number];

/** Who wrote an event: the console (through a definer function), the command line, or the database itself. */
export const ORDER_EVENT_VIA = ["console", "cli", "system"] as const;
export type OrderEventVia = (typeof ORDER_EVENT_VIA)[number];

/** An Annex III's ground: force majeure (TCO Art. 3(7)), a manifest error or missing information (Art. 3(8)). */
export const ANNEX3_GROUNDS = ["force_majeure", "manifest_error", "insufficient_information"] as const;
export type Annex3Ground = (typeof ANNEX3_GROUNDS)[number];
/** The ground of a reinstatement after an order. */
export const ORDER_GROUNDS = ["withdrawn", "annulled", "scrutiny", "not_authentic", "wrong_item"] as const;
export type OrderGround = (typeof ORDER_GROUNDS)[number];
/** The ground of closing an order without effect: a reinstatement's, or that the order is not addressed to korbat. */
export const ORDER_CLOSE_GROUNDS = ["withdrawn", "annulled", "scrutiny", "not_authentic", "wrong_item", "not_addressed"] as const;
export type OrderCloseGround = (typeof ORDER_CLOSE_GROUNDS)[number];
/** Which rule allowed a correction (7.4), stored as the ground of its event `corrected`. */
export const ORDER_CORRECTION_RULES = ["entry", "caution", "admin"] as const;
export type OrderCorrectionRule = (typeof ORDER_CORRECTION_RULES)[number];
/** Why an open item was closed without effect: it names nothing to disable, korbat entered it by mistake, or the authority withdrew it. */
export const ORDER_ITEM_CLOSE_REASONS = ["no_post", "not_named", "withdrawn"] as const;
export type OrderItemCloseReason = (typeof ORDER_ITEM_CLOSE_REASONS)[number];
/** Why a hold was ended from the command line, or by a correction that unset Section C (not_ordered). */
export const HOLD_END_REASONS = ["not_authentic", "annulled", "released_by_authority", "not_ordered"] as const;
export type HoldEndReason = (typeof HOLD_END_REASONS)[number];
/** Which rule a hold's end follows: the computed end of a removal order, or the end a DSA order's authority states. */
export const HOLD_BASES = ["regulation", "authority"] as const;
export type HoldBasis = (typeof HOLD_BASES)[number];
/** When the person an order to provide information concerns may be told (DSA Art. 10(5)). */
export const TELL_PERSON_RULES = ["at_effect", "at_instant", "never"] as const;
export type TellPersonRule = (typeof TELL_PERSON_RULES)[number];
/** A scrutiny's outcome (TCO Art. 4). */
export const SCRUTINY_OUTCOMES = ["upheld", "annulled"] as const;
export type ScrutinyOutcome = (typeof SCRUTINY_OUTCOMES)[number];

// ---------------------------------------------------------------- records to authorities (Task 5)
// Each list below is the one spelling of section 6.5's CHECK of the same meaning; a database test holds them equal.

/** A notification record's state: owed until the command line records it as sent or declined. */
export const NOTIFICATION_STATES = ["owed", "sent", "declined"] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];
/** The duties a notification meets (one may meet several): DSA Art. 18 (two readings), TCO Art. 14(5), or none. */
export const NOTIFICATION_DUTIES = ["dsa18_1", "dsa18_2", "tco14_5", "voluntary"] as const;
export type NotificationDuty = (typeof NOTIFICATION_DUTIES)[number];
/**
 * What a notification sent, and what an order to provide information asked for, by kind and never by value: the one
 * list of `notification-sent --kinds`, of `production-account --asked` and of the CHECKs on `sent_kinds` and `asked`.
 */
export const NOTIFICATION_SENT_KINDS = ["handle", "address", "created_at", "post_ids", "post_times", "report_time", "files"] as const;
export type NotificationSentKind = (typeof NOTIFICATION_SENT_KINDS)[number];
/** An authority's answer to a notification: a word, never a sentence about a person. No word releases or destroys anything. */
export const NOTIFICATION_ANSWERS = ["not_illegal", "illegal", "no_assessment", "other"] as const;
export type NotificationAnswer = (typeof NOTIFICATION_ANSWERS)[number];
/** A later step of a notification's matter: the authority's request, its answer, or the operator's note. */
export const NOTIFICATION_EVENT_KINDS = ["request", "answer", "note"] as const;
export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KINDS)[number];
/** Who opened a notification record: a seal (the database's trigger) or the command line. */
export const NOTIFICATION_OPENED_VIA = ["system", "cli"] as const;
/** What a production answers. A recipient is an authority, never a hotline, a lawyer or a company. */
export const PRODUCTION_INSTRUMENTS = ["notification", "demand", "court_order", "seizure", "dsa_art10", "preserved_access"] as const;
export type ProductionInstrument = (typeof PRODUCTION_INSTRUMENTS)[number];
/** The instruments under which sealed files are handed over (`handover-list --instrument`). */
export const HANDOVER_INSTRUMENTS = ["notification", "demand", "court_order", "seizure"] as const satisfies readonly ProductionInstrument[];
/** Why preserved content was opened (`order-access --purpose`); only `authority` is a production. */
export const ACCESS_PURPOSES = ["review", "complaint", "authority"] as const;
export type AccessPurpose = (typeof ACCESS_PURPOSES)[number];
/**
 * What a production gave, by kind: the kinds a notification can send, and `content`, a preserved post's text, alt texts
 * and its images' facts as `order-access` prints them. Never a value.
 */
export const PRODUCED_KINDS = [...NOTIFICATION_SENT_KINDS, "content"] as const;
/** What korbat does not hold of an account (W.8's sentence), by kind, as a production stores it. */
export const NOT_HELD_KINDS = ["name", "postal_address", "date_of_birth", "phone_number", "ip_address"] as const;
/**
 * Why an address hold was released: the record was sent, or declined (also by the database when no seal of the account
 * is left). A hold older than ORDER_RULES.reportHoldDays simply reads as not held; `expired` is kept for a hand-written end.
 */
export const REPORT_HOLD_RELEASES = ["sent", "declined", "expired"] as const;
/**
 * W.8's sentence of what korbat does not hold, and of what it holds and has not produced, by version: a notification's
 * record stores the version that went with it (`not_kept_version`), so a changed sentence is a new version.
 */
export const RECORDS_NOT_HELD = {
  1: "korbat holds no name, postal address, date of birth, phone number or IP address of this account. It holds IP addresses, and a phone number the account verified, only as keyed hashes that identify nobody outside korbat; a device's hash is deleted 30 days after the device was last seen. korbat also holds, and has not produced here, the times and device types of the account's sign-ins.",
} as const;
export const RECORDS_NOT_HELD_VERSION = 1;

/**
 * The digest that a later step of a notification record (its answer, an event) and every step of a production hold in
 * their audit row in place of the facts (10.5): the SHA-256, in hex, of the record's row at that step in the canonical
 * JSON (canonical.ts), as the database printed it. The chain proves the record existed and was not changed afterwards,
 * and `staff.js records --verify` recomputes it from the row, without the audit log ever naming the person.
 */
export async function recordDigestOf(row: unknown): Promise<string> {
  return hex(await sha256(sortedJson(row)));
}

/** The grounds each kind of event takes; a kind not named here takes none. legal_order_events_ground is written from it. */
export const ORDER_EVENT_GROUNDS = {
  annex3_sent: ANNEX3_GROUNDS,
  closed_without_effect: ORDER_CLOSE_GROUNDS,
  corrected: ORDER_CORRECTION_RULES,
  reinstated: ORDER_GROUNDS,
  hold_ended: HOLD_END_REASONS,
  scrutiny_decided: SCRUTINY_OUTCOMES,
} as const satisfies Partial<Record<OrderEventKind, readonly string[]>>;

/** The grounds of a kind of event, or null for a kind that takes none. */
export function orderEventGrounds(kind: OrderEventKind): readonly string[] | null {
  return (ORDER_EVENT_GROUNDS as Partial<Record<OrderEventKind, readonly string[]>>)[kind] ?? null;
}

/** An order's state on the list (10.2): a removal order is given_effect only once none of its items is open. */
export const ORDER_STATES = ["running", "stopped", "overdue", "unknown_deadline", "given_effect", "closed", "no_clock"] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/**
 * The two kinds of the ledger that the migration orders adds to action_kind: the measure of an order decision and its
 * reversal. Since Task 3 they are the last two of the contracts' ACTION_KINDS too, with MEASURES' labels (W.1); this names
 * them apart for the code that handles an order's ledger alone.
 */
export const ORDER_ACTION_KINDS = ["disable_by_order", "reinstate_by_order"] as const;

/** The most items an order holds (its positions), and how much of a public post's body an order's screen previews. */
export const ORDER_ITEMS_MAX = 50;
export const ORDER_ITEM_PREVIEW = 80;
/** TCO Art. 4(4): the hours from receipt in which korbat may ask for the scrutiny of an order from another state. */
export const ORDER_SCRUTINY_HOURS = 48;
/** The bounds of an order's strings (10.1): a name or reference, a link, a short text of the command line, the authority's reasons and redress. */
export const ORDER_TEXT_LIMITS = { name: 200, link: 500, short: 500, long: 4000 } as const;

// ---------------------------------------------------------------- the labels (W.1)

export const ORDER_KIND_LABELS: Record<OrderKind, string> = {
  tco_removal: "Removal order (terrorist content)",
  dsa_art9: "Order to act against content (DSA Article 9)",
  dsa_art10: "Order to provide information (DSA Article 10)",
};
export const ANNEX3_GROUND_LABELS: Record<Annex3Ground, string> = {
  force_majeure: "Force majeure or impossibility not korbat's fault (Article 3(7))",
  manifest_error: "The order has manifest errors (Article 3(8))",
  insufficient_information: "The order lacks information (Article 3(8))",
};
export const ORDER_GROUND_LABELS: Record<OrderCloseGround, string> = {
  withdrawn: "The authority withdrew the order",
  annulled: "A court annulled the order",
  scrutiny: "The home authority's scrutiny found that the order infringes (Article 4)",
  not_authentic: "The order was not authentic",
  wrong_item: "korbat's mistake: the order does not name this post",
  not_addressed: "It is not addressed to korbat",
};
export const HOLD_END_REASON_LABELS: Record<HoldEndReason, string> = {
  not_authentic: "The order was not authentic",
  annulled: "A court annulled the order",
  released_by_authority: "The authority released it",
  not_ordered: "korbat's mistake: the order had no non-disclosure decision",
};
export const SCRUTINY_OUTCOME_LABELS: Record<ScrutinyOutcome, string> = {
  upheld: "upheld: the order stands",
  annulled: "annulled: the order infringes",
};
export const ORDER_ITEM_CLOSE_REASON_LABELS: Record<OrderItemCloseReason, string> = {
  no_post: "The link names nothing korbat can disable for an order",
  not_named: "korbat's mistake: the order does not name this link",
  withdrawn: "The authority withdrew this item",
};
export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  mailbox: "By mail to the contact point: it is in the mailbox and not in this list",
  portal: "Through a portal",
  post: "By post or in person",
  other: "Another way",
};
/** The rule of a correction in words, for the phrase of its event. */
export const ORDER_CORRECTION_RULE_WORDS: Record<OrderCorrectionRule, string> = {
  entry: "before any effect",
  caution: "the author must not be told, set after effect",
  admin: "by an admin, after effect",
};

/** One phrase an event kind (W.1); a value in braces is the event's own. */
export const ORDER_EVENT_WORDS: Record<OrderEventKind, string> = {
  opened: "Order opened",
  annex3_sent: "Annex III sent: {ground}",
  grounds_ceased: "The grounds ceased: a fresh hour from {effectiveAt}",
  clarification_received: "Clarification received: a fresh hour from {effectiveAt}",
  annex2_sent: "Annex II sent",
  receipt_confirmed: "Authority informed",
  closed_without_effect: "Closed without effect: {ground}",
  effect_given: "Item {n} disabled",
  reinstated: "Item {n} reinstated: {ground}",
  notice_released: "The author's notice released",
  verified: "The check recorded",
  issued_at_set: "The order's own date recorded",
  received_set: "Time of receipt recorded",
  sent_at_set: "Time of sending recorded",
  due_set: "Deadline recorded",
  texts_recorded: "The authority's reasons, remedies or scope recorded",
  document_recorded: "The document's digest recorded",
  hold_until_set: "The authority's end of non-disclosure recorded",
  hold_extended: "Non-disclosure extended once",
  hold_ended: "Non-disclosure ended: {reason}",
  corrected: "The record corrected: {rule}",
  reopened: "Order reopened",
  tell_person_set: "Whether the person may be told recorded",
  person_told: "The person was told",
  preservation_extended: "Item {n} preserved longer, until {until}",
  preservation_ended: "Item {n}: preservation ended",
  scrutiny_requested: "Scrutiny requested",
  scrutiny_decided: "Scrutiny decided: {outcome}",
  imported: "Written again after a restore",
};

// ---------------------------------------------------------------- the member states (10.1)

/** The EU's 27 Member States by ISO code, the issuing states an order may name. */
export const EU_MEMBER_STATES = {
  AT: "Austria",
  BE: "Belgium",
  BG: "Bulgaria",
  HR: "Croatia",
  CY: "Cyprus",
  CZ: "Czechia",
  DK: "Denmark",
  EE: "Estonia",
  FI: "Finland",
  FR: "France",
  DE: "Germany",
  GR: "Greece",
  HU: "Hungary",
  IE: "Ireland",
  IT: "Italy",
  LV: "Latvia",
  LT: "Lithuania",
  LU: "Luxembourg",
  MT: "Malta",
  NL: "Netherlands",
  PL: "Poland",
  PT: "Portugal",
  RO: "Romania",
  SK: "Slovakia",
  SI: "Slovenia",
  ES: "Spain",
  SE: "Sweden",
} as const;
export type MemberState = keyof typeof EU_MEMBER_STATES;
const MEMBER_STATE_CODES = Object.keys(EU_MEMBER_STATES) as [MemberState, ...MemberState[]];
/** An issuing state's code: two upper-case letters of one of the 27. */
export const MemberStateCode = z.enum(MEMBER_STATE_CODES);

/** An authority as a state's facts list it, with the words of the Commission's register to check an order against. */
export interface StateAuthority {
  id: string;
  name: string;
  /** Null while nobody verified the register's words: the console then prints state.unknown. */
  registerEntry: string | null;
}

/** What korbat knows of a Member State (10.1); a member without a verified value is null. */
export interface StateFacts {
  name: string;
  authorities: readonly StateAuthority[];
  /** The address that gets a copy of Annex II and III. */
  annexCopy: string | null;
  /** Where a notification to the authorities goes, and how. */
  notificationIntake: { name: string; how: string } | null;
  /** The languages the contact point declares: the operator's choice. */
  languages: readonly string[] | null;
  /** The state's own yearly filing, as a line of the runbook. */
  yearlyFiling: string | null;
  /** The state's default for when the person an order to provide information concerns is told. */
  tellPersonDefault: TellPersonRule | null;
}

/**
 * The states' facts, by ISO code; HOME_STATE picks one. Germany's entry is the worked example, from the research the
 * design cites (korbat-scratch/research-3e: gap-E-orders-law.md, gap-E-authorities.md): the BKA issues removal orders and
 * names TCO@bka.bund.de for questions about one, which is also its entry in the Commission's register; a German host
 * informs the BKA of Annex II and III as well; notifications go to the BKA's portal after registration; the yearly filing
 * is two numbers to the Bundesnetzagentur; a request under TDDDG s. 22 carries silence by statute. The contact point's
 * languages are the operator's to declare, so null. Any other state's entry is the owner's to fill.
 */
export const STATE_FACTS: Partial<Record<MemberState, StateFacts>> = {
  DE: {
    name: "Germany",
    authorities: [{ id: "bka", name: "Bundeskriminalamt (BKA)", registerEntry: "Bundeskriminalamt (BKA), contact point TCO@bka.bund.de" }],
    annexCopy: "TCO@bka.bund.de",
    notificationIntake: {
      name: "BKA reporting portal (u-entrance.bka.de)",
      how: "After registration by mail to U-Entrance@bka.bund.de, which itself takes no report; urgent matters by telephone, +49 611 55-35062; in an emergency 110.",
    },
    languages: null,
    yearlyFiling:
      "By 1 March, to the Bundesnetzagentur: the authorities' requests for access to preserved content and the complaint procedures of the year before (TCO Art. 7(3)(c) and (d)), only when either is not zero.",
    tellPersonDefault: "never",
  },
};

// ---------------------------------------------------------------- the requests (10.2, 10.3)

/** A uuid in the lower case PostgreSQL writes: the one spelling a hashed param may take. */
const LowerUuid = z.uuid().regex(/^[0-9a-f-]+$/, { message: "a uuid in lower case" });

/** Whether a text holds a control character: C0, DEL or C1. */
const hasControl = (text: string) =>
  [...text].some((char) => {
    const code = char.codePointAt(0)!;
    return code < 32 || (code >= 127 && code < 160);
  });
/** Whether a string is whole text, with no half of a surrogate pair. */
const isWellFormed = (text: string) => (text as string & { isWellFormed(): boolean }).isWellFormed();

/**
 * One line typed from an order's document: an authority's name, a reference, a link. Stored as written or refused: well
 * formed, no control character, none of the invisible direction and spacing characters, some text, at most `max`
 * characters as PostgreSQL counts them. It is an outsider's text, and the console draws it as such.
 */
const orderLine = (max: number) =>
  z
    .string()
    // A character outside the basic plane is two UTF-16 units, so this bound never refuses what the count below accepts.
    .max(2 * max)
    .refine(isWellFormed, { message: "half of a surrogate pair is not text" })
    .refine((text) => !hasControl(text), { message: "control characters are not allowed" })
    .refine((text) => !FORBIDDEN_FORMAT.test(text), { message: "invisible direction and spacing characters are not allowed" })
    .refine((text) => text.trim().length > 0, { message: "some text is needed" })
    .refine((text) => Array.from(text).length <= max, { message: `at most ${max} characters` });
export const OrderAuthority = orderLine(ORDER_TEXT_LIMITS.name);
export const OrderReference = orderLine(ORDER_TEXT_LIMITS.name);
export const OrderLinkText = orderLine(ORDER_TEXT_LIMITS.link);

const distinct = (values: readonly string[]) => new Set(values).size === values.length;
const orderLinks = (min: number) => z.array(OrderLinkText).min(min).max(ORDER_RULES.itemsPerAction).refine(distinct, { message: "a link is named once" });

/**
 * POST /api/staff/orders (7.4). sectionC is required and has no default: the form's third choice, "I cannot tell", is
 * sent as true. A named message comes with the channel mailbox, which the database forces too. The withholding is true
 * for a removal order and whenever Section C is set, so no request can hold a notice on a post its author sees; an order
 * to provide information names no post, so it does not withhold unless Section C forces it. It takes no link; the other
 * two kinds take one to itemsPerAction.
 */
export const OrderOpenRequest = z
  .strictObject({
    messageId: z.uuid().nullable(),
    channel: z.enum(ORDER_CHANNELS),
    kind: z.enum(ORDER_KINDS),
    memberState: MemberStateCode,
    authority: OrderAuthority,
    reference: OrderReference,
    links: orderLinks(0),
    sectionC: z.boolean(),
    emergency: z.boolean(),
    withholdFromAuthor: z.boolean(),
  })
  .superRefine((request, ctx) => {
    if (request.messageId !== null && request.channel !== "mailbox") ctx.addIssue({ code: "custom", path: ["channel"], message: "an order opened from a message arrived in the mailbox" });
    if ((request.kind === "tco_removal" || request.sectionC) && !request.withholdFromAuthor) {
      ctx.addIssue({ code: "custom", path: ["withholdFromAuthor"], message: "a removal order, and an order whose author must not be told, keeps the post from its author" });
    }
    if (request.kind === "dsa_art10" && !request.sectionC && request.withholdFromAuthor) {
      ctx.addIssue({ code: "custom", path: ["withholdFromAuthor"], message: "an order to provide information names no post to withhold" });
    }
    if (request.kind === "dsa_art10" ? request.links.length > 0 : request.links.length === 0) {
      ctx.addIssue({ code: "custom", path: ["links"], message: "an order to provide information takes no link; the other kinds take at least one" });
    }
  });
export type OrderOpenRequest = z.infer<typeof OrderOpenRequest>;

/** POST /api/staff/orders/:order/items: one to itemsPerAction more links, up to ORDER_ITEMS_MAX in all. */
export const OrderItemsRequest = z.strictObject({ links: orderLinks(1) });
export type OrderItemsRequest = z.infer<typeof OrderItemsRequest>;

/**
 * What a correction changes (7.4): only the members to change, at least one. crossBorder is the API's, set with
 * memberState. closeItems closes open items, each with one reason, no item twice. Section C set never comes with the
 * withholding unset.
 */
export const OrderCorrectFacts = z
  .strictObject({
    kind: z.enum(ORDER_KINDS).optional(),
    memberState: MemberStateCode.optional(),
    authority: OrderAuthority.optional(),
    reference: OrderReference.optional(),
    channel: z.enum(ORDER_CHANNELS).optional(),
    sectionC: z.boolean().optional(),
    emergency: z.boolean().optional(),
    withholdFromAuthor: z.boolean().optional(),
    closeItems: z
      .array(z.strictObject({ itemId: LowerUuid, reason: z.enum(ORDER_ITEM_CLOSE_REASONS) }))
      .min(1)
      .max(ORDER_RULES.itemsPerAction)
      .refine((items) => distinct(items.map((item) => item.itemId)), { message: "an item is closed once" })
      .optional(),
  })
  .refine((facts) => Object.keys(facts).length > 0, { message: "a correction changes something" })
  .refine((facts) => !(facts.sectionC === true && facts.withholdFromAuthor === false), { message: "an order whose author must not be told keeps the post from its author", path: ["withholdFromAuthor"] });
export type OrderCorrectFacts = z.infer<typeof OrderCorrectFacts>;

/** The step-up params of order_corrected, asked only under the rule admin: the request's facts (10.3). */
export const OrderCorrectedParams = z.strictObject({ facts: OrderCorrectFacts });
export type OrderCorrectedParams = z.infer<typeof OrderCorrectedParams>;

/** Every ground a console event takes: an Annex III's and a closing's, each once. A param is never a free string. */
const CONSOLE_EVENT_GROUNDS = [...ANNEX3_GROUNDS, ...ORDER_CLOSE_GROUNDS] as const;

/**
 * The step-up params of order_event_recorded (10.3): the kind, its ground (one of its kind's list, or null for a kind
 * without one) and the message it names, which a clarification and an extension need, a cease may have and nothing else
 * takes.
 */
export const OrderEventRecordedParams = z
  .strictObject({ kind: z.enum(ORDER_CONSOLE_EVENTS), ground: z.enum(CONSOLE_EVENT_GROUNDS).nullable(), messageId: LowerUuid.nullable() })
  .superRefine((params, ctx) => {
    const grounds = orderEventGrounds(params.kind);
    if (grounds === null ? params.ground !== null : params.ground === null || !grounds.includes(params.ground)) {
      ctx.addIssue({ code: "custom", path: ["ground"], message: grounds === null ? "this event has no ground" : "a ground of this event's list" });
    }
    const needs = params.kind === "clarification_received" || params.kind === "hold_extended";
    const may = needs || params.kind === "grounds_ceased";
    if ((needs && params.messageId === null) || (!may && params.messageId !== null)) {
      ctx.addIssue({ code: "custom", path: ["messageId"], message: needs ? "this event names the message it came in" : "this event names no message" });
    }
  });
export type OrderEventRecordedParams = z.infer<typeof OrderEventRecordedParams>;

// ---------------------------------------------------------------- the answers (10.2)

const At = z.iso.datetime();

/** A removal order's clock: one row of legal_order_clock, with the newest Annex III's time and ground while it is stopped. */
export const OrderClock = z.strictObject({
  clockStart: At.nullable(),
  stopped: z.boolean(),
  stoppedAt: At.nullable(),
  stopGround: z.enum(ANNEX3_GROUNDS).nullable(),
  deadlineAt: At.nullable(),
  targetAt: At.nullable(),
  itemsOpen: z.number().int().nonnegative(),
  firstEffectAt: At.nullable(),
  lastEffectAt: At.nullable(),
  withinHour: z.boolean().nullable(),
});
export type OrderClock = z.infer<typeof OrderClock>;

/** One order on the list: its facts as typed, its clock (null for a DSA order), its state and its counts. */
export const OrderSummary = z.strictObject({
  id: z.uuid(),
  kind: z.enum(ORDER_KINDS),
  memberState: MemberStateCode,
  authority: z.string(),
  reference: z.string(),
  openedAt: At,
  state: z.enum(ORDER_STATES),
  clock: OrderClock.nullable(),
  /** A DSA order's deadline as its text states it, or null. */
  dueAt: At.nullable(),
  closedAt: At.nullable(),
  closeGround: z.enum(ORDER_CLOSE_GROUNDS).nullable(),
  items: z.number().int().nonnegative(),
  itemsInForce: z.number().int().nonnegative(),
  verified: z.boolean(),
  noticesHeld: z.number().int().nonnegative(),
});
export type OrderSummary = z.infer<typeof OrderSummary>;

/** GET /api/staff/orders: the orders that are not closed, the nearest deadline first, and those closed in the last 30 days. */
export const OrdersPage = z.strictObject({ open: z.array(OrderSummary), closed: z.array(OrderSummary) });
export type OrdersPage = z.infer<typeof OrdersPage>;

/** The stored states of a post, as an order's item reads them live. */
export const ORDER_ITEM_POST_STATES = ["visible", "withheld", "removed", "deleted_by_author", "disabled"] as const;

/** One item of an order: its link as named, what it resolved to (read live), and what became of it. */
export const OrderItemView = z.strictObject({
  id: z.uuid(),
  position: z.number().int().min(1).max(ORDER_ITEMS_MAX),
  link: z.string(),
  linkKind: z.enum(ORDER_LINK_KINDS),
  addedAt: At,
  /** The order is not verified, or the item was added after its verification. */
  unverified: z.boolean(),
  postId: z.uuid().nullable(),
  /** Null when the link named no post; the preview only while the post is public, and never an image. */
  post: z
    .strictObject({
      authorHandle: z.string().nullable(),
      state: z.enum(ORDER_ITEM_POST_STATES),
      images: z.number().int().nonnegative(),
      preview: z.string().nullable(),
      createdAt: At,
      deletedOn: z.iso.date().nullable(),
    })
    .nullable(),
  decisionId: z.uuid().nullable(),
  caseId: z.uuid().nullable(),
  inForce: z.boolean(),
  disabledAt: At.nullable(),
  noEffect: z.enum(["deleted", "already"]).nullable(),
  preserveUntil: At.nullable(),
  preserveEndedAt: At.nullable(),
  /**
   * Task 4 (sections 6.4 and 8.5, [item.erased]): when the preservation's end erased the post's content, the same instant
   * as preserveEndedAt; null while nothing was erased, and when the preservation ended without an erasure (a
   * reinstatement, a correction to another kind, or a measure no longer in force).
   */
  erasedAt: At.nullable(),
  reinstatedAt: At.nullable(),
  reinstatedGround: z.enum(ORDER_GROUNDS).nullable(),
  closedAt: At.nullable(),
  closedReason: z.enum(ORDER_ITEM_CLOSE_REASONS).nullable(),
  /** True when an open restore gap names the item (Task 6 builds the gaps); false until then. */
  gap: z.boolean(),
});
export type OrderItemView = z.infer<typeof OrderItemView>;

/** One event of an order: who wrote it as a staff handle, or null for the command line and the database. */
export const OrderEventView = z.strictObject({
  id: z.uuid(),
  kind: z.enum(ORDER_EVENT_KINDS),
  ground: z.string().nullable(),
  at: At,
  effectiveAt: At.nullable(),
  itemId: z.uuid().nullable(),
  by: z.string().nullable(),
  via: z.enum(ORDER_EVENT_VIA),
});
export type OrderEventView = z.infer<typeof OrderEventView>;

/** What the command line still owes an order (7.5), and until when korbat may ask for a scrutiny. */
export const OrderOwed = z.strictObject({
  received: z.boolean(),
  verification: z.boolean(),
  issuedAt: z.boolean(),
  texts: z.boolean(),
  document: z.boolean(),
  holdUntil: z.boolean(),
  tellPerson: z.boolean(),
  scrutinyUntil: At.nullable(),
});
export type OrderOwed = z.infer<typeof OrderOwed>;

/** An order's hold, for an order with Section C: its end (null while a DSA order's has none recorded) and what became of it. */
export const OrderHold = z.strictObject({
  until: At.nullable(),
  basis: z.enum(HOLD_BASES),
  open: z.boolean(),
  extended: z.boolean(),
  endedAt: At.nullable(),
  endReason: z.enum(HOLD_END_REASONS).nullable(),
  releasedAt: At.nullable(),
  noticesHeld: z.number().int().nonnegative(),
});
export type OrderHold = z.infer<typeof OrderHold>;

/**
 * GET /api/staff/orders/:order: the summary with its items as a list, the row's facts, the events oldest first, what the
 * command line owes, the hold, and the console's aids (the database decides). No text of reasons, redress, scope,
 * verified_how or hold_basis: those are the command line's, and the author's notice is where the first three are read.
 */
export const OrderView = OrderSummary.extend({
  channel: z.enum(ORDER_CHANNELS),
  messageId: z.uuid().nullable(),
  receivedAt: At.nullable(),
  sentAt: At.nullable(),
  issuedAt: At.nullable(),
  sectionC: z.boolean(),
  emergency: z.boolean(),
  crossBorder: z.boolean(),
  withholdFromAuthor: z.boolean(),
  preserve: z.boolean(),
  openedBy: z.string().nullable(),
  openedVia: z.enum(["console", "cli"]),
  importedAt: At.nullable(),
  tellPerson: z.strictObject({ rule: z.enum(TELL_PERSON_RULES), at: At.nullable() }).nullable(),
  items: z.array(OrderItemView).max(ORDER_ITEMS_MAX),
  events: z.array(OrderEventView),
  owed: OrderOwed,
  hold: OrderHold.nullable(),
  mayClose: z.boolean(),
  mayEvents: z.array(z.enum(ORDER_CONSOLE_EVENTS)),
  mayCorrect: z.enum(ORDER_CORRECTION_RULES).nullable(),
});
export type OrderView = z.infer<typeof OrderView>;

/** The one refusal of 3f that carries a member: order_exists names the order that stands, so the console links to it. */
export const OrderExistsDetails = z.strictObject({ orderId: z.uuid() });
export type OrderExistsDetails = z.infer<typeof OrderExistsDetails>;

// ---------------------------------------------------------------- giving effect (Task 3: 7.6, 7.9, 10.1, 10.3, 10.4)

/**
 * What an order decision is by its order's kind (10.1), which decisions_record forces and OrderEffectedParams therefore
 * does not carry. The category of a DSA Article 9 order is a filler for a column that may not be null: korbat did not
 * assess the content, and nothing reads the column for such a decision. A dsa_art10 order is never given effect.
 */
export const ORDER_DECISION = {
  tco_removal: { category: "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY", keyword: "KEYWORD_TERRORIST_CONTENT", preserves: true, effectBeforeVerified: true, holdBasis: "regulation" },
  dsa_art9: { category: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE", keyword: null, preserves: false, effectBeforeVerified: false, holdBasis: "authority" },
} as const;

/** One item of an effect: an order's item and the post it names, both in lower case. */
const EffectItem = z.strictObject({ itemId: LowerUuid, postId: LowerUuid });

/**
 * The step-up params of order_effected (10.3): the order's facts as the console showed them, `urgent` and the items, 1 to
 * itemsPerAction, sorted by postId with no repeat of either id, so one action has one hash and its order is the lock
 * order. `authority` and `reference` are the one named exception to the rule that a param is never a free string: an
 * authority's name and its file number, bound as an order's lines are, which decision_holds compares with the order's
 * row at commit. `withholdFromAuthor` is true for a removal order and whenever Section C is set, and `urgent` is refused
 * for a removal order (the database refuses it on a verified order too).
 */
export const OrderEffectedParams = z
  .strictObject({
    kind: z.enum(["tco_removal", "dsa_art9"]),
    memberState: MemberStateCode,
    authority: OrderAuthority,
    reference: OrderReference,
    sectionC: z.boolean(),
    emergency: z.boolean(),
    withholdFromAuthor: z.boolean(),
    urgent: z.boolean(),
    items: z.array(EffectItem).min(1).max(ORDER_RULES.itemsPerAction),
  })
  .superRefine((params, ctx) => {
    if ((params.kind === "tco_removal" || params.sectionC) && !params.withholdFromAuthor) {
      ctx.addIssue({ code: "custom", path: ["withholdFromAuthor"], message: "a removal order, and an order whose author must not be told, keeps the post from its author" });
    }
    if (params.kind === "tco_removal" && params.urgent) ctx.addIssue({ code: "custom", path: ["urgent"], message: "a removal order is given effect without a check first: urgent means nothing for it" });
    const posts = params.items.map((item) => item.postId);
    if (posts.some((post, i) => i > 0 && posts[i - 1]! >= post)) ctx.addIssue({ code: "custom", path: ["items"], message: "the items are sorted by post, without repeats" });
    if (!distinct(params.items.map((item) => item.itemId))) ctx.addIssue({ code: "custom", path: ["items"], message: "an item is named once" });
  });
export type OrderEffectedParams = z.infer<typeof OrderEffectedParams>;

/**
 * The fixed reasons of a reinstatement (W.2's reinstated.<ground>), which the composer saves as the correction's reason
 * and which nobody edits: a free text beside an order could say what a non-disclosure decision forbids.
 */
export const ORDER_DRAFTS = {
  reinstate: {
    withdrawn: "The authority that issued the order withdrew it.",
    annulled: "A court annulled the order.",
    scrutiny:
      "The competent authority of korbat's own Member State scrutinised the order and decided that it infringes the Regulation or fundamental rights, so the order no longer has effect (Article 4 of Regulation (EU) 2021/784).",
    not_authentic: "The order was not authentic: it did not come from the authority it named. korbat disabled your post on a forged order, and regrets it.",
    wrong_item: "korbat made a mistake: the order did not name this post. korbat disabled it wrongly, and regrets it.",
  },
} as const satisfies { reinstate: Record<OrderGround, string> };

const Day = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "must be a UTC day");

/**
 * What an order's notice is rendered from (10.4, W.2), built by the API at every read from the decision's row, its item's
 * and the order's as they stand, so the notice grows without a new decision. `verified` says whether order-verify has
 * run (until then the lead says only that the order names that authority); `orderedOn` is the day of the order's own
 * time stamp (`orderedFrom` issued) or of its receipt (received), or null; `held` whether the notice was held, and
 * `informedAt` the one instant the author was told (the release, for a held one); `holdEndReason` a hold ended by hand.
 */
export const OrderNoticeFacts = z.object({
  kind: z.enum(["tco_removal", "dsa_art9"]),
  memberState: MemberStateCode,
  authority: z.string(),
  reference: z.string(),
  verified: z.boolean(),
  orderedOn: Day.nullable(),
  orderedFrom: z.enum(["issued", "received"]).nullable(),
  crossBorder: z.boolean(),
  homeState: MemberStateCode.nullable(),
  withholdAuthor: z.boolean(),
  disabledAt: At,
  held: z.boolean(),
  informedAt: At.nullable(),
  holdEndReason: z.enum(HOLD_END_REASONS).nullable(),
  preserveUntil: At.nullable(),
  preserveExtended: z.boolean(),
  preserveEndedOn: Day.nullable(),
  orderGround: z.enum(ORDER_GROUNDS).nullable(),
});
export type OrderNoticeFacts = z.infer<typeof OrderNoticeFacts>;

/** The authority's words as the command line recorded them, read fresh, and since when the author holds the newest (10.4). */
export const OrderTexts = z.object({ reasons: z.string().nullable(), redress: z.string().nullable(), scope: z.string().nullable(), textsAt: At.nullable() });
export type OrderTexts = z.infer<typeof OrderTexts>;

/** Home's [home.unverified] (10.2): the orders with a disabled item that are not verified, or whose disabled item was added after the check. */
export const OrdersUnverified = z.object({ total: z.number().int().nonnegative(), items: z.array(z.object({ orderId: z.uuid(), effectAt: At })).max(100) });
export type OrdersUnverified = z.infer<typeof OrdersUnverified>;

/**
 * Task 5 (sections 7.13 and 10.2): what `reports_owed()` answers and nothing more, for Home's [home.owed]: each owed
 * notification record's case, its kind (`sealed_images` for a seal's record, otherwise its first duty) and since when.
 * Who was reported to whom is the command line's alone.
 */
export const REPORT_OWED_KINDS = ["sealed_images", ...NOTIFICATION_DUTIES] as const;
export const ReportsOwed = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(z.object({ caseId: z.uuid(), kind: z.enum(REPORT_OWED_KINDS), since: At })).max(100),
});
export type ReportsOwed = z.infer<typeof ReportsOwed>;

// ---------------------------------------------------------------- recovery (sections 6.6, 7.16, 7.17 and 10.1; Task 6)

/**
 * What an import after a restore found lost, by class, in the order in which a person takes it again (7.17, row 38): an
 * order's disablings, seals for good, seals taken while deciding, suspensions and terminations, other restrictions,
 * reversals, decisions without a measure (for reference), and the records the import could only note. The one list of
 * the CHECK on restore_gaps.class, of the import, of the console's After a restore screen and of the home screen's count.
 */
export const GAP_CLASSES = ["order_effect", "seal_final", "seal_interim", "standing", "restriction", "reversal", "no_measure", "record"] as const;
export type GapClass = (typeof GAP_CLASSES)[number];
/** How a gap was closed: by a decision that took the measure again, by an admin as not needed, or as a record written again. */
export const GAP_DISPOSITIONS = ["reapplied", "not_needed", "imported"] as const;
export type GapDisposition = (typeof GAP_DISPOSITIONS)[number];
/** The classes 1 to 5: lost measures. While one of them is open, retention and the image sweep stay off (7.17 step 8). */
export const GAP_MEASURE_CLASSES = GAP_CLASSES.slice(0, 5) as readonly GapClass[];
/** The classes 1 to 3: while one of them is open, the app's site stays closed (RestoreView.mayOpen). */
export const GAP_SITE_CLASSES = GAP_CLASSES.slice(0, 3) as readonly GapClass[];

/** The most rows one download of the audit log's tail holds (7.16): a longer log is taken in several downloads. */
export const AUDIT_EXPORT_MAX = 50_000;
