# korbat interface and experience (UI) — Task 7 of 10: Moderation surfaces and the public pages: section 8.7's StatusSheet, opened by the author's chip and read fresh from the decision, the link under a hidden image to /rules (decision 10), the case screens, the report form and a report's status page on the kit, and section 8.9's reading layout for /rules, /transparency and /explore/about, with /terms in PublicFrame.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 7 of ten in korbat's UI sub-project (interface and experience), the first of the batch of Tasks 7 and 8, built from docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md on Tasks 1 to 6 (the tokens, the kit, the shell and its browser check, the post card with Sheet and Menu, the feeds, the composer). It follows sections 8.7 and 8.9 with decisions 10, 11 and 16, 4.8's status colours, 6.7, 6.8 and 6.10 to 6.14, 8.1, 10, 11.3 and 12.2 to 12.3; Task 8 moves settings, security and the sign-in flow onto the kit next and empties the legacy lists.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): the composer: composer/state.ts, a pure reducer of the text, the images and where each upload stands, the send and its refusal and the draft's key, says the length by the server's rule, whether a post may go and the Post button's words, and the parts draw from it: ComposerField with its kept names, growing to half the window and described by {n} of 1000 characters, said again only across 900 and 1000; ProgressRing (a DOM svg on the web, react-native-svg natively); the image tray at 88 px; SendBar; DiscardDialog, asked only when there is content; lib/drafts.ts keeps the text per context on the device 500 ms after typing stops and the session's end clears every draft; ComposeSheet moves onto kit/Sheet, 640 px wide from 768 px, and sending closes it with a toast whose View opens the post; New post ends the rail and the full nav on every screen, one sheet for the app in the root layout, with the phone's compose button on Home, a profile and Bookmarks; Home's collapsed card and the thread's reply card open in place, Reply opens the thread with its card focused, a quote's preview links nowhere; the browser check gains steps 28 to 31`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/07-moderation-surfaces-and-public-pages.md 1
```

Expected: 6 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/status-sheet.test.tsx`

```tsx
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
```

### Replace `apps/app/test/browser/app.browser.ts` (whole file)

```ts
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { THEMES, type ThemeName } from "../../src/theme/tokens";
import { TITLE_WORDS, UI_WORDS } from "../../src/lib/ui-words";
import { CASES_WORDS, DECISION_WORDS, STATUS_SHEET_WORDS } from "../../src/lib/moderation-words";
import { RULES_PAGE } from "../../src/lib/public-pages";
import { appSiteHeadersFromCaddyfile } from "./caddyfile";
import {
  ADA,
  createFixtureApi,
  DECISION_ID,
  GRACE,
  HIDDEN_IMAGE_POST_ID,
  MISSING_POST_ID,
  newPostIdOf,
  NOTICE_REF,
  NOTICE_TOKEN,
  POST_DECISION_ID,
  POST_ID,
  postIdOf,
  RELEASE_ID,
  REMOVED_CHIP,
  UPLOAD_ID,
  writtenIdOf,
  type FixtureApi,
} from "./fixture-api";
import { HOLD_MS, startAppSite, type AppSiteServer } from "./server";
import { clippedLabels, phoneProblems, TURNSTILE_ORIGIN, watch, type Watcher } from "./watch";

/**
 * The app's browser check (UI design, section 12.3, decision 20; Task 3): the web export, built once per run with the
 * check's own environment (no apps/app/.env, an empty API base so every call goes to this server's origin, Cloudflare's
 * published Turnstile test key), served as Caddy's app site serves it by test/browser/server.ts, with the fixture API
 * of fixture-api.ts beside it, and walked in Chromium through playwright-core. Turnstile's script is answered by a stub
 * that hands its widget a test token, so the walk needs no network and no stack. Each step opens its own browser context
 * (its width, theme, motion and session) and fails on any policy report, console error or warning, page error, dialog,
 * failed request or request the fixtures do not answer (watch.ts).
 *
 * The steps, one test each: the budgets of section 11.3; the Caddyfile's headers; the first paint in the stored theme
 * with the bundle held back; the layout at 360, 768 and 1280 px on Home, a post, a profile, /rules and a missing page;
 * the keyboard; contrast as drawn in Light, Dim and Dark; text at Largest with the root at 200 percent at 320 px; every
 * route signed out and signed in; the requests and the time before the first content; the offline banner; the header
 * that hides on a phone, and stays under reduced motion; the soft reset; and from Task 4 the lightbox, Like with its
 * rollback, Follow with its rollback, the menus, and Who sees this; from Task 5 the new-posts pill, the reading place, the
 * feeds kept across tabs, the keyboard on Home, and the focus after a delete with the thread held at its post; from Task
 * 6 the composer: the sheet and its toast at 360, the discard question and the drafts, Home's card and New post at
 * 1280, a reply and a quote; from Task 7 the chip's details sheet, the appeal it opens and Cases' tabs, and the link
 * under a hidden image with the terms in their frame. Later tasks add their screens' steps.
 *
 * It never downloads a browser. By default it drives the Chromium build playwright-core 1.63.0 names (chromium-1243 under
 * ms-playwright), which must already be installed; KORBAT_BROWSER_CHANNEL=chrome drives the machine's own Chrome. The
 * screenshots of the layout steps go to KORBAT_SHOTS, or to a new folder in the system's temporary folder, and are
 * never compared pixel by pixel.
 */
const CHANNEL = process.env.KORBAT_BROWSER_CHANNEL || "chromium";
const APP = path.resolve(import.meta.dirname, "..", "..");
const REPO = path.resolve(APP, "..", "..");

/** The export's environment (section 12.3): set in the child, so the developer's apps/app/.env is never read. */
const EXPORT_ENV: Record<string, string> = {
  EXPO_NO_DOTENV: "1",
  EXPO_NO_TELEMETRY: "1",
  CI: "1",
  EXPO_PUBLIC_API_URL: "",
  EXPO_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  EXPO_PUBLIC_BADGE: "off",
  EXPO_PUBLIC_CONTACT_EMAIL: "contact@korbat.local",
  EXPO_PUBLIC_CONTACT_POINT: "",
  EXPO_PUBLIC_HOME_STATE: "",
};

/** The test token Turnstile's stub gives every widget, as Cloudflare's test keys do. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * Turnstile's script as the walk answers it: window.turnstile with the calls @marsidev/react-turnstile makes, a widget
 * that hands its callback the test token at once, and the load callback the script's address names.
 */
const TURNSTILE_STUB = `
(function () {
  var source = document.currentScript && document.currentScript.src ? new URL(document.currentScript.src) : null;
  var count = 0;
  window.turnstile = {
    render: function (container, options) {
      count += 1;
      var id = "stub-" + count;
      setTimeout(function () { if (options && typeof options.callback === "function") options.callback(${JSON.stringify(TURNSTILE_TOKEN)}); }, 0);
      return id;
    },
    reset: function () {},
    remove: function () {},
    execute: function () {},
    getResponse: function () { return ${JSON.stringify(TURNSTILE_TOKEN)}; },
    isExpired: function () { return false; },
    ready: function (callback) { callback(); }
  };
  var onload = source ? source.searchParams.get("onload") : null;
  if (onload && typeof window[onload] === "function") window[onload]();
})();
`;

let out = "";
let shots = "";
let site: AppSiteServer | undefined;
let browser: Browser | undefined;
let fixtures: FixtureApi;
let origin = "";

/** Runs the export into `dir`, failing with the end of its output. */
function exportWeb(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO, "node_modules", "expo", "bin", "cli"), "export", "--platform", "web", "--output-dir", dir, "--clear"], {
      cwd: APP,
      env: { ...process.env, ...EXPORT_ENV },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk: Buffer) => (log += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (log += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`expo export exited with ${code}: ${log.slice(-3000)}`))));
  });
}

interface Visit {
  context: BrowserContext;
  page: Page;
  watcher: Watcher;
}

interface VisitOptions {
  width: number;
  height: number;
  signedIn?: boolean;
  /** The reader's stored appearance (korbat.appearance), set before any of the page's scripts runs. */
  appearance?: Record<string, unknown>;
  reducedMotion?: "reduce" | "no-preference";
  colorScheme?: "light" | "dark";
}

/** A fresh browser context at a width, with its session, appearance and motion, watched, and Turnstile stubbed. */
async function open(options: VisitOptions): Promise<Visit> {
  fixtures.state.signedIn = options.signedIn ?? true;
  const context = await browser!.newContext({
    viewport: { width: options.width, height: options.height },
    timezoneId: "UTC",
    locale: "en-GB",
    reducedMotion: options.reducedMotion ?? "no-preference",
    colorScheme: options.colorScheme ?? "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const watcher = await watch(context, page, origin);
  // Registered after the watcher's catch-all, so it runs first: Turnstile's address is answered by the stub.
  await context.route(`${TURNSTILE_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: TURNSTILE_STUB }));
  if (options.appearance) {
    const stored = JSON.stringify(JSON.stringify(options.appearance));
    await context.addInitScript({ content: `try { window.localStorage.setItem("korbat.appearance", ${stored}); } catch (error) {}` });
  }
  return { context, page, watcher };
}

/** Opens a path and waits until the page has asked for and drawn what it needs, and its fonts are in. */
async function visit(page: Page, route: string): Promise<void> {
  await page.goto(`${origin}${route}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate("document.fonts.ready.then(() => true)");
}

/** The end of every step: no report, error, warning or dialog on any channel, and nothing the fixtures did not answer. */
async function clean(visit: Visit): Promise<void> {
  expect(visit.watcher.take()).toEqual([]);
  expect(fixtures.state.problems.splice(0)).toEqual([]);
}

/** Waits until an expression is true in the page. The expression is plain text, evaluated as the page's own code is not. */
async function until(page: Page, expression: string, what: string, timeout = 15_000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`not within ${timeout} ms: ${what}`);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A token colour as getComputedStyle writes it. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

/**
 * KORBAT_APP_EXPORT names an export already built with EXPORT_ENV, which a developer re-running the walk while working on
 * it may reuse; it is read and never deleted. Without it, as the gates run the check, the walk builds its own.
 */
const PREBUILT = process.env.KORBAT_APP_EXPORT ? path.resolve(process.env.KORBAT_APP_EXPORT) : null;

beforeAll(async () => {
  shots = process.env.KORBAT_SHOTS ? path.resolve(process.env.KORBAT_SHOTS) : mkdtempSync(path.join(tmpdir(), "korbat-app-shots-"));
  mkdirSync(shots, { recursive: true });
  console.log(`screenshots: ${shots}`);
  if (PREBUILT) {
    out = PREBUILT;
  } else {
    out = mkdtempSync(path.join(tmpdir(), "korbat-app-browser-"));
    await exportWeb(out);
  }
  fixtures = createFixtureApi();
  site = await startAppSite({ dist: out, api: fixtures.handle, postStatus: fixtures.postStatus });
  origin = site.origin;
  browser = await chromium.launch({ channel: CHANNEL, headless: true });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
  if (out && !PREBUILT) rmSync(out, { recursive: true, force: true });
});

/** The files of the export under a folder, with their sizes raw and gzip at level 9 (Task 1's method, baseline.json). */
function sizes(folder: string): { name: string; bytes: number; gzip: number }[] {
  const dir = path.join(out, folder);
  return readdirSync(dir).map((name) => {
    const bytes = readFileSync(path.join(dir, name));
    return { name, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  });
}

/** The routes of the app (section 3.1) with the fixtures' ids, for the walk through every one. */
const TOKEN = "B".repeat(43);
const ROUTES = [
  "/",
  "/?tab=latest",
  "/?tab=explore",
  "/bookmarks",
  "/explore/about",
  `/post/${POST_ID}`,
  "/u/grace",
  "/u/ada",
  "/u/grace/followers",
  "/u/grace/following",
  "/report",
  `/notice/${NOTICE_REF}#t=${NOTICE_TOKEN}`,
  "/rules",
  "/transparency",
  "/terms",
  "/settings/security",
  "/settings/privacy",
  "/settings/profile",
  "/settings/account",
  "/settings/cases",
  `/settings/cases/${DECISION_ID}`,
  // UI Task 7: the decision of Ada's removed post, opened as its details sheet's Appeal opens it.
  `/settings/cases/${POST_DECISION_ID}?appeal=1`,
  `/settings/cases/${DECISION_ID}/reply`,
  `/settings/cases/releases/${RELEASE_ID}`,
  `/settings/cases/uploads/${UPLOAD_ID}`,
  "/signin",
  "/code",
  "/password",
  "/mfa",
  "/age",
  "/handle",
  `/email-revert/${TOKEN}`,
  `/not-me/${TOKEN}`,
  `/passkey-remove/${TOKEN}`,
  "/no-such-page",
];

/**
 * The parts of a page this sub-project has drawn so far, which the walk holds to the phone's target rule, the labels'
 * fit and contrast as drawn: the skip link, the nav, the context column, the screen header, the offline banner, and a
 * screen that is the kit's alone (the missing page); from Task 4 every post card (an article), every sheet and dialog,
 * a menu's popover, the follow button and the toaster; from Task 5 every row of a feed (its posts, the marker, Load more,
 * the end), the tab lists, the new-posts pill, the profile's header and the thread's posts; from Task 6 every feed whole,
 * its header with Home's card and the thread's reply card included, and the compose button; from Task 7 the column of
 * every screen it moved onto the tokens (`data-screen`: the cases screens, the report form, a report's status, the
 * public pages) and PublicFrame's banner and footer. The screens' own content still paints with Tailwind's palette and
 * sizes until its task moves it onto the tokens (test/legacy-files.ts), and joins this list then: settings and sign-in
 * with Task 8.
 */
const DRAWN = [
  'a[href="#main"]',
  'nav[aria-label="Main"]',
  'aside[aria-label="About korbat"]',
  "#screen-header",
  'main > [role="status"]',
  '[role="article"]',
  '[role="dialog"]',
  "[data-menu]",
  "[data-follow]",
  "[data-sonner-toaster]",
  '[role="feed"]',
  "[data-compose]",
  '[role="tablist"]',
  "[data-pill]",
  "[data-profile-header]",
  "[data-thread]",
  "[data-screen]",
  '[role="banner"]',
  '[role="contentinfo"]',
].join(", ");
/** A page drawn wholly on the kit: everything on it is held to the rules. */
const ALL = "body";

/**
 * The pages of the layout steps: Home, a post, a profile, the rules and a missing page, with the item current on each;
 * from Task 5 Bookmarks and a followers list too, drawn wholly on the kit; from Task 7 the rules wholly, Cases and a
 * decision under Settings, and the terms, which sit in PublicFrame outside the shell (`frame`), so the shell's own
 * checks pass them over.
 */
const LAYOUT_PAGES: { name: string; route: string; current: string | null; scope: string; frame?: boolean }[] = [
  { name: "home", route: "/", current: "/", scope: DRAWN },
  { name: "post", route: `/post/${POST_ID}`, current: null, scope: DRAWN },
  { name: "profile", route: "/u/grace", current: null, scope: DRAWN },
  { name: "rules", route: "/rules", current: null, scope: ALL },
  { name: "missing", route: "/no-such-page", current: null, scope: ALL },
  { name: "bookmarks", route: "/bookmarks", current: "/bookmarks", scope: ALL },
  { name: "followers", route: "/u/grace/followers", current: null, scope: ALL },
  { name: "cases", route: "/settings/cases", current: "/settings/security", scope: ALL },
  { name: "decision", route: `/settings/cases/${POST_DECISION_ID}`, current: "/settings/security", scope: ALL },
  { name: "terms", route: "/terms", current: null, scope: ALL, frame: true },
];


/** What the layout of a page says of itself: its kind, the nav's current links, the context column, and the current item's marks. */
const LAYOUT_SCRIPT = `
(() => {
  const root = document.querySelector("[data-layout]");
  const nav = document.querySelector('nav[aria-label="Main"]');
  const current = nav ? [...nav.querySelectorAll('a[aria-current="page"]')] : [];
  const marks = current.length === 1 ? [current[0], ...current[0].querySelectorAll("*")].map((element) => {
    const rect = element.getBoundingClientRect();
    return { bg: getComputedStyle(element).backgroundColor, width: Math.round(rect.width), height: Math.round(rect.height) };
  }) : [];
  return {
    kind: root ? root.getAttribute("data-layout") : null,
    current: current.map((link) => link.getAttribute("href")),
    context: !!document.querySelector('aside[aria-label="About korbat"]'),
    marks,
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    title: document.title,
  };
})()
`;

interface Layout {
  kind: string | null;
  current: string[];
  context: boolean;
  marks: { bg: string; width: number; height: number }[];
  scroll: number;
  title: string;
}

/** The layout steps at one size: each page in Light and Dark, the shell's kind and marks, the phone's rules, screenshots. */
async function layoutStep(width: number, height: number, kind: string): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    const visit_ = await open({ width, height, appearance: { theme } });
    try {
      for (const page of LAYOUT_PAGES) {
        await visit(visit_.page, page.route);
        const layout = (await visit_.page.evaluate(LAYOUT_SCRIPT)) as Layout;
        // A page in PublicFrame has no shell: no layout kind, no nav and no context column.
        expect(layout.kind, page.name).toBe(page.frame ? null : kind);
        expect(layout.current, page.name).toEqual(page.current === null ? [] : [page.current]);
        // The context column from 1024 px only.
        expect(layout.context, page.name).toBe(!page.frame && width >= 1024);
        expect(layout.scroll, `${page.name}: no horizontal scroll`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(visit_.page, page.scope), page.name).toEqual([]);
        if (width < 768) expect(await phoneProblems(visit_.page, page.scope), page.name).toEqual([]);
        if (page.current !== null) {
          // The current item: the accent-wash pill and a 3 px accent bar, so it is marked by shape as well as colour.
          const colours = THEMES[theme as ThemeName];
          expect(layout.marks.some((mark) => mark.bg === rgb(colours["accent-wash"])), `${page.name}: the pill`).toBe(true);
          expect(layout.marks.some((mark) => mark.bg === rgb(colours.accent) && (mark.width === 3 || mark.height === 3)), `${page.name}: the bar`).toBe(true);
        }
        if (page.name === "missing") {
          expect(layout.title).toBe(TITLE_WORDS["title.notFound"]);
          expect(await visit_.page.locator("h1").innerText()).toBe(UI_WORDS["notFound.title"]);
        }
        await screenshot(visit_.page, `layout-${width}-${theme}-${page.name}`);
        await clean(visit_);
      }
    } finally {
      await visit_.context.close();
    }
  }
}

/**
 * Every text of the nav, the main column and the context column, sampled as drawn against its nearest opaque background
 * (with any see-through layers between blended in): 4.5:1, or 3:1 from 24 px, or 18.66 px in bold (WCAG 1.4.3). Text
 * hidden from assistive technology as decoration (aria-hidden, the skeletons), or clipped to 1 px, is passed over.
 */
const CONTRAST_SCRIPT = `
((scope) => {
  const parse = (value) => {
    const match = /rgba?[(]([^)]+)[)]/.exec(value);
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const channel = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const background = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
    }
    let colour = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    if (colour.a < 1) colour = over(colour, { r: 255, g: 255, b: 255, a: 1 });
    for (let i = layers.length - 1; i >= 0; i--) colour = over(layers[i], colour);
    return colour;
  };
  const out = [];
  const regions = document.querySelectorAll(scope);
  for (const region of regions) {
    for (const element of region.querySelectorAll("*")) {
      const own = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
      if (!own) continue;
      if (element.closest("[aria-hidden=true]")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden") continue;
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      if (opacity === 0) continue;
      const fg = parse(style.color);
      if (!fg) continue;
      const bg = background(element);
      const drawn = over({ ...fg, a: fg.a * opacity }, bg);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const least = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const found = ratio(drawn, bg);
      if (found < least) out.push(element.textContent.trim().slice(0, 40) + ": " + found.toFixed(2) + " < " + least + " (" + style.color + " on rgb(" + Math.round(bg.r) + ", " + Math.round(bg.g) + ", " + Math.round(bg.b) + "))");
    }
  }
  return out;
})
`;

/** The contrast failures of the text inside `scope`. */
const contrast = (page: Page, scope: string) => page.evaluate(`${CONTRAST_SCRIPT}(${JSON.stringify(scope)})`) as Promise<string[]>;

/** The scroll box of the main column's list: the element in main that scrolls vertically and has more to scroll. */
const LIST = `(() => [...document.querySelectorAll("main *")].find((e) => { const s = getComputedStyle(e); return (s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 10; }) || null)()`;

/** The phone header's translateY, from its computed transform; null without one. */
const HEADER_Y = `(() => { const h = document.getElementById("screen-header"); if (!h) return null; const t = getComputedStyle(h).transform; if (t === "none") return 0; const m = /matrix[(]([^)]+)[)]/.exec(t); return m ? Number(m[1].split(",")[5]) : null; })()`;
const HEADER_HEIGHT = `(() => { const h = document.getElementById("screen-header"); return h ? h.getBoundingClientRect().height : null; })()`;

/** Scrolls the main column's list to `y`, in a few steps, as a reader's wheel would. */
async function scrollList(page: Page, y: number): Promise<void> {
  const from = (await page.evaluate(`(${LIST})?.scrollTop ?? 0`)) as number;
  for (let step = 1; step <= 4; step++) {
    await page.evaluate(`(() => { const list = ${LIST}; if (list) list.scrollTop = ${Math.round(from + ((y - from) * step) / 4)}; })()`);
    await pause(60);
  }
}

/**
 * The motion steps' three runs (section 12.3): no reduction, the system's reduced motion, and korbat's own "Reduce motion:
 * Always" with the system's off, as step 16 runs them.
 */
const MOTION_RUNS = [
  ["moves", {}],
  ["system-reduced", { reducedMotion: "reduce" as const }],
  ["korbat-reduced", { appearance: { theme: "light", reduceMotion: "always" } }],
] as const;

/**
 * An element's computed transform or opacity on every frame for `ms`, from now: the element is found anew each frame by
 * `find`, a page expression, and a frame without it gives null. Started before a click, it sees the motion the click
 * starts from its first frame.
 */
function sampleFrames(page: Page, find: string, property: "transform" | "opacity", ms: number): Promise<(string | null)[]> {
  return page.evaluate(
    `new Promise((resolve) => { const out = []; const start = performance.now(); const tick = () => { const e = ${find}; out.push(e ? getComputedStyle(e)[${JSON.stringify(property)}] : null); if (performance.now() - start < ${ms}) requestAnimationFrame(tick); else resolve(out); }; tick(); })`,
  ) as Promise<(string | null)[]>;
}

/** Whether any frame drew a transform other than none or the identity: something moved. */
const transformed = (frames: (string | null)[]) => frames.some((frame) => frame !== null && frame !== "none" && frame !== "matrix(1, 0, 0, 1, 0, 0)");
/** Whether any frame drew the element less than opaque: something faded. */
const faded = (frames: (string | null)[]) => frames.some((frame) => frame !== null && Number(frame) < 0.98);

/** The accessible name of the open dialog, from the ids its aria-labelledby names. */
const DIALOG_NAME = `(() => { const d = document.querySelector('[role="dialog"]'); if (!d) return null; return (d.getAttribute("aria-labelledby") || "").split(" ").filter(Boolean).map((id) => { const e = document.getElementById(id); return e ? e.textContent : ""; }).join(" "); })()`;

/** What holds the focus: its name, or else its words. */
const FOCUSED = `(() => { const e = document.activeElement; if (!e || e === document.body) return null; return (e.getAttribute("aria-label") || e.textContent || "").trim(); })()`;

/** The end of a step that had the fixtures refuse on purpose: the browser's report of each 503 is expected, nothing else. */
async function cleanAfterRefusals(visit: Visit): Promise<void> {
  expect(visit.watcher.take().filter((line) => !/status of 503/.test(line))).toEqual([]);
  expect(fixtures.state.problems.splice(0)).toEqual([]);
}

/** The n-th article of the list on screen (0 for the first). */
const article = (page: Page, n: number) => page.locator('[role="article"]').nth(n);
/** The article of fixture post `n`, found by its one link to the post. */
const postArticle = (page: Page, n: number) => page.locator('[role="article"]').filter({ has: page.locator(`a[href="/post/${postIdOf(n)}"]`) });

/** UI Task 7: the chip of Ada's removed post on her own profile, the button that opens its details sheet. */
const statusChip = (page: Page) => page.locator('[aria-haspopup="dialog"]').filter({ hasText: REMOVED_CHIP });
/** The labelled blocks of the open details sheet, by their names, in their order. */
const STATUS_BLOCKS = `[...document.querySelectorAll('[role="dialog"] [data-status-block]')].map((block) => block.getAttribute("data-status-block"))`;
/** The design's order of the blocks while an appeal can still be filed: Appeal first (section 8.7). */
const OPEN_ORDER = ["appeal", "rule", "does", "appliesTo", "whoSees", "decidedBy", "when", "statement"];

/**
 * The placeholder's sentence (HiddenImage.tsx's HIDDEN_IMAGE, word for word): that component file draws, so the walk,
 * which runs in Node without react-native, holds its own copy, which hidden-media.test.tsx pins to the same words.
 */
const HIDDEN_IMAGE_WORDS = "Image hidden by korbat moderation";

/** Opens the details sheet of Ada's removed post (on /u/ada) and waits until its blocks are drawn. */
async function openStatusSheet(page: Page): Promise<void> {
  await statusChip(page).click();
  await until(page, `${STATUS_BLOCKS}.length === ${OPEN_ORDER.length}`, "the status sheet's blocks");
}

/**
 * How much of a greyscale screenshot differs from its own background: the pixels whose luminance is more than 0.08 away
 * from the corner's, counted in the page from the PNG through a canvas (the policy allows data: images).
 */
const INK_SCRIPT = `
(async (url) => {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  const grey = (i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  const ground = grey(0);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) if (Math.abs(grey(i) - ground) > 0.08) ink += 1;
  return ink;
})
`;

/** The inked pixels of the left 36 px of a counted icon button: its 28 px glyph box after the 8 px padding. */
async function glyphInk(page: Page, button: ReturnType<Page["locator"]>): Promise<number> {
  const box = (await button.boundingBox())!;
  const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: 36, height: box.height } });
  return (await page.evaluate(`${INK_SCRIPT}(${JSON.stringify(`data:image/png;base64,${shot.toString("base64")}`)})`)) as number;
}

describe("the app in Chromium, under the app site's policy", () => {
  test("1. the budgets of section 11.3: the bundle, the stylesheet and the latin fonts", () => {
    const baseline = JSON.parse(readFileSync(path.join(import.meta.dirname, "baseline.json"), "utf8")) as { js: { gzipBytes: number } };
    const js = sizes(path.join("_expo", "static", "js", "web"));
    const css = sizes(path.join("_expo", "static", "css"));
    const jsGzip = js.reduce((sum, file) => sum + file.gzip, 0);
    const cssGzip = css.reduce((sum, file) => sum + file.gzip, 0);
    console.log(`budgets: JS ${jsGzip} bytes gzip in ${js.length} file(s), CSS ${cssGzip}`);
    // The baseline (1222b87) is above 400 KB, so the cap is the baseline plus 80 KB.
    expect(jsGzip).toBeLessThanOrEqual(baseline.js.gzipBytes + 80 * 1024);
    expect(baseline.js.gzipBytes + 80 * 1024).toBe(791_297);
    expect(cssGzip).toBeLessThanOrEqual(40 * 1024);
    const fonts: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (/-latin-(?!ext)[a-z-]*\.[0-9a-f]+\.woff2$/.test(entry.name)) fonts.push(path.join(dir, entry.name));
      }
    };
    walk(path.join(out, "assets"));
    expect(fonts.length).toBeGreaterThanOrEqual(3);
    const latin = fonts.reduce((sum, file) => sum + readFileSync(file).length, 0);
    console.log(`budgets: latin fonts ${latin} bytes in ${fonts.length} files`);
    expect(latin).toBeLessThanOrEqual(320 * 1024);
  });

  test("2. the page, theme-boot.js, a font and the bundle come with the Caddyfile's app headers and caching; a post's page takes the post's status", async () => {
    const headersFor = appSiteHeadersFromCaddyfile();
    const index = readFileSync(path.join(out, "index.html"), "utf8");
    const bundle = /src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/.exec(index)?.[1] ?? "";
    expect(bundle).not.toBe("");
    const font = /\/assets\/[^"'`]+?\.woff2/.exec(readFileSync(path.join(out, bundle), "utf8"))?.[0] ?? "";
    expect(font).toMatch(/^\/assets\/__node_modules\/@fontsource-variable\/[a-z-]+\/files\/[a-z0-9-]+\.[0-9a-f]+\.woff2$/);
    const expected: Record<string, string> = { "/": "no-cache", "/theme-boot.js": "no-cache", [font]: "public, max-age=31536000, immutable", [bundle]: "public, max-age=31536000, immutable" };
    for (const [pathname, cache] of Object.entries(expected)) {
      const answer = await fetch(`${origin}${pathname}`);
      expect(answer.status, pathname).toBe(200);
      expect(answer.headers.get("cache-control"), pathname).toBe(cache);
      for (const [name, value] of Object.entries(headersFor(pathname, pathname !== "/"))) expect(answer.headers.get(name), `${pathname} ${name}`).toBe(value);
      expect(answer.headers.get("content-security-policy"), pathname).toContain("script-src 'self' https://challenges.cloudflare.com");
      await answer.arrayBuffer();
    }
    expect((await fetch(`${origin}/post/${POST_ID}`)).status).toBe(200);
    expect((await fetch(`${origin}/post/${MISSING_POST_ID}`)).status).toBe(404);
    expect(fixtures.state.problems.splice(0)).toEqual([]);
  });

  test("3. the first paint is already in the stored theme, with the bundle held back", async () => {
    for (const theme of ["light", "dark"] as const) {
      // The system says the other scheme, so the stored choice is what decides.
      const visit_ = await open({ width: 1280, height: 900, signedIn: false, appearance: { theme }, colorScheme: theme === "light" ? "dark" : "light" });
      try {
        site!.state.holdBundle = true;
        const started = Date.now();
        await visit_.page.goto(`${origin}/`, { waitUntil: "commit" });
        await until(visit_.page, `document.documentElement.classList.contains(${JSON.stringify(theme)}) && !!document.body`, `the html element in ${theme}`);
        const first = (await visit_.page.evaluate(`({ background: getComputedStyle(document.documentElement).backgroundColor, drawn: document.getElementById("root") ? document.getElementById("root").childElementCount : -1 })`)) as { background: string; drawn: number };
        // Still within the hold: the bundle has not run, and theme-boot.js has painted the theme's surface.
        expect(Date.now() - started).toBeLessThan(HOLD_MS);
        expect(first.drawn).toBe(0);
        expect(first.background).toBe(rgb(THEMES[theme].surface));
        site!.state.holdBundle = false;
        await until(visit_.page, `document.querySelector("[data-layout]") !== null`, "the app drawn");
        await visit_.page.waitForLoadState("networkidle");
        expect(await visit_.page.evaluate(`getComputedStyle(document.documentElement).backgroundColor`)).toBe(rgb(THEMES[theme].surface));
        await clean(visit_);
      } finally {
        site!.state.holdBundle = false;
        await visit_.context.close();
      }
    }
  });

  test("4. the layout at 360 by 740: the tab bar, no context column, no sideways scroll, nothing clipped, every control 44 px", async () => {
    await layoutStep(360, 740, "phone");
  });

  test("5. the layout at 768 by 1024: the rail, no context column", async () => {
    await layoutStep(768, 1024, "tablet");
  });

  test("6. the layout at 1280 by 900: the full nav and the context column", async () => {
    await layoutStep(1280, 900, "wide");
  });

  test("7. the keyboard: the skip link first, then the nav in order with New post last, then the main column, every focus drawn at 2 px or more", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      await visit(visit_.page, "/");
      const focused = `(() => { const e = document.activeElement; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), href: e.getAttribute("href"), role: e.getAttribute("role"), inMain: !!e.closest("main"), isMain: e.tagName === "MAIN", inNav: !!e.closest('nav[aria-label="Main"]'), outline: s.outlineStyle, width: parseFloat(s.outlineWidth), w: r.width, h: r.height }; })()`;
      type Focus = { tag: string; href: string | null; role: string | null; inMain: boolean; isMain: boolean; inNav: boolean; outline: string; width: number; w: number; h: number };
      const stops: Focus[] = [];
      for (let i = 0; i < 7; i++) {
        await visit_.page.keyboard.press("Tab");
        stops.push((await visit_.page.evaluate(focused)) as Focus);
        if (i === 0) await screenshot(visit_.page, "keyboard-1280-dark-skip");
        if (i === 1) await screenshot(visit_.page, "keyboard-1280-dark-nav");
      }
      expect(stops[0]!.href).toBe("#main");
      // The skip link shows itself while it holds the focus, at a control's size.
      expect(stops[0]!.w).toBeGreaterThanOrEqual(44);
      expect(stops[0]!.h).toBeGreaterThanOrEqual(44);
      expect(stops.slice(1, 5).map((stop) => (stop.inNav ? stop.href : null))).toEqual(["/", "/bookmarks", "/u/ada", "/settings/security"]);
      // Task 6: the nav ends with New post, a button and no link.
      expect(stops[5]!.inNav).toBe(true);
      expect(stops[5]!.role).toBe("button");
      expect(stops[5]!.href).toBeNull();
      expect(stops[6]!.inMain).toBe(true);
      // Every stop draws korbat's ring, 2 px: the shell's, and the first stop inside Home's column, Home's own tab (Task 5).
      expect(stops[6]!.role).toBe("tab");
      for (const stop of stops.slice(0, 7)) {
        expect(stop.outline, JSON.stringify(stop)).not.toBe("none");
        expect(stop.width, JSON.stringify(stop)).toBeGreaterThanOrEqual(2);
      }
      await screenshot(visit_.page, "keyboard-1280-dark-main");
      // The skip link moves the focus into the main column without changing the address.
      await visit(visit_.page, "/");
      await visit_.page.keyboard.press("Tab");
      await visit_.page.keyboard.press("Enter");
      const after = (await visit_.page.evaluate(focused)) as Focus;
      expect(after.isMain || after.inMain).toBe(true);
      expect(after.width).toBeGreaterThanOrEqual(2);
      expect(new URL(visit_.page.url()).hash).toBe("");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  for (const [step, theme] of [
    [8, "light"],
    [9, "dim"],
    [10, "dark"],
  ] as const) {
    test(`${step}. contrast as drawn in ${theme}: the shell on Home and a post, the whole rules, missing, decision and terms pages, and the open status sheet`, async () => {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme } });
      try {
        for (const [route, scope] of [
          ["/", DRAWN],
          [`/post/${POST_ID}`, DRAWN],
          ["/rules", ALL],
          ["/no-such-page", ALL],
          // UI Task 7: a decision's screen and the terms, wholly on the tokens.
          [`/settings/cases/${POST_DECISION_ID}`, ALL],
          ["/terms", ALL],
        ] as const) {
          await visit(visit_.page, route);
          expect(await contrast(visit_.page, scope), `${theme} ${route}`).toEqual([]);
          await clean(visit_);
        }
        // The details sheet of Ada's removed post, open with its blocks (section 12.3's theme steps).
        await visit(visit_.page, "/u/ada");
        await openStatusSheet(visit_.page);
        // Sampled once the sheet's opening fade has ended: the walk reads colours as drawn, opacity included.
        await pause(500);
        expect(await contrast(visit_.page, '[role="dialog"]'), `${theme} the status sheet`).toEqual([]);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    });
  }

  test("11. at 320 by 640 with Largest text and the root at 200 percent, nothing scrolls sideways and no label is cut", async () => {
    const visit_ = await open({ width: 320, height: 640, appearance: { theme: "light", textStep: "largest" } });
    try {
      // The screens drawn on the kit: a missing page, Bookmarks under its header, and from Task 5 Home with its tabs and
      // rows; from Task 6 a post with its reply card, and Home's New post sheet open with words in its field; from Task 7
      // a decision's screen, the rules, and the details sheet of Ada's removed post, open.
      for (const [name, route] of [
        ["missing", "/no-such-page"],
        ["bookmarks", "/bookmarks"],
        ["home", "/"],
        ["post", `/post/${POST_ID}`],
        ["composer", "/"],
        ["decision", `/settings/cases/${POST_DECISION_ID}`],
        ["rules", "/rules"],
        ["sheet", "/u/ada"],
      ] as const) {
        await visit(visit_.page, route);
        await visit_.page.evaluate(`document.documentElement.style.fontSize = "200%"`);
        await pause(300);
        if (name === "composer") {
          await visit_.page.locator("[data-compose]").click();
          await visit_.page.locator('[role="dialog"] textarea').fill("Morning light over the harbour, written at the largest text.");
          await pause(400);
        }
        if (name === "sheet") {
          await openStatusSheet(visit_.page);
          await pause(400);
        }
        await screenshot(visit_.page, `largest-320-${name}`);
        // What sticks out past the window's right edge, should anything.
        const wide = (await visit_.page.evaluate(
          `[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== "fixed").slice(0, 8).map((e) => e.tagName.toLowerCase() + " " + (e.getAttribute("role") || "") + " " + (e.textContent || "").trim().slice(0, 30) + " " + Math.round(e.getBoundingClientRect().right))`,
        )) as string[];
        const scroll = (await visit_.page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) as number;
        expect(scroll, `${name}: ${wide.join("; ")}`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(visit_.page, DRAWN), name).toEqual([]);
        await clean(visit_);
      }
    } finally {
      await visit_.context.close();
    }
  });

  for (const [step, signedIn] of [
    [12, false],
    [13, true],
  ] as const) {
    test(`${step}. every route at 1280 in Dark, ${signedIn ? "signed in" : "signed out"}, with nothing reported`, async () => {
      const visit_ = await open({ width: 1280, height: 900, signedIn, appearance: { theme: "dark" } });
      try {
        for (const route of ROUTES) {
          await visit(visit_.page, route);
          const name = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
          await screenshot(visit_.page, `route-${signedIn ? "in" : "out"}-${name.slice(0, 60)}`);
          const problems = visit_.watcher.take();
          expect(problems, route).toEqual([]);
          expect(fixtures.state.problems.splice(0), route).toEqual([]);
        }
      } finally {
        await visit_.context.close();
      }
    });
  }

  test("14. before its first content a route asks the API at most three times, and Home's first post is drawn within 2.5 s", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      const firsts: { route: string; shown: string }[] = [
        { route: "/", shown: "Morning light over the harbour" },
        { route: `/post/${POST_ID}`, shown: "Morning light over the harbour" },
        { route: "/u/grace", shown: "Grace Hopper" },
        { route: "/rules", shown: "R1" },
      ];
      for (const { route, shown } of firsts) {
        // From a blank page, so nothing of the previous route is in flight.
        await visit_.page.goto("about:blank");
        const from = fixtures.state.requests.length;
        const started = Date.now();
        await visit_.page.goto(`${origin}${route}`, { waitUntil: "commit" });
        await visit_.page.getByText(shown).first().waitFor({ state: "visible" });
        const took = Date.now() - started;
        // Images are the posts' own and come after them; the count is of the API's answers the content waits for.
        const asked = fixtures.state.requests.slice(from).filter((request) => !request.path.startsWith("/api/media/"));
        console.log(`first content of ${route}: ${took} ms after ${asked.length} requests (${asked.map((request) => request.path).join(", ")})`);
        expect(asked.length, route).toBeLessThanOrEqual(3);
        if (route === "/") expect(took).toBeLessThan(2500);
        await visit_.page.waitForLoadState("networkidle");
        await clean(visit_);
      }
    } finally {
      await visit_.context.close();
    }
  });

  test("15. offline: a polite status at the top of the main column says so, and leaves when the connection is back", async () => {
    const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" } });
    try {
      await visit(visit_.page, "/");
      const banner = visit_.page.locator('main [role="status"]', { hasText: UI_WORDS["offline.title"] });
      expect(await banner.count()).toBe(0);
      await visit_.context.setOffline(true);
      await banner.first().waitFor({ state: "visible" });
      expect(await visit_.page.locator('main [role="status"][aria-live="polite"]').first().innerText()).toBe(UI_WORDS["offline.title"]);
      await screenshot(visit_.page, "offline-360-light");
      await visit_.context.setOffline(false);
      await banner.first().waitFor({ state: "detached" });
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("16. on a phone the header slides away as Bookmarks scrolls down and returns on a scroll up; under reduced motion it stays", async () => {
    for (const [name, options] of [
      ["moves", {}],
      ["system-reduced", { reducedMotion: "reduce" as const }],
      ["korbat-reduced", { appearance: { theme: "light", reduceMotion: "always" } }],
    ] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/bookmarks");
        const height = (await visit_.page.evaluate(HEADER_HEIGHT)) as number;
        expect(height, name).toBeGreaterThan(40);
        expect(await visit_.page.evaluate(HEADER_Y), name).toBe(0);
        // The list starts below the floating header: its first row is not under it.
        const firstRow = (await visit_.page.evaluate(`(() => { const list = ${LIST}; const row = list && list.querySelector("[role=article], a[href^='/post/']"); return row ? row.getBoundingClientRect().top : null; })()`)) as number | null;
        expect(firstRow, name).not.toBeNull();
        expect(firstRow!, name).toBeGreaterThanOrEqual(height - 1);
        await scrollList(visit_.page, height * 4);
        await pause(450);
        const down = (await visit_.page.evaluate(HEADER_Y)) as number;
        if (name === "moves") expect(Math.round(down), name).toBe(-Math.round(height));
        else expect(down, name).toBe(0);
        await screenshot(visit_.page, `header-360-${name}-down`);
        await scrollList(visit_.page, height * 3);
        await pause(450);
        expect(await visit_.page.evaluate(HEADER_Y), name).toBe(0);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("17. pressing the current Home item brings the feed back to its newest post without leaving the page, at once under reduced motion", async () => {
    for (const [name, options] of [
      ["smooth", { width: 1280, height: 900 }],
      ["reduced", { width: 360, height: 740, reducedMotion: "reduce" as const }],
    ] as const) {
      const visit_ = await open({ appearance: { theme: "dark" }, ...options });
      try {
        await visit(visit_.page, "/?tab=latest");
        await scrollList(visit_.page, 1500);
        await pause(200);
        const scrolled = (await visit_.page.evaluate(`${LIST}.scrollTop`)) as number;
        expect(scrolled, name).toBeGreaterThan(1000);
        await visit_.page.locator('nav[aria-label="Main"] a[aria-current="page"]').click();
        if (name === "reduced") {
          await pause(50);
          expect(await visit_.page.evaluate(`${LIST}.scrollTop`), name).toBe(0);
        } else {
          // Smooth: still on its way a moment after the press, at the top soon after.
          await until(visit_.page, `${LIST}.scrollTop === 0`, "the feed at its top", 3000);
        }
        // The press did not navigate: the tab in the address is the reader's still.
        expect(new URL(visit_.page.url()).search, name).toBe("?tab=latest");
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("18. the lightbox: named, Close, Previous and Next, the arrows, Escape and the focus back on the image; it grows from the image, and at once under reduced motion", async () => {
    // Post 8 holds two images; the first one's cell opens the viewer.
    const cellOf = (page: Page) => page.locator('[role="button"][aria-label^="Open image: A photograph, number 8,"]').first();
    const counter = (page: Page, n: number) => until(page, `!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(`${n} of 2`)})`, `${n} of 2`);
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/?tab=latest");
        const cell = cellOf(visit_.page);
        await cell.scrollIntoViewIfNeeded();
        const frames = sampleFrames(visit_.page, `document.querySelector("[data-lightbox-image]") && document.querySelector("[data-lightbox-image]").parentElement`, "transform", 700);
        await cell.click();
        const dialog = visit_.page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        // Growing from the thumbnail moves the image between frames; under either reduced motion it only fades.
        expect(transformed(await frames), name).toBe(name === "moves");
        const named = (await visit_.page.evaluate(DIALOG_NAME)) as string;
        expect(named, name).toContain("1 of 2");
        expect(named, name).toContain("A photograph, number 8, of the harbour at dawn");
        expect(await dialog.locator('[role="button"]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual([UI_WORDS["media.close"], UI_WORDS["media.previous"], UI_WORDS["media.next"]]);
        // The arrow keys switch at once; Next does too.
        await visit_.page.keyboard.press("ArrowRight");
        await counter(visit_.page, 2);
        await visit_.page.keyboard.press("ArrowLeft");
        await counter(visit_.page, 1);
        await dialog.locator(`[aria-label="${UI_WORDS["media.next"]}"]`).click();
        await counter(visit_.page, 2);
        await dialog.locator(`[aria-label="${UI_WORDS["media.previous"]}"]`).click();
        await counter(visit_.page, 1);
        // Escape closes it, and the image that opened it holds the focus again.
        await visit_.page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        expect(await visit_.page.evaluate(FOCUSED), name).toMatch(/^Open image: A photograph, number 8,/);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        try {
          await visit(visit_.page, "/?tab=latest");
          await cellOf(visit_.page).scrollIntoViewIfNeeded();
          await cellOf(visit_.page).click();
          await visit_.page.locator('[role="dialog"]').waitFor({ state: "visible" });
          await pause(600);
          await screenshot(visit_.page, `lightbox-${width}-${theme}`);
          // The stage is a forced Dark scope: its words read on the near-black in every theme.
          expect(await contrast(visit_.page, '[role="dialog"]'), `${width} ${theme}`).toEqual([]);
          if (width < 768) expect(await phoneProblems(visit_.page, '[role="dialog"]')).toEqual([]);
          await visit_.page.keyboard.press("Escape");
          await visit_.page.locator('[role="dialog"]').waitFor({ state: "detached" });
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }
  });

  test("19. Like: pressed and counted at once, the answer's counts after; a refusal rolls back with its toast; it pops, and changes at once under reduced motion; a reposted Repost differs from an idle one in greyscale", async () => {
    const LIKE = '[role="button"][aria-label^="Like"]';
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/?tab=latest");
        // Post 1 (Grace's) has 3 likes, none of them the reader's.
        const like = article(visit_.page, 0).locator(LIKE);
        expect(await like.getAttribute("aria-label")).toBe("Like, 3 likes");
        expect(await like.getAttribute("aria-pressed")).toBe("false");
        fixtures.state.delayMs = 1500;
        const frames = sampleFrames(visit_.page, `document.querySelector('[role="article"] ${LIKE}') && document.querySelector('[role="article"] ${LIKE}').parentElement`, "transform", 1200);
        await like.click();
        // Before the answer: pressed, and one more like.
        await until(visit_.page, `document.querySelector('[role="article"] ${LIKE}').getAttribute("aria-pressed") === "true"`, "pressed at once", 1000);
        expect(await like.getAttribute("aria-label")).toBe("Like, 4 likes");
        const drawn = await frames;
        expect(transformed(drawn), `${name}: ${[...new Set(drawn)].slice(0, 6).join(" | ")}`).toBe(name === "moves");
        if (name === "moves") await screenshot(visit_.page, "like-1280-light");
        // The answer's counts replace the card's guess: two others liked it meanwhile.
        await until(visit_.page, `document.querySelector('[role="article"] ${LIKE}').getAttribute("aria-label") === "Like, 6 likes"`, "the answer's count");
        expect(await like.getAttribute("aria-pressed")).toBe("true");
        fixtures.state.delayMs = 0;
        // A refusal: post 2 (Linus's, 6 likes) is liked, then put back as it was, and the toast says so.
        fixtures.state.refuse.add("like");
        const other = article(visit_.page, 1).locator(LIKE);
        expect(await other.getAttribute("aria-label")).toBe("Like, 6 likes");
        await other.click();
        await visit_.page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.failed.like"]).waitFor({ state: "visible" });
        expect(await other.getAttribute("aria-pressed")).toBe("false");
        expect(await other.getAttribute("aria-label")).toBe("Like, 6 likes");
        fixtures.state.refuse.delete("like");
        if (name === "moves") {
          // 4.7: a reposted Repost is told from an idle one by its shape, which a greyscale screenshot keeps.
          const repost = article(visit_.page, 0).locator('[role="button"][aria-label^="Repost"]');
          await repost.click();
          await visit_.page.locator("[data-menu]").getByRole("button", { name: UI_WORDS["post.repost"] }).click();
          await until(visit_.page, `document.querySelector('[role="article"] [role="button"][aria-label^="Repost"]').getAttribute("aria-pressed") === "true"`, "reposted");
          await visit_.page.locator("[data-menu]").waitFor({ state: "detached" });
          await visit_.page.mouse.move(2, 2);
          await pause(400);
          const reposted = await glyphInk(visit_.page, repost);
          const idle = await glyphInk(visit_.page, article(visit_.page, 1).locator('[role="button"][aria-label^="Repost"]'));
          console.log(`greyscale ink of a reposted Repost ${reposted}, of an idle one ${idle}`);
          expect(reposted).toBeGreaterThan(idle * 1.5);
          await screenshot(visit_.page, "reposted-1280-light");
        }
        await cleanAfterRefusals(visit_);
      } finally {
        fixtures.state.delayMs = 0;
        fixtures.state.refuse.clear();
        await visit_.context.close();
      }
    }
  });

  test("20. Follow on a profile: Following at once, kept after the answer; a refusal rolls back with its toast; the label cross-fades, at once under reduced motion", async () => {
    const BUTTON = '[data-follow] [role="button"]';
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/u/grace");
        const button = visit_.page.locator(BUTTON);
        expect(await button.innerText()).toBe(UI_WORDS["follow.follow"]);
        // Refused: Following at once, then Follow again, and the toast.
        fixtures.state.delayMs = 800;
        fixtures.state.refuse.add("follow");
        const frames = sampleFrames(visit_.page, `document.querySelector('${BUTTON}') && document.querySelector('${BUTTON}').firstElementChild`, "opacity", 400);
        await button.click();
        await until(visit_.page, `document.querySelector('${BUTTON}').innerText === ${JSON.stringify(UI_WORDS["follow.following"])}`, "Following at once", 700);
        expect(faded(await frames), name).toBe(name === "moves");
        await visit_.page.locator("[data-sonner-toaster]").getByText("Couldn't follow @grace. Try again.").waitFor({ state: "visible" });
        expect(await button.innerText()).toBe(UI_WORDS["follow.follow"]);
        if (name === "moves") await screenshot(visit_.page, "follow-refused-360-light");
        fixtures.state.refuse.delete("follow");
        // Answered: Following, and still Following once the answer has landed.
        await button.click();
        await until(visit_.page, `document.querySelector('${BUTTON}').innerText === ${JSON.stringify(UI_WORDS["follow.following"])}`, "Following at once", 700);
        await pause(1200);
        expect(await button.innerText()).toBe(UI_WORDS["follow.following"]);
        expect(await phoneProblems(visit_.page, "[data-follow], [data-sonner-toaster]")).toEqual([]);
        await cleanAfterRefusals(visit_);
      } finally {
        fixtures.state.delayMs = 0;
        fixtures.state.refuse.clear();
        await visit_.context.close();
      }
    }
  });

  test("21. the menus: a popover at 1280 and a sheet at 360; Report on Grace's post, Delete on Ada's with Keep's focus and its return; Repost's menu; the arrows; Escape back to More; Copy link and its toast", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    try {
      await visit_.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
      await visit(visit_.page, "/?tab=latest");
      const page = visit_.page;
      // Grace's post 1: Who sees this, Copy link, and Report as a link to the form.
      const more = postArticle(page, 1).locator(MORE);
      await more.click();
      const menu = page.locator("[data-menu]");
      await menu.waitFor({ state: "visible" });
      expect(await more.getAttribute("aria-expanded")).toBe("true");
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([expect.stringContaining(UI_WORDS["post.whoSees"]), UI_WORDS["post.copyLink"]]);
      expect(await menu.locator("a").getAttribute("href")).toBe(`/report?post=${postIdOf(1)}`);
      // The first item holds the focus; the arrows move it, and wrap.
      await until(page, `${FOCUSED} !== null && ${FOCUSED}.startsWith(${JSON.stringify(UI_WORDS["post.whoSees"])})`, "the first item focused", 2000);
      const steps: [string, string][] = [
        ["ArrowDown", UI_WORDS["post.copyLink"]],
        ["ArrowDown", "Report"],
        ["ArrowDown", UI_WORDS["post.whoSees"]],
        ["ArrowUp", "Report"],
        ["Home", UI_WORDS["post.whoSees"]],
        ["End", "Report"],
      ];
      for (const [key, words] of steps) {
        await page.keyboard.press(key);
        expect(((await page.evaluate(FOCUSED)) as string).startsWith(words), key).toBe(true);
      }
      await screenshot(page, "menu-1280-light");
      expect(await contrast(page, "[data-menu]")).toEqual([]);
      // Escape closes it and gives the focus back to More.
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      expect(await page.evaluate(FOCUSED)).toBe(UI_WORDS["post.more"]);
      expect(await more.getAttribute("aria-expanded")).toBe("false");
      // Copy link: the post's address on the clipboard, and the toast.
      await more.click();
      await menu.getByRole("button", { name: UI_WORDS["post.copyLink"] }).click();
      await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.linkCopied"]).waitFor({ state: "visible" });
      expect(await page.evaluate("navigator.clipboard.readText()")).toBe(`${origin}/post/${postIdOf(1)}`);
      // Ada's own post 3: Delete instead of Report. The question takes More's place, Keep takes the focus and gives it back.
      const ada = postArticle(page, 3);
      await ada.locator(MORE).click();
      await menu.waitFor({ state: "visible" });
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([expect.stringContaining(UI_WORDS["post.whoSees"]), UI_WORDS["post.copyLink"], UI_WORDS["post.delete"]]);
      expect(await menu.locator("a").count()).toBe(0);
      await menu.getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      const question = ada.locator('[role="dialog"]');
      await question.waitFor({ state: "visible" });
      await until(page, `${FOCUSED} === "Keep"`, "Keep focused");
      expect(await ada.locator(MORE).count()).toBe(0);
      await screenshot(page, "delete-question-1280-light");
      await page.keyboard.press("Enter");
      await question.waitFor({ state: "detached" });
      await until(page, `${FOCUSED} === ${JSON.stringify(UI_WORDS["post.more"])}`, "More focused again");
      // Delete, answered: the card fades out of the list.
      await ada.locator(MORE).click();
      await menu.getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      await ada.locator('[role="dialog"]').getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      await postArticle(page, 3).waitFor({ state: "detached" });
      expect(fixtures.state.requests.some((request) => request.method === "DELETE" && request.path === `/api/posts/${postIdOf(3)}`)).toBe(true);
      // Repost's menu on Linus's post 2: Repost, and Quote as a link to the quote composer; Escape back to its trigger.
      const repost = postArticle(page, 2).locator('[role="button"][aria-label^="Repost"]');
      await repost.click();
      await menu.waitFor({ state: "visible" });
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([UI_WORDS["post.repost"]]);
      expect(await menu.locator("a").getAttribute("href")).toBe(`/post/${postIdOf(2)}?quote=1`);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      expect(await page.evaluate(FOCUSED)).toMatch(/^Repost/);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
    // Below 768 px the same menu is a sheet titled by its trigger's label, with a grab handle.
    for (const theme of ["light", "dark"] as const) {
      const phone = await open({ width: 360, height: 740, appearance: { theme } });
      try {
        await visit(phone.page, "/?tab=latest");
        const more = article(phone.page, 0).locator(MORE);
        await more.click();
        const sheet = phone.page.locator('[role="dialog"]');
        await sheet.waitFor({ state: "visible" });
        expect(await phone.page.evaluate(DIALOG_NAME)).toBe(UI_WORDS["post.more"]);
        expect(await sheet.locator("[data-handle]").count()).toBe(1);
        await until(phone.page, `${FOCUSED} !== null && ${FOCUSED}.startsWith(${JSON.stringify(UI_WORDS["post.whoSees"])})`, "the first item focused", 2000);
        await pause(500);
        await screenshot(phone.page, `menu-sheet-360-${theme}`);
        expect(await phoneProblems(phone.page, '[role="dialog"]')).toEqual([]);
        expect(await clippedLabels(phone.page, '[role="dialog"]')).toEqual([]);
        expect(await contrast(phone.page, '[role="dialog"]')).toEqual([]);
        await phone.page.keyboard.press("Escape");
        await sheet.waitFor({ state: "detached" });
        expect(await phone.page.evaluate(FOCUSED)).toBe(UI_WORDS["post.more"]);
        await clean(phone);
      } finally {
        await phone.context.close();
      }
    }
    const dark = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      await visit(dark.page, "/?tab=latest");
      await article(dark.page, 0).locator(MORE).click();
      await dark.page.locator("[data-menu]").waitFor({ state: "visible" });
      await pause(300);
      await screenshot(dark.page, "menu-1280-dark");
      expect(await contrast(dark.page, "[data-menu]")).toEqual([]);
      await clean(dark);
    } finally {
      await dark.context.close();
    }
  });

  test("22. Who sees this: public on Grace's post, with how korbat treats reach; on Ada's own post 3 also what a block does, the feeds and its Explore status, asked as the sheet opens", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    for (const [width, height] of [
      [1280, 900],
      [360, 740],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        try {
          const page = visit_.page;
          await visit(page, "/?tab=latest");
          const openWho = async (n: number) => {
            await postArticle(page, n).locator(MORE).click();
            await page.getByRole("button", { name: UI_WORDS["post.whoSees"] }).click();
            await until(page, `${DIALOG_NAME} === ${JSON.stringify(UI_WORDS["post.whoSees"])}`, "Who sees this open");
          };
          const sheet = page.locator('[role="dialog"]');
          await openWho(1);
          expect(await sheet.innerText()).toContain(UI_WORDS["reach.public"]);
          expect(await sheet.innerText()).toContain(UI_WORDS["reach.never"]);
          expect(await sheet.innerText()).not.toContain(UI_WORDS["reach.blocked"]);
          expect(await sheet.locator('a[href="/explore/about"]').innerText()).toBe(UI_WORDS["reach.how"]);
          await until(page, `${FOCUSED} === ${JSON.stringify(UI_WORDS["post.whoSees"])}`, "the title focused", 2000);
          await pause(400);
          await screenshot(page, `who-sees-other-${width}-${theme}`);
          expect(await contrast(page, '[role="dialog"]')).toEqual([]);
          if (width < 768) expect(await phoneProblems(page, '[role="dialog"]')).toEqual([]);
          await page.keyboard.press("Escape");
          await sheet.waitFor({ state: "detached" });
          expect(await page.evaluate(FOCUSED)).toBe(UI_WORDS["post.more"]);
          // Ada's own post 3: its Explore status is asked when the sheet opens, and said in the status line's words.
          const asked = fixtures.state.requests.length;
          await openWho(3);
          await sheet.getByText("In Explore", { exact: true }).waitFor({ state: "visible" });
          expect(fixtures.state.requests.slice(asked).map((request) => request.path)).toContain(`/api/posts/${postIdOf(3)}/explore`);
          for (const words of [UI_WORDS["reach.public"], UI_WORDS["reach.blocked"], UI_WORDS["reach.feeds"], UI_WORDS["reach.never"]]) expect(await sheet.innerText()).toContain(words);
          await pause(300);
          await screenshot(page, `who-sees-own-${width}-${theme}`);
          await page.keyboard.press("Escape");
          await sheet.waitFor({ state: "detached" });
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }
  });

  // UI Task 5: the feeds that keep the reader's place (UI design, sections 7.5, 8.2, 8.3 and 10).

  /** The post at the top of the main column's list: its open link and how far its top is below the list's top line. */
  const TOP_ARTICLE = `(() => { const list = ${LIST}; if (!list) return null; const line = list.getBoundingClientRect().top + (parseFloat(getComputedStyle(list.firstElementChild).paddingTop) || 0); const article = [...list.querySelectorAll('[role="article"]')].find((a) => a.querySelector("[data-open]") && a.getBoundingClientRect().bottom > line + 1); if (!article) return null; return { href: article.querySelector("[data-open]").getAttribute("href"), top: Math.round((article.getBoundingClientRect().top - line) * 10) / 10 }; })()`;
  type Top = { href: string; top: number } | null;
  /** Whether the post at the top is the one at `href`, its top within 2 px of the list's top line. */
  const onTop = (href: string) => `(() => { const top = ${TOP_ARTICLE}; return !!top && top.href === ${JSON.stringify(href)} && Math.abs(top.top) <= 2; })()`;

  /** Scrolls the list until fixture post `href` is at its top line, as a reader would, a screen at a time. */
  async function scrollToPost(page: Page, href: string): Promise<void> {
    for (let tries = 0; tries < 40; tries++) {
      const there = await page.evaluate(
        `(() => { const list = ${LIST}; if (!list) return false; const link = list.querySelector('[role="article"] [data-open][href="${href}"]'); if (!link) { list.scrollTop += 500; return false; } const line = list.getBoundingClientRect().top + (parseFloat(getComputedStyle(list.firstElementChild).paddingTop) || 0); const delta = link.closest('[role="article"]').getBoundingClientRect().top - line; list.scrollTop += delta; return Math.abs(delta) < 1; })()`,
      );
      if (there) return;
      await pause(120);
    }
    throw new Error(`${href} never came to the top`);
  }

  /** Waits until a condition on the walk's side is true. */
  async function waitFor(check: () => boolean, what: string, timeout = 10_000): Promise<void> {
    const end = Date.now() + timeout;
    while (!check()) {
      if (Date.now() > end) throw new Error(`not within ${timeout} ms: ${what}`);
      await pause(50);
    }
  }

  /** How many API requests have begun with `path` so far. */
  const asked = (path: string) => fixtures.state.requests.filter((request) => request.path.startsWith(path)).length;

  /** The keys of every reading place in the page's storage. */
  const PLACES = `Object.keys(localStorage).filter((key) => key.startsWith("korbat.place."))`;

  test("23. new posts: after the poll the pill says how many are above while the post on top stays still; pressing it brings the oldest new post to the top; at zero it says You're all caught up; it slides in, and only fades under reduced motion", async () => {
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      const page = visit_.page;
      try {
        // The page's own clock, so the walk need not wait the poll's 30 seconds: it flows as time does, and jumps on asking.
        await page.clock.install();
        await visit(page, "/?tab=latest");
        await scrollToPost(page, `/post/${postIdOf(6)}`);
        await pause(400);
        const before = (await page.evaluate(TOP_ARTICLE)) as Top;
        expect(before?.href).toBe(`/post/${postIdOf(6)}`);
        // Three posts arrive; the timeline's answer waits a moment, so the pill's entrance is sampled from its first frame.
        fixtures.state.newPosts = 3;
        fixtures.state.timelineDelayMs = 600;
        await page.clock.fastForward(31_000);
        const frames = sampleFrames(page, `document.querySelector("[data-pill]") && document.querySelector("[data-pill]").parentElement`, "transform", 1400);
        const pill = page.locator("[data-pill]");
        await pill.waitFor({ state: "visible" });
        expect(transformed(await frames), name).toBe(name === "moves");
        fixtures.state.timelineDelayMs = 0;
        expect(await pill.innerText()).toBe("3 new posts");
        expect(await pill.getAttribute("aria-label")).toBe("3 new posts above, go to the first one");
        // Nothing the reader reads moved.
        const after = (await page.evaluate(TOP_ARTICLE)) as Top;
        expect(after?.href, name).toBe(before?.href);
        expect(Math.abs(after!.top - before!.top), name).toBeLessThanOrEqual(1);
        if (name === "moves") await screenshot(page, "pill-1280-light");
        // The pill takes the reader to the oldest of the new posts, right above where they were, to read on upwards.
        await pill.click();
        await until(page, onTop(`/post/${newPostIdOf(1)}`), "the oldest new post on top", 5000);
        await until(page, `document.querySelector("[data-pill]") && document.querySelector("[data-pill]").innerText === "2 new posts"`, "two left", 3000);
        // Up to the newest: none left, and the pill says so for two seconds before it leaves.
        await scrollList(page, 0);
        await until(page, `!!document.querySelector("[data-pill]") && document.querySelector("[data-pill]").innerText === ${JSON.stringify(UI_WORDS["feed.caughtUp"])}`, "caught up", 3000);
        if (name === "moves") await screenshot(page, "pill-caught-up-1280-light");
        await pill.waitFor({ state: "detached", timeout: 6000 });
        await clean(visit_);
      } finally {
        fixtures.state.newPosts = 0;
        fixtures.state.timelineDelayMs = 0;
        await visit_.context.close();
      }
    }
    // The pill at a phone's width, in both themes, under the floating header.
    for (const theme of ["light", "dark"] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme } });
      const page = visit_.page;
      try {
        await page.clock.install();
        await visit(page, "/?tab=latest");
        await scrollToPost(page, `/post/${postIdOf(4)}`);
        fixtures.state.newPosts = 2;
        await page.clock.fastForward(31_000);
        await page.locator("[data-pill]").waitFor({ state: "visible" });
        await pause(400);
        await screenshot(page, `pill-360-${theme}`);
        expect(await contrast(page, "[data-pill]")).toEqual([]);
        expect(await phoneProblems(page, "[data-pill]")).toEqual([]);
        await clean(visit_);
      } finally {
        fixtures.state.newPosts = 0;
        await visit_.context.close();
      }
    }
  });

  test("24. the reading place: Latest opens again at the post the reader stopped at, You were here above it and the new posts counted; at the newest when the reader asks; nothing kept signed out; signing out clears it with the appearance", async () => {
    const visit_ = await open({ width: 1280, height: 900 });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      // The first posts are seen (half in view for half a second), then the reader stops at post 12.
      await pause(800);
      await scrollToPost(page, `/post/${postIdOf(12)}`);
      await pause(1600);
      expect(await page.evaluate(PLACES)).toEqual([`korbat.place.${ADA.id}`]);
      // Two posts arrive while the reader is away; the feed opens at post 12 again.
      fixtures.state.newPosts = 2;
      await visit(page, "/?tab=latest");
      await until(page, onTop(`/post/${postIdOf(12)}`), "post 12 on top again");
      // The marker sits above the posts already seen, under the two new ones, which the pill counts.
      const marker = page.locator("[data-marker]");
      expect(await marker.innerText()).toContain(UI_WORDS["feed.marker.title"]);
      expect(await marker.innerText()).toContain(UI_WORDS["feed.marker.body"]);
      expect(await page.locator("[data-pill]").innerText()).toBe("2 new posts");
      expect(
        await page.evaluate(`(() => { const marker = document.querySelector("[data-marker]"); const post = document.querySelector('[data-open][href="/post/${postIdOf(12)}"]'); return !!(marker.compareDocumentPosition(post) & Node.DOCUMENT_POSITION_FOLLOWING); })()`),
      ).toBe(true);
      await screenshot(page, "place-1280-light");
      // "Open feeds at the newest post": the newest, whatever was kept.
      await page.evaluate(`localStorage.setItem("korbat.appearance", JSON.stringify({ openNewest: true }))`);
      await visit(page, "/?tab=latest");
      // At the top of the list, under the composer: the first post is the newest.
      await until(page, `!!${LIST} && ${LIST}.scrollTop === 0 && document.querySelector('[role="feed"] [role="article"] [data-open]').getAttribute("href") === "/post/${newPostIdOf(2)}"`, "the newest post first, at the top");
      // Signing out ends the session: every place and the appearance go.
      await visit(page, "/settings/security");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await until(page, `location.pathname === "/" && !document.querySelector('nav[aria-label="Main"] a[href="/bookmarks"]')`, "signed out, on Home");
      expect(await page.evaluate(PLACES)).toEqual([]);
      expect(await page.evaluate(`localStorage.getItem("korbat.appearance")`)).toBeNull();
      await clean(visit_);
    } finally {
      fixtures.state.newPosts = 0;
      await visit_.context.close();
    }
    // A reader who is signed out keeps no place.
    const out = await open({ width: 1280, height: 900, signedIn: false });
    try {
      await visit(out.page, "/?tab=latest");
      await pause(800);
      await scrollToPost(out.page, `/post/${postIdOf(12)}`);
      await pause(1600);
      expect(await out.page.evaluate(PLACES)).toEqual([]);
      expect(await out.page.locator("[data-marker], [data-pill]").count()).toBe(0);
      await clean(out);
    } finally {
      await out.context.close();
    }
  });

  test("25. Following, Latest and Following again: the same post on top and page one not asked again; Explore is read again each time it is chosen", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    const page = visit_.page;
    try {
      await visit(page, "/");
      await scrollToPost(page, `/post/${postIdOf(9)}`);
      await pause(300);
      const before = (await page.evaluate(TOP_ARTICLE)) as Top;
      const following = asked("/api/timeline/following");
      const tab = (label: string) => page.locator('[role="tablist"] [role="tab"]', { hasText: label });
      await tab(UI_WORDS["home.latest"]).click();
      await until(page, `new URL(location.href).searchParams.get("tab") === "latest" && !!document.querySelector('[role="feed"] [role="article"]')`, "Latest shown");
      await tab(UI_WORDS["home.following"]).click();
      await until(page, onTop(before!.href), "the same post on top");
      const after = (await page.evaluate(TOP_ARTICLE)) as Top;
      expect(Math.abs(after!.top - before!.top)).toBeLessThanOrEqual(2);
      expect(asked("/api/timeline/following")).toBe(following);
      // Explore is never kept: each time it is chosen, it is read again.
      const explore = asked("/api/timeline/explore");
      await tab(UI_WORDS["home.explore"]).click();
      await waitFor(() => asked("/api/timeline/explore") === explore + 1, "Explore read");
      await tab(UI_WORDS["home.latest"]).click();
      await until(page, `new URL(location.href).searchParams.get("tab") === "latest"`, "Latest again");
      await tab(UI_WORDS["home.explore"]).click();
      await waitFor(() => asked("/api/timeline/explore") === explore + 2, "Explore read again");
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("26. the keyboard on Home: Tab reaches the skip link, the nav, Home's tab and the first post's open link in that order; Page Down and Page Up move between posts; the arrows choose the tabs; the list is a feed", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/");
      const feed = page.locator('[role="feed"]');
      expect(await feed.count()).toBe(1);
      expect(await feed.getAttribute("aria-busy")).toBe("false");
      expect(await feed.locator('[role="article"]').first().getAttribute("aria-posinset")).toBe("1");
      expect(await feed.locator('[role="article"]').first().getAttribute("aria-setsize")).toBe("-1");
      const first = (await page.evaluate(`document.querySelector('[role="feed"] [role="article"] [data-open]').getAttribute("href")`)) as string;
      const WHERE = `(() => { const e = document.activeElement; return { href: e.getAttribute("href"), role: e.getAttribute("role"), nav: !!e.closest('nav[aria-label="Main"]'), open: e.hasAttribute("data-open"), outline: parseFloat(getComputedStyle(e).outlineWidth) }; })()`;
      type Where = { href: string | null; role: string | null; nav: boolean; open: boolean; outline: number };
      const kinds: string[] = [];
      for (let i = 0; i < 40 && !kinds.includes("post"); i++) {
        await page.keyboard.press("Tab");
        const at = (await page.evaluate(WHERE)) as Where;
        const kind = at.href === "#main" ? "skip" : at.nav ? "nav" : at.role === "tab" ? "tab" : at.open && at.href === first ? "post" : "other";
        kinds.push(kind);
        if (kind === "tab" || kind === "post") expect(at.outline, kind).toBeGreaterThanOrEqual(2);
      }
      expect(kinds.indexOf("skip")).toBe(0);
      expect(kinds.indexOf("nav")).toBe(1);
      expect(kinds.indexOf("tab")).toBeGreaterThan(kinds.lastIndexOf("nav"));
      expect(kinds.indexOf("post")).toBeGreaterThan(kinds.indexOf("tab"));
      // One tab stop for the whole tab list.
      expect(kinds.filter((kind) => kind === "tab")).toHaveLength(1);
      // Page Down and Page Up: from article to article, by their open links.
      const hrefs = (await feed.locator('[role="article"] [data-open]').evaluateAll((links) => links.slice(0, 3).map((link) => link.getAttribute("href")))) as string[];
      await page.keyboard.press("PageDown");
      expect(((await page.evaluate(WHERE)) as Where).href).toBe(hrefs[1]);
      await page.keyboard.press("PageDown");
      expect(((await page.evaluate(WHERE)) as Where).href).toBe(hrefs[2]);
      await page.keyboard.press("PageUp");
      expect(((await page.evaluate(WHERE)) as Where).href).toBe(hrefs[1]);
      await screenshot(page, "keyboard-1280-light-post");
      // The tabs' arrows choose at once and move the focus with the choice.
      await page.locator('[role="tab"][aria-selected="true"]').focus();
      await page.keyboard.press("ArrowRight");
      await until(page, `new URL(location.href).searchParams.get("tab") === "latest" && document.activeElement.getAttribute("aria-selected") === "true"`, "Latest chosen by the arrow");
      await page.keyboard.press("ArrowLeft");
      await until(page, `new URL(location.href).searchParams.get("tab") === "following" && document.activeElement.getAttribute("aria-selected") === "true"`, "Following chosen by the arrow");
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("27. a deleted post hands the focus to the next post's open link; a reply's thread opens with its post at the top and its chain above it", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      const ada = postArticle(page, 3);
      await ada.locator(MORE).click();
      await page.locator("[data-menu]").getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      const question = ada.locator('[role="dialog"]');
      await question.waitFor({ state: "visible" });
      await question.getByRole("button", { name: UI_WORDS["post.delete"] }).focus();
      await page.keyboard.press("Enter");
      await postArticle(page, 3).waitFor({ state: "detached" });
      await until(page, `!!document.activeElement && document.activeElement.hasAttribute("data-open") && document.activeElement.getAttribute("href") === "/post/${postIdOf(4)}"`, "post 4's open link focused");
      // Ada's post 3 replies to a chain of three: the page opens with it at the top, the chain above, out of view.
      const FOCUSED_ROW = `(() => { const list = ${LIST}; const row = document.querySelector('[data-row="focused"]'); if (!list || !row) return null; return { top: row.getBoundingClientRect().top - list.getBoundingClientRect().top - (parseFloat(getComputedStyle(list.firstElementChild).paddingTop) || 0), scroll: list.scrollTop }; })()`;
      await visit(page, `/post/${postIdOf(3)}`);
      await until(page, `(() => { const at = ${FOCUSED_ROW}; return !!at && Math.abs(at.top) <= 2 && at.scroll > 0; })()`, "the post on top, its chain above");
      expect(await page.locator('[data-thread] [role="article"]').count()).toBe(4);
      expect(await page.title()).toBe(TITLE_WORDS["title.post"]);
      await screenshot(page, "thread-1280-light");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  // UI Task 6: the composer (UI design, sections 6.15, 7.2, 7.3, 8.2, 8.3, 8.6 and 10).

  /** Every drafts key in the page's storage. */
  const DRAFTS = `Object.keys(localStorage).filter((key) => key.startsWith("korbat.drafts."))`;
  /** The reader's kept drafts, by context. */
  const draftsOf = (page: Page) => page.evaluate(`JSON.parse(localStorage.getItem("korbat.drafts.${ADA.id}") || "{}")`) as Promise<Record<string, string>>;
  /** The open dialog's field. */
  const sheetField = (page: Page) => page.locator('[role="dialog"] textarea');
  /** Whether two boxes overlap. */
  const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  /** The words of the first post of the feed on screen. */
  const FIRST_POST = `(() => { const article = document.querySelector('[role="feed"] [role="article"]'); return article ? article.innerText : ""; })()`;
  /** Home's card's height: the box that grows, around [data-composer-card]. */
  const CARD_HEIGHT = `(() => { const card = document.querySelector("[data-composer-card]"); return card ? card.parentElement.getBoundingClientRect().height : null; })()`;
  /** Whether Home's card is open or closed. */
  const cardIs = (state: "open" | "closed") => `(() => { const card = document.querySelector("[data-composer-card]"); return !!card && card.getAttribute("data-composer-card") === "${state}"; })()`;
  /** What holds the focus is the field named `name`. */
  const fieldFocused = (name: string) => `(${FOCUSED}) === ${JSON.stringify(name)} && document.activeElement.tagName === "TEXTAREA"`;
  /** The card's height on every frame for `ms`, from now. */
  const sampleHeights = (page: Page, ms: number) =>
    page.evaluate(
      `new Promise((resolve) => { const out = []; const start = performance.now(); const tick = () => { out.push(${CARD_HEIGHT}); if (performance.now() - start < ${ms}) requestAnimationFrame(tick); else resolve(out); }; tick(); })`,
    ) as Promise<(number | null)[]>;
  /** The nav's New post, from 768 px. */
  const navNewPost = (page: Page) => page.locator('nav[aria-label="Main"]').getByRole("button", { name: UI_WORDS["composer.newPost"], exact: true });

  /** Opens the New post sheet: the compose button on a phone's Home, the nav's New post on Bookmarks wider up. */
  async function openSheet(page: Page, width: number): Promise<void> {
    if (width < 768) {
      await visit(page, "/");
      await page.locator("[data-compose]").click();
    } else {
      await visit(page, "/bookmarks");
      await navNewPost(page).click();
    }
    await page.locator('[role="dialog"]').waitFor({ state: "visible" });
    await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
  }

  test("28. at 360 the compose button opens the sheet New post with its field focused; the ring and its number; Post closes it at once, its toast and View keep clear of the button, the post is on top, the focus is back on the button and View opens the post; the button shows on a profile and Bookmarks, not on a post", async () => {
    for (const theme of ["light", "dark"] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme } });
      const page = visit_.page;
      try {
        await visit(page, "/");
        const button = page.locator("[data-compose]");
        expect(await button.count()).toBe(1);
        await button.click();
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        expect(await page.evaluate(DIALOG_NAME)).toBe(UI_WORDS["composer.title.post"]);
        await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
        // Near the end the ring turns review-ink and says what is left.
        await sheetField(page).fill("Morning light over the harbour. ".repeat(30).slice(0, 950));
        await dialog.getByText("50", { exact: true }).waitFor({ state: "visible" });
        expect(await page.evaluate(`getComputedStyle(document.querySelector('[role="dialog"] svg[data-ring]')).color`)).toBe(rgb(THEMES[theme]["review-ink"]));
        await pause(400);
        await screenshot(page, `composer-360-${theme}`);
        expect(await contrast(page, '[role="dialog"]')).toEqual([]);
        expect(await phoneProblems(page, '[role="dialog"]')).toEqual([]);
        expect(await clippedLabels(page, '[role="dialog"]')).toEqual([]);
        // Post: the sheet closes at once and the toast offers View, above the compose button, never over it.
        const words = `A post from the walk in ${theme}.`;
        await sheetField(page).fill(words);
        await dialog.getByRole("button", { name: UI_WORDS["composer.action.post"], exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.sent.post"]).waitFor({ state: "visible" });
        await pause(600);
        const view = page.locator("[data-sonner-toaster]").getByRole("button", { name: UI_WORDS["toast.view"], exact: true });
        const compose = (await button.boundingBox())!;
        expect(intersects((await page.locator("[data-sonner-toast]").first().boundingBox())!, compose)).toBe(false);
        expect(intersects((await view.boundingBox())!, compose)).toBe(false);
        await screenshot(page, `toast-360-${theme}`);
        expect(await contrast(page, "[data-sonner-toaster]")).toEqual([]);
        await until(page, `${FIRST_POST}.includes(${JSON.stringify(words)})`, "the post on top of Home");
        await until(page, `(${FOCUSED}) === ${JSON.stringify(UI_WORDS["composer.newPost"])}`, "the focus back on the compose button", 5000);
        await view.click();
        await until(page, `location.pathname === "/post/${writtenIdOf(1)}"`, "View opens the post");
        await page.locator('[data-row="focused"] [role="article"]').getByText(words).waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        // A profile and Bookmarks show the button; a post does not.
        for (const [route, count] of [
          ["/u/grace", 1],
          ["/bookmarks", 1],
          [`/post/${POST_ID}`, 0],
        ] as const) {
          await visit(page, route);
          expect(await page.locator("[data-compose]").count(), route).toBe(count);
        }
        await clean(visit_);
      } finally {
        fixtures.state.written.length = 0;
        await visit_.context.close();
      }
    }
  });

  test("29. an empty sheet closes at once on Escape; with words Escape asks Discard this draft?, Keep writing keeps the words and the focus, Discard closes, and the focus is back on the opener; the draft is kept 500 ms after typing, survives a reload and goes when sent; signing out clears every draft", async () => {
    const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      const dialog = page.locator('[role="dialog"]');
      const question = page.locator('[role="alertdialog"]');
      const opener = page.locator("[data-compose]");
      const backOnOpener = `(${FOCUSED}) === ${JSON.stringify(UI_WORDS["composer.newPost"])}`;
      await openSheet(page, 360);
      // Empty: Escape closes it at once, with no question.
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      expect(await question.count()).toBe(0);
      await until(page, backOnOpener, "the focus back on the opener", 5000);
      // With words: kept on the device 500 ms after typing stops; Escape asks, Keep writing keeps them and the focus.
      await opener.click();
      await dialog.waitFor({ state: "visible" });
      await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
      await page.keyboard.type("Words worth keeping");
      await pause(700);
      expect((await draftsOf(page)).post).toBe("Words worth keeping");
      await page.keyboard.press("Escape");
      await question.waitFor({ state: "visible" });
      expect(await question.innerText()).toContain(UI_WORDS["composer.discard.question"]);
      await until(page, `(${FOCUSED}) === ${JSON.stringify(UI_WORDS["composer.discard.keep"])}`, "Keep writing focused", 3000);
      await question.getByRole("button", { name: UI_WORDS["composer.discard.keep"], exact: true }).click();
      await question.waitFor({ state: "detached" });
      expect(await sheetField(page).inputValue()).toBe("Words worth keeping");
      await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the focus back in the field", 3000);
      // Discard closes it, the focus goes back to the opener, and the draft is gone.
      await page.keyboard.press("Escape");
      await question.waitFor({ state: "visible" });
      await question.getByRole("button", { name: UI_WORDS["composer.discard.confirm"], exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await until(page, backOnOpener, "the focus back on the opener after Discard", 5000);
      expect(await page.evaluate(DRAFTS)).toEqual([]);
      // A draft survives a reload, and is gone once sent.
      await opener.click();
      await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
      await page.keyboard.type("Kept across a reload");
      await pause(700);
      await openSheet(page, 360);
      expect(await sheetField(page).inputValue()).toBe("Kept across a reload");
      await dialog.getByRole("button", { name: UI_WORDS["composer.action.post"], exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      expect(await page.evaluate(DRAFTS)).toEqual([]);
      // Signing out clears every draft on the device, another account's too.
      await opener.click();
      await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
      await page.keyboard.type("Left on this device");
      await pause(700);
      await page.evaluate(`localStorage.setItem("korbat.drafts.00000000-0000-4000-8000-0000000000aa", JSON.stringify({ post: "Another account's words" }))`);
      expect(await page.evaluate(DRAFTS)).toHaveLength(2);
      await visit(page, "/settings/security");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await until(page, `location.pathname === "/" && !document.querySelector('nav[aria-label="Main"] a[href="/bookmarks"]')`, "signed out, on Home");
      expect(await page.evaluate(DRAFTS)).toEqual([]);
      await clean(visit_);
    } finally {
      fixtures.state.written.length = 0;
      await visit_.context.close();
    }
    // The question as drawn: in a phone's sheet and in the 640 px dialog, in both themes.
    for (const width of [360, 1280]) {
      for (const theme of ["light", "dark"] as const) {
        const shot = await open({ width, height: width < 768 ? 740 : 900, appearance: { theme } });
        try {
          await openSheet(shot.page, width);
          await shot.page.keyboard.type("A draft to think twice about");
          await shot.page.keyboard.press("Escape");
          const asked = shot.page.locator('[role="alertdialog"]');
          await asked.waitFor({ state: "visible" });
          await pause(400);
          await screenshot(shot.page, `discard-${width}-${theme}`);
          expect(await contrast(shot.page, '[role="dialog"]')).toEqual([]);
          if (width < 768) expect(await phoneProblems(shot.page, '[role="dialog"]')).toEqual([]);
          await asked.getByRole("button", { name: UI_WORDS["composer.discard.confirm"], exact: true }).click();
          await shot.page.locator('[role="dialog"]').waitFor({ state: "detached" });
          await clean(shot);
        } finally {
          await shot.context.close();
        }
      }
    }
  });

  test("30. at 1280 Home's card opens in place on a click and grows, at once under reduced motion, and closes back empty when the focus leaves it; the nav's New post focuses it on Home and opens a 640 px dialog on Bookmarks, whose post is then on top of Home", async () => {
    for (const [name, options] of [
      ["moves", {}],
      ["system-reduced", { reducedMotion: "reduce" as const }],
    ] as const) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      const page = visit_.page;
      try {
        await visit(page, "/");
        const collapsed = page.getByRole("button", { name: UI_WORDS["composer.collapsed"], exact: true });
        await collapsed.waitFor({ state: "visible" });
        const before = (await page.evaluate(CARD_HEIGHT)) as number;
        const frames = sampleHeights(page, 700);
        await collapsed.click();
        const heights = (await frames).filter((height): height is number => height !== null);
        await until(page, cardIs("open"), "the card open");
        await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the card's field focused", 3000);
        await pause(300);
        const after = (await page.evaluate(CARD_HEIGHT)) as number;
        expect(after, name).toBeGreaterThan(before + 40);
        // Moving, some frames fall between the two heights; reduced, none does.
        const between = heights.filter((height) => height > before + 2 && height < after - 2);
        if (name === "moves") expect(between.length, heights.join(" ")).toBeGreaterThan(0);
        else expect(between, heights.join(" ")).toEqual([]);
        // Left empty, it closes back to its one line.
        await page.locator('aside[aria-label="About korbat"]').getByText(UI_WORDS["shell.howTitle"], { exact: true }).click();
        await until(page, cardIs("closed"), "the card closed back", 3000);
        await pause(400);
        expect(Math.abs(((await page.evaluate(CARD_HEIGHT)) as number) - before), name).toBeLessThanOrEqual(1);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
    for (const theme of ["light", "dark"] as const) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme } });
      const page = visit_.page;
      try {
        await visit(page, "/");
        // On Home the nav's New post opens and focuses the card, and opens no dialog.
        await navNewPost(page).click();
        await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the card's field focused", 3000);
        expect(await page.locator('[role="dialog"]').count()).toBe(0);
        await page.keyboard.type(`Written in the card in ${theme}.`);
        await pause(400);
        await screenshot(page, `card-open-1280-${theme}`);
        expect(await contrast(page, "[data-composer-card]")).toEqual([]);
        await page.locator("[data-composer-card]").getByRole("button", { name: UI_WORDS["composer.action.post"], exact: true }).click();
        await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.sent.post"]).waitFor({ state: "visible" });
        await until(page, `${FIRST_POST}.includes(${JSON.stringify(`Written in the card in ${theme}.`)})`, "the card's post on top");
        // On Bookmarks the nav's New post opens the 640 px dialog.
        await visit(page, "/bookmarks");
        await navNewPost(page).click();
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        expect(await page.evaluate(DIALOG_NAME)).toBe(UI_WORDS["composer.title.post"]);
        // Its layout width, which the dialog's opening scale (0.96 to 1) does not change.
        expect(await page.evaluate(`[...document.querySelectorAll('[role="dialog"] *')].some((element) => element.offsetWidth === 640)`)).toBe(true);
        await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the dialog's field focused", 5000);
        const words = `Sent from Bookmarks in ${theme}.`;
        await sheetField(page).fill(words);
        await pause(400);
        await screenshot(page, `bookmarks-dialog-1280-${theme}`);
        expect(await contrast(page, '[role="dialog"]')).toEqual([]);
        await dialog.getByRole("button", { name: UI_WORDS["composer.action.post"], exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await until(page, `(${FOCUSED}) === ${JSON.stringify(UI_WORDS["composer.newPost"])}`, "the focus back on New post", 5000);
        await visit(page, "/");
        await until(page, `${FIRST_POST}.includes(${JSON.stringify(words)})`, "that post on top of Home");
        await clean(visit_);
      } finally {
        fixtures.state.written.length = 0;
        await visit_.context.close();
      }
    }
  });

  test("31. Reply on a feed card opens the thread with Your reply focused, and a reply is sent with its toast and read again; Repost's Quote opens a sheet whose preview holds no link, and a quote is sent with its toast while the page stays", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      await postArticle(page, 1).getByRole("button", { name: /^Reply/ }).click();
      await until(page, `location.pathname === "/post/${POST_ID}" && new URL(location.href).searchParams.get("reply") === "1"`, "the thread, its reply card asked for");
      await until(page, fieldFocused(UI_WORDS["composer.field.reply"]), "Your reply focused", 5000);
      const read = asked(`/api/posts/${POST_ID}/thread`);
      await page.keyboard.type("A reply from the walk.");
      await page.locator("[data-composer-card]").getByRole("button", { name: UI_WORDS["composer.action.reply"], exact: true }).click();
      await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.sent.reply"]).waitFor({ state: "visible" });
      await waitFor(() => asked(`/api/posts/${POST_ID}/thread`) > read, "the replies read again");
      await page.locator('[role="article"]').filter({ hasText: "A reply from the walk." }).waitFor({ state: "visible" });
      // The card stays open and empty, with the focus in its field.
      await until(page, fieldFocused(UI_WORDS["composer.field.reply"]), "the focus back in the reply card", 3000);
      // Repost's Quote: the quote sheet over the thread, its preview of the post linking nowhere.
      await visit(page, "/?tab=latest");
      await postArticle(page, 1).getByRole("button", { name: /^Repost/ }).click();
      await page.locator("[data-menu]").getByRole("link", { name: UI_WORDS["post.quote"], exact: true }).click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      expect(await page.evaluate(DIALOG_NAME)).toBe(UI_WORDS["composer.title.quote"]);
      await until(page, fieldFocused(UI_WORDS["composer.field.quote"]), "the quote's field focused", 5000);
      expect(await dialog.locator("a").count()).toBe(0);
      expect(await dialog.innerText()).toContain(GRACE.displayName);
      await page.keyboard.type("Worth reading.");
      await pause(400);
      await screenshot(page, "quote-1280-light");
      await dialog.getByRole("button", { name: UI_WORDS["composer.action.quote"], exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.sent.quote"]).waitFor({ state: "visible" });
      // The page stays: the toast's View is the way to the quote.
      expect(new URL(page.url()).pathname).toBe(`/post/${POST_ID}`);
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      fixtures.state.written.length = 0;
      await visit_.context.close();
    }
    // The reply card as drawn, opened by ?reply=1: on a phone and at 1280, in both themes.
    for (const width of [360, 1280]) {
      for (const theme of ["light", "dark"] as const) {
        const shot = await open({ width, height: width < 768 ? 740 : 900, appearance: { theme } });
        try {
          await visit(shot.page, `/post/${POST_ID}?reply=1`);
          await until(shot.page, fieldFocused(UI_WORDS["composer.field.reply"]), "Your reply focused", 5000);
          await shot.page.keyboard.type("A reply in progress.");
          await pause(400);
          await screenshot(shot.page, `reply-card-${width}-${theme}`);
          expect(await contrast(shot.page, "[data-composer-card]")).toEqual([]);
          if (width < 768) expect(await phoneProblems(shot.page, "[data-composer-card]")).toEqual([]);
          expect(await clippedLabels(shot.page, "[data-composer-card]")).toEqual([]);
          await clean(shot);
        } finally {
          await shot.context.close();
        }
      }
    }
  });

  // UI Task 7: the moderation surfaces and the public pages (UI design, sections 8.7 and 8.9; decision 10).

  test("32. the status sheet: the chip is a button that opens a dialog, named by its words; skeletons while the decision is read, then the blocks in the design's order; Decided by in role terms; Read the full decision opens the case; Escape gives the focus back to the chip; a refused read's Try again reads it again", async () => {
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        const page = visit_.page;
        try {
          await visit(page, "/u/ada");
          const chip = statusChip(page);
          // The chip: a button that opens a dialog, named by its own words, with a 44 px target.
          const tag = (await page.evaluate(`(() => { const e = [...document.querySelectorAll('[aria-haspopup="dialog"]')].find((x) => x.textContent.trim() === ${JSON.stringify(REMOVED_CHIP)}); return e ? { role: e.getAttribute("role"), popup: e.getAttribute("aria-haspopup"), name: e.textContent.trim(), height: e.offsetHeight } : null; })()`)) as {
            role: string | null;
            popup: string | null;
            name: string;
            height: number;
          };
          expect(tag).toEqual({ role: "button", popup: "dialog", name: REMOVED_CHIP, height: expect.any(Number) });
          expect(tag.height).toBeGreaterThanOrEqual(44);
          // While the decision is on its way: the dialog named by the chip's words, skeletons and one status, no block yet.
          fixtures.state.delayMs = 1500;
          const asked = fixtures.state.requests.length;
          await chip.click();
          const dialog = page.locator('[role="dialog"]');
          await dialog.waitFor({ state: "visible" });
          expect(await page.evaluate(DIALOG_NAME)).toBe(REMOVED_CHIP);
          await dialog.locator('[role="status"]').waitFor({ state: "attached" });
          expect(await page.evaluate(`${STATUS_BLOCKS}.length`)).toBe(0);
          await pause(300);
          await screenshot(page, `status-sheet-loading-${width}-${theme}`);
          // Each opening reads the decision.
          expect(fixtures.state.requests.slice(asked).map((request) => request.path)).toContain(`/api/moderation/decisions/${POST_DECISION_ID}`);
          await until(page, `${STATUS_BLOCKS}.length === ${OPEN_ORDER.length}`, "the blocks", 10_000);
          fixtures.state.delayMs = 0;
          expect(await page.evaluate(STATUS_BLOCKS)).toEqual(OPEN_ORDER);
          const decided = dialog.locator('[data-status-block="decidedBy"]');
          expect(await decided.innerText()).toContain(STATUS_SHEET_WORDS["status.byPerson"]);
          expect(await dialog.locator('[data-status-block="appliesTo"]').innerText()).toContain(STATUS_SHEET_WORDS["status.appliesPost"]);
          expect(await dialog.locator('[data-status-block="whoSees"]').innerText()).toContain(UI_WORDS["reach.private"]);
          await pause(300);
          await screenshot(page, `status-sheet-open-${width}-${theme}`);
          expect(await contrast(page, '[role="dialog"]')).toEqual([]);
          if (width < 768) expect(await phoneProblems(page, '[role="dialog"]')).toEqual([]);
          expect(await clippedLabels(page, '[role="dialog"]')).toEqual([]);
          // Escape closes it, and the focus is back on the chip.
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "detached" });
          await until(page, `(${FOCUSED}) === ${JSON.stringify(REMOVED_CHIP)}`, "the focus back on the chip", 3000);
          // A refused read says so, with Try again, which reads the decision again.
          fixtures.state.refuse.add("decision");
          await chip.click();
          await dialog.getByRole("alert").waitFor({ state: "visible" });
          await pause(300);
          await screenshot(page, `status-sheet-failed-${width}-${theme}`);
          fixtures.state.refuse.delete("decision");
          const again = fixtures.state.requests.length;
          await dialog.getByRole("button", { name: UI_WORDS["error.retry"], exact: true }).click();
          await until(page, `${STATUS_BLOCKS}.length === ${OPEN_ORDER.length}`, "the blocks after Try again");
          expect(fixtures.state.requests.slice(again).map((request) => request.path)).toContain(`/api/moderation/decisions/${POST_DECISION_ID}`);
          // Read the full decision: the sheet closes, then the case opens under Settings, Cases.
          await dialog.getByRole("link", { name: STATUS_SHEET_WORDS["status.readAll"], exact: true }).click();
          await until(page, `location.pathname === "/settings/cases/${POST_DECISION_ID}"`, "the decision's screen");
          await page.locator("h1").filter({ hasText: CASES_WORDS.title }).waitFor({ state: "visible" });
          await page.getByText(DECISION_WORDS.title, { exact: true }).waitFor({ state: "visible" });
          expect(await page.locator('[role="dialog"]').count()).toBe(0);
          await page.waitForLoadState("networkidle");
          if (theme === "light") await screenshot(page, `decision-${width}-${theme}`);
          await cleanAfterRefusals(visit_);
        } finally {
          fixtures.state.delayMs = 0;
          fixtures.state.refuse.clear();
          await visit_.context.close();
        }
      }
    }
  });

  test("33. the sheet's Appeal opens the decision with ?appeal=1 and the appeal's field focused; Cases' tabs are one tab stop, and Right selects Your reports", async () => {
    for (const [width, height, theme] of [
      [1280, 900, "light"],
      [360, 740, "dark"],
    ] as const) {
      const visit_ = await open({ width, height, appearance: { theme } });
      const page = visit_.page;
      try {
        await visit(page, "/u/ada");
        await openStatusSheet(page);
        const appeal = page.locator('[role="dialog"] [data-status-appeal]');
        expect(await appeal.innerText()).toBe(STATUS_SHEET_WORDS["status.appeal"]);
        // Its layout height: the dialog's opening scale would shrink the drawn box for a moment.
        expect(await page.evaluate(`document.querySelector('[role="dialog"] [data-status-appeal]').offsetHeight`)).toBeGreaterThanOrEqual(44);
        await appeal.click();
        await until(page, `location.pathname === "/settings/cases/${POST_DECISION_ID}" && new URL(location.href).searchParams.get("appeal") === "1"`, "the decision, its appeal asked for");
        await until(page, fieldFocused(DECISION_WORDS.appealStatement), "the appeal's field focused", 8000);
        await pause(300);
        await screenshot(page, `decision-appeal-${width}-${theme}`);
        await clean(visit_);
        // Cases: two tabs, one tab stop (the selected tab); the arrows choose.
        await visit(page, "/settings/cases");
        const tabs = page.locator('[role="tablist"] [role="tab"]');
        expect(await tabs.count()).toBe(2);
        expect(await page.evaluate(`[...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((tab) => tab.getAttribute("tabindex"))`)).toEqual(["0", "-1"]);
        await tabs.first().focus();
        await page.keyboard.press("ArrowRight");
        await until(page, `document.activeElement && document.activeElement.getAttribute("role") === "tab" && document.activeElement.getAttribute("aria-selected") === "true" && document.activeElement.textContent.trim() === ${JSON.stringify(CASES_WORDS.tabs.reports)}`, "Your reports chosen and focused", 3000);
        await page.getByText(CASES_WORDS.noReports).waitFor({ state: "visible" });
        expect(await page.evaluate(`[...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((tab) => tab.getAttribute("tabindex"))`)).toEqual(["-1", "0"]);
        // The panel is named by the chosen tab.
        expect(await page.evaluate(`(() => { const panel = document.querySelector('[role="tabpanel"]'); const tab = panel && document.getElementById(panel.getAttribute("aria-labelledby")); return tab ? tab.textContent.trim() : null; })()`)).toBe(CASES_WORDS.tabs.reports);
        await page.waitForLoadState("networkidle");
        await screenshot(page, `cases-reports-${width}-${theme}`);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("34. under a grid that holds a hidden image, Why are images hidden? is a 44 px link to the rules and the placeholder no control; the terms stand in PublicFrame's 640 px column with its banner and footer", async () => {
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        const page = visit_.page;
        try {
          await visit(page, "/u/grace");
          const card = page.locator('[role="article"]').filter({ has: page.locator(`a[href="/post/${HIDDEN_IMAGE_POST_ID}"]`) });
          const link = card.getByRole("link", { name: UI_WORDS["media.whyHidden"], exact: true });
          expect(await link.getAttribute("href")).toBe("/rules");
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          // The placeholder is no control: nothing around its words takes a press or the focus.
          const placeholder = (await page.evaluate(
            `(() => { const words = [...document.querySelectorAll('[role="article"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(HIDDEN_IMAGE_WORDS)}); return words ? { control: !!words.closest('a, button, [role="button"], [role="link"], [tabindex="0"]') } : null; })()`,
          )) as { control: boolean } | null;
          expect(placeholder).toEqual({ control: false });
          await card.scrollIntoViewIfNeeded();
          await pause(300);
          await screenshot(page, `hidden-image-${width}-${theme}`);
          if (width < 768) expect(await phoneProblems(page, '[role="article"]')).toEqual([]);
          await link.click();
          await until(page, `location.pathname === "/rules"`, "the rules page");
          await page.locator("h1").filter({ hasText: RULES_PAGE.title }).waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");
          await clean(visit_);
          // The terms in the frame: the wordmark's banner, the page's column of 640 px at most, and the footer's links.
          await visit(page, "/terms");
          const frame = (await page.evaluate(
            `(() => { const main = document.querySelector('[role="main"]'); return { banner: !!document.querySelector('[role="banner"]'), footer: !!document.querySelector('[role="contentinfo"]'), shell: !!document.querySelector("[data-layout]"), column: main ? main.offsetWidth : 0, footerAfter: !!main && !!document.querySelector('[role="contentinfo"]') && (main.compareDocumentPosition(document.querySelector('[role="contentinfo"]')) & 4) === 4 }; })()`,
          )) as { banner: boolean; footer: boolean; shell: boolean; column: number; footerAfter: boolean };
          expect(frame).toEqual({ banner: true, footer: true, shell: false, column: width >= 768 ? 640 : width - 32, footerAfter: true });
          await screenshot(page, `terms-${width}-${theme}`);
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }
  });
});
```

### Replace `apps/app/test/browser/fixture-api.ts` (whole file)

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthorCasesPage,
  AuthorNoticesPage,
  DecisionView,
  EngagementResponse,
  ExplorePage,
  ExploreStatus,
  FollowResponse,
  MeResponse,
  NoticeStatus,
  PasskeyListResponse,
  PasskeyOptionsResponse,
  PostPage,
  PostView,
  ProfilePage,
  ProfileView,
  PublicFacts,
  PublicHead,
  PublicTransparency,
  ReleaseNoticeView,
  ReportsPage,
  SessionsResponse,
  ThreadResponse,
  TimelinePage,
  UploadRefusalView,
  type Author,
  type MediaView,
  type ProfileListItem,
  type TimelineItem,
} from "@korbat/contracts";
import type { z } from "zod";

/**
 * The API answers the app's browser check needs (UI design, section 12.3): /api/me signed in and out (a 401), the three
 * timelines with cursors, a post with its thread and its status for the post page's handle, profiles with their tabs and
 * lists, bookmarks, the public facts, the settings and cases screens' reads, a report's status, and one 2 by 2 WebP for
 * every image. Every answer is checked against @korbat/contracts' schema when it is built, so the app parses exactly
 * what the API would send. A request no fixture answers is a problem of the walk, answered 404. The reader's actions on a
 * post (like, repost, save, delete) and a follow are answered from UI Task 4 on, with switches that refuse a kind or
 * hold every action's answer back; nothing else that changes something is. From UI Task 5 the timelines honour `limit`
 * and page through 120 posts (enough for the reading place's 100 rows), a switch puts new posts above them, a thread has
 * ancestors, and sign-out is answered. From UI Task 6 a post the reader writes (POST /api/posts) is answered as the API
 * answers it, goes on top of the timelines, has a thread and a page of its own, and a reply joins its thread's replies.
 * From UI Task 7 Ada's profile starts with a post of hers that korbat removed, whose decision has a screen of its own,
 * and Grace's with a post that holds an image hidden from readers; `delayMs` holds a decision's answer back too, and the
 * kind "decision" in `refuse` refuses it. Nothing here needs a database or the network.
 */

/** A WebP of 2 by 2 pixels (lossless, 38 bytes) in the accent violet: a real image, which the browser decodes under the policy. */
export const FIXTURE_WEBP = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQmWrVuv+BiOh/AAA=", "base64");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ADA: Author = { id: id(1), handle: "ada", displayName: "Ada Lovelace", verified: false };
export const GRACE: Author = { id: id(2), handle: "grace", displayName: "Grace Hopper", verified: true };
export const LINUS: Author = { id: id(3), handle: "linus", displayName: "Linus", verified: false };

/** Post number n's id, for a step that acts on one post of the timelines: Grace writes 1, 4, 7..., Linus 2, 5, 8..., Ada 3, 6, 9.... */
export const postIdOf = (n: number): string => id(100 + n);

/** The post the walk opens (by Grace), and a post id the API does not know, whose page answers 404. */
export const POST_ID = id(101);
export const MISSING_POST_ID = id(999);
/** A decision, a release and a refused upload of Ada's, for the cases screens. */
export const DECISION_ID = id(501);
export const RELEASE_ID = id(502);
export const UPLOAD_ID = id(503);
/**
 * UI Task 7: a post of Ada's that korbat removed under R6 (on top of her own profile, signed in as her), the decision
 * about it, which its chip's details sheet reads, and a post of Grace's whose second image is hidden from readers (on
 * top of her profile). Their ids are their own, so posts 1 to 120 keep theirs.
 */
export const REMOVED_POST_ID = id(401);
export const POST_DECISION_ID = id(504);
export const HIDDEN_IMAGE_POST_ID = id(402);
/** The removed post's chip, as chipText() words a final decision under R6 without a strike. */
export const REMOVED_CHIP = "Removed: R6";

/** A report's status page: its reference and the token its link carries in the fragment. */
export const NOTICE_REF = "N-ABCDEFGH23";
export const NOTICE_TOKEN = "A".repeat(43);

/** The fixtures' own clock: every time is this many minutes before the walk started, so "3m" stays "3m". */
const START = Date.now();
const ago = (minutes: number) => new Date(START - minutes * 60_000).toISOString();
const daysAhead = (days: number) => new Date(START + days * 86_400_000).toISOString();

const BODIES = [
  "Morning light over the harbour. The ferries are running late again, and nobody seems to mind.",
  "Finished the first draft of the essay on Babbage's engines. It is long, and it needs a walk before it needs an edit.",
  "Reminder that the library's reading room opens at nine on Saturdays now.",
  "Small thing that made my day: the baker remembered my order.",
  "Notes from the meetup: three talks on compilers, one on gardening, all of them about patience.",
  "If you are near the old market today, the second-hand book stall has a box of maps from the sixties.",
  "Tried the new route home along the canal. Two herons, one very confident duck.",
  "Rain all afternoon, so I sorted the photo archive by year instead of by mood.",
];

/** One image, sized as 2b serves it: a 4 by 3 frame whose two sizes are the fixture WebP. */
function image(n: number): MediaView {
  const media = id(700 + n);
  return { id: media, width: 1200, height: 900, blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj", alt: `A photograph, number ${n}, of the harbour at dawn`, small: `/api/media/${media}/small.webp`, large: `/api/media/${media}/large.webp` };
}

const AUTHORS = [GRACE, LINUS, ADA];

/** Post number `n`: its author goes round the three accounts; every fourth carries an image, and post 8 two of them (the lightbox's steps page between them); newer posts have lower numbers. */
function post(n: number, signedIn: boolean, extra: Partial<PostView> = {}): PostView {
  const view: PostView = {
    id: id(100 + n),
    author: AUTHORS[(n - 1) % AUTHORS.length]!,
    body: BODIES[(n - 1) % BODIES.length]!,
    createdAt: ago(n * 7),
    state: "visible",
    replyTo: null,
    counts: { likes: (n * 3) % 17, reposts: n % 4, replies: n % 3, quotes: n % 2 },
    media: n === 8 ? [image(8), image(80)] : n % 4 === 0 ? [image(n)] : [],
    quoteOf: null,
    ...extra,
  };
  if (signedIn) view.viewer = { liked: n % 5 === 0, reposted: false, bookmarked: false };
  return view;
}

function parse<S extends z.ZodType>(schema: S, value: z.input<S>, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`the fixture ${what} does not match its schema: ${result.error.message}`);
  return result.data;
}

/** How many posts the timelines hold: more than the reading place's window of 100 rows (UI design, section 8.2). */
export const TIMELINE_POSTS = 120;

/** New post `j` of the new-posts switch (1 is the oldest of them): newer than every other post, with ids of their own. */
export const newPostIdOf = (j: number): string => id(900 + j);

function freshPost(j: number, count: number, signedIn: boolean): PostView {
  // Each a second apart and newer than post 1, so the newest of them comes first.
  return post(j, signedIn, { id: newPostIdOf(j), body: `A new post, number ${j}, written while the reader was reading.`, createdAt: new Date(Date.now() - (count - j + 1) * 1000).toISOString(), media: [] });
}

/**
 * A timeline from its start: the new posts the switch holds, newest first, then posts 1 to TIMELINE_POSTS, with a repost
 * of Grace's by Linus before post 3 and every twentieth post after it, as a page of twenty had one at its third row.
 */
function timelineItems(signedIn: boolean, fresh: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (let j = fresh; j >= 1; j--) items.push({ kind: "post", post: freshPost(j, fresh, signedIn) });
  for (let n = 1; n <= TIMELINE_POSTS; n++) {
    if (n % 20 === 3) items.push({ kind: "repost", post: post(n + 40, signedIn, { author: GRACE }), repostedBy: LINUS, repostedAt: ago(n * 7 - 1) });
    items.push({ kind: "post", post: post(n, signedIn) });
  }
  return items;
}

/** A page of a timeline: `limit` items (20 by default, at most 50, as Pagination has it) from the cursor's place. */
function timeline(cursor: string | null, limit: string | null, signedIn: boolean, fresh: number, written: TimelineItem[] = []) {
  const items = [...written, ...timelineItems(signedIn, fresh)];
  const from = cursor === null ? 0 : Number.parseInt(cursor.replace(/^at-/, ""), 10);
  const size = Math.min(50, Math.max(1, Number.parseInt(limit ?? "20", 10) || 20));
  const to = Math.min(items.length, from + size);
  return parse(TimelinePage, { items: items.slice(from, to), nextCursor: to < items.length ? `at-${to}` : null }, "timeline");
}

const listItem = (author: Author, bio: string, signedIn: boolean): ProfileListItem => ({ ...author, bio, ...(signedIn ? { viewerFollows: author.handle === "grace" } : {}) });

function profile(author: Author, signedIn: boolean) {
  const self = signedIn && author.id === ADA.id;
  return parse(
    ProfileView,
    {
      id: author.id,
      handle: author.handle,
      displayName: author.displayName,
      bio: author.handle === "ada" ? "Writing about engines, looms and the people who built them." : "Compilers, ships and the occasional heron.",
      verified: author.verified,
      createdAt: ago(60 * 24 * 90),
      counts: { posts: 42, followers: 128, following: 64 },
      // The reader follows nobody yet, so the follow step starts from Follow.
      ...(signedIn && !self ? { viewer: { following: false, followedBy: false, blocked: false, muted: false } } : {}),
    },
    "profile",
  );
}

function me() {
  return parse(
    MeResponse,
    {
      user: { id: ADA.id, email: "ada@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 1 },
      profile: { id: ADA.id, handle: ADA.handle, displayName: ADA.displayName, handleChangedAt: null, verified: false, showInExplore: true },
      standing: { activeStrikes: 0, measure: null, reporting: null, handleRetired: false },
    },
    "me",
  );
}

const FACTS = parse(
  PublicFacts,
  {
    r1: { state: "off", test: false, model: null, digest: null, threshold: null, thresholdVersion: null, publisherClaim: null, dpia: null, dpiaActs: null },
    match: { state: "off", test: false, source: null, dpia: null, dpiaActs: null },
    edge: { on: false, test: false },
    witness: { on: false, test: false },
    recipientsSignedOut: false,
    keeper: false,
  },
  "facts",
);

function decision() {
  return parse(
    DecisionView,
    {
      id: DECISION_ID,
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R3",
      rulesVersion: 3,
      redressVersion: 2,
      legalReference: null,
      facts: "The post offered followers for sale.",
      reason: "Selling followers breaks rule R3.",
      source: "own_initiative",
      decidedAt: ago(60 * 24 * 3),
      post: null,
      measures: [],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
      appealUntil: daysAhead(10),
      reversedOn: null,
      content: { kind: "account", handle: "ada", displayName: "Ada Lovelace", bio: "" },
      appeal: null,
      strike: null,
      standing: null,
    } as z.input<typeof DecisionView>,
    "decision",
  );
}

/** The decision about Ada's removed post (UI Task 7): final, under R6, after a report, which she can still appeal. */
function postDecision() {
  return parse(
    DecisionView,
    {
      id: POST_DECISION_ID,
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R6",
      rulesVersion: 3,
      redressVersion: 2,
      legalReference: null,
      facts: "The post offered followers for sale.",
      reason: "Selling followers is spam under rule R6: it fakes the reach that korbat's feeds show in time order.",
      source: "report",
      decidedAt: ago(60 * 24 * 2),
      post: { id: REMOVED_POST_ID, createdAt: ago(60 * 24 * 3) },
      measures: [{ kind: "remove", mediaId: null, noEffect: null, sealed: null }],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
      appealUntil: daysAhead(170),
      reversedOn: null,
      content: { kind: "post", body: REMOVED_BODY, deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
      appeal: null,
      strike: null,
      standing: null,
    } as z.input<typeof DecisionView>,
    "post decision",
  );
}

const REMOVED_BODY = "Buy a thousand followers for five euros, delivered by tonight.";

/** Ada's removed post as she reads it on her own profile: removed, with the chip's facts of its decision. */
function removedPost(signedIn: boolean): PostView {
  return post(41, signedIn, {
    id: REMOVED_POST_ID,
    author: ADA,
    body: REMOVED_BODY,
    createdAt: ago(60 * 24 * 3),
    state: "removed",
    media: [],
    moderation: { decisionId: POST_DECISION_ID, ruleId: "R6", legal: false, interim: false, strikeUntil: null },
  });
}

/** Grace's post with two images, the second hidden from every reader by moderation (decision 10). */
function hiddenImagePost(signedIn: boolean): PostView {
  return post(42, signedIn, {
    id: HIDDEN_IMAGE_POST_ID,
    author: GRACE,
    body: "Two photographs from the harbour walk; one of them is not shown to you.",
    createdAt: ago(3),
    media: [image(42), { id: id(781), hidden: true }],
  });
}

export interface FixtureState {
  /** Whether /api/me answers the account or 401. */
  signedIn: boolean;
  /** Everything the page asked that no fixture answers, or that the walk should never cause. */
  problems: string[];
  /** Every API request, in order: method, path and query, and when it arrived (ms since the walk's clock started). */
  requests: { method: string; path: string; at: number }[];
  /**
   * The actions the API refuses for now (like, repost, bookmark, follow, delete), with a 503 as a busy server would, so
   * a step sees the card roll back; and how long every action's answer waits, so a step sees the change before it. UI
   * Task 7: "decision" refuses the removed post's decision, and `delayMs` holds every decision's answer too.
   */
  refuse: Set<string>;
  delayMs: number;
  /** New posts above the timelines' first (UI Task 5): the poll finds them, and a reload reads them. */
  newPosts: number;
  /** How long each timeline answer waits, so a step can watch what the answer brings. */
  timelineDelayMs: number;
  /** The posts the reader wrote in the walk (UI Task 6), newest first: on top of the timelines, each with its own thread. */
  written: PostView[];
}

export interface FixtureApi {
  state: FixtureState;
  handle(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer): Promise<void>;
  /** What GET /api/posts/<id>/status answers, for the post page's handle: 204 for a post the API shows, 404 otherwise. */
  postStatus(id: string): number;
}

type Answer = { status: number; json?: unknown; raw?: Buffer; type?: string };

/** The reader's k-th post written in the walk (UI Task 6): ids of their own, after every fixture's. */
export const writtenIdOf = (k: number): string => id(2000 + k);

/** A fixture post's number from its id: post n has the id id(100 + n). */
const numberOf = (postId: string): number => Number.parseInt(postId.slice(-12), 10) - 100;

/** Others who liked the post while the reader's like was on its way: the answer's count is the server's, not the card's guess. */
const OTHERS = 2;

const FLAGS = { like: "liked", repost: "reposted", bookmark: "bookmarked" } as const;

export function createFixtureApi(): FixtureApi {
  const state: FixtureState = { signedIn: false, problems: [], requests: [], refuse: new Set(), delayMs: 0, newPosts: 0, timelineDelayMs: 0, written: [] };
  /** The written posts that are not replies, as timeline rows: the API puts the reader's own posts on top of both feeds. */
  const writtenRows = (): TimelineItem[] => state.written.filter((view) => view.replyTo === null).map((view) => ({ kind: "post" as const, post: view }));
  /** The written replies to one post, oldest first, as the replies route lists them. */
  const writtenReplies = (postId: string): PostView[] => state.written.filter((view) => view.replyTo?.id === postId).reverse();
  const ok = (json: unknown): Answer => ({ status: 200, json });
  const posts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => post(from + i, state.signedIn));

  /** The answer to one GET, or null when no fixture knows the path. */
  function get(path: string, query: URLSearchParams): Answer | null {
    const cursor = query.get("cursor");
    if (path === "/api/me") return state.signedIn ? ok(me()) : { status: 401, json: { error: { code: "unauthenticated", message: "Sign in to continue." } } };
    if (path === "/api/timeline/following" || path === "/api/timeline/latest") return ok(timeline(cursor, query.get("limit"), state.signedIn, state.newPosts, writtenRows()));
    if (path === "/api/timeline/explore") {
      const items = posts(1, 10).map((view) => ({ kind: "post" as const, post: view }));
      return ok(parse(ExplorePage, { items, nextCursor: null, computedAt: ago(5), signInForMore: !state.signedIn }, "explore"));
    }
    if (path === `/api/posts/${POST_ID}/thread`) {
      const replies = [2, 3, 5].map((n) => post(n, state.signedIn, { id: id(300 + n), replyTo: { id: POST_ID, authorHandle: GRACE.handle } }));
      return ok(parse(ThreadResponse, { ancestors: [], post: post(1, state.signedIn), replies: { items: [...replies, ...writtenReplies(POST_ID)], nextCursor: null } }, "thread"));
    }
    // Ada's post 3 replies to a chain of three, and has replies of its own: the page must scroll to hold it at the top (UI Task 5).
    if (path === `/api/posts/${id(103)}/thread`) {
      const ancestors = [9, 8, 6].map((n) => post(n, state.signedIn));
      const replies = [2, 5, 7, 10, 11].map((n) => post(n, state.signedIn, { id: id(320 + n), replyTo: { id: id(103), authorHandle: ADA.handle } }));
      return ok(parse(ThreadResponse, { ancestors, post: post(3, state.signedIn, { replyTo: { id: id(106), authorHandle: ADA.handle } }), replies: { items: replies, nextCursor: null } }, "thread"));
    }
    // A post the reader wrote in the walk: its page, with no ancestors and its replies; its Explore status waits.
    const writtenThread = /^\/api\/posts\/([0-9a-f-]{36})\/thread$/.exec(path);
    const written = writtenThread ? state.written.find((view) => view.id === writtenThread[1]) : undefined;
    if (written) return ok(parse(ThreadResponse, { ancestors: [], post: written, replies: { items: writtenReplies(written.id), nextCursor: null } }, "written thread"));
    const writtenExplore = /^\/api\/posts\/([0-9a-f-]{36})\/explore$/.exec(path);
    if (writtenExplore && state.written.some((view) => view.id === writtenExplore[1])) return ok(parse(ExploreStatus, { status: "pending", computedAt: ago(5) }, "explore status"));
    // Ada's own posts (3, 6, 9 and every third) have an Explore status for her: post 3 is listed, the others wait.
    const exploring = /^\/api\/posts\/([0-9a-f-]{36})\/explore$/.exec(path);
    if (exploring && numberOf(exploring[1]!) % 3 === 0) {
      return ok(parse(ExploreStatus, { status: exploring[1] === id(103) ? "listed" : "pending", computedAt: ago(5) }, "explore status"));
    }
    const profilePath = /^\/api\/profiles\/([a-z0-9_]+)(?:\/(posts|replies|followers|following))?$/.exec(path);
    if (profilePath) {
      const author = AUTHORS.find((a) => a.handle === profilePath[1]);
      if (!author) return null;
      const tab = profilePath[2];
      if (tab === undefined) return ok(profile(author, state.signedIn));
      if (tab === "posts") {
        // UI Task 7: Ada, signed in, reads her removed post first; Grace's profile starts with the post with a hidden image.
        const first = author.id === ADA.id ? (state.signedIn ? [removedPost(true)] : []) : author.id === GRACE.id ? [hiddenImagePost(state.signedIn)] : [];
        const items = [...first, ...posts(1, 12).map((view) => ({ ...view, author }))].map((view) => ({ kind: "post" as const, post: view }));
        return ok(parse(TimelinePage, { items, nextCursor: null }, "profile posts"));
      }
      if (tab === "replies") return ok(parse(PostPage, { items: [], nextCursor: null }, "replies"));
      const people = [listItem(GRACE, "Compilers, ships and the occasional heron.", state.signedIn), listItem(LINUS, "Kernels and coffee.", state.signedIn)].filter((p) => p.handle !== author.handle);
      return ok(parse(ProfilePage, { items: people, nextCursor: null }, "profile list"));
    }
    if (path === "/api/me/bookmarks") return ok(parse(PostPage, { items: posts(1, 20).map((view) => ({ ...view, viewer: { liked: false, reposted: false, bookmarked: true } })), nextCursor: null }, "bookmarks"));
    if (path === "/api/me/likes") return ok(parse(PostPage, { items: posts(5, 8), nextCursor: null }, "likes"));
    if (path === "/api/me/blocks" || path === "/api/me/mutes") return ok(parse(ProfilePage, { items: [], nextCursor: null }, "blocks"));
    const media = /^\/api\/media\/[0-9a-f-]{36}\/(small|large)\.webp$/.exec(path);
    if (media) return { status: 200, raw: FIXTURE_WEBP, type: "image/webp" };
    if (path === "/api/public/facts") return ok(FACTS);
    if (path === "/api/public/transparency") return ok(parse(PublicTransparency, { editions: [] }, "transparency"));
    if (path === "/api/public/head") return ok(parse(PublicHead, { days: [] }, "head"));
    if (path === "/api/auth/sessions") {
      return ok(parse(SessionsResponse, { sessions: [{ id: id(601), deviceLabel: "Chromium on Windows", platform: "web", createdAt: ago(600), lastUsedAt: ago(1), current: true }] }, "sessions"));
    }
    if (path === "/api/auth/passkeys") {
      return ok(parse(PasskeyListResponse, { passkeys: [{ id: id(602), name: "Laptop", createdAt: ago(60 * 24 * 20), lastUsedAt: ago(30), synced: false, createdOn: "Chromium on Windows", current: true, isNew: false, suspended: false }] }, "passkeys"));
    }
    if (path === "/api/moderation/cases") return ok(parse(AuthorCasesPage, { decisions: [], nextCursor: null, activeStrikes: 0 }, "cases"));
    if (path === "/api/moderation/reports") return ok(parse(ReportsPage, { reports: [], nextCursor: null, reportMailStopped: false }, "reports"));
    if (path === "/api/moderation/notices") return ok(parse(AuthorNoticesPage, { notices: [], nextCursor: null }, "notices"));
    if (path === `/api/moderation/decisions/${DECISION_ID}`) return ok(decision());
    if (path === `/api/moderation/decisions/${POST_DECISION_ID}`) {
      if (state.refuse.has("decision")) return { status: 503, json: { error: { code: "unavailable", message: "korbat is busy. Try again in a moment." } } };
      return ok(postDecision());
    }
    if (path === `/api/moderation/releases/${RELEASE_ID}`) {
      return ok(parse(ReleaseNoticeView, { id: RELEASE_ID, basis: "period", releasedAt: ago(60), backupsClearAt: daysAhead(35), upload: false, posts: [{ id: id(103), createdAt: ago(60 * 24 * 40) }], postCount: 1, images: 1, sealDecisionId: null, appeal: "none" }, "release"));
    }
    if (path === `/api/moderation/uploads/${UPLOAD_ID}`) {
      return ok(parse(UploadRefusalView, { id: UPLOAD_ID, refusedAt: ago(120), source: "a hash list", matchKind: "exact", listedAs: "csam", objection: null, mayObject: true, endedAt: null, endAs: null, endReason: null, released: null, reportKept: false }, "upload"));
    }
    return null;
  }

  /**
   * The answer to one of the reader's actions (UI Task 4): a like, a repost or a save turned on (POST) or off (DELETE),
   * answered with the post's counts and the reader's state; a follow, with the follower count; a post deleted, with 204.
   * A kind in `refuse` is answered 503; null for any other path, which is a problem.
   */
  function action(method: string, path: string): Answer | null {
    const refused: Answer = { status: 503, json: { error: { code: "unavailable", message: "korbat is busy. Try again in a moment." } } };
    const engaged = /^\/api\/posts\/([0-9a-f-]{36})\/(like|repost|bookmark)$/.exec(path);
    if (engaged) {
      const kind = engaged[2] as keyof typeof FLAGS;
      if (state.refuse.has(kind)) return refused;
      const on = method === "POST";
      const base = post(numberOf(engaged[1]!), true);
      const counts = { ...base.counts };
      if (kind === "like") counts.likes = base.counts.likes + (on ? 1 + OTHERS : 0);
      if (kind === "repost") counts.reposts = base.counts.reposts + (on ? 1 : 0);
      return ok(parse(EngagementResponse, { counts, viewer: { ...base.viewer!, [FLAGS[kind]]: on } }, "engagement"));
    }
    const follow = /^\/api\/profiles\/([a-z0-9_]+)\/follow$/.exec(path);
    if (follow && AUTHORS.some((author) => author.handle === follow[1])) {
      if (state.refuse.has("follow")) return refused;
      const on = method === "POST";
      return ok(parse(FollowResponse, { following: on, followerCount: on ? 129 : 128 }, "follow"));
    }
    const removed = /^\/api\/posts\/([0-9a-f-]{36})$/.exec(path);
    if (removed && method === "DELETE") return state.refuse.has("delete") ? refused : { status: 204 };
    return null;
  }

  /** The answer to one POST the walk causes by reading: a report's status, and the passkey autofill's options on sign-in. */
  function post_(path: string, body: Buffer): Answer | null {
    // Signing out ends the session: /api/me answers 401 from here on (UI Task 5, the session's end).
    if (path === "/api/auth/signout") {
      state.signedIn = false;
      return { status: 204 };
    }
    if (path === "/api/notices/status") {
      const asked = JSON.parse(body.toString("utf8") || "{}") as { ref?: string; token?: string };
      if (asked.ref !== NOTICE_REF || asked.token !== NOTICE_TOKEN) return null;
      return ok(parse(NoticeStatus, { ref: NOTICE_REF, receivedAt: ago(60 * 24 * 2), items: [], contact: null }, "notice status"));
    }
    if (path === "/api/auth/passkey/signin/options") return ok(parse(PasskeyOptionsResponse, { options: { challenge: "Y2hhbGxlbmdlLW9mLXRoZS13YWxr", rpId: "localhost", userVerification: "required", allowCredentials: [], timeout: 300000 } }, "passkey options"));
    // A post the reader writes (UI Task 6): answered as the API answers it, by Ada, now, with the post it replies to or quotes.
    if (path === "/api/posts") {
      const asked = JSON.parse(body.toString("utf8") || "{}") as { body?: string; replyToId?: string; quoteOfId?: string };
      const quoted = asked.quoteOfId ? post(numberOf(asked.quoteOfId), state.signedIn) : null;
      const view = parse(
        PostView,
        {
          id: writtenIdOf(state.written.length + 1),
          author: ADA,
          body: asked.body ?? "",
          createdAt: new Date().toISOString(),
          state: "visible",
          replyTo: asked.replyToId ? { id: asked.replyToId, authorHandle: GRACE.handle } : null,
          counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
          media: [],
          viewer: { liked: false, reposted: false, bookmarked: false },
          quoteOf: quoted ? { ...quoted, quoteOf: null } : null,
        },
        "written post",
      );
      state.written.unshift(view);
      return ok(view);
    }
    return null;
  }

  return {
    state,
    postStatus: (asked) => (asked === POST_ID || asked === id(103) || state.written.some((view) => view.id === asked) ? 204 : 404),
    async handle(req, res, url, body) {
      const method = req.method ?? "GET";
      state.requests.push({ method, path: `${url.pathname}${url.search}`, at: Date.now() });
      let answer: Answer | null = null;
      try {
        if (method === "GET") answer = get(url.pathname, url.searchParams);
        else if (method === "POST") answer = post_(url.pathname, body) ?? action(method, url.pathname);
        else if (method === "DELETE") answer = action(method, url.pathname);
        // An action's answer waits as long as the step asks, so the step sees the card change before it lands; from UI
        // Task 7 so does a decision's, so a step sees the details sheet's skeletons before the blocks.
        const held = method !== "GET" || url.pathname.startsWith("/api/moderation/decisions/");
        if (held && answer !== null && state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
        if (url.pathname.startsWith("/api/timeline/") && state.timelineDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.timelineDelayMs));
      } catch (err) {
        state.problems.push(`a fixture threw for ${method} ${url.pathname}: ${String(err)}`);
      }
      if (answer === null) {
        state.problems.push(`an unanswered request: ${method} ${url.pathname}${url.search}`);
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: { code: "not_found", message: "No such route" } }));
        return;
      }
      if (answer.status === 204) {
        res.writeHead(204, { "cache-control": "no-store" }).end();
        return;
      }
      if (answer.raw) {
        res.writeHead(answer.status, { "content-type": answer.type ?? "application/octet-stream", "content-length": answer.raw.length, "cache-control": "private, no-store", "x-content-type-options": "nosniff" }).end(answer.raw);
        return;
      }
      // The API's own date header: Explore ages its ranking by it.
      res.writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store", date: new Date().toUTCString() }).end(JSON.stringify(answer.json));
    },
  };
}
```

### Replace `apps/app/test/cases.test.tsx` (whole file)

```tsx
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
    expect(hrefs(out)).toEqual(["/settings/security", "/settings/privacy", "/settings/profile", "/settings/account", "/settings/cases"]);
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
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: "my own post",
    createdAt: TIME,
    state: "removed",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
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
    profile: { id: id(1), handle, displayName: "Ada", handleChangedAt, verified: false, showInExplore: true },
    standing: null,
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
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: "my own post",
    createdAt: TIME,
    state: "removed",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
  };
  return html(<StatusSheetBody load={{ kind: "shown", view: { ...sheetDecision, id: decisionId } }} post={post} me={null} onRetry={() => undefined} />);
}
```

### Replace `apps/app/test/legacy-files.ts` (whole file)

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The source files that still paint with Tailwind's own palette (`text-zinc-400`, `bg-sky-500`) and size the text
 * with size and weight classes instead of korbat's tokens and the Text component (UI design, sections 4.2 and 6.2).
 * contrast.test.ts lets these files, and only these, keep palette classes and hex colours; theme.test.ts lets them
 * keep size and weight classes. A listed file that no longer holds a palette class fails contrast.test.ts, so the
 * task that moves a file onto the tokens takes it off this list in the same commit; Task 8 empties it. Paths are
 * from apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_COLOUR_FILES: readonly string[] = [
  "app/(auth)/age.tsx",
  "app/settings/account.tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
];

/**
 * The files of src/app and src/components that still hold a bare sentence as a JSX child, a text or a string literal
 * written straight into the markup instead of a words module (UI design, section 1.5). a11y.test.tsx lets these files,
 * and only these, keep them; a listed file that no longer holds one fails, so the task that moves a file's sentences
 * into its area's words module takes it off this list in the same commit. Task 10 records what is left. Paths are from
 * apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_TEXT_FILES: readonly string[] = [
  "app/(auth)/age.tsx",
  "app/(auth)/code.tsx",
  "app/(auth)/handle.tsx",
  "app/(auth)/mfa.tsx",
  "app/(auth)/password.tsx",
  "app/(auth)/signin.tsx",
  "app/email-revert/[token].tsx",
  "app/not-me/[token].tsx",
  "app/passkey-remove/[token].tsx",
  "app/settings/account.tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
];

export const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Every source file of the app, with its path from src in forward slashes, as explore.test.tsx reads them. */
export function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}
```

### Replace `apps/app/test/orders.test.tsx` (whole file)

```tsx
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
// react-native-reanimated is mocked once for every test file in test/setup.ts.

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
  preserveFirstUntil: "2027-04-17T09:00:00.000Z",
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
  orderTexts: { reasons: "Der Beitrag ruft zu Gewalt auf.", redress: "Klage beim Verwaltungsgericht Wiesbaden.", scope: null, textsAt: DISABLED_AT, reasonsAt: DISABLED_AT },
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
    expect(out).toMatch(/aria-level="2"[^>]*>Notice: an authority&#x27;s order</);
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

  test("3f's review (people5): a DSA order that does not withhold leaves the post to its author, and the note says so, never that only authorities see it", () => {
    const removed = notice({ order: { ...facts, kind: "dsa_art9", withholdAuthor: false, preserveUntil: null, preserveFirstUntil: null } });
    expect(DecisionView.safeParse(removed).success).toBe(true);
    const read = textOf(html(<DecisionDetail view={removed} />));
    expect(read).toContain(ORDER_TEXTS.notice.noContentRemoved);
    expect(read).toContain(ORDER_NOTICE.done.removed("2026-10-01 08:30 UTC", `/post/${id(1)}`, "2026-10-16 09:00 UTC"));
    expect(read).not.toContain(ORDER_TEXTS.notice.noContent);
    expect(read).not.toContain("only to the authorities");
    // A measure that withholds keeps the first note.
    expect(textOf(html(<DecisionDetail view={notice()} />))).not.toContain(ORDER_TEXTS.notice.noContentRemoved);
  });

  test("without the authority's words, no block; the notice says they follow", () => {
    const read = textOf(html(<DecisionDetail view={notice({ orderTexts: { reasons: null, redress: null, scope: null, textsAt: null, reasonsAt: null } })} />));
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

  test("3f's review (people9): an order's row shows the day its author was told, not the disabling's; other rows keep their decision's day", () => {
    const read = textOf(html(<DecisionsList decisions={[row({ order: "disabled", decidedOn: "2026-08-01", toldOn: "2026-10-16" }), row({ id: id(4), kind: "final", ruleId: "R1", legal: false, actions: ["remove"], decidedOn: "2026-09-01" })]} />));
    expect(read).toContain(ORDER_TEXTS.row.toldOn("2026-10-16"));
    expect(ORDER_TEXTS.row.toldOn("2026-10-16")).toBe("Told on 2026-10-16");
    expect(read).not.toContain(CASES_WORDS.decidedOn("2026-08-01"));
    expect(read).toContain(CASES_WORDS.decidedOn("2026-09-01"));
  });

  test("[chip.order] on a post a DSA order removed without withholding it; not_appealable in [notice.noAppeal]'s first words", () => {
    expect(chipText({ decisionId: id(3), ruleId: null, legal: true, interim: false, strikeUntil: null, order: true })).toBe("Removed: an authority's order");
    expect(chipText({ decisionId: id(3), ruleId: null, legal: true, interim: false, strikeUntil: null })).not.toBe(ORDER_TEXTS.chip.order);
    expect(messageFor("not_appealable")).toBe(NOT_APPEALABLE);
    expect(ORDER_TEXTS.notice.noAppeal.startsWith(NOT_APPEALABLE)).toBe(true);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/db test:       Tests  102 passed (102)
packages/contracts test:       Tests  459 passed (459)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/07-moderation-surfaces-and-public-pages.md 3
```

Expected: 31 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/components/Prose.tsx`

```tsx
import type { ReactNode } from "react";
import { View } from "react-native";
import { useLayout } from "@/theme/layout";
import { Text } from "./kit/Text";

/**
 * The reading layout of the public pages (UI design, section 8.9; UI Task 7): /rules, /transparency, /explore/about and
 * /terms. Section headings in Fraunces (display-3) at level 2, a table's or a subsection's title at level 3, prose in the
 * text face at the post's size, which keeps a line under 70 characters in the 600 to 640 px column; lists drawn with a
 * quiet marker, change logs as dated lists, and tables as label and value rows. The screen's title, the one level-1
 * heading, is its ScreenHeader's or its frame's. Every sentence comes from the page's words module.
 */

/** A heading of the page: level 2 a section, in the display face; level 3 inside a section, in the title face. */
export function Heading({ level, children }: { level: 2 | 3; children: string }) {
  return level === 2 ? (
    <Text as="h2" variant="display-3" className="mt-10">
      {children}
    </Text>
  ) : (
    <Text as="h3" variant="title" className="mt-6">
      {children}
    </Text>
  );
}

/** A paragraph of prose, at the post's size. */
export function Paragraph({ children, tone = "medium" }: { children: ReactNode; tone?: "high" | "medium" }) {
  return (
    <Text variant="post" tone={tone} className="mt-3">
      {children}
    </Text>
  );
}

/** One list, its items read one by one; each marked by a small dot that assistive technology does not hear. */
export function ProseList({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <View role="list" aria-label={label} className="mt-2 gap-1.5">
      {items.map((item) => (
        <View key={item} role="listitem" className="flex-row gap-3 pl-1">
          <View aria-hidden className="mt-[11px] h-1.5 w-1.5 rounded-full bg-ink-low" />
          <Text variant="post" tone="medium" className="min-w-0 flex-1">
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A change log as a dated list: each entry on a rule down its start, newest first as the page orders them, its sentence
 * whole ("Version 2, 2026-10-12: ...") so it reads the same aloud and in a test.
 */
export function DatedList({ label, entries }: { label: string; entries: readonly { key: string; text: string }[] }) {
  return (
    <View role="list" aria-label={label} className="mt-4 border-l-2 border-line-low">
      {entries.map((entry) => (
        <View key={entry.key} role="listitem" className="flex-row gap-3 pb-3">
          <View aria-hidden className="-ml-[5px] mt-[9px] h-2 w-2 rounded-full bg-ink-low" />
          <Text tone="medium" className="min-w-0 flex-1">
            {entry.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A table of figures as label and value rows (3d design, :2745): from 768 px the value stands at the row's end; below it
 * under its label. The label carries its colon, so the row reads "label: value" aloud and in a test, whatever the layout.
 */
export function FigureRows({ label, rows }: { label: string; rows: readonly { label: string; count: string }[] }) {
  const phone = useLayout() === "phone";
  return (
    <View role="list" aria-label={label} className="mt-2 border-t border-line-low">
      {rows.map((row) => (
        <View key={row.label} role="listitem" className={phone ? "gap-0.5 border-b border-line-low py-2.5" : "flex-row items-baseline justify-between gap-6 border-b border-line-low py-2.5"}>
          <Text tone="medium" className={phone ? undefined : "min-w-0 flex-1"}>{`${row.label}:`}</Text>
          <Text variant="body-strong" className="web:tabular-nums">
            {row.count}
          </Text>
        </View>
      ))}
    </View>
  );
}
```

### Create `apps/app/src/components/moderation/StatusSheet.tsx`

```tsx
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Link, router } from "expo-router";
import { MEASURES, type DecisionView, type MeResponse, type PostView } from "@korbat/contracts";
import { STATEMENT_WORDS, getRedress, getRule } from "@korbat/rules";
import { ErrorState } from "@/components/kit/ErrorState";
import { dataAttribute } from "@/components/kit/interaction";
import { Sheet } from "@/components/kit/Sheet";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { LABEL_TONE, buttonFace } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { appealWaitWords, chipText, moderation, utcMinute } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS, STATUS_SHEET_WORDS as W } from "@/lib/moderation-words";
import { reach } from "@/lib/reach";
import { useSession } from "@/lib/session";
import { fullDate } from "@/lib/time";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { AskPerson } from "./DecisionDetail";
import { CaseLink, leaveBy } from "./parts";

/**
 * The details sheet of the author's moderation chip (UI design, sections 6.8, 6.13 and 8.7; decision 11): what korbat
 * decided about the reader's own post, read from GET /api/moderation/decisions/:id each time the sheet opens and kept in
 * this component's state only (no store, no cache), as the post's own data carries only the chip's facts. Each fact is a
 * labelled block, in the design's order: Rule, What it does, Applies to, Who can see it now, Decided by, When, Statement,
 * Appeal; while an appeal can still be filed, Appeal comes first, with the one action the sheet offers. Its words are the
 * decision screen's and the rulebook's, never new judgements: the rule at the version the decision was made under, the
 * statement's own "korbat removed your post of ..." sentences, and "Decided by" in role terms only (review ruling 5).
 */

/** The blocks, by key; `data-status-block` names each on the web, so a test reads their order. */
export type StatusBlockKey = "appeal" | "rule" | "does" | "appliesTo" | "whoSees" | "decidedBy" | "when" | "statement";

/**
 * Where the appeal stands, the first that applies: an order's notice offers no appeal (3f; OrderNotice), an answered or
 * a pending appeal, one that can still be filed (`appealUntil` set, none filed), a decision reversed in full, a decision
 * taken while korbat decides (its interim redress sentence), or nothing to say.
 */
export type AppealState = "none" | "open" | "pending" | "answered" | "reversed" | "interim";

export function appealState(view: DecisionView): AppealState {
  if (view.source === "order" || view.order) return "none";
  if (view.appeal?.state === "answered") return "answered";
  if (view.appeal?.state === "pending") return "pending";
  if (view.appealUntil !== null) return "open";
  if (view.reversedOn !== null) return "reversed";
  if (view.kind === "interim") return "interim";
  return "none";
}

/**
 * "Decided by" in role terms (review ruling 5): an authority's order for an order; korbat's automated check only for a
 * decision DecisionView marks fully automated, a decision without a decider, never because the field is merely set
 * ("partially" is a restriction an admin took on a program's finding); otherwise a korbat moderator. No name, ever.
 */
export function decidedBy(view: Pick<DecisionView, "source" | "automatedDecision">): string {
  if (view.source === "order") return W["status.byOrder"];
  if (view.automatedDecision === "fully") return W["status.byProgram"];
  return W["status.byPerson"];
}

/** The scope said out loud: the account for a decision about no post, the image for a measure on one image, else the post. */
export function appliesTo(view: Pick<DecisionView, "post" | "measures">): string {
  if (view.post === null) return W["status.appliesAccount"];
  if (view.measures.some((measure) => measure.kind.endsWith("_media"))) return W["status.appliesImage"];
  return W["status.appliesPost"];
}

/**
 * The rule as the rulebook named it at the decision's version (a review's or a correction's, the decision it reviewed),
 * or "Illegal content" with the legal reference for a decision on the law. An order names no rule and no law of korbat's
 * judgement (3f), as its row in About you does not; nor does a decision that rests on neither.
 */
export function ruleOf(view: DecisionView): { title: string; reference: string | null } | null {
  if (view.source === "order" || view.order) return null;
  const ruleId = view.ruleId ?? view.reviewed?.ruleId ?? null;
  if (ruleId !== null) {
    const version = view.ruleId !== null ? view.rulesVersion : (view.reviewed?.rulesVersion ?? view.rulesVersion);
    const rule = getRule(ruleId, version);
    return { title: rule ? `${rule.id}: ${rule.title}` : CASES_WORDS.rule(ruleId), reference: null };
  }
  const reference = view.legalReference ?? view.reviewed?.legalReference ?? null;
  if (view.ground === "illegal" || view.reviewed?.ground === "illegal" || reference !== null) return { title: W["status.illegal"], reference };
  return null;
}

/**
 * What the decision does, one sentence a measure, in the statement's own words where the statement has them (the post's
 * and the image's measures, a reset, a seal), and in the measure's label for the account's measures the statement words
 * at length (the decision's screen has them whole).
 */
export function measureLines(view: DecisionView): string[] {
  const post = view.post ? utcMinute(view.post.createdAt) : "";
  const done = STATEMENT_WORDS.done;
  return view.measures.map((measure) => {
    switch (measure.kind) {
      case "withhold":
      case "remove":
      case "withhold_media":
      case "remove_media":
        return done[measure.kind](post);
      case "reset_display_name":
        return done.reset("display_name", view.kind === "interim");
      case "reset_bio":
        return done.reset("bio", view.kind === "interim");
      case "seal_media": {
        const sealed = measure.sealed ?? { posts: 0, images: 0, deletedImages: 0 };
        return view.post ? STATEMENT_WORDS.sealPost(post, sealed.images) : STATEMENT_WORDS.sealAccount(sealed.images, sealed.posts);
      }
      default:
        return MEASURES[measure.kind].label;
    }
  });
}

/** A blank line, which parts a reason's paragraphs; built in code so the file stays free of escapes. */
const BLANK_LINE = String.fromCharCode(10, 10);

/** The reason's first paragraph, which the sheet quotes; the rest is on the decision's screen. */
export function statementLead(view: Pick<DecisionView, "reason">): string | null {
  const first = view.reason?.split(BLANK_LINE)[0]?.trim() ?? "";
  return first.length > 0 ? first : null;
}

/** The blocks a decision shows, in their order: Appeal first while it can be filed, else last; a block with nothing to say is left out. */
export function statusBlocks(view: DecisionView): StatusBlockKey[] {
  const blocks: StatusBlockKey[] = [];
  if (ruleOf(view) !== null) blocks.push("rule");
  if (view.measures.length > 0) blocks.push("does");
  blocks.push("appliesTo", "whoSees", "decidedBy", "when", "statement");
  const appeal = appealState(view);
  // A program's decision offers "Ask for a person" in the Appeal block, beside its interim sentence.
  const program = appeal !== "none" || ((view.askPerson ?? null) !== null && view.source !== "order");
  if (appeal === "open") blocks.unshift("appeal");
  else if (program) blocks.push("appeal");
  return blocks;
}

/** One labelled block: its label a level-3 heading in the meta size, which names the group, and what it says under it. */
function Block({ name, label, divided = true, children }: { name: StatusBlockKey; label: string; divided?: boolean; children: ReactNode }) {
  const labelId = useId();
  return (
    <View role="group" aria-labelledby={labelId} {...dataAttribute("status-block", name)} className={cn("gap-1 py-3", divided ? "border-t border-line-low" : undefined)}>
      <Text as="h3" variant="meta" tone="low" nativeID={labelId}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/**
 * The Appeal block's content. Open: the deadline and the primary action, a link drawn as the primary Button (it opens
 * the decision's screen with the appeal's field focused, ?appeal=1); interim: the redress sentence of the decision's own
 * version; pending or answered: the decision screen's words; and a program's decision adds "Ask for a person", as the
 * decision's screen offers it.
 */
function AppealContent({ view, onAsk, onLeave }: { view: DecisionView; onAsk?: (text: string) => Promise<void>; onLeave?: (href: string) => void }) {
  const state = appealState(view);
  const appeal = view.appeal;
  return (
    <View className="gap-1">
      {state === "open" && view.appealUntil !== null ? (
        <>
          <Text>{fill(W["status.appealUntil"], { date: fullDate(view.appealUntil) })}</Text>
          <Link href={`/settings/cases/${view.id}?appeal=1`} onPress={leaveBy(`/settings/cases/${view.id}?appeal=1`, onLeave)} asChild>
            <Pressable {...dataAttribute("status-appeal")} className={cn(buttonFace({ face: "primary", size: "md" }), "mt-3 self-start active:opacity-90")}>
              <Text variant="body-strong" tone={LABEL_TONE.primary}>
                {W["status.appeal"]}
              </Text>
            </Pressable>
          </Link>
        </>
      ) : null}
      {state === "interim" ? <Text tone="medium">{getRedress(view.redressVersion)?.interim ?? ""}</Text> : null}
      {state === "pending" && appeal?.state === "pending" ? (
        <>
          <Text tone="medium">{DECISION_WORDS.appealFiled(appeal.filedAt.slice(0, 10))}</Text>
          <Text variant="body-strong">{appealWaitWords(view) ?? DECISION_WORDS.appealWaiting}</Text>
        </>
      ) : null}
      {state === "answered" && appeal?.state === "answered" ? (
        <>
          <Text variant="body-strong">{DECISION_WORDS.appealAnswered(appeal.answeredOn)}</Text>
          <CaseLink href={`/settings/cases/${appeal.answeredBy}`} label={DECISION_WORDS.answerScreen} onLeave={onLeave} />
        </>
      ) : null}
      {state === "reversed" ? <Text tone="medium">{DECISION_WORDS.reversed(view.reversedOn ?? "")}</Text> : null}
      <AskPerson view={view} onAsk={onAsk} framed={false} onLeave={onLeave} />
    </View>
  );
}

/** The blocks of a decision the sheet has read. */
function Blocks({ view, post, me, onAsk, onLeave }: { view: DecisionView; post: PostView; me: MeResponse | null; onAsk?: (text: string) => Promise<void>; onLeave?: (href: string) => void }) {
  const rule = ruleOf(view);
  const lead = statementLead(view);
  const open = appealState(view) === "open";
  // Who can see the post now, in Who sees this's sentences (reach(), section 6.14), without the line that repeats the
  // chip's words, which are the sheet's title; their links stay with Who sees this, since Statement links the decision.
  const chip = post.moderation ? chipText(post.moderation) : null;
  const seen = reach(post, me).lines.filter((line) => line.text !== chip);
  const content: Record<StatusBlockKey, ReactNode> = {
    appeal: <AppealContent view={view} onAsk={onAsk} onLeave={onLeave} />,
    rule: rule ? (
      <>
        <Text variant="body-strong">{rule.title}</Text>
        {rule.reference !== null ? <Text tone="medium">{rule.reference}</Text> : null}
      </>
    ) : null,
    does: (
      <>
        {measureLines(view).map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </>
    ),
    appliesTo: <Text>{appliesTo(view)}</Text>,
    whoSees: (
      <>
        {seen.map((line, index) => (
          <Text key={line.text} tone={index === 0 ? "high" : "medium"}>
            {line.text}
          </Text>
        ))}
      </>
    ),
    decidedBy: <Text>{decidedBy(view)}</Text>,
    when: <Text>{fullDate(view.decidedAt)}</Text>,
    statement: (
      <>
        {lead !== null ? <Text tone="medium">{lead}</Text> : null}
        <CaseLink href={`/settings/cases/${view.id}`} label={W["status.readAll"]} onLeave={onLeave} />
      </>
    ),
  };
  const labels: Record<StatusBlockKey, string> = {
    appeal: W["status.appeal"],
    rule: W["status.rule"],
    does: W["status.does"],
    appliesTo: W["status.appliesTo"],
    whoSees: W["status.whoSees"],
    decidedBy: W["status.decidedBy"],
    when: W["status.when"],
    statement: W["status.statement"],
  };
  return (
    <View className="px-5 pb-3">
      {statusBlocks(view).map((key) =>
        // While it can be filed the appeal stands first, on a raised wash above the other blocks: the sheet's one action.
        key === "appeal" && open ? (
          <View key={key} className="mb-2 rounded-card border border-line-low bg-surface-2 px-4 pb-1">
            <Block name={key} label={labels[key]} divided={false}>
              {content[key]}
            </Block>
          </View>
        ) : (
          <Block key={key} name={key} label={labels[key]}>
            {content[key]}
          </Block>
        ),
      )}
    </View>
  );
}

/** While the decision is read: block shapes hidden from assistive technology, and one polite status in their place. */
function LoadingBlocks() {
  return (
    <View className="px-5 pb-3">
      <VisuallyHidden role="status">{UI_WORDS["spinner.label"]}</VisuallyHidden>
      {(["38%", "52%", "30%", "64%"] as const).map((width, index) => (
        <View key={index} aria-hidden className="gap-2 border-t border-line-low py-3">
          <Skeleton.Text width="24%" variant="meta" />
          <Skeleton.Text width={width} />
        </View>
      ))}
    </View>
  );
}

export type StatusLoad = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "shown"; view: DecisionView };

/**
 * What the sheet holds, by where its read stands: the loading blocks, ErrorState with "Try again", or the blocks. The
 * Modal draws nothing on a server, so render tests draw this. `onLeave` is a link pressed inside the open sheet.
 */
export function StatusSheetBody({
  load,
  post,
  me,
  onRetry,
  onAsk,
  onLeave,
}: {
  load: StatusLoad;
  post: PostView;
  me: MeResponse | null;
  onRetry: () => void;
  onAsk?: (text: string) => Promise<void>;
  onLeave?: (href: string) => void;
}) {
  if (load.kind === "loading") return <LoadingBlocks />;
  if (load.kind === "failed") return <ErrorState message={load.message} onRetry={onRetry} />;
  return <Blocks view={load.view} post={post} me={me} onAsk={onAsk} onLeave={onLeave} />;
}

/**
 * The sheet, named by the chip's words (`title`, chipText()), which section 8.7 gives no title of its own. It reads the
 * decision each time it opens, and again on "Try again"; "Ask for a person" sends the one message through the decision's
 * objection route and shows the decision as the answer reads it. A link pressed in it closes it, and once it has closed
 * (and the focus is back on the chip) the route changes.
 */
export function StatusSheet({ post, decisionId, title, open, onClose, onClosed }: { post: PostView; decisionId: string; title: string; open: boolean; onClose: () => void; onClosed?: () => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const [load, setLoad] = useState<StatusLoad>({ kind: "loading" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoad({ kind: "loading" });
    moderation.decision(decisionId).then(
      (view) => {
        if (current) setLoad({ kind: "shown", view });
      },
      (err: unknown) => {
        if (current) setLoad({ kind: "failed", message: errorMessage(err) });
      },
    );
    return () => {
      current = false;
    };
  }, [open, decisionId, round]);

  const ask = async (text: string) => {
    const view = await moderation.objection(decisionId, text);
    setLoad({ kind: "shown", view });
  };

  const pending = useRef<string | null>(null);
  const leave = (href: string) => {
    pending.current = href;
    onClose();
  };
  const closed = () => {
    onClosed?.();
    const href = pending.current;
    pending.current = null;
    if (href !== null) router.push(href);
  };

  return (
    <Sheet open={open} onClose={onClose} onClosed={closed} title={title} size="tall">
      <StatusSheetBody load={load} post={post} me={me} onRetry={() => setRound((count) => count + 1)} onAsk={ask} onLeave={leave} />
    </Sheet>
  );
}
```

### Create `apps/app/src/components/moderation/parts.tsx`

```tsx
import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Link, type Href } from "expo-router";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { cn } from "@/theme/cn";

/**
 * The few shapes the moderation screens share on the tokens (UI design, sections 4.3, 4.4 and 8.7; UI Task 7): a line of
 * a statement or a notice in the body size, a quieter note beside it, and a link that stands on a line of its own. Every
 * sentence they show comes from a words module or the rulebook; these only draw it.
 */

/** A line of a statement or a notice: body text, ink-high; `strong` for the line that says where something stands. */
export function Line({ children, strong = false, className }: { children: ReactNode; strong?: boolean; className?: string }) {
  return (
    <Text variant={strong ? "body-strong" : "body"} className={cn("mt-3", className)}>
      {children}
    </Text>
  );
}

/** A sentence that explains rather than states: body text in ink-medium, which reads at 8.2:1 or more on every surface. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text tone="medium" className={cn("mt-3", className)}>
      {children}
    </Text>
  );
}

/**
 * A press on a link inside an open sheet (StatusSheet): the sheet closes first and the route changes once it has gone,
 * since while it is on screen its focus trap would take the focus back from the next screen. Without `onLeave` the link
 * works as a plain link.
 */
export const leaveBy = (href: string, onLeave?: (href: string) => void) => (event: { preventDefault(): void }) => {
  if (onLeave === undefined) return;
  event.preventDefault();
  onLeave(href);
};

/**
 * A link on a line of its own (another decision, the rules page, a notice): a real anchor, accent-ink words underlined,
 * a 44 px target that starts the line, dimmed while pressed, its underline thicker under a fine pointer.
 */
export function CaseLink({ href, label, onLeave, className }: { href: string; label: string; onLeave?: (href: string) => void; className?: string }) {
  return (
    <Link href={href as Href} onPress={leaveBy(href, onLeave)} asChild>
      <Pressable className={cn("group mt-1 min-h-[44px] justify-center self-start rounded-control active:opacity-70", FOCUS_RING, className)}>
        <Text tone="accent" className="underline decoration-1 underline-offset-2 web:group-hover:decoration-2">
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}
```

### Replace `apps/app/src/app/explore/about.tsx` (whole file)

```tsx
import { View } from "react-native";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { DatedList, Heading, Paragraph } from "@/components/Prose";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { TextLink } from "@/components/ui";
import { EXPLORE_WORDS, exploreRules } from "@/lib/explore";
import { usePageTitle } from "@/lib/page-title";

/**
 * Every rule of a formula with its numbers, then its version and dated change log. The page shows EXPLORE_V2, the
 * constant the refresh ranks with, so the published rules are the ones in force; tests pass other formulas. UI Task 7
 * (section 8.9): each rule a section under a level-2 heading in the reading layout, the change log a dated list.
 */
export function ExploreRules({ formula = EXPLORE_V2 }: { formula?: ExploreFormula }) {
  return (
    <View>
      {exploreRules(formula).map((section) => (
        <View key={section.title}>
          <Heading level={2}>{section.title}</Heading>
          <Paragraph>{section.body}</Paragraph>
        </View>
      ))}
      <Heading level={2}>{EXPLORE_WORDS.versionHeading}</Heading>
      <Paragraph>{EXPLORE_WORDS.version(formula.version)}</Paragraph>
      <DatedList label={EXPLORE_WORDS.versionHeading} entries={formula.changes.map((change) => ({ key: String(change.version), text: EXPLORE_WORDS.change(change) }))} />
    </View>
  );
}

/**
 * How Explore works (2c design, section 11): public, so anyone can hold the order Explore shows to its published rules.
 * UI Task 7: its title is the screen's ScreenHeader, and Back to Explore leads to Home's Explore tab.
 */
export default function ExploreAbout() {
  const title = usePageTitle("title.exploreAbout");
  return (
    <AppShell>
      {title}
      <ScreenHeader title={EXPLORE_WORDS.about} />
      <ScreenScroll screen="explore-about">
        <Paragraph tone="high">{EXPLORE_WORDS.aboutLead}</Paragraph>
        <ExploreRules />
        <TextLink label={EXPLORE_WORDS.backToExplore} href="/?tab=explore" />
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/notice/[ref].tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { NoticeRef, type NoticeItemStatus, type NoticeStatus } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { NoticeNotFound, NoticeStatusView } from "@/components/moderation/NoticeStatusView";
import { Skeleton } from "@/components/kit/Skeleton";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { Button, ErrorText } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { fragmentToken, moderation } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "status"; status: NoticeStatus };

/**
 * The notice status page (3c design, section 9), outside the settings: whoever holds the link reads it, signed in or
 * not. The link carries the reference in its path and the token in its fragment, which a browser sends to no server; the
 * page reads the token there and sends it only in the body of a POST. A wrong reference and a wrong token read the same.
 * UI Task 7 (section 8.7): "Your report" is the screen's title in ScreenHeader; the tab's title names the kind of screen
 * and never the reference.
 */
export default function NoticePage() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = usePageTitle("title.notice");

  const load = useCallback(async (ref: string, token: string) => {
    try {
      setShown({ kind: "status", status: await moderation.status(ref, token) });
    } catch (err) {
      // No report has this reference with this token, or the address was not a status page's at all.
      if (err instanceof ApiError && (err.code === "notice_not_found" || err.code === "invalid_request")) setShown({ kind: "missing" });
      else setShown({ kind: "failed", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    const location = (globalThis as { location?: { hash: string } }).location;
    const found = location ? fragmentToken(location.hash) : null;
    setToken(found);
    if (found === null || !NoticeRef.safeParse(ref).success) {
      setShown({ kind: "missing" });
      return;
    }
    setShown({ kind: "loading" });
    void load(ref, found);
  }, [ref, load]);

  /** One of the page's buttons: a POST with the page's own token, then the page again as the API now gives it. */
  async function contact(choice: "confirm" | "stop") {
    if (busy || token === null) return;
    setBusy(true);
    setError(null);
    try {
      await moderation.contact(ref, token, choice);
      await load(ref, token);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * "Ask for a re-examination" of one item: a POST with the page's own token and the item's position, then the page again
   * as the API now gives it. A refusal is thrown to the control that asked, which words it in place.
   */
  async function reexamine(item: NoticeItemStatus, statement: string) {
    if (token === null) return;
    await moderation.reexamineNotice(ref, token, item.position, statement);
    await load(ref, token);
  }

  // While the status loads the page stays in the shell, as skeleton lines (UI design, section 6.12).
  const header = <ScreenHeader title={STATUS_WORDS.title} />;
  if (shown.kind === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.Page />
      </AppShell>
    );
  }
  return (
    <AppShell>
      {title}
      {header}
      <ScreenScroll screen="notice">
        {shown.kind === "missing" ? <NoticeNotFound /> : null}
        {shown.kind === "failed" ? (
          <>
            <ErrorText message={shown.message} />
            <Button
              label={STATUS_WORDS.retry}
              onPress={() => {
                if (token !== null) void load(ref, token);
              }}
              tone="secondary"
            />
          </>
        ) : null}
        {shown.kind === "status" ? <NoticeStatusView status={shown.status} onContact={(choice) => void contact(choice)} onReexamine={reexamine} busy={busy} error={error} /> : null}
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/report.tsx` (whole file)

```tsx
import { Redirect, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { ReportForm } from "@/components/moderation/ReportForm";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { givenTarget } from "@/lib/moderation";
import { REPORT_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

/**
 * The report form's page (3c design, section 9): opened from "Report" on a post, an image or a profile, whose address
 * names the item, or on its own, from the terms page, where it asks for a link. It stands outside the settings, whose
 * layout sends a signed-out reader to sign in: anyone may report, signed in or not. An account that has not chosen a
 * handle yet finishes that first, as the API asks of every signed-in request. UI Task 7 (section 8.7): "Report to
 * korbat" is the screen's title in ScreenHeader, its one level-1 heading, and the tab's title names the kind of screen.
 */
export default function Report() {
  const params = useLocalSearchParams<{ post?: string; media?: string; account?: string }>();
  const { state } = useSession();
  const title = usePageTitle("title.report");
  const header = <ScreenHeader title={REPORT_WORDS.title} />;
  // While the session loads the form's place stays in the shell, as skeleton lines (UI design, section 6.12).
  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.Page />
      </AppShell>
    );
  }
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;
  const given = givenTarget(params);
  return (
    <AppShell>
      {title}
      {header}
      <ScreenScroll screen="report">
        {/* A form opened on another item starts empty: its key is the item. */}
        <ReportForm key={given ? JSON.stringify(given) : "link"} signedIn={state.status === "signed-in"} given={given} standing={state.status === "signed-in" ? state.me.standing : null} />
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/rules.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { View } from "react-native";
import { AUTOMATION_RULES, PublicFacts } from "@korbat/contracts";
import { RULES, RULES_CHANGES, RULES_VERSION } from "@korbat/rules";
import { AppShell } from "@/components/AppShell";
import { DatedList, Heading, Paragraph, ProseList } from "@/components/Prose";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { TextLink } from "@/components/ui";
import { api } from "@/lib/api";
import { usePageTitle } from "@/lib/page-title";
import { PAGE_DOWN, RULES_PAGE, toolBlocks, type AutomationLimits } from "@/lib/public-pages";
import { MEASURES_PARAGRAPH, REPORTING_IN_BAD_FAITH, STRIKES, SUSPENSION, TERRORIST_CONTENT, termsParagraphs } from "@/lib/terms";

/** The sections the terms build from STANDING_RULES and ORDER_RULES, which this page prints with the same builders. */
const NUMBERED_SECTIONS: { title: string; body: string }[] = [
  { title: "Strikes", body: STRIKES },
  { title: "Suspension and termination", body: SUSPENSION },
  { title: "Reporting in bad faith", body: REPORTING_IN_BAD_FAITH },
  { title: "Terrorist content", body: TERRORIST_CONTENT },
];

/**
 * The rules page as it reads with the facts it was given (3d design, section 9.2; W.1): the rules in force, what korbat
 * can do and when, what each automated tool does in the state the running server reports, and the change log. While the
 * facts are on their way the automation section holds its lead alone; when the route did not answer (`"down"`) the fixed
 * texts stand and it reads [page.down]: the page never prints a tool as off or on without the route's answer. `limits` are the program's caps, printed once a tool that rates or
 * compares images is on (their constant comes with the automated decision, Task 6). UI Task 7 (section 8.9): the
 * page's title is the screen's ScreenHeader; here the lead, the sections in the reading layout of components/Prose.tsx,
 * each tool a card, and the change log a dated list.
 */
export function RulesView({ facts, limits = null }: { facts: PublicFacts | "loading" | "down"; limits?: AutomationLimits | null }) {
  const blocks = typeof facts === "string" ? [] : toolBlocks(facts);
  const anyImageTool = blocks.some((block) => (block.tool === "r1" || block.tool === "match") && block.on);
  return (
    <View>
      <Paragraph tone="high">{RULES_PAGE.lead}</Paragraph>

      <Heading level={2}>{RULES_PAGE.rulesHeading}</Heading>
      {RULES.map((rule) => (
        <View key={rule.id}>
          <Heading level={3}>{`${rule.id}: ${rule.title}`}</Heading>
          <Paragraph>{rule.text}</Paragraph>
          <Paragraph>{RULES_PAGE.allowed}</Paragraph>
          <ProseList label={`${rule.id}: ${RULES_PAGE.allowed}`} items={rule.allowed} />
          <Paragraph>{RULES_PAGE.notAllowed}</Paragraph>
          <ProseList label={`${rule.id}: ${RULES_PAGE.notAllowed}`} items={rule.notAllowed} />
        </View>
      ))}
      <Paragraph>{RULES_PAGE.law}</Paragraph>

      <Heading level={2}>{RULES_PAGE.measuresHeading}</Heading>
      <Paragraph>{MEASURES_PARAGRAPH}</Paragraph>
      {NUMBERED_SECTIONS.map((section) => (
        <View key={section.title}>
          <Heading level={3}>{section.title}</Heading>
          {termsParagraphs(section.body).map((paragraph, index) => (
            <Paragraph key={index}>{paragraph}</Paragraph>
          ))}
        </View>
      ))}

      <Heading level={2}>{RULES_PAGE.automationHeading}</Heading>
      <Paragraph>{RULES_PAGE.autoLead}</Paragraph>
      {facts === "loading" ? null : facts === "down" ? (
        <Paragraph>{PAGE_DOWN}</Paragraph>
      ) : (
        <View>
          {blocks.map((block) => (
            <View key={block.tool} role="group" className="mt-4 rounded-card border border-line-low bg-surface-1 px-4 pb-4">
              {block.paragraphs.map((paragraph, index) => (
                <Paragraph key={index}>{paragraph}</Paragraph>
              ))}
            </View>
          ))}
          {anyImageTool ? (
            limits === null ? null : (
              <>
                <Paragraph>{RULES_PAGE.autoCap(limits)}</Paragraph>
                <Paragraph>{RULES_PAGE.autoTarget(limits.objectionTargetHours)}</Paragraph>
              </>
            )
          ) : (
            <Paragraph>{RULES_PAGE.autoNone}</Paragraph>
          )}
        </View>
      )}

      <Heading level={2}>{RULES_PAGE.versionHeading}</Heading>
      <Paragraph>{RULES_PAGE.version(RULES_VERSION)}</Paragraph>
      <DatedList label={RULES_PAGE.versionHeading} entries={[...RULES_CHANGES].reverse().map((change) => ({ key: String(change.version), text: RULES_PAGE.change(change) }))} />

      <TextLink label={RULES_PAGE.transparencyLink} href="/transparency" />
      <TextLink label={RULES_PAGE.exploreLink} href="/explore/about" />
    </View>
  );
}

/**
 * /rules (3d design, sections 9.1 and 9.2), public, signed in or out: it reads no session for its content and sends one
 * GET, /api/public/facts, which the API answers no-cache, so the page prints what is switched on now.
 */
export default function RulesPage() {
  const [facts, setFacts] = useState<PublicFacts | "loading" | "down">("loading");
  const title = usePageTitle("title.rules");
  useEffect(() => {
    let live = true;
    api("/api/public/facts", { schema: PublicFacts })
      .then((answer) => {
        if (live) setFacts(answer);
      })
      .catch(() => {
        if (live) setFacts("down");
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <AppShell>
      {title}
      <ScreenHeader title={RULES_PAGE.title} />
      <ScreenScroll screen="rules">
        {/* 3d Task 6: the program's caps and the target of an answer are the contracts' constants, which the database mirrors. */}
        <RulesView facts={facts} limits={AUTOMATION_RULES} />
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/cases/[id].tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { DecisionView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { DecisionDetail } from "@/components/moderation/DecisionDetail";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "decision"; view: DecisionView };

/** The screen's header: "Cases", its one level-1 heading, Back to the list, and the settings row under it. */
function CasesHeader() {
  return (
    <ScreenHeader title={CASES_WORDS.title} back="/settings/cases">
      <SettingsNav current="cases" />
    </ScreenHeader>
  );
}

/**
 * One decision (3c design, section 9), under Settings, Cases: the chip's details sheet, its "Read the full decision" and
 * each row of "About you" lead here. The API answers only for the account the decision is about and only for a decision
 * that account was told of; anything else reads as one sentence, whatever the id named. UI Task 7 (section 8.7): the
 * title in ScreenHeader, skeleton lines in the shell while it loads, and ?appeal=1 (the sheet's "Appeal") focuses the
 * appeal's field once the decision shows.
 */
export default function Decision() {
  const { id, appeal } = useLocalSearchParams<{ id: string; appeal?: string }>();
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const title = usePageTitle("title.cases");

  useEffect(() => {
    let cancelled = false;
    setShown({ kind: "loading" });
    void (async () => {
      try {
        const view = await moderation.decision(id);
        if (!cancelled) setShown({ kind: "decision", view });
      } catch (err) {
        if (cancelled) return;
        // No decision of this account has the id, or the address held no id at all.
        if (err instanceof ApiError && (err.status === 404 || err.code === "invalid_request")) setShown({ kind: "missing" });
        else setShown({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * "Appeal": a POST for the decision in the address, with what its author wrote, if anything. The answer is the
   * decision as it now reads, with the appeal waiting, and the screen shows that. A refusal is thrown to the form, which
   * words it in place and keeps what was written.
   */
  async function sendAppeal(statement: string) {
    setShown({ kind: "decision", view: await moderation.appeal(id, statement) });
  }

  /** 3d Task 6: "Ask for a person", as the appeal: the answer is the decision as it now reads, with the request sent. */
  async function ask(text: string) {
    setShown({ kind: "decision", view: await moderation.objection(id, text) });
  }

  // While the decision loads the screen stays in the shell, under its header, as skeleton lines (section 6.12).
  if (shown.kind === "loading") {
    return (
      <AppShell>
        {title}
        <CasesHeader />
        <HeaderSpace />
        <Skeleton.Page />
      </AppShell>
    );
  }
  return (
    <AppShell>
      {title}
      <CasesHeader />
      <ScreenScroll screen="decision">
        {shown.kind === "missing" ? <ErrorText message={DECISION_WORDS.notFound} /> : null}
        {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
        {shown.kind === "decision" ? <DecisionDetail view={shown.view} onAppeal={sendAppeal} onAsk={ask} focusAppeal={appeal === "1"} /> : null}
        <TextLink label={DECISION_WORDS.back} href="/settings/cases" />
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/cases/[id]/reply.tsx` (whole file)

```tsx
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { REPLY_TEXT_MAX, type DecisionView, type ReplyResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";
import { STANDING_TEXTS, standingMeasureOf } from "@/lib/standing";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "decision"; view: DecisionView };

/**
 * The opening of the reply screen (3e design, section 9.3), from the decision's standing read fresh: before a start that
 * is fixed ([reply.before]), before one that is not ([reply.unfixed]), or while the measure runs ([reply.running]); null
 * when the decision takes no reply now.
 */
export function replyOpening(view: DecisionView): string | null {
  const standing = view.standing;
  const measure = standingMeasureOf(view);
  if (standing === null || measure === null || !standing.replyOpen) return null;
  if (standing.state === "unfixed" || (standing.state === "announced" && standing.startsAt === null)) return STANDING_TEXTS.reply.unfixed(measure.kind, standing.earliestStart);
  if (standing.state === "announced" && standing.startsAt !== null) return STANDING_TEXTS.reply.before(measure.kind, standing.startsAt);
  if (standing.state === "running") return STANDING_TEXTS.reply.running(measure.kind, standing.endsAt);
  return null;
}

/**
 * The reply's form, once: the opening, the optional field with its count, [reply.hint], [reply.once], [reply.kept] and
 * "Send reply". After the answer the form gives way to [reply.sent.onTime] or [reply.sent.late], which takes the focus.
 * A refusal is worded under the button, and what was written stays.
 */
export function ReplyPanel({ view, onSend }: { view: DecisionView; onSend: (statement: string) => Promise<ReplyResponse> }) {
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReplyResponse | null>(null);
  const sentRef = useRef<View>(null);
  const measure = standingMeasureOf(view);
  const opening = replyOpening(view);

  useEffect(() => {
    if (sent !== null) (sentRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [sent]);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSent(await onSend(statement));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null && measure !== null) {
    return (
      <View>
        {/* The Notice of the answer, which takes the focus (9.8). */}
        <View ref={sentRef} accessibilityRole="alert" focusable className="mt-4 rounded-card border border-line-low bg-surface-1 px-4 py-3">
          <Text>{sent.onTime ? STANDING_TEXTS.reply.sentOnTime(measure.kind, sent.filedAt) : STANDING_TEXTS.reply.sentLate(measure.kind, sent.filedAt)}</Text>
        </View>
        <TextLink label={STANDING_TEXTS.reply.back} href={`/settings/cases/${view.id}`} />
      </View>
    );
  }
  if (opening === null || measure === null) {
    return (
      <View>
        <Body>{STANDING_TEXTS.reply.closed}</Body>
        <TextLink label={STANDING_TEXTS.reply.back} href={`/settings/cases/${view.id}`} />
      </View>
    );
  }
  return (
    <View>
      <Body>{opening}</Body>
      <Field label={STANDING_TEXTS.reply.field} value={statement} onChangeText={setStatement} multiline maxLength={REPLY_TEXT_MAX} />
      <Text aria-live="polite" variant="meta" tone="low" className="mt-1">
        {STANDING_TEXTS.reply.count(statement.length)}
      </Text>
      <Text tone="medium" className="mt-3">
        {STANDING_TEXTS.reply.hint}
      </Text>
      <Text tone="medium" className="mt-3">
        {STANDING_TEXTS.reply.once}
      </Text>
      <Text tone="medium" className="mt-3">
        {STANDING_TEXTS.reply.kept}
      </Text>
      <Button label={STANDING_TEXTS.reply.send} onPress={() => void send()} busy={busy} />
      <ErrorText message={error} />
    </View>
  );
}

/**
 * The reply screen (3e design, section 9.3), under Settings, Cases, beside the decision's screen: "Reply" on the banner
 * and on the decision's screen lead here while the reply is open. The decision is read fresh; an id that names no
 * decision of this account reads as the decision's screen says it. UI Task 7: "Cases" in ScreenHeader with Back to the
 * decision, the reply's title a level-2 heading under it, skeleton lines in the shell while it loads.
 */
export default function Reply() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const title = usePageTitle("title.cases");

  useEffect(() => {
    let cancelled = false;
    setShown({ kind: "loading" });
    void (async () => {
      try {
        const view = await moderation.decision(id);
        if (!cancelled) setShown({ kind: "decision", view });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.code === "invalid_request")) setShown({ kind: "missing" });
        else setShown({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const header = (
    <ScreenHeader title={CASES_WORDS.title} back={`/settings/cases/${id}`}>
      <SettingsNav current="cases" />
    </ScreenHeader>
  );
  // While the decision loads the screen stays in the shell, under its header, as skeleton lines (section 6.12).
  if (shown.kind === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.Page />
      </AppShell>
    );
  }
  return (
    <AppShell>
      {title}
      {header}
      <ScreenScroll screen="reply">
        <Text as="h2" variant="display-3">
          {STANDING_TEXTS.reply.title}
        </Text>
        {shown.kind === "missing" ? <ErrorText message={DECISION_WORDS.notFound} /> : null}
        {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
        {shown.kind === "decision" ? <ReplyPanel view={shown.view} onSend={(statement) => moderation.reply(id, statement)} /> : null}
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/cases/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { AuthorCaseRow, AuthorNoticesPage, ReportItem, ReportRow } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { DecisionsList, NoticesList, ReportsList, StandingBlock } from "@/components/moderation/CasesLists";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextButton } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { CASES_WORDS, STATUS_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";

type Tab = "about" | "reports";

/** A list read a page at a time: its rows so far, the cursor of the next page, and whether a read is out or failed. */
interface Pages<T> {
  rows: T[];
  next: string | null;
  loaded: boolean;
  busy: boolean;
  error: string | null;
}

const EMPTY = { rows: [], next: null, loaded: false, busy: false, error: null };

/** The panel the two tabs control (section 6.10). */
const PANEL = "cases-panel";

/** A tab's first page on its way (6.12): rows of the list's shape, hidden from assistive technology, and one polite status. */
function RowsLoading() {
  return (
    <View>
      <VisuallyHidden role="status">{UI_WORDS["spinner.label"]}</VisuallyHidden>
      {(["46%", "38%", "52%", "41%"] as const).map((width, index) => (
        <View key={index} aria-hidden className="min-h-[52px] gap-2 border-b border-line-low px-4 py-3">
          <Skeleton.Text width={width} />
          <Skeleton.Text width="64%" variant="meta" />
        </View>
      ))}
    </View>
  );
}

/**
 * Cases (3c design, section 9), inside the settings layout, which lets in only a signed-in account with a handle: two
 * tabs. "About you" lists the decisions about the account; "Your reports" lists the reports it sent, with their outcomes
 * once released and, when the account's address stopped korbat's report mails, the notice and the button that resumes
 * them. A link from the report form opens the second tab (`?tab=reports`). UI Task 7 (sections 6.10 and 8.7): the title,
 * the settings row and the tabs in ScreenHeader, the tabs the kit's Tabs (one tab stop, the arrows choose), the list
 * under them a TabPanel, and skeleton rows while a tab's first page loads.
 */
export default function Cases() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "reports" ? "reports" : "about");
  const title = usePageTitle("title.cases");
  // 3e: the block "Your standing" reads the account's measure from /me, which the session holds fresh.
  const { state } = useSession();
  const [decisions, setDecisions] = useState<Pages<AuthorCaseRow>>(EMPTY);
  const [reports, setReports] = useState<Pages<ReportRow>>(EMPTY);
  const [mailStopped, setMailStopped] = useState(false);
  // 3e: how many of the account's strikes count now, as every page of "About you" says.
  const [activeStrikes, setActiveStrikes] = useState(0);
  // 3d Task 2: the notices that are not decisions (the releases of the account's sealed images), their first page.
  const [notices, setNotices] = useState<AuthorNoticesPage["notices"]>([]);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  /** Reads the first page of the decisions, or the page after `cursor`. */
  const loadDecisions = useCallback(async (cursor?: string) => {
    setDecisions((current) => ({ ...current, busy: true, error: null }));
    try {
      const page = await moderation.cases(cursor);
      setActiveStrikes(page.activeStrikes);
      // 3d Task 2: the notices, read with the decisions' first page; a failure to read them leaves the list out.
      if (!cursor) setNotices(await moderation.notices().then((found) => found.notices, () => []));
      setDecisions((current) => ({ rows: cursor ? [...current.rows, ...page.decisions] : page.decisions, next: page.nextCursor, loaded: true, busy: false, error: null }));
    } catch (err) {
      setDecisions((current) => ({ ...current, busy: false, error: errorMessage(err) }));
    }
  }, []);

  /** The same for the reports; every page says whether korbat's report mails to the account are stopped. */
  const loadReports = useCallback(async (cursor?: string) => {
    setReports((current) => ({ ...current, busy: true, error: null }));
    try {
      const page = await moderation.reports(cursor);
      setMailStopped(page.reportMailStopped);
      setReports((current) => ({ rows: cursor ? [...current.rows, ...page.reports] : page.reports, next: page.nextCursor, loaded: true, busy: false, error: null }));
    } catch (err) {
      setReports((current) => ({ ...current, busy: false, error: errorMessage(err) }));
    }
  }, []);

  // Each tab reads its list the first time it is shown.
  useEffect(() => {
    if (tab === "about" && !decisions.loaded && !decisions.busy && decisions.error === null) void loadDecisions();
    if (tab === "reports" && !reports.loaded && !reports.busy && reports.error === null) void loadReports();
  }, [tab, decisions, reports, loadDecisions, loadReports]);

  async function resume() {
    if (resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      await moderation.resumeReportMail();
      setMailStopped(false);
    } catch (err) {
      setResumeError(errorMessage(err));
    } finally {
      setResuming(false);
    }
  }

  /**
   * "Ask for a re-examination" of one item of the account's own reports, by its id; the list is then read again from
   * its start. A refusal is thrown to the control that asked, which words it in place.
   */
  async function reexamine(item: ReportItem, statement: string) {
    await moderation.reexamineOwn(item.id, statement);
    await loadReports();
  }

  const shown = tab === "about" ? decisions : reports;
  return (
    <AppShell>
      {title}
      <ScreenHeader title={CASES_WORDS.title}>
        <SettingsNav current="cases" />
        <View className="mt-1">
          <Tabs
            label={CASES_WORDS.title}
            tabs={[
              { key: "about", label: CASES_WORDS.tabs.about },
              { key: "reports", label: CASES_WORDS.tabs.reports },
            ]}
            selected={tab}
            onSelect={setTab}
            panelId={PANEL}
          />
        </View>
      </ScreenHeader>
      <TabPanel panelId={PANEL} selected={tab}>
        <ScreenScroll screen="cases" flush>
          {!shown.loaded && shown.error === null ? <RowsLoading /> : null}
          {tab === "about" && decisions.loaded ? <StandingBlock activeStrikes={activeStrikes} standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
          {tab === "about" && decisions.loaded ? <NoticesList notices={notices} /> : null}
          {tab === "about" && decisions.loaded ? <DecisionsList decisions={decisions.rows} /> : null}
          {tab === "reports" && reports.loaded ? <ReportsList page={{ reports: reports.rows, reportMailStopped: mailStopped }} onResume={() => void resume()} onReexamine={reexamine} busy={resuming} error={resumeError} /> : null}
          <View className="px-4 pb-4">
            <ErrorText message={shown.error} />
            {/* A first read that failed is asked again by hand; the tab does not ask in a loop. */}
            {shown.error && !shown.loaded ? <TextButton label={STATUS_WORDS.retry} onPress={() => void (tab === "about" ? loadDecisions() : loadReports())} /> : null}
            {shown.next ? <TextButton label={CASES_WORDS.more} onPress={() => void (tab === "about" ? loadDecisions(shown.next!) : loadReports(shown.next!))} /> : null}
          </View>
        </ScreenScroll>
      </TabPanel>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/cases/releases/[id].tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { ReleaseNoticeView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { ReleaseNoticeDetail } from "@/components/moderation/ReleaseNotice";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { usePageTitle } from "@/lib/page-title";
import { CASES_WORDS, DECISION_WORDS, RELEASE_TEXTS } from "@/lib/moderation-words";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "release"; view: ReleaseNoticeView };

/**
 * 3d Task 2 (design, section 9.6): a release's notice, under Settings, Cases; its entry in "About you" leads here. The
 * API answers only for the author of the released posts, and not at all while the author may not be told yet; anything
 * else reads as one sentence, whatever the id named. Where an appeal of the sealing decision stands comes with the view
 * (3d review L11), so the screen reads nothing else.
 */
export default function Release() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const title = usePageTitle("title.cases");

  useEffect(() => {
    let cancelled = false;
    setShown({ kind: "loading" });
    void (async () => {
      try {
        const view = await moderation.release(id);
        if (!cancelled) setShown({ kind: "release", view });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.code === "invalid_request")) setShown({ kind: "missing" });
        else setShown({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const header = (
    <ScreenHeader title={CASES_WORDS.title} back="/settings/cases">
      <SettingsNav current="cases" />
    </ScreenHeader>
  );
  // While the notice loads the screen stays in the shell, under its header, as skeleton lines (UI design, section 6.12).
  if (shown.kind === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.Page />
      </AppShell>
    );
  }
  return (
    <AppShell>
      {title}
      {header}
      <ScreenScroll screen="release">
        {shown.kind === "missing" ? <ErrorText message={RELEASE_TEXTS.notFound} /> : null}
        {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
        {shown.kind === "release" ? <ReleaseNoticeDetail view={shown.view} /> : null}
        <TextLink label={DECISION_WORDS.back} href="/settings/cases" />
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/cases/uploads/[id].tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { UploadRefusalView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { UploadNoticeDetail } from "@/components/moderation/UploadNotice";
import { HeaderSpace, ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ErrorText, TextLink } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { moderation } from "@/lib/moderation";
import { usePageTitle } from "@/lib/page-title";
import { CASES_WORDS, DECISION_WORDS, UPLOAD_TEXTS } from "@/lib/moderation-words";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "upload"; view: UploadRefusalView };

/**
 * 3d Task 7 (design, section 9.5): a refused upload's notice, under Settings, Cases; its entry in "About you" and the
 * composer's "Why" lead here. The API answers only for the uploader; anything else reads as one sentence, whatever the id
 * named. "Object" sends the one message and shows the notice as the answer reads it.
 */
export default function Upload() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const title = usePageTitle("title.cases");

  useEffect(() => {
    let cancelled = false;
    setShown({ kind: "loading" });
    void (async () => {
      try {
        const view = await moderation.upload(id);
        if (!cancelled) setShown({ kind: "upload", view });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.code === "invalid_request")) setShown({ kind: "missing" });
        else setShown({ kind: "failed", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const object = async (text: string) => {
    const view = await moderation.objectToUpload(id, text);
    setShown({ kind: "upload", view });
  };

  const header = (
    <ScreenHeader title={CASES_WORDS.title} back="/settings/cases">
      <SettingsNav current="cases" />
    </ScreenHeader>
  );
  // While the notice loads the screen stays in the shell, under its header, as skeleton lines (UI design, section 6.12).
  if (shown.kind === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.Page />
      </AppShell>
    );
  }
  return (
    <AppShell>
      {title}
      {header}
      <ScreenScroll screen="upload">
        {shown.kind === "missing" ? <ErrorText message={UPLOAD_TEXTS.notFound} /> : null}
        {shown.kind === "failed" ? <ErrorText message={shown.message} /> : null}
        {shown.kind === "upload" ? <UploadNoticeDetail view={shown.view} onObject={object} /> : null}
        <TextLink label={DECISION_WORDS.back} href="/settings/cases" />
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/terms.tsx` (whole file)

```tsx
import { View } from "react-native";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Text } from "@/components/kit/Text";
import { Heading, Paragraph } from "@/components/Prose";
import { TextLink } from "@/components/ui";
import { CONTACT_EMAIL, reportHref } from "@/lib/moderation";
import { CONTACT_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";
import { RULES_PAGE, TRANSPARENCY_PAGE } from "@/lib/public-pages";
import { TERMS_PAGE, TERMS_SECTIONS, TERMS_VERSION, termsParagraphs } from "@/lib/terms";

/**
 * The terms (UI design, section 8.9; UI Task 7): outside the app's shell, in PublicFrame's wide column (640 px), so they
 * read as a document: the title in the display face, the version under it, each section under its level-2 heading with
 * its paragraphs at the post's size, then Contact, the two public pages and the report form. The frame adds the
 * wordmark above and its own links to the public pages below, after the page's.
 */
export default function Terms() {
  const title = usePageTitle("title.terms");
  return (
    <PublicFrame wide>
      {title}
      <View className="pb-10 pt-2">
        <Text as="h1" variant="display-2">
          {TERMS_PAGE.title}
        </Text>
        <Text variant="meta" tone="low" className="mt-2">
          {TERMS_PAGE.version(TERMS_VERSION)}
        </Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.title}>
            <Heading level={2}>{section.title}</Heading>
            {/* A long section is several paragraphs; each is an element of its own, so a reader gets them apart. */}
            {termsParagraphs(section.body).map((paragraph, index) => (
              <Paragraph key={index}>{paragraph}</Paragraph>
            ))}
          </View>
        ))}
        {/* Not one of the terms' sections: the users' contact address is the build's (3c design, section 9). */}
        <Heading level={2}>{CONTACT_WORDS.title}</Heading>
        <Paragraph>{CONTACT_WORDS.body(CONTACT_EMAIL)}</Paragraph>
        {/* 3d (design, section 9.1): the two public pages, under the sections and above the report form's link. */}
        <TextLink label={TRANSPARENCY_PAGE.rulesLink} href="/rules" />
        <TextLink label={RULES_PAGE.transparencyLink} href="/transparency" />
        {/* The report form needs no account and no item to start from. */}
        <TextLink label={CONTACT_WORDS.report} href={reportHref()} />
        <TextLink label={TERMS_PAGE.back} href="/" replace />
      </View>
    </PublicFrame>
  );
}
```

### Replace `apps/app/src/app/transparency.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { ANNEX3_GROUNDS, ORDER_GROUNDS, PublicFacts, PublicHead, PublicTransparency, type OrderFigures, type TransparencyFigures } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { FigureRows, Heading, Paragraph } from "@/components/Prose";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { TextLink } from "@/components/ui";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { usePageTitle } from "@/lib/page-title";
import { PAGE_DOWN, TRANSPARENCY_PAGE, recipientsMonth } from "@/lib/public-pages";
import { cn } from "@/theme/cn";

const T = TRANSPARENCY_PAGE;
type Edition = PublicTransparency["editions"][number];
type Row = { label: string; count: string };

/** A text button of the page (an older version shown or hidden, a day's proof saved): accent words in a 44 px target. */
const PAGE_BUTTON = cn("group mt-1 min-h-[44px] justify-center self-start rounded-control active:opacity-70", FOCUS_RING);

/**
 * One table: its heading and its rows, each read as "label: value", label and value rows, never a chart (9.1; UI Task
 * 7, section 8.9); a table with no row is its "none" sentence.
 */
function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <View>
      <Heading level={3}>{title}</Heading>
      {rows.length === 0 ? <Paragraph>{T.tableNone}</Paragraph> : <FigureRows label={title} rows={rows} />}
    </View>
  );
}

/** A table's stored rows with the page's labels: `other` by the table's own word. */
const labelled = (rows: readonly { label: string; count: string }[], label: (key: string) => string, other: string): Row[] =>
  rows.map((row) => ({ label: row.label === "other" ? other : label(row.label), count: row.count }));

/** An order figure as the page prints it: a number, or "not recorded", never 0, for a figure the rows can no longer give. */
const figure = (n: number | null) => (n === null ? T.notRecorded : String(n));
const byGround = (grounds: readonly string[], counts: Record<string, number> | null) =>
  counts === null ? T.notRecorded : grounds.map((ground) => `${T.grounds[ground] ?? ground} ${counts[ground]}`).join(", ");

/**
 * The section on authorities' orders (9.3 item 4): [tr.orders], then the yearly report's headings with tco-counts'
 * figures as numbers, without the issuing state. It stands only in a year that has the section.
 */
function OrdersSection({ orders }: { orders: OrderFigures }) {
  const L = T.orderLines;
  const minutes = orders.minutes;
  const minutesList = minutes === null ? T.notRecorded : minutes.list.length === 0 ? "none" : minutes.list.map((n) => figure(n)).join(", ");
  return (
    <View>
      <Heading level={3}>{T.ordersHeading}</Heading>
      <Paragraph>{T.orders}</Paragraph>
      <Paragraph>{T.orderHeadings.received}</Paragraph>
      <Paragraph>{orders.received === null ? L.received(T.notRecorded, T.notRecorded) : L.received(String(orders.received.total), String(orders.received.crossBorder))}</Paragraph>
      <Paragraph>{T.orderHeadings.disabled}</Paragraph>
      <Paragraph>{L.itemsDisabled(figure(orders.itemsDisabled))}</Paragraph>
      <Paragraph>{L.minutes(minutesList)}</Paragraph>
      <Paragraph>{T.orderHeadings.late}</Paragraph>
      <Paragraph>{L.outside(minutes === null || minutes.withoutReceipt > 0 ? T.notRecorded : String(minutes.outside))}</Paragraph>
      <Paragraph>{L.open(minutes === null ? T.notRecorded : String(minutes.open))}</Paragraph>
      <Paragraph>{L.annex3(byGround(ANNEX3_GROUNDS, orders.annex3))}</Paragraph>
      <Paragraph>{T.orderHeadings.scrutiny}</Paragraph>
      <Paragraph>{orders.scrutiny === null ? L.scrutiny(T.notRecorded, T.notRecorded, T.notRecorded) : L.scrutiny(String(orders.scrutiny.requested), String(orders.scrutiny.annulled), String(orders.scrutiny.upheld))}</Paragraph>
      <Paragraph>{L.reinstated(byGround(ORDER_GROUNDS, orders.reinstated))}</Paragraph>
      <Paragraph>{T.orderHeadings.own}</Paragraph>
      <Paragraph>{L.terrorist(String(orders.terroristWithoutOrder))}</Paragraph>
      <Paragraph>{L.access(figure(orders.authorityAccess))}</Paragraph>
      <Paragraph>{L.referrals(String(orders.referralsClosed))}</Paragraph>
    </View>
  );
}

/** The tables of one version's figures, in W.2's order, then the order section, the standing sentence and the recipients. */
export function FiguresView({ year, figures }: { year: number; figures: TransparencyFigures }) {
  const r = figures.restrictions;
  const findings = labelled(figures.automated.findings, T.labels.findings, T.labels.other);
  const programs = [...findings, ...labelled(figures.automated.measures, T.labels.measures, T.labels.other)];
  const month = recipientsMonth(year);
  const recipients = figures.recipients;
  return (
    <View>
      <Table
        title={T.tables.byGround}
        rows={r.byGround.length === 0 ? [] : [...labelled(r.byGround, (key) => (key === "law" ? T.labels.law : T.labels.ground(key)), T.labels.otherGrounds), { label: T.labels.allRestrictions, count: r.total }]}
      />
      <Table title={T.tables.byMeasure} rows={labelled(r.byMeasure, T.labels.measure, T.labels.otherMeasures)} />
      <Table title={T.tables.noBreach} rows={[{ label: T.labels.noBreach, count: figures.noBreach }]} />
      <Table title={T.tables.intakes} rows={labelled(figures.intakes, (key) => T.labels.intakes[key] ?? key, T.labels.other)} />
      <Table title={T.tables.appeals} rows={labelled(figures.appeals, (key) => T.labels.appeals[key] ?? key, T.labels.other)} />
      <Table title={T.tables.reexaminations} rows={labelled(figures.reexaminations, (key) => T.labels.reexaminations[key] ?? key, T.labels.other)} />
      <Table title={T.tables.accountMeasures} rows={labelled(figures.accountMeasures, T.labels.measure, T.labels.otherMeasures)} />
      <Table title={T.tables.automated} rows={programs} />
      {figures.automated.r1 ? <Paragraph>{T.autoRate(figures.automated.r1.base, figures.automated.r1.restricted)}</Paragraph> : findings.length > 0 ? <Paragraph>{T.autoFew}</Paragraph> : null}
      {figures.uploads ? <Table title={T.tables.uploads} rows={labelled(figures.uploads, (key) => T.labels.uploads[key] ?? key, T.labels.other)} /> : null}
      {figures.orders ? <OrdersSection orders={figures.orders} /> : null}
      <Paragraph>{T.ordersHeld}</Paragraph>
      <Heading level={3}>{T.recipientsHeading}</Heading>
      <Paragraph>
        {recipients === "not recorded" ? T.recipientsNotRecorded(month) : recipients.high === undefined ? T.recipientsOff(month, recipients.low) : T.recipients(month, recipients.low, recipients.high)}
      </Paragraph>
    </View>
  );
}

/** An older version of a year: its line, and its figures opened in place. */
function OlderVersion({ year, older }: { year: number; older: Edition["older"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Paragraph>{T.versionLine(older.version, older.publishedOn, older.replacedOn)}</Paragraph>
      <Pressable accessibilityRole="button" aria-expanded={open} onPress={() => setOpen(!open)} className={PAGE_BUTTON}>
        <Text tone="accent" className="underline decoration-1 underline-offset-2 web:group-hover:decoration-2">
          {open ? T.hideVersion : T.showVersion}
        </Text>
      </Pressable>
      {open ? <FiguresView year={year} figures={older.figures} /> : null}
    </View>
  );
}

/** One year's section (9.3 item 2): its newest version, why that version was made, and its older versions. */
function EditionView({ edition, newest }: { edition: Edition; newest: boolean }) {
  return (
    <View>
      <Heading level={2}>{String(edition.year)}</Heading>
      <Paragraph>{T.edition(edition.year, edition.version, edition.publishedOn, edition.method)}</Paragraph>
      {edition.reason === "hold_ended" ? <Paragraph>{T.reason.hold_ended}</Paragraph> : null}
      {edition.reason === "correction" ? <Paragraph>{T.reason.correction(edition.publishedOn)}</Paragraph> : null}
      <FiguresView year={edition.year} figures={edition.figures} />
      {edition.older.length > 0 ? (
        <View>
          <Paragraph>{T.versions}</Paragraph>
          {edition.older.map((older) => (
            <OlderVersion key={older.version} year={edition.year} older={older} />
          ))}
        </View>
      ) : null}
      {newest ? <Paragraph>{T.method(edition.method)}</Paragraph> : null}
    </View>
  );
}

type HeadDay = PublicHead["days"][number];

/** A day before another, as the page prints a day. */
const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);

/** One line of the head's section: a published row, or a day between two shown days that has no head value. */
type HeadLine = { kind: "row"; row: HeadDay } | { kind: "missing"; day: string };

/**
 * The section's lines (9.3 item 6): the rows newest first as the route gives them, and [tr.headMissing] for each day
 * between the newest and the oldest shown day that has no head value, after that day's restore row when it has one. A
 * day after the newest row is not shown as missing: its value may not be published yet.
 */
export function headLines(days: readonly HeadDay[]): HeadLine[] {
  const lines: HeadLine[] = [];
  const valued = new Set(days.filter((row) => row.kind === "head").map((row) => row.day));
  const newest = days[0]?.day;
  const oldest = days.at(-1)?.day;
  if (newest === undefined || oldest === undefined) return lines;
  for (let day = newest; day >= oldest; day = dayBefore(day)) {
    for (const row of days) if (row.day === day) lines.push({ kind: "row", row });
    if (!valued.has(day)) lines.push({ kind: "missing", day });
  }
  return lines;
}

/** A day's proof saved as <day>.tsr: the token as the authority sent it, the TimeStampResp that openssl reads. */
function saveProof(day: string, token: string) {
  const bytes = Uint8Array.from(atob(token), (char) => char.charCodeAt(0));
  saveBlob(new Blob([bytes], { type: "application/timestamp-reply" }), `${day}.tsr`);
}

/**
 * Section 6, the audit log's daily value (3d design, section 9.3 item 6; W.2; Task 5): [tr.head], then a row a day,
 * newest first, with its value and who witnessed it, a restore's row with [tr.restore], a retired value with
 * [tr.retired] and a day without a value with [tr.headMissing]; while a shown row has an outside authority's proof (review
 * L15: never a test adapter's), [tr.verify] with the newest such day's value and file, and each such proof to download on
 * the web. When the route did not answer, this part alone
 * reads [page.down]. The place is in no answer and on no row.
 */
function HeadSection({ head, keeper }: { head: PublicHead | "loading" | "down"; keeper: boolean | null }) {
  const T = TRANSPARENCY_PAGE;
  // 3d review L15 (people13): only an outside timestamp authority's proof can be checked; a test adapter's token proves
  // nothing, so it turns on neither [tr.verify] nor a download.
  const checkable = (row: HeadDay) => row.token !== null && row.witness === "rfc3161";
  const witnessed = head === "loading" || head === "down" ? undefined : head.days.find(checkable);
  // 3d review M13: the keeper's sentence only while the facts say a keeper's address is set; neither until they answer.
  const keeperSentence = keeper === null ? "" : ` ${keeper ? T.headKeeper : T.headNoKeeper}`;
  return (
    <View>
      <Heading level={2}>{T.headHeading}</Heading>
      <Paragraph>{`${T.head}${keeperSentence}`}</Paragraph>
      {head === "loading" ? null : head === "down" ? (
        <Paragraph>{PAGE_DOWN}</Paragraph>
      ) : head.days.length === 0 ? (
        <Paragraph>{T.headNone}</Paragraph>
      ) : (
        // A dated list, newest first; each day's value in the mono face, which breaks anywhere rather than run off the page.
        <View role="list" aria-label={T.headHeading} className="mt-4 border-l-2 border-line-low">
          {headLines(head.days).map((line) =>
            line.kind === "missing" ? (
              <View key={`${line.day}-missing`} role="listitem" className="pb-3 pl-4">
                <Text tone="medium">{T.headMissingRow(line.day)}</Text>
              </View>
            ) : (
              <View key={`${line.row.day}-${line.row.kind}`} role="listitem" className="pb-3 pl-4">
                <Text variant="mono" tone="medium" className="web:break-all">
                  {line.row.kind === "restore"
                    ? T.restore(line.row.day, line.row.lastDay)
                    : line.row.retiredOn === null
                      ? T.headRow(line.row.day, line.row.value, line.row.witness)
                      : `${T.headRow(line.row.day, line.row.value, line.row.witness)} ${T.retired(line.row.retiredOn)}`}
                </Text>
                {checkable(line.row) && Platform.OS === "web" ? (
                  <Pressable accessibilityRole="button" onPress={() => saveProof(line.row.day, line.row.token!)} className={PAGE_BUTTON}>
                    <Text tone="accent" className="underline decoration-1 underline-offset-2 web:group-hover:decoration-2">
                      {T.download(line.row.day)}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ),
          )}
        </View>
      )}
      {witnessed ? <Paragraph>{T.verify(witnessed.value, witnessed.day)}</Paragraph> : null}
    </View>
  );
}

/**
 * The transparency page as it reads with the editions and the head's values it was given (3d design, section 9.3; W.2).
 * It shows what the stored editions hold and never a live count: no year section for the running year, and [tr.none]
 * while no edition exists. When a route did not answer, the fixed texts stand and that route's part alone reads
 * [page.down]. UI Task 7 (section 8.9): the page's title is the screen's ScreenHeader; here the lead and the sections
 * in the reading layout of components/Prose.tsx.
 */
export function TransparencyView({ answer, head = "loading", keeper = null }: { answer: PublicTransparency | "loading" | "down"; head?: PublicHead | "loading" | "down"; keeper?: boolean | null }) {
  return (
    <View>
      <Paragraph tone="high">{T.lead}</Paragraph>
      <Paragraph>{T.read}</Paragraph>
      {answer === "loading" ? null : answer === "down" ? (
        <Paragraph>{PAGE_DOWN}</Paragraph>
      ) : answer.editions.length === 0 ? (
        <Paragraph>{T.none}</Paragraph>
      ) : (
        answer.editions.map((edition, index) => <EditionView key={edition.year} edition={edition} newest={index === 0} />)
      )}
      <HeadSection head={head} keeper={keeper} />
      <Heading level={2}>{T.tdbHeading}</Heading>
      <Paragraph>{T.tdb}</Paragraph>
      <TextLink label={T.rulesLink} href="/rules" />
      <TextLink label={T.exploreLink} href="/explore/about" />
    </View>
  );
}

/**
 * /transparency (3d design, sections 9.1 and 9.3), public, signed in or out: it reads no session for its content and
 * sends two GETs, /api/public/transparency and (Task 5) /api/public/head, each of which may be an hour old: nothing in
 * them changes within a day. Each fails alone: the other part still shows. 3d review M13: and a third, /api/public/facts,
 * for whether a keeper's address is set, which alone lets [tr.head] say the value goes to a keeper.
 */
export default function TransparencyPage() {
  const [answer, setAnswer] = useState<PublicTransparency | "loading" | "down">("loading");
  const [head, setHead] = useState<PublicHead | "loading" | "down">("loading");
  const [keeper, setKeeper] = useState<boolean | null>(null);
  const title = usePageTitle("title.transparency");
  useEffect(() => {
    let live = true;
    api("/api/public/facts", { schema: PublicFacts })
      .then((read) => {
        if (live) setKeeper(read.keeper);
      })
      .catch(() => {
        // Without the facts the page says neither sentence about the keeper.
        if (live) setKeeper(null);
      });
    api("/api/public/transparency", { schema: PublicTransparency })
      .then((read) => {
        if (live) setAnswer(read);
      })
      .catch(() => {
        if (live) setAnswer("down");
      });
    api("/api/public/head", { schema: PublicHead })
      .then((read) => {
        if (live) setHead(read);
      })
      .catch(() => {
        if (live) setHead("down");
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <AppShell>
      {title}
      <ScreenHeader title={T.title} />
      <ScreenScroll screen="transparency">
        <TransparencyView answer={answer} head={head} keeper={keeper} />
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/ScreenHeader.tsx` (whole file)

```tsx
import { useEffect, useRef, type ReactNode } from "react";
import { Platform, ScrollView, View, type ViewProps } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useShellScroll } from "@/lib/shell-scroll";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { dataAttribute } from "./kit/interaction";
import { IconButton } from "./kit/IconButton";
import { Text } from "./kit/Text";

/**
 * The bar at the top of a screen inside the shell (UI design, sections 7.2 and 7.3): Back when the screen sits below a
 * tab (an IconButton named "Back"), the screen's title in display-2 as its one level-1 heading, and the screen's own
 * controls under it. On a phone it floats over the list on the page's surface with a line-low rule, slides up out of
 * view as the list scrolls down past it and returns on any scroll up or when the focus enters it (lib/shell-scroll.tsx;
 * under reduced motion it stays); the list starts below it (HeaderSpace, and the list's own top padding). From 768 px it
 * sits above the list and stays, with the rule drawn once the list has scrolled.
 */
export function ScreenHeader({ title, back, children }: { title: string; back?: Href; children?: ReactNode }) {
  const scroll = useShellScroll();
  const insets = useSafeAreaInsets();
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: scroll.headerY.value }] }));
  // Back goes where the reader came from, or, opened from an address, to the screen above this one.
  const goBack = () => {
    if (back === undefined) return;
    if (router.canGoBack()) router.back();
    else router.replace(back);
  };
  // react-native-web hands focus events to a View, and they bubble from the controls inside it; the types of React
  // Native's View do not list them.
  const focusable = { onFocus: scroll.showHeader } as ViewProps;
  const bar = (
    <View
      {...focusable}
      className={cn(
        "gap-1 border-b bg-surface px-4 pb-3 pt-3 web:transition-colors web:duration-150",
        scroll.phone || scroll.scrolled ? "border-line-low" : "border-transparent",
      )}
      // The status bar's height on native; the web's insets are the browser's own.
      style={Platform.OS === "web" ? undefined : { paddingTop: insets.top + 12 }}
    >
      <View className="min-h-[44px] flex-row items-center gap-1">
        {back !== undefined ? (
          <View className="-ml-3">
            <IconButton icon="back" label={UI_WORDS["shell.back"]} onPress={goBack} tone="high" />
          </View>
        ) : null}
        {/* The title wraps, and at the largest text a long word breaks, rather than pushing the page sideways. */}
        <Text as="h1" variant="display-2" className="min-w-0 flex-1 web:hyphens-auto web:break-words">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
  if (!scroll.phone) return bar;
  return (
    <Animated.View
      nativeID="screen-header"
      onLayout={(event) => scroll.setHeaderHeight(event.nativeEvent.layout.height)}
      style={[{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }, slide]}
    >
      {bar}
    </Animated.View>
  );
}

/** The room the floating phone header takes above content that is not a list (skeleton rows while a screen loads). */
export function HeaderSpace() {
  const scroll = useShellScroll();
  return scroll.headerSpace > 0 ? <View style={{ height: scroll.headerSpace }} /> : null;
}

/**
 * A screen that is not a list, under its ScreenHeader (UI Task 7: the moderation screens and the public pages): a scroll
 * view that tells the shell how it scrolls, as List does, so the phone's header hides and returns and the soft reset
 * brings it to its top; it starts below the floating header. Its column is a readable 640 px at most (8.9), its
 * gutter the header's 16 px, so the title and the text start on one line, and it carries `data-screen`, which the
 * browser check holds to the kit's rules. A `flush` column has no gutter, for rows that carry their own (ListRow's).
 */
export function ScreenScroll({ screen, flush = false, children }: { screen: string; flush?: boolean; children: ReactNode }) {
  const scroll = useShellScroll();
  const view = useRef<ScrollView>(null);
  useEffect(() => scroll.register({ toTop: (animated) => view.current?.scrollTo({ y: 0, animated }) }), [scroll.register]);
  return (
    <ScrollView ref={view} onScroll={scroll.onScroll} scrollEventThrottle={16} contentContainerStyle={scroll.headerSpace > 0 ? { paddingTop: scroll.headerSpace } : undefined}>
      <View {...dataAttribute("screen", screen)} className={cn("w-full max-w-[640px] pb-16 pt-2", flush ? undefined : "px-4")}>
        {children}
      </View>
    </ScrollView>
  );
}
```

### Replace `apps/app/src/components/kit/PublicFrame.tsx` (whole file)

```tsx
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Link, type Href } from "expo-router";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { FOCUS_RING } from "./interaction";
import { Text } from "./Text";

/**
 * The frame of the pages outside the app's shell (UI design, section 7.3): the sign-in flow, the three token pages and
 * the terms, so they no longer look like another app. The wordmark at the top leads to /, the content is the page's
 * main landmark in a column 440 px wide (640 px with `wide`, for the terms), and the footer links the public pages. The
 * page's body does not scroll on the web (public/index.html), so the frame scrolls itself. The terms are its first
 * screen (UI Task 7); Task 8 moves the sign-in flow and the token pages in.
 */
const FOOTER: { label: string; href: Href }[] = [
  { label: UI_WORDS["frame.rules"], href: "/rules" },
  { label: UI_WORDS["frame.transparency"], href: "/transparency" },
  { label: UI_WORDS["frame.terms"], href: "/terms" },
];

/**
 * A link of the frame: a 44 by 44 px target at least around its words (a short word such as "Terms" is narrower than
 * that at the default size, UI Task 7), dimmed while pressed, underlined under a fine pointer.
 */
const LINK = cn("group min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-1 active:opacity-70", FOCUS_RING);

export function PublicFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  // The column's width is a style, not a class, so a test can read it from the markup.
  const column = { width: "100%", maxWidth: wide ? 640 : 440 } as const;
  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="min-h-full items-center px-4">
      <View role="banner" className="items-center py-6" style={column}>
        <Link href="/" asChild>
          <Pressable className={LINK}>
            <Text variant="display-1">{UI_WORDS["frame.wordmark"]}</Text>
          </Pressable>
        </Link>
      </View>
      <View role="main" className="flex-1" style={column}>
        {children}
      </View>
      <View role="contentinfo" className="flex-row flex-wrap justify-center gap-x-4 border-t border-line-low py-6" style={column}>
        {FOOTER.map((link) => (
          <Link key={String(link.href)} href={link.href} asChild>
            <Pressable className={LINK}>
              <Text variant="meta" tone="medium" className="web:group-hover:underline">
                {link.label}
              </Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  );
}
```

### Replace `apps/app/src/components/kit/StatusChip.tsx` (whole file)

```tsx
import { cva } from "class-variance-authority";
import type { Ref } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { usePressScale } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { Icon } from "./Icon";
import { FOCUS_RING } from "./interaction";
import { Text, type Tone } from "./Text";

/**
 * A status as a chip (UI design, sections 4.8 and 6.13): the tone's wash, its own icon and its words, so it reads in
 * greyscale, to a screen reader and to a colour-blind reader alike; the colour only repeats what the words say. A chip is
 * never a coloured dot, and its words wrap rather than being cut. Three forms, by what it does:
 *   - information only (no href, no onPress): an image named by its label, or by `name` where the visible word needs
 *     more words to be understood (VerifiedChip shows "Verified" and is named "verified account");
 *   - a link (`href`): an anchor named by its words (In Explore, to its post);
 *   - a button (`onPress`): the author's moderation chip, which opens the details sheet, so it says it opens a dialog and
 *     ends in a chevron that makes it look pressable.
 */
export const STATUS_TONES = ["review", "restricted", "verified", "explore"] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

/** Each tone's own icon, four different drawings (section 4.7): a clock, an eye struck through, a badge, a compass. */
export const STATUS_ICON: Record<StatusTone, IconName> = { review: "review", restricted: "restricted", verified: "verified", explore: "explore" };

const ON_WASH: Record<StatusTone, Tone> = { review: "review-on-wash", restricted: "restricted-on-wash", verified: "verified-on-wash", explore: "explore-on-wash" };

/**
 * The wash with a 1 px border in the tone's ink at 40 percent (4.8), solid CanvasText under forced colours, where the
 * browser removes backgrounds and the border alone keeps the shape. A chip that does something shows its border in full
 * ink under a fine pointer.
 */
const chip = cva("max-w-full flex-row items-center gap-1 self-start rounded-full border px-2 py-0.5 web:forced-colors:border-[color:CanvasText]", {
  variants: {
    tone: {
      review: "border-review-ink/40 bg-review-wash web:group-hover:border-review-ink",
      restricted: "border-restricted-ink/40 bg-restricted-wash web:group-hover:border-restricted-ink",
      verified: "border-verified-ink/40 bg-verified-wash web:group-hover:border-verified-ink",
      explore: "border-explore-ink/40 bg-explore-wash web:group-hover:border-explore-ink",
    },
  },
});

interface StatusChipProps {
  tone: StatusTone;
  /** The chip's words, never empty: chipText(), "In Explore", "Verified". */
  label: string;
  /** The name of the information-only form, when it says more than the visible words. */
  name?: string;
  href?: Href;
  onPress?: () => void;
  /** Where the chip sits in its parent, such as self-center beside a display name. */
  className?: string;
  /** The button form's pressable, which takes the focus back when the sheet it opened has closed (UI Task 7). */
  ref?: Ref<View>;
}

/** The drawn chip: icon, words that wrap, and the button form's chevron. */
function Face({ tone, label, chevron }: { tone: StatusTone; label: string; chevron: boolean }) {
  return (
    <View className={chip({ tone })}>
      <Icon name={STATUS_ICON[tone]} size={14} tone={ON_WASH[tone]} />
      {/* At the largest text on the narrowest phone a single word can be wider than the chip: it breaks rather than clip. */}
      <Text variant="chip" tone={ON_WASH[tone]} className="min-w-0 shrink web:break-words">
        {label}
      </Text>
      {chevron ? <Icon name="next" size={14} tone={ON_WASH[tone]} /> : null}
    </View>
  );
}

export function StatusChip({ tone, label, name, href, onPress, className, ref }: StatusChipProps) {
  const press = usePressScale(0.97);
  if (href === undefined && onPress === undefined) {
    return (
      <View role="img" accessibilityLabel={name ?? label} className={cn("max-w-full", className)}>
        <Face tone={tone} label={label} chevron={false} />
      </View>
    );
  }
  // A chip that does something is a control: its target is 44 px tall around the drawn chip (section 4.4). The pressed
  // scale moves the Animated.View, which takes no classes on the web, so the placement sits on a View around it.
  const target = cn("group min-h-[44px] max-w-full justify-center rounded-control", FOCUS_RING);
  return (
    <View className={cn("max-w-full", className)}>
      <Animated.View style={press.style}>
        {href !== undefined ? (
          <Link href={href} asChild>
            <Pressable {...press.handlers} className={target}>
              <Face tone={tone} label={label} chevron={false} />
            </Pressable>
          </Link>
        ) : (
          <Pressable ref={ref} accessibilityRole="button" aria-haspopup="dialog" onPress={onPress} {...press.handlers} className={target}>
            <Face tone={tone} label={label} chevron />
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}
```

### Replace `apps/app/src/components/moderation/CasesLists.tsx` (whole file)

```tsx
import { View } from "react-native";
import { MEASURES, type AccountStanding, type AuthorCaseRow, type AuthorNoticesPage, type ReportItem, type ReportsPage } from "@korbat/contracts";
import { ListRow } from "@/components/kit/ListRow";
import { Text } from "@/components/kit/Text";
import { Button, ErrorText } from "@/components/ui";
import { utcMinute } from "@/lib/moderation";
import { AUTO_WORDS, CASES_WORDS, RELEASE_TEXTS, UPLOAD_TEXTS } from "@/lib/moderation-words";
import { ORDER_TEXTS } from "@/lib/orders";
import { CASE_ROW_WORDS, bannerSentences, reportingLine, rowStrike, STANDING_TEXTS } from "@/lib/standing";
import { ItemLines } from "./ItemLines";

/** 3e: the kinds whose words in a row are the row's own (9.4), not the measure's label. */
const ROW_KINDS: Partial<Record<AuthorCaseRow["actions"][number], string>> = {
  overrule: CASE_ROW_WORDS.overrule,
  retire_handle: CASE_ROW_WORDS.retired,
  unretire_handle: CASE_ROW_WORDS.unretired,
  suspend: CASE_ROW_WORDS.suspended,
  lift_suspension: CASE_ROW_WORDS.lifted,
  // Task 5: a warning about the account's reports, and the lift of either reporting measure.
  warn_reporting: CASE_ROW_WORDS.warned,
  lift_reporting: CASE_ROW_WORDS.reportingLifted,
};

/**
 * 3e's review (people7; design, section 9.4): a suspension's or a termination's row and a lift's, in the row's own words
 * when the row says what they were: a suspension with its days and kind, a termination, a withdrawal for another measure,
 * the lift of a termination.
 */
function standingWords(row: AuthorCaseRow, kind: AuthorCaseRow["actions"][number]): string | null {
  const measure = row.standingMeasure;
  if ((kind === "suspend" || kind === "terminate") && measure !== undefined) {
    return measure.kind === "terminate" || measure.days === null ? CASE_ROW_WORDS.terminated : CASE_ROW_WORDS.suspendedFor(measure.days, measure.announced);
  }
  const lifted = row.liftedStanding;
  if (kind === "lift_suspension" && lifted !== undefined) return lifted.replaced ? CASE_ROW_WORDS.withdrawn : lifted.kind === "terminate" ? CASE_ROW_WORDS.terminationLifted : CASE_ROW_WORDS.lifted;
  return null;
}

/**
 * What a decision did, in the measures' own labels; a decision without a measure ended what was done while deciding, or
 * took no action. A review that kept the decision is worded by its outcome first: it lifts nothing, and the restriction
 * it answered stands; and so is a kept correction (3e's review, people3), korbat's answer to a reply that kept the
 * suspension or termination, which holds no row of its own.
 */
function done(row: AuthorCaseRow, now: Date): string {
  // 3f (design, section 9.3): an order's notice and the reinstatement after one, in the row's own words.
  if (row.order !== undefined) return ORDER_TEXTS.row[row.order];
  if ((row.kind === "review" || row.kind === "correction") && row.outcome === "kept") return CASES_WORDS.keptDecision;
  // 3e (design, section 9.4): a strike is named with where it stands, its overruling, a retirement and its reversal in
  // the row's own words.
  const labels: string[] = row.actions.map((kind) =>
    kind === "strike" && row.strike
      ? rowStrike(row.strike, now)
      : kind === "restrict_reporting" && row.reportingDays !== undefined
        ? CASE_ROW_WORDS.restricted(row.reportingDays)
        : (standingWords(row, kind) ?? ROW_KINDS[kind] ?? MEASURES[kind].label),
  );
  // Task 5: a reversal that ended a restriction of reporting resting on the decision it reversed says so; and (3e's
  // review, people7) one that ended a suspension or a termination.
  for (const ended of ["suspend", "terminate"] as const) if ((row.endedStanding ?? []).includes(ended)) labels.push(CASE_ROW_WORDS.standingEnded[ended]);
  if ((row.endedStanding ?? []).includes("restrict_reporting")) labels.push(CASE_ROW_WORDS.restrictionEnded);
  if (row.endedInterim) labels.push(CASES_WORDS.ended);
  return labels.length > 0 ? labels.join(", ") : CASES_WORDS.noAction;
}

/** Which kind of decision it is, where that is not plain from what it did. */
function kindWords(row: AuthorCaseRow): string | null {
  if (row.kind === "interim") return CASES_WORDS.whileDeciding;
  if (row.kind === "review") return CASES_WORDS.review;
  if (row.kind === "correction") return CASES_WORDS.correction;
  return null;
}

/**
 * "About you" (3c design, section 9): the decisions about the account that its holder was told of, newest first. Each
 * row is a link to the decision's screen and says what it is about (the post, by its creation time, or the profile), the
 * decision's day, what was done, the rule or the law, and where its appeal stands. UI Task 7 (section 8.7): a vertical
 * list of ListRow links, dated, each its title in body-strong over its lines, with the row's chevron.
 */
export function DecisionsList({ decisions, now = new Date() }: { decisions: readonly AuthorCaseRow[]; now?: Date }) {
  if (decisions.length === 0) {
    return (
      <Text tone="medium" className="px-4 py-8">
        {CASES_WORDS.noDecisions}
      </Text>
    );
  }
  return (
    <View role="list">
      {decisions.map((row) => {
        const kind = kindWords(row);
        const lines = [
          // 3d Task 6 (section 9.6): a decision a program took says so; a person's later decision is its own row.
          row.byProgram === true ? AUTO_WORDS.row(done(row, now)) : done(row, now),
          // 3f: an order's row names no rule and no law of korbat's judgement.
          row.order === undefined && (row.ruleId || row.legal) ? (row.ruleId ? CASES_WORDS.rule(row.ruleId) : CASES_WORDS.law) : null,
          row.appealUntil ? CASES_WORDS.appealOpen(utcMinute(row.appealUntil)) : null,
          row.appeal ? CASES_WORDS.appealState[row.appeal] : null,
          row.reversedOn ? CASES_WORDS.reversed(row.reversedOn) : null,
        ];
        return (
          <View key={row.id} role="listitem">
            <ListRow
              label={row.post ? CASES_WORDS.post(utcMinute(row.post.createdAt)) : CASES_WORDS.profile}
              href={`/settings/cases/${row.id}`}
              detail={
                <View className="gap-0.5">
                  <Text variant="meta" tone="low">
                    {/* 3f's review (people9): an order's row shows the day its author was told, which the list sorts it by. */}
                    {row.toldOn !== undefined ? ORDER_TEXTS.row.toldOn(row.toldOn) : CASES_WORDS.decidedOn(row.decidedOn)}
                    {kind ? ` (${kind})` : ""}
                  </Text>
                  {lines.map((line, index) =>
                    line === null ? null : (
                      <Text key={index} variant="meta" tone={index === 0 ? "high" : "medium"}>
                        {line}
                      </Text>
                    ),
                  )}
                </View>
              }
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * 3d Task 2 (design, section 9.6): the notices about the account's posts that are not decisions, in "About you" above
 * its decisions, newest first: "Sealed images released", each with its day and a link to its notice; 3d Task 7: "An
 * upload was not accepted" for a refused upload. A release whose
 * notice may not be told yet is in no answer, so it is in no list. Nothing is shown while there is none.
 */
export function NoticesList({ notices }: { notices: AuthorNoticesPage["notices"] }) {
  if (notices.length === 0) return null;
  return (
    <View className="pt-4">
      <Text as="h2" variant="title" className="px-4 pb-1">
        {RELEASE_TEXTS.noticesTitle}
      </Text>
      {notices.map((notice) =>
        // 3d Task 7 (9.6): a refused upload's entry leads to its notice, a release's to its own.
        notice.kind === "upload_refused" ? (
          <ListRow key={notice.id} label={UPLOAD_TEXTS.entry} description={UPLOAD_TEXTS.entryOn(notice.at.slice(0, 10))} href={`/settings/cases/uploads/${notice.id}`} />
        ) : (
          <ListRow key={notice.id} label={RELEASE_TEXTS.entry} description={RELEASE_TEXTS.entryOn(notice.at.slice(0, 10))} href={`/settings/cases/releases/${notice.id}`} />
        ),
      )}
    </View>
  );
}

/**
 * "Your standing" (3e design, section 9.4), above "About you": how many of the account's strikes count now, and what that
 * many leads to; then the line of a suspension or a termination that /me carries, not fixed yet, announced, held by a
 * reply or running, in the banner's words (3e's review, people7); and (Task 5) [cases.reporting]: a restriction of the
 * account's reports that runs, or a warning about them that counts.
 */
export function StandingBlock({ activeStrikes, standing = null }: { activeStrikes: number; standing?: AccountStanding | null }) {
  const measure = bannerSentences(standing);
  const reporting = reportingLine(standing);
  // A card of surface-1 above the list: it says where the account stands, in words; no status colour (section 4.8).
  return (
    <View className="mx-4 mt-4 gap-1 rounded-card border border-line-low bg-surface-1 px-4 py-3">
      <Text as="h2" variant="title">
        {STANDING_TEXTS.cases.title}
      </Text>
      <Text tone="medium">{activeStrikes > 0 ? STANDING_TEXTS.cases.strikes(activeStrikes) : STANDING_TEXTS.cases.none}</Text>
      {measure !== null ? <Text tone="medium">{measure.join(" ")}</Text> : null}
      {reporting !== null ? <Text tone="medium">{reporting}</Text> : null}
    </View>
  );
}

/**
 * "Your reports" (3c design, section 9): the account's reports with each item as the status page words it. When the
 * account's address stopped korbat's report mails (someone who holds it asked for that on a status page), the tab says so
 * above the list, with the button that resumes them: the outcomes are listed here either way. With `onReexamine` each
 * item whose answer can still be examined again carries "Ask for a re-examination", asked by the item's id.
 */
export function ReportsList({
  page,
  onResume,
  onReexamine,
  busy = false,
  error = null,
}: {
  page: Pick<ReportsPage, "reports" | "reportMailStopped">;
  onResume?: () => void;
  onReexamine?: (item: ReportItem, statement: string) => Promise<void>;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <View>
      {page.reportMailStopped ? (
        <View className="mx-4 mt-4 rounded-card border border-line-low bg-surface-1 px-4 pb-4 pt-3">
          <Text>{CASES_WORDS.mailStopped}</Text>
          <Button label={CASES_WORDS.resume} onPress={() => onResume?.()} busy={busy} tone="secondary" />
          <Text variant="meta" tone="medium" className="mt-2">
            {CASES_WORDS.resumeHint}
          </Text>
          <ErrorText message={error} />
        </View>
      ) : null}
      {page.reports.length === 0 ? (
        <Text tone="medium" className="px-4 py-8">
          {CASES_WORDS.noReports}
        </Text>
      ) : null}
      {page.reports.map((report) => (
        <View key={report.ref} className="border-b border-line-low px-4 pb-4 pt-4">
          <Text as="h2" variant="body-strong">
            {CASES_WORDS.report(report.ref, utcMinute(report.receivedAt))}
          </Text>
          <ItemLines items={report.items} onReexamine={onReexamine} />
        </View>
      ))}
    </View>
  );
}
```

### Replace `apps/app/src/components/moderation/DecisionDetail.tsx` (whole file)

```tsx
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { Pressable, View, type TextInput } from "react-native";
import { Link } from "expo-router";
import { OBJECTION_TEXT_MAX, STATEMENT_MAX, type DecisionAppeal, type DecisionContent, type DecisionStatement, type DecisionView } from "@korbat/contracts";
import { ORDER_NOTICE, statementParagraphs } from "@korbat/rules";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { Button, ErrorText, Field, Section } from "@/components/ui";
import { SEALED_IMAGE } from "@/components/social/HiddenImage";
import { clampRatio } from "@/components/social/MediaGrid";
import { API_BASE } from "@/lib/api";
import { errorMessage } from "@/lib/api";
import { appealWaitWords, CONTACT_EMAIL, dailyLimitFailure, utcMinute } from "@/lib/moderation";
import { AUTO_WORDS, CASES_WORDS, DECISION_WORDS } from "@/lib/moderation-words";
import { ORDER_TEXTS } from "@/lib/orders";
import { nowSentence, replyStandsLine, reportingNowLine, restsOnLine, STANDING_TEXTS, standingMeasureOf, strikeLine } from "@/lib/standing";
import { cn } from "@/theme/cn";
import { CaseLink, Line, Note } from "./parts";

/**
 * UI Task 7 (design, section 8.7): the decision's parts are cards (ui.tsx's Section, a card of surface-1 with its title
 * as a level-2 heading) holding labelled lines on the tokens; every sentence is the one the screen said before.
 */

/** One field of an account as korbat copied it: its label in body-strong, then the value. */
function FieldValue({ label, value }: { label: string; value: string }) {
  return (
    <Text className="mt-3">
      <Text variant="body-strong">{label}</Text> {value.length > 0 ? value : DECISION_WORDS.empty}
    </Text>
  );
}

/**
 * The content a decision was made on, or the reason it is not shown (3c design, section 7.6). A post's text is never
 * sealed, so it stands beside its sealed images, each drawn as the placeholder that tells the author nobody is shown it.
 * The images of a post its author deleted are kept for the case and shown to nobody. Every other image comes from the
 * app's own image route, which serves the author their withheld and removed images too.
 */
function Content({ content }: { content: DecisionContent }) {
  if (content.kind === "r4_redacted") return <Note>{DECISION_WORDS.r4Redacted}</Note>;
  if (content.kind === "erased") return <Note>{content.postKept ? `${DECISION_WORDS.erased(content.contentErasedOn)} ${DECISION_WORDS.postKept}` : DECISION_WORDS.erased(content.contentErasedOn)}</Note>;
  if (content.kind === "account") {
    return (
      <View>
        <FieldValue label={DECISION_WORDS.handle} value={`@${content.handle}`} />
        <FieldValue label={DECISION_WORDS.displayName} value={content.displayName} />
        <FieldValue label={DECISION_WORDS.bio} value={content.bio} />
      </View>
    );
  }
  return (
    <View>
      {content.deletedByAuthor ? <Note>{DECISION_WORDS.deleted}</Note> : null}
      {content.body.length > 0 ? <Line>{content.body}</Line> : <Note>{DECISION_WORDS.noText}</Note>}
      {content.imagesHidden === "sealed"
        ? Array.from({ length: content.imageCount }, (_, index) => (
            <View key={index} className="mt-3 items-center justify-center gap-2 rounded-media bg-surface-2 px-3 py-6">
              <Icon name="hidden" size={20} tone="medium" />
              <Text tone="medium" className="text-center">
                {SEALED_IMAGE}
              </Text>
            </View>
          ))
        : null}
      {content.imagesHidden === "deleted_by_author" && content.imageCount > 0 ? <Note>{DECISION_WORDS.deletedImages}</Note> : null}
      {content.images.map((image) => (
        <View key={image.id} className="mt-3">
          <View className="overflow-hidden rounded-media border border-line-low bg-surface-2" style={{ aspectRatio: clampRatio(image.width, image.height) }}>
            {/* On the web expo-image takes the <img alt> from accessibilityLabel, not from alt. */}
            <Image source={{ uri: `${API_BASE}${image.small}` }} contentFit="cover" accessibilityLabel={image.alt} style={{ width: "100%", height: "100%" }} />
          </View>
          <Text variant="meta" tone="medium" className="mt-1">
            {image.alt}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The statement's paragraphs, or null when this build's rulebook does not hold the version the decision was made under: it
 * is then never rendered as another. An order's notice (3f) reads its authority's words and its erasure fresh with it.
 */
function paragraphsOf(view: DecisionStatement & Partial<Pick<DecisionView, "orderTexts" | "erasedOn">>): string[] | null {
  try {
    return statementParagraphs(view, { texts: view.orderTexts ?? null, erasedOn: view.erasedOn ?? null });
  } catch {
    return null;
  }
}

/** The authority's words a notice holds, each under its label (W.2), in the order the notice names them. */
function authorityWords(view: DecisionView): { label: string; text: string }[] {
  const texts = view.orderTexts ?? null;
  if (texts === null) return [];
  const labelled: [string | null, string][] = [
    [texts.reasons, ORDER_NOTICE.reasonsLabel],
    [texts.redress, ORDER_NOTICE.redressLabel],
    [texts.scope, ORDER_NOTICE.scopeLabel],
  ];
  return labelled.flatMap(([text, label]) => (text === null ? [] : [{ label, text }]));
}

/**
 * 3f (design, section 9.3): the notice of an authority's order, and of the reinstatement after one. Its title says what it
 * is; its paragraphs are ORDER_NOTICE's, rendered by statementParagraphs from the statement's data read fresh; the
 * authority's words stand whole in a block of their own; the post is never shown while the order's measure stands; and no
 * appeal is offered: in its place, where the order can be challenged, how korbat's own mistake is put right, and that
 * the notice grows.
 */
function OrderNotice({ view }: { view: DecisionView }) {
  const paragraphs = paragraphsOf(view);
  const words = authorityWords(view);
  return (
    <View role="article">
      {/* UI Task 7: a level-2 heading, as the decision's own, under the screen's title "Cases", its one level-1 heading. */}
      <Text as="h2" variant="display-3">
        {ORDER_TEXTS.notice.title}
      </Text>
      {view.post ? (
        <Text tone="medium" className="mt-1">
          {DECISION_WORDS.post(utcMinute(view.post.createdAt))}
        </Text>
      ) : null}
      <View className="mt-2">{paragraphs ? paragraphs.map((paragraph, index) => <Line key={index}>{paragraph}</Line>) : <Note>{DECISION_WORDS.cannotRender}</Note>}</View>
      {words.length > 0 ? (
        <View role="group" aria-label={ORDER_NOTICE.wordsBlock} className="mt-6 rounded-card border border-line-high bg-surface-1 px-5 pb-4">
          <Text variant="body-strong" tone="medium" className="mt-4">
            {ORDER_NOTICE.wordsBlock}
          </Text>
          {words.map((entry) => (
            <View key={entry.label}>
              <Line strong>{entry.label}</Line>
              <Line>{entry.text}</Line>
            </View>
          ))}
        </View>
      ) : null}
      {view.content === null ? (
        // 3f's review (people5): a DSA order that does not withhold leaves the post to its author, and the note says so.
        <Note>{view.order?.withholdAuthor === false ? ORDER_TEXTS.notice.noContentRemoved : ORDER_TEXTS.notice.noContent}</Note>
      ) : (
        <Section title={DECISION_WORDS.content}>
          <Content content={view.content} />
        </Section>
      )}
      <Note>{ORDER_TEXTS.notice.noAppeal}</Note>
      {view.kind === "order" ? <Note>{ORDER_TEXTS.notice.wrongItem(CONTACT_EMAIL)}</Note> : null}
      <Note>{ORDER_TEXTS.notice.fresh}</Note>
    </View>
  );
}

/**
 * The appeal's form (3c design, section 9): an optional statement, free of form, and the button. The request is a POST
 * the screen sends; a refusal is worded under the button, and what was written stays.
 */
function AppealForm({ onAppeal, focus = false }: { onAppeal: (statement: string) => Promise<void>; focus?: boolean }) {
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<TextInput>(null);
  // UI Task 7 (section 8.7): opened from the details sheet's "Appeal" (?appeal=1), the field takes the focus once the
  // decision shows; the browser scrolls it into view.
  useEffect(() => {
    if (focus) field.current?.focus();
  }, [focus]);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAppeal(statement);
    } catch (err) {
      setError(dailyLimitFailure(err, "appeals"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Note>{DECISION_WORDS.appealHint}</Note>
      <Field ref={field} label={DECISION_WORDS.appealStatement} value={statement} onChangeText={setStatement} multiline maxLength={STATEMENT_MAX} />
      <Button label={DECISION_WORDS.appeal} onPress={() => void send()} busy={busy} />
      <ErrorText message={error} />
    </View>
  );
}

/**
 * An answered appeal: the day, and the statement of the decision that answered it (the review, or the correction that
 * reversed everything before a review came), rendered as every statement is, with a link to that decision's own screen.
 */
function AppealAnswer({ appeal }: { appeal: Extract<DecisionAppeal, { state: "answered" }> }) {
  const paragraphs = paragraphsOf(appeal.statement);
  return (
    <View>
      <Line strong>{DECISION_WORDS.appealAnswered(appeal.answeredOn)}</Line>
      <Note>{DECISION_WORDS.appealAnswer}</Note>
      {paragraphs ? paragraphs.map((paragraph, index) => <Line key={index}>{paragraph}</Line>) : <Note>{DECISION_WORDS.cannotRender}</Note>}
      <CaseLink href={`/settings/cases/${appeal.answeredBy}`} label={DECISION_WORDS.answerScreen} className="mt-3" />
    </View>
  );
}

/**
 * Where the appeal of a decision stands (3c design, sections 7.7 and 9), the first that applies: the answer to an appeal
 * that was answered; for one that waits, that it waits for a reviewer, or why nobody at korbat can review it now; while
 * none was filed, until when one can be, with the form when the screen can send it; or that a restriction reversed in
 * full leaves nothing to appeal.
 */
function Appeal({ view, onAppeal, focus = false }: { view: DecisionView; onAppeal?: (statement: string) => Promise<void>; focus?: boolean }) {
  const { appeal } = view;
  if (appeal?.state === "answered") return <AppealAnswer appeal={appeal} />;
  if (appeal?.state === "pending") {
    return (
      <View>
        <Line>{DECISION_WORDS.appealFiled(appeal.filedAt.slice(0, 10))}</Line>
        <Line strong>{appealWaitWords(view) ?? DECISION_WORDS.appealWaiting}</Line>
      </View>
    );
  }
  if (view.appealUntil) {
    return (
      <View>
        <Line>{DECISION_WORDS.appealUntil(utcMinute(view.appealUntil))}</Line>
        {onAppeal ? <AppealForm onAppeal={onAppeal} focus={focus} /> : null}
      </View>
    );
  }
  return <Line>{DECISION_WORDS.reversed(view.reversedOn ?? "")}</Line>;
}

/**
 * 3d Task 6 (design, sections 7.10 and 9.4): "Ask for a person" on a program's decision, from DecisionView.askPerson read
 * fresh: the button while the measure is in force and no request exists, which opens one field under [auto.askLead]; the
 * request as sent with korbat's published target ([auto.asked]); and once a person has decided, [auto.decided] with a
 * link to that decision. A refusal is worded under the button and what was written stays; objection_not_open reads as
 * [auto.decided] without the day. A suspended account can ask: nothing here reads its standing.
 *
 * UI Task 7: exported for the details sheet (StatusSheet), which offers it as this screen does; there it is not
 * `framed` (it stands in the sheet's own Appeal block) and its link closes the sheet first (`onLeave`).
 */
export function AskPerson({ view, onAsk, framed = true, onLeave }: { view: DecisionView; onAsk?: (text: string) => Promise<void>; framed?: boolean; onLeave?: (href: string) => void }) {
  const ask = view.askPerson ?? null;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (ask === null) return null;

  async function send() {
    if (busy || onAsk === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await onAsk(text);
    } catch (err) {
      // objection_not_open and rate_limited in the app's own words (9.7), anything else as elsewhere.
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      {ask.state === "asked" ? (
        <View>
          <Line strong>{AUTO_WORDS.asked(utcMinute(ask.createdAt))}</Line>
          <Line>{ask.text}</Line>
        </View>
      ) : null}
      {ask.state === "decided" ? (
        <View>
          <Line strong>{AUTO_WORDS.decided(utcMinute(ask.decidedAt))}</Line>
          <DecisionLink id={ask.decisionId} label={AUTO_WORDS.decidedLink} onLeave={onLeave} />
        </View>
      ) : null}
      {ask.state === "open" && onAsk !== undefined ? (
        open ? (
          <View>
            <Note>{AUTO_WORDS.askLead}</Note>
            <Field label={AUTO_WORDS.askField} value={text} onChangeText={setText} multiline maxLength={OBJECTION_TEXT_MAX} />
            <Button label={AUTO_WORDS.ask} onPress={() => void send()} busy={busy} />
            <ErrorText message={error} />
          </View>
        ) : (
          <Button label={AUTO_WORDS.ask} onPress={() => setOpen(true)} />
        )
      ) : null}
    </>
  );
  return framed ? <Section title={AUTO_WORDS.ask}>{content}</Section> : <View>{content}</View>;
}

/** A link to another decision's screen, as a line of its own. */
function DecisionLink({ id, label, onLeave }: { id: string; label: string; onLeave?: (href: string) => void }) {
  return <CaseLink href={`/settings/cases/${id}`} label={label} onLeave={onLeave} className="mt-2" />;
}

/** The states in which a measure ended before its time, by a decision the block links to. */
const ENDED_BY_A_DECISION = new Set(["never", "lifted", "basis_ended"]);

/**
 * 3e Task 4 (design, section 9.2): "Where it stands now", under the statement of a decision that holds a suspension or a
 * termination, from DecisionView.standing read fresh: the sentence of its state, with a link to the decision that ended
 * it before its time; the strikes it rests on (or the decision, for a measure taken at once), each a link to its own
 * screen; "Reply" while the reply is open; and once the person replied, their text while korbat keeps it and where the
 * reply stands.
 */
function StandingNow({ view }: { view: DecisionView }) {
  const standing = view.standing;
  const measure = standingMeasureOf(view);
  if (standing === null || measure === null) return null;
  const protective = measure.basis === "protective";
  const strikes = standing.restsOn.filter((entry) => entry.state !== null);
  const decisions = standing.restsOn.filter((entry) => entry.state === null);
  const reply = standing.reply;
  const stands = replyStandsLine(standing);
  return (
    <Section title={STANDING_TEXTS.now.title}>
      <Line strong>{nowSentence(standing, measure.kind, protective, view.appealUntil)}</Line>
      {ENDED_BY_A_DECISION.has(standing.state) && standing.endedBy !== null ? <DecisionLink id={standing.endedBy} label={STANDING_TEXTS.now.endedBy} /> : null}
      {strikes.map((entry) => (
        <DecisionLink key={entry.decisionId} id={entry.decisionId} label={restsOnLine(entry)} />
      ))}
      {strikes.length > 0 ? <Note>{STANDING_TEXTS.rests.hint}</Note> : null}
      {decisions.map((entry) => (
        <DecisionLink key={entry.decisionId} id={entry.decisionId} label={protective ? STANDING_TEXTS.rests.seal(entry.decidedAt) : STANDING_TEXTS.rests.decision(entry.decidedAt)} />
      ))}
      {decisions.length > 0 ? <Note>{protective ? `${STANDING_TEXTS.rests.basis} ${STANDING_TEXTS.rests.basisProtective}` : STANDING_TEXTS.rests.basis}</Note> : null}
      {standing.replyOpen ? (
        <Link href={`/settings/cases/${view.id}/reply`} asChild>
          <Pressable accessibilityRole="button" className={cn("mt-4 min-h-[44px] justify-center self-start rounded-control border border-line-high bg-surface-1 px-4 py-2 active:bg-surface-2 web:hover:bg-surface-2", FOCUS_RING)}>
            <Text variant="body-strong">{STANDING_TEXTS.reply.button}</Text>
          </Pressable>
        </Link>
      ) : null}
      {reply ? (
        <View>
          <Line>{STANDING_TEXTS.reply.replied(reply.filedAt)}</Line>
          {reply.text !== null ? <Line>{reply.text}</Line> : reply.erasedAt !== null ? <Note>{STANDING_TEXTS.reply.erased(reply.erasedAt)}</Note> : null}
          {stands ? <Line>{stands.text}</Line> : null}
          {stands?.link ? <DecisionLink id={stands.link} label={STANDING_TEXTS.reply.answer} /> : null}
        </View>
      ) : null}
    </Section>
  );
}

/**
 * 3e Task 5 (design, section 9.2): "Where it stands now" under the statement of a decision that restricts the account's
 * reports, from DecisionView.reportingStanding read fresh, since it can end before its date: it runs, it ended, korbat
 * lifted it, or it ended with the warning it rested on; the last two link to the decision that did it.
 */
function ReportingNow({ view }: { view: DecisionView }) {
  const standing = view.reportingStanding ?? null;
  if (standing === null) return null;
  const line = reportingNowLine(standing);
  return (
    <Section title={STANDING_TEXTS.reporting.title}>
      <Line strong>{line.text}</Line>
      {line.link !== null ? <DecisionLink id={line.link} label={STANDING_TEXTS.now.endedBy} /> : null}
    </Section>
  );
}

/**
 * 3e Task 4 (design, section 9.2): what the appeal of a standing measure adds above D 9's control: [appeal.early] while an
 * announced measure has not started, [appeal.again] after a kept answer to a reply sent before the start, and
 * [terminate.delete] beside a termination's appeal.
 */
function StandingAppealNotes({ view }: { view: DecisionView }) {
  const standing = view.standing;
  const measure = standingMeasureOf(view);
  if (standing === null || measure === null) return null;
  const open = view.appealUntil !== null && view.appeal === null;
  const notStarted = standing.state === "unfixed" || standing.state === "announced" || standing.state === "held";
  const reply = standing.reply;
  const keptAfterReply = reply !== null && reply.onTime && reply.answeredAt !== null && !ENDED_BY_A_DECISION.has(standing.state);
  return (
    <View>
      {open && notStarted ? <Note>{STANDING_TEXTS.appeal.early}</Note> : null}
      {open && keptAfterReply && reply.answeredAt !== null && view.appealUntil !== null ? <Line>{STANDING_TEXTS.appeal.again(reply.answeredAt, view.appealUntil)}</Line> : null}
      {measure.kind === "terminate" && (open || view.appeal?.state === "pending") ? <Note>{STANDING_TEXTS.terminateDelete}</Note> : null}
    </View>
  );
}

/**
 * One decision as its author reads it (3c design, section 9): the statement of reasons, rendered by the same function
 * that rendered its mail, from the same data; what the decision is about and the content it was made on; and where its
 * appeal stands. A decision that ends or lifts a field reset links the decision that reset the field while korbat still
 * keeps the old value there. With `onAppeal` a decision that can still be appealed carries the appeal's form.
 */
export function DecisionDetail({
  view,
  onAppeal,
  onAsk,
  focusAppeal = false,
}: {
  view: DecisionView;
  onAppeal?: (statement: string) => Promise<void>;
  onAsk?: (text: string) => Promise<void>;
  /** UI Task 7: the screen was opened with ?appeal=1, from the details sheet's Appeal: the appeal's field takes the focus. */
  focusAppeal?: boolean;
}) {
  // 3f: an order's notice, and the reinstatement after one, render as a notice and offer no appeal.
  if (view.order) return <OrderNotice view={view} />;
  const paragraphs = paragraphsOf(view);
  // The decisions whose screens still show a reset field's old value: of the resets this decision lifts, and of those that ended with it.
  const resets = [...new Set([...view.reversals, ...view.endedMeasures].flatMap((entry) => (entry.oldValueKept && entry.resetDecisionId ? [entry.resetDecisionId] : [])))];
  return (
    <View>
      {/* The screen's own title is "Cases": this heading and the sections under it are one level below it. */}
      <Text as="h2" variant="display-3">
        {DECISION_WORDS.title}
      </Text>
      <Text tone="medium" className="mt-1">
        {view.post ? DECISION_WORDS.post(utcMinute(view.post.createdAt)) : CASES_WORDS.profile}
      </Text>
      {/* 3d Task 6 (section 9.4): [auto.chip] beside the day of a decision a program took; nothing on a post says "program".
          A neutral chip: it states a fact, not a status, so it takes no status colour (UI design, section 4.8). */}
      {view.automatedDecision === "fully" ? (
        <View className="mt-2 self-start rounded-full border border-line-high bg-surface-2 px-2.5 py-0.5 web:forced-colors:border-[color:CanvasText]">
          <Text variant="chip" tone="medium">{`${AUTO_WORDS.chip}, ${view.decidedAt.slice(0, 10)}`}</Text>
        </View>
      ) : null}

      <Section title={DECISION_WORDS.statement}>
        {paragraphs ? paragraphs.map((paragraph, index) => <Line key={index}>{paragraph}</Line>) : <Note>{DECISION_WORDS.cannotRender}</Note>}
        {/* 3d (design, section 9.1): after the rule a statement names, its own or the reviewed decision's, the rules page. */}
        {(view.ruleId ?? view.reviewed?.ruleId ?? null) !== null ? (
          <CaseLink href="/rules" label={DECISION_WORDS.rulesPage} className="mt-3" />
        ) : null}
        {/* 3e (design, section 9.2): where the strike this decision gave stands now, read fresh. */}
        {view.strike ? <Line strong>{strikeLine(view.strike)}</Line> : null}
        {resets.map((decisionId) => (
          <CaseLink key={decisionId} href={`/settings/cases/${decisionId}`} label={DECISION_WORDS.resetDecision} className="mt-3" />
        ))}
      </Section>

      <AskPerson view={view} onAsk={onAsk} />
      <StandingNow view={view} />
      <ReportingNow view={view} />

      <Section title={DECISION_WORDS.content}>
        {view.content === null ? <Note>{ORDER_TEXTS.notice.noContent}</Note> : <Content content={view.content} />}
      </Section>

      {view.appeal || view.appealUntil || view.reversedOn ? (
        <Section title={DECISION_WORDS.appeal}>
          <StandingAppealNotes view={view} />
          <Appeal view={view} onAppeal={onAppeal} focus={focusAppeal} />
        </Section>
      ) : null}
    </View>
  );
}
```

### Replace `apps/app/src/components/moderation/ItemLines.tsx` (whole file)

```tsx
import { useState } from "react";
import { Text as Inline, View } from "react-native";
import { STATEMENT_MAX, itemOutcomeWords, type NoticeItemStatus } from "@korbat/contracts";
import { STATEMENT_WORDS } from "@korbat/rules";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { Button, ErrorText, Field } from "@/components/ui";
import { externalLink } from "@/lib/links";
import { dailyLimitFailure, itemRedress, quotedExaminedToo, utcMinute } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";
import { STANDING_TEXTS } from "@/lib/standing";
import { cn } from "@/theme/cn";

/**
 * "Ask for a re-examination" (3c design, section 9): an optional statement, free of form, and the button. The request
 * is a POST its caller sends; a refusal is worded under the button, and what was typed stays. Once it is taken the list
 * is read again, and the item no longer offers the control.
 */
function ReexamineControl({ both, onAsk }: { both: boolean; onAsk: (statement: string) => Promise<void> }) {
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAsk(statement);
    } catch (err) {
      setError(dailyLimitFailure(err, "reexaminations"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      {/* A report of child sexual abuse material about a post that quotes another: korbat examines both posts again. */}
      {both ? (
        <Text variant="meta" tone="medium" className="mt-2">
          {STATUS_WORDS.reexamineBoth}
        </Text>
      ) : null}
      <Field label={STATUS_WORDS.reexamineStatement} value={statement} onChangeText={setStatement} multiline maxLength={STATEMENT_MAX} />
      <Button label={STATUS_WORDS.reexamine} onPress={() => void ask()} busy={busy} tone="secondary" />
      <ErrorText message={error} />
    </View>
  );
}

/**
 * One item of a report as its sender reads it, on the notice status page and in Your reports alike (3c design, section
 * 9). Its link is the address the report named, an account's under the handle as named. Once its outcome is released it
 * reads the words the mail reads (the contracts' one composition, from the item's own facts), and beside them what the
 * sender can still do: ask for a re-examination while that is open, with the control when the screen can send one, or go
 * to court; a changed outcome and a re-examination's answer are final within korbat. Until then it says only that it is
 * not decided. 3e Task 5 (design, section 9.4): on the sender's own list, an item a moderator marked "manifestly
 * unfounded" says so while the mark counts, once its outcome is released; the status page's items carry no mark.
 *
 * UI Task 7 (section 8.7): each item a row on ListRow's measures (its padding, a line-low divider), headed by the item
 * and its link in body-strong, its outcome and what the sender can do under it. It is no ListRow itself: a ListRow is a
 * control, and an item holds its own (the link, the re-examination's form).
 */
function ItemLine({ item, both, onAsk }: { item: NoticeItemStatus & { unfounded?: boolean }; both: boolean; onAsk?: (statement: string) => Promise<void> }) {
  const words = itemOutcomeWords(item);
  const redress = itemRedress(item);
  return (
    <View className="py-3">
      {item.quotedBy !== null ? (
        // An item korbat added for the post a named post quotes: its heading says so, with the quoted post's address.
        <Text variant="body-strong">{STATUS_WORDS.added(item.quotedBy, item.link)}</Text>
      ) : (
        <Text variant="body-strong">
          {STATUS_WORDS.item(item.position)}
          {item.reexamines ? ` (${STATUS_WORDS.reexaminationLabel})` : ""}:{" "}
          {/* A link inside the line: its words break anywhere, so a long address never pushes the page sideways. */}
          <Inline {...externalLink(item.link)} className={cn("rounded-sm font-normal text-accent-ink underline web:break-all", FOCUS_RING)}>
            {item.link}
          </Inline>
        </Text>
      )}
      {words === null || item.decidedOn === null ? (
        <Text tone="medium" className="mt-1">
          {STATUS_WORDS.waiting}
        </Text>
      ) : (
        <>
          <Text className="mt-1">
            {STATUS_WORDS.decided(item.decidedOn)} {words}
          </Text>
          {/* 3d Task 7 (9.6, W.3): a decision recorded as partly automated says so, as the mail does. */}
          {item.automatedDecision === "partially" ? <Text className="mt-2">{STATEMENT_WORDS.update.automated.partly}</Text> : null}
          {item.unfounded === true ? (
            // "You can ask for a re-examination" only while one is open (3e's review, people8). The review tone with its
            // icon, so the mark is never told by its colour alone (section 4.8).
            <View className="mt-2 flex-row items-start gap-1.5">
              <View className="pt-[3px]">
                <Icon name="review" size={16} tone="review-ink" />
              </View>
              <Text tone="review-ink" className="shrink">
                {redress === "reexamination" ? STANDING_TEXTS.reports.marked : STANDING_TEXTS.reports.markedClosed}
              </Text>
            </View>
          ) : null}
          {redress === "reexamination" && item.reexamination ? (
            <>
              <Text tone="medium" className="mt-2">
                {STATUS_WORDS.reexaminationOpen(utcMinute(item.reexamination.until))}
              </Text>
              {onAsk ? <ReexamineControl both={both} onAsk={onAsk} /> : null}
            </>
          ) : null}
          {redress === "final" ? (
            <Text tone="medium" className="mt-2">
              {STATUS_WORDS.final}
            </Text>
          ) : null}
          {redress === "courts" ? (
            <Text tone="medium" className="mt-2">
              {STATUS_WORDS.courts}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * A report's items in the order the API lists them: by position, an added item directly after the item it was added for.
 * With `onReexamine` each item whose answer can still be examined again carries the control; the caller sends the
 * request for the item it is handed (by its position on the status page, by its id in Your reports).
 */
export function ItemLines<T extends NoticeItemStatus>({ items, onReexamine }: { items: readonly T[]; onReexamine?: (item: T, statement: string) => Promise<void> }) {
  return (
    <View>
      {items.map((item, index) => (
        // A re-examination shares its item's position, so the place in the list is the key. A line-low rule between two
        // items, none above the first or under the last, which the card or the report's own rule closes.
        <View key={index} className={index > 0 ? "border-t border-line-low" : undefined}>
          <ItemLine item={item} both={quotedExaminedToo(items, index)} onAsk={onReexamine ? (statement) => onReexamine(item, statement) : undefined} />
        </View>
      ))}
    </View>
  );
}
```

### Replace `apps/app/src/components/moderation/NoticeStatusView.tsx` (whole file)

```tsx
import { View } from "react-native";
import type { NoticeItemStatus, NoticeStatus } from "@korbat/contracts";
import { Text } from "@/components/kit/Text";
import { Body, Button, ErrorText, TextLink } from "@/components/ui";
import { messageFor } from "@/lib/api";
import { utcMinute } from "@/lib/moderation";
import { REPORT_WORDS, STATUS_WORDS } from "@/lib/moderation-words";
import { ItemLines } from "./ItemLines";

/**
 * Where a notice stands (3c design, section 9): its reference, when korbat received it, and each item with its outcome
 * once released. The contact's part shows only when the page was opened from a mail's link: the answer then carries
 * whether the address is confirmed or stopped, and the page offers "I sent this" and "stop", each a button that posts with
 * the same token, never a link that acts when it is merely opened. A stopped address reads so, with the one button that
 * undoes it. Opened from the link shown on screen, the answer says neither, and the page shows no contact buttons. With
 * `onReexamine` each item whose answer can still be examined again carries "Ask for a re-examination".
 *
 * UI Task 7 (section 8.7): the page's title, "Your report", is its ScreenHeader's (app/notice/[ref].tsx); here the
 * reference and the day lead a card of the report's items, a row each, and the emails' part is a card of its own.
 */
export function NoticeStatusView({
  status,
  onContact,
  onReexamine,
  busy = false,
  error = null,
}: {
  status: NoticeStatus;
  onContact?: (choice: "confirm" | "stop") => void;
  onReexamine?: (item: NoticeItemStatus, statement: string) => Promise<void>;
  busy?: boolean;
  error?: string | null;
}) {
  const contact = status.contact !== null && status.contact.confirmed !== null && status.contact.stopped !== null ? status.contact : null;
  return (
    <View>
      <Text variant="mono">{STATUS_WORDS.reference(status.ref)}</Text>
      <Body>{STATUS_WORDS.received(utcMinute(status.receivedAt))}</Body>
      {status.items.length > 0 ? (
        <View className="mt-6 rounded-card border border-line-low bg-surface-1 px-4 pb-1">
          <ItemLines items={status.items} onReexamine={onReexamine} />
        </View>
      ) : null}
      {contact ? (
        <View className="mt-8 rounded-card border border-line-low bg-surface-1 p-5">
          <Text as="h2" variant="title">
            {STATUS_WORDS.contact}
          </Text>
          {contact.stopped ? (
            <>
              <Body>{STATUS_WORDS.stopped}</Body>
              <Button label={STATUS_WORDS.undo} onPress={() => onContact?.("confirm")} busy={busy} tone="secondary" />
            </>
          ) : (
            <>
              <Body>{contact.confirmed ? STATUS_WORDS.confirmed : STATUS_WORDS.unconfirmed}</Body>
              <Button label={STATUS_WORDS.confirm} onPress={() => onContact?.("confirm")} busy={busy} tone="secondary" />
              <Button label={STATUS_WORDS.stop} onPress={() => onContact?.("stop")} busy={busy} tone="secondary" />
              <Text variant="meta" tone="medium" className="mt-2">
                {STATUS_WORDS.stopHint}
              </Text>
            </>
          )}
          <ErrorText message={error} />
        </View>
      ) : null}
      <TextLink label={REPORT_WORDS.back} href="/" replace />
    </View>
  );
}

/** One sentence for a wrong reference and a wrong token alike: the page never says which was wrong. */
export function NoticeNotFound() {
  return (
    <View>
      <Text accessibilityRole="alert">{messageFor("notice_not_found")}</Text>
      <TextLink label={REPORT_WORDS.back} href="/" replace />
    </View>
  );
}
```

### Replace `apps/app/src/components/moderation/RefusedNotice.tsx` (whole file)

```tsx
import { View } from "react-native";
import type { AccountStanding } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { refusalSentence, runningMeasure, STANDING_TEXTS } from "@/lib/standing";
import { CaseLink } from "./parts";

/**
 * A write refused account_suspended where it was attempted (3e design, section 9.4): a card's like, repost or bookmark,
 * and a follow. It reads /me's standing as the session holds it, which the app reads again after such a refusal, so the
 * sentence names the end of the suspension, the termination, or that the suspension has just ended; and while a measure
 * runs, the link to its decision. UI Task 7: the error's sentence in danger-ink beside its icon, never by colour alone
 * (section 4.8), and the link a 44 px target of its own.
 */
export function RefusedNotice({ standing }: { standing: AccountStanding | null | undefined }) {
  const running = runningMeasure(standing);
  return (
    <View className="mt-1">
      <View className="flex-row items-start gap-1.5">
        <View className="pt-[2px]">
          <Icon name="error" size={16} tone="danger" />
        </View>
        <Text accessibilityRole="alert" variant="meta" tone="danger" className="shrink">
          {refusalSentence(standing)}
        </Text>
      </View>
      {running !== null ? <CaseLink href={`/settings/cases/${running.decisionId}`} label={STANDING_TEXTS.refused.read} /> : null}
    </View>
  );
}
```

### Replace `apps/app/src/components/moderation/ReleaseNotice.tsx` (whole file)

```tsx
import { View } from "react-native";
import type { ReleaseNoticeView } from "@korbat/contracts";
import { releaseNoticeParagraphs } from "@korbat/rules";
import { Text } from "@/components/kit/Text";
import { TextLink } from "@/components/ui";
import { RELEASE_TEXTS } from "@/lib/moderation-words";
import { Line } from "./parts";

/**
 * 3d Task 2 (design, sections 7.2 and 9.6; W.6): the notice of a release of sealed images of the reader's posts, on its
 * screen under Settings, Cases. Its paragraphs are RELEASE_NOTICE's, rendered by the one function the mail uses, and no
 * control: a release cannot be undone. It links the decision that sealed. 3d review L11: whether an appeal of that
 * decision waits is the view's `appeal`, which the notice's own paragraph follows, so the screen adds no line of its own
 * about it. It names no authority, no reference and no assessment, and draws no image. UI Task 7: on the tokens, its
 * title a level-2 heading under the screen's "Cases".
 */
export function ReleaseNoticeDetail({ view }: { view: ReleaseNoticeView }) {
  return (
    <View>
      <Text as="h2" variant="display-3">
        {RELEASE_TEXTS.title}
      </Text>
      {releaseNoticeParagraphs(view).map((paragraph, index) => (
        <Line key={index}>{paragraph}</Line>
      ))}
      {view.sealDecisionId === null ? null : <TextLink label={RELEASE_TEXTS.decision} href={`/settings/cases/${view.sealDecisionId}`} />}
    </View>
  );
}
```

### Replace `apps/app/src/components/moderation/ReportForm.tsx` (whole file)

```tsx
import { useRef, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { NOTICE_LIMITS, REPORT_RULE_IDS, TDB_FORM_CATEGORIES, type AccountStanding, type CsamKeywordChoice, type NoticeResponse, type ReportRuleId } from "@korbat/contracts";
import { RULES } from "@korbat/rules";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, FOCUS_RING_INSET, HOVER_WASH } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { RULES_PAGE } from "@/lib/public-pages";
import { Body, Button, ErrorText, Field, TextButton, TextLink } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  EMPTY_DRAFT,
  OTHER_LINKS_MAX,
  moderation,
  noticeFrom,
  profileOnly,
  reportFailure,
  ruleLine,
  statusLink,
  tooManyProfiles,
  type GivenTarget,
  type Ground,
  type NoticeCategoryChoice,
  type ReportDraft,
} from "@/lib/moderation";
import { CATEGORY_LABELS, REPORT_WORDS } from "@/lib/moderation-words";
import { reportsRestrictedUntil, runningMeasure, STANDING_TEXTS } from "@/lib/standing";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { CaseLink } from "./parts";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** One entry of a list of choices: a choice with its label and an optional line under it, or a line of text that stands in a choice's place. */
type ChoiceEntry<T extends string> = { value: T; label: string; hint?: string; disabled?: string } | { note: string };

/**
 * One step of the form (UI design, section 8.7; UI Task 7): a card of surface-1 holding one question, so the form reads
 * as a stack of questions, each answered before the next.
 */
function Step({ children }: { children: ReactNode }) {
  return <View className="mt-4 rounded-card border border-line-low bg-surface-1 px-4 pb-5">{children}</View>;
}

/** A question's own words above its answers, as a field's label reads. */
function Question({ children }: { children: string }) {
  return (
    <Text variant="body-strong" tone="medium">
      {children}
    </Text>
  );
}

/** The circle of a radio: a ring, filled with the accent when chosen; aria-checked says the same in words. */
function RadioMark({ checked, disabled }: { checked: boolean; disabled: boolean }) {
  return (
    <View className={cn("mt-0.5 h-5 w-5 items-center justify-center rounded-full border-2", checked ? "border-accent" : disabled ? "border-line-low" : "border-line-high")}>
      {checked ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
    </View>
  );
}

/**
 * One question with its answers, of which one is chosen: a radio group, each answer a radio that says whether it is
 * checked. Every answer has the same weight on the page; a note among them is plain text and no control.
 */
function Choice<T extends string>({ label, entries, value, onChange }: { label: string; entries: ChoiceEntry<T>[]; value: T | null; onChange: (value: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" aria-label={label} className="mt-6 gap-1">
      <Question>{label}</Question>
      {entries.map((entry) =>
        "note" in entry ? (
          <Text key={entry.note} tone="medium" className="mt-1 rounded-control border border-dashed border-line-high px-3 py-3">
            {entry.note}
          </Text>
        ) : (
          <Pressable
            key={entry.value}
            accessibilityRole="radio"
            aria-checked={value === entry.value}
            aria-disabled={entry.disabled !== undefined}
            disabled={entry.disabled !== undefined}
            onPress={() => onChange(entry.value)}
            className={cn("min-h-[44px] flex-row items-start gap-3 rounded-control px-3 py-2.5", value === entry.value ? "bg-accent-wash" : entry.disabled === undefined ? HOVER_WASH : undefined, FOCUS_RING_INSET)}
          >
            <RadioMark checked={value === entry.value} disabled={entry.disabled !== undefined} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text variant={value === entry.value ? "body-strong" : "body"} tone={entry.disabled !== undefined ? "low" : "high"}>
                {entry.label}
              </Text>
              {entry.hint ? (
                <Text variant="meta" tone="medium">
                  {entry.hint}
                </Text>
              ) : null}
              {/* A disabled choice keeps its reason as text beside it (9.8), with the review icon, never by colour alone. */}
              {entry.disabled !== undefined ? (
                <View className="flex-row items-start gap-1.5">
                  <View className="pt-[2px]">
                    <Icon name="review" size={16} tone="review-ink" />
                  </View>
                  <Text variant="meta" tone="review-ink" className="shrink">
                    {entry.disabled}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        ),
      )}
    </View>
  );
}

/** A statement the person may tick: a checkbox that says whether it is checked; its tick is drawn, not written. */
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" aria-checked={checked} onPress={() => onChange(!checked)} className={cn("mt-6 min-h-[44px] flex-row items-start gap-3 rounded-control py-1", FOCUS_RING)}>
      <View className={cn("mt-0.5 h-5 w-5 items-center justify-center rounded-[5px] border-2", checked ? "border-accent bg-accent" : "border-line-high bg-surface-1")}>
        {/* The tick: two sides of a box turned 45 degrees, in the colour that reads on the accent. */}
        {checked ? <View className="-mt-0.5 h-2.5 w-1.5 border-b-2 border-r-2 border-on-accent" style={{ transform: [{ rotate: "45deg" }] }} /> : null}
      </View>
      <Text className="flex-1">{label}</Text>
    </Pressable>
  );
}

const Hint = ({ children }: { children: string }) => (
  <Text tone="medium" className="mt-2">
    {children}
  </Text>
);

/** The rules a report may cite, each with its title and one line; R2 is no choice: in its place stands the pointer to the anonymous path. */
function ruleEntries(withPointer: boolean): ChoiceEntry<ReportRuleId>[] {
  const reportable: readonly string[] = REPORT_RULE_IDS;
  return RULES.flatMap((rule): ChoiceEntry<ReportRuleId>[] => {
    if (reportable.includes(rule.id)) return [{ value: rule.id as ReportRuleId, label: `${rule.id}: ${rule.title}`, hint: ruleLine(rule) }];
    return withPointer ? [{ note: REPORT_WORDS.r2Instead }] : [];
  });
}

const GROUNDS: ChoiceEntry<Ground>[] = [
  { value: "rule", label: REPORT_WORDS.grounds.rule },
  { value: "illegal", label: REPORT_WORDS.grounds.illegal },
  { value: "csam", label: REPORT_WORDS.grounds.csam },
];
const CATEGORIES: ChoiceEntry<NoticeCategoryChoice>[] = [
  { value: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE", label: REPORT_WORDS.categoryNotSure },
  ...TDB_FORM_CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] })),
];
const KEYWORDS: ChoiceEntry<CsamKeywordChoice>[] = (Object.keys(REPORT_WORDS.keywords) as CsamKeywordChoice[]).map((keyword) => ({ value: keyword, label: REPORT_WORDS.keywords[keyword] }));
/** The illegal ground's optional rule: none, or one of the rules a report may cite. */
const NO_RULE = "none";

/** "The rules", the public rules page, beside the list of rules (3d design, section 9.1). */
function RulesLink() {
  return <CaseLink href="/rules" label={RULES_PAGE.title} className="mt-2" />;
}

/** What the form was opened on, as a link to it; a form opened without an item asks for its link instead. */
function GivenItem({ given }: { given: GivenTarget }) {
  const [href, label] = given.kind === "post" ? [`/post/${given.id}`, given.mediaId ? REPORT_WORDS.itemImage : REPORT_WORDS.itemPost] : [`/u/${given.handle}`, REPORT_WORDS.itemProfile(given.handle)];
  return (
    <View className="mt-6">
      <Question>{REPORT_WORDS.item}</Question>
      <CaseLink href={href} label={label} />
    </View>
  );
}

/**
 * The report form (3c design, section 9): what is wrong, with three grounds of equal weight, then what that ground
 * needs. It builds the request from what is filled in (noticeFrom), says what is still missing in place of sending, and
 * shows the answer's screen once korbat took the report. `given` is the post, image or profile "Report" was pressed on,
 * or null for a form opened on its own, which asks for the link. Signed out, every ground needs the human check.
 * `initial` is what a test starts the form with. UI Task 7 (section 8.7): its title is the screen's (app/report.tsx), and
 * its steps a stack of cards, one question each.
 */
export function ReportForm({ signedIn, given, initial, standing = null }: { signedIn: boolean; given: GivenTarget | null; initial?: Partial<ReportDraft>; standing?: AccountStanding | null }) {
  // 3e (design, section 9.6): read from /me before anything is sent. While a suspension runs, or (Task 5) a restriction of
  // the account's reports, the first choice is disabled with its sentence, the suspension's first as the intake refuses
  // it first; a notice of illegality and the path for child sexual abuse material stay open.
  const running = runningMeasure(standing);
  const restrictedUntil = reportsRestrictedUntil(standing);
  const ruleClosed =
    running !== null
      ? running.kind === "suspend" && running.endsAt !== null
        ? STANDING_TEXTS.report.suspended(running.endsAt)
        : STANDING_TEXTS.refused.terminated
      : restrictedUntil !== null
        ? STANDING_TEXTS.report.restricted(restrictedUntil)
        : undefined;
  const grounds = GROUNDS.map((entry) => ("value" in entry && entry.value === "rule" && ruleClosed !== undefined ? { ...entry, disabled: ruleClosed } : entry));
  const turnstile = useRef<TurnstileInstance | null>(null);
  // The human check is drawn light in Light and dark in Dim and Dark, like the page around it.
  const theme = useTheme();
  const [draft, setDraft] = useState<ReportDraft>({ ...EMPTY_DRAFT, ...initial });
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<NoticeResponse | null>(null);
  const set = (patch: Partial<ReportDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const built = noticeFrom(draft, given, { signedIn, turnstileToken: token });
  const anonymous = draft.ground === "csam";

  async function send() {
    if (busy || !("request" in built)) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await moderation.send(built.request);
      setSent(answer);
    } catch (err) {
      setError(reportFailure(err, draft.ground === "csam"));
      // A token of the human check is good for one request: the next try needs a fresh one.
      turnstile.current?.reset();
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <ReportSent answer={sent} signedIn={signedIn} origin={(globalThis as { location?: { origin?: string } }).location?.origin ?? ""} />;

  const setOther = (index: number, url: string) => set({ others: draft.others.map((other, at) => (at === index ? url : other)) });
  return (
    <View>
      <Step>{given ? <GivenItem given={given} /> : <Field label={REPORT_WORDS.link} autoCapitalize="none" inputMode="url" value={draft.link} onChangeText={(link) => set({ link })} />}</Step>

      <Step>
        <Choice label={REPORT_WORDS.question} entries={grounds} value={draft.ground} onChange={(ground) => set({ ground })} />
      </Step>

      {draft.ground === "rule" ? (
        <>
          <Step>
            <Choice label={REPORT_WORDS.whichRule} entries={ruleEntries(true)} value={draft.ruleId} onChange={(ruleId) => set({ ruleId })} />
            {/* 3d (design, section 9.1): every rule in full, with what it allows, beside the list. */}
            <RulesLink />
          </Step>
          <Step>
            <Field label={REPORT_WORDS.explanation} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
          </Step>
        </>
      ) : null}

      {draft.ground === "illegal" ? (
        <>
          <Step>
            <Choice label={REPORT_WORDS.category} entries={CATEGORIES} value={draft.category} onChange={(category) => set({ category })} />
            <Hint>{REPORT_WORDS.csamInstead}</Hint>
          </Step>
          <Step>
            <Field label={REPORT_WORDS.citedLaw} maxLength={NOTICE_LIMITS.citedLawMax} value={draft.citedLaw} onChangeText={(citedLaw) => set({ citedLaw })} />
          </Step>
          <Step>
            <Field label={REPORT_WORDS.whyIllegal} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
          </Step>
          <Step>
            <Choice
              label={REPORT_WORDS.alsoRule}
              entries={[{ value: NO_RULE, label: REPORT_WORDS.noRule }, ...ruleEntries(false)]}
              value={draft.ruleId ?? NO_RULE}
              onChange={(ruleId) => set({ ruleId: ruleId === NO_RULE ? null : (ruleId as ReportRuleId) })}
            />
          </Step>
          <Step>
            <Check label={REPORT_WORDS.bonaFide} checked={draft.bonaFide} onChange={(bonaFide) => set({ bonaFide })} />
          </Step>
          {signedIn ? null : (
            <Step>
              <Field label={REPORT_WORDS.name} autoComplete="name" value={draft.name} onChangeText={(name) => set({ name })} />
              <Field label={REPORT_WORDS.email} autoComplete="email" autoCapitalize="none" inputMode="email" value={draft.email} onChangeText={(email) => set({ email })} />
              <Hint>{REPORT_WORDS.contactHint}</Hint>
            </Step>
          )}
        </>
      ) : null}

      {draft.ground === "csam" ? (
        <>
          <Step>
            <Choice label={REPORT_WORDS.which} entries={KEYWORDS} value={draft.keyword} onChange={(keyword) => set({ keyword })} />
            {profileOnly(draft, given) ? <Hint>{REPORT_WORDS.profileOnly}</Hint> : null}
          </Step>
          <Step>
            <Field label={REPORT_WORDS.csamExplanation} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
          </Step>
          <Step>
            <Check label={REPORT_WORDS.bonaFide} checked={draft.bonaFide} onChange={(bonaFide) => set({ bonaFide })} />
            <Hint>{REPORT_WORDS.anonymous}</Hint>
          </Step>
        </>
      ) : null}

      <Step>
        <Text as="h2" variant="body-strong" tone="medium" className="mt-6">
          {REPORT_WORDS.otherItems}
        </Text>
        <Hint>{REPORT_WORDS.otherItemsHint}</Hint>
        {draft.others.map((other, index) => (
          <View key={index}>
            <Field label={REPORT_WORDS.otherLink(index + 1)} autoCapitalize="none" inputMode="url" value={other} onChangeText={(url) => setOther(index, url)} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${REPORT_WORDS.removeLink}: ${REPORT_WORDS.otherLink(index + 1)}`}
              onPress={() => set({ others: draft.others.filter((_, at) => at !== index) })}
              className={cn("group mt-1 min-h-[44px] justify-center self-start rounded-control active:opacity-70", FOCUS_RING)}
            >
              <Text tone="medium" className="underline web:group-hover:decoration-2">
                {REPORT_WORDS.removeLink}
              </Text>
            </Pressable>
          </View>
        ))}
        {draft.others.length < OTHER_LINKS_MAX ? <TextButton label={REPORT_WORDS.addLink} onPress={() => set({ others: [...draft.others, ""] })} /> : null}
        {/* Said before anything is sent: the anonymous path's one report reaches every image of the profile it names. */}
        {tooManyProfiles(draft, given) ? <ErrorText message={REPORT_WORDS.oneProfile} /> : null}
      </Step>

      <Text variant="meta" tone="medium" className="mt-8">
        {/* Who sees the sender is not said on the anonymous path, which records none. */}
        {[REPORT_WORDS.privacy.use, ...(anonymous ? [] : [REPORT_WORDS.privacy.sender]), REPORT_WORDS.privacy.access].join(" ")}
      </Text>
      {signedIn ? null : (
        <View className="mt-6">
          <Turnstile
            ref={turnstile}
            siteKey={SITE_KEY}
            options={{ theme: theme.turnstile, refreshExpired: "manual" }}
            onSuccess={setToken}
            onExpire={() => {
              setToken(null);
              turnstile.current?.reset();
            }}
            onError={() => setError(reportFailure(new ApiError(403, "human_check_failed", ""), anonymous))}
          />
          <Hint>{REPORT_WORDS.turnstile}</Hint>
        </View>
      )}

      <ErrorText message={error} />
      {/* What is still missing, in place of a button that silently does nothing; the one-profile sentence stands above already. */}
      {"problem" in built && built.problem !== REPORT_WORDS.oneProfile ? <Hint>{built.problem}</Hint> : null}
      <Button label={REPORT_WORDS.send} onPress={() => void send()} busy={busy} disabled={!("request" in built)} />
      <TextLink label={REPORT_WORDS.back} href="/" replace />
    </View>
  );
}

/**
 * What the form shows once korbat took the report: its reference and how to follow it. A report sent signed out, or on
 * the anonymous path, is followed with a link that is shown only now, its token in the fragment, which no server is sent;
 * a signed-in report on a rule or on the law is in the account's own list. The answer carries a token exactly in the
 * first case, so the token decides.
 */
export function ReportSent({ answer, signedIn, origin }: { answer: { ref: string; token?: string }; signedIn: boolean; origin: string }) {
  const [copied, setCopied] = useState(false);
  const link = answer.token ? statusLink(origin, answer.ref, answer.token) : null;

  async function copy() {
    if (!link) return;
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;
    try {
      await clipboard?.writeText(link);
      setCopied(clipboard !== undefined);
    } catch {
      // The browser refused the clipboard: the link stays on screen to be selected.
      setCopied(false);
    }
  }

  return (
    <View>
      {/* UI Task 7: a level-2 heading under the screen's title, "Report to korbat". */}
      <Text as="h2" variant="display-3">
        {REPORT_WORDS.sent}
      </Text>
      <Body>{REPORT_WORDS.reference(answer.ref)}</Body>
      {link ? (
        <>
          <Body>{REPORT_WORDS.keepLink}</Body>
          {/* The link in the mono face, breaking anywhere, on a raised wash: it is to be copied, not followed. */}
          <Text selectable variant="mono" className="mt-4 rounded-control border border-line-low bg-surface-2 px-4 py-3 web:break-all">
            {link}
          </Text>
          <Button label={copied ? REPORT_WORDS.copied : REPORT_WORDS.copy} onPress={() => void copy()} tone="secondary" />
        </>
      ) : signedIn ? (
        <>
          <Body>{REPORT_WORDS.followInSettings}</Body>
          <TextLink label={REPORT_WORDS.yourReports} href="/settings/cases?tab=reports" />
        </>
      ) : null}
      <TextLink label={REPORT_WORDS.back} href="/" replace />
    </View>
  );
}
```

### Replace `apps/app/src/components/moderation/UploadNotice.tsx` (whole file)

```tsx
import { useState } from "react";
import { View } from "react-native";
import { OBJECTION_TEXT_MAX, type UploadRefusalView } from "@korbat/contracts";
import { getRedress, getRule, REDRESS_VERSION, RULES_VERSION, uploadNoticeParagraphs } from "@korbat/rules";
import { Text } from "@/components/kit/Text";
import { Button, ErrorText, Field, Section } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { utcMinute } from "@/lib/moderation";
import { UPLOAD_TEXTS } from "@/lib/moderation-words";
import { Line } from "./parts";

/**
 * 3d Task 7 (design, sections 7.12 and 9.5; W.5): the notice of an upload korbat did not accept, on its screen under
 * Settings, Cases. Its paragraphs are UPLOAD_NOTICE's, rendered from the refusal's view by the one function the mails use,
 * with the rule's current title and the current redress texts, so the state paragraph follows the hold. No image is
 * shown: nobody can see it, its uploader included. "Object" stands while the view says an objection is open: one field
 * under [upload.objectLead]; once sent, [upload.objected]. A suspended account can object: nothing here reads its standing.
 * UI Task 7: on the tokens, its title a level-2 heading under the screen's "Cases", "Object" a card.
 */
export function UploadNoticeDetail({ view, onObject }: { view: UploadRefusalView; onObject?: (text: string) => Promise<void> }) {
  const rule = getRule("R2", RULES_VERSION);
  const redress = getRedress(REDRESS_VERSION);
  const paragraphs = rule && redress ? uploadNoticeParagraphs(view, rule.title, redress) : [];
  return (
    <View>
      <Text as="h2" variant="display-3">
        {UPLOAD_TEXTS.title}
      </Text>
      {paragraphs.map((paragraph, index) => (
        <Line key={index}>{paragraph}</Line>
      ))}
      <ObjectControl view={view} onObject={onObject} />
    </View>
  );
}

/** "Object": the button while an objection is open, which opens one field; a refusal is worded under it and what was written stays. */
function ObjectControl({ view, onObject }: { view: UploadRefusalView; onObject?: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function send() {
    if (busy || onObject === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await onObject(text);
      setSent(new Date().toISOString());
    } catch (err) {
      // objection_not_open in this screen's own words (9.7); anything else as elsewhere.
      setError(err instanceof ApiError && err.code === "objection_not_open" ? UPLOAD_TEXTS.notOpen : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null && view.objection !== null) {
    return (
      <Section title={UPLOAD_TEXTS.object}>
        <Text className="mt-2">{UPLOAD_TEXTS.objected(utcMinute(view.objection.objectedAt))}</Text>
      </Section>
    );
  }
  if (!view.mayObject || onObject === undefined) return null;
  return (
    <Section title={UPLOAD_TEXTS.object}>
      {open ? (
        <View>
          <Text tone="medium" className="mt-2">
            {UPLOAD_TEXTS.objectLead}
          </Text>
          <Field label={UPLOAD_TEXTS.objectField} value={text} onChangeText={setText} multiline maxLength={OBJECTION_TEXT_MAX} />
          <Button label={UPLOAD_TEXTS.object} onPress={() => void send()} busy={busy} />
          <ErrorText message={error} />
        </View>
      ) : (
        <Button label={UPLOAD_TEXTS.object} onPress={() => setOpen(true)} />
      )}
    </Section>
  );
}
```

### Replace `apps/app/src/components/social/MediaGrid.tsx` (whole file)

```tsx
import { createContext, useContext, useRef, useState } from "react";
import { Image } from "expo-image";
import { Pressable, View } from "react-native";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { Link } from "expo-router";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, FOCUS_RING_INSET } from "@/components/kit/interaction";
import { StatusChip } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { API_BASE } from "@/lib/api";
import { useMotion } from "@/lib/motion";
import { CHIP_WORDS } from "@/lib/moderation-words";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { HiddenImage, HiddenRowWords, HiddenThumbnail, hiddenImageWords } from "./HiddenImage";
import { ImageFaultView, useImageFault } from "./ImageFault";
import { MediaViewer, Thumbnails } from "./MediaViewer";

/** A single image keeps its own shape, within limits, so a very tall or very wide one cannot take over the timeline. */
const MIN_RATIO = 3 / 4;
const MAX_RATIO = 2;
const FRAME_RATIO = 16 / 9;
const GAP = 2;
const THUMBNAIL = 64;

export const clampRatio = (width: number, height: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));

/**
 * Whether the images below load first (section 11.2): a list sets it for its first two rows, through PostCard, so the
 * images a reader sees on opening are asked before those further down.
 */
export const ImagePriority = createContext(false);

/**
 * The small size of an image with its blurhash (UI design, section 11.2). expo-image loads it lazily on the web and keeps
 * its view for the next image of a recycled row by the media id; the blurhash cross-fades into the image in 150 ms
 * unless motion is reduced, by the system or the reader, which swaps it at once.
 */
function Picture({ item, style, onError }: { item: MediaView; style: { width: number | "100%"; height: number | "100%" }; onError?: () => void }) {
  const { reduced } = useMotion();
  const first = useContext(ImagePriority);
  return (
    // On the web expo-image takes the <img alt> from accessibilityLabel, not from alt.
    <Image source={{ uri: `${API_BASE}${item.small}` }} placeholder={{ blurhash: item.blurhash }} recyclingKey={item.id} contentFit="cover" transition={reduced ? 0 : 150} priority={first ? "high" : "normal"} accessibilityLabel={item.alt} style={style} onError={onError} />
  );
}

/**
 * The label on the author's own image that moderation withheld or removed (3c design, section 9): the author keeps seeing
 * such an image, and reads on the image itself that others do not. The API marks an image so only for its author. It is
 * the information-only StatusChip in the image's corner (UI design, section 6.7), and takes no press: the image under it
 * still opens.
 */
export function OwnImageLabel({ state }: { state: NonNullable<MediaView["moderation"]> }) {
  const withheld = state === "withheld";
  return (
    <View pointerEvents="none" className="absolute left-2 top-2 right-2">
      <StatusChip tone={withheld ? "review" : "restricted"} label={withheld ? CHIP_WORDS.underReview : CHIP_WORDS.removed} />
    </View>
  );
}

/**
 * One image of the frame: the control that opens it and, beside that control, the label of the author's own restricted
 * image, as text of its own. 3d: when an image of the reader's own post fails to load, its status is asked once, and an
 * image being restored or lost shows why in its place, with nothing to open. `cell` keeps the control's element, which
 * the lightbox grows from and returns into.
 */
function Cell({ item, onPress, own, cell }: { item: MediaView; onPress: () => void; own: boolean; cell: (node: View | null) => void }) {
  const { fault, onError } = useImageFault(item.id, own);
  return (
    <View style={{ flex: 1 }}>
      {fault !== null ? (
        <ImageFaultView fault={fault} />
      ) : (
        <Pressable ref={cell} accessibilityRole="button" accessibilityLabel={fill(UI_WORDS["media.open"], { alt: item.alt })} onPress={onPress} style={{ flex: 1 }} className={FOCUS_RING_INSET}>
          <Picture item={item} style={{ width: "100%", height: "100%" }} onError={onError} />
        </Pressable>
      )}
      {item.moderation ? <OwnImageLabel state={item.moderation} /> : null}
    </View>
  );
}

/**
 * The images of a post (UI design, section 6.7). One image is shown in its own ratio; two to four share a 16:9 frame and
 * are cropped to their cell. The frame is clipped to radius media with a 1 px line-low hairline drawn inside it, so a
 * white image keeps its edge on the Light theme. Pressing one opens the viewer, which grows from it; ALT shows the
 * descriptions in place. An image moderation hid from this reader keeps its place as a placeholder: it has no size of its
 * own, so alone it takes the frame's ratio, it is no control, and it has no description to show. The viewer is told the
 * post that holds the images, so that an image can be reported on it, unless the post is the reader's own.
 */
function Grid({ media, postId, own }: { media: (MediaView | HiddenMedia)[]; postId?: string; own?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [described, setDescribed] = useState(false);
  // Each cell's control, by its place, for the viewer to measure.
  const cells = useRef<(View | null)[]>([]);
  const cell = (index: number) => {
    const item = media[index]!;
    return isHiddenMedia(item) ? <HiddenImage key={item.id} item={item} /> : <Cell key={item.id} item={item} onPress={() => setOpen(index)} own={own === true} cell={(node) => void (cells.current[index] = node)} />;
  };
  const first = media[0]!;
  // Descriptions exist only for the images this reader is shown.
  const anyShown = media.some((item) => !isHiddenMedia(item));
  const anyHidden = media.some(isHiddenMedia);

  let frame;
  if (media.length === 1) {
    frame = <View style={{ aspectRatio: isHiddenMedia(first) ? FRAME_RATIO : clampRatio(first.width, first.height) }}>{cell(0)}</View>;
  } else if (media.length === 2) {
    frame = <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>;
  } else if (media.length === 3) {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>
        {cell(0)}
        <View style={{ flex: 1, gap: GAP }}>{[cell(1), cell(2)]}</View>
      </View>
    );
  } else {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, gap: GAP }}>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(2), cell(3)]}</View>
      </View>
    );
  }

  return (
    <View className="mt-2">
      <View className="overflow-hidden rounded-media bg-surface-2">
        {frame}
        <View pointerEvents="none" aria-hidden className="absolute inset-0 rounded-media border border-line-low" />
      </View>
      {anyShown || anyHidden ? (
        <View className="flex-row flex-wrap items-center gap-x-4">
          {anyShown ? (
            // The one ALT toggle (a per-image badge would say nothing: every korbat image has a description), a 44 px target.
            <Pressable
              accessibilityRole="button"
              aria-expanded={described}
              accessibilityLabel={described ? UI_WORDS["media.hideAlt"] : UI_WORDS["media.showAlt"]}
              onPress={() => setDescribed(!described)}
              className={cn("group min-h-[44px] min-w-[44px] items-start justify-center self-start rounded-control", FOCUS_RING_INSET)}
            >
              <View className={cn("rounded-[6px] border px-1.5 py-0.5", described ? "border-accent bg-accent-wash" : "border-line-high bg-surface-1 web:group-hover:bg-surface-2")}>
                <Text variant="chip" tone={described ? "accent" : "medium"}>
                  {UI_WORDS["media.alt"]}
                </Text>
              </View>
            </Pressable>
          ) : null}
          {anyHidden ? (
            // Decision 10: a reader gets no cover to lift, since the image never reaches them; the row under the grid
            // says where korbat's moderation is explained instead. The placeholder itself stays no control.
            <Link href="/rules" asChild>
              <Pressable className={cn("group min-h-[44px] flex-row items-center gap-1.5 self-start rounded-control active:opacity-70", FOCUS_RING)}>
                <Icon name="info" size={16} tone="accent" />
                <Text variant="meta" tone="accent" className="underline decoration-1 underline-offset-2 web:group-hover:decoration-2">
                  {UI_WORDS["media.whyHidden"]}
                </Text>
              </Pressable>
            </Link>
          ) : null}
        </View>
      ) : null}
      {described
        ? media.map((item, index) => (
            <Text key={item.id} tone="medium" className="mt-1">
              {media.length > 1 ? `${index + 1}. ` : ""}
              {/* A hidden image keeps its number, so the others' numbers match their places in the frame. */}
              {isHiddenMedia(item) ? hiddenImageWords(item) : item.alt}
            </Text>
          ))
        : null}
      <Thumbnails.Provider value={cells}>
        {open === null ? null : <MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} postId={own ? undefined : postId} own={own === true} />}
      </Thumbnails.Provider>
    </View>
  );
}

/**
 * A post's images (`Grid`), or a quoted post's as one row of small squares (`compact`). The squares
 * are pictures, not buttons: the whole quote is a link to the quoted post, where the grid and the
 * viewer are, and a control inside another control is one that assistive technology cannot reach.
 * A hidden image keeps its square in the row, and the row says the placeholder's sentence once, as
 * text, under the squares. `postId` is the post that holds the images and `own` says that the reader
 * wrote it: the viewer reports an image on that post, and offers no report of the reader's own.
 */
export function MediaGrid({ media, compact = false, postId, own = false }: { media: (MediaView | HiddenMedia)[]; compact?: boolean; postId?: string; own?: boolean }) {
  if (media.length === 0) return null;
  if (!compact) return <Grid media={media} postId={postId} own={own} />;
  return (
    <View className="mt-2">
      <View className="flex-row" style={{ gap: GAP }}>
        {media.map((item) =>
          isHiddenMedia(item) ? (
            <HiddenThumbnail key={item.id} size={THUMBNAIL} />
          ) : (
            <View key={item.id} className="overflow-hidden rounded-media border border-line-low" style={{ width: THUMBNAIL, height: THUMBNAIL }}>
              <Picture item={item} style={{ width: "100%", height: "100%" }} />
            </View>
          ),
        )}
      </View>
      <HiddenRowWords media={media} />
    </View>
  );
}
```

### Replace `apps/app/src/components/social/PostCard.tsx` (whole file)

```tsx
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, Text as Inline, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Link, router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { StatusSheet } from "@/components/moderation/StatusSheet";
import { toast } from "@/components/toast";
import { ErrorText, VerifiedChip } from "@/components/ui";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";
import { IconButton, type IconButtonFeedback } from "@/components/kit/IconButton";
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Menu, type MenuItem } from "@/components/kit/Menu";
import { StatusChip, type StatusTone } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { VISUALLY_HIDDEN, VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { useHaptics } from "@/lib/haptics";
import { chipText } from "@/lib/moderation";
import { CHIP_WORDS } from "@/lib/moderation-words";
import { useMotion } from "@/lib/motion";
import { countLabel, deleteWithLeave, failedWords, shownCount, threadStats, toggleEngagement, type ToggleKind } from "@/lib/post-actions";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { lanes, laneKey, social } from "@/lib/social";
import { fullDate, postedWhen, timeAgo } from "@/lib/time";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";
import { ImagePriority, MediaGrid } from "./MediaGrid";
import { PostMenu } from "./PostMenu";
import { RichText } from "./RichText";

/**
 * A link inside a line of text (the author line, the repost line, the reply context): inline, so a phone holds it to
 * WCAG 2.5.8's 24 px rather than a control's 44, and padded to reach it, which does not move the line.
 */
const INLINE_LINK = cn("rounded-sm py-1.5 web:hover:underline", FOCUS_RING);

/**
 * Who wrote the post and when (UI design, section 6.6): the display name in body-strong as the link to the profile, the
 * verified chip, the handle in the mono face, and the time as the post's one link. The time shows its short form ("3h"),
 * hidden from the link's name, which says it inside postedWhen's words ("3h ago, open the post"), so the name contains
 * the visible label. The thread's focused post shows the full date instead. The card's own line marks its time link as
 * the article's open link (`open`), which a feed's Page Down and Page Up move the focus to; a quote's line does not.
 */
function AuthorLine({ author, createdAt, postId, large = false, open = false }: { author: Author; createdAt: string; postId: string; large?: boolean; open?: boolean }) {
  const shown = large ? fullDate(createdAt) : timeAgo(createdAt);
  const when = large ? fill(UI_WORDS["time.posted.on"], { date: shown }) : postedWhen(createdAt);
  return (
    <View className="flex-row flex-wrap items-center gap-x-1.5">
      <Text variant="body-strong">
        <Link href={`/u/${author.handle}`} asChild>
          <Inline className={INLINE_LINK}>{author.displayName}</Inline>
        </Link>
      </Text>
      {author.verified ? <VerifiedChip /> : null}
      <Text variant="mono" tone="low">
        @{author.handle}
      </Text>
      <Text variant="meta" tone="low">
        <Link href={`/post/${postId}`} asChild>
          <Inline {...(open ? dataAttribute("open") : {})} className={cn(INLINE_LINK, "px-1.5")}>
            <Inline aria-hidden>{shown}</Inline>
            <VisuallyHidden>{fill(UI_WORDS["post.open"], { when })}</VisuallyHidden>
          </Inline>
        </Link>
      </Text>
    </View>
  );
}

/** The repost line above a reposted post: the repost icon, and "Ben reposted" with Ben's name a link to his profile. */
function RepostLine({ by }: { by: Author }) {
  const [before, after] = UI_WORDS["post.reposted"].split("{displayName}");
  return (
    <View className="mb-1 flex-row items-center gap-2 pl-6">
      <Icon name="repost" size={16} tone="low" />
      <Text variant="meta" tone="low" className="shrink">
        {before}
        <Link href={`/u/${by.handle}`} asChild>
          <Inline className={cn(INLINE_LINK, "text-ink-medium")}>{by.displayName}</Inline>
        </Link>
        {after}
      </Text>
    </View>
  );
}

/** A quoted post that is gone: its sentence in the text face's italic, on surface-2 (section 8.3). */
function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-media bg-surface-2 px-3 py-2.5">
      <Text tone="medium" italic>
        {tombstone.deleted ? UI_WORDS["post.deleted"] : UI_WORDS["post.unavailable"]}
      </Text>
    </View>
  );
}

/** What a press on a card's empty space must leave alone: its links and controls, which act for themselves. */
const CONTROL = "a, button, input, textarea, select, [role=button], [role=link], [role=dialog], [role=switch]";

/**
 * The open target of a card's body for pointers on the web (section 6.6): a click on the card that is not on one of its
 * links or controls, and that does not end a text selection, opens `href`. A click from a menu or sheet the card opened
 * reaches this handler through React's portal, but is not inside the card's own element, so it is left alone.
 */
function opensOnClick(open: () => void) {
  return (event: MouseEvent & { currentTarget: Element; target: Element }) => {
    const root = event.currentTarget;
    if (!root.contains(event.target)) return;
    const control = event.target.closest?.(CONTROL);
    if (control && root.contains(control)) return;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.anchorNode && root.contains(selection.anchorNode)) return;
    event.stopPropagation();
    open();
  };
}

/**
 * The quoted post as the composer previews it (UI design, Task 6): the same frame and words, with its author line as
 * text, nothing to open and nothing to click, so the composer's sheet holds no live link out of the post being written.
 */
function QuotePreview({ quote }: { quote: QuotedPost }) {
  return (
    <View className="mt-2 rounded-media border border-line-low px-3 py-2.5">
      <View className="flex-row flex-wrap items-center gap-x-1.5">
        <Text variant="body-strong">{quote.author.displayName}</Text>
        {quote.author.verified ? <VerifiedChip /> : null}
        <Text variant="mono" tone="low">
          @{quote.author.handle}
        </Text>
        <Text variant="meta" tone="low">
          {timeAgo(quote.createdAt)}
        </Text>
      </View>
      {quote.body ? <Text className="mt-0.5">{quote.body}</Text> : null}
      <MediaGrid media={quote.media} compact />
    </View>
  );
}

/**
 * A quoted post (section 6.6): a bordered region with its own author line, whose time is the link to the quoted post,
 * so the quote has one open target too; its words are plain text, and its images open nothing, since they belong to the
 * quoted post, where the grid and the viewer are. A press on its empty space opens the quoted post. `preview` is the
 * composer's form, which opens nothing (QuotePreview).
 */
export function QuoteEmbed({ quote, preview = false }: { quote: QuotedPost | Tombstone; preview?: boolean }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  if (preview) return <QuotePreview quote={quote} />;
  const open = () => router.push(`/post/${quote.id}`);
  const content = (
    <>
      <AuthorLine author={quote.author} createdAt={quote.createdAt} postId={quote.id} />
      {quote.body ? <Text className="mt-0.5">{quote.body}</Text> : null}
      <MediaGrid media={quote.media} compact postId={quote.id} />
    </>
  );
  if (Platform.OS !== "web") {
    return (
      <Pressable accessible={false} {...pressDelay(80)} onPress={open} className="mt-2 rounded-media border border-line-low px-3 py-2.5 active:bg-surface-2">
        {content}
      </Pressable>
    );
  }
  return (
    <View {...({ onClick: opensOnClick(open) } as object)} className="mt-2 rounded-media border border-line-low px-3 py-2.5 web:cursor-pointer web:hover:bg-surface-2 web:transition-colors web:duration-[120ms]">
      {content}
    </View>
  );
}

/**
 * The chip on the author's own withheld or removed post (3c design, section 9; UI design, sections 4.8, 6.13 and 8.7).
 * With the decision behind the state it names the rule or says "illegal content", in the review tone while korbat decides
 * and the restricted tone once removed, and is the button that opens StatusSheet, the decision's details, named by its
 * own words; the sheet is mounted only while it is open, and the focus comes back to the chip when it has closed. Its
 * state lives here, in the card, so opening it redraws no row of the list. A view without the decision's facts still
 * says the state, as information only.
 */
function StateChip({ post }: { post: PostView }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMounted, setSheetMounted] = useState(false);
  const chipRef = useRef<View>(null);
  if (post.state === "visible") return null;
  const decision = post.moderation;
  const tone: StatusTone = (decision ? decision.interim : post.state === "withheld") ? "review" : "restricted";
  const words = decision ? chipText(decision) : tone === "review" ? CHIP_WORDS.underReview : CHIP_WORDS.removed;
  const openSheet = () => {
    setSheetMounted(true);
    setSheetOpen(true);
  };
  const closed = () => {
    setSheetMounted(false);
    chipRef.current?.focus();
  };
  return (
    <>
      <StatusChip tone={tone} label={words} onPress={decision ? openSheet : undefined} ref={chipRef} />
      {sheetMounted && decision ? <StatusSheet post={post} decisionId={decision.decisionId} title={words} open={sheetOpen} onClose={() => setSheetOpen(false)} onClosed={closed} /> : null}
    </>
  );
}

/**
 * The delete question's two controls, as the card's actions were before the icons: a word in a 44 px target, Delete in
 * the danger fill, Keep plain. While the request is out both are busy.
 */
function Action({ label, tone = "plain", busy, onPress, ref }: { label: string; tone?: "danger" | "plain"; busy?: boolean; onPress: () => void; ref?: Ref<View> }) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      aria-busy={busy}
      disabled={busy}
      onPress={onPress}
      {...pressDelay(0)}
      className={cn(
        "min-h-[44px] items-center justify-center rounded-control border px-4",
        tone === "danger" ? "border-danger bg-danger web:hover:bg-danger/90" : "border-line-high bg-surface-1 web:hover:bg-surface-2",
        FOCUS_RING,
      )}
    >
      <Text variant="body-strong" tone={tone === "danger" ? "on-danger" : "high"}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Delete this post?" in place of the action row (section 6.6), with Delete and Keep. Keep, the safe answer, takes the
 * focus when the question shows; the card gives it back to More when the question is withdrawn.
 */
export function DeleteQuestion({ postId, busy, onDelete, onKeep, keepRef }: { postId: string; busy: boolean; onDelete: () => void; onKeep: () => void; keepRef?: Ref<View> }) {
  return (
    <View role="dialog" aria-labelledby={`delete-${postId}`} className="mt-2 flex-row flex-wrap items-center gap-2 rounded-card border border-line-high bg-surface-1 px-3 py-2 web:forced-colors:border-[color:CanvasText]">
      <Text nativeID={`delete-${postId}`} variant="body-strong" className="mr-auto">
        {UI_WORDS["post.deleteQuestion"]}
      </Text>
      <Action label={UI_WORDS["post.delete"]} tone="danger" busy={busy} onPress={onDelete} />
      <Action ref={keepRef} label="Keep" busy={busy} onPress={onKeep} />
    </View>
  );
}

/**
 * The Repost menu's items (decision 12): Repost, or Undo repost once reposted, and Quote, a real link to the post's
 * quote composer as today (`?quote=1`), or to sign in for a reader who is signed out.
 */
export function repostMenuItems(post: PostView, signedIn: boolean, onRepost: () => void): MenuItem[] {
  return [
    { label: post.viewer?.reposted ? UI_WORDS["post.unrepost"] : UI_WORDS["post.repost"], icon: "repost", onSelect: onRepost },
    { label: UI_WORDS["post.quote"], icon: "quote", href: signedIn ? `/post/${post.id}?quote=1` : "/signin" },
  ];
}

const NO_VIEWER = { liked: false, reposted: false, bookmarked: false };

/** How long an action's request may be out before its control says it is busy (section 5.2, pending). */
const PENDING_MS = 400;

/**
 * One post in any list (UI design, section 6.6): an article named by its author line, with one explicit link to the post
 * in its time, and for pointers the whole card body as the open target. Reply, Repost (a menu: Repost or Undo repost, and
 * Quote), Like and Save act at once: the state, the icon and the count change on the press, with its haptic and its
 * motion, the request goes out in its kind's lane, and the server's answer replaces the counts, so they never drift; a
 * refusal puts the old state back, nudges the control and says so in a toast, and a write refused for a suspension shows
 * the standing's sentence under the card (3e, 9.4). A signed-out reader is sent to sign in on the first action. More
 * holds Who sees this, Copy link, Delete for the author and Report for everyone else.
 *
 * Below 768 px the images and the quoted post span the card's inner width, from the avatar's edge to the gutter; wider
 * they keep the content column's indent. `large` is the thread's focused post: its words at 19 / 28, the full date and
 * time, and the stats line above the actions (post/[id].tsx passes it in Task 5).
 *
 * In a feed (section 10) the article says its place, `position` from 1 and `setSize` (-1 while more can load); a list's
 * first two rows pass `priority`, so their images load first (11.2); and a thread's ancestors are `joined`: compact,
 * without a divider, and linked to the post below by a 2 px line-low thread line through their avatars (8.3).
 */
export function PostCard({
  post: initial,
  repostedBy,
  onDeleted,
  large = false,
  position,
  setSize,
  priority = false,
  joined = false,
  onReply,
}: {
  post: PostView;
  repostedBy?: Author;
  onDeleted?: (id: string) => void;
  large?: boolean;
  position?: number;
  setSize?: number;
  priority?: boolean;
  joined?: boolean;
  /** What Reply does instead of opening the thread: the thread's own focused post opens its reply card (Task 6). */
  onReply?: () => void;
}) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me.user.id : null;
  const { hideCounts } = useAppearance();
  const phone = useLayout() === "phone";
  const motion = useMotion();
  const haptic = useHaptics();
  const labelId = useId();
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // 3e (design, section 9.4): an action refused account_suspended shows the refusal's sentence from /me, read again after it.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState<Partial<Record<ToggleKind | "delete", boolean>>>({});
  const [feedback, setFeedback] = useState<Partial<Record<ToggleKind, IconButtonFeedback>>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [washed, setWashed] = useState(false);
  useEffect(() => setPost(initial), [initial]);
  const moreRef = useRef<View>(null);
  const keepRef = useRef<View>(null);
  const wasConfirming = useRef(false);
  // The action row, More with it, leaves the tree while the question shows, so a keyboard user would drop to the page
  // body: the safe answer takes the focus, and More takes it back when the question is withdrawn.
  useEffect(() => {
    if (confirmingDelete) keepRef.current?.focus();
    else if (wasConfirming.current) moreRef.current?.focus();
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

  const own = post.author.id === me;
  const viewer = post.viewer ?? NO_VIEWER;
  const openPost = () => router.push(`/post/${post.id}`);
  // Reply (section 6.6): the thread, with its reply card open and focused (?reply=1); signed out, the thread, which says
  // how to sign in to reply.
  const reply = onReply ?? (() => router.push(me === null ? `/post/${post.id}` : `/post/${post.id}?reply=1`));

  /** Marks a kind busy if its request is still out after 400 ms, and returns the function that ends it. */
  const pending = (kind: ToggleKind | "delete") => {
    const timer = setTimeout(() => setBusy((current) => ({ ...current, [kind]: true })), PENDING_MS);
    return () => {
      clearTimeout(timer);
      setBusy((current) => ({ ...current, [kind]: false }));
    };
  };
  const play = (kind: ToggleKind, next: Omit<IconButtonFeedback, "at">) => setFeedback((current) => ({ ...current, [kind]: { ...next, at: (current[kind]?.at ?? 0) + 1 } }));

  function toggle(kind: ToggleKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    // A second tap while this kind's request is out is not sent (lib/social.ts, lanes), and changes nothing on screen.
    if (lanes.busy(laneKey.post(post.id, kind))) return;
    const moves = kind !== "bookmark";
    const done = pending(kind);
    void toggleEngagement(social, lanes, post, kind, setPost, (on) => {
      // Touch and sight on the same frame: the haptic before the state changes, the motion with it.
      haptic(on ? "toggleOn" : "toggleOff");
      play(kind, { turn: on ? "on" : "off", pop: kind === "like" ? "springLike" : "springToggle", count: moves ? (on ? 1 : -1) : 0 });
    }).then((result) => {
      done();
      if (result.status === "busy") return;
      if (result.status === "answered") {
        setRefused(false);
        // Saved: a polite toast says it worked, with the way to the saved posts; unsaving says nothing.
        if (kind === "bookmark" && result.on) toast.show({ message: UI_WORDS["toast.saved"], action: { label: UI_WORDS["toast.view"], onPress: () => router.push("/bookmarks") } });
        return;
      }
      const err = result.error;
      haptic("error");
      play(kind, { turn: "back", count: moves ? (result.on ? -1 : 1) : 0 });
      // A suspension is said under the card in the standing's words; trying again would not help, so no toast says to.
      if (isSuspendedRefusal(err)) setRefused(true);
      else toast.show({ message: failedWords(kind, result.on), tone: "rollback" });
    });
  }

  // The card fades (post-removed, 150 ms; at once under reduced motion) before its list lets it go.
  const opacity = useSharedValue(1);
  const leave = () =>
    new Promise<void>((resolve) => {
      if (motion.reduced) {
        resolve();
        return;
      }
      opacity.value = withTiming(0, motion.timing("easeOut", 150), (finished) => {
        "worklet";
        if (finished) runOnJS(resolve)();
      });
    });
  const removedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  function remove() {
    const done = pending("delete");
    void deleteWithLeave(social, lanes, post.id, leave).then((result) => {
      done();
      if (result.status === "deleted") {
        onDeleted?.(post.id);
        return;
      }
      if (result.status === "refused") {
        const err = result.error;
        setRefused(isSuspendedRefusal(err));
        setError(isSuspendedRefusal(err) ? null : errorMessage(err));
      }
    });
  }

  // The press wash of the card's body (section 5.1): after 80 ms, gone again on 10 px of movement, so a scroll never flashes it.
  const wash = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const unwash = () => {
    if (wash.current) clearTimeout(wash.current.timer);
    wash.current = null;
    setWashed(false);
  };
  const webPress =
    Platform.OS === "web"
      ? {
          onClick: opensOnClick(openPost),
          onPointerDown: (event: PointerEvent & { target: Element; currentTarget: Element }) => {
            const control = event.target.closest?.(CONTROL);
            if (control && event.currentTarget.contains(control)) return;
            unwash();
            wash.current = { timer: setTimeout(() => setWashed(true), 80), x: event.clientX, y: event.clientY };
          },
          onPointerMove: (event: PointerEvent) => {
            if (wash.current && Math.hypot(event.clientX - wash.current.x, event.clientY - wash.current.y) > 10) unwash();
          },
          onPointerUp: unwash,
          onPointerCancel: unwash,
          onPointerLeave: unwash,
        }
      : {};

  const media = <MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />;
  const quote = post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null;
  const stats = large ? threadStats(post.counts, hideCounts) : "";
  const when = postedWhen(post.createdAt);

  const actions = (
    // It wraps rather than cutting More off at the largest text on the narrowest phone.
    <View className="-ml-2.5 mt-1 flex-row flex-wrap items-center">
      <IconButton icon="reply" label={countLabel("reply", post.counts.replies, hideCounts)} count={shownCount("reply", post.counts.replies, hideCounts)} onPress={reply} />
      <Menu
        label={countLabel("repost", post.counts.reposts, hideCounts)}
        title={UI_WORDS["post.repost"]}
        icon="repost"
        items={repostMenuItems(post, me !== null, () => toggle("repost"))}
        trigger={{ pressed: viewer.reposted, disc: viewer.reposted, tone: viewer.reposted ? "accent" : "low", count: shownCount("repost", post.counts.reposts, hideCounts), busy: busy.repost === true, feedback: feedback.repost }}
      />
      <IconButton
        icon="like"
        label={countLabel("like", post.counts.likes, hideCounts)}
        count={shownCount("like", post.counts.likes, hideCounts)}
        pressed={viewer.liked}
        filled={viewer.liked}
        busy={busy.like === true}
        feedback={feedback.like}
        onPress={() => toggle("like")}
      />
      <IconButton
        icon="bookmarks"
        label={viewer.bookmarked ? UI_WORDS["post.saved"] : UI_WORDS["post.save"]}
        tone={viewer.bookmarked ? "accent" : "low"}
        filled={viewer.bookmarked}
        busy={busy.bookmark === true}
        feedback={feedback.bookmark}
        onPress={() => toggle("bookmark")}
      />
      <View className="flex-1" />
      <PostMenu post={post} onDelete={() => setConfirmingDelete(true)} triggerRef={moreRef} />
    </View>
  );

  const content: ReactNode = (
    <>
      {repostedBy ? <RepostLine by={repostedBy} /> : null}
      <View className="flex-row gap-2">
        {/* The avatar opens the profile too, but the name is the one keyboard and screen-reader target. */}
        <Link href={`/u/${post.author.handle}`} asChild>
          <Pressable tabIndex={-1} aria-hidden className="h-11 w-11 items-center justify-center rounded-full">
            <Avatar account={post.author} size={40} />
          </Pressable>
        </Link>
        <View className="min-w-0 flex-1">
          <AuthorLine author={post.author} createdAt={post.createdAt} postId={post.id} large={large} open />
          {own && (post.state !== "visible" || post.inExplore) ? (
            <View className="flex-row flex-wrap gap-x-2">
              <StateChip post={post} />
              {/* The API sets inExplore only on the viewer's own posts; the check keeps the chip on them whatever a view carries. */}
              {post.inExplore ? <StatusChip tone="explore" label={UI_WORDS["post.inExplore"]} href={`/post/${post.id}`} /> : null}
            </View>
          ) : null}
          {post.replyTo ? (
            <Text variant="meta" tone="low">
              {post.replyTo.authorHandle ? UI_WORDS["post.replyingTo"] : UI_WORDS["post.replyingHidden"]}
              {post.replyTo.authorHandle ? (
                <Link href={`/u/${post.replyTo.authorHandle}`} asChild>
                  <Inline className={cn(INLINE_LINK, "text-accent-ink")}>@{post.replyTo.authorHandle}</Inline>
                </Link>
              ) : null}
            </Text>
          ) : null}
          {/* A post may consist of images only, and then there is no text. */}
          {post.body ? (
            <View className="mt-1.5">
              <RichText body={post.body} variant={large ? "post-large" : "post"} />
            </View>
          ) : null}
          {phone ? null : media}
          {phone ? null : quote}
        </View>
      </View>
      {phone ? media : null}
      {phone ? quote : null}
      {/* The stats, the actions and what they answer keep the content column's indent at every width. */}
      <View className="pl-[52px]">
        {stats ? (
          <Text variant="meta" tone="medium" className="mt-3">
            {stats}
          </Text>
        ) : null}
        {confirmingDelete ? (
          <DeleteQuestion postId={post.id} busy={busy.delete === true} onDelete={remove} onKeep={() => setConfirmingDelete(false)} keepRef={keepRef} />
        ) : (
          actions
        )}
        <ErrorText message={error} />
        {refused ? <RefusedNotice standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
      </View>
    </>
  );

  return (
    <Animated.View style={removedStyle}>
      <View
        role="article"
        aria-labelledby={labelId}
        aria-posinset={position}
        aria-setsize={position === undefined ? undefined : setSize}
        {...(webPress as object)}
        // A thread's focused post draws no divider of its own: the thread's block under it does, after Quote this post.
        className={cn(joined ? "px-4 pb-1 pt-3" : large ? "px-4 py-3" : "border-b border-line-low px-4 py-3", "web:transition-colors web:duration-[120ms]", washed ? "bg-surface-2" : "")}
      >
        {/* The thread line, from under the avatar to the next post's avatar: 2 px, line-low, through the avatars' centre. */}
        {joined ? <View pointerEvents="none" aria-hidden className="absolute bottom-0 left-[37px] top-[60px] w-0.5 bg-line-low" /> : null}
        {/* The article's name, the author line as a screen reader should hear it; hidden, and named only through aria-labelledby. */}
        <Text nativeID={labelId} aria-hidden style={VISUALLY_HIDDEN}>
          {fill(UI_WORDS["post.label"], { name: post.author.displayName, handle: post.author.handle, when })}
        </Text>
        {/* The first rows of a list load their images first (11.2): the grid reads it, through the quote's too. */}
        <ImagePriority.Provider value={priority}>
          {Platform.OS === "web" ? (
            content
          ) : (
            // On native the body is one Pressable that the accessibility tree does not see: the time's link does its job there.
            <Pressable accessible={false} {...pressDelay(80)} onPress={openPost} className="-mx-4 -my-3 px-4 py-3 active:bg-surface-2">
              {content}
            </Pressable>
          )}
        </ImagePriority.Provider>
      </View>
    </Animated.View>
  );
}
```

### Replace `apps/app/src/lib/explore.ts` (whole file)

```ts
import { EXPLORE_V2, type ExploreFormula, type ExplorePage, type ExploreStatusKind, type TimelineItem } from "@korbat/contracts";
import { ApiError } from "./api";
import type { ExploreAnswer } from "./social";

/**
 * Explore's texts and the list's decisions (2c design, section 11). Every number in a sentence comes from the formula it
 * is given, EXPLORE_V2 unless a test passes another, so the app says what the refresh does.
 */

/** A ranking older than this when it is read is stale: rounds run every 5 minutes, so by then several have failed or been skipped. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** What the list's status line says once the ranking being paged is gone and the posts below it come from the current one. */
export const EXPLORE_REFRESHED_NOTICE = "Explore was refreshed; the posts below come from the new ranking.";

/** The words of Explore's list (2c design, section 11), word for word as ExploreList.tsx had them before UI Task 5 moved them here. */
export const EXPLORE_WORDS = {
  about: "How Explore works",
  refresh: "Refresh",
  showLatest: "Show Latest",
  signInForMore: "Sign in to see more of Explore",
  /** How Explore works (2c design, section 11), word for word as app/explore/about.tsx had them before UI Task 7. */
  aboutLead: "Explore lists recent posts that other accounts approve of, in an order anyone can check: these are all of its rules and numbers.",
  versionHeading: "Version and changes",
  version: (version: number) => `This is version ${version} of the formula.`,
  change: (change: { version: number; date: string; summary: string }) => `Version ${change.version}, ${change.date}: ${change.summary}`,
  backToExplore: "Back to Explore",
} as const;

/** A page of Explore is the API's default of 20 posts, and a ranking holds at most listLength: one read never needs more pages than this. */
export const MAX_PAGES = Math.ceil(EXPLORE_V2.listLength / 20) + 1;

/** "1 minute", "5 minutes". */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Hours as the texts say them: whole days in days ("2 days"), anything else in hours. */
function duration(hours: number): string {
  return hours > 0 && hours % 24 === 0 ? plural(hours / 24, "day") : plural(hours, "hour");
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** A small count as a sentence says it ("two of your posts"); anything larger stays in digits. */
function numberWord(count: number): string {
  return WORDS[count] ?? String(count);
}

/** When a stale ranking was computed: the time alone on the same day, the date and the time on any other. */
function since(at: Date, now: Date): string {
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString()} ${time}`;
}

/**
 * The ranking on screen as the list read it: when it was computed, the Date header of the answer that carried it (the
 * server's clock then, or null when the answer had none) and the device's clock when that answer arrived.
 */
export interface RankingRead {
  computedAt: string;
  date: string | null;
  receivedAt: number;
}

/**
 * How old the ranking was when it was read: by the answer's Date header, the server's own clock, as the smoke test
 * measures it, so a device clock that is fast or slow changes nothing; by the device's clock only when the header is
 * missing. Never below zero: the header counts whole seconds, so a ranking of the same second would seem to be from the future.
 */
function ageAtRead(ranking: RankingRead): number {
  const served = ranking.date === null ? Number.NaN : Date.parse(ranking.date);
  return Math.max(0, (Number.isNaN(served) ? ranking.receivedAt : served) - Date.parse(ranking.computedAt));
}

/**
 * The line under the tabs, and whether to offer Refresh. Whether the ranking is stale is decided by its age when it was
 * read: past 15 minutes the line says since when Explore has not been updated, which the header shows as a warning. A page
 * left open never turns stale, since the job has written newer rankings meanwhile; its minutes go on from the age when
 * read by the time on screen, which the device's clock measures alone. Refresh is offered once the ranking on screen is
 * as old as the refresh interval, when a newer one should exist.
 */
export function rankingAge(ranking: RankingRead, now: number, formula: ExploreFormula = EXPLORE_V2): { stale: boolean; text: string; offerRefresh: boolean } {
  const atRead = ageAtRead(ranking);
  // The minute clock may last have ticked before the answer arrived: then there has been no time on screen yet.
  const age = atRead + Math.max(0, now - ranking.receivedAt);
  const offerRefresh = age >= formula.refreshMinutes * 60_000;
  if (atRead > STALE_AFTER_MS) return { stale: true, text: `Explore has not been updated since ${since(new Date(ranking.computedAt), new Date(now))}.`, offerRefresh };
  const minutes = Math.floor(age / 60_000);
  return { stale: false, text: minutes === 0 ? "Updated just now" : `Updated ${plural(minutes, "minute")} ago`, offerRefresh };
}

/**
 * What one page adds below the posts on screen: its posts not shown yet, in the ranking's order. Within one ranking the
 * pages never overlap, but after a refresh the new ranking holds posts already shown, and a page can also come back empty
 * when the reader's blocks and mutes took out every post on it. So the next page is read only while a page adds nothing
 * and a cursor follows it: the read stops at the first page that adds some, or at the ranking's end.
 */
export function appendUnseen(shown: ReadonlySet<string>, page: Pick<ExplorePage, "items" | "nextCursor">): { added: TimelineItem[]; nextCursor: string | null; fetchNext: boolean } {
  const seen = new Set(shown);
  const added = page.items.filter((item) => {
    if (seen.has(item.post.id)) return false;
    seen.add(item.post.id);
    return true;
  });
  return { added, nextCursor: page.nextCursor, fetchNext: added.length === 0 && page.nextCursor !== null };
}

export interface PagesRead<P extends ExplorePage = ExplorePage> {
  /** The posts to show below those on screen (or in their place, for a read from the first page), in the ranking's order. */
  added: TimelineItem[];
  /** Load more's cursor, null once the ranking has ended. */
  nextCursor: string | null;
  /** The last page read, whose computedAt and signInForMore the list shows; null only when no page came back. */
  last: P | null;
  /** The ranking being paged was gone (explore_refreshed), and what was added comes from the current one. */
  refreshed: boolean;
}

/**
 * One load of the list: pages from `after` on (the first page when it is undefined), as appendUnseen decides. A cursor
 * names the ranking it came from; when that ranking is no longer kept, the API refuses it with explore_refreshed and the
 * read starts again at the current ranking's first page, still skipping every post on screen, as section 11 of the design
 * says. Any other failure is the caller's to show, and one read never goes through more than `maxPages` pages. The pages
 * come back as `fetchPage` answers them, so the last one keeps whatever the client read with it.
 */
export async function readPages<P extends ExplorePage>(
  fetchPage: (cursor?: string) => Promise<P>,
  after: string | undefined,
  shown: ReadonlySet<string>,
  maxPages: number = MAX_PAGES,
): Promise<PagesRead<P>> {
  const seen = new Set(shown);
  const added: TimelineItem[] = [];
  let cursor = after;
  let last: P | null = null;
  let refreshed = false;
  for (let pages = 0; pages < maxPages; pages++) {
    let page: P;
    try {
      page = await fetchPage(cursor);
    } catch (err) {
      // Only a cursor names a ranking: the first page is always the current one, so a refusal of it is an ordinary failure.
      if (cursor === undefined || !(err instanceof ApiError && err.code === "explore_refreshed")) throw err;
      refreshed = true;
      cursor = undefined;
      continue;
    }
    const step = appendUnseen(seen, page);
    for (const item of step.added) {
      seen.add(item.post.id);
      added.push(item);
    }
    last = page;
    if (!step.fetchNext) return { added, nextCursor: step.nextCursor, last, refreshed };
    cursor = step.nextCursor ?? undefined;
  }
  // The bound was reached with more to read: Load more carries on from here.
  return { added, nextCursor: cursor ?? null, last, refreshed };
}

/** What the Explore list shows: its posts in order, Load more's cursor, the ranking on screen and, signed out, whether more exist. */
export interface ExploreShown {
  items: TimelineItem[];
  /** Load more's cursor: null once the ranking has ended, and always for a signed-out reader. */
  cursor: string | null;
  /** The ranking on screen as it was read, which the header ages; null before the first round. */
  ranking: RankingRead | null;
  /** Signed out, whether posts follow the page shown, which the list's footer then offers after a sign-in. */
  signInForMore: boolean;
}

/** A list that has read nothing yet. */
export const NOTHING_SHOWN: ExploreShown = { items: [], cursor: null, ranking: null, signInForMore: false };

/**
 * The Explore list's reads (2c design, section 11), made once per list and gone with it: it holds what the list shows and
 * lets one read run at a time, so a double press on Load more cannot append a page twice and a refresh cannot land between
 * the pages of a read. `load()` reads from the first page, in place of everything on screen (the first read, pull to
 * refresh, Refresh); `load(cursor)` reads after that cursor, below the posts on screen, which a page of a new ranking
 * cannot add again (readPages). Either answers what the list shows then, with whether the ranking being paged was gone,
 * or null, having fetched nothing, while another read runs; a failed read throws and leaves what the list shows as it was.
 */
export function exploreReader(fetchPage: (cursor?: string) => Promise<ExploreAnswer>, maxPages: number = MAX_PAGES) {
  let shown = NOTHING_SHOWN;
  let inFlight = false;
  return {
    async load(after?: string): Promise<(ExploreShown & { refreshed: boolean }) | null> {
      if (inFlight) return null;
      inFlight = true;
      try {
        const fromStart = after === undefined;
        const result = await readPages(fetchPage, after, new Set(fromStart ? [] : shown.items.map((item) => item.post.id)), maxPages);
        const last = result.last;
        // From the posts on screen now, not when the read began: one may have been deleted from the list meanwhile.
        shown = {
          items: fromStart ? result.added : [...shown.items, ...result.added],
          cursor: result.nextCursor,
          ranking: last === null ? shown.ranking : last.computedAt === null ? null : { computedAt: last.computedAt, date: last.date, receivedAt: last.receivedAt },
          signInForMore: last === null ? shown.signInForMore : last.signInForMore,
        };
        return { ...shown, refreshed: result.refreshed };
      } finally {
        inFlight = false;
      }
    },
    /** Takes a post its author deleted off the list; a read in flight answers without it too. */
    remove(id: string): ExploreShown {
      shown = { ...shown, items: shown.items.filter((item) => item.post.id !== id) };
      return shown;
    },
  };
}

/** The empty list's sentence (2c design, section 11): when a post appears in Explore, and how often it is refreshed. */
export function exploreEmptyText(formula: ExploreFormula = EXPLORE_V2): string {
  return (
    `Nothing to show in Explore right now. A post appears here when at least ${formula.threshold} other accounts, ` +
    `each at least ${duration(formula.engagerMinAgeHours)} old, like or repost it in its first ${plural(formula.windowHours, "hour")}. ` +
    `Explore is refreshed every ${plural(formula.refreshMinutes, "minute")}.`
  );
}

/**
 * The one sentence beside "Show my posts in Explore". Off takes the posts out at the next read. On lets them back at the
 * next refresh (a post still in the current ranking may show again sooner), so the sentence promises no earlier than that.
 */
export function exploreSwitchText(formula: ExploreFormula = EXPLORE_V2): string {
  return (
    "Your public posts can appear in Explore when other accounts like or repost them: turning this off takes them out at " +
    `once, and turning it back on takes effect at the next refresh, which comes every ${plural(formula.refreshMinutes, "minute")}.`
  );
}

/**
 * The author's status line under their own post, in the formula's words and without any count (2c design, sections 8 and
 * 11). Replies and quotes never enter Explore, and their line is left out: null.
 */
export function exploreStatusText(status: ExploreStatusKind, formula: ExploreFormula = EXPLORE_V2): string | null {
  switch (status) {
    case "reply":
    case "quote":
      return null;
    case "not_visible":
      return "Not in Explore: posts under review or removed never appear there.";
    case "suspended":
      // 3e design, section 9.7: what a suspension does to Explore, by its published rule, and when the post may come back.
      return "Not in Explore: your account is suspended, and posts of suspended accounts do not appear there. A post still in its window when the suspension ends can appear from the next refresh.";
    case "hidden_by_author":
      return "Not in Explore: you turned off Show my posts in Explore.";
    case "listed":
      return "In Explore";
    case "outside_window":
      // Version 2 gives a restored post back the time moderation kept it hidden, so the window says so.
      return `Not in Explore: posts can appear only in their first ${plural(formula.windowHours, "hour")}, not counting time in which korbat's moderation kept them from being shown.`;
    case "no_ranking":
      return "Not in Explore yet: the first ranking has not been computed.";
    case "new_since_ranking":
      return "Not in Explore yet: it is newer than the current ranking, so the next refresh will consider it.";
    case "below_threshold":
      return (
        `Not in Explore: fewer than ${formula.threshold} approving accounts. Your own likes, accounts under ` +
        `${duration(formula.engagerMinAgeHours)} old and likes from the last ${plural(formula.standingMinutes, "minute")} do not count.`
      );
    case "pending":
      return "Not in Explore yet: the next refresh will consider it.";
    case "author_cap":
      // The cap keeps an author's highest-scoring posts, so with the author's places full, those posts ranked above this one.
      return formula.perAuthor === 1 ? "Not in Explore: one of your posts ranks above it." : `Not in Explore: ${numberWord(formula.perAuthor)} of your posts rank above it.`;
    case "below_cutoff":
      return `Not in Explore: it ranks below the ${formula.listLength} posts Explore holds.`;
  }
}

/**
 * How Explore works (2c design, section 11): what is ranked, what counts, the score, the list, the refresh, the cold start,
 * what else takes a post out, and the author's controls, with every number from the formula. The page adds the formula's
 * version and change log.
 */
export function exploreRules(formula: ExploreFormula = EXPLORE_V2): { title: string; body: string }[] {
  const engagerAge = duration(formula.engagerMinAgeHours);
  return [
    {
      title: "What is ranked",
      body:
        `Original posts from the last ${plural(formula.windowHours, "hour")}: posts that are not replies or quotes, by accounts that ` +
        "have not switched Explore off and are not suspended when the ranking is computed. Replies belong to their threads. " +
        "Quotes do not enter, because a quote that mocks another post would put that post under the mockery on a public page.",
    },
    {
      title: "What counts",
      body:
        "One thing: the post's approving accounts, meaning the accounts other than its author that liked or reposted it. An " +
        "account that both liked and reposted a post counts once. A like or repost counts when its account still exists, " +
        `is not suspended when the ranking is computed, was at least ${engagerAge} old when it liked or reposted, and the ` +
        `like or repost has stood for at least ${plural(formula.standingMinutes, "minute")}. Replies and quotes do not count, ` +
        "so a pile-on of replies cannot lift a post. Followers, the verified badge and reports are never used.",
    },
    {
      title: "The score",
      body:
        `A post needs at least ${formula.threshold} approving accounts. Its score is the number of approving accounts divided ` +
        `by (the hours it has been shown since it was posted + ${formula.offsetHours}) to the power ${formula.gravity}, so a ` +
        "newer post needs fewer approving accounts to rank as high as an older one. A post that korbat's moderation hid and " +
        "then restored gets that time back: its window and its age stand still while it is not shown.",
    },
    {
      title: "The list",
      body:
        `Explore holds the ${formula.listLength} posts with the highest scores, with at most ${formula.perAuthor} posts of one ` +
        "account: that account's highest-scoring ones. Posts with equal scores are ordered by their ids. Only the order is " +
        "shown: no score, rank or count.",
    },
    {
      title: "The refresh",
      body:
        `A new ranking is computed every ${plural(formula.refreshMinutes, "minute")}, never sooner than ` +
        `${plural(formula.minGapMinutes, "minute")} after the last one. The newest ${formula.kept} rankings are kept, so you ` +
        "can finish paging through the one you started; once it is gone, the list says so and goes on with the newest one. " +
        `Signed out, you see the first ${formula.signedOutPage} posts.`,
    },
    {
      title: "A new korbat",
      body:
        `Only accounts at least ${engagerAge} old count, so on a new korbat Explore stays empty for about ${engagerAge} after ` +
        `it opens. A like or repost made in an account's first ${engagerAge} never counts, even after the account is older.`,
    },
    {
      title: "What else takes a post out",
      body:
        // 3e design, section 9.7: a suspension takes the author's posts out by a published rule, never as a lever on
        // Explore alone; the automatic R1 and R2 checks are gone, since rulebook version 2 has none.
        "Besides the formula, only these take a post out of Explore: its moderation state, set by a moderator for every " +
        "list at once; a suspension of its author, which a moderator decides with a statement of reasons and which stops " +
        "everything the account writes, never Explore alone; its author's switch or deletion; a block between you and the " +
        "author in either direction; your mute. No moderator or automatic lever acts on Explore alone.",
    },
    {
      title: "Your posts",
      body:
        "Show my posts in Explore, in Settings > Privacy, keeps your posts out: turning it off takes them out at once, and " +
        "turning it back on takes effect at the next refresh. The page of each of your posts says whether it is in Explore " +
        "and, if not, which rule keeps it out, without counting who liked it.",
    },
  ];
}
```

### Replace `apps/app/src/lib/moderation-words.ts` (whole file)

```ts
import { AUTOMATION_RULES, CSAM_NOTICE_MAX_ACCOUNTS, DAILY_LIMITS, NOTICE_LIMITS, type CsamKeywordChoice, type TdbFormCategory } from "@korbat/contracts";
import { IMAGE_LOST_NOTICE } from "@korbat/rules";

/**
 * The app's words for reports, notices and moderation cases (3c design, section 9): the report form, the notice status
 * page, the cases screens, the chips and the labels. Each sentence is written here once and the screens take it from
 * here; the words of an outcome, of a statement and of a rule are not here at all: they come from @korbat/contracts and
 * @korbat/rules, which the mails and the staff console use too, so the app can never word them differently.
 */

/** A small count as a word, as the form's sentences print the limits; a larger one as digits. */
export function numberWord(count: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][count] ?? String(count);
}

const PROFILE_LIMIT = `${numberWord(CSAM_NOTICE_MAX_ACCOUNTS)} ${CSAM_NOTICE_MAX_ACCOUNTS === 1 ? "profile" : "profiles"}`;

/** What follows every sentence that offers the contact address in place of the form. */
const MAIL_INSTEAD = (contact: string) => `email your report to ${contact} with the korbat links of what you report and why. Do not attach images or files: korbat does not open them.`;

export const REPORT_WORDS = {
  control: "Report",
  imageControl: "Report this image",
  title: "Report to korbat",
  question: "What is wrong with it?",
  /** The three grounds, of equal weight and in this order. */
  grounds: {
    rule: "It breaks a korbat rule",
    illegal: "It is illegal",
    csam: "It is sexual abuse or exploitation of a child, child sexual abuse material, or grooming of a child",
  },
  whichRule: "Which rule?",
  /** In the list of rules, in R2's place: such a report goes the third way. */
  r2Instead: "Child sexual abuse material: choose the third answer, which is anonymous.",
  explanation: "Anything the moderator should know",
  category: "What kind of illegal content is it?",
  categoryNotSure: "I am not sure",
  /** Directly below the categories. */
  csamInstead: "For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, choose the third answer, which is anonymous.",
  citedLaw: "Which law or country (optional)",
  whyIllegal: "Why is it illegal?",
  alsoRule: "A korbat rule it also breaks (optional)",
  noRule: "None",
  which: "Which is it?",
  keywords: {
    csam: "Sexual images or videos of a child",
    deepfake: "Such images made or altered by software",
    grooming: "An adult seeking sexual contact with a child",
    abuse: "Other sexual abuse or exploitation of a child, such as offering a child for sex",
  } satisfies Record<CsamKeywordChoice, string>,
  csamExplanation: "Anything korbat should know (optional)",
  anonymous: "This report is anonymous: korbat does not record who sent it, not even your account. Keep the link we show you to follow it.",
  profileOnly: "If you can, report the post or the image itself: open it and choose Report. From a profile alone korbat cannot tell which image you mean, and its answer covers the images on all the profile's posts.",
  oneProfile: `On this path a report can name ${PROFILE_LIMIT}. Send another report for the next one.`,
  item: "What you report",
  itemPost: "This post",
  itemImage: "One image of this post",
  itemProfile: (handle: string) => `The profile @${handle}`,
  link: "Link to the post or profile on korbat",
  otherItems: "Other items",
  otherItemsHint: `You can add up to ${numberWord(NOTICE_LIMITS.maxTargets - 1)} more korbat links.`,
  otherLink: (n: number) => `Link ${n}`,
  addLink: "Add another link",
  removeLink: "Remove",
  bonaFide: "I believe in good faith that the information in this report is accurate and complete.",
  name: "Your name (optional)",
  email: "Your email (optional)",
  contactHint: "Without an email we cannot send you a receipt or our decision. korbat never shows your name or email to the person you report.",
  /** The privacy line's three sentences; the second is not shown on the anonymous path, which records no sender. */
  privacy: {
    use: "korbat uses what you send only to handle this report; how long it keeps it is in the terms.",
    sender: "Moderators see who sent a report only when a case needs it, for example when you report an account impersonating you; each time is recorded and shown to every staff member.",
    access: "If the person you report asks korbat for their data, the law may require korbat to give them what you wrote, never your name, email or account.",
  },
  turnstile: "Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check.",
  send: "Send report",
  /** What the form says in place of sending while something is missing. */
  missing: {
    ground: "Choose what is wrong with it.",
    rule: "Choose the rule it breaks.",
    keyword: "Choose which it is.",
    link: "Give the link to the post or profile on korbat.",
    linkInvalid: "A link must be a whole address that begins with http:// or https://.",
    whyIllegal: "Say why it is illegal.",
    bonaFide: "Confirm that you report in good faith.",
    human: "Wait for the check that you are not a bot.",
    details: "Some details are missing or invalid.",
  },
  sent: "Your report was received",
  reference: (ref: string) => `Its reference is ${ref}.`,
  keepLink: "Keep this link to follow your report or ask for a decision to be re-examined. It is shown only now.",
  copy: "Copy",
  copied: "Copied",
  followInSettings: "You can follow it under Settings, Cases, Your reports.",
  yourReports: "Your reports",
  /** The three failures the form words itself, each naming the users' contact address. */
  humanCheckFailed: (contact: string) => `The check that you are not a bot failed. Try again, or ${MAIL_INSTEAD(contact)}`,
  rateLimited: (wait: string, contact: string) =>
    `korbat cannot take another report from this network or account right now: it takes at most ${NOTICE_LIMITS.signedOut.perHour} reports an hour and ${NOTICE_LIMITS.signedOut.perDay} a day without an account, and ${NOTICE_LIMITS.signedIn.perHour} an hour and ${NOTICE_LIMITS.signedIn.perDay} a day with one. Try again in about ${wait}, or ${MAIL_INSTEAD(contact)}`,
  unavailable: (contact: string) => `korbat cannot take reports right now. Try again in a few minutes, or ${MAIL_INSTEAD(contact)}`,
  /** After each of the three on the anonymous path: a mail is not anonymous. */
  mailShowsAddress: "An email shows korbat your address. korbat deletes your email, and its reply to you, once your report is entered.",
  /** UI Task 7: the form's, the sent screen's and the status page's link home, once written in their markup. */
  back: "Back to korbat",
} as const;

/** The Transparency Database's names for the categories the illegal ground offers. */
export const CATEGORY_LABELS: Record<TdbFormCategory, string> = {
  STATEMENT_CATEGORY_ANIMAL_WELFARE: "Animal welfare",
  STATEMENT_CATEGORY_CONSUMER_INFORMATION: "Consumer information infringements",
  STATEMENT_CATEGORY_CYBER_VIOLENCE: "Cyber violence",
  STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN: "Cyber violence against women",
  STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS: "Data protection and privacy violations",
  STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH: "Illegal or harmful speech",
  STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS: "Intellectual property infringements",
  STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS: "Negative effects on civic discourse or elections",
  STATEMENT_CATEGORY_PROTECTION_OF_MINORS: "Protection of minors",
  STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY: "Risk for public security",
  STATEMENT_CATEGORY_SCAMS_AND_FRAUD: "Scams and fraud",
  STATEMENT_CATEGORY_SELF_HARM: "Self-harm",
  STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS: "Unsafe, non-compliant or prohibited products",
  STATEMENT_CATEGORY_VIOLENCE: "Violence",
};

const OUTSIDE_KORBAT = "go to court, or complain to the Digital Services Coordinator of the EU country where you live.";

export const STATUS_WORDS = {
  title: "Your report",
  reference: (ref: string) => `Reference ${ref}`,
  received: (time: string) => `Received on ${time}.`,
  item: (n: number) => `Item ${n}`,
  /** The heading of an item korbat added for the post a named post quotes. */
  added: (n: number, link: string) => `The post that item ${n} quotes (${link}), added by korbat`,
  waiting: "Not decided yet.",
  decided: (day: string) => `Decided on ${day}:`,
  reexaminationLabel: "Re-examination",
  /** Beside an item whose answer can still be examined again: what that is, and until when. */
  reexaminationOpen: (until: string) => `A moderator decides it again as a new report. You can ask once for each item, within six months of being told, until ${until}.`,
  /** The control beside such an item: its button, its optional statement, and what it says once asked. */
  reexamine: "Ask for a re-examination",
  reexamineStatement: "Anything you want the moderator to know (optional)",
  /** Beside the control of a report of child sexual abuse material whose added item can be examined again too. */
  reexamineBoth: "korbat examines the post it quotes again as well.",
  /** Beside an outcome a review or a correction changed, and a re-examination's answer. */
  final: `This is final within korbat. You can also ${OUTSIDE_KORBAT}`,
  /** Beside any other decided outcome that cannot be examined again. */
  courts: `You can ${OUTSIDE_KORBAT}`,
  contact: "Emails about this report",
  confirmed: "This address is confirmed as the sender's.",
  unconfirmed: "korbat has not been told yet whether this address sent the report.",
  confirm: "Yes, I sent this: keep me informed",
  stop: "I did not send this: stop korbat's report emails to this address",
  stopHint: "This also stops korbat's emails about reports you send yourself from this address, signed in or not, until you undo it on this page or, if a korbat account uses this address, under Settings, Cases, Your reports.",
  stopped: "korbat's report emails to this address are stopped.",
  undo: "Undo: email this address about reports again",
  retry: "Try again",
} as const;

/**
 * The day's limits of the two forms that ask korbat to look again, an appeal and a re-examination (3c design, section
 * 7.7): worded with their number and the wait the answer gives, since the wait can be a whole day. An appeal is counted
 * per account; a re-examination per account, and without one per network.
 */
export const DAILY_LIMIT_WORDS = {
  appeals: (wait: string) => `korbat takes at most ${DAILY_LIMITS.appeals} appeals a day from one account. Try again in about ${wait}.`,
  reexaminations: (wait: string) => `korbat takes at most ${DAILY_LIMITS.reexaminations} requests for a re-examination a day from one account, or without an account from one network. Try again in about ${wait}.`,
};

/**
 * 3d Task 6 (design, sections 9.4, 9.6 and 9.7): a measure a program took, as its author sees it: the chip [auto.chip]
 * beside the day, "Ask for a person" [auto.ask] under its lead [auto.askLead], the request as sent [auto.asked] with the
 * published target, and once a person has decided [auto.decided] with a link to that decision; the row of "About you";
 * and objection_not_open's words, which are [auto.decided] without the day. The target is the contracts' constant, a
 * published target and never an end: the measure lapses by no timer.
 */
export const AUTO_WORDS = {
  chip: "Taken by a program",
  row: (what: string) => `Taken by a program: ${what}`,
  ask: "Ask for a person",
  askLead:
    "Write anything a person should know. You can send one message. A moderator reads it and lifts the measure or decides the case; for sealed images an admin does. You get that decision's statement either way. You do not need to cite rules or law.",
  askField: "Your message to a person",
  asked: (createdAt: string) => `You asked for a person on ${createdAt}. korbat's target is an answer within ${AUTOMATION_RULES.objectionTargetHours} hours.`,
  decided: (decidedAt: string) => `A person has decided since: the decision of ${decidedAt}, listed under Settings, Cases.`,
  decidedLink: "Open that decision",
  notOpen: "A person has decided since: the decision is listed under Settings, Cases.",
  /** 3d review L10 (people8): objection_exists, a second request from a stale screen or another device; nobody has decided. */
  exists: "You have already asked for a person about this decision. A person reads what you wrote.",
} as const;

export const CASES_WORDS = {
  nav: "Cases",
  title: "Cases",
  tabs: { about: "About you", reports: "Your reports" },
  noDecisions: "korbat has made no decision about your posts or your profile.",
  noReports: "You have sent no reports.",
  post: (time: string) => `Your post of ${time}`,
  profile: "Your profile",
  law: "the law",
  rule: (id: string) => `Rule ${id}`,
  decidedOn: (day: string) => `Decided on ${day}`,
  whileDeciding: "while korbat decides",
  ended: "What korbat did while deciding has ended",
  noAction: "No action",
  /** A review that kept the decision lifts nothing, and is no decision to take no action. */
  keptDecision: "korbat kept its decision",
  review: "the answer to your appeal",
  correction: "a correction by korbat",
  appealOpen: (until: string) => `You can appeal until ${until}`,
  /** Where the author's appeal of a decision stands, in the list. */
  appealState: {
    pending: "Your appeal waits for a reviewer",
    kept: "Your appeal was answered: korbat kept its decision",
    partly_reversed: "Your appeal was answered: korbat reversed part of its decision",
    reversed: "Your appeal was answered: korbat reversed its decision",
  },
  reversed: (day: string) => `Reversed in full on ${day}`,
  more: "Show more",
  report: (ref: string, time: string) => `Report ${ref}, sent on ${time}`,
  mailStopped: "korbat does not email you about your reports, because someone using your email address asked it to stop. Their outcomes are listed here.",
  resume: "Email me about my reports again",
  resumeHint: "korbat may then also email this address about reports sent without an account that give it.",
} as const;

export const DECISION_WORDS = {
  title: "korbat's decision",
  /** 3d (design, section 9.1): the link after the rule a statement names. */
  rulesPage: "The rules page",
  back: "All cases",
  statement: "Statement of reasons",
  content: "What this decision was made on",
  post: (time: string) => `Your post of ${time}`,
  noText: "The post had no text.",
  displayName: "Display name",
  bio: "Bio",
  handle: "Handle",
  empty: "(empty)",
  r4Redacted: "Content erased when the R4 decision became final",
  erased: (day: string) => `korbat's copy of the content this decision was made on was erased on ${day} under its retention rules (Terms, Your data).`,
  postKept: "The post itself stays in your profile while you keep it.",
  deleted: "You deleted this post. korbat keeps this copy for the case for the periods in its terms.",
  deletedImages: "Images kept for the case, not shown",
  resetDecision: "The decision that reset it",
  appeal: "Appeal",
  appealUntil: (until: string) => `You can appeal this decision until ${until}.`,
  /** The appeal's form: a statement is optional and free of form. */
  appealHint: "Tell us anything you want the reviewer to know. You do not need to cite rules or law.",
  appealStatement: "Your appeal (optional)",
  appealFiled: (day: string) => `You appealed on ${day}.`,
  /** A pending appeal: that it waits for a reviewer, or, when nobody at korbat can review it now, why. */
  appealWaiting: "Waiting for a reviewer",
  appealWaits: {
    none_single_staff: "Your appeal waits for a moderator who did not take part in the decision. korbat has one moderator at the moment.",
    none_eligible: "Your appeal waits for a moderator who took no part in this case. None is available now; your appeal stays open until one is.",
    admin: "Your appeal waits for an admin who did not take part in the decision.",
    oneAdmin: "korbat has one admin at the moment.",
    sealed: "Sealed images are reviewed once the authorities have assessed them. Your appeal stays open until then.",
  },
  appealAnswered: (day: string) => `Answered on ${day}`,
  appealAnswer: "The answer to your appeal",
  answerScreen: "This answer on a screen of its own",
  reversed: (day: string) => `Reversed in full on ${day}: nothing of this decision is in force, so there is nothing to appeal.`,
  notFound: "That decision does not exist, or it is not about your account.",
  /** A statement is never rendered with another version of the rules than the one it was made under. */
  cannotRender: "This decision was made under a version of the rules this page does not hold yet. Reload the page to read it.",
} as const;

/**
 * The details sheet of the author's moderation chip (UI design, section 8.7; UI Task 7): its labelled blocks, in the
 * design's keys. "Decided by" names a role, never a person: a moderator, korbat's automated check only for a decision
 * DecisionView marks fully automated, or an authority's order. `status.illegal` is the Rule block's words for a decision
 * on the law, which the design's table lacks; its legal reference follows it.
 */
export const STATUS_SHEET_WORDS = {
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
} as const;

/** The chip on the author's own withheld or removed post, and the labels on their own images. */
export const CHIP_WORDS = {
  underReview: "Under review",
  removed: "Removed",
  illegal: "illegal content",
} as const;

/**
 * 3d (design, sections 7.1 and 9.6): what the author reads in the place of an image of their own post that did not load,
 * once the image's status says why: its files are being moved back after its seal was lifted ([image.restoring]), or
 * korbat lost them while they were kept apart ([image.lost], the words of the mail image_lost, IMAGE_LOST_NOTICE). Anyone
 * else sees what a missing image shows.
 */
export const IMAGE_FAULT_WORDS = {
  restoring: "This image is being restored. It is shown again once korbat has moved it back; you do not need to do anything.",
  lost: IMAGE_LOST_NOTICE.onImage,
} as const;

/**
 * 3d Task 2 (design, sections 7.2 and 9.6; W.6): a release of sealed images of the author's posts, on its screen under
 * Settings, Cases, and its entry in "About you". The notice's paragraphs are RELEASE_NOTICE's (packages/rules), which the
 * mail release_notice shares; these are the screen's own words around them. None names an authority, a reference or an
 * assessment.
 */
export const RELEASE_TEXTS = {
  title: "Sealed images released",
  /** The entry in "About you", with its day. */
  entry: "Sealed images released",
  entryOn: (day: string) => `On ${day}`,
  noticesTitle: "Notices",
  /** The link to the decision that sealed. 3d review L11: the notice's own paragraph says where its appeal stands. */
  decision: "The decision that sealed the images",
  notFound: "That notice does not exist, or it is not about your posts.",
} as const;

/**
 * 3d Task 7 (design, sections 9.5, 9.6 and 9.7): a refused upload as its uploader sees it: the composer's tile
 * [upload.refused] with its link "Why", the post refused while it is attached [upload.refusedPost], the entry in "About
 * you", and on the notice's screen "Object" [upload.object] under [upload.objectLead], then [upload.objected]. The
 * notice's own paragraphs are UPLOAD_NOTICE's (W.5), which the mails share.
 */
export const UPLOAD_TEXTS = {
  title: "An upload was not accepted",
  entry: "An upload was not accepted",
  entryOn: (day: string) => `On ${day}`,
  refused: "This image was not accepted.",
  why: "Why",
  refusedPost: "This image was not accepted, so the post was not sent. Remove the image to post. Its notice is under Settings, Cases.",
  object: "Object",
  // 3d review L7 (people5): the terms' period (Your data), the upload's record of a match, which outlasts the file.
  objectLead: "Write anything the admin should know. You can send one message. The admin reads it and decides without viewing the image. What you write is kept as long as this upload's record of a match (Terms, Your data).",
  objectField: "Your message to the admin",
  objected: (objectedAt: string) => `You objected on ${objectedAt}. An admin reads what you wrote; korbat tells you here what was decided, and by email when the hold is lifted.`,
  /** objection_not_open on this screen: the objection is sent, or the hold has ended. */
  notOpen: "You cannot object now: you objected already, or the hold has ended. Read the notice again.",
  notFound: "That notice does not exist, or it is not about your uploads.",
} as const;

/** The terms page's Contact section, built from the build's contact address; it is not part of the terms' own sections. */
export const CONTACT_WORDS = {
  title: "Contact",
  body: (contact: string) => `Write to korbat at ${contact} when the report form does not work for you, to ask for your data, or about a decision. A person reads every email. Do not attach images or files: korbat does not open them.`,
  report: "Report something on korbat",
} as const;
```

### Replace `apps/app/src/lib/terms.ts` (whole file)

```ts
import {
  ACCOUNT_MEASURE_SCOPE,
  APPEAL_MONTHS,
  AUTOMATION_RULES,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  ITEM_OUTCOMES,
  MEASURES,
  MEASURE_KINDS,
  NOTICE_LIMITS,
  ORDER_RULES,
  OUTCOME_PHRASES,
  RECIPIENT_RULES,
  REPLY_AIM_HOURS,
  RETENTION,
  RETIRED_HANDLE_PREFIX,
  REVERSAL_KINDS,
  STANDING_RULES,
  STATE_FACTS,
  SUSPECT_EARLIER_MONTHS,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  type ItemOutcome,
  type MeasureKind,
  type StateFacts,
} from "@korbat/contracts";
import { RULES, RULES_VERSION } from "@korbat/rules";
import { numberWord } from "./moderation-words";

/**
 * The terms shown at sign-up. TERMS_VERSION must equal the API's TERMS_VERSION setting; change both
 * together whenever the text changes, so every account records which version it accepted.
 */
export const TERMS_VERSION = "draft-2026-09";

/** The terms page's own words around its sections (UI Task 7), word for word as app/terms.tsx had them in its markup. */
export const TERMS_PAGE = {
  title: "korbat terms",
  version: (version: string) => `Version ${version}`,
  back: "Back to korbat",
} as const;

/**
 * The moderation sections (3c design, section 9) state each rule of the mechanism once more, for the people it is
 * applied to. So that the text cannot drift from the mechanism, nothing it shares with the mechanism is typed here: every
 * limit and period is printed from the contracts' constants, the rules from the rulebook, the measures from the ledger's
 * own table and an answer's phrases from the table the mails and the screens read. A test changes those constants and
 * finds the terms changed with them (test/terms.test.tsx). 3e's sections (design, W.7) print every number of account
 * sanctions from STANDING_RULES, the days after which a mail is given up from RETENTION.mailGiveUpDays and the hours
 * korbat aims to answer a reply in from REPLY_AIM_HOURS, which the code that acts on each reads.
 */

/** A section's paragraphs are kept in one text, a blank line between two. */
const PARAGRAPH_BREAK = String.fromCharCode(10, 10);
const paragraphs = (...parts: string[]): string => parts.join(PARAGRAPH_BREAK);

/** A section's body as its paragraphs, for the page to set apart. */
export function termsParagraphs(body: string): string[] {
  return body.split(PARAGRAPH_BREAK);
}

/** A count as the terms print it: a small number as a word, and its noun in the singular or the plural. */
const count = (n: number, one: string): string => `${numberWord(n)} ${n === 1 ? one : `${one}s`}`;

/** A share as the terms print it: half as a word, any other share as a percentage, so the sentence follows the constant. */
const share = (fraction: number): string => (fraction === 0.5 ? "half" : `${fraction * 100} percent`);

/** A list inside a sentence: "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);

/** A rule's name inside a sentence: its title in the rulebook without the leading "No". */
const ruleName = (rule: { title: string }): string => rule.title.replace(/^No /, "");

/** The rules whose final decisions only an admin takes, as the rulebook marks them. */
const ADMIN_RULES = orList(RULES.filter((rule) => rule.seniorQueue).map((rule) => rule.id));

/** The rule on doxxing, whose restricted content is erased once the restriction is final, as a sentence names it. */
const R4 = (() => {
  const rule = RULES.find((candidate) => candidate.id === "R4");
  if (!rule) throw new Error("the rulebook holds no rule R4");
  return `rule ${rule.id} (${ruleName(rule)})`;
})();

/**
 * What each measure does, beside its label. A measure added to the ledger does not compile until it is explained here.
 * 3e's six (design, W.1) point to the section that says the rest; W.7 has no words for them, so these are written here.
 */
const MEASURE_MEANINGS: Record<MeasureKind, string> = {
  withhold: "the post is hidden from other people; you still see it",
  remove: "the post is removed for other people; it stays in your own view while you keep it",
  seal_media: "the images the case covers are shown to nobody, you included",
  withhold_media: "one image of a post is hidden from other people; you still see it",
  remove_media: "one image of a post is removed for other people; it stays in your own view",
  reset_display_name: "the display name is replaced by the account's handle",
  reset_bio: "the bio is emptied",
  strike: "a mark on the account that restricts nothing by itself and counts toward a suspension, as Strikes says",
  suspend: "for a number of days the account can no longer post, engage, follow, edit its profile or report under the rules, as Suspension and termination says",
  terminate: "the account is suspended until the decision is final, and then deleted, as Suspension and termination says",
  retire_handle: "the handle can be used by nobody again, and the profile shows a placeholder in its place, as Handles says",
  warn_reporting: "a warning about reports that are manifestly unfounded, which restricts nothing, as Reporting in bad faith says",
  restrict_reporting: "for a number of days korbat takes no report under its rules from the account, as Reporting in bad faith says",
  // 3f: no decision of korbat's takes it; only an authority's order does, which the terms' sections on orders describe.
  // 3f's review (people5): a DSA order that does not ask that the post be kept from its author leaves it to them.
  disable_by_order: "the post and its images are shown to nobody, or to nobody but you when the order does not ask that they be kept from you, because an authority ordered it",
};

/** The measures of one sentence, each by the label its decision records and what it does. */
const measureList = (kinds: readonly MeasureKind[]): string => kinds.map((kind) => `"${MEASURES[kind].label}" (${MEASURE_MEANINGS[kind]})`).join("; ");
// The ledger's own two marks sort the measures into the three sentences; every kind of the ledger is listed.
const WHILE_DECIDING = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && !MEASURES[kind].final);
const WHEN_DECIDED = MEASURE_KINDS.filter((kind) => !MEASURES[kind].interim && MEASURES[kind].final);
const EITHER = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && MEASURES[kind].final);
// 3f: the measure no decision of korbat's own takes, which an authority's order alone does.
const BY_ORDER = MEASURE_KINDS.filter((kind) => !MEASURES[kind].interim && !MEASURES[kind].final);
const LIFTED = REVERSAL_KINDS.map((kind) => `"${MEASURES[kind].label}"`).join("; ");

/**
 * Every measure of the ledger with its label and what it does, sorted by when korbat may take it. 3d Task 4 (design,
 * section 9.2): the rules page prints the same paragraph under "What korbat can do, and when", so it is exported.
 */
export const MEASURES_PARAGRAPH = `korbat's measures are these, and no others; each is named as a decision records it. While korbat decides a case: ${measureList(WHILE_DECIDING)}. When the case is decided: ${measureList(WHEN_DECIDED)}. While it decides or when the case is decided: ${measureList(EITHER)}. On an authority's order alone, never on korbat's own judgement: ${measureList(BY_ORDER)}. A later decision can lift each of them again: ${LIFTED}.`;

/** What each outcome of a report means. An outcome added to the contracts does not compile until it is explained here. */
const OUTCOME_MEANINGS: Record<ItemOutcome, string> = {
  restricted_rule: "a moderator found that the item breaks the rule the answer names, and korbat restricted it.",
  restricted_legal: "a moderator found the item illegal under EU law or the law of an EU country, and korbat restricted it everywhere.",
  no_violation: "a moderator found that the item breaks no rule and is not illegal, and korbat left it as it was.",
  not_evident:
    'this is what "illegality not evident" means: a moderator found no breach of a rule and could not tell from the item and from what you wrote, without a detailed legal examination, that it is illegal. korbat does not settle legal disputes; it leaves such an item up, and a court or an authority can order its removal.',
  not_available: "the link named no post or profile that korbat can show: it does not exist, or its author deleted it. This answer is given automatically, and no person looked at the link.",
  partly_reversed: "on its author's appeal or by a correction, korbat lifted part of what it had done about the item.",
  reversed: "on its author's appeal or by a correction, korbat lifted all of what it had done about the item.",
};

/** An outcome's phrase as the terms quote it: the rule's number and title are named, not filled in. */
const quoted = (phrase: string): string => phrase.replace("{rule}", "[number]").replace("{title}", "[title]");

/** One paragraph for each phrase an answer can read, with what it means: the seven outcomes, then the three that stand in for them where nobody opened the images. */
const ANSWERS: string[] = [
  ...ITEM_OUTCOMES.map((outcome) => `"${quoted(OUTCOME_PHRASES[outcome])}": ${OUTCOME_MEANINGS[outcome]}`),
  `"${SUSPECT_OUTCOME_PHRASES.sealed}": korbat's answer to a report on the anonymous path, and to any other report that the same decision answers, when images were sealed. It never says that korbat found something about the images, since nobody at korbat opened them.`,
  `"${SUSPECT_OUTCOME_PHRASES.no_action}": korbat's answer to a report on the anonymous path when an admin sealed nothing and restricted nothing.`,
  `"${UNSEEN_NO_ACTION}": korbat's answer to a report on another ground about a post, when a moderator took no action while nobody at korbat could open the post's images. It does not use up your one request for a re-examination.`,
];

const COURTS = "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.";

/**
 * 3e's four sections (design, W.7), in the design's words, each number printed from the constant the code that acts on
 * it reads: STANDING_RULES for the standing rules, RETENTION.mailGiveUpDays for the days after which a mail is given up,
 * REPLY_AIM_HOURS for korbat's aim in answering a reply, APPEAL_MONTHS for the appeal. The placeholder's prefix is the
 * handle rule's own.
 */
const S = STANDING_RULES;
const [FIRST_RUNG, SECOND_RUNG, THIRD_RUNG] = S.ladderDays;

// 3d Task 4 (design, section 9.2): the rules page prints these three sections and Terrorist content with the same
// builders, so one number has one sentence in both places (a table test holds both).
export const STRIKES = `When a moderator's final decision finds that a post of yours breaks a korbat rule, the decision also gives your account a strike. A strike restricts nothing by itself and is used for one thing: counting toward a suspension. It counts for ${count(S.strikeDays, "day")} from its decision. A decision gives no strike when it rests on the law alone, when it concerns child sexual abuse material (rule R2), when it is about your profile and not a post, or while korbat is still deciding. A post gets at most one strike, and a post you made before you were told of your newest strike gets none, so several posts decided in one sitting count as one warning. A strike also counts when the post was already removed or deleted. The decision's statement tells you of the strike, until when it counts and how many you have; your strikes are listed under Settings, Cases. A strike falls only with its decision: appeal that decision, and if it is reversed the strike stops counting at once, and a suspension that rested on it ends at once if fewer than ${numberWord(S.ladderStrikes)} of its strikes still stand. If that suspension was already over, it no longer counts toward a later one.`;

export const SUSPENSION = paragraphs(
  `When your account has ${numberWord(S.ladderStrikes)} active strikes at once, a moderator may decide to suspend it: for at most ${count(FIRST_RUNG, "day")} the first time, ${numberWord(SECOND_RUNG)} the second and ${numberWord(THIRD_RUNG)} the third, counting the suspensions decided in the last ${count(S.ladderMemoryDays, "day")}. A moderator may choose fewer days, never more, and a moderator who chose fewer days still used that step. After a suspension, one further strike is enough for the next step while at least ${numberWord(S.ladderStrikes - 1)} earlier strikes still count. After ${numberWord(S.ladderDays.length)} such suspensions in that time, whatever their length, the next step may be the termination of the account, which only an admin decides. Nothing happens automatically: a moderator reads the strikes and decides. Such a decision finds no new breach: its ground is this section, and its statement says so and lists the strikes it rests on.`,
  `korbat tells you first. The decision is always shown in the app with its reasons, and korbat also sends it to you by email. The suspension starts ${count(S.replyWindowHours, "hour")} after korbat sent that email. If korbat's mail service refuses your address or cannot send the email for ${count(RETENTION.mailGiveUpDays, "day")}, only the app can tell you, and the suspension starts ${count(S.undeliveredHours, "hour")} after the decision. korbat cannot see whether an email it sent reached you, so keep the address of your account current. The app shows the start as a date and time. If you reply before the start, it does not start until a moderator has read your reply and answered you; the answer reverses the decision, or keeps it, and then the suspension starts with the answer and never before the time you were first given. A reply sent later is read and answered too, and can end the suspension, but does not pause it. You can reply once, and replying does not use up your appeal: when korbat keeps a decision after a reply you sent before the start, your ${count(APPEAL_MONTHS, "month")} to appeal count again from that answer.`,
  `korbat suspends an account at once, before any reply, only in four cases, each decided by an admin: after a final decision that a post of the account is a direct threat of violence (rule R5), for up to ${count(S.threatDays, "day")}; after a final decision that a post of the account is terrorist content, for up to ${count(S.terroristDays, "day")}; when an admin finds that the account is flooding korbat with repetitive, unsolicited posts (rule R6) and it made ${S.floodPosts} or more posts within ${count(S.floodMinutes, "minute")}, for up to ${count(S.floodDays, "day")}; and, as a protective suspension, when korbat keeps images of the account sealed after a report of child sexual abuse material, by a decision at most ${count(S.basisAgeDays, "day")} old, once for each such decision and for up to ${count(S.protectiveDays, "day")}. In the last case korbat's staff do not open the images, so korbat has not assessed them: the suspension is a protective measure and not a finding that you broke the law or a rule, it gives no strike, counts toward no later step, and ends on its date, or earlier if the seal is lifted. Its appeal is reviewed at once and does not wait for the authorities. In the first two cases the suspension ends at once if the decision it rests on is reversed. An announced suspension never rests on one of these four cases. You get the statement at once and can reply and appeal from the first minute; korbat aims to answer a reply to a suspension taken at once within ${count(REPLY_AIM_HOURS, "hour")}.`,
  "While suspended you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules. You can still sign in and read, see your cases, reply to korbat, appeal, ask for a re-examination, export your data, delete your posts or your account, undo likes, reposts, bookmarks and follows, block and mute, and report illegal content. Your profile and posts stay visible, without any mark, and others can still follow you and react to your posts. Your posts do not appear in Explore while you are suspended, and your likes and reposts do not count there.",
  `A termination is decided after ${numberWord(S.ladderDays.length)} suspensions as described above, with the same time to reply, or at once after a direct threat of violence (rule R5) that you post within ${count(S.ladderMemoryDays, "day")} after korbat suspended your account for an earlier one, while that suspension and the decision it rests on still stand. A second post from before that suspension is no ground for it. Until the decision is final the account is suspended and nothing more. It is final when the ${count(APPEAL_MONTHS, "month")} for your appeal have passed unused, or when your appeal is answered and the decision kept; nothing is deleted while your appeal or a reply of yours is unanswered. korbat then deletes the account with its posts and profile and every image it has not sealed. Until then you can export your data and delete the account yourself; deleting it ends your appeal, since nothing is left to restore. After the deletion korbat keeps nothing to recognise a new account of yours by; images that korbat sealed stay with it for the authorities alone, as the decision that sealed them said.`,
  "Each of these decisions can be appealed from the moment you are told, as Appeals says; an appeal does not hold a start, only a reply does. One person may hold more than one account, but not to carry on with another account what one was suspended or terminated for: korbat treats that as the same conduct and decides about it like any other breach, on what the account does.",
);

export const REPORTING_IN_BAD_FAITH = paragraphs(
  "Report what you believe breaks a rule; a report that turns out wrong costs you nothing. korbat acts only on reports that are manifestly unfounded: reports that anyone could see name nothing a rule could cover, without weighing them. Examples are many reports of the same account for posts that plainly break no rule, the same text sent against different posts, and a report sent again after it was answered. A moderator may mark such a report when deciding it. You see the mark on your list of reports together with the report's outcome, and you can ask for a re-examination. The mark stops counting if a re-examination finds a breach, and if korbat withdraws it because the report was arguable after all. korbat counts reports, not the posts or accounts a report names: a report counts once, by the day you sent it, however many of its items were marked, so no single report can lead to a warning.",
  `If at least ${numberWord(S.reportWarnMarks)} of the reports you sent under the rules within ${count(S.reportFrameDays, "day")} are marked, and they are at least ${share(S.reportWarnShare)} of the reports you sent under the rules in that time, a moderator may warn you: the warning lists the reports and restricts nothing. If ${numberWord(S.reportRestrictMarks)} of the reports you send after that warning are marked while it counts, which is ${count(S.reportFrameDays, "day")}, a moderator may stop taking your reports under the rules for up to ${count(S.reportRestrictDays, "day")}; the restriction ends at once if the warning is lifted. A person decides each step, looking at how many reports you sent, how many were marked and what they said; the count alone decides nothing. Notices of illegal content, reports of child sexual abuse material and requests for re-examination are never counted and never restricted. You can appeal the warning and the restriction.`,
);

const HANDLES = `When the breach lies in a handle itself (impersonation, someone's private information, a threat), a moderator may retire it. A retired handle can be used by nobody again, you included. Your profile then shows a placeholder that begins with ${RETIRED_HANDLE_PREFIX}, and you can choose a new handle without the usual wait: at once, or, while your account is suspended, when the suspension ends. If the decision is reversed, the retirement is lifted: your profile gets the handle back if it still shows the placeholder, and otherwise you can change back to it at once; nobody else could take it meanwhile. Handles that begin with ${RETIRED_HANDLE_PREFIX} cannot be chosen. korbat keeps a retired handle, as a handle and nothing else, for as long as it refuses it to everyone, also when the breach was someone's private information (rule R4): refusing it needs it.`;

/**
 * 3f (design, W.6 and section 5): the contact point for authorities and the Member State korbat is established in, the
 * web build's two arguments (WEB_CONTACT_POINT and WEB_HOME_STATE in infra/.env), which Expo inlines at export time as it
 * inlines the contact address. The app's page is built, so it cannot read the API's settings of the same names. While the
 * contact point is empty the terms print no section on it, and while the state is empty no sentence names one: both are
 * set, with the API's, as the last step of the README's Before going public.
 */
export const CONTACT_POINT = process.env.EXPO_PUBLIC_CONTACT_POINT ?? "";
export const HOME_STATE = process.env.EXPO_PUBLIC_HOME_STATE ?? "";
/** The home state's facts, while the contracts fill its entry in. */
const STATE: StateFacts | undefined = HOME_STATE === "" ? undefined : (STATE_FACTS as Partial<Record<string, StateFacts>>)[HOME_STATE];
/** The state as a sentence names it: its name from STATE_FACTS, or its code while the contracts have no entry for it. */
const HOME_STATE_NAME = STATE?.name ?? HOME_STATE;

/** A list inside a sentence: "a", "a and b", "a, b and c". */
const andList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * 3f's sections (design, W.6), in the design's words. Each number is printed from the constant the code that acts on it
 * reads: what a removal order disabled is kept for RETENTION.orderPreserveMonths and ORDER_RULES.preserveMarginDays, the
 * records for RETENTION.orderRecordYears, a message's record for RETENTION.contactMessageDays, a restore gap for
 * RETENTION.restoreGapMonths and a deleted account's address for ORDER_RULES.reportHoldDays. The hour, the six and twelve
 * weeks and the 48 hours of a scrutiny are the Regulation's own periods (TCO Art. 3(3), 11(3) and 4(4)), written as it
 * writes them: ORDER_RULES holds korbat's own numbers built on them (holdDays counts a day more, so as never to be early).
 */
const O = ORDER_RULES;
const PRESERVED = count(RETENTION.orderPreserveMonths, "month");

const AUTHORITIES_ORDERS = paragraphs(
  "An authority or a court of the European Union or of one of its countries can order korbat to act against a post, or to give information about an account. korbat carries such an order out within the time the law sets and checks that it comes from the authority it names; if it does not, korbat reinstates the post and tells you. A removal order for terrorist content leaves korbat no choice, and has to be carried out within one hour, so korbat may act on it before that check is finished. Any other order korbat checks first, and carries out because the law under which it was issued requires it. korbat does not assess the post under its own rules when it carries out an order: such an order is not a decision of korbat's.",
  "So korbat gives no reasons of its own for it, and korbat's appeal does not apply. You get a notice instead, under Settings, Cases, announced by an email that says only that there is one. The notice says which authority the order names, under which law, on which day and under which reference, and whether korbat has confirmed that it comes from that authority. It gives the authority's reasons and the ways to challenge the order, in the authority's own words, as soon as korbat has them; when korbat adds them later it sends you an email, and the notice says since when it has held them. The notice also says how to ask korbat for a copy of the order.",
  "An order can forbid korbat to tell you about it for a time. Then korbat keeps the post from you as from everyone, tells you nothing, and can say nothing about the post by email either. For a removal order the law sets that time (Terrorist content); for another order the authority that issued it does, and korbat tells you when that authority allows. While korbat may not tell you of an order, it cannot tell you of a decision it takes about the same post under its own rules, or answer an appeal you made about that post before: you get those together with the notice.",
  "korbat lifts what it did only when the authority withdraws the order, when a court annuls it, when the authority of korbat's own country finds that an order from another country infringes the law, when the order turns out not to be authentic, or when korbat disabled a post that the order did not name. For that last case write to the address under Contact, from the email address of your account. When korbat's own rules apply to the same post, that is a second decision, with its own statement of reasons and its own appeal. korbat cannot act for one country alone, so an order takes effect everywhere korbat is available.",
);

// 3c's section, in full as 3f has it read: the removal order is carried out within the hour now, not once korbat is open.
export const TERRORIST_CONTENT = paragraphs(
  "korbat removes terrorist content as defined in Article 2(7) of Regulation (EU) 2021/784 when it is told about it in a notice, and carries out a removal order of a competent authority within one hour of receiving it. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content. korbat uses no automated tool to find it.",
  `A post disabled under a removal order is shown to nobody, you included, for as long as the order stands. korbat keeps it, with its images and a copy of its text, for ${PRESERVED} from the disabling, as the Regulation requires, so that it can be reinstated or examined, and longer only when an authority or a court asks. Deleting the post or your account does not shorten this. Then korbat erases it, and it cannot be reinstated afterwards.`,
  `The law can oblige korbat to tell you nothing about such an order for six weeks, for twelve at most, and up to a day and a few hours more, because korbat counts the end so that it is never early. During that time the post is simply not there, for you as for everyone, and korbat cannot say why. korbat tells you when that period ends, with the day on which the post was disabled. If the order comes from another country of the European Union than korbat's, you can ask the authority of korbat's country to scrutinise it, within 48 hours of receiving its reasons or a copy of it; the notice says since when it has held the reasons. If you challenge an order in court, ask the court or the authority to tell korbat to keep the post until that is decided, since korbat erases it after the ${PRESERVED} otherwise. korbat publishes the figures the Regulation asks for, for every year in which any of them is not zero.`,
);

// The languages the contact point declares are the operator's (STATE_FACTS); while the state's entry declares none, the
// sentence names none rather than print that they are not filled in.
const CONTACT_POINT_SECTION = `Authorities of the Member States, the European Commission and the European Board for Digital Services reach korbat at ${CONTACT_POINT} (Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784)${STATE?.languages ? `, in ${andList(STATE.languages)}` : ""}. This address is for authorities. Everyone else writes to the address under Contact, and reports content with the report form.`;

/**
 * "Your data"'s four paragraphs of W.6, and RETENTION's printed list of what concerns authorities, in one paragraph. 3f's
 * review (people8): a message an order came with is kept with that order's records (delete_contact_messages skips it), so
 * both sentences about the contact point's records say so.
 */
const AUTHORITIES_DATA = [
  `Two things the law can oblige korbat to keep for a time when you delete your account; everything else is deleted at once. First, your email address: when korbat has sealed images of your account, the law may oblige it to report them to the authorities. Until it has done so, or has decided that it need not, and for ${count(O.reportHoldDays, "day")} at most, korbat keeps the address, and nothing else of the account; it uses it for that report alone, and the email that confirms your deletion tells you. You can write to korbat about this at the address under Contact, complain to a data protection authority, and go to court. Second, a post that an authority's order obliges korbat to preserve: korbat keeps it, with its images, until that time ends (Terrorist content), also after your account is gone.`,
  `korbat keeps a record of every report it makes to an authority and of everything it hands to one: which duty, which authority, when, both references, what was asked for and which kinds of data, never a copy of the data. It keeps these records and its records of authorities' orders for ${count(RETENTION.orderRecordYears, "year")} after the matter's last event, an order's record for as long as its measure stands, and a record that says you may not be told of something for as long as that holds. korbat records when a message reaches its contact point for authorities, never who sent it or what it says, and deletes that record ${count(RETENTION.contactMessageDays, "day")} after the message was handled, or, when an order came with it, with that order's records.`,
  "When an authority lawfully asks who holds an account, korbat gives the handle, the email address and the day the account was created. korbat also holds when and from which kind of device an account signed in; it gives those only when an order names them and the law requires it, and its record says so. korbat tells you when it has given an authority information about your account, with the authority's reasons and the ways to challenge its order, unless the order, or the law under which it was issued, forbids telling you or delays it; korbat records which of these applies and on what basis. While korbat may not tell you, its answer to a data request of yours leaves the matter out, and korbat keeps the reason on record.",
  "If korbat has to restore its database from a backup, it may have to take a decision about you again; the decision then says so.",
  `The periods for what concerns authorities: content disabled under a removal order is kept ${PRESERVED} and ${count(O.preserveMarginDays, "day")} from the disabling, and from the new disabling when it was reinstated and disabled again, longer on an authority's or a court's request, and is then erased. An order's records, and the records of a notification or a production, are kept ${count(RETENTION.orderRecordYears, "year")} after the matter's last event; an order's never while its measure stands, and a record of an authority's demand that a person is not told never while that demand holds. The record of a message at the contact point for authorities is kept ${count(RETENTION.contactMessageDays, "day")}, counted from the day the message was handled, or, when an order came with it, as long as that order's records; the record of a message nobody handled is kept until a person has closed it. A gap a restore left is kept ${count(RETENTION.restoreGapMonths, "month")} when it was closed as not needed or imported; a gap that a decision taken again closed is kept as long as that decision. The email address of a deleted account is kept while a report is owed, ${count(O.reportHoldDays, "day")} at most.`,
];

/**
 * 3d (design, W.9): "Automated tools" and "Transparency", drafts without a new TERMS_VERSION, as 3c's, 3e's and 3f's
 * sections were; counsel reviews them in sub-project 4. Every number is AUTOMATION_RULES', which the database's
 * automation_rules() holds the program to. They say what each tool may do when it is switched on, and the rules page says
 * which is on today: so they are true in every state the design builds (section 18, rule 9).
 */
const A = AUTOMATION_RULES;
export const AUTOMATED_TOOLS = paragraphs(
  "korbat's decisions are taken by people. korbat may use two programs, and the rules page says under Automation which of them is switched on today.",
  "The first rates uploaded images against rule R1 and keeps the rating with the image while the check is switched on. An image it rates as likely within the rule is put before a moderator. korbat may also hide that one image from other people until the moderator has decided; the post's text stays and you still see the image.",
  "The second compares the fingerprint of an uploaded image with lists of images that a named body has classified as child sexual abuse material. korbat sends that body fingerprints and nothing else. An upload that the body reports as an exact match with such an entry is not accepted, now or later, and is kept, unopened, until an admin has decided whether korbat reports it to the authorities. A match with such an entry on an image of a post, exact or not, is put before an admin even when the program seals nothing; from then on korbat keeps that post's images, also if you delete the post or your account, until the admin has answered (Your data). On an exact match korbat may also seal that post's images for everyone until then. A match is a comparison of fingerprints: it is not korbat's finding about an image, and korbat's staff do not open an image that a match names, before the admin's answer or after it. A match with an entry of any other class only flags the image for a person.",
  `A program never removes anything, never judges text, and never suspends or restricts an account. It takes at most ${A.decisionsPerHour} measures an hour and ${A.decisionsPerDay} a day under rule R1, and ${A.r2DecisionsPerHour} and ${A.r2DecisionsPerDay} under rule R2, none under a rule while ${A.unansweredMax} of its measures under that rule wait for a person, and none at all while a request for a person has waited longer than ${A.unansweredHours} hours. Every measure a program takes you are told at once, with the reasons and the words "automated means", under Settings, Cases and by email. You can ask for a person there, and korbat's target is that one answers within ${A.objectionTargetHours} hours. The person's decision is the one you can appeal. An upload that is not accepted is different: nobody at korbat can accept it, since nobody opens it; you can object, and an admin decides what happens to the file. korbat uses these programs to keep such content from being shown, on the basis of its legitimate interest in a service that follows its rules and the law; you can object to that at the address under Contact.`,
);

/** 3d (design, W.9): "Transparency". */
export const TRANSPARENCY =
  "korbat publishes its rules, with every change, on the rules page, and each year the counts of what its moderators, its programs and authorities' orders did, on the Transparency page. It publishes numbers, never a decision, and no number small enough to point at a person, except the figures on authorities' orders, which the law asks for as numbers. To give the authorities the figure the Digital Services Act asks for, korbat counts how many accounts and readers use it each month and keeps two numbers a month; the Transparency page says how it counts and what exists until a month has ended.";

/**
 * 3d (design, W.9): "Your data"'s paragraph on what the automated tools and the sealed images leave behind, and
 * RETENTION's printed list of the same, each period from its constant: the match record's days, the address held after a
 * refused upload (3f's hold), the edge's outbox rows, the records to authorities' years, and the reader count's salt.
 */
const R = RETENTION;
const AUTOMATION_DATA = [
  `While a comparison is switched on korbat keeps fingerprints of each uploaded image for as long as it keeps the image; when the comparison is switched off it deletes them all. While the check against rule R1 is switched on it keeps the program's rating of each image the same way, and deletes the ratings when the check is switched off. It keeps the record of a match (the image's id, the body, the kind of match and the fingerprint, never your account) for ${count(R.matchKeepDays, "day")} after the case closed, the hold ended or the images were released. The record that an upload of yours was not accepted names your account for the same time; after that korbat keeps only that an upload was refused on that day. If korbat reported the upload, the record of that report names your account for as long as korbat keeps its records to authorities. While an upload of yours is held korbat keeps your email address for up to ${count(R.reportHoldDays, "day")} from the refusal, also if you delete your account, as it does when images are sealed. It keeps what you wrote when you asked for a person as long as the decision's own texts, and what you wrote when you objected to a refused upload as long as that upload's record of a match. It keeps for ${count(R.edgePurgeDays, "day")} the record that a cached copy was to be dropped, and for ${count(R.orderRecordYears, "year")} the record of a release, of the leave or instruction it rests on, and the digests that prove a destruction.`,
  `The periods for the automated tools and for sealed images: the record of a match: ${count(R.matchKeepDays, "day")} after its case closed, its hold ended or its images were released, or, for an upload that was accepted and never posted, after the comparison; longer only while images sealed for good and not released, or a held upload, rest on it. The record that an upload was not accepted: with your account until the record of its match is erased, and without it afterwards; when korbat reported the upload, the record of that report names your account for as long as korbat keeps its records to authorities. Your email address after an upload of yours was not accepted: up to ${count(R.reportHoldDays, "day")} from the refusal, also if you delete your account; less when the hold ends without a report. The record that a cached copy was to be dropped: ${count(R.edgePurgeDays, "day")} after it closed. Fingerprints of an uploaded image: as long as the image, and only while a comparison is switched on; all are deleted when it is switched off. The rating of an image under rule R1: as long as the image, and only while the check is switched on; all are deleted when it is switched off. The monthly count of readers: two numbers a month, kept; the counting sketches are deleted at the month's end, and the day's key after ${count(RECIPIENT_RULES.saltHours, "hour")}. The record of a release, of the leave or instruction it rests on, and of each destroyed file's digest: as korbat's records to authorities (${count(R.orderRecordYears, "year")}).`,
];

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Draft",
    body: "These terms are a draft for testing korbat before launch. They will be replaced by reviewed terms and a privacy policy before korbat opens to the public.",
  },
  {
    title: "Who can use korbat",
    // 3e (W.7): what another account may not carry on, which "Suspension and termination" says.
    // 3f (W.6): the Member State korbat is established in, from the build's argument, while the build names one.
    body: `You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination).${HOME_STATE_NAME === "" ? "" : ` korbat is established in ${HOME_STATE_NAME} and offers its service there only.`}`,
  },
  // The 3c design's sentence (section 9), in place of "removed only when it breaks a published rule", which notices of illegality made false. The rules are named from the rulebook.
  {
    title: "What you can post",
    body: `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${RULES.map(ruleName).join(", ")}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes. The one restriction that is not korbat's decision is an authority's order (Authorities' orders).`,
  },
  // The rulebook itself, as @korbat/rules holds it: the grounds on which korbat restricts content (Digital Services Act, Article 14(1)).
  {
    title: "The rules",
    body: paragraphs(
      `These are korbat's rules, in version ${RULES_VERSION} of its rulebook. A decision under a rule names the rule, and its statement of reasons quotes the rule as it stood when the decision was made.`,
      ...RULES.map((rule) => `${rule.id}. ${rule.title}. ${rule.text}`),
    ),
  },
  {
    title: "Reports and notices",
    body: paragraphs(
      "Anyone can report a post, an image or a profile on korbat, signed in or not: choose Report on the item itself, or use the report form linked below these terms. A report says either that the item breaks one of korbat's rules or that it is illegal.",
      "A report about a profile is decided on its display name and bio; korbat decides about the account's posts and images in cases of their own. A report about a post that quotes another is decided on that post's own text and images; the quoted post is decided in a case of its own.",
      `For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, the form has a path of its own, which is anonymous: korbat does not record who sent the report, not even an account, asks for no name and no email, and sends no email. You follow such a report through the link that is shown once on screen. On that path a report about a profile covers the images on all the profile's posts, a report about a post that quotes another covers both posts, and one report can name ${count(CSAM_NOTICE_MAX_ACCOUNTS, "profile")} at most.`,
      "A notice that something is illegal asks you to explain why and to confirm that you report in good faith; which law or country you mean, your name and your email are optional. Reports are anonymous towards the person you report: korbat never tells them who reported them, and a request for their data shows them what was written only where the law requires it (see Your data).",
      `korbat takes at most ${NOTICE_LIMITS.signedOut.perHour} reports an hour and ${NOTICE_LIMITS.signedOut.perDay} a day from one network without an account, and ${NOTICE_LIMITS.signedIn.perHour} an hour and ${NOTICE_LIMITS.signedIn.perDay} a day from one account. One report can name up to ${numberWord(NOTICE_LIMITS.maxTargets)} posts or profiles on korbat, by their links; korbat takes no attachments and follows no links to other sites. What you write to explain a report can be up to ${NOTICE_LIMITS.explanationMax} characters long, and the law or country you cite up to ${NOTICE_LIMITS.citedLawMax}.`,
      "A person looks at every report about something that is on korbat. A link that names nothing korbat can show is answered automatically, and the answer says so. Moderators read reports in the order of their severity and then of their age, never by how many reports an item has, and by who sent them only under the emergency switch. When many reports about one post arrive in a short time from accounts that follow one another, korbat's moderators are shown that; it changes neither the order in which reports are read nor who decides; a moderator still judges the content itself.",
      "The emergency switch: when a flood of reports keeps moderators from real cases, the operator may turn it on until the flood ends. Reports sent without an account or from accounts under 48 hours old are then read after the others of the same severity; in the urgent lane (threats, violence, self-harm, public security, and the sexual abuse or exploitation of children) only reports sent without an account are. A report is never read after a less severe one, and every report is still read and answered.",
      `Every report gets a reference, shown on screen at once. A notice that something is illegal gets a receipt by email at once when you gave an email or sent it from an account; a report on the anonymous path gets none. An email address that has not been confirmed as its sender's in the last ${count(RETENTION.confirmationDays, "day")} gets at most one receipt a day; the others come with the next daily email. For a notice that something is illegal, korbat sends its decisions by email once a day when you gave an email or sent it from an account. Every decision on a report is shown under Settings, Cases, Your reports, or on the report's own page. korbat sends no report email to an address whose holder asked it to stop, and gives up an email it could not send for ${count(RETENTION.mailGiveUpDays, "day")}; the answer stays on the report's page.`,
      "korbat answers each item of a report in one of the following ways.",
      ...ANSWERS,
      // 3e (W.7, W.1): the scope phrases an answer carries when it was a measure on the account a report named.
      `When korbat's answer to a report about an account is a measure on that account, korbat tells you that it took a measure, and not which or for how long: the answer adds "${ACCOUNT_MEASURE_SCOPE.measure}", or "${ACCOUNT_MEASURE_SCOPE.retired}" when it retired the handle. korbat does not tell you what happens to that account afterwards.`,
      `Re-examination: if a moderator answered your report with no action, you can ask once for a re-examination, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with an optional statement, under Your reports or on the report's page. It is decided again as a new report, by a moderator; korbat asks another moderator than the one who decided to take it when it has one. You can ask for at most ${count(DAILY_LIMITS.reexaminations, "re-examination")} a day. Its answer is final within korbat, with one exception: an answer given while korbat's staff could not open a post's images, because a report of child sexual abuse material about them was waiting or because they were sealed, says so and can be asked again. An outcome changed on review or by a correction is final within korbat, and everyone whose report it answered is told. ${COURTS}`,
    ),
  },
  {
    title: "How moderators decide",
    body: paragraphs(
      // 3d (W.9): what a program may do until a moderator decides is in Automated tools.
      "A moderator decides every case; what a program may do until then is in Automated tools. A moderator never decides about their own accounts or about accounts close to them.",
      `Some decisions only an admin takes: every final decision, whether it acts or not, on a report or a moderator's finding under ${ADMIN_RULES} or on a report made on the anonymous path, every lifting of a seal, and every correction of such a decision. Until an admin decides, any moderator may at once hide a reported threat from other people, or seal reported images.`,
      "On the path for child sexual abuse material, a moderator and an admin decide without seeing the images, on the report and on what korbat can read. Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed; that covers the images of a post while such a report about it, or about its author's profile, is unanswered. After an admin has answered without a seal, staff may open them like any other image, except an image that an automated comparison matched: korbat's staff do not open such an image at any time. Reports on other grounds about those images, corrections and appeals are meanwhile decided on what korbat can read, or wait. An admin's answer to such a report about a post also answers the earlier reports about that post, and whoever sent a report about a post that is answered without action while its images cannot be opened is told so and may ask again.",
      "A seal can cover every image on a profile's posts. It hides the images from everyone, their author included, from the first seal, and never hides a post's text. A report of this kind about a post that quotes another opens a case on the quoted post too.",
      MEASURES_PARAGRAPH,
      "A reset is written once, and korbat does not put the old value back: you may set the field again, and what you set is judged on its own if someone reports it. korbat restricts the least it can: one image rather than the post, one field rather than the account. Every finding of a breach is recorded as a restriction of its own, also when the content was already not shown or already deleted; its statement then says that it changed nothing now.",
      "Every decision that restricts your content, also one that changes nothing anyone sees now, every decision that reverses one, every answer to your appeal, and every end or lifting of something korbat told you it did while deciding comes with a statement of reasons, in the app at once and by email. A decision to take no action is not sent to you, since it would tell you that someone reported you, unless it ends or lifts something korbat told you it did while deciding. Something korbat does while deciding about a post you had already deleted is recorded without being sent to you, since it can never take effect. Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
    ),
  },
  // 3d (W.9): what a program may do, after the section that says a moderator decides every case.
  { title: "Automated tools", body: AUTOMATED_TOOLS },
  {
    title: "Appeals",
    body: paragraphs(
      `If a final decision restricts your content or your account, you can appeal it once, while any of it is in force, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow: choose "Appeal" on the decision's screen under Settings, Cases. You can file at most ${count(DAILY_LIMITS.appeals, "appeal")} a day.`,
      "What korbat does while it decides cannot be appealed. It ends with the case's final decision, which is shown and sent to you and can be appealed when it restricts; a seal ends with an admin's answer to the reports it was taken on. A moderator may lift it earlier; a seal, only an admin. What a program does while a person has not decided cannot be appealed; you can ask for a person at once, and the person's decision can be appealed.",
      "An appeal is reviewed by a moderator who made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case. While korbat has no such moderator the appeal waits, without a time limit, and its screen says so: with one moderator every appeal waits, and with two every case both took part in, where one hid the content or reported it and the other decided it, which is how direct threats and images reported as child sexual abuse material are handled whenever the moderator on duty is not the admin.",
      "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it. A decision reversed in full can no longer be appealed, since nothing of it remains. A decision that a correction changed in part can still be appealed for what remains of it; an answer to your appeal is final within korbat.",
      `korbat does not put back a display name or a bio it reset: set it again. The screen of the decision that reset it shows what it was while korbat keeps the case's copies, and for at least ${count(RETENTION.resetValueDays, "day")} after a reset that is lifted or ends before they are erased, unless korbat had already erased a value reset under ${R4}, as Your data says.`,
      "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to. Only an admin lifts a seal, and a seal for good only on that authority's answer that the images are not child sexual abuse material.",
      // 3e (W.7): what an appeal of a standing measure does and does not do.
      `An appeal never holds the start of a suspension; a reply does. When korbat keeps a decision in answer to a reply you sent before its start, the ${count(APPEAL_MONTHS, "month")} to appeal it count from that answer. The appeal of a protective suspension is reviewed at once; only the appeal of a decision that seals images waits for the authorities.`,
      // 3f (W.6): an order is no decision of korbat's, and what a hold delays counts from the day korbat may tell.
      "korbat's appeal does not apply to what korbat does on an authority's order. If such an order forbids korbat to tell you about a post, korbat's answer to an appeal you made about that post reaches you only when it may tell you of the order; your time to appeal a decision you are told of late counts from the day you are told.",
      COURTS,
    ),
  },
  // 3e's four sections (design, W.7), after the appeals they refer to.
  { title: "Strikes", body: STRIKES },
  { title: "Suspension and termination", body: SUSPENSION },
  { title: "Reporting in bad faith", body: REPORTING_IN_BAD_FAITH },
  { title: "Handles", body: HANDLES },
  // 3f (W.6): what an authority's order is and what korbat does with one, before the section on removal orders.
  { title: "Authorities' orders", body: AUTHORITIES_ORDERS },
  // The policy Article 7(1) of Regulation (EU) 2021/784 asks for; its one hour is the Regulation's own figure.
  { title: "Terrorist content", body: TERRORIST_CONTENT },
  // 3f (W.6): only while the build has a contact point for authorities to publish.
  ...(CONTACT_POINT === "" ? [] : [{ title: "Contact point for authorities", body: CONTACT_POINT_SECTION }]),
  // 3d (W.9): what korbat publishes, and the one count it keeps to publish it.
  { title: "Transparency", body: TRANSPARENCY },
  // The 2c design's sentence (section 2). It joins the draft without a new TERMS_VERSION, as 1b's and 1c's changes did before any public sign-up.
  {
    title: "Explore",
    body: "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.",
  },
  {
    title: "Your account",
    body: "You are responsible for keeping access to your email address. Turn on two-factor authentication and store your recovery codes; korbat cannot restore an account without them.",
  },
  {
    title: "Your data",
    body: paragraphs(
      "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes, and a device keeps its hash for 30 days after it was last seen. Your date of birth is checked once and never stored. Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash. At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy. If you ask for the Verified badge, your phone number is handed to the verification provider for one text message, and korbat keeps only a keyed hash of it. From the Account settings you can export your account's data as a ZIP archive and delete your account; deletion removes your posts, keeps your handle reserved and cannot be undone. If you add a passkey, korbat keeps its public key, a name, the dates it was added and last used, and the device that added it; nothing about your fingerprint or face leaves your device.",
      // What 3c adds, with the periods of RETENTION (3c design, section 6.6).
      `When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides. Deleting the post or your account leaves these copies until their period ends. A case's copies are erased when the case closes, or ${count(RETENTION.evidenceHours, "hour")} after its newest copy if that is later, unless a restriction of the case can still be appealed or, for a post, a report that only an admin can answer still waits or its images are sealed.`,
      // 3d (W.9): the same keeping starts on a program's match when nobody reported anything; and what korbat does with
      // sealed images it reported, which promises no destruction and names no period (review ruling 1).
      "For a report of child sexual abuse material, or a comparison that finds a match of the kind Automated tools describes, korbat keeps the images of the reported or matched post, of the post it quotes, or of all a profile's posts until an admin has answered, also when their author deletes the post or the account meanwhile; once their post is deleted they are shown to nobody. Images an admin then keeps sealed are kept for the authorities, with korbat's copies of their post's text; they are left out of your account's export and are not released by korbat on its own. Sealed images that korbat has reported are kept for the authorities, away from the rest of korbat's images and outside its ordinary backups. korbat does not destroy them on its own judgement, and not because an authority has assessed them: only when an authority or a court has given korbat leave or an instruction to destroy them, and an admin has confirmed it. korbat then tells you, at once or as soon as it may. If the authority answers that they are not illegal, the seal is lifted and they are shown again. An authority may never answer. korbat has set no time after which it then destroys them: they stay sealed and kept.",
      `Content korbat removes or resets under ${R4}, a post's text, an image, a display name or a bio, is erased for good, as far as that decision still stands, once it can no longer be appealed, ${count(RETENTION.r4FinalMonths, "month")} after you were told, or once your appeal against it is answered; for a post, later only while a report that only an admin can answer still waits or while its images are sealed. It is erased from your own view, your export and the decision's screen, and from every copy korbat keeps but its backups (an image once no other case still holds it), also when you had deleted the post, so a later reversal cannot bring it back or show it to you again.`,
      `korbat's backups of its database and its images hold everything as it stood when each was taken, what korbat erased since included. Each is deleted ${count(RETENTION.backupDays, "day")} after it was taken, except a backup that korbat must keep for the authorities, which it keeps until they have answered.`,
      `A notifier's name and email are kept apart from the case, never shown to staff or to the person reported, and deleted ${count(RETENTION.contactMonths, "month")} after the last day korbat still owed the report a decision or an email, or ${count(RETENTION.contactMaxMonths, "month")} after the report if nothing moved that day. That an email address was confirmed as a sender's is kept for ${count(RETENTION.confirmationDays, "day")}.`,
      `Staff see a reporter or a notifier as a summary: roughly how old the account is, how many reports it sent, what share were acted on and how many were answered while their images could not be opened, in broad bands, never exact numbers. A moderator sees a reporter's handle or a notifier's name only when a case needs it, for example a claim of impersonation or abuse of reporting, each time with a recorded reason that is shown to every staff member; the person reported never sees either. korbat forgets which account sent a report ${count(RETENTION.intakeDays, "day")} after its last outcome was given and settled, which is at most about ${count(APPEAL_MONTHS + Math.ceil(RETENTION.intakeDays / 30), "month")} after a decision to take no action, while it can still be re-examined, except through the mark of a report found manifestly unfounded (Reporting in bad faith).`,
      `On a report of child sexual abuse material, staff see how many such reports about the same post, profile or author an admin answered without a seal in the last ${count(SUSPECT_EARLIER_MONTHS, "month")}, as a number and a day.`,
      `The reasons korbat gave you for a decision are kept while your account exists and for ${count(RETENTION.statementMonths, "month")} after its deletion; the decision itself stays on record without them. korbat's log of which staff member opened a case, viewed an image or was shown who sent a report, with the reason given for that, is kept for ${count(RETENTION.accessLogMonths, "month")}. A text a moderator wrote for a decision and did not confirm is deleted after ${count(RETENTION.draftHours, "hour")}.`,
      // 3e (W.7): what korbat keeps of account sanctions, with RETENTION's three members.
      `korbat keeps the record of every strike, suspension, termination, warning and retired handle with its decision, as it keeps every decision. What ends is its use: a strike counts for ${count(RETENTION.standingRecord.strikeDays, "day")}, a suspension counts toward the next one for ${count(RETENTION.standingRecord.ladderMemoryDays, "day")}, a warning about reporting for ${count(RETENTION.standingRecord.warningDays, "day")}. The text of a reply to a suspension is kept ${RETENTION.replyText}; a reply that is not answered yet is never erased. To decide about reporting in bad faith korbat counts, for each account and day, how many reports under its rules the account sent, and keeps which of them a moderator marked manifestly unfounded; both are deleted after ${count(RETENTION.reportCountDays, "day")} and with the account, so for that long a marked report stays linked to the account that sent it. A retired handle is kept as a handle (Handles). Your export holds all of this.`,
      // 3d (W.9): what the automated tools and the sealed images leave behind, and RETENTION's printed list of it.
      ...AUTOMATION_DATA,
      // 3f (W.6): what is kept when an account is deleted, korbat's records about authorities, what an authority can get,
      // after a restore, and the periods of RETENTION that concern authorities.
      ...AUTHORITIES_DATA,
      "Your account's export holds the decisions its Cases screens list and your own reports. If you ask for your data at the address under Contact, you receive, within a month, every case about you (cases without action included), the copies korbat keeps, where each case came from (a report by another user, a notice, a moderator) and, where the law requires it after weighing the writer's rights, the words of a report without who wrote it.",
    ),
  },
];
```

### Replace `apps/app/src/lib/ui-words.ts` (whole file)

```ts
/**
 * The words of korbat's own components and of this sub-project's screens (UI design, sections 1.5 and 8.1), kept out
 * of the markup so a later translation is mechanical: a test of a11y.test.tsx refuses a bare sentence in src/app and
 * src/components. Keys are written as the design's word tables write them (`offline.title`, `feed.loading`); words no
 * table keys take a key of the same shape. A template holds `{name}` where fill() puts a value. Words of an area that
 * has a words module of its own (moderation, standing, orders, Explore, the public pages, the terms) stay there.
 */

/** U+2026, built in code so this file stays plain ASCII. */
const ELLIPSIS = String.fromCharCode(0x2026);

export const UI_WORDS = {
  /** Button's label while its action runs (6.4), word for word what ui.tsx showed before the kit. */
  "button.busy": `Please wait${ELLIPSIS}`,
  /** The centred spinner's name (Loading in ui.tsx). */
  "spinner.label": "Loading",
  /** VerifiedChip (6.13): the visible word and the name a screen reader hears, as ui.tsx had them. */
  "verified.label": "Verified",
  "verified.name": "verified account",
  /** The polite status of a list that shows skeleton rows (6.12). */
  "feed.loading": "Loading posts",
  "accounts.loading": "Loading accounts",
  /** ErrorState (6.12) and its offline form (8.11). */
  "error.retry": "Try again",
  "offline.title": "You're offline",
  "offline.body": "korbat will load this when your connection is back.",
  /** PublicFrame (7.3): the wordmark and the footer's links to the public pages. */
  "frame.wordmark": "korbat",
  "frame.rules": "The rules",
  "frame.transparency": "Transparency",
  "frame.terms": "Terms",
  /** postedWhen() (8.1), the spoken form of timeAgo's short time, which it always contains. */
  "time.posted.now": "posted just now",
  "time.posted.ago": "{short} ago",
  "time.posted.on": "on {date}",
  /** The shell (7.1 to 7.5, 8.1): the skip link, the context column and its card, the header's back button. */
  "shell.skip": "Skip to the main content",
  "shell.about": "About korbat",
  "shell.howTitle": "How korbat works",
  "shell.how1": "Following and Latest are in time order.",
  "shell.how2": "korbat never lowers a post's reach in secret.",
  "shell.how3": "The rules are public, and so is how they are enforced.",
  "shell.rulesLink": "The rules",
  "shell.transparencyLink": "Transparency",
  "shell.exploreLink": "How Explore works",
  "shell.back": "Back",
  /** The navigation landmark's name and its items, the same words at every width (7.1). */
  "nav.label": "Main",
  "nav.home": "Home",
  "nav.bookmarks": "Bookmarks",
  "nav.profile": "Profile",
  "nav.settings": "Settings",
  "nav.signin": "Sign in",
  /** The rail's mark (7.1), the wordmark's first letter, as the favicon draws it. */
  "nav.monogram": "k",
  /** HandleBox, in the context column (7.3), word for word as it had them. */
  "handle.title": "Go to a profile",
  "handle.field": "Handle",
  "handle.placeholder": "@handle",
  "handle.open": "Open",
  "handle.invalid": "Handles are 3 to 20 letters, numbers or underscores.",
  /** A mistyped address and the error boundary (8.11). */
  "notFound.title": "This page doesn't exist",
  "notFound.action": "Go to Home",
  "crash.title": "Something went wrong on this screen",
  "crash.body": "Try again, or go back to Home.",
  "crash.retry": "Try again",
  /** Bookmarks, followers and following (8.4, 8.5): their titles and empty sentences, word for word as the screens had them. */
  "bookmarks.title": "Bookmarks",
  "bookmarks.private": "Private to you.",
  "bookmarks.empty": "Nothing saved yet. Use Save on a post to keep it here.",
  "followers.title": "Followers",
  "followers.empty": "No followers yet.",
  "following.title": "Following",
  "following.empty": "Not following anyone yet.",
  /**
   * The post card (6.6, 8.1, section 10). post.label is the article's name, "Ada, @ada, 3h ago"; post.open is the time
   * link's, whose `when` comes from postedWhen() and always contains the visible short time. The action names leave the
   * number out at zero and when the reader hides counts (decision 15): then they are the `.none` words.
   */
  "post.label": "{name}, @{handle}, {when}",
  "post.open": "{when}, open the post",
  "post.reposted": "{displayName} reposted",
  "post.more": "More options for this post",
  "post.repost": "Repost",
  "post.unrepost": "Undo repost",
  "post.quote": "Quote",
  "post.whoSees": "Who sees this",
  "post.copyLink": "Copy link",
  "post.delete": "Delete",
  "post.reply": "Reply, {n} replies",
  "post.reply.one": "Reply, 1 reply",
  "post.reply.none": "Reply",
  "post.like": "Like, {n} likes",
  "post.like.one": "Like, 1 like",
  "post.like.none": "Like",
  "post.reposts": "Repost, {n} reposts",
  "post.reposts.one": "Repost, 1 repost",
  "post.reposts.none": "Repost",
  "post.save": "Save",
  "post.saved": "Saved",
  /** The delete question (6.6), word for word as PostCard.tsx had it. */
  "post.deleteQuestion": "Delete this post?",
  /** The reply context and the quoted post's tombstones, word for word as PostCard.tsx had them. */
  "post.replyingTo": "Replying to ",
  "post.replyingHidden": "Replying to a post you can't see",
  "post.deleted": "This post was deleted by its author.",
  "post.unavailable": "This post is unavailable.",
  "post.inExplore": "In Explore",
  /** The thread's focused post (8.3): each part left out when zero or hidden, joined by a comma. */
  "thread.stats.reposts": "{n} reposts",
  "thread.stats.reposts.one": "1 repost",
  "thread.stats.quotes": "{n} quotes",
  "thread.stats.quotes.one": "1 quote",
  "thread.stats.likes": "{n} likes",
  "thread.stats.likes.one": "1 like",
  /**
   * Who sees this (6.14), the sentences reach() in lib/reach.ts puts together, word for word as the design reviewed them;
   * the summary is the one line under the menu item.
   */
  "reach.public": "Public. Anyone can read it, including people who are not signed in.",
  "reach.blocked": "Accounts you blocked do not see it in their feeds, but anyone signed out can still read it.",
  "reach.feeds": "It shows in Latest and in your followers' Following, in time order.",
  "reach.inExplore": "Also in Explore.",
  "reach.exploreOff": "Not in Explore: you turned Explore off.",
  "reach.suspended": "Not in Explore while your account is suspended.",
  "reach.reply": "Public. Shown in the thread and on your Replies tab.",
  "reach.replyExplore": "Replies never enter Explore.",
  "reach.quoteExplore": "Quotes never enter Explore.",
  "reach.private": "Only you and korbat's moderators can see it.",
  "reach.order": "Removed for everyone else by an authority's order.",
  "reach.decision": "Read the decision",
  "reach.never": "korbat never lowers a post's reach in secret. Following and Latest are in time order.",
  "reach.how": "How Explore works",
  "reach.summary.public": "Public, signed in or not",
  "reach.summary.private": "Only you and korbat's moderators",
  /** A post's images and the lightbox (6.7), word for word as MediaGrid.tsx, HiddenImage.tsx and MediaViewer.tsx had them. */
  "media.open": "Open image: {alt}",
  "media.showAlt": "Show image descriptions",
  "media.hideAlt": "Hide image descriptions",
  "media.alt": "ALT",
  "media.hidden": "Hidden",
  "media.close": "Close the image viewer",
  "media.previous": "Previous image",
  "media.next": "Next image",
  "media.count": "{n} of {total}",
  /** UI Task 7 (decision 10, 8.7): the link under a grid that holds a hidden image, to the rules page. */
  "media.whyHidden": "Why are images hidden?",
  /** Toasts (5.4, 8.6). */
  "toast.view": "View",
  "toast.linkCopied": "Link copied",
  "toast.saved": "Saved to Bookmarks",
  "toast.failed.like": "Couldn't like this post. Try again.",
  "toast.failed.unlike": "Couldn't remove your like. Try again.",
  "toast.failed.repost": "Couldn't repost this post. Try again.",
  "toast.failed.unrepost": "Couldn't undo the repost. Try again.",
  "toast.failed.save": "Couldn't save this post. Try again.",
  "toast.failed.unsave": "Couldn't remove this post from Bookmarks. Try again.",
  "toast.failed.follow": "Couldn't follow @{handle}. Try again.",
  "toast.failed.unfollow": "Couldn't unfollow @{handle}. Try again.",
  /** What sending says (5.4, 8.6), each with View; the post's names where it is, so View is a convenience. */
  "toast.sent.post": "Your post was sent. It is at the top of Home.",
  "toast.sent.reply": "Your reply was sent",
  "toast.sent.quote": "Your quote was sent",
  /**
   * The composer (6.15, 8.6): the sheet's titles and the compose button's name, the field's names and placeholders, the
   * Post button's words and what it says is missing, the count, the send bar, the discard question and the image tray,
   * word for word as Composer.tsx, ComposeSheet.tsx and ComposerImages.tsx had them; the collapsed cards, the count and
   * the location sentence are new (8.6's table).
   */
  "composer.title.post": "New post",
  "composer.title.reply": "Reply",
  "composer.title.quote": "Quote",
  "composer.newPost": "New post",
  "composer.collapsed": "What's on your mind?",
  "composer.collapsedReply": "Write your reply",
  "composer.field.post": "What's on your mind?",
  "composer.field.reply": "Your reply",
  "composer.field.quote": "Your comment on the quoted post",
  "composer.placeholder.post": "What's on your mind?",
  "composer.placeholder.reply": "Write your reply",
  "composer.placeholder.quote": "Add your comment",
  "composer.action.post": "Post",
  "composer.action.reply": "Reply",
  "composer.action.quote": "Quote",
  "composer.posting": `Posting${ELLIPSIS}`,
  "composer.missing.failed": "Remove the failed image",
  "composer.missing.undescribed": "Describe every image",
  "composer.missing.waiting": `Waiting for images${ELLIPSIS}`,
  "composer.count": "{n} of 1000 characters",
  "composer.cancel": "Cancel",
  "composer.addImage": "Add image",
  "composer.exif": "korbat removes location and camera details from images.",
  "composer.discard.question": "Discard this draft?",
  "composer.discard.confirm": "Discard",
  "composer.discard.keep": "Keep writing",
  /** Under the refusal that replaces the fields while a measure runs (3e, 9.4): where to read about it. */
  "composer.refused.where": "{read}: Settings, Cases.",
  "composer.image.name": "image {n}",
  "composer.image.preview": "Preview of {name}",
  "composer.image.refused": "{name}, not accepted",
  "composer.image.description": "Description of {name}",
  "composer.image.placeholder": "Describe this image for people who cannot see it",
  "composer.image.remove": "Remove {name}",
  "composer.image.removeWord": "Remove",
  "composer.image.uploading": `Uploading${ELLIPSIS}`,
  "composer.image.processing": `Processing${ELLIPSIS}`,
  "composer.image.ready": "Ready",
  "composer.image.failed": "Failed",
  /** FollowButton (8.4), word for word as ProfileList.tsx had them. */
  "follow.follow": "Follow",
  "follow.following": "Following",
  /**
   * Home's feeds (8.2): the marker, the new-posts pill, the gap, the end, the empty states and Load more. The empty
   * sentences and Load more are word for word what index.tsx and PagedList.tsx had; feed.pill.label is the pill's name
   * and feed.pill.announce what a screen reader hears once when it first shows.
   */
  "feed.marker.title": "You were here",
  "feed.marker.body": "Newer posts are above. Below are posts you have already seen.",
  "feed.caughtUp": "You're all caught up",
  "feed.pill": "{n} new posts",
  "feed.pill.one": "1 new post",
  "feed.pill.many": "50+ new posts",
  "feed.pill.label": "{visible} above, go to the first one",
  "feed.pill.announce": "{visible} above",
  "feed.gap": "Show more new posts",
  "feed.end.following": "That's everything in Following.",
  "feed.end.latest": "That's everything in Latest.",
  "feed.empty.following.title": "Your Following feed is empty",
  "feed.empty.following.body": "Nothing here yet. Follow someone, or switch to Latest or Explore.",
  "feed.empty.following.action": "Open Latest",
  "feed.empty.latest.title": "Nothing posted yet",
  "feed.empty.latest.body": "No posts yet.",
  "feed.loadMore": "Load more",
  /** Home (8.2): its title, its tab list's name and its tabs, and the passkey card's words as index.tsx had them. */
  "home.title": "Home",
  "home.tabs": "Feeds",
  "home.following": "Following",
  "home.latest": "Latest",
  "home.explore": "Explore",
  "passkey.title": "Sign in faster with a passkey",
  "passkey.body": "A passkey signs you in with your fingerprint, face or PIN, and cannot be phished. Adding one takes a moment.",
  "passkey.add": "Add a passkey",
  "passkey.notNow": "Not now",
  /** A post and its thread (8.3), word for word as post/[id].tsx had them; thread.signIn is new. */
  "thread.title": "Post",
  "thread.missing": "This post is not available",
  "thread.back": "Back to the timeline",
  "thread.quote": "Quote this post",
  "thread.empty": "No replies yet.",
  "thread.signIn": "Sign in to reply.",
  "thread.exploreSetting": "Your Explore setting",
  /** A profile (8.4), word for word as u/[handle]/index.tsx had them; the hidden counts' words and More's name are new. */
  "profile.more": "More options for @{handle}",
  "profile.posts": "posts",
  "profile.followers": "followers",
  "profile.following": "following",
  "profile.followers.hidden": "Followers",
  "profile.following.hidden": "Following",
  "profile.followsYou": "Follows you",
  "profile.mute": "Mute",
  "profile.unmute": "Unmute",
  "profile.block": "Block",
  "profile.unblock": "Unblock",
  "profile.blockQuestion": "Block @{handle}?",
  "profile.blockBody":
    "Neither of you will see the other's posts or profile while signed in, and you will unfollow each other. Posts on korbat are public, so a block does not hide them from someone who signs out. You can undo this in your privacy settings.",
  "profile.cancel": "Cancel",
  "profile.signIn": "Sign in to follow this account.",
  "profile.settings": "Security and privacy settings",
  "profile.missing": "This account is not available",
  "profile.tabs": "Profile",
  "profile.tab.posts": "Posts",
  "profile.tab.replies": "Replies",
  "profile.tab.likes": "Likes",
  "profile.empty.posts": "No posts yet.",
  "profile.empty.replies": "No replies yet.",
  "profile.empty.likes": "You have not liked anything yet. Only you can see this tab.",
  "bookmarks.empty.title": "No saved posts",
} as const;

export type UiWord = keyof typeof UI_WORDS;

/**
 * Each screen's browser tab title (8.1, decision 16), read by lib/page-title.tsx: "<what> - korbat", naming the kind of
 * screen and never an account, so a synced browser history holds no handles (the h1 inside the page names the account).
 * A title joins this table with the first screen that sets it.
 */
export const TITLE_WORDS = {
  "title.notFound": "Page not found - korbat",
  "title.bookmarks": "Bookmarks - korbat",
  "title.followers": "Followers - korbat",
  "title.following": "Following - korbat",
  "title.home": "Home - korbat",
  "title.post": "Post - korbat",
  "title.postMissing": "Post not available - korbat",
  "title.profile": "Profile - korbat",
  /** UI Task 7: the public pages (8.9). */
  "title.rules": "Rules - korbat",
  "title.transparency": "Transparency - korbat",
  "title.exploreAbout": "How Explore works - korbat",
  "title.terms": "Terms - korbat",
  /**
   * UI Task 7: screens the design gives no title (8.1 wants one), each named by its kind: the report form, a report's
   * status page (never its reference), and the case screens in the form of 8.8's title.settings, filled, since a title
   * holds no placeholder.
   */
  "title.report": "Report - korbat",
  "title.notice": "Report status - korbat",
  "title.cases": "Cases - Settings - korbat",
} as const;

export type TitleWord = keyof typeof TITLE_WORDS;

/** A template with each `{name}` replaced by its value; a name with no value stays as it is written. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm -r --if-present run test --testTimeout=20000
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/db test:       Tests  102 passed (102)
packages/contracts test:       Tests  459 passed (459)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
apps/worker test:       Tests  52 passed (52)
apps/admin test:       Tests  584 passed (584)
apps/app test:       Tests  619 passed (619)
apps/api test:       Tests  943 passed | 1772 skipped (2715)
```

## Step 6: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat.local npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 7: verify: app-browser

```bash
pnpm --filter @korbat/app test:browser
```

Expected output contains:

- `Tests  34 passed (34)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  34 passed (34)
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/app/explore/about.tsx`
- `apps/app/src/app/notice/[ref].tsx`
- `apps/app/src/app/report.tsx`
- `apps/app/src/app/rules.tsx`
- `apps/app/src/app/settings/cases/[id].tsx`
- `apps/app/src/app/settings/cases/[id]/reply.tsx`
- `apps/app/src/app/settings/cases/index.tsx`
- `apps/app/src/app/settings/cases/releases/[id].tsx`
- `apps/app/src/app/settings/cases/uploads/[id].tsx`
- `apps/app/src/app/terms.tsx`
- `apps/app/src/app/transparency.tsx`
- `apps/app/src/components/Prose.tsx`
- `apps/app/src/components/ScreenHeader.tsx`
- `apps/app/src/components/kit/PublicFrame.tsx`
- `apps/app/src/components/kit/StatusChip.tsx`
- `apps/app/src/components/moderation/CasesLists.tsx`
- `apps/app/src/components/moderation/DecisionDetail.tsx`
- `apps/app/src/components/moderation/ItemLines.tsx`
- `apps/app/src/components/moderation/NoticeStatusView.tsx`
- `apps/app/src/components/moderation/RefusedNotice.tsx`
- `apps/app/src/components/moderation/ReleaseNotice.tsx`
- `apps/app/src/components/moderation/ReportForm.tsx`
- `apps/app/src/components/moderation/StatusSheet.tsx`
- `apps/app/src/components/moderation/UploadNotice.tsx`
- `apps/app/src/components/moderation/parts.tsx`
- `apps/app/src/components/social/MediaGrid.tsx`
- `apps/app/src/components/social/PostCard.tsx`
- `apps/app/src/lib/explore.ts`
- `apps/app/src/lib/moderation-words.ts`
- `apps/app/src/lib/terms.ts`
- `apps/app/src/lib/ui-words.ts`
- `apps/app/test/browser/app.browser.ts`
- `apps/app/test/browser/fixture-api.ts`
- `apps/app/test/cases.test.tsx`
- `apps/app/test/legacy-files.ts`
- `apps/app/test/orders.test.tsx`
- `apps/app/test/status-sheet.test.tsx`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(app): moderation surfaces and the public pages: the author's chip on a withheld or removed post is the button that opens components/moderation/StatusSheet.tsx, named by its words, which reads GET /api/moderation/decisions/:id each time it opens and keeps the answer in its own state, with skeleton blocks while it waits, ErrorState's Try again, and labelled blocks in the design's order (Rule, What it does, Applies to, Who can see it now, Decided by in role terms, When, Statement with Read the full decision, and Appeal, first while one can be filed, which opens the decision with ?appeal=1 and its field focused); a grid that holds a hidden image gains Why are images hidden? to /rules; DecisionDetail, the Cases lists, the report form, a report's status and the notices move onto the tokens as cards, rows and labelled lines, Cases on Tabs; the case screens, /report and /notice take their titles in ScreenHeader with skeletons inside the shell; /rules, /transparency and How Explore works read in components/Prose.tsx's layout and the terms in PublicFrame's 640 px column; the browser check gains steps 32 to 34" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): moderation surfaces and the public pages: the author's chip on a withheld or removed post is the button that opens components/moderation/StatusSheet.tsx, named by its words, which reads GET /api/moderation/decisions/:id each time it opens and keeps the answer in its own state, with skeleton blocks while it waits, ErrorState's Try again, and labelled blocks in the design's order (Rule, What it does, Applies to, Who can see it now, Decided by in role terms, When, Statement with Read the full decision, and Appeal, first while one can be filed, which opens the decision with ?appeal=1 and its field focused); a grid that holds a hidden image gains Why are images hidden? to /rules; DecisionDetail, the Cases lists, the report form, a report's status and the notices move onto the tokens as cards, rows and labelled lines, Cases on Tabs; the case screens, /report and /notice take their titles in ScreenHeader with skeletons inside the shell; /rules, /transparency and How Explore works read in components/Prose.tsx's layout and the terms in PublicFrame's 640 px column; the browser check gains steps 32 to 34`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 37>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "app-browser": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
