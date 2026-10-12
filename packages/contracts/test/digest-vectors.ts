/**
 * Texts with their salts and their digests, shared by the contracts' textDigest test and the database's CHECK test
 * (apps/api/test/integration/moderation-schema.test.ts), so that Node, the browser and SQL are held to the same values.
 * The digests were computed with Python's hashlib when the vectors were written: the lower-case hex sha256 of the bytes
 * of "korbat.text.v1", a line feed, the salt's 32 bytes and the text's UTF-8 bytes. Characters outside ASCII are built
 * from their code points, never typed.
 */
const LF = String.fromCharCode(10);
/** U+1F600, outside the basic plane: two UTF-16 units, four UTF-8 bytes. */
const GRINNING = String.fromCodePoint(0x1f600);

export interface TextDigestVector {
  name: string;
  /** 32 bytes as 64 lower-case hex characters. */
  salt: string;
  text: string;
  digest: string;
}

export const TEXT_DIGEST_VECTORS: readonly TextDigestVector[] = [
  { name: "plain text", salt: "a1".repeat(32), text: "The post offers a counterfeit product for sale.", digest: "e427a70be6f10c970e16b353b327d84898d924672fb0f73d1a55b7b709fe7959" },
  { name: "an empty text", salt: "00".repeat(32), text: "", digest: "4b0f918d0b6cd2ee642138a8114716ff591fe2e396f4b827c98553ae71aa69c2" },
  {
    name: "a text with line feeds",
    salt: "0f".repeat(32),
    text: `First line.${LF}Second line.${LF}${LF}After a blank line.`,
    digest: "46dc7d07d46e0f2898a45c559356d0206f1888d10a2ffe96b3442c568ef63567",
  },
  {
    // Latin with an accent, two Han characters, a Cyrillic word, then a c with caron and a sharp s.
    name: "a text outside ASCII",
    salt: "c3".repeat(32),
    text: `Caf${String.fromCharCode(0xe9)} ${String.fromCharCode(0x4e2d, 0x6587)} ${String.fromCharCode(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442)} ${String.fromCharCode(0x10d, 0xdf)}`,
    digest: "7da28392d94768f9a29ddbe0bfded1c50869b3117b5a909a9ad32b6ed6b746fb",
  },
  {
    // A face and a flag (two regional indicators): three characters outside the basic plane.
    name: "a text with emoji",
    salt: "5e".repeat(32),
    text: `Threat ${GRINNING} ${String.fromCodePoint(0x1f1e9, 0x1f1ea)} end`,
    digest: "0bb325c3a0982a535becb15b5a9fee173a7a1db0c9aff5d897865dec99318942",
  },
  {
    // 5000 UTF-16 units, the bound of a staff text: 4998 letters and one character of two units.
    name: "the longest text",
    salt: "ff".repeat(32),
    text: "x".repeat(4998) + GRINNING,
    digest: "462d06627152b99e106da6bd67798a336e81f6b7b8737db50b3c3dbebfa0185d",
  },
];
