import { Readable } from "node:stream";
import { FindingRequest, MEDIA_SIZES, MediaId, QueueQuery, StaffTextSaveRequest, type CaseDecisionResponse } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AuthError, type ActiveStaffSession, type AuthForStaff, type StaffStepUpConfirmed } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { ModerationForStaff } from "../moderation";

/** A case's id in a path, in the lower case the database writes: a read finds the case by value whatever the spelling. */
const CaseId = z.uuid().transform((id) => id.toLowerCase());
const CaseParam = z.object({ case: CaseId });
const ImageParam = z.object({ case: CaseId, media: MediaId, size: z.enum(MEDIA_SIZES) });

/**
 * The console's case routes (3c design, sections 5 and 7), a route group the staff routes mount behind the staff gate.
 * Each stands behind requireStaff; one that changes something a user sees, or that cannot be undone, stands behind
 * requireStaffStepUp as well, which verifies the key's confirmation of exactly what the route is about to do. Three
 * writing routes stand without it, by name: saving a text, taking a fresh snapshot and opening a finding. None of them
 * changes anything a user sees, and each enters the record only through a confirmed decision that names its digest or
 * its case. The handlers only call the moderation module's staff interface and shape the answer: the step-up stays the
 * auth module's, the cases the moderation module's.
 */
export function caseRoutes(auth: AuthForStaff, moderation: ModerationForStaff) {
  const routes = new Hono<AppEnv>();

  /** The session requireStaff read; a route without it in front is a wiring fault, not a refusal. */
  const staffSession = (c: Context<AppEnv>): ActiveStaffSession => {
    const session = c.get("staffSession");
    if (!session) throw new Error("a staff route ran without requireStaff");
    return session;
  };

  /** The confirmation requireStaffStepUp verified; a route without it in front is a wiring fault, not a refusal. */
  const confirmedStepUp = (c: Context<AppEnv>): StaffStepUpConfirmed => {
    const confirmed = c.get("staffStepUp");
    if (!confirmed) throw new Error("a staff route that changes something ran without requireStaffStepUp");
    return confirmed;
  };

  // The home screen's numbers, the same for every staff member.
  routes.get("/overview", auth.requireStaff, async (c) => c.json(await moderation.overview()));

  // Open cases by lane and age. The console refreshes it without the activity mark.
  routes.get("/queue", auth.requireStaff, validate("query", QueueQuery), async (c) => c.json(await moderation.queue(c.req.valid("query").cursor)));

  // A moderator's own finding opens a case, or joins the target's open one: a named exception to the step-up.
  routes.post("/findings", auth.requireStaff, validate("json", FindingRequest), async (c) => c.json(await moderation.openFinding(staffSession(c), c.req.valid("json")), 201));

  // The case. Every read is written to the access log and held to the day's limit on different cases.
  routes.get("/cases/:case", auth.requireStaff, validate("param", CaseParam), async (c) => c.json(await moderation.caseView(staffSession(c), c.req.valid("param").case)));

  // An image of the case's post, on the console's own origin: the only way an image reaches the console. The moderation
  // module answers a file only when the image may be shown to staff at all and is this case's; every refusal is one 404.
  // Never stored anywhere, and always WebP, whatever the bytes are: the store's files are checked before they are
  // handed over, and nosniff with the API's own policy keeps them inert. A HEAD request never gets here: the staff group
  // answers it before any route, so no file is opened and no view logged for a request that shows nothing.
  routes.get("/cases/:case/media/:media/:size", auth.requireStaff, validate("param", ImageParam), async (c) => {
    const { case: caseId, media, size } = c.req.valid("param");
    const file = await moderation.caseImage(staffSession(c), caseId, media, size);
    c.header("Cache-Control", "private, no-store");
    c.header("Content-Type", "image/webp");
    c.header("Content-Length", String(file.size));
    // The stream closes the handle when it ends or fails.
    return c.body(Readable.toWeb(file.handle.createReadStream()) as ReadableStream<Uint8Array>);
  });

  // A fresh snapshot of the case's target as it stands: a named exception to the step-up. It answers an id and a digest,
  // never content, so every read of a case's content goes through the case's own route.
  routes.post("/cases/:case/snapshots", auth.requireStaff, validate("param", CaseParam), async (c) => c.json(await moderation.takeSnapshot(staffSession(c), c.req.valid("param").case)));

  // Saving a text: a named exception to the step-up. The text enters the record only when a confirmed decision or reveal
  // names its digest; a note and a recorded choice not to seal are complete when saved.
  routes.post("/cases/:case/texts", auth.requireStaff, validate("param", CaseParam), validate("json", StaffTextSaveRequest), async (c) =>
    c.json(await moderation.saveText(staffSession(c), c.req.valid("param").case, c.req.valid("json")), 201),
  );
  // The person's own drafts on the case, with their salts.
  routes.get("/cases/:case/texts", auth.requireStaff, validate("param", CaseParam), async (c) => c.json(await moderation.texts(staffSession(c), c.req.valid("param").case)));

  // A decision on a case: the path's case is the action's target, and the body is the action's params with the assertion
  // as `stepUp`. The decision commits with its audit row or not at all. When the confirming key or account no longer
  // opens anything by then, the session that confirmed has ended, and requireStaff clears both cookies on that answer as
  // on its own; when the challenge's time ran out, the console asks for the key again.
  routes.post(
    "/cases/:case/decisions",
    auth.requireStaff,
    auth.requireStaffStepUp("case_decided", (c) => c.req.param("case")),
    async (c) => {
      const outcome = await moderation.decide(staffSession(c), confirmedStepUp(c), { requestId: c.get("requestId") });
      if (outcome === "ended") throw new AuthError("staff_session_required", 401);
      if (outcome === "late") throw new AuthError("challenge_expired", 400);
      const answer: CaseDecisionResponse = { decisionId: outcome.decisionId };
      return c.json(answer, 201);
    },
  );

  // Who sent an item: the path's item is the action's target, and the body is the reason's category and the digest of
  // the saved reason, with the assertion as `stepUp`. The access row and the audit row commit together or not at all, and
  // the identity is read only after that commit. An ended confirmation and a late one answer as a decision's do.
  routes.post(
    "/items/:item/reveal",
    auth.requireStaff,
    auth.requireStaffStepUp("identity_revealed", (c) => c.req.param("item")),
    async (c) => {
      const outcome = await moderation.reveal(staffSession(c), confirmedStepUp(c), { requestId: c.get("requestId") });
      if (outcome === "ended") throw new AuthError("staff_session_required", 401);
      if (outcome === "late") throw new AuthError("challenge_expired", 400);
      return c.json(outcome);
    },
  );

  return routes;
}
