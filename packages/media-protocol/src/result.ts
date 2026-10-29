import { z } from "zod";
import { AVATAR_CROPS, MediaFailure } from "@korbat/contracts";
import { R1_MODEL_NAME } from "./classifier";
import { MAX_SIDE } from "./limits";

const side = z.number().int().min(1).max(MAX_SIDE);
const blurhash = z.string().min(6).max(64);

/**
 * 3d (design, sections 5 and 10.2; Task 6): what the worker found of an image beside its two sizes, in version 2. `r1`:
 * the scorer's model, by the name this build gives it, and its score from 0 to 1, present only while a scorer runs
 * (R1_CLASSIFIER is not off); the API keeps a score only from the model its own setting names. `pdq`: korbat's own
 * perceptual hash of the decoded pixels, its implementation's version and its quality (Task 7 computes and keeps it).
 */
const R1Result = z.strictObject({ model: z.string().max(64).regex(R1_MODEL_NAME), score: z.number().min(0).max(1) });
const PdqResult = z.strictObject({
  impl: z.number().int().positive(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  quality: z.number().int().min(0).max(100),
});

/**
 * results/<id>.json, the worker's last write for an upload and therefore the commit point. Width
 * and height are those of large.webp, after rotation. The API parses this strictly: the file
 * comes from the one process korbat does not trust.
 *
 * 3d Task 6 (design, section 10.2): the union of version 1 as it stood and version 2, which is version 1's members with
 * `v: 2` and, on a ready result, the optional members `r1` and `pdq`. The worker writes version 2; the API reads both and
 * refuses every other version, member and range, so a new version ships in the API and the worker together.
 *
 * 2d Task 3 (design, section 7.4): version 3 is version 2's members with `v: 3` and, on a ready result of an avatar's job
 * alone, `avatar: true`: the worker made the two squares. The worker writes version 3; the API reads versions 1 to 3 and
 * refuses an avatar's row whose ready result lacks the mark and a post's row whose result carries it.
 */
export const ResultFile = z.union([
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("ready"), width: side, height: side, blurhash }),
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("failed"), reason: MediaFailure }),
  z.strictObject({ v: z.literal(2), id: z.uuid(), status: z.literal("ready"), width: side, height: side, blurhash, r1: R1Result.optional(), pdq: PdqResult.optional() }),
  z.strictObject({ v: z.literal(2), id: z.uuid(), status: z.literal("failed"), reason: MediaFailure }),
  z.strictObject({ v: z.literal(3), id: z.uuid(), status: z.literal("ready"), width: side, height: side, blurhash, r1: R1Result.optional(), pdq: PdqResult.optional(), avatar: z.literal(true).optional() }),
  z.strictObject({ v: z.literal(3), id: z.uuid(), status: z.literal("failed"), reason: MediaFailure }),
]);
export type ResultFile = z.infer<typeof ResultFile>;

/** The version the worker writes. */
export const RESULT_VERSION = 3;

/**
 * 2d Task 3 (design, section 7.2): incoming/<id>.avatar, the job of an avatar's upload, which the API writes before the
 * upload and the worker reads strictly: version 1 and the crop's position (AVATAR_CROPS), nothing else, at most
 * MAX_JOB_BYTES. A job file that does not parse makes the upload processing_failed.
 */
export const AvatarJob = z.strictObject({ v: z.literal(1), crop: z.enum(AVATAR_CROPS) });
export type AvatarJob = z.infer<typeof AvatarJob>;

/** The heartbeat file: when the worker last completed a tick, in epoch milliseconds. */
export const Heartbeat = z.strictObject({ v: z.literal(1), at: z.number().int().nonnegative() });
export type Heartbeat = z.infer<typeof Heartbeat>;
