import { buildZip, fakeImage, type ZipItem } from "./zip";
import { CANARY } from "./canaries";

/**
 * An X archive built by code (3b design, section 12.1): data/manifest.js, tweets.js in the current and the 2019
 * element shape, tweets-part1.js, note-tweet.js, twitter-circle-tweet.js, protected-history.js with one protected
 * period, media files, and the canaries in the files korbat never opens. Its posts cover every row of 5.5's table. The
 * names of X's files come from open-source parsers (3.6), so this fixture is the contract the adapter is tested against.
 */

export const X_ACCOUNT_ID = "4000000001";
const OTHER_ACCOUNT_ID = "4000000999";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/** X's created_at, as "Wed Oct 10 20:19:24 +0000 2018", for an ISO time in UTC. */
export function xDate(iso: string): string {
  const d = new Date(iso);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
}

/** The text X writes before a data file's JSON. */
const prefix = (name: string, part = 0) => `window.YTD.${name}.part${part} = `;
export const dataFile = (name: string, elements: readonly unknown[], part = 0) => prefix(name, part) + JSON.stringify(elements, null, 2);

export interface TweetSpec {
  id: string;
  at: string;
  text: string;
  urls?: { url: string; expanded: string }[];
  media?: { url: string; file: string; type?: "photo" | "video" | "animated_gif" }[];
  replyTo?: { status: string; user: string };
  displayStart?: number;
  sensitive?: boolean;
  editIds?: string[];
  /** The 2019 element shape: the tweet object itself, not under "tweet". */
  bare?: boolean;
}

export function tweetObject(spec: TweetSpec): Record<string, unknown> {
  const media = (spec.media ?? []).map((m, index) => ({
    id_str: `${spec.id}${index}`,
    media_url_https: `https://pbs.twimg.com/media/${m.file}`,
    url: m.url,
    expanded_url: `https://twitter.com/${CANARY.handle}/status/${spec.id}/photo/${index + 1}`,
    type: m.type ?? "photo",
  }));
  const textLength = Array.from(spec.text).length;
  const tweet: Record<string, unknown> = {
    edit_info: { initial: { editTweetIds: spec.editIds ?? [spec.id], editableUntil: "2020-01-01T00:00:00.000Z", editsRemaining: "5", isEditEligible: true } },
    retweeted: false,
    source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
    entities: {
      hashtags: [],
      symbols: [],
      user_mentions: [],
      urls: (spec.urls ?? []).map((u) => ({ url: u.url, expanded_url: u.expanded, display_url: u.expanded.replace(/^https?:[/][/]/, ""), indices: ["0", "23"] })),
      ...(media.length > 0 ? { media: media.slice(0, 1) } : {}),
    },
    display_text_range: [String(spec.displayStart ?? 0), String(textLength)],
    favorite_count: "0",
    id_str: spec.id,
    truncated: false,
    retweet_count: "0",
    id: spec.id,
    possibly_sensitive: spec.sensitive ?? false,
    created_at: xDate(spec.at),
    favorited: false,
    full_text: spec.text,
    lang: "en",
    ...(spec.replyTo ? { in_reply_to_status_id_str: spec.replyTo.status, in_reply_to_status_id: spec.replyTo.status, in_reply_to_user_id_str: spec.replyTo.user, in_reply_to_user_id: spec.replyTo.user, in_reply_to_screen_name: "someone" } : {}),
    ...(media.length > 0 ? { extended_entities: { media } } : {}),
  };
  return spec.bare === true ? tweet : { tweet };
}

/** Every case of 5.5's table, by a name the tests use; each kept one has a text no other has. */
export const X_TWEETS = {
  plain: { id: "1100000000000000001", at: "2019-03-03T10:00:00Z", text: "Plain post with a link https://t.co/aaa111 and &amp; &lt;b&gt; escapes", urls: [{ url: "https://t.co/aaa111", expanded: "https://example.com/page" }] },
  repost: { id: "1100000000000000002", at: "2019-03-04T10:00:00Z", text: "RT @someone: their words, not mine" },
  circle: { id: "1100000000000000003", at: "2019-03-05T10:00:00Z", text: `Circle only ${CANARY.private}` },
  editOld: { id: "1100000000000000004", at: "2019-03-06T10:00:00Z", text: "First version of an edited post", editIds: ["1100000000000000004", "1100000000000000005"] },
  editNew: { id: "1100000000000000005", at: "2019-03-06T10:05:00Z", text: "Second version of an edited post", editIds: ["1100000000000000004", "1100000000000000005"] },
  thread: { id: "1100000000000000006", at: "2019-03-07T10:00:00Z", text: "A reply to my own plain post", replyTo: { status: "1100000000000000001", user: X_ACCOUNT_ID } },
  reply: { id: "1100000000000000007", at: "2019-03-08T10:00:00Z", text: "@someone @another Answering someone else", displayStart: 18, replyTo: { status: "1100000000000000900", user: OTHER_ACCOUNT_ID } },
  selfQuote: {
    id: "1100000000000000008",
    at: "2019-03-09T10:00:00Z",
    text: "Quoting myself https://t.co/qqq222",
    urls: [{ url: "https://t.co/qqq222", expanded: `https://twitter.com/${CANARY.handle}/status/1100000000000000001` }],
  },
  profileLink: { id: "1100000000000000009", at: "2019-03-10T10:00:00Z", text: "Find me at https://t.co/ppp333", urls: [{ url: "https://t.co/ppp333", expanded: `https://x.com/${CANARY.handle}` }] },
  long: { id: "1100000000000000010", at: "2023-05-01T08:30:15Z", text: "This is the start of a long note that X cut short in the tweet's own text and keeps whole in the note file, so the importer has to join the two again before it writes the post down for the preview and the" + String.fromCharCode(0x2026) + " https://t.co/lll444" },
  sensitive: { id: "1100000000000000011", at: "2019-03-12T10:00:00Z", text: "A sensitive photo post https://t.co/sss555", sensitive: true, media: [{ url: "https://t.co/sss555", file: "Fsens001.jpg" }] },
  photo: { id: "1100000000000000012", at: "2019-03-13T10:00:00Z", text: "A photo post https://t.co/ppp666", media: [{ url: "https://t.co/ppp666", file: "Fphoto01.jpg" }] },
  video: { id: "1100000000000000013", at: "2019-03-14T10:00:00Z", text: "A video post https://t.co/vvv777", media: [{ url: "https://t.co/vvv777", file: "Fvideo01.jpg", type: "video" }] },
  gif: { id: "1100000000000000014", at: "2019-03-15T10:00:00Z", text: "An animated post https://t.co/ggg888", media: [{ url: "https://t.co/ggg888", file: "Fgif0001.jpg", type: "animated_gif" }] },
  protectedPost: { id: "1100000000000000015", at: "2020-06-15T10:00:00Z", text: "Written while my account was protected" },
  bare2019: { id: "1100000000000000016", at: "2019-03-16T10:00:00Z", text: "A post in the 2019 element shape", bare: true },
  stray: { id: "1100000000000000017", at: "2019-03-17T10:00:00Z", text: "A stray t.co link https://t.co/zzz999 goes away" },
  tooOld: { id: "1100000000000000018", at: "2005-01-01T10:00:00Z", text: "A date before the first tweet" },
  missing: { id: "1100000000000000019", at: "2019-03-18T10:00:00Z", text: "A photo whose file is missing https://t.co/mmm000", media: [{ url: "https://t.co/mmm000", file: "Fmiss001.jpg" }] },
  onlyMedia: { id: "1100000000000000020", at: "2019-03-19T10:00:00Z", text: "https://t.co/ooo123", media: [{ url: "https://t.co/ooo123", file: "Fonly001.jpg" }] },
  inPart1: { id: "1100000000000000021", at: "2019-03-20T10:00:00Z", text: "A post from tweets-part1.js" },
  future: { id: "1100000000000000022", at: "2026-10-22T12:00:01Z", text: "A date more than a day after the import" },
} satisfies Record<string, TweetSpec>;

/** The note's whole text, which replaces the long tweet's. */
export const X_NOTE_TEXT =
  "This is the start of a long note that X cut short in the tweet's own text and keeps whole in the note file, so the importer has to join the two again before it writes the post down for the preview and the person, who sees all of it.";

export interface XArchiveOptions {
  /** Media files in the archive (they are allowlisted only while images are on). */
  media?: boolean;
  /** archiveInfo.isPartialArchive. */
  partial?: boolean;
  /** A manifest without dataTypes: the fixed names are tried. */
  noFileList?: boolean;
  /** Leave the manifest out. */
  noManifest?: boolean;
  /** A manifest bigger than 1 MiB. */
  hugeManifest?: boolean;
  /** The 2018 archive: data/tweet.js only. */
  legacy?: boolean;
  /** Extra entries, e.g. crafted names. */
  extra?: ZipItem[];
  /** Tweets to write instead of the fixture's. */
  tweets?: TweetSpec[];
  /** The manifest's raw text, instead of the generated one. */
  manifestText?: string;
  /** data/tweets.js's raw text, instead of the generated one. */
  tweetsText?: string;
}

export function xManifest(options: XArchiveOptions = {}, tweetsFiles: string[] = ["data/tweets.js", "data/tweets-part1.js"]): string {
  const manifest = {
    userInfo: { accountId: X_ACCOUNT_ID, userName: CANARY.handle, displayName: CANARY.name },
    archiveInfo: { sizeBytes: "123456", generationDate: "2026-10-01T00:00:00.000Z", isPartialArchive: options.partial === true, maxPartSizeBytes: "53687091200" },
    readmeInfo: { fileName: "data/README.txt", directory: "data/", name: "README" },
    ...(options.noFileList === true
      ? {}
      : {
          dataTypes: {
            tweets: { files: tweetsFiles.map((fileName, index) => ({ fileName, globalName: `YTD.tweets.part${index}`, count: "1" })) },
            noteTweet: { files: [{ fileName: "data/note-tweet.js", globalName: "YTD.note_tweet.part0", count: "1" }] },
            twitterCircleTweet: { files: [{ fileName: "data/twitter-circle-tweet.js", globalName: "YTD.twitter_circle_tweet.part0", count: "1" }] },
            directMessages: { files: [{ fileName: "data/direct-messages.js", globalName: "YTD.direct_messages.part0", count: "1" }] },
            // A file name outside the allowlist, even under a data type the adapter reads, is never opened.
            account: { files: [{ fileName: "data/account.js", globalName: "YTD.account.part0", count: "1" }] },
          },
        }),
    ...(options.hugeManifest === true ? { padding: "x".repeat(1_100_000) } : {}),
  };
  return "window.__THAR_CONFIG = " + JSON.stringify(manifest, null, 2);
}

/** The archive, and the entries every X archive holds beside its posts: the canaries. */
export function buildXArchive(options: XArchiveOptions = {}): Buffer {
  const all = options.tweets ?? Object.values(X_TWEETS);
  const part1 = options.tweets ? [] : [X_TWEETS.inPart1];
  const main = options.tweets ? all : all.filter((tweet) => tweet !== X_TWEETS.inPart1 && tweet !== X_TWEETS.protectedPost);
  const items: ZipItem[] = [];
  if (options.noManifest !== true) {
    items.push({ name: "data/manifest.js", data: options.manifestText ?? xManifest(options, options.legacy === true ? ["data/tweet.js"] : ["data/tweets.js", "data/tweets-part1.js"]) });
  }
  if (options.legacy === true) {
    items.push({ name: "data/tweet.js", data: dataFile("tweet", main.map(tweetObject)) });
  } else {
    // The protected tweet is written in the current shape after the rest, so the file mixes both shapes.
    const elements = [...main.map(tweetObject), ...(options.tweets ? [] : [tweetObject(X_TWEETS.protectedPost)])];
    items.push({ name: "data/tweets.js", data: options.tweetsText ?? dataFile("tweets", elements) });
    if (part1.length > 0) items.push({ name: "data/tweets-part1.js", data: dataFile("tweets", part1.map(tweetObject), 1) });
  }
  items.push({
    name: "data/note-tweet.js",
    data: dataFile("note_tweet", [
      { noteTweet: { noteTweetId: "77001", updatedAt: "2023-05-01T08:30:15.000Z", lifecycle: { value: "live" }, createdAt: "2023-05-01T08:30:15.000Z", core: { styletags: [], urls: [], text: X_NOTE_TEXT, mentions: [], cashtags: [], hashtags: [] } } },
      // A note no tweet matches: ignored.
      { noteTweet: { noteTweetId: "77002", updatedAt: "2023-06-01T00:00:00.000Z", lifecycle: { value: "live" }, createdAt: "2023-06-01T00:00:00.000Z", core: { styletags: [], urls: [], text: "An unmatched note", mentions: [], cashtags: [], hashtags: [] } } },
    ]),
  });
  items.push({ name: "data/twitter-circle-tweet.js", data: dataFile("twitter_circle_tweet", [tweetObject(X_TWEETS.circle)]) });
  items.push({
    name: "data/protected-history.js",
    data: dataFile("protected_history", [
      { protectedHistory: { protectedAt: "2020-06-01T00:00:00.000Z", action: "Protect" } },
      { protectedHistory: { protectedAt: "2020-07-01T00:00:00.000Z", action: "Unprotect" } },
    ]),
  });
  if (options.media !== false) {
    items.push({ name: "data/tweets_media/1100000000000000011-Fsens001.jpg", data: fakeImage("jpg", 1_000, 11), method: 0 });
    items.push({ name: "data/tweets_media/1100000000000000012-Fphoto01.jpg", data: fakeImage("jpg", 1_500, 12), method: 0 });
    items.push({ name: "data/tweets_media/1100000000000000020-Fonly001.jpg", data: fakeImage("png", 1_200, 20), method: 0 });
    // Media of a direct message: a canary in a folder the allowlist never names.
    items.push({ name: "data/direct_messages_media/900-Fdm00001.jpg", data: Buffer.concat([fakeImage("jpg", 200, 9), Buffer.from(CANARY.dm)]), method: 0 });
  }
  // The files korbat never opens, each with its canary.
  items.push({ name: "data/direct-messages.js", data: dataFile("direct_messages", [{ dmConversation: { conversationId: "1-2", messages: [{ messageCreate: { text: `${CANARY.dm} a private message`, senderId: X_ACCOUNT_ID } }] } }]) });
  items.push({ name: "data/ip-audit.js", data: dataFile("ip_audit", [{ ipAudit: { accountId: X_ACCOUNT_ID, createdAt: "2019-01-01T00:00:00.000Z", loginIp: `${CANARY.ip} 192.0.2.1` } }]) });
  items.push({ name: "data/like.js", data: dataFile("like", [{ like: { tweetId: "1", fullText: `${CANARY.like} someone's post` } }]) });
  items.push({ name: "data/deleted-tweets.js", data: dataFile("deleted_tweets", [tweetObject({ id: "1100000000000000099", at: "2019-04-01T10:00:00Z", text: `${CANARY.deleted} a deleted post` })]) });
  items.push({ name: "data/account.js", data: dataFile("account", [{ account: { email: "person@example.com", username: CANARY.handle, accountDisplayName: CANARY.name, accountId: X_ACCOUNT_ID } }]) });
  items.push({ name: "data/README.txt", data: "Your archive" });
  items.push(...(options.extra ?? []));
  return buildZip(items);
}
