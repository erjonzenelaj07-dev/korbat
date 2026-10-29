/**
 * The cards module (2d design, sections 8.1 and 9.1): the share cards of a public post's page and a profile's page, which
 * Caddy's /post/* and /u/* handles ask for at every view and print into the shell's head. The only file outside
 * `src/cards/` may import. It owns no table: it reads a post or a profile through the social module's interface for cards,
 * exactly as a signed-out reader gets it, and builds the block in build.ts.
 */
import { HandleParam, PostId } from "@korbat/contracts";
import { Hono } from "hono";
import type { SocialForCards } from "../social";
import { cardBlock, cardHeader, postCard, profileCard } from "./build";

export { CARD_WORDS } from "./words";

export interface CardsDeps {
  /** The social module's interface for cards: a post or a profile as a signed-out reader gets it, with its link-preview switch. */
  social: SocialForCards;
  /** APP_ORIGIN, the app's own origin: every address a card names is built on it. */
  appOrigin: string;
}

/**
 * GET /api/cards/post/:id and GET /api/cards/profile/:handle (8.1), a router of its own that app.ts mounts beside the status
 * route of 3f: after the global limit, which counts the question against the visitor (decision 30), and before the
 * session's resolution, so a card is the same for everyone, whatever cookies or token the visitor's request carries. Each
 * answers 204 with no body and the block in Korbat-Card, or 404 with no body and no header: a post not shown to a
 * signed-out reader, an author or a profile deleted, an old or unknown handle, and a malformed id or handle, which each
 * route parses itself, since the validator would answer it with a JSON body. Cache-Control is the API's no-store.
 */
export function createCards(deps: CardsDeps) {
  const r = new Hono();
  r.get("/cards/post/:id", async (c) => {
    const id = PostId.safeParse(c.req.param("id"));
    if (!id.success) return c.body(null, 404);
    const found = await deps.social.post(id.data);
    if (found === null) return c.body(null, 404);
    return c.body(null, 204, { "Korbat-Card": cardHeader(cardBlock(deps.appOrigin, postCard(found.view, found.previews))) });
  });
  r.get("/cards/profile/:handle", async (c) => {
    // A handle as a profile's page takes it: a leading @ and any case, compared lowercased as the profile's read compares it.
    const handle = HandleParam.safeParse(c.req.param("handle"));
    if (!handle.success) return c.body(null, 404);
    const found = await deps.social.profile(handle.data);
    if (found === null) return c.body(null, 404);
    return c.body(null, 204, { "Korbat-Card": cardHeader(cardBlock(deps.appOrigin, profileCard(found.view, found.previews))) });
  });
  return {
    /** Mounted at /api by app.ts, beside the status route. No interface member: nothing outside this module calls it. */
    routes: r,
  };
}

export type Cards = ReturnType<typeof createCards>;
