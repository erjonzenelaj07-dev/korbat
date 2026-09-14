import { describe, expect, test } from "vitest";
import { GRANT_ROLE_USAGE, parseGrantRoleArgs } from "../src/cli/grant-role";

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
