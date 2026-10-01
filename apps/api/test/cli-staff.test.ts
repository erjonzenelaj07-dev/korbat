import { describe, expect, test } from "vitest";
import { STAFF_USAGE, enrollSettings, parseStaffArgs, runStaffCommand, staffDatabaseUrls } from "../src/cli/staff";

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
    // enroll runs as the migrator, in the migrate service; the usage says where.
    expect(STAFF_USAGE).toMatch(/run --rm migrate node dist\/staff\.js enroll/);
    // revoke arrives with the task that builds it.
    expect(STAFF_USAGE).not.toMatch(/revoke/);
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
    expect(() => parseStaffArgs(["revoke", "a@b.io", "all"])).toThrow("unknown command: revoke");
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
