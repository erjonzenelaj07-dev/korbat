import { describe, expect, test } from "vitest";
import { RULES, getRule, isRuleId } from "../src/index";

describe("rulebook", () => {
  test("has exactly six rules R1..R6 in order", () => {
    expect(RULES.map((r) => r.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });
  test("every rule has text and at least one example on each side", () => {
    for (const r of RULES) {
      expect(r.title.length, r.id).toBeGreaterThan(5);
      expect(r.text.length, r.id).toBeGreaterThan(40);
      expect(r.notAllowed.length, r.id).toBeGreaterThan(0);
      expect(r.allowed.length, r.id).toBeGreaterThan(0);
    }
  });
  test("only R2 is fully automated; only R1 is auto-withheld", () => {
    expect(RULES.filter((r) => r.automation === "auto_remove").map((r) => r.id)).toEqual(["R2"]);
    expect(RULES.filter((r) => r.automation === "withhold_for_review").map((r) => r.id)).toEqual(["R1"]);
  });
  test("getRule and isRuleId", () => {
    expect(getRule("R3")?.title).toMatch(/hatred/i);
    expect(getRule("R9")).toBeUndefined();
    expect(isRuleId("R6")).toBe(true);
    expect(isRuleId("x")).toBe(false);
  });
});
