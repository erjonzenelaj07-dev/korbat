import { beforeEach, describe, expect, test, vi } from "vitest";
import { MailRefused, MailUnavailable } from "../../src/mail/mailer";
import { smtpMailer, smtpTransportOptions } from "../../src/mail/smtp";

/** What the transport's sendMail does in the test at hand; nodemailer itself is never loaded, so nothing connects. */
const sendMail = vi.fn<(message: unknown) => Promise<unknown>>();
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: (message: unknown) => sendMail(message) }) } }));

/** The explicit time limits every transport gets (3c design, section 5): nodemailer's own are minutes long. */
const LIMITS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000, dnsTimeout: 10_000 };

describe("smtp transport options", () => {
  test("smtps is implicit TLS on 465 with the credentials from the URL", () => {
    expect(smtpTransportOptions("smtps://user:p%40ss@relay.example")).toEqual({
      host: "relay.example",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "user", pass: "p@ss" },
      ...LIMITS,
    });
  });
  test("smtp is plain in development; with TLS required, STARTTLS becomes mandatory", () => {
    expect(smtpTransportOptions("smtp://mailpit:1025")).toEqual({ host: "mailpit", port: 1025, secure: false, requireTLS: false, ...LIMITS });
    expect(smtpTransportOptions("smtp://relay.example", { requireTls: true })).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });
  test("a relay that does not answer, or answers and then stalls, fails a send within about 50 seconds: the four limits, for smtp and smtps alike", () => {
    for (const url of ["smtp://mailpit:1025", "smtps://user:pass@relay.example:465"]) {
      const options = smtpTransportOptions(url);
      expect(options.connectionTimeout, url).toBe(10_000);
      expect(options.greetingTimeout, url).toBe(10_000);
      expect(options.socketTimeout, url).toBe(30_000);
      expect(options.dnsTimeout, url).toBe(10_000);
    }
  });
});

/** nodemailer's error as its smtp-connection formats one: the code, the command that failed, and the relay's reply with its number. */
function smtpError(code: string, command: string | undefined, response: string | undefined): Error {
  const err = new Error(response === undefined ? "send failed" : `send failed: ${response}`) as Error & { code?: string; command?: string; response?: string; responseCode?: number };
  err.code = code;
  if (command !== undefined) err.command = command;
  if (response !== undefined) {
    err.response = response;
    const number = Number(/^[0-9]+/.exec(response)?.[0]);
    if (number) err.responseCode = number;
  }
  return err;
}

const LF = String.fromCharCode(10);

describe("smtpMailer's errors", () => {
  const mailer = smtpMailer("smtp://relay.example:587", "korbat <no-reply@korbat.local>");
  const message = { to: "a@b.example", template: "sign_in_code", data: { code: "123456" } } as const;
  const failure = async (err: Error) => {
    sendMail.mockRejectedValueOnce(err);
    return mailer.send(message).then(
      () => null,
      (thrown: unknown) => thrown,
    );
  };

  beforeEach(() => {
    sendMail.mockReset();
  });

  test("a send the relay takes resolves, with the rendered subject and both bodies", async () => {
    sendMail.mockResolvedValueOnce({ messageId: "x" });
    await mailer.send(message);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({ from: "korbat <no-reply@korbat.local>", to: "a@b.example", subject: "Your korbat sign-in code" });
  });

  test("the relay saying that the recipient's address itself is bad is MailRefused: no retry changes such an address", async () => {
    for (const response of [
      "550 5.1.1 <a@b>: Recipient address rejected: User unknown",
      // A reply of several lines: every line but the last carries a hyphen after the number.
      `550-5.1.1 The email account that you tried to reach does not exist.${LF}550 5.1.1 Please check the address.`,
      "556 5.1.10 Recipient address has null MX",
      "550 5.1.2 Bad destination system address",
      "553 5.1.3 Bad destination mailbox address syntax",
      "551 5.1.6 Destination mailbox has moved",
    ]) {
      const thrown = await failure(smtpError("EENVELOPE", "RCPT TO", response));
      expect(thrown, response).toBeInstanceOf(MailRefused);
      // Every existing caller catches MailUnavailable and so behaves as before.
      expect(thrown, response).toBeInstanceOf(MailUnavailable);
      expect((thrown as Error).cause, response).toMatchObject({ code: "EENVELOPE" });
    }
  });

  test("every other failure stays a plain MailUnavailable, to be tried again", async () => {
    for (const [name, err] of [
      // Postfix checks its client and sender restrictions at RCPT TO: a relay that refuses korbat itself answers there for every recipient.
      ["relaying denied", smtpError("EENVELOPE", "RCPT TO", "554 5.7.1 <a@b>: Relay access denied")],
      ["a refused sender, reported at RCPT TO", smtpError("EENVELOPE", "RCPT TO", "553 5.1.8 <f@g>: Sender address rejected: Domain not found")],
      ["a bad sender mailbox", smtpError("EENVELOPE", "RCPT TO", "550 5.1.7 Bad sender's mailbox address syntax")],
      ["no enhanced status", smtpError("EENVELOPE", "RCPT TO", "550 rejected")],
      // 5.1.1 followed by another digit is another status.
      ["a longer detail number", smtpError("EENVELOPE", "RCPT TO", "550 5.1.11 something else")],
      ["a temporary refusal", smtpError("EENVELOPE", "RCPT TO", "450 4.1.1 <a@b>: Recipient address rejected: try again later")],
      ["a temporary refusal that names 5.1.1 later in its text", smtpError("EENVELOPE", "RCPT TO", "451 4.7.1 try later (was 550 5.1.1)")],
      ["a refused MAIL FROM", smtpError("EENVELOPE", "MAIL FROM", "550 5.1.1 Sender unknown")],
      ["failed credentials", smtpError("EAUTH", "AUTH PLAIN", "535 5.7.8 Authentication credentials invalid")],
      ["a refused message", smtpError("EMESSAGE", "DATA", "554 5.1.1 Transaction failed")],
      ["no connection", smtpError("ECONNECTION", undefined, undefined)],
      ["a timeout", smtpError("ETIMEDOUT", "CONN", undefined)],
      ["a bad recipient without a command", smtpError("EENVELOPE", undefined, "550 5.1.1 User unknown")],
      ["something that is no SMTP error", new TypeError("boom")],
    ] as const) {
      const thrown = await failure(err);
      expect(thrown, name).toBeInstanceOf(MailUnavailable);
      expect(thrown, name).not.toBeInstanceOf(MailRefused);
      expect((thrown as Error).cause, name).toBe(err);
    }
  });
});
