import { AppealsPage, AppealsReviewedParams, CaseView, MEASURES, StaffOverview, textDigest, type AppealRow, type CaseAppeal, type CaseDecision, type StaffMe } from "@korbat/contracts";
import { REDRESS_VERSION, STATEMENT_WORDS, getRule, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "../src/App";
import { createStaffApi } from "../src/api";
import { COMPOSER, complete, confirmDecision, newDraft, previewOf, reviewChoices, reviewDraft, reviewOutcomeOf, reviewParamsOf, reviewable, shownSnapshotDigest, textsOffered, type CaseDraft } from "../src/compose";
import { APPEAL_WORDS, CONSOLE_MODERATION_CODES, MODERATION_MESSAGES, REVIEW_OUTCOMES, messageFor } from "../src/messages";
import { parseCaseId } from "../src/router";
import { AppealsView, readAppeals } from "../src/screens/Appeals";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { ComposerView, ReviewControl, type ComposerViewProps } from "../src/screens/Composer";
import { appealsLine, OverviewView } from "../src/screens/Home";
import { reviewAction } from "../src/step-up";
import { createConsoleStore } from "../src/store";
import { dateTime } from "../src/ui";
import { CASE_FROZEN, CASE_POST, decision, frozenCase, IMAGE_ONE, item, ITEM_REEXAMINATION, overview, postCase } from "./case-fixtures";
import { envelope, FakeClock, fakeCredentials, fakeFetch, hrefs, makeMe, SESSION_HANDLE, stepUpChallenge, stepUpOptions } from "./fixtures";

/**
 * Appeals in the console (3c design, sections 7.7 and 8): the home screen's line, the appeals screen, the appeal's marks
 * on the case page, and the review composer with its params, its preview and its confirmation by the key. The pure parts
 * are tested as functions, the screens server-rendered.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const noop = () => undefined;
const caseId = (id: string) => parseCaseId(id)!;
const NOW = new Date("2026-10-09T09:30:00.000Z");
const MODERATOR: StaffMe["role"] = "moderator";
const ADMIN: StaffMe["role"] = "admin";
const HEX = "cd".repeat(32);
const APPEAL_ID = "d1e2f304-1526-4738-99a4-cfd0e1f20314";
const REMOVAL_ID = "9daebfc0-d1e2-43f4-9560-8b9cadbecfd0";
const SEAL_FOR_GOOD =
  "A seal for good is lifted only on the authority's answer that the images are not child sexual abuse material. Say in the reason that the authority has answered, and the date of its answer. Never write its reference or anything that names a person: the reference stays in the operator's records, off the server.";

/** A final removal of the post and of one image, decided by someone else, under the first rulebook. */
const removal: CaseDecision = decision({
  id: REMOVAL_ID,
  kind: "final",
  rulesVersion: 1,
  category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
  staffHandle: "mod_anna",
  throughSeq: 2,
  answersFromSeq: 1,
  actions: [
    { ...decision().actions[0]!, kind: "remove" },
    { ...decision().actions[0]!, id: "c0d1e2f3-0415-4627-8893-becfd0e1f203", kind: "remove_media", mediaId: IMAGE_ONE },
  ],
});
const appeal = (more: Partial<CaseAppeal> = {}): CaseAppeal => ({
  id: APPEAL_ID,
  decisionId: REMOVAL_ID,
  filedAt: "2026-10-05T10:00:00.000Z",
  statement: "The post quotes a film.",
  answeredAt: null,
  result: null,
  answeredBy: null,
  reviewer: "available",
  needsAdmin: false,
  mayReview: true,
  ...more,
});
/** A closed case whose final removal its author appealed. */
const appealed = (more: Partial<CaseAppeal> = {}, decided: CaseDecision = removal) => postCase({ closedAt: "2026-10-01T09:00:00.000Z", answeredSeq: 2, decisions: [decided], appeals: [appeal({ decisionId: decided.id, ...more })] });

describe("the home screen's appeals line", () => {
  test("says how many wait, how many this person may review, and how many nobody may review now, then who a reviewer is", () => {
    expect(appealsLine({ appealsWaiting: 3, appealsYouMayReview: 1, appealsWithoutReviewer: 1 })).toBe("3 appeals wait; you may review 1; 1 has no possible reviewer now.");
    expect(appealsLine({ appealsWaiting: 1, appealsYouMayReview: 0, appealsWithoutReviewer: 0 })).toBe("1 appeal waits; you may review none.");
    expect(appealsLine({ appealsWaiting: 5, appealsYouMayReview: 5, appealsWithoutReviewer: 2 })).toBe("5 appeals wait; you may review 5; 2 have no possible reviewer now.");
    expect(appealsLine({ appealsWaiting: 0, appealsYouMayReview: 0, appealsWithoutReviewer: 0 })).toBe("No appeal waits.");
    const seen = overview({ appealsWaiting: 3, appealsYouMayReview: 1, appealsWithoutReviewer: 1 });
    expect(StaffOverview.safeParse(seen).success).toBe(true);
    const out = html(<OverviewView overview={seen} now={NOW.getTime()} onOpenCase={noop} />);
    expect(out).toContain("3 appeals wait; you may review 1; 1 has no possible reviewer now.");
    expect(out).toContain(esc("Appeals need a reviewer who made none of the case's decisions and opened no finding in it."));
    // With nothing waiting the rule is not repeated.
    const quiet = html(<OverviewView overview={overview({ appealsWaiting: 0, appealsYouMayReview: 0, appealsWithoutReviewer: 0 })} now={NOW.getTime()} onOpenCase={noop} />);
    expect(quiet).toContain("No appeal waits.");
    expect(quiet).not.toContain("Appeals need a reviewer");
  });
});

describe("the appeals screen", () => {
  const row = (more: Partial<AppealRow> = {}): AppealRow => ({
    id: APPEAL_ID,
    caseId: CASE_POST,
    decisionId: REMOVAL_ID,
    filedAt: "2026-10-05T10:00:00.000Z",
    decidedAt: "2026-10-01T09:00:00.000Z",
    deadline: "2027-04-01T09:00:00.000Z",
    ruleId: "R3",
    legal: false,
    actions: ["remove", "remove_media"],
    reviewer: "available",
    needsAdmin: false,
    mayReview: true,
    ...more,
  });
  const view = (rows: AppealRow[], more = false) => html(<AppealsView rows={{ state: "ready", value: rows }} more={more} loadingMore={false} onLoadMore={noop} onOpenCase={noop} />);

  test("lists the pending appeals with their case link, the decision, the end of its appeal window, and whether this person may review", () => {
    const rows = [row(), row({ id: "e2f30415-2637-4849-8ab5-d0e1f2031425", caseId: CASE_FROZEN, ruleId: null, legal: true, actions: ["seal_media"], reviewer: "none_single_staff", needsAdmin: true, mayReview: false })];
    expect(AppealsPage.safeParse({ appeals: rows, nextCursor: null }).success).toBe(true);
    const out = view(rows);
    expect(out).toMatch(/<h2[^>]*>Appeals</);
    // Each row's only link leads to its case in the console, built from a checked id.
    expect(hrefs(out)).toEqual([`/cases/${CASE_POST}`, `/cases/${CASE_FROZEN}`]);
    expect(out).toContain("under R3");
    expect(out).toContain("on the law");
    expect(out).toContain(`${MEASURES.remove.label}, ${MEASURES.remove_media.label}`);
    expect(out).toContain(MEASURES.seal_media.label);
    // Times are drawn in the browser's zone, as everywhere in the console.
    expect(out).toContain(`<time dateTime="2027-04-01T09:00:00.000Z">${dateTime("2027-04-01T09:00:00.000Z")}</time>`);
    expect(out).toContain(APPEAL_WORDS.mayReview);
    expect(out).toContain(esc(APPEAL_WORDS.mayNotReview));
    expect(out).toContain(esc(APPEAL_WORDS.needsAdmin));
    expect(out).toContain(APPEAL_WORDS.reviewer.none_single_staff);
    // The statement is read on the case page: the list says so, and holds none.
    expect(out).toContain(esc(APPEAL_WORDS.statementOnCase));
    expect(out).not.toContain("<script");
    expect(view([])).toContain("No appeal waits.");
    expect(view(rows, true)).toContain(">Load more</button>");
    expect(view(rows)).not.toContain("Load more");
  });

  test("a row whose case id is no lower-case uuid gets no link, and each reviewer state has its words", () => {
    expect(hrefs(view([row({ caseId: CASE_POST.toUpperCase() })]))).toEqual([]);
    expect(Object.keys(APPEAL_WORDS.reviewer).sort()).toEqual(["available", "none_eligible", "none_single_staff"]);
  });

  test("the screen reads the list from its start, page after page, each read its person's own", async () => {
    const fake = fakeFetch({
      "GET /api/staff/appeals": { status: 200, body: { appeals: [row()], nextCursor: "abc" } },
      "GET /api/staff/appeals?cursor=abc": { status: 200, body: { appeals: [row({ id: "e2f30415-2637-4849-8ab5-d0e1f2031425" })], nextCursor: null } },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    expect(await readAppeals(api, 1)).toEqual({ rows: [row()], next: "abc" });
    const both = await readAppeals(api, 2);
    expect(both.rows.map((found) => found.id)).toEqual([APPEAL_ID, "e2f30415-2637-4849-8ab5-d0e1f2031425"]);
    expect(both.next).toBeNull();
    expect(fake.requests.every((request) => request.headers["x-staff-activity"] === "1")).toBe(true);
    // An answer that is no page of appeals is refused, never shown.
    const broken = createStaffApi({ fetch: fakeFetch({ "GET /api/staff/appeals": { status: 200, body: { appeals: [{ ...row(), reviewer: "everyone" }], nextCursor: null } } }).fetch, cookie: () => "" });
    await expect(broken.appeals(null)).rejects.toMatchObject({ code: "invalid_answer" });
  });

  test("the address /appeals shows the screen", async () => {
    const fake = fakeFetch({ "GET /api/staff/me": { status: 200, body: makeMe() } });
    const store = createConsoleStore({ api: createStaffApi({ fetch: fake.fetch, cookie: () => "" }), clock: new FakeClock(), path: "/appeals", history: { pushState: noop, replaceState: noop } });
    await store.start();
    const out = html(<App store={store} credentials={fakeCredentials()} signal={undefined} />);
    expect(out).toMatch(/<h2[^>]*>Appeals</);
    expect(out).not.toContain("arrive later");
    store.dispose();
  });
});

describe("an appeal on the case page", () => {
  const page = (view: CaseView, role: StaffMe["role"] = MODERATOR) => {
    const draft = newDraft(caseId(view.id), view, role);
    const compose: CaseScreenViewProps["compose"] = { role, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop, onCorrect: noop, onReview: noop };
    const props: CaseScreenViewProps = { caseId: caseId(view.id), view, compose, shownImage: null, busy: null, notice: null, error: null, note: "", reveal: null, onOpenCase: noop, onShowImage: noop, onShowClearly: noop, onHideImage: noop, onImageError: noop, onSnapshot: noop, onNoteChange: noop, onNoteSave: noop, onRevealOpen: noop, onRevealChange: noop, onRevealConfirm: noop, onRevealClose: noop };
    return html(<CaseScreenView {...props} />);
  };

  test("a pending appeal shows its statement as text, who may review it, and Review this appeal for the person who may", () => {
    const view = appealed({ statement: "<script>alert(1)</script>" });
    expect(CaseView.safeParse(view).success).toBe(true);
    const out = page(view);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).not.toContain("<script>");
    expect(out).toContain("not answered yet");
    expect(out).toContain(">Review this appeal</button>");
    // Someone who took part in the case reads why there is no button, in words that name nobody.
    const mine = page(appealed({ mayReview: false }));
    expect(mine).not.toContain("Review this appeal</button>");
    expect(mine).toContain(esc(APPEAL_WORDS.mayNotReview));
    // A review that is an admin's, and an appeal nobody can review now, say so.
    const needsAdmin = page(appealed({ needsAdmin: true, mayReview: false, reviewer: "none_single_staff" }));
    expect(needsAdmin).toContain(esc(APPEAL_WORDS.needsAdmin));
    expect(needsAdmin).toContain(APPEAL_WORDS.reviewer.none_single_staff);
    expect(page(appealed({ reviewer: "none_eligible", mayReview: false }))).toContain(APPEAL_WORDS.reviewer.none_eligible);
  });

  test("an answered appeal shows its result and offers no review", () => {
    const out = page(appealed({ answeredAt: "2026-10-08T10:00:00.000Z", result: "partly_reversed", answeredBy: "e2f30415-2637-4849-8ab5-d0e1f2031425", reviewer: null, mayReview: false }));
    expect(out).toContain("answered: partly reversed");
    expect(out).not.toContain("Review this appeal");
    expect(out).not.toContain(esc(APPEAL_WORDS.mayNotReview));
  });

  test("a re-examination is marked on its item, and for whoever decided the item it re-examines", () => {
    const view = postCase({ items: [item({ id: ITEM_REEXAMINATION, seq: 3, reexaminesPosition: 2, reexaminesYourDecision: true, statement: "Look at the second image." })] });
    const out = page(view);
    expect(out).toContain("Re-examination of item 2 of its notice");
    expect(out).toContain("You decided the item this re-examines. Leave it to another staff member when there is one.");
    expect(out).toContain("Look at the second image.");
    expect(page(postCase({ items: [item({ id: ITEM_REEXAMINATION, seq: 3, reexaminesPosition: 2, reexaminesYourDecision: false })] }))).not.toContain("You decided the item this re-examines");
  });
});

describe("the review composer", () => {
  const view = appealed();
  const draftOf = (shown: CaseView = view, decided: CaseDecision = removal, role: StaffMe["role"] = MODERATOR) => reviewDraft(caseId(shown.id), shown, decided, role);
  const composer = (shown: CaseView, role: StaffMe["role"], draft: CaseDraft, extra: Partial<ComposerViewProps> = {}) => {
    const props: ComposerViewProps = { view: shown, role, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop, ...extra };
    return html(<ComposerView {...props} />);
  };
  const reasoned = (draft: CaseDraft): CaseDraft => ({ ...draft, written: { ...draft.written, review_reason: "The rule does not cover a quotation." } });

  test("a decision's pending appeal is reviewed by the person the API marked, and by nobody else", () => {
    expect(reviewable(view, removal)).toMatchObject({ appeal: { id: APPEAL_ID }, measures: [{ kind: "remove" }, { kind: "remove_media" }] });
    expect(reviewable(appealed({ mayReview: false }), removal)).toBeNull();
    expect(reviewable(appealed({ result: "kept", answeredAt: "2026-10-08T10:00:00.000Z", reviewer: null, mayReview: false }), removal)).toBeNull();
    expect(reviewable(postCase({ decisions: [removal], appeals: [] }), removal)).toBeNull();
    expect(html(<ReviewControl view={view} decision={removal} disabled={false} onReview={noop} />)).toContain(">Review this appeal</button>");
    expect(html(<ReviewControl view={appealed({ mayReview: false })} decision={removal} disabled={false} onReview={noop} />)).toBe("");
  });

  test("Keep, Reverse in part and Reverse: the outcome follows what is lifted, and each is complete only as its name says", () => {
    const draft = draftOf();
    expect(draft).toMatchObject({ kind: "review", reviewsDecisionId: REMOVAL_ID, review: "kept", actions: [], category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" });
    expect(textsOffered(draft)).toEqual(["review_reason"]);
    expect(reviewChoices(view, draft, MODERATOR).map((choice) => choice.reversal)).toEqual([
      { kind: "restore", mediaId: null },
      { kind: "restore_media", mediaId: IMAGE_ONE },
    ]);
    // Nothing is complete without its reason.
    expect(complete(view, draft)).toBe(false);
    expect(complete(view, reasoned(draft))).toBe(true);
    // Keep lifts nothing; Reverse lifts everything still in force; Reverse in part lifts something and leaves something.
    expect(complete(view, reasoned({ ...draft, actions: [{ kind: "restore", mediaId: null }] }))).toBe(false);
    const all = [{ kind: "restore" as const, mediaId: null }, { kind: "restore_media" as const, mediaId: IMAGE_ONE }];
    expect(complete(view, reasoned({ ...draft, review: "reversed", actions: all }))).toBe(true);
    expect(complete(view, reasoned({ ...draft, review: "reversed", actions: [all[0]!] }))).toBe(false);
    expect(complete(view, reasoned({ ...draft, review: "partly_reversed", actions: [all[0]!] }))).toBe(true);
    expect(complete(view, reasoned({ ...draft, review: "partly_reversed", actions: all }))).toBe(false);
    expect(complete(view, reasoned({ ...draft, review: "partly_reversed", actions: [] }))).toBe(false);
    expect(reviewOutcomeOf(view, { ...draft, review: "partly_reversed", actions: [all[0]!] })).toBe("partly_reversed");
    expect(REVIEW_OUTCOMES).toEqual({ kept: "Keep", partly_reversed: "Reverse in part", reversed: "Reverse" });
  });

  test("the composer shows the three choices, the reversals of what is still in force, the reason with the sentence on personal data, and the preview of the review's statement", () => {
    const out = composer(view, MODERATOR, reasoned({ ...draftOf(), review: "partly_reversed", actions: [{ kind: "restore", mediaId: null }] }));
    expect(out).toMatch(/<h3[^>]*>Review the appeal</);
    for (const label of ["Keep", "Reverse in part", "Reverse"]) expect(out).toContain(`<span>${label}</span>`);
    expect(out).toContain(MEASURES.restore.label);
    expect(out).toContain(MEASURES.restore_media.label);
    expect(out).toContain(`<code>${IMAGE_ONE}</code>`);
    expect(out).toContain("Reason of the review");
    expect(out).toContain(esc(COMPOSER.personalData));
    // The preview is the statement its author gets: the review's lead, the reviewed decision's rule in its own version, the reason.
    const preview = statementParagraphs(previewOf(view, reasoned({ ...draftOf(), review: "partly_reversed", actions: [{ kind: "restore", mediaId: null }] }), NOW));
    expect(preview[0]).toBe(STATEMENT_WORDS.reviewed("2026-10-01 09:00 UTC", "partly_reversed"));
    expect(preview).toContain(`That decision rested on korbat rule R1, "${getRule("R1", 1)!.title}": ${getRule("R1", 1)!.text}`);
    expect(preview).toContain("Why korbat changed it: The rule does not cover a quotation.");
    for (const paragraph of preview) expect(out, paragraph).toContain(esc(paragraph));
    expect(out).toContain(">Confirm with your staff key</button>");
    // A kept review tells its author so, and lists no reversal as chosen.
    const kept = statementParagraphs(previewOf(view, reasoned(draftOf()), NOW));
    expect(kept[0]).toBe(STATEMENT_WORDS.reviewed("2026-10-01 09:00 UTC", "kept"));
    expect(kept).toContain("Why korbat kept it: The rule does not cover a quotation.");
    // The appeal that was open when the composer opened is answered meanwhile: nothing is left to review.
    const gone = composer(appealed({ result: "kept", answeredAt: "2026-10-08T10:00:00.000Z", reviewer: null, mayReview: false }), MODERATOR, reasoned(draftOf()));
    expect(gone).toContain("This appeal is answered, or is not yours to review.");
    expect(gone).not.toContain("Confirm with your staff key");
  });

  test("Lift the seal stands in an admin's review alone, with the sentence on when a seal for good is lifted; a moderator is offered no review of such a decision", () => {
    const sealAction = frozenCase().decisions[0]!.actions[0]!;
    const sealed: CaseDecision = decision({ id: REMOVAL_ID, kind: "final", ruleId: "R2", category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", suspect: true, needsAdmin: true, throughSeq: 2, answersFromSeq: 1, staffHandle: "admin_ben", actions: [sealAction] });
    const forAdmin = appealed({ needsAdmin: true }, sealed);
    expect(reviewChoices(forAdmin, draftOf(forAdmin, sealed, ADMIN), ADMIN).map((choice) => choice.reversal.kind)).toEqual(["unseal_media"]);
    const out = composer(forAdmin, ADMIN, reasoned({ ...draftOf(forAdmin, sealed, ADMIN), review: "reversed", actions: [{ kind: "unseal_media", mediaId: null }] }));
    expect(out).toContain(MEASURES.unseal_media.label);
    expect(out).toContain(esc(SEAL_FOR_GOOD));
    // The API marks such an appeal as not a moderator's to review: no control, and a composer opened all the same shows nothing to confirm.
    const forModerator = appealed({ needsAdmin: true, mayReview: false }, sealed);
    expect(reviewable(forModerator, sealed)).toBeNull();
    expect(composer(forModerator, MODERATOR, reasoned(draftOf(forModerator, sealed, MODERATOR)))).not.toContain("Confirm with your staff key");
    expect(reviewChoices(forAdmin, draftOf(forAdmin, sealed, MODERATOR), MODERATOR)).toEqual([]);
  });

  test("the review's params: the appeal, the reviewed decision's category and rules version, the reversals in their one order, and the outcome as chosen", () => {
    const draft = reasoned({ ...draftOf(), review: "reversed", actions: [{ kind: "restore_media", mediaId: IMAGE_ONE }, { kind: "restore", mediaId: null }] });
    const params = reviewParamsOf(view, draft, { snapshot: HEX, reason: "bb".repeat(32) });
    expect(params).toEqual({
      stateVersion: view.stateVersion,
      appealId: APPEAL_ID,
      snapshotId: view.snapshots[0]!.id,
      snapshotDigest: HEX,
      outcome: "reversed",
      rulesVersion: 1,
      redressVersion: REDRESS_VERSION,
      category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
      actions: [
        { kind: "restore", mediaId: null },
        { kind: "restore_media", mediaId: IMAGE_ONE },
      ],
      reasonDigest: "bb".repeat(32),
    });
    expect(AppealsReviewedParams.safeParse(params).success).toBe(true);
    expect(reviewAction(REMOVAL_ID, params)).toEqual({ action: "appeals_reviewed", target: { type: "decision", id: REMOVAL_ID }, params });
    expect(reviewParamsOf(view, reasoned(draftOf()), { snapshot: HEX, reason: "bb".repeat(32) })).toMatchObject({ outcome: "kept", actions: [] });
    // Without a pending appeal there is nothing to build.
    expect(() => reviewParamsOf(postCase({ decisions: [removal], appeals: [] }), draft, { snapshot: HEX, reason: "bb".repeat(32) })).toThrow();
  });

  describe("confirmed by the key", () => {
    const draft = reasoned({ ...draftOf(), review: "partly_reversed", actions: [{ kind: "restore", mediaId: null }] });
    const after = postCase({ closedAt: "2026-10-01T09:00:00.000Z", stateVersion: 4, decisions: [removal], appeals: [appeal({ result: "partly_reversed", answeredAt: "2026-10-09T09:30:00.000Z", answeredBy: "e2f30415-2637-4849-8ab5-d0e1f2031425", reviewer: null, mayReview: false })] });

    async function run(options: { review?: { status: number; body: unknown }; bind?: (action: ReturnType<typeof reviewAction>) => object } = {}) {
      const saves: { kind: string; text: string; salt: string; digest: string }[] = [];
      let action: ReturnType<typeof reviewAction> | null = null;
      const fake = fakeFetch({
        "GET /api/staff/me": { status: 200, body: makeMe() },
        [`POST /api/staff/decisions/${REMOVAL_ID}/review`]: options.review ?? { status: 201, body: after },
      });
      const fetch: typeof fake.fetch = async (input, init) => {
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
        if (input === `/api/staff/cases/${CASE_POST}/texts` && init?.method === "POST") {
          await fake.fetch(input, init);
          saves.push(body as (typeof saves)[number]);
          return new Response(JSON.stringify({ id: "bfc0d1e2-f304-4516-b782-adbecfd0e1f2", digest: body!.digest }), { status: 201, headers: { "content-type": "application/json" } });
        }
        if (input === "/api/staff/step-up/options") {
          await fake.fetch(input, init);
          action = body as ReturnType<typeof reviewAction>;
          return new Response(JSON.stringify(stepUpOptions(await stepUpChallenge(SESSION_HANDLE, (options.bind ? options.bind(action) : action) as never))), { status: 200, headers: { "content-type": "application/json" } });
        }
        return fake.fetch(input, init);
      };
      const credentials = fakeCredentials();
      const api = createStaffApi({ fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
      const outcome = await confirmDecision({ api, credentials, random: (length) => new Uint8Array(length).fill(7) }, caseId(CASE_POST), view, draft);
      return { outcome, credentials, requests: fake.requests, saves, action: action as ReturnType<typeof reviewAction> | null };
    }

    test("the reason is saved as a review reason, the key confirms the review of exactly that decision, and the answer is the case as it now stands", async () => {
      const done = await run();
      expect(done.outcome).toEqual({ view: after });
      expect(done.credentials.calls).toHaveLength(1);
      expect(done.saves.map((save) => save.kind)).toEqual(["review_reason"]);
      const shown = view.snapshots[0]!;
      if (shown.withheld) throw new Error("the fixture's newest snapshot shows its content");
      const reason = await textDigest("07".repeat(32), "The rule does not cover a quotation.");
      expect(done.action).toEqual({ action: "appeals_reviewed", target: { type: "decision", id: REMOVAL_ID }, params: reviewParamsOf(view, draft, { snapshot: await shownSnapshotDigest(shown), reason }) });
      const sent = done.requests.at(-1)!;
      expect(`${sent.method} ${sent.url} ${sent.headers["x-staff-activity"]}`).toBe(`POST /api/staff/decisions/${REMOVAL_ID}/review 1`);
      expect(sent.body).toMatchObject({ ...done.action!.params, stepUp: { type: "public-key" } });
    });

    test("options that bind another decision or another outcome are refused before the key is asked, and no review is sent", async () => {
      for (const bind of [(action: ReturnType<typeof reviewAction>) => ({ ...action, target: { ...action.target, id: CASE_FROZEN } }), (action: ReturnType<typeof reviewAction>) => ({ ...action, params: { ...action.params, outcome: "kept" } })]) {
        const done = await run({ bind });
        expect(done.outcome).toMatchObject({ code: "step_up_mismatch" });
        expect(done.credentials.calls).toHaveLength(0);
        expect(done.requests.some((request) => request.url.endsWith("/review"))).toBe(false);
      }
    });

    test("an answer that carries another case is no answer, and each refusal is worded by the console, never by the server", async () => {
      expect((await run({ review: { status: 201, body: frozenCase() } })).outcome).toMatchObject({ code: "invalid_answer" });
      for (const code of ["reviewer_conflict", "admin_required", "case_changed", "snapshot_erased", "staff_recused"] as const) {
        const done = await run({ review: { status: code === "case_changed" || code === "snapshot_erased" ? 409 : 403, body: envelope(code) } });
        expect(done.outcome, code).toEqual({ error: MODERATION_MESSAGES[code], code });
      }
      // The review composer words an erased snapshot as the decision composer does: the one table words both.
      expect(messageFor("snapshot_erased")).toBe(MODERATION_MESSAGES.snapshot_erased);
      expect(CONSOLE_MODERATION_CODES).toContain("reviewer_conflict");
      expect(MODERATION_MESSAGES.reviewer_conflict).toBe("You cannot review this appeal: you made a decision in its case, or opened a finding in it. Another staff member must review it.");
    });
  });
});
