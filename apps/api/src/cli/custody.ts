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
import { MEDIA_SIZES, QUARANTINE_DIRECTIONS, QUARANTINE_WORDS, type QuarantineDirection } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../auth";
import { quarantineNames, storedImageName } from "../media";
import { appendAuditRow } from "../staff";
import { Refusal, UUID, refuse, rows } from "./orders";

/** The quarantine's commands, each with its first lines of STAFF_USAGE. */
export const CUSTODY_COMMANDS = ["quarantine-list", "quarantine-record"] as const;
export type CustodyCommandName = (typeof CUSTODY_COMMANDS)[number];

export const CUSTODY_USAGE = [
  `${"  quarantine-list".padEnd(41)}print the files of sealed images to move into the quarantine, to return, to destroy or for`,
  `${"".padEnd(41)}the operator, one line a file, for the quarantine service; read-only; run it in the migrate service`,
  `${"  quarantine-record < receipt".padEnd(41)}record the quarantine service's receipt line by line, whatever the plan says now, with`,
  `${"".padEnd(41)}one audit row; run it in the migrate service (the README, Quarantine)`,
];

export type CustodyCommand = { command: CustodyCommandName };

/** Reads a custody command's words: neither takes an argument; the receipt comes on standard input. */
export function parseCustodyArgs(command: CustodyCommandName, rest: readonly string[]): CustodyCommand {
  if (rest.length > 0) throw new Error(`${command}: takes no argument${command === "quarantine-record" ? "; the receipt comes on standard input" : ""}`);
  return { command };
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
            await sp.execute(sql`update public.quarantine_files set returned_at = null, destroyed_at = now() where ${where(mediaId, file)}`);
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
