import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { IMPORT_RULES, type ImportChoice, type ImportedPost } from "@korbat/contracts";
import { isMediaId } from "@korbat/media-protocol";
import { settlementOf } from "../src/imports/feeder";
import { chosenTotals, firstWords, imageAlt, importImageId, importPostId, keptLine, marksPass, monthInChoice, uuidFrom } from "../src/imports/plan";
import type { PickRow } from "../src/imports/repo";

/**
 * What a confirmed import publishes and prepares, in one place each (3b design, sections 4.4, 6.5, 7.4 and 8.2; Task 5):
 * the derived ids, the rule that keeps a line, the totals a choice holds as the app counts them, a refused post's first
 * words, and how the feeder settles an image row. Pure functions; no database, no file.
 */
const CHOICE: ImportChoice = { from: null, to: null, replies: false, warnings: false, protected: false, images: true, long: "leave" };
const SEED = Buffer.alloc(32, 9);
const post = (over: Partial<ImportedPost> = {}): ImportedPost => ({
  ref: 4,
  key: "a".repeat(64),
  at: "2019-03-02T12:00:00Z",
  kind: "post",
  parent: null,
  text: "a post",
  media: [],
  protected: false,
  warning: false,
  ...over,
});
const pick = (over: Partial<PickRow>): PickRow => ({ ref: 4, leftOut: false, alts: null, month: "2019-03", marks: 0, described: 0, ...over });

describe("derived ids (6.5)", () => {
  test("uuidFrom takes the first 16 bytes of the digest, sets the version-4 and variant bits, and writes lowercase hex", () => {
    const digest = Buffer.alloc(32, 0xff);
    expect(uuidFrom(digest)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(uuidFrom(Buffer.alloc(32, 0))).toBe("00000000-0000-4000-8000-000000000000");
  });

  test("a post's and an image's id are SHA-256 of the seed and their words, each a media id, different for each ref and position", () => {
    expect(importPostId(SEED, 7)).toBe(uuidFrom(createHash("sha256").update(Buffer.concat([SEED, Buffer.from("post:7")])).digest()));
    expect(importImageId(SEED, 7, 2)).toBe(uuidFrom(createHash("sha256").update(Buffer.concat([SEED, Buffer.from("image:7:2")])).digest()));
    const ids = [importPostId(SEED, 7), importImageId(SEED, 7, 0), importImageId(SEED, 7, 1), importImageId(SEED, 8, 0), importImageId(Buffer.alloc(32, 1), 7, 0)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isMediaId(id), id).toBe(true);
  });
});

describe("the kept-line rule (6.5)", () => {
  const rule = { fromRef: 2, choice: CHOICE, picks: new Map<number, PickRow>(), known: new Set<string>() };

  test("a line at or after fromRef, not already imported, within the months, whose marks pass and whose pick keeps it", () => {
    expect(keptLine(post(), rule)).toEqual({ kept: true });
    expect(keptLine(post({ ref: 1 }), rule)).toEqual({ kept: false, reason: "new_account_cap" });
    expect(keptLine(post(), { ...rule, known: new Set(["a".repeat(64)]) })).toEqual({ kept: false, reason: "already_imported" });
    expect(keptLine(post(), { ...rule, choice: { ...CHOICE, from: "2019-04" } })).toEqual({ kept: false, reason: "month" });
    expect(keptLine(post(), { ...rule, choice: { ...CHOICE, to: "2019-02" } })).toEqual({ kept: false, reason: "month" });
    expect(keptLine(post({ kind: "reply" }), rule)).toEqual({ kept: false, reason: "marks" });
    expect(keptLine(post({ kind: "reply" }), { ...rule, choice: { ...CHOICE, replies: true } })).toEqual({ kept: true });
    expect(keptLine(post(), { ...rule, picks: new Map([[4, pick({ leftOut: true })]]) })).toEqual({ kept: false, reason: "left_out" });
  });

  test("each mark passes only when the choice takes it; a month is within an open or closed range", () => {
    expect([1, 2, 4, 8].map((marks) => marksPass(marks, CHOICE))).toEqual([false, false, false, false]);
    expect(marksPass(15, { ...CHOICE, replies: true, long: "shorten", warnings: true, protected: true })).toBe(true);
    expect(marksPass(0, CHOICE)).toBe(true);
    expect([monthInChoice("2019-03", { from: null, to: null }), monthInChoice("2019-03", { from: "2019-03", to: "2019-03" }), monthInChoice("2019-04", { from: null, to: "2019-03" })]).toEqual([true, true, false]);
  });

  test("an image's description is its source's, else the person's from the pick, else none", () => {
    expect(imageAlt({ file: "4-0.png", alt: "the source's" }, pick({ alts: ["the person's"] }), 0)).toBe("the source's");
    expect(imageAlt({ file: "4-1.png", alt: null }, pick({ alts: [null, "the person's"] }), 1)).toBe("the person's");
    expect(imageAlt({ file: "4-1.png", alt: null }, undefined, 1)).toBeNull();
  });
});

describe("the chosen totals, as the app counts them (the orchestrator's ruling)", () => {
  // March: 3 posts without marks with 4 images (1 undescribed), 2 replies with 2 images; May: 1 post with 1 image.
  const scan = {
    months: [
      { month: "2019-03", groups: [[0, 3, 4, 1], [1, 2, 2, 0]] as [number, number, number, number][] },
      { month: "2019-05", groups: [[0, 1, 1, 0]] as [number, number, number, number][] },
    ],
  };

  test("posts and described images of the months and marks the choice keeps, less the picks that leave a line out, plus the descriptions picks give", () => {
    expect(chosenTotals(scan, [], CHOICE, true)).toEqual({ posts: 4, images: 4 });
    expect(chosenTotals(scan, [], { ...CHOICE, replies: true }, true)).toEqual({ posts: 6, images: 6 });
    expect(chosenTotals(scan, [], { ...CHOICE, from: "2019-04" }, true)).toEqual({ posts: 1, images: 1 });
    const picks = [pick({ leftOut: true, described: 2 }), pick({ ref: 5, alts: ["given"] }), pick({ ref: 6, leftOut: true, marks: 1, described: 1 })];
    // The reply's pick counts nothing while replies are left out.
    expect(chosenTotals(scan, picks, CHOICE, true)).toEqual({ posts: 3, images: 3 });
    expect(chosenTotals(scan, picks, CHOICE, false)).toEqual({ posts: 3, images: 0 });
    expect(chosenTotals(scan, [], { ...CHOICE, from: "2019-04", to: "2019-04" }, true)).toEqual({ posts: 0, images: 0 });
  });
});

describe("a refused post's first words (8.2)", () => {
  test("at most refusedWordsMax code points, cut at the last space within them, line breaks read as spaces", () => {
    expect(firstWords("short words")).toBe("short words");
    const NL = String.fromCharCode(10);
    expect(firstWords(`one${NL}two  three`)).toBe("one two three");
    const long = "word ".repeat(40).trim();
    const cut = firstWords(long);
    expect([...cut].length).toBeLessThanOrEqual(IMPORT_RULES.refusedWordsMax);
    expect(cut.endsWith("word")).toBe(true);
    expect(firstWords("x".repeat(200))).toBe("x".repeat(IMPORT_RULES.refusedWordsMax));
    // Code points, not UTF-16 units: an astral character counts once.
    const astral = String.fromCodePoint(0x1f600);
    expect([...firstWords(astral.repeat(100))].length).toBe(IMPORT_RULES.refusedWordsMax);
  });
});

describe("how the feeder settles an image row (7.4 step 5)", () => {
  const now = new Date("2026-10-26T12:00:00.000Z");
  const row = (over: Partial<Parameters<typeof settlementOf>[0]>) => ({ id: "x", status: "processing" as const, check: "pending" as const, refused: false, createdAt: now, ...over });

  test("ready and clear is kept; a non-acting match is flagged; failed is failed; anything else waits checkHours from its row, then is not_checked", () => {
    expect(settlementOf(row({ status: "ready", check: "clear" }), now)).toBe("kept");
    expect(settlementOf(row({ status: "ready", check: "matched" }), now)).toBe("flagged");
    expect(settlementOf(row({ status: "failed", check: null }), now)).toBe("failed");
    const late = new Date(now.getTime() + IMPORT_RULES.checkHours * 3_600_000);
    for (const waiting of [row({}), row({ status: "ready", check: "unchecked" }), row({ check: "capped" }), row({ status: "ready", check: null })]) {
      expect(settlementOf(waiting, new Date(late.getTime() - 1))).toBeNull();
      expect(settlementOf(waiting, late)).toBe("not_checked");
    }
  });
});
