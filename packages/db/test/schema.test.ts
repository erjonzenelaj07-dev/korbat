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
  test("there are 75 tables in total", () => {
    // 28 before 3c, minus the five retired tables, plus the twelve moderation tables and the four auth tables; then 3e's
    // three: suspension_replies, unfounded_marks and report_tallies; then 3f's first four: contact_messages, alert_outbox,
    // notify_state and notify_folders; then the three of order records: legal_orders, legal_order_items and
    // legal_order_events; then the four of the records to authorities: authority_notifications,
    // authority_notification_events, productions and auth.report_holds; then the two of recovery: restore_gaps and
    // copy_marks; then 3d's first, quarantine_files; then the release's four (Task 2): release_leaves, releases,
    // release_posts and release_notices; then the edge's outbox (Task 3), edge_purges; then the public figures' two (Task
    // 4), transparency_editions and recipient_months; then the head's (Task 5), head_publications; then the automated
    // decision's two (Task 6), automated_signals and automated_objections; then known material's three (Task 7),
    // media_hashes, media_matches and upload_refusals; then 3b's three (Task 2, migration 0043_imports): import_jobs,
    // import_picks and import_keys; then 2d's three (Task 1, migration 0049_activity): activity_items, activity_state and
    // post_mentions; then 2d's moderation of avatars (Task 4, migration 0053_avatar_moderation): seal_avatars,
    // avatar_reviews and avatar_resets.
    expect(tables.length).toBe(78);
  });

  test("3d Task 7's known material (section 6.7): the hashes of an image, a match's record and a held upload's refusal, each under its closed lists, with its keys and indexes", () => {
    const hashes = byName.get("media_hashes")!;
    const matches = byName.get("media_matches")!;
    const refusals = byName.get("upload_refusals")!;
    const checkSql = (table: typeof hashes, name: string) => new PgDialect().sqlToQuery(table.checks.find((c) => c.name === name)!.value).sql;
    // The three cryptographic hashes are required; PDQ, its quality and its implementation are null in this build.
    expect(hashes.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual([
      ["media_id", "uuid", true],
      ["sha256", "bytea", true],
      ["sha1", "bytea", true],
      ["md5", "bytea", true],
      ["pdq", "bytea", false],
      ["pdq_quality", "smallint", false],
      ["pdq_impl", "smallint", false],
      ["check_state", "text", true],
      ["checked_at", "timestamp with time zone", false],
      ["source", "text", false],
    ]);
    expect(checkSql(hashes, "media_hashes_check_state")).toBe(`"media_hashes"."check_state" in ('pending', 'clear', 'matched', 'unchecked', 'capped')`);
    // The hashes die with their image row.
    expect(hashes.foreignKeys.map((k) => [k.reference().columns.map((c) => c.name), getTableConfig(k.reference().foreignTable).name, k.onDelete])).toEqual([[["media_id"], "post_media", "cascade"]]);
    expect(checkSql(matches, "media_matches_hash_type")).toBe(`"media_matches"."hash_type" in ('sha256', 'sha1', 'md5', 'pdq')`);
    expect(checkSql(matches, "media_matches_kind")).toBe(`"media_matches"."match_kind" in ('exact', 'near')`);
    expect(matches.checks.map((c) => c.name).sort()).toEqual(["media_matches_acting", "media_matches_erased", "media_matches_hash_type", "media_matches_kind", "media_matches_texts"]);
    expect(checkSql(refusals, "upload_refusals_end_as")).toBe(`"upload_refusals"."end_as" in ('report', 'no_report')`);
    expect(checkSql(refusals, "upload_refusals_end_reason")).toBe(`"upload_refusals"."end_reason" in ('source_withdrew', 'counsel_no_duty', 'other')`);
    expect(refusals.checks.map((c) => c.name).sort()).toEqual(["upload_refusals_end_as", "upload_refusals_end_reason", "upload_refusals_ended", "upload_refusals_lifted", "upload_refusals_objection"]);
    // A refusal's image has no foreign key, so the sweeper's deletion of an image ended as no_report never waits for it;
    // its match record and its release are kept with it, and its owner's profile is never deleted.
    expect(refusals.foreignKeys.map((k) => [k.reference().columns.map((c) => c.name), getTableConfig(k.reference().foreignTable).name]).sort()).toEqual([
      [["match_id"], "media_matches"],
      [["owner_id"], "profiles"],
      [["release_id"], "releases"],
    ]);
    expect(refusals.columns.find((c) => c.name === "media_id")?.isUnique).toBe(true);
    // The signal's match record, now that its table exists (Task 6 left it without a key).
    const signals = byName.get("automated_signals")!;
    expect(signals.foreignKeys.map((k) => [k.reference().columns.map((c) => c.name), getTableConfig(k.reference().foreignTable).name, k.onDelete]).sort()).toEqual([
      [["decision_id"], "decisions", "restrict"],
      [["match_id"], "media_matches", "restrict"],
    ]);
  });
  test("3d's automated decision (section 6.6): a signal under closed lists, its score or its match, its four once-set columns and its indexes; the request for a person, one a decision; each read and allowed for the API's role alone", () => {
    const signals = byName.get("automated_signals")!;
    const objections = byName.get("automated_objections")!;
    const checkSql = (table: typeof signals, name: string) => new PgDialect().sqlToQuery(table.checks.find((c) => c.name === name)!.value).sql;
    expect(signals.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual([
      ["id", "uuid", true],
      ["kind", "text", true],
      ["media_id", "uuid", true],
      ["score", "real", false],
      ["threshold_version", "smallint", false],
      ["match_id", "uuid", false],
      ["created_at", "timestamp with time zone", true],
      ["intake_item_id", "uuid", false],
      ["decision_id", "uuid", false],
      ["handled_at", "timestamp with time zone", false],
      ["handled", "text", false],
    ]);
    expect(signals.checks.map((c) => c.name).sort()).toEqual([
      "automated_signals_handled",
      "automated_signals_handled_at",
      "automated_signals_kind",
      "automated_signals_score",
      "automated_signals_score_range",
    ]);
    expect(checkSql(signals, "automated_signals_kind")).toBe(`"automated_signals"."kind" in ('r1_score', 'known_match')`);
    expect(checkSql(signals, "automated_signals_handled")).toBe(`"automated_signals"."handled" in ('finding', 'measure', 'capped', 'covered', 'gone')`);
    expect(checkSql(signals, "automated_signals_handled_at")).toBe(`("automated_signals"."handled_at" is null) = ("automated_signals"."handled" is null)`);
    // The image has no foreign key, so a deletion never waits for a signal; the match record's came with its table (Task 7).
    expect(signals.foreignKeys.map((k) => [k.reference().columns.map((c) => c.name), getTableConfig(k.reference().foreignTable).name, k.onDelete]).sort()).toEqual([
      [["decision_id"], "decisions", "restrict"],
      [["match_id"], "media_matches", "restrict"],
    ]);
    const where = (config: { where?: SQL }) => (config.where ? new PgDialect().sqlToQuery(config.where).sql : null);
    expect(signals.indexes.map((i) => [i.config.name, i.config.unique, i.config.columns.map((c) => (c as { name: string }).name), where(i.config)]).sort()).toEqual([
      ["automated_signals_decision", true, ["decision_id"], "decision_id is not null"],
      ["automated_signals_item", true, ["intake_item_id"], "intake_item_id is not null"],
      ["automated_signals_one", true, ["media_id", "kind"], null],
      ["automated_signals_open", false, ["media_id", "kind"], "handled_at is null"],
    ]);
    expect(objections.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual([
      ["decision_id", "uuid", true],
      ["text", "text", false],
      ["created_at", "timestamp with time zone", true],
      ["erased_at", "timestamp with time zone", false],
    ]);
    expect(objections.columns.find((c) => c.name === "decision_id")?.primary).toBe(true);
    expect(checkSql(objections, "automated_objections_text")).toBe(
      `("automated_objections"."text" is null) = ("automated_objections"."erased_at" is not null) and char_length("automated_objections"."text") between 1 and 2000`,
    );
    for (const table of [signals, objections]) {
      expect(table.schema ?? "public").toBe("public");
      expect(table.enableRLS).toBe(true);
      expect(table.policies.map((p) => [p.name, p.for, p.to])).toEqual([[`${table.name}_api_all`, "all", apiRole]]);
    }
  });
  test("3d's head_publications (section 6.5): a day's value or a restore's mark under closed lists, the place, the witness and its token, published and retired, read and allowed for the API's role alone", () => {
    const head = byName.get("head_publications")!;
    const checkSql = (name: string) => new PgDialect().sqlToQuery(head.checks.find((c) => c.name === name)!.value).sql;
    expect(head.schema ?? "public").toBe("public");
    expect(head.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual([
      ["day", "date", true],
      ["kind", "text", true],
      ["chain_seq", "bigint", false],
      ["value", "text", true],
      ["witness", "text", true],
      ["token", "bytea", false],
      ["witnessed_at", "timestamp with time zone", false],
      ["published_at", "timestamp with time zone", false],
      ["retired_at", "timestamp with time zone", false],
      ["last_day", "date", false],
      // 3d review M13: when the relay accepted the keeper's mail of the value.
      ["keeper_mailed_at", "timestamp with time zone", false],
    ]);
    expect(head.primaryKeys.map((key) => key.columns.map((c) => c.name))).toEqual([["day", "kind"]]);
    expect(head.checks.map((c) => c.name).sort()).toEqual(["head_publications_kind", "head_publications_last_day", "head_publications_place", "head_publications_token", "head_publications_value", "head_publications_witness"]);
    expect(checkSql("head_publications_kind")).toBe(`"head_publications"."kind" in ('head', 'restore')`);
    expect(checkSql("head_publications_witness")).toBe(`"head_publications"."witness" in ('none', 'rfc3161', 'test')`);
    expect(checkSql("head_publications_value")).toBe(`"head_publications"."value" ~ '^[0-9a-f]{64}$'`);
    // A token and its time together, of at most 16 KB, and only from a witness that was asked.
    expect(checkSql("head_publications_token")).toBe(
      `("head_publications"."token" is null) = ("head_publications"."witnessed_at" is null) and ("head_publications"."token" is null or ("head_publications"."witness" <> 'none' and octet_length("head_publications"."token") between 1 and 16384))`,
    );
    // The place is known for every row but a keeper's value that a restore stored retired: the mail carries none.
    expect(checkSql("head_publications_place")).toBe(
      `("head_publications"."chain_seq" is not null and "head_publications"."chain_seq" >= 0) or ("head_publications"."chain_seq" is null and "head_publications"."kind" = 'head' and "head_publications"."retired_at" is not null)`,
    );
    expect(checkSql("head_publications_last_day")).toBe(`"head_publications"."last_day" is null or "head_publications"."kind" = 'restore'`);
    expect(head.foreignKeys).toEqual([]);
    expect(head.enableRLS).toBe(true);
    expect(head.policies.map((p) => [p.name, p.for, p.to])).toEqual([["head_publications_api_all", "all", apiRole]]);
  });
  test("3d's public figures (section 6.4): an edition's versions under their reason, and a month's two numbers, each read and allowed for the API's role alone", () => {
    const editions = byName.get("transparency_editions")!;
    const months = byName.get("recipient_months")!;
    const checkSql = (table: typeof editions, name: string) => new PgDialect().sqlToQuery(table.checks.find((c) => c.name === name)!.value).sql;
    expect(editions.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual([
      ["year", "smallint", true],
      ["version", "smallint", true],
      ["computed_at", "timestamp with time zone", true],
      ["published_at", "timestamp with time zone", true],
      ["method", "smallint", true],
      ["reason", "text", true],
      ["figures", "jsonb", true],
      // 3d review M4: the orders the version counted, which the public read never returns.
      ["counted_orders", "uuid[]", false],
    ]);
    expect(editions.primaryKeys.map((key) => key.columns.map((c) => c.name))).toEqual([["year", "version"]]);
    expect(checkSql(editions, "transparency_editions_reason")).toBe(`"transparency_editions"."reason" in ('first', 'hold_ended', 'correction')`);
    expect(checkSql(editions, "transparency_editions_first")).toBe(`"transparency_editions"."version" >= 1 and ("transparency_editions"."version" = 1) = ("transparency_editions"."reason" = 'first')`);
    expect(months.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual([
      ["month", "date", true],
      ["signed_in", "integer", true],
      ["signed_out_days", "integer", false],
      ["method", "smallint", true],
      ["computed_at", "timestamp with time zone", true],
    ]);
    expect(months.columns.find((c) => c.name === "month")?.primary).toBe(true);
    expect(checkSql(months, "recipient_months_first_day")).toBe(`extract(day from "recipient_months"."month") = 1`);
    // No foreign key and no column of a person: counts and nothing else.
    for (const table of [editions, months]) {
      expect(table.foreignKeys).toEqual([]);
      expect(table.enableRLS).toBe(true);
      expect(table.policies.map((p) => [p.name, p.for, p.to])).toEqual([[`${table.name}_api_all`, "all", apiRole]]);
    }
  });
  test("3d's edge_purges (section 6.3): one row an image that stopped being public, its cause and its outcome under closed lists, both ends or neither, the job's index and the newest row's", () => {
    const purges = byName.get("edge_purges")!;
    const checkSql = (_table: string, name: string) => new PgDialect().sqlToQuery(purges.checks.find((c) => c.name === name)!.value).sql;
    expect(purges.schema ?? "public").toBe("public");
    expect(purges.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual([
      ["id", "bigint", true],
      ["media_id", "uuid", true],
      ["cause", "text", true],
      ["created_at", "timestamp with time zone", true],
      ["next_at", "timestamp with time zone", true],
      ["attempts", "smallint", true],
      ["outcome", "text", false],
      ["done_at", "timestamp with time zone", false],
    ]);
    expect(purges.columns.find((c) => c.name === "id")?.primary).toBe(true);
    expect(purges.columns.find((c) => c.name === "id")?.generatedIdentity?.type).toBe("always");
    expect(purges.columns.find((c) => c.name === "attempts")?.default).toBe(0);
    // No foreign key: an image's row may be gone, by a deletion or the disposal, while its purge is still owed.
    expect(purges.foreignKeys).toEqual([]);
    expect(purges.checks.map((c) => c.name).sort()).toEqual(["edge_purges_attempts", "edge_purges_cause", "edge_purges_done", "edge_purges_outcome"]);
    expect(checkSql("edge_purges", "edge_purges_cause")).toBe(`"edge_purges"."cause" in ('state', 'deleted', 'released')`);
    expect(checkSql("edge_purges", "edge_purges_outcome")).toBe(`"edge_purges"."outcome" in ('accepted', 'failed', 'off')`);
    expect(checkSql("edge_purges", "edge_purges_done")).toBe(`("edge_purges"."outcome" is null) = ("edge_purges"."done_at" is null)`);
    expect(purges.indexes.map((i) => [i.config.name, i.config.columns.map((c) => (c as { name: string }).name)]).sort()).toEqual([
      ["edge_purges_due_idx", ["next_at"]],
      ["edge_purges_media_idx", ["media_id", "id"]],
    ]);
    expect(purges.enableRLS).toBe(true);
    expect(purges.policies.map((p) => [p.name, p.for, p.to])).toEqual([["edge_purges_api_all", "all", apiRole]]);
  });
  test("3d's release (section 6.2): the leave, the release with its notice's state, its mark keyed on the post, and the day's notice; the API's role is granted nothing on the leave", () => {
    const leaves = byName.get("release_leaves")!;
    expect(leaves.columns.map((c) => c.name).sort()).toEqual(
      ["id", "notification_id", "leave_from", "reference", "received_on", "untold", "untold_until", "recorded_at", "recorded_by", "withdrawn_at", "withdrawn_by"].sort(),
    );
    expect(leaves.checks.map((c) => c.name).sort()).toEqual(["release_leaves_from", "release_leaves_reference", "release_leaves_texts", "release_leaves_untold", "release_leaves_withdrawn"]);
    expect(leaves.foreignKeys).toEqual([]);
    expect(leaves.policies.map((p) => [p.name, p.for, p.to])).toEqual([["release_leaves_api_none", "select", apiRole]]);
    const releases = byName.get("releases")!;
    expect(releases.columns.map((c) => c.name).sort()).toEqual(
      [
        "id",
        "seal_action_id",
        "upload_refusal_id",
        "post_ids",
        "basis",
        "leave_id",
        "their_reference",
        "released_by",
        "released_at",
        "replay_of",
        "backups_clear_at",
        "author_notice",
        "author_notice_at",
        "imported_at",
        // 2d Task 4 (6.5): the released seal's avatars.
        "avatar_ids",
      ].sort(),
    );
    expect(releases.checks.map((c) => c.name).sort()).toEqual(["releases_basis", "releases_leave", "releases_notice", "releases_reference", "releases_replay"]);
    // The admin who released is a profile; no foreign key names a seal, a leave or a refusal: a replay may come first.
    expect(releases.foreignKeys.map((fk) => fk.reference().foreignTable[Symbol.for("drizzle:Name") as never])).toEqual(["profiles"]);
    const marks = byName.get("release_posts")!;
    expect(marks.primaryKeys.length + marks.columns.filter((c) => c.primary).length).toBe(1);
    expect(marks.columns.find((c) => c.primary)?.name).toBe("post_id");
    expect(marks.foreignKeys.map((fk) => fk.reference().foreignTable[Symbol.for("drizzle:Name") as never])).toEqual(["releases"]);
    const notices = byName.get("release_notices")!;
    expect(notices.columns.find((c) => c.primary)?.name).toBe("subject_id");
    for (const table of [leaves, releases, marks, notices]) expect(table.enableRLS, table.name).toBe(true);
  });
  test("3d's quarantine_files: a file's row keyed by its image and its name, with its three ends and no right for the API (section 6.1)", () => {
    const files = byName.get("quarantine_files")!;
    expect(files.schema ?? "public").toBe("public");
    expect(files.columns.map((c) => c.name).sort()).toEqual(
      ["media_id", "file", "post_id", "size", "sha256", "moved_at", "returned_at", "destroyed_at", "release_id", "lost_at", "lost_told", "imported_at", "unknown"].sort(),
    );
    expect(files.primaryKeys.map((k) => [k.getName(), k.columns.map((c) => c.name)])).toEqual([["quarantine_files_pkey", ["media_id", "file"]]]);
    expect(files.checks.map((c) => c.name).sort()).toEqual(["quarantine_files_digest", "quarantine_files_ends", "quarantine_files_file", "quarantine_files_release", "quarantine_files_told"]);
    // Task 2: a destroyed file names the release it was destroyed for.
    expect(files.foreignKeys.map((fk) => fk.reference().foreignTable[Symbol.for("drizzle:Name") as never])).toEqual(["releases"]);
    expect(files.indexes.map((i) => i.config.name).sort()).toEqual(["quarantine_files_post_idx", "quarantine_files_untold_idx"]);
    expect(files.enableRLS).toBe(true);
    expect(files.policies.map((p) => [p.name, p.for, p.to])).toEqual([["quarantine_files_api_none", "select", apiRole]]);
  });
  test("3f's recovery tables: a gap's class and disposition, its closing and the copy marks (section 6.6)", () => {
    const gaps = byName.get("restore_gaps")!;
    expect(gaps.schema ?? "public").toBe("public");
    expect(gaps.columns.map((c) => c.name).sort()).toEqual(
      ["id", "import_id", "place", "hash", "action", "target_type", "target_id", "metadata", "acted_at", "imported_at", "class", "closed_at", "closed_by", "disposition"].sort(),
    );
    expect(gaps.checks.map((c) => c.name).sort()).toEqual(["restore_gaps_class", "restore_gaps_closed", "restore_gaps_disposition", "restore_gaps_hash", "restore_gaps_place"]);
    expect(gaps.uniqueConstraints.map((u) => u.name)).toEqual(["restore_gaps_place_key"]);
    expect(gaps.indexes.map((i) => i.config.name)).toEqual(["restore_gaps_open_idx"]);
    expect(gaps.enableRLS).toBe(true);
    const marks = byName.get("copy_marks")!;
    expect(marks.columns.map((c) => c.name).sort()).toEqual(["at", "id", "place", "staff_id"]);
    expect(marks.checks.map((c) => c.name)).toEqual(["copy_marks_place"]);
    expect(marks.enableRLS).toBe(true);
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
    // 3b (Task 2, 0044_imported_posts): an image's import link names a running import only on an imported image. 2d Task 3
    // (0051_avatars): an avatar's place, owner and hash.
    expect(cfg.checks.map((c) => c.name).sort()).toEqual([
      "post_media_alt_len",
      "post_media_attached_is_complete",
      "post_media_avatar_owner",
      "post_media_avatar_sha256",
      "post_media_import_link",
      "post_media_kind_place",
      "post_media_ready_has_dims",
    ]);
    // 3b: the import's images by their job, which the foreign key's set null and the import's own cleanup read.
    // 3b Task 5 (0047): the imports whose images are still on no post, which import-drive's cleanup asks every round.
    // 2d Task 3 (0051_avatars): one avatar a profile, and an owner's avatars.
    expect(cfg.indexes.map((i) => i.config.name).sort()).toEqual([
      "post_media_avatar_idx",
      "post_media_import_job_idx",
      "post_media_import_unattached_idx",
      "post_media_owner_avatar_idx",
      "post_media_owner_created_idx",
      "post_media_post_position_idx",
      "post_media_status_created_idx",
    ]);
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
      // 3d (6.6): a program's finding.
      "intakes_automated",
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
    // 3d (6.6): the new kind and channel compared as text, which parses before the migration's transaction commits.
    expect(checkSql("intakes", "intakes_has_ground")).toBe(
      `"intakes"."rule_id" is not null or "intakes"."alleges_illegal" or "intakes"."csam" or "intakes"."kind"::text = 'automated'`,
    );
    expect(checkSql("intakes", "intakes_finding")).toContain(`("intakes"."kind"::text = 'automated') = ("intakes"."channel"::text = 'system')`);
    expect(checkSql("intakes", "intakes_r2_finding_only")).toBe(`"intakes"."rule_id" is distinct from 'R2' or "intakes"."kind"::text in ('finding', 'automated')`);
    expect(checkSql("intakes", "intakes_automated")).toBe(
      `"intakes"."kind"::text <> 'automated' or ("intakes"."automated_processing" and ("intakes"."rule_id" is null or "intakes"."rule_id" in ('R1', 'R2')) and not "intakes"."alleges_illegal" and not "intakes"."csam" and "intakes"."reporter_id" is null and "intakes"."contact_id" is null and "intakes"."finding_by" is null)`,
    );
  });

  test("every check of decisions, by name, and one review an appeal", () => {
    expect(checks("decisions")).toEqual([
      "decisions_automated_decision",
      "decisions_category",
      "decisions_category_keyword",
      // 3d (6.6): no decider, and only then, means fully automated and interim.
      "decisions_decider",
      "decisions_digests",
      "decisions_ground_law",
      "decisions_ground_rule",
      "decisions_informed",
      "decisions_interim",
      "decisions_keyword",
      "decisions_law_no_rule",
      // 3d Task 7 (note 26): the reason of an answer without a seal on an acting match, one of MATCH_ANSWER_REASONS.
      "decisions_match_answer_reason",
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
      // 3f: an order's record outlives nothing of the ledger; its erasure leaves the decision without its item.
      order_item_id: { table: "legal_order_items", columns: ["id"], onDelete: "set null" },
    });
    // 3d (section 2 row 14, 6.6): a program's decision has no decider; no profile stands for the system.
    expect(column("decisions", "decided_by")?.notNull).toBe(false);
    expect(checkSql("decisions", "decisions_decider")).toBe(
      `("decisions"."decided_by" is null) = ("decisions"."automated_decision" = 'fully') and ("decisions"."decided_by" is not null or "decisions"."kind"::text = 'interim')`,
    );
    expect(checkSql("decisions", "decisions_restricted")).toBe(
      `"decisions"."outcome" <> 'restricted' or ("decisions"."ground" is not null and (("decisions"."facts_digest" is not null and "decisions"."reason_digest" is not null) or "decisions"."decided_by" is null)) or "decisions"."kind"::text = 'order'`,
    );
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
      // 3f: null while its author is not told (an order's held notice), which decisions_informed allows only with no mail.
      ["informed_at", "timestamp with time zone", false, undefined],
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
      // 3f (design, section 6.2): one the trigger forces from the order, one the key signs on a reinstatement.
      ["withhold_author", "boolean", false],
      ["order_ground", "text", false],
    ]);
    // None of the forced columns has a default: the triggers of 0016 and 0021 alone fill them.
    for (const name of ["subject_account_id", "post_id", "reverses_action_id", "no_effect", "created_at", "days", "announced", "basis", "rests_on", "starts_at", "ends_at", "replaced", "withhold_author", "order_ground"]) {
      expect(column("decision_actions", name)?.hasDefault, name).toBe(false);
    }
    const once = byName.get("decision_actions")!.uniqueConstraints.map((u) => [u.getName(), u.columns.map((c) => c.name), u.nullsNotDistinct]);
    expect(once).toEqual([["decision_actions_once", ["decision_id", "kind", "media_id"], true]]);
    const reversed = index("decision_actions", "decision_actions_reversed_once");
    expect(reversed?.unique).toBe(true);
    expect(indexColumns(reversed)).toEqual(["reverses_action_id"]);
    expect(predicate(reversed)).toBe("reverses_action_id is not null");
    expect(checks("decision_actions")).toEqual(["decision_actions_announced", "decision_actions_basis", "decision_actions_days", "decision_actions_no_effect", "decision_actions_order_ground"]);
    expect(checkSql("decision_actions", "decision_actions_order_ground")).toBe(`"decision_actions"."order_ground" in ('withdrawn', 'annulled', 'scrutiny', 'not_authentic', 'wrong_item')`);
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
      // 3f: the measure of an order decision and its reversal.
      "disable_by_order",
      "reinstate_by_order",
      // 2d (Task 4, migration 0052_avatar_kinds): the reset of a profile picture and its reversal.
      "reset_avatar",
      "restore_avatar",
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

  test("posts gain a moderation level and an erasure time; post_state keeps its four values until 3f adds disabled to both", () => {
    const level = column("posts", "moderation_level");
    expect(level?.getSQLType()).toBe("moderation_level");
    expect(level?.notNull).toBe(true);
    expect(level?.default).toBe("visible");
    expect(schema.moderationLevel.enumValues).toEqual(["visible", "withheld", "removed", "disabled"]);
    expect(column("posts", "erased_at")?.getSQLType()).toBe("timestamp with time zone");
    expect(column("posts", "erased_at")?.notNull).toBe(false);
    // A seal is a state of images: no reader of posts learns a state of 3c's. 3f's disabled is answered as a missing post.
    expect(schema.postState.enumValues).toEqual(["visible", "withheld", "removed", "deleted_by_author", "disabled"]);
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
    // 3d adds its kinds after 3c's and 3e's six (3d design, section 6, "The alerts"): Task 1's two, then Task 2's two,
    // then Task 3's one, then Task 5's two, then Task 6's three, then Task 7's two, then the review's one (M13); then 3b
    // Task 5's import_image_flagged, last.
    expect(checkSql("alert_outbox", "alert_outbox_kind")).toContain(
      "'moderation_reveal', 'moderation_csam_lifted', 'quarantine_due', 'quarantine_lost', 'release_undestroyed', 'seal_released', 'edge_purge_failed', 'head_unwitnessed', 'head_missed', 'automated_objection', 'automation_capped', 'automated_waiting', 'matcher_down', 'hold_ended_unreported', 'head_unmailed', 'import_image_flagged')",
    );
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

describe("order records 3f", () => {
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
      .indexes.map((i) => [i.config.name, i.config.columns.map((c) => (c as { name?: string }).name), i.config.unique ?? false, i.config.where ? new PgDialect().sqlToQuery(i.config.where).sql : null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const foreignKeys = (table: string) =>
    byName
      .get(table)!
      .foreignKeys.map((k) => [k.reference().columns.map((c) => c.name).join(","), getTableConfig(k.reference().foreignTable).name, k.onDelete])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const TABLES = ["legal_orders", "legal_order_items", "legal_order_events"];

  test("the three tables are public, with row level security and one allow-all policy for the API role", () => {
    for (const name of TABLES) {
      const cfg = byName.get(name);
      expect(cfg, name).toBeDefined();
      expect(cfg!.schema, name).toBeUndefined();
      expect(cfg!.enableRLS, name).toBe(true);
      expect(policies(name), name).toEqual([[`${name}_api_all`, "all", apiRole]]);
    }
  });

  test("the eight enum values, each last in its type, in the types' order", () => {
    // 2d (Task 4) appends its two kinds after 3f's, so 3f's are the two before them.
    expect(schema.actionKind.enumValues.slice(-4, -2)).toEqual(["disable_by_order", "reinstate_by_order"]);
    expect(schema.decisionKind.enumValues).toEqual(["interim", "final", "review", "correction", "order"]);
    expect(schema.decisionSource.enumValues).toEqual(["notice", "report", "own_initiative", "order"]);
    // 3d (6.6) adds one value after 3f's to each of these two: a program's finding and its channel.
    expect(schema.intakeKind.enumValues).toEqual(["user", "finding", "order", "automated"]);
    expect(schema.intakeChannel.enumValues).toEqual(["signed_in", "signed_out", "staff", "authority", "system"]);
    expect(schema.moderationLevel.enumValues.at(-1)).toBe("disabled");
    expect(schema.postState.enumValues.at(-1)).toBe("disabled");
    // An image follows its post's state in every reader: media_moderation_state gains nothing.
    expect(schema.mediaModerationState.enumValues).toEqual(["visible", "withheld", "removed", "sealed"]);
  });

  test("an order's row: the console's columns, the forced ones, the command line's; Section C without a default", () => {
    expect(shape("legal_orders")).toEqual([
      ["id", "uuid", true],
      ["kind", "text", true],
      ["member_state", "text", true],
      ["authority", "text", true],
      ["reference", "text", true],
      ["channel", "text", true],
      ["message_id", "uuid", false],
      ["received_at", "timestamp with time zone", false],
      ["sent_at", "timestamp with time zone", false],
      ["issued_at", "timestamp with time zone", false],
      ["due_at", "timestamp with time zone", false],
      ["section_c", "boolean", true],
      ["emergency", "boolean", true],
      ["cross_border", "boolean", true],
      ["withhold_from_author", "boolean", true],
      ["preserve", "boolean", true],
      ["authority_hold_until", "timestamp with time zone", false],
      ["hold_basis", "text", false],
      ["hold_extended", "boolean", true],
      ["hold_ended_at", "timestamp with time zone", false],
      ["hold_end_reason", "text", false],
      ["tell_person", "text", false],
      ["tell_person_at", "timestamp with time zone", false],
      ["opened_by", "uuid", false],
      ["opened_via", "text", true],
      ["opened_at", "timestamp with time zone", true],
      ["verified_at", "timestamp with time zone", false],
      ["verified_how", "text", false],
      ["reasons", "text", false],
      ["reasons_salt", "text", false],
      ["reasons_digest", "text", false],
      ["redress", "text", false],
      ["redress_salt", "text", false],
      ["redress_digest", "text", false],
      ["scope", "text", false],
      ["scope_salt", "text", false],
      ["scope_digest", "text", false],
      ["document_sha256", "text", false],
      ["document_bytes", "bigint", false],
      ["closed_at", "timestamp with time zone", false],
      ["imported_at", "timestamp with time zone", false],
    ]);
    // Supplied, so the audit row can name it; no default can decide Section C for a person.
    expect(column("legal_orders", "id")?.hasDefault).toBe(false);
    expect(column("legal_orders", "section_c")?.hasDefault).toBe(false);
    expect(column("legal_orders", "hold_extended")?.default).toBe(false);
    expect(uniques("legal_orders")).toEqual([["legal_orders_reference_key", ["member_state", "authority", "reference"]]]);
    expect(checks("legal_orders")).toEqual([
      "legal_orders_channel",
      "legal_orders_document",
      "legal_orders_hold_end",
      "legal_orders_issued",
      "legal_orders_kind",
      "legal_orders_member_state",
      "legal_orders_names",
      "legal_orders_opened_via",
      "legal_orders_received",
      "legal_orders_tco",
      "legal_orders_tell",
      "legal_orders_texts_len",
    ]);
    expect(checkSql("legal_orders", "legal_orders_kind")).toBe(`"legal_orders"."kind" in ('tco_removal', 'dsa_art9', 'dsa_art10')`);
    expect(checkSql("legal_orders", "legal_orders_channel")).toBe(`"legal_orders"."channel" in ('mailbox', 'portal', 'post', 'other')`);
    expect(checkSql("legal_orders", "legal_orders_received")).toBe(`"legal_orders"."received_at" <= "legal_orders"."opened_at" and "legal_orders"."sent_at" <= "legal_orders"."opened_at"`);
    expect(checkSql("legal_orders", "legal_orders_issued")).toBe(`"legal_orders"."issued_at" <= coalesce("legal_orders"."received_at", "legal_orders"."opened_at")`);
    expect(checkSql("legal_orders", "legal_orders_tco")).toContain(`"legal_orders"."withhold_from_author"`);
    expect(checkSql("legal_orders", "legal_orders_hold_end")).toContain(`'not_authentic', 'annulled', 'released_by_authority', 'not_ordered'`);
    expect(foreignKeys("legal_orders")).toEqual([
      ["message_id", "contact_messages", "restrict"],
      ["opened_by", "profiles", "restrict"],
    ]);
    expect(indexes("legal_orders")).toEqual([["legal_orders_opened_by_idx", ["opened_by", "opened_at"], false, null]]);
  });

  test("an item: its link as named, its post without a key, its position, its closing, and the freeze's index", () => {
    expect(shape("legal_order_items")).toEqual([
      ["id", "uuid", true],
      ["order_id", "uuid", true],
      ["position", "smallint", true],
      ["link", "text", true],
      ["post_id", "uuid", false],
      ["added_at", "timestamp with time zone", true],
      ["intake_item_id", "uuid", false],
      ["decision_id", "uuid", false],
      ["action_id", "uuid", false],
      ["disabled_at", "timestamp with time zone", false],
      ["preserve_until", "timestamp with time zone", false],
      ["preserve_ended_at", "timestamp with time zone", false],
      ["reinstated_at", "timestamp with time zone", false],
      ["closed_at", "timestamp with time zone", false],
      ["closed_reason", "text", false],
    ]);
    expect(uniques("legal_order_items")).toEqual([["legal_order_items_position_key", ["order_id", "position"]]]);
    expect(checks("legal_order_items")).toEqual(["legal_order_items_closed", "legal_order_items_link", "legal_order_items_position"]);
    expect(checkSql("legal_order_items", "legal_order_items_closed")).toContain(`'no_post', 'not_named', 'withdrawn'`);
    expect(checkSql("legal_order_items", "legal_order_items_closed")).toContain(`"legal_order_items"."disabled_at" is null`);
    expect(indexes("legal_order_items")).toEqual([
      ["legal_order_items_post_key", ["order_id", "post_id"], true, "post_id is not null"],
      ["legal_order_items_preserved_idx", ["post_id"], false, "preserve_until is not null"],
    ]);
    // A record outlives its post: post_id has no key.
    expect(foreignKeys("legal_order_items")).toEqual([
      ["intake_item_id", "intake_items", "restrict"],
      ["order_id", "legal_orders", "restrict"],
    ]);
  });

  test("an event: its kind, its ground by its kind, its times, who and how; an order is opened once", () => {
    expect(shape("legal_order_events")).toEqual([
      ["id", "uuid", true],
      ["order_id", "uuid", true],
      ["item_id", "uuid", false],
      ["kind", "text", true],
      ["at", "timestamp with time zone", true],
      ["effective_at", "timestamp with time zone", false],
      ["ground", "text", false],
      ["by_staff", "uuid", false],
      ["via", "text", true],
    ]);
    expect(checks("legal_order_events")).toEqual(["legal_order_events_effective", "legal_order_events_ground", "legal_order_events_kind", "legal_order_events_via"]);
    const ground = checkSql("legal_order_events", "legal_order_events_ground");
    expect(ground).toContain(`(kind = 'annex3_sent' and ground in ('force_majeure', 'manifest_error', 'insufficient_information'))`);
    expect(ground).toContain(`(kind = 'corrected' and ground in ('entry', 'caution', 'admin'))`);
    // 3f's review (people2): the text a texts_recorded event wrote; one written before has none.
    expect(ground).toContain(`(kind = 'texts_recorded' and ground in ('reasons', 'redress', 'scope'))`);
    expect(ground).toContain(`and ground is null)`);
    expect(indexes("legal_order_events")).toEqual([
      ["legal_order_events_opened_key", ["order_id"], true, "kind = 'opened'"],
      ["legal_order_events_order_idx", ["order_id", "at"], false, null],
    ]);
    expect(foreignKeys("legal_order_events")).toEqual([
      ["by_staff", "profiles", "restrict"],
      ["item_id", "legal_order_items", "restrict"],
      ["order_id", "legal_orders", "restrict"],
    ]);
  });

  test("decisions: the two checks re-added for an order decision, compared as text, and decisions_informed", () => {
    const sqlOf = (name: string) => new PgDialect().sqlToQuery(byName.get("decisions")!.checks.find((c) => c.name === name)!.value).sql;
    expect(sqlOf("decisions_restricted")).toMatch(/ or "decisions"."kind"::text = 'order'$/);
    expect(sqlOf("decisions_ground_law")).toMatch(/ or "decisions"."kind"::text = 'order'$/);
    expect(sqlOf("decisions_informed")).toBe(`"decisions"."informed_at" is not null or "decisions"."author_mail"::text = 'none'`);
  });
});

/**
 * 3b, import from other platforms (design, sections 6.1 to 6.4 and 6.7; Task 2): the three tables of 0043_imports, the
 * columns of posts and post_media that 0044_imported_posts adds, and the readers' indexes of 0045_import_readers, as the
 * schema declares them and drizzle writes them. The CHECKs hold the contracts' numbers and lists as literals (this
 * package does not depend on @korbat/contracts); apps/api's import-schema.test.ts holds the migrated ones equal to them.
 */
describe("import from other platforms 3b", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  const checks = (table: string) => byName.get(table)!.checks.map((c) => c.name).sort();
  const checkSql = (table: string, name: string) => new PgDialect().sqlToQuery(byName.get(table)!.checks.find((c) => c.name === name)!.value).sql;
  const policies = (table: string) => byName.get(table)!.policies.map((p) => [p.name, p.for, p.to]);
  /** Name, columns, unique and predicate of every index, by name. */
  const indexes = (table: string) =>
    byName
      .get(table)!
      .indexes.map((i) => [i.config.name, i.config.columns.map((c) => (c as { name?: string }).name), i.config.unique ?? false, i.config.where ? new PgDialect().sqlToQuery(i.config.where).sql : null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const foreignKeys = (table: string) =>
    byName
      .get(table)!
      .foreignKeys.map((k) => [k.reference().columns.map((c) => c.name).join(","), getTableConfig(k.reference().foreignTable).name, k.onDelete])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const TABLES = ["import_jobs", "import_picks", "import_keys"];

  test("the three tables are public, with row level security and one allow-all policy for the API role", () => {
    for (const name of TABLES) {
      const cfg = byName.get(name);
      expect(cfg, name).toBeDefined();
      expect(cfg!.schema, name).toBeUndefined();
      expect(cfg!.enableRLS, name).toBe(true);
      expect(policies(name), name).toEqual([[`${name}_api_all`, "all", apiRole]]);
    }
  });

  test("the two enums: the three sources, and the twelve states in the order of section 4.1", () => {
    expect(schema.importSource.enumName).toBe("import_source");
    expect(schema.importSource.enumValues).toEqual(["x", "mastodon", "bluesky"]);
    expect(schema.importStatus.enumName).toBe("import_status");
    expect(schema.importStatus.enumValues).toEqual(["uploading", "scanning", "ready", "preparing", "publishing", "done", "stopped", "undoing", "undone", "failed", "cancelled", "expired"]);
  });

  test("import_jobs: every column of 6.1 in its order, the counts and cursors at zero, the state uploading by default", () => {
    expect(shape("import_jobs")).toEqual([
      ["id", "uuid", true],
      ["owner_id", "uuid", true],
      ["source", "import_source", true],
      ["status", "import_status", true],
      ["declared_bytes", "bigint", true],
      ["received_bytes", "bigint", true],
      ["created_at", "timestamp with time zone", true],
      ["uploaded_at", "timestamp with time zone", false],
      ["scanned_at", "timestamp with time zone", false],
      ["confirmed_at", "timestamp with time zone", false],
      ["ended_at", "timestamp with time zone", false],
      ["failure", "text", false],
      ["stop_reason", "text", false],
      ["staff_ended_at", "timestamp with time zone", false],
      ["staff_rule_id", "text", false],
      // 3b Task 6 (migration 0048): the case an admin ended the import from and the decision the end rests on.
      ["staff_case_id", "uuid", false],
      ["staff_decision_id", "uuid", false],
      ["refused_at_original", "date", false],
      ["refused_words", "text", false],
      ["scan", "jsonb", false],
      ["choice", "jsonb", false],
      ["stated_at", "timestamp with time zone", false],
      ["seed", "bytea", false],
      ["post_cursor", "integer", true],
      ["image_cursor", "integer", true],
      ["posts_published", "integer", true],
      ["images_kept", "integer", true],
      ["images_left_out", "integer", true],
      ["posts_removed", "integer", true],
      // 3b Task 4 (migration 0046): whether the import brings images, decided at its creation and never changed.
      ["images", "boolean", true],
      // 3b Task 5 (migration 0047): the images the preparation left out, by reason.
      ["images_left_out_by", "jsonb", true],
    ]);
    expect(column("import_jobs", "images")?.default).toBe(false);
    // The API makes the id (it names the import's folders): no default. The insert trigger forces the rest.
    expect(column("import_jobs", "id")?.primary).toBe(true);
    expect(column("import_jobs", "id")?.hasDefault).toBe(false);
    expect(column("import_jobs", "status")?.default).toBe("uploading");
    for (const name of ["received_bytes", "post_cursor", "image_cursor", "posts_published", "images_kept", "images_left_out", "posts_removed"]) {
      expect(column("import_jobs", name)?.default, name).toBe(0);
    }
    // No on delete clause: no profile row is ever deleted. 3b Task 6: the staff end's case and decision name no table.
    expect(foreignKeys("import_jobs")).toEqual([["owner_id", "profiles", "no action"]]);
  });

  test("import_jobs: its CHECKs, each list and number of 6.1 and 9.3 written out", () => {
    expect(checks("import_jobs")).toEqual([
      "import_jobs_choice",
      "import_jobs_counts",
      "import_jobs_declared_bytes",
      "import_jobs_failed",
      "import_jobs_failure",
      "import_jobs_left_out_by",
      "import_jobs_received_bytes",
      "import_jobs_refused",
      "import_jobs_refused_words",
      "import_jobs_scan",
      "import_jobs_seed",
      "import_jobs_staff",
      "import_jobs_stated",
      "import_jobs_stop_reason",
      "import_jobs_stopped",
    ]);
    expect(checkSql("import_jobs", "import_jobs_declared_bytes")).toBe(`"import_jobs"."declared_bytes" between 1 and 2147483648`);
    expect(checkSql("import_jobs", "import_jobs_received_bytes")).toBe(`"import_jobs"."received_bytes" between 0 and "import_jobs"."declared_bytes"`);
    expect(checkSql("import_jobs", "import_jobs_failure")).toBe(
      `"import_jobs"."failure" in ('not_this_source', 'not_an_archive', 'tar_gz', 'partial_archive', 'encrypted', 'too_many_entries', 'too_large_uncompressed', 'bad_entry_name', 'unreadable', 'nothing_to_import', 'scan_timed_out', 'interrupted')`,
    );
    // The state is compared as text, as every enum of 3b is (section 6).
    expect(checkSql("import_jobs", "import_jobs_failed")).toBe(`("import_jobs"."status"::text = 'failed') = ("import_jobs"."failure" is not null)`);
    expect(checkSql("import_jobs", "import_jobs_stop_reason")).toBe(`"import_jobs"."stop_reason" in ('refused_image', 'by_author', 'by_staff', 'time_ran_out')`);
    expect(checkSql("import_jobs", "import_jobs_stopped")).toBe(
      `("import_jobs"."status"::text <> 'stopped' or "import_jobs"."stop_reason" is not null) and ("import_jobs"."stop_reason" is null or "import_jobs"."status"::text in ('stopped', 'undoing', 'undone'))`,
    );
    // 3b Task 6 (0048): the staff end's four columns together.
    expect(checkSql("import_jobs", "import_jobs_staff")).toBe(
      `("import_jobs"."staff_ended_at" is null) = ("import_jobs"."staff_rule_id" is null) and ("import_jobs"."staff_ended_at" is null) = ("import_jobs"."staff_case_id" is null) and ("import_jobs"."staff_ended_at" is null) = ("import_jobs"."staff_decision_id" is null)`,
    );
    expect(checkSql("import_jobs", "import_jobs_refused")).toBe(`("import_jobs"."refused_at_original" is null) = ("import_jobs"."refused_words" is null)`);
    expect(checkSql("import_jobs", "import_jobs_refused_words")).toBe(`char_length("import_jobs"."refused_words") <= 80`);
    expect(checkSql("import_jobs", "import_jobs_scan")).toBe(`jsonb_typeof("import_jobs"."scan") = 'object' and octet_length("import_jobs"."scan"::text) <= 262144`);
    expect(checkSql("import_jobs", "import_jobs_choice")).toBe(`jsonb_typeof("import_jobs"."choice") = 'object' and octet_length("import_jobs"."choice"::text) <= 1024`);
    expect(checkSql("import_jobs", "import_jobs_stated")).toBe(`("import_jobs"."choice" is null) = ("import_jobs"."stated_at" is null)`);
    expect(checkSql("import_jobs", "import_jobs_seed")).toBe(`octet_length("import_jobs"."seed") = 32`);
    // 3b Task 5 (0047): an object of IMPORT_IMAGE_SKIPS' reasons in at most 1,024 bytes.
    expect(checkSql("import_jobs", "import_jobs_left_out_by")).toBe(
      `jsonb_typeof("import_jobs"."images_left_out_by") = 'object' and octet_length("import_jobs"."images_left_out_by"::text) <= 1024 and ("import_jobs"."images_left_out_by" - array['video', 'sensitive', 'unsupported', 'too_large', 'missing_file', 'bluesky_no_files', 'images_off', 'not_chosen', 'no_description', 'over_image_cap', 'failed', 'not_checked', 'flagged']) = '{}'::jsonb`,
    );
    expect(checkSql("import_jobs", "import_jobs_counts")).toBe(
      `"import_jobs"."post_cursor" >= 0 and "import_jobs"."image_cursor" >= 0 and "import_jobs"."posts_published" >= 0 and "import_jobs"."images_kept" >= 0 and "import_jobs"."images_left_out" >= 0 and "import_jobs"."posts_removed" >= 0`,
    );
  });

  test("import_jobs: one active import an account, import-drive's index and the account's list", () => {
    expect(indexes("import_jobs")).toEqual([
      ["import_jobs_one_active", ["owner_id"], true, "status in ('uploading', 'scanning', 'ready', 'preparing', 'publishing')"],
      ["import_jobs_owner_idx", ["owner_id", "created_at"], false, null],
      ["import_jobs_status_idx", ["status", "created_at"], false, null],
    ]);
  });

  test("import_picks: one pick a line of a job, gone with its job; at most four descriptions in 16,384 bytes", () => {
    expect(shape("import_picks")).toEqual([
      ["import_job_id", "uuid", true],
      ["ref", "integer", true],
      ["left_out", "boolean", true],
      ["alts", "jsonb", false],
      // 3b Task 4 (migration 0046): the picked line's month, marks and described images, from which the picks' counts are summed.
      ["month", "text", true],
      ["marks", "smallint", true],
      ["described", "smallint", true],
    ]);
    expect(column("import_picks", "left_out")?.default).toBe(false);
    expect(column("import_picks", "described")?.default).toBe(0);
    const keys = byName.get("import_picks")!.primaryKeys;
    expect(keys.map((k) => k.columns.map((c) => c.name))).toEqual([["import_job_id", "ref"]]);
    expect(foreignKeys("import_picks")).toEqual([["import_job_id", "import_jobs", "cascade"]]);
    expect(checks("import_picks")).toEqual(["import_picks_alts", "import_picks_described", "import_picks_marks", "import_picks_month"]);
    expect(checkSql("import_picks", "import_picks_month")).toBe(`"import_picks"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`);
    expect(checkSql("import_picks", "import_picks_marks")).toBe(`"import_picks"."marks" between 0 and 15`);
    expect(checkSql("import_picks", "import_picks_described")).toBe(`"import_picks"."described" between 0 and 4`);
    expect(checkSql("import_picks", "import_picks_alts")).toBe(
      `case jsonb_typeof("import_picks"."alts") when 'array' then jsonb_array_length("import_picks"."alts") <= 4 and octet_length("import_picks"."alts"::text) <= 16384 else "import_picks"."alts" is null end`,
    );
    expect(indexes("import_picks")).toEqual([]);
  });

  test("import_keys: one key of 32 bytes an account, never updated, erased with the account", () => {
    expect(shape("import_keys")).toEqual([
      ["owner_id", "uuid", true],
      ["key", "bytea", true],
      ["created_at", "timestamp with time zone", true],
    ]);
    expect(column("import_keys", "owner_id")?.primary).toBe(true);
    expect(foreignKeys("import_keys")).toEqual([["owner_id", "profiles", "no action"]]);
    expect(checks("import_keys")).toEqual(["import_keys_key"]);
    expect(checkSql("import_keys", "import_keys_key")).toBe(`octet_length("import_keys"."key") = 32`);
  });

  test("posts gain the five import columns, all null or all set, and five indexes: the key, the job, the Imported tab, the native posts and Latest without imports", () => {
    for (const [name, type] of [
      ["import_job_id", "uuid"],
      ["import_source", "import_source"],
      ["original_created_at", "timestamp with time zone"],
      ["import_shortened", "boolean"],
      ["import_key", "bytea"],
    ] as const) {
      expect(column("posts", name)?.getSQLType(), name).toBe(type);
      expect(column("posts", name)?.notNull, name).toBe(false);
      expect(column("posts", name)?.hasDefault, name).toBe(false);
    }
    // The five columns after Explore's three; 2d's hide_counts (0050_post_options) follows them as the last.
    expect(shape("posts").slice(-6, -1).map(([name]) => name)).toEqual(["import_job_id", "import_source", "original_created_at", "import_shortened", "import_key"]);
    expect(checks("posts")).toEqual(["posts_body_len", "posts_counts_nonnegative", "posts_import_columns"]);
    expect(checkSql("posts", "posts_import_columns")).toBe(
      `("posts"."import_job_id" is null) = ("posts"."import_source" is null) and ("posts"."import_job_id" is null) = ("posts"."original_created_at" is null) and ("posts"."import_job_id" is null) = ("posts"."import_shortened" is null) and ("posts"."import_job_id" is null) = ("posts"."import_key" is null)`,
    );
    // No on delete clause on the job: a job row cannot go while a post names it.
    expect(foreignKeys("posts").filter(([columns]) => columns === "import_job_id")).toEqual([["import_job_id", "import_jobs", "no action"]]);
    const imports = indexes("posts").filter(([name]) => ["posts_import_key_idx", "posts_import_job_idx", "posts_imported_idx", "posts_author_native_idx", "posts_latest_idx"].includes(String(name)));
    expect(imports).toEqual([
      ["posts_author_native_idx", ["author_id", "created_at", "id"], false, "import_job_id is null"],
      ["posts_import_job_idx", ["import_job_id", "id"], false, "import_job_id is not null"],
      ["posts_import_key_idx", ["author_id", "import_key"], true, "import_key is not null"],
      ["posts_imported_idx", ["author_id", "original_created_at", "id"], false, "import_job_id is not null and reply_to_id is null"],
      // Latest leaves imported posts out (6.2): the index is replaced with the clause added to its predicate.
      ["posts_latest_idx", ["created_at", "id"], false, "reply_to_id is null and state = 'visible' and import_job_id is null"],
    ]);
    expect(indexes("posts").map(([name]) => name)).toEqual([
      "posts_author_created_idx",
      "posts_author_native_idx",
      "posts_created_id_idx",
      "posts_explore_from_idx",
      "posts_import_job_idx",
      "posts_import_key_idx",
      "posts_imported_idx",
      "posts_latest_idx",
      "posts_quote_of_idx",
      "posts_reply_to_created_idx",
    ]);
  });

  test("post_media gains imported (false by default) and the running import's id, set null when the job row goes", () => {
    // 2d Task 3 (0051_avatars) adds three columns after these two.
    expect(shape("post_media").slice(-5, -3)).toEqual([
      ["imported", "boolean", true],
      ["import_job_id", "uuid", false],
    ]);
    expect(column("post_media", "imported")?.default).toBe(false);
    expect(foreignKeys("post_media").filter(([columns]) => columns === "import_job_id")).toEqual([["import_job_id", "import_jobs", "set null"]]);
    expect(checkSql("post_media", "post_media_import_link")).toBe(`"post_media"."import_job_id" is null or "post_media"."imported"`);
    expect(indexes("post_media").filter(([name]) => name === "post_media_import_job_idx")).toEqual([["post_media_import_job_idx", ["import_job_id", "id"], false, "import_job_id is not null"]]);
    // 3b Task 5 (0047): the rows on their way to a post, by import.
    expect(indexes("post_media").filter(([name]) => name === "post_media_import_unattached_idx")).toEqual([
      ["post_media_import_unattached_idx", ["import_job_id"], false, "import_job_id is not null and post_id is null"],
    ]);
  });
});

/**
 * 2d, engagement (design, sections 6.1 to 6.4; Task 1): the three tables of 0049_activity and the two switches of
 * 0050_post_options, as the schema declares them and drizzle writes them. The CHECKs and enums hold the contracts' lists
 * and numbers as literals (this package does not depend on @korbat/contracts: ACTIVITY_KINDS, ACTIVITY_REACH and
 * MENTION_STORE_MAX); apps/api's activity-schema.test.ts holds the migrated ones equal to them.
 */
describe("engagement 2d", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  const checks = (table: string) => byName.get(table)!.checks.map((c) => c.name).sort();
  const checkSql = (table: string, name: string) => new PgDialect().sqlToQuery(byName.get(table)!.checks.find((c) => c.name === name)!.value).sql;
  const policies = (table: string) => byName.get(table)!.policies.map((p) => [p.name, p.for, p.to]);
  /** Name, columns, unique, predicate and method of every index, by name. */
  const indexes = (table: string) =>
    byName
      .get(table)!
      .indexes.map((i) => [
        i.config.name,
        i.config.columns.map((c) => (c as { name?: string }).name),
        i.config.unique ?? false,
        i.config.where ? new PgDialect().sqlToQuery(i.config.where).sql : null,
        i.config.method ?? "btree",
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const foreignKeys = (table: string) =>
    byName
      .get(table)!
      .foreignKeys.map((k) => [k.reference().columns.map((c) => c.name).join(","), getTableConfig(k.reference().foreignTable).name, k.onDelete])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const TABLES = ["activity_items", "activity_state", "post_mentions"];

  test("the three tables are public, with row level security and one allow-all policy for the API role", () => {
    for (const name of TABLES) {
      const cfg = byName.get(name);
      expect(cfg, name).toBeDefined();
      expect(cfg!.schema, name).toBeUndefined();
      expect(cfg!.enableRLS, name).toBe(true);
      expect(policies(name), name).toEqual([[`${name}_api_all`, "all", apiRole]]);
    }
  });

  test("the two enums: the four kinds of entry and the four reaches, in the contracts' order", () => {
    expect(schema.activityKind.enumName).toBe("activity_kind");
    expect(schema.activityKind.enumValues).toEqual(["reply", "mention", "quote", "follow"]);
    expect(schema.activityReach.enumName).toBe("activity_reach");
    expect(schema.activityReach.enumValues).toEqual(["everyone", "older", "following", "off"]);
  });

  test("activity_items (6.1): ids and a kind, never a text; a post exactly when it is not a follow, never one's own act", () => {
    expect(shape("activity_items")).toEqual([
      ["id", "uuid", true],
      ["recipient_id", "uuid", true],
      ["kind", "activity_kind", true],
      ["actor_id", "uuid", true],
      ["post_id", "uuid", false],
      ["created_at", "timestamp with time zone", true],
    ]);
    expect(column("activity_items", "id")?.primary).toBe(true);
    expect(column("activity_items", "id")?.hasDefault).toBe(true);
    // activity_items_insert forces it to now() for every role but the migrator; the default serves the migrator.
    expect(column("activity_items", "created_at")?.hasDefault).toBe(true);
    // No on delete clause on the two profiles: no profile row is ever deleted, and the purge deletes the rows. The post's
    // rows go with it.
    expect(foreignKeys("activity_items")).toEqual([
      ["actor_id", "profiles", "no action"],
      ["post_id", "posts", "cascade"],
      ["recipient_id", "profiles", "no action"],
    ]);
    expect(checks("activity_items")).toEqual(["activity_items_not_self", "activity_items_post"]);
    // The kind is compared as text, as 2d compares every enum (section 6).
    expect(checkSql("activity_items", "activity_items_post")).toBe(`("activity_items"."kind"::text = 'follow') = ("activity_items"."post_id" is null)`);
    expect(checkSql("activity_items", "activity_items_not_self")).toBe(`"activity_items"."recipient_id" <> "activity_items"."actor_id"`);
  });

  test("activity_items: the list and its count, one entry per recipient and post, one follow entry per pair, deletePost's, block's and the purge's lookups, and a BRIN index for retention", () => {
    expect(indexes("activity_items")).toEqual([
      ["activity_items_actor_idx", ["actor_id"], false, null, "btree"],
      ["activity_items_created_brin", ["created_at"], false, null, "brin"],
      // A label of the enum, not text: an index predicate takes only immutable expressions, and the type is new in the
      // same migration, so its labels are usable at once.
      ["activity_items_follow_once", ["recipient_id", "actor_id"], true, "kind = 'follow'", "btree"],
      ["activity_items_post_idx", ["post_id"], false, "post_id is not null", "btree"],
      ["activity_items_post_once", ["recipient_id", "post_id"], true, "post_id is not null", "btree"],
      ["activity_items_recipient_idx", ["recipient_id", "created_at", "id"], false, null, "btree"],
    ]);
  });

  test("activity_state (6.2): the seen marker, null until the first visit, the three reaches at everyone and the follow switch on; no updated_at", () => {
    expect(shape("activity_state")).toEqual([
      ["account_id", "uuid", true],
      ["seen_at", "timestamp with time zone", false],
      ["replies", "activity_reach", true],
      ["mentions", "activity_reach", true],
      ["quotes", "activity_reach", true],
      ["follows", "boolean", true],
    ]);
    expect(column("activity_state", "account_id")?.primary).toBe(true);
    expect(column("activity_state", "seen_at")?.hasDefault).toBe(false);
    for (const name of ["replies", "mentions", "quotes"]) expect(column("activity_state", name)?.default, name).toBe("everyone");
    expect(column("activity_state", "follows")?.default).toBe(true);
    expect(foreignKeys("activity_state")).toEqual([["account_id", "profiles", "no action"]]);
    expect(checks("activity_state")).toEqual([]);
    expect(indexes("activity_state")).toEqual([]);
  });

  test("post_mentions (6.3): the post, the account named and the handle as written, by position; a CHECK each, keyed by post and account, one position each, and the purge's index", () => {
    expect(shape("post_mentions")).toEqual([
      ["post_id", "uuid", true],
      ["account_id", "uuid", true],
      ["handle", "text", true],
      ["position", "smallint", true],
    ]);
    const keys = byName.get("post_mentions")!.primaryKeys;
    expect(keys.map((k) => k.columns.map((c) => c.name))).toEqual([["post_id", "account_id"]]);
    expect(foreignKeys("post_mentions")).toEqual([
      ["account_id", "profiles", "no action"],
      ["post_id", "posts", "cascade"],
    ]);
    // The unique index has the name post_mentions_position, so the position's CHECK takes another.
    expect(checks("post_mentions")).toEqual(["post_mentions_handle", "post_mentions_position_range"]);
    expect(checkSql("post_mentions", "post_mentions_handle")).toBe(`"post_mentions"."handle" ~ '^[a-z0-9_]{3,20}$'`);
    // MENTION_STORE_MAX - 1.
    expect(checkSql("post_mentions", "post_mentions_position_range")).toBe(`"post_mentions"."position" between 0 and 19`);
    expect(indexes("post_mentions")).toEqual([
      ["post_mentions_account_idx", ["account_id"], false, null, "btree"],
      ["post_mentions_position", ["post_id", "position"], true, null, "btree"],
    ]);
  });

  test("Task 3 (6.4, 0051_avatars): post_media gains its kind, the profile it is the avatar of and an avatar's SHA-256, last; profiles lose avatar_path", () => {
    expect(schema.mediaKind.enumName).toBe("media_kind");
    expect(schema.mediaKind.enumValues).toEqual(["post", "avatar"]);
    expect(shape("post_media").slice(-3)).toEqual([
      ["kind", "media_kind", true],
      ["profile_id", "uuid", false],
      ["avatar_sha256", "text", false],
    ]);
    expect(column("post_media", "kind")?.default).toBe("post");
    // No on delete clause: no profile row is ever deleted, and the purge deletes the account's image rows itself.
    expect(foreignKeys("post_media").filter(([columns]) => columns === "profile_id")).toEqual([["profile_id", "profiles", "no action"]]);
    // Each kind in its place: an avatar on no post, without a position or a description; a post's image never a profile's.
    expect(checkSql("post_media", "post_media_kind_place")).toBe(
      `("post_media"."kind"::text = 'post' and "post_media"."profile_id" is null) or ("post_media"."kind"::text = 'avatar' and "post_media"."post_id" is null and "post_media"."position" is null and "post_media"."alt_text" is null)`,
    );
    expect(checkSql("post_media", "post_media_avatar_owner")).toBe(`"post_media"."profile_id" is null or "post_media"."profile_id" = "post_media"."owner_id"`);
    expect(checkSql("post_media", "post_media_avatar_sha256")).toBe(
      `("post_media"."kind"::text = 'post' and "post_media"."avatar_sha256" is null) or ("post_media"."kind"::text = 'avatar' and "post_media"."avatar_sha256" is not null and "post_media"."avatar_sha256" ~ '^[0-9a-f]{64}$')`,
    );
    // A label of the new enum in the owner's index, as 0049 names activity_kind's: an index predicate takes no cast to text.
    expect(indexes("post_media").filter(([name]) => name === "post_media_avatar_idx" || name === "post_media_owner_avatar_idx")).toEqual([
      ["post_media_avatar_idx", ["profile_id"], true, "profile_id is not null", "btree"],
      ["post_media_owner_avatar_idx", ["owner_id"], false, "kind = 'avatar'", "btree"],
    ]);
    expect(byName.get("profiles")!.columns.map((c) => c.name)).not.toContain("avatar_path");
  });

  test("Task 4 (6.5, 0053_avatar_moderation): seal_avatars, avatar_reviews and avatar_resets are public, with row level security and one allow-all policy for the API role", () => {
    // The grants restrict the API role to SELECT on each (6.6's REVOKEs, in the migration), as seal_posts' do.
    for (const name of ["seal_avatars", "avatar_reviews", "avatar_resets"]) {
      const cfg = byName.get(name);
      expect(cfg, name).toBeDefined();
      expect(cfg!.schema, name).toBeUndefined();
      expect(cfg!.enableRLS, name).toBe(true);
      expect(policies(name), name).toEqual([[`${name}_api_all`, "all", apiRole]]);
    }
  });

  test("seal_avatars (6.5): the avatars a seal listed, as seal_posts lists its posts, keyed by both, with no key to the image, which may go", () => {
    expect(shape("seal_avatars")).toEqual([
      ["action_id", "uuid", true],
      ["media_id", "uuid", true],
    ]);
    expect(byName.get("seal_avatars")!.primaryKeys.map((k) => k.columns.map((c) => c.name))).toEqual([["action_id", "media_id"]]);
    expect(foreignKeys("seal_avatars")).toEqual([["action_id", "decision_actions", "restrict"]]);
    expect(checks("seal_avatars")).toEqual([]);
    // The keep trigger's and the disposal's probe: is this avatar listed by a seal.
    expect(indexes("seal_avatars")).toEqual([["seal_avatars_media_idx", ["media_id"], false, null, "btree"]]);
  });

  test("avatar_reviews (6.5, 7.6): R1's hold for review of one avatar, under the finding's item, which the deciding transaction looks up", () => {
    expect(shape("avatar_reviews")).toEqual([
      ["media_id", "uuid", true],
      ["item_id", "uuid", true],
    ]);
    expect(column("avatar_reviews", "media_id")?.primary).toBe(true);
    expect(foreignKeys("avatar_reviews")).toEqual([["item_id", "intake_items", "restrict"]]);
    expect(checks("avatar_reviews")).toEqual([]);
    expect(indexes("avatar_reviews")).toEqual([["avatar_reviews_item_idx", ["item_id"], false, null, "btree"]]);
  });

  test("avatar_resets (6.5, 7.7): the reset picture's SHA-256 and the end of its 30 days, one a reset, read by the account", () => {
    expect(shape("avatar_resets")).toEqual([
      ["action_id", "uuid", true],
      ["account_id", "uuid", true],
      ["sha256", "text", true],
      ["until", "timestamp with time zone", true],
    ]);
    expect(column("avatar_resets", "action_id")?.primary).toBe(true);
    expect(foreignKeys("avatar_resets")).toEqual([["action_id", "decision_actions", "restrict"]]);
    expect(checks("avatar_resets")).toEqual(["avatar_resets_sha256"]);
    expect(checkSql("avatar_resets", "avatar_resets_sha256")).toBe(`"avatar_resets"."sha256" ~ '^[0-9a-f]{64}$'`);
    // setAvatar's read: this account's resets whose 30 days are ahead.
    expect(indexes("avatar_resets")).toEqual([["avatar_resets_account_idx", ["account_id", "until"], false, null, "btree"]]);
  });

  test("releases gain avatar_ids (6.5): the released seal's avatars beside its posts, empty by default, last", () => {
    expect(shape("releases").at(-1)).toEqual(["avatar_ids", "uuid[]", true]);
    expect(column("releases", "avatar_ids")?.hasDefault).toBe(true);
  });

  test("posts gain hide_counts and profiles share_previews (6.4), each off by default and the last column of its table", () => {
    for (const [table, name] of [
      ["posts", "hide_counts"],
      ["profiles", "share_previews"],
    ] as const) {
      expect(column(table, name)?.getSQLType(), name).toBe("boolean");
      expect(column(table, name)?.notNull, name).toBe(true);
      expect(column(table, name)?.default, name).toBe(false);
      expect(shape(table).at(-1)?.[0], name).toBe(name);
    }
  });
});
