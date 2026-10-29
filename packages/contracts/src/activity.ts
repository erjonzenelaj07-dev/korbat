import { z } from "zod";
import { Author, PostView } from "./social";

// 2d (design, sections 5 and 9.3; Task 1): Activity, the one screen that tells a person what other people did with them,
// and the decisions korbat told them about their own content. It reads ./social for PostView and Author; nothing in the
// package reads this module. packages/db's activity_kind and activity_reach hold the two lists below as literals (that
// package does not depend on the contracts), and apps/api's activity-schema.test.ts holds them equal.

/** The four social kinds of entry, in the enum activity_kind's order (decision 2). Likes and reposts make none (decision 3). */
export const ACTIVITY_KINDS = ["reply", "mention", "quote", "follow"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * Who may reach a person with replies, mentions and quotes, in the enum activity_reach's order (decision 7): everyone;
 * accounts made at least ACTIVITY_MIN_AGE_HOURS before the act; accounts the person follows; nobody.
 */
export const ACTIVITY_REACH = ["everyone", "older", "following", "off"] as const;
export type ActivityReach = (typeof ACTIVITY_REACH)[number];

/** The two tabs of the screen (5.5.1): All, and Conversations, which keeps replies, mentions and quotes only. */
export const ACTIVITY_TABS = ["all", "conversations"] as const;
export type ActivityTab = (typeof ACTIVITY_TABS)[number];

/** "Accounts older than 2 days": the age korbat's write limits and Explore already use, a rule and never a reputation. */
export const ACTIVITY_MIN_AGE_HOURS = 48;
/** An entry is deleted this many days after it was written (decision 11); moderation entries older than it are not listed. */
export const ACTIVITY_KEEP_DAYS = 90;
/** Entries a page of GET /api/activity holds. */
export const ACTIVITY_PAGE_SIZE = 30;
/** Where GET /api/activity/newer stops counting: the pill reads "20+ new" from here (5.8). */
export const ACTIVITY_NEWER_CAP = 21;

/**
 * A time of Activity: UTC, to the microsecond, as the database keeps activity_items.created_at (now(), written by the
 * database and never by the API's clock). An entry's `at`, the page's `seenAt`, the newer count's `since` and the seen
 * marker's `at` all have this form, so the marker the app sends back is exactly the newest entry's time: a millisecond
 * form would fall short of an entry written in the same millisecond, which would then stay new for ever (5.7).
 */
export const ActivityTime = z.iso.datetime({ precision: 6 });
export type ActivityTime = z.infer<typeof ActivityTime>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DAY = "[0-9]{4}-[0-9]{2}-[0-9]{2}";
/**
 * An entry's key, the cursor's tie-breaker, distinct across sources by its prefix (5.5): `e:` an activity_items row's id
 * (a reply, a mention or a quote), `f:` a UTC day of follows, and the moderation sources `d:` a decision's id, `r:` a
 * release's, `u:` a refused upload's, `l:` a lost image's. Ids are lower case, as PostgreSQL writes them.
 */
const ACTIVITY_KEY = new RegExp(`^(?:[edrul]:${UUID}|f:${DAY})$`);
const MODERATION_PREFIX = { decision: "d", release: "r", upload: "u", lost: "l" } as const;

/** Whether a YYYY-MM-DD day and an HH:MM:SS time name a real instant: no 30th of February, no 25th hour. */
function realInstant(day: string, time: string = "00:00:00"): boolean {
  const at = `${day}T${time}`;
  const parsed = new Date(`${at}.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === at;
}

/** The fields every entry carries: its time, its key and whether it is later than the seen marker the page answered. */
const entryFields = { at: ActivityTime, new: z.boolean() };

/** A reply to the recipient's post, a mention of the recipient, or a quote of the recipient's post, with the post's view. */
const PostEntry = z.object({
  type: z.literal("post"),
  kind: z.enum(["reply", "mention", "quote"]),
  key: z.string().regex(new RegExp(`^e:${UUID}$`)),
  ...entryFields,
  post: PostView,
});

/**
 * The follows of one UTC day (decision 6): the day's key, the newest follow's time (in that day), how many distinct
 * accounts followed, and the newest three of them.
 */
const FollowsEntry = z
  .object({
    type: z.literal("follows"),
    key: z.string().regex(new RegExp(`^f:${DAY}$`)),
    ...entryFields,
    count: z.number().int().min(1),
    actors: z.array(Author).min(1).max(3),
  })
  .refine((entry) => realInstant(entry.key.slice(2)) && entry.at.slice(0, 10) === entry.key.slice(2), { message: "a group's newest follow is in its day", path: ["key"] })
  .refine((entry) => entry.actors.length <= entry.count, { message: "a group names no more accounts than it counts", path: ["actors"] });

/**
 * A notice korbat told the recipient about their own content or account (5.5.2): a decision told to its author, a
 * release of sealed images, a refused upload, a lost image. `id` is what its screen needs (the decision's, the release's,
 * the refusal's or the image's), and the key is its kind's prefix over that id. `postId` and `postCreatedAt` name the
 * post when the target is a post, and are null otherwise.
 */
const ModerationEntry = z
  .object({
    type: z.literal("moderation"),
    kind: z.enum(["decision", "release", "upload", "lost"]),
    key: z.string().regex(ACTIVITY_KEY),
    ...entryFields,
    target: z.enum(["post", "profile", "account"]),
    id: z.uuid(),
    postId: z.uuid().nullable(),
    postCreatedAt: z.iso.datetime().nullable(),
  })
  .refine((entry) => entry.key === `${MODERATION_PREFIX[entry.kind]}:${entry.id}`, { message: "a notice's key is its kind's prefix over its id", path: ["key"] })
  .refine((entry) => (entry.target === "post") === (entry.postId !== null) && (entry.postId === null) === (entry.postCreatedAt === null), {
    message: "a notice about a post names the post and its time, and no other does",
    path: ["postId"],
  });

/** One entry of the list, by its `type`. */
export const ActivityEntry = z.discriminatedUnion("type", [PostEntry, FollowsEntry, ModerationEntry]);
export type ActivityEntry = z.infer<typeof ActivityEntry>;

/** Where a page of Activity starts: after the entry with this time and key, newest first. */
export interface ActivityPlace {
  at: string;
  key: string;
}

/** The cursor as it travels: an opaque word, as the moderation lists' cursors are. */
const ActivityCursorWord = z.string().regex(/^[A-Za-z0-9_-]{1,400}$/);

/**
 * The page cursor of Activity: the last entry's time as its twenty digits (YYYYMMDDHHMMSS and the six of the
 * microseconds), then `_`, the key's prefix letter, `_` and the rest of the key. Every character is of the cursor word,
 * nothing needs Buffer or base64 (the contracts load in the web app too), and the time keeps the database's microseconds.
 */
export function encodeActivityCursor(place: ActivityPlace): string {
  if (!ActivityTime.safeParse(place.at).success || !ACTIVITY_KEY.test(place.key)) throw new TypeError("not a place in Activity");
  if (place.key.startsWith("f:") && !realInstant(place.key.slice(2))) throw new TypeError("not a place in Activity");
  const digits = place.at.replace(/[^0-9]/g, "");
  return `${digits}_${place.key.slice(0, 1)}_${place.key.slice(2)}`;
}

const CURSOR = /^([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{6})_([a-z])_([0-9a-f-]+)$/;

/** Reads a cursor back; anything encodeActivityCursor did not write is null, never guessed at (the API answers it invalid_request). */
export function decodeActivityCursor(cursor: string): ActivityPlace | null {
  const parts = CURSOR.exec(cursor);
  if (parts === null) return null;
  const [, year, month, day, hour, minute, second, micros, prefix, rest] = parts;
  if (!realInstant(`${year}-${month}-${day}`, `${hour}:${minute}:${second}`)) return null;
  const place = { at: `${year}-${month}-${day}T${hour}:${minute}:${second}.${micros}Z`, key: `${prefix}:${rest}` };
  if (!ActivityTime.safeParse(place.at).success || !ACTIVITY_KEY.test(place.key)) return null;
  if (place.key.startsWith("f:") && !realInstant(place.key.slice(2))) return null;
  // The one word this place encodes to: so a cursor is read only in the spelling this module writes.
  return encodeActivityCursor(place) === cursor ? place : null;
}

/** GET /api/activity: one page, newest first, the cursor of the next, and the seen marker as stored when asked (null before the first visit). */
export const ActivityPage = z.object({
  items: z.array(ActivityEntry).max(ACTIVITY_PAGE_SIZE),
  nextCursor: ActivityCursorWord.nullable(),
  seenAt: ActivityTime.nullable(),
});
export type ActivityPage = z.infer<typeof ActivityPage>;

/** GET /api/activity?tab=&cursor=. */
export const ActivityQuery = z.object({
  tab: z.enum(ACTIVITY_TABS).default("all"),
  cursor: ActivityCursorWord.optional(),
});
export type ActivityQuery = z.infer<typeof ActivityQuery>;

/**
 * GET /api/activity/newer?tab=&since= (5.8): `since` is the newest entry's time the screen shows; absent while it shows
 * none, when every entry counts.
 */
export const ActivityNewerQuery = z.object({
  tab: z.enum(ACTIVITY_TABS).default("all"),
  since: ActivityTime.optional(),
});
export type ActivityNewerQuery = z.infer<typeof ActivityNewerQuery>;

/** Its answer: how many entries are newer, under the list's own rules, counted up to ACTIVITY_NEWER_CAP. */
export const ActivityNewerResponse = z.object({ count: z.number().int().min(0).max(ACTIVITY_NEWER_CAP) });
export type ActivityNewerResponse = z.infer<typeof ActivityNewerResponse>;

/** POST /api/activity/seen: the first page's newest `at`; the server keeps the later of it and the stored marker, never past its clock. */
export const SeenRequest = z.object({ at: ActivityTime });
export type SeenRequest = z.infer<typeof SeenRequest>;

/** GET and PUT /api/activity/settings (5.2, decision 7): one reach each for replies, mentions and quotes, and the follow switch. */
export const ActivitySettings = z.object({
  replies: z.enum(ACTIVITY_REACH),
  mentions: z.enum(ACTIVITY_REACH),
  quotes: z.enum(ACTIVITY_REACH),
  follows: z.boolean(),
});
export type ActivitySettings = z.infer<typeof ActivitySettings>;

/** What an account without an activity_state row reads, and the table's column defaults: Everyone and On. */
export const ACTIVITY_DEFAULTS: Readonly<ActivitySettings> = Object.freeze({ replies: "everyone", mentions: "everyone", quotes: "everyone", follows: true });
