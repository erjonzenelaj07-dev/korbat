/**
 * The staff command line (3a design, section 7). Run on the server only. enroll runs in the migrate service, as the
 * migrator, the one application role the running API never holds; the others run like grant-role:
 *
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js keys [<email>]
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js revoke <email> <key id>|all
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-head
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-verify [<chain_seq>:<hash> ...]
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js text-verify
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js access-request <@handle>
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js access-request <email>
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js link|unlink <staff email> <personal handle>
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js limits <five numbers>
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js notification-facts <record>   (3f: cli/records.ts)
 *
 * The commands for moderation cases (3c design, section 7.13) do their work in staff-cases.ts. link and unlink record a
 * staff member's personal accounts for the recusal check and limits sets the limits on staff, each as the migrator, in
 * the migrate service; 3f's notification-facts (cli/records.ts) replaces account-facts. text-verify holds what the record
 * names, and what posts and images show, to the record, on the API's role. access-request drafts the moderation part of
 * an answer to a GDPR access request: for an address in the API service, whose whole configuration it reads, since a
 * notifier's contact is found and opened only with the API's keys; for a handle (3f) in the migrate service, as the
 * migrator, since only the migrator reads whether an authority asked that the person is not told.
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
 * recomputed every later hash still fails against a place kept before it. It also checks every step-up a row stores
 * against the public key, owner, origin and relying party ID of the key it names, so a confirmed action is in the record
 * only with an assertion its actor's key made for exactly that action. Neither needs a server secret or the console's
 * configuration, so both run the same with the console off or moved: each reads only the database URLs it connects with
 * (staffDatabaseUrls), never the API's whole configuration.
 */
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { Email, STAFF_STEP_UP_ACTIONS, STAFF_STEP_UP_CHALLENGE, StaffStoredAssertion, stepUpActionHash, stepUpBindingText } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffEnrollments, staffKeys, users, type Db, type DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID, createAuthRepo, notifierContactsFor, revokeStaffKeys, verifyRecordedAssertion, type StaffKeysRevokedReport } from "../auth";
import { consoleHostOf, consoleOriginSetting, consoleRpIdSetting, databaseUrl, loadConfig, mailFrom, smtpUrl } from "../config";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../staff";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";
import { mailerFor, type CommandLineMailSettings } from "./mail";
import { ORDER_COMMANDS, ORDER_USAGE, orderCommand, parseOrderArgs, type OrderCommand, type OrderCommandName } from "./orders";
import { RECORD_COMMANDS, RECORD_USAGE, authorityHoldsFor, parseRecordArgs, recordCommand, type RecordCommand, type RecordCommandName } from "./records";
import { accessRequest, changeLink, describeTextReport, setLimits, textVerifyOn, type Changed, type StaffLimits } from "./staff-cases";

export const STAFF_USAGE = [
  "usage: node dist/staff.js <command>",
  "  enroll <email>                         print a one-time link, valid 30 minutes, that registers one staff key for the account;",
  "                                         run it in the migrate service: docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>",
  "  keys [<email>]                         list the account's staff keys, or every staff account with its role, address, handle, keys",
  "                                         and the number of personal accounts linked to it",
  "  text-verify                            check that every text and snapshot a confirmed row names is held or erased, every decision",
  "                                         against its row, and every post's level and image's state against the ledger of measures",
  "  access-request <@handle | email>       draft the moderation part of an answer to a GDPR access request, as JSON; for a handle",
  "                                         run it in the migrate service, for an address in the api service",
  "  link <staff email> <personal handle>   record that the personal account is this staff member's own, for the recusal check;",
  "  unlink <staff email> <personal handle> take that record back; both run in the migrate service, as enroll does",
  "  limits <decisions per hour> <decisions per day> <case opens per day> <findings per day> <reveals per day>",
  "                                         set the limits on staff; run it in the migrate service",
  "  audit-head                             print the audit log's newest place, its hash and its time, to keep off the server",
  "  audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before",
  "  revoke <email> <key id>                revoke that staff key and every staff session it opened, and mail its owner",
  "  revoke <email> all                     revoke every staff key and staff session of the account, delete its unused",
  "                                         enrolment links, and mail its owner",
  // 3f (design, section 8.11): the order commands, each as the migrator in the migrate service.
  ...ORDER_USAGE,
  // 3f Task 5 (design, section 8.11): the records to authorities, each as the migrator in the migrate service.
  ...RECORD_USAGE,
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
  | { command: "revoke"; email: string; key: string | "all" }
  | { command: "text-verify" }
  | { command: "access-request"; who: { handle: string } | { email: string } }
  | { command: "link"; email: string; handle: string }
  | { command: "unlink"; email: string; handle: string }
  | { command: "limits"; limits: StaffLimits }
  // 3f: an order command, whose words cli/orders.ts reads, and (Task 5) a record command, whose words cli/records.ts reads.
  | { command: "order"; order: OrderCommand }
  | { command: "record"; record: RecordCommand };

/** A handle as the operator types it, with or without its at sign; kept in lower case, as the profiles hold it. */
const HANDLE = /^@?[A-Za-z0-9_]{1,64}$/;
/** A limit on staff: a whole number from 1, at most a million, written in digits alone. */
const LIMIT = /^[1-9][0-9]{0,6}$/;

function handleOf(arg: string): string {
  if (!HANDLE.test(arg)) throw new Error(`not a handle: ${arg}\n${STAFF_USAGE}`);
  return arg.replace(/^@/, "").toLowerCase();
}

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
    case "text-verify":
      if (rest.length > 0) throw new Error(STAFF_USAGE);
      return { command };
    case "access-request": {
      if (rest.length !== 1) throw new Error(STAFF_USAGE);
      // An address has an at sign inside it; a handle has none, or one in front.
      return { command, who: rest[0]!.lastIndexOf("@") > 0 ? { email: emailArg(rest[0]!) } : { handle: handleOf(rest[0]!) } };
    }
    case "link":
    case "unlink":
      if (rest.length !== 2) throw new Error(STAFF_USAGE);
      return { command, email: emailArg(rest[0]!), handle: handleOf(rest[1]!) };
    case "limits": {
      if (rest.length !== 5) throw new Error(STAFF_USAGE);
      const numbers = rest.map((arg) => {
        if (!LIMIT.test(arg)) throw new Error(`not a limit: ${arg} (a limit is a whole number from 1 to 9999999)\n${STAFF_USAGE}`);
        return Number(arg);
      });
      return { command, limits: { decisionsPerHour: numbers[0]!, decisionsPerDay: numbers[1]!, caseOpensPerDay: numbers[2]!, findingsPerDay: numbers[3]!, revealsPerDay: numbers[4]! } };
    }
    case undefined:
      throw new Error(STAFF_USAGE);
    default:
      if ((ORDER_COMMANDS as readonly string[]).includes(command)) return { command: "order", order: parseOrderArgs(command as OrderCommandName, rest) };
      if ((RECORD_COMMANDS as readonly string[]).includes(command)) return { command: "record", record: parseRecordArgs(command as RecordCommandName, rest) };
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
 * staff keys there (keys also the number of links). text-verify reads on the API's role alone. enroll connects as the
 * migrator alone and reads its settings with enrollSettings; link, unlink and limits with migratorUrl.
 */
export function staffDatabaseUrls(command: Extract<StaffCommand, { command: "keys" | "audit-head" | "audit-verify" | "text-verify" }>, env: Record<string, string | undefined>): { api: string; auth: string | null } {
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

/** What link, unlink, limits and the order and record commands read: the migrator's URL, which only the migrate service holds. */
const MIGRATOR_ENV = z.object({ DATABASE_URL_MIGRATE: databaseUrl });

export function migratorUrl(command: string, env: Record<string, string | undefined>): string {
  return readEnv(MIGRATOR_ENV, env, command).DATABASE_URL_MIGRATE;
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
export const AUDIT_VERIFY_PAGE_SIZE = 1000;
const PAGE_SIZE = AUDIT_VERIFY_PAGE_SIZE;

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
 * The next page of rows after the row `after` (from the lowest place when null) up to place `upto` (to the end when null),
 * in chain order, and by id among rows that share a place. Paging on the place and the id, never the place alone, reads a
 * second row at the place that ends a page, which the walk then refuses; on the place alone the next page would start
 * after that place and never read it. The jsonb columns come as PostgreSQL prints them, which the canonical text embeds
 * as it is.
 */
function chainRows(q: Reader, after: { seq: number; id: number } | null, upto: number | null) {
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
    .where(
      and(
        after === null ? undefined : sql`(${auditLog.chainSeq}, ${auditLog.id}) > (${after.seq}::bigint, ${after.id}::bigint)`,
        upto === null ? undefined : lte(auditLog.chainSeq, upto),
      ),
    )
    .orderBy(asc(auditLog.chainSeq), asc(auditLog.id))
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
  /** The rows read: every row up to the head's place, a second row at a place included; a row with no place is counted apart. */
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

// ---------------------------------------------------------------- step-ups

/**
 * A staff key as audit-verify checks a step-up against it (3a design, section 7, Command line): its owner, its credential
 * and public key, and the origin and relying party ID recorded on it at enrolment, never the console's configuration now.
 */
interface RecordedKey {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  origin: string;
  rpId: string;
}

/** A row as the step-up checks read it: the chain's columns, with the metadata and the step-up as PostgreSQL printed them. */
type StepUpRow = Awaited<ReturnType<typeof chainRows>>[number];

// The authenticator data's flags byte follows the 32-byte hash of the relying party ID: UP and UV (WebAuthn L3, section 6.1).
const AUTH_DATA_FLAGS_AT = 32;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

const sha256 = (text: string) => createHash("sha256").update(text).digest();

/** The members of a JSON object, or null for anything else. */
function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The client data a stored assertion carries, as JSON, or null when it cannot be read. */
function clientDataOf(assertion: StaffStoredAssertion): { type: unknown; origin: unknown; challenge: unknown } | null {
  try {
    const data = objectOf(JSON.parse(Buffer.from(assertion.clientDataJSON, "base64url").toString("utf8")));
    return data ? { type: data.type, origin: data.origin, challenge: data.challenge } : null;
  } catch {
    return null;
  }
}

/** A step-up challenge's binding and expiry, read at the contracts' offsets without the sealing key, or null for anything else. */
function stepUpChallengeOf(challenge: unknown): { binding: Buffer; expiresAt: number } | null {
  const L = STAFF_STEP_UP_CHALLENGE;
  if (typeof challenge !== "string" || challenge.length !== L.encodedLength) return null;
  const bytes = Buffer.from(challenge, "base64url");
  // Only the canonical encoding, as the API's codec reads it.
  if (bytes.length !== L.bytes || bytes.toString("base64url") !== challenge) return null;
  if (bytes[L.versionAt] !== L.version || bytes[L.purposeAt] !== L.purpose) return null;
  return { binding: bytes.subarray(L.bindingAt, L.bindingAt + L.bindingBytes), expiresAt: Number(bytes.readBigUInt64BE(L.expiryAt)) };
}

/**
 * 3f (design, section 7.4): a correction of an order's record under the rule entry or caution takes no key, and its row
 * carries no step-up; the rule is the one the database chose, written into the row's metadata, which the chain covers.
 * A correction under the rule admin is a step-up action like any other.
 */
function keylessCorrection(row: StepUpRow): boolean {
  if (row.action !== "order_corrected") return false;
  try {
    const rule = objectOf(JSON.parse(row.metadataText))?.rule;
    return rule === "entry" || rule === "caution";
  } catch {
    return false;
  }
}

/**
 * One row's step-up (3a design, section 7, Command line), checked in audit-verify's own code with no server secret: a row
 * of a step-up action must carry one, whatever its actor; and a step-up must hold an assertion that the key the row names,
 * a key of the row's actor, made over a step-up challenge bound to the row's session and to the hash of the row's action,
 * target and `metadata.params`, unexpired when the row joined the chain, as a webauthn.get from the origin recorded on the
 * key, naming the relying party ID recorded on it, with user presence and verification. Answers the first check that fails,
 * or null, and the challenge the client data names, which no other row may carry.
 */
async function checkStepUp(row: StepUpRow, keys: ReadonlyMap<string, RecordedKey>): Promise<{ problem: string | null; challenge: string | null }> {
  const fail = (problem: string, challenge: string | null = null) => ({ problem, challenge });
  if (row.stepUpText === null) {
    return Object.hasOwn(STAFF_STEP_UP_ACTIONS, row.action) && !keylessCorrection(row) ? fail(`its action, ${row.action}, needs a step-up, and it carries none`) : { problem: null, challenge: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.stepUpText);
  } catch {
    parsed = null;
  }
  const stored = StaffStoredAssertion.safeParse(parsed);
  if (!stored.success) return fail("its step-up is not a stored assertion");
  const assertion = stored.data;
  const clientData = clientDataOf(assertion);
  const challenge = typeof clientData?.challenge === "string" ? clientData.challenge : null;

  if (row.staffSession === null) return fail("its step-up names no staff session", challenge);
  if (row.keyId === null) return fail("its step-up names no staff key", challenge);
  // The action's hash from the row itself, never from its action_hash column, which the next check compares with it. The
  // metadata is PostgreSQL's print of a jsonb value, so it always parses.
  const params = objectOf(objectOf(JSON.parse(row.metadataText) as unknown)?.params);
  if (row.targetType === null || row.targetId === null || params === null) {
    return fail("its step-up's action cannot be recomputed: it needs a target and metadata.params", challenge);
  }
  let actionHash: string;
  try {
    actionHash = await stepUpActionHash({ action: row.action, target: { type: row.targetType, id: row.targetId }, params });
  } catch {
    return fail("its step-up's action cannot be recomputed: its params are not JSON", challenge);
  }
  if (row.actionHash !== actionHash) return fail("its step-up's action hash is not the hash of its action, target and params", challenge);
  const key = keys.get(row.keyId);
  if (!key) return fail(`its step-up names key ${row.keyId}, which is not a staff key`, challenge);
  if (key.userId !== row.actorId) return fail(`its step-up's key ${key.id} belongs to another account than its actor`, challenge);
  if (clientData === null || clientData.type !== "webauthn.get" || clientData.origin !== key.origin) {
    return fail("its step-up's client data is not a webauthn.get from the origin recorded on its key", challenge);
  }
  const issued = stepUpChallengeOf(challenge);
  if (!issued) return fail("its step-up's challenge is not a step-up challenge", challenge);
  if (!issued.binding.equals(sha256(stepUpBindingText(row.staffSession, actionHash)))) {
    return fail("its step-up's challenge was not issued for this action in this session", challenge);
  }
  if (row.createdAt.getTime() >= issued.expiresAt) return fail("its step-up's challenge had expired when the row was written", challenge);
  const authData = Buffer.from(assertion.authenticatorData, "base64url");
  if (authData.length <= AUTH_DATA_FLAGS_AT || !authData.subarray(0, AUTH_DATA_FLAGS_AT).equals(sha256(key.rpId))) {
    return fail("its step-up's authenticator data does not name the relying party ID recorded on its key", challenge);
  }
  const flags = authData[AUTH_DATA_FLAGS_AT]!;
  if ((flags & FLAG_UP) === 0 || (flags & FLAG_UV) === 0) return fail("its step-up's authenticator data does not report user presence and verification", challenge);
  // The library checks all of the above again, and the signature over the authenticator data and the client data's hash.
  const verified = await verifyRecordedAssertion({ assertion, credential: { id: key.credentialId, publicKey: key.publicKey }, origin: key.origin, rpId: key.rpId });
  if (!verified) return fail(`its step-up's signature does not verify with the public key of key ${key.id}`, challenge);
  return { problem: null, challenge };
}

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
 * rows read or was added after the head, and every key a row read names is among them, since no key is ever deleted.
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
  // What the step-up checks need of each key, and nothing more: never its name, counter or transports.
  const recordedKeys = await keysFrom
    .select({ id: staffKeys.id, userId: staffKeys.userId, credentialId: staffKeys.credentialId, publicKey: staffKeys.publicKey, origin: staffKeys.origin, rpId: staffKeys.rpId })
    .from(staffKeys);
  const keys = recordedKeys.map((key) => key.id);
  const keysById = new Map(recordedKeys.map((key) => [key.id, key]));
  // Every step-up challenge read so far, by the place of the row that carried it: a challenge confirms one row only.
  const challenges = new Map<string, number>();

  const keptAt = new Map<number, string[]>();
  for (const place of kept) keptAt.set(place.seq, [...(keptAt.get(place.seq) ?? []), place.hash]);
  const keptSeen = new Set<number>();
  const keyRows = new Map<string, number[]>();
  let rows = 0;
  let previous: KeptPlace | null = null;
  // Without a head the whole table is read, so the other problems are still named.
  for (let after: { seq: number; id: number } | null = null; ; ) {
    const page = await chainRows(q, after, head ? head.seq : null);
    for (const row of page) {
      rows++;
      const expected = previous ? previous.seq + 1 : 1;
      if (previous && row.chainSeq === previous.seq) {
        problem(row.chainSeq, "another row is already at this place");
      } else if (row.chainSeq < expected) {
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
      const stepUp = await checkStepUp(row, keysById);
      if (stepUp.problem !== null) problem(row.chainSeq, stepUp.problem);
      if (stepUp.challenge !== null) {
        const first = challenges.get(stepUp.challenge);
        if (first !== undefined) problem(row.chainSeq, `its step-up's challenge was already used at place ${first}`);
        else challenges.set(stepUp.challenge, row.chainSeq);
      }
      previous = { seq: row.chainSeq, hash: row.hash };
    }
    if (page.length < PAGE_SIZE) break;
    const last = page[page.length - 1]!;
    after = { seq: last.chainSeq, id: last.id };
  }

  // Every row of the table, counted in the same view: a row the walk by place cannot reach, one with no place at all,
  // is never read above, so the rows read and the rows beyond the head must make up the whole table, with no place
  // held twice. The counts are compared with the walk's own, never trusted to the database's constraints, which the
  // owner can drop.
  const [counts] = await q
    .select({
      total: sql<string>`count(*)::text`,
      placed: sql<string>`count(${auditLog.chainSeq})::text`,
      places: sql<string>`count(distinct ${auditLog.chainSeq})::text`,
      beyond: head ? sql<string>`(count(*) filter (where ${auditLog.chainSeq} > ${head.seq}::bigint))::text` : sql<string>`'0'`,
    })
    .from(auditLog);
  const total = Number(counts!.total);
  const unplaced = total - Number(counts!.placed);
  const shared = Number(counts!.placed) - Number(counts!.places);
  const beyondCount = Number(counts!.beyond);
  if (unplaced > 0) problem(null, `${plural(unplaced, "row of the audit log has", "rows of the audit log have")} no place in the chain`);
  if (shared > 0) problem(null, `${plural(shared, "row is", "rows are")} at a place another row already holds`);
  if (rows + beyondCount !== total) problem(null, `the audit log holds ${total} rows, but ${rows} were read up to the head and ${beyondCount} lie beyond it`);

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
  /** How many personal accounts are linked to the account, never which (3c design, section 7.13). */
  links: number;
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
 * Runs `read` in a read-only transaction that waits at most 10 seconds for a lock, as every staff command waits: the API's
 * roles may lock any table they can update and hold it, and a command that gave up says so (LOCK_TIMEOUT_ADVICE).
 */
function readOnly<T>(db: Pick<Db, "transaction">, read: (tx: Pick<Db, "select" | "execute">) => Promise<T>): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      return read(tx);
    },
    { accessMode: "read only" },
  );
}

/**
 * The staff keys of the live account at `email`, or of every live account whose role is not user; null when no live
 * account has that address. Keys and accounts are read on the auth role, the handles on the API role, which holds the
 * profiles, each in a read-only transaction of its own that waits at most 10 seconds for a lock: keys is the runbook's
 * check against an API under an attacker's control, which must not be able to hang it. A key's public key and
 * credential id are never read.
 */
export async function listStaffKeys(db: { api: Pick<Db, "transaction">; auth: Pick<Db, "transaction"> }, email: string | null): Promise<StaffKeysListing[] | null> {
  const read = await readOnly(db.auth, async (auth) => {
    const accounts = await auth
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(and(isNull(users.deletedAt), email === null ? ne(users.role, "user") : sql`lower(${users.email}) = lower(${email})`))
      .orderBy(asc(users.email));
    if (accounts.length === 0) return { accounts, keys: [], links: new Map<string, number>() };
    // The links themselves are out of every role's reach but the migrator's: the auth role is told only how many each account has.
    const counted = (await auth.execute(sql`select staff_user_id, links from auth.staff_link_counts()`)) as unknown as { staff_user_id: string; links: number }[];
    const links = new Map(counted.map((row) => [row.staff_user_id, row.links]));
    const keys = await auth
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
      .where(inArray(staffKeys.userId, accounts.map((account) => account.id)))
      .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
    return { accounts, keys, links };
  });
  const { accounts, keys, links } = read;
  if (email !== null && accounts.length === 0) return null;
  if (accounts.length === 0) return [];
  const ids = accounts.map((account) => account.id);
  const handles = new Map(
    (await readOnly(db.api, (api) => api.select({ id: profiles.id, handle: profiles.handle }).from(profiles).where(inArray(profiles.id, ids)))).map((p) => [p.id, p.handle]),
  );
  return accounts.map((account) => ({
    ...account,
    handle: handles.get(account.id) ?? null,
    links: links.get(account.id) ?? 0,
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
    // After the keys, so that an account's keys still follow its own line: the count the operator compares with their records.
    lines.push(`  linked personal accounts: ${account.links}`);
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
export async function runStaffCommand(
  args: readonly string[],
  env: Record<string, string | undefined> = process.env,
  out: Output = console,
  // 3f: what order-texts, order-document, address-check and handover-record read; the process's standard input, unless a
  // test hands its own.
  input: () => Promise<Buffer> = readStandardInput,
): Promise<number> {
  let command: StaffCommand;
  try {
    command = parseStaffArgs(args);
  } catch (err) {
    out.error((err as Error).message);
    return 2;
  }
  if (command.command === "enroll") return runEnroll(command.email, env, out);
  if (command.command === "revoke") return runRevoke(command.email, command.key, env, out);
  if (command.command === "link" || command.command === "unlink" || command.command === "limits") return runAsMigrator(command, env, out);
  if (command.command === "access-request") return runAccessRequest(command.who, env, out);
  if (command.command === "order") return runOrderCommand(command.order, env, out, input);
  if (command.command === "record") return runRecordCommand(command.record, env, out, input);
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
    if (command.command === "text-verify") {
      const report = await textVerifyOn(apiDb);
      for (const line of describeTextReport(report)) {
        if (report.ok) out.log(line);
        else out.error(line);
      }
      return report.ok ? 0 : 1;
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

// ---------------------------------------------------------------- the commands for moderation cases

/** link, unlink and limits, on the migrator's own connection: the URL first, so a missing one connects to nothing. */
async function runAsMigrator(command: Extract<StaffCommand, { command: "link" | "unlink" | "limits" }>, env: Record<string, string | undefined>, out: Output): Promise<number> {
  let url: string;
  try {
    url = migratorUrl(command.command, env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const migrateDb = createDb(url, { max: 1 });
  try {
    let done: Changed;
    if (command.command === "limits") done = await setLimits(migrateDb, command.limits);
    else done = await changeLink(migrateDb, command.email, command.handle, command.command === "unlink");
    if (!done.ok) {
      out.error(`${command.command}: ${done.problem}`);
      return 1;
    }
    for (const line of done.lines) out.log(line);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `${command.command}: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(migrateDb);
  }
}

/**
 * access-request. For an address, in the API service: it reads the API's whole configuration, as the API does, because a
 * notifier's contact is found by a keyed hash of the address and its name opened with the notifier key, both the API's
 * secrets. For a handle (3f, W.8), in the migrate service, as the migrator: the draft reads what the API role reads, and
 * besides it whether an authority asked that the person is not told (access.authorityHold), which only the migrator may
 * read (3f design, section 2 row 31: the API's role never learns that an authority is looking at a person); it reads the
 * migrator's URL and APP_ORIGIN, which Compose gives the migrate service, and nothing else. The draft is printed as JSON
 * on standard output, for the operator, and on nothing else.
 */
async function runAccessRequest(who: { handle: string } | { email: string }, env: Record<string, string | undefined>, out: Output): Promise<number> {
  if ("handle" in who) return runAccessRequestForHandle(who, env, out);
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
  try {
    const drafted = await accessRequest(apiDb, config.APP_ORIGIN, who, (email) => notifierContactsFor(authDb, config, email));
    if (!drafted.ok) {
      out.error(`access-request: ${drafted.problem}; nothing was drafted`);
      return 1;
    }
    out.log(JSON.stringify(drafted.draft, null, 2));
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `access-request: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(apiDb), closeDb(authDb)]);
  }
}

// ---------------------------------------------------------------- the order commands (3f)

/** Everything on standard input, as order-texts, order-document, address-check and handover-record read it (run with docker compose run -T). */
async function readStandardInput(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

/**
 * An order command (3f design, section 8.11), on the migrator's own connection in the migrate service: its URL first, so
 * a missing one connects to nothing, and of the API's settings only the two the migrate service is given, HOME_STATE and
 * APP_ORIGIN, each blank when unset (order-open refuses without either).
 */
async function runOrderCommand(command: OrderCommand, env: Record<string, string | undefined>, out: Output, input: () => Promise<Buffer>): Promise<number> {
  let url: string;
  try {
    url = migratorUrl(command.command, env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const blankAsNull = (value: string | undefined) => (value?.trim() ? value.trim() : null);
  const migrateDb = createDb(url, { max: 1 });
  try {
    const done = await orderCommand(migrateDb, command, { homeState: blankAsNull(env.HOME_STATE), appOrigin: blankAsNull(env.APP_ORIGIN) }, input);
    if (!done.ok) {
      out.error(done.problem);
      return 1;
    }
    for (const line of done.lines) out.log(line);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `${command.command}: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(migrateDb);
  }
}

/** access-request for a handle, as the migrator in the migrate service: its URL and the app's origin first, so a missing one connects to nothing. */
async function runAccessRequestForHandle(who: { handle: string }, env: Record<string, string | undefined>, out: Output): Promise<number> {
  const appOrigin = env.APP_ORIGIN?.trim() ?? "";
  let url: string;
  try {
    url = migratorUrl("access-request", env);
    if (appOrigin === "" || new URL(appOrigin).origin !== appOrigin) throw new Error("APP_ORIGIN is not set");
  } catch {
    out.error("access-request: a handle's draft runs in the migrate service, which holds DATABASE_URL_MIGRATE and APP_ORIGIN; nothing was drafted");
    return 1;
  }
  const migrateDb = createDb(url, { max: 1 });
  try {
    const drafted = await accessRequest(migrateDb, appOrigin, who, async () => [], (caseIds) => authorityHoldsFor(migrateDb, caseIds));
    if (!drafted.ok) {
      out.error(`access-request: ${drafted.problem}; nothing was drafted`);
      return 1;
    }
    out.log(JSON.stringify(drafted.draft, null, 2));
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `access-request: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(migrateDb);
  }
}

// ---------------------------------------------------------------- the record commands (3f Task 5)

/**
 * A record command (3f design, sections 7.13, 7.14 and 8.11), on the migrator's own connection in the migrate service: its
 * URL first, so a missing one connects to nothing, and none of the API's settings. Its lines go to standard output; the
 * hand-over list's note goes to standard error, so that the output can be handed to the hand-over's program as it is.
 */
async function runRecordCommand(command: RecordCommand, env: Record<string, string | undefined>, out: Output, input: () => Promise<Buffer>): Promise<number> {
  let url: string;
  try {
    url = migratorUrl(command.command, env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const migrateDb = createDb(url, { max: 1 });
  try {
    const done = await recordCommand(migrateDb, command, input);
    if (!done.ok) {
      out.error(done.problem);
      return 1;
    }
    for (const line of done.lines) out.log(line);
    for (const note of done.notes) out.error(note);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `${command.command}: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
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
