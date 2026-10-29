// 2d (design, section 4.1; Task 1): the one tokenizer of mentions, which the API's createPost (the handles it stores and
// tells) and the app's RichText (the handles it draws as links) both use, so the two never disagree about what is a
// mention. It imports nothing, so any module may read it while the package loads.

/**
 * A mention: an @ that follows no handle character, then 3 to 20 handle characters with none after them. The right
 * boundary means a longer run is no mention at all, never its first 20 characters (which would name another possible
 * account), and the left one that an e-mail address is none. Handles are ASCII (`^[a-z0-9_]{3,20}$` once lowercased),
 * and post text refuses bidirectional and zero-width characters, so a mention cannot be split, hidden or imitated.
 *
 * The g flag is for String.prototype.split and matchAll in callers; a caller that runs exec on this object shares its
 * lastIndex with every other such caller, so mentionHandles below reads a copy.
 */
export const MENTION_TOKEN = /(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g;

/** How many distinct handles of one post are read at most: a 1,000-character post of 200 handles costs one bounded lookup. */
export const MENTION_SCAN_MAX = 40;
/** How many of a post's mentions that name a live account are stored, in text order (decision 12; post_mentions_position_range). */
export const MENTION_STORE_MAX = 20;
/** How many of the stored mentions write an Activity entry, the author and a reply's parent author not counted (decision 12). */
export const MENTION_NOTIFY_MAX = 10;

/**
 * The handles a post's text names, lowercased, each once, in the order they first appear, at most MENTION_SCAN_MAX of
 * them. The caller passes the normalised body (normalizePostBody), as createPost stores it.
 */
export function mentionHandles(body: string): string[] {
  // A fresh copy starts at index 0 whatever another caller left in MENTION_TOKEN.lastIndex, and leaves it alone.
  const token = new RegExp(MENTION_TOKEN.source, MENTION_TOKEN.flags);
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(token)) {
    const handle = match[1]!.toLowerCase();
    if (seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
    if (handles.length === MENTION_SCAN_MAX) break;
  }
  return handles;
}
