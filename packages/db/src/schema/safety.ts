import { sql } from "drizzle-orm";
import { bigint, bigserial, check, jsonb, pgPolicy, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, ts } from "./helpers";

/**
 * Append-only, and since 3a a hash chain (3a design, section 6): the record of every staff action. UPDATE, DELETE and
 * TRUNCATE are revoked from the API role at the grant level (migration 0001). The trigger audit_chain, which migration 0012
 * installs and the migrator owns, sets id, created_at and the four chain columns of every inserted row, whatever the insert
 * supplied, under a lock on audit_head that lasts until the inserting transaction ends: an audit row is always the last
 * statement of its transaction.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
    /** When the row joined the chain, in milliseconds: the trigger sets it. */
    createdAt: ts("created_at").notNull().defaultNow(),
    /** The handle of the staff session the action came from. */
    staffSession: uuid("staff_session"),
    /** The staff key: the one a step-up confirmed with, or the key a key's row is about. */
    keyId: uuid("key_id"),
    /** The lower-case hex sha256 of the confirmed action's sorted JSON, when a step-up confirmed it. */
    actionHash: text("action_hash"),
    /** The step-up assertion (authenticatorData, clientDataJSON, signature), base64url exactly as the browser sent them. */
    stepUp: jsonb("step_up").$type<{ authenticatorData: string; clientDataJSON: string; signature: string }>(),
    // The chain. The defaults are placeholders the trigger always overwrites: they keep drizzle's insert type from asking
    // for these columns and let migration 0012 add them over existing rows.
    /** The canonical text's version the row was hashed with. */
    chainVersion: smallint("chain_version").notNull().default(0),
    /** The row's place: the order in which inserts took the head's lock, from 1, with no gap. */
    chainSeq: bigint("chain_seq", { mode: "number" }).notNull().default(0),
    /** The hash of the row before it; 64 zeros for the first. */
    prevHash: text("prev_hash").notNull().default(""),
    /** sha256 hex of prev_hash followed by the row's canonical text. */
    hash: text("hash").notNull().default(""),
  },
  (t) => [
    // Serves the viewer and audit-verify. Migration 0012 creates it after the back-fill, which the placeholders would fail.
    uniqueIndex("audit_log_chain_seq_idx").on(t.chainSeq),
    // A step-up leaves its action's hash and its assertion together, with the key that made it.
    check("audit_log_step_up_complete", sql`(${t.actionHash} is null) = (${t.stepUp} is null) and (${t.actionHash} is null or ${t.keyId} is not null)`),
    pgPolicy("audit_log_api_insert", { for: "insert", to: apiRole, withCheck: sql`true` }),
    pgPolicy("audit_log_api_select", { for: "select", to: apiRole, using: sql`true` }),
  ],
).enableRLS();

/**
 * The newest row of the audit chain: its place and hash, or (1, 0, 64 zeros) for an empty log. One row, which only the
 * trigger moves. The API role may read it (audit-head and audit-verify check that it names the newest row) but neither write
 * nor lock it: migration 0012 revokes every other privilege, and SELECT ... FOR UPDATE needs UPDATE.
 */
export const auditHead = pgTable(
  "audit_head",
  {
    id: smallint("id").primaryKey(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [check("audit_head_single_row", sql`${t.id} = 1`), pgPolicy("audit_head_api_select", { for: "select", to: apiRole, using: sql`true` })],
).enableRLS();
