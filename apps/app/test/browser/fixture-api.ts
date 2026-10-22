import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthorCasesPage,
  AuthorNoticesPage,
  DecisionView,
  EngagementResponse,
  ExplorePage,
  ExploreStatus,
  FollowResponse,
  MeResponse,
  NoticeStatus,
  PasskeyListResponse,
  PasskeyOptionsResponse,
  PostPage,
  ProfilePage,
  ProfileView,
  PublicFacts,
  PublicHead,
  PublicTransparency,
  ReleaseNoticeView,
  ReportsPage,
  SessionsResponse,
  ThreadResponse,
  TimelinePage,
  UploadRefusalView,
  type Author,
  type MediaView,
  type PostView,
  type ProfileListItem,
  type TimelineItem,
} from "@korbat/contracts";
import type { z } from "zod";

/**
 * The API answers the app's browser check needs (UI design, section 12.3): /api/me signed in and out (a 401), the three
 * timelines with cursors, a post with its thread and its status for the post page's handle, profiles with their tabs and
 * lists, bookmarks, the public facts, the settings and cases screens' reads, a report's status, and one 2 by 2 WebP for
 * every image. Every answer is checked against @korbat/contracts' schema when it is built, so the app parses exactly
 * what the API would send. A request no fixture answers is a problem of the walk, answered 404. The reader's actions on a
 * post (like, repost, save, delete) and a follow are answered from UI Task 4 on, with switches that refuse a kind or
 * hold every action's answer back; nothing else that changes something is. Nothing here needs a database or the network.
 */

/** A WebP of 2 by 2 pixels (lossless, 38 bytes) in the accent violet: a real image, which the browser decodes under the policy. */
export const FIXTURE_WEBP = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQmWrVuv+BiOh/AAA=", "base64");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ADA: Author = { id: id(1), handle: "ada", displayName: "Ada Lovelace", verified: false };
export const GRACE: Author = { id: id(2), handle: "grace", displayName: "Grace Hopper", verified: true };
export const LINUS: Author = { id: id(3), handle: "linus", displayName: "Linus", verified: false };

/** Post number n's id, for a step that acts on one post of the timelines: Grace writes 1, 4, 7..., Linus 2, 5, 8..., Ada 3, 6, 9.... */
export const postIdOf = (n: number): string => id(100 + n);

/** The post the walk opens (by Grace), and a post id the API does not know, whose page answers 404. */
export const POST_ID = id(101);
export const MISSING_POST_ID = id(999);
/** A decision, a release and a refused upload of Ada's, for the cases screens. */
export const DECISION_ID = id(501);
export const RELEASE_ID = id(502);
export const UPLOAD_ID = id(503);
/** A report's status page: its reference and the token its link carries in the fragment. */
export const NOTICE_REF = "N-ABCDEFGH23";
export const NOTICE_TOKEN = "A".repeat(43);

/** The fixtures' own clock: every time is this many minutes before the walk started, so "3m" stays "3m". */
const START = Date.now();
const ago = (minutes: number) => new Date(START - minutes * 60_000).toISOString();
const daysAhead = (days: number) => new Date(START + days * 86_400_000).toISOString();

const BODIES = [
  "Morning light over the harbour. The ferries are running late again, and nobody seems to mind.",
  "Finished the first draft of the essay on Babbage's engines. It is long, and it needs a walk before it needs an edit.",
  "Reminder that the library's reading room opens at nine on Saturdays now.",
  "Small thing that made my day: the baker remembered my order.",
  "Notes from the meetup: three talks on compilers, one on gardening, all of them about patience.",
  "If you are near the old market today, the second-hand book stall has a box of maps from the sixties.",
  "Tried the new route home along the canal. Two herons, one very confident duck.",
  "Rain all afternoon, so I sorted the photo archive by year instead of by mood.",
];

/** One image, sized as 2b serves it: a 4 by 3 frame whose two sizes are the fixture WebP. */
function image(n: number): MediaView {
  const media = id(700 + n);
  return { id: media, width: 1200, height: 900, blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj", alt: `A photograph, number ${n}, of the harbour at dawn`, small: `/api/media/${media}/small.webp`, large: `/api/media/${media}/large.webp` };
}

const AUTHORS = [GRACE, LINUS, ADA];

/** Post number `n`: its author goes round the three accounts; every fourth carries an image, and post 8 two of them (the lightbox's steps page between them); newer posts have lower numbers. */
function post(n: number, signedIn: boolean, extra: Partial<PostView> = {}): PostView {
  const view: PostView = {
    id: id(100 + n),
    author: AUTHORS[(n - 1) % AUTHORS.length]!,
    body: BODIES[(n - 1) % BODIES.length]!,
    createdAt: ago(n * 7),
    state: "visible",
    replyTo: null,
    counts: { likes: (n * 3) % 17, reposts: n % 4, replies: n % 3, quotes: n % 2 },
    media: n === 8 ? [image(8), image(80)] : n % 4 === 0 ? [image(n)] : [],
    quoteOf: null,
    ...extra,
  };
  if (signedIn) view.viewer = { liked: n % 5 === 0, reposted: false, bookmarked: false };
  return view;
}

function parse<S extends z.ZodType>(schema: S, value: z.input<S>, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`the fixture ${what} does not match its schema: ${result.error.message}`);
  return result.data;
}

/** A page of a timeline: posts `from` to `to`, a repost of Grace's by Linus among them, and the next page's cursor. */
function timeline(from: number, to: number, signedIn: boolean, nextCursor: string | null) {
  const items: TimelineItem[] = [];
  for (let n = from; n <= to; n++) {
    if (n === from + 2) items.push({ kind: "repost", post: post(n + 40, signedIn, { author: GRACE }), repostedBy: LINUS, repostedAt: ago(n * 7 - 1) });
    items.push({ kind: "post", post: post(n, signedIn) });
  }
  return parse(TimelinePage, { items, nextCursor }, "timeline");
}

const listItem = (author: Author, bio: string, signedIn: boolean): ProfileListItem => ({ ...author, bio, ...(signedIn ? { viewerFollows: author.handle === "grace" } : {}) });

function profile(author: Author, signedIn: boolean) {
  const self = signedIn && author.id === ADA.id;
  return parse(
    ProfileView,
    {
      id: author.id,
      handle: author.handle,
      displayName: author.displayName,
      bio: author.handle === "ada" ? "Writing about engines, looms and the people who built them." : "Compilers, ships and the occasional heron.",
      verified: author.verified,
      createdAt: ago(60 * 24 * 90),
      counts: { posts: 42, followers: 128, following: 64 },
      // The reader follows nobody yet, so the follow step starts from Follow.
      ...(signedIn && !self ? { viewer: { following: false, followedBy: false, blocked: false, muted: false } } : {}),
    },
    "profile",
  );
}

function me() {
  return parse(
    MeResponse,
    {
      user: { id: ADA.id, email: "ada@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 1 },
      profile: { id: ADA.id, handle: ADA.handle, displayName: ADA.displayName, handleChangedAt: null, verified: false, showInExplore: true },
      standing: { activeStrikes: 0, measure: null, reporting: null, handleRetired: false },
    },
    "me",
  );
}

const FACTS = parse(
  PublicFacts,
  {
    r1: { state: "off", test: false, model: null, digest: null, threshold: null, thresholdVersion: null, publisherClaim: null, dpia: null, dpiaActs: null },
    match: { state: "off", test: false, source: null, dpia: null, dpiaActs: null },
    edge: { on: false, test: false },
    witness: { on: false, test: false },
    recipientsSignedOut: false,
    keeper: false,
  },
  "facts",
);

function decision() {
  return parse(
    DecisionView,
    {
      id: DECISION_ID,
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R3",
      rulesVersion: 3,
      redressVersion: 2,
      legalReference: null,
      facts: "The post offered followers for sale.",
      reason: "Selling followers breaks rule R3.",
      source: "own_initiative",
      decidedAt: ago(60 * 24 * 3),
      post: null,
      measures: [],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
      appealUntil: daysAhead(10),
      reversedOn: null,
      content: { kind: "account", handle: "ada", displayName: "Ada Lovelace", bio: "" },
      appeal: null,
      strike: null,
      standing: null,
    } as z.input<typeof DecisionView>,
    "decision",
  );
}

export interface FixtureState {
  /** Whether /api/me answers the account or 401. */
  signedIn: boolean;
  /** Everything the page asked that no fixture answers, or that the walk should never cause. */
  problems: string[];
  /** Every API request, in order: method, path and query, and when it arrived (ms since the walk's clock started). */
  requests: { method: string; path: string; at: number }[];
  /**
   * The actions the API refuses for now (like, repost, bookmark, follow, delete), with a 503 as a busy server would, so
   * a step sees the card roll back; and how long every action's answer waits, so a step sees the change before it.
   */
  refuse: Set<string>;
  delayMs: number;
}

export interface FixtureApi {
  state: FixtureState;
  handle(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer): Promise<void>;
  /** What GET /api/posts/<id>/status answers, for the post page's handle: 204 for a post the API shows, 404 otherwise. */
  postStatus(id: string): number;
}

type Answer = { status: number; json?: unknown; raw?: Buffer; type?: string };

/** A fixture post's number from its id: post n has the id id(100 + n). */
const numberOf = (postId: string): number => Number.parseInt(postId.slice(-12), 10) - 100;

/** Others who liked the post while the reader's like was on its way: the answer's count is the server's, not the card's guess. */
const OTHERS = 2;

const FLAGS = { like: "liked", repost: "reposted", bookmark: "bookmarked" } as const;

export function createFixtureApi(): FixtureApi {
  const state: FixtureState = { signedIn: false, problems: [], requests: [], refuse: new Set(), delayMs: 0 };
  const ok = (json: unknown): Answer => ({ status: 200, json });
  const posts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => post(from + i, state.signedIn));

  /** The answer to one GET, or null when no fixture knows the path. */
  function get(path: string, query: URLSearchParams): Answer | null {
    const cursor = query.get("cursor");
    if (path === "/api/me") return state.signedIn ? ok(me()) : { status: 401, json: { error: { code: "unauthenticated", message: "Sign in to continue." } } };
    if (path === "/api/timeline/following" || path === "/api/timeline/latest") {
      // Two pages: twenty posts and a cursor, then ten and none.
      return ok(cursor === null ? timeline(1, 20, state.signedIn, "page-2") : timeline(21, 30, state.signedIn, null));
    }
    if (path === "/api/timeline/explore") {
      const items = posts(1, 10).map((view) => ({ kind: "post" as const, post: view }));
      return ok(parse(ExplorePage, { items, nextCursor: null, computedAt: ago(5), signInForMore: !state.signedIn }, "explore"));
    }
    if (path === `/api/posts/${POST_ID}/thread`) {
      const replies = [2, 3, 5].map((n) => post(n, state.signedIn, { id: id(300 + n), replyTo: { id: POST_ID, authorHandle: GRACE.handle } }));
      return ok(parse(ThreadResponse, { ancestors: [], post: post(1, state.signedIn), replies: { items: replies, nextCursor: null } }, "thread"));
    }
    // Ada's own posts (3, 6, 9 and every third) have an Explore status for her: post 3 is listed, the others wait.
    const exploring = /^\/api\/posts\/([0-9a-f-]{36})\/explore$/.exec(path);
    if (exploring && numberOf(exploring[1]!) % 3 === 0) {
      return ok(parse(ExploreStatus, { status: exploring[1] === id(103) ? "listed" : "pending", computedAt: ago(5) }, "explore status"));
    }
    const profilePath = /^\/api\/profiles\/([a-z0-9_]+)(?:\/(posts|replies|followers|following))?$/.exec(path);
    if (profilePath) {
      const author = AUTHORS.find((a) => a.handle === profilePath[1]);
      if (!author) return null;
      const tab = profilePath[2];
      if (tab === undefined) return ok(profile(author, state.signedIn));
      if (tab === "posts") return ok(parse(TimelinePage, { items: posts(1, 12).map((view) => ({ kind: "post" as const, post: { ...view, author } })), nextCursor: null }, "profile posts"));
      if (tab === "replies") return ok(parse(PostPage, { items: [], nextCursor: null }, "replies"));
      const people = [listItem(GRACE, "Compilers, ships and the occasional heron.", state.signedIn), listItem(LINUS, "Kernels and coffee.", state.signedIn)].filter((p) => p.handle !== author.handle);
      return ok(parse(ProfilePage, { items: people, nextCursor: null }, "profile list"));
    }
    if (path === "/api/me/bookmarks") return ok(parse(PostPage, { items: posts(1, 20).map((view) => ({ ...view, viewer: { liked: false, reposted: false, bookmarked: true } })), nextCursor: null }, "bookmarks"));
    if (path === "/api/me/likes") return ok(parse(PostPage, { items: posts(5, 8), nextCursor: null }, "likes"));
    if (path === "/api/me/blocks" || path === "/api/me/mutes") return ok(parse(ProfilePage, { items: [], nextCursor: null }, "blocks"));
    const media = /^\/api\/media\/[0-9a-f-]{36}\/(small|large)\.webp$/.exec(path);
    if (media) return { status: 200, raw: FIXTURE_WEBP, type: "image/webp" };
    if (path === "/api/public/facts") return ok(FACTS);
    if (path === "/api/public/transparency") return ok(parse(PublicTransparency, { editions: [] }, "transparency"));
    if (path === "/api/public/head") return ok(parse(PublicHead, { days: [] }, "head"));
    if (path === "/api/auth/sessions") {
      return ok(parse(SessionsResponse, { sessions: [{ id: id(601), deviceLabel: "Chromium on Windows", platform: "web", createdAt: ago(600), lastUsedAt: ago(1), current: true }] }, "sessions"));
    }
    if (path === "/api/auth/passkeys") {
      return ok(parse(PasskeyListResponse, { passkeys: [{ id: id(602), name: "Laptop", createdAt: ago(60 * 24 * 20), lastUsedAt: ago(30), synced: false, createdOn: "Chromium on Windows", current: true, isNew: false, suspended: false }] }, "passkeys"));
    }
    if (path === "/api/moderation/cases") return ok(parse(AuthorCasesPage, { decisions: [], nextCursor: null, activeStrikes: 0 }, "cases"));
    if (path === "/api/moderation/reports") return ok(parse(ReportsPage, { reports: [], nextCursor: null, reportMailStopped: false }, "reports"));
    if (path === "/api/moderation/notices") return ok(parse(AuthorNoticesPage, { notices: [], nextCursor: null }, "notices"));
    if (path === `/api/moderation/decisions/${DECISION_ID}`) return ok(decision());
    if (path === `/api/moderation/releases/${RELEASE_ID}`) {
      return ok(parse(ReleaseNoticeView, { id: RELEASE_ID, basis: "period", releasedAt: ago(60), backupsClearAt: daysAhead(35), upload: false, posts: [{ id: id(103), createdAt: ago(60 * 24 * 40) }], postCount: 1, images: 1, sealDecisionId: null, appeal: "none" }, "release"));
    }
    if (path === `/api/moderation/uploads/${UPLOAD_ID}`) {
      return ok(parse(UploadRefusalView, { id: UPLOAD_ID, refusedAt: ago(120), source: "a hash list", matchKind: "exact", listedAs: "csam", objection: null, mayObject: true, endedAt: null, endAs: null, endReason: null, released: null, reportKept: false }, "upload"));
    }
    return null;
  }

  /**
   * The answer to one of the reader's actions (UI Task 4): a like, a repost or a save turned on (POST) or off (DELETE),
   * answered with the post's counts and the reader's state; a follow, with the follower count; a post deleted, with 204.
   * A kind in `refuse` is answered 503; null for any other path, which is a problem.
   */
  function action(method: string, path: string): Answer | null {
    const refused: Answer = { status: 503, json: { error: { code: "unavailable", message: "korbat is busy. Try again in a moment." } } };
    const engaged = /^\/api\/posts\/([0-9a-f-]{36})\/(like|repost|bookmark)$/.exec(path);
    if (engaged) {
      const kind = engaged[2] as keyof typeof FLAGS;
      if (state.refuse.has(kind)) return refused;
      const on = method === "POST";
      const base = post(numberOf(engaged[1]!), true);
      const counts = { ...base.counts };
      if (kind === "like") counts.likes = base.counts.likes + (on ? 1 + OTHERS : 0);
      if (kind === "repost") counts.reposts = base.counts.reposts + (on ? 1 : 0);
      return ok(parse(EngagementResponse, { counts, viewer: { ...base.viewer!, [FLAGS[kind]]: on } }, "engagement"));
    }
    const follow = /^\/api\/profiles\/([a-z0-9_]+)\/follow$/.exec(path);
    if (follow && AUTHORS.some((author) => author.handle === follow[1])) {
      if (state.refuse.has("follow")) return refused;
      const on = method === "POST";
      return ok(parse(FollowResponse, { following: on, followerCount: on ? 129 : 128 }, "follow"));
    }
    const removed = /^\/api\/posts\/([0-9a-f-]{36})$/.exec(path);
    if (removed && method === "DELETE") return state.refuse.has("delete") ? refused : { status: 204 };
    return null;
  }

  /** The answer to one POST the walk causes by reading: a report's status, and the passkey autofill's options on sign-in. */
  function post_(path: string, body: Buffer): Answer | null {
    if (path === "/api/notices/status") {
      const asked = JSON.parse(body.toString("utf8") || "{}") as { ref?: string; token?: string };
      if (asked.ref !== NOTICE_REF || asked.token !== NOTICE_TOKEN) return null;
      return ok(parse(NoticeStatus, { ref: NOTICE_REF, receivedAt: ago(60 * 24 * 2), items: [], contact: null }, "notice status"));
    }
    if (path === "/api/auth/passkey/signin/options") return ok(parse(PasskeyOptionsResponse, { options: { challenge: "Y2hhbGxlbmdlLW9mLXRoZS13YWxr", rpId: "localhost", userVerification: "required", allowCredentials: [], timeout: 300000 } }, "passkey options"));
    return null;
  }

  return {
    state,
    postStatus: (asked) => (asked === POST_ID || asked === id(103) ? 204 : 404),
    async handle(req, res, url, body) {
      const method = req.method ?? "GET";
      state.requests.push({ method, path: `${url.pathname}${url.search}`, at: Date.now() });
      let answer: Answer | null = null;
      try {
        if (method === "GET") answer = get(url.pathname, url.searchParams);
        else if (method === "POST") answer = post_(url.pathname, body) ?? action(method, url.pathname);
        else if (method === "DELETE") answer = action(method, url.pathname);
        // An action's answer waits as long as the step asks, so the step sees the card change before it lands.
        if (method !== "GET" && answer !== null && state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      } catch (err) {
        state.problems.push(`a fixture threw for ${method} ${url.pathname}: ${String(err)}`);
      }
      if (answer === null) {
        state.problems.push(`an unanswered request: ${method} ${url.pathname}${url.search}`);
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: { code: "not_found", message: "No such route" } }));
        return;
      }
      if (answer.status === 204) {
        res.writeHead(204, { "cache-control": "no-store" }).end();
        return;
      }
      if (answer.raw) {
        res.writeHead(answer.status, { "content-type": answer.type ?? "application/octet-stream", "content-length": answer.raw.length, "cache-control": "private, no-store", "x-content-type-options": "nosniff" }).end(answer.raw);
        return;
      }
      // The API's own date header: Explore ages its ranking by it.
      res.writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store", date: new Date().toUTCString() }).end(JSON.stringify(answer.json));
    },
  };
}
