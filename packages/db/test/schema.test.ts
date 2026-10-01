import { describe, expect, test } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig, pgTable } from "drizzle-orm/pg-core";
import { apiRole, authRole, bytea } from "../src/schema/helpers";
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
  test("there are 28 tables in total", () => {
    expect(tables.length).toBe(28);
  });
  test("transparency_log carries no user identifiers", () => {
    const cols = byName.get("transparency_log")!.columns.map((c) => c.name);
    for (const c of cols) expect(c, c).not.toMatch(/user|author|moderator|reporter/);
  });
  test("audit_log policies allow only insert and select", () => {
    const kinds = byName.get("audit_log")!.policies.map((p) => p.for).sort();
    expect(kinds).toEqual(["insert", "select"]);
  });
  test("one appeal per case", () => {
    const idx = byName.get("appeals")!.indexes.find((i) => i.config.name === "appeals_case_idx");
    expect(idx?.config.unique).toBe(true);
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
    expect(cfg.columns.map((c) => c.name)).toEqual(["handle_lower", "profile_id", "changed_at"]);
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
