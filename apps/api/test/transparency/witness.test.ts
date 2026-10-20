import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { HEAD_RULES } from "@korbat/contracts";
import { TEST_TOKEN, timestampRequest, witnessFrom, type WitnessSettings } from "../../src/transparency/witness";
import { REFUSED_ANSWER, fakeWitness, grantedAnswer } from "./fake-witness";

/**
 * The head's witness adapter (3d design, sections 2 row 9, 5 "The adapters" and 7.7; 12.1 row 27 and 12.2; Task 5):
 * `off`, `test` and `rfc3161`, chosen by HEAD_WITNESS. The request is a fixed DER template of under 100 bytes with the
 * value's own 32 bytes as its imprint, so `openssl ts -verify -digest <value>` checks the proof; the `test` adapter
 * answers a fixed token and is built only on a site that is closed; `rfc3161` sends one request, bounded at
 * HEAD_RULES.witnessTimeoutMs, here against fakeWitness(), and keeps the answer unparsed beyond its status, at most
 * HEAD_RULES.tokenMaxBytes. Every failure answers null.
 */
// The lab of [tr.verify] (the report of Task 5): the value of 2026-10-18 at place 42, the request it sent to a local test
// authority, which `openssl ts -query -text` read as version 1, sha256, this imprint and "Certificate required: yes".
const VALUE = "917907fc36f065a78e0b730230eac9c4f1c2882c77efc7a868a65ee336e0899e";
const LAB_REQUEST = "30390201013031300d060960864801650304020105000420917907fc36f065a78e0b730230eac9c4f1c2882c77efc7a868a65ee336e0899e0101ff";
const closed = (over: Partial<WitnessSettings> = {}): WitnessSettings => ({ HEAD_WITNESS: "test", APP_SITE: "closed", HEAD_WITNESS_URL: undefined, ...over });
const rfc3161 = (url: string): WitnessSettings => ({ HEAD_WITNESS: "rfc3161", APP_SITE: "open", HEAD_WITNESS_URL: url });

describe("the request template", () => {
  test("a TimeStampReq of 59 bytes: version 1, SHA-256 with its NULL parameters, the value's own 32 bytes, and the certificate asked for", () => {
    const request = Buffer.from(timestampRequest(VALUE));
    expect(request.toString("hex")).toBe(LAB_REQUEST);
    expect(request.length).toBe(59);
    expect(request.length).toBeLessThan(100);
    // The imprint is the value itself, read as the 32 bytes its hex spells: what -digest {value} compares.
    expect(request.subarray(24, 56).toString("hex")).toBe(VALUE);
    // Only the imprint differs from one value to the next: no nonce, no time, nothing of the server.
    const other = Buffer.from(timestampRequest("0".repeat(64)));
    expect(Buffer.concat([other.subarray(0, 24), other.subarray(56)]).equals(Buffer.concat([request.subarray(0, 24), request.subarray(56)]))).toBe(true);
  });

  test("it takes a value of 64 lower-case hexadecimal characters and nothing else", () => {
    for (const bad of ["", VALUE.toUpperCase(), VALUE.slice(2), `${VALUE}00`, "z".repeat(64)]) expect(() => timestampRequest(bad), bad).toThrow(/value/);
  });
});

describe("the witness adapter", () => {
  test("off: the default; it names nobody and sends nothing", async () => {
    const off = witnessFrom({ HEAD_WITNESS: "off", APP_SITE: "open" });
    expect([off.mode, off.name]).toEqual(["off", "none"]);
    await expect(off.witness(VALUE)).rejects.toThrow(/off/);
  });

  test("test: a fixed token for any value, a copy each time, on a site that is closed", async () => {
    const adapter = witnessFrom(closed());
    expect([adapter.mode, adapter.name]).toEqual(["test", "test"]);
    const first = await adapter.witness(VALUE);
    expect(Buffer.from(first!).equals(Buffer.from(TEST_TOKEN))).toBe(true);
    first![0] = 0;
    expect(Buffer.from((await adapter.witness("0".repeat(64)))!).equals(Buffer.from(TEST_TOKEN))).toBe(true);
    expect(TEST_TOKEN.length).toBeLessThanOrEqual(HEAD_RULES.tokenMaxBytes);
  });

  test("test is refused while the app's site is open, in the process as at start", () => {
    expect(() => witnessFrom(closed({ APP_SITE: "open" }))).toThrow(/APP_SITE/);
  });

  test("rfc3161 is refused without its address", () => {
    expect(() => witnessFrom({ HEAD_WITNESS: "rfc3161", APP_SITE: "open", HEAD_WITNESS_URL: undefined })).toThrow(/HEAD_WITNESS_URL/);
  });
});

describe("rfc3161 against fakeWitness()", () => {
  let fake: Awaited<ReturnType<typeof fakeWitness>>;
  beforeAll(async () => {
    fake = await fakeWitness();
  });
  afterAll(async () => {
    await fake.close();
  });

  test("an answer: one POST of the request, as application/timestamp-query, and the whole TimeStampResp kept as it came", async () => {
    fake.answer("ok");
    fake.requests.length = 0;
    const adapter = witnessFrom(rfc3161("https://tsa.example/"), { url: fake.url });
    expect([adapter.mode, adapter.name]).toEqual(["rfc3161", "rfc3161"]);
    const token = await adapter.witness(VALUE);
    expect(fake.requests).toHaveLength(1);
    expect([fake.requests[0]!.method, fake.requests[0]!.path, fake.requests[0]!.contentType]).toEqual(["POST", "/tsa", "application/timestamp-query"]);
    expect(fake.requests[0]!.body.toString("hex")).toBe(LAB_REQUEST);
    expect(Buffer.from(token!).equals(grantedAnswer(Buffer.from(LAB_REQUEST, "hex")))).toBe(true);
  });

  test("a refusal, a server error and an answer larger than HEAD_RULES.tokenMaxBytes each answer null", async () => {
    const adapter = witnessFrom(rfc3161("https://tsa.example/"), { url: fake.url });
    for (const how of ["refused", "error", "huge"] as const) {
      fake.answer(how);
      expect(await adapter.witness(VALUE), how).toBeNull();
    }
    expect(REFUSED_ANSWER.length).toBeLessThan(16);
  });

  test("an authority that does not answer: null once the timeout has passed, and nothing thrown", async () => {
    fake.answer("hang");
    const adapter = witnessFrom(rfc3161("https://tsa.example/"), { url: fake.url, timeoutMs: 300 });
    const started = Date.now();
    expect(await adapter.witness(VALUE)).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
    fake.answer("ok");
  });

  test("a closed port answers null; an answer that is no TimeStampResp, or a granted one without its token, answers null", async () => {
    const refusedPort = witnessFrom(rfc3161("https://tsa.example/"), { url: "http://127.0.0.1:1/tsa" });
    expect(await refusedPort.witness(VALUE)).toBeNull();
    const answering = (body: Uint8Array) =>
      witnessFrom(rfc3161("https://tsa.example/"), { url: "https://tsa.example/", fetch: async () => new Response(body, { status: 200 }) });
    for (const body of [Buffer.from("not der"), Buffer.from("3003020100", "hex"), Buffer.from("300530030201", "hex"), Buffer.alloc(0)]) {
      expect(await answering(body).witness(VALUE), body.toString("hex")).toBeNull();
    }
    // Status 1, granted with modifications, is a token too.
    const withMods = Buffer.from("300a3003020101300302010a", "hex");
    expect(Buffer.from((await answering(withMods).witness(VALUE))!).equals(withMods)).toBe(true);
  });
});
