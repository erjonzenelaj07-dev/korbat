import { sql } from "drizzle-orm";
import pino from "pino";
import { expect } from "vitest";
import type { ExploreFormula, ExplorePage } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps } from "../../src/social/context";
import { createSocialRepo, type ExploreRefresh, type SocialRepo } from "../../src/social/repo";
import { newPost, newProfile } from "./social-fixtures";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * The integration suites share one database, so Explore's suites rank as of times in pasts of their own (the ranking
 * suite from 2020, the job suite from 2021, the read suite from 2022, the HTTP suite from 2023): every row another suite
 * writes is dated around the time it runs, after every ranking here, and never enters. Each test ranks in a span of ten
 * days of its own, so no test's posts or engagement fall in another test's 48-hour window either.
 */
export const SPAN = 10 * DAY;

/** Hands out the refresh time of each new test: three days into the next span of ten days from `epoch`. */
export function spans(epoch: number): () => Date {
  let next = 0;
  return () => new Date(epoch + next++ * SPAN + 3 * DAY);
}

export const before = (at: Date, ms: number): Date => new Date(at.getTime() - ms);
export const after = (at: Date, ms: number): Date => new Date(at.getTime() + ms);

/** Accounts created a month before `asOf`: old enough for every like or repost they make around it to count. */
export function accounts(db: Db, asOf: Date, n: number) {
  return Promise.all(Array.from({ length: n }, () => newProfile(db, { createdAt: before(asOf, 30 * DAY) })));
}

/** Each of `users` likes the post at `at`, through the repository. */
export async function likedBy(repo: SocialRepo, postId: string, users: { id: string }[], at: Date): Promise<void> {
  for (const user of users) expect(await repo.like(user.id, postId, at)).toBe(true);
}

/** A top-level post by `author` written at `at` and liked by each of `fans` at `likedAt`; with three fans or more it ranks. */
export async function approvedPost(repo: SocialRepo, author: { id: string }, at: Date, fans: { id: string }[], likedAt: Date): Promise<string> {
  const id = await newPost(repo, author.id, at);
  await likedBy(repo, id, fans, likedAt);
  return id;
}

/** A round that must rank; its answer, whose generation the test reads. */
export async function rank(repo: SocialRepo, asOf: Date, formula?: ExploreFormula): Promise<Extract<ExploreRefresh, { skipped: false }>> {
  const result = await repo.refreshExplore(asOf, formula);
  if (result.skipped) throw new Error("the round skipped");
  return result;
}

/** The posts of a ranking in order, as the refresh wrote them. */
export async function listed(db: Db, generation: number): Promise<string[]> {
  const rows = (await db.execute(sql`select post_id from explore_items where generation = ${generation} order by position`)) as unknown as { post_id: string }[];
  return rows.map((row) => row.post_id);
}

/** The posts of an Explore page, in its order. */
export const pageIds = (page: ExplorePage): string[] => page.items.map((item) => item.post.id);

/**
 * The social module's dependencies on this database, as the flows take them, with a clock the test sets: the author's
 * status judges "now" by it, and a write made through a flow is dated by it.
 */
export function exploreDeps(db: Db) {
  let now = new Date(0);
  const deps: SocialDeps = {
    repo: createSocialRepo(db),
    media: WITHOUT_MEDIA,
    limits: new MemoryStore(() => now.getTime()),
    log: pino({ level: "silent" }),
    now: () => now,
  };
  return {
    deps,
    repo: deps.repo,
    setNow: (at: Date) => {
      now = at;
    },
  };
}
