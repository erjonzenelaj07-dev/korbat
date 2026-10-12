import { describe, expect, test } from "vitest";
import { DecisionStrike, PERIOD_STATES, PostModeration, REPLY_TEXT_MAX, STANDING_BASES, STANDING_DAYS, STANDING_DRAFTS, STANDING_RULES, StatementMeasure, UNFOUNDED_MAX } from "../src/index";

// Account sanctions (3e design, section 10.1): the constants every word of the console and the app is printed from. The
// database test (apps/api, standing-ledger.test.ts) holds STANDING_RULES to the SQL function standing_rules() name by name.

describe("STANDING_RULES", () => {
  test("holds the cautious defaults of the design, each one line to change", () => {
    expect(STANDING_RULES).toEqual({
      strikeDays: 90,
      ladderStrikes: 3,
      ladderDays: [3, 7, 30],
      ladderMemoryDays: 365,
      replyWindowHours: 168,
      undeliveredHours: 336,
      threatDays: 30,
      terroristDays: 30,
      floodDays: 7,
      protectiveDays: 14,
      floodPosts: 20,
      floodMinutes: 60,
      basisAgeDays: 30,
      reportFrameDays: 90,
      reportWarnMarks: 5,
      reportWarnShare: 0.5,
      reportRestrictMarks: 3,
      reportRestrictDays: 30,
    });
  });

  test("its numbers fit together: the undelivered window is twice the reply window, and no measure is longer than its days allow", () => {
    expect(STANDING_RULES.undeliveredHours).toBe(2 * STANDING_RULES.replyWindowHours);
    const longest = Math.max(...STANDING_RULES.ladderDays, STANDING_RULES.threatDays, STANDING_RULES.terroristDays, STANDING_RULES.floodDays, STANDING_RULES.protectiveDays, STANDING_RULES.reportRestrictDays);
    expect(longest).toBeLessThanOrEqual(STANDING_DAYS.max);
    expect(STANDING_DAYS).toEqual({ min: 1, max: 30 });
    // The rungs grow.
    expect([...STANDING_RULES.ladderDays].sort((a, b) => a - b)).toEqual([...STANDING_RULES.ladderDays]);
  });
});

describe("the other constants of 3e", () => {
  test("the bases, the bounds of a reply and of a decision's marks, and the states of a period", () => {
    expect(STANDING_BASES).toEqual(["strikes", "threat", "terrorist", "flood", "protective", "threat_repeat", "ladder_end", "reports"]);
    expect(REPLY_TEXT_MAX).toBe(2000);
    expect(UNFOUNDED_MAX).toBe(100);
    expect(PERIOD_STATES).toEqual(["unfixed", "announced", "held", "running", "ended", "never", "lifted", "basis_ended"]);
  });

  test("the composer's drafts are W.5's ten texts, each placeholder one the case answer fills", () => {
    const texts = [...Object.values(STANDING_DRAFTS.facts), ...Object.values(STANDING_DRAFTS.reason)];
    expect(texts).toHaveLength(10);
    expect(Object.keys(STANDING_DRAFTS.facts)).toEqual(["strikes", "ladder_end", "threat", "terrorist", "threat_repeat", "flood", "protective", "warn", "restrict"]);
    expect(Object.keys(STANDING_DRAFTS.reason)).toEqual(["protective"]);
    const known = new Set(["activeStrikes", "n", "ladderMemoryDays", "day", "posts", "from", "to", "sealedOn", "frameDays", "readDay", "reports", "unfounded", "marked", "warnedOn", "marksSince"]);
    for (const text of texts) {
      for (const match of text.matchAll(/[{]([a-zA-Z]+)[}]/g)) expect(known.has(match[1]!), `${match[1]} in "${text}"`).toBe(true);
    }
    // A draft that holds a count says when it was counted: the key signs the text, the database counts at the commit.
    expect(STANDING_DRAFTS.facts.strikes).toMatch(/^When this was written/);
    expect(STANDING_DRAFTS.facts.ladder_end).toMatch(/^When this was written/);
    // Nothing of a protective suspension says or implies that the images are such material, or promises a later look.
    for (const text of [STANDING_DRAFTS.facts.protective, STANDING_DRAFTS.reason.protective]) {
      expect(text).not.toMatch(/nobody at korbat has seen|until an admin has looked/i);
    }
    expect(STANDING_DRAFTS.facts.protective).toContain("korbat has not assessed them");
    expect(STANDING_DRAFTS.reason.protective).toContain("korbat makes no finding that this account broke the law or a korbat rule");
  });
});

describe("what the app reads of a strike", () => {
  test("a post's chip carries the end of its strike, or null", () => {
    const chip = { decisionId: "4a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", ruleId: "R3", legal: false, interim: false };
    expect(PostModeration.parse({ ...chip, strikeUntil: "2027-01-01T00:00:00.000Z" }).strikeUntil).toBe("2027-01-01T00:00:00.000Z");
    expect(PostModeration.parse({ ...chip, strikeUntil: null }).strikeUntil).toBeNull();
    expect(PostModeration.safeParse(chip).success).toBe(false);
  });

  test("a decision's strike counts, ran out or was overruled; a statement's strike carries its end and how many counted then", () => {
    for (const state of ["counts", "expired", "overruled"] as const) expect(DecisionStrike.parse({ countsUntil: "2027-01-01T00:00:00.000Z", state, overruledAt: null }).state).toBe(state);
    expect(DecisionStrike.safeParse({ countsUntil: "2027-01-01T00:00:00.000Z", state: "paused", overruledAt: null }).success).toBe(false);
    const strike = { kind: "strike", mediaId: null, noEffect: null, sealed: null, endsAt: "2027-01-01T00:00:00.000Z", activeThen: 2 };
    expect(StatementMeasure.parse(strike)).toEqual(strike);
    // 3c's measures carry neither, and parse as they did.
    expect(StatementMeasure.parse({ kind: "remove", mediaId: null, noEffect: null, sealed: null })).toEqual({ kind: "remove", mediaId: null, noEffect: null, sealed: null });
  });
});
