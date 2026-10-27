import type { ImportImageSkip } from "@korbat/contracts";
import { parseIsoDate } from "../../core";
import { finishText, replaceSourceLinks } from "../../text";
import { ScanFailure, field, text, type AdapterItem, type AllowedArchive, type ReadContext, type SourceAdapter } from "../types";

/**
 * The Bluesky adapter (3b design, section 5.7; behind the owner's switch, decision 16). The archive is a repository
 * export (a CAR), one pseudo-entry whose reader yields post records only: the header, the commit, the MST nodes and the
 * records under app.bsky.feed.post/ are all that is decoded. The export holds no image files, and korbat never fetches
 * them from a PDS: every image or video a post embeds is counted bluesky_no_files. The commit's DID is used only to
 * tell the account's own replies from replies to others.
 */

const POST_TYPE = "app.bsky.feed.post";
/** Self-labels that mark sexual content, which R1 forbids: such a post is left out (decision 10). */
const ADULT_LABELS = new Set(["porn", "sexual", "nudity"]);
const IMAGES = "app.bsky.embed.images";
const GALLERY = "app.bsky.embed.gallery";
const VIDEO = "app.bsky.embed.video";
const QUOTE_WITH_MEDIA = "app.bsky.embed.recordWithMedia";

/** How many files an embed would have needed: images and gallery items one each, a video one. */
function filesOf(embed: unknown): number {
  const type = text(embed, "$type");
  if (type === IMAGES || type === GALLERY) {
    const list = field(embed, "images") ?? field(embed, "items");
    return Array.isArray(list) ? list.length : 1;
  }
  if (type === VIDEO) return 1;
  if (type === QUOTE_WITH_MEDIA) return filesOf(field(embed, "media"));
  // A quote (app.bsky.embed.record) keeps its text, a link card (external) is dropped: neither has a file.
  return 0;
}

function labelled(record: unknown): boolean {
  const values = field(field(record, "labels"), "values");
  return Array.isArray(values) && values.some((label) => ADULT_LABELS.has(text(label, "val") ?? ""));
}

async function* readPosts(archive: AllowedArchive, context: ReadContext): AsyncGenerator<AdapterItem> {
  if (archive.kind !== "car") throw new ScanFailure("not_this_source");
  const ownPosts = `at://${archive.did}/${POST_TYPE}/`;
  let index = 0;
  for await (const record of archive.records()) {
    context.checkAborted();
    const at = index++;
    if (!context.takeItem()) return yield { skipped: "over_item_cap" };
    if ("unreadable" in record) {
      yield { skipped: "unreadable", index: at };
      continue;
    }
    const value = record.value;
    const body = text(value, "text");
    const created = parseIsoDate(field(value, "createdAt"));
    if (text(value, "$type") !== POST_TYPE || body === undefined || created === null) {
      yield { skipped: "unreadable", index: at };
      continue;
    }
    if (labelled(value)) {
      yield { skipped: "adult_label" };
      continue;
    }
    const parent = text(field(field(value, "reply"), "parent"), "uri");
    const kind = parent === undefined ? "post" : parent.startsWith(ownPosts) ? "thread" : "reply";
    // `text` holds no HTML and its facets are not read: links stay as typed, but for 5.3 step 3b.
    const linked = replaceSourceLinks(body, "bluesky");
    const finished = finishText(linked.text);
    const imageSkips: ImportImageSkip[] = Array.from({ length: filesOf(field(value, "embed")) }, () => "bluesky_no_files" as const);
    yield {
      kept: {
        sourceId: record.uri,
        parentId: kind === "thread" ? parent! : null,
        kind,
        at: created,
        text: finished.text,
        cleaned: finished.removed,
        sourceLinks: linked.count,
        protected: false,
        warning: false,
        images: [],
        imageSkips,
      },
    };
  }
}

export const blueskyAdapter: SourceAdapter = {
  source: "bluesky",
  // Nothing is opened by name: the CAR reader decides what is decoded.
  allowlist: [],
  detect(entries) {
    return entries.length === 1 ? null : "not_this_source";
  },
  readPosts,
};
