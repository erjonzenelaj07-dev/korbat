/**
 * The quarantine's commands (3d design, sections 6.1, 7.1, 8.10 and 10.5; section 2, rows 38 to 40), as the migrator in
 * the migrate service, around the one-shot service that moves the files, which has no database:
 *
 *   docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-list > list
 *   docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine < list > receipt
 *   docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-record < receipt
 *
 * quarantine-list prints the plan (quarantine_plan(), executable by the migrator alone) joined to the store's naming rule
 * through the media module's quarantineNames, one line a file; it is read-only and writes no audit row. A post sealed for
 * good whose image rows are not as many as its seal recorded is left out and named on standard error, and the command
 * exits 1 after it printed every other post's lines: one bad post never stops the list for the others.
 *
 * quarantine-record takes the mover's receipt line by line in one transaction, whose last statement is the audit row
 * quarantine_recorded (counts and the receipt's digest). A well-formed line of a move the mover did is a fact about where a
 * file now is and is recorded as that, whatever the plan says now: three commands that a person runs minutes apart cannot
 * hold the database still between them. A line the plan computed before the record no longer holds is recorded all the
 * same and reported (againstPlan), and the next list moves the file back. A line that cannot be taken is reported and
 * skipped inside that transaction; no line stops the others. The command exits 1 after its commit when it reported
 * anything. A lost file raises the alert quarantine_lost to every staff account, written with the record.
 *
 * No command here moves, opens or destroys a file, and none sends anything to anyone (8.10). This file has no entry point
 * of its own, so both bundles can include it (build.mjs says why that matters).
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { AuditExportLine, MEDIA_SIZES, QUARANTINE_DIRECTIONS, QUARANTINE_WORDS, RELEASE_LEAVE_FROM, type QuarantineDirection, type ReleaseLeaveFrom } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../auth";
import { quarantineNames, quarantineOrphans, storedImageName } from "../media";
import { appendAuditRow } from "../staff";
import { Refusal, UUID, authorityText, flag, freeText, instant, isoOf, refuse, rows } from "./orders";

/** The quarantine's commands and (Task 2) the release's, each with its first lines of STAFF_USAGE. */
export const CUSTODY_COMMANDS = ["quarantine-list", "quarantine-record", "release-leave", "release-show", "release-replay"] as const;
export type CustodyCommandName = (typeof CUSTODY_COMMANDS)[number];

export const CUSTODY_USAGE = [
  `${"  quarantine-list".padEnd(41)}print the files of sealed images to move into the quarantine, to return, to destroy or for`,
  `${"".padEnd(41)}the operator, one line a file, for the quarantine service; read-only; run it in the migrate service`,
  `${"  quarantine-record < receipt".padEnd(41)}record the quarantine service's receipt line by line, whatever the plan says now, with`,
  `${"".padEnd(41)}one audit row; run it in the migrate service (the README, Quarantine)`,
  `${"  release-leave <seal> --by <authority|court>".padEnd(41)}record a leave or an instruction to destroy a seal's files, from the paper: --reference <text>`,
  `${"".padEnd(41)}--day <yyyy-mm-dd> --operator <name> [--untold [--until <instant>]] [--gap <gap>]; --end-untold <leave>`,
  `${"".padEnd(41)}[--until <instant>] ends an open hold on telling; --withdraw <leave> --operator <name> [--gap <gap>]`,
  `${"".padEnd(41)}withdraws one recorded by mistake; run it in the migrate service (the README, A release)`,
  `${"  release-show <release>".padEnd(41)}print a release's record: its ground, its leave, each destroyed file with its digest, the`,
  `${"".padEnd(41)}author's notice and the day after which no backup deleted on time holds the files; read-only`,
  `${"  release-replay < <the keeper's files>".padEnd(41)}after restore-import: replay each release a gap names; run it in the migrate service`,
];

/** A custody command's words: its positional words and its flags (a flag may not repeat; --untold takes no value). */
export type CustodyCommand = { command: CustodyCommandName; positional: string[]; flags: Map<string, string[]> };

/** Flags of the release's commands that take no value. */
const CUSTODY_SWITCHES = new Set(["--untold"]);

/**
 * Reads a custody command's words. quarantine-list, quarantine-record and release-replay take no argument (a receipt and
 * the keeper's files come on standard input); release-show takes the release's id; release-leave its target and flags.
 */
export function parseCustodyArgs(command: CustodyCommandName, rest: readonly string[]): CustodyCommand {
  if (command === "quarantine-list" || command === "quarantine-record" || command === "release-replay") {
    if (rest.length > 0) throw new Error(`${command}: takes no argument${command === "quarantine-list" ? "" : command === "quarantine-record" ? "; the receipt comes on standard input" : "; the keeper's files come on standard input"}`);
    return { command, positional: [], flags: new Map() };
  }
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!;
    if (word.startsWith("--")) {
      if (CUSTODY_SWITCHES.has(word)) {
        flags.set(word, [...(flags.get(word) ?? []), ""]);
        continue;
      }
      const value = rest[i + 1];
      if (value === undefined) throw new Error(`${command}: ${word} needs a value`);
      flags.set(word, [...(flags.get(word) ?? []), value]);
      i++;
    } else positional.push(word);
  }
  if (command === "release-show" && (positional.length !== 1 || flags.size > 0)) throw new Error("release-show: name the release by its id, and nothing else");
  return { command, positional, flags };
}

/** What a custody command answers: its lines for standard output and its notes for standard error, and whether it exits 1 after doing its work. */
export type CustodyDone = { ok: true; lines: string[]; notes: string[]; failed: boolean } | { ok: false; problem: string };

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SHA256 = /^[0-9a-f]{64}$/;
/** A file's size as the mover prints it: a whole number of bytes over zero, in digits alone. */
const BYTES = /^[1-9][0-9]{0,15}$/;

/** The order the list prints its directions in, as quarantine_plan() names them. */
const DIRECTION_ORDER: readonly QuarantineDirection[] = QUARANTINE_DIRECTIONS;

/**
 * quarantine-list on the migrator's own connection: one read-only transaction at one snapshot, with the command line's
 * 10-second lock timeout. The lines go to standard output, as the mover reads them; the count and the posts left out to
 * standard error.
 */
async function quarantineList(tx: DbTx): Promise<{ lines: string[]; notes: string[]; failed: boolean }> {
  const { lines, mismatched } = await quarantineNames(tx);
  const sorted = [...lines].sort((a, b) => DIRECTION_ORDER.indexOf(a.direction) - DIRECTION_ORDER.indexOf(b.direction) || (a.mediaId < b.mediaId ? -1 : a.mediaId > b.mediaId ? 1 : 0));
  const out = sorted.flatMap((line) => line.files.map((file) => `${line.direction} ${line.mediaId} ${file}`));
  const count = (direction: QuarantineDirection) => sorted.filter((line) => line.direction === direction).reduce((n, line) => n + line.files.length, 0);
  const notes = [
    out.length === 0
      ? "quarantine-list: nothing is due."
      : `quarantine-list: ${count("in")} files to move in, ${count("out")} to return, ${count("destroy")} to destroy, ${count("operator")} for the operator.`,
    ...mismatched.map((post) => `quarantine-list: post ${post.postId}: its image rows do not match its seal; left out`),
  ];
  // 3d Task 2 (section 8.10): the report of a file the quarantine holds for an image whose row is gone and that no release
  // accounts for. text-verify reads on the API's role, which holds no right on quarantine_files (row 14), so this list,
  // which reads the quarantine's rows as the migrator, names them; they are destroy lines above all the same.
  const orphans = await quarantineOrphans(tx);
  if (orphans.length > 0) {
    notes.push(`quarantine-list: ${orphans.length} images in the quarantine have no image row and no release; their destroy lines are in the list.`);
    for (const orphan of orphans) notes.push(`quarantine-list: image ${orphan.mediaId}${orphan.postId === null ? "" : ` of post ${orphan.postId}`} is in the quarantine without an image row or a release`);
  }
  return { lines: out, notes, failed: mismatched.length > 0 };
}

/** One receipt line, as the mover prints it. */
type ReceiptLine =
  | { kind: "moved"; direction: "in" | "out"; mediaId: string; file: string; bytes: number; sha256: string }
  | { kind: "gone"; direction: "in" | "out"; mediaId: string; file: string; word: "missing" | "lost" | "refused" }
  | { kind: "destroyed"; mediaId: string; file: string; bytes: number | null; sha256: string | null }
  | { kind: "destroy_refused"; mediaId: string; file: string }
  | { kind: "have"; mediaId: string; file: string; bytes: number; sha256: string };

/** A file's name as one of its image's two under the store's naming rule, or false. */
const isFileOf = (mediaId: string, file: string) => MEDIA_SIZES.some((size) => storedImageName(mediaId, size) === file);

/** Reads one line of a receipt, or null when it is not one: malformed, or naming a file that is not one of its image's two. */
function parseReceiptLine(line: string): ReceiptLine | null {
  const f = line.split(" ");
  const [first, mediaId, file] = f;
  if (mediaId === undefined || file === undefined || !UUID.test(mediaId) || !isFileOf(mediaId, file)) return null;
  const digest = (bytes: string | undefined, sha: string | undefined) => (bytes !== undefined && sha !== undefined && BYTES.test(bytes) && SHA256.test(sha) ? { bytes: Number(bytes), sha256: sha } : null);
  if (first === QUARANTINE_WORDS.have) {
    const d = f.length === 5 ? digest(f[3], f[4]) : null;
    return d ? { kind: "have", mediaId, file, ...d } : null;
  }
  if (first === "in" || first === "out") {
    if (f.length === 4 && (f[3] === "missing" || f[3] === "lost" || f[3] === "refused")) return { kind: "gone", direction: first, mediaId, file, word: f[3] };
    const d = f.length === 6 && (f[5] === "done" || f[5] === "already") ? digest(f[3], f[4]) : null;
    return d ? { kind: "moved", direction: first, mediaId, file, ...d } : null;
  }
  if (first === "destroy") {
    if (f.length === 4 && f[3] === "already") return { kind: "destroyed", mediaId, file, bytes: null, sha256: null };
    if (f.length === 4 && f[3] === "refused") return { kind: "destroy_refused", mediaId, file };
    const d = f.length === 6 && (f[5] === "quarantine" || f[5] === "store" || f[5] === "both") ? digest(f[3], f[4]) : null;
    return d ? { kind: "destroyed", mediaId, file, ...d } : null;
  }
  return null;
}

/** A file's row of quarantine_files, as the record reads it under its lock. */
interface FileRow {
  sha256: string | null;
  returned: boolean;
  destroyed: boolean;
  lost: boolean;
}

/** What a record counted, the audit row's metadata but the receipt's digest. */
interface RecordCounts {
  in: number;
  out: number;
  destroyed: number;
  mismatched: number;
  lost: number;
  found: number;
  againstPlan: number;
  reported: number;
}

/**
 * quarantine-record on the migrator's own connection, in one transaction with the command line's 10-second lock timeout,
 * which takes quarantine_files in SHARE ROW EXCLUSIVE mode first, so two records never interleave. The plan is computed
 * once, before any line is written; each line reads its file's row FOR UPDATE and writes what the line says, through the
 * table's triggers, which force every time, the post, the mark `unknown` and the stored digest. Then, for a lost file, the
 * alert quarantine_lost to every staff account, and last the audit row quarantine_recorded.
 */
async function quarantineRecord(tx: DbTx, receipt: Buffer): Promise<{ lines: string[]; notes: string[]; failed: boolean }> {
  const text = receipt.toString("utf8");
  const lines = text.split(LF).map((line) => (line.endsWith(CR) ? line.slice(0, -1) : line));
  if (lines.every((line) => line.trim() === "")) refuse("quarantine-record", "the receipt holds no line; give the quarantine service's receipt on standard input");
  await tx.execute(sql`lock table public.quarantine_files in share row exclusive mode`);
  const plan = new Set(
    (await rows<{ direction: string; media_id: string }>(tx, sql`select p.direction, p.media_id from public.quarantine_plan() p`)).map((row) => `${row.direction} ${row.media_id}`),
  );
  const counts: RecordCounts = { in: 0, out: 0, destroyed: 0, mismatched: 0, lost: 0, found: 0, againstPlan: 0, reported: 0 };
  const notes: string[] = [];
  const report = (n: number, why: string) => {
    counts.reported++;
    notes.push(`quarantine-record: line ${n}: ${why}`);
  };

  const rowOf = async (mediaId: string, file: string): Promise<FileRow | null> => {
    const [row] = await rows<FileRow & Record<string, unknown>>(
      tx,
      sql`select q.sha256, q.returned_at is not null as returned, q.destroyed_at is not null as destroyed, q.lost_at is not null as lost
            from public.quarantine_files q where q.media_id = ${mediaId}::uuid and q.file = ${file} for update`,
    );
    return row ? { sha256: row.sha256, returned: row.returned, destroyed: row.destroyed, lost: row.lost } : null;
  };
  const where = (mediaId: string, file: string) => sql`media_id = ${mediaId}::uuid and file = ${file}`;
  /** A digest that is not the one stored: reported and counted; the stored digest stays, since the files of an id never change. */
  const checkDigest = (n: number, row: FileRow | null, file: string, sha256: string | null) => {
    if (row?.sha256 && sha256 && row.sha256 !== sha256) {
      counts.mismatched++;
      report(n, `${file} has another digest than the one recorded when it was moved; the recorded digest stays`);
    }
  };
  /** A line that wrote something although the plan did not list it so: reported, and the next list moves it back. */
  const fits = (n: number, direction: string, mediaId: string) => {
    if (plan.has(`${direction} ${mediaId}`)) return;
    counts.againstPlan++;
    report(n, `image ${mediaId} no longer fits the plan; recorded where the file is, and the next list moves it back`);
  };

  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    const n = index + 1;
    const parsed = parseReceiptLine(line);
    if (parsed === null) {
      counts.reported++;
      notes.push(`quarantine-record: line ${n} is not a receipt line; skipped`);
      continue;
    }
    const { mediaId, file } = parsed;
    // Each line in a savepoint of its own: a line the database refuses is reported and leaves the others recorded.
    try {
      await tx.transaction(async (sp) => {
        const row = await rowOf(mediaId, file);
        switch (parsed.kind) {
          case "moved":
            if (parsed.direction === "in") {
              // The file is in the quarantine: a new row, a returned row moved again, or a lost row found.
              if (row === null) {
                await sp.execute(sql`insert into public.quarantine_files (media_id, file, size, sha256) values (${mediaId}::uuid, ${file}, ${parsed.bytes}, ${parsed.sha256})`);
              } else if (row.destroyed) {
                report(n, `${file} is recorded as destroyed and is in the quarantine again; nothing recorded: destroy it again by hand and note it`);
                return;
              } else if (row.returned || row.lost) {
                await sp.execute(sql`update public.quarantine_files set returned_at = null, lost_at = null, size = ${parsed.bytes}, sha256 = ${parsed.sha256} where ${where(mediaId, file)}`);
                if (row.lost) report(n, `${file} was recorded as lost and is in the quarantine; recorded where it is`);
              } else {
                checkDigest(n, row, file, parsed.sha256);
                return;
              }
              checkDigest(n, row, file, parsed.sha256);
              counts.in++;
              fits(n, "in", mediaId);
            } else {
              // The file is in the store again: its row's return.
              if (row === null) {
                report(n, `${file} has no record in the quarantine; nothing to record`);
                return;
              }
              if (row.destroyed) {
                report(n, `${file} is recorded as destroyed and is in the image store; nothing recorded: destroy it again by hand and note it`);
                return;
              }
              if (row.returned) return;
              // A row written as lost before any move takes the digest the line gives; the trigger keeps one stored before.
              await sp.execute(sql`update public.quarantine_files set lost_at = null, returned_at = now(), size = ${parsed.bytes}, sha256 = ${parsed.sha256} where ${where(mediaId, file)}`);
              if (row.lost) report(n, `${file} was recorded as lost and is in the image store; recorded as returned`);
              checkDigest(n, row, file, parsed.sha256);
              counts.out++;
              fits(n, "out", mediaId);
            }
            return;
          case "gone":
            if (parsed.word === "refused") {
              report(n, `the quarantine service refused ${file}; nothing recorded`);
              return;
            }
            if (parsed.word === "missing") {
              report(n, `${file} is missing in both places; nothing recorded (see the README, Quarantine, step 5)`);
              return;
            }
            // lost: a file found in neither place, on a run with --lost, which only a person starts.
            if (row?.destroyed) {
              report(n, `${file} is recorded as destroyed; nothing recorded`);
              return;
            }
            if (row?.lost) return;
            if (row === null) await sp.execute(sql`insert into public.quarantine_files (media_id, file, lost_at) values (${mediaId}::uuid, ${file}, now())`);
            else await sp.execute(sql`update public.quarantine_files set returned_at = null, lost_at = now() where ${where(mediaId, file)}`);
            counts.lost++;
            fits(n, parsed.direction, mediaId);
            return;
          case "destroyed":
            if (row === null) {
              report(n, `${file} has no record in the quarantine; nothing recorded`);
              return;
            }
            if (row.destroyed) return;
            if (row.lost) {
              report(n, `${file} is recorded as lost; nothing recorded`);
              return;
            }
            // Task 2 (section 6.2): a released file's row takes the release's id, from its post's mark.
            await sp.execute(sql`
              update public.quarantine_files q set returned_at = null, destroyed_at = now(),
                     release_id = (select r.release_id from public.release_posts r where r.post_id = q.post_id)
               where ${where(mediaId, file)}`);
            checkDigest(n, row, file, parsed.sha256);
            counts.destroyed++;
            fits(n, "destroy", mediaId);
            return;
          case "destroy_refused":
            report(n, `the quarantine service refused to destroy ${file}; nothing recorded`);
            return;
          case "have":
            // The file is in the quarantine: an inventory's line. A file without a row gets its row, as a move in that
            // nobody recorded; for an image the database does not know, the trigger marks it unknown (the operator's).
            if (row === null) {
              await sp.execute(sql`insert into public.quarantine_files (media_id, file, size, sha256) values (${mediaId}::uuid, ${file}, ${parsed.bytes}, ${parsed.sha256})`);
              counts.found++;
              report(n, `${file} was found in the quarantine without a record; recorded`);
              return;
            }
            if (row.destroyed) {
              report(n, `${file} is recorded as destroyed and is in the quarantine again; nothing recorded: destroy it again by hand and note it`);
              return;
            }
            if (row.returned || row.lost) {
              await sp.execute(sql`update public.quarantine_files set returned_at = null, lost_at = null, size = ${parsed.bytes}, sha256 = ${parsed.sha256} where ${where(mediaId, file)}`);
              counts.found++;
              report(n, `${file} was recorded as ${row.returned ? "returned" : "lost"} and is in the quarantine; recorded where it is`);
            }
            checkDigest(n, row, file, parsed.sha256);
            return;
        }
      });
    } catch (err) {
      if (err instanceof Refusal) throw err;
      report(n, `the database refused it (${(err as Error).message}); nothing recorded`);
    }
  }

  if (counts.lost > 0) {
    // quarantine_lost (W.7): to every staff account, one row for the act, with counts and its time, never a file.
    await tx.execute(
      sql`insert into public.alert_outbox (kind, priority, scope, facts) values ('quarantine_lost', 3, 'all', jsonb_build_object('count', ${counts.lost}::int, 'at', public.alert_time(now())))`,
    );
  }
  const [due] = await rows<{ due: number }>(tx, sql`select (c.due_in + c.due_out)::int as due from public.quarantine_counts() c`);
  const receiptSha256 = createHash("sha256").update(receipt).digest("hex");
  await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "quarantine_recorded", targetType: null, targetId: null, requestId: null, metadata: { ...counts, receiptSha256 } });
  return {
    lines: [
      `quarantine-record: ${counts.in} files recorded as moved, ${counts.out} as returned, ${counts.destroyed} as destroyed, ${counts.lost} as lost, ${counts.found} found without a record. Still due: ${due!.due}.`,
    ],
    notes,
    failed: counts.reported > 0,
  };
}

// ---------------------------------------------------------------- the release (3d Task 2; sections 6.2, 7.2, 7.3 and 8.10)

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** A leave's row as the command reads it after its lock. */
interface LeaveRow {
  id: string;
  notification_id: string;
  leave_from: ReleaseLeaveFrom;
  reference: string;
  received_on: string;
  untold: boolean;
  untold_until: string | null;
  withdrawn: boolean;
}

/** The leave's row FOR UPDATE, then its members in a statement of their own, or null. */
async function lockLeave(tx: DbTx, leaveId: string): Promise<LeaveRow | null> {
  await tx.execute(sql`select 1 from public.release_leaves where id = ${leaveId}::uuid for update`);
  const [row] = await rows<LeaveRow>(
    tx,
    sql`select l.id, l.notification_id, l.leave_from, l.reference, to_char(l.received_on, 'YYYY-MM-DD') as received_on, l.untold,
               ${isoOf("l.untold_until")} as untold_until, l.withdrawn_at is not null as withdrawn
          from public.release_leaves l where l.id = ${leaveId}::uuid`,
  );
  return row ?? null;
}

/** A gap of the class release that a lost line of this action left, open, FOR UPDATE: its metadata, or a refusal. */
async function releaseGap(tx: DbTx, c: string, word: string, action: "release_leave_recorded" | "release_leave_withdrawn"): Promise<{ id: string; targetId: string | null; metadata: Record<string, unknown> }> {
  const gap = word.toLowerCase();
  const what = action === "release_leave_recorded" ? "a lost leave" : "a lost withdrawal of a leave";
  if (!UUID.test(gap)) return refuse(c, `gap ${word} is not an open gap of ${what}`);
  const [found] = await rows<{ id: string; target_id: string | null; metadata: Record<string, unknown> | null }>(
    tx,
    sql`select g.id, g.target_id, g.metadata from public.restore_gaps g
         where g.id = ${gap}::uuid and g.class = 'release' and g.action = ${action} and g.closed_at is null for update`,
  );
  if (found === undefined) return refuse(c, `gap ${gap} is not an open gap of ${what}`);
  return { id: found.id, targetId: found.target_id, metadata: found.metadata ?? {} };
}

/** How the person's telling stands, as release-leave prints it. */
function tellingOf(untold: boolean, until: string | null): string {
  if (!untold) return "may be told";
  return until === null ? "is not to be told, with no end recorded" : `is not to be told until ${until}`;
}

/** The leave's members as its audit rows hold them (10.5): every member, and the gap a restore left when one is closed. */
const leaveMembers = (leave: { id: string; from: string; reference: string; receivedOn: string; untold: boolean; untoldUntil: string | null }, gapId: string | null) => ({
  leaveId: leave.id,
  from: leave.from,
  reference: leave.reference,
  receivedOn: leave.receivedOn,
  untold: leave.untold,
  untoldUntil: leave.untoldUntil,
  ...(gapId === null ? {} : { gapId }),
});

/**
 * release-leave (sections 6.2, 7.2 and 8.10), as the migrator, in one transaction whose last statement is its audit row
 * under the system actor. Three forms, and the two changes a recorded leave ever takes:
 *   - <seal> --by <authority|court> --reference <text> --day <yyyy-mm-dd> --operator <name> [--untold [--until <instant>]]
 *     [--gap <gap>]: records, as a fact of its own, that an authority or a court gave korbat leave or an instruction to
 *     destroy the files of a seal for good in force, named by its ledger row. The leave is stored against 3f's record of
 *     the seal's report (seal_record, by seal_report's own rule) and refused while that record is not sent. With --gap it
 *     closes, in the same transaction, the gap a restore left for a lost leave, and records it under the id the lost line
 *     names, so a release replayed before it finds its leave. Audit row release_leave_recorded.
 *   - --end-untold <leave> [--until <instant>] [--gap <gap>]: ends an open hold on telling the person, at the instant given
 *     or now. Audit row release_leave_recorded, with every member as it now stands.
 *   - --withdraw <leave> --operator <name> [--gap <gap>]: withdraws a leave recorded by mistake; the guard of
 *     release_leaves forces the time and refuses it with leave_used once a release rests on the leave, since nothing takes a
 *     release back. Audit row release_leave_withdrawn.
 * The command records what the operator holds in writing and cannot check it; it changes no file, no seal and no hold,
 * and releases nothing: the release stays an admin's confirmed action, whose params name the leave by its id.
 */
async function releaseLeave(tx: DbTx, cmd: CustodyCommand): Promise<string[]> {
  const c = "release-leave";
  const gapWord = flag(cmd, "--gap", false);
  const withdraw = flag(cmd, "--withdraw", false);
  const endUntold = flag(cmd, "--end-untold", false);

  if (withdraw !== null) {
    if (cmd.positional.length > 0 || endUntold !== null || cmd.flags.has("--by") || cmd.flags.has("--reference") || cmd.flags.has("--day") || cmd.flags.has("--untold") || cmd.flags.has("--until")) {
      return refuse(c, "--withdraw takes the leave's id, --operator and, after a restore, --gap, and nothing else");
    }
    const operator = freeText(c, "--operator", flag(cmd, "--operator")!);
    const leaveId = withdraw.toLowerCase();
    if (!UUID.test(leaveId)) return refuse(c, `${withdraw} is not a leave's id`);
    const gap = gapWord === null ? null : await releaseGap(tx, c, gapWord, "release_leave_withdrawn");
    if (gap !== null && gap.metadata.leaveId !== leaveId) return refuse(c, `gap ${gap.id} is about another leave`);
    const leave = await lockLeave(tx, leaveId);
    if (leave === null) return refuse(c, `no leave has the id ${leaveId}`);
    if (leave.withdrawn) return refuse(c, `leave ${leaveId} is withdrawn already: nothing to do`);
    try {
      await tx.transaction((sp) => sp.execute(sql`update public.release_leaves set withdrawn_by = ${operator} where id = ${leaveId}::uuid`));
    } catch (err) {
      if (/leave_used/.test(String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message))) {
        throw new Refusal(`${c}: leave_used: a release already rests on leave ${leaveId}; nothing changed`);
      }
      throw err;
    }
    if (gap !== null) await tx.execute(sql`update public.restore_gaps set closed_at = now(), disposition = 'imported' where id = ${gap.id}::uuid`);
    await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "release_leave_withdrawn", targetType: "notification", targetId: leave.notification_id, requestId: null, metadata: { leaveId, ...(gap === null ? {} : { gapId: gap.id }) } });
    return [
      `${c}: leave ${leaveId} withdrawn. It supports no release, and the case shows none recorded. If there is a right leave, record it as a new one.`,
      ...(gap === null ? [] : [`${c}: gap ${gap.id} is closed: the withdrawal is recorded again.`]),
    ];
  }

  if (endUntold !== null) {
    if (cmd.positional.length > 0 || cmd.flags.has("--by") || cmd.flags.has("--reference") || cmd.flags.has("--day") || cmd.flags.has("--untold") || cmd.flags.has("--operator")) {
      return refuse(c, "--end-untold takes the leave's id, --until and, after a restore, --gap, and nothing else");
    }
    const leaveId = endUntold.toLowerCase();
    if (!UUID.test(leaveId)) return refuse(c, `${endUntold} is not a leave's id`);
    const untilWord = flag(cmd, "--until", false);
    const gap = gapWord === null ? null : await releaseGap(tx, c, gapWord, "release_leave_recorded");
    if (gap !== null && gap.metadata.leaveId !== leaveId) return refuse(c, `gap ${gap.id} is about another leave`);
    const leave = await lockLeave(tx, leaveId);
    if (leave === null) return refuse(c, `no leave has the id ${leaveId}`);
    if (leave.withdrawn) return refuse(c, `leave ${leaveId} is withdrawn`);
    if (!leave.untold || leave.untold_until !== null) return refuse(c, `leave ${leaveId} has no open hold on telling: nothing to do`);
    const [row] = await rows<{ until: string }>(
      tx,
      sql`update public.release_leaves set untold_until = coalesce(${untilWord === null ? null : instant(c, untilWord).toISOString()}::timestamptz, now())
           where id = ${leaveId}::uuid returning ${isoOf("untold_until")} as until`,
    );
    if (gap !== null) await tx.execute(sql`update public.restore_gaps set closed_at = now(), disposition = 'imported' where id = ${gap.id}::uuid`);
    const members = { id: leaveId, from: leave.leave_from, reference: leave.reference, receivedOn: leave.received_on, untold: true, untoldUntil: row!.until };
    await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "release_leave_recorded", targetType: "notification", targetId: leave.notification_id, requestId: null, metadata: leaveMembers(members, gap?.id ?? null) });
    return [`${c}: leave ${leaveId}: the person may be told from ${row!.until}.`, ...(gap === null ? [] : [`${c}: gap ${gap.id} is closed: the end is recorded again.`])];
  }

  // The first form: a leave recorded from the paper.
  if (cmd.positional.length !== 1) return refuse(c, "name the seal by its ledger row's id");
  const sealWord = cmd.positional[0]!;
  const sealId = sealWord.toLowerCase();
  if (!UUID.test(sealId)) return refuse(c, `${sealWord} is not a seal's ledger row`);
  const by = flag(cmd, "--by")!;
  if (!(RELEASE_LEAVE_FROM as readonly string[]).includes(by)) return refuse(c, `--by is ${RELEASE_LEAVE_FROM.join(" or ")}`);
  const reference = authorityText(c, "--reference", flag(cmd, "--reference")!);
  const day = flag(cmd, "--day")!;
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return refuse(c, `--day ${day} is not a day as yyyy-mm-dd`);
  const operator = freeText(c, "--operator", flag(cmd, "--operator")!);
  const untold = cmd.flags.has("--untold");
  const untilWord = flag(cmd, "--until", false);
  if (untilWord !== null && !untold) return refuse(c, "--until is given only with --untold, or with --end-untold");
  const until = untilWord === null ? null : instant(c, untilWord).toISOString();
  const [today] = await rows<{ day: string }>(tx, sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as day`);
  if (day > today!.day) return refuse(c, `--day ${day} is after today: a leave bears the day it was given`);

  const gap = gapWord === null ? null : await releaseGap(tx, c, gapWord, "release_leave_recorded");
  // The seal: a seal_media of a decision that is not interim, in force; and its record of a report, sent.
  const [seal] = await rows<{ record: string | null; state: string | null }>(
    tx,
    sql`select public.seal_record(f.id) as record, (select n.state from public.authority_notifications n where n.id = public.seal_record(f.id)) as state
          from public.measures_in_force f where f.id = ${sealId}::uuid and f.kind::text = 'seal_media' and f.decision_kind::text <> 'interim'`,
  );
  if (seal === undefined) return refuse(c, `${sealId} is not the ledger row of a seal for good in force`);
  if (seal.record === null || seal.state !== "sent") return refuse(c, `seal ${sealId} has no record of a report that was sent: record the report first (notification-sent)`);
  let leaveId: string | null = null;
  if (gap !== null) {
    // A lost leave is recorded again under the id its line names, on the record its line named.
    if (gap.targetId !== seal.record) return refuse(c, `gap ${gap.id} is about another record of a report than this seal's`);
    if (typeof gap.metadata.leaveId !== "string" || !UUID.test(gap.metadata.leaveId)) return refuse(c, `gap ${gap.id} names no leave`);
    leaveId = gap.metadata.leaveId;
    const [held] = await rows<{ id: string }>(tx, sql`select id from public.release_leaves where id = ${leaveId}::uuid`);
    if (held !== undefined) return refuse(c, `leave ${leaveId} is on record already: close the gap with --end-untold or --withdraw`);
  }
  const [row] = await rows<{ id: string }>(
    tx,
    sql`insert into public.release_leaves (id, notification_id, leave_from, reference, received_on, untold, untold_until, recorded_by)
        values (coalesce(${leaveId}::uuid, gen_random_uuid()), ${seal.record}::uuid, ${by}, ${reference}, ${day}::date, ${untold}, ${until}::timestamptz, ${operator})
        returning id`,
  );
  if (gap !== null) await tx.execute(sql`update public.restore_gaps set closed_at = now(), disposition = 'imported' where id = ${gap.id}::uuid`);
  const members = { id: row!.id, from: by, reference, receivedOn: day, untold, untoldUntil: until };
  await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "release_leave_recorded", targetType: "notification", targetId: seal.record, requestId: null, metadata: leaveMembers(members, gap?.id ?? null) });
  return [
    `${c}: leave ${row!.id} recorded for seal ${sealId}, on the record of its report: from ${by}, reference ${reference}, of ${day}; the person ${tellingOf(untold, until)}. An admin can now release it on the case.`,
    ...(gap === null ? [] : [`${c}: gap ${gap.id} is closed: the leave is recorded again.`]),
  ];
}

/** release-show <release> (sections 7.2 and 8.10), read-only: a release's record, line by line, never an authority's answer. */
async function releaseShow(tx: DbTx, cmd: CustodyCommand): Promise<string[]> {
  const c = "release-show";
  const word = cmd.positional[0]!;
  const id = word.toLowerCase();
  if (!UUID.test(id)) return refuse(c, `${word} is not a release's id`);
  const [r] = await rows<{
    basis: string;
    leave_id: string | null;
    their_reference: string | null;
    released_at: string;
    imported_at: string | null;
    replay_of: string | null;
    backups_clear_at: string;
    author_notice: string;
    author_notice_at: string | null;
    post_ids: string[];
    leave_from: string | null;
    received_on: string | null;
    images: number;
  }>(
    tx,
    sql`select r.basis, r.leave_id, r.their_reference, ${isoOf("r.released_at")} as released_at, ${isoOf("r.imported_at")} as imported_at, r.replay_of,
               ${isoOf("r.backups_clear_at")} as backups_clear_at, r.author_notice, ${isoOf("r.author_notice_at")} as author_notice_at, r.post_ids::text[] as post_ids,
               l.leave_from, to_char(l.received_on, 'YYYY-MM-DD') as received_on,
               coalesce((select sum(x.images) from (select max(s.images) as images from public.seal_posts s where s.post_id = any(r.post_ids) group by s.post_id) x), 0)::int as images
          from public.releases r left join public.release_leaves l on l.id = r.leave_id
         where r.id = ${id}::uuid`,
  );
  if (r === undefined) return refuse(c, `no release has the id ${id}`);
  const ground =
    r.basis === "leave"
      ? r.leave_from === null
        ? `ground leave, leave or instruction ${r.leave_id} (not on record again yet), reference ${r.their_reference}`
        : `ground leave, leave or instruction from ${r.leave_from}, reference ${r.their_reference}, of ${r.received_on}`
      : "ground period";
  const when = r.replay_of === null ? `released ${r.released_at}` : `replayed ${r.imported_at}, first released ${r.released_at}`;
  const files = await rows<{ file: string; size: number | null; sha256: string | null; destroyed_at: string | null; lost: boolean }>(
    tx,
    sql`select q.file, q.size::int as size, q.sha256, ${isoOf("q.destroyed_at")} as destroyed_at, q.lost_at is not null as lost
          from public.quarantine_files q where q.post_id = any(${`{${r.post_ids.join(",")}}`}::uuid[]) and not q.unknown
         order by q.destroyed_at nulls last, q.media_id, q.file`,
  );
  const destroyed = files.filter((file) => file.destroyed_at !== null);
  const notice =
    r.author_notice === "sent"
      ? `sent ${r.author_notice_at}`
      : r.author_notice === "pending"
        ? "pending"
        : r.author_notice === "held"
          ? "held: the person may not be told yet"
          : r.author_notice === "none"
            ? r.replay_of === null
              ? "not sent: the account is gone"
              : "not sent again: a replay, and no hold on telling stood"
            : `not sent: ${r.author_notice.replace("_", " ")}`;
  return [
    `${c}: release ${id}: ${ground}, ${when}.`,
    `${c}: posts ${r.post_ids.length}; image rows erased ${r.images}; files destroyed ${destroyed.length} of ${files.length}, lost ${files.filter((file) => file.lost).length}.`,
    ...destroyed.map((file) => `${c}: ${file.file} ${file.size ?? "-"} ${file.sha256 ?? "-"} ${file.destroyed_at}`),
    `${c}: no backup that is deleted on time holds these files after ${r.backups_clear_at}; a backup kept for an authority is destroyed by hand.`,
    `${c}: author's notice: ${notice}.`,
  ];
}

/**
 * release-replay < <the keeper's files> (sections 6.2, 7.3 and 8.10), as the migrator, after restore-import: for each
 * seal_released line of the files, release_replay with the release's id, the params' posts, ground, leave and reference,
 * and the line's time, in a transaction of its own that ends with the audit row release_replayed. The function answers
 * present for a release the restored database holds (a line below the restored head, or one replayed already) and refuses
 * a line that no open gap of the class release names (replay_no_gap): only what restore-import checked against the chain
 * is replayed, so the files need not be checked a second time. A refused line is reported, the others go on, and the run
 * exits 1. Idempotent.
 */
async function releaseReplay(migrateDb: Db, input: Buffer): Promise<{ lines: string[]; notes: string[]; failed: boolean }> {
  const c = "release-replay";
  const releases: { id: string; at: string; params: { postIds: string[]; basis: string; leaveId: string | null; theirReference: string | null } }[] = [];
  for (const text of input.toString("utf8").split(LF)) {
    const line = text.endsWith(CR) ? text.slice(0, -1) : text;
    if (line.trim() === "") continue;
    let parsed: AuditExportLine;
    try {
      parsed = AuditExportLine.parse(JSON.parse(line));
    } catch {
      return refuse(c, "standard input holds a line that is not a line of the keeper's files");
    }
    if (parsed.action !== "seal_released") continue;
    // A line carries its metadata as the canonical JSON text the chain hashed.
    let metadata: { params?: Record<string, unknown>; releaseId?: unknown } | null;
    try {
      metadata = JSON.parse(parsed.metadata) as { params?: Record<string, unknown>; releaseId?: unknown } | null;
    } catch {
      return refuse(c, `the seal_released line at place ${parsed.place} holds no release`);
    }
    const params = metadata?.params;
    if (typeof metadata?.releaseId !== "string" || !params || !Array.isArray(params.postIds)) return refuse(c, `the seal_released line at place ${parsed.place} holds no release`);
    releases.push({
      id: metadata.releaseId,
      at: parsed.at as string,
      params: { postIds: params.postIds as string[], basis: String(params.basis), leaveId: (params.leaveId as string | null) ?? null, theirReference: (params.theirReference as string | null) ?? null },
    });
  }
  const lines = [`${c}: ${releases.length} releases and 0 ends of a hold in the copy; ${0} already present.`];
  const notes: string[] = [];
  let present = 0;
  for (const release of releases) {
    try {
      const outcome = await migrateDb.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        const [row] = await rows<{ result: string }>(
          tx,
          sql`select public.release_replay(${release.id}::uuid, ${`{${release.params.postIds.join(",")}}`}::uuid[], ${release.params.basis}, ${release.params.leaveId}::uuid,
                                           ${release.params.theirReference}, ${release.at}::timestamptz) as result`,
        );
        if (row!.result === "present") return null;
        const [, posts, images] = row!.result.split(" ");
        const [replay] = await rows<{ id: string }>(tx, sql`select id from public.releases where replay_of = ${release.id}::uuid`);
        await appendAuditRow(tx, {
          actorId: SYSTEM_ACTOR_ID,
          action: "release_replayed",
          targetType: "release",
          targetId: replay!.id,
          requestId: null,
          metadata: { replayOf: release.id, posts: Number(posts), images: Number(images), upload: false },
        });
        return { posts: Number(posts), images: Number(images) };
      });
      if (outcome === null) present++;
      else lines.push(`${c}: release ${release.id} of ${release.at}: ${outcome.posts} posts marked released, ${outcome.images} image rows erased.`);
    } catch (err) {
      const message = String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message);
      if (!/replay_no_gap/.test(message)) throw err;
      notes.push(`${c}: release ${release.id}: replay_no_gap: no open gap of the class release names it with these facts; nothing changed for it`);
    }
  }
  lines[0] = `${c}: ${releases.length} releases and 0 ends of a hold in the copy; ${present} already present.`;
  lines.push(
    `${c}: run the Quarantine steps now, with an inventory first: the list's destroy lines name every released file that the restored store or the quarantine still holds, and its operator lines every file it cannot place.`,
  );
  return { lines, notes, failed: notes.length > 0 };
}

/** A custody command on the migrator's own connection. The receipt is read before any connection is used: nothing holds a lock while a pipe drains. */
export async function custodyCommand(migrateDb: Db, cmd: CustodyCommand, input: () => Promise<Buffer>): Promise<CustodyDone> {
  try {
    if (cmd.command === "quarantine-list") {
      const done = await migrateDb.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read, read only`);
        await tx.execute(sql`set local lock_timeout = '10s'`);
        return quarantineList(tx);
      });
      return { ok: true, ...done };
    }
    if (cmd.command === "release-leave" || cmd.command === "release-show") {
      const lines = await migrateDb.transaction(async (tx) => {
        if (cmd.command === "release-show") await tx.execute(sql`set transaction isolation level repeatable read, read only`);
        await tx.execute(sql`set local lock_timeout = '10s'`);
        return cmd.command === "release-leave" ? releaseLeave(tx, cmd) : releaseShow(tx, cmd);
      });
      return { ok: true, lines, notes: [], failed: false };
    }
    if (cmd.command === "release-replay") return { ok: true, ...(await releaseReplay(migrateDb, await input())) };
    const receipt = await input();
    const done = await migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      return quarantineRecord(tx, receipt);
    });
    return { ok: true, ...done };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, problem: err.message };
    throw err;
  }
}
