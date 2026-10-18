import pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ACCOUNT_ITEM_SCOPE, ACCOUNT_MEASURE_SCOPE, ACCOUNT_SUSPECT_SCOPE, ALREADY_NOT_SHOWN, OUTCOME_PHRASES, QUOTE_ITEM_SCOPE, SUSPECT_NO_SEAL, SUSPECT_OUTCOME_PHRASES, UNSEEN_NO_ACTION } from "@korbat/contracts";
import { RULEBOOKS } from "@korbat/rules";
import type { JobLock } from "../src/lib/jobs";
import { MemoryStore } from "../src/middleware/rate-limit";
import { createModeration, type CreateModerationOptions } from "../src/moderation";
import { ALERT_MAIL_JOB, ALERT_TICK_INTERVAL_MS, ALERT_TICK_JOB, createAlertMailJob, createAlertTick } from "../src/moderation/alerts";
import { DISPATCH_INTERVAL_MS, DISPATCH_JOB, WAITING_ALERT_KEY, WAITING_ALERT_WINDOW_MS, stillCalls, updateLine } from "../src/moderation/dispatch";
import type { OutcomeLineRow, UrgentItemRow } from "../src/moderation/repo";

/**
 * The dispatch job's rules that need no database (3c design, sections 5, 7.8 and 7.12): which unanswered item of the
 * urgent lane still calls for someone, what each field of a daily update's line says, and how the job is started. The
 * rounds themselves run against the database in test/integration/moderation-dispatch.test.ts.
 */

const config = { APP_ORIGIN: "http://localhost:8081" } as CreateModerationOptions["config"];

describe("which unanswered item of the urgent lane still calls for someone", () => {
  const item = (over: Partial<UrgentItemRow> = {}): UrgentItemRow => ({
    caseId: "c",
    targetType: "post",
    targetId: "t",
    suspect: false,
    arrivedMs: 1_000,
    interimAfter: false,
    noteAfter: false,
    declinedAfter: false,
    newestDeclinedMs: null,
    postHidden: false,
    ...over,
  });
  const served = (newestServedAt: number | null = 500) => ({ served: 1, newestServedAt: newestServedAt === null ? null : new Date(newestServedAt) });
  const none = { served: 0, newestServedAt: null };

  test("a suspect item whose case reaches a served image: only a recorded choice not to seal ends it, and only for the images of posts created before it", () => {
    const suspect = (over: Partial<UrgentItemRow> = {}) => item({ suspect: true, ...over });
    expect(stillCalls(suspect(), served())).toBe(true);
    // Not a note, not a decision taken while deciding: some reader is still served the images.
    expect(stillCalls(suspect({ noteAfter: true, interimAfter: true }), served())).toBe(true);
    expect(stillCalls(suspect({ declinedAfter: true, newestDeclinedMs: 2_000 }), served(1_500))).toBe(false);
    // A post with a served image created after the newest recorded choice starts it again,
    expect(stillCalls(suspect({ declinedAfter: true, newestDeclinedMs: 2_000 }), served(2_001))).toBe(true);
    // also one created in the same millisecond: the alert errs on the side of repeating.
    expect(stillCalls(suspect({ declinedAfter: true, newestDeclinedMs: 2_000 }), served(2_000))).toBe(true);
    // A choice recorded before the item arrived says nothing about the item.
    expect(stillCalls(suspect({ declinedAfter: false, newestDeclinedMs: 900 }), served(100))).toBe(true);
    // What the case reaches must have been read for a suspect item.
    expect(() => stillCalls(suspect(), null)).toThrow();
  });

  test("a suspect item whose case reaches no served image: a decision taken while deciding, a note or a recorded choice not to seal after it arrived ends it", () => {
    const suspect = (over: Partial<UrgentItemRow> = {}) => item({ suspect: true, ...over });
    expect(stillCalls(suspect(), none)).toBe(true);
    expect(stillCalls(suspect({ interimAfter: true }), none)).toBe(false);
    expect(stillCalls(suspect({ noteAfter: true }), none)).toBe(false);
    expect(stillCalls(suspect({ declinedAfter: true, newestDeclinedMs: 2_000 }), none)).toBe(false);
  });

  test("any other item: a decision taken while deciding ends it; a note does only when the case is about an account or its post is not visible", () => {
    expect(stillCalls(item(), null)).toBe(true);
    expect(stillCalls(item({ interimAfter: true }), null)).toBe(false);
    // On a visible post a note never ends it.
    expect(stillCalls(item({ noteAfter: true }), null)).toBe(true);
    expect(stillCalls(item({ noteAfter: true, postHidden: true }), null)).toBe(false);
    expect(stillCalls(item({ noteAfter: true, targetType: "account" }), null)).toBe(false);
    // A recorded choice not to seal is about images: it says nothing about a threat.
    expect(stillCalls(item({ declinedAfter: true, newestDeclinedMs: 2_000, postHidden: true }), null)).toBe(true);
  });
});

describe("one line of the daily update", () => {
  const row = (over: Partial<OutcomeLineRow> = {}): OutcomeLineRow => ({
    id: "i",
    intakeId: "n",
    ref: "N-ABCDEFGH23",
    contactId: "k",
    reporterId: null,
    position: 1,
    targetType: "post",
    targetId: "11111111-1111-4111-8111-111111111111",
    namedHandle: null,
    hasCase: true,
    suspect: false,
    shownOutcome: "no_violation",
    changed: false,
    reexamines: false,
    byDecision: true,
    reexamined: false,
    ruleId: null,
    rulesVersion: 2,
    decisionUnseen: false,
    sealed: false,
    retired: false,
    measure: false,
    noEffect: false,
    quotes: false,
    ...over,
  });
  const line = (over: Partial<OutcomeLineRow> = {}) => updateLine({ config }, row(over));

  test("a moderator's decision to take no action can be re-examined once: its line says so, with the item's reference, position and korbat address", () => {
    expect(line()).toEqual({
      ref: "N-ABCDEFGH23",
      item: 1,
      link: "http://localhost:8081/post/11111111-1111-4111-8111-111111111111",
      outcome: `${OUTCOME_PHRASES.no_violation}.`,
      reexamination: false,
      changed: false,
      reexaminable: true,
      unseen: false,
      automatic: false,
    });
    expect(line({ shownOutcome: "not_evident" })).toMatchObject({ outcome: `${OUTCOME_PHRASES.not_evident}.`, reexaminable: true });
    // Asked for already, it cannot be asked again.
    expect(line({ reexamined: true }).reexaminable).toBe(false);
    // An account's address is built from the handle as the notice named it.
    expect(line({ targetType: "account", namedHandle: "old_name" })).toMatchObject({ link: "http://localhost:8081/u/old_name", outcome: `${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}` });
  });

  test("3e: an item about an account that a retirement answered reads the retired phrase in place of ACCOUNT_ITEM_SCOPE (W.1); a suspect item keeps its own scope", () => {
    const retired = { targetType: "account" as const, namedHandle: "imposter", shownOutcome: "restricted_rule", ruleId: "R4", rulesVersion: 3, retired: true };
    const outcome = line(retired).outcome;
    expect(outcome.startsWith("access restricted: it breaks korbat rule R4 (")).toBe(true);
    expect(outcome.endsWith(`). ${ACCOUNT_MEASURE_SCOPE.retired}`)).toBe(true);
    expect(outcome).not.toContain(ACCOUNT_ITEM_SCOPE);
    // The handle given back: the reversal's phrase alone.
    expect(line({ ...retired, shownOutcome: "reversed", changed: true }).outcome).toBe(`${OUTCOME_PHRASES.reversed}.`);
    // A retirement never reaches an item about a post, and a suspect item about an account keeps its own scope.
    expect(line({ retired: true }).outcome).toBe(`${OUTCOME_PHRASES.no_violation}.`);
    expect(line({ ...retired, suspect: true }).outcome).toContain(ACCOUNT_SUSPECT_SCOPE);
  });

  test("3e: an item about an account that a suspension at once answered reads ACCOUNT_MEASURE_SCOPE.measure through a scope of its own, which names no suspension; a retirement in the same decision reads the retired phrase", () => {
    const answered = { targetType: "account" as const, namedHandle: "flooder", shownOutcome: "restricted_rule", ruleId: "R6", rulesVersion: 3, measure: true };
    const outcome = line(answered).outcome;
    expect(outcome.endsWith(`). ${ACCOUNT_MEASURE_SCOPE.measure}`)).toBe(true);
    expect(outcome).not.toContain(ACCOUNT_ITEM_SCOPE);
    expect(outcome).not.toMatch(/suspen|terminat|days|until/i);
    expect(line({ ...answered, retired: true }).outcome.endsWith(ACCOUNT_MEASURE_SCOPE.retired)).toBe(true);
    // A reversal of that decision, an item about a post, and a suspect item keep their own words.
    expect(line({ ...answered, shownOutcome: "reversed", changed: true }).outcome).toBe(`${OUTCOME_PHRASES.reversed}.`);
    expect(line({ measure: true }).outcome).toBe(`${OUTCOME_PHRASES.no_violation}.`);
    expect(line({ ...answered, suspect: true }).outcome).toContain(ACCOUNT_SUSPECT_SCOPE);
  });

  test("a re-examination's answer, a changed outcome and a link that named nothing are each marked, and none can be re-examined", () => {
    expect(line({ reexamines: true })).toMatchObject({ reexamination: true, reexaminable: false, unseen: false });
    expect(line({ shownOutcome: "reversed", changed: true })).toMatchObject({ outcome: `${OUTCOME_PHRASES.reversed}.`, changed: true, reexaminable: false });
    expect(line({ shownOutcome: "partly_reversed", changed: true }).outcome).toBe(`${OUTCOME_PHRASES.partly_reversed}.`);
    expect(line({ shownOutcome: "not_available", hasCase: false, byDecision: false })).toMatchObject({ outcome: `${OUTCOME_PHRASES.not_available}.`, automatic: true, reexaminable: false });
    // After "not available" no scope sentence follows, whatever the link named.
    expect(line({ shownOutcome: "not_available", hasCase: false, byDecision: false, targetType: "account", namedHandle: "nobody" }).outcome).toBe(`${OUTCOME_PHRASES.not_available}.`);
  });

  test("a line that reads UNSEEN_NO_ACTION carries unseen and leaves the re-examination unspent, also as a re-examination's answer; asked again before a retried mail went out, it still carries unseen", () => {
    expect(line({ decisionUnseen: true })).toMatchObject({ outcome: UNSEEN_NO_ACTION, unseen: true, reexaminable: true });
    expect(line({ decisionUnseen: true, reexamines: true })).toMatchObject({ outcome: UNSEEN_NO_ACTION, reexamination: true, unseen: true, reexaminable: true });
    expect(line({ decisionUnseen: true, reexamines: true, reexamined: true })).toMatchObject({ reexamination: true, unseen: true, reexaminable: false });
    // An item about an account is never worded this way, whatever its answering decision carries: its answer concerns
    // the display name and bio, which staff read. As a re-examination's answer it leaves nothing to ask again.
    expect(line({ targetType: "account", namedHandle: "a_name", decisionUnseen: true })).toMatchObject({ outcome: `${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}`, unseen: false, reexaminable: true });
    expect(line({ targetType: "account", namedHandle: "a_name", decisionUnseen: true, reexamines: true })).toMatchObject({ unseen: false, reexamination: true, reexaminable: false });
    // A restriction decided with the images out of sight is no such line, nor is a suspect item's own answer.
    expect(line({ decisionUnseen: true, shownOutcome: "restricted_legal" })).toMatchObject({ outcome: `${OUTCOME_PHRASES.restricted_legal}.`, unseen: false });
    expect(line({ decisionUnseen: true, suspect: true })).toMatchObject({ outcome: SUSPECT_OUTCOME_PHRASES.no_action, unseen: false });
  });

  test("a restriction names its rule in the rulebook the decision was made under, reads the sealed phrase after a seal, and says when it changed nothing", () => {
    const [v1, v2] = [RULEBOOKS[1].find((rule) => rule.id === "R6")!, RULEBOOKS[2].find((rule) => rule.id === "R6")!];
    expect(v1.title).not.toBe(v2.title);
    expect(line({ shownOutcome: "restricted_rule", ruleId: "R6", rulesVersion: 1 }).outcome).toBe(`access restricted: it breaks korbat rule R6 (${v1.title}).`);
    expect(line({ shownOutcome: "restricted_rule", ruleId: "R6", rulesVersion: 2 }).outcome).toBe(`access restricted: it breaks korbat rule R6 (${v2.title}).`);
    expect(line({ shownOutcome: "restricted_legal", noEffect: true, quotes: true }).outcome).toBe(`${OUTCOME_PHRASES.restricted_legal}. ${ALREADY_NOT_SHOWN} ${QUOTE_ITEM_SCOPE}`);
    // Whatever the item's own ground, a decision that holds a seal is worded with the sealed phrase; about an account, with the suspect scope.
    expect(line({ shownOutcome: "restricted_rule", ruleId: "R2", sealed: true }).outcome).toBe(SUSPECT_OUTCOME_PHRASES.sealed);
    expect(line({ shownOutcome: "restricted_legal", sealed: true, targetType: "account", namedHandle: "name" }).outcome).toBe(`${SUSPECT_OUTCOME_PHRASES.sealed} ${ACCOUNT_SUSPECT_SCOPE}`);
    // A finding's item restricted by a measure on the text, without a seal.
    expect(line({ shownOutcome: "restricted_rule", ruleId: "R1", suspect: true }).outcome).toBe(`access restricted: it breaks korbat rule R1 (${RULEBOOKS[2][0].title}). ${SUSPECT_NO_SEAL}`);
    // A suspect item about a quoting post has an item of its own for the quoted post, and no quote scope.
    expect(line({ suspect: true, quotes: true }).outcome).toBe(SUSPECT_OUTCOME_PHRASES.no_action);
  });

  test("a restriction under a rule that no rulebook korbat holds has cannot be worded: the line is refused, never guessed", () => {
    expect(() => line({ shownOutcome: "restricted_rule", ruleId: "R9", rulesVersion: 2 })).toThrow();
    expect(() => line({ shownOutcome: "restricted_rule", ruleId: "R1", rulesVersion: 99 })).toThrow();
    expect(() => line({ shownOutcome: "restricted_rule", ruleId: null })).toThrow();
  });
});

describe("the module's background work", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The module over stand-ins that fail the test when a round touches them, and a lock that only records what it is asked. */
  function world(acquire: boolean, retention: "on" | "off" = "off") {
    const asked: { key: string; ttlMs: number }[] = [];
    const lock: JobLock = {
      acquire: async (key, _token, ttlMs) => {
        asked.push({ key, ttlMs });
        return acquire;
      },
      refresh: async () => undefined,
      release: async () => undefined,
    };
    const untouched = new Proxy({}, { get: () => () => Promise.reject(new Error("a round ran")) });
    const moderation = createModeration({
      apiDb: untouched as CreateModerationOptions["apiDb"],
      auth: untouched as CreateModerationOptions["auth"],
      social: untouched as CreateModerationOptions["social"],
      media: untouched as CreateModerationOptions["media"],
      rateLimitStore: new MemoryStore(),
      config: { ...config, MODERATION_RETENTION: retention } as CreateModerationOptions["config"],
      logger: pino({ level: "silent" }),
    });
    /** What the lock was asked for one job. */
    const of = (job: string) => asked.filter((entry) => entry.key === `job:${job}`);
    return { moderation, lock, asked, of };
  }

  test("startJobs runs the dispatch job under its own lock every ten minutes, from the end of the round before, until it is stopped", async () => {
    vi.useFakeTimers();
    // Another instance holds the lock: this one asks for it at every turn and runs no round.
    const w = world(false);
    const stop = w.moderation.startJobs(w.lock);
    expect([DISPATCH_JOB, DISPATCH_INTERVAL_MS]).toEqual(["moderation-dispatch", 10 * 60_000]);
    // The first round comes ten minutes after the start, not at once.
    await vi.advanceTimersByTimeAsync(DISPATCH_INTERVAL_MS - 1);
    expect(w.of(DISPATCH_JOB)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.of(DISPATCH_JOB)).toEqual([{ key: "job:moderation-dispatch", ttlMs: DISPATCH_INTERVAL_MS }]);
    await vi.advanceTimersByTimeAsync(DISPATCH_INTERVAL_MS);
    expect(w.of(DISPATCH_JOB)).toHaveLength(2);
    stop();
    const asked = w.asked.length;
    await vi.advanceTimersByTimeAsync(3 * DISPATCH_INTERVAL_MS);
    expect(w.asked).toHaveLength(asked);
  });

  test("3f: startJobs runs the alert tick under its own lock every 30 seconds, also while retention is off, and stops it with the rest", async () => {
    vi.useFakeTimers();
    expect([ALERT_TICK_JOB, ALERT_TICK_INTERVAL_MS]).toEqual(["alert-tick", 30_000]);
    // 3f's review (operations2): the mail leg is a job of its own, under its own lock, at the same interval.
    expect(ALERT_MAIL_JOB).toBe("alert-mail");
    for (const retention of ["off", "on"] as const) {
      const w = world(false, retention);
      const stop = w.moderation.startJobs(w.lock);
      await vi.advanceTimersByTimeAsync(ALERT_TICK_INTERVAL_MS - 1);
      expect(w.of(ALERT_TICK_JOB), retention).toEqual([]);
      expect(w.of(ALERT_MAIL_JOB), retention).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(w.of(ALERT_TICK_JOB), retention).toEqual([{ key: "job:alert-tick", ttlMs: ALERT_TICK_INTERVAL_MS }]);
      expect(w.of(ALERT_MAIL_JOB), retention).toEqual([{ key: "job:alert-mail", ttlMs: ALERT_TICK_INTERVAL_MS }]);
      await vi.advanceTimersByTimeAsync(ALERT_TICK_INTERVAL_MS);
      expect(w.of(ALERT_TICK_JOB), retention).toHaveLength(2);
      expect(w.of(ALERT_MAIL_JOB), retention).toHaveLength(2);
      stop();
      await vi.advanceTimersByTimeAsync(10 * ALERT_TICK_INTERVAL_MS);
      expect(w.of(ALERT_TICK_JOB), retention).toHaveLength(2);
      expect(w.of(ALERT_MAIL_JOB), retention).toHaveLength(2);
    }
  });

  test("3f's review: a relay that never answers holds only the mail leg: alert_steps() runs again every ALERT_TICK_INTERVAL_MS while a mail waits", async () => {
    vi.useFakeTimers();
    const lock: JobLock = { acquire: async () => true, refresh: async () => undefined, release: async () => undefined };
    const asked: string[] = [];
    // A database that answers the tick's one statement, and for the mail leg one owed row and its claim.
    const execute = async (query: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(query);
      if (text.includes("alert_steps()")) {
        asked.push("alert_steps");
        return [{ written: 0 }];
      }
      if (text.includes("mailed_at is null and kind = any")) return [{ id: "1", kind: "report_owed", facts: { count: 1, oldestAt: "2026-10-16T08:00:00.000Z" } }];
      return [{ id: "1" }];
    };
    const mails: unknown[] = [];
    const deps = {
      apiDb: { execute, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute }) },
      // The relay: a mail that never returns.
      auth: { mailStaff: (message: unknown) => (mails.push(message), new Promise<number>(() => undefined)) },
      config: { NOTIFY: "off" },
      log: pino({ level: "silent" }),
    } as unknown as Parameters<typeof createAlertTick>[0];
    const stopTick = createAlertTick(deps, lock).start();
    const stopMail = createAlertMailJob(deps, lock).start();
    await vi.advanceTimersByTimeAsync(ALERT_TICK_INTERVAL_MS);
    expect([asked.length, mails.length]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(2 * ALERT_TICK_INTERVAL_MS);
    // Two more rounds of the tick; the mail leg still waits for its first send and starts no second round.
    expect([asked.length, mails.length]).toEqual([3, 1]);
    stopTick();
    stopMail();
  });

  test("the queue-age alert has a key and a window of its own: once a day", () => {
    expect([WAITING_ALERT_KEY, WAITING_ALERT_WINDOW_MS]).toEqual(["moderation-waiting", 24 * 60 * 60_000]);
  });
});
