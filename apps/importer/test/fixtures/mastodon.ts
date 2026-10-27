import { buildZip, fakeImage, type ZipItem } from "./zip";
import { CANARY, FIXTURE_HOST } from "./canaries";

/**
 * A Mastodon archive built by code (3b design, section 12.1): outbox.json with public, unlisted, private, direct and
 * limited Notes, an Announce embedding a Note, a Question, a quote with its quote-inline paragraph, a content warning,
 * sensitive media, a thread, a reply to another server beginning with two mention links, links to the person's own
 * statuses and profile, and media paths with and without a leading slash; the canaries in the private and direct
 * Notes, in likes.json and in actor.json.
 */

export const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
export const ACTOR = `https://${FIXTURE_HOST}/users/${CANARY.handle}`;
const FOLLOWERS = `${ACTOR}/followers`;
export const statusId = (n: number) => `${ACTOR}/statuses/1090000000000000${String(n).padStart(2, "0")}`;
export const mediaPath = (n: number, ext = "jpg") => `media_attachments/files/109/000/000/000/000/0${String(n).padStart(2, "0")}/original/${n.toString(16).padStart(16, "0")}.${ext}`;

const SPACE = " ";
const invisible = (text: string) => `<span class="invisible">${text}</span>`;
/** A link as Mastodon writes it: the scheme and the tail in invisible spans, the middle in an ellipsis span. */
export const masLink = (href: string) => {
  const rest = href.replace(/^https:[/][/]/, "");
  return `<a href="${href}" target="_blank" rel="nofollow noopener noreferrer" translate="no">${invisible("https://")}<span class="ellipsis">${rest.slice(0, 20)}</span>${invisible(rest.slice(20))}</a>`;
};
const mention = (href: string, name: string) => `<span class="h-card" translate="no"><a href="${href}" class="u-url mention">@<span>${name}</span></a></span>`;

export interface NoteSpec {
  n: number;
  at: string;
  content: string;
  to?: string[];
  cc?: string[];
  type?: "Note" | "Question";
  summary?: string;
  sensitive?: boolean;
  inReplyTo?: string | null;
  attachment?: { mediaType: string; url: string; name?: string | null }[];
  quote?: string;
}

const publicTo = { to: [PUBLIC], cc: [FOLLOWERS] };

export function createActivity(spec: NoteSpec): Record<string, unknown> {
  const to = spec.to ?? publicTo.to;
  const cc = spec.cc ?? publicTo.cc;
  return {
    id: `${statusId(spec.n)}/activity`,
    type: "Create",
    actor: ACTOR,
    published: spec.at,
    to,
    cc,
    object: {
      id: statusId(spec.n),
      type: spec.type ?? "Note",
      summary: spec.summary ?? null,
      inReplyTo: spec.inReplyTo ?? null,
      published: spec.at,
      url: `https://${FIXTURE_HOST}/@${CANARY.handle}/1090000000000000${String(spec.n).padStart(2, "0")}`,
      attributedTo: ACTOR,
      to,
      cc,
      sensitive: spec.sensitive ?? false,
      atomUri: statusId(spec.n),
      conversation: `tag:${FIXTURE_HOST},2019-03-03:objectId=${spec.n}:objectType=Conversation`,
      content: spec.content,
      contentMap: { en: spec.content },
      attachment: (spec.attachment ?? []).map((a) => ({ type: "Document", mediaType: a.mediaType, url: a.url, name: a.name ?? null, blurhash: "U00000fQfQfQfQfQfQfQfQfQfQfQ", width: 400, height: 300 })),
      tag: [],
      replies: { id: `${statusId(spec.n)}/replies`, type: "Collection" },
      ...(spec.quote !== undefined ? { quote: spec.quote, quoteUri: spec.quote, _misskey_quote: spec.quote } : {}),
      ...(spec.type === "Question" ? { oneOf: [{ type: "Note", name: "Yes", replies: { type: "Collection", totalItems: 1 } }] } : {}),
    },
  };
}

/** A description longer than korbat's 1,000 characters (Mastodon allows 1,500). */
export const LONG_DESCRIPTION = "A long description. ".repeat(60);

export const MASTODON_NOTES = {
  public: { n: 1, at: "2019-03-03T10:00:00Z", content: "<p>Hello from Mastodon &amp; friends &#8212; with &#x27;quotes&#39;</p><p>Second paragraph<br>with a line break</p>" },
  unlisted: { n: 2, at: "2019-03-04T10:00:00.000Z", content: "<p>An unlisted post</p>", to: [FOLLOWERS], cc: [PUBLIC] },
  private: { n: 3, at: "2019-03-05T10:00:00Z", content: `<p>${CANARY.private} for followers only</p>`, to: [FOLLOWERS], cc: [] },
  direct: { n: 4, at: "2019-03-06T10:00:00Z", content: `<p>${CANARY.dm} a direct message</p>`, to: ["https://other.example/users/bob"], cc: [] },
  limited: { n: 5, at: "2019-03-07T10:00:00Z", content: `<p>${CANARY.private} for a list</p>`, to: [`${ACTOR}/lists/1`], cc: [] },
  question: { n: 6, at: "2019-03-08T10:00:00Z", content: "<p>Which one?</p>", type: "Question" },
  quote: {
    n: 7,
    at: "2019-03-09T10:00:00Z",
    content: `<p class="quote-inline">RE: ${masLink("https://other.example/@bob/111")}</p><p>My comment on a quote</p>`,
    quote: "https://other.example/users/bob/statuses/111",
  },
  warning: { n: 8, at: "2019-03-10T10:00:00Z", content: "<p>The text behind a warning</p>", summary: "spoilers ahead" },
  sensitive: { n: 9, at: "2019-03-11T10:00:00Z", content: "<p>A sensitive picture</p>", sensitive: true, attachment: [{ mediaType: "image/jpeg", url: `/${mediaPath(9)}`, name: "a picture" }] },
  thread: { n: 10, at: "2019-03-12T10:00:00Z", content: "<p>Following up on my own post</p>", inReplyTo: statusId(1) },
  reply: {
    n: 11,
    at: "2019-03-13T10:00:00Z",
    content: `<p>${mention("https://other.example/@bob", "bob")}${SPACE}${mention("https://third.example/@carol", "carol")}${SPACE}Thanks both, see @dave too</p>`,
    inReplyTo: "https://other.example/users/bob/statuses/222",
  },
  ownLinks: {
    n: 12,
    at: "2019-03-14T10:00:00Z",
    content: `<p>My earlier post ${masLink(`https://${FIXTURE_HOST}/@${CANARY.handle}/109000000000000001`)} and my profile ${masLink(`https://${FIXTURE_HOST}/@${CANARY.handle}`)} and an old one ${masLink(`https://${FIXTURE_HOST}/users/${CANARY.handle}/statuses/109000000000000002`)}</p>`,
  },
  longLink: { n: 13, at: "2019-03-15T10:00:00Z", content: `<p>Read ${masLink("https://example.com/a/very/long/path/that/mastodon/shortens")} today <a href="https://${FIXTURE_HOST}/tags/korbat" class="mention hashtag" rel="tag">#<span>korbat</span></a></p>` },
  photos: {
    n: 14,
    at: "2019-03-16T10:00:00Z",
    content: "<p>Two photos</p>",
    attachment: [
      { mediaType: "image/jpeg", url: `/${mediaPath(14)}`, name: "  A described   photo  " },
      { mediaType: "image/png", url: mediaPath(15, "png"), name: null },
    ],
  },
  video: { n: 16, at: "2019-03-17T10:00:00Z", content: "<p>A video and a gif</p>", attachment: [{ mediaType: "video/mp4", url: `/${mediaPath(16, "jpg")}` }, { mediaType: "image/gif", url: `/${mediaPath(17, "jpg")}` }] },
  longAlt: { n: 18, at: "2019-03-18T10:00:00Z", content: "<p>A photo with a long description</p>", attachment: [{ mediaType: "image/webp", url: `https://${FIXTURE_HOST}/system/${mediaPath(18, "webp")}`, name: LONG_DESCRIPTION }] },
  missing: { n: 19, at: "2019-03-19T10:00:00Z", content: "<p>A photo that is not in the archive</p>", attachment: [{ mediaType: "image/jpeg", url: `/${mediaPath(19)}`, name: "gone" }] },
  tooOld: { n: 20, at: "2001-01-01T00:00:00Z", content: "<p>Before the first tweet</p>" },
  offset: { n: 21, at: "2019-03-20T23:30:00.750-02:00", content: "<p>Dated with an offset</p>" },
} satisfies Record<string, NoteSpec>;

export interface MastodonArchiveOptions {
  media?: boolean;
  noActor?: boolean;
  noOutbox?: boolean;
  notes?: NoteSpec[];
  /** Raw outbox.json text instead of the generated one. */
  outbox?: string;
  extra?: ZipItem[];
}

export function outboxJson(notes: readonly NoteSpec[], announce = true): string {
  const items: unknown[] = notes.map(createActivity);
  if (announce) {
    items.splice(2, 0, {
      id: `${ACTOR}/statuses/1090000000000000998/activity`,
      type: "Announce",
      actor: ACTOR,
      published: "2019-03-05T12:00:00Z",
      to: [PUBLIC],
      cc: [FOLLOWERS],
      object: { id: "https://other.example/users/bob/statuses/333", type: "Note", content: `<p>${CANARY.private} a boosted post</p>`, attributedTo: "https://other.example/users/bob" },
    });
  }
  return JSON.stringify({ "@context": "https://www.w3.org/ns/activitystreams", id: "outbox.json", type: "OrderedCollection", totalItems: items.length, orderedItems: items }, null, 1);
}

export function buildMastodonArchive(options: MastodonArchiveOptions = {}): Buffer {
  const notes = options.notes ?? Object.values(MASTODON_NOTES);
  const items: ZipItem[] = [];
  if (options.noOutbox !== true) items.push({ name: "outbox.json", data: options.outbox ?? outboxJson(notes, options.notes === undefined) });
  if (options.noActor !== true) {
    items.push({ name: "actor.json", data: JSON.stringify({ id: ACTOR, type: "Person", preferredUsername: CANARY.handle, name: CANARY.name, summary: `<p>${CANARY.name}</p>` }) });
  }
  items.push({ name: "likes.json", data: JSON.stringify({ type: "OrderedCollection", orderedItems: [`https://other.example/users/bob/statuses/${CANARY.like}`] }) });
  items.push({ name: "bookmarks.json", data: JSON.stringify({ type: "OrderedCollection", orderedItems: [] }) });
  items.push({ name: "avatar.png", data: Buffer.concat([fakeImage("png", 300, 3), Buffer.from(CANARY.name)]), method: 0 });
  items.push({ name: "header.jpg", data: fakeImage("jpg", 300, 4), method: 0 });
  if (options.media !== false) {
    items.push({ name: mediaPath(9), data: fakeImage("jpg", 900, 9), method: 0 });
    items.push({ name: mediaPath(14), data: fakeImage("jpg", 1_400, 14), method: 0 });
    items.push({ name: mediaPath(15, "png"), data: fakeImage("png", 1_500, 15), method: 0 });
    items.push({ name: mediaPath(16, "jpg"), data: fakeImage("jpg", 1_600, 16), method: 0 });
    items.push({ name: mediaPath(17, "jpg"), data: fakeImage("gif", 1_700, 17), method: 0 });
    items.push({ name: mediaPath(18, "webp"), data: fakeImage("webp", 1_800, 18), method: 0 });
  }
  items.push(...(options.extra ?? []));
  return buildZip(items);
}
