import { describe, expect, test } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
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
  test("there are 22 tables in total", () => {
    expect(tables.length).toBe(22);
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
    expect(schema.authEventType.enumValues.slice(schema.authEventType.enumValues.indexOf("not_me"))).toEqual([
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
