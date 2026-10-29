import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  ACCOUNT_SUSPECT_SCOPE,
  MEASURES,
  OUTCOME_PHRASES,
  SUSPECT_NO_SEAL,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  itemOutcomeWords,
  type AccountStanding,
  type AuthorCaseRow,
  type DecisionView,
  type HiddenMedia,
  type MeResponse,
  type MediaView,
  type NoticeItemStatus,
  type NoticeStatus,
  type PostView,
  type ReportsPage,
} from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, getRule, statementParagraphs } from "@korbat/rules";
import NoticePage from "../src/app/notice/[ref]";
import { HandleSection } from "../src/app/settings/profile";
import { DecisionsList, ReportsList, StandingBlock } from "../src/components/moderation/CasesLists";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { NoticeNotFound, NoticeStatusView } from "../src/components/moderation/NoticeStatusView";
import { SettingsNav } from "../src/components/SettingsNav";
import { HIDDEN_IMAGE, SEALED_IMAGE } from "../src/components/social/HiddenImage";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard } from "../src/components/social/PostCard";
import { ApiError, messageFor } from "../src/lib/api";
import { chipText, fragmentToken, itemRedress, utcMinute } from "../src/lib/moderation";
import { CASES_WORDS, CHIP_WORDS, DECISION_WORDS, STATUS_WORDS } from "../src/lib/moderation-words";
import { CASE_ROW_WORDS, STANDING_TEXTS, bannerSentences, isSuspendedRefusal, refusalSentence, standingDay, standingTime } from "../src/lib/standing";
import { RefusedNotice } from "../src/components/moderation/RefusedNotice";

/**
 * The notice status page, the cases screens and the decision screen, the chips and the labels in the web app (3c design,
 * section 9). An outcome's words come from the contracts and a statement's from the rulebook's package, so the tests hold
 * the screens to those functions and pin only the screens' own words. The components are server-rendered with made-up
 * answers in each state; what a static render cannot show (a request, where a token travels) is read from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/settings/cases",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
// react-native-reanimated is mocked once for every test file in test/setup.ts.

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
const loaded = (markup: string): string[] => [...markup.matchAll(/data-uri="([^"]+)"/g)].map((match) => match[1]!);
/** The text of every button in the markup. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
const count = (whole: string, part: string): number => whole.split(part).length - 1;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const APP = "http://localhost:8081";
const TIME = "2026-10-04T10:00:00.000Z";

const waiting: NoticeItemStatus = { position: 1, link: `${APP}/post/${id(1)}`, scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
const item = (extra: Partial<NoticeItemStatus>): NoticeItemStatus => ({ ...waiting, decidedOn: "2026-10-05", ...extra });
const status = (items: NoticeItemStatus[], contact: NoticeStatus["contact"] = null): NoticeStatus => ({ ref: "N-ABCDEFGH23", receivedAt: TIME, items, contact });
const page = (items: NoticeItemStatus[], contact?: NoticeStatus["contact"]) => html(<NoticeStatusView status={status(items, contact)} />);
const UNTIL = "2027-04-05T07:00:00.000Z";

describe("the words", () => {
  test("the status page's own sentences are the design's", () => {
    expect(STATUS_WORDS.added(2, `${APP}/post/${id(9)}`)).toBe(`The post that item 2 quotes (${APP}/post/${id(9)}), added by korbat`);
    expect(STATUS_WORDS.reexaminationLabel).toBe("Re-examination");
    expect(STATUS_WORDS.reexaminationOpen("2027-04-05")).toBe("A moderator decides it again as a new report. You can ask once for each item, within six months of being told, until 2027-04-05.");
    expect(STATUS_WORDS.final).toBe("This is final within korbat. You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.");
    expect(STATUS_WORDS.courts).toBe("You can go to court, or complain to the Digital Services Coordinator of the EU country where you live.");
    expect(STATUS_WORDS.confirm).toBe("Yes, I sent this: keep me informed");
    expect(STATUS_WORDS.stop).toBe("I did not send this: stop korbat's report emails to this address");
    expect(STATUS_WORDS.stopHint).toBe(
      "This also stops korbat's emails about reports you send yourself from this address, signed in or not, until you undo it on this page or, if a korbat account uses this address, under Settings, Cases, Your reports.",
    );
    expect(STATUS_WORDS.stopped).toBe("korbat's report emails to this address are stopped.");
    expect(STATUS_WORDS.undo).toBe("Undo: email this address about reports again");
  });

  test("the cases screens' and the decision screen's own sentences are the design's", () => {
    expect(CASES_WORDS.tabs).toEqual({ about: "About you", reports: "Your reports" });
    expect(CASES_WORDS.mailStopped).toBe("korbat does not email you about your reports, because someone using your email address asked it to stop. Their outcomes are listed here.");
    expect(CASES_WORDS.resume).toBe("Email me about my reports again");
    expect(CASES_WORDS.resumeHint).toBe("korbat may then also email this address about reports sent without an account that give it.");
    expect(DECISION_WORDS.post("2026-10-04 10:00 UTC")).toBe("Your post of 2026-10-04 10:00 UTC");
    expect(DECISION_WORDS.r4Redacted).toBe("Content erased when the R4 decision became final");
    expect(DECISION_WORDS.erased("2026-10-05")).toBe("korbat's copy of the content this decision was made on was erased on 2026-10-05 under its retention rules (Terms, Your data).");
    expect(DECISION_WORDS.postKept).toBe("The post itself stays in your profile while you keep it.");
    expect(DECISION_WORDS.deleted).toBe("You deleted this post. korbat keeps this copy for the case for the periods in its terms.");
    expect(DECISION_WORDS.deletedImages).toBe("Images kept for the case, not shown");
    expect(DECISION_WORDS.resetDecision).toBe("The decision that reset it");
    expect(DECISION_WORDS.appeal).toBe("Appeal");
    expect(DECISION_WORDS.reversed("2026-10-06")).toBe("Reversed in full on 2026-10-06: nothing of this decision is in force, so there is nothing to appeal.");
    expect(SEALED_IMAGE).toBe("Sealed: not shown to anyone, you included");
    expect(HIDDEN_IMAGE).toBe("Image hidden by korbat moderation");
  });
});

describe("the notice status page", () => {
  test("shows the reference, when korbat received it, and each item with its link; an undecided item says so and nothing more", () => {
    const out = page([waiting, { ...waiting, position: 2, link: `${APP}/u/ada`, scope: "account" }]);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(STATUS_WORDS.received(utcMinute(TIME)));
    expect(text).toContain(`${APP}/post/${id(1)}`);
    expect(text).toContain(`${APP}/u/ada`);
    expect(count(text, STATUS_WORDS.waiting)).toBe(2);
    for (const words of [STATUS_WORDS.final, STATUS_WORDS.courts, STATUS_WORDS.reexaminationLabel, "This answer concerns"]) expect(text).not.toContain(words);
    // Opened from the link shown on screen: no contact buttons.
    expect(buttons(out)).toEqual([]);
  });

  test("a decided item reads the words the mail reads: the contracts' one composition from the item's own facts", () => {
    const rule = { id: "R3" as const, title: getRule("R3")!.title };
    const items = [
      item({ outcome: "restricted_rule", rule }),
      item({ position: 2, outcome: "restricted_legal", noEffect: true }),
      item({ position: 3, outcome: "no_violation", reexamination: { open: true, until: UNTIL } }),
      item({ position: 4, link: `${APP}/u/ada`, scope: "account", outcome: "not_available" }),
    ];
    const text = textOf(page(items));
    for (const one of items) expect(text).toContain(itemOutcomeWords(one)!);
    expect(text).toContain(`access restricted: it breaks korbat rule R3 (${rule.title}).`);
    expect(text).toContain(STATUS_WORDS.decided("2026-10-05"));
    // A link that named nothing reads no scope sentence, though the answer keeps the item's scope.
    expect(text).not.toContain("This answer concerns the account's display name and bio.");
  });

  test("a report on the anonymous path reads the phrases of that path, each of them, and after an account's outcome that the answer concerns the images on its posts", () => {
    const sealed = textOf(page([item({ suspect: true, sealed: true, outcome: "restricted_rule", rule: { id: "R2", title: getRule("R2")!.title } })]));
    expect(sealed).toContain(SUSPECT_OUTCOME_PHRASES.sealed);
    expect(sealed).not.toContain("it breaks korbat rule");
    const dismissed = textOf(page([item({ suspect: true, outcome: "no_violation" })]));
    expect(dismissed).toContain(SUSPECT_OUTCOME_PHRASES.no_action);
    expect(dismissed).not.toContain(OUTCOME_PHRASES.no_violation);
    const onText = textOf(page([item({ suspect: true, outcome: "restricted_rule", rule: { id: "R5", title: getRule("R5")!.title } })]));
    expect(onText).toContain(SUSPECT_NO_SEAL);
    const account = textOf(page([item({ link: `${APP}/u/ada`, suspect: true, scope: "account_suspect", outcome: "not_evident" })]));
    expect(account).toContain(`${SUSPECT_OUTCOME_PHRASES.no_action} ${ACCOUNT_SUSPECT_SCOPE}`);
    // A rule report about an account that the sealing decision answered too: the sealed phrase, then the same scope.
    const beside = textOf(page([item({ link: `${APP}/u/ada`, sealed: true, scope: "account_suspect", outcome: "restricted_rule", rule: { id: "R2", title: getRule("R2")!.title } })]));
    expect(beside).toContain(`${SUSPECT_OUTCOME_PHRASES.sealed} ${ACCOUNT_SUSPECT_SCOPE}`);
  });

  test("an answer given while nobody could open the post's images reads UNSEEN_NO_ACTION with the re-examination still open beside it, also when it answers a re-examination, and is never called final", () => {
    const unseen = item({ outcome: "no_violation", unseen: true, reexamination: { open: true, until: UNTIL } });
    for (const one of [unseen, { ...unseen, reexamines: true }]) {
      const text = textOf(page([one]));
      expect(text).toContain(UNSEEN_NO_ACTION);
      expect(text).toContain(STATUS_WORDS.reexaminationOpen(utcMinute(UNTIL)));
      expect(text).not.toContain(STATUS_WORDS.final);
      expect(text).not.toContain(STATUS_WORDS.courts);
      expect(itemRedress(one)).toBe("reexamination");
    }
    // The re-examination's own answer is labelled as one.
    expect(textOf(page([{ ...unseen, reexamines: true }]))).toContain(STATUS_WORDS.reexaminationLabel);
  });

  test("beside an outcome: that it can still be examined again while that is open; that it is final within korbat when it was changed or answers a re-examination; the courts for any other", () => {
    const open = item({ outcome: "not_evident", reexamination: { open: true, until: UNTIL } });
    const asked = item({ outcome: "no_violation", reexamination: { open: false, until: UNTIL } });
    const answer = item({ outcome: "no_violation", reexamines: true });
    const changed = item({ outcome: "reversed", changed: true });
    const restricted = item({ outcome: "restricted_legal" });
    expect([open, asked, answer, changed, restricted, waiting].map(itemRedress)).toEqual(["reexamination", "courts", "final", "final", "courts", "waiting"]);
    // A restriction answered while the images were out of sight is no "no action for now": changed, it is final.
    expect(itemRedress(item({ outcome: "restricted_rule", unseen: true, reexamines: true }))).toBe("final");

    const openText = textOf(page([open]));
    expect(openText).toContain(STATUS_WORDS.reexaminationOpen(utcMinute(UNTIL)));
    expect(openText).not.toContain(STATUS_WORDS.courts);
    for (const one of [asked, restricted]) {
      const text = textOf(page([one]));
      expect(text).toContain(STATUS_WORDS.courts);
      expect(text).not.toContain(STATUS_WORDS.final);
      expect(text).not.toContain("A moderator decides it again");
    }
    for (const one of [answer, changed]) {
      const text = textOf(page([one]));
      expect(text).toContain(STATUS_WORDS.final);
      expect(count(text, "go to court")).toBe(1);
    }
    expect(textOf(page([answer]))).toContain(STATUS_WORDS.reexaminationLabel);
    expect(textOf(page([changed]))).not.toContain(STATUS_WORDS.reexaminationLabel);
  });

  test("an item korbat added for a quoted post is headed as such, after the item it was added for, with an outcome of its own", () => {
    const origin = item({ position: 2, suspect: true, outcome: "no_violation" });
    const added = item({ position: 12, link: `${APP}/post/${id(9)}`, suspect: true, sealed: true, quotedBy: 2, outcome: "restricted_rule", rule: { id: "R2", title: getRule("R2")!.title } });
    const text = textOf(page([origin, added]));
    const heading = STATUS_WORDS.added(2, `${APP}/post/${id(9)}`);
    expect(text).toContain(heading);
    expect(text.indexOf(heading)).toBeGreaterThan(text.indexOf(STATUS_WORDS.item(2)));
    expect(text).toContain(SUSPECT_OUTCOME_PHRASES.sealed);
    expect(text).not.toContain(STATUS_WORDS.item(12));
  });

  test("opened from a mail's link, the page shows the contact's state with its two buttons and what a stop also stops; opened from the on-screen link, none", () => {
    const fromMail = page([waiting], { given: true, confirmed: false, stopped: false });
    expect(buttons(fromMail)).toEqual([STATUS_WORDS.confirm, STATUS_WORDS.stop]);
    expect(textOf(fromMail)).toContain(STATUS_WORDS.stopHint);
    expect(textOf(fromMail)).toContain(STATUS_WORDS.unconfirmed);
    expect(textOf(page([waiting], { given: true, confirmed: true, stopped: false }))).toContain(STATUS_WORDS.confirmed);
    for (const contact of [{ given: true, confirmed: null, stopped: null }, { given: false, confirmed: null, stopped: null }, null]) {
      const out = page([waiting], contact);
      expect(buttons(out)).toEqual([]);
      expect(textOf(out)).not.toContain(STATUS_WORDS.stopHint);
    }
  });

  test("a stopped address reads that the emails are stopped, with the one button that undoes it", () => {
    const out = page([waiting], { given: true, confirmed: false, stopped: true });
    expect(textOf(out)).toContain(STATUS_WORDS.stopped);
    expect(buttons(out)).toEqual([STATUS_WORDS.undo]);
    expect(textOf(out)).not.toContain(STATUS_WORDS.confirm);
    // The undo is the confirm choice, which lifts the stop; the other two send their own.
    const view = read("components", "moderation", "NoticeStatusView.tsx");
    expect(view).toContain('<Button label={STATUS_WORDS.undo} onPress={() => onContact?.("confirm")}');
    expect(view).toContain('<Button label={STATUS_WORDS.confirm} onPress={() => onContact?.("confirm")}');
    expect(view).toContain('<Button label={STATUS_WORDS.stop} onPress={() => onContact?.("stop")}');
  });

  test("a wrong reference or token is one sentence, whatever was wrong", () => {
    expect(textOf(html(<NoticeNotFound />))).toContain("We could not find a report with this link.");
  });

  test("the token is read from the address's fragment and sent in the body of a POST, never in a query", () => {
    const token = "A".repeat(20) + "b_-".repeat(7) + "zz";
    expect(fragmentToken(`#t=${token}`)).toBe(token);
    for (const hash of ["", "#", `#t=${token}x`, `#t=${token.slice(1)}`, `#x=${token}`, `?t=${token}`, `#t=${token}&u=1`]) expect(fragmentToken(hash), hash).toBeNull();
    const screen = read("app", "notice", "[ref].tsx");
    expect(screen).toContain("fragmentToken(location.hash)");
    expect(screen).toContain("moderation.status(ref, token)");
    expect(screen).toContain("moderation.contact(ref, token, choice)");
    expect(screen).not.toMatch(/useLocalSearchParams<[^>]*\btoken\b/);
    const client = read("lib", "moderation.ts");
    expect(client).toContain('status: (ref: string, token: string) => api("/api/notices/status", { json: { ref, token }, schema: NoticeStatus })');
    expect(client).toContain('contact: (ref: string, token: string, choice: "confirm" | "stop") => api("/api/notices/contact", { json: { ref, token, choice } })');
    // Before the fragment is read, and without one, the page says the link is no report's: it asks the API nothing.
    route.params = { ref: "N-ABCDEFGH23" };
    expect(textOf(html(<NoticePage />))).not.toContain("N-ABCDEFGH23");
    // The page is outside the settings, whose layout would send a signed-out reader to sign in.
    expect(readdirSync(path.join(SRC, "app", "notice"))).toEqual(["[ref].tsx"]);
  });
});

describe("Cases, under Settings", () => {
  test("the settings row has Cases, whose screens live in a folder of their own inside the settings layout", () => {
    const out = html(<SettingsNav current="cases" />);
    expect(hrefs(out)).toEqual(["/settings/appearance", "/settings/security", "/settings/privacy", "/settings/profile", "/settings/account", "/settings/import", "/settings/cases"]); // 3b Task 7: Import after Account.
    const current = (out.match(/<a\b[^>]*>/g) ?? []).filter((tag) => tag.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/settings/cases"');
    expect(textOf(out)).toContain("Cases");
    // 3d Task 2: a release's notice has its screen in a folder of its own, at /settings/cases/releases/<id>.
    // 3d Task 7: so has a refused upload's notice, at /settings/cases/uploads/<id>.
    expect(readdirSync(path.join(SRC, "app", "settings", "cases")).sort()).toEqual(["[id]", "[id].tsx", "index.tsx", "releases", "uploads"]);
    expect(readdirSync(path.join(SRC, "app", "settings", "cases", "releases")).sort()).toEqual(["[id].tsx"]);
    expect(read("app", "settings", "cases", "releases", "[id].tsx")).toContain('<SettingsNav current="cases" />');
    expect(readdirSync(path.join(SRC, "app", "settings", "cases", "uploads")).sort()).toEqual(["[id].tsx"]);
    expect(read("app", "settings", "cases", "uploads", "[id].tsx")).toContain('<SettingsNav current="cases" />');
    // 3e Task 4: the reply screen sits beside the decision's screen, at /settings/cases/<id>/reply.
    expect(readdirSync(path.join(SRC, "app", "settings", "cases", "[id]")).sort()).toEqual(["reply.tsx"]);
    for (const file of ["index.tsx", "[id].tsx"]) expect(read("app", "settings", "cases", file), file).toContain('<SettingsNav current="cases" />');
    // Two tabs, and the list each shows.
    const screen = read("app", "settings", "cases", "index.tsx");
    expect(tabsOf(screen)).toContain('role="tablist"');
    expect(screen).toContain("moderation.cases(");
    expect(screen).toContain("moderation.reports(");
    expect(screen).toContain("moderation.resumeReportMail()");
  });

  const row = (extra: Partial<AuthorCaseRow> = {}): AuthorCaseRow => ({
    id: id(3),
    kind: "final",
    outcome: "restricted",
    decidedOn: "2026-10-05",
    post: { id: id(1), createdAt: TIME },
    actions: ["remove"],
    endedInterim: false,
    ruleId: "R3",
    legal: false,
    appealUntil: "2027-04-05T10:00:00.000Z",
    reversedOn: null,
    appeal: null,
    strike: null,
    ...extra,
  });

  test("About you lists each decision with its day, what was done, the post's time, the rule or the law and where its appeal stands, each a link to its screen", () => {
    const rows = [
      row(),
      row({ id: id(4), kind: "interim", actions: ["seal_media", "withhold"], ruleId: null, legal: true, appealUntil: null }),
      row({ id: id(5), post: null, actions: ["reset_bio"], ruleId: "R6", appealUntil: null, reversedOn: "2026-10-06" }),
      row({ id: id(6), outcome: "no_violation", actions: [], endedInterim: true, ruleId: null, appealUntil: null }),
      row({ id: id(7), kind: "correction", outcome: "reversed", actions: ["restore"], ruleId: null, appealUntil: null }),
    ];
    const out = html(<DecisionsList decisions={rows} />);
    const text = textOf(out);
    expect(hrefs(out)).toEqual(rows.map((one) => `/settings/cases/${one.id}`));
    expect(count(text, CASES_WORDS.decidedOn("2026-10-05"))).toBe(5);
    expect(text).toContain(CASES_WORDS.post(utcMinute(TIME)));
    expect(text).toContain(CASES_WORDS.profile);
    // What was done, in the measures' own labels.
    for (const label of ["Remove", "Seal the images this case reaches", "Withhold the post", "Reset bio", "Lift the restriction of the post"]) expect(text, label).toContain(label);
    expect(text).toContain(CASES_WORDS.rule("R3"));
    expect(text).toContain(CASES_WORDS.law);
    expect(text).toContain(CASES_WORDS.whileDeciding);
    expect(text).toContain(CASES_WORDS.ended);
    expect(text).toContain(CASES_WORDS.correction);
    expect(count(text, "You can appeal until")).toBe(1);
    expect(text).toContain(CASES_WORDS.appealOpen(utcMinute("2027-04-05T10:00:00.000Z")));
    expect(text).toContain(CASES_WORDS.reversed("2026-10-06"));
    expect(textOf(html(<DecisionsList decisions={[]} />))).toContain(CASES_WORDS.noDecisions);
  });

  test("the answer to an appeal that kept the decision reads as a kept decision, never as No action; a reversal by what it lifted", () => {
    const kept = row({ id: id(8), kind: "review", outcome: "kept", actions: [], ruleId: null, appealUntil: null });
    const reversed = row({ id: id(9), kind: "review", outcome: "reversed", actions: ["restore"], ruleId: null, appealUntil: null });
    const text = textOf(html(<DecisionsList decisions={[kept, reversed, row()]} />));
    expect(CASES_WORDS.keptDecision).toBe("korbat kept its decision");
    expect(count(text, CASES_WORDS.keptDecision)).toBe(1);
    expect(text).not.toContain(CASES_WORDS.noAction);
    expect(text).toContain(MEASURES.restore.label);
    // A final decision without a measure that ended nothing still reads No action.
    expect(textOf(html(<DecisionsList decisions={[row({ id: id(10), outcome: "no_violation", actions: [], ruleId: null, appealUntil: null })]} />))).toContain(CASES_WORDS.noAction);
  });

  const reports = (extra: Partial<ReportsPage> = {}): ReportsPage => ({
    reports: [
      { ref: "N-ABCDEFGH23", receivedAt: TIME, items: [{ ...item({ link: `${APP}/u/old_handle`, scope: "account", outcome: "no_violation", reexamination: { open: true, until: UNTIL } }), id: id(21), unfounded: false }, { ...waiting, position: 2, id: id(22), unfounded: false }] },
      { ref: "N-BCDEFGH234", receivedAt: TIME, items: [{ ...item({ outcome: "not_evident", unseen: true, reexamination: { open: true, until: UNTIL } }), id: id(23), unfounded: false }] },
    ],
    nextCursor: null,
    reportMailStopped: false,
    ...extra,
  });

  test("Your reports lists each report with its items as the status page words them: the account under the handle the report named, the outcome once released, and whether it can still be examined again", () => {
    const answer = reports();
    const out = html(<ReportsList page={answer} />);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(`${APP}/u/old_handle`);
    expect(text).toContain(itemOutcomeWords(answer.reports[0]!.items[0]!)!);
    expect(text).toContain(STATUS_WORDS.reexaminationOpen(utcMinute(UNTIL)));
    expect(text).toContain(STATUS_WORDS.waiting);
    expect(text).toContain(UNSEEN_NO_ACTION);
    expect(text).not.toContain(STATUS_WORDS.final);
    // Without a stop there is no notice and no button.
    expect(text).not.toContain(CASES_WORDS.mailStopped);
    expect(buttons(out)).toEqual([]);
    expect(textOf(html(<ReportsList page={reports({ reports: [] })} />))).toContain(CASES_WORDS.noReports);
  });

  test("when the account's address stopped korbat's report mails, the tab says so above the list, with the button that resumes them and what that also allows", () => {
    const out = html(<ReportsList page={reports({ reportMailStopped: true })} />);
    const text = textOf(out);
    expect(text).toContain(CASES_WORDS.mailStopped);
    expect(buttons(out)).toEqual([CASES_WORDS.resume]);
    expect(text).toContain(CASES_WORDS.resumeHint);
    expect(text.indexOf(CASES_WORDS.mailStopped)).toBeLessThan(text.indexOf("N-ABCDEFGH23"));
    expect(read("lib", "moderation.ts")).toContain('resumeReportMail: () => api("/api/moderation/report-mail/resume", { method: "POST" })');
  });
});

describe("a decision's screen", () => {
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
  const image = (n: number) => ({ id: id(n), alt: `picture ${n}`, width: 800, height: 600, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
  const view = (extra: Partial<DecisionView> = {}): DecisionView => ({
    id: id(3),
    ...statement,
    appealUntil: "2027-04-04T10:00:00.000Z",
    reversedOn: null,
    content: { kind: "post", body: "the words that were judged", deletedByAuthor: false, images: [image(7)], imageCount: 1, imagesHidden: null },
    appeal: null,
    strike: null,
    standing: null,
    ...extra,
  });
  const screen = (extra: Partial<DecisionView> = {}) => html(<DecisionDetail view={view(extra)} />);

  test("3d (design, section 9.1): a statement links the rules page after the rule it names; one on the law alone does not", () => {
    const out = screen();
    const link = out.indexOf('href="/rules"');
    expect(link).toBeGreaterThan(-1);
    expect(textOf(out.slice(link))).toContain(DECISION_WORDS.rulesPage);
    expect(link).toBeGreaterThan(out.indexOf(textOf(statementParagraphs(view())[0]!).slice(0, 20)));
    expect(screen({ ground: "illegal", ruleId: null, legalReference: "the law" } as Partial<DecisionView>)).not.toContain('href="/rules"');
  });

  test("a final restriction: the statement as the mail rendered it, the post's time, the content it was made on, and Appeal with its deadline", () => {
    const out = screen();
    const text = textOf(out);
    for (const paragraph of statementParagraphs(view())) expect(text).toContain(paragraph);
    expect(text).toContain(`"${getRule("R3", 2)!.title}"`);
    expect(text).toContain(STATEMENT_WORDS.automation);
    expect(text).toContain(DECISION_WORDS.post("2026-09-01 08:30 UTC"));
    expect(text).toContain("the words that were judged");
    // The image comes from the app's own image route, with its description.
    expect(loaded(out)).toEqual([expect.stringContaining(`/api/media/${id(7)}/small.webp`)]);
    expect(out).toContain('alt="picture 7"');
    expect(text).toContain(DECISION_WORDS.appeal);
    expect(text).toContain(DECISION_WORDS.appealUntil("2027-04-04 10:00 UTC"));
    expect(text).not.toContain("Reversed in full");
  });

  test("a decision taken while korbat decides: the interim redress, and no Appeal", () => {
    const interim = { kind: "interim" as const, measures: [{ kind: "withhold" as const, mediaId: null, noEffect: null, sealed: null }], appealUntil: null };
    const text = textOf(screen(interim));
    expect(text).toContain(REDRESS_TEXTS[1].interim);
    expect(text).toContain(STATEMENT_WORDS.scope.interim);
    // Neither the section nor its sentence: the interim redress never says the word.
    expect(text).not.toContain("Appeal");
    expect(text).not.toContain("You can appeal this decision until");
    expect(text).not.toContain("Reversed in full");
  });

  test("a restriction reversed in full says on which day, in place of Appeal", () => {
    const text = textOf(screen({ appealUntil: null, reversedOn: "2026-10-06" }));
    expect(text).toContain(DECISION_WORDS.reversed("2026-10-06"));
    expect(text).not.toContain("You can appeal this decision until");
  });

  test("a post whose images are sealed keeps its text: each sealed image is drawn as its placeholder, and nothing is loaded for it", () => {
    const sealed = {
      kind: "interim" as const,
      ruleId: "R2" as const,
      measures: [{ kind: "seal_media" as const, mediaId: null, noEffect: null, sealed: { posts: 1, images: 2, deletedImages: 0 } }],
      appealUntil: null,
      content: { kind: "post" as const, body: "text beside the images", deletedByAuthor: false, images: [], imageCount: 2, imagesHidden: "sealed" as const },
    };
    const out = screen(sealed);
    const text = textOf(out);
    expect(text).toContain("text beside the images");
    expect(count(text, SEALED_IMAGE)).toBe(2);
    expect(loaded(out)).toEqual([]);
    expect(text).toContain(STATEMENT_WORDS.sealPost("2026-09-01 08:30 UTC", 2));
  });

  test("a post its author deleted: korbat's copy of the text under its own heading, and its images kept and not shown", () => {
    const out = screen({ content: { kind: "post", body: "deleted since", deletedByAuthor: true, images: [], imageCount: 2, imagesHidden: "deleted_by_author" } });
    const text = textOf(out);
    expect(text).toContain(DECISION_WORDS.deleted);
    expect(text.indexOf(DECISION_WORDS.deleted)).toBeLessThan(text.indexOf("deleted since"));
    expect(count(text, DECISION_WORDS.deletedImages)).toBe(1);
    expect(loaded(out)).toEqual([]);
    // A deleted post without images says nothing of images.
    expect(textOf(screen({ content: { kind: "post", body: "deleted since", deletedByAuthor: true, images: [], imageCount: 0, imagesHidden: "deleted_by_author" } }))).not.toContain(DECISION_WORDS.deletedImages);
  });

  test("content korbat no longer holds: erased under the retention rules on its day, with the profile sentence only for a post its author kept; or erased by the R4 decision", () => {
    const kept = textOf(screen({ content: { kind: "erased", contentErasedOn: "2027-04-06", postKept: true } }));
    expect(kept).toContain(`${DECISION_WORDS.erased("2027-04-06")} ${DECISION_WORDS.postKept}`);
    const gone = textOf(screen({ content: { kind: "erased", contentErasedOn: "2027-04-06", postKept: false } }));
    expect(gone).toContain(DECISION_WORDS.erased("2027-04-06"));
    expect(gone).not.toContain(DECISION_WORDS.postKept);
    const redacted = textOf(screen({ ruleId: "R4", content: { kind: "r4_redacted" } }));
    expect(redacted).toContain(DECISION_WORDS.r4Redacted);
    expect(redacted).not.toContain("was erased on");
    // The post's time stays on the screen whatever became of the content.
    for (const text of [kept, gone, redacted]) expect(text).toContain(DECISION_WORDS.post("2026-09-01 08:30 UTC"));
  });

  test("a decision about the account shows the fields as korbat copied them, and links the decision that reset a field while its value is still kept", () => {
    const reset = {
      post: null,
      ruleId: "R6" as const,
      measures: [{ kind: "reset_bio" as const, mediaId: null, noEffect: null, sealed: null }],
      content: { kind: "account" as const, handle: "ada", displayName: "Ada", bio: "what the bio said" },
    };
    const text = textOf(screen(reset));
    expect(text).toContain(`${DECISION_WORDS.bio} what the bio said`);
    expect(text).toContain(`${DECISION_WORDS.displayName} Ada`);
    expect(text).not.toContain("Your post of");
    // A later decision that lifts the reset: its statement says where the old value can be read, and the screen links there.
    const lifted = {
      kind: "correction" as const,
      outcome: "reversed" as const,
      ground: null,
      ruleId: null,
      facts: null,
      post: null,
      measures: [],
      reversals: [{ kind: "restore_bio" as const, mediaId: null, resetDecisionId: id(3), oldValueKept: true, resetRuleId: "R6" as const }],
      reviewed: { kind: "final" as const, ground: "incompatible" as const, ruleId: "R6" as const, rulesVersion: 2, legalReference: null, decidedAt: TIME },
      appealUntil: null,
      content: { kind: "account" as const, handle: "ada", displayName: "Ada", bio: "what the bio said" },
    };
    const out = screen({ id: id(8), ...lifted });
    expect(textOf(out)).toContain(STATEMENT_WORDS.oldValueKept);
    expect(textOf(out)).toContain(DECISION_WORDS.resetDecision);
    expect(hrefs(out)).toContain(`/settings/cases/${id(3)}`);
    // Once the old value is gone, nothing links there.
    const erased = screen({ id: id(8), ...lifted, reversals: [{ ...lifted.reversals[0]!, oldValueKept: false }] });
    expect(hrefs(erased)).not.toContain(`/settings/cases/${id(3)}`);
  });

  test("the screen asks for the decision by the id in its address and says when there is none for this account", () => {
    const source = read("app", "settings", "cases", "[id].tsx");
    expect(source).toContain("moderation.decision(id)");
    expect(source).toContain("DECISION_WORDS.notFound");
    expect(read("lib", "moderation.ts")).toContain("decision: (id: string) => api(`/api/moderation/decisions/${encodeURIComponent(id)}`, { schema: DecisionView })");
  });
});

describe("the chips and the labels", () => {
  const post = (extra: Partial<PostView> = {}): PostView => ({
    id: id(1),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false, avatar: null },
    body: "my own post",
    createdAt: TIME,
    state: "removed",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    imported: null,
    mentions: [],
    countsHidden: false,
    ...extra,
  });
  const me = (userId: string) => ({ status: "signed-in", me: { user: { id: userId, onboarded: true }, profile: { handle: "ada" } } });
  const image = (n: number, moderation?: MediaView["moderation"]): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp`, ...(moderation ? { moderation } : {}) });

  test("the chip's four texts: under review or removed, under a rule or as illegal content", () => {
    expect(CHIP_WORDS).toEqual({ underReview: "Under review", removed: "Removed", illegal: "illegal content" });
    const decision = { decisionId: id(3), ruleId: "R4" as const, legal: false, interim: true, strikeUntil: null };
    expect(chipText(decision)).toBe("Under review: R4");
    expect(chipText({ ...decision, ruleId: null, legal: true })).toBe("Under review: illegal content");
    expect(chipText({ ...decision, ruleId: "R3", interim: false })).toBe("Removed: R3");
    expect(chipText({ ...decision, ruleId: null, legal: true, interim: false })).toBe("Removed: illegal content");
  });

  test("3e: a removed post's chip names its strike while the strike stands and counts, with the day it stops counting", () => {
    const until = "2027-01-10T09:00:00.000Z";
    const decision = { decisionId: id(3), ruleId: "R3" as const, legal: false, interim: false, strikeUntil: until };
    expect(chipText(decision)).toBe(`Removed: R3, strike until ${standingDay(until)}`);
    expect(chipText({ ...decision, strikeUntil: null })).toBe("Removed: R3");
    session.state = me(id(900));
    const removed = textOf(html(<PostCard post={post({ moderation: decision })} />));
    expect(removed).toContain(STANDING_TEXTS.chip("Removed: R3", until));
  });

  test("the author's own withheld or removed post shows the chip as the button that opens the decision's sheet, which links its statement, amber while korbat decides and red once removed", () => {
    session.state = me(id(900));
    const removed = html(<PostCard post={post({ moderation: { decisionId: id(3), ruleId: "R3", legal: false, interim: false, strikeUntil: null } })} />);
    expect(textOf(removed)).toContain("Removed: R3");
    expect(hrefs(sheetOf(removed, id(3)))).toContain(`/settings/cases/${id(3)}`);
    const held = html(<PostCard post={post({ state: "withheld", moderation: { decisionId: id(4), ruleId: null, legal: true, interim: true, strikeUntil: null } })} />);
    expect(textOf(held)).toContain("Under review: illegal content");
    expect(hrefs(sheetOf(held, id(4)))).toContain(`/settings/cases/${id(4)}`);
    // The colours are class names, which a render without the style compiler does not carry: they are read from the source.
    const card = read("components", "social", "PostCard.tsx");
    expect(card).toContain('const tone: StatusTone = (decision ? decision.interim : post.state === "withheld") ? "review" : "restricted";');
    expect(card).toContain("<StatusChip tone={tone} label={words} onPress={decision ? openSheet : undefined} ref={chipRef} />");
    // Without the decision's facts the chip still says the state, and links nowhere.
    const bare = html(<PostCard post={post()} />);
    expect(textOf(bare)).toContain("Removed");
    expect(hrefs(bare).filter((href) => href.startsWith("/settings/cases"))).toEqual([]);
    // A post whose images are sealed keeps its text and its place, without a chip: the post itself is visible.
    const sealedMedia: HiddenMedia[] = [{ id: id(21), hidden: true, sealed: true }, { id: id(22), hidden: true, sealed: true }];
    const sealed = html(<PostCard post={post({ state: "visible", media: sealedMedia })} />);
    expect(textOf(sealed)).toContain("my own post");
    expect(count(textOf(sealed), SEALED_IMAGE)).toBe(2);
    expect(hrefs(sealed).filter((href) => href.startsWith("/settings/cases"))).toEqual([]);
    session.state = { status: "signed-out" };
    // Anyone else reads the placeholder of a hidden image for each of them.
    const others = html(<PostCard post={post({ state: "visible", media: [{ id: id(21), hidden: true }, { id: id(22), hidden: true }] })} />);
    expect(count(textOf(others), HIDDEN_IMAGE)).toBe(2);
    expect(textOf(others)).not.toContain(SEALED_IMAGE);
  });

  test("the author's own withheld image says Under review on itself and a removed one Removed, in the post and in the viewer; anyone else gets one placeholder for both", () => {
    const own = html(<MediaGrid media={[image(1, "withheld"), image(2, "removed"), image(3)]} postId={id(1)} own />);
    const text = textOf(own);
    expect(count(text, "Under review")).toBe(1);
    expect(count(text, "Removed")).toBe(1);
    // The author still sees their own images.
    expect(loaded(own)).toHaveLength(3);
    const noop = () => undefined;
    expect(textOf(html(<MediaViewerContent media={[image(1, "withheld")]} index={0} onIndex={noop} onClose={noop} />))).toContain("Under review");
    expect(textOf(html(<MediaViewerContent media={[image(2, "removed")]} index={0} onIndex={noop} onClose={noop} />))).toContain("Removed");
    expect(textOf(html(<MediaViewerContent media={[image(3)]} index={0} onIndex={noop} onClose={noop} />))).not.toMatch(/Under review|Removed/);
    // For anyone else the API sends the same hidden image for a withheld and a removed one: one placeholder, which does not say which.
    const hidden: HiddenMedia = { id: id(1), hidden: true };
    const others = textOf(html(<MediaGrid media={[hidden, { ...hidden, id: id(2) }]} postId={id(1)} />));
    expect(count(others, HIDDEN_IMAGE)).toBe(2);
    expect(others).not.toMatch(/Under review|Removed/);
  });
});

describe("3e: strikes on Cases and on the decision's screen (design, sections 9.2 and 9.4)", () => {
  const COUNTS = "2027-01-10T09:00:00.000Z";
  const row = (extra: Partial<AuthorCaseRow> = {}): AuthorCaseRow => ({
    id: id(3),
    kind: "final",
    outcome: "restricted",
    decidedOn: "2026-10-12",
    post: { id: id(1), createdAt: TIME },
    actions: ["remove", "strike"],
    endedInterim: false,
    ruleId: "R3",
    legal: false,
    appealUntil: null,
    reversedOn: null,
    appeal: null,
    strike: { countsUntil: COUNTS, overruledAt: null },
    ...extra,
  });
  const list = (extra: Partial<AuthorCaseRow>, now = new Date("2026-10-12T10:00:00.000Z")) => textOf(html(<DecisionsList decisions={[row(extra)]} now={now} />));

  test("the numbers of the sentences are STANDING_RULES', and a time names the device's minute and the UTC one", () => {
    expect(STANDING_TEXTS.cases.strikes(2)).toBe("Active strikes: 2 of 3. At 3, a moderator may announce a suspension; you would be told first and could reply.");
    expect(STANDING_TEXTS.cases.none).toBe("You have no active strikes.");
    expect(standingTime("2026-10-16T14:05:00.000Z").endsWith("(14:05 UTC)")).toBe(true);
    expect(standingTime("2026-10-16T14:05:00.000Z").startsWith(standingDay("2026-10-16T14:05:00.000Z"))).toBe(true);
  });

  test("Your standing stands above About you: the active strikes and what that many leads to, or that there are none", () => {
    expect(textOf(html(<StandingBlock activeStrikes={0} />))).toBe(`${STANDING_TEXTS.cases.title} ${STANDING_TEXTS.cases.none}`);
    expect(textOf(html(<StandingBlock activeStrikes={2} />))).toContain(STANDING_TEXTS.cases.strikes(2));
    const screen = read("app", "settings", "cases", "index.tsx");
    expect(screen).toContain("setActiveStrikes(page.activeStrikes)");
    expect(screen.indexOf("<StandingBlock")).toBeLessThan(screen.indexOf("<DecisionsList"));
  });

  test("a row names the strike after the post measure, with where it stands, and an overruling in its own words", () => {
    expect(list({})).toContain(`Remove, ${CASE_ROW_WORDS.strike} (${CASE_ROW_WORDS.counts(COUNTS)})`);
    expect(list({}, new Date("2027-02-01T00:00:00.000Z"))).toContain(`${CASE_ROW_WORDS.strike} (${CASE_ROW_WORDS.expired})`);
    expect(list({ strike: { countsUntil: COUNTS, overruledAt: "2026-10-20T08:00:00.000Z" } })).toContain(`${CASE_ROW_WORDS.strike} (${CASE_ROW_WORDS.overruled})`);
    expect(list({ kind: "correction", outcome: "reversed", actions: ["overrule", "restore"], strike: null })).toContain(`${CASE_ROW_WORDS.overrule}, ${MEASURES.restore.label}`);
  });

  test("the decision's screen says where its strike stands now, below the statement", () => {
    const view: DecisionView = {
      id: id(3),
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R3",
      rulesVersion: 3,
      redressVersion: 2,
      legalReference: null,
      facts: "The post attacks a group for its religion.",
      reason: "That is an attack on people, not on an idea.",
      source: "report",
      decidedAt: TIME,
      post: { id: id(1), createdAt: "2026-09-01T08:30:00.000Z" },
      measures: [
        { kind: "remove", mediaId: null, noEffect: null, sealed: null },
        { kind: "strike", mediaId: null, noEffect: null, sealed: null, endsAt: COUNTS, activeThen: 1 },
      ],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
      appealUntil: "2027-04-04T10:00:00.000Z",
      reversedOn: null,
      content: { kind: "post", body: "the words that were judged", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
      appeal: null,
      strike: { countsUntil: COUNTS, state: "counts", overruledAt: null },
      standing: null,
    };
    const screen = (strike: DecisionView["strike"]) => textOf(html(<DecisionDetail view={{ ...view, strike }} />));
    const counting = screen(view.strike);
    expect(counting).toContain(STANDING_TEXTS.strike.counts(COUNTS));
    expect(counting).toContain("This decision gives your account a strike.");
    expect(counting.indexOf("This decision gives your account a strike.")).toBeLessThan(counting.indexOf(STANDING_TEXTS.strike.counts(COUNTS)));
    expect(screen({ countsUntil: COUNTS, state: "expired", overruledAt: null })).toContain(STANDING_TEXTS.strike.expired(COUNTS));
    expect(screen({ countsUntil: COUNTS, state: "overruled", overruledAt: "2026-10-20T08:00:00.000Z" })).toContain(STANDING_TEXTS.strike.overruled("2026-10-20T08:00:00.000Z"));
    expect(screen(null)).not.toContain("Strike:");
  });
});

describe("3e: a retired handle in the app (design, sections 9.4, 9.5 and 9.8)", () => {
  const PLACEHOLDER = "retired_0a1b2c3d4e5f";
  const me = (handle: string, handleChangedAt: string | null = null): MeResponse => ({
    user: { id: id(1), email: "ada@example.com", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 },
    profile: { id: id(1), handle, displayName: "Ada", handleChangedAt, verified: false, showInExplore: true, sharePreviews: false },
    standing: null,
    avatar: null,
  });
  const section = (handle: string, handleChangedAt: string | null = null) => textOf(html(<HandleSection me={me(handle, handleChangedAt)} run={async () => undefined} refresh={async () => undefined} />));

  test("the words are the design's: the retired handle's sentence, the standing sentence, and the refusal", () => {
    expect(STANDING_TEXTS.handle.retired).toBe("korbat retired your handle; the decision is under Settings, Cases. Choose a new one: the 30-day wait does not apply this time.");
    expect(STANDING_TEXTS.handle.standing("ada_l")).toBe("Your handle is @ada_l. You can change it once every 30 days. Handles you used before stay yours, except one that korbat retired.");
    expect(messageFor("handle_retired")).toBe("That handle was retired by korbat. Nobody can use it.");
    // handle_reserved keeps its words; it now also answers a handle that begins with retired_.
    expect(messageFor("handle_reserved")).toBe("That handle is reserved.");
  });

  test("while the profile holds a placeholder, Settings, Profile says that korbat retired the handle and keeps the form open at once", () => {
    const out = section(PLACEHOLDER);
    expect(out).toContain(STANDING_TEXTS.handle.retired);
    expect(out).toContain(STANDING_TEXTS.handle.standing(PLACEHOLDER));
    expect(out).toContain("Change handle");
    expect(out).not.toContain("Your next change is allowed on");
    // Any other handle reads the standing sentence alone.
    const plain = section("ada_l");
    expect(plain).toContain(STANDING_TEXTS.handle.standing("ada_l"));
    expect(plain).not.toContain(STANDING_TEXTS.handle.retired);
    // The sentence is keyed on the placeholder's form, not on a handle that merely starts with the word.
    expect(section("retiredada")).not.toContain(STANDING_TEXTS.handle.retired);
  });

  test("a row of About you names a retirement and its reversal in the words of 9.4", () => {
    expect(CASE_ROW_WORDS.retired).toBe("your handle retired");
    expect(CASE_ROW_WORDS.unretired).toBe("handle given back");
    const row = (extra: Partial<AuthorCaseRow>): AuthorCaseRow => ({
      id: id(5),
      kind: "final",
      outcome: "restricted",
      decidedOn: "2026-10-12",
      post: null,
      actions: ["retire_handle"],
      endedInterim: false,
      ruleId: "R4",
      legal: false,
      appealUntil: null,
      reversedOn: null,
      appeal: null,
      strike: null,
      ...extra,
    });
    expect(textOf(html(<DecisionsList decisions={[row({})]} />))).toContain(CASE_ROW_WORDS.retired);
    expect(textOf(html(<DecisionsList decisions={[row({ actions: ["reset_display_name", "retire_handle"] })]} />))).toContain(`${MEASURES.reset_display_name.label}, ${CASE_ROW_WORDS.retired}`);
    expect(textOf(html(<DecisionsList decisions={[row({ kind: "correction", outcome: "reversed", actions: ["unretire_handle"] })]} />))).toContain(CASE_ROW_WORDS.unretired);
  });
});

describe("3e's review: what Cases says of a suspension, a termination and their answers (design, section 9.4)", () => {
  const row = (extra: Partial<AuthorCaseRow> = {}): AuthorCaseRow => ({
    id: id(31),
    kind: "final",
    outcome: "restricted",
    decidedOn: "2026-10-12",
    post: null,
    actions: ["suspend"],
    endedInterim: false,
    ruleId: "R5",
    legal: false,
    appealUntil: null,
    reversedOn: null,
    appeal: null,
    strike: null,
    standingMeasure: { kind: "suspend", days: 7, announced: false },
    ...extra,
  });
  const list = (extra: Partial<AuthorCaseRow>) => textOf(html(<DecisionsList decisions={[row(extra)]} />));

  test("the row words are the design's: a suspension with its days and kind, a termination, a lift, a withdrawal, the lift of a termination, and a suspension that rested on a reversed decision", () => {
    expect(CASE_ROW_WORDS.suspendedFor(7, false)).toBe("a suspension of 7 days, at once");
    expect(CASE_ROW_WORDS.suspendedFor(3, true)).toBe("a suspension of 3 days, announced");
    expect(CASE_ROW_WORDS.suspendedFor(1, true)).toBe("a suspension of 1 day, announced");
    expect(CASE_ROW_WORDS.terminated).toBe("a termination");
    expect(CASE_ROW_WORDS.withdrawn).toBe("suspension withdrawn for another measure");
    expect(CASE_ROW_WORDS.standingEnded.suspend).toBe("a suspension that rested on it ended");
    expect(list({})).toContain(CASE_ROW_WORDS.suspendedFor(7, false));
    expect(list({ standingMeasure: { kind: "suspend", days: 3, announced: true } })).toContain(CASE_ROW_WORDS.suspendedFor(3, true));
    expect(list({ actions: ["terminate"], standingMeasure: { kind: "terminate", days: null, announced: false } })).toContain(CASE_ROW_WORDS.terminated);
    expect(list({ actions: ["terminate"], standingMeasure: { kind: "terminate", days: null, announced: false } })).not.toContain("Terminate");
    const lift = { kind: "correction" as const, outcome: "reversed" as const, actions: ["lift_suspension" as const], standingMeasure: undefined };
    expect(list({ ...lift, liftedStanding: { kind: "suspend", replaced: false } })).toContain(CASE_ROW_WORDS.lifted);
    expect(list({ ...lift, liftedStanding: { kind: "suspend", replaced: true } })).toContain(CASE_ROW_WORDS.withdrawn);
    expect(list({ ...lift, liftedStanding: { kind: "terminate", replaced: false } })).toContain(CASE_ROW_WORDS.terminationLifted);
    expect(list({ ...lift, liftedStanding: { kind: "terminate", replaced: false } })).not.toContain(CASE_ROW_WORDS.lifted);
    const broke = { kind: "correction" as const, outcome: "reversed" as const, actions: ["restore" as const], standingMeasure: undefined, post: { id: id(1), createdAt: TIME } };
    expect(list({ ...broke, endedStanding: ["suspend"] })).toContain(`${MEASURES.restore.label}, ${CASE_ROW_WORDS.standingEnded.suspend}`);
    expect(list({ ...broke, endedStanding: ["terminate"] })).toContain(CASE_ROW_WORDS.standingEnded.terminate);
  });

  test("korbat's kept answer to a reply is listed as a kept decision, never as no action", () => {
    // 3e's review (people3): a kept correction holds no ledger row, and kept the suspension.
    const text = list({ kind: "correction", outcome: "kept", actions: [], standingMeasure: undefined });
    expect(text).toContain(CASES_WORDS.keptDecision);
    expect(text).not.toContain(CASES_WORDS.noAction);
  });

  test("Your standing has a line for a measure not started, announced or held, and for a termination, in the banner's words", () => {
    const standing = (more: Partial<NonNullable<AccountStanding["measure"]>>): AccountStanding => ({
      activeStrikes: 3,
      measure: {
        decisionId: id(9),
        kind: "suspend",
        days: 3,
        state: "unfixed",
        earliestStart: "2026-10-15T10:00:00.000Z",
        startsAt: null,
        endsAt: null,
        reply: null,
        replyOpen: true,
        appealUntil: "2027-04-12T10:00:00.000Z",
        appealPending: false,
        ...more,
      },
      reporting: null,
      handleRetired: false,
    });
    for (const s of [
      standing({}),
      standing({ state: "announced", startsAt: "2026-10-16T10:00:00.000Z", endsAt: "2026-10-19T10:00:00.000Z" }),
      standing({ state: "held", reply: { filedAt: "2026-10-13T08:00:00.000Z", onTime: true, answeredAt: null }, replyOpen: false }),
      standing({ kind: "terminate", days: null, state: "running", startsAt: "2026-10-16T10:00:00.000Z" }),
    ]) {
      const text = textOf(html(<StandingBlock activeStrikes={3} standing={s} />));
      for (const sentence of bannerSentences(s)!) expect(text, s.measure!.state).toContain(sentence);
    }
  });

  test("a card's action and a follow refused account_suspended show the refusal's sentence from /me with the link to the decision, as the forms do", () => {
    const running: AccountStanding = {
      activeStrikes: 0,
      measure: { decisionId: id(9), kind: "suspend", days: 7, state: "running", earliestStart: TIME, startsAt: TIME, endsAt: "2026-10-19T10:00:00.000Z", reply: null, replyOpen: true, appealUntil: null, appealPending: false },
      reporting: null,
      handleRetired: false,
    };
    const out = html(<RefusedNotice standing={running} />);
    expect(textOf(out)).toContain(refusalSentence(running));
    expect(textOf(out)).toContain(STANDING_TEXTS.refused.read);
    expect(out).toContain(`href="/settings/cases/${id(9)}"`);
    expect(textOf(html(<RefusedNotice standing={null} />))).toBe(STANDING_TEXTS.refused.over);
    expect(isSuspendedRefusal(new ApiError(403, "account_suspended", "server wording"))).toBe(true);
    expect(isSuspendedRefusal(new ApiError(403, "reauth_required", "x"))).toBe(false);
    // A static render cannot press a button: the card and the profile's follow read their refusals through these two.
    for (const file of [["components", "social", "PostCard.tsx"], ["app", "u", "[handle]", "index.tsx"]]) {
      const source = read(...file);
      expect(source, file.join("/")).toContain("isSuspendedRefusal(err)");
      expect(source, file.join("/")).toContain("<RefusedNotice");
    }
  });
});

// UI Task 7 appends below, so the lines above keep the numbers other tasks cite.
import { Tabs } from "../src/components/kit/Tabs";
import { StatusSheetBody } from "../src/components/moderation/StatusSheet";

/**
 * Cases' tabs are the kit's Tabs (UI design, section 6.10): the screen names `<Tabs`, which draws the tab list's role
 * that the screen used to write by hand.
 */
function tabsOf(screen: string): string {
  expect(screen).toContain("<Tabs");
  return html(<Tabs label={CASES_WORDS.title} tabs={[{ key: "about", label: CASES_WORDS.tabs.about }, { key: "reports", label: CASES_WORDS.tabs.reports }]} selected="about" onSelect={() => undefined} panelId="cases" />);
}

/** A removed post's decision as GET /api/moderation/decisions/:id answers it, for the sheet the chip opens. */
const sheetDecision: DecisionView = {
  id: id(3),
  kind: "final",
  outcome: "restricted",
  ground: "incompatible",
  ruleId: "R3",
  rulesVersion: 2,
  redressVersion: 1,
  legalReference: null,
  facts: "The post attacks a group for its religion.",
  reason: "That is an attack on people, not on an idea.",
  source: "report",
  decidedAt: TIME,
  post: { id: id(1), createdAt: "2026-09-01T08:30:00.000Z" },
  measures: [{ kind: "remove", mediaId: null, noEffect: null, sealed: null }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
  appealUntil: "2027-04-04T10:00:00.000Z",
  reversedOn: null,
  content: { kind: "post", body: "my own post", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
  appeal: null,
  strike: null,
  standing: null,
};

/**
 * UI Task 7 (section 8.7): the chip on a card is the button that opens StatusSheet (aria-haspopup="dialog"), and the
 * decision's statement is linked from the sheet, drawn here open with the decision `decisionId` names.
 */
function sheetOf(card: string, decisionId: string): string {
  expect(card).toContain('aria-haspopup="dialog"');
  expect(hrefs(card).filter((href) => href.startsWith("/settings/cases"))).toEqual([]);
  const post: PostView = {
    id: id(1),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false, avatar: null },
    body: "my own post",
    createdAt: TIME,
    state: "removed",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    imported: null,
    mentions: [],
    countsHidden: false,
  };
  return html(<StatusSheetBody load={{ kind: "shown", view: { ...sheetDecision, id: decisionId } }} post={post} me={null} onRetry={() => undefined} />);
}
