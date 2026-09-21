import { CreatePostRequest, HandleParam, Pagination, PostId } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { MediaError } from "../media";
import { SocialError, type SocialDeps, type ViewerId } from "./context";
import { setEngagement, type EngagementKind } from "./flows/engagement";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "./flows/graph";
import { createPost, deletePost, getPost, thread } from "./flows/posts";
import { followers, following, profile } from "./flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "./flows/timelines";

const PostParam = z.object({ id: PostId });
const ProfileParam = z.object({ handle: HandleParam });

/**
 * Every social endpoint, mounted at `/api`. Handlers only validate, call a flow and shape the
 * response. `guard` is the auth module's requireSession: an onboarded account, with CSRF and
 * Origin already checked for cookie sessions.
 */
export function socialRoutes(deps: SocialDeps, guard: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  const viewer = (c: Context<AppEnv>): ViewerId => c.get("session")?.userId ?? null;
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;

  r.onError((err, c) => {
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // Creating a post attaches its images through the media module, which refuses with its own error type.
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    c.get("log").error({ err }, "unhandled error in social route");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  // ---------------------------------------------------------------- posts

  r.post("/posts", guard, validate("json", CreatePostRequest), async (c) => c.json(await createPost(deps, me(c), c.req.valid("json")), 201));
  r.get("/posts/:id", validate("param", PostParam), async (c) => c.json(await getPost(deps, viewer(c), c.req.valid("param").id)));
  r.delete("/posts/:id", guard, validate("param", PostParam), async (c) => {
    await deletePost(deps, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  r.get("/posts/:id/thread", validate("param", PostParam), validate("query", Pagination), async (c) =>
    c.json(await thread(deps, viewer(c), c.req.valid("param").id, c.req.valid("query"))),
  );

  for (const kind of ["like", "repost", "bookmark"] as EngagementKind[]) {
    r.post(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, true)));
    r.delete(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, false)));
  }

  // ---------------------------------------------------------------- timelines

  r.get("/timeline/following", guard, validate("query", Pagination), async (c) => c.json(await followingTimeline(deps, me(c), c.req.valid("query"))));
  r.get("/timeline/latest", validate("query", Pagination), async (c) => c.json(await latestTimeline(deps, viewer(c), c.req.valid("query"))));

  // ---------------------------------------------------------------- profiles and graph

  r.get("/profiles/:handle", validate("param", ProfileParam), async (c) => c.json(await profile(deps, viewer(c), c.req.valid("param").handle)));
  r.get("/profiles/:handle/posts", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profilePosts(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/replies", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profileReplies(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/followers", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await followers(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/following", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await following(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );

  r.post("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, false)));

  // ---------------------------------------------------------------- the viewer's private lists

  r.get("/me/likes", guard, validate("query", Pagination), async (c) => c.json(await likedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/bookmarks", guard, validate("query", Pagination), async (c) => c.json(await bookmarkedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/blocks", guard, validate("query", Pagination), async (c) => c.json(await blockedList(deps, me(c), c.req.valid("query"))));
  r.get("/me/mutes", guard, validate("query", Pagination), async (c) => c.json(await mutedList(deps, me(c), c.req.valid("query"))));

  return r;
}
