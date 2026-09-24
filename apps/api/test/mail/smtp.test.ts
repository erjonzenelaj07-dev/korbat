import { describe, expect, test } from "vitest";
import { smtpTransportOptions } from "../../src/mail/smtp";

describe("smtp transport options", () => {
  test("smtps is implicit TLS on 465 with the credentials from the URL", () => {
    expect(smtpTransportOptions("smtps://user:p%40ss@relay.example")).toEqual({
      host: "relay.example",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "user", pass: "p@ss" },
    });
  });
  test("smtp is plain in development; with TLS required, STARTTLS becomes mandatory", () => {
    expect(smtpTransportOptions("smtp://mailpit:1025")).toEqual({ host: "mailpit", port: 1025, secure: false, requireTLS: false });
    expect(smtpTransportOptions("smtp://relay.example", { requireTls: true })).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });
});
