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

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Opaque to clients; anything that is not a cursor this module produced is `invalid_request`. */
export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  }
  const result = Cursor.safeParse(parsed);
  if (!result.success) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  return result.data;
}
