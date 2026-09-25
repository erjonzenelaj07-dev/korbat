import { z } from "zod";
import { Platform, Role } from "./auth";

const at = z.iso.datetime();

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
const PostRef = z.object({ postId: z.uuid(), at });

/** The other side of a graph relation by the handle it had at export time (nothing else about them), and since when. */
const HandleRef = z.object({ handle: z.string(), since: at });

/** An image attached to one of the account's posts; `file` names its entry in the archive. */
const ExportedMedia = z.object({ id: z.uuid(), file: z.string(), altText: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });

/** A post as its author wrote it; a deleted one keeps its place with an empty body and its deletion time. */
const ExportedPost = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: at,
  replyToId: z.uuid().nullable(),
  quoteOfId: z.uuid().nullable(),
  state: z.enum(["visible", "withheld", "removed", "deleted_by_author"]),
  deletedAt: at.nullable(),
  media: z.array(ExportedMedia),
});

/**
 * export.json inside the data export archive (1b design, section 7.5): everything the account owns, and
 * nothing about other people beyond the handle they had at export time.
 */
export const ExportFormat = z.object({
  format: z.literal("korbat-export-1"),
  exportedAt: at,
  account: z.object({
    id: z.uuid(),
    email: z.email(),
    createdAt: at,
    role: Role,
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
    verified: z.boolean(),
    termsVersion: z.string().nullable(),
    termsAcceptedAt: at.nullable(),
  }),
  profile: z.object({
    handle: z.string(),
    displayName: z.string(),
    bio: z.string(),
    createdAt: at,
    /** Every handle the account ever had, the current one included. */
    handleHistory: z.array(z.string()),
  }),
  posts: z.array(ExportedPost),
  likes: z.array(PostRef),
  reposts: z.array(PostRef),
  bookmarks: z.array(PostRef),
  following: z.array(HandleRef),
  blocks: z.array(HandleRef),
  mutes: z.array(HandleRef),
  sessions: z.array(z.object({ id: z.string(), createdAt: at, lastUsedAt: at, current: z.boolean() })),
  devices: z.array(z.object({ label: z.string().nullable(), platform: Platform, firstSeenAt: at, lastSeenAt: at })),
  /** The account's own security events: their kind and time, without the metadata. */
  events: z.array(z.object({ type: z.string(), at })),
  /** Ids of ready images whose file was not on disk when the archive was written. */
  missingMedia: z.array(z.string()),
});
export type ExportFormat = z.infer<typeof ExportFormat>;
