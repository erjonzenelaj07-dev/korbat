import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { NOTICE_LIMITS, type NoticeRequest } from "@korbat/contracts";
import { MemoryStore, type RateLimitStore } from "../src/middleware/rate-limit";
import { ModerationError, createBackground, type ModerationDeps } from "../src/moderation/context";
import { submitNotice, type IntakeRecorded, type NoticeSender } from "../src/moderation/intake";

/**
 * What a report or a notice costs its sender of their limits when it could not be saved (3c design, section 7.1, steps 2
 * and 4), without a database: the pool is a stand-in whose transaction never runs its statements and ends the way the
 * test scripts it, with the errors PostgreSQL gives and drizzle wraps. Every request that passed the checks of its
 * sender is counted before a target is looked up, and one that a later step refuses stays counted. One that failed
 * through no fault of its sender, whose answer says "send it again", gives its hits back.
 */

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const HUMAN = "human";

/** PostgreSQL's error as drizzle hands it over: its own error, with the driver's as the cause. */
const pg = (code: string, extra: Record<string, unknown> = {}) => new Error("Failed query", { cause: Object.assign(new Error(String(extra.message ?? code)), { code, ...extra }) });
/** The four runs of an intake whose case closed under each of them: the answer is case_closed. */
const closedEveryTime = () => [pg("40001", { message: "case_closed" }), pg("40001"), pg("40P01"), pg("55P03")];

const stored: IntakeRecorded = { intakeId: randomUUID(), ref: "N-ABCDEFGH23", token: "t".repeat(43), suspect: false, items: [] };
const post = { kind: "post" as const, id: randomUUID() };
const signedOut: NoticeRequest = { ground: "rule", ruleId: "R1", targets: [post], turnstileToken: HUMAN };
const signedIn: NoticeRequest = { ground: "rule", ruleId: "R1", targets: [post] };

/** The module over a pool whose transactions end as scripted, one entry for each run, with the in-memory limit store unless another is given. */
function world(ends: unknown[], limits: RateLimitStore = new MemoryStore()) {
  let runs = 0;
  const warnings: string[] = [];
  const log = { warn: (_fields: unknown, text: string) => warnings.push(text), error: () => undefined } as unknown as ModerationDeps["log"];
  const deps = {
    apiDb: {
      // The reads outside the transaction find nothing: no target the sender reported already, no receipt to send.
      execute: async () => [],
      transaction: async () => {
        const end = ends[runs++];
        if (end instanceof Error) throw end;
        if (end === undefined) throw new Error("the transaction ran more often than the test scripted");
        return end;
      },
    },
    auth: { verifyHuman: async (token: string) => token === HUMAN },
    social: { postRef: async () => ({ authorId: randomUUID(), state: "visible", quoteOfId: null }), findAccountByHandle: async () => null },
    limits,
    background: createBackground(log),
    config: { APP_ORIGIN: "http://localhost:8081" },
    log,
    now: () => new Date(),
  } as unknown as ModerationDeps;
  return { deps, limits, warnings, runs: () => runs };
}

/** How many hits a key of the store holds, read by hitting it once more. */
const held = async (limits: RateLimitStore, key: string, windowMs: number) => (await limits.hit(key, windowMs)).count - 1;

describe("a report that could not be saved through no fault of its sender gives its limit hits back", () => {
  test("signed out: after case_closed the network's hour and day are as before, so every one of the hour's five can still be sent", async () => {
    const from: NoticeSender = { session: null, netHash: "network" };
    const w = world([...Array.from({ length: 5 }, closedEveryTime).flat(), ...Array.from({ length: NOTICE_LIMITS.signedOut.perHour }, () => stored)]);
    for (let n = 0; n < 5; n++) await expect(submitNotice(w.deps, signedOut, from)).rejects.toMatchObject({ name: "ModerationError", code: "case_closed", status: 409 });
    expect(w.runs()).toBe(20);
    // Had the five refused requests kept their hits, the hour would be used up now.
    for (let n = 0; n < NOTICE_LIMITS.signedOut.perHour; n++) expect(await submitNotice(w.deps, signedOut, from)).toEqual({ ref: stored.ref, token: stored.token });
    await expect(submitNotice(w.deps, signedOut, from)).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    // The day holds the five that were saved, and nothing of the five that were not.
    expect(await held(w.limits, "notice:day:net:network", DAY)).toBe(NOTICE_LIMITS.signedOut.perHour);
    expect(w.warnings).toEqual([]);
  });

  test("signed in: after case_closed the account's hour and day are as before", async () => {
    const userId = randomUUID();
    const from: NoticeSender = { session: { userId, role: "user", onboarded: true }, netHash: "network" };
    const w = world([...closedEveryTime(), stored]);
    await expect(submitNotice(w.deps, signedIn, from)).rejects.toMatchObject({ code: "case_closed" });
    expect([await held(w.limits, `notice:hour:account:${userId}`, HOUR), await held(w.limits, `notice:day:account:${userId}`, DAY)]).toEqual([0, 0]);
    // A report that is saved keeps its hits: the two reads above, and this one.
    expect(await submitNotice(w.deps, signedIn, from)).toEqual({ ref: stored.ref, token: stored.token });
    expect([await held(w.limits, `notice:hour:account:${userId}`, HOUR), await held(w.limits, `notice:day:account:${userId}`, DAY)]).toEqual([2, 2]);
    // The network's counts are a signed-out sender's alone.
    expect(await held(w.limits, "notice:hour:net:network", HOUR)).toBe(0);
  });

  test("an unexpected failure of the transaction is thrown as it is, and gives the hits back too", async () => {
    const from: NoticeSender = { session: null, netHash: "network" };
    for (const failure of [new Error("the connection ended"), pg("23503"), pg("P0001", { message: "quote_item_missing" })]) {
      const w = world([failure]);
      await expect(submitNotice(w.deps, signedOut, from)).rejects.toBe(failure);
      expect([await held(w.limits, "notice:hour:net:network", HOUR), await held(w.limits, "notice:day:net:network", DAY)]).toEqual([0, 0]);
    }
  });

  test("a refusal that is the sender's own keeps its hit: already reported, a link to another site, an account that is gone", async () => {
    const userId = randomUUID();
    const from: NoticeSender = { session: { userId, role: "user", onboarded: true }, netHash: "network" };
    const w = world([pg("23505", { constraint_name: "intake_items_reporter_once" }), new ModerationError("not_found")]);
    await expect(submitNotice(w.deps, signedIn, from)).rejects.toMatchObject({ code: "already_reported" });
    await expect(submitNotice(w.deps, signedIn, from)).rejects.toMatchObject({ code: "not_found" });
    await expect(submitNotice(w.deps, { ...signedIn, targets: [{ kind: "link", url: "https://elsewhere.example/u/ada" }] }, from)).rejects.toMatchObject({ code: "notice_link_offsite" });
    expect(w.runs()).toBe(2);
    expect([await held(w.limits, `notice:hour:account:${userId}`, HOUR), await held(w.limits, `notice:day:account:${userId}`, DAY)]).toEqual([3, 3]);
  });

  test("a request refused before it was counted has nothing to give back: a failed human check, a staff session, one that has not finished onboarding", async () => {
    const w = world([]);
    await expect(submitNotice(w.deps, { ...signedOut, turnstileToken: "not-human" }, { session: null, netHash: "network" })).rejects.toMatchObject({ code: "human_check_failed" });
    const userId = randomUUID();
    await expect(submitNotice(w.deps, signedIn, { session: { userId, role: "moderator", onboarded: true }, netHash: "network" })).rejects.toMatchObject({ code: "staff_cannot_report" });
    await expect(submitNotice(w.deps, signedIn, { session: { userId, role: "user", onboarded: false }, netHash: "network" })).rejects.toMatchObject({ code: "onboarding_required" });
    expect(w.runs()).toBe(0);
    expect([await held(w.limits, "notice:hour:net:network", HOUR), await held(w.limits, `notice:hour:account:${userId}`, HOUR)]).toEqual([0, 0]);
  });

  test("a hit that cannot be given back is logged without the sender's key, and the answer is still case_closed", async () => {
    const hits = new MemoryStore();
    const limits: RateLimitStore = {
      hit: (key, windowMs) => hits.hit(key, windowMs),
      release: async () => {
        throw new Error("the store went away");
      },
    };
    const w = world(closedEveryTime(), limits);
    await expect(submitNotice(w.deps, signedOut, { session: null, netHash: "network" })).rejects.toMatchObject({ code: "case_closed" });
    expect(w.warnings).toEqual(["notice: a limit hit of a request that could not be saved could not be given back", "notice: a limit hit of a request that could not be saved could not be given back"]);
    // Nothing was given back: the hits stand.
    expect(await held(hits, "notice:hour:net:network", HOUR)).toBe(1);
  });
});
