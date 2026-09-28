import { describe, expect, test } from "vitest";
import { EXPLORE_V1, ExplorePage, ExploreSettingResponse, ExploreStatus, ExploreStatusKind, TimelineItem, type ExploreFormula } from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = { id: id(1), handle: "ada", displayName: "Ada", verified: false };
const post = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  author,
  body: "hello",
  createdAt: "2026-09-28T10:00:00.000Z",
  state: "visible",
  replyTo: null,
  counts: { likes: 3, reposts: 1, replies: 0, quotes: 0 },
  media: [],
  quoteOf: null,
  ...extra,
});
const at = "2026-09-28T12:05:00.000Z";
const repost = { kind: "repost", post: post(2), repostedBy: author, repostedAt: at };

describe("the Explore formula", () => {
  test("EXPLORE_V1 holds exactly the numbers of the 2c design, section 5, and the change log", () => {
    expect(EXPLORE_V1).toStrictEqual({
      version: 1,
      windowHours: 48,
      engagerMinAgeHours: 48,
      standingMinutes: 10,
      threshold: 3,
      gravity: 1.8,
      offsetHours: 2,
      perAuthor: 2,
      listLength: 300,
      refreshMinutes: 5,
      minGapMinutes: 4.5,
      kept: 2,
      signedOutPage: 20,
      changes: [{ version: 1, date: "2026-09-28", summary: "First version." }],
    });
  });

  test("EXPLORE_V1 is frozen all the way down, so nothing at run time can change the published numbers", () => {
    expect(Object.isFrozen(EXPLORE_V1)).toBe(true);
    expect(Object.isFrozen(EXPLORE_V1.changes)).toBe(true);
    for (const change of EXPLORE_V1.changes) expect(Object.isFrozen(change)).toBe(true);
    // Modules run in strict mode, where writing to a frozen object throws instead of failing silently.
    expect(() => {
      (EXPLORE_V1 as { threshold: number }).threshold = 1;
    }).toThrow(TypeError);
    expect(() => {
      (EXPLORE_V1.changes as unknown as unknown[]).push({ version: 2, date: "2026-10-01", summary: "Changed." });
    }).toThrow(TypeError);
    expect(() => {
      (EXPLORE_V1.changes[0] as { summary: string }).summary = "Changed.";
    }).toThrow(TypeError);
    expect(EXPLORE_V1.threshold).toBe(3);
    expect(EXPLORE_V1.changes).toHaveLength(1);
  });

  test("the change log ends with the formula's own version", () => {
    expect(EXPLORE_V1.changes.at(-1)?.version).toBe(EXPLORE_V1.version);
  });

  test("a formula with other numbers has the same type, so the refresh can take one, and EXPLORE_V1 is untouched", () => {
    const changed: ExploreFormula = { ...EXPLORE_V1, threshold: 5, perAuthor: 1, listLength: 10, minGapMinutes: 0 };
    expect(changed).toMatchObject({ version: 1, threshold: 5, perAuthor: 1, listLength: 10, minGapMinutes: 0, gravity: 1.8 });
    expect(EXPLORE_V1).toMatchObject({ threshold: 3, perAuthor: 2, listLength: 300, minGapMinutes: 4.5 });
  });
});

describe("the Explore page", () => {
  test("carries post items, the cursor, the time the ranking was computed and the sign-in prompt", () => {
    const page = {
      items: [
        { kind: "post", post: post(1) },
        // A signed-in reader's items carry their own like, repost and bookmark flags, as on every list.
        { kind: "post", post: post(3, { viewer: { liked: true, reposted: false, bookmarked: false } }) },
      ],
      // Opaque to the contract: the API's Explore cursor names a ranking and the last post read.
      nextCursor: "opaque-cursor",
      computedAt: at,
      signInForMore: false,
    };
    expect(ExplorePage.parse(page)).toEqual(page);
  });

  test("before the first round it is empty, with no cursor and no time; a signed-out page may end in the sign-in prompt", () => {
    const empty = { items: [], nextCursor: null, computedAt: null, signInForMore: false };
    expect(ExplorePage.parse(empty)).toEqual(empty);
    const signedOut = { items: [{ kind: "post", post: post(1) }], nextCursor: null, computedAt: at, signInForMore: true };
    expect(ExplorePage.parse(signedOut)).toEqual(signedOut);
  });

  test("refuses a repost item, which is a valid timeline item elsewhere: Explore lists original posts only", () => {
    expect(TimelineItem.safeParse(repost).success).toBe(true);
    const base = { nextCursor: null, computedAt: at, signInForMore: false };
    expect(ExplorePage.safeParse({ ...base, items: [repost] }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...base, items: [{ kind: "post", post: post(1) }, repost] }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...base, items: [{ kind: "post" }] }).success).toBe(false);
  });

  test("needs every field, with its type", () => {
    const page = { items: [], nextCursor: null, computedAt: at, signInForMore: false };
    for (const key of Object.keys(page)) {
      const partial: Record<string, unknown> = { ...page };
      delete partial[key];
      expect(ExplorePage.safeParse(partial).success, key).toBe(false);
    }
    expect(ExplorePage.safeParse({ ...page, computedAt: "five minutes ago" }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...page, computedAt: "2026-09-28" }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...page, nextCursor: 2 }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...page, signInForMore: "no" }).success).toBe(false);
  });

  test("shows only the order: no score, rank or count beside the items, the cursor, the time and the prompt", () => {
    expect(Object.keys(ExplorePage.shape).sort()).toEqual(["computedAt", "items", "nextCursor", "signInForMore"]);
  });
});

describe("the author's Explore status", () => {
  test("names one of twelve reasons, in the order the status route tries them", () => {
    expect(ExploreStatusKind.options).toEqual([
      "reply",
      "quote",
      "not_visible",
      "hidden_by_author",
      "listed",
      "outside_window",
      "no_ranking",
      "new_since_ranking",
      "below_threshold",
      "pending",
      "author_cap",
      "below_cutoff",
    ]);
  });

  test("carries the status and the time of the ranking it was judged against, which is null before the first round", () => {
    for (const status of ExploreStatusKind.options) {
      expect(ExploreStatus.parse({ status, computedAt: at }), status).toEqual({ status, computedAt: at });
    }
    expect(ExploreStatus.parse({ status: "no_ranking", computedAt: null })).toEqual({ status: "no_ranking", computedAt: null });
  });

  test("refuses an unknown status, a missing field and a time that is not an ISO datetime", () => {
    // No lever acts on Explore alone: moderation reaches it only through the post's state, which is not_visible.
    expect(ExploreStatus.safeParse({ status: "hidden_by_moderator", computedAt: at }).success).toBe(false);
    expect(ExploreStatus.safeParse({ status: "Listed", computedAt: at }).success).toBe(false);
    expect(ExploreStatus.safeParse({ status: "listed" }).success).toBe(false);
    expect(ExploreStatus.safeParse({ computedAt: at }).success).toBe(false);
    expect(ExploreStatus.safeParse({ status: "listed", computedAt: "now" }).success).toBe(false);
  });

  test("carries no count: its fields are exactly the status and the time", () => {
    expect(Object.keys(ExploreStatus.shape).sort()).toEqual(["computedAt", "status"]);
  });
});

describe("the author's Explore switch", () => {
  test("answers with the switch's state, on or off", () => {
    expect(ExploreSettingResponse.parse({ showInExplore: true })).toEqual({ showInExplore: true });
    expect(ExploreSettingResponse.parse({ showInExplore: false })).toEqual({ showInExplore: false });
    expect(ExploreSettingResponse.safeParse({}).success).toBe(false);
    expect(ExploreSettingResponse.safeParse({ showInExplore: "on" }).success).toBe(false);
    expect(ExploreSettingResponse.safeParse({ showInExplore: null }).success).toBe(false);
  });
});
