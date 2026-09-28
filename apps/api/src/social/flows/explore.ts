import { EXPLORE_V1, type ExploreFormula, type ExplorePage, type ExploreSettingResponse, type ExploreStatus, type ExploreStatusKind, type Pagination } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeExploreCursor, encodeExploreCursor } from "../cursor";
import { postViews } from "../views";

/**
 * A page of Explore (2c design, section 8): the posts of a ranking in its order, as ordinary post views, with the time the
 * ranking was computed. Without a cursor the current ranking is read; with one, the ranking it names, after the post it
 * names: a ranking not yet written, or a post that ranking does not hold, is not a cursor this module made (400), and a
 * ranking no longer kept is explore_refreshed (409), so the reader starts again from the current one. A signed-out
 * reader gets at most the formula's signed-out page whatever the limit asks, and never a cursor (the route refuses one
 * before this flow); one more row is read through the same filters, and `signInForMore` says whether it came back. The
 * cursor follows the repository's rows, not the views, which the view builder may still drop.
 */
export async function explorePage(deps: SocialDeps, viewer: ViewerId, query: Pagination, formula: ExploreFormula = EXPLORE_V1): Promise<ExplorePage> {
  const cursor = query.cursor ? decodeExploreCursor(query.cursor) : undefined;
  const limit = viewer ? query.limit : Math.min(query.limit, formula.signedOutPage);
  const read = await deps.repo.explorePage(viewer, cursor, viewer ? limit : limit + 1);
  if (cursor) {
    // In this order: every answer comes from one statement, so a round landing in between cannot change which applies.
    if (read.current !== null && cursor.g > read.current) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
    if (!read.ranking) throw new SocialError("explore_refreshed", 409);
    if (read.after === null) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  }
  // Before the first round there is no ranking to read and no time to show.
  if (!read.ranking) return { items: [], nextCursor: null, computedAt: null, signInForMore: false };
  const rows = read.rows.slice(0, limit);
  // A ranking holds posts, never reposts; the ranking's time stands in for the sort time, which a post item never shows.
  const views = await postViews(
    deps,
    viewer,
    rows.map((row) => ({ postId: row.postId, sortAt: read.ranking!.asOf, reposterId: null })),
  );
  const last = rows.at(-1);
  return {
    items: views.map((post) => ({ kind: "post" as const, post })),
    // Signed in, a full page may be followed by more; the cursor names the ranking and the last post read, never a position.
    nextCursor: viewer && last && rows.length === limit ? encodeExploreCursor({ g: read.ranking.generation, id: last.postId }) : null,
    computedAt: read.ranking.asOf.toISOString(),
    signInForMore: viewer === null && read.rows.length > limit,
  };
}

/**
 * Why one of the author's own posts is in Explore or not (2c design, section 8), without any count: anyone else, and a
 * post that does not exist, get not_found. The reasons are tried in the design's order, the first that applies answering;
 * the last four come from one bounded statement about this post alone, which applies every rule of the ranking as of the
 * request time (the standing of engagement included) and again as of the ranking's time. `formula` is the published one
 * unless a test ranks and judges with another.
 */
export async function exploreStatus(deps: SocialDeps, viewer: string, postId: string, formula: ExploreFormula = EXPLORE_V1): Promise<ExploreStatus> {
  const now = deps.now();
  const facts = await deps.repo.exploreFacts(postId, now, formula);
  if (!facts || facts.authorId !== viewer) throw new SocialError("not_found", 404);
  const { ranking } = facts;
  const answer = (status: ExploreStatusKind): ExploreStatus => ({ status, computedAt: ranking ? ranking.asOf.toISOString() : null });
  // Replies and quotes never enter.
  if (facts.reply) return answer("reply");
  if (facts.quote) return answer("quote");
  // Withheld, removed or deleted: out for every reader, its author too.
  if (!facts.visible) return answer("not_visible");
  if (!facts.shown) return answer("hidden_by_author");
  // A listed post stays listed until the next round, even past its window.
  if (ranking?.holdsPost) return answer("listed");
  if (facts.outsideWindow) return answer("outside_window");
  if (!ranking) return answer("no_ranking");
  if (ranking.postIsNewer) return answer("new_since_ranking");
  const judged = await deps.repo.exploreJudgement({ id: postId, authorId: facts.authorId }, now, ranking, formula);
  if (!judged.metNow) return answer("below_threshold");
  // Met now but not at the ranking's time: the next refresh considers it.
  if (!judged.metAtRanking) return answer("pending");
  // The cap keeps an author's best posts: with the author's places full, this one scored below them, and no score is needed to say so.
  if (judged.authorPlaces >= formula.perAuthor) return answer("author_cap");
  if (judged.places >= formula.listLength) return answer("below_cutoff");
  // Met at the ranking's time but left out then for a cause that has since gone, such as the switch turned back on.
  return answer("pending");
}

/**
 * "Show my posts in Explore", on or off (2c design, section 8). Off takes the account's posts out of Explore at the next
 * read; on lets the posts a round left out back in at the next round. Only the global request limit applies and no event
 * is recorded; the answer is the switch as it now stands, so turning it twice is turning it once.
 */
export async function setShowInExplore(deps: SocialDeps, viewer: string, on: boolean): Promise<ExploreSettingResponse> {
  if (!(await deps.repo.setShowInExplore(viewer, on))) throw new SocialError("not_found", 404);
  return { showInExplore: on };
}
