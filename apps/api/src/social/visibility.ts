import type { Tombstone } from "@korbat/contracts";
import type { ViewerId } from "./context";

export type StoredPostState = "visible" | "withheld" | "removed" | "deleted_by_author";

/**
 * shown: the viewer gets the post. hidden: the viewer may not see it (a block, or moderation state
 * on someone else's post). deleted: the author removed it. Hidden and deleted posts are omitted
 * from lists and become tombstones only where structure needs them.
 */
export type PostAccess = "shown" | "hidden" | "deleted";

/**
 * The one rule every read applies (2a spec, section 4). A block in either direction hides
 * everything, even a deleted post's tombstone reason. The author sees their own withheld and
 * removed posts; nobody else does. The switch names every stored state: a state added to
 * StoredPostState does not compile here until this reader decides it, and a value the code was
 * never told about is hidden from everyone, its author included.
 */
export function postAccess(viewer: ViewerId, post: { authorId: string; state: StoredPostState }, blockedEitherWay: boolean): PostAccess {
  if (blockedEitherWay) return "hidden";
  switch (post.state) {
    case "deleted_by_author":
      return "deleted";
    case "visible":
      return "shown";
    case "withheld":
    case "removed":
      return viewer !== null && viewer === post.authorId ? "shown" : "hidden";
    default:
      post.state satisfies never;
      return "hidden";
  }
}

export function tombstone(id: string, access: Exclude<PostAccess, "shown">): Tombstone {
  return access === "deleted" ? { id, deleted: true } : { id, unavailable: true };
}
