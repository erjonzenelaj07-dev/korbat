import { CONTACT_PAGE_SIZE, type ContactCloseRequest, type ContactPage, type ContactQuery, type StaffOverview } from "@korbat/contracts";
import type { ActiveStaffSession } from "../auth";
import { appendAuditRow } from "../staff";
import { ModerationError, type ModerationDeps } from "./context";
import { closeMessage, contactCounts, contactMessages, messageExists } from "./orders-repo";

/**
 * Authorities' orders (3f design, sections 5, 7.3 and 8.3). In this task: the messages at the contact point. The watcher
 * records that a message arrived and when, and never who sent it or what it says; a person reads it in the mail host's own
 * app, and then either opens an order from it (Task 2) or closes it here with what it was. Closing restricts nothing and
 * tells nobody, so it needs no key: one transaction, the disposition and then the audit row `contact_closed`.
 */

const PLACE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The list's cursor: the last row's time of receipt to the microsecond and its id, as an opaque word. */
const encodeCursor = (row: { place: string; id: string }): string => Buffer.from(JSON.stringify([row.place, row.id]), "utf8").toString("base64url");

/** Reads a cursor back; anything this module did not write is refused, never guessed at. */
function decodeCursor(cursor: string): { place: string; id: string } {
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ModerationError("invalid_request");
  }
  if (!Array.isArray(parts) || parts.length !== 2) throw new ModerationError("invalid_request");
  const [place, id] = parts as unknown[];
  if (typeof place !== "string" || !PLACE.test(place) || typeof id !== "string" || !UUID.test(id)) throw new ModerationError("invalid_request");
  return { place, id };
}

/**
 * GET /api/staff/contact: the messages newest first by the time of receipt, CONTACT_PAGE_SIZE a page; with open=1 only
 * those without a disposition. No sender and no subject exist to show. A message's orders are Task 2's.
 */
export async function contactPage(deps: Pick<ModerationDeps, "apiDb">, query: ContactQuery): Promise<ContactPage> {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  // One row more than a page, to know whether another page follows.
  const rows = await contactMessages(deps.apiDb, { open: query.open === "1", after, limit: CONTACT_PAGE_SIZE + 1 });
  const page = rows.slice(0, CONTACT_PAGE_SIZE);
  return {
    items: page.map((row) => ({
      id: row.id,
      folder: row.folder,
      receivedAt: row.receivedAt.toISOString(),
      seenAt: row.seenAt.toISOString(),
      stale: row.stale,
      disposition: row.disposition,
      handledAt: row.handledAt === null ? null : row.handledAt.toISOString(),
      handledBy: row.handledBy,
      orders: [],
    })),
    nextCursor: rows.length > CONTACT_PAGE_SIZE ? encodeCursor(page.at(-1)!) : null,
  };
}

/**
 * POST /api/staff/contact/:message/close (section 7.3 step 3): the disposition and who set it, only while the message has
 * none (the trigger stamps when), then the audit row, last, with the disposition, the time of receipt and the folder. A
 * message that has a disposition already is message_handled, and a disposition never changes; an unknown id is
 * not_found.
 */
export async function closeContact(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, messageId: string, request: ContactCloseRequest, ctx: { requestId: string }): Promise<void> {
  await deps.apiDb.transaction(async (tx) => {
    const closed = await closeMessage(tx, messageId, request.disposition, session.userId);
    if (closed === null) throw new ModerationError((await messageExists(tx, messageId)) ? "message_handled" : "not_found");
    await appendAuditRow(tx, {
      actorId: session.userId,
      action: "contact_closed",
      targetType: "contact_message",
      targetId: messageId,
      requestId: ctx.requestId,
      staffSession: session.handle,
      metadata: { disposition: request.disposition, receivedAt: closed.receivedAt.toISOString(), folder: closed.folder },
    });
  });
}

/** StaffOverview.contact: the messages nobody has handled, the oldest one's time of receipt and the earliest deadline. */
export async function contactOverview(deps: Pick<ModerationDeps, "apiDb">): Promise<StaffOverview["contact"]> {
  const counts = await contactCounts(deps.apiDb);
  return { open: counts.open, oldestAt: counts.oldestAt?.toISOString() ?? null, dueAt: counts.dueAt?.toISOString() ?? null };
}
