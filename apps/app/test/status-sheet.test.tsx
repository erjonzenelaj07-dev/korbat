import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { DecisionView, type HiddenMedia, type MediaView, type MeResponse, type PostView } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, getRule } from "@korbat/rules";
import { StatusSheetBody, appealState, appliesTo, decidedBy, statusBlocks, type StatusLoad } from "../src/components/moderation/StatusSheet";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { PostCard } from "../src/components/social/PostCard";
import { HIDDEN_IMAGE } from "../src/components/social/HiddenImage";
import { chipText, utcMinute } from "../src/lib/moderation";
import { AUTO_WORDS, DECISION_WORDS, STATUS_SHEET_WORDS } from "../src/lib/moderation-words";
import { fullDate } from "../src/lib/time";
import { UI_WORDS, fill } from "../src/lib/ui-words";

/**
 * The details sheet of the author's moderation chip (UI design, section 8.7; UI Task 7): what it says for each kind of
 * decision, in which order, who it says decided, where the appeal stands, and its loading and failed forms; the chip that
 * opens it; and the link a reader meets under a grid that holds a hidden image (decision 10). The sheet's Modal draws
 * nothing on a server, so its body is rendered on its own, with the decision's answer it would have read.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined, replace: () => undefined },
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
    .replace(/ +/g, " ")
    .trim();
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
/** The labelled blocks of a rendered sheet, in their order. */
const blocks = (markup: string): string[] => [...markup.matchAll(/data-status-block="([a-zA-Z]+)"/g)].map((match) => match[1]!);
/** The words of each button. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button) [^>]*role="button"[^>]*>(.*?)<[/](?:div|button)>/g)].map((match) => textOf(match[1]!));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BLANK_LINE = String.fromCharCode(10, 10);
const DECIDED = "2026-10-12T09:00:00.000Z";
const POSTED = "2026-10-01T08:30:00.000Z";
const UNTIL = "2027-04-12T09:00:00.000Z";
const noop = async () => undefined;

/** A final decision that removed one of Ada's posts under R3, which she can appeal until UNTIL. */
const decision = (extra: Partial<DecisionView> = {}): DecisionView => ({
  id: id(3),
  kind: "final",
  outcome: "restricted",
  ground: "incompatible",
  ruleId: "R3",
  rulesVersion: 3,
  redressVersion: 2,
  legalReference: null,
  facts: "The post offered followers for sale.",
  reason: `Selling followers is spam under R3.${BLANK_LINE}A second paragraph the sheet leaves to the decision's screen.`,
  source: "report",
  decidedAt: DECIDED,
  post: { id: id(1), createdAt: POSTED },
  measures: [{ kind: "remove", mediaId: null, noEffect: null, sealed: null }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
  appealUntil: UNTIL,
  reversedOn: null,
  content: { kind: "post", body: "my own post", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
  appeal: null,
  strike: null,
  standing: null,
  ...extra,
});

const interim = () => decision({ kind: "interim", measures: [{ kind: "withhold", mediaId: null, noEffect: null, sealed: null }], appealUntil: null });
const pending = () => decision({ appealUntil: null, appeal: { state: "pending", filedAt: "2026-10-13T10:00:00.000Z", reviewer: "available", needsAdmin: false } });
const answered = () => {
  const view = decision();
  const { id: _id, appealUntil: _until, reversedOn: _reversed, content: _content, appeal: _appeal, strike: _strike, standing: _standing, ...statement } = view;
  return decision({ appealUntil: null, appeal: { state: "answered", filedAt: "2026-10-13T10:00:00.000Z", answeredOn: "2026-10-15", result: "kept", answeredBy: id(9), statement: { ...statement, kind: "review", outcome: "kept" } } });
};
/** A program's withhold of one image (3d Task 6), with "Ask for a person" open. */
const program = () =>
  decision({
    kind: "interim",
    ruleId: "R1",
    redressVersion: 4,
    reason: null,
    source: "own_initiative",
    measures: [{ kind: "withhold_media", mediaId: id(2), noEffect: null, sealed: null }],
    automatedDetection: true,
    automatedDecision: "fully",
    signal: { kind: "r1_score", source: null, matchKind: null, listedAs: null, viewed: null },
    appealUntil: null,
    askPerson: { state: "open" },
  });
/** An authority's order that disabled the post (3f). */
const order = () =>
  decision({
    kind: "order",
    ground: "illegal",
    ruleId: null,
    redressVersion: 3,
    facts: null,
    reason: null,
    source: "order",
    measures: [{ kind: "disable_by_order", mediaId: null, noEffect: null, sealed: null }],
    appealUntil: null,
    content: null,
    order: {
      kind: "tco_removal",
      memberState: "DE",
      authority: "Bundeskriminalamt (BKA)",
      reference: "BKA-2026-1",
      verified: true,
      orderedOn: "2026-10-12",
      orderedFrom: "received",
      crossBorder: false,
      homeState: "DE",
      withholdAuthor: true,
      disabledAt: DECIDED,
      held: false,
      informedAt: DECIDED,
      holdEndReason: null,
      preserveUntil: "2027-04-17T09:00:00.000Z",
      preserveFirstUntil: "2027-04-17T09:00:00.000Z",
      preserveExtended: false,
      preserveEndedOn: null,
      orderGround: null,
    },
  });

const ADA = { id: id(900), handle: "ada", displayName: "Ada", verified: false };
const me = { user: { id: ADA.id, onboarded: true }, profile: { handle: "ada", showInExplore: true }, standing: { activeStrikes: 0, measure: null, reporting: null, handleRetired: false } } as unknown as MeResponse;

function post(extra: Partial<PostView> = {}): PostView {
  return {
    id: id(1),
    author: ADA,
    body: "my own post",
    createdAt: POSTED,
    state: "removed",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    imported: null,
    moderation: { decisionId: id(3), ruleId: "R3", legal: false, interim: false, strikeUntil: null },
    ...extra,
  };
}

const sheet = (view: DecisionView, onAsk?: (text: string) => Promise<void>) => html(<StatusSheetBody load={{ kind: "shown", view }} post={post()} me={me} onRetry={() => undefined} onAsk={onAsk} />);

describe("the words", () => {
  test("the sheet's labels are section 8.7's table, and the link under a hidden image is decision 10's", () => {
    expect(STATUS_SHEET_WORDS).toEqual({
      "status.rule": "Rule",
      "status.illegal": "Illegal content",
      "status.does": "What it does",
      "status.appliesTo": "Applies to",
      "status.appliesPost": "This post",
      "status.appliesImage": "This image",
      "status.appliesAccount": "Your account",
      "status.whoSees": "Who can see it now",
      "status.decidedBy": "Decided by",
      "status.byPerson": "A korbat moderator",
      "status.byProgram": "korbat's automated check",
      "status.byOrder": "An authority's order",
      "status.when": "When",
      "status.statement": "Statement",
      "status.readAll": "Read the full decision",
      "status.appeal": "Appeal",
      "status.appealUntil": "You can appeal until {date}.",
    });
    expect(UI_WORDS["media.whyHidden"]).toBe("Why are images hidden?");
  });

  test("every fixture of this file is a decision as the API sends it", () => {
    for (const view of [decision(), interim(), pending(), answered(), program(), order()]) expect(DecisionView.safeParse(view).success).toBe(true);
  });
});

describe("Decided by (review ruling 5)", () => {
  test("names a role: korbat's automated check only for a decision marked fully automated, an authority's order for an order, a moderator otherwise", () => {
    expect(decidedBy(decision({ automatedDecision: "fully" }))).toBe(STATUS_SHEET_WORDS["status.byProgram"]);
    // partially is a restriction an admin took on a program's finding: a person decided it.
    expect(decidedBy(decision({ automatedDecision: "partially" }))).toBe(STATUS_SHEET_WORDS["status.byPerson"]);
    expect(decidedBy(decision({ automatedDecision: "not_automated" }))).toBe(STATUS_SHEET_WORDS["status.byPerson"]);
    expect(decidedBy(decision())).toBe(STATUS_SHEET_WORDS["status.byPerson"]);
    expect(decidedBy(order())).toBe(STATUS_SHEET_WORDS["status.byOrder"]);
    // The field being set says nothing on its own: an automated detection a person decided on is still a person's.
    expect(decidedBy(decision({ automatedDetection: true, automatedDecision: "partially" }))).toBe(STATUS_SHEET_WORDS["status.byPerson"]);
    expect(textOf(sheet(program()))).toContain(`${STATUS_SHEET_WORDS["status.decidedBy"]} ${STATUS_SHEET_WORDS["status.byProgram"]}`);
    expect(textOf(sheet(decision()))).toContain(`${STATUS_SHEET_WORDS["status.decidedBy"]} ${STATUS_SHEET_WORDS["status.byPerson"]}`);
  });
});

describe("the blocks", () => {
  test("a final decision open to appeal: Appeal first, with its deadline and the primary action to the appeal's form; then the rest in the design's order", () => {
    const out = sheet(decision());
    const text = textOf(out);
    expect(appealState(decision())).toBe("open");
    expect(blocks(out)).toEqual(["appeal", "rule", "does", "appliesTo", "whoSees", "decidedBy", "when", "statement"]);
    expect(text).toContain(fill(STATUS_SHEET_WORDS["status.appealUntil"], { date: fullDate(UNTIL) }));
    expect(hrefs(out)).toContain(`/settings/cases/${id(3)}?appeal=1`);
    expect(text).toContain(`${STATUS_SHEET_WORDS["status.rule"]} R3: ${getRule("R3", 3)!.title}`);
    expect(text).toContain(STATEMENT_WORDS.done.remove(utcMinute(POSTED)));
    expect(text).toContain(`${STATUS_SHEET_WORDS["status.appliesTo"]} ${STATUS_SHEET_WORDS["status.appliesPost"]}`);
    expect(text).toContain(UI_WORDS["reach.private"]);
    expect(text).toContain(`${STATUS_SHEET_WORDS["status.when"]} ${fullDate(DECIDED)}`);
    // The statement block holds the reason's first paragraph, and the link to the whole decision.
    expect(text).toContain("Selling followers is spam under R3.");
    expect(text).not.toContain("A second paragraph");
    expect(hrefs(out)).toContain(`/settings/cases/${id(3)}`);
    expect(text).toContain(STATUS_SHEET_WORDS["status.readAll"]);
  });

  test("an interim decision: the blocks in order, Appeal last with the interim redress sentence, and no action", () => {
    const out = sheet(interim());
    expect(appealState(interim())).toBe("interim");
    expect(blocks(out)).toEqual(["rule", "does", "appliesTo", "whoSees", "decidedBy", "when", "statement", "appeal"]);
    expect(textOf(out)).toContain(REDRESS_TEXTS[2].interim);
    expect(textOf(out)).toContain(STATEMENT_WORDS.done.withhold(utcMinute(POSTED)));
    expect(hrefs(out)).not.toContain(`/settings/cases/${id(3)}?appeal=1`);
  });

  test("a pending appeal and an answered one: Appeal last, in the decision screen's own words", () => {
    const waiting = sheet(pending());
    expect(appealState(pending())).toBe("pending");
    expect(blocks(waiting).at(-1)).toBe("appeal");
    expect(textOf(waiting)).toContain(DECISION_WORDS.appealFiled("2026-10-13"));
    expect(textOf(waiting)).toContain(DECISION_WORDS.appealWaiting);
    const done = sheet(answered());
    expect(appealState(answered())).toBe("answered");
    expect(blocks(done).at(-1)).toBe("appeal");
    expect(textOf(done)).toContain(DECISION_WORDS.appealAnswered("2026-10-15"));
    expect(hrefs(done)).toContain(`/settings/cases/${id(9)}`);
    for (const out of [waiting, done]) expect(hrefs(out).some((href) => href.endsWith("?appeal=1"))).toBe(false);
  });

  test("a program's decision: this image, korbat's automated check, the interim sentence and Ask for a person as the decision's screen offers it", () => {
    const out = sheet(program(), noop);
    expect(textOf(out)).toContain(`${STATUS_SHEET_WORDS["status.appliesTo"]} ${STATUS_SHEET_WORDS["status.appliesImage"]}`);
    expect(appliesTo(program())).toBe(STATUS_SHEET_WORDS["status.appliesImage"]);
    expect(textOf(out)).toContain(REDRESS_TEXTS[4].interim);
    expect(buttons(out)).toEqual([AUTO_WORDS.ask]);
    // Without a way to send it, no button.
    expect(buttons(sheet(program()))).toEqual([]);
    // Its statement block has no reason to quote: the link alone.
    expect(hrefs(out)).toContain(`/settings/cases/${id(3)}`);
  });

  test("an order: an authority's order decided, no rule of korbat's, and no appeal block, as the order's notice offers none", () => {
    const out = sheet(order());
    expect(appealState(order())).toBe("none");
    expect(statusBlocks(order())).not.toContain("appeal");
    expect(blocks(out)).toEqual(["does", "appliesTo", "whoSees", "decidedBy", "when", "statement"]);
    expect(textOf(out)).toContain(STATUS_SHEET_WORDS["status.byOrder"]);
    expect(textOf(out)).not.toContain(STATUS_SHEET_WORDS["status.rule"]);
  });

  test("a decision on the law says Illegal content with its legal reference; one about the account applies to the account", () => {
    const legal = decision({ ground: "illegal", ruleId: null, legalReference: "Section 130 StGB" });
    expect(textOf(sheet(legal))).toContain(`${STATUS_SHEET_WORDS["status.rule"]} ${STATUS_SHEET_WORDS["status.illegal"]} Section 130 StGB`);
    expect(appliesTo(decision({ post: null }))).toBe(STATUS_SHEET_WORDS["status.appliesAccount"]);
    expect(appliesTo(decision())).toBe(STATUS_SHEET_WORDS["status.appliesPost"]);
  });
});

describe("loading and failing", () => {
  test("while the decision is read: skeleton blocks hidden from assistive technology and one polite status; no block yet", () => {
    const out = html(<StatusSheetBody load={{ kind: "loading" }} post={post()} me={me} onRetry={() => undefined} />);
    expect(blocks(out)).toEqual([]);
    expect(out.split('role="status"').length - 1).toBe(1);
    expect(textOf(out)).toBe(UI_WORDS["spinner.label"]);
    expect(out).toContain('aria-hidden="true"');
  });

  test("a failed read says what went wrong with Try again, which reads it again", () => {
    const failed: StatusLoad = { kind: "failed", message: "korbat is busy. Try again in a moment." };
    const out = html(<StatusSheetBody load={failed} post={post()} me={me} onRetry={() => undefined} />);
    expect(out).toContain('role="alert"');
    expect(textOf(out)).toContain("korbat is busy. Try again in a moment.");
    expect(buttons(out)).toEqual([UI_WORDS["error.retry"]]);
    expect(blocks(out)).toEqual([]);
  });

  test("the sheet reads the decision when it opens and keeps the answer in its own state: no store, no cache, no Explore call", () => {
    const source = read("components", "moderation", "StatusSheet.tsx");
    expect(source).toContain("moderation.decision(decisionId)");
    expect(source).toContain("moderation.objection(decisionId, text)");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|AsyncStorage|caches[.]/);
    expect(source).not.toMatch(/social[.](explore|popular|exploreStatus)/);
    expect(source).not.toMatch(/^(export )?(let|var) /m);
  });
});

describe("the chip on the author's own post (6.13)", () => {
  test("with the decision known it is a button that opens a dialog, named by its words, and links nowhere itself", () => {
    session.state = { status: "signed-in", me };
    const moderation = { decisionId: id(3), ruleId: "R3" as const, legal: false, interim: false, strikeUntil: null };
    const out = html(<PostCard post={post({ moderation })} />);
    // The one element that opens a dialog is the chip: a button, whose words are chipText's.
    const opener = /<([a-z]+) [^>]*aria-haspopup="dialog"[^>]*>/.exec(out);
    expect(opener?.[0]).toContain('role="button"');
    expect(out.split('aria-haspopup="dialog"').length - 1).toBe(1);
    expect(buttons(out)).toContain(chipText(moderation));
    expect(hrefs(out).filter((href) => href.startsWith("/settings/cases"))).toEqual([]);
    // Without the decision's facts the chip stays information only.
    const bare = html(<PostCard post={post({ moderation: undefined })} />);
    expect(bare).not.toContain('aria-haspopup="dialog"');
    expect(bare).toContain('role="img"');
    session.state = { status: "signed-out" };
  });

  test("the card keeps the sheet's state itself and mounts the sheet only while it is open", () => {
    const card = read("components", "social", "PostCard.tsx");
    expect(card).toContain("<StatusChip tone={tone} label={words} onPress={decision ? openSheet : undefined} ref={chipRef} />");
    expect(card).toMatch(/sheetMounted && decision [?] <StatusSheet/);
  });
});

describe("the decision's screen opened from the sheet's Appeal", () => {
  test("reads appeal beside the id and focuses the appeal's field once the decision shows", () => {
    const screen = read("app", "settings", "cases", "[id].tsx");
    expect(screen).toContain("const { id, appeal } = useLocalSearchParams<{ id: string; appeal?: string }>();");
    expect(screen).toContain('focusAppeal={appeal === "1"}');
    expect(read("components", "moderation", "DecisionDetail.tsx")).toContain("if (focus) field.current?.focus();");
  });
});

describe("a hidden image for a reader (decision 10)", () => {
  const image = (n: number): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
  const hidden = (n: number): HiddenMedia => ({ id: id(n), hidden: true });

  test("a grid that holds one gains the link Why are images hidden? to the rules, beside ALT or alone; the placeholder stays no button", () => {
    for (const media of [[image(1), hidden(2)], [hidden(2)]]) {
      const out = html(<MediaGrid media={media} postId={id(5)} />);
      expect(hrefs(out)).toEqual(["/rules"]);
      expect(textOf(out)).toContain(UI_WORDS["media.whyHidden"]);
      expect(textOf(out)).toContain(HIDDEN_IMAGE);
      expect(buttons(out).some((words) => words.includes(HIDDEN_IMAGE))).toBe(false);
    }
    // A grid without a hidden image has no link, and a quote's row of squares none either: the quote is one open target.
    expect(hrefs(html(<MediaGrid media={[image(1)]} postId={id(5)} />))).toEqual([]);
    expect(hrefs(html(<MediaGrid media={[image(1), hidden(2)]} compact postId={id(5)} />))).toEqual([]);
  });
});
