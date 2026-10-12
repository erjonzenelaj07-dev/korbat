import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import pino from "pino";
import {
  RULE_DEFAULT_CATEGORY,
  TIMED_KINDS,
  compareDecisionActions,
  textDigest,
  type ActionKind,
  type AppealsReviewedParams,
  type CaseDecidedParams,
  type RuleId,
  type TdbCategory,
  type TimedKind,
} from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { REDRESS_VERSION, RULES_VERSION } from "@korbat/rules";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../../src/auth";
import type { AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { mediaForCases, type MediaForCases } from "../../src/media";
import { createMediaFiles } from "../../src/media/files";
import { createMediaRepo } from "../../src/media/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { review } from "../../src/moderation/appeals";
import { ModerationError, createBackground, isModerationErrorCode, type Background, type ModerationDeps } from "../../src/moderation/context";
import { decide } from "../../src/moderation/decide";
import { recordIntake, type IntakeGround, type IntakeRecorded, type LiveTarget } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import { newProfile } from "./social-fixtures";
import { newStaffKey } from "./staff-fixtures";

/**
 * Rows for the database tests of the moderation tables (3c design, sections 6.1 and 6.2), written as SQL the way the
 * intake transaction writes them: an insert names only what the API supplies, and the triggers of migrations 0015 and
 * 0016 force the rest. The helpers take a pool or a transaction, so a test chooses the role and whether anything commits.
 * The suites share one database, so a test leaves nothing behind: it runs inside a transaction that is rolled back, or,
 * where a second session must see its rows, it commits them and removes them again with removeFixtures.
 */
export type Runner = Db | DbTx;
export type TargetType = "post" | "account";

export const TC = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC";
export const MINORS = "STATEMENT_CATEGORY_PROTECTION_OF_MINORS";
export const SPEECH = "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH";

/** 32 random bytes as lower-case hex: a salt, a digest's stand-in or a token's hash. */
export const hex64 = () => randomBytes(32).toString("hex");

/** A public reference as the API makes it: N- and ten base32 characters. */
export function newRef(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return `N-${Array.from(randomBytes(10), (byte) => alphabet[byte % 32]).join("")}`;
}

/** Null as SQL, any other value as a parameter. */
const orNull = (value: string | null | undefined, cast: string): SQL => (value === null || value === undefined ? sql`null` : sql`${value}::${sql.raw(cast)}`);

/** Ids as one uuid[] parameter. */
export const uuids = (ids: readonly string[]): SQL => sql`${`{${ids.join(",")}}`}::uuid[]`;

/**
 * A post row straight in the table: these tests need the row, not the flow and its counters. It is dated a month back.
 * The suites share one database, and others read the public Latest timeline from its newest post down and Explore's
 * 48-hour window: a visible post dated now would stand among theirs, and dozens of them push theirs off the first page.
 */
export async function newPostRow(db: Runner, authorId: string, options: { quoteOfId?: string; replyToId?: string; body?: string; createdAt?: SQL } = {}): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`insert into posts (author_id, body, quote_of_id, reply_to_id, created_at)
        values (${authorId}::uuid, ${options.body ?? "a post"}, ${orNull(options.quoteOfId, "uuid")}, ${orNull(options.replyToId, "uuid")}, ${options.createdAt ?? sql`now() - interval '30 days'`})
        returning id`,
  );
  return row!.id;
}

/**
 * A ready image of the account, on the post when one is given. The row is inserted on no post, which is the only way the
 * database takes one, and then attached with one update of post_id, position and alt text, as the media repository's
 * attach does.
 */
export async function newImageRow(db: Runner, ownerId: string, postId: string | null, position = 0): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`insert into post_media (owner_id, status, width, height, blurhash) values (${ownerId}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL') returning id`,
  );
  if (postId) await db.execute(sql`update post_media set post_id = ${postId}::uuid, position = ${position}, alt_text = ${`image ${position + 1}`} where id = ${row!.id}::uuid`);
  return row!.id;
}

export interface IntakeInput {
  kind?: "user" | "finding";
  channel?: "signed_in" | "signed_out" | "staff";
  reporterId?: string | null;
  findingBy?: string | null;
  contactId?: string | null;
  ruleId?: string | null;
  allegesIllegal?: boolean;
  csam?: boolean;
  category?: string;
  categoryKeyword?: string | null;
  citedLaw?: string | null;
  explanation?: string | null;
  bonaFide?: boolean;
  lookupHash?: string | null;
  ref?: string;
}

/** Inserts an intake with the ground's columns, as step 4.2 of the intake transaction does, and answers its id. */
export async function insertIntake(db: Runner, input: IntakeInput): Promise<string> {
  const [row] = await db.execute<{ id: string }>(sql`
    insert into intakes (kind, ref, lookup_hash, channel, reporter_id, finding_by, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide)
    values (${input.kind ?? "user"}::intake_kind, ${input.ref ?? newRef()}, ${orNull(input.lookupHash, "text")}, ${input.channel ?? "signed_in"}::intake_channel,
            ${orNull(input.reporterId, "uuid")}, ${orNull(input.findingBy, "uuid")}, ${orNull(input.contactId, "uuid")}, ${orNull(input.ruleId, "text")},
            ${input.allegesIllegal ?? false}, ${input.csam ?? false}, ${input.category ?? TC}, ${orNull(input.categoryKeyword, "text")},
            ${orNull(input.citedLaw, "text")}, ${orNull(input.explanation, "text")}, ${input.bonaFide ?? false})
    returning id`);
  return row!.id;
}

/** A signed-in report under a korbat rule. */
export const ruleReport = (db: Runner, reporterId: string, ruleId = "R1") => insertIntake(db, { kind: "user", channel: "signed_in", reporterId, ruleId, category: TC });

/** A signed-in notice that the target is illegal, with its explanation and good-faith statement. */
export const illegalNotice = (db: Runner, reporterId: string) =>
  insertIntake(db, { kind: "user", channel: "signed_in", reporterId, allegesIllegal: true, category: SPEECH, explanation: "It breaks the law.", bonaFide: true });

/** A notice on the path for child sexual abuse material: signed out, no account, no contact, only the token's hash. */
export const csamNotice = (db: Runner) => insertIntake(db, { kind: "user", channel: "signed_out", csam: true, allegesIllegal: true, category: MINORS, lookupHash: hex64() });

/** A moderator's own finding under a rule. */
export const findingBy = (db: Runner, staffId: string, ruleId: string, category = TC) => insertIntake(db, { kind: "finding", channel: "staff", findingBy: staffId, ruleId, category });

/**
 * The target's open case, opened when there is none: the insert that does nothing on a conflict and the read of the
 * open case, as step 4.3 of the intake transaction runs them.
 */
export async function openCase(db: Runner, targetType: TargetType, targetId: string): Promise<string> {
  await db.execute(sql`insert into cases (target_type, target_id) values (${targetType}::moderation_target, ${targetId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
  const [row] = await db.execute<{ id: string }>(sql`select id from cases where target_type = ${targetType}::moderation_target and target_id = ${targetId}::uuid and closed_at is null`);
  if (!row) throw new Error("the target has no open case");
  return row.id;
}

/** An item as the database stores it, with the columns these tests read. A raw read hands every time over as PostgreSQL's text. */
export interface ItemRow {
  id: string;
  intake_id: string;
  position: number;
  target_type: TargetType;
  target_id: string;
  named_handle: string | null;
  case_id: string | null;
  seq: number | null;
  lane: number;
  reporter_account_id: string | null;
  alleges_illegal: boolean;
  suspect: boolean;
  created_at: string;
  outcome: string | null;
  answered_by: string | null;
  outcome_sent_at: string | null;
  shown_outcome: string | null;
  revision_pending_at: string | null;
  revised_sent_at: string | null;
  outcome_mail: string;
  reexamines_item_id: string | null;
  statement: string | null;
  erased_at: string | null;
}

export interface ItemInput {
  intakeId: string;
  caseId: string | null;
  targetType?: TargetType;
  targetId: string;
  position?: number;
  lane?: number;
  namedHandle?: string | null;
  outcome?: string | null;
  reexaminesItemId?: string | null;
  /** Further columns and their values as SQL, for the tests that supply what the trigger forces. */
  extra?: Record<string, SQL>;
  /** A comment the statement carries, by which a test finds the session that runs it. */
  marker?: string;
}

/** Inserts one item and answers the row as the attach trigger left it. */
export async function insertItem(db: Runner, input: ItemInput): Promise<ItemRow> {
  const extra = Object.entries(input.extra ?? {});
  const names = extra.map(([name]) => sql.raw(`, ${name}`));
  const values = extra.map(([, value]) => sql`, ${value}`);
  const [row] = await db.execute<ItemRow & Record<string, unknown>>(sql`
    insert ${sql.raw(input.marker ? `/* ${input.marker} */` : "")} into intake_items (intake_id, case_id, target_type, target_id, position, lane, named_handle, outcome, reexamines_item_id${sql.join(names, sql``)})
    values (${input.intakeId}::uuid, ${orNull(input.caseId, "uuid")}, ${input.targetType ?? "post"}::moderation_target, ${input.targetId}::uuid, ${input.position ?? 1}, ${input.lane ?? 2},
            ${orNull(input.namedHandle, "text")}, ${orNull(input.outcome, "item_outcome")}, ${orNull(input.reexaminesItemId, "uuid")}${sql.join(values, sql``)})
    returning *`);
  return row!;
}

/** A case's derived columns. */
export interface CaseRow {
  id: string;
  lane: number;
  intake_seq: number;
  answered_seq: number;
  state_version: number;
  opened_at: string;
  oldest_open_at: string | null;
  last_decided_at: string | null;
  closed_at: string | null;
}

export async function readCase(db: Runner, id: string): Promise<CaseRow> {
  const [row] = await db.execute<CaseRow & Record<string, unknown>>(sql`select * from cases where id = ${id}::uuid`);
  return row!;
}

/** The items of a case, in the order they attached. */
export async function itemsOf(db: Runner, caseId: string): Promise<ItemRow[]> {
  const rows = await db.execute<ItemRow & Record<string, unknown>>(sql`select * from intake_items where case_id = ${caseId}::uuid order by seq`);
  return [...rows];
}

/**
 * A whole suspect intake on one target, as a notice on the CSAM path leaves it: the intake, the target's open case and
 * the item in lane 0. From its commit on, every post the case reaches is frozen.
 */
export async function suspectItemOn(db: Runner, targetType: TargetType, targetId: string, namedHandle: string | null = null): Promise<{ intakeId: string; caseId: string; item: ItemRow }> {
  const intakeId = await csamNotice(db);
  const caseId = await openCase(db, targetType, targetId);
  const item = await insertItem(db, { intakeId, caseId, targetType, targetId, lane: 0, namedHandle: targetType === "account" ? (namedHandle ?? "named") : null });
  return { intakeId, caseId, item };
}

/** Whether the post is frozen, as the role of the runner reads it. */
export async function postFrozen(db: Runner, postId: string): Promise<boolean> {
  const [row] = await db.execute<{ frozen: boolean }>(sql`select public.post_frozen(${postId}::uuid) as frozen`);
  return row!.frozen;
}

// ---------------------------------------------------------------- the moderation module on a pool or a transaction

/**
 * The tasks a request starts after its commit, for the module over a transaction: kept until `settle`, which runs them
 * one after the other. Over a pool they run at once, as on the server. Over a transaction they would share the test's
 * one connection with the test's own statements, and the transaction in which a mail's result is recorded (a savepoint
 * there) would open and roll back among the test's own savepoints. A test that reads what such a task did settles first.
 */
function deferredBackground(log: pino.Logger): Background {
  const queued: (() => Promise<void>)[] = [];
  const running = createBackground(log);
  return {
    start: (task) => void queued.push(task),
    async settle() {
      while (queued.length > 0) {
        running.start(queued.shift()!);
        await running.settle();
      }
    },
  };
}

/**
 * The moderation module's dependencies over a pool, or over a transaction that the test rolls back: the module opens its
 * own transactions on what it is given, which on a transaction are savepoints, so the intake and the decision run their
 * real statements and nothing commits.
 */
export function moderationDeps(db: Runner, overrides: Partial<ModerationDeps> = {}): ModerationDeps {
  const log = pino({ level: "silent" });
  // A transaction can be rolled back; a pool cannot.
  const overTransaction = "rollback" in db;
  return {
    apiDb: db as Db,
    auth: noAuthForModeration(),
    social: socialForModeration(db as Db),
    media: casesMedia(db),
    limits: new MemoryStore(),
    background: overTransaction ? deferredBackground(log) : createBackground(log),
    config: loadConfig(),
    log,
    now: () => new Date(),
    ...overrides,
  };
}

/**
 * The auth module's interface for a test that stores no contact and sends no mail: every member throws, so a flow that
 * reaches one fails its test instead of passing by accident. A test of the notice routes passes the real interface. One
 * member answers: every read of the staff overview asks how many contacts the janitor is late with, and here none is.
 */
export function noAuthForModeration(): AuthForModeration {
  return new Proxy({} as AuthForModeration, {
    get: (_target, member) =>
      typeof member !== "string" || member === "then"
        ? undefined
        : member === "overdueContacts"
          ? async () => 0
          : () => {
            throw new Error(`this test built the moderation module without the auth module, and ${member} was called`);
          },
  });
}

/** The folders that casesMedia made in this test process, removed when the process ends. */
const caseVolumes = new Set<string>();
process.once("exit", () => {
  for (const root of caseVolumes) rmSync(root, { recursive: true, force: true });
});

/**
 * The media module's interface for cases over a pool or a transaction, as the server hands it to the moderation module.
 * Its volumes are folders that nothing creates: the database tests lock, hold and count image rows and never open a
 * file, and a test that does builds the interface over a store of its own. One thing is written all the same: the
 * disposal deletes no row whose files it cannot note as owed, so the first time an interface made here is asked to note
 * or to request a deletion, the two directories of deletion requests are created under a folder of that interface's
 * own. What one test wrote there is never read through another test's interface.
 */
export function casesMedia(db: Runner): MediaForCases {
  const log = pino({ level: "silent" });
  const root = path.join(tmpdir(), "korbat-test-case-volumes", randomUUID());
  const files = createMediaFiles({ uploadsDir: path.join(root, "uploads"), storeDir: path.join(root, "store"), log });
  /** The write, with the two directories made before the first one. */
  const writing = (write: (ids: readonly string[]) => Promise<void>) => async (ids: readonly string[]) => {
    if (!caseVolumes.has(root)) {
      for (const dir of [files.uploads.deletions, files.uploads.owed]) mkdirSync(dir, { recursive: true });
      caseVolumes.add(root);
    }
    await write(ids);
  };
  return mediaForCases({ repo: createMediaRepo(db as Db), files: { ...files, oweDeletion: writing(files.oweDeletion), requestDeletion: writing(files.requestDeletion) }, log });
}

const NO_GROUND = { reporterId: null, findingBy: null, contactId: null, ruleId: null, allegesIllegal: false, csam: false, categoryKeyword: null, citedLaw: null, explanation: null, bonaFide: false } as const;

/** What an intake alleges and who sent it, for each way a report arrives. */
export const ground = {
  /** A signed-in report under a korbat rule. */
  rule: (reporterId: string, ruleId: RuleId = "R1"): IntakeGround => ({ ...NO_GROUND, kind: "user", channel: "signed_in", reporterId, ruleId, category: TC }),
  /** A notice that the target is illegal: signed in, or signed out without a contact when no reporter is given. */
  illegal: (reporterId: string | null, category: TdbCategory = SPEECH): IntakeGround => ({
    ...NO_GROUND,
    kind: "user",
    channel: reporterId === null ? "signed_out" : "signed_in",
    reporterId,
    allegesIllegal: true,
    category,
    explanation: "It breaks the law.",
    bonaFide: true,
  }),
  /** A notice on the path for child sexual abuse material: no account, no contact. */
  csam: (): IntakeGround => ({ ...NO_GROUND, kind: "user", channel: "signed_out", allegesIllegal: true, csam: true, category: MINORS }),
  /** A moderator's own finding under a rule; citing R2 it is suspect. */
  finding: (staffId: string, ruleId: RuleId = "R1"): IntakeGround => ({ ...NO_GROUND, kind: "finding", channel: "staff", findingBy: staffId, ruleId, category: RULE_DEFAULT_CATEGORY[ruleId] }),
};

/** One intake through the module's own transaction. A single target gets position 1. */
export function intake(db: Runner, ground: IntakeGround, targets: LiveTarget | readonly LiveTarget[]): Promise<IntakeRecorded> {
  const live = Array.isArray(targets) ? (targets as readonly LiveTarget[]) : [targets as LiveTarget];
  return recordIntake(moderationDeps(db), { ground, live });
}

/** A post as an intake's first target. */
export const aPost = (id: string, position = 1): LiveTarget => ({ type: "post", id, position });
/** An account as an intake's first target, named by a handle. */
export const anAccount = (id: string, namedHandle = "named", position = 1): LiveTarget => ({ type: "account", id, position, namedHandle });

/** An author (a new profile unless one is given) and a post of theirs with this many images. */
export async function imagePost(db: Runner, images = 0, authorId?: string, options: { quoteOfId?: string; replyToId?: string } = {}): Promise<{ authorId: string; postId: string; mediaIds: string[] }> {
  const owner = authorId ?? (await newProfile(db as Db)).id;
  const postId = await newPostRow(db, owner, options);
  const mediaIds: string[] = [];
  for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(db, owner, postId, position));
  return { authorId: owner, postId, mediaIds };
}

/**
 * One report about the target by someone new, into the target's open case (opened when there is none): under a rule, as
 * a notice of illegality, or on the path for child sexual abuse material, which records no sender.
 */
export async function report(db: Runner, target: LiveTarget, by: "rule" | "illegal" | "csam" = "rule", rule: RuleId = "R1"): Promise<{ caseId: string; recorded: IntakeRecorded }> {
  const sender = by === "csam" ? null : (await newProfile(db as Db)).id;
  const recorded = await intake(db, by === "csam" ? ground.csam() : by === "illegal" ? ground.illegal(sender) : ground.rule(sender!, rule), target);
  return { caseId: recorded.items.find((item) => item.position === target.position)!.caseId!, recorded };
}

// ---------------------------------------------------------------- staff and decisions

/** A staff account as the database tests need it: its id, a live staff key of its own and its role. It has no profile until a test gives it one. */
export interface TestStaff {
  id: string;
  keyId: string;
  role: "moderator" | "admin";
}

/**
 * A live staff account with one live key, committed on the auth side: the decision triggers read the account's role and
 * the audit function its key, in the auth schema, which a transaction of the API role cannot write. The key's public key
 * is a placeholder: no test that commits an audit row signs with it.
 */
export async function newTestStaff(authDb: Db, migrateDb: Db, repo: AuthRepo, role: "moderator" | "admin" = "moderator"): Promise<TestStaff> {
  const { user, key } = await newStaffKey(authDb, migrateDb, repo, role);
  return { id: user.id, keyId: key.id, role };
}

/** The staff account's profile row, which a decision, a finding and a staff text refer to. Its handle is random. */
export async function staffProfile(db: Runner, staff: { id: string }): Promise<void> {
  await db.execute(sql`insert into profiles (id, handle, display_name) values (${staff.id}::uuid, ${`st_${randomBytes(5).toString("hex")}`}, 'Staff')`);
}

/** Saves a staff text on a case as the console will: a fresh salt, and the digest of the salt and the text. Answers the digest. */
export async function saveText(db: Runner, caseId: string, authorId: string, kind: string, text = `a ${kind} text ${randomUUID()}`): Promise<string> {
  const salt = hex64();
  const digest = await textDigest(salt, text);
  await db.execute(sql`insert into staff_texts (case_id, author_id, kind, text, salt, digest) values (${caseId}::uuid, ${authorId}::uuid, ${kind}::staff_text_kind, ${text}, ${salt}, ${digest})`);
  return digest;
}

/** The case's newest snapshot, as a decision names it. */
export async function newestSnapshot(db: Runner, caseId: string): Promise<{ id: string; digest: string }> {
  const [row] = await db.execute<{ id: string; digest: string }>(sql`select id, digest from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc limit 1`);
  if (!row) throw new Error("the case holds no snapshot");
  return { id: row.id, digest: row.digest };
}

/** What a test says about a decision; everything left out is filled in from the case as the console would. */
export interface DecisionInput {
  /** `interim` unless said. */
  kind?: "interim" | "final" | "correction";
  /** `restricted` for an interim or final decision, `reversed` for a correction, unless said. */
  outcome?: CaseDecidedParams["outcome"];
  /** For a restriction `incompatible` unless said; else none. */
  ground?: "incompatible" | "illegal" | null;
  /** R1 for the ground `incompatible` unless said. */
  ruleId?: RuleId | null;
  category?: TdbCategory;
  categoryKeyword?: "KEYWORD_TERRORIST_CONTENT" | null;
  /** A suspension's, a termination's and a restriction of reporting's days and whether it is announced go with it. */
  actions?: readonly { kind: ActionKind; mediaId?: string | null; days?: number | null; announced?: boolean }[];
  /** For a final decision the case's newest item unless said. */
  throughSeq?: number;
  /** The case's version now unless said. */
  stateVersion?: number;
  reviewsDecisionId?: string | null;
  snapshotId?: string;
  snapshotDigest?: string;
  /** Each text is saved fresh where the decision needs one, unless a digest (or null) is given. */
  factsDigest?: string | null;
  reasonDigest?: string | null;
  legalReferenceDigest?: string | null;
  rulesVersion?: number;
  redressVersion?: number;
  /**
   * 3e (design, section 12): a final restriction signs the strike the database computes (strike_due, asked with leave_out
   * null, as the console asks it), and a correction that reverses a decision whole signs the overruling of its strike.
   * `strike` and `overrule` set either by hand, for the tests of the database's refusals; left out, the fixture asks.
   */
  strike?: boolean;
  overrule?: boolean;
  /** The items the decision marks "manifestly unfounded"; [] unless said. */
  unfounded?: readonly string[];
  /** Whether a correction withdraws an announced measure for another; false unless said. */
  replaced?: boolean;
}

/** A measure on the post, the account's field or the case's images; an image measure with its image. */
export const act = (kind: ActionKind, mediaId: string | null = null) => ({ kind, mediaId });

/** A suspension, a termination or a restriction of reporting with its days (null for a termination) and whether it is announced. */
export const timed = (kind: "suspend" | "terminate" | "restrict_reporting", days: number | null, announced: boolean) => ({ kind, mediaId: null, days, announced });

/** An action entry in the shape the params sign: the three timed kinds carry their days and whether they are announced. */
function signedAction(action: { kind: ActionKind; mediaId?: string | null; days?: number | null; announced?: boolean }): CaseDecidedParams["actions"][number] {
  if ((TIMED_KINDS as readonly string[]).includes(action.kind)) {
    return { kind: action.kind as TimedKind, mediaId: null, days: action.days ?? null, announced: action.announced ?? false };
  }
  return { kind: action.kind as Exclude<ActionKind, TimedKind>, mediaId: action.mediaId ?? null };
}

/**
 * Whether the database gives a strike to a final restriction of this case on this ground and rule that answers the
 * items through `throughSeq`: strike_due with leave_out null, asked with the suspicion the decision will rest on (an
 * answered item that is suspect), as the console asks it with the case answer's strikeDue.
 */
export async function strikeDueFor(db: Runner, caseId: string, ground: "incompatible" | "illegal" | null, ruleId: string | null, throughSeq: number): Promise<boolean> {
  const [row] = await db.execute<{ due: boolean }>(
    sql`select public.strike_due(${caseId}::uuid, ${ground}::decision_ground, ${ruleId}::text,
                 exists (select 1 from intake_items i join cases c on c.id = i.case_id
                          where i.case_id = ${caseId}::uuid and i.suspect and i.seq > c.answered_seq and i.seq <= ${throughSeq}::int), null) as due`,
  );
  return row?.due ?? false;
}

/** Whether a decision holds a strike that no overruling reversed: a correction or a review that reverses it whole signs its overruling. */
export async function holdsStandingStrike(db: Runner, decisionId: string): Promise<boolean> {
  const [row] = await db.execute<{ held: boolean }>(
    sql`select exists (select 1 from decision_actions a where a.decision_id = ${decisionId}::uuid and a.kind = 'strike'
                         and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)) as held`,
  );
  return row?.held ?? false;
}

/**
 * The params of a decision on the case as the console builds them: the case's version, the range a final decision
 * answers, the newest snapshot with its digest, the digests of freshly saved texts, the actions in their one order with
 * the strike or the overruling the database expects, and 3e's two members.
 */
export async function decisionParams(db: Runner, staff: { id: string }, caseId: string, input: DecisionInput = {}): Promise<CaseDecidedParams> {
  const kind = input.kind ?? "interim";
  const outcome = input.outcome ?? (kind === "correction" ? "reversed" : "restricted");
  const groundOf = input.ground !== undefined ? input.ground : outcome === "restricted" ? "incompatible" : null;
  const ruleId = input.ruleId !== undefined ? input.ruleId : groundOf === "incompatible" ? "R1" : null;
  const current = await readCase(db, caseId);
  const snapshot = input.snapshotId !== undefined && input.snapshotDigest !== undefined ? { id: input.snapshotId, digest: input.snapshotDigest } : await newestSnapshot(db, caseId);
  let category: TdbCategory = input.category ?? (ruleId !== null ? RULE_DEFAULT_CATEGORY[ruleId] : groundOf === "illegal" ? SPEECH : TC);
  let rulesVersion = input.rulesVersion ?? RULES_VERSION;
  if (kind === "correction" && input.reviewsDecisionId) {
    // A correction carries the category and the rules version of the decision it corrects.
    const [corrected] = await db.execute<{ category: TdbCategory; rules_version: number }>(sql`select category, rules_version from decisions where id = ${input.reviewsDecisionId}::uuid`);
    category = input.category ?? corrected?.category ?? category;
    rulesVersion = input.rulesVersion ?? corrected?.rules_version ?? rulesVersion;
  }
  const throughSeq = input.throughSeq ?? (kind === "final" ? current.intake_seq : 0);
  const actions = (input.actions ?? []).map(signedAction);
  // The strike of a final restriction, exactly when the database gives one; the overruling of a full reversal's strike.
  const strike = input.strike ?? (kind === "final" && outcome === "restricted" && (await strikeDueFor(db, caseId, groundOf, ruleId, throughSeq)));
  if (strike && !actions.some((action) => action.kind === "strike")) actions.push({ kind: "strike", mediaId: null });
  const overrule = input.overrule ?? (kind === "correction" && outcome === "reversed" && !!input.reviewsDecisionId && (await holdsStandingStrike(db, input.reviewsDecisionId)));
  if (overrule && !actions.some((action) => action.kind === "overrule")) actions.push({ kind: "overrule", mediaId: null });
  const text = async (given: string | null | undefined, needed: boolean, textKind: string) => (given !== undefined ? given : needed ? await saveText(db, caseId, staff.id, textKind) : null);
  return {
    kind,
    stateVersion: input.stateVersion ?? current.state_version,
    throughSeq,
    reviewsDecisionId: input.reviewsDecisionId ?? null,
    snapshotId: input.snapshotId ?? snapshot.id,
    snapshotDigest: input.snapshotDigest ?? snapshot.digest,
    outcome,
    ground: groundOf,
    ruleId,
    rulesVersion,
    redressVersion: input.redressVersion ?? REDRESS_VERSION,
    category,
    categoryKeyword: input.categoryKeyword ?? null,
    actions: actions.sort(compareDecisionActions),
    factsDigest: await text(input.factsDigest, outcome === "restricted", "facts"),
    reasonDigest: await text(input.reasonDigest, outcome === "restricted" || kind === "correction", kind === "correction" ? "review_reason" : "reason"),
    legalReferenceDigest: await text(input.legalReferenceDigest, groundOf === "illegal", "legal_reference"),
    unfounded: [...(input.unfounded ?? [])].sort(),
    replaced: input.replaced ?? false,
  };
}

/**
 * A staff session and a confirmation as the staff routes hand them to the moderation module, made up: the hash and the
 * assertion are placeholders that audit-verify would refuse, so the audit row they lead to is only ever written inside a
 * transaction that is rolled back. A decision that commits is confirmed with a real key (moderation-decide.ts).
 */
export function madeUpConfirmation(staff: TestStaff, caseId: string, params: CaseDecidedParams, expiresAt = new Date(Date.now() + 10 * 60_000)): { session: ActiveStaffSession; confirmed: StaffStepUpConfirmed } {
  const now = new Date();
  return {
    session: {
      sessionId: hex64(),
      handle: randomUUID(),
      userId: staff.id,
      keyId: staff.keyId,
      role: staff.role,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    },
    confirmed: {
      action: "case_decided",
      target: { type: "case", id: caseId },
      params,
      actionHash: hex64(),
      keyId: staff.keyId,
      assertion: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
      expiresAt,
    },
  };
}

/** What the database raised, however deeply the driver wrapped it: its SQLSTATE, message and detail. */
export function raised(err: unknown): { code: string; message: string; detail: string | null } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && typeof (current as { code?: unknown }).code === "string" && /^[0-9A-Z]{5}$/.test((current as { code: string }).code)) {
      const found = current as { code: string; message?: unknown; detail?: unknown };
      return { code: found.code, message: String(found.message ?? ""), detail: typeof found.detail === "string" ? found.detail : null };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * A decision inside a transaction that the test rolls back, through the module's own decide: the decision's row, its
 * measures and its audit row, with a made-up confirmation of exactly these params. The deferred check, which a real
 * decision meets at its commit, is made to run right after, inside the same savepoint, so a decision it refuses leaves
 * nothing behind and a later decision of the test is checked alone. Answers the decision's id; a refusal is thrown as the
 * module throws it, with the detail the database gave.
 */
export async function decideWith(tx: DbTx, staff: TestStaff, caseId: string, params: CaseDecidedParams): Promise<string> {
  const { session, confirmed } = madeUpConfirmation(staff, caseId, params);
  try {
    return await tx.transaction(async (sp) => {
      // The fixtures lift the routes' list of kinds (3e design, section 7.1 item 2): the database's rules are tested below the routes.
      const outcome = await decide(moderationDeps(sp), session, confirmed, { requestId: `req-${randomUUID()}` }, { allKinds: true });
      if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck deferred`);
      return outcome.decisionId;
    });
  } catch (err) {
    // The check at commit raises its code as the triggers do; decide maps the same code when a real commit fails.
    const refused = raised(err);
    if (!(err instanceof ModerationError) && refused?.code === "P0001" && isModerationErrorCode(refused.message)) {
      throw Object.assign(new ModerationError(refused.message), { detail: refused.detail });
    }
    throw err;
  }
}

/** The same, with the params filled in from the case as the console would build them. */
export async function decideIn(tx: DbTx, staff: TestStaff, caseId: string, input: DecisionInput = {}): Promise<string> {
  return decideWith(tx, staff, caseId, await decisionParams(tx, staff, caseId, input));
}

// ---------------------------------------------------------------- appeals and reviews

/**
 * The author's appeal of a decision, as the appeal route inserts it: the decision, the appellant and, when one is given,
 * the statement with a salt and a digest. The trigger of migration 0017 decides whether it is open. Answers its id.
 */
export async function appealOf(db: Runner, decisionId: string, appellantId: string, statement?: string): Promise<string> {
  const salt = statement === undefined ? null : hex64();
  const digest = statement === undefined || salt === null ? null : await textDigest(salt, statement);
  const [row] = await db.execute<{ id: string }>(
    sql`insert into appeals (decision_id, appellant_account_id, statement, statement_salt, statement_digest)
        values (${decisionId}::uuid, ${appellantId}::uuid, ${orNull(statement, "text")}, ${orNull(salt, "text")}, ${orNull(digest, "text")}) returning id`,
  );
  return row!.id;
}

/** An appeal's row as the triggers left it. */
export interface AppealRow {
  id: string;
  decision_id: string;
  appellant_account_id: string;
  statement: string | null;
  answered_by: string | null;
  result: string | null;
  answered_at: string | null;
  erased_at: string | null;
}

export async function appealRow(db: Runner, id: string): Promise<AppealRow> {
  const [row] = await db.execute<AppealRow & Record<string, unknown>>(sql`select * from appeals where id = ${id}::uuid`);
  return row!;
}

/** What a test says about a review; everything left out is filled in from the reviewed decision and its case as the console would. */
export interface ReviewInput {
  /** `kept` without reversals, `reversed` with them, unless said. */
  outcome?: AppealsReviewedParams["outcome"];
  actions?: readonly { kind: ActionKind; mediaId?: string | null }[];
  stateVersion?: number;
  /** The reviewed decision's pending appeal unless said. */
  appealId?: string;
  snapshotId?: string;
  snapshotDigest?: string;
  /** A fresh review reason is saved unless a digest is given. */
  reasonDigest?: string;
  rulesVersion?: number;
  redressVersion?: number;
  category?: TdbCategory;
  /** 3e: a review that reverses the decision whole signs the overruling of its strike unless said. */
  overrule?: boolean;
}

/**
 * The params of a review of the decision as the console builds them: the case's version, the decision's pending appeal,
 * the newest snapshot with its digest, the reviewed decision's category and rules version, the digest of a freshly
 * saved review reason, and the reversals in their one order.
 */
export async function reviewParams(db: Runner, staff: { id: string }, decisionId: string, input: ReviewInput = {}): Promise<AppealsReviewedParams> {
  const [reviewed] = await db.execute<{ case_id: string; category: TdbCategory; rules_version: number; appeal_id: string | null }>(
    sql`select d.case_id, d.category, d.rules_version, (select a.id from appeals a where a.decision_id = d.id and a.answered_by is null) as appeal_id from decisions d where d.id = ${decisionId}::uuid`,
  );
  if (!reviewed) throw new Error("the review names a decision that does not exist");
  const current = await readCase(db, reviewed.case_id);
  const snapshot = input.snapshotId !== undefined && input.snapshotDigest !== undefined ? { id: input.snapshotId, digest: input.snapshotDigest } : await newestSnapshot(db, reviewed.case_id);
  const actions = (input.actions ?? []).map(signedAction);
  const outcome = input.outcome ?? (actions.length > 0 ? "reversed" : "kept");
  // A strike falls only with its whole finding: a review that reverses the decision overrules the strike it gave.
  const overrule = input.overrule ?? (outcome === "reversed" && (await holdsStandingStrike(db, decisionId)));
  if (overrule && !actions.some((action) => action.kind === "overrule")) actions.push({ kind: "overrule", mediaId: null });
  actions.sort(compareDecisionActions);
  return {
    stateVersion: input.stateVersion ?? current.state_version,
    // A review without a pending appeal is built all the same, so that a test can see who refuses it.
    appealId: input.appealId ?? reviewed.appeal_id ?? randomUUID(),
    snapshotId: snapshot.id,
    snapshotDigest: snapshot.digest,
    outcome,
    rulesVersion: input.rulesVersion ?? reviewed.rules_version,
    redressVersion: input.redressVersion ?? REDRESS_VERSION,
    category: input.category ?? reviewed.category,
    actions,
    reasonDigest: input.reasonDigest ?? (await saveText(db, reviewed.case_id, staff.id, "review_reason")),
  };
}

/**
 * A review inside a transaction that the test rolls back, through the module's own review, with a made-up confirmation
 * of exactly these params, and its check at commit made to run right after, as decideWith does for a decision. Answers
 * the review's id; a refusal is thrown as the module throws it, with the detail the database gave.
 */
export async function reviewWith(tx: DbTx, staff: TestStaff, decisionId: string, params: AppealsReviewedParams): Promise<string> {
  const { session, confirmed } = madeUpConfirmation(staff, decisionId, params as unknown as CaseDecidedParams);
  const asReview: StaffStepUpConfirmed = { ...confirmed, action: "appeals_reviewed", target: { type: "decision", id: decisionId }, params };
  try {
    return await tx.transaction(async (sp) => {
      const outcome = await review(moderationDeps(sp), session, asReview, { requestId: `req-${randomUUID()}` }, { allKinds: true });
      if (typeof outcome === "string") throw new Error(`the review was not recorded: ${outcome}`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck deferred`);
      return outcome.decisionId;
    });
  } catch (err) {
    const refused = raised(err);
    if (!(err instanceof ModerationError) && refused?.code === "P0001" && isModerationErrorCode(refused.message)) {
      throw Object.assign(new ModerationError(refused.message), { detail: refused.detail });
    }
    throw err;
  }
}

/** The same, with the params filled in from the reviewed decision as the console would build them. */
export async function reviewIn(tx: DbTx, staff: TestStaff, decisionId: string, input: ReviewInput = {}): Promise<string> {
  return reviewWith(tx, staff, decisionId, await reviewParams(tx, staff, decisionId, input));
}

/** The code a flow or a statement was refused with, or null when it went through: a module's error code, or what the database raised. */
export async function refusal(promise: PromiseLike<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof ModerationError) return err.code;
    const fromDatabase = raised(err);
    if (fromDatabase) return fromDatabase.code === "P0001" ? fromDatabase.message : `${fromDatabase.code} ${fromDatabase.message}`;
    if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
    throw err;
  }
}

/** The detail a refusal at commit names: the member of the audit row, or the rule, that did not hold. */
export async function refusalDetail(promise: PromiseLike<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return (err as { detail?: string | null }).detail ?? raised(err)?.detail ?? null;
  }
}

/** A decision's row as the triggers left it, with the columns these tests read. */
export interface DecisionRow {
  id: string;
  case_id: string;
  kind: string;
  outcome: string;
  ground: string | null;
  rule_id: string | null;
  through_seq: number;
  answers_from_seq: number | null;
  source: string;
  suspect: boolean;
  unseen: boolean;
  needs_admin: boolean;
  ended_interim: boolean;
  author_mail: string;
  decided_by: string;
  automated_detection: boolean;
  automated_decision: string;
  territorial_scope: string;
  puid: string;
  redacted_at: string | null;
}

export async function decisionRow(db: Runner, id: string): Promise<DecisionRow> {
  const [row] = await db.execute<DecisionRow & Record<string, unknown>>(sql`select * from decisions where id = ${id}::uuid`);
  return row!;
}

/** A ledger row as the triggers left it. actionsOf answers a decision's rows in the order its params list them: by kind as a word, then by image. */
export interface ActionRow {
  id: string;
  decision_id: string;
  kind: ActionKind;
  media_id: string | null;
  subject_account_id: string;
  post_id: string | null;
  reverses_action_id: string | null;
  no_effect: string | null;
}

export async function actionsOf(db: Runner, decisionId: string): Promise<ActionRow[]> {
  const rows = await db.execute<ActionRow & Record<string, unknown>>(sql`select * from decision_actions where decision_id = ${decisionId}::uuid order by kind::text, media_id`);
  return [...rows];
}

/** A post's state, its level and whether its content was erased. */
export async function postRow(db: Runner, id: string): Promise<{ state: string; level: string; erased: boolean }> {
  const [row] = await db.execute<{ state: string; level: string; erased: boolean }>(sql`select state, moderation_level as level, erased_at is not null as erased from posts where id = ${id}::uuid`);
  return { ...row! };
}

/** Each image's moderation state, in the order asked. */
export async function imageStates(db: Runner, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute<{ id: string; state: string }>(sql`select id, moderation_state as state from post_media where id = any(${uuids(ids)})`);
  const byId = new Map([...rows].map((row) => [row.id, row.state]));
  return ids.map((id) => byId.get(id) ?? "missing");
}

/** The measures in force that the view names, as "kind" or "kind:image", sorted. */
export async function inForce(db: Runner, where: { caseId?: string; postId?: string }): Promise<string[]> {
  const rows = await db.execute<{ kind: string; media_id: string | null }>(
    sql`select kind, media_id from measures_in_force where ${where.caseId ? sql`case_id = ${where.caseId}::uuid` : sql`post_id = ${where.postId!}::uuid`} order by kind::text, media_id`,
  );
  return [...rows].map((row) => (row.media_id ? `${row.kind}:${row.media_id}` : row.kind));
}

/**
 * Deletes these cases with everything that hangs on them, and these intakes with their items, in the order the keep
 * trigger and the foreign keys ask for (removeFixtures says why). Both ids are uuid[] parameters.
 */
async function removeCasesIn(tx: DbTx, caseIds: SQL, intakeIds: SQL): Promise<void> {
  // 3e: the marks and the replies go first; a mark names an item, a reply its measure and its answering decision.
  await tx.execute(sql`delete from unfounded_marks where intake_id = any(${intakeIds}) or item_id in (select i.id from intake_items i where i.case_id = any(${caseIds}))
                         or decision_id in (select d.id from decisions d where d.case_id = any(${caseIds})) or withdrawn_by in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from suspension_replies where action_id in (select a.id from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = any(${caseIds}))
                         or answered_by in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from intake_items where case_id = any(${caseIds}) or intake_id = any(${intakeIds})`);
  await tx.execute(sql`update media_holds set released_at = now() where case_id = any(${caseIds}) and released_at is null`);
  await tx.execute(sql`delete from media_holds where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from seal_posts where action_id in (select a.id from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decision_actions where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from staff_texts where case_id = any(${caseIds})`);
  // An answered appeal and its review name each other: the answer is taken off the appeal, the reviews go, then the
  // appeals, then the decisions they appealed.
  await tx.execute(sql`update appeals set answered_by = null, result = null, answered_at = null where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decisions where case_id = any(${caseIds}) and kind = 'review'`);
  await tx.execute(sql`delete from appeals where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decisions where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from evidence_snapshots where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from case_access_log where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from cases where id = any(${caseIds})`);
  await tx.execute(sql`delete from intakes where id = any(${intakeIds})`);
}

/**
 * Removes, as the migrator, what decisions about these posts left: the posts' cases with everything that hangs on them,
 * the findings of these staff accounts, and those accounts' profiles. The posts themselves stay, as their suites leave
 * them, and their levels are derived again, so none keeps a level that no decision gives it any more.
 */
export async function removeDecided(migrateDb: Db, postIds: readonly string[], staffIds: readonly string[]): Promise<void> {
  if (postIds.length === 0 && staffIds.length === 0) return;
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const cases = await tx.execute<{ id: string }>(sql`select id from cases where target_type = 'post' and target_id = any(${uuids(postIds)})`);
    const caseIds = uuids(cases.map((row) => row.id));
    const intakes = await tx.execute<{ id: string }>(sql`
      select distinct i.intake_id as id from intake_items i where i.case_id = any(${caseIds})
      union select n.id from intakes n where n.finding_by = any(${uuids(staffIds)})`);
    await removeCasesIn(tx, caseIds, uuids(intakes.map((row) => row.id)));
    await tx.execute(sql`select public.moderation_apply(${uuids(postIds)}, true)`);
    // And their authors' standing, which a decision removed with its case may have held.
    await tx.execute(sql`select public.standing_apply(p.author_id) from posts p where p.id = any(${uuids(postIds)})`);
    await tx.execute(sql`delete from profiles where id = any(${uuids(staffIds)})`);
  });
}

/**
 * Removes, as the migrator, everything a test committed about these profiles. Only a test whose second session must see
 * its rows commits them, and it calls this in a `finally`. The order is the one the keep trigger and the foreign keys
 * ask for: the items first (an unanswered suspect item freezes every image its case reaches, and the database then keeps
 * those rows against every delete); the holds released and then deleted (a release takes the image's hold_until back; a
 * delete of the hold's row would not); the seals' lists, the ledger and the texts before the decisions that own them, and
 * the decisions before the snapshots they name; access rows; the cases; the intakes of the items and of these reporters
 * and finders; then the image rows, the posts and the profiles. The audit rows of committed decisions stay: they are the
 * record, and audit-verify still accepts them.
 */
export async function removeFixtures(migrateDb: Db, profileIds: readonly string[]): Promise<void> {
  if (profileIds.length === 0) return;
  const profiles = uuids(profileIds);
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const cases = await tx.execute<{ id: string }>(sql`
      select c.id from cases c
       where (c.target_type = 'account' and c.target_id = any(${profiles}))
          or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = any(${profiles})))`);
    const caseIds = uuids(cases.map((row) => row.id));
    const intakes = await tx.execute<{ id: string }>(sql`
      select distinct i.intake_id as id from intake_items i where i.case_id = any(${caseIds})
      union select n.id from intakes n where n.reporter_id = any(${profiles}) or n.finding_by = any(${profiles})`);
    const intakeIds = uuids(intakes.map((row) => row.id));
    // 3e: what these accounts hold in the tables of account sanctions, before their cases and their profiles.
    await tx.execute(sql`delete from unfounded_marks where account_id = any(${profiles})`);
    await tx.execute(sql`delete from report_tallies where account_id = any(${profiles})`);
    await tx.execute(sql`delete from suspension_replies where account_id = any(${profiles})`);
    await removeCasesIn(tx, caseIds, intakeIds);
    await tx.execute(sql`delete from post_media where owner_id = any(${profiles})`);
    await tx.execute(sql`delete from posts where author_id = any(${profiles})`);
    await tx.execute(sql`delete from profiles where id = any(${profiles})`);
  });
}

/** How many rows each table that these suites write holds. A suite reads it before its first test and after its last. */
export async function rowCounts(db: Runner): Promise<Record<string, number>> {
  const tables = ["cases", "intakes", "intake_items", "media_holds", "evidence_snapshots", "staff_texts", "case_access_log", "decisions", "decision_actions", "seal_posts", "appeals", "suspension_replies", "unfounded_marks", "report_tallies", "post_media", "posts", "profiles"];
  const columns = tables.map((table) => `(select count(*)::int from public.${table}) as ${table}`).join(", ");
  const [row] = await db.execute<Record<string, number>>(sql.raw(`select ${columns}`));
  return { ...row! };
}

/** The same for the moderation tables alone: what a suite that keeps its own posts and profiles is held to. */
export async function moderationCounts(db: Runner): Promise<Record<string, number>> {
  const kept = new Set(["post_media", "posts", "profiles"]);
  return Object.fromEntries(Object.entries(await rowCounts(db)).filter(([table]) => !kept.has(table)));
}

/**
 * How many rows the four auth tables of moderation cases hold (migration 0015: a notifier's contacts, confirmations and
 * stops, and the links of staff accounts to personal ones), read as the migrator: no other role may read all four.
 */
export async function authCaseCounts(migrateDb: Db): Promise<Record<string, number>> {
  const [row] = await migrateDb.execute<Record<string, number>>(
    sql`select (select count(*)::int from auth.notifier_contacts) as notifier_contacts, (select count(*)::int from auth.notifier_confirmations) as notifier_confirmations,
               (select count(*)::int from auth.notifier_suppressions) as notifier_suppressions, (select count(*)::int from auth.staff_personal_accounts) as staff_personal_accounts`,
  );
  return { ...row! };
}

/** A marker for one statement of one test: a word that no other statement holds. */
export const newMarker = () => `race_${randomBytes(6).toString("hex")}`;

/**
 * Resolves once a session is waiting for a lock while it runs a statement that carries the marker. A two-session test
 * waits for this instead of sleeping, so a loaded machine cannot make it read "did not wait" too early. The pool must be
 * of the waiting session's role: a role sees only its own sessions' statements.
 */
export async function untilBlocked(db: Db, marker: string, timeoutMs = 20_000): Promise<void> {
  const pattern = `%${marker}%`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like ${pattern}`,
    );
    if (row!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no session came to wait for a lock with the statement marked ${marker}`);
}

/** A promise with its resolver, for a transaction that stays open until the test lets it end. */
export function gate(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/**
 * Retires the handle a profile holds as decision_actions_apply does it (3e design, section 6.2), as the migrator and
 * without a decision: its row of handle_history is written when missing and marked retired, and the profile gets a
 * placeholder of the right form and no change time. For the tests of the flows that refuse a retired handle; a real
 * retirement, with its decision, is standing-handles.test.ts's. Answers the handle and the placeholder. It commits.
 */
export async function retireHandleForTest(migrateDb: Db, profileId: string): Promise<{ handle: string; placeholder: string }> {
  const placeholder = `retired_${randomBytes(6).toString("hex")}`;
  return migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const [row] = await tx.execute<{ handle: string }>(sql`select lower(handle) as handle from profiles where id = ${profileId}::uuid for update`);
    const handle = row!.handle;
    await tx.execute(sql`insert into handle_history (handle_lower, profile_id) values (${handle}, ${profileId}::uuid) on conflict do nothing`);
    await tx.execute(sql`update handle_history set retired_at = now() where handle_lower = ${handle} and profile_id = ${profileId}::uuid`);
    await tx.execute(sql`update profiles set handle = ${placeholder}, handle_changed_at = null where id = ${profileId}::uuid`);
    return { handle, placeholder };
  });
}

/**
 * Moves an account's standing back in time by the interval (3e design, section 12), as the migrator, and derives its
 * standing again: the only way a test meets a start, an end, an expiry, the frame of 90 days or finality after six
 * months, since the predicate reads the clock, every time is forced by a trigger, and no configuration shortens a number of
 * standing_rules(). It moves the decisions of every case about the account or its posts (their times, their notice
 * mail's time) with their ledger rows (created_at, starts_at, ends_at), the appeals of those decisions, the account's
 * replies, the marks of the reports it sent, and its posts, so that a post made before or after a decision stays so (the
 * strike rule and the second threat compare the two). The interval is PostgreSQL's, such as "91 days". It commits.
 */
export async function ageStandingForTest(migrateDb: Db, accountId: string, interval: string): Promise<void> {
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const by = sql`${interval}::interval`;
    const account = sql`${accountId}::uuid`;
    const decisions = sql`(select d.id from decisions d join cases c on c.id = d.case_id
                            where (c.target_type = 'account' and c.target_id = ${account})
                               or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = ${account})))`;
    await tx.execute(sql`update decisions set decided_at = decided_at - ${by}, informed_at = informed_at - ${by}, author_mail_at = author_mail_at - ${by} where id in ${decisions}`);
    await tx.execute(sql`update decision_actions set created_at = created_at - ${by}, starts_at = starts_at - ${by}, ends_at = ends_at - ${by} where decision_id in ${decisions}`);
    await tx.execute(sql`update appeals set filed_at = filed_at - ${by}, answered_at = answered_at - ${by} where decision_id in ${decisions}`);
    await tx.execute(sql`update suspension_replies set filed_at = filed_at - ${by}, answered_at = answered_at - ${by}, erased_at = erased_at - ${by} where account_id = ${account}`);
    await tx.execute(sql`update unfounded_marks set reported_at = reported_at - ${by}, marked_at = marked_at - ${by}, withdrawn_at = withdrawn_at - ${by} where account_id = ${account}`);
    await tx.execute(sql`update posts set created_at = created_at - ${by}, deleted_at = deleted_at - ${by} where author_id = ${account}`);
    await tx.execute(sql`select public.standing_apply(${account})`);
  });
}
