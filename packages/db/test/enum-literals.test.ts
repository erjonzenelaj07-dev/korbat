import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { actionKind } from "../src/schema/moderation";

/**
 * The rule for the new values of action_kind (3e design, section 6, "The rule for the new enum values"; invariant 1).
 * drizzle's migrator runs every pending migration in one transaction, and a value that ALTER TYPE ... ADD VALUE added
 * cannot be used as an enum literal before that transaction commits (SQLSTATE 55P04) in anything that is parsed when it
 * is created or run: a view, an SQL-language function, a check, a default, an index predicate, a plain statement. Only a
 * PL/pgSQL body is parsed when it is first called, which no migration statement does. So in 3e's migrations a new value
 * appears as a literal only inside a PL/pgSQL function's body, and everywhere else a kind is compared as text
 * (`kind::text = 'strike'`). This test reads 3e's migration files and refuses any other use.
 *
 * The SQL is read statement by statement, its comments dropped, and every run of white space made one space, so the
 * patterns below need no escapes.
 */

const MIGRATIONS = path.resolve(import.meta.dirname, "../migrations");

/** 3c's twelve kinds come first in the enum; 3e's ten follow them, and 3f's two follow those (read below). */
const OLD_KINDS = 12;
const KINDS_3E = 10;
const NEW_KINDS: readonly string[] = actionKind.enumValues.slice(OLD_KINDS, OLD_KINDS + KINDS_3E);

/** 3e's first migration: 3c ended at 0019_redaction_scope, so 3e's migrations are 0020 and after. */
const FIRST_3E_MIGRATION = 20;

const NEWLINE = String.fromCharCode(10);
const BREAKPOINT = "--> statement-breakpoint";

/** The journal's entries of 3e's migrations, oldest first. */
function migrationsOf3e(): { idx: number; tag: string }[] {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  return journal.entries.filter((entry) => entry.idx >= FIRST_3E_MIGRATION);
}

/** A statement with its line comments dropped: a comment may name a kind in any words it likes. */
function withoutComments(statement: string): string {
  return statement
    .split(NEWLINE)
    .map((line) => {
      const at = line.indexOf("--");
      return at < 0 ? line : line.slice(0, at);
    })
    .join(NEWLINE);
}

/** Every run of white space (a code point up to the space) as one space, trimmed. */
function flat(text: string): string {
  return [...text]
    .map((char) => (char.charCodeAt(0) <= 32 ? " " : char))
    .join("")
    .split(" ")
    .filter((word) => word !== "")
    .join(" ");
}

/**
 * A statement with the body of a PL/pgSQL function blanked, so that only what is parsed at once is left: a statement that
 * creates a function in LANGUAGE plpgsql keeps its signature and loses what lies between its outer dollar quotes. A DO
 * block keeps its body: it runs inside the migration, and its literals are parsed then.
 */
function withoutPlpgsqlBody(statement: string): string {
  const upper = statement.toUpperCase();
  const creates = upper.startsWith("CREATE FUNCTION") || upper.startsWith("CREATE OR REPLACE FUNCTION");
  if (!creates || !upper.includes("LANGUAGE PLPGSQL")) return statement;
  const open = statement.indexOf("$$");
  const close = statement.lastIndexOf("$$");
  if (open < 0 || close <= open) return statement;
  return `${statement.slice(0, open + 2)} ${statement.slice(close)}`;
}

/**
 * The places where a literal is compared as text: `::text` followed by `=`, `<>`, `IN (` or `= ANY (ARRAY[` and then a
 * list of quoted words. A new kind's literal there is a text, and parses whatever the enum holds.
 */
const TEXT_COMPARISON = /::text ?(?:=|<>|!=|in ?[(]|= ?any ?[(] ?array ?[[]) ?'[a-z_]+'(?: ?, ?'[a-z_]+')*/gi;

/** The statement that adds a value names it, as a label and not as a literal of the enum. */
const ADDED_VALUE = /alter type [^ ]+ add value '[a-z_]+'/gi;

/** Every use of a new kind's literal in the SQL that is outside a PL/pgSQL body and not compared as text, each with its context. */
function enumLiteralViolations(sqlText: string, kinds: readonly string[] = NEW_KINDS): string[] {
  const violations: string[] = [];
  const literal = new RegExp(`'(${kinds.join("|")})'`, "g");
  for (const statement of sqlText.split(BREAKPOINT)) {
    const scanned = withoutPlpgsqlBody(flat(withoutComments(statement)));
    const allowed: [number, number][] = [];
    for (const pattern of [TEXT_COMPARISON, ADDED_VALUE]) {
      for (const match of scanned.matchAll(pattern)) allowed.push([match.index, match.index + match[0].length]);
    }
    for (const match of scanned.matchAll(literal)) {
      const at = match.index;
      const castToText = /^ ?::text(?![a-z_])/i.test(scanned.slice(at + match[0].length));
      if (castToText || allowed.some(([from, to]) => at >= from && at < to)) continue;
      violations.push(scanned.slice(Math.max(0, at - 60), at + match[0].length + 20));
    }
  }
  return violations;
}

describe("the enum-literal rule of 3e's migrations", () => {
  test("action_kind's new values are the ten of 3e, after 3c's twelve", () => {
    expect(NEW_KINDS).toEqual(["strike", "suspend", "terminate", "retire_handle", "warn_reporting", "restrict_reporting", "overrule", "lift_suspension", "unretire_handle", "lift_reporting"]);
  });

  test("3e's migrations are there: the schema (0020) and standing_ledger (0021) at least", () => {
    const tags = migrationsOf3e().map((entry) => entry.tag);
    expect(tags.length).toBeGreaterThanOrEqual(2);
    expect(tags[1]).toBe("0021_standing_ledger");
  });

  test("no file of 3e names a new kind as a literal outside a PL/pgSQL body", () => {
    for (const entry of migrationsOf3e()) {
      const text = readFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), "utf8");
      expect(enumLiteralViolations(text), entry.tag).toEqual([]);
    }
  });

  test("the files of 3e do name the new kinds, inside PL/pgSQL bodies, so the test reads what it should", () => {
    const ledger = readFileSync(path.join(MIGRATIONS, `${migrationsOf3e()[1]!.tag}.sql`), "utf8");
    // The same file read without blanking the bodies would hold many: the bodies are where the kinds are used.
    expect(enumLiteralViolations(ledger.split("LANGUAGE plpgsql").join("LANGUAGE sql")).length).toBeGreaterThan(20);
  });

  test("a deliberate violation of each kind is caught, and the allowed forms are not", () => {
    // Caught: a view, an SQL function, a check and an index predicate that name a new kind as the enum, and a cast.
    expect(enumLiteralViolations(`CREATE VIEW v AS SELECT 1 FROM decision_actions a WHERE a.kind = 'strike';`)).toHaveLength(1);
    expect(enumLiteralViolations(`CREATE FUNCTION f() RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM decision_actions a WHERE a.kind IN ('suspend', 'terminate')) $$;`)).toHaveLength(2);
    expect(enumLiteralViolations(`ALTER TABLE decision_actions ADD CONSTRAINT c CHECK (kind <> 'overrule');`)).toHaveLength(1);
    expect(enumLiteralViolations(`CREATE INDEX i ON decision_actions (created_at) WHERE kind = 'strike';`)).toHaveLength(1);
    expect(enumLiteralViolations(`SELECT 'lift_reporting'::public.action_kind;`)).toHaveLength(1);
    // A DO block runs inside the migration: its body is no exemption.
    expect(enumLiteralViolations(`DO $$ BEGIN PERFORM 1 FROM decision_actions a WHERE a.kind = 'strike'; END $$;`)).toHaveLength(1);
    // Two statements: the second's violation is found although the first is a PL/pgSQL function.
    const two = `CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$;${BREAKPOINT}${NEWLINE}CREATE VIEW v AS SELECT 1 FROM decision_actions a WHERE a.kind = 'suspend';`;
    expect(enumLiteralViolations(two)).toHaveLength(1);
    // Allowed: a comparison as text, a cast to text, any literal inside a PL/pgSQL body, an old kind, a comment, and the
    // statement that adds the value.
    expect(enumLiteralViolations(`CREATE VIEW v AS SELECT 1 FROM decision_actions a WHERE a.kind::text = 'strike' AND a.kind::text IN ('suspend', 'terminate');`)).toEqual([]);
    expect(enumLiteralViolations(`CREATE VIEW v AS SELECT 'strike'::text AS k;`)).toEqual([]);
    expect(enumLiteralViolations(`CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1 FROM decision_actions a WHERE a.kind = 'strike'; END $$;`)).toEqual([]);
    expect(enumLiteralViolations(`CREATE VIEW v AS SELECT 1 FROM decision_actions a WHERE a.kind = 'remove';`)).toEqual([]);
    expect(enumLiteralViolations(`-- a.kind = 'strike' in a comment${NEWLINE}SELECT 1;`)).toEqual([]);
    expect(enumLiteralViolations(`ALTER TYPE "public"."action_kind" ADD VALUE 'strike';`)).toEqual([]);
  });
});

/**
 * 3f (design, section 6, "The rule for the new enum values"; invariant 1): the migration orders adds eight values to seven
 * enums: action_kind's disable_by_order and reinstate_by_order, `order` to decision_kind, decision_source and intake_kind,
 * `authority` to intake_channel and `disabled` to moderation_level and post_state. drizzle runs 3f's migrations in one
 * transaction with any others pending, so the rule binds the file that adds them and every later one. The file before it
 * (0026_messages_alerts) names `order` only as a value of a text column, before any enum holds it, so it is not read.
 */
const VALUES_3F: readonly string[] = ["disable_by_order", "reinstate_by_order", "order", "authority", "disabled"];

/** The journal's entries from the migration that adds 3f's values, oldest first. */
function migrationsFromOrders(): { idx: number; tag: string }[] {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const first = journal.entries.find((entry) => entry.tag.endsWith("_orders"));
  return first === undefined ? [] : journal.entries.filter((entry) => entry.idx >= first.idx);
}

describe("the enum-literal rule of 3f's migrations", () => {
  test("the migration orders is there, and it adds the eight values", () => {
    const files = migrationsFromOrders();
    expect(files[0]?.tag).toBe("0027_orders");
    const text = readFileSync(path.join(MIGRATIONS, `${files[0]!.tag}.sql`), "utf8");
    const added = [...flat(text).matchAll(/ALTER TYPE "public"."([a-z_]+)" ADD VALUE '([a-z_]+)'/g)].map((m) => `${m[1]}.${m[2]}`).sort();
    expect(added).toEqual(
      [
        "action_kind.disable_by_order",
        "action_kind.reinstate_by_order",
        "decision_kind.order",
        "decision_source.order",
        "intake_channel.authority",
        "intake_kind.order",
        "moderation_level.disabled",
        "post_state.disabled",
      ].sort(),
    );
  });

  test("no file from the migration orders on names a new value as a literal outside a PL/pgSQL body", () => {
    for (const entry of migrationsFromOrders()) {
      const text = readFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), "utf8");
      expect(enumLiteralViolations(text, VALUES_3F), entry.tag).toEqual([]);
    }
  });

  test("a deliberate violation of 3f's values is caught, and the allowed forms are not", () => {
    expect(enumLiteralViolations(`ALTER TABLE decisions ADD CONSTRAINT c CHECK (kind <> 'order');`, VALUES_3F)).toHaveLength(1);
    expect(enumLiteralViolations(`CREATE VIEW v AS SELECT 1 FROM posts p WHERE p.moderation_level = 'disabled';`, VALUES_3F)).toHaveLength(1);
    expect(enumLiteralViolations(`CREATE FUNCTION f() RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM intakes i WHERE i.channel = 'authority') $$;`, VALUES_3F)).toHaveLength(1);
    expect(enumLiteralViolations(`ALTER TABLE decisions ADD CONSTRAINT c CHECK (outcome <> 'restricted' OR kind::text = 'order');`, VALUES_3F)).toEqual([]);
    expect(enumLiteralViolations(`CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1 FROM decision_actions a WHERE a.kind = 'disable_by_order'; END $$;`, VALUES_3F)).toEqual([]);
    expect(enumLiteralViolations(`ALTER TYPE "public"."post_state" ADD VALUE 'disabled';`, VALUES_3F)).toEqual([]);
  });
});

/**
 * 3d (design, section 6, "The rule for the two new enum values", and 12.1 row 1): the automated decision's migration adds
 * `automated` to intake_kind and `system` to intake_channel. The public figures' migration (Task 4) comes before it and
 * counts intakes of the kind automated, so it is read under the stricter form of the rule: neither label appears as a
 * literal anywhere in it, in a PL/pgSQL body either (a body that named a label its type lacks would be created and then
 * fail when first called), but compared or cast as text.
 */
const VALUES_3D: readonly string[] = ["automated", "system"];

/** A migration's SQL with every PL/pgSQL body read as if it were parsed at once: the stricter form. */
const bodiesToo = (sqlText: string): string => sqlText.split("LANGUAGE plpgsql").join("LANGUAGE sql");

describe("the stricter enum-literal rule of 3d's transparency migration", () => {
  const entry = (() => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    return journal.entries.find((candidate) => candidate.tag.endsWith("_transparency"));
  })();

  test("the migration transparency is there, after 3d's edge outbox", () => {
    expect(entry?.tag).toBe("0036_transparency");
  });

  test("it names neither label as a literal anywhere, PL/pgSQL bodies included, but compared or cast as text", () => {
    const text = readFileSync(path.join(MIGRATIONS, `${entry!.tag}.sql`), "utf8");
    expect(enumLiteralViolations(bodiesToo(text), VALUES_3D)).toEqual([]);
    // It does count the kind automated, as text: the test reads what it should.
    expect(flat(withoutComments(text))).toContain("i.kind::text = 'automated'");
  });

  test("a deliberate violation is caught even inside a PL/pgSQL body, and the text forms are not", () => {
    expect(enumLiteralViolations(bodiesToo(`CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1 FROM intakes i WHERE i.kind = 'automated'; END $$;`), VALUES_3D)).toHaveLength(1);
    expect(enumLiteralViolations(bodiesToo(`CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1 FROM intakes i WHERE i.channel IN ('system'); END $$;`), VALUES_3D)).toHaveLength(1);
    expect(enumLiteralViolations(bodiesToo(`CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1 FROM intakes i WHERE i.kind::text = 'automated'; END $$;`), VALUES_3D)).toEqual([]);
    expect(enumLiteralViolations(bodiesToo(`CREATE FUNCTION f() RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RETURN jsonb_build_object('automated'::text, 1); END $$;`), VALUES_3D)).toEqual([]);
  });
});

/**
 * 3d Task 6 (design, section 6, "The rule for the two new enum values"): the migration automated_decisions adds the two
 * labels, and from it on, as 3e's and 3f's rule says, a label appears as a literal of its enum only inside a PL/pgSQL
 * body, and everywhere else compared or cast as text.
 */
describe("the enum-literal rule of 3d's automated decisions migration", () => {
  const files = (() => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    const first = journal.entries.find((candidate) => candidate.tag.endsWith("_automated_decisions"));
    return first === undefined ? [] : journal.entries.filter((candidate) => candidate.idx >= first.idx);
  })();

  test("the migration automated_decisions is there, and it adds the two labels", () => {
    // The design numbers it 0035; Tasks 1 to 5 took 0033 to 0037 before it.
    expect(files[0]?.tag).toBe("0038_automated_decisions");
    const text = readFileSync(path.join(MIGRATIONS, `${files[0]!.tag}.sql`), "utf8");
    const added = [...flat(text).matchAll(/ALTER TYPE "public"."([a-z_]+)" ADD VALUE '([a-z_]+)'/g)].map((m) => `${m[1]}.${m[2]}`).sort();
    expect(added).toEqual(["intake_channel.system", "intake_kind.automated"]);
  });

  test("no file from it on names either label as a literal outside a PL/pgSQL body", () => {
    for (const entry of files) {
      const text = readFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), "utf8");
      expect(enumLiteralViolations(text, VALUES_3D), entry.tag).toEqual([]);
    }
  });

  test("the file does name the label automated inside decisions_record's body, so the test reads what it should", () => {
    const text = readFileSync(path.join(MIGRATIONS, `${files[0]!.tag}.sql`), "utf8");
    expect(enumLiteralViolations(bodiesToo(text), VALUES_3D).length).toBeGreaterThanOrEqual(4);
  });

  test("3d Task 7: known_material's transparency_figures, replaced, keeps the stricter form: neither label as a literal, in its body either", () => {
    const entry = files.find((candidate) => candidate.tag.endsWith("_known_material"));
    // The design numbers it 0036; Tasks 1 to 6 took 0033 to 0038 before it.
    expect(entry?.tag).toBe("0039_known_material");
    const text = readFileSync(path.join(MIGRATIONS, `${entry!.tag}.sql`), "utf8");
    const start = text.indexOf('CREATE OR REPLACE FUNCTION "public"."transparency_figures"');
    const end = text.indexOf("CREATE OR REPLACE FUNCTION", start + 1);
    expect(start).toBeGreaterThan(0);
    const figures = text.slice(start, end === -1 ? undefined : end);
    expect(enumLiteralViolations(bodiesToo(figures), VALUES_3D)).toEqual([]);
    expect(flat(withoutComments(figures))).toContain("i.kind::text = 'automated'");
  });

  test("3d Task 8: signals_and_retention is read under the stricter form: neither label as a literal, in its bodies either; kinds are compared as text or not at all", () => {
    const entry = files.find((candidate) => candidate.tag.endsWith("_signals_and_retention"));
    // The design numbers it 0037; Tasks 1 to 7 took 0033 to 0039 before it.
    expect(entry?.tag).toBe("0040_signals_and_retention");
    const text = readFileSync(path.join(MIGRATIONS, `${entry!.tag}.sql`), "utf8");
    expect(enumLiteralViolations(bodiesToo(text), VALUES_3D)).toEqual([]);
    // It reads no intake's kind or channel at all: the flag counts signed-in reporters' items by their account alone.
    expect(flat(withoutComments(text))).not.toMatch(/[.](kind|channel)::(intake_kind|intake_channel)/);
    expect(flat(withoutComments(text))).toContain("CREATE FUNCTION");
  });

  test("3d review: 0041_review is read under the stricter form: neither label as a literal, in its bodies either; kinds are compared as text", () => {
    const entry = files.find((candidate) => candidate.tag.endsWith("_review") && candidate.tag.startsWith("0041"));
    expect(entry?.tag).toBe("0041_review");
    const text = readFileSync(path.join(MIGRATIONS, `${entry!.tag}.sql`), "utf8");
    expect(enumLiteralViolations(bodiesToo(text), VALUES_3D)).toEqual([]);
    // Its replaced transparency_figures still compares the intake's kind as text.
    expect(flat(withoutComments(text))).toContain("i.kind::text = 'automated'");
  });

  test("3d review, Task 10: 0042_review_words is read under the same stricter form; its transparency_figures compares the intake's kind as text", () => {
    const entry = files.find((candidate) => candidate.tag.endsWith("_review_words"));
    expect(entry?.tag).toBe("0042_review_words");
    const text = readFileSync(path.join(MIGRATIONS, `${entry!.tag}.sql`), "utf8");
    expect(enumLiteralViolations(bodiesToo(text), VALUES_3D)).toEqual([]);
    expect(flat(withoutComments(text))).toContain("i.kind::text = 'automated'");
  });
});

/**
 * 3b (design, sections 6 and 6.7; Task 2): import from other platforms adds two enums of its own and no value to any enum
 * that exists, so the rule above has nothing new to hold in its migrations; the 3e, 3f and 3d describes above read them
 * all the same, from their first files on. This case holds that: from 0043_imports on, no file adds a value with ALTER
 * TYPE, and import_source and import_status are created whole, each in one CREATE TYPE with every value of the design.
 */
describe("3b's migrations: two enums created whole, no value added to an existing one", () => {
  test("from 0043_imports on, no ALTER TYPE ... ADD VALUE, and import_source and import_status are created with their values", () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    const first = journal.entries.find((entry) => entry.tag === "0043_imports");
    expect(first?.idx).toBe(43);
    // 2d Task 1: 3b's six files, 0043_imports to 0048_import_staff_end. 2d's migrations create enums of their own and add
    // values to action_kind, each read by a describe of its own below.
    const last = journal.entries.find((entry) => entry.tag === "0048_import_staff_end");
    expect(last?.idx).toBe(48);
    const files = journal.entries.filter((entry) => entry.idx >= first!.idx && entry.idx <= last!.idx);
    expect(files.slice(0, 3).map((entry) => entry.tag)).toEqual(["0043_imports", "0044_imported_posts", "0045_import_readers"]);
    const created: Record<string, string[]> = {};
    for (const entry of files) {
      const text = flat(withoutComments(readFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), "utf8")));
      expect(text, entry.tag).not.toMatch(/ALTER TYPE [^ ]+ ADD VALUE/i);
      for (const match of text.matchAll(/CREATE TYPE "public"."([a-z_]+)" AS ENUM ?[(]([^)]*)[)]/g)) {
        created[match[1]!] = [...match[2]!.matchAll(/'([a-z_]+)'/g)].map((value) => value[1]!);
      }
    }
    expect(created).toEqual({
      import_source: ["x", "mastodon", "bluesky"],
      import_status: ["uploading", "scanning", "ready", "preparing", "publishing", "done", "stopped", "undoing", "undone", "failed", "cancelled", "expired"],
    });
  });
});

/**
 * 2d (design, sections 6 and 6.8; Task 1): the migrations activity and post_options create two enums of their own and add
 * no value to any enum that exists, so 3e's rule has nothing new to hold in them; the 3e, 3f and 3d describes above read
 * them all the same, from their first files on. This case reads those two files alone, by tag: 2d's later migrations
 * create media_kind (Task 3) and add values to action_kind (Task 4's avatar_kinds), each under a describe of its own.
 */
/**
 * 2d Task 3 (design, sections 6.4 and 6.8): the migration avatars creates media_kind whole, in one CREATE TYPE with both of
 * the contracts' MEDIA_KINDS, and adds no value to an enum that exists; its hand-written functions compare the kind, the
 * status and the moderation state as text, as 2d compares every enum.
 */
describe("2d's migration avatars: media_kind created whole, no value added to an existing one", () => {
  test("0051_avatars adds no value with ALTER TYPE, creates media_kind with post and avatar, and compares enums as text in its bodies", () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    const entry = journal.entries.find((candidate) => candidate.tag === "0051_avatars");
    expect(entry?.idx).toBe(51);
    const raw = readFileSync(path.join(MIGRATIONS, "0051_avatars.sql"), "utf8");
    const text = flat(withoutComments(raw));
    expect(text).not.toMatch(/ALTER TYPE [^ ]+ ADD VALUE/i);
    const created: Record<string, string[]> = {};
    for (const match of text.matchAll(/CREATE TYPE "public"."([a-z_]+)" AS ENUM ?[(]([^)]*)[)]/g)) {
      created[match[1]!] = [...match[2]!.matchAll(/'([a-z_]+)'/g)].map((value) => value[1]!);
    }
    expect(created).toEqual({ media_kind: ["post", "avatar"] });
    for (const literal of ["kind::text <> 'avatar'", "status::text <> 'ready'", "moderation_state::text <> 'visible'"]) expect(text, literal).toContain(literal);
    expect(text).not.toMatch(/[.]kind (=|<>) 'avatar'/);
  });
});

describe("2d's migrations activity and post_options: two enums created whole, no value added to an existing one", () => {
  test("0049_activity and 0050_post_options add no value with ALTER TYPE, and create activity_kind and activity_reach with their values", () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    const files = journal.entries.filter((entry) => entry.tag === "0049_activity" || entry.tag === "0050_post_options");
    expect(files.map((entry) => [entry.idx, entry.tag])).toEqual([
      [49, "0049_activity"],
      [50, "0050_post_options"],
    ]);
    const created: Record<string, string[]> = {};
    for (const entry of files) {
      const text = flat(withoutComments(readFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), "utf8")));
      expect(text, entry.tag).not.toMatch(/ALTER TYPE [^ ]+ ADD VALUE/i);
      for (const match of text.matchAll(/CREATE TYPE "public"."([a-z_]+)" AS ENUM ?[(]([^)]*)[)]/g)) {
        created[match[1]!] = [...match[2]!.matchAll(/'([a-z_]+)'/g)].map((value) => value[1]!);
      }
    }
    expect(created).toEqual({
      activity_kind: ["reply", "mention", "quote", "follow"],
      activity_reach: ["everyone", "older", "following", "off"],
    });
  });
});
