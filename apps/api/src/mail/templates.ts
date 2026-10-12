import type { FlatTemplateName, MailMessage, NoticeUpdateData } from "./mailer";

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

/**
 * The subject of the statement's mail, by the decision's kind and outcome (3c design, section 7.15). The moderation
 * module names one of these keys; the words are written here only, so no caller passes a subject of its own.
 */
export const DECISION_MAIL_SUBJECTS = {
  seal_deciding: "korbat sealed images of yours while it decides",
  seal_final: "korbat sealed images of yours",
  post_deciding: "A post of yours is under review on korbat",
  profile_deciding: "korbat reset part of your profile while it decides",
  post_restricted: "korbat restricted a post of yours",
  profile_restricted: "korbat restricted part of your profile",
  lifted_deciding: "korbat lifted a restriction it placed while deciding",
  reversed: "korbat reversed a decision about your account",
  appeal_kept: "korbat answered your appeal",
} as const;
export type DecisionMailSubject = keyof typeof DECISION_MAIL_SUBJECTS;

/** What a decision that lifted the protection of reported images did, as moderation_csam_lifted prints it. */
const CSAM_LIFTED_WHAT: Record<string, string> = {
  unsealed: "lifted a seal",
  dismissed: "answered a report or finding of child sexual abuse material without a seal",
};

/** The lanes as moderation_waiting names them, each with its response time. */
const WAITING_LANES = [
  { key: "lane0", name: "The urgent lane", time: "24 hours" },
  { key: "lane1", name: "Lane 1", time: "24 hours" },
  { key: "lane2", name: "Lane 2", time: "7 days" },
] as const;

/** The receipt's sentences, which notice_received and the receipts a notice_update carries share. */
const RECEIPT = {
  received: (ref: string, time: string, items: string) => `korbat received your report ${ref} at ${time}. It names: ${items}.`,
  page: (pageUrl: string) =>
    `To see where your report stands, ask for a re-examination of a decision, confirm that you sent it, or stop korbat's emails about reports to this address, open this page: ${pageUrl}`,
  terms: (termsUrl: string) => `How korbat handles reports, and what it keeps: ${termsUrl}.`,
};

export function renderTemplate(template: FlatTemplateName, data: Record<string, string>): RenderedMail {
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
        RECEIPT.received(need(data, "ref"), need(data, "time"), need(data, "items")),
        "A moderator decides each item that names something on korbat; a link that names nothing is answered automatically. You get one email with every decision, at most once a day.",
        data.pageUrl ? RECEIPT.page(data.pageUrl) : "You can follow it in korbat under Settings, Cases, Your reports.",
        RECEIPT.terms(need(data, "termsUrl")),
      ]);
    case "moderation_decision": {
      // The statement of reasons, to the author of what a decision restricts or lifts (3c design, section 7.15). The
      // subject is a key of the table above, and `statement` holds the statement's paragraphs, one per line, exactly as
      // statementParagraphs rendered them: the author's screen and the console's preview show the same words.
      const key = need(data, "subject");
      if (!Object.hasOwn(DECISION_MAIL_SUBJECTS, key)) throw new Error(`mail template data holds a subject that the statement's mail does not have: "${key}"`);
      const lines = need(data, "statement")
        .split("\n")
        .filter((paragraph) => paragraph.trim() !== "");
      return userMail(DECISION_MAIL_SUBJECTS[key as DecisionMailSubject], [...lines, "Read it in korbat under Settings, Cases. korbat's emails never contain a link to act on a decision."]);
    }
    case "moderation_urgent": {
      // The alert for the urgent lane (3c design, section 7.12): counts and times only, to every staff account. A single
      // case is its own oldest, so its sentence gives one time and is worded for one.
      const lane = "in the urgent lane (child sexual abuse or exploitation, direct threats, violence, public security or self-harm)";
      return staffMail("korbat: a case is waiting in the urgent lane", [
        need(data, "count") === "1" ? `1 case ${lane} is waiting, since ${need(data, "oldest")}.` : `${need(data, "count")} cases ${lane} are waiting; the oldest since ${need(data, "oldest")}.`,
        "Open the staff console. Until the phone alerts of sub-project 3e, this email is the only alert.",
      ]);
    }
    case "moderation_waiting": {
      // The queue-age alert (3c design, section 7.12): per lane the cases past its response time and since when the
      // oldest waits, and the cases that have held a measure taken while deciding for more than a day. A lane's pair is
      // there only for a lane with such a case; a single case is its own oldest and is worded as one.
      const lines: string[] = [];
      for (const lane of WAITING_LANES) {
        const count = data[`${lane.key}Count`];
        if (count === undefined || count === "") continue;
        const oldest = need(data, `${lane.key}Oldest`);
        lines.push(count === "1" ? `${lane.name}: 1 case waiting longer than ${lane.time}, since ${oldest}.` : `${lane.name}: ${count} cases waiting longer than ${lane.time}; the oldest since ${oldest}.`);
      }
      const held = data.interimCount;
      if (held !== undefined && held !== "") {
        lines.push(
          held === "1"
            ? "1 case has held a measure taken while deciding for more than 24 hours; its author cannot appeal until the case is decided."
            : `${held} cases have held a measure taken while deciding for more than 24 hours; their authors cannot appeal until the case is decided.`,
        );
      }
      if (lines.length === 0) throw new Error("mail template data for moderation_waiting names nothing that waits");
      return staffMail("korbat: cases are waiting longer than their response time", [...lines, "Open the staff console. Until the phone alerts of sub-project 3e, this email is the only reminder."]);
    }
    case "moderation_burst": {
      // One staff account confirmed many decisions in a short time (3c design, section 7.5, step 4): every staff
      // account is told, since a stolen key decides at the speed of key prompts.
      const who = `@${need(data, "handle")}`;
      return staffMail("korbat: many staff decisions in a short time", [
        `The staff account ${who} confirmed ${need(data, "count")} decisions in the last 15 minutes.`,
        `Every staff account gets this email. If ${who} is your account and you did not confirm them, someone else holds your key: tell the operator at once.`,
        "If that was not expected, ask them; if their key may be in someone else's hands, the operator revokes it with staff.js revoke.",
      ]);
    }
    case "moderation_csam_lifted": {
      // A decision lifted a seal, or an admin answered a report or finding of child sexual abuse material without one
      // (3c design, section 7.5, step 4): neither can be undone once the images are served again, so every staff
      // account is told at once. It names the staff account and the time, never the case or its author.
      const who = `@${need(data, "handle")}`;
      const what = CSAM_LIFTED_WHAT[need(data, "what")];
      if (what === undefined) throw new Error(`mail template data holds a "what" that moderation_csam_lifted does not have: "${data.what}"`);
      return staffMail("korbat: reported images are no longer protected", [
        `The staff account ${who} confirmed a decision at ${need(data, "time")} that ${what}.`,
        "Unless another seal or another open report of this kind still covers them, the images its case reaches are served again as before and staff may open them. After an answer without a seal, whoever is on duty opens them the same day and, where one breaks a rule or the law, opens a finding on its post. Nobody at korbat could open those images while they were protected.",
        `Every staff account gets this email. If ${who} is your account and you did not confirm it, someone else holds your key: tell the operator at once.`,
        "The staff console's home screen lists every such decision of the last 30 days with its case. A seal for good is lifted only on the answer of the authority korbat reported the images to, and a seal taken while deciding only when it was taken in error: the operator compares this decision with their R2 records. If it was not expected, ask them; if their key may be in someone else's hands, the operator revokes it with staff.js revoke, and whoever is on duty opens a finding citing R2 on the post or the account and seals its images while deciding.",
      ]);
    }
    case "moderation_reads": {
      // A staff account opened as many different cases today as one account may (3c design, section 7.3): every staff
      // account is told, the account itself included, since a stolen key reads at the speed of requests.
      const who = `@${need(data, "handle")}`;
      return staffMail("korbat: a staff account reached its daily case limit", [
        `The staff account ${who} opened ${need(data, "limit")} different cases today and cannot open others until midnight UTC.`,
        `Every staff account gets this email. If ${who} is your account and you did not open them, someone else holds your key: tell the operator at once.`,
        "If that was not expected, ask them. The operator raises the limit with staff.js limits.",
      ]);
    }
    case "moderation_reveal": {
      // Every reveal of who sent a report or a notice (3c design, section 7.3), to every staff account: a reveal cannot
      // be undone. It names the staff account, the time and the day's count, never the case or the person revealed.
      const who = `@${need(data, "handle")}`;
      return staffMail("korbat: a staff account revealed who sent a report", [
        `The staff account ${who} revealed who sent a report or notice at ${need(data, "time")}. That is ${need(data, "count")} of the ${need(data, "limit")} reveals one staff account may make today (UTC).`,
        `Every staff account gets this email. If ${who} is your account and you did not reveal it, someone else holds your key: tell the operator at once.`,
        "The staff console's home screen lists every reveal of the last 30 days with its case. If this one was not expected, ask them; if their key may be in someone else's hands, the operator revokes it with staff.js revoke.",
      ]);
    }
  }
}

const OUTSIDE_KORBAT = "go to court, or complain to the Digital Services Coordinator of the EU country where you live (Article 53 of the Digital Services Act).";

/**
 * The daily update of decisions on a person's reports (3c design, section 7.15), the one template whose data is a
 * structure. In this order: each receipt the 24-hour cap folded, with its page link, and after them once where korbat
 * says how it handles reports; one paragraph for each line; for a signed-out reader the page of each notice the update
 * has a line for; and, only when it carries a line, that nothing was automated, how to ask for a re-examination, what is
 * final within korbat, what to do about a wrong link, and the courts and the Digital Services Coordinator. Every
 * sentence is chosen from the lines' fields alone, and a line's outcome is printed as the moderation module composed it.
 */
export function renderNoticeUpdate(data: NoticeUpdateData): RenderedMail {
  const { lines, receipts, pages } = data;
  if (lines.length === 0 && receipts.length === 0) throw new Error("mail template data for notice_update holds nothing to tell: no line and no receipt");
  // An account's reports are followed in the app: its update never carries a link with a token.
  if (data.signedIn && (receipts.length > 0 || pages.length > 0)) throw new Error("mail template data for a signed-in notice_update holds a receipt or a page link");
  const out: string[] = [];
  for (const receipt of receipts) out.push(RECEIPT.received(receipt.ref, receipt.time, receipt.items), RECEIPT.page(receipt.pageUrl));
  if (receipts.length > 0) {
    if (!data.termsUrl) throw new Error('mail template data is missing "termsUrl"');
    out.push(RECEIPT.terms(data.termsUrl));
  }
  for (const line of lines) {
    // The outcome's words end in their own full stop.
    const outcome = line.outcome.endsWith(".") ? line.outcome : `${line.outcome}.`;
    out.push(`${line.ref}, item ${line.item} (${line.link})${line.reexamination ? ", re-examined" : ""}: ${outcome}`);
  }
  for (const page of pages) out.push(`To see report ${page.ref} or ask for a re-examination of a decision on it, open this page: ${page.pageUrl}`);
  if (lines.length > 0) {
    const automatic = lines.some((line) => line.automatic);
    out.push(`No automated means were used to decide${automatic ? ", except for links found to name nothing on korbat, which were checked automatically" : ""}.`);
    const reexaminable = lines.some((line) => line.reexaminable);
    if (reexaminable) {
      out.push(
        `You can ask korbat once, within six months and free of charge, to re-examine a moderator's decision to take no action: it is decided again as a new report. ${
          data.signedIn ? "Use korbat's Settings, Cases, Your reports." : "Use the page linked in this email for that report."
        }`,
      );
    }
    // An answer given while nobody could open the images leaves the re-examination unspent, so it is never called final.
    if (lines.some((line) => line.changed || (line.reexamination && !line.unseen))) out.push("A decision changed on review or by a correction, or given on re-examination, is final within korbat.");
    if (automatic) out.push("If a link was wrong, send a new report with the right link.");
    out.push(`You can ${reexaminable ? "also " : ""}${OUTSIDE_KORBAT}`);
  }
  return userMail(lines.length > 0 ? "Decisions on your reports to korbat" : "korbat received your reports", out);
}

/** A message as it is sent: the structured template by its own renderer, every other by renderTemplate. */
export function renderMail(message: MailMessage): RenderedMail {
  return message.template === "notice_update" ? renderNoticeUpdate(message.data) : renderTemplate(message.template, message.data);
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
