import { AuthError } from "./context";
import type { KeyValueStore } from "./kv";

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

/** Counts one event in a fixed window and rejects once the count exceeds `max`. */
export async function enforceLimit(kv: KeyValueStore, bucket: string, max: number, windowMs: number): Promise<void> {
  const count = await kv.incr(`rl:${bucket}`, windowMs);
  if (count > max) throw new AuthError("rate_limited", 429);
}

/** Resolves only after at least `minMs` of wall-clock time since `startedAt`, so fast and slow paths look alike. */
export async function padResponseTime(startedAt: number, minMs: number): Promise<void> {
  const wait = minMs - (Date.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
