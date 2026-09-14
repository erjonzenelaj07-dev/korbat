import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { codeFrom, latestMessageTo } from "./mailpit";

describe.skipIf(!process.env.INTEGRATION)("integration: SMTP to Mailpit", () => {
  test("a sign-in code email arrives with the code in its text", async () => {
    const config = loadConfig();
    const to = `mail-test-${randomUUID()}@korbat.local`;
    await smtpMailer(config.SMTP_URL, config.MAIL_FROM).send({ to, template: "sign_in_code", data: { code: "424242" } });
    const message = await latestMessageTo(to);
    expect(message.subject).toBe("Your korbat sign-in code");
    expect(codeFrom(message.text)).toBe("424242");
  });
});
