import { createHash } from "node:crypto";

/**
 * The audit chain's canonical text in Node (3a design, section 6). The text is defined once, in the design, and written
 * twice: in SQL by migration 0012's public.audit_chain_text, which the trigger hashes every row with, and here, which
 * audit-verify recomputes every row with. Nothing here asks the database for a text or a hash, since whoever owns the
 * database can replace its functions.
 */

/** The first row's prev_hash, and the hash of an empty log's head: 64 zeros. */
export const CHAIN_ZERO_HASH = "0".repeat(64);

/**
 * A row of the audit log as the chain covers it. `metadataText` and `stepUpText` are the stored jsonb exactly as
 * PostgreSQL prints it (a `::text` cast: jsonb's own key order, ", " and ": " between items), which the text embeds as it
 * is and never re-serialises. `createdAt` is the row's time, which the trigger truncated to the millisecond.
 */
export interface ChainRow {
  chainVersion: number;
  chainSeq: number;
  id: number;
  createdAt: Date;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  staffSession: string | null;
  keyId: string | null;
  actionHash: string | null;
  stepUpText: string | null;
  metadataText: string;
}

/** A column as a JSON string, escaped as JSON.stringify escapes it (which to_json(text) agrees with), or null. */
const jsonString = (value: string | null): string => (value === null ? "null" : JSON.stringify(value));

/**
 * The canonical text of a row: a JSON array without whitespace between its elements. chain_version, chain_seq and id as
 * decimal integers; created_at in UTC as "YYYY-MM-DDTHH:MM:SS.mmmZ"; the actor, the action, the target's type and id, the
 * request id, the staff session's handle, the key and the action's hash, each a JSON string or null (uuids as PostgreSQL
 * prints them, in lower case); then step_up and last metadata, as stored. Only version 1 exists: a version this code does
 * not know is refused rather than hashed as another, and a later version is added here and in SQL together.
 */
export function canonicalText(row: ChainRow): string {
  if (row.chainVersion !== 1) throw new Error(`audit chain version ${row.chainVersion} is not known`);
  return `[${[
    String(row.chainVersion),
    String(row.chainSeq),
    String(row.id),
    jsonString(row.createdAt.toISOString()),
    jsonString(row.actorId),
    jsonString(row.action),
    jsonString(row.targetType),
    jsonString(row.targetId),
    jsonString(row.requestId),
    jsonString(row.staffSession),
    jsonString(row.keyId),
    jsonString(row.actionHash),
    row.stepUpText ?? "null",
    row.metadataText,
  ].join(",")}]`;
}

/**
 * A row's hash: the lower-case hex sha256 of the UTF-8 bytes of the previous row's hash followed by the row's text, as
 * the trigger computes it with convert_to(..., 'UTF8').
 */
export function chainHash(prevHash: string, text: string): string {
  return createHash("sha256").update(prevHash + text, "utf8").digest("hex");
}
