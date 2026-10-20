import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { CUSTODY_USAGE } from "../src/cli/custody";
import { STAFF_USAGE, enrollSettings, migratorUrl, parseStaffArgs, revokeSettings, runStaffCommand, staffDatabaseUrls } from "../src/cli/staff";

const HASH_A = "ab".repeat(32);
const HASH_B = "0123456789abcdef".repeat(4);
const API_URL = "postgres://korbat_api:x@localhost:5432/korbat";
const AUTH_URL = "postgres://korbat_auth:x@localhost:5432/korbat";

/** The command's lines, each marked with the stream it went to. */
function capture() {
  const lines: string[] = [];
  return { lines, out: { log: (line: string) => lines.push(`out ${line}`), error: (line: string) => lines.push(`err ${line}`) } };
}

describe("staff.js arguments", () => {
  test("the usage lists the commands that exist", () => {
    expect(STAFF_USAGE).toMatch(/^usage: node dist\/staff\.js <command>/);
    expect(STAFF_USAGE).toContain("enroll <email>");
    expect(STAFF_USAGE).toContain("keys [<email>]");
    expect(STAFF_USAGE).toContain("audit-head");
    expect(STAFF_USAGE).toContain("audit-verify [<chain_seq>:<hash> ...]");
    expect(STAFF_USAGE).toContain("revoke <email> <key id>");
    expect(STAFF_USAGE).toContain("revoke <email> all");
    // enroll runs as the migrator, in the migrate service; the usage says where.
    expect(STAFF_USAGE).toMatch(/run --rm migrate node dist\/staff\.js enroll/);
  });

  test("3d review L18 (walk): no command of the quarantine's and the release's usage runs past its column; each description starts at the 42nd character", () => {
    for (const line of CUSTODY_USAGE) {
      expect(line.length, line).toBeGreaterThan(41);
      expect(line.charAt(40), line).toBe(" ");
      expect(line.charAt(41), line).not.toBe(" ");
    }
    expect(STAFF_USAGE).toContain(`${"  release-leave <seal|refusal>".padEnd(41)}record a leave or an instruction to destroy`);
  });

  test("reads revoke with an email address and a key id or all, normalising both", () => {
    const id = "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f";
    expect(parseStaffArgs(["revoke", " Mod@Korbat.Local ", "all"])).toEqual({ command: "revoke", email: "mod@korbat.local", key: "all" });
    expect(parseStaffArgs(["revoke", "mod@korbat.local", id.toUpperCase()])).toEqual({ command: "revoke", email: "mod@korbat.local", key: id });
    expect(() => parseStaffArgs(["revoke", "mod@korbat.local"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["revoke", "mod@korbat.local", id, "all"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["revoke", "moderator", "all"])).toThrow(`not an email address: moderator\n${STAFF_USAGE}`);
    for (const key of ["ALL", "every", "12", `${id}0`, id.replace(/-/g, "")]) {
      expect(() => parseStaffArgs(["revoke", "mod@korbat.local", key]), key).toThrow(`not a key id or all: ${key}`);
    }
  });

  test("reads enroll with one email address and keys with one or none, normalising the address", () => {
    expect(parseStaffArgs(["enroll", " Mod@Korbat.Local "])).toEqual({ command: "enroll", email: "mod@korbat.local" });
    expect(parseStaffArgs(["keys"])).toEqual({ command: "keys", email: null });
    expect(parseStaffArgs(["keys", "Mod@Korbat.Local"])).toEqual({ command: "keys", email: "mod@korbat.local" });
    expect(() => parseStaffArgs(["enroll"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["enroll", "a@b.io", "b@c.io"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["keys", "a@b.io", "b@c.io"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["enroll", "moderator"])).toThrow(`not an email address: moderator\n${STAFF_USAGE}`);
    expect(() => parseStaffArgs(["keys", "all"])).toThrow(`not an email address: all\n${STAFF_USAGE}`);
  });

  test("reads audit-head, and audit-verify with any number of kept places", () => {
    expect(parseStaffArgs(["audit-head"])).toEqual({ command: "audit-head" });
    expect(parseStaffArgs(["audit-verify"])).toEqual({ command: "audit-verify", kept: [] });
    expect(parseStaffArgs(["audit-verify", `12:${HASH_A}`, `3:${HASH_B}`])).toEqual({
      command: "audit-verify",
      kept: [
        { seq: 12, hash: HASH_A },
        { seq: 3, hash: HASH_B },
      ],
    });
    expect(parseStaffArgs(["audit-verify", `999999999999999:${HASH_A}`]).command).toBe("audit-verify");
  });

  test("prints the usage for no command, an unknown one or extra arguments", () => {
    expect(() => parseStaffArgs([])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["audit-tail"])).toThrow(`unknown command: audit-tail\n${STAFF_USAGE}`);
    expect(() => parseStaffArgs(["audit-head", `1:${HASH_A}`])).toThrow(STAFF_USAGE);
  });

  test("refuses a kept place that is not <chain_seq>:<hash>, a positive place and a lower-case sha256", () => {
    for (const pair of [
      "12",
      `12 ${HASH_A}`,
      `0:${HASH_A}`,
      `-1:${HASH_A}`,
      `01:${HASH_A}`,
      `1.5:${HASH_A}`,
      `1e3:${HASH_A}`,
      `1000000000000000:${HASH_A}`,
      "12:abc",
      `12:${HASH_A.toUpperCase()}`,
      `12:${HASH_A}0`,
      `12:${HASH_A}:1`,
    ]) {
      expect(() => parseStaffArgs(["audit-verify", pair]), pair).toThrow(`not a kept place: ${pair}`);
    }
  });

  test("run without arguments, it prints its usage and answers 2 before reading any configuration", async () => {
    const { lines, out } = capture();
    expect(await runStaffCommand([], {}, out)).toBe(2);
    expect(lines).toEqual([`err ${STAFF_USAGE}`]);
  });
});

// audit-head and audit-verify need no server secret and no console configuration (3a design, section 7), so each reads
// only the database URLs it connects with, never the API's whole configuration.
describe("what each staff.js command reads of the environment", () => {
  test("audit-head reads DATABASE_URL_API alone, and audit-verify that and DATABASE_URL_AUTH", () => {
    expect(staffDatabaseUrls({ command: "audit-head" }, { DATABASE_URL_API: API_URL })).toEqual({ api: API_URL, auth: null });
    expect(staffDatabaseUrls({ command: "audit-verify", kept: [] }, { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: AUTH_URL })).toEqual({
      api: API_URL,
      auth: AUTH_URL,
    });
  });

  test("a setting the API's configuration would refuse, the console's included, changes nothing", () => {
    for (const extra of [
      // Not an origin as browsers send it (the final slash).
      { CONSOLE_ORIGIN: "https://console.example/" },
      // The console on the app's own origin.
      { APP_ORIGIN: "http://localhost:8081", CONSOLE_ORIGIN: "http://localhost:8081" },
      { CONSOLE_RP_ID: "not a domain" },
      // A secret too short, and production's rules over a development setup.
      { NODE_ENV: "production", AUTH_HMAC_KEY: "c2hvcnQ=", APP_ORIGIN: "http://localhost:8081" },
    ]) {
      const env = { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: AUTH_URL, ...extra };
      expect(staffDatabaseUrls({ command: "audit-verify", kept: [] }, env), JSON.stringify(extra)).toEqual({ api: API_URL, auth: AUTH_URL });
      expect(staffDatabaseUrls({ command: "audit-head" }, env), JSON.stringify(extra)).toEqual({ api: API_URL, auth: null });
    }
  });

  test("names the database URL that is missing or not a PostgreSQL URL, and no other setting", () => {
    const cases: [Parameters<typeof staffDatabaseUrls>[0], Record<string, string>, RegExp][] = [
      [{ command: "audit-head" }, {}, /DATABASE_URL_API/],
      [{ command: "audit-head" }, { DATABASE_URL_API: "mysql://korbat:x@localhost/korbat" }, /DATABASE_URL_API/],
      [{ command: "audit-verify", kept: [] }, { DATABASE_URL_API: API_URL }, /DATABASE_URL_AUTH/],
      [{ command: "audit-verify", kept: [] }, { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: "not a url" }, /DATABASE_URL_AUTH/],
    ];
    for (const [command, env, named] of cases) {
      let message = "";
      try {
        staffDatabaseUrls(command, env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, JSON.stringify(env)).toMatch(named);
      expect(message).toMatch(new RegExp(`^Invalid environment for ${command.command}:`));
      expect(message).not.toMatch(/APP_ORIGIN|REDIS_URL|AUTH_HMAC_KEY|SMTP_URL|CONSOLE_ORIGIN/);
    }
  });

  test("keys reads DATABASE_URL_AUTH for the keys and DATABASE_URL_API for the handles, and nothing else", () => {
    expect(staffDatabaseUrls({ command: "keys", email: null }, { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: AUTH_URL, CONSOLE_ORIGIN: "not an origin" })).toEqual({
      api: API_URL,
      auth: AUTH_URL,
    });
    expect(() => staffDatabaseUrls({ command: "keys", email: "a@b.io" }, { DATABASE_URL_API: API_URL })).toThrow(/^Invalid environment for keys:[\s\S]*DATABASE_URL_AUTH/);
  });

  test("run with a database URL missing, it names it and answers 1", async () => {
    const { lines, out } = capture();
    expect(await runStaffCommand(["audit-verify"], { DATABASE_URL_API: API_URL }, out)).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^err Invalid environment for audit-verify:/);
    expect(lines[0]).toContain("DATABASE_URL_AUTH");
    expect(lines[0]).not.toMatch(/APP_ORIGIN|REDIS_URL|AUTH_HMAC_KEY/);
  });
});

// enroll runs in the migrate service as the migrator (3a design, section 7): it reads the migrator's database URL and the
// console's origin and relying party ID, which Compose gives that service, and nothing of the API's configuration.
describe("what staff.js enroll reads of the environment", () => {
  const MIGRATE_URL = "postgres://korbat_migrate:x@localhost:5432/korbat";

  test("DATABASE_URL_MIGRATE, CONSOLE_ORIGIN and CONSOLE_RP_ID, the relying party ID defaulting to the console's hostname", () => {
    expect(enrollSettings({ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "http://localhost:8090" })).toEqual({
      migrate: MIGRATE_URL,
      consoleOrigin: "http://localhost:8090",
      consoleRpId: "localhost",
    });
    // A blank relying party ID, as Compose passes an empty line of infra/.env, counts as unset.
    expect(enrollSettings({ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "https://console.example", CONSOLE_RP_ID: " " }).consoleRpId).toBe("console.example");
    expect(enrollSettings({ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "https://console.example", CONSOLE_RP_ID: "Console.Example" }).consoleRpId).toBe("console.example");
  });

  test("a setting only the API reads, or one the API's configuration would refuse, changes nothing", () => {
    const env = {
      DATABASE_URL_MIGRATE: MIGRATE_URL,
      CONSOLE_ORIGIN: "http://localhost:8090",
      // The console on the app's own hostname is refused by the API's rules in production, not here.
      APP_ORIGIN: "http://localhost:8081",
      NODE_ENV: "production",
      AUTH_HMAC_KEY: "c2hvcnQ=",
    };
    expect(enrollSettings(env)).toEqual({ migrate: MIGRATE_URL, consoleOrigin: "http://localhost:8090", consoleRpId: "localhost" });
  });

  test("while CONSOLE_ORIGIN is unset or blank it refuses, naming it", () => {
    for (const env of [{ DATABASE_URL_MIGRATE: MIGRATE_URL }, { DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "" }, { DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "  " }]) {
      expect(() => enrollSettings(env), JSON.stringify(env)).toThrow(/CONSOLE_ORIGIN is not set: the staff console is off, so no enrolment link can be issued/);
    }
  });

  test("names the setting that is wrong, and no other", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ CONSOLE_ORIGIN: "http://localhost:8090" }, /DATABASE_URL_MIGRATE/],
      [{ DATABASE_URL_MIGRATE: "mysql://x@localhost/k", CONSOLE_ORIGIN: "http://localhost:8090" }, /DATABASE_URL_MIGRATE/],
      // Not an origin as browsers send it: the staff gate would refuse every write the console makes.
      [{ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "http://localhost:8090/" }, /CONSOLE_ORIGIN/],
      [{ DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "http://localhost:8090", CONSOLE_RP_ID: "http://localhost" }, /CONSOLE_RP_ID/],
    ];
    for (const [env, named] of cases) {
      let message = "";
      try {
        enrollSettings(env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, JSON.stringify(env)).toMatch(named);
      expect(message).toMatch(/^Invalid environment for enroll:/);
      expect(message).not.toMatch(/APP_ORIGIN|REDIS_URL|AUTH_HMAC_KEY|SMTP_URL|DATABASE_URL_API|DATABASE_URL_AUTH/);
    }
  });

  test("run while CONSOLE_ORIGIN is unset, it says so, answers 1 and connects to nothing", async () => {
    const { lines, out } = capture();
    // Nothing listens on port 1: a connection attempt would fail with another message, or hang.
    const started = Date.now();
    expect(await runStaffCommand(["enroll", "mod@korbat.local"], { DATABASE_URL_MIGRATE: "postgres://korbat_migrate:x@127.0.0.1:1/korbat" }, out)).toBe(1);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^err .*CONSOLE_ORIGIN is not set/);
  });
});

// revoke runs like grant-role, in the api service (3a design, section 7): it revokes on the auth role and mails the key's
// owner, so it reads the auth role's URL and the mail settings, and nothing else of the API's configuration.
describe("what staff.js revoke reads of the environment", () => {
  const MAIL = { SMTP_URL: "smtp://localhost:1025", MAIL_FROM: "korbat <no-reply@korbat.local>" };

  test("DATABASE_URL_AUTH, SMTP_URL and MAIL_FROM, with TLS required from a plain relay in production as the API requires it", () => {
    expect(revokeSettings({ DATABASE_URL_AUTH: AUTH_URL, ...MAIL })).toEqual({ auth: AUTH_URL, mail: { smtpUrl: MAIL.SMTP_URL, mailFrom: MAIL.MAIL_FROM, requireTls: false } });
    expect(revokeSettings({ DATABASE_URL_AUTH: AUTH_URL, ...MAIL, NODE_ENV: "production" }).mail.requireTls).toBe(true);
  });

  test("a setting only the API reads, or one the API's configuration would refuse, changes nothing", () => {
    const env = { DATABASE_URL_AUTH: AUTH_URL, ...MAIL, CONSOLE_ORIGIN: "https://console.example/", APP_ORIGIN: "not a url", AUTH_HMAC_KEY: "c2hvcnQ=", DATABASE_URL_API: "nope" };
    expect(revokeSettings(env).auth).toBe(AUTH_URL);
  });

  test("names the setting that is missing or wrong, and no other", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ ...MAIL }, /DATABASE_URL_AUTH/],
      [{ DATABASE_URL_AUTH: "mysql://x@localhost/k", ...MAIL }, /DATABASE_URL_AUTH/],
      [{ DATABASE_URL_AUTH: AUTH_URL, MAIL_FROM: MAIL.MAIL_FROM }, /SMTP_URL/],
      [{ DATABASE_URL_AUTH: AUTH_URL, SMTP_URL: "http://localhost:1025", MAIL_FROM: MAIL.MAIL_FROM }, /SMTP_URL/],
      [{ DATABASE_URL_AUTH: AUTH_URL, SMTP_URL: MAIL.SMTP_URL }, /MAIL_FROM/],
    ];
    for (const [env, named] of cases) {
      let message = "";
      try {
        revokeSettings(env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, JSON.stringify(env)).toMatch(named);
      expect(message).toMatch(/^Invalid environment for revoke:/);
      expect(message).not.toMatch(/APP_ORIGIN|REDIS_URL|AUTH_HMAC_KEY|CONSOLE_ORIGIN|DATABASE_URL_API|DATABASE_URL_MIGRATE/);
    }
  });

  test("run with a setting missing, it names it, answers 1 and connects to nothing", async () => {
    const { lines, out } = capture();
    const started = Date.now();
    expect(await runStaffCommand(["revoke", "mod@korbat.local", "all"], { DATABASE_URL_AUTH: "postgres://korbat_auth:x@127.0.0.1:1/korbat", ...MAIL, SMTP_URL: "" }, out)).toBe(1);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^err Invalid environment for revoke:/);
    expect(lines[0]).toContain("SMTP_URL");
  });
});

describe("staff.js: the commands for moderation cases (3c design, section 7.13)", () => {
  const CASE = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
  const MIGRATE_URL = "postgres://korbat_migrate:x@localhost:5432/korbat";

  test("the usage lists them, and says which run in the migrate service", () => {
    for (const words of ["text-verify", "access-request <@handle | email>", "link <staff email> <personal handle>", "unlink <staff email> <personal handle>", "limits <decisions per hour> <decisions per day> <case opens per day> <findings per day> <reveals per day>"]) {
      expect(STAFF_USAGE, words).toContain(words);
    }
    expect(STAFF_USAGE).toContain("linked to it");
    // 3f Task 5: notification-facts replaces account-facts, and the record commands are listed with the order commands.
    expect(STAFF_USAGE).not.toContain("account-facts");
    for (const words of ["records [--verify]", "notification-facts <record>", "notification-sent <record>", "production-account <order>", "address-check --handle <handle> < address", "handover-list <seal action>", "handover-record <production>", "handover-destroyed <production>"]) {
      expect(STAFF_USAGE, words).toContain(`  ${words}`);
    }
  });

  test("3f's review: alert-test, with or without --on-call, and nothing else; and every runbook step that publishes a test names the staff.js command that does", () => {
    expect(STAFF_USAGE).toContain("  alert-test [--on-call] ");
    expect(parseStaffArgs(["alert-test"])).toEqual({ command: "alert-test", onCall: false });
    expect(parseStaffArgs(["alert-test", "--on-call"])).toEqual({ command: "alert-test", onCall: true });
    for (const args of [["alert-test", "--all"], ["alert-test", "--on-call", "--on-call"]]) expect(() => parseStaffArgs(args), args.join(" ")).toThrow(STAFF_USAGE);
    // Nobody on call can publish: the phones only subscribe. A step that asks for a test push names the command, and the
    // command is one the usage lists.
    const readme = readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "README.md"), "utf8");
    const steps = readme.split(String.fromCharCode(10)).filter((line) => /publish(es)? a test/.test(line));
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (const step of steps) {
      const named = [...step.matchAll(/staff\.js ([a-z-]+)/g)].map((match) => match[1]!);
      expect(named.length, step).toBeGreaterThan(0);
      for (const command of named) expect(STAFF_USAGE, command).toContain(`  ${command} `);
    }
  });

  test("reads link and unlink with a staff address and a personal handle, with or without its at sign, in lower case", () => {
    expect(parseStaffArgs(["link", " Mod@Korbat.Local ", "@Ada_L"])).toEqual({ command: "link", email: "mod@korbat.local", handle: "ada_l" });
    expect(parseStaffArgs(["unlink", "mod@korbat.local", "ada_l"])).toEqual({ command: "unlink", email: "mod@korbat.local", handle: "ada_l" });
    expect(() => parseStaffArgs(["link", "mod@korbat.local"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["link", "mod@korbat.local", "ada", "bob"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["link", "moderator", "ada"])).toThrow(`not an email address: moderator\n${STAFF_USAGE}`);
    for (const handle of ["ada lovelace", "ada@korbat.local", "@", "a-b", "'; drop table profiles; --"]) {
      expect(() => parseStaffArgs(["unlink", "mod@korbat.local", handle]), handle).toThrow(`not a handle: ${handle}`);
    }
  });

  test("reads limits with exactly five whole numbers from 1, in the order of the usage", () => {
    expect(parseStaffArgs(["limits", "60", "300", "400", "50", "10"])).toEqual({
      command: "limits",
      limits: { decisionsPerHour: 60, decisionsPerDay: 300, caseOpensPerDay: 400, findingsPerDay: 50, revealsPerDay: 10 },
    });
    expect(() => parseStaffArgs(["limits", "60", "300", "400", "50"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["limits", "60", "300", "400", "50", "10", "5"])).toThrow(STAFF_USAGE);
    for (const number of ["0", "-1", "1.5", "1e3", "ten", "", " 5", "05", "12345678"]) {
      expect(() => parseStaffArgs(["limits", "60", "300", number, "50", "10"]), JSON.stringify(number)).toThrow(`not a limit: ${number}`);
    }
  });

  test("reads text-verify without arguments, the record commands with what they name and their flags, and access-request with a handle or an address", () => {
    expect(parseStaffArgs(["text-verify"])).toEqual({ command: "text-verify" });
    expect(() => parseStaffArgs(["text-verify", "now"])).toThrow(STAFF_USAGE);
    // 3f Task 5: account-facts is gone; notification-facts names a record.
    expect(() => parseStaffArgs(["account-facts", "@Ada", CASE])).toThrow("unknown command: account-facts");
    expect(parseStaffArgs(["notification-facts", CASE])).toEqual({ command: "record", record: { command: "notification-facts", target: CASE, positional: [], flags: new Map() } });
    const sent = parseStaffArgs(["notification-sent", CASE, "--duty", "dsa18_1", "--duty", "tco14_5", "--kinds", "handle,address"]);
    expect(sent).toMatchObject({ command: "record", record: { command: "notification-sent", target: CASE } });
    expect((sent as { record: { flags: Map<string, string[]> } }).record.flags.get("--duty")).toEqual(["dsa18_1", "tco14_5"]);
    expect(parseStaffArgs(["records", "--verify"])).toMatchObject({ command: "record", record: { command: "records", target: null } });
    expect(() => parseStaffArgs(["records", CASE])).toThrow(/records: takes no/);
    expect(() => parseStaffArgs(["notification-facts"])).toThrow(/notification-facts: name the record/);
    expect(() => parseStaffArgs(["handover-list", "--instrument"])).toThrow(/needs a value/);
    // An at sign in front is a handle's; one inside is an address's.
    expect(parseStaffArgs(["access-request", "@Ada"])).toEqual({ command: "access-request", who: { handle: "ada" } });
    expect(parseStaffArgs(["access-request", "ada"])).toEqual({ command: "access-request", who: { handle: "ada" } });
    expect(parseStaffArgs(["access-request", " Ada@Korbat.Local "])).toEqual({ command: "access-request", who: { email: "ada@korbat.local" } });
    expect(() => parseStaffArgs(["access-request"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["access-request", "ada", "bob"])).toThrow(STAFF_USAGE);
    expect(() => parseStaffArgs(["access-request", "ada lovelace"])).toThrow("not a handle: ada lovelace");
  });

  test("text-verify reads DATABASE_URL_API alone; link, unlink and limits the migrator's URL alone", () => {
    expect(staffDatabaseUrls({ command: "text-verify" }, { DATABASE_URL_API: API_URL })).toEqual({ api: API_URL, auth: null });
    expect(() => staffDatabaseUrls({ command: "text-verify" }, { DATABASE_URL_AUTH: AUTH_URL })).toThrow(/DATABASE_URL_API/);
    expect(migratorUrl("limits", { DATABASE_URL_MIGRATE: MIGRATE_URL, CONSOLE_ORIGIN: "not an origin", SMTP_URL: "nonsense" })).toBe(MIGRATE_URL);
    expect(() => migratorUrl("link", { DATABASE_URL_API: API_URL })).toThrow(/Invalid environment for link:[^]*DATABASE_URL_MIGRATE/);
  });

  test("run in the wrong service, each says which URL it lacks, answers 1 and connects to nothing", async () => {
    for (const args of [["link", "mod@korbat.local", "ada"], ["unlink", "mod@korbat.local", "ada"], ["limits", "60", "300", "400", "50", "10"], ["records"], ["notification-facts", CASE]]) {
      const { lines, out } = capture();
      expect(await runStaffCommand(args, { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: AUTH_URL }, out), args[0]).toBe(1);
      expect(lines, args[0]).toHaveLength(1);
      expect(lines[0], args[0]).toMatch(new RegExp(`^err Invalid environment for ${args[0]}:`));
      expect(lines[0], args[0]).toContain("DATABASE_URL_MIGRATE");
    }
    // access-request for an address reads the API's whole configuration, and refuses with what is missing of it.
    const { lines, out } = capture();
    expect(await runStaffCommand(["access-request", "ada@korbat.local"], { DATABASE_URL_MIGRATE: MIGRATE_URL }, out)).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^err /);
    expect(lines[0]).toContain("DATABASE_URL_API");
    // 3f Task 5: for a handle it runs in the migrate service, which holds the migrator's URL and APP_ORIGIN.
    const handle = capture();
    expect(await runStaffCommand(["access-request", "@ada"], { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: AUTH_URL }, handle.out)).toBe(1);
    expect(handle.lines).toEqual(["err access-request: a handle's draft runs in the migrate service, which holds DATABASE_URL_MIGRATE and APP_ORIGIN; nothing was drafted"]);
    const noOrigin = capture();
    expect(await runStaffCommand(["access-request", "@ada"], { DATABASE_URL_MIGRATE: MIGRATE_URL }, noOrigin.out)).toBe(1);
    expect(noOrigin.lines).toEqual(handle.lines);
  });
});

describe("staff.js tco-counts (3f design, section 8.11, Recovery and the counts)", () => {
  const MIGRATE_URL = "postgres://korbat_migrate:x@localhost:5432/korbat";

  test("the usage lists it with its first line, in the migrate service", () => {
    expect(STAFF_USAGE).toContain("  tco-counts <year>");
    expect(STAFF_USAGE).toMatch(/tco-counts <year> +print the figures of TCO Art\. 7\(3\) and 21\(1\) for that calendar year in UTC/);
    expect(STAFF_USAGE).toContain("read-only; run it in the migrate service");
  });

  test("reads a year of four digits and nothing else", () => {
    expect(parseStaffArgs(["tco-counts", "2025"])).toEqual({ command: "counts", counts: { command: "tco-counts", year: 2025 } });
    for (const args of [["tco-counts"], ["tco-counts", "25"], ["tco-counts", "2025", "2026"], ["tco-counts", "20x5"], ["tco-counts", "02025"], ["tco-counts", "--year", "2025"]]) {
      expect(() => parseStaffArgs(args), args.join(" ")).toThrow(/^tco-counts: /);
    }
  });

  test("reads the migrator's URL alone: run in the api service it says so, answers 1 and connects to nothing", async () => {
    expect(migratorUrl("tco-counts", { DATABASE_URL_MIGRATE: MIGRATE_URL, DATABASE_URL_API: "nonsense" })).toBe(MIGRATE_URL);
    const { lines, out } = capture();
    expect(await runStaffCommand(["tco-counts", "2025"], { DATABASE_URL_API: API_URL, DATABASE_URL_AUTH: AUTH_URL }, out)).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^err Invalid environment for tco-counts:/);
    expect(lines[0]).toContain("DATABASE_URL_MIGRATE");
  });
});
