import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { HEAD_RULES, type HeadKind, type HeadWitness, type PublicHead } from "@korbat/contracts";
import type { KeeperMailResult, KeeperMessage } from "../auth";
import type { TransparencyRepo } from "./repo";
import type { WitnessAdapter } from "./witness";

/**
 * The audit head's daily value (3d design, sections 2 row 9, 6.5, 7.7 and 10.6; Task 5). Once a day after the dispatch
 * hour the transparency job inserts the day's row of head_publications, whose insert trigger forces the day, the place
 * and the value from audit_head, so the API's role cannot publish a value of its own making; asks the witness for a token
 * while one is on; sets published_at from null; and mails the keeper, once, from the round whose update published it,
 * the day, the value, the place and the hash, from which the keeper computes the value again. A later round of the same
 * day asks the witness again while the token is null. The day's first round alerts head_missed when the day before has
 * no published value. The publication writes no audit row: it would move the head it publishes (section 15, 3a).
 */

/** The line feed between the digest's four parts. */
const LF = String.fromCharCode(10);

/**
 * head_value() of the database, in the API's own code: the hex SHA-256 of the tag, the day (yyyy-mm-dd, UTC), the place
 * in decimal and the hash, each after a line feed. What the keeper computes from the mail; a test holds the two equal.
 */
export function headValue(day: string, seq: number, hash: string): string {
  return createHash("sha256").update([HEAD_RULES.tag, day, String(seq), hash].join(LF), "utf8").digest("hex");
}

/** The day's head row as the job reads it after its insert. */
export interface HeadToday {
  /** Whether this round's insert wrote it. */
  inserted: boolean;
  day: string;
  value: string;
  witness: HeadWitness;
  witnessed: boolean;
  published: boolean;
}

/** One published row as the public route reads it: never its place. */
export interface HeadDayRow {
  day: string;
  kind: HeadKind;
  value: string;
  witness: HeadWitness;
  token: Uint8Array | null;
  retiredOn: string | null;
  lastDay: string | null;
}

/** The statements of the head's day, which repo.ts writes. */
export type HeadRepo = Pick<TransparencyRepo, "headInsert" | "headWitnessed" | "headPublish" | "headPlace" | "headMissed" | "headAlert">;

/** What one round's pass did with the day's value. */
export interface HeadPass {
  /** The database's UTC day, whose row the pass read. */
  day: string;
  inserted: boolean;
  /** stored: a token came this round; unanswered: the witness was asked and gave none; null: nobody was asked. */
  witnessed: "stored" | "unanswered" | null;
  /** Whether this round's update published the value. */
  published: boolean;
  /** The keeper's mail, from the round that published: as mailKeeper answered, or unverified when no hash gave the value. */
  mailed: KeeperMailResult | "unverified" | null;
  /** The alerts this round wrote (each under F's daily rule, so a second in 24 hours is not written). */
  alerts: ("head_unwitnessed" | "head_missed")[];
  /** Nothing more to do today: published, and witnessed or never to be. */
  done: boolean;
}

export interface HeadDeps {
  repo: HeadRepo;
  witness: WitnessAdapter;
  /** The auth module's mail to HEAD_KEEPER_MAIL, which answers "off" while the setting is empty. */
  mailKeeper: (message: KeeperMessage) => Promise<KeeperMailResult>;
  log: Logger;
}

/** One round's pass over the day's value (7.7 steps 2 to 6). */
export async function publishHead(deps: HeadDeps, options: { firstOfDay: boolean }): Promise<HeadPass> {
  const { repo, witness, log } = deps;
  const alerts: HeadPass["alerts"] = [];
  // 2. The row: the trigger forces everything but the witness's name; a day holds one head row.
  const today = await repo.headInsert(witness.name);
  // 6. A missed day: the day before has no published value, while an earlier day has one (the head's first day misses
  // nothing). A missed day is never written afterwards: the page shows the hole.
  if (options.firstOfDay) {
    const missed = await repo.headMissed();
    if (missed !== null && (await repo.headAlert("head_missed", missed))) alerts.push("head_missed");
  }
  // 3. The witness, while one is on and the row was born under it: a row named none was asked of nobody, and the CHECK
  // keeps a token off it. Asked again in each round while the token is null; a later token proves the value from then on.
  let witnessed: HeadPass["witnessed"] = null;
  let hasToken = today.witnessed;
  if (witness.mode !== "off" && today.witness === witness.name && !today.witnessed) {
    const token = await witness.witness(today.value);
    if (token !== null) {
      // Set from null alone: the update finds nothing when the row has its token already.
      await repo.headWitnessed(today.day, token);
      witnessed = "stored";
      hasToken = true;
    } else {
      witnessed = "unanswered";
      if (await repo.headAlert("head_unwitnessed", today.day)) alerts.push("head_unwitnessed");
      log.warn({ job: "transparency", day: today.day }, "transparency: the head's witness gave no token; the value is published without one");
    }
  }
  // 4. Published, from null, once.
  let published = false;
  let mailed: HeadPass["mailed"] = null;
  if (!today.published) {
    const set = await repo.headPublish(today.day);
    if (set !== null) {
      published = true;
      // 5. The keeper's mail, from this round alone. The place's hash is read again and must give the stored value, so the
      // keeper is never sent a place and a hash that do not check.
      const place = await repo.headPlace(today.day);
      if (place === null) {
        mailed = "unverified";
        log.error({ job: "transparency", day: today.day }, "transparency: no hash of the audit log gives the head's stored value; the keeper is not mailed");
      } else {
        mailed = await deps.mailKeeper({ template: "head_published", day: today.day, value: today.value, seq: place.seq, hash: place.hash, witnessed: set.witnessed });
      }
      log.info({ job: "transparency", day: today.day, mailed }, "transparency: the head's daily value was published");
    }
  }
  const unwitnessable = witness.mode === "off" || today.witness !== witness.name;
  return { day: today.day, inserted: today.inserted, witnessed, published, mailed, alerts, done: (today.published || published) && (unwitnessable || hasToken) };
}

/** A token as the public answer carries it. */
const base64 = (token: Uint8Array) => Buffer.from(token).toString("base64");

/**
 * GET /api/public/head's answer (10.6): the rows as the route read them, newest first, a row without a token read as
 * witnessed by nobody whatever was asked, the token as base64. It holds no place and no hash.
 */
export function publicHead(rows: readonly HeadDayRow[]): PublicHead {
  return {
    days: rows.map((row) => ({
      day: row.day,
      kind: row.kind,
      value: row.value,
      witness: row.token === null ? "none" : row.witness,
      token: row.token === null ? null : base64(row.token),
      retiredOn: row.retiredOn,
      lastDay: row.lastDay,
    })),
  };
}
