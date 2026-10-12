# korbat moderation cases (3c) — Task 5 of 12: The console's queue, case, evidence and reveals: the staff routes for the overview, the queue, a case with its suspicion, images behind gate V, snapshots, findings, texts and the reveal of a source, the access log and the daily limits; and in the console the router, the home, queue and case screens without the composer, the banners, the reveal dialog and their browser check

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-03 to 2026-10-12 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 to 4 laid the ground, built the decision engine, the media module's interface for cases and the routes for reports and notices. This task gives staff their view: the routes for the overview, the queue, a case with its evidence, findings, texts and the reveal of a source, and in the console the home, queue and case screens without the decision composer. The design is `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` (sections 7.3, 7.4, 8, 10 and 12).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,infra): reports and notices: POST /api/notices takes a report on a rule or a notice of illegality from anyone, signed in or not (a human check and limits by network when signed out), about up to ten posts or profiles of this korbat; a target is live by one rule, and on the path for child sexual abuse material by its row alone, an account also under a handle it has left; such a notice names at most one account, counted by the handles as named; a link that names nothing is stored as an item with no case; the status page (POST /api/notices/status) answers by reference and token with each item's link as it was named, never a later handle, and /api/notices/contact confirms or stops the notifier's mail; a signed-out notifier's name and address are kept encrypted in the auth schema under NOTIFIER_ENC_KEY and never shown to staff; the receipt notice_received and the urgent alert moderation_urgent are sent after the commit; the mailer tells a refused recipient from an unavailable relay and bounds each send in time; the auth janitor purges forgotten contacts and expired confirmations, each purge in a try of its own; MODERATION_DISPATCH_HOUR and MODERATION_DEFER_UNPROVEN join the configuration`.

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
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/05-console-queue-case.md 1
```

Expected: 20 lines starting with `wrote`, one for each file below.

### Create `apps/admin/test/case-fixtures.ts`

```ts
import type { CaseDecision, CaseItem, CaseSnapshot, CaseView, QueueRow, SourceSummary, StaffOverview } from "@korbat/contracts";
import { HOSTILE } from "./fixtures";

// Built from its char code: a right-to-left override, here where an address's host ends.
const RLO = String.fromCharCode(0x202e);

/**
 * Cases as the staff API answers them, for the console's tests and its browser check (3c design, section 8). Every string
 * someone could have written is hostile: markup, a javascript: address, a direction override, a text made to look like
 * one of the console's own lines, a look-alike address, and the longest texts allowed. The ids are fixed lower-case
 * uuids, so a test can name the address the console must build from each.
 */

export const CASE_POST = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
export const CASE_FROZEN = "4a2d3c2f-9e5b-4d2f-8c3b-7a1f6e5d4c3b";
export const CASE_ACCOUNT = "5b3e4d30-af6c-4e30-9d4c-8b2a7f6e5d4c";
export const CASE_QUOTED = "6c4f5e41-b07d-4f41-ae5d-9c3b8a7f6e5d";
export const POST_ID = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";
export const ACCOUNT_ID = "8f3e0b21-7d4c-4a6f-9b32-1e5d8c0f2a47";
export const IMAGE_ONE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const IMAGE_TWO = "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
export const ITEM_REPORTER = "2c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f";
export const ITEM_NOTIFIER = "3d4e5f6a-7b8c-4d9e-bf0a-2b3c4d5e6f7a";
export const ITEM_SUSPECT = "4e5f6a7b-8c9d-4eaf-801b-3c4d5e6f7a8b";
export const ITEM_FINDING = "5f6a7b8c-9dae-4fb0-912c-4d5e6f7a8b9c";
export const ITEM_REEXAMINATION = "6a7b8c9d-aebf-40c1-a23d-5e6f7a8b9cad";
const DECISION_ONE = "7b8c9dae-bfc0-41d2-b34e-6f7a8b9cadbe";
const SNAPSHOT_ONE = "8c9daebf-c0d1-42e3-845f-7a8b9cadbecf";
const SNAPSHOT_TWO = "9daebfc0-d1e2-43f4-9560-8b9cadbecfd0";
const HEX = "ab".repeat(32);

/**
 * A text made to look like one of the console's own lines, an address made to look like korbat's, and an address whose
 * host no browser can read: a direction override stands where the host ends.
 */
export const LOOKALIKE = {
  label: "korbat: verified notice from police",
  address: "https://korbat.example.evil.test/post/1 and http://user:pw@login.korbat.test@evil.test/reset",
  unreadable: `https://korbat.example${RLO}/tsop`,
};

/** The longest explanation a notice may carry: 2000 characters. */
export const LONGEST_EXPLANATION = "E".repeat(2000);
/** The longest text staff may save: 5000 characters. */
export const LONGEST_NOTE = "N".repeat(5000);

const NO_BANDS = { accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null } as const;
const NO_CONTACT = { named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false } as const;

export const SOURCES = {
  reporter: { kind: "reporter", label: "Reporter A", accountAge: "1_to_12_months", itemsFiled: "2_to_9", actedOn: "under_half", answeredUnseen: "1", ...NO_CONTACT },
  notifier: { kind: "notifier", label: "A notifier", ...NO_BANDS, named: true, contactGiven: true, confirmed: false, suppressed: false, contactLost: false },
  unnamed: { kind: "notifier", label: "A notifier", ...NO_BANDS, named: false, contactGiven: true, confirmed: true, suppressed: true, contactLost: false },
  lost: { kind: "notifier", label: "A notifier", ...NO_BANDS, named: false, contactGiven: false, confirmed: false, suppressed: false, contactLost: true },
  anonymous: { kind: "anonymous", label: "Anonymous", ...NO_BANDS, ...NO_CONTACT },
  staff: { kind: "staff", label: "Found by a moderator", ...NO_BANDS, ...NO_CONTACT },
  unlinked: { kind: "unlinked", label: "A signed-in reporter no longer linked", ...NO_BANDS, ...NO_CONTACT },
} as const satisfies Record<string, SourceSummary>;

export function item(overrides: Partial<CaseItem> = {}): CaseItem {
  return {
    id: ITEM_REPORTER,
    seq: 1,
    position: 1,
    createdAt: "2026-10-01T08:00:00.000Z",
    lane: 2,
    link: `http://localhost:8081/post/${POST_ID}`,
    ruleId: "R1",
    allegesIllegal: false,
    csam: false,
    category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
    categoryKeyword: null,
    citedLaw: null,
    explanation: HOSTILE.script,
    mediaId: null,
    suspect: false,
    quotedByPosition: null,
    quotedCaseId: null,
    reexaminesPosition: null,
    reexaminesYourDecision: false,
    statement: null,
    outcome: null,
    answeredBy: null,
    erased: false,
    source: SOURCES.reporter,
    ...overrides,
  };
}

export function postSnapshot(overrides: Partial<Extract<CaseSnapshot, { withheld: false }>> = {}): CaseSnapshot {
  return {
    id: SNAPSHOT_ONE,
    takenAt: "2026-10-01T08:00:00.000Z",
    digest: HEX,
    withheld: false,
    salt: HEX,
    targetType: "post",
    targetId: POST_ID,
    authorHandle: HOSTILE.bidi,
    postState: "visible",
    postCreatedAt: "2026-09-30T12:00:00.000Z",
    replyToId: null,
    quoteOfId: null,
    body: `${HOSTILE.img} ${LOOKALIKE.address} ${LOOKALIKE.unreadable}`,
    media: [
      { id: IMAGE_ONE, alt: HOSTILE.quote, width: 2048, height: 1536 },
      { id: IMAGE_TWO, alt: LOOKALIKE.label, width: 800, height: 600 },
    ],
    displayName: null,
    bio: null,
    handle: null,
    ...overrides,
  };
}

export function decision(overrides: Partial<CaseDecision> = {}): CaseDecision {
  return {
    id: DECISION_ONE,
    kind: "interim",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R1",
    rulesVersion: 2,
    redressVersion: 1,
    category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
    categoryKeyword: null,
    source: "report",
    decidedAt: "2026-10-01T09:00:00.000Z",
    staffHandle: HOSTILE.url,
    throughSeq: 0,
    answersFromSeq: null,
    reviewsDecisionId: null,
    snapshotId: SNAPSHOT_ONE,
    suspect: false,
    unseen: false,
    needsAdmin: false,
    endedInterim: false,
    facts: "The post offers followers for money.",
    reason: HOSTILE.long,
    legalReference: null,
    actions: [{ id: "aebfc0d1-e2f3-4405-a671-9cadbecfd0e1", kind: "withhold", mediaId: null, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, sealed: null }],
    ...overrides,
  };
}

/** A post's case in lane 2 with two images that may be opened, a reporter's item and a named notifier's, a decision and notes. */
export function postCase(overrides: Partial<CaseView> = {}): CaseView {
  return {
    id: CASE_POST,
    lane: 2,
    stateVersion: 3,
    intakeSeq: 2,
    answeredSeq: 0,
    openedAt: "2026-10-01T08:00:00.000Z",
    closedAt: null,
    target: { type: "post", id: POST_ID, link: `http://localhost:8081/post/${POST_ID}`, authorHandle: HOSTILE.bidi, state: "visible", level: "visible" },
    suspicion: null,
    imagesAllowed: true,
    snapshots: [postSnapshot()],
    items: [
      item(),
      item({ id: ITEM_NOTIFIER, seq: 2, allegesIllegal: true, ruleId: null, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD", citedLaw: LOOKALIKE.label, explanation: LONGEST_EXPLANATION, source: SOURCES.notifier, lane: 2 }),
    ],
    decisions: [decision()],
    appeals: [],
    drafts: [],
    notes: [{ id: "bfc0d1e2-f304-4516-b782-adbecfd0e1f2", staffHandle: HOSTILE.quote, createdAt: "2026-10-01T08:30:00.000Z", text: LONGEST_NOTE }],
    sealsDeclined: [],
    history: [
      { at: "2026-10-01T08:00:00.000Z", event: "item", refId: ITEM_REPORTER, seq: 1, intakeKind: "user", ruleId: "R1", allegesIllegal: false, csam: false, reexamination: false, decisionKind: null, outcome: null, staffHandle: null, result: null },
      { at: "2026-10-01T08:00:00.000Z", event: "snapshot", refId: SNAPSHOT_ONE, seq: null, intakeKind: null, ruleId: null, allegesIllegal: null, csam: null, reexamination: null, decisionKind: null, outcome: null, staffHandle: null, result: null },
      { at: "2026-10-01T09:00:00.000Z", event: "decision", refId: DECISION_ONE, seq: null, intakeKind: null, ruleId: null, allegesIllegal: null, csam: null, reexamination: null, decisionKind: "interim", outcome: "restricted", staffHandle: HOSTILE.url, result: null },
    ],
    ...overrides,
  };
}

/**
 * A post's case in the urgent lane that holds an unanswered suspect item: its images cannot be opened, its post quotes
 * another whose case is linked, an admin answered an earlier report without a seal, and a seal taken while deciding
 * stands with its list.
 */
export function frozenCase(overrides: Partial<CaseView> = {}): CaseView {
  return postCase({
    id: CASE_FROZEN,
    lane: 0,
    imagesAllowed: false,
    suspicion: {
      open: true,
      reach: { posts: 1, images: 2, sealed: 2, served: 0, newestPostOn: "2026-09-30" },
      earlier: { target: { count: 1, lastOn: "2026-08-14", imagesOpenedOn: "2026-08-15" }, author: { count: 2, lastOn: "2026-08-14" } },
    },
    items: [
      item({ id: ITEM_SUSPECT, csam: true, suspect: true, allegesIllegal: true, ruleId: null, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", lane: 0, explanation: HOSTILE.bidi, quotedCaseId: CASE_QUOTED, source: SOURCES.anonymous }),
      item({ id: ITEM_FINDING, seq: 2, ruleId: "R5", lane: 0, explanation: null, source: SOURCES.staff }),
      item({ id: ITEM_REEXAMINATION, seq: 3, ruleId: "R3", lane: 1, reexaminesPosition: 1, reexaminesYourDecision: true, statement: HOSTILE.img, source: SOURCES.unlinked }),
    ],
    decisions: [
      decision({
        ruleId: "R2",
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        suspect: true,
        actions: [
          {
            id: "c0d1e2f3-0415-4627-8893-becfd0e1f203",
            kind: "seal_media",
            mediaId: null,
            noEffect: "already",
            inForce: true,
            reversesActionId: null,
            liftedBy: null,
            sealed: { posts: 501, images: 730, deletedPosts: 3, list: [{ postId: POST_ID, createdAt: "2026-09-30T12:00:00.000Z", images: 2 }] },
          },
        ],
      }),
    ],
    sealsDeclined: [{ id: "d1e2f304-1526-4738-99a4-cfd0e1f20314", staffHandle: HOSTILE.script, createdAt: "2026-10-01T08:45:00.000Z", text: "The report repeats the one answered on 14 August." }],
    ...overrides,
  });
}

/** An account's case that holds an unanswered suspect item and reaches no image: an account case never shows one. */
export function accountCase(overrides: Partial<CaseView> = {}): CaseView {
  return postCase({
    id: CASE_ACCOUNT,
    lane: 0,
    imagesAllowed: false,
    target: { type: "account", id: ACCOUNT_ID, handle: HOSTILE.script, displayName: LOOKALIKE.label, bio: `${HOSTILE.url} ${LOOKALIKE.address}`, deleted: false },
    suspicion: { open: true, reach: { posts: 0, images: 0, sealed: 0, served: 0, newestPostOn: null }, earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } } },
    snapshots: [
      {
        id: SNAPSHOT_TWO,
        takenAt: "2026-10-01T08:00:00.000Z",
        digest: HEX,
        withheld: false,
        salt: HEX,
        targetType: "account",
        targetId: ACCOUNT_ID,
        authorHandle: HOSTILE.script,
        postState: null,
        postCreatedAt: null,
        replyToId: null,
        quoteOfId: null,
        body: null,
        media: null,
        displayName: "An earlier name",
        bio: HOSTILE.quote,
        handle: HOSTILE.script,
      },
    ],
    items: [item({ id: ITEM_SUSPECT, csam: true, suspect: true, allegesIllegal: true, ruleId: null, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", lane: 0, link: "http://localhost:8081/u/named_once", explanation: null, source: SOURCES.anonymous })],
    decisions: [],
    notes: [],
    ...overrides,
  });
}

export function queueRow(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    id: CASE_POST,
    lane: 2,
    targetType: "post",
    openedAt: "2026-10-01T08:00:00.000Z",
    oldestOpenAt: "2026-10-01T08:00:00.000Z",
    openItems: 2,
    rules: ["R1"],
    categories: ["STATEMENT_CATEGORY_OTHER_VIOLATION_TC", "STATEMENT_CATEGORY_SCAMS_AND_FRAUD"],
    allegesIllegal: true,
    suspect: false,
    reexamination: false,
    deferred: false,
    ...overrides,
  };
}

/** The queue: an urgent suspect case, an account's, and the post's in lane 2. */
export const QUEUE_ROWS: QueueRow[] = [
  queueRow({ id: CASE_FROZEN, lane: 0, oldestOpenAt: "2026-10-01T09:46:00.000Z", openItems: 3, rules: ["R3", "R5"], categories: ["STATEMENT_CATEGORY_PROTECTION_OF_MINORS"], suspect: true, reexamination: true }),
  queueRow({ id: CASE_ACCOUNT, lane: 0, targetType: "account", oldestOpenAt: "2026-10-01T09:50:00.000Z", openItems: 1, rules: [], categories: ["STATEMENT_CATEGORY_PROTECTION_OF_MINORS"], suspect: true }),
  queueRow({ deferred: true }),
];

export function overview(overrides: Partial<StaffOverview> = {}): StaffOverview {
  return {
    lanes: [
      { lane: 0, open: 2, oldestAt: "2026-10-01T09:46:00.000Z" },
      { lane: 1, open: 0, oldestAt: null },
      { lane: 2, open: 1, oldestAt: "2026-09-28T10:00:00.000Z" },
    ],
    appealsWaiting: 3,
    reveals: { total: 1, items: [{ at: "2026-09-30T10:00:00.000Z", handle: HOSTILE.script, caseId: CASE_POST }] },
    imagesToday: [{ handle: HOSTILE.img, count: 4 }],
    findingsToday: [{ handle: HOSTILE.bidi, count: 1 }],
    mailsWaiting: { receipts: 0, authorMails: 0, outcomes: 0 },
    mailsFailed: { receipts: 0, authorMails: 0, outcomes: 0 },
    releaseOverdue: 0,
    deferUnproven: false,
    ...overrides,
  };
}
```

### Create `apps/admin/test/cases.test.tsx`

```tsx
import { CaseView, FINDING_CATEGORIES, ModerationErrorCode, QueuePage, SOURCE_LABELS, StaffOverview, textDigest } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "../src/App";
import { ApiError, createStaffApi } from "../src/api";
import { FrameView } from "../src/frames";
import { hasHidden, mentionedAddresses, mentionedHosts, showHidden } from "../src/hidden";
import { parseImageId, StaffImage, staffImageSrc } from "../src/media";
import { CASE_WORDS, CONSOLE_MODERATION_CODES, DECISION_KINDS, DECISION_OUTCOMES, describeError, FINDING_WORDS, messageFor, MODERATION_MESSAGES, NOTE_WORDS, OUTCOME_WORDS, REVEAL_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { afterFailedRead, ART_18_BANNER, CaseScreenView, IMAGES_NOT_SHOWN, RevealDialog, revealSource, SUSPECT_BANNER, targetDiffers, type CaseScreenViewProps } from "../src/screens/Case";
import { OverviewView, RELEASE_OVERDUE_RUNBOOK, releaseOverdue } from "../src/screens/Home";
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
    const appOnly = ["human_check_failed", "staff_cannot_report", "notice_not_found", "already_reported"];
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
    const first: QueuePage = { cases: QUEUE_ROWS.slice(0, 2), nextCursor: "page_2-cursor" };
    const second: QueuePage = { cases: QUEUE_ROWS.slice(2), nextCursor: null };
    const fake = fakeFetch({ "GET /api/staff/queue": { status: 200, body: first }, "GET /api/staff/queue?cursor=page_2-cursor": { status: 200, body: second } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    expect(await readQueue(api, 1, true)).toEqual({ rows: first.cases, next: "page_2-cursor" });
    expect(await readQueue(api, 2, false)).toEqual({ rows: QUEUE_ROWS, next: null });
    expect(fake.requests.map((request) => `${request.url} ${request.headers["x-staff-activity"] ?? "unmarked"}`)).toEqual([
      "/api/staff/queue 1",
      "/api/staff/queue unmarked",
      "/api/staff/queue?cursor=page_2-cursor unmarked",
    ]);
  });

  test("the screen reads the queue when it opens, marked, and again every 60 seconds, unmarked, until it is left", async () => {
    const page: QueuePage = { cases: QUEUE_ROWS, nextCursor: null };
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
    expect(out).toContain("3 appeals wait.");
    expect(out).toContain("The emergency switch is off.");
    expect(out).toContain(`<bdi>${HOSTILE_ESCAPED.script}</bdi>`);
    expect(hrefs(out)).toEqual([`/cases/${CASE_POST}`]);
    expect(out).toContain(`<bdi>${HOSTILE_ESCAPED.img}</bdi>: 4 images viewed`);
    expect(out).toContain(": 1 finding opened");
    expect(out).not.toContain("Mails waiting");
    expect(out).not.toContain("not released");
    expectInert(out);
  });

  test("what waits too long is said only when it does: mails, the release, more reveals than the list holds, and the switch", () => {
    const busy = overview({
      appealsWaiting: 1,
      mailsWaiting: { receipts: 1, authorMails: 0, outcomes: 2 },
      mailsFailed: { receipts: 0, authorMails: 3, outcomes: 0 },
      releaseOverdue: 4,
      deferUnproven: true,
      reveals: { total: 140, items: Array.from({ length: 100 }, () => ({ at: "2026-09-30T10:00:00.000Z", handle: "mod_anna", caseId: CASE_POST })) },
    });
    const out = html(<OverviewView overview={busy} now={NOW} onOpenCase={noop} />);
    expect(out).toContain("1 appeal waits.");
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
    const action = (id: string, kind: CaseView["decisions"][number]["actions"][number]["kind"], more: Partial<CaseView["decisions"][number]["actions"][number]> = {}) => ({ id, kind, mediaId: null, noEffect: null, inForce: false, reversesActionId: null, liftedBy: null, sealed: null, ...more });
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
    expect(answer).toEqual({ id: saved.id, digest, text: "Art. 18 check: no suspicion" });
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

  test("the layout links to the queue and the appeals, and each address shows its page", async () => {
    const queue = await page("/queue");
    expect(queue.render()).toMatch(/<h2[^>]*>Queue</);
    expect(hrefs(queue.render()).slice(0, 4)).toEqual(["/", "/queue", "/appeals", "/audit"]);
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
```

### Create `apps/api/test/integration/http-staff-cases.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  CaseView,
  ErrorEnvelope,
  FindingResponse,
  QueuePage,
  RevealResponse,
  StaffOverview,
  StaffSnapshotTaken,
  StaffStepUpOptionsResponse,
  StaffTextSaved,
  StaffTextsResponse,
  snapshotDigest,
  textDigest,
  type AuthenticationResponseJSON,
  type IdentityRevealedParams,
} from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { mediaForCases } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration, type ModerationForStaff } from "../../src/moderation";
import { recordIntake } from "../../src/moderation/intake";
import { TEXT_SAVES_PER_MINUTE } from "../../src/moderation/texts";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { webpBytes } from "../media/webp-bytes";
import { newUserWithDevice } from "./auth-fixtures";
import { Browser } from "./http-client";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { MINORS, TC, aPost, ground, hex64, removeFixtures, rowCounts } from "./moderation-fixtures";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

// Each test signs staff keys in over HTTP and sends dozens of requests: on a loaded machine that takes longer than the
// five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/**
 * The console's case routes through the real app (3c design, sections 7.3 and 7.4): the overview, the queue, the case,
 * its images, snapshots and texts, a moderator's own finding, and the reveal of a source confirmed by a real staff key.
 * Everything here commits, as the server does: the tests' profiles, posts and cases are removed again, the audit rows of
 * the confirmed reveals stay (audit-verify accepts them), and the file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the console's case routes over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let mailer: MemoryMailer;
  let h: MediaHarness;
  let app: ReturnType<typeof createApp>;
  let deps: ReturnType<typeof createModeration>["deps"];
  let settle: () => Promise<void>;
  let moderator: Awaited<ReturnType<typeof staffBrowser>>;
  let admin: Awaited<ReturnType<typeof staffBrowser>>;
  let before: Record<string, number>;
  /** Every profile the tests made, staff included: removed, with what hangs on them, after the last test. */
  const profileIds: string[] = [];
  /** What a test runs inside the request, once the step-up verified and before the reveal's transaction begins. */
  let insideRequest: (() => Promise<unknown>) | null = null;
  /** How far the auth module's clock stands from the real one, in milliseconds; 0 but where a test sets it back. */
  let skewMs = 0;
  /** How often the image route handed a request to the moderation module. */
  let imageCalls = 0;
  /** How often a staff route's session guard ran: it is what reads a staff session, and what a marked request slides. */
  let sessionReads = 0;
  /** The limit store the app and the moderation module count in: the global limit, the saved texts' minute and the alerts' throttles. */
  let rateLimitStore: MemoryStore;

  async function counts(): Promise<Record<string, number>> {
    const [authSide] = await migrateDb.execute<Record<string, number>>(
      sql`select (select count(*)::int from auth.notifier_contacts) as notifier_contacts, (select count(*)::int from auth.notifier_confirmations) as notifier_confirmations,
                 (select count(*)::int from auth.notifier_suppressions) as notifier_suppressions, (select count(*)::int from auth.staff_personal_accounts) as staff_personal_accounts`,
    );
    return { ...(await rowCounts(apiDb)), ...authSide! };
  }

  beforeAll(async () => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await counts();
    repo = createAuthRepo(authDb);
    mailer = new MemoryMailer();
    // The real clock, unless a test sets it back: a reveal's audit row is stamped by the database and held against the
    // challenge's expiry, which the auth module's clock sets.
    const clock = () => Date.now() + skewMs;
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock), mailer, profiles: createProfileStore(apiDb), now: () => new Date(clock()) });
    // The media module over a store of this file's own, so the image route opens real files.
    h = await mediaHarness(apiDb);
    rateLimitStore = new MemoryStore();
    const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: mediaForCases(h.deps), rateLimitStore, config, logger });
    deps = moderation.deps;
    settle = moderation.settle;
    // The staff routes get the moderation module through a wrapper that counts the image route's calls and lets a test
    // act inside the request, between the step-up's verification and the reveal's own transaction.
    const observed: ModerationForStaff = {
      ...moderation.forStaff,
      caseImage: (...args) => {
        imageCalls++;
        return moderation.forStaff.caseImage(...args);
      },
      reveal: async (...args) => {
        const run = insideRequest;
        insideRequest = null;
        await run?.();
        return moderation.forStaff.reveal(...args);
      },
    };
    // The session guard is the auth module's own, counted: a test can then tell a request that reached it from one
    // answered before it.
    const requireStaff: typeof auth.forStaff.requireStaff = async (c, next) => {
      sessionReads++;
      return auth.forStaff.requireStaff(c, next);
    };
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, staff: createStaff({ apiDb, auth: { ...auth.forStaff, requireStaff }, moderation: observed }), moderation });
    moderator = await staffBrowser("moderator");
    admin = await staffBrowser("admin");
  }, 120_000);
  afterAll(async () => {
    await settle();
    await removeFixtures(migrateDb, profileIds);
    h.cleanup();
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const answered = async (res: Response): Promise<[number, string]> => [res.status, (await error(res)).code];
  /**
   * An answer held to its contract: what the contract's schema reads from the raw JSON is all the JSON holds. The routes
   * send the module's objects as they are, and the schemas drop every member they do not name, so an answer that carries
   * one member more than its contract fails here.
   */
  function held<T>(schema: { parse(raw: unknown): T }, raw: unknown): T {
    const read = schema.parse(raw);
    expect(raw).toStrictEqual(read);
    return read;
  }
  const answer = async <T>(schema: { parse(raw: unknown): T }, res: Response): Promise<T> => held(schema, await res.json());
  /** The seconds a refusal at a limit tells the console to wait. */
  const retryAfter = (res: Response) => Number(res.headers.get("retry-after"));
  const appOrigin = () => new URL(config.APP_ORIGIN).origin;

  /** A live staff account with a profile and one key enrolled through the flow, signed in from the console's browser. */
  async function staffBrowser(role: "moderator" | "admin") {
    const { user } = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    profileIds.push(user.id);
    const soft = new SoftAuthenticator();
    const link = await issueEnrolment(migrateDb, user.id);
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    const assert = (challenge: string) => soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: ++counter });
    const b = consoleBrowser();
    const options = await b.fetch("/api/staff/signin/options", { method: "POST" });
    expect(options.status, await options.clone().text()).toBe(200);
    const { challenge } = ((await options.json()) as { options: { challenge: string } }).options;
    const signedIn = await b.fetch("/api/staff/signin/verify", { json: { response: assert(challenge) } });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    return { id: user.id, email: user.email, handle, keyId: enrolled.key.id, role, b, assert };
  }
  type Staff = typeof moderator;

  /** An author with a post that holds this many images, each with the files the worker would have written. */
  async function imagePost(images: number) {
    const author = await h.established();
    profileIds.push(author.id);
    const p = await h.postWithImages(author.id, images);
    for (const id of p.mediaIds) {
      writeFileSync(h.files.store.image(id, "large"), webpBytes("VP8X", 2048, 1536, `large of ${id}`));
      writeFileSync(h.files.store.image(id, "small"), webpBytes("VP8 ", 1024, 768, `small of ${id}`));
    }
    return { author, ...p };
  }
  /** A signed-in reporter with a profile. */
  async function reporter() {
    const made = await h.established();
    profileIds.push(made.id);
    return made;
  }
  /** A post reported under a rule by a signed-in reporter: its case and its item. */
  async function reported(images = 0, explanation: string | null = null) {
    const [p, by] = [await imagePost(images), await reporter()];
    const recorded = await recordIntake(deps, { ground: { ...ground.rule(by.id, "R1"), explanation }, live: [aPost(p.postId)] });
    return { ...p, reporter: by, caseId: recorded.items[0]!.caseId!, itemId: recorded.items[0]!.id };
  }
  const get = (s: Staff, path: string) => s.b.fetch(path, { headers: MARKED });
  const post = (s: Staff, path: string, json: unknown = {}) => s.b.fetch(path, { json, headers: MARKED });
  /** Saves a text as the console does: a fresh salt and the digest of the salt and the text. */
  async function saveText(s: Staff, caseId: string, kind: string, text: string) {
    const salt = hex64();
    return post(s, `/api/staff/cases/${caseId}/texts`, { kind, text, salt, digest: await textDigest(salt, text) });
  }
  /** The key's confirmation of exactly this reveal, asked for as the console asks for it. */
  async function confirmation(s: Staff, itemId: string, params: IdentityRevealedParams): Promise<AuthenticationResponseJSON> {
    const res = await s.b.fetch("/api/staff/step-up/options", { json: { action: "identity_revealed", target: { type: "intake_item", id: itemId }, params }, headers: MARKED });
    expect(res.status, await res.clone().text()).toBe(200);
    return s.assert(StaffStepUpOptionsResponse.parse(await res.json()).options.challenge);
  }
  /** A reason saved on the case, and the params of a reveal that names it. */
  async function revealParams(s: Staff, caseId: string): Promise<IdentityRevealedParams> {
    const saved = await saveText(s, caseId, "reveal_reason", `The notifier claims to be impersonated (${randomUUID()}).`);
    expect(saved.status, await saved.clone().text()).toBe(201);
    return { reasonCategory: "impersonation_claim", reasonDigest: (await answer(StaffTextSaved, saved)).digest };
  }
  const revealsOf = async (staffId: string) => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where staff_id = ${staffId}::uuid and kind = 'identity_revealed'`))[0]!.n;

  test("every case route needs a staff session, and none answers a cross-origin header", async () => {
    const r = await reported(1);
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/staff/overview"],
      ["GET", "/api/staff/queue"],
      ["GET", `/api/staff/cases/${r.caseId}`],
      ["GET", `/api/staff/cases/${r.caseId}/media/${r.mediaIds[0]}/small`],
      ["GET", `/api/staff/cases/${r.caseId}/texts`],
      ["POST", `/api/staff/cases/${r.caseId}/snapshots`, {}],
      ["POST", `/api/staff/cases/${r.caseId}/texts`, { kind: "note", text: "a note", salt: hex64(), digest: hex64() }],
      ["POST", "/api/staff/findings", { target: { kind: "post", id: r.postId }, ground: "rule", ruleId: "R1", category: TC }],
      ["POST", `/api/staff/items/${r.itemId}/reveal`, { reasonCategory: "other", reasonDigest: hex64() }],
    ];
    for (const [method, path, body] of routes) {
      const stranger = await consoleBrowser().fetch(path, { method, json: body, headers: MARKED });
      expect(await answered(stranger), `${method} ${path} without a session`).toEqual([401, "staff_session_required"]);
      // The same request from the app's origin never reaches a staff route: the gate answers the unknown route.
      const fromApp = await new Browser(app, appOrigin()).fetch(path, { method, json: body });
      expect(fromApp.status, `${method} ${path} from the app's site`).toBe(404);
    }
    // With a session, to an Origin listed in TRUSTED_ORIGINS or not: no staff answer carries a CORS header.
    for (const path of ["/api/staff/overview", "/api/staff/queue", `/api/staff/cases/${r.caseId}`, `/api/staff/cases/${r.caseId}/media/${r.mediaIds[0]}/small`]) {
      const res = await get(moderator, path);
      expect(res.status, path).toBe(200);
      expect([...res.headers.keys()].filter((name) => name.startsWith("access-control-")), path).toEqual([]);
      await res.arrayBuffer();
    }
    expect((await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where case_id = ${r.caseId}::uuid`))[0]!.n).toBe(0);
  });

  test("the overview, the queue and the case answer what the contracts describe, never stored; a case that does not exist is 404, and an id that is none is refused", async () => {
    const r = await reported(1, "The reporter's own words.");
    const seen = await get(moderator, "/api/staff/overview");
    expect(seen.status).toBe(200);
    expect(seen.headers.get("cache-control")).toBe("no-store");
    await answer(StaffOverview, seen);

    const queue = await get(moderator, "/api/staff/queue");
    expect(queue.status).toBe(200);
    const page = await answer(QueuePage, queue);
    expect(page.cases.map((row) => row.id)).toContain(r.caseId);
    expect(await answered(await get(moderator, "/api/staff/queue?cursor=bm9wZQ"))).toEqual([400, "invalid_request"]);
    expect(await answered(await get(moderator, "/api/staff/queue?cursor=a%20b"))).toEqual([400, "invalid_request"]);

    const res = await get(moderator, `/api/staff/cases/${r.caseId}`);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const view = await answer(CaseView, res);
    expect(view).toMatchObject({ id: r.caseId, imagesAllowed: true, suspicion: null, target: { type: "post", id: r.postId, state: "visible", level: "visible" } });
    expect(view.items[0]).toMatchObject({ explanation: "The reporter's own words.", source: { kind: "reporter", label: "Reporter A" } });
    // The console computes the digest of what it displays: it is the one stored.
    const snapshot = view.snapshots[0]!;
    if (snapshot.withheld) throw new Error("the snapshot is shown");
    expect(await snapshotDigest(snapshot)).toBe(snapshot.digest);
    // An upper-case spelling of the id names the same case.
    expect((await get(moderator, `/api/staff/cases/${r.caseId.toUpperCase()}`)).status).toBe(200);
    expect(await answered(await get(moderator, `/api/staff/cases/${randomUUID()}`))).toEqual([404, "not_found"]);
    expect(await answered(await get(moderator, "/api/staff/cases/not-a-case"))).toEqual([400, "invalid_request"]);
    // The two reads were logged for the moderator, and nothing for the refused ones.
    expect((await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where staff_id = ${moderator.id}::uuid and case_id = ${r.caseId}::uuid and kind = 'case_opened'`))[0]!.n).toBe(2);
  });

  test("the image route answers the file as WebP, private and never stored, under the API's own policy; every refusal is one 404", async () => {
    const r = await reported(1);
    const image = r.mediaIds[0]!;
    const res = await get(moderator, `/api/staff/cases/${r.caseId}/media/${image}/small`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(webpBytes("VP8 ", 1024, 768, `small of ${image}`));
    const large = await get(moderator, `/api/staff/cases/${r.caseId}/media/${image}/large`);
    expect(Buffer.from(await large.arrayBuffer())).toEqual(webpBytes("VP8X", 2048, 1536, `large of ${image}`));

    // Another post's image on this case, an image nobody has, and a size that is none.
    const elsewhere = await reported(1);
    expect(await answered(await get(moderator, `/api/staff/cases/${r.caseId}/media/${elsewhere.mediaIds[0]}/small`))).toEqual([404, "image_refused"]);
    expect(await answered(await get(moderator, `/api/staff/cases/${r.caseId}/media/${randomUUID()}/small`))).toEqual([404, "image_refused"]);
    expect(await answered(await get(moderator, `/api/staff/cases/${r.caseId}/media/${image}/original`))).toEqual([400, "invalid_request"]);
    // A report of child sexual abuse material about the post joins its open case: from then on no staff member is
    // served the image that the case served a moment ago.
    const suspect = await recordIntake(deps, { ground: ground.csam(), live: [aPost(r.postId)] });
    expect(suspect.items[0]!.caseId).toBe(r.caseId);
    for (const s of [moderator, admin]) expect(await answered(await get(s, `/api/staff/cases/${r.caseId}/media/${image}/small`)), s.role).toEqual([404, "image_refused"]);
    const frozen = await answer(CaseView, await get(admin, `/api/staff/cases/${r.caseId}`));
    expect(frozen).toMatchObject({ imagesAllowed: false, lane: 0, suspicion: { open: true, reach: { posts: 1, images: 1, sealed: 0, served: 1 } } });
    expect((await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where case_id = ${r.caseId}::uuid and kind = 'image_viewed'`))[0]!.n).toBe(2);
  });

  test("the image route takes GET alone: a HEAD request is answered as an unknown route, with no file opened and no view logged, signed in or not", async () => {
    const r = await reported(1);
    const path = `/api/staff/cases/${r.caseId}/media/${r.mediaIds[0]}/small`;
    const views = async () => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where case_id = ${r.caseId}::uuid and kind = 'image_viewed'`))[0]!.n;
    const asked = imageCalls;
    for (const [who, browser] of [["signed in", moderator.b], ["signed out", consoleBrowser()]] as const) {
      const res = await browser.fetch(path, { method: "HEAD", headers: MARKED });
      expect(res.status, who).toBe(404);
      expect(res.headers.get("content-type"), who).not.toBe("image/webp");
      // The answer to a HEAD request has no body.
      expect(await res.text(), who).toBe("");
    }
    // The moderation module was never asked: nothing opened a file, and nothing was logged.
    expect(imageCalls).toBe(asked);
    expect(await views()).toBe(0);
    // The same address with GET is served, and logged once.
    const served = await get(moderator, path);
    expect(served.status).toBe(200);
    await served.arrayBuffer();
    expect(imageCalls).toBe(asked + 1);
    expect(await views()).toBe(1);
  });

  test("no staff route answers HEAD: on a case, with a live staff session, it writes no case_opened row and counts nothing against the day's limit on different cases", async () => {
    const person = await staffBrowser("moderator");
    const [first, second] = [await reported(), await reported()];
    const opened = async () =>
      (await apiDb.execute<{ case_id: string; n: number }>(sql`select case_id, count(*)::int as n from case_access_log where staff_id = ${person.id}::uuid and kind = 'case_opened' group by case_id`)).map((row) => ({ ...row }));
    // One different case a day, so that a counted read would show. The limits' row is the suite's to keep: only the
    // migrator writes it, and it is put back whatever happens.
    const [kept] = await migrateDb.execute<{ case_opens_per_day: number }>(sql`select case_opens_per_day from moderation_limits where id = 1`);
    await migrateDb.execute(sql`update moderation_limits set case_opens_per_day = 1 where id = 1`);
    try {
      const reads = sessionReads;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await person.b.fetch(`/api/staff/cases/${first.caseId}`, { method: "HEAD", headers: MARKED });
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("");
      }
      // Nothing read the session, and nothing was logged: the case was not opened.
      expect(sessionReads).toBe(reads);
      expect(await opened()).toEqual([]);
      // Had the HEAD opened the first case, the day's one case would be spent. The second is read all the same,
      expect((await get(person, `/api/staff/cases/${second.caseId}`)).status).toBe(200);
      // and is the one that spends it: the limit is in force, and the first case is now one too many.
      expect(await answered(await get(person, `/api/staff/cases/${first.caseId}`))).toEqual([429, "rate_limited"]);
      expect(await opened()).toEqual([{ case_id: second.caseId, n: 1 }]);
      // A HEAD at the limit is the unknown route too, never the limit's refusal.
      expect((await person.b.fetch(`/api/staff/cases/${first.caseId}`, { method: "HEAD", headers: MARKED })).status).toBe(404);
    } finally {
      await migrateDb.execute(sql`update moderation_limits set case_opens_per_day = ${kept!.case_opens_per_day} where id = 1`);
    }
  });

  test("a HEAD on the queue, the overview, a case's drafts and 3a's own reads (the sessions list, the audit log, the keys, the session itself) answers 404 with no body, signed in or not, and never reads the session: its idle end stays where it was", async () => {
    const person = await staffBrowser("moderator");
    const r = await reported();
    /** When the person last acted, as the session's row holds it: a marked request that reads the session moves it. */
    const lastUsed = async () => Number((await authDb.execute<{ at: string }>(sql`select (extract(epoch from last_used_at) * 1000)::bigint::text as at from auth.staff_sessions where user_id = ${person.id}::uuid`))[0]!.at);
    const before = await lastUsed();
    const reads = sessionReads;
    const paths = ["/api/staff/queue", "/api/staff/overview", `/api/staff/cases/${r.caseId}/texts`, "/api/staff/sessions", "/api/staff/audit", "/api/staff/keys", "/api/staff/me"];
    for (const path of paths) {
      for (const [who, browser] of [["signed in", person.b], ["signed out", consoleBrowser()]] as const) {
        const res = await browser.fetch(path, { method: "HEAD", headers: MARKED });
        expect(res.status, `${who}: ${path}`).toBe(404);
        expect(await res.text(), `${who}: ${path}`).toBe("");
        // No staff cookie is set or cleared: nothing looked at a session, live or missing.
        expect(res.headers.getSetCookie(), `${who}: ${path}`).toEqual([]);
      }
    }
    expect(sessionReads).toBe(reads);
    expect(await lastUsed()).toBe(before);
    // The same request with GET reads the session, and its mark moves the idle end.
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const path of paths) expect((await get(person, path)).status, path).toBe(200);
    expect(sessionReads).toBe(reads + paths.length);
    expect(await lastUsed()).toBeGreaterThan(before);
    // And a signed-out GET is told to sign in, which a signed-out HEAD never was.
    expect(await answered(await consoleBrowser().fetch("/api/staff/overview", { headers: MARKED }))).toEqual([401, "staff_session_required"]);
  });

  test("a text is saved with its digest or refused with a code of its own, and nothing is stored for a refusal; the person's drafts are read back with their salts; a snapshot answers an id and a digest alone", async () => {
    const theirs = "He posted my home address and my phone number to hurt me.";
    const r = await reported(0, theirs);
    const stored = async () => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where case_id = ${r.caseId}::uuid`))[0]!.n;

    const saved = await saveText(moderator, r.caseId, "facts", "The post names the home address of another person.");
    expect(saved.status, await saved.clone().text()).toBe(201);
    const { id, digest } = await answer(StaffTextSaved, saved);
    const drafts = await answer(StaffTextsResponse, await get(moderator, `/api/staff/cases/${r.caseId}/texts`));
    expect(drafts.texts).toEqual([expect.objectContaining({ id, digest, kind: "facts", text: "The post names the home address of another person." })]);
    expect(await textDigest(drafts.texts[0]!.salt, drafts.texts[0]!.text)).toBe(digest);
    // Another staff member's drafts are their own.
    expect((await answer(StaffTextsResponse, await get(admin, `/api/staff/cases/${r.caseId}/texts`))).texts).toEqual([]);

    const salt = hex64();
    const mismatch = await post(moderator, `/api/staff/cases/${r.caseId}/texts`, { kind: "reason", text: "The reason.", salt, digest: await textDigest(salt, "Another text.") });
    expect(await answered(mismatch)).toEqual([422, "text_invalid"]);
    expect(await answered(await saveText(moderator, r.caseId, "reason", `As the reporter wrote: ${theirs}`))).toEqual([422, "text_quotes_user"]);
    expect(await answered(await saveText(moderator, r.caseId, "reason", "x".repeat(5001)))).toEqual([422, "text_invalid"]);
    expect(await answered(await saveText(moderator, r.caseId, "statement", "a kind that is none"))).toEqual([400, "invalid_request"]);
    expect(await answered(await saveText(moderator, randomUUID(), "note", "a note"))).toEqual([404, "not_found"]);
    // No text is saved empty, whatever its kind: a reason of nothing or of white space is no reason.
    for (const [kind, text] of [["reveal_reason", ""], ["facts", "   "], ["seal_declined", ` ${String.fromCharCode(10)} `], ["note", ""]] as const) {
      expect(await answered(await saveText(moderator, r.caseId, kind, text)), `${kind}: ${JSON.stringify(text)}`).toEqual([400, "invalid_request"]);
    }
    expect(await stored()).toBe(1);

    const taken = await post(moderator, `/api/staff/cases/${r.caseId}/snapshots`);
    expect(taken.status, await taken.clone().text()).toBe(200);
    const body = (await taken.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["digest", "id"]);
    held(StaffSnapshotTaken, body);
    expect(await answered(await post(moderator, `/api/staff/cases/${randomUUID()}/snapshots`))).toEqual([404, "not_found"]);
  });

  test("a finding opens a case under its rule, answered 201; a target with nothing live is 404 with nothing written; citing R2, a deleted post and an account under a handle it has left get their case whatever is left of them", async () => {
    const findings = async () => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from intakes where finding_by = ${moderator.id}::uuid`))[0]!.n;
    const finding = (target: unknown, ruleId = "R1") => post(moderator, "/api/staff/findings", { target, ground: "rule", ruleId, category: ruleId === "R2" ? MINORS : TC });
    const live = await imagePost(1);
    const opened = await finding({ kind: "post", id: live.postId }, "R3");
    expect(opened.status, await opened.clone().text()).toBe(201);
    const { caseId } = await answer(FindingResponse, opened);
    const view = await answer(CaseView, await get(admin, `/api/staff/cases/${caseId}`));
    expect(view.items[0]).toMatchObject({ ruleId: "R3", allegesIllegal: false, source: { kind: "staff", label: "Found by a moderator" } });
    expect(await findings()).toBe(1);

    // Nothing live: a post nobody has, a post its author deleted, a deleted account, a handle its account has left.
    const deleted = await imagePost(1);
    await apiDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted.postId}::uuid`);
    const gone = await reporter();
    await apiDb.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
    const moved = await imagePost(1);
    const left = `old_${randomUUID().slice(0, 8)}`;
    await migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${moved.author.id}::uuid, now())`);
    try {
      const dead: [string, unknown][] = [
        ["a link to a post nobody has", { kind: "link", url: `${appOrigin()}/post/${randomUUID()}` }],
        ["a post its author deleted", { kind: "post", id: deleted.postId }],
        ["a deleted account", { kind: "account", handle: gone.handle }],
        ["a handle its account has left", { kind: "account", handle: left }],
      ];
      for (const [label, target] of dead) expect(await answered(await finding(target, "R1")), label).toEqual([404, "not_found"]);
      expect(await findings()).toBe(1);
      // A finding has no other ground than a rule, and names its target as a notice does.
      expect(await answered(await post(moderator, "/api/staff/findings", { target: { kind: "post", id: live.postId }, ground: "illegal", ruleId: "R1", category: TC }))).toEqual([400, "invalid_request"]);
      expect(await answered(await finding({ kind: "link", url: "https://elsewhere.example/post/x" }))).toEqual([422, "notice_link_offsite"]);

      // Under R2 the same targets are live while their rows exist.
      const onDeleted = await finding({ kind: "post", id: deleted.postId }, "R2");
      const onGone = await finding({ kind: "account", handle: gone.handle }, "R2");
      const onLeft = await finding({ kind: "link", url: `${appOrigin()}/u/${left}` }, "R2");
      for (const res of [onDeleted, onGone, onLeft]) expect(res.status, await res.clone().text()).toBe(201);
      const leftView = await answer(CaseView, await get(admin, `/api/staff/cases/${(await answer(FindingResponse, onLeft)).caseId}`));
      expect(leftView).toMatchObject({ lane: 0, imagesAllowed: false, target: { type: "account", id: moved.author.id, handle: moved.author.handle }, suspicion: { open: true, reach: { posts: 1, images: 1 } } });
      expect(leftView.items[0]).toMatchObject({ link: `${appOrigin()}/u/${left}`, suspect: true, ruleId: "R2" });
      expect(await findings()).toBe(4);
      // The urgent lane's alert went to the staff accounts, once.
      await settle();
      expect(mailer.sent.filter((message) => message.template === "moderation_urgent" && message.to === admin.email)).toHaveLength(1);
    } finally {
      await migrateDb.execute(sql`delete from handle_history where handle_lower = ${left}`);
    }
  });

  test("a staff member whose linked account is the case's subject is refused the case, its image, a snapshot, both text routes and, after the key's confirmation, the reveal: 403 staff_recused, with no access row and no text stored; a case nobody has is 404 for them as for anyone", async () => {
    const close = await staffBrowser("moderator");
    // The personal account the operator linked to the staff account: only the migrator writes that table.
    const personal = (await newUserWithDevice(repo)).user.id;
    await apiDb.insert(profiles).values({ id: personal, handle: `p_${randomUUID().slice(0, 8)}`, displayName: "Personal", createdAt: new Date(Date.now() - 3 * 24 * 3600_000) });
    profileIds.push(personal);
    await migrateDb.execute(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${close.id}::uuid, ${personal}::uuid)`);
    try {
      // A post of the linked account with an image, reported by someone else.
      const p = await h.postWithImages(personal, 1);
      const image = p.mediaIds[0]!;
      writeFileSync(h.files.store.image(image, "small"), webpBytes("VP8 ", 1024, 768, `small of ${image}`));
      const recorded = await recordIntake(deps, { ground: ground.rule((await reporter()).id, "R1"), live: [aPost(p.postId)] });
      const [caseId, itemId] = [recorded.items[0]!.caseId!, recorded.items[0]!.id];
      const params: IdentityRevealedParams = { reasonCategory: "other", reasonDigest: hex64() };
      const asked = imageCalls;
      const refused = {
        "the case": await answered(await get(close, `/api/staff/cases/${caseId}`)),
        "its image": await answered(await get(close, `/api/staff/cases/${caseId}/media/${image}/small`)),
        "a snapshot": await answered(await post(close, `/api/staff/cases/${caseId}/snapshots`)),
        "saving a text": await answered(await saveText(close, caseId, "reveal_reason", "The reporter claims to be impersonated.")),
        "the drafts": await answered(await get(close, `/api/staff/cases/${caseId}/texts`)),
        // The key confirms exactly this reveal, and the flow refuses it all the same.
        "the reveal": await answered(await post(close, `/api/staff/items/${itemId}/reveal`, { ...params, stepUp: await confirmation(close, itemId, params) })),
      };
      const recused: [number, string] = [403, "staff_recused"];
      expect(refused).toEqual({ "the case": recused, "its image": recused, "a snapshot": recused, "saving a text": recused, "the drafts": recused, "the reveal": recused });
      // The image route did ask the moderation module, which refused before it looked for a file.
      expect(imageCalls).toBe(asked + 1);
      const [left] = await apiDb.execute<{ access: number; texts: number; snapshots: number }>(sql`
        select (select count(*)::int from case_access_log where staff_id = ${close.id}::uuid) as access,
               (select count(*)::int from staff_texts where case_id = ${caseId}::uuid) as texts,
               (select count(*)::int from evidence_snapshots where case_id = ${caseId}::uuid) as snapshots`);
      expect({ ...left! }).toEqual({ access: 0, texts: 0, snapshots: 1 });
      // A case nobody has is not found, for them as for anyone; and another staff member opens the case.
      expect(await answered(await get(close, `/api/staff/cases/${randomUUID()}`))).toEqual([404, "not_found"]);
      expect((await get(admin, `/api/staff/cases/${caseId}`)).status).toBe(200);
    } finally {
      await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${close.id}::uuid`);
    }
  });

  test("the day's limits over HTTP: 429 with the seconds to wait on a case read at the limit (a case opened earlier that day is still read, and every staff account is mailed once), on a finding, on a reveal the key confirmed, and on the sixty-first text saved in a minute", async () => {
    const limited = await staffBrowser("moderator");
    const [first, second] = [await reported(), await reported()];
    const within = (res: Response, most: number) => {
      expect(retryAfter(res)).toBeGreaterThanOrEqual(1);
      expect(retryAfter(res)).toBeLessThanOrEqual(most);
    };
    // The limits' row is the suite's to keep: only the migrator writes it, and it is put back whatever happens.
    const [kept] = await migrateDb.execute<{ case_opens_per_day: number; findings_per_day: number; reveals_per_day: number }>(sql`select case_opens_per_day, findings_per_day, reveals_per_day from moderation_limits where id = 1`);
    await migrateDb.execute(sql`update moderation_limits set case_opens_per_day = 1, findings_per_day = 1, reveals_per_day = 1 where id = 1`);
    try {
      // Case reads: one different case a day.
      expect((await get(limited, `/api/staff/cases/${first.caseId}`)).status).toBe(200);
      for (let attempt = 0; attempt < 2; attempt++) {
        const refused = await get(limited, `/api/staff/cases/${second.caseId}`);
        within(refused, 86_400);
        expect(await answered(refused)).toEqual([429, "rate_limited"]);
      }
      expect((await get(limited, `/api/staff/cases/${first.caseId}`)).status).toBe(200);
      const opened = await apiDb.execute<{ case_id: string; n: number }>(sql`select case_id, count(*)::int as n from case_access_log where staff_id = ${limited.id}::uuid and kind = 'case_opened' group by case_id`);
      expect(opened.map((row) => ({ ...row }))).toEqual([{ case_id: first.caseId, n: 2 }]);
      // Every staff account, the person's own included, is told once that day, through the auth module's own mailer:
      // one mail about this person each, however often they were refused.
      await settle();
      for (const s of [limited, admin]) {
        const mails = mailer.sent.filter((message) => message.template === "moderation_reads" && message.to === s.email && message.data.handle === limited.handle);
        expect(mails.map((message) => message.data), s.role).toEqual([expect.objectContaining({ handle: limited.handle, limit: "1" })]);
      }

      // Findings: one a day. The target is resolved first, so a link that names nothing is still answered as that.
      const finding = (postId: string) => post(limited, "/api/staff/findings", { target: { kind: "post", id: postId }, ground: "rule", ruleId: "R1", category: TC });
      const [one, two] = [await imagePost(0), await imagePost(0)];
      expect((await finding(one.postId)).status).toBe(201);
      const overLimit = await finding(two.postId);
      within(overLimit, 86_400);
      expect(await answered(overLimit)).toEqual([429, "rate_limited"]);
      expect(await answered(await finding(randomUUID()))).toEqual([404, "not_found"]);
      const [written] = await apiDb.execute<{ findings: number; cases: number }>(sql`
        select (select count(*)::int from intakes where finding_by = ${limited.id}::uuid) as findings,
               (select count(*)::int from cases where target_id = ${two.postId}::uuid) as cases`);
      expect({ ...written! }).toEqual({ findings: 1, cases: 0 });

      // Reveals: one a day. The second is refused after the key confirmed it: nothing is written, its reason stays a draft.
      const reveal = async (r: typeof first) => {
        const params = await revealParams(limited, r.caseId);
        return { params, res: await post(limited, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp: await confirmation(limited, r.itemId, params) }) };
      };
      expect((await reveal(first)).res.status).toBe(200);
      const next = await reveal(second);
      within(next.res, 86_400);
      expect(await answered(next.res)).toEqual([429, "rate_limited"]);
      expect(await revealsOf(limited.id)).toBe(1);
      const [reason] = await apiDb.execute<{ confirmed: boolean }>(sql`select confirmed_at is not null as confirmed from staff_texts where digest = ${next.params.reasonDigest}`);
      expect(reason!.confirmed).toBe(false);

      // Saved texts: sixty a minute. The minute's count so far is read with one more hit, then filled to fifty-nine.
      const key = `staff-text:${limited.id}`;
      for (let used = (await rateLimitStore.hit(key, 60_000)).count; used < TEXT_SAVES_PER_MINUTE - 1; used++) await rateLimitStore.hit(key, 60_000);
      expect((await saveText(limited, first.caseId, "note", "the sixtieth")).status).toBe(201);
      const tooMany = await saveText(limited, first.caseId, "note", "the sixty-first");
      within(tooMany, 60);
      expect(await answered(tooMany)).toEqual([429, "rate_limited"]);
      expect((await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where author_id = ${limited.id}::uuid and kind = 'note'`))[0]!.n).toBe(1);
    } finally {
      await migrateDb.execute(sql`update moderation_limits set case_opens_per_day = ${kept!.case_opens_per_day}, findings_per_day = ${kept!.findings_per_day}, reveals_per_day = ${kept!.reveals_per_day} where id = 1`);
    }
  });

  describe("revealing who sent a report", () => {
    test("the key's confirmation of exactly this reveal answers the reporter's handle; the access row and the audit row commit together, and every staff account is mailed", async () => {
      const r = await reported();
      const params = await revealParams(moderator, r.caseId);
      const res = await post(moderator, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp: await confirmation(moderator, r.itemId, params) });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await answer(RevealResponse, res)).toEqual({ handle: r.reporter.handle, name: null });
      const [stored] = await apiDb.execute<Record<string, unknown>>(sql`
        select l.case_id, l.intake_item_id,
               (select t.confirmed_at is not null from staff_texts t where t.id = l.text_id) as confirmed,
               (select count(*)::int from audit_log a where a.action = 'identity_revealed' and a.target_type = 'intake_item' and a.target_id = l.intake_item_id::text and a.actor_id = l.staff_id and a.step_up is not null) as audits
          from case_access_log l where l.staff_id = ${moderator.id}::uuid and l.kind = 'identity_revealed' and l.intake_item_id = ${r.itemId}::uuid`);
      expect({ ...stored! }).toEqual({ case_id: r.caseId, intake_item_id: r.itemId, confirmed: true, audits: 1 });
      // The mail goes to every staff account, the person's own included, with the day's count and the limit.
      await settle();
      for (const s of [moderator, admin]) {
        const mails = mailer.sent.filter((message) => message.template === "moderation_reveal" && message.to === s.email);
        expect(mails.at(-1)?.data, s.role).toMatchObject({ handle: moderator.handle, count: "1", limit: "10" });
      }
      // The home screen lists it for every staff member.
      const seen = await answer(StaffOverview, await get(admin, "/api/staff/overview"));
      expect(seen.reveals.items).toContainEqual({ at: expect.any(String), handle: moderator.handle, caseId: r.caseId });
    });

    test("it needs the key's confirmation of this reveal of this item, and is refused with its own codes for a source that names nobody and for a reason that is none", async () => {
      const [r, elsewhere] = [await reported(), await reported()];
      const params = await revealParams(moderator, r.caseId);
      const stepUp = await confirmation(moderator, r.itemId, params);
      const path = `/api/staff/items/${r.itemId}/reveal`;
      const answers: Record<string, [number, string]> = {};
      answers["no confirmation"] = await answered(await post(moderator, path, params));
      answers["a member the params do not take"] = await answered(await post(moderator, path, { ...params, reason: "free text", stepUp }));
      answers["other params"] = await answered(await post(moderator, path, { ...params, reasonCategory: "other", stepUp }));
      answers["another item"] = await answered(await post(moderator, `/api/staff/items/${elsewhere.itemId}/reveal`, { ...params, stepUp }));
      answers["another person's session"] = await answered(await post(admin, path, { ...params, stepUp }));
      answers["an item that is no uuid"] = await answered(await post(moderator, "/api/staff/items/not-an-item/reveal", { ...params, stepUp }));
      // A confirmed reveal that the flow refuses: a reason nobody saved, an item nobody has, a finding's item.
      const unsaved: IdentityRevealedParams = { reasonCategory: "other", reasonDigest: hex64() };
      answers["a reason nobody saved"] = await answered(await post(moderator, path, { ...unsaved, stepUp: await confirmation(moderator, r.itemId, unsaved) }));
      const nowhere = randomUUID();
      answers["an item nobody has"] = await answered(await post(moderator, `/api/staff/items/${nowhere}/reveal`, { ...unsaved, stepUp: await confirmation(moderator, nowhere, unsaved) }));
      const finding = await recordIntake(deps, { ground: ground.finding(admin.id, "R1"), live: [aPost(r.postId)] });
      const findingItem = finding.items[0]!.id;
      answers["a finding's item"] = await answered(await post(moderator, `/api/staff/items/${findingItem}/reveal`, { ...params, stepUp: await confirmation(moderator, findingItem, params) }));
      expect(answers).toEqual({
        "no confirmation": [403, "staff_step_up_required"],
        "a member the params do not take": [400, "invalid_request"],
        "other params": [403, "staff_step_up_invalid"],
        "another item": [403, "staff_step_up_invalid"],
        "another person's session": [403, "staff_step_up_invalid"],
        "an item that is no uuid": [400, "invalid_request"],
        "a reason nobody saved": [409, "text_not_found"],
        "an item nobody has": [404, "not_found"],
        "a finding's item": [422, "reveal_refused"],
      });
      expect(await revealsOf(moderator.id)).toBe(1);
      // A fresh confirmation of the same params still reveals, once: its challenge is then spent.
      const fresh = await confirmation(moderator, r.itemId, params);
      expect((await post(moderator, path, { ...params, stepUp: fresh })).status).toBe(200);
      expect(await answered(await post(moderator, path, { ...params, stepUp: fresh }))).toEqual([403, "staff_step_up_invalid"]);
      expect(await revealsOf(moderator.id)).toBe(2);
    });

    test("a key revoked between the confirmation and the reveal's transaction ends the session: 401 with both staff cookies cleared, nothing written, and no identity answered", async () => {
      const leaving = await staffBrowser("moderator");
      const r = await reported();
      const params = await revealParams(leaving, r.caseId);
      const stepUp = await confirmation(leaving, r.itemId, params);
      // The key is revoked inside the request, once requireStaff has read the session live and requireStaffStepUp has
      // verified the confirmation: only the reveal's own audit statement can notice it.
      insideRequest = () => authDb.execute(sql`update auth.staff_keys set revoked_at = now() where id = ${leaving.keyId}::uuid`);
      const res = await post(leaving, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp });
      expect(insideRequest).toBeNull();
      expect(res.status).toBe(401);
      const body = await res.clone().text();
      expect((await error(res)).code).toBe("staff_session_required");
      expect(body).not.toContain(r.reporter.handle);
      const cleared = res.headers.getSetCookie().filter((line) => line.includes("Max-Age=0")).map((line) => line.slice(0, line.indexOf("=")));
      expect(cleared.sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      expect(await revealsOf(leaving.id)).toBe(0);
      const [text] = await apiDb.execute<{ confirmed: boolean }>(sql`select confirmed_at is not null as confirmed from staff_texts where digest = ${params.reasonDigest}`);
      expect(text!.confirmed).toBe(false);
    });

    test("a signed-out notifier is revealed by the name they gave, which the auth module alone keeps and reads; a notifier who gave an address and no name, and a notice of child sexual abuse material, reveal nobody", async () => {
      const p = await imagePost(0);
      // Two contacts as the notice route stores them, through the auth module: the moderation module holds only their ids.
      const [named, unnamed] = [randomUUID(), randomUUID()];
      const address = `ada-${randomUUID().slice(0, 8)}@notifier.example`;
      await auth.forModeration.storeNotifierContact(named, { name: "Ada Lovelace", email: address });
      await auth.forModeration.storeNotifierContact(unnamed, { email: `nobody-${randomUUID().slice(0, 8)}@notifier.example` });
      try {
        const withName = await recordIntake(deps, { ground: { ...ground.illegal(null), contactId: named }, live: [aPost(p.postId)] });
        const withoutName = await recordIntake(deps, { ground: { ...ground.illegal(null), contactId: unnamed }, live: [aPost(p.postId)] });
        const suspect = await recordIntake(deps, { ground: ground.csam(), live: [aPost(p.postId)] });
        const caseId = withName.items[0]!.caseId!;
        const caseRes = await get(admin, `/api/staff/cases/${caseId}`);
        const caseText = await caseRes.clone().text();
        const view = await answer(CaseView, caseRes);
        // The case says what each sender gave, never what.
        expect(view.items.map((item) => item.source)).toEqual([
          expect.objectContaining({ kind: "notifier", named: true, contactGiven: true, contactLost: false }),
          expect.objectContaining({ kind: "notifier", named: false, contactGiven: true, contactLost: false }),
          expect.objectContaining({ kind: "anonymous", named: null, contactGiven: null }),
        ]);
        for (const kept of ["Ada", "Lovelace", "notifier.example", named, unnamed]) expect(caseText, kept).not.toContain(kept);

        const before = await revealsOf(admin.id);
        const reveal = async (itemId: string) => {
          const params = await revealParams(admin, caseId);
          return post(admin, `/api/staff/items/${itemId}/reveal`, { ...params, stepUp: await confirmation(admin, itemId, params) });
        };
        const res = await reveal(withName.items[0]!.id);
        expect(res.status, await res.clone().text()).toBe(200);
        const text = await res.clone().text();
        expect(await answer(RevealResponse, res)).toEqual({ handle: null, name: "Ada Lovelace" });
        // The name, and never the address.
        expect(text).not.toContain("notifier.example");
        expect(await answered(await reveal(withoutName.items[0]!.id))).toEqual([422, "reveal_refused"]);
        expect(await answered(await reveal(suspect.items[0]!.id))).toEqual([422, "reveal_refused"]);
        expect(await revealsOf(admin.id)).toBe(before + 1);
      } finally {
        await authDb.execute(sql`delete from auth.notifier_contacts where id = any(${`{${named},${unnamed}}`}::uuid[])`);
      }
    });

    test("a reveal whose challenge has run out by the database's clock is answered 400 challenge_expired: nothing is written, the reason stays a draft, and no identity is answered", async () => {
      // A staff member who signed in under a clock set back, so that a challenge issued under a clock set back by less
      // still finds the session begun.
      skewMs = -700_000;
      let slow: Staff;
      try {
        slow = await staffBrowser("moderator");
      } finally {
        skewMs = 0;
      }
      const r = await reported();
      const params = await revealParams(slow, r.caseId);
      // The auth module issues the challenge for ten minutes and, under the same clock, finds it valid; by the database's
      // clock, which the reveal's transaction reads, it ran out five seconds ago.
      skewMs = -605_000;
      let res: Response;
      try {
        res = await post(slow, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp: await confirmation(slow, r.itemId, params) });
      } finally {
        skewMs = 0;
      }
      const body = await res.clone().text();
      expect(await answered(res)).toEqual([400, "challenge_expired"]);
      expect(body).not.toContain(r.reporter.handle);
      const [left] = await apiDb.execute<{ reveals: number; confirmed: boolean; audits: number }>(sql`
        select (select count(*)::int from case_access_log where staff_id = ${slow.id}::uuid and kind = 'identity_revealed') as reveals,
               (select confirmed_at is not null from staff_texts where digest = ${params.reasonDigest}) as confirmed,
               (select count(*)::int from audit_log where action = 'identity_revealed' and target_id = ${r.itemId}) as audits`);
      expect({ ...left! }).toEqual({ reveals: 0, confirmed: false, audits: 0 });
      // The same reason under a fresh confirmation reveals: the late one spent nothing.
      const again = await post(slow, `/api/staff/items/${r.itemId}/reveal`, { ...params, stepUp: await confirmation(slow, r.itemId, params) });
      expect(again.status, await again.clone().text()).toBe(200);
      expect(await answer(RevealResponse, again)).toEqual({ handle: r.reporter.handle, name: null });
    });
  });

  test("an answer that carries a member its contract does not name is caught by the check every answer above went through", () => {
    const caseId = randomUUID();
    expect(held(FindingResponse, { caseId })).toEqual({ caseId });
    expect(() => held(FindingResponse, { caseId, reporterId: randomUUID() })).toThrow();
    expect(() => held(RevealResponse, { handle: null, name: "Ada", email: "ada@notifier.example" })).toThrow();
    expect(() => held(StaffTextsResponse, { texts: [{ id: caseId, kind: "facts", text: "t", salt: hex64(), digest: hex64(), createdAt: new Date().toISOString(), authorId: randomUUID() }] })).toThrow();
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    await settle();
    await removeFixtures(migrateDb, profileIds.splice(0));
    expect(await counts()).toEqual(before);
  });
});
```

### Create `apps/api/test/integration/moderation-cases.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  CaseView,
  OVERVIEW_LIST_MAX,
  QUEUE_PAGE_SIZE,
  QueuePage,
  SEAL_LIST_MAX,
  STAFF_TEXT_KINDS,
  SUSPECT_EARLIER_MONTHS,
  StaffOverview,
  snapshotDigest,
  textDigest,
  type FindingRequest,
  type StaffTextKind,
} from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { ActiveStaffSession, AuthForModeration, NotifierFacts, StaffMessage } from "../../src/auth";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { mediaForCases, type MediaForCases } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { caseImage, openFinding, overview, queue, readCase, takeSnapshot } from "../../src/moderation/cases";
import type { ModerationDeps } from "../../src/moderation/context";
import { recordIntake } from "../../src/moderation/intake";
import { queueRows } from "../../src/moderation/repo";
import { TEXT_SAVES_PER_MINUTE, ownTexts, saveText } from "../../src/moderation/texts";
import { webpBytes } from "../media/webp-bytes";
import { newUserWithDevice } from "./auth-fixtures";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { deciderWorld } from "./moderation-decide";
import {
  MINORS,
  TC,
  aPost,
  act,
  anAccount,
  decideIn,
  decisionParams,
  gate,
  ground,
  hex64,
  imagePost,
  intake,
  moderationDeps,
  newPostRow,
  postFrozen,
  refusal,
  removeFixtures,
  report,
  rowCounts,
  staffProfile,
  untilBlocked,
  type TestStaff,
  newTestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

const SEAL_WHILE_DECIDING = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] } as const;
const SEAL_FOR_GOOD = { kind: "final", ruleId: "R2", actions: [act("seal_media")] } as const;
const NO_SEAL = { kind: "final", outcome: "no_violation" } as const;

/**
 * The queue and the case, for staff (3c design, section 7.3), against the real database: the case answer with its
 * sources, its suspicion and its withheld content, the access log and the day's limits, the one door to a case's images,
 * the snapshot route, the saved texts, a moderator's own finding, the queue and the overview. Each test runs inside one
 * transaction that is rolled back, as korbat_api unless it needs a step only the migrator can take (moving a stored
 * time, a limit, a reporter's link); decisions go through the moderation module's own decide. The file's last test holds
 * it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the queue and the case, for staff", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  let other: TestStaff;
  /** A personal account the operator linked to the moderator's staff account. */
  let linked: string;
  let before: Record<string, number>;

  /** How many rows the moderation tables, the posts and profiles and the four auth tables of moderation hold. */
  async function counts(): Promise<Record<string, number>> {
    const [authSide] = await migrateDb.execute<Record<string, number>>(
      sql`select (select count(*)::int from auth.notifier_contacts) as notifier_contacts, (select count(*)::int from auth.notifier_confirmations) as notifier_confirmations,
                 (select count(*)::int from auth.notifier_suppressions) as notifier_suppressions, (select count(*)::int from auth.staff_personal_accounts) as staff_personal_accounts`,
    );
    return { ...(await rowCounts(apiDb)), ...authSide! };
  }

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    before = await counts();
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    other = await newTestStaff(authDb, migrateDb, repo, "moderator");
    linked = (await newUserWithDevice(repo)).user.id;
    await migrateDb.execute(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${mod.id}::uuid, ${linked}::uuid)`);
  }, 60_000);
  afterAll(async () => {
    await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${mod.id}::uuid`);
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the given pool that is rolled back, with the three staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      for (const staff of [mod, admin, other]) await staffProfile(tx, staff);
      await fn(tx);
    });
  /** The same with the media module on that transaction and a store directory of its own, for the tests that open files. */
  const withStore = (fn: (tx: DbTx, h: MediaHarness) => Promise<void>, db: Db = apiDb) =>
    inWorld(async (tx) => {
      const h = await mediaHarness(tx as unknown as Db);
      try {
        await fn(tx, h);
      } finally {
        h.cleanup();
      }
    }, db);
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  const authorDeletes = (tx: DbTx, postId: string) => tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);

  /** A staff session as requireStaff hands it over. */
  function sessionOf(staff: TestStaff): ActiveStaffSession {
    const now = new Date();
    return {
      sessionId: hex64(),
      handle: randomUUID(),
      userId: staff.id,
      keyId: staff.keyId,
      role: staff.role,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    };
  }

  /**
   * The moderation module on the test's transaction, with an auth module that knows the contacts the test names and
   * records every staff mail instead of sending it.
   */
  function world(tx: DbTx, overrides: Partial<ModerationDeps> = {}) {
    const contacts = new Map<string, NotifierFacts>();
    const mailed: StaffMessage[] = [];
    const auth = {
      notifierFacts: async (ids: readonly string[]) => new Map(ids.map((id) => [id, contacts.get(id) ?? { found: false, named: false, contactGiven: false, confirmed: false, suppressed: false }])),
      mailStaff: async (message: StaffMessage) => {
        mailed.push(message);
        return 3;
      },
    } as unknown as AuthForModeration;
    const deps = moderationDeps(tx, { auth, ...overrides });
    return { deps, contacts, mailed };
  }
  const handleOf = async (tx: DbTx, id: string) => (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${id}::uuid`))[0]!.handle;
  const accessRows = async (tx: DbTx, staffId: string, kind: string, caseId?: string) =>
    (await tx.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where staff_id = ${staffId}::uuid and kind = ${kind}::access_kind and (${caseId ?? null}::uuid is null or case_id = ${caseId ?? null}::uuid)`))[0]!.n;
  /** Saves a text as the console does: a fresh salt and the digest of the salt and the text. */
  async function save(deps: ModerationDeps, staff: TestStaff, caseId: string, kind: StaffTextKind, text: string) {
    const salt = hex64();
    return saveText(deps, sessionOf(staff), caseId, { kind, text, salt, digest: await textDigest(salt, text) });
  }

  describe("the case answer", () => {
    test("a rule report's case: the target as it stands, the snapshot with everything its digest covers, the item with its ground, and its sender as a summary that names nobody; the read is logged", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const p = await imagePost(tx, 2);
        const reporter = await profile(tx);
        const recorded = await intake(tx, { ...ground.rule(reporter.id, "R3"), explanation: "The reporter's own words about it." }, aPost(p.postId));
        const caseId = recorded.items[0]!.caseId!;

        const view = await readCase(deps, sessionOf(mod), caseId);
        expect(CaseView.safeParse(view).success, JSON.stringify(CaseView.safeParse(view).error?.issues)).toBe(true);
        expect(view).toMatchObject({ id: caseId, lane: 1, stateVersion: 0, intakeSeq: 1, answeredSeq: 0, closedAt: null, suspicion: null, imagesAllowed: true, decisions: [], appeals: [], drafts: [], notes: [], sealsDeclined: [] });
        expect(view.target).toEqual({ type: "post", id: p.postId, link: `${new URL(deps.config.APP_ORIGIN).origin}/post/${p.postId}`, authorHandle: await handleOf(tx, p.authorId), state: "visible", level: "visible" });

        // The snapshot is shown, and recomputes from the answer alone to the digest stored with it.
        expect(view.snapshots).toHaveLength(1);
        const snapshot = view.snapshots[0]!;
        if (snapshot.withheld) throw new Error("the snapshot is shown");
        expect(snapshot).toMatchObject({ targetType: "post", targetId: p.postId, postState: "visible", body: "a post", displayName: null, bio: null, handle: null });
        expect(snapshot.media).toEqual(p.mediaIds.map((id, position) => ({ id, alt: `image ${position + 1}`, width: 1200, height: 800 })));
        expect(await snapshotDigest(snapshot)).toBe(snapshot.digest);

        expect(view.items).toHaveLength(1);
        expect(view.items[0]).toMatchObject({
          id: recorded.items[0]!.id,
          seq: 1,
          position: 1,
          lane: 1,
          link: view.target.type === "post" ? view.target.link : "",
          ruleId: "R3",
          allegesIllegal: false,
          csam: false,
          category: TC,
          explanation: "The reporter's own words about it.",
          mediaId: null,
          suspect: false,
          quotedByPosition: null,
          quotedCaseId: null,
          reexaminesPosition: null,
          reexaminesYourDecision: false,
          outcome: null,
          answeredBy: null,
          erased: false,
          source: { kind: "reporter", label: "Reporter A", accountAge: "under_1_month", itemsFiled: "1", actedOn: "none_decided", answeredUnseen: "none", named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false },
        });
        // Neither the reporter's account nor its handle is anywhere in the answer.
        const text = JSON.stringify(view);
        expect(text).not.toContain(reporter.id);
        expect(text).not.toContain(reporter.handle);
        expect(view.history.map((entry) => entry.event)).toEqual(expect.arrayContaining(["item", "snapshot"]));
        // One access row for the read; a second read of the same case writes a second.
        expect(await accessRows(tx, mod.id, "case_opened", caseId)).toBe(1);
        await readCase(deps, sessionOf(mod), caseId);
        expect(await accessRows(tx, mod.id, "case_opened", caseId)).toBe(2);
        expect(await refusal(readCase(deps, sessionOf(mod), randomUUID()))).toBe("not_found");
      });
    });

    test("each source is a summary: reporters get letters in the order of their first items in the case; a notifier is what was given, or that the contact is lost; the path for child sexual abuse material is anonymous; a finding was found by a moderator; a reporter whose link is gone is only that", async () => {
      await inWorld(async (tx) => {
        const { deps, contacts } = world(tx);
        const p = await imagePost(tx, 0);
        const [first, second] = [await profile(tx), await profile(tx)];
        const [known, lost] = [randomUUID(), randomUUID()];
        contacts.set(known, { found: true, named: true, contactGiven: true, confirmed: false, suppressed: true });
        await intake(tx, ground.rule(first.id, "R1"), aPost(p.postId));
        await intake(tx, ground.illegal(second.id), aPost(p.postId));
        // The first reporter again, on the other ground: the same letter.
        await intake(tx, ground.illegal(first.id), aPost(p.postId));
        await intake(tx, { ...ground.illegal(null), contactId: known }, aPost(p.postId));
        await intake(tx, { ...ground.illegal(null), contactId: lost }, aPost(p.postId));
        await intake(tx, ground.illegal(null), aPost(p.postId));
        await intake(tx, ground.csam(), aPost(p.postId));
        const caseId = (await intake(tx, ground.finding(other.id, "R1"), aPost(p.postId))).items[0]!.caseId!;
        // The second reporter's link is forgotten, as after their account's deletion: only the migrator's functions do that.
        await tx.execute(sql`update intake_items set reporter_account_id = null where reporter_account_id = ${second.id}::uuid`);

        const view = await readCase(deps, sessionOf(mod), caseId);
        const none = { accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null };
        const noContact = { named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false };
        expect(view.items.map((item) => item.source)).toEqual([
          expect.objectContaining({ kind: "reporter", label: "Reporter A", itemsFiled: "2_to_9" }),
          { kind: "unlinked", label: "A signed-in reporter no longer linked", ...none, ...noContact },
          expect.objectContaining({ kind: "reporter", label: "Reporter A", itemsFiled: "2_to_9" }),
          { kind: "notifier", label: "A notifier", ...none, named: true, contactGiven: true, confirmed: false, suppressed: true, contactLost: false },
          { kind: "notifier", label: "A notifier", ...none, named: false, contactGiven: false, confirmed: false, suppressed: false, contactLost: true },
          { kind: "notifier", label: "A notifier", ...none, named: false, contactGiven: false, confirmed: false, suppressed: false, contactLost: false },
          { kind: "anonymous", label: "Anonymous", ...none, ...noContact },
          { kind: "staff", label: "Found by a moderator", ...none, ...noContact },
        ]);
        // No contact's id leaves the server: the summary is all the console gets.
        expect(JSON.stringify(view)).not.toContain(known);
        expect(JSON.stringify(view)).not.toContain(lost);

        // On another case the same person is lettered by that case's own order.
        const q = await imagePost(tx, 0);
        const third = await profile(tx);
        await intake(tx, ground.rule(third.id, "R1"), aPost(q.postId));
        const again = (await intake(tx, ground.rule(first.id, "R1"), aPost(q.postId))).items[0]!.caseId!;
        expect((await readCase(deps, sessionOf(mod), again)).items.map((item) => item.source.label)).toEqual(["Reporter A", "Reporter B"]);
      }, migrateDb);
    });

    test("a reporter's bands are computed over the reporter's own released items: an item answered without action while nobody could open the images is counted apart, never as decided without action", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const release = () => tx.execute(sql`select public.release_outcomes(now() - interval '1 hour')`);
        const decidedAgo = (decisionId: string) => tx.execute(sql`update decisions set decided_at = now() - interval '5 hours' where id = ${decisionId}::uuid`);
        // Whatever other suites left releasable goes first.
        await release();
        const reporter = await profile(tx);

        // A post frozen through its author's account's case: a moderator's no-action answer to the rule report is unseen.
        const frozen = await imagePost(tx, 1);
        const unseenCase = (await intake(tx, ground.rule(reporter.id, "R1"), aPost(frozen.postId))).items[0]!.caseId!;
        await report(tx, anAccount(frozen.authorId), "csam");
        await decidedAgo(await decideIn(tx, mod, unseenCase, NO_SEAL));
        await release();
        let view = await readCase(deps, sessionOf(mod), unseenCase);
        expect(view.decisions).toEqual([expect.objectContaining({ kind: "final", outcome: "no_violation", unseen: true, suspect: false })]);
        expect(view.items[0]!.source).toMatchObject({ itemsFiled: "1", actedOn: "none_decided", answeredUnseen: "1" });

        // A second report, acted on, and a third without action with the images in sight: one of two decided items acted on.
        const removed = await imagePost(tx, 0);
        const removedCase = (await intake(tx, ground.rule(reporter.id, "R1"), aPost(removed.postId))).items[0]!.caseId!;
        await decidedAgo(await decideIn(tx, mod, removedCase, { kind: "final", actions: [act("remove")] }));
        const cleared = await imagePost(tx, 0);
        const clearedCase = (await intake(tx, ground.rule(reporter.id, "R1"), aPost(cleared.postId))).items[0]!.caseId!;
        await decidedAgo(await decideIn(tx, mod, clearedCase, NO_SEAL));
        await release();
        view = await readCase(deps, sessionOf(mod), clearedCase);
        expect(view.items[0]!.source).toMatchObject({ kind: "reporter", label: "Reporter A", itemsFiled: "2_to_9", actedOn: "half_or_more", answeredUnseen: "1" });
        expect(view.items[0]).toMatchObject({ outcome: "no_violation", answeredBy: view.decisions[0]!.id });
        // An account made thirteen months ago is in the oldest band.
        await tx.execute(sql`update profiles set created_at = now() - interval '13 months' where id = ${reporter.id}::uuid`);
        expect((await readCase(deps, sessionOf(mod), clearedCase)).items[0]!.source.accountAge).toBe("over_12_months");
      }, migrateDb);
    });

    test("a report of child sexual abuse material: suspicion with what the case reaches, no image allowed, the quoted post's case linked from the quoting post's item and the added item marked; a seal lists what it covers; an answer without a seal is counted as an earlier answer", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const quoted = await imagePost(tx, 2);
        const quoting = await imagePost(tx, 1, undefined, { quoteOfId: quoted.postId });
        const recorded = await intake(tx, ground.csam(), aPost(quoting.postId));
        const [named, added] = [recorded.items.find((item) => item.position === 1)!, recorded.items.find((item) => item.position === 11)!];

        const quotingView = await readCase(deps, sessionOf(mod), named.caseId!);
        expect(quotingView).toMatchObject({ lane: 0, imagesAllowed: false });
        expect(quotingView.suspicion).toEqual({
          open: true,
          reach: { posts: 1, images: 1, sealed: 0, served: 1, newestPostOn: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) },
          earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } },
        });
        expect(quotingView.items[0]).toMatchObject({ suspect: true, csam: true, quotedByPosition: null, quotedCaseId: added.caseId, source: { kind: "anonymous" } });
        const quotedView = await readCase(deps, sessionOf(mod), added.caseId!);
        expect(quotedView.items[0]).toMatchObject({ suspect: true, position: 11, quotedByPosition: 1, quotedCaseId: null });
        expect(quotedView.suspicion?.reach).toMatchObject({ posts: 1, images: 2, sealed: 0, served: 2 });

        // Whoever is on duty seals the quoted post's images while deciding: the answer lists what the seal covers.
        const seal = await decideIn(tx, mod, added.caseId!, SEAL_WHILE_DECIDING);
        const sealedView = await readCase(deps, sessionOf(mod), added.caseId!);
        expect(sealedView.suspicion).toMatchObject({ open: true, reach: { posts: 1, images: 2, sealed: 2, served: 0 } });
        // Text is never sealed: the post keeps its state and level, and its snapshot is shown.
        expect(sealedView).toMatchObject({ imagesAllowed: false, target: { state: "visible", level: "visible" } });
        expect(sealedView.snapshots[0]).toMatchObject({ withheld: false, body: "a post" });
        expect(sealedView.decisions).toEqual([
          expect.objectContaining({ id: seal, kind: "interim", outcome: "restricted", ruleId: "R2", category: MINORS, suspect: true, unseen: false, needsAdmin: false, staffHandle: await handleOf(tx, mod.id) }),
        ]);
        expect(sealedView.decisions[0]!.actions).toEqual([
          { id: expect.any(String), kind: "seal_media", mediaId: null, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, sealed: { posts: 1, images: 2, deletedPosts: 0, list: [{ postId: quoted.postId, createdAt: expect.any(String), images: 2 }] } },
        ]);
        expect(sealedView.decisions[0]!.facts).toEqual(expect.stringContaining("facts"));

        // An admin answers without a seal: the seal has ended, the case is closed, and its images may be opened again.
        await decideIn(tx, admin, added.caseId!, NO_SEAL);
        const answered = await readCase(deps, sessionOf(mod), added.caseId!);
        expect(answered).toMatchObject({ imagesAllowed: true, suspicion: { open: false, reach: { sealed: 0, served: 2 } } });
        expect(answered.closedAt).not.toBeNull();
        // The seal taken while deciding ended by itself with that answer: no reversal lifted it. (Both decisions carry the
        // one time of this test's transaction, so the seal's is found by its id.)
        expect(answered.decisions.find((decision) => decision.id === seal)!.actions[0]).toMatchObject({ kind: "seal_media", inForce: false, liftedBy: null });
        // The answer counts as an earlier one, about the target and about its author, on the case itself and on the next
        // report of this kind; an answer with a seal about another post of the author does not.
        const today = new Date().toISOString().slice(0, 10);
        expect(answered.suspicion?.earlier).toEqual({ target: { count: 1, lastOn: today, imagesOpenedOn: null }, author: { count: 1, lastOn: today } });
        const sealedForGood = await imagePost(tx, 1, quoted.authorId);
        const goodCase = (await report(tx, aPost(sealedForGood.postId), "csam")).caseId;
        await decideIn(tx, admin, goodCase, SEAL_FOR_GOOD);
        const next = (await report(tx, aPost(quoted.postId), "csam")).caseId;
        const nextView = await readCase(deps, sessionOf(mod), next);
        expect(nextView.suspicion).toMatchObject({ open: true, earlier: { target: { count: 1, lastOn: today }, author: { count: 1, lastOn: today } } });
        // The sealed post's own closed case: the seal for good stands, so its images stay out of staff's sight.
        expect(await readCase(deps, sessionOf(mod), goodCase)).toMatchObject({ imagesAllowed: false, suspicion: { open: false, earlier: { target: { count: 0 }, author: { count: 1 } } } });
      });
    });

    test("an earlier answer without a seal is counted for twelve months and no longer: one decided eleven months ago is, one moved past twelve is not, about the target and about its author alike", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        expect(SUSPECT_EARLIER_MONTHS).toBe(12);
        const p = await imagePost(tx, 1);
        const answer = await decideIn(tx, admin, (await report(tx, aPost(p.postId), "csam")).caseId, NO_SEAL);
        // Another post of the same author, answered the same way: it counts for the author, never for this target.
        const sibling = await imagePost(tx, 1, p.authorId);
        const siblingAnswer = await decideIn(tx, admin, (await report(tx, aPost(sibling.postId), "csam")).caseId, NO_SEAL);
        const next = (await report(tx, aPost(p.postId), "csam")).caseId;
        const earlier = async () => (await readCase(deps, sessionOf(mod), next)).suspicion!.earlier;
        // Only the migrator moves a decision's time.
        const decidedAgo = (id: string, ago: string) => tx.execute(sql`update decisions set decided_at = now() - ${ago}::interval where id = ${id}::uuid`);
        const dayOf = async (id: string) => (await tx.execute<{ day: string }>(sql`select to_char(decided_at at time zone 'UTC', 'YYYY-MM-DD') as day from decisions where id = ${id}::uuid`))[0]!.day;

        await decidedAgo(answer, "11 months");
        expect(await earlier()).toEqual({ target: { count: 1, lastOn: await dayOf(answer), imagesOpenedOn: null }, author: { count: 2, lastOn: await dayOf(siblingAnswer) } });
        await decidedAgo(answer, "12 months 1 day");
        expect(await earlier()).toEqual({ target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 1, lastOn: await dayOf(siblingAnswer) } });
        await decidedAgo(siblingAnswer, "13 months");
        expect(await earlier()).toEqual({ target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } });
      }, migrateDb);
    });

    test("an account's case reaches every image on the account's posts, as it stands at each read, and never shows an image; a seal's list in the answer stops at SEAL_LIST_MAX posts", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const author = await profile(tx);
        await imagePost(tx, 2, author.id);
        const { caseId } = await report(tx, anAccount(author.id, author.handle), "csam");
        let view = await readCase(deps, sessionOf(mod), caseId);
        expect(view).toMatchObject({ imagesAllowed: false, target: { type: "account", id: author.id, handle: author.handle, deleted: false } });
        expect(view.suspicion).toMatchObject({ open: true, reach: { posts: 1, images: 2, sealed: 0, served: 2 }, earlier: { target: { count: 0, imagesOpenedOn: null } } });
        // The account posts again: the case reaches the new image too.
        await imagePost(tx, 1, author.id);
        expect((await readCase(deps, sessionOf(mod), caseId)).suspicion?.reach).toMatchObject({ posts: 2, images: 3, served: 3 });

        // SEAL_LIST_MAX and one more posts with an image each, written in three statements.
        const more = SEAL_LIST_MAX - 1;
        await tx.execute(sql`insert into posts (author_id, body, created_at) select ${author.id}::uuid, 'post ' || n, now() - interval '20 days' - n * interval '1 minute' from generate_series(1, ${more}::int) n`);
        await tx.execute(sql`insert into post_media (owner_id, status, width, height, blurhash) select ${author.id}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL' from generate_series(1, ${more}::int)`);
        await tx.execute(sql`
          update post_media m set post_id = pairs.post_id, position = 0, alt_text = 'one of many'
            from (select i.id as media_id, p.id as post_id
                    from (select id, row_number() over (order by id) as n from post_media where owner_id = ${author.id}::uuid and post_id is null) i
                    join (select id, row_number() over (order by id) as n from posts where author_id = ${author.id}::uuid and body like 'post %') p on p.n = i.n) pairs
           where m.id = pairs.media_id`);
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        view = await readCase(deps, sessionOf(mod), caseId);
        const sealed = view.decisions[0]!.actions[0]!.sealed!;
        expect(sealed).toMatchObject({ posts: SEAL_LIST_MAX + 1, images: SEAL_LIST_MAX + 2, deletedPosts: 0 });
        expect(sealed.list).toHaveLength(SEAL_LIST_MAX);
        // Oldest post first.
        expect(sealed.list.map((row) => row.createdAt)).toEqual([...sealed.list.map((row) => row.createdAt)].sort());
        expect(CaseView.safeParse(view).success).toBe(true);
      });
    });

    test("content that was erased since is withheld by the database's one predicate: the snapshot carries its id, time and digest and nothing else", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId));
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${p.postId}::uuid`);
        const view = await readCase(deps, sessionOf(mod), caseId);
        expect(view.snapshots).toHaveLength(1);
        expect(Object.keys(view.snapshots[0]!).sort()).toEqual(["digest", "id", "takenAt", "withheld"]);
        expect(view.snapshots[0]!.withheld).toBe(true);
        expect(JSON.stringify(view)).not.toContain("a post");
      }, migrateDb);
    });
  });

  describe("recusal", () => {
    test("a person too close to the case's subject is refused the case, its images, its snapshots and its texts, on a report's case and on a finding's case alike, with nothing logged or stored; a case that only a reporter close to them reported is not refused", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        await staffProfile(tx, { id: linked });
        // The linked account's own post, and its profile.
        const own = await imagePost(tx, 1, linked);
        const postCase = (await report(tx, aPost(own.postId))).caseId;
        const accountCase = (await report(tx, anAccount(linked))).caseId;
        // An account the linked account follows.
        const followed = await imagePost(tx, 0);
        await tx.execute(sql`insert into follows (follower_id, followee_id) values (${linked}::uuid, ${followed.authorId}::uuid)`);
        const followedCase = (await report(tx, aPost(followed.postId))).caseId;
        // A case that no report opened: another moderator's own finding about a second post of the linked account.
        const found = await imagePost(tx, 0, linked);
        const findingCase = (await openFinding(deps, sessionOf(other), { target: { kind: "post", id: found.postId }, ground: "rule", ruleId: "R1", category: TC })).caseId;
        const session = sessionOf(mod);
        for (const caseId of [postCase, accountCase, followedCase, findingCase]) {
          expect(await refusal(readCase(deps, session, caseId)), "case").toBe("staff_recused");
          expect(await refusal(caseImage(deps, session, caseId, own.mediaIds[0]!, "small")), "image").toBe("staff_recused");
          expect(await refusal(takeSnapshot(deps, session, caseId)), "snapshot").toBe("staff_recused");
          expect(await refusal(save(deps, mod, caseId, "note", "a note")), "text").toBe("staff_recused");
          expect(await refusal(ownTexts(deps, session, caseId)), "texts").toBe("staff_recused");
        }
        expect(await accessRows(tx, mod.id, "case_opened")).toBe(0);
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(0);
        expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where author_id = ${mod.id}::uuid`))[0]!.n).toBe(0);
        // Another staff member opens them.
        expect((await readCase(deps, sessionOf(other), postCase)).id).toBe(postCase);
        expect((await readCase(deps, sessionOf(other), findingCase)).id).toBe(findingCase);

        // A case the linked account reported, about a stranger: the read is not refused, since the check never looks at
        // who reported.
        const stranger = await imagePost(tx, 0);
        const reported = (await intake(tx, ground.rule(linked, "R1"), aPost(stranger.postId))).items[0]!.caseId!;
        expect((await readCase(deps, session, reported)).id).toBe(reported);
      });
    });

    test("what a subject did towards the person's linked account refuses nothing: a subject who follows it, blocks it or replied to a post of it has their case opened and decided by that person; what the linked account did towards the subject does", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        await staffProfile(tx, { id: linked });
        const linkedPost = await newPostRow(tx, linked);
        const session = sessionOf(mod);
        // Anyone can follow, block or answer anyone: one click must not put an account beyond a staff member.
        const towards: [string, (subjectId: string) => Promise<unknown>][] = [
          ["follows", (subjectId) => tx.execute(sql`insert into follows (follower_id, followee_id) values (${subjectId}::uuid, ${linked}::uuid)`)],
          ["blocks", (subjectId) => tx.execute(sql`insert into blocks (blocker_id, blocked_id) values (${subjectId}::uuid, ${linked}::uuid)`)],
          ["replied to", (subjectId) => newPostRow(tx, subjectId, { replyToId: linkedPost })],
        ];
        for (const [what, did] of towards) {
          const subject = await imagePost(tx, 0);
          await did(subject.authorId);
          // The case is about another post of the subject than a reply to the linked account.
          const { caseId } = await report(tx, aPost(subject.postId));
          expect((await readCase(deps, session, caseId)).id, what).toBe(caseId);
          expect(await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] }), what).toEqual(expect.any(String));
          expect((await readCase(deps, session, caseId)).decisions, what).toHaveLength(1);
        }
        expect(await accessRows(tx, mod.id, "case_opened")).toBe(6);
        // The other way round it counts: the linked account replied to a post of the subject.
        const answered = await imagePost(tx, 0);
        await newPostRow(tx, linked, { replyToId: answered.postId });
        const { caseId } = await report(tx, aPost(answered.postId));
        expect(await refusal(readCase(deps, session, caseId))).toBe("staff_recused");
        // And so does the post the case judges: a case about the very reply to the linked account's post is not theirs to
        // open, though a case about anything else its author wrote is.
        const replier = await profile(tx);
        const reply = await newPostRow(tx, replier.id, { replyToId: linkedPost });
        const replyCase = (await report(tx, aPost(reply))).caseId;
        expect(await refusal(readCase(deps, session, replyCase))).toBe("staff_recused");
        expect((await readCase(deps, sessionOf(other), replyCase)).target).toMatchObject({ type: "post", id: reply });
        expect(await accessRows(tx, mod.id, "case_opened")).toBe(6);
      });
    });
  });

  describe("the access log and the day's limit", () => {
    test("a person who has opened as many different cases as the day allows is refused every other case, with nothing written, and every staff account is told once; a case already opened today is never refused; a snapshot at the limit answers its id and no content", async () => {
      await inWorld(async (tx) => {
        const { deps, mailed } = world(tx);
        await tx.execute(sql`update moderation_limits set case_opens_per_day = 2 where id = 1`);
        const cases: string[] = [];
        for (let i = 0; i < 4; i++) cases.push((await report(tx, aPost((await imagePost(tx, 0)).postId))).caseId);
        const session = sessionOf(mod);
        await readCase(deps, session, cases[0]!);
        await readCase(deps, session, cases[1]!);
        // Two different cases today: the third is refused, and so is the fourth.
        const refused = await readCase(deps, session, cases[2]!).catch((err: unknown) => err as { code: string; status: number; retryAfterSeconds?: number });
        expect(refused).toMatchObject({ code: "rate_limited", status: 429 });
        expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
        expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeLessThanOrEqual(86_400);
        expect(await refusal(readCase(deps, session, cases[3]!))).toBe("rate_limited");
        expect(await accessRows(tx, mod.id, "case_opened", cases[2]!)).toBe(0);
        expect(await accessRows(tx, mod.id, "case_opened", cases[3]!)).toBe(0);
        // A case opened earlier today is read again, as often as the page reloads.
        expect((await readCase(deps, session, cases[0]!)).id).toBe(cases[0]);
        expect(await accessRows(tx, mod.id, "case_opened", cases[0]!)).toBe(2);
        // The snapshot route answers an id and a digest and nothing else, also for a case not opened today.
        const taken = await takeSnapshot(deps, session, cases[2]!);
        expect(Object.keys(taken).sort()).toEqual(["digest", "id"]);
        expect(await refusal(readCase(deps, session, cases[2]!))).toBe("rate_limited");
        expect(await accessRows(tx, mod.id, "case_opened", cases[2]!)).toBe(0);
        // Every staff account is mailed once that day, however often the person is refused.
        await deps.background.settle();
        expect(mailed).toEqual([{ template: "moderation_reads", handle: await handleOf(tx, mod.id), limit: 2 }]);
        // Another staff account has its own day.
        expect((await readCase(deps, sessionOf(other), cases[2]!)).id).toBe(cases[2]);
      }, migrateDb);
    });

    test("when no address took the mail, the next refused read sends it again", async () => {
      await inWorld(async (tx) => {
        const attempts: StaffMessage[] = [];
        let accepted = 0;
        const auth = {
          mailStaff: async (message: StaffMessage) => {
            attempts.push(message);
            return accepted;
          },
        } as unknown as AuthForModeration;
        const deps = moderationDeps(tx, { auth });
        await tx.execute(sql`update moderation_limits set case_opens_per_day = 0 where id = 1`);
        const { caseId } = await report(tx, aPost((await imagePost(tx, 0)).postId));
        expect(await refusal(readCase(deps, sessionOf(mod), caseId))).toBe("rate_limited");
        await deps.background.settle();
        accepted = 2;
        expect(await refusal(readCase(deps, sessionOf(mod), caseId))).toBe("rate_limited");
        await deps.background.settle();
        expect(await refusal(readCase(deps, sessionOf(mod), caseId))).toBe("rate_limited");
        await deps.background.settle();
        expect(attempts.map((message) => message.template)).toEqual(["moderation_reads", "moderation_reads"]);
      }, migrateDb);
    });
  });

  describe("images in the console (gate V, the console route's half of the readers)", () => {
    /** Writes the two files of each ready image as the worker would: WebP headers that state the sizes of their rows. */
    function webp(h: MediaHarness, ids: readonly string[]) {
      for (const id of ids) {
        writeFileSync(h.files.store.image(id, "large"), webpBytes("VP8X", 2048, 1536, `large of ${id}`));
        writeFileSync(h.files.store.image(id, "small"), webpBytes("VP8 ", 1024, 768, `small of ${id}`));
      }
    }
    /** What the image route's flow answers, with the file it opened closed again: its size, or the refusal's code. */
    async function view(deps: ModerationDeps, staff: TestStaff, caseId: string, mediaId: string, size: "small" | "large" = "small"): Promise<number | string | null> {
      try {
        const file = await caseImage(deps, sessionOf(staff), caseId, mediaId, size);
        await file.handle.close();
        return file.size;
      } catch (err) {
        return refusal(Promise.reject(err));
      }
    }
    const storeWorld = (tx: DbTx, h: MediaHarness) => world(tx, { media: mediaForCases(h.deps) });

    test("an image of the case's own post is served in either size and logged; an image of another post, an account's case and an unknown case answer the same refusal and log nothing", async () => {
      await withStore(async (tx, h) => {
        const { deps } = storeWorld(tx, h);
        const author = await h.established();
        const [p, elsewhere] = [await h.postWithImages(author.id, 2), await h.postWithImages(author.id, 1)];
        webp(h, [...p.mediaIds, ...elsewhere.mediaIds]);
        const postCase = (await report(tx, aPost(p.postId))).caseId;
        const accountCase = (await report(tx, anAccount(author.id, author.handle))).caseId;

        expect(await view(deps, mod, postCase, p.mediaIds[0]!, "small")).toBe(webpBytes("VP8 ", 1024, 768, `small of ${p.mediaIds[0]}`).length);
        expect(await view(deps, mod, postCase, p.mediaIds[1]!, "large")).toBe(webpBytes("VP8X", 2048, 1536, `large of ${p.mediaIds[1]}`).length);
        expect(await accessRows(tx, mod.id, "image_viewed", postCase)).toBe(2);
        const [logged] = await tx.execute<{ media_id: string }>(sql`select media_id from case_access_log where kind = 'image_viewed' and case_id = ${postCase}::uuid order by id limit 1`);
        expect(logged!.media_id).toBe(p.mediaIds[0]);

        // Not this case's image, an account's case (which shows no image), an image nobody has, a case nobody has.
        expect(await view(deps, mod, postCase, elsewhere.mediaIds[0]!)).toBe("image_refused");
        expect(await view(deps, mod, accountCase, p.mediaIds[0]!)).toBe("image_refused");
        expect(await view(deps, mod, postCase, randomUUID())).toBe("image_refused");
        expect(await view(deps, mod, randomUUID(), p.mediaIds[0]!)).toBe("not_found");
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(2);
        // The overview counts the day's views by staff handle.
        expect((await overview(deps)).imagesToday).toContainEqual({ handle: await handleOf(tx, mod.id), count: 2 });
      });
    });

    test("an image that no unerased snapshot of the case lists is refused before the media module is asked: another post's image and an unknown id open no file; the case's own image is asked for, and an image the media module answers for another post is refused with its file closed", async () => {
      await withStore(async (tx, h) => {
        const real = mediaForCases(h.deps);
        const asked: string[] = [];
        /** The post the media module's answer names, when a step of the test replaces it. */
        let answeredPost: string | null = null;
        const opened: { handle: { fd: number } }[] = [];
        const media: MediaForCases = {
          ...real,
          staffImage: async (mediaId, size) => {
            asked.push(mediaId);
            const image = await real.staffImage(mediaId, size);
            if (!image) return null;
            opened.push(image.file);
            return answeredPost === null ? image : { ...image, postId: answeredPost };
          },
        };
        const { deps } = world(tx, { media });
        const author = await h.established();
        const [p, elsewhere] = [await h.postWithImages(author.id, 1), await h.postWithImages(author.id, 1)];
        webp(h, [...p.mediaIds, ...elsewhere.mediaIds]);
        const image = p.mediaIds[0]!;
        const served = webpBytes("VP8 ", 1024, 768, `small of ${image}`).length;
        const postCase = (await report(tx, aPost(p.postId))).caseId;
        await report(tx, aPost(elsewhere.postId));

        // Neither is listed by a snapshot of this case: the refusal comes before any file is looked for, so an id that
        // names nothing and one that names another post's image take the same steps.
        expect(await view(deps, mod, postCase, elsewhere.mediaIds[0]!)).toBe("image_refused");
        expect(await view(deps, mod, postCase, randomUUID())).toBe("image_refused");
        expect(asked).toEqual([]);
        // The case's own image, in either spelling of its id.
        expect(await view(deps, mod, postCase, image)).toBe(served);
        expect(await view(deps, mod, postCase, image.toUpperCase())).toBe(served);
        expect(asked).toEqual([image, image]);
        // The comparison after the call stays: an answer that names another post is refused, and the file it opened is closed.
        answeredPost = elsewhere.postId;
        expect(await view(deps, mod, postCase, image)).toBe("image_refused");
        expect(opened).toHaveLength(3);
        expect(opened[2]!.handle.fd).toBe(-1);
        answeredPost = null;
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(2);

        // The case's evidence is erased, as the retention job will erase it: its snapshot lists nothing any more.
        await tx.execute(sql`update evidence_snapshots set erased_at = now(), body = null, media = null, display_name = null, bio = null, salt = null where case_id = ${postCase}::uuid`);
        expect(await view(deps, mod, postCase, image)).toBe("image_refused");
        expect(asked).toHaveLength(3);
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(2);
      }, migrateDb);
    });

    test("an erased image, and an image of a post whose content was erased, is served to nobody: one refusal, and nothing logged", async () => {
      await withStore(async (tx, h) => {
        const { deps } = storeWorld(tx, h);
        const author = await h.established();
        const [one, two] = [await h.postWithImages(author.id, 2), await h.postWithImages(author.id, 1)];
        webp(h, [...one.mediaIds, ...two.mediaIds]);
        const [caseOne, caseTwo] = [(await report(tx, aPost(one.postId))).caseId, (await report(tx, aPost(two.postId))).caseId];
        // Only the migrator's erasure sets either mark. The image's own row is erased: the other image of the post is served.
        await tx.execute(sql`update post_media set erased_at = now() where id = ${one.mediaIds[0]!}::uuid`);
        expect(await view(deps, mod, caseOne, one.mediaIds[0]!)).toBe("image_refused");
        expect(await view(deps, admin, caseOne, one.mediaIds[0]!, "large")).toBe("image_refused");
        expect(await view(deps, mod, caseOne, one.mediaIds[1]!)).toBe(webpBytes("VP8 ", 1024, 768, `small of ${one.mediaIds[1]}`).length);
        // The post's content is erased: none of its images is served, though its files are still in the store.
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${two.postId}::uuid`);
        expect(await view(deps, mod, caseTwo, two.mediaIds[0]!)).toBe("image_refused");
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(1);
        expect(await accessRows(tx, admin.id, "image_viewed")).toBe(0);
      }, migrateDb);
    });

    test("while a suspect item about the post, about its author's account or about a post that quotes it is unanswered, no staff member is served its images on any case, open or closed; after an admin's answer without a seal they are served again, and the case says on which day staff last looked", async () => {
      await withStore(async (tx, h) => {
        const { deps } = storeWorld(tx, h);
        const author = await h.established();
        const p = await h.postWithImages(author.id, 1);
        webp(h, p.mediaIds);
        const image = p.mediaIds[0]!;
        const served = webpBytes("VP8 ", 1024, 768, `small of ${image}`).length;

        // A closed R1 case about the post, which served its image while it was open.
        const closedCase = (await report(tx, aPost(p.postId))).caseId;
        expect(await view(deps, mod, closedCase, image)).toBe(served);
        await decideIn(tx, mod, closedCase, NO_SEAL);

        // (1) The post's own suspect item: refused on the suspicion's case and on the closed case about the post.
        const own = (await report(tx, aPost(p.postId), "csam")).caseId;
        expect(await postFrozen(tx, p.postId)).toBe(true);
        expect(await view(deps, mod, own, image)).toBe("image_refused");
        expect(await view(deps, mod, closedCase, image)).toBe("image_refused");
        expect(await view(deps, admin, own, image, "large")).toBe("image_refused");
        expect((await readCase(deps, sessionOf(mod), closedCase)).imagesAllowed).toBe(false);
        await decideIn(tx, admin, own, NO_SEAL);
        expect(await view(deps, mod, closedCase, image)).toBe(served);

        // (2) Its author's account's suspect item: refused on the post's own open case, which holds no suspect item, and
        // on the closed ones.
        const openCase = (await report(tx, aPost(p.postId), "rule", "R3")).caseId;
        expect(await view(deps, mod, openCase, image)).toBe(served);
        const account = (await report(tx, anAccount(author.id, author.handle), "csam")).caseId;
        for (const caseId of [openCase, closedCase, own]) expect(await view(deps, mod, caseId, image), caseId).toBe("image_refused");
        expect(await view(deps, mod, account, image)).toBe("image_refused");
        await decideIn(tx, admin, account, NO_SEAL);
        expect(await view(deps, mod, openCase, image)).toBe(served);

        // (3) An item korbat added because a reported post quotes this one: it joins the post's open case.
        const quotingPost = await newPostRow(tx, (await profile(tx)).id, { quoteOfId: p.postId });
        const recorded = await intake(tx, ground.csam(), aPost(quotingPost));
        expect(recorded.items.find((item) => item.position === 11)!.caseId).toBe(openCase);
        expect(await view(deps, mod, openCase, image)).toBe("image_refused");
        expect(await view(deps, mod, closedCase, image)).toBe("image_refused");
        // Only an admin answers it; the rule report of the same case that arrived before it is answered with it.
        await decideIn(tx, admin, openCase, NO_SEAL);
        expect(await view(deps, mod, openCase, image)).toBe(served);

        // What records that staff looked: the day of the newest view on any case about the post, shown with the suspicion.
        const today = new Date().toISOString().slice(0, 10);
        const answered = await readCase(deps, sessionOf(mod), own);
        expect(answered.suspicion?.earlier.target).toEqual({ count: 2, lastOn: today, imagesOpenedOn: today });
        // An account's case never says so: the console shows no image of an account.
        expect((await readCase(deps, sessionOf(mod), account)).suspicion?.earlier.target.imagesOpenedOn).toBeNull();
        // Refusals logged nothing: one row for each view that was served.
        expect(await accessRows(tx, mod.id, "image_viewed")).toBe(5);
      });
    });

    test("a sealed image is served to no staff member on any case, while deciding and for good, whatever became of the case", async () => {
      await withStore(async (tx, h) => {
        const { deps } = storeWorld(tx, h);
        const author = await h.established();
        const p = await h.postWithImages(author.id, 1);
        webp(h, p.mediaIds);
        const image = p.mediaIds[0]!;
        const closedCase = (await report(tx, aPost(p.postId))).caseId;
        await decideIn(tx, mod, closedCase, NO_SEAL);
        const suspectCase = (await report(tx, aPost(p.postId), "csam")).caseId;
        await decideIn(tx, mod, suspectCase, SEAL_WHILE_DECIDING);
        for (const caseId of [suspectCase, closedCase]) expect(await view(deps, admin, caseId, image), "while deciding").toBe("image_refused");
        await decideIn(tx, admin, suspectCase, SEAL_FOR_GOOD);
        // The case is closed and the seal stands: an open R1 case about the post shows no image either.
        const later = (await report(tx, aPost(p.postId))).caseId;
        for (const caseId of [suspectCase, closedCase, later]) expect(await view(deps, admin, caseId, image), "for good").toBe("image_refused");
        expect((await readCase(deps, sessionOf(admin), later)).imagesAllowed).toBe(false);
        expect(await accessRows(tx, admin.id, "image_viewed")).toBe(0);
      });
    });
  });

  describe("a fresh snapshot", () => {
    test("is taken when the target differs from the case's newest one, and answers that one's id when nothing differed; a stored snapshot recomputes to its digest", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const subject = await profile(tx);
        const { caseId } = await report(tx, anAccount(subject.id, subject.handle));
        const session = sessionOf(mod);
        const first = (await readCase(deps, session, caseId)).snapshots[0]!;
        // Nothing changed: the newest snapshot's own id and digest.
        expect(await takeSnapshot(deps, session, caseId)).toEqual({ id: first.id, digest: first.digest });
        // The account sets another bio: a new snapshot, which the case then carries first.
        await tx.execute(sql`update profiles set bio = 'a new bio' where id = ${subject.id}::uuid`);
        const taken = await takeSnapshot(deps, session, caseId);
        expect(taken.id).not.toBe(first.id);
        const view = await readCase(deps, session, caseId);
        expect(view.snapshots.map((snapshot) => snapshot.id)).toEqual([taken.id, first.id]);
        const newest = view.snapshots[0]!;
        if (newest.withheld) throw new Error("the snapshot is shown");
        expect(newest).toMatchObject({ targetType: "account", bio: "a new bio", handle: subject.handle, body: null, media: null, digest: taken.digest });
        expect(await snapshotDigest(newest)).toBe(taken.digest);
        expect(await takeSnapshot(deps, session, caseId)).toEqual(taken);
      });
    });

    test("of a post its author deleted since is a tombstone, and a case whose newest snapshot is withheld gets one without content", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId));
        const session = sessionOf(mod);
        await authorDeletes(tx, p.postId);
        const tombstone = await takeSnapshot(deps, session, caseId);
        let newest = (await readCase(deps, session, caseId)).snapshots[0]!;
        if (newest.withheld) throw new Error("the snapshot is shown");
        // The image row is kept by the case's hold, so the tombstone still lists it.
        expect(newest).toMatchObject({ id: tombstone.id, postState: "deleted_by_author", body: "", media: [expect.objectContaining({ id: p.mediaIds[0] })] });
        expect(await snapshotDigest(newest)).toBe(tombstone.digest);

        // The post's content is erased: both snapshots that held content are withheld, and a fresh one holds none.
        await tx.execute(sql`update posts set erased_at = now() where id = ${p.postId}::uuid`);
        expect((await readCase(deps, session, caseId)).snapshots.map((snapshot) => snapshot.withheld)).toEqual([true, true]);
        const empty = await takeSnapshot(deps, session, caseId);
        newest = (await readCase(deps, session, caseId)).snapshots[0]!;
        if (newest.withheld) throw new Error("a snapshot taken after the erasure holds no content and is shown");
        expect(newest).toMatchObject({ id: empty.id, body: "", media: [expect.objectContaining({ alt: null })] });
        expect(await takeSnapshot(deps, session, caseId)).toEqual(empty);
      }, migrateDb);
    });

    test("is run again when its transaction meets a deadlock or a lock timeout, as an intake's is, up to three times; when the last run fails the same way the answer is case_closed; any other failure is not run again", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const subject = await profile(tx);
        const { caseId } = await report(tx, anAccount(subject.id, subject.handle));
        const session = sessionOf(mod);
        /** The module's pool with a transaction that gives way with this SQLSTATE for its first `failures` runs. */
        function givingWay(code: string, failures: number) {
          let runs = 0;
          const transaction = ((...args: Parameters<Db["transaction"]>) => {
            if (++runs <= failures) return Promise.reject(Object.assign(new Error("the statement failed"), { cause: Object.assign(new Error("PostgreSQL gave way"), { code }) }));
            // On the test's own transaction a transaction of the module is a savepoint.
            return (tx as unknown as Db).transaction(...args);
          }) as Db["transaction"];
          return { apiDb: Object.assign(Object.create(tx) as Db, { transaction }), runs: () => runs };
        }
        for (const code of ["40P01", "55P03"]) {
          const never = givingWay(code, Number.POSITIVE_INFINITY);
          const refused = await takeSnapshot({ ...deps, apiDb: never.apiDb }, session, caseId).catch((err: unknown) => err as { code: string; status: number });
          expect(refused, code).toMatchObject({ code: "case_closed", status: 409 });
          // The first run and three more.
          expect(never.runs(), code).toBe(4);
        }
        // Three runs give way and the fourth goes through: the changed account gets its fresh snapshot.
        await tx.execute(sql`update profiles set bio = 'a new bio' where id = ${subject.id}::uuid`);
        const before = (await readCase(deps, session, caseId)).snapshots[0]!.id;
        const late = givingWay("40P01", 3);
        const taken = await takeSnapshot({ ...deps, apiDb: late.apiDb }, session, caseId);
        expect(late.runs()).toBe(4);
        expect(taken.id).not.toBe(before);
        expect((await readCase(deps, session, caseId)).snapshots.map((snapshot) => snapshot.id)).toEqual([taken.id, before]);
        // A failure of another kind is the caller's to see, at once.
        const broken = givingWay("23505", 1);
        await expect(takeSnapshot({ ...deps, apiDb: broken.apiDb }, session, caseId)).rejects.toThrow("the statement failed");
        expect(broken.runs()).toBe(1);
      });
    });

    test("that meets a decision on its case in the opposite order of locks gives way and is taken again: the decision commits, the snapshot copies the post as the decision left it, and neither is refused", async () => {
      // A decision that commits is confirmed by a real key, and a second session must see the post: everything here
      // commits and is removed again; the decision's audit row stays, as the record does.
      const decider = deciderWorld(apiDb);
      const [author, reporter] = [await newProfile(apiDb), await newProfile(apiDb)];
      try {
        const staff = await decider.staff("admin");
        const postId = await newPostRow(apiDb, author.id);
        const caseId = (await recordIntake(decider.moderation.deps, { ground: ground.rule(reporter.id), live: [aPost(postId)] })).items[0]!.caseId!;
        // The target changes after the report: its author takes another handle. A fresh snapshot is then a new row, and
        // the row's insert needs the case's row.
        const renamed = `re_${randomUUID().slice(0, 8)}`;
        await apiDb.execute(sql`update profiles set handle = ${renamed} where id = ${author.id}::uuid`);
        const confirmed = await decider.confirm(staff, caseId, await decisionParams(apiDb, staff, caseId, { kind: "interim", actions: [act("withhold")] }));
        const [timeout] = await apiDb.execute<{ ms: number }>(sql`select setting::int as ms from pg_settings where name = 'deadlock_timeout'`);

        // The snapshot's first run is stopped once it has locked the post, before its first statement that needs the case.
        const [locked, goOn] = [gate(), gate()];
        let runs = 0;
        const transaction = ((...args: Parameters<Db["transaction"]>) => {
          runs++;
          return apiDb.transaction(...args);
        }) as Db["transaction"];
        const { media, social } = decider.moderation.deps;
        let holds = 0;
        const stopping: MediaForCases = {
          ...media,
          hold: async (holdTx, pairs) => {
            if (++holds === 1) {
              locked.open();
              await goOn.opened;
            }
            return media.hold(holdTx, pairs);
          },
        };
        const settled = <T>(promise: Promise<T>) => promise.then((value) => value as unknown, (err: unknown) => err);
        const snapping = settled(takeSnapshot({ apiDb: Object.assign(Object.create(apiDb) as Db, { transaction }), social, media: stopping }, staff.session, caseId));
        await locked.opened;
        // The decision takes the case's row and then waits for the post, which the snapshot's transaction holds.
        const deciding = settled(decider.moderation.forStaff.decide(staff.session, confirmed, { requestId: `req-${randomUUID()}` }));
        try {
          await untilBlocked(apiDb, "insert into decision_actions");
          // PostgreSQL looks for a deadlock once, this long after a wait begins. The decision's look is over by now and
          // found none; the snapshot comes to wait for the case's row after it, finds the cycle, and is the one to give way.
          await new Promise((resolve) => setTimeout(resolve, timeout!.ms + 500));
        } finally {
          goOn.open();
        }
        const [taken, decided] = await Promise.all([snapping, deciding]);
        expect(decided).toEqual({ decisionId: expect.any(String) });
        expect(taken).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
        // The run that gave way, and the one that waited for the decision's commit.
        expect(runs).toBe(2);
        const stored = await apiDb.execute<{ id: string; post_state: string; author_handle: string }>(sql`select id, post_state, author_handle from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc`);
        expect(stored).toHaveLength(2);
        expect({ ...stored[0]! }).toEqual({ id: (taken as { id: string }).id, post_state: "withheld", author_handle: renamed });
      } finally {
        await removeFixtures(migrateDb, [author.id, reporter.id]);
        await decider.close();
      }
    });
  });

  describe("saved texts", () => {
    test("a note and a recorded choice not to seal are complete when saved and listed on the case with their writer's handle; every other kind is the person's own draft until a decision names it", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const { caseId } = await report(tx, aPost((await imagePost(tx, 1)).postId), "csam");
        const note = await save(deps, mod, caseId, "note", "Art. 18 check: no suspicion");
        const declined = await save(deps, other, caseId, "seal_declined", "The report repeats the one answered yesterday.");
        const facts = await save(deps, mod, caseId, "facts", "The post names the home address of another person.");
        const reason = await save(deps, mod, caseId, "reveal_reason", "The notifier claims to be impersonated.");
        await save(deps, other, caseId, "reason", "Another person's draft.");

        const view = await readCase(deps, sessionOf(mod), caseId);
        expect(view.notes).toEqual([{ id: note.id, staffHandle: await handleOf(tx, mod.id), createdAt: expect.any(String), text: "Art. 18 check: no suspicion" }]);
        expect(view.sealsDeclined).toEqual([{ id: declined.id, staffHandle: await handleOf(tx, other.id), createdAt: expect.any(String), text: "The report repeats the one answered yesterday." }]);
        // The person's own drafts, with their salts, each recomputing to its digest; never another person's.
        expect(view.drafts.map((draft) => `${draft.kind} ${draft.id}`).sort()).toEqual([`facts ${facts.id}`, `reveal_reason ${reason.id}`]);
        for (const draft of view.drafts) expect(await textDigest(draft.salt, draft.text)).toBe(draft.digest);
        expect(await ownTexts(deps, sessionOf(mod), caseId)).toEqual({ texts: view.drafts });
        expect((await ownTexts(deps, sessionOf(other), caseId)).texts.map((draft) => draft.kind)).toEqual(["reason"]);
        expect(view.history.map((entry) => entry.event)).toEqual(expect.arrayContaining(["note", "seal_declined"]));
        // A decision that names the facts confirms them: they are no draft any more.
        const factsDigest = facts.digest;
        await decideIn(tx, mod, caseId, { kind: "interim", ruleId: "R1", actions: [act("withhold")], factsDigest });
        expect((await ownTexts(deps, sessionOf(mod), caseId)).texts.map((draft) => draft.kind)).toEqual(["reveal_reason"]);
        expect((await readCase(deps, sessionOf(mod), caseId)).decisions[0]).toMatchObject({ facts: "The post names the home address of another person." });
      });
    });

    test("no text is saved empty, whatever its kind: a text of nothing or of white space alone is refused as an invalid request, and nothing is stored", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const { caseId } = await report(tx, aPost((await imagePost(tx, 0)).postId));
        const LF = String.fromCharCode(10);
        const NBSP = String.fromCharCode(0xa0);
        for (const kind of STAFF_TEXT_KINDS) {
          for (const text of ["", " ", `  ${LF} ${NBSP}${LF}`]) {
            const refused = await save(deps, mod, caseId, kind, text).catch((err: unknown) => err as { code: string; status: number });
            expect(refused, `${kind}: ${JSON.stringify(text)}`).toMatchObject({ code: "invalid_request", status: 400 });
          }
        }
        expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where case_id = ${caseId}::uuid`))[0]!.n).toBe(0);
        // A reason of one word is one.
        expect((await save(deps, mod, caseId, "reveal_reason", " Impersonation. ")).digest).toMatch(/^[0-9a-f]{64}$/);
      });
    });

    test("a text is stored as written or refused: text_invalid for a text no rule allows or a digest that does not match, text_quotes_user for a quote of what someone wrote on the case, and nothing is stored either way", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const reporter = await profile(tx);
        const theirs = "He posted my home address and my phone number to hurt me.";
        const p = await imagePost(tx, 0);
        const caseId = (await intake(tx, { ...ground.illegal(reporter.id), explanation: theirs, citedLaw: "Article 8 of the Charter of Fundamental Rights of the Union" }, aPost(p.postId))).items[0]!.caseId!;
        const stored = async () => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from staff_texts where case_id = ${caseId}::uuid`))[0]!.n;
        const session = sessionOf(mod);

        const refusals: Record<string, string | null> = {};
        refusals["a control character"] = await refusal(save(deps, mod, caseId, "facts", `a${String.fromCharCode(7)}b`));
        refusals["an invisible direction character"] = await refusal(save(deps, mod, caseId, "note", `a${String.fromCharCode(0x202e)}b`));
        refusals["5001 units"] = await refusal(save(deps, mod, caseId, "reason", "x".repeat(5001)));
        refusals["another text's digest"] = await refusal(saveText(deps, session, caseId, { kind: "facts", text: "The facts.", salt: hex64(), digest: hex64() }));
        refusals["a quote of the explanation"] = await refusal(save(deps, mod, caseId, "facts", `The reporter says: ${theirs}`));
        refusals["a quote of the cited law, in other case and spacing"] = await refusal(save(deps, mod, caseId, "reveal_reason", "see ARTICLE 8 OF THE   CHARTER OF FUNDAMENTAL RIGHTS of the union"));
        expect(refusals).toEqual({
          "a control character": "text_invalid",
          "an invisible direction character": "text_invalid",
          "5001 units": "text_invalid",
          "another text's digest": "text_invalid",
          "a quote of the explanation": "text_quotes_user",
          "a quote of the cited law, in other case and spacing": "text_quotes_user",
        });
        expect(await stored()).toBe(0);

        // A note may quote: it stays with staff. A paraphrase is no quote. 5000 units fit.
        await save(deps, mod, caseId, "note", `The reporter says: ${theirs}`);
        await save(deps, mod, caseId, "facts", "The post names the home address and the phone number of another person.");
        await save(deps, mod, caseId, "reason", "x".repeat(5000));
        expect(await stored()).toBe(3);
        // The same save sent again answers the row already stored; the same digest from another person is refused.
        const salt = hex64();
        const request = { kind: "facts" as const, text: "Sent twice.", salt, digest: await textDigest(salt, "Sent twice.") };
        const once = await saveText(deps, session, caseId, request);
        expect(await saveText(deps, session, caseId, request)).toEqual(once);
        expect(await refusal(saveText(deps, sessionOf(other), caseId, request))).toBe("text_invalid");
        expect(await stored()).toBe(4);
        expect(await refusal(save(deps, mod, randomUUID(), "note", "a note"))).toBe("not_found");
      });
    });

    test("one staff account saves at most 60 texts a minute", async () => {
      await inWorld(async (tx) => {
        const limits = new MemoryStore();
        const { deps } = world(tx, { limits });
        const { caseId } = await report(tx, aPost((await imagePost(tx, 0)).postId));
        expect(TEXT_SAVES_PER_MINUTE).toBe(60);
        for (let i = 0; i < TEXT_SAVES_PER_MINUTE - 1; i++) await limits.hit(`staff-text:${mod.id}`, 60_000);
        await save(deps, mod, caseId, "note", "the sixtieth");
        const refused = await save(deps, mod, caseId, "note", "the sixty-first").catch((err: unknown) => err as { code: string; retryAfterSeconds?: number });
        expect(refused).toMatchObject({ code: "rate_limited" });
        expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
        // Another staff account has its own minute.
        await save(deps, other, caseId, "note", "another person's");
      });
    });
  });

  describe("a moderator's own finding", () => {
    const finding = (target: FindingRequest["target"], ruleId: FindingRequest["ruleId"] = "R1"): FindingRequest => ({ target, ground: "rule", ruleId, category: ruleId === "R2" ? MINORS : TC });
    const findingsOf = async (tx: DbTx, staffId: string) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from intakes where finding_by = ${staffId}::uuid`))[0]!.n;

    test("opens a case on a post or joins its open one, as a finding under its rule; a post, an account's handle and a korbat link name the target; a link to another site is refused", async () => {
      await inWorld(async (tx) => {
        const { deps, mailed } = world(tx);
        const p = await imagePost(tx, 1);
        const author = { id: p.authorId, handle: await handleOf(tx, p.authorId) };
        const origin = new URL(deps.config.APP_ORIGIN).origin;
        const { caseId } = await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: p.postId, mediaId: p.mediaIds[0] }, "R3"));
        // A second finding by another moderator through the post's link joins the same case.
        expect(await openFinding(deps, sessionOf(other), finding({ kind: "link", url: `${origin}/post/${p.postId}` }, "R1"))).toEqual({ caseId });
        const view = await readCase(deps, sessionOf(admin), caseId);
        expect(view.items.map((item) => [item.ruleId, item.source.kind, item.mediaId, item.allegesIllegal, item.explanation])).toEqual([
          ["R3", "staff", p.mediaIds[0], false, null],
          ["R1", "staff", null, false, null],
        ]);
        expect(view.lane).toBe(1);
        // An account, by its handle with or without the at sign, and by its profile's link.
        const byHandle = await openFinding(deps, sessionOf(mod), finding({ kind: "account", handle: author.handle }, "R6"));
        expect(await openFinding(deps, sessionOf(other), finding({ kind: "link", url: `${origin}/u/${author.handle}` }, "R6"))).toEqual(byHandle);
        expect((await readCase(deps, sessionOf(admin), byHandle.caseId)).target).toMatchObject({ type: "account", id: author.id, handle: author.handle });
        expect(await refusal(openFinding(deps, sessionOf(mod), finding({ kind: "link", url: "https://elsewhere.example/post/x" })))).toBe("notice_link_offsite");
        // None of these is in the urgent lane: no alert.
        await deps.background.settle();
        expect(mailed).toEqual([]);
        // The overview counts the day's findings by staff handle.
        const today = (await overview(deps)).findingsToday;
        expect(today).toContainEqual({ handle: await handleOf(tx, mod.id), count: 2 });
        expect(today).toContainEqual({ handle: await handleOf(tx, other.id), count: 2 });
      });
    });

    test("a target with nothing live is not_found, with nothing written and the day's count unchanged; citing R2, whatever is left of a deleted post, a purged account or an account under a handle it has left gets a case in the urgent lane that freezes its images and alerts staff", async () => {
      await inWorld(async (tx) => {
        const { deps, mailed } = world(tx);
        const session = sessionOf(mod);
        const deleted = await imagePost(tx, 1);
        await authorDeletes(tx, deleted.postId);
        const purged = await profile(tx);
        const purgedPost = await imagePost(tx, 1, purged.id);
        await tx.execute(sql`update profiles set deleted_at = now(), display_name = 'Deleted account', bio = '' where id = ${purged.id}::uuid`);
        const moved = await profile(tx);
        const movedPost = await imagePost(tx, 2, moved.id);
        const left = `old_${randomUUID().slice(0, 8)}`;
        await tx.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${left}, ${moved.id}::uuid, now())`);

        const dead: [string, FindingRequest["target"]][] = [
          ["a post nobody has", { kind: "post", id: randomUUID() }],
          ["a post its author deleted", { kind: "post", id: deleted.postId }],
          ["a deleted account", { kind: "account", handle: purged.handle }],
          ["a handle its account has left", { kind: "account", handle: left }],
          ["a handle nobody holds", { kind: "account", handle: "nobody_here_1" }],
        ];
        for (const [label, target] of dead) expect(await refusal(openFinding(deps, session, finding(target, "R1"))), label).toBe("not_found");
        expect(await findingsOf(tx, mod.id)).toBe(0);
        expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from cases where target_id = any(${`{${[deleted.postId, purged.id, moved.id].join(",")}}`}::uuid[])`))[0]!.n).toBe(0);
        await deps.background.settle();
        expect(mailed).toEqual([]);

        // The same targets under R2: each a case in the urgent lane that waits for an admin.
        const onDeleted = await openFinding(deps, session, finding({ kind: "post", id: deleted.postId }, "R2"));
        const onPurged = await openFinding(deps, session, finding({ kind: "account", handle: purged.handle }, "R2"));
        const onMoved = await openFinding(deps, session, finding({ kind: "account", handle: left }, "R2"));
        for (const { caseId } of [onDeleted, onPurged, onMoved]) expect(await readCase(deps, sessionOf(admin), caseId)).toMatchObject({ lane: 0, imagesAllowed: false, suspicion: { open: true } });
        // The case on the old handle is the account's, under the handle it holds now; its item shows the handle as named.
        const movedView = await readCase(deps, sessionOf(admin), onMoved.caseId);
        expect(movedView.target).toMatchObject({ type: "account", id: moved.id, handle: moved.handle });
        expect(movedView.items[0]).toMatchObject({ link: `${new URL(deps.config.APP_ORIGIN).origin}/u/${left}`, suspect: true, ruleId: "R2", source: { kind: "staff" } });
        expect(movedView.suspicion?.reach).toMatchObject({ posts: 1, images: 2 });
        for (const postId of [deleted.postId, purgedPost.postId, movedPost.postId]) expect(await postFrozen(tx, postId), postId).toBe(true);
        // But a post nobody has is no target under any rule.
        expect(await refusal(openFinding(deps, session, finding({ kind: "post", id: randomUUID() }, "R2")))).toBe("not_found");
        expect(await findingsOf(tx, mod.id)).toBe(3);
        // One alert for the urgent lane, throttled for the two findings after it.
        await deps.background.settle();
        expect(mailed.map((message) => message.template)).toEqual(["moderation_urgent"]);
      });
    });

    test("citing R2 on a post that quotes another, a finding gets the added item as a notice does: the answer carries the case of the post the finder named, that case links the quoted post's, both freeze, and it is one finding against the day's limit", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const quoted = await imagePost(tx, 2);
        const quoting = await imagePost(tx, 1, undefined, { quoteOfId: quoted.postId });
        const { caseId } = await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: quoting.postId }, "R2"));
        const named = await readCase(deps, sessionOf(admin), caseId);
        expect(named.target).toMatchObject({ type: "post", id: quoting.postId });
        expect(named.items).toHaveLength(1);
        const quotedCaseId = named.items[0]!.quotedCaseId;
        expect(named.items[0]).toMatchObject({ position: 1, ruleId: "R2", suspect: true, quotedByPosition: null, source: { kind: "staff" } });
        expect(quotedCaseId).toEqual(expect.any(String));
        expect(quotedCaseId).not.toBe(caseId);
        // The quoted post's case holds the item korbat added for it, under the same finding.
        const added = await readCase(deps, sessionOf(admin), quotedCaseId!);
        expect(added.target).toMatchObject({ type: "post", id: quoted.postId });
        expect(added.items).toEqual([expect.objectContaining({ position: 11, ruleId: "R2", suspect: true, quotedByPosition: 1, quotedCaseId: null, source: expect.objectContaining({ kind: "staff" }) })]);
        for (const view of [named, added]) expect(view).toMatchObject({ lane: 0, imagesAllowed: false, suspicion: { open: true } });
        expect(await postFrozen(tx, quoting.postId)).toBe(true);
        expect(await postFrozen(tx, quoted.postId)).toBe(true);
        // One intake with two items, both the finder's.
        expect(await findingsOf(tx, mod.id)).toBe(1);
        const [items] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from intake_items i join intakes k on k.id = i.intake_id where k.finding_by = ${mod.id}::uuid`);
        expect(items!.n).toBe(2);
        expect((await overview(deps)).findingsToday).toContainEqual({ handle: await handleOf(tx, mod.id), count: 1 });
      });
    });

    test("one staff account opens at most the day's limit of findings: the next is refused with nothing written, and another staff account's is accepted", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        await tx.execute(sql`update moderation_limits set findings_per_day = 2 where id = 1`);
        const posts = [await imagePost(tx, 0), await imagePost(tx, 0), await imagePost(tx, 0)];
        await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: posts[0]!.postId }));
        await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: posts[1]!.postId }));
        const refused = await openFinding(deps, sessionOf(mod), finding({ kind: "post", id: posts[2]!.postId })).catch((err: unknown) => err as { code: string; status: number; retryAfterSeconds?: number });
        expect(refused).toMatchObject({ code: "rate_limited", status: 429 });
        expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
        expect(await findingsOf(tx, mod.id)).toBe(2);
        expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from cases where target_id = ${posts[2]!.postId}::uuid`))[0]!.n).toBe(0);
        // The target is resolved before anything is counted: at the limit, a link that names nothing live, or another
        // site, is answered as on any other day, and only a finding that could be opened meets the limit.
        expect(await refusal(openFinding(deps, sessionOf(mod), finding({ kind: "post", id: randomUUID() })))).toBe("not_found");
        expect(await refusal(openFinding(deps, sessionOf(mod), finding({ kind: "account", handle: "nobody_here_1" })))).toBe("not_found");
        expect(await refusal(openFinding(deps, sessionOf(mod), finding({ kind: "link", url: "https://elsewhere.example/post/x" })))).toBe("notice_link_offsite");
        expect(await findingsOf(tx, mod.id)).toBe(2);
        await openFinding(deps, sessionOf(other), finding({ kind: "post", id: posts[2]!.postId }));
        const today = (await overview(deps)).findingsToday;
        expect(today).toContainEqual({ handle: await handleOf(tx, mod.id), count: 2 });
        expect(today).toContainEqual({ handle: await handleOf(tx, other.id), count: 1 });
      }, migrateDb);
    });
  });

  describe("the queue", () => {
    /** The queue's rows that are this test's own, in the queue's order, read page by page. */
    async function ownRows(deps: ModerationDeps, own: readonly string[]) {
      const found: QueuePage["cases"] = [];
      let cursor: string | undefined;
      for (let pages = 0; pages < 40; pages++) {
        const page = await queue(deps, cursor);
        expect(QueuePage.safeParse(page).success).toBe(true);
        found.push(...page.cases.filter((row) => own.includes(row.id)));
        if (page.nextCursor === null) return found;
        cursor = page.nextCursor;
      }
      throw new Error("the queue did not end");
    }
    const openedAgo = (tx: DbTx, caseId: string, ago: string) => tx.execute(sql`update cases set oldest_open_at = now() - ${ago}::interval where id = ${caseId}::uuid`);

    test("orders open cases by lane, then by their oldest unanswered item, and says of each what its unanswered items cite; a closed case is not in it", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const reporter = await profile(tx);
        const lane2Old = (await report(tx, aPost((await imagePost(tx, 0)).postId), "rule", "R1")).caseId;
        const lane2New = (await report(tx, anAccount((await profile(tx)).id), "rule", "R6")).caseId;
        const lane1 = (await report(tx, aPost((await imagePost(tx, 0)).postId), "rule", "R3")).caseId;
        const urgent = (await report(tx, aPost((await imagePost(tx, 1)).postId), "csam")).caseId;
        const mixedPost = await imagePost(tx, 0);
        const mixed = (await intake(tx, ground.rule(reporter.id, "R4"), aPost(mixedPost.postId))).items[0]!.caseId!;
        await intake(tx, ground.illegal(reporter.id), aPost(mixedPost.postId));
        const closed = (await report(tx, aPost((await imagePost(tx, 0)).postId), "rule", "R1")).caseId;
        await decideIn(tx, mod, closed, NO_SEAL);
        await openedAgo(tx, lane2Old, "3 days");
        await openedAgo(tx, lane2New, "2 hours");
        await openedAgo(tx, lane1, "1 hour");
        await openedAgo(tx, mixed, "5 hours");
        await openedAgo(tx, urgent, "10 minutes");

        const rows = await ownRows(deps, [lane2Old, lane2New, lane1, urgent, mixed, closed]);
        expect(rows.map((row) => row.id)).toEqual([urgent, mixed, lane1, lane2Old, lane2New]);
        expect(rows[0]).toMatchObject({ lane: 0, targetType: "post", openItems: 1, rules: [], categories: [MINORS], allegesIllegal: true, suspect: true, reexamination: false, deferred: false });
        expect(rows[1]).toMatchObject({ lane: 1, openItems: 2, rules: ["R4"], categories: ["STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH", TC], allegesIllegal: true, suspect: false });
        expect(rows[4]).toMatchObject({ lane: 2, targetType: "account", rules: ["R6"], allegesIllegal: false, suspect: false });
        // No row names a reporter, a count of reports per person or a weight.
        expect(Object.keys(rows[0]!).sort()).toEqual(["allegesIllegal", "categories", "deferred", "id", "lane", "oldestOpenAt", "openItems", "openedAt", "reexamination", "rules", "suspect", "targetType"]);
      }, migrateDb);
    });

    test("a page ends where the next begins: the cursor is the last row's sort key, and anything else for a cursor is refused", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const all = await queueRows(tx, { deferUnproven: false, after: null, limit: 1000 });
        const cases: string[] = [];
        for (let i = 0; i < 5; i++) cases.push((await report(tx, aPost((await imagePost(tx, 0)).postId), "rule", "R3")).caseId);
        // Two a page through the repository: every open case once, in one order, whatever the page's size.
        const paged: string[] = [];
        let after: Parameters<typeof queueRows>[1]["after"] = null;
        for (;;) {
          const page = await queueRows(tx, { deferUnproven: false, after, limit: 2 });
          paged.push(...page.map((row) => row.id));
          const last = page.at(-1);
          if (page.length < 2 || !last) break;
          after = { lane: last.lane, deferred: last.deferred, sortAt: last.sortAt, id: last.id };
        }
        const whole = (await queueRows(tx, { deferUnproven: false, after: null, limit: 1000 })).map((row) => row.id);
        expect(paged).toEqual(whole);
        expect(whole).toHaveLength(all.length + 5);
        expect(whole.filter((id) => cases.includes(id))).toHaveLength(5);
        // The route's page holds at most 50, and names a next page only when there is one.
        const first = await queue(deps);
        expect(first.cases.length).toBeLessThanOrEqual(QUEUE_PAGE_SIZE);
        expect(first.nextCursor === null).toBe(whole.length <= QUEUE_PAGE_SIZE);
        for (const cursor of ["bm9wZQ", Buffer.from(JSON.stringify([5, false, "2026-10-04T08:00:00.000000Z", randomUUID()])).toString("base64url"), Buffer.from(JSON.stringify([0, false, "now", randomUUID()])).toString("base64url")]) {
          expect(await refusal(queue(deps, cursor)), cursor).toBe("invalid_request");
        }
      });
    });

    test("only under the emergency switch are cases whose unanswered items all come from unproven sources sorted after the others of their lane, never below a less severe lane; in the urgent lane only signed-out intakes count as unproven", async () => {
      await inWorld(async (tx) => {
        const fresh = await profile(tx);
        const old = await profile(tx);
        await tx.execute(sql`update profiles set created_at = now() - interval '30 days' where id = ${old.id}::uuid`);
        const post = async () => (await imagePost(tx, 0)).postId;
        const caseOf = async (g: Parameters<typeof intake>[1]) => (await intake(tx, g, aPost(await post()))).items[0]!.caseId!;
        const signedOut3 = await caseOf({ ...ground.illegal(null), category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" });
        const fresh2 = await caseOf(ground.rule(fresh.id, "R1"));
        const old2 = await caseOf(ground.rule(old.id, "R1"));
        // A threat reported by a new account, about itself or not, is never deferred; a signed-out one is.
        const freshUrgent = await caseOf(ground.rule(fresh.id, "R5"));
        const signedOutUrgent = await caseOf({ ...ground.illegal(null), category: "STATEMENT_CATEGORY_VIOLENCE" });
        // A case with one proven source among its unanswered items is not deferred.
        const mixedPost = await post();
        const mixed = (await intake(tx, ground.rule(fresh.id, "R6"), aPost(mixedPost))).items[0]!.caseId!;
        await intake(tx, ground.rule(old.id, "R6"), aPost(mixedPost));
        const own = [signedOut3, fresh2, old2, freshUrgent, signedOutUrgent, mixed];
        const age: [string, string][] = [
          [signedOutUrgent, "9 hours"],
          [freshUrgent, "1 hour"],
          [signedOut3, "8 hours"],
          [fresh2, "7 hours"],
          [old2, "2 hours"],
          [mixed, "1 hour"],
        ];
        for (const [caseId, ago] of age) await tx.execute(sql`update cases set oldest_open_at = now() - ${ago}::interval where id = ${caseId}::uuid`);

        const off = await ownRows(world(tx).deps, own);
        expect(off.map((row) => row.id)).toEqual([signedOutUrgent, freshUrgent, signedOut3, fresh2, old2, mixed]);
        expect(off.every((row) => !row.deferred)).toBe(true);
        const switchedOn = { config: { ...loadConfig(), MODERATION_DEFER_UNPROVEN: "on" as const } };
        const on = await ownRows(world(tx, switchedOn).deps, own);
        expect(on.map((row) => [row.id, row.deferred])).toEqual([
          [freshUrgent, false],
          [signedOutUrgent, true],
          [old2, false],
          [mixed, false],
          [signedOut3, true],
          [fresh2, true],
        ]);
        expect((await overview(world(tx, switchedOn).deps)).deferUnproven).toBe(true);
      }, migrateDb);
    });
  });

  describe("the overview", () => {
    test("per lane the open cases and the oldest unanswered item; the appeals waiting; mails waiting for more than an hour and those given up; decided items the release has not released after 26 hours; and the emergency switch", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        const start = await overview(deps);
        expect(StaffOverview.safeParse(start).success).toBe(true);
        expect(start.lanes.map((row) => row.lane)).toEqual([0, 1, 2]);
        expect(start.deferUnproven).toBe(false);

        const reporter = await profile(tx);
        const urgentCase = (await report(tx, aPost((await imagePost(tx, 1)).postId), "csam")).caseId;
        await tx.execute(sql`update cases set oldest_open_at = now() - interval '400 days' where id = ${urgentCase}::uuid`);
        // A notice whose sender is owed a receipt and an outcome mail, decided 30 hours ago and never released.
        const noticed = await intake(tx, ground.illegal(reporter.id), aPost((await imagePost(tx, 0)).postId));
        const decision = await decideIn(tx, mod, noticed.items[0]!.caseId!, { kind: "final", actions: [act("remove")] });
        await tx.execute(sql`update intakes set received_at = now() - interval '2 hours' where id = ${noticed.intakeId}::uuid`);
        await tx.execute(sql`update decisions set decided_at = now() - interval '30 hours' where id = ${decision}::uuid`);
        let seen = await overview(deps);
        expect(seen.lanes[0]).toMatchObject({ lane: 0, open: start.lanes[0]!.open + 1 });
        expect(Date.parse(seen.lanes[0]!.oldestAt!)).toBeLessThan(Date.now() - 399 * 24 * 3600_000);
        expect(seen.mailsWaiting).toEqual({ receipts: start.mailsWaiting.receipts + 1, authorMails: start.mailsWaiting.authorMails + 1, outcomes: start.mailsWaiting.outcomes });
        expect(seen.releaseOverdue).toBe(start.releaseOverdue + 1);
        expect(seen.appealsWaiting).toBe(start.appealsWaiting);

        // Released three hours ago, its outcome mail still pending; the receipt and the author's mail given up.
        await tx.execute(sql`update intake_items set outcome_sent_at = now() - interval '3 hours', shown_outcome = outcome where id = ${noticed.items[0]!.id}::uuid`);
        await tx.execute(sql`update intakes set receipt = 'failed' where id = ${noticed.intakeId}::uuid`);
        await tx.execute(sql`update decisions set author_mail = 'failed' where id = ${decision}::uuid`);
        seen = await overview(deps);
        expect(seen.mailsWaiting).toEqual({ receipts: start.mailsWaiting.receipts, authorMails: start.mailsWaiting.authorMails, outcomes: start.mailsWaiting.outcomes + 1 });
        expect(seen.mailsFailed).toEqual({ receipts: start.mailsFailed.receipts + 1, authorMails: start.mailsFailed.authorMails + 1, outcomes: start.mailsFailed.outcomes });
        expect(seen.releaseOverdue).toBe(start.releaseOverdue);
        // A mail given up more than 30 days ago is no longer counted.
        await tx.execute(sql`update decisions set decided_at = now() - interval '40 days' where id = ${decision}::uuid`);
        expect((await overview(deps)).mailsFailed.authorMails).toBe(start.mailsFailed.authorMails);
        // An appeal nobody has answered waits.
        await tx.execute(sql`insert into appeals (decision_id, appellant_account_id, filed_at) select d.id, p.author_id, now() from decisions d join cases c on c.id = d.case_id join posts p on p.id = c.target_id where d.id = ${decision}::uuid`);
        expect((await overview(deps)).appealsWaiting).toBe(start.appealsWaiting + 1);
        expect((await readCase(deps, sessionOf(admin), noticed.items[0]!.caseId!)).appeals).toEqual([expect.objectContaining({ decisionId: decision, statement: null, answeredAt: null, result: null })]);
      }, migrateDb);
    });

    test("the reveals it lists are those of the last 30 days, newest first, at most 100 of them, with how many there are in all", async () => {
      await inWorld(async (tx) => {
        const { deps } = world(tx);
        expect(OVERVIEW_LIST_MAX).toBe(100);
        const start = (await overview(deps)).reveals;
        const [first, second] = [(await report(tx, aPost((await imagePost(tx, 0)).postId))).caseId, (await report(tx, aPost((await imagePost(tx, 0)).postId))).caseId];
        // One more than the list holds, written as the migrator: the database stamps each row with the transaction's time.
        const more = OVERVIEW_LIST_MAX + 1;
        const rows = await tx.execute<{ id: string }>(
          sql`insert into case_access_log (staff_id, case_id, kind) select ${mod.id}::uuid, ${first}::uuid, 'identity_revealed'::access_kind from generate_series(1, ${more}::int) returning id::text as id`,
        );
        expect(rows).toHaveLength(more);
        let seen = (await overview(deps)).reveals;
        expect(StaffOverview.shape.reveals.safeParse(seen).success).toBe(true);
        expect(seen.total).toBe(start.total + more);
        expect(seen.items).toHaveLength(OVERVIEW_LIST_MAX);
        expect(seen.items.every((item) => item.caseId === first && item.handle !== "")).toBe(true);

        // One on another case a minute later is the newest; one of 29 days ago is still listed, one of 30 days and a
        // minute is not.
        const newest = (await tx.execute<{ id: string }>(sql`insert into case_access_log (staff_id, case_id, kind) values (${other.id}::uuid, ${second}::uuid, 'identity_revealed'::access_kind) returning id::text as id`))[0]!.id;
        await tx.execute(sql`update case_access_log set at = now() + interval '1 minute' where id = ${newest}::bigint`);
        await tx.execute(sql`update case_access_log set at = now() - interval '29 days' where id = ${rows[0]!.id}::bigint`);
        await tx.execute(sql`update case_access_log set at = now() - interval '30 days 1 minute' where id = ${rows[1]!.id}::bigint`);
        seen = (await overview(deps)).reveals;
        expect(seen.total).toBe(start.total + more);
        expect(seen.items[0]).toEqual({ at: expect.any(String), handle: await handleOf(tx, other.id), caseId: second });
        expect(seen.items.map((item) => item.at)).toEqual([...seen.items.map((item) => item.at)].sort().reverse());
        // With the list cut to this test's cases: every row of the last 30 days but the one moved out of it.
        await tx.execute(sql`update case_access_log set at = now() - interval '31 days' where kind = 'identity_revealed' and case_id <> all(${`{${first},${second}}`}::uuid[])`);
        await tx.execute(sql`delete from case_access_log where kind = 'identity_revealed' and case_id = ${first}::uuid and id > ${rows[49]!.id}::bigint`);
        seen = (await overview(deps)).reveals;
        expect(seen.total).toBe(50);
        expect(seen.items).toHaveLength(50);
        expect(seen.items.at(-1)).toMatchObject({ caseId: first, handle: await handleOf(tx, mod.id) });
        expect(Date.parse(seen.items.at(-1)!.at)).toBeLessThan(Date.now() - 28 * 24 * 3600_000);
      }, migrateDb);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${mod.id}::uuid`);
    expect(await counts()).toEqual(before);
  });
});
```

### Create `apps/api/test/integration/moderation-reveal.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { textDigest, type IdentityRevealedParams, type RevealReasonCategory } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { ActiveStaffSession, AuthForModeration, NotifierFacts, StaffMessage, StaffStepUpConfirmed } from "../../src/auth";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { overview, readCase } from "../../src/moderation/cases";
import type { ModerationDeps } from "../../src/moderation/context";
import { reveal } from "../../src/moderation/reveal";
import { saveText } from "../../src/moderation/texts";
import { newUserWithDevice } from "./auth-fixtures";
import { aPost, ground, hex64, imagePost, intake, moderationDeps, newTestStaff, refusal, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

/**
 * Revealing who sent a report or a notice (3c design, section 7.3), against the real database: each refusal before
 * anything is written, the access row and the audit row that commit together, the reason text the audit function
 * confirms, the day's limit, the identity read only after the commit, and the mail to every staff account. Each test runs
 * inside one transaction that is rolled back, with a made-up confirmation: the audit row it leads to is one audit-verify
 * would refuse, so it never commits. A reveal that commits is confirmed by a real key, in the HTTP suite. The file's last
 * test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: revealing who sent a report", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let other: TestStaff;
  /** A personal account the operator linked to the moderator's staff account. */
  let linked: string;
  let before: Record<string, number>;

  async function counts(): Promise<Record<string, number>> {
    const [authSide] = await migrateDb.execute<Record<string, number>>(
      sql`select (select count(*)::int from auth.notifier_contacts) as notifier_contacts, (select count(*)::int from auth.notifier_confirmations) as notifier_confirmations,
                 (select count(*)::int from auth.notifier_suppressions) as notifier_suppressions, (select count(*)::int from auth.staff_personal_accounts) as staff_personal_accounts`,
    );
    return { ...(await rowCounts(apiDb)), ...authSide! };
  }

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    before = await counts();
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    other = await newTestStaff(authDb, migrateDb, repo, "moderator");
    linked = (await newUserWithDevice(repo)).user.id;
    await migrateDb.execute(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${mod.id}::uuid, ${linked}::uuid)`);
  }, 60_000);
  afterAll(async () => {
    await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${mod.id}::uuid`);
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      for (const staff of [mod, other]) await staffProfile(tx, staff);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);

  function sessionOf(staff: TestStaff): ActiveStaffSession {
    const now = new Date();
    return {
      sessionId: hex64(),
      handle: randomUUID(),
      userId: staff.id,
      keyId: staff.keyId,
      role: staff.role,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    };
  }

  /** The moderation module on the test's transaction, with an auth module that knows the notifiers the test names and records every staff mail. */
  function world(tx: DbTx, options: { accepted?: number } = {}) {
    const contacts = new Map<string, NotifierFacts>();
    const names = new Map<string, string>();
    const mailed: StaffMessage[] = [];
    const auth = {
      notifierFacts: async (ids: readonly string[]) => new Map(ids.map((id) => [id, contacts.get(id) ?? { found: false, named: false, contactGiven: false, confirmed: false, suppressed: false }])),
      notifierName: async (id: string) => names.get(id) ?? null,
      mailStaff: async (message: StaffMessage) => {
        mailed.push(message);
        return options.accepted ?? 3;
      },
    } as unknown as AuthForModeration;
    return { deps: moderationDeps(tx, { auth }), contacts, names, mailed };
  }

  /** A reason saved on the case as the console saves it; its digest is what a reveal's params name. */
  async function savedReason(deps: ModerationDeps, staff: TestStaff, caseId: string, text = `The notifier claims to be impersonated (${randomUUID()}).`) {
    const salt = hex64();
    return saveText(deps, sessionOf(staff), caseId, { kind: "reveal_reason", text, salt, digest: await textDigest(salt, text) });
  }

  /**
   * A confirmation of a reveal as the staff routes hand it over, made up: its hash and assertion are placeholders, so the
   * audit row it leads to is only ever written inside a transaction that is rolled back.
   */
  function confirmation(staff: TestStaff, itemId: string, params: IdentityRevealedParams, expiresAt = new Date(Date.now() + 10 * 60_000)): { session: ActiveStaffSession; confirmed: StaffStepUpConfirmed } {
    return {
      session: sessionOf(staff),
      confirmed: {
        action: "identity_revealed",
        target: { type: "intake_item", id: itemId },
        params,
        actionHash: hex64(),
        keyId: staff.keyId,
        assertion: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
        expiresAt,
      },
    };
  }
  /** A whole reveal of the item by the staff member, with this reason digest. */
  function revealAs(deps: ModerationDeps, staff: TestStaff, itemId: string, reasonDigest: string, reasonCategory: RevealReasonCategory = "impersonation_claim", expiresAt?: Date) {
    const { session, confirmed } = confirmation(staff, itemId, { reasonCategory, reasonDigest }, expiresAt);
    return reveal(deps, session, confirmed, { requestId: `req-${randomUUID()}` });
  }
  const reveals = async (tx: DbTx, staffId: string) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where staff_id = ${staffId}::uuid and kind = 'identity_revealed'`))[0]!.n;
  const confirmedAt = async (tx: DbTx, textId: string) => (await tx.execute<{ confirmed: boolean }>(sql`select confirmed_at is not null as confirmed from staff_texts where id = ${textId}::uuid`))[0]!.confirmed;
  const handleOf = async (tx: DbTx, id: string) => (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${id}::uuid`))[0]!.handle;
  /** A post reported under a rule by a signed-in reporter. */
  async function reported(tx: DbTx, authorId?: string) {
    const [p, reporter] = [await imagePost(tx, 0, authorId), await profile(tx)];
    const recorded = await intake(tx, ground.rule(reporter.id, "R1"), aPost(p.postId));
    return { ...p, reporter, caseId: recorded.items[0]!.caseId!, itemId: recorded.items[0]!.id };
  }

  test("a signed-in reporter's handle is revealed with the access row and the audit row of one transaction, which confirms the reason; every staff account is mailed, and the home screen and the case's history list it", async () => {
    await inWorld(async (tx) => {
      const { deps, mailed } = world(tx);
      const r = await reported(tx);
      const reason = await savedReason(deps, mod, r.caseId);
      const start = (await overview(deps)).reveals.total;

      expect(await revealAs(deps, mod, r.itemId, reason.digest, "abuse_of_reporting")).toEqual({ handle: r.reporter.handle, name: null });

      const [access] = await tx.execute<{ case_id: string; intake_item_id: string; text_id: string }>(sql`select case_id, intake_item_id, text_id from case_access_log where staff_id = ${mod.id}::uuid and kind = 'identity_revealed'`);
      expect({ ...access! }).toEqual({ case_id: r.caseId, intake_item_id: r.itemId, text_id: reason.id });
      const [audit] = await tx.execute<{ actor_id: string; target_type: string; metadata: unknown; has_step_up: boolean }>(
        sql`select actor_id, target_type, metadata, step_up is not null as has_step_up from audit_log where action = 'identity_revealed' and target_id = ${r.itemId}`,
      );
      // The chain holds ids, an enum and a digest: never the reason's words, the reporter or the case's content.
      expect({ ...audit! }).toEqual({ actor_id: mod.id, target_type: "intake_item", metadata: { params: { reasonCategory: "abuse_of_reporting", reasonDigest: reason.digest } }, has_step_up: true });
      expect(await confirmedAt(tx, reason.id)).toBe(true);

      await deps.background.settle();
      expect(mailed).toEqual([{ template: "moderation_reveal", handle: await handleOf(tx, mod.id), at: expect.any(Date), count: 1, limit: 10 }]);
      const seen = await overview(deps);
      expect(seen.reveals.total).toBe(start + 1);
      expect(seen.reveals.items[0]).toEqual({ at: expect.any(String), handle: await handleOf(tx, mod.id), caseId: r.caseId });
      const history = (await readCase(deps, sessionOf(other), r.caseId)).history.filter((entry) => entry.event === "reveal");
      expect(history).toEqual([expect.objectContaining({ refId: r.itemId, staffHandle: await handleOf(tx, mod.id) })]);
      // The reason was used: it confirms no second reveal, of this item or another.
      expect(await refusal(revealAs(deps, mod, r.itemId, reason.digest))).toBe("text_not_found");
      expect(await reveals(tx, mod.id)).toBe(1);
    });
  });

  test("a signed-out notifier is revealed by the name they gave, never an address; when the name was forgotten in between the answer names nobody and the reveal still stands", async () => {
    await inWorld(async (tx) => {
      const { deps, contacts, names, mailed } = world(tx);
      const p = await imagePost(tx, 0);
      const [named, forgotten] = [randomUUID(), randomUUID()];
      contacts.set(named, { found: true, named: true, contactGiven: true, confirmed: true, suppressed: false });
      contacts.set(forgotten, { found: true, named: true, contactGiven: false, confirmed: false, suppressed: false });
      names.set(named, "Ada Lovelace");
      const first = await intake(tx, { ...ground.illegal(null), contactId: named }, aPost(p.postId));
      const second = await intake(tx, { ...ground.illegal(null), contactId: forgotten }, aPost(p.postId));
      const caseId = first.items[0]!.caseId!;

      expect(await revealAs(deps, mod, first.items[0]!.id, (await savedReason(deps, mod, caseId)).digest, "legal_requirement")).toEqual({ handle: null, name: "Ada Lovelace" });
      expect(await revealAs(deps, mod, second.items[0]!.id, (await savedReason(deps, mod, caseId)).digest)).toEqual({ handle: null, name: null });
      expect(await reveals(tx, mod.id)).toBe(2);
      await deps.background.settle();
      expect(mailed.map((message) => (message.template === "moderation_reveal" ? message.count : null)).sort()).toEqual([1, 2]);
    });
  });

  test("each refusal comes before anything is written: an item that is none or has no case, a recused person, a source that names nobody, a reason that is not the person's own unused one on this case", async () => {
    await inWorld(async (tx) => {
      const { deps, contacts } = world(tx);
      const r = await reported(tx);
      const reason = await savedReason(deps, mod, r.caseId);
      const answers: Record<string, string | null> = {};

      // not_found: no such item; an item whose link named nothing live, which has no case.
      answers["no such item"] = await refusal(revealAs(deps, mod, randomUUID(), reason.digest));
      const [dead] = await tx.execute<{ id: string }>(sql`
        insert into intake_items (intake_id, case_id, target_type, target_id, position, lane, outcome)
        select intake_id, null, 'post', gen_random_uuid(), 2, 2, 'not_available' from intake_items where id = ${r.itemId}::uuid returning id`);
      answers["an item without a case"] = await refusal(revealAs(deps, mod, dead!.id, reason.digest));

      // staff_recused: the case's subject is an account linked to the person.
      await staffProfile(tx, { id: linked });
      const close = await reported(tx, linked);
      answers["a case whose subject is linked to the person"] = await refusal(revealAs(deps, mod, close.itemId, (await savedReason(deps, other, close.caseId)).digest));

      // reveal_refused: the path for child sexual abuse material, a finding, a reporter whose link is gone, a notifier
      // who gave no name, and a contact that is lost.
      const csam = await intake(tx, ground.csam(), aPost(r.postId));
      const finding = await intake(tx, ground.finding(other.id, "R1"), aPost(r.postId));
      const unnamed = randomUUID();
      contacts.set(unnamed, { found: true, named: false, contactGiven: true, confirmed: false, suppressed: false });
      const withAddress = await intake(tx, { ...ground.illegal(null), contactId: unnamed }, aPost(r.postId));
      const lost = await intake(tx, { ...ground.illegal(null), contactId: randomUUID() }, aPost(r.postId));
      const nameless = await intake(tx, ground.illegal(null), aPost(r.postId));
      const gone = await reported(tx);
      await tx.execute(sql`update intake_items set reporter_account_id = null where id = ${gone.itemId}::uuid`);
      answers["a notice on the path for child sexual abuse material"] = await refusal(revealAs(deps, mod, csam.items[0]!.id, reason.digest));
      answers["a moderator's finding"] = await refusal(revealAs(deps, mod, finding.items[0]!.id, reason.digest));
      answers["a notifier who gave an address and no name"] = await refusal(revealAs(deps, mod, withAddress.items[0]!.id, reason.digest));
      answers["a notifier whose contact is lost"] = await refusal(revealAs(deps, mod, lost.items[0]!.id, reason.digest));
      answers["a notifier who left no contact"] = await refusal(revealAs(deps, mod, nameless.items[0]!.id, reason.digest));
      answers["a reporter whose link is gone"] = await refusal(revealAs(deps, mod, gone.itemId, (await savedReason(deps, mod, gone.caseId)).digest));

      // text_not_found: a digest nobody saved; another person's reason; a text of another kind; a reason of another case.
      const salt = hex64();
      const note = await saveText(deps, sessionOf(mod), r.caseId, { kind: "note", text: "a note", salt, digest: await textDigest(salt, "a note") });
      const elsewhere = await reported(tx);
      answers["a digest nobody saved"] = await refusal(revealAs(deps, mod, r.itemId, hex64()));
      answers["another person's reason"] = await refusal(revealAs(deps, mod, r.itemId, (await savedReason(deps, other, r.caseId)).digest));
      answers["a note's digest"] = await refusal(revealAs(deps, mod, r.itemId, note.digest));
      answers["a reason saved on another case"] = await refusal(revealAs(deps, mod, r.itemId, (await savedReason(deps, mod, elsewhere.caseId)).digest));

      expect(answers).toEqual({
        "no such item": "not_found",
        "an item without a case": "not_found",
        "a case whose subject is linked to the person": "staff_recused",
        "a notice on the path for child sexual abuse material": "reveal_refused",
        "a moderator's finding": "reveal_refused",
        "a notifier who gave an address and no name": "reveal_refused",
        "a notifier whose contact is lost": "reveal_refused",
        "a notifier who left no contact": "reveal_refused",
        "a reporter whose link is gone": "reveal_refused",
        "a digest nobody saved": "text_not_found",
        "another person's reason": "text_not_found",
        "a note's digest": "text_not_found",
        "a reason saved on another case": "text_not_found",
      });
      expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from case_access_log where kind = 'identity_revealed' and staff_id = any(${`{${mod.id},${other.id}}`}::uuid[])`))[0]!.n).toBe(0);
      expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_log where action = 'identity_revealed' and actor_id = ${mod.id}::uuid and target_id = ${r.itemId}`))[0]!.n).toBe(0);
      expect(await confirmedAt(tx, reason.id)).toBe(false);
      // Nothing above spent the reason: the reveal it was saved for still goes through.
      expect(await revealAs(deps, mod, r.itemId, reason.digest)).toEqual({ handle: r.reporter.handle, name: null });
    }, migrateDb);
  });

  test("one person reveals at most the day's limit of sources: the next is refused with nothing written, its reason left unconfirmed, while another staff account's is accepted", async () => {
    await inWorld(async (tx) => {
      const { deps, mailed } = world(tx);
      await tx.execute(sql`update moderation_limits set reveals_per_day = 2 where id = 1`);
      const items = [await reported(tx), await reported(tx), await reported(tx)];
      for (const r of items.slice(0, 2)) await revealAs(deps, mod, r.itemId, (await savedReason(deps, mod, r.caseId)).digest);
      const third = items[2]!;
      const reason = await savedReason(deps, mod, third.caseId);
      const { session, confirmed } = confirmation(mod, third.itemId, { reasonCategory: "other", reasonDigest: reason.digest });
      const refused = await reveal(deps, session, confirmed, { requestId: "req-limit" }).catch((err: unknown) => err as { code: string; status: number; retryAfterSeconds?: number });
      expect(refused).toMatchObject({ code: "rate_limited", status: 429 });
      expect((refused as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
      expect(await reveals(tx, mod.id)).toBe(2);
      expect(await confirmedAt(tx, reason.id)).toBe(false);
      // Another staff account has its own day.
      expect(await revealAs(deps, other, third.itemId, (await savedReason(deps, other, third.caseId)).digest)).toEqual({ handle: third.reporter.handle, name: null });
      await deps.background.settle();
      // Each mail gives the person's count that day and the limit.
      expect(mailed.map((message) => (message.template === "moderation_reveal" ? [message.count, message.limit] : null))).toEqual(expect.arrayContaining([[1, 2], [2, 2]]));
      expect(mailed).toHaveLength(3);
    }, migrateDb);
  });

  test("a confirmation whose time has run out, and one whose key was revoked since, reveal nothing and write nothing; a mail no address took changes nothing", async () => {
    // A staff account of this test's own: its key is revoked for good on the auth side.
    const leaving = await newTestStaff(authDb, migrateDb, repo, "moderator");
    await inWorld(async (tx) => {
      await staffProfile(tx, leaving);
      const { deps, mailed } = world(tx, { accepted: 0 });
      const r = await reported(tx);

      // The challenge expired before the transaction began: nothing is written, and no identity is answered.
      const lateReason = await savedReason(deps, mod, r.caseId);
      expect(await revealAs(deps, mod, r.itemId, lateReason.digest, "other", new Date(Date.now() - 1000))).toBe("late");
      expect(await reveals(tx, mod.id)).toBe(0);
      expect(await confirmedAt(tx, lateReason.id)).toBe(false);

      // The key no longer opens anything: the audit function refuses as the transaction's last statement, which undoes
      // the access row with it.
      const endedReason = await savedReason(deps, leaving, r.caseId);
      await authDb.execute(sql`update auth.staff_keys set revoked_at = now() where id = ${leaving.keyId}::uuid`);
      expect(await revealAs(deps, leaving, r.itemId, endedReason.digest)).toBe("ended");
      expect(await reveals(tx, leaving.id)).toBe(0);
      expect(await confirmedAt(tx, endedReason.id)).toBe(false);
      await deps.background.settle();
      expect(mailed).toEqual([]);

      // No address took the mail: the reveal stands and is answered all the same.
      expect(await revealAs(deps, mod, r.itemId, lateReason.digest)).toEqual({ handle: r.reporter.handle, name: null });
      await deps.background.settle();
      expect(mailed).toHaveLength(1);
      expect(await reveals(tx, mod.id)).toBe(1);
    });
  });

  test("the case answer offers nothing more than the summary before a reveal, and after it: the handle is in the reveal's answer alone", async () => {
    await inWorld(async (tx) => {
      const { deps } = world(tx);
      const r = await reported(tx);
      await revealAs(deps, mod, r.itemId, (await savedReason(deps, mod, r.caseId)).digest);
      const view = await readCase(deps, sessionOf(mod), r.caseId);
      expect(JSON.stringify(view)).not.toContain(r.reporter.handle);
      expect(view.items[0]!.source).toMatchObject({ kind: "reporter", label: "Reporter A" });
      // The reason is confirmed: it is no draft any more.
      expect(view.drafts).toEqual([]);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    await migrateDb.execute(sql`delete from auth.staff_personal_accounts where staff_user_id = ${mod.id}::uuid`);
    expect(await counts()).toEqual(before);
  });
});
```

### Create `apps/api/test/moderation-overlap.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { OVERLAP_RUN, quotes, quotesUser } from "../src/moderation/overlap";

/**
 * The overlap check on staff texts (3c design, section 7.4; C19): a text that goes to the author with a statement must
 * not carry what a reporter, a notifier or an appellant wrote. It is refused when any run of 32 characters of one of
 * their texts appears in it, both lower-cased and with every run of whitespace made one space. Staff paraphrase.
 */
describe("the overlap check on staff texts", () => {
  // 40 characters once its spaces are single: long enough to hold runs of 32.
  const theirs = "He posted my home address on the 3rd day";
  const LF = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);

  test("the run is 32 characters", () => {
    expect(OVERLAP_RUN).toBe(32);
    expect(theirs).toHaveLength(40);
  });

  test("a text that holds a run of 32 characters of theirs quotes it; one that holds 31 does not", () => {
    const run32 = theirs.slice(3, 35);
    const run31 = theirs.slice(3, 34);
    expect(run32).toHaveLength(32);
    expect(quotes(`The reporter wrote [${run32}].`, [theirs])).toBe(true);
    // The 31 characters stand between two characters that are not theirs, so no window of 32 matches.
    expect(quotes(`The reporter wrote [${run31}].`, [theirs])).toBe(false);
    expect(quotes(theirs, [theirs])).toBe(true);
    expect(quotes("The post names the home address of another person.", [theirs])).toBe(false);
  });

  test("a text of theirs under 32 characters can never be quoted", () => {
    const short = "section 241 of the criminal code";
    expect(short).toHaveLength(32);
    expect(quotes(`It breaks ${short}.`, [short])).toBe(true);
    expect(quotes(`It breaks ${short.slice(0, 31)}.`, [short.slice(0, 31)])).toBe(false);
    expect(quotes("anything", [""])).toBe(false);
    expect(quotes("", [theirs])).toBe(false);
    expect(quotes("anything at all", [])).toBe(false);
  });

  test("case does not hide a quote", () => {
    expect(quotes(theirs.toUpperCase(), [theirs])).toBe(true);
    expect(quotes(theirs, [theirs.toUpperCase()])).toBe(true);
  });

  test("whitespace does not hide a quote: every run of it counts as one space, in either text", () => {
    const spread = theirs.split(" ").join(`  ${LF}${TAB} `);
    expect(quotes(spread, [theirs])).toBe(true);
    expect(quotes(theirs, [spread])).toBe(true);
    // Without its spaces it is another text: the check finds copies, not likenesses.
    expect(quotes(theirs.split(" ").join(""), [theirs])).toBe(false);
  });

  test("any one of their texts is enough, wherever in the staff text the run stands", () => {
    const other = "This account sells accounts and followers for money.";
    expect(quotes(`A first sentence of the moderator's own. ${other} And a last one.`, ["a short one", theirs, other])).toBe(true);
  });

  test("characters outside the basic plane count as one each", () => {
    const emoji = String.fromCodePoint(0x1f600);
    const their = `${emoji.repeat(16)}0123456789abcdef`;
    expect(Array.from(their)).toHaveLength(32);
    expect(quotes(`x ${their} y`, [their])).toBe(true);
    // One emoji fewer leaves 31 characters, though 62 UTF-16 units.
    const shorter = `${emoji.repeat(15)}0123456789abcdef`;
    expect(shorter.length).toBeGreaterThan(32);
    expect(quotes(`x ${shorter} y`, [shorter])).toBe(false);
  });

  test("every kind is checked but a note and a recorded choice not to seal, which stay with staff", () => {
    for (const kind of ["facts", "reason", "legal_reference", "review_reason", "reveal_reason"] as const) expect(quotesUser(kind, theirs, [theirs]), kind).toBe(true);
    for (const kind of ["note", "seal_declined"] as const) expect(quotesUser(kind, theirs, [theirs]), kind).toBe(false);
    expect(quotesUser("facts", "The post names the home address of another person.", [theirs])).toBe(false);
  });

  test("a re-examination's statement and an appeal's statement are theirs as an explanation and a cited law are", () => {
    const explanation = "This is my address and my phone number, posted to hurt me.";
    const citedLaw = "Article 8 of the Charter of Fundamental Rights of the European Union";
    const reexamination = "You answered without looking at the second image of the post.";
    const appeal = "My post quoted a public record and named nobody who is not in it.";
    for (const their of [explanation, citedLaw, reexamination, appeal]) {
      expect(quotesUser("reason", `As the text says: ${their}`, [explanation, citedLaw, reexamination, appeal]), their).toBe(true);
    }
  });
});
```

### Create `apps/api/test/moderation-summary.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { accountAgeBand, actedOnBand, answeredUnseenBand, itemsFiledBand, reporterIndexes, secondsToUtcMidnight } from "../src/moderation/cases";

/**
 * A reporter's summary on the case page (3c design, section 7.3): four bands computed on read, never exact counts, and
 * a letter given per case. The summary is the same on every case the person reported, so its bands must rarely single
 * anyone out.
 */
describe("a reporter's summary: the bands", () => {
  const at = (iso: string) => new Date(iso);

  test("the account's age: under one month, one to twelve months, over twelve, by the calendar in UTC", () => {
    const now = at("2026-10-04T12:00:00.000Z");
    expect(accountAgeBand(at("2026-10-04T11:59:59.000Z"), now)).toBe("under_1_month");
    expect(accountAgeBand(at("2026-09-04T12:00:01.000Z"), now)).toBe("under_1_month");
    // One month to the second is no longer under a month.
    expect(accountAgeBand(at("2026-09-04T12:00:00.000Z"), now)).toBe("1_to_12_months");
    expect(accountAgeBand(at("2026-01-01T00:00:00.000Z"), now)).toBe("1_to_12_months");
    // Twelve months to the second still counts as one to twelve; a second more is over.
    expect(accountAgeBand(at("2025-10-04T12:00:00.000Z"), now)).toBe("1_to_12_months");
    expect(accountAgeBand(at("2025-10-04T11:59:59.000Z"), now)).toBe("over_12_months");
    expect(accountAgeBand(at("2020-02-29T00:00:00.000Z"), now)).toBe("over_12_months");
    // A day the next month lacks ends on that month's last day: created on 31 January, a month old on 28 February.
    expect(accountAgeBand(at("2026-01-31T10:00:00.000Z"), at("2026-02-28T09:59:59.000Z"))).toBe("under_1_month");
    expect(accountAgeBand(at("2026-01-31T10:00:00.000Z"), at("2026-02-28T10:00:00.000Z"))).toBe("1_to_12_months");
  });

  test("the items it filed: 1, 2 to 9, 10 or more", () => {
    expect(itemsFiledBand(1)).toBe("1");
    expect(itemsFiledBand(2)).toBe("2_to_9");
    expect(itemsFiledBand(9)).toBe("2_to_9");
    expect(itemsFiledBand(10)).toBe("10_or_more");
    expect(itemsFiledBand(250)).toBe("10_or_more");
    // The item being read is among them, so the count is never below one.
    expect(itemsFiledBand(0)).toBe("1");
  });

  test("the share of its decided items that were acted on: none decided, none, under half, half or more; exactly half is half or more", () => {
    expect(actedOnBand(0, 0)).toBe("none_decided");
    expect(actedOnBand(3, 0)).toBe("none");
    expect(actedOnBand(3, 1)).toBe("under_half");
    expect(actedOnBand(100, 49)).toBe("under_half");
    expect(actedOnBand(4, 2)).toBe("half_or_more");
    expect(actedOnBand(100, 50)).toBe("half_or_more");
    expect(actedOnBand(1, 1)).toBe("half_or_more");
  });

  test("the items answered while nobody could open the images are counted apart: none, 1, 2 to 9, 10 or more", () => {
    expect(answeredUnseenBand(0)).toBe("none");
    expect(answeredUnseenBand(1)).toBe("1");
    expect(answeredUnseenBand(2)).toBe("2_to_9");
    expect(answeredUnseenBand(9)).toBe("2_to_9");
    expect(answeredUnseenBand(10)).toBe("10_or_more");
    // A reporter whose only answered item was answered that way has no decided item: it is not "no action".
    expect([actedOnBand(0, 0), answeredUnseenBand(1)]).toEqual(["none_decided", "1"]);
  });
});

describe("a reporter's summary: the letter", () => {
  test("is given per case, in the order of each reporter's first item in that case", () => {
    // The items in the case's order: the second reporter's first item comes before the first reporter's second.
    const first = reporterIndexes(["r-anna", "r-ben", "r-anna", null, "r-cleo", "r-ben"]);
    expect([...first]).toEqual([
      ["r-anna", 0],
      ["r-ben", 1],
      ["r-cleo", 2],
    ]);
    // On another case the same people get the letters of that case's order: a letter says nothing across cases.
    const second = reporterIndexes(["r-cleo", "r-anna"]);
    expect([...second]).toEqual([
      ["r-cleo", 0],
      ["r-anna", 1],
    ]);
    expect([...reporterIndexes([null, null])]).toEqual([]);
  });
});

describe("the day's limits", () => {
  test("a refusal at a daily limit says how many seconds are left to midnight UTC, at least one", () => {
    expect(secondsToUtcMidnight(new Date("2026-10-04T00:00:00.000Z"))).toBe(86_400);
    expect(secondsToUtcMidnight(new Date("2026-10-04T23:59:30.000Z"))).toBe(30);
    expect(secondsToUtcMidnight(new Date("2026-10-04T23:59:59.999Z"))).toBe(1);
    expect(secondsToUtcMidnight(new Date("2026-12-31T12:00:00.000Z"))).toBe(43_200);
  });
});
```

### Create `packages/contracts/test/staff-cases.test.ts`

```ts
import { describe, expect, test } from "vitest";
import {
  CaseSnapshot,
  CaseView,
  FINDING_CATEGORIES,
  FindingRequest,
  FindingResponse,
  IdentityRevealRequest,
  QUEUE_PAGE_SIZE,
  QueuePage,
  QueueQuery,
  RevealResponse,
  SOURCE_LABELS,
  STAFF_TEXT_KINDS,
  STAFF_TEXT_MAX,
  SourceSummary,
  StaffOverview,
  StaffSnapshotTaken,
  StaffTextSaveRequest,
  StaffTextSaved,
  StaffTextsResponse,
  TDB_CATEGORIES,
  reporterLabel,
  snapshotDigest,
  staffTextProblem,
} from "../src/index";

/**
 * The console's requests and answers on cases (3c design, section 10): what a moderator's own finding may say, what a
 * saved text must be, and the shapes the queue, the case and the home screen are parsed with.
 */

const CASE = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const POST = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";
const OTHER = "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b";
const HEX = "ab".repeat(32);
const TIME = "2026-10-04T08:15:30.123Z";

describe("FindingRequest", () => {
  const finding = { target: { kind: "post", id: POST }, ground: "rule", ruleId: "R1", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" };

  test("a moderator's finding cites a korbat rule, R2 among them, about a post, an account or a korbat link", () => {
    for (const ruleId of ["R1", "R2", "R3", "R4", "R5", "R6"]) expect(FindingRequest.safeParse({ ...finding, ruleId }).success, ruleId).toBe(true);
    expect(FindingRequest.safeParse({ ...finding, target: { kind: "account", handle: "@Some_one" } }).success).toBe(true);
    expect(FindingRequest.parse({ ...finding, target: { kind: "account", handle: "@Some_one" } }).target).toEqual({ kind: "account", handle: "some_one" });
    expect(FindingRequest.safeParse({ ...finding, target: { kind: "link", url: "https://korbat.example/post/" + POST } }).success).toBe(true);
  });

  test("it has no other ground than a rule: a finding never alleges illegality and never goes the path that records no sender", () => {
    for (const ground of ["illegal", "csam", "order", "law", ""]) expect(FindingRequest.safeParse({ ...finding, ground }).success, ground).toBe(false);
    const { ground: _ground, ...withoutGround } = finding;
    expect(FindingRequest.safeParse(withoutGround).success).toBe(false);
    // The members of the other grounds are refused, never ignored.
    for (const extra of [{ explanation: "words" }, { bonaFide: true }, { citedLaw: "a law" }, { keyword: "csam" }, { name: "A" }, { email: "a@b.example" }, { turnstileToken: "t" }]) {
      expect(FindingRequest.safeParse({ ...finding, ...extra }).success, Object.keys(extra)[0]).toBe(false);
    }
    expect(FindingRequest.safeParse({ ...finding, ruleId: "R7" }).success).toBe(false);
    expect(FindingRequest.safeParse({ ...finding, ruleId: null }).success).toBe(false);
  });

  test("its category is one of the Transparency Database's, but not the one that says a notifier was not sure", () => {
    for (const category of TDB_CATEGORIES) {
      expect(FindingRequest.safeParse({ ...finding, category }).success, category).toBe(category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE");
    }
    expect(FindingRequest.safeParse({ ...finding, category: "STATEMENT_CATEGORY_MADE_UP" }).success).toBe(false);
  });

  test("the categories a finding may carry are exported as a list, in the Transparency Database's order, for the console's form: exactly those the request takes", () => {
    expect(FINDING_CATEGORIES).toEqual(TDB_CATEGORIES.filter((category) => category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"));
    expect(FINDING_CATEGORIES).toHaveLength(TDB_CATEGORIES.length - 1);
    expect(TDB_CATEGORIES.filter((category) => FindingRequest.safeParse({ ...finding, category }).success)).toEqual(FINDING_CATEGORIES);
  });

  test("the answer names the case the finding opened or joined", () => {
    expect(FindingResponse.parse({ caseId: CASE })).toEqual({ caseId: CASE });
    expect(FindingResponse.safeParse({ caseId: "x" }).success).toBe(false);
  });
});

describe("a saved text", () => {
  const save = { kind: "note", text: "Art. 18 check: no suspicion", salt: HEX, digest: HEX };

  test("is of one of the seven kinds, the recorded choice not to seal among them, with a 32-byte salt and a digest in lower-case hex", () => {
    expect(STAFF_TEXT_KINDS).toEqual(["facts", "reason", "legal_reference", "review_reason", "reveal_reason", "note", "seal_declined"]);
    for (const kind of STAFF_TEXT_KINDS) expect(StaffTextSaveRequest.safeParse({ ...save, kind }).success, kind).toBe(true);
    expect(StaffTextSaveRequest.safeParse({ ...save, kind: "statement" }).success).toBe(false);
    for (const bad of [HEX.toUpperCase(), HEX.slice(2), `${HEX}00`, "", "g".repeat(64)]) {
      expect(StaffTextSaveRequest.safeParse({ ...save, salt: bad }).success, `salt ${bad}`).toBe(false);
      expect(StaffTextSaveRequest.safeParse({ ...save, digest: bad }).success, `digest ${bad}`).toBe(false);
    }
    expect(StaffTextSaveRequest.safeParse({ ...save, caseId: CASE }).success).toBe(false);
  });

  test("the request's schema lets any text through: what a text must be is the route's to refuse, with a code of its own", () => {
    // A text that is too long or holds a control character is answered text_invalid, not invalid_request.
    expect(StaffTextSaveRequest.safeParse({ ...save, text: "x".repeat(STAFF_TEXT_MAX + 1) }).success).toBe(true);
    expect(StaffTextSaveRequest.safeParse({ ...save, text: `a${String.fromCharCode(7)}b` }).success).toBe(true);
    expect(StaffTextSaveRequest.safeParse({ ...save, text: 5 }).success).toBe(false);
  });

  test("staffTextProblem: a well-formed text of at most 5000 UTF-16 units, with no control character but the line feed and no invisible direction or zero-width character", () => {
    expect(STAFF_TEXT_MAX).toBe(5000);
    const LF = String.fromCharCode(10);
    expect(staffTextProblem(`two${LF}lines`)).toBeNull();
    expect(staffTextProblem("")).toBeNull();
    expect(staffTextProblem("x".repeat(5000))).toBeNull();
    expect(staffTextProblem("x".repeat(5001))).toBe("too_long");
    // An emoji is two units: 2500 of them fit, and one more unit does not.
    const emoji = String.fromCodePoint(0x1f600);
    expect(staffTextProblem(emoji.repeat(2500))).toBeNull();
    expect(staffTextProblem(`${emoji.repeat(2500)}x`)).toBe("too_long");
    // Half of a surrogate pair has no UTF-8 bytes.
    expect(staffTextProblem(`a${String.fromCharCode(0xd83d)}b`)).toBe("malformed");
    expect(staffTextProblem(`a${String.fromCharCode(0xde00)}`)).toBe("malformed");
    // NUL and every other C0 control but the line feed.
    for (let code = 0; code < 32; code++) {
      expect(staffTextProblem(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).toBe(code === 10 ? null : "control");
    }
    // The invisible direction and spacing characters the notice texts refuse too; the joiners scripts and emoji need stay.
    for (const code of [0x202a, 0x202e, 0x2066, 0x2069, 0x200b, 0x2060, 0xfeff]) expect(staffTextProblem(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).toBe("format");
    for (const code of [0x200c, 0x200d]) expect(staffTextProblem(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).toBeNull();
    expect(staffTextProblem(`r${String.fromCharCode(0xe9)}sum${String.fromCharCode(0xe9)}`)).toBeNull();
  });

  test("the answers: the stored text's id and digest, the person's own drafts with their salts, and a snapshot's id and digest, never content", () => {
    expect(StaffTextSaved.parse({ id: CASE, digest: HEX })).toEqual({ id: CASE, digest: HEX });
    const draft = { id: CASE, kind: "facts", text: "The post names a home address.", salt: HEX, digest: HEX, createdAt: TIME };
    expect(StaffTextsResponse.parse({ texts: [draft] }).texts).toEqual([draft]);
    expect(Object.keys(StaffSnapshotTaken.parse({ id: CASE, digest: HEX, body: "content", media: [] }))).toEqual(["id", "digest"]);
  });
});

describe("the reveal", () => {
  test("its request is the confirmed params with the key's assertion, and nothing else", () => {
    const stepUp = { id: "Y3JlZA", rawId: "Y3JlZA", type: "public-key", response: { clientDataJSON: "e30", authenticatorData: "AAAA", signature: "AAAA" }, clientExtensionResults: {} };
    const params = { reasonCategory: "impersonation_claim", reasonDigest: HEX };
    expect(IdentityRevealRequest.safeParse({ ...params, stepUp }).success).toBe(true);
    expect(IdentityRevealRequest.safeParse(params).success).toBe(false);
    expect(IdentityRevealRequest.safeParse({ ...params, stepUp, reason: "free text" }).success).toBe(false);
    expect(IdentityRevealRequest.safeParse({ ...params, reasonCategory: "curiosity", stepUp }).success).toBe(false);
  });

  test("its answer is a reporter's handle or a notifier's given name, or neither when the name was forgotten in between; never an address", () => {
    expect(RevealResponse.parse({ handle: "some_one", name: null })).toEqual({ handle: "some_one", name: null });
    expect(RevealResponse.parse({ handle: null, name: "Ada" })).toEqual({ handle: null, name: "Ada" });
    expect(RevealResponse.parse({ handle: null, name: null })).toEqual({ handle: null, name: null });
    expect(Object.keys(RevealResponse.parse({ handle: null, name: "Ada", email: "ada@example.org" }))).toEqual(["handle", "name"]);
  });
});

describe("a source's summary", () => {
  const reporter = { kind: "reporter", label: "Reporter A", accountAge: "1_to_12_months", itemsFiled: "2_to_9", actedOn: "under_half", answeredUnseen: "none", named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false };

  test("names nobody: a letter given per case, bands instead of counts, and for a notifier what was given, never what", () => {
    expect(SourceSummary.safeParse(reporter).success).toBe(true);
    expect(SourceSummary.safeParse({ ...reporter, kind: "notifier", label: SOURCE_LABELS.notifier, accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null, named: true, contactGiven: true, confirmed: false, suppressed: false }).success).toBe(true);
    for (const kind of ["anonymous", "staff", "unlinked"] as const) {
      expect(SourceSummary.safeParse({ ...reporter, kind, label: SOURCE_LABELS[kind], accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null }).success, kind).toBe(true);
    }
    // Bands only: an exact count is no value of any of them.
    expect(SourceSummary.safeParse({ ...reporter, itemsFiled: "7" }).success).toBe(false);
    expect(SourceSummary.safeParse({ ...reporter, actedOn: "0.4" }).success).toBe(false);
    expect(SourceSummary.safeParse({ ...reporter, answeredUnseen: "3" }).success).toBe(false);
    expect(SourceSummary.safeParse({ ...reporter, accountAge: "3_days" }).success).toBe(false);
  });

  test("its label is one of the console's own: a reporter's letter or the fixed words of its kind, never a text an answer could choose", () => {
    expect(reporterLabel(0)).toBe("Reporter A");
    expect(reporterLabel(1)).toBe("Reporter B");
    expect(reporterLabel(25)).toBe("Reporter Z");
    expect(reporterLabel(26)).toBe("Reporter AA");
    expect(reporterLabel(27)).toBe("Reporter AB");
    expect(reporterLabel(26 + 26 * 26)).toBe("Reporter AAA");
    for (const label of ["korbat: verified notice from police", "Reporter a", "Reporter", "Reporter A ", "<b>Reporter A</b>", SOURCE_LABELS.staff]) {
      expect(SourceSummary.safeParse({ ...reporter, label }).success, label).toBe(false);
    }
    expect(SourceSummary.safeParse({ ...reporter, kind: "staff", label: "Reporter A" }).success).toBe(false);
  });
});

describe("the case answer", () => {
  const summary = { kind: "anonymous", label: SOURCE_LABELS.anonymous, accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null, named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false };
  const shown = {
    id: OTHER,
    takenAt: TIME,
    digest: HEX,
    withheld: false,
    salt: HEX,
    targetType: "post",
    targetId: POST,
    authorHandle: "author",
    postState: "visible",
    postCreatedAt: TIME,
    replyToId: null,
    quoteOfId: null,
    body: "the post's words",
    media: [{ id: OTHER, alt: "an image", width: 1200, height: 800 }],
    displayName: null,
    bio: null,
    handle: null,
  };
  const view = {
    id: CASE,
    lane: 0,
    stateVersion: 2,
    intakeSeq: 2,
    answeredSeq: 0,
    openedAt: TIME,
    closedAt: null,
    target: { type: "post", id: POST, link: `https://korbat.example/post/${POST}`, authorHandle: "author", state: "visible", level: "visible" },
    suspicion: { open: true, reach: { posts: 1, images: 1, sealed: 0, served: 1, newestPostOn: "2026-09-04" }, earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 1, lastOn: "2026-08-01" } } },
    imagesAllowed: false,
    snapshots: [shown, { id: CASE, takenAt: TIME, digest: HEX, withheld: true }],
    items: [
      {
        id: OTHER,
        seq: 1,
        position: 1,
        createdAt: TIME,
        lane: 0,
        link: `https://korbat.example/post/${POST}`,
        ruleId: null,
        allegesIllegal: true,
        csam: true,
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        categoryKeyword: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
        citedLaw: null,
        explanation: "a notifier's words",
        mediaId: null,
        suspect: true,
        quotedByPosition: null,
        quotedCaseId: CASE,
        reexaminesPosition: null,
        reexaminesYourDecision: false,
        statement: null,
        outcome: null,
        answeredBy: null,
        erased: false,
        source: summary,
      },
    ],
    decisions: [
      {
        id: OTHER,
        kind: "interim",
        outcome: "restricted",
        ground: "incompatible",
        ruleId: "R2",
        rulesVersion: 2,
        redressVersion: 1,
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        categoryKeyword: null,
        source: "notice",
        decidedAt: TIME,
        staffHandle: "mod_anna",
        throughSeq: 0,
        answersFromSeq: null,
        reviewsDecisionId: null,
        snapshotId: OTHER,
        suspect: true,
        unseen: false,
        needsAdmin: false,
        endedInterim: false,
        facts: "what was found",
        reason: "why",
        legalReference: null,
        actions: [
          { id: CASE, kind: "seal_media", mediaId: null, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, sealed: { posts: 1, images: 1, deletedPosts: 0, list: [{ postId: POST, createdAt: TIME, images: 1 }] } },
        ],
      },
    ],
    appeals: [{ id: OTHER, decisionId: OTHER, filedAt: TIME, statement: "the author's words", answeredAt: null, result: null, answeredBy: null }],
    drafts: [{ id: OTHER, kind: "reason", text: "a draft", salt: HEX, digest: HEX, createdAt: TIME }],
    notes: [{ id: OTHER, staffHandle: "mod_anna", createdAt: TIME, text: "Art. 18 check: no suspicion" }],
    sealsDeclined: [{ id: CASE, staffHandle: "mod_anna", createdAt: TIME, text: "The report repeats the one answered yesterday." }],
    history: [
      { at: TIME, event: "item", refId: OTHER, seq: 1, intakeKind: "user", ruleId: null, allegesIllegal: true, csam: true, reexamination: false, decisionKind: null, outcome: null, staffHandle: null, result: null },
      { at: TIME, event: "decision", refId: OTHER, seq: null, intakeKind: null, ruleId: null, allegesIllegal: null, csam: null, reexamination: null, decisionKind: "interim", outcome: "restricted", staffHandle: "mod_anna", result: null },
    ],
  };

  test("parses a case with its target, suspicion, snapshots, items, decisions, appeals, texts and history", () => {
    const parsed = CaseView.parse(view);
    expect(parsed.snapshots).toHaveLength(2);
    expect(parsed.items[0]!.source.kind).toBe("anonymous");
    expect(parsed.decisions[0]!.actions[0]!.sealed?.list).toEqual([{ postId: POST, createdAt: TIME, images: 1 }]);
    // An account's case: its live fields, no suspicion, and never an image.
    const account = { ...view, target: { type: "account", id: POST, handle: "now_named", displayName: "A name", bio: "A bio", deleted: false }, suspicion: null, snapshots: [], items: [], decisions: [] };
    expect(CaseView.safeParse(account).success).toBe(true);
    // A target whose row is gone is still an answer: staff see what is.
    expect(CaseView.safeParse({ ...view, target: { type: "post", id: POST, link: `https://korbat.example/post/${POST}`, authorHandle: null, state: null, level: null } }).success).toBe(true);
  });

  test("a withheld snapshot carries its id, time and digest and no content, whatever the answer held", () => {
    const withheld = CaseSnapshot.parse({ ...shown, withheld: true });
    expect(Object.keys(withheld).sort()).toEqual(["digest", "id", "takenAt", "withheld"]);
  });

  test("a snapshot that is shown carries everything its digest covers: the console recomputes the digest from the answer", async () => {
    const parsed = CaseSnapshot.parse(shown);
    if (parsed.withheld) throw new Error("the snapshot is shown");
    const expected = await snapshotDigest({ ...shown, targetType: "post", postState: "visible" });
    expect(await snapshotDigest(parsed)).toBe(expected);
    const { salt: _salt, ...withoutSalt } = shown;
    expect(CaseSnapshot.safeParse(withoutSalt).success).toBe(false);
  });

  test("a seal's list holds at most the 500 rows the case answer carries", () => {
    const row = { postId: POST, createdAt: TIME, images: 1 };
    const withList = (rows: number) => ({ ...view, decisions: [{ ...view.decisions[0]!, actions: [{ ...view.decisions[0]!.actions[0]!, sealed: { posts: rows, images: rows, deletedPosts: 0, list: Array.from({ length: rows }, () => row) } }] }] });
    expect(CaseView.safeParse(withList(500)).success).toBe(true);
    expect(CaseView.safeParse(withList(501)).success).toBe(false);
  });

  test("suspicion holds counts and days only", () => {
    const bad = { ...view, suspicion: { ...view.suspicion, earlier: { target: { count: 0, lastOn: TIME, imagesOpenedOn: null }, author: { count: 0, lastOn: null } } } };
    expect(CaseView.safeParse(bad).success).toBe(false);
    expect(CaseView.safeParse({ ...view, suspicion: { ...view.suspicion, reach: { ...view.suspicion.reach, newestPostOn: TIME } } }).success).toBe(false);
  });
});

describe("the queue and the overview", () => {
  const row = { id: CASE, lane: 0, targetType: "post", openedAt: TIME, oldestOpenAt: TIME, openItems: 2, rules: ["R5"], categories: ["STATEMENT_CATEGORY_VIOLENCE"], allegesIllegal: true, suspect: false, reexamination: false, deferred: false };

  test("a page of the queue holds at most 50 cases and the cursor of the next", () => {
    expect(QUEUE_PAGE_SIZE).toBe(50);
    expect(QueuePage.safeParse({ cases: [row], nextCursor: null }).success).toBe(true);
    expect(QueuePage.safeParse({ cases: Array.from({ length: 50 }, () => row), nextCursor: "abc_-123" }).success).toBe(true);
    expect(QueuePage.safeParse({ cases: Array.from({ length: 51 }, () => row), nextCursor: null }).success).toBe(false);
    expect(QueuePage.safeParse({ cases: [{ ...row, lane: 3 }], nextCursor: null }).success).toBe(false);
  });

  test("the queue's cursor is an opaque word: letters, digits, dashes and underscores", () => {
    expect(QueueQuery.safeParse({}).success).toBe(true);
    expect(QueueQuery.safeParse({ cursor: "eyJhIjoxfQ_-" }).success).toBe(true);
    for (const cursor of ["", "a b", "a/b", "a=b", "x".repeat(401)]) expect(QueueQuery.safeParse({ cursor }).success, cursor).toBe(false);
  });

  test("the overview holds counts, times, staff handles and cases", () => {
    const overview = {
      lanes: [
        { lane: 0, open: 2, oldestAt: TIME },
        { lane: 1, open: 0, oldestAt: null },
        { lane: 2, open: 5, oldestAt: TIME },
      ],
      appealsWaiting: 3,
      reveals: { total: 1, items: [{ at: TIME, handle: "mod_anna", caseId: CASE }] },
      imagesToday: [{ handle: "mod_anna", count: 4 }],
      findingsToday: [{ handle: "mod_anna", count: 1 }],
      mailsWaiting: { receipts: 0, authorMails: 1, outcomes: 0 },
      mailsFailed: { receipts: 0, authorMails: 0, outcomes: 2 },
      releaseOverdue: 0,
      deferUnproven: false,
    };
    expect(StaffOverview.safeParse(overview).success).toBe(true);
    expect(StaffOverview.safeParse({ ...overview, lanes: overview.lanes.slice(0, 2) }).success).toBe(false);
    expect(StaffOverview.safeParse({ ...overview, reveals: { total: 101, items: Array.from({ length: 101 }, () => overview.reveals.items[0]) } }).success).toBe(false);
    expect(StaffOverview.safeParse({ ...overview, releaseOverdue: -1 }).success).toBe(false);
  });
});
```

### Replace `apps/admin/test/browser/console.browser.ts` (whole file)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildConsole } from "../../build.mjs";
import { CONSOLE_CSP } from "../../site-headers.mjs";
import { FINDING_WORDS, messageFor, STAFF_MESSAGES } from "../../src/messages";
import { ART_18_BANNER, IMAGES_NOT_SHOWN, SUSPECT_BANNER } from "../../src/screens/Case";
import { UNAVAILABLE_TEXT } from "../../src/screens/Unavailable";
import { SIGN_IN_WINDOW_MS } from "../../src/signins";
import { clockTime } from "../../src/ui";
import { consoleSiteHeadersFromCaddyfile } from "../caddyfile";
import { CASE_ACCOUNT, CASE_FROZEN, CASE_POST, CASE_QUOTED, IMAGE_ONE, IMAGE_TWO, ITEM_REPORTER, LONGEST_EXPLANATION, LONGEST_NOTE, LOOKALIKE, POST_ID } from "../case-fixtures";
import { HOSTILE } from "../fixtures";
import {
  createFixtureApi,
  CURRENT_BROWSER,
  DEAD_LINK,
  EXISTING_KEY_NAMES,
  FORGED_REASON,
  HOSTILE_TEXTS,
  IMAGE_PATH,
  OTHER_BROWSERS,
  PERSON_HANDLE,
  REVEALED_HANDLE,
  TYPED_KEY_NAME,
  TYPED_NOTE,
  type FixtureApi,
} from "./fixture-api";
import { startConsoleSite, type ConsoleSiteServer } from "./server";
import { inspect, userTexts, watch, type Watcher } from "./watch";

/**
 * The console's browser check (3a design, section 12). It builds the console, serves the build with the routes and headers
 * of Caddy's console site read from infra/caddy/Caddyfile, answers /api/staff/* from fixtures whose user-written strings
 * are hostile (markup, javascript: URLs, a direction override, the longest names allowed), and drives Chromium through
 * playwright-core with a CDP virtual authenticator over every screen: the console switched off, enrolment (a synced
 * passkey refused, then a device-bound key that verifies its user, whose success page signs in with that key), home, a
 * session revoked with the key, step-up options that bind another action refused before the key is asked, the audit log,
 * an address the console does not have, the ended session, a second key enrolled while signed in, whose success page
 * asks that key and no other, sign-out, and sign-in options that carry a step-up challenge refused before the key is
 * asked. For moderation cases (3c design, section 8) it walks the home screen's overview, the queue with a finding, a
 * case with its images shown on request, an image the API refuses, a case whose images cannot be opened, an account's
 * case with a fresh snapshot, a reveal, and a save that the API answers with the digest of another text. Each step fails
 * on any policy report through any channel console-lab.md names, any page error and any dialog. It needs no database and
 * writes nothing but a temporary build.
 *
 * It never downloads a browser. By default it drives the Chromium build playwright-core 1.63.0 names (chromium-1243 under
 * ms-playwright), which must already be installed; KORBAT_BROWSER_CHANNEL=chrome drives the machine's own Chrome instead,
 * as CI does with the runner's.
 */
const CHANNEL = process.env.KORBAT_BROWSER_CHANNEL || "chromium";

let out = "";
let site: ConsoleSiteServer | undefined;
let browser: Browser | undefined;
let context: BrowserContext;
let page: Page;
let watcher: Watcher;
let fixtures: FixtureApi;
let origin = "";
/** The device-bound authenticator that holds the first staff key enrolled. */
let staffAuthenticator = "";
/** Every device-bound authenticator the walk enrolled a staff key on. */
const staffAuthenticators: string[] = [];
/** Every person-written string the walk has found shown as text. */
const seen = new Set<string>();
/** The headers each static file was served with, by path. */
const served = new Map<string, Record<string, string>>();

/** The text of every element holding a person-written string or an action, kept in `seen`. */
async function texts(): Promise<string[]> {
  const found = await userTexts(page);
  for (const text of found) seen.add(text);
  return found;
}

/** Waits for a locator to show, failing with what it looked for. */
async function shown(locator: Locator, timeout = 15_000): Promise<void> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch {
    throw new Error(`not shown within ${timeout} ms: ${locator.toString()}`);
  }
}

/** A virtual CTAP2 authenticator that verifies its user: a security key on USB, or a platform one whose passkeys sync. */
async function addAuthenticator(kind: "device-bound security key" | "synced platform passkey"): Promise<string> {
  const synced = kind === "synced platform passkey";
  const { authenticatorId } = await watcher.cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: synced ? "internal" : "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      // The flags a password manager's passkey reports, and a security key never does.
      defaultBackupEligibility: synced,
      defaultBackupState: synced,
    },
  });
  return authenticatorId;
}

/** How many times an authenticator's keys have signed: the virtual authenticator counts every signature. */
async function signaturesOf(authenticatorId: string): Promise<number> {
  const { credentials } = await watcher.cdp.send("WebAuthn.getCredentials", { authenticatorId });
  return credentials.reduce((sum, credential) => sum + credential.signCount, 0);
}

/** How many times every staff key of the walk has signed. */
async function signatures(): Promise<number> {
  let sum = 0;
  for (const id of staffAuthenticators) sum += await signaturesOf(id);
  return sum;
}

/**
 * Waits until an expression is true in the page. The expression is plain text, sent as page.evaluate sends it: nothing
 * of the test runner's is put into the page, and nothing in the page evaluates it under the page's policy.
 */
async function until(expression: string, what: string): Promise<void> {
  for (let tries = 0; tries < 150; tries++) {
    if (await page.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`not within 15 s: ${what}`);
}

/** The one image of the page: whether it is there, loaded as a real image of 2 by 2 pixels, from this address, drawn with this class. */
const imageIs = (src: string, className: string) =>
  `(() => { const all = document.querySelectorAll("img"); const i = all[0]; return all.length === 1 && i.getAttribute("src") === ${JSON.stringify(src)} && i.className === ${JSON.stringify(className)} && i.complete && i.naturalWidth === 2 && i.naturalHeight === 2; })()`;

/** The end of every step: no report, error or dialog on any channel, nothing in the page the console never writes, and no request the fixtures refused for the page's fault. */
async function clean(): Promise<void> {
  expect(watcher.take()).toEqual([]);
  expect(await inspect(page)).toEqual([]);
  expect(fixtures.state.problems).toEqual([]);
}

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), "korbat-admin-browser-"));
  await buildConsole({ outdir: out });
  fixtures = createFixtureApi();
  site = await startConsoleSite({ dist: out, api: fixtures.handle });
  origin = site.origin;
  fixtures.state.origin = origin;
  browser = await chromium.launch({ channel: CHANNEL, headless: true });
  context = await browser.newContext({ timezoneId: "UTC", locale: "en-GB", viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  watcher = await watch(context, page, origin);
  await watcher.cdp.send("WebAuthn.enable", { enableUI: false });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) served.set(url.pathname, response.headers());
  });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("the staff console in Chromium, under the console site's policy", () => {
  test("the page, its script and its stylesheet come with the Caddyfile's console headers, the policy of section 3 among them", async () => {
    fixtures.state.off = true;
    await page.goto(`${origin}/`);
    await shown(page.getByText(UNAVAILABLE_TEXT));
    const headersFor = consoleSiteHeadersFromCaddyfile();
    expect(headersFor("/", false)["Content-Security-Policy"]).toBe(CONSOLE_CSP);
    const assets = [...served.keys()].filter((p) => p.startsWith("/assets/"));
    expect(assets.map((p) => path.extname(p)).sort()).toEqual([".css", ".js"]);
    // The page is index.html answered for "/", which names no file; the script and the stylesheet are files of the build.
    for (const p of ["/", ...assets]) {
      const sent = served.get(p)!;
      for (const [name, value] of Object.entries(headersFor(p, p !== "/"))) expect(sent[name.toLowerCase()], `${p} ${name}`).toBe(value);
    }
    expect(served.get("/")!["cache-control"]).toBe("no-store, no-transform");
    for (const p of assets) expect(served.get(p)!["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("a console that is off shows only that it is not available at this address", async () => {
    expect(await page.locator("#root").innerText()).toBe(UNAVAILABLE_TEXT);
    expect(await page.getByRole("button").count()).toBe(0);
    fixtures.state.off = false;
    await clean();
  });

  test("enrolment: a synced passkey is refused and explained while the link still works, then a device-bound key registers", async () => {
    const synced = await addAuthenticator("synced platform passkey");
    await page.goto(`${origin}/enroll/${fixtures.state.enrolmentToken}`);
    await shown(page.getByRole("heading", { name: "Register a staff key" }));
    await page.getByLabel("Name of this key").fill(TYPED_KEY_NAME);
    await page.getByRole("button", { name: "Use Windows Hello on this computer" }).click();
    await shown(page.getByText(STAFF_MESSAGES.staff_key_not_device_bound));
    await shown(page.getByText("This link still works", { exact: false }));
    // The console's relying party ID is not the app's here, so the page asked the browser to drop the refused passkey, or
    // says to delete it by hand where the browser could not.
    await shown(page.getByText(/asked to remove the refused passkey|Delete the refused entry/));
    expect(fixtures.state.enrolmentUsed).toBe(false);
    await clean();

    await watcher.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: synced });
    staffAuthenticator = await addAuthenticator("device-bound security key");
    staffAuthenticators.push(staffAuthenticator);
    await page.getByRole("button", { name: "Register a security key" }).click();
    await shown(page.getByText("is registered", { exact: false }));
    expect(await texts()).toContain(TYPED_KEY_NAME);
    expect(fixtures.state.enrolmentUsed).toBe(true);
    await clean();
  });

  test("the success page signs in with the new key, which opens the console, and home follows", async () => {
    // The registration counted as one use of the key; the sign-in is the next.
    const before = await signatures();
    await page.getByRole("button", { name: "Sign in with this key" }).click();
    await shown(page.getByText("opened the console", { exact: false }));
    expect(await signatures()).toBe(before + 1);
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    expect(page.url()).toBe(`${origin}/`);
    await clean();
  });

  test("home: who is signed in, the sign-ins of 7 days, the sessions and the keys, every written string as text", async () => {
    const current = [...fixtures.state.sessions.values()].find((s) => s.browser === CURRENT_BROWSER)!;
    await shown(page.getByText(`Signed in until ${clockTime(new Date(current.createdAt + 12 * 60 * 60_000).toISOString())}.`));
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    // Every sign-in of the last 7 days, read page by page, and none older.
    const since = Date.now() - SIGN_IN_WINDOW_MS;
    const recent = fixtures.state.audit.filter((row) => row.action === "staff_sign_in" && Date.parse(row.createdAt) >= since);
    expect(recent.length).toBeGreaterThan(50);
    expect(await page.locator("ul.signins li").count()).toBe(recent.length);
    expect(fixtures.state.requests.filter((r) => r.path.startsWith("/api/staff/audit?action=staff_sign_in")).length).toBe(2);
    // The sessions: this one and the two others; the keys: the two the person held and the new one.
    expect(await page.locator("table tbody tr").count()).toBe(3);
    expect(await page.locator("ul.keys li").count()).toBe(EXISTING_KEY_NAMES.length + 1);
    const shownTexts = await texts();
    for (const text of [PERSON_HANDLE, CURRENT_BROWSER, ...OTHER_BROWSERS, ...EXISTING_KEY_NAMES, TYPED_KEY_NAME]) expect(shownTexts, text).toContain(text);
    await clean();
  });

  test("a session revoked with the key: the step-up's options check out, the key signs once, and the session goes", async () => {
    const before = await signatures();
    const target = [...fixtures.state.sessions.values()].find((s) => s.browser === OTHER_BROWSERS[0])!;
    const row = page.locator("table tbody tr").filter({ hasText: OTHER_BROWSERS[0] });
    await row.getByRole("button", { name: "Sign out that session" }).click();
    await shown(page.getByText("That session is signed out."));
    await row.waitFor({ state: "detached" });
    expect(await signatures()).toBe(before + 1);
    expect(fixtures.state.revoked).toEqual([target.handle]);
    expect(await page.locator("table tbody tr").count()).toBe(2);
    await clean();
  });

  test("step-up options that bind another action are refused before the key is asked", async () => {
    const before = await signatures();
    const optionsBefore = fixtures.state.stepUpOptionsServed;
    const deletes = fixtures.state.requests.filter((r) => r.method === "DELETE").length;
    fixtures.state.mismatchNextStepUp = true;
    const row = page.locator("table tbody tr").filter({ hasText: OTHER_BROWSERS[1] });
    await row.getByRole("button", { name: "Sign out that session" }).click();
    await shown(page.getByText(messageFor("step_up_mismatch")));
    expect(fixtures.state.stepUpOptionsServed).toBe(optionsBefore + 1);
    // The key signed nothing, no revocation was sent, and the session is still listed.
    expect(await signatures()).toBe(before);
    expect(fixtures.state.requests.filter((r) => r.method === "DELETE").length).toBe(deletes);
    expect(await row.count()).toBe(1);
    await clean();
  });

  test("the audit log: the newest page, Load older, Go to place and back to the newest", async () => {
    await page.getByRole("link", { name: "Audit log" }).click();
    await page.waitForURL(`${origin}/audit`);
    const rows = page.locator("table.audit tbody tr");
    await shown(rows);
    const newest = fixtures.state.audit[0]!.seq;
    expect(await rows.count()).toBe(50);
    expect(await rows.first().locator("td").first().textContent()).toBe(String(newest));
    await page.getByRole("button", { name: "Load older" }).click();
    await rows.nth(50).waitFor();
    expect(await rows.count()).toBe(100);
    await page.getByLabel("Place").fill("75");
    await page.getByRole("button", { name: "Go to place" }).click();
    await shown(page.getByText("From place 75, newest first."));
    expect(await rows.first().locator("td").first().textContent()).toBe("75");
    const shownTexts = await texts();
    for (const row of fixtures.state.audit.filter((r) => r.seq <= 75 && r.seq > 25)) {
      for (const text of [row.actorHandle, row.action, row.targetType, row.targetId, row.hash]) if (text !== null) expect(shownTexts, text).toContain(text);
    }
    await page.getByRole("button", { name: "Newest" }).click();
    await page.getByText("From place 75, newest first.").waitFor({ state: "detached" });
    expect(await rows.first().locator("td").first().textContent()).toBe(String(newest));
    await clean();
  });

  test("home shows the cases' overview: the lanes, the appeals waiting and every reveal with its staff handle and its case", async () => {
    await page.getByRole("link", { name: "Home" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    await shown(page.getByText("Urgent: 2 cases, oldest", { exact: false }));
    await shown(page.getByText("Lane 1: no open case"));
    await shown(page.getByText("3 appeals wait."));
    expect(await page.locator("ul.reveals li").count()).toBe(1);
    expect(await page.locator("ul.reveals a").getAttribute("href")).toBe(`/cases/${CASE_POST}`);
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await texts();
    await clean();
  });

  test("the queue: open cases by lane and age with their marks, Load more, and Open a case on a finding", async () => {
    await page.getByRole("link", { name: "Queue" }).click();
    await page.waitForURL(`${origin}/queue`);
    const rows = page.locator("table.queue tbody tr");
    await shown(rows);
    expect(await rows.count()).toBe(2);
    expect(await rows.first().innerText()).toContain("CSAM: no images");
    expect(await rows.first().innerText()).toContain("re-examination");
    await page.getByRole("button", { name: "Load more" }).click();
    await rows.nth(2).waitFor();
    expect(await rows.count()).toBe(3);
    expect(await rows.nth(2).innerText()).toContain("deferred");
    await page.getByRole("button", { name: "Load more" }).waitFor({ state: "detached" });
    expect(await page.evaluate(`[...document.querySelectorAll("table.queue a")].map((link) => link.getAttribute("href"))`)).toEqual([`/cases/${CASE_FROZEN}`, `/cases/${CASE_ACCOUNT}`, `/cases/${CASE_POST}`]);

    // A link that is no web address is never sent; a link that names nothing is worded in the form's own words.
    const sent = () => fixtures.state.requests.filter((r) => r.path === "/api/staff/findings").length;
    await page.getByLabel("Link on korbat").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Open a case" }).click();
    await shown(page.getByText(FINDING_WORDS.invalid_request));
    expect(sent()).toBe(0);
    await page.getByLabel("Link on korbat").fill(DEAD_LINK);
    await page.getByRole("button", { name: "Open a case" }).click();
    await shown(page.getByText(FINDING_WORDS.not_found));
    expect(sent()).toBe(1);
    expect(fixtures.state.findings).toEqual([]);
    await clean();

    // A finding under R6 with its preset category opens the case it joined.
    const link = `http://localhost:8081/post/${POST_ID}`;
    await page.getByLabel("Link on korbat").fill(link);
    await page.getByLabel("Rule", { exact: true }).selectOption("R6");
    await page.getByRole("button", { name: "Open a case" }).click();
    await page.waitForURL(`${origin}/cases/${CASE_POST}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    expect(fixtures.state.findings).toEqual([{ target: { kind: "link", url: link }, ground: "rule", ruleId: "R6", category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" }]);
    await clean();
  });

  test("a case: every written string as text in its frame, an image only when asked for, first small and blurred, then large and clear, one at a time; a note saved with its digest", async () => {
    // Nothing was asked of the image route by opening the case.
    expect(fixtures.state.imageRequests).toEqual([]);
    expect(await page.locator(".placeholder").count()).toBe(2);
    expect(await page.locator("img").count()).toBe(0);
    const small = `/api/staff/cases/${CASE_POST}/media/${IMAGE_ONE}/small`;
    const large = `/api/staff/cases/${CASE_POST}/media/${IMAGE_ONE}/large`;
    await page.getByRole("button", { name: "Show image" }).first().click();
    await until(imageIs(small, "evidence blurred"), "the small image, blurred");
    expect(fixtures.state.imageRequests).toEqual([small]);
    // The image is the console's own, drawn by its one image site: the page holds nothing else it does not write.
    expect(await inspect(page)).toEqual([]);
    expect(await page.evaluate(`getComputedStyle(document.querySelector("img.evidence")).filter`)).toContain("blur");
    await page.getByRole("button", { name: "Show clearly" }).click();
    await until(imageIs(large, "evidence"), "the large image, clear");
    expect(await page.evaluate(`getComputedStyle(document.querySelector("img.evidence")).filter`)).toBe("none");
    expect(fixtures.state.imageRequests).toEqual([small, large]);
    // The second image takes the first one's place.
    await page.getByRole("button", { name: "Show image" }).click();
    await until(imageIs(`/api/staff/cases/${CASE_POST}/media/${IMAGE_TWO}/small`, "evidence blurred"), "the second image alone");
    await page.getByRole("button", { name: "Hide image" }).click();
    await page.locator("img").waitFor({ state: "detached" });
    expect(fixtures.state.imageRequests).toHaveLength(3);
    // No image request carried anything but the session's cookie: the route's answer came from this origin alone.
    expect(fixtures.state.requests.filter((r) => IMAGE_PATH.test(r.path)).map((r) => r.status)).toEqual([200, 200, 200]);

    await page.getByRole("button", { name: "Show hidden characters" }).first().click();
    await shown(page.getByRole("button", { name: "Show the text as written" }));
    await page.getByRole("button", { name: "Show the text as written" }).click();

    await page.getByLabel("Add a note").fill(TYPED_NOTE);
    await page.getByRole("button", { name: "Save the note" }).click();
    await shown(page.getByText("The note is saved."));
    expect(fixtures.state.texts.at(-1)).toMatchObject({ caseId: CASE_POST, kind: "note", text: TYPED_NOTE });
    const shownTexts = await texts();
    for (const text of [TYPED_NOTE, LOOKALIKE.label, LONGEST_EXPLANATION, LONGEST_NOTE]) expect(shownTexts, text.slice(0, 40)).toContain(text);
    // The post's text names two hosts and one address whose host no browser reads (a direction override ends it): the
    // frame lists the two, and says that the third is there.
    expect(await page.locator("p.hint", { hasText: "Mentions addresses at:" }).first().innerText()).toBe("Mentions addresses at: korbat.example.evil.test, evil.test and an address this console cannot read");
    // The page holds no link but the console's own navigation.
    expect(await page.locator("main a").count()).toBe(0);
    await clean();
  });

  test("an image the API refuses says so in its place, in the console's words, and the case is read again", async () => {
    const reads = () => fixtures.state.requests.filter((r) => r.method === "GET" && r.path === `/api/staff/cases/${CASE_POST}`).length;
    const [asked, read] = [fixtures.state.imageRequests.length, reads()];
    // The post was frozen between the page's read of the case and the browser's request, as far as the page can tell.
    fixtures.state.refuseNextImage = true;
    await page.getByRole("button", { name: "Show image" }).first().click();
    await shown(page.locator(".placeholder").first().getByText(messageFor("image_refused"), { exact: true }));
    expect(await page.locator("img").count()).toBe(0);
    expect(fixtures.state.imageRequests).toHaveLength(asked + 1);
    expect(fixtures.state.requests.filter((r) => IMAGE_PATH.test(r.path)).at(-1)!.status).toBe(404);
    // What may be opened may have changed, so the page read the case again, once.
    for (let tries = 0; tries < 150 && reads() === read; tries++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reads()).toBe(read + 1);
    // Nothing offers to show the refused image more clearly; its person puts it away, and it is asked for only on a new click.
    expect(await page.getByRole("button", { name: "Show clearly" }).count()).toBe(0);
    await page.getByRole("button", { name: "Hide image" }).click();
    await shown(page.getByText("Image 1, not shown"));
    expect(fixtures.state.imageRequests).toHaveLength(asked + 1);
    await clean();
  });

  test("a case whose images cannot be opened: the banners, the sentence above the images' entries, each entry without its image, a re-examination item, the quoted post's case as the only link, and no image request", async () => {
    const asked = fixtures.state.imageRequests.length;
    await page.getByRole("link", { name: "Queue" }).click();
    await page.waitForURL(`${origin}/queue`);
    await page.locator("table.queue tbody tr").first().getByRole("link", { name: "Open the case" }).click();
    await page.waitForURL(`${origin}/cases/${CASE_FROZEN}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    await shown(page.getByText(ART_18_BANNER));
    await shown(page.getByText(SUSPECT_BANNER.nobody));
    await shown(page.getByText(SUSPECT_BANNER.post));
    await shown(page.getByText(IMAGES_NOT_SHOWN));
    await shown(page.getByText("Re-examination of item 1 of its notice"));
    await shown(page.getByText("You decided the item this re-examines. Leave it to another staff member when there is one."));
    expect(await page.locator("img").count()).toBe(0);
    expect(await page.locator(".placeholder").count()).toBe(0);
    expect(await page.getByRole("button", { name: "Show image" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Reveal who sent this" }).count()).toBe(0);
    // Each image still has its entry: its number, its size as text, and its alt text in an author frame. The case cites
    // R5, so the frame opens on request; then the alt text is there as its author wrote it.
    expect(await page.locator("ul.images li").count()).toBe(2);
    await shown(page.locator("ul.images li").first().getByText("Image 1", { exact: true }));
    await shown(page.locator("ul.images li").first().getByText("2048 by 1536 pixels", { exact: true }));
    const altFrames = page.locator("ul.images .frame");
    expect(await altFrames.count()).toBe(2);
    expect(await altFrames.locator(".frame-label").allInnerTexts()).toEqual(["Alt text. Written by the author", "Alt text. Written by the author"]);
    await altFrames.first().getByRole("button", { name: "Show text (R5: direct threats)" }).click();
    expect(await altFrames.first().locator("p.frame-text").textContent()).toBe(HOSTILE.quote);
    await page.getByRole("button", { name: "Show the list of posts" }).click();
    await shown(page.getByText("and 500 more: use the runbook's query for a seal's posts"));
    // The one link of the page leads to the quoted post's case, in the console.
    expect(await page.evaluate(`[...document.querySelectorAll("main a")].map((link) => link.getAttribute("href"))`)).toEqual([`/cases/${CASE_QUOTED}`]);
    await texts();
    await clean();
    await page.locator("main a").click();
    await page.waitForURL(`${origin}/cases/${CASE_QUOTED}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    expect(fixtures.state.imageRequests).toHaveLength(asked);
    await clean();
  });

  test("an account's case with an unanswered suspect item: the account's sentences, a fresh snapshot, no image request and no link into the app", async () => {
    const asked = fixtures.state.imageRequests.length;
    await page.getByRole("link", { name: "Queue" }).click();
    await page.waitForURL(`${origin}/queue`);
    await page.locator("table.queue tbody tr").nth(1).getByRole("link", { name: "Open the case" }).click();
    await page.waitForURL(`${origin}/cases/${CASE_ACCOUNT}`);
    await shown(page.getByRole("heading", { name: "Case about an account" }));
    await shown(page.getByText(SUSPECT_BANNER.noImage));
    await shown(page.getByText(SUSPECT_BANNER.account));
    expect(await page.getByText(SUSPECT_BANNER.post).count()).toBe(0);
    expect(await page.locator("main a").count()).toBe(0);
    expect(await page.locator("img").count()).toBe(0);
    // The display name and the bio, as they read now and as the snapshot copied them, each in a frame that says what it is.
    expect(await page.getByText("Display name. Written by the author", { exact: true }).count()).toBe(2);
    expect(await page.getByText("Bio. Written by the author", { exact: true }).count()).toBe(2);
    // The account's fields changed since the report: a fresh snapshot is offered, and taken.
    await page.getByRole("button", { name: "Take a fresh snapshot" }).click();
    await shown(page.getByText("A fresh snapshot is the case's newest now."));
    expect(fixtures.state.snapshotsTaken).toBe(1);
    await page.getByRole("button", { name: "Take a fresh snapshot" }).waitFor({ state: "detached" });
    expect(fixtures.state.imageRequests).toHaveLength(asked);
    await texts();
    await clean();
  });

  test("a reveal: nothing to confirm until a reason is chosen and written; the reason saved first, the key confirming its digest; the name in a frame of its own, kept when the case cannot be read again and gone once the dialog is closed; options that bind another item are refused before the key is asked", async () => {
    await page.goto(`${origin}/cases/${CASE_POST}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    const before = await signatures();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Confirm with your staff key" });
    const why = dialog.getByLabel("Why");
    const written = dialog.getByLabel("Reason", { exact: true });
    await page.getByRole("button", { name: "Reveal who sent this" }).first().click();
    await shown(dialog);
    // No reason is chosen for the person and none is written: there is nothing to confirm yet.
    expect(await why.inputValue()).toBe("");
    expect(await confirm.isDisabled()).toBe(true);
    await why.selectOption("abuse_of_reporting");
    expect(await confirm.isDisabled()).toBe(true);
    await written.fill("   ");
    expect(await confirm.isDisabled()).toBe(true);
    await written.fill("The same account reported forty posts of one author in an hour.");
    expect(await confirm.isDisabled()).toBe(false);
    // The read of the case that follows the reveal will be refused: the page, and the name it has just shown, must stay.
    fixtures.state.recuseNextCaseRead = true;
    await confirm.click();
    await shown(dialog.getByText("Revealed to you; recorded and shown to every staff member"));
    expect(await signatures()).toBe(before + 1);
    const reason = fixtures.state.texts.find((text) => text.kind === "reveal_reason")!;
    expect(reason).toMatchObject({ caseId: CASE_POST, text: "The same account reported forty posts of one author in an hour." });
    expect(fixtures.state.reveals).toEqual([{ itemId: ITEM_REPORTER, reasonDigest: reason.digest }]);
    // The name alone in its frame, under the console's own line that says what it is, with its hidden characters to show.
    await shown(dialog.getByText("The reporter's handle:", { exact: true }));
    expect(await dialog.locator(".frame p.frame-text").textContent()).toBe(REVEALED_HANDLE);
    await shown(dialog.getByRole("button", { name: "Show hidden characters" }));
    // The refused read left the case on the page and says why on the page's error line; the name is still there.
    await shown(page.getByRole("alert").filter({ hasText: messageFor("staff_recused") }));
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    expect(fixtures.state.requests.filter((r) => r.path === `/api/staff/cases/${CASE_POST}`).at(-1)!.status).toBe(403);
    expect(await dialog.locator(".frame p.frame-text").textContent()).toBe(REVEALED_HANDLE);
    expect(await texts()).toContain(REVEALED_HANDLE);
    // Shown once: with the dialog closed the page holds the name nowhere.
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached" });
    expect(await userTexts(page)).not.toContain(REVEALED_HANDLE);
    expect(await page.locator("#root").innerText()).not.toContain("a_reporter");
    await clean();

    // The server asks the key to confirm the reveal of another item: the key is never asked, and nothing is revealed.
    const reveals = fixtures.state.requests.filter((r) => r.path.endsWith("/reveal")).length;
    fixtures.state.mismatchNextStepUp = true;
    await page.getByRole("button", { name: "Reveal who sent this" }).nth(1).click();
    await why.selectOption("impersonation_claim");
    await written.fill("The notifier claims to be impersonated.");
    await confirm.click();
    await shown(page.getByText(messageFor("step_up_mismatch")));
    expect(await signatures()).toBe(before + 1);
    expect(fixtures.state.requests.filter((r) => r.path.endsWith("/reveal")).length).toBe(reveals);
    expect(fixtures.state.reveals).toHaveLength(1);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await clean();
  });

  test("a save answered with the digest of another text is refused by the page: no options are asked, the key signs nothing, and nothing is revealed", async () => {
    const before = await signatures();
    const options = fixtures.state.stepUpOptionsServed;
    const reveals = fixtures.state.requests.filter((r) => r.path.endsWith("/reveal")).length;
    const dialog = page.getByRole("dialog");
    // The API stores a reason of its own in the person's name and answers its digest: a reveal confirmed under that
    // digest would go through, so only the page's own check stands between the key and a reason nobody wrote.
    fixtures.state.hostileNextSave = true;
    await page.getByRole("button", { name: "Reveal who sent this" }).nth(1).click();
    await dialog.getByLabel("Why").selectOption("legal_requirement");
    await dialog.getByLabel("Reason", { exact: true }).fill("A court asked who sent this notice.");
    await dialog.getByRole("button", { name: "Confirm with your staff key" }).click();
    await shown(dialog.getByText(messageFor("invalid_answer")));
    expect(fixtures.state.texts.at(-1)).toMatchObject({ caseId: CASE_POST, kind: "reveal_reason", text: FORGED_REASON });
    expect(fixtures.state.forgedDigests).toHaveLength(1);
    expect(fixtures.state.stepUpOptionsServed).toBe(options);
    expect(await signatures()).toBe(before);
    expect(fixtures.state.requests.filter((r) => r.path.endsWith("/reveal")).length).toBe(reveals);
    expect(fixtures.state.reveals).toHaveLength(1);
    // What the person wrote is still in the dialog, to be confirmed again or put away.
    expect(await dialog.getByLabel("Reason", { exact: true }).inputValue()).toBe("A court asked who sent this notice.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached" });
    await clean();
  });

  test("an address the console does not have says so, inside the console", async () => {
    await page.goto(`${origin}/no/such/page`);
    await shown(page.getByRole("heading", { name: "No such page" }));
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    // Every read the home screen started has finished before the walk moves on, so none is in flight when the session ends.
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await page.getByRole("link", { name: "Audit log" }).click();
    await shown(page.locator("table.audit tbody tr"));
    await clean();
  });

  test("the ended session: sign-in in place at the same address, both staff cookies gone, and the same page after", async () => {
    fixtures.endEverySession();
    await page.getByRole("button", { name: "Load older" }).click();
    await shown(page.getByText("Your staff session ended."));
    expect(page.url()).toBe(`${origin}/audit`);
    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith("__Host-korbat_staff"))).toEqual([]);
    await page.getByRole("button", { name: "Sign in with your staff key" }).click();
    await shown(page.getByRole("heading", { name: "Audit log" }));
    await shown(page.locator("table.audit tbody tr"));
    expect(page.url()).toBe(`${origin}/audit`);
    await clean();
  });

  test("a second key enrolled while signed in: its success page asks that key, never the session's, and signs in with it", async () => {
    const first = staffAuthenticator;
    const token = fixtures.issueEnrolment();
    // The first key holds the live session; it could answer nothing here unless the page asked it, which this would show.
    await watcher.cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: first, enabled: false });
    const second = await addAuthenticator("device-bound security key");
    staffAuthenticators.push(second);
    await page.goto(`${origin}/enroll/${token}`);
    await shown(page.getByRole("heading", { name: "Register a staff key" }));
    await page.getByLabel("Name of this key").fill("Backup key");
    await page.getByRole("button", { name: "Register a security key" }).click();
    await shown(page.getByText("is registered", { exact: false }));
    const newKey = fixtures.state.keys[fixtures.state.keys.length - 1]!;
    expect(newKey.name).toBe("Backup key");
    const [firstBefore, secondBefore] = [await signaturesOf(first), await signaturesOf(second)];
    // The browser still holds the first key's session: the sign-in page would show home and ask no key.
    expect((await context.cookies()).some((cookie) => cookie.name === "__Host-korbat_staff")).toBe(true);
    await page.getByRole("button", { name: "Sign in with this key" }).click();
    await shown(page.getByText("opened the console", { exact: false }));
    expect(await signaturesOf(second)).toBe(secondBefore + 1);
    expect(await signaturesOf(first)).toBe(firstBefore);
    // The session it opened is the new key's.
    expect([...fixtures.state.sessions.values()].filter((s) => s.credentialId === newKey.credentialId)).toHaveLength(1);
    await watcher.cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: first, enabled: true });
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await clean();
  });

  test("sign-out ends the session and shows sign-in at its own address", async () => {
    const before = fixtures.state.sessions.size;
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(`${origin}/signin`);
    await shown(page.getByRole("button", { name: "Sign in with your staff key" }));
    expect(await page.getByText("Your staff session ended.").count()).toBe(0);
    // The session the page held, the second key's, is gone; the first key's, which this browser no longer names, stays.
    expect(fixtures.state.sessions.size).toBe(before - 1);
    expect([...fixtures.state.sessions.values()].some((s) => s.credentialId === fixtures.state.keys[fixtures.state.keys.length - 1]!.credentialId)).toBe(false);
    await clean();
  });

  test("sign-in options that carry a step-up challenge are refused before the key is asked", async () => {
    const before = await signatures();
    const served = fixtures.state.signInOptionsServed;
    const verifies = fixtures.state.requests.filter((r) => r.path === "/api/staff/signin/verify").length;
    fixtures.state.stepUpChallengeAtNextSignIn = true;
    await page.getByRole("button", { name: "Sign in with your staff key" }).click();
    await shown(page.getByText(messageFor("signin_mismatch")));
    expect(fixtures.state.signInOptionsServed).toBe(served + 1);
    // No key signed anything and nothing was sent after the options: the forged confirmation was never made.
    expect(await signatures()).toBe(before);
    expect(fixtures.state.requests.filter((r) => r.path === "/api/staff/signin/verify").length).toBe(verifies);
    expect(page.url()).toBe(`${origin}/signin`);
    await clean();
  });

  test("every request the walk sent was its person's own, marked, and every string the fixtures wrote was shown as text", () => {
    expect(watcher.take()).toEqual([]);
    expect(fixtures.state.requests.length).toBeGreaterThan(20);
    // An image is asked for by the browser itself, which sends no mark, and the queue reads itself again every 60 seconds
    // while it is open, unmarked so that it never keeps a session alive (should a step of the walk ever last that long).
    // Every other request was the person's own.
    const pagesOwn = (r: { method: string; path: string }) => IMAGE_PATH.test(r.path) || (r.method === "GET" && (r.path === "/api/staff/queue" || r.path.startsWith("/api/staff/queue?")));
    expect(fixtures.state.requests.filter((r) => !r.activity && !pagesOwn(r))).toEqual([]);
    expect(fixtures.state.problems).toEqual([]);
    expect(HOSTILE_TEXTS.filter((text) => !seen.has(text))).toEqual([]);
  });
});
```

### Replace `apps/admin/test/browser/fixture-api.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CEREMONY_CHALLENGE,
  CHALLENGE_PURPOSES,
  FindingRequest,
  IdentityRevealRequest,
  STAFF_AUDIT_PAGE_SIZE,
  STAFF_STEP_UP_CHALLENGE,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffSessionRevokeRequest,
  StaffSignInVerifyRequest,
  StaffStepUpOptionsRequest,
  StaffTextSaveRequest,
  stepUpActionHash,
  stepUpBinding,
  textDigest,
  type AuditEntry,
  type AuditPage,
  type CaseView,
  type QueuePage,
  type StaffKey,
  type StaffMe,
  type StaffErrorCode,
  type StaffSession,
  type StaffStepUpActionInput,
} from "@korbat/contracts";
import type { z } from "zod";
import { accountCase, CASE_ACCOUNT, CASE_FROZEN, CASE_POST, CASE_QUOTED, frozenCase, LONGEST_EXPLANATION, LONGEST_NOTE, LOOKALIKE, overview, postCase, QUEUE_ROWS } from "../case-fixtures";
import { HOSTILE } from "../fixtures";

/**
 * The staff API as the browser check answers it (3a design, section 12): no database and no API process, only answers
 * from fixtures held in memory, shaped by the contracts, whose user-written strings are hostile. It checks what a real
 * browser sends, as far as the console's part goes: the staff gate's Host, Origin and fetch metadata, the staff CSRF
 * header on every write, the WebAuthn ceremonies' client data (type, challenge, origin) and the authenticator's flags
 * (user verified, never backup-eligible or backed up). Anything the page sent that the real API would refuse for the
 * page's own fault is listed in `problems`. Signatures are not verified: the API's own tests do that with its library.
 */

/** The longest handle an account can choose (checkHandle: 3 to 20 of a-z, 0-9 and _). */
export const LONGEST_HANDLE = "h".repeat(20);

/** The name typed for the new key at enrolment: markup, within the display-name rules the page checks it against. */
export const TYPED_KEY_NAME = '"><img src=x onerror=alert(9)>';

/** The signed-in person's handle, and the browser labels of their sessions, as an API made to echo them would send them. */
export const PERSON_HANDLE = HOSTILE.script;
export const CURRENT_BROWSER = HOSTILE.url;
export const OTHER_BROWSERS = [HOSTILE.img, HOSTILE.bidi] as const;
/** The keys the person already holds, by name: the longest name allowed (50 characters), and more markup. */
export const EXISTING_KEY_NAMES = [HOSTILE.long, HOSTILE.quote] as const;
/** The handles the audit log's rows name, in turn; null is the system actor. */
export const ACTOR_HANDLES = [HOSTILE.script, HOSTILE.img, HOSTILE.url, HOSTILE.quote, HOSTILE.bidi, LONGEST_HANDLE, null] as const;

/** The handle the fixtures reveal for a reporter (hostile, and found nowhere else on a page), and the note the walk types on a case. */
export const REVEALED_HANDLE = '"><a href="javascript:alert(5)">a_reporter</a>';
export const TYPED_NOTE = `Art. 18 check: no suspicion ${HOSTILE.img}`;
/** A link the finding form is given that names nothing live. */
export const DEAD_LINK = "http://localhost:8081/post/00000000-0000-4000-8000-000000000000";
/** The reason a forged save answer stands for: one the person never wrote. */
export const FORGED_REASON = "A reason this server wrote in the person's name.";

/**
 * Every user-written string the console must show as text, exactly as written: 3a's handles, names and labels, and of the
 * cases a text made to look like the console's own line, the longest explanation and the longest note.
 */
export const HOSTILE_TEXTS = [
  ...new Set([
    PERSON_HANDLE,
    CURRENT_BROWSER,
    ...OTHER_BROWSERS,
    ...EXISTING_KEY_NAMES,
    TYPED_KEY_NAME,
    ...ACTOR_HANDLES.filter((h) => h !== null),
    LOOKALIKE.label,
    LONGEST_EXPLANATION,
    LONGEST_NOTE,
    TYPED_NOTE,
    REVEALED_HANDLE,
  ]),
];

/**
 * A WebP of 2 by 2 pixels (lossless, 38 bytes), which the fixtures answer for every image of a case: a real image, so the
 * browser decodes it under the console's policy as it would a stored one.
 */
export const FIXTURE_WEBP = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQvOIVr/+BiOh/AAA=", "base64");

/** An image request of a case, as the console's one image site builds it. */
export const IMAGE_PATH = /^\/api\/staff\/cases\/([0-9a-f-]{36})\/media\/([0-9a-f-]{36})\/(small|large)$/;

const HOUR = 60 * 60_000;
const IDLE_MS = 15 * 60_000;
const ABSOLUTE_MS = 12 * HOUR;
/** How far apart the audit log's rows are: 97 minutes, so none sits within an hour of the home screen's 7-day edge. */
const ROW_SPACING_MS = 97 * 60_000;
const AUDIT_ROWS = 160;

/** The authenticator data's flags (WebAuthn L3, section 6.1). */
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;

const iso = (ms: number) => new Date(ms).toISOString();
const hex64 = () => randomBytes(32).toString("hex");
const b64url = (bytes: number) => randomBytes(bytes).toString("base64url");

interface KeyRecord extends StaffKey {
  /** The credential the browser made; null for the keys the person held before the walk, which no authenticator holds. */
  credentialId: string | null;
}

interface SessionRecord {
  handle: string;
  token: string;
  csrf: string;
  browser: string;
  createdAt: number;
  lastUsedAt: number;
  /** The credential of the key that opened it; null for the fixtures' other sessions. */
  credentialId: string | null;
}

export interface RequestRecord {
  method: string;
  path: string;
  status: number;
  activity: boolean;
}

/**
 * The audit log: places 1 to 160, one row every 97 minutes up to now, so the newest page, Load older and Go to place each
 * have rows to show, and the home screen's sign-ins reach back past 7 days. Actions, targets and actors take hostile
 * values in turn.
 */
function auditLog(now: number): AuditEntry[] {
  const rows: AuditEntry[] = [];
  for (let seq = AUDIT_ROWS; seq >= 1; seq--) {
    const kind = seq % 4 === 0 ? "revoked" : seq % 9 === 0 ? "hostile" : "signin";
    rows.push({
      seq,
      hash: hex64(),
      createdAt: iso(now - (AUDIT_ROWS - seq) * ROW_SPACING_MS),
      actorHandle: ACTOR_HANDLES[seq % ACTOR_HANDLES.length] ?? null,
      action: kind === "revoked" ? "staff_session_revoked" : kind === "hostile" ? HOSTILE.script : "staff_sign_in",
      targetType: kind === "revoked" ? "staff_session" : kind === "hostile" ? HOSTILE.quote : null,
      targetId: kind === "revoked" ? randomUUID() : kind === "hostile" ? HOSTILE.url : null,
      actionHash: kind === "revoked" ? hex64() : null,
    });
  }
  return rows;
}

/** The authenticator data inside a CBOR attestation object: the byte string under the text key "authData". */
function authDataOf(attestationObject: Buffer): Buffer | null {
  // A CBOR text string of 8 bytes (0x68) spelling authData, then the byte string (major type 2) it maps to.
  const key = Buffer.concat([Buffer.from([0x68]), Buffer.from("authData")]);
  const at = attestationObject.indexOf(key);
  if (at === -1) return null;
  let i = at + key.length;
  const head = attestationObject[i];
  if (head === undefined || head >> 5 !== 2) return null;
  let length = head & 0x1f;
  i += 1;
  // The length is in the head itself, or in the 1, 2 or 4 bytes after it.
  if (length === 24) {
    length = attestationObject.readUInt8(i);
    i += 1;
  } else if (length === 25) {
    length = attestationObject.readUInt16BE(i);
    i += 2;
  } else if (length === 26) {
    length = attestationObject.readUInt32BE(i);
    i += 4;
  } else if (length > 23) {
    return null;
  }
  return attestationObject.subarray(i, i + length);
}

/** The flags byte of authenticator data, which follows the 32-byte hash of the relying party ID. */
const flagsOf = (authData: Buffer | null): number | null => (authData && authData.length > 32 ? authData[32]! : null);

/** The staff refusal for an authenticator's flags, or null: user verified, and neither backup-eligible nor backed up. */
function flagRefusal(flags: number | null): "staff_key_refused" | "staff_key_not_user_verified" | "staff_key_not_device_bound" | null {
  if (flags === null) return "staff_key_refused";
  if ((flags & FLAG_UV) === 0) return "staff_key_not_user_verified";
  if ((flags & (FLAG_BE | FLAG_BS)) !== 0) return "staff_key_not_device_bound";
  return null;
}

function cookies(req: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return jar;
}

/** The staff cookies as the API sets them: __Host- names, Secure, Path=/, SameSite=Strict, 12 hours, the session's HttpOnly. */
const COOKIE = "Path=/; Secure; SameSite=Strict";
const SESSION_COOKIE = "__Host-korbat_staff";
const CSRF_COOKIE = "__Host-korbat_staff_csrf";
const CLEAR_COOKIES = [`${SESSION_COOKIE}=; ${COOKIE}; HttpOnly; Max-Age=0`, `${CSRF_COOKIE}=; ${COOKIE}; Max-Age=0`];

/**
 * The status the API answers each staff refusal with (apps/api/src/auth/staff/), so the console meets here what it meets
 * behind Caddy; a unit test (fixture-statuses.test.ts) checks it against the API's own source.
 */
export const REFUSAL_STATUS = {
  staff_enrollment_invalid: 400,
  staff_key_refused: 400,
  staff_key_invalid: 401,
  staff_session_required: 401,
  staff_key_not_user_verified: 403,
  staff_key_not_device_bound: 403,
  staff_key_suspended: 403,
  staff_step_up_required: 403,
  staff_step_up_invalid: 403,
  staff_key_limit: 409,
} as const satisfies Record<StaffErrorCode, number>;

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: Record<string, string | string[]> = {},
  ) {
    super(code);
  }
}

/** A staff refusal with the API's own status for its code. */
const refuse = (code: StaffErrorCode, headers: Record<string, string | string[]> = {}) => new Refusal(REFUSAL_STATUS[code], code, headers);

/**
 * A challenge in the other ceremonies' 58-byte layout (the contracts' CEREMONY_CHALLENGE), with the purpose's code, a
 * fresh nonce, `binding` (zeros for a sign-in, bound to nothing) and a random seal, since only this server reads it back.
 */
function ceremonyChallenge(purpose: "staff_signin" | "staff_register", binding: Buffer = Buffer.alloc(CEREMONY_CHALLENGE.bindingBytes)): string {
  const c = CEREMONY_CHALLENGE;
  const bytes = randomBytes(c.bytes);
  bytes[c.versionAt] = c.version;
  bytes[c.purposeAt] = CHALLENGE_PURPOSES[purpose];
  bytes.writeBigUInt64BE(BigInt(Date.now() + 10 * 60_000), c.expiryAt);
  binding.copy(bytes, c.bindingAt);
  return bytes.toString("base64url");
}

/**
 * The status the API answers each moderation refusal the fixtures use with (apps/api/src/moderation/context.ts); the
 * unit test that holds the staff statuses to the API's source holds these too.
 */
export const MODERATION_REFUSAL_STATUS = { text_not_found: 409, text_invalid: 422, image_refused: 404, staff_recused: 403 } as const;

/** `raw` answers bytes of this type in place of JSON: an image. */
type Answer = { status: number; body?: unknown; raw?: { type: string; bytes: Buffer }; headers?: Record<string, string | string[]> };

export type FixtureApi = ReturnType<typeof createFixtureApi>;

export function createFixtureApi() {
  const now = Date.now();
  // The account's WebAuthn user handle, which the enrolment's options carry and a discoverable staff key returns.
  const userHandle = b64url(32);
  const state = {
    /** The origin the page is served from, set once the server listens. */
    origin: "",
    /** The console is off: every staff path answers 404, as the API does while CONSOLE_ORIGIN is unset. */
    off: false,
    enrolmentToken: b64url(32),
    enrolmentUsed: false,
    /** The next step-up options bind another action than the one the page asked for: the revocation of another session. */
    mismatchNextStepUp: false,
    /**
     * The next sign-in options carry a step-up challenge for an action of this server's choosing, as an API under an
     * attacker's control would hand out to have the key sign it at an ordinary sign-in.
     */
    stepUpChallengeAtNextSignIn: false,
    signInOptionsServed: 0,
    keys: EXISTING_KEY_NAMES.map(
      (name, i): KeyRecord => ({ id: randomUUID(), name, createdAt: iso(now - (30 + i) * 24 * HOUR), lastUsedAt: i === 0 ? iso(now - 2 * HOUR) : null, credentialId: null }),
    ),
    sessions: new Map<string, SessionRecord>(),
    audit: auditLog(now),
    /** Challenges handed out and not yet spent, by their base64url text: what each was issued for. */
    challenges: new Map<string, { purpose: "register" | "signin" | "step_up"; target?: string }>(),
    /** The handles the page revoked with its key. */
    revoked: [] as string[],
    /** The cases the console can open: a post's, a frozen post's, an account's, and the one a quoting post links to. */
    cases: new Map<string, CaseView>([
      [CASE_POST, postCase()],
      [CASE_FROZEN, frozenCase()],
      [CASE_ACCOUNT, accountCase()],
      [CASE_QUOTED, postCase({ id: CASE_QUOTED, items: [], decisions: [], notes: [] })],
    ]),
    /** Every image the page asked for, by its path, in order. */
    imageRequests: [] as string[],
    /**
     * The next image is refused though the page was right to ask for it: what the API answers when a report froze the
     * post between the page's read of the case and the browser's request for the image.
     */
    refuseNextImage: false,
    /**
     * The next read of a case is refused as a recusal: what the API answers when an account linked to the person came
     * to take part in the case since the page read it.
     */
    recuseNextCaseRead: false,
    /** Every text the page saved, with the digest it sent and the server recomputed. */
    texts: [] as { caseId: string; kind: string; text: string; digest: string }[],
    /**
     * The next save is answered with the digest of another text, one of this server's own choosing which it stores as
     * the person's: what an API under an attacker's control would answer to have the key confirm a reason nobody wrote.
     */
    hostileNextSave: false,
    /** The digests such answers carried. An action the page then builds from one of them is its fault. */
    forgedDigests: [] as string[],
    /** Every reveal the key confirmed: the item and the digest of its saved reason. */
    reveals: [] as { itemId: string; reasonDigest: string }[],
    /** Every finding the page opened. */
    findings: [] as FindingRequest[],
    snapshotsTaken: 0,
    stepUpOptionsServed: 0,
    requests: [] as RequestRecord[],
    problems: [] as string[],
  };
  // Two other live sessions of the person's, started earlier from other browsers and used minutes ago: one to revoke, one
  // for the mismatched step-up.
  for (const [i, browser] of OTHER_BROWSERS.entries()) {
    const handle = randomUUID();
    state.sessions.set(handle, { handle, token: b64url(32), csrf: b64url(32), browser, createdAt: now - (3 + i) * HOUR, lastUsedAt: now - (2 + 3 * i) * 60_000, credentialId: null });
  }

  const problem = (text: string) => state.problems.push(text);

  /** A ceremony's client data: its type, a challenge this server issued for `purpose` (spent here), and the page's origin. */
  function clientData(encoded: string, type: "webauthn.create" | "webauthn.get", purpose: "register" | "signin" | "step_up", refusal: StaffErrorCode) {
    let data: { type?: unknown; challenge?: unknown; origin?: unknown };
    try {
      data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      problem(`${type}: client data that is not JSON`);
      throw refuse(refusal);
    }
    const issued = typeof data.challenge === "string" ? state.challenges.get(data.challenge) : undefined;
    if (data.type !== type || data.origin !== state.origin || issued?.purpose !== purpose) {
      problem(`${type}: client data for ${String(data.type)} at ${String(data.origin)}, challenge ${issued ? issued.purpose : "unknown"}`);
      throw refuse(refusal);
    }
    state.challenges.delete(data.challenge as string);
    return issued;
  }

  /** The session the staff cookie names, as requireStaff reads it: never cached, refused with both cookies cleared. */
  function requireStaff(req: IncomingMessage): SessionRecord {
    const jar = cookies(req);
    const session = [...state.sessions.values()].find((s) => s.token === jar.get(SESSION_COOKIE));
    const at = Date.now();
    if (!session || at >= session.createdAt + ABSOLUTE_MS || at >= session.lastUsedAt + IDLE_MS) throw refuse("staff_session_required", { "set-cookie": CLEAR_COOKIES });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-staff-csrf"] !== jar.get(CSRF_COOKIE)) {
      problem(`${req.method} ${req.url}: the staff CSRF header does not echo the staff CSRF cookie`);
      throw new Refusal(403, "csrf_failed");
    }
    // Only a request its person's action started moves the idle end.
    if (req.headers["x-staff-activity"] === "1") session.lastUsedAt = at;
    return session;
  }

  function me(session: SessionRecord): StaffMe {
    const at = Date.now();
    const absoluteEnd = session.createdAt + ABSOLUTE_MS;
    const idleEnd = Math.min(session.lastUsedAt + IDLE_MS, absoluteEnd);
    return {
      handle: PERSON_HANDLE,
      role: "moderator",
      sessionHandle: session.handle,
      idleExpiresAt: iso(idleEnd),
      idleSecondsLeft: Math.max(0, Math.floor((idleEnd - at) / 1000)),
      absoluteExpiresAt: iso(absoluteEnd),
      absoluteSecondsLeft: Math.max(0, Math.floor((absoluteEnd - at) / 1000)),
    };
  }

  function auditPage(query: URLSearchParams): AuditPage {
    const action = query.get("action");
    const cursor = query.get("cursor");
    const at = query.get("at");
    let rows = action === null ? state.audit : state.audit.filter((row) => row.action === action);
    if (cursor !== null) rows = rows.filter((row) => row.seq < Number(cursor));
    if (at !== null) rows = rows.filter((row) => row.seq <= Number(at));
    const entries = rows.slice(0, STAFF_AUDIT_PAGE_SIZE);
    return { entries, nextCursor: rows.length > entries.length ? entries[entries.length - 1]!.seq : null };
  }

  /** A step-up challenge in the contracts' layout; its seal is random, since only this server reads it back. */
  async function stepUpChallenge(sessionHandle: string, action: StaffStepUpActionInput): Promise<string> {
    const layout = STAFF_STEP_UP_CHALLENGE;
    const bytes = randomBytes(layout.bytes);
    bytes[layout.versionAt] = layout.version;
    bytes[layout.purposeAt] = layout.purpose;
    bytes.writeBigUInt64BE(BigInt(Date.now() + 10 * 60_000), layout.expiryAt);
    Buffer.from(await stepUpBinding(sessionHandle, await stepUpActionHash(action))).copy(bytes, layout.bindingAt);
    return bytes.toString("base64url");
  }

  function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      problem(`${what}: a body the contracts refuse`);
      throw new Refusal(400, "invalid_request");
    }
    return parsed.data;
  }

  /** One staff route's answer. */
  async function route(req: IncomingMessage, url: URL, body: unknown): Promise<Answer> {
    const key = `${req.method} ${url.pathname}`;

    if (key === "POST /api/staff/enroll/options") {
      const input = parse(StaffEnrollOptionsRequest, body, key);
      if (input.token !== state.enrolmentToken || state.enrolmentUsed) throw refuse("staff_enrollment_invalid");
      // Bound, as the API binds it, to the enrolment's id, which the page is never told: random bytes stand for its hash.
      const challenge = ceremonyChallenge("staff_register", randomBytes(CEREMONY_CHALLENGE.bindingBytes));
      state.challenges.set(challenge, { purpose: "register" });
      const securityKey = input.kind === "security_key";
      // As @simplewebauthn/server 14.0.2 writes them for the console: the security-key hint only with cross-platform attachment.
      const options = {
        challenge,
        rp: { id: "localhost", name: "korbat" },
        user: { id: userHandle, name: input.name, displayName: input.name },
        pubKeyCredParams: [-8, -7, -257].map((alg) => ({ alg, type: "public-key" })),
        timeout: 300_000,
        attestation: "none",
        excludeCredentials: state.keys.filter((k) => k.credentialId !== null).map((k) => ({ id: k.credentialId, type: "public-key" })),
        authenticatorSelection: { residentKey: "required", userVerification: "required", requireResidentKey: true, ...(securityKey ? { authenticatorAttachment: "cross-platform" } : {}) },
        extensions: { credProps: true },
        ...(securityKey ? { hints: ["security-key"] } : {}),
      };
      // As in production, the console's relying party ID is not the app's, so the page may signal a refused key.
      return { status: 200, body: { options, rpShared: false } };
    }

    if (key === "POST /api/staff/enroll/verify") {
      const input = parse(StaffEnrollVerifyRequest, body, key);
      if (input.token !== state.enrolmentToken || state.enrolmentUsed) throw refuse("staff_enrollment_invalid");
      clientData(input.response.response.clientDataJSON, "webauthn.create", "register", "staff_key_refused");
      const refusal = flagRefusal(flagsOf(authDataOf(Buffer.from(input.response.response.attestationObject, "base64url"))));
      // A refusal leaves the link usable, so the person can try another key.
      if (refusal) throw refuse(refusal);
      state.enrolmentUsed = true;
      const stored: KeyRecord = { id: randomUUID(), name: input.name, createdAt: iso(Date.now()), lastUsedAt: null, credentialId: input.response.id };
      state.keys.push(stored);
      return { status: 200, body: { key: { id: stored.id, name: stored.name, createdAt: stored.createdAt, lastUsedAt: stored.lastUsedAt } } };
    }

    if (key === "POST /api/staff/signin/options") {
      if (body !== undefined) problem(`${key}: a body, where the route takes none`);
      state.signInOptionsServed += 1;
      if (state.stepUpChallengeAtNextSignIn) {
        state.stepUpChallengeAtNextSignIn = false;
        // The forged case: a step-up challenge for revoking one of the person's sessions, bound to a handle of this
        // server's choosing. Never recorded as issued, so an assertion made over it would be a problem here too.
        const victim = [...state.sessions.values()][0]?.handle ?? randomUUID();
        const challenge = await stepUpChallenge(randomUUID(), { action: "staff_session_revoked", target: { type: "staff_session", id: victim }, params: {} });
        return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } } };
      }
      const challenge = ceremonyChallenge("staff_signin");
      state.challenges.set(challenge, { purpose: "signin" });
      return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } } };
    }

    if (key === "POST /api/staff/signin/verify") {
      const input = parse(StaffSignInVerifyRequest, body, key);
      clientData(input.response.response.clientDataJSON, "webauthn.get", "signin", "staff_key_invalid");
      const staffKey = state.keys.find((k) => k.credentialId !== null && k.credentialId === input.response.id);
      if (!staffKey || input.response.response.userHandle !== userHandle) throw refuse("staff_key_invalid");
      const refusal = flagRefusal(flagsOf(Buffer.from(input.response.response.authenticatorData, "base64url")));
      // Read after the signature, as the API reads them; staff_key_refused stands for flags it cannot read at all.
      if (refusal) throw refuse(refusal === "staff_key_refused" ? "staff_key_invalid" : refusal);
      staffKey.lastUsedAt = iso(Date.now());
      const session: SessionRecord = {
        handle: randomUUID(),
        token: b64url(32),
        csrf: b64url(32),
        browser: CURRENT_BROWSER,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        credentialId: staffKey.credentialId,
      };
      state.sessions.set(session.handle, session);
      const setCookies = [`${SESSION_COOKIE}=${session.token}; ${COOKIE}; HttpOnly; Max-Age=43200`, `${CSRF_COOKIE}=${session.csrf}; ${COOKIE}; Max-Age=43200`];
      return { status: 200, body: me(session), headers: { "set-cookie": setCookies } };
    }

    // Everything below needs a staff session.
    const routes = new Set([
      "GET /api/staff/me",
      "GET /api/staff/sessions",
      "GET /api/staff/keys",
      "GET /api/staff/audit",
      "POST /api/staff/signout",
      "POST /api/staff/step-up/options",
      "GET /api/staff/overview",
      "GET /api/staff/queue",
      "POST /api/staff/findings",
    ]);
    const revoke = req.method === "DELETE" && /^\/api\/staff\/sessions\/[^/]+$/.test(url.pathname);
    const ofCase = /^\/api\/staff\/cases\/([0-9a-f-]{36})(?:\/(snapshots|texts))?$/.exec(url.pathname);
    const image = req.method === "GET" ? IMAGE_PATH.exec(url.pathname) : null;
    const reveal = req.method === "POST" ? /^\/api\/staff\/items\/([0-9a-f-]{36})\/reveal$/.exec(url.pathname) : null;
    if (!routes.has(key) && !revoke && !ofCase && !image && !reveal) throw new Refusal(404, "not_found");
    const session = requireStaff(req);

    // Moderation cases (3c design, section 7.3), answered from the fixtures' cases.
    if (key === "GET /api/staff/overview") return { status: 200, body: overview({ reveals: { total: 1 + state.reveals.length, items: [{ at: iso(now - 26 * HOUR), handle: HOSTILE.script, caseId: CASE_POST }] } }) };
    if (key === "GET /api/staff/queue") {
      // Two pages: the two urgent cases, then the rest behind a cursor.
      const cursor = url.searchParams.get("cursor");
      if (cursor !== null && cursor !== "second-page") throw new Refusal(400, "invalid_request");
      const page: QueuePage = cursor === null ? { cases: QUEUE_ROWS.slice(0, 2), nextCursor: "second-page" } : { cases: QUEUE_ROWS.slice(2), nextCursor: null };
      return { status: 200, body: page };
    }
    if (key === "POST /api/staff/findings") {
      const finding = parse(FindingRequest, body, key);
      if (finding.target.kind === "link" && finding.target.url === DEAD_LINK) throw new Refusal(404, "not_found");
      state.findings.push(finding);
      return { status: 201, body: { caseId: CASE_POST } };
    }
    if (image) {
      const found = state.cases.get(image[1]!);
      state.imageRequests.push(url.pathname);
      if (state.refuseNextImage) {
        state.refuseNextImage = false;
        throw new Refusal(MODERATION_REFUSAL_STATUS.image_refused, "image_refused");
      }
      // As gate V and the image route answer: only an image of the case's own post, and none while it is frozen.
      const listed = found?.snapshots.some((snapshot) => !snapshot.withheld && snapshot.media?.some((media) => media.id === image[2]));
      if (!found || !found.imagesAllowed || !listed) {
        problem(`${key}: an image the console must not ask for`);
        throw new Refusal(MODERATION_REFUSAL_STATUS.image_refused, "image_refused");
      }
      return { status: 200, raw: { type: "image/webp", bytes: FIXTURE_WEBP }, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } };
    }
    if (ofCase) {
      const found = state.cases.get(ofCase[1]!);
      if (!found) throw new Refusal(404, "not_found");
      if (ofCase[2] === undefined && req.method === "GET") {
        if (state.recuseNextCaseRead) {
          state.recuseNextCaseRead = false;
          throw new Refusal(MODERATION_REFUSAL_STATUS.staff_recused, "staff_recused");
        }
        return { status: 200, body: found };
      }
      if (ofCase[2] === "snapshots" && req.method === "POST") {
        state.snapshotsTaken += 1;
        // The fresh snapshot holds the account's fields as they read now; the case then carries it first.
        const [newest] = found.snapshots;
        if (found.target.type === "account" && newest && !newest.withheld) {
          found.snapshots = [{ ...newest, id: randomUUID(), takenAt: iso(Date.now()), handle: found.target.handle, displayName: found.target.displayName, bio: found.target.bio }, ...found.snapshots];
        }
        return { status: 200, body: { id: found.snapshots[0]!.id, digest: found.snapshots[0]!.digest } };
      }
      if (ofCase[2] === "texts" && req.method === "GET") return { status: 200, body: { texts: [] } };
      if (ofCase[2] === "texts" && req.method === "POST") {
        const saved = parse(StaffTextSaveRequest, body, key);
        // No text is saved empty: the page's own buttons and its save never send one.
        if (saved.text.trim() === "") {
          problem(`${key}: an empty text`);
          throw new Refusal(400, "invalid_request");
        }
        // The server recomputes the digest: the console must have sent the digest of exactly the text it sent.
        if ((await textDigest(saved.salt, saved.text)) !== saved.digest) {
          problem(`${key}: a digest that is not the text's`);
          throw new Refusal(MODERATION_REFUSAL_STATUS.text_invalid, "text_invalid");
        }
        const id = randomUUID();
        if (state.hostileNextSave) {
          state.hostileNextSave = false;
          // The forged case: a text of this server's own is stored in the person's name, and its digest answered. A
          // reveal confirmed under that digest would go through here, so only the page's own check stops it.
          const digest = await textDigest(saved.salt, FORGED_REASON);
          state.texts.push({ caseId: found.id, kind: saved.kind, text: FORGED_REASON, digest });
          state.forgedDigests.push(digest);
          return { status: 201, body: { id, digest } };
        }
        state.texts.push({ caseId: found.id, kind: saved.kind, text: saved.text, digest: saved.digest });
        if (saved.kind === "note") found.notes = [...found.notes, { id, staffHandle: PERSON_HANDLE, createdAt: iso(Date.now()), text: saved.text }];
        return { status: 201, body: { id, digest: saved.digest } };
      }
      throw new Refusal(404, "not_found");
    }
    if (reveal) {
      const itemId = reveal[1]!;
      const input = parse(IdentityRevealRequest, body, "POST /api/staff/items/:item/reveal");
      const issued = clientData(input.stepUp.response.clientDataJSON, "webauthn.get", "step_up", "staff_step_up_invalid");
      if (issued.target !== itemId || input.stepUp.id !== session.credentialId) {
        problem(`reveal ${itemId}: an assertion for ${String(issued.target)} from ${input.stepUp.id}`);
        throw refuse("staff_step_up_invalid");
      }
      const owner = [...state.cases.values()].find((view) => view.items.some((item) => item.id === itemId));
      // The reason must be one the page saved on the item's case, and used once.
      const reason = state.texts.find((text) => text.kind === "reveal_reason" && text.digest === input.reasonDigest && text.caseId === owner?.id);
      if (!owner || !reason || state.reveals.some((done) => done.reasonDigest === input.reasonDigest)) throw new Refusal(MODERATION_REFUSAL_STATUS.text_not_found, "text_not_found");
      state.reveals.push({ itemId, reasonDigest: input.reasonDigest });
      return { status: 200, body: { handle: REVEALED_HANDLE, name: null } };
    }

    if (key === "GET /api/staff/me") return { status: 200, body: me(session) };
    if (key === "GET /api/staff/sessions") {
      const sessions: StaffSession[] = [...state.sessions.values()].map((s) => ({
        handle: s.handle,
        browser: s.browser,
        createdAt: iso(s.createdAt),
        lastUsedAt: iso(s.lastUsedAt),
        current: s === session,
      }));
      return { status: 200, body: { sessions } };
    }
    if (key === "GET /api/staff/keys") return { status: 200, body: { keys: state.keys.map((k): StaffKey => ({ id: k.id, name: k.name, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })) } };
    if (key === "GET /api/staff/audit") return { status: 200, body: auditPage(url.searchParams) };
    if (key === "POST /api/staff/signout") {
      state.sessions.delete(session.handle);
      return { status: 204, headers: { "set-cookie": CLEAR_COOKIES } };
    }
    if (key === "POST /api/staff/step-up/options") {
      const action = parse(StaffStepUpOptionsRequest, body, key);
      const known = action.action === "identity_revealed" ? [...state.cases.values()].some((view) => view.items.some((item) => item.id === action.target.id)) : state.sessions.has(action.target.id);
      if (!known) throw new Refusal(404, "not_found");
      // The page builds a reveal's params from the digest it computed itself: one a save's answer carried never gets here.
      const underDigest = action.action === "identity_revealed" ? action.params.reasonDigest : null;
      if (typeof underDigest === "string" && state.forgedDigests.includes(underDigest)) problem(`${key}: a reveal under a digest the page did not compute`);
      state.stepUpOptionsServed += 1;
      // The mismatched case: an API that asks the key to confirm the revocation of this very session instead of the one
      // chosen, or, for a reveal, the reveal of another item than the one chosen.
      const other = action.action === "identity_revealed" ? randomUUID() : session.handle;
      const bound = state.mismatchNextStepUp ? { ...action, target: { ...action.target, id: other } } : action;
      state.mismatchNextStepUp = false;
      const challenge = await stepUpChallenge(session.handle, bound);
      state.challenges.set(challenge, { purpose: "step_up", target: bound.target.id });
      const allow = session.credentialId === null ? [] : [{ id: session.credentialId, type: "public-key", transports: ["usb"] }];
      return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: allow } } };
    }

    // DELETE /api/staff/sessions/:handle, confirmed by the session's own key for exactly this session.
    const handle = decodeURIComponent(url.pathname.slice("/api/staff/sessions/".length));
    const { stepUp } = parse(StaffSessionRevokeRequest, body, "DELETE /api/staff/sessions/:handle");
    const issued = clientData(stepUp.response.clientDataJSON, "webauthn.get", "step_up", "staff_step_up_invalid");
    if (issued.target !== handle || stepUp.id !== session.credentialId) {
      problem(`DELETE ${handle}: an assertion for ${String(issued.target)} from ${stepUp.id}`);
      throw refuse("staff_step_up_invalid");
    }
    const refusal = flagRefusal(flagsOf(Buffer.from(stepUp.response.authenticatorData, "base64url")));
    if (refusal) throw refuse(refusal === "staff_key_refused" ? "staff_step_up_invalid" : refusal);
    if (!state.sessions.delete(handle)) throw new Refusal(404, "not_found");
    state.revoked.push(handle);
    return { status: 204 };
  }

  /** The staff gate: the console's Host, an Origin on every write and never another, and same-origin fetch metadata. */
  function gate(req: IncomingMessage) {
    if (req.headers.host !== new URL(state.origin).host) {
      problem(`${req.method} ${req.url}: Host ${String(req.headers.host)}`);
      throw new Refusal(404, "not_found");
    }
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") {
      problem(`${req.method} ${req.url}: Sec-Fetch-Site ${site}`);
      throw new Refusal(403, "csrf_failed");
    }
    const origin = req.headers.origin;
    if ((origin !== undefined || (req.method !== "GET" && req.method !== "HEAD")) && origin !== state.origin) {
      problem(`${req.method} ${req.url}: Origin ${String(origin)}`);
      throw new Refusal(403, "csrf_failed");
    }
  }

  /** Answers one request under /api/staff, as the API behind Caddy's console site would. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL, raw: Buffer): Promise<void> {
    let answer: Answer;
    try {
      if (state.off) throw new Refusal(404, "not_found");
      gate(req);
      let body: unknown;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          problem(`${req.method} ${url.pathname}: a body that is not JSON`);
          throw new Refusal(400, "invalid_request");
        }
      }
      answer = await route(req, url, body);
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      answer = { status: err.status, body: { error: { code: err.code, message: "the fixture's own words" } }, headers: err.headers };
    }
    state.requests.push({ method: req.method ?? "", path: `${url.pathname}${url.search}`, status: answer.status, activity: req.headers["x-staff-activity"] === "1" });
    const headers: Record<string, string | string[]> = { "cache-control": "no-store", ...answer.headers };
    if (answer.raw) {
      res.writeHead(answer.status, { ...headers, "content-type": answer.raw.type, "content-length": String(answer.raw.bytes.length) });
      res.end(answer.raw.bytes);
      return;
    }
    if (answer.body === undefined) {
      res.writeHead(answer.status, headers);
      res.end();
      return;
    }
    res.writeHead(answer.status, { ...headers, "content-type": "application/json" });
    res.end(JSON.stringify(answer.body));
  }

  return {
    state,
    handle,
    /** Every staff session ends behind the page's back, as a revocation from the command line ends them. */
    endEverySession() {
      state.sessions.clear();
    },
    /** A new enrolment link, as `staff.js enroll` prints one for the person's next key; its token. */
    issueEnrolment(): string {
      state.enrolmentToken = b64url(32);
      state.enrolmentUsed = false;
      return state.enrolmentToken;
    },
  };
}
```

### Replace `apps/admin/test/browser/watch.ts` (whole file)

```ts
import type { BrowserContext, CDPSession, Page } from "playwright-core";

/**
 * Every channel a policy report, a page error or a dialog can reach the check by (console-lab.md, section 2), watched for
 * the whole walk: the page's own securitypolicyviolation events, from a listener installed before any of the page's
 * scripts runs; any Trusted Types policy the page tries to create; Chromium's console, through Playwright and through the
 * CDP Log domain, whose source is "security" for CSP and Trusted Types messages; DevTools issues (the Audits domain), which
 * classify every CSP issue; page errors; dialogs, dismissed; failed requests; and any request that would leave the
 * console's origin, aborted. Everything found is a problem, listed with what it said.
 */

/**
 * Console errors the walk causes on purpose, which Chromium logs for every answer that is not a success, with the statuses
 * the API answers them with: 401 (no session, an ended session), 403 (a synced key refused at enrolment), 404 (the
 * console off), and 400 and 409, which the API answers other refusals of a key or a link with. What the page then shows
 * is checked step by step, and a request the fixtures refuse for the page's own fault is one of their problems.
 */
const EXPECTED_HTTP_ERROR = /^Failed to load resource: the server responded with a status of (400|401|403|404|409) /;
const POLICY_TEXT = /Content.Security.Policy|Trusted.?Type|require-trusted-types-for|Refused to/i;

/**
 * Runs in every page before its own scripts, outside its policy (Playwright adds it through CDP). It is plain text, so no
 * test runner's transform can put a helper into it that the page does not have. It reports through the binding below.
 */
const INIT_SCRIPT = `
(() => {
  const report = (kind, detail) => window.__korbatReport(kind, detail);
  document.addEventListener("securitypolicyviolation", (event) => {
    report("securitypolicyviolation", JSON.stringify({
      directive: event.effectiveDirective,
      blocked: event.blockedURI,
      sample: event.sample,
      source: event.sourceFile,
      line: event.lineNumber,
      disposition: event.disposition,
    }));
  }, true);
  // trusted-types 'none' already refuses every policy; this names any the page tries, should the header ever change.
  const factory = window.trustedTypes;
  if (factory && typeof factory.createPolicy === "function") {
    const create = factory.createPolicy.bind(factory);
    factory.createPolicy = (name, rules) => {
      report("a Trusted Types policy created", String(name));
      return create(name, rules);
    };
  }
})();
`;

export interface Watcher {
  /** The page's CDP session, which the walk also drives the virtual authenticator with. */
  cdp: CDPSession;
  /** The problems found since the last call, which it clears. */
  take(): string[];
}

export async function watch(context: BrowserContext, page: Page, origin: string): Promise<Watcher> {
  let problems: string[] = [];
  const found = (text: string) => problems.push(text);

  // The binding is Playwright's, added through CDP, so the page's policy does not apply to it.
  await context.exposeBinding("__korbatReport", (_source, kind: string, detail: string) => found(`${kind}: ${detail}`));
  await context.addInitScript({ content: INIT_SCRIPT });

  const cdp = await context.newCDPSession(page);
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry.source === "security" || POLICY_TEXT.test(entry.text)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text}`);
    else if ((entry.level === "error" || entry.level === "warning") && !EXPECTED_HTTP_ERROR.test(entry.text)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text}`);
  });
  await cdp.send("Log.enable");
  cdp.on("Audits.issueAdded", ({ issue }) => {
    if (issue.code === "ContentSecurityPolicyIssue") found(`DevTools CSP issue: ${JSON.stringify(issue.details.contentSecurityPolicyIssueDetails)}`);
  });
  await cdp.send("Audits.enable");

  page.on("console", (message) => {
    const text = message.text();
    if (POLICY_TEXT.test(text)) found(`console ${message.type()}: ${text}`);
    else if ((message.type() === "error" || message.type() === "warning") && !EXPECTED_HTTP_ERROR.test(text)) found(`console ${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => found(`page error: ${error.message}`));
  page.on("dialog", (dialog) => {
    found(`dialog (${dialog.type()}): ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "no reason";
    void request.response().then((response) => {
      // Chromium reports a 204 answer as aborted once it has arrived, since there is no body to read (the console's
      // sign-out and revocation). The answer did arrive; a request the policy blocks never gets one.
      if (reason === "net::ERR_ABORTED" && response?.status() === 204) return;
      found(`request failed: ${request.method()} ${request.url()} (${reason})`);
    });
  });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.continue();
    found(`a request to another origin, aborted: ${url}`);
    return route.abort();
  });

  return {
    cdp,
    take() {
      const taken = problems;
      problems = [];
      return taken;
    },
  };
}

/**
 * What the page holds that the console never writes: an element that runs or loads something, an inline handler or
 * style, a link that is not one of the console's own pages or a case's address, a form with an action, or a script other
 * than the bundle. The one image the console draws is a case's, from the staff API on its own origin, by the address its
 * one image site builds; any other image is a problem. Plain text, evaluated in the page, for the reason INIT_SCRIPT is.
 */
const INSPECT_SCRIPT = `
(() => {
  const out = [];
  const root = document.getElementById("root");
  if (!root) return ["the page has no #root"];
  const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const casePath = new RegExp("^/cases/" + id + "$");
  const imagePath = new RegExp("^/api/staff/cases/" + id + "/media/" + id + "/(small|large)$");
  const caseImage = (element) => element.tagName === "IMG" && imagePath.test(String(element.getAttribute("src")))
    && (element.getAttribute("class") === "evidence" || element.getAttribute("class") === "evidence blurred");
  for (const element of root.querySelectorAll("script, style, link, meta, base, iframe, frame, object, embed, img, svg, math, template, video, audio, source")) {
    if (!caseImage(element)) out.push("a <" + element.tagName.toLowerCase() + "> element");
  }
  for (const element of root.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (name === "src" && caseImage(element)) continue;
      if (name.toLowerCase().startsWith("on") || name === "srcdoc" || name === "style" || name === "src") out.push("a " + name + " attribute on <" + element.tagName.toLowerCase() + ">");
    }
  }
  for (const link of root.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    if (href !== "/" && href !== "/audit" && href !== "/signin" && href !== "/queue" && href !== "/appeals" && !casePath.test(String(href))) out.push("a link to " + String(href));
  }
  for (const form of root.querySelectorAll("form")) {
    if (form.hasAttribute("action")) out.push("a form with an action: " + String(form.getAttribute("action")));
  }
  if (document.scripts.length !== 1) out.push(document.scripts.length + " script elements");
  return out;
})()
`;

export function inspect(page: Page): Promise<string[]> {
  return page.evaluate(INSPECT_SCRIPT) as Promise<string[]>;
}

/** The text of every element holding a string a person wrote (UserText's <bdi>) and of every <code> (actions, targets, hashes). */
export function userTexts(page: Page): Promise<string[]> {
  return page.evaluate(`[...document.querySelectorAll("bdi, code")].map((element) => element.textContent ?? "")`) as Promise<string[]>;
}
```

### Replace `apps/admin/test/fixture-statuses.test.ts` (whole file)

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { StaffErrorCode } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { MODERATION_REFUSAL_STATUS, REFUSAL_STATUS } from "./browser/fixture-api";

/**
 * The browser check's fixtures answer each staff refusal with the status the API answers it with (3a design, section 12:
 * the fixtures answer as the API behind Caddy's console site would), so the console meets in the check what it meets in
 * production, and the check's watcher allows exactly the statuses the API sends. The API's statuses are read from its own
 * source, where every staff refusal is an AuthError with its code and status.
 */
const STAFF_FLOWS = path.resolve(import.meta.dirname, "../../api/src/auth/staff");

/** Every (code, status) pair the staff flows raise, from `new AuthError("staff_...", NNN)`. */
function apiStatuses(): Map<string, Set<number>> {
  const found = new Map<string, Set<number>>();
  for (const file of readdirSync(STAFF_FLOWS).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(path.join(STAFF_FLOWS, file), "utf8");
    for (const match of source.matchAll(/new AuthError\("(staff_[a-z_]+)", (\d{3})\)/g)) {
      const statuses = found.get(match[1]!) ?? new Set<number>();
      statuses.add(Number(match[2]));
      found.set(match[1]!, statuses);
    }
  }
  return found;
}

/** The status of every code of the moderation module's table, from the lines of its STATUS record. */
function moderationStatuses(): Map<string, number> {
  const source = readFileSync(path.resolve(import.meta.dirname, "../../api/src/moderation/context.ts"), "utf8");
  const table = source.slice(source.indexOf("const STATUS"), source.indexOf("};", source.indexOf("const STATUS")));
  return new Map([...table.matchAll(/^ {2}([a-z_]+): ([0-9]{3}),$/gm)].map((found) => [found[1]!, Number(found[2])]));
}

describe("the browser check's refusals carry the API's statuses", () => {
  test("every moderation refusal the fixtures answer has the status the moderation module answers it with", () => {
    const api = moderationStatuses();
    // The table was found and read: it holds the codes of the notice routes as well as the console's.
    expect(api.size).toBeGreaterThan(20);
    for (const [code, status] of Object.entries(MODERATION_REFUSAL_STATUS)) expect(api.get(code), code).toBe(status);
  });

  test("every staff code the API raises has one status, and the fixtures answer it with that status", () => {
    const api = apiStatuses();
    // Every code the staff flows raise, so a scan that found nothing cannot pass.
    expect([...api.keys()].sort()).toEqual([...StaffErrorCode.options].sort());
    for (const [code, statuses] of api) {
      expect([...statuses], code).toHaveLength(1);
      expect(REFUSAL_STATUS[code as StaffErrorCode], code).toBe([...statuses][0]);
    }
  });
});
```

### Replace `apps/admin/test/fixtures.ts` (whole file)

```ts
import { CEREMONY_CHALLENGE, CHALLENGE_PURPOSES, STAFF_STEP_UP_CHALLENGE, stepUpActionHash, stepUpBinding, type StaffMe, type StaffStepUpOptionsRequest } from "@korbat/contracts";
import type { Clock } from "../src/idle";

/**
 * What the console's tests share: hostile strings of the kind a staff member's handle, key name or browser label could
 * carry if the API were ever made to echo them, a session as /me describes it, a clock the tests move by hand, a fake
 * fetch that records every request, and step-up challenges built from the contracts' layout.
 */

// Built from char codes: a right-to-left override, which would reorder the text after it if it were not isolated.
const RLO = String.fromCharCode(0x202e);

export const HOSTILE = {
  script: "<script>alert(1)</script>",
  img: "<img src=x onerror=alert(2)>",
  url: "javascript:alert(3)",
  quote: '"><svg onload=alert(4)>',
  bidi: `${RLO}gnp.exe`,
  long: "W".repeat(50),
} as const;

/** The same strings as React writes them into HTML text: escaped, never markup. */
export const HOSTILE_ESCAPED = {
  script: "&lt;script&gt;alert(1)&lt;/script&gt;",
  img: "&lt;img src=x onerror=alert(2)&gt;",
  quote: "&quot;&gt;&lt;svg onload=alert(4)&gt;",
} as const;

/** The only addresses the console links to by name; none is built from data. A case's address is built from a checked id (CASE_PATH). */
export const CONSOLE_PATHS = ["/", "/audit", "/signin", "/queue", "/appeals"];

/** A case's address in the console: the one address built from a value, and only from a lower-case uuid. */
export const CASE_PATH = /^\/cases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every href attribute in rendered HTML. */
export function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
}

/** Every tag name in rendered HTML, lower-cased. */
export function tags(html: string): Set<string> {
  return new Set([...html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]!.toLowerCase()));
}

export const SESSION_HANDLE = "2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
export const OTHER_SESSION = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";

/** A session as GET /api/staff/me answers it, `idle` and `absolute` seconds from its end, counted from `at`. */
export function makeMe(options: { idle?: number; absolute?: number; at?: number; handle?: string; sessionHandle?: string } = {}): StaffMe {
  const at = options.at ?? Date.parse("2026-10-01T09:00:00.000Z");
  const idle = options.idle ?? 900;
  const absolute = options.absolute ?? 43_200;
  return {
    handle: options.handle ?? "mod_anna",
    role: "moderator",
    sessionHandle: options.sessionHandle ?? SESSION_HANDLE,
    idleExpiresAt: new Date(at + idle * 1000).toISOString(),
    idleSecondsLeft: idle,
    absoluteExpiresAt: new Date(at + absolute * 1000).toISOString(),
    absoluteSecondsLeft: absolute,
  };
}

/** A clock the test moves: timers fire in order of their time, and the promises they start settle before the next one. */
export class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers: { at: number; id: number; callback: () => void }[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ at: this.t + Math.max(0, ms), id, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  /** How many timers are waiting. */
  get pending(): number {
    return this.timers.length;
  }

  /** Moves the clock by `ms`, firing every timer due on the way and letting what each one started settle. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.t = due.at;
      due.callback();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

/** Lets every pending promise, a fetch's body included, settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Answer = { status: number; body?: unknown } | (() => { status: number; body?: unknown });

/**
 * A fetch that answers from a table of `METHOD path` keys (the path with its query) and records every request. A key
 * may hold a list of answers, given one per request, the last one repeated.
 */
export function fakeFetch(table: Record<string, Answer | Answer[]>) {
  const requests: Recorded[] = [];
  const used = new Map<string, number>();
  const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    requests.push({ method, url: input, headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const key = `${method} ${input}`;
    const entry = table[key];
    if (entry === undefined) return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404, headers: { "content-type": "application/json" } });
    const list = Array.isArray(entry) ? entry : [entry];
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const pick = list[Math.min(index, list.length - 1)]!;
    const answer = typeof pick === "function" ? pick() : pick;
    if (answer.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { fetch, requests };
}

/** An error envelope as the API writes it. */
export const envelope = (code: string, message = "the server's own words") => ({ error: { code, message, requestId: "req-1" } });

/** The step-up action that revokes `target`, as the console sends it. */
export const revokeAction = (target: string): StaffStepUpOptionsRequest => ({ action: "staff_session_revoked", target: { type: "staff_session", id: target }, params: {} });

/**
 * A step-up challenge in the contracts' layout: its version and purpose bytes, an expiry, a nonce, the binding of
 * `sessionHandle` and the action's hash, and a seal the console cannot check. `bytes` cuts or pads it to another length.
 */
export async function stepUpChallenge(
  sessionHandle: string,
  action: { action: string; target: { type: string; id: string }; params: Record<string, unknown> },
  options: { purpose?: number; version?: number; bytes?: number } = {},
): Promise<string> {
  const c = STAFF_STEP_UP_CHALLENGE;
  const bytes = Buffer.alloc(c.bytes, 7);
  bytes[c.versionAt] = options.version ?? c.version;
  bytes[c.purposeAt] = options.purpose ?? c.purpose;
  bytes.writeBigUInt64BE(BigInt(Date.parse("2026-10-01T09:10:00.000Z")), c.expiryAt);
  Buffer.from(await stepUpBinding(sessionHandle, await stepUpActionHash(action))).copy(bytes, c.bindingAt);
  const sized = options.bytes === undefined ? bytes : Buffer.concat([bytes, Buffer.alloc(Math.max(0, options.bytes - c.bytes), 1)]).subarray(0, options.bytes);
  return sized.toString("base64url");
}

/**
 * A challenge in the other ceremonies' 58-byte layout (the contracts' CEREMONY_CHALLENGE): a staff sign-in's unless told
 * another purpose, with a zero binding unless given one, and a seal the console cannot check. `bytes` cuts or pads it.
 */
export function ceremonyChallenge(options: { purpose?: number; version?: number; binding?: Buffer; bytes?: number } = {}): string {
  const c = CEREMONY_CHALLENGE;
  const bytes = Buffer.alloc(c.bytes, 7);
  bytes[c.versionAt] = options.version ?? c.version;
  bytes[c.purposeAt] = options.purpose ?? CHALLENGE_PURPOSES.staff_signin;
  bytes.writeBigUInt64BE(BigInt(Date.parse("2026-10-01T09:10:00.000Z")), c.expiryAt);
  (options.binding ?? Buffer.alloc(c.bindingBytes)).copy(bytes, c.bindingAt);
  const sized = options.bytes === undefined ? bytes : Buffer.concat([bytes, Buffer.alloc(Math.max(0, options.bytes - c.bytes), 1)]).subarray(0, options.bytes);
  return sized.toString("base64url");
}

/** A staff registration's challenge, bound (as the API binds it) to an enrolment's id the page is never told. */
export const registerChallenge = () => ceremonyChallenge({ purpose: CHALLENGE_PURPOSES.staff_register, binding: Buffer.alloc(16, 0x5e) });

/** Sign-in options as the API writes them: a staff sign-in challenge, user verification and an empty allow list. */
export function signInOptions(challenge: string = ceremonyChallenge()) {
  return { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } };
}

/** Step-up options as the API writes them: the challenge, the console's relying party, user verification and an allow list. */
export function stepUpOptions(challenge: string, allow: string[] = ["Y3JlZGVudGlhbC0x"]) {
  return {
    options: {
      challenge,
      rpId: "localhost",
      timeout: 300_000,
      userVerification: "required",
      allowCredentials: allow.map((id) => ({ id, type: "public-key", transports: ["usb"] })),
    },
  };
}

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** What navigator.credentials.get resolves with, as far as the console reads it. */
export function fakeAssertion(id = "Y3JlZGVudGlhbC0x") {
  return {
    id,
    rawId: Uint8Array.from(Buffer.from(id, "base64url")).buffer,
    type: "public-key",
    authenticatorAttachment: "cross-platform",
    response: {
      clientDataJSON: bytesOf('{"type":"webauthn.get"}'),
      authenticatorData: bytesOf("authenticator-data"),
      signature: bytesOf("signature"),
      userHandle: bytesOf("user-handle"),
    },
    getClientExtensionResults: () => ({}),
  };
}

/** What navigator.credentials.create resolves with, as far as the console reads it. */
export function fakeAttestation(id = "bmV3LWtleQ") {
  return {
    id,
    rawId: Uint8Array.from(Buffer.from(id, "base64url")).buffer,
    type: "public-key",
    authenticatorAttachment: null,
    response: {
      clientDataJSON: bytesOf('{"type":"webauthn.create"}'),
      attestationObject: bytesOf("attestation-object"),
      getTransports: () => ["usb", "nfc"],
    },
    getClientExtensionResults: () => ({ credProps: { rk: true } }),
  };
}

/** A credentials container that records what it was asked and answers with `answer`. */
export function fakeCredentials(answer: { create?: () => Promise<unknown>; get?: () => Promise<unknown> } = {}) {
  const calls: { kind: "create" | "get"; options: unknown }[] = [];
  return {
    calls,
    create: async (options: unknown) => {
      calls.push({ kind: "create", options });
      return (answer.create ?? (async () => fakeAttestation()))();
    },
    get: async (options: unknown) => {
      calls.push({ kind: "get", options });
      return (answer.get ?? (async () => fakeAssertion()))();
    },
  };
}

/** Registration options as the API writes them for an enrolment; `challenge` replaces the staff registration's own. */
export function enrollOptions(rpShared: boolean, challenge: string = registerChallenge()) {
  return {
    options: {
      challenge,
      rp: { id: "localhost", name: "korbat" },
      user: { id: Buffer.alloc(32, 9).toString("base64url"), name: "Blue key", displayName: "Blue key" },
      pubKeyCredParams: [
        { alg: -8, type: "public-key" },
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      timeout: 300_000,
      attestation: "none",
      excludeCredentials: [{ id: "b2xkLWtleQ", type: "public-key", transports: ["usb"] }],
      authenticatorSelection: { residentKey: "required", userVerification: "required", requireResidentKey: true },
      extensions: { credProps: true },
      hints: ["security-key"],
    },
    rpShared,
  };
}
```

### Replace `apps/admin/test/router.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { caseHref, isLowerUuid, parseCaseId, parseRoute } from "../src/router";

const CASE = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

/** The console's own router (3a design, section 9; 3c design, section 8): its fixed pages, a case by its id, and nothing else. */
describe("the router", () => {
  test("the queue, the appeals and a case by its lower-case id", () => {
    expect(parseRoute("/queue")).toEqual({ name: "queue" });
    expect(parseRoute("/queue/")).toEqual({ name: "queue" });
    expect(parseRoute("/appeals")).toEqual({ name: "appeals" });
    expect(parseRoute(`/cases/${CASE}`)).toEqual({ name: "case", id: CASE });
    expect(parseRoute(`/cases/${CASE}/`)).toEqual({ name: "case", id: CASE });
  });

  test("anything else under /cases is no page: an id in upper case, a part of one, a path below one, a list", () => {
    for (const path of ["/cases", "/cases/", `/cases/${CASE.toUpperCase()}`, `/cases/${CASE.slice(1)}`, `/cases/${CASE}/decisions`, `/cases/${CASE}x`, "/cases/..%2Fapi", `/Cases/${CASE}`, "/queue/x", "/appeals/1"]) {
      expect(parseRoute(path), path).toEqual({ name: "unknown" });
    }
  });

  test("parseCaseId makes a case's id only from a lower-case uuid, and a case's address is built from nothing else", () => {
    const id = parseCaseId(CASE);
    expect(id).toBe(CASE);
    expect(caseHref(id!)).toBe(`/cases/${CASE}`);
    for (const text of ["", "x", CASE.toUpperCase(), ` ${CASE}`, `${CASE}/..`, `${CASE}?x=1`, "javascript:alert(1)", "../../api/staff/me", CASE.split("-").join("")]) {
      expect(parseCaseId(text), text).toBeNull();
      expect(isLowerUuid(text), text).toBe(false);
    }
  });

  test("the four paths", () => {
    expect(parseRoute("/")).toEqual({ name: "home" });
    expect(parseRoute("/audit")).toEqual({ name: "audit" });
    expect(parseRoute("/signin")).toEqual({ name: "signin" });
    const token = "A".repeat(20) + "b_-".repeat(7) + "zz";
    expect(parseRoute(`/enroll/${token}`)).toEqual({ name: "enroll", token });
  });

  test("a trailing slash names the same page", () => {
    expect(parseRoute("/audit/")).toEqual({ name: "audit" });
    expect(parseRoute("/signin/")).toEqual({ name: "signin" });
    expect(parseRoute("/enroll/abc/")).toEqual({ name: "enroll", token: "abc" });
  });

  test("an enrolment path keeps its token exactly as written, for the page to check", () => {
    expect(parseRoute("/enroll/%3Cscript%3E")).toEqual({ name: "enroll", token: "%3Cscript%3E" });
  });

  test("anything else is no page of the console", () => {
    for (const path of ["", "/home", "/Audit", "/audit/x", "/enroll", "/enroll/", "/enroll/a/b", "/api/staff/me", "//audit", "/signin/x"]) {
      expect(parseRoute(path), path).toEqual({ name: "unknown" });
    }
  });
});
```

### Replace `apps/admin/test/screens.test.tsx` (whole file)

```tsx
import type { AuditEntry, StaffKey, StaffMe, StaffOverview, StaffSession } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "../src/App";
import { createStaffApi } from "../src/api";
import { IdleNotice, Layout } from "../src/Layout";
import { AuditView } from "../src/screens/Audit";
import { EnrollView } from "../src/screens/Enroll";
import { HomeView, openHome } from "../src/screens/Home";
import { SignInView } from "../src/screens/SignIn";
import { Unavailable, UNAVAILABLE_TEXT } from "../src/screens/Unavailable";
import { serverNow } from "../src/signins";
import { createConsoleStore } from "../src/store";
import type { Loadable } from "../src/ui";
import { CONSOLE_PATHS, envelope, FakeClock, fakeCredentials, fakeFetch, HOSTILE, HOSTILE_ESCAPED, hrefs, makeMe, OTHER_SESSION, SESSION_HANDLE, settle, tags } from "./fixtures";

/**
 * Each screen server-rendered, as the app's tests render theirs (3a design, section 12, Console). Every string a person
 * wrote (handles, key names, browser labels) arrives here hostile: markup, a javascript: URL, a direction override and
 * the longest name allowed. It must come out as escaped text in an isolating <bdi>, never as markup or a link.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const noop = () => undefined;

/** Every hostile string's text shows, escaped; no element or link came from any of them. */
function expectInert(out: string) {
  expect(out).toContain(HOSTILE_ESCAPED.script);
  expect(out).toContain(HOSTILE_ESCAPED.img);
  expect(out).not.toMatch(/<(script|img|svg|iframe|style|object|embed)\b/i);
  expect(out).not.toMatch(/href="javascript:/i);
  for (const href of hrefs(out)) expect(CONSOLE_PATHS, href).toContain(href);
  // The direction override stays inside an isolating element, so it cannot reorder the text around it.
  expect(out).toContain(`<bdi>${HOSTILE.bidi}</bdi>`);
}

const ME: StaffMe = { ...makeMe({ at: Date.parse("2026-10-01T09:40:00.000Z"), absolute: 12 * 3600, handle: HOSTILE.script }) };

const signIn = (handle: string, seq: number): AuditEntry => ({
  seq,
  hash: "b".repeat(64),
  createdAt: "2026-09-30T08:05:00.000Z",
  actorHandle: handle,
  action: "staff_sign_in",
  targetType: "staff_session",
  targetId: SESSION_HANDLE,
  actionHash: null,
});

const SESSIONS: StaffSession[] = [
  { handle: SESSION_HANDLE, browser: HOSTILE.img, createdAt: "2026-10-01T09:40:00.000Z", lastUsedAt: "2026-10-01T09:41:00.000Z", current: true },
  { handle: OTHER_SESSION, browser: HOSTILE.bidi, createdAt: "2026-10-01T07:00:00.000Z", lastUsedAt: "2026-10-01T07:30:00.000Z", current: false },
];

const KEYS: StaffKey[] = [
  { id: "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b", name: HOSTILE.long, createdAt: "2026-09-01T10:00:00.000Z", lastUsedAt: null },
  { id: "6c1f5b63-4d2e-4a7f-8b9c-8d7e6f5a4b3c", name: HOSTILE.url, createdAt: "2026-09-02T10:00:00.000Z", lastUsedAt: "2026-10-01T09:40:00.000Z" },
];

/** A quiet day: no open case, nothing revealed, nothing waiting. */
const QUIET: StaffOverview = {
  lanes: [
    { lane: 0, open: 0, oldestAt: null },
    { lane: 1, open: 0, oldestAt: null },
    { lane: 2, open: 0, oldestAt: null },
  ],
  appealsWaiting: 0,
  reveals: { total: 0, items: [] },
  imagesToday: [],
  findingsToday: [],
  mailsWaiting: { receipts: 0, authorMails: 0, outcomes: 0 },
  mailsFailed: { receipts: 0, authorMails: 0, outcomes: 0 },
  releaseOverdue: 0,
  deferUnproven: false,
};

describe("sign-in", () => {
  test("asks for the staff key", () => {
    const out = html(<SignInView ended={false} busy={false} error={null} onSignIn={noop} />);
    expect(out).toContain("Sign in with your staff key");
    expect(out).not.toContain("Your staff session ended");
    expect(out).toContain("<button");
  });

  test("after a session ended, says so", () => {
    expect(html(<SignInView ended busy={false} error={null} onSignIn={noop} />)).toContain("Your staff session ended.");
  });

  test("a failed sign-in shows the console's words and says to choose the security key or Windows Hello", () => {
    const out = html(<SignInView ended={false} busy={false} error="This key does not open the staff console." onSignIn={noop} />);
    expect(out).toContain('role="alert"');
    expect(out).toContain("This key does not open the staff console.");
    expect(out).toMatch(/security key or Windows Hello/);
    expect(out).toMatch(/password manager/);
  });

  test("a busy button says so and cannot be pressed twice", () => {
    expect(html(<SignInView ended={false} busy error={null} onSignIn={noop} />)).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/);
  });
});

describe("enrolment", () => {
  const base = { tokenValid: true, name: "", nameError: null, busy: null, result: null, check: { state: "none" }, onName: noop, onRegister: noop, onCheck: noop } as const;

  test("its guidance: which keys work, which are refused, the PIN, the name, and the two buttons", () => {
    const out = html(<EnrollView {...base} />);
    expect(out).toMatch(/security key with a PIN/);
    expect(out).toMatch(/Windows Hello on this computer/);
    expect(out).toMatch(/iCloud Keychain/);
    expect(out).toMatch(/Google Password Manager/);
    expect(out).toMatch(/phone&#x27;s own passkeys/);
    expect(out).toMatch(/set a PIN/i);
    expect(out).toMatch(/not your email address or your real name/);
    expect(out).toContain('maxLength="50"');
    expect(out).toContain(">Register a security key</button>");
    expect(out).toContain(">Use Windows Hello on this computer</button>");
    expect(out).toMatch(/choose Windows Hello or this device in the browser&#x27;s dialog/);
  });

  test("a link whose token is not one shows only that the link is no good", () => {
    const out = html(<EnrollView {...base} tokenValid={false} />);
    expect(out).toContain("This enrolment link has expired or was already used. Ask the operator for a new one.");
    expect(out).not.toContain("<button");
  });

  test("a name the rules refuse is said next to the field", () => {
    const out = html(<EnrollView {...base} name={HOSTILE.bidi} nameError="Give the key a name of 1 to 50 characters." />);
    expect(out).toContain("Give the key a name of 1 to 50 characters.");
    expect(out).toContain('aria-invalid="true"');
  });

  test("each refusal is explained in words, says the link still works, and how the refused passkey goes", () => {
    const synced = html(<EnrollView {...base} result={{ ok: false, code: "staff_key_not_device_bound", status: 403, cleanup: "signalled" }} />);
    expect(synced).toMatch(/saved a synced passkey/);
    expect(synced).toMatch(/link still works/);
    expect(synced).toMatch(/asked to remove/);
    const noPin = html(<EnrollView {...base} result={{ ok: false, code: "staff_key_not_user_verified", status: 403, cleanup: "by-hand" }} />);
    expect(noPin).toMatch(/asked for no PIN or fingerprint/);
    expect(noPin).toMatch(/link still works/);
    expect(noPin).toMatch(/Delete .* from your password manager by hand/);
    const refused = html(<EnrollView {...base} result={{ ok: false, code: "staff_key_refused", status: 400, cleanup: "none" }} />);
    expect(refused).toMatch(/answer could not be checked/);
    expect(refused).toMatch(/link still works/);
    expect(refused).not.toMatch(/password manager by hand|asked to remove/);
    for (const out of [synced, noPin, refused]) {
      expect(out).not.toMatch(/passkey_/);
      expect(out).toContain("<button");
    }
  });

  test("a dead link or a full set of keys leaves nothing to try", () => {
    for (const code of ["staff_enrollment_invalid", "staff_key_limit"]) {
      const out = html(<EnrollView {...base} result={{ ok: false, code, status: 400, cleanup: "none" }} />);
      expect(out, code).not.toContain("<button");
    }
  });

  const registered = (name: string) => ({ ok: true as const, key: { id: "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b", name, createdAt: "2026-10-01T09:00:00.000Z", lastUsedAt: null }, credentialId: "bmV3LWtleQ" });

  test("a registered key's name is text, and the page signs in with that key itself, never through the sign-in page", () => {
    for (const name of [HOSTILE.script, HOSTILE.img, HOSTILE.bidi]) {
      const out = html(<EnrollView {...base} result={registered(name)} />);
      expect(out).toMatch(/Sign in with it once/);
      expect(out).toContain(">Sign in with this key</button>");
      // The sign-in page would show home to a browser that already holds a staff session, and ask no key.
      expect(out).not.toContain('href="/signin"');
      expect(out).not.toMatch(/<(script|img)\b/);
      expect(out).toContain(`<bdi>`);
    }
  });

  test("the check after the enrolment: under way, opened the console, or failed with the operator to tell", () => {
    const busy = html(<EnrollView {...base} result={registered("Blue key")} check={{ state: "busy" }} />);
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/);
    const opened = html(<EnrollView {...base} result={registered(HOSTILE.script)} check={{ state: "opened" }} />);
    expect(opened).toMatch(/opened the console/);
    expect(opened).toContain(HOSTILE_ESCAPED.script);
    expect(hrefs(opened)).toEqual(["/"]);
    expect(opened).not.toContain(">Sign in with this key</button>");
    const failed = html(<EnrollView {...base} result={registered("Blue key")} check={{ state: "failed", message: "This key does not open the staff console." }} />);
    expect(failed).toContain("This key does not open the staff console.");
    expect(failed).toMatch(/tell the operator at once/);
    // The person may try again: a closed prompt is no verdict on the key.
    expect(failed).toContain(">Sign in with this key</button>");
  });
});

describe("home", () => {
  const props = {
    me: ME,
    overview: { state: "ready" as const, value: QUIET },
    now: Date.parse("2026-10-01T09:40:00.000Z"),
    onOpenCase: noop,
    signIns: { state: "ready" as const, value: [signIn(HOSTILE.script, 9), signIn(HOSTILE.bidi, 8), signIn(HOSTILE.img, 7)] },
    sessions: { state: "ready" as const, value: SESSIONS },
    keys: { state: "ready" as const, value: KEYS },
    revoking: null,
    notice: null,
    error: null,
    onRevoke: noop,
  };

  test("who is signed in, the role, the session's end, sign-ins, sessions and keys, every string as text", () => {
    const out = html(<HomeView {...props} />);
    expectInert(out);
    expect(out).toContain("Signed in until 21:40");
    expect(out).toContain("moderator");
    expect(out).toContain("2026-09-30 08:05");
    expect(out).toContain(HOSTILE.long);
    expect(out).toContain("javascript:alert(3)");
    // The cases' overview stands before the sign-ins; the placeholder line of 3a is gone.
    expect(out).not.toContain("Cases arrive in sub-project 3c.");
    expect(out).toContain("Urgent: no open case");
    expect(out.indexOf("Urgent: no open case")).toBeLessThan(out.indexOf("Staff sign-ins in the last 7 days"));
  });

  test("Sign out that session on the other sessions, never on this one", () => {
    const out = html(<HomeView {...props} />);
    expect(out.match(/>Sign out that session</g)).toHaveLength(1);
    expect(out).toContain("This session");
  });

  test("a revocation under way, its outcome, and a refusal in the console's words", () => {
    expect(html(<HomeView {...props} revoking={OTHER_SESSION} />)).toMatch(/aria-busy="true"/);
    expect(html(<HomeView {...props} notice="That session is signed out." />)).toContain("That session is signed out.");
    expect(html(<HomeView {...props} error="That confirmation was for another action." />)).toMatch(/role="alert"[^>]*>That confirmation was for another action\./);
  });

  test("no sign-ins, and lists still loading or failed", () => {
    const out = html(<HomeView {...props} signIns={{ state: "ready", value: [] }} sessions={{ state: "loading" }} keys={{ state: "failed", message: "Cannot reach the server." }} />);
    expect(out).toContain("No staff sign-ins in the last 7 days.");
    expect(out).toContain("Loading");
    expect(out).toContain("Cannot reach the server.");
  });

  test("opened 11 hours after the page read its session, it lists sign-ins back to 7 days before its own opening", async () => {
    // The page read its session at 09:00 and its person kept acting, so the idle timer never read /me again: the session
    // the page holds still says 09:00 when Home opens at 20:00.
    const pageOpened = Date.parse("2026-10-01T09:00:00.000Z");
    const homeOpened = Date.parse("2026-10-01T20:00:00.000Z");
    const at = (createdAt: string, seq: number): AuditEntry => ({ ...signIn("mod_anna", seq), createdAt });
    const fake = fakeFetch({
      "GET /api/staff/me": [{ status: 200, body: makeMe({ at: pageOpened }) }, { status: 200, body: makeMe({ at: homeOpened, absolute: 3600 }) }],
      "GET /api/staff/audit?action=staff_sign_in": {
        status: 200,
        body: {
          entries: [
            at("2026-10-01T19:00:00.000Z", 40),
            at("2026-09-24T20:30:00.000Z", 39),
            // Older than 7 days at 20:00, though not at the page's stale 09:00: the list ends before it.
            at("2026-09-24T19:30:00.000Z", 38),
            at("2026-09-24T09:30:00.000Z", 37),
          ],
          nextCursor: 37,
        },
      },
      "GET /api/staff/sessions": { status: 200, body: { sessions: [] } },
      "GET /api/staff/keys": { status: 200, body: { keys: [] } },
      "GET /api/staff/overview": { status: 200, body: QUIET },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const store = createConsoleStore({ api, clock: new FakeClock(), path: "/", history: { pushState: noop, replaceState: noop } });
    await store.start();
    const held = store.get().session;
    if (held.kind !== "signed-in") throw new Error("the page holds no session");
    expect(serverNow(held.me)).toBe(pageOpened);

    // What the screen runs when it opens, with the session the page holds as its `me`.
    let signIns: Loadable<AuditEntry[]> = { state: "loading" };
    openHome(api, { current: true }, { overview: noop, signIns: (value) => (signIns = value), sessions: noop, keys: noop });
    await settle();
    expect(signIns).toMatchObject({ state: "ready" });
    const out = html(<HomeView {...props} me={held.me} signIns={signIns} />);
    expect(out).toContain("2026-10-01 19:00");
    expect(out).toContain("2026-09-24 20:30");
    expect(out).not.toContain("2026-09-24 19:30");
    expect(out).not.toContain("2026-09-24 09:30");
    // The screen's own /me, marked as its person's opening of it, came before the first page of sign-ins.
    const asked = fake.requests.map((r) => `${r.url} ${r.headers["x-staff-activity"]}`);
    expect(asked.filter((r) => r.startsWith("/api/staff/me"))).toEqual(["/api/staff/me 1", "/api/staff/me 1"]);
    expect(asked.indexOf("/api/staff/audit?action=staff_sign_in 1")).toBeGreaterThan(asked.lastIndexOf("/api/staff/me 1"));
    store.dispose();
  });
});

describe("the audit log", () => {
  const entries: AuditEntry[] = [
    { seq: 120, hash: "c".repeat(64), createdAt: "2026-10-01T09:00:05.000Z", actorHandle: HOSTILE.script, action: "staff_session_revoked", targetType: "staff_session", targetId: OTHER_SESSION, actionHash: "d".repeat(64) },
    { seq: 119, hash: "e".repeat(64), createdAt: "2026-10-01T08:00:00.000Z", actorHandle: HOSTILE.bidi, action: HOSTILE.img, targetType: null, targetId: null, actionHash: null },
    { seq: 118, hash: "f".repeat(64), createdAt: "2026-10-01T07:00:00.000Z", actorHandle: null, action: "staff_key_added", targetType: "staff_key", targetId: HOSTILE.url, actionHash: null },
  ];
  const props = {
    page: { state: "ready" as const, value: entries },
    hasOlder: true,
    loadingOlder: false,
    at: null,
    place: "",
    placeError: null,
    error: null,
    onLoadOlder: noop,
    onPlace: noop,
    onGoToPlace: noop,
    onNewest: noop,
  };

  test("a table, newest first, with each row's place and full hash, every string as text", () => {
    const out = html(<AuditView {...props} />);
    expectInert(out);
    expect(out).toContain("<table");
    expect(out.indexOf(">120<")).toBeLessThan(out.indexOf(">119<"));
    expect(out).toContain("c".repeat(64));
    expect(out).toContain("d".repeat(64));
    expect(out).toContain("javascript:alert(3)");
  });

  test("Load older while there is an older page, and Go to place", () => {
    const out = html(<AuditView {...props} />);
    expect(out).toContain(">Load older</button>");
    expect(out).toContain(">Go to place</button>");
    expect(html(<AuditView {...props} hasOlder={false} />)).not.toContain(">Load older</button>");
  });

  test("a page opened at a place offers the newest again, and a place the rules refuse is said", () => {
    const out = html(<AuditView {...props} at={120} place="120" />);
    expect(out).toContain(">Newest</button>");
    expect(out).toContain("From place 120, newest first.");
    expect(html(<AuditView {...props} place="abc" placeError="Enter a place: a whole number from 1." />)).toContain("Enter a place: a whole number from 1.");
  });
});

describe("a place that names no row", () => {
  const props = { hasOlder: false, loadingOlder: false, place: "", placeError: null, error: null, onLoadOlder: noop, onPlace: noop, onGoToPlace: noop, onNewest: noop };
  const row = (seq: number): AuditEntry => ({ seq, hash: "c".repeat(64), createdAt: "2026-10-01T09:00:05.000Z", actorHandle: null, action: "staff_sign_in", targetType: null, targetId: null, actionHash: null });

  test("a place beyond the newest row: the page says there is no row there, and never that it starts there", () => {
    // The reader answers a place beyond the head with the newest page: after a restore, or the newest rows deleted.
    const out = html(<AuditView {...props} at={5000} page={{ state: "ready", value: [row(4800), row(4799)] }} />);
    expect(out).toContain("There is no row at place 5000");
    expect(out).toContain("4800");
    expect(out).toMatch(/tell the operator/);
    expect(out).toMatch(/role="alert"/);
    expect(out).not.toContain("From place 5000");
  });

  test("an empty log, opened at a place", () => {
    const out = html(<AuditView {...props} at={7} page={{ state: "ready", value: [] }} />);
    expect(out).toContain("There is no row at place 7");
    expect(out).not.toContain("From place 7");
  });

  test("while the page loads, nothing is said about the place", () => {
    const out = html(<AuditView {...props} at={7} page={{ state: "loading" }} />);
    expect(out).not.toContain("There is no row");
  });
});

describe("the warnings of the idle timer", () => {
  test("a live region is always there, so a warning is announced when it appears", () => {
    expect(html(<IdleNotice warning={null} onStay={noop} />)).toMatch(/role="status"/);
  });

  test("the idle warning, with Stay signed in", () => {
    const out = html(<IdleNotice warning={{ kind: "idle" }} onStay={noop} />);
    expect(out).toContain("Your staff session ends in 2 minutes.");
    expect(out).toContain(">Stay signed in</button>");
  });

  test("the absolute end's warning, without a button", () => {
    const out = html(<IdleNotice warning={{ kind: "absolute", endsAt: "2026-10-01T21:40:00.000Z" }} onStay={noop} />);
    expect(out).toContain("Your staff session ends at 21:40. Sign in again with your staff key then.");
    expect(out).not.toContain("<button");
  });

  test("the layout names who is signed in as text, and links only to the console's own pages", () => {
    const out = html(
      <Layout me={ME} path="/" warning={null} onNavigate={noop} onSignOut={noop} onStay={noop}>
        <p>child</p>
      </Layout>,
    );
    expect(out).toContain(HOSTILE_ESCAPED.script);
    for (const href of hrefs(out)) expect(CONSOLE_PATHS).toContain(href);
    expect(out).toContain('aria-current="page"');
    expect(out).toContain(">Sign out</button>");
  });
});

describe("a console that is off, or opened at another address", () => {
  test("shows only the sentence", () => {
    expect(UNAVAILABLE_TEXT).toBe(
      "The staff console is not available at this address. It is off on this server, or this is not the address set in CONSOLE_ORIGIN: open it at exactly that address, never at 127.0.0.1.",
    );
    const out = html(<Unavailable />);
    expect(out).toContain(UNAVAILABLE_TEXT);
    expect(tags(out)).toEqual(new Set(["main", "p"]));
  });
});

describe("the whole page by the console's state", () => {
  async function page(path: string, table: Parameters<typeof fakeFetch>[0], cookie = "") {
    const api = createStaffApi({ fetch: fakeFetch(table).fetch, cookie: () => cookie });
    const store = createConsoleStore({ api, clock: new FakeClock(), path, history: { pushState: noop, replaceState: noop } });
    await store.start();
    return { store, render: () => html(<App store={store} credentials={fakeCredentials()} signal={undefined} />) };
  }

  test("the home and audit pages for a live session", async () => {
    const home = await page("/", { "GET /api/staff/me": { status: 200, body: ME } });
    expect(home.render()).toMatch(/<h2[^>]*>Home</);
    expect(home.render()).toContain(HOSTILE_ESCAPED.script);
    const audit = await page("/audit", { "GET /api/staff/me": { status: 200, body: ME } });
    expect(audit.render()).toMatch(/<h2[^>]*>Audit log</);
  });

  test("sign-in in place, at the same address, when the session ended", async () => {
    const p = await page("/audit", { "GET /api/staff/me": [{ status: 200, body: ME }, { status: 401, body: envelope("staff_session_required") }] });
    await p.store.api.me().catch(() => undefined);
    const out = p.render();
    expect(out).toContain("Your staff session ended.");
    expect(out).not.toMatch(/<h2[^>]*>Audit log</);
  });

  test("reopened after its session ended while no page held it, the page says the session ended, at the same address", async () => {
    // The staff CSRF cookie is set only by a sign-in and lasts the session's 12 hours; only a sign-out or this 401 clears it.
    const p = await page("/audit", { "GET /api/staff/me": { status: 401, body: envelope("staff_session_required") } }, "__Host-korbat_staff_csrf=t");
    const out = p.render();
    expect(out).toContain("Your staff session ended.");
    expect(out).toContain("Sign in with your staff key");
    expect(p.store.get().path).toBe("/audit");
  });

  test("opened with no staff session at all, plain sign-in", async () => {
    const p = await page("/audit", { "GET /api/staff/me": { status: 401, body: envelope("staff_session_required") } });
    const out = p.render();
    expect(out).toContain("Sign in with your staff key");
    expect(out).not.toContain("Your staff session ended");
  });

  test("only the sentence when the console is off", async () => {
    const p = await page("/", {});
    expect(p.render()).toBe(html(<Unavailable />));
  });

  test("the enrolment page with no session read", async () => {
    const token = "A".repeat(43);
    const p = await page(`/enroll/${token}`, {});
    expect(p.render()).toContain(">Register a security key</button>");
  });

  test("an address the console does not have", async () => {
    const p = await page("/nowhere", { "GET /api/staff/me": { status: 200, body: ME } });
    expect(p.render()).toMatch(/no page at this address/);
  });
});
```

### Replace `apps/admin/test/source.test.ts` (whole file)

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { describe, expect, test } from "vitest";

/**
 * What the console's source must never hold (3a design, sections 3 and 9, and console-lab.md section 8). The page runs
 * under require-trusted-types-for 'script' with trusted-types 'none', so each of these sinks would throw at run time and
 * take its screen down; this scan finds them first. Every user-written string is a text node, and no link is built from
 * data.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

/**
 * Every line of the page's source (src/, which the bundle is built from) matching `pattern`, as `file:line`. The build
 * and development scripts run in Node, never in the page, so they are not scanned: the page they write needs its one
 * script element.
 */
function findInSource(pattern: RegExp): string[] {
  const found: string[] = [];
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).map((file) => path.join("src", file));
  for (const file of files) {
    if (!/\.(ts|tsx|css)$/.test(file)) continue;
    const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.split(path.sep).join("/")}:${index + 1}`);
    });
  }
  return found.sort();
}

describe("no HTML or script sink in apps/admin", () => {
  const sinks: [string, RegExp][] = [
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["innerHTML and outerHTML", /\b(inner|outer)HTML\b/],
    ["insertAdjacentHTML", /insertAdjacentHTML/],
    ["createContextualFragment", /createContextualFragment/],
    ["document.write", /document\.write/],
    ["srcdoc", /srcdoc/i],
    ["eval", /\beval\s*\(/],
    ["new Function", /new\s+Function\b|\bFunction\s*\(/],
    ["a string as a timer's code", /setTimeout\(\s*["'`]|setInterval\(\s*["'`]/],
    ["a rendered script or style element", /<script|<style|createElement\(\s*["'`](script|style)/i],
    ["React's preinit and preload", /\bpre(init|initModule|load|loadModule)\b/],
    ["a style attribute set as text", /setAttribute\(\s*["'`]style/],
    ["setAttribute at all: React sets every attribute", /\.setAttribute\(/],
    ["a Trusted Types policy", /trustedTypes|createPolicy/],
    ["DOMParser", /DOMParser/],
    ["window.open and navigations built in code", /window\.open|location\.(href|assign|replace)\s*[=(]/],
  ];
  for (const [name, pattern] of sinks) {
    test(name, () => {
      expect(findInSource(pattern)).toEqual([]);
    });
  }

  test("no style prop: every style is in the one CSS file", () => {
    expect(findInSource(/\bstyle=\{/)).toEqual([]);
    const css = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".css"));
    expect(css).toEqual(["app.css"]);
  });

  test("no link is built from data: the only two hrefs written from a value are NavLink's, whose type lists the console's own paths, and CaseLink's, built from a checked case id", () => {
    expect(findInSource(/href=\{/).map((found) => found.split(":")[0])).toEqual(["src/nav.tsx", "src/nav.tsx"]);
    const nav = readFileSync(path.join(SRC, "nav.tsx"), "utf8");
    expect([...nav.matchAll(/href=\{[^}]*\}/g)].map((found) => found[0])).toEqual(["href={to}", "href={caseHref(id)}"]);
    expect(nav).toMatch(/to: ConsolePath/);
    expect(nav).toMatch(/id: CaseId/);
    const router = readFileSync(path.join(SRC, "router.ts"), "utf8");
    expect(router).toMatch(/export type ConsolePath = "\/" \| "\/audit" \| "\/signin" \| "\/queue" \| "\/appeals";/);
    // A CaseId is made in one place, by the function that checks it: nothing else may call a text a case's id.
    expect(findInSource(/\bas CaseId\b/).map((found) => found.split(":")[0])).toEqual(["src/router.ts"]);
    expect(router).toMatch(/return isLowerUuid\(text\) \? \(text as CaseId\) : null;/);
  });

  test("no src or action attribute written from a value, but the one image site, whose address is built from two checked ids and a literal size", () => {
    expect(findInSource(/\b(action|formAction|xlinkHref)=\{/)).toEqual([]);
    expect(findInSource(/\bsrc=\{/).map((found) => found.split(":")[0])).toEqual(["src/media.tsx"]);
    const media = readFileSync(path.join(SRC, "media.tsx"), "utf8");
    expect(media).toMatch(/src=\{staffImageSrc\(caseId, mediaId, size\)\}/);
    expect(media).toMatch(/staffImageSrc\(caseId: CaseId, mediaId: ImageId, size: StaffImageSize\)/);
    expect(findInSource(/\bas ImageId\b/).map((found) => found.split(":")[0])).toEqual(["src/media.tsx"]);
    // An image element is written nowhere else.
    expect(findInSource(/<img\b/).map((found) => found.split(":")[0])).toEqual(["src/media.tsx"]);
    // And nothing else builds an image's address: staffImageSrc is declared and called in that file alone, once each.
    expect(findInSource(/\bstaffImageSrc\b/).map((found) => found.split(":")[0])).toEqual(["src/media.tsx", "src/media.tsx"]);
    expect(media.match(/\bstaffImageSrc\(/g)).toHaveLength(2);
    // A failed load reaches the page through a handler React attaches (a prop), never through an attribute written as text.
    expect(media).toMatch(/onError=\{onError\}/);
    expect(findInSource(/\bon[A-Z][A-Za-z]*=["'`]/)).toEqual([]);
  });

  test("every refusal and every outcome is worded from messages.ts, one table each: no screen keeps a table of its own", () => {
    // A table of words by code or by outcome is an object whose keys are the contracts' names: none is written outside
    // the one file, where a second copy could drift from the first. A key opens a line or follows a brace or a comma.
    const keyed = /(^|[{,])\s*(rate_limited|not_found|invalid_request|staff_recused|text_invalid|restricted_rule|restricted_legal|no_violation|not_evident|not_available|partly_reversed|interim|correction)\s*:/;
    expect([...new Set(findInSource(keyed).map((found) => found.split(":")[0]))]).toEqual(["src/messages.ts"]);
    const messages = readFileSync(path.join(SRC, "messages.ts"), "utf8").split("\n");
    for (const table of ["CASE_WORDS", "REVEAL_WORDS", "NOTE_WORDS", "FINDING_WORDS", "OUTCOME_WORDS", "DECISION_KINDS", "DECISION_OUTCOMES"]) {
      expect(messages.filter((line) => line.startsWith(`export const ${table}:`) || line.startsWith(`export const ${table} =`)), table).toHaveLength(1);
      // Declared nowhere else: the name follows `const` in that one file only.
      expect(findInSource(new RegExp(`const ${table}[^A-Za-z0-9_]`)).map((found) => found.split(":")[0]), table).toEqual(["src/messages.ts"]);
    }
  });

  test("no link into the app: no source line writes the address of a post or a profile", () => {
    expect(findInSource(/["'`]\/(post|u)\//)).toEqual([]);
    expect(findInSource(/APP_ORIGIN|appOrigin/)).toEqual([]);
  });

  test("never a passkey_* code or text: the console has its own words", () => {
    expect(findInSource(/passkey_/)).toEqual([]);
  });
});

describe("the key is asked only after the console checked what it is asked to sign", () => {
  test("a confirmation asks the key in one function, which every confirmed action goes through", () => {
    const stepUp = readFileSync(path.join(SRC, "step-up.ts"), "utf8");
    expect(stepUp.match(/credentials\.get\(/g)).toHaveLength(1);
    expect(stepUp).toMatch(/export async function confirmWithKey</);
    // The revocation of a session and the reveal are callers of it; neither asks the key itself.
    expect(stepUp.match(/confirmWithKey\(deps, action,/g)).toHaveLength(2);
  });

  test("navigator.credentials is called only by the three ceremonies, each of which checks its challenge first", () => {
    // A fourth call site would need a check of its own (3a design, section 9): this list makes adding one a decision.
    expect(findInSource(/credentials\.(get|create)\(/).map((found) => found.split(":")[0])).toEqual(["src/enroll.ts", "src/sign-in.ts", "src/step-up.ts"]);
    const checks: [string, RegExp][] = [
      ["enroll.ts", /checkRegisterChallenge\(/],
      ["sign-in.ts", /checkSignInChallenge\(/],
      ["step-up.ts", /checkStepUpOptions\(/],
    ];
    for (const [file, check] of checks) {
      const source = readFileSync(path.join(SRC, file), "utf8");
      const call = source.search(/credentials\.(get|create)\(/);
      // The check is called in the function that makes the call, before it, as it runs before it. Only that function's
      // text up to the call is searched: a check declared in the same file (step-up.ts declares checkStepUpOptions) is
      // another top-level function, so its name there never stands in for the call.
      const declarations = [...source.matchAll(/^(export )?(async )?function \w+/gm)].map((found) => found.index ?? -1);
      const enclosing = Math.max(...declarations.filter((at) => at < call));
      expect(call, file).toBeGreaterThan(-1);
      expect(enclosing, file).toBeGreaterThan(-1);
      expect(source.slice(enclosing, call).search(check), file).toBeGreaterThan(-1);
    }
  });
});

describe("zod is jitless before the first schema is built", () => {
  test("the entry's first import is the module that sets it", () => {
    const main = readFileSync(path.join(SRC, "main.tsx"), "utf8");
    const imports = [...main.matchAll(/^import\s.*$/gm)].map((m) => m[0]);
    expect(imports[0]).toBe('import "./zod-jitless";');
    expect(readFileSync(path.join(SRC, "zod-jitless.ts"), "utf8")).toMatch(/z\.config\(\{ jitless: true \}\);/);
  });

  test("the module imports nothing that builds a schema", () => {
    const source = readFileSync(path.join(SRC, "zod-jitless.ts"), "utf8");
    expect([...source.matchAll(/^import\s.*$/gm)].map((m) => m[0])).toEqual(['import { z } from "zod";']);
  });

  test("loading it turns zod's eval probe off", async () => {
    await import("../src/zod-jitless");
    expect(z.config().jitless).toBe(true);
  });
});
```

### Replace `apps/api/test/mail/templates.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { MemoryMailer } from "../../src/mail/memory";
import { renderTemplate } from "../../src/mail/templates";

describe("mail templates", () => {
  test("code emails carry the code and expiry, and no links or images", () => {
    const r = renderTemplate("sign_in_code", { code: "123456" });
    expect(r.subject).toBe("Your korbat sign-in code");
    expect(r.text).toContain("123456");
    expect(r.text).toContain("10 minutes");
    expect(r.html).toContain("123456");
    expect(r.html).not.toMatch(/<img|<a |https?:\/\//);
  });
  test("every template renders and HTML escapes its data", () => {
    const data = {
      code: "123456",
      deviceLabel: "<b>Chrome</b> on Windows",
      notMeUrl: "http://localhost:8081/not-me/abc",
      revertUrl: "http://localhost:8081/email-revert/def",
      minutes: "15",
      count: "3",
      email: "new<address>@example.com",
      name: "<i>Work</i> laptop",
      time: "2026-09-25 10:00 UTC",
      removeUrl: "http://localhost:8081/passkey-remove/ghi",
      browser: "Firefox on Linux",
      names: '"Blue key", "Red key"',
      ref: "N-ABCDEFGH23",
      items: "http://localhost:8081/post/0190f3a2-7c1e-7b1a-9f00-0123456789ab",
      pageUrl: "http://localhost:8081/notice/N-ABCDEFGH23#t=mail-token",
      termsUrl: "http://localhost:8081/terms",
      oldest: "2026-10-04 06:59 UTC",
      handle: "mod_anna",
      limit: "10",
    };
    for (const template of [
      "sign_in_code",
      "sign_up_code",
      "reauth_code",
      "new_device",
      "account_locked",
      "mfa_enabled",
      "mfa_disabled",
      "password_changed",
      "recovery_codes_regenerated",
      "sessions_revoked_all",
      "email_change_code",
      "email_changed",
      "email_change_reverted",
      "badge_verified",
      "badge_removed",
      "delete_account_code",
      "account_deleted",
      "passkey_added",
      "passkey_removed",
      "passkey_suspect",
      "recovery_code_used",
      "staff_key_added",
      "staff_session_started",
      "staff_key_suspect",
      "staff_keys_revoked",
      "notice_received",
      "moderation_urgent",
      "moderation_reads",
      "moderation_reveal",
    ] as const) {
      const r = renderTemplate(template, data);
      expect(r.subject.length, template).toBeGreaterThan(5);
      expect(r.text.length, template).toBeGreaterThan(20);
      // Links stay plain text (new_device carries the not-me URL that way); nothing is ever an anchor or an image.
      expect(r.html, template).not.toMatch(/<img|<a /);
    }
    const newDevice = renderTemplate("new_device", data);
    expect(newDevice.html).toContain("&lt;b&gt;Chrome&lt;/b&gt;");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
    const emailChanged = renderTemplate("email_changed", data);
    expect(emailChanged.html).toContain("new&lt;address&gt;@example.com");
    expect(emailChanged.text).toContain("new<address>@example.com");
    expect(emailChanged.text).toContain("http://localhost:8081/email-revert/def");
  });
  test("the mails that carry a lockdown link, and the note after one ran, say what the lockdown does (1c design, section 7.6)", () => {
    // The link's page says the same before the owner opens it (Task 7); the mail is where they first read it.
    const lockdownWording = (text: string) => {
      expect(text).toMatch(/signs out every session|every session was signed out/);
      expect(text).toMatch(/removes (your|the) password|password was removed/);
      expect(text).toMatch(/passkey/);
      expect(text).toMatch(/two-factor authentication/);
      expect(text).toMatch(/the day before/);
    };
    const newDevice = renderTemplate("new_device", { deviceLabel: "Chrome on Windows", notMeUrl: "http://localhost:8081/not-me/abc" });
    expect(newDevice.text).toContain("Chrome on Windows");
    expect(newDevice.text).toContain("24 hours");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
    lockdownWording(newDevice.text);
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("24 hours");
    expect(changed.text).toMatch(/back to this address/);
    expect(changed.text).toContain("http://localhost:8081/email-revert/abc");
    lockdownWording(changed.text);
    const reverted = renderTemplate("email_change_reverted", {});
    expect(reverted.text).toMatch(/back at this address/);
    expect(reverted.text).not.toMatch(/https?:\/\//);
    lockdownWording(reverted.text);
  });
  test("a recovery code spent at re-authentication is announced, without a link", () => {
    const used = renderTemplate("recovery_code_used", {});
    expect(used.subject).toBe("A recovery code was used on your korbat account");
    expect(used.text).toMatch(/recovery code/);
    expect(used.text).toMatch(/once/);
    expect(used.text).toMatch(/If this was not you/);
    expect(used.text).not.toMatch(/https?:\/\//);
  });
  test("the account lifecycle templates say what happened and what to do if it was not the owner", () => {
    const changeCode = renderTemplate("email_change_code", { code: "654321" });
    expect(changeCode.text).toContain("654321");
    expect(changeCode.text).toContain("10 minutes");
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("new@example.com");
    expect(changed.text).toMatch(/stays? signed in/);
    expect(changed.text).toMatch(/If this was not you, open this link within 24 hours\./);
    expect(changed.text).toMatch(/: http:\/\/localhost:8081\/email-revert\/abc$/m);
    // A change while an earlier change's link is still out sends no link of its own, and says where the one that works went.
    const again = renderTemplate("email_changed", { email: "new@example.com" });
    expect(again.text).toContain("new@example.com");
    expect(again.text).not.toMatch(/https?:\/\//);
    expect(again.text).toMatch(/less than a day ago/);
    const reverted = renderTemplate("email_change_reverted", {});
    expect(reverted.text).toMatch(/back at this address/);
    expect(reverted.text).toMatch(/every session/i);
    const deleteCode = renderTemplate("delete_account_code", { code: "111222" });
    expect(deleteCode.text).toContain("111222");
    expect(deleteCode.text).toMatch(/delete/i);
    expect(deleteCode.text).toMatch(/revoke|sign out/i);
    expect(renderTemplate("account_deleted", {}).text).toMatch(/cannot be undone/);
    expect(renderTemplate("badge_verified", {}).text).toMatch(/verified/i);
    expect(renderTemplate("badge_removed", {}).text).toMatch(/removed/i);
  });
  test("the passkey templates name the passkey, say what happened and what to do, and never let the name become HTML", () => {
    const name = `<img src=x onerror=alert(1)> "Work" laptop`;
    const removeUrl = "http://localhost:8081/passkey-remove/abc";
    const added = renderTemplate("passkey_added", { name, deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl });
    expect(added.subject).toBe("A passkey was added to your korbat account");
    expect(added.text).toContain(name);
    expect(added.text).toContain("Chrome on Windows");
    expect(added.text).toContain("2026-09-25 10:00 UTC");
    expect(added.text).toContain(removeUrl);
    expect(added.text).toContain("7 days");
    // What the link does (the lockdown of the 1c design, section 7.6), before the owner opens it.
    expect(added.text).toMatch(/removes? (this|the) passkey/);
    expect(added.text).toMatch(/sign(s)? out every session/);
    expect(added.text).toMatch(/password/);
    expect(added.text).toMatch(/two-factor authentication/);
    expect(added.text).toMatch(/the day before/);
    expect(added.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Work&quot; laptop");
    expect(added.html).not.toMatch(/<img|<a /);
    expect(added.html).toContain(removeUrl);

    const removed = renderTemplate("passkey_removed", { name, time: "2026-09-25 11:00 UTC" });
    expect(removed.subject).toBe("A passkey was removed from your korbat account");
    expect(removed.text).toContain(name);
    expect(removed.text).toContain("2026-09-25 11:00 UTC");
    expect(removed.text).not.toMatch(/https?:\/\//);
    expect(removed.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(removed.html).not.toMatch(/<img|<a /);

    const suspect = renderTemplate("passkey_suspect", { name });
    expect(suspect.subject).toBe("A passkey on your korbat account was switched off");
    expect(suspect.text).toContain(name);
    expect(suspect.text).toMatch(/copy/);
    expect(suspect.text).toMatch(/switched (it|that passkey) off/);
    expect(suspect.text).toMatch(/remove it/i);
    expect(suspect.text).toMatch(/add a new one/);
    expect(suspect.text).not.toMatch(/https?:\/\//);
    expect(suspect.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(suspect.html).not.toMatch(/<img|<a /);
  });
  describe("the staff mails (3a design, section 7)", () => {
    const LAST = "korbat never puts a link in a staff email.";
    const name = `<img src=x onerror=alert(1)> "Blue" key`;

    /** Plain paragraphs with no link of any kind, the last one saying so; and a user-written name never becomes HTML. */
    function linkless(template: string, r: { text: string; html: string }) {
      expect(r.text, template).not.toMatch(/https?:|www\.|:\/\//);
      expect(r.html, template).not.toMatch(/<img|<a |href=|https?:/);
      expect(r.text.trimEnd().split("\n\n").at(-1), template).toBe(LAST);
    }

    test("staff_key_added names the key and the time, and tells the person to go to the operator if it was not them", () => {
      const r = renderTemplate("staff_key_added", { name, time: "2026-10-01 09:30 UTC" });
      expect(r.subject).toBe("A staff key was added to your korbat staff account");
      expect(r.text).toBe(
        [
          `A staff key named "${name}" was registered for your korbat staff account at 2026-10-01 09:30 UTC. It can open the staff console.`,
          "If this was you, there is nothing to do. If not, tell the operator at once; they revoke the key with the staff command line.",
          LAST,
        ].join("\n\n") + "\n",
      );
      expect(r.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Blue&quot; key");
      linkless("staff_key_added", r);
    });

    test("staff_session_started names the key, the browser and the time", () => {
      const r = renderTemplate("staff_session_started", { name, browser: "Firefox on Linux", time: "2026-10-01 09:31 UTC" });
      expect(r.subject).toBe("A staff session started on the korbat console");
      expect(r.text).toBe(
        [
          `A staff session was started on the korbat console at 2026-10-01 09:31 UTC with your staff key "${name}", from Firefox on Linux.`,
          "If this was you, there is nothing to do. If not, someone holds that key: tell the operator at once; they revoke it and every session it opened with the staff command line.",
          LAST,
        ].join("\n\n") + "\n",
      );
      linkless("staff_session_started", r);
    });

    test("staff_key_suspect says the key was switched off as a likely copy, and never sends the person to the app's Security screen", () => {
      const r = renderTemplate("staff_key_suspect", { name });
      expect(r.subject).toBe("A staff key on your korbat staff account was switched off");
      expect(r.text).toBe(
        [
          `A use of your staff key "${name}" on the korbat console (a sign-in or a confirmation) looked like a copy of it, so korbat switched that key off and ended every staff session it opened. It can no longer open the console.`,
          "Ask the operator for a link to register a new key. If you did not use it just now, tell them so: someone else holds a copy of the key.",
          LAST,
        ].join("\n\n") + "\n",
      );
      expect(r.text).not.toMatch(/Security/);
      linkless("staff_key_suspect", r);
    });

    test("staff_keys_revoked lists the keys and the time", () => {
      const r = renderTemplate("staff_keys_revoked", { names: `"${name}", "Red key"`, time: "2026-10-01 09:32 UTC" });
      expect(r.subject).toBe("Staff keys revoked on your korbat staff account");
      expect(r.text).toBe(
        [
          `These staff keys of your korbat staff account were revoked at 2026-10-01 09:32 UTC: "${name}", "Red key". They can no longer open the console, and every staff session they opened has ended.`,
          "If you expected this, there is nothing to do. If not, ask the operator why.",
          LAST,
        ].join("\n\n") + "\n",
      );
      linkless("staff_keys_revoked", r);
    });

    test("each staff mail needs its data", () => {
      expect(() => renderTemplate("staff_key_added", { name: "Blue key" })).toThrow(/time/);
      expect(() => renderTemplate("staff_key_added", { time: "2026-10-01 09:30 UTC" })).toThrow(/name/);
      expect(() => renderTemplate("staff_session_started", { name: "Blue key", time: "2026-10-01 09:31 UTC" })).toThrow(/browser/);
      expect(() => renderTemplate("staff_key_suspect", {})).toThrow(/name/);
      expect(() => renderTemplate("staff_keys_revoked", { time: "2026-10-01 09:32 UTC" })).toThrow(/names/);
    });
  });

  describe("the moderation mails of reports and notices (3c design, section 7.15)", () => {
    const LAST_USER = "korbat staff never ask for your password or a code, and korbat does not read replies to this email.";
    const LAST_STAFF = "korbat never puts a link in a staff email.";
    const POST_LINK = "http://localhost:8081/post/0190f3a2-7c1e-7b1a-9f00-0123456789ab";
    const ACCOUNT_LINK = "http://localhost:8081/u/ada";
    const received = { ref: "N-ABCDEFGH23", time: "2026-10-04 06:59 UTC", items: `${POST_LINK}, ${ACCOUNT_LINK}`, termsUrl: "http://localhost:8081/terms" };
    const paragraphs = (text: string) => text.trimEnd().split("\n\n");

    test("notice_received to a signed-out notifier: the reference, the time, the links, and the page with the mail token in its fragment", () => {
      const pageUrl = "http://localhost:8081/notice/N-ABCDEFGH23#t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const r = renderTemplate("notice_received", { ...received, pageUrl });
      expect(r.subject).toBe("korbat received your report N-ABCDEFGH23");
      expect(paragraphs(r.text)).toEqual([
        `korbat received your report N-ABCDEFGH23 at 2026-10-04 06:59 UTC. It names: ${POST_LINK}, ${ACCOUNT_LINK}.`,
        "A moderator decides each item that names something on korbat; a link that names nothing is answered automatically. You get one email with every decision, at most once a day.",
        `To see where your report stands, ask for a re-examination of a decision, confirm that you sent it, or stop korbat's emails about reports to this address, open this page: ${pageUrl}`,
        "How korbat handles reports, and what it keeps: http://localhost:8081/terms.",
        LAST_USER,
      ]);
      // The page link stands at the end of its paragraph, so nothing after it can be taken for a part of the token.
      expect(r.text).toMatch(/#t=A{43}$/m);
      expect(r.html).not.toMatch(/<img|<a |href=/);
    });

    test("notice_received to an account: no page link, and where to follow the report in the app", () => {
      const r = renderTemplate("notice_received", received);
      expect(paragraphs(r.text)).toEqual([
        `korbat received your report N-ABCDEFGH23 at 2026-10-04 06:59 UTC. It names: ${POST_LINK}, ${ACCOUNT_LINK}.`,
        "A moderator decides each item that names something on korbat; a link that names nothing is answered automatically. You get one email with every decision, at most once a day.",
        "You can follow it in korbat under Settings, Cases, Your reports.",
        "How korbat handles reports, and what it keeps: http://localhost:8081/terms.",
        LAST_USER,
      ]);
      expect(r.text).not.toMatch(/[/]notice[/]|#t=/);
    });

    test("notice_received carries only what korbat generated, and needs each of its fields", () => {
      expect(() => renderTemplate("notice_received", { ...received, ref: "" })).toThrow(/ref/);
      for (const key of ["ref", "time", "items", "termsUrl"] as const) {
        const { [key]: _left, ...rest } = received;
        expect(() => renderTemplate("notice_received", rest), key).toThrow(new RegExp(key));
      }
      // A report's words have no field to travel in: a member the template does not know is not printed.
      const r = renderTemplate("notice_received", { ...received, explanation: "the notifier's own words", name: "Ada" });
      expect(r.text).not.toMatch(/the notifier's own words|Ada/);
    });

    test("moderation_urgent gives the count and the oldest time, no link and no content, and says it is the only alert", () => {
      const r = renderTemplate("moderation_urgent", { count: "3", oldest: "2026-10-04 06:59 UTC" });
      expect(r.subject).toBe("korbat: a case is waiting in the urgent lane");
      expect(paragraphs(r.text)).toEqual([
        "3 cases in the urgent lane (child sexual abuse or exploitation, direct threats, violence, public security or self-harm) are waiting; the oldest since 2026-10-04 06:59 UTC.",
        "Open the staff console. Until the phone alerts of sub-project 3e, this email is the only alert.",
        LAST_STAFF,
      ]);
      expect(r.text).not.toMatch(/https?:|www[.]|:[/][/]/);
      expect(r.html).not.toMatch(/<img|<a |href=|https?:/);
      // One case reads as one: the only case is the oldest, so the sentence gives its time alone.
      const one = renderTemplate("moderation_urgent", { count: "1", oldest: "2026-10-04 06:59 UTC" });
      expect(one.subject).toBe("korbat: a case is waiting in the urgent lane");
      expect(paragraphs(one.text)).toEqual([
        "1 case in the urgent lane (child sexual abuse or exploitation, direct threats, violence, public security or self-harm) is waiting, since 2026-10-04 06:59 UTC.",
        "Open the staff console. Until the phone alerts of sub-project 3e, this email is the only alert.",
        LAST_STAFF,
      ]);
      for (const count of ["2", "10", "11", "21"]) {
        expect(renderTemplate("moderation_urgent", { count, oldest: "2026-10-04 06:59 UTC" }).text, count).toContain(`${count} cases in the urgent lane (child sexual abuse or exploitation, direct threats, violence, public security or self-harm) are waiting; the oldest since 2026-10-04 06:59 UTC.`);
      }
      expect(() => renderTemplate("moderation_urgent", { count: "3" })).toThrow(/oldest/);
      expect(() => renderTemplate("moderation_urgent", { oldest: "2026-10-04 06:59 UTC" })).toThrow(/count/);
    });

    test("moderation_reads names the staff account and the limit it reached, tells its holder what to do, and carries no link", () => {
      const r = renderTemplate("moderation_reads", { handle: "mod_anna", limit: "400" });
      expect(r.subject).toBe("korbat: a staff account reached its daily case limit");
      expect(paragraphs(r.text)).toEqual([
        "The staff account @mod_anna opened 400 different cases today and cannot open others until midnight UTC.",
        "Every staff account gets this email. If @mod_anna is your account and you did not open them, someone else holds your key: tell the operator at once.",
        "If that was not expected, ask them. The operator raises the limit with staff.js limits.",
        LAST_STAFF,
      ]);
      expect(r.text).not.toMatch(/https?:|www[.]|:[/][/]/);
      expect(r.html).not.toMatch(/<img|<a |href=|https?:/);
      expect(() => renderTemplate("moderation_reads", { handle: "mod_anna" })).toThrow(/limit/);
      expect(() => renderTemplate("moderation_reads", { limit: "400" })).toThrow(/handle/);
    });

    test("moderation_reveal names the staff account, the time, the day's count and the limit, never the case or who was revealed, and carries no link", () => {
      const data = { handle: "mod_anna", time: "2026-10-04 06:59 UTC", count: "3", limit: "10" };
      const r = renderTemplate("moderation_reveal", data);
      expect(r.subject).toBe("korbat: a staff account revealed who sent a report");
      expect(paragraphs(r.text)).toEqual([
        "The staff account @mod_anna revealed who sent a report or notice at 2026-10-04 06:59 UTC. That is 3 of the 10 reveals one staff account may make today (UTC).",
        "Every staff account gets this email. If @mod_anna is your account and you did not reveal it, someone else holds your key: tell the operator at once.",
        "The staff console's home screen lists every reveal of the last 30 days with its case. If this one was not expected, ask them; if their key may be in someone else's hands, the operator revokes it with staff.js revoke.",
        LAST_STAFF,
      ]);
      expect(r.text).not.toMatch(/https?:|www[.]|:[/][/]/);
      expect(r.html).not.toMatch(/<img|<a |href=|https?:/);
      for (const key of Object.keys(data)) {
        const { [key]: _left, ...rest } = data as Record<string, string>;
        expect(() => renderTemplate("moderation_reveal", rest), key).toThrow(new RegExp(key));
      }
      // Only what korbat generated: a name, a case or a reason handed over by mistake appears nowhere.
      const more = renderTemplate("moderation_reveal", { ...data, name: "Ada Lovelace", caseId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", reason: "the reason's own words" });
      expect(more.text).toBe(r.text);
    });
  });

  test("missing template data is a programming error", () => {
    expect(() => renderTemplate("sign_in_code", {})).toThrow(/code/);
    expect(() => renderTemplate("passkey_added", { name: "Phone", deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC" })).toThrow(/removeUrl/);
    expect(() => renderTemplate("passkey_added", { deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl: "http://localhost:8081/passkey-remove/abc" })).toThrow(/name/);
    expect(() => renderTemplate("passkey_removed", { name: "Phone" })).toThrow(/time/);
    expect(() => renderTemplate("passkey_suspect", {})).toThrow(/name/);
  });
  test("the memory mailer records messages and finds the latest code per address", async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "111111" } });
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "222222" } });
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.lastCodeFor("a@b.io")).toBe("222222");
    expect(mailer.lastCodeFor("c@d.io")).toBeUndefined();
  });
});
```

### Replace `apps/api/test/moderation-context.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { ModerationErrorCode } from "@korbat/contracts";
import { ModerationError, isModerationErrorCode, moderationErrorMessage } from "../src/moderation/context";

describe("the moderation module's refusals", () => {
  test("each of the twenty-one codes this module raises answers with the status the design gives it (3c design, section 10)", () => {
    const statuses = {
      notice_link_invalid: 422,
      notice_link_offsite: 422,
      human_check_failed: 403,
      staff_cannot_report: 403,
      notice_not_found: 404,
      already_reported: 409,
      case_changed: 409,
      case_closed: 409,
      staff_recused: 403,
      staff_target: 403,
      admin_required: 403,
      decision_cap: 429,
      profile_changed: 409,
      snapshot_mismatch: 409,
      snapshot_erased: 409,
      text_not_found: 409,
      invalid_decision: 422,
      text_invalid: 422,
      text_quotes_user: 422,
      image_refused: 404,
      reveal_refused: 422,
    } as const;
    // The table above is the whole of the contracts' list, so a code added there fails here until its status is pinned.
    expect(Object.keys(statuses).sort()).toEqual([...ModerationErrorCode.options].sort());
    for (const [code, status] of Object.entries(statuses) as [keyof typeof statuses, number][]) {
      const err = new ModerationError(code);
      expect([err.name, err.code, err.status], code).toEqual(["ModerationError", code, status]);
      expect(err.message, code).toBe(moderationErrorMessage(code));
      expect(err.message.length, code).toBeGreaterThan(10);
      expect(isModerationErrorCode(code), code).toBe(true);
    }
    // What the audit function raises is an answer of the decision, never one of these codes.
    expect(isModerationErrorCode("staff_confirmation_ended")).toBe(false);
    expect(isModerationErrorCode("staff_confirmation_late")).toBe(false);
    // The module's own answers beside them.
    expect([new ModerationError("not_found").status, new ModerationError("invalid_request").status]).toEqual([404, 400]);
    // A session that has not finished onboarding is refused as requireSession refuses it, in the same words.
    expect(new ModerationError("onboarding_required")).toMatchObject({ status: 403, message: "Choose a handle to finish setting up your account." });
    expect([new ModerationError("rate_limited").status, new ModerationError("service_unavailable").status]).toEqual([429, 503]);
  });

  test("the console's refusals say nothing about who reported: a recusal reads the same whoever the conflict concerns, and an image that is not shown gives no reason", () => {
    expect(moderationErrorMessage("staff_recused")).not.toMatch(/report/i);
    expect(moderationErrorMessage("image_refused")).toBe("That image is not shown.");
    expect(moderationErrorMessage("reveal_refused")).not.toMatch(/@|https?:/);
  });

  test("the words of the notice routes are written for the person reporting, and the human check names no address", () => {
    expect(moderationErrorMessage("human_check_failed")).toBe("We could not verify that you are human. Try again.");
    expect(moderationErrorMessage("already_reported")).toBe("You already reported this; it is being looked at.");
    for (const code of ["notice_link_invalid", "notice_link_offsite", "human_check_failed", "staff_cannot_report", "notice_not_found"] as const) {
      expect(moderationErrorMessage(code), code).not.toMatch(/@|https?:/);
    }
  });
});
```

### Replace `apps/api/test/staff/route-table.test.ts` (whole file)

```ts
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  AuditEntry,
  AuditPage,
  CaseDecisionResponse,
  CaseView,
  FindingResponse,
  QueuePage,
  RevealResponse,
  StaffEnrollVerifyResponse,
  StaffKey,
  StaffKeysResponse,
  StaffMe,
  StaffOverview,
  StaffSession,
  StaffSessionsResponse,
  StaffSnapshotTaken,
  StaffTextSaved,
  StaffTextsResponse,
} from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type AuthForStaff } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createSocial, socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const CONSOLE_ORIGIN = "http://console.localhost:8090";

interface RouteEntry {
  method: string;
  path: string;
}

/**
 * The real app with every module and the console on (3a design, section 11). The database pools are created but never
 * connect: only the route table is read. Returns the app and the staff module's own routes, as it would mount them.
 */
function build() {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN: "http://localhost:8081",
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    NOTIFIER_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    CONSOLE_ORIGIN,
  });
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
  const mediaRoot = mkdtempSync(path.join(tmpdir(), "korbat-route-table-"));
  const media = createMedia({
    apiDb,
    uploadsDir: path.join(mediaRoot, "uploads"),
    storeDir: path.join(mediaRoot, "store"),
    formats: config.MEDIA_FORMATS,
    minFreeBytes: 0,
    logger,
    requireSession: auth.requireSession,
    resolveSession: auth.resolveSession,
    rateLimitStore,
    enforceUploadLimit: async () => undefined,
  });
  const account = createAccount({
    auth: auth.forAccount,
    social: social.forAccount,
    media: media.forAccount,
    requireSession: auth.requireSession,
    requireFreshAuth: auth.requireFreshAuth(),
    requireStrongFreshAuth: auth.requireStrongFreshAuth(),
    rateLimitStore,
    logger,
  });
  const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: media.forCases, rateLimitStore, config, logger });
  // The staff module gets the auth module's two guards with a mark on each, so the table can be read for which route
  // stands behind which: the session guard, and the step-up of one action.
  const guards = new Map<unknown, string>();
  const marked = <T>(guard: T, mark: string): T => {
    guards.set(guard, mark);
    return guard;
  };
  // The session guard also counts its runs, so a test can tell a request that reached it from one answered before it.
  const runs = { session: 0 };
  const countedRequireStaff: AuthForStaff["requireStaff"] = async (c, next) => {
    runs.session++;
    return auth.forStaff.requireStaff(c, next);
  };
  const forStaff: AuthForStaff = {
    ...auth.forStaff,
    requireStaff: marked(countedRequireStaff, "session"),
    requireStaffStepUp: (action, target) => marked(auth.forStaff.requireStaffStepUp(action, target), `step-up:${action}`),
  };
  const staff = createStaff({ apiDb, auth: forStaff, moderation: moderation.forStaff });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account, staff, moderation });
  // What the staff module mounts at /api/staff, as createApp mounts it.
  const mounted = staff.routes(CONSOLE_ORIGIN).routes;
  const staffOwn = mounted.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
  // Each staff route with the guards in its chain: Hono lists a route once for every handler it chains.
  const guarded = new Map<string, string[]>();
  for (const r of mounted) {
    const route = `${r.method} /api/staff${r.path}`;
    const mark = guards.get(r.handler);
    guarded.set(route, [...(guarded.get(route) ?? []), ...(mark === undefined ? [] : [mark])]);
  }
  return { app, staffOwn, guarded, runs };
}

const isStaffPath = (p: string) => p === "/api/staff" || p.startsWith("/api/staff/");
const keyOf = (r: RouteEntry) => `${r.method} ${r.path}`;

/** Each method and path once, sorted: Hono lists a route once for every handler it chains. */
const distinct = (routes: RouteEntry[]) => [...new Set(routes.map(keyOf))].sort();

/**
 * A Hono path as a pattern: a parameter matches one segment, and a final wildcard the path itself and anything below it.
 * The app's paths hold only letters, digits, dashes, underscores and dots, so nothing else needs escaping.
 */
function patternOf(routePath: string): RegExp {
  const segments = routePath.split("/").map((segment) => {
    if (segment === "*") return ".*";
    if (segment.startsWith(":")) return "[^/]+";
    if (!/^[A-Za-z0-9_.-]*$/.test(segment)) throw new Error(`a path segment this check cannot read: ${segment}`);
    return segment.replaceAll(".", "[.]");
  });
  const last = segments.length - 1;
  // "/x/*" matches /x itself too, as Hono routes it.
  const body = segments[last] === ".*" ? `${segments.slice(0, last).join("/")}(/.*)?` : segments.join("/");
  return new RegExp(`^${body}$`);
}

/** A lower-case uuid, as a staff path's parameter (a session's handle, a case's id) takes one. */
const SAMPLE_PARAMETER = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

/**
 * Paths under /api/staff a route of another module could answer, built from the staff module's own route table: each of
 * its paths with every parameter filled in, and each path that leads to one (/api/staff/signin for /signin/verify), so a
 * staff route added later is probed too; then the prefix itself, with a final slash, and a path the module does not have.
 * A foreign route that reaches one of them answers there for any method the staff module does not define, behind the gate
 * but with no app session, since createApp skips resolveSession on staff paths.
 */
function staffProbes(staffOwn: RouteEntry[]): string[] {
  const probes = new Set(["/api/staff", "/api/staff/", "/api/staff/x/y"]);
  for (const route of staffOwn) {
    if (!isStaffPath(route.path) || route.path.includes("*")) continue;
    const segments = route.path.split("/").map((segment) => (segment.startsWith(":") ? SAMPLE_PARAMETER : segment));
    for (let end = 3; end <= segments.length; end++) probes.add(segments.slice(0, end).join("/"));
  }
  return [...probes];
}

/**
 * The routes of the app that answer under /api/staff without being the staff module's own: every route not among those
 * the staff module mounts there (as many times as it mounts each) whose path lies under /api/staff or whose pattern
 * reaches a path there (staffProbes). The app's own chain,
 * registered on every path ("ALL /*"), is the one exception: request id, access log, client identity, headers and limits
 * apply to staff paths too (3a design, section 5).
 */
function foreignStaffRoutes(appRoutes: RouteEntry[], staffOwn: RouteEntry[]): string[] {
  const own = new Map<string, number>();
  for (const route of staffOwn) own.set(keyOf(route), (own.get(keyOf(route)) ?? 0) + 1);
  const probes = staffProbes(staffOwn);
  const foreign: string[] = [];
  for (const route of appRoutes) {
    const k = keyOf(route);
    if (k === "ALL /*") continue;
    const left = own.get(k) ?? 0;
    if (left > 0) {
      own.set(k, left - 1);
      continue;
    }
    const pattern = patternOf(route.path);
    if (isStaffPath(route.path) || probes.some((probe) => pattern.test(probe))) foreign.push(k);
  }
  return foreign;
}

/** A route path naming a role, a grant or a promotion: what a route that changes a role would be called. */
const ROLE_PATH = new RegExp("(^|/)(roles?|grants?|grant-role|promote|demote|make-staff|staff-role)(/|$)", "i");

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));
function sources(): { path: string; source: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  return walk(SRC_ROOT).map((full) => ({ path: path.relative(SRC_ROOT, full).split(path.sep).join("/"), source: readFileSync(full, "utf8") }));
}

/**
 * Where an account's role may be changed: the repository's statements (changeRole for grant-role, setRole for the tests)
 * are reached only through grant-role's grantRole, which only the auth index (for the command line) and grant-role's own
 * command name. A route that changed a role would have to name one of them.
 */
const ROLE_WRITERS = /\b(changeRole|setRole|grantRole)\b/;
const ROLE_WRITER_FILES = new Set(["auth/repo.ts", "auth/admin.ts", "auth/index.ts", "cli/grant-role.ts"]);
const roleWriterViolations = (files: { path: string; source: string }[]) => files.filter((f) => !ROLE_WRITER_FILES.has(f.path) && ROLE_WRITERS.test(f.source)).map((f) => f.path);

/** A member of a staff answer that would name a person beyond their public handle: an address, a device, a phone or an account. */
const PERSONAL = /email|^ip|ipHash|address|device|phone|userId|accountId|actorId|userAgent|webauthn/i;

/** What memberNames writes in place of the members of a schema whose kind it cannot read. */
const UNREAD = "a member of a kind this check cannot read";

/**
 * Every member of an answer's schema by its path, through objects, lists, unions and nullable or optional members, so a
 * member inside a case's items or a seal's list is read as one at the top is. A kind of schema this walk does not know
 * is listed as such (UNREAD), and the test below refuses any: whatever such a member holds would otherwise go unread.
 *
 * The walk reads the contracts, not the answers. That an answer holds nothing but what its contract names is held by the
 * HTTP suites, which compare each raw answer with what its schema reads from it (http-staff-cases.test.ts).
 */
function memberNames(schema: unknown, path = ""): string[] {
  const def = (schema as { _zod: { def: Record<string, unknown> } })._zod.def;
  switch (def.type) {
    case "object":
      return Object.entries(def.shape as Record<string, unknown>).flatMap(([key, member]) => {
        const name = path === "" ? key : `${path}.${key}`;
        return [name, ...memberNames(member, name)];
      });
    case "array":
      return memberNames(def.element, path);
    case "union":
      return [...new Set((def.options as unknown[]).flatMap((option) => memberNames(option, path)))];
    case "nullable":
    case "optional":
      return memberNames(def.innerType, path);
    case "string":
    case "number":
    case "boolean":
    case "enum":
    case "literal":
      return [];
    default:
      return [`${path}: ${UNREAD} (${String(def.type)})`];
  }
}

describe("the staff routes in the route table (3a design, section 11)", () => {
  test("are exactly the staff module's: the gate, sign-in, enrolment, the person's own reads, sign-out, step-up, the confirmed revocation, the confirmed decision, and the console's reads and writes on cases", () => {
    const { app } = build();
    expect(distinct(app.routes.filter((r) => isStaffPath(r.path)))).toEqual(
      [
        "ALL /api/staff/*",
        "POST /api/staff/enroll/options",
        "POST /api/staff/enroll/verify",
        "POST /api/staff/signin/options",
        "POST /api/staff/signin/verify",
        "GET /api/staff/me",
        "GET /api/staff/sessions",
        "GET /api/staff/keys",
        "GET /api/staff/audit",
        "POST /api/staff/signout",
        "POST /api/staff/step-up/options",
        "DELETE /api/staff/sessions/:handle",
        "POST /api/staff/cases/:case/decisions",
        "GET /api/staff/overview",
        "GET /api/staff/queue",
        "GET /api/staff/cases/:case",
        "GET /api/staff/cases/:case/media/:media/:size",
        "POST /api/staff/cases/:case/snapshots",
        "POST /api/staff/findings",
        "POST /api/staff/cases/:case/texts",
        "GET /api/staff/cases/:case/texts",
        "POST /api/staff/items/:item/reveal",
      ].sort(),
    );
  });

  test("every staff route that changes something asks for the key, but the named exceptions: enrolment, sign-in, the step-up's own options, sign-out, and saving a text, taking a snapshot and opening a finding", () => {
    const { guarded } = build();
    const changing = [...guarded].filter(([route]) => !route.startsWith("GET ") && !route.startsWith("ALL "));
    const stepUps = Object.fromEntries(changing.flatMap(([route, marks]) => marks.filter((mark) => mark.startsWith("step-up:")).map((mark) => [route, mark.slice("step-up:".length)])));
    // Each confirmed route, with the one action its key confirms.
    expect(stepUps).toEqual({
      "DELETE /api/staff/sessions/:handle": "staff_session_revoked",
      "POST /api/staff/cases/:case/decisions": "case_decided",
      "POST /api/staff/items/:item/reveal": "identity_revealed",
    });
    // The changing routes without a step-up, by method and path: 3a's four kinds, and the three of moderation cases,
    // none of which changes anything a user sees (3c design, section 2, Free text under the step-up).
    const unconfirmed = changing.filter(([route]) => !(route in stepUps)).map(([route]) => route);
    expect(unconfirmed.sort()).toEqual(
      [
        "POST /api/staff/enroll/options",
        "POST /api/staff/enroll/verify",
        "POST /api/staff/signin/options",
        "POST /api/staff/signin/verify",
        "POST /api/staff/step-up/options",
        "POST /api/staff/signout",
        "POST /api/staff/cases/:case/texts",
        "POST /api/staff/cases/:case/snapshots",
        "POST /api/staff/findings",
      ].sort(),
    );
    // Every route stands behind the staff session but enrolment and sign-in, whose credential is the link or the key.
    const open = [...guarded].filter(([route, marks]) => !route.startsWith("ALL ") && !marks.includes("session")).map(([route]) => route);
    expect(open.sort()).toEqual(["POST /api/staff/enroll/options", "POST /api/staff/enroll/verify", "POST /api/staff/signin/options", "POST /api/staff/signin/verify"]);
    // And a step-up always follows the session guard, once.
    for (const [route, marks] of guarded) if (route in stepUps) expect(marks, route).toEqual(["session", `step-up:${stepUps[route]}`]);
  });

  test("no staff route answers HEAD: on every path of the staff module a HEAD from the console's own host is the unknown route, with no body, and no session guard runs for it", async () => {
    const { app, staffOwn, runs } = build();
    const host = new URL(CONSOLE_ORIGIN).host;
    // Every GET route of the module with its parameters filled in: an id, and for the image route a size it takes.
    const fill = (routePath: string) => routePath.split("/").map((segment) => (segment === ":size" ? "small" : segment.startsWith(":") ? SAMPLE_PARAMETER : segment)).join("/");
    const reads = [...new Set(staffOwn.filter((r) => r.method === "GET").map((r) => fill(r.path)))];
    expect(reads).toEqual(expect.arrayContaining(["/api/staff/me", "/api/staff/sessions", "/api/staff/audit", "/api/staff/overview", "/api/staff/queue", `/api/staff/cases/${SAMPLE_PARAMETER}`, `/api/staff/cases/${SAMPLE_PARAMETER}/media/${SAMPLE_PARAMETER}/small`]));
    // Hono would answer a HEAD with the GET route's handlers and drop the body: none of them may run.
    const others = ["/api/staff", "/api/staff/signout", "/api/staff/findings", `/api/staff/cases/${SAMPLE_PARAMETER}/snapshots`, "/api/staff/no/such/path"];
    for (const p of [...reads, ...others]) {
      const res = await app.request(`${CONSOLE_ORIGIN}${p}`, { method: "HEAD", headers: { host } });
      expect(res.status, p).toBe(404);
      expect(await res.text(), p).toBe("");
    }
    expect(runs.session).toBe(0);
    // The same paths with GET do reach the session guard, which refuses a request that carries no staff cookie.
    for (const p of reads) {
      const res = await app.request(`${CONSOLE_ORIGIN}${p}`, { headers: { host } });
      expect(res.status, p).toBe(401);
    }
    expect(runs.session).toBe(reads.length);
    // A HEAD that fails the gate gets the gate's own answer, as every method does: the gate still stands first.
    expect((await app.request(`${CONSOLE_ORIGIN}/api/staff/overview`, { method: "HEAD", headers: { host: "localhost:8081" } })).status).toBe(404);
    expect((await app.request(`${CONSOLE_ORIGIN}/api/staff/overview`, { method: "HEAD", headers: { host, origin: "http://localhost:8081" } })).status).toBe(403);
    expect((await app.request(`${CONSOLE_ORIGIN}/api/staff/overview`, { method: "HEAD", headers: { host, "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect(runs.session).toBe(reads.length);
  });

  test("hold no route of another module under /api/staff", () => {
    const { app, staffOwn } = build();
    expect(staffOwn.length).toBeGreaterThan(0);
    // Every staff path is probed, the ones the old fixed list left out among them.
    const probes = staffProbes(staffOwn);
    for (const p of [
      "/api/staff/audit",
      "/api/staff/keys",
      "/api/staff/signout",
      "/api/staff/signin/options",
      "/api/staff/signin/verify",
      "/api/staff/enroll/options",
      "/api/staff/enroll/verify",
      `/api/staff/sessions/${SAMPLE_PARAMETER}`,
      "/api/staff/cases",
      `/api/staff/cases/${SAMPLE_PARAMETER}`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/decisions`,
      "/api/staff/overview",
      "/api/staff/queue",
      "/api/staff/findings",
      `/api/staff/cases/${SAMPLE_PARAMETER}/texts`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/snapshots`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/media`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/media/${SAMPLE_PARAMETER}`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/media/${SAMPLE_PARAMETER}/${SAMPLE_PARAMETER}`,
      "/api/staff/items",
      `/api/staff/items/${SAMPLE_PARAMETER}/reveal`,
    ]) {
      expect(probes, p).toContain(p);
    }
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual([]);
  });

  test("the check catches another module's route under /api/staff, a pattern that reaches it, and a second copy of a staff route", () => {
    const staffSub = new Hono();
    staffSub.use("*", async (_c, next) => next());
    staffSub.get("/me", (c) => c.text("staff"));
    staffSub.get("/audit", (c) => c.text("staff"));
    staffSub.get("/keys", (c) => c.text("staff"));
    staffSub.post("/signout", (c) => c.text("staff"));
    staffSub.post("/signin/verify", (c) => c.text("staff"));
    staffSub.post("/enroll/options", (c) => c.text("staff"));
    staffSub.delete("/sessions/:handle", (c) => c.text("staff"));
    const app = new Hono();
    app.use(async (_c, next) => next());
    app.route("/api/staff", staffSub);
    // As the social module is mounted at /api: a route of its own under /api/staff, ones whose parameter reaches a staff
    // path (with a method the staff module does not answer there, which would fall through to it), and a copy of a staff
    // route.
    const other = new Hono();
    other.get("/staff/extra", (c) => c.text("other"));
    other.get("/:section/me", (c) => c.text("other"));
    other.post("/:section/audit", (c) => c.text("other"));
    other.put("/:section/keys", (c) => c.text("other"));
    other.get("/:section/signout", (c) => c.text("other"));
    other.get("/:section/signin/verify", (c) => c.text("other"));
    other.get("/:section/enroll/:step", (c) => c.text("other"));
    other.get("/:section/sessions/:id", (c) => c.text("other"));
    other.get("/staff/me", (c) => c.text("other"));
    other.get("/profiles/:handle", (c) => c.text("other"));
    other.get("/:section/feed", (c) => c.text("other"));
    app.route("/api", other);
    const staffOwn = staffSub.routes.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual([
      "GET /api/staff/extra",
      "GET /api/:section/me",
      "POST /api/:section/audit",
      "PUT /api/:section/keys",
      "GET /api/:section/signout",
      "GET /api/:section/signin/verify",
      "GET /api/:section/enroll/:step",
      "GET /api/:section/sessions/:id",
      "GET /api/staff/me",
    ]);
  });

  test("no route changes a role: no path names one, and only grant-role's command line reaches the statements that do", () => {
    const { app } = build();
    expect(app.routes.filter((r) => ROLE_PATH.test(r.path)).map(keyOf)).toEqual([]);
    expect(roleWriterViolations(sources())).toEqual([]);
    // The rules catch a deliberate violation.
    expect(ROLE_PATH.test("/api/staff/users/:id/role")).toBe(true);
    expect(ROLE_PATH.test("/api/admin/grant")).toBe(true);
    expect(ROLE_PATH.test("/api/profiles/:handle")).toBe(false);
    expect(
      roleWriterViolations([
        { path: "staff/routes.ts", source: "routes.post('/x', (c) => auth.grantRole(email, 'admin'))" },
        { path: "auth/flows/x.ts", source: "await deps.repo.setRole(userId, 'admin');" },
        { path: "cli/grant-role.ts", source: "await grantRole(deps, email, role);" },
      ]),
    ).toEqual(["staff/routes.ts", "auth/flows/x.ts"]);
  });

  test("no route acts as another user or reads another user's sessions, email, IP, device or phone: no staff path names an account, and no staff answer has a member that would", () => {
    const { app } = build();
    // The path parameters under /api/staff are a staff session's handle, which the revocation takes only from the
    // person's own sessions (the step-up suites show another account's is not found), a case's id, an image's id with its
    // size, and an item's id: a case, an image of its post and an item of a notice, never an account.
    const parameters = distinct(app.routes.filter((r) => isStaffPath(r.path) && r.path.includes(":")));
    expect(parameters).toEqual([
      "DELETE /api/staff/sessions/:handle",
      "GET /api/staff/cases/:case",
      "GET /api/staff/cases/:case/media/:media/:size",
      "GET /api/staff/cases/:case/texts",
      "POST /api/staff/cases/:case/decisions",
      "POST /api/staff/cases/:case/snapshots",
      "POST /api/staff/cases/:case/texts",
      "POST /api/staff/items/:item/reveal",
    ]);
    const answers = {
      StaffMe,
      StaffSession,
      StaffKey,
      AuditEntry,
      StaffSessionsResponse,
      StaffKeysResponse,
      AuditPage,
      StaffEnrollVerifyResponse,
      CaseDecisionResponse,
      StaffOverview,
      QueuePage,
      CaseView,
      StaffTextSaved,
      StaffTextsResponse,
      StaffSnapshotTaken,
      FindingResponse,
      RevealResponse,
    };
    const members = Object.entries(answers).flatMap(([name, schema]) => memberNames(schema).map((member) => `${name}.${member}`));
    // The walk read every member of every answer: none is of a kind it has not been taught, behind which a name could hide.
    expect(members.filter((member) => member.includes(UNREAD))).toEqual([]);
    expect(members.filter((member) => PERSONAL.test(member.split(".").at(-1)!))).toEqual([]);
    // Both checks catch a deliberate violation: a member of an unread kind is listed as one, at the top or inside a list,
    // and a personal member inside one is then not seen, which is why none may be left.
    const unread = memberNames(z.object({ when: z.date(), rows: z.array(z.object({ byId: z.record(z.string(), z.object({ email: z.string() })) })) }));
    expect(unread).toEqual(["when", `when: ${UNREAD} (date)`, "rows", "rows.byId", `rows.byId: ${UNREAD} (record)`]);
    expect(unread.filter((member) => member.includes(UNREAD))).toHaveLength(2);
    expect(unread.filter((member) => PERSONAL.test(member.split(".").at(-1)!))).toEqual([]);
    // The walk reaches the members inside lists, unions and nullable members: a source's summary, a seal's list, a snapshot.
    expect(members).toContain("CaseView.items.source.contactLost");
    expect(members).toContain("CaseView.decisions.actions.sealed.list.postId");
    expect(members).toContain("CaseView.snapshots.authorHandle");
    expect(members).toContain("CaseView.target.displayName");
    expect(members).toContain("StaffOverview.reveals.items.handle");
    // People are handles and a source is a summary: no answer has a member for a reporter, a notifier or a contact.
    expect(members.filter((member) => /[.](reporter|notifier|contact)(Id)?$/i.test(member))).toEqual([]);
    expect(memberNames(z.object({ list: z.array(z.object({ inner: z.object({ email: z.string() }).nullable() })) }))).toEqual(["list", "list.inner", "list.inner.email"]);
    // The browser's coarse label and the actor's public handle are what the console shows of a session and a row.
    expect(members).toContain("StaffSession.browser");
    expect(members).toContain("AuditEntry.actorHandle");
    expect(PERSONAL.test("email")).toBe(true);
    expect(PERSONAL.test("ipHash")).toBe(true);
    expect(PERSONAL.test("deviceId")).toBe(true);
  });
});
```

### Replace `packages/contracts/test/moderation.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  ACTION_KINDS,
  APPEAL_MONTHS,
  CSAM_KEYWORDS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  DECISION_KEYWORDS,
  MEASURES,
  ModerationErrorCode,
  NOTICE_LIMITS,
  RETENTION,
  REVEAL_REASON_CATEGORIES,
  RULE_DEFAULT_CATEGORY,
  RULE_IDS,
  SEAL_LIST_MAX,
  SNAPSHOT_DIGEST_TAG,
  SUSPECT_EARLIER_MONTHS,
  TDB_CATEGORIES,
  TDB_FORM_CATEGORIES,
  TEXT_DIGEST_TAG,
  appealDeadline,
  compareDecisionActions,
  laneFor,
  snapshotDigest,
  snapshotText,
  textDigest,
  type ActionKind,
  type DecisionActionParams,
  type SnapshotDigestInput,
  type TdbCategory,
} from "../src/index";
import { TEXT_DIGEST_VECTORS } from "./digest-vectors";

const LF = String.fromCharCode(10);
const GRINNING = String.fromCodePoint(0x1f600);
const E_ACUTE = String.fromCharCode(0xe9);

describe("the Transparency Database's values", () => {
  test("there are 16 categories, as the database was read on 2026-10-02", () => {
    expect(TDB_CATEGORIES).toEqual([
      "STATEMENT_CATEGORY_ANIMAL_WELFARE",
      "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
      "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
      "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
      "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
      "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
      "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
      "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
      "STATEMENT_CATEGORY_SELF_HARM",
      "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
      "STATEMENT_CATEGORY_VIOLENCE",
    ]);
    expect(new Set(TDB_CATEGORIES).size).toBe(16);
  });

  test("the illegal-ground form shows 14 of them: not the terms-and-conditions category, and not 'not specified'", () => {
    expect(TDB_FORM_CATEGORIES).toHaveLength(14);
    expect(TDB_FORM_CATEGORIES).toEqual(TDB_CATEGORIES.filter((c) => c !== "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" && c !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"));
  });

  test("the CSAM path's four choices map to the three keywords, and 'abuse' to none", () => {
    expect(CSAM_KEYWORDS).toEqual({
      csam: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
      deepfake: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE",
      grooming: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS",
      abuse: null,
    });
    expect(Object.keys(CSAM_KEYWORDS)).toEqual(["csam", "deepfake", "grooming", "abuse"]);
  });

  test("a decision on the law may carry one keyword: terrorist content", () => {
    expect(DECISION_KEYWORDS).toEqual(["KEYWORD_TERRORIST_CONTENT"]);
  });

  test("each rule has its default category", () => {
    expect(RULE_IDS).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
    expect(RULE_DEFAULT_CATEGORY).toEqual({
      R1: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
      R2: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      R3: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      R4: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      R5: "STATEMENT_CATEGORY_VIOLENCE",
      R6: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
    });
    for (const category of Object.values(RULE_DEFAULT_CATEGORY)) expect(TDB_CATEGORIES).toContain(category);
  });
});

describe("laneFor", () => {
  const TC: TdbCategory = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC";

  test("a rule report takes its rule's lane: R2 and R5 are urgent, R3 and R4 next, R1 and R6 last", () => {
    const lanes = RULE_IDS.map((ruleId) => laneFor({ ruleId, allegesIllegal: false, csam: false, category: TC }));
    expect(lanes).toEqual([2, 0, 1, 1, 0, 2]);
  });

  test("the CSAM path is lane 0 whatever else the intake says", () => {
    expect(laneFor({ ruleId: null, allegesIllegal: true, csam: true, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS" })).toBe(0);
    expect(laneFor({ ruleId: null, allegesIllegal: false, csam: true, category: TC })).toBe(0);
  });

  test("a notice of illegality takes its category's lane, for every category", () => {
    const urgent = ["STATEMENT_CATEGORY_VIOLENCE", "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY", "STATEMENT_CATEGORY_SELF_HARM"];
    const next = [
      "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
      "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
    ];
    for (const category of TDB_CATEGORIES) {
      const expected = urgent.includes(category) ? 0 : next.includes(category) ? 1 : 2;
      expect(laneFor({ ruleId: null, allegesIllegal: true, csam: false, category }), category).toBe(expected);
    }
  });

  test("a notice of illegality that also cites a rule takes the more severe of the two lanes", () => {
    // Fraud (lane 2) under R5 (lane 0), and violence (lane 0) under R1 (lane 2): both are urgent.
    expect(laneFor({ ruleId: "R5", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" })).toBe(0);
    expect(laneFor({ ruleId: "R1", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_VIOLENCE" })).toBe(0);
    expect(laneFor({ ruleId: "R3", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" })).toBe(1);
    expect(laneFor({ ruleId: "R6", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_ANIMAL_WELFARE" })).toBe(2);
  });

  test("where nothing is alleged to be illegal, the category is korbat's own classification and moves no lane", () => {
    for (const category of TDB_CATEGORIES) {
      expect(laneFor({ ruleId: "R1", allegesIllegal: false, csam: false, category }), category).toBe(2);
      expect(laneFor({ ruleId: "R3", allegesIllegal: false, csam: false, category }), category).toBe(1);
    }
  });
});

describe("limits and periods", () => {
  test("the notice limits: per network signed out, per account signed in, ten targets, and the two text bounds", () => {
    expect(NOTICE_LIMITS).toEqual({ signedOut: { perHour: 5, perDay: 20 }, signedIn: { perHour: 10, perDay: 50 }, maxTargets: 10, explanationMax: 2000, citedLawMax: 300 });
  });

  test("a notice on the CSAM path names at most one account; a seal's list shows 500 rows; earlier answers count for 12 months", () => {
    expect(CSAM_NOTICE_MAX_ACCOUNTS).toBe(1);
    expect(SEAL_LIST_MAX).toBe(500);
    expect(SUSPECT_EARLIER_MONTHS).toBe(12);
  });

  test("six months to appeal or to ask for a re-examination, five of each a day", () => {
    expect(APPEAL_MONTHS).toBe(6);
    expect(DAILY_LIMITS).toEqual({ appeals: 5, reexaminations: 5 });
  });

  test("the retention periods of the design's table", () => {
    expect(RETENTION).toEqual({
      r4FinalMonths: 6,
      intakeDays: 30,
      resetValueDays: 30,
      evidenceHours: 24,
      statementMonths: 12,
      accessLogMonths: 12,
      contactMonths: 6,
      contactMaxMonths: 13,
      confirmationDays: 30,
      backupDays: 30,
      draftHours: 24,
      mailGiveUpDays: 5,
    });
    // Content restricted under R4 goes when its restriction is final: the appeal's window.
    expect(RETENTION.r4FinalMonths).toBe(APPEAL_MONTHS);
  });
});

describe("the measures", () => {
  const kinds = Object.keys(MEASURES) as ActionKind[];
  const measures = kinds.filter((kind) => MEASURES[kind].lifts === null);
  const reversals = kinds.filter((kind) => MEASURES[kind].lifts !== null);

  test("every action kind has an entry: the seven measures, then the five reversals", () => {
    expect(kinds).toEqual([
      "withhold",
      "remove",
      "seal_media",
      "withhold_media",
      "remove_media",
      "reset_display_name",
      "reset_bio",
      "restore",
      "unseal_media",
      "restore_media",
      "restore_display_name",
      "restore_bio",
    ]);
    expect(ACTION_KINDS).toEqual(kinds);
    expect(measures).toEqual(kinds.slice(0, 7));
    expect(reversals).toEqual(kinds.slice(7));
  });

  test("a post or one image is withheld only while deciding and removed only when the case is decided; a seal and a reset are either", () => {
    const when = (kind: ActionKind) => [MEASURES[kind].interim, MEASURES[kind].final];
    expect(when("withhold")).toEqual([true, false]);
    expect(when("withhold_media")).toEqual([true, false]);
    expect(when("remove")).toEqual([false, true]);
    expect(when("remove_media")).toEqual([false, true]);
    for (const kind of ["seal_media", "reset_display_name", "reset_bio"] as const) expect(when(kind), kind).toEqual([true, true]);
    // A reversal is neither: which decision may hold one is the reversed measure's matter.
    for (const kind of reversals) expect(when(kind), kind).toEqual([false, false]);
  });

  test("each measure has its target, and each reversal lifts the measures of its own target", () => {
    expect(Object.fromEntries(kinds.map((kind) => [kind, MEASURES[kind].target]))).toEqual({
      withhold: "post",
      remove: "post",
      seal_media: "images",
      withhold_media: "image",
      remove_media: "image",
      reset_display_name: "display_name",
      reset_bio: "bio",
      restore: "post",
      unseal_media: "images",
      restore_media: "image",
      restore_display_name: "display_name",
      restore_bio: "bio",
    });
    expect(Object.fromEntries(reversals.map((kind) => [kind, MEASURES[kind].lifts]))).toEqual({
      restore: ["withhold", "remove"],
      unseal_media: ["seal_media"],
      restore_media: ["withhold_media", "remove_media"],
      restore_display_name: ["reset_display_name"],
      restore_bio: ["reset_bio"],
    });
    // Every measure can be lifted, by exactly one kind of reversal.
    for (const measure of measures) expect(reversals.filter((kind) => (MEASURES[kind].lifts as readonly ActionKind[]).includes(measure)), measure).toHaveLength(1);
  });

  test("each has a label of its own: the composer's words where the composer names the measure", () => {
    // The first seven and "Lift the seal" are the words of the decision composer; the composer, the statement and the
    // terms all take them from here.
    expect(Object.fromEntries(kinds.map((kind) => [kind, MEASURES[kind].label]))).toEqual({
      withhold: "Withhold the post",
      remove: "Remove",
      seal_media: "Seal the images this case reaches",
      withhold_media: "Withhold one image",
      remove_media: "Remove one image",
      reset_display_name: "Reset display name",
      reset_bio: "Reset bio",
      restore: "Lift the restriction of the post",
      unseal_media: "Lift the seal",
      restore_media: "Lift the restriction of one image",
      restore_display_name: "Lift the reset of the display name",
      restore_bio: "Lift the reset of the bio",
    });
    const labels = kinds.map((kind) => MEASURES[kind].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("the order of a decision's actions", () => {
  const a = "1a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
  const b = "2a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

  test("by kind as a string, then by image as a string, an action without an image first", () => {
    const sorted: DecisionActionParams[] = [
      { kind: "remove", mediaId: null },
      { kind: "remove_media", mediaId: a },
      { kind: "remove_media", mediaId: b },
      { kind: "reset_bio", mediaId: null },
      { kind: "seal_media", mediaId: null },
      { kind: "withhold_media", mediaId: a },
    ];
    for (const shuffled of [[...sorted].reverse(), [sorted[3]!, sorted[0]!, sorted[5]!, sorted[2]!, sorted[1]!, sorted[4]!]]) {
      expect([...shuffled].sort(compareDecisionActions)).toEqual(sorted);
    }
    expect(compareDecisionActions(sorted[1]!, sorted[1]!)).toBe(0);
    expect(compareDecisionActions({ kind: "restore_media", mediaId: null }, { kind: "restore_media", mediaId: a })).toBeLessThan(0);
  });
});

describe("the reasons for revealing a source", () => {
  test("are the four categories the reveal dialog offers", () => {
    expect(REVEAL_REASON_CATEGORIES).toEqual(["impersonation_claim", "abuse_of_reporting", "legal_requirement", "other"]);
  });
});

describe("moderation error codes", () => {
  test("are the codes the notice routes, the intake, the decision and the console's case routes raise", () => {
    expect(ModerationErrorCode.options).toEqual([
      "notice_link_invalid",
      "notice_link_offsite",
      "human_check_failed",
      "staff_cannot_report",
      "notice_not_found",
      "already_reported",
      "case_changed",
      "case_closed",
      "staff_recused",
      "staff_target",
      "admin_required",
      "decision_cap",
      "profile_changed",
      "snapshot_mismatch",
      "snapshot_erased",
      "text_not_found",
      "invalid_decision",
      "text_invalid",
      "text_quotes_user",
      "image_refused",
      "reveal_refused",
    ]);
    // The codes the database keeps to itself are no route's answer.
    for (const code of ["moderation_column", "quote_item_missing", "read_committed_only", "staff_confirmation_ended", "staff_confirmation_late"]) {
      expect(ModerationErrorCode.safeParse(code).success, code).toBe(false);
    }
  });
});

describe("textDigest", () => {
  test("the tag names the version of the rule", () => {
    expect(TEXT_DIGEST_TAG).toBe("korbat.text.v1");
  });

  test.each(TEXT_DIGEST_VECTORS.map((vector) => [vector.name, vector] as const))("%s: the sha256 of the tag, a line feed, the salt's bytes and the text's UTF-8 bytes", async (_name, vector) => {
    expect(await textDigest(vector.salt, vector.text)).toBe(vector.digest);
  });

  test("the longest vector is 5000 UTF-16 units, and the vectors hold a line feed, a character outside ASCII and one outside the basic plane", () => {
    expect(Math.max(...TEXT_DIGEST_VECTORS.map((vector) => vector.text.length))).toBe(5000);
    const all = TEXT_DIGEST_VECTORS.map((vector) => vector.text).join("");
    expect(all).toContain(LF);
    expect(all).toContain(E_ACUTE);
    expect(all).toContain(GRINNING);
  });

  test("another salt or another text gives another digest", async () => {
    const digests = await Promise.all([textDigest("a1".repeat(32), "one"), textDigest("a2".repeat(32), "one"), textDigest("a1".repeat(32), "one "), textDigest("a1".repeat(32), "One")]);
    expect(new Set(digests).size).toBe(4);
  });

  test("a salt that is not 32 bytes of lower-case hex is refused, never padded or folded", async () => {
    for (const salt of ["", "a1".repeat(31), "a1".repeat(33), "A1".repeat(32), "g1".repeat(32), ` ${"a1".repeat(32)}`]) {
      await expect(textDigest(salt, "text"), JSON.stringify(salt)).rejects.toThrow(TypeError);
    }
  });

  test("a text with a lone surrogate, which has no UTF-8 bytes, is refused rather than hashed as something else", async () => {
    const high = String.fromCharCode(0xd83d);
    const low = String.fromCharCode(0xde00);
    for (const text of [high, low, `a${high}b`, `${low}${high}`]) await expect(textDigest("a1".repeat(32), text)).rejects.toThrow(TypeError);
    // The pair itself is a character.
    await expect(textDigest("a1".repeat(32), `${high}${low}`)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("snapshotText and snapshotDigest", () => {
  const post: SnapshotDigestInput = {
    salt: "ab".repeat(32),
    targetType: "post",
    targetId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
    takenAt: "2026-10-03T10:00:00.123Z",
    authorHandle: "ada",
    postState: "visible",
    postCreatedAt: "2026-10-01T08:30:00.000Z",
    replyToId: null,
    quoteOfId: "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36",
    body: `Line one${LF}caf${E_ACUTE} ${GRINNING}`,
    media: [
      { id: "11111111-2222-4333-8444-555555555555", alt: "A cat", width: 1200, height: 800 },
      { id: "66666666-7777-4888-9999-aaaaaaaaaaaa", alt: null, width: 640, height: 480 },
    ],
    displayName: null,
    bio: null,
    handle: null,
  };
  const account: SnapshotDigestInput = {
    salt: "cd".repeat(32),
    targetType: "account",
    targetId: "8a3c7f0e-1111-4222-8333-944445555666",
    takenAt: "2026-10-03T10:00:00.000Z",
    authorHandle: "bob",
    postState: null,
    postCreatedAt: null,
    replyToId: null,
    quoteOfId: null,
    body: null,
    media: null,
    displayName: `Bob ${GRINNING}`,
    bio: "",
    handle: "bob",
  };
  const BS = String.fromCharCode(92);
  // The texts and the digests below were computed with Python's json and hashlib when they were written.
  const POST_TEXT =
    `{"authorHandle":"ada","bio":null,"body":"Line one${BS}ncaf${E_ACUTE} ${GRINNING}","displayName":null,"handle":null,` +
    `"media":[{"alt":"A cat","height":800,"id":"11111111-2222-4333-8444-555555555555","width":1200},{"alt":null,"height":480,"id":"66666666-7777-4888-9999-aaaaaaaaaaaa","width":640}],` +
    `"postCreatedAt":"2026-10-01T08:30:00.000Z","postState":"visible","quoteOfId":"7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36","replyToId":null,` +
    `"salt":"${"ab".repeat(32)}","takenAt":"2026-10-03T10:00:00.123Z","targetId":"3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a","targetType":"post","v":1}`;
  const POST_DIGEST = "cb995d11ed14e3c4e555c187d319a86506b263e98f924f59f2f7d5231a3bc6e6";
  const ACCOUNT_DIGEST = "41019b2a47d4ebad37cc8c5ad25f8d79a7232c4e3e705231f9e9ba1e02fb1f26";

  test("the tag names the version of the rule", () => {
    expect(SNAPSHOT_DIGEST_TAG).toBe("korbat.snapshot.v1");
  });

  test("the text is the sorted JSON of version 1 and the snapshot's fifteen members", () => {
    expect(snapshotText(post)).toBe(POST_TEXT);
    const parsed = JSON.parse(snapshotText(account)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["authorHandle", "bio", "body", "displayName", "handle", "media", "postCreatedAt", "postState", "quoteOfId", "replyToId", "salt", "takenAt", "targetId", "targetType", "v"]);
    expect(parsed).toEqual({ v: 1, ...account });
  });

  test("the digest is the sha256 of the tag, a line feed and that text", async () => {
    expect(await snapshotDigest(post)).toBe(POST_DIGEST);
    expect(await snapshotDigest(account)).toBe(ACCOUNT_DIGEST);
  });

  test("it round-trips the snapshot answer's JSON, whatever order and whatever else the answer carries", async () => {
    // As the console receives it: parsed from JSON, with members the digest does not cover, in another order.
    const sent = {
      id: "9d0f5e3c-0000-4000-8000-000000000001",
      digest: POST_DIGEST,
      withheld: false,
      erasedAt: null,
      ...Object.fromEntries(Object.entries(post).reverse()),
      media: post.media!.map((image) => ({ height: image.height, width: image.width, note: "never part of a snapshot", alt: image.alt, id: image.id })),
    };
    const answer = JSON.parse(JSON.stringify(sent)) as SnapshotDigestInput;
    expect(snapshotText(answer)).toBe(POST_TEXT);
    expect(await snapshotDigest(answer)).toBe(POST_DIGEST);
  });

  test("any member that changes gives another digest", async () => {
    const changed: SnapshotDigestInput[] = [
      { ...post, salt: "ac".repeat(32) },
      { ...post, takenAt: "2026-10-03T10:00:00.124Z" },
      { ...post, body: `${post.body} ` },
      { ...post, postState: "withheld" },
      { ...post, quoteOfId: null },
      { ...post, media: [post.media![1]!, post.media![0]!] },
      { ...post, media: [{ ...post.media![0]!, alt: "A dog" }, post.media![1]!] },
      { ...post, authorHandle: "adb" },
    ];
    const digests = await Promise.all([post, ...changed].map(snapshotDigest));
    expect(new Set(digests).size).toBe(changed.length + 1);
  });

  test("a time that is not the UTC string toISOString writes, to the millisecond, is refused", () => {
    for (const takenAt of ["2026-10-03T10:00:00Z", "2026-10-03T10:00:00.123456Z", "2026-10-03T12:00:00.123+02:00", "2026-10-03 10:00:00.123Z", ""]) {
      expect(() => snapshotText({ ...post, takenAt }), takenAt).toThrow(TypeError);
    }
    expect(() => snapshotText({ ...post, postCreatedAt: "2026-10-01T08:30:00Z" })).toThrow(TypeError);
    expect(snapshotText({ ...post, takenAt: new Date(Date.UTC(2026, 9, 3, 10, 0, 0, 123)).toISOString() })).toBe(POST_TEXT);
  });
});

describe("appealDeadline", () => {
  const at = (iso: string) => new Date(iso);
  const deadline = (iso: string) => appealDeadline(at(iso)).toISOString();

  test("six calendar months later, at the same UTC time", () => {
    expect(deadline("2026-10-03T10:15:30.250Z")).toBe("2027-04-03T10:15:30.250Z");
    expect(deadline("2026-01-15T00:00:00.000Z")).toBe("2026-07-15T00:00:00.000Z");
    expect(deadline("2026-07-01T23:59:59.999Z")).toBe("2027-01-01T23:59:59.999Z");
  });

  test("a day the sixth month lacks becomes that month's last day", () => {
    // 31 August plus six months is the end of February: the 28th, or the 29th in a leap year.
    expect(deadline("2026-08-31T12:00:00.000Z")).toBe("2027-02-28T12:00:00.000Z");
    expect(deadline("2027-08-31T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2027-08-30T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2027-08-29T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2026-03-31T08:00:00.000Z")).toBe("2026-09-30T08:00:00.000Z");
    expect(deadline("2026-05-31T08:00:00.000Z")).toBe("2026-11-30T08:00:00.000Z");
    expect(deadline("2026-10-31T08:00:00.000Z")).toBe("2027-04-30T08:00:00.000Z");
    expect(deadline("2026-12-31T08:00:00.000Z")).toBe("2027-06-30T08:00:00.000Z");
    // A leap day itself moves to 29 August: August has the day.
    expect(deadline("2028-02-29T08:00:00.000Z")).toBe("2028-08-29T08:00:00.000Z");
  });

  test("it is computed in UTC: the last instants of a UTC month stay on that month's side", () => {
    expect(deadline("2026-08-31T23:59:59.999Z")).toBe("2027-02-28T23:59:59.999Z");
    expect(deadline("2026-09-01T00:00:00.000Z")).toBe("2027-03-01T00:00:00.000Z");
  });

  test("it leaves its argument as it was", () => {
    const informed = at("2026-08-31T12:00:00.000Z");
    appealDeadline(informed);
    expect(informed.toISOString()).toBe("2026-08-31T12:00:00.000Z");
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
packages/rules test:       Tests  18 passed (18)
packages/db test:       Tests  60 passed (60)
packages/contracts test:  ❯ test/moderation.test.ts (42 tests | 1 failed) 57ms
packages/contracts test:  Test Files  2 failed | 10 passed (12)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/05-console-queue-case.md 3
```

Expected: 32 lines starting with `wrote`, one for each file below.

### Create `apps/admin/src/frames.tsx`

```tsx
import { useState } from "react";
import { mentionedAddresses, showHidden } from "./hidden";
import { UserText } from "./ui";

/**
 * Text from others (3c design, section 8). Every string a reporter, a notifier, an appellant or an author wrote is drawn
 * inside a frame that says who wrote it, never in a place where the console speaks for itself: a text made to look like
 * one of the console's own lines is then plainly someone's words. Each frame can show its hidden characters, and lists
 * the hosts of the web addresses the text mentions, as text, and says so for each address whose host it cannot read: the
 * console opens no address and links nowhere.
 */
export interface FrameViewProps {
  /** Who wrote it, in the console's own words: "Written by the author". */
  by: string;
  text: string;
  /** Set for a text that opens collapsed: the words of the button that shows it. */
  collapsedLabel?: string;
  open: boolean;
  hiddenShown: boolean;
  onOpen(): void;
  onToggleHidden(): void;
}

/** The console's words for an address in a text whose host it cannot read. */
const UNREAD_ADDRESS = "an address this console cannot read";

export function FrameView({ by, text, collapsedLabel, open, hiddenShown, onOpen, onToggleHidden }: FrameViewProps) {
  const { hosts, unread } = mentionedAddresses(text);
  // One mention for each address that could not be read, after the hosts that could; the first opens the line when
  // there is no host to list.
  const unreadWords = Array.from({ length: unread }, (_, index) => (index === 0 && hosts.length === 0 ? `Mentions ${UNREAD_ADDRESS}` : ` and ${UNREAD_ADDRESS}`)).join("");
  const collapsed = collapsedLabel !== undefined && !open;
  return (
    <div className="frame">
      <p className="frame-label">{by}</p>
      {collapsed ? (
        <button type="button" onClick={onOpen}>
          {collapsedLabel}
        </button>
      ) : (
        <>
          <p className="frame-text">
            <UserText>{hiddenShown ? showHidden(text) : text}</UserText>
          </p>
          {hosts.length > 0 || unread > 0 ? (
            <p className="hint">
              {hosts.length > 0 ? (
                <>
                  Mentions addresses at: <UserText>{hosts.join(", ")}</UserText>
                </>
              ) : null}
              {unreadWords}
            </p>
          ) : null}
          <button type="button" className="quiet-button" onClick={onToggleHidden} aria-pressed={hiddenShown}>
            {hiddenShown ? "Show the text as written" : "Show hidden characters"}
          </button>
        </>
      )}
    </div>
  );
}

/** A frame with its own two switches: shown or collapsed, and the hidden-characters view. */
export function Frame({ by, text, collapsedLabel }: { by: string; text: string; collapsedLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [hiddenShown, setHiddenShown] = useState(false);
  return <FrameView by={by} text={text} collapsedLabel={collapsedLabel} open={open} hiddenShown={hiddenShown} onOpen={() => setOpen(true)} onToggleHidden={() => setHiddenShown((shown) => !shown)} />;
}
```

### Create `apps/admin/src/hidden.ts`

```ts
/**
 * What a text holds that the eye does not see (3c design, section 8, Text from others): the hidden-characters view of a
 * frame, and the hosts of the web addresses a text mentions. Both are pure, and both answer text: nothing here is ever a
 * link, and no address is ever opened.
 */

/** A character's code point as the view writes it: [U+202E]. */
const codePoint = (character: string): string => `[U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`;

/**
 * The text with every character outside printable ASCII drawn as its code point: a direction override, a zero-width
 * character or a letter of another script that looks like a Latin one then shows for what it is. A line feed stays a
 * line break, after its code point, so the text keeps its lines.
 */
export function showHidden(text: string): string {
  let shown = "";
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) shown += character;
    else if (code === 0x0a) shown += `${codePoint(character)}\n`;
    else shown += codePoint(character);
  }
  return shown;
}

/** Whether a text holds a character the hidden-characters view would draw differently. */
export function hasHidden(text: string): boolean {
  return showHidden(text) !== text;
}

/**
 * The web addresses a text mentions: what follows http:// or https://, or begins with www., up to the first slash,
 * question mark or hash. `hosts` are the hosts the console could read, each once, in the order they appear; a name and
 * password before an at sign are left out, so an address made to look like another host's shows the host it really
 * names. `unread` counts the addresses whose host cannot be read at all, one made unreadable on purpose among them (a
 * direction override where the host ends): the frame says that they are there, since an address left out of the list
 * would look like no address.
 */
export function mentionedAddresses(text: string): { hosts: string[]; unread: number } {
  const hosts: string[] = [];
  let unread = 0;
  for (const match of text.matchAll(/(?:https?:\/\/|\bwww\.)[^\s<>"'`]+/gi)) {
    const address = /^https?:\/\//i.test(match[0]) ? match[0] : `http://${match[0]}`;
    let host = "";
    try {
      host = new URL(address).host;
    } catch {
      // No host can be read from it: counted below.
    }
    if (host === "") unread += 1;
    else if (!hosts.includes(host)) hosts.push(host);
  }
  return { hosts, unread };
}

/** The hosts alone: every host the console could read among the addresses a text mentions. The frame lists them as text. */
export const mentionedHosts = (text: string): string[] => mentionedAddresses(text).hosts;
```

### Create `apps/admin/src/media.tsx`

```tsx
import { isLowerUuid, type CaseId } from "./router";

/**
 * Images in the console (3c design, sections 7.3 and 8). An image reaches the console only from the staff API on the
 * console's own origin, through the one route that decides whether staff may be served it at all, and only once its
 * person asks for it: first the small size, blurred and grey by a stylesheet class, then clearly. This is the only file
 * that writes a `src`, and it builds the address from two checked ids and one of two literal sizes, never from a text an
 * answer carried.
 */

declare const imageIdBrand: unique symbol;
/** An image's id that parseImageId has checked. */
export type ImageId = string & { readonly [imageIdBrand]: true };

/** The image's id when the text is a lower-case uuid; null for anything else, for which no image is ever asked. */
export function parseImageId(text: string): ImageId | null {
  return isLowerUuid(text) ? (text as ImageId) : null;
}

export type StaffImageSize = "small" | "large";

/** The address of a case's image on the staff API. */
export function staffImageSrc(caseId: CaseId, mediaId: ImageId, size: StaffImageSize): string {
  // The types say so already; an address is still never built from anything but two lower-case uuids and a known size.
  if (!isLowerUuid(caseId) || !isLowerUuid(mediaId) || (size !== "small" && size !== "large")) throw new Error("an image's address is built from checked ids only");
  return `/api/staff/cases/${caseId}/media/${mediaId}/${size}`;
}

/**
 * One image of a case's post, once its person asked to see it. `clear` is false until the second click: the image is
 * then drawn blurred and grey by the stylesheet. The alt text an author wrote is shown beside it, in its frame, never here.
 *
 * `onError` runs when the image did not load: the API refused it (the post was frozen or the image sealed since the page
 * read the case, or the session ended) or the request failed. The browser asks for an image itself, so the page learns of
 * a refusal only here; its caller then says so in the image's place and reads the case again.
 */
export function StaffImage({ caseId, mediaId, size, clear, onError }: { caseId: CaseId; mediaId: ImageId; size: StaffImageSize; clear: boolean; onError(): void }) {
  return <img className={clear ? "evidence" : "evidence blurred"} src={staffImageSrc(caseId, mediaId, size)} alt="An image of the reported post" onError={onError} />;
}
```

### Create `apps/admin/src/screens/Case.tsx`

```tsx
import {
  MEASURES,
  REVEAL_REASON_CATEGORIES,
  SUSPECT_EARLIER_MONTHS,
  type CaseDecision,
  type CaseHistoryEntry,
  type CaseItem,
  type CaseSnapshot,
  type CaseView,
  type RevealReasonCategory,
  type RevealResponse,
} from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { Frame } from "../frames";
import { parseImageId, StaffImage, type ImageId } from "../media";
import { CASE_WORDS, DECISION_KINDS, DECISION_OUTCOMES, describeError, messageFor, NOTE_WORDS, OUTCOME_WORDS, REVEAL_WORDS } from "../messages";
import { CaseLink } from "../nav";
import { parseCaseId, type CaseId } from "../router";
import { revealWithKey } from "../step-up";
import { saveStaffText, type RandomBytes } from "../texts";
import { dateTime, Loaded, UserText, type Loadable } from "../ui";
import { categoryLabel, COLLAPSED_RULES, counted, LANE_NAMES, revealable, sourceWords, writtenBy } from "../words";
import type { CredentialsLike } from "../webauthn";

/**
 * The case page without its composer (3c design, sections 7.3 and 8): the header, the banners, the evidence with its
 * images, the items with their sources, the decisions, the history, the notes and the reveal of a source. Every string
 * someone wrote is drawn as text inside a frame that says who wrote it; every address is text, since the console holds
 * no link into the app; and an image is asked of the API only when its person asks to see it.
 */

/** The Art. 18 check, shown above the evidence of every case in the urgent lane, to everyone who opens it. */
export const ART_18_BANNER = `Art. 18: decide now, as soon as you have read this case, whether it suggests a crime that threatens someone's life or safety. If it does, or you are unsure, wake the operator at once, at any hour. Record your check in a note ("Art. 18 check: no suspicion" or "Art. 18 check: operator told at <time>"). Nobody gives this case its final decision before that note exists.`;

/** The sentences of the banner of a case that holds an unanswered suspect item. */
export const SUSPECT_BANNER = {
  nobody: "Nobody opens the images this report concerns, here or in the app.",
  reach: (reach: { images: number; posts: number; sealed: number; served: number }) =>
    `This case reaches ${reach.images} images on ${reach.posts} posts; ${reach.sealed} are sealed and ${reach.served} are still shown to someone. Seal them now, while an admin decides: they are then shown to nobody, their author included.`,
  noImage: "This case reaches no image, so there is nothing to seal.",
  post: "Do not open this post in the app while a report of this kind about it is unanswered or its images are sealed: its page also shows the post it replies to and its replies, whose images this case neither freezes nor seals.",
  account:
    "Do not open this account's profile in the app while a report of this kind about it is unanswered or its images are sealed: the profile also shows posts of other accounts that it reposted or quoted, whose images this case neither freezes nor seals, and images posted since the seal. When this page shows images that are not sealed, seal again.",
  quotes: "This post quotes another, whose images its card shows; korbat opened a case on that post too:",
  added: "korbat added this item: a reported post quotes this one, and its card shows this post's images.",
  earlierTarget: (count: number, lastOn: string) => `An admin answered ${count} earlier reports of this kind about this target without a seal in the last ${SUSPECT_EARLIER_MONTHS} months, the last on ${lastOn}.`,
  opened: (day: string) => `Staff last opened an image of this post in the console on ${day}.`,
  earlierAuthor: (count: number, lastOn: string) => `An admin answered ${count} such reports about this author's profile or posts without a seal in the last ${SUSPECT_EARLIER_MONTHS} months, the last on ${lastOn}.`,
  newest: (day: string) => `The newest post with images this case reaches is of ${day}.`,
};

/** In place of every image of a post whose images cannot be opened now. */
export const IMAGES_NOT_SHOWN =
  "Images of this post are not shown: a report or finding of child sexual abuse material about it or about its author's account is open, or its images are sealed. Decide what turns on an image on the text alone, or wait until an admin has answered that report.";

/** The reveal dialog's four reasons, as its list words them. */
const REVEAL_REASONS: Record<RevealReasonCategory, string> = {
  impersonation_claim: "A claim of impersonation",
  abuse_of_reporting: "Abuse of reporting",
  legal_requirement: "A legal requirement",
  other: "Another reason",
};

/** The frame a revealed name is shown in. */
const REVEALED_LABEL = "Revealed to you; recorded and shown to every staff member";

/** What "Confirm with your staff key" in the reveal dialog comes to: the answer, or the console's words for the step that failed. */
export type RevealOutcome = { answer: RevealResponse } | { error: string };

/**
 * The reveal as the page runs it. The reason is saved first, without the key; the key then confirms the reveal under the
 * digest the console computed from what its person wrote (saveStaffText answers no other), never the text and never a
 * digest an answer carried. The two steps fail apart: a save refused for the minute's limit on saved texts is worded as
 * that, never as the day's limit on reveals.
 */
export async function revealSource(
  deps: { api: StaffApi; credentials: CredentialsLike; random?: RandomBytes },
  caseId: CaseId,
  itemId: string,
  category: RevealReasonCategory,
  reason: string,
): Promise<RevealOutcome> {
  let reasonDigest: string;
  try {
    reasonDigest = (await saveStaffText(deps, caseId, "reveal_reason", reason)).digest;
  } catch (err) {
    return { error: describeError(err, NOTE_WORDS) };
  }
  try {
    return { answer: await revealWithKey(deps, itemId, { reasonCategory: category, reasonDigest }) };
  } catch (err) {
    return { error: describeError(err, REVEAL_WORDS) };
  }
}

/**
 * What a read of the case that failed leaves on the page. Only the first read may put the page into its failed state:
 * there is no case to show then. Once the case was read, a later read that fails (after a snapshot, a note, a reveal or a
 * refused image) keeps the page as it is, the name a reveal has just shown with it, and says why on the page's error
 * line. Either way the words are the console's own for the code.
 */
export function afterFailedRead(current: Loadable<CaseView>, err: unknown): { view: Loadable<CaseView>; error: string | null } {
  const message = describeError(err, CASE_WORDS);
  return current.state === "ready" ? { view: current, error: message } : { view: { state: "failed", message }, error: null };
}

/**
 * The reveal dialog's state: which item, the category once one is chosen (the dialog opens with none: the reason on the
 * record is the person's own choice, never a default), the reason as typed, and the answer once the key confirmed.
 */
export interface RevealState {
  itemId: string;
  category: RevealReasonCategory | null;
  reason: string;
  busy: boolean;
  error: string | null;
  answer: RevealResponse | null;
}

/** Whether the dialog holds what a reveal needs: a chosen category and a reason that says something. The API refuses an empty reason too. */
const revealReady = (reveal: RevealState): boolean => reveal.category !== null && reveal.reason.trim() !== "";

/** The one image the person asked to see: whether clearly, and whether it failed to load (the API refused it, or the request failed). */
export interface ShownImage {
  id: ImageId;
  clear: boolean;
  failed: boolean;
}

export interface CaseScreenViewProps {
  caseId: CaseId;
  view: CaseView;
  /** The one image the person asked to see; null while none is shown. */
  shownImage: ShownImage | null;
  busy: "snapshot" | "note" | null;
  notice: string | null;
  error: string | null;
  note: string;
  reveal: RevealState | null;
  onOpenCase(id: CaseId): void;
  onShowImage(id: ImageId): void;
  onShowClearly(): void;
  onHideImage(): void;
  /** The shown image did not load. */
  onImageError(): void;
  onSnapshot(): void;
  onNoteChange(text: string): void;
  onNoteSave(): void;
  onRevealOpen(itemId: string): void;
  onRevealChange(change: Partial<Pick<RevealState, "category" | "reason">>): void;
  onRevealConfirm(): void;
  onRevealClose(): void;
}

/** Whether the target as it stands differs from the case's newest snapshot: then the moderator takes a fresh one before deciding. */
export function targetDiffers(view: CaseView): boolean {
  const newest = view.snapshots[0];
  if (!newest || newest.withheld) return true;
  if (view.target.type === "post") return newest.postState !== view.target.state;
  return newest.handle !== view.target.handle || newest.displayName !== view.target.displayName || newest.bio !== view.target.bio;
}

/**
 * The rule whose texts open collapsed, when an item of the case cites one: its words for the button. Everything the
 * target's author wrote takes it, as copied in a snapshot and as it reads now: the post's text, the alt texts, the
 * display name and the bio.
 */
function collapsedLabel(view: CaseView): string | undefined {
  const rule = (["R5", "R3"] as const).find((id) => view.items.some((item) => item.ruleId === id));
  return rule === undefined ? undefined : `Show text (${rule}: ${COLLAPSED_RULES[rule]})`;
}

function SuspectBanner({ view, onOpenCase }: Pick<CaseScreenViewProps, "view" | "onOpenCase">) {
  const { suspicion } = view;
  if (!suspicion?.open) return null;
  const { reach, earlier } = suspicion;
  const quotedCases = [...new Set(view.items.flatMap((item) => (item.quotedCaseId === null ? [] : [item.quotedCaseId])))].flatMap((id) => {
    const checked = parseCaseId(id);
    return checked ? [checked] : [];
  });
  const earlierAny = earlier.target.count > 0 || earlier.author.count > 0;
  return (
    <section className="banner suspect" aria-label="Report of child sexual abuse material">
      <p>{SUSPECT_BANNER.nobody}</p>
      <p>{reach.images === 0 ? SUSPECT_BANNER.noImage : SUSPECT_BANNER.reach(reach)}</p>
      <p>{view.target.type === "post" ? SUSPECT_BANNER.post : SUSPECT_BANNER.account}</p>
      {quotedCases.map((id) => (
        <p key={id}>
          {`${SUSPECT_BANNER.quotes} `}
          <CaseLink id={id} onOpen={onOpenCase}>
            the case on the quoted post
          </CaseLink>
        </p>
      ))}
      {view.items.some((item) => item.quotedByPosition !== null) ? <p>{SUSPECT_BANNER.added}</p> : null}
      {earlier.target.count > 0 && earlier.target.lastOn !== null ? <p>{SUSPECT_BANNER.earlierTarget(earlier.target.count, earlier.target.lastOn)}</p> : null}
      {earlier.target.count > 0 && earlier.target.imagesOpenedOn !== null ? <p>{SUSPECT_BANNER.opened(earlier.target.imagesOpenedOn)}</p> : null}
      {earlier.author.count > 0 && earlier.author.lastOn !== null ? <p>{SUSPECT_BANNER.earlierAuthor(earlier.author.count, earlier.author.lastOn)}</p> : null}
      {earlierAny && reach.newestPostOn !== null ? <p>{SUSPECT_BANNER.newest(reach.newestPostOn)}</p> : null}
    </section>
  );
}

/**
 * The images a post's newest snapshot lists. Each has its entry whatever may be opened: its number, its width and height
 * as text, and its alt text in an author frame, since an alt text is text, which staff read on every path. Only the
 * image itself is held back while the post's images cannot be opened: then no grey box stands for it, nothing offers to
 * show it, and the sentence above the list says why.
 */
function Images({
  view,
  caseId,
  media,
  collapsed,
  shownImage,
  onShowImage,
  onShowClearly,
  onHideImage,
  onImageError,
}: Pick<CaseScreenViewProps, "view" | "caseId" | "shownImage" | "onShowImage" | "onShowClearly" | "onHideImage" | "onImageError"> & {
  media: NonNullable<Extract<CaseSnapshot, { withheld: false }>["media"]>;
  /** The words of the button behind which this case's texts open collapsed, when one of its items cites R3 or R5. */
  collapsed: string | undefined;
}) {
  if (view.target.type !== "post") return null;
  const openable = view.imagesAllowed;
  return (
    <>
      {openable ? null : <p className="notice">{IMAGES_NOT_SHOWN}</p>}
      {media.length === 0 ? (
        <p className="quiet">The snapshot lists no image.</p>
      ) : (
        <ul className="images">
          {media.map((image, index) => {
            const id = parseImageId(image.id);
            const shown = openable && id !== null && shownImage?.id === id ? shownImage : null;
            return (
              <li key={image.id}>
                {openable ? (
                  <div className="placeholder">
                    {shown === null || id === null ? (
                      <span>{`Image ${index + 1}, not shown`}</span>
                    ) : shown.failed ? (
                      // The API refused the image, or it did not load: the console's own words in its place.
                      <span>{messageFor("image_refused")}</span>
                    ) : (
                      <StaffImage caseId={caseId} mediaId={id} size={shown.clear ? "large" : "small"} clear={shown.clear} onError={onImageError} />
                    )}
                  </div>
                ) : (
                  <p>{`Image ${index + 1}`}</p>
                )}
                <p>{`${image.width} by ${image.height} pixels`}</p>
                {image.alt === null ? (
                  <p className="quiet">Its alt text was erased.</p>
                ) : image.alt === "" ? (
                  <p className="quiet">No alt text.</p>
                ) : (
                  <Frame by="Alt text. Written by the author" text={image.alt} collapsedLabel={collapsed} />
                )}
                {!openable || id === null ? null : shown === null ? (
                  <button type="button" onClick={() => onShowImage(id)}>
                    Show image
                  </button>
                ) : (
                  <>
                    {shown.clear || shown.failed ? null : (
                      <button type="button" onClick={onShowClearly}>
                        Show clearly
                      </button>
                    )}
                    <button type="button" onClick={onHideImage}>
                      Hide image
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Snapshot({ snapshot, newest, props }: { snapshot: CaseSnapshot; newest: boolean; props: CaseScreenViewProps }) {
  const collapsed = collapsedLabel(props.view);
  return (
    <article className="panel snapshot">
      <h4>
        {newest ? "Newest snapshot, taken " : "Earlier snapshot, taken "}
        <time dateTime={snapshot.takenAt}>{dateTime(snapshot.takenAt)}</time>
      </h4>
      <p className="hint">
        Digest <code className="hash">{snapshot.digest}</code>
      </p>
      {snapshot.withheld ? (
        <p>Withheld: its content was erased, or copies content that was erased since.</p>
      ) : snapshot.targetType === "post" ? (
        <>
          <p>
            Post by <UserText>{snapshot.authorHandle}</UserText>
            {snapshot.postCreatedAt === null ? "" : `, posted ${dateTime(snapshot.postCreatedAt)}`}
            {snapshot.postState === null ? "" : `, then ${snapshot.postState.split("_").join(" ")}`}
          </p>
          {snapshot.body === null || snapshot.body === "" ? <p className="quiet">The snapshot holds no text.</p> : <Frame by="Written by the author" text={snapshot.body} collapsedLabel={collapsed} />}
          {snapshot.replyToId === null ? null : (
            <p>
              Replies to post <code>{snapshot.replyToId}</code>
            </p>
          )}
          {snapshot.quoteOfId === null ? null : (
            <p>
              Quotes post <code>{snapshot.quoteOfId}</code>
            </p>
          )}
          {newest ? (
            <Images
              view={props.view}
              caseId={props.caseId}
              media={snapshot.media ?? []}
              collapsed={collapsed}
              shownImage={props.shownImage}
              onShowImage={props.onShowImage}
              onShowClearly={props.onShowClearly}
              onHideImage={props.onHideImage}
              onImageError={props.onImageError}
            />
          ) : (
            <p className="quiet">{counted((snapshot.media ?? []).length, "image", "images")} listed.</p>
          )}
        </>
      ) : (
        <>
          <p>
            Account <UserText>{snapshot.handle ?? snapshot.authorHandle}</UserText>
          </p>
          {snapshot.displayName === null || snapshot.displayName === "" ? <p className="quiet">No display name.</p> : <Frame by="Display name. Written by the author" text={snapshot.displayName} collapsedLabel={collapsed} />}
          {snapshot.bio === null || snapshot.bio === "" ? <p className="quiet">No bio.</p> : <Frame by="Bio. Written by the author" text={snapshot.bio} collapsedLabel={collapsed} />}
        </>
      )}
    </article>
  );
}

function Target({ view }: { view: CaseView }) {
  const { target } = view;
  if (target.type === "post") {
    return (
      <p>
        The post now: {target.state === null ? "its row is gone" : `${target.state.split("_").join(" ")}, level ${target.level ?? "unknown"}`}
        {target.authorHandle === null ? null : (
          <>
            , by <UserText>{target.authorHandle}</UserText>
          </>
        )}
        . Its address, as text: <code>{target.link}</code>
      </p>
    );
  }
  // The fields as they read now are the same author's words as the snapshot's: on a case citing R3 or R5 they open
  // collapsed like those.
  const collapsed = collapsedLabel(view);
  return (
    <>
      <p>
        The account now: {target.handle === null ? "its row is gone" : <UserText>{target.handle}</UserText>}
        {target.deleted ? ", deleted" : ""}. The fields as they read now:
      </p>
      {target.displayName === null || target.displayName === "" ? <p className="quiet">No display name.</p> : <Frame by="Display name. Written by the author" text={target.displayName} collapsedLabel={collapsed} />}
      {target.bio === null || target.bio === "" ? <p className="quiet">No bio.</p> : <Frame by="Bio. Written by the author" text={target.bio} collapsedLabel={collapsed} />}
    </>
  );
}

function Item({ item, props }: { item: CaseItem; props: CaseScreenViewProps }) {
  const ground = item.csam ? "child sexual abuse material (notice)" : item.allegesIllegal ? "notice under Art. 16: illegal" : "breaks a rule";
  const by = writtenBy(item.source);
  const collapsed = item.ruleId !== null && Object.hasOwn(COLLAPSED_RULES, item.ruleId) ? `Show text (${item.ruleId}: ${COLLAPSED_RULES[item.ruleId]})` : undefined;
  return (
    <li className="panel item">
      <p>
        <strong>{`Item ${item.seq}`}</strong>
        {` (item ${item.position} of its notice), received ${dateTime(item.createdAt)}. `}
        {`${ground}${item.ruleId === null ? "" : `, ${item.ruleId}`}; ${categoryLabel(item.category)}.`}
      </p>
      <p>
        {"Source: "}
        <UserText>{item.source.label}</UserText>
        {sourceWords(item.source) === "" ? "" : ` (${sourceWords(item.source)})`}
      </p>
      <p>
        Names, as text: <UserText>{item.link}</UserText>
        {item.mediaId === null ? null : (
          <>
            {" and points at image "}
            <code>{item.mediaId}</code>
          </>
        )}
      </p>
      {/* The number is the re-examined item's place in its own notice: the page numbers this case's items otherwise, and the item may lie in an earlier case. */}
      {item.reexaminesPosition === null ? null : <p>{`Re-examination of item ${item.reexaminesPosition} of its notice`}</p>}
      {item.reexaminesYourDecision ? <p className="notice">You decided the item this re-examines. Leave it to another staff member when there is one.</p> : null}
      {item.erased ? <p className="quiet">Its words were erased under korbat's retention rules.</p> : null}
      {item.citedLaw === null ? null : <Frame by={`Cited law. ${by}`} text={item.citedLaw} />}
      {item.explanation === null ? null : <Frame by={`Explanation. ${by}`} text={item.explanation} collapsedLabel={collapsed} />}
      {item.statement === null ? null : <Frame by={`Statement for the re-examination. ${by}`} text={item.statement} collapsedLabel={collapsed} />}
      <p>{item.outcome === null ? "Unanswered." : `Answered: ${OUTCOME_WORDS[item.outcome]}.`}</p>
      {revealable(item.source) ? (
        <button type="button" onClick={() => props.onRevealOpen(item.id)} disabled={props.reveal !== null}>
          Reveal who sent this
        </button>
      ) : null}
      {props.reveal?.itemId === item.id ? <RevealDialog reveal={props.reveal} onChange={props.onRevealChange} onConfirm={props.onRevealConfirm} onClose={props.onRevealClose} /> : null}
    </li>
  );
}

export function RevealDialog({ reveal, onChange, onConfirm, onClose }: { reveal: RevealState; onChange: CaseScreenViewProps["onRevealChange"]; onConfirm(): void; onClose(): void }) {
  const { answer } = reveal;
  const revealed = answer === null ? null : (answer.handle ?? answer.name);
  return (
    <section className="dialog" role="dialog" aria-labelledby="reveal-title">
      <h4 id="reveal-title">Reveal who sent this</h4>
      {answer === null ? (
        <>
          <p className="hint">A reveal cannot be undone. It is recorded, mailed to every staff account and listed on every staff member's home screen for 30 days.</p>
          <label htmlFor="reveal-category">Why</label>
          {/* The list opens on a line that is no reason: the person chooses the one that goes on the record. */}
          <select
            id="reveal-category"
            value={reveal.category ?? ""}
            disabled={reveal.busy}
            onChange={(event) => onChange({ category: REVEAL_REASON_CATEGORIES.find((category) => category === event.target.value) ?? null })}
          >
            <option value="" disabled>
              Choose why
            </option>
            {REVEAL_REASON_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {REVEAL_REASONS[category]}
              </option>
            ))}
          </select>
          <label htmlFor="reveal-reason">Reason</label>
          <textarea id="reveal-reason" rows={3} value={reveal.reason} disabled={reveal.busy} onChange={(event) => onChange({ reason: event.target.value })} />
          <p className="hint">Write the reason in your own words. Never copy what a reporter or a notifier wrote.</p>
          {reveal.error ? (
            <p role="alert" className="error">
              {reveal.error}
            </p>
          ) : null}
          <div className="actions">
            <button type="button" className="primary" onClick={onConfirm} disabled={reveal.busy || !revealReady(reveal)} aria-busy={reveal.busy}>
              Confirm with your staff key
            </button>
            <button type="button" onClick={onClose} disabled={reveal.busy}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          {revealed === null ? (
            <p>The name is no longer kept, so nothing can be shown. The reveal is recorded all the same.</p>
          ) : (
            <>
              {/* What it is, in the console's words; the name alone in the frame, where its hidden characters can be shown. */}
              <p>{answer.handle === null ? "The name the notifier gave:" : "The reporter's handle:"}</p>
              <Frame by={REVEALED_LABEL} text={revealed} />
            </>
          )}
          <div className="actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SealList({ sealed }: { sealed: NonNullable<CaseDecision["actions"][number]["sealed"]> }) {
  const [open, setOpen] = useState(false);
  const more = sealed.posts - sealed.list.length;
  return (
    <>
      <p>{`${sealed.images} images on ${sealed.posts} posts (${sealed.deletedPosts} of them deleted by their author)`}</p>
      <button type="button" className="quiet-button" onClick={() => setOpen((shown) => !shown)} aria-expanded={open}>
        {open ? "Hide the list of posts" : "Show the list of posts"}
      </button>
      {open ? (
        <>
          <ul className="seal-list">
            {sealed.list.map((row) => (
              <li key={row.postId}>
                {`${dateTime(row.createdAt)} `}
                <code>{row.postId}</code>
                {` ${counted(row.images, "image", "images")}`}
              </li>
            ))}
          </ul>
          {more > 0 ? <p>{`and ${more} more: use the runbook's query for a seal's posts`}</p> : null}
        </>
      ) : null}
    </>
  );
}

function Decision({ decision, view }: { decision: CaseDecision; view: CaseView }) {
  const lifted = (id: string | null) => {
    const by = id === null ? undefined : view.decisions.find((other) => other.id === id);
    return by ? `lifted by the decision of ${dateTime(by.decidedAt)}` : "lifted";
  };
  return (
    <li className="panel decision">
      <p>
        <strong>{DECISION_KINDS[decision.kind]}</strong>
        {`: ${DECISION_OUTCOMES[decision.outcome]}, ${dateTime(decision.decidedAt)}, by `}
        <UserText>{decision.staffHandle}</UserText>
        {decision.ground === null ? "" : decision.ground === "illegal" ? "; on the law" : `; under ${decision.ruleId ?? "a rule"}`}
        {`; ${categoryLabel(decision.category)}.`}
      </p>
      {decision.suspect ? <p className="hint">Taken on a report or finding of child sexual abuse material.</p> : null}
      {decision.unseen ? <p className="notice">Taken while nobody could open the post's images: what it answered about an image was answered unseen.</p> : null}
      {decision.needsAdmin ? <p className="hint">An admin's decision.</p> : null}
      {decision.facts === null ? null : <Frame by="Facts. Written by staff" text={decision.facts} />}
      {decision.reason === null ? null : <Frame by="Reason. Written by staff" text={decision.reason} />}
      {decision.legalReference === null ? null : <Frame by="Legal reference. Written by staff" text={decision.legalReference} />}
      {decision.actions.length === 0 ? null : (
        <ul>
          {decision.actions.map((action) => (
            <li key={action.id}>
              {MEASURES[action.kind].label}
              {action.mediaId === null ? null : (
                <>
                  {" "}
                  <code>{action.mediaId}</code>
                </>
              )}
              {MEASURES[action.kind].lifts !== null
                ? ""
                : action.inForce
                  ? ": in force"
                  : action.liftedBy !== null
                    ? `: ${lifted(action.liftedBy)}`
                    : action.kind === "seal_media"
                      ? ": ended with the admin's answer"
                      : ": ended with the case's decision"}
              {action.noEffect === null ? "" : "; changed nothing when imposed"}
              {action.kind === "reset_display_name" || action.kind === "reset_bio" ? "; written once; the field as it reads now is shown above" : ""}
              {action.sealed === null ? null : <SealList sealed={action.sealed} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One event of the history in the console's words. A staff member is named by their handle, as text. */
function historyWords(entry: CaseHistoryEntry): string {
  switch (entry.event) {
    case "item":
      return `Item ${entry.seq ?? ""} arrived${entry.reexamination ? " (a re-examination)" : ""}: ${entry.intakeKind === "finding" ? "a moderator's finding" : entry.csam ? "a notice of child sexual abuse material" : entry.allegesIllegal ? "a notice under Art. 16" : "a report"}${entry.ruleId === null ? "" : `, ${entry.ruleId}`}`;
    case "snapshot":
      return "A snapshot was taken";
    case "decision":
      return `${entry.decisionKind === null ? "Decision" : DECISION_KINDS[entry.decisionKind]}: ${entry.outcome === null ? "" : DECISION_OUTCOMES[entry.outcome]}`;
    case "appeal_filed":
      return "The author appealed";
    case "appeal_answered":
      return `The appeal was answered: ${entry.result === null ? "" : entry.result.split("_").join(" ")}`;
    case "note":
      return "A note was saved";
    case "seal_declined":
      return "Chose not to seal";
    case "reveal":
      return "A source was revealed";
    case "evidence_erased":
      return "A snapshot's content was erased";
    case "redaction":
      return "Content was erased when an R4 decision became final";
  }
}

export function CaseScreenView(props: CaseScreenViewProps) {
  const { view, busy, notice, error, note } = props;
  return (
    <section aria-labelledby="case-title">
      <h2 id="case-title">{view.target.type === "post" ? "Case about a post" : "Case about an account"}</h2>
      <p>
        {`${LANE_NAMES[view.lane]}${view.lane === 0 ? " lane" : ""}; opened ${dateTime(view.openedAt)}; version ${view.stateVersion}`}
        {view.closedAt === null ? "" : `; closed ${dateTime(view.closedAt)}`}
      </p>
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {view.lane === 0 ? <p className="banner art18">{ART_18_BANNER}</p> : null}
      <SuspectBanner view={view} onOpenCase={props.onOpenCase} />

      <h3>Evidence</h3>
      <Target view={view} />
      {targetDiffers(view) ? (
        <button type="button" onClick={props.onSnapshot} disabled={busy !== null} aria-busy={busy === "snapshot"}>
          Take a fresh snapshot
        </button>
      ) : null}
      {view.snapshots.length === 0 ? <p className="quiet">The case holds no snapshot.</p> : null}
      {view.snapshots.map((snapshot, index) => (
        <Snapshot key={snapshot.id} snapshot={snapshot} newest={index === 0} props={props} />
      ))}
      {/* The images' list says so itself, above its entries; a case whose newest snapshot shows no content has no list. */}
      {view.target.type === "post" && !view.imagesAllowed && (view.snapshots[0] === undefined || view.snapshots[0].withheld) ? <p className="notice">{IMAGES_NOT_SHOWN}</p> : null}

      <h3>Items</h3>
      <ul className="plain">
        {view.items.map((item) => (
          <Item key={item.id} item={item} props={props} />
        ))}
      </ul>

      <h3>Decisions</h3>
      {view.decisions.length === 0 ? (
        <p className="quiet">No decision yet.</p>
      ) : (
        <ul className="plain">
          {view.decisions.map((decision) => (
            <Decision key={decision.id} decision={decision} view={view} />
          ))}
        </ul>
      )}
      {view.appeals.map((appeal) => (
        <div key={appeal.id} className="panel">
          <p>{`The author appealed on ${dateTime(appeal.filedAt)}${appeal.result === null ? "; not answered yet" : `; answered: ${appeal.result.split("_").join(" ")}`}.`}</p>
          {appeal.statement === null ? null : <Frame by="Written by the appellant" text={appeal.statement} />}
        </div>
      ))}

      <h3>History</h3>
      <ol className="history">
        {view.history.map((entry, index) => (
          <li key={`${entry.at} ${entry.event} ${entry.refId ?? index}`}>
            <time dateTime={entry.at}>{dateTime(entry.at)}</time>
            {` ${historyWords(entry)}`}
            {entry.staffHandle === null ? null : (
              <>
                {", by "}
                <UserText>{entry.staffHandle}</UserText>
              </>
            )}
          </li>
        ))}
      </ol>

      <h3>Notes</h3>
      <p className="hint">Notes are for staff only and go with the case's evidence.</p>
      {view.notes.length === 0 && view.sealsDeclined.length === 0 ? <p className="quiet">No note yet.</p> : null}
      {view.notes.map((text) => (
        <div key={text.id}>
          <p>
            <UserText>{text.staffHandle}</UserText>
            {`, ${dateTime(text.createdAt)}`}
          </p>
          <Frame by="Note. Written by staff" text={text.text} />
        </div>
      ))}
      {view.sealsDeclined.map((text) => (
        <div key={text.id}>
          <p>
            {"Chose not to seal: "}
            <UserText>{text.staffHandle}</UserText>
            {`, ${dateTime(text.createdAt)}`}
          </p>
          <Frame by="Reason. Written by staff" text={text.text} />
        </div>
      ))}
      <label htmlFor="case-note">Add a note</label>
      <textarea id="case-note" rows={3} value={note} disabled={busy !== null} onChange={(event) => props.onNoteChange(event.target.value)} />
      <div className="actions">
        <button type="button" onClick={props.onNoteSave} disabled={busy !== null || note.trim() === ""} aria-busy={busy === "note"}>
          Save the note
        </button>
      </div>
    </section>
  );
}

export function CaseScreen({ id, api, credentials, onOpenCase }: { id: CaseId; api: StaffApi; credentials: CredentialsLike; onOpenCase(id: CaseId): void }) {
  const [view, setView] = useState<Loadable<CaseView>>({ state: "loading" });
  const [shownImage, setShownImage] = useState<ShownImage | null>(null);
  const [busy, setBusy] = useState<"snapshot" | "note" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const alive = useRef(true);
  /** What the page shows of the case, as the last read left it: a read that fails is judged against it. */
  const page = useRef<Loadable<CaseView>>({ state: "loading" });

  /**
   * Reads the case: its person opened the page or acted on it, so the read is marked. True when the page now shows what
   * was just read. A read that fails after the first keeps the page and uses its error line (afterFailedRead).
   */
  const read = (): Promise<boolean> =>
    api.caseView(id, { activity: true }).then(
      (value) => {
        if (!alive.current) return false;
        page.current = { state: "ready", value };
        setView(page.current);
        return true;
      },
      (err: unknown) => {
        if (!alive.current) return false;
        const failed = afterFailedRead(page.current, err);
        page.current = failed.view;
        setView(failed.view);
        if (failed.error !== null) setError(failed.error);
        return false;
      },
    );

  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
    // Read once per opening of the page; the API client never changes while the page lives.
  }, [api, id]);

  const snapshot = async () => {
    setBusy("snapshot");
    setNotice(null);
    setError(null);
    try {
      await api.takeSnapshot(id, { activity: true });
      // The snapshot's content is read with the case: that read is what the access log and the day's limit count.
      const fresh = await read();
      if (alive.current) setNotice(fresh ? "A fresh snapshot is the case's newest now." : "A fresh snapshot was taken. This page still shows the case as it was read before.");
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const saveNote = async () => {
    setBusy("note");
    setNotice(null);
    setError(null);
    try {
      await saveStaffText({ api }, id, "note", note);
      if (!alive.current) return;
      setNote("");
      const fresh = await read();
      if (alive.current) setNotice(fresh ? "The note is saved." : "The note is saved. This page still shows the case as it was read before.");
    } catch (err) {
      if (alive.current) setError(describeError(err, NOTE_WORDS));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const confirmReveal = async () => {
    if (reveal === null || reveal.busy || reveal.category === null || !revealReady(reveal)) return;
    const { itemId, category, reason } = reveal;
    setReveal({ ...reveal, busy: true, error: null });
    const outcome = await revealSource({ api, credentials }, id, itemId, category, reason);
    if (!alive.current) return;
    if ("error" in outcome) {
      setReveal((current) => (current === null ? null : { ...current, busy: false, error: outcome.error }));
      return;
    }
    setReveal((current) => (current === null ? null : { ...current, busy: false, answer: outcome.answer }));
    // The history gains the reveal. Should this read fail, the page and the name it shows stay as they are.
    void read();
  };

  return (
    <Loaded
      value={view}
      render={(value) => (
        <CaseScreenView
          caseId={id}
          view={value}
          shownImage={shownImage}
          busy={busy}
          notice={notice}
          error={error}
          note={note}
          reveal={reveal}
          onOpenCase={onOpenCase}
          // One image at a time: showing another puts the first back behind its placeholder.
          onShowImage={(image) => setShownImage({ id: image, clear: false, failed: false })}
          onShowClearly={() => setShownImage((current) => (current === null ? null : { ...current, clear: true }))}
          onHideImage={() => setShownImage(null)}
          // The image did not load: its place says so, and the case is read again, since what may be opened has
          // probably changed (a report froze the post, or its images were sealed, since the page read the case).
          onImageError={() => {
            setShownImage((current) => (current === null ? null : { ...current, failed: true }));
            void read();
          }}
          onSnapshot={() => void snapshot()}
          onNoteChange={setNote}
          onNoteSave={() => void saveNote()}
          onRevealOpen={(itemId) => setReveal({ itemId, category: null, reason: "", busy: false, error: null, answer: null })}
          onRevealChange={(change) => setReveal((current) => (current === null ? null : { ...current, ...change }))}
          onRevealConfirm={() => void confirmReveal()}
          onRevealClose={() => setReveal(null)}
        />
      )}
    />
  );
}
```

### Create `apps/admin/src/screens/Queue.tsx`

```tsx
import { FINDING_CATEGORIES, FindingRequest, RULE_DEFAULT_CATEGORY, RULE_IDS, type QueueRow, type RuleId, type TdbCategory } from "@korbat/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { StaffApi } from "../api";
import { systemClock, type Clock } from "../idle";
import { describeError, FINDING_WORDS } from "../messages";
import { CaseLink } from "../nav";
import { parseCaseId, type CaseId } from "../router";
import { dateTime, Loaded, type Loadable } from "../ui";
import { categoryLabel, counted, LANE_NAMES, waited } from "../words";

/**
 * The queue (3c design, sections 7.3 and 8): open cases by lane and then by age, as the API orders them. Nothing here
 * weighs a case: no count of reports, no standing of a reporter. The page reads the queue again every 60 seconds without
 * the activity mark, so a queue left open never keeps a staff session alive. Beside it, "Open a case" takes a korbat link
 * on the moderator's own finding.
 */

/** How often the queue reads itself again. */
export const QUEUE_REFRESH_MS = 60_000;

/**
 * The screen's reads of the queue, on a clock that is the page's or a test's (as the idle timer's is): one now, marked,
 * since opening the screen is its person's action, and one every QUEUE_REFRESH_MS after it, unmarked, since those are the
 * page's own and must never move the session's idle end. Answers what ends them, for when the screen is left.
 */
export function startQueueReads(clock: Clock, read: (activity: boolean) => void): () => void {
  let handle: unknown = null;
  let ended = false;
  const refresh = () => {
    if (ended) return;
    read(false);
    handle = clock.setTimeout(refresh, QUEUE_REFRESH_MS);
  };
  read(true);
  handle = clock.setTimeout(refresh, QUEUE_REFRESH_MS);
  return () => {
    ended = true;
    clock.clearTimeout(handle);
  };
}

/** What marks a row beyond its lane and age: the console's own words for what its unanswered items are. */
export function marksOf(row: QueueRow): string[] {
  const marks: string[] = [];
  if (row.allegesIllegal) marks.push("notice under Art. 16");
  if (row.suspect) marks.push("CSAM: no images");
  if (row.reexamination) marks.push("re-examination");
  if (row.deferred) marks.push("deferred");
  return marks;
}

export interface FindingFormState {
  link: string;
  ruleId: RuleId;
  category: TdbCategory;
  busy: boolean;
  error: string | null;
}

export interface QueueViewProps {
  rows: Loadable<QueueRow[]>;
  /** Whether the API named a further page. */
  more: boolean;
  loadingMore: boolean;
  /** The time the ages are counted to. */
  now: number;
  finding: FindingFormState;
  onLoadMore(): void;
  onOpenCase(id: CaseId): void;
  onFindingChange(change: Partial<Pick<FindingFormState, "link" | "ruleId" | "category">>): void;
  onFindingSubmit(): void;
}

export function QueueView({ rows, more, loadingMore, now, finding, onLoadMore, onOpenCase, onFindingChange, onFindingSubmit }: QueueViewProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onFindingSubmit();
  };
  return (
    <section aria-labelledby="queue-title">
      <h2 id="queue-title">Queue</h2>
      <p className="hint">Open cases by lane, then by how long their oldest unanswered item has waited. Nothing else orders them.</p>
      <Loaded
        value={rows}
        render={(list) =>
          list.length === 0 ? (
            <p>No case is open.</p>
          ) : (
            <div className="scroll">
              <table className="queue">
                <caption className="visually-hidden">Open cases</caption>
                <thead>
                  <tr>
                    <th scope="col">Lane</th>
                    <th scope="col">Waiting</th>
                    <th scope="col">About</th>
                    <th scope="col">Cites</th>
                    <th scope="col">Marks</th>
                    <th scope="col">
                      <span className="visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => {
                    const id = parseCaseId(row.id);
                    return (
                      <tr key={row.id}>
                        <td>{LANE_NAMES[row.lane]}</td>
                        <td>
                          <time dateTime={row.oldestOpenAt} title={dateTime(row.oldestOpenAt)}>
                            {waited(row.oldestOpenAt, now)}
                          </time>
                          {`, ${counted(row.openItems, "item", "items")}`}
                        </td>
                        <td>{row.targetType === "post" ? "a post" : "an account"}</td>
                        <td>{[...row.rules, ...row.categories.map(categoryLabel)].join(", ")}</td>
                        <td>{marksOf(row).join(", ")}</td>
                        <td>
                          {id ? (
                            <CaseLink id={id} onOpen={onOpenCase}>
                              Open the case
                            </CaseLink>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      />
      {more ? (
        <button type="button" onClick={onLoadMore} disabled={loadingMore} aria-busy={loadingMore}>
          Load more
        </button>
      ) : null}

      <h3 id="finding-title">Open a case</h3>
      <p className="hint">
        On your own finding: give the korbat link of a post or a profile, the rule it breaks and the category. What you write about it is saved as a text on the case. A finding citing R2 freezes
        the images its case reaches until an admin answers.
      </p>
      <form className="panel" onSubmit={submit} aria-labelledby="finding-title">
        <label htmlFor="finding-link">Link on korbat</label>
        <input id="finding-link" type="text" value={finding.link} maxLength={300} autoComplete="off" spellCheck={false} onChange={(event) => onFindingChange({ link: event.target.value })} />
        <label htmlFor="finding-rule">Rule</label>
        <select id="finding-rule" value={finding.ruleId} onChange={(event) => onFindingChange({ ruleId: event.target.value as RuleId })}>
          {RULE_IDS.map((rule) => (
            <option key={rule} value={rule}>
              {rule}
            </option>
          ))}
        </select>
        <label htmlFor="finding-category">Category</label>
        <select id="finding-category" value={finding.category} onChange={(event) => onFindingChange({ category: event.target.value as TdbCategory })}>
          {FINDING_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
        {finding.error ? (
          <p role="alert" className="error">
            {finding.error}
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" className="primary" disabled={finding.busy} aria-busy={finding.busy}>
            Open a case
          </button>
        </div>
      </form>
    </section>
  );
}

/** The finding a form's values make, or null when the link is no web address of at most 300 characters: the contracts' schema decides. */
export function findingOf(form: Pick<FindingFormState, "link" | "ruleId" | "category">): FindingRequest | null {
  const parsed = FindingRequest.safeParse({ target: { kind: "link", url: form.link.trim() }, ground: "rule", ruleId: form.ruleId, category: form.category });
  return parsed.success ? parsed.data : null;
}

/**
 * Reads the queue from its start through as many pages as the screen shows, one after the other. `activity` says whether
 * a person's action started the read: the screen's opening and "Load more" do, its own refresh every minute does not.
 */
export async function readQueue(api: StaffApi, pages: number, activity: boolean): Promise<{ rows: QueueRow[]; next: string | null }> {
  const rows: QueueRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < Math.max(1, pages); page++) {
    const answer = await api.queue(cursor, { activity });
    rows.push(...answer.cases);
    cursor = answer.nextCursor;
    if (cursor === null) break;
  }
  return { rows, next: cursor };
}

export function Queue({ api, onOpenCase, clock = systemClock }: { api: StaffApi; onOpenCase(id: CaseId): void; clock?: Clock }) {
  const [rows, setRows] = useState<Loadable<QueueRow[]>>({ state: "loading" });
  const [next, setNext] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [finding, setFinding] = useState<FindingFormState>({ link: "", ruleId: "R1", category: RULE_DEFAULT_CATEGORY.R1, busy: false, error: null });
  const alive = useRef(true);
  const shown = useRef(1);

  useEffect(() => {
    alive.current = true;
    const read = (activity: boolean) =>
      readQueue(api, shown.current, activity).then(
        (answer) => {
          if (!alive.current) return;
          setRows({ state: "ready", value: answer.rows });
          setNext(answer.next);
          setNow(Date.now());
        },
        // A refresh that fails leaves the list as it was; only the first read shows its failure.
        (err: unknown) => alive.current && activity && setRows({ state: "failed", message: describeError(err) }),
      );
    const stop = startQueueReads(clock, (activity) => void read(activity));
    return () => {
      alive.current = false;
      stop();
    };
    // Read from the opening of the screen on; neither the API client nor the clock changes while the page lives.
  }, [api, clock]);

  const loadMore = async () => {
    if (next === null || rows.state !== "ready") return;
    setLoadingMore(true);
    try {
      const answer = await api.queue(next, { activity: true });
      if (!alive.current) return;
      shown.current = pages + 1;
      setPages(pages + 1);
      setRows({ state: "ready", value: [...rows.value, ...answer.cases] });
      setNext(answer.nextCursor);
    } catch (err) {
      if (alive.current) setRows({ state: "failed", message: describeError(err) });
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  };

  const openFinding = async () => {
    const request = findingOf(finding);
    if (request === null) {
      setFinding((form) => ({ ...form, error: FINDING_WORDS.invalid_request }));
      return;
    }
    setFinding((form) => ({ ...form, busy: true, error: null }));
    try {
      const answer = await api.openFinding(request, { activity: true });
      const id = parseCaseId(answer.caseId);
      if (!alive.current) return;
      setFinding((form) => ({ ...form, busy: false, link: "" }));
      if (id) onOpenCase(id);
    } catch (err) {
      if (alive.current) setFinding((form) => ({ ...form, busy: false, error: describeError(err, FINDING_WORDS) }));
    }
  };

  return (
    <QueueView
      rows={rows}
      more={next !== null}
      loadingMore={loadingMore}
      now={now}
      finding={finding}
      onLoadMore={() => void loadMore()}
      onOpenCase={onOpenCase}
      // Choosing a rule presets its category; the moderator may still choose another.
      onFindingChange={(change) => setFinding((form) => ({ ...form, ...change, ...(change.ruleId ? { category: RULE_DEFAULT_CATEGORY[change.ruleId] } : {}), error: null }))}
      onFindingSubmit={() => void openFinding()}
    />
  );
}
```

### Create `apps/admin/src/texts.ts`

```ts
import { staffTextProblem, textDigest, type StaffTextKind, type StaffTextSaved } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { messageFor } from "./messages";
import type { CaseId } from "./router";

/**
 * Saving a text as the console does it (3c design, section 7.4): the text is trimmed and put in its composed form, a
 * 32-byte salt is drawn from the browser's random source, and the digest is computed with the contracts' textDigest. The
 * server recomputes the digest and stores the text as it was sent or refuses it. The digest is what a confirmed action
 * names, so the key never signs a text, only the digest of one the person saved: and that digest is the one computed
 * here, from what the person wrote, never one an answer carried.
 */

/** A text the console will not send: the server would refuse it. */
export class TextRefused extends Error {
  readonly code = "text_invalid";
  readonly status = 0;
  constructor() {
    super(messageFor("text_invalid"));
    this.name = "TextRefused";
  }
}

/** This many random bytes: from the browser's crypto.getRandomValues, or a test's. */
export type RandomBytes = (length: number) => Uint8Array;

const browserRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** A fresh salt: 32 random bytes as 64 lower-case hex characters. */
export function newSalt(random: RandomBytes = browserRandom): string {
  return Array.from(random(32), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The text as the console saves it: trimmed, in its composed form. What is shown back and digested is exactly this. */
export const normalised = (text: string): string => text.trim().normalize("NFC");

/**
 * Saves a text on a case and answers its id, the text as it was saved and the digest computed here from the salt and
 * that text. A text the rules refuse is not sent at all. The request is its person's: it carries the activity mark.
 *
 * The answer's digest must be the one that was sent. An API that answers a save with the digest of another text would
 * otherwise have the page build a confirmed action from it, and the key sign a reason or a statement its person never
 * wrote: such an answer is refused as one the console cannot read, and nothing is built from it.
 */
export async function saveStaffText(deps: { api: StaffApi; random?: RandomBytes }, caseId: CaseId, kind: StaffTextKind, written: string): Promise<StaffTextSaved & { text: string }> {
  const text = normalised(written);
  // No text is saved empty, whatever its kind: the API refuses one as an invalid request, so none is sent.
  if (text === "") throw new ApiError(0, "invalid_request");
  if (staffTextProblem(text) !== null) throw new TextRefused();
  const salt = newSalt(deps.random);
  const digest = await textDigest(salt, text);
  const saved = await deps.api.saveText(caseId, { kind, text, salt, digest }, { activity: true });
  if (saved.digest !== digest) throw new ApiError(0, "invalid_answer");
  return { id: saved.id, digest, text };
}
```

### Create `apps/admin/src/words.ts`

```ts
import type { SourceSummary } from "@korbat/contracts";

/**
 * The console's own words for what its screens count and name (3c design, section 8): lanes, waiting times, categories
 * and the bands of a source's summary. No screen prints a value an answer carried in a place where the console speaks
 * for itself: an enum is worded here, and a string a person wrote is shown as text in a frame.
 */

/** The queue's three lanes, as the home screen and the queue name them. */
export const LANE_NAMES = { 0: "Urgent", 1: "Lane 1", 2: "Lane 2" } as const;

/** "1 case", "2 cases". */
export const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** How long something has waited, coarsely: minutes under an hour, hours under two days, days after that. */
export function waited(since: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  if (minutes < 60) return counted(minutes, "minute", "minutes");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return counted(hours, "hour", "hours");
  return counted(Math.floor(hours / 24), "day", "days");
}

/** A Transparency Database category as a few plain words: "protection of minors" for STATEMENT_CATEGORY_PROTECTION_OF_MINORS. */
export function categoryLabel(category: string): string {
  const words = category.replace(/^STATEMENT_CATEGORY_/, "").toLowerCase().split("_").join(" ");
  return words === "other violation tc" ? "other breach of the rules" : words;
}

/** The two rules whose texts open collapsed: what they are about, for the button that shows the text. */
export const COLLAPSED_RULES: Record<string, string> = { R3: "hatred or harassment", R5: "direct threats" };

const AGE: Record<NonNullable<SourceSummary["accountAge"]>, string> = { under_1_month: "under 1 month old", "1_to_12_months": "1 to 12 months old", over_12_months: "over 12 months old" };
const FILED: Record<NonNullable<SourceSummary["itemsFiled"]>, string> = { "1": "this is its only report", "2_to_9": "2 to 9 reports filed", "10_or_more": "10 or more reports filed" };
const ACTED: Record<NonNullable<SourceSummary["actedOn"]>, string> = {
  none_decided: "none decided yet",
  none: "none of the decided ones acted on",
  under_half: "under half of the decided ones acted on",
  half_or_more: "half or more of the decided ones acted on",
};
const UNSEEN: Record<NonNullable<SourceSummary["answeredUnseen"]>, string> = { none: "", "1": "1 answered without the images", "2_to_9": "2 to 9 answered without the images", "10_or_more": "10 or more answered without the images" };

/**
 * A source's summary in words, after its label: bands for a signed-in reporter, never a count; for a notifier what was
 * given and whether it is confirmed or stopped, never what; nothing more for an anonymous notice or a finding.
 */
export function sourceWords(source: SourceSummary): string {
  if (source.kind === "reporter") {
    const parts = [source.accountAge === null ? "" : `account ${AGE[source.accountAge]}`, source.itemsFiled === null ? "" : FILED[source.itemsFiled], source.actedOn === null ? "" : ACTED[source.actedOn]];
    if (source.answeredUnseen !== null) parts.push(UNSEEN[source.answeredUnseen]);
    return parts.filter((part) => part !== "").join("; ");
  }
  if (source.kind === "notifier") {
    if (source.contactLost) return "signed out; contact lost or forgotten";
    const parts = ["signed out", source.named ? "gave a name" : "gave no name", source.contactGiven ? "gave an address" : "gave no address"];
    if (source.contactGiven) parts.push(source.confirmed ? "address confirmed" : "address not confirmed");
    if (source.suppressed) parts.push("asked korbat to stop its emails");
    return parts.join("; ");
  }
  if (source.kind === "anonymous") return "a notice of child sexual abuse material records no sender";
  if (source.kind === "unlinked") return "the link to the account is no longer kept";
  return "";
}

/** Who a frame says wrote an item's words. */
export function writtenBy(source: SourceSummary): string {
  if (source.kind === "reporter") return `Written by ${source.label}`;
  if (source.kind === "unlinked") return "Written by a reporter no longer linked";
  return "Written by a notifier";
}

/** Whether "Reveal who sent this" is offered: only when the summary names someone, a linked reporter or a notifier who gave a name. */
export const revealable = (source: SourceSummary): boolean => source.kind === "reporter" || (source.kind === "notifier" && source.named === true && !source.contactLost);
```

### Create `apps/api/src/moderation/cases.ts`

```ts
import { sql } from "drizzle-orm";
import {
  OVERVIEW_LIST_MAX,
  QUEUE_PAGE_SIZE,
  RETENTION,
  SEAL_LIST_MAX,
  SOURCE_LABELS,
  SUSPECT_EARLIER_MONTHS,
  reporterLabel,
  type CaseDecision,
  type CaseHistoryEntry,
  type CaseItem,
  type CaseSnapshot,
  type CaseTarget,
  type CaseView,
  type FindingRequest,
  type FindingResponse,
  type MediaSize,
  type QueuePage,
  type QueueRow,
  type SourceSummary,
  type StaffOverview,
  type StaffSnapshotTaken,
  type StaffTextDraft,
} from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { ActiveStaffSession, NotifierFacts } from "../auth";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import type { StoredFile } from "../media";
import { alertUrgentLane, staffAlert } from "./alerts";
import { ModerationError, type ModerationDeps } from "./context";
import { liveTarget, recordIntake, storeSnapshot, type IntakeGround, type LiveTarget, type NamedTarget, type SnapshotContent } from "./intake";
import { accountLink, parseLink, postLink } from "./links";
import {
  appealsWaiting,
  caseActions,
  caseAppeals,
  caseById,
  caseDecisions,
  caseHistory,
  caseItems,
  caseSnapshots,
  caseStaffTexts,
  casesOpenedToday,
  dailyLimits,
  earlierAnswers,
  findingsOpenedToday,
  handleOf,
  imagesOpenedOn,
  insertAccess,
  liveAccount,
  livePost,
  mailAndReleaseCounts,
  openByLane,
  ownDrafts,
  queueRows,
  recentReveals,
  reporterFacts,
  sealCovers,
  snapshotListsImage,
  snapshotTime,
  staffCaseConflict,
  staffToday,
  suspicionOf,
  type CaseItemRow,
  type CaseRow,
  type QueueCursor,
  type ReporterFacts,
  type SnapshotRead,
} from "./repo";

/**
 * The queue and the case, for staff (3c design, section 7.3): the overview the home screen shows, the queue, the case
 * answer, the one door to a case's images, a fresh snapshot, and a moderator's own finding. Every read of a case is
 * written to the access log and counts against the day's limit; none of it needs the key.
 */

// ---------------------------------------------------------------- the day, and the bands of a reporter's summary

/** How many seconds are left to midnight UTC, at least one: what a refusal at a daily limit tells the console to wait. */
export function secondsToUtcMidnight(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

/** The same moment `months` calendar months later in UTC; a day the target month lacks becomes that month's last day. */
function monthsAfter(at: Date, months: number): Date {
  const month = at.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(at.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(at.getUTCFullYear(), month, Math.min(at.getUTCDate(), lastDay), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds()));
}

/** A reporter's account age as a band: under one month, one to twelve months (both ends included), or over twelve. */
export function accountAgeBand(createdAt: Date, now: Date): NonNullable<SourceSummary["accountAge"]> {
  if (now.getTime() < monthsAfter(createdAt, 1).getTime()) return "under_1_month";
  return now.getTime() <= monthsAfter(createdAt, 12).getTime() ? "1_to_12_months" : "over_12_months";
}

/** How many items a reporter filed, the one being read included, as a band. */
export function itemsFiledBand(filed: number): NonNullable<SourceSummary["itemsFiled"]> {
  if (filed <= 1) return "1";
  return filed <= 9 ? "2_to_9" : "10_or_more";
}

/** The share of a reporter's decided items that were acted on, as a band; exactly half is "half or more". */
export function actedOnBand(decided: number, actedOn: number): NonNullable<SourceSummary["actedOn"]> {
  if (decided <= 0) return "none_decided";
  if (actedOn <= 0) return "none";
  return actedOn * 2 < decided ? "under_half" : "half_or_more";
}

/** How many of a reporter's items were answered while nobody could open the images, as a band; they are counted apart from the decided ones. */
export function answeredUnseenBand(unseen: number): NonNullable<SourceSummary["answeredUnseen"]> {
  if (unseen <= 0) return "none";
  if (unseen === 1) return "1";
  return unseen <= 9 ? "2_to_9" : "10_or_more";
}

/**
 * Each reporter's place among the reporters of one case, from 0, in the order of each one's first item in the case: the
 * letter the case page gives them. Given per case, so one person's letter on one case says nothing about another.
 */
export function reporterIndexes(reportersInItemOrder: readonly (string | null)[]): Map<string, number> {
  const indexes = new Map<string, number>();
  for (const reporter of reportersInItemOrder) if (reporter !== null && !indexes.has(reporter)) indexes.set(reporter, indexes.size);
  return indexes;
}

// ---------------------------------------------------------------- recusal

/**
 * Refuses a staff account that is too close to the case's subject: every route that names a case, or an item of one,
 * asks this first, so a refused read writes no access row and does not count against the day's limit. The check never
 * looks at who reported, and its answer reads the same whoever the conflict concerns.
 */
export async function refuseRecused(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, caseId: string): Promise<void> {
  if (await staffCaseConflict(deps.apiDb, session.userId, caseId)) throw new ModerationError("staff_recused");
}

/** The case, after the recusal check; not_found when no case has the id. */
async function openableCase(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, caseId: string): Promise<CaseRow> {
  await refuseRecused(deps, session, caseId);
  const row = await caseById(deps.apiDb, caseId);
  if (!row) throw new ModerationError("not_found");
  return row;
}

// ---------------------------------------------------------------- the overview

/** GET /api/staff/overview: counts, times, staff handles and cases, for every staff member's home screen. */
export async function overview(deps: Pick<ModerationDeps, "apiDb" | "config">): Promise<StaffOverview> {
  const q = deps.apiDb;
  const byLane = await openByLane(q);
  const today = await staffToday(q);
  const mails = await mailAndReleaseCounts(q, RETENTION.mailGiveUpDays);
  return {
    lanes: ([0, 1, 2] as const).map((lane) => byLane.find((row) => row.lane === lane) ?? { lane, open: 0, oldestAt: null }),
    appealsWaiting: await appealsWaiting(q),
    reveals: await recentReveals(q, OVERVIEW_LIST_MAX),
    imagesToday: today.images,
    findingsToday: today.findings,
    mailsWaiting: mails.waiting,
    mailsFailed: mails.failed,
    releaseOverdue: mails.releaseOverdue,
    deferUnproven: deps.config.MODERATION_DEFER_UNPROVEN === "on",
  };
}

// ---------------------------------------------------------------- the queue

const CURSOR_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The queue's cursor: the last row's sort key as an opaque word. */
const encodeCursor = (row: QueueCursor): string => Buffer.from(JSON.stringify([row.lane, row.deferred, row.sortAt, row.id]), "utf8").toString("base64url");

/** Reads a cursor back; anything this module did not write is refused, never guessed at. */
function decodeCursor(cursor: string): QueueCursor {
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ModerationError("invalid_request");
  }
  if (!Array.isArray(parts) || parts.length !== 4) throw new ModerationError("invalid_request");
  const [lane, deferred, sortAt, id] = parts as unknown[];
  if ((lane !== 0 && lane !== 1 && lane !== 2) || typeof deferred !== "boolean" || typeof sortAt !== "string" || !CURSOR_TIME.test(sortAt) || typeof id !== "string" || !CURSOR_ID.test(id)) {
    throw new ModerationError("invalid_request");
  }
  return { lane, deferred, sortAt, id };
}

/**
 * GET /api/staff/queue: open cases by lane and age, 50 a page. Only under the emergency switch are cases whose unanswered
 * items all come from unproven sources sorted after the others of their lane, never below a less severe lane.
 */
export async function queue(deps: Pick<ModerationDeps, "apiDb" | "config">, cursor?: string): Promise<QueuePage> {
  const after = cursor === undefined ? null : decodeCursor(cursor);
  const found = await queueRows(deps.apiDb, { deferUnproven: deps.config.MODERATION_DEFER_UNPROVEN === "on", after, limit: QUEUE_PAGE_SIZE + 1 });
  const page = found.slice(0, QUEUE_PAGE_SIZE);
  const last = page.at(-1);
  return {
    cases: page.map(
      (row): QueueRow => ({
        id: row.id,
        lane: row.lane,
        targetType: row.targetType,
        openedAt: row.openedAt,
        oldestOpenAt: row.oldestOpenAt,
        openItems: row.openItems,
        rules: row.rules as QueueRow["rules"],
        categories: row.categories as QueueRow["categories"],
        allegesIllegal: row.allegesIllegal,
        suspect: row.suspect,
        reexamination: row.reexamination,
        deferred: row.deferred,
      }),
    ),
    // One row more than the page was read: only then is there a next page.
    nextCursor: found.length > QUEUE_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

// ---------------------------------------------------------------- the case answer

/** A snapshot as the case answer carries it: its content unless the database's one predicate withholds it. */
function snapshotView(snapshot: SnapshotRead): CaseSnapshot {
  if (snapshot.withheld || snapshot.salt === null) return { id: snapshot.id, takenAt: snapshot.takenAt, digest: snapshot.digest, withheld: true };
  return {
    id: snapshot.id,
    takenAt: snapshot.takenAt,
    digest: snapshot.digest,
    withheld: false,
    salt: snapshot.salt,
    targetType: snapshot.targetType,
    targetId: snapshot.targetId,
    authorHandle: snapshot.authorHandle,
    postState: snapshot.postState,
    postCreatedAt: snapshot.postCreatedAt,
    replyToId: snapshot.replyToId,
    quoteOfId: snapshot.quoteOfId,
    body: snapshot.body,
    media: snapshot.media,
    displayName: snapshot.displayName,
    bio: snapshot.bio,
    handle: snapshot.handle,
  };
}

const NO_BANDS = { accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null } as const;
const NO_CONTACT = { named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false } as const;

/**
 * Who sent an item, as a summary that names nobody (3c design, section 7.3). A finding was found by a moderator; a notice
 * on the path for child sexual abuse material is anonymous, whoever sent it; a signed-out notifier is what the auth
 * module says of the contact, never the contact; a signed-in reporter is a letter and four bands, or, once the link to
 * the account is gone, only that.
 */
function sourceOf(item: CaseItemRow, letters: Map<string, number>, reporters: Map<string, ReporterFacts>, contacts: Map<string, NotifierFacts>, now: Date): SourceSummary {
  if (item.intakeKind === "finding") return { kind: "staff", label: SOURCE_LABELS.staff, ...NO_BANDS, ...NO_CONTACT };
  if (item.csam) return { kind: "anonymous", label: SOURCE_LABELS.anonymous, ...NO_BANDS, ...NO_CONTACT };
  if (item.channel === "signed_out") {
    const facts = item.contactId === null ? undefined : contacts.get(item.contactId);
    return {
      kind: "notifier",
      label: SOURCE_LABELS.notifier,
      ...NO_BANDS,
      named: facts?.named ?? false,
      contactGiven: facts?.contactGiven ?? false,
      confirmed: facts?.confirmed ?? false,
      suppressed: facts?.suppressed ?? false,
      // The notice left a contact that the auth module no longer has: never stored, or forgotten since.
      contactLost: item.contactId !== null && !(facts?.found ?? false),
    };
  }
  if (item.reporterAccountId === null) return { kind: "unlinked", label: SOURCE_LABELS.unlinked, ...NO_BANDS, ...NO_CONTACT };
  const facts = reporters.get(item.reporterAccountId);
  return {
    kind: "reporter",
    label: reporterLabel(letters.get(item.reporterAccountId) ?? 0),
    accountAge: facts?.createdAt ? accountAgeBand(facts.createdAt, now) : null,
    itemsFiled: itemsFiledBand(facts?.filed ?? 1),
    actedOn: actedOnBand(facts?.decided ?? 0, facts?.actedOn ?? 0),
    answeredUnseen: answeredUnseenBand(facts?.answeredUnseen ?? 0),
    ...NO_CONTACT,
  };
}

/** Whether an item's source is a signed-in reporter still linked to an account: the only items that get a letter. */
const linkedReporter = (item: CaseItemRow): string | null => (item.intakeKind === "user" && !item.csam && item.channel === "signed_in" ? item.reporterAccountId : null);

/**
 * The case as staff read it: what is, never what its senders are told (the status page keeps a live target from a dead
 * one; this answer does not). It writes nothing: readCase logs the read and holds it to the day's limit.
 */
export async function caseView(deps: Pick<ModerationDeps, "apiDb" | "auth" | "media" | "config" | "now">, session: ActiveStaffSession, row: CaseRow): Promise<CaseView> {
  const q = deps.apiDb;
  const origin = deps.config.APP_ORIGIN;

  // The target as it stands. An account case shows no image: a profile holds none, and the images of its posts are shown
  // only on those posts' own cases.
  let target: CaseTarget;
  let imagesAllowed = false;
  let authorId: string | null;
  if (row.targetType === "post") {
    const post = await livePost(q, row.targetId);
    target = { type: "post", id: row.targetId, link: postLink(origin, row.targetId), authorHandle: post?.authorHandle ?? null, state: post?.state ?? null, level: post?.level ?? null };
    imagesAllowed = post?.imagesAllowed ?? false;
    authorId = post?.authorId ?? null;
  } else {
    const account = await liveAccount(q, row.targetId);
    target = { type: "account", id: row.targetId, handle: account?.handle ?? null, displayName: account?.displayName ?? null, bio: account?.bio ?? null, deleted: account?.deleted ?? false };
    authorId = row.targetId;
  }

  // What the page shows in place of images on the path for child sexual abuse material: counts and days only.
  const marks = await suspicionOf(q, row.id);
  let suspicion: CaseView["suspicion"] = null;
  if (marks.holds) {
    const reach = await deps.media.reach({ type: row.targetType, id: row.targetId });
    const earlier = await earlierAnswers(q, { type: row.targetType, id: row.targetId }, authorId, SUSPECT_EARLIER_MONTHS);
    suspicion = {
      open: marks.open,
      reach: { posts: reach.posts, images: reach.images, sealed: reach.sealed, served: reach.served, newestPostOn: reach.newestPostOn },
      // Only a post's images are ever shown in the console, so only a post's case can say when staff last looked.
      earlier: { target: { ...earlier.target, imagesOpenedOn: row.targetType === "post" ? await imagesOpenedOn(q, row.targetId) : null }, author: earlier.author },
    };
  }

  const itemRows = await caseItems(q, row.id, session.userId);
  const letters = reporterIndexes(itemRows.map(linkedReporter));
  const reporters = await reporterFacts(q, [...letters.keys()]);
  const contactIds = [...new Set(itemRows.flatMap((item) => (item.channel === "signed_out" && !item.csam && item.contactId !== null ? [item.contactId] : [])))];
  const contacts = contactIds.length === 0 ? new Map<string, NotifierFacts>() : await deps.auth.notifierFacts(contactIds);
  const now = deps.now();
  const items = itemRows.map(
    (item): CaseItem => ({
      id: item.id,
      seq: item.seq,
      position: item.position,
      createdAt: item.createdAt,
      lane: item.lane,
      // An account's address is built from the handle as it was named; the target above carries the handle it holds now.
      link: item.targetType === "post" ? postLink(origin, item.targetId) : accountLink(origin, item.namedHandle ?? ""),
      ruleId: item.ruleId as CaseItem["ruleId"],
      allegesIllegal: item.allegesIllegal,
      csam: item.csam,
      category: item.category as CaseItem["category"],
      categoryKeyword: item.categoryKeyword,
      citedLaw: item.citedLaw,
      explanation: item.explanation,
      mediaId: item.mediaId,
      suspect: item.suspect,
      // An item korbat added for a quoted post stands ten positions after the item it was added for.
      quotedByPosition: item.position > 10 ? item.position - 10 : null,
      quotedCaseId: item.quotedCaseId,
      reexaminesPosition: item.reexaminesPosition,
      reexaminesYourDecision: item.reexaminesYourDecision,
      statement: item.statement,
      outcome: item.outcome as CaseItem["outcome"],
      answeredBy: item.answeredBy,
      erased: item.erased,
      source: sourceOf(item, letters, reporters, contacts, now),
    }),
  );

  const actions = await caseActions(q, row.id);
  const decisions: CaseDecision[] = [];
  for (const decision of await caseDecisions(q, row.id)) {
    const own: CaseDecision["actions"] = [];
    for (const action of actions.filter((candidate) => candidate.decisionId === decision.id)) {
      own.push({
        id: action.id,
        kind: action.kind,
        mediaId: action.mediaId,
        noEffect: action.noEffect,
        inForce: action.inForce,
        reversesActionId: action.reversesActionId,
        liftedBy: action.liftedBy,
        // A seal's list is the database's, written when the seal was recorded: text for the report to the police.
        sealed: action.kind === "seal_media" ? await sealCovers(q, action.id, SEAL_LIST_MAX) : null,
      });
    }
    decisions.push({
      id: decision.id,
      kind: decision.kind,
      outcome: decision.outcome as CaseDecision["outcome"],
      ground: decision.ground as CaseDecision["ground"],
      ruleId: decision.ruleId as CaseDecision["ruleId"],
      rulesVersion: decision.rulesVersion,
      redressVersion: decision.redressVersion,
      category: decision.category as CaseDecision["category"],
      categoryKeyword: decision.categoryKeyword,
      source: decision.source as CaseDecision["source"],
      decidedAt: decision.decidedAt,
      staffHandle: decision.staffHandle,
      throughSeq: decision.throughSeq,
      answersFromSeq: decision.answersFromSeq,
      reviewsDecisionId: decision.reviewsDecisionId,
      snapshotId: decision.snapshotId,
      suspect: decision.suspect,
      unseen: decision.unseen,
      needsAdmin: decision.needsAdmin,
      endedInterim: decision.endedInterim,
      facts: decision.facts,
      reason: decision.reason,
      legalReference: decision.legalReference,
      actions: own,
    });
  }

  const texts = await caseStaffTexts(q, row.id);
  const staffText = (text: (typeof texts)[number]) => ({ id: text.id, staffHandle: text.staffHandle, createdAt: text.createdAt, text: text.text });
  return {
    id: row.id,
    lane: row.lane,
    stateVersion: row.stateVersion,
    intakeSeq: row.intakeSeq,
    answeredSeq: row.answeredSeq,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    target,
    suspicion,
    imagesAllowed,
    snapshots: (await caseSnapshots(q, row.id)).map(snapshotView),
    items,
    decisions,
    appeals: await caseAppeals(q, row.id),
    drafts: (await ownDrafts(q, row.id, session.userId)) as StaffTextDraft[],
    notes: texts.filter((text) => text.kind === "note").map(staffText),
    sealsDeclined: texts.filter((text) => text.kind === "seal_declined").map(staffText),
    history: (await caseHistory(q, row.id)) as CaseHistoryEntry[],
  };
}

/** The alert's key for one staff account's day: its window ends at midnight UTC, so the alert goes once that day. */
const readsKey = (staffId: string) => `moderation-reads:${staffId}`;

/**
 * Tells every staff account, the person's own included, that a staff account reached the day's limit on cases: a stolen
 * key reads at the speed of requests, and this mail is how the others learn of it. Once a day for each account.
 */
async function alertDailyReads(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits" | "log" | "now">, staffId: string, limit: number): Promise<void> {
  const handle = (await handleOf(deps.apiDb, staffId)) ?? "unknown";
  await staffAlert(deps, readsKey(staffId), secondsToUtcMidnight(deps.now()) * 1000, { template: "moderation_reads", handle, limit });
}

/**
 * GET /api/staff/cases/:case. In this order: the recusal check; the day's limit, which counts different cases, so a case
 * the person already opened today is never refused and a reload or a decision's answer never meets it; the access row;
 * then the answer. A person at the limit is refused every other case until midnight UTC, with nothing written, and every
 * staff account is told once that day.
 */
export async function readCase(deps: ModerationDeps, session: ActiveStaffSession, caseId: string): Promise<CaseView> {
  const row = await openableCase(deps, session, caseId);
  const limits = await dailyLimits(deps.apiDb);
  const opened = await casesOpenedToday(deps.apiDb, session.userId, caseId);
  if (!opened.thisCase && opened.cases >= limits.caseOpens) {
    deps.background.start(() => alertDailyReads(deps, session.userId, limits.caseOpens));
    throw new ModerationError("rate_limited", 429, undefined, secondsToUtcMidnight(deps.now()));
  }
  await insertAccess(deps.apiDb, { staffId: session.userId, caseId, kind: "case_opened" });
  return caseView(deps, session, row);
}

// ---------------------------------------------------------------- images in the console

/**
 * GET /api/staff/cases/:case/media/:media/:size: an image of the case's own post, opened for staff, or image_refused. The
 * media module's one function decides what may be opened at all (gate V: never a sealed or an erased image, never an
 * image of a frozen post, on whatever case, open or closed); this route adds that the image is the case's. In this order:
 *   1. the recusal check and the case, as on every case route; only a post's case shows images;
 *   2. the image is one that a snapshot of the case lists, while that snapshot still holds its content: read from the
 *      module's own evidence, before the media module is asked. An id that names nothing and an id of another post's image
 *      are then refused by the same steps, with no file looked for, so the time an answer takes tells the two apart no
 *      more than the answer does;
 *   3. the media module's answer, and that the image it opened is on the case's own post.
 * Every refusal reads the same, and the file's handle is closed on each refusal after the open. Each view is written to
 * the access log before a byte is sent. The caller streams the file and closes it.
 */
export async function caseImage(deps: Pick<ModerationDeps, "apiDb" | "media">, session: ActiveStaffSession, caseId: string, mediaId: string, size: MediaSize): Promise<StoredFile> {
  const row = await openableCase(deps, session, caseId);
  if (row.targetType !== "post") throw new ModerationError("image_refused");
  // The id in the spelling the database writes, which is the one a snapshot lists its images by.
  const imageId = mediaId.toLowerCase();
  if (!(await snapshotListsImage(deps.apiDb, caseId, imageId))) throw new ModerationError("image_refused");
  const image = await deps.media.staffImage(imageId, size);
  if (!image) throw new ModerationError("image_refused");
  try {
    // The image is of another post than this case's: the same answer as for an image that is not shown at all.
    if (image.postId !== row.targetId) throw new ModerationError("image_refused");
    await insertAccess(deps.apiDb, { staffId: session.userId, caseId, kind: "image_viewed", mediaId: imageId });
  } catch (err) {
    await image.file.handle.close();
    throw err;
  }
  return image.file;
}

// ---------------------------------------------------------------- a fresh snapshot

/** The longest one run of the snapshot route waits for a lock: the post's row or the case's, which a decision holds while it is recorded. */
const SNAPSHOT_LOCK_TIMEOUT_MS = 10_000;

/** Whether a stored snapshot holds exactly what a capture holds now. */
function sameContent(stored: SnapshotRead, live: SnapshotContent): boolean {
  const images = (list: SnapshotContent["media"]) => JSON.stringify((list ?? []).map((image) => [image.id, image.alt, image.width, image.height]));
  return (
    stored.authorHandle === live.authorHandle &&
    stored.postState === live.postState &&
    stored.postCreatedAt === live.postCreatedAt &&
    stored.replyToId === live.replyToId &&
    stored.quoteOfId === live.quoteOfId &&
    stored.body === live.body &&
    (stored.media === null) === (live.media === null) &&
    images(stored.media) === images(live.media) &&
    stored.displayName === live.displayName &&
    stored.bio === live.bio &&
    stored.handle === live.handle
  );
}

/**
 * How often the snapshot's transaction is run again after a deadlock or a lock timeout, as an intake's is: in each run
 * that gave way nothing was written.
 */
const SNAPSHOT_RETRIES = 3;

/**
 * POST /api/staff/cases/:case/snapshots: a fresh snapshot of the target as it stands, taken the intake's way (a post under
 * a share lock with its images under their row locks, held for the case; a tombstone for a deleted post; no content after
 * an erasure), when it differs from the case's newest one or that one is withheld or erased. It answers the new
 * snapshot's id and digest, or the newest one's when nothing differed, never content: the console reads the case again,
 * so every read of a case's content goes through that route's access row and the day's limit. It needs no key: it changes
 * nothing a user sees, and enters the record only through a decision that names it.
 *
 * Its locks come in another order than a decision's. An intake takes its case first, through its item; this route has no
 * row to store before the copy, and the API role, which holds no UPDATE on cases, cannot lock a case's row itself. So the
 * post is locked first, and the case's row only by the foreign key of a hold or of the snapshot's own row. A decision
 * takes the case and then its post: the two can wait for each other, and PostgreSQL then makes one give way. Like an
 * intake, the transaction is run again on a deadlock and on a lock timeout, up to three times, and when the last run
 * fails the same way the answer is case_closed: the case would not hold still, and the person tries again.
 */
export async function takeSnapshot(deps: Pick<ModerationDeps, "apiDb" | "social" | "media">, session: ActiveStaffSession, caseId: string): Promise<StaffSnapshotTaken> {
  const row = await openableCase(deps, session, caseId);
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.apiDb.transaction((tx) => snapshotIn(deps, tx, row));
    } catch (err) {
      if (!isDeadlock(err) && !isLockNotAvailable(err)) throw err;
      if (attempt >= SNAPSHOT_RETRIES) throw new ModerationError("case_closed");
    }
  }
}

/** One run of the snapshot's transaction: the copy of the case's target, compared with the newest snapshot and stored when it differs. */
async function snapshotIn(deps: Pick<ModerationDeps, "social" | "media">, tx: DbTx, row: CaseRow): Promise<StaffSnapshotTaken> {
  const caseId = row.id;
  await tx.execute(sql`select set_config('lock_timeout', ${`${SNAPSHOT_LOCK_TIMEOUT_MS}ms`}::text, true)`);
  // The transaction's start, which the snapshots' trigger stamps and the digest covers.
  const takenAt = await snapshotTime(tx);
  let content: SnapshotContent;
  if (row.targetType === "post") {
    const post = await deps.social.capturePost(tx, row.targetId);
    if (!post) throw new ModerationError("not_found");
    const held = await deps.media.hold(tx, [{ caseId, postId: row.targetId }]);
    content = {
      caseId,
      targetType: "post",
      targetId: row.targetId,
      authorHandle: post.authorHandle,
      postState: post.state,
      postCreatedAt: post.createdAt.toISOString(),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      body: post.body,
      media: held.get(row.targetId) ?? [],
      displayName: null,
      bio: null,
      handle: null,
    };
  } else {
    const profile = await deps.social.captureProfile(tx, row.targetId);
    if (!profile) throw new ModerationError("not_found");
    content = {
      caseId,
      targetType: "account",
      targetId: row.targetId,
      authorHandle: profile.handle,
      postState: null,
      postCreatedAt: null,
      replyToId: null,
      quoteOfId: null,
      body: null,
      media: null,
      displayName: profile.displayName,
      bio: profile.bio,
      handle: profile.handle,
    };
  }
  const [newest] = await caseSnapshots(tx, caseId, true);
  if (newest && !newest.withheld && !newest.erased && sameContent(newest, content)) return { id: newest.id, digest: newest.digest };
  return storeSnapshot(tx, takenAt, content);
}

// ---------------------------------------------------------------- a moderator's own finding

/**
 * POST /api/staff/findings: opens a case, or joins the target's open one, on the moderator's own finding under a rule. It
 * runs the transaction every intake runs. A finding needs no key, but it has lasting effects (holds, possibly the urgent
 * lane; citing R2 it freezes what its case reaches and makes the final decision an admin's), so one staff account opens
 * at most the day's limit of them, counted before anything is written, and the home screen lists each account's count.
 *
 * Which targets are live is the one rule of every intake: citing R2, a post in any state and an account also under a
 * handle it has left; under any other rule, only a post its author has not deleted and an account that holds the handle
 * now. A target with nothing live is not_found, and nothing is written: a finding is never stored as answered at once.
 *
 * The target is resolved first, before the day's count is read: a link that names nothing, or another site, is answered
 * as that on any day, and only a finding that could be opened meets the limit.
 */
export async function openFinding(deps: ModerationDeps, session: ActiveStaffSession, request: FindingRequest): Promise<FindingResponse> {
  const { target } = request;
  let named: NamedTarget;
  if (target.kind === "post") named = { type: "post", id: target.id, mediaId: target.mediaId ?? null };
  else if (target.kind === "account") named = { type: "account", handle: target.handle };
  else {
    const parsed = parseLink(deps.config.APP_ORIGIN, target.url);
    named = parsed.type === "post" ? { type: "post", id: parsed.id, mediaId: null } : parsed;
  }
  const suspect = request.ruleId === "R2";
  const found = await liveTarget(deps, named, suspect);
  if (!found) throw new ModerationError("not_found");

  const limits = await dailyLimits(deps.apiDb);
  if ((await findingsOpenedToday(deps.apiDb, session.userId)) >= limits.findings) {
    throw new ModerationError("rate_limited", 429, undefined, secondsToUtcMidnight(deps.now()));
  }

  // A finding alleges no illegality and holds no text of its own: what the moderator writes is a saved text.
  const ground: IntakeGround = {
    kind: "finding",
    channel: "staff",
    reporterId: null,
    findingBy: session.userId,
    contactId: null,
    ruleId: request.ruleId,
    allegesIllegal: false,
    csam: false,
    category: request.category,
    categoryKeyword: null,
    citedLaw: null,
    explanation: null,
    bonaFide: false,
  };
  const live: LiveTarget = named.type === "post" ? { type: "post", id: found.id, position: 1, mediaId: named.mediaId } : { type: "account", id: found.id, position: 1, namedHandle: named.handle };
  const recorded = await recordIntake(deps, { ground, live: [live] });
  const item = recorded.items.find((candidate) => candidate.position === 1);
  if (!item || item.caseId === null) throw new Error("a finding's item was stored without a case");

  // A finding that puts an item into the urgent lane alerts staff as a notice does, after the commit and unwaited for.
  if (recorded.items.some((candidate) => candidate.caseId !== null && candidate.lane === 0)) {
    deps.background.start(async () => {
      await alertUrgentLane(deps);
    });
  }
  return { caseId: item.caseId };
}
```

### Create `apps/api/src/moderation/overlap.ts`

```ts
import type { StaffTextKind } from "@korbat/contracts";

/**
 * The overlap check on staff texts (3c design, section 7.4; C19), a pure function. A text that goes to the author with a
 * statement of reasons, or into the record with a reveal, must not carry what a reporter, a notifier or an appellant
 * wrote: their words can identify them. So such a text is refused when any run of OVERLAP_RUN characters of one of their
 * texts appears in it. Staff paraphrase, never quote. The check finds copies, not likenesses.
 */

/** How many characters in a row of someone else's text a staff text may not hold. */
export const OVERLAP_RUN = 32;

/** The kinds that stay with staff and are never sent to anyone: they may quote. */
const EXEMPT: ReadonlySet<StaffTextKind> = new Set<StaffTextKind>(["note", "seal_declined"]);

/** A text as the check compares it: lower-cased, every run of whitespace made one space, one entry for each character. */
const characters = (text: string): string[] => Array.from(text.toLowerCase().replace(/\s+/g, " "));

/** Whether `text` holds a run of OVERLAP_RUN characters of any of `theirs`, compared without case and with whitespace runs as one space. */
export function quotes(text: string, theirs: readonly string[]): boolean {
  const own = characters(text);
  if (own.length < OVERLAP_RUN) return false;
  // Every run of the staff text once, so each of their runs is one lookup.
  const runs = new Set<string>();
  for (let start = 0; start + OVERLAP_RUN <= own.length; start++) runs.add(own.slice(start, start + OVERLAP_RUN).join(""));
  for (const their of theirs) {
    const other = characters(their);
    for (let start = 0; start + OVERLAP_RUN <= other.length; start++) {
      if (runs.has(other.slice(start, start + OVERLAP_RUN).join(""))) return true;
    }
  }
  return false;
}

/**
 * Whether a text of this kind must be refused for quoting: every kind but a note and a recorded choice not to seal is
 * checked against the explanations, cited laws, re-examination statements and appeal statements of its case.
 */
export function quotesUser(kind: StaffTextKind, text: string, theirs: readonly string[]): boolean {
  return !EXEMPT.has(kind) && quotes(text, theirs);
}
```

### Create `apps/api/src/moderation/reveal.ts`

```ts
import { IdentityRevealedParams, type RevealResponse } from "@korbat/contracts";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { boundLockWaits, isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import { secondsToUtcMidnight } from "./cases";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { appendConfirmedAudit, dailyLimits, handleOf, insertAccess, raisedMessage, reporterHandle, revealItem, revealReason, revealsToday, staffCaseConflict } from "./repo";

/**
 * Revealing who sent a report or a notice (3c design, section 7.3). Staff see a source only as a summary; a reporter's
 * handle, or the name a signed-out notifier gave, is shown to a moderator only through this confirmed action, with a
 * reason category and a saved reason text, written to the access log and to the audit record in one transaction, listed
 * on every staff member's home screen and mailed to every staff account. A notifier's address is never revealed.
 */

/** A reveal that committed, with what it showed; or why none did: the confirming account or key ended, or the challenge's time ran out. */
export type RevealOutcome = RevealResponse | "ended" | "late";

/** The lock waits a reveal may meet: the acting account's row, the key's row and the audit head. */
const REVEAL_WAITS = 3;

/** A transaction that met a deadlock or a lock timeout is run once more only while more than this much of the challenge is left. */
const RETRY_MARGIN_MS = 60_000;

/**
 * POST /api/staff/items/:item/reveal, once its step-up verified. Before anything is written it refuses, in this order:
 *   - not_found: the item does not exist, or has no case (its link named nothing);
 *   - staff_recused: the person is too close to the case's subject;
 *   - reveal_refused: the item's intake is on the path for child sexual abuse material or a moderator's finding, or names
 *     nobody (the reporter's link is gone, or the notifier gave no name, or the contact is lost);
 *   - text_not_found: the params' digest is not that of the person's own saved reason on the item's case, unerased,
 *     unconfirmed and named by no reveal yet;
 *   - rate_limited: the person has revealed the day's limit of sources since midnight UTC. The count is read before the
 *     transaction, so two reveals sent at once may both pass at the limit.
 * Then one transaction: every lock wait bounded by a third of what is left of the challenge; the access row; and, last,
 * the audit row through public.append_confirmed_audit, which also confirms the reason text and is what ends a reveal by
 * a staff account or a key that no longer opens anything, and a late one. Nothing else guards it: no decision's trigger
 * runs for a reveal.
 *
 * The identity is read only after the commit, so none is answered when the commit fails: the reporter's handle, or the
 * notifier's given name from the auth module. Both are null when the name was forgotten in between. Every staff account,
 * the person's own included, is then mailed, best effort and without a throttle: the day's limit bounds it, and the home
 * screen lists every reveal.
 */
export async function reveal(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<RevealOutcome> {
  // A confirmation of anything else never reveals a source: that would be a wiring fault, not a refusal.
  if (confirmed.action !== "identity_revealed" || confirmed.target.type !== "intake_item" || confirmed.keyId !== session.keyId) {
    throw new Error("a reveal needs a step-up that confirmed it");
  }
  const params = IdentityRevealedParams.parse(confirmed.params);
  const itemId = confirmed.target.id;

  const item = await revealItem(deps.apiDb, itemId);
  if (!item || item.caseId === null) throw new ModerationError("not_found");
  const caseId = item.caseId;
  if (await staffCaseConflict(deps.apiDb, session.userId, caseId)) throw new ModerationError("staff_recused");
  if (item.csam || item.intakeKind === "finding") throw new ModerationError("reveal_refused");
  const signedOut = item.channel === "signed_out";
  if (signedOut) {
    const facts = item.contactId === null ? undefined : (await deps.auth.notifierFacts([item.contactId])).get(item.contactId);
    if (!facts?.named) throw new ModerationError("reveal_refused");
  } else if (item.reporterAccountId === null) {
    throw new ModerationError("reveal_refused");
  }
  const textId = await revealReason(deps.apiDb, { caseId, authorId: session.userId, digest: params.reasonDigest });
  if (textId === null) throw new ModerationError("text_not_found");
  const limits = await dailyLimits(deps.apiDb);
  if ((await revealsToday(deps.apiDb, session.userId)) >= limits.reveals) {
    throw new ModerationError("rate_limited", 429, undefined, secondsToUtcMidnight(deps.now()));
  }

  let done: { at: Date; count: number };
  for (let attempt = 1; ; attempt++) {
    try {
      const stamped = await deps.apiDb.transaction(async (tx): Promise<{ at: Date; count: number } | "late"> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, REVEAL_WAITS))) return "late";
        const at = await insertAccess(tx, { staffId: session.userId, caseId, kind: "identity_revealed", itemId, textId });
        // The person's reveals of the day, this one included, for the mail; read before the audit row, which is last.
        const count = await revealsToday(tx, session.userId);
        await appendConfirmedAudit(tx, {
          actorId: session.userId,
          keyId: confirmed.keyId,
          action: "identity_revealed",
          targetType: "intake_item",
          targetId: itemId,
          metadata: { params: confirmed.params },
          staffSession: session.handle,
          actionHash: confirmed.actionHash,
          stepUp: confirmed.assertion,
          requestId: ctx.requestId,
          expiresAt: confirmed.expiresAt,
        });
        return { at, count };
      });
      if (stamped === "late") return "late";
      done = stamped;
      break;
    } catch (err) {
      const refusal = raisedMessage(err);
      if (refusal === "staff_confirmation_ended") return "ended";
      if (refusal === "staff_confirmation_late") return "late";
      // The reason text was swept or used between the check above and the audit function's own.
      if (refusal !== null && isModerationErrorCode(refusal)) throw new ModerationError(refusal);
      if (!isDeadlock(err) && !isLockNotAvailable(err)) throw err;
      if (attempt > 1 || confirmed.expiresAt.getTime() - deps.now().getTime() <= RETRY_MARGIN_MS) return "late";
    }
  }

  // The reveal is on the record. Every staff account is told, whatever becomes of the read below.
  deps.background.start(async () => {
    const handle = (await handleOf(deps.apiDb, session.userId)) ?? "unknown";
    await deps.auth.mailStaff({ template: "moderation_reveal", handle, at: done.at, count: done.count, limit: limits.reveals });
  });

  if (signedOut) return { handle: null, name: item.contactId === null ? null : await deps.auth.notifierName(item.contactId) };
  return { handle: await reporterHandle(deps.apiDb, itemId), name: null };
}
```

### Create `apps/api/src/moderation/texts.ts`

```ts
import { staffTextProblem, textDigest, type StaffTextDraft, type StaffTextSaveRequest, type StaffTextSaved, type StaffTextsResponse } from "@korbat/contracts";
import type { ActiveStaffSession } from "../auth";
import { refuseRecused } from "./cases";
import { ModerationError, type ModerationDeps } from "./context";
import { countOrRefuse } from "./intake";
import { quotesUser } from "./overlap";
import { caseById, insertStaffText, ownDraftByDigest, ownDrafts, theirTexts, violatedUniqueConstraint } from "./repo";

/**
 * The saved texts (3c design, section 7.4): every free text a decision, a review or a reveal carries is saved first,
 * without the key, salted and digested by the console. The confirming params then carry only its digest, so the audit
 * chain never holds a typed text, and a text can be erased while its digest stays. Saving changes nothing a user sees: a
 * text enters the record only through a confirmed decision or reveal that names its digest. A note and a recorded choice
 * not to seal are complete when saved.
 */

/** How many texts one staff account may save in a minute. */
export const TEXT_SAVES_PER_MINUTE = 60;

/** The case, after the recusal check; not_found when no case has the id. */
async function caseForTexts(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, caseId: string): Promise<void> {
  await refuseRecused(deps, session, caseId);
  if (!(await caseById(deps.apiDb, caseId))) throw new ModerationError("not_found");
}

/**
 * POST /api/staff/cases/:case/texts. The server stores the text as it was written or refuses it, and never changes it. In
 * this order:
 *   1. the recusal check, and the limit of saves a minute for one staff account;
 *   2. no text is saved empty, whatever its kind (invalid_request): a text of nothing, or of white space alone, says
 *      nothing, and a reveal's reason, a decision's facts or a recorded choice not to seal must say something to be one;
 *   3. what a text must be (text_invalid): well formed, no control character but the line feed, no invisible direction
 *      or spacing character, at most 5000 UTF-16 units;
 *   4. the overlap check, for every kind but a note and a recorded choice not to seal (text_quotes_user): staff
 *      paraphrase what a reporter, a notifier or an appellant wrote on this case, and never quote it;
 *   5. the digest, recomputed here from the salt and the text (text_invalid when it differs from the request's);
 *   6. the row, whose own CHECK holds text, salt and digest together.
 * The same text saved again with the same salt by the same person answers the row already stored.
 */
export async function saveText(deps: Pick<ModerationDeps, "apiDb" | "limits">, session: ActiveStaffSession, caseId: string, request: StaffTextSaveRequest): Promise<StaffTextSaved> {
  await caseForTexts(deps, session, caseId);
  await countOrRefuse(deps, `staff-text:${session.userId}`, 60_000, TEXT_SAVES_PER_MINUTE);

  if (request.text.trim() === "") throw new ModerationError("invalid_request");
  if (staffTextProblem(request.text) !== null) throw new ModerationError("text_invalid");
  if (quotesUser(request.kind, request.text, await theirTexts(deps.apiDb, caseId))) throw new ModerationError("text_quotes_user");
  if ((await textDigest(request.salt, request.text)) !== request.digest) throw new ModerationError("text_invalid");

  const row = { caseId, authorId: session.userId, kind: request.kind, text: request.text, salt: request.salt, digest: request.digest };
  try {
    // A transaction of its own: a refused insert then undoes nothing but itself, whatever the caller runs this inside.
    const id = await deps.apiDb.transaction((tx) => insertStaffText(tx, row));
    return { id, digest: request.digest };
  } catch (err) {
    if (violatedUniqueConstraint(err) !== "staff_texts_digest_unique") throw err;
    // A digest is stored once. The person's own draft of this kind on this case is the same save sent again; anything
    // else that holds the digest is not theirs to name.
    const own = await ownDraftByDigest(deps.apiDb, row);
    if (own === null) throw new ModerationError("text_invalid");
    return { id: own, digest: request.digest };
  }
}

/**
 * GET /api/staff/cases/:case/texts: the person's own drafts on the case, with their salts, so a draft survives a reload
 * or a sign-in. The console recomputes each digest and drops one that does not match.
 */
export async function ownTexts(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, caseId: string): Promise<StaffTextsResponse> {
  await caseForTexts(deps, session, caseId);
  return { texts: (await ownDrafts(deps.apiDb, caseId, session.userId)) as StaffTextDraft[] };
}
```

### Replace `apps/admin/src/App.tsx` (whole file)

```tsx
import { useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { SignalApi } from "./enroll";
import { Layout, Masthead } from "./Layout";
import { describeError } from "./messages";
import { NavLink } from "./nav";
import type { ConsolePath } from "./router";
import { Audit } from "./screens/Audit";
import { CaseScreen } from "./screens/Case";
import { Enroll } from "./screens/Enroll";
import { Home } from "./screens/Home";
import { Queue } from "./screens/Queue";
import { SignIn } from "./screens/SignIn";
import { Unavailable } from "./screens/Unavailable";
import type { ConsoleStore } from "./store";
import type { CredentialsLike } from "./webauthn";

/**
 * The console's page (3a design, section 9): the screen for the address and the session. An enrolment link needs no
 * session; every other page shows sign-in in place while there is none, at its own address, and its own screen after.
 */
export function App({ store, credentials, signal }: { store: ConsoleStore; credentials: CredentialsLike; signal: SignalApi | undefined }) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const { api } = store;
  const { session, route } = state;

  if (session.kind === "unavailable") return <Unavailable />;

  if (route.name === "enroll") {
    return (
      <>
        <Masthead />
        <main>
          <Enroll token={route.token} api={api} credentials={credentials} signal={signal} onUnavailable={store.unavailable} />
        </main>
      </>
    );
  }

  if (session.kind !== "signed-in") {
    return (
      <>
        <Masthead />
        <main>
          {session.kind === "checking" ? <p className="quiet">Loading</p> : null}
          {session.kind === "failed" ? (
            <section className="panel">
              <p role="alert" className="error">
                {session.message}
              </p>
              <button type="button" onClick={() => void store.start()}>
                Try again
              </button>
            </section>
          ) : null}
          {session.kind === "signed-out" ? <SignIn ended={session.ended} api={api} credentials={credentials} onSignedIn={store.signedIn} onUnavailable={store.unavailable} /> : null}
        </main>
      </>
    );
  }

  const signOut = async () => {
    setSignOutError(null);
    try {
      await api.signOut({ activity: true });
      store.signedOut();
    } catch (err) {
      // A session that had already ended has shown sign-in through the 401; any other failure leaves the session as it was.
      if (!(err instanceof ApiError && err.code === "staff_session_required")) setSignOutError(describeError(err));
    }
  };

  const navigate = (path: ConsolePath) => {
    setSignOutError(null);
    store.navigate(path);
  };

  return (
    <Layout me={session.me} path={state.path} warning={state.warning} onNavigate={navigate} onSignOut={() => void signOut()} onStay={() => void store.stay()}>
      {signOutError ? (
        <p role="alert" className="error">
          {signOutError}
        </p>
      ) : null}
      {route.name === "home" || route.name === "signin" ? <Home me={session.me} api={api} credentials={credentials} onOpenCase={store.openCase} /> : null}
      {route.name === "audit" ? <Audit api={api} /> : null}
      {route.name === "queue" ? <Queue api={api} onOpenCase={store.openCase} /> : null}
      {/* Keyed by the case: another case's page starts with nothing of this one's. */}
      {route.name === "case" ? <CaseScreen key={route.id} id={route.id} api={api} credentials={credentials} onOpenCase={store.openCase} /> : null}
      {route.name === "appeals" ? (
        <section aria-labelledby="appeals-title">
          <h2 id="appeals-title">Appeals</h2>
          <p>Appeals arrive later in sub-project 3c. The home page says how many wait.</p>
        </section>
      ) : null}
      {route.name === "unknown" ? (
        <section aria-labelledby="unknown-title">
          <h2 id="unknown-title">No such page</h2>
          <p>There is no page at this address.</p>
          <p>
            <NavLink to="/" onNavigate={navigate}>
              Go to the home page
            </NavLink>
          </p>
        </section>
      ) : null}
    </Layout>
  );
}
```

### Replace `apps/admin/src/Layout.tsx` (whole file)

```tsx
import type { StaffMe } from "@korbat/contracts";
import type { ReactNode } from "react";
import type { IdleWarning } from "./idle";
import { NavLink } from "./nav";
import type { ConsolePath } from "./router";
import { clockTime, UserText } from "./ui";

/**
 * The idle timer's warnings (3a design, section 9), in a live region that is always on the page, so a warning is
 * announced when it appears. Before the idle end, "Stay signed in" sends one marked GET /api/staff/me; before the
 * absolute end there is no button, since nothing moves it.
 */
export function IdleNotice({ warning, onStay }: { warning: IdleWarning | null; onStay(): void }) {
  return (
    <div role="status" aria-live="polite" className={warning === null ? "idle" : "idle warning"}>
      {warning?.kind === "idle" ? (
        <>
          <p>Your staff session ends in 2 minutes.</p>
          <button type="button" onClick={onStay}>
            Stay signed in
          </button>
        </>
      ) : null}
      {warning?.kind === "absolute" ? <p>{`Your staff session ends at ${clockTime(warning.endsAt)}. Sign in again with your staff key then.`}</p> : null}
    </div>
  );
}

/** The console's name, alone: the frame of the pages shown without a session. */
export function Masthead() {
  return (
    <header className="masthead">
      <h1>korbat staff console</h1>
    </header>
  );
}

/** The frame of every page behind a session: who is signed in, the console's pages, sign-out and the idle warnings. */
export function Layout({
  me,
  path,
  warning,
  onNavigate,
  onSignOut,
  onStay,
  children,
}: {
  me: StaffMe;
  path: string;
  warning: IdleWarning | null;
  onNavigate(path: ConsolePath): void;
  onSignOut(): void;
  onStay(): void;
  children: ReactNode;
}) {
  return (
    <>
      <header className="masthead">
        <h1>korbat staff console</h1>
        <nav aria-label="Console">
          <NavLink to="/" current={path === "/"} onNavigate={onNavigate}>
            Home
          </NavLink>
          <NavLink to="/queue" current={path === "/queue"} onNavigate={onNavigate}>
            Queue
          </NavLink>
          <NavLink to="/appeals" current={path === "/appeals"} onNavigate={onNavigate}>
            Appeals
          </NavLink>
          <NavLink to="/audit" current={path === "/audit"} onNavigate={onNavigate}>
            Audit log
          </NavLink>
        </nav>
        <p className="who">
          <UserText>{me.handle}</UserText>, {me.role}
        </p>
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <IdleNotice warning={warning} onStay={onStay} />
      <main>{children}</main>
    </>
  );
}
```

### Replace `apps/admin/src/api.ts` (whole file)

```ts
import {
  AuditPage,
  CaseView,
  ErrorEnvelope,
  FindingResponse,
  QueuePage,
  RevealResponse,
  StaffEnrollOptionsResponse,
  StaffEnrollVerifyResponse,
  StaffKeysResponse,
  StaffMe,
  StaffOverview,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyResponse,
  StaffSnapshotTaken,
  StaffStepUpOptionsResponse,
  StaffTextSaved,
  StaffTextsResponse,
  type FindingRequest,
  type IdentityRevealRequest,
  type StaffEnrollOptionsRequest,
  type StaffEnrollVerifyRequest,
  type StaffSessionRevokeRequest,
  type StaffSignInVerifyRequest,
  type StaffStepUpOptionsRequest,
  type StaffTextSaveRequest,
} from "@korbat/contracts";
import type { z } from "zod";
import { messageFor } from "./messages";
import { isLowerUuid, type CaseId } from "./router";

/**
 * The console's calls to its API (3a design, sections 7 and 9). Every call goes to /api/staff/* on the console's own
 * origin, with the staff session's cookies. Each echoes the staff CSRF cookie in x-staff-csrf (the API requires it on
 * every write), sends X-Staff-Activity: 1 only when its caller says a person's action started it, and parses the answer
 * with the contracts' schema, so nothing the page shows is anything but what the contracts describe.
 */

/** The staff CSRF cookie, which the page can read and the API compares with the header; never the app's. */
export const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
export const STAFF_CSRF_HEADER = "x-staff-csrf";
/** The mark of a request a person's action started: only such a request moves the session's idle end. */
export const STAFF_ACTIVITY_HEADER = "x-staff-activity";

/** A failed call: the API's code, or the console's own (network, invalid_answer), with the console's words for it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string = messageFor(code),
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** What the API client runs on: the page's fetch and cookies, or a test's. */
export interface StaffApiDeps {
  fetch(input: string, init: RequestInit): Promise<Response>;
  cookie(): string;
}

/**
 * What the store listens for. Any staff_session_required answer means the API has already cleared both staff cookies,
 * so the store shows sign-in in place; a marked request that succeeded restarts the idle timer.
 */
export interface ApiHooks {
  /**
   * `carriedStaffCookie`: the refused request carried the staff CSRF cookie. Only a sign-in sets it, for the session's
   * 12 hours, and only a sign-out or a staff_session_required answer clears it, so a request that carried it was made
   * for a session that has now ended, even when no page held that session (a reload or a new tab after an idle-out).
   */
  onSessionRequired(carriedStaffCookie: boolean): void;
  onActivity(): void;
  /**
   * Every /me answer, marked or not: the session the browser's cookie names now, which the store keeps, so a page whose
   * cookie another tab replaced (a sign-out and a sign-in there) holds the new session's handle and binds step-ups to it.
   */
  onMe(me: StaffMe): void;
}

/** A call's options: `activity` is true only when a person's action (a click, a form, opening a screen) started it. */
export interface Call {
  activity?: boolean;
}

/** The audit reader's query: newest, before a cursor, or the page whose newest row is at a place; and its one filter. */
export interface AuditQuery {
  action?: "staff_sign_in";
  cursor?: number;
  at?: number;
}

/** A cookie's value by its exact name, from a document.cookie string. */
export function readCookie(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator > 0 && trimmed.slice(0, separator) === name) {
      try {
        return decodeURIComponent(trimmed.slice(separator + 1));
      } catch {
        return trimmed.slice(separator + 1);
      }
    }
  }
  return undefined;
}

export type StaffApi = ReturnType<typeof createStaffApi>;

export function createStaffApi(deps: StaffApiDeps) {
  const hooks: ApiHooks = { onSessionRequired: () => undefined, onActivity: () => undefined, onMe: () => undefined };

  /**
   * One request. `schema` parses a 2xx answer; null means the route answers 204 with no body. A non-2xx answer becomes an
   * ApiError with the envelope's code (or not_found and internal when there is none), worded by the console.
   */
  async function request<T>(method: "GET" | "POST" | "DELETE", path: string, schema: z.ZodType<T> | null, call: Call, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const csrf = readCookie(deps.cookie(), STAFF_CSRF_COOKIE);
    if (csrf) headers[STAFF_CSRF_HEADER] = csrf;
    if (call.activity === true) headers[STAFF_ACTIVITY_HEADER] = "1";
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      // Same origin only, never cached, and never redirected: the staff API answers every request itself.
      response = await deps.fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new ApiError(0, "network");
    }

    if (!response.ok) {
      const envelope = ErrorEnvelope.safeParse(await response.json().catch(() => null));
      const code = envelope.success ? envelope.data.error.code : response.status === 404 ? "not_found" : "internal";
      // The API cleared both staff cookies with this answer; the store shows sign-in in place. The cookie is gone from
      // the page by now, so what the request carried, read before it was sent, is the only record that it was there.
      if (code === "staff_session_required") hooks.onSessionRequired(Boolean(csrf));
      throw new ApiError(response.status, code);
    }

    let value: T;
    if (schema === null) {
      value = undefined as T;
    } else {
      const parsed = schema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) throw new ApiError(response.status, "invalid_answer");
      value = parsed.data;
    }
    // Only a marked success restarts the idle timer. A refused request moved nothing; one that did move the idle end but
    // failed later, or whose answer the schemas refused, only makes the timer read /me early, and it follows the answer.
    if (call.activity === true) hooks.onActivity();
    return value;
  }

  const query = (q: AuditQuery): string => {
    // Fixed order, numbers only: nothing a person typed reaches the address unchecked.
    const params = new URLSearchParams();
    if (q.action !== undefined) params.set("action", q.action);
    if (q.cursor !== undefined) params.set("cursor", String(q.cursor));
    if (q.at !== undefined) params.set("at", String(q.at));
    const text = params.toString();
    return text === "" ? "" : `?${text}`;
  };

  return {
    hooks,
    me: async (call: Call = {}) => {
      const me = await request("GET", "/api/staff/me", StaffMe, call);
      hooks.onMe(me);
      return me;
    },
    sessions: (call: Call = {}) => request("GET", "/api/staff/sessions", StaffSessionsResponse, call),
    keys: (call: Call = {}) => request("GET", "/api/staff/keys", StaffKeysResponse, call),
    audit: (q: AuditQuery, call: Call = {}) => request("GET", `/api/staff/audit${query(q)}`, AuditPage, call),
    signOut: (call: Call = {}) => request<void>("POST", "/api/staff/signout", null, call),
    signInOptions: (call: Call = {}) => request("POST", "/api/staff/signin/options", StaffSignInOptionsResponse, call),
    signInVerify: (body: StaffSignInVerifyRequest, call: Call = {}) => request("POST", "/api/staff/signin/verify", StaffSignInVerifyResponse, call, body),
    enrollOptions: (body: StaffEnrollOptionsRequest, call: Call = {}) => request("POST", "/api/staff/enroll/options", StaffEnrollOptionsResponse, call, body),
    enrollVerify: (body: StaffEnrollVerifyRequest, call: Call = {}) => request("POST", "/api/staff/enroll/verify", StaffEnrollVerifyResponse, call, body),
    stepUpOptions: (body: StaffStepUpOptionsRequest, call: Call = {}) => request("POST", "/api/staff/step-up/options", StaffStepUpOptionsResponse, call, body),
    /** The handle must already be the lower-case uuid the step-up confirmed: it is the action's target. */
    revokeSession: (handle: string, body: StaffSessionRevokeRequest, call: Call = {}) =>
      request<void>("DELETE", `/api/staff/sessions/${encodeURIComponent(handle)}`, null, call, body),

    // Moderation cases (3c design, section 7.3). A case's address is built from a checked id; every other value goes in
    // a body or, for the queue's cursor, is one the API itself handed out, encoded.
    overview: (call: Call = {}) => request("GET", "/api/staff/overview", StaffOverview, call),
    /** A page of the queue. Its refreshes carry no mark: they are the page's own, never its person's. */
    queue: (cursor: string | null, call: Call = {}) => request("GET", `/api/staff/queue${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, QueuePage, call),
    caseView: (id: CaseId, call: Call = {}) => request("GET", `/api/staff/cases/${id}`, CaseView, call),
    takeSnapshot: (id: CaseId, call: Call = {}) => request("POST", `/api/staff/cases/${id}/snapshots`, StaffSnapshotTaken, call, {}),
    saveText: (id: CaseId, body: StaffTextSaveRequest, call: Call = {}) => request("POST", `/api/staff/cases/${id}/texts`, StaffTextSaved, call, body),
    texts: (id: CaseId, call: Call = {}) => request("GET", `/api/staff/cases/${id}/texts`, StaffTextsResponse, call),
    openFinding: (body: FindingRequest, call: Call = {}) => request("POST", "/api/staff/findings", FindingResponse, call, body),
    /** The item must already be the lower-case uuid the step-up confirmed: it is the action's target. */
    reveal: async (itemId: string, body: IdentityRevealRequest, call: Call = {}) => {
      if (!isLowerUuid(itemId)) throw new ApiError(0, "invalid_request");
      return request("POST", `/api/staff/items/${itemId}/reveal`, RevealResponse, call, body);
    },
  };
}
```

### Replace `apps/admin/src/app.css` (whole file)

```text
/*
 * The staff console's only stylesheet. The page's policy allows styles from its own files only (style-src 'self'), so
 * every rule is here and no component sets a style. Red marks the staff console apart from the app at a glance.
 */
:root {
  color-scheme: light dark;
  --bg: #fafaf9;
  --fg: #1c1917;
  --muted: #57534e;
  --line: #d6d3d1;
  --panel: #ffffff;
  --accent: #991b1b;
  --accent-fg: #ffffff;
  --error-bg: #fef2f2;
  --error-fg: #991b1b;
  --notice-bg: #fffbeb;
  --notice-fg: #78350f;
  --ok-bg: #f0fdf4;
  --ok-fg: #14532d;
  --focus: #2563eb;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0a09;
    --fg: #f5f5f4;
    --muted: #a8a29e;
    --line: #44403c;
    --panel: #1c1917;
    --accent: #dc2626;
    --error-bg: #450a0a;
    --error-fg: #fecaca;
    --notice-bg: #451a03;
    --notice-fg: #fde68a;
    --ok-bg: #052e16;
    --ok-fg: #bbf7d0;
    --focus: #60a5fa;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
}

.masthead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.5rem;
  padding: 0.75rem 1.5rem;
  border-top: 4px solid var(--accent);
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.masthead h1 {
  margin: 0;
  font-size: 1.1rem;
}

.masthead nav {
  display: flex;
  gap: 1rem;
}

.masthead .who {
  margin: 0 0 0 auto;
  color: var(--muted);
}

main {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem;
}

.unavailable {
  max-width: 40rem;
  padding-top: 4rem;
}

.panel {
  max-width: 40rem;
}

h2 {
  font-size: 1.4rem;
  margin: 0 0 1rem;
}

h3 {
  font-size: 1.05rem;
  margin: 2rem 0 0.25rem;
}

a {
  color: var(--accent);
}

a[aria-current="page"] {
  font-weight: 600;
  text-decoration: none;
}

button {
  font: inherit;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: 0.375rem;
  background: var(--panel);
  color: var(--fg);
  cursor: pointer;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
}

button:disabled {
  opacity: 0.6;
  cursor: default;
}

button[aria-busy="true"] {
  cursor: progress;
}

a:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

label {
  display: block;
  font-weight: 600;
  margin-top: 1.5rem;
}

input[type="text"] {
  font: inherit;
  width: 100%;
  max-width: 24rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 0.375rem;
  background: var(--panel);
  color: var(--fg);
}

input[aria-invalid="true"] {
  border-color: var(--error-fg);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}

.hint,
.quiet {
  color: var(--muted);
}

.error {
  background: var(--error-bg);
  color: var(--error-fg);
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
}

.error p {
  margin: 0.25rem 0;
}

.notice {
  background: var(--ok-bg);
  color: var(--ok-fg);
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
}

.ended {
  font-weight: 600;
}

.idle.warning {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1.5rem;
  background: var(--notice-bg);
  color: var(--notice-fg);
}

.idle.warning p {
  margin: 0;
}

.place {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.place label {
  margin: 0;
}

.place input[type="text"] {
  width: 12rem;
}

.scroll {
  overflow-x: auto;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5rem 0 1rem;
}

th,
td {
  text-align: left;
  vertical-align: top;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--line);
}

code {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 0.85em;
}

/* A hash is copied whole by the keeper, so it wraps anywhere rather than widening the table. */
.hash {
  word-break: break-all;
}

/* User-written text may be one long word. */
bdi {
  overflow-wrap: anywhere;
}

.signins,
.keys {
  padding-left: 1.25rem;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* Moderation cases (3c design, section 8). */

select,
textarea {
  display: block;
  width: 100%;
  max-width: 40rem;
  margin: 0.25rem 0 0.75rem;
  padding: 0.5rem 0.6rem;
  font: inherit;
  color: var(--fg);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
}

select:focus-visible,
textarea:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

h4 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.lanes,
.reveals,
.today,
.history,
.seal-list {
  padding-left: 1.25rem;
}

.plain {
  padding-left: 0;
  list-style: none;
}

.item,
.decision,
.snapshot {
  margin: 0.75rem 0;
}

/* A banner stands above the evidence and is read before it. */
.banner {
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  border: 2px solid var(--accent);
  border-radius: 8px;
  background: var(--error-bg);
  color: var(--error-fg);
}

.banner p {
  margin: 0.4rem 0;
}

/*
 * Text someone else wrote, inside a frame that says who wrote it: the label is the console's, the text is theirs, and
 * the border keeps the two apart.
 */
.frame {
  margin: 0.5rem 0;
  padding: 0.5rem 0.75rem;
  border-left: 4px solid var(--line);
  background: var(--panel);
}

.frame-label {
  margin: 0 0 0.25rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.frame-text {
  margin: 0 0 0.25rem;
  white-space: pre-wrap;
}

.quiet-button {
  padding: 0.15rem 0.5rem;
  font-size: 0.85rem;
}

.images {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding-left: 0;
  list-style: none;
}

.images li {
  width: 16rem;
}

/* Every image of a case starts as this grey box of one size, whatever the image's own size, until its person asks for it. */
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16rem;
  height: 12rem;
  overflow: hidden;
  color: var(--muted);
  background: var(--line);
  border-radius: 6px;
}

.evidence {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* The first look at an image: blurred and grey, so its person sees what kind of image it is before they see it. */
.evidence.blurred {
  filter: blur(14px) grayscale(1);
}

.dialog {
  margin: 0.75rem 0;
  padding: 1rem;
  border: 2px solid var(--accent);
  border-radius: 8px;
  background: var(--panel);
}
```

### Replace `apps/admin/src/messages.ts` (whole file)

```ts
import type { CaseDecision, ItemOutcome, ModerationErrorCode, StaffErrorCode } from "@korbat/contracts";

/**
 * The console's own words for every code it can receive (3a design, section 10) and for every outcome it shows (3c
 * design, section 8), one table each. The server's message is never shown: the console words each code from these
 * tables, so a changed or hostile API answer cannot put its own text on the page, and no staff screen ever shows the
 * text of a passkey code, whose remedies are the app's.
 */

/** The ten staff codes, in the design's words. */
export const STAFF_MESSAGES: Record<StaffErrorCode, string> = {
  staff_session_required: "Your staff session ended. Sign in with your staff key.",
  staff_key_invalid: "This key does not open the staff console. If it should, ask the operator to check your staff keys.",
  staff_key_suspended: "This staff key was switched off because a copy of it may exist. Ask the operator for a link to enrol a new one.",
  staff_key_limit: "This account has 5 staff keys. Ask the operator to revoke one before enrolling another.",
  staff_key_not_device_bound: "This key can be synced or copied, so it cannot be a staff key. Use a security key or a device-bound authenticator.",
  staff_key_not_user_verified: "This key did not ask for a PIN or fingerprint, so it cannot be a staff key. Set a PIN on it, or use another key.",
  staff_key_refused: "The browser's answer for this key could not be checked. Try again, or use another key; this link still works.",
  staff_enrollment_invalid: "This enrolment link has expired or was already used. Ask the operator for a new one.",
  staff_step_up_required: "Confirm this with your staff key.",
  staff_step_up_invalid: "That confirmation was for another action, was already used or could not be checked. Try again.",
};

/**
 * The moderation codes the console can meet (3c design, sections 8 and 10): those of the case routes, of a decision, of
 * a finding's link and of a reveal. The codes of the app's own report form never reach the console.
 */
export const CONSOLE_MODERATION_CODES = [
  "notice_link_invalid",
  "notice_link_offsite",
  "case_changed",
  "case_closed",
  "staff_recused",
  "staff_target",
  "admin_required",
  "decision_cap",
  "profile_changed",
  "snapshot_mismatch",
  "snapshot_erased",
  "text_invalid",
  "text_quotes_user",
  "text_not_found",
  "invalid_decision",
  "image_refused",
  "reveal_refused",
] as const satisfies readonly ModerationErrorCode[];
export type ConsoleModerationCode = (typeof CONSOLE_MODERATION_CODES)[number];

/** The console's words for each of them. A recusal reads the same whether the conflict concerns the author or a reporter. */
export const MODERATION_MESSAGES: Record<ConsoleModerationCode, string> = {
  notice_link_invalid: "That link does not name a post or a profile on korbat.",
  notice_link_offsite: "That link leads to another site. A case is opened only on a post or a profile of this korbat.",
  case_changed: "The case changed since this page read it. Read it again, check it and decide again.",
  case_closed: "The case changed at that moment. Try again.",
  staff_recused:
    "You cannot open or decide this case: an account linked to you takes part in it, or follows, blocks, mutes or replied to someone who does, or the post replies to or quotes a post of an account linked to you. Another staff member must handle it.",
  staff_target: "A final decision cannot restrict a staff account: staff are disciplined by demotion. A measure taken while deciding can.",
  admin_required: "Only an admin can take this decision.",
  decision_cap: "You have reached the limit on decisions one staff account may confirm for now. Try again later.",
  profile_changed: "The profile changed since the snapshot was taken. Take a fresh snapshot and decide again.",
  snapshot_mismatch: "The snapshot is not the one this case holds. Read the case again.",
  snapshot_erased: "That snapshot was erased under korbat's retention rules. Take a fresh snapshot and decide again.",
  text_invalid: "This text cannot be saved as it is: it is longer than 5000 characters, or holds a control character or an invisible direction or spacing character.",
  text_quotes_user: "This text quotes what someone wrote about this case. Describe it in your own words, never copy it.",
  text_not_found: "A text of this action is not saved any more, or was used already. Save it again.",
  invalid_decision: "This decision cannot stand as it is.",
  image_refused: "That image is not shown.",
  reveal_refused: "Nobody can be revealed for this item: it names no sender, or its sender's name is no longer kept.",
};

/**
 * Where one code means more on a screen than the shared words say, that screen's words for it, one table for each place
 * (describeError takes the table): which daily limit was reached, or what a link that names nothing means on the form it
 * was typed into. They stand here with every other word for a refusal, so that no screen keeps a table of its own.
 */

/** The case page's own read: the day's limit on different cases, and an address that names no case. */
export const CASE_WORDS = {
  rate_limited: "You have opened as many different cases as one staff account may in a day. You can open others after midnight UTC; every staff account has been told.",
  not_found: "No case has this address.",
};

/** The reveal, once the key confirmed it: the day's limit on reveals. */
export const REVEAL_WORDS = { rate_limited: "You have revealed as many sources as one staff account may in a day. You can reveal others after midnight UTC." };

/** Saving a text, a note or a reveal's reason alike: the limit of saves a minute. */
export const NOTE_WORDS = { rate_limited: "Too many texts were saved in a minute. Wait a moment and save again." };

/** "Open a case" on the queue screen: a link that names nothing live, the day's limit on findings, and a link that is none. */
export const FINDING_WORDS = {
  not_found: "That link names nothing live on korbat: the post or the account does not exist or was deleted.",
  rate_limited: "You have opened as many findings as one staff account may in a day. You can open others after midnight UTC.",
  invalid_request: "Give a link to a post or a profile on korbat.",
};

/** An item's outcome, as the case page words it once the item is answered. */
export const OUTCOME_WORDS: Record<ItemOutcome, string> = {
  restricted_rule: "restricted under a rule",
  restricted_legal: "restricted as illegal",
  no_violation: "no breach found",
  not_evident: "illegality not evident",
  not_available: "nothing live at the link",
  partly_reversed: "restriction reversed in part",
  reversed: "restriction reversed",
};

/** The four kinds of decision, as the case page and its history name them. */
export const DECISION_KINDS: Record<CaseDecision["kind"], string> = {
  interim: "While deciding",
  final: "Final decision",
  review: "Review of an appeal",
  correction: "Correction",
};

/** A decision's outcome, as the case page and its history word it. */
export const DECISION_OUTCOMES: Record<CaseDecision["outcome"], string> = {
  restricted: "restricted",
  no_violation: "no breach",
  not_evident: "illegality not evident",
  kept: "decision kept",
  partly_reversed: "reversed in part",
  reversed: "reversed",
};

/**
 * The shared codes a staff route may also answer, and the console's own: a network failure, an answer its schemas refuse,
 * a browser prompt that did not finish, step-up options that bind something other than the action the person chose, and
 * sign-in or enrolment options whose challenge is not one of that ceremony's.
 */
const OTHER_MESSAGES: Record<string, string> = {
  challenge_expired: "That took too long. Try again.",
  rate_limited: "Too many attempts. Wait a while, then try again.",
  invalid_request: "Some details are missing or invalid.",
  not_found: "That no longer exists.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
  internal: "Something went wrong on the server. Try again.",
  network: "The staff console's server cannot be reached. Check your connection and try again.",
  invalid_answer: "The server's answer could not be read. Reload the page and try again.",
  ceremony_cancelled: "Nothing was signed: the browser's prompt was closed or timed out. Try again.",
  key_already_registered: "This key is already registered for your staff account. Use another key.",
  ceremony_refused: "The browser refused to use a key here. Open the console at exactly the address in CONSOLE_ORIGIN, never at 127.0.0.1, and try again.",
  step_up_mismatch:
    "The confirmation could not be checked: the server asked your key to sign something other than this action, so your key was not asked. Reload the page and try again; if it happens again, tell the operator.",
  signin_mismatch:
    "The sign-in could not be checked: the server asked your key to sign something other than a sign-in, so your key was not asked. Reload the page and try again; if it happens again, tell the operator.",
  enroll_mismatch:
    "The registration could not be checked: the server asked your key for something other than a staff key's registration, so your key was not asked. Reload the page and try again; if it happens again, tell the operator.",
};

const FALLBACK = "Something went wrong. Try again.";

/** The console's words for a code; a code it does not know, a passkey code included, gets the plain fallback. */
export function messageFor(code: string): string {
  if (Object.hasOwn(STAFF_MESSAGES, code)) return STAFF_MESSAGES[code as StaffErrorCode];
  if (Object.hasOwn(MODERATION_MESSAGES, code)) return MODERATION_MESSAGES[code as ConsoleModerationCode];
  if (Object.hasOwn(OTHER_MESSAGES, code)) return OTHER_MESSAGES[code]!;
  return FALLBACK;
}

/** The code of anything a screen's action threw, or null: the console's errors carry one. */
export function codeOf(err: unknown): string | null {
  return err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : null;
}

/**
 * The words for anything a screen's action threw: the console's errors carry a code, anything else is the fallback.
 * `words` gives a screen's own words for a code where the shared ones would say too little: which daily limit was
 * reached, or what a link that names nothing means on the form it was typed into.
 */
export function describeError(err: unknown, words: Record<string, string> = {}): string {
  const code = codeOf(err);
  if (code === null) return FALLBACK;
  return Object.hasOwn(words, code) ? words[code]! : messageFor(code);
}
```

### Replace `apps/admin/src/nav.tsx` (whole file)

```tsx
import type { MouseEvent, ReactNode } from "react";
import { caseHref, type CaseId, type ConsolePath } from "./router";

/**
 * A link to one of the console's own pages. Its address is one of the constants ConsolePath lists, never built from
 * data; a plain click moves inside the page through the store, any other click (a new tab, a new window) is the
 * browser's, as on any link.
 */
export function NavLink({ to, current = false, onNavigate, children }: { to: ConsolePath; current?: boolean; onNavigate(path: ConsolePath): void; children: ReactNode }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };
  return (
    <a href={to} aria-current={current ? "page" : undefined} onClick={follow}>
      {children}
    </a>
  );
}

/**
 * A link to a case's page in the console. Its address is built from a CaseId, which only parseCaseId makes, and from
 * nothing else: an id an answer carries is checked before it can become an address. No link leads into the app.
 */
export function CaseLink({ id, onOpen, children }: { id: CaseId; onOpen(id: CaseId): void; children: ReactNode }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(id);
  };
  return (
    <a href={caseHref(id)} onClick={follow}>
      {children}
    </a>
  );
}
```

### Replace `apps/admin/src/router.ts` (whole file)

```ts
/**
 * The console's own router (3a design, section 9; 3c design, section 8): its fixed pages, a case by its id, an enrolment
 * link, and nothing else. The address bar is the only state it reads; the store pushes and replaces history entries
 * itself, so the page needs no routing library.
 */

/** The pages the console links to by name. Such a link is only ever one of these constants, never an address built from data. */
export type ConsolePath = "/" | "/audit" | "/signin" | "/queue" | "/appeals";

/** A uuid in the one spelling PostgreSQL writes: the only form an id takes in an address the console builds. */
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a text is a lower-case uuid, and nothing else. */
export const isLowerUuid = (text: string): boolean => LOWER_UUID.test(text);

declare const caseIdBrand: unique symbol;
/** A case's id that parseCaseId has checked: the only thing a case's address is ever built from. */
export type CaseId = string & { readonly [caseIdBrand]: true };

/** The case's id when the text is a lower-case uuid; null for anything else, which names no case. */
export function parseCaseId(text: string): CaseId | null {
  return isLowerUuid(text) ? (text as CaseId) : null;
}

/** A case's address in the console: the one address the console builds from a value, and only from a checked id. */
export const caseHref = (id: CaseId): string => `/cases/${id}`;

export type Route =
  | { name: "home" }
  | { name: "audit" }
  | { name: "signin" }
  | { name: "queue" }
  | { name: "appeals" }
  | { name: "case"; id: CaseId }
  | { name: "enroll"; token: string }
  | { name: "unknown" };

/**
 * The route an address names. A trailing slash names the same page. An enrolment link's token is kept exactly as written:
 * the enrolment page checks its shape before it sends it anywhere.
 */
export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "/") return { name: "home" };
  if (path === "/audit") return { name: "audit" };
  if (path === "/signin") return { name: "signin" };
  if (path === "/queue") return { name: "queue" };
  if (path === "/appeals") return { name: "appeals" };
  const found = /^\/cases\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path);
  if (found) {
    const id = parseCaseId(found[1]!);
    if (id) return { name: "case", id };
  }
  const enroll = /^\/enroll\/([^/]+)$/.exec(path);
  if (enroll) return { name: "enroll", token: enroll[1]! };
  return { name: "unknown" };
}
```

### Replace `apps/admin/src/screens/Home.tsx` (whole file)

```tsx
import { OVERVIEW_LIST_MAX, type AuditEntry, type StaffKey, type StaffMe, type StaffOverview, type StaffSession } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { describeError } from "../messages";
import { CaseLink } from "../nav";
import { parseCaseId, type CaseId } from "../router";
import { readSignInsAtOpening } from "../signins";
import { revokeSessionWithKey } from "../step-up";
import { clockTime, dateTime, Loaded, UserText, type Loadable } from "../ui";
import type { CredentialsLike } from "../webauthn";
import { counted, LANE_NAMES, waited } from "../words";

/**
 * The runbook's sentence for a count of decisions not released, in the words of the runbook's own bullet (3c design,
 * section 13, Task 12(a)). It is a constant of its own so that the test of the README's runbook can hold the two to the
 * same words: what the home screen tells staff is what the runbook tells the operator.
 */
export const RELEASE_OVERDUE_RUNBOOK =
  "A count of decisions not released means the daily release keeps failing: notifiers are not told and re-examination windows do not open, so read the API log for moderation-dispatch and fix it the same day.";

/** The home screen's line when decided items wait for the daily release longer than it ever takes: the count, then the runbook's sentence for it. */
export const releaseOverdue = (n: number): string => `Decisions not released after 26 hours: ${n}. ${RELEASE_OVERDUE_RUNBOOK}`;

/**
 * What every staff member sees of the cases (3c design, section 8): the lanes with their open cases and how long the
 * oldest has waited, the appeals waiting, every reveal of a source in the last 30 days with its staff handle and its
 * case, what each staff account viewed and opened today, the mails that wait or were given up, and the emergency
 * switch. Counts, times, handles and case links only.
 */
export function OverviewView({ overview, now, onOpenCase }: { overview: StaffOverview; now: number; onOpenCase(id: CaseId): void }) {
  const { reveals, mailsWaiting, mailsFailed } = overview;
  const waiting = mailsWaiting.receipts + mailsWaiting.authorMails + mailsWaiting.outcomes;
  const failed = mailsFailed.receipts + mailsFailed.authorMails + mailsFailed.outcomes;
  const mails = (m: StaffOverview["mailsWaiting"]) => `${counted(m.receipts, "receipt", "receipts")}, ${counted(m.authorMails, "statement to an author", "statements to authors")}, ${counted(m.outcomes, "outcome", "outcomes")}`;
  return (
    <>
      <h3>Cases</h3>
      <ul className="lanes">
        {overview.lanes.map((lane) => (
          <li key={lane.lane}>{`${LANE_NAMES[lane.lane]}: ${lane.open === 0 || lane.oldestAt === null ? "no open case" : `${counted(lane.open, "case", "cases")}, oldest ${waited(lane.oldestAt, now)}`}`}</li>
        ))}
      </ul>
      <p>{overview.appealsWaiting === 1 ? "1 appeal waits." : `${overview.appealsWaiting} appeals wait.`}</p>
      <p>{overview.deferUnproven ? "The emergency switch is on: cases whose unanswered items all come from unproven sources are listed after the others of their lane." : "The emergency switch is off."}</p>
      {overview.releaseOverdue > 0 ? (
        <p role="alert" className="error">
          {releaseOverdue(overview.releaseOverdue)}
        </p>
      ) : null}
      {waiting > 0 ? <p className="notice">{`Mails waiting for more than an hour: ${mails(mailsWaiting)}.`}</p> : null}
      {failed > 0 ? <p className="notice">{`Mails given up in the last 30 days: ${mails(mailsFailed)}.`}</p> : null}

      <h3>Sources revealed in the last 30 days</h3>
      <p className="hint">Every staff account's. A reveal nobody expected means someone else holds a staff key: tell the operator.</p>
      {reveals.items.length === 0 ? (
        <p>No source was revealed in the last 30 days.</p>
      ) : (
        <ul className="reveals">
          {reveals.items.map((item, index) => {
            const id = parseCaseId(item.caseId);
            return (
              <li key={`${item.at} ${item.caseId} ${index}`}>
                <time dateTime={item.at}>{dateTime(item.at)}</time> <UserText>{item.handle}</UserText>{" "}
                {id ? (
                  <CaseLink id={id} onOpen={onOpenCase}>
                    the case
                  </CaseLink>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {reveals.total > reveals.items.length ? <p>{`Showing the newest ${OVERVIEW_LIST_MAX} of ${reveals.total}.`}</p> : null}

      <h3>Today, by staff account</h3>
      {overview.imagesToday.length === 0 && overview.findingsToday.length === 0 ? (
        <p>No image was viewed and no finding opened today.</p>
      ) : (
        <ul className="today">
          {overview.imagesToday.map((row) => (
            <li key={`images ${row.handle}`}>
              <UserText>{row.handle}</UserText>
              {`: ${counted(row.count, "image", "images")} viewed`}
            </li>
          ))}
          {overview.findingsToday.map((row) => (
            <li key={`findings ${row.handle}`}>
              <UserText>{row.handle}</UserText>
              {`: ${counted(row.count, "finding", "findings")} opened`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The home screen (3a design, section 9; 3c design, section 8): who is signed in and with which role, the session's
 * absolute end, the cases' overview, every staff account's sign-ins of the last 7 days, the person's own staff sessions
 * with "Sign out that session" confirmed by the key, and the person's keys. Keys are added and revoked only with the
 * command line, so no button here touches them.
 */
export interface HomeViewProps {
  me: StaffMe;
  overview: Loadable<StaffOverview>;
  /** The time the overview's waiting times are counted to. */
  now: number;
  onOpenCase(id: CaseId): void;
  signIns: Loadable<AuditEntry[]>;
  sessions: Loadable<StaffSession[]>;
  keys: Loadable<StaffKey[]>;
  /** The handle of the session whose revocation is under way. */
  revoking: string | null;
  notice: string | null;
  error: string | null;
  onRevoke(handle: string): void;
}

export function HomeView({ me, overview, now, onOpenCase, signIns, sessions, keys, revoking, notice, error, onRevoke }: HomeViewProps) {
  return (
    <section aria-labelledby="home-title">
      <h2 id="home-title">Home</h2>
      <p>
        Signed in as <UserText>{me.handle}</UserText>, {me.role}.
      </p>
      <p>{`Signed in until ${clockTime(me.absoluteExpiresAt)}.`}</p>
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <Loaded value={overview} render={(value) => <OverviewView overview={value} now={now} onOpenCase={onOpenCase} />} />

      <h3>Staff sign-ins in the last 7 days</h3>
      <p className="hint">Every staff account's, newest first. A sign-in nobody recognises means someone else holds a staff key: tell the operator.</p>
      <Loaded
        value={signIns}
        render={(list) =>
          list.length === 0 ? (
            <p>No staff sign-ins in the last 7 days.</p>
          ) : (
            <ul className="signins">
              {list.map((entry) => (
                <li key={entry.seq}>
                  <time dateTime={entry.createdAt}>{dateTime(entry.createdAt)}</time> <UserText>{entry.actorHandle ?? "no handle"}</UserText>
                </li>
              ))}
            </ul>
          )
        }
      />

      <h3>Your staff sessions</h3>
      <p className="hint">Signing out another session asks your staff key to confirm it.</p>
      <Loaded
        value={sessions}
        render={(list) => (
          <table>
            <caption className="visually-hidden">Your staff sessions</caption>
            <thead>
              <tr>
                <th scope="col">Browser</th>
                <th scope="col">Started</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="visually-hidden">Sign out</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((session) => (
                <tr key={session.handle}>
                  <td>
                    <UserText>{session.browser}</UserText>
                  </td>
                  <td>{dateTime(session.createdAt)}</td>
                  <td>{dateTime(session.lastUsedAt)}</td>
                  <td>
                    {session.current ? (
                      "This session"
                    ) : (
                      <button type="button" onClick={() => onRevoke(session.handle)} disabled={revoking !== null} aria-busy={revoking === session.handle}>
                        Sign out that session
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />

      <h3>Your staff keys</h3>
      <p className="hint">The operator adds and revokes staff keys with the staff command line.</p>
      <Loaded
        value={keys}
        render={(list) => (
          <ul className="keys">
            {list.map((key) => (
              <li key={key.id}>
                <UserText>{key.name}</UserText>
                {`: added ${dateTime(key.createdAt)}, ${key.lastUsedAt === null ? "never used" : `last used ${dateTime(key.lastUsedAt)}`}`}
              </li>
            ))}
          </ul>
        )}
      />
    </section>
  );
}

/** Runs one read and hands its outcome to `set`, unless the screen has gone meanwhile. */
function load<T>(alive: { current: boolean }, set: (value: Loadable<T>) => void, read: () => Promise<T>): void {
  read().then(
    (value) => alive.current && set({ state: "ready", value }),
    (err: unknown) => alive.current && set({ state: "failed", message: describeError(err) }),
  );
}

/** The person's staff sessions, marked: the screen reads them when it opens and after a revocation the person asked for. */
function readSessions(api: StaffApi, alive: { current: boolean }, set: (value: Loadable<StaffSession[]>) => void): void {
  load(alive, set, async () => (await api.sessions({ activity: true })).sessions);
}

/** Where the screen's lists go as each read finishes. */
export interface HomeLists {
  overview(value: Loadable<StaffOverview>): void;
  signIns(value: Loadable<AuditEntry[]>): void;
  sessions(value: Loadable<StaffSession[]>): void;
  keys(value: Loadable<StaffKey[]>): void;
}

/**
 * What the screen reads when it opens, every read marked, since opening the screen is its person's action. It takes no
 * session: the sign-ins' 7 days are counted from a /me read now (readSignInsAtOpening), never from the session the page
 * holds, which can be hours old.
 */
export function openHome(api: StaffApi, alive: { current: boolean }, set: HomeLists): void {
  load(alive, set.signIns, () => readSignInsAtOpening(api));
  load(alive, set.overview, () => api.overview({ activity: true }));
  readSessions(api, alive, set.sessions);
  load(alive, set.keys, async () => (await api.keys({ activity: true })).keys);
}

export function Home({ me, api, credentials, onOpenCase }: { me: StaffMe; api: StaffApi; credentials: CredentialsLike; onOpenCase(id: CaseId): void }) {
  const [overview, setOverview] = useState<Loadable<StaffOverview>>({ state: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [signIns, setSignIns] = useState<Loadable<AuditEntry[]>>({ state: "loading" });
  const [sessions, setSessions] = useState<Loadable<StaffSession[]>>({ state: "loading" });
  const [keys, setKeys] = useState<Loadable<StaffKey[]>>({ state: "loading" });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    openHome(api, alive, {
      overview: (value) => {
        setNow(Date.now());
        setOverview(value);
      },
      signIns: setSignIns,
      sessions: setSessions,
      keys: setKeys,
    });
    return () => {
      alive.current = false;
    };
    // Read once per opening of the screen, never again when the idle timer's reads change `me`; the API client never
    // changes while the page lives.
  }, [api]);

  const revoke = async (handle: string) => {
    setRevoking(handle);
    setNotice(null);
    setError(null);
    try {
      const outcome = await revokeSessionWithKey({ api, credentials }, handle);
      if (!alive.current) return;
      setNotice(outcome === "revoked" ? "That session is signed out." : "That session had already ended.");
      readSessions(api, alive, setSessions);
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setRevoking(null);
    }
  };

  return (
    <HomeView me={me} overview={overview} now={now} onOpenCase={onOpenCase} signIns={signIns} sessions={sessions} keys={keys} revoking={revoking} notice={notice} error={error} onRevoke={(handle) => void revoke(handle)} />
  );
}
```

### Replace `apps/admin/src/step-up.ts` (whole file)

```ts
import { STAFF_STEP_UP_CHALLENGE, StaffStepUpOptionsRequest, stepUpActionHash, stepUpBinding, type AuthenticationResponseJSON, type IdentityRevealedParams } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { messageFor } from "./messages";
import { authenticationResponseToJSON, ceremonyFailure, fromBase64url, requestOptionsFromJSON, type CredentialsLike } from "./webauthn";

/**
 * The step-up as the console runs it (3a design, sections 7 and 9). Before it asks the key to confirm an action, the page
 * checks the options the API gave it: the challenge must be the 74 bytes of the contracts' step-up layout with the
 * staff_step_up purpose, bound to the sha256 of this session's handle and the hash of exactly the `{ action, target,
 * params }` the page chose, and the allow list must hold one key. Otherwise the key is never asked, so an API under an
 * attacker's control cannot have it sign an action the person did not choose. The check trusts the page, which Caddy
 * serves from its image, not the API.
 */

/** Options that bind something other than the action the person chose; the key was not asked. */
export class StepUpMismatch extends Error {
  readonly code = "step_up_mismatch";
  readonly status = 0;
  constructor() {
    super(messageFor("step_up_mismatch"));
    this.name = "StepUpMismatch";
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Checks step-up options against this session's handle and the action the page is about to confirm, with the contracts'
 * layout, purpose code, sorted-JSON text and hash, never a copy of them. Throws StepUpMismatch on any difference.
 */
export async function checkStepUpOptions(options: { challenge: string; allowCredentials?: unknown }, sessionHandle: string, action: StaffStepUpOptionsRequest): Promise<void> {
  const layout = STAFF_STEP_UP_CHALLENGE;
  let challenge: Uint8Array;
  try {
    challenge = fromBase64url(options.challenge);
  } catch {
    throw new StepUpMismatch();
  }
  if (challenge.length !== layout.bytes) throw new StepUpMismatch();
  if (challenge[layout.versionAt] !== layout.version || challenge[layout.purposeAt] !== layout.purpose) throw new StepUpMismatch();
  // The binding is recomputed here from what the page chose, so a challenge bound to another action, target, params or
  // session never reaches the key.
  const expected = await stepUpBinding(sessionHandle, await stepUpActionHash(action));
  if (!sameBytes(challenge.subarray(layout.bindingAt, layout.bindingAt + layout.bindingBytes), expected)) throw new StepUpMismatch();
  // Exactly one key, the session's own: an empty list would let the browser offer any key the person holds.
  if (!Array.isArray(options.allowCredentials) || options.allowCredentials.length !== 1) throw new StepUpMismatch();
}

/**
 * The action that revokes one of the person's staff sessions: its handle as the target, in lower case, the one spelling
 * the API accepts for a step-up target (it hashes the id exactly as sent), and no params.
 */
export function sessionRevokeAction(handle: string): StaffStepUpOptionsRequest {
  return StaffStepUpOptionsRequest.parse({ action: "staff_session_revoked", target: { type: "staff_session", id: handle.toLowerCase() }, params: {} });
}

/**
 * The action that reveals who sent an item: the item's id as the target and, as params, the reason's category and the
 * digest of the reason the person saved. The console builds it from what it shows, with the contracts' schema, so the
 * binding it checks before it asks the key is its own.
 */
export function revealAction(itemId: string, params: IdentityRevealedParams): StaffStepUpOptionsRequest {
  return StaffStepUpOptionsRequest.parse({ action: "identity_revealed", target: { type: "intake_item", id: itemId }, params });
}

/**
 * One action confirmed by the key (3c design, section 8): the session's handle read from a marked /me right before,
 * since the API binds the challenge to the session the request's cookie names, which another tab's sign-in may have
 * replaced since the page read its session; then options for exactly this action, asked right before the key (the API
 * reads a step-up challenge only while more than a minute of its ten is left), checked against what the page chose,
 * signed, and handed to `send`, which sends the action's own request with the assertion. The only place the console asks
 * a key to confirm anything: the revocation of a session, a decision, a review and a reveal all go through it. Every
 * request is marked: the person clicked.
 */
export async function confirmWithKey<T>(deps: { api: StaffApi; credentials: CredentialsLike }, action: StaffStepUpOptionsRequest, send: (stepUp: AuthenticationResponseJSON) => Promise<T>): Promise<T> {
  const { sessionHandle } = await deps.api.me({ activity: true });
  const { options } = await deps.api.stepUpOptions(action, { activity: true });
  await checkStepUpOptions(options, sessionHandle, action);
  let credential: unknown;
  try {
    credential = await deps.credentials.get({ publicKey: requestOptionsFromJSON(options) });
  } catch (err) {
    throw ceremonyFailure(err);
  }
  return send(authenticationResponseToJSON(credential));
}

/** "Sign out that session", confirmed by the key. "gone" when the session had already ended. */
export async function revokeSessionWithKey(deps: { api: StaffApi; credentials: CredentialsLike }, targetHandle: string): Promise<"revoked" | "gone"> {
  const action = sessionRevokeAction(targetHandle);
  return confirmWithKey(deps, action, async (stepUp): Promise<"revoked" | "gone"> => {
    try {
      await deps.api.revokeSession(action.target.id, { stepUp }, { activity: true });
      return "revoked";
    } catch (err) {
      // The API answers a handle that names no live session of the person's as the app does: 404.
      if (err instanceof ApiError && err.status === 404 && err.code === "not_found") return "gone";
      throw err;
    }
  });
}

/**
 * "Reveal who sent this", confirmed by the key: the reveal of the item with the category and the digest of the saved
 * reason. Answers the reporter's handle or the notifier's given name; both are null when the name was forgotten.
 */
export function revealWithKey(deps: { api: StaffApi; credentials: CredentialsLike }, itemId: string, params: IdentityRevealedParams) {
  const action = revealAction(itemId, params);
  return confirmWithKey(deps, action, (stepUp) => deps.api.reveal(action.target.id, { ...params, stepUp }, { activity: true }));
}
```

### Replace `apps/admin/src/store.ts` (whole file)

```ts
import type { StaffMe } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { createIdleTimer, type Clock, type IdleWarning } from "./idle";
import { messageFor } from "./messages";
import { caseHref, parseRoute, type CaseId, type ConsolePath, type Route } from "./router";

/**
 * The console's state across its screens (3a design, section 9): the address, the session the page holds, and the idle
 * timer's warning. Screens read it through React's useSyncExternalStore and keep their own lists to themselves.
 *
 * Any staff_session_required answer, from any request, the idle timer's reads included, means the API has already
 * cleared both staff cookies: the page then shows sign-in in place, keeping the address, and after the sign-in it shows
 * that address's page again. A GET /api/staff/me that answers 404 means the console is off on this server or was opened
 * at an address other than CONSOLE_ORIGIN (the staff gate answers both the same), and the page says only that.
 */
export type Session =
  | { kind: "checking" }
  | { kind: "signed-in"; me: StaffMe }
  /** Sign-in shows; `ended` when a staff_session_required answer told of a session that ended, which the page says. */
  | { kind: "signed-out"; ended: boolean }
  | { kind: "unavailable" }
  | { kind: "failed"; message: string };

export interface ConsoleState {
  path: string;
  route: Route;
  session: Session;
  warning: IdleWarning | null;
}

/** The part of window.history the store writes. */
export interface HistoryLike {
  pushState(data: unknown, unused: string, url: string): void;
  replaceState(data: unknown, unused: string, url: string): void;
}

export interface ConsoleStoreDeps {
  api: StaffApi;
  history: HistoryLike;
  clock: Clock;
  /** The address the page opened at. */
  path: string;
}

export type ConsoleStore = ReturnType<typeof createConsoleStore>;

export function createConsoleStore(deps: ConsoleStoreDeps) {
  const { api } = deps;
  let state: ConsoleState = { path: deps.path, route: parseRoute(deps.path), session: { kind: "checking" }, warning: null };
  const listeners = new Set<() => void>();

  const set = (next: Partial<ConsoleState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const idle = createIdleTimer({
    clock: deps.clock,
    // The timer's reads carry no mark: they are the page's own, never its person's.
    readMe: () => api.me({ activity: false }),
    onWarning: (warning) => set({ warning }),
    onMe: (me) => {
      if (state.session.kind === "signed-in") set({ session: { kind: "signed-in", me } });
    },
  });

  const go = (path: string, how: "push" | "replace") => {
    if (how === "push") deps.history.pushState(null, "", path);
    else deps.history.replaceState(null, "", path);
    set({ path, route: parseRoute(path) });
  };

  const sessionEnded = (carriedStaffCookie: boolean) => {
    // The page says the session ended when it held one, or when the refused request carried the staff CSRF cookie, which
    // only a sign-in sets: a reload or a new tab after an idle-out. Without either, there was no session to end (never
    // signed in, signed out, or the cookie's 12 hours over), and the page shows plain sign-in.
    const ended = state.session.kind === "signed-in" || carriedStaffCookie || (state.session.kind === "signed-out" && state.session.ended);
    idle.stop();
    set({ session: { kind: "signed-out", ended }, warning: null });
  };

  api.hooks.onSessionRequired = sessionEnded;
  api.hooks.onActivity = () => {
    if (state.session.kind === "signed-in") idle.restart();
  };
  // Any screen's /me read, the step-up's included, keeps the page's session as the cookie names it now.
  api.hooks.onMe = (me) => {
    if (state.session.kind === "signed-in") set({ session: { kind: "signed-in", me } });
  };

  const signedIn = (me: StaffMe) => {
    set({ session: { kind: "signed-in", me }, warning: null });
    idle.start(me);
    // Sign-in in place keeps the address; only the sign-in page and an enrolment link move on, to the home page.
    if (state.route.name === "signin" || state.route.name === "enroll") go("/", "replace");
  };

  const unavailable = () => {
    idle.stop();
    set({ session: { kind: "unavailable" }, warning: null });
  };

  return {
    api,
    get: (): ConsoleState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Opens the page: an enrolment link needs no session and reads none; every other page reads /me, marked, since
     * opening a page is its person's action.
     */
    async start(): Promise<void> {
      if (state.route.name === "enroll") {
        set({ session: { kind: "signed-out", ended: false } });
        return;
      }
      set({ session: { kind: "checking" } });
      try {
        signedIn(await api.me({ activity: true }));
      } catch (err) {
        if (err instanceof ApiError && err.code === "staff_session_required") return; // the hook showed sign-in
        if (err instanceof ApiError && err.status === 404) return unavailable();
        set({ session: { kind: "failed", message: err instanceof ApiError ? err.message : messageFor("internal") } });
      }
    },

    /** A link inside the console: a new history entry, and the page for it. */
    navigate: (path: ConsolePath) => go(path, "push"),

    /** A link to a case: its address is built from a checked id, and from nothing else. */
    openCase: (id: CaseId) => go(caseHref(id), "push"),

    /** The browser went back or forward. Back to the sign-in page with a live session is home. */
    popped(path: string) {
      set({ path, route: parseRoute(path) });
      if (state.session.kind === "signed-in" && state.route.name === "signin") go("/", "replace");
    },

    signedIn,

    /** The person signed out: the timer stops and the sign-in page shows, at its own address. */
    signedOut() {
      idle.stop();
      set({ session: { kind: "signed-out", ended: false }, warning: null });
      go("/signin", "push");
    },

    unavailable,

    /** "Stay signed in": one marked GET /me. Its success restarts the timer through the activity hook. */
    async stay(): Promise<void> {
      try {
        const me = await api.me({ activity: true });
        if (state.session.kind === "signed-in") set({ session: { kind: "signed-in", me } });
      } catch {
        // A 401 has shown sign-in; anything else leaves the warning up, and the timer's own read decides.
      }
    },

    dispose() {
      idle.stop();
      listeners.clear();
    },
  };
}
```

### Replace `apps/api/src/auth/flows/notifiers.ts` (whole file)

```ts
import { RETENTION } from "@korbat/contracts";
import { MailRefused, type MailMessage } from "../../mail/mailer";
import type { AuthDeps } from "../context";
import { decrypt, encrypt, randomToken, safeEqual } from "../crypto";
import { emailHash } from "../identifiers";
import { HOUR } from "../limits";
import { noticeTime } from "./notify";

/**
 * The auth module's side of reports and notices (3c design, section 5): a signed-out notifier's name and address, which
 * live here, encrypted, where the API's role cannot reach them, and every mail of the moderation module, which never
 * sees an address or a mail token. The moderation module names a contact by an id it chose, names an account by its id,
 * and passes typed messages: no caller passes free text, and this module builds every link itself.
 */

const DAY = 24 * HOUR;

/** An address that is not confirmed gets at most one receipt in this long; further ones are folded into the next daily mail. */
export const RECEIPT_CAP_MS = DAY;

/** The receipt of a report or a notice: its reference, when it was received, and the korbat links it named, in the order named. */
export interface NoticeReceivedMessage {
  template: "notice_received";
  ref: string;
  receivedAt: Date;
  items: readonly string[];
}

/** What may be sent to a signed-out notifier's contact, and to an account that reported. Each gains its other mails with the dispatch job. */
export type NotifierMessage = NoticeReceivedMessage;
export type AccountMessage = NoticeReceivedMessage;

/**
 * The staff alerts: counts, times and a staff account's public handle, never a link or content. The urgent lane's alert;
 * the staff account that reached its daily case limit; and every reveal of who sent a report, with the day's count.
 */
export type StaffMessage =
  | { template: "moderation_urgent"; count: number; oldest: Date }
  | { template: "moderation_reads"; handle: string; limit: number }
  | { template: "moderation_reveal"; handle: string; at: Date; count: number; limit: number };

/** A staff alert's template data: every member as the text the template prints. */
function staffData(message: StaffMessage): Record<string, string> {
  switch (message.template) {
    case "moderation_urgent":
      return { count: String(message.count), oldest: noticeTime(message.oldest) };
    case "moderation_reads":
      return { handle: message.handle, limit: String(message.limit) };
    case "moderation_reveal":
      return { handle: message.handle, time: noticeTime(message.at), count: String(message.count), limit: String(message.limit) };
  }
}

export type NotifierMailResult = "sent" | "folded" | "suppressed" | "no_address" | "forgotten" | "refused";
export type AccountMailResult = "sent" | "suppressed" | "no_address" | "refused";

/** What staff may know of a signed-out notifier without a reveal: never the name or the address themselves. */
export interface NotifierFacts {
  /** False for an id no contact has: it was never stored, or the janitor has forgotten it. Then the other four are false too. */
  found: boolean;
  named: boolean;
  contactGiven: boolean;
  confirmed: boolean;
  suppressed: boolean;
}

/** A contact's ciphertexts open under the key, or under a key it replaced. Nothing read is ever written back under the newer key. */
const open = (deps: AuthDeps, payload: string): string => decrypt(payload, [deps.config.notifierKey, ...deps.config.notifierPreviousKeys]).toString("utf8");
const seal = (deps: AuthDeps, plain: string): string => encrypt(Buffer.from(plain, "utf8"), deps.config.notifierKey);

/** The same day `months` calendar months later in UTC; a day the target month lacks becomes that month's last day. */
function monthsLater(at: Date, months: number): Date {
  const month = at.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(at.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(at.getUTCFullYear(), month, Math.min(at.getUTCDate(), lastDay), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds()));
}

/** The cap's marker for an address, by its keyed hash: set when a receipt goes to it unconfirmed, gone a day later. */
const receiptCapKey = (hash: string) => `notifier-receipt:${hash}`;

/** The receipt's template data. The page link is this module's: the status page's address with the contact's mail token in the fragment, which no server log sees. */
function receiptData(deps: AuthDeps, message: NoticeReceivedMessage, pageUrl?: string): Record<string, string> {
  return {
    ref: message.ref,
    time: noticeTime(message.receivedAt),
    items: message.items.join(", "),
    ...(pageUrl === undefined ? {} : { pageUrl }),
    termsUrl: `${deps.config.appOrigin}/terms`,
  };
}

/** Sends one mail. "refused" when the relay refused the recipient for good; any other failure is thrown, for the caller to try again. */
async function deliver(deps: AuthDeps, message: MailMessage): Promise<"sent" | "refused"> {
  try {
    await deps.mailer.send(message);
    return "sent";
  } catch (err) {
    if (err instanceof MailRefused) return "refused";
    throw err;
  }
}

/**
 * Stores a signed-out notifier's contact under the id the moderation module wrote on the notice: the name and the
 * address normalised and encrypted under the notifier key, the address's keyed hash for the cap and for stops, and, with
 * an address, a fresh mail token encrypted beside it. A disposable address is taken: a notifier may want one. The contact
 * is forgotten 13 months on unless the notice is still owed something by then.
 */
export async function storeNotifierContact(deps: AuthDeps, contactId: string, contact: { name?: string; email?: string }): Promise<void> {
  const name = contact.name?.trim() || null;
  const email = contact.email?.trim().toLowerCase() || null;
  await deps.repo.createNotifierContact({
    id: contactId,
    nameEnc: name === null ? null : seal(deps, name),
    emailEnc: email === null ? null : seal(deps, email),
    emailHash: email === null ? null : emailHash(deps.config.authHmacKey, email),
    // The token of the mails' link: it alone confirms or stops the address, so whoever typed someone else's address cannot.
    mailTokenEnc: email === null ? null : seal(deps, randomToken()),
    forgetAfter: monthsLater(deps.now(), RETENTION.contactMaxMonths),
  });
}

/**
 * Sends a signed-out notifier's receipt, under three rules. A stopped address gets nothing ("suppressed"). An address
 * that is not confirmed gets one receipt in 24 hours, and a further one is "folded": it rides in the next daily mail, so
 * typing someone's address into the form many times sends them one mail. A confirmed address has no cap. "forgotten"
 * when no contact has the id, "no_address" when the contact left none. A failure of the relay that is not about the
 * address is thrown, and gives the day's one receipt back first, so the retry is sent rather than folded.
 */
export async function mailNotifier(deps: AuthDeps, contactId: string, message: NotifierMessage): Promise<NotifierMailResult> {
  const contact = await deps.repo.findNotifierContact(contactId);
  if (!contact) return "forgotten";
  if (!contact.emailEnc || !contact.emailHash || !contact.mailTokenEnc) return "no_address";
  const hash = contact.emailHash;
  if ((await deps.repo.suppressedNotifierHashes([hash])).has(hash)) return "suppressed";
  // Opened before the cap is taken: a ciphertext no configured key opens throws here and spends nothing.
  const to = open(deps, contact.emailEnc);
  const pageUrl = `${deps.config.appOrigin}/notice/${message.ref}#t=${open(deps, contact.mailTokenEnc)}`;
  const confirmed = (await deps.repo.confirmedNotifierHashes([hash], deps.now())).has(hash);
  if (!confirmed && !(await deps.kv.setIfAbsent(receiptCapKey(hash), "1", RECEIPT_CAP_MS))) return "folded";
  try {
    return await deliver(deps, { to, template: "notice_received", data: receiptData(deps, message, pageUrl) });
  } catch (err) {
    if (!confirmed) await deps.kv.del(receiptCapKey(hash)).catch((failure: unknown) => deps.log.warn({ err: failure }, "notifier receipt: the day's one receipt could not be given back after a failed send"));
    throw err;
  }
}

/**
 * Sends a report mail to an account's own address, which its sign-in code confirmed: no cap and no confirmation. A stop
 * of that address applies to the report mails. "no_address" for an account that is deleted or was never there.
 */
export async function mailAccount(deps: AuthDeps, userId: string, message: AccountMessage): Promise<AccountMailResult> {
  const user = await deps.repo.findUserById(userId);
  if (!user) return "no_address";
  const hash = emailHash(deps.config.authHmacKey, user.email);
  // Only the mails about a report honour a stop: a statement of reasons to an author is never one of them.
  if (message.template === "notice_received" && (await deps.repo.suppressedNotifierHashes([hash])).has(hash)) return "suppressed";
  return deliver(deps, { to: user.email, template: "notice_received", data: receiptData(deps, message) });
}

/**
 * Sends a staff alert to every live staff account's address, best effort: a failed send is logged and never thrown, and
 * the answer is the number of addresses the relay took, 0 when it took none or there is no live staff account. It
 * applies no throttle: the moderation module keeps every throttle, as a key in the shared limit store.
 */
export async function mailStaff(deps: AuthDeps, message: StaffMessage): Promise<number> {
  const data = staffData(message);
  let addresses: string[];
  try {
    addresses = await deps.repo.liveStaffAddresses();
  } catch (err) {
    deps.log.error({ err, template: message.template }, "staff alert: the staff accounts could not be read");
    return 0;
  }
  let accepted = 0;
  for (const to of addresses) {
    try {
      await deps.mailer.send({ to, template: message.template, data });
      accepted++;
    } catch (err) {
      deps.log.error({ err, template: message.template }, "staff alert email failed");
    }
  }
  return accepted;
}

/** For each id: whether a contact has it, whether a name and an address were given, and whether the address is confirmed or stopped now. */
export async function notifierFacts(deps: AuthDeps, contactIds: readonly string[]): Promise<Map<string, NotifierFacts>> {
  const rows = await deps.repo.notifierContactFacts(contactIds);
  const hashes = rows.flatMap((row) => (row.emailHash === null ? [] : [row.emailHash]));
  const [confirmed, suppressed] = await Promise.all([deps.repo.confirmedNotifierHashes(hashes, deps.now()), deps.repo.suppressedNotifierHashes(hashes)]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return new Map(
    contactIds.map((id): [string, NotifierFacts] => {
      const row = byId.get(id);
      if (!row) return [id, { found: false, named: false, contactGiven: false, confirmed: false, suppressed: false }];
      return [id, { found: true, named: row.named, contactGiven: row.contactGiven, confirmed: row.emailHash !== null && confirmed.has(row.emailHash), suppressed: row.emailHash !== null && suppressed.has(row.emailHash) }];
    }),
  );
}

/** The name a notifier gave, or null: for a confirmed reveal only. The address is never handed out. */
export async function notifierName(deps: AuthDeps, contactId: string): Promise<string | null> {
  const contact = await deps.repo.findNotifierContact(contactId);
  return contact?.nameEnc ? open(deps, contact.nameEnc) : null;
}

/** The contact's address hash when the token is its mail token, compared in constant time; null for anything else. */
async function addressOfToken(deps: AuthDeps, contactId: string, token: string): Promise<string | null> {
  const contact = await deps.repo.findNotifierContact(contactId);
  if (!contact?.mailTokenEnc || !contact.emailHash) return null;
  let mailToken: string;
  try {
    mailToken = open(deps, contact.mailTokenEnc);
  } catch (err) {
    // A contact no configured key opens matches nothing; the fault is the operator's to see, with the contact's id and no address.
    deps.log.error({ err, contactId }, "notifier contact: its mail token could not be decrypted");
    return null;
  }
  return safeEqual(mailToken, token) ? contact.emailHash : null;
}

/** Whether the token is the contact's mail token; false when the contact has none. */
export async function notifierMailTokenMatches(deps: AuthDeps, contactId: string, token: string): Promise<boolean> {
  return (await addressOfToken(deps, contactId, token)) !== null;
}

/**
 * "I sent this": with the contact's mail token, records the address as confirmed for 30 days and lifts any stop of it.
 * False, and nothing done, for any other token: typing someone's address proves nothing about it.
 */
export async function confirmNotifier(deps: AuthDeps, contactId: string, token: string): Promise<boolean> {
  const hash = await addressOfToken(deps, contactId, token);
  if (hash === null) return false;
  const now = deps.now();
  await deps.repo.confirmNotifierAddress(hash, now, new Date(now.getTime() + RETENTION.confirmationDays * DAY));
  return true;
}

/** "Stop": with the contact's mail token, korbat sends this address no more mails about reports. Its notices are still processed. */
export async function stopNotifier(deps: AuthDeps, contactId: string, token: string): Promise<boolean> {
  const hash = await addressOfToken(deps, contactId, token);
  if (hash === null) return false;
  await deps.repo.suppressNotifierAddress(hash);
  return true;
}

/** Whether the account's address asked korbat to stop its report mails. */
export async function accountReportMailStopped(deps: AuthDeps, userId: string): Promise<boolean> {
  const user = await deps.repo.findUserById(userId);
  if (!user) return false;
  const hash = emailHash(deps.config.authHmacKey, user.email);
  return (await deps.repo.suppressedNotifierHashes([hash])).has(hash);
}

/** Lifts a stop of the account's address, for the account's own Settings: the session proves the address. True when there was one. */
export async function resumeAccountReportMail(deps: AuthDeps, userId: string): Promise<boolean> {
  const user = await deps.repo.findUserById(userId);
  if (!user) return false;
  return deps.repo.liftNotifierSuppression(emailHash(deps.config.authHmacKey, user.email));
}

/** Moves the day these contacts are forgotten. */
export function forgetNotifierAfter(deps: AuthDeps, contactIds: readonly string[], at: Date): Promise<void> {
  return deps.repo.setNotifierForgetAfter(contactIds, at);
}

/** The contacts that gave this address, with the names they gave: for an access request from a signed-out notifier, from the command line only. */
export async function findNotifierContacts(deps: AuthDeps, email: string): Promise<{ id: string; name: string | null }[]> {
  const rows = await deps.repo.notifierContactsByEmailHash(emailHash(deps.config.authHmacKey, email));
  return rows.map((row) => ({ id: row.id, name: row.nameEnc ? open(deps, row.nameEnc) : null }));
}

/** How many contacts and confirmations the janitor should have removed more than a day ago: a count only, for the console's overview. */
export function overdueContacts(deps: AuthDeps): Promise<number> {
  return deps.repo.countNotifierRowsDue(new Date(deps.now().getTime() - DAY));
}
```

### Replace `apps/api/src/mail/mailer.ts` (whole file)

```ts
export type TemplateName =
  | "sign_in_code"
  | "sign_up_code"
  | "reauth_code"
  | "new_device"
  | "account_locked"
  | "mfa_enabled"
  | "mfa_disabled"
  | "password_changed"
  | "recovery_codes_regenerated"
  | "sessions_revoked_all"
  | "email_change_code"
  | "email_changed"
  | "email_change_reverted"
  | "badge_verified"
  | "badge_removed"
  | "delete_account_code"
  | "account_deleted"
  | "passkey_added"
  | "passkey_removed"
  | "passkey_suspect"
  | "recovery_code_used"
  // The staff console's mails (3a design, section 7): to the staff account's own address, and never with a link.
  | "staff_key_added"
  | "staff_session_started"
  | "staff_key_suspect"
  | "staff_keys_revoked"
  // Moderation (3c design, section 7.15): the receipt of a report or a notice, and the staff alerts for the urgent lane,
  // for a staff account that reached its daily case limit and for every reveal of who sent a report.
  | "notice_received"
  | "moderation_urgent"
  | "moderation_reads"
  | "moderation_reveal";

export interface MailMessage {
  to: string;
  template: TemplateName;
  data: Record<string, string>;
}

export interface Mailer {
  /**
   * Throws MailUnavailable when the message could not be handed to the relay, and its subclass MailRefused when the
   * relay answered that the recipient's address itself is bad, which no later try changes.
   */
  send(message: MailMessage): Promise<void>;
}

export class MailUnavailable extends Error {}

/**
 * The relay refused the recipient for good: no such mailbox or destination, a malformed address, a mailbox that moved or
 * a domain that takes no mail. A subclass of MailUnavailable, so a caller that does not tell the two apart behaves as
 * before; one that does records the mail as failed instead of trying again (3c design, section 5).
 */
export class MailRefused extends MailUnavailable {}
```

### Replace `apps/api/src/mail/templates.ts` (whole file)

```ts
import type { TemplateName } from "./mailer";

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

function need(data: Record<string, string>, key: string): string {
  const value = data[key];
  if (value === undefined || value === "") throw new Error(`mail template data is missing "${key}"`);
  return value;
}

/** Plain paragraphs only: no images, no tracking, no anchor tags. URLs appear as text. */
function build(subject: string, paragraphs: string[]): RenderedMail {
  return {
    subject,
    text: `${paragraphs.join("\n\n")}\n`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">${paragraphs
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join("")}</body></html>`,
  };
}

export function renderTemplate(template: TemplateName, data: Record<string, string>): RenderedMail {
  switch (template) {
    case "sign_in_code":
      return build("Your korbat sign-in code", [
        `Your sign-in code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to sign in, you can ignore this email; nobody can sign in without the code.",
      ]);
    case "sign_up_code":
      return build("Your korbat sign-up code", [
        `Your sign-up code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to create a korbat account, you can ignore this email.",
      ]);
    case "reauth_code":
      return build("Confirm it's you on korbat", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. korbat asks for it before sensitive account changes.",
      ]);
    case "new_device":
      // The link runs the lockdown anchored at this sign-in (1c design, section 7.6): it reaches back a day, so a
      // passkey or two-factor set up just before, from the same stolen session, goes with it.
      return build("New sign-in to your korbat account", [
        `Your account was just signed in from a new device: ${need(data, "deviceLabel")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 24 hours. It signs out every session, removes your password, and turns off every passkey and two-factor authentication set up since the day before this sign-in; then you sign in with a code sent to this address: ${need(data, "notMeUrl")}`,
      ]);
    case "account_locked":
      return build("Password sign-in paused on your korbat account", [
        `After several wrong passwords, password sign-in is paused for ${need(data, "minutes")} minutes.`,
        "You can still sign in with an emailed code. If you did not try to sign in, consider turning on two-factor authentication.",
      ]);
    case "mfa_enabled":
      return build("Two-factor authentication is on for your korbat account", [
        "Two-factor authentication was just turned on for your korbat account, and a new set of recovery codes was issued.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "mfa_disabled":
      return build("Two-factor authentication is off for your korbat account", [
        "Two-factor authentication was just turned off for your korbat account.",
        "If this was you, there is nothing to do. If not, sign in, open Security, turn it back on and sign out everywhere.",
      ]);
    case "password_changed":
      return build("Your korbat password changed", [
        "The password of your korbat account was just set or changed.",
        "If this was you, there is nothing to do. If not, sign in with an emailed code, open Security, set a new password and sign out everywhere.",
      ]);
    case "recovery_codes_regenerated":
      return build("New recovery codes for your korbat account", [
        "A new set of recovery codes was just issued for your korbat account. The old codes no longer work.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "sessions_revoked_all":
      return build("Signed out everywhere on korbat", [
        `Every session of your korbat account was just signed out (${need(data, "count")} in total).`,
        "If this was you, there is nothing to do. If not, sign in and set a new password.",
      ]);
    case "email_change_code":
      return build("Confirm your new korbat email address", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not ask to move a korbat account to this address, you can ignore this email; nothing changes without the code.",
      ]);
    case "email_changed":
      // The undo link goes with the first change in a day only (flows/email-change.ts); a later change in that day
      // says where the link that works went, because signing in here is no longer possible.
      return build("Your korbat email address changed", [
        `The email address of your korbat account was just changed to ${need(data, "email")}. This address no longer belongs to the account.`,
        "Every session stays signed in. If this was you, there is nothing to do.",
        data.revertUrl
          ? `If this was not you, open this link within 24 hours. It moves the account back to this address, signs out every session, removes the password, and turns off every passkey and two-factor authentication set up since the day before the change; then you sign in with a code sent to this address: ${data.revertUrl}`
          : "If this was not you: the address had already changed less than a day ago, and the link sent then, to the address the account had before, can still move the account back there and sign out every session.",
      ]);
    case "email_change_reverted":
      return build("Your korbat account is back at this address", [
        "Your korbat account is back at this address, moved back from the link sent when its address changed, and every session was signed out.",
        "Sign in with a code sent to this address. The password was removed, and every passkey and two-factor authentication set up since the day before the change was turned off; set them up again from Security.",
      ]);
    case "badge_verified":
      return build("Your korbat account is verified", [
        "Your phone number was just confirmed, and your korbat account now shows the verified badge.",
        "korbat keeps only a keyed hash of the number, never the number itself. If this was not you, sign in, open Account, and remove the badge.",
      ]);
    case "badge_removed":
      return build("The verified badge was removed from your korbat account", [
        "The verified badge was just removed from your korbat account, and the phone number behind it was forgotten.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "delete_account_code":
      return build("Confirm deleting your korbat account", [
        `Someone asked to delete your korbat account. The confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. Deleting the account removes your posts, images and profile for good; nothing happens without the code.",
        "If this was not you, do not enter the code: sign in, open Security, and revoke your other sessions.",
      ]);
    case "account_deleted":
      return build("Your korbat account was deleted", [
        "Your korbat account was deleted as you asked. Your posts, images and profile are gone, and your handle stays reserved so nobody can take it.",
        "This cannot be undone. Thank you for having been part of korbat; you are welcome back with a new account any time.",
      ]);
    case "passkey_added":
      // The link runs the lockdown anchored at the passkey's creation (1c design, section 7.6): it reaches back a day,
      // so a password or two-factor set up just before the passkey, from the same stolen session, goes with it.
      return build("A passkey was added to your korbat account", [
        `A passkey named "${need(data, "name")}" was added to your korbat account from ${need(data, "deviceLabel")} at ${need(data, "time")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 7 days. It removes this passkey, signs out every session, removes your password, and turns off every passkey and two-factor authentication set up since the day before this one was added; then you sign in with a code sent to this address: ${need(data, "removeUrl")}`,
      ]);
    case "passkey_removed":
      return build("A passkey was removed from your korbat account", [
        `The passkey named "${need(data, "name")}" was removed from your korbat account at ${need(data, "time")}. It can no longer sign in.`,
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your passkeys, sessions and devices.",
      ]);
    case "passkey_suspect":
      // A counter that went backwards (1c design, section 2): the signature was right, so someone holds the key, and
      // either the authenticator was cloned or a backup was restored. Only the owner can tell, so the key stays off.
      return build("A passkey on your korbat account was switched off", [
        `A sign-in just used what looks like a copy of your passkey named "${need(data, "name")}", so korbat switched that passkey off. It can no longer sign in.`,
        "Sign in with a code sent to this address, open Security, remove it and add a new one. If you did not try to sign in just now, also review your sessions and devices.",
      ]);
    case "recovery_code_used":
      // A code spent at re-authentication (1c design, section 7.2): each of the ten works once, so the owner should know the count is down.
      return build("A recovery code was used on your korbat account", [
        "A recovery code was just used to confirm it's you on your korbat account. Each code works once; set up two-factor authentication again from Security to get a new set.",
        "If this was not you, sign in, open Security, sign out everywhere and set up two-factor authentication again.",
      ]);
    case "staff_key_added":
      return staffMail("A staff key was added to your korbat staff account", [
        `A staff key named "${need(data, "name")}" was registered for your korbat staff account at ${need(data, "time")}. It can open the staff console.`,
        "If this was you, there is nothing to do. If not, tell the operator at once; they revoke the key with the staff command line.",
      ]);
    case "staff_session_started":
      return staffMail("A staff session started on the korbat console", [
        `A staff session was started on the korbat console at ${need(data, "time")} with your staff key "${need(data, "name")}", from ${need(data, "browser")}.`,
        "If this was you, there is nothing to do. If not, someone holds that key: tell the operator at once; they revoke it and every session it opened with the staff command line.",
      ]);
    case "staff_key_suspect":
      // A counter that went backwards on a staff key (3a design, section 7): never passkey_suspect, whose remedy is the
      // app's Security screen; only the operator can enrol a replacement.
      return staffMail("A staff key on your korbat staff account was switched off", [
        `A use of your staff key "${need(data, "name")}" on the korbat console (a sign-in or a confirmation) looked like a copy of it, so korbat switched that key off and ended every staff session it opened. It can no longer open the console.`,
        "Ask the operator for a link to register a new key. If you did not use it just now, tell them so: someone else holds a copy of the key.",
      ]);
    case "staff_keys_revoked":
      // `names` is the list of the revoked keys' names, each in quotes, as the sender joins them.
      return staffMail("Staff keys revoked on your korbat staff account", [
        `These staff keys of your korbat staff account were revoked at ${need(data, "time")}: ${need(data, "names")}. They can no longer open the console, and every staff session they opened has ended.`,
        "If you expected this, there is nothing to do. If not, ask the operator why.",
      ]);
    case "notice_received":
      // The receipt of a report or a notice (3c design, section 7.15). `items` is the list of korbat links the report
      // named, as the sender joins them: built from parsed ids, an account's from the handle as it was named. With
      // `pageUrl` it goes to a signed-out notifier's address, and the link's fragment holds that contact's mail token,
      // which no server log sees; without it, to an account, whose reports are in the app.
      return userMail(`korbat received your report ${need(data, "ref")}`, [
        `korbat received your report ${need(data, "ref")} at ${need(data, "time")}. It names: ${need(data, "items")}.`,
        "A moderator decides each item that names something on korbat; a link that names nothing is answered automatically. You get one email with every decision, at most once a day.",
        data.pageUrl
          ? `To see where your report stands, ask for a re-examination of a decision, confirm that you sent it, or stop korbat's emails about reports to this address, open this page: ${data.pageUrl}`
          : "You can follow it in korbat under Settings, Cases, Your reports.",
        `How korbat handles reports, and what it keeps: ${need(data, "termsUrl")}.`,
      ]);
    case "moderation_urgent": {
      // The alert for the urgent lane (3c design, section 7.12): counts and times only, to every staff account. A single
      // case is its own oldest, so its sentence gives one time and is worded for one.
      const lane = "in the urgent lane (child sexual abuse or exploitation, direct threats, violence, public security or self-harm)";
      return staffMail("korbat: a case is waiting in the urgent lane", [
        need(data, "count") === "1" ? `1 case ${lane} is waiting, since ${need(data, "oldest")}.` : `${need(data, "count")} cases ${lane} are waiting; the oldest since ${need(data, "oldest")}.`,
        "Open the staff console. Until the phone alerts of sub-project 3e, this email is the only alert.",
      ]);
    }
    case "moderation_reads": {
      // A staff account opened as many different cases today as one account may (3c design, section 7.3): every staff
      // account is told, the account itself included, since a stolen key reads at the speed of requests.
      const who = `@${need(data, "handle")}`;
      return staffMail("korbat: a staff account reached its daily case limit", [
        `The staff account ${who} opened ${need(data, "limit")} different cases today and cannot open others until midnight UTC.`,
        `Every staff account gets this email. If ${who} is your account and you did not open them, someone else holds your key: tell the operator at once.`,
        "If that was not expected, ask them. The operator raises the limit with staff.js limits.",
      ]);
    }
    case "moderation_reveal": {
      // Every reveal of who sent a report or a notice (3c design, section 7.3), to every staff account: a reveal cannot
      // be undone. It names the staff account, the time and the day's count, never the case or the person revealed.
      const who = `@${need(data, "handle")}`;
      return staffMail("korbat: a staff account revealed who sent a report", [
        `The staff account ${who} revealed who sent a report or notice at ${need(data, "time")}. That is ${need(data, "count")} of the ${need(data, "limit")} reveals one staff account may make today (UTC).`,
        `Every staff account gets this email. If ${who} is your account and you did not reveal it, someone else holds your key: tell the operator at once.`,
        "The staff console's home screen lists every reveal of the last 30 days with its case. If this one was not expected, ask them; if their key may be in someone else's hands, the operator revokes it with staff.js revoke.",
      ]);
    }
  }
}

/**
 * A moderation mail to a user: plain paragraphs as every mail, closed by the sentence that korbat's staff ask for
 * nothing by mail, so a message that asks for a password or a code, or for an answer, is known for a fake (3c design,
 * section 7.15).
 */
function userMail(subject: string, paragraphs: string[]): RenderedMail {
  return build(subject, [...paragraphs, "korbat staff never ask for your password or a code, and korbat does not read replies to this email."]);
}

/**
 * A staff mail: plain paragraphs as every mail, closed by the sentence that no staff mail carries a link, so a message
 * that does carry one is known for a fake (3a design, section 7).
 */
function staffMail(subject: string, paragraphs: string[]): RenderedMail {
  return build(subject, [...paragraphs, "korbat never puts a link in a staff email."]);
}
```

### Replace `apps/api/src/moderation/context.ts` (whole file)

```ts
import { ModerationErrorCode } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { AuthForModeration } from "../auth";
import type { Config } from "../config";
import type { MediaForCases } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";

/** The moderation codes plus the shared ones the module also raises. */
export type ModerationErrorKind = ModerationErrorCode | "not_found" | "invalid_request" | "onboarding_required" | "rate_limited" | "service_unavailable";
export type ModerationErrorStatus = 400 | 403 | 404 | 409 | 422 | 429 | 503;

/** What each code answers with over HTTP (3c design, section 10). */
const STATUS: Record<ModerationErrorKind, ModerationErrorStatus> = {
  notice_link_invalid: 422,
  notice_link_offsite: 422,
  human_check_failed: 403,
  staff_cannot_report: 403,
  notice_not_found: 404,
  already_reported: 409,
  case_changed: 409,
  case_closed: 409,
  staff_recused: 403,
  staff_target: 403,
  admin_required: 403,
  decision_cap: 429,
  profile_changed: 409,
  snapshot_mismatch: 409,
  snapshot_erased: 409,
  text_not_found: 409,
  invalid_decision: 422,
  text_invalid: 422,
  text_quotes_user: 422,
  image_refused: 404,
  reveal_refused: 422,
  not_found: 404,
  invalid_request: 400,
  onboarding_required: 403,
  rate_limited: 429,
  service_unavailable: 503,
};

// Those of the notice routes, and the first three after them, are written for the person reporting; the rest for staff,
// whose console words them again for the screen. A recusal's words never say whether the conflict concerns the case's
// subject or someone who reported. The human check's names no contact address: the API holds none, and the
// app words that code itself.
const MESSAGES: Record<ModerationErrorKind, string> = {
  notice_link_invalid: "That link does not name a post or a profile on korbat.",
  notice_link_offsite: "Only links to this korbat can be reported.",
  human_check_failed: "We could not verify that you are human. Try again.",
  staff_cannot_report: "A staff account does not send reports. Open a finding in the staff console instead.",
  notice_not_found: "No report matches that reference and link.",
  already_reported: "You already reported this; it is being looked at.",
  case_changed: "The case changed since it was opened. Open it again.",
  case_closed: "The case changed at that moment. Try again.",
  staff_recused: "You cannot act on this case: you, or an account close to you, are a party to it.",
  staff_target: "A final decision cannot restrict a staff account. Staff are disciplined by demotion.",
  admin_required: "Only an admin can take this decision.",
  decision_cap: "You have reached the limit on decisions for now. Try again later.",
  profile_changed: "The profile changed since the snapshot was taken. Take a fresh snapshot and decide again.",
  snapshot_mismatch: "The snapshot is not the one this case holds.",
  snapshot_erased: "The snapshot was erased. Take a fresh one and decide again.",
  text_not_found: "A text of this decision is not saved, or was used already. Save it again.",
  invalid_decision: "This decision cannot stand as it is.",
  text_invalid: "This text cannot be saved as it is: it is too long, holds a character that cannot be kept, or does not match its digest.",
  text_quotes_user: "This text quotes what someone wrote about this case. Describe it in your own words.",
  // One answer for every image that is not shown, whatever the reason: sealed, frozen, erased, or not of this case.
  image_refused: "That image is not shown.",
  reveal_refused: "Nobody can be revealed for this item.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  // The words requireSession answers with: a route with an optional session refuses such a session itself.
  onboarding_required: "Choose a handle to finish setting up your account.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
};

/** An expected failure of a moderation flow. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class ModerationError extends Error {
  constructor(
    readonly code: ModerationErrorKind,
    readonly status: ModerationErrorStatus = STATUS[code],
    message: string = MESSAGES[code],
    /** Set for rate_limited so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ModerationError";
  }
}

export function moderationErrorMessage(code: ModerationErrorKind): string {
  return MESSAGES[code];
}

/** Whether a message the database raised is one of the module's codes, which the triggers raise as their message. */
export function isModerationErrorCode(message: string): message is ModerationErrorCode {
  return ModerationErrorCode.safeParse(message).success;
}

/**
 * The work a request starts and does not wait for: the mails after a report or a notice (3c design, section 7.1, step
 * 5). The answer, which carries the reference and the token, must never wait for a relay. Every task's error is caught
 * and logged here, and the tasks are kept until they end, so that `settle` can wait for them all.
 */
export interface Background {
  start(task: () => Promise<void>): void;
  /** Resolves once every started task has ended, those started meanwhile included. */
  settle(): Promise<void>;
}

export function createBackground(log: Logger): Background {
  const running = new Set<Promise<void>>();
  return {
    start(task) {
      const run = (async () => {
        try {
          await task();
        } catch (err) {
          log.error({ err }, "moderation: a task started after a request failed");
        }
      })();
      running.add(run);
      void run.then(() => running.delete(run));
    },
    async settle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

export interface ModerationDeps {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's interface: the human check, a notifier's contact and every mail. The module never sees an address. */
  auth: AuthForModeration;
  /** The social module's interface: the locks on profile rows and the reads evidence is copied from. */
  social: SocialForModeration;
  /** The media module's interface: an intake's holds on image rows, which this module never names itself. */
  media: MediaForCases;
  /** The shared limit store: what one sender may send, and the throttles of the staff alerts. */
  limits: RateLimitStore;
  /** The tasks requests started and did not wait for. */
  background: Background;
  config: Config;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/moderation/index.ts` (whole file)

```ts
/**
 * The only file outside `src/moderation/` may import. Everything else in the module is private and the architecture test
 * fails the build if another file reaches into it.
 *
 * The moderation module (3c design, section 5) runs on the API's role and owns the moderation tables: intakes and their
 * items, cases, decisions and their ledger of measures, evidence snapshots and staff texts. It inserts rows; the database
 * checks them, derives every restriction from them and refuses at commit what cannot stand. It reaches the other modules
 * only through the interfaces they export, never names an image row (the media module locks and holds a case's images for
 * it), and never sees the auth schema: a notifier's name and address, and every mail, are the auth module's.
 */
import type { CaseView, FindingRequest, FindingResponse, MediaSize, QueuePage, StaffOverview, StaffSnapshotTaken, StaffTextSaveRequest, StaffTextSaved, StaffTextsResponse } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../auth";
import type { Config } from "../config";
import type { MediaForCases, StoredFile } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";
import { caseImage, openFinding, overview, queue, readCase, takeSnapshot } from "./cases";
import { createBackground, type ModerationDeps } from "./context";
import { decide, type DecideOutcome } from "./decide";
import { reveal, type RevealOutcome } from "./reveal";
import { moderationRoutes } from "./routes";
import { ownTexts, saveText } from "./texts";

export { ModerationError } from "./context";
export type { ModerationDeps, ModerationErrorKind } from "./context";
export type { DecideOutcome } from "./decide";
export type { RevealOutcome } from "./reveal";

/** What the staff module needs from this one: the console's operations on cases, which its routes run behind the staff gate. */
export interface ModerationForStaff {
  /**
   * Records the decision a step-up confirmed, in one transaction with its audit row. "ended" when the confirming account
   * or key no longer opens anything, "late" when the challenge's time ran out; neither writes anything.
   */
  decide(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<DecideOutcome>;
  /** What every staff member's home screen shows: counts, times, staff handles and cases. */
  overview(): Promise<StaffOverview>;
  /** A page of the queue: open cases by lane and age, after the cursor when one is given. */
  queue(cursor?: string): Promise<QueuePage>;
  /** The case as staff read it. The read is logged, and held to the day's limit on different cases; a recused person is refused. */
  caseView(session: ActiveStaffSession, caseId: string): Promise<CaseView>;
  /** An image of the case's own post, opened for staff and logged, or image_refused. The caller streams the file and closes it. */
  caseImage(session: ActiveStaffSession, caseId: string, mediaId: string, size: MediaSize): Promise<StoredFile>;
  /**
   * A fresh snapshot of the case's target when it differs from the newest; its id and digest, never content. Run again
   * when it gives way to a decision on the case, and refused as case_closed when it keeps having to.
   */
  takeSnapshot(session: ActiveStaffSession, caseId: string): Promise<StaffSnapshotTaken>;
  /** Opens a case, or joins the open one, on the moderator's own finding under a rule (its target resolved first), within the day's limit. */
  openFinding(session: ActiveStaffSession, request: FindingRequest): Promise<FindingResponse>;
  /** Saves a text on the case, as written or not at all. */
  saveText(session: ActiveStaffSession, caseId: string, request: StaffTextSaveRequest): Promise<StaffTextSaved>;
  /** The person's own drafts on the case, with their salts. */
  texts(session: ActiveStaffSession, caseId: string): Promise<StaffTextsResponse>;
  /**
   * Reveals who sent an item, once a step-up confirmed it: the access row and the audit row in one transaction, the
   * identity read only after the commit. "ended" and "late" as for a decision.
   */
  reveal(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<RevealOutcome>;
}

export interface CreateModerationOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's interface for moderation: auth.forModeration. */
  auth: AuthForModeration;
  /** The social module's interface for cases: socialForModeration(apiDb). */
  social: SocialForModeration;
  /** The media module's interface for cases: media.forCases. */
  media: MediaForCases;
  /** What one sender may send, and the throttles of the staff alerts, count in the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  config: Config;
  logger: Logger;
  now?: () => Date;
}

export function createModeration(options: CreateModerationOptions) {
  const deps: ModerationDeps = {
    apiDb: options.apiDb,
    auth: options.auth,
    social: options.social,
    media: options.media,
    limits: options.rateLimitStore,
    background: createBackground(options.logger),
    config: options.config,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forStaff: ModerationForStaff = {
    decide: (session, confirmed, ctx) => decide(deps, session, confirmed, ctx),
    overview: () => overview(deps),
    queue: (cursor) => queue(deps, cursor),
    caseView: (session, caseId) => readCase(deps, session, caseId),
    caseImage: (session, caseId, mediaId, size) => caseImage(deps, session, caseId, mediaId, size),
    takeSnapshot: (session, caseId) => takeSnapshot(deps, session, caseId),
    openFinding: (session, request) => openFinding(deps, session, request),
    saveText: (session, caseId, request) => saveText(deps, session, caseId, request),
    texts: (session, caseId) => ownTexts(deps, session, caseId),
    reveal: (session, confirmed, ctx) => reveal(deps, session, confirmed, ctx),
  };
  return {
    deps,
    /** The app's routes, mounted at /api: reports and notices, their status page and its contact buttons. */
    routes: moderationRoutes(deps),
    /** The interface the staff module uses. */
    forStaff,
    /**
     * Resolves once every task a request started and did not wait for has ended: the mails after a report, a notice, a
     * finding, a reveal or a refused case read. The tests await it; the server lets the tasks run.
     */
    settle: () => deps.background.settle(),
  };
}

export type Moderation = ReturnType<typeof createModeration>;
```

### Replace `apps/api/src/moderation/intake.ts` (whole file)

```ts
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CSAM_KEYWORDS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  NOTICE_LIMITS,
  laneFor,
  snapshotDigest,
  type ItemOutcome,
  type Lane,
  type NoticeContactRequest,
  type NoticeItemStatus,
  type NoticeRequest,
  type NoticeResponse,
  type NoticeStatus,
  type NoticeStatusRequest,
  type RuleId,
  type TdbCategory,
} from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { AccountMailResult, NotifierMailResult, Session } from "../auth";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import type { HoldPair } from "../media";
import type { CapturedPost, CapturedProfile } from "../social";
import { alertUrgentLane } from "./alerts";
import { ModerationError, type ModerationDeps } from "./context";
import { accountLink, parseLink, postLink } from "./links";
import {
  alreadyReported,
  insertIntake,
  insertItem,
  insertSnapshot,
  isSerializationFailure,
  latestSnapshot,
  noticeById,
  noticeByRef,
  noticeItems,
  openCase,
  recordReceipt,
  snapshotTime,
  targetKey,
  violatedUniqueConstraint,
  type NoticeItemRow,
  type ReceiptState,
} from "./repo";

/**
 * Taking in a report, a notice or a moderator's own finding (3c design, section 7.1): one intake, one item for each
 * target it names, each item in exactly one open case, and the first copy of each target as evidence. First the
 * transaction every intake runs (step 4); below it what a report or a notice passes before it and what follows its
 * commit (steps 1 to 3, 5 and 6), and the notifier's status page and contact (section 7.2).
 */

/** What an intake alleges and who sent it: the ground's columns of the intake's row. */
export interface IntakeGround {
  kind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  /** The signed-in reporter; never set on the path for child sexual abuse material, which records no sender. */
  reporterId: string | null;
  /** The staff account behind a finding. */
  findingBy: string | null;
  /** The id under which the auth module keeps a signed-out notifier's name and address. */
  contactId: string | null;
  ruleId: RuleId | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: TdbCategory;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  bonaFide: boolean;
}

/** A target that is live: a post by its id, or an account by its id with the handle it was named by. `position` is its place among the targets named, from 1. */
export type LiveTarget =
  | { type: "post"; id: string; position: number; mediaId?: string | null }
  | { type: "account"; id: string; position: number; namedHandle: string };

/** A target with nothing live: a link to a post that names no row or a deleted one, or a handle that names no account. It is stored as answered at once. */
export type DeadTarget = { type: "post"; id: string; position: number } | { type: "account"; position: number; namedHandle: string };

export interface IntakeRequest {
  ground: IntakeGround;
  live: readonly LiveTarget[];
  dead?: readonly DeadTarget[];
}

export interface RecordedItem {
  id: string;
  position: number;
  targetType: "post" | "account";
  targetId: string;
  /** Null for a target with nothing live. */
  caseId: string | null;
  seq: number | null;
  lane: Lane;
}

export interface IntakeRecorded {
  intakeId: string;
  /** The public reference: N- and ten base32 characters. */
  ref: string;
  /** The notice's token, for a signed-out notice and for every notice on the CSAM path: shown once, and stored only as its sha256. */
  token: string | null;
  /** Whether the intake's items are suspect: it is on the CSAM path, or a finding citing R2. */
  suspect: boolean;
  items: RecordedItem[];
}

/** How often the transaction is run again after a case closed under it, a deadlock or a lock timeout: in each nothing was written. */
const RETRIES = 3;
/** How often one transaction asks for a target's open case before it starts over. */
const CASE_READS = 3;
/**
 * The longest the intake waits for a lock. A case's row is held by a decision for as long as that decision's
 * transaction runs, which for a seal over thousands of images is seconds; an intake that waited longer starts over.
 */
const LOCK_TIMEOUT_MS = 10_000;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A fresh public reference: N- and ten base32 characters from 50 random bits. */
function newRef(): string {
  const bytes = randomBytes(7);
  // 48 bits and two more: 50 in all, which a JavaScript number holds exactly.
  const bits = bytes.readUIntBE(0, 6) * 4 + (bytes[6]! & 3);
  let ref = "";
  // 50 bits, five at a time from the top.
  for (let shift = 45; shift >= 0; shift -= 5) ref += BASE32[Math.floor(bits / 2 ** shift) % 32];
  return `N-${ref}`;
}

/** Whether an intake's items are suspect, as the attach trigger forces it: the CSAM path, or a finding citing R2. */
export const isSuspect = (ground: IntakeGround) => ground.csam || ground.ruleId === "R2";

/**
 * The live targets of a suspect intake with the items korbat adds: a post's card shows the images of the post it
 * quotes, so a report of child sexual abuse material about a post that quotes another is a report about both. Each
 * quoted post that the request does not name itself becomes a target of its own, at the position of the item it was
 * added for plus 10 (the lowest such position when several named posts quote it). One level only, as a card draws one
 * quote deep: an added target brings none of its own. Read outside any transaction; a post's quote never changes.
 */
export async function withAddedTargets(deps: Pick<ModerationDeps, "social">, live: readonly LiveTarget[]): Promise<LiveTarget[]> {
  const named = new Set(live.filter((target) => target.type === "post").map((target) => target.id));
  const added = new Map<string, number>();
  for (const target of live) {
    if (target.type !== "post" || target.position > 10) continue;
    const quoted = (await deps.social.postRef(target.id))?.quoteOfId;
    if (!quoted || named.has(quoted)) continue;
    added.set(quoted, Math.min(added.get(quoted) ?? target.position, target.position));
  }
  return [...live, ...[...added].map(([id, position]): LiveTarget => ({ type: "post", id, position: position + 10 }))];
}

/** Thrown inside the transaction to roll it back and run it again: the case a target was read into closed before the read found one. */
class StartOver extends Error {}

/** A case's targets in one order for every intake: by kind (posts before accounts, as the database orders the two) and then by id. */
const byTarget = (a: LiveTarget, b: LiveTarget) => (a.type !== b.type ? (a.type === "post" ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stores one intake in one transaction, which changes nothing unless it commits. In this order:
 *   1. a signed-in reporter's profile row, FOR KEY SHARE, refusing a missing or deleted account;
 *   2. the intake's row, with a fresh reference and, for a signed-out or CSAM notice, the hash of a fresh token;
 *   3. for each live target, in the targets' order: its open case (opened when there is none) and then its item, which
 *      the attach trigger numbers into the case, so every intake takes its cases in one order and two notices that name
 *      the same targets never deadlock; only then the captures, posts in id order, each under a share lock on its post,
 *      so none holds a post while it waits for a case;
 *   4. one hold through the media module for the whole intake: the image rows of every post target, and for a suspect
 *      item about an account every image row on the account's posts, locked by one statement in one id order, with each
 *      post's case's evidence hold on its images; then a snapshot for each case that holds none yet, or, for an account,
 *      whose newest one differs from the account now, a post's listing the images the hold answered;
 *   5. for each target with nothing live, an item with no case, answered at once.
 * It is run again, up to three times, when an item's case closed in between (the attach trigger says so), on a deadlock
 * and on a lock timeout; when the last run fails the same way the answer is case_closed. A signed-in reporter who already
 * has an item on the same ground in a target's open case is answered already_reported.
 */
export async function recordIntake(deps: ModerationDeps, request: IntakeRequest): Promise<IntakeRecorded> {
  const suspect = isSuspect(request.ground);
  const live = suspect ? await withAddedTargets(deps, request.live) : [...request.live];
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.apiDb.transaction((tx) => recordIn(deps, tx, { ...request, live }, suspect));
    } catch (err) {
      const constraint = violatedUniqueConstraint(err);
      if (constraint === "intake_items_reporter_once") throw new ModerationError("already_reported");
      // A reference another intake already has: one in 2^50 for each pair. The next run draws a new one.
      const startOver = err instanceof StartOver || isSerializationFailure(err) || isDeadlock(err) || isLockNotAvailable(err) || constraint === "intakes_ref_unique";
      if (!startOver) throw err;
      if (attempt >= RETRIES) throw new ModerationError("case_closed");
    }
  }
}

async function recordIn(deps: ModerationDeps, tx: DbTx, request: IntakeRequest, suspect: boolean): Promise<IntakeRecorded> {
  const { ground } = request;
  await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}::text, true)`);

  // 1.
  if (ground.reporterId !== null) await deps.social.lockAccounts(tx, [ground.reporterId], "key share", true);

  // 2. The token is stored only as its hash; the answer carries it once.
  const ref = newRef();
  const token = ground.channel === "signed_out" || ground.csam ? randomBytes(32).toString("base64url") : null;
  const intakeId = await insertIntake(tx, { ...ground, ref, lookupHash: token === null ? null : createHash("sha256").update(token).digest("hex") });
  const lane = laneFor({ ruleId: ground.ruleId, allegesIllegal: ground.allegesIllegal, csam: ground.csam, category: ground.category });

  // 3. First every case with its item, in the targets' order.
  const items: RecordedItem[] = [];
  const cases = new Map<LiveTarget, string>();
  for (const target of [...request.live].sort(byTarget)) {
    let caseId: string | null = null;
    for (let read = 0; read < CASE_READS && caseId === null; read++) caseId = await openCase(tx, target.type, target.id);
    // A live target's item is never stored without a case.
    if (caseId === null) throw new StartOver();
    cases.set(target, caseId);
    const item = await insertItem(tx, {
      intakeId,
      caseId,
      targetType: target.type,
      targetId: target.id,
      position: target.position,
      lane,
      mediaId: target.type === "post" ? (target.mediaId ?? null) : null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId: target.id, caseId, seq: item.seq, lane });
  }

  // Then the captures: every post in id order under a share lock, and every account's fields. The time is the
  // transaction's start, which the snapshots' trigger stamps.
  const takenAt = await snapshotTime(tx);
  const posts = new Map<string, CapturedPost>();
  const profiles = new Map<string, CapturedProfile>();
  for (const target of cases.keys()) {
    if (target.type === "post") {
      const post = await deps.social.capturePost(tx, target.id);
      if (!post) throw new Error("a post that an intake names has no row");
      posts.set(target.id, post);
    } else {
      const profile = await deps.social.captureProfile(tx, target.id);
      if (!profile) throw new Error("an account that an intake names has no row");
      profiles.set(target.id, profile);
    }
  }

  // 4. One hold for the whole intake, after every capture, so that no image row is locked before the last post is. Each
  // post's case holds the post's images as evidence, on every ground alike. A suspect item about an account reaches every
  // image on the account's posts: the freeze keeps those from the item's commit on, without a hold, and the pair only locks
  // them, so that a delete racing this intake waits and then reads the committed item.
  const pairs: HoldPair[] = [];
  for (const [target, caseId] of cases) if (target.type === "post") pairs.push({ caseId, postId: target.id });
  for (const target of cases.keys()) if (target.type === "account" && suspect) pairs.push({ ownerId: target.id });
  const held = await deps.media.hold(tx, pairs);

  // Then the snapshots, each post's with the images the hold answered for it.
  for (const [target, caseId] of cases) {
    const before = await latestSnapshot(tx, caseId);
    if (target.type === "post") {
      const post = posts.get(target.id)!;
      if (before !== null) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "post",
        targetId: target.id,
        authorHandle: post.authorHandle,
        postState: post.state,
        postCreatedAt: post.createdAt.toISOString(),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        body: post.body,
        // The images as the media module read them under their row locks, in position order; an erased image's alt text
        // is not copied. An empty list means that the post had none, or that they were gone before this intake.
        media: held.get(target.id) ?? [],
        displayName: null,
        bio: null,
        handle: null,
      });
    } else {
      const profile = profiles.get(target.id)!;
      if (before !== null && before.displayName === profile.displayName && before.bio === profile.bio && before.handle === profile.handle) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "account",
        targetId: target.id,
        authorHandle: profile.handle,
        postState: null,
        postCreatedAt: null,
        replyToId: null,
        quoteOfId: null,
        body: null,
        media: null,
        displayName: profile.displayName,
        bio: profile.bio,
        handle: profile.handle,
      });
    }
  }

  // 5. An account's link that names nothing gets an id that names nothing either, whether or not a profile holds or once
  // held the handle: no stored id ties an old handle to its account.
  for (const target of request.dead ?? []) {
    const targetId = target.type === "post" ? target.id : randomUUID();
    const item = await insertItem(tx, {
      intakeId,
      caseId: null,
      targetType: target.type,
      targetId,
      position: target.position,
      lane,
      mediaId: null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId, caseId: null, seq: null, lane });
  }
  items.sort((a, b) => a.position - b.position);
  return { intakeId, ref, token, suspect, items };
}

export type SnapshotContent = Omit<Parameters<typeof insertSnapshot>[1], "salt" | "digest">;

/**
 * One snapshot: a salt of the server's own, and the digest over the salt, the time and everything copied. The time in
 * the digest is the one the database stamps the row with; when the two differ the transaction is rolled back, since the
 * stored row would not recompute to its digest. Answers the snapshot's id and digest. The console's snapshot route
 * stores its snapshots through this too, so every snapshot is made one way.
 */
export async function storeSnapshot(tx: DbTx, takenAt: string, content: SnapshotContent): Promise<{ id: string; digest: string }> {
  const salt = randomBytes(32).toString("hex");
  const digest = await snapshotDigest({
    salt,
    targetType: content.targetType,
    targetId: content.targetId,
    takenAt,
    authorHandle: content.authorHandle,
    postState: content.postState,
    postCreatedAt: content.postCreatedAt,
    replyToId: content.replyToId,
    quoteOfId: content.quoteOfId,
    body: content.body,
    media: content.media,
    displayName: content.displayName,
    bio: content.bio,
    handle: content.handle,
  });
  const stored = await insertSnapshot(tx, { ...content, salt, digest });
  if (stored.takenAt !== takenAt) throw new Error("a snapshot was stamped at another time than its digest covers");
  return { id: stored.id, digest };
}

// ---------------------------------------------------------------- reports and notices: POST /api/notices

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** How often one network may read a notice's status or use its contact buttons in an hour; the two routes share the count. */
export const STATUS_READS_PER_HOUR = 30;

/** Who sends a report or a notice: the session of a signed-in sender, or none, and the keyed hash of the network the request came from. */
export interface NoticeSender {
  session: Pick<Session, "userId" | "role" | "onboarded"> | null;
  netHash: string;
}

/** A target as a report names it, once a link is parsed: a post by its id, or an account by a handle. */
export type NamedTarget = { type: "post"; id: string; mediaId: string | null } | { type: "account"; handle: string };

/**
 * Counts one event in a window of the shared limit store and refuses it once the window is used up. An event that
 * cannot be counted is refused too: the limits are what keeps one sender from flooding the queue.
 */
export async function countOrRefuse(deps: Pick<ModerationDeps, "limits">, key: string, windowMs: number, max: number): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(key, windowMs);
  } catch {
    throw new ModerationError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > max) throw new ModerationError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Which targets are live is one rule for every route (3c design, section 7.1, step 3), and it reads no image.
 *
 * For a suspect intake (a report of child sexual abuse material, or a finding citing R2) a target is live while its row
 * exists: a post in any state, one its author deleted or the purge blanked included, and an account whose profile row
 * exists, purged or not, also under a handle it has left, which the handle history keeps reserved for it. So no such
 * report about anything that exists is answered automatically: it waits for an admin, whatever is left of its target.
 *
 * For every other ground a post is live when it exists and its author has not deleted it, whatever its level, and an
 * account when a profile holds the named handle now and is not deleted: an old handle names nothing, and repeated
 * reports cannot keep content its author deleted, nor put deleted images before staff.
 *
 * Answers the target with its id, or null when it names nothing live.
 */
export async function liveTarget(deps: Pick<ModerationDeps, "social">, target: NamedTarget, suspect: boolean): Promise<{ type: "post" | "account"; id: string } | null> {
  if (target.type === "post") {
    const post = await deps.social.postRef(target.id);
    if (!post) return null;
    return suspect || post.state !== "deleted_by_author" ? { type: "post", id: target.id } : null;
  }
  const account = await deps.social.findAccountByHandle(target.handle, suspect);
  return account ? { type: "account", id: account.id } : null;
}

/** A notice's targets, resolved: the live ones and those with nothing live, numbered from 1 in the order the notice named them. */
export interface ResolvedTargets {
  live: LiveTarget[];
  dead: DeadTarget[];
}

/**
 * Resolves a notice's targets, outside any transaction (3c design, section 7.1, step 3):
 *   - a link is parsed into the post or the account it names, or refused;
 *   - a notice on the path for child sexual abuse material that names more than CSAM_NOTICE_MAX_ACCOUNTS accounts is
 *     refused, the accounts counted by the handles as named, before any is looked up, so the refusal says nothing about
 *     which handles are live or name the same account;
 *   - the targets are de-duplicated as named, a post by its id and an account by its handle: an account's link with
 *     nothing live has no id to compare, and a stored id must never tie an old handle to its account;
 *   - each is looked up by the one liveness rule;
 *   - a signed-in sender's target that they have reported already on this ground is dropped (`skip`).
 * What is left is numbered from 1 in the order named. The answer to the sender never says which targets were live.
 */
export async function resolveTargets(
  deps: Pick<ModerationDeps, "social" | "config">,
  request: Pick<NoticeRequest, "ground" | "targets">,
  skip: (live: readonly { type: "post" | "account"; id: string }[]) => Promise<Set<string>> = async () => new Set(),
): Promise<ResolvedTargets> {
  const suspect = request.ground === "csam";
  const named: NamedTarget[] = [];
  for (const target of request.targets) {
    const parsed = target.kind === "link" ? parseLink(deps.config.APP_ORIGIN, target.url) : target.kind === "post" ? { type: "post" as const, id: target.id } : { type: "account" as const, handle: target.handle };
    if (parsed.type === "account") {
      if (!named.some((seen) => seen.type === "account" && seen.handle === parsed.handle)) named.push(parsed);
      continue;
    }
    const mediaId = target.kind === "post" ? (target.mediaId ?? null) : null;
    const seen = named.find((earlier) => earlier.type === "post" && earlier.id === parsed.id);
    // Named twice, the post is one target; the image one of the two pointed at is kept.
    if (seen && seen.type === "post") seen.mediaId ??= mediaId;
    else named.push({ type: "post", id: parsed.id, mediaId });
  }
  if (suspect && named.filter((target) => target.type === "account").length > CSAM_NOTICE_MAX_ACCOUNTS) throw new ModerationError("invalid_request");

  const found = await Promise.all(named.map((target) => liveTarget(deps, target, suspect)));
  const liveOnes = found.flatMap((target) => (target === null ? [] : [target]));
  const skipped = liveOnes.length === 0 ? new Set<string>() : await skip(liveOnes);
  const resolved: ResolvedTargets = { live: [], dead: [] };
  const stored = new Set<string>();
  let position = 0;
  named.forEach((target, index) => {
    const live = found[index] ?? null;
    if (live !== null) {
      // Dropped: already reported by this sender, or (on the path that looks up old handles) the same account as an earlier target.
      if (skipped.has(targetKey(live)) || stored.has(targetKey(live))) return;
      stored.add(targetKey(live));
      position++;
      if (target.type === "post") resolved.live.push({ type: "post", id: live.id, position, mediaId: target.mediaId });
      else resolved.live.push({ type: "account", id: live.id, position, namedHandle: target.handle });
      return;
    }
    position++;
    if (target.type === "post") resolved.dead.push({ type: "post", id: target.id, position });
    else resolved.dead.push({ type: "account", position, namedHandle: target.handle });
  });
  // Every target was live and reported already: there is nothing to store.
  if (position === 0) throw new ModerationError("already_reported");
  return resolved;
}

/** The ground's columns of a report or a notice, from the request and its sender. */
function groundOf(request: NoticeRequest, reporterId: string | null, signedIn: boolean): IntakeGround {
  const channel = signedIn ? "signed_in" : "signed_out";
  const base = { kind: "user" as const, channel, findingBy: null, contactId: null } satisfies Partial<IntakeGround>;
  switch (request.ground) {
    case "rule":
      // A rule-only report alleges no illegality: its category is the Transparency Database's for a breach of the terms.
      return { ...base, reporterId, ruleId: request.ruleId, allegesIllegal: false, csam: false, category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", categoryKeyword: null, citedLaw: null, explanation: request.explanation ?? null, bonaFide: false };
    case "illegal":
      return {
        ...base,
        reporterId,
        // A signed-out notifier's name and address go to the auth module under this id; the notice holds the id alone.
        contactId: !signedIn && (request.name !== undefined || request.email !== undefined) ? randomUUID() : null,
        ruleId: request.ruleId ?? null,
        allegesIllegal: true,
        csam: false,
        category: request.category,
        categoryKeyword: null,
        citedLaw: request.citedLaw ?? null,
        explanation: request.explanation,
        bonaFide: true,
      };
    case "csam":
      // An Art. 16 notice of illegal content that records no sender, whoever sent it: no account, no contact.
      return {
        ...base,
        reporterId: null,
        ruleId: null,
        allegesIllegal: true,
        csam: true,
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        categoryKeyword: CSAM_KEYWORDS[request.keyword],
        citedLaw: null,
        explanation: request.explanation ?? null,
        bonaFide: request.bonaFide ?? false,
      };
  }
}

/**
 * One report or notice (3c design, section 7.1). In this order:
 *   1. who may send it: a staff account reports only as its own finding, in the console; a session that has not finished
 *      onboarding has no profile to report from and is refused, never treated as signed out; a signed-in sender leaves no
 *      name or address, since their contact is their account;
 *   2. the human check of a signed-out sender, then the limits: per network signed out, per account signed in;
 *   3. the targets, resolved outside any transaction;
 *   4. the intake's transaction; a request it could not save through no fault of its sender gives its limit hits back;
 *   5. after its commit, a signed-out notifier's contact is stored by the auth module (a failure is logged: the notice
 *      stands without it, and no contact can exist without its notice), and the mails are started without being waited
 *      for: the urgent lane's alert first, then the receipt;
 *   6. the answer: the reference, and the token of a notice sent signed out or on the path for child sexual abuse
 *      material, which is shown once and is the only way to follow such a notice. A stalled relay never costs it.
 */
export async function submitNotice(deps: ModerationDeps, request: NoticeRequest, sender: NoticeSender): Promise<NoticeResponse> {
  // 1.
  const { session } = sender;
  if (session !== null) {
    if (session.role !== "user") throw new ModerationError("staff_cannot_report");
    if (!session.onboarded) throw new ModerationError("onboarding_required");
    if (request.ground === "illegal" && (request.name !== undefined || request.email !== undefined)) throw new ModerationError("invalid_request");
  }

  // 2. A signed-in sender's token is ignored. From here on the request is counted, whatever a later step says of its
  // links or its targets: a sender cannot probe what exists without spending the hour.
  const counted: string[] = [];
  const count = async (key: string, windowMs: number, max: number) => {
    await countOrRefuse(deps, key, windowMs, max);
    counted.push(key);
  };
  if (session === null) {
    if (request.turnstileToken === undefined || !(await deps.auth.verifyHuman(request.turnstileToken))) throw new ModerationError("human_check_failed");
    await count(`notice:hour:net:${sender.netHash}`, HOUR_MS, NOTICE_LIMITS.signedOut.perHour);
    await count(`notice:day:net:${sender.netHash}`, DAY_MS, NOTICE_LIMITS.signedOut.perDay);
  } else {
    await count(`notice:hour:account:${session.userId}`, HOUR_MS, NOTICE_LIMITS.signedIn.perHour);
    await count(`notice:day:account:${session.userId}`, DAY_MS, NOTICE_LIMITS.signedIn.perDay);
  }

  // 3. On the path for child sexual abuse material nothing is matched against the session's account or its reports: every
  // live target gets an item, so someone who sent a notice of illegality about a post can still report it this way.
  const ground = groundOf(request, session?.userId ?? null, session !== null);
  const reporterId = ground.reporterId;
  const targets = await resolveTargets(deps, request, reporterId === null ? undefined : (live) => alreadyReported(deps.apiDb, reporterId, ground.allegesIllegal, live));

  // 4. A request that fails here through no fault of its sender gives back what it took of their limits, since its answer
  // tells them to send it again: its case kept changing until the last retry (case_closed), or the transaction failed in
  // a way no rule of the module names. A refusal that is the sender's own (already reported, an account that is gone)
  // stays counted.
  let recorded: IntakeRecorded;
  try {
    recorded = await recordIntake(deps, { ground, live: targets.live, dead: targets.dead });
  } catch (err) {
    if (!(err instanceof ModerationError) || err.code === "case_closed") {
      // The key holds the sender's network or account: the warning names neither.
      for (const key of counted) await deps.limits.release(key).catch((failure: unknown) => deps.log.warn({ err: failure }, "notice: a limit hit of a request that could not be saved could not be given back"));
    }
    throw err;
  }

  // 5. The contact is stored before the answer; the mails are not waited for.
  if (ground.contactId !== null && request.ground === "illegal") {
    try {
      await deps.auth.storeNotifierContact(ground.contactId, { name: request.name, email: request.email });
    } catch (err) {
      deps.log.error({ err, intakeId: recorded.intakeId }, "notice: the notifier's contact could not be stored; the notice stands without it");
    }
  }
  const urgent = recorded.items.some((item) => item.caseId !== null && item.lane === 0);
  deps.background.start(async () => {
    if (urgent) {
      try {
        await alertUrgentLane(deps);
      } catch (err) {
        deps.log.error({ err, intakeId: recorded.intakeId }, "notice: the urgent lane's alert failed; the dispatch job repeats it");
      }
    }
    await sendReceipt(deps, recorded.intakeId);
  });

  // 6.
  return recorded.token === null ? { ref: recorded.ref } : { ref: recorded.ref, token: recorded.token };
}

/** What a mail's result is recorded as. A contact nobody has (never stored, or forgotten) has no address; a refused address is given up. */
const RECEIPT_STATES: Record<NotifierMailResult | AccountMailResult, ReceiptState> = { sent: "sent", folded: "folded", suppressed: "suppressed", no_address: "no_address", forgotten: "no_address", refused: "failed" };

/**
 * Sends a notice's receipt and records what became of it: to a signed-out notifier's contact, or to the account behind a
 * notice of illegality sent signed in. It is built from the stored notice alone, so a receipt sent later carries the
 * same reference, time and links as one sent at once: the links of the items the sender named, in their order, an
 * account's under the handle as named. A notice without a pending receipt sends nothing. A failure of the relay leaves
 * the receipt pending, for the dispatch job to send; any other result is recorded, only while the receipt is still
 * pending.
 */
export async function sendReceipt(deps: Pick<ModerationDeps, "apiDb" | "auth" | "config" | "log">, intakeId: string): Promise<ReceiptState | "pending" | "none"> {
  const notice = await noticeById(deps.apiDb, intakeId);
  if (!notice || notice.receipt !== "pending") return "none";
  // The items the sender named: not those korbat added for a quoted post, and no re-examination, which shares its item's position.
  const items = (await noticeItems(deps.apiDb, intakeId)).filter((item) => item.position <= 10 && !item.reexamines);
  const message = { template: "notice_received" as const, ref: notice.ref, receivedAt: new Date(notice.receivedAt), items: items.map((item) => itemLink(deps, item)) };
  let result: NotifierMailResult | AccountMailResult;
  try {
    if (notice.contactId !== null) result = await deps.auth.mailNotifier(notice.contactId, message);
    else if (notice.reporterId !== null) result = await deps.auth.mailAccount(notice.reporterId, message);
    // The reporter's link was forgotten with their account: there is nobody to mail.
    else result = "no_address";
  } catch (err) {
    deps.log.warn({ err, intakeId }, "notice receipt: not sent; it stays pending for the next try");
    return "pending";
  }
  await recordReceipt(deps.apiDb, intakeId, RECEIPT_STATES[result]);
  return RECEIPT_STATES[result];
}

// ---------------------------------------------------------------- the notifier's status page and contact

/** An item's korbat address: a post's from its id, an account's from the handle as the notice named it, never from the handle the profile holds now. */
function itemLink(deps: Pick<ModerationDeps, "config">, item: Pick<NoticeItemRow, "targetType" | "targetId" | "namedHandle">): string {
  return item.targetType === "post" ? postLink(deps.config.APP_ORIGIN, item.targetId) : accountLink(deps.config.APP_ORIGIN, item.namedHandle!);
}

/** Whether two hex digests are the same, compared in constant time. */
function sameDigest(a: string, b: string): boolean {
  const [left, right] = [Buffer.from(a, "hex"), Buffer.from(b, "hex")];
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * One item as its sender reads it (3c design, sections 7.2 and 10). Nothing of the outcome is told before the daily
 * release: not the outcome or its day, not whether images were sealed or out of sight, not whether a re-examination can
 * be asked for, so the page and the mail tell the same at the same time. And nothing before it tells whether the target
 * was live: an item whose link named nothing reads exactly as one that waits for a moderator.
 */
async function itemStatus(deps: Pick<ModerationDeps, "social" | "config">, item: NoticeItemRow): Promise<NoticeItemStatus> {
  // "No action for now": a decision taken while nobody could open the post's images, on an item about a post that is not itself suspect.
  const unseen = item.released && item.decisionUnseen && item.targetType === "post" && !item.suspect;
  // What the answer concerns. Before the release the scope comes from what the notice named and from the item's suspect
  // mark alone, never from what the target turned out to be: the page must not tell a live target from a link that names
  // nothing, nor, on the path for child sexual abuse material, whether a handle names an account.
  let scope: NoticeItemStatus["scope"] = null;
  if (item.targetType === "account") {
    // With or without a case: the answer concerns the images on the account's posts too when the item is suspect or,
    // once released, when its decision sealed them. After "not available" the page and the app add no scope sentence.
    scope = item.suspect || (item.released && item.sealed) ? "account_suspect" : "account";
  } else if (item.released && item.hasCase && !item.suspect && (await deps.social.postRef(item.targetId))?.quoteOfId) {
    // Whether a post quotes another can be read only from its row, so this scope comes with the released outcome and not
    // before it. A suspect item about a quoting post has an item of its own for the quoted post, and no such scope.
    scope = "quote";
  }
  // Only a moderator's decision to take no action can be examined again, once; an answer given with the images out of
  // sight does not spend that, also when it answered a re-examination.
  const reexaminable = item.released && item.noAction && (!item.reexamines || unseen);
  return {
    position: item.position,
    link: itemLink(deps, item),
    scope,
    suspect: item.suspect,
    sealed: item.released && item.sealed,
    unseen,
    quotedBy: item.position > 10 ? item.position - 10 : null,
    outcome: item.released ? (item.shownOutcome as ItemOutcome) : null,
    decidedOn: item.released ? item.decidedOn : null,
    changed: item.changed,
    reexamines: item.reexamines,
    reexamination: reexaminable ? { open: !item.reexamined && item.inWindow, until: item.until! } : null,
  };
}

/**
 * The items the status page lists. An item korbat added for a quoted post (a position above 10) exists only where the
 * named post exists and quotes another, so listing it at once would tell a live target from a link that names nothing.
 * It is listed from the first release that shows an outcome of its pair: its origin's, after which it stands directly
 * behind it, with its own outcome or waiting; or its own, since from the release an outcome shows on the page and its
 * window to ask for a re-examination runs. Its origin's waiting past that same release already told that it names a row:
 * a link to no row was answered by then. A re-examination is filed only on a released item, so it is always listed.
 */
function listedItems(items: readonly NoticeItemRow[]): NoticeItemRow[] {
  const releasedOrigins = new Set(items.filter((item) => item.position <= 10 && !item.reexamines && item.released).map((item) => item.position));
  return items.filter((item) => item.position <= 10 || item.reexamines || item.released || releasedOrigins.has(item.position - 10));
}

/**
 * The notifier's status page (3c design, section 7.2): the notice whose reference matches and whose token this is, either
 * the notice's own, shown once on screen, or the mail token of its contact, which the receipt's link carries. Anything
 * else is notice_not_found. With the notice's own token the contact's `confirmed` and `stopped` are null, so the answer
 * to whoever typed an address never depends on what korbat knows about that address.
 */
export async function noticeStatus(deps: Pick<ModerationDeps, "apiDb" | "auth" | "social" | "limits" | "config">, request: NoticeStatusRequest, netHash: string): Promise<NoticeStatus> {
  await countOrRefuse(deps, `notice-status:${netHash}`, HOUR_MS, STATUS_READS_PER_HOUR);
  const notice = await noticeByRef(deps.apiDb, request.ref);
  if (!notice) throw new ModerationError("notice_not_found");
  const own = notice.lookupHash !== null && sameDigest(notice.lookupHash, createHash("sha256").update(request.token).digest("hex"));
  const byMail = !own && notice.contactId !== null && (await deps.auth.notifierMailTokenMatches(notice.contactId, request.token));
  if (!own && !byMail) throw new ModerationError("notice_not_found");

  const items: NoticeItemStatus[] = [];
  for (const item of listedItems(await noticeItems(deps.apiDb, notice.id))) items.push(await itemStatus(deps, item));
  let contact: NoticeStatus["contact"] = null;
  if (notice.contactId !== null) {
    const facts = (await deps.auth.notifierFacts([notice.contactId])).get(notice.contactId);
    contact = { given: facts?.contactGiven ?? false, confirmed: byMail ? (facts?.confirmed ?? false) : null, stopped: byMail ? (facts?.suppressed ?? false) : null };
  }
  return { ref: notice.ref, receivedAt: notice.receivedAt, items, contact };
}

/**
 * The status page's two buttons (3c design, section 7.2): "I sent this" and "stop korbat's emails about reports to this
 * address". Only the contact's mail token works them: the notice's own token, a notice without a contact and a wrong
 * token are all notice_not_found, so typing someone's address neither confirms it nor stops korbat's mail to it.
 */
export async function noticeContact(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits">, request: NoticeContactRequest, netHash: string): Promise<void> {
  await countOrRefuse(deps, `notice-status:${netHash}`, HOUR_MS, STATUS_READS_PER_HOUR);
  const notice = await noticeByRef(deps.apiDb, request.ref);
  if (!notice || notice.contactId === null) throw new ModerationError("notice_not_found");
  const done = request.choice === "confirm" ? await deps.auth.confirmNotifier(notice.contactId, request.token) : await deps.auth.stopNotifier(notice.contactId, request.token);
  if (!done) throw new ModerationError("notice_not_found");
}
```

### Replace `apps/api/src/moderation/repo.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import type { ActionKind, CaseDecidedParams, Lane, StaffStoredAssertion } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";

/**
 * The SQL statements of the moderation module, on the korbat_api pool (3c design, sections 5 and 6). The module inserts
 * rows; migrator-owned triggers check them, force the columns the API must not choose, and derive every restriction from
 * them. So each insert here names only what the API supplies: the database sets the rest whatever an insert said (a time,
 * a number in a case, who a report came from), and a column left out can never be mistaken for one the API chose. That is
 * why the inserts are written as SQL: a query builder would name every column of the table.
 */

/** What a statement runs through: the pool, or a transaction. */
type Runner = Pick<Db, "execute"> | Pick<DbTx, "execute">;

const rows = async <T>(q: Runner, query: ReturnType<typeof sql>): Promise<T[]> => (await q.execute(query)) as unknown as T[];

/** A timestamptz expression as the text Date.prototype.toISOString writes: UTC, to the millisecond. The expression is written here, never input. */
const iso = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

// ---------------------------------------------------------------- what the database raised

/** The first of the driver's errors in the chain that carries a SQLSTATE; drizzle wraps the driver's error as a cause. */
function driverError(err: unknown): { code: string; message: unknown; constraint_name?: unknown } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && typeof (current as { code?: unknown }).code === "string") return current as { code: string; message: unknown; constraint_name?: unknown };
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** The message of an exception a trigger or a function raised as its code (SQLSTATE P0001); null for anything else. */
export function raisedMessage(err: unknown): string | null {
  const raised = driverError(err);
  return raised?.code === "P0001" && typeof raised.message === "string" ? raised.message : null;
}

/** True for a serialization failure (SQLSTATE 40001): the attach trigger raises it when an item's case closed in between. */
export function isSerializationFailure(err: unknown): boolean {
  return driverError(err)?.code === "40001";
}

/** The constraint a unique violation names (SQLSTATE 23505), or null for anything else. */
export function violatedUniqueConstraint(err: unknown): string | null {
  const raised = driverError(err);
  return raised?.code === "23505" && typeof raised.constraint_name === "string" ? raised.constraint_name : null;
}

// ---------------------------------------------------------------- intakes, items and cases

export type TargetType = "post" | "account";

/** One report, notice or finding as the intake's transaction stores it; the trigger sets when it was received and its receipt's state. */
export interface IntakeRow {
  kind: "user" | "finding";
  ref: string;
  /** The sha256 hex of the notice's token, for a signed-out notice and for every notice on the CSAM path. */
  lookupHash: string | null;
  channel: "signed_in" | "signed_out" | "staff";
  reporterId: string | null;
  findingBy: string | null;
  contactId: string | null;
  ruleId: string | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: string;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  bonaFide: boolean;
}

export async function insertIntake(tx: DbTx, row: IntakeRow): Promise<string> {
  const [inserted] = await rows<{ id: string }>(
    tx,
    sql`insert into intakes (kind, ref, lookup_hash, channel, reporter_id, finding_by, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide)
        values (${row.kind}::intake_kind, ${row.ref}, ${row.lookupHash}, ${row.channel}::intake_channel, ${row.reporterId}::uuid, ${row.findingBy}::uuid, ${row.contactId}::uuid,
                ${row.ruleId}, ${row.allegesIllegal}::boolean, ${row.csam}::boolean, ${row.category}, ${row.categoryKeyword}, ${row.citedLaw}, ${row.explanation}, ${row.bonaFide}::boolean)
        returning id`,
  );
  return inserted!.id;
}

/**
 * The target's open case, opened when there is none: an insert that does nothing on a conflict (the API role holds no
 * UPDATE on cases, so it could not do anything else), then a read of the open case in a statement of its own, which
 * sees a case another transaction committed while the insert waited. Null when the read finds none: a decision closed
 * the case after the insert, and the caller runs both again.
 */
export async function openCase(tx: DbTx, targetType: TargetType, targetId: string): Promise<string | null> {
  await tx.execute(sql`insert into cases (target_type, target_id) values (${targetType}::moderation_target, ${targetId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
  const [open] = await rows<{ id: string }>(tx, sql`select id from cases where target_type = ${targetType}::moderation_target and target_id = ${targetId}::uuid and closed_at is null`);
  return open?.id ?? null;
}

/** One target of an intake. With a case the attach trigger numbers it into the case; without one it is stored as answered at once, not available. */
export interface ItemRow {
  intakeId: string;
  caseId: string | null;
  targetType: TargetType;
  targetId: string;
  position: number;
  lane: Lane;
  /** The image the sender pointed at: a hint. */
  mediaId: string | null;
  /** For an account, the handle as it was named, in lower case. */
  namedHandle: string | null;
}

export async function insertItem(tx: DbTx, row: ItemRow): Promise<{ id: string; seq: number | null }> {
  const [inserted] = await rows<{ id: string; seq: number | null }>(
    tx,
    sql`insert into intake_items (intake_id, case_id, target_type, target_id, position, lane, media_id, named_handle, outcome)
        values (${row.intakeId}::uuid, ${row.caseId}::uuid, ${row.targetType}::moderation_target, ${row.targetId}::uuid, ${row.position}::smallint, ${row.lane}::smallint,
                ${row.mediaId}::uuid, ${row.namedHandle}, ${row.caseId === null ? "not_available" : null}::item_outcome)
        returning id, seq`,
  );
  return inserted!;
}

// ---------------------------------------------------------------- reports and notices

/** Ids as one uuid[] parameter. */
const uuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

/** One target as a key of a set: its kind and its id. */
export const targetKey = (target: { type: TargetType; id: string }) => `${target.type}:${target.id}`;

/**
 * Which of these targets the sender has reported already on this ground (alleging illegality or not): the target's open
 * case holds an item of theirs that is no re-examination. The unique index the intake's transaction meets holds the same
 * rule; this read lets a notice that names several targets drop the ones already reported instead of failing whole.
 */
export async function alreadyReported(q: Runner, reporterId: string, allegesIllegal: boolean, targets: readonly { type: TargetType; id: string }[]): Promise<Set<string>> {
  if (targets.length === 0) return new Set();
  const ids = (type: TargetType) => uuids(targets.filter((target) => target.type === type).map((target) => target.id));
  const found = await rows<{ target_type: TargetType; target_id: string }>(
    q,
    sql`select c.target_type, c.target_id from cases c
         where c.closed_at is null
           and ((c.target_type = 'post' and c.target_id = any(${ids("post")})) or (c.target_type = 'account' and c.target_id = any(${ids("account")})))
           and exists (select 1 from intake_items i
                        where i.case_id = c.id and i.reporter_account_id = ${reporterId}::uuid and i.alleges_illegal = ${allegesIllegal}::boolean and i.reexamines_item_id is null)`,
  );
  return new Set(found.map((row) => targetKey({ type: row.target_type, id: row.target_id })));
}

/** A notice as the status page and its receipt need it: where it stands and whom its receipt goes to, never what it says. */
export interface NoticeRow {
  id: string;
  ref: string;
  /** The sha256 hex of the notice's own token; null for a report sent signed in on a rule or on the law. */
  lookupHash: string | null;
  contactId: string | null;
  reporterId: string | null;
  allegesIllegal: boolean;
  /** As Date.prototype.toISOString writes it. */
  receivedAt: string;
  receipt: "pending" | "sent" | "folded" | "suppressed" | "no_address" | "none" | "failed";
}

const noticeColumns = sql`id, ref, lookup_hash, contact_id, reporter_id, alleges_illegal, ${iso("received_at")} as received_at, receipt`;
type NoticeColumns = { id: string; ref: string; lookup_hash: string | null; contact_id: string | null; reporter_id: string | null; alleges_illegal: boolean; received_at: string; receipt: NoticeRow["receipt"] };
const noticeOf = (row: NoticeColumns | undefined): NoticeRow | null =>
  row ? { id: row.id, ref: row.ref, lookupHash: row.lookup_hash, contactId: row.contact_id, reporterId: row.reporter_id, allegesIllegal: row.alleges_illegal, receivedAt: row.received_at, receipt: row.receipt } : null;

/** The notice with this public reference, or null. */
export async function noticeByRef(q: Runner, ref: string): Promise<NoticeRow | null> {
  return noticeOf((await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where ref = ${ref}`))[0]);
}

export async function noticeById(q: Runner, intakeId: string): Promise<NoticeRow | null> {
  return noticeOf((await rows<NoticeColumns>(q, sql`select ${noticeColumns} from intakes where id = ${intakeId}::uuid`))[0]);
}

/** One item of a notice as its sender may read it: nothing of the case, the decision's reasons or the target's content. */
export interface NoticeItemRow {
  position: number;
  targetType: TargetType;
  targetId: string;
  /** For an account, the handle as the notice named it. */
  namedHandle: string | null;
  /** False for a link that named nothing live: its item has no case and was answered at once. */
  hasCase: boolean;
  suspect: boolean;
  /** Whether the daily release has shown the outcome; nothing below is told before it. */
  released: boolean;
  shownOutcome: string | null;
  /** The UTC day of the answering decision, or of the item itself when it was answered without one. */
  decidedOn: string;
  /** Whether the answering decision holds a seal. */
  sealed: boolean;
  /** Whether the answering decision was taken while nobody could open the post's images. */
  decisionUnseen: boolean;
  changed: boolean;
  reexamines: boolean;
  /** A moderator's decision to take no action: the only answer a re-examination can be asked for. */
  noAction: boolean;
  reexamined: boolean;
  /** The end of the re-examination window, as toISOString writes it; null before the release. */
  until: string | null;
  inWindow: boolean;
}

/**
 * A notice's items in the order its page lists them: by position, an item korbat added for a quoted post (positions 11
 * to 20) directly after the item it was added for, and a re-examination, which shares its item's position, after it.
 * The window's end is the database's own appeal_deadline of the release, read against its clock, as the attach trigger
 * reads it when a re-examination is filed.
 */
export async function noticeItems(q: Runner, intakeId: string): Promise<NoticeItemRow[]> {
  const found = await rows<{
    position: number;
    target_type: TargetType;
    target_id: string;
    named_handle: string | null;
    has_case: boolean;
    suspect: boolean;
    released: boolean;
    shown_outcome: string | null;
    decided_on: string;
    sealed: boolean;
    decision_unseen: boolean;
    changed: boolean;
    reexamines: boolean;
    no_action: boolean;
    reexamined: boolean;
    until: string | null;
    in_window: boolean;
  }>(
    q,
    sql`select i.position, i.target_type, i.target_id, i.named_handle, i.case_id is not null as has_case, i.suspect,
               i.outcome_sent_at is not null as released, i.shown_outcome,
               to_char(coalesce(d.decided_at, i.created_at) at time zone 'UTC', 'YYYY-MM-DD') as decided_on,
               exists (select 1 from decision_actions a where a.decision_id = i.answered_by and a.kind = 'seal_media') as sealed,
               coalesce(d.unseen, false) as decision_unseen,
               i.revised_sent_at is not null as changed,
               i.reexamines_item_id is not null as reexamines,
               (i.answered_by is not null and i.outcome in ('no_violation', 'not_evident')) as no_action,
               exists (select 1 from intake_items r where r.reexamines_item_id = i.id) as reexamined,
               ${iso("public.appeal_deadline(i.outcome_sent_at)")} as until,
               coalesce(clock_timestamp() < public.appeal_deadline(i.outcome_sent_at), false) as in_window
          from intake_items i left join decisions d on d.id = i.answered_by
         where i.intake_id = ${intakeId}::uuid
         order by (case when i.position > 10 then i.position - 10 else i.position end), (i.position > 10), i.created_at, i.id`,
  );
  return found.map((row) => ({
    position: row.position,
    targetType: row.target_type,
    targetId: row.target_id,
    namedHandle: row.named_handle,
    hasCase: row.has_case,
    suspect: row.suspect,
    released: row.released,
    shownOutcome: row.shown_outcome,
    decidedOn: row.decided_on,
    sealed: row.sealed,
    decisionUnseen: row.decision_unseen,
    changed: row.changed,
    reexamines: row.reexamines,
    noAction: row.no_action,
    reexamined: row.reexamined,
    until: row.until,
    inWindow: row.in_window,
  }));
}

/** What became of a receipt: the delivery states a send can end in. */
export type ReceiptState = "sent" | "folded" | "suppressed" | "no_address" | "failed";

/**
 * Records what became of a notice's receipt, only while it is still pending, so a late answer never overwrites one
 * already recorded: the later writer waits for the first one's commit and then changes nothing. True when this call
 * recorded it.
 */
export async function recordReceipt(q: Runner, intakeId: string, state: ReceiptState): Promise<boolean> {
  const updated = await rows<{ id: string }>(
    q,
    sql`update intakes set receipt = ${state}::delivery_state, receipt_sent_at = case when ${state}::text = 'sent' then now() else receipt_sent_at end
         where id = ${intakeId}::uuid and receipt = 'pending' returning id`,
  );
  return updated.length > 0;
}

/** The open cases in the urgent lane: how many, and since when the oldest of them has waited. One read of the queue's index. */
export async function urgentWaiting(q: Runner): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await rows<{ n: number; oldest: string | null }>(q, sql`select count(*)::int as n, ${iso("min(oldest_open_at)")} as oldest from cases where closed_at is null and lane = 0`);
  return { count: row!.n, oldest: row!.oldest === null ? null : new Date(row!.oldest) };
}

// ---------------------------------------------------------------- evidence

/** The transaction's start to the millisecond, as the snapshots' trigger stamps a snapshot taken in it. */
export async function snapshotTime(tx: DbTx): Promise<string> {
  const [row] = await rows<{ at: string }>(tx, sql`select ${iso("date_trunc('milliseconds', now())")} as at`);
  return row!.at;
}

/**
 * Whether the case holds a snapshot yet, and for an account's case the fields of its newest one. A snapshot's time is its
 * transaction's start to the millisecond, so two snapshots of one case can carry the same time; their ids, which
 * insertSnapshot draws in time order, say which is the newer.
 */
export async function latestSnapshot(tx: DbTx, caseId: string): Promise<{ displayName: string | null; bio: string | null; handle: string | null } | null> {
  const [row] = await rows<{ display_name: string | null; bio: string | null; handle: string | null }>(
    tx,
    sql`select display_name, bio, handle from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc limit 1`,
  );
  return row ? { displayName: row.display_name, bio: row.bio, handle: row.handle } : null;
}

/** A snapshot as the intake stores it: what was copied, with the salt and the digest the server made over all of it. */
export interface SnapshotRow {
  caseId: string;
  targetType: TargetType;
  targetId: string;
  authorHandle: string;
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | null;
  postCreatedAt: string | null;
  replyToId: string | null;
  quoteOfId: string | null;
  body: string | null;
  media: { id: string; alt: string | null; width: number; height: number }[] | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
  salt: string;
  digest: string;
}

/**
 * Stores a snapshot and answers its id with the time the database stamped it, as text to the millisecond. The id is a
 * version 7 uuid, which PostgreSQL draws in time order and never backwards within a session: the newest snapshot of a
 * case is then the one with the latest time and, among those of one millisecond, the greatest id.
 */
export async function insertSnapshot(tx: DbTx, row: SnapshotRow): Promise<{ id: string; takenAt: string }> {
  const [inserted] = await rows<{ id: string; taken_at: string }>(
    tx,
    sql`insert into evidence_snapshots (id, case_id, target_type, target_id, author_handle, post_state, post_created_at, reply_to_id, quote_of_id, body, media, display_name, bio, handle, salt, digest)
        values (uuidv7(), ${row.caseId}::uuid, ${row.targetType}::moderation_target, ${row.targetId}::uuid, ${row.authorHandle}, ${row.postState}::post_state, ${row.postCreatedAt}::timestamptz,
                ${row.replyToId}::uuid, ${row.quoteOfId}::uuid, ${row.body}, ${row.media === null ? null : JSON.stringify(row.media)}::text::jsonb, ${row.displayName}, ${row.bio}, ${row.handle},
                ${row.salt}, ${row.digest})
        returning id, ${iso("taken_at")} as taken_at`,
  );
  return { id: inserted!.id, takenAt: inserted!.taken_at };
}

// ---------------------------------------------------------------- decisions

/** What a case is about, or null when no case has the id. */
export async function caseTarget(q: Runner, caseId: string): Promise<{ type: TargetType; id: string } | null> {
  const [row] = await rows<{ target_type: TargetType; target_id: string }>(q, sql`select target_type, target_id from cases where id = ${caseId}::uuid`);
  return row ? { type: row.target_type, id: row.target_id } : null;
}

/**
 * The decision's row, from the params its staff key confirmed and the account that decided. The id is the API's, so the
 * audit row can name the decision; everything else the row holds is the triggers'.
 */
export async function insertDecision(tx: DbTx, row: { id: string; caseId: string; decidedBy: string; params: CaseDecidedParams }): Promise<void> {
  const p = row.params;
  await tx.execute(
    sql`insert into decisions (id, case_id, kind, reviews_decision_id, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, category_keyword,
                               snapshot_id, snapshot_digest, facts_digest, reason_digest, legal_reference_digest, decided_by)
        values (${row.id}::uuid, ${row.caseId}::uuid, ${p.kind}::decision_kind, ${p.reviewsDecisionId}::uuid, ${p.stateVersion}::int, ${p.throughSeq}::int, ${p.outcome}::decision_outcome,
                ${p.ground}::decision_ground, ${p.ruleId}, ${p.rulesVersion}::smallint, ${p.redressVersion}::smallint, ${p.category}, ${p.categoryKeyword},
                ${p.snapshotId}::uuid, ${p.snapshotDigest}, ${p.factsDigest}, ${p.reasonDigest}, ${p.legalReferenceDigest}, ${row.decidedBy}::uuid)`,
  );
}

/** One measure or reversal of a decision. Its target, the measure it lifts and whether it changes anything are the triggers'. */
export async function insertAction(tx: DbTx, decisionId: string, action: { kind: ActionKind; mediaId: string | null }): Promise<void> {
  await tx.execute(sql`insert into decision_actions (decision_id, kind, media_id) values (${decisionId}::uuid, ${action.kind}::action_kind, ${action.mediaId}::uuid)`);
}

/** The audit row of a confirmed action, as public.append_confirmed_audit writes it. */
export interface ConfirmedAuditRow {
  actorId: string;
  keyId: string;
  action: "case_decided" | "appeals_reviewed" | "identity_revealed";
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  staffSession: string;
  actionHash: string;
  stepUp: StaffStoredAssertion;
  requestId: string;
  /** The step-up challenge's expiry: the function refuses a row that joins the chain at or after it. */
  expiresAt: Date;
}

/**
 * Writes a confirmed action's audit row through public.append_confirmed_audit, as the last statement of the action's
 * transaction: the function checks that the acting account and its key are still live, writes the row, and refuses it when
 * the challenge had expired by then, which rolls the whole transaction back. The row holds the chain's head until the
 * commit, so nothing that can wait may run after it. Answers the row's place in the chain.
 */
export async function appendConfirmedAudit(tx: DbTx, row: ConfirmedAuditRow): Promise<number> {
  // The jsonb arguments go as text and are cast, so the driver sends them exactly as serialised here.
  const [written] = await rows<{ place: string }>(
    tx,
    sql`select public.append_confirmed_audit(${row.actorId}::uuid, ${row.keyId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
          ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession}::uuid, ${row.actionHash}::text, ${JSON.stringify(row.stepUp)}::text::jsonb,
          ${row.requestId}::text, ${row.expiresAt.getTime()}::bigint)::text as place`,
  );
  return Number(written!.place);
}

// ---------------------------------------------------------------- the console: recusal, the day's limits and the access log

/** A timestamptz expression as a UTC day. The expression is written here, never input. */
const day = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD')`);

/** Midnight UTC of the database's day: where a staff account's daily counts begin. */
const TODAY = sql`(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`;

/**
 * Whether the staff account is too close to the case's subject to open it: the account itself, a personal account the
 * operator linked to it, or one that account follows, blocks, mutes or replied to. The database answers one boolean, and
 * never looks at who reported, so a refused read says nothing about that. False for a case that does not exist.
 */
export async function staffCaseConflict(q: Runner, staffId: string, caseId: string): Promise<boolean> {
  const [row] = await rows<{ conflict: boolean }>(q, sql`select public.staff_case_conflict(${staffId}::uuid, ${caseId}::uuid, false) as conflict`);
  return row!.conflict;
}

/** What one staff account may do in a UTC day. The operator changes the numbers with the command line. */
export interface DailyLimits {
  caseOpens: number;
  findings: number;
  reveals: number;
}

/** The day's limits from the single row the migration wrote; the defaults when the row is missing. */
export async function dailyLimits(q: Runner): Promise<DailyLimits> {
  const [row] = await rows<{ case_opens_per_day: number; findings_per_day: number; reveals_per_day: number }>(q, sql`select case_opens_per_day, findings_per_day, reveals_per_day from moderation_limits where id = 1`);
  return { caseOpens: row?.case_opens_per_day ?? 400, findings: row?.findings_per_day ?? 50, reveals: row?.reveals_per_day ?? 10 };
}

/** How many different cases the staff account has opened since midnight UTC, and whether this case is among them. */
export async function casesOpenedToday(q: Runner, staffId: string, caseId: string): Promise<{ cases: number; thisCase: boolean }> {
  const [row] = await rows<{ n: number; this_case: boolean }>(
    q,
    sql`select count(distinct case_id)::int as n, coalesce(bool_or(case_id = ${caseId}::uuid), false) as this_case
          from case_access_log where staff_id = ${staffId}::uuid and kind = 'case_opened' and at >= ${TODAY}`,
  );
  return { cases: row!.n, thisCase: row!.this_case };
}

/** How many findings the staff account has opened since midnight UTC. */
export async function findingsOpenedToday(q: Runner, staffId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from intakes where finding_by = ${staffId}::uuid and received_at >= ${TODAY}`);
  return row!.n;
}

/** How many sources the staff account has revealed since midnight UTC. */
export async function revealsToday(q: Runner, staffId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from case_access_log where staff_id = ${staffId}::uuid and kind = 'identity_revealed' and at >= ${TODAY}`);
  return row!.n;
}

/** One row of the access log: a case opened, an image viewed, or a source revealed with the text that gives the reason. The database stamps it. */
export async function insertAccess(
  q: Runner,
  row: { staffId: string; caseId: string; kind: "case_opened" | "image_viewed" | "identity_revealed"; mediaId?: string; itemId?: string; textId?: string },
): Promise<Date> {
  const [written] = await rows<{ at: string }>(
    q,
    sql`insert into case_access_log (staff_id, case_id, kind, media_id, intake_item_id, text_id)
        values (${row.staffId}::uuid, ${row.caseId}::uuid, ${row.kind}::access_kind, ${row.mediaId ?? null}::uuid, ${row.itemId ?? null}::uuid, ${row.textId ?? null}::uuid)
        returning ${iso("at")} as at`,
  );
  return new Date(written!.at);
}

/** A profile's public handle, or null when no row has the id: how the console and the staff mails name a staff account. */
export async function handleOf(q: Runner, profileId: string): Promise<string | null> {
  const [row] = await rows<{ handle: string }>(q, sql`select handle from profiles where id = ${profileId}::uuid`);
  return row?.handle ?? null;
}

// ---------------------------------------------------------------- the console: the case

/** A case's own row. */
export interface CaseRow {
  id: string;
  targetType: TargetType;
  targetId: string;
  lane: Lane;
  intakeSeq: number;
  answeredSeq: number;
  stateVersion: number;
  openedAt: string;
  closedAt: string | null;
}

export async function caseById(q: Runner, caseId: string): Promise<CaseRow | null> {
  const [row] = await rows<{ id: string; target_type: TargetType; target_id: string; lane: Lane; intake_seq: number; answered_seq: number; state_version: number; opened_at: string; closed_at: string | null }>(
    q,
    sql`select id, target_type, target_id, lane, intake_seq, answered_seq, state_version, ${iso("opened_at")} as opened_at, ${iso("closed_at")} as closed_at from cases where id = ${caseId}::uuid`,
  );
  if (!row) return null;
  return { id: row.id, targetType: row.target_type, targetId: row.target_id, lane: row.lane, intakeSeq: row.intake_seq, answeredSeq: row.answered_seq, stateVersion: row.state_version, openedAt: row.opened_at, closedAt: row.closed_at };
}

/** A post as it stands, for the case that is about it: read, never written; the rows are the social module's. */
export interface LivePost {
  authorId: string;
  authorHandle: string;
  state: "visible" | "withheld" | "removed" | "deleted_by_author";
  level: "visible" | "withheld" | "removed";
  /** Gate V's answer for the case page: false while the post is frozen, so the console asks for no image. */
  imagesAllowed: boolean;
}

export async function livePost(q: Runner, postId: string): Promise<LivePost | null> {
  const [row] = await rows<{ author_id: string; author_handle: string; state: LivePost["state"]; level: LivePost["level"]; images_allowed: boolean }>(
    q,
    sql`select p.author_id, a.handle as author_handle, p.state, p.moderation_level as level, not public.post_frozen(p.id) as images_allowed
          from posts p join profiles a on a.id = p.author_id where p.id = ${postId}::uuid`,
  );
  return row ? { authorId: row.author_id, authorHandle: row.author_handle, state: row.state, level: row.level, imagesAllowed: row.images_allowed } : null;
}

/** An account's fields as they stand, for the case that is about it. */
export async function liveAccount(q: Runner, accountId: string): Promise<{ handle: string; displayName: string; bio: string; deleted: boolean } | null> {
  const [row] = await rows<{ handle: string; display_name: string; bio: string; deleted: boolean }>(
    q,
    sql`select handle, display_name, bio, deleted_at is not null as deleted from profiles where id = ${accountId}::uuid`,
  );
  return row ? { handle: row.handle, displayName: row.display_name, bio: row.bio, deleted: row.deleted } : null;
}

/** Whether the case is on the path for child sexual abuse material at all (it holds a suspect item or a seal), and whether a suspect item of it is unanswered. */
export async function suspicionOf(q: Runner, caseId: string): Promise<{ holds: boolean; open: boolean }> {
  const [row] = await rows<{ holds: boolean; open: boolean }>(
    q,
    sql`select (exists (select 1 from intake_items i where i.case_id = ${caseId}::uuid and i.suspect)
             or exists (select 1 from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid and a.kind = 'seal_media')) as holds,
               exists (select 1 from intake_items i where i.case_id = ${caseId}::uuid and i.suspect and i.answered_by is null) as open`,
  );
  return { holds: row!.holds, open: row!.open };
}

/** How often, and when last, an admin answered a report of this kind without a seal. */
export interface EarlierAnswers {
  count: number;
  /** The UTC day of the latest such answer. */
  lastOn: string | null;
}

/**
 * The final decisions of the last `months` months that answered a suspect item without a seal: about this target, and
 * about its author's profile or any of the author's posts. Such a decision is a stored fact (final, taken on a suspicion,
 * holding no seal), so nothing here is computed from which case held which item. Counts and days only.
 */
export async function earlierAnswers(q: Runner, target: { type: TargetType; id: string }, authorId: string | null, months: number): Promise<{ target: EarlierAnswers; author: EarlierAnswers }> {
  const about = sql`(c.target_type = ${target.type}::moderation_target and c.target_id = ${target.id}::uuid)`;
  const ofAuthor =
    authorId === null
      ? about
      : sql`((c.target_type = 'account' and c.target_id = ${authorId}::uuid) or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = ${authorId}::uuid)))`;
  const [row] = await rows<{ target_count: number; target_last: string | null; author_count: number; author_last: string | null }>(
    q,
    sql`select (count(*) filter (where ${about}))::int as target_count,
               to_char(max(d.decided_at) filter (where ${about}) at time zone 'UTC', 'YYYY-MM-DD') as target_last,
               count(*)::int as author_count,
               ${day("max(d.decided_at)")} as author_last
          from decisions d join cases c on c.id = d.case_id
         where d.kind = 'final' and d.suspect and d.decided_at >= now() - make_interval(months => ${months}::int)
           and not exists (select 1 from decision_actions a where a.decision_id = d.id and a.kind = 'seal_media')
           and ${ofAuthor}`,
  );
  return { target: { count: row!.target_count, lastOn: row!.target_last }, author: { count: row!.author_count, lastOn: row!.author_last } };
}

/** The UTC day an image of the post was last served to staff by the console's image route, on any case about the post; null when none was. */
export async function imagesOpenedOn(q: Runner, postId: string): Promise<string | null> {
  const [row] = await rows<{ opened_on: string | null }>(
    q,
    sql`select ${day("max(l.at)")} as opened_on from case_access_log l join cases c on c.id = l.case_id
         where l.kind = 'image_viewed' and c.target_type = 'post' and c.target_id = ${postId}::uuid`,
  );
  return row!.opened_on;
}

/** A snapshot as stored, with the database's word on whether its content may be shown. */
export interface SnapshotRead extends Omit<SnapshotRow, "salt"> {
  id: string;
  takenAt: string;
  withheld: boolean;
  erased: boolean;
  /** Null for an erased snapshot, which keeps its digest and loses its salt with its content. */
  salt: string | null;
}

/** The case's snapshots, newest first. `withheld` is the one predicate by which a snapshot's content is withheld wherever it would be shown. */
export async function caseSnapshots(q: Runner, caseId: string, newestOnly = false): Promise<SnapshotRead[]> {
  const found = await rows<{
    id: string;
    taken_at: string;
    withheld: boolean;
    erased: boolean;
    target_type: TargetType;
    target_id: string;
    author_handle: string;
    post_state: SnapshotRow["postState"];
    post_created_at: string | null;
    reply_to_id: string | null;
    quote_of_id: string | null;
    body: string | null;
    media: string | null;
    display_name: string | null;
    bio: string | null;
    handle: string | null;
    salt: string | null;
    digest: string;
  }>(
    q,
    sql`select s.id, ${iso("s.taken_at")} as taken_at, public.snapshot_withheld(s.id) as withheld, s.erased_at is not null as erased, s.target_type, s.target_id, s.author_handle, s.post_state,
               ${iso("s.post_created_at")} as post_created_at, s.reply_to_id, s.quote_of_id, s.body, s.media::text as media, s.display_name, s.bio, s.handle, s.salt, s.digest
          from evidence_snapshots s where s.case_id = ${caseId}::uuid order by s.taken_at desc, s.id desc ${newestOnly ? sql`limit 1` : sql``}`,
  );
  return found.map((row) => ({
    id: row.id,
    takenAt: row.taken_at,
    withheld: row.withheld,
    erased: row.erased,
    caseId,
    targetType: row.target_type,
    targetId: row.target_id,
    authorHandle: row.author_handle,
    postState: row.post_state,
    postCreatedAt: row.post_created_at,
    replyToId: row.reply_to_id,
    quoteOfId: row.quote_of_id,
    body: row.body,
    media: row.media === null ? null : (JSON.parse(row.media) as SnapshotRow["media"]),
    displayName: row.display_name,
    bio: row.bio,
    handle: row.handle,
    salt: row.salt,
    digest: row.digest,
  }));
}

/**
 * Whether a snapshot of the case that still holds its content lists the image. The console's image route asks this of
 * the module's own evidence before it asks the media module for anything: `media` is the list a snapshot of a post
 * copied, each entry with its image's id in the spelling the database writes.
 */
export async function snapshotListsImage(q: Runner, caseId: string, mediaId: string): Promise<boolean> {
  const [row] = await rows<{ listed: boolean }>(
    q,
    sql`select exists (select 1 from evidence_snapshots s
                        where s.case_id = ${caseId}::uuid and s.erased_at is null and s.media @> ${JSON.stringify([{ id: mediaId }])}::text::jsonb) as listed`,
  );
  return row!.listed;
}

/** One item of a case with its intake's ground and texts, as the case page reads it. */
export interface CaseItemRow {
  id: string;
  seq: number;
  position: number;
  createdAt: string;
  lane: Lane;
  targetType: TargetType;
  targetId: string;
  namedHandle: string | null;
  mediaId: string | null;
  suspect: boolean;
  reporterAccountId: string | null;
  outcome: string | null;
  answeredBy: string | null;
  statement: string | null;
  intakeKind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  contactId: string | null;
  ruleId: string | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: string;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  erased: boolean;
  reexaminesPosition: number | null;
  reexaminesYourDecision: boolean;
  quotedCaseId: string | null;
}

/**
 * The case's items in the order they attached. For a re-examination: the position of the item it re-examines in its
 * notice, and whether `personId` decided that item. For a suspect item about a post that quotes another: the case of the
 * same notice's item on the quoted post (the one korbat added, or the one the notice named itself).
 */
export async function caseItems(q: Runner, caseId: string, personId: string): Promise<CaseItemRow[]> {
  const found = await rows<{
    id: string;
    seq: number;
    position: number;
    created_at: string;
    lane: Lane;
    target_type: TargetType;
    target_id: string;
    named_handle: string | null;
    media_id: string | null;
    suspect: boolean;
    reporter_account_id: string | null;
    outcome: string | null;
    answered_by: string | null;
    statement: string | null;
    intake_kind: "user" | "finding";
    channel: CaseItemRow["channel"];
    contact_id: string | null;
    rule_id: string | null;
    alleges_illegal: boolean;
    csam: boolean;
    category: string;
    category_keyword: string | null;
    cited_law: string | null;
    explanation: string | null;
    erased: boolean;
    reexamines_position: number | null;
    reexamines_your_decision: boolean;
    quoted_case_id: string | null;
  }>(
    q,
    sql`select i.id, i.seq, i.position, ${iso("i.created_at")} as created_at, i.lane, i.target_type, i.target_id, i.named_handle, i.media_id, i.suspect, i.reporter_account_id,
               i.outcome, i.answered_by, i.statement,
               n.kind as intake_kind, n.channel, n.contact_id, n.rule_id, n.alleges_illegal, n.csam, n.category, n.category_keyword, n.cited_law, n.explanation,
               n.erased_at is not null as erased,
               (select r.position from intake_items r where r.id = i.reexamines_item_id) as reexamines_position,
               coalesce((select d.decided_by = ${personId}::uuid from intake_items r join decisions d on d.id = r.answered_by where r.id = i.reexamines_item_id), false) as reexamines_your_decision,
               case when i.suspect and i.target_type = 'post' then
                 (select a.case_id from posts p join intake_items a on a.intake_id = i.intake_id and a.target_type = 'post' and a.target_id = p.quote_of_id and a.case_id is not null
                   where p.id = i.target_id order by a.created_at desc, a.id limit 1) end as quoted_case_id
          from intake_items i join intakes n on n.id = i.intake_id
         where i.case_id = ${caseId}::uuid order by i.seq`,
  );
  return found.map((row) => ({
    id: row.id,
    seq: row.seq,
    position: row.position,
    createdAt: row.created_at,
    lane: row.lane,
    targetType: row.target_type,
    targetId: row.target_id,
    namedHandle: row.named_handle,
    mediaId: row.media_id,
    suspect: row.suspect,
    reporterAccountId: row.reporter_account_id,
    outcome: row.outcome,
    answeredBy: row.answered_by,
    statement: row.statement,
    intakeKind: row.intake_kind,
    channel: row.channel,
    contactId: row.contact_id,
    ruleId: row.rule_id,
    allegesIllegal: row.alleges_illegal,
    csam: row.csam,
    category: row.category,
    categoryKeyword: row.category_keyword,
    citedLaw: row.cited_law,
    explanation: row.explanation,
    erased: row.erased,
    reexaminesPosition: row.reexamines_position,
    reexaminesYourDecision: row.reexamines_your_decision,
    quotedCaseId: row.quoted_case_id,
  }));
}

/** What a reporter's summary is banded from: when the account was made and four counts over its items that korbat still keeps. */
export interface ReporterFacts {
  createdAt: Date | null;
  filed: number;
  /** Items whose outcome was released, but those answered while nobody could open the images. */
  decided: number;
  actedOn: number;
  /** Released items about a post that a decision answered without action while its images were out of sight. */
  answeredUnseen: number;
}

/**
 * Each reporter's facts, computed on read from the reporter's own rows, never stored. An item is decided once its outcome
 * is released and acted on when that is a restriction, whole or in part. An item that was answered without action while
 * nobody could open the post's images is counted apart and is not among the decided ones.
 */
export async function reporterFacts(q: Runner, reporterIds: readonly string[]): Promise<Map<string, ReporterFacts>> {
  if (reporterIds.length === 0) return new Map();
  const unseen = sql`(x.target_type = 'post' and not x.suspect and x.shown_outcome in ('no_violation', 'not_evident') and coalesce((select d.unseen from decisions d where d.id = x.answered_by), false))`;
  const found = await rows<{ id: string; created_at: string | null; filed: number; decided: number; acted_on: number; unseen: number }>(
    q,
    sql`select r.id, ${iso("p.created_at")} as created_at,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id) as filed,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id and x.shown_outcome is not null and not ${unseen}) as decided,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id and x.shown_outcome in ('restricted_rule', 'restricted_legal', 'partly_reversed')) as acted_on,
               (select count(*)::int from intake_items x where x.reporter_account_id = r.id and x.shown_outcome is not null and ${unseen}) as unseen
          from unnest(${uuids(reporterIds)}) as r(id) left join profiles p on p.id = r.id`,
  );
  return new Map(found.map((row) => [row.id, { createdAt: row.created_at === null ? null : new Date(row.created_at), filed: row.filed, decided: row.decided, actedOn: row.acted_on, answeredUnseen: row.unseen }]));
}

/** A decision of the case with its texts, as the case page reads it; who decided is a handle. */
export interface CaseDecisionRow {
  id: string;
  kind: "interim" | "final" | "review" | "correction";
  outcome: string;
  ground: string | null;
  ruleId: string | null;
  rulesVersion: number;
  redressVersion: number;
  category: string;
  categoryKeyword: string | null;
  source: string;
  decidedAt: string;
  staffHandle: string;
  throughSeq: number;
  answersFromSeq: number | null;
  reviewsDecisionId: string | null;
  snapshotId: string;
  suspect: boolean;
  unseen: boolean;
  needsAdmin: boolean;
  endedInterim: boolean;
  facts: string | null;
  reason: string | null;
  legalReference: string | null;
}

/** The case's decisions, oldest first. A text is read by the digest the decision confirmed; an erased text is null. */
export async function caseDecisions(q: Runner, caseId: string): Promise<CaseDecisionRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select d.id, d.kind, d.outcome, d.ground, d.rule_id, d.rules_version, d.redress_version, d.category, d.category_keyword, d.source, ${iso("d.decided_at")} as decided_at,
               s.handle as staff_handle, d.through_seq, d.answers_from_seq, d.reviews_decision_id, d.snapshot_id, d.suspect, d.unseen, d.needs_admin, d.ended_interim,
               (select t.text from staff_texts t where t.digest = d.facts_digest) as facts,
               (select t.text from staff_texts t where t.digest = d.reason_digest) as reason,
               (select t.text from staff_texts t where t.digest = d.legal_reference_digest) as legal_reference
          from decisions d join profiles s on s.id = d.decided_by
         where d.case_id = ${caseId}::uuid order by d.decided_at, d.id`,
  );
  return found.map((row) => ({
    id: row.id as string,
    kind: row.kind as CaseDecisionRow["kind"],
    outcome: row.outcome as string,
    ground: row.ground as string | null,
    ruleId: row.rule_id as string | null,
    rulesVersion: row.rules_version as number,
    redressVersion: row.redress_version as number,
    category: row.category as string,
    categoryKeyword: row.category_keyword as string | null,
    source: row.source as string,
    decidedAt: row.decided_at as string,
    staffHandle: row.staff_handle as string,
    throughSeq: row.through_seq as number,
    answersFromSeq: row.answers_from_seq as number | null,
    reviewsDecisionId: row.reviews_decision_id as string | null,
    snapshotId: row.snapshot_id as string,
    suspect: row.suspect as boolean,
    unseen: row.unseen as boolean,
    needsAdmin: row.needs_admin as boolean,
    endedInterim: row.ended_interim as boolean,
    facts: row.facts as string | null,
    reason: row.reason as string | null,
    legalReference: row.legal_reference as string | null,
  }));
}

/** One ledger row of a decision of the case: whether it is in force by the view's one definition, and the decision whose reversal lifted it. */
export interface CaseActionRow {
  id: string;
  decisionId: string;
  kind: ActionKind;
  mediaId: string | null;
  noEffect: "already" | "deleted" | null;
  reversesActionId: string | null;
  inForce: boolean;
  liftedBy: string | null;
}

export async function caseActions(q: Runner, caseId: string): Promise<CaseActionRow[]> {
  const found = await rows<{ id: string; decision_id: string; kind: ActionKind; media_id: string | null; no_effect: CaseActionRow["noEffect"]; reverses_action_id: string | null; in_force: boolean; lifted_by: string | null }>(
    q,
    sql`select a.id, a.decision_id, a.kind, a.media_id, a.no_effect, a.reverses_action_id,
               exists (select 1 from measures_in_force m where m.id = a.id) as in_force,
               (select r.decision_id from decision_actions r where r.reverses_action_id = a.id) as lifted_by
          from decision_actions a join decisions d on d.id = a.decision_id
         where d.case_id = ${caseId}::uuid order by a.kind::text, a.media_id`,
  );
  return found.map((row) => ({ id: row.id, decisionId: row.decision_id, kind: row.kind, mediaId: row.media_id, noEffect: row.no_effect, reversesActionId: row.reverses_action_id, inForce: row.in_force, liftedBy: row.lifted_by }));
}

/** What a seal covers, from the list the database wrote when it was recorded: counts, and at most `max` rows of the list, oldest post first. */
export async function sealCovers(q: Runner, actionId: string, max: number): Promise<{ posts: number; images: number; deletedPosts: number; list: { postId: string; createdAt: string; images: number }[] }> {
  const [counts] = await rows<{ posts: number; images: number; deleted_posts: number }>(
    q,
    sql`select count(*)::int as posts, coalesce(sum(s.images), 0)::int as images, (count(*) filter (where p.state = 'deleted_by_author'))::int as deleted_posts
          from seal_posts s left join posts p on p.id = s.post_id where s.action_id = ${actionId}::uuid`,
  );
  const list = await rows<{ post_id: string; created_at: string; images: number }>(
    q,
    sql`select s.post_id, ${iso("p.created_at")} as created_at, s.images from seal_posts s join posts p on p.id = s.post_id
         where s.action_id = ${actionId}::uuid order by p.created_at, s.post_id limit ${max}::int`,
  );
  return { posts: counts!.posts, images: counts!.images, deletedPosts: counts!.deleted_posts, list: list.map((row) => ({ postId: row.post_id, createdAt: row.created_at, images: row.images })) };
}

/** The appeals of the case's decisions, oldest first; a statement is null when there was none or it was erased. */
export async function caseAppeals(q: Runner, caseId: string): Promise<{ id: string; decisionId: string; filedAt: string; statement: string | null; answeredAt: string | null; result: "kept" | "partly_reversed" | "reversed" | null; answeredBy: string | null }[]> {
  const found = await rows<{ id: string; decision_id: string; filed_at: string; statement: string | null; answered_at: string | null; result: "kept" | "partly_reversed" | "reversed" | null; answered_by: string | null }>(
    q,
    sql`select a.id, a.decision_id, ${iso("a.filed_at")} as filed_at, a.statement, ${iso("a.answered_at")} as answered_at, a.result, a.answered_by
          from appeals a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid order by a.filed_at, a.id`,
  );
  return found.map((row) => ({ id: row.id, decisionId: row.decision_id, filedAt: row.filed_at, statement: row.statement, answeredAt: row.answered_at, result: row.result, answeredBy: row.answered_by }));
}

/** The case's notes and its recorded choices not to seal, oldest first, each with its writer's handle. Erased ones are gone with their text. */
export async function caseStaffTexts(q: Runner, caseId: string): Promise<{ id: string; kind: "note" | "seal_declined"; staffHandle: string; createdAt: string; text: string }[]> {
  const found = await rows<{ id: string; kind: "note" | "seal_declined"; staff_handle: string; created_at: string; text: string }>(
    q,
    sql`select t.id, t.kind, p.handle as staff_handle, ${iso("t.created_at")} as created_at, t.text
          from staff_texts t join profiles p on p.id = t.author_id
         where t.case_id = ${caseId}::uuid and t.kind in ('note', 'seal_declined') and t.erased_at is null order by t.created_at, t.id`,
  );
  return found.map((row) => ({ id: row.id, kind: row.kind, staffHandle: row.staff_handle, createdAt: row.created_at, text: row.text }));
}

/** A saved text that no decision or reveal has named yet, with its salt. */
export interface DraftRow {
  id: string;
  kind: string;
  text: string;
  salt: string;
  digest: string;
  createdAt: string;
}

/** The staff account's own drafts on the case: unconfirmed, unerased, and of a kind that waits for a decision or a reveal. */
export async function ownDrafts(q: Runner, caseId: string, authorId: string): Promise<DraftRow[]> {
  const found = await rows<{ id: string; kind: string; text: string; salt: string; digest: string; created_at: string }>(
    q,
    sql`select id, kind, text, salt, digest, ${iso("created_at")} as created_at from staff_texts
         where case_id = ${caseId}::uuid and author_id = ${authorId}::uuid and confirmed_at is null and erased_at is null and kind not in ('note', 'seal_declined')
         order by created_at, id`,
  );
  return found.map((row) => ({ id: row.id, kind: row.kind, text: row.text, salt: row.salt, digest: row.digest, createdAt: row.created_at }));
}

/** One event of a case's history, from the view that is its one definition; a staff account is its handle. */
export interface HistoryRow {
  at: string;
  event: string;
  refId: string | null;
  seq: number | null;
  intakeKind: string | null;
  ruleId: string | null;
  allegesIllegal: boolean | null;
  csam: boolean | null;
  reexamination: boolean | null;
  decisionKind: string | null;
  outcome: string | null;
  staffHandle: string | null;
  result: string | null;
}

export async function caseHistory(q: Runner, caseId: string): Promise<HistoryRow[]> {
  const found = await rows<Record<string, unknown>>(
    q,
    sql`select ${iso("h.at")} as at, h.event, h.ref_id, h.seq, h.intake_kind, h.rule_id, h.alleges_illegal, h.csam, h.reexamination, h.decision_kind, h.outcome, p.handle as staff_handle, h.result
          from case_history h left join profiles p on p.id = h.staff_id
         where h.case_id = ${caseId}::uuid order by h.at, h.event, h.ref_id`,
  );
  return found.map((row) => ({
    at: row.at as string,
    event: row.event as string,
    refId: row.ref_id as string | null,
    seq: row.seq as number | null,
    intakeKind: row.intake_kind as string | null,
    ruleId: row.rule_id as string | null,
    allegesIllegal: row.alleges_illegal as boolean | null,
    csam: row.csam as boolean | null,
    reexamination: row.reexamination as boolean | null,
    decisionKind: row.decision_kind as string | null,
    outcome: row.outcome as string | null,
    staffHandle: row.staff_handle as string | null,
    result: row.result as string | null,
  }));
}

// ---------------------------------------------------------------- the console: saved texts

/** Everything someone else wrote on the case that a staff text must not quote: explanations, cited laws, re-examination statements and appeal statements. */
export async function theirTexts(q: Runner, caseId: string): Promise<string[]> {
  const found = await rows<{ text: string }>(
    q,
    sql`select n.explanation as text from intakes n where n.explanation is not null and exists (select 1 from intake_items i where i.intake_id = n.id and i.case_id = ${caseId}::uuid)
        union all
        select n.cited_law from intakes n where n.cited_law is not null and exists (select 1 from intake_items i where i.intake_id = n.id and i.case_id = ${caseId}::uuid)
        union all
        select i.statement from intake_items i where i.case_id = ${caseId}::uuid and i.statement is not null
        union all
        select a.statement from appeals a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid and a.statement is not null`,
  );
  return found.map((row) => row.text);
}

/** Stores a staff text; the trigger stamps it and leaves it unconfirmed, and the table's CHECK holds text, salt and digest together. Answers its id. */
export async function insertStaffText(q: Runner, row: { caseId: string; authorId: string; kind: string; text: string; salt: string; digest: string }): Promise<string> {
  const [inserted] = await rows<{ id: string }>(
    q,
    sql`insert into staff_texts (case_id, author_id, kind, text, salt, digest)
        values (${row.caseId}::uuid, ${row.authorId}::uuid, ${row.kind}::staff_text_kind, ${row.text}, ${row.salt}, ${row.digest}) returning id`,
  );
  return inserted!.id;
}

/** The staff account's own draft with this digest on this case and of this kind, or null: what a repeated save answers. */
export async function ownDraftByDigest(q: Runner, row: { caseId: string; authorId: string; kind: string; digest: string }): Promise<string | null> {
  const [found] = await rows<{ id: string }>(
    q,
    sql`select id from staff_texts where digest = ${row.digest} and case_id = ${row.caseId}::uuid and author_id = ${row.authorId}::uuid and kind = ${row.kind}::staff_text_kind
           and confirmed_at is null and erased_at is null`,
  );
  return found?.id ?? null;
}

// ---------------------------------------------------------------- the console: revealing a source

/** An item with what decides whether its source can be revealed: its case, its intake's path and what links it to a person. */
export interface RevealItemRow {
  caseId: string | null;
  intakeKind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  csam: boolean;
  reporterAccountId: string | null;
  contactId: string | null;
}

export async function revealItem(q: Runner, itemId: string): Promise<RevealItemRow | null> {
  const [row] = await rows<{ case_id: string | null; intake_kind: "user" | "finding"; channel: RevealItemRow["channel"]; csam: boolean; reporter_account_id: string | null; contact_id: string | null }>(
    q,
    sql`select i.case_id, n.kind as intake_kind, n.channel, n.csam, i.reporter_account_id, n.contact_id from intake_items i join intakes n on n.id = i.intake_id where i.id = ${itemId}::uuid`,
  );
  return row ? { caseId: row.case_id, intakeKind: row.intake_kind, channel: row.channel, csam: row.csam, reporterAccountId: row.reporter_account_id, contactId: row.contact_id } : null;
}

/** The staff account's saved reason for a reveal on this case, by its digest: unerased, unconfirmed, and named by no access row yet. Its id, or null. */
export async function revealReason(q: Runner, row: { caseId: string; authorId: string; digest: string }): Promise<string | null> {
  const [found] = await rows<{ id: string }>(
    q,
    sql`select t.id from staff_texts t
         where t.digest = ${row.digest} and t.case_id = ${row.caseId}::uuid and t.author_id = ${row.authorId}::uuid and t.kind = 'reveal_reason'
           and t.confirmed_at is null and t.erased_at is null
           and not exists (select 1 from case_access_log l where l.text_id = t.id)`,
  );
  return found?.id ?? null;
}

/** The handle of the reporter the item is still linked to, or null when the link is gone. Read only after a reveal's commit. */
export async function reporterHandle(q: Runner, itemId: string): Promise<string | null> {
  const [row] = await rows<{ handle: string }>(q, sql`select p.handle from intake_items i join profiles p on p.id = i.reporter_account_id where i.id = ${itemId}::uuid`);
  return row?.handle ?? null;
}

// ---------------------------------------------------------------- the console: the queue

/** A row of the queue with its sort key: the lane, whether it is deferred, the oldest unanswered item's time to the microsecond, and the id. */
export interface QueueRead {
  id: string;
  lane: Lane;
  targetType: TargetType;
  openedAt: string;
  oldestOpenAt: string;
  /** The same time as the database holds it, to the microsecond: the cursor's. */
  sortAt: string;
  openItems: number;
  rules: string[];
  categories: string[];
  allegesIllegal: boolean;
  suspect: boolean;
  reexamination: boolean;
  deferred: boolean;
}

/** The place after which a page of the queue begins: the last row's sort key. */
export interface QueueCursor {
  lane: number;
  deferred: boolean;
  sortAt: string;
  id: string;
}

/**
 * Open cases in the queue's order: by lane, then (only with the emergency switch on) the deferred ones last within their
 * lane, then by the oldest unanswered item, then by id. A case is deferred when every unanswered item of it comes from an
 * unproven source: in lanes 1 and 2 a signed-out intake or an account under 48 hours old, in lane 0 a signed-out intake
 * only, so a new account reporting a threat against itself is never deferred. Nothing else orders the queue: no count of
 * reports and no standing of a reporter. `limit` rows after `after`.
 */
export async function queueRows(q: Runner, options: { deferUnproven: boolean; after: QueueCursor | null; limit: number }): Promise<QueueRead[]> {
  const after = options.after;
  const found = await rows<{
    id: string;
    lane: Lane;
    target_type: TargetType;
    opened_at: string;
    oldest_open_at: string;
    sort_at: string;
    open_items: number;
    rules: string;
    categories: string;
    alleges_illegal: boolean;
    suspect: boolean;
    reexamination: boolean;
    deferred: boolean;
  }>(
    q,
    sql`with open_cases as (
          select c.id, c.lane, c.target_type, c.opened_at, coalesce(c.oldest_open_at, c.opened_at) as oldest_open_at, u.open_items, u.rules, u.categories, u.alleges_illegal, u.suspect, u.reexamination,
                 (${options.deferUnproven}::boolean and u.unproven) as deferred
            from cases c
           cross join lateral (
             select count(*)::int as open_items,
                    coalesce(string_agg(distinct n.rule_id, ',' order by n.rule_id), '') as rules,
                    coalesce(string_agg(distinct n.category, ',' order by n.category), '') as categories,
                    coalesce(bool_or(i.alleges_illegal), false) as alleges_illegal,
                    coalesce(bool_or(i.suspect), false) as suspect,
                    coalesce(bool_or(i.reexamines_item_id is not null), false) as reexamination,
                    coalesce(bool_and(n.channel = 'signed_out'
                                      or (c.lane > 0 and exists (select 1 from profiles r where r.id = i.reporter_account_id and r.created_at > now() - interval '48 hours'))), false) as unproven
               from intake_items i join intakes n on n.id = i.intake_id
              where i.case_id = c.id and i.answered_by is null) u
           where c.closed_at is null)
        select o.id, o.lane, o.target_type, ${iso("o.opened_at")} as opened_at, ${iso("o.oldest_open_at")} as oldest_open_at,
               to_char(o.oldest_open_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_at,
               o.open_items, o.rules, o.categories, o.alleges_illegal, o.suspect, o.reexamination, o.deferred
          from open_cases o
         where ${after === null ? sql`true` : sql`(o.lane, o.deferred, o.oldest_open_at, o.id) > (${after.lane}::smallint, ${after.deferred}::boolean, ${after.sortAt}::timestamptz, ${after.id}::uuid)`}
         order by o.lane, o.deferred, o.oldest_open_at, o.id
         limit ${options.limit}::int`,
  );
  const list = (joined: string) => (joined === "" ? [] : joined.split(","));
  return found.map((row) => ({
    id: row.id,
    lane: row.lane,
    targetType: row.target_type,
    openedAt: row.opened_at,
    oldestOpenAt: row.oldest_open_at,
    sortAt: row.sort_at,
    openItems: row.open_items,
    rules: list(row.rules),
    categories: list(row.categories),
    allegesIllegal: row.alleges_illegal,
    suspect: row.suspect,
    reexamination: row.reexamination,
    deferred: row.deferred,
  }));
}

// ---------------------------------------------------------------- the console: the overview

/** Per lane, the open cases and since when the oldest unanswered item of the lane waits. A lane without an open case has no row. */
export async function openByLane(q: Runner): Promise<{ lane: Lane; open: number; oldestAt: string | null }[]> {
  const found = await rows<{ lane: Lane; open: number; oldest: string | null }>(q, sql`select lane, count(*)::int as open, ${iso("min(oldest_open_at)")} as oldest from cases where closed_at is null group by lane`);
  return found.map((row) => ({ lane: row.lane, open: row.open, oldestAt: row.oldest }));
}

/** The appeals no review has answered yet. */
export async function appealsWaiting(q: Runner): Promise<number> {
  const [row] = await rows<{ n: number }>(q, sql`select count(*)::int as n from appeals where answered_by is null`);
  return row!.n;
}

/** The reveals of the last 30 days, newest first, at most `max`, with how many there are in all: time, staff handle and case. */
export async function recentReveals(q: Runner, max: number): Promise<{ total: number; items: { at: string; handle: string; caseId: string }[] }> {
  const found = await rows<{ at: string; handle: string; case_id: string; total: number }>(
    q,
    sql`select ${iso("l.at")} as at, p.handle, l.case_id, (count(*) over ())::int as total
          from case_access_log l join profiles p on p.id = l.staff_id
         where l.kind = 'identity_revealed' and l.at >= now() - interval '30 days'
         order by l.at desc, l.id desc limit ${max}::int`,
  );
  return { total: found[0]?.total ?? 0, items: found.map((row) => ({ at: row.at, handle: row.handle, caseId: row.case_id })) };
}

/** Per staff handle, the images viewed and the findings opened since midnight UTC. */
export async function staffToday(q: Runner): Promise<{ images: { handle: string; count: number }[]; findings: { handle: string; count: number }[] }> {
  const images = await rows<{ handle: string; count: number }>(
    q,
    sql`select p.handle, count(*)::int as count from case_access_log l join profiles p on p.id = l.staff_id where l.kind = 'image_viewed' and l.at >= ${TODAY} group by p.handle order by p.handle`,
  );
  const findings = await rows<{ handle: string; count: number }>(
    q,
    sql`select p.handle, count(*)::int as count from intakes n join profiles p on p.id = n.finding_by where n.kind = 'finding' and n.received_at >= ${TODAY} group by p.handle order by p.handle`,
  );
  return { images: images.map((row) => ({ handle: row.handle, count: row.count })), findings: findings.map((row) => ({ handle: row.handle, count: row.count })) };
}

/** The three kinds of mail by what they wait for, and the decided items the daily release has not released. Counts only. */
export interface MailCounts {
  receipts: number;
  authorMails: number;
  outcomes: number;
}

/**
 * Mails pending for more than an hour, counted from when each became due (an intake's receipt, a decision's time, an
 * outcome's release); mails recorded failed whose give-up time (`giveUpDays` after that same moment) falls in the last 30
 * days; and the items with an outcome that the daily release has not released 26 hours after their decision, or whose
 * changed outcome has waited that long. The release takes about a day at most, so any of the last means it is not
 * finishing.
 */
export async function mailAndReleaseCounts(q: Runner, giveUpDays: number): Promise<{ waiting: MailCounts; failed: MailCounts; releaseOverdue: number }> {
  const gaveUp = (at: string) => sql.raw(`${at} + make_interval(days => ${Number(giveUpDays)}) >= now() - interval '30 days'`);
  const [row] = await rows<Record<string, number>>(
    q,
    sql`select
          (select count(*)::int from intakes where receipt = 'pending' and received_at < now() - interval '1 hour') as receipts_waiting,
          (select count(*)::int from decisions where author_mail = 'pending' and decided_at < now() - interval '1 hour') as author_waiting,
          (select count(*)::int from intake_items where outcome_mail = 'pending' and coalesce(revised_sent_at, outcome_sent_at) < now() - interval '1 hour') as outcomes_waiting,
          (select count(*)::int from intakes where receipt = 'failed' and ${gaveUp("received_at")}) as receipts_failed,
          (select count(*)::int from decisions where author_mail = 'failed' and ${gaveUp("decided_at")}) as author_failed,
          (select count(*)::int from intake_items where outcome_mail = 'failed' and ${gaveUp("coalesce(revised_sent_at, outcome_sent_at)")}) as outcomes_failed,
          (select count(*)::int from intake_items i
            where i.outcome is not null and i.outcome_sent_at is null
              and coalesce((select d.decided_at from decisions d where d.id = i.answered_by), i.created_at) < now() - interval '26 hours')
          + (select count(*)::int from intake_items i where i.revision_pending_at < now() - interval '26 hours') as release_overdue`,
  );
  return {
    waiting: { receipts: row!.receipts_waiting!, authorMails: row!.author_waiting!, outcomes: row!.outcomes_waiting! },
    failed: { receipts: row!.receipts_failed!, authorMails: row!.author_failed!, outcomes: row!.outcomes_failed! },
    releaseOverdue: row!.release_overdue!,
  };
}
```

### Replace `apps/api/src/staff/cases.ts` (whole file)

```ts
import { Readable } from "node:stream";
import { FindingRequest, MEDIA_SIZES, MediaId, QueueQuery, StaffTextSaveRequest, type CaseDecisionResponse } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AuthError, type ActiveStaffSession, type AuthForStaff, type StaffStepUpConfirmed } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { ModerationForStaff } from "../moderation";

/** A case's id in a path, in the lower case the database writes: a read finds the case by value whatever the spelling. */
const CaseId = z.uuid().transform((id) => id.toLowerCase());
const CaseParam = z.object({ case: CaseId });
const ImageParam = z.object({ case: CaseId, media: MediaId, size: z.enum(MEDIA_SIZES) });

/**
 * The console's case routes (3c design, sections 5 and 7), a route group the staff routes mount behind the staff gate.
 * Each stands behind requireStaff; one that changes something a user sees, or that cannot be undone, stands behind
 * requireStaffStepUp as well, which verifies the key's confirmation of exactly what the route is about to do. Three
 * writing routes stand without it, by name: saving a text, taking a fresh snapshot and opening a finding. None of them
 * changes anything a user sees, and each enters the record only through a confirmed decision that names its digest or
 * its case. The handlers only call the moderation module's staff interface and shape the answer: the step-up stays the
 * auth module's, the cases the moderation module's.
 */
export function caseRoutes(auth: AuthForStaff, moderation: ModerationForStaff) {
  const routes = new Hono<AppEnv>();

  /** The session requireStaff read; a route without it in front is a wiring fault, not a refusal. */
  const staffSession = (c: Context<AppEnv>): ActiveStaffSession => {
    const session = c.get("staffSession");
    if (!session) throw new Error("a staff route ran without requireStaff");
    return session;
  };

  /** The confirmation requireStaffStepUp verified; a route without it in front is a wiring fault, not a refusal. */
  const confirmedStepUp = (c: Context<AppEnv>): StaffStepUpConfirmed => {
    const confirmed = c.get("staffStepUp");
    if (!confirmed) throw new Error("a staff route that changes something ran without requireStaffStepUp");
    return confirmed;
  };

  // The home screen's numbers, the same for every staff member.
  routes.get("/overview", auth.requireStaff, async (c) => c.json(await moderation.overview()));

  // Open cases by lane and age. The console refreshes it without the activity mark.
  routes.get("/queue", auth.requireStaff, validate("query", QueueQuery), async (c) => c.json(await moderation.queue(c.req.valid("query").cursor)));

  // A moderator's own finding opens a case, or joins the target's open one: a named exception to the step-up.
  routes.post("/findings", auth.requireStaff, validate("json", FindingRequest), async (c) => c.json(await moderation.openFinding(staffSession(c), c.req.valid("json")), 201));

  // The case. Every read is written to the access log and held to the day's limit on different cases.
  routes.get("/cases/:case", auth.requireStaff, validate("param", CaseParam), async (c) => c.json(await moderation.caseView(staffSession(c), c.req.valid("param").case)));

  // An image of the case's post, on the console's own origin: the only way an image reaches the console. The moderation
  // module answers a file only when the image may be shown to staff at all and is this case's; every refusal is one 404.
  // Never stored anywhere, and always WebP, whatever the bytes are: the store's files are checked before they are
  // handed over, and nosniff with the API's own policy keeps them inert. A HEAD request never gets here: the staff group
  // answers it before any route, so no file is opened and no view logged for a request that shows nothing.
  routes.get("/cases/:case/media/:media/:size", auth.requireStaff, validate("param", ImageParam), async (c) => {
    const { case: caseId, media, size } = c.req.valid("param");
    const file = await moderation.caseImage(staffSession(c), caseId, media, size);
    c.header("Cache-Control", "private, no-store");
    c.header("Content-Type", "image/webp");
    c.header("Content-Length", String(file.size));
    // The stream closes the handle when it ends or fails.
    return c.body(Readable.toWeb(file.handle.createReadStream()) as ReadableStream<Uint8Array>);
  });

  // A fresh snapshot of the case's target as it stands: a named exception to the step-up. It answers an id and a digest,
  // never content, so every read of a case's content goes through the case's own route.
  routes.post("/cases/:case/snapshots", auth.requireStaff, validate("param", CaseParam), async (c) => c.json(await moderation.takeSnapshot(staffSession(c), c.req.valid("param").case)));

  // Saving a text: a named exception to the step-up. The text enters the record only when a confirmed decision or reveal
  // names its digest; a note and a recorded choice not to seal are complete when saved.
  routes.post("/cases/:case/texts", auth.requireStaff, validate("param", CaseParam), validate("json", StaffTextSaveRequest), async (c) =>
    c.json(await moderation.saveText(staffSession(c), c.req.valid("param").case, c.req.valid("json")), 201),
  );
  // The person's own drafts on the case, with their salts.
  routes.get("/cases/:case/texts", auth.requireStaff, validate("param", CaseParam), async (c) => c.json(await moderation.texts(staffSession(c), c.req.valid("param").case)));

  // A decision on a case: the path's case is the action's target, and the body is the action's params with the assertion
  // as `stepUp`. The decision commits with its audit row or not at all. When the confirming key or account no longer
  // opens anything by then, the session that confirmed has ended, and requireStaff clears both cookies on that answer as
  // on its own; when the challenge's time ran out, the console asks for the key again.
  routes.post(
    "/cases/:case/decisions",
    auth.requireStaff,
    auth.requireStaffStepUp("case_decided", (c) => c.req.param("case")),
    async (c) => {
      const outcome = await moderation.decide(staffSession(c), confirmedStepUp(c), { requestId: c.get("requestId") });
      if (outcome === "ended") throw new AuthError("staff_session_required", 401);
      if (outcome === "late") throw new AuthError("challenge_expired", 400);
      const answer: CaseDecisionResponse = { decisionId: outcome.decisionId };
      return c.json(answer, 201);
    },
  );

  // Who sent an item: the path's item is the action's target, and the body is the reason's category and the digest of
  // the saved reason, with the assertion as `stepUp`. The access row and the audit row commit together or not at all, and
  // the identity is read only after that commit. An ended confirmation and a late one answer as a decision's do.
  routes.post(
    "/items/:item/reveal",
    auth.requireStaff,
    auth.requireStaffStepUp("identity_revealed", (c) => c.req.param("item")),
    async (c) => {
      const outcome = await moderation.reveal(staffSession(c), confirmedStepUp(c), { requestId: c.get("requestId") });
      if (outcome === "ended") throw new AuthError("staff_session_required", 401);
      if (outcome === "late") throw new AuthError("challenge_expired", 400);
      return c.json(outcome);
    },
  );

  return routes;
}
```

### Replace `apps/api/src/staff/routes.ts` (whole file)

```ts
import { AuditPageQuery, StaffEnrollOptionsRequest, StaffEnrollVerifyRequest, StaffSignInVerifyRequest, StaffStepUpOptionsRequest, type AuditPage } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { clearStaffCookies, setStaffCookies, type ActiveStaffSession, type AuthForStaff, type StaffRequestContext, type StaffStepUpConfirmed } from "../auth";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import type { ModerationForStaff } from "../moderation";
import { caseRoutes } from "./cases";
import { staffGate } from "./gate";

/**
 * The staff routes (3a design, section 7), which createApp mounts at /api/staff only while CONSOLE_ORIGIN is set. The gate
 * stands in front of every path under it, /api/staff itself and the paths no route answers included, so a wrong Host is
 * the 404 of an unknown route there too. Behind it, every route but enrolment and sign-in stands behind requireStaff.
 * Handlers only validate, call the auth module's staff interface or the audit reader, and shape the answer. A route that
 * changes something stands behind requireStaffStepUp as well, which verifies the key's confirmation of exactly what the
 * route is about to do; sign-out alone needs none. No route answers a HEAD request (below).
 */
export function staffRoutes(consoleOrigin: string, auth: AuthForStaff, moderation: ModerationForStaff, readAudit: (query: AuditPageQuery) => Promise<AuditPage>) {
  const routes = new Hono<AppEnv>();
  routes.use("*", staffGate(consoleOrigin));

  // No staff route answers HEAD. Hono answers a HEAD request with the handlers of the path's GET route and drops the
  // body, so the whole read would run with nothing shown to anyone: a session read and, on a marked request, its idle
  // end moved; a case's read written to the access log and counted against the day's limit; an image's file opened and
  // logged as viewed. The console never sends HEAD. So behind the gate, which every request passes first, and before any
  // route, a HEAD on every path is the unknown route, as any method is on a path that does not take it: no session is
  // read, no row written, no limit counted and no file opened.
  routes.use("*", async (c, next) => (c.req.method === "HEAD" ? c.notFound() : next()));

  // The client's address is hashed before any flow sees it, and the request's id goes to the audit rows it writes.
  const requestContext = (c: Context<AppEnv>): StaffRequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
    requestId: c.get("requestId"),
  });

  /** The session requireStaff read; a route without it in front is a wiring fault, not a refusal. */
  const staffSession = (c: Context<AppEnv>): ActiveStaffSession => {
    const session = c.get("staffSession");
    if (!session) throw new Error("a staff route ran without requireStaff");
    return session;
  };

  /** The confirmation requireStaffStepUp verified; a route without it in front is a wiring fault, not a refusal. */
  const confirmedStepUp = (c: Context<AppEnv>): StaffStepUpConfirmed => {
    const confirmed = c.get("staffStepUp");
    if (!confirmed) throw new Error("a staff route that changes something ran without requireStaffStepUp");
    return confirmed;
  };

  // Enrolment needs no session: the link's one-time token is the credential, until a key is stored with it.
  routes.post("/enroll/options", validate("json", StaffEnrollOptionsRequest), async (c) => c.json(await auth.enrollOptions(c.req.valid("json"))));
  routes.post("/enroll/verify", validate("json", StaffEnrollVerifyRequest), async (c) => c.json(await auth.enrollVerify(c.req.valid("json"), requestContext(c))));

  // Sign-in needs no session either: the staff key's assertion is the credential. The options take no body.
  routes.post("/signin/options", async (c) => c.json(await auth.signInOptions()));
  routes.post("/signin/verify", validate("json", StaffSignInVerifyRequest), async (c) => {
    const { token, me } = await auth.signInVerify(c.req.valid("json"), requestContext(c));
    // Both staff cookies, set once and never refreshed: they last the session's 12 hours.
    setStaffCookies(c, token);
    return c.json(me);
  });

  routes.get("/me", auth.requireStaff, async (c) => c.json(await auth.me(staffSession(c))));
  routes.get("/sessions", auth.requireStaff, async (c) => c.json(await auth.sessions(staffSession(c))));
  routes.get("/keys", auth.requireStaff, async (c) => c.json(await auth.keys(staffSession(c))));
  // Any staff member reads the whole record; reading is not itself recorded.
  routes.get("/audit", auth.requireStaff, validate("query", AuditPageQuery), async (c) => c.json(await readAudit(c.req.valid("query"))));
  routes.post("/signout", auth.requireStaff, async (c) => {
    await auth.signOut(staffSession(c), requestContext(c));
    clearStaffCookies(c);
    return c.body(null, 204);
  });

  // Step-up (3a design, section 7): options for confirming one action, bound to this session and to exactly the
  // { action, target, params } the console sent, which the action's own route then recomputes from what it executes.
  routes.post("/step-up/options", auth.requireStaff, validate("json", StaffStepUpOptionsRequest), async (c) =>
    c.json(await auth.stepUpOptions(staffSession(c), c.req.valid("json"))),
  );
  // One of the person's own staff sessions, revoked with a confirmation by the session's key: the path's handle is the
  // action's target, and the body is the action's params (none) with the assertion as `stepUp`. A handle that names no live
  // session of the person's is the 404 the app's own session revocation answers.
  routes.delete(
    "/sessions/:handle",
    auth.requireStaff,
    validate("param", z.object({ handle: z.uuid() })),
    auth.requireStaffStepUp("staff_session_revoked", (c) => c.req.param("handle")),
    async (c) => {
      const revoked = await auth.revokeSession(staffSession(c), confirmedStepUp(c), requestContext(c));
      return revoked ? c.body(null, 204) : c.json(errorBody("not_found", "No such session", c.get("requestId")), 404);
    },
  );

  // The console's case routes, behind the gate above like every path here.
  routes.route("/", caseRoutes(auth, moderation));

  return routes;
}
```

### Replace `packages/contracts/src/moderation.ts` (whole file)

```ts
import { z } from "zod";
import { Email, OpaqueId, TurnstileToken } from "./auth";
import { hex, sha256, sha256Bytes, sortedJson, utf8 } from "./canonical";
import { MediaId } from "./media";
import { FORBIDDEN_FORMAT } from "./text";

// Moderation cases (3c design, section 10): the constants and digests that the database, the API, the console, the app,
// the mails and the terms share. Each is the one source its words and numbers are taken from. This module imports
// nothing from staff.ts, and the index evaluates it first, so staff.ts can read these constants while it loads; an import
// the other way round would be a cycle that fails at load. For the same reason it imports nothing from social.ts, whose
// shapes may come to name this module's constants: what a notice needs of a post's id and of a handle is written here.

// ---------------------------------------------------------------- rules, categories and keywords

/** The rulebook's rule ids. @korbat/rules holds the rules themselves; the contracts never import it. */
export const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
export type RuleId = (typeof RULE_IDS)[number];

/**
 * The 16 categories of the Commission's Transparency Database (read 2026-10-02), which every intake and decision carries.
 * The migration's CHECK lists are written from this constant, and a database test holds them to it. A value the
 * Commission removes stays here: a kept row may hold it, and only the lists offered for new input drop it.
 */
export const TDB_CATEGORIES = [
  "STATEMENT_CATEGORY_ANIMAL_WELFARE",
  "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
  "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
  "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
  "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
  "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
  "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
  "STATEMENT_CATEGORY_SELF_HARM",
  "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
  "STATEMENT_CATEGORY_VIOLENCE",
] as const;
export type TdbCategory = (typeof TDB_CATEGORIES)[number];

/** The two categories a notifier never chooses: a rule-only report gets the first, a notifier who is not sure the second. */
type UnofferedCategory = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" | "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE";
export type TdbFormCategory = Exclude<TdbCategory, UnofferedCategory>;

/** The 14 categories the illegal-ground form shows. */
export const TDB_FORM_CATEGORIES: readonly TdbFormCategory[] = TDB_CATEGORIES.filter(
  (category): category is TdbFormCategory => category !== "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" && category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
);

/**
 * The four choices of the path for child sexual abuse material and the Transparency Database keyword each stores. "abuse"
 * stores none: the database has no keyword for it.
 */
export const CSAM_KEYWORDS = {
  csam: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
  deepfake: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE",
  grooming: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS",
  abuse: null,
} as const;
export type CsamKeywordChoice = keyof typeof CSAM_KEYWORDS;

/** The keywords a decision on the law may carry: in 3c only the Transparency Database's "Terrorist content". */
export const DECISION_KEYWORDS = ["KEYWORD_TERRORIST_CONTENT"] as const;
export type DecisionKeyword = (typeof DECISION_KEYWORDS)[number];

/** The category the composer presets for a decision under each rule. */
export const RULE_DEFAULT_CATEGORY = {
  R1: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  R2: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  R3: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  R4: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  R5: "STATEMENT_CATEGORY_VIOLENCE",
  R6: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
} as const satisfies Record<RuleId, TdbCategory>;

// ---------------------------------------------------------------- lanes

/** The queue's lanes: 0 is the most urgent. A case takes the most severe lane of its unanswered items. */
export type Lane = 0 | 1 | 2;

/** R2 and R5 are urgent; R3 and R4 come next; R1 and R6 last. */
const RULE_LANES: Record<RuleId, Lane> = { R1: 2, R2: 0, R3: 1, R4: 1, R5: 0, R6: 2 };

/** The categories that are not in lane 2: violence, public security and self-harm are urgent; six more come next. */
const CATEGORY_LANES: Partial<Record<TdbCategory, Lane>> = {
  STATEMENT_CATEGORY_VIOLENCE: 0,
  STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY: 0,
  STATEMENT_CATEGORY_SELF_HARM: 0,
  STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN: 1,
  STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH: 1,
  STATEMENT_CATEGORY_PROTECTION_OF_MINORS: 1,
  STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE: 1,
};

/**
 * The lane of an intake's items, from its ground alone: nothing is weighted. The CSAM path is urgent whatever else is
 * said. Otherwise it is the more severe of the cited rule's lane and, on a notice that alleges illegality, the category's:
 * only there is the category a claim about the content, where on a rule report or a finding it is korbat's own
 * classification for the Transparency Database.
 */
export function laneFor(input: { ruleId: RuleId | null; allegesIllegal: boolean; csam: boolean; category: TdbCategory }): Lane {
  if (input.csam) return 0;
  const byRule: Lane = input.ruleId === null ? 2 : RULE_LANES[input.ruleId];
  const byCategory: Lane = input.allegesIllegal ? (CATEGORY_LANES[input.category] ?? 2) : 2;
  return byRule < byCategory ? byRule : byCategory;
}

// ---------------------------------------------------------------- limits and periods

/**
 * What one sender may send, published in the terms: intakes an hour and a day per network signed out and per account
 * signed in, the targets one notice names, and the bounds of its two texts in characters (the migration's CHECKs hold
 * the same numbers).
 */
export const NOTICE_LIMITS = {
  signedOut: { perHour: 5, perDay: 20 },
  signedIn: { perHour: 10, perDay: 50 },
  maxTargets: 10,
  explanationMax: 2000,
  citedLawMax: 300,
} as const;

/** A notice on the CSAM path names at most one account: one such target reaches every image on the account's posts. */
export const CSAM_NOTICE_MAX_ACCOUNTS = 1;

/** How many months back a case page counts earlier answers to reports of this kind about the same target or author. */
export const SUSPECT_EARLIER_MONTHS = 12;

/** How many rows of a seal's list the case answer carries. */
export const SEAL_LIST_MAX = 500;

/** The author's appeal and the re-examination window, in calendar months (appealDeadline, and appeal_deadline in SQL). */
export const APPEAL_MONTHS = 6;

/** Appeals a day per account, and re-examinations a day per account or network. */
export const DAILY_LIMITS = { appeals: 5, reexaminations: 5 } as const;

/**
 * How long 3c keeps each kind of data (the design's section 6.6), published in the terms. Each is a design choice, not a
 * legal figure.
 */
export const RETENTION = {
  /** Content restricted under R4 is erased once the restriction is final: this long after its author was told, or at the answer to their appeal. */
  r4FinalMonths: APPEAL_MONTHS,
  /** An intake's record (its texts and who sent it) goes this long after its last release. */
  intakeDays: 30,
  /** A reset field's old value stays readable this long after a lift that comes before the case's copies are erased. */
  resetValueDays: 30,
  /** A case's evidence waits this long after the case's newest snapshot or draft text. */
  evidenceHours: 24,
  /** Statements are erased this long after the account's deletion. */
  statementMonths: 12,
  /** The access log, and the reveal reasons its rows name. */
  accessLogMonths: 12,
  /** A notifier's contact goes this long after the last day korbat owed the notice something, */
  contactMonths: 6,
  /** and at most this long after the notice when nothing moved that day. */
  contactMaxMonths: 13,
  /** A notifier's confirmation of an address. */
  confirmationDays: 30,
  /** Backups are deleted this long after each was taken. No code of 3c enforces it: the README tells the operator. */
  backupDays: 30,
  /** An unconfirmed staff text is deleted after this long. */
  draftHours: 24,
  /** A mail still unsent this long after it was due is given up. */
  mailGiveUpDays: 5,
} as const;

// ---------------------------------------------------------------- measures

/** The ledger's kinds, in the order of the database's action_kind: the seven measures, then the five reversals. */
export const ACTION_KINDS = [
  "withhold",
  "remove",
  "seal_media",
  "withhold_media",
  "remove_media",
  "reset_display_name",
  "reset_bio",
  "restore",
  "unseal_media",
  "restore_media",
  "restore_display_name",
  "restore_bio",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** What a measure acts on: a post, one image of it, every image its case reaches, or one of an account's two fields. */
export type MeasureTarget = "post" | "image" | "images" | "display_name" | "bio";

export interface MeasureSpec {
  /** A decision taken while deciding (interim) may hold it. */
  interim: boolean;
  /** A decision that decides the case (final) may hold it. */
  final: boolean;
  /** For a reversal, the measures it lifts (it names exactly one row of them); null for a measure. */
  lifts: readonly ActionKind[] | null;
  target: MeasureTarget;
  /** The words for it in the composer, the statement and the terms. */
  label: string;
}

/**
 * Every kind of the ledger: whether it is taken while deciding, when the case is decided, or is a reversal; its target;
 * and its label. A post or one image is withheld only while deciding and removed only when the case is decided; a seal
 * and a field reset are either. A reversal is neither: the database's triggers say which decision may hold one.
 */
export const MEASURES = {
  withhold: { interim: true, final: false, lifts: null, target: "post", label: "Withhold the post" },
  remove: { interim: false, final: true, lifts: null, target: "post", label: "Remove" },
  seal_media: { interim: true, final: true, lifts: null, target: "images", label: "Seal the images this case reaches" },
  withhold_media: { interim: true, final: false, lifts: null, target: "image", label: "Withhold one image" },
  remove_media: { interim: false, final: true, lifts: null, target: "image", label: "Remove one image" },
  reset_display_name: { interim: true, final: true, lifts: null, target: "display_name", label: "Reset display name" },
  reset_bio: { interim: true, final: true, lifts: null, target: "bio", label: "Reset bio" },
  restore: { interim: false, final: false, lifts: ["withhold", "remove"], target: "post", label: "Lift the restriction of the post" },
  unseal_media: { interim: false, final: false, lifts: ["seal_media"], target: "images", label: "Lift the seal" },
  restore_media: { interim: false, final: false, lifts: ["withhold_media", "remove_media"], target: "image", label: "Lift the restriction of one image" },
  restore_display_name: { interim: false, final: false, lifts: ["reset_display_name"], target: "display_name", label: "Lift the reset of the display name" },
  restore_bio: { interim: false, final: false, lifts: ["reset_bio"], target: "bio", label: "Lift the reset of the bio" },
} as const satisfies Record<ActionKind, MeasureSpec>;

/** One measure or reversal as a decision's confirmed params name it: its kind, and for an image measure the image. */
export interface DecisionActionParams {
  kind: ActionKind;
  mediaId: string | null;
}

/**
 * The one order a decision's actions are confirmed in: by kind and then by image, each compared as a string, an action
 * without an image first. The console sorts with it before it asks for the key, and the params' schema refuses any other
 * order, so the same decision always has the same hash.
 */
export function compareDecisionActions(a: DecisionActionParams, b: DecisionActionParams): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const [left, right] = [a.mediaId ?? "", b.mediaId ?? ""];
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Why a moderator reveals who sent a report: the choices of the reveal dialog. The reason itself is a saved text. */
export const REVEAL_REASON_CATEGORIES = ["impersonation_claim", "abuse_of_reporting", "legal_requirement", "other"] as const;
export type RevealReasonCategory = (typeof REVEAL_REASON_CATEGORIES)[number];

// ---------------------------------------------------------------- errors

/**
 * Every code the moderation flows put in ErrorEnvelope.error.code so far: what sending a report or a notice, reading its
 * status, taking it in and deciding a case raise, and what the console's case routes answer (a text that cannot be saved,
 * an image that is not shown, a source that cannot be revealed). The routes may also answer the shared invalid_request,
 * onboarding_required, not_found, rate_limited and service_unavailable, and the staff routes the staff codes. The codes
 * the database keeps to itself (moderation_column, quote_item_missing, read_committed_only) are not among them: no route
 * answers one.
 */
export const ModerationErrorCode = z.enum([
  "notice_link_invalid",
  "notice_link_offsite",
  "human_check_failed",
  "staff_cannot_report",
  "notice_not_found",
  "already_reported",
  "case_changed",
  "case_closed",
  "staff_recused",
  "staff_target",
  "admin_required",
  "decision_cap",
  "profile_changed",
  "snapshot_mismatch",
  "snapshot_erased",
  "text_not_found",
  "invalid_decision",
  "text_invalid",
  "text_quotes_user",
  "image_refused",
  "reveal_refused",
]);
export type ModerationErrorCode = z.infer<typeof ModerationErrorCode>;

// ---------------------------------------------------------------- reports and notices

/**
 * The rules a report or a notice may cite. R2 is offered nowhere: a report of child sexual abuse material goes a path of
 * its own, which records no sender, and only a moderator's finding cites R2 (the database refuses a user's intake that
 * does).
 */
export const REPORT_RULE_IDS = ["R1", "R3", "R4", "R5", "R6"] as const satisfies readonly RuleId[];
export type ReportRuleId = (typeof REPORT_RULE_IDS)[number];

/** How many characters the name a signed-out notifier gives may have. */
export const NOTICE_NAME_MAX = 100;

/** Any control character but the line feed. */
const TEXT_CONTROL = /[^\P{Cc}\n]/u;
/** Any control character at all: a name is one line. */
const LINE_CONTROL = /\p{Cc}/u;

const NOT_WELL_FORMED = { message: "half of a surrogate pair is not text" };
const NO_CONTROL = { message: "control characters are not allowed" };
const NO_FORMAT = { message: "invisible direction and spacing characters are not allowed" };
const SOME_TEXT = { message: "some text is needed" };

/**
 * A free text of a notice. The server stores it as it was written or refuses it, and never changes it: a well-formed
 * string with some text in it, no control character but the line feed, none of the invisible direction and spacing
 * characters, and at most `max` characters as PostgreSQL's char_length counts them, which is what the tables' CHECKs hold.
 */
const noticeText = (max: number) =>
  z
    .string()
    // A character outside the basic plane is two UTF-16 units, so this bound never refuses what the count below accepts.
    .max(2 * max)
    .refine(isWellFormed, NOT_WELL_FORMED)
    .refine((text) => !TEXT_CONTROL.test(text), NO_CONTROL)
    .refine((text) => !FORBIDDEN_FORMAT.test(text), NO_FORMAT)
    .refine((text) => text.trim().length > 0, SOME_TEXT)
    .refine((text) => Array.from(text).length <= max, { message: `at most ${max} characters` });

/** The name a signed-out notifier may give: one line under the same rules. */
const NotifierName = z
  .string()
  .max(2 * NOTICE_NAME_MAX)
  .refine(isWellFormed, NOT_WELL_FORMED)
  .refine((name) => !LINE_CONTROL.test(name), NO_CONTROL)
  .refine((name) => !FORBIDDEN_FORMAT.test(name), NO_FORMAT)
  .refine((name) => name.trim().length > 0, SOME_TEXT)
  .refine((name) => Array.from(name).length <= NOTICE_NAME_MAX, { message: `at most ${NOTICE_NAME_MAX} characters` });

/** A post's id in the lower case PostgreSQL returns, so an id written in any case names the same row. */
const TargetPostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle as a notice names it: an optional leading @, then the 3 to 20 characters handles may contain, kept in lower case. */
const TargetHandle = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

/**
 * A link as a notice gives it: an http or https address of at most 300 characters, kept as written. Whether it is an
 * address of this korbat, and of what, the route decides.
 */
const TargetLink = z.url({ protocol: /^https?$/ }).max(300);

/**
 * What a report or a notice names: a post by its id, optionally with the one of its images that is meant; an account by
 * its handle; or a korbat link, which the server parses. Nothing else can be named, and nothing can be attached.
 */
export const NoticeTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("post"), id: TargetPostId, mediaId: MediaId.optional() }),
  z.strictObject({ kind: z.literal("account"), handle: TargetHandle }),
  z.strictObject({ kind: z.literal("link"), url: TargetLink }),
]);
export type NoticeTarget = z.infer<typeof NoticeTarget>;

const NoticeTargets = z.array(NoticeTarget).min(1).max(NOTICE_LIMITS.maxTargets);
const ReportRule = z.enum(REPORT_RULE_IDS);

/** The categories an illegal-ground notice may carry: the 14 the form shows, and "not specified" for someone who is not sure. */
const NoticeCategory = z.enum([...TDB_FORM_CATEGORIES, "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"] as const);

/** The four choices of the path for child sexual abuse material. */
const CsamChoice = z.enum(Object.keys(CSAM_KEYWORDS) as [CsamKeywordChoice, ...CsamKeywordChoice[]]);

/**
 * One report or notice, by its ground. Each ground is a strict shape, so a member that belongs to another ground is
 * refused rather than ignored:
 *   - `rule`: it breaks a korbat rule (any but R2), with an optional explanation;
 *   - `illegal`: an Art. 16 notice that it is illegal, with the category, the explanation and the statement of good
 *     faith the Article asks for, optionally the law, a rule it also breaks and, from someone signed out, a name and an
 *     address (a signed-in sender's contact is their account, and the route refuses either from them);
 *   - `csam`: the path for child sexual abuse material, which asks no name or address and records no sender; its
 *     explanation and statement are optional, and it names at most CSAM_NOTICE_MAX_ACCOUNTS accounts, counted by the
 *     handles as named (the route counts again once the links are parsed).
 * `turnstileToken` is the human check of a signed-out sender; a signed-in sender's is ignored.
 */
export const NoticeRequest = z.discriminatedUnion("ground", [
  z.strictObject({
    ground: z.literal("rule"),
    ruleId: ReportRule,
    targets: NoticeTargets,
    explanation: noticeText(NOTICE_LIMITS.explanationMax).optional(),
    turnstileToken: TurnstileToken.optional(),
  }),
  z.strictObject({
    ground: z.literal("illegal"),
    targets: NoticeTargets,
    category: NoticeCategory,
    citedLaw: noticeText(NOTICE_LIMITS.citedLawMax).optional(),
    explanation: noticeText(NOTICE_LIMITS.explanationMax),
    bonaFide: z.literal(true),
    ruleId: ReportRule.optional(),
    name: NotifierName.optional(),
    email: Email.optional(),
    turnstileToken: TurnstileToken.optional(),
  }),
  z
    .strictObject({
      ground: z.literal("csam"),
      targets: NoticeTargets,
      keyword: CsamChoice,
      explanation: noticeText(NOTICE_LIMITS.explanationMax).optional(),
      bonaFide: z.boolean().optional(),
      turnstileToken: TurnstileToken.optional(),
    })
    .refine((notice) => new Set(notice.targets.flatMap((target) => (target.kind === "account" ? [target.handle] : []))).size <= CSAM_NOTICE_MAX_ACCOUNTS, {
      message: `a notice of this kind names at most ${CSAM_NOTICE_MAX_ACCOUNTS} account`,
      path: ["targets"],
    }),
]);
export type NoticeRequest = z.infer<typeof NoticeRequest>;

/** A notice's public reference: N- and ten base32 characters. */
export const NoticeRef = z.string().regex(/^N-[A-Z2-7]{10}$/);

/**
 * The answer to a report or a notice. The token comes only with a notice sent signed out or on the path for child sexual
 * abuse material: it opens the status page, and is shown once.
 */
export const NoticeResponse = z.object({ ref: NoticeRef, token: OpaqueId.optional() });
export type NoticeResponse = z.infer<typeof NoticeResponse>;

/** What the status page sends: the reference with the notice's own token, or with the token of a mail's link. */
export const NoticeStatusRequest = z.strictObject({ ref: NoticeRef, token: OpaqueId });
export type NoticeStatusRequest = z.infer<typeof NoticeStatusRequest>;

/** The page's two buttons, for which only the token of a mail's link works: "I sent this", or "stop korbat's mails about reports to this address". */
export const NoticeContactRequest = z.strictObject({ ref: NoticeRef, token: OpaqueId, choice: z.enum(["confirm", "stop"]) });
export type NoticeContactRequest = z.infer<typeof NoticeContactRequest>;

/** What an item's sender can be shown, as the database's item_outcome lists them. */
export const ITEM_OUTCOMES = ["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"] as const;
export const ItemOutcome = z.enum(ITEM_OUTCOMES);
export type ItemOutcome = z.infer<typeof ItemOutcome>;

/**
 * One item of a notice as its sender reads it. `link` is the item's korbat address, an account's built from the handle
 * as the notice named it and never from the handle the profile holds now. `scope` says what the answer concerns
 * (`account`, `quote`, `account_suspect`, or null). An item about an account carries its scope from the first moment,
 * whatever the handle named: `account_suspect` when the item is suspect or, once released, when its answering decision
 * sealed images, and `account` otherwise. `quote`, for a post that quotes another, comes only with the released outcome,
 * so that before the release nothing tells a live target from a link that names nothing. The page and the app add the
 * scope's sentence after every outcome but `not_available`. `quotedBy` is the position of the item this one was added for,
 * when korbat added it for a quoted post. `outcome` and `decidedOn` (a UTC day) stay null until the outcome is released,
 * and `sealed`, `unseen` and `reexamination` say nothing before that either: `sealed` that the answering decision sealed
 * images, `unseen` that it was taken while nobody could open the post's images, `reexamination` whether a re-examination
 * can still be asked for and until when (null for an item that cannot be re-examined). `changed` marks an outcome that a
 * review or a correction changed, `reexamines` the item of a re-examination.
 */
export const NoticeItemStatus = z.object({
  position: z.number().int().min(1).max(20),
  link: z.string(),
  scope: z.enum(["account", "quote", "account_suspect"]).nullable(),
  suspect: z.boolean(),
  sealed: z.boolean(),
  unseen: z.boolean(),
  quotedBy: z.number().int().min(1).max(10).nullable(),
  outcome: ItemOutcome.nullable(),
  decidedOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).nullable(),
  changed: z.boolean(),
  reexamines: z.boolean(),
  reexamination: z.object({ open: z.boolean(), until: z.string() }).nullable(),
});
export type NoticeItemStatus = z.infer<typeof NoticeItemStatus>;

/**
 * The status page's answer. `items` holds the items the notice named, by position, and an item korbat added for a
 * quoted post directly after the item it was added for, from the first release that shows that item's outcome or its
 * own: listed earlier, it would tell that the named post exists. `contact` is null for a notice that left no name or
 * address; `confirmed` and `stopped` are null unless the request carried the token of a mail's link, so the answer to
 * whoever typed an address never depends on what korbat knows about that address.
 */
export const NoticeStatus = z.object({
  ref: NoticeRef,
  receivedAt: z.string(),
  items: z.array(NoticeItemStatus),
  contact: z.object({ given: z.boolean(), confirmed: z.boolean().nullable(), stopped: z.boolean().nullable() }).nullable(),
});
export type NoticeStatus = z.infer<typeof NoticeStatus>;

// ---------------------------------------------------------------- digests

/** Names the rule a text's digest is made by; a later rule gets a later tag. */
export const TEXT_DIGEST_TAG = "korbat.text.v1";

const SALT_HEX = /^[0-9a-f]{64}$/;

/** Whether every surrogate in the text is half of a pair: only then has it UTF-8 bytes. */
function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * The salted digest of a free text (a staff text, a statement): the lower-case hex sha256 of the tag's bytes, a line
 * feed, the salt's 32 bytes and the text's UTF-8 bytes. The API, the console and text-verify call it, and the database's
 * CHECKs compute the same, so a stored text is always the one its digest names. The salt keeps a short text from being
 * confirmed by hashing guesses. A malformed salt or text is refused, never changed: TextEncoder would otherwise hash a
 * lone surrogate as another character.
 */
export async function textDigest(saltHex: string, text: string): Promise<string> {
  if (!SALT_HEX.test(saltHex)) throw new TypeError("a text digest's salt is 32 bytes as 64 lower-case hex characters");
  if (!isWellFormed(text)) throw new TypeError("a text digest is taken over a well-formed text: a lone surrogate has no UTF-8 bytes");
  const tag = utf8(TEXT_DIGEST_TAG);
  const body = utf8(text);
  const bytes = new Uint8Array(tag.length + 1 + 32 + body.length);
  bytes.set(tag, 0);
  bytes[tag.length] = 0x0a;
  for (let i = 0; i < 32; i++) bytes[tag.length + 1 + i] = Number.parseInt(saltHex.slice(2 * i, 2 * i + 2), 16);
  bytes.set(body, tag.length + 33);
  return hex(await sha256Bytes(bytes));
}

/** Names the rule a snapshot's digest is made by. */
export const SNAPSHOT_DIGEST_TAG = "korbat.snapshot.v1";

/**
 * What a snapshot's digest covers: its salt and everything it copied. A post's snapshot leaves the three profile fields
 * null, an account's the post's. Each image is its id, alt text and size, in position order; an alt text is null for an
 * image whose content was erased.
 */
export interface SnapshotDigestInput {
  salt: string;
  targetType: "post" | "account";
  targetId: string;
  /** When the snapshot was taken, as Date.prototype.toISOString writes it. */
  takenAt: string;
  authorHandle: string;
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | null;
  /** As Date.prototype.toISOString writes it. */
  postCreatedAt: string | null;
  replyToId: string | null;
  quoteOfId: string | null;
  body: string | null;
  media: { id: string; alt: string | null; width: number; height: number }[] | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
}

/** A time as toISOString writes it: UTC, to the millisecond. Any other spelling of the same instant would hash differently. */
const ISO_MILLIS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/;

function isoTime(name: string, value: string): string {
  if (!ISO_MILLIS.test(value)) throw new TypeError(`a snapshot's ${name} is a UTC time to the millisecond, as toISOString writes it`);
  return value;
}

/**
 * The text a snapshot's digest is taken over: the sorted JSON of version 1 and the snapshot's members, each picked by
 * name, so that whatever else an answer carries, and in whatever order, the API and the console write the same text.
 */
export function snapshotText(snapshot: SnapshotDigestInput): string {
  return sortedJson({
    v: 1,
    salt: snapshot.salt,
    targetType: snapshot.targetType,
    targetId: snapshot.targetId,
    takenAt: isoTime("takenAt", snapshot.takenAt),
    authorHandle: snapshot.authorHandle,
    postState: snapshot.postState,
    postCreatedAt: snapshot.postCreatedAt === null ? null : isoTime("postCreatedAt", snapshot.postCreatedAt),
    replyToId: snapshot.replyToId,
    quoteOfId: snapshot.quoteOfId,
    body: snapshot.body,
    media: snapshot.media === null ? null : snapshot.media.map((image) => ({ id: image.id, alt: image.alt, width: image.width, height: image.height })),
    displayName: snapshot.displayName,
    bio: snapshot.bio,
    handle: snapshot.handle,
  });
}

/** A snapshot's digest: the lower-case hex sha256 of the tag, a line feed and snapshotText, in UTF-8. */
export async function snapshotDigest(snapshot: SnapshotDigestInput): Promise<string> {
  return hex(await sha256(`${SNAPSHOT_DIGEST_TAG}\n${snapshotText(snapshot)}`));
}

/**
 * The end of the author's appeal window and of the re-examination window: APPEAL_MONTHS calendar months after the person
 * was told, in UTC, at the same time of day. A day the target month lacks becomes that month's last day (31 August gives
 * the end of February). PostgreSQL's appeal_deadline computes the same; a test holds the two equal over every month end.
 */
export function appealDeadline(informedAt: Date): Date {
  const year = informedAt.getUTCFullYear();
  const month = informedAt.getUTCMonth() + APPEAL_MONTHS;
  // Day 0 of the month after the target month is the target month's last day; Date.UTC carries a month past 11 into the year.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(informedAt.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, informedAt.getUTCHours(), informedAt.getUTCMinutes(), informedAt.getUTCSeconds(), informedAt.getUTCMilliseconds()));
}

// ---------------------------------------------------------------- the console: findings, saved texts and reveals

/**
 * The categories a moderator's own finding may carry: every one of the Transparency Database's but "not specified",
 * which says that a notifier was not sure. A finding is korbat's own classification, never a notice. The console offers
 * exactly this list, so the form and the request's schema cannot come apart.
 */
export const FINDING_CATEGORIES: readonly TdbCategory[] = TDB_CATEGORIES.filter((category) => category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE");
const FindingCategory = z.enum(FINDING_CATEGORIES as [TdbCategory, ...TdbCategory[]]);

/**
 * POST /api/staff/findings: a moderator's own finding. It names one target, as a notice does, cites a korbat rule (R2
 * among them: only a finding cites it) and carries a category. It has no other ground: a finding never alleges
 * illegality, so nothing the console sends can mark a decision as one that followed a notice or an order, and what the
 * moderator writes about it is a saved text, never a member of this request.
 */
export const FindingRequest = z.strictObject({ target: NoticeTarget, ground: z.literal("rule"), ruleId: z.enum(RULE_IDS), category: FindingCategory });
export type FindingRequest = z.infer<typeof FindingRequest>;

/** The case the finding opened or joined. */
export const FindingResponse = z.object({ caseId: z.uuid() });
export type FindingResponse = z.infer<typeof FindingResponse>;

/**
 * The kinds of text staff save, as the database's staff_text_kind lists them. A note and a recorded choice not to seal
 * are complete when saved; every other kind waits for the decision or the reveal that names it.
 */
export const STAFF_TEXT_KINDS = ["facts", "reason", "legal_reference", "review_reason", "reveal_reason", "note", "seal_declined"] as const;
export type StaffTextKind = (typeof STAFF_TEXT_KINDS)[number];

/** The longest text staff may save, in UTF-16 units: the bound of the Transparency Database's facts field. */
export const STAFF_TEXT_MAX = 5000;

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lower-case hex characters");

/**
 * What is wrong with a text staff want to save, or null: it must be well formed (no half of a surrogate pair), hold no
 * control character below the space but the line feed, none of the invisible direction and spacing characters, and at
 * most STAFF_TEXT_MAX UTF-16 units. The server refuses such a text and never changes it; the console checks with the
 * same function before it sends one.
 */
export function staffTextProblem(text: string): "malformed" | "control" | "format" | "too_long" | null {
  if (!isWellFormed(text)) return "malformed";
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x20 && unit !== 0x0a) return "control";
  }
  if (FORBIDDEN_FORMAT.test(text)) return "format";
  if (text.length > STAFF_TEXT_MAX) return "too_long";
  return null;
}

/**
 * POST /api/staff/cases/:case/texts: a text with the salt the console drew and the digest it computed (textDigest). The
 * schema lets any string through: what a text must be is the route's to refuse, with text_invalid, so the console can
 * say what is wrong with it in place. A text of nothing, or of white space alone, the route refuses as an invalid
 * request, whatever its kind: no reason, no facts and no note is saved empty.
 */
export const StaffTextSaveRequest = z.strictObject({ kind: z.enum(STAFF_TEXT_KINDS), text: z.string(), salt: Hex64, digest: Hex64 });
export type StaffTextSaveRequest = z.infer<typeof StaffTextSaveRequest>;

/** The stored text's id and its digest, as the server recomputed it. */
export const StaffTextSaved = z.object({ id: z.uuid(), digest: Hex64 });
export type StaffTextSaved = z.infer<typeof StaffTextSaved>;

/** One of the person's own texts that no decision or reveal has named yet, with its salt, so the console can check it against its digest. */
export const StaffTextDraft = z.object({ id: z.uuid(), kind: z.enum(STAFF_TEXT_KINDS), text: z.string(), salt: Hex64, digest: Hex64, createdAt: z.iso.datetime() });
export type StaffTextDraft = z.infer<typeof StaffTextDraft>;

/** GET /api/staff/cases/:case/texts: the person's own drafts on the case, so a draft survives a reload or a sign-in. */
export const StaffTextsResponse = z.object({ texts: z.array(StaffTextDraft) });
export type StaffTextsResponse = z.infer<typeof StaffTextsResponse>;

/** POST /api/staff/cases/:case/snapshots: the new snapshot's id and digest, or the newest one's when nothing differed. Never its content: that is read with the case. */
export const StaffSnapshotTaken = z.object({ id: z.uuid(), digest: Hex64 });
export type StaffSnapshotTaken = z.infer<typeof StaffSnapshotTaken>;

/**
 * POST /api/staff/items/:item/reveal answers who sent the item: a signed-in reporter's handle, or the name a signed-out
 * notifier gave. Both are null when the name was forgotten between the confirmation and the read. Never an address.
 */
export const RevealResponse = z.object({ handle: z.string().nullable(), name: z.string().nullable() });
export type RevealResponse = z.infer<typeof RevealResponse>;

// ---------------------------------------------------------------- the console: the queue, the case and the overview

const UtcDay = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "must be a UTC day");
const Count = z.number().int().nonnegative();
const LaneNumber = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const TargetKind = z.enum(["post", "account"]);
const StoredPostState = z.enum(["visible", "withheld", "removed", "deleted_by_author"]);

/** How many cases one page of the queue holds. */
export const QUEUE_PAGE_SIZE = 50;

/**
 * One open case as the queue lists it: its lane, what it is about, since when it and its oldest unanswered item wait,
 * and what its unanswered items cite. `deferred` is set only under the emergency switch. Nothing here weighs a case:
 * the queue orders by lane and age alone.
 */
export const QueueRow = z.object({
  id: z.uuid(),
  lane: LaneNumber,
  targetType: TargetKind,
  openedAt: z.iso.datetime(),
  oldestOpenAt: z.iso.datetime(),
  openItems: Count,
  rules: z.array(z.enum(RULE_IDS)),
  categories: z.array(z.enum(TDB_CATEGORIES)),
  allegesIllegal: z.boolean(),
  suspect: z.boolean(),
  reexamination: z.boolean(),
  deferred: z.boolean(),
});
export type QueueRow = z.infer<typeof QueueRow>;

/** GET /api/staff/queue: a page of the queue in its order, and the cursor that asks for the next; null when there is none. */
export const QueuePage = z.object({ cases: z.array(QueueRow).max(QUEUE_PAGE_SIZE), nextCursor: z.string().nullable() });
export type QueuePage = z.infer<typeof QueuePage>;

/** The queue's cursor is the last row's sort key, as an opaque word the server made. */
export const QueueQuery = z.object({ cursor: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/).optional() });
export type QueueQuery = z.infer<typeof QueueQuery>;

/** The fixed words for a source that is no signed-in reporter. A reporter's label is its letter: reporterLabel. */
export const SOURCE_LABELS = {
  notifier: "A notifier",
  anonymous: "Anonymous",
  staff: "Found by a moderator",
  unlinked: "A signed-in reporter no longer linked",
} as const;

/**
 * A signed-in reporter's label on one case: "Reporter A" for the first reporter of the case, "Reporter B" for the
 * second, and after Z two letters and more, as a spreadsheet names its columns. The letter is given per case, so one
 * person's letter on one case says nothing about another.
 */
export function reporterLabel(index: number): string {
  let letters = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) letters = String.fromCharCode(65 + (n % 26)) + letters;
  return `Reporter ${letters}`;
}

/**
 * Who sent an item, as staff see it without a reveal: never a name, a handle or an address. A signed-in reporter is a
 * letter and four bands computed on read (the account's age, the items it filed, the share of its decided items that
 * were acted on, and the items answered while nobody could open the images, which are counted apart); a signed-out
 * notifier is whether a name and an address were given, confirmed or stopped, or that the contact is lost; a notice on
 * the path for child sexual abuse material is anonymous; a finding was found by a moderator. The label is one of the
 * console's own words for its kind, so no answer can put a text of its choosing where the console names a source.
 */
export const SourceSummary = z
  .object({
    kind: z.enum(["reporter", "notifier", "anonymous", "staff", "unlinked"]),
    label: z.string().max(40),
    accountAge: z.enum(["under_1_month", "1_to_12_months", "over_12_months"]).nullable(),
    itemsFiled: z.enum(["1", "2_to_9", "10_or_more"]).nullable(),
    actedOn: z.enum(["none_decided", "none", "under_half", "half_or_more"]).nullable(),
    answeredUnseen: z.enum(["none", "1", "2_to_9", "10_or_more"]).nullable(),
    named: z.boolean().nullable(),
    contactGiven: z.boolean().nullable(),
    confirmed: z.boolean().nullable(),
    suppressed: z.boolean().nullable(),
    contactLost: z.boolean(),
  })
  .refine((source) => (source.kind === "reporter" ? /^Reporter [A-Z]{1,4}$/.test(source.label) : source.label === SOURCE_LABELS[source.kind]), {
    message: "a source's label is its reporter's letter or the fixed words of its kind",
    path: ["label"],
  });
export type SourceSummary = z.infer<typeof SourceSummary>;

const SnapshotImage = z.object({ id: z.uuid(), alt: z.string().nullable(), width: z.number().int().positive(), height: z.number().int().positive() });

/**
 * A snapshot of a case's evidence. Shown, it carries everything its digest covers, each member under the name
 * snapshotDigest reads it by, so the console recomputes the digest from exactly what it displays. Withheld (erased, or
 * a copy of content that was erased since), it carries its id, its time and its digest and no content.
 */
export const CaseSnapshot = z.discriminatedUnion("withheld", [
  z.object({ id: z.uuid(), takenAt: z.iso.datetime(), digest: Hex64, withheld: z.literal(true) }),
  z.object({
    id: z.uuid(),
    takenAt: z.iso.datetime(),
    digest: Hex64,
    withheld: z.literal(false),
    salt: Hex64,
    targetType: TargetKind,
    targetId: z.uuid(),
    authorHandle: z.string(),
    postState: StoredPostState.nullable(),
    postCreatedAt: z.iso.datetime().nullable(),
    replyToId: z.uuid().nullable(),
    quoteOfId: z.uuid().nullable(),
    body: z.string().nullable(),
    media: z.array(SnapshotImage).nullable(),
    displayName: z.string().nullable(),
    bio: z.string().nullable(),
    handle: z.string().nullable(),
  }),
]);
export type CaseSnapshot = z.infer<typeof CaseSnapshot>;

/**
 * One item of a case, for staff: its ground and what its sender wrote, the image it points at (a hint), and its source
 * as a summary. `link` is the item's korbat address, an account's under the handle as it was named. `quotedByPosition`
 * is set on an item korbat added for a quoted post (the position of the item it was added for), `quotedCaseId` on a
 * suspect item whose post quotes another (the case of that post's item). A re-examination says which item of its notice
 * it re-examines, and whether the person reading decided that item. `erased` marks an item whose intake record was erased.
 */
export const CaseItem = z.object({
  id: z.uuid(),
  seq: z.number().int().positive(),
  position: z.number().int().min(1).max(20),
  createdAt: z.iso.datetime(),
  lane: LaneNumber,
  link: z.string(),
  ruleId: z.enum(RULE_IDS).nullable(),
  allegesIllegal: z.boolean(),
  csam: z.boolean(),
  category: z.enum(TDB_CATEGORIES),
  categoryKeyword: z.string().nullable(),
  citedLaw: z.string().nullable(),
  explanation: z.string().nullable(),
  mediaId: z.uuid().nullable(),
  suspect: z.boolean(),
  quotedByPosition: z.number().int().min(1).max(10).nullable(),
  quotedCaseId: z.uuid().nullable(),
  reexaminesPosition: z.number().int().min(1).max(20).nullable(),
  reexaminesYourDecision: z.boolean(),
  statement: z.string().nullable(),
  outcome: ItemOutcome.nullable(),
  answeredBy: z.uuid().nullable(),
  erased: z.boolean(),
  source: SourceSummary,
});
export type CaseItem = z.infer<typeof CaseItem>;

/**
 * One measure or reversal of a decision. A measure says whether it is in force and, when a reversal lifted it, which
 * decision's; `noEffect` says that it changed nothing anyone saw when it was imposed. A seal lists what it covers: the
 * posts and images, how many of the posts their author had deleted, and at most SEAL_LIST_MAX rows of the list itself,
 * oldest first, as text for the report to the police, never content.
 */
export const CaseDecisionAction = z.object({
  id: z.uuid(),
  kind: z.enum(ACTION_KINDS),
  mediaId: z.uuid().nullable(),
  noEffect: z.enum(["already", "deleted"]).nullable(),
  inForce: z.boolean(),
  reversesActionId: z.uuid().nullable(),
  liftedBy: z.uuid().nullable(),
  sealed: z
    .object({
      posts: Count,
      images: Count,
      deletedPosts: Count,
      list: z.array(z.object({ postId: z.uuid(), createdAt: z.iso.datetime(), images: z.number().int().positive() })).max(SEAL_LIST_MAX),
    })
    .nullable(),
});
export type CaseDecisionAction = z.infer<typeof CaseDecisionAction>;

/**
 * A decision as the case page shows it: the statement's data, who decided (a staff handle), the stored facts that it
 * was taken on a suspicion and with the images out of sight, and its measures. A text is null when the decision has
 * none of that kind or it was erased.
 */
export const CaseDecision = z.object({
  id: z.uuid(),
  kind: z.enum(["interim", "final", "review", "correction"]),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
  ground: z.enum(["incompatible", "illegal"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  rulesVersion: z.number().int().positive(),
  redressVersion: z.number().int().positive(),
  category: z.enum(TDB_CATEGORIES),
  categoryKeyword: z.string().nullable(),
  source: z.enum(["notice", "report", "own_initiative"]),
  decidedAt: z.iso.datetime(),
  staffHandle: z.string(),
  throughSeq: Count,
  answersFromSeq: Count.nullable(),
  reviewsDecisionId: z.uuid().nullable(),
  snapshotId: z.uuid(),
  suspect: z.boolean(),
  unseen: z.boolean(),
  needsAdmin: z.boolean(),
  endedInterim: z.boolean(),
  facts: z.string().nullable(),
  reason: z.string().nullable(),
  legalReference: z.string().nullable(),
  actions: z.array(CaseDecisionAction),
});
export type CaseDecision = z.infer<typeof CaseDecision>;

/** The author's appeal of a decision of the case, with its statement while korbat keeps it, and its answer. */
export const CaseAppeal = z.object({
  id: z.uuid(),
  decisionId: z.uuid(),
  filedAt: z.iso.datetime(),
  statement: z.string().nullable(),
  answeredAt: z.iso.datetime().nullable(),
  result: z.enum(["kept", "partly_reversed", "reversed"]).nullable(),
  answeredBy: z.uuid().nullable(),
});
export type CaseAppeal = z.infer<typeof CaseAppeal>;

/** A note on a case, or a recorded choice not to seal with its reason: who wrote it (a staff handle), when, and the text. */
export const CaseStaffText = z.object({ id: z.uuid(), staffHandle: z.string(), createdAt: z.iso.datetime(), text: z.string() });
export type CaseStaffText = z.infer<typeof CaseStaffText>;

/** One event of a case's history, in the order of their times: ids, enums and times, never text. */
export const CaseHistoryEntry = z.object({
  at: z.iso.datetime(),
  event: z.enum(["item", "snapshot", "decision", "appeal_filed", "appeal_answered", "note", "seal_declined", "reveal", "evidence_erased", "redaction"]),
  refId: z.uuid().nullable(),
  seq: z.number().int().nullable(),
  intakeKind: z.enum(["user", "finding"]).nullable(),
  ruleId: z.enum(RULE_IDS).nullable(),
  allegesIllegal: z.boolean().nullable(),
  csam: z.boolean().nullable(),
  reexamination: z.boolean().nullable(),
  decisionKind: z.enum(["interim", "final", "review", "correction"]).nullable(),
  outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]).nullable(),
  staffHandle: z.string().nullable(),
  result: z.enum(["kept", "partly_reversed", "reversed"]).nullable(),
});
export type CaseHistoryEntry = z.infer<typeof CaseHistoryEntry>;

/**
 * What a case is about, as it stands now: a post with its state and its level, or an account with the handle, display
 * name and bio it holds now. `link` is the post's korbat address, as text: the console links nowhere into the app. A
 * member is null when the row is gone.
 */
export const CaseTarget = z.discriminatedUnion("type", [
  z.object({ type: z.literal("post"), id: z.uuid(), link: z.string(), authorHandle: z.string().nullable(), state: StoredPostState.nullable(), level: z.enum(["visible", "withheld", "removed"]).nullable() }),
  z.object({ type: z.literal("account"), id: z.uuid(), handle: z.string().nullable(), displayName: z.string().nullable(), bio: z.string().nullable(), deleted: z.boolean() }),
]);
export type CaseTarget = z.infer<typeof CaseTarget>;

/**
 * What a case on the path for child sexual abuse material shows in place of images: whether a suspect item is
 * unanswered, what the case reaches, and how often an admin answered such a report about this target or this author
 * without a seal in the last SUSPECT_EARLIER_MONTHS months, with the day staff last opened an image of the post in the
 * console. Counts and days only.
 */
export const CaseSuspicion = z.object({
  open: z.boolean(),
  reach: z.object({ posts: Count, images: Count, sealed: Count, served: Count, newestPostOn: UtcDay.nullable() }),
  earlier: z.object({
    target: z.object({ count: Count, lastOn: UtcDay.nullable(), imagesOpenedOn: UtcDay.nullable() }),
    author: z.object({ count: Count, lastOn: UtcDay.nullable() }),
  }),
});
export type CaseSuspicion = z.infer<typeof CaseSuspicion>;

/**
 * GET /api/staff/cases/:case: the case, its target as it stands, its evidence (newest first), its items, its decisions
 * with their measures and texts, its appeals, the reading person's own drafts, the notes and the recorded choices not to
 * seal, and its history. `suspicion` is set for a case that holds a suspect item or a seal. `imagesAllowed` is false
 * while the post is frozen, and for every account case: an account case shows no image.
 */
export const CaseView = z.object({
  id: z.uuid(),
  lane: LaneNumber,
  stateVersion: Count,
  intakeSeq: Count,
  answeredSeq: Count,
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  target: CaseTarget,
  suspicion: CaseSuspicion.nullable(),
  imagesAllowed: z.boolean(),
  snapshots: z.array(CaseSnapshot),
  items: z.array(CaseItem),
  decisions: z.array(CaseDecision),
  appeals: z.array(CaseAppeal),
  drafts: z.array(StaffTextDraft),
  notes: z.array(CaseStaffText),
  sealsDeclined: z.array(CaseStaffText),
  history: z.array(CaseHistoryEntry),
});
export type CaseView = z.infer<typeof CaseView>;

/** How many rows each of the overview's lists holds at most; its total says how many there are. */
export const OVERVIEW_LIST_MAX = 100;

const MailCounts = z.object({ receipts: Count, authorMails: Count, outcomes: Count });
const HandleCount = z.object({ handle: z.string(), count: Count });

/**
 * GET /api/staff/overview: what the home screen shows every staff member. Per lane the open cases and since when the
 * oldest unanswered item waits; the appeals waiting; every reveal of a source in the last 30 days, newest first, with
 * its staff handle and its case; per staff handle the images viewed and the findings opened today (UTC); the mails
 * waiting for more than an hour and those given up in the last 30 days; the decided items the daily release has not
 * released after 26 hours; and whether the emergency switch is on. Counts, times, handles and cases only.
 */
export const StaffOverview = z.object({
  lanes: z.array(z.object({ lane: LaneNumber, open: Count, oldestAt: z.iso.datetime().nullable() })).length(3),
  appealsWaiting: Count,
  reveals: z.object({ total: Count, items: z.array(z.object({ at: z.iso.datetime(), handle: z.string(), caseId: z.uuid() })).max(OVERVIEW_LIST_MAX) }),
  imagesToday: z.array(HandleCount),
  findingsToday: z.array(HandleCount),
  mailsWaiting: MailCounts,
  mailsFailed: MailCounts,
  releaseOverdue: Count,
  deferUnproven: z.boolean(),
});
export type StaffOverview = z.infer<typeof StaffOverview>;
```

### Replace `packages/contracts/src/staff.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, OpaqueId, Role } from "./auth";
import { hex, sha256, sortedJson } from "./canonical";
import { ACTION_KINDS, DECISION_KEYWORDS, MEASURES, REVEAL_REASON_CATEGORIES, RULE_IDS, TDB_CATEGORIES, compareDecisionActions, type ActionKind, type DecisionActionParams } from "./moderation";
import { AuthenticationResponseJSON, PasskeyOptionsResponse, RegistrationResponseJSON } from "./passkeys";

// The staff console (3a design, section 10). The console talks only to /api/staff/* on its own origin, and parses every
// answer with these schemas; the API validates every request with them.

/**
 * Every code the staff flows put in ErrorEnvelope.error.code. Staff routes may also answer the shared challenge_expired,
 * rate_limited and invalid_request, and the staff gate's not_found and csrf_failed, but never a passkey_* code.
 */
export const StaffErrorCode = z.enum([
  "staff_session_required",
  "staff_key_invalid",
  "staff_key_suspended",
  "staff_key_limit",
  "staff_key_not_device_bound",
  "staff_key_not_user_verified",
  "staff_key_refused",
  "staff_enrollment_invalid",
  "staff_step_up_required",
  "staff_step_up_invalid",
]);
export type StaffErrorCode = z.infer<typeof StaffErrorCode>;

/** The roles that open the console: an account whose role is user holds no staff key. */
export const StaffRole = Role.exclude(["user"]);
export type StaffRole = z.infer<typeof StaffRole>;

/**
 * The name a staff key's holder gives it at enrolment, under the display-name rules. The authenticator shows it (it is the
 * registration's user name), so the console asks for neither an email nor a real name.
 */
export const StaffKeyName = DisplayName;

/** Which button the enrolment page offered: a roaming security key (sent with the security-key hint) or this computer's Windows Hello (no hint). */
export const StaffKeyKind = z.enum(["security_key", "this_device"]);
export type StaffKeyKind = z.infer<typeof StaffKeyKind>;

/** A lowercase hex sha256: chain hashes and action hashes. */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex sha256");

/** A row's place in the audit chain (chain_seq): 1 for the first row. */
const ChainSeq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * A place as a query string names it: a decimal without a sign, a leading zero or an exponent, and at most 15 digits, so
 * it always converts to a safe integer.
 */
const ChainSeqParam = z
  .string()
  .regex(/^[1-9][0-9]{0,14}$/, "must be a place in the audit chain: a positive whole number")
  .transform(Number);

// ---------------------------------------------------------------- keys, sessions and the account

/** One of the person's staff keys as the console lists them: never the public key, the credential id or the AAGUID. */
export const StaffKey = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type StaffKey = z.infer<typeof StaffKey>;

export const StaffKeysResponse = z.object({ keys: z.array(StaffKey) });
export type StaffKeysResponse = z.infer<typeof StaffKeysResponse>;

/**
 * One of the person's live staff sessions. `handle` is the session's random handle, which the revocation route takes;
 * `browser` is the coarse label ("Firefox on Linux"), never the user agent or an address.
 */
export const StaffSession = z.object({
  handle: z.uuid(),
  browser: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** The session this request came from. */
  current: z.boolean(),
});
export type StaffSession = z.infer<typeof StaffSession>;

export const StaffSessionsResponse = z.object({ sessions: z.array(StaffSession) });
export type StaffSessionsResponse = z.infer<typeof StaffSessionsResponse>;

/**
 * GET /api/staff/me: the account's handle and role, the session's handle (the console binds step-up challenges to it) and
 * both expiries with the seconds left, counted on the server, so the console's idle timer needs no clock of its own.
 */
export const StaffMe = z
  .object({
    handle: z.string(),
    role: StaffRole,
    sessionHandle: z.uuid(),
    idleExpiresAt: z.iso.datetime(),
    idleSecondsLeft: z.number().int().nonnegative(),
    absoluteExpiresAt: z.iso.datetime(),
    absoluteSecondsLeft: z.number().int().nonnegative(),
  })
  // The idle expiry never moves past the absolute one (the database checks it too).
  .refine((me) => me.idleSecondsLeft <= me.absoluteSecondsLeft, { message: "the idle end cannot lie beyond the absolute end", path: ["idleSecondsLeft"] });
export type StaffMe = z.infer<typeof StaffMe>;

// ---------------------------------------------------------------- enrolment

/** POST /api/staff/enroll/options: the token of the link `staff.js enroll` printed, the key's name and its kind. */
export const StaffEnrollOptionsRequest = z.object({ token: OpaqueId, name: StaffKeyName, kind: StaffKeyKind });
export type StaffEnrollOptionsRequest = z.infer<typeof StaffEnrollOptionsRequest>;

/**
 * The registration options, and whether the console's relying party ID is the app's (`rpShared`, true in development).
 * Only when it is not does the page ask the password manager to drop a refused credential through the Signal API.
 */
export const StaffEnrollOptionsResponse = PasskeyOptionsResponse.extend({ rpShared: z.boolean() });
export type StaffEnrollOptionsResponse = z.infer<typeof StaffEnrollOptionsResponse>;

/** POST /api/staff/enroll/verify: the same token and name with the browser's registration response. */
export const StaffEnrollVerifyRequest = z.object({ token: OpaqueId, name: StaffKeyName, response: RegistrationResponseJSON });
export type StaffEnrollVerifyRequest = z.infer<typeof StaffEnrollVerifyRequest>;

/** The key the enrolment stored; the person then signs in with it once. */
export const StaffEnrollVerifyResponse = z.object({ key: StaffKey });
export type StaffEnrollVerifyResponse = z.infer<typeof StaffEnrollVerifyResponse>;

// ---------------------------------------------------------------- sign-in

/** POST /api/staff/signin/options takes no body and answers with discoverable-credential options. */
export const StaffSignInOptionsResponse = PasskeyOptionsResponse;
export type StaffSignInOptionsResponse = z.infer<typeof StaffSignInOptionsResponse>;

/** POST /api/staff/signin/verify: the browser's assertion. There is no device id: a staff session is its own record. */
export const StaffSignInVerifyRequest = z.object({ response: AuthenticationResponseJSON });
export type StaffSignInVerifyRequest = z.infer<typeof StaffSignInVerifyRequest>;

/** A sign-in answers with the new session as /me describes it, beside the two staff cookies. */
export const StaffSignInVerifyResponse = StaffMe;
export type StaffSignInVerifyResponse = z.infer<typeof StaffSignInVerifyResponse>;

// ---------------------------------------------------------------- step-up

/**
 * A uuid in the one spelling PostgreSQL writes, lower-case hex. A step-up target's id is hashed exactly as sent, but the
 * database finds a uuid by value whatever its case and the audit row records the id as the database returns it: an
 * upper-case spelling would act on the row and leave a record whose target no longer hashes to the confirmed action, which
 * audit-verify would refuse for good. So any other spelling is refused, never changed.
 */
const LowerCaseUuid = z.uuid().regex(/^[0-9a-f-]+$/, { message: "a uuid in lower case" });

// The params of the three actions of moderation cases (3c design, section 10). They are written into the audit chain for
// good, so they hold only ids, enums, whole numbers and hex digests, never a free string: every text a decision carries is
// saved first and named here by its salted digest. No member has a transform (a schema that changed a value would have the
// key confirm one text and the record keep another), and the cross-field rules are refinements, which change nothing.
// The database's triggers check every rule again.

/** A case's version or an item's number: a whole number that PostgreSQL's integer holds. */
const Counter = z.number().int().min(0).max(2_147_483_647);

/** The version of the rulebook or of the redress texts: a whole number from 1 that PostgreSQL's smallint holds. */
const TextVersion = z.number().int().min(1).max(32_767);

/** One measure or reversal: its kind and, for an image measure, the image, as a lower-case uuid (an image id's own schema lower-cases, which a param must not). */
const DecisionAction = z.strictObject({ kind: z.enum(ACTION_KINDS), mediaId: LowerCaseUuid.nullable() });

const isReversal = (kind: ActionKind) => MEASURES[kind].lifts !== null;

/**
 * What is wrong with a decision's list of actions, or nothing: they come in the one order compareDecisionActions gives,
 * without repeats; only an image measure names an image, and it must; at most one of them acts on the post itself
 * (a seal acts on images and may stand beside it), and at most one seals; and a correction or a review lifts, never restricts.
 */
function actionProblems(actions: readonly DecisionActionParams[], reversalsOnly: boolean): string[] {
  const problems: string[] = [];
  if (actions.some((action, i) => i > 0 && compareDecisionActions(actions[i - 1]!, action) >= 0)) problems.push("the actions are sorted by kind and then by image, without repeats");
  if (actions.some((action) => (MEASURES[action.kind].target === "image") !== (action.mediaId !== null))) problems.push("an image measure names its image, and no other kind names one");
  if (actions.filter((action) => action.kind === "withhold" || action.kind === "remove").length > 1) problems.push("a decision holds at most one measure on the post itself");
  if (actions.filter((action) => action.kind === "seal_media").length > 1) problems.push("a decision holds at most one seal");
  if (reversalsOnly && actions.some((action) => !isReversal(action.kind))) problems.push("a correction or a review holds reversals only");
  return problems;
}

/**
 * POST /api/staff/cases/:case/decisions: a decision taken while deciding (interim), one that decides the case (final) or
 * a correction of either. `stateVersion` is the case's version the console showed, `throughSeq` the last item a final
 * decision answers, and the snapshot is named with the digest the console computed from what it displayed.
 */
export const CaseDecidedParams = z
  .strictObject({
    kind: z.enum(["interim", "final", "correction"]),
    stateVersion: Counter,
    throughSeq: Counter,
    reviewsDecisionId: LowerCaseUuid.nullable(),
    snapshotId: LowerCaseUuid,
    snapshotDigest: Sha256Hex,
    outcome: z.enum(["restricted", "no_violation", "not_evident", "partly_reversed", "reversed"]),
    ground: z.enum(["incompatible", "illegal"]).nullable(),
    ruleId: z.enum(RULE_IDS).nullable(),
    rulesVersion: TextVersion,
    redressVersion: TextVersion,
    category: z.enum(TDB_CATEGORIES),
    categoryKeyword: z.enum(DECISION_KEYWORDS).nullable(),
    actions: z.array(DecisionAction).max(8),
    factsDigest: Sha256Hex.nullable(),
    reasonDigest: Sha256Hex.nullable(),
    legalReferenceDigest: Sha256Hex.nullable(),
  })
  .superRefine((params, ctx) => {
    const refuse = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const outcomes = { interim: ["restricted"], final: ["restricted", "no_violation", "not_evident"], correction: ["partly_reversed", "reversed"] } as const;
    if (!(outcomes[params.kind] as readonly string[]).includes(params.outcome)) refuse("outcome", "a decision of this kind does not have this outcome");
    if (params.kind === "interim" && params.throughSeq !== 0) refuse("throughSeq", "a decision taken while deciding answers no item");
    if ((params.kind === "correction") !== (params.reviewsDecisionId !== null)) refuse("reviewsDecisionId", "a correction, and only a correction, names the decision it corrects");
    if (params.categoryKeyword !== null && params.ground !== "illegal") refuse("categoryKeyword", "a keyword goes only with the ground of the law");
    if (params.ground === "illegal" && params.ruleId !== null) refuse("ruleId", "a decision on the law cites no korbat rule");
    if (params.ground === "incompatible" && params.ruleId === null) refuse("ruleId", "a decision on the rules cites its rule");
    if (params.ground === "illegal" && params.legalReferenceDigest === null) refuse("legalReferenceDigest", "a decision on the law names its legal reference");
    if (params.outcome === "restricted" && (params.ground === null || params.factsDigest === null || params.reasonDigest === null)) {
      refuse("outcome", "a restriction carries its ground, its facts and its reason");
    }
    if (params.kind === "correction") {
      if (params.ground !== null || params.ruleId !== null || params.categoryKeyword !== null || params.factsDigest !== null || params.legalReferenceDigest !== null) {
        refuse("kind", "a correction states no ground of its own");
      }
      if (params.reasonDigest === null) refuse("reasonDigest", "a correction carries its reason");
    }
    for (const problem of actionProblems(params.actions, params.kind === "correction")) refuse("actions", problem);
  });
export type CaseDecidedParams = z.infer<typeof CaseDecidedParams>;

/**
 * POST /api/staff/decisions/:decision/review: the answer to the author's one appeal of the decision. It keeps the decision
 * or lifts measures of it, never restricts, and always gives its reason.
 */
export const AppealsReviewedParams = z
  .strictObject({
    stateVersion: Counter,
    appealId: LowerCaseUuid,
    snapshotId: LowerCaseUuid,
    snapshotDigest: Sha256Hex,
    outcome: z.enum(["kept", "partly_reversed", "reversed"]),
    rulesVersion: TextVersion,
    redressVersion: TextVersion,
    category: z.enum(TDB_CATEGORIES),
    actions: z.array(DecisionAction).max(8),
    reasonDigest: Sha256Hex,
  })
  .superRefine((params, ctx) => {
    for (const problem of actionProblems(params.actions, true)) ctx.addIssue({ code: "custom", path: ["actions"], message: problem });
  });
export type AppealsReviewedParams = z.infer<typeof AppealsReviewedParams>;

/** POST /api/staff/items/:item/reveal: why the source of the item is revealed, as a category and the digest of the saved reason. */
export const IdentityRevealedParams = z.strictObject({ reasonCategory: z.enum(REVEAL_REASON_CATEGORIES), reasonDigest: Sha256Hex });
export type IdentityRevealedParams = z.infer<typeof IdentityRevealedParams>;

/**
 * Every action a staff key confirms, one at a time (3a design, section 7): the type of its target, the schema of the
 * target's id and the schema of its params. The step-up options, requireStaffStepUp, audit-verify and the console read it.
 * The params are hashed exactly as sent, so their schemas are strict: a member they do not know is refused, never dropped.
 */
export const STAFF_STEP_UP_ACTIONS = {
  /** DELETE /api/staff/sessions/:handle: one of the person's own staff sessions, by its handle. */
  staff_session_revoked: { targetType: "staff_session", targetId: LowerCaseUuid, params: z.strictObject({}) },
  /** POST /api/staff/cases/:case/decisions: a decision on the case, by the case's id. */
  case_decided: { targetType: "case", targetId: LowerCaseUuid, params: CaseDecidedParams },
  /** POST /api/staff/decisions/:decision/review: the review of the appeal of a decision, by the decision's id. */
  appeals_reviewed: { targetType: "decision", targetId: LowerCaseUuid, params: AppealsReviewedParams },
  /** POST /api/staff/items/:item/reveal: who sent an item, by the item's id. */
  identity_revealed: { targetType: "intake_item", targetId: LowerCaseUuid, params: IdentityRevealedParams },
} as const;
export type StaffStepUpAction = keyof typeof STAFF_STEP_UP_ACTIONS;

export const StaffStepUpActionName = z.enum(Object.keys(STAFF_STEP_UP_ACTIONS) as [StaffStepUpAction, ...StaffStepUpAction[]]);

/** The `{ action, target, params }` of one step-up action, each part checked by that action's own schemas. */
function stepUpRequest<A extends StaffStepUpAction>(action: A) {
  const spec = STAFF_STEP_UP_ACTIONS[action];
  return z.strictObject({
    action: z.literal(action),
    target: z.strictObject({ type: z.literal(spec.targetType), id: spec.targetId }),
    params: spec.params,
  });
}

/** POST /api/staff/step-up/options: the action the route will execute, as it will execute it. */
export const StaffStepUpOptionsRequest = z.discriminatedUnion("action", [
  stepUpRequest("staff_session_revoked"),
  stepUpRequest("case_decided"),
  stepUpRequest("appeals_reviewed"),
  stepUpRequest("identity_revealed"),
]);
export type StaffStepUpOptionsRequest = z.infer<typeof StaffStepUpOptionsRequest>;

/** The options: a challenge bound to the session and the action, and an allow list holding only the session's key. */
export const StaffStepUpOptionsResponse = PasskeyOptionsResponse;
export type StaffStepUpOptionsResponse = z.infer<typeof StaffStepUpOptionsResponse>;

/** DELETE /api/staff/sessions/:handle: the action's params (none) with the step-up assertion added as `stepUp`. */
export const StaffSessionRevokeRequest = STAFF_STEP_UP_ACTIONS.staff_session_revoked.params.extend({ stepUp: AuthenticationResponseJSON });
export type StaffSessionRevokeRequest = z.infer<typeof StaffSessionRevokeRequest>;

/** POST /api/staff/items/:item/reveal: the action's params with the step-up assertion added as `stepUp`. */
export const IdentityRevealRequest = IdentityRevealedParams.extend({ stepUp: AuthenticationResponseJSON });
export type IdentityRevealRequest = z.infer<typeof IdentityRevealRequest>;

/**
 * POST /api/staff/cases/:case/decisions answers 201 with the id of the decision that committed. The console's case
 * screens, when they come, read the case again in its place.
 */
export const CaseDecisionResponse = z.object({ decisionId: z.uuid() });
export type CaseDecisionResponse = z.infer<typeof CaseDecisionResponse>;

/**
 * Which ceremony a WebAuthn challenge was issued for: its second byte, in either layout below. A challenge answers only
 * the ceremony it names. The API's codec writes these codes, and the console checks them before it asks for the key, so
 * no challenge of one ceremony is ever signed in another.
 */
export const CHALLENGE_PURPOSES = { signin: 1, register: 2, reauth: 3, staff_signin: 4, staff_register: 5, staff_step_up: 6 } as const;

/**
 * The layout of every challenge but the step-up's (1c's codec, 3a design, section 5): version, purpose, expiry (epoch
 * milliseconds, big-endian), nonce, a 16-byte binding (the first 16 bytes of the sha256 of the session's handle or the
 * staff enrolment's id it is bound to, zeros for the two sign-ins), then the first 16 bytes of an HMAC over the 42 bytes
 * before it, 58 bytes sent as unpadded base64url. The API's codec writes it, and the console checks the staff sign-in's
 * and the staff registration's before it asks for the key.
 */
export const CEREMONY_CHALLENGE = {
  bytes: 58,
  encodedLength: 78,
  version: 1,
  versionAt: 0,
  purposeAt: 1,
  expiryAt: 2,
  expiryBytes: 8,
  nonceAt: 10,
  nonceBytes: 16,
  bindingAt: 26,
  bindingBytes: 16,
  sealAt: 42,
  sealBytes: 16,
} as const;

/**
 * The step-up challenge's layout (3a design, section 5), which the API's codec writes, audit-verify reads back from a
 * stored assertion without the sealing key, and the console checks before it asks for the key: version, purpose, expiry
 * (epoch milliseconds, big-endian), nonce, the full 32-byte binding, then the first 16 bytes of an HMAC over the 58 bytes
 * before it, 74 bytes sent as unpadded base64url. The other ceremonies' challenges are 58 bytes with purposes 1 to 5 and a
 * 16-byte binding (CEREMONY_CHALLENGE), so neither layout is ever read as the other.
 */
export const STAFF_STEP_UP_CHALLENGE = {
  bytes: 74,
  encodedLength: 99,
  version: 1,
  purpose: CHALLENGE_PURPOSES.staff_step_up,
  versionAt: 0,
  purposeAt: 1,
  expiryAt: 2,
  expiryBytes: 8,
  nonceAt: 10,
  nonceBytes: 16,
  bindingAt: 26,
  bindingBytes: 32,
  sealAt: 58,
  sealBytes: 16,
} as const;

/** What a step-up confirms: an action, its target and its params, as the route will execute them, or as an audit row records them. */
export interface StaffStepUpActionInput {
  action: string;
  target: { type: string; id: string };
  params: Record<string, unknown>;
}

/**
 * The text an action's hash is taken over (3a design, section 7, Step-up): the sorted JSON of `{ action, target: { type,
 * id }, params }`. The step-up options take it from what the console sent, requireStaffStepUp from what the route is about
 * to do, audit-verify from the row's action, target and `metadata.params`, and the console from what it chose.
 */
export function stepUpActionText(input: StaffStepUpActionInput): string {
  return sortedJson({ action: input.action, target: { type: input.target.type, id: input.target.id }, params: input.params });
}

/**
 * The text a step-up challenge's binding is the sha256 of: the staff session's handle, a newline and the action's hash. A
 * confirmation made in one session, or for one action, therefore binds nothing else.
 */
export function stepUpBindingText(sessionHandle: string, actionHash: string): string {
  return `${sessionHandle}\n${actionHash}`;
}

/** The action's hash: the lower-case hex sha256 of stepUpActionText's UTF-8 bytes. */
export async function stepUpActionHash(input: StaffStepUpActionInput): Promise<string> {
  return hex(await sha256(stepUpActionText(input)));
}

/** The step-up challenge's binding: all 32 bytes of the sha256 of stepUpBindingText's UTF-8 bytes. */
export async function stepUpBinding(sessionHandle: string, actionHash: string): Promise<Uint8Array> {
  return sha256(stepUpBindingText(sessionHandle, actionHash));
}

/**
 * A step-up assertion as the audit row stores it in `step_up`: the three members `audit-verify` checks, base64url exactly
 * as the browser sent them, under the same bounds as the browser's answer.
 */
export const StaffStoredAssertion = z.strictObject(
  AuthenticationResponseJSON.shape.response.pick({ authenticatorData: true, clientDataJSON: true, signature: true }).shape,
);
export type StaffStoredAssertion = z.infer<typeof StaffStoredAssertion>;

// ---------------------------------------------------------------- the audit log

/** How many rows one page of the audit log holds. */
export const STAFF_AUDIT_PAGE_SIZE = 50;

/**
 * One row of the audit log as the console shows it: its place and hash in the chain, when it joined the chain, the actor's
 * handle (null for the system actor or an account without one), the action, its target and the action's hash when a
 * step-up confirmed it. Never its metadata.
 */
export const AuditEntry = z.object({
  seq: ChainSeq,
  hash: Sha256Hex,
  createdAt: z.iso.datetime(),
  actorHandle: z.string().nullable(),
  action: z.string().min(1),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  actionHash: Sha256Hex.nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** Newest first by place. `nextCursor` asks for the rows before this page's last one; null when there are none. */
export const AuditPage = z.object({ entries: z.array(AuditEntry).max(STAFF_AUDIT_PAGE_SIZE), nextCursor: ChainSeq.nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

/**
 * GET /api/staff/audit: from the newest row, from before `cursor`, or the page whose newest row is at place `at` (the
 * keeper's "Go to place"); `action=staff_sign_in` is the reader's one filter, which the home screen's list of sign-ins reads.
 */
export const AuditPageQuery = z
  .object({ cursor: ChainSeqParam.optional(), at: ChainSeqParam.optional(), action: z.enum(["staff_sign_in"]).optional() })
  .refine((query) => query.cursor === undefined || query.at === undefined, { message: "ask for a cursor or a place, not both", path: ["at"] });
export type AuditPageQuery = z.infer<typeof AuditPageQuery>;
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
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  18 passed (18)
packages/db test:       Tests  60 passed (60)
packages/contracts test:       Tests  247 passed (247)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  120 passed (120)
apps/admin test:       Tests  287 passed (287)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  655 passed | 918 skipped (1573)
```

## Step 6: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `No schema changes`

Observed on the dry run:

```text
No schema changes, nothing to migrate 😴
```

## Step 7: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && echo count=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations')
```

Expected output contains:

- `migrations applied`
- `count=17`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=17
```

## Step 8: verify: admin-build

```bash
pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'
```

Expected output contains:

- `Build success`
- `index.html`
- `favicon.svg`
- `main-HASH.js`
- `main-HASH.css`

Observed on the dry run:

```text
Build success
favicon.svg
index.html
main-HASH.css
main-HASH.js
```

## Step 9: verify: admin-browser

```bash
pnpm --filter @korbat/admin test:browser
```

Expected output contains:

- `Tests  22 passed (22)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  22 passed (22)
```

## Step 10: verify: test-database-fresh

```bash
node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `test database ready: korbat_test`

Observed on the dry run:

```text
test database ready: korbat_test
```

## Step 11: verify: integration-fresh

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  913 passed | 3 skipped (916)
```

## Step 12: verify: test-database-upgrade

```bash
node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations up to 0013_forget_revoked_staff_keys applied and committed`
- `later migrations applied as one batch`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations up to 0013_forget_revoked_staff_keys applied and committed
later migrations applied as one batch
test database ready: korbat_test
```

## Step 13: verify: integration-upgraded

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  913 passed | 3 skipped (916)
```

## Step 14: verify: timing

```bash
cd apps/api && set -a && . ./.env && set +a && ok=0; for i in 1 2 3 4 5 6 7 8 9 10; do node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/integration/http-timing.test.ts test/integration/auth-flows-mfa.test.ts -t '(differ by less than 50 ms|sign-in timing does not reveal)' > ../../.data/timing-gate.log 2>&1 && { ok=1; break; }; sleep 45; done; tail -6 ../../.data/timing-gate.log; echo timing-ok=$ok attempts=$i
```

Expected output contains:

- `timing-ok=1`

Observed on the dry run:

```text
timing-ok=1 attempts=1
```

## Step 15: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && node --check apps/api/dist/staff.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 16: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/admin/src/App.tsx`
- `apps/admin/src/Layout.tsx`
- `apps/admin/src/api.ts`
- `apps/admin/src/app.css`
- `apps/admin/src/frames.tsx`
- `apps/admin/src/hidden.ts`
- `apps/admin/src/media.tsx`
- `apps/admin/src/messages.ts`
- `apps/admin/src/nav.tsx`
- `apps/admin/src/router.ts`
- `apps/admin/src/screens/Case.tsx`
- `apps/admin/src/screens/Home.tsx`
- `apps/admin/src/screens/Queue.tsx`
- `apps/admin/src/step-up.ts`
- `apps/admin/src/store.ts`
- `apps/admin/src/texts.ts`
- `apps/admin/src/words.ts`
- `apps/admin/test/browser/console.browser.ts`
- `apps/admin/test/browser/fixture-api.ts`
- `apps/admin/test/browser/watch.ts`
- `apps/admin/test/case-fixtures.ts`
- `apps/admin/test/cases.test.tsx`
- `apps/admin/test/fixture-statuses.test.ts`
- `apps/admin/test/fixtures.ts`
- `apps/admin/test/router.test.ts`
- `apps/admin/test/screens.test.tsx`
- `apps/admin/test/source.test.ts`
- `apps/api/src/auth/flows/notifiers.ts`
- `apps/api/src/mail/mailer.ts`
- `apps/api/src/mail/templates.ts`
- `apps/api/src/moderation/cases.ts`
- `apps/api/src/moderation/context.ts`
- `apps/api/src/moderation/index.ts`
- `apps/api/src/moderation/intake.ts`
- `apps/api/src/moderation/overlap.ts`
- `apps/api/src/moderation/repo.ts`
- `apps/api/src/moderation/reveal.ts`
- `apps/api/src/moderation/texts.ts`
- `apps/api/src/staff/cases.ts`
- `apps/api/src/staff/routes.ts`
- `apps/api/test/integration/http-staff-cases.test.ts`
- `apps/api/test/integration/moderation-cases.test.ts`
- `apps/api/test/integration/moderation-reveal.test.ts`
- `apps/api/test/mail/templates.test.ts`
- `apps/api/test/moderation-context.test.ts`
- `apps/api/test/moderation-overlap.test.ts`
- `apps/api/test/moderation-summary.test.ts`
- `apps/api/test/staff/route-table.test.ts`
- `packages/contracts/src/moderation.ts`
- `packages/contracts/src/staff.ts`
- `packages/contracts/test/moderation.test.ts`
- `packages/contracts/test/staff-cases.test.ts`

## Step 17: commit

```bash
git add -A
git commit -q -m "feat(api,admin): the console's queue, case, evidence and reveals: GET /api/staff/overview, /queue and /cases/:case answer behind the staff gate, each case read written to the access log and counted against the daily limit of distinct cases; the case answer carries its items with their source summaries, its snapshots (withheld where erased), its notes and recorded choices not to seal, and for a case with a report or finding of child sexual abuse material its suspicion: whether an item is unanswered, what the case reaches in counts, the earlier answers without a seal about the target and its author, and the day staff last opened the post's images; /cases/:case/media/:media/:size serves an image only through MediaForCases.staffImage, never a sealed or erased one or one of a frozen post, on any case; POST /api/staff/findings opens a moderator's own finding under the daily findings limit, a finding citing R2 also for an account under a handle it has left; the texts routes save drafts, notes and a recorded choice not to seal; POST /api/staff/items/:item/reveal shows a signed-in reporter's handle behind the step-up, with its reason, its daily limit and a mail to every staff account; every case route and the reveal refuse a staff account that is a party; the console gains its router, CaseLink, StaffImage, the home, queue and case screens with the Art. 18 banner and the banner of a case with an unanswered suspect item, the Own finding control and the reveal dialog, and its browser check runs them" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,admin): the console's queue, case, evidence and reveals: GET /api/staff/overview, /queue and /cases/:case answer behind the staff gate, each case read written to the access log and counted against the daily limit of distinct cases; the case answer carries its items with their source summaries, its snapshots (withheld where erased), its notes and recorded choices not to seal, and for a case with a report or finding of child sexual abuse material its suspicion: whether an item is unanswered, what the case reaches in counts, the earlier answers without a seal about the target and its author, and the day staff last opened the post's images; /cases/:case/media/:media/:size serves an image only through MediaForCases.staffImage, never a sealed or erased one or one of a frozen post, on any case; POST /api/staff/findings opens a moderator's own finding under the daily findings limit, a finding citing R2 also for an account under a handle it has left; the texts routes save drafts, notes and a recorded choice not to seal; POST /api/staff/items/:item/reveal shows a signed-in reporter's handle behind the step-up, with its reason, its daily limit and a mail to every staff account; every case route and the reveal refuse a staff account that is a party; the console gains its router, CaseLink, StaffImage, the home, queue and case screens with the Art. 18 banner and the banner of a case with an unanswered suspect item, the Own finding control and the reveal dialog, and its browser check runs them`.

## Report format (mandatory)

```text
TASK 5 REPORT
Files written: <count, expected 52>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "admin-build": <paste the expected lines as printed>
Verify "admin-browser": <paste the expected lines as printed>
Verify "test-database-fresh": <paste the expected lines as printed>
Verify "integration-fresh": <paste the expected lines as printed>
Verify "test-database-upgrade": <paste the expected lines as printed>
Verify "integration-upgraded": <paste the expected lines as printed>
Verify "timing": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
