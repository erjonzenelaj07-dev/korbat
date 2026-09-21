import { z } from "zod";
import { MediaFailure } from "@korbat/contracts";
import { MAX_SIDE } from "./limits";

const side = z.number().int().min(1).max(MAX_SIDE);

/**
 * results/<id>.json, the worker's last write for an upload and therefore the commit point. Width
 * and height are those of large.webp, after rotation. The API parses this strictly: the file
 * comes from the one process korbat does not trust.
 */
export const ResultFile = z.discriminatedUnion("status", [
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("ready"), width: side, height: side, blurhash: z.string().min(6).max(64) }),
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("failed"), reason: MediaFailure }),
]);
export type ResultFile = z.infer<typeof ResultFile>;

/** The heartbeat file: when the worker last completed a tick, in epoch milliseconds. */
export const Heartbeat = z.strictObject({ v: z.literal(1), at: z.number().int().nonnegative() });
export type Heartbeat = z.infer<typeof Heartbeat>;
