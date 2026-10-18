import { z } from "zod";

// Authorities' orders and the alert channel (3f design, sections 6.1, 10.1, 10.2 and 18, W.1 and W.4). This module
// imports nothing from the other modules of the contracts: moderation.ts reads its constants for the staff overview, and
// the watcher (apps/api/src/notify), which imports the contracts and nothing of the API, renders its pushes from it.

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
