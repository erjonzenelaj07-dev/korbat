import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { laneFor, snapshotDigest, type Lane, type RuleId, type TdbCategory } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import type { HoldPair } from "../media";
import type { CapturedPost, CapturedProfile } from "../social";
import { ModerationError, type ModerationDeps } from "./context";
import { insertIntake, insertItem, insertSnapshot, isSerializationFailure, latestSnapshot, openCase, snapshotTime, violatedUniqueConstraint } from "./repo";

/**
 * Taking in a report, a notice or a moderator's own finding (3c design, section 7.1, step 4): one intake, one item for
 * each target it names, each item in exactly one open case, and the first copy of each target as evidence. The routes
 * that validate a request and resolve its targets come with the reports themselves; this is the transaction they run.
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

/** A target that is live: a post by its id, or an account by its id with the handle it was named by. `position` is its place among the targets named, from 1. */
export type LiveTarget =
  | { type: "post"; id: string; position: number; mediaId?: string | null }
  | { type: "account"; id: string; position: number; namedHandle: string };

/** A target with nothing live: a link to a post that names no row or a deleted one, or a handle that names no account. It is stored as answered at once. */
export type DeadTarget = { type: "post"; id: string; position: number } | { type: "account"; position: number; namedHandle: string };

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

  // 1.
  if (ground.reporterId !== null) await deps.social.lockAccounts(tx, [ground.reporterId], "key share", true);

  // 2. The token is stored only as its hash; the answer carries it once.
  const ref = newRef();
  const token = ground.channel === "signed_out" || ground.csam ? randomBytes(32).toString("base64url") : null;
  const intakeId = await insertIntake(tx, { ...ground, ref, lookupHash: token === null ? null : createHash("sha256").update(token).digest("hex") });
  const lane = laneFor({ ruleId: ground.ruleId, allegesIllegal: ground.allegesIllegal, csam: ground.csam, category: ground.category });

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
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId: target.id, caseId, seq: item.seq, lane });
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
  // held the handle: no stored id ties an old handle to its account.
  for (const target of request.dead ?? []) {
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
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId, caseId: null, seq: null, lane });
  }
  items.sort((a, b) => a.position - b.position);
  return { intakeId, ref, token, suspect, items };
}

type SnapshotContent = Omit<Parameters<typeof insertSnapshot>[1], "salt" | "digest">;

/**
 * One snapshot: a salt of the server's own, and the digest over the salt, the time and everything copied. The time in
 * the digest is the one the database stamps the row with; when the two differ the transaction is rolled back, since the
 * stored row would not recompute to its digest.
 */
async function storeSnapshot(tx: DbTx, takenAt: string, content: SnapshotContent): Promise<void> {
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
}
