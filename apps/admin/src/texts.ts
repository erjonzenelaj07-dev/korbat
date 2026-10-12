import { staffTextProblem, textDigest, type StaffTextKind, type StaffTextSaved } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { messageFor } from "./messages";
import type { CaseId } from "./router";

/**
 * Saving a text as the console does it (3c design, section 7.4): the text is trimmed and put in its composed form, a
 * 32-byte salt is drawn from the browser's random source, and the digest is computed with the contracts' textDigest. The
 * server recomputes the digest and stores the text as it was sent or refuses it. The digest is what a confirmed action
 * names, so the key never signs a text, only the digest of one the person saved: and that digest is the one computed
 * here, from what the person wrote, never one an answer carried.
 */

/** A text the console will not send: the server would refuse it. */
export class TextRefused extends Error {
  readonly code = "text_invalid";
  readonly status = 0;
  constructor() {
    super(messageFor("text_invalid"));
    this.name = "TextRefused";
  }
}

/** This many random bytes: from the browser's crypto.getRandomValues, or a test's. */
export type RandomBytes = (length: number) => Uint8Array;

const browserRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** A fresh salt: 32 random bytes as 64 lower-case hex characters. */
export function newSalt(random: RandomBytes = browserRandom): string {
  return Array.from(random(32), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The text as the console saves it: trimmed, in its composed form. What is shown back and digested is exactly this. */
export const normalised = (text: string): string => text.trim().normalize("NFC");

/**
 * Saves a text on a case and answers its id, the text as it was saved, the salt drawn here and the digest computed here
 * from that salt and that text. A text the rules refuse is not sent at all. The request is its person's: it carries the activity mark.
 *
 * The answer's digest must be the one that was sent. An API that answers a save with the digest of another text would
 * otherwise have the page build a confirmed action from it, and the key sign a reason or a statement its person never
 * wrote: such an answer is refused as one the console cannot read, and nothing is built from it.
 */
export async function saveStaffText(deps: { api: StaffApi; random?: RandomBytes }, caseId: CaseId, kind: StaffTextKind, written: string): Promise<StaffTextSaved & { text: string; salt: string }> {
  const text = normalised(written);
  // No text is saved empty, whatever its kind: the API refuses one as an invalid request, so none is sent.
  if (text === "") throw new ApiError(0, "invalid_request");
  if (staffTextProblem(text) !== null) throw new TextRefused();
  const salt = newSalt(deps.random);
  const digest = await textDigest(salt, text);
  const saved = await deps.api.saveText(caseId, { kind, text, salt, digest }, { activity: true });
  if (saved.digest !== digest) throw new ApiError(0, "invalid_answer");
  return { id: saved.id, digest, text, salt };
}
