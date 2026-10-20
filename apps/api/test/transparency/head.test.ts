import pino from "pino";
import { describe, expect, test } from "vitest";
import { HEAD_RULES, PublicHead, type HeadWitness } from "@korbat/contracts";
import type { KeeperMailResult, KeeperMessage } from "../../src/auth";
import { headValue, publicHead, publishHead, type HeadDayRow, type HeadRepo, type HeadToday } from "../../src/transparency/head";
import { TEST_TOKEN, witnessFrom, type WitnessAdapter } from "../../src/transparency/witness";

/**
 * The audit head's daily value (3d design, sections 2 row 9, 7.7 and 10.6; 12.1 row 24; Task 5), without a database: the
 * digest over the tag, the day, the place and the hash, held to vectors that openssl computed; the public answer, which
 * never holds the place; and one day's pass of the job over a stand-in of its statements: the insert, the witness, the
 * publication from null, the keeper's mail once from the round that published, the later rounds that ask the witness
 * again while the token is null, and the two alerts.
 */
const VALUE = "917907fc36f065a78e0b730230eac9c4f1c2882c77efc7a868a65ee336e0899e";

describe("headValue", () => {
  test("the hex SHA-256 of korbat.head.v2, the day, the place and the hash, each after a line feed, as openssl computes it", () => {
    // printf 'korbat.head.v2<LF>2026-10-18<LF>42<LF><hash>' | openssl dgst -sha256 (OpenSSL 3.5.4), and the same for an empty log.
    expect(headValue("2026-10-18", 42, "24cc975360df565521f1acca5b67f924d33ca0a0999355f667c4c289b1632fe1")).toBe(VALUE);
    expect(headValue("2026-10-19", 0, "0".repeat(64))).toBe("a216ea784e796bfbc28daf1df377d1e3db66e48ec1c710674fd01cb236e10b56");
    expect(HEAD_RULES.tag).toBe("korbat.head.v2");
  });

  test("two days without a new audit row give two values, and neither shows the place or the hash", () => {
    const hash = "24cc975360df565521f1acca5b67f924d33ca0a0999355f667c4c289b1632fe1";
    const saturday = headValue("2026-10-17", 42, hash);
    const sunday = headValue("2026-10-18", 42, hash);
    expect(saturday).not.toBe(sunday);
    for (const value of [saturday, sunday]) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(value).not.toContain(hash.slice(0, 8));
    }
  });
});

describe("publicHead: GET /api/public/head's answer", () => {
  const row = (over: Partial<HeadDayRow> = {}): HeadDayRow => ({ day: "2026-10-18", kind: "head", value: VALUE, witness: "rfc3161", token: Buffer.from("3003020100", "hex"), retiredOn: null, lastDay: null, ...over });

  test("each row's day, kind, value, witness, token as base64, the day it was retired and a restore's last day; never the place", () => {
    const answer = publicHead([row(), row({ day: "2026-10-17", witness: "rfc3161", token: null }), row({ day: "2026-10-16", kind: "restore", witness: "none", token: null, lastDay: "2026-10-12" }), row({ day: "2026-10-15", witness: "none", token: null, retiredOn: "2026-10-16" })]);
    expect(PublicHead.parse(answer)).toEqual(answer);
    expect(answer.days).toEqual([
      { day: "2026-10-18", kind: "head", value: VALUE, witness: "rfc3161", token: "MAMCAQA=", retiredOn: null, lastDay: null },
      // A witness that was asked and did not answer reads none: the row is witnessed by nobody.
      { day: "2026-10-17", kind: "head", value: VALUE, witness: "none", token: null, retiredOn: null, lastDay: null },
      { day: "2026-10-16", kind: "restore", value: VALUE, witness: "none", token: null, retiredOn: null, lastDay: "2026-10-12" },
      { day: "2026-10-15", kind: "head", value: VALUE, witness: "none", token: null, retiredOn: "2026-10-16", lastDay: null },
    ]);
    expect(JSON.stringify(answer)).not.toMatch(/chainSeq|seq|hash|place/);
  });
});

/** A stand-in of the job's statements over one day's rows, as the database would answer them. */
function fakeRepo(options: { missed?: string | null; place?: { seq: number; hash: string } | null } = {}) {
  const state = {
    row: null as null | { value: string; witness: HeadWitness; token: Uint8Array | null; published: boolean },
    alerts: [] as { kind: string; day: string }[],
    calls: [] as string[],
  };
  const DAY = "2026-10-18";
  const today = (inserted: boolean): HeadToday => ({ inserted, day: DAY, value: state.row!.value, witness: state.row!.witness, witnessed: state.row!.token !== null, published: state.row!.published });
  const repo: HeadRepo = {
    async headInsert(witness) {
      state.calls.push("insert");
      if (state.row) return today(false);
      state.row = { value: VALUE, witness, token: null, published: false };
      return today(true);
    },
    async headWitnessed(day, token) {
      state.calls.push("witnessed");
      expect(day).toBe(DAY);
      if (state.row!.token !== null) return false;
      state.row!.token = token;
      return true;
    },
    async headPublish(day) {
      state.calls.push("publish");
      expect(day).toBe(DAY);
      if (state.row!.published) return null;
      state.row!.published = true;
      return { witnessed: state.row!.token !== null };
    },
    async headPlace() {
      state.calls.push("place");
      return options.place === undefined ? { seq: 42, hash: "24cc975360df565521f1acca5b67f924d33ca0a0999355f667c4c289b1632fe1" } : options.place;
    },
    async headMissed() {
      state.calls.push("missed");
      return options.missed ?? null;
    },
    async headAlert(kind, day) {
      // F's daily rule: one row of a kind in 24 hours.
      if (state.alerts.some((alert) => alert.kind === kind)) return false;
      state.alerts.push({ kind, day });
      return true;
    },
  };
  return { repo, state };
}

/** A witness that answers as the test says, counting its calls. */
function scripted(answers: (Uint8Array | null)[]): WitnessAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    mode: "rfc3161",
    name: "rfc3161",
    calls,
    async witness(value) {
      calls.push(value);
      return answers.shift() ?? null;
    },
  };
}

/** The keeper's mail as the auth module's mailKeeper is given it: recorded, and answered as it would. */
function keeper(result: KeeperMailResult = "sent") {
  const sent: KeeperMessage[] = [];
  return { sent, mailKeeper: async (message: KeeperMessage) => (sent.push(message), result) };
}

const log = pino({ level: "silent" });

describe("one day's pass of the head (7.7)", () => {
  test("witness off: the row named none, published, and the keeper mailed once with the day, the value, the place and the hash; a later round changes nothing", async () => {
    const { repo, state } = fakeRepo();
    const mail = keeper();
    const witness = witnessFrom({ HEAD_WITNESS: "off", APP_SITE: "open" });
    const first = await publishHead({ repo, witness, mailKeeper: mail.mailKeeper, log }, { firstOfDay: true });
    expect(first).toEqual({ day: "2026-10-18", inserted: true, witnessed: null, published: true, mailed: "sent", alerts: [], done: true });
    expect(state.row).toMatchObject({ witness: "none", token: null, published: true });
    expect(mail.sent).toEqual([{ template: "head_published", day: "2026-10-18", value: VALUE, seq: 42, hash: "24cc975360df565521f1acca5b67f924d33ca0a0999355f667c4c289b1632fe1", witnessed: false }]);
    const again = await publishHead({ repo, witness, mailKeeper: mail.mailKeeper, log }, { firstOfDay: false });
    expect(again).toEqual({ day: "2026-10-18", inserted: false, witnessed: null, published: false, mailed: null, alerts: [], done: true });
    expect(mail.sent).toHaveLength(1);
  });

  test("the test witness: its token stored before the value is published, and the keeper's mail says a timestamp is stored", async () => {
    const { repo, state } = fakeRepo();
    const mail = keeper();
    const witness = witnessFrom({ HEAD_WITNESS: "test", APP_SITE: "closed" });
    const pass = await publishHead({ repo, witness, mailKeeper: mail.mailKeeper, log }, { firstOfDay: true });
    expect(pass).toMatchObject({ inserted: true, witnessed: "stored", published: true, mailed: "sent", alerts: [], done: true });
    expect(Buffer.from(state.row!.token!).equals(Buffer.from(TEST_TOKEN))).toBe(true);
    expect(state.calls).toEqual(["insert", "missed", "witnessed", "publish", "place"]);
    expect(mail.sent[0]).toMatchObject({ witnessed: true });
  });

  test("a witness that does not answer: published without a token, head_unwitnessed once; a later round asks again and a later token is stored, the mail not sent twice", async () => {
    const { repo, state } = fakeRepo();
    const mail = keeper();
    const witness = scripted([null, null, Buffer.from("300a3003020100300302010a", "hex")]);
    const first = await publishHead({ repo, witness, mailKeeper: mail.mailKeeper, log }, { firstOfDay: true });
    expect(first).toMatchObject({ witnessed: "unanswered", published: true, mailed: "sent", alerts: ["head_unwitnessed"], done: false });
    expect(state.alerts).toEqual([{ kind: "head_unwitnessed", day: "2026-10-18" }]);
    expect(mail.sent).toEqual([expect.objectContaining({ witnessed: false })]);
    const second = await publishHead({ repo, witness, mailKeeper: mail.mailKeeper, log }, { firstOfDay: false });
    expect(second).toMatchObject({ witnessed: "unanswered", published: false, mailed: null, alerts: [], done: false });
    const third = await publishHead({ repo, witness, mailKeeper: mail.mailKeeper, log }, { firstOfDay: false });
    expect(third).toMatchObject({ witnessed: "stored", published: false, mailed: null, alerts: [], done: true });
    expect(witness.calls).toEqual([VALUE, VALUE, VALUE]);
    expect(state.row!.token).not.toBeNull();
    expect(mail.sent).toHaveLength(1);
    // Once the token is stored nothing is asked again.
    await publishHead({ repo, witness, mailKeeper: mail.mailKeeper, log }, { firstOfDay: false });
    expect(witness.calls).toHaveLength(3);
  });

  test("a row born while the witness was off is never witnessed later the same day: its name says nobody was asked", async () => {
    const { repo, state } = fakeRepo();
    await publishHead({ repo, witness: witnessFrom({ HEAD_WITNESS: "off", APP_SITE: "open" }), mailKeeper: keeper().mailKeeper, log }, { firstOfDay: true });
    const witness = scripted([Buffer.from("300a3003020100300302010a", "hex")]);
    const pass = await publishHead({ repo, witness, mailKeeper: keeper().mailKeeper, log }, { firstOfDay: false });
    expect(pass).toMatchObject({ witnessed: null, done: true });
    expect(witness.calls).toEqual([]);
    expect(state.row!.token).toBeNull();
  });

  test("a day's first round alerts head_missed when the day before has no published value; later rounds do not look", async () => {
    const { repo, state } = fakeRepo({ missed: "2026-10-17" });
    const witness = witnessFrom({ HEAD_WITNESS: "off", APP_SITE: "open" });
    const first = await publishHead({ repo, witness, mailKeeper: keeper().mailKeeper, log }, { firstOfDay: true });
    expect(first.alerts).toEqual(["head_missed"]);
    expect(state.alerts).toEqual([{ kind: "head_missed", day: "2026-10-17" }]);
    state.calls.length = 0;
    await publishHead({ repo, witness, mailKeeper: keeper().mailKeeper, log }, { firstOfDay: false });
    expect(state.calls).not.toContain("missed");
  });

  test("no keeper's address: published all the same, and the pass says no mail went; a place whose hash does not give the value: no mail at all", async () => {
    const off = fakeRepo();
    const none = keeper("off");
    const pass = await publishHead({ repo: off.repo, witness: witnessFrom({ HEAD_WITNESS: "off", APP_SITE: "open" }), mailKeeper: none.mailKeeper, log }, { firstOfDay: true });
    expect(pass).toMatchObject({ published: true, mailed: "off", done: true });
    const wrong = fakeRepo({ place: null });
    const mail = keeper();
    const unverified = await publishHead({ repo: wrong.repo, witness: witnessFrom({ HEAD_WITNESS: "off", APP_SITE: "open" }), mailKeeper: mail.mailKeeper, log }, { firstOfDay: true });
    expect(unverified).toMatchObject({ published: true, mailed: "unverified" });
    expect(mail.sent).toEqual([]);
  });
});
