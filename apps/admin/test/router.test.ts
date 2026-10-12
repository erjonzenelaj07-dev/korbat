import { describe, expect, test } from "vitest";
import { caseHref, isLowerUuid, parseCaseId, parseRoute } from "../src/router";

const CASE = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

/** The console's own router (3a design, section 9; 3c design, section 8): its fixed pages, a case by its id, and nothing else. */
describe("the router", () => {
  test("the queue, the appeals and a case by its lower-case id", () => {
    expect(parseRoute("/queue")).toEqual({ name: "queue" });
    expect(parseRoute("/queue/")).toEqual({ name: "queue" });
    expect(parseRoute("/appeals")).toEqual({ name: "appeals" });
    expect(parseRoute(`/cases/${CASE}`)).toEqual({ name: "case", id: CASE });
    expect(parseRoute(`/cases/${CASE}/`)).toEqual({ name: "case", id: CASE });
  });

  test("anything else under /cases is no page: an id in upper case, a part of one, a path below one, a list", () => {
    for (const path of ["/cases", "/cases/", `/cases/${CASE.toUpperCase()}`, `/cases/${CASE.slice(1)}`, `/cases/${CASE}/decisions`, `/cases/${CASE}x`, "/cases/..%2Fapi", `/Cases/${CASE}`, "/queue/x", "/appeals/1"]) {
      expect(parseRoute(path), path).toEqual({ name: "unknown" });
    }
  });

  test("parseCaseId makes a case's id only from a lower-case uuid, and a case's address is built from nothing else", () => {
    const id = parseCaseId(CASE);
    expect(id).toBe(CASE);
    expect(caseHref(id!)).toBe(`/cases/${CASE}`);
    for (const text of ["", "x", CASE.toUpperCase(), ` ${CASE}`, `${CASE}/..`, `${CASE}?x=1`, "javascript:alert(1)", "../../api/staff/me", CASE.split("-").join("")]) {
      expect(parseCaseId(text), text).toBeNull();
      expect(isLowerUuid(text), text).toBe(false);
    }
  });

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
