import { CountsRequest, CreatePostRequest, HandleChangeRequest, HandleParam, Pagination, PostId, ProfileEditRequest } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { MediaError } from "../media";
import { SocialError, type SocialDeps, type ViewerId } from "./context";
import { setEngagement, type EngagementKind } from "./flows/engagement";
import { explorePage, exploreStatus, setShowInExplore } from "./flows/explore";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "./flows/graph";
import { createPost, deletePost, getPost, setCountsHidden, thread } from "./flows/posts";
import { changeHandle, editProfile, setSharePreviews } from "./flows/profile-edit";
import { followers, following, profile } from "./flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profileImported, profilePosts, profileReplies } from "./flows/timelines";

const PostParam = z.object({ id: PostId });
const ProfileParam = z.object({ handle: HandleParam });

/** Signed out, Explore is its first page only (2c design, section 8): a cursor asks for more, which needs an account. */
const EXPLORE_SIGN_IN = "Sign in to see more of Explore.";

/**
 * Every social endpoint, mounted at `/api`. Handlers only validate, call a flow and shape the
 * response. `guard` is the auth module's requireSession: an onboarded account, with CSRF and
 * Origin already checked for cookie sessions. `fresh` is its requireFreshAuth: a credential proven
 * in the last five minutes, which a handle change needs on top.
 */
export function socialRoutes(deps: SocialDeps, guard: MiddlewareHandler<AppEnv>, fresh: MiddlewareHandler<AppEnv>) {
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
  // 2d (decision 26, 9.2): the author's hidden-counts switch of a post, before the post's deletion in the route table.
  r.patch("/posts/:id/counts", guard, validate("param", PostParam), validate("json", CountsRequest), async (c) =>
    c.json(await setCountsHidden(deps, me(c), c.req.valid("param").id, c.req.valid("json").hidden)),
  );
  r.get("/posts/:id", validate("param", PostParam), async (c) => c.json(await getPost(deps, viewer(c), c.req.valid("param").id)));
  r.delete("/posts/:id", guard, validate("param", PostParam), async (c) => {
    await deletePost(deps, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  r.get("/posts/:id/thread", validate("param", PostParam), validate("query", Pagination), async (c) =>
    c.json(await thread(deps, viewer(c), c.req.valid("param").id, c.req.valid("query"))),
  );
  // Why the author's own post is in Explore or not; anyone else gets not_found from the flow.
  r.get("/posts/:id/explore", guard, validate("param", PostParam), async (c) => c.json(await exploreStatus(deps, me(c), c.req.valid("param").id)));

  for (const kind of ["like", "repost", "bookmark"] as EngagementKind[]) {
    r.post(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, true)));
    r.delete(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, false)));
  }

  // ---------------------------------------------------------------- timelines

  r.get("/timeline/following", guard, validate("query", Pagination), async (c) => c.json(await followingTimeline(deps, me(c), c.req.valid("query"))));
  r.get("/timeline/latest", validate("query", Pagination), async (c) => c.json(await latestTimeline(deps, viewer(c), c.req.valid("query"))));
  r.get("/timeline/explore", validate("query", Pagination), async (c) => {
    const query = c.req.valid("query");
    // Refused here, before the flow reads anything: whatever the cursor holds, a signed-out reader gets the first page only.
    if (!viewer(c) && query.cursor) return c.json(errorBody("unauthenticated", EXPLORE_SIGN_IN, c.get("requestId")), 401);
    return c.json(await explorePage(deps, viewer(c), query));
  });

  // ---------------------------------------------------------------- profiles and graph

  r.get("/profiles/:handle", validate("param", ProfileParam), async (c) => c.json(await profile(deps, viewer(c), c.req.valid("param").handle)));
  r.get("/profiles/:handle/posts", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profilePosts(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/replies", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profileReplies(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  // 3b (design, section 9.2): the Imported tab, public as the Posts tab is.
  r.get("/profiles/:handle/imported", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profileImported(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
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

  // ---------------------------------------------------------------- the viewer's own profile

  r.patch("/me/profile", guard, validate("json", ProfileEditRequest), async (c) => c.json({ profile: await editProfile(deps, me(c), c.req.valid("json")) }));
  r.post("/me/handle", guard, fresh, validate("json", HandleChangeRequest), async (c) => c.json({ profile: await changeHandle(deps, me(c), c.req.valid("json")) }));
  // "Show my posts in Explore": on and off, with no body, as the app's other switches.
  r.post("/me/explore", guard, async (c) => c.json(await setShowInExplore(deps, me(c), true)));
  r.delete("/me/explore", guard, async (c) => c.json(await setShowInExplore(deps, me(c), false)));
  // 2d (decision 21, 9.2): link previews of the account's posts and profile, on and off, written as the Explore switch.
  r.post("/me/share-previews", guard, async (c) => c.json(await setSharePreviews(deps, me(c), true)));
  r.delete("/me/share-previews", guard, async (c) => c.json(await setSharePreviews(deps, me(c), false)));

  return r;
}

/**
 * 3f (design, sections 5 and 7.12): GET /api/posts/:id/status, the one question Caddy asks the API for every request of a
 * post's page, so that a status check from outside reads what a person sees. A router of its own, mounted after the
 * global limit and before the session's resolution, as the image files' router is: Caddy's question carries the
 * visitor's cookies, and a route among the module's others would read a session for every page view. It parses the id
 * itself, since the validator would answer a malformed one with a JSON body, and answers 204 exactly when a post with
 * this id is visible, and 404 with no body otherwise (no such post, a malformed id, deleted by its author, withheld,
 * removed or disabled): the same for everyone, so it tells nothing a signed-out read of the post does not, and never 451.
 * No interface carries it: nothing outside this module calls it.
 */
export function postStatusRoutes(deps: Pick<SocialDeps, "repo">) {
  const r = new Hono<AppEnv>();
  r.get("/posts/:id/status", async (c) => {
    const id = PostId.safeParse(c.req.param("id"));
    if (!id.success) return c.body(null, 404);
    const row = (await deps.repo.findPosts([id.data])).get(id.data);
    return c.body(null, row?.state === "visible" ? 204 : 404);
  });
  return r;
}
