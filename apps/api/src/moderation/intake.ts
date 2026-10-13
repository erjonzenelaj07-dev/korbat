import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CSAM_KEYWORDS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  NOTICE_LIMITS,
  appealDeadline,
  laneFor,
  snapshotDigest,
  textDigest,
  type ItemOutcome,
  type Lane,
  type NoticeContactRequest,
  type NoticeItemStatus,
  type NoticeReexamineRequest,
  type NoticeRequest,
  type NoticeResponse,
  type NoticeStatus,
  type NoticeStatusRequest,
  type ReexamineRequest,
  type ReexamineResponse,
  type RuleId,
  type TdbCategory,
} from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { getRule } from "@korbat/rules";
import type { AccountMailResult, NotifierMailResult, Session } from "../auth";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import { MailUnavailable } from "../mail/mailer";
import type { HoldPair } from "../media";
import type { CapturedPost, CapturedProfile } from "../social";
import { alertUrgentLane } from "./alerts";
import { ModerationError, type ModerationDeps } from "./context";
import { accountLink, parseLink, postLink } from "./links";
import {
  addedItemOpen,
  alreadyReported,
  beginMailRecord,
  insertIntake,
  insertItem,
  insertSnapshot,
  isSerializationFailure,
  latestSnapshot,
  lockPendingReceipt,
  newestItemAt,
  noticeById,
  noticeByRef,
  noticeItems,
  openCase,
  raisedMessage,
  recordReceipt,
  reporterItem,
  snapshotTime,
  targetKey,
  violatedUniqueConstraint,
  type ItemRow,
  type NoticeItemRow,
  type NoticeRow,
  type ReceiptState,
  type ReexaminedItemRow,
  type SaltedText,
} from "./repo";

/**
 * Taking in a report, a notice or a moderator's own finding (3c design, section 7.1): one intake, one item for each
 * target it names, each item in exactly one open case, and the first copy of each target as evidence. First the
 * transaction every intake runs (step 4); below it what a report or a notice passes before it and what follows its
 * commit (steps 1 to 3, 5 and 6), and the notifier's status page and contact (section 7.2).
 */

/** What an intake alleges and who sent it: the ground's columns of the intake's row. */
export interface IntakeGround {
  kind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  /** The signed-in reporter; never set on the path for child sexual abuse material, which records no sender. */
  reporterId: string | null;
  /** The staff account behind a finding. */
  findingBy: string | null;
  /** The id under which the auth module keeps a signed-out notifier's name and address. */
  contactId: string | null;
  ruleId: RuleId | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: TdbCategory;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  bonaFide: boolean;
}

/** For a target of a re-examination: the item that is examined again, and what its sender added to the request. */
export type Reexamines = NonNullable<ItemRow["reexamines"]>;

/**
 * A target that is live: a post by its id, or an account by its id with the handle it was named by. `position` is its
 * place among the targets named, from 1. With `reexamines` its item is a re-examination, which takes its position from
 * the item it examines again.
 */
export type LiveTarget =
  | { type: "post"; id: string; position: number; mediaId?: string | null; reexamines?: Reexamines }
  | { type: "account"; id: string; position: number; namedHandle: string; reexamines?: Reexamines };

/** A target with nothing live: a link to a post that names no row or a deleted one, or a handle that names no account. It is stored as answered at once. */
export type DeadTarget = { type: "post"; id: string; position: number; reexamines?: Reexamines } | { type: "account"; position: number; namedHandle: string; reexamines?: Reexamines };

export interface IntakeRequest {
  ground: IntakeGround;
  live: readonly LiveTarget[];
  dead?: readonly DeadTarget[];
}

export interface RecordedItem {
  id: string;
  position: number;
  targetType: "post" | "account";
  targetId: string;
  /** Null for a target with nothing live. */
  caseId: string | null;
  seq: number | null;
  lane: Lane;
}

export interface IntakeRecorded {
  intakeId: string;
  /** The public reference: N- and ten base32 characters. */
  ref: string;
  /** The notice's token, for a signed-out notice and for every notice on the CSAM path: shown once, and stored only as its sha256. */
  token: string | null;
  /** Whether the intake's items are suspect: it is on the CSAM path, or a finding citing R2. */
  suspect: boolean;
  items: RecordedItem[];
}

/** How often the transaction is run again after a case closed under it, a deadlock or a lock timeout: in each nothing was written. */
const RETRIES = 3;
/** How often one transaction asks for a target's open case before it starts over. */
const CASE_READS = 3;
/**
 * The longest the intake waits for a lock. A case's row is held by a decision for as long as that decision's
 * transaction runs, which for a seal over thousands of images is seconds; an intake that waited longer starts over.
 */
const LOCK_TIMEOUT_MS = 10_000;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A fresh public reference: N- and ten base32 characters from 50 random bits. */
function newRef(): string {
  const bytes = randomBytes(7);
  // 48 bits and two more: 50 in all, which a JavaScript number holds exactly.
  const bits = bytes.readUIntBE(0, 6) * 4 + (bytes[6]! & 3);
  let ref = "";
  // 50 bits, five at a time from the top.
  for (let shift = 45; shift >= 0; shift -= 5) ref += BASE32[Math.floor(bits / 2 ** shift) % 32];
  return `N-${ref}`;
}

/** Whether an intake's items are suspect, as the attach trigger forces it: the CSAM path, or a finding citing R2. */
export const isSuspect = (ground: IntakeGround) => ground.csam || ground.ruleId === "R2";

/**
 * The live targets of a suspect intake with the items korbat adds: a post's card shows the images of the post it
 * quotes, so a report of child sexual abuse material about a post that quotes another is a report about both. Each
 * quoted post that the request does not name itself becomes a target of its own, at the position of the item it was
 * added for plus 10 (the lowest such position when several named posts quote it). One level only, as a card draws one
 * quote deep: an added target brings none of its own. Read outside any transaction; a post's quote never changes.
 */
export async function withAddedTargets(deps: Pick<ModerationDeps, "social">, live: readonly LiveTarget[]): Promise<LiveTarget[]> {
  const named = new Set(live.filter((target) => target.type === "post").map((target) => target.id));
  const added = new Map<string, number>();
  for (const target of live) {
    if (target.type !== "post" || target.position > 10) continue;
    const quoted = (await deps.social.postRef(target.id))?.quoteOfId;
    if (!quoted || named.has(quoted)) continue;
    added.set(quoted, Math.min(added.get(quoted) ?? target.position, target.position));
  }
  return [...live, ...[...added].map(([id, position]): LiveTarget => ({ type: "post", id, position: position + 10 }))];
}

/** Thrown inside the transaction to roll it back and run it again: the case a target was read into closed before the read found one. */
class StartOver extends Error {}

/** A case's targets in one order for every intake: by kind (posts before accounts, as the database orders the two) and then by id. */
const byTarget = (a: LiveTarget, b: LiveTarget) => (a.type !== b.type ? (a.type === "post" ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stores one intake in one transaction, which changes nothing unless it commits. In this order:
 *   1. a signed-in reporter's profile row, FOR KEY SHARE, refusing a missing or deleted account;
 *   2. the intake's row, with a fresh reference and, for a signed-out or CSAM notice, the hash of a fresh token;
 *   3. for each live target, in the targets' order: its open case (opened when there is none) and then its item, which
 *      the attach trigger numbers into the case, so every intake takes its cases in one order and two notices that name
 *      the same targets never deadlock; only then the captures, posts in id order, each under a share lock on its post,
 *      so none holds a post while it waits for a case;
 *   4. one hold through the media module for the whole intake: the image rows of every post target, and for a suspect
 *      item about an account every image row on the account's posts, locked by one statement in one id order, with each
 *      post's case's evidence hold on its images; then a snapshot for each case that holds none yet, or, for an account,
 *      whose newest one differs from the account now, a post's listing the images the hold answered;
 *   5. for each target with nothing live, an item with no case, answered at once.
 * It is run again, up to three times, when an item's case closed in between (the attach trigger says so), on a deadlock
 * and on a lock timeout; when the last run fails the same way the answer is case_closed. A signed-in reporter who already
 * has an item on the same ground in a target's open case is answered already_reported.
 */
export async function recordIntake(deps: ModerationDeps, request: IntakeRequest): Promise<IntakeRecorded> {
  const suspect = isSuspect(request.ground);
  const live = suspect ? await withAddedTargets(deps, request.live) : [...request.live];
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.apiDb.transaction((tx) => recordIn(deps, tx, { ...request, live }, suspect));
    } catch (err) {
      const constraint = violatedUniqueConstraint(err);
      if (constraint === "intake_items_reporter_once") throw new ModerationError("already_reported");
      // A reference another intake already has: one in 2^50 for each pair. The next run draws a new one.
      const startOver = err instanceof StartOver || isSerializationFailure(err) || isDeadlock(err) || isLockNotAvailable(err) || constraint === "intakes_ref_unique";
      if (!startOver) throw err;
      if (attempt >= RETRIES) throw new ModerationError("case_closed");
    }
  }
}

async function recordIn(deps: ModerationDeps, tx: DbTx, request: IntakeRequest, suspect: boolean): Promise<IntakeRecorded> {
  const { ground } = request;
  await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}::text, true)`);

  // 1. 3e (design, section 7.9 step 7): the reporter's standing is read from the row this statement locks. A report
  // under a korbat rule is refused while the reporter's suspension runs (account_suspended), and else while a
  // restriction of the reporter's reports runs (reporting_restricted, Task 5); a notice of illegality and the path for
  // child sexual abuse material read neither (DSA Art. 16(6)), and a re-examination is no intake. The request was counted
  // against the sender's limit already, as an already_reported one is.
  if (ground.reporterId !== null) {
    const [reporter] = await deps.social.lockAccounts(tx, [ground.reporterId], "key share", true);
    const underRule = ground.kind === "user" && !ground.allegesIllegal && !ground.csam;
    if (underRule && reporter!.suspended) throw new ModerationError("account_suspended");
    if (underRule && reporter!.reportsRestricted) throw new ModerationError("reporting_restricted");
  }

  // 2. The token is stored only as its hash; the answer carries it once.
  const ref = newRef();
  const token = ground.channel === "signed_out" || ground.csam ? randomBytes(32).toString("base64url") : null;
  const intakeId = await insertIntake(tx, { ...ground, ref, lookupHash: token === null ? null : createHash("sha256").update(token).digest("hex") });
  const lane = laneFor({ ruleId: ground.ruleId, allegesIllegal: ground.allegesIllegal, csam: ground.csam, category: ground.category });

  // 3. to 5.
  const items = await attachTargets(deps, tx, { intakeId, lane, suspect, live: request.live, dead: request.dead ?? [] });
  return { intakeId, ref, token, suspect, items };
}

/** What a transaction attaches to an intake: its targets, the lane a new item goes to, and whether its items are suspect. */
interface AttachRequest {
  intakeId: string;
  lane: Lane;
  suspect: boolean;
  live: readonly LiveTarget[];
  dead: readonly DeadTarget[];
}

/**
 * Steps 3 to 5 of an intake's transaction, which a re-examination runs too, for an intake that exists: each live
 * target's open case with its item, the captures, the one hold, the snapshots, and an item without a case for each
 * target with nothing live. An item that is a re-examination takes its position and its lane from the item it examines
 * again, whatever this request says, so each recorded item carries what the database answered.
 */
async function attachTargets(deps: ModerationDeps, tx: DbTx, request: AttachRequest): Promise<RecordedItem[]> {
  const { intakeId, lane, suspect } = request;

  // 3. First every case with its item, in the targets' order.
  const items: RecordedItem[] = [];
  const cases = new Map<LiveTarget, string>();
  for (const target of [...request.live].sort(byTarget)) {
    let caseId: string | null = null;
    for (let read = 0; read < CASE_READS && caseId === null; read++) caseId = await openCase(tx, target.type, target.id);
    // A live target's item is never stored without a case.
    if (caseId === null) throw new StartOver();
    cases.set(target, caseId);
    const item = await insertItem(tx, {
      intakeId,
      caseId,
      targetType: target.type,
      targetId: target.id,
      position: target.position,
      lane,
      mediaId: target.type === "post" ? (target.mediaId ?? null) : null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
      reexamines: target.reexamines,
    });
    items.push({ id: item.id, position: item.position, targetType: target.type, targetId: target.id, caseId, seq: item.seq, lane: item.lane });
  }

  // Then the captures: every post in id order under a share lock, and every account's fields. The time is the
  // transaction's start, which the snapshots' trigger stamps.
  const takenAt = await snapshotTime(tx);
  const posts = new Map<string, CapturedPost>();
  const profiles = new Map<string, CapturedProfile>();
  for (const target of cases.keys()) {
    if (target.type === "post") {
      const post = await deps.social.capturePost(tx, target.id);
      if (!post) throw new Error("a post that an intake names has no row");
      posts.set(target.id, post);
    } else {
      const profile = await deps.social.captureProfile(tx, target.id);
      if (!profile) throw new Error("an account that an intake names has no row");
      profiles.set(target.id, profile);
    }
  }

  // 4. One hold for the whole intake, after every capture, so that no image row is locked before the last post is. Each
  // post's case holds the post's images as evidence, on every ground alike. A suspect item about an account reaches every
  // image on the account's posts: the freeze keeps those from the item's commit on, without a hold, and the pair only locks
  // them, so that a delete racing this intake waits and then reads the committed item.
  const pairs: HoldPair[] = [];
  for (const [target, caseId] of cases) if (target.type === "post") pairs.push({ caseId, postId: target.id });
  for (const target of cases.keys()) if (target.type === "account" && suspect) pairs.push({ ownerId: target.id });
  const held = await deps.media.hold(tx, pairs);

  // Then the snapshots, each post's with the images the hold answered for it.
  for (const [target, caseId] of cases) {
    const before = await latestSnapshot(tx, caseId);
    if (target.type === "post") {
      const post = posts.get(target.id)!;
      if (before !== null) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "post",
        targetId: target.id,
        authorHandle: post.authorHandle,
        postState: post.state,
        postCreatedAt: post.createdAt.toISOString(),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        body: post.body,
        // The images as the media module read them under their row locks, in position order; an erased image's alt text
        // is not copied. An empty list means that the post had none, or that they were gone before this intake.
        media: held.get(target.id) ?? [],
        displayName: null,
        bio: null,
        handle: null,
      });
    } else {
      const profile = profiles.get(target.id)!;
      if (before !== null && before.displayName === profile.displayName && before.bio === profile.bio && before.handle === profile.handle) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "account",
        targetId: target.id,
        authorHandle: profile.handle,
        postState: null,
        postCreatedAt: null,
        replyToId: null,
        quoteOfId: null,
        body: null,
        media: null,
        displayName: profile.displayName,
        bio: profile.bio,
        handle: profile.handle,
      });
    }
  }

  // 5. An account's link that names nothing gets an id that names nothing either, whether or not a profile holds or once
  // held the handle: no stored id ties an old handle to its account. (A re-examination's item takes its target from the
  // item it examines again, whatever is written here.)
  for (const target of request.dead) {
    const targetId = target.type === "post" ? target.id : randomUUID();
    const item = await insertItem(tx, {
      intakeId,
      caseId: null,
      targetType: target.type,
      targetId,
      position: target.position,
      lane,
      mediaId: null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
      reexamines: target.reexamines,
    });
    items.push({ id: item.id, position: item.position, targetType: target.type, targetId, caseId: null, seq: null, lane: item.lane });
  }
  items.sort((a, b) => a.position - b.position);
  return items;
}

export type SnapshotContent = Omit<Parameters<typeof insertSnapshot>[1], "salt" | "digest">;

/**
 * One snapshot: a salt of the server's own, and the digest over the salt, the time and everything copied. The time in
 * the digest is the one the database stamps the row with; when the two differ the transaction is rolled back, since the
 * stored row would not recompute to its digest. Answers the snapshot's id and digest. The console's snapshot route
 * stores its snapshots through this too, so every snapshot is made one way.
 */
export async function storeSnapshot(tx: DbTx, takenAt: string, content: SnapshotContent): Promise<{ id: string; digest: string }> {
  const salt = randomBytes(32).toString("hex");
  const digest = await snapshotDigest({
    salt,
    targetType: content.targetType,
    targetId: content.targetId,
    takenAt,
    authorHandle: content.authorHandle,
    postState: content.postState,
    postCreatedAt: content.postCreatedAt,
    replyToId: content.replyToId,
    quoteOfId: content.quoteOfId,
    body: content.body,
    media: content.media,
    displayName: content.displayName,
    bio: content.bio,
    handle: content.handle,
  });
  const stored = await insertSnapshot(tx, { ...content, salt, digest });
  if (stored.takenAt !== takenAt) throw new Error("a snapshot was stamped at another time than its digest covers");
  return { id: stored.id, digest };
}

// ---------------------------------------------------------------- reports and notices: POST /api/notices

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** How often one network may read a notice's status or use its contact buttons in an hour; the two routes share the count. */
export const STATUS_READS_PER_HOUR = 30;

/** Who sends a report or a notice: the session of a signed-in sender, or none, and the keyed hash of the network the request came from. */
export interface NoticeSender {
  session: Pick<Session, "userId" | "role" | "onboarded"> | null;
  netHash: string;
}

/** A target as a report names it, once a link is parsed: a post by its id, or an account by a handle. */
export type NamedTarget = { type: "post"; id: string; mediaId: string | null } | { type: "account"; handle: string };

/**
 * Counts one event in a window of the shared limit store and refuses it once the window is used up. An event that
 * cannot be counted is refused too: the limits are what keeps one sender from flooding the queue.
 */
export async function countOrRefuse(deps: Pick<ModerationDeps, "limits">, key: string, windowMs: number, max: number): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(key, windowMs);
  } catch {
    throw new ModerationError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > max) throw new ModerationError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Which targets are live is one rule for every route (3c design, section 7.1, step 3), and it reads no image.
 *
 * For a suspect intake (a report of child sexual abuse material, or a finding citing R2) a target is live while its row
 * exists: a post in any state, one its author deleted or the purge blanked included, and an account whose profile row
 * exists, purged or not, also under a handle it has left, which the handle history keeps reserved for it. So no such
 * report about anything that exists is answered automatically: it waits for an admin, whatever is left of its target.
 *
 * For every other ground a post is live when it exists and its author has not deleted it, whatever its level, and an
 * account when a profile holds the named handle now and is not deleted: an old handle names nothing, and repeated
 * reports cannot keep content its author deleted, nor put deleted images before staff.
 *
 * Answers the target with its id, or null when it names nothing live.
 */
export async function liveTarget(deps: Pick<ModerationDeps, "social">, target: NamedTarget, suspect: boolean): Promise<{ type: "post" | "account"; id: string } | null> {
  if (target.type === "post") {
    const post = await deps.social.postRef(target.id);
    if (!post) return null;
    return suspect || post.state !== "deleted_by_author" ? { type: "post", id: target.id } : null;
  }
  const account = await deps.social.findAccountByHandle(target.handle, suspect);
  return account ? { type: "account", id: account.id } : null;
}

/** A notice's targets, resolved: the live ones and those with nothing live, numbered from 1 in the order the notice named them. */
export interface ResolvedTargets {
  live: LiveTarget[];
  dead: DeadTarget[];
}

/**
 * Resolves a notice's targets, outside any transaction (3c design, section 7.1, step 3):
 *   - a link is parsed into the post or the account it names, or refused;
 *   - a notice on the path for child sexual abuse material that names more than CSAM_NOTICE_MAX_ACCOUNTS accounts is
 *     refused, the accounts counted by the handles as named, before any is looked up, so the refusal says nothing about
 *     which handles are live or name the same account;
 *   - the targets are de-duplicated as named, a post by its id and an account by its handle: an account's link with
 *     nothing live has no id to compare, and a stored id must never tie an old handle to its account;
 *   - each is looked up by the one liveness rule;
 *   - a signed-in sender's target that they have reported already on this ground is dropped (`skip`).
 * What is left is numbered from 1 in the order named. The answer to the sender never says which targets were live.
 */
export async function resolveTargets(
  deps: Pick<ModerationDeps, "social" | "config">,
  request: Pick<NoticeRequest, "ground" | "targets">,
  skip: (live: readonly { type: "post" | "account"; id: string }[]) => Promise<Set<string>> = async () => new Set(),
): Promise<ResolvedTargets> {
  const suspect = request.ground === "csam";
  const named: NamedTarget[] = [];
  for (const target of request.targets) {
    const parsed = target.kind === "link" ? parseLink(deps.config.APP_ORIGIN, target.url) : target.kind === "post" ? { type: "post" as const, id: target.id } : { type: "account" as const, handle: target.handle };
    if (parsed.type === "account") {
      if (!named.some((seen) => seen.type === "account" && seen.handle === parsed.handle)) named.push(parsed);
      continue;
    }
    const mediaId = target.kind === "post" ? (target.mediaId ?? null) : null;
    const seen = named.find((earlier) => earlier.type === "post" && earlier.id === parsed.id);
    // Named twice, the post is one target; the image one of the two pointed at is kept.
    if (seen && seen.type === "post") seen.mediaId ??= mediaId;
    else named.push({ type: "post", id: parsed.id, mediaId });
  }
  if (suspect && named.filter((target) => target.type === "account").length > CSAM_NOTICE_MAX_ACCOUNTS) throw new ModerationError("invalid_request");

  const found = await Promise.all(named.map((target) => liveTarget(deps, target, suspect)));
  const liveOnes = found.flatMap((target) => (target === null ? [] : [target]));
  const skipped = liveOnes.length === 0 ? new Set<string>() : await skip(liveOnes);
  const resolved: ResolvedTargets = { live: [], dead: [] };
  const stored = new Set<string>();
  let position = 0;
  named.forEach((target, index) => {
    const live = found[index] ?? null;
    if (live !== null) {
      // Dropped: already reported by this sender, or (on the path that looks up old handles) the same account as an earlier target.
      if (skipped.has(targetKey(live)) || stored.has(targetKey(live))) return;
      stored.add(targetKey(live));
      position++;
      if (target.type === "post") resolved.live.push({ type: "post", id: live.id, position, mediaId: target.mediaId });
      else resolved.live.push({ type: "account", id: live.id, position, namedHandle: target.handle });
      return;
    }
    position++;
    if (target.type === "post") resolved.dead.push({ type: "post", id: target.id, position });
    else resolved.dead.push({ type: "account", position, namedHandle: target.handle });
  });
  // Every target was live and reported already: there is nothing to store.
  if (position === 0) throw new ModerationError("already_reported");
  return resolved;
}

/** The ground's columns of a report or a notice, from the request and its sender. */
function groundOf(request: NoticeRequest, reporterId: string | null, signedIn: boolean): IntakeGround {
  const channel = signedIn ? "signed_in" : "signed_out";
  const base = { kind: "user" as const, channel, findingBy: null, contactId: null } satisfies Partial<IntakeGround>;
  switch (request.ground) {
    case "rule":
      // A rule-only report alleges no illegality: its category is the Transparency Database's for a breach of the terms.
      return { ...base, reporterId, ruleId: request.ruleId, allegesIllegal: false, csam: false, category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", categoryKeyword: null, citedLaw: null, explanation: request.explanation ?? null, bonaFide: false };
    case "illegal":
      return {
        ...base,
        reporterId,
        // A signed-out notifier's name and address go to the auth module under this id; the notice holds the id alone.
        contactId: !signedIn && (request.name !== undefined || request.email !== undefined) ? randomUUID() : null,
        ruleId: request.ruleId ?? null,
        allegesIllegal: true,
        csam: false,
        category: request.category,
        categoryKeyword: null,
        citedLaw: request.citedLaw ?? null,
        explanation: request.explanation,
        bonaFide: true,
      };
    case "csam":
      // An Art. 16 notice of illegal content that records no sender, whoever sent it: no account, no contact.
      return {
        ...base,
        reporterId: null,
        ruleId: null,
        allegesIllegal: true,
        csam: true,
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        categoryKeyword: CSAM_KEYWORDS[request.keyword],
        citedLaw: null,
        explanation: request.explanation ?? null,
        bonaFide: request.bonaFide ?? false,
      };
  }
}

/**
 * One report or notice (3c design, section 7.1). In this order:
 *   1. who may send it: a staff account reports only as its own finding, in the console; a session that has not finished
 *      onboarding has no profile to report from and is refused, never treated as signed out; a signed-in sender leaves no
 *      name or address, since their contact is their account;
 *   2. the human check of a signed-out sender, then the limits: per network signed out, per account signed in;
 *   3. the targets, resolved outside any transaction;
 *   4. the intake's transaction; a request it could not save through no fault of its sender gives its limit hits back;
 *   5. after its commit, a signed-out notifier's contact is stored by the auth module (a failure is logged: the notice
 *      stands without it, and no contact can exist without its notice), and the mails are started without being waited
 *      for: the urgent lane's alert first, then the receipt;
 *   6. the answer: the reference, and the token of a notice sent signed out or on the path for child sexual abuse
 *      material, which is shown once and is the only way to follow such a notice. A stalled relay never costs it.
 */
export async function submitNotice(deps: ModerationDeps, request: NoticeRequest, sender: NoticeSender): Promise<NoticeResponse> {
  // 1.
  const { session } = sender;
  if (session !== null) {
    if (session.role !== "user") throw new ModerationError("staff_cannot_report");
    if (!session.onboarded) throw new ModerationError("onboarding_required");
    if (request.ground === "illegal" && (request.name !== undefined || request.email !== undefined)) throw new ModerationError("invalid_request");
  }

  // 2. A signed-in sender's token is ignored. From here on the request is counted, whatever a later step says of its
  // links or its targets: a sender cannot probe what exists without spending the hour.
  const counted: string[] = [];
  const count = async (key: string, windowMs: number, max: number) => {
    await countOrRefuse(deps, key, windowMs, max);
    counted.push(key);
  };
  if (session === null) {
    if (request.turnstileToken === undefined || !(await deps.auth.verifyHuman(request.turnstileToken))) throw new ModerationError("human_check_failed");
    await count(`notice:hour:net:${sender.netHash}`, HOUR_MS, NOTICE_LIMITS.signedOut.perHour);
    await count(`notice:day:net:${sender.netHash}`, DAY_MS, NOTICE_LIMITS.signedOut.perDay);
  } else {
    await count(`notice:hour:account:${session.userId}`, HOUR_MS, NOTICE_LIMITS.signedIn.perHour);
    await count(`notice:day:account:${session.userId}`, DAY_MS, NOTICE_LIMITS.signedIn.perDay);
  }

  // 3. On the path for child sexual abuse material nothing is matched against the session's account or its reports: every
  // live target gets an item, so someone who sent a notice of illegality about a post can still report it this way.
  const ground = groundOf(request, session?.userId ?? null, session !== null);
  const reporterId = ground.reporterId;
  const targets = await resolveTargets(deps, request, reporterId === null ? undefined : (live) => alreadyReported(deps.apiDb, reporterId, ground.allegesIllegal, live));

  // 4. A request that fails here through no fault of its sender gives back what it took of their limits, since its answer
  // tells them to send it again: its case kept changing until the last retry (case_closed), or the transaction failed in
  // a way no rule of the module names. A refusal that is the sender's own (already reported, an account that is gone)
  // stays counted.
  let recorded: IntakeRecorded;
  try {
    recorded = await recordIntake(deps, { ground, live: targets.live, dead: targets.dead });
  } catch (err) {
    if (!(err instanceof ModerationError) || err.code === "case_closed") {
      // The key holds the sender's network or account: the warning names neither.
      for (const key of counted) await deps.limits.release(key).catch((failure: unknown) => deps.log.warn({ err: failure }, "notice: a limit hit of a request that could not be saved could not be given back"));
    }
    throw err;
  }

  // 5. The contact is stored before the answer; the mails are not waited for.
  if (ground.contactId !== null && request.ground === "illegal") {
    try {
      await deps.auth.storeNotifierContact(ground.contactId, { name: request.name, email: request.email });
    } catch (err) {
      deps.log.error({ err, intakeId: recorded.intakeId }, "notice: the notifier's contact could not be stored; the notice stands without it");
    }
  }
  const urgent = recorded.items.some((item) => item.caseId !== null && item.lane === 0);
  deps.background.start(async () => {
    if (urgent) {
      try {
        await alertUrgentLane(deps);
      } catch (err) {
        deps.log.error({ err, intakeId: recorded.intakeId }, "notice: the urgent lane's alert failed; the dispatch job repeats it");
      }
    }
    await sendReceipt(deps, recorded.intakeId);
  });

  // 6.
  return recorded.token === null ? { ref: recorded.ref } : { ref: recorded.ref, token: recorded.token };
}

/** What a mail's result is recorded as. A contact nobody has (never stored, or forgotten) has no address; a refused address is given up. */
const RECEIPT_STATES: Record<NotifierMailResult | AccountMailResult, ReceiptState> = { sent: "sent", folded: "folded", suppressed: "suppressed", no_address: "no_address", forgotten: "no_address", refused: "failed" };

/**
 * A notice's receipt, built from the stored notice alone, so a receipt sent later, or carried in a daily update, holds
 * the same reference, time and links as one sent at once: the links of the items the sender named, in their order, an
 * account's under the handle as named.
 */
export async function receiptMessage(deps: Pick<ModerationDeps, "apiDb" | "config">, notice: Pick<NoticeRow, "id" | "ref" | "receivedAt">) {
  // The items the sender named: not those korbat added for a quoted post, and no re-examination, which shares its item's position.
  const items = (await noticeItems(deps.apiDb, notice.id)).filter((item) => item.position <= 10 && !item.reexamines);
  return { template: "notice_received" as const, ref: notice.ref, receivedAt: new Date(notice.receivedAt), items: items.map((item) => itemLink(deps, item)) };
}

/**
 * Sends a notice's receipt and records what became of it: to a signed-out notifier's contact, or to the account behind a
 * notice of illegality sent signed in. A notice without a pending receipt sends nothing. A failure of the relay leaves
 * the receipt pending, for the dispatch job to send; any other result is recorded, only while the receipt is still
 * pending. A fault that is not the relay's (a database error, a contact no configured key opens) is thrown: its caller
 * logs it as what it is, and the receipt stays pending. The notice's row is taken before anything is sent, in the
 * transaction that records the result (beginMailRecord): a database that cannot write refuses that, and nothing is sent.
 */
export async function sendReceipt(deps: Pick<ModerationDeps, "apiDb" | "auth" | "config" | "log">, intakeId: string): Promise<ReceiptState | "pending" | "none"> {
  const notice = await noticeById(deps.apiDb, intakeId);
  if (!notice || notice.receipt !== "pending") return "none";
  const message = await receiptMessage(deps, notice);
  return deps.apiDb.transaction(async (tx): Promise<ReceiptState | "pending" | "none"> => {
    await beginMailRecord(tx);
    if (!(await lockPendingReceipt(tx, intakeId))) return "none";
    let result: NotifierMailResult | AccountMailResult;
    try {
      if (notice.contactId !== null) result = await deps.auth.mailNotifier(notice.contactId, message);
      else if (notice.reporterId !== null) result = await deps.auth.mailAccount(notice.reporterId, message);
      // The reporter's link was forgotten with their account: there is nobody to mail.
      else result = "no_address";
    } catch (err) {
      if (!(err instanceof MailUnavailable)) throw err;
      deps.log.warn({ err, intakeId }, "notice receipt: not sent; it stays pending for the next try");
      return "pending";
    }
    await recordReceipt(tx, intakeId, RECEIPT_STATES[result]);
    return RECEIPT_STATES[result];
  });
}

// ---------------------------------------------------------------- the notifier's status page and contact

/** An item's korbat address: a post's from its id, an account's from the handle as the notice named it, never from the handle the profile holds now. */
export function itemLink(deps: Pick<ModerationDeps, "config">, item: Pick<NoticeItemRow, "targetType" | "targetId" | "namedHandle">): string {
  return item.targetType === "post" ? postLink(deps.config.APP_ORIGIN, item.targetId) : accountLink(deps.config.APP_ORIGIN, item.namedHandle!);
}

/** Whether two hex digests are the same, compared in constant time. */
function sameDigest(a: string, b: string): boolean {
  const [left, right] = [Buffer.from(a, "hex"), Buffer.from(b, "hex")];
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * One item as its sender reads it (3c design, sections 7.2 and 10). Nothing of the outcome is told before the daily
 * release: not the outcome or its day, not whether images were sealed or out of sight, not whether a re-examination can
 * be asked for, so the page and the mail tell the same at the same time. And nothing before it tells whether the target
 * was live: an item whose link named nothing reads exactly as one that waits for a moderator.
 */
export async function itemStatus(deps: Pick<ModerationDeps, "social" | "config">, item: NoticeItemRow): Promise<NoticeItemStatus> {
  // "No action for now": a decision taken while nobody could open the post's images, on an item about a post that is not itself suspect.
  const unseen = item.released && item.decisionUnseen && item.targetType === "post" && !item.suspect;
  // What the answer concerns. Before the release the scope comes from what the notice named and from the item's suspect
  // mark alone, never from what the target turned out to be: the page must not tell a live target from a link that names
  // nothing, nor, on the path for child sexual abuse material, whether a handle names an account.
  let scope: NoticeItemStatus["scope"] = null;
  if (item.targetType === "account") {
    // With or without a case: the answer concerns the images on the account's posts too when the item is suspect or,
    // once released, when its decision sealed them. After "not available" the page and the app add no scope sentence.
    // 3e (7.11 item 7): once released, an item whose decision retired the handle reads that in place of the display name
    // and bio; a suspect item keeps its own scope, which speaks of the images.
    // 3e: once released, an item whose decision suspended or terminated the account at once reads its own scope
    // (ACCOUNT_MEASURE_SCOPE.measure), which says that korbat took a measure and nothing of which or for how long.
    scope = item.suspect || (item.released && item.sealed) ? "account_suspect" : item.released && item.retired ? "account_retired" : item.released && item.measure ? "account_measure" : "account";
  } else if (item.released && item.hasCase && !item.suspect && (await deps.social.postRef(item.targetId))?.quoteOfId) {
    // Whether a post quotes another can be read only from its row, so this scope comes with the released outcome and not
    // before it. A suspect item about a quoting post has an item of its own for the quoted post, and no such scope.
    scope = "quote";
  }
  // Only a moderator's decision to take no action can be examined again, once; an answer given with the images out of
  // sight does not spend that, also when it answered a re-examination.
  const reexaminable = item.released && item.noAction && (!item.reexamines || unseen);
  // What the outcome's words need beside it, as the mail's line reads them: the rule a restriction under a rule names, in
  // the wording of the rulebook the decision was made under, and whether the restriction changed nothing anyone saw.
  const outcome = item.released ? (item.shownOutcome as ItemOutcome) : null;
  let rule: NoticeItemStatus["rule"];
  if (outcome === "restricted_rule") {
    const found = item.ruleId === null || item.rulesVersion === null ? undefined : getRule(item.ruleId, item.rulesVersion);
    if (!found) throw new Error("the item's restriction names no rule of a rulebook korbat holds");
    rule = { id: found.id as RuleId, title: found.title };
  }
  const restricting = outcome === "restricted_rule" || outcome === "restricted_legal";
  return {
    position: item.position,
    link: itemLink(deps, item),
    scope,
    suspect: item.suspect,
    sealed: item.released && item.sealed,
    unseen,
    quotedBy: item.position > 10 ? item.position - 10 : null,
    outcome,
    decidedOn: item.released ? item.decidedOn : null,
    changed: item.changed,
    reexamines: item.reexamines,
    reexamination: reexaminable ? { open: !item.reexamined && item.inWindow, until: item.until! } : null,
    ...(rule ? { rule } : {}),
    ...(restricting && item.noEffect ? { noEffect: true as const } : {}),
  };
}

/**
 * The items the status page lists. An item korbat added for a quoted post (a position above 10) exists only where the
 * named post exists and quotes another, so listing it at once would tell a live target from a link that names nothing.
 * It is listed from the first release that shows an outcome of its pair: its origin's, after which it stands directly
 * behind it, with its own outcome or waiting; or its own, since from the release an outcome shows on the page and its
 * window to ask for a re-examination runs. Its origin's waiting past that same release already told that it names a row:
 * a link to no row was answered by then. A re-examination is filed only on a released item, so it is always listed.
 */
export function listedItems(items: readonly NoticeItemRow[]): NoticeItemRow[] {
  const releasedOrigins = new Set(items.filter((item) => item.position <= 10 && !item.reexamines && item.released).map((item) => item.position));
  return items.filter((item) => item.position <= 10 || item.reexamines || item.released || releasedOrigins.has(item.position - 10));
}

/**
 * The notice a reference and a token open: the token is the notice's own, shown once on screen, or the mail token of its
 * contact, which only the auth module can compare. Anything else is notice_not_found, in the same words whether the
 * reference names no notice or the token is wrong. `byMail` says which token it was.
 */
async function noticeFor(deps: Pick<ModerationDeps, "apiDb" | "auth">, request: { ref: string; token: string }): Promise<{ notice: NoticeRow; byMail: boolean }> {
  const notice = await noticeByRef(deps.apiDb, request.ref);
  if (!notice) throw new ModerationError("notice_not_found");
  const own = notice.lookupHash !== null && sameDigest(notice.lookupHash, createHash("sha256").update(request.token).digest("hex"));
  const byMail = !own && notice.contactId !== null && (await deps.auth.notifierMailTokenMatches(notice.contactId, request.token));
  if (!own && !byMail) throw new ModerationError("notice_not_found");
  return { notice, byMail };
}

/**
 * The notifier's status page (3c design, section 7.2): the notice whose reference matches and whose token this is, either
 * the notice's own, shown once on screen, or the mail token of its contact, which the receipt's link carries. Anything
 * else is notice_not_found. With the notice's own token the contact's `confirmed` and `stopped` are null, so the answer
 * to whoever typed an address never depends on what korbat knows about that address.
 */
export async function noticeStatus(deps: Pick<ModerationDeps, "apiDb" | "auth" | "social" | "limits" | "config">, request: NoticeStatusRequest, netHash: string): Promise<NoticeStatus> {
  await countOrRefuse(deps, `notice-status:${netHash}`, HOUR_MS, STATUS_READS_PER_HOUR);
  const { notice, byMail } = await noticeFor(deps, request);

  const items: NoticeItemStatus[] = [];
  for (const item of listedItems(await noticeItems(deps.apiDb, notice.id))) items.push(await itemStatus(deps, item));
  let contact: NoticeStatus["contact"] = null;
  if (notice.contactId !== null) {
    const facts = (await deps.auth.notifierFacts([notice.contactId])).get(notice.contactId);
    contact = { given: facts?.contactGiven ?? false, confirmed: byMail ? (facts?.confirmed ?? false) : null, stopped: byMail ? (facts?.suppressed ?? false) : null };
  }
  return { ref: notice.ref, receivedAt: notice.receivedAt, items, contact };
}

/**
 * The status page's two buttons (3c design, section 7.2): "I sent this" and "stop korbat's emails about reports to this
 * address". Only the contact's mail token works them: the notice's own token, a notice without a contact and a wrong
 * token are all notice_not_found, so typing someone's address neither confirms it nor stops korbat's mail to it.
 */
export async function noticeContact(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits">, request: NoticeContactRequest, netHash: string): Promise<void> {
  await countOrRefuse(deps, `notice-status:${netHash}`, HOUR_MS, STATUS_READS_PER_HOUR);
  const notice = await noticeByRef(deps.apiDb, request.ref);
  if (!notice || notice.contactId === null) throw new ModerationError("notice_not_found");
  const done = request.choice === "confirm" ? await deps.auth.confirmNotifier(notice.contactId, request.token) : await deps.auth.stopNotifier(notice.contactId, request.token);
  if (!done) throw new ModerationError("notice_not_found");
}

// ---------------------------------------------------------------- re-examination

/**
 * Whether the target of an item is live now, by the one liveness rule of every intake (section 7.1, step 3), asked about
 * the item's own target: a post by its id; an account by the handle the item was named by, and only when that handle
 * still names the item's own account. An account that gave the handle up names nothing on any ground but the path for
 * child sexual abuse material, where the handle history keeps it; and a handle that someone else holds now is never a
 * way to another account's case.
 */
async function itemTargetLive(deps: Pick<ModerationDeps, "social">, item: ReexaminedItemRow): Promise<boolean> {
  if (item.targetType === "post") return (await liveTarget(deps, { type: "post", id: item.targetId, mediaId: null }, item.suspect)) !== null;
  if (item.namedHandle === null) return false;
  const found = await liveTarget(deps, { type: "account", handle: item.namedHandle }, item.suspect);
  return found !== null && found.id === item.targetId;
}

/** One item of a re-examination's request as a target of the transaction: live, or with nothing live. */
async function reexaminationTarget(deps: Pick<ModerationDeps, "social">, item: ReexaminedItemRow, statement: SaltedText | null): Promise<{ live: LiveTarget } | { dead: DeadTarget }> {
  const reexamines: Reexamines = { itemId: item.id, statement };
  const live = await itemTargetLive(deps, item);
  if (item.targetType === "post") {
    return live ? { live: { type: "post", id: item.targetId, position: item.position, reexamines } } : { dead: { type: "post", id: item.targetId, position: item.position, reexamines } };
  }
  const namedHandle = item.namedHandle ?? "";
  return live ? { live: { type: "account", id: item.targetId, position: item.position, namedHandle, reexamines } } : { dead: { type: "account", position: item.position, namedHandle, reexamines } };
}

/**
 * Files a re-examination of an item (3c design, section 7.2): a new item of the same notice on the same target, whose
 * `reexamines_item_id` is the item, decided and told like any item. It runs the transaction every intake runs, for an
 * intake that exists:
 *   - the target's liveness by the one rule; a target with nothing live gets an item without a case, answered at once;
 *   - a signed-in reporter's profile row FOR KEY SHARE, refusing a missing or deleted account, as at intake;
 *   - the target's open case, or a new one, a snapshot when the case has none, and the holds;
 *   - the attach trigger decides, under the notice's lock and against the clock read then, whether the item may be
 *     examined again now, and takes its target, position and lane from it: reexamination_not_open otherwise. The unique
 *     index refuses a second re-examination of one item: reexamination_exists.
 * A re-examination of a report of child sexual abuse material about a post that quotes another examines the item korbat
 * added for the quoted post again too, in the same transaction, when that item can be examined again now: the database
 * holds that rule at commit (quote_item_missing). Should the daily release open the added item between this function's
 * read and its commit, the commit fails that way and the whole is run once more, which then reads the item as open.
 *
 * It is run again, as an intake is, when a case closed in between, on a deadlock and on a lock timeout, up to three
 * times; when the last run fails the same way the answer is case_closed. Answers the items it stored, by position.
 */
export async function recordReexamination(deps: ModerationDeps, item: ReexaminedItemRow, statement: SaltedText | null): Promise<RecordedItem[]> {
  let quoteRetried = false;
  for (let attempt = 0; ; attempt++) {
    // The statement belongs to the item that was asked about; the added item's re-examination carries none.
    const targets = [await reexaminationTarget(deps, item, statement)];
    if (item.suspect && item.targetType === "post" && item.position <= 10) {
      const added = await addedItemOpen(deps.apiDb, { intakeId: item.intakeId, targetId: item.targetId });
      if (added) targets.push(await reexaminationTarget(deps, added, null));
    }
    const live = targets.flatMap((target) => ("live" in target ? [target.live] : []));
    const dead = targets.flatMap((target) => ("dead" in target ? [target.dead] : []));
    try {
      return await deps.apiDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}::text, true)`);
        if (item.reporterId !== null) await deps.social.lockAccounts(tx, [item.reporterId], "key share", true);
        // The lane is the examined item's, which the trigger copies: the one given here is never stored.
        return attachTargets(deps, tx, { intakeId: item.intakeId, lane: 2, suspect: item.suspect, live, dead });
      });
    } catch (err) {
      const refusal = raisedMessage(err);
      if (refusal === "reexamination_not_open") throw new ModerationError("reexamination_not_open");
      if (violatedUniqueConstraint(err) === "intake_items_reexamines_once") throw new ModerationError("reexamination_exists");
      if (refusal === "quote_item_missing" && !quoteRetried) {
        quoteRetried = true;
        continue;
      }
      const startOver = err instanceof StartOver || isSerializationFailure(err) || isDeadlock(err) || isLockNotAvailable(err);
      if (!startOver) throw err;
      if (attempt >= RETRIES) throw new ModerationError("case_closed");
    }
  }
}

/**
 * What follows a re-examination's commit, and is not waited for: the urgent lane's alert when an item went into lane 0,
 * as for any such item, and the day the notice's contact is forgotten, which moves to six months from now, since korbat
 * owes the notifier another answer. A failure of either is logged: the dispatch job repeats the alert and moves the date.
 */
function afterReexamination(deps: ModerationDeps, item: ReexaminedItemRow, recorded: readonly RecordedItem[]): void {
  const urgent = recorded.some((stored) => stored.caseId !== null && stored.lane === 0);
  deps.background.start(async () => {
    if (urgent) {
      try {
        await alertUrgentLane(deps);
      } catch (err) {
        deps.log.error({ err, intakeId: item.intakeId }, "re-examination: the urgent lane's alert failed; the dispatch job repeats it");
      }
    }
    if (item.contactId !== null) {
      try {
        await deps.auth.forgetNotifierAfter([item.contactId], appealDeadline(deps.now()));
      } catch (err) {
        deps.log.warn({ err, intakeId: item.intakeId }, "re-examination: the day the notifier's contact is forgotten was not moved; the next daily dispatch moves it");
      }
    }
  });
}

/**
 * The part every request for a re-examination shares, once its item is found: the statement's salt and digest, the
 * transaction, and what follows the commit. A request that failed through no fault of its sender (its case kept
 * changing until the last retry, or a failure no rule of the module names) gives its hit on the day's limit back.
 */
async function reexamine(deps: ModerationDeps, item: ReexaminedItemRow, statement: string | undefined, limitKey: string): Promise<ReexamineResponse> {
  let recorded: RecordedItem[];
  try {
    recorded = await recordReexamination(deps, item, await saltedStatement(statement));
  } catch (err) {
    if (!(err instanceof ModerationError) || err.code === "case_closed") {
      await deps.limits.release(limitKey).catch((failure: unknown) => deps.log.warn({ err: failure }, "re-examination: a limit hit of a request that could not be saved could not be given back"));
    }
    throw err;
  }
  afterReexamination(deps, item, recorded);
  return { positions: recorded.map((stored) => stored.position) };
}

/** A statement of an appeal or of a request for a re-examination as it is stored: with a salt of the server's own and the digest over the salt and the text. */
export async function saltedStatement(text: string | undefined): Promise<SaltedText | null> {
  if (text === undefined) return null;
  const salt = randomBytes(32).toString("hex");
  return { text, salt, digest: await textDigest(salt, text) };
}

/**
 * POST /api/notices/reexamine: a notifier asks for a re-examination of an item of their notice, with either token, as
 * for the status page. At most five a day from one network, counted before the token is looked at, so the route is no
 * faster way to try tokens than the status page. A re-examination shares its position with the item it examines again,
 * so the request names the newest item at that position: what the page shows last there. A position that holds no item
 * is reexamination_not_open, as an item that cannot be examined again is.
 */
export async function reexamineNotice(deps: ModerationDeps, request: NoticeReexamineRequest, netHash: string): Promise<ReexamineResponse> {
  const key = `reexamine:day:net:${netHash}`;
  await countOrRefuse(deps, key, DAY_MS, DAILY_LIMITS.reexaminations);
  const { notice } = await noticeFor(deps, request);
  const item = await newestItemAt(deps.apiDb, notice.id, request.position);
  if (!item) throw new ModerationError("reexamination_not_open");
  return reexamine(deps, item, request.statement, key);
}

/**
 * POST /api/moderation/items/:item/reexamine: a signed-in reporter asks for a re-examination of an item of a report of
 * their own, named by the id their list gives. At most five a day for one account. An item that is not theirs, or whose
 * record no longer names them, is not_found.
 */
export async function reexamineOwnItem(deps: ModerationDeps, viewer: string, itemId: string, request: ReexamineRequest): Promise<ReexamineResponse> {
  const key = `reexamine:day:account:${viewer}`;
  await countOrRefuse(deps, key, DAY_MS, DAILY_LIMITS.reexaminations);
  const item = await reporterItem(deps.apiDb, viewer, itemId);
  if (!item) throw new ModerationError("not_found");
  return reexamine(deps, item, request.statement, key);
}
