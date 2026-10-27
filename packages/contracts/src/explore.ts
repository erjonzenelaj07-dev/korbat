import { z } from "zod";
import { TimelineItem, page } from "./social";

/**
 * One version of the Explore formula (2c design, sections 5 and 7). The refresh takes one as an argument and passes
 * its numbers into its SQL, and the web app's texts print them, so the published rules and the ranking cannot
 * disagree. Tests pass copies with other numbers.
 */
export interface ExploreFormula {
  /** Stored with every ranking and printed with the change log. */
  readonly version: number;
  /** A post is a candidate for this many hours after it was created, not counting (from v2) time moderation kept it hidden. */
  readonly windowHours: number;
  /** A like or repost counts only when its account was at least this many hours old when it engaged. */
  readonly engagerMinAgeHours: number;
  /** A like or repost counts only once it has stood this long, so one made just before a refresh and undone after it never counts. */
  readonly standingMinutes: number;
  /** The fewest approving accounts (distinct accounts other than the author that liked or reposted it) a post needs. */
  readonly threshold: number;
  /** The score is approvers / (hours since the post was created, from v2 less the time moderation kept it hidden, + offsetHours) ^ gravity. */
  readonly gravity: number;
  readonly offsetHours: number;
  /** At most this many posts of one author in a ranking. */
  readonly perAuthor: number;
  /** A ranking holds at most this many posts. */
  readonly listLength: number;
  /** How often the job runs a round. */
  readonly refreshMinutes: number;
  /** A round writes nothing while the newest ranking is younger than this, so at most one ranking lands per interval. */
  readonly minGapMinutes: number;
  /** Rankings kept: the current one and the one before, so a reader paging through one has at least minGapMinutes. */
  readonly kept: number;
  /** A signed-out reader gets at most this many posts, and no cursor. */
  readonly signedOutPage: number;
  /** The published change log, oldest first; the last entry is this version. */
  readonly changes: readonly { readonly version: number; readonly date: string; readonly summary: string }[];
}

/**
 * Explore v2 (3e design, sections 7.13 and 10.1), in place of v1, which is no longer exported: the same numbers, two
 * changed rules. Posts of accounts suspended when the ranking is computed are not candidates, and their likes and reposts
 * do not count; a post's window and age count from when moderation last gave it back its time (posts.explore_from, which
 * only the database's moderation_apply writes) or else from when it was posted. The round, the status and the app take
 * this one constant, and the round refuses any other version, so no ranking is stored under rules it did not apply.
 * Frozen all the way down: nothing at run time may change what How Explore works publishes.
 */
export const EXPLORE_V2: ExploreFormula = Object.freeze({
  version: 2,
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
  changes: Object.freeze([
    Object.freeze({ version: 1, date: "2026-09-28", summary: "First version." }),
    // Dated the day the task that builds version 2 reached the repository (3e design, section 10.1), worded as section 9.7.
    Object.freeze({
      version: 2,
      date: "2026-10-12",
      summary:
        "Posts of suspended accounts are not ranked, and a suspended account's likes and reposts do not count. A post that moderation hid and then restored gets back the time it was hidden.",
    }),
  ]),
});

/** A timeline item of kind post. Explore ranks original posts only, so a repost item is refused. */
const ExploreItem = TimelineItem.refine((item) => item.kind === "post", { message: "Explore lists posts, not reposts" });

/**
 * A page of Explore. It shows only the order: the items are ordinary post views with their public counts, and no score,
 * rank or count is sent. `computedAt` is when the ranking was computed, null before the first round; `signInForMore`
 * tells a signed-out reader, who gets no cursor, that more posts follow.
 */
export const ExplorePage = page(ExploreItem).extend({ computedAt: z.iso.datetime().nullable(), signInForMore: z.boolean() });
export type ExplorePage = z.infer<typeof ExplorePage>;

/** Why a post is in Explore or not, for its author only; the status route answers the first that applies, in this order. */
export const ExploreStatusKind = z.enum([
  // Replies and quotes never enter.
  "reply",
  "quote",
  // 3b (design, sections 8.5 and 10.6): an imported post enters no feed on its own, Explore included.
  "imported",
  // Withheld, removed or deleted.
  "not_visible",
  // The author's account is suspended now (3e): its posts leave Explore at the next read.
  "suspended",
  // The author switched Explore off.
  "hidden_by_author",
  // In the current ranking; a listed post stays listed until the next round, even past its window.
  "listed",
  // Older than the window now, counted (from v2) without the time moderation kept it hidden.
  "outside_window",
  // No round has run yet.
  "no_ranking",
  // Created after the current ranking was computed.
  "new_since_ranking",
  // Fewer approving accounts than the threshold now.
  "below_threshold",
  // The next refresh considers it: the threshold is met now but was not when the ranking was computed, or it was met then
  // and a cause that kept the post out has since gone.
  "pending",
  // The author's other posts filled the per-author cap.
  "author_cap",
  // The list was full.
  "below_cutoff",
]);
export type ExploreStatusKind = z.infer<typeof ExploreStatusKind>;

/**
 * The author's status of one post, with `computedAt` the time of the current ranking (null before the first round). It
 * carries no count, which would let an author work out which accounts liked the post.
 */
export const ExploreStatus = z.object({ status: ExploreStatusKind, computedAt: z.iso.datetime().nullable() });
export type ExploreStatus = z.infer<typeof ExploreStatus>;

/** What turning "Show my posts in Explore" on or off answers. */
export const ExploreSettingResponse = z.object({ showInExplore: z.boolean() });
export type ExploreSettingResponse = z.infer<typeof ExploreSettingResponse>;
