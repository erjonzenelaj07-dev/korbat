import type { ExportFormat, Platform } from "@korbat/contracts";
import { AccountError, type AccountDeps } from "../context";
import type { ZipWriter } from "../zip";

/** One export a day (1b design, section 10). */
export const EXPORTS_PER_WINDOW = 1;
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The entry an image has in the archive; export.json names it under the post's media. */
export function mediaEntry(id: string): string {
  return `media/${id}.webp`;
}

/** The download's name: the handle and the day, so several exports of one account sort by date. */
export function exportFilename(handle: string, now: Date): string {
  return `korbat-export-${handle}-${now.toISOString().slice(0, 10)}.zip`;
}

/** export.json as it will be written, and the image files to put next to it. */
export interface ExportPlan {
  json: ExportFormat;
  images: { id: string; path: string }[];
}

/**
 * Counts one export of the account in the daily window and refuses once it is used up. Taken before
 * anything is built or streamed, so a stream that fails midway still counts; Retry-After says when the
 * window resets.
 */
export async function enforceExportLimit(deps: AccountDeps, userId: string): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(`export:${userId}`, EXPORT_WINDOW_MS);
  } catch {
    // Fails closed: an export that cannot be counted is not made, and the client is told to retry shortly.
    throw new AccountError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > EXPORTS_PER_WINDOW) throw new AccountError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

const iso = (at: Date): string => at.toISOString();
const isoOrNull = (at: Date | null): string | null => (at ? at.toISOString() : null);

/**
 * export.json in memory, bounded by the account's own rows, and the list of image files to stream next
 * to it. The three modules are asked at once; every time becomes ISO text here, and every image on a
 * post is named by the entry it will have. `missingMedia` starts empty and is filled while the archive
 * is written.
 */
export async function buildExport(deps: AccountDeps, userId: string, currentSessionId: string, now: Date): Promise<ExportPlan> {
  const [account, profile, images] = await Promise.all([deps.auth.exportAccount(userId), deps.social.exportProfile(userId), deps.media.exportImages(userId)]);
  const json: ExportFormat = {
    format: "korbat-export-1",
    exportedAt: iso(now),
    account: {
      id: account.account.id,
      email: account.account.email,
      createdAt: iso(account.account.createdAt),
      role: account.account.role,
      mfaEnabled: account.account.mfaEnabled,
      hasPassword: account.account.hasPassword,
      verified: account.account.verified,
      termsVersion: account.account.termsVersion,
      termsAcceptedAt: isoOrNull(account.account.termsAcceptedAt),
    },
    profile: {
      handle: profile.profile.handle,
      displayName: profile.profile.displayName,
      bio: profile.profile.bio,
      createdAt: iso(profile.profile.createdAt),
      handleHistory: [...profile.profile.handleHistory],
    },
    posts: profile.posts.map((post) => ({
      id: post.id,
      body: post.body,
      createdAt: iso(post.createdAt),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      state: post.state,
      deletedAt: isoOrNull(post.deletedAt),
      media: post.media.map((image) => ({ id: image.id, file: mediaEntry(image.id), altText: image.altText, width: image.width, height: image.height })),
    })),
    likes: profile.likes.map((ref) => ({ postId: ref.postId, at: iso(ref.at) })),
    reposts: profile.reposts.map((ref) => ({ postId: ref.postId, at: iso(ref.at) })),
    bookmarks: profile.bookmarks.map((ref) => ({ postId: ref.postId, at: iso(ref.at) })),
    following: profile.following.map((ref) => ({ handle: ref.handle, since: iso(ref.since) })),
    blocks: profile.blocks.map((ref) => ({ handle: ref.handle, since: iso(ref.since) })),
    mutes: profile.mutes.map((ref) => ({ handle: ref.handle, since: iso(ref.since) })),
    sessions: account.sessions.map((session) => ({ id: session.id, createdAt: iso(session.createdAt), lastUsedAt: iso(session.lastUsedAt), current: session.id === currentSessionId })),
    // The platform column is text; sign-in only ever writes one of the contract's three values.
    devices: account.devices.map((device) => ({ label: device.label, platform: device.platform as Platform, firstSeenAt: iso(device.firstSeenAt), lastSeenAt: iso(device.lastSeenAt) })),
    events: account.events.map((event) => ({ type: event.type, at: iso(event.at) })),
    missingMedia: [],
  };
  return { json, images };
}

/**
 * Writes the archive: every image as a stored entry, then export.json, then the central directory.
 * export.json comes last so that missingMedia can name every image whose file was gone when its turn
 * came (the sweeper may be between the row and the file); the order of entries means nothing to a
 * reader. The plan's json is the one written, missingMedia filled in.
 */
export async function writeExport(writer: ZipWriter, plan: ExportPlan): Promise<void> {
  for (const image of plan.images) {
    if (!(await writer.addFile(mediaEntry(image.id), image.path))) plan.json.missingMedia.push(image.id);
  }
  await writer.addJson("export.json", plan.json);
  await writer.end();
}
