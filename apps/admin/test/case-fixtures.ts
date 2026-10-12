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
export const CASE_SEALABLE = "7d506f52-c18e-4052-bf6e-ad4c9b807f6e";
export const CASE_DECLINE = "8e617063-d29f-4163-8a7f-be5dac91807f";
export const CASE_ADMIN = "b194a396-05c2-4496-bda2-e180dfc4b3ac";
export const CASE_CHANGED = "c2a5b4a7-16d3-45a7-8eb3-f291e0d5c4bd";
export const CASE_DRAFTS = "d3b6c5b8-27e4-46b8-9fc4-03a2f1e6d5ce";
export const ACCOUNT_SEALABLE = "9f728174-e3a0-4274-9b80-cf6ebda2918a";
export const ACCOUNT_DECLINE = "a0839285-f4b1-4385-ac91-d07fceb3a29b";
export const POST_ID = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";
export const ACCOUNT_ID = "8f3e0b21-7d4c-4a6f-9b32-1e5d8c0f2a47";
export const IMAGE_ONE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const IMAGE_TWO = "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
export const ITEM_REPORTER = "2c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f";
export const ITEM_NOTIFIER = "3d4e5f6a-7b8c-4d9e-bf0a-2b3c4d5e6f7a";
export const ITEM_SUSPECT = "4e5f6a7b-8c9d-4eaf-801b-3c4d5e6f7a8b";
export const ITEM_FINDING = "5f6a7b8c-9dae-4fb0-912c-4d5e6f7a8b9c";
export const ITEM_REEXAMINATION = "6a7b8c9d-aebf-40c1-a23d-5e6f7a8b9cad";
export const DECISION_ONE = "7b8c9dae-bfc0-41d2-b34e-6f7a8b9cadbe";
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

/**
 * An account's case that holds an unanswered report of child sexual abuse material and reaches images that are still
 * served: the seal and "Do not seal now" are offered on it. Its newest snapshot holds the account's fields as they read
 * now, so nothing asks for a fresh one.
 */
export function sealableCase(id: string, accountId: string): CaseView {
  const fields = { handle: "an_account", displayName: HOSTILE.quote, bio: LOOKALIKE.label };
  const base = accountCase();
  const [copied] = base.snapshots;
  if (!copied || copied.withheld) throw new Error("the account case's snapshot shows its content");
  return accountCase({
    id,
    target: { type: "account", id: accountId, ...fields, deleted: false },
    suspicion: { open: true, reach: { posts: 2, images: 3, sealed: 0, served: 3, newestPostOn: "2026-09-30" }, earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } } },
    snapshots: [{ ...copied, id: accountId.replace(/^.{8}/, "5a5a5a5a"), targetId: accountId, authorHandle: fields.handle, ...fields }],
    // An item of its own, so that no two fixture cases hold the same one.
    items: base.items.map((each) => ({ ...each, id: accountId.replace(/^.{8}/, "6b6b6b6b") })),
    history: [],
  });
}

/**
 * A post's case as an admin meets it: a rule report, then a report of child sexual abuse material that nobody has
 * answered, then a second rule report. Its two images are still served and cannot be opened, and nothing was done while
 * deciding. Its items are its own, so that no two fixture cases hold the same one.
 */
export function adminCase(): CaseView {
  return frozenCase({
    id: CASE_ADMIN,
    intakeSeq: 3,
    decisions: [],
    sealsDeclined: [],
    history: [],
    suspicion: { open: true, reach: { posts: 1, images: 2, sealed: 0, served: 2, newestPostOn: "2026-09-30" }, earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } } },
    items: [
      item({ id: "e4c7d6c9-38f5-47c9-80d5-14b302f7e6d1", seq: 1, ruleId: "R1", lane: 2 }),
      item({ id: "e4c7d6c9-38f5-47c9-80d5-14b302f7e6d2", seq: 2, csam: true, suspect: true, allegesIllegal: true, ruleId: null, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", lane: 0, explanation: null, source: SOURCES.anonymous }),
      item({ id: "e4c7d6c9-38f5-47c9-80d5-14b302f7e6d3", seq: 3, ruleId: "R6", lane: 2, explanation: null }),
    ],
  });
}

/** A post's case in lane 2 that holds one rule report and nothing else: no decision, no note, an item of its own. */
export function plainCase(id: string, itemId: string): CaseView {
  return postCase({ id, stateVersion: 1, intakeSeq: 1, items: [item({ id: itemId })], decisions: [], notes: [], history: [] });
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
    protectionLifted: { total: 0, items: [] },
    sealsDeclined: { total: 0, items: [] },
    interimSeals: { total: 0, items: [] },
    ...overrides,
  };
}
