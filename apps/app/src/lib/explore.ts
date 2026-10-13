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
