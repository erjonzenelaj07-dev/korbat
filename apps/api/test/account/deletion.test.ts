import { randomUUID } from "node:crypto";
import pino from "pino";
import { describe, expect, test } from "vitest";
import type { DbTx } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { confirmDeletion, purge, startDeletion } from "../../src/account/flows/deletion";
import { PURGE_INTERVAL_MS, createPurgeJob, purgePending } from "../../src/account/purge";
import { AuthError, type Session } from "../../src/auth";
import type { RequestContext } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryJobLock } from "../../src/lib/jobs";
import { MemoryStore } from "../../src/middleware/rate-limit";

const T0 = 1_789_000_000_000;

interface LogLine {
  level: number;
  msg: string;
  userId?: string;
  purged?: number;
  failed?: number;
}

/**
 * The deletion flows and the purge job on stateful fakes of the three module interfaces: the auth
 * fake knows one account whose handle is "ada" and keeps deleted_at and purged_at per account; the
 * social fake keeps which profiles were purged and can be told to fail once for an account, before its
 * transaction does anything or at its commit (which puts back the image rows the transaction took, as a
 * rollback would); the media fake holds image ids per owner and hands them out once, and can be told to
 * fail a request for files once. Every call is logged in order, the commit of the social purge's
 * transaction included, and the transaction it opens is a sentinel the media fake must be handed.
 */
function harness() {
  let t = T0;
  const calls: string[] = [];
  const lines: LogLine[] = [];
  const users = new Map<string, { deletedAt: Date | null; purgedAt: Date | null }>();
  const purgedProfiles = new Map<string, Date>();
  const failing = new Set<string>();
  const failingCommit = new Set<string>();
  /** 3f: the accounts whose address the auth module holds for a report to the authorities. */
  const held = new Set<string>();
  /** When set, the next request for files fails, as it does while the uploads volume cannot be written. */
  const failingRequest = { once: false };
  const images = new Map<string, string[]>();
  const requested: string[][] = [];
  const started: { session: Session; ctx: RequestContext }[] = [];
  const tx = { sentinel: randomUUID() } as unknown as DbTx;
  const seenTx: unknown[] = [];
  const deps: AccountDeps = {
    auth: {
      startDeletion: async (session, ctx) => {
        calls.push("auth.startDeletion");
        started.push({ session, ctx });
        return { flowId: `flow-${session.userId}` };
      },
      // 3e: a terminated account's take-down; the harness's moderation fake decides when it is called.
      takeDownTerminated: async () => false,
      confirmDeletion: async (session, input) => {
        calls.push("auth.confirmDeletion");
        if (input.handle.toLowerCase() !== "ada") throw new AuthError("invalid_request", 400, "handle_mismatch");
        const user = users.get(session.userId);
        if (!user || user.deletedAt) throw new AuthError("invalid_credentials", 401);
        user.deletedAt = new Date(t);
      },
      pendingPurges: async () => {
        calls.push("auth.pendingPurges");
        return [...users].filter(([, user]) => user.deletedAt && !user.purgedAt).map(([id]) => id);
      },
      finishPurge: async (userId) => {
        calls.push("auth.finishPurge");
        const user = users.get(userId);
        // As the real statement: a row already purged, or never deleted, is left alone. 3f: an address held for a report
        // waits, and the answer says so.
        if (!user?.deletedAt || user.purgedAt) return "none";
        if (held.has(userId)) return "held";
        user.purgedAt = new Date(t);
        return "purged";
      },
      exportAccount: async () => {
        throw new Error("not exercised here");
      },
      appendEvent: async () => undefined,
    },
    social: {
      purgeProfile: async (userId, now, within) => {
        calls.push("social.purgeProfile");
        if (failing.delete(userId)) throw new Error("the social purge failed");
        const rowsBefore = images.get(userId);
        await within(tx);
        if (failingCommit.delete(userId)) {
          calls.push("social.rollback");
          if (rowsBefore) images.set(userId, rowsBefore);
          throw new Error("the social purge's commit failed");
        }
        calls.push("social.commit");
        if (!purgedProfiles.has(userId)) purgedProfiles.set(userId, now);
      },
      exportProfile: async () => {
        throw new Error("not exercised here");
      },
    },
    media: {
      purgeOwner: async (within, ownerId) => {
        calls.push("media.purgeOwner");
        seenTx.push(within);
        const ids = images.get(ownerId) ?? [];
        images.delete(ownerId);
        return ids;
      },
      requestDeletion: async (ids) => {
        calls.push(`media.requestDeletion(${ids.length})`);
        if (failingRequest.once) {
          failingRequest.once = false;
          throw new Error("EROFS: the uploads volume cannot be written");
        }
        requested.push([...ids]);
      },
      exportImages: async () => [],
    },
    limits: new MemoryStore(() => t),
    log: pino({ level: "info" }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) }),
    now: () => new Date(t),
  };
  /** An onboarded account, live unless told otherwise, with a session that just proved a credential. */
  function account(options: { deletedAt?: Date; images?: string[] } = {}): { userId: string; session: Session } {
    const userId = randomUUID();
    users.set(userId, { deletedAt: options.deletedAt ?? null, purgedAt: null });
    if (options.images) images.set(userId, options.images);
    const session: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: new Date(t),
      handle: randomUUID(),
      factors: { email: t },
      passkeyId: null,
    };
    return { userId, session };
  }
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: "test" };
  return {
    deps,
    calls,
    lines,
    users,
    purgedProfiles,
    failing,
    failingCommit,
    failingRequest,
    held,
    images,
    requested,
    started,
    tx,
    seenTx,
    ctx,
    account,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("account deletion: the flows", () => {
  test("the start step hands the session and the request context to the auth module and answers its flow id", async () => {
    const h = harness();
    const ada = h.account();
    expect(await startDeletion(h.deps, ada.session, h.ctx)).toEqual({ flowId: `flow-${ada.userId}` });
    expect(h.started).toEqual([{ session: ada.session, ctx: h.ctx }]);
    expect(h.calls).toEqual(["auth.startDeletion"]);
  });

  test("confirming runs the auth confirmation, then the social purge with the media detach inside its transaction, then, after its commit, the file deletion requests, then the auth purge, in that order", async () => {
    const h = harness();
    const [imageA, imageB] = [randomUUID(), randomUUID()];
    const ada = h.account({ images: [imageA, imageB] });
    await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "Ada" });
    expect(h.calls).toEqual(["auth.confirmDeletion", "social.purgeProfile", "media.purgeOwner", "social.commit", "media.requestDeletion(2)", "auth.finishPurge"]);
    // The image rows go in the social purge's own transaction, and their files are asked for only once it has committed,
    // for exactly the rows it deleted: a transaction that does not commit has asked for nothing.
    expect(h.seenTx).toEqual([h.tx]);
    expect(h.requested).toEqual([[imageA, imageB]]);
    expect(h.purgedProfiles.get(ada.userId)).toEqual(h.now());
    expect(h.users.get(ada.userId)).toEqual({ deletedAt: h.now(), purgedAt: h.now() });
    expect(await h.deps.auth.pendingPurges()).toEqual([]);
    expect(h.lines.filter((line) => line.level >= 40)).toEqual([]);
  });

  test("a refused confirmation purges nothing", async () => {
    const h = harness();
    const ada = h.account({ images: [randomUUID()] });
    const refused = await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "not_ada" }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AuthError);
    expect((refused as AuthError).message).toBe("handle_mismatch");
    expect(h.calls).toEqual(["auth.confirmDeletion"]);
    expect(h.users.get(ada.userId)).toEqual({ deletedAt: null, purgedAt: null });
    expect(h.images.get(ada.userId)).toHaveLength(1);
  });

  test("a purge that fails after the confirmation is logged and the confirmation still succeeds; the account stays pending for the job", async () => {
    const h = harness();
    const ada = h.account({ images: [randomUUID()] });
    h.failing.add(ada.userId);
    await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "ada" });
    expect(h.calls).toEqual(["auth.confirmDeletion", "social.purgeProfile"]);
    expect(h.requested).toEqual([]);
    expect(h.users.get(ada.userId)).toEqual({ deletedAt: h.now(), purgedAt: null });
    expect(await h.deps.auth.pendingPurges()).toEqual([ada.userId]);
    const errors = h.lines.filter((line) => line.level >= 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.userId).toBe(ada.userId);
    expect(errors[0]!.msg).toMatch(/purge/);
  });

  test("the purge is safe to repeat: a second run detaches nothing, requests no deletion, and leaves the purged row as it was", async () => {
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000), images: [randomUUID()] });
    await purge(h.deps, ada.userId);
    const first = { ...h.users.get(ada.userId)!, profilePurgedAt: h.purgedProfiles.get(ada.userId) };
    expect(first).toEqual({ deletedAt: new Date(T0 - 60_000), purgedAt: h.now(), profilePurgedAt: h.now() });
    h.calls.length = 0;
    h.advance(60_000);
    await purge(h.deps, ada.userId);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "social.commit", "media.requestDeletion(0)", "auth.finishPurge"]);
    expect(h.requested).toEqual([[expect.any(String)], []]);
    expect({ ...h.users.get(ada.userId)!, profilePurgedAt: h.purgedProfiles.get(ada.userId) }).toEqual(first);
  });

  test("a purge whose transaction fails at the commit has asked for no file: its rows are back, a report may keep them, and only the run that commits asks", async () => {
    const h = harness();
    const [imageA, imageB] = [randomUUID(), randomUUID()];
    const ada = h.account({ deletedAt: new Date(T0 - 60_000), images: [imageA, imageB] });
    h.failingCommit.add(ada.userId);
    await expect(purge(h.deps, ada.userId)).rejects.toThrow(/commit/);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "social.rollback"]);
    expect(h.requested).toEqual([]);
    expect(h.users.get(ada.userId)!.purgedAt).toBeNull();
    await purge(h.deps, ada.userId);
    expect(h.requested).toEqual([[imageA, imageB]]);
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
  });

  test("a request for files that fails after the commit is logged with the account and does not keep the purge from finishing: the media module still owes it", async () => {
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000), images: [randomUUID(), randomUUID()] });
    h.failingRequest.once = true;
    await purge(h.deps, ada.userId);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "social.commit", "media.requestDeletion(2)", "auth.finishPurge"]);
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
    const errors = h.lines.filter((line) => line.level >= 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.userId).toBe(ada.userId);
    expect(errors[0]!.msg).toMatch(/files .* could not be requested/);
    // A rerun finds no row left, so nothing here asks again: the request is the media module's to repeat.
    expect(h.requested).toEqual([]);
  });
});

describe("the purge job", () => {
  test("purges every pending account, counts the ones that failed, and finishes on the next round what failed once", async () => {
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 120_000), images: [randomUUID()] });
    const bob = h.account({ deletedAt: new Date(T0 - 60_000) });
    h.account();
    h.failing.add(ada.userId);

    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 1, terminated: 0, held: 0 });
    expect(h.users.get(ada.userId)!.purgedAt).toBeNull();
    expect(h.users.get(bob.userId)!.purgedAt).toEqual(h.now());
    expect(await h.deps.auth.pendingPurges()).toEqual([ada.userId]);
    // The failure is logged with the account, and the round with its counts.
    expect(h.lines.filter((line) => line.level >= 50).map((line) => line.userId)).toEqual([ada.userId]);
    expect(h.lines.filter((line) => line.purged !== undefined).map((line) => [line.purged, line.failed])).toEqual([[1, 1]]);

    h.advance(PURGE_INTERVAL_MS);
    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 0, terminated: 0, held: 0 });
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
    expect(h.requested).toEqual([[], [expect.any(String)]]);
    expect(await h.deps.auth.pendingPurges()).toEqual([]);
    // A round with nothing to do reports zeros and logs nothing.
    h.lines.length = 0;
    expect(await purgePending(h.deps)).toEqual({ purged: 0, failed: 0, terminated: 0, held: 0 });
    expect(h.lines).toEqual([]);
  });

  test("3f: an account whose address is held for a report is counted as held, not purged, stays pending each round, and is purged once the hold ends", async () => {
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000) });
    const bob = h.account({ deletedAt: new Date(T0 - 30_000) });
    h.held.add(ada.userId);
    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 0, terminated: 0, held: 1 });
    expect(h.users.get(ada.userId)!.purgedAt).toBeNull();
    expect(h.users.get(bob.userId)!.purgedAt).toEqual(h.now());
    // Each round runs the purge again, which changes nothing, and counts the account as held again.
    h.advance(PURGE_INTERVAL_MS);
    expect(await purgePending(h.deps)).toEqual({ purged: 0, failed: 0, terminated: 0, held: 1 });
    // The record is sent, declined or seven days old: the next round overwrites the address.
    h.held.delete(ada.userId);
    h.advance(PURGE_INTERVAL_MS);
    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 0, terminated: 0, held: 0 });
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
  });

  test("3e: the round first takes down the terminations that are due, adds what failed to `failed`, and purges the deletions whatever happened there", async () => {
    const h = harness();
    const bob = h.account({ deletedAt: new Date(T0 - 60_000) });
    const taken: string[] = [];
    // The moderation module's step: it calls the auth module's take-down for each account due, and counts.
    h.deps.moderation = {
      takeDownDue: async (takeDown) => {
        h.calls.push("moderation.takeDownDue");
        const made = await takeDown("terminated-1", { decidedAt: new Date(T0 - 1), imagesSealed: false });
        if (made) taken.push("terminated-1");
        return { terminated: made ? 1 : 0, failed: 1 };
      },
      forgetAccount: async () => undefined,
      exportFor: async () => {
        throw new Error("not exercised by the purge");
      },
    };
    h.deps.auth = { ...h.deps.auth, takeDownTerminated: async () => true };
    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 1, terminated: 1, held: 0 });
    expect(taken).toEqual(["terminated-1"]);
    expect(h.calls[0]).toBe("moderation.takeDownDue");
    expect(h.users.get(bob.userId)!.purgedAt).toEqual(h.now());
    // A step that throws as a whole is logged, and the person's own deletion is purged all the same.
    const carl = h.account({ deletedAt: new Date(T0 - 30_000) });
    h.deps.moderation = { ...h.deps.moderation, takeDownDue: async () => Promise.reject(new Error("the moderation module is down")) };
    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 0, terminated: 0, held: 0 });
    expect(h.users.get(carl.userId)!.purgedAt).toEqual(h.now());
    expect(h.lines.some((line) => line.level >= 50 && /terminations due/.test(String(line.msg)))).toBe(true);
  });

  test("runs every five minutes under the lock job:account-purge, and skips a round another instance holds", async () => {
    expect(PURGE_INTERVAL_MS).toBe(5 * 60_000);
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000) });
    const lock = new MemoryJobLock(() => Date.now());
    const job = createPurgeJob(h.deps, lock);
    await lock.acquire("job:account-purge", "other", 10_000);
    expect(await job.round()).toBe("skipped");
    expect(h.calls).toEqual([]);
    await lock.release("job:account-purge", "other");
    expect(await job.round()).toBe("ran");
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
    expect(await lock.acquire("job:account-purge", "other", 10_000)).toBe(true);
  });
});

describe("the purge and the reports the account sent (3c design, section 7.10)", () => {
  /** The harness with the moderation module's interface for this one: the forgetting is logged with the other calls, and can be made to fail. */
  function withModeration() {
    const h = harness();
    const forgotten: string[] = [];
    const failing = new Set<string>();
    h.deps.moderation = {
      // 3e: no termination is due in these tests.
      takeDownDue: async () => ({ terminated: 0, failed: 0 }),
      forgetAccount: async (userId) => {
        h.calls.push("moderation.forgetAccount");
        if (failing.delete(userId)) throw new Error("the forgetting failed");
        forgotten.push(userId);
      },
      // The export's side of the interface is not exercised by the purge; test/account/export.test.ts covers it.
      exportFor: async () => {
        throw new Error("not exercised by the deletion");
      },
    };
    return { ...h, forgotten, failingForget: failing };
  }

  test("the reporter links are forgotten after the social purge has committed and before the account counts as purged", async () => {
    const h = withModeration();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000), images: [randomUUID()] });
    await purge(h.deps, ada.userId);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "social.commit", "media.requestDeletion(1)", "moderation.forgetAccount", "auth.finishPurge"]);
    expect(h.forgotten).toEqual([ada.userId]);
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
  });

  test("a forgetting that fails leaves the account pending, and the next run does every step again and finishes", async () => {
    const h = withModeration();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000) });
    h.failingForget.add(ada.userId);
    await expect(purge(h.deps, ada.userId)).rejects.toThrow(/forgetting/);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "social.commit", "media.requestDeletion(0)", "moderation.forgetAccount"]);
    expect(h.users.get(ada.userId)!.purgedAt).toBeNull();
    expect(await h.deps.auth.pendingPurges()).toEqual([ada.userId]);
    // The job's next round: the same steps, and this time the account is purged.
    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 0, terminated: 0, held: 0 });
    expect(h.forgotten).toEqual([ada.userId]);
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
  });

  test("the confirmation purges through the same steps: the owner's request answers once their reports are forgotten too", async () => {
    const h = withModeration();
    const ada = h.account();
    await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "ada" });
    expect(h.calls).toEqual(["auth.confirmDeletion", "social.purgeProfile", "media.purgeOwner", "social.commit", "media.requestDeletion(0)", "moderation.forgetAccount", "auth.finishPurge"]);
    expect(h.forgotten).toEqual([ada.userId]);
  });
});
