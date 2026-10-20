import { createHash } from "node:crypto";
import type { MatchHashType, MatchKind } from "@korbat/contracts";
import { MATCH_FIXTURES } from "@korbat/media-protocol";

/**
 * The comparison with known material (3d design, sections 2 rows 28, 32 and 33, 5 "The adapters", 7.8; Task 7), chosen by
 * MEDIA_MATCH when the process starts. It is given hashes and nothing else, and it imports nothing of the media module:
 * match.ts and the finalize flow read the rows and hand it one request built by `matchRequest`, which takes the four
 * hashes alone, so no adapter can be sent an image, an address, an account or an id of korbat's. An architecture test
 * holds the file to that.
 *
 *   - `off` (the default): nothing is hashed or compared anywhere; the adapter answers nothing, and nothing asks it.
 *   - `test`: answers on the digests of the two byte-constant PNG files of @korbat/media-protocol's MATCH_FIXTURES,
 *     computed from those bytes when the adapter is built. The `acting` file is an exact SHA-256 match of the one
 *     classification the adapter declares listed and acting; the `flag` file is a match that does not act, of the kind a
 *     test sets: a near match of the listed class (by SHA-1), or an exact match of the class that is not listed (by MD5).
 *     A test can also make it not answer, or answer every file as the acting match. It is built only while the app's
 *     site is closed, in the process as at start.
 *   - a source's name: no adapter for a real source exists in this build (each needs an agreement before its interface can
 *     be read); the configuration stops the process at start with "no such adapter in this build".
 *
 * Each adapter declares MATCH_LISTED, the classifications its source itself names child sexual abuse material, and its
 * part MATCH_ACTING, those on which a program may act; the database's match_listed() and match_acting() hold the same
 * pairs, which a database test checks.
 */

/** The four hashes an upload has: three cryptographic hashes of the bytes as received, and PDQ when the worker gave one. */
export interface UploadHashes {
  sha256: Uint8Array;
  sha1: Uint8Array;
  md5: Uint8Array;
  /** 32 bytes; absent in this build, whose worker computes no PDQ. */
  pdq?: Uint8Array;
}

/** What is sent: each hash as lower-case hexadecimal, and nothing else. */
export interface MatchRequest {
  sha256: string;
  sha1: string;
  md5: string;
  pdq?: string;
}

/** What the source answered: no match; a match; or nothing in time, which the caller records as unchecked. */
export type MatchAnswer =
  | { state: "clear" }
  | {
      state: "matched";
      hashType: MatchHashType;
      kind: MatchKind;
      /** As the source returned it, at most 100 characters. */
      classification: string;
      listVersion: string | null;
    }
  | { state: "unanswered" };

export interface MatchAdapter {
  readonly mode: "off" | "test";
  /** The source's declared name, which a statement names once the source allows it; null while off. */
  readonly source: string | null;
  readonly listed: readonly string[];
  readonly acting: readonly string[];
  check(request: MatchRequest): Promise<MatchAnswer>;
}

/** The `test` adapter's switches, which a test sets; and what it was sent, one request a call. */
export interface TestMatchAdapter extends MatchAdapter {
  readonly mode: "test";
  /** The kind of match the `flag` fixture answers. */
  flag: "near" | "unlisted";
  /** Answers nothing (unanswered) while set. */
  silent: boolean;
  /** Answers every request as an exact match of the acting class while set: a source gone wrong. */
  matchAll: boolean;
  readonly requests: readonly MatchRequest[];
}

/** The test adapter's source name and its two classifications, which match_listed() and match_acting() hold too. */
export const TEST_SOURCE = "test";
export const TEST_LISTED_CLASS = "test_listed";
export const TEST_UNLISTED_CLASS = "test_unlisted";
export const TEST_LIST_VERSION = "test-1";
/** MATCH_LISTED and MATCH_ACTING of each adapter built in, by source; the test adapter's alone in this build. */
export const MATCH_LISTED: Readonly<Record<string, readonly string[]>> = { [TEST_SOURCE]: [TEST_LISTED_CLASS] };
export const MATCH_ACTING: Readonly<Record<string, readonly string[]>> = { [TEST_SOURCE]: [TEST_LISTED_CLASS] };

const hex = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");

/**
 * The one function that builds a request: the four hashes as hexadecimal, PDQ only when given. It takes the hashes and
 * nothing else, and a test fails when its result holds any other member.
 */
export function matchRequest(hashes: UploadHashes): MatchRequest {
  const request: MatchRequest = { sha256: hex(hashes.sha256), sha1: hex(hashes.sha1), md5: hex(hashes.md5) };
  if (hashes.pdq !== undefined) request.pdq = hex(hashes.pdq);
  return request;
}

/** The settings the adapter is built from: the configuration's own members of the same names. */
export interface MatchSettings {
  MEDIA_MATCH: string;
  APP_SITE: "open" | "closed";
}

const digest = (algorithm: "sha256" | "sha1" | "md5", bytes: Uint8Array) => createHash(algorithm).update(bytes).digest("hex");

export function matchAdapterFrom(settings: MatchSettings): MatchAdapter | TestMatchAdapter {
  if (settings.MEDIA_MATCH === "off") {
    return {
      mode: "off",
      source: null,
      listed: [],
      acting: [],
      check: async () => {
        throw new Error("known material: the comparison is off, and nothing is sent");
      },
    };
  }
  if (settings.MEDIA_MATCH !== TEST_SOURCE) throw new Error(`known material: MEDIA_MATCH=${settings.MEDIA_MATCH}: no such adapter in this build`);
  // The same rule as the configuration's, so a test adapter built in the process answers only on a closed site too.
  if (settings.APP_SITE !== "closed") throw new Error("known material: MEDIA_MATCH=test is refused while APP_SITE is open");
  // The digests are taken from the fixtures' bytes here, when the adapter is built; a unit test holds them to node:crypto's.
  const acting = digest("sha256", MATCH_FIXTURES.acting);
  const flagSha1 = digest("sha1", MATCH_FIXTURES.flag);
  const flagMd5 = digest("md5", MATCH_FIXTURES.flag);
  const requests: MatchRequest[] = [];
  const adapter: TestMatchAdapter = {
    mode: "test",
    source: TEST_SOURCE,
    listed: MATCH_LISTED[TEST_SOURCE]!,
    acting: MATCH_ACTING[TEST_SOURCE]!,
    flag: "near",
    silent: false,
    matchAll: false,
    requests,
    async check(request) {
      requests.push({ ...request });
      if (adapter.silent) return { state: "unanswered" };
      if (adapter.matchAll || request.sha256 === acting) {
        return { state: "matched", hashType: "sha256", kind: "exact", classification: TEST_LISTED_CLASS, listVersion: TEST_LIST_VERSION };
      }
      if (adapter.flag === "near" && request.sha1 === flagSha1) {
        return { state: "matched", hashType: "sha1", kind: "near", classification: TEST_LISTED_CLASS, listVersion: TEST_LIST_VERSION };
      }
      if (adapter.flag === "unlisted" && request.md5 === flagMd5) {
        return { state: "matched", hashType: "md5", kind: "exact", classification: TEST_UNLISTED_CLASS, listVersion: TEST_LIST_VERSION };
      }
      return { state: "clear" };
    },
  };
  return adapter;
}

/** The hash a match rests on, taken from the hashes the request was built from: what the match record keeps. */
export function matchedHash(hashes: UploadHashes, hashType: MatchHashType): Uint8Array | null {
  if (hashType === "pdq") return hashes.pdq ?? null;
  return hashes[hashType];
}
