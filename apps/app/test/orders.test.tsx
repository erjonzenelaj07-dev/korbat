import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { DecisionView, type AuthorCaseRow, type OrderNoticeFacts } from "@korbat/contracts";
import { ORDER_NOTICE, statementParagraphs } from "@korbat/rules";
import { DecisionsList } from "../src/components/moderation/CasesLists";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { messageFor } from "../src/lib/api";
import { chipText } from "../src/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "../src/lib/moderation-words";
import { NOT_APPEALABLE, ORDER_TEXTS } from "../src/lib/orders";

/**
 * The app's part of an authority's order (3f design, section 9, Task 3), server-rendered with made-up answers: the notice
 * on the decision's screen (its title, ORDER_NOTICE's paragraphs, the authority's words in their own block, no post and
 * no appeal, [notice.wrongItem] and [notice.fresh]), the reinstatement's notice, the row on Cases in its own words and
 * without a rule, the chip [chip.order], and the words of not_appealable.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/settings/cases",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => ({ status: "signed-out" }) }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/ {2,}/g, " ")
    .trim();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DISABLED_AT = "2026-10-16T09:00:00.000Z";

const facts: OrderNoticeFacts = {
  kind: "tco_removal",
  memberState: "DE",
  authority: "Bundeskriminalamt (BKA)",
  reference: "BKA-2026-1",
  verified: true,
  orderedOn: "2026-10-16",
  orderedFrom: "received",
  crossBorder: false,
  homeState: "DE",
  withholdAuthor: true,
  disabledAt: DISABLED_AT,
  held: false,
  informedAt: DISABLED_AT,
  holdEndReason: null,
  preserveUntil: "2027-04-17T09:00:00.000Z",
  preserveExtended: false,
  preserveEndedOn: null,
  orderGround: null,
};

const notice = (extra: Partial<DecisionView> = {}): DecisionView => ({
  id: id(3),
  kind: "order",
  outcome: "restricted",
  ground: "illegal",
  ruleId: null,
  rulesVersion: 3,
  redressVersion: 3,
  legalReference: null,
  facts: null,
  reason: null,
  source: "order",
  decidedAt: DISABLED_AT,
  post: { id: id(1), createdAt: "2026-10-01T08:30:00.000Z" },
  measures: [{ kind: "disable_by_order", mediaId: null, noEffect: null, sealed: null }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
  order: facts,
  appealUntil: null,
  reversedOn: null,
  content: null,
  appeal: null,
  strike: null,
  standing: null,
  orderTexts: { reasons: "Der Beitrag ruft zu Gewalt auf.", redress: "Klage beim Verwaltungsgericht Wiesbaden.", scope: null, textsAt: DISABLED_AT },
  erasedOn: null,
  ...extra,
});

describe("the notice of an authority's order (9.3)", () => {
  test("titled as a notice, its paragraphs ORDER_NOTICE's, the authority's words whole in their own labelled block, no post, no appeal, and the app's three sentences", () => {
    const view = notice();
    expect(DecisionView.safeParse(view).success).toBe(true);
    const out = html(<DecisionDetail view={view} onAppeal={async () => undefined} />);
    const read = textOf(out);
    expect(out).toContain('role="article"');
    expect(out).toMatch(/aria-level="1"[^>]*>Notice: an authority&#x27;s order</);
    for (const paragraph of statementParagraphs(view, { texts: view.orderTexts ?? null, erasedOn: null })) expect(read).toContain(paragraph);
    expect(out).toContain(`aria-label="${ORDER_NOTICE.wordsBlock.replace("'", "&#x27;")}"`);
    expect(read).toContain(`${ORDER_NOTICE.reasonsLabel} Der Beitrag ruft zu Gewalt auf.`);
    expect(read).toContain(`${ORDER_NOTICE.redressLabel} Klage beim Verwaltungsgericht Wiesbaden.`);
    expect(read).not.toContain(ORDER_NOTICE.scopeLabel);
    expect(read).toContain(ORDER_TEXTS.notice.noContent);
    expect(read).toContain(ORDER_TEXTS.notice.noAppeal);
    expect(read).toContain("If the order does not name this post, korbat made a mistake that it can correct itself.");
    expect(read).toContain(ORDER_TEXTS.notice.fresh);
    expect(read).not.toContain(DECISION_WORDS.appeal);
    // The heading is the notice's, never "korbat's decision" (the notice's own paragraphs say that it is not korbat's).
    expect(out).not.toMatch(new RegExp(`aria-level="2"[^>]*>${DECISION_WORDS.title.replace("'", "&#x27;")}<`));
  });

  test("without the authority's words, no block; the notice says they follow", () => {
    const read = textOf(html(<DecisionDetail view={notice({ orderTexts: { reasons: null, redress: null, scope: null, textsAt: null } })} />));
    expect(read).not.toContain(ORDER_NOTICE.wordsBlock);
    expect(read).toContain(ORDER_NOTICE.textsFollow);
  });

  test("the reinstatement's notice: its ground's paragraph, the post shown again, no [notice.wrongItem]", () => {
    const view = notice({
      kind: "correction",
      outcome: "reversed",
      reviewsDecisionId: id(3),
      measures: [],
      reversals: [{ kind: "reinstate_by_order", mediaId: null, liftedKind: "disable_by_order", noEffect: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null }],
      order: { ...facts, orderGround: "withdrawn" },
      content: { kind: "post", body: "the words of the post", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
    } as unknown as Partial<DecisionView>);
    const read = textOf(html(<DecisionDetail view={view} />));
    expect(read).toContain(ORDER_NOTICE.reinstated.ground.withdrawn);
    expect(read).toContain(ORDER_NOTICE.lifted);
    expect(read).toContain("the words of the post");
    expect(read).not.toContain("If the order does not name this post");
  });
});

describe("Cases, the chip and the error (9.1, 9.3, 9.4)", () => {
  const row = (extra: Partial<AuthorCaseRow>): AuthorCaseRow => ({
    id: id(3),
    kind: "order",
    outcome: "restricted",
    decidedOn: "2026-10-16",
    post: { id: id(1), createdAt: "2026-10-01T08:30:00.000Z" },
    actions: ["disable_by_order"],
    endedInterim: false,
    ruleId: null,
    legal: true,
    appealUntil: null,
    reversedOn: null,
    appeal: null,
    strike: null,
    ...extra,
  });

  test("a row in its own words, and never a rule or the law of korbat's judgement", () => {
    const read = textOf(html(<DecisionsList decisions={[row({ order: "disabled" }), row({ id: id(4), order: "removed" }), row({ id: id(5), kind: "correction", outcome: "reversed", actions: ["reinstate_by_order"], order: "lifted" })]} />));
    expect(read).toContain(ORDER_TEXTS.row.disabled);
    expect(read).toContain(ORDER_TEXTS.row.removed);
    expect(read).toContain(ORDER_TEXTS.row.lifted);
    expect(read).not.toContain(CASES_WORDS.law);
  });

  test("[chip.order] on a post a DSA order removed without withholding it; not_appealable in [notice.noAppeal]'s first words", () => {
    expect(chipText({ decisionId: id(3), ruleId: null, legal: true, interim: false, strikeUntil: null, order: true })).toBe("Removed: an authority's order");
    expect(chipText({ decisionId: id(3), ruleId: null, legal: true, interim: false, strikeUntil: null })).not.toBe(ORDER_TEXTS.chip.order);
    expect(messageFor("not_appealable")).toBe(NOT_APPEALABLE);
    expect(ORDER_TEXTS.notice.noAppeal.startsWith(NOT_APPEALABLE)).toBe(true);
  });
});
