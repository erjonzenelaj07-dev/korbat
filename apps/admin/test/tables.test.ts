import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * A time in a table cell keeps its line from 600 px, where tables are dense rows (UI design, section 9). UI Task 10's
 * walk-through found Appeals at 1280 by 900 breaking its Filed and window times at their hyphen ("2026-10-" over
 * "20 13:56"), since only the audit log's times were kept whole; a date cut in two reads as two values. Below 600 px a
 * table is a stack of blocks and a time wraps with its sentence.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** The stylesheet without its comments. */
const stylesheet = (): string => readFileSync(path.join(SRC, "app.css"), "utf8").replace(/[/][*][^]*?[*][/]/g, "");

/** The body of the one `@media (min-width: 600px)` block, from its brace to the brace that closes it. */
function denseBlock(css: string): string {
  const open = css.indexOf("{", css.indexOf("@media (min-width: 600px) {"));
  let depth = 0;
  for (let i = open; i >= 0 && i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  return "";
}

/** The selectors of a block's rules that set white-space: nowrap. */
function nowrapSelectors(block: string): string[] {
  const found: string[] = [];
  for (const match of block.matchAll(/([^{}]+)[{]([^{}]*)[}]/g)) {
    if (/white-space *: *nowrap/.test(match[2]!)) found.push(...match[1]!.split(",").map((selector) => selector.trim().replace(/ +/g, " ")));
  }
  return found;
}

describe("a time in a table cell keeps its line from 600 px", () => {
  test("the dense tables' block keeps every time in a cell on one line, not only the audit log's", () => {
    expect(denseBlock(stylesheet())).not.toBe("");
    expect(nowrapSelectors(denseBlock(stylesheet()))).toContain("td time");
  });

  test("the tables that hold times draw them as time elements inside their cells, which that rule reaches", () => {
    // Appeals' Filed and window ends, the audit log's times and the queue's waiting time.
    for (const [file, cells] of [
      ["Appeals.tsx", 2],
      ["Audit.tsx", 1],
      ["Queue.tsx", 1],
    ] as const) {
      const lines = readFileSync(path.join(SRC, "screens", file), "utf8").split(String.fromCharCode(10));
      // A time element that opens the line after a cell's own opening tag.
      const inCells = lines.filter((line, at) => at > 0 && line.trim().startsWith("<time ") && /^<td[^>]*>$/.test(lines[at - 1]!.trim()));
      expect(inCells.length, file).toBeGreaterThanOrEqual(cells);
    }
  });
});
