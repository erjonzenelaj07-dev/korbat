import { CaseView, FINDING_CATEGORIES, ModerationErrorCode, QueuePage, SOURCE_LABELS, StaffOverview, textDigest } from "@korbat/contracts";
import { RULES } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "../src/App";
import { ApiError, createStaffApi } from "../src/api";
import { FrameView } from "../src/frames";
import { hasHidden, mentionedAddresses, mentionedHosts, showHidden } from "../src/hidden";
import { correctionDraft, newDraft } from "../src/compose";
import { parseImageId, StaffImage, staffImageSrc } from "../src/media";
import { CASE_WORDS, CONSOLE_MODERATION_CODES, DECISION_KINDS, DECISION_OUTCOMES, describeError, FINDING_WORDS, messageFor, MODERATION_MESSAGES, NOTE_WORDS, OUTCOME_WORDS, REVEAL_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { afterFailedRead, ART_18_BANNER, CaseScreenView, IMAGES_NOT_SHOWN, RevealDialog, revealSource, SUSPECT_BANNER, targetDiffers, type CaseScreenViewProps } from "../src/screens/Case";
import { ERASURE_OVERDUE_RUNBOOK, ERASURE_OVERDUE_WORDS, OverviewView, RELEASE_OVERDUE_RUNBOOK, erasureOverdue, releaseOverdue } from "../src/screens/Home";
import { findingOf, marksOf, QUEUE_REFRESH_MS, QueueView, readQueue, startQueueReads, type QueueViewProps } from "../src/screens/Queue";
import { revealAction, revealWithKey, StepUpMismatch } from "../src/step-up";
import { createConsoleStore } from "../src/store";
import { newSalt, normalised, saveStaffText, TextRefused } from "../src/texts";
import { Loaded } from "../src/ui";
import { categoryLabel, revealable, sourceWords, waited, writtenBy } from "../src/words";
import {
  accountCase,
  CASE_ACCOUNT,
  CASE_FROZEN,
  CASE_POST,
  CASE_QUOTED,
  decision,
  frozenCase,
  IMAGE_ONE,
  IMAGE_TWO,
  item,
  ITEM_NOTIFIER,
  ITEM_REPORTER,
  ITEM_SUSPECT,
  LOOKALIKE,
  NO_STANDING,
  overview,
  postCase,
  postSnapshot,
  QUEUE_ROWS,
  queueRow,
  SOURCES,
} from "./case-fixtures";
import { CASE_PATH, CONSOLE_PATHS, envelope, FakeClock, fakeCredentials, fakeFetch, HOSTILE, HOSTILE_ESCAPED, hrefs, makeMe, SESSION_HANDLE, settle, stepUpChallenge, stepUpOptions } from "./fixtures";

/**
 * The console's case screens (3c design, section 8), server-rendered, and their pure parts. Every string someone wrote
 * arrives hostile and must come out as escaped text inside a frame; every link is one of the console's own pages or a
 * case's address built from a checked id; no page holds a link into the app; and an image is in the page only once its
 * person asked for it.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const noop = () => undefined;
const caseId = (id: string) => parseCaseId(id)!;
const NOW = Date.parse("2026-10-01T10:00:00.000Z");

/** No element or link came from a hostile string, and every link is the console's own. */
function expectInert(out: string) {
  expect(out).not.toMatch(/<(script|svg|iframe|style|object|embed|a [^>]*href="(?!\/))/i);
  expect(out).not.toMatch(/href="javascript:/i);
  expect(out).not.toMatch(/ on[a-z]+="/i);
  for (const href of hrefs(out)) expect(CONSOLE_PATHS.includes(href) || CASE_PATH.test(href), href).toBe(true);
}

/** The addresses of every image element in rendered HTML. */
const images = (out: string): string[] => [...out.matchAll(/<img[^>]*src="([^"]*)"/g)].map((found) => found[1]!);

describe("a case's address and its images' addresses", () => {
  test("staffImageSrc builds the address from two checked ids and one of two sizes", () => {
    const image = parseImageId(IMAGE_ONE)!;
    expect(staffImageSrc(caseId(CASE_POST), image, "small")).toBe(`/api/staff/cases/${CASE_POST}/media/${IMAGE_ONE}/small`);
    expect(staffImageSrc(caseId(CASE_POST), image, "large")).toBe(`/api/staff/cases/${CASE_POST}/media/${IMAGE_ONE}/large`);
    for (const text of ["", "x", IMAGE_ONE.toUpperCase(), `${IMAGE_ONE}/../../me`, "https://evil.test/a.webp", "javascript:alert(1)"]) expect(parseImageId(text), text).toBeNull();
    // A value that never went through the checks is refused, whatever its type claims.
    expect(() => staffImageSrc(caseId(CASE_POST), "../../audit" as never, "small")).toThrow();
    expect(() => staffImageSrc("https://evil.test" as never, image, "small")).toThrow();
    expect(() => staffImageSrc(caseId(CASE_POST), image, "original" as never)).toThrow();
  });

  test("an image is drawn blurred and grey until it is shown clearly, by a class of the stylesheet", () => {
    const blurred = html(<StaffImage caseId={caseId(CASE_POST)} mediaId={parseImageId(IMAGE_ONE)!} size="small" clear={false} onError={noop} />);
    expect(blurred).toContain('class="evidence blurred"');
    expect(images(blurred)).toEqual([`/api/staff/cases/${CASE_POST}/media/${IMAGE_ONE}/small`]);
    const clear = html(<StaffImage caseId={caseId(CASE_POST)} mediaId={parseImageId(IMAGE_ONE)!} size="large" clear onError={noop} />);
    expect(clear).toContain('class="evidence"');
    expect(clear).not.toContain("style=");
  });
});

describe("the hidden-characters view", () => {
  const RLO = String.fromCharCode(0x202e);
  const ZWSP = String.fromCharCode(0x200b);
  const LF = String.fromCharCode(10);
  const CYRILLIC_A = String.fromCharCode(0x430);

  test("draws every character outside printable ASCII as its code point, and keeps the lines", () => {
    expect(showHidden("plain text, 100%")).toBe("plain text, 100%");
    expect(showHidden(`${RLO}gnp.exe`)).toBe("[U+202E]gnp.exe");
    expect(showHidden(`p${CYRILLIC_A}ypal`)).toBe("p[U+0430]ypal");
    expect(showHidden(`a${ZWSP}b`)).toBe("a[U+200B]b");
    expect(showHidden(`one${LF}two`)).toBe(`one[U+000A]${LF}two`);
    expect(showHidden(String.fromCodePoint(0x1f600))).toBe("[U+1F600]");
    expect(hasHidden("plain")).toBe(false);
    expect(hasHidden(`p${CYRILLIC_A}ypal`)).toBe(true);
  });

  test("lists the hosts of the web addresses a text mentions, each once, as the host the address really names", () => {
    expect(mentionedHosts("see https://example.com/a?b#c and http://example.com/other, also www.other.test/x.")).toEqual(["example.com", "www.other.test"]);
    expect(mentionedHosts(LOOKALIKE.address)).toEqual(["korbat.example.evil.test", "evil.test"]);
    expect(mentionedHosts("HTTPS://Example.COM:8443/path")).toEqual(["example.com:8443"]);
    expect(mentionedHosts("no address here, not even javascript:alert(3)")).toEqual([]);
  });

  test("an address whose host the console cannot read is counted, never passed over: one followed by a direction override, and one that is no address at all", () => {
    // The override stands where the host ends, so it is part of what a browser would take for the host.
    const overridden = `https://korbat.example${RLO}/tsop`;
    expect(mentionedAddresses(`see ${overridden} and http://good.test/x, then http://good.test/y`)).toEqual({ hosts: ["good.test"], unread: 1 });
    expect(mentionedAddresses(`${overridden} http://[not-an-address`)).toEqual({ hosts: [], unread: 2 });
    expect(mentionedAddresses("https://example.com/a")).toEqual({ hosts: ["example.com"], unread: 0 });
    expect(mentionedAddresses("no address")).toEqual({ hosts: [], unread: 0 });
    // The list of hosts is what it was: the hosts that were read.
    expect(mentionedHosts(`see ${overridden} and http://good.test/x`)).toEqual(["good.test"]);
  });
});

describe("the console's words", () => {
  test("a waiting time is coarse: minutes, hours, days", () => {
    expect(waited("2026-10-01T09:46:00.000Z", NOW)).toBe("14 minutes");
    expect(waited("2026-10-01T09:59:00.000Z", NOW)).toBe("1 minute");
    expect(waited("2026-10-01T07:00:00.000Z", NOW)).toBe("3 hours");
    expect(waited("2026-09-29T11:00:00.000Z", NOW)).toBe("47 hours");
    expect(waited("2026-09-28T10:00:00.000Z", NOW)).toBe("3 days");
    expect(waited("2026-10-01T10:05:00.000Z", NOW)).toBe("0 minutes");
  });

  test("a category is a few plain words", () => {
    expect(categoryLabel("STATEMENT_CATEGORY_PROTECTION_OF_MINORS")).toBe("protection of minors");
    expect(categoryLabel("STATEMENT_CATEGORY_OTHER_VIOLATION_TC")).toBe("other breach of the rules");
  });

  test("a source is worded from its bands, with the items answered without the images apart from the share acted on; only a source that names someone can be revealed", () => {
    expect(sourceWords(SOURCES.reporter)).toBe("account 1 to 12 months old; 2 to 9 reports filed; under half of the decided ones acted on; 1 answered without the images");
    expect(sourceWords({ ...SOURCES.reporter, answeredUnseen: "none" })).not.toContain("answered without the images");
    expect(sourceWords(SOURCES.notifier)).toBe("signed out; gave a name; gave an address; address not confirmed");
    expect(sourceWords(SOURCES.unnamed)).toBe("signed out; gave no name; gave an address; address confirmed; asked korbat to stop its emails");
    expect(sourceWords(SOURCES.lost)).toBe("signed out; contact lost or forgotten");
    expect(writtenBy(SOURCES.reporter)).toBe("Written by Reporter A");
    expect(writtenBy(SOURCES.notifier)).toBe("Written by a notifier");
    expect(writtenBy(SOURCES.anonymous)).toBe("Written by a notifier");
    expect(Object.entries(SOURCES).filter(([, source]) => revealable(source)).map(([name]) => name)).toEqual(["reporter", "notifier"]);
    expect(SOURCES.staff.label).toBe(SOURCE_LABELS.staff);
  });

  test("the message table has one entry for every moderation code the console can meet, and the app's own codes are not among them", () => {
    const appOnly = ["human_check_failed", "staff_cannot_report", "notice_not_found", "already_reported", "appeal_not_open", "appeal_exists", "reexamination_not_open", "reexamination_exists"];
    expect([...CONSOLE_MODERATION_CODES, ...appOnly].sort()).toEqual([...ModerationErrorCode.options].sort());
    expect(Object.keys(MODERATION_MESSAGES).sort()).toEqual([...CONSOLE_MODERATION_CODES].sort());
    for (const code of CONSOLE_MODERATION_CODES) expect(messageFor(code).length, code).toBeGreaterThan(15);
    // A recusal says nothing of whom the conflict concerns.
    expect(messageFor("staff_recused")).toBe(
      "You cannot open or decide this case: an account linked to you takes part in it, or follows, blocks, mutes or replied to someone who does, or the post replies to or quotes a post of an account linked to you. Another staff member must handle it.",
    );
    // The server's own message is never shown: a screen words a code itself, and may say more where it knows more.
    const err = Object.assign(new Error("the server's own words"), { code: "not_found" });
    expect(describeError(err, FINDING_WORDS)).toBe("That link names nothing live on korbat: the post or the account does not exist or was deleted.");
    expect(describeError(err, CASE_WORDS)).toBe("No case has this address.");
    expect(describeError(Object.assign(new Error("x"), { code: "rate_limited" }), CASE_WORDS)).toContain("after midnight UTC");
  });
});

describe("text from others", () => {
  const frame = { by: "Written by Reporter A", open: false, hiddenShown: false, onOpen: noop, onToggleHidden: noop };

  test("is drawn as escaped text inside a frame that says who wrote it, with the hosts it mentions as text", () => {
    const out = html(<FrameView {...frame} text={`${HOSTILE.script} ${LOOKALIKE.address}`} />);
    expect(out).toContain('<p class="frame-label">Written by Reporter A</p>');
    expect(out).toContain(HOSTILE_ESCAPED.script);
    expect(out).toContain("Mentions addresses at: <bdi>korbat.example.evil.test, evil.test</bdi>");
    expect(out).toContain(">Show hidden characters</button>");
    expectInert(out);
    expect(hrefs(out)).toEqual([]);
  });

  test("an address the console cannot read is said to be there, in the console's own words, once for each", () => {
    const overridden = `https://korbat.example${String.fromCharCode(0x202e)}/tsop`;
    const beside = html(<FrameView {...frame} text={`${overridden} and https://good.test/x`} />);
    expect(beside).toContain('<p class="hint">Mentions addresses at: <bdi>good.test</bdi> and an address this console cannot read</p>');
    const alone = html(<FrameView {...frame} text={`${overridden} then http://[not-an-address`} />);
    expect(alone).toContain('<p class="hint">Mentions an address this console cannot read and an address this console cannot read</p>');
    expect(html(<FrameView {...frame} text="no address here" />)).not.toContain("Mentions");
    expectInert(beside + alone);
  });

  test("a text made to look like the console's own line stays inside its frame", () => {
    const out = html(<FrameView {...frame} by="Written by a notifier" text={LOOKALIKE.label} />);
    expect(out).toMatch(/<div class="frame"><p class="frame-label">Written by a notifier<\/p><p class="frame-text"><bdi>korbat: verified notice from police<\/bdi><\/p>/);
  });

  test("its hidden characters are drawn as code points on request", () => {
    const out = html(<FrameView {...frame} text={HOSTILE.bidi} hiddenShown />);
    expect(out).toContain("<bdi>[U+202E]gnp.exe</bdi>");
    expect(out).toContain(">Show the text as written</button>");
  });

  test("a text citing R3 or R5 opens collapsed behind a button that says what it is", () => {
    const collapsed = html(<FrameView {...frame} text="the threat's own words" collapsedLabel="Show text (R5: direct threats)" />);
    expect(collapsed).toContain(">Show text (R5: direct threats)</button>");
    expect(collapsed).not.toContain("the threat");
    expect(html(<FrameView {...frame} text="the threat's own words" collapsedLabel="Show text (R5: direct threats)" open />)).toContain("the threat&#x27;s own words");
  });
});

describe("the queue", () => {
  const props: QueueViewProps = {
    rows: { state: "ready", value: QUEUE_ROWS },
    more: true,
    loadingMore: false,
    now: NOW,
    finding: { link: "", ruleId: "R1", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", busy: false, error: null },
    onLoadMore: noop,
    onOpenCase: noop,
    onFindingChange: noop,
    onFindingSubmit: noop,
  };

  test("lists open cases in the API's order with their lane, age, target, what they cite and their marks, each linked to its case", () => {
    const out = html(<QueueView {...props} />);
    expect(out.indexOf(`/cases/${CASE_FROZEN}`)).toBeLessThan(out.indexOf(`/cases/${CASE_ACCOUNT}`));
    expect(out.indexOf(`/cases/${CASE_ACCOUNT}`)).toBeLessThan(out.indexOf(`/cases/${CASE_POST}`));
    expect(hrefs(out)).toEqual([`/cases/${CASE_FROZEN}`, `/cases/${CASE_ACCOUNT}`, `/cases/${CASE_POST}`]);
    expect(out).toContain("14 minutes");
    expect(out).toContain(", 3 items");
    expect(out).toContain("R3, R5, protection of minors");
    expect(out).toContain("notice under Art. 16, CSAM: no images, re-examination");
    expect(out).toContain("an account");
    expect(out).toContain("notice under Art. 16, deferred");
    expect(out).toContain(">Load more</button>");
    expectInert(out);
    // No count of reports per person and no weight: the table has the six columns and nothing else.
    expect([...out.matchAll(/<th scope="col">/g)]).toHaveLength(6);
  });

  test("the marks are the console's own words for what the unanswered items are", () => {
    expect(marksOf(queueRow({ allegesIllegal: false }))).toEqual([]);
    expect(marksOf(queueRow({ allegesIllegal: true, suspect: true, reexamination: true, deferred: true }))).toEqual(["notice under Art. 16", "CSAM: no images", "re-examination", "deferred"]);
  });

  test("an empty queue, a queue still loading, and no further page", () => {
    expect(html(<QueueView {...props} rows={{ state: "ready", value: [] }} more={false} />)).toContain("No case is open.");
    expect(html(<QueueView {...props} rows={{ state: "loading" }} more={false} />)).toContain("Loading");
    expect(html(<QueueView {...props} more={false} />)).not.toContain(">Load more</button>");
  });

  test("Open a case takes a korbat link, the rule and the category, and words a link that names nothing in its own words", () => {
    const out = html(<QueueView {...props} finding={{ ...props.finding, error: FINDING_WORDS.not_found }} />);
    expect(out).toContain(">Open a case</button>");
    expect(out).toContain("That link names nothing live on korbat: the post or the account does not exist or was deleted.");
    for (const rule of ["R1", "R2", "R3", "R4", "R5", "R6"]) expect(out).toContain(`<option value="${rule}"`);
    // Each rule is offered with its title, as the rulebook in force words it.
    for (const rule of RULES) expect(out, rule.id).toContain(`>${rule.id}: ${rule.title}</option>`);
    expect(RULES.map((rule) => rule.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
    expect(out).toContain('<option value="STATEMENT_CATEGORY_PROTECTION_OF_MINORS">protection of minors</option>');
    expect(out).not.toContain("STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE");
    // The categories offered are the contracts' own list of what a finding may carry: the form restates no rule of it.
    expect([...out.matchAll(/<option value="(STATEMENT_CATEGORY_[A-Z_]+)"/g)].map((found) => found[1])).toEqual([...FINDING_CATEGORIES]);
    // The form posts nowhere by itself: the page sends the finding.
    expect(out).not.toMatch(/<form[^>]*action=/);
    expect(findingOf({ link: " http://localhost:8081/post/7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36 ", ruleId: "R2", category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS" })).toEqual({
      target: { kind: "link", url: "http://localhost:8081/post/7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36" },
      ground: "rule",
      ruleId: "R2",
      category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
    });
    for (const link of ["", "not a link", "javascript:alert(1)", `http://x.test/${"a".repeat(300)}`]) expect(findingOf({ link, ruleId: "R1", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" }), link).toBeNull();
  });

  test("the queue is read page by page from its start; its own refresh carries no activity mark, its person's reads do", async () => {
    const first: QueuePage = { cases: QUEUE_ROWS.slice(0, 2), nextCursor: "page_2-cursor", replies: [] };
    const second: QueuePage = { cases: QUEUE_ROWS.slice(2), nextCursor: null, replies: [] };
    const fake = fakeFetch({ "GET /api/staff/queue": { status: 200, body: first }, "GET /api/staff/queue?cursor=page_2-cursor": { status: 200, body: second } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    expect(await readQueue(api, 1, true)).toEqual({ rows: first.cases, next: "page_2-cursor", replies: [] });
    expect(await readQueue(api, 2, false)).toEqual({ rows: QUEUE_ROWS, next: null, replies: [] });
    expect(fake.requests.map((request) => `${request.url} ${request.headers["x-staff-activity"] ?? "unmarked"}`)).toEqual([
      "/api/staff/queue 1",
      "/api/staff/queue unmarked",
      "/api/staff/queue?cursor=page_2-cursor unmarked",
    ]);
  });

  test("the screen reads the queue when it opens, marked, and again every 60 seconds, unmarked, until it is left", async () => {
    const page: QueuePage = { cases: QUEUE_ROWS, nextCursor: null, replies: [] };
    const fake = fakeFetch({ "GET /api/staff/queue": { status: 200, body: page } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const clock = new FakeClock();
    const marks = () => fake.requests.map((request) => request.headers["x-staff-activity"] ?? "unmarked");
    const stop = startQueueReads(clock, (activity) => void readQueue(api, 1, activity));
    await settle();
    // Opening the screen is its person's action.
    expect(marks()).toEqual(["1"]);
    expect(QUEUE_REFRESH_MS).toBe(60_000);
    await clock.advance(QUEUE_REFRESH_MS - 1);
    expect(marks()).toEqual(["1"]);
    // The refresh is the page's own: it never moves the session's idle end.
    await clock.advance(1);
    expect(marks()).toEqual(["1", "unmarked"]);
    await clock.advance(3 * QUEUE_REFRESH_MS);
    expect(marks()).toEqual(["1", "unmarked", "unmarked", "unmarked", "unmarked"]);
    // Leaving the screen ends its reads.
    stop();
    expect(clock.pending).toBe(0);
    await clock.advance(5 * QUEUE_REFRESH_MS);
    expect(marks()).toHaveLength(5);
  });
});

describe("the home screen's overview", () => {
  test("the lanes with their open cases and oldest waiting time, the appeals waiting, every reveal with its staff handle and its case, and the day's counts by staff handle", () => {
    const out = html(<OverviewView overview={overview()} now={NOW} onOpenCase={noop} />);
    expect(StaffOverview.safeParse(overview()).success).toBe(true);
    expect(out).toContain("Urgent: 2 cases, oldest 14 minutes");
    expect(out).toContain("Lane 1: no open case");
    expect(out).toContain("Lane 2: 1 case, oldest 3 days");
    expect(out).toContain("3 appeals wait; you may review 1; 1 has no possible reviewer now.");
    expect(out).toContain("The emergency switch is off.");
    expect(out).toContain(`<bdi>${HOSTILE_ESCAPED.script}</bdi>`);
    expect(hrefs(out)).toEqual([`/cases/${CASE_POST}`]);
    expect(out).toContain(`<bdi>${HOSTILE_ESCAPED.img}</bdi>: 4 images viewed`);
    expect(out).toContain(": 1 finding opened");
    expect(out).not.toContain("Mails waiting");
    expect(out).not.toContain("not released");
    expectInert(out);
  });

  test("late erasures are said only when there are any: each count above zero under its own words, then the runbook's sentence", () => {
    const none = { caseEvidence: 0, intakeRecords: 0, statements: 0, redactions: 0, images: 0, drafts: 0, accessLog: 0, contacts: 0 };
    // The runbook's sentence, in the words of the design's runbook bullet (section 13, Task 12(a)).
    expect(ERASURE_OVERDUE_RUNBOOK).toBe(
      "A count of late erasures names the due rule whose step keeps failing, so evidence, an intake record or a notifier's name and address outlives its published period: read the API log for moderation-retention and for auth janitor: purge failed, and check that API_MODERATION_RETENTION was not left off after a restore (the API logs it at every start).",
    );
    // Every count of the contract has its words, and no other key has any.
    expect(Object.keys(ERASURE_OVERDUE_WORDS).sort()).toEqual(Object.keys(StaffOverview.shape.erasureOverdue.shape).sort());
    expect(erasureOverdue(none)).toBeNull();
    const quiet = html(<OverviewView overview={overview()} now={NOW} onOpenCase={noop} />);
    expect(quiet).not.toContain("Erasures more than a day late");
    expect(quiet).not.toContain("moderation-retention");

    expect(erasureOverdue({ ...none, images: 60 })).toBe(`Erasures more than a day late: image rows nothing retains: 60. ${ERASURE_OVERDUE_RUNBOOK}`);
    const late = { ...none, caseEvidence: 2, redactions: 1, contacts: 3 };
    expect(erasureOverdue(late)).toBe(`Erasures more than a day late: closed cases whose evidence is due: 2; R4 erasures: 1; notifiers' contacts and confirmations: 3. ${ERASURE_OVERDUE_RUNBOOK}`);
    const out = html(<OverviewView overview={overview({ erasureOverdue: late })} now={NOW} onOpenCase={noop} />);
    expect(out).toContain('<p role="alert" class="error">Erasures more than a day late: closed cases whose evidence is due: 2; R4 erasures: 1; notifiers&#x27; contacts and confirmations: 3. A count of late erasures names');
    // A count of zero is not listed among the late ones.
    expect(out).not.toContain("unconfirmed drafts");
    expect(out).not.toContain("image rows nothing retains");
    for (const key of Object.keys(none) as (keyof typeof none)[]) {
      expect(erasureOverdue({ ...none, [key]: 7 }), key).toBe(`Erasures more than a day late: ${ERASURE_OVERDUE_WORDS[key]}: 7. ${ERASURE_OVERDUE_RUNBOOK}`);
    }
    expectInert(out);
  });

  test("what waits too long is said only when it does: mails, the release, more reveals than the list holds, and the switch", () => {
    const busy = overview({
      appealsWaiting: 1,
      appealsYouMayReview: 0,
      appealsWithoutReviewer: 0,
      mailsWaiting: { receipts: 1, authorMails: 0, outcomes: 2 },
      mailsFailed: { receipts: 0, authorMails: 3, outcomes: 0 },
      releaseOverdue: 4,
      deferUnproven: true,
      reveals: { total: 140, items: Array.from({ length: 100 }, () => ({ at: "2026-09-30T10:00:00.000Z", handle: "mod_anna", caseId: CASE_POST })) },
    });
    const out = html(<OverviewView overview={busy} now={NOW} onOpenCase={noop} />);
    expect(out).toContain("1 appeal waits; you may review none.");
    expect(out).toContain("Mails waiting for more than an hour: 1 receipt, 0 statements to authors, 2 outcomes.");
    expect(out).toContain("Mails given up in the last 30 days: 0 receipts, 3 statements to authors, 0 outcomes.");
    // The count, and the runbook's sentence for it, in the words of the design's runbook bullet (section 13, Task 12(a)).
    expect(RELEASE_OVERDUE_RUNBOOK).toBe(
      "A count of decisions not released means the daily release keeps failing: notifiers are not told and re-examination windows do not open, so read the API log for moderation-dispatch and fix it the same day.",
    );
    expect(releaseOverdue(4)).toBe(`Decisions not released after 26 hours: 4. ${RELEASE_OVERDUE_RUNBOOK}`);
    expect(out).toContain(
      '<p role="alert" class="error">Decisions not released after 26 hours: 4. A count of decisions not released means the daily release keeps failing: notifiers are not told and re-examination windows do not open, so read the API log for moderation-dispatch and fix it the same day.</p>',
    );
    expect(out).toContain("Showing the newest 100 of 140.");
    expect(out).toContain("The emergency switch is on");
    // An id that is no lower-case uuid never becomes a link.
    const odd = html(<OverviewView overview={overview({ reveals: { total: 1, items: [{ at: "2026-09-30T10:00:00.000Z", handle: "mod_anna", caseId: CASE_POST.toUpperCase() }] } })} now={NOW} onOpenCase={noop} />);
    expect(hrefs(odd)).toEqual([]);
  });
});

describe("the home screen's three lists of the path for child sexual abuse material", () => {
  const at = "2026-09-30T10:00:00.000Z";
  const lists = overview({
    protectionLifted: {
      total: 2,
      items: [
        { at, handle: HOSTILE.script, caseId: CASE_FROZEN, kind: "unsealed" },
        { at, handle: HOSTILE.img, caseId: CASE_ACCOUNT, kind: "dismissed" },
      ],
    },
    sealsDeclined: { total: 1, items: [{ at, handle: HOSTILE.quote, caseId: CASE_QUOTED }] },
    interimSeals: { total: 1, items: [{ at, handle: HOSTILE.script, caseId: CASE_FROZEN, posts: 3, images: 7 }] },
  });

  test("the decisions that lifted the protection of reported images, the choices not to seal, and the seals taken while deciding that are in force: time, staff handle, case link, and what each did or covers", () => {
    expect(StaffOverview.safeParse(lists).success).toBe(true);
    const out = html(<OverviewView overview={lists} now={NOW} onOpenCase={noop} />);
    expect(out).toContain("Lifted a seal");
    expect(out).toContain("Answered a report of child sexual abuse material without a seal");
    expect(out).toContain("Chose not to seal");
    expect(out).toContain("7 images on 3 posts");
    // Each row links to its case, in the console, and every handle is text.
    expect(hrefs(out)).toEqual([`/cases/${CASE_POST}`, `/cases/${CASE_FROZEN}`, `/cases/${CASE_ACCOUNT}`, `/cases/${CASE_QUOTED}`, `/cases/${CASE_FROZEN}`]);
    expect(out).toContain(`<bdi>${HOSTILE_ESCAPED.quote}</bdi>`);
    expectInert(out);
    for (const heading of ["Protection of reported images lifted in the last 30 days", "Choices not to seal in the last 30 days", "Seals taken while deciding that are in force"]) expect(out).toMatch(new RegExp(`<h3[^>]*>${heading}</h3>`));
  });

  test("an empty list says so, and a list longer than it shows says how many there are", () => {
    const quiet = html(<OverviewView overview={overview()} now={NOW} onOpenCase={noop} />);
    expect(quiet).toContain("No decision lifted the protection of reported images in the last 30 days.");
    expect(quiet).toContain("Nobody recorded a choice not to seal in the last 30 days.");
    expect(quiet).toContain("No seal taken while deciding is in force.");
    const row = { at, handle: "mod_anna", caseId: CASE_FROZEN };
    const many = html(
      <OverviewView
        overview={overview({
          protectionLifted: { total: 130, items: Array.from({ length: 100 }, () => ({ ...row, kind: "dismissed" as const })) },
          sealsDeclined: { total: 101, items: Array.from({ length: 100 }, () => row) },
          interimSeals: { total: 250, items: Array.from({ length: 100 }, () => ({ ...row, posts: 1, images: 1 })) },
        })}
        now={NOW}
        onOpenCase={noop}
      />,
    );
    for (const total of [130, 101, 250]) expect(many).toContain(`Showing the newest 100 of ${total}.`);
    expect(many).toContain("1 image on 1 post");
    // An id that is no lower-case uuid never becomes a link.
    const odd = html(<OverviewView overview={overview({ sealsDeclined: { total: 1, items: [{ ...row, caseId: CASE_FROZEN.toUpperCase() }] } })} now={NOW} onOpenCase={noop} />);
    expect(hrefs(odd)).toEqual([`/cases/${CASE_POST}`]);
  });
});

describe("the case page", () => {
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
  const page = (view: CaseView, extra: Partial<CaseScreenViewProps> = {}) => html(<CaseScreenView {...base} caseId={caseId(view.id)} view={view} {...extra} />);

  test("the fixtures are cases as the contracts describe them", () => {
    for (const view of [postCase(), frozenCase(), accountCase()]) expect(CaseView.safeParse(view).success, view.id).toBe(true);
  });

  test("with a role the page ends in the decision composer and offers Lift what was done while deciding beside the decision; without one it decides nothing", () => {
    const view = postCase();
    const compose: NonNullable<CaseScreenViewProps["compose"]> = {
      role: "moderator",
      draft: newDraft(caseId(view.id), view, "moderator"),
      now: new Date(NOW),
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
    };
    const out = page(view, { compose });
    // The composer comes last, after the notes.
    expect(out.indexOf('<h3 id="composer-title">Decide</h3>')).toBeGreaterThan(out.indexOf(">Add a note</label>"));
    expect(out).toContain(">Confirm with your staff key</button>");
    expect(out).toContain(">Lift what was done while deciding</button>");
    // Still no link into the app, and nothing a hostile string could have made.
    expect(hrefs(out)).toEqual([]);
    expectInert(out);
    const bare = page(view);
    expect(bare).not.toContain("composer-title");
    expect(bare).not.toContain("Lift what was done while deciding");
    // A correction takes the composer's place while it is open.
    const correcting = page(view, { compose: { ...compose, draft: correctionDraft(caseId(view.id), view, view.decisions[0]!, "moderator") } });
    expect(correcting).toMatch(/<h3 id="composer-title">Lift what was done while deciding<\/h3>/);
    expect(correcting).toContain(">Lift the restriction of the post</span>");
    expect(correcting).toContain(">Reason of the correction</label>");
  });

  test("a post's case: the header, the evidence in frames, the images as placeholders, the items with their sources, the decision and the notes; every written string as text, and no link into the app", () => {
    const out = page(postCase());
    expect(out).toMatch(/<h2[^>]*>Case about a post</);
    expect(out).toContain("Lane 2; opened 2026-10-01 08:00; version 3");
    expect(out).not.toContain("closed");
    // The post's address and the items' are text.
    expect(out).toContain(`<code>http://localhost:8081/post/7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36</code>`);
    expect(hrefs(out)).toEqual([]);
    expectInert(out);
    for (const escaped of [HOSTILE_ESCAPED.script, HOSTILE_ESCAPED.img, HOSTILE_ESCAPED.quote]) expect(out).toContain(escaped);
    expect(out).toContain(`<bdi>${HOSTILE.bidi}</bdi>`);
    expect(out).toContain('<p class="frame-label">Written by the author</p>');
    expect(out).toContain('<p class="frame-label">Explanation. Written by Reporter A</p>');
    expect(out).toContain('<p class="frame-label">Cited law. Written by a notifier</p>');
    expect(out).toContain('<p class="frame-label">Alt text. Written by the author</p>');
    expect(out).toContain('<p class="frame-label">Note. Written by staff</p>');
    // The hosts the post's text really names, and the address after them whose host no browser could read.
    expect(out).toContain('<p class="hint">Mentions addresses at: <bdi>korbat.example.evil.test, evil.test</bdi> and an address this console cannot read</p>');
    // The look-alike label is only ever inside a frame's text.
    expect(out.split("korbat: verified notice from police").length - 1).toBe(out.split('<p class="frame-text"><bdi>korbat: verified notice from police</bdi>').length - 1);
    // Images: grey placeholders with their sizes as text, and no image element until one is asked for.
    expect(images(out)).toEqual([]);
    expect(out.match(/class="placeholder"/g)).toHaveLength(2);
    expect(out).toContain("2048 by 1536 pixels");
    expect(out.match(/>Show image<\/button>/g)).toHaveLength(2);
    expect(out).not.toContain("Images of this post are not shown");
    // The source summaries, and who can be revealed.
    expect(out).toContain("account 1 to 12 months old; 2 to 9 reports filed; under half of the decided ones acted on; 1 answered without the images");
    expect(out.match(/>Reveal who sent this<\/button>/g)).toHaveLength(2);
    expect(out).toContain("Withhold the post: in force");
    expect(out).toContain(">Add a note</label>");
    // No banner of the urgent lane or of a suspicion on a case without either.
    expect(out).not.toContain("Art. 18");
    expect(out).not.toContain("Nobody opens the images");
    expect(out).not.toContain("Take a fresh snapshot");
  });

  test("an image is in the page only once its person asked for it: first small and blurred, then large and clear, one at a time", () => {
    const one = parseImageId(IMAGE_ONE)!;
    const blurred = page(postCase(), { shownImage: { id: one, clear: false, failed: false } });
    expect(images(blurred)).toEqual([`/api/staff/cases/${CASE_POST}/media/${IMAGE_ONE}/small`]);
    expect(blurred).toContain('class="evidence blurred"');
    expect(blurred).toContain(">Show clearly</button>");
    expect(blurred.match(/>Show image<\/button>/g)).toHaveLength(1);
    const clear = page(postCase(), { shownImage: { id: one, clear: true, failed: false } });
    expect(images(clear)).toEqual([`/api/staff/cases/${CASE_POST}/media/${IMAGE_ONE}/large`]);
    expect(clear).toContain('class="evidence"');
    expect(clear).not.toContain(">Show clearly</button>");
    // An image whose id is no lower-case uuid is never asked for.
    const odd = page(postCase({ snapshots: [postSnapshot({ media: [{ id: IMAGE_TWO.toUpperCase(), alt: "", width: 10, height: 10 }] })] }));
    expect(odd).not.toContain(">Show image</button>");
  });

  test("an image the API refused or that did not load says so in its place, in the console's words, and is not asked for again by the page", () => {
    const one = parseImageId(IMAGE_ONE)!;
    const out = page(postCase(), { shownImage: { id: one, clear: false, failed: true } });
    expect(out).toContain('<div class="placeholder"><span>That image is not shown.</span></div>');
    expect(messageFor("image_refused")).toBe("That image is not shown.");
    expect(images(out)).toEqual([]);
    expect(out).not.toContain("<img");
    // The person may put it away; nothing offers to show it more clearly.
    expect(out).toContain(">Hide image</button>");
    expect(out).not.toContain(">Show clearly</button>");
    // The other image keeps its own placeholder and button.
    expect(out).toContain("<span>Image 2, not shown</span>");
    expect(out.match(/>Show image<\/button>/g)).toHaveLength(1);
    // The image element reports a failed load to the page through a handler React attaches, never an attribute.
    const element = html(<StaffImage caseId={caseId(CASE_POST)} mediaId={one} size="small" clear={false} onError={noop} />);
    expect(element).not.toMatch(/ on[a-z]+=/i);
  });

  test("the urgent lane's case shows the Art. 18 check above the evidence, word for word", () => {
    const out = page(frozenCase());
    expect(ART_18_BANNER).toBe(
      'Art. 18: decide now, as soon as you have read this case, whether it suggests a crime that threatens someone\'s life or safety. If it does, or you are unsure, wake the operator at once, at any hour. Record your check in a note ("Art. 18 check: no suspicion" or "Art. 18 check: operator told at <time>"). Nobody gives this case its final decision before that note exists.',
    );
    expect(out).toContain("Art. 18: decide now, as soon as you have read this case");
    expect(out).toContain("operator told at &lt;time&gt;");
    expect(out.indexOf("Art. 18: decide now")).toBeLessThan(out.indexOf(">Evidence</h3>"));
    expect(page(postCase({ lane: 1 }))).not.toContain("Art. 18");
  });

  test("a case with an unanswered suspect item: the banner with what the case reaches, the post's sentence, the quoted post's case, the earlier answers and the day staff last looked; no image and no image request; no link into the app", () => {
    const out = page(frozenCase(), { shownImage: { id: parseImageId(IMAGE_ONE)!, clear: true, failed: false } });
    // The banner's sentences, word for word as section 8 of the design gives them.
    expect(out).toContain("<p>Nobody opens the images this report concerns, here or in the app.</p>");
    expect(SUSPECT_BANNER.nobody).toBe("Nobody opens the images this report concerns, here or in the app.");
    expect(out).toContain("This case reaches 2 images on 1 posts; 2 are sealed and 0 are still shown to someone. Seal them now, while an admin decides: they are then shown to nobody, their author included.");
    expect(out).toContain("Do not open this post in the app while a report of this kind about it is unanswered or its images are sealed: its page also shows the post it replies to and its replies, whose images this case neither freezes nor seals.");
    expect(out).not.toContain("Do not open this account&#x27;s profile");
    expect(out).toContain("This post quotes another, whose images its card shows; korbat opened a case on that post too:");
    expect(out).toContain("An admin answered 1 earlier reports of this kind about this target without a seal in the last 12 months, the last on 2026-08-14.");
    expect(out).toContain("Staff last opened an image of this post in the console on 2026-08-15.");
    expect(out).toContain("An admin answered 2 such reports about this author&#x27;s profile or posts without a seal in the last 12 months, the last on 2026-08-14.");
    expect(out).toContain("The newest post with images this case reaches is of 2026-09-30.");
    expect(out.indexOf("Nobody opens the images this report concerns")).toBeGreaterThan(-1);
    expect(out.indexOf("Nobody opens the images this report concerns")).toBeLessThan(out.indexOf(">Evidence</h3>"));
    // The only link on the page is the quoted post's case, in the console.
    expect(hrefs(out)).toEqual([`/cases/${CASE_QUOTED}`]);
    // No image, whatever the page's state says was asked for, and the sentence in its place.
    expect(images(out)).toEqual([]);
    expect(out).not.toContain(">Show image</button>");
    expect(out).toContain(
      '<p class="notice">Images of this post are not shown: a report or finding of child sexual abuse material about it or about its author&#x27;s account is open, or its images are sealed. Decide what turns on an image on the text alone, or wait until an admin has answered that report.</p>',
    );
    expect(IMAGES_NOT_SHOWN).toBe(
      "Images of this post are not shown: a report or finding of child sexual abuse material about it or about its author's account is open, or its images are sealed. Decide what turns on an image on the text alone, or wait until an admin has answered that report.",
    );
    expect(out).not.toContain('class="placeholder"');
    // The seal: what it covers, that it changed nothing when imposed, and how to get the rest of its list.
    expect(out).toContain("730 images on 501 posts (3 of them deleted by their author)");
    expect(out).toContain("Seal the images this case reaches: in force; changed nothing when imposed");
    expect(out).toContain("Chose not to seal: ");
    // A re-examination says which item of its notice it re-examines (the page numbers the case's items otherwise), and
    // carries its mark; no reveal for an anonymous notice, a finding or a reporter no longer linked.
    expect(out).toContain("<p>Re-examination of item 1 of its notice</p>");
    expect(out).toContain("You decided the item this re-examines. Leave it to another staff member when there is one.");
    expect(out).toContain('<p class="frame-label">Statement for the re-examination. Written by a reporter no longer linked</p>');
    expect(out).not.toContain(">Reveal who sent this</button>");
    // A text of an item citing R3 or R5 opens collapsed behind the rule's own words; the case's evidence takes the
    // graver of the rules its items cite.
    expect(out).toContain('<p class="frame-label">Statement for the re-examination. Written by a reporter no longer linked</p><button type="button">Show text (R3: hatred or harassment)</button>');
    expect(out).toContain('<p class="frame-label">Written by the author</p><button type="button">Show text (R5: direct threats)</button>');
    expect(out).not.toContain(HOSTILE_ESCAPED.img);
    expectInert(out);
  });

  test("a post whose images cannot be opened still shows each image's entry: its number, its size as text and its alt text in an author frame; only the image, its placeholder and Show image are left out", () => {
    // The fixture's other items cite R5 and R3, which collapse a case's texts; with the suspect item alone they are shown.
    const suspect = item({ id: ITEM_SUSPECT, csam: true, suspect: true, allegesIllegal: true, ruleId: null, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", lane: 0, explanation: null, source: SOURCES.anonymous });
    const out = page(frozenCase({ items: [suspect] }), { shownImage: { id: parseImageId(IMAGE_ONE)!, clear: false, failed: false } });
    const sentence =
      "Images of this post are not shown: a report or finding of child sexual abuse material about it or about its author&#x27;s account is open, or its images are sealed. Decide what turns on an image on the text alone, or wait until an admin has answered that report.";
    expect(out.split(sentence).length - 1).toBe(1);
    // Each entry: the image's number, its width and height as text, and what its author wrote beside it.
    expect(out).toContain("<p>Image 1</p><p>2048 by 1536 pixels</p>");
    expect(out).toContain("<p>Image 2</p><p>800 by 600 pixels</p>");
    expect(out).toContain(`<p class="frame-label">Alt text. Written by the author</p><p class="frame-text"><bdi>${HOSTILE_ESCAPED.quote}</bdi></p>`);
    expect(out).toContain('<p class="frame-label">Alt text. Written by the author</p><p class="frame-text"><bdi>korbat: verified notice from police</bdi></p>');
    // The sentence stands above the list.
    expect(out.indexOf(sentence)).toBeLessThan(out.indexOf("<p>Image 1</p>"));
    // Never the image, whatever the page's state says was asked for; nor the grey box that stands for one, nor its button.
    expect(out).not.toContain("<img");
    expect(out).not.toContain('class="placeholder"');
    expect(out).not.toContain(">Show image</button>");
    expect(out).not.toContain(">Show clearly</button>");
    expect(out).not.toContain("not shown</span>");
    expectInert(out);
    // On the fixture as it is, the same two frames stand there, collapsed behind the rule's button.
    const collapsed = page(frozenCase());
    expect(collapsed.match(/<p class="frame-label">Alt text\. Written by the author<\/p><button type="button">Show text \(R5: direct threats\)<\/button>/g)).toHaveLength(2);
    expect(collapsed).toContain("<p>Image 2</p><p>800 by 600 pixels</p>");
    expect(collapsed).not.toContain("<img");
    expect(collapsed).not.toContain(">Show image</button>");
  });

  test("an earlier answer is mentioned only when there is one, the added-item sentence only on an added item, and none of the banner on a case without an unanswered suspect item", () => {
    const fresh = frozenCase({ suspicion: { open: true, reach: { posts: 1, images: 2, sealed: 0, served: 2, newestPostOn: "2026-09-30" }, earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } } } });
    const out = page({ ...fresh, items: [item({ suspect: true, csam: true, position: 11, quotedByPosition: 1, source: SOURCES.anonymous })] });
    expect(out).not.toContain("An admin answered");
    expect(out).not.toContain("Staff last opened");
    expect(out).not.toContain("The newest post with images");
    expect(out).toContain("korbat added this item: a reported post quotes this one, and its card shows this post&#x27;s images.");
    expect(out).not.toContain("This post quotes another");
    expect(hrefs(out)).toEqual([]);
    // An earlier answer about the target while staff never opened an image of the post: the answer is told, and no day
    // of a look that never was.
    const unopened = page(frozenCase({ suspicion: { ...frozenCase().suspicion!, earlier: { target: { count: 3, lastOn: "2026-08-14", imagesOpenedOn: null }, author: { count: 0, lastOn: null } } } }));
    expect(unopened).toContain("An admin answered 3 earlier reports of this kind about this target without a seal in the last 12 months, the last on 2026-08-14.");
    expect(unopened).not.toContain("Staff last opened");
    expect(unopened).not.toContain("such reports about this author");
    expect(unopened).toContain("The newest post with images this case reaches is of 2026-09-30.");
    // Answered: the suspicion stays in the answer, the banner goes.
    const answered = page(frozenCase({ imagesAllowed: true, suspicion: { ...frozenCase().suspicion!, open: false } }));
    expect(answered).not.toContain("Nobody opens the images");
    expect(answered).not.toContain("korbat added this item");
    expect(answered).toContain(">Show image</button>");
  });

  test("an account's case: the account's sentences, the no-image sentence, the fields as they read now beside the snapshot's, a fresh snapshot offered, and never an image", () => {
    const out = page(accountCase());
    expect(out).toMatch(/<h2[^>]*>Case about an account</);
    expect(out).toContain("<p>This case reaches no image, so there is nothing to seal.</p>");
    expect(SUSPECT_BANNER.noImage).toBe("This case reaches no image, so there is nothing to seal.");
    expect(out).not.toContain("This case reaches 0 images");
    expect(out).toContain("Do not open this account&#x27;s profile in the app while a report of this kind about it is unanswered or its images are sealed: the profile also shows posts of other accounts that it reposted or quoted, whose images this case neither freezes nor seals, and images posted since the seal. When this page shows images that are not sealed, seal again.");
    expect(out).not.toContain("Do not open this post in the app");
    // The fields as they read now, and as the snapshot copied them: each in a frame that says what it is and who wrote it.
    expect(out).toContain('<p class="frame-label">Display name. Written by the author</p><p class="frame-text"><bdi>korbat: verified notice from police</bdi>');
    expect(out).toContain('<p class="frame-label">Display name. Written by the author</p><p class="frame-text"><bdi>An earlier name</bdi>');
    expect(out.match(/<p class="frame-label">Bio\. Written by the author<\/p>/g)).toHaveLength(2);
    expect(targetDiffers(accountCase())).toBe(true);
    expect(out).toContain(">Take a fresh snapshot</button>");
    expect(images(out)).toEqual([]);
    expect(out).not.toContain('class="placeholder"');
    // An account's case shows no image, so it has no sentence about images that are not shown either.
    expect(out).not.toContain("Images of this post are not shown");
    // The item's address is the handle as it was named, as text.
    expect(out).toContain("<bdi>http://localhost:8081/u/named_once</bdi>");
    expect(hrefs(out)).toEqual([]);
    expectInert(out);
  });

  test("on a case citing R3 or R5 the account's fields as they read now open collapsed too, as the snapshot's do", () => {
    const threat = item({ ruleId: "R5", lane: 0, explanation: null, source: SOURCES.staff });
    const out = page(accountCase({ items: [threat] }));
    // The field now and the field as copied: both behind the rule's button, neither on the page.
    expect(out.match(/<p class="frame-label">Display name\. Written by the author<\/p><button type="button">Show text \(R5: direct threats\)<\/button>/g)).toHaveLength(2);
    expect(out.match(/<p class="frame-label">Bio\. Written by the author<\/p><button type="button">Show text \(R5: direct threats\)<\/button>/g)).toHaveLength(2);
    expect(out).not.toContain("korbat: verified notice from police");
    expect(out).not.toContain("An earlier name");
    const harassment = page(accountCase({ items: [item({ ruleId: "R3", explanation: null, source: SOURCES.staff })] }));
    expect(harassment.match(/<button type="button">Show text \(R3: hatred or harassment\)<\/button>/g)).toHaveLength(4);
  });

  test("the decisions: a measure in force, one a later decision lifted, one that ended with the case's decision, a seal that ended with the admin's answer, and beside a field reset that it was written once", () => {
    const LIFTING = "0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f";
    const action = (id: string, kind: CaseView["decisions"][number]["actions"][number]["kind"], more: Partial<CaseView["decisions"][number]["actions"][number]> = {}) => ({ id, kind, mediaId: null, noEffect: null, inForce: false, reversesActionId: null, liftedBy: null, sealed: null, ...NO_STANDING, ...more });
    const WITHHOLD = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const out = page(
      accountCase({
        decisions: [
          decision({
            actions: [
              action(WITHHOLD, "withhold", { liftedBy: LIFTING }),
              action("2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", "withhold_media", { mediaId: IMAGE_ONE }),
              action("3c4d5e6f-7a8b-4c9d-ae1f-2a3b4c5d6e7f", "seal_media", { sealed: { posts: 1, images: 2, deletedPosts: 0, list: [] } }),
              action("4d5e6f7a-8b9c-4dae-bf2a-3b4c5d6e7f8a", "reset_display_name", { inForce: true }),
              action("5e6f7a8b-9cad-4ebf-803b-4c5d6e7f8a9b", "reset_bio", { noEffect: "already" }),
            ],
          }),
          decision({ id: LIFTING, kind: "correction", outcome: "reversed", decidedAt: "2026-10-01T10:15:00.000Z", actions: [action("6f7a8b9c-adbe-4fc0-914c-5d6e7f8a9bac", "restore", { reversesActionId: WITHHOLD })] }),
        ],
      }),
    );
    // What lifted a measure: the decision that reversed it, by its time.
    expect(out).toContain("<li>Withhold the post: lifted by the decision of 2026-10-01 10:15</li>");
    expect(out).toContain(`<li>Withhold one image <code>${IMAGE_ONE}</code>: ended with the case&#x27;s decision</li>`);
    expect(out).toContain("Seal the images this case reaches: ended with the admin&#x27;s answer");
    expect(out).toContain("<li>Reset display name: in force; written once; the field as it reads now is shown above</li>");
    expect(out).toContain("<li>Reset bio: ended with the case&#x27;s decision; changed nothing when imposed; written once; the field as it reads now is shown above</li>");
    // A reversal is no measure: it has no state of its own.
    expect(out).toContain("<li>Lift the restriction of the post</li>");
    // Each decision's kind and outcome in the console's own words, one table each.
    expect(out).toContain(`<strong>${DECISION_KINDS.interim}</strong>: ${DECISION_OUTCOMES.restricted}, 2026-10-01 09:00, by `);
    expect(out).toContain(`<strong>${DECISION_KINDS.correction}</strong>: ${DECISION_OUTCOMES.reversed}, 2026-10-01 10:15, by `);
    expect(DECISION_KINDS).toEqual({ interim: "While deciding", final: "Final decision", review: "Review of an appeal", correction: "Correction" });
    // An item's outcome, once answered.
    expect(page(postCase({ items: [item({ outcome: "restricted_rule", answeredBy: LIFTING })] }))).toContain(`<p>Answered: ${OUTCOME_WORDS.restricted_rule}.</p>`);
    expect(OUTCOME_WORDS.not_available).toBe("nothing live at the link");
  });

  test("a fresh snapshot is offered when the target differs from the newest one or that one is withheld, and a withheld snapshot shows no content", () => {
    expect(targetDiffers(postCase())).toBe(false);
    expect(targetDiffers(postCase({ target: { ...postCase().target, type: "post", state: "deleted_by_author" } as CaseView["target"] }))).toBe(true);
    const withheld = postCase({ snapshots: [{ id: "8c9daebf-c0d1-42e3-845f-7a8b9cadbecf", takenAt: "2026-10-01T08:00:00.000Z", digest: "ab".repeat(32), withheld: true }] });
    expect(targetDiffers(withheld)).toBe(true);
    const out = page(withheld);
    expect(out).toContain("Withheld: its content was erased, or copies content that was erased since.");
    expect(out).not.toContain("Written by the author");
    expect(images(out)).toEqual([]);
  });

  describe("the reveal dialog", () => {
    const dialog = (reveal: Partial<NonNullable<CaseScreenViewProps["reveal"]>>) =>
      html(<RevealDialog reveal={{ itemId: ITEM_REPORTER, category: null, reason: "", busy: false, error: null, answer: null, ...reveal }} onChange={noop} onConfirm={noop} onClose={noop} />);
    const CONFIRM = />Confirm with your staff key<\/button>/;
    const CONFIRM_OFF = /<button type="button" class="primary" disabled=""[^>]*>Confirm with your staff key<\/button>/;

    test("opens on the item it was asked for, with the four reasons and none of them chosen, a reason text, and no other reveal to start meanwhile", () => {
      const asking = page(postCase(), { reveal: { itemId: ITEM_REPORTER, category: null, reason: "", busy: false, error: null, answer: null } });
      expect(asking.match(/role="dialog"/g)).toHaveLength(1);
      // Nothing is chosen for the person: the list opens on a line that is no reason.
      expect(asking).toContain('<option value="" disabled="" selected="">Choose why</option>');
      const reasons = { impersonation_claim: "A claim of impersonation", abuse_of_reporting: "Abuse of reporting", legal_requirement: "A legal requirement", other: "Another reason" };
      for (const [value, words] of Object.entries(reasons)) expect(asking).toContain(`<option value="${value}">${words}</option>`);
      expect(asking).toContain('<textarea id="reveal-reason"');
      // While one reveal is open no other can be started.
      expect(asking.match(/>Reveal who sent this<\/button>/g)).toHaveLength(2);
      expect(asking.match(/disabled="">Reveal who sent this<\/button>/g)).toHaveLength(2);
    });

    test("is confirmed with the key only once a reason is chosen and one is written: until then the button is off", () => {
      expect(dialog({})).toMatch(CONFIRM_OFF);
      expect(dialog({ category: "other" })).toMatch(CONFIRM_OFF);
      expect(dialog({ reason: "The reporter claims to be impersonated." })).toMatch(CONFIRM_OFF);
      // White space is no reason.
      expect(dialog({ category: "other", reason: `  ${String.fromCharCode(10)} ` })).toMatch(CONFIRM_OFF);
      const ready = dialog({ category: "abuse_of_reporting", reason: "The same account reported forty posts in an hour." });
      expect(ready).toMatch(CONFIRM);
      expect(ready).not.toMatch(CONFIRM_OFF);
      expect(ready).toContain('<option value="abuse_of_reporting" selected="">Abuse of reporting</option>');
      // Under way: off again, with the fields.
      expect(dialog({ category: "other", reason: "A reason.", busy: true })).toMatch(CONFIRM_OFF);
    });

    test("words a refusal in place, and keeps what was written", () => {
      const refused = dialog({ category: "other", reason: "As the reporter wrote: it is me.", error: messageFor("text_quotes_user") });
      expect(refused).toContain('<p role="alert" class="error">This text quotes what someone wrote about this case. Describe it in your own words, never copy it.</p>');
      expect(refused).toContain(">As the reporter wrote: it is me.</textarea>");
      expect(refused).toMatch(CONFIRM);
    });

    test("shows the answer in a frame of its own, the name alone as its text with its hidden characters to show, under a line of the console's that says what it is", () => {
      const label = '<p class="frame-label">Revealed to you; recorded and shown to every staff member</p>';
      const shown = dialog({ category: "other", reason: "x", answer: { handle: HOSTILE.script, name: null } });
      expect(shown).toContain(`<p>The reporter&#x27;s handle:</p><div class="frame">${label}<p class="frame-text"><bdi>${HOSTILE_ESCAPED.script}</bdi></p>`);
      expect(shown).toContain(">Show hidden characters</button>");
      expect(shown).not.toMatch(CONFIRM);
      expect(shown).toContain(">Close</button>");
      const named = dialog({ category: "other", reason: "x", answer: { handle: null, name: HOSTILE.bidi } });
      expect(named).toContain(`<p>The name the notifier gave:</p><div class="frame">${label}<p class="frame-text"><bdi>${HOSTILE.bidi}</bdi></p>`);
      // A name that was forgotten in between: nothing to frame, and the console says so.
      const forgotten = dialog({ category: "other", reason: "x", answer: { handle: null, name: null } });
      expect(forgotten).toContain("<p>The name is no longer kept, so nothing can be shown. The reveal is recorded all the same.</p>");
      expect(forgotten).not.toContain('class="frame"');
      expectInert(shown + named + forgotten);
    });

    test("the name is nowhere but in the open dialog: the case page without it, and the case's own answer, hold none of it", () => {
      const answer = { handle: "revealed_reporter_handle", name: null };
      const open = page(postCase(), { reveal: { itemId: ITEM_REPORTER, category: "other", reason: "x", busy: false, error: null, answer } });
      expect(open.split("revealed_reporter_handle").length - 1).toBe(1);
      // Closed, the page is the case as the API answers it, which never carries a source's name.
      expect(page(postCase(), { reveal: null })).not.toContain("revealed_reporter_handle");
      expect(JSON.stringify(postCase())).not.toContain("revealed_reporter_handle");
    });
  });
});

describe("saving a text", () => {
  const CASE = caseId(CASE_POST);
  const saved = { id: "8c9daebf-c0d1-42e3-845f-7a8b9cadbecf", digest: "cd".repeat(32) };

  test("the console trims the text, draws a 32-byte salt and sends the digest of exactly what it sends; what it answers is the digest it computed", async () => {
    const digest = await textDigest("ab".repeat(32), "Art. 18 check: no suspicion");
    const fake = fakeFetch({ [`POST /api/staff/cases/${CASE_POST}/texts`]: { status: 201, body: { id: saved.id, digest } } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
    const random = (length: number) => new Uint8Array(length).fill(0xab);
    const answer = await saveStaffText({ api, random }, CASE, "note", "  Art. 18 check: no suspicion \n");
    expect(answer).toEqual({ id: saved.id, digest, text: "Art. 18 check: no suspicion", salt: "ab".repeat(32) });
    const sent = fake.requests[0]!.body as { kind: string; text: string; salt: string; digest: string };
    expect(sent).toEqual({ kind: "note", text: "Art. 18 check: no suspicion", salt: "ab".repeat(32), digest });
    expect(fake.requests[0]!.headers["x-staff-activity"]).toBe("1");
    expect(newSalt(random)).toBe("ab".repeat(32));
    expect(newSalt()).toMatch(/^[0-9a-f]{64}$/);
    expect(newSalt()).not.toBe(newSalt());
    // The composed form: a letter and its combining accent become the one letter.
    expect(normalised(`e${String.fromCharCode(0x301)} `)).toBe(String.fromCharCode(0xe9));
  });

  test("a text the rules refuse is never sent", async () => {
    const fake = fakeFetch({});
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    for (const text of ["x".repeat(5001), `a${String.fromCharCode(7)}b`, `a${String.fromCharCode(0x202e)}b`]) {
      await expect(saveStaffText({ api }, CASE, "reason", text)).rejects.toBeInstanceOf(TextRefused);
    }
    // Nor is a text of nothing or of white space alone, whatever its kind: the API takes none.
    for (const kind of ["note", "reveal_reason", "facts", "seal_declined"] as const) {
      for (const text of ["", "   ", ` ${String.fromCharCode(10)} `]) {
        await expect(saveStaffText({ api }, CASE, kind, text)).rejects.toMatchObject({ code: "invalid_request" });
      }
    }
    expect(fake.requests).toEqual([]);
  });

  test("a save answered with another digest than the console computed is refused: the digest a confirmed action names is never one an answer carried", async () => {
    // The digest of a text the person never wrote, as an API under an attacker's control would answer it.
    const theirs = await textDigest("ab".repeat(32), "A reason the person never wrote.");
    const fake = fakeFetch({ [`POST /api/staff/cases/${CASE_POST}/texts`]: { status: 201, body: { id: saved.id, digest: theirs } } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
    const refused = await saveStaffText({ api, random: (length) => new Uint8Array(length).fill(0xab) }, CASE, "reveal_reason", "What the person wrote.").catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ code: "invalid_answer", message: messageFor("invalid_answer") });
  });
});

describe("the reveal as the case page runs it: the reason saved first, then the key", () => {
  const CASE = caseId(CASE_POST);
  const REASON = "The same account reported forty posts of one author in an hour.";
  const SALT = "ab".repeat(32);
  const random = (length: number) => new Uint8Array(length).fill(0xab);
  const TEXTS = `POST /api/staff/cases/${CASE_POST}/texts`;
  const REVEAL = `POST /api/staff/items/${ITEM_REPORTER}/reveal`;

  async function run(table: Parameters<typeof fakeFetch>[0]) {
    const fake = fakeFetch({ "GET /api/staff/me": { status: 200, body: makeMe() }, ...table });
    const credentials = fakeCredentials();
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
    const outcome = await revealSource({ api, credentials, random }, CASE, ITEM_REPORTER, "abuse_of_reporting", `  ${REASON} `);
    return { outcome, credentials, sent: fake.requests.map((request) => `${request.method} ${request.url}`), requests: fake.requests };
  }

  test("the key confirms the digest the console computed from what its person wrote, and the reveal carries it", async () => {
    const digest = await textDigest(SALT, REASON);
    const action = revealAction(ITEM_REPORTER, { reasonCategory: "abuse_of_reporting", reasonDigest: digest });
    const ran = await run({
      [TEXTS]: { status: 201, body: { id: "8c9daebf-c0d1-42e3-845f-7a8b9cadbecf", digest } },
      "POST /api/staff/step-up/options": { status: 200, body: stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)) },
      [REVEAL]: { status: 200, body: { handle: "some_reporter", name: null } },
    });
    expect(ran.outcome).toEqual({ answer: { handle: "some_reporter", name: null } });
    expect(ran.sent).toEqual([TEXTS, "GET /api/staff/me", "POST /api/staff/step-up/options", REVEAL]);
    expect(ran.requests[0]!.body).toEqual({ kind: "reveal_reason", text: REASON, salt: SALT, digest });
    expect(ran.requests[2]!.body).toEqual(action);
    expect(ran.requests[3]!.body).toMatchObject({ reasonCategory: "abuse_of_reporting", reasonDigest: digest });
    expect(ran.credentials.calls).toHaveLength(1);
  });

  test("a save answered with another text's digest ends the reveal there: the key is never asked, and no options and no reveal are sent", async () => {
    const theirs = await textDigest(SALT, "A reason the person never wrote.");
    // Options that bind the reveal under the answered digest stand ready: a console that built its action from the answer
    // would find them in order and ask the key.
    const forged = revealAction(ITEM_REPORTER, { reasonCategory: "abuse_of_reporting", reasonDigest: theirs });
    const ran = await run({
      [TEXTS]: { status: 201, body: { id: "8c9daebf-c0d1-42e3-845f-7a8b9cadbecf", digest: theirs } },
      "POST /api/staff/step-up/options": { status: 200, body: stepUpOptions(await stepUpChallenge(SESSION_HANDLE, forged)) },
      [REVEAL]: { status: 200, body: { handle: "some_reporter", name: null } },
    });
    expect(ran.outcome).toEqual({ error: messageFor("invalid_answer") });
    expect(ran.credentials.calls).toEqual([]);
    expect(ran.sent).toEqual([TEXTS]);
  });

  test("each step's refusal is worded as that step's: the minute's limit on saved texts is never told as the day's limit on reveals", async () => {
    const digest = await textDigest(SALT, REASON);
    const action = revealAction(ITEM_REPORTER, { reasonCategory: "abuse_of_reporting", reasonDigest: digest });
    // The save is refused: nothing after it is sent.
    const saving = await run({ [TEXTS]: { status: 429, body: envelope("rate_limited") } });
    expect(saving.outcome).toEqual({ error: "Too many texts were saved in a minute. Wait a moment and save again." });
    expect(saving.outcome).toEqual({ error: NOTE_WORDS.rate_limited });
    expect(saving.sent).toEqual([TEXTS]);
    expect(saving.credentials.calls).toEqual([]);
    // The reveal is refused, once the key confirmed it.
    const revealing = await run({
      [TEXTS]: { status: 201, body: { id: "8c9daebf-c0d1-42e3-845f-7a8b9cadbecf", digest } },
      "POST /api/staff/step-up/options": { status: 200, body: stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)) },
      [REVEAL]: { status: 429, body: envelope("rate_limited") },
    });
    expect(revealing.outcome).toEqual({ error: "You have revealed as many sources as one staff account may in a day. You can reveal others after midnight UTC." });
    expect(revealing.outcome).toEqual({ error: REVEAL_WORDS.rate_limited });
    expect(revealing.credentials.calls).toHaveLength(1);
    // A text that quotes a reporter is refused at the save, in the words every screen has for it.
    const quoting = await run({ [TEXTS]: { status: 422, body: envelope("text_quotes_user") } });
    expect(quoting.outcome).toEqual({ error: MODERATION_MESSAGES.text_quotes_user });
  });
});

describe("reading the case again", () => {
  const read: CaseView = postCase();
  const refused = (code: string) => Object.assign(new Error("the server's own words"), { code });

  test("only the first read may put the page into its failed state: a later read that fails keeps the page as it is and says why on its error line", () => {
    // The first read: there is no page to keep.
    expect(afterFailedRead({ state: "loading" }, refused("staff_recused"))).toEqual({ view: { state: "failed", message: MODERATION_MESSAGES.staff_recused }, error: null });
    expect(afterFailedRead({ state: "loading" }, refused("rate_limited"))).toEqual({ view: { state: "failed", message: CASE_WORDS.rate_limited }, error: null });
    // A read after a snapshot, a note or a reveal: the case stays on the page, the name a reveal just showed with it.
    const shown = { state: "ready" as const, value: read };
    const kept = afterFailedRead(shown, refused("staff_recused"));
    expect(kept.view).toBe(shown);
    expect(kept.error).toBe(MODERATION_MESSAGES.staff_recused);
    expect(afterFailedRead(shown, new Error("no code at all"))).toEqual({ view: shown, error: "Something went wrong. Try again." });
    // The words are the console's own, on either line.
    expect(JSON.stringify([kept, afterFailedRead({ state: "loading" }, refused("not_found"))])).not.toContain("the server's own words");
    expect(afterFailedRead({ state: "loading" }, refused("not_found")).view).toEqual({ state: "failed", message: "No case has this address." });
  });

  test("a refused case read is worded by the console, never by the server: the API's client drops the server's message, and the page shows the console's words for the code", async () => {
    const fake = fakeFetch({ [`GET /api/staff/cases/${CASE_POST}`]: { status: 403, body: envelope("staff_recused", "the server's own words") } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const err = await api.caseView(caseId(CASE_POST), { activity: true }).catch((thrown: unknown) => thrown);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "staff_recused", message: MODERATION_MESSAGES.staff_recused });
    const failed = afterFailedRead({ state: "loading" }, err);
    const out = html(<Loaded value={failed.view} render={() => null} />);
    expect(out).toBe(`<p class="error">${MODERATION_MESSAGES.staff_recused}</p>`);
    expect(out).not.toContain("the server's own words");
    // The day's limit on cases has words of its own on this page.
    const limit = fakeFetch({ [`GET /api/staff/cases/${CASE_POST}`]: { status: 429, body: envelope("rate_limited", "the server's own words") } });
    const limited = await createStaffApi({ fetch: limit.fetch, cookie: () => "" })
      .caseView(caseId(CASE_POST), { activity: true })
      .catch((thrown: unknown) => thrown);
    expect(afterFailedRead({ state: "loading" }, limited).view).toEqual({
      state: "failed",
      message: "You have opened as many different cases as one staff account may in a day. You can open others after midnight UTC; every staff account has been told.",
    });
  });
});

describe("the reveal, confirmed by the key", () => {
  const params = { reasonCategory: "impersonation_claim" as const, reasonDigest: "cd".repeat(32) };
  const action = revealAction(ITEM_REPORTER, params);

  async function revealWith(options: unknown) {
    const fake = fakeFetch({
      "GET /api/staff/me": { status: 200, body: makeMe() },
      "POST /api/staff/step-up/options": { status: 200, body: options },
      [`POST /api/staff/items/${ITEM_REPORTER}/reveal`]: { status: 200, body: { handle: "some_reporter", name: null } },
    });
    const credentials = fakeCredentials();
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
    const outcome = await revealWithKey({ api, credentials }, ITEM_REPORTER, params).catch((err: unknown) => err);
    return { outcome, credentials, requests: fake.requests };
  }

  test("the action is the item with the reason's category and digest, and nothing typed", () => {
    expect(action).toEqual({ action: "identity_revealed", target: { type: "intake_item", id: ITEM_REPORTER }, params });
    expect(() => revealAction(ITEM_REPORTER.toUpperCase(), params)).toThrow();
    expect(() => revealAction(ITEM_REPORTER, { ...params, reason: "free text" } as never)).toThrow();
  });

  test("options bound to exactly this reveal are signed, and the reveal is sent with the params and the assertion", async () => {
    const run = await revealWith(stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)));
    expect(run.outcome).toEqual({ handle: "some_reporter", name: null });
    expect(run.credentials.calls).toHaveLength(1);
    expect(run.requests.map((request) => `${request.method} ${request.url} ${request.headers["x-staff-activity"]}`)).toEqual([
      "GET /api/staff/me 1",
      "POST /api/staff/step-up/options 1",
      `POST /api/staff/items/${ITEM_REPORTER}/reveal 1`,
    ]);
    expect(run.requests[1]!.body).toEqual(action);
    expect(run.requests[2]!.body).toMatchObject({ ...params, stepUp: { type: "public-key" } });
  });

  test("options that bind another item, other params or another action are refused before the key is asked, and nothing is sent", async () => {
    const others = [
      revealAction(ITEM_NOTIFIER, params),
      revealAction(ITEM_REPORTER, { ...params, reasonCategory: "other" }),
      revealAction(ITEM_REPORTER, { ...params, reasonDigest: "ef".repeat(32) }),
      { action: "staff_session_revoked", target: { type: "staff_session", id: ITEM_REPORTER }, params: {} },
    ];
    for (const other of others) {
      const run = await revealWith(stepUpOptions(await stepUpChallenge(SESSION_HANDLE, other)));
      expect(run.outcome).toBeInstanceOf(StepUpMismatch);
      expect(run.credentials.calls).toEqual([]);
      expect(run.requests.map((request) => request.url)).toEqual(["/api/staff/me", "/api/staff/step-up/options"]);
    }
  });
});

describe("the whole page for the new addresses", () => {
  async function page(path: string, table: Parameters<typeof fakeFetch>[0] = {}) {
    const fake = fakeFetch({ "GET /api/staff/me": { status: 200, body: makeMe() }, ...table });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const store = createConsoleStore({ api, clock: new FakeClock(), path, history: { pushState: noop, replaceState: noop } });
    await store.start();
    return { store, render: () => html(<App store={store} credentials={fakeCredentials()} signal={undefined} />) };
  }

  test("the layout links to the queue, the appeals and the standing lists, and each address shows its page", async () => {
    const queue = await page("/queue");
    expect(queue.render()).toMatch(/<h2[^>]*>Queue</);
    // 3f: Contact point stands directly after Home.
    expect(hrefs(queue.render()).slice(0, 6)).toEqual(["/", "/contact", "/queue", "/appeals", "/standing", "/audit"]);
    expect(queue.render()).toMatch(/<a href="\/queue" aria-current="page"/);
    const appeals = await page("/appeals");
    expect(appeals.render()).toMatch(/<h2[^>]*>Appeals</);
    const open = await page(`/cases/${CASE_POST}`);
    // The case is read once the page is in a browser; until then the page says that it is loading.
    expect(open.render()).toContain("Loading");
    expect((await page(`/cases/${CASE_POST.toUpperCase()}`)).render()).toMatch(/no page at this address/);
    expect((await page("/cases")).render()).toMatch(/no page at this address/);
  });

  test("the store opens a case at its own address, built from a checked id", async () => {
    const pushed: string[] = [];
    const api = createStaffApi({ fetch: fakeFetch({ "GET /api/staff/me": { status: 200, body: makeMe() } }).fetch, cookie: () => "" });
    const store = createConsoleStore({ api, clock: new FakeClock(), path: "/queue", history: { pushState: (_data, _unused, url) => void pushed.push(url), replaceState: noop } });
    await store.start();
    store.openCase(caseId(CASE_FROZEN));
    expect(pushed).toEqual([`/cases/${CASE_FROZEN}`]);
    expect(store.get().route).toEqual({ name: "case", id: CASE_FROZEN });
    store.dispose();
  });
});
