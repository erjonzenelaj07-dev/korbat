import { describe, expect, test } from "vitest";
import { STANDING_RULES } from "@korbat/contracts";
import { REDRESS_TEXTS, REDRESS_VERSION, RULEBOOKS, RULES, RULES_VERSION, getRedress, getRule, isRuleId, ORDER_NOTICE } from "../src/index";

const VERSIONS = [1, 2, 3] as const;

describe("rulebook", () => {
  test("the current rulebook is version 3, and every version is kept: a decision renders with the rules it was made under", () => {
    expect(RULES_VERSION).toBe(3);
    expect(Object.keys(RULEBOOKS).map(Number)).toEqual([...VERSIONS]);
    expect(RULES).toBe(RULEBOOKS[RULES_VERSION]);
  });

  test.each(VERSIONS)("version %i has exactly six rules R1..R6 in order", (version) => {
    expect(RULEBOOKS[version].map((r) => r.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });

  test.each(VERSIONS)("every rule of version %i has text and at least one example on each side", (version) => {
    for (const r of RULEBOOKS[version]) {
      expect(r.title.length, r.id).toBeGreaterThan(5);
      expect(r.text.length, r.id).toBeGreaterThan(40);
      expect(r.notAllowed.length, r.id).toBeGreaterThan(0);
      expect(r.allowed.length, r.id).toBeGreaterThan(0);
    }
  });

  test("version 1 is the six rules as they stood: only R2 fully automated, only R1 auto-withheld", () => {
    const v1 = RULEBOOKS[1];
    expect(v1.filter((r) => r.automation === "auto_remove").map((r) => r.id)).toEqual(["R2"]);
    expect(v1.filter((r) => r.automation === "withhold_for_review").map((r) => r.id)).toEqual(["R1"]);
    expect(v1.filter((r) => r.seniorQueue).map((r) => r.id)).toEqual(["R2", "R5"]);
    expect(getRule("R1", 1)?.text).toContain("Images that score high on the automated check are hidden from others until a person reviews them");
    expect(getRule("R2", 1)?.text).toContain("removed automatically on a hash match");
    expect(getRule("R5", 1)?.text).toContain("Cases go to the senior queue.");
    expect(getRule("R6", 1)?.title).toBe("No spam, scams, or impersonation");
  });

  test("version 2 automates nothing: a person decides every case, and R2 and R5 are an admin's", () => {
    const v2 = RULEBOOKS[2];
    expect(v2.filter((r) => r.automation !== "none").map((r) => r.id)).toEqual([]);
    expect(v2.filter((r) => r.seniorQueue).map((r) => r.id)).toEqual(["R2", "R5"]);
  });

  test("version 2's R1 no longer promises an automated check", () => {
    expect(getRule("R1", 2)?.text).toBe(
      "Images or text whose primary purpose is sexual arousal are not allowed. This includes nudity presented sexually, explicit sexual acts, and sexualised depictions of anyone.",
    );
  });

  test("version 2's R2 says that nobody opens reported images, who seals them and who decides", () => {
    expect(getRule("R2", 2)?.text).toBe(
      "Any sexualised depiction of a minor is not allowed. Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed. " +
        "After an admin has answered without a seal, staff may open them like any other image. Whoever is on duty may seal them while an admin decides: sealed images are shown to nobody, their author included. " +
        "An admin either seals them for good, in which case they are kept only for the authorities and reported to them, or answers without a seal. " +
        "Every final decision on a report or finding under this rule, whether it acts or not, and every review of one, is taken by an admin. " +
        "Only an admin can lift a seal, and a seal for good only on the authorities' answer; an appeal of a seal waits until the authorities have assessed the images.",
    );
  });

  test("version 2's R4 hides on a moderator's decision, never on the number of reports", () => {
    const text = getRule("R4", 2)!.text;
    expect(text.endsWith("When a moderator finds a report credible, the post is hidden from others while the moderator decides, because the harm is immediate. The number of reports never decides it.")).toBe(true);
    expect(text).not.toContain("When a report is credible the post is hidden");
    // Everything before its last sentence is version 1's.
    expect(text.startsWith(getRule("R4", 1)!.text.split(" When a report is credible")[0]!)).toBe(true);
  });

  test("version 2's R5 says who may hide a threat, who decides, and who reviews an appeal", () => {
    const text = getRule("R5", 2)!.text;
    expect(text).not.toContain("senior queue");
    expect(
      text.endsWith(
        "Any moderator may hide a reported threat from others at once while an admin decides, and may lift that again. " +
          "Every final decision on a report under this rule, whether it acts or not, is taken by an admin, and only an admin corrects one. " +
          "An appeal against a restriction under it is reviewed by a moderator who made none of the case's decisions and did not report it themselves, and waits while korbat has none.",
      ),
    ).toBe(true);
  });

  test("version 2's R6 names coordinated manipulation, with its examples on both sides", () => {
    const r6 = getRule("R6", 2)!;
    expect(r6.title).toBe("No spam, scams, impersonation or coordinated manipulation");
    expect(r6.text).toContain("Coordinating several accounts, your own or other people's, to like, repost or report together is not allowed.");
    expect(r6.notAllowed).toEqual(expect.arrayContaining(["A group of accounts liking each other's posts on cue to lift them in Explore", "Reporting someone together to get them removed"]));
    expect(r6.allowed).toContain("Asking your followers to read or share a post");
    // Version 1's examples are all still there.
    for (const example of getRule("R6", 1)!.notAllowed) expect(r6.notAllowed).toContain(example);
    for (const example of getRule("R6", 1)!.allowed) expect(r6.allowed).toContain(example);
  });

  test("version 3 is version 2 with one change, to R6: repeated plainly unfounded reports, after a warning; a notice of illegal content is never restricted", () => {
    const [v2, v3] = [RULEBOOKS[2], RULEBOOKS[3]];
    for (const id of ["R1", "R2", "R3", "R4", "R5"]) expect(getRule(id, 3), id).toEqual(getRule(id, 2));
    expect(v3.filter((r) => r.automation !== "none").map((r) => r.id)).toEqual([]);
    expect(v3.filter((r) => r.seniorQueue).map((r) => r.id)).toEqual(v2.filter((r) => r.seniorQueue).map((r) => r.id));
    const [r6v2, r6v3] = [getRule("R6", 2)!, getRule("R6", 3)!];
    expect(r6v3.title).toBe(r6v2.title);
    expect(r6v3.text).toBe(
      `${r6v2.text} Sending report after report that is plainly unfounded is not allowed either: after a warning, korbat may stop taking an account's reports under these rules for a limited time. A notice of illegal content is never restricted.`,
    );
    expect(r6v3.notAllowed).toEqual([...r6v2.notAllowed, "Reporting the same account again and again for posts that plainly break no rule"]);
    expect(r6v3.allowed).toEqual([...r6v2.allowed, "Reporting in good faith something that turns out to break no rule"]);
  });

  test("R3 reads the same in both versions", () => {
    expect(getRule("R3", 2)).toEqual(getRule("R3", 1));
  });

  test("getRule reads a rule of one version, the current one unless told, and isRuleId knows the six ids", () => {
    expect(getRule("R3")?.title).toMatch(/hatred/i);
    expect(getRule("R6")).toBe(getRule("R6", RULES_VERSION));
    expect(getRule("R6", 1)?.title).not.toBe(getRule("R6", 2)?.title);
    expect(getRule("R9")).toBeUndefined();
    expect(getRule("R1", 4)).toBeUndefined();
    expect(isRuleId("R6")).toBe(true);
    expect(isRuleId("x")).toBe(false);
  });
});

describe("redress", () => {
  const LAST = "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live (Article 53 of the Digital Services Act).";

  test("the current redress version is 3: version 2's nine texts word for word and the order's notice; versions 1 and 2 are kept as they were", () => {
    expect(REDRESS_VERSION).toBe(3);
    expect(Object.keys(REDRESS_TEXTS).map(Number)).toEqual([1, 2, 3]);
    expect(Object.keys(REDRESS_TEXTS[1])).toEqual(["appeal", "interim", "notAppealable"]);
    expect(Object.keys(REDRESS_TEXTS[2])).toEqual(["appeal", "interim", "notAppealable", "strikeNext", "reply", "replyAtOnce", "replyAnswered", "warnNext", "appealNow"]);
    for (const key of ["appeal", "interim", "notAppealable"] as const) expect(REDRESS_TEXTS[2][key], key).toBe(REDRESS_TEXTS[1][key]);
    // 3f (design, section 10.7; W.3): version 3 adds the group `order` and changes no sentence of version 2.
    expect(Object.keys(REDRESS_TEXTS[3])).toEqual([...Object.keys(REDRESS_TEXTS[2]), "order"]);
    for (const key of Object.keys(REDRESS_TEXTS[2]) as (keyof (typeof REDRESS_TEXTS)[2])[]) expect(REDRESS_TEXTS[3][key], key).toBe(REDRESS_TEXTS[2][key]);
    expect(REDRESS_TEXTS[3].order).toBe(ORDER_NOTICE);
    expect(getRedress(REDRESS_VERSION)).toBe(REDRESS_TEXTS[3]);
    expect(getRedress(2)).toBe(REDRESS_TEXTS[2]);
    expect(getRedress(1)).toBe(REDRESS_TEXTS[1]);
    expect(getRedress(4)).toBeUndefined();
  });

  test("version 2's six new texts, word for word (3e design, section 18, W.3)", () => {
    const v2 = REDRESS_TEXTS[2];
    expect(v2.strikeNext).toBe(
      "A strike restricts nothing by itself. When an account has 3 active strikes, a moderator may decide to suspend it for a limited time or, after three suspensions in 365 days, an admin may decide to terminate it. You would be told first and could reply before anything is restricted.",
    );
    expect(v2.reply).toBe(
      `Before it starts you can reply: choose "Reply" on this decision's screen under Settings, Cases, and say anything you want the moderator to weigh. A reply sent before the start holds the start until a moderator has read it and answered you; if the decision is kept, it then starts with the answer, and never before the time you were given. A reply sent later is read and answered too, and can end this measure, but does not pause it. You can reply once. Replying does not use up your appeal.`,
    );
    expect(v2.replyAtOnce).toBe(
      `You can reply at any time while it runs: choose "Reply" on this decision's screen under Settings, Cases. A moderator reads your reply and answers you, and can end this measure at once; the reply does not pause it. You can reply once. Replying does not use up your appeal.`,
    );
    expect(v2.replyAnswered).toBe(
      `This answer is not appealed by itself. The appeal is against the decision it keeps: once, free of charge, until {deadline}, with "Appeal" on that decision's screen under Settings, Cases. The six months for it count from this answer when you replied before the start, and otherwise from the day you were told of that decision. ${LAST}`,
    );
    expect(v2.warnNext).toBe("If 3 of the reports you send after this warning are marked that way while it counts, a moderator may restrict your reports under korbat's rules for up to 30 days.");
    expect(v2.appealNow).toBe("You can appeal from now; you do not have to wait for the start. An appeal does not hold the start: only a reply sent before the start does.");
  });

  test("every number in version 2's texts is held to STANDING_RULES: a changed number is a new version, so an old statement keeps its own", () => {
    const v2 = REDRESS_TEXTS[2];
    const words = ["zero", "one", "two", "three", "four", "five"];
    expect(v2.strikeNext).toContain(`When an account has ${STANDING_RULES.ladderStrikes} active strikes`);
    expect(v2.strikeNext).toContain(`after ${words[STANDING_RULES.ladderDays.length]} suspensions in ${STANDING_RULES.ladderMemoryDays} days`);
    expect(v2.warnNext).toContain(`If ${STANDING_RULES.reportRestrictMarks} of the reports`);
    expect(v2.warnNext).toContain(`for up to ${STANDING_RULES.reportRestrictDays} days`);
    // No other number is typed into them.
    const numbers = (text: string) => [...text.matchAll(/[0-9]+/g)].map((match) => Number(match[0]));
    expect(numbers(v2.strikeNext)).toEqual([STANDING_RULES.ladderStrikes, STANDING_RULES.ladderMemoryDays]);
    expect(numbers(v2.warnNext)).toEqual([STANDING_RULES.reportRestrictMarks, STANDING_RULES.reportRestrictDays]);
    for (const key of ["reply", "replyAtOnce", "appealNow"] as const) expect(numbers(v2[key]), key).toEqual([]);
    // Article 53 of the Digital Services Act is a law's number, not one of korbat's.
    expect(numbers(v2.replyAnswered)).toEqual([53]);
  });

  test("the appeal's text names its deadline, the courts and the Digital Services Coordinator", () => {
    // Version 1's text is fixed: a decision names the version it was made under, and its statement quotes this text for good.
    expect(REDRESS_TEXTS[1].appeal).toBe(
      `You can appeal this decision once, free of charge, within six months of being told, until {deadline}: choose "Appeal" on this decision's screen under Settings, Cases. A moderator who took no part in the case reviews it. ${LAST}`,
    );
  });

  test("the interim text is the one of a decision taken while deciding", () => {
    expect(REDRESS_TEXTS[1].interim).toBe(
      `This applies while korbat decides, and ends with its decision. If korbat's decision restricts your post or profile, you can appeal it. ${LAST}`,
    );
  });

  test("the third text is the one of a decision its author cannot appeal", () => {
    expect(REDRESS_TEXTS[1].notAppealable).toBe(
      "korbat's appeal does not apply to this decision. Where an earlier decision about this content still stands in part, its own screen in korbat says whether you can still appeal it. " +
        "You can go to court, or complain to the Digital Services Coordinator of the EU country where you live (Article 53 of the Digital Services Act).",
    );
  });
});
