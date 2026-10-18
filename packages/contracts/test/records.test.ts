import { describe, expect, test } from "vitest";
import {
  ACCESS_PURPOSES,
  HANDOVER_INSTRUMENTS,
  NOTIFICATION_ANSWERS,
  NOTIFICATION_DUTIES,
  NOTIFICATION_SENT_KINDS,
  NOT_HELD_KINDS,
  PRODUCED_KINDS,
  PRODUCTION_INSTRUMENTS,
  RECORDS_NOT_HELD,
  RECORDS_NOT_HELD_VERSION,
  REPORT_OWED_KINDS,
  ReportsOwed,
  recordDigestOf,
} from "../src/index";

/**
 * 3f Task 5 (design, sections 6.5, 10.1, 10.2 and W.8): the closed lists of the records to authorities, each the one
 * spelling of its CHECK (a database test holds the two equal), what the console learns of an owed report, the fixed
 * sentence of what korbat does not hold, and the digest a later step's audit row holds in place of the facts.
 */
describe("the records to authorities", () => {
  test("the closed lists: by kind, never by value, and an answer is a word", () => {
    expect(NOTIFICATION_DUTIES).toEqual(["dsa18_1", "dsa18_2", "tco14_5", "voluntary"]);
    expect(NOTIFICATION_SENT_KINDS).toEqual(["handle", "address", "created_at", "post_ids", "post_times", "report_time", "files"]);
    expect(NOTIFICATION_ANSWERS).toEqual(["not_illegal", "illegal", "no_assessment", "other"]);
    expect(PRODUCTION_INSTRUMENTS).toEqual(["notification", "demand", "court_order", "seizure", "dsa_art10", "preserved_access"]);
    expect(HANDOVER_INSTRUMENTS.every((kind) => (PRODUCTION_INSTRUMENTS as readonly string[]).includes(kind))).toBe(true);
    expect(ACCESS_PURPOSES).toEqual(["review", "complaint", "authority"]);
    expect(PRODUCED_KINDS).toEqual([...NOTIFICATION_SENT_KINDS, "content"]);
    expect(NOT_HELD_KINDS).toEqual(["name", "postal_address", "date_of_birth", "phone_number", "ip_address"]);
  });

  test("what the console learns of an owed report: a case, a kind and a time, and nothing more", () => {
    const owed = { total: 1, items: [{ caseId: "3a0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", kind: "sealed_images", since: "2026-10-17T00:00:00.000Z" }] };
    expect(ReportsOwed.parse(owed)).toEqual(owed);
    expect(REPORT_OWED_KINDS).toEqual(["sealed_images", ...NOTIFICATION_DUTIES]);
    expect(ReportsOwed.safeParse({ ...owed, items: [{ ...owed.items[0], kind: "BKA" }] }).success).toBe(false);
    // An authority, a reference or an account would be a member the schema does not know: it is stripped, never passed on.
    const parsed = ReportsOwed.parse({ ...owed, items: [{ ...owed.items[0], authority: "BKA", accountId: "x" }] });
    expect(Object.keys(parsed.items[0]!).sort()).toEqual(["caseId", "kind", "since"]);
  });

  test("W.8's sentence of what korbat does not hold, version 1, word for word", () => {
    expect(RECORDS_NOT_HELD_VERSION).toBe(1);
    expect(RECORDS_NOT_HELD[RECORDS_NOT_HELD_VERSION]).toBe(
      "korbat holds no name, postal address, date of birth, phone number or IP address of this account. It holds IP addresses, and a phone number the account verified, only as keyed hashes that identify nobody outside korbat; a device's hash is deleted 30 days after the device was last seen. korbat also holds, and has not produced here, the times and device types of the account's sign-ins.",
    );
  });

  test("the record's digest: the SHA-256 of its canonical JSON, the same whatever the order of its members", async () => {
    const a = await recordDigestOf({ record: { id: "r", state: "sent", duties: ["dsa18_1"] }, events: [] });
    const b = await recordDigestOf({ events: [], record: { duties: ["dsa18_1"], state: "sent", id: "r" } });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(await recordDigestOf({ record: { id: "r", state: "owed", duties: ["dsa18_1"] }, events: [] })).not.toBe(a);
  });
});
