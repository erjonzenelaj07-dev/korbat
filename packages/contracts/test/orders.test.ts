import { describe, expect, test } from "vitest";
import {
  ALERT_CHANNEL_STATES,
  ALERT_KINDS,
  ALERT_KIND_LIST,
  ALERT_RULES,
  ALERT_TEXTS,
  CONTACT_CLOSE_DISPOSITIONS,
  CONTACT_DISPOSITIONS,
  CONTACT_FOLDERS,
  CONTACT_PAGE_SIZE,
  ContactCloseRequest,
  ContactPage,
  ContactQuery,
  DISPOSITION_LABELS,
  ModerationErrorCode,
  NOTIFY_ERRORS,
  ORDER_RULES,
  QUARANTINE_RULES,
  StaffOverview,
  alertPlaceholders,
  alertTime,
  isTimeFact,
  renderAlert,
  type AlertFacts,
  type AlertKind,
} from "../src/index";

/**
 * Authorities' orders and the alert channel (3f design, sections 6.1, 10.1, 10.2 and 18, W.4): the numbers the database
 * reads, the closed lists, the alert kinds with their legs, and the fixed texts of a push and of 3f's staff mails, which
 * carry counts and UTC times only (invariant 15).
 */

describe("ORDER_RULES and ALERT_RULES", () => {
  test("ORDER_RULES holds every number of order_rules(), each the column's name in camel case, with the design's values", () => {
    expect(ORDER_RULES).toEqual({
      hourMinutes: 60,
      targetMinutes: 55,
      itemsPerAction: 10,
      decisionsPerDay: 50,
      recordsPerDay: 20,
      holdDays: 43,
      holdExtensionDays: 42,
      holdWarningDays: 7,
      unconfirmedHoldHours: null,
      preserveMonths: 6,
      preserveMarginDays: 1,
      reportHoldDays: 7,
      reportAlertHours: 24,
      staleHours: 2,
      quietMinutes: 15,
      escalateMinutes: 15,
      remindMinutes: 45,
      channelDownMinutes: 3,
      pushOwedMinutes: 60,
      copyOverdueHours: 48,
      handoverAlertDays: 7,
      messageKeepDays: 30,
      recordKeepYears: 3,
      gapKeepMonths: 12,
    });
  });

  test("a hold with its one extension ends before the preservation does: hold_days + hold_extension_days days are fewer than preserve_months months", () => {
    // The shortest run of preserve_months calendar months has this many days (February in a common year among them).
    const shortestMonths = 30 * ORDER_RULES.preserveMonths - 3;
    expect(ORDER_RULES.holdDays + ORDER_RULES.holdExtensionDays).toBeLessThan(shortestMonths);
  });

  test("ALERT_RULES holds only what the database never reads, and no name is in both tables", () => {
    expect(ALERT_RULES).toEqual({ pollSeconds: 20, tickSeconds: 30, mailRetryHours: 24 });
    for (const name of Object.keys(ALERT_RULES)) expect(Object.keys(ORDER_RULES), name).not.toContain(name);
  });
});

describe("the closed lists", () => {
  test("a message's dispositions, of which the close route takes all but order, and its two folders", () => {
    expect(CONTACT_DISPOSITIONS).toEqual(["order", "referral", "first_order_notice", "preservation_request", "scrutiny_decision", "clarification", "not_an_order"]);
    expect(CONTACT_CLOSE_DISPOSITIONS).toEqual(CONTACT_DISPOSITIONS.filter((d) => d !== "order"));
    expect(CONTACT_FOLDERS).toEqual(["inbox", "junk"]);
    expect(CONTACT_PAGE_SIZE).toBe(50);
  });

  test("the watcher's eight error words, and the channel's four states", () => {
    expect(NOTIFY_ERRORS).toEqual(["imap_connect", "imap_timeout", "imap_tls", "imap_login", "imap_folder", "imap_protocol", "push_connect", "push_refused"]);
    expect(ALERT_CHANNEL_STATES).toEqual(["ok", "down", "mailbox", "off"]);
  });

  test("each disposition has its label (W.1): the six of the Contact point screen and An order", () => {
    expect(DISPOSITION_LABELS).toEqual({
      order: "An order",
      referral: "Referral",
      first_order_notice: "Notice before a first order",
      preservation_request: "Request to preserve longer",
      scrutiny_decision: "Scrutiny decision",
      clarification: "About an order korbat holds",
      not_an_order: "Not an order",
    });
  });

  test("message_handled is a moderation code", () => {
    expect(ModerationErrorCode.options).toContain("message_handled");
  });
});

describe("the contact point's requests and answers", () => {
  const message = {
    id: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
    folder: "junk",
    receivedAt: "2026-10-12T22:01:02.003Z",
    seenAt: "2026-10-12T22:01:20.000Z",
    stale: false,
    disposition: null,
    handledAt: null,
    handledBy: null,
    orders: [],
  };

  test("ContactPage: messages without a sender or a subject, each strict, at most a page of them", () => {
    expect(ContactPage.parse({ items: [message], nextCursor: null })).toEqual({ items: [message], nextCursor: null });
    expect(ContactPage.safeParse({ items: [{ ...message, subject: "x" }], nextCursor: null }).success).toBe(false);
    expect(ContactPage.safeParse({ items: [{ ...message, folder: "spam" }], nextCursor: null }).success).toBe(false);
    expect(ContactPage.safeParse({ items: Array.from({ length: CONTACT_PAGE_SIZE + 1 }, () => message), nextCursor: null }).success).toBe(false);
    const handled = { ...message, disposition: "not_an_order", handledAt: "2026-10-12T22:05:00.000Z", handledBy: "mod_anna" };
    expect(ContactPage.parse({ items: [handled], nextCursor: "abc" }).items[0]!.handledBy).toBe("mod_anna");
  });

  test("ContactQuery takes a cursor and open=1 only; ContactCloseRequest a disposition other than order", () => {
    expect(ContactQuery.parse({})).toEqual({});
    expect(ContactQuery.parse({ open: "1", cursor: "abc" })).toEqual({ open: "1", cursor: "abc" });
    expect(ContactQuery.safeParse({ open: "0" }).success).toBe(false);
    expect(ContactQuery.safeParse({ other: "1" }).success).toBe(false);
    for (const disposition of CONTACT_CLOSE_DISPOSITIONS) expect(ContactCloseRequest.parse({ disposition })).toEqual({ disposition });
    expect(ContactCloseRequest.safeParse({ disposition: "order" }).success).toBe(false);
    expect(ContactCloseRequest.safeParse({ disposition: "referral", note: "x" }).success).toBe(false);
  });

  test("StaffOverview carries the contact point's counts and the channel's state", () => {
    const shape = StaffOverview.shape;
    expect(shape.contact.parse({ open: 2, oldestAt: message.receivedAt, dueAt: message.receivedAt })).toEqual({ open: 2, oldestAt: message.receivedAt, dueAt: message.receivedAt });
    expect(shape.alerts.parse({ channel: "off", since: null })).toEqual({ channel: "off", since: null });
    expect(shape.alerts.safeParse({ channel: "broken", since: null }).success).toBe(false);
  });
});

describe("ALERT_KINDS (10.1): the closed list of alerts with each kind's priority, scope, legs, mail and facts", () => {
  test("the 24 kinds, 3f's sixteen, then 3c's and 3e's six, then 3d's, in the order of the CHECK", () => {
    expect([...ALERT_KIND_LIST]).toEqual([
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
      "quarantine_due",
      "quarantine_lost",
      "release_undestroyed",
      "seal_released",
    ]);
    expect(Object.keys(ALERT_KINDS).sort()).toEqual([...ALERT_KIND_LIST].sort());
    expect(Object.keys(ALERT_TEXTS).sort()).toEqual([...ALERT_KIND_LIST].sort());
  });

  test("each kind's priority, scope, legs and mail are the table's", () => {
    const row = (kind: AlertKind) => {
      const k = ALERT_KINDS[kind];
      return [k.priority, k.scope, k.legs.join("+"), k.mail];
    };
    const table: Record<AlertKind, unknown[]> = {
      contact_mail: [5, "on_call", "push+mail", "sentence"],
      contact_mail_escalated: [5, "all", "push+mail", "sentence"],
      order_due: [5, "all", "push+mail", "sentence"],
      order_unverified: [5, "all", "push+mail", "sentence"],
      report_owed: [5, "all", "push+mail", "sentence"],
      hold_ending: [3, "all", "push+mail", "sentence"],
      handover_undestroyed: [3, "all", "push+mail", "sentence"],
      copy_overdue: [3, "all", "push+mail", "sentence"],
      alert_test: [3, "all", "push", null],
      order_opened: [3, "all", "push+mail", "sentence"],
      order_corrected: [3, "all", "push+mail", "sentence"],
      order_effected: [3, "all", "push+mail", "sentence"],
      order_reinstated: [3, "all", "push+mail", "sentence"],
      copy_taken: [3, "all", "push+mail", "sentence"],
      mailbox_unreachable: [5, "all", "push+mail", "sentence"],
      alert_channel_down: [3, "all", "mail", "sentence"],
      moderation_urgent: [5, "on_call", "push+mail", "own"],
      moderation_waiting: [3, "all", "push+mail", "own"],
      moderation_burst: [3, "all", "push+mail", "own"],
      moderation_reads: [3, "all", "push+mail", "own"],
      moderation_reveal: [3, "all", "push+mail", "own"],
      moderation_csam_lifted: [3, "all", "push+mail", "own"],
      quarantine_due: [3, "all", "push+mail", "sentence"],
      quarantine_lost: [3, "all", "push+mail", "sentence"],
      release_undestroyed: [3, "all", "push+mail", "sentence"],
      seal_released: [3, "all", "push+mail", "sentence"],
    };
    for (const kind of ALERT_KIND_LIST) expect(row(kind), kind).toEqual(table[kind]);
  });

  test("each kind's facts are the design's names, at most six, each a count or a time", () => {
    const facts = Object.fromEntries(ALERT_KIND_LIST.map((kind) => [kind, [...ALERT_KINDS[kind].facts]]));
    expect(facts).toEqual({
      contact_mail: ["receivedAt", "dueAt"],
      contact_mail_escalated: ["receivedAt", "dueAt"],
      order_due: ["dueAt", "minutesLeft", "itemsOpen"],
      order_opened: ["items", "dueAt", "unknown"],
      order_corrected: ["count", "at"],
      order_effected: ["items", "at", "itemsOpen", "urgent"],
      order_reinstated: ["at"],
      order_unverified: ["count", "textsMissing", "holdsOpen", "oldestAt"],
      hold_ending: ["count", "at"],
      report_owed: ["count", "oldestAt"],
      handover_undestroyed: ["count"],
      copy_overdue: ["hours"],
      copy_taken: ["at", "rows"],
      alert_channel_down: ["since"],
      mailbox_unreachable: ["since"],
      alert_test: ["at"],
      moderation_urgent: ["count", "oldestAt"],
      moderation_waiting: ["count"],
      moderation_burst: ["count"],
      moderation_reads: ["limit"],
      moderation_reveal: ["at"],
      moderation_csam_lifted: ["at"],
      quarantine_due: ["count", "oldestAt"],
      quarantine_lost: ["count", "at"],
      release_undestroyed: ["count", "oldestAt"],
      seal_released: ["at", "posts", "uploads"],
    });
    for (const kind of ALERT_KIND_LIST) expect(ALERT_KINDS[kind].facts.length, kind).toBeLessThanOrEqual(6);
    expect(["receivedAt", "dueAt", "oldestAt", "at", "since"].every(isTimeFact)).toBe(true);
    expect(["count", "items", "minutesLeft", "hours", "rows", "limit", "urgent"].some(isTimeFact)).toBe(false);
  });

  test("every kind says whether its mail is its sentence, its own, or none; a kind is mailed exactly when it has a mail leg", () => {
    for (const kind of ALERT_KIND_LIST) {
      const k = ALERT_KINDS[kind];
      expect(k.legs.includes("mail"), kind).toBe(k.mail !== null);
      expect(["sentence", "own", null], kind).toContain(k.mail);
      // A kind of 3f has a line of what to do exactly when its mail is its sentence; 3c's and 3e's keep their own mails.
      expect(ALERT_TEXTS[kind].todo !== null, kind).toBe(k.mail === "sentence");
    }
    expect(ALERT_KIND_LIST.filter((kind) => ALERT_KINDS[kind].mail === "own")).toEqual(["moderation_urgent", "moderation_waiting", "moderation_burst", "moderation_reads", "moderation_reveal", "moderation_csam_lifted"]);
  });
});

describe("ALERT_TEXTS (W.4): one text serves both legs, and it carries counts and times only (invariant 15)", () => {
  const now = new Date("2026-10-16T09:00:00.000Z");
  /** One set of facts for a kind: every count is `n`, every time the given instant. */
  const factsOf = (kind: AlertKind, n: number, time: string, over: Partial<Record<string, number | string | undefined>> = {}): AlertFacts => {
    const facts: Record<string, number | string> = {};
    for (const name of ALERT_KINDS[kind].facts) facts[name] = isTimeFact(name) ? time : n;
    for (const [name, value] of Object.entries(over)) {
      if (!ALERT_KINDS[kind].facts.includes(name)) continue;
      if (value === undefined) delete facts[name];
      else facts[name] = value;
    }
    return facts;
  };
  const DIGITS = /[0-9]/g;
  const all = (kind: AlertKind, facts: AlertFacts) => {
    const r = renderAlert(kind, facts, now);
    return [r.title, r.sentence, r.todo ?? ""].join(" | ");
  };

  test("rendered with two sets of facts, every kind's title, sentence and line differ only in their digits", () => {
    for (const kind of ALERT_KIND_LIST) {
      // The flags of order_effected and order_opened chose a variant: both sets hold the same flags.
      const flags = { urgent: 0, unknown: 0 };
      const first = all(kind, factsOf(kind, 3, "2026-10-16T07:05:00.000Z", flags));
      const second = all(kind, factsOf(kind, 1234, "2026-10-16T22:49:59.999Z", flags));
      expect(first.replace(DIGITS, ""), kind).toBe(second.replace(DIGITS, ""));
      expect(first, kind).not.toBe(second);
    }
  });

  test("no entry holds an @, a link or a placeholder that is neither a fact of its kind nor a number of ORDER_RULES or QUARANTINE_RULES", () => {
    for (const kind of ALERT_KIND_LIST) {
      const text = ALERT_TEXTS[kind];
      const words = [text.title, ...text.sentence.map((part) => part.text), text.todo ?? ""].join(" ");
      expect(words, kind).not.toContain("@");
      expect(words.toLowerCase(), kind).not.toContain("http");
      for (const name of alertPlaceholders(kind)) {
        expect([...ALERT_KINDS[kind].facts, ...Object.keys(ORDER_RULES), ...Object.keys(QUARANTINE_RULES)], `${kind}: {${name}}`).toContain(name);
      }
      // Every number a sentence of 3f prints comes from the facts or from ORDER_RULES: no digit is typed. 3c's burst
      // window is 3c's own number, which its push names as its mail does.
      if (ALERT_KINDS[kind].mail !== "own") expect(words.replace(/[{][a-zA-Z]+[}]/g, ""), kind).not.toMatch(DIGITS);
    }
  });

  test("a time prints as 14:05 UTC, with the day when it is not the day of the alert", () => {
    expect(alertTime("2026-10-16T14:05:59.000Z", now)).toBe("14:05 UTC");
    expect(alertTime("2026-10-15T23:59:00.000Z", now)).toBe("2026-10-15 23:59 UTC");
    expect(alertTime("2026-10-17T00:00:00.000Z", now)).toBe("2026-10-17 00:00 UTC");
  });

  test("the words of the kinds Task 1 sends, as W.4 has them", () => {
    const mail = renderAlert("contact_mail", { receivedAt: "2026-10-16T08:05:00.000Z", dueAt: "2026-10-16T09:05:00.000Z" }, now);
    expect(mail).toEqual({
      title: "Mail at the contact point",
      sentence: "Mail at the authorities' contact point, received 08:05 UTC. If it is a removal order it is due 09:05 UTC.",
      todo: `Read it in the mail host's app, never in korbat, and with it every other new message there: further mail within ${ORDER_RULES.quietMinutes} minutes raises no alarm of its own. Then open Contact point in the staff console. What ends this message's alarms is handling it there: opening an order from it, or closing it.`,
    });
    // A restart of an order's clock has no time of receipt.
    expect(renderAlert("contact_mail", { dueAt: "2026-10-16T09:05:00.000Z" }, now).sentence).toBe("A removal order's hour has started again: due 09:05 UTC.");
    expect(renderAlert("contact_mail_escalated", { receivedAt: "2026-10-16T08:05:00.000Z", dueAt: "2026-10-16T09:05:00.000Z" }, now)).toEqual({
      title: "Nobody has answered: mail at the contact point",
      sentence: "Nobody has answered the mail that arrived at the authorities' contact point at 08:05 UTC. If it is a removal order it is due 09:05 UTC.",
      todo: "This went to every staff phone. Whoever reads it first acts, and tells the others.",
    });
    const due = renderAlert("order_due", { dueAt: "2026-10-16T09:05:00.000Z", minutesLeft: 15 }, now);
    expect(due.title).toBe("15 minutes left");
    expect(due.sentence).toBe("A removal order, or mail that may be one, is due 09:05 UTC: 15 minutes are left and it is not carried out in full.");
    expect(due.todo).toBe(
      "Give effect now, to every post the order names. Only if the order has a manifest error, or lacks what you need to find the content, send Annex III and record it: that is no way to stop this alarm. If nobody can act in time: the README, When nobody can act within the hour.",
    );
    expect(renderAlert("mailbox_unreachable", { since: "2026-10-15T23:00:00.000Z" }, now)).toEqual({
      title: "The contact point cannot be read",
      sentence: "korbat has not been able to read the contact-point mailbox since 2026-10-15 23:00 UTC.",
      todo: `Mail that arrives there raises no alert now. Check the mailbox in the mail host's app until this is repaired; an order you find there is opened in the console under Orders, with "The message is not listed". The operator checks the password and the mail host.`,
    });
    expect(renderAlert("alert_channel_down", { since: "2026-10-16T08:57:00.000Z" }, now)).toEqual({
      title: "Phone alerts are down",
      sentence: "Phone alerts are down since 08:57 UTC: korbat's watcher or its push server does not answer.",
      todo: `Until it is repaired, korbat wakes nobody: the mail host's own app on the on-call phone, signed in to the contact-point mailbox and allowed to ring at night, is the only thing that does. Check now that it is. An order you find there is opened in the console under Orders, with "The message is not listed". The operator restarts the notify and ntfy services.`,
    });
    expect(renderAlert("alert_test", { at: "2026-10-16T08:00:00.000Z" }, now)).toEqual({ title: "Daily test", sentence: "Daily test, 08:00 UTC. If you read this on your phone, alerts reach it. Nothing to do.", todo: null });
  });

  test("the pushes of 3c's and 3e's kinds name nobody", () => {
    expect(renderAlert("moderation_urgent", { count: 2, oldestAt: "2026-10-16T08:30:00.000Z" }, now)).toEqual({ title: "Urgent lane", sentence: "2 cases wait in the urgent lane, the oldest since 08:30 UTC.", todo: null });
    expect(renderAlert("moderation_waiting", { count: 4 }, now).sentence).toBe("4 cases or replies are waiting longer than their response time.");
    expect(renderAlert("moderation_burst", { count: 20 }, now).sentence).toBe("One staff account confirmed 20 decisions in 15 minutes. The staff mail says which.");
    expect(renderAlert("moderation_reads", { limit: 200 }, now).sentence).toBe("One staff account opened 200 different cases today. The staff mail says which.");
    expect(renderAlert("moderation_reveal", { at: "2026-10-16T08:59:00.000Z" }, now).sentence).toBe("One staff account revealed who sent a report, at 08:59 UTC. The staff mail says which.");
    expect(renderAlert("moderation_csam_lifted", { at: "2026-10-16T08:59:00.000Z" }, now)).toEqual({
      title: "Reported images are no longer protected",
      sentence: "A decision at 08:59 UTC ended the protection of reported images. Read the staff mail.",
      todo: null,
    });
  });

  test("the variants a fact chooses: an order given effect as urgent, with items still open; the counts of what an order misses", () => {
    expect(renderAlert("order_effected", { items: 3, at: "2026-10-16T08:59:00.000Z", itemsOpen: 0, urgent: 0 }, now).sentence).toBe("An order was given effect at 08:59 UTC: 3 posts disabled.");
    expect(renderAlert("order_effected", { items: 2, at: "2026-10-16T08:59:00.000Z", itemsOpen: 1, urgent: 1 }, now).sentence).toBe(
      "An order that is not verified was given effect as urgent at 08:59 UTC: 2 posts disabled. 1 items of the order are still open.",
    );
    expect(renderAlert("order_opened", { items: 2, dueAt: "2026-10-16T09:30:00.000Z", unknown: 0 }, now).sentence).toBe("An order was opened: 2 items. Due 09:30 UTC.");
    expect(renderAlert("order_opened", { items: 1, unknown: 0 }, now).sentence).toBe("An order was opened: 1 items. No deadline runs.");
    expect(renderAlert("order_opened", { items: 1, unknown: 1 }, now).sentence).toBe("An order was opened: 1 items. Its deadline is unknown: act now.");
    expect(renderAlert("order_unverified", { count: 1, textsMissing: 0, holdsOpen: 2, oldestAt: "2026-10-14T08:00:00.000Z" }, now).sentence).toBe(
      "1 orders are given effect and not verified, or hold a post added after their check, the oldest since 2026-10-14 08:00 UTC. 2 hold a notice with no end recorded.",
    );
    expect(renderAlert("hold_ending", { count: 2, at: "2026-10-20T00:00:00.000Z" }, now).sentence).toBe(`2 held notices are released within ${ORDER_RULES.holdWarningDays} days, the first on 2026-10-20 00:00 UTC.`);
    expect(renderAlert("report_owed", { count: 1, oldestAt: "2026-10-14T08:00:00.000Z" }, now).sentence).toBe(
      `1 reports to the authorities have been owed for more than ${ORDER_RULES.reportAlertHours} hours, the oldest since 2026-10-14 08:00 UTC.`,
    );
  });

  test("a fact that is missing, of another kind, or a string that is no time is refused", () => {
    expect(() => renderAlert("contact_mail_escalated", { receivedAt: "2026-10-16T08:05:00.000Z" }, now)).toThrow(/dueAt/);
    expect(() => renderAlert("moderation_waiting", { count: 1, handle: 7 }, now)).toThrow(/handle/);
    expect(() => renderAlert("alert_test", { at: "mod_anna" }, now)).toThrow(/at/);
    expect(() => renderAlert("moderation_waiting", { count: "4" }, now)).toThrow(/count/);
  });
});
