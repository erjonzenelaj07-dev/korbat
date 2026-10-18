import { describe, expect, test } from "vitest";
import { is, type SQL } from "drizzle-orm";
import { PgDialect, PgTable, getTableConfig, pgTable } from "drizzle-orm/pg-core";
import { apiRole, authRole, bytea, notifyRole, xid8 } from "../src/schema/helpers";
import * as schema from "../src/schema/index";

const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
const byName = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));

describe("auth schema", () => {
  test("auth tables live in the auth schema", () => {
    for (const name of ["users", "devices", "sessions", "email_codes", "passkeys", "auth_events"]) {
      expect(byName.get(name)?.schema, name).toBe("auth");
    }
  });
  test("sessions store only a hash id and carry both expiries", () => {
    const cols = byName.get("sessions")!.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "user_id", "device_id", "expires_at", "absolute_expires_at", "reauth_at", "revoked_at"]));
  });
});

describe("row level security", () => {
  test("every table has RLS enabled and at least one policy", () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      expect(cfg.enableRLS, cfg.name).toBe(true);
      expect(cfg.policies.length, cfg.name).toBeGreaterThan(0);
    }
  });
});

describe("content schema", () => {
  test("posts carry a state enum and a body length check", () => {
    const cfg = byName.get("posts")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(cfg.columns.find((c) => c.name === "state")?.notNull).toBe(true);
    expect(cfg.checks.map((c) => c.name)).toContain("posts_body_len");
  });
  test("join tables have composite primary keys", () => {
    for (const name of ["follows", "likes", "reposts", "bookmarks", "blocks", "mutes"]) {
      expect(byName.get(name)!.primaryKeys.length, name).toBe(1);
      expect(byName.get(name)!.primaryKeys[0]!.columns.length, name).toBe(2);
    }
  });
});

describe("trust and safety schema", () => {
  test("there are 46 tables in total", () => {
    // 28 before 3c, minus the five retired tables, plus the twelve moderation tables and the four auth tables; then 3e's
    // three: suspension_replies, unfounded_marks and report_tallies; then 3f's first four: contact_messages, alert_outbox,
    // notify_state and notify_folders.
    expect(tables.length).toBe(46);
  });
  test("the tables 3c retired are gone, with their enums and the reputation column", () => {
    for (const name of ["reports", "strikes", "transparency_log"]) expect(byName.has(name), name).toBe(false);
    for (const name of ["targetType", "reportStatus", "caseAction", "appealStatus", "reports", "strikes", "transparencyLog"]) {
      expect(Object.keys(schema), name).not.toContain(name);
    }
    expect(byName.get("profiles")!.columns.map((c) => c.name)).not.toContain("reputation");
  });
  test("audit_log policies allow only insert and select", () => {
    const kinds = byName.get("audit_log")!.policies.map((p) => p.for).sort();
    expect(kinds).toEqual(["insert", "select"]);
  });
});

describe("identity and auth 1a", () => {
  test("users carry role, age, terms, onboarding and TOTP replay columns", () => {
    const cols = byName.get("users")!.columns;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["role", "age_confirmed_at", "terms_version", "terms_accepted_at", "onboarded_at", "password_changed_at", "totp_last_step"]),
    );
    expect(cols.find((c) => c.name === "role")?.notNull).toBe(true);
  });
  test("email codes are bound to a unique flow id", () => {
    const cfg = byName.get("email_codes")!;
    expect(cfg.columns.find((c) => c.name === "flow_id")?.notNull).toBe(true);
    expect(cfg.indexes.find((i) => i.config.name === "email_codes_flow_idx")?.config.unique).toBe(true);
  });
  test("auth_events policies allow only insert and select", () => {
    expect(byName.get("auth_events")?.policies.map((p) => p.for).sort()).toEqual(["insert", "select"]);
  });
  test("email code purposes include reauth", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("reauth");
  });
});

describe("posting and feed 2a", () => {
  test("posts and profiles carry non-negative counters, and posts a deletion time", () => {
    const posts = byName.get("posts")!;
    const postCols = posts.columns.map((c) => c.name);
    expect(postCols).toEqual(expect.arrayContaining(["like_count", "repost_count", "reply_count", "quote_count", "deleted_at"]));
    for (const name of ["like_count", "repost_count", "reply_count", "quote_count"]) {
      expect(posts.columns.find((c) => c.name === name)?.notNull, name).toBe(true);
    }
    expect(posts.checks.map((c) => c.name)).toContain("posts_counts_nonnegative");
    const profiles = byName.get("profiles")!;
    expect(profiles.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["follower_count", "following_count", "post_count"]));
    expect(profiles.checks.map((c) => c.name)).toContain("profiles_counts_nonnegative");
  });
  test("per-account engagement lists and quote lookups have indexes", () => {
    for (const name of ["likes", "reposts", "bookmarks"]) {
      const idx = byName.get(name)!.indexes.find((i) => i.config.name === `${name}_user_created_idx`);
      expect(idx?.config.columns.length, name).toBe(2);
    }
    expect(byName.get("posts")!.indexes.map((i) => i.config.name)).toContain("posts_quote_of_idx");
  });
});

describe("images 2b", () => {
  test("post_media has no path column, and its attachment and dimension columns are optional", () => {
    const cols = byName.get("post_media")!.columns;
    expect(cols.map((c) => c.name)).not.toContain("path");
    for (const name of ["post_id", "position", "width", "height", "blurhash"]) {
      expect(cols.find((c) => c.name === name)?.notNull, name).toBe(false);
    }
  });
  test("every upload has an owner, a status and a creation time; a failure has a reason", () => {
    const cols = byName.get("post_media")!.columns;
    for (const name of ["owner_id", "status", "created_at"]) expect(cols.find((c) => c.name === name)?.notNull, name).toBe(true);
    expect(cols.find((c) => c.name === "error")?.notNull).toBe(false);
    expect(cols.find((c) => c.name === "status")?.default).toBe("processing");
    expect(schema.mediaStatus.enumValues).toEqual(["processing", "ready", "failed"]);
  });
  test("the database itself refuses a ready image without dimensions and an attached image that is incomplete", () => {
    const cfg = byName.get("post_media")!;
    expect(cfg.checks.map((c) => c.name).sort()).toEqual(["post_media_alt_len", "post_media_attached_is_complete", "post_media_ready_has_dims"]);
    expect(cfg.indexes.map((i) => i.config.name).sort()).toEqual(["post_media_owner_created_idx", "post_media_post_position_idx", "post_media_status_created_idx"]);
    expect(cfg.indexes.find((i) => i.config.name === "post_media_post_position_idx")?.config.unique).toBe(true);
  });
});

describe("account lifecycle 1b", () => {
  test("handle_history reserves every lowercase handle a profile ever had, and goes with the profile", () => {
    const cfg = byName.get("handle_history")!;
    expect(cfg.schema).toBeUndefined(); // public
    // retired_at (3e design, section 6.1): set only by a retirement in the ledger, forced null at insert.
    expect(cfg.columns.map((c) => c.name)).toEqual(["handle_lower", "profile_id", "changed_at", "retired_at"]);
    expect(cfg.columns.find((c) => c.name === "retired_at")?.notNull).toBe(false);
    expect(cfg.columns.find((c) => c.name === "retired_at")?.hasDefault).toBe(false);
    expect(cfg.columns.find((c) => c.name === "handle_lower")?.primary).toBe(true);
    expect(cfg.columns.find((c) => c.name === "profile_id")?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === "changed_at")?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === "changed_at")?.hasDefault).toBe(true);
    const fk = cfg.foreignKeys.map((k) => ({ table: getTableConfig(k.reference().foreignTable).name, columns: k.reference().foreignColumns.map((c) => c.name), onDelete: k.onDelete }));
    expect(fk).toEqual([{ table: "profiles", columns: ["id"], onDelete: "cascade" }]);
    expect(cfg.policies.map((p) => [p.name, p.for])).toEqual([["handle_history_api_all", "all"]]);
  });
  test("profiles record when the handle last changed; users record when their purge finished", () => {
    const handleChangedAt = byName.get("profiles")!.columns.find((c) => c.name === "handle_changed_at");
    expect(handleChangedAt).toBeDefined();
    expect(handleChangedAt?.notNull).toBe(false);
    const purgedAt = byName.get("users")!.columns.find((c) => c.name === "purged_at");
    expect(purgedAt).toBeDefined();
    expect(purgedAt?.notNull).toBe(false);
  });
  test("one phone per account: a unique index on phone_hash that leaves out the accounts without one", () => {
    const idx = byName.get("users")!.indexes.find((i) => i.config.name === "users_phone_hash_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["phone_hash"]);
    expect(idx?.config.where).toBeDefined();
  });
  test("email codes can be for deleting the account, and every account event of 1b has a type", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("delete_account");
    const values = schema.authEventType.enumValues;
    expect(values.slice(values.indexOf("not_me"), values.indexOf("account_deleted") + 1)).toEqual([
      "not_me",
      "profile_updated",
      "handle_changed",
      "email_changed",
      "badge_verified",
      "badge_removed",
      "export_created",
      "account_deleted",
    ]);
  });
});

describe("passkeys 1c", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** The foreign keys of one local column: the table and columns they point at and what a delete there does. */
  const foreignKeys = (table: string, name: string) =>
    byName
      .get(table)!
      .foreignKeys.filter((k) => k.reference().columns.some((c) => c.name === name))
      .map((k) => ({ table: getTableConfig(k.reference().foreignTable).name, columns: k.reference().foreignColumns.map((c) => c.name), onDelete: k.onDelete }));

  test("bytea is the bytea SQL type and hands Buffers both ways", () => {
    const table = pgTable("bytea_probe", { value: bytea("value") });
    const probe = getTableConfig(table).columns[0]!;
    expect(probe.getSQLType()).toBe("bytea");
    const bytes = Buffer.from([0, 1, 254, 255]);
    expect(probe.mapToDriverValue(bytes)).toEqual(bytes);
    // postgres.js already parses bytea into a Buffer; a driver that answers a plain Uint8Array gets one too.
    const read = probe.mapFromDriverValue(new Uint8Array([0, 1, 254, 255]));
    expect(Buffer.isBuffer(read)).toBe(true);
    expect(read).toEqual(bytes);
    expect(probe.mapFromDriverValue(bytes)).toEqual(bytes);
  });

  test("users carry an optional WebAuthn user handle in bytea, unique among the accounts that have one", () => {
    const handle = column("users", "webauthn_user_id");
    expect(handle?.getSQLType()).toBe("bytea");
    expect(handle?.notNull).toBe(false);
    expect(handle?.hasDefault).toBe(false);
    const idx = byName.get("users")!.indexes.find((i) => i.config.name === "users_webauthn_user_id_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["webauthn_user_id"]);
    expect(idx?.config.where).toBeDefined();
  });

  test("passkeys record the AAGUID, the backup and verification flags, the creating device and a suspected copy", () => {
    expect(column("passkeys", "aaguid")?.getSQLType()).toBe("uuid");
    expect(column("passkeys", "aaguid")?.notNull).toBe(false);
    for (const name of ["backup_eligible", "uv_initialized"]) {
      expect(column("passkeys", name)?.getSQLType(), name).toBe("boolean");
      expect(column("passkeys", name)?.notNull, name).toBe(true);
      expect(column("passkeys", name)?.default, name).toBe(false);
    }
    expect(column("passkeys", "created_device_id")?.getSQLType()).toBe("uuid");
    expect(column("passkeys", "created_device_id")?.notNull).toBe(false);
    expect(foreignKeys("passkeys", "created_device_id")).toEqual([{ table: "devices", columns: ["id"], onDelete: "set null" }]);
    expect(column("passkeys", "suspect_at")?.getSQLType()).toBe("timestamp with time zone");
    expect(column("passkeys", "suspect_at")?.notNull).toBe(false);
    // One row per credential: the index the foundation created stays.
    const idx = byName.get("passkeys")!.indexes.find((i) => i.config.name === "passkeys_credential_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["credential_id"]);
  });

  test("sessions carry a random handle that is unique, the factors they proved and the passkey that started them", () => {
    const handle = column("sessions", "handle");
    expect(handle?.getSQLType()).toBe("uuid");
    expect(handle?.notNull).toBe(true);
    expect(handle?.hasDefault).toBe(true);
    const idx = byName.get("sessions")!.indexes.find((i) => i.config.name === "sessions_handle_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["handle"]);
    const factors = column("sessions", "factors");
    expect(factors?.getSQLType()).toBe("jsonb");
    expect(factors?.notNull).toBe(true);
    expect(factors?.hasDefault).toBe(true);
    expect(column("sessions", "passkey_id")?.notNull).toBe(false);
    expect(foreignKeys("sessions", "passkey_id")).toEqual([{ table: "passkeys", columns: ["id"], onDelete: "set null" }]);
  });

  test("adding, removing and a counter regression of a passkey are security events", () => {
    const values = schema.authEventType.enumValues;
    // The slice ends at 1c's last value: 3a appends the staff events after it.
    expect(values.slice(values.indexOf("account_deleted"), values.indexOf("passkey_counter_regression") + 1)).toEqual([
      "account_deleted",
      "passkey_added",
      "passkey_removed",
      "passkey_counter_regression",
    ]);
  });
});

describe("explore 2c", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  /** Every foreign key of a table by its local column: the table and columns it points at and what a delete there does. */
  const foreignKeys = (table: string) =>
    Object.fromEntries(
      byName.get(table)!.foreignKeys.map((k) => {
        const ref = k.reference();
        return [ref.columns.map((c) => c.name).join(","), { table: getTableConfig(ref.foreignTable).name, columns: ref.foreignColumns.map((c) => c.name), onDelete: k.onDelete }];
      }),
    );
  const indexColumns = (config: { columns: unknown[] }) => config.columns.map((c) => (c as { name?: string }).name);

  test("profiles carry the author's Explore switch, on by default", () => {
    const flag = column("profiles", "show_in_explore");
    expect(flag?.getSQLType()).toBe("boolean");
    expect(flag?.notNull).toBe(true);
    expect(flag?.default).toBe(true);
  });

  test("explore_runs numbers each ranking with an identity and records its time, formula, counts and duration", () => {
    const cfg = byName.get("explore_runs")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(shape("explore_runs")).toEqual([
      ["generation", "integer", true],
      ["as_of", "timestamp with time zone", true],
      ["formula", "smallint", true],
      ["candidates", "integer", true],
      ["items", "integer", true],
      ["took_ms", "integer", true],
    ]);
    const generation = column("explore_runs", "generation");
    expect(generation?.primary).toBe(true);
    // Always generated: an insert cannot choose its generation, so the numbers come from the sequence alone.
    expect(generation?.generatedIdentity?.type).toBe("always");
    // The refresh writes every other value itself, the refresh time included, which tests move.
    expect(cfg.columns.filter((c) => c.hasDefault).map((c) => c.name)).toEqual(["generation"]);
    expect(cfg.foreignKeys).toEqual([]);
  });

  test("explore_items holds a ranking's posts by position, each post once, and goes with its ranking, its post or its author", () => {
    const cfg = byName.get("explore_items")!;
    expect(cfg.schema).toBeUndefined(); // public
    // No score or count is stored: the position is the order.
    expect(shape("explore_items")).toEqual([
      ["generation", "integer", true],
      ["position", "integer", true],
      ["post_id", "uuid", true],
      ["author_id", "uuid", true],
    ]);
    expect(cfg.primaryKeys.map((k) => k.columns.map((c) => c.name))).toEqual([["generation", "position"]]);
    expect(cfg.indexes.map((i) => [i.config.name, indexColumns(i.config), i.config.unique])).toEqual([["explore_items_generation_post_idx", ["generation", "post_id"], true]]);
    expect(foreignKeys("explore_items")).toEqual({
      generation: { table: "explore_runs", columns: ["generation"], onDelete: "cascade" },
      post_id: { table: "posts", columns: ["id"], onDelete: "cascade" },
      author_id: { table: "profiles", columns: ["id"], onDelete: "cascade" },
    });
  });

  test("both tables have row level security and one full-access policy for the API role", () => {
    // The loop under "row level security" covers them too; this pins the policy each one has.
    for (const name of ["explore_runs", "explore_items"]) {
      const cfg = byName.get(name)!;
      expect(cfg.enableRLS, name).toBe(true);
      expect(cfg.policies.map((p) => [p.name, p.for, p.to]), name).toEqual([[`${name}_api_all`, "all", apiRole]]);
    }
  });

  test("likes and reposts have a BRIN index on created_at for the refresh's window; bookmarks, which Explore never reads, has none", () => {
    for (const name of ["likes", "reposts"]) {
      const brin = byName.get(name)!.indexes.filter((i) => i.config.method === "brin");
      expect(brin.map((i) => [i.config.name, indexColumns(i.config), i.config.unique, i.config.where]), name).toEqual([[`${name}_created_brin`, ["created_at"], false, undefined]]);
    }
    expect(byName.get("bookmarks")!.indexes.filter((i) => i.config.method === "brin")).toEqual([]);
    // The factory's other indexes stay the same on all three tables.
    for (const name of ["likes", "reposts", "bookmarks"]) {
      const others = byName.get(name)!.indexes.filter((i) => i.config.method !== "brin");
      expect(others.map((i) => [i.config.name, i.config.method]).sort(), name).toEqual([
        [`${name}_post_idx`, "btree"],
        [`${name}_user_created_idx`, "btree"],
      ]);
    }
  });
});

describe("staff console 3a", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  /** Every foreign key of a table by its local columns: the table and columns it points at and what a delete there does. */
  const foreignKeys = (table: string) =>
    Object.fromEntries(
      byName.get(table)!.foreignKeys.map((k) => {
        const ref = k.reference();
        return [ref.columns.map((c) => c.name).join(","), { table: getTableConfig(ref.foreignTable).name, columns: ref.foreignColumns.map((c) => c.name), onDelete: k.onDelete }];
      }),
    );
  /** Every index as its name, its columns and whether it is unique, by name. */
  const indexes = (table: string) =>
    byName
      .get(table)!
      .indexes.map((i) => [i.config.name, i.config.columns.map((c) => (c as { name?: string }).name), i.config.unique])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const uniques = (table: string) => byName.get(table)!.uniqueConstraints.map((u) => [u.getName(), u.columns.map((c) => c.name)]);
  const checks = (table: string) => byName.get(table)!.checks.map((c) => c.name).sort();
  const policies = (table: string) => byName.get(table)!.policies.map((p) => [p.name, p.for, p.to]);

  test("the seven staff events close the auth event type, after 1c's passkey events", () => {
    const values = schema.authEventType.enumValues;
    expect(values.slice(values.indexOf("passkey_counter_regression") + 1)).toEqual([
      "staff_enrollment_issued",
      "staff_key_added",
      "staff_key_revoked",
      "staff_key_counter_regression",
      "staff_sign_in",
      "staff_signed_out",
      "staff_session_revoked",
    ]);
  });

  test("the three staff tables live in the auth schema, with row level security and one policy for the auth role", () => {
    for (const name of ["staff_keys", "staff_enrollments", "staff_sessions"]) {
      const cfg = byName.get(name)!;
      expect(cfg.schema, name).toBe("auth");
      expect(cfg.enableRLS, name).toBe(true);
      expect(policies(name), name).toEqual([[`${name}_auth_all`, "all", authRole]]);
    }
  });

  test("a staff key records its credential, its origin and relying party ID, its dates and whether it was revoked or suspect", () => {
    expect(shape("staff_keys")).toEqual([
      ["id", "uuid", true],
      ["user_id", "uuid", true],
      ["credential_id", "text", true],
      ["public_key", "text", true],
      ["counter", "bigint", true],
      ["transports", "text[]", true],
      ["name", "text", true],
      ["aaguid", "uuid", false],
      ["origin", "text", true],
      ["rp_id", "text", true],
      ["created_at", "timestamp with time zone", true],
      ["last_used_at", "timestamp with time zone", false],
      ["revoked_at", "timestamp with time zone", false],
      ["suspect_at", "timestamp with time zone", false],
    ]);
    // No user handle of its own: staff registrations use the account's webauthn_user_id.
    expect(column("staff_keys", "user_handle")).toBeUndefined();
    // The development cleaner deletes accounts as the superuser; a key must stop that delete, never go with it.
    expect(foreignKeys("staff_keys")).toEqual({ user_id: { table: "users", columns: ["id"], onDelete: "restrict" } });
    expect(indexes("staff_keys")).toEqual([
      ["staff_keys_credential_idx", ["credential_id"], true],
      ["staff_keys_user_idx", ["user_id"], false],
    ]);
    // The pair the staff sessions' foreign key names.
    expect(uniques("staff_keys")).toEqual([["staff_keys_id_user_id_unique", ["id", "user_id"]]]);
    expect(checks("staff_keys")).toEqual(["staff_keys_suspect_is_revoked"]);
  });

  test("an enrolment keeps only its token's hash, the console it was issued for, its expiry and when it was used", () => {
    expect(shape("staff_enrollments")).toEqual([
      ["id", "uuid", true],
      ["user_id", "uuid", true],
      ["token_hash", "text", true],
      ["origin", "text", true],
      ["rp_id", "text", true],
      ["created_at", "timestamp with time zone", true],
      ["expires_at", "timestamp with time zone", true],
      ["used_at", "timestamp with time zone", false],
    ]);
    expect(foreignKeys("staff_enrollments")).toEqual({ user_id: { table: "users", columns: ["id"], onDelete: "cascade" } });
    expect(indexes("staff_enrollments")).toEqual([
      ["staff_enrollments_token_hash_idx", ["token_hash"], true],
      ["staff_enrollments_user_idx", ["user_id"], false],
    ]);
  });

  test("a staff session keeps its token's hash, a unique handle, its key and account together, both expiries and the browser label", () => {
    expect(shape("staff_sessions")).toEqual([
      ["id", "text", true],
      ["handle", "uuid", true],
      ["user_id", "uuid", true],
      ["key_id", "uuid", true],
      ["created_at", "timestamp with time zone", true],
      ["last_used_at", "timestamp with time zone", true],
      ["idle_expires_at", "timestamp with time zone", true],
      ["absolute_expires_at", "timestamp with time zone", true],
      ["revoked_at", "timestamp with time zone", false],
      ["browser", "text", true],
    ]);
    expect(column("staff_sessions", "id")?.primary).toBe(true);
    expect(column("staff_sessions", "handle")?.hasDefault).toBe(true);
    // The key's foreign key names the account as well, so a session's key always belongs to its account.
    expect(foreignKeys("staff_sessions")).toEqual({
      user_id: { table: "users", columns: ["id"], onDelete: "cascade" },
      "key_id,user_id": { table: "staff_keys", columns: ["id", "user_id"], onDelete: "cascade" },
    });
    expect(indexes("staff_sessions")).toEqual([
      ["staff_sessions_handle_idx", ["handle"], true],
      ["staff_sessions_user_idx", ["user_id"], false],
    ]);
    expect(checks("staff_sessions")).toEqual(["staff_sessions_lifetime"]);
  });

  test("audit_log gains the staff session's handle, the key, the action's hash and the step-up, all optional", () => {
    const added = [
      ["staff_session", "uuid"],
      ["key_id", "uuid"],
      ["action_hash", "text"],
      ["step_up", "jsonb"],
    ] as const;
    for (const [name, type] of added) {
      expect(column("audit_log", name)?.getSQLType(), name).toBe(type);
      expect(column("audit_log", name)?.notNull, name).toBe(false);
      expect(column("audit_log", name)?.hasDefault, name).toBe(false);
    }
    expect(checks("audit_log")).toEqual(["audit_log_step_up_complete"]);
  });

  test("audit_log's chain columns are not null, with placeholder defaults that the trigger always overwrites", () => {
    const chain = [
      ["chain_version", "smallint", 0],
      ["chain_seq", "bigint", 0],
      ["prev_hash", "text", ""],
      ["hash", "text", ""],
    ] as const;
    for (const [name, type, placeholder] of chain) {
      expect(column("audit_log", name)?.getSQLType(), name).toBe(type);
      expect(column("audit_log", name)?.notNull, name).toBe(true);
      expect(column("audit_log", name)?.default, name).toBe(placeholder);
    }
    // One index serves the viewer and audit-verify; there is none on (created_at, id).
    expect(indexes("audit_log")).toEqual([["audit_log_chain_seq_idx", ["chain_seq"], true]]);
  });

  test("audit_head holds one row, the newest place and hash, which the API role may only read", () => {
    const cfg = byName.get("audit_head")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(shape("audit_head")).toEqual([
      ["id", "smallint", true],
      ["seq", "bigint", true],
      ["hash", "text", true],
    ]);
    expect(column("audit_head", "id")?.primary).toBe(true);
    expect(cfg.columns.filter((c) => c.hasDefault)).toEqual([]);
    expect(checks("audit_head")).toEqual(["audit_head_single_row"]);
    expect(cfg.enableRLS).toBe(true);
    expect(policies("audit_head")).toEqual([["audit_head_api_select", "select", apiRole]]);
  });
});

describe("moderation cases 3c", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  const checks = (table: string) => byName.get(table)!.checks.map((c) => c.name).sort();
  const policies = (table: string) => byName.get(table)!.policies.map((p) => [p.name, p.for, p.to]);
  const index = (table: string, name: string) => byName.get(table)!.indexes.find((i) => i.config.name === name)?.config;
  const indexColumns = (config: { columns: unknown[] } | undefined) => config?.columns.map((c) => (c as { name?: string }).name);
  /** An index's predicate as the SQL the migration holds. */
  const predicate = (config: { where?: SQL } | undefined) => (config?.where ? new PgDialect().sqlToQuery(config.where).sql : undefined);
  /** Every foreign key of a table by its local columns: the table and columns it points at and what a delete there does. */
  const foreignKeys = (table: string) =>
    Object.fromEntries(
      byName.get(table)!.foreignKeys.map((k) => {
        const ref = k.reference();
        return [ref.columns.map((c) => c.name).join(","), { table: getTableConfig(ref.foreignTable).name, columns: ref.foreignColumns.map((c) => c.name), onDelete: k.onDelete }];
      }),
    );
  /** The columns declared unique by themselves, each with the name of its constraint. */
  const uniques = (table: string) =>
    byName
      .get(table)!
      .columns.filter((c) => c.isUnique)
      .map((c) => [c.uniqueName, [c.name]])
      .sort();

  /** A check's expression as the migration holds it. */
  const checkSql = (table: string, name: string) => new PgDialect().sqlToQuery(byName.get(table)!.checks.find((c) => c.name === name)!.value).sql;

  const MODERATION_TABLES = ["cases", "intakes", "intake_items", "decisions", "decision_actions", "seal_posts", "appeals", "staff_texts", "evidence_snapshots", "case_access_log", "moderation_limits", "media_holds"];
  const AUTH_TABLES = ["notifier_contacts", "notifier_confirmations", "notifier_suppressions", "staff_personal_accounts"];

  test("the twelve moderation tables are public, with row level security and one policy for the API role", () => {
    for (const name of MODERATION_TABLES) {
      const cfg = byName.get(name);
      expect(cfg, name).toBeDefined();
      expect(cfg!.schema, name).toBeUndefined(); // public
      expect(cfg!.enableRLS, name).toBe(true);
      // The grants do the restricting (migration 0015); moderation_limits is read only, so its one policy is a SELECT one.
      expect(policies(name), name).toEqual(name === "moderation_limits" ? [["moderation_limits_api_select", "select", apiRole]] : [[`${name}_api_all`, "all", apiRole]]);
    }
  });

  test("no moderation table has a column named like an email or an address", () => {
    for (const name of MODERATION_TABLES) {
      for (const c of byName.get(name)!.columns) expect(c.name, `${name}.${c.name}`).not.toMatch(/email|address/i);
    }
  });

  test("xid8 is the xid8 SQL type and hands the transaction id over as a string", () => {
    const table = pgTable("xid8_probe", { value: xid8("value") });
    const probe = getTableConfig(table).columns[0]!;
    expect(probe.getSQLType()).toBe("xid8");
    // A 64-bit counter: a string keeps every digit, where a JavaScript number would not.
    expect(probe.mapFromDriverValue("18446744073709551615")).toBe("18446744073709551615");
    expect(probe.mapToDriverValue("773")).toBe("773");
  });

  test("one open case a target: the partial unique index, the queue's index and the target's index", () => {
    const open = index("cases", "cases_one_open_per_target");
    expect(open?.unique).toBe(true);
    expect(indexColumns(open)).toEqual(["target_type", "target_id"]);
    expect(predicate(open)).toBe("closed_at is null");
    const queue = index("cases", "cases_queue_idx");
    expect(queue?.unique).toBe(false);
    expect(indexColumns(queue)).toEqual(["lane", "oldest_open_at"]);
    expect(predicate(queue)).toBe("closed_at is null");
    expect(indexColumns(index("cases", "cases_target_idx"))).toEqual(["target_type", "target_id", "opened_at"]);
    expect(checks("cases")).toEqual(["cases_closed_answered", "cases_lane", "cases_seq_order"]);
    expect(column("cases", "id")?.hasDefault).toBe(true);
    // No foreign key on the target: it names two tables.
    expect(foreignKeys("cases")).toEqual({});
  });

  test("an item's partial unique indexes: one target a notice, one re-examination an item, one item per reporter, case and ground", () => {
    const target = index("intake_items", "intake_items_target_once");
    expect(target?.unique).toBe(true);
    expect(indexColumns(target)).toEqual(["intake_id", "target_type", "target_id"]);
    expect(predicate(target)).toBe("reexamines_item_id is null");

    const reexamines = index("intake_items", "intake_items_reexamines_once");
    expect(reexamines?.unique).toBe(true);
    expect(indexColumns(reexamines)).toEqual(["reexamines_item_id"]);
    expect(predicate(reexamines)).toBe("reexamines_item_id is not null");

    const reporter = index("intake_items", "intake_items_reporter_once");
    expect(reporter?.unique).toBe(true);
    expect(indexColumns(reporter)).toEqual(["case_id", "reporter_account_id", "alleges_illegal"]);
    expect(predicate(reporter)).toBe("reexamines_item_id is null");

    const seq = index("intake_items", "intake_items_case_seq_idx");
    expect(seq?.unique).toBe(true);
    expect(indexColumns(seq)).toEqual(["case_id", "seq"]);
    expect(seq?.where).toBeUndefined();

    // The freeze's probe, and the release's.
    const suspect = index("intake_items", "intake_items_suspect_open_idx");
    expect(indexColumns(suspect)).toEqual(["case_id"]);
    expect(predicate(suspect)).toBe("suspect and answered_by is null");
    expect(predicate(index("intake_items", "intake_items_revision_idx"))).toBe("revision_pending_at is not null");
    expect(indexColumns(index("intake_items", "intake_items_answered_by_idx"))).toEqual(["answered_by"]);
  });

  test("an item records whether it is suspect and the handle an account was named by, and the database holds both halves of that", () => {
    const suspect = column("intake_items", "suspect");
    expect(suspect?.getSQLType()).toBe("boolean");
    expect(suspect?.notNull).toBe(true);
    // The trigger forces it; the default is there so that no insert must name a forced column.
    expect(suspect?.default).toBe(false);
    const named = column("intake_items", "named_handle");
    expect(named?.getSQLType()).toBe("text");
    expect(named?.notNull).toBe(false);
    expect(checks("intake_items")).toEqual([
      "intake_items_case",
      "intake_items_lane",
      "intake_items_named_handle",
      "intake_items_position",
      "intake_items_shown",
      "intake_items_statement",
      "intake_items_statement_len",
    ]);
    expect(foreignKeys("intake_items")).toEqual({
      intake_id: { table: "intakes", columns: ["id"], onDelete: "restrict" },
      case_id: { table: "cases", columns: ["id"], onDelete: "restrict" },
      answered_by: { table: "decisions", columns: ["id"], onDelete: "no action" },
      reexamines_item_id: { table: "intake_items", columns: ["id"], onDelete: "no action" },
    });
  });

  test("no check lets a row through on a null: a statement always has its digest, a salt its form, and the two comparisons with a nullable value are null-safe", () => {
    // A CHECK passes when its expression is null, so `digest = encode(...)` alone would accept a statement with no digest.
    for (const [table, name] of [
      ["intake_items", "intake_items_statement"],
      ["appeals", "appeals_statement"],
    ] as const) {
      expect(checkSql(table, name), name).toContain(`"${table}"."statement_digest" is not null and "${table}"."statement_digest" = encode(sha256(`);
      expect(checkSql(table, name), name).toContain(`"${table}"."statement_salt" ~ '^[0-9a-f]{64}$'`);
    }
    expect(checkSql("staff_texts", "staff_texts_digest")).toContain(`"staff_texts"."salt" ~ '^[0-9a-f]{64}$' and "staff_texts"."digest" = encode(sha256(`);
    expect(checkSql("intake_items", "intake_items_case")).toBe(
      `("intake_items"."case_id" is null) = ("intake_items"."seq" is null) and ("intake_items"."case_id" is not null or "intake_items"."outcome" is not distinct from 'not_available')`,
    );
    expect(checkSql("decisions", "decisions_keyword")).toBe(`"decisions"."category_keyword" is null or "decisions"."ground" is not distinct from 'illegal'`);
  });

  test("every check of intakes, by name", () => {
    expect(checks("intakes")).toEqual([
      "intakes_category",
      "intakes_category_keyword",
      "intakes_cited_law_len",
      "intakes_contact_signed_out",
      "intakes_csam",
      "intakes_erased",
      "intakes_explanation_len",
      "intakes_finding",
      "intakes_finding_legal",
      "intakes_has_ground",
      "intakes_illegal_elements",
      "intakes_illegal_not_tc",
      "intakes_lookup",
      "intakes_r2_finding_only",
      "intakes_ref",
      "intakes_reporter_signed_in",
      "intakes_rule_id",
    ]);
    // The public reference and the token's hash each name one notice.
    expect(uniques("intakes")).toEqual([
      ["intakes_lookup_hash_unique", ["lookup_hash"]],
      ["intakes_ref_unique", ["ref"]],
    ]);
    expect(foreignKeys("intakes")).toEqual({
      reporter_id: { table: "profiles", columns: ["id"], onDelete: "set null" },
      finding_by: { table: "profiles", columns: ["id"], onDelete: "restrict" },
    });
    // The notifier's contact lives in the auth schema; the public row holds only its id, with no foreign key.
    expect(column("intakes", "contact_id")?.getSQLType()).toBe("uuid");
    expect(predicate(index("intakes", "intakes_unerased_idx"))).toBe("erased_at is null");
  });

  test("every check of decisions, by name, and one review an appeal", () => {
    expect(checks("decisions")).toEqual([
      "decisions_automated_decision",
      "decisions_category",
      "decisions_category_keyword",
      "decisions_digests",
      "decisions_ground_law",
      "decisions_ground_rule",
      "decisions_interim",
      "decisions_keyword",
      "decisions_law_no_rule",
      "decisions_restricted",
      "decisions_reversal_plain",
      "decisions_review_target",
      "decisions_rule_id",
      "decisions_territorial_scope",
    ]);
    const once = index("decisions", "decisions_appeal_once");
    expect(once?.unique).toBe(true);
    expect(indexColumns(once)).toEqual(["appeal_id"]);
    expect(predicate(once)).toBe("appeal_id is not null");
    expect(foreignKeys("decisions")).toEqual({
      case_id: { table: "cases", columns: ["id"], onDelete: "restrict" },
      reviews_decision_id: { table: "decisions", columns: ["id"], onDelete: "no action" },
      appeal_id: { table: "appeals", columns: ["id"], onDelete: "no action" },
      snapshot_id: { table: "evidence_snapshots", columns: ["id"], onDelete: "restrict" },
      decided_by: { table: "profiles", columns: ["id"], onDelete: "restrict" },
    });
  });

  test("the columns of decisions that the database forces: their types, and which carry a default", () => {
    // [name, SQL type, not null, default]; undefined where the column has none and the trigger of 0016 alone fills it.
    const forced = [
      ["appeal_id", "uuid", false, undefined],
      ["answers_from_seq", "integer", false, undefined],
      ["source", "decision_source", true, undefined],
      ["automated_detection", "boolean", true, false],
      ["automated_decision", "text", true, "not_automated"],
      ["territorial_scope", "text", true, "worldwide"],
      ["decided_at", "timestamp with time zone", true, undefined],
      ["xact", "xid8", true, undefined],
      ["puid", "text", true, undefined],
      ["informed_at", "timestamp with time zone", true, undefined],
      ["suspect", "boolean", true, undefined],
      ["unseen", "boolean", true, false],
      ["needs_admin", "boolean", true, undefined],
      ["ended_interim", "boolean", true, undefined],
      ["author_mail", "delivery_state", true, "none"],
      ["author_mail_at", "timestamp with time zone", false, undefined],
    ] as const;
    for (const [name, type, notNull, fallback] of forced) {
      const c = column("decisions", name);
      expect(c?.getSQLType(), name).toBe(type);
      expect(c?.notNull, name).toBe(notNull);
      expect(c?.default, name).toBe(fallback);
    }
    // The Transparency Database's platform id: one per decision, never the internal id.
    expect(uniques("decisions")).toEqual([["decisions_puid_unique", ["puid"]]]);
  });

  test("the ledger: a measure once a decision, lifted at most once, and the columns the database forces", () => {
    expect(shape("decision_actions")).toEqual([
      ["id", "uuid", true],
      ["decision_id", "uuid", true],
      ["kind", "action_kind", true],
      ["media_id", "uuid", false],
      ["subject_account_id", "uuid", true],
      ["post_id", "uuid", false],
      ["reverses_action_id", "uuid", false],
      ["no_effect", "text", false],
      ["created_at", "timestamp with time zone", true],
      // 3e (design, section 6.1): three the key signs, four the trigger forces.
      ["days", "smallint", false],
      ["announced", "boolean", false],
      ["basis", "text", false],
      ["rests_on", "uuid[]", false],
      ["starts_at", "timestamp with time zone", false],
      ["ends_at", "timestamp with time zone", false],
      ["replaced", "boolean", false],
    ]);
    // None of the forced columns has a default: the triggers of 0016 and 0021 alone fill them.
    for (const name of ["subject_account_id", "post_id", "reverses_action_id", "no_effect", "created_at", "days", "announced", "basis", "rests_on", "starts_at", "ends_at", "replaced"]) {
      expect(column("decision_actions", name)?.hasDefault, name).toBe(false);
    }
    const once = byName.get("decision_actions")!.uniqueConstraints.map((u) => [u.getName(), u.columns.map((c) => c.name), u.nullsNotDistinct]);
    expect(once).toEqual([["decision_actions_once", ["decision_id", "kind", "media_id"], true]]);
    const reversed = index("decision_actions", "decision_actions_reversed_once");
    expect(reversed?.unique).toBe(true);
    expect(indexColumns(reversed)).toEqual(["reverses_action_id"]);
    expect(predicate(reversed)).toBe("reverses_action_id is not null");
    expect(checks("decision_actions")).toEqual(["decision_actions_announced", "decision_actions_basis", "decision_actions_days", "decision_actions_no_effect"]);
    // Each check names columns only: no value of action_kind, which a check may not name in the migration that adds it.
    expect(checkSql("decision_actions", "decision_actions_days")).toBe(`"decision_actions"."days" between 1 and 30`);
    expect(checkSql("decision_actions", "decision_actions_basis")).toBe(
      `"decision_actions"."basis" in ('strikes', 'threat', 'terrorist', 'flood', 'protective', 'threat_repeat', 'ladder_end', 'reports')`,
    );
    expect(checkSql("decision_actions", "decision_actions_announced")).toBe(`"decision_actions"."announced" is null or "decision_actions"."basis" is not null`);
    expect(foreignKeys("decision_actions")).toEqual({
      decision_id: { table: "decisions", columns: ["id"], onDelete: "restrict" },
      reverses_action_id: { table: "decision_actions", columns: ["id"], onDelete: "no action" },
    });
    // 3c's seven measures and five reversals, then 3e's six measures and four reversals, in the order the migration adds them.
    expect(schema.actionKind.enumValues).toEqual([
      "withhold",
      "remove",
      "seal_media",
      "withhold_media",
      "remove_media",
      "reset_display_name",
      "reset_bio",
      "restore",
      "unseal_media",
      "restore_media",
      "restore_display_name",
      "restore_bio",
      "strike",
      "suspend",
      "terminate",
      "retire_handle",
      "warn_reporting",
      "restrict_reporting",
      "overrule",
      "lift_suspension",
      "unretire_handle",
      "lift_reporting",
    ]);
  });

  test("profiles gain the three columns standing_apply derives, null by default, and one interval at most", () => {
    for (const name of ["suspended_from", "suspended_until", "reports_restricted_until"]) {
      expect(column("profiles", name)?.getSQLType(), name).toBe("timestamp with time zone");
      expect(column("profiles", name)?.notNull, name).toBe(false);
      expect(column("profiles", name)?.hasDefault, name).toBe(false);
    }
    expect(byName.get("profiles")!.checks.map((c) => c.name).sort()).toEqual(["profiles_counts_nonnegative", "profiles_suspended"]);
    expect(checkSql("profiles", "profiles_suspended")).toBe(
      `("profiles"."suspended_from" is null) = ("profiles"."suspended_until" is null) and "profiles"."suspended_from" < "profiles"."suspended_until"`,
    );
  });

  test("posts gain the three columns of Explore's resume rule, with their index", () => {
    for (const name of ["hidden_at", "restored_at", "explore_from"]) {
      expect(column("posts", name)?.getSQLType(), name).toBe("timestamp with time zone");
      expect(column("posts", name)?.notNull, name).toBe(false);
      expect(column("posts", name)?.hasDefault, name).toBe(false);
    }
    const idx = index("posts", "posts_explore_from_idx");
    expect(idx?.unique).toBe(false);
    expect(indexColumns(idx)).toEqual(["explore_from"]);
    expect(predicate(idx)).toBe("explore_from is not null");
  });

  test("suspension_replies: one reply a standing measure, its statement held to its digest, and the replies waiting", () => {
    expect(shape("suspension_replies")).toEqual([
      ["action_id", "uuid", true],
      ["account_id", "uuid", true],
      ["statement", "text", false],
      ["statement_salt", "text", false],
      ["statement_digest", "text", false],
      ["filed_at", "timestamp with time zone", true],
      ["on_time", "boolean", true],
      ["answered_by", "uuid", false],
      ["answered_at", "timestamp with time zone", false],
      ["erased_at", "timestamp with time zone", false],
    ]);
    expect(column("suspension_replies", "action_id")?.primary).toBe(true);
    expect(foreignKeys("suspension_replies")).toEqual({
      action_id: { table: "decision_actions", columns: ["id"], onDelete: "restrict" },
      account_id: { table: "profiles", columns: ["id"], onDelete: "restrict" },
      answered_by: { table: "decisions", columns: ["id"], onDelete: "no action" },
    });
    expect(checks("suspension_replies")).toEqual(["suspension_replies_statement", "suspension_replies_statement_len"]);
    // The same three states as an appeal's statement, under the reply's own names.
    expect(checkSql("suspension_replies", "suspension_replies_statement").replaceAll("suspension_replies", "appeals")).toBe(checkSql("appeals", "appeals_statement"));
    const pending = index("suspension_replies", "suspension_replies_pending_idx");
    expect(indexColumns(pending)).toEqual(["filed_at"]);
    expect(predicate(pending)).toBe("answered_by is null");
    expect(policies("suspension_replies")).toEqual([["suspension_replies_api_all", "all", apiRole]]);
  });

  test("unfounded_marks: one mark an item, with its reporter, its report and the decision that set or withdrew it", () => {
    expect(shape("unfounded_marks")).toEqual([
      ["item_id", "uuid", true],
      ["decision_id", "uuid", true],
      ["account_id", "uuid", true],
      ["intake_id", "uuid", true],
      ["reported_at", "timestamp with time zone", true],
      ["marked_at", "timestamp with time zone", true],
      ["withdrawn_by", "uuid", false],
      ["withdrawn_at", "timestamp with time zone", false],
    ]);
    expect(column("unfounded_marks", "item_id")?.primary).toBe(true);
    expect(foreignKeys("unfounded_marks")).toEqual({
      item_id: { table: "intake_items", columns: ["id"], onDelete: "restrict" },
      decision_id: { table: "decisions", columns: ["id"], onDelete: "restrict" },
      intake_id: { table: "intakes", columns: ["id"], onDelete: "restrict" },
      withdrawn_by: { table: "decisions", columns: ["id"], onDelete: "no action" },
    });
    expect(indexColumns(index("unfounded_marks", "unfounded_marks_account_idx"))).toEqual(["account_id", "reported_at"]);
    expect(checks("unfounded_marks")).toEqual([]);
    expect(policies("unfounded_marks")).toEqual([["unfounded_marks_api_all", "all", apiRole]]);
  });

  test("report_tallies: one row an account and day, which the API role may only read", () => {
    expect(shape("report_tallies")).toEqual([
      ["account_id", "uuid", true],
      ["day", "date", true],
      ["reports", "integer", true],
    ]);
    expect(byName.get("report_tallies")!.primaryKeys.map((k) => k.columns.map((c) => c.name))).toEqual([["account_id", "day"]]);
    expect(foreignKeys("report_tallies")).toEqual({});
    expect(policies("report_tallies")).toEqual([["report_tallies_api_select", "select", apiRole]]);
  });

  test("no table of 3e has a column named like an email or an address", () => {
    for (const name of ["suspension_replies", "unfounded_marks", "report_tallies"]) {
      expect(byName.get(name)?.enableRLS, name).toBe(true);
      for (const c of byName.get(name)!.columns) expect(c.name, `${name}.${c.name}`).not.toMatch(/email|address/i);
    }
  });

  test("seal_posts lists the posts of a seal with their image counts, keyed by measure and post", () => {
    expect(shape("seal_posts")).toEqual([
      ["action_id", "uuid", true],
      ["post_id", "uuid", true],
      ["images", "smallint", true],
    ]);
    expect(byName.get("seal_posts")!.primaryKeys.map((k) => k.columns.map((c) => c.name))).toEqual([["action_id", "post_id"]]);
    // No foreign key on the post, as a case's target has none.
    expect(foreignKeys("seal_posts")).toEqual({ action_id: { table: "decision_actions", columns: ["id"], onDelete: "restrict" } });
    expect(indexColumns(index("seal_posts", "seal_posts_post_idx"))).toEqual(["post_id"]);
    expect(checks("seal_posts")).toEqual(["seal_posts_images"]);
  });

  test("decisions record whether they were taken under suspicion and with the images out of sight", () => {
    expect(column("decisions", "suspect")?.getSQLType()).toBe("boolean");
    expect(column("decisions", "suspect")?.notNull).toBe(true);
    expect(column("decisions", "unseen")?.getSQLType()).toBe("boolean");
    expect(column("decisions", "unseen")?.notNull).toBe(true);
  });

  test("one appeal a decision", () => {
    const once = index("appeals", "appeals_once");
    expect(once?.unique).toBe(true);
    expect(indexColumns(once)).toEqual(["decision_id"]);
    expect(once?.where).toBeUndefined();
    expect(predicate(index("appeals", "appeals_pending_idx"))).toBe("answered_by is null");
    expect(predicate(index("appeals", "appeals_statement_idx"))).toBe("statement is not null");
    expect(checks("appeals")).toEqual(["appeals_statement", "appeals_statement_len"]);
    expect(foreignKeys("appeals")).toEqual({
      decision_id: { table: "decisions", columns: ["id"], onDelete: "restrict" },
      answered_by: { table: "decisions", columns: ["id"], onDelete: "no action" },
    });
  });

  test("posts gain a moderation level and an erasure time; post_state keeps its four values", () => {
    const level = column("posts", "moderation_level");
    expect(level?.getSQLType()).toBe("moderation_level");
    expect(level?.notNull).toBe(true);
    expect(level?.default).toBe("visible");
    expect(schema.moderationLevel.enumValues).toEqual(["visible", "withheld", "removed"]);
    expect(column("posts", "erased_at")?.getSQLType()).toBe("timestamp with time zone");
    expect(column("posts", "erased_at")?.notNull).toBe(false);
    // A seal is a state of images: no reader of posts learns a new state.
    expect(schema.postState.enumValues).toEqual(["visible", "withheld", "removed", "deleted_by_author"]);
  });

  test("post_media gains its own moderation state, the time a hold retains it until and an erasure time", () => {
    const state = column("post_media", "moderation_state");
    expect(state?.getSQLType()).toBe("media_moderation_state");
    expect(state?.notNull).toBe(true);
    expect(state?.default).toBe("visible");
    // Only an image is ever sealed.
    expect(schema.mediaModerationState.enumValues).toEqual(["visible", "withheld", "removed", "sealed"]);
    for (const name of ["hold_until", "erased_at"]) {
      expect(column("post_media", name)?.getSQLType(), name).toBe("timestamp with time zone");
      expect(column("post_media", name)?.notNull, name).toBe(false);
      expect(column("post_media", name)?.hasDefault, name).toBe(false);
    }
  });

  test("media_holds keeps a case's hold on an image row and goes with the row", () => {
    expect(shape("media_holds")).toEqual([
      ["id", "bigint", true],
      ["media_id", "uuid", true],
      ["case_id", "uuid", true],
      ["held_at", "timestamp with time zone", true],
      ["until", "timestamp with time zone", false],
      ["released_at", "timestamp with time zone", false],
    ]);
    expect(column("media_holds", "id")?.generatedIdentity?.type).toBe("always");
    expect(foreignKeys("media_holds")).toEqual({
      media_id: { table: "post_media", columns: ["id"], onDelete: "cascade" },
      case_id: { table: "cases", columns: ["id"], onDelete: "restrict" },
    });
    expect(predicate(index("media_holds", "media_holds_media_idx"))).toBe("released_at is null");
    expect(predicate(index("media_holds", "media_holds_case_idx"))).toBe("released_at is null");
  });

  test("staff texts and snapshots are held to their digests and erasable; the access log numbers its rows", () => {
    expect(checks("staff_texts")).toEqual(["staff_texts_digest", "staff_texts_text_len"]);
    expect(uniques("staff_texts")).toEqual([["staff_texts_digest_unique", ["digest"]]]);
    expect(predicate(index("staff_texts", "staff_texts_open_idx"))).toBe("confirmed_at is null and erased_at is null");
    expect(checks("evidence_snapshots")).toEqual(["evidence_erased"]);
    expect(column("evidence_snapshots", "media")?.getSQLType()).toBe("jsonb");
    expect(column("evidence_snapshots", "post_state")?.getSQLType()).toBe("post_state");
    expect(indexColumns(index("evidence_snapshots", "evidence_snapshots_target_idx"))).toEqual(["target_type", "target_id"]);
    expect(predicate(index("evidence_snapshots", "evidence_snapshots_unerased_idx"))).toBe("erased_at is null");
    expect(column("case_access_log", "id")?.generatedIdentity?.type).toBe("always");
    expect(predicate(index("case_access_log", "case_access_log_reveals_idx"))).toBe("kind = 'identity_revealed'");
    expect(checks("moderation_limits")).toEqual(["moderation_limits_single_row"]);
  });

  test("the four new auth tables live in the auth schema, each with row level security and one policy", () => {
    for (const name of AUTH_TABLES) {
      const cfg = byName.get(name);
      expect(cfg, name).toBeDefined();
      expect(cfg!.schema, name).toBe("auth");
      expect(cfg!.enableRLS, name).toBe(true);
    }
    for (const name of ["notifier_contacts", "notifier_confirmations", "notifier_suppressions"]) {
      expect(policies(name), name).toEqual([[`${name}_auth_all`, "all", authRole]]);
    }
    // The auth role holds nothing on the staff links (migration 0015 revokes all); its one policy lets it see no row.
    const none = byName.get("staff_personal_accounts")!.policies;
    expect(none.map((p) => [p.name, p.for, p.to])).toEqual([["staff_personal_accounts_auth_none", "select", authRole]]);
    expect(new PgDialect().sqlToQuery(none[0]!.using!).sql).toBe("false");
  });

  test("a notifier's contact is kept encrypted, with a keyed hash of the address and the day it is forgotten", () => {
    expect(shape("notifier_contacts")).toEqual([
      ["id", "uuid", true],
      ["name_enc", "text", false],
      ["email_enc", "text", false],
      ["email_hash", "text", false],
      ["mail_token_enc", "text", false],
      ["created_at", "timestamp with time zone", true],
      ["forget_after", "timestamp with time zone", true],
    ]);
    // The moderation module chooses the id: the public intake row names it before the contact is stored.
    expect(column("notifier_contacts", "id")?.primary).toBe(true);
    expect(column("notifier_contacts", "id")?.hasDefault).toBe(false);
    expect(shape("notifier_confirmations")).toEqual([
      ["email_hash", "text", true],
      ["confirmed_at", "timestamp with time zone", true],
      ["expires_at", "timestamp with time zone", true],
    ]);
    expect(column("notifier_confirmations", "email_hash")?.primary).toBe(true);
    expect(shape("notifier_suppressions")).toEqual([
      ["email_hash", "text", true],
      ["created_at", "timestamp with time zone", true],
    ]);
    expect(column("notifier_suppressions", "email_hash")?.primary).toBe(true);
  });

  test("a staff link pairs a staff account with a personal account that is not the same one, and stops either from being deleted", () => {
    expect(shape("staff_personal_accounts")).toEqual([
      ["staff_user_id", "uuid", true],
      ["personal_user_id", "uuid", true],
      ["linked_at", "timestamp with time zone", true],
    ]);
    expect(byName.get("staff_personal_accounts")!.primaryKeys.map((k) => k.columns.map((c) => c.name))).toEqual([["staff_user_id", "personal_user_id"]]);
    expect(foreignKeys("staff_personal_accounts")).toEqual({
      staff_user_id: { table: "users", columns: ["id"], onDelete: "restrict" },
      personal_user_id: { table: "users", columns: ["id"], onDelete: "restrict" },
    });
    expect(checks("staff_personal_accounts")).toEqual(["staff_personal_accounts_differ"]);
  });
});

describe("the contact point and the alert channel 3f", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  const checks = (table: string) => byName.get(table)!.checks.map((c) => c.name).sort();
  const checkSql = (table: string, name: string) => new PgDialect().sqlToQuery(byName.get(table)!.checks.find((c) => c.name === name)!.value).sql;
  const policies = (table: string) => byName.get(table)!.policies.map((p) => [p.name, p.for, p.to]);
  const uniques = (table: string) => byName.get(table)!.uniqueConstraints.map((u) => [u.getName(), u.columns.map((c) => c.name)]);
  const indexes = (table: string) =>
    byName
      .get(table)!
      .indexes.map((i) => [i.config.name, i.config.columns.map((c) => (c as { name?: string }).name), i.config.where ? new PgDialect().sqlToQuery(i.config.where).sql : null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const TABLES = ["contact_messages", "alert_outbox", "notify_state", "notify_folders"];

  test("the four tables are public, with row level security and one allow-all policy for each role granted anything on them", () => {
    for (const name of TABLES) {
      const cfg = byName.get(name);
      expect(cfg, name).toBeDefined();
      expect(cfg!.schema, name).toBeUndefined();
      expect(cfg!.enableRLS, name).toBe(true);
      expect(policies(name), name).toEqual([
        [`${name}_api_all`, "all", apiRole],
        [`${name}_notify_all`, "all", notifyRole],
      ]);
    }
    expect(notifyRole.name).toBe("korbat_notify");
  });

  test("a message at the contact point holds no sender, no subject and no content: its folder, its two numbers and its times", () => {
    expect(shape("contact_messages")).toEqual([
      ["id", "uuid", true],
      ["folder", "text", true],
      ["uidvalidity", "bigint", true],
      ["uid", "bigint", true],
      ["received_at", "timestamp with time zone", true],
      ["seen_at", "timestamp with time zone", true],
      ["stale", "boolean", true],
      ["disposition", "text", false],
      ["handled_by", "uuid", false],
      ["handled_at", "timestamp with time zone", false],
    ]);
    expect(column("contact_messages", "id")?.hasDefault).toBe(true);
    expect(uniques("contact_messages")).toEqual([["contact_messages_uid_key", ["folder", "uidvalidity", "uid"]]]);
    expect(checks("contact_messages")).toEqual(["contact_messages_disposition", "contact_messages_folder", "contact_messages_handled"]);
    expect(checkSql("contact_messages", "contact_messages_folder")).toBe(`"contact_messages"."folder" in ('inbox', 'junk')`);
    expect(checkSql("contact_messages", "contact_messages_disposition")).toBe(
      `"contact_messages"."disposition" in ('order', 'referral', 'first_order_notice', 'preservation_request', 'scrutiny_decision', 'clarification', 'not_an_order')`,
    );
    expect(checkSql("contact_messages", "contact_messages_handled")).toBe(`("contact_messages"."disposition" is null) = ("contact_messages"."handled_at" is null)`);
    const fk = byName.get("contact_messages")!.foreignKeys.map((k) => [k.reference().columns.map((c) => c.name), getTableConfig(k.reference().foreignTable).name, k.onDelete]);
    expect(fk).toEqual([[["handled_by"], "profiles", "restrict"]]);
    expect(indexes("contact_messages")).toEqual([
      ["contact_messages_open_idx", ["received_at"], "disposition is null"],
      ["contact_messages_received_idx", ["received_at", "id"], null],
    ]);
    for (const c of byName.get("contact_messages")!.columns) expect(c.name).not.toMatch(/sender|subject|from|email|address|body/i);
  });

  test("an alert's row: its kind, priority, scope and step, its facts, its subject without a key, and its two legs", () => {
    expect(shape("alert_outbox")).toEqual([
      ["id", "bigint", true],
      ["kind", "text", true],
      ["priority", "smallint", true],
      ["scope", "text", true],
      ["step", "smallint", false],
      ["facts", "jsonb", true],
      ["message_id", "uuid", false],
      ["order_id", "uuid", false],
      ["created_at", "timestamp with time zone", true],
      ["pushed_at", "timestamp with time zone", false],
      ["mailed_at", "timestamp with time zone", false],
      ["push_attempts", "integer", true],
    ]);
    expect(column("alert_outbox", "id")?.generatedIdentity?.type).toBe("always");
    // No foreign keys: a record's erasure never waits for an alert's row.
    expect(byName.get("alert_outbox")!.foreignKeys).toEqual([]);
    expect(checks("alert_outbox")).toEqual(["alert_outbox_facts", "alert_outbox_kind", "alert_outbox_priority", "alert_outbox_scope", "alert_outbox_step"]);
    expect(checkSql("alert_outbox", "alert_outbox_kind")).toContain("'contact_mail', 'contact_mail_escalated', 'order_due'");
    expect(checkSql("alert_outbox", "alert_outbox_kind")).toContain("'moderation_reveal', 'moderation_csam_lifted')");
    expect(checkSql("alert_outbox", "alert_outbox_priority")).toBe(`"alert_outbox"."priority" in (3, 5)`);
    expect(checkSql("alert_outbox", "alert_outbox_scope")).toBe(`"alert_outbox"."scope" in ('on_call', 'all')`);
    // Counts and times only: an object of at most six members, each a number or an instant in UTC.
    const facts = checkSql("alert_outbox", "alert_outbox_facts");
    expect(facts).toContain(`jsonb_typeof("alert_outbox"."facts") = 'object'`);
    expect(facts).toContain("<= 6");
    expect(facts).toContain("like_regex");
    // The step key is made by hand in the migration (drizzle cannot write NULLS NOT DISTINCT on a partial index).
    expect(indexes("alert_outbox")).toEqual([
      ["alert_outbox_mail_idx", ["created_at"], "mailed_at is null"],
      ["alert_outbox_push_idx", ["created_at"], "pushed_at is null"],
    ]);
  });

  test("the watcher's state: one row, its error one of eight words; and one row a folder", () => {
    expect(shape("notify_state")).toEqual([
      ["id", "smallint", true],
      ["beat_at", "timestamp with time zone", false],
      ["mailbox_ok_at", "timestamp with time zone", false],
      ["push_ok_at", "timestamp with time zone", false],
      ["error", "text", false],
    ]);
    expect(checks("notify_state")).toEqual(["notify_state_error", "notify_state_single_row"]);
    expect(checkSql("notify_state", "notify_state_error")).toBe(
      `"notify_state"."error" in ('imap_connect', 'imap_timeout', 'imap_tls', 'imap_login', 'imap_folder', 'imap_protocol', 'push_connect', 'push_refused')`,
    );
    expect(shape("notify_folders")).toEqual([
      ["folder", "text", true],
      ["uidvalidity", "bigint", false],
      ["last_uid", "bigint", false],
    ]);
    expect(column("notify_folders", "folder")?.primary).toBe(true);
    expect(checks("notify_folders")).toEqual(["notify_folders_folder"]);
  });
});
