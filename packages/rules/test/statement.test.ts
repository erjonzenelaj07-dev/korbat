import { describe, expect, test } from "vitest";
import { MEASURES, MEASURE_KINDS, ORDER_DRAFTS, ORDER_GROUNDS, ORDER_RULES, RETENTION, REVERSAL_KINDS, SEAL_DRAFTS, STANDING_RULES, appealDeadline, type DecisionStatement, type MeasureKind, type ReversalKind } from "@korbat/contracts";
import { ORDER_NOTICE, REDRESS_TEXTS, RULEBOOKS, STATEMENT_WORDS, getRule, retireEnd, statementParagraphs, type StatementInput } from "../src/index";

/**
 * The statement of reasons (3c design, section 10): one pure function renders it for the author's screen, the console's
 * preview and the mail, from the decision's data and the versions it was made under. These tests hold it to the six
 * elements of Article 17(3) of the Digital Services Act for every kind of decision, and to the design's sentences word
 * for word.
 */
const POST = { id: "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36", createdAt: "2026-10-01T12:00:00.000Z" };
const POST_TIME = "2026-10-01 12:00 UTC";
const DECIDED = "2026-10-04T09:30:15.250Z";
const IMAGE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const RESET_DECISION = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const NO_RESET = { resetDecisionId: null, oldValueKept: false, resetRuleId: null } as const;

const measure = (kind: MeasureKind, more: Partial<DecisionStatement["measures"][number]> = {}): DecisionStatement["measures"][number] => ({
  kind,
  mediaId: MEASURES[kind].target === "image" ? IMAGE : null,
  noEffect: null,
  sealed: kind === "seal_media" ? { posts: 1, images: 2, deletedImages: 0 } : null,
  ...more,
});
const reversal = (kind: ReversalKind, more: Partial<DecisionStatement["reversals"][number]> = {}): DecisionStatement["reversals"][number] => ({
  kind,
  mediaId: MEASURES[kind].target === "image" ? IMAGE : null,
  ...NO_RESET,
  ...more,
});

/** A final removal of a post under R1, following a report: the plainest restricting decision. */
function statement(more: Partial<StatementInput> = {}): StatementInput {
  return {
    kind: "final",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R1",
    rulesVersion: 2,
    redressVersion: 1,
    legalReference: null,
    facts: "The post shows explicit sexual acts.",
    reason: "That is content whose primary purpose is sexual arousal.",
    source: "report",
    decidedAt: DECIDED,
    post: POST,
    measures: [measure("remove")],
    reversals: [],
    endedMeasures: [],
    reviewed: null,
    ...more,
  };
}

const W = STATEMENT_WORDS;
const text = (input: StatementInput) => statementParagraphs(input).join("\n");
/** A line break, to join paragraphs for a search across them (3f's tests). */
const NL = String.fromCharCode(10);
const appeal = (decidedAt: string) => REDRESS_TEXTS[1].appeal.replace("{deadline}", `${appealDeadline(new Date(decidedAt)).toISOString().slice(0, 10)} ${appealDeadline(new Date(decidedAt)).toISOString().slice(11, 16)} UTC`);

describe("statementParagraphs", () => {
  test("a final removal under a rule, paragraph by paragraph: what was done, where and how long, how it came to korbat, no automation, the rule as its version words it, the facts, the reason and the appeal", () => {
    expect(statementParagraphs(statement())).toEqual([
      `korbat removed your post of ${POST_TIME}: other people can no longer see it.`,
      "This applies everywhere korbat is available and has no end date.",
      "korbat decided this following a report by another user.",
      "No automated means were used to find this or to decide it.",
      `It breaks korbat rule R1, "No sexual or pornographic content": ${getRule("R1", 2)!.text}`,
      "The facts: The post shows explicit sexual acts.",
      "korbat's reasons: That is content whose primary purpose is sexual arousal.",
      appeal(DECIDED),
    ]);
    // The deadline is the appeal's own: six months after the decision, to the minute, in UTC.
    expect(text(statement())).toContain("until 2027-04-04 09:30 UTC");
  });

  test("a time is printed as the mails print one: the date and the minute, in UTC", () => {
    expect(text(statement({ post: { id: POST.id, createdAt: "2026-02-28T23:59:59.999Z" } }))).toContain("your post of 2026-02-28 23:59 UTC");
  });

  test("an old statement renders with the rulebook it was made under", () => {
    for (const version of [1, 2, 3] as const) {
      for (const rule of RULEBOOKS[version]) {
        const out = text(statement({ ruleId: rule.id as StatementInput["ruleId"], rulesVersion: version }));
        expect(out, `${rule.id} v${version}`).toContain(`It breaks korbat rule ${rule.id}, "${rule.title}": ${rule.text}`);
      }
    }
    // R6 changed its title, R1 its text: version 1 keeps the old words.
    expect(text(statement({ ruleId: "R6", rulesVersion: 1 }))).toContain('"No spam, scams, or impersonation"');
    expect(text(statement({ ruleId: "R6", rulesVersion: 2 }))).toContain('"No spam, scams, impersonation or coordinated manipulation"');
    expect(text(statement({ ruleId: "R1", rulesVersion: 1 }))).toContain("Images that score high on the automated check");
    expect(text(statement({ ruleId: "R1", rulesVersion: 2 }))).not.toContain("Images that score high on the automated check");
    // A version the package does not hold cannot be rendered as another one.
    expect(() => statementParagraphs(statement({ rulesVersion: 9 }))).toThrow(/rulebook/);
    expect(() => statementParagraphs(statement({ redressVersion: 9 }))).toThrow(/redress/);
  });

  test("a decision on the law names the law, never a rule, and says that it applies everywhere", () => {
    const out = statementParagraphs(statement({ ground: "illegal", ruleId: null, legalReference: "Section 241 of the criminal code (threats).", source: "notice" }));
    expect(out).toContain("korbat found it illegal. The law it rests on: Section 241 of the criminal code (threats).");
    expect(out).toContain("korbat cannot restrict content for one country alone, so this applies everywhere, which is more than the law of a single country asks for.");
    expect(out).toContain("korbat decided this following a notice under Article 16 of the Digital Services Act.");
    expect(out.join("\n")).not.toMatch(/korbat rule R[1-6]/);
  });

  test("the source is one of three phrases", () => {
    expect(W.source).toEqual({
      notice: "following a notice under Article 16 of the Digital Services Act",
      report: "following a report by another user",
      own_initiative: "found by a moderator",
    });
    expect(text(statement({ source: "own_initiative" }))).toContain("What this decision is about was found by a moderator.");
    for (const source of ["notice", "report", "own_initiative"] as const) expect(text(statement({ source })), source).toContain(W.source[source]);
  });

  describe("the redress text follows the decision's own kind and outcome, never a later event", () => {
    test("an interim decision carries the interim text and no appeal", () => {
      const out = statementParagraphs(statement({ kind: "interim", measures: [measure("withhold")] }));
      expect(out[0]).toBe(`korbat hid your post of ${POST_TIME} from other people while it decides.`);
      expect(out).toContain("This applies everywhere korbat is available, for as long as korbat decides the case.");
      expect(out.at(-1)).toBe(REDRESS_TEXTS[1].interim);
      expect(out.join("\n")).not.toContain("You can appeal this decision once");
    });

    test("a final restriction carries korbat's appeal with its deadline", () => {
      expect(statementParagraphs(statement()).at(-1)).toBe(appeal(DECIDED));
    });

    test("3f's review (people3): a decision its author was told of later than it was taken (held with an order's notice) counts the six months from the telling", () => {
      const told = "2027-01-02T10:05:00.000Z";
      expect(statementParagraphs(statement({ informedAt: told })).at(-1)).toBe(appeal(told));
      // Told at once, held still (null), or written before the member existed: from the decision, as before.
      expect(statementParagraphs(statement({ informedAt: DECIDED })).at(-1)).toBe(appeal(DECIDED));
      expect(statementParagraphs(statement({ informedAt: null })).at(-1)).toBe(appeal(DECIDED));
      expect(statementParagraphs(statement()).at(-1)).toBe(appeal(DECIDED));
    });

    test("every other decision carries the text for a decision its author cannot appeal", () => {
      const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R1" as const, rulesVersion: 2, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
      const others: StatementInput[] = [
        statement({ outcome: "no_violation", ground: null, ruleId: null, facts: null, reason: null, measures: [], endedMeasures: [{ kind: "withhold", mediaId: null, ...NO_RESET }] }),
        statement({ outcome: "not_evident", ground: null, ruleId: null, facts: null, reason: null, measures: [] }),
        statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, measures: [], reversals: [reversal("restore")], reviewed }),
        statement({ kind: "correction", outcome: "partly_reversed", ground: null, ruleId: null, facts: null, measures: [], reversals: [reversal("restore_media")], reviewed }),
        statement({ kind: "review", outcome: "kept", ground: null, ruleId: null, facts: null, measures: [], reviewed }),
        statement({ kind: "review", outcome: "reversed", ground: null, ruleId: null, facts: null, measures: [], reversals: [reversal("restore")], reviewed }),
      ];
      for (const input of others) expect(statementParagraphs(input).at(-1), `${input.kind} ${input.outcome}`).toBe(REDRESS_TEXTS[1].notAppealable);
    });
  });

  test("every restricting decision carries the six elements of Article 17(3): each measure, kind, ground and rulebook version", () => {
    const grounds = [
      { ground: "incompatible" as const, ruleId: "R3" as const, legalReference: null },
      { ground: "illegal" as const, ruleId: null, legalReference: "Section 130 of the criminal code." },
    ];
    for (const kind of ["interim", "final"] as const) {
      // 3c's seven measures; 3e's are held to their own sentences below and in later tasks.
      for (const measureKind of MEASURE_KINDS.slice(0, 7)) {
        if (!MEASURES[measureKind][kind]) continue;
        for (const ground of grounds) {
          for (const rulesVersion of [1, 2]) {
            const account = MEASURES[measureKind].target === "display_name" || MEASURES[measureKind].target === "bio";
            const input = statement({ kind, ...ground, rulesVersion, post: account ? null : POST, measures: [measure(measureKind)] });
            const out = statementParagraphs(input);
            const label = `${kind} ${measureKind} ${ground.ground} v${rulesVersion}`;
            // (a) the restriction, where it applies and for how long.
            expect(out[0], label).toMatch(/^korbat (hid|removed|sealed|reset) /);
            expect(out, label).toContain(kind === "interim" ? W.scope.interim : W.scope.final);
            // (b) the facts, and whether the decision followed a notice or korbat's own finding.
            expect(out, label).toContain("The facts: The post shows explicit sexual acts.");
            expect(out, label).toContain("korbat decided this following a report by another user.");
            // (c) the use of automated means.
            expect(out, label).toContain(W.automation);
            // (d) and (e) the legal ground, or the rule, with its explanation: as a finding only for a final restriction
            // that seals nothing; while deciding, as what korbat is checking; for a seal, as what the step rests on.
            const rule = getRule("R3", rulesVersion)!;
            const seals = measureKind === "seal_media";
            if (ground.ground === "illegal") {
              expect(out, label).toContain(seals ? "This step rests on the law: Section 130 of the criminal code." : kind === "interim" ? "korbat is checking whether this is illegal. The law in question: Section 130 of the criminal code." : "korbat found it illegal. The law it rests on: Section 130 of the criminal code.");
            } else {
              expect(out, label).toContain(`${seals ? "This step rests on" : kind === "interim" ? "korbat is checking this against" : "It breaks"} korbat rule R3, "${rule.title}": ${rule.text}`);
            }
            if (seals || kind === "interim") expect(out.join(" "), label).not.toMatch(/It breaks korbat rule|korbat found it illegal/);
            expect(out, label).toContain("korbat's reasons: That is content whose primary purpose is sexual arousal.");
            // (f) redress.
            expect(out.at(-1)!.startsWith(kind === "interim" ? REDRESS_TEXTS[1].interim : "You can appeal this decision once"), label).toBe(true);
            // One paragraph is one line, but for a staff text that holds line feeds of its own, and none is empty.
            for (const paragraph of out) expect(paragraph.trim().length, label).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  describe("what was done, for each measure", () => {
    test("a post and an image, while deciding and for good", () => {
      expect(statementParagraphs(statement({ kind: "interim", measures: [measure("withhold_media")] }))[0]).toBe(`korbat hid one image of your post of ${POST_TIME} from other people while it decides.`);
      expect(statementParagraphs(statement({ measures: [measure("remove_media")] }))[0]).toBe(`korbat removed one image of your post of ${POST_TIME}: other people can no longer see it.`);
      // Several measures in one decision: one paragraph each, in the decision's order.
      const both = statementParagraphs(statement({ measures: [measure("remove"), measure("remove_media")] }));
      expect(both.slice(0, 2)).toEqual([`korbat removed your post of ${POST_TIME}: other people can no longer see it.`, `korbat removed one image of your post of ${POST_TIME}: other people can no longer see it.`]);
    });

    test("a field reset says that the placeholder was written once and that the old value does not come back", () => {
      const name = statementParagraphs(statement({ post: null, measures: [measure("reset_display_name")] }));
      expect(name[0]).toBe(
        "korbat reset your display name. korbat wrote this placeholder once. You may set your display name again; what you set is judged on its own if someone reports it, and korbat does not put the old value back when this measure ends or is lifted.",
      );
      const bio = statementParagraphs(statement({ kind: "interim", post: null, measures: [measure("reset_bio")] }));
      expect(bio[0]).toBe(
        "korbat reset your bio while it decides. korbat wrote this placeholder once. You may set your bio again; what you set is judged on its own if someone reports it, and korbat does not put the old value back when this measure ends or is lifted.",
      );
    });

    test("each noEffect sentence: another decision already holds it, the post or the account is deleted, the field already held the placeholder", () => {
      const first = (input: StatementInput) => statementParagraphs(input)[0];
      expect(first(statement({ measures: [measure("remove", { noEffect: "already" })] }))).toBe(
        `korbat removed your post of ${POST_TIME}: other people can no longer see it. Another decision already keeps this post from being shown, so this changes nothing anyone sees now. It stays in force should that decision be reversed.`,
      );
      expect(first(statement({ measures: [measure("remove_media", { noEffect: "already" })] }))).toBe(
        `korbat removed one image of your post of ${POST_TIME}: other people can no longer see it. Another decision already keeps this image from being shown, so this changes nothing anyone sees now. It stays in force should that decision be reversed.`,
      );
      expect(first(statement({ measures: [measure("remove", { noEffect: "deleted" })] }))).toBe(
        `korbat removed your post of ${POST_TIME}: other people can no longer see it. You had deleted this post, so this changes nothing anyone sees.`,
      );
      expect(first(statement({ post: null, measures: [measure("reset_bio", { noEffect: "already" })] }))).toBe("korbat reset your bio. The field already held korbat's placeholder, so this changes nothing now.");
      expect(first(statement({ post: null, measures: [measure("reset_display_name", { noEffect: "deleted" })] }))).toBe("korbat reset your display name. Your account is deleted, so this changes nothing.");
      // A reset that changed nothing wrote no placeholder, so it does not say that it wrote one.
      expect(first(statement({ post: null, measures: [measure("reset_bio", { noEffect: "already" })] }))).not.toContain("wrote this placeholder once");
    });
  });

  describe("the ground is worded by what the decision is", () => {
    const r2 = getRule("R2", 2)!;
    const r5 = getRule("R5", 2)!;

    test("the words, each a constant", () => {
      expect(W.ground.sealRule("R2", "Title", "Text.")).toBe('This step rests on korbat rule R2, "Title": Text.');
      expect(W.ground.sealLaw("Section 184b.")).toBe("This step rests on the law: Section 184b.");
      expect(W.ground.checkingRule("R5", "Title", "Text.")).toBe('korbat is checking this against korbat rule R5, "Title": Text.');
      expect(W.ground.checkingLaw("Section 241.")).toBe("korbat is checking whether this is illegal. The law in question: Section 241.");
      expect(W.ground.breaks("R1", "Title", "Text.")).toBe('It breaks korbat rule R1, "Title": Text.');
      expect(W.ground.illegal("Section 241.")).toBe("korbat found it illegal. The law it rests on: Section 241.");
      expect(W.ground.restedOnRule("R1", "Title", "Text.")).toBe('That decision rested on korbat rule R1, "Title": Text.');
      expect(W.ground.restedOnLaw("Section 241.")).toBe("That decision rested on the law: Section 241.");
      expect(W.ground.referenceErased).toBe("its reference was erased under korbat's retention rules.");
    });

    test("a seal, while deciding and for good, on a report alone: the step rests on rule R2, and nothing says that the rule is broken or the images illegal", () => {
      const sealing = (kind: "interim" | "final") =>
        statementParagraphs(statement({ kind, ruleId: "R2", facts: SEAL_DRAFTS.facts.notice_post, reason: kind === "interim" ? SEAL_DRAFTS.reason.deciding : SEAL_DRAFTS.reason.final, source: "notice", measures: [measure("seal_media")] }));
      for (const kind of ["interim", "final"] as const) {
        const out = sealing(kind);
        expect(out, kind).toContain(`This step rests on korbat rule R2, "${r2.title}": ${r2.text}`);
        expect(out.join(" "), kind).not.toMatch(/It breaks korbat rule|korbat found it illegal|korbat is checking/);
      }
      // A seal in the category Protection of minors, on the law: the same, with the law.
      const law = statementParagraphs(statement({ kind: "interim", ground: "illegal", ruleId: null, legalReference: "Section 184b of the criminal code.", source: "notice", measures: [measure("seal_media")] }));
      expect(law).toContain("This step rests on the law: Section 184b of the criminal code.");
      expect(law.join(" ")).not.toMatch(/found it illegal|korbat is checking/);
    });

    test("a decision taken while deciding that seals nothing says what korbat is checking, on a rule and on the law", () => {
      const rule = statementParagraphs(statement({ kind: "interim", ruleId: "R5", measures: [measure("withhold")] }));
      expect(rule).toContain(`korbat is checking this against korbat rule R5, "${r5.title}": ${r5.text}`);
      const law = statementParagraphs(statement({ kind: "interim", ground: "illegal", ruleId: null, legalReference: "Section 241 of the criminal code (threats).", source: "notice", measures: [measure("withhold")] }));
      expect(law).toContain("korbat is checking whether this is illegal. The law in question: Section 241 of the criminal code (threats).");
      // Beside "while it decides", nothing states a finding.
      for (const out of [rule, law]) expect(out.join(" ")).not.toMatch(/It breaks korbat rule|korbat found it illegal/);
    });

    test("a final restriction that seals nothing states what korbat found", () => {
      expect(statementParagraphs(statement())).toContain(`It breaks korbat rule R1, "No sexual or pornographic content": ${getRule("R1", 2)!.text}`);
      expect(statementParagraphs(statement({ ground: "illegal", ruleId: null, legalReference: "Section 241." }))).toContain("korbat found it illegal. The law it rests on: Section 241.");
    });
  });

  describe("the seal's sentences", () => {
    const seal = (sealed: { posts: number; images: number; deletedImages: number }, more: Partial<DecisionStatement["measures"][number]> = {}) => measure("seal_media", { sealed, ...more });
    const sealing = (more: Partial<StatementInput>) => statement({ ruleId: "R2", facts: SEAL_DRAFTS.facts.notice_post, reason: SEAL_DRAFTS.reason.deciding, source: "notice", ...more });

    test("on a post case, while deciding: the images of the post, with their number, and the interim redress", () => {
      const out = statementParagraphs(sealing({ kind: "interim", measures: [seal({ posts: 1, images: 3, deletedImages: 0 })] }));
      expect(out[0]).toBe(`korbat sealed the images of your post of ${POST_TIME} (3 in all): nobody can see them, you included.`);
      expect(out).toContain(`The facts: ${SEAL_DRAFTS.facts.notice_post}`);
      expect(out).toContain(`korbat's reasons: ${SEAL_DRAFTS.reason.deciding}`);
      expect(out.at(-1)).toBe(REDRESS_TEXTS[1].interim);
      // Neither sentence of a seal for good (the rule's own text speaks of both, so they are looked for as whole paragraphs' parts).
      expect(out[0]).not.toContain(W.sealForGood);
      expect(out.at(-1)).not.toContain(W.sealAppeal);
    });

    test("on an account case: every image on the account's posts, with and without posts the author had deleted", () => {
      const live = statementParagraphs(sealing({ kind: "interim", post: null, measures: [seal({ posts: 4, images: 9, deletedImages: 0 })] }));
      expect(live[0]).toBe("korbat sealed every image it held on your posts at that time (9 on 4 posts): nobody can see them, you included.");
      const kept = statementParagraphs(sealing({ kind: "interim", post: null, measures: [seal({ posts: 4, images: 9, deletedImages: 2 })] }));
      expect(kept[0]).toBe(
        "korbat sealed every image it held on your posts at that time (9 on 4 posts): nobody can see them, you included. 2 of them are on posts you had deleted, which korbat had kept under its terms (Your data).",
      );
    });

    test("for good: kept only for the authorities, and the appeal waits until they have assessed the images", () => {
      const out = statementParagraphs(sealing({ reason: SEAL_DRAFTS.reason.final, measures: [seal({ posts: 1, images: 2, deletedImages: 0 })] }));
      expect(out[0]).toBe(`korbat sealed the images of your post of ${POST_TIME} (2 in all): nobody can see them, you included. They are kept only for the authorities korbat reports this to.`);
      expect(out.at(-1)).toBe(`${appeal(DECIDED)} An appeal of a seal waits until the authorities have assessed the images.`);
      const account = statementParagraphs(sealing({ post: null, measures: [seal({ posts: 2, images: 5, deletedImages: 1 })] }));
      expect(account[0]).toBe(
        "korbat sealed every image it held on your posts at that time (5 on 2 posts): nobody can see them, you included. 1 of them is on a post you had deleted, which korbat had kept under its terms (Your data). They are kept only for the authorities korbat reports this to.",
      );
    });

    test("a seal that changed nothing says so: already sealed, or the post or the account deleted", () => {
      const first = (more: Partial<StatementInput>, noEffect: "already" | "deleted") => statementParagraphs(sealing({ kind: "interim", measures: [seal({ posts: 1, images: 2, deletedImages: 0 }, { noEffect })], ...more }))[0];
      expect(first({}, "already")).toBe(
        `korbat sealed the images of your post of ${POST_TIME} (2 in all): nobody can see them, you included. Another decision already keeps these images sealed, so this changes nothing anyone sees now. It stays in force should that decision be reversed.`,
      );
      expect(first({}, "deleted")).toBe(`korbat sealed the images of your post of ${POST_TIME} (2 in all): nobody can see them, you included. You had deleted this post, so this changes nothing anyone sees.`);
      expect(first({ post: null }, "deleted")).toBe("korbat sealed every image it held on your posts at that time (2 on 1 post): nobody can see them, you included. Your account is deleted, so this changes nothing.");
    });

    test("a lifted seal", () => {
      const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R2" as const, rulesVersion: 2, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
      const out = statementParagraphs(statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, reason: "The authority answered on 2 October 2026.", measures: [], reversals: [reversal("unseal_media")], reviewed }));
      expect(out[0]).toBe("korbat corrected its decision of 2026-10-01 09:00 UTC and reversed it.");
      expect(out[1]).toBe("korbat lifted the seal on these images. If an image is still not shown, another decision listed in Settings, Cases applies.");
    });
  });

  describe("reversals and what ended", () => {
    const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R1" as const, rulesVersion: 2, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
    const correction = (more: Partial<StatementInput>) => statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, reason: "The post is satire.", measures: [], reviewed, ...more });
    const FIELD = (field: string) => `korbat does not put back your ${field} as it was before the reset: set it again in Settings, Profile if you wish.`;
    const KEPT = `The screen of the decision that reset it shows what it was for at least ${RETENTION.resetValueDays} days.`;
    const KEPT_R4 = `The screen of the decision that reset it shows what it was for at least ${RETENTION.resetValueDays} days, unless korbat had already erased it under rule R4.`;

    test("a correction of a final decision renders that decision's rule from its own row and version, and its reason", () => {
      // The corrected decision was made under rulebook version 1: its rule reads as that version worded it.
      const out = statementParagraphs(correction({ reviewed: { ...reviewed, rulesVersion: 1 }, reversals: [reversal("restore")] }));
      expect(out).toEqual([
        "korbat corrected its decision of 2026-10-01 09:00 UTC and reversed it.",
        `Your post of ${POST_TIME}: korbat lifted this restriction. If your post or image is still restricted, another decision listed in Settings, Cases applies, or its content was erased under korbat's retention rules.`,
        "No automated means were used to find this or to decide it.",
        `That decision rested on korbat rule R1, "No sexual or pornographic content": ${getRule("R1", 1)!.text}`,
        "Why korbat changed it: The post is satire.",
        REDRESS_TEXTS[1].notAppealable,
      ]);
      const part = statementParagraphs(correction({ outcome: "partly_reversed", reversals: [reversal("restore_media")] }));
      expect(part[0]).toBe("korbat corrected its decision of 2026-10-01 09:00 UTC and reversed part of it.");
      expect(part[1]).toBe(
        `One image of your post of ${POST_TIME}: korbat lifted this restriction. If your post or image is still restricted, another decision listed in Settings, Cases applies, or its content was erased under korbat's retention rules.`,
      );
      // A corrected decision on the law renders its legal reference.
      const law = statementParagraphs(correction({ reversals: [reversal("restore")], reviewed: { ...reviewed, ground: "illegal", ruleId: null, legalReference: "Section 241." } }));
      expect(law).toContain("That decision rested on the law: Section 241.");
    });

    test("a correction of an interim decision lifts what was done while deciding", () => {
      const out = statementParagraphs(correction({ reversals: [reversal("restore")], reviewed: { ...reviewed, kind: "interim" } }));
      expect(out[0]).toBe("korbat lifted what it did while deciding on 2026-10-01 09:00 UTC.");
      expect(out.at(-1)).toBe(REDRESS_TEXTS[1].notAppealable);
    });

    test("a review answers the appeal: kept, reversed in part or reversed", () => {
      expect(statementParagraphs(statement({ kind: "review", outcome: "kept", ground: null, ruleId: null, facts: null, reason: "The post was read again.", measures: [], reviewed }))).toEqual([
        "korbat reviewed your appeal against its decision of 2026-10-01 09:00 UTC and kept that decision.",
        "No automated means were used to find this or to decide it.",
        `That decision rested on korbat rule R1, "No sexual or pornographic content": ${getRule("R1", 2)!.text}`,
        "Why korbat kept it: The post was read again.",
        REDRESS_TEXTS[1].notAppealable,
      ]);
      expect(statementParagraphs(statement({ kind: "review", outcome: "reversed", ground: null, ruleId: null, facts: null, measures: [], reversals: [reversal("restore")], reviewed }))[0]).toBe(
        "korbat reviewed your appeal against its decision of 2026-10-01 09:00 UTC and reversed that decision.",
      );
      expect(statementParagraphs(statement({ kind: "review", outcome: "partly_reversed", ground: null, ruleId: null, facts: null, measures: [], reversals: [reversal("restore_media")], reviewed }))[0]).toBe(
        "korbat reviewed your appeal against its decision of 2026-10-01 09:00 UTC and reversed part of that decision.",
      );
    });

    test("the field-restore sentence, with and without its 30-day sentence, and with the R4 form", () => {
      const lifted = (more: Partial<DecisionStatement["reversals"][number]>, kind: ReversalKind = "restore_bio") => statementParagraphs(correction({ post: null, reversals: [reversal(kind, { resetDecisionId: RESET_DECISION, ...more })] }))[1];
      expect(lifted({ oldValueKept: false })).toBe(`korbat lifted the reset of your bio. ${FIELD("bio")}`);
      expect(lifted({ oldValueKept: true })).toBe(`korbat lifted the reset of your bio. ${FIELD("bio")} ${KEPT}`);
      expect(lifted({ oldValueKept: true, resetRuleId: "R4" })).toBe(`korbat lifted the reset of your bio. ${FIELD("bio")} ${KEPT_R4}`);
      expect(lifted({ oldValueKept: true, resetRuleId: "R3" }, "restore_display_name")).toBe(`korbat lifted the reset of your display name. ${FIELD("display name")} ${KEPT}`);
    });

    test("a final no-action decision that ends measures taken while deciding names them, and nothing else it did", () => {
      const out = statementParagraphs(
        statement({
          outcome: "no_violation",
          ground: null,
          ruleId: null,
          facts: null,
          reason: null,
          measures: [],
          endedMeasures: [
            { kind: "withhold", mediaId: null, ...NO_RESET },
            { kind: "withhold_media", mediaId: IMAGE, ...NO_RESET },
          ],
        }),
      );
      expect(out).toEqual([
        `What korbat did while deciding has ended: ${MEASURES.withhold.label}, ${MEASURES.withhold_media.label}.`,
        "korbat decided this following a report by another user.",
        "No automated means were used to find this or to decide it.",
        REDRESS_TEXTS[1].notAppealable,
      ]);
    });

    test("the field sentence after an interim reset ended by a closing decision, with and without its 30-day sentence, and none for a field the closing decision resets itself", () => {
      const ended = (more: Partial<DecisionStatement["endedMeasures"][number]>, kind: MeasureKind = "reset_bio") => ({ kind, mediaId: null, resetDecisionId: RESET_DECISION, oldValueKept: false, resetRuleId: null, ...more });
      const closing = (endedMeasures: DecisionStatement["endedMeasures"], more: Partial<StatementInput> = {}) =>
        statementParagraphs(statement({ outcome: "no_violation", ground: null, ruleId: null, facts: null, reason: null, post: null, measures: [], endedMeasures, ...more }));
      expect(closing([ended({})])[0]).toBe(`What korbat did while deciding has ended: ${MEASURES.reset_bio.label}. ${FIELD("bio")}`);
      expect(closing([ended({ oldValueKept: true })])[0]).toBe(`What korbat did while deciding has ended: ${MEASURES.reset_bio.label}. ${FIELD("bio")} ${KEPT}`);
      expect(closing([ended({ oldValueKept: true, resetRuleId: "R4" })])[0]).toBe(`What korbat did while deciding has ended: ${MEASURES.reset_bio.label}. ${FIELD("bio")} ${KEPT_R4}`);
      // Two resets of two fields: one field sentence each.
      expect(closing([ended({}, "reset_display_name"), ended({ oldValueKept: true })])[0]).toBe(
        `What korbat did while deciding has ended: ${MEASURES.reset_display_name.label}, ${MEASURES.reset_bio.label}. ${FIELD("display name")} ${FIELD("bio")} ${KEPT}`,
      );
      // The closing decision resets the bio itself: its own reset's sentences speak for the field, and no field sentence is added.
      const own = closing([ended({ oldValueKept: true })], { outcome: "restricted", ground: "incompatible", ruleId: "R6", facts: "f", reason: "r", measures: [measure("reset_bio")] });
      expect(own[0]).toContain("korbat reset your bio.");
      expect(own[1]).toBe(`What korbat did while deciding has ended: ${MEASURES.reset_bio.label}.`);
      expect(own.join("\n")).not.toContain("korbat does not put back your bio");
    });

    test("a final decision that lifts a withhold taken while deciding and leaves the case open", () => {
      const out = statementParagraphs(statement({ outcome: "no_violation", ground: null, ruleId: null, facts: null, reason: null, measures: [], reversals: [reversal("restore")] }));
      expect(out[0]).toBe(
        `Your post of ${POST_TIME}: korbat lifted this restriction. If your post or image is still restricted, another decision listed in Settings, Cases applies, or its content was erased under korbat's retention rules.`,
      );
      expect(out.at(-1)).toBe(REDRESS_TEXTS[1].notAppealable);
    });
  });

  test("a review or a correction renders the reviewed decision's rule under the rulebook that decision was made under, whatever version its own row carries", () => {
    const [v1, v2] = [getRule("R6", 1)!, getRule("R6", 2)!];
    expect(v1.title).not.toBe(v2.title);
    const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R6" as const, rulesVersion: 1, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
    const correction = statementParagraphs(statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, rulesVersion: 2, facts: null, measures: [], reversals: [reversal("restore")], reviewed }));
    expect(correction).toContain(`That decision rested on korbat rule R6, "${v1.title}": ${v1.text}`);
    expect(correction.join(" ")).not.toContain(v2.title);
    const review = statementParagraphs(statement({ kind: "review", outcome: "kept", ground: null, ruleId: null, rulesVersion: 2, facts: null, measures: [], reviewed }));
    expect(review).toContain(`That decision rested on korbat rule R6, "${v1.title}": ${v1.text}`);
    // A reviewed decision made under the current rulebook reads the current wording.
    expect(statementParagraphs(statement({ kind: "review", outcome: "kept", ground: null, ruleId: null, rulesVersion: 2, facts: null, measures: [], reviewed: { ...reviewed, rulesVersion: 2 } }))).toContain(
      `That decision rested on korbat rule R6, "${v2.title}": ${v2.text}`,
    );
    // A rulebook this package does not hold is never rendered as another.
    expect(() => statementParagraphs(statement({ kind: "review", outcome: "kept", ground: null, ruleId: null, facts: null, measures: [], reviewed: { ...reviewed, rulesVersion: 99 } }))).toThrow();
  });

  test("a decision that does nothing, and a decision on the law whose reference was erased, each read one fixed sentence", () => {
    expect(W.noAction).toBe("korbat decided to take no action.");
    expect(statementParagraphs(statement({ outcome: "no_violation", ground: null, ruleId: null, facts: null, reason: null, measures: [] }))[0]).toBe("korbat decided to take no action.");
    expect(statementParagraphs(statement({ ground: "illegal", ruleId: null, legalReference: null }))).toContain("korbat found it illegal. The law it rests on: its reference was erased under korbat's retention rules.");
    const reviewed = { kind: "final" as const, ground: "illegal" as const, ruleId: null, rulesVersion: 2, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
    expect(statementParagraphs(statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, measures: [], reversals: [reversal("restore")], reviewed }))).toContain(
      "That decision rested on the law: its reference was erased under korbat's retention rules.",
    );
  });

  test("every reversal kind has its sentence", () => {
    const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R1" as const, rulesVersion: 2, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
    // 3c's five reversals; the overruling of a strike has its own test below.
    for (const kind of REVERSAL_KINDS.slice(0, 5)) {
      const account = MEASURES[kind].target === "display_name" || MEASURES[kind].target === "bio";
      const out = statementParagraphs(statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, post: account ? null : POST, measures: [], reversals: [reversal(kind)], reviewed }));
      expect(out[1], kind).toMatch(/korbat lifted (this restriction|the seal on these images|the reset of your (display name|bio))\./);
    }
  });

  test("staff texts that were erased leave their paragraphs out, and the statement still stands", () => {
    const out = statementParagraphs(statement({ facts: null, reason: null }));
    expect(out.join("\n")).not.toMatch(/The facts:|korbat's reasons:/);
    expect(out.at(-1)).toBe(appeal(DECIDED));
  });
});


describe("3e: the strike's sentences (design, section 18, W.2 and W.3)", () => {
  const ENDS = "2027-01-02T09:30:15.250Z";
  const strike = (more: Partial<DecisionStatement["measures"][number]> = {}) => measure("strike", { endsAt: ENDS, activeThen: 2, ...more });
  /** A final removal under R3 that gives a strike, made under rulebook 3 and redress 2. */
  const struck = (more: Partial<StatementInput> = {}) => statement({ ruleId: "R3", rulesVersion: 3, redressVersion: 2, measures: [measure("remove"), strike()], ...more });
  const appeal2 = (decidedAt: string) => REDRESS_TEXTS[2].appeal.replace("{deadline}", `${appealDeadline(new Date(decidedAt)).toISOString().slice(0, 10)} ${appealDeadline(new Date(decidedAt)).toISOString().slice(11, 16)} UTC`);

  test("the words, each a constant", () => {
    expect(W.strike("2027-01-02 09:30 UTC", 2)).toBe(
      "This decision gives your account a strike. It counts until 2027-01-02 09:30 UTC. With it your account had 2 active strikes when this was decided. korbat's rules fix when a decision gives a strike; the moderator does not choose it.",
    );
    expect(W.strike("2027-01-02 09:30 UTC", 1)).toContain("With it your account had 1 active strike when this was decided.");
    expect(W.strikeAnyway).toBe("The strike counts although the post was already not shown or deleted: what counts is the breach.");
    expect(W.overruled).toBe("korbat overruled the strike that decision gave. It no longer counts.");
    expect(W.automationStrike).toBe(
      "No automated means were used to find this or to decide that it breaks the rule. That the decision gives a strike follows from korbat's published rule, which its software applies.",
    );
  });

  test("a removal that gives a strike, paragraph by paragraph: the strike follows the removal with the prior warning, and the automation sentence says what the software did", () => {
    expect(statementParagraphs(struck())).toEqual([
      `korbat removed your post of ${POST_TIME}: other people can no longer see it.`,
      `${W.strike("2027-01-02 09:30 UTC", 2)} ${REDRESS_TEXTS[2].strikeNext}`,
      "This applies everywhere korbat is available and has no end date.",
      "korbat decided this following a report by another user.",
      W.automationStrike,
      `It breaks korbat rule R3, "${getRule("R3", 3)!.title}": ${getRule("R3", 3)!.text}`,
      "The facts: The post shows explicit sexual acts.",
      "korbat's reasons: That is content whose primary purpose is sexual arousal.",
      appeal2(DECIDED),
    ]);
    // The six elements of Article 17(3) are all there; a decision without a strike keeps 3c's automation sentence.
    expect(statementParagraphs(statement({ rulesVersion: 3, redressVersion: 2 }))).toContain(W.automation);
    expect(statementParagraphs(struck())).not.toContain(W.automation);
  });

  test("a strike whose other measures all changed nothing still counts, and says so", () => {
    const out = statementParagraphs(struck({ measures: [measure("remove", { noEffect: "deleted" }), strike()] }));
    expect(out[1]).toBe(`${W.strike("2027-01-02 09:30 UTC", 2)} ${W.strikeAnyway} ${REDRESS_TEXTS[2].strikeNext}`);
    // One measure that changed something: no such sentence.
    const mixed = statementParagraphs(struck({ measures: [measure("remove", { noEffect: "already" }), measure("remove_media"), strike()] }));
    expect(mixed.join("\n")).not.toContain(W.strikeAnyway);
  });

  test("the overruling of a strike in a correction or a review that reverses the decision", () => {
    const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R3" as const, rulesVersion: 3, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
    for (const kind of ["correction", "review"] as const) {
      const out = statementParagraphs(statement({ kind, outcome: "reversed", ground: null, ruleId: null, facts: null, rulesVersion: 3, redressVersion: 2, measures: [], reversals: [reversal("restore"), reversal("overrule")], reviewed }));
      expect(out, kind).toContain(W.overruled);
      expect(out.at(-1), kind).toBe(REDRESS_TEXTS[2].notAppealable);
    }
  });

  test("a strike without its end of counting is not rendered as another statement; a kind of 3e that is not worded yet is not rendered at all", () => {
    expect(() => statementParagraphs(struck({ measures: [measure("remove"), strike({ endsAt: null })] }))).toThrow(/strike/);
    // Task 4 words an announced suspension and a termination, but not without the data their sentences print.
    expect(() => statementParagraphs(struck({ post: null, measures: [measure("suspend", { announced: true })] }))).toThrow(/suspend/);
    expect(() => statementParagraphs(struck({ post: null, measures: [measure("terminate", { announced: false })] }))).toThrow(/terminate/);
    // Task 5 words the reporting measures, but not without the data their sentences print.
    expect(() => statementParagraphs(struck({ post: null, measures: [measure("warn_reporting")] }))).toThrow(/warn_reporting/);
    expect(() => statementParagraphs(struck({ post: null, measures: [measure("restrict_reporting", { days: 7, endsAt: DECIDED })] }))).toThrow(/restrict_reporting/);
    const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R3" as const, rulesVersion: 3, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
    // A lift whose data names no period is not rendered as another lift.
    expect(() => statementParagraphs(statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, post: null, measures: [], reversals: [reversal("lift_suspension")], reviewed }))).toThrow(/lift_suspension/);
  });

  test("a statement under redress version 1 and rulebook version 2 renders as it did", () => {
    expect(statementParagraphs(statement())).toEqual([
      `korbat removed your post of ${POST_TIME}: other people can no longer see it.`,
      "This applies everywhere korbat is available and has no end date.",
      "korbat decided this following a report by another user.",
      "No automated means were used to find this or to decide it.",
      `It breaks korbat rule R1, "No sexual or pornographic content": ${getRule("R1", 2)!.text}`,
      "The facts: The post shows explicit sexual acts.",
      "korbat's reasons: That is content whose primary purpose is sexual arousal.",
      appeal(DECIDED),
    ]);
    // Rulebook 3's R6 is rendered as version 3 words it, version 2's as version 2 does.
    expect(text(statement({ ruleId: "R6", rulesVersion: 3 }))).toContain("Sending report after report that is plainly unfounded is not allowed either");
    expect(text(statement({ ruleId: "R6", rulesVersion: 2 }))).not.toContain("Sending report after report");
  });
});
describe("3e: the retirement of a handle and its reversal (design, section 18, W.2)", () => {
  const PLACEHOLDER = "retired_0a1b2c3d4e5f";
  const retire = (more: Partial<DecisionStatement["measures"][number]> = {}) => measure("retire_handle", { handle: "ada_l", placeholder: PLACEHOLDER, ...more });
  /** A final decision on an account case under R4 that retires the handle, made under rulebook 3 and redress 2. */
  const retired = (more: Partial<StatementInput> = {}) => statement({ ruleId: "R4", rulesVersion: 3, redressVersion: 2, post: null, measures: [retire()], ...more });
  const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R4" as const, rulesVersion: 3, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
  const timedMeasure = (kind: "suspend" | "terminate", announced: boolean) => measure(kind, { announced });

  test("the words, each a constant: the three ends of the retirement, the one that changed nothing, and the handle given back", () => {
    const lead = "korbat retired the handle @ada_l: nobody can use it again, you included.";
    expect(W.retire("ada_l", PLACEHOLDER, "at_once")).toBe(
      `${lead} If your profile still held it, it now shows @${PLACEHOLDER} instead, and you can choose a new handle in Settings, Profile, without the usual wait: at once.`,
    );
    expect(W.retire("ada_l", PLACEHOLDER, "after_suspension")).toBe(
      `${lead} If your profile still held it, it now shows @${PLACEHOLDER} instead, and you can choose a new handle in Settings, Profile, without the usual wait: when that suspension ends.`,
    );
    expect(W.retire("ada_l", PLACEHOLDER, "none")).toBe(`${lead} If your profile still held it, it now shows @${PLACEHOLDER} instead.`);
    expect(W.retireLead("ada_l")).toBe(lead);
    expect(W.retireAlready).toBe("That handle was already retired, so this changes nothing now.");
    expect(W.unretired("ada_l")).toBe(
      "korbat lifted the retirement of the handle @ada_l. If your profile still held the placeholder, it has the handle again. If you chose another handle since, you can change back to @ada_l at once in Settings, Profile. Nobody else could take it meanwhile.",
    );
  });

  test("the end of the sentence is read from the decision's own measures: at once, after a suspension taken at once, none with a termination taken at once", () => {
    expect(retireEnd([retire()])).toBe("at_once");
    expect(retireEnd([retire(), measure("reset_display_name")])).toBe("at_once");
    // An announced suspension or termination has not started when the decision is sent: the handle can be chosen at once.
    expect(retireEnd([retire(), timedMeasure("suspend", true)])).toBe("at_once");
    expect(retireEnd([retire(), timedMeasure("terminate", true)])).toBe("at_once");
    expect(retireEnd([retire(), timedMeasure("suspend", false)])).toBe("after_suspension");
    expect(retireEnd([retire(), timedMeasure("terminate", false)])).toBe("none");
  });

  test("a final retirement, paragraph by paragraph: the handle and its placeholder, scope.final, 3c's automation sentence, the rule it breaks and the appeal", () => {
    const out = statementParagraphs(retired());
    expect(out[0]).toBe(W.retire("ada_l", PLACEHOLDER, "at_once"));
    expect(out[1]).toBe(W.scope.final);
    expect(out).toContain(W.automation);
    expect(out).toContain(`It breaks korbat rule R4, "${getRule("R4", 3)!.title}": ${getRule("R4", 3)!.text}`);
    expect(out.at(-1)).toBe(REDRESS_TEXTS[2].appeal.replace("{deadline}", `${appealDeadline(new Date(DECIDED)).toISOString().slice(0, 10)} ${appealDeadline(new Date(DECIDED)).toISOString().slice(11, 16)} UTC`));
    // A reset of the display name after it is a paragraph of its own.
    expect(statementParagraphs(retired({ measures: [measure("reset_display_name"), retire()] }))).toContain(`${W.done.reset("display_name", false)} ${W.resetOnce("display_name")}`);
  });

  test("a retirement that changed nothing names the handle and says why, without the placeholder: already retired, or the account deleted", () => {
    expect(statementParagraphs(retired({ measures: [retire({ noEffect: "already" })] }))[0]).toBe(`${W.retireLead("ada_l")} ${W.retireAlready}`);
    expect(statementParagraphs(retired({ measures: [retire({ noEffect: "deleted" })] }))[0]).toBe(`${W.retireLead("ada_l")} ${W.deletedAccount}`);
  });

  test("the handle given back, in a correction and in a review", () => {
    for (const kind of ["correction", "review"] as const) {
      const out = statementParagraphs(statement({ kind, outcome: "reversed", ground: null, ruleId: null, facts: null, post: null, rulesVersion: 3, redressVersion: 2, measures: [], reversals: [reversal("unretire_handle", { handle: "ada_l" })], reviewed }));
      expect(out[1], kind).toBe(W.unretired("ada_l"));
      expect(out.at(-1), kind).toBe(REDRESS_TEXTS[2].notAppealable);
    }
  });

  test("a retirement without its handle or its placeholder, and a reversal without its handle, are not rendered as another statement", () => {
    expect(() => statementParagraphs(retired({ measures: [retire({ handle: null })] }))).toThrow(/retire_handle/);
    expect(() => statementParagraphs(retired({ measures: [retire({ placeholder: undefined })] }))).toThrow(/retire_handle/);
    // A retirement that changed nothing needs no placeholder.
    expect(() => statementParagraphs(retired({ measures: [retire({ noEffect: "already", placeholder: null })] }))).not.toThrow();
    expect(() => statementParagraphs(statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, post: null, measures: [], reversals: [reversal("unretire_handle")], reviewed }))).toThrow(/unretire_handle/);
  });
});

describe("3e: a suspension taken at once, its lift and a basis that breaks (design, section 18, W.2 and W.3, Task 3)", () => {
  const STARTED = "2026-10-04T09:30:15.250Z";
  const ENDS = "2026-10-11T09:30:15.250Z";
  const BASIS_AT = "2026-10-02T08:00:00.000Z";
  const at = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  const atOnce = (basis: "threat" | "terrorist" | "flood" | "protective", more: Partial<DecisionStatement["measures"][number]> = {}) =>
    measure("suspend", {
      announced: false,
      days: 7,
      basis,
      earliestStart: STARTED,
      endsAt: ENDS,
      restsOn: basis === "flood" ? null : [{ decidedAt: BASIS_AT, ruleId: basis === "threat" ? "R5" : null, postCreatedAt: basis === "protective" ? null : POST.createdAt }],
      ...more,
    });
  /** A final decision on an account case that suspends it at once, made under rulebook 3 and redress 2. */
  const suspended = (basis: "threat" | "terrorist" | "flood" | "protective", more: Partial<StatementInput> = {}) =>
    statement({
      ruleId: basis === "threat" ? "R5" : basis === "flood" ? "R6" : basis === "protective" ? "R2" : null,
      ground: basis === "terrorist" ? "illegal" : "incompatible",
      legalReference: basis === "terrorist" ? "Regulation (EU) 2021/784, Article 2(7)" : null,
      rulesVersion: 3,
      redressVersion: 2,
      source: "own_initiative",
      post: null,
      measures: [atOnce(basis)],
      ...more,
    });
  const appeal2 = REDRESS_TEXTS[2].appeal.replace("{deadline}", at(appealDeadline(new Date(DECIDED)).toISOString()));
  const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R5" as const, rulesVersion: 3, legalReference: null, decidedAt: BASIS_AT };
  const joined = (paragraphs: string[]) => paragraphs.join(" | ");

  test("the words, each a constant", () => {
    expect(W.suspendAtOnce(7, "2026-10-11 09:30 UTC")).toBe("korbat suspended your account for 7 days, from this decision until 2026-10-11 09:30 UTC, without notice beforehand.");
    expect(W.suspendAtOnce(1, "2026-10-05 09:30 UTC")).toBe("korbat suspended your account for 1 day, from this decision until 2026-10-05 09:30 UTC, without notice beforehand.");
    expect(W.basis.threat("2026-10-02 08:00 UTC")).toBe("It was taken at once because korbat's decision of 2026-10-02 08:00 UTC found a direct threat of violence in a post of yours (rule R5). It ends at once if that decision is reversed.");
    expect(W.basis.terrorist("2026-10-02 08:00 UTC")).toBe("It was taken at once because korbat's decision of 2026-10-02 08:00 UTC found terrorist content in a post of yours. It ends at once if that decision is reversed.");
    expect(W.basis.flood).toBe("It was taken at once because an admin found that your account was flooding korbat with repetitive, unsolicited posts (rule R6). The facts below say how many posts and what they were.");
    expect(W.basis.protective("2026-10-02 08:00 UTC")).toBe(
      "It was taken at once because korbat's decision of 2026-10-02 08:00 UTC keeps images of your account sealed, after they were reported as possible child sexual abuse material. korbat's staff do not open images reported this way, so korbat has not assessed them. This is not a finding that you broke the law or a korbat rule: it is a protective measure, it gives no strike, and it ends on its date by itself, or earlier if that seal is lifted.",
    );
    expect(W.stops).toBe("While it runs you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules.");
    expect(W.stays).toBe(
      "You can still sign in and read; see your cases and reply to korbat; appeal; ask for a re-examination of a report you sent; export your data; delete your posts or your account; undo likes, reposts, bookmarks and follows; block and mute; and report illegal content. Your profile and posts stay visible to others, without any mark, and others can still follow you and like, repost, reply to and quote your posts.",
    );
    expect(W.explore).toBe(
      "While it runs your posts do not appear in Explore, and your likes and reposts of other people's posts do not count there. Both count again from the first refresh after it ends; a post whose time in Explore has passed by then does not return.",
    );
    expect(W.scope.suspend(7)).toBe("This applies everywhere korbat is available, for 7 days from its start.");
    expect(W.scope.suspend(1)).toBe("This applies everywhere korbat is available, for 1 day from its start.");
    expect(W.automationFlood).toBe("korbat's software counted the posts this rests on. An admin read them and decided; no automated means decided it.");
    expect(W.ground.protective("No child sexual abuse material")).toBe(
      `This rests on korbat's terms, section Suspension and termination: when korbat keeps images of an account sealed after a report of child sexual abuse material, an admin may suspend the account once, for up to 14 days. The rule such a report is made under is korbat rule R2, "No child sexual abuse material". korbat has not found that your account broke it.`,
    );
    expect(W.ground.conduct("R5", "No threats", "text")).toBe(`Your account's conduct breaks korbat rule R5, "No threats": text`);
    expect(W.liftedBefore("suspension", "2026-10-02 08:00 UTC")).toBe("korbat lifted the suspension it announced on 2026-10-02 08:00 UTC: it never starts.");
    expect(W.liftedRunning("suspension")).toBe("korbat lifted the suspension of your account: it ended with this decision.");
    expect(W.liftedEnded("2026-10-02 08:00 UTC", "2026-10-09 08:00 UTC")).toBe(
      "korbat lifted the suspension of your account that ran from 2026-10-02 08:00 UTC to 2026-10-09 08:00 UTC: it no longer counts toward a later suspension.",
    );
    expect(W.basisEnded("suspension", "2026-10-02 08:00 UTC", false)).toBe("The suspension of your account that korbat decided on 2026-10-02 08:00 UTC rested on that decision.");
    expect(W.basisEnded("termination", "2026-10-02 08:00 UTC", true)).toBe("The termination of your account that korbat decided on 2026-10-02 08:00 UTC rested on that seal.");
    expect(W.basisEndedThen.not_started).toBe("It will not start.");
    expect(W.basisEndedThen.running).toBe("It ended with this one.");
    expect(W.basisEndedThen.ended("2026-10-02 08:00 UTC", "2026-10-09 08:00 UTC")).toBe("It had run from 2026-10-02 08:00 UTC to 2026-10-09 08:00 UTC; it no longer counts toward a later suspension.");
    expect(W.basisEndedReply("2026-10-03 08:00 UTC")).toBe("Your reply of 2026-10-03 08:00 UTC to it needs no answer now.");
  });

  test("every number the sentences print is the one STANDING_RULES holds", () => {
    expect(W.ground.protective("x")).toContain(`for up to ${STANDING_RULES.protectiveDays} days`);
  });

  test("a suspension at once on a threat, paragraph by paragraph: what was done and why at once, what it stops and leaves, Explore, its scope, the source, no automation, the account's conduct under R5, the facts, the reason, the reply and the appeal", () => {
    const r5 = getRule("R5", 3)!;
    expect(statementParagraphs(suspended("threat"))).toEqual([
      `${W.suspendAtOnce(7, at(ENDS))} ${W.basis.threat(at(BASIS_AT))}`,
      `${W.stops} ${W.stays}`,
      W.explore,
      W.scope.suspend(7),
      "What this decision is about was found by a moderator.",
      W.automation,
      W.ground.conduct("R5", r5.title, r5.text),
      "The facts: The post shows explicit sexual acts.",
      "korbat's reasons: That is content whose primary purpose is sexual arousal.",
      REDRESS_TEXTS[2].replyAtOnce,
      appeal2,
    ]);
  });

  test("a protective suspension never says that a rule is broken: its ground is the terms' clause, its basis says korbat has not assessed the images, and its appeal does not wait for the authorities", () => {
    const out = statementParagraphs(suspended("protective"));
    expect(joined(out)).not.toContain("It breaks");
    expect(joined(out)).not.toContain("conduct breaks");
    expect(out[0]).toBe(`${W.suspendAtOnce(7, at(ENDS))} ${W.basis.protective(at(BASIS_AT))}`);
    expect(out).toContain(W.ground.protective(getRule("R2", 3)!.title));
    expect(out).toContain(W.automation);
    expect(joined(out)).not.toContain(W.sealAppeal);
    expect(out.slice(-2)).toEqual([REDRESS_TEXTS[2].replyAtOnce, appeal2]);
  });

  test("a flood says what the software counted, and the account's conduct under R6; terrorist content names the law", () => {
    const flood = statementParagraphs(suspended("flood"));
    expect(flood[0]).toBe(`${W.suspendAtOnce(7, at(ENDS))} ${W.basis.flood}`);
    expect(flood).toContain(W.automationFlood);
    expect(flood).not.toContain(W.automation);
    const r6 = getRule("R6", 3)!;
    expect(flood).toContain(W.ground.conduct("R6", r6.title, r6.text));
    const terrorist = statementParagraphs(suspended("terrorist"));
    expect(terrorist[0]).toBe(`${W.suspendAtOnce(7, at(ENDS))} ${W.basis.terrorist(at(BASIS_AT))}`);
    expect(terrorist).toContain(W.ground.illegal("Regulation (EU) 2021/784, Article 2(7)"));
    expect(terrorist).toContain(W.automation);
  });

  test("a suspension of a deleted account says that it changes nothing", () => {
    expect(statementParagraphs(suspended("threat", { measures: [atOnce("threat", { noEffect: "deleted" })] }))[0]).toBe(`${W.suspendAtOnce(7, at(ENDS))} ${W.basis.threat(at(BASIS_AT))} ${W.deletedAccount}`);
  });

  test("a suspension at once without its days, its end or the decision it rests on is not rendered as another statement", () => {
    expect(() => statementParagraphs(suspended("threat", { measures: [atOnce("threat", { days: undefined })] }))).toThrow(/suspend/);
    expect(() => statementParagraphs(suspended("threat", { measures: [atOnce("threat", { endsAt: null })] }))).toThrow(/suspend/);
    expect(() => statementParagraphs(suspended("threat", { measures: [atOnce("threat", { restsOn: null })] }))).toThrow(/suspend/);
  });

  test("its lift in the three states of the period, in a correction and in a review", () => {
    const lift = (state: "not_started" | "running" | "ended") =>
      reversal("lift_suspension", { liftedKind: "suspend", liftedDecidedAt: BASIS_AT, periodThen: { state, startedAt: state === "not_started" ? null : STARTED, endedAt: state === "ended" ? ENDS : null }, replaced: false });
    for (const kind of ["correction", "review"] as const) {
      const of = (state: "not_started" | "running" | "ended") =>
        statementParagraphs(statement({ kind, outcome: "reversed", ground: null, ruleId: null, facts: null, post: null, rulesVersion: 3, redressVersion: 2, measures: [], reversals: [lift(state)], reviewed }));
      expect(of("not_started")[1], kind).toBe(W.liftedBefore("suspension", at(BASIS_AT)));
      expect(of("running")[1], kind).toBe(W.liftedRunning("suspension"));
      expect(of("ended")[1], kind).toBe(W.liftedEnded(at(STARTED), at(ENDS)));
      expect(of("running").at(-1), kind).toBe(REDRESS_TEXTS[2].notAppealable);
    }
  });

  test("a reversal that breaks the basis of a suspension says so, by where its period stood, and answers a reply that waited", () => {
    const ended = (state: "not_started" | "running" | "ended", more: { seal?: boolean; replyFiledAt?: string | null } = {}) => ({
      kind: "suspend" as const,
      decidedAt: STARTED,
      periodThen: { state, startedAt: state === "not_started" ? null : STARTED, endedAt: state === "ended" ? ENDS : null },
      seal: more.seal ?? false,
      replyFiledAt: more.replyFiledAt ?? null,
    });
    const correction = (entry: ReturnType<typeof ended>) =>
      statementParagraphs(
        statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, rulesVersion: 3, redressVersion: 2, measures: [], reversals: [reversal("restore"), reversal("overrule")], reviewed, endedStanding: [entry] }),
      );
    const lead = W.basisEnded("suspension", at(STARTED), false);
    expect(correction(ended("not_started"))).toContain(`${lead} ${W.basisEndedThen.not_started}`);
    expect(correction(ended("running"))).toContain(`${lead} ${W.basisEndedThen.running}`);
    expect(correction(ended("ended"))).toContain(`${lead} ${W.basisEndedThen.ended(at(STARTED), at(ENDS))}`);
    expect(correction(ended("running", { replyFiledAt: BASIS_AT }))).toContain(`${lead} ${W.basisEndedThen.running} ${W.basisEndedReply(at(BASIS_AT))}`);
    expect(correction(ended("running", { seal: true }))).toContain(`${W.basisEnded("suspension", at(STARTED), true)} ${W.basisEndedThen.running}`);
    // A statement made before 3e carries no such member and renders as it did.
    expect(statementParagraphs(statement({ endedStanding: undefined }))).toEqual(statementParagraphs(statement()));
  });
});

describe("3e: an announced suspension, a termination, the reply's answers and a withdrawal (design, section 18, W.2 and W.3, Task 4)", () => {
  const STARTS = "2026-10-11T09:30:15.250Z";
  const ENDS = "2026-10-18T09:30:15.250Z";
  const BASIS_AT = "2026-10-02T08:00:00.000Z";
  const EARLIER_AT = "2026-08-02T08:00:00.000Z";
  const FILED = "2026-10-05T10:00:00.000Z";
  const at = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  const strikes = [
    { decidedAt: "2026-09-01T08:00:00.000Z", ruleId: "R1" as const, postCreatedAt: "2026-08-31T08:00:00.000Z" },
    { decidedAt: "2026-09-10T08:00:00.000Z", ruleId: "R3" as const, postCreatedAt: "2026-09-09T08:00:00.000Z" },
    { decidedAt: "2026-09-20T08:00:00.000Z", ruleId: "R4" as const, postCreatedAt: "2026-09-19T08:00:00.000Z" },
  ];
  const list = strikes.map((entry) => W.restsOnEntry(at(entry.decidedAt), entry.ruleId, at(entry.postCreatedAt))).join("; ");
  /** The earliest start of a measure announced at DECIDED: the reply window later. */
  const EARLIEST = new Date(Date.parse(DECIDED) + STANDING_RULES.replyWindowHours * 3_600_000).toISOString();
  const announced = (kind: "suspend" | "terminate", more: Partial<DecisionStatement["measures"][number]> = {}) =>
    measure(kind, { announced: true, days: kind === "suspend" ? 3 : null, basis: kind === "suspend" ? "strikes" : "ladder_end", earliestStart: EARLIEST, endsAt: null, restsOn: strikes, ...more });
  /** A final decision on an account case that announces the measure, under rulebook 3 and redress 2, citing the newest strike's rule. */
  const announcing = (kind: "suspend" | "terminate", more: Partial<StatementInput> = {}) =>
    statement({ ruleId: "R4", rulesVersion: 3, redressVersion: 2, source: "own_initiative", post: null, measures: [announced(kind)], ...more });
  const appeal2 = REDRESS_TEXTS[2].appeal.replace("{deadline}", at(appealDeadline(new Date(DECIDED)).toISOString()));
  const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R4" as const, rulesVersion: 3, legalReference: null, decidedAt: BASIS_AT };
  const repliedTo = (more: Partial<NonNullable<StatementInput["repliedTo"]>> = {}): NonNullable<StatementInput["repliedTo"]> => ({
    filedAt: FILED,
    onTime: true,
    kind: "suspend",
    days: 7,
    periodThen: { state: "not_started", startedAt: null, endedAt: null },
    startsAt: STARTS,
    endsAt: ENDS,
    appealUntil: "2027-04-11T09:30:15.250Z",
    ...more,
  });
  /** A correction or a review of the announcing decision that answers the person's reply. */
  const answer = (kind: "correction" | "review", outcome: "kept" | "partly_reversed" | "reversed", more: Partial<StatementInput> = {}) =>
    statement({ kind, outcome, ground: null, ruleId: null, facts: null, post: null, rulesVersion: 3, redressVersion: 2, measures: [], reviewed, repliedTo: repliedTo(), ...more });
  const lift = (state: "not_started" | "running" | "ended", more: Partial<DecisionStatement["reversals"][number]> = {}) =>
    reversal("lift_suspension", { liftedKind: "suspend", liftedDecidedAt: BASIS_AT, periodThen: { state, startedAt: state === "not_started" ? null : STARTS, endedAt: state === "ended" ? ENDS : null }, replaced: false, replyFiledAt: null, ...more });

  test("the words, each a constant", () => {
    expect(W.suspendAnnounced(3)).toBe("korbat will suspend your account for 3 days. Nothing is restricted yet.");
    expect(W.suspendAnnounced(1)).toBe("korbat will suspend your account for 1 day. Nothing is restricted yet.");
    expect(W.restsOn("x")).toBe("It rests on the active strikes of your account: x.");
    expect(W.restsOnEntry("2026-09-01 08:00 UTC", "R1", "2026-08-31 08:00 UTC")).toBe("the strike of 2026-09-01 08:00 UTC under rule R1 (your post of 2026-08-31 08:00 UTC)");
    expect(W.start("It", 168, "2026-10-11 09:30 UTC")).toBe(
      "It starts 168 hours after korbat sent the email with this decision, and not before 2026-10-11 09:30 UTC. If korbat's mail service cannot send it to your address, it starts later, and korbat's app alone tells you. korbat cannot see whether an email it sent reached you: this decision is always shown in the app. The exact start and end are on this decision's screen under Settings, Cases, as soon as they are fixed.",
    );
    expect(W.start("The termination", 168, "x")).toMatch(/^The termination starts 168 hours after/);
    expect(W.terminateAnnounced("x")).toBe("korbat will terminate your account. Nothing is restricted yet. It follows the earlier suspensions of your account and rests on the active strikes of your account: x.");
    expect(W.terminateAtOnce("2026-10-02 08:00 UTC", "2026-08-02 08:00 UTC")).toBe(
      "korbat terminated your account with this decision, without notice beforehand, because its decision of 2026-10-02 08:00 UTC found a direct threat of violence (rule R5) in a post you made after korbat had suspended your account for an earlier threat, which its decision of 2026-08-02 08:00 UTC found. It ends at once if either of those two decisions is reversed.",
    );
    expect(W.terminateWait("D", true)).toBe(
      "From its start your account is suspended with no end date. Your profile and posts stay visible to others until the account is deleted. korbat deletes the account, with its posts and profile and every image it has not sealed, once this decision is final: when the six months for your appeal have passed unused, on D, or six months after korbat's answer if you reply before the start and korbat keeps the decision, or when your appeal is answered and the decision kept. Nothing is deleted while your appeal or your reply is unanswered.",
    );
    expect(W.terminateWait("D", false)).toContain("passed unused, on D, or when your appeal is answered and the decision kept.");
    expect(W.terminateWait("D", false)).not.toContain("reply before the start");
    expect(W.terminateLeave).toContain("After the deletion korbat keeps nothing to recognise a new account of yours by.");
    expect(W.stopsFromStart).toBe(W.stops.replace("While it runs", "From its start"));
    expect(W.exploreFromStart).toBe(W.explore.replace("While it runs", "From its start").split(". ")[0] + ".");
    expect(W.withdrawn("suspension", "2026-10-02 08:00 UTC", true)).toBe(
      "korbat withdrew the suspension it announced on 2026-10-02 08:00 UTC, because it is taking another measure on your account. This is not a decision on your reply.",
    );
    expect(W.withdrawn("termination", "2026-10-02 08:00 UTC", false)).toBe("korbat withdrew the termination it announced on 2026-10-02 08:00 UTC, because it is taking another measure on your account.");
    expect(W.replyKept("2026-10-02 08:00 UTC")).toBe("korbat read your reply to its decision of 2026-10-02 08:00 UTC and keeps that decision.");
    expect(W.replyKeptOnTime.suspension(7, "S", "E")).toBe("The suspension of 7 days starts at S and ends at E: with this answer, and never before the time you were first given.");
    expect(W.replyKeptOnTime.termination("S")).toBe("The termination starts at S: with this answer, and never before the time you were first given.");
    expect(W.replyKeptLate.running("E")).toBe("The suspension goes on and ends at E, as before.");
    expect(W.replyKeptLate.ended("E")).toBe("The suspension ended at E, as decided.");
    expect(W.replyKeptLate.termination).toBe("The termination stays.");
    expect(W.replyReversed("D", false)).toBe("korbat read your reply to its decision of D and reversed that decision.");
    expect(W.replyReversed("D", true)).toBe("korbat read your reply to its decision of D and reversed part of that decision.");
    expect(W.replyAlso("F")).toBe("This also answers your reply of F.");
    expect(W.automationCounted).toBe("korbat's software counted what this rests on and listed your account for a moderator. A moderator read it and decided; no automated means decided it.");
    expect(W.scope.terminate).toBe("This applies everywhere korbat is available and has no end date.");
    expect(W.ground.ladder("R4", "T")).toBe(
      `This rests on korbat's terms, section Suspension and termination: an account with 3 active strikes may be suspended for a limited time. This decision finds no new breach. The newest of the strikes it rests on was given under korbat rule R4, "T".`,
    );
    expect(W.ground.ladderEnd("R4", "T")).toBe(
      `This rests on korbat's terms, section Suspension and termination: after three suspensions in 365 days an account with 3 active strikes may be terminated. This decision finds no new breach. The newest of the strikes it rests on was given under korbat rule R4, "T".`,
    );
  });

  test("every number the sentences print is the one STANDING_RULES holds", () => {
    const words = ["", "one", "two", "three", "four"];
    expect(W.ground.ladder("R1", "x")).toContain(`with ${STANDING_RULES.ladderStrikes} active strikes`);
    expect(W.ground.ladderEnd("R1", "x")).toContain(`after ${words[STANDING_RULES.ladderDays.length]} suspensions in ${STANDING_RULES.ladderMemoryDays} days an account with ${STANDING_RULES.ladderStrikes} active strikes`);
    // The window the statement prints is the row's own: its earliest start less its decision's time.
    expect(text(announcing("suspend"))).toContain(`It starts ${STANDING_RULES.replyWindowHours} hours after korbat sent the email`);
  });

  test("an announced suspension, paragraph by paragraph: what korbat will do and the strikes it rests on, the start, what it stops and leaves, Explore, its scope, the source, what the software counted, the terms' section, the facts, the reason, the reply, the appeal and that the appeal need not wait", () => {
    const r4 = getRule("R4", 3)!;
    expect(statementParagraphs(announcing("suspend"))).toEqual([
      `${W.suspendAnnounced(3)} ${W.restsOn(list)}`,
      W.start("It", STANDING_RULES.replyWindowHours, at(EARLIEST)),
      `${W.stops} ${W.stays}`,
      W.explore,
      W.scope.suspend(3),
      "What this decision is about was found by a moderator.",
      W.automationCounted,
      W.ground.ladder("R4", r4.title),
      "The facts: The post shows explicit sexual acts.",
      "korbat's reasons: That is content whose primary purpose is sexual arousal.",
      REDRESS_TEXTS[2].reply,
      appeal2,
      REDRESS_TEXTS[2].appealNow,
    ]);
    // A ladder statement names the terms' section and never says that a rule is broken.
    expect(text(announcing("suspend"))).not.toMatch(/It breaks|conduct breaks/);
    expect(statementParagraphs(announcing("suspend", { measures: [announced("suspend", { noEffect: "deleted" })] }))[0]).toBe(`${W.suspendAnnounced(3)} ${W.restsOn(list)} ${W.deletedAccount}`);
  });

  test("an announced termination at the ladder's end, and a termination at once on a second threat", () => {
    const r4 = getRule("R4", 3)!;
    const deadline = at(appealDeadline(new Date(DECIDED)).toISOString());
    expect(statementParagraphs(announcing("terminate"))).toEqual([
      `${W.terminateAnnounced(list)} ${W.start("The termination", STANDING_RULES.replyWindowHours, at(EARLIEST))}`,
      W.terminateWait(deadline, true),
      W.terminateLeave,
      `${W.stopsFromStart} ${W.stays}`,
      W.exploreFromStart,
      W.scope.terminate,
      "What this decision is about was found by a moderator.",
      W.automationCounted,
      W.ground.ladderEnd("R4", r4.title),
      "The facts: The post shows explicit sexual acts.",
      "korbat's reasons: That is content whose primary purpose is sexual arousal.",
      REDRESS_TEXTS[2].reply,
      appeal2,
      REDRESS_TEXTS[2].appealNow,
    ]);
    const r5 = getRule("R5", 3)!;
    const atOnce = statementParagraphs(
      statement({
        ruleId: "R5",
        rulesVersion: 3,
        redressVersion: 2,
        source: "own_initiative",
        post: null,
        measures: [measure("terminate", { announced: false, days: null, basis: "threat_repeat", earliestStart: DECIDED, endsAt: null, restsOn: [{ decidedAt: EARLIER_AT, ruleId: "R5", postCreatedAt: EARLIER_AT }, { decidedAt: BASIS_AT, ruleId: "R5", postCreatedAt: BASIS_AT }] })],
      }),
    );
    expect(atOnce[0]).toBe(W.terminateAtOnce(at(BASIS_AT), at(EARLIER_AT)));
    expect(atOnce[1]).toBe(W.terminateWait(deadline, false));
    expect(atOnce).toContain(W.automation);
    expect(atOnce).toContain(W.ground.conduct("R5", r5.title, r5.text));
    expect(atOnce.slice(-2)).toEqual([REDRESS_TEXTS[2].replyAtOnce, appeal2]);
    expect(atOnce.join(" ")).not.toContain("while a suspension stood");
  });

  test("a kept answer to a reply sent before the start: the start and end it fixes, never before the earliest start, and the six months counted again from it", () => {
    const out = statementParagraphs(answer("correction", "kept", { reason: "We read your reply." }));
    expect(out[0]).toBe(`${W.replyKept(at(BASIS_AT))} ${W.replyKeptOnTime.suspension(7, at(STARTS), at(ENDS))}`);
    expect(out).toContain("Why korbat kept it: We read your reply.");
    expect(out.at(-1)).toBe(REDRESS_TEXTS[2].replyAnswered!.replace("{deadline}", at("2027-04-11T09:30:15.250Z")));
    // A late reply answered after the six months: no appeal is left, and the statement says so.
    expect(statementParagraphs(answer("correction", "kept", { repliedTo: repliedTo({ appealUntil: "2026-01-01T00:00:00.000Z" }) })).at(-1)).toBe(REDRESS_TEXTS[2].notAppealable);
    // For a termination.
    expect(statementParagraphs(answer("correction", "kept", { repliedTo: repliedTo({ kind: "terminate", days: null, endsAt: null }) }))[0]).toBe(`${W.replyKept(at(BASIS_AT))} ${W.replyKeptOnTime.termination(at(STARTS))}`);
  });

  test("a kept answer to a reply sent after the start: the suspension goes on, or ended as decided; a termination stays", () => {
    const late = (state: "running" | "ended") => repliedTo({ onTime: false, periodThen: { state, startedAt: STARTS, endedAt: state === "ended" ? ENDS : null } });
    expect(statementParagraphs(answer("correction", "kept", { repliedTo: late("running") }))[0]).toBe(`${W.replyKept(at(BASIS_AT))} ${W.replyKeptLate.running(at(ENDS))}`);
    expect(statementParagraphs(answer("correction", "kept", { repliedTo: late("ended") }))[0]).toBe(`${W.replyKept(at(BASIS_AT))} ${W.replyKeptLate.ended(at(ENDS))}`);
    expect(statementParagraphs(answer("correction", "kept", { repliedTo: repliedTo({ onTime: false, kind: "terminate", days: null, endsAt: null, periodThen: { state: "running", startedAt: STARTS, endedAt: null } }) }))[0]).toBe(
      `${W.replyKept(at(BASIS_AT))} ${W.replyKeptLate.termination}`,
    );
  });

  test("a reversed answer to a reply leads with the reply, then the lift by where the period stood; a review that answers one says so and what it leaves", () => {
    const reversed = statementParagraphs(answer("correction", "reversed", { reversals: [lift("not_started")] }));
    expect(reversed.slice(0, 2)).toEqual([W.replyReversed(at(BASIS_AT), false), W.liftedBefore("suspension", at(BASIS_AT))]);
    expect(reversed.at(-1)).toBe(REDRESS_TEXTS[2].notAppealable);
    expect(statementParagraphs(answer("correction", "partly_reversed", { reversals: [lift("running")] }))[0]).toBe(W.replyReversed(at(BASIS_AT), true));
    const review = statementParagraphs(answer("review", "kept"));
    expect(review[0]).toBe(`${W.reviewed(at(BASIS_AT), "kept")} ${W.replyAlso(at(FILED))} ${W.replyKeptOnTime.suspension(7, at(STARTS), at(ENDS))}`);
    // A review that reverses part and keeps the suspension answers it as a kept one does; one that lifts it says only that it answers.
    expect(statementParagraphs(answer("review", "partly_reversed", { reversals: [reversal("unretire_handle", { handle: "ada_l" })] }))[0]).toContain(W.replyKeptOnTime.suspension(7, at(STARTS), at(ENDS)));
    expect(statementParagraphs(answer("review", "reversed", { reversals: [lift("not_started")] }))[0]).toBe(`${W.reviewed(at(BASIS_AT), "reversed")} ${W.replyAlso(at(FILED))}`);
  });

  test("a withdrawal signed replaced says that korbat withdrew it for another measure, never replyReversed, liftedBefore or the reversal's lead", () => {
    const withdrawal = (replyFiledAt: string | null) =>
      statementParagraphs(statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, post: null, rulesVersion: 3, redressVersion: 2, measures: [], reviewed, reversals: [lift("not_started", { replaced: true, replyFiledAt })] }));
    const out = withdrawal(FILED);
    expect(out[0]).toBe(W.withdrawn("suspension", at(BASIS_AT), true));
    expect(out.join(" ")).not.toMatch(/korbat corrected its decision|korbat read your reply|it never starts/);
    expect(out.at(-1)).toBe(REDRESS_TEXTS[2].notAppealable);
    expect(withdrawal(null)[0]).toBe(W.withdrawn("suspension", at(BASIS_AT), false));
  });
});

describe("3e: the warning about reporting, the restriction of it, its lift and its end with the warning (design, section 18, W.2 and W.3, Task 5)", () => {
  const WARN_ENDS = "2027-01-02T09:30:15.250Z";
  const RESTRICT_ENDS = "2026-11-03T09:30:15.250Z";
  const WARNED_AT = "2026-09-20T08:00:00.000Z";
  const at = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  const warning = (more: Partial<DecisionStatement["measures"][number]> = {}) => measure("warn_reporting", { basis: "reports", endsAt: WARN_ENDS, ...more });
  const restriction = (more: Partial<DecisionStatement["measures"][number]> = {}) => measure("restrict_reporting", { basis: "reports", days: 30, endsAt: RESTRICT_ENDS, warnedAt: WARNED_AT, ...more });
  /** A final decision on an account case under R6 that warns about reporting or restricts it, made under rulebook 3 and redress 2. */
  const decided = (measures: DecisionStatement["measures"]) =>
    statement({ ruleId: "R6", rulesVersion: 3, redressVersion: 2, source: "own_initiative", post: null, measures, facts: "In the 90 days up to 2026-10-04 the account sent 8 reports.", reason: "They named nothing a rule could cover." });
  const appeal2 = REDRESS_TEXTS[2].appeal.replace("{deadline}", at(appealDeadline(new Date(DECIDED)).toISOString()));
  const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R6" as const, rulesVersion: 3, legalReference: null, decidedAt: WARNED_AT };
  const about = (kind: "correction" | "review", more: Partial<StatementInput>) =>
    statementParagraphs(statement({ kind, outcome: "reversed", ground: null, ruleId: null, facts: null, post: null, rulesVersion: 3, redressVersion: 2, measures: [], reviewed, ...more }));

  test("the words, each a constant", () => {
    expect(W.warn("2027-01-02 09:30 UTC")).toBe(
      "korbat warns you about your reports. Nothing is restricted. The facts below say how many of your reports under korbat's rules a moderator marked as manifestly unfounded, and which. This warning counts until 2027-01-02 09:30 UTC.",
    );
    expect(W.restrict(30, "2026-11-03 09:30 UTC", "2026-09-20 08:00 UTC")).toBe(
      "korbat restricted your reports under its rules for 30 days, until 2026-11-03 09:30 UTC: until then it takes no report from your account that says something breaks a korbat rule. It follows korbat's warning of 2026-09-20 08:00 UTC, and ends at once if that warning is lifted; the facts below name the reports you sent after it that were marked.",
    );
    expect(W.restrict(1, "x", "y")).toContain("for 1 day, until x");
    expect(W.reportingOpen).toBe("Notices of illegal content, reports of child sexual abuse material and requests for re-examination are never counted and never restricted.");
    expect(W.basisEndedReporting("2026-09-20 08:00 UTC")).toBe("The restriction of your reports that korbat decided on 2026-09-20 08:00 UTC rested on that warning.");
    expect(W.basisEndedReportingThen.running).toBe("It ended with this decision: you can report under korbat's rules again.");
    expect(W.basisEndedReportingThen.ended("2026-09-20 08:00 UTC", "2026-09-27 08:00 UTC")).toBe("It had run from 2026-09-20 08:00 UTC to 2026-09-27 08:00 UTC.");
    expect(W.reportingLifted.warning).toBe("korbat lifted its warning about your reports: it no longer counts.");
    expect(W.reportingLifted.restriction).toBe("korbat lifted the restriction of your reports: you can report under korbat's rules again.");
    expect(W.reportingLifted.restrictionEnded("2026-09-27 08:00 UTC")).toBe("korbat lifted the restriction of your reports that ran until 2026-09-27 08:00 UTC.");
    expect(W.scope.reporting("2026-11-03 09:30 UTC")).toBe("This applies everywhere korbat is available, until 2026-11-03 09:30 UTC.");
    expect(W.scope.warn).toBe("This restricts nothing.");
  });

  test("a warning, paragraph by paragraph: what it is and until when with what may follow and what it never touches, that it restricts nothing, the source, what the software counted, the account's conduct under R6, the facts, the reason and the appeal", () => {
    const r6 = getRule("R6", 3)!;
    expect(statementParagraphs(decided([warning()]))).toEqual([
      `${W.warn(at(WARN_ENDS))} ${REDRESS_TEXTS[2].warnNext} ${W.reportingOpen}`,
      W.scope.warn,
      "What this decision is about was found by a moderator.",
      W.automationCounted,
      W.ground.conduct("R6", r6.title, r6.text),
      "The facts: In the 90 days up to 2026-10-04 the account sent 8 reports.",
      "korbat's reasons: They named nothing a rule could cover.",
      appeal2,
    ]);
    // Rulebook 3's R6 names unfounded reports, so the paragraph of the rule says what the warning is about.
    expect(r6.text).toContain("plainly unfounded");
  });

  test("a restriction, paragraph by paragraph: its days, its end and the warning it follows, until when it applies, what the software counted, the account's conduct under R6 and the appeal; neither measure needs a reply", () => {
    const out = statementParagraphs(decided([restriction()]));
    expect(out[0]).toBe(`${W.restrict(30, at(RESTRICT_ENDS), at(WARNED_AT))} ${W.reportingOpen}`);
    expect(out[1]).toBe(W.scope.reporting(at(RESTRICT_ENDS)));
    expect(out).toContain(W.automationCounted);
    expect(out.at(-1)).toBe(appeal2);
    for (const paragraphs of [out, statementParagraphs(decided([warning()]))]) {
      expect(paragraphs).not.toContain(REDRESS_TEXTS[2].reply);
      expect(paragraphs).not.toContain(REDRESS_TEXTS[2].replyAtOnce);
      expect(paragraphs.join(" ")).not.toContain("It breaks");
    }
    // A deleted account's measure says that it changes nothing.
    expect(statementParagraphs(decided([restriction({ noEffect: "deleted" })]))[0]).toBe(`${W.restrict(30, at(RESTRICT_ENDS), at(WARNED_AT))} ${W.deletedAccount} ${W.reportingOpen}`);
  });

  test("a warning without its end, or a restriction without its days, its end or its warning, is not rendered as another statement", () => {
    expect(() => statementParagraphs(decided([warning({ endsAt: null })]))).toThrow(/warn_reporting/);
    expect(() => statementParagraphs(decided([restriction({ days: undefined })]))).toThrow(/restrict_reporting/);
    expect(() => statementParagraphs(decided([restriction({ endsAt: null })]))).toThrow(/restrict_reporting/);
    expect(() => statementParagraphs(decided([restriction({ warnedAt: null })]))).toThrow(/restrict_reporting/);
    // A redress version without the warning's next step cannot word a warning.
    expect(() => statementParagraphs({ ...decided([warning()]), redressVersion: 1 })).toThrow(/redress/);
  });

  test("the lift of a warning, of a restriction that ran and of one whose days had run out, in a correction and in a review", () => {
    for (const kind of ["correction", "review"] as const) {
      const lift = (more: Partial<DecisionStatement["reversals"][number]>) => about(kind, { reversals: [reversal("lift_reporting", { liftedDecidedAt: WARNED_AT, ...more })] });
      expect(lift({ liftedKind: "warn_reporting" })[1], kind).toBe(W.reportingLifted.warning);
      expect(lift({ liftedKind: "restrict_reporting", periodThen: { state: "running", startedAt: WARNED_AT, endedAt: null } })[1], kind).toBe(W.reportingLifted.restriction);
      expect(lift({ liftedKind: "restrict_reporting", periodThen: { state: "ended", startedAt: WARNED_AT, endedAt: RESTRICT_ENDS } })[1], kind).toBe(W.reportingLifted.restrictionEnded(at(RESTRICT_ENDS)));
      expect(() => lift({ liftedKind: null }), kind).toThrow(/lift_reporting/);
      expect(lift({ liftedKind: "warn_reporting" }).at(-1), kind).toBe(REDRESS_TEXTS[2].notAppealable);
    }
  });

  test("lifting the warning a restriction rests on ends the restriction in that decision, which says so: you can report again, or when its days had already run out, when it ran", () => {
    const ended = (state: "running" | "ended") => ({
      kind: "restrict_reporting" as const,
      decidedAt: WARNED_AT,
      periodThen: { state, startedAt: WARNED_AT, endedAt: state === "ended" ? RESTRICT_ENDS : null },
      seal: false,
      replyFiledAt: null,
    });
    const lifting = (state: "running" | "ended") =>
      about("review", { reversals: [reversal("lift_reporting", { liftedKind: "warn_reporting", liftedDecidedAt: WARNED_AT })], endedStanding: [ended(state)] });
    expect(lifting("running")).toContain(`${W.basisEndedReporting(at(WARNED_AT))} ${W.basisEndedReportingThen.running}`);
    expect(lifting("ended")).toContain(`${W.basisEndedReporting(at(WARNED_AT))} ${W.basisEndedReportingThen.ended(at(WARNED_AT), at(RESTRICT_ENDS))}`);
    expect(lifting("running").join(" ")).not.toContain("suspension");
  });

  test("every kind of the ledger is worded: none is refused as not worded", () => {
    for (const kind of [...MEASURE_KINDS, ...REVERSAL_KINDS]) {
      let message = "";
      try {
        if ((MEASURE_KINDS as readonly string[]).includes(kind)) statementParagraphs(decided([measure(kind as MeasureKind)]));
        else about("correction", { reversals: [reversal(kind as ReversalKind)] });
      } catch (err) {
        message = String(err);
      }
      expect(message, kind).not.toMatch(/not worded/);
    }
  });
});

describe("3e's review: a decision about a measure that rests on korbat's terms names the terms, never a rule (W.2, people1)", () => {
  const BASIS_AT = "2026-10-02T08:00:00.000Z";
  const STARTS = "2026-10-11T09:30:15.250Z";
  /** The reviewed decision, which cited the newest strike's rule (a ladder step) or R2 (a protective suspension). */
  const reviewedOn = (basis: "strikes" | "ladder_end" | "protective" | "threat"): NonNullable<StatementInput["reviewed"]> => ({
    kind: "final",
    ground: "incompatible",
    ruleId: basis === "protective" ? "R2" : basis === "threat" ? "R5" : "R4",
    rulesVersion: 3,
    legalReference: null,
    decidedAt: BASIS_AT,
    basis,
  });
  const about = (basis: "strikes" | "ladder_end" | "protective" | "threat", more: Partial<StatementInput>) =>
    statement({ ground: null, ruleId: null, facts: null, post: null, rulesVersion: 3, redressVersion: 2, measures: [], reviewed: reviewedOn(basis), ...more });
  const kind = (basis: string): "suspend" | "terminate" => (basis === "ladder_end" ? "terminate" : "suspend");
  const forms = (basis: "strikes" | "ladder_end" | "protective" | "threat") => ({
    "a kept answer to a reply": about(basis, {
      kind: "correction",
      outcome: "kept",
      repliedTo: { filedAt: "2026-10-05T10:00:00.000Z", onTime: true, kind: kind(basis), days: kind(basis) === "suspend" ? 7 : null, periodThen: { state: "not_started", startedAt: null, endedAt: null }, startsAt: STARTS, endsAt: kind(basis) === "suspend" ? "2026-10-18T09:30:15.250Z" : null, appealUntil: "2027-04-11T09:30:15.250Z" },
    }),
    "a lift": about(basis, {
      kind: "correction",
      outcome: "reversed",
      reversals: [reversal("lift_suspension", { liftedKind: kind(basis), liftedDecidedAt: BASIS_AT, periodThen: { state: "running", startedAt: STARTS, endedAt: null }, replaced: false, replyFiledAt: null })],
    }),
    "a kept review": about(basis, { kind: "review", outcome: "kept" }),
  });

  test("a kept answer, a lift and a kept review of a suspension of the ladder, a termination at its end and a protective suspension say the decision rested on the terms' section", () => {
    expect(W.ground.restedOnTerms).toBe("That decision rested on korbat's terms, section Suspension and termination.");
    for (const basis of ["strikes", "ladder_end", "protective"] as const) {
      for (const [name, input] of Object.entries(forms(basis))) {
        const out = text(input);
        expect(out, `${basis}, ${name}`).toContain(W.ground.restedOnTerms);
        expect(out, `${basis}, ${name}`).not.toContain("rested on korbat rule");
      }
    }
  });

  test("a measure taken at once on a decision about the account's conduct, and a decision of 3c, still name the rule they rested on", () => {
    for (const [name, input] of Object.entries(forms("threat"))) expect(text(input), name).toContain("That decision rested on korbat rule R5");
    const { basis: _basis, ...without } = reviewedOn("strikes");
    expect(text(about("strikes", { kind: "review", outcome: "kept", reviewed: without }))).toContain("That decision rested on korbat rule R4");
  });
});

describe("3f: the notice of an authority's order (design, sections 7.10 and 10.7, W.2 and W.3; invariant 22)", () => {
  const DISABLED = "2026-10-04T09:30:15.250Z";
  const facts = (more: Partial<NonNullable<StatementInput["order"]>> = {}): NonNullable<StatementInput["order"]> => ({
    kind: "tco_removal",
    memberState: "FR",
    authority: "OCLCTIC",
    reference: "TCO-2026-17",
    verified: false,
    orderedOn: "2026-10-04",
    orderedFrom: "received",
    crossBorder: true,
    homeState: "DE",
    withholdAuthor: true,
    disabledAt: DISABLED,
    held: false,
    informedAt: DISABLED,
    holdEndReason: null,
    preserveUntil: "2027-04-05T09:30:15.250Z",
    preserveFirstUntil: "2027-04-05T09:30:15.250Z",
    preserveExtended: false,
    preserveEndedOn: null,
    orderGround: null,
    ...more,
  });
  const notice = (order: NonNullable<StatementInput["order"]>, more: Partial<StatementInput> = {}): StatementInput =>
    statement({
      kind: "order",
      outcome: "restricted",
      ground: "illegal",
      ruleId: null,
      legalReference: null,
      facts: null,
      reason: null,
      source: "order",
      redressVersion: 3,
      measures: [measure("disable_by_order")],
      order,
      ...more,
    });
  const reinstatement = (ground: NonNullable<StatementInput["order"]>["orderGround"]) =>
    statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, legalReference: null, facts: null, reason: "x", source: "order", redressVersion: 3, measures: [], reversals: [reversal("reinstate_by_order")], reviewed: { kind: "order", ground: "illegal", ruleId: null, rulesVersion: 3, legalReference: null, decidedAt: DISABLED }, order: facts({ orderGround: ground }) });
  const TEXTS = { reasons: "Les raisons.", redress: "Les recours.", scope: null, textsAt: "2026-10-06T08:00:00.000Z", reasonsAt: "2026-10-06T08:00:00.000Z" };
  const N = ORDER_NOTICE;

  // Every combination the table names: each kind, verified and not, with and without texts, held and not, held by korbat's
  // mistake, preserved, erased, and the reinstatement on each ground.
  const cases: { name: string; input: StatementInput; texts: typeof TEXTS | null; erasedOn?: string }[] = [];
  for (const kind of ["tco_removal", "dsa_art9"] as const) {
    for (const verified of [false, true]) {
      for (const held of [false, true]) {
        for (const texts of [null, TEXTS]) {
          const order = facts({ kind, verified, held, informedAt: held ? "2026-11-16T00:10:00.000Z" : DISABLED, withholdAuthor: kind === "tco_removal" || held, preserveUntil: kind === "tco_removal" ? facts().preserveUntil : null, preserveFirstUntil: kind === "tco_removal" ? facts().preserveFirstUntil : null, crossBorder: kind === "tco_removal" });
          cases.push({ name: `${kind} verified=${verified} held=${held} texts=${texts !== null}`, input: notice(order), texts });
        }
      }
    }
  }
  cases.push({ name: "held by korbat's mistake", input: notice(facts({ held: true, informedAt: "2026-10-05T00:00:00.000Z", holdEndReason: "not_ordered" })), texts: null });
  cases.push({ name: "erased", input: notice(facts()), texts: TEXTS, erasedOn: "2027-04-05" });
  for (const ground of ORDER_GROUNDS) cases.push({ name: `reinstated: ${ground}`, input: reinstatement(ground), texts: null });

  test("no notice says that korbat found anything, cites a rule, prints an address or a handle, or offers korbat's appeal", () => {
    const v2 = Object.values(REDRESS_TEXTS[2]) as string[];
    for (const c of cases) {
      const all = statementParagraphs(c.input, { texts: c.texts, erasedOn: c.erasedOn ?? null }).join(NL);
      expect(all, c.name).not.toMatch(/korbat found|It breaks|illegal content in your post|shows them to nobody(?! but)/);
      expect(all, c.name).not.toMatch(/@/);
      expect(all, c.name).not.toMatch(/(^|[^A-Za-z0-9_])R[1-6]([^A-Za-z0-9_]|$)/m);
      expect(all, c.name).not.toMatch(/You can appeal|choose "Appeal"|appeal to korbat/);
      for (const sentence of v2) expect(all, c.name).not.toContain(sentence);
      // The authority's own words are the screen's, in their block; no paragraph holds them.
      expect(all, c.name).not.toContain(TEXTS.reasons);
    }
  });

  test("an unverified notice says which authority the order names, never that korbat confirmed it", () => {
    const unverified = statementParagraphs(notice(facts())).join(NL);
    expect(unverified).toContain("It names OCLCTIC, France, as the authority that issued it, under the reference TCO-2026-17, and reached korbat on 2026-10-04.");
    expect(unverified).not.toContain(N.lead.confirmed);
    const verified = statementParagraphs(notice(facts({ verified: true, orderedFrom: "issued", orderedOn: "2026-10-03" }))).join(NL);
    expect(verified).toContain(`, and is dated 2026-10-03. ${N.lead.confirmed}`);
  });

  test("only a removal order's notice says that the law obliges korbat; a DSA order's says the law it was issued under requires it", () => {
    const tco = statementParagraphs(notice(facts())).join(NL);
    const dsa = statementParagraphs(notice(facts({ kind: "dsa_art9", preserveUntil: null, crossBorder: false }))).join(NL);
    expect(tco).toContain("the law obliges korbat to carry out such an order");
    expect(dsa).not.toMatch(/obliges|leaves korbat no choice/);
    expect(dsa).toContain(N.everywhere.dsa_art9);
    expect(dsa).not.toContain("Article 6 of the Regulation");
  });

  test("the paragraphs in the table's order, for a held removal order from another state whose texts came later", () => {
    const informed = "2026-11-16T00:10:00.000Z";
    const paragraphs = statementParagraphs(notice(facts({ held: true, informedAt: informed })), { texts: { ...TEXTS, textsAt: "2026-11-20T08:00:00.000Z", reasonsAt: "2026-11-20T08:00:00.000Z" } });
    expect(paragraphs).toEqual([
      N.done.disabled(POST_TIME, `/post/${POST.id}`, "2026-10-04 09:30 UTC"),
      N.lead.tco_removal("OCLCTIC", "France", "TCO-2026-17", ", and reached korbat on 2026-10-04"),
      N.notAssessed.tco_removal,
      N.heldUntilNow.tco_removal("2026-10-04 09:30 UTC", "2026-11-16 00:10 UTC"),
      N.textsSince("2026-11-20 08:00 UTC"),
      N.copy,
      `${N.scrutiny("Germany")} ${N.reasonsAt("2026-11-20 08:00 UTC")}`,
      N.preserved("2027-04-05 09:30 UTC"),
      N.everywhere.tco_removal,
      N.noAppeal.tco_removal,
      N.wrongItem,
    ]);
  });

  test("a hold ended as korbat's mistake says so in place of the hold's paragraph; texts recorded before the telling print no since line", () => {
    const paragraphs = statementParagraphs(notice(facts({ held: true, informedAt: "2026-10-06T10:00:00.000Z", holdEndReason: "not_ordered" })), { texts: TEXTS });
    expect(paragraphs).toContain(N.heldUntilNow.notOrdered("2026-10-04 09:30 UTC", "2026-10-06 10:00 UTC"));
    expect(paragraphs).not.toContain(N.heldUntilNow.tco_removal("2026-10-04 09:30 UTC", "2026-10-06 10:00 UTC"));
    expect(paragraphs.join(NL)).not.toContain("korbat added the authority's words");
    expect(paragraphs).toContain(`${N.scrutiny("Germany")} ${N.reasonsAt("2026-10-06 10:00 UTC")}`);
  });

  test("3f's review: the reasons recorded after the telling and the remedies later still: the since line prints the remedies' time, the scrutiny sentence the reasons' own", () => {
    const told = "2026-10-04T09:30:00.000Z";
    const texts = { ...TEXTS, reasonsAt: "2026-10-05T11:00:00.000Z", textsAt: "2026-10-06T15:30:00.000Z" };
    const paragraphs = statementParagraphs(notice(facts({ informedAt: told })), { texts });
    expect(paragraphs).toContain(N.textsSince("2026-10-06 15:30 UTC"));
    expect(paragraphs).toContain(`${N.scrutiny("Germany")} ${N.reasonsAt("2026-10-05 11:00 UTC")}`);
  });

  test("without texts the notice says that they follow; a measure that changed nothing says so; the erasure replaces the preservation", () => {
    const paragraphs = statementParagraphs(notice(facts(), { measures: [measure("disable_by_order", { noEffect: "already" })] }));
    expect(paragraphs).toContain(N.textsFollow);
    expect(paragraphs).toContain(W.already("post"));
    expect(paragraphs.join(NL)).toContain(N.noReasonsYet);
    const erased = statementParagraphs(notice(facts()), { erasedOn: "2027-04-05" });
    expect(erased).toContain(N.erased("2027-04-05"));
    expect(erased.join(NL)).not.toContain("korbat keeps the post");
  });

  test("a reinstatement renders its lead, its ground's fixed sentence, what is shown now and the lift, on each ground", () => {
    for (const ground of ORDER_GROUNDS) {
      expect(statementParagraphs(reinstatement(ground)), ground).toEqual([
        N.reinstated.lead("2026-10-04 09:30 UTC", POST_TIME, `/post/${POST.id}`),
        ORDER_DRAFTS.reinstate[ground],
        N.reinstated.now,
        N.lifted,
      ]);
    }
    expect(statementParagraphs(reinstatement("withdrawn"), { erasedOn: "2027-04-05" })).toContain(N.reinstated.erased("2027-04-05"));
  });

  // Task 4 (design, sections 6.4 and 6.8): erase_order_records deletes an order's row, items and events three years after
  // its last event; its decisions stay in the ledger with no order's facts left to read.
  const goneOrder = () => statement({ kind: "order", outcome: "restricted", ground: "illegal", ruleId: null, legalReference: null, facts: null, reason: null, source: "order", redressVersion: 3, measures: [measure("disable_by_order")], order: null });
  const goneReinstatement = () => ({ ...reinstatement("withdrawn"), order: null });
  const minute = (at: string) => `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`;

  test("Task 4: once the order's records are deleted, its notice says only that an order was given effect, and when, and its reinstatement that it was lifted", () => {
    const order = goneOrder();
    expect(statementParagraphs(order)).toEqual([N.recordsDeleted.done(POST_TIME, `/post/${POST.id}`, minute(order.decidedAt)), N.recordsDeleted.gone]);
    expect(statementParagraphs(goneReinstatement())).toEqual([N.reinstated.lead("2026-10-04 09:30 UTC", POST_TIME, `/post/${POST.id}`), N.recordsDeleted.gone, N.lifted]);
    expect(N.recordsDeleted.gone).toContain(`${ORDER_RULES.recordKeepYears} years after an order's last event`);
    // Nothing of the order is left to name, and nothing a notice must never say is said.
    for (const paragraphs of [statementParagraphs(goneOrder()), statementParagraphs(goneReinstatement())]) {
      const all = paragraphs.join(NL);
      expect(all).not.toMatch(/korbat found|It breaks|@|You can appeal|OCLCTIC|TCO-2026-17/);
    }
  });

  test("Task 6: a disabling taken again after a restore says so after `everywhere`, with the lost day, and that the six months count from the first time", () => {
    const again = notice(facts(), { reapplied: { lostOn: "2026-10-02" } });
    const paragraphs = statementParagraphs(again, { texts: TEXTS });
    const everywhere = paragraphs.indexOf(N.everywhere.tco_removal);
    expect(paragraphs[everywhere + 1]).toBe(N.reapplied("2026-10-02"));
    expect(N.reapplied("2026-10-02")).toBe(
      "The post was first disabled on 2026-10-02. korbat lost its record of that when it had to restore its database from a backup, and disabled the post again with this decision; the six months above count from the first time.",
    );
    // A notice of a disabling that was not lost says nothing of a restore.
    expect(statementParagraphs(notice(facts()), { texts: TEXTS }).join(NL)).not.toMatch(/restore/);
  });

  test("3f's review (people6): an extended preservation prints the first end as six months from the disabling and the extended one as longer; an erasure says that the preservation ended", () => {
    const extended = statementParagraphs(notice(facts({ preserveExtended: true, preserveFirstUntil: "2027-04-05T09:30:15.250Z", preserveUntil: "2027-10-05T09:30:00.000Z" })), { texts: TEXTS });
    const at = extended.indexOf(N.preserved("2027-04-05 09:30 UTC"));
    expect(at).toBeGreaterThan(-1);
    expect(extended[at + 1]).toBe(N.preservedLonger("2027-10-05 09:30 UTC"));
    expect(extended.join(NL)).not.toContain("until 2027-10-05 09:30 UTC, six months from the disabling");
    // Not extended: the one end, as before.
    const plain = statementParagraphs(notice(facts()), { texts: TEXTS });
    expect(plain).toContain(N.preserved("2027-04-05 09:30 UTC"));
    expect(plain.join(NL)).not.toContain("keep them longer");
    // An erasure after an extension, or one a freeze delayed, ends a preservation that was not six months.
    expect(N.erased("2027-10-05")).toBe("The preservation ended on 2027-10-05. korbat erased the post's text, its images and its copies of them. The post cannot be reinstated.");
    expect(N.reinstated.erased("2027-10-05")).toBe("korbat had already erased the post's content when its preservation ended on 2027-10-05, so nothing can be shown again.");
    expect([N.erased("x"), N.reinstated.erased("x")].join(NL)).not.toContain("six months");
  });

  test("3f's review (people7): a disabling taken again whose notice shows no preservation (a DSA order, or one already erased) names no six months above", () => {
    const dsa = statementParagraphs(notice(facts({ kind: "dsa_art9", preserveUntil: null, preserveFirstUntil: null, crossBorder: false }), { reapplied: { lostOn: "2026-10-02" } }), { texts: TEXTS });
    const everywhere = dsa.indexOf(N.everywhere.dsa_art9);
    expect(dsa[everywhere + 1]).toBe(N.reappliedNoPreservation("2026-10-02"));
    expect(N.reappliedNoPreservation("2026-10-02")).toBe(
      "The post was first disabled on 2026-10-02. korbat lost its record of that when it had to restore its database from a backup, and disabled the post again with this decision.",
    );
    expect(dsa.join(NL)).not.toContain("six months");
    const erased = statementParagraphs(notice(facts(), { reapplied: { lostOn: "2026-10-02" } }), { texts: TEXTS, erasedOn: "2027-04-05" });
    expect(erased).toContain(N.reappliedNoPreservation("2026-10-02"));
    expect(erased.join(NL)).not.toContain("six months above");
    // A removal order's notice that shows its preservation keeps the sentence that counts from the first time.
    expect(statementParagraphs(notice(facts(), { reapplied: { lostOn: "2026-10-02" } }), { texts: TEXTS })).toContain(N.reapplied("2026-10-02"));
  });
});

describe("3f Task 6: a decision taken again after a restore (design, sections 7.17 step 7 and 10.4, W.2)", () => {
  test("the sentence, word for word, names the lost decision's day and that the time to appeal counts from this one", () => {
    expect(STATEMENT_WORDS.reapplied("2026-10-02")).toBe(
      "korbat first took this decision on 2026-10-02. It lost its record of that when it had to restore its database from a backup, and has taken the decision again here. Your time to appeal counts from this one.",
    );
  });

  test("it follows what was done, before where and how long; a decision that took nothing again has no such sentence", () => {
    const again = statementParagraphs(statement({ reapplied: { lostOn: "2026-10-02" } }));
    expect(again.slice(0, 3)).toEqual([`korbat removed your post of ${POST_TIME}: other people can no longer see it.`, STATEMENT_WORDS.reapplied("2026-10-02"), "This applies everywhere korbat is available and has no end date."]);
    expect(again.slice(2)).toEqual(statementParagraphs(statement()).slice(1));
    expect(text(statement())).not.toMatch(/restore/);
    expect(text(statement({ reapplied: null }))).not.toMatch(/restore/);
    // A correction taken again: after its lead and what it lifted.
    const corrected = statementParagraphs(
      statement({ kind: "correction", outcome: "reversed", measures: [], reversals: [reversal("restore")], reviewed: { kind: "final", ground: "incompatible", ruleId: "R1", rulesVersion: 2, legalReference: null, decidedAt: DECIDED }, reapplied: { lostOn: "2026-10-02" } }),
    );
    expect(corrected[2]).toBe(STATEMENT_WORDS.reapplied("2026-10-02"));
  });
});

describe("the package", () => {
  test("its index re-exports the statement and its words: the index is the package's only door", () => {
    expect(typeof statementParagraphs).toBe("function");
    expect(STATEMENT_WORDS.automation).toBe("No automated means were used to find this or to decide it.");
  });
});
