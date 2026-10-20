import { HEAD_RULES, type HeadWitness } from "@korbat/contracts";

/**
 * The head's witness adapter (3d design, sections 2 row 9, 5 "The adapters" and 7.7; Task 5), chosen by HEAD_WITNESS when
 * the process starts. It is given one value, the day's 64 hexadecimal characters, and nothing else, and it imports
 * nothing of the transparency module: the job (head.ts) hands it the value and stores what it answers. An architecture
 * test holds it to that.
 *
 *   - `off` (the default): asks nobody; the value stands on korbat's page and in the keeper's mail only.
 *   - `test`: answers TEST_TOKEN, a fixed token that proves nothing, for any value; it is built only while the app's site
 *     is closed, in the process as at start.
 *   - `rfc3161`: one POST of the fixed RFC 3161 request below to HEAD_WITNESS_URL, bounded at HEAD_RULES.witnessTimeoutMs.
 *     The answer, a TimeStampResp, is read no further than its status: granted (0) or granted with modifications (1),
 *     with a token after it, is kept whole and as received, at most HEAD_RULES.tokenMaxBytes; anything else, a timeout or
 *     no connection answers null, and nothing is thrown. The whole answer is what `openssl ts -verify -in <day>.tsr`
 *     reads, which the page's [tr.verify] says how to run.
 */

export type WitnessMode = "off" | "test" | "rfc3161";

export interface WitnessAdapter {
  readonly mode: WitnessMode;
  /** What head_publications.witness records of a row the job writes while this adapter is built: none while it is off. */
  readonly name: HeadWitness;
  /** The authority's token for the value, or null when it gave none. */
  witness(value: string): Promise<Uint8Array | null>;
}

/** The settings the adapter is built from: the configuration's own members of the same names. */
export interface WitnessSettings {
  HEAD_WITNESS: WitnessMode;
  APP_SITE: "open" | "closed";
  HEAD_WITNESS_URL?: string | undefined;
}

/** What a test may give in place of the authority: its address (fakeWitness(), which is no https one), a fetch, a shorter wait. */
export interface WitnessOptions {
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The fixed TimeStampReq (RFC 3161, section 2.4.1), 59 bytes in DER around the value's own 32 bytes:
 *
 *   30 39                        TimeStampReq, a SEQUENCE of 57 bytes
 *     02 01 01                   version 1
 *     30 31                      messageImprint, a SEQUENCE of 49 bytes
 *       30 0d                    hashAlgorithm
 *         06 09 60 86 48 01 65 03 04 02 01    the OID of SHA-256, 2.16.840.1.101.3.4.2.1
 *         05 00                  its NULL parameters
 *       04 20 <32 bytes>         hashedMessage: the value read as the 32 bytes its hex spells
 *     01 01 ff                   certReq TRUE: the token carries the authority's certificate
 *
 * The imprint is the value itself, not a digest of its text, so `openssl ts -verify -digest <value>` compares the proof
 * with the value the page shows. No nonce and no policy: the request is the same for everyone but for its 32 bytes.
 */
const REQUEST_HEAD = Uint8Array.of(0x30, 0x39, 0x02, 0x01, 0x01, 0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20);
const REQUEST_TAIL = Uint8Array.of(0x01, 0x01, 0xff);

/** A head's value: the hex SHA-256 that head_value() computes. */
const VALUE = /^[0-9a-f]{64}$/;

/** The request for one value, as `timestampRequest` writes it into the template. */
export function timestampRequest(value: string): Uint8Array {
  if (!VALUE.test(value)) throw new Error("head witness: a value is 64 lower-case hexadecimal characters");
  const request = new Uint8Array(REQUEST_HEAD.length + 32 + REQUEST_TAIL.length);
  request.set(REQUEST_HEAD, 0);
  request.set(Buffer.from(value, "hex"), REQUEST_HEAD.length);
  request.set(REQUEST_TAIL, REQUEST_HEAD.length + 32);
  return request;
}

/**
 * The `test` adapter's token: a TimeStampResp of status granted whose token is the OCTET STRING "test" in place of a
 * signed structure. It proves nothing and says so to whoever parses it; it is stored and offered like a real one.
 */
export const TEST_TOKEN = Uint8Array.of(0x30, 0x0b, 0x30, 0x03, 0x02, 0x01, 0x00, 0x04, 0x04, 0x74, 0x65, 0x73, 0x74);

/** A DER element's tag at `at`: where its content starts and ends, or null when it is not that tag or overruns `end`. */
function element(bytes: Uint8Array, at: number, end: number, tag: number): { start: number; end: number } | null {
  if (at + 2 > end || bytes[at] !== tag) return null;
  const first = bytes[at + 1]!;
  let length: number;
  let start: number;
  if (first < 0x80) {
    length = first;
    start = at + 2;
  } else if (first === 0x81 && at + 3 <= end) {
    length = bytes[at + 2]!;
    start = at + 3;
  } else if (first === 0x82 && at + 4 <= end) {
    length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    start = at + 4;
  } else {
    // A longer form would hold more than tokenMaxBytes; an indefinite one is no DER.
    return null;
  }
  return start + length <= end ? { start, end: start + length } : null;
}

/**
 * Whether a TimeStampResp grants a token: the SEQUENCE spans the whole answer, its PKIStatusInfo opens with the status
 * 0 or 1, and something follows the status info, which is the token. Nothing else of the answer is read.
 */
export function grantsToken(bytes: Uint8Array): boolean {
  const response = element(bytes, 0, bytes.length, 0x30);
  if (response === null || response.end !== bytes.length) return false;
  const info = element(bytes, response.start, response.end, 0x30);
  if (info === null) return false;
  const status = element(bytes, info.start, info.end, 0x02);
  if (status === null || status.end - status.start !== 1) return false;
  const granted = bytes[status.start] === 0 || bytes[status.start] === 1;
  return granted && info.end < response.end;
}

/** The body of an answer, read until it would pass `max` bytes; null when it does. */
async function readAtMost(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) {
    await res.body?.cancel();
    return null;
  }
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

export function witnessFrom(settings: WitnessSettings, options: WitnessOptions = {}): WitnessAdapter {
  switch (settings.HEAD_WITNESS) {
    case "off":
      return {
        mode: "off",
        name: "none",
        witness: async () => {
          throw new Error("head witness: the adapter is off, and nothing is asked");
        },
      };
    case "test":
      // The same rule as the configuration's, so a test adapter built in the process answers only on a closed site too.
      if (settings.APP_SITE !== "closed") throw new Error("head witness: HEAD_WITNESS=test is refused while APP_SITE is open");
      return {
        mode: "test",
        name: "test",
        async witness(value) {
          timestampRequest(value);
          return Uint8Array.from(TEST_TOKEN);
        },
      };
    case "rfc3161": {
      if (!settings.HEAD_WITNESS_URL) throw new Error("head witness: HEAD_WITNESS_URL is required when HEAD_WITNESS is rfc3161");
      const url = options.url ?? settings.HEAD_WITNESS_URL;
      const send = options.fetch ?? fetch;
      const timeoutMs = options.timeoutMs ?? HEAD_RULES.witnessTimeoutMs;
      return {
        mode: "rfc3161",
        name: "rfc3161",
        async witness(value) {
          const body = timestampRequest(value);
          try {
            // One signal bounds the whole exchange, the body's reading included.
            const signal = AbortSignal.timeout(timeoutMs);
            const res = await send(url, {
              method: "POST",
              headers: { "content-type": "application/timestamp-query", accept: "application/timestamp-reply" },
              body,
              signal,
              redirect: "error",
            });
            if (!res.ok) {
              await res.body?.cancel();
              return null;
            }
            const answer = await readAtMost(res, HEAD_RULES.tokenMaxBytes);
            return answer !== null && grantsToken(answer) ? answer : null;
          } catch {
            // A refused connection, a timeout, a redirect or a broken body: no token. The error is dropped whole.
            return null;
          }
        },
      };
    }
  }
}
