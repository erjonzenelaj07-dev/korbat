import { CaseDecidedParams, MEASURES, ORDER_DRAFTS, ORDER_GROUND_LABELS, ORDER_RULES, SOURCE_LABELS, type CaseView, type StaffMe, type StaffOverview } from "@korbat/contracts";
import { ORDER_NOTICE } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { complete, correctable, decisionParamsOf, newDraft, reinstatable, reinstateDraft, reinstateGroundOf, withReinstateGround } from "../src/compose";
import { DECISION_KINDS, messageFor, ORDER_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { ComposerView, type ComposerViewProps } from "../src/screens/Composer";
import { AuthoritiesLines } from "../src/screens/Home";
import { bothTimes, dateTime } from "../src/ui";
import { decision, item, NO_STANDING, postCase } from "./case-fixtures";

/**
 * A case that holds an order's measure (3f design, section 8.6, Task 3), server-rendered: the order's item with its
 * source and its order's link, the decision "Order" with "Disabled for an order" and whether it is withheld from its
 * author, [case.preserved], [case.own] and [case.heldToo] on the page and in the confirmation, "Reinstate" greyed for a
 * moderator and live for an admin, the reinstatement's fixed reason and preview, and the params its key confirms; and
 * Home's [home.unverified].
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
const caseId = (id: string) => parseCaseId(id)!;
const NOW = new Date("2026-10-16T09:30:00.000Z");
const MODERATOR: StaffMe["role"] = "moderator";
const ADMIN: StaffMe["role"] = "admin";
const ORDER = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const ORDER_DECISION = "2d3e4f5a-6b7c-4d8e-9fa0-1b2c3d4e5f6a";
const ORDER_ITEM = "3e4f5a6b-7c8d-4e9f-a0b1-2c3d4e5f6a7b";
const UNTIL = "2026-11-27T09:00:00.000Z";

/** A post case under a removal order: its item from the authority, answered at once, and the order decision in force. */
function orderCase(overrides: Partial<CaseView> = {}): CaseView {
  const base = postCase();
  return {
    ...base,
    items: [
      item({
        id: ORDER_ITEM,
        seq: 3,
        outcome: "restricted_legal",
        answeredBy: ORDER_DECISION,
        source: { kind: "authority", label: SOURCE_LABELS.authority, accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null, named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false },
        orderId: ORDER,
        explanation: null,
        markable: false,
      }),
    ],
    decisions: [
      decision({
        id: ORDER_DECISION,
        kind: "order",
        source: "order",
        ground: "illegal",
        ruleId: null,
        facts: null,
        reason: null,
        actions: [{ id: "4f5a6b7c-8d9e-4fa0-b1c2-3d4e5f6a7b8c", kind: "disable_by_order", mediaId: null, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, sealed: null, ...NO_STANDING, orderId: ORDER, withholdAuthor: true }],
      }),
    ],
    preserved: true,
    noticeHeld: { until: UNTIL },
    ...overrides,
  };
}

const base: Omit<CaseScreenViewProps, "caseId" | "view"> = {
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

function composeFor(view: CaseView, role: StaffMe["role"]): NonNullable<CaseScreenViewProps["compose"]> {
  return {
    role,
    draft: newDraft(caseId(view.id), view, role),
    now: NOW,
    busy: false,
    error: null,
    textErrors: {},
    declining: null,
    onChange: noop,
    onTextBlur: noop,
    onSeal: noop,
    onConfirm: noop,
    onDeclineOpen: noop,
    onDeclineChange: noop,
    onDeclineSave: noop,
    onDeclineClose: noop,
    onCancelCorrection: noop,
    onCorrect: noop,
    onReview: noop,
    onAnswer: noop,
    onWithdraw: noop,
    onWithdrawMarks: noop,
    onReinstate: noop,
  };
}

const page = (view: CaseView, extra: Partial<CaseScreenViewProps> = {}) => html(<CaseScreenView {...base} caseId={caseId(view.id)} view={view} {...extra} />);

describe("a case that holds an order's measure (8.6)", () => {
  test("the item: the authority's order as its source, a link to the order, no reveal and no mark; the decision Order, its measure in force and withheld from its author", () => {
    const view = orderCase();
    const out = page(view, { onOpenOrder: noop });
    expect(text(out)).toContain(`Source: ${SOURCE_LABELS.authority}`);
    expect(out).toContain(`href="/orders/${ORDER}"`);
    expect(text(out)).toContain("an authority's order");
    expect(text(out)).not.toContain("Reveal who sent this");
    expect(out).toContain(`<strong>${DECISION_KINDS.order}</strong>`);
    expect(text(out)).toContain(`${MEASURES.disable_by_order.label}: in force; ${ORDER_WORDS.caseOrder.withheld}`);
    const shown = orderCase({ decisions: [{ ...view.decisions[0]!, actions: [{ ...view.decisions[0]!.actions[0]!, withholdAuthor: false }] }] });
    expect(text(page(shown))).toContain(ORDER_WORDS.caseOrder.shown);
  });

  test("[case.preserved], [case.own] and [case.heldToo] on the page, the hold's end printed, or none recorded", () => {
    const out = text(page(orderCase()));
    expect(out).toContain(ORDER_WORDS.caseOrder.preserved);
    expect(out).toContain(ORDER_WORDS.caseOrder.own);
    expect(out).toContain(ORDER_WORDS.caseOrder.heldToo(dateTime(UNTIL)));
    expect(text(page(orderCase({ noticeHeld: { until: null } })))).toContain("at a time that is not recorded yet");
    const plain = text(page(orderCase({ preserved: false, noticeHeld: null, decisions: [] })));
    expect(plain).not.toContain(ORDER_WORDS.caseOrder.preserved);
    expect(plain).not.toContain(ORDER_WORDS.caseOrder.own);
    expect(plain).not.toContain("must not be told");
  });

  test("Reinstate beside the measure: greyed for a moderator with admin_required's words, live for an admin; no Correct this decision", () => {
    const view = orderCase();
    const moderator = page(view, { compose: composeFor(view, MODERATOR) });
    expect(moderator).toMatch(/<button type="button" disabled="">Reinstate<[/]button>/);
    expect(text(moderator)).toContain(messageFor("admin_required"));
    const admin = page(view, { compose: composeFor(view, ADMIN) });
    expect(admin).toMatch(/<button type="button">Reinstate<[/]button>/);
    expect(correctable(view, view.decisions[0]!, ADMIN)).toBeNull();
    // A lifted measure offers nothing.
    expect(reinstatable({ ...view.decisions[0]!, actions: [{ ...view.decisions[0]!.actions[0]!, inForce: false }] })).toBeNull();
  });

  test("the reinstatement: a ground chosen, its fixed reason shown and never a field, the notice's paragraphs as the preview, [case.heldToo] and [reinstate.fake] in the confirmation", () => {
    const view = orderCase();
    const opened = reinstateDraft(caseId(view.id), view, view.decisions[0]!, ADMIN);
    expect(reinstateGroundOf(opened)).toBeNull();
    expect(complete(view, opened)).toBe(false);
    const draft = withReinstateGround(opened, "not_authentic");
    expect(draft.written.review_reason).toBe(ORDER_DRAFTS.reinstate.not_authentic);
    expect(complete(view, draft)).toBe(true);
    const props: ComposerViewProps = { view, role: ADMIN, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop };
    const out = html(<ComposerView {...props} />);
    const read = text(out);
    for (const ground of ["withdrawn", "annulled", "scrutiny", "not_authentic", "wrong_item"] as const) expect(read).toContain(ORDER_GROUND_LABELS[ground]);
    expect(read).toContain(ORDER_WORDS.caseOrder.reinstateWhat);
    expect(read).toContain(ORDER_WORDS.caseOrder.reinstateFake);
    expect(read).toContain(ORDER_NOTICE.reinstated.ground.not_authentic);
    expect(read).toContain(ORDER_NOTICE.lifted);
    expect(read).toContain(ORDER_WORDS.caseOrder.heldToo(dateTime(UNTIL)));
    expect(read).toContain(ORDER_WORDS.caseOrder.reinstateButton);
    expect(out).not.toContain("<textarea");
    // Without a hold, no [reinstate.fake] and no [case.heldToo].
    const told = text(html(<ComposerView {...props} view={orderCase({ noticeHeld: null })} />));
    expect(told).not.toContain(ORDER_WORDS.caseOrder.reinstateFake);
    expect(told).not.toContain("must not be told");    expect(read).not.toContain("restores nothing");
    expect(read).toContain(ORDER_NOTICE.reinstated.now);
    // Task 4 ([reinstate.erased]): once the preservation's end erased the post, reinstating restores nothing, and the
    // preview's paragraph says so with the day.
    const erased = text(html(<ComposerView {...props} view={orderCase({ orderErasedOn: "2027-04-17" })} />));
    expect(erased).toContain(ORDER_WORDS.caseOrder.reinstateErased("2027-04-17"));
    expect(erased).toContain(ORDER_NOTICE.reinstated.erased("2027-04-17"));
    expect(erased).not.toContain(ORDER_NOTICE.reinstated.now);
  });

  test("the params the key confirms: a correction that reverses the order decision whole, its one action signing the ground, the reason's digest", () => {
    const view = orderCase();
    const draft = withReinstateGround(reinstateDraft(caseId(view.id), view, view.decisions[0]!, ADMIN), "withdrawn");
    const params = decisionParamsOf(view, draft, { snapshot: "ab".repeat(32), facts: null, reason: "bb".repeat(32), legalReference: null });
    expect(params).toMatchObject({
      kind: "correction",
      reviewsDecisionId: ORDER_DECISION,
      outcome: "reversed",
      actions: [{ kind: "reinstate_by_order", mediaId: null, orderGround: "withdrawn" }],
      reasonDigest: "bb".repeat(32),
      factsDigest: null,
    });
    expect(CaseDecidedParams.safeParse(params).success).toBe(true);
  });
});

describe("Home's [home.unverified] (8.2)", () => {
  const overview = (ordersUnverified: StaffOverview["ordersUnverified"]) =>
    ({
      contact: { open: 0, oldestAt: null, dueAt: null },
      alerts: { channel: "ok", since: null },
      ordersUnverified,
      reportsOwed: { total: 0, items: [] },
    }) as unknown as StaffOverview;

  test("the count, and each order a link built from its checked id; nothing when none", () => {
    const out = html(<AuthoritiesLines overview={overview({ total: 2, items: [{ orderId: ORDER, effectAt: UNTIL }, { orderId: ORDER.toUpperCase(), effectAt: UNTIL }] })} now={NOW.getTime()} onOpenOrder={noop} />);
    expect(text(out)).toContain(ORDER_WORDS.homeUnverified(2));
    expect(text(out)).toContain(`Given effect at ${bothTimes(UNTIL)}`);
    expect(out.match(/href="[^"]+"/g)).toEqual([`href="/orders/${ORDER}"`]);
    expect(html(<AuthoritiesLines overview={overview({ total: 0, items: [] })} now={NOW.getTime()} />)).toBe("");
  });
});

describe("Task 5: Home's [home.owed] (8.2) and the case page's line (8.6)", () => {
  const CASE_OWED = "3a0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const overview = (reportsOwed: StaffOverview["reportsOwed"]) =>
    ({
      contact: { open: 0, oldestAt: null, dueAt: null },
      alerts: { channel: "ok", since: null },
      ordersUnverified: { total: 0, items: [] },
      reportsOwed,
    }) as unknown as StaffOverview;
  const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

  test("one line a case, each a link to it: since when; after reportAlertHours the daily alert's sentence too; nothing when none is owed", () => {
    const fresh = hoursBefore(ORDER_RULES.reportAlertHours - 1);
    const late = hoursBefore(ORDER_RULES.reportAlertHours + 1);
    const out = html(
      <AuthoritiesLines
        overview={overview({ total: 2, items: [{ caseId: CASE_OWED, kind: "sealed_images", since: late }, { caseId: CASE_OWED.toUpperCase(), kind: "dsa18_1", since: fresh }] })}
        now={NOW.getTime()}
        onOpenCase={noop}
      />,
    );
    expect(text(out)).toContain(ORDER_WORDS.homeOwed(bothTimes(late), true));
    expect(text(out)).toContain(ORDER_WORDS.homeOwed(bothTimes(fresh), false));
    expect(ORDER_WORDS.homeOwed("x", true)).toBe(
      `A report to the authorities is owed since x. More than ${ORDER_RULES.reportAlertHours} hours: every staff account is alerted daily until whoever has the server records it as sent or declined.`,
    );
    // The link is built from the checked id alone: an id that does not parse is printed without one.
    expect(out.match(/href="[^"]+"/g)).toEqual([`href="/cases/${CASE_OWED}"`]);
    // Nothing of a notification but the case, the time and that it is owed: no kind, no authority.
    expect(text(out)).not.toMatch(/sealed_images|dsa18|authority named|BKA/);
    expect(html(<AuthoritiesLines overview={overview({ total: 0, items: [] })} now={NOW.getTime()} />)).toBe("");
  });

  test("the case page says since when a report is owed for the case, and nothing while none is", () => {
    const since = hoursBefore(3);
    expect(text(page(postCase({ reportOwed: { since } })))).toContain(ORDER_WORDS.caseOwed(bothTimes(since)));
    expect(text(page(postCase()))).not.toContain("A report to the authorities is owed");
  });
});
