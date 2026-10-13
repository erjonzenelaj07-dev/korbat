import type { CaseDecision, CaseDecisionAction, CaseItem, CaseSnapshot, CaseStanding, CaseView, QueueRow, SourceSummary, StaffOverview } from "@korbat/contracts";
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
export const CASE_APPEALED = "e4c7d6c9-38f5-47c9-80d5-14b302f7e6df";
export const DECISION_APPEALED = "f5d8e7da-4906-48da-91e6-25c413a8f7e0";
export const APPEAL_ONE = "06e9f8eb-5a17-49eb-a2f7-36d524b90801";
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

/** 3e: the standing columns of a ledger row that is no standing measure and no strike, as the case answer carries them. */
export const NO_STANDING = { days: null, announced: null, basis: null, restsOn: null, earliestStart: null, countsUntil: null, period: null, restedOnBy: null, reply: null } as const;

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
    actions: [{ id: "aebfc0d1-e2f3-4405-a671-9cadbecfd0e1", kind: "withhold", mediaId: null, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, sealed: null, ...NO_STANDING }],
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
    // 3e: a post case says whether a final restriction under a rule gives a strike, and the author's standing in bands.
    strikeDue: { due: true, why: "due" },
    authorStanding: { activeStrikes: "1", suspensionsInYear: "0", now: "none" },
    standing: null,
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
            ...NO_STANDING,
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
    // 3e: an account case has no strike line and no bands; its standing comes with the account case's composer (Task 3).
    strikeDue: null,
    authorStanding: null,
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

/**
 * A closed case about a post whose final removal, by another staff member, its author appealed: the appeal waits, and
 * the reading person may review it. The appellant's statement is a string no page may run.
 */
export function appealedCase(): CaseView {
  const removal = decision({ id: DECISION_APPEALED, kind: "final", staffHandle: "mod_anna", throughSeq: 2, answersFromSeq: 1, facts: "The post offers followers for money.", reason: "That is spam.", actions: [{ ...decision().actions[0]!, id: "17fa09fc-6b28-4afc-b308-47e635ca1912", kind: "remove" }] });
  return postCase({
    id: CASE_APPEALED,
    answeredSeq: 2,
    closedAt: "2026-10-01T09:00:00.000Z",
    target: { type: "post", id: POST_ID, link: `http://localhost:8081/post/${POST_ID}`, authorHandle: HOSTILE.bidi, state: "removed", level: "removed" },
    items: [item({ outcome: "restricted_rule", answeredBy: DECISION_APPEALED })],
    decisions: [removal],
    appeals: [{ id: APPEAL_ONE, decisionId: DECISION_APPEALED, filedAt: "2026-10-03T10:00:00.000Z", statement: HOSTILE.img, answeredAt: null, result: null, answeredBy: null, reviewer: "available", needsAdmin: false, mayReview: true }],
    notes: [],
  });
}

// 3e (design, section 8.10): the cases of Task 1's two browser runs.
export const CASE_STRIKE = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
export const CASE_STRUCK = "2b3c4d5e-6f70-4182-93a4-b5c6d7e8f90a";
export const DECISION_STRUCK = "3c4d5e6f-7081-4293-a4b5-c6d7e8f90a1b";
export const APPEAL_STRUCK = "4d5e6f70-8192-43a4-b5c6-d7e8f90a1b2c";
export const ITEM_STRIKE = "5e6f7081-92a3-44b5-86d7-e8f90a1b2c3d";
export const ITEM_STRUCK = "6f708192-a3b4-45c6-97e8-f90a1b2c3d4e";

/**
 * 3e: a fresh case about a post whose author has two active strikes and one suspension in the year: a final removal under
 * its report's rule gives a strike, which the case answer says is due.
 */
export function strikeCase(): CaseView {
  return postCase({ id: CASE_STRIKE, stateVersion: 1, intakeSeq: 1, items: [item({ id: ITEM_STRIKE })], decisions: [], notes: [], history: [], authorStanding: { activeStrikes: "2", suspensionsInYear: "1", now: "none" } });
}

/**
 * 3e: a closed case about a post whose final removal under R1, by a staff member with a hostile handle, gave a strike
 * that an announced suspension of the author rests on; the author appealed, and the reading person may review it.
 */
export function struckCase(): CaseView {
  const removal = decision({
    id: DECISION_STRUCK,
    kind: "final",
    rulesVersion: 3,
    redressVersion: 2,
    staffHandle: HOSTILE.quote,
    throughSeq: 1,
    answersFromSeq: 1,
    facts: "The post offers followers for money.",
    reason: "That is spam.",
    actions: [
      { ...decision().actions[0]!, id: "708192a3-b4c5-46d7-a8f9-0a1b2c3d4e5f", kind: "remove" },
      { ...decision().actions[0]!, id: "8192a3b4-c5d6-47e8-b90a-1b2c3d4e5f60", kind: "strike", countsUntil: "2026-12-30T09:00:00.000Z", restedOnBy: ["suspend"] },
    ],
  });
  return postCase({
    id: CASE_STRUCK,
    intakeSeq: 1,
    answeredSeq: 1,
    closedAt: "2026-10-01T09:00:00.000Z",
    target: { type: "post", id: POST_ID, link: `http://localhost:8081/post/${POST_ID}`, authorHandle: HOSTILE.bidi, state: "removed", level: "removed" },
    items: [item({ id: ITEM_STRUCK, outcome: "restricted_rule", answeredBy: DECISION_STRUCK })],
    decisions: [removal],
    appeals: [{ id: APPEAL_STRUCK, decisionId: DECISION_STRUCK, filedAt: "2026-10-03T10:00:00.000Z", statement: HOSTILE.script, answeredAt: null, result: null, answeredBy: null, reviewer: "available", needsAdmin: false, mayReview: true }],
    notes: [],
    history: [],
    strikeDue: { due: false, why: "already_struck" },
    authorStanding: { activeStrikes: "3_or_more", suspensionsInYear: "0", now: "announced" },
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
    appealsYouMayReview: 1,
    appealsWithoutReviewer: 1,
    reveals: { total: 1, items: [{ at: "2026-09-30T10:00:00.000Z", handle: HOSTILE.script, caseId: CASE_POST }] },
    imagesToday: [{ handle: HOSTILE.img, count: 4 }],
    findingsToday: [{ handle: HOSTILE.bidi, count: 1 }],
    mailsWaiting: { receipts: 0, authorMails: 0, outcomes: 0 },
    mailsFailed: { receipts: 0, authorMails: 0, outcomes: 0 },
    releaseOverdue: 0,
    erasureOverdue: { caseEvidence: 0, intakeRecords: 0, statements: 0, redactions: 0, images: 0, drafts: 0, accessLog: 0, contacts: 0 },
    deferUnproven: false,
    protectionLifted: { total: 0, items: [] },
    sealsDeclined: { total: 0, items: [] },
    // 3e Task 4: no reply waits and no account is at the ladder's strikes, unless a test says otherwise.
    repliesWaiting: { count: 0, oldestAt: null },
    strikeAccounts: 0,
    interimSeals: { total: 0, items: [] },
    ...overrides,
  };
}

// 3e (design, section 8.3): a case about an account whose handle a report says impersonates someone.
export const CASE_RETIRE = "7081a2b3-c4d5-46e7-88f9-0a1b2c3d4e5f";
export const ITEM_RETIRE = "8192b3c4-d5e6-47f8-99a0-1b2c3d4e5f60";

/** 3e: an account case's standing with nothing on the record: no strike, nothing live, and the snapshot's handle not retired. */
export const NO_ACCOUNT_STANDING: CaseStanding = {
  activeStrikes: 0,
  strikes: [],
  ladderRule: null,
  suspensionsInYear: 0,
  lastSuspendedOn: null,
  maxDays: null,
  mayTerminate: false,
  live: false,
  openReports: true,
  atOnce: [],
  flood: { posts: 0, from: "2026-10-01T08:00:00.000Z", to: "2026-10-01T09:00:00.000Z" },
  seal: null,
  snapshotHandleRetired: false,
  basisDecidedAt: { threat: null, terrorist: null, protective: null },
};

/**
 * 3e: an account's case in lane 2 that holds one rule report under R4 about its handle, unanswered, with a snapshot
 * whose handle is the one the profile holds now unless told otherwise, and the account's standing. `live` is the handle
 * the profile holds now; `snapped` the one the newest snapshot copied.
 */
export function retireCase(live = "Ada_L", snapped = "Ada_L", standing: Partial<CaseStanding> = {}): CaseView {
  const base = accountCase();
  const [copied] = base.snapshots;
  if (!copied || copied.withheld) throw new Error("the account case's snapshot shows its content");
  return accountCase({
    id: CASE_RETIRE,
    lane: 2,
    stateVersion: 1,
    intakeSeq: 1,
    suspicion: null,
    target: { type: "account", id: ACCOUNT_ID, handle: live, displayName: "Ada", bio: "", deleted: false },
    snapshots: [{ ...copied, authorHandle: snapped, handle: snapped, displayName: "Ada", bio: "" }],
    items: [item({ id: ITEM_RETIRE, ruleId: "R4", category: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS", link: "http://localhost:8081/u/ada_l" })],
    history: [],
    standing: { ...NO_ACCOUNT_STANDING, ...standing },
  });
}

// 3e Task 3 (design, section 8.3): an account case on an admin's own finding, where a suspension at once is decided.
export const CASE_AT_ONCE = "8a9b0c1d-2e3f-4a5b-9c6d-7e8f9a0b1c2d";
export const ITEM_AT_ONCE = "9b0c1d2e-3f4a-4b5c-8d6e-8f9a0b1c2d3e";

/**
 * 3e Task 3: an account's case that holds an admin's own finding under R5, unanswered (no report waits, so a measure that
 * answers findings only is open), with the account's standing: the grounds of a suspension at once that the database
 * would accept now (`atOnce`), and the decisions each would rest on. A test passes what differs.
 */
export function atOnceCase(standing: Partial<CaseStanding> = {}, rule: "R2" | "R5" | "R6" = "R5"): CaseView {
  return accountCase({
    id: CASE_AT_ONCE,
    lane: 1,
    stateVersion: 1,
    intakeSeq: 1,
    suspicion: rule === "R2" ? accountCase().suspicion : null,
    target: { type: "account", id: ACCOUNT_ID, handle: "flood_er", displayName: "Flooder", bio: "", deleted: false },
    items: [item({ id: ITEM_AT_ONCE, ruleId: rule, suspect: rule === "R2", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", link: "http://localhost:8081/u/flood_er", explanation: null, source: SOURCES.staff })],
    history: [],
    standing: {
      ...NO_ACCOUNT_STANDING,
      openReports: false,
      atOnce: ["threat", "flood"],
      flood: { posts: 23, from: "2026-10-12T08:30:00.000Z", to: "2026-10-12T09:30:00.000Z" },
      basisDecidedAt: { threat: "2026-10-10T08:00:00.000Z", terrorist: null, protective: null },
      ...standing,
    },
  });
}

// ---------------------------------------------------------------- 3e Task 4: the ladder, a reply and a withdrawal

export const CASE_LADDER = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const ITEM_LADDER = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
export const CASE_REPLIED = "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f";
export const DECISION_REPLIED = "d4e5f6a7-b8c9-4dae-9f1a-3b4c5d6e7f80";
export const ACTION_REPLIED = "e5f6a7b8-c9da-4ebf-801b-4c5d6e7f8091";
export const CASE_WITHDRAW = "f6a7b8c9-daeb-4fc0-912c-5d6e7f8091a2";
export const DECISION_WITHDRAW = "07b8c9da-ebfc-40d1-a23d-6e7f8091a2b3";
/** What the account's holder wrote in their reply: markup, which the console shows as text and nowhere but on the case. */
export const REPLY_TEXT = `These posts quote a film ${HOSTILE.script}`;

/** Three active strikes under R1 and R3, the newest under R1, as an account case's standing lists them. */
const THREE_STRIKES: CaseStanding["strikes"] = [
  { decisionId: "18c9daeb-fc0d-41e2-b34e-7f8091a2b3c4", caseId: CASE_POST, ruleId: "R3", decidedAt: "2026-09-20T09:00:00.000Z", countsUntil: "2026-12-19T09:00:00.000Z" },
  { decisionId: "29daebfc-0d1e-42f3-845f-8091a2b3c4d5", caseId: CASE_POST, ruleId: "R1", decidedAt: "2026-09-27T09:00:00.000Z", countsUntil: "2026-12-26T09:00:00.000Z" },
  { decisionId: "3aebfc0d-1e2f-4304-9560-91a2b3c4d5e6", caseId: CASE_POST, ruleId: "R1", decidedAt: "2026-10-04T09:00:00.000Z", countsUntil: "2027-01-02T09:00:00.000Z" },
];

/**
 * 3e Task 4: an account case at the ladder's first step, opened by a moderator's own finding: three active strikes, the
 * newest under R1, a rung of 3 days, and nothing live. With `openReports` it also holds a report that waits, which greys
 * the announced measures with [reports.first].
 */
export function ladderCase(openReports = false): CaseView {
  return accountCase({
    id: CASE_LADDER,
    lane: 2,
    stateVersion: 1,
    intakeSeq: 1,
    suspicion: null,
    target: { type: "account", id: ACCOUNT_ID, handle: "lad_der", displayName: "Ladder", bio: "", deleted: false },
    items: [item({ id: ITEM_LADDER, ruleId: "R1", suspect: false, category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", link: "http://localhost:8081/u/lad_der", explanation: null, source: SOURCES.staff })],
    history: [],
    standing: { ...NO_ACCOUNT_STANDING, activeStrikes: 3, strikes: THREE_STRIKES, ladderRule: "R1", maxDays: 3, openReports },
  });
}

/** An announced suspension of 3 days, as a decision's row on the case page holds it, with where its period stands and its reply. */
function announcedSuspension(id: string, period: NonNullable<CaseDecisionAction["period"]>, reply: CaseDecisionAction["reply"]): CaseDecisionAction {
  return {
    id,
    kind: "suspend",
    mediaId: null,
    noEffect: null,
    inForce: true,
    reversesActionId: null,
    liftedBy: null,
    sealed: null,
    ...NO_STANDING,
    days: 3,
    announced: true,
    basis: "strikes",
    restsOn: THREE_STRIKES.map((strike) => strike.decisionId),
    earliestStart: "2026-10-12T09:00:00.000Z",
    period,
    reply,
  };
}

/**
 * 3e Task 4: an account case closed by a moderator's announced suspension of 3 days, whose holder replied before the
 * start (the start is held), in words that hold markup; the case lists nothing open, and the account's measure is live.
 */
export function repliedCase(): CaseView {
  return accountCase({
    id: CASE_REPLIED,
    lane: 2,
    stateVersion: 4,
    intakeSeq: 1,
    answeredSeq: 1,
    closedAt: "2026-10-05T09:00:00.000Z",
    suspicion: null,
    target: { type: "account", id: ACCOUNT_ID, handle: "repl_ier", displayName: "Replier", bio: "", deleted: false },
    items: [item({ id: "18d9eafb-0c1d-42e3-a45f-708192a3b4c5", ruleId: "R1", suspect: false, outcome: "restricted_rule", answeredBy: DECISION_REPLIED, link: "http://localhost:8081/u/repl_ier", explanation: null, source: SOURCES.staff })],
    decisions: [
      decision({
        id: DECISION_REPLIED,
        kind: "final",
        ruleId: "R1",
        rulesVersion: 3,
        redressVersion: 2,
        throughSeq: 1,
        answersFromSeq: 1,
        decidedAt: "2026-10-05T09:00:00.000Z",
        facts: "When this was written the account had 3 active strikes.",
        reason: "Three strikes in three weeks.",
        actions: [announcedSuspension(ACTION_REPLIED, { startsAt: null, endsAt: null, state: "held" }, { filedAt: "2026-10-06T10:00:00.000Z", onTime: true, text: REPLY_TEXT, answeredAt: null, answeredBy: null })],
      }),
    ],
    history: [],
    standing: { ...NO_ACCOUNT_STANDING, activeStrikes: 3, strikes: THREE_STRIKES, ladderRule: "R1", live: true, openReports: false },
  });
}

/**
 * 3e Task 4: an account case whose announced suspension has a start fixed and ahead, with no reply, while the account's
 * measure is live: the composer shows [conflict], and an admin may withdraw it for another measure.
 */
export function withdrawCase(): CaseView {
  return accountCase({
    id: CASE_WITHDRAW,
    lane: 2,
    stateVersion: 2,
    intakeSeq: 1,
    answeredSeq: 1,
    closedAt: null,
    suspicion: null,
    target: { type: "account", id: ACCOUNT_ID, handle: "with_drawn", displayName: "Withdrawn", bio: "", deleted: false },
    items: [item({ id: "29eafb0c-1d2e-43f4-b56a-8192a3b4c5d6", ruleId: "R5", suspect: false, category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", link: "http://localhost:8081/u/with_drawn", explanation: null, source: SOURCES.staff })],
    decisions: [
      decision({
        id: DECISION_WITHDRAW,
        kind: "final",
        ruleId: "R1",
        rulesVersion: 3,
        redressVersion: 2,
        throughSeq: 1,
        answersFromSeq: 1,
        decidedAt: "2026-10-05T09:00:00.000Z",
        facts: "When this was written the account had 3 active strikes.",
        reason: "Three strikes in three weeks.",
        actions: [announcedSuspension("3afb0c1d-2e3f-4405-867b-92a3b4c5d6e7", { startsAt: "2026-10-12T09:05:00.000Z", endsAt: "2026-10-15T09:05:00.000Z", state: "announced" }, null)],
      }),
    ],
    history: [],
    standing: { ...NO_ACCOUNT_STANDING, activeStrikes: 3, strikes: THREE_STRIKES, ladderRule: "R1", live: true, openReports: false, atOnce: [] },
  });
}
