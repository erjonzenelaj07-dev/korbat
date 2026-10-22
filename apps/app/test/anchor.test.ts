import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { anchoredScroll, rowAtTop, scrollToShow, viewAnchor, type RowBox } from "../src/components/list/anchor.web";

/**
 * Prepending without a jump (UI design, section 7.5; Task 5). The list records the row at the top of its view and where
 * that row is in the list's content; when rows are put above it, or rows above it are drawn at their real height, the
 * scroll position moves by exactly the change, so the row stays where the reader sees it. On the web this is
 * anchor.web.ts on the scroll node, with the browser's own anchoring turned off; on native FlatList's
 * maintainVisibleContentPosition does it. The arithmetic is checked here as the pure functions do it.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Rows of the given heights, laid out from `start` in the list's content. */
function rows(heights: number[], start = 0): RowBox[] {
  let top = start;
  return heights.map((height, i) => {
    const box = { key: `r${i}`, top, height };
    top += height;
    return box;
  });
}

describe("the row at the top", () => {
  test("is the first row whose bottom is below the view's top line, which starts under a floating header", () => {
    const list = rows([100, 200, 150, 300]);
    expect(rowAtTop(list, 0)?.key).toBe("r0");
    expect(rowAtTop(list, 99)?.key).toBe("r0");
    // A row with less than a pixel left in view does not count as the top any more.
    expect(rowAtTop(list, 99.5)?.key).toBe("r1");
    expect(rowAtTop(list, 250)?.key).toBe("r1");
    expect(rowAtTop(list, 300)?.key).toBe("r2");
    expect(rowAtTop(list, 1000)).toBeNull();
    expect(rowAtTop([], 0)).toBeNull();
  });

  test("its place in the view: how far its top is below the view's top line", () => {
    const [, second] = rows([100, 200]);
    // Scrolled 140 px, with a 60 px header floating over the list: the line is at 200, the row's top at 100.
    expect(viewAnchor(second!, 140, 60)).toEqual({ key: "r1", offset: -100 });
    expect(viewAnchor(second!, 40, 60)).toEqual({ key: "r1", offset: 0 });
  });
});

describe("keeping it there", () => {
  test("rows put above it move the scroll by their height, so it does not move on screen", () => {
    // The reader is 30 px into row r2, whose top is at 300 in the content; three new rows of 120 px go above.
    expect(anchoredScroll(330, 300, 300 + 360)).toBe(690);
    // A row above drawn at its real height, 40 px shorter than guessed.
    expect(anchoredScroll(690, 660, 620)).toBe(650);
    // Nothing moved: nothing changes.
    expect(anchoredScroll(500, 300, 300)).toBe(500);
    // Never above the top of the list.
    expect(anchoredScroll(10, 300, 200)).toBe(0);
  });

  test("a row is shown at the top by scrolling to its top less the header's room and its offset", () => {
    expect(scrollToShow(900, 60)).toBe(840);
    expect(scrollToShow(900, 60, -100)).toBe(940);
    // Clamped to what the list can scroll.
    expect(scrollToShow(30, 60)).toBe(0);
    expect(scrollToShow(5000, 0, 0, 3200)).toBe(3200);
  });

  test("the web keeper corrects the scroll node itself, with the browser's own anchoring off, and native leaves it to FlatList", () => {
    const web = readFileSync(path.join(SRC, "components", "list", "anchor.web.ts"), "utf8");
    expect(web).toContain('overflowAnchor = "none"');
    expect(web).toContain("new MutationObserver(");
    expect(web).toContain("new ResizeObserver(");
    const native = readFileSync(path.join(SRC, "components", "list", "anchor.ts"), "utf8");
    expect(native).toContain("maintainVisibleContentPosition: { minIndexForVisible: 1 }");
  });
});
