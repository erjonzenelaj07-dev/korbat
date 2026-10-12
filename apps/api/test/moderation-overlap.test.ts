import { describe, expect, test } from "vitest";
import { OVERLAP_RUN, quotes, quotesUser } from "../src/moderation/overlap";

/**
 * The overlap check on staff texts (3c design, section 7.4; C19): a text that goes to the author with a statement must
 * not carry what a reporter, a notifier or an appellant wrote. It is refused when any run of 32 characters of one of
 * their texts appears in it, both lower-cased and with every run of whitespace made one space. Staff paraphrase.
 */
describe("the overlap check on staff texts", () => {
  // 40 characters once its spaces are single: long enough to hold runs of 32.
  const theirs = "He posted my home address on the 3rd day";
  const LF = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);

  test("the run is 32 characters", () => {
    expect(OVERLAP_RUN).toBe(32);
    expect(theirs).toHaveLength(40);
  });

  test("a text that holds a run of 32 characters of theirs quotes it; one that holds 31 does not", () => {
    const run32 = theirs.slice(3, 35);
    const run31 = theirs.slice(3, 34);
    expect(run32).toHaveLength(32);
    expect(quotes(`The reporter wrote [${run32}].`, [theirs])).toBe(true);
    // The 31 characters stand between two characters that are not theirs, so no window of 32 matches.
    expect(quotes(`The reporter wrote [${run31}].`, [theirs])).toBe(false);
    expect(quotes(theirs, [theirs])).toBe(true);
    expect(quotes("The post names the home address of another person.", [theirs])).toBe(false);
  });

  test("a text of theirs under 32 characters can never be quoted", () => {
    const short = "section 241 of the criminal code";
    expect(short).toHaveLength(32);
    expect(quotes(`It breaks ${short}.`, [short])).toBe(true);
    expect(quotes(`It breaks ${short.slice(0, 31)}.`, [short.slice(0, 31)])).toBe(false);
    expect(quotes("anything", [""])).toBe(false);
    expect(quotes("", [theirs])).toBe(false);
    expect(quotes("anything at all", [])).toBe(false);
  });

  test("case does not hide a quote", () => {
    expect(quotes(theirs.toUpperCase(), [theirs])).toBe(true);
    expect(quotes(theirs, [theirs.toUpperCase()])).toBe(true);
  });

  test("whitespace does not hide a quote: every run of it counts as one space, in either text", () => {
    const spread = theirs.split(" ").join(`  ${LF}${TAB} `);
    expect(quotes(spread, [theirs])).toBe(true);
    expect(quotes(theirs, [spread])).toBe(true);
    // Without its spaces it is another text: the check finds copies, not likenesses.
    expect(quotes(theirs.split(" ").join(""), [theirs])).toBe(false);
  });

  test("any one of their texts is enough, wherever in the staff text the run stands", () => {
    const other = "This account sells accounts and followers for money.";
    expect(quotes(`A first sentence of the moderator's own. ${other} And a last one.`, ["a short one", theirs, other])).toBe(true);
  });

  test("characters outside the basic plane count as one each", () => {
    const emoji = String.fromCodePoint(0x1f600);
    const their = `${emoji.repeat(16)}0123456789abcdef`;
    expect(Array.from(their)).toHaveLength(32);
    expect(quotes(`x ${their} y`, [their])).toBe(true);
    // One emoji fewer leaves 31 characters, though 62 UTF-16 units.
    const shorter = `${emoji.repeat(15)}0123456789abcdef`;
    expect(shorter.length).toBeGreaterThan(32);
    expect(quotes(`x ${shorter} y`, [shorter])).toBe(false);
  });

  test("every kind is checked but a note and a recorded choice not to seal, which stay with staff", () => {
    for (const kind of ["facts", "reason", "legal_reference", "review_reason", "reveal_reason"] as const) expect(quotesUser(kind, theirs, [theirs]), kind).toBe(true);
    for (const kind of ["note", "seal_declined"] as const) expect(quotesUser(kind, theirs, [theirs]), kind).toBe(false);
    expect(quotesUser("facts", "The post names the home address of another person.", [theirs])).toBe(false);
  });

  test("a re-examination's statement and an appeal's statement are theirs as an explanation and a cited law are", () => {
    const explanation = "This is my address and my phone number, posted to hurt me.";
    const citedLaw = "Article 8 of the Charter of Fundamental Rights of the European Union";
    const reexamination = "You answered without looking at the second image of the post.";
    const appeal = "My post quoted a public record and named nobody who is not in it.";
    for (const their of [explanation, citedLaw, reexamination, appeal]) {
      expect(quotesUser("reason", `As the text says: ${their}`, [explanation, citedLaw, reexamination, appeal]), their).toBe(true);
    }
  });
});
