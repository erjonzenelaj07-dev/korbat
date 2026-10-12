import { randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { textDigest } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { scrub } from "../../src/lib/logger";
import { insertStaffText } from "../../src/moderation/repo";
import { authCaseCounts, hex64, rowCounts } from "./moderation-fixtures";

/**
 * What reaches a log line when a statement of the moderation module fails in the database for a reason the module does
 * not turn into a refusal of its own (3c design, section 11, Privacy): the driver's error is wrapped by drizzle-orm in an
 * error whose message lists every parameter of the statement, and a text, its salt or a reporter's account would reach
 * the log with it. The statement here fails on a foreign key, so nothing is stored. The file's last test holds it to
 * leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: a failing statement's parameters stay out of the log", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it, for the four auth tables' counts.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    before = await counts();
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  const counts = async (): Promise<Record<string, number>> => ({ ...(await rowCounts(apiDb)), ...(await authCaseCounts(migrateDb)) });

  test("a staff text saved on a case that does not exist: the logged line names the statement and the database's code, and holds neither the text nor its salt", async () => {
    const text = `REPORTER-WORDS a staff text that quotes nobody ${randomUUID()}`;
    const salt = hex64();
    const digest = await textDigest(salt, text);
    const failure = await insertStaffText(apiDb, { caseId: randomUUID(), authorId: randomUUID(), kind: "facts", text, salt, digest }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(Error);
    // The error as the driver and drizzle-orm hand it over does hold them.
    expect((failure as Error).message).toContain(salt);

    // The line as the API's logger writes it: every object goes through scrub.
    const lines: string[] = [];
    const log = pino({ level: "info", formatters: { log: (fields) => scrub(fields) as Record<string, unknown> } }, { write: (line: string) => void lines.push(line) });
    log.error({ err: failure }, "a statement failed");
    expect(lines).toHaveLength(1);
    for (const secret of [text, salt, digest]) expect(lines[0]).not.toContain(secret);
    expect(JSON.parse(lines[0]!).err).toMatchObject({ code: "23503", message: expect.stringMatching(/^Failed query: insert into staff_texts/) });
  });

  test("this file left no row behind: the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    expect(await counts()).toEqual(before);
  });
});
