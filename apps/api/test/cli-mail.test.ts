import { describe, expect, test } from "vitest";
import { commandLineMailSettings } from "../src/cli/mail";

// The command line's mailer (3a design, section 7): grant-role's demotion and the staff command line's revocations mail
// the key's owner, built as the API builds its mailer, from SMTP_URL and MAIL_FROM alone.
describe("the command line's mail settings", () => {
  test("reads SMTP_URL and MAIL_FROM, and requires TLS from a plain relay in production as the API does", () => {
    const env = { SMTP_URL: "smtp://localhost:1025", MAIL_FROM: "korbat <no-reply@korbat.local>" };
    expect(commandLineMailSettings(env)).toEqual({ smtpUrl: "smtp://localhost:1025", mailFrom: "korbat <no-reply@korbat.local>", requireTls: false });
    expect(commandLineMailSettings({ ...env, NODE_ENV: "production" }).requireTls).toBe(true);
    expect(commandLineMailSettings({ ...env, NODE_ENV: "development" }).requireTls).toBe(false);
  });

  test("a setting only the API reads changes nothing", () => {
    const env = { SMTP_URL: "smtps://u:p@relay.example:465", MAIL_FROM: "korbat <no-reply@korbat.example>", APP_ORIGIN: "not a url", CONSOLE_ORIGIN: "http://x/" };
    expect(commandLineMailSettings(env).smtpUrl).toBe("smtps://u:p@relay.example:465");
  });

  test("names the mail setting that is missing or wrong, and no other", () => {
    for (const [env, named] of [
      [{ MAIL_FROM: "korbat <no-reply@korbat.local>" }, /SMTP_URL/],
      [{ SMTP_URL: "http://localhost:1025", MAIL_FROM: "korbat <no-reply@korbat.local>" }, /SMTP_URL/],
      [{ SMTP_URL: "smtp://localhost:1025" }, /MAIL_FROM/],
    ] as const) {
      let message = "";
      try {
        commandLineMailSettings(env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, JSON.stringify(env)).toMatch(named);
      expect(message).toMatch(/^Invalid mail settings:/);
      expect(message).not.toMatch(/APP_ORIGIN|DATABASE_URL|AUTH_HMAC_KEY|CONSOLE_ORIGIN/);
    }
  });
});
