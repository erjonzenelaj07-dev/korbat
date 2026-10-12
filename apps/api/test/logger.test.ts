import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { scrub } from "../src/lib/logger";

describe("scrub", () => {
  test("masks emails and IPs inside strings", () => {
    expect(scrub("user a.b+c@example.com from 203.0.113.9")).toBe("user [email] from [ip]");
    expect(scrub("v6 2001:db8:85a3::8a2e:370:7334 and ::1 and fe80::1")).toBe("v6 [ip] and [ip] and [ip]");
  });
  test("leaves timestamps alone", () => {
    expect(scrub("at 2026-09-03T10:30:45Z")).toBe("at 2026-09-03T10:30:45Z");
  });
  test("redacts secret-bearing keys regardless of value", () => {
    expect(scrub({ authorization: "Bearer abc", cookie: "s=1", password: "p", nested: { token: "t" } })).toEqual({
      authorization: "[redacted]",
      cookie: "[redacted]",
      password: "[redacted]",
      nested: { token: "[redacted]" },
    });
  });
  test("a phone number is redacted by its key, as is the `to` field the mailer and the verification provider carry", () => {
    expect(scrub({ phone: "+447911123456", to: "+447911123456", workflow: [{ channel: "sms", to: "+447911123456" }], nested: { Phone: "+447911123456" } })).toEqual({
      phone: "[redacted]",
      to: "[redacted]",
      workflow: [{ channel: "sms", to: "[redacted]" }],
      nested: { Phone: "[redacted]" },
    });
  });
  test("an Error's message and stack are both scrubbed", () => {
    const err = new Error("relay rejected bob@example.com from 203.0.113.9");
    const out = scrub(err) as { name: string; message: string; stack: string };
    expect(out.message).toBe("relay rejected [email] from [ip]");
    expect(out.stack).toContain("relay rejected [email] from [ip]");
    expect(out.stack).not.toContain("example.com");
  });
  test("a failed query is logged by its statement, the database's code, constraint and message, and never its parameters", () => {
    const statement = "insert into staff_texts (case_id, author_id, kind, text, salt, digest) values ($1::uuid, $2::uuid, $3::staff_text_kind, $4, $5, $6) returning id";
    const text = ["a staff text that quotes a reporter", "on two lines"].join(String.fromCharCode(10));
    const salt = "0123456789abcdef".repeat(4);
    const cause = Object.assign(new Error('insert or update on table "staff_texts" violates foreign key constraint "staff_texts_case_id_cases_id_fk"'), {
      code: "23503",
      constraint_name: "staff_texts_case_id_cases_id_fk",
      parameters: ["9d3c0000-0000-4000-8000-000000000001", "9d3c0000-0000-4000-8000-000000000002", "facts", text, salt, "digest-of-it"],
    });
    // As drizzle-orm builds it when the driver throws: its message holds the statement and then every parameter.
    const err = new DrizzleQueryError(statement, ["9d3c0000-0000-4000-8000-000000000001", "9d3c0000-0000-4000-8000-000000000002", "facts", text, salt, "digest-of-it"], cause);
    expect(err.message).toContain(salt);
    const logged = JSON.stringify({ err: scrub(err) });
    for (const secret of [salt, "a staff text that quotes a reporter", "on two lines", "digest-of-it", "9d3c0000-0000-4000-8000-000000000002"]) expect(logged).not.toContain(secret);
    // The statement is scrubbed like any other text (its casts read as addresses to the IPv6 mask), and it names no value.
    expect(scrub(err)).toMatchObject({ name: "Error", message: expect.stringMatching(/^Failed query: insert into staff_texts .* returning id$/), code: "23503", constraint: "staff_texts_case_id_cases_id_fk", cause: cause.message });
    // The stack keeps where it was thrown.
    expect((scrub(err) as { stack: string }).stack).toMatch(/^Error: Failed query: insert into staff_texts/);
    expect((scrub(err) as { stack: string }).stack).toContain("logger.test.ts");
    // Any other error is logged as before.
    expect(scrub(new Error("params: are words here"))).toMatchObject({ message: "params: are words here" });
  });

  test("walks arrays and keeps non-strings", () => {
    expect(scrub({ n: 1, ok: true, list: ["x@y.io", 2] })).toEqual({ n: 1, ok: true, list: ["[email]", 2] });
  });
});
