import { describe, expect, test } from "vitest";
import { GRANT_ROLE_USAGE, grantRoleReport, parseGrantRoleArgs } from "../src/cli/grant-role";

describe("grant-role arguments", () => {
  test("accepts an email and a role, normalising the email", () => {
    expect(parseGrantRoleArgs([" Mod@Korbat.Local ", "moderator"])).toEqual({ email: "mod@korbat.local", role: "moderator" });
    expect(parseGrantRoleArgs(["a@b.io", "user"]).role).toBe("user");
    expect(parseGrantRoleArgs(["a@b.io", "admin"]).role).toBe("admin");
  });

  test("prints usage for a wrong number of arguments", () => {
    expect(() => parseGrantRoleArgs([])).toThrow(GRANT_ROLE_USAGE);
    expect(() => parseGrantRoleArgs(["a@b.io"])).toThrow(GRANT_ROLE_USAGE);
    expect(() => parseGrantRoleArgs(["a@b.io", "admin", "extra"])).toThrow(GRANT_ROLE_USAGE);
  });

  test("rejects an unknown role", () => {
    expect(() => parseGrantRoleArgs(["a@b.io", "superuser"])).toThrow("unknown role: superuser");
    expect(() => parseGrantRoleArgs(["a@b.io", "Admin"])).toThrow("unknown role: Admin");
  });

  test("rejects something that is not an email address", () => {
    expect(() => parseGrantRoleArgs(["moderator", "a@b.io"])).toThrow("not an email address: moderator");
  });
});

describe("grant-role's report", () => {
  const granted = { userId: "u1", previousRole: "moderator" as const, staffSessionsRevoked: 2, enrollmentsDeleted: 1, staffKeysRevoked: 1, mailError: null, tombstoneError: null };

  test("the summary, and no warning when every step after the commit went through", () => {
    expect(grantRoleReport(granted, "user")).toEqual({
      out: ["user u1: role moderator -> user; every session revoked; 2 staff sessions and 1 staff keys revoked, 1 unused enrolment links deleted"],
      warnings: [],
    });
  });

  test("a mail or the tombstones that failed after the commit are warnings beside the summary: the change stands", () => {
    const report = grantRoleReport({ ...granted, mailError: "smtp down", tombstoneError: "connect ECONNREFUSED 127.0.0.1:6379" }, "user");
    expect(report.out).toEqual(grantRoleReport(granted, "user").out);
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings[0]).toMatch(/revoked app sessions could not be marked .*ECONNREFUSED.*the change stands/);
    expect(report.warnings[1]).toMatch(/staff_keys_revoked mail .*smtp down.*the change stands/);
  });
});
