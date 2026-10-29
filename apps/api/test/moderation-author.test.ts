import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { ErrorEnvelope, type PostModeration } from "@korbat/contracts";
import type { AppEnv } from "../src/env";
import { MemoryStore } from "../src/middleware/rate-limit";
import { createModeration, type CreateModerationOptions, type ModerationForSocial } from "../src/moderation";
import { decodeListCursor, encodeListCursor } from "../src/moderation/author";
import type { SocialDeps } from "../src/social";
import type { PostRow } from "../src/social/repo";
import { isTombstone, loadPostViews } from "../src/social/views";

/**
 * The author's side of moderation cases without a database (3c design, sections 5, 7.6 and 11): which source files may
 * name a report at all, that the signed-in routes refuse everyone unless the server hands them its session guard, how the
 * server wires the module, and how a post's view comes by its chip.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const read = (file: string) => readFileSync(`${SRC}/${file}`, "utf8");

describe("what the author's reads may name", () => {
  // Whatever the author sees is built from these four files: the author's routes and their queries, the statement of
  // reasons and its queries. None of them can reach a report: not who sent it, not what it said, not how many there were.
  // A statement names its source as a category only.
  const FILES = ["moderation/author.ts", "moderation/author-repo.ts", "moderation/statement.ts", "moderation/statement-repo.ts"];
  const REPORT_NAMES = /\b(intakes|intakeItems|intake_items)\b/;
  /**
   * The one read of a report table on the author's path, in the query of the measures a final decision ended: whether the
   * decision answered the case's suspect items that stood when a seal was taken while deciding, which says whether that
   * seal ended with it. It answers true or false of the case's own items, and reads no word, sender or count of a report.
   */
  const EXCEPTION = "exists (select 1 from intake_items x where x.case_id = d.case_id and x.suspect and x.answered_by = d.id and x.created_at <= i.decided_at)";
  /** The names a file imports from a module of its own folder, sorted, without `type`. */
  const importedFrom = (file: string, from: string): string[] =>
    [...read(file).matchAll(/import (?:type )?\{([^}]*)\} from "([^"]+)";/g)]
      .filter((found) => found[2] === from)
      .flatMap((found) => found[1]!.split(",").map((name) => name.trim().replace(/^type /, "")))
      .filter((name) => name.length > 0)
      .sort();

  test("the author's reads and the statement's data never name the tables of reports and notices, but for one pinned read", () => {
    for (const file of FILES) expect(REPORT_NAMES.test(read(file).replace(EXCEPTION, "")), file).toBe(false);
    // The exception stands once, in the query of the measures a final decision ended, and nowhere else.
    const queries = read("moderation/statement-repo.ts");
    expect(queries.split(EXCEPTION).length - 1).toBe(1);
    const ended = queries.slice(queries.indexOf("export async function endedMeasures"));
    expect(ended.indexOf(EXCEPTION)).toBeGreaterThan(0);
    expect(ended.indexOf(EXCEPTION)).toBeLessThan(ended.indexOf(String.fromCharCode(10) + "}"));
  });

  test("the scan catches a report's count added to the statement's data, beside the pinned read", () => {
    const queries = read("moderation/statement-repo.ts");
    const counted = queries.replace("select d.id, d.case_id,", "select d.id, (select count(*) from intake_items n where n.case_id = d.case_id) as reports, d.case_id,");
    expect(counted).not.toBe(queries);
    expect(REPORT_NAMES.test(counted.replace(EXCEPTION, ""))).toBe(true);
  });

  test("the scan catches each name, in a query, through the query builder and in a comment", () => {
    for (const source of ["sql`select count(*) from intake_items i where i.case_id = ${caseId}`", "await db.select().from(intakeItems)", "// joined with intakes for the reporter", 'sql`from "public"."intakes" n`']) {
      expect(REPORT_NAMES.test(source), source).toBe(true);
    }
    // A word that only contains a name is not the name.
    expect(REPORT_NAMES.test("const intakesSeen = 1; const reintake_items_x = 2;")).toBe(false);
  });

  test("the reporter's list is read in a file of its own, which the author's reads do not import", () => {
    expect(read("moderation/author.ts")).not.toMatch(/from "\.\/(reports|intake|repo)"/);
    expect(read("moderation/author-repo.ts")).not.toMatch(/from "\.\/(reports|intake)"/);
    // The statement takes its data from its own queries, and from the module's queries only what records its mail (3e's
    // review: with whether its suspension was withdrawn, which records it failed); its queries take only the module's helpers.
    expect(read("moderation/statement.ts")).not.toMatch(/from "\.\/(reports|intake)"/);
    expect(read("moderation/statement-repo.ts")).not.toMatch(/from "\.\/(reports|intake)"/);
    expect(importedFrom("moderation/statement.ts", "./repo")).toEqual(["MailState", "beginMailRecord", "lockPendingAuthorMail", "recordAuthorMail", "standingWithdrawn"]);
    expect(importedFrom("moderation/statement-repo.ts", "./repo")).toEqual(["Runner", "TargetType", "iso", "rows"]);
    // 3d Task 6: what found a decision's items, and whether its decider opened the image, is read in the program's own
    // queries, which answer a signal's kind and a yes or no, never a report's word, sender or count.
    expect(importedFrom("moderation/statement.ts", "./automated-repo")).toEqual(["statementSignal"]);
  });
});

describe("the module's signed-in routes", () => {
  const config = { APP_ORIGIN: "http://localhost:8081" } as CreateModerationOptions["config"];
  const untouched = new Proxy({}, { get: () => () => Promise.reject(new Error("a refused request reached a flow")) });
  const options = (extra: Partial<CreateModerationOptions> = {}): CreateModerationOptions => ({
    apiDb: untouched as CreateModerationOptions["apiDb"],
    auth: untouched as CreateModerationOptions["auth"],
    social: untouched as CreateModerationOptions["social"],
    media: untouched as CreateModerationOptions["media"],
    rateLimitStore: new MemoryStore(),
    config,
    logger: pino({ level: "silent" }),
    ...extra,
  });
  const SIGNED_IN: [string, string][] = [
    ["GET", "/api/moderation/cases"],
    ["GET", "/api/moderation/decisions/00000000-0000-4000-8000-000000000001"],
    ["GET", "/api/moderation/reports"],
    ["POST", "/api/moderation/report-mail/resume"],
    ["POST", "/api/moderation/decisions/00000000-0000-4000-8000-000000000001/appeal"],
    ["POST", "/api/moderation/items/00000000-0000-4000-8000-000000000001/reexamine"],
    // 3e Task 4: the reply to a suspension or a termination.
    ["POST", "/api/moderation/decisions/00000000-0000-4000-8000-000000000001/reply"],
    // 3d Task 2: the notices that are not decisions, and a release's notice.
    ["GET", "/api/moderation/notices"],
    ["GET", "/api/moderation/releases/00000000-0000-4000-8000-000000000001"],
    // 3d Task 6: the request for a person to look at a program's decision.
    ["POST", "/api/moderation/decisions/00000000-0000-4000-8000-000000000001/objection"],
    // 3d Task 7: a refused upload's notice, and the objection to it.
    ["GET", "/api/moderation/uploads/00000000-0000-4000-8000-000000000001"],
    ["POST", "/api/moderation/uploads/00000000-0000-4000-8000-000000000001/objection"],
  ];

  test("are the twelve of the design (3e adds the reply, 3d the notices, a release's, the request for a person and a refused upload's notice and objection), beside the four public ones", () => {
    const routes = createModeration(options()).routes.routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} ${route.path}`);
    expect([...new Set(routes)].sort()).toEqual(
      [
        "GET /moderation/cases",
        "GET /moderation/decisions/:id",
        "GET /moderation/notices",
        "GET /moderation/releases/:release",
        "GET /moderation/reports",
        "GET /moderation/uploads/:refusal",
        "POST /moderation/decisions/:id/appeal",
        "POST /moderation/decisions/:id/objection",
        "POST /moderation/decisions/:id/reply",
        "POST /moderation/items/:item/reexamine",
        "POST /moderation/report-mail/resume",
        "POST /moderation/uploads/:refusal/objection",
        "POST /notices",
        "POST /notices/contact",
        "POST /notices/reexamine",
        "POST /notices/status",
      ].sort(),
    );
  });

  test("built without the server's session guard, each refuses every request and reaches no flow", async () => {
    const app = new Hono<AppEnv>().route("/api", createModeration(options()).routes);
    for (const [method, path] of SIGNED_IN) {
      const res = await app.request(path, { method });
      expect(res.status, path).toBe(401);
      expect(ErrorEnvelope.parse(await res.json()).error.code, path).toBe("unauthenticated");
    }
  });

  test("stands behind the guard it is given: what the guard refuses reaches no flow", async () => {
    const seen: string[] = [];
    const refuse = createMiddleware<AppEnv>(async (c) => {
      seen.push(`${c.req.method} ${c.req.path}`);
      return c.json({ error: { code: "onboarding_required", message: "Choose a handle to finish setting up your account." } }, 403);
    });
    const app = new Hono<AppEnv>().route("/api", createModeration(options({ requireSession: refuse })).routes);
    for (const [method, path] of SIGNED_IN) expect((await app.request(path, { method })).status, path).toBe(403);
    expect(seen).toEqual(SIGNED_IN.map(([method, path]) => `${method} ${path}`));
  });

  test("the server hands the module its session guard, and the social module the facts for the chip", () => {
    const index = read("index.ts");
    expect(index).toMatch(/createModeration\(\{[^}]*\brequireSession: auth\.requireSession\b[^}]*\}\)/);
    // Nothing closes between the call's opening and the member: it is an option of this call.
    expect(index).toMatch(/createSocial\(\{[^}]*\bmoderation: moderation\.forSocial\b/);
  });
});

describe("the list cursors", () => {
  test("a cursor reads back as it was written, and anything else is refused", () => {
    const at = { at: "2026-10-04T10:00:00.123456Z", id: "00000000-0000-4000-8000-000000000001" };
    expect(decodeListCursor(encodeListCursor(at))).toEqual(at);
    for (const bad of ["x", Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify(["2026-10-04", at.id])).toString("base64url"), Buffer.from(JSON.stringify([at.at, "no-id"])).toString("base64url"), Buffer.from(JSON.stringify([at.at, at.id, 1])).toString("base64url")]) {
      expect(() => decodeListCursor(bad), bad).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    }
  });
});

describe("a post's chip in its view", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const ME = id(900);
  const OTHER = id(901);
  const row = (n: number, authorId: string, state: PostRow["state"], extra: Partial<PostRow> = {}): PostRow => ({
    id: id(n),
    authorId,
    body: `post ${n}`,
    replyToId: null,
    quoteOfId: null,
    state,
    likeCount: 0,
    repostCount: 0,
    replyCount: 0,
    quoteCount: 0,
    createdAt: new Date("2026-10-04T10:00:00.000Z"),
    deletedAt: null,
    author: { id: authorId, handle: authorId === ME ? "me" : "other", displayName: "A", verified: false },
    replyToHandle: null,
    replyToAuthorId: null,
    replyToState: null,
    // 3b Task 6: a native post carries no import's label.
    imported: null,
    // 2d: its counts shown.
    hideCounts: false,
    ...extra,
  });

  /** The social module's view source over rows held in memory, with a record of what the moderation module was asked. */
  function source(rows: PostRow[], facts: Record<string, PostModeration>) {
    const asked: { viewer: string; postIds: string[] }[] = [];
    const moderation: ModerationForSocial = {
      authorFacts: async (viewer, postIds) => {
        asked.push({ viewer, postIds: [...postIds] });
        return new Map(Object.entries(facts));
      },
      // 3d Task 6: the views never start the automated step; only createPost does, after its commit.
      imagesPublished: () => {
        throw new Error("a view started the automated step");
      },
    };
    const repo = {
      findPosts: async (ids: string[]) => new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r])),
      blockedEitherWay: async () => new Set<string>(),
      viewerPostStates: async (_viewer: string, ids: string[]) => new Map(ids.map((postId) => [postId, { liked: false, reposted: false, bookmarked: false }])),
      listedInExplore: async () => new Set<string>(),
      // 2d (4.3): no post of these names anyone.
      mentionsFor: async () => new Map<string, string[]>(),
    } as unknown as SocialDeps["repo"];
    const media = { forPosts: async () => new Map() } as unknown as SocialDeps["media"];
    return { asked, view: { repo, media, moderation } };
  }

  test("the viewer's own withheld and removed posts carry the decision the moderation module names, asked once for the page", async () => {
    const rows = [row(1, ME, "withheld"), row(2, ME, "removed"), row(3, ME, "visible"), row(4, OTHER, "visible")];
    const chips = { [id(1)]: { decisionId: id(51), ruleId: "R4" as const, legal: false, interim: true, strikeUntil: null }, [id(2)]: { decisionId: id(52), ruleId: null, legal: true, interim: false, strikeUntil: null } };
    const s = source(rows, chips);
    const views = await loadPostViews(s.view, ME, rows.map((r) => r.id));
    expect(s.asked).toEqual([{ viewer: ME, postIds: [id(1), id(2)] }]);
    const moderationOf = (n: number) => {
      const view = views.get(id(n))!;
      return isTombstone(view) ? "tombstone" : view.moderation;
    };
    expect(moderationOf(1)).toEqual(chips[id(1)]);
    expect(moderationOf(2)).toEqual(chips[id(2)]);
    expect(moderationOf(3)).toBeUndefined();
    expect(moderationOf(4)).toBeUndefined();
    const visible = views.get(id(3))!;
    expect("moderation" in visible).toBe(false);
  });

  test("nothing is asked for a signed-out reader, for a page of other people's posts, or for a page of the viewer's visible posts", async () => {
    const rows = [row(1, OTHER, "visible"), row(2, ME, "visible")];
    for (const viewer of [null, ME, OTHER]) {
      const s = source(rows, {});
      await loadPostViews(s.view, viewer, rows.map((r) => r.id));
      expect(s.asked, String(viewer)).toEqual([]);
    }
  });

  test("a restricted post the module names no decision for carries no chip, and a quoted embed never carries one", async () => {
    const rows = [row(1, ME, "removed"), row(2, ME, "visible", { quoteOfId: id(3) }), row(3, ME, "withheld")];
    const s = source(rows, { [id(3)]: { decisionId: id(53), ruleId: "R1", legal: false, interim: true, strikeUntil: null } });
    const views = await loadPostViews(s.view, ME, [id(1), id(2)]);
    const first = views.get(id(1))!;
    const second = views.get(id(2))!;
    if (isTombstone(first) || isTombstone(second)) throw new Error("the author sees their own posts");
    expect("moderation" in first).toBe(false);
    // The quoted post is the viewer's own and withheld: its embed shows it, without a chip of its own.
    expect(second.quoteOf).toMatchObject({ id: id(3), state: "withheld" });
    expect("moderation" in (second.quoteOf as object)).toBe(false);
    // Only the posts of the page itself are asked about.
    expect(s.asked).toEqual([{ viewer: ME, postIds: [id(1)] }]);
  });
});
