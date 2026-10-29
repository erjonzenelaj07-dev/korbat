import { describe, expect, test } from "vitest";
import { ExploreStatusKind, type AccountStanding, type MeResponse, type PostView } from "@korbat/contracts";
import { exploreStatusText } from "../src/lib/explore";
import { chipText } from "../src/lib/moderation";
import { CHIP_WORDS } from "../src/lib/moderation-words";
import { reach, type Reach } from "../src/lib/reach";
import { UI_WORDS } from "../src/lib/ui-words";

/**
 * Who sees a post (UI design, section 6.14; Task 4): reach() turns the post, the reader's /me and, for the reader's own
 * top-level post, its Explore status into the sentences of the "Who sees this" sheet. Every branch is here, and the three
 * things no sentence may claim: a reader's view of someone else's post never mentions moderation, no sentence says a
 * blocked account cannot read a public post, and the sentence of a withheld or removed post names korbat's moderators.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADA = { id: id(1), handle: "ada", displayName: "Ada", verified: false };
const BEN = { id: id(2), handle: "ben", displayName: "Ben", verified: false };

function post(extra: Partial<PostView> = {}): PostView {
  return {
    id: id(100),
    author: ADA,
    body: "a post",
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    imported: null,
    mentions: [],
    countsHidden: false,
    ...extra,
  };
}

const STANDING: AccountStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };

function me(extra: { showInExplore?: boolean; standing?: AccountStanding } = {}): MeResponse {
  return {
    user: { id: ADA.id, email: "ada@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 },
    profile: { id: ADA.id, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: extra.showInExplore ?? true, sharePreviews: false },
    standing: extra.standing ?? STANDING,
  } as MeResponse;
}

const suspended: AccountStanding = {
  ...STANDING,
  measure: {
    decisionId: id(9),
    kind: "suspend",
    days: 7,
    state: "running",
    earliestStart: "2026-10-01T10:00:00.000Z",
    startsAt: "2026-10-01T10:00:00.000Z",
    endsAt: "2026-10-08T10:00:00.000Z",
    reply: null,
    replyOpen: true,
    appealUntil: null,
    appealPending: false,
  },
} as AccountStanding;

const texts = (found: Reach): string[] => found.lines.map((line) => line.text);
const W = UI_WORDS;

describe("the sentences, word for word (6.14)", () => {
  test("each is the design's", () => {
    expect(W["reach.public"]).toBe("Public. Anyone can read it, including people who are not signed in.");
    expect(W["reach.blocked"]).toBe("Accounts you blocked do not see it in their feeds, but anyone signed out can still read it.");
    expect(W["reach.feeds"]).toBe("It shows in Latest and in your followers' Following, in time order.");
    expect(W["reach.inExplore"]).toBe("Also in Explore.");
    expect(W["reach.exploreOff"]).toBe("Not in Explore: you turned Explore off.");
    expect(W["reach.suspended"]).toBe("Not in Explore while your account is suspended.");
    expect(W["reach.reply"]).toBe("Public. Shown in the thread and on your Replies tab.");
    expect(W["reach.private"]).toBe("Only you and korbat's moderators can see it.");
    expect(W["reach.order"]).toBe("Removed for everyone else by an authority's order.");
    expect(W["reach.decision"]).toBe("Read the decision");
    expect(W["reach.never"]).toBe("korbat never lowers a post's reach in secret. Following and Latest are in time order.");
    expect(W["reach.how"]).toBe("How Explore works");
  });
});

describe("reach()", () => {
  const last = { text: W["reach.never"], link: { label: W["reach.how"], href: "/explore/about" } };

  test("someone else's post, signed in or out: public, then how korbat treats reach, and nothing to ask", () => {
    for (const reader of [null, me()]) {
      const found = reach(post({ author: BEN }), reader);
      expect(found.lines).toEqual([{ text: W["reach.public"] }, last]);
      expect(found.asksExplore).toBe(false);
      expect(found.summary).toBe(W["reach.summary.public"]);
    }
  });

  test("the reader's own visible top-level post: public, what a block does, the feeds, and one Explore line", () => {
    const head = [W["reach.public"], W["reach.blocked"], W["reach.feeds"]];
    expect(texts(reach(post({ inExplore: true }), me()))).toEqual([...head, W["reach.inExplore"], W["reach.never"]]);
    expect(texts(reach(post(), me({ showInExplore: false })))).toEqual([...head, W["reach.exploreOff"], W["reach.never"]]);
    expect(texts(reach(post(), me({ standing: suspended })))).toEqual([...head, W["reach.suspended"], W["reach.never"]]);
    // Otherwise the sheet asks the post's Explore status when it opens, and says it in the words of the status line.
    const asking = reach(post(), me());
    expect(asking.asksExplore).toBe(true);
    expect(texts(asking)).toEqual([...head, W["reach.never"]]);
    for (const status of ["below_cutoff", "pending", "author_cap", "not_visible"] as const) {
      const answered = reach(post(), me(), status);
      expect(answered.asksExplore).toBe(false);
      expect(texts(answered)).toEqual([...head, exploreStatusText(status)!, W["reach.never"]]);
    }
    // The flags decide before any answer: the sheet does not ask when it already knows.
    for (const known of [reach(post({ inExplore: true }), me()), reach(post(), me({ showInExplore: false })), reach(post(), me({ standing: suspended }))]) expect(known.asksExplore).toBe(false);
    expect(reach(post(), me()).summary).toBe(W["reach.summary.public"]);
  });

  test("the reader's own reply: shown in the thread and on the Replies tab, and never in Explore", () => {
    const found = reach(post({ replyTo: { id: id(50), authorHandle: "ben" } }), me());
    expect(texts(found)).toEqual([W["reach.reply"], W["reach.replyExplore"], W["reach.never"]]);
    expect(found.asksExplore).toBe(false);
  });

  test("the reader's own quote never enters Explore either, so nothing is asked", () => {
    const quoted = { ...post({ id: id(60), author: BEN }), quoteOf: null };
    const found = reach(post({ quoteOf: quoted }), me());
    expect(texts(found)).toEqual([W["reach.public"], W["reach.blocked"], W["reach.feeds"], W["reach.quoteExplore"], W["reach.never"]]);
    expect(found.asksExplore).toBe(false);
  });

  test("the reader's own withheld or removed post: only they and the moderators, the chip's words, an order, and the decision", () => {
    const decision = { decisionId: id(7), ruleId: "R3" as const, legal: false, interim: false, strikeUntil: null };
    const removed = reach(post({ state: "removed", moderation: decision }), me());
    expect(removed.lines).toEqual([{ text: W["reach.private"] }, { text: chipText(decision), link: { label: W["reach.decision"], href: `/settings/cases/${id(7)}` } }, last]);
    expect(removed.asksExplore).toBe(false);
    expect(removed.summary).toBe(W["reach.summary.private"]);
    const ordered = reach(post({ state: "removed", moderation: { ...decision, order: true } }), me());
    expect(texts(ordered)).toEqual([W["reach.private"], chipText({ ...decision, order: true }), W["reach.order"], W["reach.never"]]);
    // Without the decision's facts the chip's plain words stand, and there is no decision to read.
    const bare = reach(post({ state: "withheld" }), me());
    expect(bare.lines).toEqual([{ text: W["reach.private"] }, { text: CHIP_WORDS.underReview }, last]);
    expect(texts(reach(post({ state: "removed" }), me()))).toEqual([W["reach.private"], CHIP_WORDS.removed, W["reach.never"]]);
  });

  test("always ends with how korbat treats reach, linked to How Explore works", () => {
    const shapes = [post({ author: BEN }), post(), post({ inExplore: true }), post({ replyTo: { id: id(50), authorHandle: null } }), post({ state: "withheld" })];
    for (const shape of shapes) expect(reach(shape, me()).lines.at(-1)).toEqual(last);
  });
});

describe("what no sentence may claim (6.14)", () => {
  /** Every sentence any branch can give, with each Explore status the sheet can be answered. */
  function everySentence(): { own: string[]; others: string[] } {
    const own: string[] = [];
    const others: string[] = [];
    const decision = { decisionId: id(7), ruleId: "R3" as const, legal: true, interim: true, strikeUntil: null, order: true };
    const shapes = [
      post(),
      post({ inExplore: true }),
      post({ replyTo: { id: id(50), authorHandle: "ben" } }),
      post({ quoteOf: { id: id(61), deleted: true } }),
      post({ state: "withheld", moderation: decision }),
      post({ state: "removed" }),
    ];
    for (const shape of shapes) {
      for (const reader of [me(), me({ showInExplore: false }), me({ standing: suspended })]) {
        own.push(...texts(reach(shape, reader)));
        for (const status of ExploreStatusKind.options) own.push(...texts(reach(shape, reader, status)));
        // The same post seen by someone else, even one whose view carried moderation it should not.
        for (const viewer of [null, reader]) others.push(...texts(reach({ ...shape, author: BEN }, viewer)));
      }
    }
    return { own, others };
  }

  test("a reader's view of someone else's post never mentions moderation", () => {
    const { others } = everySentence();
    for (const sentence of others) {
      expect(sentence).not.toMatch(/moderat|Removed|Under review|authority|decision|withheld/i);
    }
    expect(new Set(others)).toEqual(new Set([W["reach.public"], W["reach.never"]]));
  });

  test("no sentence says a blocked account cannot read a public post", () => {
    const { own, others } = everySentence();
    for (const sentence of [...own, ...others]) {
      if (/block/i.test(sentence)) expect(sentence).toContain("anyone signed out can still read it");
      expect(sentence).not.toMatch(/cannot read|can't read|can not read|cannot see|can't see|unable to/i);
    }
  });

  test("the sentence of a withheld or removed post names korbat's moderators", () => {
    for (const state of ["withheld", "removed"] as const) expect(texts(reach(post({ state }), me()))[0]).toContain("korbat's moderators");
  });
});

// 3b Task 7 appends below: Who sees this for an imported post (3b design, sections 8.4, 10.6 and decision 28).
import { IMPORT_WORDS, provenanceWords } from "../src/lib/import-words";

describe("an imported post (3b, 10.6)", () => {
  const LABEL = { source: "x" as const, at: "2019-03-03", shortened: false };
  const imported = (extra: Partial<PostView> = {}) => post({ imported: LABEL, createdAt: "2026-10-21T10:00:00.000Z", ...extra });
  const provenance = provenanceWords(LABEL, "2026-10-21T10:00:00.000Z");

  test("someone else's: public, then where imported posts show in place of the feeds, then the provenance paragraph, and how korbat treats reach", () => {
    for (const reader of [null, me()]) {
      const found = reach(imported({ author: BEN }), reader);
      expect(texts(found)).toEqual([W["reach.public"], IMPORT_WORDS["import.reach"], provenance, W["reach.never"]]);
      expect(found.asksExplore).toBe(false);
    }
  });

  test("the reader's own: what a block does, then import.reach in place of the feeds' and Explore's lines; /explore is never asked", () => {
    const found = reach(imported(), me());
    expect(texts(found)).toEqual([W["reach.public"], W["reach.blocked"], IMPORT_WORDS["import.reach"], provenance, W["reach.never"]]);
    expect(found.asksExplore).toBe(false);
    expect(texts(found)).not.toContain(W["reach.feeds"]);
    // Even with an Explore answer in hand, no Explore line is added: the status is known.
    expect(texts(reach(imported(), me(), "listed"))).toEqual(texts(found));
    // A thread's own reply, imported, is said the same way: imported posts are on no Replies tab either.
    expect(texts(reach(imported({ replyTo: { id: id(50), authorHandle: "ada" } }), me()))).toEqual(texts(found));
  });

  test("the provenance line is marked, so the label's press opens the sheet at it; its first sentence is decision 28's fact", () => {
    const line = reach(imported({ author: BEN }), null).lines.find((entry) => entry.text === provenance)!;
    expect(line.mark).toBe("provenance");
    expect(provenance.startsWith("Anyone who searches the words of an imported post may find the original and the account that wrote it.")).toBe(true);
    expect(provenance).toContain("This account imported it from X on 21 Oct 2026. The archive dates it 3 March 2019 (UTC).");
  });

  test("the reader's own withheld imported post keeps the private branch, with the provenance before the last line", () => {
    const found = reach(imported({ state: "withheld" }), me());
    expect(texts(found)[0]).toBe(W["reach.private"]);
    expect(texts(found).at(-2)).toBe(provenance);
  });

  test("no sentence names an account elsewhere: no @handle, no address, nothing but the source's name", () => {
    for (const found of [reach(imported({ author: BEN }), null), reach(imported(), me()), reach(imported({ state: "removed" }), me())]) {
      for (const sentence of texts(found)) {
        expect(sentence).not.toMatch(/@[A-Za-z0-9_]/);
        expect(sentence).not.toMatch(/https?:|www\./);
      }
    }
  });
});
