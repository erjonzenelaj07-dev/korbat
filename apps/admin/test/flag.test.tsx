import { SIGNAL_RULES, type CaseView } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AUTOMATION_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { marksOf } from "../src/screens/Queue";
import { item, postCase, queueRow } from "./case-fixtures";

/**
 * The flag "possible coordinated reporting" on the console (3d design, sections 7.13, 8.3, 8.4 and 8.9; Task 8),
 * server-rendered: the queue's chip [queue.flag], which moves nothing; the case's chip and line [case.flag] under its
 * header, whose minutes and share are SIGNAL_RULES' and whose counts are the answer's; and [case.sameSource] on an item
 * whose reporter has other open items. Neither names a reporter or a case.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const text = (out: string) =>
  out
    .replace(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const noop = () => undefined;

/** The case page's other props, as the case tests give them. */
const caseProps: Omit<CaseScreenViewProps, "caseId" | "view"> = {
  shownImage: null,
  busy: null,
  notice: null,
  error: null,
  note: "",
  reveal: null,
  onOpenCase: noop,
  onShowImage: noop,
  onShowClearly: noop,
  onHideImage: noop,
  onImageError: noop,
  onSnapshot: noop,
  onNoteChange: noop,
  onNoteSave: noop,
  onRevealOpen: noop,
  onRevealChange: noop,
  onRevealConfirm: noop,
  onRevealClose: noop,
};
/** The case page's text as a reader sees it. */
const page = (view: CaseView): string => text(html(<CaseScreenView {...caseProps} caseId={parseCaseId(view.id)!} view={view} />));

describe("the flag's words (8.3, 8.4)", () => {
  test("[queue.flag] and [case.flag] say what the design says, every number from SIGNAL_RULES or the answer, and name no reporter", () => {
    expect(AUTOMATION_WORDS.queueFlag).toBe("Possible coordinated reporting");
    expect(AUTOMATION_WORDS.caseFlag(6, 5)).toBe(
      `Many reports in a short time from accounts that are linked: 6 unanswered reports from 5 accounts within ${SIGNAL_RULES.windowMinutes} minutes, and at least half of those accounts follow one another. This is not a finding: decide the content as always.`,
    );
    expect(AUTOMATION_WORDS.sameSource(3)).toBe("3 other open items from this source.");
    expect(AUTOMATION_WORDS.sameSource(1)).toBe("1 other open item from this source.");
  });

  test("the share is printed from SIGNAL_RULES.linkedShare: half as a word", () => {
    expect(SIGNAL_RULES.linkedShare).toBe(0.5);
    expect(AUTOMATION_WORDS.caseFlag(5, 5)).toContain("at least half of those accounts");
  });
});

describe("the queue (8.3)", () => {
  test("a flagged case carries the chip, and it is no key of the order: the marks of a row say what it carries and nothing sorts by them", () => {
    expect(marksOf(queueRow({ flag: { items: 6, reporters: 5 } }))).toContain(AUTOMATION_WORDS.queueFlag);
    expect(marksOf(queueRow({ flag: null }))).not.toContain(AUTOMATION_WORDS.queueFlag);
  });
});

describe("a case (8.4)", () => {
  test("[case.flag] stands under the header with the chip while the answer carries the flag, and not otherwise", () => {
    const flagged = page(postCase({ flag: { items: 7, reporters: 5 } }));
    expect(flagged).toContain(AUTOMATION_WORDS.queueFlag);
    expect(flagged).toContain(AUTOMATION_WORDS.caseFlag(7, 5));
    // Under the header: before the evidence.
    expect(flagged.indexOf(AUTOMATION_WORDS.caseFlag(7, 5))).toBeLessThan(flagged.indexOf("Evidence"));
    const plain = page(postCase({ flag: null }));
    expect(plain).not.toContain(AUTOMATION_WORDS.queueFlag);
    expect(plain).not.toContain("Many reports in a short time");
  });

  test("[case.sameSource] stands on an item whose reporter has other open items, as a count, and on no other", () => {
    const view = postCase();
    const out = page({ ...view, items: [item({ ...view.items[0]!, sameSourceOpen: 2 }), ...view.items.slice(1).map((other) => ({ ...other, sameSourceOpen: 0 }))] });
    expect(out).toContain(AUTOMATION_WORDS.sameSource(2));
    expect(out.split("other open item").length - 1).toBe(1);
    expect(page({ ...view, items: view.items.map((other) => ({ ...other, sameSourceOpen: 0 })) })).not.toContain("other open item");
  });
});
