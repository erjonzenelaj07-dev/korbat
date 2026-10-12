import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ModerationErrorCode, STATEMENT_MAX, type AuthorCaseRow, type DecisionAppeal, type DecisionView, type NoticeItemStatus, type NoticeStatus, type ReportItem } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { DecisionsList, ReportsList } from "../src/components/moderation/CasesLists";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { ItemLines } from "../src/components/moderation/ItemLines";
import { NoticeStatusView } from "../src/components/moderation/NoticeStatusView";
import { messageFor } from "../src/lib/api";
import { appealWaitWords, quotedExaminedToo, statementOf } from "../src/lib/moderation";
import { CASES_WORDS, DECISION_WORDS, STATUS_WORDS } from "../src/lib/moderation-words";

/**
 * The appeal form and its states on the decision's screen, and "Ask for a re-examination" on the notice status page and
 * in Your reports (3c design, sections 7.2, 7.7 and 9). The components are server-rendered with made-up answers in each
 * state; what a static render cannot show (a request, where a token travels) is read from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

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
    .replace(/\s+/g, " ")
    .trim();
/** The text of every button in the markup. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const APP = "http://localhost:8081";
const TIME = "2026-10-04T10:00:00.000Z";
const UNTIL = "2027-04-05T07:00:00.000Z";
const noop = async () => undefined;

const statement = {
  kind: "final" as const,
  outcome: "restricted" as const,
  ground: "incompatible" as const,
  ruleId: "R3" as const,
  rulesVersion: 2,
  redressVersion: 1,
  legalReference: null,
  facts: "The post attacks a group for its religion.",
  reason: "That is an attack on people, not on an idea.",
  source: "report" as const,
  decidedAt: TIME,
  post: { id: id(1), createdAt: "2026-09-01T08:30:00.000Z" },
  measures: [{ kind: "remove" as const, mediaId: null, noEffect: null, sealed: null }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
};
const view = (extra: Partial<DecisionView> = {}): DecisionView => ({
  id: id(3),
  ...statement,
  appealUntil: "2027-04-04T10:00:00.000Z",
  reversedOn: null,
  content: { kind: "post", body: "the words that were judged", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
  appeal: null,
  ...extra,
});
const pending = (extra: Partial<Extract<DecisionAppeal, { state: "pending" }>> = {}): DecisionAppeal => ({ state: "pending", filedAt: "2026-10-06T09:00:00.000Z", reviewer: "available", needsAdmin: false, ...extra });
const sealed = { ...statement, ruleId: "R2" as const, measures: [{ kind: "seal_media" as const, mediaId: null, noEffect: null, sealed: { posts: 1, images: 2, deletedImages: 0 } }] };

describe("the words of appeals and re-examination", () => {
  test("the appeal's own sentences are the design's", () => {
    expect(DECISION_WORDS.appealHint).toBe("Tell us anything you want the reviewer to know. You do not need to cite rules or law.");
    expect(DECISION_WORDS.appealWaiting).toBe("Waiting for a reviewer");
    expect(DECISION_WORDS.appealWaits).toEqual({
      none_single_staff: "Your appeal waits for a moderator who did not take part in the decision. korbat has one moderator at the moment.",
      none_eligible: "Your appeal waits for a moderator who took no part in this case. None is available now; your appeal stays open until one is.",
      admin: "Your appeal waits for an admin who did not take part in the decision.",
      oneAdmin: "korbat has one admin at the moment.",
      sealed: "Sealed images are reviewed once the authorities have assessed them. Your appeal stays open until then.",
    });
    expect(DECISION_WORDS.appealAnswered("2026-10-09")).toBe("Answered on 2026-10-09");
    expect(STATUS_WORDS.reexamine).toBe("Ask for a re-examination");
    expect(STATUS_WORDS.reexamineBoth).toBe("korbat examines the post it quotes again as well.");
  });

  test("each code an appeal and a re-examination can meet has the app's own words", () => {
    expect(messageFor("appeal_not_open")).toBe("This decision cannot be appealed now.");
    expect(messageFor("appeal_exists")).toBe("You have already appealed this decision.");
    expect(messageFor("reexamination_not_open")).toBe("A re-examination cannot be asked for this item now.");
    expect(messageFor("reexamination_exists")).toBe("A re-examination of this item has already been asked for.");
    for (const code of ["appeal_not_open", "appeal_exists", "reexamination_not_open", "reexamination_exists"]) expect(ModerationErrorCode.options).toContain(code);
  });

  test("a statement is sent only when something was written, and never longer than the contracts allow", () => {
    expect(statementOf("")).toEqual({});
    expect(statementOf("  \n ")).toEqual({});
    expect(statementOf(" It quotes a film. ")).toEqual({ statement: "It quotes a film." });
    expect(STATEMENT_MAX).toBe(2000);
  });
});

describe("the appeal on a decision's screen", () => {
  test("while the decision can be appealed: the deadline, an optional statement with its hint, and the button", () => {
    const out = html(<DecisionDetail view={view()} onAppeal={noop} />);
    const text = textOf(out);
    expect(text).toContain(DECISION_WORDS.appealUntil("2027-04-04 10:00 UTC"));
    expect(text).toContain(DECISION_WORDS.appealHint);
    expect(out).toMatch(/<textarea[^>]*maxLength="2000"/i);
    expect(buttons(out)).toEqual([DECISION_WORDS.appeal]);
    // Without a way to send one (the screen is drawn before it can act) the deadline stands alone.
    expect(buttons(html(<DecisionDetail view={view()} />))).toEqual([]);
    // A decision that cannot be appealed shows no form: one taken while korbat decides, and one whose window passed.
    expect(buttons(html(<DecisionDetail view={view({ appealUntil: null })} onAppeal={noop} />))).toEqual([]);
  });

  test("a pending appeal says that it waits for a reviewer, and when nobody can review it now, why, in the design's sentences", () => {
    const shown = (appeal: DecisionAppeal, base: Partial<DecisionView> = {}) => textOf(html(<DecisionDetail view={view({ appealUntil: null, appeal, ...base })} onAppeal={noop} />));
    expect(appealWaitWords(view({ appeal: pending() }))).toBe(DECISION_WORDS.appealWaiting);
    expect(shown(pending())).toContain(DECISION_WORDS.appealWaiting);
    expect(shown(pending())).toContain(DECISION_WORDS.appealFiled("2026-10-06"));
    expect(shown(pending({ reviewer: "none_single_staff" }))).toContain(DECISION_WORDS.appealWaits.none_single_staff);
    expect(shown(pending({ reviewer: "none_eligible" }))).toContain(DECISION_WORDS.appealWaits.none_eligible);
    // A review that needs an admin: the admin's sentence, with "one admin" only while korbat has one.
    const r2 = { ...statement, ruleId: "R2" as const };
    expect(shown(pending({ reviewer: "none_eligible", needsAdmin: true }), r2)).toContain(DECISION_WORDS.appealWaits.admin);
    expect(shown(pending({ reviewer: "none_eligible", needsAdmin: true }), r2)).not.toContain(DECISION_WORDS.appealWaits.oneAdmin);
    expect(shown(pending({ reviewer: "none_single_staff", needsAdmin: true }), r2)).toContain(`${DECISION_WORDS.appealWaits.admin} ${DECISION_WORDS.appealWaits.oneAdmin}`);
    expect(shown(pending({ reviewer: "available", needsAdmin: true }), r2)).toContain(DECISION_WORDS.appealWaiting);
    // An appeal of a decision that sealed images: the seal's sentence in place of every other, whatever the reviewer's state.
    for (const reviewer of ["available", "none_single_staff", "none_eligible"] as const) {
      const text = shown(pending({ reviewer, needsAdmin: true }), sealed);
      expect(text, reviewer).toContain(DECISION_WORDS.appealWaits.sealed);
      expect(text, reviewer).not.toContain(DECISION_WORDS.appealWaits.admin);
      expect(text, reviewer).not.toContain(DECISION_WORDS.appealWaiting);
    }
    // No second appeal is offered.
    expect(buttons(html(<DecisionDetail view={view({ appealUntil: null, appeal: pending() })} onAppeal={noop} />))).toEqual([]);
  });

  test("an answered appeal shows its day and the answering decision's statement, rendered as every statement is", () => {
    const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R3" as const, rulesVersion: 2, legalReference: null, decidedAt: TIME };
    const review = { ...statement, kind: "review" as const, outcome: "kept" as const, ground: null, ruleId: null, facts: null, reason: "The post names a group, not an idea.", measures: [], reviewed, decidedAt: "2026-10-09T08:00:00.000Z" };
    const appeal: DecisionAppeal = { state: "answered", filedAt: "2026-10-06T09:00:00.000Z", answeredOn: "2026-10-09", result: "kept", answeredBy: id(9), statement: review };
    const out = html(<DecisionDetail view={view({ appealUntil: null, appeal })} onAppeal={noop} />);
    const text = textOf(out);
    expect(text).toContain(DECISION_WORDS.appealAnswered("2026-10-09"));
    for (const paragraph of statementParagraphs(review)) expect(text, paragraph).toContain(paragraph);
    expect(text).toContain(STATEMENT_WORDS.reviewed("2026-10-04 10:00 UTC", "kept"));
    expect(text).toContain("Why korbat kept it: The post names a group, not an idea.");
    expect(buttons(out)).toEqual([]);
    // The answer has a screen of its own, which the appeal links.
    expect(out).toContain(`href="/settings/cases/${id(9)}"`);
  });

  test("a restriction reversed in full with no appeal filed says that nothing is left to appeal", () => {
    const text = textOf(html(<DecisionDetail view={view({ appealUntil: null, reversedOn: "2026-10-07" })} onAppeal={noop} />));
    expect(text).toContain(DECISION_WORDS.reversed("2026-10-07"));
    // With an appeal that a correction answered, the answer stands in its place.
    const answered: DecisionAppeal = { state: "answered", filedAt: TIME, answeredOn: "2026-10-07", result: "reversed", answeredBy: id(9), statement: { ...statement, kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, reason: "It is satire.", measures: [], reversals: [{ kind: "restore", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null }], reviewed: { kind: "final", ground: "incompatible", ruleId: "R3", rulesVersion: 2, legalReference: null, decidedAt: TIME } } };
    const both = textOf(html(<DecisionDetail view={view({ appealUntil: null, reversedOn: "2026-10-07", appeal: answered })} onAppeal={noop} />));
    expect(both).toContain(DECISION_WORDS.appealAnswered("2026-10-07"));
    expect(both).not.toContain(DECISION_WORDS.reversed("2026-10-07"));
  });

  test("the screen sends the appeal as a POST for the decision in its address and shows the decision the answer carries", () => {
    const screen = read("app", "settings", "cases", "[id].tsx");
    expect(screen).toMatch(/moderation\.appeal\(id, /);
    expect(read("lib", "moderation.ts")).toMatch(/appeal: \(id: string, statement: string\) => api\(`\/api\/moderation\/decisions\/\$\{encodeURIComponent\(id\)\}\/appeal`, \{ json: statementOf\(statement\), schema: DecisionView \}\)/);
  });

  test("About you says where the appeal of each decision stands", () => {
    const row = (extra: Partial<AuthorCaseRow>): AuthorCaseRow => ({ id: id(3), kind: "final", outcome: "restricted", decidedOn: "2026-10-04", post: { id: id(1), createdAt: TIME }, actions: ["remove"], endedInterim: false, ruleId: "R3", legal: false, appealUntil: null, reversedOn: null, appeal: null, ...extra });
    const list = (extra: Partial<AuthorCaseRow>) => textOf(html(<DecisionsList decisions={[row(extra)]} />));
    expect(CASES_WORDS.appealState).toEqual({ pending: "Your appeal waits for a reviewer", kept: "Your appeal was answered: korbat kept its decision", partly_reversed: "Your appeal was answered: korbat reversed part of its decision", reversed: "Your appeal was answered: korbat reversed its decision" });
    for (const state of ["pending", "kept", "partly_reversed", "reversed"] as const) expect(list({ appeal: state }), state).toContain(CASES_WORDS.appealState[state]);
    expect(list({ appealUntil: "2027-04-04T10:00:00.000Z" })).toContain(CASES_WORDS.appealOpen("2027-04-04 10:00 UTC"));
    expect(list({})).not.toContain("appeal");
  });
});

describe("Ask for a re-examination", () => {
  const waiting: NoticeItemStatus = { position: 1, link: `${APP}/post/${id(1)}`, scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
  const item = (extra: Partial<NoticeItemStatus>): NoticeItemStatus => ({ ...waiting, decidedOn: "2026-10-05", ...extra });
  const open = item({ outcome: "no_violation", reexamination: { open: true, until: UNTIL } });
  const status = (items: NoticeItemStatus[]): NoticeStatus => ({ ref: "N-ABCDEFGH23", receivedAt: TIME, items, contact: null });

  test("the control stands beside an item whose answer can still be examined again: the sentence, an optional statement, and the button", () => {
    const out = html(<ItemLines items={[open]} onReexamine={noop} />);
    const text = textOf(out);
    expect(text).toContain(STATUS_WORDS.reexaminationOpen("2027-04-05 07:00 UTC"));
    expect(text).toContain(STATUS_WORDS.reexamineStatement);
    expect(out).toMatch(/<textarea[^>]*maxLength="2000"/i);
    expect(buttons(out)).toEqual([STATUS_WORDS.reexamine]);
    // Drawn without a way to ask (a list that only reads), the sentence stands alone.
    expect(buttons(html(<ItemLines items={[open]} />))).toEqual([]);
  });

  test("no control beside an item that waits, one that was asked about already, one past its window, a restriction, a changed outcome or a re-examination's answer", () => {
    const none: NoticeItemStatus[] = [
      waiting,
      item({ outcome: "no_violation", reexamination: { open: false, until: UNTIL } }),
      item({ outcome: "restricted_rule", rule: { id: "R3", title: "No hate" } }),
      item({ outcome: "reversed", changed: true }),
      item({ outcome: "no_violation", reexamines: true }),
      item({ outcome: "not_available" }),
    ];
    for (const one of none) expect(buttons(html(<ItemLines items={[one]} onReexamine={noop} />)), JSON.stringify(one).slice(0, 80)).toEqual([]);
  });

  test("an answer given while nobody could open the images keeps the control, also when it answers a re-examination", () => {
    const unseen = item({ outcome: "no_violation", unseen: true, reexamines: true, reexamination: { open: true, until: UNTIL } });
    const out = html(<ItemLines items={[unseen]} onReexamine={noop} />);
    expect(buttons(out)).toEqual([STATUS_WORDS.reexamine]);
    expect(textOf(out)).not.toContain("final within korbat");
  });

  test("beside the control of an item whose added item can be examined again too, the page says that korbat examines the quoted post as well", () => {
    const origin = item({ suspect: true, outcome: "no_violation", reexamination: { open: true, until: UNTIL } });
    const added = (extra: Partial<NoticeItemStatus> = {}) => item({ position: 11, quotedBy: 1, suspect: true, link: `${APP}/post/${id(2)}`, outcome: "no_violation", reexamination: { open: true, until: UNTIL }, ...extra });
    expect(quotedExaminedToo([origin, added()], 0)).toBe(true);
    // Not for the added item itself, not while the added item waits or was asked about, and never for a report on another ground.
    expect(quotedExaminedToo([origin, added()], 1)).toBe(false);
    expect(quotedExaminedToo([origin, added({ reexamination: { open: false, until: UNTIL } })], 0)).toBe(false);
    expect(quotedExaminedToo([origin, added({ outcome: null, decidedOn: null, reexamination: null })], 0)).toBe(false);
    expect(quotedExaminedToo([{ ...origin, suspect: false }, added()], 0)).toBe(false);
    const both = textOf(html(<ItemLines items={[origin, added()]} onReexamine={noop} />));
    expect(both.split(STATUS_WORDS.reexamineBoth)).toHaveLength(2);
    expect(textOf(html(<ItemLines items={[origin, added({ reexamination: { open: false, until: UNTIL } })]} onReexamine={noop} />))).not.toContain(STATUS_WORDS.reexamineBoth);
  });

  test("the status page asks with the notice's reference, the page's token and the item's position, in the body of a POST", () => {
    const out = html(<NoticeStatusView status={status([open])} onReexamine={noop} />);
    expect(buttons(out)).toEqual([STATUS_WORDS.reexamine]);
    const page = read("app", "notice", "[ref].tsx");
    expect(page).toMatch(/moderation\.reexamineNotice\(ref, token, item\.position, /);
    const calls = read("lib", "moderation.ts");
    expect(calls).toMatch(/reexamineNotice: \(ref: string, token: string, position: number, statement: string\) => api\("\/api\/notices\/reexamine", \{ json: \{ ref, token, position, \.\.\.statementOf\(statement\) \}, schema: ReexamineResponse \}\)/);
    // No token ever travels in an address.
    expect(calls).not.toMatch(/[?&]t(oken)?=/);
  });

  test("Your reports asks by the item's id, which only the signed-in sender's list carries", () => {
    const listed: ReportItem = { ...open, id: id(8) };
    const out = html(<ReportsList page={{ reports: [{ ref: "N-ABCDEFGH23", receivedAt: TIME, items: [listed] }], reportMailStopped: false }} onReexamine={noop} />);
    expect(buttons(out)).toEqual([STATUS_WORDS.reexamine]);
    expect(buttons(html(<ReportsList page={{ reports: [{ ref: "N-ABCDEFGH23", receivedAt: TIME, items: [listed] }], reportMailStopped: false }} />))).toEqual([]);
    expect(read("app", "settings", "cases", "index.tsx")).toMatch(/moderation\.reexamineOwn\(item\.id, /);
    expect(read("lib", "moderation.ts")).toMatch(/reexamineOwn: \(itemId: string, statement: string\) => api\(`\/api\/moderation\/items\/\$\{encodeURIComponent\(itemId\)\}\/reexamine`, \{ json: statementOf\(statement\), schema: ReexamineResponse \}\)/);
  });
});
