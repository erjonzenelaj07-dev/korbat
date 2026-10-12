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
      handle: "mod_anna",
      limit: "10",
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
      "moderation_reads",
      "moderation_reveal",
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

    test("moderation_reads names the staff account and the limit it reached, tells its holder what to do, and carries no link", () => {
      const r = renderTemplate("moderation_reads", { handle: "mod_anna", limit: "400" });
      expect(r.subject).toBe("korbat: a staff account reached its daily case limit");
      expect(paragraphs(r.text)).toEqual([
        "The staff account @mod_anna opened 400 different cases today and cannot open others until midnight UTC.",
        "Every staff account gets this email. If @mod_anna is your account and you did not open them, someone else holds your key: tell the operator at once.",
        "If that was not expected, ask them. The operator raises the limit with staff.js limits.",
        LAST_STAFF,
      ]);
      expect(r.text).not.toMatch(/https?:|www[.]|:[/][/]/);
      expect(r.html).not.toMatch(/<img|<a |href=|https?:/);
      expect(() => renderTemplate("moderation_reads", { handle: "mod_anna" })).toThrow(/limit/);
      expect(() => renderTemplate("moderation_reads", { limit: "400" })).toThrow(/handle/);
    });

    test("moderation_reveal names the staff account, the time, the day's count and the limit, never the case or who was revealed, and carries no link", () => {
      const data = { handle: "mod_anna", time: "2026-10-04 06:59 UTC", count: "3", limit: "10" };
      const r = renderTemplate("moderation_reveal", data);
      expect(r.subject).toBe("korbat: a staff account revealed who sent a report");
      expect(paragraphs(r.text)).toEqual([
        "The staff account @mod_anna revealed who sent a report or notice at 2026-10-04 06:59 UTC. That is 3 of the 10 reveals one staff account may make today (UTC).",
        "Every staff account gets this email. If @mod_anna is your account and you did not reveal it, someone else holds your key: tell the operator at once.",
        "The staff console's home screen lists every reveal of the last 30 days with its case. If this one was not expected, ask them; if their key may be in someone else's hands, the operator revokes it with staff.js revoke.",
        LAST_STAFF,
      ]);
      expect(r.text).not.toMatch(/https?:|www[.]|:[/][/]/);
      expect(r.html).not.toMatch(/<img|<a |href=|https?:/);
      for (const key of Object.keys(data)) {
        const { [key]: _left, ...rest } = data as Record<string, string>;
        expect(() => renderTemplate("moderation_reveal", rest), key).toThrow(new RegExp(key));
      }
      // Only what korbat generated: a name, a case or a reason handed over by mistake appears nowhere.
      const more = renderTemplate("moderation_reveal", { ...data, name: "Ada Lovelace", caseId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", reason: "the reason's own words" });
      expect(more.text).toBe(r.text);
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
