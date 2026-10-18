import { CONTACT_CLOSE_DISPOSITIONS, DISPOSITION_LABELS, ORDER_RULES, type ContactMessage } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { ORDER_WORDS } from "../src/messages";
import { ContactView } from "../src/screens/Contact";
import { AuthoritiesLines } from "../src/screens/Home";
import { bothTimes } from "../src/ui";
import { overview } from "./case-fixtures";
import { CONSOLE_PATHS, fakeFetch, HOSTILE, HOSTILE_ESCAPED, hrefs } from "./fixtures";

/**
 * The console's screens of the contact point (3f design, sections 8.1 to 8.3, 8.9 and 18): the home screen's block
 * "Authorities" and the Contact point screen, rendered on the server, each sentence held to the design's words and every
 * number to ORDER_RULES or the answer. A handle is a person's text, shown as text.
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

const AT = "2026-10-16T02:00:00.000Z";
const message = (over: Partial<ContactMessage> = {}): ContactMessage => ({
  id: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
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

describe("the times of 3f", () => {
  test("bothTimes prints UTC first and the browser's own time in brackets", () => {
    const local = new Date(AT);
    const two = (n: number) => String(n).padStart(2, "0");
    const clock = `${two(local.getHours())}:${two(local.getMinutes())}`;
    expect(bothTimes(AT)).toMatch(new RegExp(`^2026-10-16 02:00 UTC [(](2026-10-1[56] )?${clock} your time[)]$`));
  });
});

describe("the home screen's block Authorities (8.2)", () => {
  test("nothing at the contact point and a working channel: no block at all", () => {
    expect(html(<AuthoritiesLines overview={overview()} onNavigate={noop} />)).toBe("");
  });

  test("[home.contact]: the messages nobody handled since the oldest, a link to Contact point inside the sentence, and the hour", () => {
    const out = html(<AuthoritiesLines overview={overview({ contact: { open: 2, oldestAt: AT, dueAt: AT }, alerts: { channel: "ok", since: null } })} onNavigate={noop} />);
    expect(text(out)).toContain(
      `Authorities` + `Mail at the authorities' contact point since ${bothTimes(AT)}: 2 messages nobody has handled. Read it in the mail host's app, then open Contact point. A removal order is due one hour after it arrived.`,
    );
    expect(hrefs(out)).toEqual(["/contact"]);
    for (const href of hrefs(out)) expect(CONSOLE_PATHS).toContain(href);
    expect(ORDER_RULES.hourMinutes).toBe(60);
  });

  test("[home.channel], [home.mailbox] and [home.off], each while the channel is in its state; the console names no setting", () => {
    const channel = text(html(<AuthoritiesLines overview={overview({ alerts: { channel: "down", since: AT } })} />));
    expect(channel).toContain(
      `Phone alerts are down since ${bothTimes(AT)}. Alerts arrive by mail only: keep the mail host's app open on the contact-point mailbox until this line is gone. An order you find there that Contact point does not list is opened under Orders, with "The message is not listed".`,
    );
    const mailbox = text(html(<AuthoritiesLines overview={overview({ alerts: { channel: "mailbox", since: AT } })} />));
    expect(mailbox).toContain(`korbat has not been able to read the contact-point mailbox since ${bothTimes(AT)}. Check it in the mail host's app until this line is gone. An order you find there is opened under Orders, with "The message is not listed".`);
    const off = text(html(<AuthoritiesLines overview={overview({ alerts: { channel: "off", since: null } })} />));
    expect(off).toContain("Phone alerts and the contact point's watcher are switched off on this server. Nothing watches the contact-point mailbox: the operator switches them on.");
    expect(off).not.toMatch(/NOTIFY|API_/);
  });
});

describe("the Contact point screen (8.3)", () => {
  const ready = (items: ContactMessage[], nextCursor: string | null = null) => ({ state: "ready" as const, value: { items, nextCursor } });
  const view = (items: ContactMessage[], over: Partial<Parameters<typeof ContactView>[0]> = {}) =>
    html(<ContactView page={ready(items)} choices={{}} busy={null} notice={null} error={null} loadingOlder={false} onChoose={noop} onClose={noop} onCloseStale={noop} onLoadOlder={noop} {...over} />);

  test("opens with [contact.what] and [contact.reply], every number from ORDER_RULES", () => {
    const out = text(view([]));
    expect(out).toContain(
      `korbat records that a message arrived and when. It never reads who sent it or what it says: read the message in the mail host's app. Every message here may be a removal order until a person has read it. The junk folder is watched too: an order filed as junk has still arrived. While one message's alarm is less than ${ORDER_RULES.quietMinutes} minutes old, further mail is listed here and raises no new alarm of its own: read every message listed, not only the first. A message that is in the mailbox and not listed here (the watcher was down, or the mail host filed it in another folder) is opened as an order all the same: Orders, "Open an order", "The message is not listed".`,
    );
    expect(out).toContain("Never answer an authority from korbat, and never open an attachment on a device that holds a staff key before you have checked the sender against the register.");
    expect(out).toContain(ORDER_WORDS.contact.empty);
  });

  test("a message's block: received, its folder, stale, not handled, and the six choices of Close as with their hints and [contact.close]", () => {
    const out = text(view([message({ folder: "junk", stale: true })]));
    expect(out).toContain(`Received ${bothTimes(AT)}`);
    expect(out).toContain("Junk folder");
    expect(out).toContain(`korbat first saw this message more than ${ORDER_RULES.staleHours} hours after it arrived (after an outage or a restore). It raised no phone alert.`);
    expect(out).toContain("Not handled");
    expect(out).toContain("Close as");
    for (const word of CONTACT_CLOSE_DISPOSITIONS) {
      expect(out, word).toContain(DISPOSITION_LABELS[word]);
      expect(out, word).toContain(ORDER_WORDS.contact.hints[word]);
    }
    expect(out).toContain("Closing ends this message's alerts and cannot be changed. Close it only after you have read it in the mail host's app.");
    // Without the screen's handlers (a view of the list alone) no button opens an order.
    expect(out).not.toContain("Open an order from this message");
    // With them (Task 2), a message nobody handled offers [Open an order from this message]; its form replaces the button.
    expect(text(view([message()], { onOpenForm: noop, onOpenOrder: noop }))).toContain("Open an order from this message");
    const opened = text(view([message()], { onOpenForm: noop, onOpenOrder: noop, formFor: message().id, form: <p>the form</p> }));
    expect(opened).toContain("the form");
    expect(opened).not.toContain("Open an order from this message");
    // Close is greyed until a choice is made.
    expect(view([message()])).toMatch(/<button type="button" disabled=""[^>]*>Close<[/]button>/);
    expect(view([message()], { choices: { [message().id]: "not_an_order" } })).toMatch(/<button type="button"( aria-busy="false")?>Close<[/]button>/);
  });

  test("a handled message says how, by whom as text, and when; an order's says it was handled as an order; no choice is offered for either", () => {
    const by = text(view([message({ disposition: "referral", handledAt: AT, handledBy: HOSTILE.script })]));
    expect(by).toContain(`Handled as Referral by @${HOSTILE.script} on ${bothTimes(AT)}`);
    expect(view([message({ disposition: "referral", handledAt: AT, handledBy: HOSTILE.script })])).toContain(HOSTILE_ESCAPED.script);
    expect(by).not.toContain("Close as");
    expect(text(view([message({ disposition: "order", handledAt: AT })]))).toContain("Handled as an order");
    // A message opened as an order links to it (OrderLink), and offers no form of its own.
    const order = "7c4f5e4b-1a7d-4f4b-8e5d-9c3b8a7f6e5d";
    const linked = view([message({ disposition: "order", handledAt: AT, orders: [order] })], { onOpenForm: noop, onOpenOrder: noop });
    expect(linked).toContain(`href="/orders/${order}"`);
    expect(text(linked)).not.toContain("Open an order from this message");
    expect(view([message({ disposition: "order", handledAt: AT, orders: ["not-an-id"] })], { onOpenForm: noop, onOpenOrder: noop })).not.toContain("href=");
  });

  test("more than one stale message nobody handled: close them together, with [contact.staleAll]; one stale message alone gets no such group", () => {
    const stale = [message({ stale: true }), message({ id: "4a2d3c2f-9e5b-4d2f-8c3b-7a1f6e5d4c3b", stale: true }), message({ id: "5b3e4d3a-0f6c-4e3a-9d4c-8b2a7f6e5d4c", stale: false })];
    const out = text(view(stale));
    expect(out).toContain("Close the 2 stale messages as");
    expect(out).toContain(
      `These 2 messages reached korbat's record more than ${ORDER_RULES.staleHours} hours after they arrived and raised no alert. Look at each in the mail host's app before you close them: one of them may be an order, and it is then opened, not closed. Closing cannot be changed.`,
    );
    expect(out).toContain("Close them");
    expect(text(view([message({ stale: true })]))).not.toContain("stale messages as");
  });

  test("Load older while the answer names a next page", () => {
    expect(html(<ContactView page={ready([message()], "next")} choices={{}} busy={null} notice={null} error={null} loadingOlder={false} onChoose={noop} onClose={noop} onCloseStale={noop} onLoadOlder={noop} />)).toContain(">Load older</button>");
    expect(view([message()])).not.toContain("Load older");
  });

  test("message_handled is worded for the console, and the API client sends the close to the message's own address only when its id is a lower-case uuid", async () => {
    const fake = fakeFetch({ "POST /api/staff/contact/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a/close": { status: 204 } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    await api.closeContact("3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", { disposition: "not_an_order" }, { activity: true });
    await expect(api.closeContact("3F1C2B1E-8D4A-4C1E-9B2A-6F0E5D4C3B2A", { disposition: "not_an_order" })).rejects.toMatchObject({ code: "invalid_request" });
    const { messageFor } = await import("../src/messages");
    expect(messageFor("message_handled")).toBe("That message was already handled. Read Contact point again.");
  });
});
