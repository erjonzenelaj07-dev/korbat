import { randomBytes, randomUUID } from "node:crypto";
import { profiles, type Db } from "@korbat/db";
import type { SocialRepo } from "../../src/social/repo";

/** A profile row straight in the public schema; social tests never need an auth user behind it. */
export async function newProfile(db: Db, options: { createdAt?: Date; displayName?: string } = {}) {
  const id = randomUUID();
  const handle = `s_${randomBytes(5).toString("hex")}`;
  await db.insert(profiles).values({ id, handle, displayName: options.displayName ?? `Profile ${handle}`, createdAt: options.createdAt ?? new Date() });
  return { id, handle };
}

/** A clock that hands out strictly increasing millisecond timestamps, so every row sorts unambiguously. */
export function ticker(start: number = Date.now() - 60_000) {
  let t = start;
  return {
    next: () => new Date((t += 1)),
    jump: (ms: number) => new Date((t += ms)),
    now: () => new Date(t),
  };
}

export async function newPost(repo: SocialRepo, authorId: string, at: Date, body = "hello", extra: { replyToId?: string; quoteOfId?: string } = {}) {
  return repo.createPost({ authorId, body, replyToId: extra.replyToId ?? null, quoteOfId: extra.quoteOfId ?? null, now: at });
}
