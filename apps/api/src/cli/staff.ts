/**
 * The staff command line (3a design, section 7). Run on the server only. enroll runs in the migrate service, as the
 * migrator, the one application role the running API never holds; the others run like grant-role:
 *
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js keys [<email>]
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js revoke <email> <key id>|all
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-head
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-verify [<chain_seq>:<hash> ...]
 *
 * enroll prints a one-time link that registers one staff key for a live staff account with a handle; the database lets
 * only the migrator issue one. keys lists an account's staff keys, or every staff account with its keys, for the
 * runbook's comparison with the operator's own list. revoke revokes one key and every staff session it opened, or with
 * `all` every key and staff session of the account and its unused enrolment links, and mails the owner; it is the only way
 * to revoke a key by hand, since no console route does.
 *
 * audit-head prints the audit log's newest place and hash, which the keeper holds off the server. audit-verify recomputes
 * the whole chain in its own code (the staff module's chain.ts), never asking the database for a text or a hash, since
 * whoever owns the database can replace its functions, and checks it against the places kept before: a rewrite that
 * recomputed every later hash still fails against a place kept before it. Neither needs a server secret or the console's
 * configuration, so both run the same with the console off or moved: each reads only the database URLs it connects with
 * (staffDatabaseUrls), never the API's whole configuration.
 */
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { Email } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffEnrollments, staffKeys, users, type Db, type DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID, createAuthRepo, revokeStaffKeys, type StaffKeysRevokedReport } from "../auth";
import { consoleHostOf, consoleOriginSetting, consoleRpIdSetting, databaseUrl, mailFrom, smtpUrl } from "../config";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../staff";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";
import { mailerFor, type CommandLineMailSettings } from "./mail";

export const STAFF_USAGE = [
  "usage: node dist/staff.js <command>",
  "  enroll <email>                         print a one-time link, valid 30 minutes, that registers one staff key for the account;",
  "                                         run it in the migrate service: docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>",
  "  keys [<email>]                         list the account's staff keys, or every staff account with its role, address, handle and keys",
  "  audit-head                             print the audit log's newest place, its hash and its time, to keep off the server",
  "  audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before",
  "  revoke <email> <key id>                revoke that staff key and every staff session it opened, and mail its owner",
  "  revoke <email> all                     revoke every staff key and staff session of the account, delete its unused",
  "                                         enrolment links, and mail its owner",
].join("\n");

/** A place in the chain and the hash it had when someone kept it, as audit-head printed it. */
export interface KeptPlace {
  seq: number;
  hash: string;
}

export type StaffCommand =
  | { command: "enroll"; email: string }
  | { command: "keys"; email: string | null }
  | { command: "audit-head" }
  | { command: "audit-verify"; kept: KeptPlace[] }
  | { command: "revoke"; email: string; key: string | "all" };

/** A place as the keeper copies it: at most 15 digits, so it is always a safe integer, and a lower-case hex sha256. */
const KEPT_PLACE = /^([1-9][0-9]{0,14}):([0-9a-f]{64})$/;
/** A staff key's id as `keys` prints it: a uuid, read in any case and kept in PostgreSQL's lower-case form. */
const KEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An address as the account was registered with it: trimmed and lower-cased, as the contracts read it. */
function emailArg(arg: string): string {
  const email = Email.safeParse(arg);
  if (!email.success) throw new Error(`not an email address: ${arg}\n${STAFF_USAGE}`);
  return email.data;
}

export function parseStaffArgs(args: readonly string[]): StaffCommand {
  const [command, ...rest] = args;
  switch (command) {
    case "enroll":
      if (rest.length !== 1) throw new Error(STAFF_USAGE);
      return { command, email: emailArg(rest[0]!) };
    case "keys":
      if (rest.length > 1) throw new Error(STAFF_USAGE);
      return { command, email: rest.length === 1 ? emailArg(rest[0]!) : null };
    case "audit-head":
      if (rest.length > 0) throw new Error(STAFF_USAGE);
      return { command };
    case "revoke": {
      if (rest.length !== 2) throw new Error(STAFF_USAGE);
      const email = emailArg(rest[0]!);
      // Exactly "all"; anything else must be a key's id, so a typo never revokes every key.
      if (rest[1] === "all") return { command, email, key: "all" };
      const key = rest[1]!.toLowerCase();
      if (!KEY_ID.test(key)) throw new Error(`not a key id or all: ${rest[1]} (staff.js keys prints each key's id)\n${STAFF_USAGE}`);
      return { command, email, key };
    }
    case "audit-verify":
      return {
        command,
        kept: rest.map((arg) => {
          const match = KEPT_PLACE.exec(arg);
          if (!match) throw new Error(`not a kept place: ${arg} (a kept place is <chain_seq>:<hash>, as audit-head prints it)\n${STAFF_USAGE}`);
          return { seq: Number(match[1]), hash: match[2]! };
        }),
      };
    case undefined:
      throw new Error(STAFF_USAGE);
    default:
      throw new Error(`unknown command: ${command}\n${STAFF_USAGE}`);
  }
}

// ---------------------------------------------------------------- the environment

/**
 * What each command reads of the environment, after its arguments are known, and nothing more. The API's configuration
 * (loadConfig) would also require its secrets, Valkey, the mail settings and APP_ORIGIN, and would refuse a CONSOLE_ORIGIN
 * its rules reject, none of which these commands use. audit-head reads the record on the API's role; audit-verify also
 * reads the staff keys on the auth role's.
 */
const AUDIT_HEAD_ENV = z.object({ DATABASE_URL_API: databaseUrl });
const AUDIT_VERIFY_ENV = AUDIT_HEAD_ENV.extend({ DATABASE_URL_AUTH: databaseUrl });

function readEnv<T extends z.ZodType>(schema: T, env: Record<string, string | undefined>, command: string): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment for ${command}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * The database URLs a command connects with: the API role's, and the auth role's for audit-verify and keys, which read the
 * staff keys there. enroll connects as the migrator alone and reads its settings with enrollSettings.
 */
export function staffDatabaseUrls(command: Exclude<StaffCommand, { command: "enroll" | "revoke" }>, env: Record<string, string | undefined>): { api: string; auth: string | null } {
  if (command.command === "audit-verify" || command.command === "keys") {
    const urls = readEnv(AUDIT_VERIFY_ENV, env, command.command);
    return { api: urls.DATABASE_URL_API, auth: urls.DATABASE_URL_AUTH };
  }
  return { api: readEnv(AUDIT_HEAD_ENV, env, command.command).DATABASE_URL_API, auth: null };
}

/**
 * What enroll reads: the migrator's URL, which only the migrate service holds, and the console's origin and relying party
 * ID, which Compose gives that service, each by the API's own rule for it. The relying party ID defaults to the console's
 * hostname, as the API's does. Nothing else of the API's configuration is read: the migrate service holds none of it.
 */
const ENROLL_ENV = z.object({ DATABASE_URL_MIGRATE: databaseUrl, CONSOLE_ORIGIN: consoleOriginSetting, CONSOLE_RP_ID: consoleRpIdSetting });

export interface EnrollSettings {
  migrate: string;
  consoleOrigin: string;
  consoleRpId: string;
}

/** enroll's settings, refusing while the console is off: a link to a console that does not run would enrol nothing. */
export function enrollSettings(env: Record<string, string | undefined>): EnrollSettings {
  // Blank counts as unset, as Compose passes an empty line of infra/.env.
  if (!env.CONSOLE_ORIGIN?.trim()) {
    throw new Error(
      "CONSOLE_ORIGIN is not set: the staff console is off, so no enrolment link can be issued. " +
        "Set API_CONSOLE_ORIGIN in infra/.env to the console's address (the migrate service reads it as CONSOLE_ORIGIN) and run the command again.",
    );
  }
  const settings = readEnv(ENROLL_ENV, env, "enroll");
  const consoleOrigin = settings.CONSOLE_ORIGIN!;
  return { migrate: settings.DATABASE_URL_MIGRATE, consoleOrigin, consoleRpId: settings.CONSOLE_RP_ID ?? consoleHostOf(consoleOrigin) };
}

/**
 * What revoke reads: the auth role's URL, on which it revokes, and the mail settings, with which it tells the key's owner,
 * each by the API's own rule for it. The API role's URL and the API's secrets are not read: revoke needs neither.
 */
const REVOKE_ENV = z.object({ DATABASE_URL_AUTH: databaseUrl, SMTP_URL: smtpUrl, MAIL_FROM: mailFrom, NODE_ENV: z.string().optional() });

export interface RevokeSettings {
  auth: string;
  mail: CommandLineMailSettings;
}

/** revoke's settings; production refuses a plain relay that does not upgrade with STARTTLS, as the API does. */
export function revokeSettings(env: Record<string, string | undefined>): RevokeSettings {
  const settings = readEnv(REVOKE_ENV, env, "revoke");
  return { auth: settings.DATABASE_URL_AUTH, mail: { smtpUrl: settings.SMTP_URL, mailFrom: settings.MAIL_FROM, requireTls: settings.NODE_ENV === "production" } };
}

// ---------------------------------------------------------------- reading the record

/** What the record is read through: the command line's own connection, or a transaction a test hands in. */
type Reader = Pick<Db, "select" | "execute">;

/** How many rows audit-verify reads at a time. */
const PAGE_SIZE = 1000;

/**
 * Sets the transaction up to read the record as the canonical text needs it. Times come as ISO text in UTC, which is what
 * the rows' Date values are parsed from (a session in 'SQL, DMY' would print another form), and a lock is waited on for
 * at most 10 seconds, as every staff command waits.
 */
async function readingSettings(q: Reader): Promise<void> {
  await q.execute(sql`set local datestyle = 'ISO'`);
  await q.execute(sql`set local timezone = 'UTC'`);
  await q.execute(sql`set local lock_timeout = '10s'`);
}

/**
 * The next page of rows after place `after` (from the lowest place when null) up to place `upto` (to the end when null),
 * in chain order. The jsonb columns come as PostgreSQL prints them, which the canonical text embeds as it is.
 */
function chainRows(q: Reader, after: number | null, upto: number | null) {
  return q
    .select({
      id: auditLog.id,
      chainVersion: auditLog.chainVersion,
      chainSeq: auditLog.chainSeq,
      createdAt: auditLog.createdAt,
      actorId: auditLog.actorId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      requestId: auditLog.requestId,
      staffSession: auditLog.staffSession,
      keyId: auditLog.keyId,
      actionHash: auditLog.actionHash,
      stepUpText: sql<string | null>`${auditLog.stepUp}::text`,
      metadataText: sql<string>`${auditLog.metadata}::text`,
      prevHash: auditLog.prevHash,
      hash: auditLog.hash,
    })
    .from(auditLog)
    .where(and(after === null ? undefined : gt(auditLog.chainSeq, after), upto === null ? undefined : lte(auditLog.chainSeq, upto)))
    .orderBy(asc(auditLog.chainSeq))
    .limit(PAGE_SIZE);
}

// ---------------------------------------------------------------- audit-verify

/** One thing audit-verify found wrong: the place it is at, or null for the head or a staff key. */
export interface AuditProblem {
  place: number | null;
  message: string;
}

export interface AuditReport {
  ok: boolean;
  /** The rows read: every row up to the head's place, and any other row the table holds at or below it. */
  rows: number;
  /** The head as audit_head held it, or null when the row is missing. */
  head: KeptPlace | null;
  keptChecked: number;
  /** How many rows follow the newest kept place, which no kept place anchors yet; every row when none was given. */
  unanchored: number;
  keysChecked: number;
  /** Keys whose staff_key_added row was written after the head this run read: the next run checks them. */
  keysLeftToNextRun: number;
  /** The first problems, in chain order, then the head's, the kept places' and the keys'. */
  problems: AuditProblem[];
  problemCount: number;
}

/** How many problems a report keeps: enough to name the first rows at fault. */
const PROBLEMS_KEPT = 100;

/** What one snapshot of the record showed, before the keys missing from it are looked up again. */
interface Walk {
  head: KeptPlace | null;
  rows: number;
  newest: KeptPlace | null;
  keptChecked: number;
  unanchored: number;
  keys: string[];
  /** The places of the staff_key_added rows read, by the key their key_id names. */
  keyRows: Map<string, number[]>;
  problems: AuditProblem[];
  problemCount: number;
}

/**
 * Everything audit-verify checks inside one view of the record: the head, then every row up to the head's place in chain
 * order, a page at a time. Run in a REPEATABLE READ transaction, a row written meanwhile is neither read nor missed. The
 * staff keys are read from `keysFrom` after the head, so each key listed either has its staff_key_added row among the
 * rows read or was added after the head.
 */
async function walkRecord(q: Reader, kept: readonly KeptPlace[], keysFrom: Pick<Db, "select">): Promise<Walk> {
  const problems: AuditProblem[] = [];
  let problemCount = 0;
  const problem = (place: number | null, message: string) => {
    problemCount++;
    if (problems.length < PROBLEMS_KEPT) problems.push({ place, message });
  };

  await readingSettings(q);
  const [headRow] = await q.select({ seq: auditHead.seq, hash: auditHead.hash }).from(auditHead).where(eq(auditHead.id, 1));
  const head = headRow ?? null;
  if (!head) problem(null, "the audit head is missing");
  const keys = (await keysFrom.select({ id: staffKeys.id }).from(staffKeys)).map((key) => key.id);

  const keptAt = new Map<number, string[]>();
  for (const place of kept) keptAt.set(place.seq, [...(keptAt.get(place.seq) ?? []), place.hash]);
  const keptSeen = new Set<number>();
  const keyRows = new Map<string, number[]>();
  let rows = 0;
  let previous: KeptPlace | null = null;
  // Without a head the whole table is read, so the other problems are still named.
  for (let after: number | null = null; ; ) {
    const page = await chainRows(q, after, head ? head.seq : null);
    for (const row of page) {
      rows++;
      const expected = previous ? previous.seq + 1 : 1;
      if (row.chainSeq < expected) {
        problem(row.chainSeq, "its place is not in the chain, which runs from place 1");
      } else if (row.chainSeq > expected) {
        problem(expected, row.chainSeq - expected === 1 ? `place ${expected} is missing` : `places ${expected} to ${row.chainSeq - 1} are missing`);
      }
      if (row.prevHash !== (previous ? previous.hash : CHAIN_ZERO_HASH)) {
        problem(row.chainSeq, previous ? `its prev_hash is not the hash of place ${previous.seq}` : "its prev_hash is not 64 zeros, as the first row's must be");
      }
      // The row's own hash, over its stored prev_hash: a changed row fails here, and a changed hash fails the next link.
      let text: string | null = null;
      try {
        text = canonicalText(row);
      } catch (err) {
        problem(row.chainSeq, (err as Error).message);
      }
      if (text !== null && chainHash(row.prevHash, text) !== row.hash) problem(row.chainSeq, "its hash does not match its content");
      for (const hash of keptAt.get(row.chainSeq) ?? []) {
        keptSeen.add(row.chainSeq);
        if (hash !== row.hash) problem(row.chainSeq, `the kept place ${row.chainSeq}:${hash} no longer matches: the row there has the hash ${row.hash}`);
      }
      if (row.action === "staff_key_added" && row.keyId !== null) keyRows.set(row.keyId, [...(keyRows.get(row.keyId) ?? []), row.chainSeq]);
      previous = { seq: row.chainSeq, hash: row.hash };
    }
    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1]!.chainSeq;
  }

  if (head) {
    const [beyond] = await q
      .select({ seq: auditLog.chainSeq })
      .from(auditLog)
      .where(gt(auditLog.chainSeq, head.seq))
      .orderBy(asc(auditLog.chainSeq))
      .limit(1);
    if (beyond) problem(beyond.seq, `rows lie beyond the head's place ${head.seq}, from place ${beyond.seq}`);
    if (!previous) {
      if (head.seq !== 0 || head.hash !== CHAIN_ZERO_HASH) problem(null, `the head names place ${head.seq}, but no row is at or before it`);
    } else if (previous.seq !== head.seq) {
      problem(null, `the head names place ${head.seq}, but the newest row up to it is at place ${previous.seq}`);
    } else if (previous.hash !== head.hash) {
      problem(head.seq, "the head's hash is not the hash of the row at its place");
    }
  }
  for (const place of kept) {
    if (!keptSeen.has(place.seq)) problem(place.seq, `the kept place ${place.seq}:${place.hash} no longer matches: no row is at that place`);
  }
  const newestSeq = previous?.seq ?? 0;
  const newestKept = kept.length > 0 ? Math.max(...kept.map((place) => place.seq)) : 0;
  return {
    head,
    rows,
    newest: previous,
    keptChecked: kept.length,
    unanchored: Math.max(0, newestSeq - newestKept),
    keys,
    keyRows,
    problems,
    problemCount,
  };
}

/**
 * The staff keys' check, outside the snapshot: every staff key has exactly one staff_key_added row, which names it in
 * key_id. A key with none among the rows read is looked up again through `fresh`; one whose row was written after the
 * head is left to the next run, and one with no row at all is a problem.
 */
async function finishReport(walk: Walk, fresh: Pick<Db, "select">): Promise<AuditReport> {
  const problems = [...walk.problems];
  let problemCount = walk.problemCount;
  const problem = (message: string) => {
    problemCount++;
    if (problems.length < PROBLEMS_KEPT) problems.push({ place: null, message });
  };
  const missing: string[] = [];
  for (const key of walk.keys) {
    const places = walk.keyRows.get(key) ?? [];
    if (places.length === 0) missing.push(key);
    else if (places.length > 1) problem(`staff key ${key} has ${places.length} staff_key_added rows (places ${places.join(", ")})`);
  }
  let keysLeftToNextRun = 0;
  if (missing.length > 0) {
    const read = walk.head ? walk.head.seq : (walk.newest?.seq ?? 0);
    const later = await fresh
      .select({ keyId: auditLog.keyId })
      .from(auditLog)
      .where(and(eq(auditLog.action, "staff_key_added"), inArray(auditLog.keyId, missing), gt(auditLog.chainSeq, read)));
    const addedLater = new Set(later.map((row) => row.keyId));
    for (const key of missing) {
      if (addedLater.has(key)) keysLeftToNextRun++;
      else problem(`staff key ${key} has no staff_key_added row`);
    }
  }
  return {
    ok: problemCount === 0,
    rows: walk.rows,
    head: walk.head,
    keptChecked: walk.keptChecked,
    unanchored: walk.unanchored,
    keysChecked: walk.keys.length,
    keysLeftToNextRun,
    problems,
    problemCount,
  };
}

/**
 * audit-verify on the command line's own connections: the record read on the API's role in one REPEATABLE READ READ ONLY
 * transaction, the staff keys on the auth role's.
 */
export async function auditVerify(db: { api: Db; auth: Db }, kept: readonly KeptPlace[]): Promise<AuditReport> {
  const walk = await db.api.transaction((tx) => walkRecord(tx, kept, db.auth), { isolationLevel: "repeatable read", accessMode: "read only" });
  return finishReport(walk, db.api);
}

/**
 * The same check through a transaction the caller holds, so a test can verify rows it wrote, or rewrote as the owner, and
 * then roll back: no later test sees a chain broken on purpose. The staff keys are read through the transaction too,
 * unless its role cannot read them (the API's), when `keysFrom` names the auth role's pool.
 */
export async function checkAuditRecord(tx: DbTx, kept: readonly KeptPlace[], keysFrom: Pick<Db, "select"> = tx): Promise<AuditReport> {
  return finishReport(await walkRecord(tx, kept, keysFrom), tx);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** How audit-verify reports: what holds, or the first problems; and the rows no kept place anchors yet. */
export function describeReport(report: AuditReport): string[] {
  const lines: string[] = [];
  if (report.ok) {
    lines.push(
      report.rows === 0
        ? "audit-verify: the chain holds: the audit log is empty"
        : `audit-verify: the chain holds: ${plural(report.rows, "row", "rows")}, from place 1 to the head ${report.head!.seq}:${report.head!.hash}`,
    );
  } else {
    lines.push(`audit-verify: FAILED, ${plural(report.problemCount, "problem", "problems")}; the first rows at fault:`);
    const shown = report.problems.slice(0, 20);
    for (const p of shown) lines.push(p.place === null ? `  ${p.message}` : `  place ${p.place}: ${p.message}`);
    if (report.problemCount > shown.length) lines.push(`  and ${report.problemCount - shown.length} more`);
  }
  lines.push(
    report.keptChecked === 0
      ? `no kept place given: ${plural(report.unanchored, "row is", "rows are")} not yet anchored by a kept place`
      :`${plural(report.keptChecked, "kept place", "kept places")} checked; ${plural(report.unanchored, "row", "rows")} after the newest kept place ${report.unanchored === 1 ? "is" : "are"} not yet anchored`,
  );
  lines.push(
    `${plural(report.keysChecked, "staff key", "staff keys")} checked` +
      (report.keysLeftToNextRun > 0 ? `; ${plural(report.keysLeftToNextRun, "key was", "keys were")} added after this run's head and are left to the next run` : ""),
  );
  return lines;
}

// ---------------------------------------------------------------- enroll

/** How long an enrolment link works (3a design, section 2). */
const ENROLMENT_MINUTES = 30;
/** At most this many live staff keys per account; auth.add_staff_key refuses a sixth too. */
const LIVE_KEYS_MAX = 5;

/** What enroll issued, or why it refused. */
export type IssuedEnrolment =
  | { ok: true; token: string; email: string; role: string; expiresAt: Date }
  | { ok: false; problem: string };

/**
 * Issues an enrolment link as the migrator (3a design, section 7), in one transaction that first locks the account's row
 * FOR NO KEY UPDATE, as every writer of staff rows takes it, and waits for it at most 10 seconds. It refuses, writing
 * nothing, unless the account is live, staff and has a handle (the console names staff by their handle) and holds fewer
 * than five live keys. It writes the enrolment with only the token's sha256 and the console's origin and relying party ID,
 * its staff_enrollment_issued event, and last its audit row, which holds the chain's head until the commit. The token is
 * 32 random bytes; it is printed once and kept nowhere.
 */
export async function issueEnrolment(db: Db, email: string, settings: Pick<EnrollSettings, "consoleOrigin" | "consoleRpId">): Promise<IssuedEnrolment> {
  return db.transaction(async (tx): Promise<IssuedEnrolment> => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const [account] = await tx
      .select({ id: users.id, email: users.email, role: users.role, onboardedAt: users.onboardedAt })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
      .limit(1)
      .for("no key update");
    if (!account) return { ok: false, problem: `no live account for ${email}` };
    if (account.role === "user") return { ok: false, problem: `${email} is not staff (its role is user): make it staff with grant-role first` };
    if (account.onboardedAt === null) {
      return { ok: false, problem: `${email} has no handle yet: the console names staff by their handle, so the account chooses one in the app first` };
    }
    const [held] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(staffKeys)
      .where(and(eq(staffKeys.userId, account.id), isNull(staffKeys.revokedAt)));
    if ((held?.count ?? 0) >= LIVE_KEYS_MAX) {
      return { ok: false, problem: `${email} already holds ${LIVE_KEYS_MAX} live staff keys, the most an account may hold: revoke one before enrolling another` };
    }
    const token = randomBytes(32).toString("base64url");
    // The database's clock, which auth.add_staff_key checks the expiry against; the creation time is the same now().
    const [enrolment] = await tx
      .insert(staffEnrollments)
      .values({
        userId: account.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        origin: settings.consoleOrigin,
        rpId: settings.consoleRpId,
        expiresAt: sql`now() + make_interval(mins => ${ENROLMENT_MINUTES}::int)`,
      })
      .returning({ id: staffEnrollments.id, expiresAt: staffEnrollments.expiresAt });
    await tx.insert(authEvents).values({ userId: account.id, type: "staff_enrollment_issued", metadata: { enrollmentId: enrolment!.id, via: "cli" } });
    // As the migrator the row is written directly: auth.append_audit is the auth role's way, and does not take this action.
    await tx.insert(auditLog).values({
      actorId: SYSTEM_ACTOR_ID,
      action: "staff_enrollment_issued",
      targetType: "user",
      targetId: account.id,
      metadata: { enrollmentId: enrolment!.id, via: "cli" },
    });
    return { ok: true, token, email: account.email, role: account.role, expiresAt: enrolment!.expiresAt };
  });
}

/** What enroll prints: the link on a line of its own, so it can be copied whole, and how to hand it over. */
export function describeEnrolment(issued: Extract<IssuedEnrolment, { ok: true }>, consoleOrigin: string): string[] {
  return [
    `Enrolment link for ${issued.email} (${issued.role}), valid for ${ENROLMENT_MINUTES} minutes, until ${issued.expiresAt.toISOString()}, and once:`,
    `${consoleOrigin}/enroll/${issued.token}`,
    "Hand it over by a channel you trust: whoever holds it can register a staff key for this account. The person opens it on the device that holds the key, then signs in once with the new key.",
  ];
}

// ---------------------------------------------------------------- keys

/** One account as keys lists it, with its keys oldest first. */
export interface StaffKeysListing {
  id: string;
  email: string;
  role: string;
  handle: string | null;
  keys: {
    id: string;
    name: string;
    aaguid: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    suspectAt: Date | null;
  }[];
}

/**
 * The staff keys of the live account at `email`, or of every live account whose role is not user; null when no live
 * account has that address. Keys and accounts are read on the auth role, the handles on the API role, which holds the
 * profiles. A key's public key and credential id are never read.
 */
export async function listStaffKeys(db: { api: Pick<Db, "select">; auth: Pick<Db, "select"> }, email: string | null): Promise<StaffKeysListing[] | null> {
  const accounts = await db.auth
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(and(isNull(users.deletedAt), email === null ? ne(users.role, "user") : sql`lower(${users.email}) = lower(${email})`))
    .orderBy(asc(users.email));
  if (email !== null && accounts.length === 0) return null;
  if (accounts.length === 0) return [];
  const ids = accounts.map((account) => account.id);
  const keys = await db.auth
    .select({
      id: staffKeys.id,
      userId: staffKeys.userId,
      name: staffKeys.name,
      aaguid: staffKeys.aaguid,
      createdAt: staffKeys.createdAt,
      lastUsedAt: staffKeys.lastUsedAt,
      revokedAt: staffKeys.revokedAt,
      suspectAt: staffKeys.suspectAt,
    })
    .from(staffKeys)
    .where(inArray(staffKeys.userId, ids))
    .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
  const handles = new Map((await db.api.select({ id: profiles.id, handle: profiles.handle }).from(profiles).where(inArray(profiles.id, ids))).map((p) => [p.id, p.handle]));
  return accounts.map((account) => ({
    ...account,
    handle: handles.get(account.id) ?? null,
    keys: keys.filter((key) => key.userId === account.id).map(({ userId: _owner, ...key }) => key),
  }));
}

/**
 * How keys prints: each account on a line, its keys indented below it. A name is printed as a JSON string, so a quote or
 * a character a terminal would act on is shown escaped, never acted on. A zero AAGUID means the browser or the
 * authenticator withheld its model; none, that the account's deletion blanked it.
 */
export function describeStaffKeys(listing: StaffKeysListing[]): string[] {
  if (listing.length === 0) return ["no staff account"];
  const lines: string[] = [];
  for (const account of listing) {
    lines.push(`${account.role} ${account.email} ${account.handle === null ? "(no handle)" : `@${account.handle}`} (account ${account.id})`);
    if (account.keys.length === 0) lines.push("  no staff keys");
    for (const key of account.keys) {
      const state = key.revokedAt === null ? "live" : `revoked ${key.revokedAt.toISOString()}${key.suspectAt ? `, suspect ${key.suspectAt.toISOString()}` : ""}`;
      lines.push(
        `  key ${key.id} ${JSON.stringify(key.name)}: AAGUID ${key.aaguid ?? "none"}, created ${key.createdAt.toISOString()}, ` +
          `last used ${key.lastUsedAt ? key.lastUsedAt.toISOString() : "never"}, ${state}`,
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------- audit-head

/**
 * The newest row's place, hash and time, read with audit_head in one statement, and whether the head names that row. An
 * empty log's head is place 0 with 64 zeros.
 */
export async function readAuditHead(db: Db): Promise<{ ok: true; place: KeptPlace; createdAt: Date | null } | { ok: false; problem: string }> {
  return db.transaction(
    async (tx) => {
      await readingSettings(tx);
      const newest = tx
        .select({ seq: auditLog.chainSeq, hash: auditLog.hash, createdAt: auditLog.createdAt })
        .from(auditLog)
        .orderBy(desc(auditLog.chainSeq))
        .limit(1)
        .as("newest");
      const [row] = await tx
        .select({ headSeq: auditHead.seq, headHash: auditHead.hash, seq: newest.seq, hash: newest.hash, createdAt: newest.createdAt })
        .from(auditHead)
        .leftJoin(newest, sql`true`)
        .where(eq(auditHead.id, 1));
      if (!row) return { ok: false as const, problem: "the audit head is missing" };
      const head = { seq: row.headSeq, hash: row.headHash };
      if (row.seq === null || row.hash === null) {
        if (head.seq === 0 && head.hash === CHAIN_ZERO_HASH) return { ok: true as const, place: head, createdAt: null };
        return { ok: false as const, problem: `the head names ${head.seq}:${head.hash}, but the audit log holds no row` };
      }
      if (row.seq !== head.seq || row.hash !== head.hash) {
        return { ok: false as const, problem: `the head names ${head.seq}:${head.hash}, but the newest row is ${row.seq}:${row.hash}` };
      }
      return { ok: true as const, place: head, createdAt: row.createdAt };
    },
    { accessMode: "read only" },
  );
}

// ---------------------------------------------------------------- the command

export interface Output {
  log(line: string): void;
  error(line: string): void;
}

/** Runs one command and answers its exit code: 0 when it holds, 1 when it found a problem or failed, 2 for the usage. */
export async function runStaffCommand(args: readonly string[], env: Record<string, string | undefined> = process.env, out: Output = console): Promise<number> {
  let command: StaffCommand;
  try {
    command = parseStaffArgs(args);
  } catch (err) {
    out.error((err as Error).message);
    return 2;
  }
  if (command.command === "enroll") return runEnroll(command.email, env, out);
  if (command.command === "revoke") return runRevoke(command.email, command.key, env, out);
  let urls: { api: string; auth: string | null };
  try {
    urls = staffDatabaseUrls(command, env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  // The command line's own connections: the record on the API's role, which may only read it, and the staff keys on the
  // auth role's, which audit-verify checks the record against.
  const apiDb = createDb(urls.api, { max: 1 });
  const authDb = urls.auth === null ? null : createDb(urls.auth, { max: 1 });
  try {
    if (command.command === "audit-head") {
      const head = await readAuditHead(apiDb);
      if (!head.ok) {
        out.error(`audit-head: ${head.problem}; run audit-verify`);
        return 1;
      }
      out.log(`${head.place.seq}:${head.place.hash} ${head.createdAt ? head.createdAt.toISOString() : "(the audit log is empty)"}`);
      return 0;
    }
    if (command.command === "keys") {
      const listing = await listStaffKeys({ api: apiDb, auth: authDb! }, command.email);
      if (listing === null) {
        out.error(`keys: no live account for ${command.email}`);
        return 1;
      }
      for (const line of describeStaffKeys(listing)) out.log(line);
      return 0;
    }
    const report = await auditVerify({ api: apiDb, auth: authDb! }, command.kept);
    for (const line of describeReport(report)) {
      if (report.ok) out.log(line);
      else out.error(line);
    }
    return report.ok ? 0 : 1;
  } catch (err) {
    out.error(isLockTimeout(err) ? `${command.command}: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(apiDb), ...(authDb ? [closeDb(authDb)] : [])]);
  }
}

/** enroll, on the migrator's own connection: its settings first, so a console that is off connects to nothing. */
async function runEnroll(email: string, env: Record<string, string | undefined>, out: Output): Promise<number> {
  let settings: EnrollSettings;
  try {
    settings = enrollSettings(env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const migrateDb = createDb(settings.migrate, { max: 1 });
  try {
    const issued = await issueEnrolment(migrateDb, email, settings);
    if (!issued.ok) {
      out.error(`enroll: ${issued.problem}; no link was issued`);
      return 1;
    }
    for (const line of describeEnrolment(issued, settings.consoleOrigin)) out.log(line);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `enroll: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(migrateDb);
  }
}

// ---------------------------------------------------------------- revoke

/** What revoke prints of what it did. */
export function describeRevocation(report: Extract<StaffKeysRevokedReport, { ok: true }>, email: string, key: string | "all"): string[] {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (key !== "all" && report.alreadyRevokedAt !== null) {
    return [`revoke: staff key ${key} of ${email} was already revoked at ${report.alreadyRevokedAt.toISOString()}; nothing changed`];
  }
  if (report.keys.length === 0 && report.staffSessionsRevoked === 0 && report.enrollmentsCancelled === 0) {
    return [`revoke: ${email} has nothing to revoke: no live staff key, staff session or unused enrolment link; nothing changed`];
  }
  const lines = [
    `revoke: ${email}: ${count(report.keys.length, "staff key", "staff keys")} revoked, ${count(report.staffSessionsRevoked, "staff session", "staff sessions")} revoked` +
      (key === "all" ? `, ${count(report.enrollmentsCancelled, "unused enrolment link", "unused enrolment links")} deleted` : ""),
  ];
  // A name is printed as a JSON string, as keys prints it, so a character a terminal would act on is shown escaped.
  for (const revoked of report.keys) lines.push(`  key ${revoked.id} ${JSON.stringify(revoked.name)}: ${count(revoked.sessionsRevoked, "staff session", "staff sessions")} revoked`);
  return lines;
}

/** revoke, on the command line's own connection on the auth role: its settings first, so a missing one connects to nothing. */
async function runRevoke(email: string, key: string | "all", env: Record<string, string | undefined>, out: Output): Promise<number> {
  let settings: RevokeSettings;
  try {
    settings = revokeSettings(env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const authDb = createDb(settings.auth, { max: 1 });
  try {
    const report = await revokeStaffKeys({ repo: createAuthRepo(authDb), mailer: mailerFor(settings.mail) }, email, key);
    if (!report.ok) {
      out.error(report.reason === "no_account" ? `revoke: no live account for ${email}; nothing changed` : `revoke: no staff key ${key} on ${email}; nothing changed`);
      return 1;
    }
    for (const line of describeRevocation(report, email, key)) out.log(line);
    // The revocation stands whatever the mail does; the operator tells the person another way.
    if (report.mailError !== null) out.error(`warning: the staff_keys_revoked mail to the account could not be sent (${report.mailError}); the revocation stands`);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `revoke: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(authDb);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void runStaffCommand(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
