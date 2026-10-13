import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AccountStanding, AuthorCaseRow, DecisionView, ReportItem } from "@korbat/contracts";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { DecisionsList, ReportsList, StandingBlock } from "../src/components/moderation/CasesLists";
import { ReportForm } from "../src/components/moderation/ReportForm";
import { messageFor } from "../src/lib/api";
import { CASE_ROW_WORDS, reportingLine, reportingNowLine, reportsRestrictedUntil, STANDING_TEXTS, standingDay, standingTime } from "../src/lib/standing";

/**
 * The app's part of the restriction of reporting (3e design, sections 9.2, 9.4, 9.6 and 9.8; Task 5): the report form's
 * restricted state, the Cases block's reporting line, the rows of a warning, a restriction, their lift and a restriction
 * ended with its warning, the mark on the person's own list of reports, and where a restriction stands now on its
 * decision's screen. Components are server-rendered with made-up answers.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/settings/cases",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));
vi.mock("@marsidev/react-turnstile", async () => {
  const { createElement } = await import("react");
  return { Turnstile: () => createElement("div", { "data-turnstile": "widget" }) };
});
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: () => createElement("img") };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .split(" ")
    .filter((part) => part !== "")
    .join(" ");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UNTIL = "2026-11-03T09:30:00.000Z";
const COUNTS = "2026-12-19T08:00:00.000Z";
const NONE: AccountStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };
const restricted: AccountStanding = { ...NONE, reporting: { warning: { decisionId: id(1), countsUntil: COUNTS }, restriction: { decisionId: id(2), until: UNTIL } } };
const warned: AccountStanding = { ...NONE, reporting: { warning: { decisionId: id(1), countsUntil: COUNTS }, restriction: null } };

describe("3e Task 5: the words (design, sections 9.2, 9.4, 9.6 and 9.8)", () => {
  test("each sentence is the design's, every time printed as standingTime or standingDay prints it", () => {
    expect(STANDING_TEXTS.report.restricted(UNTIL)).toBe(
      `korbat has restricted your reports under its rules until ${standingTime(UNTIL)}, after a warning, because several of them were plainly unfounded. The decision is under Settings, Cases, where you can appeal it. You can still report illegal content: choose "It is illegal". For the sexual abuse or exploitation of a child, choose the third answer.`,
    );
    expect(STANDING_TEXTS.cases.restricted(UNTIL)).toBe(`Your reports under korbat's rules are restricted until ${standingTime(UNTIL)}.`);
    expect(STANDING_TEXTS.cases.warned(COUNTS)).toBe(`A warning about your reports counts until ${standingTime(COUNTS)}.`);
    expect(STANDING_TEXTS.reports.marked).toBe("A moderator marked this report as manifestly unfounded (Terms, Reporting in bad faith). You can ask for a re-examination.");
    expect(STANDING_TEXTS.reporting.warningGone(UNTIL)).toBe(`Ended on ${standingDay(UNTIL)} with the warning it rested on, which korbat lifted.`);
    expect(CASE_ROW_WORDS.restricted(30)).toBe("your reports under the rules restricted for 30 days");
    expect(CASE_ROW_WORDS.restricted(1)).toBe("your reports under the rules restricted for 1 day");
    // A refusal's own words are the restricted sentence without its date, which /me adds on the form.
    expect(messageFor("reporting_restricted")).toBe(STANDING_TEXTS.report.restricted(UNTIL).replace(` until ${standingTime(UNTIL)}`, ""));
  });
});

describe("3e Task 5: the report form, Your standing and the lists (design, sections 9.4 and 9.6)", () => {
  test("the report form disables its first choice with [report.restricted] while a restriction runs, and leaves the notice of illegality and the path for child sexual abuse material open", () => {
    expect(reportsRestrictedUntil(restricted)).toBe(UNTIL);
    expect(reportsRestrictedUntil(warned)).toBeNull();
    const out = html(<ReportForm signedIn given={{ kind: "post", id: id(1) }} standing={restricted} />);
    expect(textOf(out)).toContain(STANDING_TEXTS.report.restricted(UNTIL));
    const radios = (out.match(/<[a-z]+ [^>]*role="radio"[^>]*>/g) ?? []).slice(0, 3);
    expect(radios).toHaveLength(3);
    expect(radios[0]).toContain('aria-disabled="true"');
    expect(radios[1]).not.toContain('aria-disabled="true"');
    expect(radios[2]).not.toContain('aria-disabled="true"');
    // A warning restricts nothing: no choice is disabled.
    const open = (html(<ReportForm signedIn given={{ kind: "post", id: id(1) }} standing={warned} />).match(/<[a-z]+ [^>]*role="radio"[^>]*>/g) ?? []).slice(0, 3);
    expect(open).toHaveLength(3);
    for (const radio of open) expect(radio).not.toContain('aria-disabled="true"');
  });

  test("Your standing says until when the reports are restricted, else until when a warning counts, else nothing of reporting", () => {
    expect(reportingLine(restricted)).toBe(STANDING_TEXTS.cases.restricted(UNTIL));
    expect(reportingLine(warned)).toBe(STANDING_TEXTS.cases.warned(COUNTS));
    expect(reportingLine(NONE)).toBeNull();
    expect(textOf(html(<StandingBlock activeStrikes={0} standing={restricted} />))).toContain(STANDING_TEXTS.cases.restricted(UNTIL));
    expect(textOf(html(<StandingBlock activeStrikes={0} standing={warned} />))).toContain(STANDING_TEXTS.cases.warned(COUNTS));
    expect(textOf(html(<StandingBlock activeStrikes={0} standing={NONE} />))).not.toContain("reports");
  });

  test("a row names a warning, a restriction with its days, the lift of either, and a restriction a reversal ended", () => {
    const row = (extra: Partial<AuthorCaseRow>): AuthorCaseRow => ({
      id: id(3),
      kind: "final",
      outcome: "restricted",
      decidedOn: "2026-09-20",
      post: null,
      actions: [],
      endedInterim: false,
      ruleId: "R6",
      legal: false,
      appealUntil: null,
      reversedOn: null,
      appeal: null,
      strike: null,
      ...extra,
    });
    const text = textOf(
      html(
        <DecisionsList
          decisions={[
            row({ id: id(4), actions: ["warn_reporting"] }),
            row({ id: id(5), actions: ["restrict_reporting"], reportingDays: 7 }),
            row({ id: id(6), kind: "review", outcome: "reversed", ruleId: null, actions: ["lift_reporting"], endedStanding: ["restrict_reporting"] }),
          ]}
        />,
      ),
    );
    expect(text).toContain(CASE_ROW_WORDS.warned);
    expect(text).toContain(CASE_ROW_WORDS.restricted(7));
    expect(text).toContain(`${CASE_ROW_WORDS.reportingLifted}, ${CASE_ROW_WORDS.restrictionEnded}`);
  });

  test("the sender's own list shows the mark with the released outcome, and an item without a mark that counts reads as before", () => {
    const item = (extra: Partial<ReportItem>): ReportItem => ({
      id: id(7),
      position: 1,
      link: "http://localhost:8081/post/x",
      scope: null,
      suspect: false,
      sealed: false,
      unseen: false,
      quotedBy: null,
      outcome: "no_violation",
      decidedOn: "2026-10-05",
      changed: false,
      reexamines: false,
      reexamination: { open: true, until: "2027-04-05T09:00:00.000Z" },
      unfounded: true,
      ...extra,
    });
    const page = (items: ReportItem[]) => textOf(html(<ReportsList page={{ reports: [{ ref: "N-ABCDEFGH23", receivedAt: "2026-10-01T09:00:00.000Z", items }], reportMailStopped: false }} onReexamine={async () => undefined} />));
    expect(page([item({})])).toContain(STANDING_TEXTS.reports.marked);
    expect(page([item({ unfounded: false })])).not.toContain(STANDING_TEXTS.reports.marked);
  });
});

describe("3e Task 5: where a restriction of reporting stands now (design, section 9.2)", () => {
  const view = (reportingStanding: DecisionView["reportingStanding"]): DecisionView => ({
    id: id(2),
    kind: "final",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R6",
    rulesVersion: 3,
    redressVersion: 2,
    legalReference: null,
    facts: "Of the reports the account sent between korbat's warning of 2026-09-20 and 2026-10-12, a moderator marked 3 as manifestly unfounded.",
    reason: "The reports named nothing a rule could cover.",
    source: "own_initiative",
    decidedAt: "2026-10-12T09:30:00.000Z",
    post: null,
    measures: [{ kind: "restrict_reporting", mediaId: null, noEffect: null, sealed: null, basis: "reports", days: 22, endsAt: UNTIL, warnedAt: "2026-09-20T08:00:00.000Z" }],
    reversals: [],
    endedMeasures: [],
    reviewed: null,
    appealUntil: "2027-04-12T09:30:00.000Z",
    reversedOn: null,
    content: { kind: "account", handle: "someone", displayName: "Someone", bio: "" },
    appeal: null,
    strike: null,
    standing: null,
    reportingStanding,
  });

  test("its four states, each with its sentence; a lift and an end with the warning link to the decision that did it", () => {
    const LIFTED = "2026-10-20T09:00:00.000Z";
    expect(reportingNowLine({ state: "running", until: UNTIL, endedAt: null, endedBy: null })).toEqual({ text: STANDING_TEXTS.reporting.running(UNTIL), link: null });
    expect(reportingNowLine({ state: "ended", until: UNTIL, endedAt: null, endedBy: null })).toEqual({ text: STANDING_TEXTS.reporting.ended(UNTIL), link: null });
    expect(reportingNowLine({ state: "lifted", until: UNTIL, endedAt: LIFTED, endedBy: id(8) })).toEqual({ text: STANDING_TEXTS.reporting.lifted(LIFTED), link: id(8) });
    expect(reportingNowLine({ state: "basis_ended", until: UNTIL, endedAt: LIFTED, endedBy: id(9) })).toEqual({ text: STANDING_TEXTS.reporting.warningGone(LIFTED), link: id(9) });
    const running = textOf(html(<DecisionDetail view={view({ state: "running", until: UNTIL, endedAt: null, endedBy: null })} />));
    expect(running).toContain(STANDING_TEXTS.reporting.title);
    expect(running).toContain(STANDING_TEXTS.reporting.running(UNTIL));
    // The statement reads as it was sent: its restriction sentence names the warning it follows.
    expect(running).toContain("korbat restricted your reports under its rules for 22 days");
    const gone = html(<DecisionDetail view={view({ state: "basis_ended", until: UNTIL, endedAt: LIFTED, endedBy: id(9) })} />);
    expect(textOf(gone)).toContain(STANDING_TEXTS.reporting.warningGone(LIFTED));
    expect(gone).toContain(`href="/settings/cases/${id(9)}"`);
    // A decision without a restriction has no such block.
    expect(textOf(html(<DecisionDetail view={view(null)} />))).not.toContain(STANDING_TEXTS.reporting.running(UNTIL));
  });
});
