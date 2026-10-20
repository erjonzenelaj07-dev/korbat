import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AUTOMATION_RULES, ModerationErrorCode, OBJECTION_TEXT_MAX, type AuthorCaseRow, type DecisionView } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS } from "@korbat/rules";
import { DecisionsList } from "../src/components/moderation/CasesLists";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { messageFor } from "../src/lib/api";
import { utcMinute } from "../src/lib/moderation";
import { AUTO_WORDS } from "../src/lib/moderation-words";

/**
 * A measure a program took, as its author sees it (3d design, sections 7.10, 9.4, 9.6 and 9.7; Task 6): the decision's
 * screen with [auto.chip] beside the day and the statement of a decision without a decider; "Ask for a person" in its
 * three states, [auto.ask] with [auto.askLead], [auto.asked] with the published target and [auto.decided] with a link;
 * the row of "About you"; objection_not_open in the app's words; and the request the screen sends, read from the source.
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
/** Every run of white space: a tab, a line feed, a carriage return or a space, built from their codes. */
const SPACES = new RegExp(`[${String.fromCharCode(9, 10, 13, 32)}]+`, "g");
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(SPACES, " ")
    .trim();
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button) [^>]*role="button"[^>]*>(.*?)<[/](?:div|button)>/g)].map((match) => textOf(match[1]!));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DECIDED = "2026-10-19T09:15:00.000Z";
const ASKED = "2026-10-19T10:00:00.000Z";
const noop = async () => undefined;

/** A program's withhold of an image, as the author's screen reads it, with "Ask for a person" in the state given. */
const program = (askPerson: DecisionView["askPerson"]): DecisionView => ({
  id: id(3),
  kind: "interim",
  outcome: "restricted",
  ground: "incompatible",
  ruleId: "R1",
  rulesVersion: 3,
  redressVersion: 4,
  legalReference: null,
  facts: null,
  reason: null,
  source: "own_initiative",
  decidedAt: DECIDED,
  post: { id: id(1), createdAt: "2026-10-19T08:30:00.000Z" },
  measures: [{ kind: "withhold_media", mediaId: id(2), noEffect: null, sealed: null }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
  automatedDetection: true,
  automatedDecision: "fully",
  signal: { kind: "r1_score", source: null, matchKind: null, listedAs: null, viewed: null },
  appealUntil: null,
  reversedOn: null,
  content: { kind: "post", body: "a photo", deletedByAuthor: false, images: [], imageCount: 1, imagesHidden: null },
  appeal: null,
  strike: null,
  standing: null,
  askPerson,
});

describe("a program's decision on its screen (9.4)", () => {
  test("[auto.chip] beside the day, the statement of a decision without a decider, and no appeal", () => {
    const shown = textOf(html(<DecisionDetail view={program({ state: "open" })} onAppeal={noop} onAsk={noop} />));
    expect(shown).toContain(`${AUTO_WORDS.chip}, 2026-10-19`);
    for (const sentence of [STATEMENT_WORDS.automated.until.r1, STATEMENT_WORDS.automated.fully.r1, REDRESS_TEXTS[4].askPerson!]) expect(shown).toContain(sentence);
    expect(shown).not.toContain("You can appeal this decision until");
    // A decision with a decider carries no chip.
    expect(textOf(html(<DecisionDetail view={{ ...program(null), automatedDecision: "not_automated" }} />))).not.toContain(AUTO_WORDS.chip);
  });

  test("[auto.ask] while the measure is in force and nothing was asked; its field under [auto.askLead]", () => {
    const out = html(<DecisionDetail view={program({ state: "open" })} onAsk={noop} />);
    expect(buttons(out)).toContain(AUTO_WORDS.ask);
    expect(AUTO_WORDS.askLead).toBe(
      "Write anything a person should know. You can send one message. A moderator reads it and lifts the measure or decides the case; for sealed images an admin does. You get that decision's statement either way. You do not need to cite rules or law.",
    );
    // The field's bound is the contracts' own.
    expect(OBJECTION_TEXT_MAX).toBe(2000);
    expect(read("components", "moderation", "DecisionDetail.tsx")).toContain("maxLength={OBJECTION_TEXT_MAX}");
    // Without a way to send it the screen offers no button.
    expect(buttons(html(<DecisionDetail view={program({ state: "open" })} />))).not.toContain(AUTO_WORDS.ask);
  });

  test("[auto.asked] with the time, the published target and the text as sent, and no button", () => {
    const text = "<script>alert(1)</script> It is a painting.";
    const out = html(<DecisionDetail view={program({ state: "asked", text, createdAt: ASKED })} onAsk={noop} />);
    const shown = textOf(out);
    expect(shown).toContain(AUTO_WORDS.asked(utcMinute(ASKED)));
    expect(AUTO_WORDS.asked("x")).toContain(`korbat's target is an answer within ${AUTOMATION_RULES.objectionTargetHours} hours.`);
    expect(out).not.toContain("<script>");
    expect(shown).toContain("It is a painting.");
    expect(buttons(out)).not.toContain(AUTO_WORDS.ask);
  });

  test("[auto.decided] with a link to the person's decision, and no button", () => {
    const out = html(<DecisionDetail view={program({ state: "decided", decisionId: id(9), decidedAt: ASKED })} onAsk={noop} />);
    expect(textOf(out)).toContain(AUTO_WORDS.decided(utcMinute(ASKED)));
    expect(out).toContain(`href="/settings/cases/${id(9)}"`);
    expect(buttons(out)).not.toContain(AUTO_WORDS.ask);
  });

  test("objection_not_open is [auto.decided] without the day, in the app's own words; the screen posts the text to the decision's route", () => {
    expect(ModerationErrorCode.options).toContain("objection_not_open");
    expect(messageFor("objection_not_open")).toBe(AUTO_WORDS.notOpen);
    expect(AUTO_WORDS.notOpen).toBe("A person has decided since: the decision is listed under Settings, Cases.");
    expect(read("lib", "moderation.ts")).toContain("/api/moderation/decisions/${encodeURIComponent(id)}/objection`, { json: { text }, schema: DecisionView }");
    expect(read("app", "settings", "cases", "[id].tsx")).toContain("onAsk={ask}");
  });
});

describe("About you (9.6)", () => {
  test("a program's decision is listed as Taken by a program: what it did", () => {
    const row = {
      id: id(3),
      kind: "interim",
      outcome: "restricted",
      decidedOn: "2026-10-19",
      post: { id: id(1), createdAt: "2026-10-19T08:30:00.000Z" },
      actions: ["withhold_media"],
      ruleId: "R1",
      legal: false,
      appealUntil: null,
      appeal: null,
      reversedOn: null,
      endedInterim: false,
      byProgram: true,
    } as unknown as AuthorCaseRow;
    const shown = textOf(html(<DecisionsList decisions={[row]} />));
    expect(shown).toContain(AUTO_WORDS.row(""));
    expect(textOf(html(<DecisionsList decisions={[{ ...row, byProgram: false }]} />))).not.toContain(AUTO_WORDS.chip);
  });
});
