import pino from "pino";
import { describe, expect, test } from "vitest";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps } from "../../src/social/context";
import { deletePost } from "../../src/social/flows/posts";
import type { PostRow } from "../../src/social/repo";
import { recordingEvents } from "./profile-harness";

/** An error as the driver hands PostgreSQL's over: the SQLSTATE on the cause of the query's error. */
const pgFailure = (code: string) => Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("the database's own message"), { code }) });

/**
 * The author's deletion without a database: a repository that knows one post of the author's and ends its deletion the
 * way the test says, and a media interface that records which images' files were asked for.
 */
function harness(outcomes: (Error | "deleted")[]) {
  const author = "11111111-1111-4111-8111-111111111111";
  const postId = "22222222-2222-4222-8222-222222222222";
  const calls = { deletions: 0, requested: [] as string[][] };
  const repo = {
    findPosts: async (ids: string[]) => new Map(ids.filter((id) => id === postId).map((id) => [id, { id, authorId: author } as PostRow])),
    deletePost: async (_id: string, _authorId: string, _now: Date, within?: (tx: never) => Promise<void>) => {
      const outcome = outcomes[calls.deletions++];
      if (outcome === undefined) throw new Error("the deletion ran more often than the test planned");
      if (outcome !== "deleted") throw outcome;
      await within?.(undefined as never);
      return true;
    },
  };
  const deps = {
    repo,
    media: {
      ...WITHOUT_MEDIA,
      detachAll: async () => [`image-of-run-${calls.deletions}`],
      requestDeletion: async (ids: string[]) => {
        calls.requested.push(ids);
      },
    },
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
    events: recordingEvents(),
  } as unknown as SocialDeps;
  return { deps, author, postId, calls };
}

describe("the author's deletion when the database ends it to break a deadlock", () => {
  test("it is run once more, and only the run that committed asks for its images' files", async () => {
    const h = harness([pgFailure("40P01"), "deleted"]);
    await deletePost(h.deps, h.author, h.postId);
    expect(h.calls.deletions).toBe(2);
    expect(h.calls.requested).toEqual([["image-of-run-2"]]);
  });

  test("a second deadlock is not hidden: the error is the caller's, and no file is asked for", async () => {
    const h = harness([pgFailure("40P01"), pgFailure("40P01")]);
    await expect(deletePost(h.deps, h.author, h.postId)).rejects.toMatchObject({ cause: { code: "40P01" } });
    expect(h.calls.deletions).toBe(2);
    expect(h.calls.requested).toEqual([]);
  });

  test("any other failure is not run again", async () => {
    const h = harness([pgFailure("23505")]);
    await expect(deletePost(h.deps, h.author, h.postId)).rejects.toMatchObject({ cause: { code: "23505" } });
    expect(h.calls.deletions).toBe(1);
  });
});
