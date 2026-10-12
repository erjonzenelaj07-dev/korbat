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

/** 3c's twelve kinds come first in the enum; 3e's ten follow them. */
const OLD_KINDS = 12;
const NEW_KINDS: readonly string[] = actionKind.enumValues.slice(OLD_KINDS);

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
