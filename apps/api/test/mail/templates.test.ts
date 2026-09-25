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
    const data = { code: "123456", deviceLabel: "<b>Chrome</b> on Windows", notMeUrl: "http://localhost:8081/not-me/abc", minutes: "15", count: "3", email: "new<address>@example.com" };
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
      "badge_verified",
      "badge_removed",
      "delete_account_code",
      "account_deleted",
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
  });
  test("the account lifecycle templates say what happened and what to do if it was not the owner", () => {
    const changeCode = renderTemplate("email_change_code", { code: "654321" });
    expect(changeCode.text).toContain("654321");
    expect(changeCode.text).toContain("10 minutes");
    const changed = renderTemplate("email_changed", { email: "new@example.com" });
    expect(changed.text).toContain("new@example.com");
    expect(changed.text).toMatch(/stays? signed in/);
    expect(changed.text).toMatch(/change it back/);
    const deleteCode = renderTemplate("delete_account_code", { code: "111222" });
    expect(deleteCode.text).toContain("111222");
    expect(deleteCode.text).toMatch(/delete/i);
    expect(deleteCode.text).toMatch(/revoke|sign out/i);
    expect(renderTemplate("account_deleted", {}).text).toMatch(/cannot be undone/);
    expect(renderTemplate("badge_verified", {}).text).toMatch(/verified/i);
    expect(renderTemplate("badge_removed", {}).text).toMatch(/removed/i);
  });
  test("missing template data is a programming error", () => {
    expect(() => renderTemplate("sign_in_code", {})).toThrow(/code/);
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
