import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import type { DbTx } from "@korbat/db";
import { isLockTimeout } from "../src/cli/lock-timeout";
import { boundLockWaits, isDeadlock, isLockNotAvailable } from "../src/lib/lock-bounds";

/** An error as the driver raises it, wrapped as often as told: drizzle hands the driver's error over as a cause. */
function pgError(code: string, wraps = 0): unknown {
  let err: unknown = Object.assign(new Error("from PostgreSQL"), { code });
  for (let i = 0; i < wraps; i++) err = new Error("wrapped", { cause: err });
  return err;
}

/** A transaction that answers the clock read with `ms` and records every statement with its parameters. */
function fakeTx(ms: string) {
  const dialect = new PgDialect();
  const statements: { text: string; params: unknown[] }[] = [];
  return {
    statements,
    tx: {
      execute: async (query: SQL) => {
        const built = dialect.sqlToQuery(query);
        statements.push({ text: built.sql, params: built.params });
        return statements.length === 1 ? [{ ms }] : [];
      },
    } as unknown as Pick<DbTx, "execute">,
  };
}

describe("the lock errors a confirmed action's transaction may meet", () => {
  test("a lock timeout is PostgreSQL's lock_not_available, however deeply the driver wrapped it", () => {
    for (let wraps = 0; wraps < 5; wraps++) expect(isLockNotAvailable(pgError("55P03", wraps)), String(wraps)).toBe(true);
    expect(isLockNotAvailable(pgError("40P01"))).toBe(false);
    expect(isLockNotAvailable(pgError("40001", 2))).toBe(false);
    for (const other of [null, undefined, "55P03", new Error("lock timeout"), { cause: "55P03" }]) expect(isLockNotAvailable(other), String(other)).toBe(false);
  });

  test("a deadlock is PostgreSQL's deadlock_detected, wrapped or not", () => {
    for (let wraps = 0; wraps < 5; wraps++) expect(isDeadlock(pgError("40P01", wraps)), String(wraps)).toBe(true);
    expect(isDeadlock(pgError("55P03"))).toBe(false);
    for (const other of [null, undefined, "40P01", new Error("deadlock detected")]) expect(isDeadlock(other), String(other)).toBe(false);
  });

  test("the command line's isLockTimeout is the same test", () => {
    expect(isLockTimeout).toBe(isLockNotAvailable);
  });
});

describe("boundLockWaits", () => {
  const expiresAt = new Date("2026-10-04T12:00:00.000Z");

  test("asks the database for a share of what is left of the challenge, at most 15 seconds, and sets it as the transaction's lock_timeout", async () => {
    const { tx, statements } = fakeTx("4000");
    expect(await boundLockWaits(tx, expiresAt, 15)).toBe(true);
    expect(statements).toHaveLength(2);
    // The clock is the database's, which stamps the audit row; the expiry and the number of waits travel as parameters.
    expect(statements[0]!.text).toContain("clock_timestamp()");
    expect(statements[0]!.text).toContain("least(15000");
    expect(statements[0]!.params).toEqual([expiresAt.getTime(), 15]);
    // Local to the transaction: the third argument of set_config.
    expect(statements[1]!.text).toMatch(/set_config\('lock_timeout', \$1::text, true\)/);
    expect(statements[1]!.params).toEqual(["4000ms"]);
  });

  test("the share follows the number of waits the transaction may meet", async () => {
    for (const waits of [1, 3, 15]) {
      const { tx, statements } = fakeTx("1");
      expect(await boundLockWaits(tx, expiresAt, waits)).toBe(true);
      expect(statements[0]!.params).toEqual([expiresAt.getTime(), waits]);
      expect(statements[1]!.params).toEqual(["1ms"]);
    }
  });

  test("with under a millisecond left it sets nothing and answers false: lock_timeout would read 0 as no limit at all", async () => {
    for (const ms of ["0", "-1", "-600000"]) {
      const { tx, statements } = fakeTx(ms);
      expect(await boundLockWaits(tx, expiresAt, 15), ms).toBe(false);
      expect(statements).toHaveLength(1);
    }
  });

  test("a number of waits that is not a positive whole number is a mistake of the caller", async () => {
    for (const waits of [0, -1, 1.5, Number.NaN]) {
      const { tx, statements } = fakeTx("4000");
      await expect(boundLockWaits(tx, expiresAt, waits)).rejects.toThrow(/waits/);
      expect(statements).toEqual([]);
    }
  });
});
