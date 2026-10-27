import { IMPORT_RULES, type ImportImageSkip } from "@korbat/contracts";
import { parseIsoDate } from "../../core";
import { htmlToText } from "../../html";
import { ItemTooLarge, NotJson, streamArray } from "../../json";
import { CONTENT_WARNING_LABEL, cleanDescription, finishText, replaceSourceLinks } from "../../text";
import { ScanFailure, field, isRecord, text, type AdapterItem, type AllowedArchive, type DraftImage, type EntryRule, type ReadContext, type SourceAdapter } from "../types";

/**
 * The Mastodon adapter (3b design, section 5.6), for archives of Mastodon 4.2 and later. It opens outbox.json and,
 * while images are on, the original media files a kept Note names. The order of its checks is the data-minimisation
 * rule: for each item it reads `type` first, then the Note's `to` and `cc`, and only for a kept Note any other field,
 * so a direct or followers-only post is skipped by its addressing before its content is read. actor.json's name is
 * read from the central directory for detect; the file is never opened, nor are likes.json, bookmarks.json, the avatar
 * or the header.
 */

const OUTBOX = "outbox.json";
const ACTOR = "actor.json";
const MEDIA = /^media_attachments[/]files[/]([0-9]{3}[/]){1,8}original[/][0-9a-f]{16}[.](jpg|jpeg|png|webp)$/;
const MEDIA_ROOT = "media_attachments/";
const PUBLIC = new Set(["https://www.w3.org/ns/activitystreams#Public", "as:Public", "Public"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PARAGRAPH = String.fromCharCode(10).repeat(2);

const ALLOWLIST: readonly EntryRule[] = [{ name: OUTBOX }, { name: ACTOR, listOnly: true }, { pattern: MEDIA, images: true }];

/** An addressing field as a list of strings: a single string, an array, or nothing. */
function addresses(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** An attachment's url as an archive path: a leading slash and anything up to media_attachments/ dropped. */
function mediaEntry(url: string | undefined): string | null {
  if (url === undefined) return null;
  const at = url.indexOf(MEDIA_ROOT);
  if (at < 0) return null;
  const path = url.slice(at);
  return MEDIA.test(path) ? path : null;
}

function hostOf(uri: string): string | undefined {
  try {
    return new URL(uri).hostname;
  } catch {
    return undefined;
  }
}

async function* readPosts(archive: AllowedArchive, context: ReadContext): AsyncGenerator<AdapterItem> {
  if (archive.kind !== "zip") throw new ScanFailure("not_this_source");
  let index = 0;
  try {
    for await (const item of streamArray(archive.open(OUTBOX), { member: "orderedItems" })) {
      context.checkAborted();
      const at = index++;
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const unreadable: AdapterItem = { skipped: "unreadable", index: at };
      // 1. The activity's type, and nothing else of a boost: its embedded object is never read.
      const type = text(item, "type");
      if (type === "Announce") {
        yield { skipped: "repost" };
        continue;
      }
      const note = field(item, "object");
      if (type !== "Create" || !isRecord(note)) {
        yield unreadable;
        continue;
      }
      // 2. The Note's addressing: a post with as:Public in neither to nor cc is private, direct or limited.
      const audience = [...addresses(field(note, "to")), ...addresses(field(note, "cc"))];
      if (!audience.some((address) => PUBLIC.has(address))) {
        yield { skipped: "not_public" };
        continue;
      }
      // 3. Only now, for a public or unlisted Note, any other field.
      const objectType = text(note, "type");
      if (objectType === "Question") {
        yield { skipped: "poll" };
        continue;
      }
      const id = text(note, "id");
      const published = parseIsoDate(field(note, "published"));
      if (objectType !== "Note" || id === undefined || published === null) {
        yield unreadable;
        continue;
      }
      // attributedTo tells a self-reply from a reply and names the person's own host; it is never kept.
      const actor = text(note, "attributedTo") ?? "";
      const inReplyTo = text(note, "inReplyTo");
      const kind = inReplyTo === undefined ? "post" : actor !== "" && inReplyTo.startsWith(`${actor}/statuses/`) ? "thread" : "reply";
      const host = hostOf(actor);
      let body = replaceSourceLinks(htmlToText(text(note, "content") ?? "", { reply: inReplyTo !== undefined }), "mastodon", host);
      const summary = text(note, "summary") ?? "";
      const warning = summary.trim() !== "";
      if (warning) {
        const said = replaceSourceLinks(summary, "mastodon", host);
        body = { text: CONTENT_WARNING_LABEL + said.text + PARAGRAPH + body.text, count: body.count + said.count };
      }
      const finished = finishText(body.text);

      const sensitive = field(note, "sensitive") === true;
      const images: DraftImage[] = [];
      const imageSkips: ImportImageSkip[] = [];
      const attachments = field(note, "attachment");
      for (const attachment of Array.isArray(attachments) ? attachments : []) {
        const mediaType = text(attachment, "mediaType") ?? "";
        if (IMAGE_TYPES.has(mediaType)) {
          if (sensitive) imageSkips.push("sensitive");
          else {
            const entry = mediaEntry(text(attachment, "url"));
            const { alt, cleaned } = cleanDescription(field(attachment, "name"));
            images.push({ entry: entry !== null && archive.has(entry) ? entry : null, alt, altCleaned: cleaned });
          }
        } else if (mediaType.startsWith("video/") || mediaType.startsWith("audio/")) imageSkips.push("video");
        else if (mediaType.startsWith("image/")) imageSkips.push("unsupported");
        // Anything else (a link card) is not an image: ignored.
      }
      yield {
        kept: {
          sourceId: id,
          parentId: kind === "thread" ? inReplyTo! : null,
          kind,
          at: published,
          text: finished.text,
          cleaned: finished.removed,
          sourceLinks: body.count,
          protected: false,
          warning,
          images,
          imageSkips,
        },
      };
    }
  } catch (err) {
    if (err instanceof ItemTooLarge) {
      // The outbox cannot be resumed after an element it could not hold: the rest of it is not read.
      yield { skipped: "item_too_large", index };
      return;
    }
    if (err instanceof NotJson) throw new ScanFailure("unreadable");
    throw err;
  }
}

export const mastodonAdapter: SourceAdapter = {
  source: "mastodon",
  allowlist: ALLOWLIST,
  detect(entries) {
    const outbox = entries.find((entry) => entry.name === OUTBOX);
    const actor = entries.some((entry) => entry.name === ACTOR);
    return outbox !== undefined && outbox.size <= IMPORT_RULES.zipDataMaxBytes && actor ? null : "not_this_source";
  },
  readPosts,
};
