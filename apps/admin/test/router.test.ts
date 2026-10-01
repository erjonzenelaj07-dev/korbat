import { describe, expect, test } from "vitest";
import { parseRoute } from "../src/router";

/** The console's own router (3a design, section 9): four paths and nothing else. */
describe("the router", () => {
  test("the four paths", () => {
    expect(parseRoute("/")).toEqual({ name: "home" });
    expect(parseRoute("/audit")).toEqual({ name: "audit" });
    expect(parseRoute("/signin")).toEqual({ name: "signin" });
    const token = "A".repeat(20) + "b_-".repeat(7) + "zz";
    expect(parseRoute(`/enroll/${token}`)).toEqual({ name: "enroll", token });
  });

  test("a trailing slash names the same page", () => {
    expect(parseRoute("/audit/")).toEqual({ name: "audit" });
    expect(parseRoute("/signin/")).toEqual({ name: "signin" });
    expect(parseRoute("/enroll/abc/")).toEqual({ name: "enroll", token: "abc" });
  });

  test("an enrolment path keeps its token exactly as written, for the page to check", () => {
    expect(parseRoute("/enroll/%3Cscript%3E")).toEqual({ name: "enroll", token: "%3Cscript%3E" });
  });

  test("anything else is no page of the console", () => {
    for (const path of ["", "/home", "/Audit", "/audit/x", "/enroll", "/enroll/", "/enroll/a/b", "/api/staff/me", "//audit", "/signin/x"]) {
      expect(parseRoute(path), path).toEqual({ name: "unknown" });
    }
  });
});
