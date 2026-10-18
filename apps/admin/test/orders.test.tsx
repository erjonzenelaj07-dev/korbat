import { ANNEX3_GROUND_LABELS, ORDER_GROUND_LABELS, ORDER_RULES, type ContactMessage, type OrderSummary, type OrderView } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ORDER_WORDS } from "../src/messages";
import { parseOrderId, type OrderId } from "../src/router";
import { changedFacts, CheckBlock, CorrectBlock, EventsBlock, EventsList, FormsBlock, NoticeBlock, OrderPage, OwedBlock, utcWithOffset } from "../src/screens/Order";
import { clockLine, emptyOrderForm, OrderForm, orderRequest, OrdersList, type OrderFormState } from "../src/screens/Orders";
import { bothTimes } from "../src/ui";
import { HOSTILE, HOSTILE_ESCAPED } from "./fixtures";

/**
 * The console's screens of an order (3f design, sections 8.4 and 8.5, Task 2): the clock lines of the list, the form
 * "Open an order" and the blocks of an order's page, rendered on the server. The authority, the reference and each link
 * are an outsider's words, shown as text; nothing decides for a person whether the author must not be told.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The rendered text without its markup, its entities read back, as a person reads it. */
const text = (out: string) =>
  out
    .replace(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const noop = () => undefined;

const ID = "7c4f5e4b-1a7d-4f4b-8e5d-9c3b8a7f6e5d";
const ITEM = "8d5a6f5c-2b8e-4a5c-9f6e-0d4c9b8a7f6e";
const MESSAGE = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const AT = "2026-10-16T02:00:00.000Z";
const START = Date.parse(AT);
/** The instant a number of minutes after AT. */
const t = (minutes: number) => new Date(START + minutes * 60_000).toISOString();

const summary = (over: Partial<OrderSummary> = {}): OrderSummary => ({
  id: ID,
  kind: "tco_removal",
  memberState: "DE",
  authority: "Bundeskriminalamt (BKA)",
  reference: "BKA-2026-1",
  openedAt: AT,
  state: "running",
  clock: { clockStart: AT, stopped: false, stoppedAt: null, stopGround: null, deadlineAt: t(60), targetAt: t(55), itemsOpen: 2, firstEffectAt: null, lastEffectAt: null, withinHour: null },
  dueAt: null,
  closedAt: null,
  closeGround: null,
  items: 2,
  itemsInForce: 0,
  verified: false,
  noticesHeld: 0,
  ...over,
});

const item = (over: Partial<OrderView["items"][number]> = {}): OrderView["items"][number] => ({
  id: ITEM,
  position: 1,
  link: "https://korbat.example/p/1",
  linkKind: "post",
  addedAt: AT,
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
  ...over,
});

const view = (over: Partial<OrderView> = {}): OrderView => ({
  ...summary(),
  items: [item()],
  channel: "mailbox",
  messageId: MESSAGE,
  receivedAt: AT,
  sentAt: null,
  issuedAt: null,
  sectionC: false,
  emergency: false,
  crossBorder: false,
  withholdFromAuthor: true,
  preserve: true,
  openedBy: "anna",
  openedVia: "console",
  importedAt: null,
  tellPerson: null,
  events: [{ id: "9e6b7a6d-3c9f-4b6d-8a7f-1e5d0c9b8a7f", kind: "opened", ground: null, at: AT, effectiveAt: null, itemId: null, by: "anna", via: "console" }],
  owed: { received: false, verification: true, issuedAt: true, texts: true, document: true, holdUntil: false, tellPerson: false, scrutinyUntil: null },
  hold: null,
  mayClose: true,
  mayEvents: ["annex3_sent", "closed_without_effect"],
  mayCorrect: "entry",
  ...over,
});

const message = (over: Partial<ContactMessage> = {}): ContactMessage => ({
  id: MESSAGE,
  folder: "inbox",
  receivedAt: AT,
  seenAt: AT,
  stale: false,
  disposition: null,
  handledAt: null,
  handledBy: null,
  orders: [],
  ...over,
});

describe("an order's clock line (8.4's table)", () => {
  test("running: the deadline, the minutes left and the target, each from the clock", () => {
    expect(clockLine(summary(), START + 10 * 60_000)).toBe(
      `Due ${bothTimes(t(60))}: 50 minutes left. Target ${bothTimes(t(55))}: an image may stay in an edge cache for up to 5 minutes after the disabling.`,
    );
  });

  test("overdue, partly given effect, and stopped by an Annex III", () => {
    expect(clockLine(summary({ state: "overdue" }), START + 61 * 60_000)).toBe(`Overdue since ${bothTimes(t(60))}: 2 of 2 items are neither disabled nor closed. Act now.`);
    const partial = summary({ clock: { ...summary().clock!, itemsOpen: 1, firstEffectAt: t(20) } });
    expect(clockLine(partial, START + 30 * 60_000)).toBe(`1 of 2 items disabled, the first at ${bothTimes(t(20))}. 1 are still open: the deadline ${bothTimes(t(60))} still runs for them.`);
    const stopped = summary({ state: "stopped", clock: { ...summary().clock!, stopped: true, stoppedAt: t(10), stopGround: "force_majeure", deadlineAt: null } });
    expect(clockLine(stopped, START + 30 * 60_000)).toBe(
      `Clock stopped at ${bothTimes(t(10))}: Annex III sent (${ANNEX3_GROUND_LABELS.force_majeure}). No deadline runs. A fresh ${ORDER_RULES.hourMinutes} minutes start when the grounds cease or the clarification arrives, never the rest of the old hour.`,
    );
  });

  test("given effect: inside the hour, outside it, and while the clock was stopped", () => {
    const effect = (lastEffectAt: string, withinHour: boolean) =>
      summary({ state: "given_effect", clock: { ...summary().clock!, itemsOpen: 0, firstEffectAt: lastEffectAt, lastEffectAt, withinHour } });
    expect(clockLine(effect(t(40), true), START)).toBe(`Given effect: the last post was disabled at ${bothTimes(t(40))}, 40 minutes after the clock started: inside the hour.`);
    expect(clockLine(effect(t(75), false), START)).toBe(`Given effect: the last post was disabled at ${bothTimes(t(75))}, 75 minutes after the clock started: outside the hour.`);
    expect(clockLine(effect(t(75), true), START)).toContain("while the clock was stopped: inside the hour.");
  });

  test("no time of receipt: the deadline is unknown and the line says to act now", () => {
    const unknown = summary({ state: "unknown_deadline", clock: { ...summary().clock!, clockStart: null, deadlineAt: null, targetAt: null } });
    expect(clockLine(unknown, START)).toBe("Deadline unknown: act now. Whoever has the server records the time of receipt with staff.js order-received.");
  });

  test("a DSA order has no clock: its stated deadline or none; a closed order says when, and on which ground", () => {
    expect(clockLine(summary({ kind: "dsa_art9", state: "no_clock", clock: null }), START)).toBe("No deadline recorded: act without undue delay.");
    expect(clockLine(summary({ kind: "dsa_art10", state: "no_clock", clock: null, dueAt: t(600) }), START)).toBe(`Due ${bothTimes(t(600))}, as the order states.`);
    expect(clockLine(summary({ state: "closed", closedAt: t(5), closeGround: "withdrawn" }), START)).toBe(`Closed on ${bothTimes(t(5))} without effect: ${ORDER_GROUND_LABELS.withdrawn}.`);
    expect(clockLine(summary({ state: "closed", closedAt: t(5) }), START)).toBe(`Closed on ${bothTimes(t(5))}.`);
  });
});

describe("the list of orders (8.4)", () => {
  test("each order a block: its kind, its state, the authority and the reference as an outsider's words, its clock line, a link built from its checked id", () => {
    const hostile = summary({ authority: HOSTILE.script, reference: HOSTILE.quote });
    const out = html(<OrdersList page={{ open: [hostile], closed: [] }} now={START} onOpenOrder={noop} />);
    expect(out).toContain(HOSTILE_ESCAPED.script);
    expect(out).toContain(HOSTILE_ESCAPED.quote);
    expect(out).not.toContain("<script>");
    expect(out).toContain(`href="/orders/${ID}"`);
    expect(text(out)).toContain("As written in the order");
    expect(text(out)).toContain("Germany (DE)");
    expect(text(out)).toContain(clockLine(hostile, START));
    expect(text(out)).toContain("Open this order");
  });

  test("the closed ones under their title; nothing recorded says so; an id that is not a lower-case uuid gets no link", () => {
    const closed = text(html(<OrdersList page={{ open: [], closed: [summary({ state: "closed", closedAt: t(5) })] }} now={START} onOpenOrder={noop} />));
    expect(closed).toContain("Closed in the last 30 days");
    expect(text(html(<OrdersList page={{ open: [], closed: [] }} now={START} onOpenOrder={noop} />))).toBe("No order is recorded.");
    expect(html(<OrdersList page={{ open: [summary({ id: ID.toUpperCase() })], closed: [] }} now={START} onOpenOrder={noop} />)).not.toContain("href=");
  });
});

describe("the form Open an order (8.4)", () => {
  const filled = (over: Partial<OrderFormState> = {}): OrderFormState => ({
    ...emptyOrderForm(),
    message: "none",
    channel: "portal",
    kind: "tco_removal",
    memberState: "DE",
    authorityChoice: "bka",
    reference: "BKA-2026-1",
    links: ["https://korbat.example/p/1", "", "  https://korbat.example/p/2  "].join(String.fromCharCode(10)),
    sectionC: "no",
    ...over,
  });
  const form = (state: OrderFormState, over: Partial<Parameters<typeof OrderForm>[0]> = {}) =>
    html(<OrderForm me={{ homeState: "DE" }} form={state} messages={[message()]} busy={false} problem={null} duplicate={null} onChange={noop} onSubmit={noop} onOpenOrder={noop} {...over} />);

  test("Section C untouched is never sent: the form says no choice is made for you", () => {
    expect(orderRequest(filled({ sectionC: null }))).toEqual({ ok: false, problem: "Choose whether the author must not be told: no choice is made for you." });
  });

  test("a removal order: the register's name for the authority, the links one a line, the post kept from its author", () => {
    const sent = orderRequest(filled());
    expect(sent).toEqual({
      ok: true,
      request: {
        messageId: null,
        channel: "portal",
        kind: "tco_removal",
        memberState: "DE",
        authority: "Bundeskriminalamt (BKA)",
        reference: "BKA-2026-1",
        links: ["https://korbat.example/p/1", "https://korbat.example/p/2"],
        sectionC: false,
        emergency: false,
        withholdFromAuthor: true,
      },
    });
    // A message picked is the mailbox, and its id is sent; I cannot tell holds like a tick.
    const picked = orderRequest(filled({ message: MESSAGE, channel: null, sectionC: "unsure", authorityChoice: "other", otherAuthority: HOSTILE.script }));
    expect(picked.ok && picked.request).toMatchObject({ messageId: MESSAGE, channel: "mailbox", sectionC: true, withholdFromAuthor: true, authority: HOSTILE.script });
  });

  test("a DSA order: the withholding only when ticked or forced by Section C; an order to provide information takes no link", () => {
    const art9 = orderRequest(filled({ kind: "dsa_art9" }));
    expect(art9.ok && art9.request.withholdFromAuthor).toBe(false);
    const ticked = orderRequest(filled({ kind: "dsa_art9", withhold: true }));
    expect(ticked.ok && ticked.request.withholdFromAuthor).toBe(true);
    const silent = orderRequest(filled({ kind: "dsa_art9", sectionC: "yes" }));
    expect(silent.ok && silent.request).toMatchObject({ sectionC: true, withholdFromAuthor: true });
    const art10 = orderRequest(filled({ kind: "dsa_art10" }));
    expect(art10.ok && art10.request).toMatchObject({ links: [], withholdFromAuthor: false, emergency: false });
    // Nothing named and nothing to send: the schema refuses it.
    expect(orderRequest(filled({ links: "" })).ok).toBe(false);
  });

  test("nothing is preselected that decides anything; the home state is listed first; the message not listed warns that no deadline shows", () => {
    const empty = form(emptyOrderForm());
    expect(empty).not.toMatch(/checked=""/);
    expect(empty).toMatch(/<option value="" selected="">-<[/]option><option value="DE">Germany [(]DE[)]<[/]option>/);
    expect(text(empty)).toContain("The message is not listed");
    expect(text(empty)).not.toContain("The order is opened without a time of receipt");
    expect(text(form(emptyOrderForm("none")))).toContain("The order is opened without a time of receipt, so korbat cannot show its deadline. Act now, as if the hour were almost over.");
    expect(text(form(emptyOrderForm("none")))).toContain("How it arrived");
  });

  test("DSA Article 9: the withholding is ticked and locked while the author must not be told, or while nobody can tell; free when Section C is not set", () => {
    const box = (out: string) => out.match(/<input type="checkbox"[^>]*>/g) ?? [];
    for (const sectionC of ["yes", "unsure"] as const) {
      const locked = form(filled({ kind: "dsa_art9", sectionC }));
      expect(box(locked)).toEqual(['<input type="checkbox" disabled="" checked=""/>']);
      expect(text(locked)).toContain("An author who must not be told cannot be shown their post marked as removed.");
    }
    const free = form(filled({ kind: "dsa_art9", sectionC: "no" }));
    expect(box(free)).toHaveLength(1);
    expect(box(free)[0]).not.toContain("disabled");
    expect(box(free)[0]).not.toContain("checked");
    expect(text(free)).toContain("Tick it only if the order's text says the content must be kept from its author too.");
    // The removal order's own box is the emergency, never the withholding.
    expect(text(form(filled()))).toContain("The order says it is an emergency");
    expect(text(form(filled()))).not.toContain("Withheld from the author");
  });

  test("order_exists links to the order that stands", () => {
    const out = form(filled(), { duplicate: parseOrderId(ID) as OrderId, problem: "x" });
    expect(out).toContain(`href="/orders/${ID}"`);
    expect(text(out)).toContain("Open the order that is recorded");
  });
});

describe("an order's page (8.5, Task 2's blocks)", () => {
  const me = { homeState: "DE", contactPoint: "orders@korbat.example" } as const;
  const page = (order: OrderView, over: Partial<Parameters<typeof OrderPage>[0]> = {}) =>
    html(
      <OrderPage
        order={order}
        me={me}
        now={START}
        messages={[message()]}
        busy={false}
        notice={null}
        error={null}
        reasons={{}}
        links=""
        onReason={noop}
        onCloseItem={noop}
        onLinks={noop}
        onAddLinks={noop}
        onRecord={noop}
        onCorrect={noop}
        {...over}
      />,
    );

  test("the clock comes first, under the kind; there is no block 4 and no Extension received yet (Task 3's)", () => {
    const out = text(page(view()));
    expect(out.indexOf(clockLine({ ...view(), items: 1 }, START))).toBeGreaterThan(0);
    expect(out.indexOf(clockLine({ ...view(), items: 1 }, START))).toBeLessThan(out.indexOf("As written in the order"));
    expect(out).not.toContain("Disable for an order");
    expect(out).not.toContain("Extension received");
  });

  test("block 2: a removal order is checked against the register, the authority drawn as text, with the home state's entries", () => {
    const out = html(<CheckBlock order={view({ authority: HOSTILE.script })} me={me} />);
    expect(out).toContain(HOSTILE_ESCAPED.script);
    expect(text(out)).toContain(`Before you act, check the order against your offline copy of the Commission's register: is ${HOSTILE.script} listed for Germany, and does the address`);
    expect(text(out)).toContain("Bundeskriminalamt (BKA): Bundeskriminalamt (BKA), contact point TCO@bka.bund.de");
    expect(text(out)).toContain("If you are in doubt and the hour is running, give effect");
    const dsa = text(html(<CheckBlock order={view({ kind: "dsa_art9", clock: null })} me={me} />));
    expect(dsa).toContain("No register lists who may issue such an order.");
    expect(dsa).toContain("it is given effect only after the check is recorded");
    expect(text(html(<CheckBlock order={view({ kind: "dsa_art9", clock: null, verified: true })} me={me} />))).not.toContain("given effect only after the check");
  });

  test("block 3: each link as an outsider's words; an account's and a missing link's lines; closing an open item needs a reason", () => {
    const items = [item({ link: HOSTILE.url, linkKind: "account" }), item({ id: "1f7c8b7e-4d0a-4c7e-9b8a-2f6e1d0c9b8a", position: 2, linkKind: "other" })];
    const out = page(view({ items }));
    expect(out).toContain(HOSTILE.url);
    expect(out).not.toContain(`href="${HOSTILE.url}"`);
    expect(text(out)).toContain("This link names an account, not a post.");
    expect(text(out)).toContain("This link names nothing that korbat serves.");
    expect(out.match(/<button type="button" disabled="">Close this item without effect<[/]button>/g)).toHaveLength(2);
    expect(page(view({ items }), { reasons: { [ITEM]: "no_post" } }).match(/<button type="button">Close this item without effect<[/]button>/g)).toHaveLength(1);
    // A disabled item, and an order nobody may correct, offer no closing.
    expect(text(page(view({ items: [item({ disabledAt: t(30) })] })))).toContain(`Disabled at ${bothTimes(t(30))}`);
    expect(text(page(view({ items: [item({ disabledAt: t(30) })] })))).not.toContain("Close this item without effect");
    expect(text(page(view({ mayCorrect: null })))).not.toContain("Close this item without effect");
  });

  test("block 5: only the events the database would take now; each is confirmed by the key, with its ground or message chosen first", () => {
    const out = html(<EventsBlock order={view({ mayEvents: ["annex3_sent", "clarification_received", "hold_extended"] })} messages={[message()]} busy={false} onRecord={noop} />);
    expect(text(out)).toContain("Annex III sent: Confirm with your staff key");
    expect(text(out)).toContain("Clarification received: Confirm with your staff key");
    expect(text(out)).toContain(ANNEX3_GROUND_LABELS.insufficient_information);
    expect(text(out)).toContain(`Received ${bothTimes(AT)}, Inbox`);
    expect(text(out)).not.toContain("Close without effect");
    expect(out.match(/<button type="button" disabled="">/g)).toHaveLength(2);
    expect(html(<EventsBlock order={view({ mayEvents: [] })} messages={[]} busy={false} onRecord={noop} />)).toBe("");
  });

  test("block 6: the forms' values as text, the time in UTC with its offset, the contact point and the copy from the home state's facts", () => {
    expect(utcWithOffset("2026-10-10T01:00:12.345Z")).toBe("2026-10-10 01:00:12 +00:00");
    const stopped = view({ clock: { ...summary().clock!, stopped: true, stoppedAt: t(10), stopGround: "manifest_error" } });
    const out = text(html(<FormsBlock order={stopped} me={me} />));
    expect(out).toContain("Reference of the removal order: BKA-2026-1");
    expect(out).toContain("Issuing authority: Bundeskriminalamt (BKA), Germany (DE)");
    expect(out).toContain("Time and date of receipt of removal order: 2026-10-16 02:00:00 +00:00");
    expect(out).toContain(`Reason: ${ANNEX3_GROUND_LABELS.manifest_error}`);
    expect(out).toContain("Contact point: orders@korbat.example");
    expect(out).toContain("Copy to: TCO@bka.bund.de");
    expect(text(html(<FormsBlock order={view()} me={{ homeState: null, contactPoint: null }} />))).toContain("Contact point: not filled in: see the README, Before going public");
    expect(html(<FormsBlock order={view({ kind: "dsa_art9", clock: null })} me={me} />)).toBe("");
  });

  test("block 7: what the command line owes, one line each; nothing owed, no block", () => {
    const out = text(html(<OwedBlock order={view()} />));
    expect(out).toContain("The check is not recorded (staff.js order-verify).");
    expect(out).toContain("The order's own date and time are not recorded (staff.js order-issued).");
    expect(out).toContain("The authority's reasons and remedies are not recorded (staff.js order-texts).");
    expect(out).toContain("The document's digest is not recorded (staff.js order-document).");
    const none = { received: false, verification: false, issuedAt: false, texts: false, document: false, holdUntil: false, tellPerson: false, scrutinyUntil: null };
    expect(html(<OwedBlock order={view({ owed: none })} />)).toBe("");
    const dsa = text(html(<OwedBlock order={view({ kind: "dsa_art9", clock: null, owed: { ...none, texts: true } })} />));
    expect(dsa).toContain("Record the authority's reasons, its remedies and the order's territorial scope before you give effect");
  });

  test("block 8: told at the effect, or held: with no end, until the computed end, released", () => {
    expect(text(html(<NoticeBlock order={view({ items: [item({ disabledAt: t(30) })] })} />))).toContain(`Told at ${bothTimes(t(30))}.`);
    const hold = { until: null, basis: "regulation", open: true, extended: false, endedAt: null, endReason: null, releasedAt: null, noticesHeld: 1 } as const;
    expect(text(html(<NoticeBlock order={view({ sectionC: true, hold })} />))).toContain("Held with no end");
    const until = text(html(<NoticeBlock order={view({ sectionC: true, hold: { ...hold, open: false, until: t(60_000), releasedAt: t(60_000) } })} />));
    expect(until).toContain(`Held until ${bothTimes(t(60_000))}: the end the database computes from the Regulation's six weeks, counted from the receipt.`);
    expect(until).toContain(`Released at ${bothTimes(t(60_000))}.`);
    expect(html(<NoticeBlock order={view()} />)).toBe("");
  });

  test("block 9: the events newest first, each with who wrote it, a handle as text", () => {
    const events: OrderView["events"] = [
      { id: "9e6b7a6d-3c9f-4b6d-8a7f-1e5d0c9b8a7f", kind: "opened", ground: null, at: AT, effectiveAt: null, itemId: null, by: HOSTILE.script, via: "console" },
      { id: "0a7c8b7e-4d0a-4c7e-9b8a-2f6e1d0c9b8b", kind: "annex3_sent", ground: "force_majeure", at: t(10), effectiveAt: null, itemId: null, by: null, via: "cli" },
    ];
    const out = html(<EventsList order={view({ events })} />);
    expect(out).toContain(HOSTILE_ESCAPED.script);
    const read = text(out);
    expect(read.indexOf(`${bothTimes(t(10))}: Annex III sent: ${ANNEX3_GROUND_LABELS.force_majeure}`)).toBeLessThan(read.indexOf(`${bothTimes(AT)}: Order opened`));
    expect(read).toContain("command line");
    expect(read).toContain(`@${HOSTILE.script}, console`);
  });

  test("block 10: the rule decides the controls; a correction sends what changes and nothing else", () => {
    expect(html(<CorrectBlock order={view({ mayCorrect: null })} busy={false} onCorrect={noop} />)).toBe("");
    const caution = text(html(<CorrectBlock order={view({ mayCorrect: "caution" })} busy={false} onCorrect={noop} />));
    expect(caution).toContain("Section C is ticked: the author must not be told");
    expect(caution).not.toContain("Issuing state");
    expect(html(<CorrectBlock order={view({ mayCorrect: "caution", sectionC: true })} busy={false} onCorrect={noop} />)).toBe("");
    const entry = html(<CorrectBlock order={view()} busy={false} onCorrect={noop} />);
    expect(entry).toMatch(/<button type="button" disabled="">Correct<[/]button>/);
    // An order opened from a message keeps its channel: the field is offered only without one.
    expect(text(entry)).not.toContain("How it arrived");
    expect(text(html(<CorrectBlock order={view({ messageId: null, channel: "portal" })} busy={false} onCorrect={noop} />))).toContain("How it arrived");
    expect(text(html(<CorrectBlock order={view({ mayCorrect: "admin" })} busy={false} onCorrect={noop} />))).toContain("Correct: Confirm with your staff key");
    const order = view();
    const same = { kind: order.kind, memberState: order.memberState, authority: order.authority, reference: order.reference, channel: order.channel, sectionC: order.sectionC, emergency: order.emergency, withholdFromAuthor: order.withholdFromAuthor };
    expect(changedFacts(order, same)).toEqual({});
    expect(changedFacts(order, { ...same, reference: "BKA-2026-2", channel: "post" })).toEqual({ reference: "BKA-2026-2" });
    expect(changedFacts(view({ messageId: null }), { ...same, channel: "post" })).toEqual({ channel: "post" });
  });
});
