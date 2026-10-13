import { randomUUID } from "node:crypto";
import pino from "pino";
import { describe, expect, test } from "vitest";
import type { CaseDecidedParams } from "@korbat/contracts";
import { REDRESS_VERSION, RULES_VERSION } from "@korbat/rules";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../src/auth";
import { ModerationError, type ModerationDeps } from "../src/moderation/context";
import { decide } from "../src/moderation/decide";
import { recordIntake, type IntakeGround, type IntakeRecorded } from "../src/moderation/intake";
import { fileReply } from "../src/moderation/standing";

/**
 * When the moderation module runs a transaction again (3c design, sections 7.1 and 7.5), without a database: the pool is
 * a stand-in whose transaction never runs its statements and ends the way the test scripts it, with the errors PostgreSQL
 * gives and drizzle wraps. The races that produce these errors for real are in the integration tests.
 */

/** PostgreSQL's error as drizzle hands it over: its own error, with the driver's as the cause. */
const pg = (code: string, extra: Record<string, unknown> = {}) => new Error("Failed query", { cause: Object.assign(new Error(String(extra.message ?? code)), { code, ...extra }) });
const raisedAs = (message: string) => pg("P0001", { message });

/**
 * The module's dependencies over a pool whose transactions end as scripted, one entry for each run; a read finds the case
 * about an account. What a decision starts after its commit is counted and never run.
 */
function scripted(ends: (Error | unknown)[], options: { now?: Date; knowsCase?: boolean } = {}) {
  const subject = randomUUID();
  let runs = 0;
  let started = 0;
  const apiDb = {
    execute: async () => (options.knowsCase === false ? [] : [{ target_type: "account", target_id: subject }]),
    transaction: async () => {
      const end = ends[runs++];
      if (end instanceof Error) throw end;
      if (end === undefined) throw new Error("the transaction ran more often than the test scripted");
      return end;
    },
  };
  const background = { start: () => void started++, settle: async () => undefined };
  const deps = { apiDb, social: {}, background, config: {}, log: pino({ level: "silent" }), now: () => options.now ?? new Date() } as unknown as ModerationDeps;
  return { deps, runs: () => runs, started: () => started };
}

describe("the intake's transaction is run again when it changed nothing and may now succeed", () => {
  const ground: IntakeGround = {
    kind: "user",
    channel: "signed_in",
    reporterId: randomUUID(),
    findingBy: null,
    contactId: null,
    ruleId: "R1",
    allegesIllegal: false,
    csam: false,
    category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
    categoryKeyword: null,
    citedLaw: null,
    explanation: null,
    bonaFide: false,
  };
  const request = { ground, live: [{ type: "post" as const, id: randomUUID(), position: 1 }] };
  const stored: IntakeRecorded = { intakeId: randomUUID(), ref: "N-ABCDEFGHIJ", token: null, suspect: false, items: [] };

  test("a case that closed under it, a deadlock and a lock timeout each start it over, and the fourth run's answer is the intake's", async () => {
    // The attach trigger reports a closed case as a serialization failure.
    const world = scripted([pg("40001", { message: "case_closed" }), pg("40P01"), pg("55P03"), stored]);
    expect(await recordIntake(world.deps, request)).toBe(stored);
    expect(world.runs()).toBe(4);
  });

  test("a reference another intake already has starts it over too: the next run draws a new one", async () => {
    const world = scripted([pg("23505", { constraint_name: "intakes_ref_unique" }), stored]);
    expect(await recordIntake(world.deps, request)).toBe(stored);
    expect(world.runs()).toBe(2);
  });

  test("when the fourth run fails the same way the answer is case_closed, and no fifth run is made", async () => {
    const world = scripted([pg("40001"), pg("40001"), pg("40P01"), pg("55P03")]);
    await expect(recordIntake(world.deps, request)).rejects.toMatchObject({ name: "ModerationError", code: "case_closed", status: 409 });
    expect(world.runs()).toBe(4);
  });

  test("a second report by the same sender on the same ground is already_reported, at once", async () => {
    const world = scripted([pg("23505", { constraint_name: "intake_items_reporter_once" })]);
    await expect(recordIntake(world.deps, request)).rejects.toMatchObject({ name: "ModerationError", code: "already_reported" });
    expect(world.runs()).toBe(1);
  });

  test("any other error is thrown as it is, at once", async () => {
    for (const failure of [pg("23503"), pg("23505", { constraint_name: "intake_items_target_once" }), pg("P0001", { message: "quote_item_missing" }), new Error("the connection ended")]) {
      const world = scripted([failure]);
      await expect(recordIntake(world.deps, request)).rejects.toBe(failure);
      expect(world.runs()).toBe(1);
    }
  });
});

describe("a confirmed decision's transaction is run once more only when it changed nothing and time is left", () => {
  const caseId = randomUUID();
  const keyId = randomUUID();
  const session = { userId: randomUUID(), keyId, handle: randomUUID(), role: "admin" } as unknown as ActiveStaffSession;
  const params: CaseDecidedParams = {
    kind: "final",
    stateVersion: 0,
    throughSeq: 1,
    reviewsDecisionId: null,
    snapshotId: randomUUID(),
    snapshotDigest: "a".repeat(64),
    outcome: "no_violation",
    ground: null,
    ruleId: null,
    rulesVersion: RULES_VERSION,
    redressVersion: REDRESS_VERSION,
    category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
    categoryKeyword: null,
    actions: [],
    factsDigest: null,
    reasonDigest: null,
    legalReferenceDigest: null,
    unfounded: [],
    replaced: false,
  };
  const now = new Date("2026-10-04T12:00:00.000Z");
  /** A confirmation of the params whose challenge has this many seconds left. */
  const confirmed = (secondsLeft: number, changed: Partial<CaseDecidedParams> = {}): StaffStepUpConfirmed => ({
    action: "case_decided",
    target: { type: "case", id: caseId },
    params: { ...params, ...changed },
    actionHash: "b".repeat(64),
    keyId,
    assertion: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
    expiresAt: new Date(now.getTime() + secondsLeft * 1000),
  });
  const run = (world: ReturnType<typeof scripted>, secondsLeft = 600, changed: Partial<CaseDecidedParams> = {}) => decide(world.deps, session, confirmed(secondsLeft, changed), { requestId: "req-1" });
  const done = { decisionId: randomUUID() };

  test("a deadlock or a lock timeout runs it once more with the same confirmation", async () => {
    for (const code of ["40P01", "55P03"]) {
      const world = scripted([pg(code), done], { now });
      expect(await run(world), code).toBe(done);
      expect(world.runs(), code).toBe(2);
      // What follows a decision's commit is started once, for the run that committed.
      expect(world.started(), code).toBe(1);
    }
  });

  test("a second failure of that kind is answered as late, without a third run", async () => {
    const world = scripted([pg("40P01"), pg("55P03")], { now });
    expect(await run(world)).toBe("late");
    expect(world.runs()).toBe(2);
    // Nothing committed, so nothing follows: no statement is mailed and no decision counted.
    expect(world.started()).toBe(0);
  });

  test("with a minute or less of the challenge left it is not run again", async () => {
    for (const secondsLeft of [60, 5]) {
      const world = scripted([pg("40P01")], { now });
      expect(await run(world, secondsLeft), String(secondsLeft)).toBe("late");
      expect(world.runs()).toBe(1);
    }
    const world = scripted([pg("40P01"), done], { now });
    expect(await run(world, 61)).toBe(done);
  });

  test("the audit row's refusals are answers, not errors: the key or the account ended, or the challenge's time ran out", async () => {
    const [ended, late] = [scripted([raisedAs("staff_confirmation_ended")], { now }), scripted([raisedAs("staff_confirmation_late")], { now })];
    expect(await run(ended)).toBe("ended");
    expect(await run(late)).toBe("late");
    expect([ended.started(), late.started()]).toEqual([0, 0]);
  });

  test("a code a trigger raised is thrown as its ModerationError; anything else as it is", async () => {
    for (const code of ["case_changed", "staff_recused", "staff_target", "admin_required", "decision_cap", "profile_changed", "snapshot_mismatch", "snapshot_erased", "text_not_found", "invalid_decision"] as const) {
      const world = scripted([raisedAs(code)], { now });
      await expect(run(world), code).rejects.toMatchObject({ name: "ModerationError", code });
      expect(world.runs()).toBe(1);
    }
    for (const failure of [raisedAs("something_else"), pg("23503"), pg("40001")]) {
      const world = scripted([failure], { now });
      await expect(run(world)).rejects.toBe(failure);
      expect(world.runs()).toBe(1);
    }
  });

  test("a decision under other texts than the API serves is refused before anything is read or written", async () => {
    for (const changed of [{ redressVersion: REDRESS_VERSION + 1 }, { rulesVersion: RULES_VERSION - 1 }]) {
      const world = scripted([done], { now });
      await expect(run(world, 600, changed)).rejects.toMatchObject({ name: "ModerationError", code: "invalid_decision" });
      expect(world.runs()).toBe(0);
    }
  });

  test("a case that does not exist is not found", async () => {
    const world = scripted([done], { now, knowsCase: false });
    const err = await run(world).catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(ModerationError);
    expect(err).toMatchObject({ code: "not_found", status: 404 });
    expect(world.runs()).toBe(0);
  });

  test("a confirmation of anything but this decision by this session's key is a wiring fault, not a refusal", async () => {
    const world = scripted([done], { now });
    const other = { ...confirmed(600), keyId: randomUUID() };
    await expect(decide(world.deps, session, other, { requestId: "req-1" })).rejects.toThrow(/needs a step-up that confirmed it/);
    const revoked = { ...confirmed(600), action: "staff_session_revoked" } as unknown as StaffStepUpConfirmed;
    await expect(decide(world.deps, session, revoked, { requestId: "req-1" })).rejects.toThrow(/needs a step-up that confirmed it/);
    expect(world.runs()).toBe(0);
  });
});

describe("the reply's transaction is run again when it changed nothing (3e design, section 7.6 step 9)", () => {
  /** The reply's dependencies over a pool whose read finds the decision's measure and whose transactions end as scripted. */
  function replying(ends: unknown[]) {
    let runs = 0;
    const apiDb = {
      execute: async () => [{ id: randomUUID() }],
      transaction: async () => {
        const end = ends[runs++];
        if (end instanceof Error) throw end;
        if (end === undefined) throw new Error("the transaction ran more often than the test scripted");
        return end;
      },
    };
    return { deps: { apiDb, social: {} } as unknown as Pick<ModerationDeps, "apiDb" | "social">, runs: () => runs };
  }
  const filed = { filedAt: "2026-10-12T10:00:00.000Z", onTime: true };

  test("a deadlock, a lock timeout and the bound's statement timeout each run it again, and the third run's answer is the reply's", async () => {
    const world = replying([pg("40P01"), pg("55P03"), filed]);
    expect(await fileReply(world.deps, randomUUID(), randomUUID(), {})).toBe(filed);
    expect(world.runs()).toBe(3);
    const bounded = replying([pg("57014"), filed]);
    expect(await fileReply(bounded.deps, randomUUID(), randomUUID(), {})).toBe(filed);
    expect(bounded.runs()).toBe(2);
  });

  test("when the third run fails the same way the answer is service_unavailable, and no fourth run is made", async () => {
    const world = replying([pg("40P01"), pg("55P03"), pg("57014")]);
    await expect(fileReply(world.deps, randomUUID(), randomUUID(), {})).rejects.toMatchObject({ name: "ModerationError", code: "service_unavailable", status: 503 });
    expect(world.runs()).toBe(3);
  });

  test("a reply that is not open is answered at once, whether the trigger or the primary key finds it; anything else is thrown as it is", async () => {
    for (const failure of [raisedAs("reply_not_open"), pg("23505", { constraint_name: "suspension_replies_pkey" })]) {
      const world = replying([failure]);
      await expect(fileReply(world.deps, randomUUID(), randomUUID(), {})).rejects.toMatchObject({ name: "ModerationError", code: "reply_not_open" });
      expect(world.runs()).toBe(1);
    }
    const other = pg("23503");
    const world = replying([other]);
    await expect(fileReply(world.deps, randomUUID(), randomUUID(), {})).rejects.toBe(other);
    expect(world.runs()).toBe(1);
  });
});
