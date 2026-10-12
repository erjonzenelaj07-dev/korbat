/**
 * The staff command line's commands for moderation cases (3c design, section 7.13): link, unlink, limits, text-verify,
 * account-facts and access-request. staff.ts parses their arguments, reads their settings and opens their connections;
 * this file holds what each does, over the connections it is handed. Each sets the 10-second lock timeout in every
 * transaction it opens, writes its audit row in the transaction of its change and as that transaction's last statement
 * (the insert holds the chain's head until the commit), and says so when it changed nothing it was asked to.
 *
 * This file has no entry point of its own, so both bundles can include it (build.mjs says why that matters).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { MEASURE_KINDS, snapshotDigest, textDigest, type SnapshotDigestInput } from "@korbat/contracts";
import { moderationLimits, profiles, staffPersonalAccounts, users, type Db, type DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../auth";
import { imageModerationStates } from "../media";
import { accessDraftForAccount, accessDraftForContacts, type AccountAccessDraft, type ContactsAccessDraft } from "../moderation";
import { appendAuditRow } from "../staff";

/** What a command reads and writes through: its own connection, or a transaction a test hands in. */
type Runner = Db | DbTx;

const rowsOf = async <T>(q: Runner, query: ReturnType<typeof sql>): Promise<T[]> => (await q.execute(query)) as unknown as T[];
const uuidArray = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;
const textArray = (values: readonly string[]) => sql`${`{${values.join(",")}}`}::text[]`;

/** Runs `change` in a transaction that waits at most 10 seconds for a lock, as every staff command waits. */
function changing<T>(db: Runner, change: (tx: DbTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    return change(tx);
  });
}

/** A handle as the operator types it, with or without its at sign, in the lower case the profiles hold. */
export const handleArg = (arg: string): string => arg.replace(/^@/, "").toLowerCase();

// ---------------------------------------------------------------- link and unlink

export type Changed = { ok: true; lines: string[] } | { ok: false; problem: string };

/**
 * Records, or with `remove` takes back, that a personal account is a staff member's own (the recusal check of 3c reads
 * the links; no API role can). As the migrator, in one transaction: the staff account's row and the personal account's
 * are locked FOR SHARE, so neither can be promoted, demoted or taken down under the check; a link is recorded only for
 * a live staff account and a live account that is not staff. The audit row names the staff account and nothing of the
 * link, which must not spread.
 */
export async function changeLink(migrateDb: Runner, staffEmail: string, personalHandle: string, remove: boolean): Promise<Changed> {
  const handle = handleArg(personalHandle);
  return changing(migrateDb, async (tx): Promise<Changed> => {
    const [staff] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${staffEmail})`, isNull(users.deletedAt)))
      .limit(1)
      .for("share");
    if (!staff) return { ok: false, problem: `no live account for ${staffEmail}` };
    const [profile] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.handle, handle)).limit(1);
    if (!profile) return { ok: false, problem: `no account has the handle @${handle}` };
    if (remove) {
      const gone = await tx.delete(staffPersonalAccounts).where(and(eq(staffPersonalAccounts.staffUserId, staff.id), eq(staffPersonalAccounts.personalUserId, profile.id))).returning({ id: staffPersonalAccounts.staffUserId });
      if (gone.length === 0) return { ok: false, problem: `@${handle} is not linked to ${staffEmail}; nothing changed` };
      await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "staff_link_removed", targetType: "user", targetId: staff.id, requestId: null, metadata: {} });
      return { ok: true, lines: [`unlink: @${handle} is no longer linked to ${staffEmail}. Update your own record of this staff member's linked handles.`] };
    }
    if (staff.role === "user") return { ok: false, problem: `${staffEmail} is not staff (its role is user)` };
    const [personal] = await tx.select({ id: users.id, role: users.role, deletedAt: users.deletedAt }).from(users).where(eq(users.id, profile.id)).limit(1).for("share");
    if (!personal || personal.deletedAt !== null) return { ok: false, problem: `@${handle} is not a live account` };
    if (personal.id === staff.id) return { ok: false, problem: `@${handle} is the staff account itself, which is always a party where it is one` };
    if (personal.role !== "user") return { ok: false, problem: `@${handle} is a staff account (its role is ${personal.role}); only a personal account is linked` };
    const added = await tx.insert(staffPersonalAccounts).values({ staffUserId: staff.id, personalUserId: personal.id }).onConflictDoNothing().returning({ id: staffPersonalAccounts.staffUserId });
    if (added.length === 0) return { ok: false, problem: `@${handle} is already linked to ${staffEmail}; nothing changed` };
    await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "staff_link_added", targetType: "user", targetId: staff.id, requestId: null, metadata: {} });
    return { ok: true, lines: [`link: @${handle} is linked to ${staffEmail}. Update your own record of this staff member's linked handles.`] };
  });
}

// ---------------------------------------------------------------- limits

/** The five limits on staff, in the order the command takes them. */
export interface StaffLimits {
  decisionsPerHour: number;
  decisionsPerDay: number;
  caseOpensPerDay: number;
  findingsPerDay: number;
  revealsPerDay: number;
}

const describeLimits = (l: StaffLimits) => `${l.decisionsPerHour} decisions an hour, ${l.decisionsPerDay} decisions a day, ${l.caseOpensPerDay} case opens a day, ${l.findingsPerDay} findings a day, ${l.revealsPerDay} reveals a day`;

/**
 * Sets the limits' one row, as the migrator: an upsert, so it also works on a database whose row is missing, that
 * changes the row only when one of the five numbers differs. Its audit row carries the five numbers and is written only
 * when the row was inserted or changed.
 */
export async function setLimits(migrateDb: Runner, limits: StaffLimits): Promise<Changed> {
  return changing(migrateDb, async (tx): Promise<Changed> => {
    const l = moderationLimits;
    const written = await tx
      .insert(l)
      .values({ id: 1, ...limits, updatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: l.id,
        set: { ...limits, updatedAt: sql`now()` },
        setWhere: sql`(${l.decisionsPerHour}, ${l.decisionsPerDay}, ${l.caseOpensPerDay}, ${l.findingsPerDay}, ${l.revealsPerDay}) is distinct from
                      (${limits.decisionsPerHour}::int, ${limits.decisionsPerDay}::int, ${limits.caseOpensPerDay}::int, ${limits.findingsPerDay}::int, ${limits.revealsPerDay}::int)`,
      })
      .returning({ id: l.id });
    if (written.length === 0) return { ok: false, problem: `the limits already are ${describeLimits(limits)}; nothing changed` };
    await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "moderation_limits_set", targetType: null, targetId: null, requestId: null, metadata: { ...limits } });
    return { ok: true, lines: [`limits: set to ${describeLimits(limits)}. Keep these numbers in your own records: a restore brings back the ones of its backup.`] };
  });
}

// ---------------------------------------------------------------- account-facts

/**
 * Prints an account's handle, address and creation time for the runbook's Art. 18 step, as the migrator, and records
 * that it did. Only for the subject of the named case: the account the case is about, or the author of its post.
 */
export async function accountFacts(migrateDb: Runner, handleGiven: string, caseId: string): Promise<Changed> {
  const handle = handleArg(handleGiven);
  return changing(migrateDb, async (tx): Promise<Changed> => {
    const [profile] = await tx.select({ id: profiles.id, handle: profiles.handle }).from(profiles).where(eq(profiles.handle, handle)).limit(1);
    if (!profile) return { ok: false, problem: `no account has the handle @${handle}` };
    const [subject] = await rowsOf<{ subject: string | null }>(
      tx,
      sql`select case when c.target_type = 'account' then c.target_id else (select p.author_id from posts p where p.id = c.target_id) end as subject from cases c where c.id = ${caseId}::uuid`,
    );
    if (!subject) return { ok: false, problem: `no case has the id ${caseId}` };
    if (subject.subject !== profile.id) return { ok: false, problem: `@${handle} is not the subject of case ${caseId}; nothing was read` };
    const [account] = await tx.select({ email: users.email, createdAt: users.createdAt }).from(users).where(eq(users.id, profile.id)).limit(1);
    if (!account) return { ok: false, problem: `@${handle} has no account row` };
    await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "account_facts_read", targetType: "user", targetId: profile.id, requestId: null, metadata: { caseId } });
    return {
      ok: true,
      lines: [
        `handle: @${profile.handle}`,
        `email: ${account.email}`,
        `account created: ${account.createdAt.toISOString()}`,
        "Keep this off the server, with your R2 or Art. 18 record of the case, and destroy it after an answer without a seal (README, runbook).",
      ],
    };
  });
}

// ---------------------------------------------------------------- access-request

/**
 * Drafts the moderation part of an answer to a GDPR access request and records that it did, on the API role: for a
 * handle the account's cases and its own reports, for an address the notices of the contacts the auth module found for
 * it (`contactsOf`, which alone can read a contact). The audit row carries counts only, and names the account for a
 * handle and nobody for an address.
 */
export async function accessRequest(
  apiDb: Runner,
  appOrigin: string,
  who: { handle: string } | { email: string },
  contactsOf: (email: string) => Promise<{ id: string; name: string | null }[]>,
): Promise<{ ok: true; draft: AccountAccessDraft | ContactsAccessDraft } | { ok: false; problem: string }> {
  if ("handle" in who) {
    const handle = handleArg(who.handle);
    const [profile] = await apiDb.select({ id: profiles.id, handle: profiles.handle }).from(profiles).where(eq(profiles.handle, handle)).limit(1);
    if (!profile) return { ok: false, problem: `no account has the handle @${handle}` };
    const draft = await accessDraftForAccount(apiDb, appOrigin, profile);
    await changing(apiDb, (tx) => appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "access_request_drafted", targetType: "user", targetId: profile.id, requestId: null, metadata: { cases: draft.cases.length, contacts: 0 } }));
    return { ok: true, draft };
  }
  const contacts = await contactsOf(who.email);
  const draft = await accessDraftForContacts(apiDb, appOrigin, contacts);
  await changing(apiDb, (tx) => appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "access_request_drafted", targetType: null, targetId: null, requestId: null, metadata: { cases: 0, contacts: contacts.length } }));
  return { ok: true, draft };
}

// ---------------------------------------------------------------- text-verify

/** One thing text-verify found wrong, and what it is about: an audit row by its place, or a decision, a post, an image or a seal by its id. */
export interface TextProblem {
  about: "audit" | "decision" | "post" | "image" | "seal";
  id: string;
  message: string;
}

export interface TextReport {
  ok: boolean;
  /** The confirmed rows read, and the decisions, posts, images and seals in force checked. */
  auditRows: number;
  decisions: number;
  posts: number;
  images: number;
  seals: number;
  /** The first problems, in the order found. */
  problems: TextProblem[];
  problemCount: number;
}

/** How many rows text-verify reads at a time. */
export const TEXT_VERIFY_PAGE_SIZE = 1000;
const PAGE = TEXT_VERIFY_PAGE_SIZE;

/** The actions whose params name saved texts and snapshots by their digests. */
const CONFIRMED_ACTIONS = ["case_decided", "appeals_reviewed", "identity_revealed"];
/** The params members that name a saved text. */
const TEXT_MEMBERS = ["factsDigest", "reasonDigest", "legalReferenceDigest"];

interface NamingRow {
  place: number;
  action: string;
  actorId: string;
  targetType: string | null;
  targetId: string | null;
  params: Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const actionKey = (action: { kind: unknown; mediaId: unknown }) => `${String(action.kind)}:${action.mediaId === null || action.mediaId === undefined ? "" : String(action.mediaId)}`;

/**
 * text-verify (3c design, section 7.13), read-only on the API's role. audit-verify proves that the record was not
 * rewritten; this proves that what the record's confirmed rows name is still what korbat holds, and that what posts and
 * images show is what the record says. Three checks, each in this command's own code:
 *
 *   1. Every digest in the params of a confirmed row (a decision, a review, a reveal) names a saved text that korbat
 *      still holds and that recomputes to it, an erased text, a snapshot still held that recomputes to it, or an erased
 *      snapshot. A text or a snapshot that is missing was removed around the erasures, which keep each row and its digest.
 *   2. Every decision is named by exactly one such row, written by the deciding account on the decision's case (for a
 *      review, on the reviewed decision), whose params equal the decision's own columns and whose actions equal its
 *      ledger rows as a set. A row that names a decision korbat does not hold is reported too.
 *   3. Every post's level and every image's state equal what the ledger of measures gives, worked out here from the
 *      ledger's rows, the cases' closures, the items and the erasure marks, as the database's own writer derives them;
 *      and every post a seal in force lists still has the number of image rows the seal recorded.
 *
 * So a change made around the triggers, by the migrator or by hand, is reported: a decision or a measure altered or
 * removed, a level or a state set, a sealed image row destroyed or lost in a restore. `keep` bounds the problems kept.
 */
export async function textVerify(q: Runner, keep = 100): Promise<TextReport> {
  const problems: TextProblem[] = [];
  let problemCount = 0;
  const problem = (about: TextProblem["about"], id: string, message: string) => {
    problemCount++;
    if (problems.length < keep) problems.push({ about, id, message });
  };

  // ---- 1. the confirmed rows and what their digests name
  const naming = new Map<string, NamingRow[]>();
  let auditRows = 0;
  for (let after = 0; ; ) {
    const page = await rowsOf<{ id: number; place: number; action: string; actor_id: string; target_type: string | null; target_id: string | null; metadata: unknown }>(
      q,
      sql`select id::int as id, chain_seq::int as place, action, actor_id, target_type, target_id, metadata from audit_log
           where action = any(${textArray(CONFIRMED_ACTIONS)}) and id > ${after} order by id limit ${PAGE}`,
    );
    const wanted: { place: number; member: string; digest: string }[] = [];
    const wantedSnapshots: { place: number; id: string; digest: string }[] = [];
    for (const row of page) {
      auditRows++;
      const metadata = isObject(row.metadata) ? row.metadata : {};
      const params = isObject(metadata.params) ? metadata.params : null;
      if (params === null) {
        problem("audit", String(row.place), `its action, ${row.action}, carries no params`);
        continue;
      }
      for (const member of TEXT_MEMBERS) if (typeof params[member] === "string") wanted.push({ place: row.place, member, digest: params[member] });
      if (typeof params.snapshotId === "string" && typeof params.snapshotDigest === "string") wantedSnapshots.push({ place: row.place, id: params.snapshotId, digest: params.snapshotDigest });
      if (row.action !== "identity_revealed") {
        const decisionId = typeof metadata.decisionId === "string" ? metadata.decisionId : null;
        if (decisionId === null) problem("audit", String(row.place), `its action, ${row.action}, names no decision`);
        else naming.set(decisionId, [...(naming.get(decisionId) ?? []), { place: row.place, action: row.action, actorId: row.actor_id, targetType: row.target_type, targetId: row.target_id, params }]);
      }
    }
    if (wanted.length > 0) {
      const texts = await rowsOf<{ digest: string; text: string | null; salt: string | null }>(q, sql`select digest, text, salt from staff_texts where digest = any(${textArray([...new Set(wanted.map((w) => w.digest))])})`);
      const byDigest = new Map(texts.map((t) => [t.digest, t]));
      for (const w of wanted) {
        const held = byDigest.get(w.digest);
        if (!held) problem("audit", String(w.place), `its ${w.member} names no saved text`);
        // An erased text keeps its row and its digest: that is retention at work, and nothing to report.
        else if (held.text !== null && (held.salt === null || (await textDigest(held.salt, held.text).catch(() => null)) !== w.digest)) problem("audit", String(w.place), `the text its ${w.member} names no longer recomputes to that digest`);
      }
    }
    if (wantedSnapshots.length > 0) {
      const found = await rowsOf<Record<string, unknown> & { id: string; digest: string; erased: boolean }>(
        q,
        sql`select id, digest, erased_at is not null as erased, salt, target_type::text as target_type, target_id,
                   to_char(taken_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as taken_at, author_handle, post_state::text as post_state,
                   to_char(post_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as post_created_at, reply_to_id, quote_of_id, body, media, display_name, bio, handle
              from evidence_snapshots where id = any(${uuidArray([...new Set(wantedSnapshots.map((w) => w.id))])})`,
      );
      const byId = new Map(found.map((s) => [s.id, s]));
      for (const w of wantedSnapshots) {
        const s = byId.get(w.id);
        if (!s) problem("audit", String(w.place), "its snapshotId names no snapshot");
        else if (s.digest !== w.digest) problem("audit", String(w.place), "its snapshotDigest is not the digest of the snapshot it names");
        else if (!s.erased) {
          const input = { salt: s.salt, targetType: s.target_type, targetId: s.target_id, takenAt: s.taken_at, authorHandle: s.author_handle, postState: s.post_state, postCreatedAt: s.post_created_at, replyToId: s.reply_to_id, quoteOfId: s.quote_of_id, body: s.body, media: s.media, displayName: s.display_name, bio: s.bio, handle: s.handle } as unknown as SnapshotDigestInput;
          if ((await snapshotDigest(input).catch(() => null)) !== w.digest) problem("audit", String(w.place), "the snapshot it names no longer recomputes to its digest");
        }
      }
    }
    if (page.length < PAGE) break;
    after = page[page.length - 1]!.id;
  }

  // ---- 2. every decision against the one row that names it
  let decisions = 0;
  const seen = new Set<string>();
  for (let after: string | null = null; ; ) {
    const page: { id: string; d: Record<string, unknown>; actions: { kind: string; mediaId: string | null }[] }[] = await rowsOf(
      q,
      sql`select d.id, to_jsonb(d) as d,
                 coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'mediaId', a.media_id)) from decision_actions a where a.decision_id = d.id), '[]'::jsonb) as actions
            from decisions d where ${after === null ? sql`true` : sql`d.id > ${after}::uuid`} order by d.id limit ${PAGE}`,
    );
    for (const { id, d, actions } of page) {
      decisions++;
      seen.add(id);
      const named = naming.get(id) ?? [];
      if (named.length !== 1) {
        problem("decision", id, named.length === 0 ? "no confirmed row of the audit log names it" : `${named.length} rows of the audit log name it (places ${named.map((row) => row.place).join(", ")})`);
        continue;
      }
      const row = named[0]!;
      const review = d.kind === "review";
      const expected: Record<string, unknown> = review
        ? { stateVersion: d.seen_state_version, appealId: d.appeal_id, snapshotId: d.snapshot_id, snapshotDigest: d.snapshot_digest, outcome: d.outcome, rulesVersion: d.rules_version, redressVersion: d.redress_version, category: d.category, reasonDigest: d.reason_digest }
        : {
            kind: d.kind, stateVersion: d.seen_state_version, throughSeq: d.through_seq, reviewsDecisionId: d.reviews_decision_id, snapshotId: d.snapshot_id, snapshotDigest: d.snapshot_digest, outcome: d.outcome,
            ground: d.ground, ruleId: d.rule_id, rulesVersion: d.rules_version, redressVersion: d.redress_version, category: d.category, categoryKeyword: d.category_keyword,
            factsDigest: d.facts_digest, reasonDigest: d.reason_digest, legalReferenceDigest: d.legal_reference_digest,
          };
      const differing: string[] = [];
      if (row.actorId !== d.decided_by) differing.push("actor");
      if (row.action !== (review ? "appeals_reviewed" : "case_decided") || row.targetType !== (review ? "decision" : "case") || row.targetId !== (review ? d.reviews_decision_id : d.case_id)) differing.push("target");
      for (const key of new Set([...Object.keys(expected), ...Object.keys(row.params)])) {
        if (key !== "actions" && (expected[key] ?? null) !== (row.params[key] ?? null)) differing.push(key);
        if (key !== "actions" && !(key in expected)) differing.push(key);
      }
      const recorded = Array.isArray(row.params.actions) ? row.params.actions.filter(isObject).map((a) => actionKey({ kind: a.kind, mediaId: a.mediaId })) : null;
      if (recorded === null || [...recorded].sort().join("|") !== actions.map(actionKey).sort().join("|")) differing.push("actions");
      if (differing.length > 0) problem("decision", id, `it differs from the audit row at place ${row.place} that names it: ${[...new Set(differing)].sort().join(", ")}`);
    }
    if (page.length < PAGE) break;
    after = page[page.length - 1]!.id;
  }
  for (const [decisionId, named] of naming) if (!seen.has(decisionId)) problem("decision", decisionId, `the audit row at place ${named[0]!.place} names it, and korbat holds no such decision`);

  // ---- 3. levels and states, worked out from the ledger
  const measures = MEASURE_KINDS as readonly string[];
  const removedPosts = new Set<string>();
  const withheldPosts = new Set<string>();
  const removedImages = new Set<string>();
  const withheldImages = new Set<string>();
  const sealsInForce = new Set<string>();
  for (let after: string | null = null; ; ) {
    const page: { id: string; kind: string; post_id: string | null; media_id: string | null; decision_kind: string; case_open: boolean; suspect_open: boolean; reversed: boolean }[] = await rowsOf(
      q,
      sql`select a.id, a.kind::text as kind, a.post_id, a.media_id, d.kind::text as decision_kind, c.closed_at is null as case_open,
                 exists (select 1 from intake_items i where i.case_id = d.case_id and i.suspect and i.answered_by is null and i.created_at <= d.decided_at) as suspect_open,
                 exists (select 1 from decision_actions r where r.reverses_action_id = a.id) as reversed
            from decision_actions a join decisions d on d.id = a.decision_id join cases c on c.id = d.case_id
           where a.kind::text = any(${textArray(measures)}) and ${after === null ? sql`true` : sql`a.id > ${after}::uuid`} order by a.id limit ${PAGE}`,
    );
    for (const m of page) {
      // In force: no row reverses it, and a measure taken while deciding lasts while its case is open, a seal taken while
      // deciding while its case holds an unanswered suspect item that arrived no later than it.
      const inForce = !m.reversed && (m.decision_kind !== "interim" || (m.kind === "seal_media" ? m.suspect_open : m.case_open));
      if (!inForce) continue;
      if (m.kind === "remove" && m.post_id) removedPosts.add(m.post_id);
      else if (m.kind === "withhold" && m.post_id) withheldPosts.add(m.post_id);
      else if (m.kind === "remove_media" && m.media_id) removedImages.add(m.media_id);
      else if (m.kind === "withhold_media" && m.media_id) withheldImages.add(m.media_id);
      else if (m.kind === "seal_media") sealsInForce.add(m.id);
    }
    if (page.length < PAGE) break;
    after = page[page.length - 1]!.id;
  }
  // The posts each seal in force lists, with the image rows it recorded for each.
  const listed: { actionId: string; postId: string; images: number }[] = [];
  const sealedPosts = new Set<string>();
  if (sealsInForce.size > 0) {
    const found = await rowsOf<{ action_id: string; post_id: string; images: number }>(q, sql`select action_id, post_id, images::int as images from seal_posts where action_id = any(${uuidArray([...sealsInForce])}) order by action_id, post_id`);
    for (const row of found) {
      listed.push({ actionId: row.action_id, postId: row.post_id, images: row.images });
      sealedPosts.add(row.post_id);
    }
  }

  let posts = 0;
  for (let after: string | null = null; ; ) {
    const page: { id: string; state: string; level: string; erased: boolean }[] = await rowsOf(
      q,
      sql`select id, state::text as state, moderation_level::text as level, erased_at is not null as erased from posts where ${after === null ? sql`true` : sql`id > ${after}::uuid`} order by id limit ${PAGE}`,
    );
    for (const post of page) {
      posts++;
      const level = post.erased || removedPosts.has(post.id) ? "removed" : withheldPosts.has(post.id) ? "withheld" : "visible";
      if (post.level !== level) problem("post", post.id, `its level is stored as ${post.level}, and the ledger of measures gives ${level}`);
      // The state mirrors the level unless the author deleted the post, which is terminal.
      else if (post.state !== "deleted_by_author" && post.state !== level) problem("post", post.id, `its state is stored as ${post.state}, and its level is ${level}`);
    }
    if (page.length < PAGE) break;
    after = page[page.length - 1]!.id;
  }

  let images = 0;
  const imagesOn = new Map<string, number>();
  for (let after: string | null = null; ; ) {
    const page = await imageModerationStates(q as Db, after, PAGE);
    for (const image of page) {
      images++;
      if (sealedPosts.has(image.postId)) imagesOn.set(image.postId, (imagesOn.get(image.postId) ?? 0) + 1);
      const state = sealedPosts.has(image.postId) ? "sealed" : image.erasedAt !== null || removedImages.has(image.id) ? "removed" : withheldImages.has(image.id) ? "withheld" : "visible";
      if (image.moderationState !== state) problem("image", image.id, `its state is stored as ${image.moderationState}, and the ledger of measures gives ${state}`);
    }
    if (page.length < PAGE) break;
    after = page[page.length - 1]!.id;
  }
  for (const row of listed) {
    const now = imagesOn.get(row.postId) ?? 0;
    if (now !== row.images) problem("seal", row.actionId, `it lists post ${row.postId} with ${row.images} image ${row.images === 1 ? "row" : "rows"}, and the post has ${now} now`);
  }

  return { ok: problemCount === 0, auditRows, decisions, posts, images, seals: sealsInForce.size, problems, problemCount };
}

/** text-verify on the command line's own connection: one REPEATABLE READ READ ONLY transaction, so every check reads one state of the database. */
export function textVerifyOn(apiDb: Db): Promise<TextReport> {
  return apiDb.transaction(
    async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      return textVerify(tx);
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** How text-verify reports: what holds, or the first problems. */
export function describeTextReport(report: TextReport): string[] {
  const counted = `${report.auditRows} confirmed rows, ${report.decisions} decisions, ${report.posts} posts, ${report.images} images and ${report.seals} seals in force`;
  if (report.ok) return [`text-verify: what the record names is what korbat holds: ${counted}`];
  const shown = report.problems.slice(0, 20);
  const lines = [`text-verify: FAILED, ${report.problemCount} ${report.problemCount === 1 ? "problem" : "problems"} in ${counted}; the first:`];
  for (const p of shown) lines.push(`  ${p.about === "audit" ? "place" : p.about} ${p.id}: ${p.message}`);
  if (report.problemCount > shown.length) lines.push(`  and ${report.problemCount - shown.length} more`);
  return lines;
}
