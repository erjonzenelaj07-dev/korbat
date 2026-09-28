import { z } from "zod";
import { SocialError } from "./context";

/**
 * A keyset cursor: the sort time in epoch milliseconds, the post id, and for repost items the
 * reposter id. Every timestamp the repository writes has millisecond precision (it passes the
 * clock's Date instead of relying on the database default), so the cursor round-trips exactly.
 */
/** The largest time a JavaScript Date can hold; anything above it is not a cursor this module produced. */
export const MAX_CURSOR_TIME = 8_640_000_000_000_000;

const Cursor = z.strictObject({
  t: z.number().int().min(0).max(MAX_CURSOR_TIME),
  id: z.uuid(),
  r: z.uuid().optional(),
});
export type Cursor = z.infer<typeof Cursor>;

/** The largest generation explore_runs can number (an integer column), so a forged one can never overflow the query. */
export const MAX_GENERATION = 2_147_483_647;

/**
 * Explore's own cursor (2c design, section 8): the ranking a reader is paging through and the last post they read, never a
 * position, so it tells nothing about a post's place beyond the order already shown. A ranking cannot be paged by time,
 * so the timeline cursor cannot carry it, and neither cursor is accepted for the other.
 */
const ExploreCursor = z.strictObject({
  g: z.number().int().min(1).max(MAX_GENERATION),
  id: z.uuid(),
});
export type ExploreCursor = z.infer<typeof ExploreCursor>;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Opaque to clients; anything that is not a cursor this module produced is `invalid_request`. */
function decode<T>(raw: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  return result.data;
}

export function encodeCursor(cursor: Cursor): string {
  return encode(cursor);
}

export function decodeCursor(raw: string): Cursor {
  return decode(raw, Cursor);
}

export function encodeExploreCursor(cursor: ExploreCursor): string {
  return encode(cursor);
}

export function decodeExploreCursor(raw: string): ExploreCursor {
  return decode(raw, ExploreCursor);
}
