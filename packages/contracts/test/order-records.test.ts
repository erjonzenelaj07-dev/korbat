import { describe, expect, test } from "vitest";
import {
  ANNEX3_GROUNDS,
  ANNEX3_GROUND_LABELS,
  EU_MEMBER_STATES,
  HOLD_BASES,
  HOLD_END_REASONS,
  HOLD_END_REASON_LABELS,
  ModerationErrorCode,
  ORDER_ACTION_KINDS,
  ORDER_CHANNELS,
  ORDER_CHANNEL_LABELS,
  ORDER_CLI_EVENTS,
  ORDER_CLOSE_GROUNDS,
  ORDER_CONSOLE_EVENTS,
  ORDER_CORRECTION_RULES,
  ORDER_EVENT_GROUNDS,
  ORDER_EVENT_KINDS,
  ORDER_EVENT_WORDS,
  ORDER_GROUNDS,
  ORDER_GROUND_LABELS,
  ORDER_ITEMS_MAX,
  ORDER_ITEM_CLOSE_REASONS,
  ORDER_ITEM_CLOSE_REASON_LABELS,
  ORDER_ITEM_PREVIEW,
  ORDER_KINDS,
  ORDER_KIND_LABELS,
  ORDER_LINK_KINDS,
  ORDER_RULES,
  ORDER_SCRUTINY_HOURS,
  ORDER_STATES,
  OrderCorrectRequest,
  OrderCorrectedParams,
  OrderEventRecordedParams,
  OrderItemsRequest,
  OrderOpenRequest,
  OrderView,
  OrdersPage,
  SCRUTINY_OUTCOMES,
  SCRUTINY_OUTCOME_LABELS,
  STAFF_STEP_UP_ACTIONS,
  STATE_FACTS,
  StaffMe,
  StaffStepUpOptionsRequest,
  TELL_PERSON_RULES,
} from "../src/index";

/**
 * Order records and the clock (3f design, sections 6.2, 10.1 to 10.3 and 18, W.1): the closed lists in the one spelling
 * the database's CHECKs share, the requests and their refinements, the two step-up actions of Task 2 and the answers.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const open = (over: Record<string, unknown> = {}) => ({
  messageId: uuid(1),
  channel: "mailbox",
  kind: "tco_removal",
  memberState: "DE",
  authority: "Bundeskriminalamt",
  reference: "TCO-2026/0001",
  links: ["https://korbat.example/post/" + uuid(2)],
  sectionC: false,
  emergency: false,
  withholdFromAuthor: true,
  ...over,
});

describe("the closed lists (10.1), each in the spelling of 6.2's CHECKs", () => {
  test("the kinds of order, how one arrived, and what a link names", () => {
    expect(ORDER_KINDS).toEqual(["tco_removal", "dsa_art9", "dsa_art10"]);
    expect(ORDER_CHANNELS).toEqual(["mailbox", "portal", "post", "other"]);
    expect(ORDER_LINK_KINDS).toEqual(["post", "image", "account", "other"]);
  });

  test("the console's eight events and the command line's seventeen, reopened and hold_extended in both", () => {
    expect(ORDER_CONSOLE_EVENTS).toEqual(["annex3_sent", "grounds_ceased", "clarification_received", "annex2_sent", "receipt_confirmed", "closed_without_effect", "reopened", "hold_extended"]);
    expect(ORDER_CLI_EVENTS).toEqual([
      "verified",
      "issued_at_set",
      "texts_recorded",
      "document_recorded",
      "received_set",
      "sent_at_set",
      "due_set",
      "hold_extended",
      "hold_ended",
      "hold_until_set",
      "preservation_extended",
      "scrutiny_requested",
      "scrutiny_decided",
      "reopened",
      "tell_person_set",
      "person_told",
      "imported",
    ]);
    // Every kind of the table of 6.2: the two lists and the six the database alone writes, each once.
    const database = ["opened", "corrected", "effect_given", "reinstated", "notice_released", "preservation_ended"];
    expect([...ORDER_EVENT_KINDS].sort()).toEqual([...new Set([...ORDER_CONSOLE_EVENTS, ...ORDER_CLI_EVENTS, ...database])].sort());
  });

  test("the grounds of each kind of event, and null for a kind without one", () => {
    expect(ANNEX3_GROUNDS).toEqual(["force_majeure", "manifest_error", "insufficient_information"]);
    expect(ORDER_GROUNDS).toEqual(["withdrawn", "annulled", "scrutiny", "not_authentic", "wrong_item"]);
    expect(ORDER_CLOSE_GROUNDS).toEqual([...ORDER_GROUNDS, "not_addressed"]);
    expect(ORDER_CORRECTION_RULES).toEqual(["entry", "caution", "admin"]);
    expect(HOLD_END_REASONS).toEqual(["not_authentic", "annulled", "released_by_authority", "not_ordered"]);
    expect(SCRUTINY_OUTCOMES).toEqual(["upheld", "annulled"]);
    expect(ORDER_EVENT_GROUNDS).toEqual({
      annex3_sent: ANNEX3_GROUNDS,
      closed_without_effect: ORDER_CLOSE_GROUNDS,
      corrected: ORDER_CORRECTION_RULES,
      reinstated: ORDER_GROUNDS,
      hold_ended: HOLD_END_REASONS,
      scrutiny_decided: SCRUTINY_OUTCOMES,
    });
    for (const kind of Object.keys(ORDER_EVENT_GROUNDS)) expect(ORDER_EVENT_KINDS, kind).toContain(kind);
  });

  test("an item's closing reasons, the hold's bases, the rules for telling a person, an order's states", () => {
    expect(ORDER_ITEM_CLOSE_REASONS).toEqual(["no_post", "not_named", "withdrawn"]);
    expect(HOLD_BASES).toEqual(["regulation", "authority"]);
    expect(TELL_PERSON_RULES).toEqual(["at_effect", "at_instant", "never"]);
    expect(ORDER_STATES).toEqual(["running", "stopped", "overdue", "unknown_deadline", "given_effect", "closed", "no_clock"]);
  });

  test("the two kinds of the ledger the migration orders adds, which Task 3 joins to ACTION_KINDS", () => {
    expect(ORDER_ACTION_KINDS).toEqual(["disable_by_order", "reinstate_by_order"]);
  });

  test("the bounds of 10.1's Others", () => {
    expect(ORDER_ITEMS_MAX).toBe(50);
    expect(ORDER_ITEM_PREVIEW).toBe(80);
    expect(ORDER_SCRUTINY_HOURS).toBe(48);
  });
});

describe("the labels (W.1)", () => {
  test("each list has a label for each value, in the words of sections 8 and 18", () => {
    expect(ORDER_KIND_LABELS).toEqual({
      tco_removal: "Removal order (terrorist content)",
      dsa_art9: "Order to act against content (DSA Article 9)",
      dsa_art10: "Order to provide information (DSA Article 10)",
    });
    expect(ANNEX3_GROUND_LABELS).toEqual({
      force_majeure: "Force majeure or impossibility not korbat's fault (Article 3(7))",
      manifest_error: "The order has manifest errors (Article 3(8))",
      insufficient_information: "The order lacks information (Article 3(8))",
    });
    expect(ORDER_GROUND_LABELS).toEqual({
      withdrawn: "The authority withdrew the order",
      annulled: "A court annulled the order",
      scrutiny: "The home authority's scrutiny found that the order infringes (Article 4)",
      not_authentic: "The order was not authentic",
      wrong_item: "korbat's mistake: the order does not name this post",
      not_addressed: "It is not addressed to korbat",
    });
    expect(HOLD_END_REASON_LABELS).toEqual({
      not_authentic: "The order was not authentic",
      annulled: "A court annulled the order",
      released_by_authority: "The authority released it",
      not_ordered: "korbat's mistake: the order had no non-disclosure decision",
    });
    expect(SCRUTINY_OUTCOME_LABELS).toEqual({ upheld: "upheld: the order stands", annulled: "annulled: the order infringes" });
    expect(ORDER_ITEM_CLOSE_REASON_LABELS).toEqual({
      no_post: "The link names nothing korbat can disable for an order",
      not_named: "korbat's mistake: the order does not name this link",
      withdrawn: "The authority withdrew this item",
    });
    expect(ORDER_CHANNEL_LABELS).toEqual({
      mailbox: "By mail to the contact point: it is in the mailbox and not in this list",
      portal: "Through a portal",
      post: "By post or in person",
      other: "Another way",
    });
  });

  test("every kind of event has its phrase, and the correction's names its rule", () => {
    for (const kind of ORDER_EVENT_KINDS) expect(typeof ORDER_EVENT_WORDS[kind], kind).toBe("string");
    expect(ORDER_EVENT_WORDS.opened).toBe("Order opened");
    expect(ORDER_EVENT_WORDS.annex3_sent).toBe("Annex III sent: {ground}");
    expect(ORDER_EVENT_WORDS.clarification_received).toBe("Clarification received: a fresh hour from {effectiveAt}");
    expect(ORDER_EVENT_WORDS.corrected).toBe("The record corrected: {rule}");
    expect(ORDER_EVENT_WORDS.imported).toBe("Written again after a restore");
  });
});

describe("STATE_FACTS (10.1) and the member states", () => {
  test("the 27 member states by code, and Germany's entry as the worked example", () => {
    expect(Object.keys(EU_MEMBER_STATES)).toHaveLength(27);
    for (const code of Object.keys(EU_MEMBER_STATES)) expect(code).toMatch(/^[A-Z]{2}$/);
    const de = STATE_FACTS.DE!;
    expect(de.name).toBe("Germany");
    expect(de.authorities.length).toBeGreaterThan(0);
    for (const authority of de.authorities) expect(authority.id).toMatch(/^[a-z0-9_]+$/);
    expect(de.tellPersonDefault).toBe("never");
    for (const [code, facts] of Object.entries(STATE_FACTS)) {
      expect(Object.keys(EU_MEMBER_STATES), code).toContain(code);
      expect(facts.name).toBe(EU_MEMBER_STATES[code as keyof typeof EU_MEMBER_STATES]);
    }
  });
});

describe("OrderOpenRequest (10.2)", () => {
  test("a removal order from a message, and one opened without a message with the channel the person picked", () => {
    expect(OrderOpenRequest.safeParse(open()).success).toBe(true);
    for (const channel of ORDER_CHANNELS) expect(OrderOpenRequest.safeParse(open({ messageId: null, channel })).success, channel).toBe(true);
  });

  test("a named message comes with the channel mailbox", () => {
    expect(OrderOpenRequest.safeParse(open({ channel: "portal" })).success).toBe(false);
  });

  test("Section C is required and has no default; it always comes with the withholding", () => {
    const { sectionC: _, ...without } = open();
    expect(OrderOpenRequest.safeParse(without).success).toBe(false);
    for (const kind of ["tco_removal", "dsa_art9"] as const) {
      expect(OrderOpenRequest.safeParse(open({ kind, sectionC: true, withholdFromAuthor: false })).success, kind).toBe(false);
      expect(OrderOpenRequest.safeParse(open({ kind, sectionC: true, withholdFromAuthor: true })).success, kind).toBe(true);
    }
    // A removal order always withholds; a DSA Article 9 order without Section C may or may not.
    expect(OrderOpenRequest.safeParse(open({ withholdFromAuthor: false })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ kind: "dsa_art9", withholdFromAuthor: false })).success).toBe(true);
  });

  test("an order to provide information takes no link and does not withhold unless Section C; the other kinds take one to ten", () => {
    expect(OrderOpenRequest.safeParse(open({ kind: "dsa_art10", links: [], withholdFromAuthor: false })).success).toBe(true);
    expect(OrderOpenRequest.safeParse(open({ kind: "dsa_art10", links: [], withholdFromAuthor: true })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ kind: "dsa_art10", links: [], sectionC: true, withholdFromAuthor: true })).success).toBe(true);
    expect(OrderOpenRequest.safeParse(open({ kind: "dsa_art10", withholdFromAuthor: false })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ links: [] })).success).toBe(false);
    const links = Array.from({ length: ORDER_RULES.itemsPerAction + 1 }, (_, i) => `https://korbat.example/post/${uuid(10 + i)}`);
    expect(OrderOpenRequest.safeParse(open({ links: links.slice(0, ORDER_RULES.itemsPerAction) })).success).toBe(true);
    expect(OrderOpenRequest.safeParse(open({ links })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ links: [links[0], links[0]] })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ links: ["x".repeat(501)] })).success).toBe(false);
  });

  test("the state is a member state's code; the authority and the reference are one line of 1 to 200 characters", () => {
    expect(OrderOpenRequest.safeParse(open({ memberState: "US" })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ memberState: "de" })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ reference: "" })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ reference: "x".repeat(201) })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ authority: "two" + String.fromCharCode(10) + "lines" })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ authority: "over" + String.fromCharCode(0x202e) + "ride" })).success).toBe(false);
    expect(OrderOpenRequest.safeParse(open({ extra: 1 })).success).toBe(false);
  });

  test("OrderItemsRequest: one to ten links without repeats", () => {
    expect(OrderItemsRequest.safeParse({ links: ["https://korbat.example/u/someone"] }).success).toBe(true);
    expect(OrderItemsRequest.safeParse({ links: [] }).success).toBe(false);
  });
});

describe("the correction (10.2, 10.3)", () => {
  test("facts hold at least one member of the list and nothing else", () => {
    expect(OrderCorrectRequest.safeParse({ facts: { reference: "TCO-2026/0002" } }).success).toBe(true);
    expect(OrderCorrectRequest.safeParse({ facts: {} }).success).toBe(false);
    expect(OrderCorrectRequest.safeParse({ facts: { crossBorder: true } }).success).toBe(false);
    expect(OrderCorrectRequest.safeParse({ facts: { openedAt: "2026-10-10T00:00:00Z" } }).success).toBe(false);
  });

  test("closeItems: one to ten entries, each an item and one of the three reasons, no item twice", () => {
    expect(OrderCorrectRequest.safeParse({ facts: { closeItems: [{ itemId: uuid(5), reason: "no_post" }] } }).success).toBe(true);
    expect(OrderCorrectRequest.safeParse({ facts: { closeItems: [{ itemId: uuid(5), reason: "wrong_item" }] } }).success).toBe(false);
    expect(OrderCorrectRequest.safeParse({ facts: { closeItems: [{ itemId: uuid(5), reason: "no_post" }, { itemId: uuid(5), reason: "withdrawn" }] } }).success).toBe(false);
    expect(OrderCorrectRequest.safeParse({ facts: { closeItems: [] } }).success).toBe(false);
  });

  test("Section C set never comes with the withholding unset", () => {
    expect(OrderCorrectRequest.safeParse({ facts: { sectionC: true, withholdFromAuthor: false } }).success).toBe(false);
    expect(OrderCorrectRequest.safeParse({ facts: { sectionC: true } }).success).toBe(true);
  });

  test("OrderCorrectedParams are the request's facts, strict", () => {
    expect(OrderCorrectedParams.safeParse({ facts: { sectionC: false } }).success).toBe(true);
    expect(OrderCorrectedParams.safeParse({ facts: { sectionC: false }, extra: 1 }).success).toBe(false);
  });
});

describe("OrderEventRecordedParams (10.3)", () => {
  const params = (kind: string, ground: string | null, messageId: string | null) => OrderEventRecordedParams.safeParse({ kind, ground, messageId }).success;

  test("a ground of the kind's list where it has one, and null otherwise", () => {
    for (const ground of ANNEX3_GROUNDS) expect(params("annex3_sent", ground, null), ground).toBe(true);
    expect(params("annex3_sent", null, null)).toBe(false);
    expect(params("annex3_sent", "withdrawn", null)).toBe(false);
    for (const ground of ORDER_CLOSE_GROUNDS) expect(params("closed_without_effect", ground, null), ground).toBe(true);
    expect(params("closed_without_effect", "force_majeure", null)).toBe(false);
    for (const kind of ["grounds_ceased", "annex2_sent", "receipt_confirmed", "reopened"]) expect(params(kind, "withdrawn", null), kind).toBe(false);
  });

  test("a message for a clarification and an extension, may be for a cease, and none for the rest", () => {
    expect(params("clarification_received", null, uuid(3))).toBe(true);
    expect(params("clarification_received", null, null)).toBe(false);
    expect(params("hold_extended", null, uuid(3))).toBe(true);
    expect(params("hold_extended", null, null)).toBe(false);
    expect(params("grounds_ceased", null, uuid(3))).toBe(true);
    expect(params("grounds_ceased", null, null)).toBe(true);
    for (const kind of ["annex2_sent", "receipt_confirmed", "reopened"]) expect(params(kind, null, uuid(3)), kind).toBe(false);
    // A hashed param takes the one spelling PostgreSQL writes.
    expect(params("clarification_received", null, "abcdef00-0000-4000-8000-000000000003")).toBe(true);
    expect(params("clarification_received", null, "ABCDEF00-0000-4000-8000-000000000003")).toBe(false);
  });
});

describe("the step-up actions and StaffMe", () => {
  test("order_event_recorded and order_corrected act on an order by its id", () => {
    expect(STAFF_STEP_UP_ACTIONS.order_event_recorded.targetType).toBe("order");
    expect(STAFF_STEP_UP_ACTIONS.order_corrected.targetType).toBe("order");
    const target = { type: "order", id: uuid(7) };
    expect(StaffStepUpOptionsRequest.safeParse({ action: "order_event_recorded", target, params: { kind: "annex3_sent", ground: "manifest_error", messageId: null } }).success).toBe(true);
    expect(StaffStepUpOptionsRequest.safeParse({ action: "order_corrected", target, params: { facts: { sectionC: false } } }).success).toBe(true);
    expect(StaffStepUpOptionsRequest.safeParse({ action: "order_corrected", target: { type: "case", id: uuid(7) }, params: { facts: { sectionC: false } } }).success).toBe(false);
  });

  test("StaffMe carries the home state and the contact point, each or null", () => {
    const me = {
      handle: "h",
      role: "moderator",
      sessionHandle: uuid(9),
      idleExpiresAt: "2026-10-10T00:10:00.000Z",
      idleSecondsLeft: 600,
      absoluteExpiresAt: "2026-10-10T08:00:00.000Z",
      absoluteSecondsLeft: 28800,
    };
    expect(StaffMe.safeParse({ ...me, homeState: "DE", contactPoint: "contact@korbat.example" }).success).toBe(true);
    expect(StaffMe.safeParse({ ...me, homeState: null, contactPoint: null }).success).toBe(true);
    expect(StaffMe.safeParse({ ...me, homeState: "XX", contactPoint: null }).success).toBe(false);
  });

  test("the codes Task 2 raises are moderation codes", () => {
    for (const code of ["order_needs_message", "order_exists", "order_closed", "order_event_refused", "already_released"]) expect(ModerationErrorCode.safeParse(code).success, code).toBe(true);
  });
});

describe("the answers (10.2)", () => {
  const clock = { clockStart: null, stopped: false, stoppedAt: null, stopGround: null, deadlineAt: null, targetAt: null, itemsOpen: 1, firstEffectAt: null, lastEffectAt: null, withinHour: null };
  const summary = {
    id: uuid(20),
    kind: "tco_removal",
    memberState: "DE",
    authority: "BKA",
    reference: "R-1",
    openedAt: "2026-10-10T00:00:00.000Z",
    state: "unknown_deadline",
    clock,
    dueAt: null,
    closedAt: null,
    closeGround: null,
    items: 1,
    itemsInForce: 0,
    verified: false,
    noticesHeld: 0,
  };

  test("OrdersPage holds open and closed summaries", () => {
    expect(OrdersPage.safeParse({ open: [summary], closed: [] }).success).toBe(true);
    expect(OrdersPage.safeParse({ open: [{ ...summary, state: "late" }], closed: [] }).success).toBe(false);
  });

  test("OrderView is the summary and the row's facts, its items, events, owed records, hold and aids; strict", () => {
    const view = {
      ...summary,
      channel: "portal",
      messageId: null,
      receivedAt: null,
      sentAt: null,
      issuedAt: null,
      sectionC: true,
      emergency: false,
      crossBorder: false,
      withholdFromAuthor: true,
      preserve: true,
      openedBy: "staffer",
      openedVia: "console",
      importedAt: null,
      tellPerson: null,
      items: [
        {
          id: uuid(21),
          position: 1,
          link: "https://korbat.example/u/someone",
          linkKind: "account",
          addedAt: "2026-10-10T00:00:00.000Z",
          unverified: true,
          postId: null,
          post: null,
          decisionId: null,
          caseId: null,
          inForce: false,
          disabledAt: null,
          noEffect: null,
          preserveUntil: null,
          preserveEndedAt: null,
          reinstatedAt: null,
          reinstatedGround: null,
          closedAt: null,
          closedReason: null,
          gap: false,
        },
      ],
      events: [{ id: uuid(22), kind: "opened", ground: null, at: "2026-10-10T00:00:00.000Z", effectiveAt: null, itemId: null, by: "staffer", via: "console" }],
      owed: { received: true, verification: true, issuedAt: true, texts: true, document: true, holdUntil: false, tellPerson: false, scrutinyUntil: null },
      hold: { until: "2026-11-22T01:00:00.000Z", basis: "regulation", open: false, extended: false, endedAt: null, endReason: null, releasedAt: null, noticesHeld: 0 },
      mayClose: false,
      mayEvents: ["annex3_sent"],
      mayCorrect: "entry",
    };
    expect(OrderView.safeParse(view).success).toBe(true);
    expect(OrderView.safeParse({ ...view, items: 1 }).success).toBe(false);
    expect(OrderView.safeParse({ ...view, reasons: "text" }).success).toBe(false);
  });
});
