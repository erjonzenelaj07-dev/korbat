import type { ChainRow } from "../../src/staff/chain";

/**
 * The audit chain's canonical text, version 1 (3a design, section 6), as fixed test vectors: rows with nulls, empty
 * strings, quotes, backslashes, control characters, non-ASCII text, nested metadata and a step-up. Each gives what an
 * insert supplies, the metadata and step-up as PostgreSQL prints the stored jsonb, the expected canonical text and the
 * expected hash. The texts were checked against migration 0012's `public.audit_chain_text` and the hashes computed by
 * PostgreSQL's own sha256 when the vectors were written; the unit test holds chain.ts to them, and the integration parity
 * test writes the same contents through the trigger and recomputes the stored hashes.
 *
 * Every backslash, control character and non-ASCII character is built here in code, never typed as a literal, so the
 * file stays plain printable ASCII. The vectors form a chain of their own: each prev_hash is the hash of the one before.
 */

/** A backslash, as JSON escapes begin with. */
const BS = String.fromCharCode(92);
/** JSON's escape of a control character, as to_json and JSON.stringify write it: a backslash, u, four lower-case hex digits. */
const esc = (code: number) => `${BS}u${code.toString(16).padStart(4, "0")}`;
const chars = (...codes: number[]) => String.fromCodePoint(...codes);

const TAB = chars(9);
const LF = chars(10);
const CR = chars(13);
const DEL = chars(127);
/** The characters 1 to 31, every control character PostgreSQL text can hold below the space (it cannot hold 0). */
const CONTROLS = chars(...Array.from({ length: 31 }, (_, i) => i + 1));
/** The same as JSON writes them: the five short escapes, and the others as esc(). */
const CONTROLS_JSON = Array.from({ length: 31 }, (_, i) => {
  const code = i + 1;
  const short: Record<number, string> = { 8: "b", 9: "t", 10: "n", 12: "f", 13: "r" };
  return short[code] === undefined ? esc(code) : `${BS}${short[code]}`;
}).join("");

const E_ACUTE = chars(0xe9);
const C_CEDILLA = chars(0xe7);
const OMEGA = chars(0x3a9);
const ZHONGWEN = chars(0x4e2d, 0x6587);
const GRINNING = chars(0x1f600);
/** A person at a computer: two astral characters joined by a zero-width joiner. */
const TECHNOLOGIST = chars(0x1f9d1, 0x200d, 0x1f4bb);
const BOM = chars(0xfeff);
const LINE_SEPARATOR = chars(0x2028);
const PARAGRAPH_SEPARATOR = chars(0x2029);

const ZERO_HASH = "0".repeat(64);
const SYSTEM = "00000000-0000-0000-0000-000000000000";
const STAFF = "5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b";

/** What an insert supplies for a row; the trigger chooses its id, time, place and hashes itself. */
export interface ChainVectorInsert {
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  staffSession: string | null;
  keyId: string | null;
  actionHash: string | null;
  stepUp: { authenticatorData: string; clientDataJSON: string; signature: string } | null;
  metadata: Record<string, unknown>;
}

export interface ChainVector {
  name: string;
  insert: ChainVectorInsert;
  /** The row as chain.ts reads it, with the place, id and time this vector fixes. */
  row: ChainRow;
  prevHash: string;
  /** The stored metadata and step-up exactly as PostgreSQL prints them (`::text`): its key order and separators. */
  metadataText: string;
  stepUpText: string | null;
  canonical: string;
  hash: string;
}

type Spec = Omit<ChainVector, "row" | "prevHash"> & { seq: number; id: number; createdAt: string };

const SPECS: Spec[] = [
  {
    name: "grant-role's row, every optional column null",
    seq: 1,
    id: 1,
    createdAt: "2026-09-30T08:15:42.007Z",
    insert: {
      actorId: SYSTEM,
      action: "role_granted",
      targetType: "user",
      targetId: "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab",
      requestId: null,
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { from: "user", to: "moderator", via: "cli" },
    },
    // jsonb keeps its own key order (shorter keys first), which the text embeds as printed, never re-serialised.
    metadataText: '{"to": "moderator", "via": "cli", "from": "user"}',
    stepUpText: null,
    canonical:
      '[1,1,1,"2026-09-30T08:15:42.007Z","00000000-0000-0000-0000-000000000000","role_granted","user","3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab",null,null,null,null,null,{"to": "moderator", "via": "cli", "from": "user"}]',
    hash: "ce7bdf45f85f04d846cfc331f8563114f8cf9547724d6ff3b744d9b9477010e7",
  },
  {
    name: "empty strings",
    seq: 2,
    id: 3,
    createdAt: "2026-09-30T08:15:43.000Z",
    insert: {
      actorId: STAFF,
      action: "",
      targetType: "",
      targetId: "",
      requestId: "",
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { "": "" },
    },
    metadataText: '{"": ""}',
    stepUpText: null,
    canonical: '[1,2,3,"2026-09-30T08:15:43.000Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","","","","",null,null,null,null,{"": ""}]',
    hash: "519818d9cfab73737a086d419800de97ca5f82294db37d979cfa5600577218e3",
  },
  {
    name: "quotes and backslashes",
    seq: 3,
    id: 5,
    createdAt: "2026-09-30T08:15:43.999Z",
    insert: {
      actorId: STAFF,
      action: `say "hi" ${BS} bye`,
      targetType: '"',
      targetId: `C:${BS}staff${BS}"x"`,
      requestId: "a/b",
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { q: 'a"b', b: `c${BS}d`, 'k"ey': "v" },
    },
    metadataText: `{"b": "c${BS}${BS}d", "q": "a${BS}"b", "k${BS}"ey": "v"}`,
    stepUpText: null,
    canonical:
      `[1,3,5,"2026-09-30T08:15:43.999Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","say ${BS}"hi${BS}" ${BS}${BS} bye","${BS}"",` +
      `"C:${BS}${BS}staff${BS}${BS}${BS}"x${BS}"","a/b",null,null,null,null,{"b": "c${BS}${BS}d", "q": "a${BS}"b", "k${BS}"ey": "v"}]`,
    hash: "9a9e47b64c87ac1def6f82c6012ec9604eca8f450a4a887e6595039796c0178d",
  },
  {
    name: "control characters",
    seq: 4,
    id: 7,
    createdAt: "2026-09-30T23:59:59.500Z",
    insert: {
      actorId: STAFF,
      action: CONTROLS + DEL,
      targetType: null,
      targetId: `tab${TAB}end`,
      requestId: `line1${LF}line2${CR}`,
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { c: chars(1, 31, 127), t: TAB + LF },
    },
    // DEL is not a JSON control character: both escapers leave it as it is.
    metadataText: `{"c": "${esc(1)}${esc(31)}${DEL}", "t": "${BS}t${BS}n"}`,
    stepUpText: null,
    canonical:
      `[1,4,7,"2026-09-30T23:59:59.500Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","${CONTROLS_JSON}${DEL}",null,"tab${BS}tend",` +
      `"line1${BS}nline2${BS}r",null,null,null,null,{"c": "${esc(1)}${esc(31)}${DEL}", "t": "${BS}t${BS}n"}]`,
    hash: "38a8e4be3f4aeb2f502c7086940a59765428c1d283a4c141bd0acd2f64cc9593",
  },
  {
    name: "non-ASCII text",
    seq: 5,
    id: 9,
    createdAt: "2027-01-01T00:00:00.001Z",
    insert: {
      actorId: STAFF,
      action: `moderation ${E_ACUTE}${C_CEDILLA} ${OMEGA} ${ZHONGWEN}`,
      targetType: "post",
      targetId: GRINNING + TECHNOLOGIST,
      requestId: `${BOM}req${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}`,
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: { [E_ACUTE]: OMEGA, [GRINNING]: ZHONGWEN, note: LINE_SEPARATOR },
    },
    // Keys of equal length in UTF-8 bytes ("note" and the emoji, 4 each) are ordered bytewise; neither escaper touches
    // non-ASCII text, the line and paragraph separators included.
    metadataText: `{"${E_ACUTE}": "${OMEGA}", "note": "${LINE_SEPARATOR}", "${GRINNING}": "${ZHONGWEN}"}`,
    stepUpText: null,
    canonical:
      `[1,5,9,"2027-01-01T00:00:00.001Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","moderation ${E_ACUTE}${C_CEDILLA} ${OMEGA} ${ZHONGWEN}",` +
      `"post","${GRINNING}${TECHNOLOGIST}","${BOM}req${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}",null,null,null,null,` +
      `{"${E_ACUTE}": "${OMEGA}", "note": "${LINE_SEPARATOR}", "${GRINNING}": "${ZHONGWEN}"}]`,
    hash: "d12e85713d582acc9f2b4efb018b807af54a28131dcea9442e0536b136cce840",
  },
  {
    name: "nested metadata",
    seq: 6,
    id: 11,
    createdAt: "2026-10-01T12:00:00.250Z",
    insert: {
      actorId: STAFF,
      action: "case_decided",
      targetType: "post",
      targetId: "9c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5",
      requestId: "req-7",
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUp: null,
      metadata: {
        params: { reason: "R2", items: [{ id: 1, ok: true }, { id: 2, ok: false, note: null }], empty: {}, list: [] },
        count: 2,
        ratio: 0.25,
        small: 1e-7,
        neg: -3,
      },
    },
    // At every level shorter keys come first; numbers are printed as PostgreSQL's numeric prints them (1e-7 in full).
    metadataText:
      '{"neg": -3, "count": 2, "ratio": 0.25, "small": 0.0000001, "params": {"list": [], "empty": {}, "items": [{"id": 1, "ok": true}, {"id": 2, "ok": false, "note": null}], "reason": "R2"}}',
    stepUpText: null,
    canonical:
      '[1,6,11,"2026-10-01T12:00:00.250Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","case_decided","post","9c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5","req-7",null,null,null,null,' +
      '{"neg": -3, "count": 2, "ratio": 0.25, "small": 0.0000001, "params": {"list": [], "empty": {}, "items": [{"id": 1, "ok": true}, {"id": 2, "ok": false, "note": null}], "reason": "R2"}}]',
    hash: "1ff30301d442f8d4c8ccc9d7d2870009ef58587f1073e605c2943d220cf9e508",
  },
  {
    name: "a step-up",
    seq: 7,
    id: 13,
    createdAt: "2026-10-01T12:00:01.000Z",
    insert: {
      actorId: STAFF,
      action: "staff_session_revoked",
      targetType: "staff_session",
      targetId: "c0ffee00-1234-4abc-8def-0123456789ab",
      requestId: "req-8",
      staffSession: "8a3c7f0e-1111-4222-8333-944445555666",
      keyId: "01234567-89ab-4cde-8f01-23456789abcd",
      actionHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      stepUp: {
        authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAABQ",
        clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiQUFBQSIsIm9yaWdpbiI6Imh0dHA6Ly9jb25zb2xlLmxvY2FsaG9zdDo4MDkwIn0",
        signature: "MEUCIQDx-signature-placeholder_AiEA",
      },
      metadata: { params: {} },
    },
    metadataText: '{"params": {}}',
    stepUpText:
      '{"signature": "MEUCIQDx-signature-placeholder_AiEA", "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiQUFBQSIsIm9yaWdpbiI6Imh0dHA6Ly9jb25zb2xlLmxvY2FsaG9zdDo4MDkwIn0", "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAABQ"}',
    canonical:
      '[1,7,13,"2026-10-01T12:00:01.000Z","5b0e7c1a-2d34-4f56-8a9b-0c1d2e3f4a5b","staff_session_revoked","staff_session","c0ffee00-1234-4abc-8def-0123456789ab","req-8",' +
      '"8a3c7f0e-1111-4222-8333-944445555666","01234567-89ab-4cde-8f01-23456789abcd","e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",' +
      '{"signature": "MEUCIQDx-signature-placeholder_AiEA", "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiQUFBQSIsIm9yaWdpbiI6Imh0dHA6Ly9jb25zb2xlLmxvY2FsaG9zdDo4MDkwIn0", "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAABQ"},' +
      '{"params": {}}]',
    hash: "92cc0e0d99eb38cd494f55891edf8b10bf8f73ca07630b5a663cfabd33e5a612",
  },
];

export const CHAIN_VECTORS: ChainVector[] = SPECS.map((spec, index) => {
  const { seq, id, createdAt, ...vector } = spec;
  const { stepUp: _stepUp, metadata: _metadata, ...columns } = vector.insert;
  return {
    ...vector,
    prevHash: index === 0 ? ZERO_HASH : SPECS[index - 1]!.hash,
    row: {
      chainVersion: 1,
      chainSeq: seq,
      id,
      createdAt: new Date(createdAt),
      ...columns,
      stepUpText: vector.stepUpText,
      metadataText: vector.metadataText,
    },
  };
});
