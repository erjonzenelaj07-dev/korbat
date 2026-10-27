import { IMPORT_RULES, type ImportImageSkip } from "@korbat/contracts";
import { detach, parseIsoDate, parseXDate } from "../../core";
import { ItemTooLarge, NotJson, afterPrefix, streamArray } from "../../json";
import { beforeEllipsis, expandTco, finishText, removeLeadingMentions, replaceSourceLinks, unescapeX } from "../../text";
import {
  ScanFailure,
  field,
  isAllowed,
  isRecord,
  text,
  type AdapterItem,
  type AllowedArchive,
  type DraftImage,
  type EntryRule,
  type ReadContext,
  type SourceAdapter,
  type Stashed,
  type ZipArchive,
} from "../types";

/**
 * The X adapter (3b design, section 5.5). X's file names are known mostly from open-source parsers (3.6), so this is
 * tested against fixtures, not trusted as a contract. It opens only the manifest, the tweet files, the notes, the
 * Circle file (its ids only), the protected history (its timestamps and actions only) and, while images are on, the
 * media of kept posts. direct-messages.js, ip-audit.js, deleted-tweets.js, like.js and every other file are refused by
 * name in the central directory and never inflated.
 */

const MANIFEST = "data/manifest.js";
const MANIFEST_PREFIX = "window.__THAR_CONFIG = ";
/** A data file's prefix, dropped before its JSON: `window.YTD.<name>.part<N> = `. */
const DATA_PREFIX = /^window[.]YTD[.][a-z_]+[.]part[0-9]+ = $/;
/** tweets-part<N>.js with N from 1 to IMPORT_RULES.tweetsPartsMax (99). */
const TWEETS_PART = /^data[/]tweets-part[1-9][0-9]?[.]js$/;
const TWEETS_FILES = ["data/tweet.js", "data/tweets.js"];
const NOTES = "data/note-tweet.js";
const CIRCLE = "data/twitter-circle-tweet.js";
const PROTECTED = "data/protected-history.js";
const MEDIA = /^data[/]tweets?_media[/][0-9]{1,20}-[A-Za-z0-9_-]{1,64}[.](jpg|jpeg|png|webp)$/;
const ID = /^[0-9]{1,20}$/;
const SEMICOLON = ";";

const isTweetsFile = (name: string) => TWEETS_FILES.includes(name) || TWEETS_PART.test(name);

const ALLOWLIST: readonly EntryRule[] = [
  { name: MANIFEST },
  ...TWEETS_FILES.map((name) => ({ name })),
  { pattern: TWEETS_PART },
  { name: NOTES },
  { name: CIRCLE },
  { name: PROTECTED },
  { pattern: MEDIA, images: true },
];

/** The manifest's userName and displayName are never read into a value: the parser drops them as it builds the object. */
const dropNames = (key: string, value: unknown) => (key === "userName" || key === "displayName" ? undefined : value);

interface Manifest {
  accountId: string | null;
  tweets: string[] | null;
  notes: string[] | null;
  circle: string[] | null;
}

async function readWhole(zip: ZipArchive, name: string, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of zip.open(name)) {
    length += chunk.length;
    if (length > maxBytes) throw new ScanFailure("not_this_source");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The file names a manifest lists under one data type, each of which must also be on the allowlist; null without a list. */
function listed(dataTypes: unknown, type: string, accept: (name: string) => boolean): string[] | null {
  const files = field(field(dataTypes, type), "files");
  if (!Array.isArray(files)) return null;
  return files.map((file) => text(file, "fileName")).filter((name): name is string => name !== undefined && accept(name) && isAllowed(ALLOWLIST, name, false));
}

/** The manifest: its prefix exactly, the rest parsed as JSON (never evaluated); a partial archive is refused. */
async function readManifest(zip: ZipArchive): Promise<Manifest> {
  const raw = (await readWhole(zip, MANIFEST, IMPORT_RULES.manifestMaxBytes)).toString("utf8");
  if (!raw.startsWith(MANIFEST_PREFIX)) throw new ScanFailure("not_this_source");
  let body = raw.slice(MANIFEST_PREFIX.length).trimEnd();
  if (body.endsWith(SEMICOLON)) body = body.slice(0, -1);
  let manifest: unknown;
  try {
    manifest = JSON.parse(body, dropNames);
  } catch {
    throw new ScanFailure("not_this_source");
  }
  if (!isRecord(manifest)) throw new ScanFailure("not_this_source");
  if (field(field(manifest, "archiveInfo"), "isPartialArchive") === true) throw new ScanFailure("partial_archive");
  const accountId = text(field(manifest, "userInfo"), "accountId");
  const dataTypes = field(manifest, "dataTypes");
  return {
    accountId: accountId !== undefined && ID.test(accountId) ? accountId : null,
    tweets: listed(dataTypes, "tweets", isTweetsFile),
    notes: listed(dataTypes, "noteTweet", (name) => name === NOTES),
    circle: listed(dataTypes, "twitterCircleTweet", (name) => name === CIRCLE),
  };
}

type Element = { value: unknown; index: number } | { tooLarge: number };

/** The elements of one data file, after its prefix; a file that is not the expected JSON is unreadable. */
async function* elements(zip: ZipArchive, name: string): AsyncGenerator<Element> {
  let index = 0;
  try {
    for await (const value of streamArray(afterPrefix(zip.open(name), DATA_PREFIX))) yield { value, index: index++ };
  } catch (err) {
    if (err instanceof ItemTooLarge) {
      // The element cannot be read past its cap, and the file cannot be resumed after it: the rest of it is not read.
      yield { tooLarge: index };
      return;
    }
    if (err instanceof NotJson) throw new ScanFailure("unreadable");
    throw err;
  }
}

/** The tweet object of an element: `{ "tweet": {...} }`, or in 2019 archives the bare object. */
const tweetOf = (value: unknown) => (isRecord(field(value, "tweet")) ? field(value, "tweet") : value);

/** Protected periods from protected-history.js: only its timestamps and actions. */
function periodsOf(events: { at: number; protect: boolean }[]): [number, number][] {
  const periods: [number, number][] = [];
  let since: number | null = null;
  for (const event of events.sort((a, b) => a.at - b.at)) {
    if (event.protect && since === null) since = event.at;
    else if (!event.protect && since !== null) {
      periods.push([since, event.at]);
      since = null;
    }
  }
  if (since !== null) periods.push([since, Number.POSITIVE_INFINITY]);
  return periods;
}

/** t.co links an entity names, as { url, expanded }. */
function urlEntities(list: unknown, short: string, long: string): { url: string; expanded: string }[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const url = text(entry, short);
    const expanded = text(entry, long);
    return url !== undefined && expanded !== undefined ? [{ url, expanded }] : [];
  });
}

/** Steps 2, 3 and 3b on a tweet's text, before the leading mentions' removal was applied by the caller. */
function convert(raw: string, urls: { url: string; expanded: string }[], media: string[]): { text: string; count: number } {
  return replaceSourceLinks(expandTco(unescapeX(raw), urls, media), "x");
}

async function* readPosts(archive: AllowedArchive, context: ReadContext): AsyncGenerator<AdapterItem> {
  if (archive.kind !== "zip") throw new ScanFailure("not_this_source");
  const manifest = await readManifest(archive);
  const present = (names: readonly string[]) => names.filter((name) => archive.has(name));
  const tweetFiles = present(manifest.tweets ?? archive.entries.map((entry) => entry.name).filter(isTweetsFile));
  const noteFiles = present(manifest.notes ?? [NOTES]);
  const circleFiles = present(manifest.circle ?? [CIRCLE]);

  // The Circle file first, ids only, into a set: its tweets are not public.
  const circle = new Set<string>();
  for (const name of circleFiles) {
    for await (const element of elements(archive, name)) {
      if ("tooLarge" in element) {
        yield { skipped: "item_too_large", index: element.tooLarge };
        break;
      }
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const id = text(tweetOf(element.value), "id_str");
      // Detached: a slice of the file's chunk would keep the whole chunk alive in the set.
      if (id !== undefined) circle.add(detach(id));
    }
  }

  const events: { at: number; protect: boolean }[] = [];
  if (archive.has(PROTECTED)) {
    for await (const element of elements(archive, PROTECTED)) {
      if ("tooLarge" in element) {
        yield { skipped: "item_too_large", index: element.tooLarge };
        break;
      }
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const history = field(element.value, "protectedHistory");
      const at = parseIsoDate(field(history, "protectedAt"));
      const action = text(history, "action");
      if (at !== null && (action === "Protect" || action === "Unprotect")) events.push({ at, protect: action === "Protect" });
    }
  }
  const periods = periodsOf(events);
  const isProtected = (at: number) => periods.some(([from, to]) => at >= from && at < to);

  // Notes wait in the scratch file, converted, keyed in memory by their second only.
  const notes = new Map<number, Stashed[]>();
  for (const name of noteFiles) {
    for await (const element of elements(archive, name)) {
      if ("tooLarge" in element) {
        yield { skipped: "item_too_large", index: element.tooLarge };
        break;
      }
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const note = field(element.value, "noteTweet");
      const at = parseIsoDate(field(note, "createdAt"));
      const core = field(note, "core");
      const raw = text(core, "text");
      if (at === null || raw === undefined) continue;
      const urls = [...urlEntities(field(core, "urls"), "shortUrl", "expandedUrl"), ...urlEntities(field(core, "urls"), "url", "expanded_url")];
      const converted = replaceSourceLinks(expandTco(raw, urls, []), "x");
      const stashed = await context.stash(JSON.stringify(converted));
      const second = Math.floor(at / 1_000);
      notes.set(second, [...(notes.get(second) ?? []), stashed]);
    }
  }

  for (const name of tweetFiles) {
    for await (const element of elements(archive, name)) {
      context.checkAborted();
      if ("tooLarge" in element) {
        yield { skipped: "item_too_large", index: element.tooLarge };
        break;
      }
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const unreadable: AdapterItem = { skipped: "unreadable", index: element.index };
      const tweet = tweetOf(element.value);
      const id = text(tweet, "id_str");
      const fullText = text(tweet, "full_text");
      if (id === undefined || !ID.test(id) || fullText === undefined) {
        yield unreadable;
        continue;
      }
      if (fullText.startsWith("RT @")) {
        yield { skipped: "repost" };
        continue;
      }
      if (circle.has(id)) {
        yield { skipped: "not_public" };
        continue;
      }
      const editInfo = field(tweet, "edit_info");
      const editIds = field(field(editInfo, "initial"), "editTweetIds") ?? field(field(field(editInfo, "edit"), "editControlInitial"), "editTweetIds");
      if (Array.isArray(editIds) && editIds.some((other) => typeof other === "string" && ID.test(other) && BigInt(other) > BigInt(id))) {
        yield { skipped: "older_version" };
        continue;
      }
      const at = parseXDate(field(tweet, "created_at"));
      if (at === null) {
        yield unreadable;
        continue;
      }
      const replyStatus = text(tweet, "in_reply_to_status_id_str");
      const replyUser = text(tweet, "in_reply_to_user_id_str");
      const replying = replyStatus !== undefined && replyStatus !== "";
      const kind = !replying ? "post" : manifest.accountId !== null && replyUser === manifest.accountId ? "thread" : "reply";

      const entities = field(tweet, "entities");
      const extended = field(field(tweet, "extended_entities"), "media");
      const mediaList = Array.isArray(extended) ? extended : Array.isArray(field(entities, "media")) ? (field(entities, "media") as unknown[]) : [];
      const mediaUrls = [...mediaList, ...((field(entities, "media") as unknown[] | undefined) ?? [])].map((m) => text(m, "url")).filter((url): url is string => url !== undefined);
      const range = field(tweet, "display_text_range");
      const start = Array.isArray(range) ? Number(range[0]) : 0;
      let converted = convert(removeLeadingMentions(fullText, start), urlEntities(field(entities, "urls"), "url", "expanded_url"), mediaUrls);

      // A truncated post whose note has the same second and starts with its visible text takes the note's whole text.
      const head = beforeEllipsis(converted.text);
      if (head !== null) {
        for (const stashed of notes.get(Math.floor(at / 1_000)) ?? []) {
          const note = JSON.parse(await context.recall(stashed)) as { text: string; count: number };
          if (note.text.startsWith(head)) {
            converted = note;
            break;
          }
        }
      }
      const finished = finishText(converted.text);

      const images: DraftImage[] = [];
      const imageSkips: ImportImageSkip[] = [];
      const sensitive = field(tweet, "possibly_sensitive") === true;
      for (const media of mediaList) {
        const type = text(media, "type");
        if (type === "video" || type === "animated_gif") imageSkips.push("video");
        else if (type !== "photo") imageSkips.push("unsupported");
        else if (sensitive) imageSkips.push("sensitive");
        else {
          const base = (text(media, "media_url_https") ?? "").split("/").at(-1) ?? "";
          const entry = [`data/tweets_media/${id}-${base}`, `data/tweet_media/${id}-${base}`].find((candidate) => MEDIA.test(candidate) && archive.has(candidate));
          // An X image has no description: the person may write one in the preview (decision 20).
          images.push({ entry: entry ?? null, alt: null });
        }
      }
      yield {
        kept: {
          sourceId: id,
          parentId: kind === "thread" ? replyStatus! : null,
          kind,
          at,
          text: finished.text,
          cleaned: finished.removed,
          sourceLinks: converted.count,
          protected: isProtected(at),
          warning: false,
          images,
          imageSkips,
        },
      };
    }
  }
}

export const xAdapter: SourceAdapter = {
  source: "x",
  allowlist: ALLOWLIST,
  detect(entries) {
    const manifest = entries.find((entry) => entry.name === MANIFEST);
    return manifest !== undefined && manifest.size <= IMPORT_RULES.manifestMaxBytes ? null : "not_this_source";
  },
  readPosts,
};
