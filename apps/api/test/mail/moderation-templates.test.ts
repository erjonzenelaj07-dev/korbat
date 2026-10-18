import { describe, expect, test } from "vitest";
import { ACCOUNT_ITEM_SCOPE, ACCOUNT_SUSPECT_SCOPE, ALERT_KINDS, ALREADY_NOT_SHOWN, QUOTE_ITEM_SCOPE, REPLY_AIM_HOURS, SENTENCE_MAIL_KINDS, STANDING_RULES, SUSPECT_OUTCOME_PHRASES, UNSEEN_NO_ACTION, isTimeFact, outcomeWords, renderAlert, type AlertKind } from "@korbat/contracts";
import { noticeTime } from "../../src/auth/flows/notify";
import type { MailMessage, NoticeUpdateData, NoticeUpdateLine, TemplateName } from "../../src/mail/mailer";
import { MemoryMailer } from "../../src/mail/memory";
import { TICK_MAILED_KINDS } from "../../src/moderation/alerts";
import { ACCOUNT_DELETED_HELD, DECISION_MAIL_SUBJECTS, renderMail, renderNoticeUpdate, renderTemplate } from "../../src/mail/templates";

/**
 * The mails of deciding and of the dispatch (3c design, section 7.15): the author's statement, the staff alerts for a
 * burst of decisions, for a decision that lifted the protection of reported images and for cases that wait too long, and
 * the one structured mail, the daily update of decisions on a person's reports. Each is pinned word for word.
 */
const LAST_USER = "korbat staff never ask for your password or a code, and korbat does not read replies to this email.";
const LAST_STAFF = "korbat never puts a link in a staff email.";
const paragraphs = (text: string) => text.trimEnd().split("\n\n");
const TIME = "2026-10-04 06:59 UTC";

/** No link of any kind, and the staff mails' last sentence. */
function linkless(r: { text: string; html: string }) {
  expect(r.text).not.toMatch(/https?:|www[.]|:[/][/]/);
  expect(r.html).not.toMatch(/<img|<a |href=|https?:/);
  expect(paragraphs(r.text).at(-1)).toBe(LAST_STAFF);
}

describe("the closed union of templates", () => {
  test("holds 59 templates: the 25 before moderation cases, the nine of 3c, the two of 3e's Task 3, the three of its Task 4, the two of its Task 5, the five staff mails of 3f's Task 1, the three of its Task 2, the six of its Task 3, the two of its Task 6 and the two of its Task 5 that its review joined", () => {
    // Every name is written out: a template added or dropped changes this list.
    const names = [
      "sign_in_code", "sign_up_code", "reauth_code", "new_device", "account_locked", "mfa_enabled", "mfa_disabled", "password_changed", "recovery_codes_regenerated", "sessions_revoked_all",
      "email_change_code", "email_changed", "email_change_reverted", "badge_verified", "badge_removed", "delete_account_code", "account_deleted", "passkey_added", "passkey_removed", "passkey_suspect",
      "recovery_code_used", "staff_key_added", "staff_session_started", "staff_key_suspect", "staff_keys_revoked",
      "notice_received", "notice_update", "moderation_decision", "moderation_urgent", "moderation_waiting", "moderation_burst", "moderation_reads", "moderation_reveal", "moderation_csam_lifted",
      "suspension_started_at_once", "suspension_lifted",
      "suspension_announced", "reply_answered", "termination_final",
      "reporting_warned", "reporting_restricted",
      "contact_mail", "contact_mail_escalated", "order_due", "mailbox_unreachable", "alert_channel_down",
      "order_opened", "order_corrected", "order_unverified",
      "order_effected", "order_reinstated", "hold_ending", "order_notice", "order_reinstated_notice", "order_notice_added",
      "copy_overdue", "copy_taken",
      "report_owed", "handover_undestroyed",
    ] as const satisfies readonly TemplateName[];
    expect(new Set(names).size).toBe(59);
    // Each name is a template the union holds, and the union holds no other: the assignment below would not compile.
    const all: Record<TemplateName, true> = Object.fromEntries(names.map((name) => [name, true])) as Record<(typeof names)[number], true>;
    expect(Object.keys(all)).toHaveLength(59);
  });
});

describe("moderation_decision: the statement of reasons, to its author", () => {
  const statement = ["korbat removed your post of 2026-10-01 12:00 UTC: other people can no longer see it.", "The facts: The post offers followers for money.", "You can appeal this decision once."].join("\n");

  test("the subject follows the decision's kind and outcome, from one table", () => {
    expect(DECISION_MAIL_SUBJECTS).toEqual({
      seal_deciding: "korbat sealed images of yours while it decides",
      seal_final: "korbat sealed images of yours",
      post_deciding: "A post of yours is under review on korbat",
      profile_deciding: "korbat reset part of your profile while it decides",
      post_restricted: "korbat restricted a post of yours",
      profile_restricted: "korbat restricted part of your profile",
      lifted_deciding: "korbat lifted a restriction it placed while deciding",
      reversed: "korbat reversed a decision about your account",
      appeal_kept: "korbat answered your appeal",
    });
    for (const [key, subject] of Object.entries(DECISION_MAIL_SUBJECTS)) expect(renderTemplate("moderation_decision", { subject: key, statement }).subject, key).toBe(subject);
    // A subject that is no key of the table is a programming error, never printed as given.
    expect(() => renderTemplate("moderation_decision", { subject: "Click here to appeal", statement })).toThrow(/subject/);
  });

  test("the statement's paragraphs, one per line of the data, then where to read it, and that no korbat mail carries a link to act on a decision", () => {
    const r = renderTemplate("moderation_decision", { subject: "post_restricted", statement });
    expect(paragraphs(r.text)).toEqual([
      "korbat removed your post of 2026-10-01 12:00 UTC: other people can no longer see it.",
      "The facts: The post offers followers for money.",
      "You can appeal this decision once.",
      "Read it in korbat under Settings, Cases. korbat's emails never contain a link to act on a decision.",
      LAST_USER,
    ]);
    expect(r.text).not.toMatch(/https?:|:[/][/]/);
    expect(r.html).not.toMatch(/<img|<a |href=/);
    // A staff text is only ever text: what it holds never becomes markup, and an empty line is no paragraph.
    const hostile = renderTemplate("moderation_decision", { subject: "post_restricted", statement: "The facts: <script>alert(1)</script>\n\nkorbat's reasons: <b>x</b>" });
    expect(hostile.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(hostile.html).not.toMatch(/<script|<b>/);
    expect(paragraphs(hostile.text)).toHaveLength(4);
    expect(() => renderTemplate("moderation_decision", { subject: "post_restricted" })).toThrow(/statement/);
    expect(() => renderTemplate("moderation_decision", { statement })).toThrow(/subject/);
  });
});

describe("the staff alerts of deciding", () => {
  test("moderation_burst names the staff account and how many decisions it confirmed, tells its holder what to do, and carries no link", () => {
    const r = renderTemplate("moderation_burst", { handle: "mod_anna", count: "20" });
    expect(r.subject).toBe("korbat: many staff decisions in a short time");
    expect(paragraphs(r.text)).toEqual([
      "The staff account @mod_anna confirmed 20 decisions in the last 15 minutes.",
      "Every staff account gets this email. If @mod_anna is your account and you did not confirm them, someone else holds your key: tell the operator at once.",
      "If that was not expected, ask them; if their key may be in someone else's hands, the operator revokes it with staff.js revoke.",
      LAST_STAFF,
    ]);
    linkless(r);
    expect(() => renderTemplate("moderation_burst", { handle: "mod_anna" })).toThrow(/count/);
    expect(() => renderTemplate("moderation_burst", { count: "20" })).toThrow(/handle/);
  });

  test("moderation_csam_lifted has two texts for what the decision did, and says what staff do next", () => {
    const data = { handle: "mod_anna", time: TIME, what: "unsealed" };
    const unsealed = renderTemplate("moderation_csam_lifted", data);
    expect(unsealed.subject).toBe("korbat: reported images are no longer protected");
    expect(paragraphs(unsealed.text)).toEqual([
      `The staff account @mod_anna confirmed a decision at ${TIME} that lifted a seal.`,
      "Unless another seal or another open report of this kind still covers them, the images its case reaches are served again as before and staff may open them. After an answer without a seal, whoever is on duty opens them the same day and, where one breaks a rule or the law, opens a finding on its post. Nobody at korbat could open those images while they were protected.",
      "Every staff account gets this email. If @mod_anna is your account and you did not confirm it, someone else holds your key: tell the operator at once.",
      "The staff console's home screen lists every such decision of the last 30 days with its case. A seal for good is lifted only on the answer of the authority korbat reported the images to, and a seal taken while deciding only when it was taken in error: the operator compares this decision with their R2 records. If it was not expected, ask them; if their key may be in someone else's hands, the operator revokes it with staff.js revoke, and whoever is on duty opens a finding citing R2 on the post or the account and seals its images while deciding.",
      LAST_STAFF,
    ]);
    linkless(unsealed);
    const dismissed = renderTemplate("moderation_csam_lifted", { ...data, what: "dismissed" });
    expect(paragraphs(dismissed.text)[0]).toBe(`The staff account @mod_anna confirmed a decision at ${TIME} that answered a report or finding of child sexual abuse material without a seal.`);
    expect(paragraphs(dismissed.text).slice(1)).toEqual(paragraphs(unsealed.text).slice(1));
    linkless(dismissed);
    // What it did is one of two words, never a text handed over.
    expect(() => renderTemplate("moderation_csam_lifted", { ...data, what: "released the images" })).toThrow(/what/);
    for (const key of Object.keys(data)) {
      const { [key]: _left, ...rest } = data as Record<string, string>;
      expect(() => renderTemplate("moderation_csam_lifted", rest), key).toThrow(new RegExp(key));
    }
    // It names no case, no post and no person but the staff account.
    expect(renderTemplate("moderation_csam_lifted", { ...data, caseId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", author: "ada" }).text).toBe(unsealed.text);
  });

  test("moderation_waiting: one line for each lane with a case past its time, in lane order, a single case worded as one, and the cases that hold a measure taken while deciding", () => {
    const r = renderTemplate("moderation_waiting", { lane0Count: "2", lane0Oldest: TIME, lane1Count: "1", lane1Oldest: TIME, lane2Count: "12", lane2Oldest: TIME, interimCount: "3", phones: "on" });
    expect(r.subject).toBe("korbat: cases are waiting longer than their response time");
    expect(paragraphs(r.text)).toEqual([
      `The urgent lane: 2 cases waiting longer than 24 hours; the oldest since ${TIME}.`,
      `Lane 1: 1 case waiting longer than 24 hours, since ${TIME}.`,
      `Lane 2: 12 cases waiting longer than 7 days; the oldest since ${TIME}.`,
      "3 cases have held a measure taken while deciding for more than 24 hours; their authors cannot appeal until the case is decided.",
      "Open the staff console. The same reminder went to every staff phone.",
      LAST_STAFF,
    ]);
    linkless(r);
    // Only the lanes that have such a case, and the measures' line only when there is one.
    const one = renderTemplate("moderation_waiting", { lane2Count: "1", lane2Oldest: TIME, phones: "on" });
    expect(paragraphs(one.text)).toEqual([`Lane 2: 1 case waiting longer than 7 days, since ${TIME}.`, "Open the staff console. The same reminder went to every staff phone.", LAST_STAFF]);
    const held = renderTemplate("moderation_waiting", { interimCount: "1", phones: "on" });
    expect(paragraphs(held.text)).toEqual([
      "1 case has held a measure taken while deciding for more than 24 hours; its author cannot appeal until the case is decided.",
      "Open the staff console. The same reminder went to every staff phone.",
      LAST_STAFF,
    ]);
    // 3e: the replies to a suspension or a termination unanswered for longer than korbat's aim, after the lanes and the measures.
    const replies = renderTemplate("moderation_waiting", { lane1Count: "1", lane1Oldest: TIME, replyCount: "2", replyOldest: TIME, phones: "on" });
    expect(paragraphs(replies.text)).toEqual([
      `Lane 1: 1 case waiting longer than 24 hours, since ${TIME}.`,
      `2 replies to a suspension or termination have waited more than ${REPLY_AIM_HOURS} hours, the oldest since ${TIME}. A reply sent before the start holds its suspension until someone answers.`,
      "Open the staff console. The same reminder went to every staff phone.",
      LAST_STAFF,
    ]);
    linkless(replies);
    expect(paragraphs(renderTemplate("moderation_waiting", { replyCount: "1", replyOldest: TIME, phones: "on" }).text)[0]).toBe(
      `1 reply to a suspension or termination has waited more than ${REPLY_AIM_HOURS} hours, since ${TIME}. A reply sent before the start holds its suspension until someone answers.`,
    );
    expect(() => renderTemplate("moderation_waiting", { replyCount: "2", phones: "on" })).toThrow(/replyOldest/);
    // A count without its time, and a mail about nothing, are programming errors.
    expect(() => renderTemplate("moderation_waiting", { lane0Count: "2", phones: "on" })).toThrow(/lane0Oldest/);
    expect(() => renderTemplate("moderation_waiting", { phones: "on" })).toThrow(/nothing/);
  });

  test("3f's review (people4): with the phone alerts switched off, moderation_waiting says that it is the only reminder and never that one went to a phone", () => {
    const off = renderTemplate("moderation_waiting", { lane2Count: "1", lane2Oldest: TIME, phones: "off" });
    expect(paragraphs(off.text)).toEqual([`Lane 2: 1 case waiting longer than 7 days, since ${TIME}.`, "Open the staff console. Phone alerts are switched off on this server, so this email is the only reminder.", LAST_STAFF]);
    expect(off.text).not.toContain("went to");
    linkless(off);
    expect(() => renderTemplate("moderation_waiting", { lane2Count: "1", lane2Oldest: TIME })).toThrow(/phones/);
  });
});

describe("notice_update: decisions on a person's reports, once a day", () => {
  const POST = "http://localhost:8081/post/0190f3a2-7c1e-7b1a-9f00-0123456789ab";
  const PAGE = "http://localhost:8081/notice/N-ABCDEFGH23#t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const TERMS = "http://localhost:8081/terms";
  const COURTS = "go to court, or complain to the Digital Services Coordinator of the EU country where you live (Article 53 of the Digital Services Act).";
  const REEXAMINE = "You can ask korbat once, within six months and free of charge, to re-examine a moderator's decision to take no action: it is decided again as a new report.";
  const FINAL = "A decision changed on review or by a correction, or given on re-examination, is final within korbat.";
  const line = (more: Partial<NoticeUpdateLine> = {}): NoticeUpdateLine => ({
    ref: "N-ABCDEFGH23",
    item: 1,
    link: POST,
    outcome: outcomeWords({ outcome: "restricted_legal", rule: null, suspect: false, sealed: false, unseen: false, noEffect: false, scope: null }),
    reexamination: false,
    changed: false,
    reexaminable: false,
    unseen: false,
    automatic: false,
    ...more,
  });
  const noAction = outcomeWords({ outcome: "no_violation", rule: null, suspect: false, sealed: false, unseen: false, noEffect: false, scope: null });
  const update = (more: Partial<NoticeUpdateData>): NoticeUpdateData => ({ signedIn: false, lines: [], receipts: [], pages: [], ...more });

  test("signed out: one paragraph per line, the page of each notice it has a line for, that nothing was automated, and the courts", () => {
    const r = renderNoticeUpdate(update({ lines: [line(), line({ item: 2, link: "http://localhost:8081/u/ada" })], pages: [{ ref: "N-ABCDEFGH23", pageUrl: PAGE }] }));
    expect(r.subject).toBe("Decisions on your reports to korbat");
    expect(paragraphs(r.text)).toEqual([
      `N-ABCDEFGH23, item 1 (${POST}): access restricted: korbat found it illegal.`,
      "N-ABCDEFGH23, item 2 (http://localhost:8081/u/ada): access restricted: korbat found it illegal.",
      `To see report N-ABCDEFGH23 or ask for a re-examination of a decision on it, open this page: ${PAGE}`,
      "No automated means were used to decide.",
      `You can ${COURTS}`,
      LAST_USER,
    ]);
    // The page link stands at the end of its paragraph, and nothing is an anchor.
    expect(r.text).toMatch(/#t=A{43}$/m);
    expect(r.html).not.toMatch(/<img|<a |href=/);
  });

  test("signed in: no page link, and the re-examination points to Your reports", () => {
    const r = renderNoticeUpdate(update({ signedIn: true, lines: [line({ outcome: noAction, reexaminable: true })] }));
    expect(paragraphs(r.text)).toEqual([
      `N-ABCDEFGH23, item 1 (${POST}): no action: korbat found no breach of its rules and nothing illegal.`,
      "No automated means were used to decide.",
      `${REEXAMINE} Use korbat's Settings, Cases, Your reports.`,
      `You can also ${COURTS}`,
      LAST_USER,
    ]);
    expect(r.text).not.toMatch(/[/]notice[/]|#t=/);
    // A signed-in update never carries a page or a receipt: handed either, it is refused rather than mailed.
    expect(() => renderNoticeUpdate(update({ signedIn: true, lines: [line()], pages: [{ ref: "N-ABCDEFGH23", pageUrl: PAGE }] }))).toThrow(/signed-in/);
  });

  test("the re-examination sentence goes only with a re-examinable line, and points to the page when signed out", () => {
    const withIt = renderNoticeUpdate(update({ lines: [line({ outcome: noAction, reexaminable: true })], pages: [{ ref: "N-ABCDEFGH23", pageUrl: PAGE }] }));
    expect(paragraphs(withIt.text)).toContain(`${REEXAMINE} Use the page linked in this email for that report.`);
    expect(paragraphs(withIt.text)).toContain(`You can also ${COURTS}`);
    const without = renderNoticeUpdate(update({ lines: [line()] }));
    expect(without.text).not.toContain("re-examine a moderator's decision");
    expect(paragraphs(without.text)).toContain(`You can ${COURTS}`);
  });

  test("a re-examination's answer and a changed outcome are final within korbat; a line that reads UNSEEN_NO_ACTION never is, re-examined again or not", () => {
    const answered = renderNoticeUpdate(update({ lines: [line({ outcome: noAction, reexamination: true })] }));
    expect(paragraphs(answered.text)[0]).toBe(`N-ABCDEFGH23, item 1 (${POST}), re-examined: no action: korbat found no breach of its rules and nothing illegal.`);
    expect(paragraphs(answered.text)).toContain(FINAL);
    expect(answered.text).not.toContain("re-examine a moderator's decision");
    const changed = renderNoticeUpdate(update({ lines: [line({ outcome: "korbat reversed its decision to restrict it.", changed: true })] }));
    expect(paragraphs(changed.text)).toContain(FINAL);
    // An answer given while nobody could open the images does not spend the re-examination, also when it answered one.
    const unseenLine = { outcome: UNSEEN_NO_ACTION, unseen: true };
    const open = renderNoticeUpdate(update({ lines: [line({ ...unseenLine, reexamination: true, reexaminable: true })] }));
    expect(paragraphs(open.text)[0]).toBe(`N-ABCDEFGH23, item 1 (${POST}), re-examined: ${UNSEEN_NO_ACTION}`);
    expect(open.text).not.toContain(FINAL);
    expect(open.text).toContain(REEXAMINE);
    // Asked again before a retried mail went out: no longer re-examinable, and still not final.
    const asked = renderNoticeUpdate(update({ lines: [line({ ...unseenLine, reexamination: true, reexaminable: false })] }));
    expect(asked.text).not.toContain(FINAL);
    expect(asked.text).not.toContain(REEXAMINE);
    // A line of each kind in one update: each sentence once.
    const both = renderNoticeUpdate(update({ lines: [line({ outcome: noAction, reexaminable: true }), line({ item: 2, outcome: noAction, reexamination: true })] }));
    expect(both.text.split(FINAL).length - 1).toBe(1);
    expect(both.text.split(REEXAMINE).length - 1).toBe(1);
  });

  test("only a link that named nothing is called automatic", () => {
    const dead = outcomeWords({ outcome: "not_available", rule: null, suspect: false, sealed: false, unseen: false, noEffect: false, scope: null });
    const r = renderNoticeUpdate(update({ lines: [line(), line({ item: 2, outcome: dead, automatic: true })] }));
    expect(paragraphs(r.text)).toContain("No automated means were used to decide, except for links found to name nothing on korbat, which were checked automatically.");
    expect(paragraphs(r.text)).toContain("If a link was wrong, send a new report with the right link.");
    const live = renderNoticeUpdate(update({ lines: [line()] }));
    expect(paragraphs(live.text)).toContain("No automated means were used to decide.");
    expect(live.text).not.toContain("If a link was wrong");
  });

  test("the outcome's words are the contracts': ALREADY_NOT_SHOWN, the scopes, the sealed phrase and UNSEEN_NO_ACTION stand in a line exactly as composed, with one full stop", () => {
    const facts = { rule: null, suspect: false, sealed: false, unseen: false, noEffect: false, scope: null } as const;
    const outcomes = [
      outcomeWords({ ...facts, outcome: "restricted_legal", noEffect: true }),
      outcomeWords({ ...facts, outcome: "no_violation", scope: "account" }),
      outcomeWords({ ...facts, outcome: "restricted_legal", sealed: true, scope: "account_suspect" }),
      outcomeWords({ ...facts, outcome: "no_violation", scope: "quote" }),
      outcomeWords({ ...facts, outcome: "no_violation", unseen: true }),
    ];
    const r = renderNoticeUpdate(update({ lines: outcomes.map((outcome, index) => line({ item: index + 1, outcome })) }));
    const lines = paragraphs(r.text).slice(0, outcomes.length);
    outcomes.forEach((outcome, index) => expect(lines[index]).toBe(`N-ABCDEFGH23, item ${index + 1} (${POST}): ${outcome}`));
    for (const sentence of [ALREADY_NOT_SHOWN, ACCOUNT_ITEM_SCOPE, ACCOUNT_SUSPECT_SCOPE, QUOTE_ITEM_SCOPE, SUSPECT_OUTCOME_PHRASES.sealed, UNSEEN_NO_ACTION]) expect(r.text).toContain(sentence);
    expect(r.text).not.toMatch(/[.][.]/);
  });

  test("a folded receipt rides in the update with its page link; an update of receipts alone has another subject and none of the decisions' sentences", () => {
    const receipt = { ref: "N-ZZZZZZZZ77", time: TIME, items: POST, pageUrl: "http://localhost:8081/notice/N-ZZZZZZZZ77#t=BBBB" };
    const alone = renderNoticeUpdate(update({ receipts: [receipt], termsUrl: TERMS }));
    expect(alone.subject).toBe("korbat received your reports");
    expect(paragraphs(alone.text)).toEqual([
      `korbat received your report N-ZZZZZZZZ77 at ${TIME}. It names: ${POST}.`,
      "To see where your report stands, ask for a re-examination of a decision, confirm that you sent it, or stop korbat's emails about reports to this address, open this page: http://localhost:8081/notice/N-ZZZZZZZZ77#t=BBBB",
      `How korbat handles reports, and what it keeps: ${TERMS}.`,
      LAST_USER,
    ]);
    // Two folds on one day and a line of another notice: the receipts first, the terms once, then the line and its page.
    const second = { ...receipt, ref: "N-YYYYYYYY66", pageUrl: "http://localhost:8081/notice/N-YYYYYYYY66#t=CCCC" };
    const full = renderNoticeUpdate(update({ receipts: [receipt, second], termsUrl: TERMS, lines: [line()], pages: [{ ref: "N-ABCDEFGH23", pageUrl: PAGE }] }));
    expect(full.subject).toBe("Decisions on your reports to korbat");
    const out = paragraphs(full.text);
    expect(out.slice(0, 5).map((paragraph) => paragraph.slice(0, 42))).toEqual([
      "korbat received your report N-ZZZZZZZZ77 a",
      "To see where your report stands, ask for a",
      "korbat received your report N-YYYYYYYY66 a",
      "To see where your report stands, ask for a",
      "How korbat handles reports, and what it ke",
    ]);
    expect(full.text.split("How korbat handles reports").length - 1).toBe(1);
    expect(out[5]).toBe(`N-ABCDEFGH23, item 1 (${POST}): access restricted: korbat found it illegal.`);
    expect(out[6]).toBe(`To see report N-ABCDEFGH23 or ask for a re-examination of a decision on it, open this page: ${PAGE}`);
    // A receipt needs the terms' address, and an update of nothing at all is a programming error.
    expect(() => renderNoticeUpdate(update({ receipts: [receipt] }))).toThrow(/termsUrl/);
    expect(() => renderNoticeUpdate(update({}))).toThrow(/nothing/);
  });

  test("it carries only what korbat generated: no member of the data holds a report's words", () => {
    const keys = Object.keys(line()).sort();
    expect(keys).toEqual(["automatic", "changed", "item", "link", "outcome", "reexaminable", "reexamination", "ref", "unseen"]);
  });
});

describe("the mailers take the union of messages", () => {
  test("the memory mailer renders a flat message with renderTemplate and the structured one with renderNoticeUpdate, keeps the two apart, and reads a code only from a flat message", async () => {
    const mailer = new MemoryMailer();
    const structured: MailMessage = { to: "a@b.io", template: "notice_update", data: { signedIn: true, lines: [], receipts: [], pages: [] } };
    // An update of nothing is refused as the real mailer would refuse it, before it counts as sent.
    await expect(mailer.send(structured)).rejects.toThrow(/nothing/);
    expect([mailer.sent.length, mailer.updates.length]).toEqual([0, 0]);
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "111111" } });
    await mailer.send({
      to: "a@b.io",
      template: "notice_update",
      data: { signedIn: true, lines: [{ ref: "N-ABCDEFGH23", item: 1, link: "http://localhost:8081/u/ada", outcome: "no action.", reexamination: false, changed: false, reexaminable: false, unseen: false, automatic: false }], receipts: [], pages: [] },
    });
    // The two kinds are kept apart, so a reader of the flat ones never meets a structure.
    expect(mailer.sent.map((message) => message.template)).toEqual(["sign_in_code"]);
    expect(mailer.updates.map((message) => message.template)).toEqual(["notice_update"]);
    expect(mailer.lastCodeFor("a@b.io")).toBe("111111");
    expect(renderMail(mailer.updates[0]!).subject).toBe("Decisions on your reports to korbat");
    expect(renderMail(mailer.sent[0]!).subject).toBe("Your korbat sign-in code");
  });

  test("a time in a mail is printed as noticeTime prints it", () => {
    expect(noticeTime(new Date("2026-10-04T06:59:59.999Z"))).toBe(TIME);
  });
});

describe("3e: the statement mails of a suspension taken at once and of its lift (design, sections 7.15 and 18, W.6)", () => {
  const lines = ["korbat suspended your account for 7 days, from this decision until 2026-10-11 09:30 UTC, without notice beforehand.", "The facts: The account posted a threat."];
  const statement = lines.join(String.fromCharCode(10));
  const READ = "Read it in korbat under Settings, Cases. korbat's emails never contain a link to act on a decision.";

  test("suspension_started_at_once: its subject, its lead with the days and the end, the statement's paragraphs, where to read it, and no link", () => {
    const r = renderTemplate("suspension_started_at_once", { measure: "suspend", days: "7", endsAt: "2026-10-11 09:30 UTC", statement });
    expect(r.subject).toBe("korbat suspended your account");
    expect(paragraphs(r.text)).toEqual([
      "korbat suspended your korbat account for 7 days, until 2026-10-11 09:30 UTC. It did so at once, without notice beforehand; the reasons follow. You can reply and appeal in korbat from now: sign in and use the banner on any screen.",
      ...lines,
      READ,
      LAST_USER,
    ]);
    expect(r.text).not.toMatch(/https?:|www[.]/);
    expect(paragraphs(renderTemplate("suspension_started_at_once", { measure: "suspend", days: "1", endsAt: "2026-10-05 09:30 UTC", statement }).text)[0]).toContain("for 1 day, until");
    // A termination's lead names no days and no end.
    const t = renderTemplate("suspension_started_at_once", { measure: "terminate", statement });
    expect(t.subject).toBe("korbat terminated your account");
    expect(paragraphs(t.text)[0]).toBe("korbat terminated your korbat account. It did so at once, without notice beforehand; the reasons follow. You can reply and appeal in korbat from now: sign in and use the banner on any screen.");
    expect(() => renderTemplate("suspension_started_at_once", { measure: "suspend", statement })).toThrow(/days/);
  });

  test("suspension_lifted: a lead for each state of the period, for a lift and for a basis that broke, and none says the account is free of every measure", () => {
    const lead = (why: string, period: string) => {
      const r = renderTemplate("suspension_lifted", { measure: "suspend", why, period, statement });
      expect(paragraphs(r.text).slice(1)).toEqual([...lines, READ, LAST_USER]);
      return [r.subject, paragraphs(r.text)[0]];
    };
    expect(lead("lifted", "not_started")).toEqual(["korbat lifted the suspension of your account", "korbat lifted the suspension of your korbat account that it had announced: it never starts."]);
    expect(lead("lifted", "running")).toEqual(["korbat lifted the suspension of your account", "korbat lifted the suspension of your korbat account. This suspension no longer restricts your account."]);
    expect(lead("lifted", "ended")).toEqual(["korbat lifted the suspension of your account", "korbat lifted a past suspension of your korbat account: it no longer counts toward a later suspension."]);
    expect(lead("basis", "not_started")).toEqual(["A suspension of your account will not start", "korbat reversed a decision that the suspension it announced for your korbat account rested on. The suspension will not start."]);
    expect(lead("basis", "running")).toEqual(["A suspension of your account has ended", "The suspension of your korbat account has ended, because a decision it rested on was reversed. This suspension no longer restricts your account."]);
    expect(lead("basis", "ended")).toEqual(["A past suspension of your account no longer counts", "korbat reversed a decision that a past suspension of your account rested on; that suspension no longer counts."]);
    for (const why of ["lifted", "basis"]) {
      for (const period of ["not_started", "running", "ended"]) expect(renderTemplate("suspension_lifted", { measure: "suspend", why, period, statement }).text).not.toMatch(/as before|handed to your mail provider|delivered/);
    }
    expect(renderTemplate("suspension_lifted", { measure: "terminate", why: "lifted", period: "running", statement }).subject).toBe("korbat lifted the termination of your account");
    // Task 4: a withdrawal needs the withdrawn decision's time; a why the template does not have is a programming error.
    expect(() => renderTemplate("suspension_lifted", { measure: "suspend", why: "replaced", period: "running", statement })).toThrow(/decidedAt/);
    expect(() => renderTemplate("suspension_lifted", { measure: "suspend", why: "answered", period: "running", statement })).toThrow(/why/);
  });
});

describe("3e Task 4: the mails of an announced measure, of the answer to a reply, of a withdrawal, and of a termination's take-down (design, section 18, W.6)", () => {
  const lines = ["korbat will suspend your account for 3 days. Nothing is restricted yet.", "The facts: The account had 3 active strikes."];
  const statement = lines.join(String.fromCharCode(10));
  const READ = "Read it in korbat under Settings, Cases. korbat's emails never contain a link to act on a decision.";
  const EARLIEST = "2026-10-11 09:30 UTC";

  test("suspension_announced: its subject, its lead with the days, the window and the earliest start, the reply, then the statement; a termination's without days", () => {
    const r = renderTemplate("suspension_announced", { measure: "suspend", days: "3", window: String(STANDING_RULES.replyWindowHours), earliestStart: EARLIEST, statement });
    expect(r.subject).toBe("korbat has decided to suspend your account: you can reply first");
    expect(paragraphs(r.text)).toEqual([
      `korbat has decided to suspend your korbat account for 3 days. Nothing is restricted yet. The suspension starts ${STANDING_RULES.replyWindowHours} hours after korbat sent this email, and not before ${EARLIEST}.`,
      `You can reply before it starts: sign in to korbat, where this decision is always shown and a banner on every screen gives the exact time and a Reply button. A reply sent before ${EARLIEST} is certainly in time, and holds the start until a moderator has answered you.`,
      "The decision and its reasons follow.",
      ...lines,
      READ,
      LAST_USER,
    ]);
    expect(r.text).not.toMatch(/https?:|www[.]|handed to your mail provider|delivered/);
    expect(paragraphs(renderTemplate("suspension_announced", { measure: "suspend", days: "1", window: "168", earliestStart: EARLIEST, statement }).text)[0]).toContain("for 1 day.");
    const t = renderTemplate("suspension_announced", { measure: "terminate", window: "168", earliestStart: EARLIEST, statement });
    expect(t.subject).toBe("korbat has decided to terminate your account: you can reply first");
    expect(paragraphs(t.text)[0]).toBe(`korbat has decided to terminate your korbat account. Nothing is restricted yet. The termination starts 168 hours after korbat sent this email, and not before ${EARLIEST}.`);
    expect(() => renderTemplate("suspension_announced", { measure: "suspend", window: "168", earliestStart: EARLIEST, statement })).toThrow(/days/);
    expect(() => renderTemplate("suspension_announced", { measure: "suspend", days: "3", earliestStart: EARLIEST, statement })).toThrow(/window/);
  });

  test("reply_answered: a lead for a kept and for a reversed answer, then the answer's statement", () => {
    const kept = renderTemplate("reply_answered", { outcome: "kept", statement });
    expect(kept.subject).toBe("korbat answered your reply");
    expect(paragraphs(kept.text)).toEqual(["A moderator read your reply and kept the decision. The answer and its reasons follow.", ...lines, READ, LAST_USER]);
    expect(paragraphs(renderTemplate("reply_answered", { outcome: "reversed", statement }).text)[0]).toBe("A moderator read your reply and reversed the decision. The answer follows.");
    expect(() => renderTemplate("reply_answered", { outcome: "withdrawn", statement })).toThrow(/outcome/);
  });

  test("suspension_lifted for a withdrawal: never an answer to the reply, and the sentence on the reply only when one was filed", () => {
    const r = renderTemplate("suspension_lifted", { measure: "suspend", why: "replaced", decidedAt: "2026-10-04 09:30 UTC", replied: "true", statement });
    expect(r.subject).toBe("korbat withdrew the suspension it announced");
    expect(paragraphs(r.text)).toEqual([
      "korbat withdrew the suspension of your korbat account that it announced on 2026-10-04 09:30 UTC, because it is taking another measure on your account. This is not a decision on your reply.",
      "The decision about the other measure reaches you separately.",
      ...lines,
      READ,
      LAST_USER,
    ]);
    expect(paragraphs(renderTemplate("suspension_lifted", { measure: "terminate", why: "replaced", decidedAt: "2026-10-04 09:30 UTC", replied: "false", statement }).text)[0]).toBe(
      "korbat withdrew the termination of your korbat account that it announced on 2026-10-04 09:30 UTC, because it is taking another measure on your account.",
    );
  });

  test("termination_final: the decision's day, that it is final, what is deleted, the sentence on sealed images only when images are sealed, and never that korbat keeps nothing when they are", () => {
    const r = renderTemplate("termination_final", { decided: "2026-04-04 09:30 UTC", imagesSealed: "false" });
    expect(r.subject).toBe("korbat has closed your terminated account");
    expect(paragraphs(r.text)).toEqual([
      "korbat's decision of 2026-04-04 09:30 UTC to terminate your korbat account is final: the time to appeal has passed, or your appeal was answered and the decision kept, and no reply of yours is unanswered.",
      "korbat has closed the account and is now deleting its posts and profile and every image it has not sealed, as that decision said. This cannot be undone. The handle stays reserved, so nobody else can take it.",
      "korbat keeps nothing to recognise a new account of yours by. A new account that carries on what this one was terminated for breaks korbat's terms.",
      LAST_USER,
    ]);
    const sealed = renderTemplate("termination_final", { decided: "2026-04-04 09:30 UTC", imagesSealed: "true" });
    expect(paragraphs(sealed.text)[2]).toBe(
      "korbat keeps nothing to recognise a new account of yours by. Images of yours that korbat sealed stay with it for the authorities alone, as the decision that sealed them said. A new account that carries on what this one was terminated for breaks korbat's terms.",
    );
    for (const mail of [r, sealed]) expect(mail.text).not.toMatch(/https?:|www[.]|@[a-z]/);
    expect(() => renderTemplate("termination_final", { imagesSealed: "false" })).toThrow(/decided/);
    // 3f (7.15 step 8): a termination's take-down holds the address as a deletion does, and its mail says so the same way.
    const held = renderTemplate("termination_final", { decided: "2026-04-04 09:30 UTC", imagesSealed: "true", heldUntil: "2026-04-11", holdFinal: "true" });
    expect(paragraphs(held.text)[3]).toBe(ACCOUNT_DELETED_HELD.final("2026-04-11"));
    expect(paragraphs(held.text).at(-1)).toBe(LAST_USER);
  });
});

describe("3e Task 5: the statement mails of a warning about reporting and of a restriction of it (design, sections 7.15 and 18, W.6)", () => {
  const lines = ["korbat warns you about your reports. Nothing is restricted.", "The facts: In the 90 days up to 2026-10-04 the account sent 8 reports."];
  const statement = lines.join(String.fromCharCode(10));
  const READ = "Read it in korbat under Settings, Cases. korbat's emails never contain a link to act on a decision.";

  test("reporting_warned: its subject, its lead, then the statement's paragraphs, where to read it, and no link", () => {
    const r = renderTemplate("reporting_warned", { statement });
    expect(r.subject).toBe("korbat warns you about your reports");
    expect(paragraphs(r.text)).toEqual([
      "korbat has looked at the reports your account sent under its rules and warns you about them. Nothing is restricted. The reasons, the reports concerned and what may follow are below.",
      ...lines,
      READ,
      LAST_USER,
    ]);
    expect(r.text).not.toMatch(/https?:|www[.]/);
    expect(r.html).not.toMatch(/<img|<a |href=/);
    expect(() => renderTemplate("reporting_warned", {})).toThrow(/statement/);
  });

  test("reporting_restricted: its subject, its lead with the days and the end and that illegal content can still be reported, then the statement", () => {
    const r = renderTemplate("reporting_restricted", { days: "30", endsAt: "2026-11-03 09:30 UTC", statement });
    expect(r.subject).toBe("korbat restricted your reports under its rules");
    expect(paragraphs(r.text)).toEqual([
      "korbat takes no reports under its rules from your account for 30 days, until 2026-11-03 09:30 UTC. You can still report illegal content. The reasons follow.",
      ...lines,
      READ,
      LAST_USER,
    ]);
    expect(paragraphs(renderTemplate("reporting_restricted", { days: "1", endsAt: "2026-10-05 09:30 UTC", statement }).text)[0]).toContain("for 1 day, until");
    expect(r.text).not.toMatch(/https?:|www[.]/);
    expect(() => renderTemplate("reporting_restricted", { endsAt: "2026-11-03 09:30 UTC", statement })).toThrow(/days/);
    expect(() => renderTemplate("reporting_restricted", { days: "30", statement })).toThrow(/endsAt/);
  });
});

describe("3f: the staff mails whose words are their push's (W.4)", () => {
  const NOW = "2026-10-16T09:00:00.000Z";
  /** A kind's mail as the alert tick sends it: the row's facts as text, and the time it is sent, for the day of its times. */
  const mail = (template: TemplateName, facts: Record<string, string>) => renderTemplate(template as Parameters<typeof renderTemplate>[0], { ...facts, now: NOW });

  test("each is the kind's title after korbat:, then its sentence and its line of what to do from ALERT_TEXTS, and the staff mails' last sentence", () => {
    const cases: [TemplateName, AlertKind, Record<string, string>][] = [
      ["contact_mail", "contact_mail", { receivedAt: "2026-10-16T08:05:00.000Z", dueAt: "2026-10-16T09:05:00.000Z" }],
      ["contact_mail_escalated", "contact_mail_escalated", { receivedAt: "2026-10-16T08:05:00.000Z", dueAt: "2026-10-16T09:05:00.000Z" }],
      ["order_due", "order_due", { dueAt: "2026-10-16T09:05:00.000Z", minutesLeft: "15" }],
      ["mailbox_unreachable", "mailbox_unreachable", { since: "2026-10-15T23:00:00.000Z" }],
      ["alert_channel_down", "alert_channel_down", { since: "2026-10-16T08:57:00.000Z" }],
      // Task 2: an order opened (with a deadline, and without a time of receipt), a record corrected, the daily unverified.
      ["order_opened", "order_opened", { items: "2", dueAt: "2026-10-16T09:05:00.000Z", unknown: "0" }],
      ["order_opened", "order_opened", { items: "1", unknown: "1" }],
      ["order_corrected", "order_corrected", { count: "2", at: "2026-10-16T08:50:00.000Z" }],
      ["order_unverified", "order_unverified", { count: "1", textsMissing: "1", holdsOpen: "0", oldestAt: "2026-10-15T22:00:00.000Z" }],
    ];
    for (const [template, kind, facts] of cases) {
      const r = mail(template, facts);
      const counted = Object.fromEntries(Object.entries(facts).map(([name, value]) => [name, isTimeFact(name) ? value : Number(value)]));
      const text = renderAlert(kind, counted, new Date(NOW));
      expect(r.subject, template).toBe(`korbat: ${text.title}`);
      expect(paragraphs(r.text), template).toEqual([text.sentence, text.todo, LAST_STAFF]);
      linkless(r);
    }
    expect(paragraphs(mail("contact_mail", { receivedAt: "2026-10-16T08:05:00.000Z", dueAt: "2026-10-16T09:05:00.000Z" }).text)[0]).toBe(
      "Mail at the authorities' contact point, received 08:05 UTC. If it is a removal order it is due 09:05 UTC.",
    );
    expect(mail("order_due", { dueAt: "2026-10-16T09:05:00.000Z", minutesLeft: "0" }).subject).toBe("korbat: 0 minutes left");
  });

  test("3f's review: every kind whose mail is its sentence is one the alert tick mails, and each has its template: Task 5's two daily kinds too", () => {
    expect([...TICK_MAILED_KINDS].sort()).toEqual([...SENTENCE_MAIL_KINDS].sort());
    for (const kind of SENTENCE_MAIL_KINDS) {
      const facts = Object.fromEntries(ALERT_KINDS[kind].facts.map((name) => [name, isTimeFact(name) ? "2026-10-16T08:00:00.000Z" : "2"]));
      const r = mail(kind as TemplateName, facts);
      expect(r.subject, kind).toBe(`korbat: ${renderAlert(kind, Object.fromEntries(Object.entries(facts).map(([n, v]) => [n, isTimeFact(n) ? v : Number(v)])), new Date(NOW)).title}`);
      linkless(r);
    }
  });

  test("they carry counts and UTC times only: a fact of another name, a time that is no time and a missing one are refused, and no handle or address is printed", () => {
    expect(() => mail("contact_mail", { receivedAt: "2026-10-16T08:05:00.000Z" })).toThrow(/dueAt/);
    expect(() => mail("mailbox_unreachable", { since: "yesterday" })).toThrow(/since/);
    expect(() => mail("alert_channel_down", { since: "2026-10-16T08:57:00.000Z", handle: "mod_anna" })).toThrow(/handle/);
    expect(() => renderTemplate("alert_channel_down", { since: "2026-10-16T08:57:00.000Z" })).toThrow(/now/);
    for (const template of ["contact_mail", "contact_mail_escalated", "order_due", "mailbox_unreachable", "alert_channel_down", "order_opened", "order_corrected", "order_unverified"] as const) {
      const facts = Object.fromEntries(ALERT_KINDS[template].facts.map((name) => [name, isTimeFact(name) ? "2026-10-16T08:00:00.000Z" : "3"]));
      expect(mail(template, facts).text, template).not.toMatch(/@/);
    }
  });
});
