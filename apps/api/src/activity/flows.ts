import {
  ACTIVITY_NEWER_CAP,
  ACTIVITY_PAGE_SIZE,
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityEntry,
  type ActivityKind,
  type ActivityNewerQuery,
  type ActivityNewerResponse,
  type ActivityNotShown,
  type ActivityPage,
  type ActivityPlace,
  type ActivityQuery,
  type ActivitySettings,
} from "@korbat/contracts";
import type { Logger } from "pino";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { ModerationActivityEntry, ModerationForActivity } from "../moderation";
import { enforceWriteLimit, type EngagementAction, type SocialForActivity } from "../social";
import type { ActivityRepo, ReceivedRow } from "./repo";

/** The codes this module raises itself; the social module's limits raise rate_limited and service_unavailable. */
export type ActivityErrorKind = "invalid_request";

/** An expected, user-facing failure, which the app's error handler renders as an ErrorEnvelope. */
export class ActivityError extends Error {
  constructor(
    readonly code: ActivityErrorKind,
    readonly status: 400,
    message = "Some details are missing or invalid.",
  ) {
    super(message);
    this.name = "ActivityError";
  }
}

export interface ActivityDeps {
  repo: ActivityRepo;
  /** The social module's interface: the views of an entry's post and of a follow group's accounts. */
  social: SocialForActivity;
  /** The moderation module's interface: the entries of 5.5.2. Without it the list holds the social entries only. */
  moderation?: ModerationForActivity;
  /** The store every per-account limit counts in, through the social module's enforceWriteLimit. */
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
  /** Entries a page holds: ACTIVITY_PAGE_SIZE, which a test may lower to page through few entries. */
  pageSize: number;
}

/** A place in the list: an entry's time and key. Keys compare code unit by code unit, as the repository's "C" collation does. */
type Placed = { at: string; key: string };

/** Newest first: the later time, then the higher key. Times are ISO text to the microsecond, which sorts as it reads. */
const newestFirst = (a: Placed, b: Placed): number => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.key < b.key ? 1 : a.key > b.key ? -1 : 0);

/**
 * Counts one write of the account under its bucket (9.5). These limits do not depend on the account's age (tiers.ts), so
 * the account's creation time is not read: the clock's time stands in for it.
 */
async function limit(deps: ActivityDeps, viewer: string, action: EngagementAction): Promise<void> {
  const now = deps.now();
  await enforceWriteLimit(deps.limits, viewer, action, now, now);
}

/** A row of the merged list before its view: a social row of the repository or a moderation entry. */
type Merged = ({ source: "social" } & Awaited<ReturnType<ActivityRepo["list"]>>[number]) | ({ source: "moderation" } & ModerationActivityEntry);

/**
 * GET /api/activity (5.5): one page for the signed-in account, newest first by (at, key). The stored seen marker is read
 * first, as the request finds it. The social rows (5.5.1) and, on the tab All, the moderation entries (5.5.2) are each
 * asked for one more than a page before the cursor; their union is sorted by (at, key), the page is the first
 * ACTIVITY_PAGE_SIZE, and the next cursor is made from its last row when the union held more. Then the views: each post
 * entry's PostView through the social module (loadPostViews, so postAccess decides), each follow group's Authors; an entry
 * whose view does not come back, which only a race between the query and the views can cause, is dropped from the page
 * (the cursor still stands after it). Each entry is `new` when its time is later than the stored marker.
 */
export async function activityPage(deps: ActivityDeps, viewer: string, query: ActivityQuery): Promise<ActivityPage> {
  const place: ActivityPlace | null = query.cursor === undefined ? null : decodeActivityCursor(query.cursor);
  if (query.cursor !== undefined && place === null) throw new ActivityError("invalid_request", 400, "That page of Activity does not exist.");
  const seenAt = await deps.repo.seenAt(viewer);
  const wanted = deps.pageSize + 1;
  const [social, moderation] = await Promise.all([
    deps.repo.list(viewer, query.tab, place, wanted),
    query.tab === "all" && deps.moderation ? deps.moderation.authorActivity(viewer, place, wanted) : Promise.resolve([]),
  ]);
  const merged: Merged[] = [...social.map((row) => ({ source: "social" as const, ...row })), ...moderation.map((row) => ({ source: "moderation" as const, ...row }))].sort(newestFirst);
  const page = merged.slice(0, deps.pageSize);
  const last = page.at(-1);
  const nextCursor = merged.length > deps.pageSize && last ? encodeActivityCursor({ at: last.at, key: last.key }) : null;

  const postIds = page.flatMap((row) => (row.source === "social" && row.type === "post" ? [row.postId] : []));
  const actorIds = [...new Set(page.flatMap((row) => (row.source === "social" && row.type === "follows" ? row.actorIds : [])))];
  const [views, authors] = await Promise.all([postIds.length > 0 ? deps.social.postViews(viewer, postIds) : new Map(), actorIds.length > 0 ? deps.social.authors(actorIds) : new Map()]);
  const isNew = (at: string) => seenAt === null || at > seenAt;
  const items: ActivityEntry[] = page.flatMap((row): ActivityEntry[] => {
    if (row.source === "moderation") {
      const { source: _source, ...entry } = row;
      return [{ ...entry, new: isNew(row.at) }];
    }
    if (row.type === "post") {
      const post = views.get(row.postId);
      return post ? [{ type: "post", kind: row.kind, key: row.key, at: row.at, new: isNew(row.at), post }] : [];
    }
    const actors = row.actorIds.flatMap((id) => (authors.has(id) ? [authors.get(id)!] : []));
    return actors.length > 0 ? [{ type: "follows", key: row.key, at: row.at, new: isNew(row.at), count: row.count, actors }] : [];
  });
  return { items, nextCursor, seenAt };
}

/**
 * GET /api/activity/newer (5.8): how many entries are newer than `since` (every entry without it), under the list's own
 * rules and counted as the list draws them (a day of follows is one), up to ACTIVITY_NEWER_CAP. On the tab All the
 * moderation entries count too, asked for the newest ACTIVITY_NEWER_CAP. No route counts unread entries for anything
 * else (decision 4): this one is asked only by the open Activity screen, about times it already shows.
 */
export async function newerCount(deps: ActivityDeps, viewer: string, query: ActivityNewerQuery): Promise<ActivityNewerResponse> {
  const since = query.since ?? null;
  const [social, moderation] = await Promise.all([
    deps.repo.newer(viewer, query.tab, since, ACTIVITY_NEWER_CAP),
    query.tab === "all" && deps.moderation ? deps.moderation.authorActivity(viewer, null, ACTIVITY_NEWER_CAP) : Promise.resolve([]),
  ]);
  const newerModeration = moderation.filter((entry) => since === null || entry.at > since).length;
  return { count: Math.min(ACTIVITY_NEWER_CAP, social + newerModeration) };
}

/** POST /api/activity/seen (5.7): counted under activity-seen, then the marker moves forward, never past the clock. */
export async function markSeen(deps: ActivityDeps, viewer: string, at: string): Promise<void> {
  await limit(deps, viewer, "activity-seen");
  await deps.repo.markSeen(viewer, at);
}

/** GET /api/activity/settings: the account's rules, the defaults when it never changed them. */
export async function readSettings(deps: ActivityDeps, viewer: string): Promise<ActivitySettings> {
  return deps.repo.settings(viewer);
}

/** PUT /api/activity/settings (5.2): counted under activity-settings, then stored; they apply to new acts only. */
export async function saveSettings(deps: ActivityDeps, viewer: string, settings: ActivitySettings): Promise<ActivitySettings> {
  await limit(deps, viewer, "activity-settings");
  return deps.repo.saveSettings(viewer, settings);
}

/** One received entry as the export writes it (11.2). */
export interface ReceivedEntry {
  kind: ActivityKind;
  at: string;
  postId: string | null;
  actorHandle: string;
  shown: true | ActivityNotShown;
}

/** The account's Activity as the export holds it: the marker, the rules, and every entry it received, read in pages. */
export interface ActivityExport {
  seenAt: string | null;
  settings: ActivitySettings;
  received: AsyncIterable<ReceivedEntry[]>;
}

/**
 * Why the list does not show a received entry, or true (11.2). When several rules hide it, the first of these wins: the
 * actor's account is deleted (`actor_deleted`); for an entry about a post, the post is not visible or a block stands
 * between the two accounts either way (`post_not_visible`: the post is then hidden from this account, so a row hidden only
 * by a block, which a mention can leave behind in 5.6's race, says that and names no post); for a follow, the follow is
 * gone (`unfollowed`; a block removes it); then the account's own mute (`muted`). A post the account may not see is
 * named by no id, whatever reason wins, so the export never discloses another person's moderation.
 */
export function receivedEntry(row: ReceivedRow): ReceivedEntry {
  const aboutPost = row.postId !== null;
  const postHidden = aboutPost && (!row.postVisible || row.blocked);
  const shown: true | ActivityNotShown = row.actorDeleted
    ? "actor_deleted"
    : postHidden
      ? "post_not_visible"
      : !aboutPost && (!row.followStands || row.blocked)
        ? "unfollowed"
        : row.muted
          ? "muted"
          : true;
  return { kind: row.kind, at: row.at, postId: postHidden ? null : row.postId, actorHandle: row.actorHandle, shown };
}

/**
 * The export's member (11.2): the marker and the rules read at once, and every received entry newest first, ungrouped,
 * read in keyset pages of `pageSize` as the export writes them, so a long list is never whole in memory.
 */
export async function exportEntries(deps: ActivityDeps, userId: string, pageSize: number): Promise<ActivityExport> {
  const [seenAt, settings] = await Promise.all([deps.repo.seenAt(userId), deps.repo.settings(userId)]);
  return {
    seenAt,
    settings,
    received: {
      async *[Symbol.asyncIterator]() {
        let after: { at: string; id: string } | null = null;
        for (;;) {
          const rows: ReceivedRow[] = await deps.repo.received(userId, after, pageSize);
          if (rows.length > 0) yield rows.map(receivedEntry);
          if (rows.length < pageSize) return;
          const last = rows.at(-1)!;
          after = { at: last.at, id: last.id };
        }
      },
    },
  };
}

/** Entries a page of Activity holds unless a test says otherwise. */
export const DEFAULT_PAGE_SIZE = ACTIVITY_PAGE_SIZE;
