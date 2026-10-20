import type { Logger } from "pino";
import { OrderNoticeFacts, OrderTexts, STANDING_RULES, type Platform } from "@korbat/contracts";
import type { AccountExport } from "../../auth";
import type { ModerationExport } from "../../moderation";
import type { ProfileExport } from "../../social";
import { AccountError, type AccountDeps } from "../context";
import type { OpenFile, ZipWriter } from "../zip";

/** One export a day (1b design, section 10). */
export const EXPORTS_PER_WINDOW = 1;
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

const exportLimitKey = (userId: string) => `export:${userId}`;

/** The entry an image has in the archive; export.json names it under the post's media. */
export function mediaEntry(id: string): string {
  return `media/${id}.webp`;
}

/** The download's name: the handle and the day, so several exports of one account sort by date. */
export function exportFilename(handle: string, now: Date): string {
  return `korbat-export-${handle}-${now.toISOString().slice(0, 10)}.zip`;
}

/**
 * What the archive is written from. The account's own facts, the profile and the moderation member are
 * read before the first byte; the profile's lists are read page by page while export.json is written,
 * and the images, each behind the media module's checked open, go first, so `missingMedia` is complete
 * by the time the JSON that lists it is written.
 */
export interface ExportPlan {
  exportedAt: Date;
  /** The handle of the session that asked for the export: the id the auth module lists each session under. */
  currentSession: string;
  account: AccountExport;
  profile: ProfileExport;
  /** The decisions about the account that it was told of and its own reports, as the moderation module hands them over (3c design, section 7.11). */
  moderation: ModerationExport;
  images: { id: string; open: OpenFile }[];
  /** The images whose file the checked open refused or could not find, filled while the images are written. */
  missingMedia: string[];
}

/**
 * Counts one export of the account in the daily window and refuses once it is used up. Taken before
 * anything is built or streamed, so a stream that fails midway still counts; Retry-After says when the
 * window resets.
 */
export async function enforceExportLimit(deps: AccountDeps, userId: string): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(exportLimitKey(userId), EXPORT_WINDOW_MS);
  } catch {
    // Fails closed: an export that cannot be counted is not made, and the client is told to retry shortly.
    throw new AccountError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > EXPORTS_PER_WINDOW) throw new AccountError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Gives the day's export back after a failure before the archive's first byte (a pool timeout, a
 * restart): the owner received nothing, so the attempt must not use up the day. Best effort: when the
 * store cannot be reached, the export stays counted and a warning says so, which costs the owner a day
 * at worst.
 */
export async function giveBackExport(deps: AccountDeps, userId: string, log: Logger): Promise<void> {
  try {
    await deps.limits.release(exportLimitKey(userId));
  } catch (err) {
    log.warn({ err, userId }, "account export: the day's export could not be given back after a failure before the first byte");
  }
}

const iso = (at: Date): string => at.toISOString();
const isoOrNull = (at: Date | null): string | null => (at ? at.toISOString() : null);

/**
 * What an account module built without the moderation module writes: the member is part of the format, so it is always
 * there. Its reporting counts are empty over the standing rules' frame, the number the moderation module would read.
 */
const NO_MODERATION: ModerationExport = {
  decisions: [],
  reports: [],
  strikes: [],
  standing: [],
  replies: [],
  reporting: { frameDays: STANDING_RULES.reportFrameDays, days: [], marks: [], markedReports: 0 },
  uploads: [],
  releases: [],
};

/**
 * Reads what is needed before the first byte: the account's facts, sessions, devices and events (one
 * read, bounded by the 90 days of events), the profile's own fields, the list of images, and the
 * moderation member (the decisions the account was told of and its own reports, both short lists). The
 * four modules are asked at once, so a read that fails costs the owner nothing: no byte was sent yet.
 * `currentSession` is the handle of the session asking, which marks its entry among the sessions.
 * `pageSize` is how many rows of each profile list are read at a time; tests lower it.
 */
export async function buildExport(deps: AccountDeps, userId: string, currentSession: string, now: Date, pageSize?: number): Promise<ExportPlan> {
  const [account, profile, images, moderation] = await Promise.all([
    deps.auth.exportAccount(userId),
    deps.social.exportProfile(userId, pageSize),
    deps.media.exportImages(userId),
    // The server always hands the moderation module over; a test of the other members may leave it out.
    deps.moderation ? deps.moderation.exportFor(userId) : NO_MODERATION,
  ]);
  return { exportedAt: now, currentSession, account, profile, moderation, images, missingMedia: [] };
}

/** A list member of export.json, read in pages and written one element at a time. */
class Paged<T> {
  constructor(
    readonly pages: AsyncIterable<readonly T[]>,
    readonly element: (row: T) => unknown,
  ) {}
}

/** An array already in memory, as one page. */
function inMemory<T>(rows: readonly T[], element: (row: T) => unknown): Paged<T> {
  return new Paged(
    (async function* () {
      yield rows;
    })(),
    element,
  );
}

/** Fragments are gathered into pieces of about this many UTF-16 units, at most 3 bytes each in UTF-8: well under 64 KiB. */
const PIECE_CHARS = 16 * 1024;

/**
 * export.json in pieces, written exactly as JSON.stringify(document, null, 2) writes the whole
 * document: member by member at the top level, and the lists element by element, each element
 * stringified on its own and indented to its depth (JSON.stringify's output holds line breaks only
 * between tokens; one inside a string is escaped, so indenting after every line break is exact). No list
 * is ever whole in memory: each is read page by page as it is written.
 */
export async function* exportJson(plan: ExportPlan): AsyncGenerator<string> {
  let buffer = "";
  for await (const fragment of documentFragments(plan)) {
    buffer += fragment;
    if (buffer.length >= PIECE_CHARS) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer.length > 0) yield buffer;
}

async function* documentFragments(plan: ExportPlan): AsyncGenerator<string> {
  const { account, profile } = plan;
  const ref = (row: { postId: string; at: Date }) => ({ postId: row.postId, at: iso(row.at) });
  const other = (row: { handle: string; since: Date }) => ({ handle: row.handle, since: iso(row.since) });
  // The members in the order of the format (ExportFormat in the contracts); the order is part of the bytes.
  const members: [string, unknown][] = [
    ["format", "korbat-export-1"],
    ["exportedAt", iso(plan.exportedAt)],
    [
      "account",
      {
        id: account.account.id,
        email: account.account.email,
        createdAt: iso(account.account.createdAt),
        role: account.account.role,
        mfaEnabled: account.account.mfaEnabled,
        hasPassword: account.account.hasPassword,
        verified: account.account.verified,
        termsVersion: account.account.termsVersion,
        termsAcceptedAt: isoOrNull(account.account.termsAcceptedAt),
        // Inside the account, where the format places them; at most the cap of ten, so they are written with the account's other facts rather than paged.
        passkeys: account.passkeys.map((passkey) => ({ name: passkey.name, createdAt: iso(passkey.createdAt), lastUsedAt: isoOrNull(passkey.lastUsedAt), synced: passkey.synced, createdOn: passkey.createdOn })),
      },
    ],
    [
      "profile",
      {
        handle: profile.profile.handle,
        displayName: profile.profile.displayName,
        bio: profile.profile.bio,
        createdAt: iso(profile.profile.createdAt),
        handleHistory: [...profile.profile.handleHistory],
        // Last in the profile, where the format added it (2c); the member order is part of the bytes.
        showInExplore: profile.profile.showInExplore,
        // After it, where 3e added it (W.8): the retired handles of the history, with when.
        retiredHandles: profile.profile.retiredHandles.map((retired) => ({ handle: retired.handle, retiredAt: iso(retired.retiredAt) })),
      },
    ],
    [
      "posts",
      new Paged(profile.posts, (post) => ({
        id: post.id,
        body: post.body,
        createdAt: iso(post.createdAt),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        state: post.state,
        deletedAt: isoOrNull(post.deletedAt),
        media: post.media.map((image) => ({ id: image.id, file: mediaEntry(image.id), altText: image.altText, width: image.width, height: image.height })),
      })),
    ],
    ["likes", new Paged(profile.likes, ref)],
    ["reposts", new Paged(profile.reposts, ref)],
    ["bookmarks", new Paged(profile.bookmarks, ref)],
    ["following", new Paged(profile.following, other)],
    ["blocks", new Paged(profile.blocks, other)],
    ["mutes", new Paged(profile.mutes, other)],
    [
      "sessions",
      inMemory(account.sessions, (session) => ({ id: session.id, createdAt: iso(session.createdAt), lastUsedAt: iso(session.lastUsedAt), current: session.id === plan.currentSession })),
    ],
    [
      "devices",
      // The platform column is text; sign-in only ever writes one of the contract's three values.
      inMemory(account.devices, (device) => ({ label: device.label, platform: device.platform as Platform, firstSeenAt: iso(device.firstSeenAt), lastSeenAt: iso(device.lastSeenAt) })),
    ],
    ["events", inMemory(account.events, (event) => ({ type: event.type, at: iso(event.at) }))],
    // Complete by now: the images were written before the JSON.
    ["missingMedia", inMemory(plan.missingMedia, (id) => id)],
    // Last, where the format added it (3c). Each entry is written member by member in the format's order, so the bytes
    // do not depend on how the moderation module builds its objects, and nothing beyond the format is ever written.
    ["moderation", moderationMember(plan.moderation)],
  ];

  yield "{\n";
  for (const [index, [key, value]] of members.entries()) {
    yield `${index === 0 ? "" : ",\n"}  ${JSON.stringify(key)}: `;
    if (value instanceof Paged) yield* listFragments(value);
    else yield indented(JSON.stringify(value, null, 2), "  ");
  }
  yield "\n}";
}

/** An object's members in the order of a format's shape, and no other member. */
function inShapeOrder<T extends object>(shape: object, value: T): T {
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(shape).map((key) => [key, source[key]])) as T;
}

/** The moderation member with every entry's members in the order of the format (ExportFormat in the contracts). */
function moderationMember(moderation: ModerationExport): ModerationExport {
  return {
    decisions: moderation.decisions.map((decision) => ({
      id: decision.id,
      decidedOn: decision.decidedOn,
      postId: decision.postId,
      kind: decision.kind,
      outcome: decision.outcome,
      ground: decision.ground,
      ruleId: decision.ruleId,
      rulesVersion: decision.rulesVersion,
      measures: decision.measures.map((measure) => ({ kind: measure.kind, mediaId: measure.mediaId, noEffect: measure.noEffect })),
      reversals: decision.reversals.map((reversal) => ({ kind: reversal.kind, mediaId: reversal.mediaId })),
      facts: decision.facts,
      reason: decision.reason,
      legalReference: decision.legalReference,
      appeal: decision.appeal === null ? null : decision.appeal.state === "pending" ? { state: "pending", result: null } : { state: "answered", result: decision.appeal.result },
      // 3f (W.7), and 3d review L14 (people12): an order's notice keeps its facts, the authority's words and the day of an
      // erasure, which the moderation module builds; absent on every other decision, as the format has them.
      ...(decision.order
        ? {
            order: inShapeOrder(OrderNoticeFacts.shape, decision.order),
            ...(decision.orderTexts ? { orderTexts: inShapeOrder(OrderTexts.shape, decision.orderTexts) } : {}),
            erasedOn: decision.erasedOn ?? null,
          }
        : {}),
      // 3d (W.10): what the statement says of automated means, and the objection to a program's measure with its time.
      automatedDetection: decision.automatedDetection,
      automatedDecision: decision.automatedDecision,
      signal: decision.signal === null ? null : { kind: decision.signal.kind, source: decision.signal.source, matchKind: decision.signal.matchKind, listedAs: decision.signal.listedAs, viewed: decision.signal.viewed },
      objection: decision.objection === null ? null : { text: decision.objection.text, createdAt: decision.objection.createdAt },
    })),
    reports: moderation.reports.map((report) => ({
      ref: report.ref,
      receivedAt: report.receivedAt,
      ground: report.ground,
      ruleId: report.ruleId,
      category: report.category,
      explanation: report.explanation,
      items: report.items.map((item) => ({ position: item.position, link: item.link, reexamines: item.reexamines, outcome: item.outcome, outcomeText: item.outcomeText, reexaminationOpen: item.reexaminationOpen })),
    })),
    // 3e (W.8): the strikes the account was given.
    strikes: moderation.strikes.map((strike) => ({ decisionId: strike.decisionId, postId: strike.postId, ruleId: strike.ruleId, givenAt: strike.givenAt, countsUntil: strike.countsUntil, overruledAt: strike.overruledAt })),
    // Then its suspensions, terminations and reporting measures, its replies to them, and its own reporting counts.
    standing: moderation.standing.map((entry) => ({
      decisionId: entry.decisionId,
      kind: entry.kind,
      basis: entry.basis,
      days: entry.days,
      announced: entry.announced,
      decidedAt: entry.decidedAt,
      earliestStart: entry.earliestStart,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      liftedAt: entry.liftedAt,
      liftedBy: entry.liftedBy,
      replaced: entry.replaced,
      basisEndedAt: entry.basisEndedAt,
      basisEndedBy: entry.basisEndedBy,
    })),
    replies: moderation.replies.map((reply) => ({ decisionId: reply.decisionId, filedAt: reply.filedAt, onTime: reply.onTime, text: reply.text, erasedAt: reply.erasedAt, answeredAt: reply.answeredAt, answeredBy: reply.answeredBy })),
    reporting: {
      frameDays: moderation.reporting.frameDays,
      days: moderation.reporting.days.map((entry) => ({ day: entry.day, reports: entry.reports })),
      marks: moderation.reporting.marks.map((mark) => ({ ref: mark.ref, position: mark.position, sentOn: mark.sentOn, markedAt: mark.markedAt, withdrawnAt: mark.withdrawnAt, counts: mark.counts })),
      markedReports: moderation.reporting.markedReports,
    },
    // 3d (W.10): the refused uploads as their notices read them, and the releases the account may be told of.
    uploads: moderation.uploads.map((upload) => ({
      id: upload.id,
      refusedAt: upload.refusedAt,
      source: upload.source,
      matchKind: upload.matchKind,
      listedAs: upload.listedAs,
      objection: upload.objection === null ? null : { text: upload.objection.text, objectedAt: upload.objection.objectedAt },
      mayObject: upload.mayObject,
      endedAt: upload.endedAt,
      endAs: upload.endAs,
      endReason: upload.endReason,
      released: upload.released,
      reportKept: upload.reportKept,
    })),
    releases: moderation.releases.map((release) => ({ id: release.id, basis: release.basis, releasedAt: release.releasedAt, upload: release.upload })),
  };
}

/** A top-level member's array, as JSON.stringify writes it at that depth: "[]" when empty, else one element per line group. */
async function* listFragments<T>(list: Paged<T>): AsyncGenerator<string> {
  let first = true;
  for await (const page of list.pages) {
    for (const row of page) {
      yield `${first ? "[\n" : ",\n"}    ${indented(JSON.stringify(list.element(row), null, 2), "    ")}`;
      first = false;
    }
  }
  yield first ? "[]" : "\n  ]";
}

const indented = (json: string, pad: string): string => json.replaceAll("\n", `\n${pad}`);

/**
 * Writes the archive: every image as a stored entry, then export.json, then the central directory.
 * export.json comes last so that missingMedia can name every image whose file the checked open refused
 * or did not find when its turn came (the sweeper may be between the row and the file), or that was no
 * longer the owner's to export by then: the media module reads each image's row again as it opens the
 * file, and opens none for an image deleted with its post, erased or sealed since the list was read.
 * The order of entries means nothing to a reader.
 */
export async function writeExport(writer: ZipWriter, plan: ExportPlan): Promise<void> {
  for (const image of plan.images) {
    if (!(await writer.addFile(mediaEntry(image.id), image.open))) plan.missingMedia.push(image.id);
  }
  await writer.addJsonPieces("export.json", exportJson(plan));
  await writer.end();
}
